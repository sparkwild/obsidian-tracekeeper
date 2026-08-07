import { type KnowledgeReadView, type ScanResult, type ScannedNote } from '@tracekeeper/core';
export declare const MAX_READ_VIEW_LEXICAL_CANDIDATES = 256;
export declare const MAX_READ_VIEW_GRAPH_EXPANSIONS = 64;
export declare const MAX_READ_VIEW_RERANKED_ROWS = 32;
export type RecallApplicationScope = 'global' | 'project' | 'project_history' | 'task_history';
export type RecallContentOrigin = 'captured_source' | 'tracekeeper_generated' | 'vault_note';
export interface RecallProjectIdentityInput {
    project_hint?: unknown;
    project_id?: unknown;
    repo_path?: unknown;
    repo?: unknown;
    project_path?: unknown;
}
export interface RecallProjectIdentity {
    projectHint: string;
    projectId: string;
    repoPath: string;
    source: 'explicit_project_id' | 'explicit_project_hint' | 'vault_match' | 'repo_leaf' | 'task_metadata' | 'unknown';
    confidence: 'exact' | 'derived' | 'uncertain';
    warnings: string[];
}
export interface RecallProjectIdentityResult {
    project_hint: string | null;
    project_id: string | null;
    repo_path: string | null;
    source: RecallProjectIdentity['source'];
    confidence: RecallProjectIdentity['confidence'];
    warnings: string[];
}
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
    projectIdentityInput: RecallProjectIdentityInput;
    taskId?: string;
}
export interface RecallApplicationDependencies {
    loadScan(): ScanResult;
    nowMs(): number;
    resolveProjectIdentity(input: RecallProjectIdentityInput, notes: ScannedNote[]): RecallProjectIdentity;
    filterProjectNotes(notes: ScannedNote[], identity: RecallProjectIdentity): ScannedNote[];
    buildRelationEvidence(note: ScannedNote, allNotes: ScannedNote[]): RecallRelationEvidence;
    contentOrigin(relativePath: string, noteType?: string): RecallContentOrigin;
    onReadViewDiagnostics?(diagnostics: RecallReadViewDiagnostics): void;
}
export interface RecallReadViewDiagnostics {
    lexical_candidates: number;
    graph_expansions: number;
    reranked_rows: number;
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
    scope: RecallProjectIdentityResult;
    project_identity: RecallProjectIdentityResult;
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
    scope: RecallProjectIdentityResult;
    project_identity: RecallProjectIdentityResult;
    max_items: number;
    matched_count: number;
    total_matches: number;
    candidates: string[];
    candidate_notes: ProjectCandidate[];
    entries: ProjectHistoryEntry[];
}
export interface TaskHistoryEntry {
    path: string;
    task_path: string;
    session_path: string | null;
    title: string;
    note_type: string | null;
    scope: 'task_history';
    modifiedAt: string;
    task_id: string;
    status: string | null;
    objective: string;
    summary: string;
    project_hint: string | null;
    project_id: string | null;
    repo_path: string | null;
    why_matched: string;
    excerpt: string;
    content_origin: RecallContentOrigin;
    instruction_trust: 'data_only';
    graph_links: string[];
    relation_evidence: RecallRelationEvidence;
}
export interface TaskHistoryRecallApplicationResult extends RecallScanProvenance {
    ok: true;
    read_only: true;
    vault_root: string;
    query: string | null;
    task_id: string | null;
    max_items: number;
    matched_count: number;
    total_matches: number;
    scope_mode: 'task_history';
    entries: TaskHistoryEntry[];
}
export type RecallApplicationResult = GlobalRecallApplicationResult | ProjectRecallApplicationResult | ProjectHistoryRecallApplicationResult | TaskHistoryRecallApplicationResult;
interface ProjectCandidate {
    path: string;
    title: string;
    type: string | null;
}
export declare class RecallApplicationService {
    private readonly dependencies;
    constructor(dependencies: RecallApplicationDependencies);
    execute(request: RecallApplicationRequest): RecallApplicationResult;
    executeReadView(request: RecallApplicationRequest & {
        scope: 'global';
    }, view: KnowledgeReadView): GlobalRecallApplicationResult;
    executeReadView(request: RecallApplicationRequest & {
        scope: 'project';
    }, view: KnowledgeReadView): ProjectRecallApplicationResult;
    executeReadView(request: RecallApplicationRequest & {
        scope: 'project_history';
    }, view: KnowledgeReadView): ProjectHistoryRecallApplicationResult;
    executeReadView(request: RecallApplicationRequest & {
        scope: 'task_history';
    }, view: KnowledgeReadView): TaskHistoryRecallApplicationResult;
    executeReadView(request: RecallApplicationRequest, view: KnowledgeReadView): RecallApplicationResult;
    private executeGlobal;
    private executeProject;
    private executeProjectHistory;
    private executeTaskHistory;
}
export {};
