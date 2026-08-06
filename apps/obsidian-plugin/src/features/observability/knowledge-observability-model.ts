import {
	KNOWLEDGE_GLOBAL_MEMORY_DIR,
	KNOWLEDGE_PROJECTS_MEMORY_DIR,
	KNOWLEDGE_SOURCES_DIR,
	parseMemoryRecord,
	resolveMemoryLifecycle,
	normalizeKnowledgePath,
	startsWithPathPrefix,
	type IndexedKnowledgeNote,
	type KnowledgeIndexState,
	type MemoryEffectiveState,
	type MemoryRecord,
	type ScanError,
} from '@tracekeeper/core';
import type {
	AgentTaskRecord,
	SourceRequestRecord,
} from '../activity/activity-model';
import type { MemoryProposalRecord } from '../review/review-view-model';

export const KNOWLEDGE_OBSERVABILITY_PAGE_SIZE = 20;
export const KNOWLEDGE_RELATIONSHIP_READ_LIMIT = 200;

export type MemoryRecordScope = 'global' | 'project';
export type MemoryPersistenceState = 'persisted' | 'queued' | 'missing';
export type MemoryLifecycleDisplayState =
	| 'current'
	| 'history'
	| 'conflict'
	| 'review'
	| 'legacy_unkeyed';
export type MemoryScopeFilter = 'all' | MemoryRecordScope;
export type MemoryStateFilter = 'all' | MemoryPersistenceState;

export interface KnowledgeIndexEvidence {
	state: KnowledgeIndexState;
	generation: number;
	lastRebuild: string;
	notes: readonly IndexedKnowledgeNote[];
	errors: readonly ScanError[];
}

export interface MemoryInspectorQuery {
	page?: number;
	pageSize?: number;
	scope?: MemoryScopeFilter;
	state?: MemoryStateFilter;
	focusPaths?: readonly string[];
	taskId?: string;
}

export interface MemoryInspectorRecord {
	id: string;
	path: string;
	evidencePath: string;
	title: string;
	scope: MemoryRecordScope;
	project: string;
	state: MemoryPersistenceState;
	provenance: string;
	taskId: string;
	status: string;
	summary: string;
	lifecycleState: MemoryLifecycleDisplayState;
	effectiveState: MemoryEffectiveState | 'queued' | 'missing';
	lifecycleReasons: string[];
	claimKey: string;
	authority: string;
	confidenceLevel: string;
	declaredState: string;
	observedAt: string;
	validFrom: string;
	validTo: string;
	lastVerifiedAt: string;
	evidence: string[];
	supersedes: string[];
	contradicts: string[];
	sortTimestamp: number;
}

export interface MemoryInspectorSnapshot {
	records: MemoryInspectorRecord[];
	page: number;
	pageSize: number;
	totalItems: number;
	totalPages: number;
	scope: MemoryScopeFilter;
	state: MemoryStateFilter;
	focused: boolean;
	missingMemoryFolder: boolean;
	indexState: KnowledgeIndexState;
	indexGeneration: number;
	lastRebuild: string;
	readFailures: ScanError[];
	staleRecordCount: number;
	projectMemoryCounts: {
		immutableEntries: number;
		legacyNotes: number;
	};
	lifecycleCounts: Record<MemoryLifecycleDisplayState, number>;
	updatedAt: string;
}

export interface SourceStatusQuery {
	page?: number;
	pageSize?: number;
	focusPaths?: readonly string[];
	taskId?: string;
}

export type SourceEvidenceState = 'captured' | 'missing';

export interface SourceStatusRecord {
	id: string;
	path: string;
	evidencePath: string;
	indexPath: string;
	title: string;
	source: string;
	sourceKind: string;
	sourceId: string;
	contentHash: string;
	route: string;
	partCount: number;
	partManifest: string[];
	mode: string;
	state: SourceEvidenceState;
	taskIds: string[];
	taskPaths: string[];
	proposalPaths: string[];
	finalNotePaths: string[];
	summary: string;
	sortTimestamp: number;
}

export interface SourceStatusSnapshot {
	records: SourceStatusRecord[];
	requests: SourceRequestRecord[];
	page: number;
	pageSize: number;
	totalItems: number;
	totalPages: number;
	focused: boolean;
	missingSourceFolder: boolean;
	missingRequestFolder: boolean;
	indexState: KnowledgeIndexState;
	indexGeneration: number;
	lastRebuild: string;
	readFailures: ScanError[];
	staleRecordCount: number;
	updatedAt: string;
}

export interface BuildMemoryInspectorInput {
	index: KnowledgeIndexEvidence;
	proposals: readonly MemoryProposalRecord[];
	tasks: readonly AgentTaskRecord[];
	missingMemoryFolder: boolean;
	query?: MemoryInspectorQuery;
	now?: string;
}

export interface BuildSourceStatusInput {
	index: KnowledgeIndexEvidence;
	proposals: readonly MemoryProposalRecord[];
	tasks: readonly AgentTaskRecord[];
	requests: readonly SourceRequestRecord[];
	missingSourceFolder: boolean;
	missingRequestFolder: boolean;
	query?: SourceStatusQuery;
	now?: string;
}

const asString = (value: unknown): string => {
	if (typeof value === 'string') {
		return value.trim();
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value.map((entry) => asString(entry)).find(Boolean) || '';
	}
	return '';
};

const frontmatterString = (
	note: IndexedKnowledgeNote,
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

const frontmatterStringList = (
	note: IndexedKnowledgeNote,
	keys: readonly string[]
): string[] => {
	for (const key of keys) {
		const value = note.frontmatter[key];
		if (Array.isArray(value)) {
			return value.map((entry) => asString(entry)).filter(Boolean);
		}
		const scalar = asString(value);
		if (scalar) {
			return [scalar];
		}
	}
	return [];
};

const normalizeRecordPath = (value: string): string =>
	normalizeKnowledgePath(value.replace(/^["']|["']$/g, ''));

const isIndexNote = (path: string): boolean =>
	normalizeRecordPath(path).toLowerCase().endsWith('/index.md');

const isMemoryPath = (path: string): boolean =>
	startsWithPathPrefix(normalizeRecordPath(path), KNOWLEDGE_GLOBAL_MEMORY_DIR)
	|| startsWithPathPrefix(normalizeRecordPath(path), KNOWLEDGE_PROJECTS_MEMORY_DIR);

const isSourcePath = (path: string): boolean =>
	startsWithPathPrefix(normalizeRecordPath(path), KNOWLEDGE_SOURCES_DIR)
	&& !isIndexNote(path);

const parseTime = (value: string): number => {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : 0;
};

const safePage = (value: number | undefined): number =>
	Math.max(1, Math.floor(value || 1));

const safePageSize = (value: number | undefined): number =>
	Math.max(1, Math.min(100, Math.floor(value || KNOWLEDGE_OBSERVABILITY_PAGE_SIZE)));

const paginate = <T>(
	items: readonly T[],
	pageInput: number | undefined,
	pageSizeInput: number | undefined
): { items: T[]; page: number; pageSize: number; totalItems: number; totalPages: number } => {
	const pageSize = safePageSize(pageSizeInput);
	const totalItems = items.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
	const page = Math.min(safePage(pageInput), totalPages);
	const offset = (page - 1) * pageSize;
	return {
		items: items.slice(offset, offset + pageSize),
		page,
		pageSize,
		totalItems,
		totalPages,
	};
};

const projectFromMemoryPath = (path: string): string => {
	const normalized = normalizeRecordPath(path);
	if (!startsWithPathPrefix(normalized, KNOWLEDGE_PROJECTS_MEMORY_DIR)) {
		return '';
	}
	const relative = normalized.slice(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`.length);
	return relative.split('/')[0] || '';
};

const memoryScopeForPath = (
	path: string,
	projectFallback = ''
): MemoryRecordScope =>
	startsWithPathPrefix(normalizeRecordPath(path), KNOWLEDGE_PROJECTS_MEMORY_DIR)
		|| Boolean(projectFallback)
		? 'project'
		: 'global';

const memoryTitle = (note: IndexedKnowledgeNote): string =>
	note.title || note.path.split('/').pop()?.replace(/\.md$/i, '') || note.path;

const memoryProvenance = (note: IndexedKnowledgeNote): string =>
	frontmatterString(note, ['source', 'tool', 'proposed_by', 'proposedBy'])
	|| (frontmatterString(note, ['task_id', 'taskId']) ? 'task' : 'vault');

interface IndexedMemoryLifecycle {
	record: MemoryRecord | null;
	displayState: MemoryLifecycleDisplayState;
	effectiveState: MemoryEffectiveState;
	reasons: string[];
}

const lifecycleDisplayState = (
	state: MemoryEffectiveState
): MemoryLifecycleDisplayState => {
	switch (state) {
		case 'current':
			return 'current';
		case 'superseded':
		case 'retracted':
			return 'history';
		case 'disputed':
			return 'conflict';
		case 'review':
			return 'review';
		case 'legacy_unkeyed':
			return 'legacy_unkeyed';
	}
};

const buildIndexedMemoryLifecycle = (
	notes: readonly IndexedKnowledgeNote[],
	generation: number,
	now?: string
): Map<string, IndexedMemoryLifecycle> => {
	const parsed: MemoryRecord[] = [];
	const invalidV2Paths = new Set<string>();
	for (const note of notes) {
		const path = normalizeRecordPath(note.path);
		if (!isMemoryPath(path) || isIndexNote(path)) {
			continue;
		}
		const type = (frontmatterString(note, ['type']) || asString(note.type)).toLowerCase();
		const schemaVersion = Number(note.frontmatter.schema_version);
		if (type !== 'memory_record' && schemaVersion !== 2) {
			continue;
		}
		try {
			parsed.push(parseMemoryRecord({ path, frontmatter: note.frontmatter }));
		} catch {
			invalidV2Paths.add(path);
		}
	}
	const lifecycle = resolveMemoryLifecycle({ generation, records: parsed, now });
	const byPath = new Map<string, IndexedMemoryLifecycle>();
	for (const row of lifecycle.records) {
		byPath.set(row.record.path, {
			record: row.record,
			displayState: lifecycleDisplayState(row.effective_state),
			effectiveState: row.effective_state,
			reasons: [...row.reasons],
		});
	}
	for (const path of invalidV2Paths) {
		byPath.set(path, {
			record: null,
			displayState: 'review',
			effectiveState: 'review',
			reasons: ['invalid_v2_schema'],
		});
	}
	return byPath;
};

const lifecycleFields = (
	note: IndexedKnowledgeNote,
	lifecycle: IndexedMemoryLifecycle | undefined
): Pick<MemoryInspectorRecord,
	'lifecycleState' | 'effectiveState' | 'lifecycleReasons' | 'claimKey'
	| 'authority' | 'confidenceLevel' | 'declaredState' | 'observedAt'
	| 'validFrom' | 'validTo' | 'lastVerifiedAt' | 'evidence'
	| 'supersedes' | 'contradicts'> => {
	const record = lifecycle?.record;
	if (record) {
		return {
			lifecycleState: lifecycle.displayState,
			effectiveState: lifecycle.effectiveState,
			lifecycleReasons: lifecycle.reasons,
			claimKey: record.claim_key,
			authority: record.authority,
			confidenceLevel: record.confidence_level,
			declaredState: record.declared_state,
			observedAt: record.observed_at,
			validFrom: record.valid_from || '',
			validTo: record.valid_to || '',
			lastVerifiedAt: record.last_verified_at || '',
			evidence: [...record.evidence],
			supersedes: [...record.supersedes],
			contradicts: [...record.contradicts],
		};
	}
	return {
		lifecycleState: lifecycle?.displayState || 'legacy_unkeyed',
		effectiveState: lifecycle?.effectiveState || 'legacy_unkeyed',
		lifecycleReasons: lifecycle?.reasons || ['missing_claim_key'],
		claimKey: frontmatterString(note, ['claim_key']),
		authority: frontmatterString(note, ['authority']),
		confidenceLevel: frontmatterString(note, ['confidence_level']),
		declaredState: frontmatterString(note, ['declared_state']),
		observedAt: frontmatterString(note, ['observed_at']),
		validFrom: frontmatterString(note, ['valid_from']),
		validTo: frontmatterString(note, ['valid_to']),
		lastVerifiedAt: frontmatterString(note, ['last_verified_at']),
		evidence: frontmatterStringList(note, ['evidence']),
		supersedes: frontmatterStringList(note, ['supersedes']),
		contradicts: frontmatterStringList(note, ['contradicts']),
	};
};

const isQueuedProposal = (proposal: MemoryProposalRecord): boolean =>
	proposal.classification === 'memory_proposal'
	&& (
		proposal.approvalStatus === 'pending'
		|| proposal.approvalStatus === 'approved'
		|| proposal.approvalStatus === 'revision_requested'
	);

const proposalTargetsMemory = (proposal: MemoryProposalRecord): boolean =>
	isMemoryPath(proposal.targetNote)
	|| proposal.proposalKind.toLowerCase().includes('memory');

const memoryPathCandidates = (task: AgentTaskRecord): string[] =>
	[...task.memoryReads, ...task.memoryWrites]
		.map(normalizeRecordPath)
		.filter((path) => isMemoryPath(path));

const matchesMemoryFocus = (
	record: MemoryInspectorRecord,
	focusPaths: ReadonlySet<string>,
	taskId: string
): boolean => {
	if (taskId && record.taskId === taskId) {
		return true;
	}
	if (focusPaths.size === 0) {
		return !taskId;
	}
	return focusPaths.has(normalizeRecordPath(record.path))
		|| focusPaths.has(normalizeRecordPath(record.evidencePath));
};

export const buildMemoryInspectorSnapshot = (
	input: BuildMemoryInspectorInput
): MemoryInspectorSnapshot => {
	const persistedPaths = new Set<string>();
	const records: MemoryInspectorRecord[] = [];
	const lifecycleByPath = buildIndexedMemoryLifecycle(
		input.index.notes,
		input.index.generation,
		input.now
	);
	let immutableProjectEntryCount = 0;
	let legacyProjectNoteCount = 0;

	for (const note of input.index.notes) {
		const path = normalizeRecordPath(note.path);
		if (!isMemoryPath(path) || isIndexNote(path)) {
			continue;
		}
		persistedPaths.add(path);
		const project = projectFromMemoryPath(path)
			|| frontmatterString(note, ['project_hint', 'projectHint', 'related_project', 'relatedProject']);
		if (memoryScopeForPath(path, project) === 'project') {
			const recordType = (
				frontmatterString(note, ['type'])
				|| asString(note.type)
			).toLowerCase();
			if (recordType === 'project_memory_entry') {
				immutableProjectEntryCount += 1;
			} else {
				legacyProjectNoteCount += 1;
			}
		}
		records.push({
			id: `persisted:${path}`,
			path,
			evidencePath: path,
			title: memoryTitle(note),
			scope: memoryScopeForPath(path, project),
			project,
			state: 'persisted',
			provenance: memoryProvenance(note),
			taskId: frontmatterString(note, ['task_id', 'taskId']),
			status: 'persisted',
			summary: note.excerptSource,
			...lifecycleFields(note, lifecycleByPath.get(path)),
			sortTimestamp: parseTime(note.modifiedAt),
		});
	}

	for (const proposal of input.proposals) {
		if (!isQueuedProposal(proposal) || !proposalTargetsMemory(proposal)) {
			continue;
		}
		const targetPath = normalizeRecordPath(proposal.targetNote);
		const project = proposal.relatedProject || projectFromMemoryPath(targetPath);
		records.push({
			id: `queued:${normalizeRecordPath(proposal.path)}`,
			path: targetPath,
			evidencePath: normalizeRecordPath(proposal.path),
			title: proposal.proposalKind || proposal.proposalId,
			scope: memoryScopeForPath(targetPath, project),
			project,
			state: 'queued',
			provenance: proposal.proposedBy || 'proposal',
			taskId: proposal.taskId,
			status: proposal.approvalStatus,
			summary: proposal.snippet,
			lifecycleState: 'review',
			effectiveState: 'queued',
			lifecycleReasons: ['pending_human_review'],
			claimKey: '',
			authority: '',
			confidenceLevel: '',
			declaredState: 'review',
			observedAt: '',
			validFrom: '',
			validTo: '',
			lastVerifiedAt: '',
			evidence: [...proposal.evidence],
			supersedes: [],
			contradicts: [],
			sortTimestamp: proposal.sortTimestamp,
		});
	}

	const missingByPath = new Map<string, MemoryInspectorRecord>();
	for (const task of input.tasks) {
		for (const path of memoryPathCandidates(task)) {
			if (persistedPaths.has(path) || missingByPath.has(path)) {
				continue;
			}
			missingByPath.set(path, {
				id: `missing:${path}`,
				path,
				evidencePath: normalizeRecordPath(task.path),
				title: path.split('/').pop()?.replace(/\.md$/i, '') || path,
				scope: memoryScopeForPath(path, task.relatedProject),
				project: projectFromMemoryPath(path) || task.relatedProject,
				state: 'missing',
				provenance: 'task reference',
				taskId: task.taskId,
				status: 'missing evidence',
				summary: task.objective,
				lifecycleState: 'review',
				effectiveState: 'missing',
				lifecycleReasons: ['missing_persisted_evidence'],
				claimKey: '', authority: '', confidenceLevel: '', declaredState: '', observedAt: '',
				validFrom: '', validTo: '', lastVerifiedAt: '', evidence: [], supersedes: [], contradicts: [],
				sortTimestamp: task.sortTimestamp,
			});
		}
	}
	for (const proposal of input.proposals) {
		const path = normalizeRecordPath(proposal.targetNote);
		if (
			proposal.approvalStatus !== 'applied'
			|| !isMemoryPath(path)
			|| persistedPaths.has(path)
			|| missingByPath.has(path)
		) {
			continue;
		}
		missingByPath.set(path, {
			id: `missing:${path}`,
			path,
			evidencePath: normalizeRecordPath(proposal.path),
			title: proposal.proposalKind || proposal.proposalId,
			scope: memoryScopeForPath(path, proposal.relatedProject),
			project: projectFromMemoryPath(path) || proposal.relatedProject,
			state: 'missing',
			provenance: 'applied proposal',
			taskId: proposal.taskId,
			status: 'missing evidence',
			summary: proposal.snippet,
			lifecycleState: 'review',
			effectiveState: 'missing',
			lifecycleReasons: ['missing_persisted_evidence'],
			claimKey: '', authority: '', confidenceLevel: '', declaredState: '', observedAt: '',
			validFrom: '', validTo: '', lastVerifiedAt: '', evidence: [...proposal.evidence], supersedes: [], contradicts: [],
			sortTimestamp: proposal.sortTimestamp,
		});
	}
	records.push(...missingByPath.values());

	const scope = input.query?.scope || 'all';
	const state = input.query?.state || 'all';
	const focusPaths = new Set(
		(input.query?.focusPaths || []).map(normalizeRecordPath).filter(Boolean)
	);
	const taskId = input.query?.taskId?.trim() || '';
	const focused = focusPaths.size > 0 || Boolean(taskId);
	const filtered = records
		.filter((record) => scope === 'all' || record.scope === scope)
		.filter((record) => state === 'all' || record.state === state)
		.filter((record) => !focused || matchesMemoryFocus(record, focusPaths, taskId))
		.sort((left, right) => right.sortTimestamp - left.sortTimestamp || left.path.localeCompare(right.path));
	const page = paginate(filtered, input.query?.page, input.query?.pageSize);
	const lifecycleCounts: Record<MemoryLifecycleDisplayState, number> = {
		current: 0,
		history: 0,
		conflict: 0,
		review: 0,
		legacy_unkeyed: 0,
	};
	for (const record of records) {
		lifecycleCounts[record.lifecycleState] += 1;
	}

	return {
		records: page.items,
		page: page.page,
		pageSize: page.pageSize,
		totalItems: page.totalItems,
		totalPages: page.totalPages,
		scope,
		state,
		focused,
		missingMemoryFolder: input.missingMemoryFolder,
		indexState: input.index.state,
		indexGeneration: input.index.generation,
		lastRebuild: input.index.lastRebuild,
		readFailures: input.index.errors.filter((error) => isMemoryPath(error.path)),
		staleRecordCount: missingByPath.size,
		projectMemoryCounts: {
			immutableEntries: immutableProjectEntryCount,
			legacyNotes: legacyProjectNoteCount,
		},
		lifecycleCounts,
		updatedAt: input.now || new Date().toISOString(),
	};
};

const sourceTitle = (note: IndexedKnowledgeNote): string =>
	note.title || note.path.split('/').pop()?.replace(/\.md$/i, '') || note.path;

const sourceRecordType = (note: IndexedKnowledgeNote): string =>
	(frontmatterString(note, ['type']) || asString(note.type)).toLowerCase();

const sourcePartCount = (note: IndexedKnowledgeNote): number => {
	const value = Number(frontmatterString(note, ['part_count', 'partCount']));
	return Number.isSafeInteger(value) && value > 0 ? value : 0;
};

const sourceReferencePaths = (proposal: MemoryProposalRecord): string[] =>
	[...proposal.relatedSources, ...proposal.evidence]
		.map(normalizeRecordPath)
		.filter((path) => isSourcePath(path));

const sourceTaskIds = (
	path: string,
	note: IndexedKnowledgeNote,
	tasks: readonly AgentTaskRecord[]
): string[] => {
	const ids = new Set<string>();
	const noteTaskId = frontmatterString(note, ['task_id', 'taskId']);
	if (noteTaskId) {
		ids.add(noteTaskId);
	}
	for (const task of tasks) {
		if (
			task.sourceCaptures.map(normalizeRecordPath).includes(path)
			|| (noteTaskId && task.taskId === noteTaskId)
		) {
			ids.add(task.taskId);
		}
	}
	return [...ids];
};

const uniquePaths = (paths: readonly string[]): string[] =>
	[...new Set(paths.map(normalizeRecordPath).filter(Boolean))];

const matchesSourceFocus = (
	record: SourceStatusRecord,
	focusPaths: ReadonlySet<string>,
	taskId: string
): boolean => {
	if (taskId && record.taskIds.includes(taskId)) {
		return true;
	}
	if (focusPaths.size === 0) {
		return !taskId;
	}
	return focusPaths.has(normalizeRecordPath(record.path))
		|| focusPaths.has(normalizeRecordPath(record.evidencePath));
};

export const buildSourceStatusSnapshot = (
	input: BuildSourceStatusInput
): SourceStatusSnapshot => {
	const capturedPaths = new Set<string>();
	const records: SourceStatusRecord[] = [];

	for (const note of input.index.notes) {
		const path = normalizeRecordPath(note.path);
		if (!isSourcePath(path)) {
			continue;
		}
		capturedPaths.add(path);
		if (sourceRecordType(note) === 'source_part') {
			continue;
		}
		const taskIds = sourceTaskIds(path, note, input.tasks);
		const relatedTasks = input.tasks.filter((task) => taskIds.includes(task.taskId));
		const relatedProposals = input.proposals.filter((proposal) =>
			sourceReferencePaths(proposal).includes(path)
			|| Boolean(proposal.taskId && taskIds.includes(proposal.taskId))
		);
		records.push({
			id: `captured:${path}`,
			path,
			evidencePath: path,
			indexPath: normalizeRecordPath(
				frontmatterString(note, ['index_path', 'indexPath']) || path
			),
			title: sourceTitle(note),
			source: frontmatterString(note, ['source', 'source_url', 'sourceUrl']) || path,
			sourceKind: frontmatterString(note, ['source_kind', 'sourceKind', 'type']) || 'source',
			sourceId: frontmatterString(note, ['source_id', 'sourceId']),
			contentHash: frontmatterString(note, ['content_hash', 'contentHash']),
			route: frontmatterString(note, ['route', 'source_route', 'sourceRoute']),
			partCount: sourcePartCount(note),
			partManifest: uniquePaths(
				frontmatterStringList(note, ['part_manifest', 'partManifest'])
			),
			mode: frontmatterString(note, ['mode', 'source_mode', 'sourceMode']),
			state: 'captured',
			taskIds,
			taskPaths: uniquePaths(relatedTasks.map((task) => task.path)),
			proposalPaths: uniquePaths(relatedProposals.map((proposal) => proposal.path)),
			finalNotePaths: uniquePaths([
				...relatedTasks.map((task) => task.sessionNote),
				...relatedProposals.map((proposal) => proposal.sourceSessionNote),
			]),
			summary: note.excerptSource,
			sortTimestamp: parseTime(note.modifiedAt),
		});
	}

	const missingByPath = new Map<string, SourceStatusRecord>();
	for (const task of input.tasks) {
		for (const sourcePath of task.sourceCaptures.map(normalizeRecordPath).filter(isSourcePath)) {
			if (capturedPaths.has(sourcePath) || missingByPath.has(sourcePath)) {
				continue;
			}
			missingByPath.set(sourcePath, {
				id: `missing:${sourcePath}`,
				path: sourcePath,
				evidencePath: normalizeRecordPath(task.path),
				indexPath: sourcePath,
				title: sourcePath.split('/').pop()?.replace(/\.md$/i, '') || sourcePath,
				source: sourcePath,
				sourceKind: 'source',
				sourceId: '',
				contentHash: '',
				route: '',
				partCount: 0,
				partManifest: [],
				mode: '',
				state: 'missing',
				taskIds: [task.taskId],
				taskPaths: [normalizeRecordPath(task.path)],
				proposalPaths: uniquePaths(task.proposals),
				finalNotePaths: uniquePaths([task.sessionNote]),
				summary: task.objective,
				sortTimestamp: task.sortTimestamp,
			});
		}
	}
	for (const proposal of input.proposals) {
		for (const sourcePath of sourceReferencePaths(proposal)) {
			if (capturedPaths.has(sourcePath) || missingByPath.has(sourcePath)) {
				continue;
			}
			const relatedTask = input.tasks.find((task) => task.taskId === proposal.taskId);
			missingByPath.set(sourcePath, {
				id: `missing:${sourcePath}`,
				path: sourcePath,
				evidencePath: normalizeRecordPath(proposal.path),
				indexPath: sourcePath,
				title: sourcePath.split('/').pop()?.replace(/\.md$/i, '') || sourcePath,
				source: sourcePath,
				sourceKind: 'source',
				sourceId: '',
				contentHash: '',
				route: '',
				partCount: 0,
				partManifest: [],
				mode: '',
				state: 'missing',
				taskIds: proposal.taskId ? [proposal.taskId] : [],
				taskPaths: uniquePaths(relatedTask ? [relatedTask.path] : []),
				proposalPaths: [normalizeRecordPath(proposal.path)],
				finalNotePaths: uniquePaths([
					...(relatedTask ? [relatedTask.sessionNote] : []),
					proposal.sourceSessionNote,
				]),
				summary: proposal.snippet,
				sortTimestamp: proposal.sortTimestamp,
			});
		}
	}
	records.push(...missingByPath.values());

	const focusPaths = new Set(
		(input.query?.focusPaths || []).map(normalizeRecordPath).filter(Boolean)
	);
	const taskId = input.query?.taskId?.trim() || '';
	const focused = focusPaths.size > 0 || Boolean(taskId);
	const filtered = records
		.filter((record) => !focused || matchesSourceFocus(record, focusPaths, taskId))
		.sort((left, right) => right.sortTimestamp - left.sortTimestamp || left.path.localeCompare(right.path));
	const page = paginate(filtered, input.query?.page, input.query?.pageSize);

	return {
		records: page.items,
		requests: [...input.requests],
		page: page.page,
		pageSize: page.pageSize,
		totalItems: page.totalItems,
		totalPages: page.totalPages,
		focused,
		missingSourceFolder: input.missingSourceFolder,
		missingRequestFolder: input.missingRequestFolder,
		indexState: input.index.state,
		indexGeneration: input.index.generation,
		lastRebuild: input.index.lastRebuild,
		readFailures: input.index.errors.filter((error) => isSourcePath(error.path)),
		staleRecordCount: missingByPath.size,
		updatedAt: input.now || new Date().toISOString(),
	};
};
