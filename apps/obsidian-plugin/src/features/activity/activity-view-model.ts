import type { RuntimeViewModelInput } from '../runtime/runtime-view-model';
import { runtimeViewModel } from '../runtime/runtime-view-model';
import type { StructureState } from '../structure/legacy-migration-controller';
import type { AgentConnectionRecord, AgentTaskRecord } from './activity-model';

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

export function selectLatestTaskPlacement(latestTask: AgentTaskRecord | null): LatestTaskPlacement {
	if (!latestTask) {
		return 'hidden';
	}
	const status = latestTask.status.trim().toLowerCase();
	return status === 'completed' || status === 'done' || status === 'success'
		? 'memory_loop'
		: 'standalone';
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
