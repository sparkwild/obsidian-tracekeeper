import { TRACEKEEPER_REVIEW_QUEUE_DIR } from '@tracekeeper/core';
import type { MemoryProposalRecord, MemoryProposalStatus } from './review-view-model';
import { ui } from '../../ui/localization';

export const REVIEW_QUEUE_PATH = TRACEKEEPER_REVIEW_QUEUE_DIR;

export type ReviewQueueFilter = 'pending' | 'revision_requested' | 'all';

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

export const isReviewQueueFilterMatch = (status: MemoryProposalStatus, filter: ReviewQueueFilter): boolean => {
	if (filter === 'pending') {
		return isReviewQueuePendingStatus(status);
	}
	if (filter === 'revision_requested') {
		return isReviewQueueRevisionRequestedStatus(status);
	}
	return true;
};

export const memoryProposalStatusLabel = (status: MemoryProposalStatus): string => {
	switch (status) {
		case 'approved':
			return ui('已批准', 'Approved');
		case 'rejected':
			return ui('已拒绝', 'Rejected');
		case 'deferred':
			return ui('已暂缓', 'Deferred');
		case 'revision_requested':
			return ui('需修订', 'Revision requested');
		case 'applied':
			return ui('已写回', 'Applied');
		case 'pending':
		default:
			return ui('待审核', 'Pending');
	}
};

export interface MemoryReviewQueueSnapshot {
	proposals: MemoryProposalRecord[];
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

export const REVIEW_QUEUE_FILTERS: Array<ReviewQueueFilter> = ['pending', 'revision_requested', 'all'];
