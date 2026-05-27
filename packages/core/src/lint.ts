import fs from 'node:fs';
import path from 'node:path';
import {
	DEFAULT_GRAPH_PROFILE,
	evaluateGraphProfile,
	type GraphHealthReport,
	type GraphProfileIssue,
} from './graph-health';
import { ScannedNote } from './scan';

export type LintIssueKind =
	| 'broken_wikilink'
	| 'claim_missing_source'
	| GraphProfileIssue['kind'];

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

const EXTERNAL_LINK = /^(?:https?:\/\/|mailto:|file:|ftp:)/i;

function buildLinkCandidate(vaultRoot: string, sourceDir: string, wikilinkTarget: string): string {
	const sanitized = wikilinkTarget.replace(/\/+/g, '/').trim();
	const splitHash = sanitized.split('#', 2);
	const candidateBase = splitHash[0].trim();
	if (!candidateBase) {
		return '';
	}
	let candidatePath = candidateBase;

	if (!path.extname(candidatePath)) {
		candidatePath = `${candidatePath}.md`;
	}
	if (!path.isAbsolute(candidatePath)) {
		candidatePath = path.resolve(sourceDir, candidatePath);
	}
	if (!isInsideVault(vaultRoot, candidatePath)) {
		return '';
	}

	return candidatePath;
}

function isInsideVault(vaultRoot: string, candidatePath: string): boolean {
	const root = path.resolve(vaultRoot);
	const candidate = path.resolve(candidatePath);
	const relative = path.relative(root, candidate);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasFile(candidatePath: string): boolean {
	const normalizedPath = path.normalize(candidatePath);
	if (!normalizedPath || !fs.existsSync(normalizedPath)) {
		return false;
	}
	const stat = fs.statSync(normalizedPath);
	return stat.isFile();
}

export function lintNotes(vaultRoot: string, notes: ScannedNote[], options: LintOptions = {}): LintReport {
	const issues: LintIssue[] = [];

	for (const note of notes) {
		const sourceDir = path.dirname(note.absolutePath);

		for (const link of note.wikilinks) {
			if (EXTERNAL_LINK.test(link.target) || link.target.includes('|')) {
				continue;
			}

			let candidate = buildLinkCandidate(vaultRoot, sourceDir, link.target);
			if (!candidate || !isInsideVault(vaultRoot, candidate)) {
				issues.push({
					severity: 'warning',
					kind: 'broken_wikilink',
					path: note.relativePath,
					line: link.line,
					message: `Broken wikilink target: ${link.target}`,
					context: link.raw,
				});
				continue;
			}

			if (!hasFile(candidate)) {
				issues.push({
					severity: 'error',
					kind: 'broken_wikilink',
					path: note.relativePath,
					line: link.line,
					message: `Broken wikilink target: ${link.target}`,
					context: link.raw,
				});
			}
		}

		for (const claim of note.claimBlocks) {
			if (claim.sourceRefs.length === 0) {
				issues.push({
					severity: 'warning',
					kind: 'claim_missing_source',
					path: note.relativePath,
					line: claim.line,
					message: 'Claim block has no source references',
					context: claim.rawHeader,
				});
			}
		}
	}

	if (options.graphHealth) {
		issues.push(...buildGraphProfileLintIssues(options.graphHealth, options.graphProfile));
	}

	return { issues };
}

function buildGraphProfileLintIssues(report: GraphHealthReport, profile: unknown): LintIssue[] {
	const evaluation = evaluateGraphProfile(report, profile ?? DEFAULT_GRAPH_PROFILE);
	if (evaluation.disabled) {
		return [];
	}

	const issues: LintIssue[] = [];
	for (const profileIssue of evaluation.profile_issues) {
		if (profileIssue.kind === 'graph_unresolved_wikilink') {
			for (const edge of report.unresolved_edges) {
				issues.push({
					severity: profileIssue.severity,
					kind: profileIssue.kind,
					path: edge.path,
					line: edge.line,
					message: `Unresolved graph wikilink target: ${edge.target}`,
					context: edge.context,
				});
			}
			continue;
		}

		const paths =
			profileIssue.paths && profileIssue.paths.length > 0
				? profileIssue.paths
				: [report.missing_recommended_entry || '04_memory/concepts/knowledge_graph_index.md'];
		for (const issuePath of paths) {
			issues.push({
				severity: profileIssue.severity,
				kind: profileIssue.kind,
				path: issuePath,
				line: 1,
				message: profileIssue.message,
				paths: profileIssue.paths,
			});
		}
	}
	return issues;
}
