import type { ScannedNote } from './scan';
export type LifecycleDiagnosticKind = 'memory_schema_invalid' | 'memory_claim_key_missing' | 'memory_legacy_unkeyed' | 'memory_duplicate_id' | 'memory_lifecycle_dangling_relation' | 'memory_lifecycle_cross_claim_relation' | 'memory_lifecycle_cycle' | 'memory_lifecycle_duplicate_current' | 'memory_temporal_invalid' | 'memory_verification_stale' | 'memory_verified_without_evidence' | 'memory_authority_without_evidence' | 'memory_evidence_unresolved' | 'memory_hub_missing' | 'memory_hub_unresolved' | 'memory_hub_scope_mismatch' | 'memory_project_hub_parent_missing' | 'memory_relation_body_parity' | 'memory_related_source_unresolved' | 'source_part_parent_unresolved' | 'source_part_identity_mismatch' | 'source_part_manifest_invalid' | 'storage_directory_growth';
export interface LifecycleDiagnosticIssue {
    severity: 'error' | 'warning';
    kind: LifecycleDiagnosticKind;
    path: string;
    line: number;
    message: string;
    context?: string;
    paths?: string[];
}
export interface LifecycleDiagnosticOptions {
    now?: string;
    staleAfterDays?: number;
    maxDirectoryRecords?: number;
    maxSourceParts?: number;
}
export interface LifecycleDirectoryCount {
    directory: string;
    record_count: number;
}
export interface LegacyMemoryCandidate {
    path: string;
    contentHash: string;
    scope: 'global' | 'project';
    projectId: string | null;
    suggestions: readonly [];
}
export interface LifecycleDoctorReport {
    issues: LifecycleDiagnosticIssue[];
    directory_counts: LifecycleDirectoryCount[];
    legacy_candidates: LegacyMemoryCandidate[];
}
export declare function diagnoseMemoryKnowledgeLifecycle(notes: readonly ScannedNote[], options?: LifecycleDiagnosticOptions): LifecycleDiagnosticIssue[];
export declare function buildLifecycleDoctorReport(notes: readonly ScannedNote[], options?: LifecycleDiagnosticOptions): LifecycleDoctorReport;
