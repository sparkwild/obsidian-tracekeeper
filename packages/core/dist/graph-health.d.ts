import { ScannedNote } from './scan';
export interface GraphHealthOptions {
    maxItems?: number;
}
export type GraphProfile = 'off' | 'advisory' | 'strict';
export interface GraphProfileIssue {
    severity: 'error' | 'warning';
    kind: 'graph_unresolved_wikilink' | 'graph_missing_entry' | 'graph_missing_hub' | 'graph_isolated_node' | 'graph_disconnected' | 'graph_only_inbound' | 'graph_only_outbound';
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
export declare const DEFAULT_GRAPH_PROFILE: GraphProfile;
export declare function analyzeGraphHealth(notes: ScannedNote[], options?: GraphHealthOptions): GraphHealthReport;
export declare function normalizeGraphProfile(value: unknown): GraphProfile;
export declare function evaluateGraphProfile(report: GraphHealthReport, profileValue?: unknown): GraphProfileEvaluation;
