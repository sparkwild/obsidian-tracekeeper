import type { KnowledgeReadView } from './knowledge-index';
export declare const MAINTENANCE_SNAPSHOT_VERSION: 1;
export declare const SOURCE_ARCHIVE_PURGE_MAX_ITEMS = 100;
export declare const SOURCE_ARCHIVE_PURGE_MAX_BYTES: number;
export type MaintenanceCandidateCategory = 'wiki_role' | 'wiki_relation' | 'unassociated_source' | 'memory_lifecycle' | 'source_archive_purge';
export interface MaintenanceCandidateV1 {
    candidate_id: string;
    snapshot_generation: number;
    category: MaintenanceCandidateCategory;
    state: 'actionable' | 'informational' | 'blocked';
    risk: 'low' | 'medium' | 'high' | 'destructive';
    paths: string[];
    content_hashes: string[];
    dependencies: string[];
    reclaimable_bytes: number;
    reasons: string[];
    requestable: boolean;
}
export type MaintenanceRequestStatus = 'pending' | 'completed' | 'rejected' | 'stale';
export interface MaintenanceRequestCandidateV1 {
    candidate_id: string;
    category: MaintenanceCandidateCategory;
    state: MaintenanceCandidateV1['state'];
    risk: MaintenanceCandidateV1['risk'];
    paths: string[];
    content_hashes: string[];
    dependencies: string[];
    reasons: string[];
}
export interface MaintenanceRequestV1 {
    type: 'maintenance_request';
    schema_version: 1;
    request_id: string;
    status: MaintenanceRequestStatus;
    snapshot_generation: number;
    candidate_ids: string[];
    task_id: string | null;
    request_binding_hash: string;
    manifest_hash: string;
    candidate_manifest: MaintenanceRequestCandidateV1[];
    created_at: string;
}
export type MaintenanceRequestParseResult = {
    valid: true;
    request: MaintenanceRequestV1;
} | {
    valid: false;
    validationError: string;
};
export interface SourceArchiveEligibilityEvidenceV1 {
    verification_level?: 'metadata' | 'full';
    migration_id: string;
    archive_path: string;
    archive_content_hash: string;
    archive_bytes: number;
    replacement_part_path: string;
    replacement_part_hash: string;
    replacement_index_path: string;
    materialization_journal_completed: boolean;
    archive_journal_completed: boolean;
    archive_hash_matches_journal: boolean;
    unique_replacement: boolean;
    archive_body_occurrence_count: number;
    part_content_hash_matches: boolean;
    part_manifest_valid: boolean;
    output_hashes_valid: boolean;
    managed_relations_use_source_index: boolean;
    active_operation: boolean;
    unknown_target_occupancy: boolean;
    active_managed_archive_reference: boolean;
}
export interface MaintenanceSnapshotV1 {
    schema_version: typeof MAINTENANCE_SNAPSHOT_VERSION;
    generation: number;
    created_at: string;
    candidates: MaintenanceCandidateV1[];
    counts: Record<MaintenanceCandidateCategory, number>;
}
export interface BuildMaintenanceSnapshotOptions {
    sourceArchiveEvidence?: readonly SourceArchiveEligibilityEvidenceV1[];
    oldToNewParent?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
}
export declare function maintenanceRequestManifestHash(manifest: readonly MaintenanceRequestCandidateV1[]): string;
export declare function maintenanceRequestBindingHash(input: {
    snapshot_generation: number;
    candidate_ids: readonly string[];
    task_id: string | null;
    manifest: readonly MaintenanceRequestCandidateV1[];
}): string;
export declare function maintenanceRequestManifest(candidates: readonly MaintenanceCandidateV1[]): MaintenanceRequestCandidateV1[];
/** Parses and verifies the complete on-disk MaintenanceRequest v1 contract. */
export declare function parseMaintenanceRequestMarkdown(content: string): MaintenanceRequestParseResult;
/**
 * Builds one deterministic maintenance projection from a single knowledge-index generation.
 * It does not read files, create proposals, mutate notes, or authorize destructive work.
 */
export declare function buildMaintenanceSnapshot(view: KnowledgeReadView, options?: BuildMaintenanceSnapshotOptions): MaintenanceSnapshotV1;
export interface MaintenanceCursorV1 {
    version: 1;
    generation: number;
    profile: string;
    page_size: number;
    offset: number;
}
export declare function encodeMaintenanceCursor(cursor: MaintenanceCursorV1): string;
export declare function decodeMaintenanceCursor(value: string): MaintenanceCursorV1;
