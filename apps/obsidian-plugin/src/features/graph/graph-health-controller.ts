import { normalizeGraphProfileValue, type GraphProfile } from '../settings/settings-model';
import { ui } from '../../ui/localization';
import {
	type GraphHealthHubCandidate,
	type GraphMaintenanceCandidate,
	type GraphHealthSnapshot,
	type GraphProfileIssue,
	type GraphProfileIssueSeverity,
} from './graph-health-model';

const MAX_GRAPH_HEALTH_ITEMS = 20;
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export interface GraphHealthControllerHost {
	executeLocalTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
	getVaultRoot(): string;
	getGraphProfile(): GraphProfile;
}

export class GraphHealthController {
	constructor(private readonly host: GraphHealthControllerHost) {}

async loadGraphHealthSnapshot(): Promise<GraphHealthSnapshot> {
		const profile = this.host.getGraphProfile();
		try {
			const result = await this.host.executeLocalTool('tracekeeper.lint', {
				max_items: MAX_GRAPH_HEALTH_ITEMS,
				graph_profile: profile,
			});
			return this.toGraphHealthSnapshot(result, profile);
		} catch (error) {
			console.error('tracekeeper failed to load graph health', error);
			return this.emptyGraphHealthSnapshot(
				profile,
				error instanceof Error
					? error.message
					: typeof error === 'string' && error
						? error
						: 'Unknown graph health error.'
			);
		}
	}

private emptyGraphHealthSnapshot(profile: GraphProfile, errorMessage = ''): GraphHealthSnapshot {
		const updatedAt = new Date().toISOString();
		return {
			ok: errorMessage.length === 0,
			readOnly: true,
			profile,
			disabled: profile === 'off',
			vaultRoot: this.host.getVaultRoot(),
			scannedAt: '',
			updatedAt,
			errorMessage,
			noteCount: 0,
			edgeObservationCount: 0,
			ignoredEdgeObservationCount: 0,
			ignoredUnresolvedEdgeCount: 0,
			wikilinkEdgeCount: 0,
			resolvedEdgeCount: 0,
			unresolvedEdgeCount: 0,
			largestComponentNodeCount: 0,
			componentCount: 0,
			maintenanceComponentCount: 0,
			isolatedNodes: [],
			isolatedNodeCount: 0,
			actionableIsolatedNodes: [],
			actionableIsolatedNodeCount: 0,
			onlyInboundNodes: [],
			onlyInboundNodeCount: 0,
			onlyOutboundNodes: [],
			onlyOutboundNodeCount: 0,
			hubCandidates: [],
			hubCandidateCount: 0,
			missingRecommendedEntry: '',
			missingRecommendedHubs: [],
			missingRecommendedHubCount: 0,
			recommendations: [],
			recommendationCount: 0,
			profileIssues: [],
			maintenanceCandidates: [],
		};
	}

private toGraphHealthSnapshot(result: Record<string, unknown>, profile: GraphProfile): GraphHealthSnapshot {
		const graphHealth = isRecord(result.graph_health) ? result.graph_health : result;
		const maintenance = isRecord(result.maintenance) ? result.maintenance : {};
		const resultProfile = normalizeGraphProfileValue(
			this.stringFromRecord(graphHealth, 'profile')
			|| this.stringFromRecord(result, 'profile')
			|| profile
		);
		const snapshot: GraphHealthSnapshot = {
			ok: result.ok !== false,
			readOnly: result.read_only !== false,
			profile: resultProfile,
			disabled: graphHealth.disabled === true || result.graph_profile_disabled === true || resultProfile === 'off',
			vaultRoot: this.stringFromRecord(result, 'vault_root') || this.host.getVaultRoot(),
			scannedAt: this.stringFromRecord(result, 'scanned_at'),
			updatedAt: new Date().toISOString(),
			errorMessage: '',
			noteCount: this.numberFromRecord(graphHealth, 'note_count'),
			edgeObservationCount: this.numberFromRecord(graphHealth, 'edge_observation_count'),
			ignoredEdgeObservationCount: this.numberFromRecord(graphHealth, 'ignored_edge_observation_count'),
			ignoredUnresolvedEdgeCount: this.numberFromRecord(graphHealth, 'ignored_unresolved_edge_count'),
			wikilinkEdgeCount: this.numberFromRecord(graphHealth, 'wikilink_edge_count'),
			resolvedEdgeCount: this.numberFromRecord(graphHealth, 'resolved_edge_count'),
			unresolvedEdgeCount: this.numberFromRecord(graphHealth, 'unresolved_edge_count'),
			largestComponentNodeCount: this.numberFromRecord(graphHealth, 'largest_component_node_count'),
			componentCount: this.numberFromRecord(graphHealth, 'component_count'),
			maintenanceComponentCount: this.numberFromRecord(graphHealth, 'maintenance_component_count'),
			isolatedNodes: this.stringArrayFromRecord(graphHealth, 'isolated_nodes'),
			isolatedNodeCount: this.numberFromRecord(graphHealth, 'isolated_node_count'),
			actionableIsolatedNodes: this.stringArrayFromRecord(graphHealth, 'actionable_isolated_nodes'),
			actionableIsolatedNodeCount: this.numberFromRecord(graphHealth, 'actionable_isolated_node_count'),
			onlyInboundNodes: this.stringArrayFromRecord(graphHealth, 'only_inbound_nodes'),
			onlyInboundNodeCount: this.numberFromRecord(graphHealth, 'only_inbound_node_count'),
			onlyOutboundNodes: this.stringArrayFromRecord(graphHealth, 'only_outbound_nodes'),
			onlyOutboundNodeCount: this.numberFromRecord(graphHealth, 'only_outbound_node_count'),
			hubCandidates: this.graphHubCandidatesFromRecord(graphHealth, 'hub_candidates'),
			hubCandidateCount: this.numberFromRecord(graphHealth, 'hub_candidate_count'),
			missingRecommendedEntry: this.stringFromRecord(graphHealth, 'missing_recommended_entry'),
			missingRecommendedHubs: this.stringArrayFromRecord(graphHealth, 'missing_recommended_hubs'),
			missingRecommendedHubCount: this.numberFromRecord(graphHealth, 'missing_recommended_hub_count'),
			recommendations: this.stringArrayFromRecord(graphHealth, 'recommendations'),
			recommendationCount: this.numberFromRecord(graphHealth, 'recommendation_count'),
			profileIssues: this.graphProfileIssuesFromRecord(graphHealth, 'profile_issues'),
			maintenanceCandidates: this.maintenanceCandidatesFromRecord(maintenance, 'candidates')
				.filter((item) => item.category === 'wiki_role' || item.category === 'wiki_relation'),
		};
		if (snapshot.profileIssues.length === 0 && !snapshot.disabled) {
			snapshot.profileIssues = this.evaluateGraphProfile(snapshot);
		}
		return snapshot;
	}

private evaluateGraphProfile(snapshot: GraphHealthSnapshot): GraphProfileIssue[] {
		if (snapshot.profile === 'off') {
			return [];
		}
		const severityForCore = snapshot.profile === 'strict' ? 'error' : 'warning';
		const issues: GraphProfileIssue[] = [];
		const pushIssue = (kind: string, severity: GraphProfileIssueSeverity, message: string) => {
			issues.push({ kind, severity, message, count: 1, paths: [] });
		};

		if (snapshot.unresolvedEdgeCount > 0) {
			pushIssue(
				'unresolved_wikilinks',
				severityForCore,
				ui(
					`${snapshot.unresolvedEdgeCount} 条 wikilink 未解析。`,
					`${snapshot.unresolvedEdgeCount} wikilinks are unresolved.`
				)
			);
		}
		if (snapshot.actionableIsolatedNodeCount > 0) {
			pushIssue(
				'isolated_nodes',
				severityForCore,
				`${snapshot.actionableIsolatedNodeCount} structural notes have no graph links.`
			);
		}
		if (snapshot.maintenanceComponentCount > 1) {
			pushIssue(
				'graph_components',
				'warning',
				`Knowledge graph is split into ${snapshot.maintenanceComponentCount} structural components.`
			);
		}
		return issues;
	}

private stringFromRecord(record: Record<string, unknown>, key: string): string {
		const value = record[key];
		return typeof value === 'string' ? value.trim() : '';
	}

private numberFromRecord(record: Record<string, unknown>, key: string): number {
		const value = record[key];
		return typeof value === 'number' && Number.isFinite(value) ? value : 0;
	}

private stringArrayFromRecord(record: Record<string, unknown>, key: string): string[] {
		const value = record[key];
		if (!Array.isArray(value)) {
			return [];
		}
		return value
			.filter((item): item is string => typeof item === 'string')
			.map((item) => item.trim())
			.filter(Boolean);
	}

private graphHubCandidatesFromRecord(record: Record<string, unknown>, key: string): GraphHealthHubCandidate[] {
		const value = record[key];
		if (!Array.isArray(value)) {
			return [];
		}
		const candidates: GraphHealthHubCandidate[] = [];
		for (const item of value) {
			if (!isRecord(item) || typeof item.path !== 'string') {
				continue;
			}
			candidates.push({
				path: item.path.trim(),
				degree: typeof item.degree === 'number' ? item.degree : 0,
				inbound: typeof item.inbound === 'number' ? item.inbound : 0,
				outbound: typeof item.outbound === 'number' ? item.outbound : 0,
			});
		}
		return candidates;
	}

private graphProfileIssuesFromRecord(record: Record<string, unknown>, key: string): GraphProfileIssue[] {
		const value = record[key];
		if (!Array.isArray(value)) {
			return [];
		}
		const issues: GraphProfileIssue[] = [];
		for (const item of value) {
			if (!isRecord(item) || typeof item.kind !== 'string' || typeof item.message !== 'string') {
				continue;
			}
			const severity = item.severity === 'error' ? 'error' : 'warning';
			issues.push({
				kind: item.kind.trim(),
				severity,
				message: item.message.trim(),
				count: typeof item.count === 'number' && Number.isFinite(item.count) ? item.count : 1,
				paths: Array.isArray(item.paths)
					? item.paths.filter((path): path is string => typeof path === 'string').map((path) => path.trim()).filter(Boolean)
					: [],
			});
		}
		return issues;
}

private maintenanceCandidatesFromRecord(record: Record<string, unknown>, key: string): GraphMaintenanceCandidate[] {
	const value = record[key];
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!isRecord(item) || typeof item.candidate_id !== 'string' || typeof item.category !== 'string') return [];
		return [{
			candidateId: item.candidate_id,
			category: item.category,
			state: typeof item.state === 'string' ? item.state : '',
			risk: typeof item.risk === 'string' ? item.risk : '',
			paths: Array.isArray(item.paths) ? item.paths.filter((path): path is string => typeof path === 'string') : [],
			reasons: Array.isArray(item.reasons) ? item.reasons.filter((reason): reason is string => typeof reason === 'string') : [],
			requestable: item.requestable === true,
		}];
	});
}
}
