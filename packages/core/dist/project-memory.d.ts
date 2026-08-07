export declare const PROJECT_MEMORY_ENTRY_SCHEMA_VERSION: 1;
export declare const PROJECT_MEMORY_ENTRY_TYPE: "project_memory_entry";
export declare const PROJECT_MEMORY_HUB_TYPE: "project_memory_index";
export declare const PROJECT_MEMORY_CATALOG_SORT: "created_at_desc_operation_id_path_asc";
export declare const PROJECT_MEMORY_DEFAULT_PAGE_SIZE = 50;
export declare const PROJECT_MEMORY_MAX_PAGE_SIZE = 200;
export type ProjectMemoryEntryStatus = 'active' | 'superseded' | 'disputed' | 'review';
export interface DerivedProjectIdentity {
    project_id: string;
    project_key: string;
    repo_path: string;
    project_hint: string;
}
export interface ProjectMemoryEntryPathInput {
    projectKey: string;
    agentType: string;
    operationKind: string;
    operationId: string;
}
export interface ProjectMemoryOperationHashInput {
    project_id: string;
    agent_type: string;
    task_id?: string | null;
    operation_id: string;
    operation_kind: string;
    memory_kinds: readonly string[];
    status: ProjectMemoryEntryStatus;
    project_hub: string;
    related_wiki?: readonly string[];
    supersedes?: readonly string[];
    body: string;
}
export interface BuildProjectMemoryEntryInput extends ProjectMemoryOperationHashInput {
    project_key: string;
    created_at: string;
}
export interface BuiltProjectMemoryEntry {
    entry: ProjectMemoryEntry;
    body: string;
}
export type ProjectMemoryOperationHashComparison = {
    status: 'exact_retry';
    operation_hash: string;
} | {
    status: 'conflict';
    existing_operation_hash: string;
    requested_operation_hash: string;
};
export interface ProjectMemorySourceNote {
    path: string;
    frontmatter: Readonly<Record<string, unknown>>;
}
export interface ProjectMemoryEntry {
    schema_version: typeof PROJECT_MEMORY_ENTRY_SCHEMA_VERSION;
    type: typeof PROJECT_MEMORY_ENTRY_TYPE;
    path: string;
    project_key: string;
    project_id: string;
    agent_type: string;
    task_id: string | null;
    operation_id: string;
    operation_kind: string;
    memory_kinds: readonly string[];
    status: ProjectMemoryEntryStatus;
    created_at: string;
    operation_hash: string;
    project_hub: string;
    related_wiki: readonly string[];
    supersedes: readonly string[];
}
export interface ProjectMemoryHubBinding {
    project_id: string;
    project_key: string;
    project_hub: string;
    repo_path: string;
}
export type ProjectMemoryNoteClassification = {
    kind: 'entry';
    path: string;
    project_key: string;
    project_id: string;
    entry: ProjectMemoryEntry;
} | {
    kind: 'legacy';
    path: string;
    project_key: string;
    project_id: string | null;
} | {
    kind: 'hub';
    path: string;
    project_key: string;
    project_id: string;
    binding: ProjectMemoryHubBinding;
} | {
    kind: 'unbound_hub';
    path: string;
    project_key: string;
} | {
    kind: 'unrelated';
    path: string;
};
export interface ProjectMemoryCatalogEntry {
    path: string;
    legacy: boolean;
    project_id: string;
    agent_type: string | null;
    operation_id: string | null;
    operation_kind: string | null;
    status: ProjectMemoryEntryStatus | null;
    operation_hash: string | null;
    created_at: string | null;
}
export interface ProjectMemoryCatalogPageInput {
    projectId: string;
    projectHub: string;
    generation: number;
    entries: readonly ProjectMemoryCatalogEntry[];
    cursor?: string | null;
    pageSize?: number;
}
export interface ProjectMemoryCatalogPage {
    project_id: string;
    project_hub: string;
    generation: number;
    total: number;
    counts_by_agent: Readonly<Record<string, number>>;
    complete: true;
    sort: typeof PROJECT_MEMORY_CATALOG_SORT;
    page: {
        page_size: number;
        next_cursor: string | null;
    };
    entries: readonly ProjectMemoryCatalogEntry[];
}
export declare class ProjectMemoryValidationError extends Error {
    readonly code = "invalid_project_memory";
    constructor(message: string);
}
export declare class ProjectMemoryCursorError extends Error {
    readonly code = "invalid_project_memory_cursor";
    constructor(message: string);
}
export declare class StaleProjectMemoryCursorError extends Error {
    readonly code = "stale_project_memory_cursor";
    readonly cursorGeneration: number;
    readonly currentGeneration: number;
    constructor(cursorGeneration: number, currentGeneration: number);
}
export declare function normalizeProjectRepositoryPath(value: string): string;
export declare function deriveProjectIdentityFromRepoPath(repoPath: string): DerivedProjectIdentity;
export declare function deriveProjectMemoryHubBindingFromRepoPath(repoPath: string): ProjectMemoryHubBinding & {
    project_hint: string;
};
export declare function normalizeProjectAgentType(value: unknown): string;
export declare function buildProjectMemoryEntryPath(input: ProjectMemoryEntryPathInput): string;
export declare function computeProjectMemoryOperationHash(input: ProjectMemoryOperationHashInput): string;
export declare function compareProjectMemoryOperationHashes(existingOperationHash: string, requestedOperationHash: string): ProjectMemoryOperationHashComparison;
export declare function buildProjectMemoryEntry(input: BuildProjectMemoryEntryInput): BuiltProjectMemoryEntry;
export declare function parseProjectMemoryEntry(source: ProjectMemorySourceNote): ProjectMemoryEntry;
export declare function parseProjectMemoryHub(source: ProjectMemorySourceNote): ProjectMemoryHubBinding;
export declare function classifyProjectMemoryNote(source: ProjectMemorySourceNote): ProjectMemoryNoteClassification;
export declare function validateProjectMemoryOwnership(bindings: readonly ProjectMemoryHubBinding[]): ProjectMemoryHubBinding[];
export declare function resolveProjectMemoryNoteOwnership(classification: Exclude<ProjectMemoryNoteClassification, {
    kind: 'unrelated' | 'unbound_hub';
}>, bindings: readonly ProjectMemoryHubBinding[]): ProjectMemoryHubBinding;
export declare function projectMemoryCatalogEntryFromClassification(classification: Extract<ProjectMemoryNoteClassification, {
    kind: 'entry' | 'legacy';
}>, binding: ProjectMemoryHubBinding): ProjectMemoryCatalogEntry;
export declare function buildProjectMemoryCatalogPage(input: ProjectMemoryCatalogPageInput): ProjectMemoryCatalogPage;
