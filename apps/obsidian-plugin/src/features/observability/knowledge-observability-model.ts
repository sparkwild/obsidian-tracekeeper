import {
	KNOWLEDGE_GLOBAL_MEMORY_DIR,
	KNOWLEDGE_PROJECTS_MEMORY_DIR,
	KNOWLEDGE_SOURCES_DIR,
	KNOWLEDGE_SOURCES_FILES_DIR,
	KNOWLEDGE_SOURCES_TRANSCRIPTS_DIR,
	KNOWLEDGE_SOURCES_WEB_DIR,
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
export type MemoryLifecycleFilter = 'all' | MemoryLifecycleDisplayState;

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
	lifecycle?: MemoryLifecycleFilter;
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
	lifecycle: MemoryLifecycleFilter;
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

export type SourceEvidenceState = 'captured' | 'incomplete' | 'missing';
export type SourceCaptureEvidenceIssue =
	| 'type'
	| 'source'
	| 'source_kind'
	| 'source_id'
	| 'content_hash'
	| 'route'
	| 'mode'
	| 'part_count'
	| 'part_manifest'
	| 'source_part'
	| 'source_part.parent_source'
	| 'source_part.source_id'
	| 'source_part.content_hash'
	| 'source_part.part_count'
	| 'source_part.part_number';

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
	evidenceIssues: SourceCaptureEvidenceIssue[];
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
			if (recordType === 'project_memory_entry' || recordType === 'memory_record') {
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
	const lifecycle = input.query?.lifecycle || 'all';
	const focusPaths = new Set(
		(input.query?.focusPaths || []).map(normalizeRecordPath).filter(Boolean)
	);
	const taskId = input.query?.taskId?.trim() || '';
	const focused = focusPaths.size > 0 || Boolean(taskId);
	const filtered = records
		.filter((record) => scope === 'all' || record.scope === scope)
		.filter((record) => state === 'all' || record.state === state)
		.filter((record) => lifecycle === 'all' || record.lifecycleState === lifecycle)
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
		lifecycle,
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

const SOURCE_ID_PATTERN = /^source-[a-f0-9]{32}$/;
const SOURCE_CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SOURCE_CAPTURE_MODES = new Set([
	'external_reference',
	'extracted_snapshot',
	'local_copy',
]);
const SOURCE_ROUTES = new Map([
	['web', KNOWLEDGE_SOURCES_WEB_DIR],
	['file', KNOWLEDGE_SOURCES_FILES_DIR],
	['transcript', KNOWLEDGE_SOURCES_TRANSCRIPTS_DIR],
]);

interface StrictFrontmatterField<T> {
	valid: boolean;
	value: T;
}

const frontmatterAliasValues = (
	note: IndexedKnowledgeNote,
	keys: readonly string[]
): unknown[] => keys
	.filter((key) => Object.prototype.hasOwnProperty.call(note.frontmatter, key))
	.map((key) => note.frontmatter[key]);

const strictStringField = (
	note: IndexedKnowledgeNote,
	keys: readonly string[],
	normalize: (value: string) => string = (value) => value.trim()
): StrictFrontmatterField<string> => {
	const rawValues = frontmatterAliasValues(note, keys);
	if (rawValues.length === 0 || rawValues.some((value) => typeof value !== 'string')) {
		return { valid: false, value: '' };
	}
	const values = (rawValues as string[]).map(normalize);
	if (!values[0] || values.some((value) => value !== values[0])) {
		return { valid: false, value: values[0] || '' };
	}
	return { valid: true, value: values[0] };
};

const isSourcePartRecord = (note: IndexedKnowledgeNote): boolean => {
	const typeField = strictStringField(
		note,
		['type'],
		(value) => value.trim().toLowerCase()
	);
	return typeField.valid && typeField.value === 'source_part';
};

const strictIntegerField = (
	note: IndexedKnowledgeNote,
	keys: readonly string[]
): StrictFrontmatterField<number> => {
	const rawValues = frontmatterAliasValues(note, keys);
	if (rawValues.length === 0) {
		return { valid: false, value: 0 };
	}
	const values: number[] = [];
	for (const rawValue of rawValues) {
		if (typeof rawValue === 'number' && Number.isSafeInteger(rawValue) && rawValue >= 0) {
			values.push(rawValue);
			continue;
		}
		if (typeof rawValue === 'string' && /^(0|[1-9]\d*)$/.test(rawValue.trim())) {
			const value = Number(rawValue.trim());
			if (Number.isSafeInteger(value)) {
				values.push(value);
				continue;
			}
		}
		return { valid: false, value: values[0] || 0 };
	}
	if (values.some((value) => value !== values[0])) {
		return { valid: false, value: values[0] || 0 };
	}
	return { valid: true, value: values[0] };
};

const strictPathListField = (
	note: IndexedKnowledgeNote,
	keys: readonly string[]
): StrictFrontmatterField<string[]> => {
	const rawValues = frontmatterAliasValues(note, keys);
	if (
		rawValues.length === 0
		|| rawValues.some((value) =>
			!Array.isArray(value)
			|| value.some((entry) => typeof entry !== 'string' || !normalizeRecordPath(entry))
		)
	) {
		return { valid: false, value: [] };
	}
	const values = (rawValues as string[][])
		.map((value) => value.map(normalizeRecordPath));
	const canonical = values[0];
	if (values.some((value) =>
		value.length !== canonical.length
		|| value.some((entry, index) => entry !== canonical[index])
	)) {
		return { valid: false, value: canonical };
	}
	return { valid: true, value: canonical };
};

const sourceCaptureEvidenceIssues = (
	note: IndexedKnowledgeNote,
	path: string,
	notesByPath: ReadonlyMap<string, IndexedKnowledgeNote>,
	partPathsByParent: ReadonlyMap<string, readonly string[]>
): SourceCaptureEvidenceIssue[] => {
	const issues: SourceCaptureEvidenceIssue[] = [];
	const typeField = strictStringField(note, ['type'], (value) => value.trim().toLowerCase());
	if (!typeField.valid || typeField.value !== 'source_capture') {
		issues.push('type');
	}
	const sourceField = strictStringField(note, ['source', 'source_url', 'sourceUrl']);
	if (!sourceField.valid) {
		issues.push('source');
	}
	const sourceKindField = strictStringField(
		note,
		['source_kind', 'sourceKind'],
		(value) => value.trim().toLowerCase()
	);
	const expectedRoute = sourceKindField.valid
		? SOURCE_ROUTES.get(sourceKindField.value)
		: undefined;
	if (!sourceKindField.valid || !expectedRoute) {
		issues.push('source_kind');
	}
	const sourceIdField = strictStringField(note, ['source_id', 'sourceId']);
	if (!sourceIdField.valid || !SOURCE_ID_PATTERN.test(sourceIdField.value)) {
		issues.push('source_id');
	}
	const contentHashField = strictStringField(note, ['content_hash', 'contentHash']);
	if (!contentHashField.valid || !SOURCE_CONTENT_HASH_PATTERN.test(contentHashField.value)) {
		issues.push('content_hash');
	}
	const routeField = strictStringField(
		note,
		['route', 'source_route', 'sourceRoute'],
		normalizeRecordPath
	);
	if (
		!routeField.valid
		|| !expectedRoute
		|| routeField.value !== expectedRoute
		|| !path.startsWith(`${routeField.value}/`)
	) {
		issues.push('route');
	}
	const modeField = strictStringField(
		note,
		['mode', 'source_mode', 'sourceMode'],
		(value) => value.trim().toLowerCase()
	);
	if (!modeField.valid || !SOURCE_CAPTURE_MODES.has(modeField.value)) {
		issues.push('mode');
	}

	const partCountField = strictIntegerField(note, ['part_count', 'partCount']);
	const partCount = partCountField.value;
	const validPartCount = partCountField.valid;
	const partManifestField = strictPathListField(note, ['part_manifest', 'partManifest']);
	const validPartManifest = partManifestField.valid
		&& partManifestField.value.every((entry) =>
			!expectedRoute || entry.startsWith(`${expectedRoute}/`)
		);
	const normalizedPartManifest = partManifestField.value;
	const uniquePartManifest = [...new Set(normalizedPartManifest)];

	if (!validPartCount) {
		issues.push('part_count');
	}
	if (!validPartManifest) {
		issues.push('part_manifest');
	}
	if (
		validPartCount
		&& validPartManifest
		&& (partCount !== normalizedPartManifest.length
			|| uniquePartManifest.length !== normalizedPartManifest.length)
	) {
		issues.push('part_count', 'part_manifest');
	}
	const indexedChildren = partPathsByParent.get(path) || [];
	if (
		validPartCount
		&& validPartManifest
		&& (
			indexedChildren.length !== uniquePartManifest.length
			|| indexedChildren.some((partPath) =>
				!uniquePartManifest.some((manifestPath) => manifestPath.toLowerCase() === partPath)
			)
		)
	) {
		issues.push('part_manifest');
	}

	if (validPartCount && validPartManifest && partCount > 0) {
		const partNumbers: number[] = [];
		for (const partPath of uniquePartManifest) {
			const part = notesByPath.get(partPath.toLowerCase());
			const childTypeField = part
				? strictStringField(part, ['type'], (value) => value.trim().toLowerCase())
				: { valid: false, value: '' };
			if (!part || !childTypeField.valid || childTypeField.value !== 'source_part') {
				issues.push('source_part');
				continue;
			}
			const parentSourceField = strictStringField(
				part,
				['parent_source', 'parentSource'],
				normalizeRecordPath
			);
			if (!parentSourceField.valid || parentSourceField.value !== path) {
				issues.push('source_part.parent_source');
			}
			const childSourceIdField = strictStringField(part, ['source_id', 'sourceId']);
			if (
				!childSourceIdField.valid
				|| childSourceIdField.value !== sourceIdField.value
				|| !SOURCE_ID_PATTERN.test(childSourceIdField.value)
			) {
				issues.push('source_part.source_id');
			}
			const childContentHashField = strictStringField(part, ['content_hash', 'contentHash']);
			if (
				!childContentHashField.valid
				|| !SOURCE_CONTENT_HASH_PATTERN.test(childContentHashField.value)
			) {
				issues.push('source_part.content_hash');
			}

			const childPartCountField = strictIntegerField(part, ['part_count', 'partCount']);
			if (!childPartCountField.valid || childPartCountField.value !== partCount) {
				issues.push('source_part.part_count');
			}
			const partNumberField = strictIntegerField(part, ['part_number', 'partNumber']);
			if (!partNumberField.valid || partNumberField.value < 1 || partNumberField.value > partCount) {
				issues.push('source_part.part_number');
			} else {
				partNumbers.push(partNumberField.value);
			}
		}

		const contiguousPartNumbers = partNumbers.length === partCount
			&& new Set(partNumbers).size === partCount
			&& [...partNumbers].sort((left, right) => left - right)
				.every((partNumber, index) => partNumber === index + 1);
		if (!contiguousPartNumbers) {
			issues.push('source_part.part_number');
		}

	}

	return [...new Set(issues)];
};

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
	const indexedSourcePaths = new Set<string>();
	const records: SourceStatusRecord[] = [];
	const notesByPath = new Map(
		input.index.notes.map((note) => [normalizeRecordPath(note.path).toLowerCase(), note])
	);
	const partPathsByParent = new Map<string, string[]>();
	for (const note of input.index.notes) {
		if (!isSourcePartRecord(note)) {
			continue;
		}
		const parentSourceField = strictStringField(
			note,
			['parent_source', 'parentSource'],
			normalizeRecordPath
		);
		if (!parentSourceField.valid) {
			continue;
		}
		const partPaths = partPathsByParent.get(parentSourceField.value) || [];
		partPaths.push(normalizeRecordPath(note.path).toLowerCase());
		partPathsByParent.set(parentSourceField.value, partPaths);
	}

	for (const note of input.index.notes) {
		const path = normalizeRecordPath(note.path);
		if (!isSourcePath(path)) {
			continue;
		}
		indexedSourcePaths.add(path);
		if (isSourcePartRecord(note)) {
			continue;
		}
		const taskIds = sourceTaskIds(path, note, input.tasks);
		const relatedTasks = input.tasks.filter((task) => taskIds.includes(task.taskId));
		const relatedProposals = input.proposals.filter((proposal) =>
			sourceReferencePaths(proposal).includes(path)
			|| Boolean(proposal.taskId && taskIds.includes(proposal.taskId))
		);
		const evidenceIssues = sourceCaptureEvidenceIssues(
			note,
			path,
			notesByPath,
			partPathsByParent
		);
		const state: SourceEvidenceState = evidenceIssues.length === 0
			? 'captured'
			: 'incomplete';
		records.push({
			id: `${state}:${path}`,
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
			state,
			evidenceIssues,
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
			if (indexedSourcePaths.has(sourcePath) || missingByPath.has(sourcePath)) {
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
				evidenceIssues: [],
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
			if (indexedSourcePaths.has(sourcePath) || missingByPath.has(sourcePath)) {
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
				evidenceIssues: [],
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
