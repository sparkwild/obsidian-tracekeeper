import crypto from 'node:crypto';
import { computePayloadHash, OperationConflictError, type OperationFailureInjection, type OperationJournal, type OperationRecord } from '@tracekeeper/core';

interface SourceRequestExecutionPayload<TRequest> {
	kind: 'source-request-v2';
	request: TRequest;
	requestSnapshot: Record<string, unknown>;
	tool: string;
	now: string;
	step_values?: Record<string, { value: unknown; undefined: boolean }>;
}

/** 旧 Source 分析入口的执行身份与步骤结果；输出已落盘时只续作关系提交。 */
export class SourceRequestExecution<TRequest extends { path: string; status: string }> {
	private constructor(private readonly journal: OperationJournal, readonly record: OperationRecord, readonly payload: SourceRequestExecutionPayload<TRequest>, private readonly release: () => Promise<void>, private readonly failure?: OperationFailureInjection) {}
	static async begin<TRequest extends { path: string; status: string }>(input: { journal: OperationJournal; request: TRequest; args: Record<string, unknown>; tool: string; force: boolean; beforeNew: () => Promise<void>; recoveryId?: string; failure?: OperationFailureInjection }): Promise<SourceRequestExecution<TRequest>> {
		const release = await input.journal.acquireLock?.(`source-request:${computePayloadHash(input.request.path)}`) ?? (async () => {});
		try {
			const active = (await input.journal.listRecoverable()).filter((record) => {
				const payload = record.payload as Partial<SourceRequestExecutionPayload<TRequest>> | undefined;
				return payload?.kind === 'source-request-v2' && payload.request?.path === input.request.path;
			});
			if (active.length > 1) throw new OperationConflictError('Multiple unfinished Source analysis rounds.');
			const key = `source-request:${computePayloadHash({ request: { ...input.request, status: '' }, args: input.args, tool: input.tool })}${input.force ? `:${crypto.randomUUID()}` : ''}`;
			const existing = input.recoveryId ? await input.journal.loadById(input.recoveryId) : active[0] ?? await input.journal.loadByIdempotencyKey(key);
			if (existing) {
				const payload = existing.payload as SourceRequestExecutionPayload<TRequest>;
				const { step_values: _executionCache, ...identityPayload } = payload;
				if (computePayloadHash(identityPayload) !== existing.payload_hash) throw new OperationConflictError('Source execution identity is invalid.');
				if (payload?.kind !== 'source-request-v2' || payload.tool !== input.tool || computePayloadHash(payload.requestSnapshot) !== computePayloadHash(input.args) || computePayloadHash({ ...payload.request, status: '' }) !== computePayloadHash({ ...input.request, status: '' })) throw new OperationConflictError('Source analysis retry conflicts with the original request.');
				return new SourceRequestExecution(input.journal, existing, payload, release, input.failure);
			}
			if (input.recoveryId) throw new OperationConflictError('Source analysis recovery record is missing.');
			await input.beforeNew();
			const now = new Date().toISOString();
			const payload: SourceRequestExecutionPayload<TRequest> = { kind: 'source-request-v2', request: input.request, requestSnapshot: input.args, tool: input.tool, now };
			const record: OperationRecord = { operation_id: `source-request-${computePayloadHash(key).slice(0, 24)}`, idempotency_key: key, payload, payload_hash: computePayloadHash(payload), status: 'in_progress', created_at: now, updated_at: now, completed_steps: [] };
			await input.journal.save(record);
			return new SourceRequestExecution(input.journal, record, payload, release, input.failure);
		} catch (error) { await release(); throw error; }
	}
	async step<T>(name: string, action: () => Promise<T>): Promise<T> {
		const cache = this.payload.step_values ?? {};
		if (typeof cache !== 'object' || Array.isArray(cache)) throw new OperationConflictError('Source execution cache is invalid.');
		const completed = this.record.completed_steps.find((step) => step.name === name);
		if (completed) {
			const stored = cache[name];
			if (!stored || (completed.result as { cache_hash?: string })?.cache_hash !== computePayloadHash(stored)) throw new OperationConflictError('Source step result is missing or inconsistent.');
			return (stored.undefined ? undefined : stored.value) as T;
		}
		const event = { operationId: this.record.operation_id, idempotencyKey: this.record.idempotency_key, payloadHash: this.record.payload_hash, stepName: name };
		await this.failure?.({ ...event, phase: 'before_step' });
		const result = await action();
		const stored = { value: result === undefined ? null : result, undefined: result === undefined };
		cache[name] = stored;
		// 执行缓存加密保存在 payload 中；身份摘要排除缓存，进度锚点绑定每项摘要。
		this.payload.step_values = cache;
		this.record.payload = this.payload;
		this.record.completed_steps.push({ name, completed_at: new Date().toISOString(), result: { cache_hash: computePayloadHash(stored) } });
		this.record.updated_at = new Date().toISOString();
		await this.journal.save(this.record);
		await this.failure?.({ ...event, phase: 'after_step' });
		return result;
	}
	async run<T>(action: () => Promise<T>): Promise<T> {
		try {
			if (this.record.status === 'completed') return this.record.result as T;
			const result = await action();
			this.record.result = result; this.record.status = 'completed'; this.record.updated_at = new Date().toISOString();
			await this.journal.save(this.record);
			return result;
		} catch (error) {
			this.record.status = 'failed'; this.record.error = error instanceof Error ? error.message : 'Source analysis interrupted.';
			this.record.updated_at = new Date().toISOString(); await this.journal.save(this.record);
			throw error;
		} finally { await this.release(); }
	}
}
