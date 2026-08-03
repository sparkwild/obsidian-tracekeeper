import type { OperationJournal, OperationRecord } from '@tracekeeper/core';
export interface RecoveryToolRequest {
    tool: string;
    args: Record<string, unknown>;
}
export interface OperationRecoveryReport {
    recovered: string[];
    failed: Array<{
        operation_id: string;
        error: string;
    }>;
    skipped: string[];
}
export interface RecoveryInvocationResult {
    isError: boolean;
    error?: string;
}
export interface RuntimeRecoveryControllerDependencies {
    isApplyApprovedWritebackPayload(payload: unknown): boolean;
    isProposeMemoryOperationPayload(payload: unknown): boolean;
    invoke(request: RecoveryToolRequest, record: OperationRecord, vaultRoot: string): Promise<RecoveryInvocationResult>;
}
export declare function recoveryRequestForRecord(record: OperationRecord, dependencies: Pick<RuntimeRecoveryControllerDependencies, 'isProposeMemoryOperationPayload'>): RecoveryToolRequest | null;
export declare class RuntimeRecoveryController {
    private readonly journal;
    private readonly dependencies;
    constructor(journal: OperationJournal, dependencies: RuntimeRecoveryControllerDependencies);
    recover(vaultRoot: string): Promise<OperationRecoveryReport>;
}
