export const TRACEKEEPER_ARCHITECTURE_VERSION = 2;

export const TRACEKEEPER_ROOT = '00_tracekeeper';
export const KNOWLEDGE_ROOT = '01_knowledge';
export const ARCHIVE_ROOT = '02_archive';

export const TRACEKEEPER_CONTROL_DIR = `${TRACEKEEPER_ROOT}/control`;
export const TRACEKEEPER_AGENT_ACTIVITY_DIR = `${TRACEKEEPER_CONTROL_DIR}/agent_activity`;
export const TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH = `${TRACEKEEPER_AGENT_ACTIVITY_DIR}/index.md`;
export const TRACEKEEPER_OPERATIONS_DIR = `${TRACEKEEPER_CONTROL_DIR}/operations`;
export const TRACEKEEPER_DASHBOARDS_DIR = `${TRACEKEEPER_CONTROL_DIR}/dashboards`;
export const LEGACY_TRACEKEEPER_AUDIT_LOG_PATH = `${TRACEKEEPER_CONTROL_DIR}/audit_log.md`;
export const TRACEKEEPER_SYSTEM_PATH = `${TRACEKEEPER_CONTROL_DIR}/system.md`;
export const TRACEKEEPER_MEMORY_POLICY_PATH = `${TRACEKEEPER_CONTROL_DIR}/memory_policy.md`;
export const TRACEKEEPER_PERMISSIONS_PATH = `${TRACEKEEPER_CONTROL_DIR}/permissions.md`;

export const TRACEKEEPER_INBOX_DIR = `${TRACEKEEPER_ROOT}/inbox`;
export const TRACEKEEPER_AGENT_REQUESTS_DIR = `${TRACEKEEPER_INBOX_DIR}/agent_requests`;
export const TRACEKEEPER_REVIEW_QUEUE_DIR = `${TRACEKEEPER_INBOX_DIR}/review_queue`;
export const TRACEKEEPER_WORK_DIR = `${TRACEKEEPER_ROOT}/work`;
export const TRACEKEEPER_TASKS_DIR = `${TRACEKEEPER_WORK_DIR}/tasks`;
export const TRACEKEEPER_SESSIONS_DIR = `${TRACEKEEPER_WORK_DIR}/sessions`;
export const TRACEKEEPER_CONTEXT_PACKS_DIR = `${TRACEKEEPER_WORK_DIR}/context_packs`;
export const TRACEKEEPER_SOURCE_ANALYSIS_DIR = `${TRACEKEEPER_WORK_DIR}/source_analysis`;

export const KNOWLEDGE_INDEX_PATH = `${KNOWLEDGE_ROOT}/index.md`;
export const KNOWLEDGE_MEMORY_DIR = `${KNOWLEDGE_ROOT}/memory`;
export const KNOWLEDGE_MEMORY_INDEX_PATH = `${KNOWLEDGE_MEMORY_DIR}/index.md`;
export const KNOWLEDGE_GLOBAL_MEMORY_DIR = `${KNOWLEDGE_MEMORY_DIR}/global`;
export const KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH = `${KNOWLEDGE_GLOBAL_MEMORY_DIR}/index.md`;
export const KNOWLEDGE_PROJECTS_MEMORY_DIR = `${KNOWLEDGE_MEMORY_DIR}/projects`;
export const KNOWLEDGE_PROJECTS_INDEX_PATH = `${KNOWLEDGE_PROJECTS_MEMORY_DIR}/index.md`;
export const KNOWLEDGE_WIKI_DIR = `${KNOWLEDGE_ROOT}/wiki`;
export const KNOWLEDGE_WIKI_INDEX_PATH = `${KNOWLEDGE_WIKI_DIR}/index.md`;
export const KNOWLEDGE_WIKI_HUBS_DIR = `${KNOWLEDGE_WIKI_DIR}/hubs`;
export const KNOWLEDGE_WIKI_HUBS_INDEX_PATH = `${KNOWLEDGE_WIKI_HUBS_DIR}/index.md`;
export const KNOWLEDGE_WIKI_CONCEPTS_DIR = `${KNOWLEDGE_WIKI_DIR}/concepts`;
export const KNOWLEDGE_WIKI_CLAIMS_DIR = `${KNOWLEDGE_WIKI_DIR}/claims`;
export const KNOWLEDGE_WIKI_GUIDES_DIR = `${KNOWLEDGE_WIKI_DIR}/guides`;
export const KNOWLEDGE_WIKI_REFERENCES_DIR = `${KNOWLEDGE_WIKI_DIR}/references`;
export const KNOWLEDGE_SOURCES_DIR = `${KNOWLEDGE_ROOT}/sources`;
export const KNOWLEDGE_SOURCES_INDEX_PATH = `${KNOWLEDGE_SOURCES_DIR}/index.md`;
export const KNOWLEDGE_SOURCES_WEB_DIR = `${KNOWLEDGE_SOURCES_DIR}/web`;
export const KNOWLEDGE_SOURCES_FILES_DIR = `${KNOWLEDGE_SOURCES_DIR}/files`;
export const KNOWLEDGE_SOURCES_TRANSCRIPTS_DIR = `${KNOWLEDGE_SOURCES_DIR}/transcripts`;
export const KNOWLEDGE_SOURCES_ATTACHMENTS_DIR = `${KNOWLEDGE_SOURCES_DIR}/attachments`;

export const ARCHIVE_REVIEW_QUEUE_DIR = `${ARCHIVE_ROOT}/review_queue`;

export const TRACEKEEPER_ARCHITECTURE_DIR = TRACEKEEPER_ROOT;
export const KNOWLEDGE_ARCHITECTURE_DIR = KNOWLEDGE_ROOT;
export const ARCHIVE_ARCHITECTURE_DIR = ARCHIVE_ROOT;
export const ARCHITECTURE_DIRS = [TRACEKEEPER_ROOT, KNOWLEDGE_ROOT, ARCHIVE_ROOT] as const;

export const LEGACY_TOP_LEVEL_DIRS = [
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
] as const;
export const LEGACY_MEMORY_DIRS = ['04_memory', '05_memory'] as const;
export const LEGACY_PROJECT_DIRS = ['04_projects', '05_projects'] as const;
export const LEGACY_SOURCE_DIRS = ['03_sources'] as const;
export const LEGACY_DIR_PREFIXES = LEGACY_TOP_LEVEL_DIRS;
export const ARCHITECTURE_PROJECT_DIRS = [KNOWLEDGE_PROJECTS_MEMORY_DIR, ...LEGACY_PROJECT_DIRS] as const;

export const REQUIRED_CONTROL_FILES = [
	TRACEKEEPER_SYSTEM_PATH,
	TRACEKEEPER_MEMORY_POLICY_PATH,
	TRACEKEEPER_PERMISSIONS_PATH,
	TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH,
] as const;

export const BASE_STRUCTURE_DIRECTORIES = [
	TRACEKEEPER_ROOT,
	TRACEKEEPER_CONTROL_DIR,
	TRACEKEEPER_AGENT_ACTIVITY_DIR,
	TRACEKEEPER_INBOX_DIR,
	TRACEKEEPER_REVIEW_QUEUE_DIR,
	TRACEKEEPER_WORK_DIR,
	KNOWLEDGE_ROOT,
	KNOWLEDGE_MEMORY_DIR,
	KNOWLEDGE_GLOBAL_MEMORY_DIR,
	KNOWLEDGE_PROJECTS_MEMORY_DIR,
	KNOWLEDGE_WIKI_DIR,
	KNOWLEDGE_WIKI_HUBS_DIR,
	KNOWLEDGE_SOURCES_DIR,
	ARCHIVE_ROOT,
] as const;

export const ON_DEMAND_STRUCTURE_DIRECTORIES = [
	TRACEKEEPER_OPERATIONS_DIR,
	TRACEKEEPER_DASHBOARDS_DIR,
	TRACEKEEPER_AGENT_REQUESTS_DIR,
	TRACEKEEPER_TASKS_DIR,
	TRACEKEEPER_SESSIONS_DIR,
	TRACEKEEPER_CONTEXT_PACKS_DIR,
	TRACEKEEPER_SOURCE_ANALYSIS_DIR,
	KNOWLEDGE_WIKI_CONCEPTS_DIR,
	KNOWLEDGE_WIKI_CLAIMS_DIR,
	KNOWLEDGE_WIKI_GUIDES_DIR,
	KNOWLEDGE_WIKI_REFERENCES_DIR,
	KNOWLEDGE_SOURCES_WEB_DIR,
	KNOWLEDGE_SOURCES_FILES_DIR,
	KNOWLEDGE_SOURCES_TRANSCRIPTS_DIR,
	KNOWLEDGE_SOURCES_ATTACHMENTS_DIR,
	ARCHIVE_REVIEW_QUEUE_DIR,
] as const;

export const REQUIRED_KNOWLEDGE_FILES = [
	KNOWLEDGE_INDEX_PATH,
	KNOWLEDGE_MEMORY_INDEX_PATH,
	KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH,
	KNOWLEDGE_PROJECTS_INDEX_PATH,
	KNOWLEDGE_WIKI_INDEX_PATH,
	KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
	KNOWLEDGE_SOURCES_INDEX_PATH,
] as const;

export const GRAPH_RECOMMENDED_ENTRY = KNOWLEDGE_INDEX_PATH;
export const GRAPH_RECOMMENDED_HUBS = [
	KNOWLEDGE_MEMORY_INDEX_PATH,
	KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH,
	KNOWLEDGE_PROJECTS_INDEX_PATH,
	KNOWLEDGE_WIKI_INDEX_PATH,
	KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
	KNOWLEDGE_SOURCES_INDEX_PATH,
] as const;

export const KNW_RELATED_WIKI_KEYS = ['related_wiki', 'related_wiki_notes', 'wiki_topics'] as const;
export const KNW_RELATED_MEMORY_KEYS = ['related_memory', 'related_memory_notes'] as const;
export const KNW_RELATED_SOURCE_KEYS = ['related_sources', 'related_source_notes', 'sources'] as const;
export const KNW_MEMORY_HUB_KEYS = ['project_hub', 'global_hub', 'parent_hub'] as const;
export const YAML_RELATION_KEYS = [
	'related',
	...KNW_RELATED_WIKI_KEYS,
	...KNW_RELATED_MEMORY_KEYS,
	...KNW_RELATED_SOURCE_KEYS,
	...KNW_MEMORY_HUB_KEYS,
] as const;

export interface ArchitecturePathCandidate {
	path: string;
	legacyPaths?: readonly string[];
}

export const REQUIRED_ARCHITECTURE_ENTRIES: readonly ArchitecturePathCandidate[] = [
	{
		path: KNOWLEDGE_INDEX_PATH,
		legacyPaths: ['04_memory/concepts/knowledge_graph_index.md'],
	},
	{
		path: KNOWLEDGE_MEMORY_INDEX_PATH,
		legacyPaths: ['04_memory/index.md', '05_memory/index.md'],
	},
	{
		path: KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH,
	},
	{
		path: KNOWLEDGE_PROJECTS_INDEX_PATH,
		legacyPaths: ['05_projects/index.md', '04_projects/index.md'],
	},
	{
		path: KNOWLEDGE_WIKI_INDEX_PATH,
	},
	{
		path: KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
	},
	{
		path: KNOWLEDGE_SOURCES_INDEX_PATH,
		legacyPaths: ['03_sources/index.md'],
	},
];

export function normalizeKnowledgePath(value: string): string {
	const normalized = value.replace(/\\/g, '/').trim().replace(/^\.\//, '').replace(/^\/+/g, '');
	return normalized.replace(/\/+/g, '/');
}

export function startsWithPathPrefix(relativePath: string, prefix: string): boolean {
	const normalized = normalizeKnowledgePath(relativePath);
	const normalizedPrefix = normalizeKnowledgePath(prefix).replace(/\/+$/g, '');
	return normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}/`);
}

export function isLegacyArchitecturePath(relativePath: string): boolean {
	return isInLegacyDirectory(relativePath);
}

export function isInLegacyDirectory(relativePath: string): boolean {
	const normalized = normalizeKnowledgePath(relativePath);
	const topLevel = normalized.split('/')[0] || '';
	return (LEGACY_TOP_LEVEL_DIRS as readonly string[]).includes(topLevel);
}

export function isKnowledgeMemoryPath(relativePath: string): boolean {
	return startsWithPathPrefix(relativePath, KNOWLEDGE_MEMORY_DIR);
}

export function isKnowledgeProjectMemoryPath(relativePath: string): boolean {
	return startsWithPathPrefix(relativePath, KNOWLEDGE_PROJECTS_MEMORY_DIR);
}

export function isKnowledgeProjectPath(relativePath: string): boolean {
	return ARCHITECTURE_PROJECT_DIRS.some((projectDir) => startsWithPathPrefix(relativePath, projectDir));
}

export function isKnowledgeWikiPath(relativePath: string): boolean {
	return startsWithPathPrefix(relativePath, KNOWLEDGE_WIKI_DIR);
}

export function isKnowledgeSourcePath(relativePath: string): boolean {
	return startsWithPathPrefix(relativePath, KNOWLEDGE_SOURCES_DIR);
}

export function projectMemoryBasePath(projectSlug: string): string {
	const segment = normalizeSlug(projectSlug || 'project');
	return `${KNOWLEDGE_PROJECTS_MEMORY_DIR}/${segment}`;
}

export function projectMemoryIndexPath(projectSlug: string): string {
	return `${projectMemoryBasePath(projectSlug)}/index.md`;
}

export function projectMemoryPath(projectSlug: string): string {
	return `${projectMemoryBasePath(projectSlug)}/memory.md`;
}

export function projectDecisionsPath(projectSlug: string): string {
	return `${projectMemoryBasePath(projectSlug)}/decisions.md`;
}

export function projectSessionsPath(projectSlug: string): string {
	return `${projectMemoryBasePath(projectSlug)}/sessions.md`;
}

export function normalizeSlug(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	return normalized || 'item';
}

export function resolvePreferredKnowledgePath(availablePaths: Set<string>, candidate: ArchitecturePathCandidate): string | null {
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
