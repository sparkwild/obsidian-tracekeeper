"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourceRequestExecution = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const core_1 = require("@tracekeeper/core");
/** 旧 Source 分析入口的执行身份与步骤结果；输出已落盘时只续作关系提交。 */
class SourceRequestExecution {
    constructor(journal, record, payload, release, failure) {
        this.journal = journal;
        this.record = record;
        this.payload = payload;
        this.release = release;
        this.failure = failure;
    }
    static async begin(input) {
        const release = await input.journal.acquireLock?.(`source-request:${(0, core_1.computePayloadHash)(input.request.path)}`) ?? (async () => { });
        try {
            const active = (await input.journal.listRecoverable()).filter((record) => {
                const payload = record.payload;
                return payload?.kind === 'source-request-v2' && payload.request?.path === input.request.path;
            });
            if (active.length > 1)
                throw new core_1.OperationConflictError('Multiple unfinished Source analysis rounds.');
            const key = `source-request:${(0, core_1.computePayloadHash)({ request: { ...input.request, status: '' }, args: input.args, tool: input.tool })}${input.force ? `:${node_crypto_1.default.randomUUID()}` : ''}`;
            const existing = input.recoveryId ? await input.journal.loadById(input.recoveryId) : active[0] ?? await input.journal.loadByIdempotencyKey(key);
            if (existing) {
                const payload = existing.payload;
                const { step_values: _executionCache, ...identityPayload } = payload;
                if ((0, core_1.computePayloadHash)(identityPayload) !== existing.payload_hash)
                    throw new core_1.OperationConflictError('Source execution identity is invalid.');
                if (payload?.kind !== 'source-request-v2' || payload.tool !== input.tool || (0, core_1.computePayloadHash)(payload.requestSnapshot) !== (0, core_1.computePayloadHash)(input.args) || (0, core_1.computePayloadHash)({ ...payload.request, status: '' }) !== (0, core_1.computePayloadHash)({ ...input.request, status: '' }))
                    throw new core_1.OperationConflictError('Source analysis retry conflicts with the original request.');
                return new SourceRequestExecution(input.journal, existing, payload, release, input.failure);
            }
            if (input.recoveryId)
                throw new core_1.OperationConflictError('Source analysis recovery record is missing.');
            await input.beforeNew();
            const now = new Date().toISOString();
            const payload = { kind: 'source-request-v2', request: input.request, requestSnapshot: input.args, tool: input.tool, now };
            const record = { operation_id: `source-request-${(0, core_1.computePayloadHash)(key).slice(0, 24)}`, idempotency_key: key, payload, payload_hash: (0, core_1.computePayloadHash)(payload), status: 'in_progress', created_at: now, updated_at: now, completed_steps: [] };
            await input.journal.save(record);
            return new SourceRequestExecution(input.journal, record, payload, release, input.failure);
        }
        catch (error) {
            await release();
            throw error;
        }
    }
    async step(name, action) {
        const cache = this.payload.step_values ?? {};
        if (typeof cache !== 'object' || Array.isArray(cache))
            throw new core_1.OperationConflictError('Source execution cache is invalid.');
        const completed = this.record.completed_steps.find((step) => step.name === name);
        if (completed) {
            const stored = cache[name];
            if (!stored || completed.result?.cache_hash !== (0, core_1.computePayloadHash)(stored))
                throw new core_1.OperationConflictError('Source step result is missing or inconsistent.');
            return (stored.undefined ? undefined : stored.value);
        }
        const event = { operationId: this.record.operation_id, idempotencyKey: this.record.idempotency_key, payloadHash: this.record.payload_hash, stepName: name };
        await this.failure?.({ ...event, phase: 'before_step' });
        const result = await action();
        const stored = { value: result === undefined ? null : result, undefined: result === undefined };
        cache[name] = stored;
        // 执行缓存加密保存在 payload 中；身份摘要排除缓存，进度锚点绑定每项摘要。
        this.payload.step_values = cache;
        this.record.payload = this.payload;
        this.record.completed_steps.push({ name, completed_at: new Date().toISOString(), result: { cache_hash: (0, core_1.computePayloadHash)(stored) } });
        this.record.updated_at = new Date().toISOString();
        await this.journal.save(this.record);
        await this.failure?.({ ...event, phase: 'after_step' });
        return result;
    }
    async run(action) {
        try {
            if (this.record.status === 'completed')
                return this.record.result;
            const result = await action();
            this.record.result = result;
            this.record.status = 'completed';
            this.record.updated_at = new Date().toISOString();
            await this.journal.save(this.record);
            return result;
        }
        catch (error) {
            this.record.status = 'failed';
            this.record.error = error instanceof Error ? error.message : 'Source analysis interrupted.';
            this.record.updated_at = new Date().toISOString();
            await this.journal.save(this.record);
            throw error;
        }
        finally {
            await this.release();
        }
    }
}
exports.SourceRequestExecution = SourceRequestExecution;
