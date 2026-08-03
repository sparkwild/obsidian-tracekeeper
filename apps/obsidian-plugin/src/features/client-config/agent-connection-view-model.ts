import type { ClientAuthMode } from './client-config';

export type ConnectionUiState = 'not_configured' | 'copied_unverified' | 'client_reached' | 'pending_approval' | 'authorized' | 'connected' | 'used' | 'revoked' | 'needs_update' | 'manual';
export type McpConnectionState = 'not_started' | 'copied_unverified' | 'client_reached' | 'connected' | 'needs_update';
export type AuthorizationState = 'not_authorized' | 'pending_approval' | 'authorized' | 'revoked';
export type UsageState = 'never_used' | 'used';
export type ConnectionPrimaryAction = 'create' | 'copy_setup' | 'generate_bearer' | 'revoke' | null;
export type ConnectionVisibleSection = 'setup' | 'authorization' | 'skill' | 'usage';

export interface ConnectionPresentationInput {
	authMode: ClientAuthMode;
	setupCommandCopiedAt?: string;
	hasCredential: boolean;
	hasPendingApproval?: boolean;
	clientReached?: boolean;
	connected?: boolean;
	used?: boolean;
	revoked?: boolean;
	needsUpdate?: boolean;
	configured?: boolean;
}

export interface ConnectionPresentation {
	state: ConnectionUiState;
	mcpState: McpConnectionState;
	authorizationState: AuthorizationState;
	usageState: UsageState;
	primaryAction: ConnectionPrimaryAction;
	visibleSections: readonly ConnectionVisibleSection[];
}

export function buildConnectionPresentation(input: ConnectionPresentationInput): ConnectionPresentation {
	const clientReached = input.clientReached || input.hasPendingApproval;
	const mcpState: McpConnectionState = input.needsUpdate
		? 'needs_update'
		: input.connected
			? 'connected'
			: clientReached
				? 'client_reached'
				: input.setupCommandCopiedAt
					? 'copied_unverified'
					: 'not_started';
	const authorizationState: AuthorizationState = input.revoked
		? 'revoked'
		: input.hasCredential
			? 'authorized'
			: input.hasPendingApproval
				? 'pending_approval'
				: 'not_authorized';
	const usageState: UsageState = input.used ? 'used' : 'never_used';
	if (input.needsUpdate) return { state: 'needs_update', mcpState, authorizationState, usageState, primaryAction: 'copy_setup', visibleSections: ['setup', 'authorization', 'skill'] };
	if (input.revoked) return { state: 'revoked', mcpState, authorizationState, usageState, primaryAction: input.authMode === 'bearer' ? 'generate_bearer' : 'copy_setup', visibleSections: ['setup', 'authorization', 'skill'] };
	if (input.used) return { state: 'used', mcpState, authorizationState, usageState, primaryAction: 'revoke', visibleSections: ['setup', 'authorization', 'usage', 'skill'] };
	if (input.connected) return { state: 'connected', mcpState, authorizationState, usageState, primaryAction: 'revoke', visibleSections: ['setup', 'authorization', 'usage', 'skill'] };
	if (input.hasPendingApproval) return { state: 'pending_approval', mcpState, authorizationState, usageState, primaryAction: null, visibleSections: ['setup', 'authorization', 'skill'] };
	if (input.hasCredential) return { state: 'authorized', mcpState, authorizationState, usageState, primaryAction: 'revoke', visibleSections: ['setup', 'authorization', 'skill'] };
	if (clientReached) return { state: 'client_reached', mcpState, authorizationState, usageState, primaryAction: 'copy_setup', visibleSections: ['setup', 'authorization', 'skill'] };
	if (input.setupCommandCopiedAt) return { state: 'copied_unverified', mcpState, authorizationState, usageState, primaryAction: 'copy_setup', visibleSections: ['setup', 'authorization', 'skill'] };
	return { state: input.authMode === 'bearer' ? 'manual' : 'not_configured', mcpState, authorizationState, usageState, primaryAction: input.authMode === 'bearer' ? 'generate_bearer' : 'copy_setup', visibleSections: ['setup', 'authorization', 'skill'] };
}
