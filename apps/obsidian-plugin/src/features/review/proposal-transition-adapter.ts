import {
	getFrontMatterInfo,
	parseYaml,
	stringifyYaml,
	type App,
	TFile,
} from 'obsidian';
import {
	ARCHIVE_REVIEW_QUEUE_DIR,
	ProposalTransitionConflictError,
	ProposalTransitionValidationError,
	ProposalWritebackFormatError,
	computeProposalRevision,
	computePayloadHash,
	hashVaultContent,
	isAllowedProposalTargetPath,
	isKnowledgeWikiPath,
	proposalTransitionReceiptFromFrontmatter,
	replaceProposalWriteback,
	resolveProposalWriteback,
	transitionProposal,
	type ProposalFrontmatterMutationValue,
	type ProposalTransitionCommand,
	type ProposalTransitionDecision,
	type ProposalTransitionEnvironment,
	type ProposalTransitionSnapshot,
	type ProposalTransitionStatus,
} from '@tracekeeper/core';
import type { ArchiveProposalInspection } from './review-queue-controller';
import { withObsidianVaultPathLocks } from '../../adapters/obsidian-vault-path-lock';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ObsidianProposalTransitionRequest extends ProposalTransitionCommand {
	proposalPath: string;
	expectedFileHash?: string;
	now?: string;
	actor?: string;
	ownedCreateTargetPath?: string | null;
	ownedCreateTargetContentHash?: string | null;
}

interface OwnedCreateTargetProof {
	path: string;
	contentHash: string;
}

const ownedCreateTargetProof = (
	request: ObsidianProposalTransitionRequest
): OwnedCreateTargetProof | null => {
	const path = request.ownedCreateTargetPath?.trim() || '';
	const contentHash = request.ownedCreateTargetContentHash?.trim() || '';
	if (!path && !contentHash) {
		return null;
	}
	if (!path || !contentHash) {
		throw new ProposalTransitionValidationError(
			'Owned create target proof requires both path and content hash.'
		);
	}
	if (request.action.kind !== 'apply') {
		throw new ProposalTransitionValidationError(
			'Owned create target proof is only valid for apply transitions.'
		);
	}
	if (!isAllowedProposalTargetPath(path)) {
		throw new ProposalTransitionValidationError(
			'Owned create target proof is outside the allowed Memory or Wiki boundary.'
		);
	}
	if (!/^[a-f0-9]{64}$/i.test(contentHash)) {
		throw new ProposalTransitionValidationError(
			'Owned create target content hash is invalid.'
		);
	}
	return { path, contentHash: contentHash.toLowerCase() };
};

const verifyOwnedCreateTargetHash = async (
	app: App,
	targetPath: string,
	expectedHash: string
): Promise<void> => {
	const targetFile = app.vault.getAbstractFileByPath(targetPath);
	if (!(targetFile instanceof TFile)) {
		throw new ProposalTransitionValidationError(
			'Proposal writeback target disappeared before apply.'
		);
	}
	const content = await app.vault.read(targetFile);
	if (hashVaultContent(content) !== expectedHash) {
		throw new ProposalTransitionValidationError(
			'Proposal writeback target changed before apply.'
		);
	}
};

const scalarText = (value: unknown): string => {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value.toString();
	}
	if (typeof value === 'boolean') {
		return value ? 'true' : 'false';
	}
	return '';
};

const scalarField = (
	frontmatter: Readonly<Record<string, unknown>>,
	keys: readonly string[],
	label: string
): string => {
	const values = keys
		.map((key) => {
			const value = frontmatter[key];
			if (
				value !== undefined
				&& value !== null
				&& (typeof value === 'object' || typeof value === 'function')
			) {
				throw new ProposalTransitionValidationError(`${label} is invalid.`);
			}
			return scalarText(value).trim();
		})
		.filter(Boolean);
	if (new Set(values).size > 1) {
		throw new ProposalTransitionValidationError(`${label} fields conflict.`);
	}
	return values[0] || '';
};

const multilineField = (
	frontmatter: Readonly<Record<string, unknown>>,
	keys: readonly string[],
	label: string
): string => {
	const values = keys
		.map((key) => {
			const value = frontmatter[key];
			if (Array.isArray(value)) {
				return value.map(scalarText).join('\n').trim();
			}
			if (
				value !== undefined
				&& value !== null
				&& (typeof value === 'object' || typeof value === 'function')
			) {
				throw new ProposalTransitionValidationError(`${label} is invalid.`);
			}
			return scalarText(value).replace(/\\n/g, '\n').trim();
		})
		.filter(Boolean);
	if (new Set(values).size > 1) {
		throw new ProposalTransitionValidationError(`${label} fields conflict.`);
	}
	return values[0] || '';
};

const parseWritebackEffect = (
	frontmatter: Readonly<Record<string, unknown>>
): 'append' | 'create_wiki_note' | 'create_memory_record' | 'update_managed_relations' | undefined => {
	const value = scalarField(frontmatter, ['writeback_effect', 'writebackEffect'], 'Proposal writeback effect');
	if (!value) {
		return undefined;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === 'append') {
		return 'append';
	}
	if (normalized === 'create_wiki_note') {
		return 'create_wiki_note';
	}
	if (normalized === 'create_memory_record') {
		return 'create_memory_record';
	}
	if (normalized === 'update_managed_relations') {
		return 'update_managed_relations';
	}
	throw new ProposalTransitionValidationError('Proposal writeback effect is not supported.');
};

const proposalStatus = (
	frontmatter: Readonly<Record<string, unknown>>
): ProposalTransitionStatus => {
	const rawValues = ['approval_status', 'approvalStatus', 'status']
		.map((key) => {
			const value = frontmatter[key];
			if (
				value !== undefined
				&& value !== null
				&& (typeof value === 'object' || typeof value === 'function')
			) {
				throw new ProposalTransitionValidationError('Proposal status is invalid.');
			}
			return scalarText(value).trim();
		})
		.filter(Boolean);
	if (rawValues.length === 0) {
		return 'pending';
	}
	const values = rawValues.map((value) => {
		const normalized = value.toLowerCase().replace(/[\s-]+/g, '_');
		if (normalized === 'pending_review') {
			return 'pending';
		}
		if (
			normalized === 'pending'
			|| normalized === 'approved'
			|| normalized === 'rejected'
			|| normalized === 'deferred'
			|| normalized === 'revision_requested'
			|| normalized === 'applied'
		) {
			return normalized;
		}
		throw new ProposalTransitionValidationError('Proposal status is invalid.');
	});
	if (new Set(values).size > 1) {
		throw new ProposalTransitionValidationError('Proposal status fields conflict.');
	}
	return values[0];
};

const proposalSnapshot = (
	file: TFile,
	frontmatter: Readonly<Record<string, unknown>>,
	body: string
): ProposalTransitionSnapshot => {
	const proposalKind = scalarField(
		frontmatter,
		['proposal_kind', 'proposalKind'],
		'Proposal kind'
	);
	const rawType = scalarField(frontmatter, ['type'], 'Proposal type');
	const normalizedType = rawType.toLowerCase().replace(/_/g, '-');
	const classification = normalizedType === 'memory-proposal'
		? 'memory_proposal'
		: normalizedType === 'legacy-migration-review'
			? 'legacy_migration_review'
			: proposalKind && rawType
				? 'other_review_item'
				: proposalKind
					? 'memory_proposal'
					: null;
	if (!classification) {
		throw new ProposalTransitionValidationError('Proposal is not a supported review item.');
	}
	const pathLeaf = file.path.split('/').pop() || '';
	const proposalId = scalarField(
		frontmatter,
		['proposal_id', 'proposalId'],
		'Proposal id'
	) || pathLeaf.replace(/\.md$/i, '');
	const frontmatterWriteback = multilineField(
		frontmatter,
		['writeback_content', 'writebackContent'],
		'Proposal writeback content'
	);
	const writeback = resolveProposalWriteback({
		body,
		proposalId,
		frontmatterContent: frontmatterWriteback,
	});
	if (writeback.error === 'conflicting_sources') {
		throw new ProposalTransitionConflictError('Proposal writeback sources conflict.');
	}
	if (writeback.error || writeback.ambiguous) {
		throw new ProposalTransitionValidationError(
			`Proposal writeback boundary is ${writeback.error || 'ambiguous'}.`
		);
	}
	const lastTransition = proposalTransitionReceiptFromFrontmatter(frontmatter);
	return {
		path: file.path,
		classification,
		proposalId,
		proposalKind: proposalKind || classification,
		taskId: scalarField(frontmatter, ['task_id', 'taskId'], 'Task id'),
		status: proposalStatus(frontmatter),
		targetPath: scalarField(
			frontmatter,
			['target_note', 'targetNote', 'target_path', 'targetPath'],
			'Proposal target'
		),
		writebackContent: writeback.content,
		writebackEffect: parseWritebackEffect(frontmatter),
		revisionComment: multilineField(
			frontmatter,
			['revision_comment', 'revisionComment'],
			'Revision comment'
		),
		revisionRequestedAt: scalarField(
			frontmatter,
			['revision_requested_at', 'revisionRequestedAt'],
			'Revision request time'
		),
		revisionRequestedBy: scalarField(
			frontmatter,
			['revision_requested_by', 'revisionRequestedBy'],
			'Revision requester'
		),
		archived: file.path === ARCHIVE_REVIEW_QUEUE_DIR
			|| file.path.startsWith(`${ARCHIVE_REVIEW_QUEUE_DIR}/`),
		appliedOperationId: scalarField(
			frontmatter,
			['writeback_operation_id', 'writebackOperationId'],
			'Applied operation id'
		) || (
			lastTransition?.kind === 'apply'
				? lastTransition.operationId
				: undefined
		),
		lastTransition,
	};
};

const applyFrontmatterMutation = (
	frontmatter: Record<string, unknown>,
	mutation: Readonly<Record<string, ProposalFrontmatterMutationValue>>
): void => {
	for (const [key, value] of Object.entries(mutation)) {
		if (value === null) {
			delete frontmatter[key];
			continue;
		}
		frontmatter[key] = Array.isArray(value) ? value.slice() : value;
	}
};

const replaceFrontmatter = (
	content: string,
	frontmatter: Readonly<Record<string, unknown>>
): string => {
	const info = getFrontMatterInfo(content);
	if (!info.exists) {
		throw new ProposalTransitionValidationError('Proposal frontmatter is required.');
	}
	const rendered = stringifyYaml(frontmatter).trimEnd();
	return `${content.slice(0, info.from)}${rendered}\n${content.slice(info.to)}`;
};

export class ObsidianProposalTransitionAdapter {
	constructor(private readonly app: App) {}

	async inspect(proposalPath: string): Promise<ArchiveProposalInspection> {
		const file = this.app.vault.getAbstractFileByPath(proposalPath);
		if (!(file instanceof TFile)) {
			throw new ProposalTransitionConflictError('Proposal is not available.');
		}
		const content = await this.app.vault.read(file);
		const info = getFrontMatterInfo(content);
		if (!info.exists) {
			throw new ProposalTransitionValidationError('Proposal frontmatter is required.');
		}
		const parsed: unknown = parseYaml(info.frontmatter);
		if (!isRecord(parsed)) {
			throw new ProposalTransitionValidationError('Proposal frontmatter is invalid.');
		}
		const snapshot = this.currentSnapshot(
			file,
			parsed,
			content.slice(info.contentStart)
		);
		return {
			path: snapshot.path,
			proposalId: snapshot.proposalId,
			status: snapshot.status,
			classification: snapshot.classification,
			revision: computeProposalRevision(snapshot),
			fileContentHash: hashVaultContent(content),
		};
	}

	async transition(
		request: ObsidianProposalTransitionRequest
	): Promise<ProposalTransitionDecision> {
		const ownedCreateProof = ownedCreateTargetProof(request);
		return withObsidianVaultPathLocks(
			this.app.vault,
			[
				request.proposalPath,
				...(ownedCreateProof ? [ownedCreateProof.path] : []),
			],
			async () => {
				if (ownedCreateProof) {
					await verifyOwnedCreateTargetHash(
						this.app,
						ownedCreateProof.path,
						ownedCreateProof.contentHash
					);
				}
				const file = this.app.vault.getAbstractFileByPath(request.proposalPath);
				if (!(file instanceof TFile)) {
					throw new ProposalTransitionConflictError('Proposal is not available.');
				}
				if (
					request.action.kind === 'apply'
					|| request.action.kind === 'draft'
					|| (
						request.action.kind === 'status'
						&& request.action.nextStatus === 'approved'
					)
				) {
					return this.transitionText(file, request);
				}
				return this.transitionFrontmatter(file, request);
			}
		);
	}

	private environment(
		request: ObsidianProposalTransitionRequest,
		frontmatter: Readonly<Record<string, unknown>>
	): ProposalTransitionEnvironment {
		const claimKey = scalarField(
			frontmatter,
			['claim_key', 'claimKey'],
			'Proposal claim key'
		);
		const isApply = request.action.kind === 'apply';
		const ownedCreateProof = ownedCreateTargetProof(request);
		const writebackEffect = parseWritebackEffect(frontmatter);
		const isOwnedCreateTarget = (relativePath: string): boolean =>
			isApply
				&& (writebackEffect === 'create_wiki_note' || writebackEffect === 'create_memory_record')
				&& ownedCreateProof !== null
				&& ownedCreateProof.path === relativePath;
		return {
			now: request.now || new Date().toISOString(),
			actor: request.actor || 'user',
			targetAllowed: isAllowedProposalTargetPath,
			targetExists: (relativePath) => {
				const file = this.app.vault.getAbstractFileByPath(relativePath);
				const exists = file instanceof TFile;
				if (isOwnedCreateTarget(relativePath)) {
					if (!exists) {
						throw new ProposalTransitionValidationError(
							'Proposal writeback target disappeared before apply.'
						);
					}
					return false;
				}
				return exists;
			},
			targetCreationAllowed: (relativePath) =>
				Boolean(claimKey)
				|| (
					isOwnedCreateTarget(relativePath)
					&& isKnowledgeWikiPath(relativePath)
				),
		};
	}

	private currentSnapshot(
		file: TFile,
		frontmatter: Readonly<Record<string, unknown>>,
		body: string
	): ProposalTransitionSnapshot {
		return proposalSnapshot(file, frontmatter, body);
	}

	private async transitionFrontmatter(
		file: TFile,
		request: ObsidianProposalTransitionRequest
	): Promise<ProposalTransitionDecision> {
		let committed: ProposalTransitionDecision | null = null;
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const frontmatterValue: unknown = frontmatter;
			if (!isRecord(frontmatterValue)) {
				throw new ProposalTransitionValidationError('Proposal frontmatter is invalid.');
			}
			const current = this.currentSnapshot(file, frontmatterValue, '');
			committed = transitionProposal(
				current,
				request,
				this.environment(request, frontmatterValue)
			);
			applyFrontmatterMutation(frontmatterValue, committed.frontmatter);
		});
		if (!committed) {
			throw new ProposalTransitionConflictError('Proposal transition did not commit.');
		}
		return committed;
	}

	private async transitionText(
		file: TFile,
		request: ObsidianProposalTransitionRequest
	): Promise<ProposalTransitionDecision> {
		let committed: ProposalTransitionDecision | null = null;
		await this.app.vault.process(file, (content) => {
			const info = getFrontMatterInfo(content);
			if (!info.exists) {
				throw new ProposalTransitionValidationError('Proposal frontmatter is required.');
			}
			const parsed: unknown = parseYaml(info.frontmatter);
			if (!isRecord(parsed)) {
				throw new ProposalTransitionValidationError('Proposal frontmatter is invalid.');
			}
			const frontmatter = { ...parsed };
			const current = this.currentSnapshot(
				file,
				frontmatter,
				content.slice(info.contentStart)
			);
			committed = transitionProposal(
				current,
				request,
				this.environment(request, frontmatter)
			);
			if (committed.replayed) {
				return content;
			}
			if (
				request.expectedFileHash
				&& computePayloadHash(content) !== request.expectedFileHash
			) {
				throw new ProposalTransitionConflictError(
					'Proposal file changed before the transition.'
				);
			}
			applyFrontmatterMutation(frontmatter, committed.frontmatter);
			let synchronized = content;
			if (request.action.kind === 'draft') {
				try {
					synchronized = `${content.slice(0, info.contentStart)}${replaceProposalWriteback(
						content.slice(info.contentStart),
						committed.state.proposalId,
						committed.state.writebackContent
					)}`;
				} catch (error) {
					if (error instanceof ProposalWritebackFormatError) {
						throw new ProposalTransitionValidationError(error.message);
					}
					throw error;
				}
			}
			return replaceFrontmatter(synchronized, frontmatter);
		});
		if (!committed) {
			throw new ProposalTransitionConflictError('Proposal transition did not commit.');
		}
		return committed;
	}
}
