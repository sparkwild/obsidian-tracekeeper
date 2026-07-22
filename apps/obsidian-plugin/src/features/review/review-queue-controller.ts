import { App, TFile, TFolder } from 'obsidian';
import { ARCHIVE_REVIEW_QUEUE_DIR } from '@tracekeeper/core';
import type { ActivityRecordRepository } from '../activity/activity-record-repository';
import {
	compareProposalRecords,
	normalizeProposalStatus,
	type MemoryProposalRecord,
	type MemoryProposalStatus,
} from './review-view-model';
import { REVIEW_QUEUE_PATH, type MemoryReviewQueueSnapshot } from './review-queue-model';
import { escapeAuditValue, normalizeFrontmatterRevisionComment } from '../shared/markdown-record-parser';

const MAX_REVIEW_QUEUE_ROWS = 20;
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ApprovedWritebackPreview {
	proposal_id: string;
	proposal_path: string;
	target_note: string;
	touched_notes: string[];
	writeback_preview: string;
}

export interface ReviewQueueControllerHost {
	executeLocalTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
	refreshGovernanceViews(): Promise<void>;
	appendToAuditLog(entry: string): Promise<void>;
	ensureFolderExists(path: string): Promise<void>;
	normalizeVaultPath(path: string): string;
}

export class ReviewQueueController {
	constructor(
		private readonly app: App,
		private readonly records: ActivityRecordRepository,
		private readonly host: ReviewQueueControllerHost
	) {}

private async appendProposalStatusAuditEvent(
		proposal: MemoryProposalRecord,
		nextStatus: MemoryProposalStatus,
		revisionComment?: string
	): Promise<void> {
		const now = new Date().toISOString();
		const event = this.renderProposalStatusAuditEvent(
			now,
			proposal.path,
			proposal.proposalId,
			nextStatus,
			proposal.taskId,
			revisionComment
		);
		await this.host.appendToAuditLog(event);
	}

private renderProposalStatusAuditEvent(
		timestamp: string,
		target: string,
		proposalId: string,
		nextStatus: MemoryProposalStatus,
		taskId?: string,
		revisionComment?: string
	): string {
		return (
			`## ${timestamp}\n` +
			`action: memory.proposal.${nextStatus}\n` +
			`actor: user\n` +
			`target: ${target}\n` +
			`reason: proposal ${proposalId} marked ${nextStatus}\n` +
			(revisionComment ? `revision_comment: ${escapeAuditValue(revisionComment)}\n` : '') +
			(nextStatus === 'revision_requested'
				? `revision_requested_at: ${timestamp}\nrevision_requested_by: user\n`
				: '') +
			`task_id: ${taskId || ''}\n` +
			`timestamp: ${timestamp}\n\n`
		);
	}

private isApprovedWritebackPreview(value: unknown): value is ApprovedWritebackPreview {
		if (!isRecord(value)) {
			return false;
		}
		return typeof value.proposal_id === 'string'
			&& typeof value.proposal_path === 'string'
			&& typeof value.target_note === 'string'
			&& typeof value.writeback_preview === 'string'
			&& Array.isArray(value.touched_notes)
			&& value.touched_notes.every((item) => typeof item === 'string');
	}

async previewApprovedWriteback(proposal: MemoryProposalRecord): Promise<ApprovedWritebackPreview> {
		const args: Record<string, unknown> = {
			proposal_path: proposal.path,
			dry_run: true,
		};
		if (proposal.taskId) {
			args.task_id = proposal.taskId;
		}
		const result = await this.host.executeLocalTool('tracekeeper.apply_approved_writeback', args);
		if (!this.isApprovedWritebackPreview(result)) {
			throw new Error('Approved writeback preview returned an invalid result.');
		}
		return result;
	}

async applyApprovedWriteback(proposal: MemoryProposalRecord): Promise<void> {
		const args: Record<string, unknown> = { proposal_path: proposal.path };
		if (proposal.taskId) {
			args.task_id = proposal.taskId;
		}
		await this.host.executeLocalTool('tracekeeper.apply_approved_writeback', args);
		await this.host.refreshGovernanceViews();
	}

async loadMemoryReviewQueueSnapshot(): Promise<MemoryReviewQueueSnapshot> {
		const folder = this.app.vault.getAbstractFileByPath(REVIEW_QUEUE_PATH);
		if (!(folder instanceof TFolder)) {
			return {
				proposals: [],
				missingReviewQueueFolder: true,
				updatedAt: new Date().toISOString(),
			};
		}

		const files = this.records.collectMarkdownFiles(folder);
		const records = await Promise.all(files.map((file) => this.records.readMemoryProposalFile(file)));
		const proposals = records
			.filter((record): record is MemoryProposalRecord => Boolean(record))
			.sort((a, b) => compareProposalRecords(a, b))
			.slice(0, MAX_REVIEW_QUEUE_ROWS);

		return {
			proposals,
			missingReviewQueueFolder: false,
			updatedAt: new Date().toISOString(),
		};
	}

async updateMemoryProposalStatus(
		proposal: MemoryProposalRecord,
		nextStatus: MemoryProposalStatus,
		options: {
			clearRevision?: boolean;
			revisionComment?: string;
		} = {}
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(proposal.path);
		if (!(file instanceof TFile)) {
			throw new Error(`Cannot update proposal status: ${proposal.path} is not available.`);
		}

		const normalizedStatus = normalizeProposalStatus(nextStatus);
		const revisionComment = options.revisionComment?.trim();
		const now = new Date().toISOString();

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			(frontmatter as Record<string, unknown>).approval_status = normalizedStatus;
			if (normalizedStatus === 'revision_requested') {
				(frontmatter as Record<string, unknown>).revision_requested_by = 'user';
				(frontmatter as Record<string, unknown>).revision_requested_at = now;
				if (revisionComment) {
					(frontmatter as Record<string, unknown>).revision_comment = normalizeFrontmatterRevisionComment(revisionComment);
				}
			} else if (options.clearRevision) {
				delete (frontmatter as Record<string, unknown>).revision_comment;
				delete (frontmatter as Record<string, unknown>).revisionComment;
				delete (frontmatter as Record<string, unknown>).revision_requested_by;
				delete (frontmatter as Record<string, unknown>).revisionRequestedBy;
				delete (frontmatter as Record<string, unknown>).revision_requested_at;
				delete (frontmatter as Record<string, unknown>).revisionRequestedAt;
			}
		});
		await this.appendProposalStatusAuditEvent(
			{
				...proposal,
				approvalStatus: normalizedStatus,
				revisionComment: options.clearRevision ? '' : revisionComment ? revisionComment : proposal.revisionComment,
				revisionRequestedAt: options.clearRevision ? '' : normalizedStatus === 'revision_requested' ? now : proposal.revisionRequestedAt,
				revisionRequestedBy: options.clearRevision ? '' : normalizedStatus === 'revision_requested' ? 'user' : proposal.revisionRequestedBy,
			},
			normalizedStatus,
			revisionComment
		);
	}

async archiveMemoryProposals(proposals: MemoryProposalRecord[]): Promise<number> {
		const archiveFolder = ARCHIVE_REVIEW_QUEUE_DIR;
		await this.host.ensureFolderExists(archiveFolder);
		let moved = 0;
		for (const proposal of proposals) {
			const file = this.app.vault.getAbstractFileByPath(proposal.path);
			if (!(file instanceof TFile)) {
				continue;
			}
			const fileName = proposal.path.split('/').pop() || `${proposal.proposalId || 'proposal'}.md`;
			const targetPath = await this.availableArchivePath(archiveFolder, fileName);
			await this.app.vault.rename(file, targetPath);
			moved += 1;
		}
		if (moved > 0) {
			const now = new Date().toISOString();
			await this.host.appendToAuditLog(
				`## ${now}\n` +
				'action: memory.proposal.archive\n' +
				'actor: user\n' +
				`target: ${archiveFolder}\n` +
				`reason: archived ${moved} processed review queue item(s)\n` +
				`timestamp: ${now}\n\n`
			);
			await this.host.refreshGovernanceViews();
		}
		return moved;
	}

private async availableArchivePath(folder: string, fileName: string): Promise<string> {
		const normalizedName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
		const base = normalizedName.replace(/\.md$/i, '');
		let candidate = this.host.normalizeVaultPath(`${folder}/${normalizedName}`);
		if (!this.app.vault.getAbstractFileByPath(candidate)) {
			return candidate;
		}
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		let suffix = 1;
		do {
			candidate = this.host.normalizeVaultPath(`${folder}/${base}-${stamp}-${suffix}.md`);
			suffix += 1;
		} while (this.app.vault.getAbstractFileByPath(candidate));
		return candidate;
	}
}
