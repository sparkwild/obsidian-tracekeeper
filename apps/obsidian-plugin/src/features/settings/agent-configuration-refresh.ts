export type AgentConfigurationRefreshKind = 'content' | 'structure';

export interface AgentConfigurationRefreshCallbacks {
	content?: () => void | Promise<void>;
	structure?: () => void | Promise<void>;
}

export async function refreshAgentConfiguration(
	kind: AgentConfigurationRefreshKind,
	callbacks: AgentConfigurationRefreshCallbacks
): Promise<void> {
	const refresh = kind === 'structure'
		? callbacks.structure ?? callbacks.content
		: callbacks.content;
	await refresh?.();
}
