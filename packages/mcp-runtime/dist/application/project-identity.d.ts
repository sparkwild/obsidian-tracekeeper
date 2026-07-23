import { type ScannedNote } from '@tracekeeper/core';
export interface RawProjectIdentityInput {
    project_hint?: unknown;
    project_id?: unknown;
    repo_path?: unknown;
    repo?: unknown;
    project_path?: unknown;
}
export type ProjectIdentitySource = 'explicit_project_id' | 'explicit_project_hint' | 'vault_match' | 'repo_leaf' | 'task_metadata' | 'unknown';
export type ProjectIdentityConfidence = 'exact' | 'derived' | 'uncertain';
export interface ResolvedProjectIdentity {
    projectHint: string;
    projectId: string;
    repoPath: string;
    source: ProjectIdentitySource;
    confidence: ProjectIdentityConfidence;
    warnings: string[];
}
export declare function normalizeRepositoryPath(value: string): string;
export declare function resolveProjectIdentity(raw: RawProjectIdentityInput, notes?: ScannedNote[]): ResolvedProjectIdentity;
export declare function projectIdentityToResult(identity: ResolvedProjectIdentity): {
    project_hint: string | null;
    project_id: string | null;
    repo_path: string | null;
    source: ProjectIdentitySource;
    confidence: ProjectIdentityConfidence;
    warnings: string[];
};
