import {
	TRACEKEEPER_REVIEW_QUEUE_DIR,
	buildWikiReviewBatches,
	isKnowledgeWikiPath,
	type WikiChangeRule,
} from '@tracekeeper/core';
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
	| 'blocked'
	| 'needs_completion'
	| 'needs_review'
	| 'ready_to_apply'
	| 'awaiting_revision';

export type ReviewQueueSort = 'attention' | 'newest' | 'oldest' | 'risk';

const REVIEW_QUEUE_DEFAULT_PAGE_SIZE = 20;

const ATTENTION_STATE_RANK: Record<ReviewProposalAttentionState, number> = {
	blocked: 0,
	incomplete: 1,
	pending_review: 2,
	ready_to_apply: 3,
	awaiting_revision: 4,
	completed: 5,
};

const RISK_LEVEL_RANK: Record<string, number> = {
	critical: 4,
	high: 3,
	medium: 2,
	low: 1,
	unknown: 0,
	'': 0,
};

export const REVIEW_INBOX_FILTERS: Array<ReviewInboxFilter> = [
	'blocked',
	'needs_completion',
	'needs_review',
	'ready_to_apply',
	'awaiting_revision',
];

export interface ReviewQueueQuery {
	filter: ReviewInboxFilter;
	search?: string;
	sort: ReviewQueueSort;
	pageIndex: number;
	pageSize: number;
}

export interface ReviewQueueQueryCounts {
	blocked: number;
	needs_completion: number;
	needs_review: number;
	ready_to_apply: number;
	awaiting_revision: number;
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

export interface ReviewQueueBatchGroup {
	id: string;
	segment: number;
	proposals: MemoryProposalRecord[];
	totalBytes: number;
	batchEligible: boolean;
	highRiskCount: number;
	blockedCount: number;
}

export const buildReviewQueueBatchGroups = (
	proposals: readonly MemoryProposalRecord[],
	wikiChangeRule: WikiChangeRule
): ReviewQueueBatchGroup[] => {
	const byPath = new Map(proposals.map((proposal) => [proposal.path, proposal]));
	const batchCandidates = proposals.filter((proposal) => {
		const risk = proposal.effectiveRisk || proposal.riskLevel;
		return wikiChangeRule !== 'review_each'
			&& proposal.proposalSchemaVersion >= 2
			&& isKnowledgeWikiPath(proposal.targetNote)
			&& (risk === 'low' || risk === 'medium');
	});
	const batchedPaths = new Set(batchCandidates.map((proposal) => proposal.path));
	const groups = buildWikiReviewBatches(batchCandidates.map((proposal) => ({
		proposalPath: proposal.path,
		proposalId: proposal.proposalId,
		taskId: proposal.taskId,
		createdAt: proposal.created,
		writebackBytes: new TextEncoder().encode(proposal.writebackContent).byteLength,
		effectiveRisk: (proposal.effectiveRisk || proposal.riskLevel) as 'low' | 'medium',
	}))).map((batch): ReviewQueueBatchGroup => ({
		id: batch.reviewBatchId,
		segment: batch.segment,
		proposals: batch.items
			.map((item) => byPath.get(item.proposalPath))
			.filter((item): item is MemoryProposalRecord => Boolean(item))
			.sort((left, right) => {
				const leftRank = left.wikiRole === 'topic_map' ? 0 : 1;
				const rightRank = right.wikiRole === 'topic_map' ? 0 : 1;
				return leftRank - rightRank || left.targetNote.localeCompare(right.targetNote);
			}),
		totalBytes: batch.totalBytes,
		batchEligible: true,
		highRiskCount: 0,
		blockedCount: 0,
	}));
	for (const proposal of proposals) {
		if (batchedPaths.has(proposal.path)) continue;
		const risk = proposal.effectiveRisk || proposal.riskLevel;
		groups.push({
			id: `proposal:${proposal.proposalId || proposal.path}`,
			segment: 1,
			proposals: [proposal],
			totalBytes: new TextEncoder().encode(proposal.writebackContent).byteLength,
			batchEligible: false,
			highRiskCount: risk === 'high' ? 1 : 0,
			blockedCount: risk === 'blocked' ? 1 : 0,
		});
	}
	return groups.sort((left, right) => {
		const leftTime = left.proposals[0]?.sortTimestamp ?? 0;
		const rightTime = right.proposals[0]?.sortTimestamp ?? 0;
		return rightTime - leftTime || left.id.localeCompare(right.id);
	});
};

export interface MemoryReviewQueueSnapshot {
	proposals: MemoryProposalRecord[];
	totalProposalCount: number;
	windowOffset: number;
	windowLimit: number;
	isTruncated: boolean;
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

export const isReviewQueueArchiveableStatus = (status: MemoryProposalStatus): boolean =>
	status === 'rejected' || status === 'deferred' || status === 'applied';

export const isReviewQueueArchiveCandidate = (proposal: MemoryProposalRecord): boolean =>
	isReviewQueueArchiveableStatus(proposal.approvalStatus)
	|| (proposal.approvalStatus === 'approved' && proposal.classification !== 'memory_proposal');

export const reviewInboxFilterLabel = (filter: ReviewInboxFilter): string => {
	switch (filter) {
		case 'blocked':
			return ui('需重提', 'Resubmit');
		case 'needs_completion':
			return ui('待补全', 'Needs completion');
		case 'needs_review':
			return ui('待审核', 'Needs review');
		case 'ready_to_apply':
			return ui('待写入', 'Ready to apply');
		case 'awaiting_revision':
			return ui('需修订', 'Needs revision');
	}
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
		case 'blocked':
			return attention === 'blocked';
		case 'needs_completion':
			return attention === 'incomplete';
		case 'needs_review':
			return attention === 'pending_review';
		case 'ready_to_apply':
			return attention === 'ready_to_apply';
		case 'awaiting_revision':
			return attention === 'awaiting_revision';
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
		filter: query.filter || 'needs_completion',
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
		blocked: 0,
		needs_completion: 0,
		needs_review: 0,
		ready_to_apply: 0,
		awaiting_revision: 0,
	};

	for (const proposal of matchedBySearch) {
		const context = contexts[proposal.path];
		if (getReviewProposalAttentionFilterMatch(proposal, 'blocked', context)) {
			counts.blocked += 1;
		}
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
