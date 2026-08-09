import { ARCHIVE_REVIEW_QUEUE_DIR, TRACEKEEPER_REVIEW_QUEUE_DIR } from '@tracekeeper/core';
import type { RuntimeViewModelInput } from '../runtime/runtime-view-model';
import { runtimeViewModel } from '../runtime/runtime-view-model';
import type { StructureState } from '../structure/legacy-migration-controller';
import type {
	AgentConnectionRecord,
	AgentTaskRecord,
	DurableOutputStatusAtFinish,
} from './activity-model';

export type ActivityPrimaryAction =
	| 'repair_structure'
	| 'recover_runtime'
	| 'review_changes'
	| 'inspect_diagnostics'
	| 'none';

export interface ActivityPrimaryActionInput {
	structureState: StructureState;
	runtimeStatus: RuntimeViewModelInput;
	actionableReviewQueueItemCount: number;
	agedWorkflowCount: number;
	permissionDeniedCount: number;
}

export interface ActivityAgentGroup {
	displayName: string;
	observedClientType: string;
	sessionCount: number;
	lastConnectedAt: number;
	lastUsedAt: number;
	sortTimestamp: number;
}

export interface ActivityAgentSummary {
	state: 'observed' | 'not_observed';
	observedAgentCount: number;
	agentGroups: ActivityAgentGroup[];
}

export type LatestTaskPlacement = 'hidden' | 'memory_loop' | 'standalone';

export type TaskExecutionPresentationStatus =
	| 'completed'
	| 'partially_complete'
	| 'blocked'
	| 'running'
	| 'in_progress';

export type TaskDurableOutputPresentationStatus =
	| Exclude<DurableOutputStatusAtFinish, ''>
	| 'legacy_proposals';

const MANAGED_PROPOSAL_PATH_PREFIXES = [
	TRACEKEEPER_REVIEW_QUEUE_DIR,
	ARCHIVE_REVIEW_QUEUE_DIR,
];

type TaskDurableOutputInput = Pick<
	AgentTaskRecord,
	| 'sessionNote'
	| 'memoryWrites'
	| 'sourceCaptures'
	| 'proposalIds'
	| 'proposalPaths'
	| 'proposals'
	| 'durableOutputStatusAtFinish'
	| 'durableOutputProposalCount'
	| 'durableOutputSourceCaptureCount'
	| 'durableOutputProposalIdsAtFinish'
	| 'durableOutputAppliedProposalIds'
	| 'durableOutputProposalPaths'
	| 'durableOutputRejectedCount'
	| 'durableOutputUnresolvedCount'
>;

export function selectLatestTaskPlacement(latestTask: AgentTaskRecord | null): LatestTaskPlacement {
	if (!latestTask) {
		return 'hidden';
	}
	const status = latestTask.status.trim().toLowerCase();
	return status === 'completed' || status === 'done' || status === 'success'
		? 'memory_loop'
		: 'standalone';
}

export function selectTaskExecutionPresentationStatus(
	task: Pick<AgentTaskRecord, 'status'>
): TaskExecutionPresentationStatus {
	const normalized = task.status.toLowerCase().trim();
	if (['completed', 'done', 'success'].includes(normalized)) {
		return 'completed';
	}
	if (['partial', 'partial_complete', 'partially_complete', 'partly_complete'].includes(normalized)) {
		return 'partially_complete';
	}
	if (['interrupted', 'blocked', 'failed', 'error', 'cancelled', 'canceled', 'timed_out'].includes(normalized)) {
		return 'blocked';
	}
	if (['active', 'running', 'in_progress'].includes(normalized)) {
		return 'running';
	}
	return 'in_progress';
}

export function countTaskDurableMemoryWrites(
	task: Pick<AgentTaskRecord, 'memoryWrites' | 'sessionNote'>
): number {
	return task.memoryWrites.filter((path) => path && path !== task.sessionNote).length;
}

export function countTaskProposalReferences(
	task: Pick<
		AgentTaskRecord,
		| 'proposalIds'
		| 'proposalPaths'
		| 'proposals'
		| 'durableOutputProposalCount'
		| 'durableOutputProposalIdsAtFinish'
		| 'durableOutputProposalPaths'
	>
): number {
	return Math.max(
		task.durableOutputProposalCount,
		task.proposalIds.length,
		task.proposalPaths.length,
		task.proposals.length,
		task.durableOutputProposalIdsAtFinish.length,
		task.durableOutputProposalPaths.length
	);
}

export function countTaskSourceCaptureEvidence(
	task: Pick<AgentTaskRecord, 'sourceCaptures' | 'durableOutputSourceCaptureCount'>
): number {
	return Math.max(task.durableOutputSourceCaptureCount, task.sourceCaptures.length);
}

export function taskSnapshotProposalIdsAreFullyApplied(
	task: Pick<
		AgentTaskRecord,
		'durableOutputProposalIdsAtFinish' | 'durableOutputAppliedProposalIds'
	>
): boolean {
	const proposalIdsAtFinish = [...new Set(
		task.durableOutputProposalIdsAtFinish.map((proposalId) => proposalId.trim()).filter(Boolean)
	)];
	if (proposalIdsAtFinish.length === 0) {
		return false;
	}
	const appliedProposalIds = new Set(
		task.durableOutputAppliedProposalIds.map((proposalId) => proposalId.trim()).filter(Boolean)
	);
	return proposalIdsAtFinish.every((proposalId) => appliedProposalIds.has(proposalId));
}

export function taskProposalNavigationPaths(
	task: Pick<AgentTaskRecord, 'proposalPaths' | 'proposals' | 'durableOutputProposalPaths'>
): string[] {
	const paths = [
		...task.proposalPaths,
		...task.durableOutputProposalPaths,
		...task.proposals,
	];
	return [...new Set(paths.map((path) => path.replace(/\\/g, '/').trim().replace(/^\.\//, ''))
		.filter((path) =>
			Boolean(path)
			&& !path.startsWith('/')
			&& path.toLowerCase().endsWith('.md')
			&& !path.split('/').some((segment) => segment === '.' || segment === '..')
			&& MANAGED_PROPOSAL_PATH_PREFIXES.some((prefix) =>
				path === prefix || path.startsWith(`${prefix}/`)
			)
		))];
}

export function selectTaskDurableOutputPresentationStatus(
	task: TaskDurableOutputInput
): TaskDurableOutputPresentationStatus {
	if (task.durableOutputStatusAtFinish) {
		const allSnapshotProposalsApplied = taskSnapshotProposalIdsAreFullyApplied(task);
		if (
			['pending_review', 'ready_to_apply', 'revision_requested'].includes(
				task.durableOutputStatusAtFinish
			)
			&& allSnapshotProposalsApplied
		) {
			return 'applied';
		}
		if (
			task.durableOutputStatusAtFinish === 'mixed'
			&& allSnapshotProposalsApplied
			&& task.durableOutputRejectedCount === 0
			&& task.durableOutputUnresolvedCount === 0
		) {
			return 'applied';
		}
		return task.durableOutputStatusAtFinish;
	}
	if (countTaskDurableMemoryWrites(task) > 0) {
		return 'applied';
	}
	if (countTaskProposalReferences(task) > 0) {
		return 'legacy_proposals';
	}
	return 'none';
}

export function selectActivityPrimaryAction(input: ActivityPrimaryActionInput): ActivityPrimaryAction {
	if (input.structureState !== 'initialized') {
		return 'repair_structure';
	}

	const runtime = runtimeViewModel(input.runtimeStatus);
	if (runtime.primaryAction !== 'none') {
		return 'recover_runtime';
	}
	if (runtime.state !== 'running') {
		return 'none';
	}
	if (input.actionableReviewQueueItemCount > 0) {
		return 'review_changes';
	}
	if (input.agedWorkflowCount > 0 || input.permissionDeniedCount > 0) {
		return 'inspect_diagnostics';
	}
	return 'none';
}

export function buildActivityAgentSummary(recentAgents: AgentConnectionRecord[]): ActivityAgentSummary {
	const groupedAgents = new Map<string, {
		agent: ActivityAgentGroup;
		sessions: Set<string>;
	}>();
	for (const recentAgent of recentAgents) {
		const observedClientKey = recentAgent.observedClientType.trim() || 'unknown';
		const sessionKey = recentAgent.sessionId.trim() || recentAgent.agentId.trim() || observedClientKey;
		const connectedAt = Date.parse(recentAgent.connectedAt) || 0;
		const lastUsedAt = Date.parse(recentAgent.lastUsedAt) || 0;
		const existing = groupedAgents.get(observedClientKey);
		if (!existing) {
			groupedAgents.set(observedClientKey, {
				agent: {
					displayName: recentAgent.displayName,
					observedClientType: observedClientKey,
					sessionCount: 1,
					lastConnectedAt: connectedAt,
					lastUsedAt,
					sortTimestamp: recentAgent.sortTimestamp,
				},
				sessions: new Set([sessionKey]),
			});
			continue;
		}

		existing.sessions.add(sessionKey);
		existing.agent.lastConnectedAt = Math.max(existing.agent.lastConnectedAt, connectedAt);
		existing.agent.lastUsedAt = Math.max(existing.agent.lastUsedAt, lastUsedAt);
		if (recentAgent.sortTimestamp > existing.agent.sortTimestamp) {
			existing.agent.displayName = recentAgent.displayName;
			existing.agent.sortTimestamp = recentAgent.sortTimestamp;
		}
	}

	const agentGroups = [...groupedAgents.values()]
		.map(({ agent, sessions }) => ({ ...agent, sessionCount: sessions.size }))
		.sort((left, right) => right.sortTimestamp - left.sortTimestamp);
	return {
		state: agentGroups.length > 0 ? 'observed' : 'not_observed',
		observedAgentCount: agentGroups.length,
		agentGroups,
	};
}

export function selectSuccessfullyUsedAgentConnections(
	recentAgents: AgentConnectionRecord[]
): AgentConnectionRecord[] {
	return recentAgents.filter((agent) =>
		agent.transport.trim().toLowerCase() === 'streamable-http'
		&& agent.sessionId.trim() !== ''
		&& agent.resultStatus === 'success'
		&& Date.parse(agent.lastUsedAt) > 0
		&& agent.lastSuccessfulTool.trim() !== ''
	);
}

export function buildSuccessfullyUsedAgentSummary(
	recentAgents: AgentConnectionRecord[]
): ActivityAgentSummary {
	return buildActivityAgentSummary(selectSuccessfullyUsedAgentConnections(recentAgents));
}
