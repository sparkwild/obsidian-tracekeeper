"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecoverableOperationRunner = exports.NodeFileOperationJournal = exports.CorruptedOperationJournalError = exports.OperationConflictError = void 0;
exports.computePayloadHash = computePayloadHash;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const OPERATION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const operationLocks = new Map();
class OperationConflictError extends Error {
    constructor(message) {
        super(message);
        this.name = 'OperationConflictError';
    }
}
exports.OperationConflictError = OperationConflictError;
class CorruptedOperationJournalError extends Error {
    constructor(operationId, message) {
        super(`Corrupted operation journal record for ${operationId}: ${message}`);
        this.name = 'CorruptedOperationJournalError';
    }
}
exports.CorruptedOperationJournalError = CorruptedOperationJournalError;
class NodeFileOperationJournal {
    constructor(options) {
        if (!node_path_1.default.isAbsolute(options.directory)) {
            throw new Error(`Operation journal directory must be an absolute path: ${options.directory}`);
        }
        this.directory = node_path_1.default.normalize(options.directory);
        this.lockWaitTimeoutMs = options.lockWaitTimeoutMs ?? 30000;
        if (!Number.isSafeInteger(this.lockWaitTimeoutMs) || this.lockWaitTimeoutMs <= 0) {
            throw new Error('Operation journal lockWaitTimeoutMs must be a positive safe integer.');
        }
    }
    ensureValidOperationId(operationId) {
        if (!OPERATION_ID_PATTERN.test(operationId)) {
            throw new Error(`Invalid operation id: ${operationId}`);
        }
    }
    recordPath(operationId) {
        this.ensureValidOperationId(operationId);
        return node_path_1.default.join(this.directory, `${operationId}.json`);
    }
    idempotencyReferencePath(idempotencyKey) {
        const keyHash = (0, node_crypto_1.createHash)('sha256').update(idempotencyKey).digest('hex');
        return node_path_1.default.join(this.directory, `.idempotency-${keyHash}.ref`);
    }
    idempotencyLockPath(idempotencyKey) {
        const keyHash = (0, node_crypto_1.createHash)('sha256').update(idempotencyKey).digest('hex');
        return node_path_1.default.join(this.directory, `.idempotency-${keyHash}.lock`);
    }
    async ensureDirectory() {
        await promises_1.default.mkdir(this.directory, { recursive: true });
    }
    parseOperationRecord(filePath, rawContent) {
        let parsed;
        try {
            parsed = JSON.parse(rawContent);
        }
        catch (error) {
            throw new CorruptedOperationJournalError(filePath, error instanceof Error ? error.message : 'invalid json');
        }
        if (!isPlainObject(parsed)) {
            throw new CorruptedOperationJournalError(filePath, 'record must be an object');
        }
        const record = parsed;
        if (typeof record.operation_id !== 'string' || !record.operation_id) {
            throw new CorruptedOperationJournalError(filePath, 'operation_id missing');
        }
        if (!OPERATION_ID_PATTERN.test(record.operation_id)) {
            throw new CorruptedOperationJournalError(filePath, `operation_id is invalid: ${record.operation_id}`);
        }
        if (typeof record.idempotency_key !== 'string' || !record.idempotency_key) {
            throw new CorruptedOperationJournalError(filePath, 'idempotency_key missing');
        }
        if (typeof record.payload_hash !== 'string' || !record.payload_hash) {
            throw new CorruptedOperationJournalError(filePath, 'payload_hash missing');
        }
        if (!isValidOperationStatus(record.status)) {
            throw new CorruptedOperationJournalError(filePath, `invalid status: ${record.status}`);
        }
        if (typeof record.created_at !== 'string' || !record.created_at) {
            throw new CorruptedOperationJournalError(filePath, 'created_at missing');
        }
        if (typeof record.updated_at !== 'string' || !record.updated_at) {
            throw new CorruptedOperationJournalError(filePath, 'updated_at missing');
        }
        if (!Array.isArray(record.completed_steps)) {
            throw new CorruptedOperationJournalError(filePath, 'completed_steps must be an array');
        }
        if (!record.completed_steps.every(isStepExecutionRecord)) {
            throw new CorruptedOperationJournalError(filePath, 'completed_steps entries must be StepExecutionRecord');
        }
        return {
            operation_id: record.operation_id,
            idempotency_key: record.idempotency_key,
            payload_hash: record.payload_hash,
            payload: record.payload,
            status: record.status,
            created_at: record.created_at,
            updated_at: record.updated_at,
            completed_steps: record.completed_steps.slice(),
            result: record.result,
            error: typeof record.error === 'string' ? record.error : undefined,
            failed_at: typeof record.failed_at === 'string' ? record.failed_at : undefined,
        };
    }
    async readRecord(recordPath) {
        try {
            const raw = await promises_1.default.readFile(recordPath, 'utf8');
            return this.parseOperationRecord(recordPath, raw);
        }
        catch (error) {
            if (error instanceof Error && error.code === 'ENOENT') {
                return null;
            }
            if (error instanceof CorruptedOperationJournalError) {
                throw error;
            }
            throw error;
        }
    }
    buildTempPath(recordPath) {
        const marker = `${Date.now()}-${(0, node_crypto_1.randomBytes)(4).toString('hex')}`;
        return `${recordPath}.${marker}.tmp`;
    }
    async acquireLock(idempotencyKey) {
        await this.ensureDirectory();
        const lockPath = this.idempotencyLockPath(idempotencyKey);
        const deadline = Date.now() + this.lockWaitTimeoutMs;
        while (true) {
            try {
                const handle = await promises_1.default.open(lockPath, 'wx');
                await handle.writeFile(`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`, 'utf8');
                let released = false;
                return async () => {
                    if (released) {
                        return;
                    }
                    released = true;
                    await handle.close().catch(() => undefined);
                    await promises_1.default.unlink(lockPath).catch(() => undefined);
                };
            }
            catch (error) {
                if (!isNodeErrorCode(error, 'EEXIST')) {
                    throw error;
                }
                if (await this.removeStaleLock(lockPath)) {
                    continue;
                }
                if (Date.now() >= deadline) {
                    throw new OperationConflictError(`Timed out waiting for the operation lock for idempotency key "${idempotencyKey}"`);
                }
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        }
    }
    async removeStaleLock(lockPath) {
        try {
            const raw = await promises_1.default.readFile(lockPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (typeof parsed.pid === 'number' && Number.isSafeInteger(parsed.pid) && isProcessAlive(parsed.pid)) {
                return false;
            }
            await promises_1.default.unlink(lockPath);
            return true;
        }
        catch (error) {
            if (isNodeErrorCode(error, 'ENOENT')) {
                return true;
            }
            return false;
        }
    }
    async loadById(operationId) {
        return this.readRecord(this.recordPath(operationId));
    }
    async loadByIdempotencyKey(idempotencyKey) {
        await this.ensureDirectory();
        const referencePath = this.idempotencyReferencePath(idempotencyKey);
        try {
            const operationId = (await promises_1.default.readFile(referencePath, 'utf8')).trim();
            if (!OPERATION_ID_PATTERN.test(operationId)) {
                throw new CorruptedOperationJournalError(referencePath, 'idempotency reference is invalid');
            }
            const referenced = await this.loadById(operationId);
            if (!referenced || referenced.idempotency_key !== idempotencyKey) {
                throw new CorruptedOperationJournalError(referencePath, 'idempotency reference does not match an operation record');
            }
            return referenced;
        }
        catch (error) {
            if (!(error instanceof Error) || error.code !== 'ENOENT') {
                throw error;
            }
        }
        const files = await promises_1.default.readdir(this.directory);
        let bestMatch = null;
        for (const file of files) {
            if (!file.endsWith('.json')) {
                continue;
            }
            const candidatePath = node_path_1.default.join(this.directory, file);
            const candidate = await this.readRecord(candidatePath);
            if (!candidate || candidate.idempotency_key !== idempotencyKey) {
                continue;
            }
            if (!bestMatch || new Date(candidate.updated_at).getTime() > new Date(bestMatch.updated_at).getTime()) {
                bestMatch = candidate;
            }
        }
        if (bestMatch) {
            await this.saveIdempotencyReference(bestMatch.idempotency_key, bestMatch.operation_id);
        }
        return bestMatch;
    }
    async saveIdempotencyReference(idempotencyKey, operationId) {
        this.ensureValidOperationId(operationId);
        const referencePath = this.idempotencyReferencePath(idempotencyKey);
        const tempPath = this.buildTempPath(referencePath);
        await promises_1.default.writeFile(tempPath, `${operationId}\n`, 'utf8');
        try {
            await promises_1.default.rename(tempPath, referencePath);
        }
        catch (error) {
            await promises_1.default.unlink(tempPath).catch(() => undefined);
            throw error;
        }
    }
    async claim(record) {
        await this.ensureDirectory();
        const recordPath = this.recordPath(record.operation_id);
        const recordTempPath = this.buildTempPath(recordPath);
        const payload = `${JSON.stringify(record, null, 2)}\n`;
        await promises_1.default.writeFile(recordTempPath, payload, 'utf8');
        try {
            await promises_1.default.link(recordTempPath, recordPath);
        }
        catch (error) {
            await promises_1.default.unlink(recordTempPath).catch(() => undefined);
            if (isNodeErrorCode(error, 'EEXIST')) {
                return false;
            }
            throw error;
        }
        await promises_1.default.unlink(recordTempPath).catch(() => undefined);
        const referencePath = this.idempotencyReferencePath(record.idempotency_key);
        const referenceTempPath = this.buildTempPath(referencePath);
        await promises_1.default.writeFile(referenceTempPath, `${record.operation_id}\n`, 'utf8');
        try {
            await promises_1.default.link(referenceTempPath, referencePath);
            return true;
        }
        catch (error) {
            if (isNodeErrorCode(error, 'EEXIST')) {
                await promises_1.default.unlink(recordPath).catch(() => undefined);
                return false;
            }
            await promises_1.default.unlink(recordPath).catch(() => undefined);
            throw error;
        }
        finally {
            await promises_1.default.unlink(referenceTempPath).catch(() => undefined);
        }
    }
    async listRecoverable() {
        await this.ensureDirectory();
        const files = await promises_1.default.readdir(this.directory);
        const records = [];
        for (const file of files) {
            if (!file.endsWith('.json')) {
                continue;
            }
            const record = await this.readRecord(node_path_1.default.join(this.directory, file));
            if (record && record.status !== 'completed') {
                records.push(record);
            }
        }
        return records.sort((left, right) => left.created_at.localeCompare(right.created_at));
    }
    async save(record) {
        await this.ensureDirectory();
        const recordPath = this.recordPath(record.operation_id);
        const tempPath = this.buildTempPath(recordPath);
        const payload = JSON.stringify(record, null, 2);
        await promises_1.default.writeFile(tempPath, `${payload}\n`, 'utf8');
        try {
            await promises_1.default.rename(tempPath, recordPath);
        }
        catch (error) {
            await promises_1.default.unlink(tempPath).catch(() => undefined);
            throw error;
        }
        await this.saveIdempotencyReference(record.idempotency_key, record.operation_id);
    }
}
exports.NodeFileOperationJournal = NodeFileOperationJournal;
function computePayloadHash(payload) {
    const serialized = JSON.stringify(normalizePayload(payload));
    return (0, node_crypto_1.createHash)('sha256').update(serialized).digest('hex');
}
class RecoverableOperationRunner {
    constructor(config) {
        this.config = config;
    }
    async injectFailure(context) {
        if (!this.config.failureInjection) {
            return;
        }
        await this.config.failureInjection(context);
    }
    completedStepSet(record) {
        return new Set(record.completed_steps.map((entry) => entry.name));
    }
    now() {
        return this.config.clock ? this.config.clock() : new Date().toISOString();
    }
    async withFailureContext(phase, stepName, operationId, payloadHash, run) {
        await this.injectFailure({
            operationId,
            idempotencyKey: this.config.idempotencyKey,
            payloadHash,
            stepName,
            phase,
        });
        return run();
    }
    markFailed(record, error) {
        return {
            ...record,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            failed_at: this.now(),
            updated_at: this.now(),
        };
    }
    markCompleted(record, result) {
        return {
            ...record,
            status: 'completed',
            result,
            updated_at: this.now(),
            error: undefined,
            failed_at: undefined,
        };
    }
    markStepCompleted(record, stepName) {
        return {
            ...record,
            completed_steps: [...record.completed_steps, { name: stepName, completed_at: this.now() }],
            updated_at: this.now(),
            error: undefined,
            failed_at: undefined,
        };
    }
    markRunning(record) {
        return {
            ...record,
            status: 'in_progress',
            error: undefined,
            failed_at: undefined,
            updated_at: this.now(),
        };
    }
    async run() {
        const lock = acquireOperationLock(this.config.idempotencyKey);
        let releaseJournalLock = null;
        let isCompleted = false;
        let recordOwned = false;
        let record = null;
        try {
            await lock.previous;
            if (this.config.journal.acquireLock) {
                releaseJournalLock = await this.config.journal.acquireLock(this.config.idempotencyKey);
            }
            const payloadHash = computePayloadHash(this.config.payload);
            let existing = await this.config.journal.loadByIdempotencyKey(this.config.idempotencyKey);
            if (existing) {
                if (existing.operation_id !== this.config.operationId) {
                    throw new OperationConflictError(`Idempotency key conflict for "${this.config.idempotencyKey}": associated with existing operation "${existing.operation_id}"`);
                }
                if (existing.payload_hash !== payloadHash) {
                    throw new OperationConflictError(`Idempotency key conflict for "${this.config.idempotencyKey}" with different payload hash`);
                }
                record = existing;
                if (record.status === 'completed') {
                    if (!('result' in record)) {
                        throw new CorruptedOperationJournalError(record.operation_id, 'completed operation record is missing result');
                    }
                    return record.result;
                }
                recordOwned = true;
                record = this.markRunning(record);
            }
            else {
                record = {
                    operation_id: this.config.operationId,
                    idempotency_key: this.config.idempotencyKey,
                    payload_hash: payloadHash,
                    payload: normalizePayload(this.config.payload),
                    status: 'in_progress',
                    created_at: this.now(),
                    updated_at: this.now(),
                    completed_steps: [],
                };
                if (this.config.journal.claim) {
                    const claimed = await this.config.journal.claim(record);
                    recordOwned = claimed;
                    if (!claimed) {
                        existing = await this.loadClaimedRecord();
                        if (!existing) {
                            throw new OperationConflictError(`Idempotency key "${this.config.idempotencyKey}" was claimed by another process`);
                        }
                        if (existing.operation_id !== this.config.operationId || existing.payload_hash !== payloadHash) {
                            throw new OperationConflictError(`Idempotency key conflict for "${this.config.idempotencyKey}" with another operation or payload`);
                        }
                        record = existing;
                        if (record.status === 'completed') {
                            if (!('result' in record)) {
                                throw new CorruptedOperationJournalError(record.operation_id, 'completed operation record is missing result');
                            }
                            return record.result;
                        }
                        recordOwned = true;
                        record = this.markRunning(record);
                    }
                }
                else {
                    recordOwned = true;
                }
            }
            await this.config.journal.save(record);
            const completedSteps = this.completedStepSet(record);
            for (const step of this.config.steps) {
                if (completedSteps.has(step.name)) {
                    continue;
                }
                await this.withFailureContext('before_step', step.name, record.operation_id, payloadHash, async () => Promise.resolve());
                await step.execute(this.config.payload);
                record = this.markStepCompleted(record, step.name);
                completedSteps.add(step.name);
                await this.config.journal.save(record);
                await this.withFailureContext('after_step', step.name, record.operation_id, payloadHash, async () => Promise.resolve());
            }
            await this.withFailureContext('before_finalize', undefined, record.operation_id, payloadHash, async () => Promise.resolve());
            const result = await Promise.resolve(this.config.finalize(this.config.payload, completedSteps));
            record = this.markCompleted(record, result);
            await this.config.journal.save(record);
            isCompleted = true;
            await this.withFailureContext('after_finalize', undefined, record.operation_id, payloadHash, async () => Promise.resolve());
            return result;
        }
        catch (error) {
            if (!isCompleted && recordOwned && record !== null) {
                const failedRecord = this.markFailed(record, error);
                record = failedRecord;
                await this.config.journal.save(failedRecord);
            }
            throw error;
        }
        finally {
            if (releaseJournalLock) {
                await releaseJournalLock();
            }
            lock.release();
            if (operationLocks.get(this.config.idempotencyKey) === lock.chain) {
                operationLocks.delete(this.config.idempotencyKey);
            }
        }
    }
    async loadClaimedRecord() {
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const byId = await this.config.journal.loadById(this.config.operationId);
            if (byId) {
                return byId;
            }
            const byKey = await this.config.journal.loadByIdempotencyKey(this.config.idempotencyKey);
            if (byKey) {
                return byKey;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return null;
    }
}
exports.RecoverableOperationRunner = RecoverableOperationRunner;
function acquireOperationLock(operationId) {
    const previous = operationLocks.get(operationId) ?? Promise.resolve();
    let release = () => undefined;
    const next = new Promise((resolve) => {
        release = resolve;
    });
    const chain = previous.then(() => next);
    operationLocks.set(operationId, chain);
    return {
        previous,
        release,
        chain,
    };
}
function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
}
function isValidOperationStatus(value) {
    return value === 'in_progress' || value === 'completed' || value === 'failed';
}
function isStepExecutionRecord(value) {
    if (!isPlainObject(value)) {
        return false;
    }
    return typeof value.name === 'string' && Boolean(value.name) && typeof value.completed_at === 'string';
}
function isNodeErrorCode(error, code) {
    return error instanceof Error && error.code === code;
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return !isNodeErrorCode(error, 'ESRCH');
    }
}
function normalizePayload(value) {
    if (value === null) {
        return null;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'bigint' || typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
        return String(value);
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        return value.map((item) => normalizePayload(item));
    }
    if (isPlainObject(value)) {
        const keys = Object.keys(value).sort();
        const normalized = {};
        for (const key of keys) {
            normalized[key] = normalizePayload(value[key]);
        }
        return normalized;
    }
    if (ArrayBuffer.isView(value)) {
        return Array.from(new Uint8Array(value.buffer));
    }
    if (value instanceof ArrayBuffer) {
        return Array.from(new Uint8Array(value));
    }
    return String(value);
}
