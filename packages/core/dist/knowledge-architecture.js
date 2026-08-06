"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_PROJECT_DIRS = exports.LEGACY_MEMORY_DIRS = exports.LEGACY_TOP_LEVEL_DIRS = exports.ARCHITECTURE_DIRS = exports.ARCHIVE_ARCHITECTURE_DIR = exports.KNOWLEDGE_ARCHITECTURE_DIR = exports.TRACEKEEPER_ARCHITECTURE_DIR = exports.ARCHIVE_REVIEW_QUEUE_DIR = exports.KNOWLEDGE_SOURCES_ATTACHMENTS_DIR = exports.KNOWLEDGE_SOURCES_TRANSCRIPTS_DIR = exports.KNOWLEDGE_SOURCES_FILES_DIR = exports.KNOWLEDGE_SOURCES_WEB_DIR = exports.KNOWLEDGE_SOURCES_INDEX_PATH = exports.KNOWLEDGE_SOURCES_DIR = exports.KNOWLEDGE_WIKI_REFERENCES_DIR = exports.KNOWLEDGE_WIKI_GUIDES_DIR = exports.KNOWLEDGE_WIKI_CLAIMS_DIR = exports.KNOWLEDGE_WIKI_CONCEPTS_DIR = exports.KNOWLEDGE_WIKI_HUBS_INDEX_PATH = exports.KNOWLEDGE_WIKI_HUBS_DIR = exports.KNOWLEDGE_WIKI_INDEX_PATH = exports.KNOWLEDGE_WIKI_DIR = exports.KNOWLEDGE_PROJECTS_INDEX_PATH = exports.KNOWLEDGE_PROJECTS_MEMORY_DIR = exports.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH = exports.KNOWLEDGE_GLOBAL_MEMORY_DIR = exports.KNOWLEDGE_MEMORY_INDEX_PATH = exports.KNOWLEDGE_MEMORY_DIR = exports.KNOWLEDGE_INDEX_PATH = exports.TRACEKEEPER_SOURCE_ANALYSIS_DIR = exports.TRACEKEEPER_CONTEXT_PACKS_DIR = exports.TRACEKEEPER_SESSIONS_DIR = exports.TRACEKEEPER_TASKS_DIR = exports.TRACEKEEPER_WORK_DIR = exports.TRACEKEEPER_REVIEW_QUEUE_DIR = exports.TRACEKEEPER_AGENT_REQUESTS_DIR = exports.TRACEKEEPER_INBOX_DIR = exports.TRACEKEEPER_PERMISSIONS_PATH = exports.TRACEKEEPER_MEMORY_POLICY_PATH = exports.TRACEKEEPER_SYSTEM_PATH = exports.LEGACY_TRACEKEEPER_AUDIT_LOG_PATH = exports.TRACEKEEPER_DASHBOARDS_DIR = exports.TRACEKEEPER_OPERATIONS_DIR = exports.TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH = exports.TRACEKEEPER_AGENT_ACTIVITY_DIR = exports.TRACEKEEPER_CONTROL_DIR = exports.ARCHIVE_ROOT = exports.KNOWLEDGE_ROOT = exports.TRACEKEEPER_ROOT = exports.TRACEKEEPER_ARCHITECTURE_VERSION = void 0;
exports.REQUIRED_ARCHITECTURE_ENTRIES = exports.YAML_RELATION_KEYS = exports.KNW_MEMORY_HUB_KEYS = exports.KNW_RELATED_SOURCE_KEYS = exports.KNW_RELATED_MEMORY_KEYS = exports.KNW_RELATED_WIKI_KEYS = exports.GRAPH_RECOMMENDED_HUBS = exports.GRAPH_RECOMMENDED_ENTRY = exports.REQUIRED_KNOWLEDGE_FILES = exports.REQUIRED_KNOWLEDGE_DIRECTORIES = exports.REQUIRED_CONTROL_FILES = exports.ARCHITECTURE_PROJECT_DIRS = exports.LEGACY_DIR_PREFIXES = exports.LEGACY_SOURCE_DIRS = void 0;
exports.normalizeKnowledgePath = normalizeKnowledgePath;
exports.startsWithPathPrefix = startsWithPathPrefix;
exports.isLegacyArchitecturePath = isLegacyArchitecturePath;
exports.isInLegacyDirectory = isInLegacyDirectory;
exports.isKnowledgeMemoryPath = isKnowledgeMemoryPath;
exports.isKnowledgeProjectMemoryPath = isKnowledgeProjectMemoryPath;
exports.isKnowledgeProjectPath = isKnowledgeProjectPath;
exports.isKnowledgeWikiPath = isKnowledgeWikiPath;
exports.isKnowledgeSourcePath = isKnowledgeSourcePath;
exports.projectMemoryBasePath = projectMemoryBasePath;
exports.projectMemoryIndexPath = projectMemoryIndexPath;
exports.projectMemoryPath = projectMemoryPath;
exports.projectDecisionsPath = projectDecisionsPath;
exports.projectSessionsPath = projectSessionsPath;
exports.normalizeSlug = normalizeSlug;
exports.resolvePreferredKnowledgePath = resolvePreferredKnowledgePath;
exports.TRACEKEEPER_ARCHITECTURE_VERSION = 2;
exports.TRACEKEEPER_ROOT = '00_tracekeeper';
exports.KNOWLEDGE_ROOT = '01_knowledge';
exports.ARCHIVE_ROOT = '02_archive';
exports.TRACEKEEPER_CONTROL_DIR = `${exports.TRACEKEEPER_ROOT}/control`;
exports.TRACEKEEPER_AGENT_ACTIVITY_DIR = `${exports.TRACEKEEPER_CONTROL_DIR}/agent_activity`;
exports.TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH = `${exports.TRACEKEEPER_AGENT_ACTIVITY_DIR}/index.md`;
exports.TRACEKEEPER_OPERATIONS_DIR = `${exports.TRACEKEEPER_CONTROL_DIR}/operations`;
exports.TRACEKEEPER_DASHBOARDS_DIR = `${exports.TRACEKEEPER_CONTROL_DIR}/dashboards`;
exports.LEGACY_TRACEKEEPER_AUDIT_LOG_PATH = `${exports.TRACEKEEPER_CONTROL_DIR}/audit_log.md`;
exports.TRACEKEEPER_SYSTEM_PATH = `${exports.TRACEKEEPER_CONTROL_DIR}/system.md`;
exports.TRACEKEEPER_MEMORY_POLICY_PATH = `${exports.TRACEKEEPER_CONTROL_DIR}/memory_policy.md`;
exports.TRACEKEEPER_PERMISSIONS_PATH = `${exports.TRACEKEEPER_CONTROL_DIR}/permissions.md`;
exports.TRACEKEEPER_INBOX_DIR = `${exports.TRACEKEEPER_ROOT}/inbox`;
exports.TRACEKEEPER_AGENT_REQUESTS_DIR = `${exports.TRACEKEEPER_INBOX_DIR}/agent_requests`;
exports.TRACEKEEPER_REVIEW_QUEUE_DIR = `${exports.TRACEKEEPER_INBOX_DIR}/review_queue`;
exports.TRACEKEEPER_WORK_DIR = `${exports.TRACEKEEPER_ROOT}/work`;
exports.TRACEKEEPER_TASKS_DIR = `${exports.TRACEKEEPER_WORK_DIR}/tasks`;
exports.TRACEKEEPER_SESSIONS_DIR = `${exports.TRACEKEEPER_WORK_DIR}/sessions`;
exports.TRACEKEEPER_CONTEXT_PACKS_DIR = `${exports.TRACEKEEPER_WORK_DIR}/context_packs`;
exports.TRACEKEEPER_SOURCE_ANALYSIS_DIR = `${exports.TRACEKEEPER_WORK_DIR}/source_analysis`;
exports.KNOWLEDGE_INDEX_PATH = `${exports.KNOWLEDGE_ROOT}/index.md`;
exports.KNOWLEDGE_MEMORY_DIR = `${exports.KNOWLEDGE_ROOT}/memory`;
exports.KNOWLEDGE_MEMORY_INDEX_PATH = `${exports.KNOWLEDGE_MEMORY_DIR}/index.md`;
exports.KNOWLEDGE_GLOBAL_MEMORY_DIR = `${exports.KNOWLEDGE_MEMORY_DIR}/global`;
exports.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH = `${exports.KNOWLEDGE_GLOBAL_MEMORY_DIR}/index.md`;
exports.KNOWLEDGE_PROJECTS_MEMORY_DIR = `${exports.KNOWLEDGE_MEMORY_DIR}/projects`;
exports.KNOWLEDGE_PROJECTS_INDEX_PATH = `${exports.KNOWLEDGE_PROJECTS_MEMORY_DIR}/index.md`;
exports.KNOWLEDGE_WIKI_DIR = `${exports.KNOWLEDGE_ROOT}/wiki`;
exports.KNOWLEDGE_WIKI_INDEX_PATH = `${exports.KNOWLEDGE_WIKI_DIR}/index.md`;
exports.KNOWLEDGE_WIKI_HUBS_DIR = `${exports.KNOWLEDGE_WIKI_DIR}/hubs`;
exports.KNOWLEDGE_WIKI_HUBS_INDEX_PATH = `${exports.KNOWLEDGE_WIKI_HUBS_DIR}/index.md`;
exports.KNOWLEDGE_WIKI_CONCEPTS_DIR = `${exports.KNOWLEDGE_WIKI_DIR}/concepts`;
exports.KNOWLEDGE_WIKI_CLAIMS_DIR = `${exports.KNOWLEDGE_WIKI_DIR}/claims`;
exports.KNOWLEDGE_WIKI_GUIDES_DIR = `${exports.KNOWLEDGE_WIKI_DIR}/guides`;
exports.KNOWLEDGE_WIKI_REFERENCES_DIR = `${exports.KNOWLEDGE_WIKI_DIR}/references`;
exports.KNOWLEDGE_SOURCES_DIR = `${exports.KNOWLEDGE_ROOT}/sources`;
exports.KNOWLEDGE_SOURCES_INDEX_PATH = `${exports.KNOWLEDGE_SOURCES_DIR}/index.md`;
exports.KNOWLEDGE_SOURCES_WEB_DIR = `${exports.KNOWLEDGE_SOURCES_DIR}/web`;
exports.KNOWLEDGE_SOURCES_FILES_DIR = `${exports.KNOWLEDGE_SOURCES_DIR}/files`;
exports.KNOWLEDGE_SOURCES_TRANSCRIPTS_DIR = `${exports.KNOWLEDGE_SOURCES_DIR}/transcripts`;
exports.KNOWLEDGE_SOURCES_ATTACHMENTS_DIR = `${exports.KNOWLEDGE_SOURCES_DIR}/attachments`;
exports.ARCHIVE_REVIEW_QUEUE_DIR = `${exports.ARCHIVE_ROOT}/review_queue`;
exports.TRACEKEEPER_ARCHITECTURE_DIR = exports.TRACEKEEPER_ROOT;
exports.KNOWLEDGE_ARCHITECTURE_DIR = exports.KNOWLEDGE_ROOT;
exports.ARCHIVE_ARCHITECTURE_DIR = exports.ARCHIVE_ROOT;
exports.ARCHITECTURE_DIRS = [exports.TRACEKEEPER_ROOT, exports.KNOWLEDGE_ROOT, exports.ARCHIVE_ROOT];
exports.LEGACY_TOP_LEVEL_DIRS = [
    '00_control',
    '01_inbox',
    '02_timeline',
    '03_sources',
    '04_memory',
    '04_projects',
    '05_memory',
    '05_projects',
    '06_outputs',
    '07_archive',
];
exports.LEGACY_MEMORY_DIRS = ['04_memory', '05_memory'];
exports.LEGACY_PROJECT_DIRS = ['04_projects', '05_projects'];
exports.LEGACY_SOURCE_DIRS = ['03_sources'];
exports.LEGACY_DIR_PREFIXES = exports.LEGACY_TOP_LEVEL_DIRS;
exports.ARCHITECTURE_PROJECT_DIRS = [exports.KNOWLEDGE_PROJECTS_MEMORY_DIR, ...exports.LEGACY_PROJECT_DIRS];
exports.REQUIRED_CONTROL_FILES = [
    exports.TRACEKEEPER_SYSTEM_PATH,
    exports.TRACEKEEPER_MEMORY_POLICY_PATH,
    exports.TRACEKEEPER_PERMISSIONS_PATH,
    exports.TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH,
];
exports.REQUIRED_KNOWLEDGE_DIRECTORIES = [
    exports.TRACEKEEPER_CONTROL_DIR,
    exports.TRACEKEEPER_AGENT_ACTIVITY_DIR,
    exports.TRACEKEEPER_OPERATIONS_DIR,
    exports.TRACEKEEPER_DASHBOARDS_DIR,
    exports.TRACEKEEPER_AGENT_REQUESTS_DIR,
    exports.TRACEKEEPER_REVIEW_QUEUE_DIR,
    exports.TRACEKEEPER_TASKS_DIR,
    exports.TRACEKEEPER_SESSIONS_DIR,
    exports.TRACEKEEPER_CONTEXT_PACKS_DIR,
    exports.TRACEKEEPER_SOURCE_ANALYSIS_DIR,
    exports.KNOWLEDGE_GLOBAL_MEMORY_DIR,
    exports.KNOWLEDGE_PROJECTS_MEMORY_DIR,
    exports.KNOWLEDGE_WIKI_HUBS_DIR,
    exports.KNOWLEDGE_WIKI_CONCEPTS_DIR,
    exports.KNOWLEDGE_WIKI_CLAIMS_DIR,
    exports.KNOWLEDGE_WIKI_GUIDES_DIR,
    exports.KNOWLEDGE_WIKI_REFERENCES_DIR,
    exports.KNOWLEDGE_SOURCES_WEB_DIR,
    exports.KNOWLEDGE_SOURCES_FILES_DIR,
    exports.KNOWLEDGE_SOURCES_TRANSCRIPTS_DIR,
    exports.KNOWLEDGE_SOURCES_ATTACHMENTS_DIR,
    exports.ARCHIVE_ROOT,
    exports.ARCHIVE_REVIEW_QUEUE_DIR,
];
exports.REQUIRED_KNOWLEDGE_FILES = [
    exports.KNOWLEDGE_INDEX_PATH,
    exports.KNOWLEDGE_MEMORY_INDEX_PATH,
    exports.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH,
    exports.KNOWLEDGE_PROJECTS_INDEX_PATH,
    exports.KNOWLEDGE_WIKI_INDEX_PATH,
    exports.KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
    exports.KNOWLEDGE_SOURCES_INDEX_PATH,
];
exports.GRAPH_RECOMMENDED_ENTRY = exports.KNOWLEDGE_INDEX_PATH;
exports.GRAPH_RECOMMENDED_HUBS = [
    exports.KNOWLEDGE_MEMORY_INDEX_PATH,
    exports.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH,
    exports.KNOWLEDGE_PROJECTS_INDEX_PATH,
    exports.KNOWLEDGE_WIKI_INDEX_PATH,
    exports.KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
    exports.KNOWLEDGE_SOURCES_INDEX_PATH,
];
exports.KNW_RELATED_WIKI_KEYS = ['related_wiki', 'related_wiki_notes', 'wiki_topics'];
exports.KNW_RELATED_MEMORY_KEYS = ['related_memory', 'related_memory_notes'];
exports.KNW_RELATED_SOURCE_KEYS = ['related_sources', 'related_source_notes', 'sources'];
exports.KNW_MEMORY_HUB_KEYS = ['project_hub', 'global_hub', 'parent_hub'];
exports.YAML_RELATION_KEYS = [
    'related',
    ...exports.KNW_RELATED_WIKI_KEYS,
    ...exports.KNW_RELATED_MEMORY_KEYS,
    ...exports.KNW_RELATED_SOURCE_KEYS,
    ...exports.KNW_MEMORY_HUB_KEYS,
];
exports.REQUIRED_ARCHITECTURE_ENTRIES = [
    {
        path: exports.KNOWLEDGE_INDEX_PATH,
        legacyPaths: ['04_memory/concepts/knowledge_graph_index.md'],
    },
    {
        path: exports.KNOWLEDGE_MEMORY_INDEX_PATH,
        legacyPaths: ['04_memory/index.md', '05_memory/index.md'],
    },
    {
        path: exports.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH,
    },
    {
        path: exports.KNOWLEDGE_PROJECTS_INDEX_PATH,
        legacyPaths: ['05_projects/index.md', '04_projects/index.md'],
    },
    {
        path: exports.KNOWLEDGE_WIKI_INDEX_PATH,
    },
    {
        path: exports.KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
    },
    {
        path: exports.KNOWLEDGE_SOURCES_INDEX_PATH,
        legacyPaths: ['03_sources/index.md'],
    },
];
function normalizeKnowledgePath(value) {
    const normalized = value.replace(/\\/g, '/').trim().replace(/^\.\//, '').replace(/^\/+/g, '');
    return normalized.replace(/\/+/g, '/');
}
function startsWithPathPrefix(relativePath, prefix) {
    const normalized = normalizeKnowledgePath(relativePath);
    const normalizedPrefix = normalizeKnowledgePath(prefix).replace(/\/+$/g, '');
    return normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}/`);
}
function isLegacyArchitecturePath(relativePath) {
    return isInLegacyDirectory(relativePath);
}
function isInLegacyDirectory(relativePath) {
    const normalized = normalizeKnowledgePath(relativePath);
    const topLevel = normalized.split('/')[0] || '';
    return exports.LEGACY_TOP_LEVEL_DIRS.includes(topLevel);
}
function isKnowledgeMemoryPath(relativePath) {
    return startsWithPathPrefix(relativePath, exports.KNOWLEDGE_MEMORY_DIR);
}
function isKnowledgeProjectMemoryPath(relativePath) {
    return startsWithPathPrefix(relativePath, exports.KNOWLEDGE_PROJECTS_MEMORY_DIR);
}
function isKnowledgeProjectPath(relativePath) {
    return exports.ARCHITECTURE_PROJECT_DIRS.some((projectDir) => startsWithPathPrefix(relativePath, projectDir));
}
function isKnowledgeWikiPath(relativePath) {
    return startsWithPathPrefix(relativePath, exports.KNOWLEDGE_WIKI_DIR);
}
function isKnowledgeSourcePath(relativePath) {
    return startsWithPathPrefix(relativePath, exports.KNOWLEDGE_SOURCES_DIR);
}
function projectMemoryBasePath(projectSlug) {
    const segment = normalizeSlug(projectSlug || 'project');
    return `${exports.KNOWLEDGE_PROJECTS_MEMORY_DIR}/${segment}`;
}
function projectMemoryIndexPath(projectSlug) {
    return `${projectMemoryBasePath(projectSlug)}/index.md`;
}
function projectMemoryPath(projectSlug) {
    return `${projectMemoryBasePath(projectSlug)}/memory.md`;
}
function projectDecisionsPath(projectSlug) {
    return `${projectMemoryBasePath(projectSlug)}/decisions.md`;
}
function projectSessionsPath(projectSlug) {
    return `${projectMemoryBasePath(projectSlug)}/sessions.md`;
}
function normalizeSlug(value) {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return normalized || 'item';
}
function resolvePreferredKnowledgePath(availablePaths, candidate) {
    const normalizedCandidate = normalizeKnowledgePath(candidate.path);
    if (availablePaths.has(normalizedCandidate)) {
        return normalizedCandidate;
    }
    for (const legacyPath of candidate.legacyPaths || []) {
        const normalizedLegacy = normalizeKnowledgePath(legacyPath);
        if (availablePaths.has(normalizedLegacy)) {
            return normalizedLegacy;
        }
    }
    return null;
}
