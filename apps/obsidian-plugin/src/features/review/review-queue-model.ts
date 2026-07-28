import { TRACEKEEPER_REVIEW_QUEUE_DIR } from '@tracekeeper/core';
import type {
	MemoryProposalRecord,
	MemoryProposalStatus,
	ReviewProposalAttentionState,
} from './review-view-model';
import { getReviewProposalAttentionState } from './review-view-model';
import type { ReviewProposalContext } from './review-context-model';
import { ui } from '../../ui/localization';

export const REVIEW_QUEUE_PATH = TRACEKEEPER_REVIEW_QUEUE_DIR;

export type ReviewInboxFilter =
	| 'needs_completion'
	| 'needs_review'
	| 'ready_to_apply'
	| 'awaiting_revision'
	| 'history'
	| 'all';

export type ReviewQueueFilter = 'pending' | 'revision_requested' | 'all';

export type ReviewQueueSort = 'attention' | 'newest' | 'oldest' | 'risk';

const REVIEW_QUEUE_DEFAULT_PAGE_SIZE = 20;

const ATTENTION_STATE_RANK: Record<ReviewProposalAttentionState, number> = {
	incomplete: 0,
	pending_review: 1,
	ready_to_apply: 2,
	awaiting_revision: 3,
	completed: 4,
};

const RISK_LEVEL_RANK: Record<string, number> = {
	critical: 4,
	high: 3,
	medium: 2,
	low: 1,
	unknown: 0,
	'': 0,
};

export const REVIEW_QUEUE_FILTERS: Array<ReviewQueueFilter> = ['pending', 'revision_requested', 'all'];

export const REVIEW_INBOX_FILTERS: Array<ReviewInboxFilter> = [
	'needs_completion',
	'needs_review',
	'ready_to_apply',
	'awaiting_revision',
	'history',
	'all',
];

export interface ReviewQueueQuery {
	filter: ReviewInboxFilter;
	search?: string;
	sort: ReviewQueueSort;
	pageIndex: number;
	pageSize: number;
}

export interface ReviewQueueQueryCounts {
	needs_completion: number;
	needs_review: number;
	ready_to_apply: number;
	awaiting_revision: number;
	history: number;
	all: number;
}

export interface ReviewQueuePage {
	totalItems: number;
	pageIndex: number;
	pageSize: number;
	totalPages: number;
	hasNext: boolean;
	hasPrevious: boolean;
}

export interface ReviewQueueQueryResult {
	items: MemoryProposalRecord[];
	counts: ReviewQueueQueryCounts;
	totalItems: number;
	page: ReviewQueuePage;
	query: ReviewQueueQuery;
}

export interface MemoryReviewQueueSnapshot {
	proposals: MemoryProposalRecord[];
	contexts: Record<string, ReviewProposalContext>;
	indexState: string;
	missingReviewQueueFolder: boolean;
	updatedAt: string;
}

export interface ReviewQueueDisplaySummary {
	actionTitle: string;
	actionDetail: string;
	targetFile: string;
	targetPosition: string;
	changePreview: string;
	reason: string;
	sourceLine: string;
	hasWritebackContent: boolean;
}

export const isReviewQueuePendingStatus = (status: MemoryProposalStatus): boolean => status === 'pending';

export const isReviewQueueRevisionRequestedStatus = (status: MemoryProposalStatus): boolean =>
	status === 'revision_requested';

export const isReviewQueueArchiveableStatus = (status: MemoryProposalStatus): boolean =>
	status === 'rejected' || status === 'deferred' || status === 'applied';

export const isReviewQueueArchiveCandidate = (proposal: MemoryProposalRecord): boolean =>
	isReviewQueueArchiveableStatus(proposal.approvalStatus)
	|| (proposal.approvalStatus === 'approved' && proposal.classification !== 'memory_proposal');

export const reviewQueueFilterLabel = (filter: ReviewQueueFilter): string => {
	switch (filter) {
		case 'pending':
			return ui('待审核', 'Pending');
		case 'revision_requested':
			return ui('需修订', 'Revision requested');
		case 'all':
		default:
			return ui('全部', 'All');
	}
};

export const reviewInboxFilterLabel = (filter: ReviewInboxFilter): string => {
	switch (filter) {
		case 'needs_completion':
			return ui('待补全', 'Needs completion');
		case 'needs_review':
			return ui('待审核', 'Needs review');
		case 'ready_to_apply':
			return ui('待写入', 'Ready to apply');
		case 'awaiting_revision':
			return ui('需修订', 'Needs revision');
		case 'history':
			return ui('已处理', 'Processed');
		case 'all':
			return ui('全部', 'All');
	}
};

export const isReviewQueueFilterMatch = (status: MemoryProposalStatus, filter: ReviewQueueFilter): boolean => {
	if (filter === 'pending') {
		return isReviewQueuePendingStatus(status);
	}
	if (filter === 'revision_requested') {
		return isReviewQueueRevisionRequestedStatus(status);
	}
	return true;
};

const normalizeQueryText = (value: string): string => value.trim().toLowerCase();

const matchesSearch = (proposal: MemoryProposalRecord, search: string): boolean => {
	const normalizedSearch = normalizeQueryText(search);
	if (!normalizedSearch) {
		return true;
	}
	const candidates = [
		proposal.proposalId,
		proposal.proposalKind,
		proposal.proposedBy,
		proposal.relatedProject,
		proposal.memoryScope,
		proposal.taskId,
		proposal.sourceSessionNote,
		proposal.targetNote,
		proposal.riskLevel,
		proposal.snippet,
		proposal.writebackContent,
		proposal.revisionComment,
		proposal.rationale,
		proposal.path,
		...proposal.evidence,
		...proposal.relatedSources,
	]
		.map((value) => value.toLowerCase())
		.join(' ');

	return candidates.includes(normalizedSearch);
};

export const getReviewProposalAttentionFilterMatch = (
	proposal: MemoryProposalRecord,
	filter: ReviewInboxFilter,
	context?: ReviewProposalContext
): boolean => {
	const attention = getReviewProposalAttentionState(
		proposal,
		context ? { exists: context.target.exists } : {}
	);
	switch (filter) {
		case 'needs_completion':
			return attention === 'incomplete';
		case 'needs_review':
			return attention === 'pending_review';
		case 'ready_to_apply':
			return attention === 'ready_to_apply';
		case 'awaiting_revision':
			return attention === 'awaiting_revision';
		case 'history':
			return attention === 'completed';
		case 'all':
		default:
			return true;
	}
};

const sortByAttentionState = (
	a: MemoryProposalRecord,
	b: MemoryProposalRecord,
	contexts: Record<string, ReviewProposalContext>
): number => {
	const attentionRankA = ATTENTION_STATE_RANK[
		getReviewProposalAttentionState(a, contexts[a.path] ? { exists: contexts[a.path].target.exists } : {})
	] ?? 10;
	const attentionRankB = ATTENTION_STATE_RANK[
		getReviewProposalAttentionState(b, contexts[b.path] ? { exists: contexts[b.path].target.exists } : {})
	] ?? 10;
	if (attentionRankA !== attentionRankB) {
		return attentionRankA - attentionRankB;
	}
	return b.sortTimestamp - a.sortTimestamp;
};

const sortByNewest = (a: MemoryProposalRecord, b: MemoryProposalRecord): number =>
	b.sortTimestamp - a.sortTimestamp;

const sortByOldest = (a: MemoryProposalRecord, b: MemoryProposalRecord): number =>
	a.sortTimestamp - b.sortTimestamp;

const riskRank = (proposal: MemoryProposalRecord): number => {
	const normalized = proposal.riskLevel.toLowerCase();
	return RISK_LEVEL_RANK[normalized] ?? 0;
};

const sortByRisk = (a: MemoryProposalRecord, b: MemoryProposalRecord): number => {
	const rankA = riskRank(a);
	const rankB = riskRank(b);
	if (rankA !== rankB) {
		return rankB - rankA;
	}
	return b.sortTimestamp - a.sortTimestamp;
};

const sortReviewQueue = (
	proposals: MemoryProposalRecord[],
	sort: ReviewQueueSort,
	contexts: Record<string, ReviewProposalContext>
): MemoryProposalRecord[] => {
	switch (sort) {
		case 'attention':
			return [...proposals].sort((a, b) => sortByAttentionState(a, b, contexts));
		case 'oldest':
			return [...proposals].sort(sortByOldest);
		case 'risk':
			return [...proposals].sort(sortByRisk);
		case 'newest':
		default:
			return [...proposals].sort(sortByNewest);
	}
};

export const paginateReviewQueueItems = (
	proposals: MemoryProposalRecord[],
	pageIndex = 0,
	pageSize = REVIEW_QUEUE_DEFAULT_PAGE_SIZE
): { proposals: MemoryProposalRecord[]; page: ReviewQueuePage } => {
	const normalizedSize = Number.isInteger(pageSize) ? Math.max(1, pageSize) : REVIEW_QUEUE_DEFAULT_PAGE_SIZE;
	const totalItems = proposals.length;
	const totalPages = Math.ceil(totalItems / normalizedSize);
	const normalizedIndex = Number.isInteger(pageIndex) ? Math.max(0, pageIndex) : 0;
	const clampedIndex = totalPages > 0 ? Math.min(normalizedIndex, totalPages - 1) : 0;
	const offset = clampedIndex * normalizedSize;
	const page = proposals.slice(offset, offset + normalizedSize);
	return {
		proposals: page,
		page: {
			totalItems,
			pageIndex: clampedIndex,
			pageSize: normalizedSize,
			totalPages,
			hasNext: clampedIndex < totalPages - 1,
			hasPrevious: clampedIndex > 0,
		},
	};
};

export const filterReviewQueueItems = (
	proposals: MemoryProposalRecord[],
	query: Partial<ReviewQueueQuery>,
	contexts: Record<string, ReviewProposalContext> = {}
): ReviewQueueQueryResult => {
	const normalizedQuery: ReviewQueueQuery = {
		filter: query.filter || 'all',
		search: query.search || '',
		sort: query.sort || 'attention',
		pageIndex: Number.isInteger(query.pageIndex) ? query.pageIndex ?? 0 : 0,
		pageSize: Number.isInteger(query.pageSize) && (query.pageSize ?? 0) > 0
			? query.pageSize ?? REVIEW_QUEUE_DEFAULT_PAGE_SIZE
			: REVIEW_QUEUE_DEFAULT_PAGE_SIZE,
	};

	const safeSearch = normalizeQueryText(normalizedQuery.search || '');
	const matchedBySearch = proposals.filter((proposal) => matchesSearch(proposal, safeSearch));
	const counts: ReviewQueueQueryCounts = {
		needs_completion: 0,
		needs_review: 0,
		ready_to_apply: 0,
		awaiting_revision: 0,
		history: 0,
		all: matchedBySearch.length,
	};

	for (const proposal of matchedBySearch) {
		const context = contexts[proposal.path];
		if (getReviewProposalAttentionFilterMatch(proposal, 'needs_completion', context)) {
			counts.needs_completion += 1;
		}
		if (getReviewProposalAttentionFilterMatch(proposal, 'needs_review', context)) {
			counts.needs_review += 1;
		}
		if (getReviewProposalAttentionFilterMatch(proposal, 'ready_to_apply', context)) {
			counts.ready_to_apply += 1;
		}
		if (getReviewProposalAttentionFilterMatch(proposal, 'awaiting_revision', context)) {
			counts.awaiting_revision += 1;
		}
		if (getReviewProposalAttentionFilterMatch(proposal, 'history', context)) {
			counts.history += 1;
		}
	}

	const filtered = matchedBySearch.filter((proposal) =>
		getReviewProposalAttentionFilterMatch(
			proposal,
			normalizedQuery.filter,
			contexts[proposal.path]
		)
	);
	const sorted = sortReviewQueue(filtered, normalizedQuery.sort, contexts);
	const { proposals: paged, page } = paginateReviewQueueItems(sorted, normalizedQuery.pageIndex, normalizedQuery.pageSize);

	return {
		items: paged,
		counts,
		totalItems: filtered.length,
		page: {
			...page,
			totalItems: filtered.length,
		},
		query: normalizedQuery,
	};
};

export const memoryProposalStatusLabel = (status: MemoryProposalStatus): string => {
	switch (status) {
		case 'approved':
			return ui('审核通过', 'Approved');
		case 'rejected':
			return ui('未采纳', 'Not accepted');
		case 'deferred':
			return ui('暂缓处理', 'Deferred');
		case 'revision_requested':
			return ui('已退回修改', 'Returned for revision');
		case 'applied':
			return ui('已写入', 'Applied');
		case 'pending':
		default:
			return ui('待审核', 'Pending');
	}
};
