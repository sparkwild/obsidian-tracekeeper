import { KNOWLEDGE_INDEX_PATH } from '@tracekeeper/core';
import { normalizeGraphProfileValue, type GraphProfile } from '../settings/settings-model';
import { ui } from '../../ui/localization';
import {
	type GraphHealthHubCandidate,
	type GraphHealthSnapshot,
	type GraphProfileIssue,
	type GraphProfileIssueSeverity,
} from './graph-health-model';

const MAX_GRAPH_HEALTH_ITEMS = 20;
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export interface GraphHealthControllerHost {
	executeLocalTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
	refreshGovernanceViews(): Promise<void>;
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

async createGraphHealthReviewProposal(snapshot: GraphHealthSnapshot): Promise<string> {
		if (!snapshot.ok) {
			throw new Error(snapshot.errorMessage || 'Graph health is not available.');
		}
		const content = this.buildGraphHealthProposalContent(snapshot);
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const result = await this.host.executeLocalTool('tracekeeper.propose_memory', {
			proposal_kind: 'graph_health_improvement',
			title: ui('知识图谱修复建议', 'Graph health improvement proposal'),
			filename: `graph_health_improvement_${timestamp}`,
			target_note: snapshot.missingRecommendedEntry || KNOWLEDGE_INDEX_PATH,
			risk_level: snapshot.profile === 'strict' ? 'medium' : 'low',
			evidence: `tracekeeper.lint ${snapshot.scannedAt || snapshot.updatedAt}`,
			content,
		});
		await this.host.refreshGovernanceViews();
		return typeof result.path === 'string' ? result.path : '';
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
			isolatedNodes: [],
			isolatedNodeCount: 0,
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
		};
	}

private toGraphHealthSnapshot(result: Record<string, unknown>, profile: GraphProfile): GraphHealthSnapshot {
		const graphHealth = isRecord(result.graph_health) ? result.graph_health : result;
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
			isolatedNodes: this.stringArrayFromRecord(graphHealth, 'isolated_nodes'),
			isolatedNodeCount: this.numberFromRecord(graphHealth, 'isolated_node_count'),
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
		if (snapshot.missingRecommendedEntry) {
			pushIssue(
				'missing_graph_entry',
				severityForCore,
				ui(
					`缺少图谱入口：${snapshot.missingRecommendedEntry}`,
					`Missing graph entry: ${snapshot.missingRecommendedEntry}`
				)
			);
		}
		if (snapshot.missingRecommendedHubCount > 0) {
			pushIssue(
				'missing_recommended_hubs',
				severityForCore,
				ui(
					`缺少 ${snapshot.missingRecommendedHubCount} 个推荐 hub。`,
					`${snapshot.missingRecommendedHubCount} recommended hubs are missing.`
				)
			);
		}
		if (snapshot.isolatedNodeCount > 0) {
			pushIssue(
				'isolated_nodes',
				severityForCore,
				ui(
					`${snapshot.isolatedNodeCount} 个笔记没有图谱连接。`,
					`${snapshot.isolatedNodeCount} notes have no graph links.`
				)
			);
		}
		if (snapshot.componentCount > 1) {
			pushIssue(
				'graph_components',
				'warning',
				ui(
					`图谱分成 ${snapshot.componentCount} 个连通分量。`,
					`Graph is split into ${snapshot.componentCount} components.`
				)
			);
		}
		if (snapshot.onlyInboundNodeCount > 0) {
			pushIssue(
				'only_inbound_nodes',
				'warning',
				ui(
					`${snapshot.onlyInboundNodeCount} 个笔记只有入链。`,
					`${snapshot.onlyInboundNodeCount} notes only have inbound links.`
				)
			);
		}
		if (snapshot.onlyOutboundNodeCount > 0) {
			pushIssue(
				'only_outbound_nodes',
				'warning',
				ui(
					`${snapshot.onlyOutboundNodeCount} 个笔记只有出链。`,
					`${snapshot.onlyOutboundNodeCount} notes only have outbound links.`
				)
			);
		}
		return issues;
	}

private buildGraphHealthProposalContent(snapshot: GraphHealthSnapshot): string {
		const profileIssues = snapshot.profileIssues.length > 0
			? snapshot.profileIssues.map((issue) => `- ${issue.severity}: ${issue.kind} - ${issue.message}`)
			: ['- No profile issues detected.'];
		const recommendations = snapshot.recommendations.length > 0
			? snapshot.recommendations.map((item) => `- ${item}`)
			: ['- No recommendations returned by graph health.'];
		const hubCandidates = snapshot.hubCandidates.length > 0
			? snapshot.hubCandidates.map((candidate) =>
				`- ${candidate.path} (degree ${candidate.degree}, inbound ${candidate.inbound}, outbound ${candidate.outbound})`
			)
			: ['- No hub candidates returned.'];
		const missingHubs = snapshot.missingRecommendedHubs.length > 0
			? snapshot.missingRecommendedHubs.map((item) => `- ${item}`)
			: ['- None'];

		return [
			'## Graph health review proposal',
			'',
			`- graph_profile: ${snapshot.profile}`,
			`- scanned_at: ${snapshot.scannedAt || snapshot.updatedAt}`,
			`- vault_root: ${snapshot.vaultRoot}`,
			`- note_count: ${snapshot.noteCount}`,
			`- edge_observation_count: ${snapshot.edgeObservationCount}`,
			`- ignored_edge_observation_count: ${snapshot.ignoredEdgeObservationCount}`,
			`- ignored_unresolved_edge_count: ${snapshot.ignoredUnresolvedEdgeCount}`,
			`- wikilink_edge_count: ${snapshot.wikilinkEdgeCount}`,
			`- resolved_edge_count: ${snapshot.resolvedEdgeCount}`,
			`- unresolved_edge_count: ${snapshot.unresolvedEdgeCount}`,
			`- component_count: ${snapshot.componentCount}`,
			`- largest_component_node_count: ${snapshot.largestComponentNodeCount}`,
			`- isolated_node_count: ${snapshot.isolatedNodeCount}`,
			`- only_inbound_node_count: ${snapshot.onlyInboundNodeCount}`,
			`- only_outbound_node_count: ${snapshot.onlyOutboundNodeCount}`,
			`- missing_recommended_entry: ${snapshot.missingRecommendedEntry || 'none'}`,
			'',
			'## Profile issues',
			...profileIssues,
			'',
			'## Recommendations',
			...recommendations,
			'',
			'## Missing recommended hubs',
			...missingHubs,
			'',
			'## Hub candidates',
			...hubCandidates,
			'',
			'## Review boundary',
			'- This proposal only creates a Knowledge Change Review record.',
			'- Do not modify notes, create hubs, or write long-term memory until the user approves the specific writeback.',
		].join('\n');
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
}
