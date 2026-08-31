import {
	ARCHIVE_ROOT,
	KNOWLEDGE_PROJECTS_MEMORY_DIR,
	KNOWLEDGE_SOURCES_DIR,
	TRACEKEEPER_SESSIONS_DIR,
	TRACEKEEPER_TASKS_DIR,
	isKnowledgeSourcePath,
	isKnowledgeWikiPath,
	isSourcePartPath,
	isOrdinaryRecallPathEligible,
	recallNotes,
	sourceIndexPathForPart,
	type KnowledgeCatalogEntry,
	type KnowledgeReadView,
	type ScanResult,
	type ScannedNote,
} from '@tracekeeper/core';

const PROJECT_MEMORY_READ_DIRS = [KNOWLEDGE_PROJECTS_MEMORY_DIR, '05_projects', '04_projects'];
const MAX_PROJECT_SCOPE_CANDIDATES = 8;
const MAX_RECALL_EXCERPT_LENGTH = 480;
const MAX_RECALL_GRAPH_LINKS = 8;
const MAX_RECALL_CANDIDATES = 50;
export const MAX_READ_VIEW_LEXICAL_CANDIDATES = 256;
export const MAX_READ_VIEW_GRAPH_EXPANSIONS = 64;
export const MAX_READ_VIEW_RERANKED_ROWS = 32;
const PROJECT_MEMORY_RECALL_BOOST = 4;
const KNOWLEDGE_WIKI_RECALL_BOOST = 0.75;
const WORK_RECORD_RECALL_PENALTY = 5;
const PROJECT_MEMORY_RECALL_REASON = 'Project-memory location boost (+4)';
const KNOWLEDGE_WIKI_RECALL_REASON = 'Wiki location boost (+0.75)';

export type RecallApplicationScope = 'global' | 'project' | 'project_history' | 'task_history';
export type RecallContentOrigin = 'captured_source' | 'tracekeeper_generated' | 'vault_note';

export interface RecallProjectIdentityInput {
	project_hint?: unknown;
	project_id?: unknown;
	repo_path?: unknown;
	repo?: unknown;
	project_path?: unknown;
}

export interface RecallProjectIdentity {
	projectHint: string;
	projectId: string;
	repoPath: string;
	source:
		| 'explicit_project_id'
		| 'explicit_project_hint'
		| 'vault_match'
		| 'repo_leaf'
		| 'task_metadata'
		| 'unknown';
	confidence: 'exact' | 'derived' | 'uncertain';
	warnings: string[];
}

export interface RecallProjectIdentityResult {
	project_hint: string | null;
	project_id: string | null;
	repo_path: string | null;
	source: RecallProjectIdentity['source'];
	confidence: RecallProjectIdentity['confidence'];
	warnings: string[];
}

export interface RecallRelationEvidenceItem {
	path: string;
	declared_by: string;
	declared_via: Array<'frontmatter' | 'body_wikilink'>;
	verified_by: 'active_vault_snapshot';
}

export interface RecallRelationEvidence {
	related_wiki: RecallRelationEvidenceItem[];
	related_sources: RecallRelationEvidenceItem[];
}

export interface RecallApplicationRequest {
	scope: RecallApplicationScope;
	query: string;
	maxItems: number;
	vaultRoot: string;
	projectIdentityInput: RecallProjectIdentityInput;
	taskId?: string;
}

export interface RecallApplicationDependencies {
	loadScan(): ScanResult;
	nowMs(): number;
	resolveProjectIdentity(
		input: RecallProjectIdentityInput,
		notes: ScannedNote[]
	): RecallProjectIdentity;
	filterProjectNotes(
		notes: ScannedNote[],
		identity: RecallProjectIdentity
	): ScannedNote[];
	buildRelationEvidence(
		note: ScannedNote,
		allNotes: ScannedNote[]
	): RecallRelationEvidence;
	contentOrigin(relativePath: string, noteType?: string): RecallContentOrigin;
	onReadViewDiagnostics?(diagnostics: RecallReadViewDiagnostics): void;
}

export interface RecallReadViewDiagnostics {
	lexical_candidates: number;
	graph_expansions: number;
	reranked_rows: number;
}

export interface RecallEntry {
	path: string;
	title: string;
	type?: string;
	note_type: string | null;
	scope: RecallApplicationScope;
	score: number;
	raw_score: number;
	matched_tokens: string[];
	score_reason: string[];
	why_matched: string;
	excerpt: string;
	content_origin: RecallContentOrigin;
	instruction_trust: 'data_only';
	graph_links: string[];
	relation_evidence: RecallRelationEvidence;
	supporting_paths?: string[];
}

export interface ProjectHistoryEntry {
	path: string;
	title: string;
	type?: string;
	note_type: string | null;
	scope: 'project_history';
	modifiedAt: string;
	content_origin: RecallContentOrigin;
	instruction_trust: 'data_only';
	task_id: string;
	project_hint: string;
	why_matched: string;
	excerpt: string;
	graph_links: string[];
	relation_evidence: RecallRelationEvidence;
}

export interface RecallScanProvenance {
	index_state: string;
	snapshot_generation: number | null;
	snapshot_warning: string | null;
}

export interface GlobalRecallApplicationResult extends RecallScanProvenance {
	ok: true;
	read_only: true;
	scope_mode: 'global';
	query: string;
	vault_root: string;
	max_items: number;
	matched_count: number;
	matches: RecallEntry[];
}

export interface ProjectRecallApplicationResult extends RecallScanProvenance {
	ok: true;
	read_only: true;
	vault_root: string;
	query: string;
	uncertain: boolean;
	scope: RecallProjectIdentityResult;
	project_identity: RecallProjectIdentityResult;
	max_items: number;
	matched_count: number;
	candidates: string[];
	candidate_notes: ProjectCandidate[];
	scope_evidence: Array<Record<string, unknown>>;
	scope_mode: 'global' | 'project';
	entries: RecallEntry[];
}

export interface ProjectHistoryRecallApplicationResult extends RecallScanProvenance {
	ok: true;
	read_only: true;
	vault_root: string;
	query: string | null;
	uncertain: boolean;
	scope: RecallProjectIdentityResult;
	project_identity: RecallProjectIdentityResult;
	max_items: number;
	matched_count: number;
	total_matches: number;
	scope_mode: 'project_history';
	candidates: string[];
	candidate_notes: ProjectCandidate[];
	entries: ProjectHistoryEntry[];
}

export interface TaskHistoryEntry {
	path: string;
	task_path: string;
	session_path: string | null;
	title: string;
	note_type: string | null;
	scope: 'task_history';
	modifiedAt: string;
	task_id: string;
	status: string | null;
	objective: string;
	summary: string;
	project_hint: string | null;
	project_id: string | null;
	repo_path: string | null;
	why_matched: string;
	excerpt: string;
	content_origin: RecallContentOrigin;
	instruction_trust: 'data_only';
	graph_links: string[];
	relation_evidence: RecallRelationEvidence;
}

export interface TaskHistoryRecallApplicationResult extends RecallScanProvenance {
	ok: true;
	read_only: true;
	vault_root: string;
	query: string | null;
	task_id: string | null;
	max_items: number;
	matched_count: number;
	total_matches: number;
	scope_mode: 'task_history';
	entries: TaskHistoryEntry[];
}

export type RecallApplicationResult =
	| GlobalRecallApplicationResult
	| ProjectRecallApplicationResult
	| ProjectHistoryRecallApplicationResult
	| TaskHistoryRecallApplicationResult;

interface RankedRecallMatch {
	note: ScannedNote;
	score: number;
	raw_score: number;
	matchedTokens: string[];
	score_reason: string[];
}

interface ProjectCandidate {
	path: string;
	title: string;
	type: string | null;
}

function toText(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}
	if (typeof value === 'string') {
		return value.trim();
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value
			.map((entry) => toText(entry))
			.filter((entry) => entry.length > 0)
			.join('\n');
	}
	return '';
}

function readFrontmatterString(frontmatter: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const value = frontmatter[key];
		if (value === undefined) {
			continue;
		}
		const text = toText(value);
		if (text) {
			return text;
		}
	}
	return '';
}

function normalizeRepoPrefix(value: string): string {
	return value
		.replace(/^\/+/, '')
		.replace(/\/+$/, '')
		.replace(/\\/g, '/');
}

function valueContainsAnyToken(value: string, tokens: string[]): boolean {
	const normalized = value.toLowerCase();
	return tokens.some((token) => token.length > 0 && normalized.includes(token));
}

function projectTokens(value: string): string[] {
	const normalized = value.toLowerCase().trim();
	if (!normalized) {
		return [];
	}
	const variants = new Set<string>([
		normalized,
		normalized.replace(/\s+/g, '-'),
		normalized.replace(/\s+/g, '_'),
		normalized.replace(/[-_]+/g, ' '),
	]);
	return Array.from(variants).filter(Boolean);
}

function hasProjectScope(scope: RecallProjectIdentity): boolean {
	return Boolean(scope.projectHint || scope.projectId || scope.repoPath);
}

function projectIdentityResult(identity: RecallProjectIdentity): RecallProjectIdentityResult {
	return {
		project_hint: identity.projectHint || null,
		project_id: identity.projectId || null,
		repo_path: identity.repoPath || null,
		source: identity.source,
		confidence: identity.confidence,
		warnings: identity.warnings,
	};
}

function scanProvenance(scan: ScanResult): RecallScanProvenance {
	const indexState = scan.index?.index_state ?? 'filesystem_scan';
	return {
		index_state: indexState,
		snapshot_generation: scan.index?.generation ?? null,
		snapshot_warning: indexState === 'rebuilding'
			? 'Knowledge index is rebuilding; this result may come from the previous snapshot generation.'
			: indexState === 'initializing'
				? 'Knowledge index metadata is still initializing; this result may be incomplete.'
			: null,
	};
}

function projectMemoryCandidatePath(notePath: string): string {
	for (const dir of PROJECT_MEMORY_READ_DIRS) {
		const prefix = `${dir}/`;
		if (!notePath.startsWith(prefix)) {
			continue;
		}
		const [projectSegment] = notePath.slice(prefix.length).split('/').filter(Boolean);
		return projectSegment ? `${dir}/${projectSegment}` : dir;
	}
	return '';
}

function collectProjectCandidates(
	notes: ScannedNote[],
	scope: RecallProjectIdentity,
	maxItems: number
): ProjectCandidate[] {
	const candidates: ProjectCandidate[] = [];
	const seen = new Set<string>();
	for (const note of notes) {
		const candidate = projectMemoryCandidatePath(note.relativePath);
		if (candidate && !seen.has(note.relativePath)) {
			seen.add(note.relativePath);
			candidates.push({
				path: note.relativePath,
				title: note.title,
				type: note.type ?? null,
			});
		}
		const notePath = note.relativePath.toLowerCase();
		const hintTokens = projectTokens(scope.projectHint);
		if (
			scope.projectId &&
			(notePath.includes(scope.projectId.toLowerCase()) || valueContainsAnyToken(notePath, hintTokens)) &&
			!seen.has(note.relativePath)
		) {
			seen.add(note.relativePath);
			candidates.push({
				path: note.relativePath,
				title: note.title,
				type: note.type ?? null,
			});
		}
		if (candidates.length >= maxItems) {
			break;
		}
	}
	return candidates.slice(0, maxItems);
}

function buildProjectRecallRelationEvidence(
	scope: RecallProjectIdentity
): Array<Record<string, unknown>> {
	const evidence: Array<Record<string, unknown>> = [];
	if (scope.projectHint) {
		evidence.push({
			type: 'project_hint',
			value: scope.projectHint,
			confidence: scope.confidence,
		});
	}
	if (scope.projectId) {
		evidence.push({
			type: 'project_id',
			value: scope.projectId,
			confidence: scope.confidence,
		});
	}
	if (scope.repoPath) {
		evidence.push({
			type: 'repo_path',
			value: scope.repoPath,
			confidence: scope.confidence,
		});
	}
	if (scope.confidence === 'uncertain') {
		evidence.push({
			type: 'scope_status',
			value: 'project_scope_uncertain',
			target_scope: 'project',
		});
	}
	if (evidence.length === 0) {
		evidence.push({
			type: 'scope_status',
			value: 'project_scope_unresolved',
			target_scope: 'project',
		});
	}
	return evidence;
}

function matchesProjectQuery(note: ScannedNote, query: string): boolean {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return true;
	}
	const haystack = [
		note.relativePath,
		note.title,
		note.type,
		note.tokens,
		JSON.stringify(note.frontmatter),
	].join(' ').toLowerCase();
	if (haystack.includes(normalizedQuery)) {
		return true;
	}
	const queryTokens = Array.from(new Set(normalizedQuery.split(/[^a-z0-9\u4e00-\u9fff]+/u).filter((token) => token.length > 1)));
	if (queryTokens.length === 0) {
		return false;
	}
	const matchedCount = queryTokens.filter((token) => haystack.includes(token)).length;
	const requiredMatches = queryTokens.length <= 2
		? queryTokens.length
		: Math.max(2, Math.ceil(queryTokens.length * 0.6));
	return matchedCount >= requiredMatches;
}

function collectRecallScopeTokens(scope: RecallProjectIdentity): string[] {
	const tokens = new Set<string>();
	if (scope.projectHint) {
		for (const token of projectTokens(scope.projectHint)) {
			tokens.add(token);
		}
	}
	if (scope.projectId) {
		tokens.add(scope.projectId.toLowerCase());
	}
	if (scope.repoPath) {
		const normalized = normalizeRepoPrefix(scope.repoPath).toLowerCase();
		if (normalized) {
			tokens.add(normalized);
			tokens.add(normalized.split('/').filter(Boolean).pop() || normalized);
		}
	}
	return Array.from(tokens).filter(Boolean);
}

function recallRecencyBoost(modifiedAt: string, nowMs: number): number {
	const modified = Date.parse(modifiedAt);
	if (!Number.isFinite(modified)) {
		return 0;
	}
	const ageHours = (nowMs - modified) / (60 * 60 * 1000);
	if (ageHours < 24) {
		return 1;
	}
	if (ageHours < 72) {
		return 0.6;
	}
	if (ageHours < 168) {
		return 0.25;
	}
	return 0;
}

function recallCandidateLimit(maxItems: number): number {
	return Math.min(Math.max(maxItems * 4, 24), MAX_RECALL_CANDIDATES);
}

function isGeneratedWorkRecord(note: ScannedNote): boolean {
	const notePath = note.relativePath.replace(/\\/g, '/');
	return notePath.startsWith(`${TRACEKEEPER_TASKS_DIR}/`) ||
		notePath.startsWith(`${TRACEKEEPER_SESSIONS_DIR}/`) ||
		notePath.startsWith('02_timeline/agent_tasks/') ||
		notePath.startsWith('02_timeline/sessions/');
}

function buildProjectMemoryAnchors(
	notes: ScannedNote[],
	existingPaths: Set<string>,
	maxItems = 2
): Array<{ note: ScannedNote; score: number; matchedTokens: string[] }> {
	return notes
		.filter((note) =>
			note.relativePath.startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`) &&
			!existingPaths.has(note.relativePath)
		)
		.sort((a, b) => {
			const aCanonical = a.relativePath.toLowerCase().endsWith('/memory.md') ? 1 : 0;
			const bCanonical = b.relativePath.toLowerCase().endsWith('/memory.md') ? 1 : 0;
			return bCanonical - aCanonical ||
				Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt) ||
				a.relativePath.localeCompare(b.relativePath);
		})
		.slice(0, maxItems)
		.map((note) => ({ note, score: 0, matchedTokens: [] }));
}

function selectRecallMatches(matches: RankedRecallMatch[], maxItems: number): RankedRecallMatch[] {
	const hasDurableKnowledge = matches.some((match) =>
		!isGeneratedWorkRecord(match.note) && match.raw_score > 0
	);
	if (!hasDurableKnowledge) {
		return matches.slice(0, maxItems);
	}
	const selected: RankedRecallMatch[] = [];
	let workRecordCount = 0;
	for (const match of matches) {
		if (isGeneratedWorkRecord(match.note)) {
			if (workRecordCount >= 1) {
				continue;
			}
			workRecordCount += 1;
		}
		selected.push(match);
		if (selected.length >= maxItems) {
			break;
		}
	}
	if (
		maxItems > 1 &&
		workRecordCount === 0 &&
		selected.length === maxItems
	) {
		const bestWorkRecord = matches.find((match) =>
			isGeneratedWorkRecord(match.note) && match.raw_score > 0
		);
		if (bestWorkRecord) {
			selected[selected.length - 1] = bestWorkRecord;
		}
	}
	return selected;
}

function rankRecallMatches(
	matches: Array<{ note: ScannedNote; score: number; matchedTokens: string[] }>,
	query: string,
	scope: RecallProjectIdentity,
	nowMs: number
): RankedRecallMatch[] {
	const fullQuery = query.trim().toLowerCase();
	const scopeTokens = collectRecallScopeTokens(scope);

	const ranked = matches.map((match) => {
		let score = match.score;
		const reasons: string[] = [];
		const noteTitle = match.note.title.toLowerCase();
		const notePath = match.note.relativePath.toLowerCase();
		const noteFrontmatter = [
			readFrontmatterString(match.note.frontmatter, ['project', 'project_hint', 'related_project']),
			readFrontmatterString(match.note.frontmatter, ['project_id', 'projectId', 'pid']),
			readFrontmatterString(match.note.frontmatter, ['repo_path', 'repoPath', 'project_path']),
			readFrontmatterString(match.note.frontmatter, ['related_project', 'relatedProject', 'workspace']),
		].join(' ').toLowerCase();

		if (notePath.startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
			score += PROJECT_MEMORY_RECALL_BOOST;
			reasons.push(PROJECT_MEMORY_RECALL_REASON);
		} else if (isKnowledgeWikiPath(notePath)) {
			score += KNOWLEDGE_WIKI_RECALL_BOOST;
			reasons.push(KNOWLEDGE_WIKI_RECALL_REASON);
		} else if (
			notePath.startsWith(`${TRACEKEEPER_TASKS_DIR}/`) ||
			notePath.startsWith(`${TRACEKEEPER_SESSIONS_DIR}/`)
		) {
			const echoPenalty = Math.max(
				WORK_RECORD_RECALL_PENALTY + Math.max(0, match.matchedTokens.length - 1),
				Math.max(0, match.score - 2)
			);
			score = Math.max(0.01, score - echoPenalty);
			reasons.push(`Work-record query-echo penalty (-${echoPenalty})`);
		}
		if (match.matchedTokens.length >= 2) {
			score += 0.4;
			reasons.push('Multiple query token matches (+0.4)');
		}
		const recency = recallRecencyBoost(match.note.modifiedAt, nowMs);
		if (recency > 0) {
			score += recency;
			reasons.push(`Recent edit (+${recency})`);
		}
		if (fullQuery && (noteTitle.includes(fullQuery) || notePath.includes(fullQuery))) {
			score += 1;
			reasons.push('Exact query phrase match in title/path (+1)');
		}
		if (scopeTokens.some((token) =>
			valueContainsAnyToken(noteTitle, [token]) ||
			valueContainsAnyToken(notePath, [token]) ||
			valueContainsAnyToken(noteFrontmatter, [token])
		)) {
			score += 0.4;
			reasons.push('Project scope match (+0.4)');
		}
		return {
			note: match.note,
			raw_score: match.score,
			score: Number(score.toFixed(2)),
			matchedTokens: match.matchedTokens,
			score_reason: reasons.length ? reasons : ['Core recall score'],
		};
	});

	return ranked.sort((a, b) => b.score - a.score || a.note.relativePath.localeCompare(b.note.relativePath));
}

function compactNoteText(text: string, maxLength = MAX_RECALL_EXCERPT_LENGTH): string {
	const compact = text
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (compact.length <= maxLength) {
		return compact;
	}
	return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildRecallGraphLinks(note: ScannedNote, relationEvidence: RecallRelationEvidence): string[] {
	if (isKnowledgeSourcePath(note.relativePath) || (note.type ?? '').toLocaleLowerCase('en-US').includes('source')) {
		return [...new Set([
			...relationEvidence.related_wiki.map((relation) => relation.path),
			...relationEvidence.related_sources.map((relation) => relation.path),
		])].sort((left, right) => left.localeCompare(right)).slice(0, MAX_RECALL_GRAPH_LINKS);
	}
	const links = new Set<string>();
	for (const link of note.edges) {
		if (link.resolution.status !== 'resolved') {
			continue;
		}
		const target = link.subpath
			? `${link.resolution.path}#${link.subpath}`
			: link.resolution.path;
		if (target.trim()) {
			links.add(target.trim());
		}
		if (links.size >= MAX_RECALL_GRAPH_LINKS) {
			break;
		}
	}
	return Array.from(links);
}

function buildRecallWhyMatched(
	match: RankedRecallMatch,
	scope: RecallApplicationScope
): string {
	const scopeLabel = scope === 'project_history'
		? 'Project-history recall'
		: scope === 'project'
			? 'Project recall'
			: 'Global recall';
	const tokenText = match.matchedTokens.slice(0, 6).join(', ');
	const reasonText = match.score_reason.slice(0, 2).join('; ');
	return [scopeLabel, tokenText ? `matched tokens: ${tokenText}` : '', reasonText].filter(Boolean).join(' - ');
}

function buildRecallEntry(
	match: RankedRecallMatch,
	scope: RecallApplicationScope,
	allNotes: ScannedNote[],
	dependencies: RecallApplicationDependencies
): RecallEntry {
	const relationEvidence = dependencies.buildRelationEvidence(match.note, allNotes);
	return {
		path: match.note.relativePath,
		title: match.note.title,
		type: match.note.type,
		note_type: match.note.type ?? null,
		scope,
		score: match.score,
		raw_score: match.raw_score,
		matched_tokens: match.matchedTokens,
		score_reason: match.score_reason,
		why_matched: buildRecallWhyMatched(match, scope),
		excerpt: compactNoteText(match.note.content),
		content_origin: dependencies.contentOrigin(match.note.relativePath, match.note.type),
		instruction_trust: 'data_only',
		graph_links: buildRecallGraphLinks(match.note, relationEvidence),
		relation_evidence: relationEvidence,
	};
}

function buildProjectHistoryWhy(note: ScannedNote, query: string): string {
	const parts = ['Project-history recall'];
	const taskId = readFrontmatterString(note.frontmatter, ['task_id', 'taskId']);
	if (taskId) {
		parts.push(`linked task: ${taskId}`);
	}
	if (query) {
		parts.push(`matched query: ${query}`);
	}
	return parts.join(' - ');
}

function buildProjectHistoryEntries(
	matches: ScannedNote[],
	query: string,
	allNotes: ScannedNote[],
	dependencies: RecallApplicationDependencies
): ProjectHistoryEntry[] {
	return matches.map((note) => {
		const relationEvidence = dependencies.buildRelationEvidence(note, allNotes);
		return {
			path: note.relativePath,
			title: note.title,
			type: note.type,
			note_type: note.type ?? null,
			scope: 'project_history',
			modifiedAt: note.modifiedAt,
			content_origin: dependencies.contentOrigin(note.relativePath, note.type),
			instruction_trust: 'data_only',
			task_id: readFrontmatterString(note.frontmatter, ['task_id', 'taskId']),
			project_hint: readFrontmatterString(note.frontmatter, ['project_hint', 'related_project', 'project']),
			why_matched: buildProjectHistoryWhy(note, query),
			excerpt: compactNoteText(note.content),
			graph_links: buildRecallGraphLinks(note, relationEvidence),
			relation_evidence: relationEvidence,
		};
	});
}

interface TaskHistoryGroup {
	task: ScannedNote;
	session: ScannedNote | null;
}

function taskProjectMatches(note: ScannedNote, identity: RecallProjectIdentity): boolean {
	const haystack = [
		readFrontmatterString(note.frontmatter, ['project_hint', 'related_project', 'project']),
		readFrontmatterString(note.frontmatter, ['project_id']),
		readFrontmatterString(note.frontmatter, ['repo_path', 'repo', 'project_path']),
		note.relativePath,
	].join(' ').toLowerCase();
	const tokens = collectRecallScopeTokens(identity);
	return tokens.length > 0 && tokens.some((token) => haystack.includes(token));
}

function collectTaskHistoryGroups(
	notes: ScannedNote[],
	request: RecallApplicationRequest,
	dependencies: RecallApplicationDependencies
): TaskHistoryGroup[] {
	const taskNotes = notes.filter((note) => note.relativePath.startsWith(`${TRACEKEEPER_TASKS_DIR}/`));
	const sessionNotes = notes.filter((note) => note.relativePath.startsWith(`${TRACEKEEPER_SESSIONS_DIR}/`));
	const identityInput = request.projectIdentityInput;
	const hasProjectFilter = [
		identityInput.project_hint,
		identityInput.project_id,
		identityInput.repo_path,
		identityInput.repo,
		identityInput.project_path,
	].some((value) => typeof value === 'string' && value.trim());
	const identity = hasProjectFilter
		? dependencies.resolveProjectIdentity(identityInput, notes)
		: null;
	const filteredTasks = taskNotes.filter((note) => {
		const taskId = readFrontmatterString(note.frontmatter, ['task_id', 'taskId']);
		if (request.taskId && taskId !== request.taskId) return false;
		if (identity && !taskProjectMatches(note, identity)) return false;
		if (request.query && !matchesProjectQuery(note, request.query)) return false;
		return Boolean(taskId);
	});
	const groups: TaskHistoryGroup[] = [];
	for (const task of filteredTasks) {
		const taskId = readFrontmatterString(task.frontmatter, ['task_id', 'taskId']);
		const sessions = sessionNotes
			.filter((note) => readFrontmatterString(note.frontmatter, ['task_id', 'taskId']) === taskId)
			.filter((note) => !request.query || matchesProjectQuery(note, request.query))
			.sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt));
		groups.push({ task, session: sessions[0] ?? null });
	}
	return groups.sort((left, right) => {
		const leftTime = Date.parse(left.session?.modifiedAt || left.task.modifiedAt);
		const rightTime = Date.parse(right.session?.modifiedAt || right.task.modifiedAt);
		return rightTime - leftTime || left.task.relativePath.localeCompare(right.task.relativePath);
	});
}

function buildTaskHistoryEntries(
	groups: TaskHistoryGroup[],
	query: string,
	allNotes: ScannedNote[],
	dependencies: RecallApplicationDependencies
): TaskHistoryEntry[] {
	return groups.map(({ task, session }) => {
		const taskId = readFrontmatterString(task.frontmatter, ['task_id', 'taskId']);
		const source = session ?? task;
		const summary = readFrontmatterString(session?.frontmatter ?? task.frontmatter, ['summary']);
		const objective = readFrontmatterString(task.frontmatter, ['goal', 'objective', 'title']) || task.title;
		const status = readFrontmatterString(task.frontmatter, ['status']) || null;
		const relationEvidence = dependencies.buildRelationEvidence(source, allNotes);
		return {
			path: task.relativePath,
			task_path: task.relativePath,
			session_path: session?.relativePath ?? null,
			title: task.title,
			note_type: task.type ?? null,
			scope: 'task_history',
			modifiedAt: source.modifiedAt,
			task_id: taskId,
			status,
			objective,
			summary,
			project_hint: readFrontmatterString(task.frontmatter, ['project_hint', 'related_project', 'project']) || null,
			project_id: readFrontmatterString(task.frontmatter, ['project_id']) || null,
			repo_path: readFrontmatterString(task.frontmatter, ['repo_path', 'repo', 'project_path']) || null,
			why_matched: ['Task-history recall', taskId, query ? `matched query: ${query}` : 'recent task'].filter(Boolean).join(' - '),
			excerpt: compactNoteText([task.content, session?.content, summary].filter(Boolean).join(' ')),
			content_origin: dependencies.contentOrigin(source.relativePath, source.type),
			instruction_trust: 'data_only',
			graph_links: buildRecallGraphLinks(source, relationEvidence),
			relation_evidence: relationEvidence,
		};
	});
}

interface RankedCatalogMatch {
	entry: KnowledgeCatalogEntry;
	score: number;
	raw_score: number;
	matchedTokens: string[];
	score_reason: string[];
}

function readViewProvenance(view: KnowledgeReadView): RecallScanProvenance {
	return {
		index_state: view.source === 'filesystem_scan' ? 'filesystem_scan' : view.index_state,
		snapshot_generation: view.source === 'filesystem_scan' ? null : view.generation,
		snapshot_warning: view.index_state === 'rebuilding'
			? 'Knowledge index is rebuilding; this result may come from the previous snapshot generation.'
			: view.index_state === 'initializing'
				? 'Knowledge index metadata is still initializing; this result may be incomplete.'
				: null,
	};
}

function tokenizeReadViewQuery(input: string): string[] {
	const terms = new Set<string>();
	const add = (value: string): void => {
		const normalized = value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
		if (normalized.length >= 2 && terms.size < 64) terms.add(normalized);
	};
	for (const segment of input.normalize('NFKC').toLocaleLowerCase('en-US').match(/[a-z0-9_-]+|\p{Script=Han}+/gu) ?? []) {
		add(segment);
		if (!/\p{Script=Han}/u.test(segment)) continue;
		const characters = [...segment];
		for (const width of [2, 3]) {
			for (let offset = 0; offset + width <= characters.length; offset += 1) {
				add(characters.slice(offset, offset + width).join(''));
				if (terms.size >= 64) return [...terms];
			}
		}
	}
	return [...terms];
}

function catalogMetadataProjection(entry: KnowledgeCatalogEntry): ScannedNote {
	return {
		schemaVersion: '1.0',
		path: entry.path,
		exists: true,
		contentHash: entry.contentHash,
		title: entry.title,
		aliases: entry.aliases,
		type: entry.type ?? undefined,
		frontmatter: entry.frontmatter,
		semanticErrors: [],
		tags: entry.tags,
		headings: [],
		blockIds: [],
		sections: [],
		callouts: [],
		edges: [],
		text: entry.excerpt,
		content: '',
		modifiedAt: entry.modifiedAt,
		size: entry.size,
		absolutePath: '',
		relativePath: entry.path,
		tokens: entry.searchTokens.join(' '),
		wikilinks: [],
		claimBlocks: [],
		evidenceBlocks: [],
	};
}

function isCurrentReadViewEntry(entry: KnowledgeCatalogEntry, view: KnowledgeReadView): boolean {
	const normalizedPath = entry.path.replace(/\\/g, '/');
	if (!isOrdinaryRecallPathEligible(normalizedPath)) return false;
	if (normalizedPath === ARCHIVE_ROOT || normalizedPath.startsWith(`${ARCHIVE_ROOT}/`)) return false;
	if (entry.type !== 'memory_record') return true;
	return view.memory.lifecycle.current.some((row) => row.record.path === entry.path);
}

function normalizeCatalogRelationReference(value: string): string {
	return value.trim()
		.replace(/^\[\[/, '')
		.replace(/\]\]$/, '')
		.split('|', 1)[0]
		.replace(/#.*$/, '')
		.replace(/^\.\//, '')
		.replace(/\\/g, '/')
		.toLocaleLowerCase('en-US');
}

function resolveCatalogRelationReference(value: string, view: KnowledgeReadView): string | null {
	const normalized = normalizeCatalogRelationReference(value);
	if (!normalized) return null;
	for (const candidate of view.catalog.values()) {
		const candidatePath = candidate.path.toLocaleLowerCase('en-US');
		if (candidatePath === normalized || candidatePath.replace(/\.md$/i, '') === normalized.replace(/\.md$/i, '')) {
			return candidate.path;
		}
		if (candidate.title.toLocaleLowerCase('en-US') === normalized) return candidate.path;
		if (candidate.aliases.some((alias) => alias.toLocaleLowerCase('en-US') === normalized)) return candidate.path;
	}
	return null;
}

function explicitRelationReferences(entry: KnowledgeCatalogEntry): string[] {
	const references: string[] = [];
	for (const key of [
		'related_wiki', 'relatedWiki', 'wiki',
		'related_sources', 'relatedSources', 'sources',
	]) {
		const value = entry.frontmatter[key];
		const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
		references.push(...values
			.filter((item): item is string => typeof item === 'string')
			.flatMap((item) => item.split(/[\n,]/g))
			.map((item) => item.trim())
			.filter(Boolean));
	}
	return references;
}

function explicitSourceRelationTargets(entry: KnowledgeCatalogEntry, view: KnowledgeReadView): Set<string> {
	if (!isKnowledgeSourcePath(entry.path) && !(entry.type ?? '').toLocaleLowerCase('en-US').includes('source')) {
		return new Set();
	}
	return new Set(explicitRelationReferences(entry)
		.map((reference) => resolveCatalogRelationReference(reference, view))
		.filter((path): path is string => Boolean(path)));
}

export function buildKnowledgeRelationEvidenceFromReadView(
	entry: KnowledgeCatalogEntry,
	view: KnowledgeReadView
): RecallRelationEvidence {
	const rows = new Map<string, RecallRelationEvidenceItem>();
	const addRelation = (
		targetPath: string,
		declaredVia: 'frontmatter' | 'body_wikilink'
	): void => {
		if (!view.catalog.has(targetPath)) return;
		const relationKind = isKnowledgeWikiPath(targetPath)
			? 'related_wiki'
			: isKnowledgeSourcePath(targetPath)
				? 'related_sources'
				: null;
		if (!relationKind) return;
		const key = `${relationKind}:${targetPath.toLocaleLowerCase('en-US')}`;
		const existing = rows.get(key);
		if (existing) {
			if (!existing.declared_via.includes(declaredVia)) existing.declared_via.push(declaredVia);
			return;
		}
		rows.set(key, {
			path: targetPath,
			declared_by: entry.path,
			declared_via: [declaredVia],
			verified_by: 'active_vault_snapshot',
		});
	};
	for (const reference of explicitRelationReferences(entry)) {
		const normalizedReference = normalizeCatalogRelationReference(reference);
		const declaredEdge = [...view.graph.edges, ...view.graph.unresolvedEdges].find((edge) =>
			edge.source === 'frontmatter'
			&& (!edge.sourcePath || edge.sourcePath === entry.path)
			&& normalizeCatalogRelationReference(edge.linkPath || edge.target || edge.raw) === normalizedReference
		);
		if (declaredEdge) {
			if (declaredEdge.resolution.status === 'resolved') {
				addRelation(declaredEdge.resolution.path, 'frontmatter');
			}
			continue;
		}
		const targetPath = resolveCatalogRelationReference(reference, view);
		if (targetPath) addRelation(targetPath, 'frontmatter');
	}
	const sourceRelationTargets = explicitSourceRelationTargets(entry, view);
	for (const edge of view.graph.edges) {
		if (edge.resolution.status !== 'resolved') continue;
		if (edge.sourcePath !== entry.path || edge.source !== 'body') continue;
		const targetPath = edge.resolution.path;
		if (isKnowledgeSourcePath(entry.path) || (entry.type ?? '').toLocaleLowerCase('en-US').includes('source')) {
			if (!sourceRelationTargets.has(targetPath)) continue;
		}
		addRelation(targetPath, 'body_wikilink');
	}
	const ordered = [...rows.entries()].sort(([left], [right]) => left.localeCompare(right));
	return {
		related_wiki: ordered.filter(([key]) => key.startsWith('related_wiki:')).slice(0, MAX_RECALL_GRAPH_LINKS).map(([, row]) => row),
		related_sources: ordered.filter(([key]) => key.startsWith('related_sources:')).slice(0, MAX_RECALL_GRAPH_LINKS).map(([, row]) => row),
	};
}

export function buildKnowledgeGraphLinksFromReadView(entry: KnowledgeCatalogEntry, view: KnowledgeReadView): string[] {
	if (isKnowledgeSourcePath(entry.path) || (entry.type ?? '').toLocaleLowerCase('en-US').includes('source')) {
		const evidence = buildKnowledgeRelationEvidenceFromReadView(entry, view);
		return [...new Set([
			...evidence.related_wiki.map((relation) => relation.path),
			...evidence.related_sources.map((relation) => relation.path),
		])].sort((left, right) => left.localeCompare(right)).slice(0, MAX_RECALL_GRAPH_LINKS);
	}
	const outgoing = new Set(view.graph.outgoing.get(entry.path) ?? []);
	const links = new Set<string>();
	const edgeTargets = new Set<string>();
	for (const edge of view.graph.edges) {
		if (edge.resolution.status !== 'resolved') continue;
		if (edge.sourcePath !== entry.path && (edge.sourcePath || !outgoing.has(edge.resolution.path))) continue;
		edgeTargets.add(edge.resolution.path);
		links.add(edge.subpath ? `${edge.resolution.path}#${edge.subpath}` : edge.resolution.path);
	}
	for (const targetPath of outgoing) {
		if (!edgeTargets.has(targetPath)) links.add(targetPath);
	}
	return [...links].sort((left, right) => left.localeCompare(right)).slice(0, MAX_RECALL_GRAPH_LINKS);
}

function knowledgeGraphNeighbors(entryPath: string, view: KnowledgeReadView): Set<string> {
	const entry = view.catalog.get(entryPath);
	const outgoing = new Set(view.graph.outgoing.get(entryPath) ?? []);
	if (entry && (isKnowledgeSourcePath(entry.path) || (entry.type ?? '').toLocaleLowerCase('en-US').includes('source'))) {
		const allowed = explicitSourceRelationTargets(entry, view);
		for (const target of outgoing) {
			if (!allowed.has(target)) outgoing.delete(target);
		}
	}
	const incoming = new Set(view.graph.incoming.get(entryPath) ?? []);
	for (const sourcePath of incoming) {
		const source = view.catalog.get(sourcePath);
		if (!source || (!isKnowledgeSourcePath(source.path) && !(source.type ?? '').toLocaleLowerCase('en-US').includes('source'))) {
			continue;
		}
		if (!explicitSourceRelationTargets(source, view).has(entryPath)) incoming.delete(sourcePath);
	}
	return new Set([...outgoing, ...incoming]);
}

function rankCatalogMatches(
	rows: Array<{ entry: KnowledgeCatalogEntry; rawScore: number; matchedTokens: string[] }>,
	query: string,
	scope: RecallProjectIdentity,
	nowMs: number
): RankedCatalogMatch[] {
	const fullQuery = query.trim().toLocaleLowerCase('en-US');
	const scopeTokens = collectRecallScopeTokens(scope);
	return rows.map((row) => {
		let score = row.rawScore;
		const reasons: string[] = [];
		const notePath = row.entry.path.toLocaleLowerCase('en-US');
		const noteTitle = row.entry.title.toLocaleLowerCase('en-US');
		const frontmatter = JSON.stringify(row.entry.frontmatter).toLocaleLowerCase('en-US');
		if (notePath.startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
			score += PROJECT_MEMORY_RECALL_BOOST;
			reasons.push(PROJECT_MEMORY_RECALL_REASON);
		} else if (isKnowledgeWikiPath(notePath)) {
			score += KNOWLEDGE_WIKI_RECALL_BOOST;
			reasons.push(KNOWLEDGE_WIKI_RECALL_REASON);
		} else if (isGeneratedWorkRecord(catalogMetadataProjection(row.entry))) {
			const penalty = Math.max(
				WORK_RECORD_RECALL_PENALTY + Math.max(0, row.matchedTokens.length - 1),
				Math.max(0, row.rawScore - 2)
			);
			score = Math.max(0.01, score - penalty);
			reasons.push(`Work-record query-echo penalty (-${Number(penalty.toFixed(2))})`);
		}
		if (row.matchedTokens.length >= 2) {
			score += 0.4;
			reasons.push('Multiple query token matches (+0.4)');
		}
		const recency = recallRecencyBoost(row.entry.modifiedAt, nowMs);
		if (recency > 0) {
			score += recency;
			reasons.push(`Recent edit (+${recency})`);
		}
		if (fullQuery && (notePath.includes(fullQuery) || noteTitle.includes(fullQuery))) {
			score += 1;
			reasons.push('Exact query phrase match in title/path (+1)');
		}
		if (scopeTokens.some((token) => notePath.includes(token) || noteTitle.includes(token) || frontmatter.includes(token))) {
			score += 0.4;
			reasons.push('Project scope match (+0.4)');
		}
		return {
			entry: row.entry,
			raw_score: Number(row.rawScore.toFixed(2)),
			score: Number(Math.max(0.01, score).toFixed(2)),
			matchedTokens: row.matchedTokens,
			score_reason: reasons.length > 0 ? reasons : ['Catalog lexical match'],
		};
	}).sort((left, right) => right.score - left.score || left.entry.path.localeCompare(right.entry.path));
}

function buildReadViewEntry(
	match: RankedCatalogMatch,
	scope: RecallApplicationScope,
	view: KnowledgeReadView,
	dependencies: RecallApplicationDependencies
): RecallEntry {
	const whyMatch: RankedRecallMatch = {
		note: catalogMetadataProjection(match.entry),
		score: match.score,
		raw_score: match.raw_score,
		matchedTokens: match.matchedTokens,
		score_reason: match.score_reason,
	};
	return {
		path: match.entry.path,
		title: match.entry.title,
		type: match.entry.type ?? undefined,
		note_type: match.entry.type,
		scope,
		score: match.score,
		raw_score: match.raw_score,
		matched_tokens: match.matchedTokens,
		score_reason: match.score_reason,
		why_matched: buildRecallWhyMatched(whyMatch, scope),
		excerpt: compactNoteText(match.entry.excerpt),
		content_origin: dependencies.contentOrigin(match.entry.path, match.entry.type ?? undefined),
		instruction_trust: 'data_only',
		graph_links: buildKnowledgeGraphLinksFromReadView(match.entry, view),
		relation_evidence: buildKnowledgeRelationEvidenceFromReadView(match.entry, view),
	};
}

function mergeFoldedSourceEntries(entries: RecallEntry[]): RecallEntry[] {
	const merged = new Map<string, RecallEntry>();
	for (const entry of entries) {
		const existing = merged.get(entry.path);
		if (!existing) {
			merged.set(entry.path, entry);
			continue;
		}
		const supportingPaths = [...new Set([
			...(existing.supporting_paths ?? []),
			...(entry.supporting_paths ?? []),
		])].sort((left, right) => left.localeCompare(right));
		if (entry.score > existing.score) {
			merged.set(entry.path, { ...entry, supporting_paths: supportingPaths });
		} else {
			merged.set(entry.path, { ...existing, supporting_paths: supportingPaths });
		}
	}
	return [...merged.values()].sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
}

function foldScanSourcePartEntries(
	entries: RecallEntry[],
	allNotes: ScannedNote[],
	dependencies: RecallApplicationDependencies
): RecallEntry[] {
	const notes = new Map(allNotes.map((note) => [note.relativePath, note]));
	return mergeFoldedSourceEntries(entries.flatMap((entry) => {
		if (!isSourcePartPath(entry.path)) return [entry];
		const indexPath = sourceIndexPathForPart(entry.path);
		const parent = indexPath ? notes.get(indexPath) : undefined;
		if (!indexPath || !parent) return [];
		const relationEvidence = dependencies.buildRelationEvidence(parent, allNotes);
		return [{
			...entry,
			path: indexPath,
			title: parent.title,
			type: parent.type,
			note_type: parent.type ?? null,
			why_matched: `${entry.why_matched} - supporting source part: ${entry.path}`,
			content_origin: dependencies.contentOrigin(indexPath, parent.type),
			graph_links: buildRecallGraphLinks(parent, relationEvidence),
			relation_evidence: relationEvidence,
			supporting_paths: [entry.path],
		}];
	}));
}

function foldReadViewSourcePartEntries(
	entries: RecallEntry[],
	view: KnowledgeReadView,
	dependencies: RecallApplicationDependencies
): RecallEntry[] {
	return mergeFoldedSourceEntries(entries.flatMap((entry) => {
		if (!isSourcePartPath(entry.path)) return [entry];
		const indexPath = sourceIndexPathForPart(entry.path);
		const parent = indexPath ? view.catalog.get(indexPath) : undefined;
		if (!indexPath || !parent) return [];
		return [{
			...entry,
			path: indexPath,
			title: parent.title,
			type: parent.type ?? undefined,
			note_type: parent.type,
			why_matched: `${entry.why_matched} - supporting source part: ${entry.path}`,
			content_origin: dependencies.contentOrigin(indexPath, parent.type ?? undefined),
			graph_links: buildKnowledgeGraphLinksFromReadView(parent, view),
			relation_evidence: buildKnowledgeRelationEvidenceFromReadView(parent, view),
			supporting_paths: [entry.path],
		}];
	}));
}

function selectCatalogRecallMatches(matches: RankedCatalogMatch[], maxItems: number): RankedCatalogMatch[] {
	const hasDurableKnowledge = matches.some((match) =>
		!isGeneratedWorkRecord(catalogMetadataProjection(match.entry)) && match.raw_score > 0
	);
	if (!hasDurableKnowledge) return matches.slice(0, maxItems);
	const selected: RankedCatalogMatch[] = [];
	let workRecordCount = 0;
	for (const match of matches) {
		if (isGeneratedWorkRecord(catalogMetadataProjection(match.entry))) {
			if (workRecordCount >= 1) continue;
			workRecordCount += 1;
		}
		selected.push(match);
		if (selected.length >= maxItems) break;
	}
	if (maxItems > 1 && workRecordCount === 0 && selected.length === maxItems) {
		const bestWorkRecord = matches.find((match) =>
			isGeneratedWorkRecord(catalogMetadataProjection(match.entry)) && match.raw_score > 0
		);
		if (bestWorkRecord) selected[selected.length - 1] = bestWorkRecord;
	}
	return selected;
}

function boundedReadViewMatches(
	view: KnowledgeReadView,
	entries: readonly KnowledgeCatalogEntry[],
	query: string,
	scope: RecallProjectIdentity,
	nowMs: number
): { matches: RankedCatalogMatch[]; diagnostics: RecallReadViewDiagnostics } {
	const allowed = new Map(entries.map((entry) => [entry.path, entry]));
	const matchedByPath = new Map<string, Set<string>>();
	const queryTerms = tokenizeReadViewQuery(query);
	for (const term of queryTerms) {
		for (const notePath of view.lexical.postings.get(term) ?? []) {
			if (!allowed.has(notePath)) continue;
			const matched = matchedByPath.get(notePath) ?? new Set<string>();
			matched.add(term);
			matchedByPath.set(notePath, matched);
		}
	}
	const lexical = [...matchedByPath.entries()]
		.sort(([leftPath, left], [rightPath, right]) => right.size - left.size || leftPath.localeCompare(rightPath))
		.slice(0, MAX_READ_VIEW_LEXICAL_CANDIDATES);
	const candidateScores = new Map<string, { rawScore: number; tokens: Set<string> }>();
	for (const [notePath, matched] of lexical) {
		candidateScores.set(notePath, { rawScore: matched.size, tokens: new Set(matched) });
	}

	let graphExpansions = 0;
	for (const [seedPath] of lexical) {
		const neighbors = knowledgeGraphNeighbors(seedPath, view);
		for (const neighbor of [...neighbors].sort((left, right) => left.localeCompare(right))) {
			if (graphExpansions >= MAX_READ_VIEW_GRAPH_EXPANSIONS) break;
			if (!allowed.has(neighbor) || candidateScores.has(neighbor)) continue;
			candidateScores.set(neighbor, { rawScore: 0.25, tokens: new Set() });
			graphExpansions += 1;
		}
		if (graphExpansions >= MAX_READ_VIEW_GRAPH_EXPANSIONS) break;
	}

	if (scope.projectHint || scope.projectId || scope.repoPath) {
		for (const entry of entries
			.filter((candidate) => candidate.path.startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`))
			.sort((left, right) => left.path.localeCompare(right.path))
			.slice(0, 2)) {
			if (!candidateScores.has(entry.path)) candidateScores.set(entry.path, { rawScore: 0, tokens: new Set() });
		}
	}

	const rows = [...candidateScores.entries()]
		.map(([notePath, candidate]) => ({
			entry: allowed.get(notePath)!,
			rawScore: candidate.rawScore,
			matchedTokens: [...candidate.tokens].sort(),
		}))
		.sort((left, right) => right.rawScore - left.rawScore || left.entry.path.localeCompare(right.entry.path))
		.slice(0, MAX_READ_VIEW_RERANKED_ROWS);
	return {
		matches: rankCatalogMatches(rows, query, scope, nowMs),
		diagnostics: {
			lexical_candidates: lexical.length,
			graph_expansions: graphExpansions,
			reranked_rows: rows.length,
		},
	};
}

export class RecallApplicationService {
	private readonly dependencies: RecallApplicationDependencies;

	constructor(dependencies: RecallApplicationDependencies) {
		this.dependencies = dependencies;
	}

	execute(request: RecallApplicationRequest): RecallApplicationResult {
		const scan = this.dependencies.loadScan();
		if (request.scope === 'global') {
			return this.executeGlobal(request, scan);
		}
		if (request.scope === 'project') {
			return this.executeProject(request, scan);
		}
		if (request.scope === 'task_history') {
			return this.executeTaskHistory(request, scan);
		}
		return this.executeProjectHistory(request, scan);
	}

	executeReadView(
		request: RecallApplicationRequest & { scope: 'global' },
		view: KnowledgeReadView
	): GlobalRecallApplicationResult;
	executeReadView(
		request: RecallApplicationRequest & { scope: 'project' },
		view: KnowledgeReadView
	): ProjectRecallApplicationResult;
	executeReadView(
		request: RecallApplicationRequest & { scope: 'project_history' },
		view: KnowledgeReadView
	): ProjectHistoryRecallApplicationResult;
	executeReadView(
		request: RecallApplicationRequest & { scope: 'task_history' },
		view: KnowledgeReadView
	): TaskHistoryRecallApplicationResult;
	executeReadView(
		request: RecallApplicationRequest,
		view: KnowledgeReadView
	): RecallApplicationResult;
	executeReadView(
		request: RecallApplicationRequest,
		view: KnowledgeReadView
	): RecallApplicationResult {
		const allEntries = [...view.catalog.values()];
		const metadataNotes = allEntries.map(catalogMetadataProjection);
		if (request.scope === 'task_history') {
			const groups = collectTaskHistoryGroups(metadataNotes, request, this.dependencies);
			const entries = buildTaskHistoryEntries(groups.slice(0, request.maxItems), request.query, metadataNotes, this.dependencies);
			return {
				ok: true,
				read_only: true,
				vault_root: request.vaultRoot,
				query: request.query || null,
				task_id: request.taskId || null,
				max_items: request.maxItems,
				matched_count: entries.length,
				total_matches: groups.length,
				scope_mode: 'task_history',
				...readViewProvenance(view),
				entries,
			};
		}
		if (request.scope === 'global') {
			const entries = allEntries.filter((entry) => isCurrentReadViewEntry(entry, view));
			const ranked = boundedReadViewMatches(view, entries, request.query, {
				projectHint: '', projectId: '', repoPath: '', source: 'unknown', confidence: 'uncertain', warnings: [],
			}, this.dependencies.nowMs());
			this.dependencies.onReadViewDiagnostics?.(ranked.diagnostics);
			const matches = selectCatalogRecallMatches(ranked.matches, request.maxItems);
			const foldedMatches = foldReadViewSourcePartEntries(
				matches.map((match) => buildReadViewEntry(match, 'global', view, this.dependencies)),
				view,
				this.dependencies
			);
			return {
				ok: true,
				read_only: true,
				scope_mode: 'global',
				query: request.query,
				vault_root: request.vaultRoot,
				max_items: request.maxItems,
				matched_count: foldedMatches.length,
				...readViewProvenance(view),
				matches: foldedMatches,
			};
		}

		const identity = this.dependencies.resolveProjectIdentity(
			request.projectIdentityInput,
			metadataNotes
		);
		const unresolved = identity.confidence === 'uncertain';
		const scopedMetadata = unresolved
			? []
			: this.dependencies.filterProjectNotes(metadataNotes, identity);
		const scopedPaths = new Set(scopedMetadata.map((note) => note.relativePath));
		const scopedEntries = allEntries.filter((entry) => scopedPaths.has(entry.path));
		const candidateEntries = unresolved ? allEntries : scopedEntries;
		const candidateNotes = collectProjectCandidates(
			candidateEntries.map(catalogMetadataProjection),
			identity,
			MAX_PROJECT_SCOPE_CANDIDATES
		);
		const uncertain = !hasProjectScope(identity) || identity.confidence === 'uncertain';

		if (request.scope === 'project') {
			const currentEntries = scopedEntries.filter((entry) => isCurrentReadViewEntry(entry, view));
			const ranked = boundedReadViewMatches(view, currentEntries, request.query, identity, this.dependencies.nowMs());
			this.dependencies.onReadViewDiagnostics?.(ranked.diagnostics);
			const matches = selectCatalogRecallMatches(ranked.matches, request.maxItems);
			const foldedEntries = foldReadViewSourcePartEntries(
				matches.map((match) => buildReadViewEntry(match, 'project', view, this.dependencies)),
				view,
				this.dependencies
			);
			return {
				ok: true,
				read_only: true,
				vault_root: request.vaultRoot,
				query: request.query,
				uncertain,
				scope: projectIdentityResult(identity),
				project_identity: projectIdentityResult(identity),
				max_items: request.maxItems,
				matched_count: foldedEntries.length,
				...readViewProvenance(view),
				candidates: candidateNotes.map((candidate) => candidate.path),
				candidate_notes: candidateNotes,
				scope_evidence: buildProjectRecallRelationEvidence(identity),
				scope_mode: 'project',
				entries: foldedEntries,
			};
		}

		const queryTerms = tokenizeReadViewQuery(request.query);
		const historyEntries = scopedEntries
			.filter((entry) => entry.path !== '')
			.filter((entry) => queryTerms.length === 0 || queryTerms.every((term) => entry.searchTokens.includes(term)))
			.sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt) || left.path.localeCompare(right.path));
		const matches = historyEntries.slice(0, request.maxItems);
		this.dependencies.onReadViewDiagnostics?.({ lexical_candidates: 0, graph_expansions: 0, reranked_rows: 0 });
		return {
			ok: true,
			read_only: true,
			vault_root: request.vaultRoot,
			query: request.query || null,
			uncertain,
			scope: projectIdentityResult(identity),
			project_identity: projectIdentityResult(identity),
			max_items: request.maxItems,
			matched_count: matches.length,
			total_matches: historyEntries.length,
			scope_mode: 'project_history',
			...readViewProvenance(view),
			candidates: candidateNotes.map((candidate) => candidate.path),
			candidate_notes: candidateNotes,
			entries: matches.map((entry) => ({
				path: entry.path,
				title: entry.title,
				type: entry.type ?? undefined,
				note_type: entry.type,
				scope: 'project_history',
				modifiedAt: entry.modifiedAt,
				content_origin: this.dependencies.contentOrigin(entry.path, entry.type ?? undefined),
				instruction_trust: 'data_only',
				task_id: readFrontmatterString(entry.frontmatter as Record<string, unknown>, ['task_id', 'taskId']),
				project_hint: readFrontmatterString(entry.frontmatter as Record<string, unknown>, ['project_hint', 'related_project', 'project']),
				why_matched: buildProjectHistoryWhy(catalogMetadataProjection(entry), request.query),
				excerpt: compactNoteText(entry.excerpt),
				graph_links: buildKnowledgeGraphLinksFromReadView(entry, view),
				relation_evidence: buildKnowledgeRelationEvidenceFromReadView(entry, view),
			})),
		};
	}

	private executeGlobal(
		request: RecallApplicationRequest,
		scan: ScanResult
	): GlobalRecallApplicationResult {
		const rawMatches = recallNotes(scan.notes, request.query, {
			limit: recallCandidateLimit(request.maxItems),
		});
		const matches = selectRecallMatches(
			rankRecallMatches(rawMatches, request.query, {
				projectHint: '',
				projectId: '',
				repoPath: '',
				source: 'unknown',
				confidence: 'uncertain',
				warnings: [],
			}, this.dependencies.nowMs()),
			request.maxItems
		);
		const foldedMatches = foldScanSourcePartEntries(
			matches.map((match) => buildRecallEntry(match, 'global', scan.notes, this.dependencies)),
			scan.notes,
			this.dependencies
		);
		return {
			ok: true,
			read_only: true,
			scope_mode: 'global',
			query: request.query,
			vault_root: request.vaultRoot,
			max_items: request.maxItems,
			matched_count: foldedMatches.length,
			...scanProvenance(scan),
			matches: foldedMatches,
		};
	}

	private executeProject(
		request: RecallApplicationRequest,
		scan: ScanResult
	): ProjectRecallApplicationResult {
		const scope = this.dependencies.resolveProjectIdentity(
			request.projectIdentityInput,
			scan.notes
		);
		const unresolved = scope.confidence === 'uncertain';
		const scopedNotes = unresolved
			? []
			: this.dependencies.filterProjectNotes(scan.notes, scope);
		const candidateLimit = recallCandidateLimit(request.maxItems);
		const initialMatches = recallNotes(scopedNotes, request.query, { limit: candidateLimit });
		const anchoredMatches = [
				...initialMatches,
				...buildProjectMemoryAnchors(
					scopedNotes,
					new Set(initialMatches.map((match) => match.note.relativePath))
				),
			];
		const matches = selectRecallMatches(
			rankRecallMatches(
				anchoredMatches,
				request.query,
				scope,
				this.dependencies.nowMs()
			),
			request.maxItems
		);
		const foldedEntries = foldScanSourcePartEntries(
			matches.map((match) => buildRecallEntry(match, 'project', scan.notes, this.dependencies)),
			scan.notes,
			this.dependencies
		);
		const uncertain = !hasProjectScope(scope) ||
			scope.confidence === 'uncertain';
		const candidateNotes = collectProjectCandidates(
			unresolved ? scan.notes : scopedNotes,
			scope,
			MAX_PROJECT_SCOPE_CANDIDATES
		);

		return {
			ok: true,
			read_only: true,
			vault_root: request.vaultRoot,
			query: request.query,
			uncertain,
			scope: projectIdentityResult(scope),
			project_identity: projectIdentityResult(scope),
			max_items: request.maxItems,
			matched_count: foldedEntries.length,
			...scanProvenance(scan),
			candidates: candidateNotes.map((candidate) => candidate.path),
			candidate_notes: candidateNotes,
			scope_evidence: buildProjectRecallRelationEvidence(scope),
			scope_mode: 'project',
			entries: foldedEntries,
		};
	}

	private executeProjectHistory(
		request: RecallApplicationRequest,
		scan: ScanResult
	): ProjectHistoryRecallApplicationResult {
		const scope = this.dependencies.resolveProjectIdentity(
			request.projectIdentityInput,
			scan.notes
		);
		const unresolved = scope.confidence === 'uncertain';
		const scopedNotes = unresolved
			? []
			: this.dependencies.filterProjectNotes(scan.notes, scope);
		const uncertain = !hasProjectScope(scope) || scope.confidence === 'uncertain';
		const filteredByQuery = request.query
			? scopedNotes.filter((note) => matchesProjectQuery(note, request.query))
			: scopedNotes;
		const sortedMatches = filteredByQuery
			.filter((note) => note.relativePath !== '')
			.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
		const candidateNotes = collectProjectCandidates(
			unresolved ? scan.notes : scopedNotes,
			scope,
			MAX_PROJECT_SCOPE_CANDIDATES
		);
		const matches = sortedMatches.slice(0, request.maxItems);

		return {
			ok: true,
			read_only: true,
			vault_root: request.vaultRoot,
			query: request.query || null,
			uncertain,
			scope: projectIdentityResult(scope),
			project_identity: projectIdentityResult(scope),
			max_items: request.maxItems,
			matched_count: matches.length,
			total_matches: sortedMatches.length,
			scope_mode: 'project_history',
			...scanProvenance(scan),
			candidates: candidateNotes.map((candidate) => candidate.path),
			candidate_notes: candidateNotes,
			entries: buildProjectHistoryEntries(
				matches,
				request.query,
				scan.notes,
				this.dependencies
			),
		};
	}

	private executeTaskHistory(
		request: RecallApplicationRequest,
		scan: ScanResult
	): TaskHistoryRecallApplicationResult {
		const groups = collectTaskHistoryGroups(scan.notes, request, this.dependencies);
		const entries = buildTaskHistoryEntries(
			groups.slice(0, request.maxItems),
			request.query,
			scan.notes,
			this.dependencies
		);
		return {
			ok: true,
			read_only: true,
			vault_root: request.vaultRoot,
			query: request.query || null,
			task_id: request.taskId || null,
			max_items: request.maxItems,
			matched_count: entries.length,
			total_matches: groups.length,
			scope_mode: 'task_history',
			...scanProvenance(scan),
			entries,
		};
	}
}
