"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaleProjectMemoryCursorError = exports.ProjectMemoryCursorError = exports.ProjectMemoryValidationError = exports.PROJECT_MEMORY_MAX_PAGE_SIZE = exports.PROJECT_MEMORY_DEFAULT_PAGE_SIZE = exports.PROJECT_MEMORY_CATALOG_SORT = exports.PROJECT_MEMORY_HUB_TYPE = exports.PROJECT_MEMORY_ENTRY_TYPE = exports.PROJECT_MEMORY_ENTRY_SCHEMA_VERSION = void 0;
exports.normalizeProjectRepositoryPath = normalizeProjectRepositoryPath;
exports.deriveProjectIdentityFromRepoPath = deriveProjectIdentityFromRepoPath;
exports.deriveProjectMemoryHubBindingFromRepoPath = deriveProjectMemoryHubBindingFromRepoPath;
exports.normalizeProjectAgentType = normalizeProjectAgentType;
exports.buildProjectMemoryEntryPath = buildProjectMemoryEntryPath;
exports.computeProjectMemoryOperationHash = computeProjectMemoryOperationHash;
exports.compareProjectMemoryOperationHashes = compareProjectMemoryOperationHashes;
exports.buildProjectMemoryEntry = buildProjectMemoryEntry;
exports.parseProjectMemoryEntry = parseProjectMemoryEntry;
exports.parseProjectMemoryHub = parseProjectMemoryHub;
exports.classifyProjectMemoryNote = classifyProjectMemoryNote;
exports.validateProjectMemoryOwnership = validateProjectMemoryOwnership;
exports.resolveProjectMemoryNoteOwnership = resolveProjectMemoryNoteOwnership;
exports.projectMemoryCatalogEntryFromClassification = projectMemoryCatalogEntryFromClassification;
exports.buildProjectMemoryCatalogPage = buildProjectMemoryCatalogPage;
const node_crypto_1 = require("node:crypto");
const knowledge_architecture_1 = require("./knowledge-architecture");
const knowledge_note_1 = require("./knowledge-note");
exports.PROJECT_MEMORY_ENTRY_SCHEMA_VERSION = 1;
exports.PROJECT_MEMORY_ENTRY_TYPE = 'project_memory_entry';
exports.PROJECT_MEMORY_HUB_TYPE = 'project_memory_index';
exports.PROJECT_MEMORY_CATALOG_SORT = 'created_at_desc_operation_id_path_asc';
exports.PROJECT_MEMORY_DEFAULT_PAGE_SIZE = 50;
exports.PROJECT_MEMORY_MAX_PAGE_SIZE = 200;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const AGENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const OPERATION_KIND_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OPERATION_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PROJECT_ENTRY_PATH_PATTERN = new RegExp(`^${escapeRegularExpression(knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR)}/([^/]+)/agents/([^/]+)/[^/]+\\.md$`);
const PROJECT_LEGACY_PATH_PATTERN = new RegExp(`^${escapeRegularExpression(knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR)}/([^/]+)/memory\\.md$`);
const PROJECT_HUB_PATH_PATTERN = new RegExp(`^${escapeRegularExpression(knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR)}/([^/]+)/index\\.md$`);
class ProjectMemoryValidationError extends Error {
    constructor(message) {
        super(message);
        this.code = 'invalid_project_memory';
        this.name = 'ProjectMemoryValidationError';
    }
}
exports.ProjectMemoryValidationError = ProjectMemoryValidationError;
class ProjectMemoryCursorError extends Error {
    constructor(message) {
        super(message);
        this.code = 'invalid_project_memory_cursor';
        this.name = 'ProjectMemoryCursorError';
    }
}
exports.ProjectMemoryCursorError = ProjectMemoryCursorError;
class StaleProjectMemoryCursorError extends Error {
    constructor(cursorGeneration, currentGeneration) {
        super(`Project-memory cursor generation ${cursorGeneration} is stale; current generation is ${currentGeneration}.`);
        this.code = 'stale_project_memory_cursor';
        this.name = 'StaleProjectMemoryCursorError';
        this.cursorGeneration = cursorGeneration;
        this.currentGeneration = currentGeneration;
    }
}
exports.StaleProjectMemoryCursorError = StaleProjectMemoryCursorError;
function normalizeProjectRepositoryPath(value) {
    if (typeof value !== 'string') {
        throw new ProjectMemoryValidationError('repo_path must be a string.');
    }
    let normalized = value.trim();
    if (!normalized) {
        throw new ProjectMemoryValidationError('repo_path must not be empty.');
    }
    if (normalized.includes('\0')) {
        throw new ProjectMemoryValidationError('repo_path contains an invalid null byte.');
    }
    if (/^file:/i.test(normalized)) {
        let fileUrl;
        try {
            fileUrl = new URL(normalized);
        }
        catch {
            throw new ProjectMemoryValidationError('repo_path file URL is invalid.');
        }
        if (fileUrl.protocol !== 'file:'
            || (fileUrl.hostname && fileUrl.hostname !== 'localhost')) {
            throw new ProjectMemoryValidationError('repo_path file URL must identify a local path.');
        }
        try {
            normalized = decodeURIComponent(fileUrl.pathname);
        }
        catch {
            throw new ProjectMemoryValidationError('repo_path file URL contains invalid escaping.');
        }
        if (/^\/[A-Za-z]:\//.test(normalized)) {
            normalized = normalized.slice(1);
        }
    }
    normalized = normalized.normalize('NFC').replace(/\\/g, '/');
    if (!normalized.startsWith('/')
        && !/^[A-Za-z]:\//.test(normalized)) {
        throw new ProjectMemoryValidationError('repo_path must be an exact absolute path.');
    }
    const segments = normalized.split('/');
    if (segments.some((segment) => segment === '..')) {
        throw new ProjectMemoryValidationError('repo_path must not contain traversal segments.');
    }
    if (segments.some((segment) => segment === '.')) {
        throw new ProjectMemoryValidationError('repo_path must not contain relative path segments.');
    }
    normalized = normalized.replace(/\/+/g, '/');
    if (/^[A-Za-z]:\//.test(normalized)) {
        normalized = `${normalized[0].toUpperCase()}${normalized.slice(1)}`;
    }
    if (normalized.length > 1 && !/^[A-Za-z]:\/$/.test(normalized)) {
        normalized = normalized.replace(/\/+$/g, '');
    }
    if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) {
        throw new ProjectMemoryValidationError('repo_path must identify a repository below the filesystem root.');
    }
    return normalized;
}
function deriveProjectIdentityFromRepoPath(repoPath) {
    const normalizedRepoPath = normalizeProjectRepositoryPath(repoPath);
    const digest = (0, node_crypto_1.createHash)('sha256')
        .update(normalizedRepoPath, 'utf8')
        .digest('hex');
    const leaf = normalizedRepoPath.split('/').filter(Boolean).pop() ?? 'project';
    const projectHint = normalizeProjectLabel(leaf);
    return {
        project_id: `project-${digest.slice(0, 32)}`,
        project_key: `${projectHint}-${digest.slice(0, 32)}`,
        repo_path: normalizedRepoPath,
        project_hint: projectHint,
    };
}
function deriveProjectMemoryHubBindingFromRepoPath(repoPath) {
    const identity = deriveProjectIdentityFromRepoPath(repoPath);
    return {
        project_id: identity.project_id,
        project_key: identity.project_key,
        project_hub: `${knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/${identity.project_key}/index.md`,
        repo_path: identity.repo_path,
        project_hint: identity.project_hint,
    };
}
function normalizeProjectAgentType(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return 'custom';
    }
    if (value.includes('\0')
        || value.includes('/')
        || value.includes('\\')
        || /[^A-Za-z0-9 _-]/.test(value)) {
        return 'custom';
    }
    const candidate = value
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
    if (!candidate) {
        return 'custom';
    }
    if (candidate === 'claude' || candidate === 'claudecode') {
        return 'claude-code';
    }
    return AGENT_TYPE_PATTERN.test(candidate) ? candidate : 'custom';
}
function buildProjectMemoryEntryPath(input) {
    const projectKey = requireProjectKey(input.projectKey);
    const agentType = requireAgentType(input.agentType);
    const operationKind = requireOperationKind(input.operationKind);
    const operationId = requireOperationId(input.operationId);
    return (0, knowledge_note_1.normalizeVaultRelativePath)(`${knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/${projectKey}/agents/${agentType}/${operationKind}-${operationId}.md`);
}
function computeProjectMemoryOperationHash(input) {
    const canonical = canonicalProjectMemoryOperation(input);
    const digest = (0, node_crypto_1.createHash)('sha256')
        .update(stableJson(canonical), 'utf8')
        .digest('hex');
    return `sha256:${digest}`;
}
function compareProjectMemoryOperationHashes(existingOperationHash, requestedOperationHash) {
    const existing = requireOperationHash(existingOperationHash, 'existing operation_hash');
    const requested = requireOperationHash(requestedOperationHash, 'requested operation_hash');
    if (existing === requested) {
        return {
            status: 'exact_retry',
            operation_hash: existing,
        };
    }
    return {
        status: 'conflict',
        existing_operation_hash: existing,
        requested_operation_hash: requested,
    };
}
function buildProjectMemoryEntry(input) {
    const projectKey = requireProjectKey(input.project_key);
    const normalizedBody = requireOperationBody(input.body);
    const path = buildProjectMemoryEntryPath({
        projectKey,
        agentType: input.agent_type,
        operationKind: input.operation_kind,
        operationId: input.operation_id,
    });
    const operationHash = computeProjectMemoryOperationHash({
        ...input,
        body: normalizedBody,
    });
    const entry = parseProjectMemoryEntry({
        path,
        frontmatter: {
            schema_version: exports.PROJECT_MEMORY_ENTRY_SCHEMA_VERSION,
            type: exports.PROJECT_MEMORY_ENTRY_TYPE,
            project_id: input.project_id,
            agent_type: input.agent_type,
            task_id: input.task_id ?? null,
            operation_id: input.operation_id,
            operation_kind: input.operation_kind,
            memory_kinds: input.memory_kinds,
            status: input.status,
            created_at: input.created_at,
            operation_hash: operationHash,
            project_hub: input.project_hub,
            related_wiki: input.related_wiki ?? [],
            supersedes: input.supersedes ?? [],
        },
    });
    return {
        entry,
        body: normalizedBody,
    };
}
function parseProjectMemoryEntry(source) {
    const notePath = (0, knowledge_note_1.normalizeVaultRelativePath)(source.path);
    const pathMatch = PROJECT_ENTRY_PATH_PATTERN.exec(notePath);
    if (!pathMatch) {
        throw new ProjectMemoryValidationError(`Project-memory entry path is invalid: ${notePath}`);
    }
    const projectKey = requireProjectKey(pathMatch[1]);
    const frontmatter = requirePlainObject(source.frontmatter, 'frontmatter');
    if (frontmatter.schema_version !== exports.PROJECT_MEMORY_ENTRY_SCHEMA_VERSION) {
        throw new ProjectMemoryValidationError(`project-memory schema_version must be ${exports.PROJECT_MEMORY_ENTRY_SCHEMA_VERSION}.`);
    }
    if (frontmatter.type !== exports.PROJECT_MEMORY_ENTRY_TYPE) {
        throw new ProjectMemoryValidationError(`project-memory type must be ${exports.PROJECT_MEMORY_ENTRY_TYPE}.`);
    }
    const projectId = requireProjectId(frontmatter.project_id);
    const agentType = requireAgentType(frontmatter.agent_type);
    const taskId = optionalIdentifier(frontmatter.task_id, TASK_ID_PATTERN, 'task_id');
    const operationId = requireOperationId(frontmatter.operation_id);
    const operationKind = requireOperationKind(frontmatter.operation_kind);
    const memoryKinds = normalizeIdentifierList(frontmatter.memory_kinds, 'memory_kinds', OPERATION_KIND_PATTERN, true);
    const status = requireProjectMemoryStatus(frontmatter.status);
    const createdAt = requireCanonicalTimestamp(frontmatter.created_at, 'created_at');
    const operationHash = requireOperationHash(frontmatter.operation_hash, 'operation_hash');
    const projectHub = normalizeInternalLink(frontmatter.project_hub, 'project_hub');
    const relatedWiki = normalizeLinkList(frontmatter.related_wiki, 'related_wiki');
    const supersedes = normalizeLinkList(frontmatter.supersedes, 'supersedes');
    const expectedPath = buildProjectMemoryEntryPath({
        projectKey,
        agentType,
        operationKind,
        operationId,
    });
    if (expectedPath !== notePath) {
        throw new ProjectMemoryValidationError(`Project-memory entry path conflicts with its operation identity: ${notePath}`);
    }
    const expectedHub = `[[${knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/${projectKey}/index]]`;
    if (projectHub !== expectedHub) {
        throw new ProjectMemoryValidationError(`project_hub conflicts with the entry project key: ${projectHub}`);
    }
    return {
        schema_version: exports.PROJECT_MEMORY_ENTRY_SCHEMA_VERSION,
        type: exports.PROJECT_MEMORY_ENTRY_TYPE,
        path: notePath,
        project_key: projectKey,
        project_id: projectId,
        agent_type: agentType,
        task_id: taskId,
        operation_id: operationId,
        operation_kind: operationKind,
        memory_kinds: memoryKinds,
        status,
        created_at: createdAt,
        operation_hash: operationHash,
        project_hub: projectHub,
        related_wiki: relatedWiki,
        supersedes,
    };
}
function parseProjectMemoryHub(source) {
    const notePath = (0, knowledge_note_1.normalizeVaultRelativePath)(source.path);
    const pathMatch = PROJECT_HUB_PATH_PATTERN.exec(notePath);
    if (!pathMatch) {
        throw new ProjectMemoryValidationError(`Project-memory hub path is invalid: ${notePath}`);
    }
    const pathProjectKey = requireProjectKey(pathMatch[1]);
    const frontmatter = requirePlainObject(source.frontmatter, 'frontmatter');
    if (frontmatter.schema_version !== exports.PROJECT_MEMORY_ENTRY_SCHEMA_VERSION) {
        throw new ProjectMemoryValidationError(`project-memory hub schema_version must be ${exports.PROJECT_MEMORY_ENTRY_SCHEMA_VERSION}.`);
    }
    if (frontmatter.type !== exports.PROJECT_MEMORY_HUB_TYPE) {
        throw new ProjectMemoryValidationError(`project-memory hub type must be ${exports.PROJECT_MEMORY_HUB_TYPE}.`);
    }
    const projectId = requireProjectId(frontmatter.project_id);
    const projectKey = requireProjectKey(frontmatter.project_key);
    const repoPath = normalizeProjectRepositoryPath(requireString(frontmatter.repo_path, 'repo_path'));
    if (projectKey !== pathProjectKey) {
        throw new ProjectMemoryValidationError(`project_key conflicts with the hub path: ${projectKey}`);
    }
    return {
        project_id: projectId,
        project_key: projectKey,
        project_hub: notePath,
        repo_path: repoPath,
    };
}
function classifyProjectMemoryNote(source) {
    const notePath = (0, knowledge_note_1.normalizeVaultRelativePath)(source.path);
    const legacyMatch = PROJECT_LEGACY_PATH_PATTERN.exec(notePath);
    if (legacyMatch) {
        const rawProjectId = source.frontmatter.project_id;
        return {
            kind: 'legacy',
            path: notePath,
            project_key: requireProjectKey(legacyMatch[1]),
            project_id: rawProjectId === undefined || rawProjectId === null || rawProjectId === ''
                ? null
                : requireProjectId(rawProjectId),
        };
    }
    if (PROJECT_ENTRY_PATH_PATTERN.test(notePath)) {
        const entry = parseProjectMemoryEntry({ ...source, path: notePath });
        return {
            kind: 'entry',
            path: notePath,
            project_key: entry.project_key,
            project_id: entry.project_id,
            entry,
        };
    }
    const hubMatch = PROJECT_HUB_PATH_PATTERN.exec(notePath);
    if (hubMatch) {
        const projectKey = requireProjectKey(hubMatch[1]);
        if (source.frontmatter.schema_version !== exports.PROJECT_MEMORY_ENTRY_SCHEMA_VERSION
            || source.frontmatter.type !== exports.PROJECT_MEMORY_HUB_TYPE
            || !source.frontmatter.project_id
            || !source.frontmatter.project_key
            || !source.frontmatter.repo_path) {
            return {
                kind: 'unbound_hub',
                path: notePath,
                project_key: projectKey,
            };
        }
        const binding = parseProjectMemoryHub({ ...source, path: notePath });
        return {
            kind: 'hub',
            path: notePath,
            project_key: projectKey,
            project_id: binding.project_id,
            binding,
        };
    }
    return {
        kind: 'unrelated',
        path: notePath,
    };
}
function validateProjectMemoryOwnership(bindings) {
    const normalized = [];
    const projectIds = new Set();
    const projectKeys = new Set();
    const repoPaths = new Set();
    for (const binding of bindings) {
        const projectId = requireProjectId(binding.project_id);
        const projectKey = requireProjectKey(binding.project_key);
        const projectHub = (0, knowledge_note_1.normalizeVaultRelativePath)(binding.project_hub);
        const repoPath = normalizeProjectRepositoryPath(binding.repo_path);
        const expectedHub = `${knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/${projectKey}/index.md`;
        if (projectHub !== expectedHub) {
            throw new ProjectMemoryValidationError(`project_hub conflicts with project_key ${projectKey}.`);
        }
        if (projectIds.has(projectId)) {
            throw new ProjectMemoryValidationError(`Project-memory ownership contains duplicate project_id ${projectId}.`);
        }
        if (projectKeys.has(projectKey)) {
            throw new ProjectMemoryValidationError(`Project-memory ownership contains duplicate project_key ${projectKey}.`);
        }
        if (repoPaths.has(repoPath)) {
            throw new ProjectMemoryValidationError(`Project-memory ownership contains duplicate repo_path ${repoPath}.`);
        }
        projectIds.add(projectId);
        projectKeys.add(projectKey);
        repoPaths.add(repoPath);
        normalized.push({
            project_id: projectId,
            project_key: projectKey,
            project_hub: projectHub,
            repo_path: repoPath,
        });
    }
    return normalized;
}
function resolveProjectMemoryNoteOwnership(classification, bindings) {
    const validated = validateProjectMemoryOwnership(bindings);
    const byKey = validated.find((binding) => binding.project_key === classification.project_key);
    const byId = classification.project_id
        ? validated.find((binding) => binding.project_id === classification.project_id)
        : null;
    if (byKey && byId && byKey.project_id !== byId.project_id) {
        throw new ProjectMemoryValidationError(`Project-memory note ownership is ambiguous because project_id conflicts with its path: ${classification.path}`);
    }
    const binding = byKey ?? byId;
    if (!binding) {
        throw new ProjectMemoryValidationError(`Project-memory note ownership is ambiguous or missing: ${classification.path}`);
    }
    if (classification.project_id
        && binding.project_id !== classification.project_id) {
        throw new ProjectMemoryValidationError(`Project-memory note ownership conflicts with project_id: ${classification.path}`);
    }
    if (binding.project_key !== classification.project_key) {
        throw new ProjectMemoryValidationError(`Project-memory note ownership conflicts with project_key: ${classification.path}`);
    }
    return binding;
}
function projectMemoryCatalogEntryFromClassification(classification, binding) {
    const resolved = resolveProjectMemoryNoteOwnership(classification, [binding]);
    if (classification.kind === 'legacy') {
        return {
            path: classification.path,
            legacy: true,
            project_id: resolved.project_id,
            agent_type: null,
            operation_id: null,
            operation_kind: null,
            status: null,
            operation_hash: null,
            created_at: null,
        };
    }
    const entry = classification.entry;
    return {
        path: entry.path,
        legacy: false,
        project_id: entry.project_id,
        agent_type: entry.agent_type,
        operation_id: entry.operation_id,
        operation_kind: entry.operation_kind,
        status: entry.status,
        operation_hash: entry.operation_hash,
        created_at: entry.created_at,
    };
}
function buildProjectMemoryCatalogPage(input) {
    const projectId = requireProjectId(input.projectId);
    const projectHub = (0, knowledge_note_1.normalizeVaultRelativePath)(input.projectHub);
    const hubMatch = PROJECT_HUB_PATH_PATTERN.exec(projectHub);
    if (!hubMatch) {
        throw new ProjectMemoryValidationError(`Project-memory catalog hub path is invalid: ${projectHub}`);
    }
    const projectKey = requireProjectKey(hubMatch[1]);
    const generation = requireGeneration(input.generation);
    const pageSize = requirePageSize(input.pageSize);
    const entries = normalizeCatalogEntries(input.entries, projectId, projectKey);
    const offset = input.cursor
        ? decodeProjectMemoryCursor(input.cursor, projectId, generation)
        : 0;
    if (offset > entries.length) {
        throw new ProjectMemoryCursorError('Project-memory cursor offset is beyond the current catalog.');
    }
    const end = Math.min(entries.length, offset + pageSize);
    const pageEntries = entries.slice(offset, end).map(cloneCatalogEntry);
    const nextCursor = end < entries.length
        ? encodeProjectMemoryCursor({
            v: 1,
            project_id: projectId,
            generation,
            sort: exports.PROJECT_MEMORY_CATALOG_SORT,
            offset: end,
        })
        : null;
    return {
        project_id: projectId,
        project_hub: projectHub,
        generation,
        total: entries.length,
        counts_by_agent: countCatalogEntriesByAgent(entries),
        complete: true,
        sort: exports.PROJECT_MEMORY_CATALOG_SORT,
        page: {
            page_size: pageSize,
            next_cursor: nextCursor,
        },
        entries: pageEntries,
    };
}
function canonicalProjectMemoryOperation(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new ProjectMemoryValidationError('Project-memory operation payload must be an object.');
    }
    if (typeof input.body !== 'string') {
        throw new ProjectMemoryValidationError('Project-memory operation body must be a string.');
    }
    return {
        project_id: requireProjectId(input.project_id),
        agent_type: requireAgentType(input.agent_type),
        task_id: optionalIdentifier(input.task_id, TASK_ID_PATTERN, 'task_id'),
        operation_id: requireOperationId(input.operation_id),
        operation_kind: requireOperationKind(input.operation_kind),
        memory_kinds: normalizeIdentifierList(input.memory_kinds, 'memory_kinds', OPERATION_KIND_PATTERN, true),
        status: requireProjectMemoryStatus(input.status),
        project_hub: normalizeInternalLink(input.project_hub, 'project_hub'),
        related_wiki: normalizeLinkList(input.related_wiki ?? [], 'related_wiki'),
        supersedes: normalizeLinkList(input.supersedes ?? [], 'supersedes'),
        body: requireOperationBody(input.body),
    };
}
function normalizeCatalogEntries(input, projectId, projectKey) {
    if (!Array.isArray(input)) {
        throw new ProjectMemoryValidationError('Project-memory catalog entries must be an array.');
    }
    const entries = [];
    const paths = new Set();
    const operationIdentities = new Set();
    for (const candidate of input) {
        const entry = normalizeCatalogEntry(candidate, projectId, projectKey);
        if (paths.has(entry.path)) {
            throw new ProjectMemoryValidationError(`Project-memory catalog contains duplicate path ${entry.path}.`);
        }
        paths.add(entry.path);
        if (!entry.legacy) {
            const identity = `${entry.agent_type}\0${entry.operation_kind}\0${entry.operation_id}`;
            if (operationIdentities.has(identity)) {
                throw new ProjectMemoryValidationError(`Project-memory catalog contains duplicate operation identity ${entry.operation_id}.`);
            }
            operationIdentities.add(identity);
        }
        entries.push(entry);
    }
    return entries.sort(compareCatalogEntries);
}
function normalizeCatalogEntry(candidate, projectId, projectKey) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new ProjectMemoryValidationError('Project-memory catalog entry must be an object.');
    }
    const entryProjectId = requireProjectId(candidate.project_id);
    if (entryProjectId !== projectId) {
        throw new ProjectMemoryValidationError(`Project-memory catalog entry belongs to another project_id: ${entryProjectId}`);
    }
    const notePath = (0, knowledge_note_1.normalizeVaultRelativePath)(candidate.path);
    if (candidate.legacy) {
        const expectedLegacyPath = `${knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/${projectKey}/memory.md`;
        if (notePath !== expectedLegacyPath) {
            throw new ProjectMemoryValidationError(`Legacy project-memory entry path conflicts with the catalog project: ${notePath}`);
        }
        if (candidate.agent_type !== null
            || candidate.operation_id !== null
            || candidate.operation_kind !== null
            || candidate.status !== null
            || candidate.operation_hash !== null
            || candidate.created_at !== null) {
            throw new ProjectMemoryValidationError('Legacy project-memory catalog fields must be null.');
        }
        return {
            path: notePath,
            legacy: true,
            project_id: projectId,
            agent_type: null,
            operation_id: null,
            operation_kind: null,
            status: null,
            operation_hash: null,
            created_at: null,
        };
    }
    const pathMatch = PROJECT_ENTRY_PATH_PATTERN.exec(notePath);
    if (!pathMatch) {
        throw new ProjectMemoryValidationError(`Project-memory catalog entry path is invalid: ${notePath}`);
    }
    const entryProjectKey = requireProjectKey(pathMatch[1]);
    if (entryProjectKey !== projectKey) {
        throw new ProjectMemoryValidationError(`Project-memory catalog entry belongs to another project_key: ${entryProjectKey}`);
    }
    const agentType = requireAgentType(candidate.agent_type);
    const operationId = requireOperationId(candidate.operation_id);
    const operationKind = requireOperationKind(candidate.operation_kind);
    const expectedPath = buildProjectMemoryEntryPath({
        projectKey: entryProjectKey,
        agentType,
        operationKind,
        operationId,
    });
    if (expectedPath !== notePath) {
        throw new ProjectMemoryValidationError(`Project-memory catalog path conflicts with operation identity: ${notePath}`);
    }
    return {
        path: notePath,
        legacy: false,
        project_id: projectId,
        agent_type: agentType,
        operation_id: operationId,
        operation_kind: operationKind,
        status: requireProjectMemoryStatus(candidate.status),
        operation_hash: requireOperationHash(candidate.operation_hash, 'operation_hash'),
        created_at: requireCanonicalTimestamp(candidate.created_at, 'created_at'),
    };
}
function compareCatalogEntries(left, right) {
    if (left.created_at !== right.created_at) {
        if (left.created_at === null) {
            return 1;
        }
        if (right.created_at === null) {
            return -1;
        }
        return right.created_at.localeCompare(left.created_at);
    }
    return ((left.operation_id ?? '').localeCompare(right.operation_id ?? '')
        || left.path.localeCompare(right.path));
}
function countCatalogEntriesByAgent(entries) {
    const counts = new Map();
    for (const entry of entries) {
        if (entry.agent_type) {
            counts.set(entry.agent_type, (counts.get(entry.agent_type) ?? 0) + 1);
        }
    }
    const result = {};
    for (const agentType of [...counts.keys()].sort()) {
        result[agentType] = counts.get(agentType) ?? 0;
    }
    return result;
}
function encodeProjectMemoryCursor(payload) {
    const checksum = hashCursorPayload(payload);
    const envelope = {
        ...payload,
        checksum,
    };
    return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
}
function decodeProjectMemoryCursor(cursor, projectId, generation) {
    if (typeof cursor !== 'string'
        || !cursor
        || cursor.length > 4096
        || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
        throw new ProjectMemoryCursorError('Project-memory cursor encoding is invalid.');
    }
    let decoded;
    try {
        const buffer = Buffer.from(cursor, 'base64url');
        if (buffer.toString('base64url') !== cursor) {
            throw new Error('non-canonical base64url');
        }
        decoded = buffer.toString('utf8');
    }
    catch {
        throw new ProjectMemoryCursorError('Project-memory cursor encoding is invalid.');
    }
    let parsed;
    try {
        parsed = JSON.parse(decoded);
    }
    catch {
        throw new ProjectMemoryCursorError('Project-memory cursor payload is invalid.');
    }
    if (!isPlainObject(parsed)) {
        throw new ProjectMemoryCursorError('Project-memory cursor payload is invalid.');
    }
    const expectedKeys = [
        'checksum',
        'generation',
        'offset',
        'project_id',
        'sort',
        'v',
    ];
    if (Object.keys(parsed).sort().join('\0')
        !== expectedKeys.sort().join('\0')) {
        throw new ProjectMemoryCursorError('Project-memory cursor shape is invalid.');
    }
    if (parsed.v !== 1
        || typeof parsed.project_id !== 'string'
        || typeof parsed.generation !== 'number'
        || !Number.isSafeInteger(parsed.generation)
        || parsed.generation < 0
        || parsed.sort !== exports.PROJECT_MEMORY_CATALOG_SORT
        || typeof parsed.offset !== 'number'
        || !Number.isSafeInteger(parsed.offset)
        || parsed.offset < 0
        || typeof parsed.checksum !== 'string') {
        throw new ProjectMemoryCursorError('Project-memory cursor fields are invalid.');
    }
    const payload = {
        v: 1,
        project_id: parsed.project_id,
        generation: parsed.generation,
        sort: exports.PROJECT_MEMORY_CATALOG_SORT,
        offset: parsed.offset,
    };
    if (parsed.checksum !== hashCursorPayload(payload)) {
        throw new ProjectMemoryCursorError('Project-memory cursor checksum is invalid.');
    }
    if (payload.project_id !== projectId) {
        throw new ProjectMemoryCursorError('Project-memory cursor belongs to another project.');
    }
    if (payload.generation !== generation) {
        throw new StaleProjectMemoryCursorError(payload.generation, generation);
    }
    return payload.offset;
}
function hashCursorPayload(payload) {
    return (0, node_crypto_1.createHash)('sha256')
        .update(stableJson(payload), 'utf8')
        .digest('hex');
}
function stableJson(value) {
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'string'
        || typeof value === 'boolean'
        || typeof value === 'number') {
        if (typeof value === 'number' && !Number.isFinite(value)) {
            throw new ProjectMemoryValidationError('Canonical project-memory values must be finite.');
        }
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`;
    }
    if (isPlainObject(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
            .join(',')}}`;
    }
    throw new ProjectMemoryValidationError('Canonical project-memory values must be JSON-compatible.');
}
function normalizeProjectLabel(value) {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[._-]+|[._-]+$/g, '')
        .slice(0, 48);
    return normalized || 'project';
}
function requireProjectId(value) {
    return requireIdentifier(value, PROJECT_ID_PATTERN, 'project_id');
}
function requireProjectKey(value) {
    return requireIdentifier(value, PROJECT_KEY_PATTERN, 'project_key');
}
function requireAgentType(value) {
    return requireIdentifier(value, AGENT_TYPE_PATTERN, 'agent_type');
}
function requireOperationKind(value) {
    return requireIdentifier(value, OPERATION_KIND_PATTERN, 'operation_kind');
}
function requireOperationId(value) {
    return requireIdentifier(value, OPERATION_ID_PATTERN, 'operation_id');
}
function requireIdentifier(value, pattern, name) {
    if (typeof value !== 'string'
        || !pattern.test(value)
        || value === '.'
        || value === '..'
        || value.includes('/')
        || value.includes('\\')) {
        throw new ProjectMemoryValidationError(`${name} is invalid or unsafe.`);
    }
    return value;
}
function optionalIdentifier(value, pattern, name) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    return requireIdentifier(value, pattern, name);
}
function normalizeIdentifierList(value, name, pattern, requireNonEmpty) {
    if (!Array.isArray(value)) {
        throw new ProjectMemoryValidationError(`${name} must be an array.`);
    }
    const normalized = [
        ...new Set(value.map((item) => requireIdentifier(item, pattern, `${name} item`))),
    ].sort();
    if (requireNonEmpty && normalized.length === 0) {
        throw new ProjectMemoryValidationError(`${name} must not be empty.`);
    }
    return normalized;
}
function normalizeLinkList(value, name) {
    if (!Array.isArray(value)) {
        throw new ProjectMemoryValidationError(`${name} must be an array.`);
    }
    return [
        ...new Set(value.map((item) => normalizeInternalLink(item, `${name} item`))),
    ].sort();
}
function normalizeInternalLink(value, name) {
    const raw = requireString(value, name);
    const match = /^\[\[([^|\]]+)(?:\|[^\]]+)?\]\]$/.exec(raw.trim());
    if (!match) {
        throw new ProjectMemoryValidationError(`${name} must be an internal Wikilink.`);
    }
    const targetWithSubpath = match[1].trim().replace(/\\/g, '/');
    const subpathIndex = targetWithSubpath.search(/[#^]/);
    const pathPart = subpathIndex >= 0
        ? targetWithSubpath.slice(0, subpathIndex)
        : targetWithSubpath;
    const subpath = subpathIndex >= 0 ? targetWithSubpath.slice(subpathIndex) : '';
    const normalizedPath = (0, knowledge_note_1.normalizeVaultRelativePath)(pathPart.replace(/\.md$/i, ''));
    return `[[${normalizedPath}${subpath}]]`;
}
function requireProjectMemoryStatus(value) {
    if (value !== 'active'
        && value !== 'superseded'
        && value !== 'disputed'
        && value !== 'review') {
        throw new ProjectMemoryValidationError('status must be active, superseded, disputed, or review.');
    }
    return value;
}
function requireCanonicalTimestamp(value, name) {
    const timestamp = requireString(value, name);
    const time = Date.parse(timestamp);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== timestamp) {
        throw new ProjectMemoryValidationError(`${name} must be a canonical ISO timestamp.`);
    }
    return timestamp;
}
function requireOperationHash(value, name) {
    const hash = requireString(value, name);
    if (!OPERATION_HASH_PATTERN.test(hash)) {
        throw new ProjectMemoryValidationError(`${name} must be a canonical sha256 hash.`);
    }
    return hash;
}
function requireOperationBody(value) {
    if (typeof value !== 'string') {
        throw new ProjectMemoryValidationError('Project-memory operation body must be a string.');
    }
    return value.replace(/\r\n?/g, '\n');
}
function requireGeneration(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new ProjectMemoryValidationError('Project-memory generation must be a non-negative safe integer.');
    }
    return value;
}
function requirePageSize(value) {
    if (value === undefined) {
        return exports.PROJECT_MEMORY_DEFAULT_PAGE_SIZE;
    }
    if (!Number.isSafeInteger(value)
        || value < 1
        || value > exports.PROJECT_MEMORY_MAX_PAGE_SIZE) {
        throw new ProjectMemoryValidationError(`Project-memory page_size must be between 1 and ${exports.PROJECT_MEMORY_MAX_PAGE_SIZE}.`);
    }
    return value;
}
function requireString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ProjectMemoryValidationError(`${name} must be a non-empty string.`);
    }
    return value.trim();
}
function requirePlainObject(value, name) {
    if (!isPlainObject(value)) {
        throw new ProjectMemoryValidationError(`${name} must be an object.`);
    }
    return value;
}
function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function cloneCatalogEntry(entry) {
    return { ...entry };
}
function escapeRegularExpression(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
