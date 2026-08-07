import {
	KNOWLEDGE_INDEX_PATH,
	KNOWLEDGE_MEMORY_DIR,
	KNOWLEDGE_WIKI_DIR,
	normalizeKnowledgePath,
	startsWithPathPrefix,
} from './knowledge-architecture';
import {
	computePayloadHash,
	OperationConflictError,
} from './operation-journal';
import {
	type VaultPath,
} from './knowledge-index';
import {
	type VaultRepository,
	type VaultWriteReceipt,
} from './vault-repository';

export const PROPOSAL_TRANSITION_SCHEMA_VERSION = 1 as const;

export type ProposalTransitionStatus =
	| 'pending'
	| 'approved'
	| 'rejected'
	| 'deferred'
	| 'revision_requested'
	| 'applied';

export type ProposalTransitionClassification =
	| 'memory_proposal'
	| 'legacy_migration_review'
	| 'other_review_item';

export type ProposalTransitionKind = 'status' | 'draft' | 'apply';

export interface ProposalTransitionReceipt {
	schemaVersion: typeof PROPOSAL_TRANSITION_SCHEMA_VERSION;
	operationId: string;
	payloadHash: string;
	kind: ProposalTransitionKind;
	proposalPath: string;
	proposalId: string;
	taskId: string;
	previousStatus: ProposalTransitionStatus;
	nextStatus: ProposalTransitionStatus;
	expectedRevision: string;
	expectedContentHash: string;
	previousRevision: string;
	committedRevision: string;
	previousContentHash: string;
	committedContentHash: string;
	committedAt: string;
}

export interface ProposalTransitionSnapshot {
	path: string;
	classification: ProposalTransitionClassification;
	proposalId: string;
	proposalKind: string;
	taskId: string;
	status: ProposalTransitionStatus;
	targetPath: string;
	writebackContent: string;
	revisionComment: string;
	revisionRequestedAt: string;
	revisionRequestedBy: string;
	archived?: boolean;
	appliedOperationId?: string;
	lastTransition?: ProposalTransitionReceipt;
}

export interface ProposalStatusTransitionAction {
	kind: 'status';
	nextStatus: ProposalTransitionStatus;
	clearRevision?: boolean;
	revisionComment?: string;
}

export interface ProposalDraftTransitionAction {
	kind: 'draft';
	targetPath: string;
	writebackContent: string;
}

export interface ProposalApplyTransitionAction {
	kind: 'apply';
}

export type ProposalTransitionAction =
	| ProposalStatusTransitionAction
	| ProposalDraftTransitionAction
	| ProposalApplyTransitionAction;

export interface ProposalTransitionCommand {
	expectedRevision: string;
	expectedContentHash?: string;
	operationId: string;
	action: ProposalTransitionAction;
}

export interface ProposalTransitionEnvironment {
	now: string;
	actor?: string;
	targetExists?: (relativePath: string) => boolean;
	targetAllowed?: (relativePath: string) => boolean;
	targetCreationAllowed?: (relativePath: string) => boolean;
}

export type ProposalFrontmatterMutationValue = string | string[] | null;

export interface ProposalTransitionDecision {
	state: ProposalTransitionSnapshot;
	receipt: ProposalTransitionReceipt;
	frontmatter: Readonly<Record<string, ProposalFrontmatterMutationValue>>;
	replayed: boolean;
}

export interface ProposalTransitionTextCodec {
	parse(relativePath: string, content: string): ProposalTransitionSnapshot;
	apply(
		content: string,
		decision: ProposalTransitionDecision
	): string;
}

export interface ProposalRepositoryTransitionCommand {
	proposalPath: VaultPath;
	expectedVersion?: string;
	transition: ProposalTransitionCommand;
	environment: ProposalTransitionEnvironment;
}

export interface ProposalRepositoryTransitionResult extends ProposalTransitionDecision {
	writeReceipt: VaultWriteReceipt | null;
}

export class ProposalTransitionValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProposalTransitionValidationError';
	}
}

export class ProposalTransitionStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProposalTransitionStateError';
	}
}

export class ProposalTransitionConflictError extends OperationConflictError {
	constructor(message: string) {
		super(message);
		this.name = 'ProposalTransitionConflictError';
	}
}

const STATUS_EDGES: Readonly<Record<ProposalTransitionStatus, readonly ProposalTransitionStatus[]>> = {
	pending: ['approved', 'rejected', 'revision_requested'],
	revision_requested: ['pending'],
	approved: ['pending', 'applied'],
	rejected: ['pending'],
	deferred: ['pending'],
	applied: [],
};

const CLASSIFICATIONS = new Set<ProposalTransitionClassification>([
	'memory_proposal',
	'legacy_migration_review',
	'other_review_item',
]);

const STATUSES = new Set<ProposalTransitionStatus>([
	'pending',
	'approved',
	'rejected',
	'deferred',
	'revision_requested',
	'applied',
]);

const INVALID_PROPOSAL_TEXT = new Set([
	'',
	'null',
	'undefined',
	'unknown',
	'none',
	'not specified',
	'not specified.',
	'not specified?',
	'none specified',
	'not available',
	'not linked',
	'na',
	'n/a',
	'unknown value',
	'未指定',
	'未知',
	'空白',
	'未填',
	'未关联',
]);

const normalizeText = (value: string): string => value.replace(/\r\n/g, '\n').trim();

const isMeaningfulProposalText = (value: string): boolean => {
	const normalized = normalizeText(value).toLowerCase().replace(/\s+/g, ' ');
	return !INVALID_PROPOSAL_TEXT.has(normalized);
};

const normalizeIdentifier = (value: string, label: string): string => {
	const normalized = normalizeText(value);
	if (!normalized || normalized.length > 512 || /[\r\n\0]/.test(normalized)) {
		throw new ProposalTransitionValidationError(`${label} is invalid.`);
	}
	return normalized;
};

const normalizeRelativeMarkdownPath = (value: string, label: string): string => {
	const trimmed = value.trim().replace(/\\/g, '/');
	if (
		!trimmed
		|| trimmed.startsWith('/')
		|| /^[A-Za-z]:\//.test(trimmed)
		|| trimmed.includes('\0')
	) {
		throw new ProposalTransitionValidationError(`${label} must be a Vault-relative Markdown path.`);
	}
	const segments = trimmed.split('/');
	if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
		throw new ProposalTransitionValidationError(`${label} must be a Vault-relative Markdown path.`);
	}
	const normalized = normalizeKnowledgePath(trimmed);
	if (!normalized.toLowerCase().endsWith('.md')) {
		throw new ProposalTransitionValidationError(`${label} must be a Vault-relative Markdown path.`);
	}
	return normalized;
};

export function normalizeProposalTargetPath(value: string): string {
	if (!value.trim()) {
		return '';
	}
	return normalizeRelativeMarkdownPath(value, 'Proposal target');
}

export function isAllowedProposalTargetPath(value: string): boolean {
	let normalized = '';
	try {
		normalized = normalizeProposalTargetPath(value);
	} catch {
		return false;
	}
	return normalized === KNOWLEDGE_INDEX_PATH
		|| startsWithPathPrefix(normalized, KNOWLEDGE_MEMORY_DIR)
		|| startsWithPathPrefix(normalized, KNOWLEDGE_WIKI_DIR);
}

const receiptRevisionBasis = (receipt: ProposalTransitionReceipt | undefined): unknown => {
	if (!receipt) {
		return null;
	}
	return {
		schemaVersion: receipt.schemaVersion,
		operationId: receipt.operationId,
		payloadHash: receipt.payloadHash,
		kind: receipt.kind,
		expectedRevision: receipt.expectedRevision,
		expectedContentHash: receipt.expectedContentHash,
		previousStatus: receipt.previousStatus,
		nextStatus: receipt.nextStatus,
		committedAt: receipt.committedAt,
	};
};

const revisionContent = (snapshot: ProposalTransitionSnapshot): unknown => ({
	path: snapshot.path,
	classification: snapshot.classification,
	proposalId: snapshot.proposalId,
	proposalKind: snapshot.proposalKind,
	taskId: snapshot.taskId,
	status: snapshot.status,
	targetPath: snapshot.targetPath,
	revisionCommentHash: computePayloadHash(normalizeText(snapshot.revisionComment)),
	revisionRequestedAt: snapshot.revisionRequestedAt,
	revisionRequestedBy: snapshot.revisionRequestedBy,
	archived: Boolean(snapshot.archived),
	appliedOperationId: snapshot.appliedOperationId || '',
});

export function computeProposalContentHash(snapshot: ProposalTransitionSnapshot): string {
	return computePayloadHash({
		schemaVersion: PROPOSAL_TRANSITION_SCHEMA_VERSION,
		proposal: revisionContent(snapshot),
		writebackContentHash: computePayloadHash(normalizeText(snapshot.writebackContent)),
	});
}

export function computeProposalRevision(snapshot: ProposalTransitionSnapshot): string {
	return computePayloadHash({
		schemaVersion: PROPOSAL_TRANSITION_SCHEMA_VERSION,
		proposal: revisionContent(snapshot),
		lastTransition: receiptRevisionBasis(snapshot.lastTransition),
	});
}

export function computeProposalTransitionPayloadHash(action: ProposalTransitionAction): string {
	switch (action.kind) {
		case 'status':
			return computePayloadHash({
				kind: action.kind,
				nextStatus: action.nextStatus,
				clearRevision: Boolean(action.clearRevision),
				revisionComment: normalizeText(action.revisionComment || ''),
			});
		case 'draft':
			return computePayloadHash({
				kind: action.kind,
				targetPath: normalizeProposalTargetPath(action.targetPath),
				writebackContent: normalizeText(action.writebackContent),
			});
		case 'apply':
			return computePayloadHash({ kind: action.kind });
	}
}

const ensureSnapshotIdentity = (snapshot: ProposalTransitionSnapshot): void => {
	if (normalizeRelativeMarkdownPath(snapshot.path, 'Proposal path') !== snapshot.path) {
		throw new ProposalTransitionValidationError('Proposal path is not normalized.');
	}
	if (normalizeIdentifier(snapshot.proposalId, 'Proposal id') !== snapshot.proposalId) {
		throw new ProposalTransitionValidationError('Proposal id is not normalized.');
	}
	if (normalizeIdentifier(snapshot.proposalKind, 'Proposal kind') !== snapshot.proposalKind) {
		throw new ProposalTransitionValidationError('Proposal kind is not normalized.');
	}
	if (!CLASSIFICATIONS.has(snapshot.classification)) {
		throw new ProposalTransitionValidationError('Proposal classification is invalid.');
	}
	if (!STATUSES.has(snapshot.status)) {
		throw new ProposalTransitionValidationError('Proposal status is invalid.');
	}
	if (snapshot.taskId) {
		if (normalizeIdentifier(snapshot.taskId, 'Task id') !== snapshot.taskId) {
			throw new ProposalTransitionValidationError('Task id is not normalized.');
		}
	}
	if (snapshot.lastTransition) {
		const receipt = snapshot.lastTransition;
		if (
			receipt.schemaVersion !== PROPOSAL_TRANSITION_SCHEMA_VERSION
			|| receipt.proposalPath !== snapshot.path
			|| receipt.proposalId !== snapshot.proposalId
			|| receipt.taskId !== snapshot.taskId
			|| receipt.nextStatus !== snapshot.status
			|| receipt.committedRevision !== computeProposalRevision(snapshot)
		) {
			throw new ProposalTransitionConflictError(
				'Proposal transition receipt does not match the current proposal.'
			);
		}
	}
};

const ensureAllowedTarget = (
	targetPath: string,
	environment: ProposalTransitionEnvironment,
	allowCreation = false
): string => {
	const normalized = normalizeProposalTargetPath(targetPath);
	if (!normalized) {
		throw new ProposalTransitionValidationError('Proposal target is required.');
	}
	const allowed = environment.targetAllowed
		? environment.targetAllowed(normalized)
		: isAllowedProposalTargetPath(normalized);
	if (!allowed) {
		throw new ProposalTransitionValidationError('Proposal target is outside the allowed Memory or Wiki boundary.');
	}
	const exists = Boolean(environment.targetExists?.(normalized));
	const creationAllowed = allowCreation
		&& Boolean(environment.targetCreationAllowed?.(normalized));
	if (!exists && !creationAllowed) {
		throw new ProposalTransitionValidationError('Proposal target does not exist.');
	}
	return normalized;
};

const ensureCompleteMemoryProposal = (
	snapshot: ProposalTransitionSnapshot,
	environment: ProposalTransitionEnvironment
): string => {
	if (snapshot.classification !== 'memory_proposal') {
		throw new ProposalTransitionValidationError('Only memory proposals can use the writeback transition.');
	}
	const targetPath = ensureAllowedTarget(snapshot.targetPath, environment, true);
	if (!isMeaningfulProposalText(snapshot.writebackContent)) {
		throw new ProposalTransitionValidationError('Proposal writeback content is required.');
	}
	return targetPath;
};

const ensureStatusEdge = (
	current: ProposalTransitionStatus,
	next: ProposalTransitionStatus
): void => {
	if (!STATUS_EDGES[current].includes(next)) {
		throw new ProposalTransitionStateError(`Proposal transition ${current} -> ${next} is not allowed.`);
	}
};

const sameReceipt = (
	snapshot: ProposalTransitionSnapshot,
	command: ProposalTransitionCommand,
	payloadHash: string
): ProposalTransitionReceipt | null => {
	const receipt = snapshot.lastTransition;
	if (!receipt || receipt.operationId !== command.operationId) {
		return null;
	}
	if (
		receipt.schemaVersion !== PROPOSAL_TRANSITION_SCHEMA_VERSION
		|| receipt.proposalPath !== snapshot.path
		|| receipt.proposalId !== snapshot.proposalId
		|| receipt.taskId !== snapshot.taskId
		|| receipt.nextStatus !== snapshot.status
	) {
		throw new ProposalTransitionConflictError('Proposal transition receipt does not match the current proposal.');
	}
	if (
		receipt.payloadHash !== payloadHash
		|| receipt.expectedRevision !== command.expectedRevision
		|| receipt.expectedContentHash !== (command.expectedContentHash || '')
	) {
		throw new ProposalTransitionConflictError('Proposal operation was already used with a different revision or payload.');
	}
	if (
		receipt.committedRevision !== computeProposalRevision(snapshot)
		|| receipt.committedContentHash !== computeProposalContentHash(snapshot)
	) {
		throw new ProposalTransitionConflictError('Proposal changed after the committed operation.');
	}
	return receipt;
};

const transitionMetadata = (
	receipt: ProposalTransitionReceipt
): Readonly<Record<string, ProposalFrontmatterMutationValue>> => ({
	review_transition_schema: receipt.schemaVersion.toString(),
	review_transition_id: receipt.operationId,
	review_transition_payload_hash: receipt.payloadHash,
	review_transition_kind: receipt.kind,
	review_transition_proposal_path: receipt.proposalPath,
	review_transition_proposal_id: receipt.proposalId,
	review_transition_task_id: receipt.taskId,
	review_transition_expected_revision: receipt.expectedRevision,
	review_transition_expected_content_hash: receipt.expectedContentHash,
	review_transition_previous_revision: receipt.previousRevision,
	review_transition_committed_revision: receipt.committedRevision,
	review_transition_previous_status: receipt.previousStatus,
	review_transition_next_status: receipt.nextStatus,
	review_transition_previous_content_hash: receipt.previousContentHash,
	review_transition_committed_content_hash: receipt.committedContentHash,
	review_transition_at: receipt.committedAt,
});

const assignCanonicalStatus = (
	mutation: Record<string, ProposalFrontmatterMutationValue>,
	status: ProposalTransitionStatus
): void => {
	mutation.approval_status = status;
	mutation.approvalStatus = null;
	mutation.status = status;
};

const assignCanonicalTarget = (
	mutation: Record<string, ProposalFrontmatterMutationValue>,
	targetPath: string
): void => {
	mutation.target_note = targetPath;
	mutation.targetNote = null;
	mutation.target_path = null;
	mutation.targetPath = null;
};

const assignCanonicalWriteback = (
	mutation: Record<string, ProposalFrontmatterMutationValue>,
	writebackContent: string
): void => {
	mutation.writeback_content = writebackContent;
	mutation.writebackContent = null;
};

const frontmatterString = (
	frontmatter: Readonly<Record<string, unknown>>,
	key: string
): string => {
	const value = frontmatter[key];
	if (typeof value === 'string') {
		return value.trim();
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value.toString();
	}
	return '';
};

export function proposalTransitionReceiptFromFrontmatter(
	frontmatter: Readonly<Record<string, unknown>>
): ProposalTransitionReceipt | undefined {
	const operationId = frontmatterString(frontmatter, 'review_transition_id');
	if (!operationId) {
		if (Object.keys(frontmatter).some((key) => key.startsWith('review_transition_'))) {
			throw new ProposalTransitionValidationError('Proposal transition receipt metadata is incomplete.');
		}
		return undefined;
	}
	const schemaVersion = Number(frontmatterString(frontmatter, 'review_transition_schema'));
	const kind = frontmatterString(frontmatter, 'review_transition_kind');
	const previousStatus = frontmatterString(
		frontmatter,
		'review_transition_previous_status'
	);
	const nextStatus = frontmatterString(frontmatter, 'review_transition_next_status');
	const receipt: ProposalTransitionReceipt = {
		schemaVersion: schemaVersion as typeof PROPOSAL_TRANSITION_SCHEMA_VERSION,
		operationId,
		payloadHash: frontmatterString(frontmatter, 'review_transition_payload_hash'),
		kind: kind as ProposalTransitionKind,
		proposalPath: frontmatterString(frontmatter, 'review_transition_proposal_path'),
		proposalId: frontmatterString(frontmatter, 'review_transition_proposal_id'),
		taskId: frontmatterString(frontmatter, 'review_transition_task_id'),
		previousStatus: previousStatus as ProposalTransitionStatus,
		nextStatus: nextStatus as ProposalTransitionStatus,
		expectedRevision: frontmatterString(
			frontmatter,
			'review_transition_expected_revision'
		),
		expectedContentHash: frontmatterString(
			frontmatter,
			'review_transition_expected_content_hash'
		),
		previousRevision: frontmatterString(
			frontmatter,
			'review_transition_previous_revision'
		),
		committedRevision: frontmatterString(
			frontmatter,
			'review_transition_committed_revision'
		),
		previousContentHash: frontmatterString(
			frontmatter,
			'review_transition_previous_content_hash'
		),
		committedContentHash: frontmatterString(
			frontmatter,
			'review_transition_committed_content_hash'
		),
		committedAt: frontmatterString(frontmatter, 'review_transition_at'),
	};
	if (
		receipt.schemaVersion !== PROPOSAL_TRANSITION_SCHEMA_VERSION
		|| !receipt.operationId
		|| !receipt.payloadHash
		|| !['status', 'draft', 'apply'].includes(receipt.kind)
		|| !receipt.proposalPath
		|| !receipt.proposalId
		|| !STATUSES.has(receipt.previousStatus)
		|| !STATUSES.has(receipt.nextStatus)
		|| !receipt.expectedRevision
		|| !receipt.previousRevision
		|| !receipt.committedRevision
		|| !receipt.previousContentHash
		|| !receipt.committedContentHash
		|| !receipt.committedAt
	) {
		throw new ProposalTransitionValidationError('Proposal transition receipt metadata is incomplete.');
	}
	return receipt;
}

export function transitionProposal(
	current: ProposalTransitionSnapshot,
	command: ProposalTransitionCommand,
	environment: ProposalTransitionEnvironment
): ProposalTransitionDecision {
	ensureSnapshotIdentity(current);
	const operationId = normalizeIdentifier(command.operationId, 'Operation id');
	if (operationId !== command.operationId) {
		throw new ProposalTransitionValidationError('Operation id is not normalized.');
	}
	const expectedRevision = normalizeIdentifier(command.expectedRevision, 'Expected revision');
	if (expectedRevision !== command.expectedRevision) {
		throw new ProposalTransitionValidationError('Expected revision is not normalized.');
	}
	const expectedContentHash = command.expectedContentHash
		? normalizeIdentifier(command.expectedContentHash, 'Expected content hash')
		: '';
	if (expectedContentHash !== (command.expectedContentHash || '')) {
		throw new ProposalTransitionValidationError('Expected content hash is not normalized.');
	}
	const committedAt = normalizeIdentifier(environment.now, 'Transition time');
	if (Number.isNaN(Date.parse(committedAt))) {
		throw new ProposalTransitionValidationError('Transition time is invalid.');
	}
	const payloadHash = computeProposalTransitionPayloadHash(command.action);
	if (current.archived) {
		throw new ProposalTransitionStateError('Archived proposals cannot be changed.');
	}
	const replayReceipt = sameReceipt(current, command, payloadHash);
	if (replayReceipt) {
		return {
			state: current,
			receipt: replayReceipt,
			frontmatter: {},
			replayed: true,
		};
	}

	const previousRevision = computeProposalRevision(current);
	if (previousRevision !== expectedRevision) {
		throw new ProposalTransitionConflictError('Proposal revision changed before the transition.');
	}
	const next: ProposalTransitionSnapshot = {
		...current,
		lastTransition: undefined,
	};
	const mutation: Record<string, ProposalFrontmatterMutationValue> = {};

	switch (command.action.kind) {
		case 'status': {
			if (command.action.nextStatus === 'applied') {
				if (current.classification === 'memory_proposal') {
					throw new ProposalTransitionStateError('Applied status requires the writeback apply transition.');
				}
				if (current.status !== 'pending') {
					throw new ProposalTransitionStateError(
						`Proposal transition ${current.status} -> applied is not allowed.`
					);
				}
			} else if (
				current.status === 'revision_requested'
				&& command.action.nextStatus === 'revision_requested'
			) {
				if (!normalizeText(command.action.revisionComment || '')) {
					throw new ProposalTransitionStateError(
						'Updating a revision request requires a revision comment.'
					);
				}
			} else {
				ensureStatusEdge(current.status, command.action.nextStatus);
			}
			if (
				command.action.nextStatus === 'approved'
				&& current.classification === 'memory_proposal'
			) {
				if (!expectedContentHash) {
					throw new ProposalTransitionValidationError('Approval requires the expected proposal content hash.');
				}
				if (computeProposalContentHash(current) !== expectedContentHash) {
					throw new ProposalTransitionConflictError('Proposal content changed before approval.');
				}
				next.targetPath = ensureCompleteMemoryProposal(current, environment);
				assignCanonicalTarget(mutation, next.targetPath);
			}
			next.status = command.action.nextStatus;
			assignCanonicalStatus(mutation, next.status);
			if (next.status === 'revision_requested') {
				next.revisionComment = normalizeText(command.action.revisionComment || '');
				next.revisionRequestedAt = committedAt;
				next.revisionRequestedBy = environment.actor || 'user';
				mutation.revision_comment = next.revisionComment
					? next.revisionComment.split('\n')
					: null;
				mutation.revisionComment = null;
				mutation.revision_requested_at = next.revisionRequestedAt;
				mutation.revisionRequestedAt = null;
				mutation.revision_requested_by = next.revisionRequestedBy;
				mutation.revisionRequestedBy = null;
			} else if (command.action.clearRevision) {
				next.revisionComment = '';
				next.revisionRequestedAt = '';
				next.revisionRequestedBy = '';
				mutation.revision_comment = null;
				mutation.revisionComment = null;
				mutation.revision_requested_at = null;
				mutation.revisionRequestedAt = null;
				mutation.revision_requested_by = null;
				mutation.revisionRequestedBy = null;
			}
			break;
		}
		case 'draft': {
			if (!expectedContentHash) {
				throw new ProposalTransitionValidationError('Draft update requires the expected proposal content hash.');
			}
			if (computeProposalContentHash(current) !== expectedContentHash) {
				throw new ProposalTransitionConflictError('Proposal content changed before the draft update.');
			}
			if (current.classification !== 'memory_proposal') {
				throw new ProposalTransitionValidationError('Only memory proposals can be edited.');
			}
			if (current.status !== 'pending' && current.status !== 'revision_requested') {
				throw new ProposalTransitionStateError('Only pending or revision-requested proposals can be edited.');
			}
			const targetPath = command.action.targetPath.trim()
				? ensureAllowedTarget(command.action.targetPath, environment)
				: '';
			next.targetPath = targetPath;
			next.writebackContent = normalizeText(command.action.writebackContent);
			assignCanonicalTarget(mutation, next.targetPath);
			assignCanonicalWriteback(mutation, next.writebackContent);
			break;
		}
		case 'apply': {
			if (!expectedContentHash) {
				throw new ProposalTransitionValidationError('Apply requires the expected proposal content hash.');
			}
			if (computeProposalContentHash(current) !== expectedContentHash) {
				throw new ProposalTransitionConflictError('Proposal content changed before apply.');
			}
			ensureStatusEdge(current.status, 'applied');
			next.targetPath = ensureCompleteMemoryProposal(current, environment);
			next.status = 'applied';
			next.appliedOperationId = command.operationId;
			assignCanonicalTarget(mutation, next.targetPath);
			assignCanonicalStatus(mutation, 'applied');
			mutation.writeback_applied_at = committedAt;
			mutation.writeback_target = next.targetPath;
			mutation.writeback_operation_id = command.operationId;
			break;
		}
	}

	const previousContentHash = computeProposalContentHash(current);
	const receiptSeed: ProposalTransitionReceipt = {
		schemaVersion: PROPOSAL_TRANSITION_SCHEMA_VERSION,
		operationId: command.operationId,
		payloadHash,
		kind: command.action.kind,
		proposalPath: current.path,
		proposalId: current.proposalId,
		taskId: current.taskId,
		previousStatus: current.status,
		nextStatus: next.status,
		expectedRevision,
		expectedContentHash,
		previousRevision,
		committedRevision: '',
		previousContentHash,
		committedContentHash: '',
		committedAt,
	};
	next.lastTransition = receiptSeed;
	const committedContentHash = computeProposalContentHash(next);
	const committedRevision = computeProposalRevision(next);
	const receipt: ProposalTransitionReceipt = {
		...receiptSeed,
		committedRevision,
		committedContentHash,
	};
	next.lastTransition = receipt;

	return {
		state: next,
		receipt,
		frontmatter: {
			...mutation,
			...transitionMetadata(receipt),
		},
		replayed: false,
	};
}

export async function commitProposalTransitionWithRepository(
	repository: VaultRepository,
	codec: ProposalTransitionTextCodec,
	command: ProposalRepositoryTransitionCommand
): Promise<ProposalRepositoryTransitionResult> {
	const currentFile = await repository.readText(command.proposalPath);
	if (!currentFile) {
		throw new ProposalTransitionConflictError('Proposal does not exist.');
	}
	const snapshot = codec.parse(currentFile.path, currentFile.content);
	const decision = transitionProposal(snapshot, command.transition, command.environment);
	if (decision.replayed) {
		return {
			...decision,
			writeReceipt: null,
		};
	}
	if (command.expectedVersion && currentFile.version !== command.expectedVersion) {
		throw new ProposalTransitionConflictError('Proposal repository version changed before the transition.');
	}
	const nextContent = codec.apply(currentFile.content, decision);
	const writeReceipt = await repository.replaceText(
		currentFile.path,
		currentFile.version,
		nextContent
	);
	return {
		...decision,
		writeReceipt,
	};
}
