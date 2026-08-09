import { App, TFile, TFolder } from 'obsidian';
import {
	ARCHIVE_REVIEW_QUEUE_DIR,
	TRACEKEEPER_SESSIONS_DIR,
	TRACEKEEPER_TASKS_DIR,
	computePayloadHash,
	hashVaultContent,
	type ProposalTransitionDecision,
} from '@tracekeeper/core';
import type { ActivityRecordRepository } from '../activity/activity-record-repository';
import { withObsidianVaultPathLocks } from '../../adapters/obsidian-vault-path-lock';
import {
	firstString,
	readFrontmatter,
} from '../shared/markdown-record-parser';
import {
	compareProposalRecords,
	normalizeProposalStatus,
	type MemoryProposalRecord,
	type MemoryProposalStatus,
} from './review-view-model';
import {
	REVIEW_QUEUE_PATH,
	isReviewQueueArchiveCandidate,
	type MemoryReviewQueueSnapshot,
} from './review-queue-model';
import {
	buildReviewProposalContexts,
	type ReviewKnowledgeSnapshot,
} from './review-context-model';
import { normalizeReviewTargetPath } from './review-target-policy';
import type { ObsidianProposalTransitionRequest } from './proposal-transition-adapter';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const ARCHIVE_PREVIEW_TTL_MS = 10 * 60 * 1000;
const ARCHIVE_MAX_ITEMS = 64;
const ARCHIVE_MAX_MANAGED_REFERENCE_PATHS = 256;
const ARCHIVE_PREVIEW_MAX_LENGTH = 256 * 1024;
export const ARCHIVE_RECEIPT_MAX_LENGTH = 64 * 1024;
export const ARCHIVE_TARGET_CLAIM_MAX_LENGTH = 8 * 1024;
const archiveOperationQueues = new WeakMap<
	object,
	Map<string, Promise<void>>
>();

const countExact = (values: readonly string[], expected: string): number =>
	values.filter((value) => value === expected).length;

const escapedPattern = (value: string): RegExp =>
	new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

const firstMarkdownLink = (value: string): string => {
	const wikilink = value.match(/!?\[\[[^\]\n]+\]\]/)?.[0];
	if (wikilink) {
		return wikilink;
	}
	return value.match(/!?\[[^\]\n]*\]\([^)\n]+\)/)?.[0] || '';
};

const relativeVaultPath = (sourcePath: string, targetPath: string): string => {
	const sourceSegments = sourcePath.split('/').filter(Boolean);
	sourceSegments.pop();
	const targetSegments = targetPath.split('/').filter(Boolean);
	while (
		sourceSegments.length > 0
		&& targetSegments.length > 0
		&& sourceSegments[0] === targetSegments[0]
	) {
		sourceSegments.shift();
		targetSegments.shift();
	}
	return `${'../'.repeat(sourceSegments.length)}${targetSegments.join('/')}`;
};

const retargetManagedLink = (
	link: string,
	sourcePath: string,
	targetPath: string
): string => {
	const wikilink = link.match(/^(!?)\[\[([^|\]]+)(\|[^\]]*)?\]\]$/);
	if (wikilink) {
		const subpath = wikilink[2].includes('#')
			? `#${wikilink[2].split('#').slice(1).join('#')}`
			: '';
		return `${wikilink[1]}[[${targetPath.replace(/\.md$/i, '')}${subpath}${wikilink[3] || ''}]]`;
	}
	const markdownLink = link.match(/^(!?)\[([^\]]*)\]\(([^)]+)\)$/);
	if (!markdownLink) {
		return link;
	}
	const subpath = markdownLink[3].includes('#')
		? `#${markdownLink[3].split('#').slice(1).join('#')}`
		: '';
	return `${markdownLink[1]}[${markdownLink[2]}](${relativeVaultPath(
		sourcePath,
		targetPath
	)}${subpath})`;
};

const archiveLinkCandidates = (replacement: {
	oldLink: string;
	newLink: string;
	nativeUpdatedLink: string;
}): string[] => [...new Set([
	replacement.oldLink,
	replacement.newLink,
	replacement.nativeUpdatedLink,
].filter(Boolean))];

const archiveProposalReferenceMarker = (proposalId: string): string => {
	const safeId = proposalId
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	return `^tracekeeper-proposal-${safeId || hashVaultContent(proposalId).slice(0, 24)}`;
};

const replaceManagedArchiveReference = (
	content: string,
	replacements: readonly {
		proposalId: string;
		oldPath: string;
		newPath: string;
		oldLink: string;
		newLink: string;
		nativeUpdatedLink: string;
	}[]
): string => {
	const normalized = content.replace(/\r\n?/g, '\n');
	const lines = normalized.split('\n');
	const closingIndex = lines[0]?.trim() === '---'
		? lines.findIndex(
			(line, index) =>
				index > 0 && (line.trim() === '---' || line.trim() === '...')
		)
		: -1;
	const managedFields = new Set([
		'proposal_paths',
		'proposal_link_targets',
		'proposal_links',
	]);
	let managedField = '';
	for (let index = 1; closingIndex > 0 && index < closingIndex; index += 1) {
		const key = lines[index].match(/^([A-Za-z0-9_-]+)\s*:/)?.[1] || '';
		if (key) {
			managedField = managedFields.has(key) ? key : '';
		}
		if (!managedField) {
			continue;
		}
		for (const replacement of replacements) {
			if (managedField === 'proposal_links') {
				for (const candidate of archiveLinkCandidates(replacement)) {
					lines[index] = lines[index].replace(
						escapedPattern(candidate),
						replacement.newLink
					);
				}
			} else {
				lines[index] = lines[index].replace(
					escapedPattern(replacement.oldPath),
					replacement.newPath
				);
			}
		}
	}

	for (let index = Math.max(0, closingIndex + 1); index < lines.length; index += 1) {
		for (const replacement of replacements) {
			const marker = archiveProposalReferenceMarker(replacement.proposalId);
			const managedLine = lines[index].includes(marker)
				|| /^\s*(?:[-*]\s+)?Proposal\s*:/i.test(lines[index]);
			if (managedLine) {
				for (const candidate of archiveLinkCandidates(replacement)) {
					lines[index] = lines[index].replace(
						escapedPattern(candidate),
						replacement.newLink
					);
				}
			}
		}
	}

	for (const replacement of replacements) {
		const marker = archiveProposalReferenceMarker(replacement.proposalId);
		if (
			!lines.some((line) => line.includes(marker))
			&& !lines.some((line) => line.includes(replacement.newLink))
		) {
			lines.push(
				'',
				'## Knowledge Change Review',
				`- ${replacement.newLink} ${marker}`
			);
		}
	}
	const next = lines.join('\n');
	return normalized.endsWith('\n') && !next.endsWith('\n') ? `${next}\n` : next;
};

const managedArchiveReferenceInvariant = (
	content: string,
	replacements: readonly {
		proposalId: string;
		oldPath: string;
		newPath: string;
		oldLink: string;
		newLink: string;
		nativeUpdatedLink: string;
	}[]
): string => {
	const normalized = content.replace(/\r\n?/g, '\n');
	const lines = normalized.split('\n');
	const closingIndex = lines[0]?.trim() === '---'
		? lines.findIndex(
			(line, index) =>
				index > 0 && (line.trim() === '---' || line.trim() === '...')
		)
		: -1;
	const managedFields = new Set([
		'proposal_paths',
		'proposal_link_targets',
		'proposal_links',
	]);
	let managedField = '';
	for (let index = 1; closingIndex > 0 && index < closingIndex; index += 1) {
		const key = lines[index].match(/^([A-Za-z0-9_-]+)\s*:/)?.[1] || '';
		if (key) {
			managedField = managedFields.has(key) ? key : '';
		}
		if (!managedField) {
			continue;
		}
		for (const replacement of replacements) {
			const placeholder = managedField === 'proposal_links'
				? `{{tracekeeper-proposal-link:${replacement.proposalId}}}`
				: `{{tracekeeper-proposal-path:${replacement.proposalId}}}`;
			for (const candidate of managedField === 'proposal_links'
				? archiveLinkCandidates(replacement)
				: [replacement.oldPath, replacement.newPath]) {
				lines[index] = lines[index].replace(escapedPattern(candidate), placeholder);
			}
		}
	}
	for (let index = Math.max(0, closingIndex + 1); index < lines.length; index += 1) {
		for (const replacement of replacements) {
			const marker = archiveProposalReferenceMarker(replacement.proposalId);
			if (
				lines[index].includes(marker)
				|| /^\s*(?:[-*]\s+)?Proposal\s*:/i.test(lines[index])
				) {
					const placeholder = `{{tracekeeper-proposal-link:${replacement.proposalId}}}`;
					for (const candidate of archiveLinkCandidates(replacement)) {
					lines[index] = lines[index].replace(escapedPattern(candidate), placeholder);
				}
			}
		}
	}
	return lines.join('\n');
};

export interface ArchiveProposalInspection {
	path: string;
	proposalId: string;
	status: MemoryProposalStatus;
	classification: MemoryProposalRecord['classification'];
	revision: string;
	fileContentHash: string;
}

export interface ArchiveManagedReferencePreview {
	path: string;
	contentHash: string;
	invariantHash: string;
	proposalId: string;
	sourcePath: string;
	beforeLink: string;
}

export interface ArchiveConflict {
	kind:
		| 'destination-exists'
		| 'duplicate-destination'
		| 'managed-reference-ambiguous'
		| 'managed-reference-missing-id'
		| 'managed-reference-missing-path'
		| 'managed-reference-legacy-path'
		| 'managed-reference-unmanaged';
	path: string;
	proposalId: string;
}

export interface ArchiveProposalPreviewItem {
	proposalId: string;
	sourcePath: string;
	sourceHash: string;
	sourceRevision: string;
	sourceStatus: MemoryProposalStatus;
	destinationPath: string;
	destinationExists: boolean;
	managedReferences: string[];
	referenceSnapshots: ArchiveManagedReferencePreview[];
}

export interface ArchiveMemoryProposalPreview {
	schemaVersion: 1;
	operationId: string;
	issuedAt: string;
	expiresAt: string;
	items: ArchiveProposalPreviewItem[];
	conflicts: ArchiveConflict[];
	confirmationToken: string;
}

export interface ArchiveMemoryProposalReceipt {
	schemaVersion: 1;
	revision: number;
	bindingHash: string;
	operationId: string;
	previewHash: string;
	status: 'in-progress' | 'completed';
	targets: Array<{
		proposalId: string;
		oldPath: string;
		newPath: string;
	}>;
	moved: Array<{
		proposalId: string;
		oldPath: string;
		newPath: string;
	}>;
	movedHashes: Record<string, string>;
	managedReferences: Array<{
		path: string;
		contentHash: string;
	}>;
	startedAt: string;
	completedAt: string | null;
}

export interface ArchiveMemoryProposalTargetClaim {
	schemaVersion: 1;
	revision: number;
	bindingHash: string;
	targetHash: string;
	operationId: string;
	previewHash: string;
	status: 'in-progress' | 'completed';
	proposalId: string;
	oldPath: string;
	newPath: string;
	sourceHash: string;
	startedAt: string;
	completedAt: string | null;
}

export interface ApprovedWritebackPreview {
	proposal_id: string;
	proposal_path: string;
	target_note: string;
	touched_notes: string[];
	writeback_preview: string;
	writeback_effect: 'append' | 'create_wiki_note' | 'create_memory_record';
	confirmation_token: string;
	confirmation_expires_at: string;
}

export interface ReviewQueueControllerHost {
	executeLocalTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
	refreshGovernanceViews(): Promise<void>;
	appendToAuditLog(entry: string): Promise<void>;
	ensureFolderExists(path: string): Promise<void>;
	normalizeVaultPath(path: string): string;
	loadReviewKnowledgeSnapshot(): Promise<ReviewKnowledgeSnapshot>;
	waitForNativePath(sourcePath: string, targetPath: string): Promise<void>;
	readArchiveReceipt(operationId: string): Promise<unknown | null>;
	writeArchiveReceipt(
		receipt: ArchiveMemoryProposalReceipt,
		expectedBindingHash: string | null
	): Promise<void>;
	readArchiveTargetClaim(targetHash: string): Promise<unknown | null>;
	writeArchiveTargetClaim(
		claim: ArchiveMemoryProposalTargetClaim,
		expectedBindingHash: string | null
	): Promise<void>;
	appendArchiveAuditEvent?(operationId: string, entry: string): Promise<void>;
}

export interface ReviewProposalTransitionOwner {
	transition(request: ObsidianProposalTransitionRequest): Promise<ProposalTransitionDecision>;
	inspect?(proposalPath: string): Promise<ArchiveProposalInspection>;
}

const createReviewOperationId = (): string => {
	const operationId = globalThis.crypto?.randomUUID?.();
	if (!operationId) {
		throw new Error('Secure review operation identifiers are unavailable.');
	}
	return `review-${operationId}`;
};

export class ReviewQueueController {
	constructor(
		private readonly app: App,
		private readonly records: ActivityRecordRepository,
		private readonly host: ReviewQueueControllerHost,
		private readonly transitions: ReviewProposalTransitionOwner,
		private readonly operationIdFactory: () => string = createReviewOperationId,
		private readonly nowFactory: () => Date = () => new Date()
	) {}

private async appendProposalTransitionAuditEvent(
		decision: ProposalTransitionDecision,
		action: string
	): Promise<void> {
		const receipt = decision.receipt;
		await this.host.appendToAuditLog(
			`## ${receipt.committedAt}\n` +
			`action: ${action}\n` +
			`actor: user\n` +
			`target: ${receipt.proposalPath}\n` +
			`reason: committed proposal transition ${receipt.proposalId}\n` +
			`operation_id: ${receipt.operationId}\n` +
			`transition_kind: ${receipt.kind}\n` +
			`previous_status: ${receipt.previousStatus}\n` +
			`next_status: ${receipt.nextStatus}\n` +
			`expected_revision: ${receipt.expectedRevision}\n` +
			`previous_revision: ${receipt.previousRevision}\n` +
			`committed_revision: ${receipt.committedRevision}\n` +
			`previous_content_hash: ${receipt.previousContentHash}\n` +
			`committed_content_hash: ${receipt.committedContentHash}\n` +
			`task_id: ${receipt.taskId}\n` +
			`timestamp: ${receipt.committedAt}\n\n`
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
			&& (
				value.writeback_effect === 'append'
				|| value.writeback_effect === 'create_wiki_note'
				|| value.writeback_effect === 'create_memory_record'
			)
			&& typeof value.confirmation_token === 'string'
			&& value.confirmation_token.length > 0
			&& typeof value.confirmation_expires_at === 'string'
			&& value.confirmation_expires_at.length > 0
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
			throw new Error('Approved writeback confirmation preview returned an invalid result.');
		}
		return result;
	}

async applyApprovedWriteback(
		proposal: MemoryProposalRecord,
		preview: ApprovedWritebackPreview
	): Promise<void> {
		const args: Record<string, unknown> = {
			proposal_path: proposal.path,
			confirmation_token: preview.confirmation_token,
		};
		if (proposal.taskId) {
			args.task_id = proposal.taskId;
		}
		await this.host.executeLocalTool('tracekeeper.apply_approved_writeback', args);
		await this.host.refreshGovernanceViews();
	}

	async loadMemoryReviewQueueSnapshot(offset = 0): Promise<MemoryReviewQueueSnapshot> {
		const folder = this.app.vault.getAbstractFileByPath(REVIEW_QUEUE_PATH);
		if (!(folder instanceof TFolder)) {
			return {
				proposals: [],
				totalProposalCount: 0,
				windowOffset: 0,
				windowLimit: 0,
				isTruncated: false,
				contexts: {},
				indexState: 'initializing',
				missingReviewQueueFolder: true,
				updatedAt: new Date().toISOString(),
			};
		}

		const [proposalWindow, knowledge, tasks] = await Promise.all([
			this.records.readMemoryProposalWindow(undefined, offset),
			this.host.loadReviewKnowledgeSnapshot(),
			this.records.readRecentAgentTasks(200),
		]);
		const proposals = proposalWindow.records
			.sort((a, b) => compareProposalRecords(a, b));
		const availableKnowledge = {
			...knowledge,
			notes: knowledge.notes.filter((note) =>
				this.app.vault.getAbstractFileByPath(note.path) instanceof TFile
			),
		};
		const existingTargetPaths = new Set(
			proposals
				.map((proposal) => normalizeReviewTargetPath(proposal.targetNote))
				.filter((path) =>
					Boolean(path && this.app.vault.getAbstractFileByPath(path) instanceof TFile)
				)
		);

		return {
			proposals,
			totalProposalCount: proposalWindow.totalItems,
			windowOffset: proposalWindow.offset,
			windowLimit: proposalWindow.limit,
			isTruncated: proposalWindow.isTruncated,
			contexts: buildReviewProposalContexts({
				proposals,
				knowledge: availableKnowledge,
				tasks,
				existingTargetPaths,
			}),
			indexState: knowledge.state,
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
		const normalizedStatus = normalizeProposalStatus(nextStatus);
		const revisionComment = options.revisionComment?.trim();
		const now = new Date().toISOString();
		const decision = await this.transitions.transition({
			proposalPath: proposal.path,
			expectedRevision: proposal.revision,
			...(normalizedStatus === 'approved'
				? { expectedContentHash: proposal.contentHash }
				: {}),
			operationId: this.operationIdFactory(),
			action: {
				kind: 'status',
				nextStatus: normalizedStatus,
				clearRevision: options.clearRevision,
				revisionComment,
			},
			now,
			actor: 'user',
		});
		await this.appendProposalTransitionAuditEvent(
			decision,
			`memory.proposal.${decision.receipt.nextStatus}`
		);
		await this.host.refreshGovernanceViews();
	}

	async updateMemoryProposalDraft(
		proposal: MemoryProposalRecord,
		draft: { targetNote: string; writebackContent: string }
	): Promise<void> {
		const decision = await this.transitions.transition({
			proposalPath: proposal.path,
			expectedRevision: proposal.revision,
			expectedContentHash: proposal.contentHash,
			operationId: this.operationIdFactory(),
			action: {
				kind: 'draft',
				targetPath: draft.targetNote,
				writebackContent: draft.writebackContent,
			},
			now: new Date().toISOString(),
			actor: 'user',
		});
		await this.appendProposalTransitionAuditEvent(decision, 'memory.proposal.edited');
		await this.host.refreshGovernanceViews();
	}

	async archiveMemoryProposals(proposals: MemoryProposalRecord[]): Promise<number> {
		if (proposals.length === 0) {
			return 0;
		}
		const preview = await this.previewArchiveMemoryProposals(proposals);
		const receipt = await this.commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		);
		return receipt.moved.length;
	}

	async previewArchiveMemoryProposals(
		proposals: MemoryProposalRecord[]
	): Promise<ArchiveMemoryProposalPreview> {
		if (proposals.length > ARCHIVE_MAX_ITEMS) {
			throw new Error(
				`Archive preview exceeds the ${ARCHIVE_MAX_ITEMS}-record limit.`
			);
		}
		const rawOperationId = this.operationIdFactory().trim();
		if (
			!rawOperationId
			|| rawOperationId.length > 152
			|| !/^[A-Za-z0-9_-]+$/.test(rawOperationId)
		) {
			throw new Error('Archive operation id is invalid.');
		}
		const operationId = rawOperationId.startsWith('archive-')
			? rawOperationId
			: `archive-${rawOperationId}`;
		const issuedAt = this.nowFactory();
		const conflicts: ArchiveConflict[] = [];
		const items: ArchiveProposalPreviewItem[] = [];
		const selectedIds = new Set<string>();
		const selectedDestinations = new Set<string>();
		for (const proposal of proposals) {
			const proposalId = proposal.proposalId.trim();
			if (!proposalId || selectedIds.has(proposalId)) {
				throw new Error(`Archive proposal id is duplicate or missing: ${proposalId || '(missing)'}.`);
			}
			selectedIds.add(proposalId);
			const current = await this.currentArchiveProposal(proposalId, proposal.path);
			const file = this.app.vault.getAbstractFileByPath(current.path);
			if (!(file instanceof TFile)) {
				throw new Error(`Archive source is missing: ${current.path}.`);
			}
			const destinationPath = this.archiveDestinationPath(current.path);
			if (selectedDestinations.has(destinationPath)) {
				conflicts.push({
					kind: 'duplicate-destination',
					path: destinationPath,
					proposalId,
				});
			}
			selectedDestinations.add(destinationPath);
			const destinationExists = Boolean(
				this.app.vault.getAbstractFileByPath(destinationPath)
			);
			if (destinationExists) {
				conflicts.push({
					kind: 'destination-exists',
					path: destinationPath,
					proposalId,
				});
			}
			const managed = await this.previewManagedReferences(
				proposalId,
				current.path,
				file
			);
			conflicts.push(...managed.conflicts);
			items.push({
				proposalId,
				sourcePath: current.path,
				sourceHash: current.fileContentHash,
				sourceRevision: current.revision,
				sourceStatus: current.status,
				destinationPath,
				destinationExists,
				managedReferences: managed.references.map((reference) => reference.path),
				referenceSnapshots: managed.references,
			});
		}
		await this.bindManagedReferenceInvariants(items);
		const unsigned = {
			schemaVersion: 1 as const,
			operationId,
			issuedAt: issuedAt.toISOString(),
			expiresAt: new Date(issuedAt.getTime() + ARCHIVE_PREVIEW_TTL_MS).toISOString(),
			items,
			conflicts,
		};
		this.assertArchivePreviewBounds(unsigned);
		return {
			...unsigned,
			confirmationToken: this.archiveConfirmationToken(unsigned),
		};
	}

	async commitArchiveMemoryProposals(
		preview: ArchiveMemoryProposalPreview,
		confirmationToken: string
	): Promise<ArchiveMemoryProposalReceipt> {
		if (!/^archive-[A-Za-z0-9_-]{1,152}$/.test(preview.operationId)) {
			throw new Error('Archive operation id is invalid.');
		}
		this.assertArchivePreviewBounds(preview);
		return this.serializeArchiveOperation(
			'archive-mutation',
			() => withObsidianVaultPathLocks(
				this.app.vault,
				preview.items.flatMap((item) => [
					item.sourcePath,
					item.destinationPath,
				]),
				() => this.commitArchiveMemoryProposalsInternal(
					preview,
					confirmationToken
				)
			)
		);
	}

	private async commitArchiveMemoryProposalsInternal(
		preview: ArchiveMemoryProposalPreview,
		confirmationToken: string
	): Promise<ArchiveMemoryProposalReceipt> {
		const expectedToken = this.archiveConfirmationToken(preview);
		const recoveryPreviewHash = this.archiveRecoveryPreviewHash(preview);
		if (!confirmationToken || confirmationToken !== preview.confirmationToken
			|| confirmationToken !== expectedToken) {
			throw new Error('Archive confirmation does not match the current preview.');
		}
		let operationReceipt = this.parseArchiveReceipt(
			await this.host.readArchiveReceipt(preview.operationId)
		);
		if (operationReceipt) {
			this.assertArchiveReceiptMatchesPreview(
				operationReceipt,
				preview,
				recoveryPreviewHash
			);
		}
		if (preview.conflicts.length > 0) {
			throw new Error('Archive preview contains destination or managed-reference conflicts.');
		}
		this.assertArchivePreviewBounds(preview);
		if (!operationReceipt && this.nowFactory().getTime() > Date.parse(preview.expiresAt)) {
			const hasRecoveryClaim = await this.hasMatchingArchiveTargetClaim(
				preview,
				recoveryPreviewHash
			);
			if (!hasRecoveryClaim) {
				throw new Error('Archive preview is stale or expired.');
			}
		}
		let targetClaims: ArchiveMemoryProposalTargetClaim[] | null = null;
		if (operationReceipt) {
			targetClaims = await this.acquireArchiveTargetClaims(
				preview,
				recoveryPreviewHash,
				operationReceipt
			);
			if (operationReceipt.status === 'completed') {
				await this.completeArchiveTargetClaims(
					targetClaims,
					operationReceipt.completedAt
				);
				return operationReceipt;
			}
		}

		const states: Array<{
			item: ArchiveProposalPreviewItem;
			file: TFile;
			moved: boolean;
		}> = [];
		for (const item of preview.items) {
			const sourceEntry = this.app.vault.getAbstractFileByPath(item.sourcePath);
			const destinationEntry = this.app.vault.getAbstractFileByPath(item.destinationPath);
			if (
				(sourceEntry !== null && !(sourceEntry instanceof TFile))
				|| (destinationEntry !== null && !(destinationEntry instanceof TFile))
			) {
				throw new Error(
					`Archive source/destination path type conflicts for ${item.proposalId}.`
				);
			}
			const source = sourceEntry instanceof TFile ? sourceEntry : null;
			const destination = destinationEntry instanceof TFile ? destinationEntry : null;
			if ((source instanceof TFile) === (destination instanceof TFile)) {
				throw new Error(
					`Archive source/destination state conflicts for ${item.proposalId}.`
				);
			}
			const moved = destination instanceof TFile;
			if (moved && operationReceipt?.status !== 'in-progress') {
				throw new Error(
					`Archive destination is owned by another or unknown operation: ${item.destinationPath}.`
				);
			}
			const file = source instanceof TFile ? source : destination as TFile;
			const current = await this.inspectArchiveProposal(file.path);
			if (
				current.proposalId !== item.proposalId
				|| current.fileContentHash !== item.sourceHash
				|| (!moved && current.revision !== item.sourceRevision)
				|| current.status !== item.sourceStatus
			) {
				throw new Error(`Archive source changed or became stale: ${item.sourcePath}.`);
			}
			const history = await this.records.readProposalHistoryById(item.proposalId);
			if (history.status !== 'resolved' || history.record.path !== file.path) {
				throw new Error(`Archive proposal id is duplicate, ambiguous, or missing: ${item.proposalId}.`);
			}
			if (!isReviewQueueArchiveCandidate(history.record)) {
				throw new Error(`Archive proposal status is no longer archiveable: ${item.sourcePath}.`);
			}
			states.push({
				item,
				file,
				moved,
			});
		}

		const resumed = states.some((state) => state.moved);
		await this.revalidateManagedReferences(preview.items, !resumed);
		if (!targetClaims) {
			targetClaims = await this.acquireArchiveTargetClaims(
				preview,
				recoveryPreviewHash,
				operationReceipt
			);
		}
		if (!operationReceipt) {
			const startedAt =
				targetClaims[0]?.startedAt
				?? this.nowFactory().toISOString();
			const targets = preview.items.map((item) => ({
				proposalId: item.proposalId,
				oldPath: item.sourcePath,
				newPath: item.destinationPath,
			}));
			operationReceipt = {
				schemaVersion: 1,
				revision: 1,
				bindingHash: '',
				operationId: preview.operationId,
				previewHash: recoveryPreviewHash,
				status: 'in-progress',
				targets,
				moved: [],
				movedHashes: Object.fromEntries(
					preview.items.map((item) => [item.proposalId, item.sourceHash])
				),
				managedReferences: [],
				startedAt,
				completedAt: null,
			};
			operationReceipt.bindingHash =
				this.archiveReceiptBindingHash(operationReceipt);
			await this.host.writeArchiveReceipt(operationReceipt, null);
		}
		await this.host.ensureFolderExists(ARCHIVE_REVIEW_QUEUE_DIR);
		await this.assertArchiveTargetClaimsOwned(targetClaims, 'in-progress');
		for (const state of states) {
			if (state.moved) {
				continue;
			}
			if (this.app.vault.getAbstractFileByPath(state.item.destinationPath)) {
				throw new Error(`Archive destination already exists: ${state.item.destinationPath}.`);
			}
			await this.app.fileManager.renameFile(state.file, state.item.destinationPath);
			state.moved = true;
		}
		for (const state of states) {
			await this.host.waitForNativePath(
				state.item.sourcePath,
				state.item.destinationPath
			);
		}
		const managedReferences = await this.relinkManagedReferences(preview.items);
		for (const state of states) {
			const history = await this.records.readProposalHistoryById(state.item.proposalId);
			if (
				history.status !== 'resolved'
				|| history.record.path !== state.item.destinationPath
			) {
				throw new Error(
					`Archive history did not converge for ${state.item.proposalId}.`
				);
			}
		}

		const completedAt = this.nowFactory().toISOString();
		const auditAt = operationReceipt.startedAt;
		const auditEntry = preview.items.map((item) =>
				`## ${auditAt}\n` +
				'action: memory.proposal.archive\n' +
				'actor: user\n' +
				`proposal_id: ${item.proposalId}\n` +
				`previous_path: ${item.sourcePath}\n` +
				`current_path: ${item.destinationPath}\n` +
				`operation_id: ${preview.operationId}\n` +
				`timestamp: ${auditAt}\n\n`
			).join('');
		if (this.host.appendArchiveAuditEvent) {
			await this.host.appendArchiveAuditEvent(preview.operationId, auditEntry);
		} else {
			await this.host.appendToAuditLog(auditEntry);
		}
		await this.host.refreshGovernanceViews();
		const receipt: ArchiveMemoryProposalReceipt = {
			schemaVersion: 1,
			revision: operationReceipt.revision + 1,
			bindingHash: '',
			operationId: preview.operationId,
			previewHash: recoveryPreviewHash,
			status: 'completed',
			targets: operationReceipt.targets,
			moved: operationReceipt.targets,
			movedHashes: operationReceipt.movedHashes,
			managedReferences,
			startedAt: operationReceipt.startedAt,
			completedAt,
		};
		receipt.bindingHash = this.archiveReceiptBindingHash(receipt);
		await this.host.writeArchiveReceipt(
			receipt,
			operationReceipt.bindingHash
		);
		await this.completeArchiveTargetClaims(targetClaims, completedAt);
		return receipt;
	}

	private async hasMatchingArchiveTargetClaim(
		preview: ArchiveMemoryProposalPreview,
		previewHash: string
	): Promise<boolean> {
		const targets = preview.items.map((item) => ({
			item,
			targetHash: this.archiveTargetHash(item),
		}));
		const current = await Promise.all(
			targets.map(async ({ targetHash }) =>
				this.parseArchiveTargetClaim(
					await this.host.readArchiveTargetClaim(targetHash)
				)
			)
		);
		const existingClaims = current.filter(
			(claim): claim is ArchiveMemoryProposalTargetClaim => claim !== null
		);
		if (existingClaims.length === 0) {
			return false;
		}
		const startedAtValues = [...new Set(existingClaims.map((claim) => claim.startedAt))];
		if (startedAtValues.length !== 1) {
			throw new Error('Archive target claims have inconsistent start times.');
		}
		const startedAt = startedAtValues[0];
		for (let index = 0; index < targets.length; index += 1) {
			const claim = current[index];
			if (!claim) {
				continue;
			}
			this.assertArchiveTargetClaimMatches(
				claim,
				targets[index].item,
				targets[index].targetHash,
				preview.operationId,
				previewHash,
				startedAt
			);
			if (claim.status !== 'in-progress') {
				throw new Error('Archive target claim status conflicts with recovery.');
			}
		}
		return true;
	}

	private async acquireArchiveTargetClaims(
		preview: ArchiveMemoryProposalPreview,
		previewHash: string,
		operationReceipt: ArchiveMemoryProposalReceipt | null
	): Promise<ArchiveMemoryProposalTargetClaim[]> {
		const targets = preview.items.map((item) => ({
			item,
			targetHash: this.archiveTargetHash(item),
		}));
		const current = await Promise.all(
			targets.map(async ({ targetHash }) =>
				this.parseArchiveTargetClaim(
					await this.host.readArchiveTargetClaim(targetHash)
				)
			)
		);
		const existingStartedAt = [
			...new Set(
				current
					.filter((claim): claim is ArchiveMemoryProposalTargetClaim => claim !== null)
					.map((claim) => claim.startedAt)
			),
		];
		if (existingStartedAt.length > 1) {
			throw new Error('Archive target claims have inconsistent start times.');
		}
		const startedAt =
			operationReceipt?.startedAt
			?? existingStartedAt[0]
			?? this.nowFactory().toISOString();
		if (
			operationReceipt
			&& existingStartedAt.length === 1
			&& existingStartedAt[0] !== operationReceipt.startedAt
		) {
			throw new Error('Archive target claim conflicts with the operation receipt.');
		}

		for (let index = 0; index < targets.length; index += 1) {
			const claim = current[index];
			if (!claim) {
				if (operationReceipt?.status === 'completed') {
					throw new Error('Archive target claim is missing for the completed operation.');
				}
				continue;
			}
			this.assertArchiveTargetClaimMatches(
				claim,
				targets[index].item,
				targets[index].targetHash,
				preview.operationId,
				previewHash,
				startedAt
			);
			if (
				operationReceipt?.status === 'completed'
					? claim.status !== 'in-progress' && claim.status !== 'completed'
					: claim.status !== 'in-progress'
			) {
				throw new Error('Archive target claim status conflicts with the operation receipt.');
			}
		}

		const claimed: ArchiveMemoryProposalTargetClaim[] = [];
		for (let index = 0; index < targets.length; index += 1) {
			const existing = current[index];
			if (existing) {
				claimed.push(existing);
				continue;
			}
			const { item, targetHash } = targets[index];
			const claim: ArchiveMemoryProposalTargetClaim = {
				schemaVersion: 1,
				revision: 1,
				bindingHash: '',
				targetHash,
				operationId: preview.operationId,
				previewHash,
				status: 'in-progress',
				proposalId: item.proposalId,
				oldPath: item.sourcePath,
				newPath: item.destinationPath,
				sourceHash: item.sourceHash,
				startedAt,
				completedAt: null,
			};
			claim.bindingHash = this.archiveTargetClaimBindingHash(claim);
			await this.host.writeArchiveTargetClaim(claim, null);
			claimed.push(claim);
		}
		if (operationReceipt?.status !== 'completed') {
			await this.assertArchiveTargetClaimsOwned(claimed, 'in-progress');
		}
		return claimed;
	}

	private async assertArchiveTargetClaimsOwned(
		claims: readonly ArchiveMemoryProposalTargetClaim[],
		expectedStatus: 'in-progress' | 'completed'
	): Promise<void> {
		for (const expected of claims) {
			const current = this.parseArchiveTargetClaim(
				await this.host.readArchiveTargetClaim(expected.targetHash)
			);
			if (
				!current
				|| current.bindingHash !== expected.bindingHash
				|| current.operationId !== expected.operationId
				|| current.previewHash !== expected.previewHash
				|| current.status !== expectedStatus
			) {
				throw new Error(
					`Archive target claim changed outside the operation: ${expected.newPath}.`
				);
			}
		}
	}

	private async completeArchiveTargetClaims(
		claims: ArchiveMemoryProposalTargetClaim[],
		completedAt: string | null
	): Promise<void> {
		if (!completedAt || !Number.isFinite(Date.parse(completedAt))) {
			throw new Error('Archive completion time is invalid.');
		}
		for (let index = 0; index < claims.length; index += 1) {
			const expected = claims[index];
			const current = this.parseArchiveTargetClaim(
				await this.host.readArchiveTargetClaim(expected.targetHash)
			);
			if (
				!current
				|| current.operationId !== expected.operationId
				|| current.previewHash !== expected.previewHash
				|| current.targetHash !== expected.targetHash
				|| current.proposalId !== expected.proposalId
				|| current.oldPath !== expected.oldPath
				|| current.newPath !== expected.newPath
				|| current.sourceHash !== expected.sourceHash
				|| current.startedAt !== expected.startedAt
			) {
				throw new Error(
					`Archive target claim changed outside the operation: ${expected.newPath}.`
				);
			}
			if (current.status === 'completed') {
				if (current.completedAt !== completedAt) {
					throw new Error(
						`Archive target claim completion conflicts: ${expected.newPath}.`
					);
				}
				claims[index] = current;
				continue;
			}
			const completed: ArchiveMemoryProposalTargetClaim = {
				...current,
				revision: 2,
				bindingHash: '',
				status: 'completed',
				completedAt,
			};
			completed.bindingHash = this.archiveTargetClaimBindingHash(completed);
			await this.host.writeArchiveTargetClaim(
				completed,
				current.bindingHash
			);
			claims[index] = completed;
		}
		await this.assertArchiveTargetClaimsOwned(claims, 'completed');
	}

	private async serializeArchiveOperation<T>(
		key: string,
		action: () => Promise<T>
	): Promise<T> {
		const vaultKey = this.app.vault as object;
		let queues = archiveOperationQueues.get(vaultKey);
		if (!queues) {
			queues = new Map<string, Promise<void>>();
			archiveOperationQueues.set(vaultKey, queues);
		}
		const predecessor = queues.get(key) ?? Promise.resolve();
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = predecessor.catch(() => undefined).then(() => gate);
		queues.set(key, tail);
		await predecessor.catch(() => undefined);
		try {
			return await action();
		} finally {
			release();
			if (queues.get(key) === tail) {
				queues.delete(key);
				if (queues.size === 0) {
					archiveOperationQueues.delete(vaultKey);
				}
			}
		}
	}

	private async currentArchiveProposal(
		proposalId: string,
		expectedPath: string
	): Promise<ArchiveProposalInspection> {
		const history = await this.records.readProposalHistoryById(proposalId);
		if (history.status !== 'resolved') {
			throw new Error(`Archive proposal id is duplicate, ambiguous, or missing: ${proposalId}.`);
		}
		if (history.record.archived || history.record.path !== expectedPath) {
			throw new Error(`Archive proposal source changed: ${expectedPath}.`);
		}
		if (!isReviewQueueArchiveCandidate(history.record)) {
			throw new Error(`Archive proposal status is not archiveable: ${expectedPath}.`);
		}
		const inspection = await this.inspectArchiveProposal(history.record.path);
		if (
			inspection.proposalId !== proposalId
			|| inspection.fileContentHash !== history.record.fileContentHash
		) {
			throw new Error(`Archive proposal changed while preparing preview: ${expectedPath}.`);
		}
		return inspection;
	}

	private async inspectArchiveProposal(
		proposalPath: string
	): Promise<ArchiveProposalInspection> {
		if (this.transitions.inspect) {
			return this.transitions.inspect(proposalPath);
		}
		const file = this.app.vault.getAbstractFileByPath(proposalPath);
		if (!(file instanceof TFile)) {
			throw new Error(`Archive proposal is unavailable: ${proposalPath}.`);
		}
		const record = await this.records.readMemoryProposalFile(file);
		if (!record) {
			throw new Error(`Archive proposal is invalid: ${proposalPath}.`);
		}
		return {
			path: record.path,
			proposalId: record.proposalId,
			status: record.approvalStatus,
			classification: record.classification,
			revision: record.revision,
			fileContentHash: record.fileContentHash,
		};
	}

	private archiveDestinationPath(sourcePath: string): string {
		const fileName = sourcePath.split('/').pop() || 'proposal.md';
		const normalizedName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
		return this.host.normalizeVaultPath(
			`${ARCHIVE_REVIEW_QUEUE_DIR}/${normalizedName}`
		);
	}

	private async previewManagedReferences(
		proposalId: string,
		sourcePath: string,
		sourceFile: TFile
	): Promise<{
		references: ArchiveManagedReferencePreview[];
		conflicts: ArchiveConflict[];
	}> {
		const references: ArchiveManagedReferencePreview[] = [];
		const conflicts: ArchiveConflict[] = [];
		const files = [TRACEKEEPER_TASKS_DIR, TRACEKEEPER_SESSIONS_DIR]
			.map((path) => this.app.vault.getAbstractFileByPath(path))
			.filter((folder): folder is TFolder => folder instanceof TFolder)
			.flatMap((folder) => this.records.collectMarkdownFiles(folder))
			.sort((left, right) => left.path.localeCompare(right.path));
		for (const file of files) {
			const content = await this.app.vault.read(file);
			const parsed = readFrontmatter(content);
			const ids = this.frontmatterValues(parsed.fields.proposal_ids);
			const paths = this.frontmatterValues(parsed.fields.proposal_paths);
			const legacyPaths = this.frontmatterValues(parsed.fields.proposals);
			const idCount = countExact(ids, proposalId);
			const pathCount = countExact(paths, sourcePath);
			const legacyPathCount = countExact(legacyPaths, sourcePath);
			if (idCount === 0 && pathCount === 0 && legacyPathCount === 0) {
				continue;
			}
			const normalizedType = firstString(parsed.fields, ['type'])
				.toLowerCase()
				.replace(/_/g, '-');
			if (normalizedType !== 'agent-task' && normalizedType !== 'session-note') {
				conflicts.push({
					kind: 'managed-reference-unmanaged',
					path: file.path,
					proposalId,
				});
				continue;
			}
			if (legacyPathCount > 0) {
				conflicts.push({
					kind: 'managed-reference-legacy-path',
					path: file.path,
					proposalId,
				});
				continue;
			}
			if (idCount === 0) {
				conflicts.push({
					kind: 'managed-reference-missing-id',
					path: file.path,
					proposalId,
				});
				continue;
			}
			if (pathCount === 0) {
				conflicts.push({
					kind: 'managed-reference-missing-path',
					path: file.path,
					proposalId,
				});
				continue;
			}
			if (idCount !== 1 || pathCount !== 1) {
				conflicts.push({
					kind: 'managed-reference-ambiguous',
					path: file.path,
					proposalId,
				});
				continue;
			}
				const beforeLink = this.app.fileManager.generateMarkdownLink(
					sourceFile,
					file.path
				);
				const storedLinks = this.frontmatterValues(parsed.fields.proposal_links);
				const pairedIndex = ids.findIndex(
					(id, index) => id === proposalId && paths[index] === sourcePath
				);
				const marker = archiveProposalReferenceMarker(proposalId);
				const bodyLine = parsed.body
					.split(/\r?\n/)
					.find((line) =>
						line.includes(marker)
						|| (
							ids.length === 1
							&& paths.length === 1
							&& /^\s*(?:[-*]\s+)?Proposal\s*:/i.test(line)
						)
					);
				const boundBeforeLink =
					(pairedIndex >= 0 ? storedLinks[pairedIndex] : '')
					|| firstMarkdownLink(bodyLine || '')
					|| beforeLink;
				const destinationPath = this.archiveDestinationPath(sourcePath);
				const invariantHash = hashVaultContent(
					managedArchiveReferenceInvariant(content, [{
						proposalId,
						oldPath: sourcePath,
						newPath: destinationPath,
						oldLink: boundBeforeLink,
						newLink: boundBeforeLink,
						nativeUpdatedLink: retargetManagedLink(
							boundBeforeLink,
							file.path,
							destinationPath
						),
					}])
				);
			references.push({
				path: file.path,
				contentHash: hashVaultContent(content),
					invariantHash,
					proposalId,
					sourcePath,
					beforeLink: boundBeforeLink,
				});
		}
		return { references, conflicts };
	}

	private async revalidateManagedReferences(
		items: readonly ArchiveProposalPreviewItem[],
		requireOriginalHash: boolean
	): Promise<void> {
		const snapshots = this.uniqueReferenceSnapshots(items);
		for (const [path, references] of snapshots) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				throw new Error(`Archive managed reference is missing: ${path}.`);
			}
			const content = await this.app.vault.read(file);
			const currentHash = hashVaultContent(content);
			const replacements = this.archiveReferenceReplacements(
				path,
				references,
				items
			);
			const invariantHash = hashVaultContent(
				managedArchiveReferenceInvariant(content, replacements)
			);
			if (references.some((reference) =>
				requireOriginalHash
					? reference.contentHash !== currentHash
					: reference.invariantHash !== invariantHash
			)) {
				throw new Error(`Archive managed reference changed or became stale: ${path}.`);
			}
			const parsed = readFrontmatter(content);
			const ids = this.frontmatterValues(parsed.fields.proposal_ids);
			const paths = this.frontmatterValues(parsed.fields.proposal_paths);
			for (const reference of references) {
				const item = items.find(
					(candidate) => candidate.proposalId === reference.proposalId
				);
				if (
					!item
					|| countExact(ids, reference.proposalId) !== 1
					|| countExact(paths, item.sourcePath)
						+ countExact(paths, item.destinationPath) !== 1
				) {
					throw new Error(`Archive managed reference is ambiguous: ${path}.`);
				}
			}
		}
	}

	private async bindManagedReferenceInvariants(
		items: readonly ArchiveProposalPreviewItem[]
	): Promise<void> {
		for (const [path, references] of this.uniqueReferenceSnapshots(items)) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				throw new Error(`Archive managed reference is missing: ${path}.`);
			}
			const content = await this.app.vault.read(file);
			const invariantHash = hashVaultContent(
				managedArchiveReferenceInvariant(
					content,
					this.archiveReferenceReplacements(path, references, items)
				)
			);
			for (const reference of references) {
				reference.invariantHash = invariantHash;
			}
		}
	}

	private async relinkManagedReferences(
		items: readonly ArchiveProposalPreviewItem[]
	): Promise<Array<{ path: string; contentHash: string }>> {
		const committed: Array<{ path: string; contentHash: string }> = [];
		for (const [path, references] of this.uniqueReferenceSnapshots(items)) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				throw new Error(`Archive managed reference is missing: ${path}.`);
			}
			const replacements = this.archiveReferenceReplacements(
				path,
				references,
				items
			);
			const current = await this.app.vault.process(file, (current) => {
				const currentInvariantHash = hashVaultContent(
					managedArchiveReferenceInvariant(current, replacements)
				);
				if (references.some(
					(reference) => reference.invariantHash !== currentInvariantHash
				)) {
					throw new Error(`Archive managed reference changed or became stale: ${path}.`);
				}
				const parsed = readFrontmatter(current);
				const ids = this.frontmatterValues(parsed.fields.proposal_ids);
				const paths = this.frontmatterValues(parsed.fields.proposal_paths);
				for (const replacement of replacements) {
					if (
						countExact(ids, replacement.proposalId) !== 1
						|| countExact(paths, replacement.oldPath)
							+ countExact(paths, replacement.newPath) !== 1
					) {
						throw new Error(`Archive managed reference is ambiguous: ${path}.`);
					}
				}
				return replaceManagedArchiveReference(current, replacements);
			});
			committed.push({
				path,
				contentHash: hashVaultContent(current),
			});
		}
		return committed.sort((left, right) => left.path.localeCompare(right.path));
	}

	private archiveReferenceReplacements(
		referencePath: string,
		references: readonly ArchiveManagedReferencePreview[],
		items: readonly ArchiveProposalPreviewItem[]
	): Array<{
		proposalId: string;
		oldPath: string;
		newPath: string;
		oldLink: string;
		newLink: string;
		nativeUpdatedLink: string;
	}> {
		return references.map((reference) => {
			const item = items.find(
				(candidate) => candidate.proposalId === reference.proposalId
			);
			if (!item) {
				throw new Error(`Archive managed reference item is missing: ${reference.proposalId}.`);
			}
			const destination = this.app.vault.getAbstractFileByPath(item.destinationPath);
			return {
				proposalId: item.proposalId,
					oldPath: item.sourcePath,
					newPath: item.destinationPath,
					oldLink: reference.beforeLink,
					newLink: destination instanceof TFile
						? this.app.fileManager.generateMarkdownLink(destination, referencePath)
						: reference.beforeLink,
					nativeUpdatedLink: retargetManagedLink(
						reference.beforeLink,
						referencePath,
						item.destinationPath
					),
				};
		});
	}

	private uniqueReferenceSnapshots(
		items: readonly ArchiveProposalPreviewItem[]
	): Map<string, ArchiveManagedReferencePreview[]> {
		const references = new Map<string, ArchiveManagedReferencePreview[]>();
		for (const item of items) {
			for (const reference of item.referenceSnapshots) {
				const existing = references.get(reference.path) || [];
				existing.push(reference);
				references.set(reference.path, existing);
			}
		}
		return new Map(
			[...references.entries()].sort(([left], [right]) => left.localeCompare(right))
		);
	}

	private frontmatterValues(value: string | string[] | undefined): string[] {
		const normalize = (item: string): string =>
			item.trim().replace(/^['"]|['"]$/g, '');
		if (Array.isArray(value)) {
			return value.map(normalize).filter(Boolean);
		}
		return typeof value === 'string'
			? value.split(',').map(normalize).filter(Boolean)
			: [];
	}

	private archiveConfirmationToken(
		preview: Omit<ArchiveMemoryProposalPreview, 'confirmationToken'>
			| ArchiveMemoryProposalPreview
	): string {
		const { confirmationToken: _confirmationToken, ...unsigned } =
			preview as ArchiveMemoryProposalPreview;
		return hashVaultContent(JSON.stringify(unsigned));
	}

	private archiveRecoveryPreviewHash(
		preview: Omit<ArchiveMemoryProposalPreview, 'confirmationToken'>
			| ArchiveMemoryProposalPreview
	): string {
		const { confirmationToken: _confirmationToken, ...unsigned } =
			preview as ArchiveMemoryProposalPreview;
		return computePayloadHash({
			schemaVersion: 1,
			purpose: 'archive-recovery-preview',
			preview: unsigned,
		});
	}

	private assertArchivePreviewBounds(
		preview: Omit<ArchiveMemoryProposalPreview, 'confirmationToken'>
			| ArchiveMemoryProposalPreview
	): void {
		if (
			preview.items.length === 0
			|| preview.items.length > ARCHIVE_MAX_ITEMS
		) {
			throw new Error('Archive preview record count is outside the bounded range.');
		}
		const managedPaths = [
			...new Set(preview.items.flatMap((item) => item.managedReferences)),
		].sort();
		if (managedPaths.length > ARCHIVE_MAX_MANAGED_REFERENCE_PATHS) {
			throw new Error(
				`Archive preview exceeds the ${ARCHIVE_MAX_MANAGED_REFERENCE_PATHS}-reference limit.`
			);
		}
		if (JSON.stringify(preview).length > ARCHIVE_PREVIEW_MAX_LENGTH) {
			throw new Error('Archive preview exceeds the bounded record size.');
		}
		const projectedReceipt: ArchiveMemoryProposalReceipt = {
			schemaVersion: 1,
			revision: 1,
			bindingHash: '0'.repeat(64),
			operationId: preview.operationId,
			previewHash: '0'.repeat(64),
			status: 'completed',
			targets: preview.items.map((item) => ({
				proposalId: item.proposalId,
				oldPath: item.sourcePath,
				newPath: item.destinationPath,
			})),
			moved: preview.items.map((item) => ({
				proposalId: item.proposalId,
				oldPath: item.sourcePath,
				newPath: item.destinationPath,
			})),
			movedHashes: Object.fromEntries(
				preview.items.map((item) => [item.proposalId, item.sourceHash])
			),
			managedReferences: managedPaths.map((path) => ({
				path,
				contentHash: '0'.repeat(64),
			})),
			startedAt: '9999-12-31T23:59:59.999Z',
			completedAt: '9999-12-31T23:59:59.999Z',
		};
		if (
			`${JSON.stringify(projectedReceipt, null, 2)}\n`.length
			> ARCHIVE_RECEIPT_MAX_LENGTH
		) {
			throw new Error('Archive receipt would exceed the bounded record size.');
		}
		for (const item of preview.items) {
			const projectedClaim: ArchiveMemoryProposalTargetClaim = {
				schemaVersion: 1,
				revision: 2,
				bindingHash: '0'.repeat(64),
				targetHash: '0'.repeat(64),
				operationId: preview.operationId,
				previewHash: '0'.repeat(64),
				status: 'completed',
				proposalId: item.proposalId,
				oldPath: item.sourcePath,
				newPath: item.destinationPath,
				sourceHash: item.sourceHash,
				startedAt: '9999-12-31T23:59:59.999Z',
				completedAt: '9999-12-31T23:59:59.999Z',
			};
			if (
				`${JSON.stringify(projectedClaim, null, 2)}\n`.length
				> ARCHIVE_TARGET_CLAIM_MAX_LENGTH
			) {
				throw new Error('Archive target claim would exceed the bounded record size.');
			}
		}
	}

	private parseArchiveReceipt(value: unknown): ArchiveMemoryProposalReceipt | null {
		if (value === null || value === undefined) {
			return null;
		}
		if (
			!isRecord(value)
			|| value.schemaVersion !== 1
			|| !Number.isSafeInteger(value.revision)
			|| (
				value.status === 'in-progress'
					? value.revision !== 1
					: value.status === 'completed'
						? value.revision !== 2
						: true
			)
			|| typeof value.bindingHash !== 'string'
			|| !/^[a-f0-9]{64}$/.test(value.bindingHash)
			|| typeof value.operationId !== 'string'
			|| typeof value.previewHash !== 'string'
			|| (value.status !== 'in-progress' && value.status !== 'completed')
			|| !Array.isArray(value.targets)
			|| !value.targets.every((item) =>
				isRecord(item)
				&& typeof item.proposalId === 'string'
				&& typeof item.oldPath === 'string'
				&& typeof item.newPath === 'string'
			)
			|| !Array.isArray(value.moved)
			|| !value.moved.every((item) =>
				isRecord(item)
				&& typeof item.proposalId === 'string'
				&& typeof item.oldPath === 'string'
				&& typeof item.newPath === 'string'
			)
			|| !isRecord(value.movedHashes)
			|| Object.values(value.movedHashes).some(
				(hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)
			)
			|| !Array.isArray(value.managedReferences)
			|| !value.managedReferences.every((item) =>
				isRecord(item)
				&& typeof item.path === 'string'
				&& typeof item.contentHash === 'string'
				&& /^[a-f0-9]{64}$/.test(item.contentHash)
			)
			|| typeof value.startedAt !== 'string'
			|| !Number.isFinite(Date.parse(value.startedAt))
			|| (
				value.completedAt !== null
				&& (
					typeof value.completedAt !== 'string'
					|| !Number.isFinite(Date.parse(value.completedAt))
				)
			)
			|| (
				value.status === 'in-progress'
				&& (
					value.completedAt !== null
					|| value.moved.length !== 0
					|| value.managedReferences.length !== 0
				)
			)
			|| (
				value.status === 'completed'
				&& (
					value.completedAt === null
					|| Date.parse(value.completedAt as string)
						< Date.parse(value.startedAt)
				)
			)
		) {
			throw new Error('Archive operation receipt is invalid.');
		}
		const receipt = value as unknown as ArchiveMemoryProposalReceipt;
		if (receipt.bindingHash !== this.archiveReceiptBindingHash(receipt)) {
			throw new Error('Archive operation receipt integrity is invalid.');
		}
		return receipt;
	}

	private archiveTargetHash(item: ArchiveProposalPreviewItem): string {
		return computePayloadHash({
			schemaVersion: 1,
			proposalId: item.proposalId,
			oldPath: item.sourcePath,
			newPath: item.destinationPath,
		});
	}

	private parseArchiveTargetClaim(
		value: unknown
	): ArchiveMemoryProposalTargetClaim | null {
		if (value === null || value === undefined) {
			return null;
		}
		if (
			!isRecord(value)
			|| value.schemaVersion !== 1
			|| !Number.isSafeInteger(value.revision)
			|| (
				value.status === 'in-progress'
					? value.revision !== 1
					: value.status === 'completed'
						? value.revision !== 2
						: true
			)
			|| typeof value.bindingHash !== 'string'
			|| !/^[a-f0-9]{64}$/.test(value.bindingHash)
			|| typeof value.targetHash !== 'string'
			|| !/^[a-f0-9]{64}$/.test(value.targetHash)
			|| typeof value.operationId !== 'string'
			|| !/^archive-[A-Za-z0-9_-]{1,152}$/.test(value.operationId)
			|| typeof value.previewHash !== 'string'
			|| !/^[a-f0-9]{64}$/.test(value.previewHash)
			|| typeof value.proposalId !== 'string'
			|| !value.proposalId
			|| typeof value.oldPath !== 'string'
			|| !value.oldPath
			|| typeof value.newPath !== 'string'
			|| !value.newPath
			|| typeof value.sourceHash !== 'string'
			|| !/^[a-f0-9]{64}$/.test(value.sourceHash)
			|| typeof value.startedAt !== 'string'
			|| !Number.isFinite(Date.parse(value.startedAt))
			|| (
				value.status === 'in-progress'
					? value.completedAt !== null
					: typeof value.completedAt !== 'string'
						|| !Number.isFinite(Date.parse(value.completedAt))
						|| Date.parse(value.completedAt) < Date.parse(value.startedAt)
			)
		) {
			throw new Error('Archive target claim is invalid.');
		}
		const claim = value as unknown as ArchiveMemoryProposalTargetClaim;
		if (
			claim.bindingHash !== this.archiveTargetClaimBindingHash(claim)
			|| claim.targetHash !== computePayloadHash({
				schemaVersion: 1,
				proposalId: claim.proposalId,
				oldPath: claim.oldPath,
				newPath: claim.newPath,
			})
		) {
			throw new Error('Archive target claim integrity is invalid.');
		}
		return claim;
	}

	private assertArchiveTargetClaimMatches(
		claim: ArchiveMemoryProposalTargetClaim,
		item: ArchiveProposalPreviewItem,
		targetHash: string,
		operationId: string,
		previewHash: string,
		startedAt: string
	): void {
		if (
			claim.targetHash !== targetHash
			|| claim.operationId !== operationId
			|| claim.previewHash !== previewHash
			|| claim.proposalId !== item.proposalId
			|| claim.oldPath !== item.sourcePath
			|| claim.newPath !== item.destinationPath
			|| claim.sourceHash !== item.sourceHash
			|| claim.startedAt !== startedAt
		) {
			throw new Error(
				`Archive target is owned by another operation: ${item.destinationPath}.`
			);
		}
	}

	private archiveTargetClaimBindingHash(
		claim: ArchiveMemoryProposalTargetClaim
	): string {
		const {
			bindingHash: _bindingHash,
			...payload
		} = claim;
		return computePayloadHash(payload);
	}

	private assertArchiveReceiptMatchesPreview(
		receipt: ArchiveMemoryProposalReceipt,
		preview: ArchiveMemoryProposalPreview,
		expectedToken: string
	): void {
		const expectedMoved = preview.items.map((item) => ({
			proposalId: item.proposalId,
			oldPath: item.sourcePath,
			newPath: item.destinationPath,
		}));
		const expectedReferencePaths = [
			...new Set(preview.items.flatMap((item) => item.managedReferences)),
		].sort();
		const actualReferencePaths = receipt.managedReferences
			.map((reference) => reference.path)
			.sort();
		const expectedHashes = Object.fromEntries(
			preview.items.map((item) => [item.proposalId, item.sourceHash])
		);
		if (
			receipt.operationId !== preview.operationId
			|| receipt.previewHash !== expectedToken
			|| JSON.stringify(receipt.targets) !== JSON.stringify(expectedMoved)
			|| JSON.stringify(receipt.movedHashes) !== JSON.stringify(expectedHashes)
			|| (
				receipt.status === 'in-progress'
					? receipt.moved.length !== 0
						|| actualReferencePaths.length !== 0
					: JSON.stringify(receipt.moved) !== JSON.stringify(expectedMoved)
						|| JSON.stringify(actualReferencePaths)
							!== JSON.stringify(expectedReferencePaths)
			)
		) {
			throw new Error('Archive operation receipt conflicts with this preview.');
		}
	}

	private archiveReceiptBindingHash(
		receipt: ArchiveMemoryProposalReceipt
	): string {
		const {
			bindingHash: _bindingHash,
			...payload
		} = receipt;
		return computePayloadHash(payload);
	}

}
