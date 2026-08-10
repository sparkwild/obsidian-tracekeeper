import type { PendingOAuthApproval } from '../activity/activity-model';
import type { AgentIntegrationSnapshot } from '../settings/agent-integrations';

interface OAuthClientReservation {
	requestId: string;
	clientId: string;
	integrationId: string;
	expiresAt: number;
}

export const OAUTH_AUTHORIZATION_CODE_RESERVATION_TTL_MS = 2 * 60 * 1000;

export class PendingOAuthClientReservations {
	private readonly byRequestId = new Map<string, OAuthClientReservation>();

	get size(): number {
		return this.byRequestId.size;
	}

	reserve(request: PendingOAuthApproval, integrationId: string, now = Date.now()): void {
		this.prune(now);
		if (!isActivePendingOAuthRequest(request, now)) {
			throw new Error('OAuth request is no longer pending.');
		}
		const existingRequest = this.byRequestId.get(request.requestId);
		if (existingRequest && (
			existingRequest.clientId !== request.clientId
			|| existingRequest.integrationId !== integrationId
		)) {
			throw new Error('OAuth request already reserves a different Agent integration.');
		}
		const conflicting = [...this.byRequestId.values()].find((reservation) =>
			reservation.clientId === request.clientId
			&& reservation.integrationId !== integrationId
		);
		if (conflicting) {
			throw new Error('OAuth client already has a pending approval for another Agent integration.');
		}
		this.byRequestId.set(request.requestId, {
			requestId: request.requestId,
			clientId: request.clientId,
			integrationId,
			expiresAt: request.expiresAt + OAUTH_AUTHORIZATION_CODE_RESERVATION_TTL_MS,
		});
	}

	releaseRequest(requestId: string): void {
		this.byRequestId.delete(requestId);
	}

	releaseIntegration(integrationId: string): void {
		for (const [requestId, reservation] of this.byRequestId.entries()) {
			if (reservation.integrationId === integrationId) this.byRequestId.delete(requestId);
		}
	}

	releaseClientOwner(clientId: string, integrationId: string): void {
		for (const [requestId, reservation] of this.byRequestId.entries()) {
			if (reservation.clientId === clientId && reservation.integrationId === integrationId) {
				this.byRequestId.delete(requestId);
			}
		}
	}

	prune(now = Date.now()): void {
		for (const [requestId, reservation] of this.byRequestId.entries()) {
			if (reservation.expiresAt <= now) this.byRequestId.delete(requestId);
		}
	}

	clear(): void {
		this.byRequestId.clear();
	}
}

export interface OAuthDecisionRefreshOutcome {
	refreshError: unknown | null;
}

export interface OAuthClientOwnershipConflict {
	clientId: string;
	integrationIds: string[];
}

export const commitOAuthDecisionWithBestEffortRefresh = async (
	commit: () => Promise<void>,
	refresh: () => Promise<void>
): Promise<OAuthDecisionRefreshOutcome> => {
	await commit();
	try {
		await refresh();
		return { refreshError: null };
	} catch (refreshError) {
		return { refreshError };
	}
};

const oauthClientOwnerCount = (
	integrations: readonly AgentIntegrationSnapshot[],
	clientId: string
): number => integrations.filter((integration) =>
	integration.authMode === 'oauth'
	&& integration.oauthClient?.clientId === clientId
).length;

export const uniqueOAuthClientOwners = (
	integrations: readonly AgentIntegrationSnapshot[]
): AgentIntegrationSnapshot[] => integrations.filter((integration) => {
	const clientId = integration.authMode === 'oauth' ? integration.oauthClient?.clientId : '';
	return Boolean(clientId) && oauthClientOwnerCount(integrations, clientId ?? '') === 1;
});

export const oauthClientOwnershipConflicts = (
	integrations: readonly AgentIntegrationSnapshot[]
): OAuthClientOwnershipConflict[] => {
	const ownersByClientId = new Map<string, string[]>();
	for (const integration of integrations) {
		const clientId = integration.authMode === 'oauth' ? integration.oauthClient?.clientId : '';
		if (!clientId) continue;
		ownersByClientId.set(clientId, [...(ownersByClientId.get(clientId) ?? []), integration.integrationId]);
	}
	return [...ownersByClientId.entries()]
		.filter(([, integrationIds]) => integrationIds.length > 1)
		.map(([clientId, integrationIds]) => ({ clientId, integrationIds }));
};

export const assertOAuthClientOwnershipAvailable = (
	integrations: readonly AgentIntegrationSnapshot[],
	targetIntegrationId: string,
	clientId: string
): void => {
	const conflictingOwner = integrations.find((integration) =>
		integration.authMode === 'oauth'
		&& integration.oauthClient?.clientId === clientId
		&& integration.integrationId !== targetIntegrationId
	);
	if (conflictingOwner) {
		throw new Error('OAuth client is already bound to a different Agent integration.');
	}
};

export const enqueueSingleOwnerOAuthCredentialIssue = <T>(
	enqueue: (operation: () => Promise<T>) => Promise<T>,
	readIntegrations: () => readonly AgentIntegrationSnapshot[],
	reservations: PendingOAuthClientReservations,
	input: { integrationId: string; clientId: string },
	issue: () => Promise<T>
): Promise<T> => enqueue(async () => {
	try {
		assertOAuthClientOwnershipAvailable(
			readIntegrations(),
			input.integrationId,
			input.clientId
		);
		return await issue();
	} finally {
		reservations.releaseClientOwner(input.clientId, input.integrationId);
	}
});

export const isActivePendingOAuthRequest = (
	request: PendingOAuthApproval,
	now = Date.now()
): boolean => Number.isFinite(request.expiresAt) && request.expiresAt > now;

export const pendingOAuthRequestsForIntegration = (
	integration: AgentIntegrationSnapshot | null,
	integrations: readonly AgentIntegrationSnapshot[],
	requests: readonly PendingOAuthApproval[],
	now = Date.now()
): PendingOAuthApproval[] => {
	if (integration?.authMode !== 'oauth' || !integration.oauthClient?.clientId) return [];
	if (oauthClientOwnerCount(integrations, integration.oauthClient.clientId) !== 1) return [];
	return requests.filter((request) =>
		isActivePendingOAuthRequest(request, now)
		&& request.clientId === integration.oauthClient?.clientId
	);
};

export const unboundPendingOAuthRequests = (
	integrations: readonly AgentIntegrationSnapshot[],
	requests: readonly PendingOAuthApproval[],
	now = Date.now()
): PendingOAuthApproval[] => {
	return requests.filter((request) =>
		isActivePendingOAuthRequest(request, now)
		&& oauthClientOwnerCount(integrations, request.clientId) === 0
	);
};

export const conflictingPendingOAuthRequests = (
	integrations: readonly AgentIntegrationSnapshot[],
	requests: readonly PendingOAuthApproval[],
	now = Date.now()
): PendingOAuthApproval[] => {
	const seenRequestIds = new Set<string>();
	return requests.filter((request) => {
		if (
			seenRequestIds.has(request.requestId)
			|| !isActivePendingOAuthRequest(request, now)
			|| oauthClientOwnerCount(integrations, request.clientId) < 2
		) return false;
		seenRequestIds.add(request.requestId);
		return true;
	});
};

export const canBindPendingOAuthRequest = (
	integration: AgentIntegrationSnapshot,
	request: PendingOAuthApproval
): boolean => integration.authMode === 'oauth'
	&& !integration.credential
	&& (!integration.oauthClient || integration.oauthClient.clientId === request.clientId);

export const pendingOAuthRequestsForModal = (
	integration: AgentIntegrationSnapshot | null,
	integrations: readonly AgentIntegrationSnapshot[],
	requests: readonly PendingOAuthApproval[],
	selectedUnboundRequestId = '',
	now = Date.now()
): PendingOAuthApproval[] => {
	const bound = pendingOAuthRequestsForIntegration(integration, integrations, requests, now);
	if (!integration || !selectedUnboundRequestId) return bound;
	const selected = unboundPendingOAuthRequests(integrations, requests, now)
		.find((request) => request.requestId === selectedUnboundRequestId);
	if (!selected || !canBindPendingOAuthRequest(integration, selected)) return bound;
	return [selected, ...bound.filter((request) => request.requestId !== selected.requestId)];
};
