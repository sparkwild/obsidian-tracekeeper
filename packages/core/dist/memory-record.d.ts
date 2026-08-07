import type { ProjectMemoryEntry } from './project-memory';
export declare const MEMORY_RECORD_SCHEMA_VERSION: 2;
export declare const MEMORY_RECORD_TYPE: "memory_record";
export type MemoryScope = 'global' | 'project';
export type MemoryAuthority = 'agent' | 'source' | 'user';
export type MemoryConfidenceLevel = 'uncertain' | 'inferred' | 'supported' | 'verified';
export type MemoryDeclaredState = 'active' | 'disputed' | 'retracted' | 'review';
export interface MemoryRecordSource {
    path: string;
    frontmatter: Readonly<Record<string, unknown>>;
    body?: string;
}
export interface MemoryRecord {
    schema_version: typeof MEMORY_RECORD_SCHEMA_VERSION;
    type: typeof MEMORY_RECORD_TYPE;
    path: string;
    memory_id: string;
    scope: MemoryScope;
    project_id: string | null;
    agent_type: string;
    operation_id: string;
    memory_kind: string;
    claim_key: string;
    authority: MemoryAuthority;
    confidence_level: MemoryConfidenceLevel;
    declared_state: MemoryDeclaredState;
    observed_at: string;
    valid_from: string | null;
    valid_to: string | null;
    last_verified_at: string | null;
    evidence: readonly string[];
    supersedes: readonly string[];
    contradicts: readonly string[];
    project_hub: string | null;
    global_hub: string | null;
    related_wiki: readonly string[];
    related_sources: readonly string[];
}
export interface BuildMemoryRecordInput extends Omit<MemoryRecord, 'schema_version' | 'type' | 'path'> {
    path: string;
    body: string;
}
export interface BuiltMemoryRecord {
    record: MemoryRecord;
    body: string;
    markdown: string;
}
export type MemoryRecordReadProjection = {
    kind: 'v2';
    record: MemoryRecord;
    legacy: false;
} | {
    kind: 'project_v1';
    legacy: true;
    path: string;
    scope: 'project';
    project_id: string;
    operation_id: string;
    claim_key: null;
    declared_state: MemoryDeclaredState;
    observed_at: string;
} | {
    kind: 'legacy_unkeyed';
    legacy: true;
    path: string;
    scope: MemoryScope;
    project_id: string | null;
    claim_key: null;
};
export declare class MemoryRecordValidationError extends Error {
    readonly code = "invalid_memory_record";
    constructor(message: string);
}
export declare function parseMemoryRecord(source: MemoryRecordSource): MemoryRecord;
export declare function buildMemoryRecord(input: BuildMemoryRecordInput): BuiltMemoryRecord;
export declare function renderMemoryRecordMarkdown(record: MemoryRecord, body: string): string;
export declare function projectMemoryEntryToReadProjection(entry: ProjectMemoryEntry): MemoryRecordReadProjection;
export declare function legacyMemoryToReadProjection(input: {
    path: string;
    scope?: MemoryScope;
    project_id?: string | null;
}): MemoryRecordReadProjection;
