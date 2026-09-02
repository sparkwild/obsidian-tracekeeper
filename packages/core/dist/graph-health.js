"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_GRAPH_PROFILE = void 0;
exports.analyzeGraphHealth = analyzeGraphHealth;
exports.normalizeGraphProfile = normalizeGraphProfile;
exports.evaluateGraphProfile = evaluateGraphProfile;
const knowledge_architecture_1 = require("./knowledge-architecture");
const wiki_governance_1 = require("./wiki-governance");
const knowledge_note_1 = require("./knowledge-note");
const DEFAULT_MAX_ITEMS = 20;
exports.DEFAULT_GRAPH_PROFILE = 'advisory';
function normalizedNoteType(note) {
    return (typeof note.type === 'string' ? note.type : '')
        .trim()
        .toLocaleLowerCase('en-US')
        .replace(/_/g, '-');
}
function shouldIncludeSemanticEdge(note, sourcePath, link) {
    if ((0, wiki_governance_1.isSourcePartPath)(sourcePath)) {
        return false;
    }
    // Source captures are immutable evidence. Their body is allowed to contain
    // arbitrary Markdown, shell tests, and local paths that must not become
    // knowledge-graph edges. Explicit frontmatter relations remain semantic.
    if (normalizedNoteType(note) === 'source-capture') {
        return link.source === 'frontmatter';
    }
    return true;
}
function analyzeGraphHealth(notes, options = {}) {
    const maxItems = normalizeMaxItems(options.maxItems);
    const allNotePathSet = new Set(notes.map((note) => normalizeRelativePath(note.relativePath)).filter(Boolean));
    const semanticNotes = options.semanticOnly === true ? notes.filter((note) => {
        const path = normalizeRelativePath(note.relativePath);
        return path.startsWith(`${knowledge_architecture_1.KNOWLEDGE_ROOT}/`) && !(0, wiki_governance_1.isSourcePartPath)(path);
    }) : notes;
    const notePaths = semanticNotes.map((note) => normalizeRelativePath(note.relativePath)).filter(Boolean);
    const notePathSet = new Set(notePaths);
    const semanticPathSet = new Set(notePaths);
    const resolvedEdges = (0, knowledge_note_1.resolveNormalizedVaultEdges)(notes.map((note) => ({
        path: note.relativePath,
        title: note.title,
        aliases: note.aliases,
        edges: note.edges,
    })));
    const outgoing = new Map();
    const incoming = new Map();
    const undirected = new Map();
    for (const notePath of notePaths) {
        outgoing.set(notePath, new Set());
        incoming.set(notePath, new Set());
        undirected.set(notePath, new Set());
    }
    let wikilinkEdgeCount = 0;
    let edgeObservationCount = 0;
    let ignoredEdgeObservationCount = 0;
    let ignoredUnresolvedEdgeCount = 0;
    let resolvedEdgeCount = 0;
    let unresolvedEdgeCount = 0;
    const unresolvedEdges = [];
    const semanticEdges = new Map();
    for (const note of notes) {
        const sourcePath = normalizeRelativePath(note.relativePath);
        if (!sourcePath) {
            continue;
        }
        for (const link of resolvedEdges.get(sourcePath) ?? note.edges) {
            if (!semanticPathSet.has(sourcePath)) {
                ignoredEdgeObservationCount += 1;
                if (link.resolution.status !== 'resolved') {
                    ignoredUnresolvedEdgeCount += 1;
                }
                continue;
            }
            if (!shouldIncludeSemanticEdge(note, sourcePath, link)) {
                ignoredEdgeObservationCount += 1;
                if (link.resolution.status !== 'resolved') {
                    ignoredUnresolvedEdgeCount += 1;
                }
                continue;
            }
            edgeObservationCount += 1;
            const key = semanticGraphEdgeKey(sourcePath, link);
            const declaredVia = link.source === 'frontmatter' ? 'frontmatter' : 'body_wikilink';
            const existing = semanticEdges.get(key);
            if (existing) {
                existing.occurrenceCount += 1;
                existing.declaredVia.add(declaredVia);
                continue;
            }
            semanticEdges.set(key, {
                link,
                path: note.relativePath,
                occurrenceCount: 1,
                declaredVia: new Set([declaredVia]),
            });
        }
    }
    for (const { link, path: sourceDisplayPath, occurrenceCount, declaredVia } of semanticEdges.values()) {
        const sourcePath = normalizeRelativePath(link.sourcePath ?? sourceDisplayPath);
        if (!sourcePath) {
            continue;
        }
        wikilinkEdgeCount += 1;
        if (link.resolution.status !== 'resolved') {
            unresolvedEdgeCount += 1;
            unresolvedEdges.push({
                path: sourceDisplayPath,
                line: link.line,
                target: link.target || link.referenceLabel || link.raw,
                context: link.raw,
                occurrence_count: occurrenceCount,
                declared_via: [...declaredVia].sort(),
            });
            continue;
        }
        const target = link.resolution.path;
        if (!notePathSet.has(target)) {
            if (allNotePathSet.has(target)) {
                continue;
            }
            if (isNativeAttachmentResolution(link.resolution)) {
                resolvedEdgeCount += 1;
                continue;
            }
            unresolvedEdgeCount += 1;
            unresolvedEdges.push({
                path: sourceDisplayPath,
                line: link.line,
                target: link.target || link.referenceLabel || link.raw,
                context: link.raw,
                occurrence_count: occurrenceCount,
                declared_via: [...declaredVia].sort(),
            });
            continue;
        }
        resolvedEdgeCount += 1;
        outgoing.get(sourcePath)?.add(target);
        incoming.get(target)?.add(sourcePath);
        if (sourcePath !== target) {
            undirected.get(sourcePath)?.add(target);
            undirected.get(target)?.add(sourcePath);
        }
    }
    const isolatedNodes = [];
    const onlyInboundNodes = [];
    const onlyOutboundNodes = [];
    const hubScores = [];
    for (const notePath of notePaths) {
        const inboundCount = incoming.get(notePath)?.size || 0;
        const outboundCount = outgoing.get(notePath)?.size || 0;
        const degree = inboundCount + outboundCount;
        if (degree === 0) {
            isolatedNodes.push(notePath);
        }
        else {
            if (inboundCount > 0 && outboundCount === 0) {
                onlyInboundNodes.push(notePath);
            }
            if (outboundCount > 0 && inboundCount === 0) {
                onlyOutboundNodes.push(notePath);
            }
        }
        if (degree > 0) {
            hubScores.push({
                path: notePath,
                degree,
                inbound: inboundCount,
                outbound: outboundCount,
            });
        }
    }
    const componentResult = computeComponents(notePaths, undirected);
    const isolatedNodeSet = new Set(isolatedNodes);
    const informationalSourceIsolates = new Set(semanticNotes
        .filter((note) => {
        const notePath = normalizeRelativePath(note.relativePath);
        return isolatedNodeSet.has(notePath)
            && normalizedNoteType(note) === 'source-capture'
            && !(0, wiki_governance_1.isSourcePartPath)(notePath);
    })
        .map((note) => normalizeRelativePath(note.relativePath)));
    const actionableIsolatedNodes = isolatedNodes.filter((notePath) => !informationalSourceIsolates.has(notePath));
    const maintenanceComponentResult = computeComponents(notePaths.filter((notePath) => !informationalSourceIsolates.has(notePath)), undirected);
    const missingRecommendedHubs = knowledge_architecture_1.GRAPH_RECOMMENDED_HUBS.filter((hub) => !notePathSet.has((0, knowledge_architecture_1.normalizeKnowledgePath)(hub))).map((hub) => hub);
    const missingRecommendedEntry = notePathSet.has((0, knowledge_architecture_1.normalizeKnowledgePath)(knowledge_architecture_1.KNOWLEDGE_WIKI_INDEX_PATH))
        ? null
        : knowledge_architecture_1.KNOWLEDGE_WIKI_INDEX_PATH;
    const hubCandidatesSorted = hubScores
        .sort((a, b) => {
        if (b.degree !== a.degree) {
            return b.degree - a.degree;
        }
        if (b.inbound !== a.inbound) {
            return b.inbound - a.inbound;
        }
        if (b.outbound !== a.outbound) {
            return b.outbound - a.outbound;
        }
        return a.path.localeCompare(b.path);
    })
        .filter((candidate) => candidate.degree >= 2);
    const recommendations = [];
    if (unresolvedEdgeCount > 0) {
        recommendations.push(`Fix ${unresolvedEdgeCount} unresolved wikilinks to improve graph connectivity.`);
    }
    if (maintenanceComponentResult.componentCount > 1) {
        recommendations.push(`Knowledge graph has ${maintenanceComponentResult.componentCount} structural components; inspect role-specific relations.`);
    }
    if (actionableIsolatedNodes.length > 0) {
        recommendations.push(`${actionableIsolatedNodes.length} structural notes are isolated from the wikilink graph.`);
    }
    // Compatibility-only structure fields remain available to older clients, but
    // directory presence is not graph health. Doctor owns missing structure and
    // role-aware maintenance candidates own Wiki parent/role recommendations.
    const sortedIsolatedNodes = isolatedNodes.sort();
    const sortedOnlyInboundNodes = onlyInboundNodes.sort();
    const sortedOnlyOutboundNodes = onlyOutboundNodes.sort();
    const sortedMissingRecommendedHubs = missingRecommendedHubs.sort();
    return {
        note_count: semanticNotes.length,
        edge_observation_count: edgeObservationCount,
        ignored_edge_observation_count: ignoredEdgeObservationCount,
        ignored_unresolved_edge_count: ignoredUnresolvedEdgeCount,
        wikilink_edge_count: wikilinkEdgeCount,
        unresolved_edges: unresolvedEdges.slice(0, maxItems),
        resolved_edge_count: resolvedEdgeCount,
        unresolved_edge_count: unresolvedEdgeCount,
        largest_component_node_count: componentResult.largestComponentSize,
        component_count: componentResult.componentCount,
        isolated_nodes: sortedIsolatedNodes.slice(0, maxItems),
        isolated_node_count: sortedIsolatedNodes.length,
        actionable_isolated_nodes: actionableIsolatedNodes.sort().slice(0, maxItems),
        actionable_isolated_node_count: actionableIsolatedNodes.length,
        maintenance_component_count: maintenanceComponentResult.componentCount,
        only_inbound_nodes: sortedOnlyInboundNodes.slice(0, maxItems),
        only_inbound_node_count: sortedOnlyInboundNodes.length,
        only_outbound_nodes: sortedOnlyOutboundNodes.slice(0, maxItems),
        only_outbound_node_count: sortedOnlyOutboundNodes.length,
        hub_candidates: hubCandidatesSorted.slice(0, maxItems),
        hub_candidate_count: hubCandidatesSorted.length,
        missing_recommended_entry: missingRecommendedEntry,
        missing_recommended_hubs: sortedMissingRecommendedHubs.slice(0, maxItems),
        missing_recommended_hub_count: sortedMissingRecommendedHubs.length,
        recommendations: recommendations.slice(0, maxItems),
        recommendation_count: recommendations.length,
    };
}
function semanticGraphEdgeKey(sourcePath, link) {
    if (link.resolution.status === 'resolved') {
        return `resolved\0${sourcePath}\0${link.resolution.path.toLocaleLowerCase('en-US')}`;
    }
    const target = (link.linkPath || link.target || link.referenceLabel || link.raw)
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/\.(?:md|markdown)$/iu, '')
        .trim()
        .toLocaleLowerCase('en-US');
    return `unresolved\0${sourcePath}\0${target}\0${link.resolution.reason}`;
}
function isNativeAttachmentResolution(resolution) {
    return resolution.authority === 'native' && !resolution.path.toLocaleLowerCase('en-US').endsWith('.md');
}
function normalizeGraphProfile(value) {
    if (typeof value !== 'string') {
        return exports.DEFAULT_GRAPH_PROFILE;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'off' || normalized === 'advisory' || normalized === 'strict') {
        return normalized;
    }
    return exports.DEFAULT_GRAPH_PROFILE;
}
function evaluateGraphProfile(report, profileValue = exports.DEFAULT_GRAPH_PROFILE) {
    const profile = normalizeGraphProfile(profileValue);
    if (profile === 'off') {
        return {
            profile,
            disabled: true,
            profile_issues: [],
        };
    }
    const strictSeverity = profile === 'strict' ? 'error' : 'warning';
    const issues = [];
    if (report.unresolved_edge_count > 0) {
        issues.push({
            severity: strictSeverity,
            kind: 'graph_unresolved_wikilink',
            message: `${report.unresolved_edge_count} wikilink(s) could not be resolved by the graph index.`,
            count: report.unresolved_edge_count,
            paths: uniquePaths(report.unresolved_edges.map((edge) => edge.path)),
        });
    }
    if (report.actionable_isolated_node_count > 0) {
        issues.push({
            severity: strictSeverity,
            kind: 'graph_isolated_node',
            message: `${report.actionable_isolated_node_count} structural note(s) are isolated from the wikilink graph.`,
            count: report.actionable_isolated_node_count,
            paths: report.actionable_isolated_nodes,
        });
    }
    if (report.maintenance_component_count > 1) {
        issues.push({
            severity: 'warning',
            kind: 'graph_disconnected',
            message: `Knowledge graph has ${report.maintenance_component_count} structural component(s).`,
            count: report.maintenance_component_count,
        });
    }
    return {
        profile,
        disabled: false,
        profile_issues: issues,
    };
}
function computeComponents(notePaths, undirected) {
    let componentCount = 0;
    let largestComponentSize = 0;
    const visited = new Set();
    for (const notePath of notePaths) {
        if (visited.has(notePath)) {
            continue;
        }
        componentCount += 1;
        let size = 0;
        const stack = [notePath];
        visited.add(notePath);
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) {
                continue;
            }
            size += 1;
            for (const neighbor of undirected.get(current) || []) {
                if (visited.has(neighbor)) {
                    continue;
                }
                visited.add(neighbor);
                stack.push(neighbor);
            }
        }
        if (size > largestComponentSize) {
            largestComponentSize = size;
        }
    }
    return { componentCount, largestComponentSize };
}
function normalizeRelativePath(value) {
    try {
        return (0, knowledge_note_1.normalizeVaultRelativePath)(value);
    }
    catch {
        return '';
    }
}
function normalizeMaxItems(raw) {
    if (!Number.isInteger(raw) || !raw || raw <= 0) {
        return DEFAULT_MAX_ITEMS;
    }
    return raw > 2000 ? 2000 : raw;
}
function uniquePaths(paths) {
    return Array.from(new Set(paths.filter(Boolean))).sort();
}
