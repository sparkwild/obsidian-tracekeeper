"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lintNotes = lintNotes;
const node_path_1 = __importDefault(require("node:path"));
const graph_health_1 = require("./graph-health");
const knowledge_architecture_1 = require("./knowledge-architecture");
const knowledge_note_1 = require("./knowledge-note");
const lifecycle_diagnostics_1 = require("./lifecycle-diagnostics");
const EXTERNAL_LINK = /^(?:https?:\/\/|mailto:|file:|ftp:)/i;
function readListLikeFrontmatter(note, keys) {
    const values = [];
    for (const key of keys) {
        const value = note.frontmatter[key];
        if (typeof value === 'string') {
            if (value.trim()) {
                values.push(value.trim());
            }
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === 'string' && item.trim()) {
                    values.push(item.trim());
                }
            }
        }
    }
    return [...new Set(values)];
}
function buildRelationCandidate(raw, sourcePath) {
    const bracketMatch = raw.match(/^\[\[(.*?)\]\]$/);
    let candidate = (bracketMatch ? bracketMatch[1] : raw).split('|', 2)[0].trim();
    candidate = candidate.split('#', 2)[0].trim();
    if (!candidate) {
        return '';
    }
    candidate = candidate.replace(/\\/g, '/').trim();
    if (candidate.startsWith('./') || candidate.startsWith('../')) {
        candidate = node_path_1.default.posix.join(node_path_1.default.posix.dirname(sourcePath), candidate);
    }
    candidate = candidate.replace(/^\/+/g, '').replace(/\/+/g, '/');
    candidate = node_path_1.default.posix.normalize(candidate);
    if (!candidate || candidate === '.') {
        return '';
    }
    if (!node_path_1.default.posix.extname(candidate)) {
        candidate = `${candidate}.md`;
    }
    return (0, knowledge_architecture_1.normalizeKnowledgePath)(candidate);
}
function normalizeWikilinkOrPlainRelation(raw) {
    const bracketMatch = raw.match(/^\[\[(.*?)\]\]$/);
    return (bracketMatch ? bracketMatch[1] : raw).split('|', 2)[0].trim();
}
function readPathIndex(notes) {
    const noteByLowerPath = new Map();
    const noteNoExtByLowerPath = new Map();
    const basenameToLowerPaths = new Map();
    for (const note of notes) {
        const normalized = (0, knowledge_architecture_1.normalizeKnowledgePath)(note.relativePath);
        if (!normalized) {
            continue;
        }
        const lower = normalized.toLowerCase();
        noteByLowerPath.set(lower, normalized);
        noteNoExtByLowerPath.set(stripKnownExtension(lower), normalized);
        const basename = node_path_1.default.posix.basename(stripKnownExtension(lower));
        const current = basenameToLowerPaths.get(basename) || [];
        if (!current.includes(lower)) {
            current.push(lower);
            basenameToLowerPaths.set(basename, current);
        }
    }
    return { noteByLowerPath, noteNoExtByLowerPath, basenameToLowerPaths };
}
function isPathLikeRelation(raw) {
    return raw.includes('/') || raw.includes('\\') || raw.includes('.md') || raw.includes('.markdown');
}
function hasBodyWikilinkReference(note, ref, sourcePath, paths) {
    const resolvedRef = resolveReference(ref, sourcePath, paths) || buildRelationCandidate(ref, sourcePath);
    if (!resolvedRef) {
        return false;
    }
    const normalizedRef = (0, knowledge_architecture_1.normalizeKnowledgePath)(stripKnownExtension(resolvedRef.toLowerCase()));
    return note.wikilinks.some((link) => {
        if (link.source !== 'body') {
            return false;
        }
        const resolvedLink = resolveReference(link.target, sourcePath, paths) || buildRelationCandidate(link.target, sourcePath);
        if (!resolvedLink) {
            return false;
        }
        return (0, knowledge_architecture_1.normalizeKnowledgePath)(stripKnownExtension(resolvedLink.toLowerCase())) === normalizedRef;
    });
}
function resolveReference(raw, sourcePath, paths) {
    const candidate = buildRelationCandidate(raw, sourcePath);
    if (!candidate) {
        return null;
    }
    const candidateLower = candidate.toLowerCase();
    if (paths.noteByLowerPath.has(candidateLower)) {
        return paths.noteByLowerPath.get(candidateLower) || null;
    }
    const candidateNoExt = stripKnownExtension(candidateLower);
    if (paths.noteNoExtByLowerPath.has(candidateNoExt)) {
        return paths.noteNoExtByLowerPath.get(candidateNoExt) || null;
    }
    const alias = node_path_1.default.posix.basename(candidateNoExt);
    const aliases = paths.basenameToLowerPaths.get(alias);
    if (aliases && aliases.length === 1) {
        return aliases[0] || null;
    }
    return null;
}
function getSourceType(note) {
    const normalizedPath = (0, knowledge_architecture_1.normalizeKnowledgePath)(note.relativePath);
    const type = typeof note.type === 'string' ? note.type.toLowerCase() : '';
    return {
        isMemory: (0, knowledge_architecture_1.isKnowledgeMemoryPath)(normalizedPath) || type === 'memory',
        isWiki: (0, knowledge_architecture_1.isKnowledgeWikiPath)(normalizedPath) || type === 'wiki',
    };
}
function addRelationEdge(sourceToTargets, relationSource, source, target, line, sourceType, edges) {
    let targets = sourceToTargets.get(source);
    if (!targets) {
        targets = new Set();
        sourceToTargets.set(source, targets);
    }
    targets.add(target);
    edges.push({
        source,
        target,
        line,
        sourceType,
        relationSource,
    });
}
function collectProjectIndexIssues(notes) {
    const projectHasNotes = new Map();
    for (const note of notes) {
        const normalized = (0, knowledge_architecture_1.normalizeKnowledgePath)(note.relativePath);
        if (!normalized || !(0, knowledge_architecture_1.isKnowledgeProjectPath)(normalized)) {
            continue;
        }
        for (const projectDir of knowledge_architecture_1.ARCHITECTURE_PROJECT_DIRS) {
            if (!normalized.startsWith(`${projectDir}/`)) {
                continue;
            }
            const suffix = normalized.slice(projectDir.length + 1);
            const projectSegment = suffix.split('/', 1)[0];
            if (!projectSegment) {
                continue;
            }
            const projectRoot = `${projectDir}/${projectSegment}`;
            const state = projectHasNotes.get(projectRoot) || { hasIndex: false, hasAnyNote: false };
            if (normalized === `${projectRoot}/index.md`) {
                state.hasIndex = true;
            }
            else if (!normalized.endsWith('/index.md')) {
                state.hasAnyNote = true;
            }
            projectHasNotes.set(projectRoot, state);
        }
    }
    const issues = [];
    for (const [projectRoot, state] of projectHasNotes.entries()) {
        if (state.hasAnyNote && !state.hasIndex) {
            issues.push({
                severity: 'warning',
                kind: 'graph_missing_project_index',
                path: `${projectRoot}/index.md`,
                line: 1,
                message: `Missing required project index note: ${projectRoot}/index.md`,
                paths: [projectRoot],
            });
        }
    }
    return issues;
}
function getRequiredEntries(notePathSet) {
    const requiredEntries = [];
    for (const candidate of knowledge_architecture_1.REQUIRED_ARCHITECTURE_ENTRIES) {
        const resolvedPath = (0, knowledge_architecture_1.resolvePreferredKnowledgePath)(notePathSet, candidate);
        if (!resolvedPath) {
            requiredEntries.push((0, knowledge_architecture_1.normalizeKnowledgePath)(candidate.path));
        }
    }
    return requiredEntries;
}
function readManagedProposalValues(note, key) {
    const raw = note.frontmatter[key];
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    return values
        .filter((value) => typeof value === 'string')
        .flatMap((value) => value.split(/[\n,]/u))
        .map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
}
function managedProposalMarkers(proposalId) {
    const normalized = proposalId.toLocaleLowerCase('en-US');
    return [...new Set([
            normalized.replace(/[^a-z0-9_-]+/g, '-'),
            normalized.replace(/[^a-z0-9-]+/g, '-'),
        ].map((value) => value.replace(/^-+|-+$/g, '').slice(0, 80))
            .filter(Boolean)
            .map((value) => `^tracekeeper-proposal-${value}`))];
}
function normalizeManagedProposalPath(value) {
    return (0, knowledge_architecture_1.normalizeKnowledgePath)(value)
        .replace(/^['"]|['"]$/g, '')
        .toLocaleLowerCase('en-US');
}
function collectManagedProposalReferenceIssues(note, edges) {
    const type = (note.type ?? '').toLocaleLowerCase('en-US').replace(/_/g, '-');
    if (type !== 'agent-task' && type !== 'session-note') {
        return [];
    }
    const proposalIds = readManagedProposalValues(note, 'proposal_ids');
    const proposalPaths = readManagedProposalValues(note, 'proposal_paths');
    const proposalLinks = readManagedProposalValues(note, 'proposal_links');
    if (proposalIds.length === 0 && proposalPaths.length === 0 && proposalLinks.length === 0) {
        return [];
    }
    const duplicateIds = new Set(proposalIds).size !== proposalIds.length;
    const duplicatePaths = new Set(proposalPaths.map(normalizeManagedProposalPath)).size !== proposalPaths.length;
    if (proposalIds.length !== proposalPaths.length
        || proposalIds.some((value) => !value)
        || proposalPaths.some((value) => !normalizeManagedProposalPath(value))
        || duplicateIds
        || duplicatePaths
        || proposalLinks.length !== proposalIds.length) {
        return [{
                severity: 'warning',
                kind: 'managed_proposal_reference_ambiguous',
                path: note.relativePath,
                line: 1,
                message: 'Managed proposal references must contain unique, positionally aligned ids, paths, and links.',
                context: `proposal_ids=${proposalIds.length}, proposal_paths=${proposalPaths.length}, proposal_links=${proposalLinks.length}`,
            }];
    }
    const bodyLines = note.text.split(/\r?\n/u);
    const issues = [];
    for (let index = 0; index < proposalIds.length; index += 1) {
        const proposalId = proposalIds[index] ?? '';
        const expectedPath = normalizeManagedProposalPath(proposalPaths[index] ?? '');
        const markers = managedProposalMarkers(proposalId);
        const bodyLineIndexes = bodyLines
            .map((line, lineIndex) => markers.some((marker) => line.includes(marker)) ? lineIndex + 1 : 0)
            .filter((line) => line > 0);
        const frontmatterMatches = edges.filter((edge) => edge.source === 'frontmatter'
            && edge.resolution.status === 'resolved'
            && normalizeManagedProposalPath(edge.resolution.path) === expectedPath);
        const bodyMatches = edges.filter((edge) => edge.source === 'body'
            && bodyLineIndexes.includes(edge.line)
            && edge.resolution.status === 'resolved'
            && normalizeManagedProposalPath(edge.resolution.path) === expectedPath);
        if (frontmatterMatches.length !== 1 || bodyLineIndexes.length !== 1 || bodyMatches.length !== 1) {
            issues.push({
                severity: 'warning',
                kind: 'managed_proposal_reference_mismatch',
                path: note.relativePath,
                line: bodyLineIndexes[0] ?? 1,
                message: `Managed proposal reference mirror does not resolve consistently: ${proposalId}`,
                context: proposalPaths[index],
                paths: [proposalPaths[index] ?? ''].filter(Boolean),
            });
        }
    }
    return issues;
}
function lintNotes(vaultRoot, notes, options = {}) {
    const issues = [];
    const graphProfile = (0, graph_health_1.normalizeGraphProfile)(options.graphProfile);
    const strictStructureSeverity = graphProfile === 'strict' ? 'error' : 'warning';
    const graphStructureEnabled = graphProfile !== 'off';
    const resolvedEdges = (0, knowledge_note_1.resolveNormalizedVaultEdges)(notes.map((note) => ({
        path: note.relativePath,
        title: note.title,
        aliases: note.aliases,
        edges: note.edges,
    })));
    const pathIndex = readPathIndex(notes);
    const notePathSet = new Set(notes.map((note) => (0, knowledge_architecture_1.normalizeKnowledgePath)(note.relativePath)).filter(Boolean));
    const memoryToWikiYamlEdges = [];
    const memoryToWikiLinkEdges = [];
    const wikiToMemoryYamlEdges = [];
    const wikiToMemoryLinkEdges = [];
    const memoryToWikiYamlBySource = new Map();
    const memoryToWikiLinkBySource = new Map();
    const wikiToMemoryYamlBySource = new Map();
    const wikiToMemoryLinkBySource = new Map();
    for (const originalNote of notes) {
        const normalizedPath = (0, knowledge_architecture_1.normalizeKnowledgePath)(originalNote.relativePath);
        if (!normalizedPath) {
            continue;
        }
        const semanticEdges = [...(resolvedEdges.get(normalizedPath) ?? originalNote.edges)];
        const note = {
            ...originalNote,
            edges: semanticEdges,
            wikilinks: semanticEdges,
        };
        issues.push(...collectManagedProposalReferenceIssues(note, semanticEdges));
        const sourceKinds = getSourceType(note);
        if ((0, knowledge_architecture_1.isInLegacyDirectory)(normalizedPath)) {
            issues.push({
                severity: 'warning',
                kind: 'architecture_legacy_directory',
                path: note.relativePath,
                line: 1,
                message: `Legacy directory detected: ${normalizedPath}. Prefer ${knowledge_architecture_1.ARCHITECTURE_DIRS.join(', ')} layout.`,
            });
        }
        for (const link of note.wikilinks) {
            if (link.source === 'frontmatter' || EXTERNAL_LINK.test(link.target) || link.target.includes('|')) {
                continue;
            }
            if (link.resolution.status !== 'resolved') {
                const unresolvedTarget = link.target || link.referenceLabel || link.raw;
                issues.push({
                    severity: link.resolution.reason === 'unsafe_path' ? 'warning' : 'error',
                    kind: 'broken_wikilink',
                    path: note.relativePath,
                    line: link.line,
                    message: `Broken wikilink target: ${unresolvedTarget}`,
                    context: link.raw,
                });
                continue;
            }
            const targetRelative = (0, knowledge_architecture_1.normalizeKnowledgePath)(link.resolution.path);
            if (sourceKinds.isMemory && (0, knowledge_architecture_1.isKnowledgeWikiPath)(targetRelative)) {
                addRelationEdge(memoryToWikiLinkBySource, 'wikilink', normalizedPath, targetRelative, link.line, 'memory', memoryToWikiLinkEdges);
            }
            else if (sourceKinds.isWiki && (0, knowledge_architecture_1.isKnowledgeMemoryPath)(targetRelative)) {
                addRelationEdge(wikiToMemoryLinkBySource, 'wikilink', normalizedPath, targetRelative, link.line, 'wiki', wikiToMemoryLinkEdges);
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
        const relatedWikis = readListLikeFrontmatter(note, knowledge_architecture_1.KNW_RELATED_WIKI_KEYS);
        if (sourceKinds.isMemory && relatedWikis.length > 0) {
            for (const ref of relatedWikis) {
                const relationCandidate = buildRelationCandidate(ref, normalizedPath);
                if (isPathLikeRelation(ref) && relationCandidate && !(0, knowledge_architecture_1.isKnowledgeWikiPath)(relationCandidate)) {
                    issues.push({
                        severity: strictStructureSeverity,
                        kind: 'architecture_invalid_wiki_path',
                        path: note.relativePath,
                        line: 1,
                        message: `Invalid wiki relation path for memory note: ${ref}`,
                        context: ref,
                    });
                }
                const resolved = resolveReference(ref, normalizedPath, pathIndex);
                if (!resolved) {
                    continue;
                }
                const resolvedByFrontmatter = (0, knowledge_architecture_1.normalizeKnowledgePath)(resolved);
                if (!(0, knowledge_architecture_1.isKnowledgeWikiPath)(resolvedByFrontmatter)) {
                    issues.push({
                        severity: strictStructureSeverity,
                        kind: 'architecture_invalid_wiki_path',
                        path: note.relativePath,
                        line: 1,
                        message: `Invalid wiki relation path for memory note: ${ref}`,
                        context: ref,
                    });
                    continue;
                }
                addRelationEdge(memoryToWikiYamlBySource, 'yaml', normalizedPath, resolvedByFrontmatter, 1, 'memory', memoryToWikiYamlEdges);
            }
        }
        const relatedMemories = readListLikeFrontmatter(note, knowledge_architecture_1.KNW_RELATED_MEMORY_KEYS);
        if (sourceKinds.isWiki && relatedMemories.length > 0) {
            for (const ref of relatedMemories) {
                const relationCandidate = buildRelationCandidate(ref, normalizedPath);
                if (isPathLikeRelation(ref) && relationCandidate && !(0, knowledge_architecture_1.isKnowledgeMemoryPath)(relationCandidate)) {
                    issues.push({
                        severity: strictStructureSeverity,
                        kind: 'architecture_invalid_memory_path',
                        path: note.relativePath,
                        line: 1,
                        message: `Invalid memory relation path for wiki note: ${ref}`,
                        context: ref,
                    });
                }
                const resolved = resolveReference(ref, normalizedPath, pathIndex);
                if (!resolved) {
                    continue;
                }
                const resolvedByFrontmatter = (0, knowledge_architecture_1.normalizeKnowledgePath)(resolved);
                if (!(0, knowledge_architecture_1.isKnowledgeMemoryPath)(resolvedByFrontmatter)) {
                    issues.push({
                        severity: strictStructureSeverity,
                        kind: 'architecture_invalid_memory_path',
                        path: note.relativePath,
                        line: 1,
                        message: `Invalid memory relation path for wiki note: ${ref}`,
                        context: ref,
                    });
                    continue;
                }
                addRelationEdge(wikiToMemoryYamlBySource, 'yaml', normalizedPath, resolvedByFrontmatter, 1, 'wiki', wikiToMemoryYamlEdges);
            }
        }
        for (const ref of readListLikeFrontmatter(note, knowledge_architecture_1.YAML_RELATION_KEYS)) {
            const normalizedRef = normalizeWikilinkOrPlainRelation(ref);
            if (!normalizedRef || EXTERNAL_LINK.test(normalizedRef)) {
                continue;
            }
            if (!isPathLikeRelation(normalizedRef) && !resolveReference(normalizedRef, normalizedPath, pathIndex)) {
                continue;
            }
            if (graphStructureEnabled && !hasBodyWikilinkReference(note, normalizedRef, normalizedPath, pathIndex)) {
                issues.push({
                    severity: 'warning',
                    kind: 'graph_yaml_only_relation',
                    path: note.relativePath,
                    line: 1,
                    message: `YAML relation should also be represented as a body wikilink: ${normalizedRef}`,
                    context: normalizedRef,
                });
            }
        }
    }
    for (const [source, targets] of memoryToWikiYamlBySource.entries()) {
        const wikiTargets = targets;
        for (const target of wikiTargets) {
            if (graphStructureEnabled && !memoryToWikiLinkBySource.get(source)?.has(target)) {
                issues.push({
                    severity: strictStructureSeverity,
                    kind: 'graph_missing_memory_wiki_bridge',
                    path: source,
                    line: 1,
                    message: `Memory note requires wikilink bridge to wiki note: ${target}`,
                    context: target,
                    paths: [target],
                });
            }
        }
    }
    for (const [source, targets] of memoryToWikiLinkBySource.entries()) {
        const wikiTargets = targets;
        for (const target of wikiTargets) {
            if (graphStructureEnabled && !memoryToWikiYamlBySource.get(source)?.has(target)) {
                issues.push({
                    severity: 'warning',
                    kind: 'graph_yaml_only_relation',
                    path: source,
                    line: 1,
                    message: `Wikilink to wiki should have related_wiki relation in YAML: ${target}`,
                    context: target,
                    paths: [target],
                });
            }
        }
    }
    for (const [memorySource, wikiTargets] of memoryToWikiYamlBySource.entries()) {
        for (const wikiTarget of wikiTargets) {
            const hasBacklink = wikiToMemoryYamlBySource.get(wikiTarget)?.has(memorySource) ||
                wikiToMemoryLinkBySource.get(wikiTarget)?.has(memorySource);
            if (graphStructureEnabled && !hasBacklink) {
                issues.push({
                    severity: 'warning',
                    kind: 'graph_missing_wiki_memory_backlink',
                    path: wikiTarget,
                    line: 1,
                    message: `Wiki note ${wikiTarget} has no backlink to memory note ${memorySource}`,
                    context: memorySource,
                    paths: [memorySource],
                });
            }
        }
    }
    if (graphStructureEnabled) {
        issues.push(...collectProjectIndexIssues(notes));
    }
    const requiredEntries = getRequiredEntries(notePathSet);
    for (const entryPath of requiredEntries) {
        issues.push({
            severity: strictStructureSeverity,
            kind: 'architecture_missing_required_path',
            path: entryPath,
            line: 1,
            message: `Required architecture entry note is missing: ${entryPath}`,
        });
    }
    if (options.graphHealth) {
        issues.push(...buildGraphProfileLintIssues(options.graphHealth, options.graphProfile));
    }
    const lifecycleDoctor = (0, lifecycle_diagnostics_1.buildLifecycleDoctorReport)(notes, options);
    issues.push(...lifecycleDoctor.issues);
    return {
        issues,
        doctor: {
            directory_counts: lifecycleDoctor.directory_counts,
            legacy_candidates: lifecycleDoctor.legacy_candidates,
        },
    };
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
            : [knowledge_architecture_1.GRAPH_RECOMMENDED_ENTRY];
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
function stripKnownExtension(value) {
    const extension = node_path_1.default.posix.extname(value).toLowerCase();
    if (extension === '.md' || extension === '.markdown') {
        return value.slice(0, -extension.length);
    }
    return value;
}
