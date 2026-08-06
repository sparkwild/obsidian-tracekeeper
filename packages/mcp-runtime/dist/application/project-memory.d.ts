import { type ProjectMemoryCatalogPage, type ProjectMemoryEntry, type ProjectMemoryHubBinding, type ScanResult, type VaultRepository } from '@tracekeeper/core';
export interface ProjectMemoryHubProjection extends ProjectMemoryHubBinding {
    project_hint: string;
    backlinks: readonly string[];
}
export interface ProjectMemoryRelationProjection {
    hub_linked: boolean;
    resolved_targets: readonly string[];
    related_wiki: readonly string[];
    related_sources: readonly string[];
    backlinks: readonly string[];
}
export interface ProjectMemoryEntryProjection {
    entry: ProjectMemoryEntry;
    relations: ProjectMemoryRelationProjection;
}
export interface ProjectMemoryLegacyProjection {
    path: string;
    project_id: string;
    project_key: string;
    backlinks: readonly string[];
}
export interface ProjectMemorySnapshotProjection {
    generation: number;
    generation_source: 'native_index' | 'snapshot_fingerprint';
    index_state: 'initializing' | 'rebuilding' | 'ready' | 'filesystem_scan';
    hubs: readonly ProjectMemoryHubProjection[];
    entries: readonly ProjectMemoryEntryProjection[];
    legacy: readonly ProjectMemoryLegacyProjection[];
    unbound_hubs: readonly string[];
    issues: readonly ProjectMemorySnapshotIssue[];
}
export interface ProjectMemorySnapshotIssue {
    path: string;
    code: 'invalid_project_memory_note' | 'ambiguous_entry_ownership' | 'ambiguous_legacy_ownership' | 'project_memory_scan_error';
}
export interface ProjectMemoryIdentityInput {
    projectId?: unknown;
    projectHint?: unknown;
    repoPath?: unknown;
}
export type ProjectMemoryReviewReason = 'missing_exact_project_identity' | 'invalid_repo_path' | 'explicit_project_id_not_found' | 'conflicting_project_identity' | 'project_hint_conflict' | 'derived_project_key_occupied' | 'project_snapshot_incomplete';
export type ProjectMemoryWritableRoute = {
    status: 'existing';
    binding: ProjectMemoryHubBinding;
} | {
    status: 'materialize';
    binding: ProjectMemoryHubBinding;
    project_hint: string;
} | {
    status: 'review_required';
    reason: ProjectMemoryReviewReason;
    warnings: readonly string[];
};
export interface ProjectMemoryCatalogInput {
    projectId: string;
    cursor?: string | null;
    pageSize?: number;
}
export interface ProjectMemoryApplicationDependencies {
    repository: ProjectMemoryVaultRepository;
    loadScan(): ScanResult | Promise<ScanResult>;
    now?(): string;
}
export interface ProjectMemoryVaultRepository extends VaultRepository {
    generateMarkdownLink?(targetPath: string, sourcePath: string, subpath?: string, alias?: string): string;
}
export type ProjectMemoryHubResolution = {
    status: 'ready';
    binding: ProjectMemoryHubBinding;
    hub_status: 'existing' | 'created' | 'exact_retry';
} | {
    status: 'review_required';
    reason: ProjectMemoryReviewReason;
    warnings: readonly string[];
};
export declare class ProjectMemoryApplicationError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function projectProjectMemorySnapshot(scan: ScanResult): ProjectMemorySnapshotProjection;
export declare function resolveProjectMemoryWritableRoute(snapshot: ProjectMemorySnapshotProjection, input: ProjectMemoryIdentityInput): ProjectMemoryWritableRoute;
export declare function buildProjectMemoryCatalog(snapshot: ProjectMemorySnapshotProjection, input: ProjectMemoryCatalogInput): ProjectMemoryCatalogPage;
export declare class ProjectMemoryApplicationService {
    private readonly repository;
    private readonly loadScan;
    private readonly now;
    constructor(dependencies: ProjectMemoryApplicationDependencies);
    snapshot(): Promise<ProjectMemorySnapshotProjection>;
    listCatalog(input: ProjectMemoryCatalogInput): Promise<ProjectMemoryCatalogPage>;
    ensureWritableProject(input: ProjectMemoryIdentityInput): Promise<ProjectMemoryHubResolution>;
    private ensureWritableProjectFromSnapshot;
    private markdownLink;
}
