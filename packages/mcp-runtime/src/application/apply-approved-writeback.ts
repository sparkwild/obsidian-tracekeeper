import {
	OperationConflictError,
	type OperationFailureInjection,
	type OperationJournal,
	type ProposalTransitionReceipt,
	ProposalTransitionConflictError,
	ProposalTransitionStateError,
	ProposalTransitionValidationError,
	RecoverableOperationRunner,
} from '@tracekeeper/core';

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
	taskHadAppliedProposalReference?: boolean;
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
	effectKind?: 'append' | 'create_memory_record' | 'create_wiki_note';
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
	markProposalApplied(
		payload: ApplyApprovedWritebackPayload,
		operationId: string
	): Promise<ProposalTransitionReceipt> | ProposalTransitionReceipt;
	linkTask(
		payload: ApplyApprovedWritebackPayload,
		operationId: string
	): Promise<ApplyApprovedWritebackTaskLinkReceipt> | ApplyApprovedWritebackTaskLinkReceipt;
	rollbackTask(
		payload: ApplyApprovedWritebackPayload,
		operationId: string,
		receipt: ApplyApprovedWritebackTaskLinkReceipt
	): Promise<void> | void;
	appendAgentActivity(
		payload: ApplyApprovedWritebackPayload,
		operationId: string,
		receipt: ProposalTransitionReceipt
	): Promise<void> | void;
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

function boundedWritebackPayload(
	payload: ApplyApprovedWritebackPayload
): ApplyApprovedWritebackPayload {
	const hasStableProposalReferenceFlags =
		typeof payload.taskHadProposalIdReference === 'boolean'
		&& typeof payload.taskHadProposalPathEvidence === 'boolean';
	const hasPartialStableProposalReferenceFlags =
		payload.taskHadProposalIdReference !== undefined
		|| payload.taskHadProposalPathEvidence !== undefined;
	const hasAppliedProposalReferenceFlag =
		typeof payload.taskHadAppliedProposalReference === 'boolean';
	const requiredStrings: Array<keyof ApplyApprovedWritebackPayload> = [
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
	if (
		payload.schemaVersion !== 1
		|| requiredStrings.some((key) => typeof payload[key] !== 'string')
		|| requiredStrings.some((key) => (payload[key] as string).length > 2048)
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
		|| (
			payload.taskId === null
			&& (
				payload.taskPath !== null
				|| payload.taskContentHash !== ''
				|| payload.taskLinkedContentHash !== ''
				|| payload.taskHadTargetReference
				|| payload.taskHadProposalReference
				|| payload.taskHadProposalIdReference === true
				|| payload.taskHadProposalPathEvidence === true
				|| payload.taskHadAppliedProposalReference === true
			)
		)
		|| (
			payload.taskId !== null
			&& (
				payload.taskId.length === 0
				|| payload.taskPath === null
				|| payload.taskPath.length === 0
				|| payload.taskContentHash.length === 0
				|| payload.taskLinkedContentHash.length === 0
			)
		)
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
		|| Number.isNaN(Date.parse(payload.confirmationExpiresAt))
	) {
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
						taskHadAppliedProposalReference:
							payload.taskHadAppliedProposalReference,
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

function isWritebackBoundaryConflict(error: unknown): boolean {
	return error instanceof OperationConflictError
		|| error instanceof ProposalTransitionValidationError
		|| error instanceof ProposalTransitionStateError
		|| error instanceof ProposalTransitionConflictError;
}

function failureStatusForWritebackBoundary(error: unknown): 'conflicted' | 'failed' {
	return isWritebackBoundaryConflict(error)
		? 'conflicted'
		: 'failed';
}

function failureStatusForActivityWrite(error: unknown): 'conflicted' | 'activity_pending' {
	return isWritebackBoundaryConflict(error)
		? 'conflicted'
		: 'activity_pending';
}

function isProposalTransitionFailure(error: unknown): boolean {
	return error instanceof OperationConflictError
		|| error instanceof ProposalTransitionConflictError
		|| error instanceof ProposalTransitionValidationError
		|| error instanceof ProposalTransitionStateError;
}

function proposalTransitionReceiptFromStep(
	value: unknown,
	payload: ApplyApprovedWritebackPayload,
	operationId: string
): ProposalTransitionReceipt {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new OperationConflictError('Journaled proposal transition receipt is unavailable.');
	}
	const receipt = value as Partial<ProposalTransitionReceipt>;
	const statuses = new Set([
		'pending',
		'approved',
		'rejected',
		'deferred',
		'revision_requested',
		'applied',
	]);
	const requiredStrings: Array<keyof ProposalTransitionReceipt> = [
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
	if (
		receipt.schemaVersion !== 1
		|| requiredStrings.some((key) => typeof receipt[key] !== 'string')
		|| requiredStrings.some((key) => (receipt[key] as string).length > 2048)
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
		|| Number.isNaN(Date.parse(receipt.committedAt || ''))
	) {
		throw new OperationConflictError('Journaled proposal transition receipt is invalid.');
	}
	return {
		schemaVersion: 1,
		operationId: receipt.operationId,
		payloadHash: receipt.payloadHash as string,
		kind: 'apply',
		proposalPath: receipt.proposalPath,
		proposalId: receipt.proposalId,
		taskId: receipt.taskId,
		previousStatus: 'approved',
		nextStatus: 'applied',
		expectedRevision: receipt.expectedRevision,
		expectedContentHash: receipt.expectedContentHash,
		previousRevision: receipt.previousRevision as string,
		committedRevision: receipt.committedRevision as string,
		previousContentHash: receipt.previousContentHash as string,
		committedContentHash: receipt.committedContentHash as string,
		committedAt: receipt.committedAt as string,
	};
}

function expectedTaskLinkReceipt(
	payload: ApplyApprovedWritebackPayload
): ApplyApprovedWritebackTaskLinkReceipt {
	return {
		taskPath: payload.taskPath,
		targetReferenceAdded:
			payload.taskId !== null && !payload.taskHadTargetReference,
		proposalReferenceAdded:
			payload.taskId !== null && !payload.taskHadProposalReference,
	};
}

function taskLinkReceiptFromStep(
	value: unknown,
	payload: ApplyApprovedWritebackPayload
): ApplyApprovedWritebackTaskLinkReceipt {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new OperationConflictError('Journaled task-link receipt is unavailable.');
	}
	const receipt = value as Partial<ApplyApprovedWritebackTaskLinkReceipt>;
	const keys = Object.keys(receipt).sort();
	const expected = expectedTaskLinkReceipt(payload);
	if (
		keys.length !== 3
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
		|| (
			payload.taskId === null
			&& (
				receipt.taskPath !== null
				|| receipt.targetReferenceAdded
				|| receipt.proposalReferenceAdded
			)
		)
		|| (payload.taskId !== null && receipt.taskPath === null)
	) {
		throw new OperationConflictError('Journaled task-link receipt is invalid.');
	}
	return {
		taskPath: receipt.taskPath,
		targetReferenceAdded: receipt.targetReferenceAdded,
		proposalReferenceAdded: receipt.proposalReferenceAdded,
	};
}

export class ApplyApprovedWritebackService {
	private readonly options: ApplyApprovedWritebackServiceOptions;

	constructor(options: ApplyApprovedWritebackServiceOptions) {
		this.options = options;
	}

	async execute(command: ApplyApprovedWritebackCommand): Promise<ApplyApprovedWritebackResult> {
		const payload = boundedWritebackPayload(command.payload);
		const existing = await this.options.journal.loadByIdempotencyKey<ApplyApprovedWritebackResult>(
			command.idempotencyKey
		);
		if (!existing && command.approvalStatus !== 'approved') {
			throw new ApplyApprovedWritebackApprovalError(command.approvalStatus);
		}
		const compensatePriorEffects = async (
			taskReceipt: ApplyApprovedWritebackTaskLinkReceipt,
			failureMessage: string
		): Promise<void> => {
			let compensationFailed = false;
			try {
				await this.options.port.rollbackTarget(payload, command.operationId);
			} catch {
				compensationFailed = true;
			}
			try {
				await this.options.port.rollbackTask(
					payload,
					command.operationId,
					taskReceipt
				);
			} catch {
				compensationFailed = true;
			}
			if (compensationFailed) {
				throw new OperationConflictError(failureMessage);
			}
		};

		const runner = new RecoverableOperationRunner<ApplyApprovedWritebackPayload, ApplyApprovedWritebackResult>({
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
							const receipt = await this.options.port.linkTask(
								payload,
								command.operationId
							);
							return taskLinkReceiptFromStep(receipt, payload);
						} catch (error: unknown) {
							if (isWritebackBoundaryConflict(error)) {
								try {
									await this.options.port.rollbackTarget(payload, command.operationId);
								} catch {
									throw new OperationConflictError(
										'Task-link transition conflicted and the target could not be safely compensated.'
									);
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
						const taskStep = context.completedSteps.find(
							(step) => step.name === 'link_task'
						);
						let taskReceipt: ApplyApprovedWritebackTaskLinkReceipt;
						try {
							taskReceipt = taskLinkReceiptFromStep(
								taskStep?.result,
								payload
							);
						} catch (error: unknown) {
							if (isWritebackBoundaryConflict(error)) {
								await compensatePriorEffects(
									expectedTaskLinkReceipt(payload),
									'Task-link receipt conflicted and prior effects could not be safely compensated.'
								);
							}
							throw error;
						}
						try {
							const receipt = await this.options.port.markProposalApplied(
								payload,
								command.operationId
							);
							return proposalTransitionReceiptFromStep(
								receipt,
								payload,
								command.operationId
							);
						} catch (error: unknown) {
							if (isProposalTransitionFailure(error)) {
								await compensatePriorEffects(
									taskReceipt,
									'Proposal transition conflicted and prior effects could not be safely compensated.'
								);
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
						const transitionStep = context.completedSteps.find(
							(step) => step.name === 'mark_proposal_applied'
						);
						const receipt = proposalTransitionReceiptFromStep(
							transitionStep?.result,
							payload,
							command.operationId
						);
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
