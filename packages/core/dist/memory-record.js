"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryRecordValidationError = exports.MEMORY_RECORD_TYPE = exports.MEMORY_RECORD_SCHEMA_VERSION = void 0;
exports.buildGlobalMemoryEntryPath = buildGlobalMemoryEntryPath;
exports.parseMemoryRecord = parseMemoryRecord;
exports.buildMemoryRecord = buildMemoryRecord;
exports.renderMemoryRecordMarkdown = renderMemoryRecordMarkdown;
exports.projectMemoryEntryToReadProjection = projectMemoryEntryToReadProjection;
exports.legacyMemoryToReadProjection = legacyMemoryToReadProjection;
const yaml_1 = require("yaml");
const knowledge_note_1 = require("./knowledge-note");
const knowledge_architecture_1 = require("./knowledge-architecture");
exports.MEMORY_RECORD_SCHEMA_VERSION = 2;
exports.MEMORY_RECORD_TYPE = 'memory_record';
class MemoryRecordValidationError extends Error {
    constructor(message) {
        super(message);
        this.code = 'invalid_memory_record';
        this.name = 'MemoryRecordValidationError';
    }
}
exports.MemoryRecordValidationError = MemoryRecordValidationError;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const AGENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MEMORY_KIND_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const AUTHORITIES = new Set(['agent', 'source', 'user']);
const CONFIDENCE_LEVELS = new Set([
    'uncertain',
    'inferred',
    'supported',
    'verified',
]);
const DECLARED_STATES = new Set([
    'active',
    'disputed',
    'retracted',
    'review',
]);
function buildGlobalMemoryEntryPath(input) {
    const agentType = requirePathIdentity(input.agentType, 'agentType', AGENT_TYPE_PATTERN);
    const operationKind = requirePathIdentity(input.operationKind, 'operationKind', MEMORY_KIND_PATTERN);
    const operationId = requirePathIdentity(input.operationId, 'operationId', OPERATION_ID_PATTERN);
    return (0, knowledge_note_1.normalizeVaultRelativePath)(`${knowledge_architecture_1.KNOWLEDGE_GLOBAL_MEMORY_DIR}/agents/${agentType}/${operationKind}-${operationId}.md`);
}
function parseMemoryRecord(source) {
    const path = normalizePath(source.path, 'path');
    const frontmatter = requireObject(source.frontmatter, 'frontmatter');
    if (frontmatter.schema_version !== exports.MEMORY_RECORD_SCHEMA_VERSION) {
        throw new MemoryRecordValidationError(`memory record schema_version must be ${exports.MEMORY_RECORD_SCHEMA_VERSION}.`);
    }
    if (frontmatter.type !== exports.MEMORY_RECORD_TYPE) {
        throw new MemoryRecordValidationError(`memory record type must be ${exports.MEMORY_RECORD_TYPE}.`);
    }
    const scope = requireEnum(frontmatter.scope, 'scope', new Set(['global', 'project']));
    const projectId = optionalPattern(frontmatter.project_id, 'project_id', PROJECT_ID_PATTERN);
    if (scope === 'project' && !projectId) {
        throw new MemoryRecordValidationError('project_id is required for project memory.');
    }
    if (scope === 'global' && projectId) {
        throw new MemoryRecordValidationError('project_id is not allowed for global memory.');
    }
    const evidence = normalizeVaultLinkList(frontmatter.evidence, 'evidence');
    const confidence = requireEnum(frontmatter.confidence_level, 'confidence_level', CONFIDENCE_LEVELS);
    if (confidence === 'verified' && evidence.length === 0) {
        throw new MemoryRecordValidationError('verified memory requires at least one evidence reference.');
    }
    const validFrom = optionalTimestamp(frontmatter.valid_from, 'valid_from');
    const validTo = optionalTimestamp(frontmatter.valid_to, 'valid_to');
    if (validFrom && validTo && Date.parse(validFrom) > Date.parse(validTo)) {
        throw new MemoryRecordValidationError('valid_from must not be later than valid_to.');
    }
    const projectHub = optionalVaultLink(frontmatter.project_hub, 'project_hub');
    const globalHub = optionalVaultLink(frontmatter.global_hub, 'global_hub');
    if (scope === 'project' && !projectHub) {
        throw new MemoryRecordValidationError('project_hub is required for project memory.');
    }
    if (scope === 'global' && !globalHub) {
        throw new MemoryRecordValidationError('global_hub is required for global memory.');
    }
    return {
        schema_version: exports.MEMORY_RECORD_SCHEMA_VERSION,
        type: exports.MEMORY_RECORD_TYPE,
        path,
        memory_id: requirePattern(frontmatter.memory_id, 'memory_id', STABLE_ID_PATTERN),
        scope,
        project_id: projectId,
        agent_type: requirePattern(frontmatter.agent_type, 'agent_type', AGENT_TYPE_PATTERN),
        operation_id: requirePattern(frontmatter.operation_id, 'operation_id', STABLE_ID_PATTERN),
        memory_kind: requirePattern(frontmatter.memory_kind, 'memory_kind', MEMORY_KIND_PATTERN),
        claim_key: normalizeClaimKey(frontmatter.claim_key),
        authority: requireEnum(frontmatter.authority, 'authority', AUTHORITIES),
        confidence_level: confidence,
        declared_state: requireEnum(frontmatter.declared_state, 'declared_state', DECLARED_STATES),
        observed_at: requireTimestamp(frontmatter.observed_at, 'observed_at'),
        valid_from: validFrom,
        valid_to: validTo,
        last_verified_at: optionalTimestamp(frontmatter.last_verified_at, 'last_verified_at'),
        evidence,
        supersedes: normalizeStableIdList(frontmatter.supersedes, 'supersedes'),
        contradicts: normalizeStableIdList(frontmatter.contradicts, 'contradicts'),
        project_hub: projectHub,
        global_hub: globalHub,
        related_wiki: normalizeVaultLinkList(frontmatter.related_wiki, 'related_wiki'),
        related_sources: normalizeVaultLinkList(frontmatter.related_sources, 'related_sources'),
    };
}
function buildMemoryRecord(input) {
    if (typeof input.body !== 'string') {
        throw new MemoryRecordValidationError('body must be a string.');
    }
    const body = input.body.replace(/\r\n?/g, '\n').trim();
    if (!body) {
        throw new MemoryRecordValidationError('body must not be empty.');
    }
    const record = parseMemoryRecord({
        path: input.path,
        frontmatter: {
            schema_version: exports.MEMORY_RECORD_SCHEMA_VERSION,
            type: exports.MEMORY_RECORD_TYPE,
            memory_id: input.memory_id,
            scope: input.scope,
            project_id: input.project_id,
            agent_type: input.agent_type,
            operation_id: input.operation_id,
            memory_kind: input.memory_kind,
            claim_key: input.claim_key,
            authority: input.authority,
            confidence_level: input.confidence_level,
            declared_state: input.declared_state,
            observed_at: input.observed_at,
            valid_from: input.valid_from,
            valid_to: input.valid_to,
            last_verified_at: input.last_verified_at,
            evidence: input.evidence,
            supersedes: input.supersedes,
            contradicts: input.contradicts,
            project_hub: input.project_hub,
            global_hub: input.global_hub,
            related_wiki: input.related_wiki,
            related_sources: input.related_sources,
        },
    });
    return { record, body, markdown: renderMemoryRecordMarkdown(record, body) };
}
function renderMemoryRecordMarkdown(record, body) {
    const normalized = parseMemoryRecord({ path: record.path, frontmatter: { ...record } });
    const normalizedBody = typeof body === 'string' ? body.replace(/\r\n?/g, '\n').trim() : '';
    if (!normalizedBody) {
        throw new MemoryRecordValidationError('body must not be empty.');
    }
    const frontmatter = {
        schema_version: normalized.schema_version,
        type: normalized.type,
        memory_id: normalized.memory_id,
        scope: normalized.scope,
        ...(normalized.project_id ? { project_id: normalized.project_id } : {}),
        agent_type: normalized.agent_type,
        operation_id: normalized.operation_id,
        memory_kind: normalized.memory_kind,
        claim_key: normalized.claim_key,
        authority: normalized.authority,
        confidence_level: normalized.confidence_level,
        declared_state: normalized.declared_state,
        observed_at: normalized.observed_at,
        ...(normalized.valid_from ? { valid_from: normalized.valid_from } : {}),
        ...(normalized.valid_to ? { valid_to: normalized.valid_to } : {}),
        ...(normalized.last_verified_at ? { last_verified_at: normalized.last_verified_at } : {}),
        evidence: [...normalized.evidence],
        supersedes: [...normalized.supersedes],
        contradicts: [...normalized.contradicts],
        ...(normalized.project_hub ? { project_hub: normalized.project_hub } : {}),
        ...(normalized.global_hub ? { global_hub: normalized.global_hub } : {}),
        related_wiki: [...normalized.related_wiki],
        related_sources: [...normalized.related_sources],
    };
    return `---\n${(0, yaml_1.stringify)(frontmatter).trimEnd()}\n---\n\n${normalizedBody}\n`;
}
function projectMemoryEntryToReadProjection(entry) {
    return {
        kind: 'project_v1',
        legacy: true,
        path: normalizePath(entry.path, 'path'),
        scope: 'project',
        project_id: entry.project_id,
        operation_id: entry.operation_id,
        claim_key: null,
        declared_state: projectStatusToDeclaredState(entry.status),
        observed_at: entry.created_at,
    };
}
function legacyMemoryToReadProjection(input) {
    const scope = input.scope ?? (input.project_id ? 'project' : 'global');
    const projectId = optionalPattern(input.project_id, 'project_id', PROJECT_ID_PATTERN);
    if (scope === 'project' && !projectId) {
        throw new MemoryRecordValidationError('project_id is required for a project legacy projection.');
    }
    return {
        kind: 'legacy_unkeyed',
        legacy: true,
        path: normalizePath(input.path, 'path'),
        scope,
        project_id: scope === 'project' ? projectId : null,
        claim_key: null,
    };
}
function projectStatusToDeclaredState(status) {
    if (status === 'disputed')
        return 'disputed';
    if (status === 'review')
        return 'review';
    return 'active';
}
function requirePathIdentity(value, field, pattern) {
    if (typeof value !== 'string' || !pattern.test(value)) {
        throw new MemoryRecordValidationError(`${field} is invalid.`);
    }
    return value;
}
function normalizeClaimKey(value) {
    if (typeof value !== 'string') {
        throw new MemoryRecordValidationError('claim_key must be a string.');
    }
    const canonical = value.normalize('NFC');
    if (hasControlCharacter(canonical)) {
        throw new MemoryRecordValidationError('claim_key is empty, too long, or contains control characters.');
    }
    const normalized = canonical.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
    if (!normalized || normalized.length > 240) {
        throw new MemoryRecordValidationError('claim_key is empty, too long, or contains control characters.');
    }
    return normalized;
}
function hasControlCharacter(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x1f || code === 0x7f) {
            return true;
        }
    }
    return false;
}
function requireObject(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new MemoryRecordValidationError(`${field} must be an object.`);
    }
    return value;
}
function requirePattern(value, field, pattern) {
    if (typeof value !== 'string' || !pattern.test(value.trim())) {
        throw new MemoryRecordValidationError(`${field} is invalid.`);
    }
    return value.trim();
}
function optionalPattern(value, field, pattern) {
    if (value === undefined || value === null || value === '')
        return null;
    return requirePattern(value, field, pattern);
}
function requireEnum(value, field, allowed) {
    if (typeof value !== 'string' || !allowed.has(value)) {
        throw new MemoryRecordValidationError(`${field} is invalid.`);
    }
    return value;
}
function requireTimestamp(value, field) {
    if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) {
        throw new MemoryRecordValidationError(`${field} must be a valid timestamp.`);
    }
    return new Date(value).toISOString();
}
function optionalTimestamp(value, field) {
    if (value === undefined || value === null || value === '')
        return null;
    return requireTimestamp(value, field);
}
function normalizeStableIdList(value, field) {
    return normalizeList(value, field, (item) => requirePattern(item, field, STABLE_ID_PATTERN));
}
function normalizeVaultLinkList(value, field) {
    return normalizeList(value, field, (item) => normalizeVaultLink(item, field));
}
function normalizeList(value, field, normalize) {
    if (value === undefined || value === null || value === '')
        return [];
    const values = Array.isArray(value) ? value : [value];
    const result = [];
    const seen = new Set();
    for (const item of values) {
        const normalized = normalize(item);
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }
    return result;
}
function optionalVaultLink(value, field) {
    if (value === undefined || value === null || value === '')
        return null;
    return normalizeVaultLink(value, field);
}
function normalizeVaultLink(value, field) {
    if (typeof value !== 'string') {
        throw new MemoryRecordValidationError(`${field} must contain Vault-relative references.`);
    }
    const raw = value.trim();
    const wikilink = raw.match(/^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/u);
    const path = normalizePath(wikilink ? wikilink[1] : raw, field).replace(/\.md$/iu, '');
    return `[[${path}]]`;
}
function normalizePath(value, field) {
    if (typeof value !== 'string') {
        throw new MemoryRecordValidationError(`${field} must be a Vault-relative path.`);
    }
    try {
        return (0, knowledge_note_1.normalizeVaultRelativePath)(value.trim());
    }
    catch (error) {
        throw new MemoryRecordValidationError(`${field} is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
}
