"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogArchive = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const log_files_1 = require("./log-files");
const MAX_FRAME = 192 * 1024 * 1024;
const safeName = (name) => !node_path_1.default.isAbsolute(name) && name.split('/').every(part => part !== '..' && part !== '.' && part.length > 0) && !name.includes('\\');
/** 冷分片不可变，按哈希分片索引；调用方必须持有共享写锁。 */
class LogArchive {
    constructor(directory) {
        this.directory = directory;
        this.root = node_path_1.default.join(directory, '.cold');
    }
    async key() {
        const raw = await (0, log_files_1.readLogFile)(this.directory, node_path_1.default.join(this.directory, '.payload-encryption-key'), 128);
        if (raw === null)
            throw new Error('Log encryption key is missing. Restore the matching backup.');
        const key = Buffer.from(raw.trim(), 'base64');
        if (key.length !== 32)
            throw new Error('Invalid log key.');
        return key;
    }
    signature(value, key) { return (0, node_crypto_1.createHmac)('sha256', key).update(JSON.stringify(value)).digest('hex'); }
    async manifest() {
        const raw = await (0, log_files_1.readLogFile)(this.directory, node_path_1.default.join(this.root, 'CURRENT'), 1024 * 1024);
        if (raw === null) {
            const existing = await promises_1.default.readdir(this.root).catch(error => {
                if ((0, log_files_1.isMissingLogFile)(error))
                    return [];
                throw error;
            });
            if (existing.some(name => name.endsWith('.pack') || name.endsWith('.index')))
                throw new Error('Archive manifest is missing; maintenance recovery is required.');
            return null;
        }
        const manifest = JSON.parse(raw);
        if (manifest.version !== 1 || typeof manifest.generation !== 'string' || !manifest.buckets || typeof manifest.mac !== 'string')
            throw new Error('Invalid archive manifest.');
        const { mac, ...unsigned } = manifest;
        const expected = Buffer.from(this.signature(unsigned, await this.key()), 'hex'), actual = Buffer.from(mac, 'hex');
        if (actual.length !== expected.length || !(0, node_crypto_1.timingSafeEqual)(actual, expected))
            throw new Error('Archive manifest authentication failed.');
        return manifest;
    }
    async bucket(manifest, prefix) {
        const descriptor = manifest?.buckets[prefix];
        if (!descriptor)
            return {};
        if (!/^[a-f0-9-]+\.index$/.test(descriptor.file))
            throw new Error('Invalid archive index path.');
        const raw = await (0, log_files_1.readLogFile)(this.directory, node_path_1.default.join(this.root, descriptor.file), 32 * 1024 * 1024);
        if (raw === null || (0, log_files_1.logHash)(raw) !== descriptor.hash)
            throw new Error('Archive index is missing or corrupt.');
        return JSON.parse(raw);
    }
    async readEntry(name, entry) {
        if (!/^[a-f0-9-]+\.pack$/.test(entry.segment) || !Number.isSafeInteger(entry.offset) || entry.offset < 0 || !Number.isSafeInteger(entry.length) || entry.length < 1 || entry.length > MAX_FRAME)
            throw new Error('Invalid archive locator.');
        const file = node_path_1.default.join(this.root, entry.segment);
        await (0, log_files_1.assertLogPath)(this.directory, file);
        const handle = await promises_1.default.open(file, 'r');
        try {
            const bytes = Buffer.alloc(entry.length);
            let offset = 0;
            while (offset < bytes.length) {
                const read = await handle.read(bytes, offset, bytes.length - offset, entry.offset + offset);
                if (!read.bytesRead)
                    throw new Error('Archive frame is truncated.');
                offset += read.bytesRead;
            }
            if ((0, log_files_1.logHash)(bytes) !== entry.hash)
                throw new Error('Archive frame integrity failed.');
            const frame = JSON.parse(bytes.toString('utf8'));
            if (frame.name !== name || typeof frame.content !== 'string')
                throw new Error('Archive frame identity mismatch.');
            return frame.content;
        }
        finally {
            await handle.close();
        }
    }
    async read(name) {
        if (!safeName(name))
            throw new Error('Invalid archive name.');
        for (let attempt = 0; attempt < 3; attempt++) {
            const manifest = await this.manifest();
            try {
                const entry = (await this.bucket(manifest, (0, log_files_1.logHash)(name)[0]))[name];
                return entry ? await this.readEntry(name, entry) : null;
            }
            catch (error) {
                if (attempt === 2 || (await this.manifest())?.generation === manifest?.generation)
                    throw error;
            }
        }
        throw new Error('Archive generation changed repeatedly.');
    }
    async entries() {
        const manifest = await this.manifest();
        const entries = new Map();
        for (const prefix of Object.keys(manifest?.buckets ?? {}))
            for (const [name, entry] of Object.entries(await this.bucket(manifest, prefix)))
                entries.set(name, entry);
        return entries;
    }
    async maintenanceState() {
        const raw = await (0, log_files_1.readLogFile)(this.directory, node_path_1.default.join(this.root, 'PREPARING'), 4 * 1024 * 1024);
        if (raw === null)
            return 'idle';
        try {
            const parsed = JSON.parse(raw);
            const { mac, ...unsigned } = parsed;
            const expected = (0, node_crypto_1.createHmac)('sha256', await this.key()).update(JSON.stringify(unsigned)).digest('hex');
            return mac === expected && ['preparing', 'publishing'].includes(parsed.phase) ? parsed.phase : 'invalid';
        }
        catch {
            return 'invalid';
        }
    }
    async snapshot() {
        const manifest = await this.manifest(), entries = await this.entries();
        return { generation: manifest?.generation ?? '0', files: entries.size, segments: new Set([...entries.values()].map(entry => entry.segment)).size };
    }
    async verify() {
        for (const [name, entry] of await this.entries())
            await this.readEntry(name, entry);
        return this.snapshot();
    }
    /** 只从已提交清单认证的分片重建索引，不能收养来源不明的文件。 */
    async rebuildIndex() {
        const previous = await this.manifest();
        if (!previous)
            return;
        const values = new Map();
        for (const [segment, expectedHash] of Object.entries(previous.segments)) {
            if (!/^[a-f0-9-]+\.pack$/.test(segment))
                throw new Error('Invalid committed segment path.');
            const raw = await (0, log_files_1.readLogFile)(this.directory, node_path_1.default.join(this.root, segment));
            if (raw === null || (0, log_files_1.logHash)(raw) !== expectedHash)
                throw new Error('Committed segment is missing or corrupt; restore backup.');
            let offset = 0;
            for (const line of raw.split('\n').filter(Boolean)) {
                const frame = JSON.parse(line);
                if (!safeName(frame.name) || typeof frame.content !== 'string' || !/^[a-f0-9]{64}$/.test(frame.originalHash))
                    throw new Error('Invalid archived frame.');
                const prefix = (0, log_files_1.logHash)(frame.name)[0], bucket = values.get(prefix) ?? {};
                if (bucket[frame.name])
                    throw new Error('Duplicate archive identity.');
                const bytes = Buffer.from(line + '\n');
                bucket[frame.name] = { segment, offset, length: bytes.length, hash: (0, log_files_1.logHash)(bytes), originalHash: frame.originalHash };
                offset += bytes.length;
                values.set(prefix, bucket);
            }
        }
        const generation = (0, node_crypto_1.randomBytes)(16).toString('hex'), buckets = {};
        for (const [prefix, bucket] of values) {
            const content = JSON.stringify(bucket), file = `${generation}-${prefix}.index`;
            if (Buffer.byteLength(content) > 32 * 1024 * 1024)
                throw new Error('Archive index capacity reached.');
            await (0, log_files_1.writeLogFile)(this.directory, node_path_1.default.join(this.root, file), content);
            buckets[prefix] = { file, hash: (0, log_files_1.logHash)(content) };
        }
        const unsigned = { version: 1, generation, buckets, segments: previous.segments };
        const rebuilt = JSON.stringify({ ...unsigned, mac: this.signature(unsigned, await this.key()) });
        if (Buffer.byteLength(rebuilt) > 1024 * 1024)
            throw new Error('Archive manifest capacity reached.');
        await (0, log_files_1.writeLogFile)(this.directory, node_path_1.default.join(this.root, 'CURRENT'), rebuilt);
        await this.verify();
    }
    async recoverPreparation() {
        const raw = await (0, log_files_1.readLogFile)(this.directory, node_path_1.default.join(this.root, 'PREPARING'), 4 * 1024 * 1024);
        if (raw === null)
            return;
        const intent = JSON.parse(raw);
        const { mac, ...unsigned } = intent;
        const expected = (0, node_crypto_1.createHmac)('sha256', await this.key()).update(JSON.stringify(unsigned)).digest('hex');
        if (mac !== expected || !/^[a-f0-9]{32}$/.test(intent.generation) || !/^(0|[a-f0-9]{32})$/.test(intent.previous) || !Array.isArray(intent.originals))
            throw new Error('Invalid archive preparation ownership.');
        const current = await (0, log_files_1.readLogFile)(this.directory, node_path_1.default.join(this.root, 'CURRENT'), 1024 * 1024);
        if (intent.phase === 'publishing' && intent.manifest) {
            const { mac: manifestMac, ...planned } = intent.manifest;
            if (planned.generation !== intent.generation || manifestMac !== this.signature(planned, await this.key()))
                throw new Error('Invalid pending archive manifest.');
            if (current !== null) {
                const active = await this.manifest();
                if (active?.generation !== intent.previous && active?.generation !== intent.generation)
                    throw new Error('Archive publication conflicts with its current generation.');
            }
            for (const prefix of Object.keys(planned.buckets))
                for (const [name, entry] of Object.entries(await this.bucket(intent.manifest, prefix)))
                    await this.readEntry(name, entry);
            await (0, log_files_1.writeLogFile)(this.directory, node_path_1.default.join(this.root, 'CURRENT'), JSON.stringify(intent.manifest));
            await this.retire();
            await promises_1.default.unlink(node_path_1.default.join(this.root, 'PREPARING'));
            return;
        }
        if (intent.phase !== 'preparing')
            throw new Error('Unknown archive preparation phase.');
        if (current === null && intent.previous !== '0')
            throw new Error('Committed archive manifest is missing.');
        if (current !== null && (await this.manifest())?.generation !== intent.previous)
            throw new Error('Archive preparation conflicts with the current generation.');
        for (const original of intent.originals) {
            if (!safeName(original.name))
                throw new Error('Invalid archive preparation path.');
            const bytes = await (0, log_files_1.readLogFile)(this.directory, node_path_1.default.join(this.directory, original.name));
            if (bytes === null || (0, log_files_1.logHash)(bytes) !== original.hash)
                throw new Error('Original archive inputs changed; temporary copies retained.');
        }
        for (const file of await promises_1.default.readdir(this.root))
            if (file.startsWith(intent.generation + '-') && /\.(pack|index)$/.test(file)) {
                await (0, log_files_1.assertLogPath)(this.directory, node_path_1.default.join(this.root, file));
                await promises_1.default.unlink(node_path_1.default.join(this.root, file));
            }
        await promises_1.default.unlink(node_path_1.default.join(this.root, 'PREPARING'));
    }
    async commit(items) {
        if (!items.length)
            return;
        await this.recoverPreparation();
        const previous = await this.manifest();
        const generation = (0, node_crypto_1.randomBytes)(16).toString('hex');
        const buckets = { ...previous?.buckets };
        const changed = new Map();
        const segments = { ...previous?.segments };
        let frames = [], segmentBytes = 0, ordinal = 0;
        let segment = `${generation}-${ordinal}.pack`;
        const flush = async () => {
            if (frames.length) {
                const bytes = Buffer.concat(frames);
                await (0, log_files_1.writeLogFile)(this.directory, node_path_1.default.join(this.root, segment), bytes);
                segments[segment] = (0, log_files_1.logHash)(bytes);
            }
            frames = [];
            segmentBytes = 0;
        };
        // 准备记录同时保存中断恢复所需的所有权与原始内容证明。
        const preparation = { generation, previous: previous?.generation ?? '0', phase: 'preparing', originals: items.map(item => ({ name: item.name, hash: item.originalHash })) };
        const persistIntent = async (intent) => {
            const encoded = JSON.stringify({ ...intent, mac: (0, node_crypto_1.createHmac)('sha256', await this.key()).update(JSON.stringify(intent)).digest('hex') });
            if (Buffer.byteLength(encoded) > 4 * 1024 * 1024)
                throw new Error('Archive preparation exceeds its bounded size.');
            await (0, log_files_1.writeLogFile)(this.directory, node_path_1.default.join(this.root, 'PREPARING'), encoded);
        };
        await persistIntent(preparation);
        for (const item of items) {
            if (!safeName(item.name))
                throw new Error('Invalid archive item name.');
            const prefix = (0, log_files_1.logHash)(item.name)[0];
            let bucket = changed.get(prefix);
            if (!bucket) {
                bucket = await this.bucket(previous, prefix);
                changed.set(prefix, bucket);
            }
            if (bucket[item.name]) {
                if (await this.readEntry(item.name, bucket[item.name]) !== item.content)
                    throw new Error('An archived log cannot be replaced.');
                continue;
            }
            const frame = Buffer.from(JSON.stringify({ name: item.name, content: item.content, originalHash: item.originalHash }) + '\n');
            if (frame.length > MAX_FRAME)
                throw new Error('Archive frame exceeds its limit.');
            if (frames.length && (frames.length >= 1000 || segmentBytes + frame.length > 32 * 1024 * 1024)) {
                await flush();
                segment = `${generation}-${++ordinal}.pack`;
            }
            bucket[item.name] = { segment, offset: segmentBytes, length: frame.length, hash: (0, log_files_1.logHash)(frame), originalHash: item.originalHash };
            frames.push(frame);
            segmentBytes += frame.length;
        }
        await flush();
        for (const [prefix, values] of changed) {
            for (const item of items.filter(row => (0, log_files_1.logHash)(row.name)[0] === prefix)) {
                if (await this.readEntry(item.name, values[item.name]) !== item.content)
                    throw new Error('Archive verification failed.');
            }
            const file = `${generation}-${prefix}.index`, content = JSON.stringify(values);
            if (Buffer.byteLength(content) > 32 * 1024 * 1024)
                throw new Error('Archive index capacity reached; hot records retained.');
            await (0, log_files_1.writeLogFile)(this.directory, node_path_1.default.join(this.root, file), content);
            buckets[prefix] = { file, hash: (0, log_files_1.logHash)(content) };
        }
        const unsigned = { version: 1, generation, buckets, segments };
        const manifest = { ...unsigned, mac: this.signature(unsigned, await this.key()) };
        if (Buffer.byteLength(JSON.stringify(manifest)) > 1024 * 1024)
            throw new Error('Archive manifest capacity reached; hot records retained.');
        await persistIntent({ ...preparation, phase: 'publishing', manifest });
        await (0, log_files_1.writeLogFile)(this.directory, node_path_1.default.join(this.root, 'CURRENT'), JSON.stringify(manifest));
        await this.retire();
        await promises_1.default.unlink(node_path_1.default.join(this.root, 'PREPARING')).catch(error => {
            if (!(0, log_files_1.isMissingLogFile)(error))
                throw error;
        });
    }
    /** 只回收已被认证冷存储覆盖、且内容未变的系统副本。 */
    async retire() {
        const hotNames = new Set(await promises_1.default.readdir(this.directory));
        for (const [name, entry] of await this.entries()) {
            if (!hotNames.has(name.split('/')[0]))
                continue;
            const file = node_path_1.default.join(this.directory, name), content = await (0, log_files_1.readLogFile)(this.directory, file);
            if (content === null)
                continue;
            if ((0, log_files_1.logHash)(content) !== entry.originalHash)
                throw new Error('A hot log changed during archive retirement.');
            await this.readEntry(name, entry);
            await promises_1.default.unlink(file);
        }
        const manifest = await this.manifest();
        if (!manifest)
            return;
        const live = new Set(['CURRENT', 'PREPARING', ...Object.values(manifest.buckets).map(row => row.file), ...[...(await this.entries()).values()].map(row => row.segment)]);
        for (const name of await promises_1.default.readdir(this.root))
            if (!live.has(name) && /^[a-f0-9-]+\.(index|pack)$/.test(name))
                await promises_1.default.unlink(node_path_1.default.join(this.root, name));
    }
}
exports.LogArchive = LogArchive;
