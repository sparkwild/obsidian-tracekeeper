import { TRACEKEEPER_TASKS_DIR } from '@tracekeeper/core';
import type { GeneratedClientConfig } from '../client-config/client-config';
import type { MemoryProposalRecord } from '../review/review-view-model';
import type { RuntimeViewStatus } from '../../main';
import type { TracekeeperStructureStatus } from '../structure/legacy-migration-controller';
import type { AgentAuthMode, AgentIntegrationSnapshot } from '../settings/agent-integrations';
import type { PendingOAuthRequest } from '@tracekeeper/mcp-runtime';

export type PendingOAuthApproval = Pick<PendingOAuthRequest, 'requestId' | 'clientNameClaim' | 'redirectUri' | 'resource' | 'scope' | 'issuedAt' | 'expiresAt'>;

export const AGENT_TASKS_PATH = TRACEKEEPER_TASKS_DIR;

export const MAX_TASK_ROWS = 6;

export const MAX_AUDIT_ROWS = 12;

export const MAX_SOURCE_STATUS_ROWS = 20;

export const ACTIVITY_TIMELINE_PREVIEW_ROWS = 5;

export const ACTIVITY_TIMELINE_PAGE_SIZE = 10;

export const ACTIVITY_TIMELINE_MAX_ITEMS = 2000;

export const MAX_ACTIVITY_CONTEXT_PACK_ROWS = 5;

export const MAX_ACTIVITY_SOURCE_CAPTURE_ROWS = 5;

export const MAX_ACTIVITY_PROPOSAL_ROWS = 5;

export const MAX_AGENT_CONNECTION_ROWS = 8;

export const MAX_AGENT_TOOL_CALL_ROWS = 12;

export type DurableOutputStatusAtFinish =
	| ''
	| 'none'
	| 'pending_review'
	| 'ready_to_apply'
	| 'revision_requested'
	| 'applied'
	| 'rejected'
	| 'unresolved'
	| 'mixed';

export interface AgentTaskRecord {
	path: string;
	type: string;
	taskId: string;
	agent: string;
	objective: string;
	status: string;
	startedAt: string;
	finishedAt: string;
	contextPack: string;
	sessionNote: string;
	relatedProject: string;
	memoryReads: string[];
	memoryWrites: string[];
	sourceCaptures: string[];
	proposalIds: string[];
	proposalPaths: string[];
	proposals: string[];
	durableOutputStatusAtFinish: DurableOutputStatusAtFinish;
	durableOutputProposalCount: number;
	durableOutputSourceCaptureCount: number;
	durableOutputPendingReviewCount: number;
	durableOutputReadyToApplyCount: number;
	durableOutputRevisionRequestedCount: number;
	durableOutputAppliedCount: number;
	durableOutputRejectedCount: number;
	durableOutputUnresolvedCount: number;
	durableOutputProposalIdsAtFinish: string[];
	durableOutputAppliedProposalIds: string[];
	durableOutputProposalPaths: string[];
	durableOutputTargetPaths: string[];
	memoryCandidates: string[];
	snippet: string;
	sortTimestamp: number;
}

export interface ContextPackRecord {
	path: string;
	title: string;
	taskId: string;
	createdAt: string;
	snippet: string;
	sortTimestamp: number;
}

export interface SourceCaptureRecord {
	path: string;
	type: string;
	title: string;
	source: string;
	sourceKind: string;
	mode: string;
	taskId: string;
	createdAt: string;
	snippet: string;
	sortTimestamp: number;
}

export interface SourceRequestRecord {
	path: string;
	type: string;
	source: string;
	sourceKind: string;
	purpose: string;
	relatedProject: string;
	analysisMode: string;
	status: string;
	taskId: string;
	created: string;
	summary: string;
	sortTimestamp: number;
}

export interface AuditEventRecord {
	path: string;
	auditId: string;
	actor: string;
	action: string;
	target: string;
	reason: string;
	taskId: string;
	timestamp: string;
	sortTimestamp: number;
	snippet: string;
	eventType: string;
	principalId: string;
	integrationId: string;
	credentialId: string;
	authMode: AgentAuthMode | '';
	agentId: string;
	sessionId: string;
	clientName: string;
	auditSchemaVersion: string;
	observedClientNameRaw: string;
	observedClientType: string;
	observedClientVersion: string;
	connectedAt: string;
	lastUsedAt: string;
	lastSuccessfulTool: string;
	diagnosticReason: string;
	toolName: string;
	resultStatus: string;
	targetPaths: string[];
	durationMs: string;
	riskLevel: string;
	argsSummary: string;
	resultSummary: string;
	transport: string;
	runtimeVersion: string;
	workflowContractVersion: string;
	resultSchemaVersion: string;
	workflowMode: string;
	workflowId: string;
	recallId: string;
	actionId: string;
	actionReasonCode: string;
	snapshotGeneration: string;
	scopeMode: string;
	scopeConfidence: string;
	matchedCount: string;
	memoryCloseoutStatus: string;
}

export interface AgentWorkflowDiagnostics {
	activeWorkflowCount: number;
	agedWorkflowCount: number;
	successfulStartCount: number;
	successfulRecallCount: number;
	startToRecallCount: number;
	recallToReadCount: number;
	startToFinishCount: number;
	permissionDeniedCount: number;
	zeroMatchRecallCount: number;
	closeoutStatusDistribution: Record<string, number>;
	durationP50Ms: number | null;
	durationP95Ms: number | null;
	recentPrincipals: string[];
}

export interface ActivityTimelineItem {
	time: number;
	type: string;
	title: string;
	meta: string;
	body: string;
	path: string;
}

export interface ActivityTimelineSnapshot {
	items: ActivityTimelineItem[];
	page: number;
	pageSize: number;
	totalItems: number;
	totalPages: number;
	isTruncated: boolean;
	updatedAt: string;
}

export interface ActivityTimelineRecordWindow {
	tasks: AgentTaskRecord[];
	contextPacks: ContextPackRecord[];
	sourceCaptures: SourceCaptureRecord[];
	sourceRequests: SourceRequestRecord[];
	proposals: MemoryProposalRecord[];
	isTruncated: boolean;
}

export interface AgentActivitySnapshot {
	runtimeStatus: RuntimeViewStatus;
	structureStatus: TracekeeperStructureStatus;
	vaultRoot: string;
	latestTask: AgentTaskRecord | null;
	recentTasks: AgentTaskRecord[];
	recentContextPacks: ContextPackRecord[];
	recentSourceCaptures: SourceCaptureRecord[];
	recentSourceRequests: SourceRequestRecord[];
	recentProposals: MemoryProposalRecord[];
	reviewQueueItemCount: number;
	reviewQueueCountsTruncated: boolean;
	incompleteReviewQueueItemCount: number;
	pendingReviewQueueItemCount: number;
	readyToApplyReviewQueueItemCount: number;
	revisionRequestedReviewQueueItemCount: number;
	actionableReviewQueueItemCount: number;
	recentAuditEvents: AuditEventRecord[];
	workflowDiagnostics: AgentWorkflowDiagnostics;
	timelineItems: ActivityTimelineItem[];
	recentAgents: AgentConnectionRecord[];
	recentAgentCount: number;
	recentToolCallCount: number;
	missingTaskFolder: boolean;
	missingAuditSources: boolean;
	updatedAt: string;
}

export interface AgentConnectionRecord {
	principalId: string;
	integrationId: string;
	credentialId: string;
	authMode: AgentAuthMode | '';
	agentId: string;
	sessionId: string;
	clientName: string;
	observedClientNameRaw: string;
	observedClientType: string;
	observedClientVersion: string;
	displayName: string;
	transport: string;
	status: string;
	lastSeen: string;
	lastToolCall: string;
	connectedAt: string;
	resultStatus: string;
	lastUsedAt: string;
	lastSuccessfulTool: string;
	runtimeVersion: string;
	permissionProfile: string;
	sortTimestamp: number;
}

export interface AgentToolCallRecord {
	principalId: string;
	integrationId: string;
	credentialId: string;
	authMode: AgentAuthMode | '';
	taskId: string;
	agentId: string;
	sessionId: string;
	clientName: string;
	observedClientNameRaw: string;
	observedClientType: string;
	observedClientVersion: string;
	toolName: string;
	resultStatus: string;
	targetPaths: string[];
	timestamp: string;
	lastUsedAt: string;
	lastSuccessfulTool: string;
	transport: string;
	durationMs: string;
	riskLevel: string;
	argsSummary: string;
	resultSummary: string;
	scopeMode: string;
	matchedCount: string;
	sortTimestamp: number;
}

export interface AgentConnectionsSnapshot {
	vaultRoot: string;
	httpEndpoint: string;
	connectionUrl: string;
	runtimeStatus: RuntimeViewStatus;
	clientConfigs: GeneratedClientConfig[];
	integrations: AgentIntegrationSnapshot[];
	pendingOAuthRequests: PendingOAuthApproval[];
	activeSessions: Array<{ sessionId: string; integrationId?: string; credentialId?: string; authMode?: 'oauth' | 'bearer'; createdAt: number; lastSeenAt: number }>;
	recentAgents: AgentConnectionRecord[];
	recentToolCalls: AgentToolCallRecord[];
	missingAuditSources: boolean;
	updatedAt: string;
}
