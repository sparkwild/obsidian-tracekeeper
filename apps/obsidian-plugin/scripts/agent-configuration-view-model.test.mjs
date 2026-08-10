#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-agent-configuration-test-'));
const output = path.join(tempRoot, 'agent-configuration-view-model.mjs');
const oauthPendingOutput = path.join(tempRoot, 'oauth-pending.mjs');

const config = (clientId, overrides = {}) => ({
	clientId,
	displayName: clientId,
	description: '',
	configState: 'not_configured',
	setupCapability: 'manual',
	supportedAuthModes: ['oauth', 'bearer'],
	setupInstruction: 'http://127.0.0.1:51601/mcp',
	...overrides,
});

const integration = (clientProfileId, overrides = {}) => ({
	schemaVersion: 1,
	integrationId: `integration-${clientProfileId}`,
	clientProfileId,
	authMode: 'oauth',
	createdAt: '2026-08-03T00:00:00.000Z',
	updatedAt: '2026-08-03T00:00:00.000Z',
	setupCommandCopiedAt: '',
	lastPreparedEndpoint: 'http://127.0.0.1:51601/mcp',
	lastAuthorizedAt: '',
	lastRevokedAt: '',
	credential: null,
	oauthClient: null,
	...overrides,
});

const agent = (overrides = {}) => ({
	principalId: 'local-user',
	integrationId: 'integration-codex',
	credentialId: 'credential-codex',
	authMode: 'oauth',
	agentId: 'agent-codex',
	sessionId: 'session-codex',
	clientName: 'Codex',
	observedClientNameRaw: 'Codex',
	observedClientType: 'codex',
	observedClientVersion: '1.0.0',
	displayName: 'Codex',
	transport: 'streamable-http',
	status: 'active',
	lastSeen: '2026-08-03T00:01:00.000Z',
	lastToolCall: 'tracekeeper.status',
	connectedAt: '2026-08-03T00:00:00.000Z',
	resultStatus: 'success',
	lastUsedAt: '2026-08-03T00:01:00.000Z',
	lastSuccessfulTool: 'tracekeeper.status',
	runtimeVersion: '0.2.4',
	permissionProfile: 'local trust fixed capability set',
	sortTimestamp: Date.parse('2026-08-03T00:01:00.000Z'),
	...overrides,
});

try {
	await Promise.all([
		build({
			entryPoints: [path.resolve('src/features/settings/agent-configuration-view-model.ts')],
			outfile: output,
			bundle: true,
			platform: 'node',
			format: 'esm',
			logLevel: 'silent',
		}),
		build({
			entryPoints: [path.resolve('src/features/client-config/oauth-pending.ts')],
			outfile: oauthPendingOutput,
			bundle: true,
			platform: 'node',
			format: 'esm',
			logLevel: 'silent',
		}),
	]);
	const { buildAgentConfigurationViewModel } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const {
		OAUTH_AUTHORIZATION_CODE_RESERVATION_TTL_MS,
		PendingOAuthClientReservations,
		assertOAuthClientOwnershipAvailable,
		commitOAuthDecisionWithBestEffortRefresh,
		enqueueSingleOwnerOAuthCredentialIssue,
		pendingOAuthRequestsForModal,
		uniqueOAuthClientOwners,
		unboundPendingOAuthRequests,
	} = await import(`${pathToFileURL(oauthPendingOutput).href}?test=${Date.now()}`);
	const clientConfigs = [config('codex'), config('claude-code'), config('cursor'), config('custom')];
	const projection = buildAgentConfigurationViewModel(
		clientConfigs,
		[agent(), agent({ integrationId: 'integration-claude-code', credentialId: 'credential-claude', observedClientType: 'claude-code', displayName: 'Claude Code', agentId: 'agent-claude' })],
		[integration('codex'), integration('claude-code')],
	);

	assert.deepEqual(projection.visibleAgents.map(({ config: visibleConfig }) => visibleConfig.clientId), ['codex', 'claude-code']);
	assert.equal(projection.visibleAgents.find(({ config: visibleConfig }) => visibleConfig.clientId === 'codex').agent?.sessionId, 'session-codex');
	assert.equal(projection.visibleAgents.find(({ config: visibleConfig }) => visibleConfig.clientId === 'claude-code').agent?.displayName, 'Claude Code');
	assert.deepEqual(projection.candidateConfigs.map((candidate) => candidate.clientId), ['cursor', 'custom']);

	const noRecentUse = buildAgentConfigurationViewModel(
		[config('codex'), config('gemini')],
		[],
		[integration('codex')],
	);
	assert.equal(noRecentUse.visibleAgents.length, 1);
	assert.equal(noRecentUse.visibleAgents[0].agent, null);
	assert.deepEqual(noRecentUse.candidateConfigs.map((candidate) => candidate.clientId), ['gemini']);

	const allCandidates = buildAgentConfigurationViewModel([config('custom')], [], []);
	assert.equal(allCandidates.visibleAgents.length, 0);
	assert.deepEqual(allCandidates.candidateConfigs.map((candidate) => candidate.clientId), ['custom']);

	const matchingCredential = buildAgentConfigurationViewModel(
		[config('codex')],
		[agent()],
		[integration('codex', { credential: { credentialId: 'credential-codex', kind: 'oauth', issuedAt: '2026-08-03T00:00:00.000Z' } })],
	);
	assert.equal(matchingCredential.visibleAgents[0].presentation.mcpState, 'connected');

	const replacedCredential = buildAgentConfigurationViewModel(
		[config('codex')],
		[agent()],
		[integration('codex', { credential: { credentialId: 'credential-new', kind: 'oauth', issuedAt: '2026-08-03T00:02:00.000Z' } })],
	);
	assert.equal(replacedCredential.visibleAgents[0].presentation.mcpState, 'client_reached');
	assert.equal(replacedCredential.visibleAgents[0].presentation.authorizationState, 'authorized');

	const revokedCredential = buildAgentConfigurationViewModel(
		[config('codex')],
		[agent()],
		[integration('codex', { lastRevokedAt: '2026-08-03T00:02:00.000Z' })],
	);
	assert.equal(revokedCredential.visibleAgents[0].presentation.mcpState, 'client_reached');
	assert.equal(revokedCredential.visibleAgents[0].presentation.authorizationState, 'revoked');

	const now = Date.now();
	const codexBound = integration('codex', {
		oauthClient: {
			clientId: 'oauth-client-codex',
			clientNameClaim: 'Self-reported Codex',
			redirectUris: ['http://127.0.0.1/callback'],
			registeredAt: new Date(now - 5_000).toISOString(),
		},
	});
	const claudeBound = integration('claude-code', {
		oauthClient: {
			clientId: 'oauth-client-claude',
			clientNameClaim: 'Self-reported Claude',
			redirectUris: ['http://127.0.0.1/callback'],
			registeredAt: new Date(now - 5_000).toISOString(),
		},
	});
	const codexRequest = {
		requestId: 'request-codex',
		clientId: 'oauth-client-codex',
		clientNameClaim: 'Untrusted label',
		redirectUri: 'http://127.0.0.1/callback',
		resource: 'http://127.0.0.1:51601/mcp',
		scope: 'mcp',
		issuedAt: now - 1_000,
		expiresAt: now + 60_000,
	};
	const exactOwnership = buildAgentConfigurationViewModel(
		[config('codex'), config('claude-code')],
		[],
		[codexBound, claudeBound],
		[codexRequest],
	);
	assert.equal(exactOwnership.visibleAgents.find(({ config: item }) => item.clientId === 'codex').presentation.state, 'pending_approval');
	assert.notEqual(exactOwnership.visibleAgents.find(({ config: item }) => item.clientId === 'claude-code').presentation.state, 'pending_approval');
	assert.deepEqual(exactOwnership.unboundOAuthRequests, []);
	assert.deepEqual(pendingOAuthRequestsForModal(claudeBound, [codexBound, claudeBound], [codexRequest], '', now), []);

	const duplicateCodexOwner = integration('codex', {
		oauthClient: { ...codexBound.oauthClient, clientId: 'oauth-client-duplicate' },
	});
	const duplicateClaudeOwner = integration('claude-code', {
		oauthClient: { ...claudeBound.oauthClient, clientId: 'oauth-client-duplicate' },
	});
	const duplicateOwnerRequest = {
		...codexRequest,
		requestId: 'request-duplicate-owner',
		clientId: 'oauth-client-duplicate',
	};
	const duplicateOwnerRecords = [duplicateCodexOwner, duplicateClaudeOwner];
	const duplicateOwnerBytes = JSON.stringify(duplicateOwnerRecords);
	const duplicateOwnerProjection = buildAgentConfigurationViewModel(
		[config('codex'), config('claude-code')],
		[],
		duplicateOwnerRecords,
		[duplicateOwnerRequest, { ...duplicateOwnerRequest }],
	);
	assert.equal(duplicateOwnerProjection.visibleAgents.some(({ presentation }) => presentation.state === 'pending_approval'), false);
	assert.deepEqual(duplicateOwnerProjection.unboundOAuthRequests, []);
	assert.deepEqual(duplicateOwnerProjection.conflictingOAuthRequests.map(({ requestId }) => requestId), ['request-duplicate-owner']);
	assert.deepEqual(duplicateOwnerProjection.oauthClientOwnershipConflicts, [{
		clientId: 'oauth-client-duplicate',
		integrationIds: [duplicateCodexOwner.integrationId, duplicateClaudeOwner.integrationId],
	}]);
	assert.deepEqual(pendingOAuthRequestsForModal(duplicateCodexOwner, duplicateOwnerRecords, [duplicateOwnerRequest], '', now), []);
	assert.deepEqual(pendingOAuthRequestsForModal(duplicateClaudeOwner, duplicateOwnerRecords, [duplicateOwnerRequest], '', now), []);
	assert.deepEqual(uniqueOAuthClientOwners([...duplicateOwnerRecords, codexBound]).map(({ integrationId }) => integrationId), [codexBound.integrationId]);
	assert.throws(
		() => assertOAuthClientOwnershipAvailable(duplicateOwnerRecords, duplicateCodexOwner.integrationId, duplicateOwnerRequest.clientId),
		/OAuth client is already bound/
	);
	assert.equal(JSON.stringify(duplicateOwnerRecords), duplicateOwnerBytes);

	const openCodex = integration('codex');
	const openClaude = integration('claude-code');
	const unboundRequest = { ...codexRequest, requestId: 'request-unbound', clientId: 'oauth-client-new' };
	const unboundProjection = buildAgentConfigurationViewModel(
		[config('codex'), config('claude-code')],
		[],
		[openCodex, openClaude],
		[unboundRequest],
	);
	assert.equal(unboundProjection.visibleAgents.some(({ presentation }) => presentation.state === 'pending_approval'), false);
	assert.deepEqual(unboundProjection.unboundOAuthRequests.map(({ requestId }) => requestId), ['request-unbound']);
	assert.deepEqual(
		pendingOAuthRequestsForModal(openCodex, [openCodex, openClaude], [unboundRequest], 'request-unbound', now)
			.map(({ requestId }) => requestId),
		['request-unbound']
	);
	assert.deepEqual(pendingOAuthRequestsForModal(openClaude, [openCodex, openClaude], [unboundRequest], '', now), []);

	const expiredRequest = { ...unboundRequest, requestId: 'request-expired', expiresAt: now - 1 };
	assert.deepEqual(unboundPendingOAuthRequests([openCodex], [expiredRequest], now), []);

	const reservations = new PendingOAuthClientReservations();
	const competingRequest = { ...unboundRequest, requestId: 'request-competing' };
	reservations.reserve(unboundRequest, openCodex.integrationId, now);
	assert.throws(
		() => reservations.reserve(competingRequest, openClaude.integrationId, now),
		/OAuth client already has a pending approval/
	);
	assert.equal(reservations.size, 1);
	reservations.releaseRequest(unboundRequest.requestId);
	reservations.reserve(competingRequest, openClaude.integrationId, now);
	assert.equal(reservations.size, 1);
	reservations.prune(competingRequest.expiresAt + 1);
	assert.equal(reservations.size, 1);
	reservations.prune(competingRequest.expiresAt + OAUTH_AUTHORIZATION_CODE_RESERVATION_TTL_MS + 1);
	assert.equal(reservations.size, 0);

	let ownedIntegrations = [openCodex, openClaude];
	let credentialQueue = Promise.resolve();
	const enqueueCredentialBinding = (operation) => {
		const run = credentialQueue.then(operation, operation);
		credentialQueue = run.then(() => undefined, () => undefined);
		return run;
	};
	const issueReservations = new PendingOAuthClientReservations();
	issueReservations.reserve(unboundRequest, openCodex.integrationId, now);
	const bindClient = (integrationId) => enqueueSingleOwnerOAuthCredentialIssue(
		enqueueCredentialBinding,
		() => ownedIntegrations,
		issueReservations,
		{ integrationId, clientId: unboundRequest.clientId },
		async () => {
			await Promise.resolve();
			ownedIntegrations = ownedIntegrations.map((candidate) => candidate.integrationId === integrationId
				? {
					...candidate,
					oauthClient: {
						clientId: unboundRequest.clientId,
						clientNameClaim: unboundRequest.clientNameClaim,
						redirectUris: [unboundRequest.redirectUri],
						registeredAt: new Date(now).toISOString(),
					},
				}
				: candidate);
			return integrationId;
		}
	);
	const raceResults = await Promise.allSettled([
		bindClient(openCodex.integrationId),
		bindClient(openClaude.integrationId),
	]);
	assert.equal(raceResults.filter(({ status }) => status === 'fulfilled').length, 1);
	assert.equal(raceResults.filter(({ status }) => status === 'rejected').length, 1);
	assert.equal(ownedIntegrations.filter(({ oauthClient }) => oauthClient?.clientId === unboundRequest.clientId).length, 1);
	assert.equal(issueReservations.size, 0);

	const committedDecisions = [];
	let decisionRefreshCount = 0;
	for (const decision of ['allow', 'deny']) {
		const staleRefresh = await commitOAuthDecisionWithBestEffortRefresh(
			async () => { committedDecisions.push(decision); },
			async () => {
				decisionRefreshCount += 1;
				throw new Error(`${decision} refresh failed`);
			}
		);
		assert.match(staleRefresh.refreshError?.message ?? '', new RegExp(`${decision} refresh failed`));
	}
	assert.deepEqual(committedDecisions, ['allow', 'deny']);
	assert.equal(decisionRefreshCount, 2);
	await assert.rejects(
		() => commitOAuthDecisionWithBestEffortRefresh(
			async () => { throw new Error('decision failed'); },
			async () => { decisionRefreshCount += 1; }
		),
		/decision failed/
	);
	assert.equal(decisionRefreshCount, 2);

	const runtimeOAuthSource = fs.readFileSync(path.resolve('../../packages/mcp-runtime/src/http-runtime.ts'), 'utf8');
	assert.match(runtimeOAuthSource, /const DEFAULT_AUTHORIZATION_CODE_TTL_MS = 2 \* 60 \* 1000;/);
	assert.equal(OAUTH_AUTHORIZATION_CODE_RESERVATION_TTL_MS, 2 * 60 * 1000);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 57 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
