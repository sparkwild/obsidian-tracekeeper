import { type OperationFailureInjection, type OperationJournal, type ProposalTransitionReceipt } from '@tracekeeper/core';
export interface ApplyApprovedWritebackPayload {
    schemaVersion: 1;
    proposalId: string;
    proposalPath: string;
    proposalRevision: string;
    proposalContentHash: string;
    proposalFileHash: string;
    approvalOperationId: string;
    targetPath: string;
    targetContentHash: string;
    proposalTaskId: string;
    taskId: string | null;
    taskPath: string | null;
    taskContentHash: string;
    taskLinkedContentHash: string;
    taskHadTargetReference: boolean;
    taskHadProposalReference: boolean;
    taskHadProposalIdReference?: boolean;
    taskHadProposalPathEvidence?: boolean;
    writebackContentHash: string;
    writebackBlockHash: string;
    writebackMarker: string;
    touchedNotes: string[];
    confirmationTokenHash: string;
    confirmationExpiresAt: string;
    activityPath: string;
    activityAgentId: string;
    activitySessionId: string;
    activityClientName: string;
    effectKind?: 'append' | 'create_memory_record';
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
    activity_path: string;
}
export interface ApplyApprovedWritebackTaskLinkReceipt {
    taskPath: string | null;
    targetReferenceAdded: boolean;
    proposalReferenceAdded: boolean;
}
export interface ApplyApprovedWritebackPort {
    applyTarget(payload: ApplyApprovedWritebackPayload, operationId: string): Promise<void> | void;
    rollbackTarget(payload: ApplyApprovedWritebackPayload, operationId: string): Promise<void> | void;
    markProposalApplied(payload: ApplyApprovedWritebackPayload, operationId: string): Promise<ProposalTransitionReceipt> | ProposalTransitionReceipt;
    linkTask(payload: ApplyApprovedWritebackPayload, operationId: string): Promise<ApplyApprovedWritebackTaskLinkReceipt> | ApplyApprovedWritebackTaskLinkReceipt;
    rollbackTask(payload: ApplyApprovedWritebackPayload, operationId: string, receipt: ApplyApprovedWritebackTaskLinkReceipt): Promise<void> | void;
    appendAgentActivity(payload: ApplyApprovedWritebackPayload, operationId: string, receipt: ProposalTransitionReceipt): Promise<void> | void;
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
