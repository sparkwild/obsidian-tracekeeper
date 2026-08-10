export type OperationPhase = 'before_step' | 'after_step' | 'before_finalize' | 'after_finalize';
export type OperationStatus = 'in_progress' | 'activity_pending' | 'completed' | 'conflicted' | 'failed';
export type OperationFailureStatus = Extract<OperationStatus, 'activity_pending' | 'conflicted' | 'failed'>;
export interface StepExecutionRecord {
    name: string;
    completed_at: string;
    result?: unknown;
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
export type OperationFailureInjection = (context: OperationFailureInjectionContext) => void | Promise<void>;
export type OperationClock = () => string;
export interface RecoverableOperationStepContext {
    completedSteps: readonly StepExecutionRecord[];
}
export interface RecoverableOperationStep<TPayload> {
    name: string;
    execute: (payload: TPayload, context: RecoverableOperationStepContext) => unknown;
    persistResult?: boolean;
    failureStatus?: OperationFailureStatus | ((error: unknown) => OperationFailureStatus);
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
export declare class OperationConflictError extends Error {
    constructor(message: string);
}
export declare class CorruptedOperationJournalError extends Error {
    constructor(operationId: string, message: string);
}
export interface NodeFileOperationJournalOptions {
    directory: string;
    lockWaitTimeoutMs?: number;
}
export declare class NodeFileOperationJournal implements OperationJournal {
    private readonly directory;
    private readonly lockWaitTimeoutMs;
    private readonly corruptLockGraceMs;
    private payloadKeyPromise;
    constructor(options: NodeFileOperationJournalOptions);
    private ensureValidOperationId;
    private recordPath;
    private payloadKeyPath;
    private progressAnchorPath;
    private idempotencyReferencePath;
    private idempotencyLockPath;
    private ensureDirectory;
    private parseOperationRecord;
    private readRecord;
    private payloadKey;
    private loadOrCreatePayloadKey;
    private operationValueAdditionalData;
    private encryptOperationValue;
    private decryptOperationValue;
    private persistedRecord;
    private terminalStatus;
    private completedStepsHash;
    private anchorBinding;
    private buildProgressAnchor;
    private saveProgressAnchor;
    private verifyProgressAnchor;
    private assertMonotonicProgress;
    private buildTempPath;
    acquireLock(idempotencyKey: string): Promise<() => Promise<void>>;
    private removeStaleLock;
    private removeCorruptLockAfterGrace;
    loadById<TResult = unknown>(operationId: string): Promise<OperationRecord<TResult> | null>;
    loadByIdempotencyKey<TResult = unknown>(idempotencyKey: string): Promise<OperationRecord<TResult> | null>;
    private saveIdempotencyReference;
    claim<TResult = unknown>(record: OperationRecord<TResult>): Promise<boolean>;
    listRecoverable<TResult = unknown>(): Promise<OperationRecord<TResult>[]>;
    save<TResult = unknown>(record: OperationRecord<TResult>): Promise<void>;
}
export declare function computePayloadHash(payload: unknown): string;
export declare class RecoverableOperationRunner<TPayload, TResult> {
    private readonly config;
    constructor(config: RecoverableOperationRunnerConfig<TPayload, TResult>);
    private injectFailure;
    private completedStepSet;
    private stepContext;
    private now;
    private withFailureContext;
    private markFailed;
    private markCompleted;
    private markStepCompleted;
    private failureStatusForStep;
    private markActivityPending;
    private validateRecordForRun;
    private throwIfTerminalConflict;
    private markRunning;
    run(): Promise<TResult>;
    private loadClaimedRecord;
}
