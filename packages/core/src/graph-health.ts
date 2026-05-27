import path from 'node:path';
import { ScannedNote } from './scan';

export interface GraphHealthOptions {
	maxItems?: number;
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
}

const DEFAULT_MAX_ITEMS = 20;
export const DEFAULT_GRAPH_PROFILE: GraphProfile = 'advisory';
const DEFAULT_RECOMMENDED_ENTRY = '04_memory/concepts/knowledge_graph_index.md';
const DEFAULT_RECOMMENDED_HUBS = [
	'04_memory/concepts/java_backend_hub.md',
	'04_memory/concepts/ai_agent_hub.md',
	'04_memory/concepts/wechat_account_ecosystem_hub.md',
	'04_memory/concepts/engineering_infrastructure_hub.md',
	'04_memory/concepts/knowledge_maintenance_hub.md',
];

type MultiLookup = Map<string, string[]>;

interface GraphIndex {
	pathByRelativePath: Map<string, string>;
	pathByRelativePathNoExt: Map<string, string>;
	basenameToRelativePaths: MultiLookup;
	titleToRelativePaths: MultiLookup;
	aliasToRelativePaths: MultiLookup;
}

export function analyzeGraphHealth(notes: ScannedNote[], options: GraphHealthOptions = {}): GraphHealthReport {
	const maxItems = normalizeMaxItems(options.maxItems);
	const index = buildGraphIndex(notes);
	const notePaths = notes.map((note) => normalizeRelativePath(note.relativePath)).filter(Boolean);

	const outgoing = new Map<string, Set<string>>();
	const incoming = new Map<string, Set<string>>();
	const undirected = new Map<string, Set<string>>();
	for (const notePath of notePaths) {
		outgoing.set(notePath, new Set());
		incoming.set(notePath, new Set());
		undirected.set(notePath, new Set());
	}

	let wikilinkEdgeCount = 0;
	let resolvedEdgeCount = 0;
	let unresolvedEdgeCount = 0;
	const unresolvedEdges: GraphHealthUnresolvedEdge[] = [];

	for (const note of notes) {
		const sourcePath = normalizeRelativePath(note.relativePath);
		if (!sourcePath) {
			continue;
		}

		for (const link of note.wikilinks) {
			wikilinkEdgeCount += 1;
			const target = resolveWikilinkTarget(link.target, sourcePath, index);
			if (!target) {
				unresolvedEdgeCount += 1;
				unresolvedEdges.push({
					path: note.relativePath,
					line: link.line,
					target: link.target,
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

	const missingRecommendedHubs = DEFAULT_RECOMMENDED_HUBS.filter(
		(hub) => !index.pathByRelativePath.has(normalizeRelativePath(hub))
	);
	const missingRecommendedEntry = index.pathByRelativePath.has(normalizeRelativePath(DEFAULT_RECOMMENDED_ENTRY))
		? null
		: DEFAULT_RECOMMENDED_ENTRY;

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
	const sortedRecommendations = recommendations;

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
		recommendations: sortedRecommendations.slice(0, maxItems),
		recommendation_count: sortedRecommendations.length,
	};
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

function buildGraphIndex(notes: ScannedNote[]): GraphIndex {
	const pathByRelativePath = new Map<string, string>();
	const pathByRelativePathNoExt = new Map<string, string>();
	const basenameToRelativePaths: MultiLookup = new Map();
	const titleToRelativePaths: MultiLookup = new Map();
	const aliasToRelativePaths: MultiLookup = new Map();

	for (const note of notes) {
		const relativePath = normalizeRelativePath(note.relativePath);
		if (!relativePath) {
			continue;
		}

		pathByRelativePath.set(relativePath, note.relativePath);
		pathByRelativePathNoExt.set(stripKnownExtension(relativePath), note.relativePath);
		addToLookup(
			basenameToRelativePaths,
			path.posix.basename(stripKnownExtension(relativePath)),
			note.relativePath
		);
		addToLookup(titleToRelativePaths, note.title, note.relativePath);
		for (const alias of note.aliases) {
			addToLookup(aliasToRelativePaths, alias, note.relativePath);
		}
	}

	return {
		pathByRelativePath,
		pathByRelativePathNoExt,
		basenameToRelativePaths,
		titleToRelativePaths,
		aliasToRelativePaths,
	};
}

function resolveWikilinkTarget(target: string, sourcePath: string, index: GraphIndex): string | null {
	const cleanTarget = target.trim();
	if (!cleanTarget) {
		return null;
	}

	const noHeading = cleanTarget.split('#', 1)[0].trim();
	if (!noHeading) {
		return null;
	}

	if (isPathLikeTarget(noHeading)) {
		const pathResolution = resolveByPathLike(noHeading, sourcePath, index);
		if (pathResolution) {
			return pathResolution;
		}
	}

	const fallback = resolveByAliasAndTitle(noHeading, index);
	if (fallback) {
		return fallback;
	}

	return null;
}

function resolveByPathLike(target: string, sourcePath: string, index: GraphIndex): string | null {
	const normalizedTarget = normalizePathCandidateForResolution(target, sourcePath);
	if (!normalizedTarget) {
		return null;
	}

	const exact = index.pathByRelativePath.get(normalizedTarget);
	if (exact) {
		return exact;
	}

	const noExt = stripKnownExtension(normalizedTarget);
	return index.pathByRelativePathNoExt.get(noExt) || null;
}

function resolveByAliasAndTitle(target: string, index: GraphIndex): string | null {
	const key = normalizeLookupToken(target);
	if (!key) {
		return null;
	}

	const titleMatch = pickSingleValue(index.titleToRelativePaths.get(key));
	if (titleMatch) {
		return titleMatch;
	}

	const aliasMatch = pickSingleValue(index.aliasToRelativePaths.get(key));
	if (aliasMatch) {
		return aliasMatch;
	}

	const basenameMatch = pickSingleValue(index.basenameToRelativePaths.get(key));
	if (basenameMatch) {
		return basenameMatch;
	}

	return null;
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
	const replaced = value.replace(/\\/g, '/').trim();
	if (!replaced) {
		return '';
	}
	const relative = replaced.replace(/^\.\//, '');
	const normalized = path.posix.normalize(relative);
	return normalized === '.' ? '' : normalized;
}

function normalizeLookupToken(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeMaxItems(raw: number | undefined): number {
	if (!Number.isInteger(raw) || !raw || raw <= 0) {
		return DEFAULT_MAX_ITEMS;
	}
	return raw > 2000 ? 2000 : raw;
}

function stripKnownExtension(value: string): string {
	const extension = path.posix.extname(value).toLowerCase();
	if (extension === '.md' || extension === '.markdown') {
		return value.slice(0, -extension.length);
	}
	return value;
}

function isPathLikeTarget(target: string): boolean {
	return target.includes('/') || target.includes('\\') || path.posix.extname(target) !== '';
}

function normalizePathCandidateForResolution(target: string, sourcePath: string): string {
	let normalized = target.replace(/\\/g, '/').trim();
	if (!normalized) {
		return '';
	}

	if (normalized.startsWith('./') || normalized.startsWith('../')) {
		normalized = path.posix.join(path.posix.dirname(sourcePath), normalized);
	}

	normalized = normalized.replace(/^\/+/g, '');
	normalized = normalized.replace(/\/+/g, '/');
	normalized = path.posix.normalize(normalized);
	if (normalized === '.' || !normalized) {
		return '';
	}

	if (!path.posix.extname(normalized)) {
		normalized = `${normalized}.md`;
	}

	return normalizeRelativePath(normalized);
}

function addToLookup(map: MultiLookup, key: string, value: string): void {
	const normalized = normalizeLookupToken(key);
	if (!normalized) {
		return;
	}
	const existing = map.get(normalized);
	if (!existing) {
		map.set(normalized, [value]);
		return;
	}
	if (!existing.includes(value)) {
		existing.push(value);
	}
}

function pickSingleValue(values?: string[]): string | null {
	if (!values || values.length !== 1) {
		return null;
	}
	return values[0] || null;
}

function uniquePaths(paths: string[]): string[] {
	return Array.from(new Set(paths.filter(Boolean))).sort();
}
