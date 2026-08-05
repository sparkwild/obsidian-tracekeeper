import type { AgentConnectionRecord } from '../activity/activity-model';
import type { AgentIntegrationSnapshot } from './agent-integrations';
import type { GeneratedClientConfig } from '../client-config/client-config';
import type { PendingOAuthApproval } from '../activity/activity-model';
import { buildConnectionPresentation, type ConnectionPresentation } from '../client-config/agent-connection-view-model';

export interface VisibleAgentConfiguration {
	agent: AgentConnectionRecord | null;
	config: GeneratedClientConfig;
	integration: AgentIntegrationSnapshot;
	presentation: ConnectionPresentation;
}

export interface AgentConfigurationViewModel {
	visibleAgents: VisibleAgentConfiguration[];
	candidateConfigs: GeneratedClientConfig[];
}

export function buildAgentConfigurationViewModel(
	clientConfigs: GeneratedClientConfig[],
	recentAgents: AgentConnectionRecord[],
	integrations: AgentIntegrationSnapshot[] = [],
	pendingOAuthRequests: PendingOAuthApproval[] = []
): AgentConfigurationViewModel {
	const integrationByClient = new Map(integrations.map((integration) => [integration.clientProfileId, integration]));
	const visibleAgents = clientConfigs.flatMap((config) => {
		const integration = integrationByClient.get(config.clientId);
		if (!integration) return [];
		const agent = recentAgents.find((candidate) => candidate.integrationId === integration.integrationId) ?? null;
		const currentCredentialAgent = integration.credential
			? recentAgents.find((candidate) =>
				candidate.integrationId === integration.integrationId
				&& candidate.credentialId === integration.credential?.credentialId
			) ?? null
			: null;
		return [{
			config,
			integration,
			agent,
			presentation: buildConnectionPresentation({
				authMode: integration.authMode,
				setupCommandCopiedAt: integration.setupCommandCopiedAt,
					hasCredential: Boolean(integration.credential),
					hasPendingApproval: integration.authMode === 'oauth' && pendingOAuthRequests.length > 0,
					clientReached: Boolean(agent?.connectedAt) || (integration.authMode === 'oauth' && Boolean(integration.lastAuthorizedAt)),
				connected: Boolean(currentCredentialAgent?.connectedAt),
				used: Boolean(agent?.lastUsedAt),
				revoked: Boolean(integration.lastRevokedAt) && !integration.credential,
				needsUpdate: config.configState === 'needs_update',
			}),
		}];
	});
	return {
		visibleAgents,
		candidateConfigs: clientConfigs.filter((config) => !integrationByClient.has(config.clientId)),
	};
}
