"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplyApprovedWritebackService = exports.ApplyApprovedWritebackApprovalError = void 0;
const core_1 = require("@tracekeeper/core");
class ApplyApprovedWritebackApprovalError extends Error {
    constructor(status) {
        super(`proposal approval_status/status is ${status}`);
        this.name = 'ApplyApprovedWritebackApprovalError';
    }
}
exports.ApplyApprovedWritebackApprovalError = ApplyApprovedWritebackApprovalError;
function boundedWritebackPayload(payload) {
    const hasStableProposalReferenceFlags = typeof payload.taskHadProposalIdReference === 'boolean'
        && typeof payload.taskHadProposalPathEvidence === 'boolean';
    const hasPartialStableProposalReferenceFlags = payload.taskHadProposalIdReference !== undefined
        || payload.taskHadProposalPathEvidence !== undefined;
    const hasAppliedProposalReferenceFlag = typeof payload.taskHadAppliedProposalReference === 'boolean';
    const requiredStrings = [
        'proposalId',
        'proposalPath',
        'proposalRevision',
        'proposalContentHash',
        'proposalFileHash',
        'approvalOperationId',
        'targetPath',
        'targetContentHash',
        'proposalTaskId',
        'taskContentHash',
        'taskLinkedContentHash',
        'writebackContentHash',
        'writebackBlockHash',
        'writebackMarker',
        'confirmationTokenHash',
        'confirmationExpiresAt',
        'activityPath',
        'activityAgentId',
        'activitySessionId',
        'activityClientName',
    ];
    if (payload.schemaVersion !== 1
        || requiredStrings.some((key) => typeof payload[key] !== 'string')
        || requiredStrings.some((key) => payload[key].length > 2048)
        || (payload.taskId !== null && typeof payload.taskId !== 'string')
        || (payload.taskPath !== null && typeof payload.taskPath !== 'string')
        || (payload.taskId !== null && payload.taskId.length > 512)
        || (payload.taskPath !== null && payload.taskPath.length > 2048)
        || typeof payload.taskHadTargetReference !== 'boolean'
        || typeof payload.taskHadProposalReference !== 'boolean'
        || (payload.effectKind !== undefined
            && payload.effectKind !== 'append'
            && payload.effectKind !== 'create_memory_record'
            && payload.effectKind !== 'create_wiki_note')
        || (hasPartialStableProposalReferenceFlags && !hasStableProposalReferenceFlags)
        || (payload.taskHadAppliedProposalReference !== undefined
            && !hasAppliedProposalReferenceFlag)
        || (hasAppliedProposalReferenceFlag && !hasStableProposalReferenceFlags)
        || (payload.taskId === null
            && (payload.taskPath !== null
                || payload.taskContentHash !== ''
                || payload.taskLinkedContentHash !== ''
                || payload.taskHadTargetReference
                || payload.taskHadProposalReference
                || payload.taskHadProposalIdReference === true
                || payload.taskHadProposalPathEvidence === true
                || payload.taskHadAppliedProposalReference === true))
        || (payload.taskId !== null
            && (payload.taskId.length === 0
                || payload.taskPath === null
                || payload.taskPath.length === 0
                || payload.taskContentHash.length === 0
                || payload.taskLinkedContentHash.length === 0))
        || !Array.isArray(payload.touchedNotes)
        || !payload.touchedNotes.every((item) => typeof item === 'string')
        || payload.touchedNotes.length < 3
        || payload.touchedNotes.length > 4
        || payload.touchedNotes.some((item) => item.length === 0 || item.length > 2048)
        || new Set(payload.touchedNotes).size !== payload.touchedNotes.length
        || payload.proposalId.length === 0
        || payload.proposalId.length > 512
        || payload.proposalRevision.length === 0
        || payload.proposalContentHash.length === 0
        || payload.proposalFileHash.length === 0
        || payload.approvalOperationId.length === 0
        || payload.targetPath.length === 0
        || payload.targetContentHash.length === 0
        || payload.writebackContentHash.length === 0
        || payload.writebackBlockHash.length === 0
        || payload.writebackMarker.length === 0
        || payload.confirmationTokenHash.length === 0
        || payload.activityPath.length === 0
        || Number.isNaN(Date.parse(payload.confirmationExpiresAt))) {
        throw new Error('Approved writeback operation payload is invalid.');
    }
    return {
        schemaVersion: 1,
        proposalId: payload.proposalId,
        proposalPath: payload.proposalPath,
        proposalRevision: payload.proposalRevision,
        proposalContentHash: payload.proposalContentHash,
        proposalFileHash: payload.proposalFileHash,
        approvalOperationId: payload.approvalOperationId,
        targetPath: payload.targetPath,
        targetContentHash: payload.targetContentHash,
        proposalTaskId: payload.proposalTaskId,
        taskId: payload.taskId,
        taskPath: payload.taskPath,
        taskContentHash: payload.taskContentHash,
        taskLinkedContentHash: payload.taskLinkedContentHash,
        taskHadTargetReference: payload.taskHadTargetReference,
        taskHadProposalReference: payload.taskHadProposalReference,
        ...(hasStableProposalReferenceFlags
            ? {
                taskHadProposalIdReference: payload.taskHadProposalIdReference,
                taskHadProposalPathEvidence: payload.taskHadProposalPathEvidence,
                ...(hasAppliedProposalReferenceFlag
                    ? {
                        taskHadAppliedProposalReference: payload.taskHadAppliedProposalReference,
                    }
                    : {}),
            }
            : {}),
        writebackContentHash: payload.writebackContentHash,
        writebackBlockHash: payload.writebackBlockHash,
        writebackMarker: payload.writebackMarker,
        touchedNotes: payload.touchedNotes.slice(),
        confirmationTokenHash: payload.confirmationTokenHash,
        confirmationExpiresAt: payload.confirmationExpiresAt,
        activityPath: payload.activityPath,
        activityAgentId: payload.activityAgentId,
        activitySessionId: payload.activitySessionId,
        activityClientName: payload.activityClientName,
        ...(payload.effectKind ? { effectKind: payload.effectKind } : {}),
    };
}
function isWritebackBoundaryConflict(error) {
    return error instanceof core_1.OperationConflictError
        || error instanceof core_1.ProposalTransitionValidationError
        || error instanceof core_1.ProposalTransitionStateError
        || error instanceof core_1.ProposalTransitionConflictError;
}
function failureStatusForWritebackBoundary(error) {
    return isWritebackBoundaryConflict(error)
        ? 'conflicted'
        : 'failed';
}
function failureStatusForActivityWrite(error) {
    return isWritebackBoundaryConflict(error)
        ? 'conflicted'
        : 'activity_pending';
}
function isProposalTransitionFailure(error) {
    return error instanceof core_1.OperationConflictError
        || error instanceof core_1.ProposalTransitionConflictError
        || error instanceof core_1.ProposalTransitionValidationError
        || error instanceof core_1.ProposalTransitionStateError;
}
function proposalTransitionReceiptFromStep(value, payload, operationId) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new core_1.OperationConflictError('Journaled proposal transition receipt is unavailable.');
    }
    const receipt = value;
    const statuses = new Set([
        'pending',
        'approved',
        'rejected',
        'deferred',
        'revision_requested',
        'applied',
    ]);
    const requiredStrings = [
        'operationId',
        'payloadHash',
        'kind',
        'proposalPath',
        'proposalId',
        'taskId',
        'previousStatus',
        'nextStatus',
        'expectedRevision',
        'expectedContentHash',
        'previousRevision',
        'committedRevision',
        'previousContentHash',
        'committedContentHash',
        'committedAt',
    ];
    if (receipt.schemaVersion !== 1
        || requiredStrings.some((key) => typeof receipt[key] !== 'string')
        || requiredStrings.some((key) => receipt[key].length > 2048)
        || receipt.kind !== 'apply'
        || receipt.operationId !== operationId
        || receipt.proposalPath !== payload.proposalPath
        || receipt.proposalId !== payload.proposalId
        || receipt.taskId !== payload.proposalTaskId
        || receipt.previousStatus !== 'approved'
        || receipt.nextStatus !== 'applied'
        || receipt.expectedRevision !== payload.proposalRevision
        || receipt.expectedContentHash !== payload.proposalContentHash
        || !statuses.has(receipt.previousStatus || '')
        || !statuses.has(receipt.nextStatus || '')
        || Number.isNaN(Date.parse(receipt.committedAt || ''))) {
        throw new core_1.OperationConflictError('Journaled proposal transition receipt is invalid.');
    }
    return {
        schemaVersion: 1,
        operationId: receipt.operationId,
        payloadHash: receipt.payloadHash,
        kind: 'apply',
        proposalPath: receipt.proposalPath,
        proposalId: receipt.proposalId,
        taskId: receipt.taskId,
        previousStatus: 'approved',
        nextStatus: 'applied',
        expectedRevision: receipt.expectedRevision,
        expectedContentHash: receipt.expectedContentHash,
        previousRevision: receipt.previousRevision,
        committedRevision: receipt.committedRevision,
        previousContentHash: receipt.previousContentHash,
        committedContentHash: receipt.committedContentHash,
        committedAt: receipt.committedAt,
    };
}
function expectedTaskLinkReceipt(payload) {
    return {
        taskPath: payload.taskPath,
        targetReferenceAdded: payload.taskId !== null && !payload.taskHadTargetReference,
        proposalReferenceAdded: payload.taskId !== null && !payload.taskHadProposalReference,
    };
}
function taskLinkReceiptFromStep(value, payload) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new core_1.OperationConflictError('Journaled task-link receipt is unavailable.');
    }
    const receipt = value;
    const keys = Object.keys(receipt).sort();
    const expected = expectedTaskLinkReceipt(payload);
    if (keys.length !== 3
        || keys[0] !== 'proposalReferenceAdded'
        || keys[1] !== 'targetReferenceAdded'
        || keys[2] !== 'taskPath'
        || (receipt.taskPath !== null && typeof receipt.taskPath !== 'string')
        || (typeof receipt.taskPath === 'string' && receipt.taskPath.length > 2048)
        || typeof receipt.targetReferenceAdded !== 'boolean'
        || typeof receipt.proposalReferenceAdded !== 'boolean'
        || receipt.targetReferenceAdded !== expected.targetReferenceAdded
        || receipt.proposalReferenceAdded !== expected.proposalReferenceAdded
        || receipt.taskPath !== payload.taskPath
        || (payload.taskId === null
            && (receipt.taskPath !== null
                || receipt.targetReferenceAdded
                || receipt.proposalReferenceAdded))
        || (payload.taskId !== null && receipt.taskPath === null)) {
        throw new core_1.OperationConflictError('Journaled task-link receipt is invalid.');
    }
    return {
        taskPath: receipt.taskPath,
        targetReferenceAdded: receipt.targetReferenceAdded,
        proposalReferenceAdded: receipt.proposalReferenceAdded,
    };
}
class ApplyApprovedWritebackService {
    constructor(options) {
        this.options = options;
    }
    async execute(command) {
        const payload = boundedWritebackPayload(command.payload);
        const existing = await this.options.journal.loadByIdempotencyKey(command.idempotencyKey);
        if (!existing && command.approvalStatus !== 'approved') {
            throw new ApplyApprovedWritebackApprovalError(command.approvalStatus);
        }
        const compensatePriorEffects = async (taskReceipt, failureMessage) => {
            let compensationFailed = false;
            try {
                await this.options.port.rollbackTarget(payload, command.operationId);
            }
            catch {
                compensationFailed = true;
            }
            try {
                await this.options.port.rollbackTask(payload, command.operationId, taskReceipt);
            }
            catch {
                compensationFailed = true;
            }
            if (compensationFailed) {
                throw new core_1.OperationConflictError(failureMessage);
            }
        };
        const runner = new core_1.RecoverableOperationRunner({
            operationId: command.operationId,
            idempotencyKey: command.idempotencyKey,
            payload,
            journal: this.options.journal,
            failureInjection: this.options.failureInjection,
            steps: [
                {
                    name: 'apply_target',
                    execute: (payload) => this.options.port.applyTarget(payload, command.operationId),
                    failureStatus: failureStatusForWritebackBoundary,
                },
                {
                    name: 'link_task',
                    execute: async (payload) => {
                        try {
                            const receipt = await this.options.port.linkTask(payload, command.operationId);
                            return taskLinkReceiptFromStep(receipt, payload);
                        }
                        catch (error) {
                            if (isWritebackBoundaryConflict(error)) {
                                try {
                                    await this.options.port.rollbackTarget(payload, command.operationId);
                                }
                                catch {
                                    throw new core_1.OperationConflictError('Task-link transition conflicted and the target could not be safely compensated.');
                                }
                            }
                            throw error;
                        }
                    },
                    persistResult: true,
                    failureStatus: failureStatusForWritebackBoundary,
                },
                {
                    name: 'mark_proposal_applied',
                    execute: async (payload, context) => {
                        const taskStep = context.completedSteps.find((step) => step.name === 'link_task');
                        let taskReceipt;
                        try {
                            taskReceipt = taskLinkReceiptFromStep(taskStep?.result, payload);
                        }
                        catch (error) {
                            if (isWritebackBoundaryConflict(error)) {
                                await compensatePriorEffects(expectedTaskLinkReceipt(payload), 'Task-link receipt conflicted and prior effects could not be safely compensated.');
                            }
                            throw error;
                        }
                        try {
                            const receipt = await this.options.port.markProposalApplied(payload, command.operationId);
                            return proposalTransitionReceiptFromStep(receipt, payload, command.operationId);
                        }
                        catch (error) {
                            if (isProposalTransitionFailure(error)) {
                                await compensatePriorEffects(taskReceipt, 'Proposal transition conflicted and prior effects could not be safely compensated.');
                            }
                            throw error;
                        }
                    },
                    persistResult: true,
                    failureStatus: failureStatusForWritebackBoundary,
                },
                {
                    name: 'append_agent_activity',
                    execute: (payload, context) => {
                        const transitionStep = context.completedSteps.find((step) => step.name === 'mark_proposal_applied');
                        const receipt = proposalTransitionReceiptFromStep(transitionStep?.result, payload, command.operationId);
                        return this.options.port.appendAgentActivity(payload, command.operationId, receipt);
                    },
                    failureStatus: failureStatusForActivityWrite,
                },
            ],
            finalize: (payload) => ({
                ok: true,
                read_only: false,
                permission_level: 'review-gated apply',
                status: 'applied',
                operation_id: command.operationId,
                proposal_id: payload.proposalId,
                proposal_path: payload.proposalPath,
                target_note: payload.targetPath,
                touched_notes: payload.touchedNotes || [
                    payload.targetPath,
                    payload.proposalPath,
                    payload.activityPath,
                ],
                activity_path: payload.activityPath,
            }),
        });
        return runner.run();
    }
}
exports.ApplyApprovedWritebackService = ApplyApprovedWritebackService;
