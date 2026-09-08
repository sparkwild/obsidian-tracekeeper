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
    getRecoveryIssues?(): ReadonlyArray<{
        operation_id: string;
        error: string;
    }>;
    acquireLock?(idempotencyKey: string, domain?: 'idempotency' | 'finish-preparation'): Promise<() => Promise<void>>;
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
    beforeWrite?: () => Promise<void>;
    onKeyCreated?: (key: Buffer) => Promise<void>;
}
export declare class NodeFileOperationJournal implements OperationJournal {
    private readonly directory;
    private readonly archive;
    private readonly beforeWrite?;
    private readonly onKeyCreated?;
    private readonly lockWaitTimeoutMs;
    private readonly corruptLockGraceMs;
    private payloadKeyPromise;
    private recoveryIssues;
    private directoryCatalog;
    private activeDirectoryRevision;
    private activeDirectoryMutation;
    private terminalAnchors;
    constructor(options: NodeFileOperationJournalOptions);
    private ensureValidOperationId;
    private recordPath;
    private payloadKeyPath;
    private progressAnchorPath;
    private idempotencyReferencePath;
    private idempotencyLockPath;
    private ensureDirectory;
    clearCache(): void;
    private fileStamp;
    private withDirectoryLock;
    private markDirectoryMutation;
    private loadDirectoryCatalog;
    private rememberRecord;
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
    acquireLock(idempotencyKey: string, domain?: 'idempotency' | 'finish-preparation'): Promise<() => Promise<void>>;
    private removeStaleLock;
    private removeCorruptLockAfterGrace;
    loadById<TResult = unknown>(operationId: string): Promise<OperationRecord<TResult> | null>;
    loadByIdempotencyKey<TResult = unknown>(idempotencyKey: string): Promise<OperationRecord<TResult> | null>;
    private lookupIdempotencyKey;
    private saveIdempotencyReference;
    claim<TResult = unknown>(record: OperationRecord<TResult>): Promise<boolean>;
    private claimRecord;
    listRecoverable<TResult = unknown>(): Promise<OperationRecord<TResult>[]>;
    private recoverableRecords;
    getRecoveryIssues(): ReadonlyArray<{
        operation_id: string;
        error: string;
    }>;
    private hasAuthenticatedTerminalAnchor;
    save<TResult = unknown>(record: OperationRecord<TResult>): Promise<void>;
    private saveRecord;
    /** 元数据检查不初始化或修复存储。 */
    inspect(): Promise<{
        maintenance: 'idle' | 'preparing' | 'publishing' | 'invalid';
        hot: number;
        cold: number;
        segments: number;
        generation: string;
        states: Record<string, number>;
        issues: string[];
        hot_files: number;
        hot_bytes: number;
        cold_files: number;
        cold_bytes: number;
        attention: Array<{
            id: string;
            status: string;
        }>;
    }>;
    recoverStorage(): Promise<void>;
    coordinate<T>(action: () => Promise<T>): Promise<T>;
    initializeStorage(): Promise<void>;
    pendingActivityDates(): Promise<string[]>;
    archiveReceipts(now?: number): Promise<{
        archived: number;
    }>;
    repairArchive(): Promise<void>;
    verifyStorage(): Promise<void>;
    /** 压缩准备在写锁外完成；提交前重新校验原始内容。 */
    archiveCompleted(now?: number, force?: boolean): Promise<{
        archived: number;
    }>;
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
