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
class ApplyApprovedWritebackService {
    constructor(options) {
        this.options = options;
    }
    async execute(command) {
        const existing = await this.options.journal.loadByIdempotencyKey(command.idempotencyKey);
        if (!existing && command.approvalStatus !== 'approved') {
            throw new ApplyApprovedWritebackApprovalError(command.approvalStatus);
        }
        const runner = new core_1.RecoverableOperationRunner({
            operationId: command.operationId,
            idempotencyKey: command.idempotencyKey,
            payload: command.payload,
            journal: this.options.journal,
            failureInjection: this.options.failureInjection,
            steps: [
                {
                    name: 'apply_target',
                    execute: (payload) => this.options.port.applyTarget(payload, command.operationId),
                },
                {
                    name: 'mark_proposal_applied',
                    execute: (payload) => this.options.port.markProposalApplied(payload, command.operationId),
                },
                {
                    name: 'link_task',
                    execute: (payload) => this.options.port.linkTask(payload, command.operationId),
                },
                {
                    name: 'append_audit',
                    execute: (payload) => this.options.port.appendAudit(payload, command.operationId),
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
                touched_notes: [payload.targetPath, payload.proposalPath, payload.auditPath],
                audit_path: payload.auditPath,
            }),
        });
        return runner.run();
    }
}
exports.ApplyApprovedWritebackService = ApplyApprovedWritebackService;
