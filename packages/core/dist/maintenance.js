"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOURCE_ARCHIVE_PURGE_MAX_BYTES = exports.SOURCE_ARCHIVE_PURGE_MAX_ITEMS = exports.MAINTENANCE_SNAPSHOT_VERSION = void 0;
exports.maintenanceRequestManifestHash = maintenanceRequestManifestHash;
exports.maintenanceRequestBindingHash = maintenanceRequestBindingHash;
exports.maintenanceRequestManifest = maintenanceRequestManifest;
exports.parseMaintenanceRequestMarkdown = parseMaintenanceRequestMarkdown;
exports.buildMaintenanceSnapshot = buildMaintenanceSnapshot;
exports.encodeMaintenanceCursor = encodeMaintenanceCursor;
exports.decodeMaintenanceCursor = decodeMaintenanceCursor;
const node_crypto_1 = __importDefault(require("node:crypto"));
const knowledge_architecture_1 = require("./knowledge-architecture");
const markdown_1 = require("./markdown");
const wiki_governance_1 = require("./wiki-governance");
exports.MAINTENANCE_SNAPSHOT_VERSION = 1;
exports.SOURCE_ARCHIVE_PURGE_MAX_ITEMS = 100;
exports.SOURCE_ARCHIVE_PURGE_MAX_BYTES = 256 * 1024 * 1024;
function stableHash(value) {
    return node_crypto_1.default.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function maintenanceRequestManifestHash(manifest) {
    return node_crypto_1.default.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}
function maintenanceRequestBindingHash(input) {
    return node_crypto_1.default.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
function maintenanceRequestManifest(candidates) {
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
const MAINTENANCE_CATEGORIES = new Set([
    'wiki_role', 'wiki_relation', 'unassociated_source', 'memory_lifecycle', 'source_archive_purge',
]);
const MAINTENANCE_STATES = new Set(['actionable', 'informational', 'blocked']);
const MAINTENANCE_RISKS = new Set(['low', 'medium', 'high', 'destructive']);
const MAINTENANCE_REQUEST_STATUSES = new Set(['pending', 'completed', 'rejected', 'stale']);
function nonEmptyStrings(value) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim()))
        return null;
    return value.map((item) => item.trim());
}
function invalidMaintenanceRequest(validationError) {
    return { valid: false, validationError };
}
/** Parses and verifies the complete on-disk MaintenanceRequest v1 contract. */
function parseMaintenanceRequestMarkdown(content) {
    const parsed = (0, markdown_1.parseMarkdown)(content);
    if (parsed.frontmatter.errors.length > 0)
        return invalidMaintenanceRequest('invalid_yaml');
    const fields = parsed.frontmatter.fields;
    if (fields.type !== 'maintenance_request')
        return invalidMaintenanceRequest('wrong_record_type');
    if (fields.schema_version !== 1)
        return invalidMaintenanceRequest('unsupported_schema_version');
    if (typeof fields.request_id !== 'string' || !/^maintenance-request-[a-f0-9]{24}$/u.test(fields.request_id)) {
        return invalidMaintenanceRequest('invalid_request_id');
    }
    if (typeof fields.status !== 'string' || !MAINTENANCE_REQUEST_STATUSES.has(fields.status)) {
        return invalidMaintenanceRequest('invalid_status');
    }
    if (!Number.isSafeInteger(fields.snapshot_generation) || fields.snapshot_generation < 0) {
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
    const manifest = [];
    for (const item of fields.candidate_manifest) {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            return invalidMaintenanceRequest('invalid_candidate_manifest_item');
        const row = item;
        const paths = nonEmptyStrings(row.paths);
        const contentHashes = nonEmptyStrings(row.content_hashes) ?? (Array.isArray(row.content_hashes) && row.content_hashes.length === 0 ? [] : null);
        const dependencies = nonEmptyStrings(row.dependencies) ?? (Array.isArray(row.dependencies) && row.dependencies.length === 0 ? [] : null);
        const reasons = nonEmptyStrings(row.reasons);
        if (typeof row.candidate_id !== 'string'
            || !/^maintenance_[a-f0-9]{24}$/u.test(row.candidate_id)
            || typeof row.category !== 'string'
            || !MAINTENANCE_CATEGORIES.has(row.category)
            || typeof row.state !== 'string'
            || !MAINTENANCE_STATES.has(row.state)
            || typeof row.risk !== 'string'
            || !MAINTENANCE_RISKS.has(row.risk)
            || !paths
            || paths.some((value) => !isCanonicalSafePath(value))
            || !contentHashes
            || contentHashes.some((value) => !/^[a-f0-9]{64}$/u.test(value))
            || !dependencies
            || !reasons)
            return invalidMaintenanceRequest('invalid_candidate_manifest_item');
        manifest.push({
            candidate_id: row.candidate_id,
            category: row.category,
            state: row.state,
            risk: row.risk,
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
    if (typeof fields.request_binding_hash !== 'string'
        || maintenanceRequestBindingHash({
            snapshot_generation: fields.snapshot_generation,
            candidate_ids: candidateIds,
            task_id: taskId,
            manifest,
        }) !== fields.request_binding_hash)
        return invalidMaintenanceRequest('request_binding_hash_mismatch');
    if (typeof fields.created_at !== 'string' || !Number.isFinite(Date.parse(fields.created_at))) {
        return invalidMaintenanceRequest('invalid_created_at');
    }
    return {
        valid: true,
        request: {
            type: 'maintenance_request',
            schema_version: 1,
            request_id: fields.request_id,
            status: fields.status,
            snapshot_generation: fields.snapshot_generation,
            candidate_ids: candidateIds,
            task_id: taskId,
            request_binding_hash: fields.request_binding_hash,
            manifest_hash: fields.manifest_hash,
            candidate_manifest: manifest,
            created_at: fields.created_at,
        },
    };
}
function normalizedSorted(values) {
    return [...new Set(values.map(knowledge_architecture_1.normalizeKnowledgePath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function isCanonicalSafePath(value) {
    const normalized = (0, knowledge_architecture_1.normalizeKnowledgePath)(value);
    return Boolean(normalized)
        && normalized === value
        && !normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..');
}
function candidate(generation, input) {
    const paths = normalizedSorted(input.paths);
    const contentHashes = [...new Set(input.content_hashes.filter(Boolean))].sort();
    const dependencies = [...new Set(input.dependencies.filter(Boolean))].sort();
    const reasons = [...new Set(input.reasons.filter(Boolean))].sort();
    const candidateId = `maintenance_${stableHash({
        schema: exports.MAINTENANCE_SNAPSHOT_VERSION,
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
function sourceArchiveCandidate(generation, evidence) {
    const blockers = [];
    if (!(0, knowledge_architecture_1.startsWithPathPrefix)(evidence.archive_path, `${knowledge_architecture_1.ARCHIVE_ROOT}/source_migrations`))
        blockers.push('archive_path_outside_source_migrations');
    if (!isCanonicalSafePath(evidence.archive_path)
        || !isCanonicalSafePath(evidence.replacement_part_path)
        || !isCanonicalSafePath(evidence.replacement_index_path))
        blockers.push('unsafe_or_noncanonical_path');
    if (!evidence.materialization_journal_completed)
        blockers.push('materialization_journal_incomplete');
    if (!evidence.archive_journal_completed)
        blockers.push('archive_journal_incomplete');
    if (!evidence.unique_replacement)
        blockers.push('replacement_not_unique');
    if (!evidence.part_manifest_valid)
        blockers.push('part_manifest_invalid');
    if (!evidence.output_hashes_valid)
        blockers.push('output_hash_invalid');
    if (!evidence.managed_relations_use_source_index)
        blockers.push('managed_relation_not_repaired');
    if (evidence.active_operation)
        blockers.push('active_operation');
    if (evidence.unknown_target_occupancy)
        blockers.push('unknown_target_occupancy');
    if (evidence.active_managed_archive_reference)
        blockers.push('active_managed_archive_reference');
    const metadataOnly = evidence.verification_level === 'metadata';
    if (!metadataOnly) {
        if (!evidence.archive_hash_matches_journal)
            blockers.push('archive_hash_mismatch');
        if (evidence.archive_body_occurrence_count !== 1)
            blockers.push('archive_body_not_byte_exact_once');
        if (!evidence.part_content_hash_matches)
            blockers.push('part_content_hash_mismatch');
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
function relationTargetRole(view, path) {
    const normalized = (0, knowledge_architecture_1.normalizeKnowledgePath)(path);
    if (normalized === knowledge_architecture_1.KNOWLEDGE_WIKI_INDEX_PATH)
        return 'root';
    return view.catalog.get(normalized)?.wikiRole ?? 'unknown';
}
function oldToNewEntries(value) {
    if (!value)
        return [];
    return value instanceof Map ? [...value.entries()] : Object.entries(value);
}
function memoryMaintenanceSuggestion(reason) {
    if (reason === 'stale_verification')
        return 'suggest_reverify';
    if (reason === 'validity_ended')
        return 'suggest_create_successor';
    if (reason === 'declared_disputed' || reason === 'declared_review')
        return 'suggest_successor_supersedes_or_contradicts';
    if (reason.startsWith('dangling_') || reason === 'supersession_cycle' || reason === 'duplicate_current') {
        return 'suggest_review_lifecycle_relations';
    }
    return 'suggest_review_memory_lifecycle';
}
/**
 * Builds one deterministic maintenance projection from a single knowledge-index generation.
 * It does not read files, create proposals, mutate notes, or authorize destructive work.
 */
function buildMaintenanceSnapshot(view, options = {}) {
    const generation = view.generation;
    const candidates = [];
    for (const entry of [...view.catalog.values()].sort((left, right) => left.path.localeCompare(right.path))) {
        if (!(0, knowledge_architecture_1.isKnowledgeWikiPath)(entry.path))
            continue;
        const role = entry.path === knowledge_architecture_1.KNOWLEDGE_WIKI_INDEX_PATH ? 'root' : entry.wikiRole;
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
        if (parent && view.catalog.has(parent) && parentRole === 'unknown')
            continue;
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
        if (!(0, knowledge_architecture_1.isKnowledgeSourcePath)(entry.path) || entry.path === knowledge_architecture_1.KNOWLEDGE_SOURCES_INDEX_PATH || (0, wiki_governance_1.isSourcePartPath)(entry.path))
            continue;
        if ((view.graph.incoming.get(entry.path) ?? []).length === 0) {
            candidates.push(candidate(generation, {
                category: 'unassociated_source', state: 'informational', risk: 'low', paths: [entry.path],
                content_hashes: [entry.contentHash], dependencies: [], reclaimable_bytes: 0,
                reasons: ['source_index_has_no_inbound_knowledge_relation'], requestable: true,
            }));
        }
    }
    const managedSourceReferrers = new Map();
    for (const entry of view.catalog.values()) {
        for (const sourcePath of entry.managedSources ?? []) {
            const rows = managedSourceReferrers.get(sourcePath) ?? [];
            rows.push(entry);
            managedSourceReferrers.set(sourcePath, rows);
        }
    }
    for (const [oldPath, newParent] of oldToNewEntries(options.oldToNewParent)) {
        const oldNormalized = (0, knowledge_architecture_1.normalizeKnowledgePath)(oldPath);
        const newNormalized = (0, knowledge_architecture_1.normalizeKnowledgePath)(newParent);
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
        const reasons = row.reasons.filter((reason) => ['validity_ended', 'declared_disputed', 'declared_review'].includes(reason));
        if (reasons.length === 0)
            continue;
        candidates.push(candidate(generation, {
            category: 'memory_lifecycle', state: 'informational', risk: 'medium', paths: [row.record.path],
            content_hashes: [view.catalog.get(row.record.path)?.contentHash ?? ''], dependencies: [], reclaimable_bytes: 0,
            reasons: [...reasons, ...reasons.map(memoryMaintenanceSuggestion)], requestable: true,
        }));
    }
    for (const evidence of options.sourceArchiveEvidence ?? []) {
        candidates.push(sourceArchiveCandidate(generation, evidence));
    }
    const deduped = new Map();
    const stateRank = { informational: 0, actionable: 1, blocked: 2 };
    const riskRank = { low: 0, medium: 1, high: 2, destructive: 3 };
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
    const ordered = [...deduped.values()].sort((left, right) => left.category.localeCompare(right.category)
        || left.state.localeCompare(right.state)
        || left.paths.join('\0').localeCompare(right.paths.join('\0'))
        || left.candidate_id.localeCompare(right.candidate_id));
    const counts = {
        wiki_role: 0,
        wiki_relation: 0,
        unassociated_source: 0,
        memory_lifecycle: 0,
        source_archive_purge: 0,
    };
    for (const item of ordered)
        counts[item.category] += 1;
    return {
        schema_version: exports.MAINTENANCE_SNAPSHOT_VERSION,
        generation,
        created_at: view.createdAt,
        candidates: ordered,
        counts,
    };
}
function encodeMaintenanceCursor(cursor) {
    const payload = JSON.stringify(cursor);
    const checksum = stableHash(payload).slice(0, 16);
    return Buffer.from(JSON.stringify({ payload, checksum }), 'utf8').toString('base64url');
}
function decodeMaintenanceCursor(value) {
    let container;
    try {
        container = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    }
    catch {
        throw new Error('Maintenance cursor is invalid.');
    }
    if (typeof container.payload !== 'string' || container.checksum !== stableHash(container.payload).slice(0, 16)) {
        throw new Error('Maintenance cursor checksum is invalid.');
    }
    const cursor = JSON.parse(container.payload);
    if (cursor.version !== 1
        || !Number.isSafeInteger(cursor.generation)
        || typeof cursor.profile !== 'string'
        || !Number.isSafeInteger(cursor.page_size)
        || cursor.page_size < 1
        || !Number.isSafeInteger(cursor.offset)
        || cursor.offset < 0)
        throw new Error('Maintenance cursor is invalid.');
    return cursor;
}
