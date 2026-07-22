import {
	type OperationFailureInjection,
	type OperationJournal,
	RecoverableOperationRunner,
} from '@tracekeeper/core';

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

export class ApplyApprovedWritebackApprovalError extends Error {
	constructor(status: string) {
		super(`proposal approval_status/status is ${status}`);
		this.name = 'ApplyApprovedWritebackApprovalError';
	}
}

export class ApplyApprovedWritebackService {
	private readonly options: ApplyApprovedWritebackServiceOptions;

	constructor(options: ApplyApprovedWritebackServiceOptions) {
		this.options = options;
	}

	async execute(command: ApplyApprovedWritebackCommand): Promise<ApplyApprovedWritebackResult> {
		const existing = await this.options.journal.loadByIdempotencyKey<ApplyApprovedWritebackResult>(
			command.idempotencyKey
		);
		if (!existing && command.approvalStatus !== 'approved') {
			throw new ApplyApprovedWritebackApprovalError(command.approvalStatus);
		}

		const runner = new RecoverableOperationRunner<ApplyApprovedWritebackPayload, ApplyApprovedWritebackResult>({
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
