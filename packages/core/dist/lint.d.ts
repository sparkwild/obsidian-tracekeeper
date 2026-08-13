import { type GraphHealthReport, type GraphProfileIssue } from './graph-health';
import { ScannedNote } from './scan';
import { type LifecycleDiagnosticKind, type LifecycleDiagnosticOptions, type LifecycleDoctorReport } from './lifecycle-diagnostics';
export type LintIssueKind = 'broken_wikilink' | 'claim_missing_source' | 'architecture_legacy_directory' | 'architecture_missing_required_path' | 'architecture_invalid_memory_path' | 'architecture_invalid_wiki_path' | 'graph_missing_memory_wiki_bridge' | 'graph_missing_wiki_memory_backlink' | 'graph_missing_project_index' | 'graph_yaml_only_relation' | 'managed_proposal_reference_ambiguous' | 'managed_proposal_reference_mismatch' | 'write_policy_unstable_target' | LifecycleDiagnosticKind | GraphProfileIssue['kind'];
export interface LintIssue {
    severity: 'error' | 'warning';
    kind: LintIssueKind;
    path: string;
    line: number;
    message: string;
    context?: string;
    paths?: string[];
}
export interface LintReport {
    issues: LintIssue[];
    doctor: Omit<LifecycleDoctorReport, 'issues'>;
}
export interface LintOptions extends LifecycleDiagnosticOptions {
    graphHealth?: GraphHealthReport;
    graphProfile?: unknown;
}
export declare function lintNotes(vaultRoot: string, notes: ScannedNote[], options?: LintOptions): LintReport;
