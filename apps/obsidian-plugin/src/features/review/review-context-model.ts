import {
	KNOWLEDGE_GLOBAL_MEMORY_DIR,
	KNOWLEDGE_PROJECTS_MEMORY_DIR,
	KNOWLEDGE_SOURCES_DIR,
	KNOWLEDGE_WIKI_DIR,
	normalizeKnowledgePath,
	startsWithPathPrefix,
} from '@tracekeeper/core';
import type { AgentTaskRecord } from '../activity/activity-model';
import {
	getReviewProposalValidity,
	type MemoryProposalRecord,
	type ReviewProposalValidity,
} from './review-view-model';
import {
	isReviewApprovalTargetPath,
	isReviewRemediationTargetPath,
	normalizeReviewTargetPath,
} from './review-target-policy';

export {
	isReviewApprovalTargetPath,
	isReviewRemediationTargetPath,
} from './review-target-policy';

export const REVIEW_TARGET_CANDIDATE_LIMIT = 8;
const REVIEW_CONTEXT_EXCERPT_LIMIT = 640;

export type ReviewTargetKind = 'project_memory' | 'global_memory' | 'wiki';
export type ReviewTargetCandidateReason =
	| 'current'
	| 'project_match'
	| 'scope_match'
	| 'related_match'
	| 'fallback';

export interface ReviewKnowledgeNote {
	path: string;
	title: string;
	excerpt: string;
	frontmatter: Record<string, unknown>;
}

export interface ReviewKnowledgeSnapshot {
	state: string;
	notes: ReviewKnowledgeNote[];
}

export interface ReviewTargetCandidate {
	path: string;
	title: string;
	kind: ReviewTargetKind;
	reason: ReviewTargetCandidateReason;
	excerpt: string;
}

export interface ReviewTargetContext {
	path: string;
	title: string;
	exists: boolean;
	allowed: boolean;
	excerpt: string;
}

export interface ReviewTaskContext {
	path: string;
	taskId: string;
	objective: string;
	status: string;
	summary: string;
}

export interface ReviewSourceContext {
	path: string;
	title: string;
	source: string;
	sourceKind: string;
	summary: string;
}

export interface ReviewPriorMemoryContext {
	path: string;
	memoryId: string;
	authority: string;
	confidence: string;
	effectiveState: string;
	observedAt: string;
	excerpt: string;
}

export interface ReviewProposalContext {
	proposalPath: string;
	indexState: string;
	validity: ReviewProposalValidity;
	target: ReviewTargetContext;
	targetCandidates: ReviewTargetCandidate[];
	task: ReviewTaskContext | null;
	sources: ReviewSourceContext[];
	priorMemory: ReviewPriorMemoryContext[];
	diffPreview: string;
}

interface BuildReviewProposalContextsInput {
	proposals: readonly MemoryProposalRecord[];
	knowledge: ReviewKnowledgeSnapshot;
	tasks: readonly AgentTaskRecord[];
	existingTargetPaths: ReadonlySet<string>;
}

const asString = (value: unknown): string => {
	if (typeof value === 'string') {
		return value.trim();
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value.map((item) => asString(item)).find(Boolean) || '';
	}
	return '';
};

const frontmatterString = (
	note: ReviewKnowledgeNote,
	keys: readonly string[]
): string => {
	for (const key of keys) {
		const value = asString(note.frontmatter[key]);
		if (value) {
			return value;
		}
	}
	return '';
};

const trimContext = (value: string, maxLength = REVIEW_CONTEXT_EXCERPT_LIMIT): string => {
	const trimmed = value.trim();
	if (trimmed.length <= maxLength) {
		return trimmed;
	}
	return `${trimmed.slice(0, maxLength - 1)}…`;
};

const targetKind = (path: string): ReviewTargetKind | null => {
	if (startsWithPathPrefix(path, KNOWLEDGE_PROJECTS_MEMORY_DIR)) {
		return 'project_memory';
	}
	if (startsWithPathPrefix(path, KNOWLEDGE_GLOBAL_MEMORY_DIR)) {
		return 'global_memory';
	}
	if (startsWithPathPrefix(path, KNOWLEDGE_WIKI_DIR)) {
		return 'wiki';
	}
	return null;
};

const normalizedTokens = (value: string): string[] =>
	value
		.toLowerCase()
		.split(/[^a-z0-9\u3400-\u9fff]+/u)
		.map((token) => token.trim())
		.filter((token) => token.length >= 2);

const noteSearchText = (note: ReviewKnowledgeNote): string =>
	[
		note.path,
		note.title,
		frontmatterString(note, [
			'project',
			'project_id',
			'projectId',
			'related_project',
			'relatedProject',
			'title',
			'type',
		]),
	].join(' ').toLowerCase();

const containsAnyToken = (value: string, tokens: readonly string[]): boolean =>
	tokens.some((token) => value.includes(token));

const containsAllTokens = (value: string, tokens: readonly string[]): boolean =>
	tokens.length > 0 && tokens.every((token) => value.includes(token));

const proposalPrefersWiki = (proposal: MemoryProposalRecord): boolean =>
	proposal.proposalKind.toLowerCase().includes('wiki')
	|| proposal.targetNote.toLowerCase().includes('/wiki/');

const proposalIsProjectScoped = (proposal: MemoryProposalRecord): boolean =>
	proposal.memoryScope.toLowerCase() === 'project'
	|| Boolean(proposal.relatedProject)
	|| proposal.proposalKind.toLowerCase().includes('project')
	|| startsWithPathPrefix(proposal.targetNote, KNOWLEDGE_PROJECTS_MEMORY_DIR);

const candidateScore = (
	proposal: MemoryProposalRecord,
	note: ReviewKnowledgeNote,
	kind: ReviewTargetKind
): { score: number; reason: ReviewTargetCandidateReason } => {
	const normalizedCurrent = normalizeReviewTargetPath(proposal.targetNote);
	const normalizedPath = normalizeReviewTargetPath(note.path);
	if (normalizedCurrent && normalizedCurrent === normalizedPath) {
		return { score: 1000, reason: 'current' };
	}

	const projectTokens = normalizedTokens(proposal.relatedProject);
	const relatedTokens = normalizedTokens([
		proposal.proposalKind,
		proposal.rationale,
		proposal.evidence.join(' '),
	].join(' '));
	const searchable = noteSearchText(note);
	const normalizedProject = proposal.relatedProject.trim().toLowerCase();
	const normalizedProjectSlug = normalizedProject
		.replace(/[^a-z0-9\u3400-\u9fff]+/gu, '-')
		.replace(/^-+|-+$/g, '');
	const exactProjectMatch = Boolean(
		normalizedProject
		&& (
			searchable.includes(normalizedProject)
			|| Boolean(normalizedProjectSlug && searchable.includes(normalizedProjectSlug))
		)
	);
	const projectMatch = exactProjectMatch || containsAllTokens(searchable, projectTokens);
	const relatedMatch = relatedTokens.length > 0 && containsAnyToken(searchable, relatedTokens);
	const projectScoped = proposalIsProjectScoped(proposal);
	const prefersWiki = proposalPrefersWiki(proposal);

	if (exactProjectMatch && kind === 'project_memory') {
		return { score: 900, reason: 'project_match' };
	}
	if (exactProjectMatch && kind === 'wiki') {
		return { score: 820, reason: 'project_match' };
	}
	if (projectMatch && kind === 'project_memory') {
		return { score: 800, reason: 'project_match' };
	}
	if (projectMatch && kind === 'wiki') {
		return { score: 720, reason: 'project_match' };
	}
	if (prefersWiki && kind === 'wiki') {
		return { score: 680, reason: 'scope_match' };
	}
	if (projectScoped && kind === 'project_memory') {
		return { score: 620, reason: 'scope_match' };
	}
	if (!projectScoped && kind === 'global_memory') {
		return { score: 620, reason: 'scope_match' };
	}
	if (relatedMatch) {
		return { score: 520, reason: 'related_match' };
	}
	if (kind === 'wiki') {
		return { score: 320, reason: 'fallback' };
	}
	if (kind === 'global_memory') {
		return { score: 280, reason: 'fallback' };
	}
	return { score: 240, reason: 'fallback' };
};

export const buildReviewTargetCandidates = (
	proposal: MemoryProposalRecord,
	notes: readonly ReviewKnowledgeNote[],
	limit = REVIEW_TARGET_CANDIDATE_LIMIT
): ReviewTargetCandidate[] => {
	const candidates = notes
		.map((note) => {
			if (frontmatterString(note, ['type']) === 'memory_record') {
				return null;
			}
			const normalizedPath = normalizeReviewTargetPath(note.path);
			const kind = targetKind(normalizedPath);
			if (!normalizedPath || !kind || !isReviewRemediationTargetPath(normalizedPath)) {
				return null;
			}
			const ranking = candidateScore(proposal, note, kind);
			return {
				path: normalizedPath,
				title: note.title || normalizedPath.split('/').pop()?.replace(/\.md$/i, '') || normalizedPath,
				kind,
				reason: ranking.reason,
				excerpt: trimContext(note.excerpt),
				score: ranking.score,
			};
		})
		.filter((candidate): candidate is ReviewTargetCandidate & { score: number } => Boolean(candidate))
		.sort((left, right) => {
			if (left.score !== right.score) {
				return right.score - left.score;
			}
			return left.path.localeCompare(right.path);
		});

	const seen = new Set<string>();
	const unique: ReviewTargetCandidate[] = [];
	for (const candidate of candidates) {
		if (seen.has(candidate.path)) {
			continue;
		}
		seen.add(candidate.path);
		const { score: _score, ...record } = candidate;
		unique.push(record);
		if (unique.length >= Math.max(1, limit)) {
			break;
		}
	}
	return unique;
};

const shouldCreateWikiNote = (proposal: MemoryProposalRecord): boolean =>
	proposal.writebackEffect === 'create_wiki_note'
	|| (
		proposal.writebackEffect === undefined
		&& startsWithPathPrefix(proposal.targetNote, KNOWLEDGE_WIKI_DIR)
	);

export const buildReviewDiffPreview = (
	proposal: MemoryProposalRecord,
	target: ReviewTargetContext
): string => {
	const current = target.exists
		? trimContext(target.excerpt || '(current note has no indexed excerpt)')
		: '(target is not resolved yet)';
	const marker = proposal.proposalId.replace(/[^A-Za-z0-9._-]/g, '-');
	const added = proposal.writebackContent
		? [
			`## Approved Writeback: ${proposal.proposalId}`,
			'',
			proposal.writebackContent,
			'',
			`^writeback-${marker}`,
		]
		: ['(writeback content is not provided yet)'];
	const isCreateProposal = shouldCreateWikiNote(proposal) && !target.exists;
	const isCreateConflict = proposal.writebackEffect === 'create_wiki_note' && target.exists;
	if (isCreateProposal) {
		const contentLines = proposal.writebackContent
			? [...proposal.writebackContent.split('\n'), '', `^writeback-${marker}`]
			: ['(writeback content is not provided yet)', '', `^writeback-${marker}`];
		return [
			'--- /dev/null',
			`+++ ${target.path || 'selected target'}`,
			...contentLines.flatMap((line) => [`+${line}`]),
		].join('\n');
	}
	if (isCreateConflict) {
		return [
			`[Blocked] target already exists for create_wiki_note`,
			`Target path: ${target.path || 'selected target'}`,
			'Expected to create a new Wiki note, but the target already exists.',
			'Approval will still be blocked unless the proposal target is changed.',
		].join('\n');
	}
	return [
		`--- ${target.path || 'unresolved target'} (current)`,
		`+++ ${target.path || 'selected target'} (after explicit apply)`,
		...current.split('\n').map((line) => ` ${line}`),
		...added.flatMap((line, index) => index === 0 ? [`+`, `+${line}`] : [`+${line}`]),
	].join('\n');
};

const sourcePathsForProposal = (proposal: MemoryProposalRecord): string[] => {
	const paths = [
		...proposal.relatedSources,
		...proposal.evidence.filter((value) =>
			startsWithPathPrefix(value, KNOWLEDGE_SOURCES_DIR)
		),
	];
	return [...new Set(paths.map((path) => normalizeKnowledgePath(path)).filter(Boolean))];
};

const taskContextForProposal = (
	proposal: MemoryProposalRecord,
	tasks: readonly AgentTaskRecord[]
): ReviewTaskContext | null => {
	const task = tasks.find((candidate) =>
		Boolean(proposal.taskId) && candidate.taskId === proposal.taskId
	) || tasks.find((candidate) =>
		candidate.proposals.some((path) => normalizeKnowledgePath(path) === normalizeKnowledgePath(proposal.path))
	);
	if (!task) {
		return null;
	}
	return {
		path: task.path,
		taskId: task.taskId,
		objective: task.objective,
		status: task.status,
		summary: trimContext(task.snippet),
	};
};

const sourceContextsForProposal = (
	proposal: MemoryProposalRecord,
	notesByPath: ReadonlyMap<string, ReviewKnowledgeNote>
): ReviewSourceContext[] =>
	sourcePathsForProposal(proposal)
		.map((path) => {
			const note = notesByPath.get(path);
			if (!note) {
				return {
					path,
					title: path.split('/').pop()?.replace(/\.md$/i, '') || path,
					source: '',
					sourceKind: '',
					summary: '',
				};
			}
			return {
				path,
				title: note.title || path.split('/').pop()?.replace(/\.md$/i, '') || path,
				source: frontmatterString(note, ['source', 'url']),
				sourceKind: frontmatterString(note, ['source_kind', 'sourceKind', 'type']),
				summary: trimContext(note.excerpt),
			};
		});

const priorMemoryForProposal = (
	proposal: MemoryProposalRecord,
	notes: readonly ReviewKnowledgeNote[]
): ReviewPriorMemoryContext[] => {
	if (!proposal.claimKey) {
		return [];
	}
	return notes
		.filter((note) => frontmatterString(note, ['type']) === 'memory_record')
		.filter((note) => frontmatterString(note, ['claim_key', 'claimKey']) === proposal.claimKey)
		.filter((note) => !proposal.projectId || frontmatterString(note, ['project_id', 'projectId']) === proposal.projectId)
		.map((note) => ({
			path: note.path,
			memoryId: frontmatterString(note, ['memory_id', 'memoryId']),
			authority: frontmatterString(note, ['authority']),
			confidence: frontmatterString(note, ['confidence_level', 'confidenceLevel']),
			effectiveState: frontmatterString(note, ['effective_state', 'effectiveState', 'declared_state', 'declaredState']),
			observedAt: frontmatterString(note, ['observed_at', 'observedAt']),
			excerpt: trimContext(note.excerpt),
		}))
		.sort((left, right) => left.path.localeCompare(right.path));
};

export const buildReviewProposalContexts = ({
	proposals,
	knowledge,
	tasks,
	existingTargetPaths,
}: BuildReviewProposalContextsInput): Record<string, ReviewProposalContext> => {
	const notesByPath = new Map(
		knowledge.notes.map((note) => [normalizeKnowledgePath(note.path), note])
	);
	const contexts: Record<string, ReviewProposalContext> = {};

	for (const proposal of proposals) {
		const targetPath = normalizeReviewTargetPath(proposal.targetNote);
		const targetNote = targetPath ? notesByPath.get(targetPath) : undefined;
		const targetExists = Boolean(targetPath && existingTargetPaths.has(targetPath));
		const target: ReviewTargetContext = {
			path: targetPath,
			title: targetNote?.title || targetPath.split('/').pop()?.replace(/\.md$/i, '') || '',
			exists: targetExists,
			allowed: targetPath ? isReviewApprovalTargetPath(targetPath) : false,
			excerpt: trimContext(targetNote?.excerpt || ''),
		};
		contexts[proposal.path] = {
			proposalPath: proposal.path,
			indexState: knowledge.state,
			validity: getReviewProposalValidity(proposal, { exists: targetExists }),
			target,
			targetCandidates: buildReviewTargetCandidates(proposal, knowledge.notes),
			task: taskContextForProposal(proposal, tasks),
			sources: sourceContextsForProposal(proposal, notesByPath),
			priorMemory: priorMemoryForProposal(proposal, knowledge.notes),
			diffPreview: buildReviewDiffPreview(proposal, target),
		};
	}

	return contexts;
};
