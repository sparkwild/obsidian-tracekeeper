import { type ScanResult, type ScannedNote } from '@tracekeeper/core';
import { projectIdentityToResult, type RawProjectIdentityInput, type ResolvedProjectIdentity } from './project-identity';
export type RecallApplicationScope = 'global' | 'project' | 'project_history';
export type RecallContentOrigin = 'captured_source' | 'tracekeeper_generated' | 'vault_note';
export interface RecallRelationEvidenceItem {
    path: string;
    declared_by: string;
    declared_via: Array<'frontmatter' | 'body_wikilink'>;
    verified_by: 'active_vault_snapshot';
}
export interface RecallRelationEvidence {
    related_wiki: RecallRelationEvidenceItem[];
    related_sources: RecallRelationEvidenceItem[];
}
export interface RecallApplicationRequest {
    scope: RecallApplicationScope;
    query: string;
    maxItems: number;
    vaultRoot: string;
    projectIdentityInput: RawProjectIdentityInput;
}
export interface RecallApplicationDependencies {
    loadScan(): ScanResult;
    nowMs(): number;
    resolveProjectIdentity(input: RawProjectIdentityInput, notes: ScannedNote[]): ResolvedProjectIdentity;
    filterProjectNotes(notes: ScannedNote[], identity: ResolvedProjectIdentity): ScannedNote[];
    buildRelationEvidence(note: ScannedNote, allNotes: ScannedNote[]): RecallRelationEvidence;
    contentOrigin(relativePath: string, noteType?: string): RecallContentOrigin;
}
export interface RecallEntry {
    path: string;
    title: string;
    type?: string;
    note_type: string | null;
    scope: RecallApplicationScope;
    score: number;
    raw_score: number;
    matched_tokens: string[];
    score_reason: string[];
    why_matched: string;
    excerpt: string;
    content_origin: RecallContentOrigin;
    instruction_trust: 'data_only';
    graph_links: string[];
    relation_evidence: RecallRelationEvidence;
}
export interface ProjectHistoryEntry {
    path: string;
    title: string;
    type?: string;
    note_type: string | null;
    scope: 'project_history';
    modifiedAt: string;
    content_origin: RecallContentOrigin;
    instruction_trust: 'data_only';
    task_id: string;
    project_hint: string;
    why_matched: string;
    excerpt: string;
    graph_links: string[];
    relation_evidence: RecallRelationEvidence;
}
export interface RecallScanProvenance {
    index_state: string;
    snapshot_generation: number | null;
    snapshot_warning: string | null;
}
export interface GlobalRecallApplicationResult extends RecallScanProvenance {
    ok: true;
    read_only: true;
    scope_mode: 'global';
    query: string;
    vault_root: string;
    max_items: number;
    matched_count: number;
    matches: RecallEntry[];
}
export interface ProjectRecallApplicationResult extends RecallScanProvenance {
    ok: true;
    read_only: true;
    vault_root: string;
    query: string;
    uncertain: boolean;
    scope: ReturnType<typeof projectIdentityToResult>;
    project_identity: ReturnType<typeof projectIdentityToResult>;
    max_items: number;
    matched_count: number;
    candidates: string[];
    candidate_notes: ProjectCandidate[];
    scope_evidence: Array<Record<string, unknown>>;
    scope_mode: 'global' | 'project';
    entries: RecallEntry[];
}
export interface ProjectHistoryRecallApplicationResult extends RecallScanProvenance {
    ok: true;
    read_only: true;
    vault_root: string;
    query: string | null;
    uncertain: boolean;
    scope: ReturnType<typeof projectIdentityToResult>;
    project_identity: ReturnType<typeof projectIdentityToResult>;
    max_items: number;
    matched_count: number;
    total_matches: number;
    candidates: string[];
    candidate_notes: ProjectCandidate[];
    entries: ProjectHistoryEntry[];
}
export type RecallApplicationResult = GlobalRecallApplicationResult | ProjectRecallApplicationResult | ProjectHistoryRecallApplicationResult;
interface ProjectCandidate {
    path: string;
    title: string;
    type: string | null;
}
export declare class RecallApplicationService {
    private readonly dependencies;
    constructor(dependencies: RecallApplicationDependencies);
    execute(request: RecallApplicationRequest): RecallApplicationResult;
    private executeGlobal;
    private executeProject;
    private executeProjectHistory;
}
export {};
