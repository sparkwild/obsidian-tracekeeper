import { type GraphHealthReport, type GraphProfileIssue } from './graph-health';
import { ScannedNote } from './scan';
export type LintIssueKind = 'broken_wikilink' | 'claim_missing_source' | 'architecture_legacy_directory' | 'architecture_missing_required_path' | 'architecture_invalid_memory_path' | 'architecture_invalid_wiki_path' | 'graph_missing_memory_wiki_bridge' | 'graph_missing_wiki_memory_backlink' | 'graph_missing_project_index' | 'graph_yaml_only_relation' | 'write_policy_unstable_target' | GraphProfileIssue['kind'];
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
}
export interface LintOptions {
    graphHealth?: GraphHealthReport;
    graphProfile?: unknown;
}
export declare function lintNotes(vaultRoot: string, notes: ScannedNote[], options?: LintOptions): LintReport;
