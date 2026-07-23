import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const OPERATION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const operationLocks = new Map<string, Promise<void>>();

export type OperationPhase = 'before_step' | 'after_step' | 'before_finalize' | 'after_finalize';

export type OperationStatus = 'in_progress' | 'completed' | 'failed';

export interface StepExecutionRecord {
	name: string;
	completed_at: string;
}

export interface OperationRecord<TResult = unknown> {
	operation_id: string;
	idempotency_key: string;
	payload_hash: string;
	payload?: unknown;
	status: OperationStatus;
	created_at: string;
	updated_at: string;
	completed_steps: StepExecutionRecord[];
	result?: TResult;
	error?: string;
	failed_at?: string;
}

export interface OperationJournal {
	loadByIdempotencyKey<TResult = unknown>(idempotencyKey: string): Promise<OperationRecord<TResult> | null>;
	loadById<TResult = unknown>(operationId: string): Promise<OperationRecord<TResult> | null>;
	listRecoverable<TResult = unknown>(): Promise<OperationRecord<TResult>[]>;
	acquireLock?(idempotencyKey: string): Promise<() => Promise<void>>;
	claim?<TResult = unknown>(record: OperationRecord<TResult>): Promise<boolean>;
	save<TResult = unknown>(record: OperationRecord<TResult>): Promise<void>;
}

export interface OperationFailureInjectionContext {
	operationId: string;
	idempotencyKey: string;
	payloadHash: string;
	stepName?: string;
	phase: OperationPhase;
}

export type OperationFailureInjection = (
	context: OperationFailureInjectionContext
) => void | Promise<void>;

export type OperationClock = () => string;

export interface RecoverableOperationStep<TPayload> {
	name: string;
	execute: (payload: TPayload) => Promise<unknown> | unknown;
}

export interface RecoverableOperationRunnerConfig<TPayload, TResult> {
	operationId: string;
	idempotencyKey: string;
	payload: TPayload;
	steps: RecoverableOperationStep<TPayload>[];
	journal: OperationJournal;
	finalize: (payload: TPayload, completedSteps: ReadonlySet<string>) => Promise<TResult> | TResult;
	failureInjection?: OperationFailureInjection;
	clock?: OperationClock;
}

export class OperationConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OperationConflictError';
	}
}

export class CorruptedOperationJournalError extends Error {
	constructor(operationId: string, message: string) {
		super(`Corrupted operation journal record for ${operationId}: ${message}`);
		this.name = 'CorruptedOperationJournalError';
	}
}

export interface NodeFileOperationJournalOptions {
	directory: string;
	lockWaitTimeoutMs?: number;
}

export class NodeFileOperationJournal implements OperationJournal {
	private readonly directory: string;
	private readonly lockWaitTimeoutMs: number;

	constructor(options: NodeFileOperationJournalOptions) {
		if (!path.isAbsolute(options.directory)) {
			throw new Error(`Operation journal directory must be an absolute path: ${options.directory}`);
		}
		this.directory = path.normalize(options.directory);
		this.lockWaitTimeoutMs = options.lockWaitTimeoutMs ?? 30_000;
		if (!Number.isSafeInteger(this.lockWaitTimeoutMs) || this.lockWaitTimeoutMs <= 0) {
			throw new Error('Operation journal lockWaitTimeoutMs must be a positive safe integer.');
		}
	}

	private ensureValidOperationId(operationId: string): void {
		if (!OPERATION_ID_PATTERN.test(operationId)) {
			throw new Error(`Invalid operation id: ${operationId}`);
		}
	}

	private recordPath(operationId: string): string {
		this.ensureValidOperationId(operationId);
		return path.join(this.directory, `${operationId}.json`);
	}

	private idempotencyReferencePath(idempotencyKey: string): string {
		const keyHash = createHash('sha256').update(idempotencyKey).digest('hex');
		return path.join(this.directory, `.idempotency-${keyHash}.ref`);
	}

	private idempotencyLockPath(idempotencyKey: string): string {
		const keyHash = createHash('sha256').update(idempotencyKey).digest('hex');
		return path.join(this.directory, `.idempotency-${keyHash}.lock`);
	}

	private async ensureDirectory(): Promise<void> {
		await fs.mkdir(this.directory, { recursive: true });
	}

	private parseOperationRecord<TResult = unknown>(filePath: string, rawContent: string): OperationRecord<TResult> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawContent);
		} catch (error: unknown) {
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
			result: record.result as TResult | undefined,
			error: typeof record.error === 'string' ? record.error : undefined,
			failed_at: typeof record.failed_at === 'string' ? record.failed_at : undefined,
		};
	}

	private async readRecord<TResult = unknown>(recordPath: string): Promise<OperationRecord<TResult> | null> {
		try {
			const raw = await fs.readFile(recordPath, 'utf8');
			return this.parseOperationRecord(recordPath, raw);
		} catch (error: unknown) {
			if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			if (error instanceof CorruptedOperationJournalError) {
				throw error;
			}
			throw error;
		}
	}

	private buildTempPath(recordPath: string): string {
		const marker = `${Date.now()}-${randomBytes(4).toString('hex')}`;
		return `${recordPath}.${marker}.tmp`;
	}

	async acquireLock(idempotencyKey: string): Promise<() => Promise<void>> {
		await this.ensureDirectory();
		const lockPath = this.idempotencyLockPath(idempotencyKey);
		const deadline = Date.now() + this.lockWaitTimeoutMs;
		while (true) {
			try {
				const handle = await fs.open(lockPath, 'wx');
				await handle.writeFile(`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`, 'utf8');
				let released = false;
				return async () => {
					if (released) {
						return;
					}
					released = true;
					await handle.close().catch(() => undefined);
					await fs.unlink(lockPath).catch(() => undefined);
				};
			} catch (error: unknown) {
				if (!isNodeErrorCode(error, 'EEXIST')) {
					throw error;
				}
				if (await this.removeStaleLock(lockPath)) {
					continue;
				}
				if (Date.now() >= deadline) {
					throw new OperationConflictError(`Timed out waiting for the operation lock for idempotency key "${idempotencyKey}"`);
				}
				await new Promise<void>((resolve) => setTimeout(resolve, 25));
			}
		}
	}

	private async removeStaleLock(lockPath: string): Promise<boolean> {
		try {
			const raw = await fs.readFile(lockPath, 'utf8');
			const parsed = JSON.parse(raw) as { pid?: unknown };
			if (typeof parsed.pid === 'number' && Number.isSafeInteger(parsed.pid) && isProcessAlive(parsed.pid)) {
				return false;
			}
			await fs.unlink(lockPath);
			return true;
		} catch (error: unknown) {
			if (isNodeErrorCode(error, 'ENOENT')) {
				return true;
			}
			return false;
		}
	}

	async loadById<TResult = unknown>(operationId: string): Promise<OperationRecord<TResult> | null> {
		return this.readRecord<TResult>(this.recordPath(operationId));
	}

	async loadByIdempotencyKey<TResult = unknown>(idempotencyKey: string): Promise<OperationRecord<TResult> | null> {
		await this.ensureDirectory();
		const referencePath = this.idempotencyReferencePath(idempotencyKey);
		try {
			const operationId = (await fs.readFile(referencePath, 'utf8')).trim();
			if (!OPERATION_ID_PATTERN.test(operationId)) {
				throw new CorruptedOperationJournalError(referencePath, 'idempotency reference is invalid');
			}
			const referenced = await this.loadById<TResult>(operationId);
			if (!referenced || referenced.idempotency_key !== idempotencyKey) {
				throw new CorruptedOperationJournalError(referencePath, 'idempotency reference does not match an operation record');
			}
			return referenced;
		} catch (error: unknown) {
			if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}

		const files = await fs.readdir(this.directory);
		let bestMatch: OperationRecord<TResult> | null = null;

		for (const file of files) {
			if (!file.endsWith('.json')) {
				continue;
			}

			const candidatePath = path.join(this.directory, file);
			const candidate = await this.readRecord<TResult>(candidatePath);
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

	private async saveIdempotencyReference(idempotencyKey: string, operationId: string): Promise<void> {
		this.ensureValidOperationId(operationId);
		const referencePath = this.idempotencyReferencePath(idempotencyKey);
		const tempPath = this.buildTempPath(referencePath);
		await fs.writeFile(tempPath, `${operationId}\n`, 'utf8');
		try {
			await fs.rename(tempPath, referencePath);
		} catch (error: unknown) {
			await fs.unlink(tempPath).catch(() => undefined);
			throw error;
		}
	}

	async claim<TResult = unknown>(record: OperationRecord<TResult>): Promise<boolean> {
		await this.ensureDirectory();
		const recordPath = this.recordPath(record.operation_id);
		const recordTempPath = this.buildTempPath(recordPath);
		const payload = `${JSON.stringify(record, null, 2)}\n`;
		await fs.writeFile(recordTempPath, payload, 'utf8');
		try {
			await fs.link(recordTempPath, recordPath);
		} catch (error: unknown) {
			await fs.unlink(recordTempPath).catch(() => undefined);
			if (isNodeErrorCode(error, 'EEXIST')) {
				return false;
			}
			throw error;
		}
		await fs.unlink(recordTempPath).catch(() => undefined);

		const referencePath = this.idempotencyReferencePath(record.idempotency_key);
		const referenceTempPath = this.buildTempPath(referencePath);
		await fs.writeFile(referenceTempPath, `${record.operation_id}\n`, 'utf8');
		try {
			await fs.link(referenceTempPath, referencePath);
			return true;
		} catch (error: unknown) {
			if (isNodeErrorCode(error, 'EEXIST')) {
				await fs.unlink(recordPath).catch(() => undefined);
				return false;
			}
			await fs.unlink(recordPath).catch(() => undefined);
			throw error;
		} finally {
			await fs.unlink(referenceTempPath).catch(() => undefined);
		}
	}

	async listRecoverable<TResult = unknown>(): Promise<OperationRecord<TResult>[]> {
		await this.ensureDirectory();
		const files = await fs.readdir(this.directory);
		const records: OperationRecord<TResult>[] = [];
		for (const file of files) {
			if (!file.endsWith('.json')) {
				continue;
			}
			const record = await this.readRecord<TResult>(path.join(this.directory, file));
			if (record && record.status !== 'completed') {
				records.push(record);
			}
		}
		return records.sort((left, right) => left.created_at.localeCompare(right.created_at));
	}

	async save<TResult = unknown>(record: OperationRecord<TResult>): Promise<void> {
		await this.ensureDirectory();
		const recordPath = this.recordPath(record.operation_id);
		const tempPath = this.buildTempPath(recordPath);
		const payload = JSON.stringify(record, null, 2);

		await fs.writeFile(tempPath, `${payload}\n`, 'utf8');
		try {
			await fs.rename(tempPath, recordPath);
		} catch (error: unknown) {
			await fs.unlink(tempPath).catch(() => undefined);
			throw error;
		}
		await this.saveIdempotencyReference(record.idempotency_key, record.operation_id);
	}
}

export function computePayloadHash(payload: unknown): string {
	const serialized = JSON.stringify(normalizePayload(payload));
	return createHash('sha256').update(serialized).digest('hex');
}

export class RecoverableOperationRunner<TPayload, TResult> {
	private readonly config: RecoverableOperationRunnerConfig<TPayload, TResult>;

	constructor(config: RecoverableOperationRunnerConfig<TPayload, TResult>) {
		this.config = config;
	}

	private async injectFailure(context: Omit<OperationFailureInjectionContext, 'operationId'> & { operationId: string }): Promise<void> {
		if (!this.config.failureInjection) {
			return;
		}

		await this.config.failureInjection(context);
	}

	private completedStepSet(record: OperationRecord): Set<string> {
		return new Set(record.completed_steps.map((entry) => entry.name));
	}

	private now(): string {
		return this.config.clock ? this.config.clock() : new Date().toISOString();
	}

	private async withFailureContext<T>(phase: OperationPhase, stepName: string | undefined, operationId: string, payloadHash: string, run: () => Promise<T>): Promise<T> {
		await this.injectFailure({
			operationId,
			idempotencyKey: this.config.idempotencyKey,
			payloadHash,
			stepName,
			phase,
		});

		return run();
	}

	private markFailed(record: OperationRecord<TResult>, error: unknown): OperationRecord<TResult> {
		return {
			...record,
			status: 'failed',
			error: error instanceof Error ? error.message : String(error),
			failed_at: this.now(),
			updated_at: this.now(),
		};
	}

	private markCompleted(record: OperationRecord<TResult>, result: TResult): OperationRecord<TResult> {
		return {
			...record,
			status: 'completed',
			result,
			updated_at: this.now(),
			error: undefined,
			failed_at: undefined,
		};
	}

	private markStepCompleted(record: OperationRecord<TResult>, stepName: string): OperationRecord<TResult> {
		return {
			...record,
			completed_steps: [...record.completed_steps, { name: stepName, completed_at: this.now() }],
			updated_at: this.now(),
			error: undefined,
			failed_at: undefined,
		};
	}

	private markRunning(record: OperationRecord<TResult>): OperationRecord<TResult> {
		return {
			...record,
			status: 'in_progress',
			error: undefined,
			failed_at: undefined,
			updated_at: this.now(),
		};
	}

	async run(): Promise<TResult> {
		const lock = acquireOperationLock(this.config.idempotencyKey);
		let releaseJournalLock: (() => Promise<void>) | null = null;
		let isCompleted = false;
		let recordOwned = false;
		let record: OperationRecord<TResult> | null = null;

		try {
			await lock.previous;
			if (this.config.journal.acquireLock) {
				releaseJournalLock = await this.config.journal.acquireLock(this.config.idempotencyKey);
			}

			const payloadHash = computePayloadHash(this.config.payload);
			let existing = await this.config.journal.loadByIdempotencyKey<TResult>(this.config.idempotencyKey);

			if (existing) {
				if (existing.operation_id !== this.config.operationId) {
					throw new OperationConflictError(
						`Idempotency key conflict for "${this.config.idempotencyKey}": associated with existing operation "${existing.operation_id}"`
					);
				}
				if (existing.payload_hash !== payloadHash) {
					throw new OperationConflictError(
						`Idempotency key conflict for "${this.config.idempotencyKey}" with different payload hash`
					);
				}
				record = existing;
				if (record.status === 'completed') {
					if (!('result' in record)) {
						throw new CorruptedOperationJournalError(
							record.operation_id,
							'completed operation record is missing result'
						);
					}
					return record.result as TResult;
				}
				recordOwned = true;
				record = this.markRunning(record);
			} else {
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
							throw new OperationConflictError(
								`Idempotency key "${this.config.idempotencyKey}" was claimed by another process`
							);
						}
						if (existing.operation_id !== this.config.operationId || existing.payload_hash !== payloadHash) {
							throw new OperationConflictError(
								`Idempotency key conflict for "${this.config.idempotencyKey}" with another operation or payload`
							);
						}
						record = existing;
						if (record.status === 'completed') {
							if (!('result' in record)) {
								throw new CorruptedOperationJournalError(record.operation_id, 'completed operation record is missing result');
							}
								return record.result as TResult;
							}
							recordOwned = true;
							record = this.markRunning(record);
						}
					} else {
						recordOwned = true;
					}
			}

			await this.config.journal.save(record);

			const completedSteps = this.completedStepSet(record);
			for (const step of this.config.steps) {
				if (completedSteps.has(step.name)) {
					continue;
				}

				await this.withFailureContext(
					'before_step',
					step.name,
					record.operation_id,
					payloadHash,
					async () => Promise.resolve()
				);

				await step.execute(this.config.payload);
				record = this.markStepCompleted(record, step.name);
				completedSteps.add(step.name);
				await this.config.journal.save(record);

				await this.withFailureContext(
					'after_step',
					step.name,
					record.operation_id,
					payloadHash,
					async () => Promise.resolve()
				);
			}

			await this.withFailureContext(
				'before_finalize',
				undefined,
				record.operation_id,
				payloadHash,
				async () => Promise.resolve()
			);

			const result = await Promise.resolve(this.config.finalize(this.config.payload, completedSteps));
			record = this.markCompleted(record, result);
			await this.config.journal.save(record);
			isCompleted = true;

			await this.withFailureContext(
				'after_finalize',
				undefined,
				record.operation_id,
				payloadHash,
				async () => Promise.resolve()
			);

			return result;
		} catch (error: unknown) {
			if (!isCompleted && recordOwned && record !== null) {
				const failedRecord = this.markFailed(record, error);
				record = failedRecord;
				await this.config.journal.save(failedRecord);
			}
			throw error;
		} finally {
			if (releaseJournalLock) {
				await releaseJournalLock();
			}
			lock.release();
			if (operationLocks.get(this.config.idempotencyKey) === lock.chain) {
				operationLocks.delete(this.config.idempotencyKey);
			}
		}
	}

	private async loadClaimedRecord(): Promise<OperationRecord<TResult> | null> {
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const byId = await this.config.journal.loadById<TResult>(this.config.operationId);
			if (byId) {
				return byId;
			}
			const byKey = await this.config.journal.loadByIdempotencyKey<TResult>(this.config.idempotencyKey);
			if (byKey) {
				return byKey;
			}
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
		}
		return null;
	}
}

interface OperationLock {
	previous: Promise<void>;
	release: () => void;
	chain: Promise<void>;
}

function acquireOperationLock(operationId: string): OperationLock {
	const previous = operationLocks.get(operationId) ?? Promise.resolve();
	let release: () => void = () => undefined;
	const next = new Promise<void>((resolve) => {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
}

function isValidOperationStatus(value: unknown): value is OperationStatus {
	return value === 'in_progress' || value === 'completed' || value === 'failed';
}

function isStepExecutionRecord(value: unknown): value is StepExecutionRecord {
	if (!isPlainObject(value)) {
		return false;
	}

	return typeof value.name === 'string' && Boolean(value.name) && typeof value.completed_at === 'string';
}

function isNodeErrorCode(error: unknown, code: string): boolean {
	return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error: unknown) {
		return !isNodeErrorCode(error, 'ESRCH');
	}
}

function normalizePayload(value: unknown): unknown {
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
		const normalized: Record<string, unknown> = {};
		for (const key of keys) {
			normalized[key] = normalizePayload((value as Record<string, unknown>)[key]);
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
