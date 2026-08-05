#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-agent-configuration-test-'));
const output = path.join(tempRoot, 'agent-configuration-view-model.mjs');

const config = (clientId, overrides = {}) => ({
	clientId,
	displayName: clientId,
	description: '',
	configState: 'not_configured',
	setupCapability: 'manual',
	supportedAuthModes: ['oauth', 'bearer'],
	setupInstruction: 'http://127.0.0.1:58437/mcp',
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
	lastPreparedEndpoint: 'http://127.0.0.1:58437/mcp',
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
	await build({
		entryPoints: [path.resolve('src/features/settings/agent-configuration-view-model.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const { buildAgentConfigurationViewModel } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
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

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 15 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
