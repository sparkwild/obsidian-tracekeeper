import type { AgentConnectionRecord } from '../activity/activity-model';
import {
	buildSuccessfullyUsedAgentSummary,
	type ActivityAgentGroup,
} from '../activity/activity-view-model';
import type { GeneratedClientConfig } from '../client-config/client-config';

export interface VisibleAgentConfiguration {
	agent: ActivityAgentGroup;
	config: GeneratedClientConfig;
}

export interface AgentConfigurationViewModel {
	visibleAgents: VisibleAgentConfiguration[];
	candidateConfigs: GeneratedClientConfig[];
}

export function buildAgentConfigurationViewModel(
	clientConfigs: GeneratedClientConfig[],
	recentAgents: AgentConnectionRecord[]
): AgentConfigurationViewModel {
	const summary = buildSuccessfullyUsedAgentSummary(recentAgents);
	const visibleClientIds = new Set<string>();
	const visibleAgents = summary.agentGroups.flatMap((agent) => {
		const config = clientConfigs.find(
			(candidate) => candidate.clientId === agent.observedClientType
		);
		if (
			!config
			|| (config.supportsAutoConfigure && config.configState !== 'configured')
		) {
			return [];
		}
		visibleClientIds.add(config.clientId);
		return [{ agent, config }];
	});
	return {
		visibleAgents,
		candidateConfigs: clientConfigs.filter((config) => !visibleClientIds.has(config.clientId)),
	};
}
