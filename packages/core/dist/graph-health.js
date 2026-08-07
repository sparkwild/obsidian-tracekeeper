"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_GRAPH_PROFILE = void 0;
exports.analyzeGraphHealth = analyzeGraphHealth;
exports.normalizeGraphProfile = normalizeGraphProfile;
exports.evaluateGraphProfile = evaluateGraphProfile;
const knowledge_architecture_1 = require("./knowledge-architecture");
const knowledge_note_1 = require("./knowledge-note");
const DEFAULT_MAX_ITEMS = 20;
exports.DEFAULT_GRAPH_PROFILE = 'advisory';
function analyzeGraphHealth(notes, options = {}) {
    const maxItems = normalizeMaxItems(options.maxItems);
    const notePaths = notes.map((note) => normalizeRelativePath(note.relativePath)).filter(Boolean);
    const notePathSet = new Set(notePaths);
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
    let resolvedEdgeCount = 0;
    let unresolvedEdgeCount = 0;
    const unresolvedEdges = [];
    for (const note of notes) {
        const sourcePath = normalizeRelativePath(note.relativePath);
        if (!sourcePath) {
            continue;
        }
        for (const link of resolvedEdges.get(sourcePath) ?? note.edges) {
            wikilinkEdgeCount += 1;
            if (link.resolution.status !== 'resolved') {
                unresolvedEdgeCount += 1;
                unresolvedEdges.push({
                    path: note.relativePath,
                    line: link.line,
                    target: link.target || link.referenceLabel || link.raw,
                    context: link.raw,
                });
                continue;
            }
            const target = link.resolution.path;
            if (!notePathSet.has(target)) {
                if (isNativeAttachmentResolution(link.resolution)) {
                    resolvedEdgeCount += 1;
                    continue;
                }
                unresolvedEdgeCount += 1;
                unresolvedEdges.push({
                    path: note.relativePath,
                    line: link.line,
                    target: link.target || link.referenceLabel || link.raw,
                    context: link.raw,
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
    const missingRecommendedHubs = knowledge_architecture_1.GRAPH_RECOMMENDED_HUBS.filter((hub) => !notePathSet.has((0, knowledge_architecture_1.normalizeKnowledgePath)(hub))).map((hub) => hub);
    const missingRecommendedEntry = notePathSet.has((0, knowledge_architecture_1.normalizeKnowledgePath)(knowledge_architecture_1.GRAPH_RECOMMENDED_ENTRY))
        ? null
        : knowledge_architecture_1.GRAPH_RECOMMENDED_ENTRY;
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
    if (componentResult.componentCount > 1) {
        recommendations.push(`Graph has ${componentResult.componentCount} components; add cross-component links for better reachability.`);
    }
    if (isolatedNodes.length > 0) {
        recommendations.push(`${isolatedNodes.length} notes are isolated from wikilink graph.`);
    }
    if (onlyInboundNodes.length > 0) {
        recommendations.push(`There are ${onlyInboundNodes.length} notes with only inbound links (potential sinks).`);
    }
    if (onlyOutboundNodes.length > 0) {
        recommendations.push(`There are ${onlyOutboundNodes.length} notes with only outbound links (potential sources).`);
    }
    if (missingRecommendedEntry) {
        recommendations.push(`Missing recommended graph entry: ${missingRecommendedEntry}`);
    }
    for (const hub of missingRecommendedHubs) {
        recommendations.push(`Missing recommended hub: ${hub}`);
    }
    if (componentResult.componentCount === 1 && unresolvedEdgeCount === 0 && recommendations.length === 0) {
        recommendations.push('Graph is connected and links are largely resolved.');
    }
    const sortedIsolatedNodes = isolatedNodes.sort();
    const sortedOnlyInboundNodes = onlyInboundNodes.sort();
    const sortedOnlyOutboundNodes = onlyOutboundNodes.sort();
    const sortedMissingRecommendedHubs = missingRecommendedHubs.sort();
    return {
        note_count: notes.length,
        wikilink_edge_count: wikilinkEdgeCount,
        unresolved_edges: unresolvedEdges.slice(0, maxItems),
        resolved_edge_count: resolvedEdgeCount,
        unresolved_edge_count: unresolvedEdgeCount,
        largest_component_node_count: componentResult.largestComponentSize,
        component_count: componentResult.componentCount,
        isolated_nodes: sortedIsolatedNodes.slice(0, maxItems),
        isolated_node_count: sortedIsolatedNodes.length,
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
    if (report.missing_recommended_entry) {
        issues.push({
            severity: strictSeverity,
            kind: 'graph_missing_entry',
            message: `Missing graph entry note: ${report.missing_recommended_entry}`,
            count: 1,
            paths: [report.missing_recommended_entry],
        });
    }
    if (report.missing_recommended_hub_count > 0) {
        issues.push({
            severity: strictSeverity,
            kind: 'graph_missing_hub',
            message: `${report.missing_recommended_hub_count} recommended graph hub note(s) are missing.`,
            count: report.missing_recommended_hub_count,
            paths: report.missing_recommended_hubs,
        });
    }
    if (report.isolated_node_count > 0) {
        issues.push({
            severity: strictSeverity,
            kind: 'graph_isolated_node',
            message: `${report.isolated_node_count} note(s) are isolated from the wikilink graph.`,
            count: report.isolated_node_count,
            paths: report.isolated_nodes,
        });
    }
    if (report.component_count > 1) {
        issues.push({
            severity: 'warning',
            kind: 'graph_disconnected',
            message: `Graph has ${report.component_count} disconnected component(s).`,
            count: report.component_count,
        });
    }
    if (report.only_inbound_node_count > 0) {
        issues.push({
            severity: 'warning',
            kind: 'graph_only_inbound',
            message: `${report.only_inbound_node_count} note(s) only have inbound links.`,
            count: report.only_inbound_node_count,
            paths: report.only_inbound_nodes,
        });
    }
    if (report.only_outbound_node_count > 0) {
        issues.push({
            severity: 'warning',
            kind: 'graph_only_outbound',
            message: `${report.only_outbound_node_count} note(s) only have outbound links.`,
            count: report.only_outbound_node_count,
            paths: report.only_outbound_nodes,
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
