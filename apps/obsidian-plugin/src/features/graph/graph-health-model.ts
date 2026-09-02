import type { GraphProfile } from '../settings/settings-model';

export type GraphProfileIssueSeverity = 'warning' | 'error';

export interface GraphHealthHubCandidate {
	path: string;
	degree: number;
	inbound: number;
	outbound: number;
}

export interface GraphProfileIssue {
	kind: string;
	severity: GraphProfileIssueSeverity;
	message: string;
	count: number;
	paths: string[];
}

export interface GraphMaintenanceCandidate {
	candidateId: string;
	category: string;
	state: string;
	risk: string;
	paths: string[];
	reasons: string[];
	requestable: boolean;
}

export interface GraphHealthSnapshot {
	ok: boolean;
	readOnly: boolean;
	profile: GraphProfile;
	disabled: boolean;
	vaultRoot: string;
	scannedAt: string;
	updatedAt: string;
	errorMessage: string;
	noteCount: number;
	edgeObservationCount: number;
	ignoredEdgeObservationCount: number;
	ignoredUnresolvedEdgeCount: number;
	wikilinkEdgeCount: number;
	resolvedEdgeCount: number;
	unresolvedEdgeCount: number;
	largestComponentNodeCount: number;
	componentCount: number;
	maintenanceComponentCount: number;
	isolatedNodes: string[];
	isolatedNodeCount: number;
	actionableIsolatedNodes: string[];
	actionableIsolatedNodeCount: number;
	onlyInboundNodes: string[];
	onlyInboundNodeCount: number;
	onlyOutboundNodes: string[];
	onlyOutboundNodeCount: number;
	hubCandidates: GraphHealthHubCandidate[];
	hubCandidateCount: number;
	missingRecommendedEntry: string;
	missingRecommendedHubs: string[];
	missingRecommendedHubCount: number;
	recommendations: string[];
	recommendationCount: number;
	profileIssues: GraphProfileIssue[];
	maintenanceCandidates: GraphMaintenanceCandidate[];
}
