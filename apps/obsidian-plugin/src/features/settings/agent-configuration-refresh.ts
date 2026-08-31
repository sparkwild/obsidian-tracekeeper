export type AgentConfigurationRefreshKind = 'content' | 'structure';

export interface AgentConfigurationRefreshCallbacks {
	content?: () => void | Promise<void>;
	structure?: () => void | Promise<void>;
}

export interface CommitWithBestEffortRefreshOutcome<T> {
	result: T;
	refreshError: unknown;
}

export function isSettingGroupHTMLElement(element: Element | null): element is HTMLElement {
	return Boolean(
		element
		&& element.tagName === 'DIV'
		&& element.classList.contains('setting-group')
	);
}

export function shouldReplaceAgentConfiguration(
	currentFingerprint: string,
	nextFingerprint: string,
	force: boolean
): boolean {
	return force || currentFingerprint !== nextFingerprint;
}

export async function commitWithBestEffortRefresh<T>(
	commit: () => Promise<T>,
	refresh: () => void | Promise<void>
): Promise<CommitWithBestEffortRefreshOutcome<T>> {
	const result = await commit();
	try {
		await refresh();
		return { result, refreshError: null };
	} catch (refreshError) {
		return { result, refreshError };
	}
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
