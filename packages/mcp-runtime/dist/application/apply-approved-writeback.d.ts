import { type OperationFailureInjection, type OperationJournal } from '@tracekeeper/core';
export interface ApplyApprovedWritebackPayload {
    proposalId: string;
    proposalPath: string;
    targetPath: string;
    taskId: string | null;
    writebackBlock: string;
    writebackMarker: string;
    auditPath: string;
}
export interface ApplyApprovedWritebackCommand {
    operationId: string;
    idempotencyKey: string;
    approvalStatus: string;
    payload: ApplyApprovedWritebackPayload;
}
export interface ApplyApprovedWritebackResult {
    ok: true;
    read_only: false;
    permission_level: 'review-gated apply';
    status: 'applied';
    operation_id: string;
    proposal_id: string;
    proposal_path: string;
    target_note: string;
    touched_notes: string[];
    audit_path: string;
}
export interface ApplyApprovedWritebackPort {
    applyTarget(payload: ApplyApprovedWritebackPayload, operationId: string): Promise<void> | void;
    markProposalApplied(payload: ApplyApprovedWritebackPayload, operationId: string): Promise<void> | void;
    linkTask(payload: ApplyApprovedWritebackPayload, operationId: string): Promise<void> | void;
    appendAudit(payload: ApplyApprovedWritebackPayload, operationId: string): Promise<void> | void;
}
export interface ApplyApprovedWritebackServiceOptions {
    journal: OperationJournal;
    port: ApplyApprovedWritebackPort;
    failureInjection?: OperationFailureInjection;
}
export declare class ApplyApprovedWritebackApprovalError extends Error {
    constructor(status: string);
}
export declare class ApplyApprovedWritebackService {
    private readonly options;
    constructor(options: ApplyApprovedWritebackServiceOptions);
    execute(command: ApplyApprovedWritebackCommand): Promise<ApplyApprovedWritebackResult>;
}
