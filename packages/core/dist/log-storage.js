"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperationalLogRepository = exports.LOG_STORAGE_ROOT = void 0;
exports.logDirectory = logDirectory;
exports.isOperationalLogPath = isOperationalLogPath;
exports.createVaultOperationJournal = createVaultOperationJournal;
exports.backupVault = backupVault;
exports.restoreVaultBackup = restoreVaultBackup;
exports.previewLogMigration = previewLogMigration;
exports.logStorageIsActive = logStorageIsActive;
exports.migrateLogStorage = migrateLogStorage;
exports.cancelLogMigration = cancelLogMigration;
exports.exportLogDiagnostics = exportLogDiagnostics;
exports.logBackupSummary = logBackupSummary;
exports.logMigrationPending = logMigrationPending;
const node_fs_1 = __importDefault(require("node:fs"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const operation_journal_1 = require("./operation-journal");
const knowledge_architecture_1 = require("./knowledge-architecture");
const log_archive_1 = require("./log-archive");
const log_files_1 = require("./log-files");
exports.LOG_STORAGE_ROOT = '.tracekeeper/logs';
const migrationStatePath = (vault) => node_path_1.default.join(vault, '.tracekeeper', '.log-migration-state');
const activatedPath = (vault) => node_path_1.default.join(vault, exports.LOG_STORAGE_ROOT, 'ACTIVE');
function logDirectory(vault) {
    const modern = node_path_1.default.join(vault, exports.LOG_STORAGE_ROOT, 'data');
    let component = vault;
    for (const part of ['', '.tracekeeper', 'logs']) {
        if (part)
            component = node_path_1.default.join(component, part);
        if (node_fs_1.default.existsSync(component) && node_fs_1.default.lstatSync(component).isSymbolicLink())
            throw new Error('Log storage root contains a symbolic link.');
    }
    if (node_fs_1.default.existsSync(activatedPath(vault))) {
        const stat = node_fs_1.default.lstatSync(activatedPath(vault));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
            throw new Error('Invalid log activation file.');
        const activation = JSON.parse(node_fs_1.default.readFileSync(activatedPath(vault), 'utf8'));
        if (activation.version !== 1 || activation.state !== 'active')
            throw new Error('Unsupported log storage version.');
        if (!node_fs_1.default.existsSync(modern) || !node_fs_1.default.lstatSync(modern).isDirectory() || node_fs_1.default.lstatSync(modern).isSymbolicLink())
            throw new Error('Activated log data is missing or invalid; restore backup.');
        if (activation.keyHash) {
            const keyPath = node_path_1.default.join(modern, '.payload-encryption-key');
            if (!node_fs_1.default.existsSync(keyPath) || node_fs_1.default.lstatSync(keyPath).isSymbolicLink() || (0, log_files_1.logHash)(Buffer.from(node_fs_1.default.readFileSync(keyPath, 'utf8').trim(), 'base64')) !== activation.keyHash)
                throw new Error('Log key does not match the activated store.');
        }
        return modern;
    }
    const legacy = node_path_1.default.join(vault, knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR);
    return node_fs_1.default.existsSync(legacy) ? legacy : modern;
}
function isOperationalLogPath(relative) { return !relative.startsWith(`${knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR}/legacy-link-probes`) && (relative === knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR || relative.startsWith(`${knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR}/`)); }
const initializations = new Map();
async function initialize(vault) {
    await (0, log_files_1.assertLogPath)(vault, node_path_1.default.join(vault, exports.LOG_STORAGE_ROOT));
    if (logDirectory(vault) === node_path_1.default.join(vault, knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR) || node_fs_1.default.existsSync(activatedPath(vault)))
        return;
    const existing = initializations.get(vault);
    if (existing)
        return existing;
    const action = (async () => {
        const coordinator = new operation_journal_1.NodeFileOperationJournal({ directory: node_path_1.default.join(vault, '.tracekeeper', 'initialization-control') });
        const release = await coordinator.acquireLock('initialize-log-store');
        try {
            if (node_fs_1.default.existsSync(activatedPath(vault)))
                return;
            if (node_fs_1.default.existsSync(node_path_1.default.join(vault, exports.LOG_STORAGE_ROOT)))
                throw new Error('Unrecognized log storage directory; inspect migration state first.');
            const activation = { version: 1, state: 'active', backup: null, activatedAt: new Date().toISOString() };
            await promises_1.default.mkdir(node_path_1.default.join(vault, exports.LOG_STORAGE_ROOT, 'data'), { recursive: true });
            await (0, log_files_1.writeLogFile)(vault, activatedPath(vault), JSON.stringify(activation));
        }
        finally {
            await release();
        }
    })();
    initializations.set(vault, action);
    try {
        await action;
    }
    finally {
        if (initializations.get(vault) === action)
            initializations.delete(vault);
    }
}
function createVaultOperationJournal(vault) {
    const directory = logDirectory(vault);
    return new operation_journal_1.NodeFileOperationJournal({ directory, beforeWrite: async () => {
            if (directory !== logDirectory(vault))
                throw new Error('Log storage changed; reacquire the provider.');
            await initialize(vault);
            if (directory !== logDirectory(vault))
                throw new Error('Log storage changed during initialization.');
        }, onKeyCreated: async (key) => {
            if (node_fs_1.default.existsSync(activatedPath(vault))) {
                const raw = JSON.parse((await (0, log_files_1.readLogFile)(vault, activatedPath(vault), 4096)));
                await (0, log_files_1.writeLogFile)(vault, activatedPath(vault), JSON.stringify({ ...raw, keyHash: (0, log_files_1.logHash)(key) }));
            }
        } });
}
/** 历史逻辑引用保持稳定，只有该适配器负责解析物理存储位置。 */
class OperationalLogRepository {
    constructor(vault) {
        this.vault = vault;
    }
    name(logical) {
        if (!logical.startsWith(`${knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR}/`))
            throw new Error('Not an operational log reference.');
        const name = logical.slice(knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR.length + 1);
        if (name.split('/').some(part => !part || part === '.' || part === '..') || name.includes('\\'))
            throw new Error('Invalid operational log reference.');
        return name;
    }
    async readText(logical) {
        const root = logDirectory(this.vault), name = this.name(logical);
        await (0, log_files_1.assertLogPath)(this.vault, root);
        return await (0, log_files_1.readLogFile)(root, node_path_1.default.join(root, name)) ?? await new log_archive_1.LogArchive(root).read(name);
    }
    async replaceText(logical, expectedHash, content) {
        const journal = createVaultOperationJournal(this.vault), release = await journal.acquireLock(`receipt:${logical}`);
        try {
            return await journal.coordinate(async () => {
                const current = await this.readText(logical);
                if (current === content)
                    return;
                if ((current === null ? null : (0, log_files_1.logHash)(current)) !== expectedHash)
                    throw new Error('Operational receipt changed concurrently.');
                const root = logDirectory(this.vault), name = this.name(logical);
                if (await new log_archive_1.LogArchive(root).read(name) !== null)
                    throw new Error('Archived receipts are immutable.');
                await journal.initializeStorage();
                await (0, log_files_1.writeLogFile)(root, node_path_1.default.join(root, name), content);
            });
        }
        finally {
            await release();
        }
    }
    async list(prefix = knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR) {
        if (!isOperationalLogPath(prefix))
            throw new Error('Invalid log prefix.');
        const root = logDirectory(this.vault), found = new Set();
        await (0, log_files_1.assertLogPath)(this.vault, root);
        const walk = async (directory) => {
            for (const item of await promises_1.default.readdir(directory, { withFileTypes: true }).catch(error => {
                if ((0, log_files_1.isMissingLogFile)(error))
                    return [];
                throw error;
            })) {
                if (item.name.startsWith('.'))
                    continue;
                if (item.isSymbolicLink())
                    throw new Error('Log storage contains a symbolic link.');
                const file = node_path_1.default.join(directory, item.name);
                if (item.isDirectory())
                    await walk(file);
                else if (item.isFile())
                    found.add(`${knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR}/${node_path_1.default.relative(root, file).split(node_path_1.default.sep).join('/')}`);
            }
        };
        await walk(root);
        for (const name of (await new log_archive_1.LogArchive(root).entries()).keys())
            if (!name.startsWith('.'))
                found.add(`${knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR}/${name}`);
        return [...found].filter(name => name.startsWith(`${prefix}/`)).sort();
    }
}
exports.OperationalLogRepository = OperationalLogRepository;
const transient = (name) => {
    if (name === '.tracekeeper/.log-migration-state' || name === '.migration-staging' || name.startsWith('.migration-staging/') || name === '.tracekeeper/migration-control' || name.startsWith('.tracekeeper/migration-control/') || name === '.tracekeeper/initialization-control' || name.startsWith('.tracekeeper/initialization-control/'))
        return true;
    const operational = name.startsWith(knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR + '/') || name.startsWith(exports.LOG_STORAGE_ROOT + '/');
    return operational && (/(?:^|\/)\.coordination(?:\/|$)/.test(name) || /(?:\.lock|\.tmp-[a-f0-9-]+)$/.test(name));
};
async function fileDigest(root, file) {
    await (0, log_files_1.assertLogPath)(root, file);
    const handle = await promises_1.default.open(file, node_fs_1.default.constants.O_RDONLY | (node_fs_1.default.constants.O_NOFOLLOW ?? 0));
    try {
        if (!(await handle.stat()).isFile())
            throw new Error('Backup encountered a non-regular file.');
        const digest = (0, node_crypto_1.createHash)('sha256'), buffer = Buffer.alloc(128 * 1024);
        let bytes = 0;
        for (;;) {
            const read = await handle.read(buffer, 0, buffer.length, null);
            if (!read.bytesRead)
                break;
            digest.update(buffer.subarray(0, read.bytesRead));
            bytes += read.bytesRead;
        }
        return { bytes, hash: digest.digest('hex') };
    }
    finally {
        await handle.close();
    }
}
async function copyBackupFile(sourceRoot, source, targetRoot, target, expected) {
    await (0, log_files_1.assertLogPath)(sourceRoot, source);
    await (0, log_files_1.assertLogPath)(targetRoot, target);
    await promises_1.default.mkdir(node_path_1.default.dirname(target), { recursive: true });
    await promises_1.default.copyFile(source, target, node_fs_1.default.constants.COPYFILE_EXCL);
    const handle = await promises_1.default.open(target, 'r+');
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    if ((await fileDigest(targetRoot, target)).hash !== expected)
        throw new Error('Backup copy does not match its snapshot.');
}
async function inventory(root, directories, operational = false) {
    const files = [];
    const walk = async (directory) => {
        for (const entry of await promises_1.default.readdir(directory, { withFileTypes: true })) {
            const target = node_path_1.default.join(directory, entry.name), name = node_path_1.default.relative(root, target).split(node_path_1.default.sep).join('/');
            if (transient(name) || (operational && transient(`${knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR}/${name}`)))
                continue;
            if (entry.isSymbolicLink())
                throw new Error('Backup cannot follow symbolic links.');
            if (entry.isDirectory()) {
                directories?.add(name);
                await walk(target);
            }
            else if (entry.isFile()) {
                files.push({ name, ...await fileDigest(root, target) });
            }
            else
                throw new Error('Backup encountered a non-regular file.');
        }
    };
    await (0, log_files_1.assertLogPath)(root);
    await walk(root);
    return files.sort((a, b) => a.name.localeCompare(b.name));
}
function requireSeparateDirectory(vault, destination) {
    if (!node_path_1.default.isAbsolute(destination))
        throw new Error('Choose an absolute backup directory.');
    const source = node_fs_1.default.realpathSync(vault);
    const target = node_path_1.default.join(node_fs_1.default.realpathSync(node_path_1.default.dirname(destination)), node_path_1.default.basename(destination));
    const relative = node_path_1.default.relative(source, target), reverse = node_path_1.default.relative(target, source);
    if (!relative || (!relative.startsWith('..') && !node_path_1.default.isAbsolute(relative)) || (!reverse.startsWith('..') && !node_path_1.default.isAbsolute(reverse)))
        throw new Error('Backup and Vault directories must be separate.');
    if (node_fs_1.default.existsSync(destination))
        throw new Error('Backup destination must not already exist.');
}
async function backupVault(vault, destination) {
    requireSeparateDirectory(vault, destination);
    await (0, log_files_1.assertLogPath)(node_path_1.default.dirname(destination), destination);
    const directories = new Set();
    const files = await inventory(vault, directories), needed = files.reduce((sum, row) => sum + row.bytes, 0);
    const space = await promises_1.default.statfs(node_path_1.default.dirname(destination));
    if (space.bavail * space.bsize < needed * 1.1)
        throw new Error('Insufficient space for a verified Vault backup.');
    await promises_1.default.mkdir(destination, { mode: 0o700 });
    const data = node_path_1.default.join(destination, 'vault');
    await promises_1.default.mkdir(data, { mode: 0o700 });
    for (const directory of [...directories].sort())
        await promises_1.default.mkdir(node_path_1.default.join(data, directory), { recursive: true, mode: 0o700 });
    for (const row of files) {
        if ((await fileDigest(vault, node_path_1.default.join(vault, row.name))).hash !== row.hash)
            throw new Error('Vault changed during backup. No valid backup was committed.');
        await copyBackupFile(vault, node_path_1.default.join(vault, row.name), data, node_path_1.default.join(data, row.name), row.hash);
    }
    const currentDirectories = new Set();
    if (JSON.stringify(await inventory(vault, currentDirectories)) !== JSON.stringify(files) || JSON.stringify([...currentDirectories].sort()) !== JSON.stringify([...directories].sort()) || JSON.stringify(await inventory(data)) !== JSON.stringify(files))
        throw new Error('Vault changed during backup verification.');
    const manifest = { version: 1, createdAt: new Date().toISOString(), files, directories: [...directories].sort() };
    await (0, log_files_1.writeLogFile)(destination, node_path_1.default.join(destination, 'backup.json'), JSON.stringify(manifest));
    return manifest;
}
async function restoreVaultBackup(backup, destination) {
    requireSeparateDirectory(backup, destination);
    const raw = await (0, log_files_1.readLogFile)(backup, node_path_1.default.join(backup, 'backup.json'), 32 * 1024 * 1024);
    if (!raw)
        throw new Error('A verified backup manifest is required.');
    const manifest = JSON.parse(raw);
    const directories = new Set();
    const actual = await inventory(node_path_1.default.join(backup, 'vault'), directories);
    if (manifest.version !== 1 || !Array.isArray(manifest.files) || JSON.stringify(actual) !== JSON.stringify(manifest.files) || (manifest.directories && JSON.stringify([...directories].sort()) !== JSON.stringify(manifest.directories)))
        throw new Error('Backup verification failed.');
    await (0, log_files_1.assertLogPath)(node_path_1.default.dirname(destination), destination);
    await promises_1.default.mkdir(destination, { mode: 0o700 });
    for (const directory of manifest.directories ?? []) {
        const target = node_path_1.default.join(destination, directory);
        await (0, log_files_1.assertLogPath)(destination, target);
        await promises_1.default.mkdir(target, { recursive: true, mode: 0o700 });
    }
    for (const row of manifest.files)
        await copyBackupFile(node_path_1.default.join(backup, 'vault'), node_path_1.default.join(backup, 'vault', row.name), destination, node_path_1.default.join(destination, row.name), row.hash);
    if (JSON.stringify(await inventory(destination)) !== JSON.stringify(manifest.files))
        throw new Error('Restored Vault failed verification.');
}
async function previewLogMigration(vault) {
    const pending = await (0, log_files_1.readLogFile)(vault, migrationStatePath(vault), 4096);
    if (pending !== null) {
        const state = JSON.parse(pending);
        if (state.version !== 1 || !/^[a-f0-9]{64}$/.test(state.inventoryHash))
            throw new Error('Invalid migration state.');
        return { version: 1, resumable: true, inventoryHash: state.inventoryHash, files: 0, bytes: 0, canMigrate: true, issues: ['Resume the owned migration with its original backup directory.'] };
    }
    const legacy = node_path_1.default.join(vault, knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR);
    if (node_fs_1.default.existsSync(activatedPath(vault)))
        return { version: 1, inventoryHash: '', files: 0, bytes: 0, canMigrate: false, issues: ['Log storage is already active.'] };
    const files = node_fs_1.default.existsSync(legacy) ? await inventory(legacy, undefined, true) : [];
    const issues = [];
    if (node_fs_1.default.existsSync(legacy)) {
        const entries = await promises_1.default.readdir(legacy);
        if (entries.some(name => name.endsWith('.lock')))
            issues.push('Wait for active log writers or recover their interrupted operations before migration.');
    }
    for (const row of files.filter(row => row.name.endsWith('.json'))) {
        try {
            const value = JSON.parse((await promises_1.default.readFile(node_path_1.default.join(legacy, row.name))).toString('utf8'));
            if (['in_progress', 'running', 'activity_pending'].includes(value.status))
                issues.push(`Operation must reach a safe boundary: ${row.name}`);
        }
        catch {
            issues.push(`Invalid log: ${row.name}`);
        }
    }
    if (files.length)
        try {
            await new operation_journal_1.NodeFileOperationJournal({ directory: legacy }).verifyStorage();
        }
        catch {
            issues.push('Operation integrity verification failed. Restore or repair before migration.');
        }
    const vaultFiles = await inventory(vault);
    return { version: 1, backupFiles: vaultFiles.length, backupBytes: vaultFiles.reduce((sum, row) => sum + row.bytes, 0), inventoryHash: (0, log_files_1.logHash)(JSON.stringify(files)), files: files.length, bytes: files.reduce((sum, row) => sum + row.bytes, 0), canMigrate: issues.length === 0, issues };
}
/** 切换前后分别续作，绝不把旧日志恢复到已有新写入的 Vault。 */
async function migrateLogStorageOwned(vault, destination, preview) {
    const stateRaw = await (0, log_files_1.readLogFile)(vault, migrationStatePath(vault), 4096);
    let state = stateRaw === null ? null : JSON.parse(stateRaw);
    if (state && (state.version !== 1 || state.backup !== destination || state.inventoryHash !== preview.inventoryHash || !/^[a-f0-9]{24}$/.test(state.token)))
        throw new Error('Migration ownership does not match this request.');
    let backup;
    if (!state) {
        const current = await previewLogMigration(vault);
        if (!preview.canMigrate || !current.canMigrate || current.inventoryHash !== preview.inventoryHash)
            throw new Error('Migration preview is stale or blocked.');
        backup = await backupVault(vault, destination);
        state = { version: 1, phase: 'backed_up', backup: destination, token: (0, node_crypto_1.randomBytes)(12).toString('hex'), inventoryHash: preview.inventoryHash };
        await (0, log_files_1.writeLogFile)(vault, migrationStatePath(vault), JSON.stringify(state));
    }
    else {
        const raw = await (0, log_files_1.readLogFile)(destination, node_path_1.default.join(destination, 'backup.json'), 32 * 1024 * 1024);
        if (raw === null)
            throw new Error('The migration backup is missing.');
        backup = JSON.parse(raw);
        if (backup.version !== 1 || JSON.stringify(await inventory(node_path_1.default.join(destination, 'vault'))) !== JSON.stringify(backup.files))
            throw new Error('Migration backup verification failed.');
    }
    const legacy = node_path_1.default.join(vault, knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR), modernRoot = node_path_1.default.join(vault, exports.LOG_STORAGE_ROOT), stage = node_path_1.default.join(vault, '.migration-staging', state.token), data = node_path_1.default.join(modernRoot, 'data');
    const logFiles = backup.files.filter(row => row.name.startsWith(`${knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR}/`));
    const activation = await (0, log_files_1.readLogFile)(vault, activatedPath(vault), 4096);
    if (activation !== null) {
        const active = JSON.parse(activation);
        if (active.version !== 1 || active.state !== 'active' || active.backup !== destination)
            throw new Error('Migration activation conflicts with another store.');
        state.phase = 'active';
    }
    if (state.phase !== 'active') {
        const before = await inventory(vault);
        // 已经完成数据目录 rename、尚未发布 ACTIVE 的中断也属于同一迁移。
        const relevant = before.filter(row => !row.name.startsWith(exports.LOG_STORAGE_ROOT + '/'));
        if (JSON.stringify(relevant) !== JSON.stringify(backup.files))
            throw new Error('Vault changed since its backup. Migration remains inactive.');
        await (0, log_files_1.assertLogPath)(vault, modernRoot);
        if (node_fs_1.default.existsSync(modernRoot) && state.phase !== 'verified')
            throw new Error('New log storage path is occupied.');
        if (!node_fs_1.default.existsSync(data)) {
            await promises_1.default.mkdir(stage, { recursive: true });
            for (const row of logFiles) {
                const target = node_path_1.default.join(stage, row.name.slice(knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR.length + 1));
                await (0, log_files_1.writeLogFile)(stage, target, await promises_1.default.readFile(node_path_1.default.join(destination, 'vault', row.name)));
            }
            await new operation_journal_1.NodeFileOperationJournal({ directory: stage }).verifyStorage();
            state.phase = 'verified';
            await (0, log_files_1.writeLogFile)(vault, migrationStatePath(vault), JSON.stringify(state));
            await promises_1.default.mkdir(modernRoot, { recursive: true });
            await promises_1.default.rename(stage, data);
        }
        for (const row of logFiles)
            if ((0, log_files_1.logHash)(await promises_1.default.readFile(node_path_1.default.join(data, row.name.slice(knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR.length + 1)))) !== row.hash)
                throw new Error('Staged log verification failed.');
        if (JSON.stringify((await inventory(vault)).filter(row => !row.name.startsWith(exports.LOG_STORAGE_ROOT + '/'))) !== JSON.stringify(backup.files))
            throw new Error('Vault changed before migration activation.');
        const importedKey = await (0, log_files_1.readLogFile)(data, node_path_1.default.join(data, '.payload-encryption-key'), 128);
        await (0, log_files_1.writeLogFile)(vault, activatedPath(vault), JSON.stringify({ version: 1, state: 'active', backup: destination, activatedAt: new Date().toISOString(), ...(importedKey ? { keyHash: (0, log_files_1.logHash)(Buffer.from(importedKey.trim(), 'base64')) } : {}) }));
        state.phase = 'active';
        await (0, log_files_1.writeLogFile)(vault, migrationStatePath(vault), JSON.stringify(state));
    }
    await createVaultOperationJournal(vault).verifyStorage();
    for (const row of logFiles) {
        const original = node_path_1.default.join(vault, row.name);
        const bytes = await promises_1.default.readFile(original).catch(error => {
            if ((0, log_files_1.isMissingLogFile)(error))
                return null;
            throw error;
        });
        if (bytes === null)
            continue;
        if ((0, log_files_1.logHash)(bytes) !== row.hash)
            throw new Error('Old log changed after activation; old copy retained.');
        await promises_1.default.unlink(original);
    }
    const empty = async (directory) => {
        for (const entry of await promises_1.default.readdir(directory, { withFileTypes: true }))
            if (entry.isDirectory())
                await empty(node_path_1.default.join(directory, entry.name));
        await promises_1.default.rmdir(directory).catch(error => {
            if (error.code !== 'ENOTEMPTY')
                throw error;
        });
    };
    if (node_fs_1.default.existsSync(legacy)) {
        await promises_1.default.unlink(node_path_1.default.join(legacy, '.coordination', 'revision')).catch(error => {
            if (!(0, log_files_1.isMissingLogFile)(error))
                throw error;
        });
        await empty(legacy);
    }
    await promises_1.default.unlink(migrationStatePath(vault));
}
function logStorageIsActive(vault) { return node_fs_1.default.existsSync(activatedPath(vault)); }
/** 同一 Vault 的迁移与取消共用租约，避免两个窗口争用同一暂存目录。 */
async function migrateLogStorage(vault, destination, preview) {
    const coordinator = new operation_journal_1.NodeFileOperationJournal({ directory: node_path_1.default.join(vault, '.tracekeeper', 'migration-control') });
    const release = await coordinator.acquireLock('log-storage-migration');
    try {
        const lockDirectory = logStorageIsActive(vault) ? logDirectory(vault) : node_path_1.default.join(vault, knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR);
        const storage = new operation_journal_1.NodeFileOperationJournal({ directory: lockDirectory });
        await storage.coordinate(() => migrateLogStorageOwned(vault, destination, preview));
        if (logStorageIsActive(vault)) {
            const legacy = node_path_1.default.join(vault, knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR);
            await promises_1.default.rmdir(node_path_1.default.join(legacy, '.coordination')).catch(error => { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code))
                throw error; });
            await promises_1.default.rmdir(legacy).catch(error => { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code))
                throw error; });
        }
    }
    finally {
        await release();
    }
}
async function cancelLogMigration(vault) {
    const coordinator = new operation_journal_1.NodeFileOperationJournal({ directory: node_path_1.default.join(vault, '.tracekeeper', 'migration-control') });
    const release = await coordinator.acquireLock('log-storage-migration');
    try {
        if (logStorageIsActive(vault))
            throw new Error('Activated storage cannot be cancelled; restore the whole Vault backup instead.');
        const raw = await (0, log_files_1.readLogFile)(vault, migrationStatePath(vault), 4096);
        if (raw === null)
            return;
        const state = JSON.parse(raw);
        if (state.version !== 1 || !/^[a-f0-9]{24}$/.test(state.token))
            throw new Error('Invalid migration ownership.');
        const manifestRaw = await (0, log_files_1.readLogFile)(state.backup, node_path_1.default.join(state.backup, 'backup.json'), 32 * 1024 * 1024);
        if (!manifestRaw)
            throw new Error('Migration backup is missing.');
        const manifest = JSON.parse(manifestRaw);
        const expected = new Map(manifest.files.filter(row => row.name.startsWith(knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR + '/')).map(row => [row.name.slice(knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR.length + 1), row.hash]));
        for (const directory of [node_path_1.default.join(vault, '.migration-staging', state.token), node_path_1.default.join(vault, exports.LOG_STORAGE_ROOT, 'data')]) {
            if (!node_fs_1.default.existsSync(directory))
                continue;
            const files = await inventory(directory);
            if (files.some(row => expected.get(row.name) !== row.hash))
                throw new Error('Staged files changed; cancellation requires inspection.');
            for (const row of files)
                await promises_1.default.unlink(node_path_1.default.join(directory, row.name));
            const removeEmpty = async (folder) => {
                for (const entry of await promises_1.default.readdir(folder, { withFileTypes: true }))
                    if (entry.isDirectory())
                        await removeEmpty(node_path_1.default.join(folder, entry.name));
                await promises_1.default.rmdir(folder);
            };
            await removeEmpty(directory);
        }
        await promises_1.default.rmdir(node_path_1.default.join(vault, exports.LOG_STORAGE_ROOT)).catch(error => {
            if (!(0, log_files_1.isMissingLogFile)(error))
                throw error;
        });
        await promises_1.default.unlink(migrationStatePath(vault));
    }
    finally {
        await release();
    }
}
/** 诊断导出只包含计数、状态和脱敏问题，不携带日志正文、密钥或本机 Vault 路径。 */
async function exportLogDiagnostics(vault, destination) {
    if (!node_path_1.default.isAbsolute(destination))
        throw new Error('Choose an absolute diagnostic file path.');
    await (0, log_files_1.assertLogPath)(node_path_1.default.dirname(destination), destination);
    const summary = await createVaultOperationJournal(vault).inspect();
    const handle = await promises_1.default.open(destination, 'wx', 0o600);
    try {
        await handle.writeFile(JSON.stringify({ schema_version: 1, created_at: new Date().toISOString(), log_storage: summary }, null, 2));
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
async function logBackupSummary(vault) {
    const raw = await (0, log_files_1.readLogFile)(vault, activatedPath(vault), 4096);
    let directory = raw ? JSON.parse(raw).backup : null;
    if (!directory) {
        const pending = await (0, log_files_1.readLogFile)(vault, migrationStatePath(vault), 4096);
        if (pending) {
            const state = JSON.parse(pending);
            if (state.version !== 1)
                throw new Error('Invalid migration metadata.');
            directory = state.backup;
        }
    }
    if (!directory)
        return { count: 0, bytes: 0, available: false };
    const backup = await (0, log_files_1.readLogFile)(directory, node_path_1.default.join(directory, 'backup.json'), 32 * 1024 * 1024);
    if (!backup)
        return { count: 1, bytes: 0, available: false, directory };
    const manifest = JSON.parse(backup);
    if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.some(file => !Number.isSafeInteger(file.bytes) || file.bytes < 0))
        throw new Error('Invalid backup metadata.');
    return { count: 1, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), available: true, directory };
}
function logMigrationPending(vault) { return node_fs_1.default.existsSync(migrationStatePath(vault)); }
