import {
	GRAPH_RECOMMENDED_ENTRY,
	GRAPH_RECOMMENDED_HUBS,
	KNOWLEDGE_ROOT,
	normalizeKnowledgePath as normalizeVaultPath,
} from './knowledge-architecture';
import { isSourcePartPath } from './wiki-governance';
import {
	normalizeVaultRelativePath,
	resolveNormalizedVaultEdges,
} from './knowledge-note';
import { ScannedNote } from './scan';

export interface GraphHealthOptions {
	maxItems?: number;
	semanticOnly?: boolean;
}

export type GraphProfile = 'off' | 'advisory' | 'strict';

export interface GraphProfileIssue {
	severity: 'error' | 'warning';
	kind:
		| 'graph_unresolved_wikilink'
		| 'graph_missing_entry'
		| 'graph_missing_hub'
		| 'graph_isolated_node'
		| 'graph_disconnected'
		| 'graph_only_inbound'
		| 'graph_only_outbound';
	message: string;
	count: number;
	paths?: string[];
}

export interface GraphProfileEvaluation {
	profile: GraphProfile;
	disabled: boolean;
	profile_issues: GraphProfileIssue[];
}

export interface GraphHealthReport {
	note_count: number;
	edge_observation_count: number;
	ignored_edge_observation_count: number;
	ignored_unresolved_edge_count: number;
	wikilink_edge_count: number;
	unresolved_edges: GraphHealthUnresolvedEdge[];
	resolved_edge_count: number;
	unresolved_edge_count: number;
	largest_component_node_count: number;
	component_count: number;
	isolated_nodes: string[];
	isolated_node_count: number;
	only_inbound_nodes: string[];
	only_inbound_node_count: number;
	only_outbound_nodes: string[];
	only_outbound_node_count: number;
	hub_candidates: GraphHealthHubCandidate[];
	hub_candidate_count: number;
	missing_recommended_entry: string | null;
	missing_recommended_hubs: string[];
	missing_recommended_hub_count: number;
	recommendations: string[];
	recommendation_count: number;
}

export interface GraphHealthHubCandidate {
	path: string;
	degree: number;
	inbound: number;
	outbound: number;
}

export interface GraphHealthUnresolvedEdge {
	path: string;
	line: number;
	target: string;
	context?: string;
	occurrence_count: number;
	declared_via: Array<'frontmatter' | 'body_wikilink'>;
}

const DEFAULT_MAX_ITEMS = 20;
export const DEFAULT_GRAPH_PROFILE: GraphProfile = 'advisory';

function normalizedNoteType(note: ScannedNote): string {
	return (typeof note.type === 'string' ? note.type : '')
		.trim()
		.toLocaleLowerCase('en-US')
		.replace(/_/g, '-');
}

function shouldIncludeSemanticEdge(note: ScannedNote, sourcePath: string, link: ScannedNote['edges'][number]): boolean {
	if (isSourcePartPath(sourcePath)) {
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

export function analyzeGraphHealth(notes: ScannedNote[], options: GraphHealthOptions = {}): GraphHealthReport {
	const maxItems = normalizeMaxItems(options.maxItems);
	const allNotePathSet = new Set(notes.map((note) => normalizeRelativePath(note.relativePath)).filter(Boolean));
	const semanticNotes = options.semanticOnly === true ? notes.filter((note) => {
		const path = normalizeRelativePath(note.relativePath);
		return path.startsWith(`${KNOWLEDGE_ROOT}/`) && !isSourcePartPath(path);
	}) : notes;
	const notePaths = semanticNotes.map((note) => normalizeRelativePath(note.relativePath)).filter(Boolean);
	const notePathSet = new Set(notePaths);
	const semanticPathSet = new Set(notePaths);
	const resolvedEdges = resolveNormalizedVaultEdges(
		notes.map((note) => ({
			path: note.relativePath,
			title: note.title,
			aliases: note.aliases,
			edges: note.edges,
		}))
	);

	const outgoing = new Map<string, Set<string>>();
	const incoming = new Map<string, Set<string>>();
	const undirected = new Map<string, Set<string>>();
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
	const unresolvedEdges: GraphHealthUnresolvedEdge[] = [];
	const semanticEdges = new Map<string, {
		link: ScannedNote['edges'][number];
		path: string;
		occurrenceCount: number;
		declaredVia: Set<'frontmatter' | 'body_wikilink'>;
	}>();

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

	const isolatedNodes: string[] = [];
	const onlyInboundNodes: string[] = [];
	const onlyOutboundNodes: string[] = [];
	const hubScores: Array<{ path: string; degree: number; inbound: number; outbound: number }> = [];

	for (const notePath of notePaths) {
		const inboundCount = incoming.get(notePath)?.size || 0;
		const outboundCount = outgoing.get(notePath)?.size || 0;
		const degree = inboundCount + outboundCount;

		if (degree === 0) {
			isolatedNodes.push(notePath);
		} else {
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

	const missingRecommendedHubs = GRAPH_RECOMMENDED_HUBS.filter((hub) => !notePathSet.has(normalizeVaultPath(hub))).map(
		(hub) => hub
	);
	const missingRecommendedEntry = notePathSet.has(normalizeVaultPath(GRAPH_RECOMMENDED_ENTRY))
		? null
		: GRAPH_RECOMMENDED_ENTRY;

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

	const recommendations: string[] = [];
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

function semanticGraphEdgeKey(
	sourcePath: string,
	link: ScannedNote['edges'][number]
): string {
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

function isNativeAttachmentResolution(resolution: {
	status: 'resolved';
	path: string;
	authority: 'fallback' | 'native';
}): boolean {
	return resolution.authority === 'native' && !resolution.path.toLocaleLowerCase('en-US').endsWith('.md');
}

export function normalizeGraphProfile(value: unknown): GraphProfile {
	if (typeof value !== 'string') {
		return DEFAULT_GRAPH_PROFILE;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === 'off' || normalized === 'advisory' || normalized === 'strict') {
		return normalized;
	}
	return DEFAULT_GRAPH_PROFILE;
}

export function evaluateGraphProfile(
	report: GraphHealthReport,
	profileValue: unknown = DEFAULT_GRAPH_PROFILE
): GraphProfileEvaluation {
	const profile = normalizeGraphProfile(profileValue);
	if (profile === 'off') {
		return {
			profile,
			disabled: true,
			profile_issues: [],
		};
	}

	const strictSeverity = profile === 'strict' ? 'error' : 'warning';
	const issues: GraphProfileIssue[] = [];

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

function computeComponents(notePaths: string[], undirected: Map<string, Set<string>>) {
	let componentCount = 0;
	let largestComponentSize = 0;
	const visited = new Set<string>();

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

function normalizeRelativePath(value: string): string {
	try {
		return normalizeVaultRelativePath(value);
	} catch {
		return '';
	}
}

function normalizeMaxItems(raw: number | undefined): number {
	if (!Number.isInteger(raw) || !raw || raw <= 0) {
		return DEFAULT_MAX_ITEMS;
	}
	return raw > 2000 ? 2000 : raw;
}

function uniquePaths(paths: string[]): string[] {
	return Array.from(new Set(paths.filter(Boolean))).sort();
}
