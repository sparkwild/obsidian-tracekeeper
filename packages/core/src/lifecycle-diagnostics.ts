import path from 'node:path';
import {
	KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH,
	KNOWLEDGE_PROJECTS_INDEX_PATH,
	KNOWLEDGE_PROJECTS_MEMORY_DIR,
	KNOWLEDGE_SOURCES_DIR,
	isKnowledgeMemoryPath,
	normalizeKnowledgePath,
} from './knowledge-architecture';
import {
	legacyMemoryToReadProjection,
	parseMemoryRecord,
	type MemoryRecord,
	type MemoryRecordReadProjection,
} from './memory-record';
import { resolveMemoryLifecycle, type MemoryLifecycleIssueCode } from './memory-lifecycle';
import type { ScannedNote } from './scan';

export type LifecycleDiagnosticKind =
	| 'memory_schema_invalid'
	| 'memory_claim_key_missing'
	| 'memory_legacy_unkeyed'
	| 'memory_duplicate_id'
	| 'memory_lifecycle_dangling_relation'
	| 'memory_lifecycle_cross_claim_relation'
	| 'memory_lifecycle_cycle'
	| 'memory_lifecycle_duplicate_current'
	| 'memory_temporal_invalid'
	| 'memory_verification_stale'
	| 'memory_verified_without_evidence'
	| 'memory_authority_without_evidence'
	| 'memory_evidence_unresolved'
	| 'memory_hub_missing'
	| 'memory_hub_unresolved'
	| 'memory_hub_scope_mismatch'
	| 'memory_project_hub_parent_missing'
	| 'memory_relation_body_parity'
	| 'memory_related_source_unresolved'
	| 'source_part_parent_unresolved'
	| 'source_part_identity_mismatch'
	| 'source_part_manifest_invalid'
	| 'storage_directory_growth';

export interface LifecycleDiagnosticIssue {
	severity: 'error' | 'warning';
	kind: LifecycleDiagnosticKind;
	path: string;
	line: number;
	message: string;
	context?: string;
	paths?: string[];
}

export interface LifecycleDiagnosticOptions {
	now?: string;
	staleAfterDays?: number;
	maxDirectoryRecords?: number;
	maxSourceParts?: number;
}

export interface LifecycleDirectoryCount {
	directory: string;
	record_count: number;
}

export interface LegacyMemoryCandidate {
	path: string;
	contentHash: string;
	scope: 'global' | 'project';
	projectId: string | null;
	suggestions: readonly [];
}

export interface LifecycleDoctorReport {
	issues: LifecycleDiagnosticIssue[];
	directory_counts: LifecycleDirectoryCount[];
	legacy_candidates: LegacyMemoryCandidate[];
}

const DEFAULT_STALE_AFTER_DAYS = 365;
const DEFAULT_MAX_DIRECTORY_RECORDS = 1_000;
const DEFAULT_MAX_SOURCE_PARTS = 16;

export function diagnoseMemoryKnowledgeLifecycle(
	notes: readonly ScannedNote[],
	options: LifecycleDiagnosticOptions = {}
): LifecycleDiagnosticIssue[] {
	return buildLifecycleDoctorReport(notes, options).issues;
}

export function buildLifecycleDoctorReport(
	notes: readonly ScannedNote[],
	options: LifecycleDiagnosticOptions = {}
): LifecycleDoctorReport {
	const issues: LifecycleDiagnosticIssue[] = [];
	const paths = new Map(notes.map((note) => [normalizeKnowledgePath(note.relativePath).toLowerCase(), note]));
	const records: MemoryRecord[] = [];
	const legacy: Exclude<MemoryRecordReadProjection, { kind: 'v2' }>[] = [];

	for (const note of notes) {
		const notePath = normalizeKnowledgePath(note.relativePath);
		if (!notePath) continue;
		const type = stringField(note, 'type');
		if (isLegacyMemoryNote(notePath, type)) {
			const projection = legacyMemoryToReadProjection({
				path: notePath,
				scope: notePath.startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`) ? 'project' : 'global',
				project_id: stringField(note, 'project_id') || inferLegacyProjectId(notePath),
			});
			if (projection.kind !== 'v2') legacy.push(projection);
			issues.push(issue('warning', 'memory_legacy_unkeyed', notePath,
				'Legacy memory has no proven claim_key and remains excluded from automatic lifecycle resolution.'));
		}

		const isV2Candidate = type === 'memory_record'
			|| (isKnowledgeMemoryPath(notePath) && note.frontmatter.schema_version === 2);
		if (!isV2Candidate) continue;
		preflightMemoryFields(note, issues);
		try {
			const record = parseMemoryRecord({ path: notePath, frontmatter: note.frontmatter });
			records.push(record);
			diagnoseRecordReferences(record, note, paths, issues);
		} catch (error) {
			issues.push(issue('error', 'memory_schema_invalid', notePath,
				error instanceof Error ? error.message : String(error)));
		}
	}

	const lifecycle = resolveMemoryLifecycle({
		generation: 0,
		records,
		legacy,
		now: options.now,
		staleAfterDays: options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS,
	});
	for (const lifecycleIssue of lifecycle.issues) {
		const record = records.find((candidate) => lifecycleIssue.memory_ids.includes(candidate.memory_id));
		issues.push(lifecycleIssueToDiagnostic(lifecycleIssue.code, lifecycleIssue.message,
			record?.path ?? lifecycleIssue.memory_ids[0], lifecycleIssue.reference));
	}

	diagnoseProjectHubParents(notes, paths, issues);
	diagnoseSourceParts(notes, paths, options.maxSourceParts ?? DEFAULT_MAX_SOURCE_PARTS, issues);
	const directoryCounts = collectDirectoryCounts(notes);
	diagnoseDirectoryGrowth(directoryCounts, options.maxDirectoryRecords ?? DEFAULT_MAX_DIRECTORY_RECORDS, issues);
	return {
		issues: dedupeAndSort(issues),
		directory_counts: directoryCounts,
		legacy_candidates: lifecycle.legacy.map((row) => ({
			path: row.projection.path,
			contentHash: notes.find((note) => normalizeKnowledgePath(note.relativePath) === row.projection.path)?.contentHash ?? '',
			scope: row.projection.scope,
			projectId: row.projection.project_id,
			suggestions: [],
		})),
	};
}

function preflightMemoryFields(note: ScannedNote, issues: LifecycleDiagnosticIssue[]): void {
	const notePath = normalizeKnowledgePath(note.relativePath);
	const claimKey = stringField(note, 'claim_key');
	if (!claimKey) {
		issues.push(issue('error', 'memory_claim_key_missing', notePath, 'MemoryRecord v2 requires a non-empty claim_key.'));
	}
	const evidence = listField(note, 'evidence');
	const scope = stringField(note, 'scope');
	if ((scope === 'global' && !stringField(note, 'global_hub'))
		|| (scope === 'project' && !stringField(note, 'project_hub'))) {
		issues.push(issue('error', 'memory_hub_missing', notePath,
			`${scope || 'Memory'} record is missing its required Hub relation.`));
	}
	if (stringField(note, 'confidence_level') === 'verified' && evidence.length === 0) {
		issues.push(issue('error', 'memory_verified_without_evidence', notePath,
			'Verified memory requires at least one evidence reference.'));
	}
	if (stringField(note, 'authority') === 'source' && evidence.length === 0) {
		issues.push(issue('warning', 'memory_authority_without_evidence', notePath,
			'Source-authority memory should identify its source evidence.'));
	}
	const validFrom = timestampField(note, 'valid_from');
	const validTo = timestampField(note, 'valid_to');
	if ((fieldPresent(note, 'valid_from') && validFrom === null)
		|| (fieldPresent(note, 'valid_to') && validTo === null)
		|| (validFrom !== null && validTo !== null && validFrom > validTo)) {
		issues.push(issue('error', 'memory_temporal_invalid', notePath,
			'Memory validity timestamps are invalid or valid_from is later than valid_to.'));
	}
}

function diagnoseRecordReferences(
	record: MemoryRecord,
	note: ScannedNote,
	paths: ReadonlyMap<string, ScannedNote>,
	issues: LifecycleDiagnosticIssue[]
): void {
	for (const reference of record.evidence) {
		if (!resolvePath(reference, record.path, paths)) {
			issues.push(referenceIssue('warning', 'memory_evidence_unresolved', record.path, reference,
				`Memory evidence is unresolved: ${reference}`));
		}
	}
	for (const reference of record.related_sources) {
		const target = resolvePath(reference, record.path, paths);
		if (!target || !target.startsWith(`${KNOWLEDGE_SOURCES_DIR}/`)) {
			issues.push(referenceIssue('warning', 'memory_related_source_unresolved', record.path, reference,
				`Related Source is missing, unresolved, or outside the Source owner: ${reference}`));
		}
		if (!hasVisibleBodyTarget(note, reference, record.path, paths)) {
			issues.push(referenceIssue('warning', 'memory_relation_body_parity', record.path, reference,
				`related_sources YAML relation is not represented by a visible body link: ${reference}`));
		}
	}
	const declaredSourcePaths = new Set(record.related_sources
		.map((reference) => resolvePath(reference, record.path, paths))
		.filter((value): value is string => Boolean(value)));
	for (const edge of note.edges) {
		if (edge.source !== 'body') continue;
		const target = resolvePath(edge.target || edge.referenceLabel || edge.raw, record.path, paths);
		if (target?.startsWith(`${KNOWLEDGE_SOURCES_DIR}/`) && !declaredSourcePaths.has(target)) {
			issues.push(referenceIssue('warning', 'memory_relation_body_parity', record.path, target,
				`Visible Source body link is missing from related_sources YAML: ${target}`));
		}
	}
	const hub = record.scope === 'global' ? record.global_hub : record.project_hub;
	if (!hub) return;
	if (!hasVisibleBodyTarget(note, hub, record.path, paths)) {
		issues.push(referenceIssue('warning', 'memory_relation_body_parity', record.path, hub,
			`Memory Hub YAML relation is not represented by a visible body link: ${hub}`));
	}
	const resolvedHub = resolvePath(hub, record.path, paths);
	if (!resolvedHub) {
		issues.push(referenceIssue('error', 'memory_hub_unresolved', record.path, hub,
			`Memory Hub is unresolved: ${hub}`));
		return;
	}
	const projectHubSuffix = resolvedHub.startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)
		? resolvedHub.slice(KNOWLEDGE_PROJECTS_MEMORY_DIR.length + 1)
		: '';
	const validProjectHub = projectHubSuffix.split('/').length === 2 && projectHubSuffix.endsWith('/index.md');
	if ((record.scope === 'global' && resolvedHub !== KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH)
		|| (record.scope === 'project' && !validProjectHub)) {
		issues.push(referenceIssue('error', 'memory_hub_scope_mismatch', record.path, resolvedHub,
			`Memory Hub does not match the record scope: ${resolvedHub}`));
	}
}

function diagnoseProjectHubParents(
	notes: readonly ScannedNote[],
	paths: ReadonlyMap<string, ScannedNote>,
	issues: LifecycleDiagnosticIssue[]
): void {
	for (const note of notes) {
		const notePath = normalizeKnowledgePath(note.relativePath);
		if (!notePath.startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`) || !notePath.endsWith('/index.md')) continue;
		const suffix = notePath.slice(KNOWLEDGE_PROJECTS_MEMORY_DIR.length + 1);
		if (suffix.split('/').length !== 2) continue;
		const parent = stringField(note, 'parent_hub');
		const resolvedParent = parent ? resolvePath(parent, notePath, paths) : null;
		if (resolvedParent !== KNOWLEDGE_PROJECTS_INDEX_PATH) {
			issues.push(issue('warning', 'memory_project_hub_parent_missing', notePath,
				'Project memory Hub must link to the projects index through parent_hub.'));
		} else if (!hasVisibleBodyTarget(note, parent, notePath, paths)) {
			issues.push(referenceIssue('warning', 'memory_relation_body_parity', notePath, parent,
				'Project Hub parent_hub YAML relation is not represented by a visible body link.'));
		}
	}
}

function diagnoseSourceParts(
	notes: readonly ScannedNote[],
	paths: ReadonlyMap<string, ScannedNote>,
	maxSourceParts: number,
	issues: LifecycleDiagnosticIssue[]
): void {
	if (!Number.isSafeInteger(maxSourceParts) || maxSourceParts < 1) {
		throw new Error('maxSourceParts must be a positive safe integer.');
	}
	const partsByParent = new Map<string, ScannedNote[]>();
	for (const note of notes) {
		if (stringField(note, 'type') !== 'source_capture') continue;
		const notePath = normalizeKnowledgePath(note.relativePath);
		const manifest = listField(note, 'part_manifest');
		const resolvedParts = manifest
			.map((reference) => resolvePath(reference, notePath, paths))
			.filter((value): value is string => Boolean(value));
		if (manifest.length > maxSourceParts || resolvedParts.length !== manifest.length
			|| resolvedParts.some((partPath) => stringField(paths.get(partPath.toLowerCase()), 'type') !== 'source_part')) {
			issues.push(issue('error', 'source_part_manifest_invalid', notePath,
				`Source manifest contains missing, non-part, or over-limit entries (${manifest.length} declared part(s)).`,
				undefined, resolvedParts));
		}
	}
	for (const note of notes) {
		if (stringField(note, 'type') !== 'source_part') continue;
		const notePath = normalizeKnowledgePath(note.relativePath);
		const parentRef = stringField(note, 'parent_source');
		const parentPath = parentRef ? resolvePath(parentRef, notePath, paths) : null;
		const parent = parentPath ? paths.get(parentPath.toLowerCase()) : undefined;
		if (!parentPath || stringField(parent, 'type') !== 'source_capture') {
			issues.push(issue('error', 'source_part_parent_unresolved', notePath,
				'Source part has no resolvable parent_source.', parentRef));
			continue;
		}
		if (stringField(note, 'source_id') !== stringField(parent, 'source_id')) {
			issues.push(referenceIssue('error', 'source_part_identity_mismatch', notePath, parentPath,
				'Source part source_id does not match its parent Source index.'));
		}
		const siblings = partsByParent.get(parentPath) ?? [];
		siblings.push(note);
		partsByParent.set(parentPath, siblings);
	}
	for (const [parentPath, parts] of partsByParent) {
		const parent = paths.get(parentPath.toLowerCase());
		const manifest = parent ? listField(parent, 'part_manifest') : [];
		const numbers = parts.map((part) => numberField(part, 'part_number')).filter((value): value is number => value !== null);
		const declaredCounts = new Set(parts.map((part) => numberField(part, 'part_count')).filter((value): value is number => value !== null));
		const actualPaths = new Set(parts.map((part) => normalizeKnowledgePath(part.relativePath)));
		const manifestPaths = new Set(manifest.map((ref) => resolvePath(ref, parentPath, paths)).filter((value): value is string => Boolean(value)));
		const completeSequence = numbers.length === parts.length
			&& new Set(numbers).size === parts.length
			&& [...numbers].sort((a, b) => a - b).every((value, index) => value === index + 1);
		if (parts.length > maxSourceParts || declaredCounts.size !== 1 || !declaredCounts.has(parts.length)
			|| !completeSequence || !setsEqual(actualPaths, manifestPaths)) {
			issues.push(issue('error', 'source_part_manifest_invalid', parentPath,
				`Source part manifest/count/sequence is inconsistent (${parts.length} observed part(s)).`,
				undefined, [...actualPaths].sort()));
		}
	}
}

function diagnoseDirectoryGrowth(
	directoryCounts: readonly LifecycleDirectoryCount[],
	maxDirectoryRecords: number,
	issues: LifecycleDiagnosticIssue[]
): void {
	if (!Number.isSafeInteger(maxDirectoryRecords) || maxDirectoryRecords < 1) {
		throw new Error('maxDirectoryRecords must be a positive safe integer.');
	}
	for (const { directory, record_count: count } of directoryCounts) {
		if (count <= maxDirectoryRecords) continue;
		issues.push(issue('warning', 'storage_directory_growth', directory,
			`Directory contains ${count} lifecycle/source records; review this count in the separately authorized sharding task.`,
			String(count)));
	}
}

function collectDirectoryCounts(notes: readonly ScannedNote[]): LifecycleDirectoryCount[] {
	const counts = new Map<string, number>();
	for (const note of notes) {
		const notePath = normalizeKnowledgePath(note.relativePath);
		const type = stringField(note, 'type');
		if (type !== 'memory_record' && type !== 'source_capture' && type !== 'source_part') continue;
		const directory = path.posix.dirname(notePath);
		counts.set(directory, (counts.get(directory) ?? 0) + 1);
	}
	return [...counts].map(([directory, record_count]) => ({ directory, record_count }))
		.sort((left, right) => left.directory.localeCompare(right.directory));
}

function lifecycleIssueToDiagnostic(
	code: MemoryLifecycleIssueCode,
	message: string,
	pathValue: string,
	reference?: string
): LifecycleDiagnosticIssue {
	const kinds: Record<MemoryLifecycleIssueCode, LifecycleDiagnosticKind> = {
		duplicate_memory_id: 'memory_duplicate_id',
		dangling_supersedes: 'memory_lifecycle_dangling_relation',
		dangling_contradicts: 'memory_lifecycle_dangling_relation',
		cross_claim_relation: 'memory_lifecycle_cross_claim_relation',
		supersession_cycle: 'memory_lifecycle_cycle',
		duplicate_current: 'memory_lifecycle_duplicate_current',
		stale_verification: 'memory_verification_stale',
	};
	return issue(code === 'stale_verification' ? 'warning' : 'error', kinds[code], pathValue, message, reference);
}

function resolvePath(raw: string, sourcePath: string, paths: ReadonlyMap<string, ScannedNote>): string | null {
	let value = raw.trim();
	const wikilink = value.match(/^\[\[(.*?)\]\]$/);
	if (wikilink) value = wikilink[1];
	value = value.split('|', 1)[0].split('#', 1)[0].replace(/\\/g, '/').trim();
	if (!value || /^(?:https?:|mailto:|file:|ftp:)/i.test(value)) return null;
	if (value.startsWith('./') || value.startsWith('../')) value = path.posix.join(path.posix.dirname(sourcePath), value);
	value = normalizeKnowledgePath(value.replace(/^\/+/, ''));
	const candidates = path.posix.extname(value) ? [value] : [`${value}.md`, value];
	for (const candidate of candidates) if (paths.has(candidate.toLowerCase())) return candidate;
	const basename = path.posix.basename(value).replace(/\.(?:md|markdown)$/i, '').toLowerCase();
	const matches = [...paths.keys()].filter((candidate) =>
		path.posix.basename(candidate).replace(/\.(?:md|markdown)$/i, '') === basename);
	return matches.length === 1 ? normalizeKnowledgePath(paths.get(matches[0])?.relativePath ?? '') : null;
}

function inferLegacyProjectId(notePath: string): string | null {
	const suffix = notePath.slice(KNOWLEDGE_PROJECTS_MEMORY_DIR.length + 1);
	return suffix.split('/', 1)[0] || null;
}

function isLegacyMemoryNote(notePath: string, type: string): boolean {
	if (!isKnowledgeMemoryPath(notePath) || isMemoryHub(notePath)) return false;
	return type === 'memory' || type === 'project_memory_entry' || (!type && path.posix.basename(notePath) === 'memory.md');
}

function isMemoryHub(notePath: string): boolean {
	return notePath.endsWith('/index.md') || notePath === `${path.posix.dirname(KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH)}/index.md`;
}

function fieldPresent(note: ScannedNote, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(note.frontmatter, key);
}

function stringField(note: ScannedNote | undefined, key: string): string {
	const value = note?.frontmatter[key];
	return typeof value === 'string' ? value.trim() : '';
}

function listField(note: ScannedNote, key: string): string[] {
	const value = note.frontmatter[key];
	if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function numberField(note: ScannedNote, key: string): number | null {
	const value = note.frontmatter[key];
	return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function timestampField(note: ScannedNote, key: string): number | null {
	const value = note.frontmatter[key];
	if (typeof value !== 'string' || !value.trim()) return null;
	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? null : timestamp;
}

function hasVisibleBodyTarget(
	note: ScannedNote,
	reference: string,
	sourcePath: string,
	paths: ReadonlyMap<string, ScannedNote>
): boolean {
	const expected = resolvePath(reference, sourcePath, paths);
	if (!expected) return false;
	return note.edges.some((edge) => edge.source === 'body'
		&& resolvePath(edge.target || edge.referenceLabel || edge.raw, sourcePath, paths) === expected);
}

function referenceIssue(
	severity: 'error' | 'warning', kind: LifecycleDiagnosticKind, pathValue: string,
	reference: string, message: string
): LifecycleDiagnosticIssue {
	return issue(severity, kind, pathValue, message, reference, [reference]);
}

function issue(
	severity: 'error' | 'warning', kind: LifecycleDiagnosticKind, pathValue: string,
	message: string, context?: string, paths?: string[]
): LifecycleDiagnosticIssue {
	return { severity, kind, path: pathValue, line: 1, message, ...(context ? { context } : {}), ...(paths ? { paths } : {}) };
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
	return left.size === right.size && [...left].every((value) => right.has(value));
}

function dedupeAndSort(issues: LifecycleDiagnosticIssue[]): LifecycleDiagnosticIssue[] {
	const unique = new Map<string, LifecycleDiagnosticIssue>();
	for (const row of issues) unique.set(`${row.kind}\u0000${row.path}\u0000${row.context ?? ''}`, row);
	return [...unique.values()].sort((left, right) => left.path.localeCompare(right.path)
		|| left.kind.localeCompare(right.kind) || (left.context ?? '').localeCompare(right.context ?? ''));
}
