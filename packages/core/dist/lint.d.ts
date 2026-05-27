import { type GraphHealthReport, type GraphProfileIssue } from './graph-health';
import { ScannedNote } from './scan';
export type LintIssueKind = 'broken_wikilink' | 'claim_missing_source' | GraphProfileIssue['kind'];
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
