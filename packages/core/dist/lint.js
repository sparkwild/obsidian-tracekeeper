"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lintNotes = lintNotes;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const graph_health_1 = require("./graph-health");
const EXTERNAL_LINK = /^(?:https?:\/\/|mailto:|file:|ftp:)/i;
function buildLinkCandidate(vaultRoot, sourceDir, wikilinkTarget) {
    const sanitized = wikilinkTarget.replace(/\/+/g, '/').trim();
    const splitHash = sanitized.split('#', 2);
    const candidateBase = splitHash[0].trim();
    if (!candidateBase) {
        return '';
    }
    let candidatePath = candidateBase;
    if (!node_path_1.default.extname(candidatePath)) {
        candidatePath = `${candidatePath}.md`;
    }
    if (!node_path_1.default.isAbsolute(candidatePath)) {
        candidatePath = node_path_1.default.resolve(sourceDir, candidatePath);
    }
    if (!isInsideVault(vaultRoot, candidatePath)) {
        return '';
    }
    return candidatePath;
}
function isInsideVault(vaultRoot, candidatePath) {
    const root = node_path_1.default.resolve(vaultRoot);
    const candidate = node_path_1.default.resolve(candidatePath);
    const relative = node_path_1.default.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !node_path_1.default.isAbsolute(relative));
}
function hasFile(candidatePath) {
    const normalizedPath = node_path_1.default.normalize(candidatePath);
    if (!normalizedPath || !node_fs_1.default.existsSync(normalizedPath)) {
        return false;
    }
    const stat = node_fs_1.default.statSync(normalizedPath);
    return stat.isFile();
}
function lintNotes(vaultRoot, notes, options = {}) {
    const issues = [];
    for (const note of notes) {
        const sourceDir = node_path_1.default.dirname(note.absolutePath);
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
function buildGraphProfileLintIssues(report, profile) {
    const evaluation = (0, graph_health_1.evaluateGraphProfile)(report, profile ?? graph_health_1.DEFAULT_GRAPH_PROFILE);
    if (evaluation.disabled) {
        return [];
    }
    const issues = [];
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
        const paths = profileIssue.paths && profileIssue.paths.length > 0
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
