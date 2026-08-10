"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecoverableOperationRunner = exports.NodeFileOperationJournal = exports.CorruptedOperationJournalError = exports.OperationConflictError = void 0;
exports.computePayloadHash = computePayloadHash;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const promises_2 = require("node:timers/promises");
const node_crypto_1 = require("node:crypto");
const OPERATION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_PERSISTED_STEP_RESULT_BYTES = 16 * 1024;
const MAX_PERSISTED_ERROR_BYTES = 512;
const MAX_CORRUPT_LOCK_GRACE_MS = 250;
const ENCRYPTED_PAYLOAD_VERSION = 1;
const PROGRESS_ANCHOR_VERSION = 1;
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
        this.payloadKeyPromise = null;
        if (!node_path_1.default.isAbsolute(options.directory)) {
            throw new Error(`Operation journal directory must be an absolute path: ${options.directory}`);
        }
        this.directory = node_path_1.default.normalize(options.directory);
        this.lockWaitTimeoutMs = options.lockWaitTimeoutMs ?? 30000;
        if (!Number.isSafeInteger(this.lockWaitTimeoutMs) || this.lockWaitTimeoutMs <= 0) {
            throw new Error('Operation journal lockWaitTimeoutMs must be a positive safe integer.');
        }
        this.corruptLockGraceMs = Math.min(MAX_CORRUPT_LOCK_GRACE_MS, Math.max(1, Math.floor(this.lockWaitTimeoutMs / 2)));
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
    payloadKeyPath() {
        return node_path_1.default.join(this.directory, '.payload-encryption-key');
    }
    progressAnchorPath(operationId) {
        this.ensureValidOperationId(operationId);
        return node_path_1.default.join(this.directory, `.progress-${operationId}.anchor`);
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
    async parseOperationRecord(filePath, rawContent) {
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
        const normalizedStatus = normalizePersistedOperationStatus(record.status);
        if (!isValidOperationStatus(normalizedStatus)) {
            throw new CorruptedOperationJournalError(filePath, `invalid status: ${formatUnknownValue(record.status)}`);
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
        if (hasOwnProperty(record, 'payload') && hasOwnProperty(record, 'payload_encrypted')) {
            throw new CorruptedOperationJournalError(filePath, 'record must not contain both payload and payload_encrypted');
        }
        if (hasOwnProperty(record, 'result') && hasOwnProperty(record, 'result_encrypted')) {
            throw new CorruptedOperationJournalError(filePath, 'record must not contain both result and result_encrypted');
        }
        validateParsedOperationRecordInvariants(record, filePath);
        let payload = record.payload;
        if (hasOwnProperty(record, 'payload_encrypted')) {
            payload = await this.decryptOperationValue(record, 'payload_encrypted', 'payload', filePath);
        }
        let result = record.result;
        if (hasOwnProperty(record, 'result_encrypted')) {
            result = await this.decryptOperationValue(record, 'result_encrypted', 'result', filePath);
        }
        const operationRecord = {
            operation_id: record.operation_id,
            idempotency_key: record.idempotency_key,
            payload_hash: record.payload_hash,
            payload,
            status: normalizedStatus,
            created_at: record.created_at,
            updated_at: record.updated_at,
            completed_steps: record.completed_steps.map(cloneStepExecutionRecord),
            error: typeof record.error === 'string' ? sanitizeJournalError(record.error) : undefined,
            failed_at: typeof record.failed_at === 'string' ? record.failed_at : undefined,
        };
        if (hasOwnProperty(record, 'result') || hasOwnProperty(record, 'result_encrypted')) {
            operationRecord.result = result;
        }
        return operationRecord;
    }
    async readRecord(recordPath) {
        try {
            const raw = await promises_1.default.readFile(recordPath, 'utf8');
            const record = await this.parseOperationRecord(recordPath, raw);
            return await this.verifyProgressAnchor(record);
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
    async payloadKey() {
        if (!this.payloadKeyPromise) {
            this.payloadKeyPromise = this.loadOrCreatePayloadKey();
        }
        return this.payloadKeyPromise;
    }
    async loadOrCreatePayloadKey() {
        await this.ensureDirectory();
        const keyPath = this.payloadKeyPath();
        const created = (0, node_crypto_1.randomBytes)(32);
        try {
            await promises_1.default.writeFile(keyPath, `${created.toString('base64')}\n`, {
                encoding: 'utf8',
                flag: 'wx',
                mode: 0o600,
            });
            return created;
        }
        catch (error) {
            if (!isNodeErrorCode(error, 'EEXIST')) {
                throw error;
            }
        }
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const encoded = (await promises_1.default.readFile(keyPath, 'utf8')).trim();
            const key = Buffer.from(encoded, 'base64');
            if (key.length === 32 && key.toString('base64') === encoded) {
                await promises_1.default.chmod(keyPath, 0o600).catch(() => undefined);
                return key;
            }
            await (0, promises_2.setTimeout)(10);
        }
        throw new CorruptedOperationJournalError(keyPath, 'payload encryption key is invalid');
    }
    operationValueAdditionalData(record, kind) {
        return Buffer.from(`${record.operation_id}\0${record.idempotency_key}\0${record.payload_hash}\0${kind}`, 'utf8');
    }
    async encryptOperationValue(record, value, kind) {
        const key = await this.payloadKey();
        const nonce = (0, node_crypto_1.randomBytes)(12);
        const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', key, nonce);
        cipher.setAAD(this.operationValueAdditionalData(record, kind));
        const plaintext = Buffer.from(JSON.stringify(normalizePayload(value)), 'utf8');
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return {
            version: ENCRYPTED_PAYLOAD_VERSION,
            algorithm: 'aes-256-gcm',
            nonce: nonce.toString('base64'),
            auth_tag: cipher.getAuthTag().toString('base64'),
            ciphertext: ciphertext.toString('base64'),
        };
    }
    async decryptOperationValue(record, field, kind, filePath) {
        const encrypted = record[field];
        if (!isEncryptedOperationPayload(encrypted)) {
            throw new CorruptedOperationJournalError(filePath, `${field} is invalid`);
        }
        try {
            const key = await this.payloadKey();
            const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', key, Buffer.from(encrypted.nonce, 'base64'));
            decipher.setAAD(this.operationValueAdditionalData({
                operation_id: record.operation_id,
                idempotency_key: record.idempotency_key,
                payload_hash: record.payload_hash,
            }, kind));
            decipher.setAuthTag(Buffer.from(encrypted.auth_tag, 'base64'));
            const plaintext = Buffer.concat([
                decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
                decipher.final(),
            ]).toString('utf8');
            return JSON.parse(plaintext);
        }
        catch (error) {
            throw new CorruptedOperationJournalError(filePath, error instanceof Error ? `encrypted payload authentication failed: ${error.message}` : 'encrypted payload authentication failed');
        }
    }
    async persistedRecord(record) {
        const prepared = prepareOperationRecordForPersistence(record);
        const persisted = { ...prepared };
        if (hasOwnProperty(prepared, 'payload')) {
            persisted.payload_encrypted = await this.encryptOperationValue(prepared, prepared.payload, 'payload');
            delete persisted.payload;
        }
        if (hasOwnProperty(prepared, 'result')) {
            persisted.result_encrypted = await this.encryptOperationValue(prepared, prepared.result, 'result');
            delete persisted.result;
        }
        return persisted;
    }
    terminalStatus(record) {
        return record.status === 'completed' || record.status === 'conflicted'
            ? record.status
            : null;
    }
    completedStepsHash(record) {
        return (0, node_crypto_1.createHash)('sha256')
            .update(JSON.stringify(record.completed_steps.map(cloneStepExecutionRecord)))
            .digest('hex');
    }
    anchorBinding(anchor) {
        return JSON.stringify({
            version: anchor.version,
            operation_id: anchor.operation_id,
            payload_hash: anchor.payload_hash,
            completed_step_count: anchor.completed_step_count,
            completed_steps_hash: anchor.completed_steps_hash,
            completed_steps: anchor.completed_steps.map(cloneStepExecutionRecord),
            terminal_status: anchor.terminal_status,
        });
    }
    async buildProgressAnchor(record) {
        const unsigned = {
            version: PROGRESS_ANCHOR_VERSION,
            operation_id: record.operation_id,
            payload_hash: record.payload_hash,
            completed_step_count: record.completed_steps.length,
            completed_steps_hash: this.completedStepsHash(record),
            completed_steps: record.completed_steps.map(cloneStepExecutionRecord),
            terminal_status: this.terminalStatus(record),
        };
        const key = await this.payloadKey();
        return {
            ...unsigned,
            mac: (0, node_crypto_1.createHmac)('sha256', key).update(this.anchorBinding(unsigned)).digest('hex'),
        };
    }
    async saveProgressAnchor(record) {
        const anchorPath = this.progressAnchorPath(record.operation_id);
        const tempPath = this.buildTempPath(anchorPath);
        const anchor = await this.buildProgressAnchor(record);
        await promises_1.default.writeFile(tempPath, `${JSON.stringify(anchor, null, 2)}\n`, 'utf8');
        try {
            await promises_1.default.rename(tempPath, anchorPath);
        }
        catch (error) {
            await promises_1.default.unlink(tempPath).catch(() => undefined);
            throw error;
        }
    }
    async verifyProgressAnchor(record) {
        const anchorPath = this.progressAnchorPath(record.operation_id);
        let parsed;
        try {
            parsed = JSON.parse(await promises_1.default.readFile(anchorPath, 'utf8'));
        }
        catch (error) {
            if (isNodeErrorCode(error, 'ENOENT')) {
                await this.saveProgressAnchor(record);
                return record;
            }
            throw new CorruptedOperationJournalError(anchorPath, error instanceof Error ? error.message : 'invalid progress anchor');
        }
        if (!isOperationProgressAnchor(parsed)) {
            throw new CorruptedOperationJournalError(anchorPath, 'progress anchor is invalid');
        }
        const key = await this.payloadKey();
        const { mac, ...unsigned } = parsed;
        const expected = (0, node_crypto_1.createHmac)('sha256', key).update(this.anchorBinding(unsigned)).digest();
        const received = Buffer.from(mac, 'hex');
        if (received.length !== expected.length || !(0, node_crypto_1.timingSafeEqual)(received, expected)) {
            throw new CorruptedOperationJournalError(anchorPath, 'progress anchor authentication failed');
        }
        if (parsed.operation_id !== record.operation_id || parsed.payload_hash !== record.payload_hash) {
            throw new CorruptedOperationJournalError(anchorPath, 'progress anchor binding does not match the record');
        }
        const currentStepCount = record.completed_steps.length;
        const currentStepsHash = this.completedStepsHash(record);
        if (parsed.terminal_status !== null && parsed.terminal_status !== this.terminalStatus(record)) {
            throw new CorruptedOperationJournalError(record.operation_id, 'durable operation progress regressed');
        }
        if (parsed.completed_step_count > currentStepCount
            || (parsed.completed_step_count === currentStepCount
                && parsed.completed_steps_hash !== currentStepsHash)) {
            return {
                ...record,
                completed_steps: parsed.completed_steps.map(cloneStepExecutionRecord),
            };
        }
        if (parsed.completed_step_count < currentStepCount
            || parsed.terminal_status !== this.terminalStatus(record)) {
            await this.saveProgressAnchor(record);
        }
        return record;
    }
    assertMonotonicProgress(current, next) {
        if (current.operation_id !== next.operation_id
            || current.idempotency_key !== next.idempotency_key
            || current.payload_hash !== next.payload_hash
            || current.created_at !== next.created_at) {
            throw new CorruptedOperationJournalError(next.operation_id, 'operation identity changed during save');
        }
        if (next.completed_steps.length < current.completed_steps.length) {
            throw new CorruptedOperationJournalError(next.operation_id, 'durable operation progress regressed');
        }
        for (let index = 0; index < current.completed_steps.length; index += 1) {
            if (JSON.stringify(cloneStepExecutionRecord(current.completed_steps[index]))
                !== JSON.stringify(cloneStepExecutionRecord(next.completed_steps[index]))) {
                throw new CorruptedOperationJournalError(next.operation_id, 'durable operation progress changed');
            }
        }
        if (this.terminalStatus(current) !== null && this.terminalStatus(current) !== this.terminalStatus(next)) {
            throw new CorruptedOperationJournalError(next.operation_id, 'terminal operation status regressed');
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
                await (0, promises_2.setTimeout)(25);
            }
        }
    }
    async removeStaleLock(lockPath) {
        let raw;
        try {
            raw = await promises_1.default.readFile(lockPath, 'utf8');
        }
        catch (error) {
            return isNodeErrorCode(error, 'ENOENT');
        }
        try {
            const parsed = JSON.parse(raw);
            if (isPlainObject(parsed)
                && typeof parsed.pid === 'number'
                && Number.isSafeInteger(parsed.pid)
                && parsed.pid > 0
                && isProcessAlive(parsed.pid)) {
                return false;
            }
            if (!isPlainObject(parsed)
                || typeof parsed.pid !== 'number'
                || !Number.isSafeInteger(parsed.pid)
                || parsed.pid <= 0) {
                return this.removeCorruptLockAfterGrace(lockPath);
            }
            await promises_1.default.unlink(lockPath);
            return true;
        }
        catch (error) {
            if (isNodeErrorCode(error, 'ENOENT')) {
                return true;
            }
            if (error instanceof SyntaxError) {
                return this.removeCorruptLockAfterGrace(lockPath);
            }
            return false;
        }
    }
    async removeCorruptLockAfterGrace(lockPath) {
        try {
            const stats = await promises_1.default.stat(lockPath);
            if (Date.now() - stats.mtimeMs < this.corruptLockGraceMs) {
                return false;
            }
            await promises_1.default.unlink(lockPath);
            return true;
        }
        catch (error) {
            return isNodeErrorCode(error, 'ENOENT');
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
        const payload = `${JSON.stringify(await this.persistedRecord(record), null, 2)}\n`;
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
        try {
            await this.saveProgressAnchor(record);
        }
        catch (error) {
            await promises_1.default.unlink(recordPath).catch(() => undefined);
            await promises_1.default.unlink(this.progressAnchorPath(record.operation_id)).catch(() => undefined);
            throw error;
        }
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
                await promises_1.default.unlink(this.progressAnchorPath(record.operation_id)).catch(() => undefined);
                return false;
            }
            await promises_1.default.unlink(recordPath).catch(() => undefined);
            await promises_1.default.unlink(this.progressAnchorPath(record.operation_id)).catch(() => undefined);
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
            if (record && record.status !== 'completed' && record.status !== 'conflicted') {
                records.push(record);
            }
        }
        return records.sort((left, right) => left.created_at.localeCompare(right.created_at));
    }
    async save(record) {
        await this.ensureDirectory();
        const recordPath = this.recordPath(record.operation_id);
        const current = await this.readRecord(recordPath);
        if (current) {
            this.assertMonotonicProgress(current, record);
        }
        const tempPath = this.buildTempPath(recordPath);
        const payload = JSON.stringify(await this.persistedRecord(record), null, 2);
        await promises_1.default.writeFile(tempPath, `${payload}\n`, 'utf8');
        try {
            await promises_1.default.rename(tempPath, recordPath);
        }
        catch (error) {
            await promises_1.default.unlink(tempPath).catch(() => undefined);
            throw error;
        }
        await this.saveProgressAnchor(record);
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
        const stepNames = new Set();
        for (const step of config.steps) {
            if (!step.name || stepNames.has(step.name)) {
                throw new Error('Recoverable operation step names must be non-empty and unique.');
            }
            stepNames.add(step.name);
        }
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
    stepContext(record) {
        return {
            completedSteps: record.completed_steps.map(cloneStepExecutionRecord),
        };
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
    markFailed(record, error, status = 'failed') {
        return {
            ...record,
            status,
            error: sanitizeJournalError(error),
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
    markStepCompleted(record, stepName, result, persistResult) {
        const stepRecord = {
            name: stepName,
            completed_at: this.now(),
        };
        if (persistResult) {
            stepRecord.result = normalizePersistedStepResult(result);
        }
        return {
            ...record,
            status: 'in_progress',
            completed_steps: [...record.completed_steps, stepRecord],
            updated_at: this.now(),
            error: undefined,
            failed_at: undefined,
        };
    }
    failureStatusForStep(step, error) {
        const configured = typeof step.failureStatus === 'function'
            ? step.failureStatus(error)
            : step.failureStatus;
        if (configured === undefined) {
            return 'failed';
        }
        if (!isValidOperationFailureStatus(configured)) {
            throw new Error(`Invalid operation failure status selected for step "${step.name}".`);
        }
        return configured;
    }
    markActivityPending(record) {
        return {
            ...record,
            status: 'activity_pending',
            error: undefined,
            failed_at: undefined,
            updated_at: this.now(),
        };
    }
    validateRecordForRun(record) {
        const seen = new Set();
        for (let index = 0; index < record.completed_steps.length; index += 1) {
            const completedStep = record.completed_steps[index];
            const configuredStep = this.config.steps[index];
            if (seen.has(completedStep.name)
                || configuredStep === undefined
                || completedStep.name !== configuredStep.name) {
                throw new CorruptedOperationJournalError(record.operation_id, 'completed_steps must be a unique ordered prefix of configured steps');
            }
            seen.add(completedStep.name);
        }
        if (record.status === 'completed') {
            if (!hasOwnProperty(record, 'result')) {
                throw new CorruptedOperationJournalError(record.operation_id, 'completed operation record is missing result');
            }
            if (record.completed_steps.length !== this.config.steps.length) {
                throw new CorruptedOperationJournalError(record.operation_id, 'completed operation record does not contain every configured step');
            }
            return;
        }
        if (hasOwnProperty(record, 'result')) {
            throw new CorruptedOperationJournalError(record.operation_id, 'non-completed operation record must not contain result');
        }
    }
    throwIfTerminalConflict(record) {
        if (record.status !== 'conflicted') {
            return;
        }
        throw new OperationConflictError(record.error || `Operation "${record.operation_id}" is terminally conflicted.`);
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
        let failureStatus = 'failed';
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
                this.validateRecordForRun(record);
                if (record.status === 'completed') {
                    return record.result;
                }
                this.throwIfTerminalConflict(record);
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
                        this.validateRecordForRun(record);
                        if (record.status === 'completed') {
                            return record.result;
                        }
                        this.throwIfTerminalConflict(record);
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
                try {
                    if (step.failureStatus === 'activity_pending') {
                        failureStatus = 'activity_pending';
                        record = this.markActivityPending(record);
                        await this.config.journal.save(record);
                    }
                    await this.withFailureContext('before_step', step.name, record.operation_id, payloadHash, async () => Promise.resolve());
                    const stepResult = await step.execute(this.config.payload, this.stepContext(record));
                    const completedRecord = this.markStepCompleted(record, step.name, stepResult, step.persistResult === true);
                    await this.config.journal.save(completedRecord);
                    record = completedRecord;
                    completedSteps.add(step.name);
                }
                catch (error) {
                    failureStatus = this.failureStatusForStep(step, error);
                    throw error;
                }
                failureStatus = 'failed';
                await this.withFailureContext('after_step', step.name, record.operation_id, payloadHash, async () => Promise.resolve());
            }
            await this.withFailureContext('before_finalize', undefined, record.operation_id, payloadHash, async () => Promise.resolve());
            const result = await Promise.resolve(this.config.finalize(this.config.payload, completedSteps));
            const completedRecord = this.markCompleted(record, result);
            await this.config.journal.save(completedRecord);
            record = completedRecord;
            isCompleted = true;
            await this.withFailureContext('after_finalize', undefined, record.operation_id, payloadHash, async () => Promise.resolve());
            return result;
        }
        catch (error) {
            if (!isCompleted && recordOwned && record !== null) {
                const failedRecord = this.markFailed(record, error, failureStatus);
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
            await (0, promises_2.setTimeout)(10);
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
    return Boolean(value && typeof value === 'object' && Reflect.getPrototypeOf(value) === Object.prototype);
}
function isEncryptedOperationPayload(value) {
    if (!isPlainObject(value)) {
        return false;
    }
    if (value.version !== ENCRYPTED_PAYLOAD_VERSION
        || value.algorithm !== 'aes-256-gcm'
        || typeof value.nonce !== 'string'
        || typeof value.auth_tag !== 'string'
        || typeof value.ciphertext !== 'string') {
        return false;
    }
    try {
        return Buffer.from(value.nonce, 'base64').length === 12
            && Buffer.from(value.auth_tag, 'base64').length === 16
            && Buffer.from(value.ciphertext, 'base64').toString('base64') === value.ciphertext;
    }
    catch {
        return false;
    }
}
function isOperationProgressAnchor(value) {
    return isPlainObject(value)
        && value.version === PROGRESS_ANCHOR_VERSION
        && typeof value.operation_id === 'string'
        && OPERATION_ID_PATTERN.test(value.operation_id)
        && typeof value.payload_hash === 'string'
        && value.payload_hash.length > 0
        && typeof value.completed_step_count === 'number'
        && Number.isSafeInteger(value.completed_step_count)
        && value.completed_step_count >= 0
        && typeof value.completed_steps_hash === 'string'
        && /^[a-f0-9]{64}$/.test(value.completed_steps_hash)
        && Array.isArray(value.completed_steps)
        && value.completed_steps.every(isStepExecutionRecord)
        && value.completed_steps.length === value.completed_step_count
        && (value.terminal_status === null || value.terminal_status === 'completed' || value.terminal_status === 'conflicted')
        && typeof value.mac === 'string'
        && /^[a-f0-9]{64}$/.test(value.mac);
}
function isValidOperationStatus(value) {
    return value === 'in_progress'
        || value === 'activity_pending'
        || value === 'completed'
        || value === 'conflicted'
        || value === 'failed';
}
/**
 * One-time on-read migration for records written before Agent activity was
 * separated from user-facing operation receipts. The legacy spelling is not
 * accepted for new writes and is normalized before all invariants run.
 */
function normalizePersistedOperationStatus(value) {
    return value === 'audit_pending' ? 'activity_pending' : value;
}
function isValidOperationFailureStatus(value) {
    return value === 'activity_pending' || value === 'conflicted' || value === 'failed';
}
function isStepExecutionRecord(value) {
    if (!isPlainObject(value)) {
        return false;
    }
    if (typeof value.name !== 'string' || !value.name || typeof value.completed_at !== 'string') {
        return false;
    }
    if (hasOwnProperty(value, 'result')) {
        try {
            assertPersistedStepResultBound(value.result);
        }
        catch {
            return false;
        }
    }
    return true;
}
function validateParsedOperationRecordInvariants(record, filePath) {
    const hasResult = hasOwnProperty(record, 'result') || hasOwnProperty(record, 'result_encrypted');
    const hasError = hasOwnProperty(record, 'error');
    const hasFailedAt = hasOwnProperty(record, 'failed_at');
    if (record.status === 'completed') {
        if (!hasResult) {
            throw new CorruptedOperationJournalError(filePath, 'completed operation record is missing result');
        }
        if (hasError || hasFailedAt) {
            throw new CorruptedOperationJournalError(filePath, 'completed operation record must not contain failure metadata');
        }
    }
    else if (hasResult) {
        throw new CorruptedOperationJournalError(filePath, 'non-completed operation record must not contain result');
    }
    if (hasError && typeof record.error !== 'string') {
        throw new CorruptedOperationJournalError(filePath, 'error must be a string');
    }
    if (hasFailedAt && (typeof record.failed_at !== 'string' || !record.failed_at)) {
        throw new CorruptedOperationJournalError(filePath, 'failed_at must be a non-empty string');
    }
    if (record.status === 'in_progress' && (hasError || hasFailedAt)) {
        throw new CorruptedOperationJournalError(filePath, 'in_progress operation record must not contain failure metadata');
    }
    if ((record.status === 'failed' || record.status === 'conflicted')
        && (typeof record.error !== 'string'
            || !record.error
            || typeof record.failed_at !== 'string'
            || !record.failed_at)) {
        throw new CorruptedOperationJournalError(filePath, `${record.status} operation record requires error and failed_at`);
    }
    if (record.status === 'activity_pending' && hasError !== hasFailedAt) {
        throw new CorruptedOperationJournalError(filePath, 'activity_pending failure metadata must be complete when present');
    }
    const completedSteps = record.completed_steps;
    const completedNames = new Set();
    for (const step of completedSteps) {
        if (completedNames.has(step.name)) {
            throw new CorruptedOperationJournalError(filePath, 'completed_steps must not contain duplicate names');
        }
        completedNames.add(step.name);
    }
}
function hasOwnProperty(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function cloneStepExecutionRecord(record) {
    const clone = {
        name: record.name,
        completed_at: record.completed_at,
    };
    if (hasOwnProperty(record, 'result')) {
        clone.result = normalizePersistedStepResult(record.result);
    }
    return clone;
}
function prepareOperationRecordForPersistence(record) {
    if (record.status === 'completed' && !hasOwnProperty(record, 'result')) {
        throw new CorruptedOperationJournalError(record.operation_id, 'completed operation record is missing result');
    }
    if (record.status === 'completed' && record.result === undefined) {
        throw new CorruptedOperationJournalError(record.operation_id, 'completed operation result cannot be undefined');
    }
    const prepared = {
        ...record,
        completed_steps: record.completed_steps.map(cloneStepExecutionRecord),
    };
    if (typeof record.error === 'string') {
        prepared.error = sanitizeJournalError(record.error);
    }
    else {
        delete prepared.error;
    }
    if (typeof record.failed_at !== 'string') {
        delete prepared.failed_at;
    }
    if (!hasOwnProperty(record, 'result')) {
        delete prepared.result;
    }
    if (!isValidOperationStatus(prepared.status)) {
        throw new CorruptedOperationJournalError(record.operation_id, `invalid status: ${String(prepared.status)}`);
    }
    validateParsedOperationRecordInvariants(prepared, record.operation_id);
    return prepared;
}
function normalizePersistedStepResult(value) {
    let normalized;
    try {
        normalized = normalizePayload(value);
    }
    catch {
        throw new Error('Persisted operation step result must be JSON-serializable.');
    }
    assertPersistedStepResultBound(normalized);
    return normalized;
}
function assertPersistedStepResultBound(value) {
    let serialized;
    try {
        serialized = JSON.stringify(value);
    }
    catch {
        throw new Error('Persisted operation step result must be JSON-serializable.');
    }
    if (serialized === undefined
        || Buffer.byteLength(serialized, 'utf8') > MAX_PERSISTED_STEP_RESULT_BYTES) {
        throw new Error(`Persisted operation step result exceeds ${MAX_PERSISTED_STEP_RESULT_BYTES} bytes.`);
    }
}
function sanitizeJournalError(error) {
    const raw = error instanceof Error ? error.message : formatUnknownValue(error);
    const rawBytes = Buffer.byteLength(raw, 'utf8');
    if (rawBytes > MAX_PERSISTED_ERROR_BYTES) {
        const errorName = error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name)
            ? error.name
            : 'OperationError';
        return `${errorName}: message redacted (${rawBytes} bytes)`;
    }
    const sanitized = raw
        .replace(/(["'])\/[^"'\r\n]+\1/g, '$1[redacted-path]$1')
        .replace(/(^|[\s("'=:[{])\/(?:[^/\s)"'\],;:]+\/)*[^/\s)"'\],;:]*/g, '$1[redacted-path]')
        .replace(/(^|[\s("'=[{])[A-Za-z]:[\\/][^\s)"'\],;]*/g, '$1[redacted-path]')
        .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/(\b(?:password|passwd|secret|token|authorization|api[_-]?key|credential)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[redacted]')
        .replace(/\b[A-Fa-f0-9]{64,}\b/g, '[redacted-long-text]')
        .replace(/\b[A-Za-z0-9_-]{96,}\b/g, '[redacted-long-text]')
        .replace(/(["'])[^"'\r\n]{96,}\1/g, '$1[redacted-long-text]$1')
        .replace(/\s+/g, ' ')
        .trim();
    if (Buffer.byteLength(sanitized, 'utf8') > MAX_PERSISTED_ERROR_BYTES) {
        return `OperationError: message redacted (${rawBytes} bytes)`;
    }
    return sanitized || 'Operation failed.';
}
function formatUnknownValue(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (value === null
        || typeof value === 'number'
        || typeof value === 'boolean'
        || typeof value === 'bigint'
        || typeof value === 'undefined') {
        return String(value);
    }
    if (typeof value === 'symbol') {
        return value.description === undefined ? 'Symbol()' : `Symbol(${value.description})`;
    }
    if (typeof value === 'function') {
        return value.name ? `[Function ${value.name}]` : '[Function]';
    }
    return 'non-scalar value';
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
    if (typeof value === 'bigint'
        || typeof value === 'undefined'
        || typeof value === 'function'
        || typeof value === 'symbol') {
        return formatUnknownValue(value);
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
    throw new TypeError('Operation payload contains an unsupported object value.');
}
