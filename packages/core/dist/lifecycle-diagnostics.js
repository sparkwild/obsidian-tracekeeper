"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.diagnoseMemoryKnowledgeLifecycle = diagnoseMemoryKnowledgeLifecycle;
exports.buildLifecycleDoctorReport = buildLifecycleDoctorReport;
const node_path_1 = __importDefault(require("node:path"));
const knowledge_architecture_1 = require("./knowledge-architecture");
const memory_record_1 = require("./memory-record");
const memory_lifecycle_1 = require("./memory-lifecycle");
const DEFAULT_STALE_AFTER_DAYS = 365;
const DEFAULT_MAX_DIRECTORY_RECORDS = 1000;
const DEFAULT_MAX_SOURCE_PARTS = 16;
function diagnoseMemoryKnowledgeLifecycle(notes, options = {}) {
    return buildLifecycleDoctorReport(notes, options).issues;
}
function buildLifecycleDoctorReport(notes, options = {}) {
    const issues = [];
    const paths = new Map(notes.map((note) => [(0, knowledge_architecture_1.normalizeKnowledgePath)(note.relativePath).toLowerCase(), note]));
    const records = [];
    const legacy = [];
    for (const note of notes) {
        const notePath = (0, knowledge_architecture_1.normalizeKnowledgePath)(note.relativePath);
        if (!notePath)
            continue;
        const type = stringField(note, 'type');
        if (isLegacyMemoryNote(notePath, type)) {
            const projection = (0, memory_record_1.legacyMemoryToReadProjection)({
                path: notePath,
                scope: notePath.startsWith(`${knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`) ? 'project' : 'global',
                project_id: stringField(note, 'project_id') || inferLegacyProjectId(notePath),
            });
            if (projection.kind !== 'v2')
                legacy.push(projection);
            issues.push(issue('warning', 'memory_legacy_unkeyed', notePath, 'Legacy memory has no proven claim_key and remains excluded from automatic lifecycle resolution.'));
        }
        const isV2Candidate = type === 'memory_record'
            || ((0, knowledge_architecture_1.isKnowledgeMemoryPath)(notePath) && note.frontmatter.schema_version === 2);
        if (!isV2Candidate)
            continue;
        preflightMemoryFields(note, issues);
        try {
            const record = (0, memory_record_1.parseMemoryRecord)({ path: notePath, frontmatter: note.frontmatter });
            records.push(record);
            diagnoseRecordReferences(record, note, paths, issues);
        }
        catch (error) {
            issues.push(issue('error', 'memory_schema_invalid', notePath, error instanceof Error ? error.message : String(error)));
        }
    }
    const lifecycle = (0, memory_lifecycle_1.resolveMemoryLifecycle)({
        generation: 0,
        records,
        legacy,
        now: options.now,
        staleAfterDays: options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS,
    });
    for (const lifecycleIssue of lifecycle.issues) {
        const record = records.find((candidate) => lifecycleIssue.memory_ids.includes(candidate.memory_id));
        issues.push(lifecycleIssueToDiagnostic(lifecycleIssue.code, lifecycleIssue.message, record?.path ?? lifecycleIssue.memory_ids[0], lifecycleIssue.reference));
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
            contentHash: notes.find((note) => (0, knowledge_architecture_1.normalizeKnowledgePath)(note.relativePath) === row.projection.path)?.contentHash ?? '',
            scope: row.projection.scope,
            projectId: row.projection.project_id,
            suggestions: [],
        })),
    };
}
function preflightMemoryFields(note, issues) {
    const notePath = (0, knowledge_architecture_1.normalizeKnowledgePath)(note.relativePath);
    const claimKey = stringField(note, 'claim_key');
    if (!claimKey) {
        issues.push(issue('error', 'memory_claim_key_missing', notePath, 'MemoryRecord v2 requires a non-empty claim_key.'));
    }
    const evidence = listField(note, 'evidence');
    const scope = stringField(note, 'scope');
    if ((scope === 'global' && !stringField(note, 'global_hub'))
        || (scope === 'project' && !stringField(note, 'project_hub'))) {
        issues.push(issue('error', 'memory_hub_missing', notePath, `${scope || 'Memory'} record is missing its required Hub relation.`));
    }
    if (stringField(note, 'confidence_level') === 'verified' && evidence.length === 0) {
        issues.push(issue('error', 'memory_verified_without_evidence', notePath, 'Verified memory requires at least one evidence reference.'));
    }
    if (stringField(note, 'authority') === 'source' && evidence.length === 0) {
        issues.push(issue('warning', 'memory_authority_without_evidence', notePath, 'Source-authority memory should identify its source evidence.'));
    }
    const validFrom = timestampField(note, 'valid_from');
    const validTo = timestampField(note, 'valid_to');
    if ((fieldPresent(note, 'valid_from') && validFrom === null)
        || (fieldPresent(note, 'valid_to') && validTo === null)
        || (validFrom !== null && validTo !== null && validFrom > validTo)) {
        issues.push(issue('error', 'memory_temporal_invalid', notePath, 'Memory validity timestamps are invalid or valid_from is later than valid_to.'));
    }
}
function diagnoseRecordReferences(record, note, paths, issues) {
    for (const reference of record.evidence) {
        if (!resolvePath(reference, record.path, paths)) {
            issues.push(referenceIssue('warning', 'memory_evidence_unresolved', record.path, reference, `Memory evidence is unresolved: ${reference}`));
        }
    }
    for (const reference of record.related_sources) {
        const target = resolvePath(reference, record.path, paths);
        if (!target || !target.startsWith(`${knowledge_architecture_1.KNOWLEDGE_SOURCES_DIR}/`)) {
            issues.push(referenceIssue('warning', 'memory_related_source_unresolved', record.path, reference, `Related Source is missing, unresolved, or outside the Source owner: ${reference}`));
        }
        if (!hasVisibleBodyTarget(note, reference, record.path, paths)) {
            issues.push(referenceIssue('warning', 'memory_relation_body_parity', record.path, reference, `related_sources YAML relation is not represented by a visible body link: ${reference}`));
        }
    }
    const declaredSourcePaths = new Set(record.related_sources
        .map((reference) => resolvePath(reference, record.path, paths))
        .filter((value) => Boolean(value)));
    for (const edge of note.edges) {
        if (edge.source !== 'body')
            continue;
        const target = resolvePath(edge.target || edge.referenceLabel || edge.raw, record.path, paths);
        if (target?.startsWith(`${knowledge_architecture_1.KNOWLEDGE_SOURCES_DIR}/`) && !declaredSourcePaths.has(target)) {
            issues.push(referenceIssue('warning', 'memory_relation_body_parity', record.path, target, `Visible Source body link is missing from related_sources YAML: ${target}`));
        }
    }
    const hub = record.scope === 'global' ? record.global_hub : record.project_hub;
    if (!hub)
        return;
    if (!hasVisibleBodyTarget(note, hub, record.path, paths)) {
        issues.push(referenceIssue('warning', 'memory_relation_body_parity', record.path, hub, `Memory Hub YAML relation is not represented by a visible body link: ${hub}`));
    }
    const resolvedHub = resolvePath(hub, record.path, paths);
    if (!resolvedHub) {
        issues.push(referenceIssue('error', 'memory_hub_unresolved', record.path, hub, `Memory Hub is unresolved: ${hub}`));
        return;
    }
    const projectHubSuffix = resolvedHub.startsWith(`${knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)
        ? resolvedHub.slice(knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR.length + 1)
        : '';
    const validProjectHub = projectHubSuffix.split('/').length === 2 && projectHubSuffix.endsWith('/index.md');
    if ((record.scope === 'global' && resolvedHub !== knowledge_architecture_1.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH)
        || (record.scope === 'project' && !validProjectHub)) {
        issues.push(referenceIssue('error', 'memory_hub_scope_mismatch', record.path, resolvedHub, `Memory Hub does not match the record scope: ${resolvedHub}`));
    }
}
function diagnoseProjectHubParents(notes, paths, issues) {
    for (const note of notes) {
        const notePath = (0, knowledge_architecture_1.normalizeKnowledgePath)(note.relativePath);
        if (!notePath.startsWith(`${knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`) || !notePath.endsWith('/index.md'))
            continue;
        const suffix = notePath.slice(knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR.length + 1);
        if (suffix.split('/').length !== 2)
            continue;
        const parent = stringField(note, 'parent_hub');
        const resolvedParent = parent ? resolvePath(parent, notePath, paths) : null;
        if (resolvedParent !== knowledge_architecture_1.KNOWLEDGE_PROJECTS_INDEX_PATH) {
            issues.push(issue('warning', 'memory_project_hub_parent_missing', notePath, 'Project memory Hub must link to the projects index through parent_hub.'));
        }
        else if (!hasVisibleBodyTarget(note, parent, notePath, paths)) {
            issues.push(referenceIssue('warning', 'memory_relation_body_parity', notePath, parent, 'Project Hub parent_hub YAML relation is not represented by a visible body link.'));
        }
    }
}
function diagnoseSourceParts(notes, paths, maxSourceParts, issues) {
    if (!Number.isSafeInteger(maxSourceParts) || maxSourceParts < 1) {
        throw new Error('maxSourceParts must be a positive safe integer.');
    }
    const partsByParent = new Map();
    for (const note of notes) {
        if (stringField(note, 'type') !== 'source_capture')
            continue;
        const notePath = (0, knowledge_architecture_1.normalizeKnowledgePath)(note.relativePath);
        const manifest = listField(note, 'part_manifest');
        const resolvedParts = manifest
            .map((reference) => resolvePath(reference, notePath, paths))
            .filter((value) => Boolean(value));
        if (manifest.length > maxSourceParts || resolvedParts.length !== manifest.length
            || resolvedParts.some((partPath) => stringField(paths.get(partPath.toLowerCase()), 'type') !== 'source_part')) {
            issues.push(issue('error', 'source_part_manifest_invalid', notePath, `Source manifest contains missing, non-part, or over-limit entries (${manifest.length} declared part(s)).`, undefined, resolvedParts));
        }
    }
    for (const note of notes) {
        if (stringField(note, 'type') !== 'source_part')
            continue;
        const notePath = (0, knowledge_architecture_1.normalizeKnowledgePath)(note.relativePath);
        const parentRef = stringField(note, 'parent_source');
        const parentPath = parentRef ? resolvePath(parentRef, notePath, paths) : null;
        const parent = parentPath ? paths.get(parentPath.toLowerCase()) : undefined;
        if (!parentPath || stringField(parent, 'type') !== 'source_capture') {
            issues.push(issue('error', 'source_part_parent_unresolved', notePath, 'Source part has no resolvable parent_source.', parentRef));
            continue;
        }
        if (stringField(note, 'source_id') !== stringField(parent, 'source_id')) {
            issues.push(referenceIssue('error', 'source_part_identity_mismatch', notePath, parentPath, 'Source part source_id does not match its parent Source index.'));
        }
        const siblings = partsByParent.get(parentPath) ?? [];
        siblings.push(note);
        partsByParent.set(parentPath, siblings);
    }
    for (const [parentPath, parts] of partsByParent) {
        const parent = paths.get(parentPath.toLowerCase());
        const manifest = parent ? listField(parent, 'part_manifest') : [];
        const numbers = parts.map((part) => numberField(part, 'part_number')).filter((value) => value !== null);
        const declaredCounts = new Set(parts.map((part) => numberField(part, 'part_count')).filter((value) => value !== null));
        const actualPaths = new Set(parts.map((part) => (0, knowledge_architecture_1.normalizeKnowledgePath)(part.relativePath)));
        const manifestPaths = new Set(manifest.map((ref) => resolvePath(ref, parentPath, paths)).filter((value) => Boolean(value)));
        const completeSequence = numbers.length === parts.length
            && new Set(numbers).size === parts.length
            && [...numbers].sort((a, b) => a - b).every((value, index) => value === index + 1);
        if (parts.length > maxSourceParts || declaredCounts.size !== 1 || !declaredCounts.has(parts.length)
            || !completeSequence || !setsEqual(actualPaths, manifestPaths)) {
            issues.push(issue('error', 'source_part_manifest_invalid', parentPath, `Source part manifest/count/sequence is inconsistent (${parts.length} observed part(s)).`, undefined, [...actualPaths].sort()));
        }
    }
}
function diagnoseDirectoryGrowth(directoryCounts, maxDirectoryRecords, issues) {
    if (!Number.isSafeInteger(maxDirectoryRecords) || maxDirectoryRecords < 1) {
        throw new Error('maxDirectoryRecords must be a positive safe integer.');
    }
    for (const { directory, record_count: count } of directoryCounts) {
        if (count <= maxDirectoryRecords)
            continue;
        issues.push(issue('warning', 'storage_directory_growth', directory, `Directory contains ${count} lifecycle/source records; review this count in the separately authorized sharding task.`, String(count)));
    }
}
function collectDirectoryCounts(notes) {
    const counts = new Map();
    for (const note of notes) {
        const notePath = (0, knowledge_architecture_1.normalizeKnowledgePath)(note.relativePath);
        const type = stringField(note, 'type');
        if (type !== 'memory_record' && type !== 'source_capture' && type !== 'source_part')
            continue;
        const directory = node_path_1.default.posix.dirname(notePath);
        counts.set(directory, (counts.get(directory) ?? 0) + 1);
    }
    return [...counts].map(([directory, record_count]) => ({ directory, record_count }))
        .sort((left, right) => left.directory.localeCompare(right.directory));
}
function lifecycleIssueToDiagnostic(code, message, pathValue, reference) {
    const kinds = {
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
function resolvePath(raw, sourcePath, paths) {
    let value = raw.trim();
    const wikilink = value.match(/^\[\[(.*?)\]\]$/);
    if (wikilink)
        value = wikilink[1];
    value = value.split('|', 1)[0].split('#', 1)[0].replace(/\\/g, '/').trim();
    if (!value || /^(?:https?:|mailto:|file:|ftp:)/i.test(value))
        return null;
    if (value.startsWith('./') || value.startsWith('../'))
        value = node_path_1.default.posix.join(node_path_1.default.posix.dirname(sourcePath), value);
    value = (0, knowledge_architecture_1.normalizeKnowledgePath)(value.replace(/^\/+/, ''));
    const candidates = node_path_1.default.posix.extname(value) ? [value] : [`${value}.md`, value];
    for (const candidate of candidates)
        if (paths.has(candidate.toLowerCase()))
            return candidate;
    const basename = node_path_1.default.posix.basename(value).replace(/\.(?:md|markdown)$/i, '').toLowerCase();
    const matches = [...paths.keys()].filter((candidate) => node_path_1.default.posix.basename(candidate).replace(/\.(?:md|markdown)$/i, '') === basename);
    return matches.length === 1 ? (0, knowledge_architecture_1.normalizeKnowledgePath)(paths.get(matches[0])?.relativePath ?? '') : null;
}
function inferLegacyProjectId(notePath) {
    const suffix = notePath.slice(knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR.length + 1);
    return suffix.split('/', 1)[0] || null;
}
function isLegacyMemoryNote(notePath, type) {
    if (!(0, knowledge_architecture_1.isKnowledgeMemoryPath)(notePath) || isMemoryHub(notePath))
        return false;
    return type === 'memory' || type === 'project_memory_entry' || (!type && node_path_1.default.posix.basename(notePath) === 'memory.md');
}
function isMemoryHub(notePath) {
    return notePath.endsWith('/index.md') || notePath === `${node_path_1.default.posix.dirname(knowledge_architecture_1.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH)}/index.md`;
}
function fieldPresent(note, key) {
    return Object.prototype.hasOwnProperty.call(note.frontmatter, key);
}
function stringField(note, key) {
    const value = note?.frontmatter[key];
    return typeof value === 'string' ? value.trim() : '';
}
function listField(note, key) {
    const value = note.frontmatter[key];
    if (typeof value === 'string')
        return value.trim() ? [value.trim()] : [];
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : [];
}
function numberField(note, key) {
    const value = note.frontmatter[key];
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}
function timestampField(note, key) {
    const value = note.frontmatter[key];
    if (typeof value !== 'string' || !value.trim())
        return null;
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
}
function hasVisibleBodyTarget(note, reference, sourcePath, paths) {
    const expected = resolvePath(reference, sourcePath, paths);
    if (!expected)
        return false;
    return note.edges.some((edge) => edge.source === 'body'
        && resolvePath(edge.target || edge.referenceLabel || edge.raw, sourcePath, paths) === expected);
}
function referenceIssue(severity, kind, pathValue, reference, message) {
    return issue(severity, kind, pathValue, message, reference, [reference]);
}
function issue(severity, kind, pathValue, message, context, paths) {
    return { severity, kind, path: pathValue, line: 1, message, ...(context ? { context } : {}), ...(paths ? { paths } : {}) };
}
function setsEqual(left, right) {
    return left.size === right.size && [...left].every((value) => right.has(value));
}
function dedupeAndSort(issues) {
    const unique = new Map();
    for (const row of issues)
        unique.set(`${row.kind}\u0000${row.path}\u0000${row.context ?? ''}`, row);
    return [...unique.values()].sort((left, right) => left.path.localeCompare(right.path)
        || left.kind.localeCompare(right.kind) || (left.context ?? '').localeCompare(right.context ?? ''));
}
