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
	computeProposalRevision,
	computePayloadHash,
	hashVaultContent,
	isAllowedProposalTargetPath,
	proposalTransitionReceiptFromFrontmatter,
	transitionProposal,
	type ProposalFrontmatterMutationValue,
	type ProposalTransitionCommand,
	type ProposalTransitionDecision,
	type ProposalTransitionEnvironment,
	type ProposalTransitionSnapshot,
	type ProposalTransitionStatus,
} from '@tracekeeper/core';
import type { ArchiveProposalInspection } from './review-queue-controller';
import { withObsidianVaultPathLock } from '../../adapters/obsidian-vault-path-lock';

export interface ObsidianProposalTransitionRequest extends ProposalTransitionCommand {
	proposalPath: string;
	expectedFileHash?: string;
	now?: string;
	actor?: string;
}

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

const extractWritebackSection = (body: string): string => {
	const lines = body.replace(/\r\n/g, '\n').split('\n');
	const supported = new Set([
		'writeback',
		'approved writeback',
		'writeback content',
		'写回',
		'已批准写回',
		'写回内容',
	]);
	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index].match(/^\s*#{2,}\s*(.+?)\s*$/);
		if (!match || !supported.has(match[1].trim().replace(/\s+/g, ' ').toLowerCase())) {
			continue;
		}
		const content: string[] = [];
		for (let next = index + 1; next < lines.length; next += 1) {
			if (/^\s*#{2,}\s*(.+?)\s*$/.test(lines[next])) {
				break;
			}
			content.push(lines[next]);
		}
		return content.join('\n').trim();
	}
	return '';
};

const replaceWritebackSection = (body: string, writebackContent: string): string => {
	const normalizedBody = body.replace(/\r\n/g, '\n');
	const hadTrailingNewline = normalizedBody.endsWith('\n');
	const lines = normalizedBody.split('\n');
	const supported = new Set([
		'writeback',
		'approved writeback',
		'writeback content',
		'写回',
		'已批准写回',
		'写回内容',
	]);
	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index].match(/^\s*#{2,}\s*(.+?)\s*$/);
		if (!match || !supported.has(match[1].trim().replace(/\s+/g, ' ').toLowerCase())) {
			continue;
		}
		let end = index + 1;
		while (end < lines.length && !/^\s*#{2,}\s*(.+?)\s*$/.test(lines[end])) {
			end += 1;
		}
		const replacement = [
			lines[index],
			'',
			...(writebackContent ? writebackContent.split('\n') : []),
		];
		if (end < lines.length) {
			replacement.push('');
		}
		const replaced = [
			...lines.slice(0, index),
			...replacement,
			...lines.slice(end),
		].join('\n');
		return hadTrailingNewline && !replaced.endsWith('\n')
			? `${replaced}\n`
			: replaced;
	}
	return body;
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
	const frontmatterWriteback = multilineField(
		frontmatter,
		['writeback_content', 'writebackContent'],
		'Proposal writeback content'
	);
	const bodyWriteback = extractWritebackSection(body);
	if (
		frontmatterWriteback
		&& bodyWriteback
		&& frontmatterWriteback.replace(/\r\n/g, '\n').trim()
			!== bodyWriteback.replace(/\r\n/g, '\n').trim()
	) {
		throw new ProposalTransitionConflictError('Proposal writeback sources conflict.');
	}
	const lastTransition = proposalTransitionReceiptFromFrontmatter(frontmatter);
	const pathLeaf = file.path.split('/').pop() || '';
	const proposalId = scalarField(
		frontmatter,
		['proposal_id', 'proposalId'],
		'Proposal id'
	) || pathLeaf.replace(/\.md$/i, '');
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
		writebackContent: frontmatterWriteback || bodyWriteback,
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
		const parsed = parseYaml(info.frontmatter);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new ProposalTransitionValidationError('Proposal frontmatter is invalid.');
		}
		const snapshot = this.currentSnapshot(
			file,
			parsed as Record<string, unknown>,
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
		return withObsidianVaultPathLock(
			this.app.vault,
			request.proposalPath,
			async () => {
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
		return {
			now: request.now || new Date().toISOString(),
			actor: request.actor || 'user',
			targetAllowed: isAllowedProposalTargetPath,
			targetExists: (relativePath) =>
				this.app.vault.getAbstractFileByPath(relativePath) instanceof TFile,
			targetCreationAllowed: () => Boolean(claimKey),
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
			const current = this.currentSnapshot(file, frontmatter, '');
			committed = transitionProposal(
				current,
				request,
				this.environment(request, frontmatter)
			);
			applyFrontmatterMutation(frontmatter, committed.frontmatter);
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
			const parsed = parseYaml(info.frontmatter);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new ProposalTransitionValidationError('Proposal frontmatter is invalid.');
			}
			const frontmatter = { ...(parsed as Record<string, unknown>) };
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
			const synchronized = request.action.kind === 'draft'
				? `${content.slice(0, info.contentStart)}${replaceWritebackSection(
					content.slice(info.contentStart),
					committed.state.writebackContent
				)}`
				: content;
			return replaceFrontmatter(synchronized, frontmatter);
		});
		if (!committed) {
			throw new ProposalTransitionConflictError('Proposal transition did not commit.');
		}
		return committed;
	}
}
