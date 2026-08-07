import {
	ARCHIVE_REVIEW_QUEUE_DIR,
	computeProposalContentHash,
	computeProposalRevision,
	proposalTransitionReceiptFromFrontmatter,
	type ProposalTransitionReceipt,
	type ProposalTransitionSnapshot,
} from '@tracekeeper/core';
import { isReviewApprovalTargetPath } from './review-target-policy';

type ParsedRecordValue = string | string[];

type ParsedRecord = Record<string, ParsedRecordValue>;

export type MemoryProposalStatus =
	| 'pending'
	| 'approved'
	| 'rejected'
	| 'deferred'
	| 'revision_requested'
	| 'applied';

export type ReviewProposalAttentionState =
	| 'incomplete'
	| 'pending_review'
	| 'awaiting_revision'
	| 'ready_to_apply'
	| 'completed';

export type ReviewQueueItemType =
	| 'memory_proposal'
	| 'legacy_migration_review'
	| 'other_review_item';

export interface MemoryProposalRecord {
	path: string;
	classification: ReviewQueueItemType;
	proposalId: string;
	proposalKind: string;
	proposedBy: string;
	relatedProject: string;
	memoryScope: string;
	projectId: string;
	claimKey: string;
	proposedAuthority: string;
	proposedConfidence: string;
	reviewReason: string;
	reviewWarnings: string[];
	declaredState: string;
	observedAt: string;
	validFrom: string;
	validTo: string;
	lastVerifiedAt: string;
	supersedes: string[];
	contradicts: string[];
	taskId: string;
	sourceSessionNote: string;
	targetNote: string;
	evidence: string[];
	relatedSources: string[];
	rationale: string;
	riskLevel: string;
	approvalStatus: MemoryProposalStatus;
	created: string;
	snippet: string;
	sortTimestamp: number;
	revisionComment: string;
	revisionRequestedAt: string;
	revisionRequestedBy: string;
	writebackContent: string;
	writebackSource: 'frontmatter' | 'body' | 'none';
	archived: boolean;
	contentHash: string;
	fileContentHash: string;
	revision: string;
	lastTransition?: ProposalTransitionReceipt;
}

export interface ReviewProposalValidity {
	hasTargetNote: boolean;
	targetPathAllowed: boolean;
	targetExists: boolean;
	targetResolved: boolean;
	hasWritebackContent: boolean;
	missingTargetNote: boolean;
	invalidTargetNote: boolean;
	missingTargetEvidence: boolean;
	missingWritebackContent: boolean;
	isComplete: boolean;
}

export interface ReviewProposalTargetResolution {
	exists?: boolean;
}

interface MemoryProposalParseInput {
	filePath: string;
	fields: ParsedRecord;
	body: string;
	fileMtime?: number;
	fileContentHash?: string;
}

const INVALID_PROPOSAL_VALUE = new Set([
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

const normalizeProposalText = (value: string): string => {
	const trimmed = value.trim();
	if (!trimmed) {
		return '';
	}
	const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ');
	if (INVALID_PROPOSAL_VALUE.has(normalized)) {
		return '';
	}
	return trimmed;
};

export const normalizeProposalStatus = (rawStatus?: string): MemoryProposalStatus => {
	const status = (rawStatus || 'pending').toLowerCase().trim();
	if (
		status === 'approved' ||
		status === 'rejected' ||
		status === 'deferred' ||
		status === 'revision_requested' ||
		status === 'applied'
	) {
		return status;
	}
	if (status === 'pending_review') {
		return 'pending';
	}
	return 'pending';
};

const firstString = (values: ParsedRecord, keys: string[]): string => {
	for (const key of keys) {
		const value = values[key];
		if (typeof value === 'string') {
			const normalized = normalizeProposalText(value);
			if (normalized) {
				return normalized;
			}
		}
		if (Array.isArray(value)) {
			const first = value.find(
				(entry): boolean => Boolean(typeof entry === 'string' && normalizeProposalText(entry))
			);
			if (first) {
				return normalizeProposalText(first.toString());
			}
		}
	}
	return '';
};

const readStringList = (values: ParsedRecord, keys: string[]): string[] => {
	const items: string[] = [];
	for (const key of keys) {
		const value = values[key];
		if (!value) continue;
		if (Array.isArray(value)) {
			items.push(
				...value
					.filter((entry): entry is string => typeof entry === 'string')
					.map((entry) => normalizeProposalText(entry))
					.filter(Boolean)
			);
			continue;
		}
		items.push(
			...value.split(',').map((entry) => normalizeProposalText(entry)).filter(Boolean)
		);
	}
	return [...new Set(items)];
};

const readMultilineString = (values: ParsedRecord, keys: string[]): string => {
	for (const key of keys) {
		const value = values[key];
		if (Array.isArray(value)) {
			const joined = value.join('\n').trim();
			if (joined && normalizeProposalText(joined)) {
				return joined;
			}
			continue;
		}
		if (typeof value === 'string') {
			const normalized = normalizeProposalText(value.replace(/\\n/g, '\n'));
			if (normalized) {
				return normalized;
			}
		}
	}
	return '';
};

const trimText = (value: string, maxLength = 280): string => {
	const trimmed = value.trim();
	if (trimmed.length <= maxLength) {
		return trimmed;
	}
	return `${trimmed.slice(0, maxLength - 1)}…`;
};

const parseTimestamp = (timestamp: string | undefined, fallbackMs?: number): number => {
	if (timestamp) {
		const parsed = Date.parse(timestamp);
		if (!Number.isNaN(parsed)) {
			return parsed;
		}
	}
	if (fallbackMs) {
		return fallbackMs;
	}
	return 0;
};

const extractSectionText = (body: string, sectionNames: string[]): string => {
	const normalized = body.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const normalizedSectionNames = new Set(sectionNames.map((name) => name.trim().toLowerCase()));

	const isHeading = (line: string): string | null => {
		const match = line.match(/^\s*#{2,}\s*(.+?)\s*$/);
		return match ? match[1].trim().replace(/\s+/g, ' ').toLowerCase() : null;
	};

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const heading = isHeading(lines[lineIndex]);
		if (!heading || !normalizedSectionNames.has(heading)) {
			continue;
		}

		const contentLines: string[] = [];
		for (let nextIndex = lineIndex + 1; nextIndex < lines.length; nextIndex += 1) {
			if (isHeading(lines[nextIndex])) {
				break;
			}
			contentLines.push(lines[nextIndex]);
		}
		return contentLines.join('\n').trim();
	}
	return '';
};

const isMeaningfulProposalValue = (value: string): boolean => Boolean(normalizeProposalText(value));

export const getReviewProposalValidity = (
	proposal: MemoryProposalRecord,
	targetResolution: ReviewProposalTargetResolution = {}
): ReviewProposalValidity => {
	if (proposal.classification !== 'memory_proposal') {
		return {
			hasTargetNote: true,
			targetPathAllowed: true,
			targetExists: true,
			targetResolved: true,
			hasWritebackContent: true,
			missingTargetNote: false,
			invalidTargetNote: false,
			missingTargetEvidence: false,
			missingWritebackContent: false,
			isComplete: true,
		};
	}

	const hasTargetNote = isMeaningfulProposalValue(proposal.targetNote);
	const targetPathAllowed = hasTargetNote && isReviewApprovalTargetPath(proposal.targetNote);
	const targetExists = hasTargetNote && targetResolution.exists !== false;
	const lifecycleCreate = Boolean(proposal.claimKey && hasTargetNote && targetPathAllowed);
	const targetResolved = hasTargetNote && targetPathAllowed && (targetExists || lifecycleCreate);
	const hasWritebackContent = isMeaningfulProposalValue(proposal.writebackContent);
	return {
		hasTargetNote,
		targetPathAllowed,
		targetExists,
		targetResolved,
		hasWritebackContent,
		missingTargetNote: !hasTargetNote,
		invalidTargetNote: hasTargetNote && !targetPathAllowed,
		missingTargetEvidence: hasTargetNote && targetPathAllowed && !targetExists && !lifecycleCreate,
		missingWritebackContent: !hasWritebackContent,
		isComplete: targetResolved && hasWritebackContent,
	};
};

export const getReviewProposalAttentionState = (
	proposal: MemoryProposalRecord,
	targetResolution: ReviewProposalTargetResolution = {}
): ReviewProposalAttentionState => {
	const validity = getReviewProposalValidity(proposal, targetResolution);
	if (proposal.approvalStatus === 'approved') {
		if (proposal.classification === 'memory_proposal' && !validity.isComplete) {
			return 'incomplete';
		}
		return proposal.classification === 'memory_proposal' ? 'ready_to_apply' : 'completed';
	}
	if (proposal.approvalStatus === 'revision_requested') {
		return 'awaiting_revision';
	}
	if (proposal.approvalStatus === 'applied' || proposal.approvalStatus === 'rejected' || proposal.approvalStatus === 'deferred') {
		return 'completed';
	}
	if (proposal.approvalStatus === 'pending') {
		if (!validity.isComplete && proposal.classification === 'memory_proposal') {
			return 'incomplete';
		}
		return 'pending_review';
	}
	return 'pending_review';
};

const snippetFromText = (text: string, fallback: string = ''): string => {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.filter((line) => !line.startsWith('#'))
		.filter((line) => !line.startsWith('---'));

	const raw = lines.length > 0 ? lines[0] : trimText(fallback);
	return trimText(raw, 160);
};

export const compareProposalRecords = (a: MemoryProposalRecord, b: MemoryProposalRecord): number => {
	const statusRank: Record<MemoryProposalStatus, number> = {
		pending: 0,
		revision_requested: 1,
		approved: 2,
		applied: 3,
		deferred: 4,
		rejected: 5,
	};
	const rankA = statusRank[a.approvalStatus] ?? 1;
	const rankB = statusRank[b.approvalStatus] ?? 1;
	if (rankA !== rankB) {
		return rankA - rankB;
	}
	return b.sortTimestamp - a.sortTimestamp;
};

export const extractMemoryProposalWritebackContent = (data: ParsedRecord, body: string): string => {
	const frontmatterWriteback = readMultilineString(data, ['writeback_content', 'writebackContent']);
	if (frontmatterWriteback) {
		return normalizeProposalText(frontmatterWriteback.replace(/\\n/g, '\n'));
	}
	const section = extractSectionText(body, ['Writeback', 'Approved writeback', 'Writeback content', '写回', '已批准写回', '写回内容']);
	return normalizeProposalText(section);
};

export const proposalTransitionSnapshotFromRecord = (
	proposal: MemoryProposalRecord
): ProposalTransitionSnapshot => ({
	path: proposal.path,
	classification: proposal.classification,
	proposalId: proposal.proposalId,
	proposalKind: proposal.proposalKind,
	taskId: proposal.taskId,
	status: proposal.approvalStatus,
	targetPath: proposal.targetNote,
	writebackContent: proposal.writebackContent,
	revisionComment: proposal.revisionComment,
	revisionRequestedAt: proposal.revisionRequestedAt,
	revisionRequestedBy: proposal.revisionRequestedBy,
	archived: proposal.archived,
	appliedOperationId: proposal.lastTransition?.kind === 'apply'
		? proposal.lastTransition.operationId
		: undefined,
	lastTransition: proposal.lastTransition,
});

export const extractMemoryProposalRationale = (data: ParsedRecord, body: string): string => {
	const frontmatterRationale = readMultilineString(data, [
		'rationale',
		'change_rationale',
		'changeRationale',
		'reason',
		'purpose',
	]);
	if (frontmatterRationale) {
		return normalizeProposalText(frontmatterRationale.replace(/\\n/g, '\n'));
	}
	const section = extractSectionText(body, [
		'Rationale',
		'Change rationale',
		'Reason',
		'变更理由',
		'理由',
	]);
	return normalizeProposalText(section);
};

export const parseMemoryProposalRecord = ({
	filePath,
	fields,
	body,
	fileMtime,
	fileContentHash,
}: MemoryProposalParseInput): MemoryProposalRecord | null => {
	const proposalType = firstString(fields, ['type']);
	const normalizedProposalType = proposalType.toLowerCase().replace(/_/g, '-');
	const proposalKind = firstString(fields, ['proposal_kind', 'proposalKind']);
	let classification: ReviewQueueItemType | null = null;
	if (normalizedProposalType.includes('memory-proposal')) {
		classification = 'memory_proposal';
	} else if (normalizedProposalType.includes('legacy-migration-review')) {
		classification = 'legacy_migration_review';
	} else if (proposalKind) {
		classification = proposalType ? 'other_review_item' : 'memory_proposal';
	}

	if (!classification) {
		return null;
	}

	const created = firstString(fields, ['created']);
	const proposalId = firstString(fields, ['proposal_id', 'proposalId'])
		|| filePath.split('/').pop() || '';
	const approvalStatus = normalizeProposalStatus(
		firstString(fields, ['approval_status', 'approvalStatus'])
	);
	const sortTimestamp = parseTimestamp(created, fileMtime);
	const revisionComment = readMultilineString(fields, ['revision_comment', 'revisionComment']);
	const revisionRequestedAt = firstString(fields, ['revision_requested_at', 'revisionRequestedAt']);
	const revisionRequestedBy = firstString(fields, ['revision_requested_by', 'revisionRequestedBy']);
	const frontmatterWriteback = readMultilineString(fields, ['writeback_content', 'writebackContent']);
	const writebackContent = extractMemoryProposalWritebackContent(fields, body);
	const writebackSource: MemoryProposalRecord['writebackSource'] = frontmatterWriteback
		? 'frontmatter'
		: writebackContent
			? 'body'
			: 'none';
	const rationale = extractMemoryProposalRationale(fields, body);
	const lastTransition = proposalTransitionReceiptFromFrontmatter(
		fields as Readonly<Record<string, unknown>>
	);

	const recordBase = {
		path: filePath,
		classification,
		proposalId,
		proposalKind: proposalKind || classification,
		proposedBy: firstString(fields, ['proposed_by', 'proposedBy']) || 'unknown',
		relatedProject: firstString(fields, ['related_project', 'relatedProject', 'project_hint', 'projectHint']) || '',
		memoryScope: firstString(fields, ['memory_scope', 'memoryScope']) || '',
		projectId: firstString(fields, ['project_id', 'projectId']) || '',
		claimKey: firstString(fields, ['claim_key', 'claimKey']) || '',
		proposedAuthority: firstString(fields, ['proposed_authority', 'proposedAuthority']) || '',
		proposedConfidence: firstString(fields, ['proposed_confidence', 'proposedConfidence']) || '',
		reviewReason: firstString(fields, ['review_reason', 'reviewReason']) || '',
		reviewWarnings: readStringList(fields, ['review_warnings', 'reviewWarnings']),
		declaredState: firstString(fields, ['declared_state', 'declaredState']) || '',
		observedAt: firstString(fields, ['observed_at', 'observedAt']) || '',
		validFrom: firstString(fields, ['valid_from', 'validFrom']) || '',
		validTo: firstString(fields, ['valid_to', 'validTo']) || '',
		lastVerifiedAt: firstString(fields, ['last_verified_at', 'lastVerifiedAt']) || '',
		supersedes: readStringList(fields, ['supersedes']),
		contradicts: readStringList(fields, ['contradicts']),
		taskId: firstString(fields, ['task_id', 'taskId']) || '',
		sourceSessionNote: firstString(fields, ['proposal_source_session_note', 'proposalSourceSessionNote', 'session_note', 'sessionNote']) || '',
		targetNote: firstString(fields, ['target_note', 'targetNote', 'target_path', 'targetPath']) || '',
		evidence: readStringList(fields, ['evidence']),
		relatedSources: readStringList(fields, ['related_sources', 'relatedSources']),
		rationale,
		riskLevel: firstString(fields, ['risk_level', 'riskLevel', 'risk']) || 'unknown',
		approvalStatus,
		created,
		snippet: snippetFromText(body, proposalId),
		revisionComment,
		revisionRequestedAt,
		revisionRequestedBy,
		writebackContent,
		writebackSource,
		archived: filePath === ARCHIVE_REVIEW_QUEUE_DIR
			|| filePath.startsWith(`${ARCHIVE_REVIEW_QUEUE_DIR}/`),
		fileContentHash: fileContentHash || '',
		lastTransition,
		sortTimestamp,
	};
	const snapshot = proposalTransitionSnapshotFromRecord(
		recordBase as MemoryProposalRecord
	);
	return {
		...recordBase,
		contentHash: computeProposalContentHash(snapshot),
		revision: computeProposalRevision(snapshot),
	};
};
