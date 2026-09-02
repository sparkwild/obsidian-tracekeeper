import crypto from 'node:crypto';

import {
	ARCHIVE_ROOT,
	KNOWLEDGE_SOURCES_INDEX_PATH,
	KNOWLEDGE_WIKI_INDEX_PATH,
	isKnowledgeSourcePath,
	isKnowledgeWikiPath,
	normalizeKnowledgePath,
	startsWithPathPrefix,
} from './knowledge-architecture';
import type { KnowledgeCatalogEntry, KnowledgeReadView } from './knowledge-index';
import { parseMarkdown } from './markdown';
import { isSourcePartPath } from './wiki-governance';

export const MAINTENANCE_SNAPSHOT_VERSION = 1 as const;
export const SOURCE_ARCHIVE_PURGE_MAX_ITEMS = 100;
export const SOURCE_ARCHIVE_PURGE_MAX_BYTES = 256 * 1024 * 1024;

export type MaintenanceCandidateCategory =
	| 'wiki_role'
	| 'wiki_relation'
	| 'unassociated_source'
	| 'memory_lifecycle'
	| 'source_archive_purge';

export interface MaintenanceCandidateV1 {
	candidate_id: string;
	snapshot_generation: number;
	category: MaintenanceCandidateCategory;
	state: 'actionable' | 'informational' | 'blocked';
	risk: 'low' | 'medium' | 'high' | 'destructive';
	paths: string[];
	content_hashes: string[];
	dependencies: string[];
	reclaimable_bytes: number;
	reasons: string[];
	requestable: boolean;
}

export type MaintenanceRequestStatus = 'pending' | 'completed' | 'rejected' | 'stale';

export interface MaintenanceRequestCandidateV1 {
	candidate_id: string;
	category: MaintenanceCandidateCategory;
	state: MaintenanceCandidateV1['state'];
	risk: MaintenanceCandidateV1['risk'];
	paths: string[];
	content_hashes: string[];
	dependencies: string[];
	reasons: string[];
}

export interface MaintenanceRequestV1 {
	type: 'maintenance_request';
	schema_version: 1;
	request_id: string;
	status: MaintenanceRequestStatus;
	snapshot_generation: number;
	candidate_ids: string[];
	task_id: string | null;
	request_binding_hash: string;
	manifest_hash: string;
	candidate_manifest: MaintenanceRequestCandidateV1[];
	created_at: string;
}

export type MaintenanceRequestParseResult =
	| { valid: true; request: MaintenanceRequestV1 }
	| { valid: false; validationError: string };

export interface SourceArchiveEligibilityEvidenceV1 {
	verification_level?: 'metadata' | 'full';
	migration_id: string;
	archive_path: string;
	archive_content_hash: string;
	archive_bytes: number;
	replacement_part_path: string;
	replacement_part_hash: string;
	replacement_index_path: string;
	materialization_journal_completed: boolean;
	archive_journal_completed: boolean;
	archive_hash_matches_journal: boolean;
	unique_replacement: boolean;
	archive_body_occurrence_count: number;
	part_content_hash_matches: boolean;
	part_manifest_valid: boolean;
	output_hashes_valid: boolean;
	managed_relations_use_source_index: boolean;
	active_operation: boolean;
	unknown_target_occupancy: boolean;
	active_managed_archive_reference: boolean;
}

export interface MaintenanceSnapshotV1 {
	schema_version: typeof MAINTENANCE_SNAPSHOT_VERSION;
	generation: number;
	created_at: string;
	candidates: MaintenanceCandidateV1[];
	counts: Record<MaintenanceCandidateCategory, number>;
}

export interface BuildMaintenanceSnapshotOptions {
	sourceArchiveEvidence?: readonly SourceArchiveEligibilityEvidenceV1[];
	oldToNewParent?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
}

type CandidateInput = Omit<MaintenanceCandidateV1, 'candidate_id' | 'snapshot_generation'>;

function stableHash(value: unknown): string {
	return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function maintenanceRequestManifestHash(manifest: readonly MaintenanceRequestCandidateV1[]): string {
	return crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

export function maintenanceRequestBindingHash(input: {
	snapshot_generation: number;
	candidate_ids: readonly string[];
	task_id: string | null;
	manifest: readonly MaintenanceRequestCandidateV1[];
}): string {
	return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function maintenanceRequestManifest(
	candidates: readonly MaintenanceCandidateV1[],
): MaintenanceRequestCandidateV1[] {
	return candidates.map((item) => ({
		candidate_id: item.candidate_id,
		category: item.category,
		state: item.state,
		risk: item.risk,
		paths: [...item.paths],
		content_hashes: [...item.content_hashes],
		dependencies: [...item.dependencies],
		reasons: [...item.reasons],
	}));
}

const MAINTENANCE_CATEGORIES = new Set<MaintenanceCandidateCategory>([
	'wiki_role', 'wiki_relation', 'unassociated_source', 'memory_lifecycle', 'source_archive_purge',
]);
const MAINTENANCE_STATES = new Set<MaintenanceCandidateV1['state']>(['actionable', 'informational', 'blocked']);
const MAINTENANCE_RISKS = new Set<MaintenanceCandidateV1['risk']>(['low', 'medium', 'high', 'destructive']);
const MAINTENANCE_REQUEST_STATUSES = new Set<MaintenanceRequestStatus>(['pending', 'completed', 'rejected', 'stale']);

function nonEmptyStrings(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) return null;
	return value.map((item) => (item as string).trim());
}

function invalidMaintenanceRequest(validationError: string): MaintenanceRequestParseResult {
	return { valid: false, validationError };
}

/** Parses and verifies the complete on-disk MaintenanceRequest v1 contract. */
export function parseMaintenanceRequestMarkdown(content: string): MaintenanceRequestParseResult {
	const parsed = parseMarkdown(content);
	if (parsed.frontmatter.errors.length > 0) return invalidMaintenanceRequest('invalid_yaml');
	const fields = parsed.frontmatter.fields;
	if (fields.type !== 'maintenance_request') return invalidMaintenanceRequest('wrong_record_type');
	if (fields.schema_version !== 1) return invalidMaintenanceRequest('unsupported_schema_version');
	if (typeof fields.request_id !== 'string' || !/^maintenance-request-[a-f0-9]{24}$/u.test(fields.request_id)) {
		return invalidMaintenanceRequest('invalid_request_id');
	}
	if (typeof fields.status !== 'string' || !MAINTENANCE_REQUEST_STATUSES.has(fields.status as MaintenanceRequestStatus)) {
		return invalidMaintenanceRequest('invalid_status');
	}
	if (!Number.isSafeInteger(fields.snapshot_generation) || (fields.snapshot_generation as number) < 0) {
		return invalidMaintenanceRequest('invalid_snapshot_generation');
	}
	if (fields.task_id !== null && fields.task_id !== undefined && (typeof fields.task_id !== 'string' || !fields.task_id.trim())) {
		return invalidMaintenanceRequest('invalid_task_id');
	}
	const taskId = typeof fields.task_id === 'string' ? fields.task_id.trim() : null;
	const candidateIds = nonEmptyStrings(fields.candidate_ids);
	if (!candidateIds || candidateIds.length < 1 || candidateIds.length > 100 || new Set(candidateIds).size !== candidateIds.length) {
		return invalidMaintenanceRequest('invalid_candidate_ids');
	}
	if (candidateIds.some((id) => !/^maintenance_[a-f0-9]{24}$/u.test(id))) {
		return invalidMaintenanceRequest('invalid_candidate_id');
	}
	if (!Array.isArray(fields.candidate_manifest) || fields.candidate_manifest.length !== candidateIds.length) {
		return invalidMaintenanceRequest('invalid_candidate_manifest_count');
	}
	const manifest: MaintenanceRequestCandidateV1[] = [];
	for (const item of fields.candidate_manifest) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) return invalidMaintenanceRequest('invalid_candidate_manifest_item');
		const row = item as Record<string, unknown>;
		const paths = nonEmptyStrings(row.paths);
		const contentHashes = nonEmptyStrings(row.content_hashes) ?? (Array.isArray(row.content_hashes) && row.content_hashes.length === 0 ? [] : null);
		const dependencies = nonEmptyStrings(row.dependencies) ?? (Array.isArray(row.dependencies) && row.dependencies.length === 0 ? [] : null);
		const reasons = nonEmptyStrings(row.reasons);
		if (
			typeof row.candidate_id !== 'string'
			|| !/^maintenance_[a-f0-9]{24}$/u.test(row.candidate_id)
			|| typeof row.category !== 'string'
			|| !MAINTENANCE_CATEGORIES.has(row.category as MaintenanceCandidateCategory)
			|| typeof row.state !== 'string'
			|| !MAINTENANCE_STATES.has(row.state as MaintenanceCandidateV1['state'])
			|| typeof row.risk !== 'string'
			|| !MAINTENANCE_RISKS.has(row.risk as MaintenanceCandidateV1['risk'])
			|| !paths
			|| paths.some((value) => !isCanonicalSafePath(value))
			|| !contentHashes
			|| contentHashes.some((value) => !/^[a-f0-9]{64}$/u.test(value))
			|| !dependencies
			|| !reasons
		) return invalidMaintenanceRequest('invalid_candidate_manifest_item');
		manifest.push({
			candidate_id: row.candidate_id,
			category: row.category as MaintenanceCandidateCategory,
			state: row.state as MaintenanceCandidateV1['state'],
			risk: row.risk as MaintenanceCandidateV1['risk'],
			paths,
			content_hashes: contentHashes,
			dependencies,
			reasons,
		});
	}
	if (JSON.stringify(manifest.map((item) => item.candidate_id)) !== JSON.stringify(candidateIds)) {
		return invalidMaintenanceRequest('candidate_id_manifest_mismatch');
	}
	if (typeof fields.manifest_hash !== 'string' || maintenanceRequestManifestHash(manifest) !== fields.manifest_hash) {
		return invalidMaintenanceRequest('manifest_hash_mismatch');
	}
	if (
		typeof fields.request_binding_hash !== 'string'
		|| maintenanceRequestBindingHash({
			snapshot_generation: fields.snapshot_generation as number,
			candidate_ids: candidateIds,
			task_id: taskId,
			manifest,
		}) !== fields.request_binding_hash
	) return invalidMaintenanceRequest('request_binding_hash_mismatch');
	if (typeof fields.created_at !== 'string' || !Number.isFinite(Date.parse(fields.created_at))) {
		return invalidMaintenanceRequest('invalid_created_at');
	}
	return {
		valid: true,
		request: {
			type: 'maintenance_request',
			schema_version: 1,
			request_id: fields.request_id,
			status: fields.status as MaintenanceRequestStatus,
			snapshot_generation: fields.snapshot_generation as number,
			candidate_ids: candidateIds,
			task_id: taskId,
			request_binding_hash: fields.request_binding_hash,
			manifest_hash: fields.manifest_hash,
			candidate_manifest: manifest,
			created_at: fields.created_at,
		},
	};
}

function normalizedSorted(values: readonly string[]): string[] {
	return [...new Set(values.map(normalizeKnowledgePath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function isCanonicalSafePath(value: string): boolean {
	const normalized = normalizeKnowledgePath(value);
	return Boolean(normalized)
		&& normalized === value
		&& !normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..');
}

function candidate(generation: number, input: CandidateInput): MaintenanceCandidateV1 {
	const paths = normalizedSorted(input.paths);
	const contentHashes = [...new Set(input.content_hashes.filter(Boolean))].sort();
	const dependencies = [...new Set(input.dependencies.filter(Boolean))].sort();
	const reasons = [...new Set(input.reasons.filter(Boolean))].sort();
	const candidateId = `maintenance_${stableHash({
		schema: MAINTENANCE_SNAPSHOT_VERSION,
		generation,
		category: input.category,
		paths,
		contentHashes,
	}).slice(0, 24)}`;
	return {
		candidate_id: candidateId,
		snapshot_generation: generation,
		...input,
		paths,
		content_hashes: contentHashes,
		dependencies,
		reasons,
	};
}

function sourceArchiveCandidate(
	generation: number,
	evidence: SourceArchiveEligibilityEvidenceV1,
): MaintenanceCandidateV1 {
	const blockers: string[] = [];
	if (!startsWithPathPrefix(evidence.archive_path, `${ARCHIVE_ROOT}/source_migrations`)) blockers.push('archive_path_outside_source_migrations');
	if (
		!isCanonicalSafePath(evidence.archive_path)
		|| !isCanonicalSafePath(evidence.replacement_part_path)
		|| !isCanonicalSafePath(evidence.replacement_index_path)
	) blockers.push('unsafe_or_noncanonical_path');
	if (!evidence.materialization_journal_completed) blockers.push('materialization_journal_incomplete');
	if (!evidence.archive_journal_completed) blockers.push('archive_journal_incomplete');
	if (!evidence.unique_replacement) blockers.push('replacement_not_unique');
	if (!evidence.part_manifest_valid) blockers.push('part_manifest_invalid');
	if (!evidence.output_hashes_valid) blockers.push('output_hash_invalid');
	if (!evidence.managed_relations_use_source_index) blockers.push('managed_relation_not_repaired');
	if (evidence.active_operation) blockers.push('active_operation');
	if (evidence.unknown_target_occupancy) blockers.push('unknown_target_occupancy');
	if (evidence.active_managed_archive_reference) blockers.push('active_managed_archive_reference');
	const metadataOnly = evidence.verification_level === 'metadata';
	if (!metadataOnly) {
		if (!evidence.archive_hash_matches_journal) blockers.push('archive_hash_mismatch');
		if (evidence.archive_body_occurrence_count !== 1) blockers.push('archive_body_not_byte_exact_once');
		if (!evidence.part_content_hash_matches) blockers.push('part_content_hash_mismatch');
	}
	return candidate(generation, {
		category: 'source_archive_purge',
		state: blockers.length === 0 ? (metadataOnly ? 'informational' : 'actionable') : 'blocked',
		risk: 'destructive',
		paths: [evidence.archive_path, evidence.replacement_part_path, evidence.replacement_index_path],
		content_hashes: [evidence.archive_content_hash, evidence.replacement_part_hash],
		dependencies: [evidence.migration_id, evidence.replacement_part_path, evidence.replacement_index_path],
		reclaimable_bytes: blockers.length === 0 ? Math.max(0, evidence.archive_bytes) : 0,
		reasons: blockers.length === 0
			? [metadataOnly ? 'requires_authoritative_purge_preview' : 'byte_exact_redundant_source_archive']
			: blockers,
		requestable: blockers.length === 0,
	});
}

function relationTargetRole(view: KnowledgeReadView, path: string): 'root' | 'topic' | 'topic_map' | 'unknown' {
	const normalized = normalizeKnowledgePath(path);
	if (normalized === KNOWLEDGE_WIKI_INDEX_PATH) return 'root';
	return view.catalog.get(normalized)?.wikiRole ?? 'unknown';
}

function oldToNewEntries(
	value: BuildMaintenanceSnapshotOptions['oldToNewParent'],
): Array<[string, string]> {
	if (!value) return [];
	return value instanceof Map ? [...value.entries()] : Object.entries(value);
}

function memoryMaintenanceSuggestion(reason: string): string {
	if (reason === 'stale_verification') return 'suggest_reverify';
	if (reason === 'validity_ended') return 'suggest_create_successor';
	if (reason === 'declared_disputed' || reason === 'declared_review') return 'suggest_successor_supersedes_or_contradicts';
	if (reason.startsWith('dangling_') || reason === 'supersession_cycle' || reason === 'duplicate_current') {
		return 'suggest_review_lifecycle_relations';
	}
	return 'suggest_review_memory_lifecycle';
}

/**
 * Builds one deterministic maintenance projection from a single knowledge-index generation.
 * It does not read files, create proposals, mutate notes, or authorize destructive work.
 */
export function buildMaintenanceSnapshot(
	view: KnowledgeReadView,
	options: BuildMaintenanceSnapshotOptions = {},
): MaintenanceSnapshotV1 {
	const generation = view.generation;
	const candidates: MaintenanceCandidateV1[] = [];

	for (const entry of [...view.catalog.values()].sort((left, right) => left.path.localeCompare(right.path))) {
		if (!isKnowledgeWikiPath(entry.path)) continue;
		const role = entry.path === KNOWLEDGE_WIKI_INDEX_PATH ? 'root' : entry.wikiRole;
		if (entry.managedRelationsStatus === 'invalid') {
			candidates.push(candidate(generation, {
				category: 'wiki_relation', state: 'blocked', risk: 'high', paths: [entry.path],
				content_hashes: [entry.contentHash], dependencies: [], reclaimable_bytes: 0,
				reasons: ['managed_relation_block_invalid'], requestable: false,
			}));
			continue;
		}
		if (role === 'unknown') {
			candidates.push(candidate(generation, {
				category: 'wiki_role', state: 'informational', risk: 'medium', paths: [entry.path],
				content_hashes: [entry.contentHash], dependencies: [], reclaimable_bytes: 0,
				reasons: entry.managedRelationsSchemaVersion === 1
					? ['schema_1_role_unknown']
					: ['wiki_role_unknown'],
				requestable: false,
			}));
			continue;
		}
		if (role === 'root') {
			if (entry.wikiRole !== 'unknown') {
				candidates.push(candidate(generation, {
					category: 'wiki_role', state: 'blocked', risk: 'medium', paths: [entry.path],
					content_hashes: [entry.contentHash], dependencies: [], reclaimable_bytes: 0,
					reasons: ['wiki_root_has_non_root_managed_role'], requestable: false,
				}));
			}
			continue;
		}
		const parent = entry.managedParent;
		const parentRole = parent ? relationTargetRole(view, parent) : 'unknown';
		if (parent && view.catalog.has(parent) && parentRole === 'unknown') continue;
		const validParent = role === 'topic'
			? parentRole === 'topic_map'
			: parentRole === 'topic_map' || parentRole === 'root';
		if (!validParent) {
			candidates.push(candidate(generation, {
				category: 'wiki_relation', state: 'actionable', risk: parent ? 'medium' : 'low', paths: [entry.path],
				content_hashes: [entry.contentHash], dependencies: parent ? [parent] : [], reclaimable_bytes: 0,
				reasons: [parent ? `${role}_parent_role_invalid` : `${role}_parent_missing`], requestable: true,
			}));
		}
	}

	for (const entry of [...view.catalog.values()].sort((left, right) => left.path.localeCompare(right.path))) {
		if (!isKnowledgeSourcePath(entry.path) || entry.path === KNOWLEDGE_SOURCES_INDEX_PATH || isSourcePartPath(entry.path)) continue;
		if ((view.graph.incoming.get(entry.path) ?? []).length === 0) {
			candidates.push(candidate(generation, {
				category: 'unassociated_source', state: 'informational', risk: 'low', paths: [entry.path],
				content_hashes: [entry.contentHash], dependencies: [], reclaimable_bytes: 0,
				reasons: ['source_index_has_no_inbound_knowledge_relation'], requestable: true,
			}));
		}
	}

	const managedSourceReferrers = new Map<string, KnowledgeCatalogEntry[]>();
	for (const entry of view.catalog.values()) {
		for (const sourcePath of entry.managedSources ?? []) {
			const rows = managedSourceReferrers.get(sourcePath) ?? [];
			rows.push(entry);
			managedSourceReferrers.set(sourcePath, rows);
		}
	}
	for (const [oldPath, newParent] of oldToNewEntries(options.oldToNewParent)) {
		const oldNormalized = normalizeKnowledgePath(oldPath);
		const newNormalized = normalizeKnowledgePath(newParent);
		const referencing = managedSourceReferrers.get(oldNormalized) ?? [];
		for (const entry of referencing) {
			candidates.push(candidate(generation, {
				category: 'wiki_relation', state: 'actionable', risk: 'low', paths: [entry.path, oldNormalized, newNormalized],
				content_hashes: [entry.contentHash], dependencies: [newNormalized], reclaimable_bytes: 0,
				reasons: ['replace_legacy_source_relation_with_source_index'], requestable: true,
			}));
		}
	}

	const memoryById = new Map(view.memory.lifecycle.records.map((row) => [row.record.memory_id, row]));
	for (const issue of view.memory.lifecycle.issues) {
		const paths = issue.memory_ids.map((id) => memoryById.get(id)?.record.path ?? id);
		const hashes = paths.map((path) => view.catalog.get(path)?.contentHash ?? '');
		candidates.push(candidate(generation, {
			category: 'memory_lifecycle', state: 'informational', risk: 'medium', paths,
			content_hashes: hashes, dependencies: issue.reference ? [issue.reference] : [], reclaimable_bytes: 0,
			reasons: [issue.code, memoryMaintenanceSuggestion(issue.code)], requestable: true,
		}));
	}
	for (const row of view.memory.lifecycle.records) {
		const reasons = row.reasons.filter((reason) =>
			['validity_ended', 'declared_disputed', 'declared_review'].includes(reason)
		);
		if (reasons.length === 0) continue;
		candidates.push(candidate(generation, {
			category: 'memory_lifecycle', state: 'informational', risk: 'medium', paths: [row.record.path],
			content_hashes: [view.catalog.get(row.record.path)?.contentHash ?? ''], dependencies: [], reclaimable_bytes: 0,
			reasons: [...reasons, ...reasons.map(memoryMaintenanceSuggestion)], requestable: true,
		}));
	}

	for (const evidence of options.sourceArchiveEvidence ?? []) {
		candidates.push(sourceArchiveCandidate(generation, evidence));
	}

	const deduped = new Map<string, MaintenanceCandidateV1>();
	const stateRank = { informational: 0, actionable: 1, blocked: 2 } as const;
	const riskRank = { low: 0, medium: 1, high: 2, destructive: 3 } as const;
	for (const item of candidates) {
		const existing = deduped.get(item.candidate_id);
		if (!existing) {
			deduped.set(item.candidate_id, item);
			continue;
		}
		deduped.set(item.candidate_id, {
			...existing,
			state: stateRank[item.state] > stateRank[existing.state] ? item.state : existing.state,
			risk: riskRank[item.risk] > riskRank[existing.risk] ? item.risk : existing.risk,
			dependencies: [...new Set([...existing.dependencies, ...item.dependencies])].sort(),
			reasons: [...new Set([...existing.reasons, ...item.reasons])].sort(),
			reclaimable_bytes: Math.max(existing.reclaimable_bytes, item.reclaimable_bytes),
			requestable: existing.requestable && item.requestable,
		});
	}
	const ordered = [...deduped.values()].sort((left, right) =>
		left.category.localeCompare(right.category)
		|| left.state.localeCompare(right.state)
		|| left.paths.join('\0').localeCompare(right.paths.join('\0'))
		|| left.candidate_id.localeCompare(right.candidate_id)
	);
	const counts: MaintenanceSnapshotV1['counts'] = {
		wiki_role: 0,
		wiki_relation: 0,
		unassociated_source: 0,
		memory_lifecycle: 0,
		source_archive_purge: 0,
	};
	for (const item of ordered) counts[item.category] += 1;
	return {
		schema_version: MAINTENANCE_SNAPSHOT_VERSION,
		generation,
		created_at: view.createdAt,
		candidates: ordered,
		counts,
	};
}

export interface MaintenanceCursorV1 {
	version: 1;
	generation: number;
	profile: string;
	page_size: number;
	offset: number;
}

export function encodeMaintenanceCursor(cursor: MaintenanceCursorV1): string {
	const payload = JSON.stringify(cursor);
	const checksum = stableHash(payload).slice(0, 16);
	return Buffer.from(JSON.stringify({ payload, checksum }), 'utf8').toString('base64url');
}

export function decodeMaintenanceCursor(value: string): MaintenanceCursorV1 {
	let container: { payload?: unknown; checksum?: unknown };
	try {
		container = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as typeof container;
	} catch {
		throw new Error('Maintenance cursor is invalid.');
	}
	if (typeof container.payload !== 'string' || container.checksum !== stableHash(container.payload).slice(0, 16)) {
		throw new Error('Maintenance cursor checksum is invalid.');
	}
	const cursor = JSON.parse(container.payload) as MaintenanceCursorV1;
	if (
		cursor.version !== 1
		|| !Number.isSafeInteger(cursor.generation)
		|| typeof cursor.profile !== 'string'
		|| !Number.isSafeInteger(cursor.page_size)
		|| cursor.page_size < 1
		|| !Number.isSafeInteger(cursor.offset)
		|| cursor.offset < 0
	) throw new Error('Maintenance cursor is invalid.');
	return cursor;
}
