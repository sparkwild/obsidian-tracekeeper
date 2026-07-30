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
	transport: 'streamable-http',
	completeConfigText: '{}',
	redactedConfigText: '{}',
	supportsAutoConfigure: ['codex', 'gemini', 'grok', 'zcode'].includes(clientId),
	restartRequired: false,
	configFormat: 'mcp-json',
	configState: 'not_configured',
	configStatusLabel: 'Not configured',
	configStatusDetail: '',
	...overrides,
});

const agent = (overrides = {}) => ({
	principalId: 'local-user',
	agentId: 'agent-codex',
	sessionId: 'session-codex',
	clientName: 'Codex',
	observedClientNameRaw: 'Codex',
	observedClientType: 'codex',
	observedClientVersion: '1.0.0',
	displayName: 'Codex',
	transport: 'streamable-http',
	status: 'active',
	lastSeen: '2026-07-29T08:01:00.000Z',
	lastToolCall: 'tracekeeper.status',
	connectedAt: '2026-07-29T08:00:00.000Z',
	resultStatus: 'success',
	lastUsedAt: '2026-07-29T08:01:00.000Z',
	lastSuccessfulTool: 'tracekeeper.status',
	runtimeVersion: '0.2.4',
	permissionProfile: 'local trust fixed capability set',
	sortTimestamp: Date.parse('2026-07-29T08:01:00.000Z'),
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
	const { buildAgentConfigurationViewModel } = await import(
		`${pathToFileURL(output).href}?test=${Date.now()}`
	);
	const clientConfigs = [
		config('codex', { configState: 'configured' }),
		config('claude-code'),
		config('claude-desktop'),
		config('cursor'),
		config('gemini', { configState: 'configured' }),
		config('grok', { configState: 'configured' }),
		config('zcode', { configState: 'configured' }),
		config('custom'),
	];
	const projection = buildAgentConfigurationViewModel(clientConfigs, [
		agent(),
		agent({
			agentId: 'agent-codex-two',
			sessionId: 'session-codex-two',
			connectedAt: '2026-07-29T07:00:00.000Z',
			lastUsedAt: '2026-07-29T07:01:00.000Z',
			sortTimestamp: Date.parse('2026-07-29T07:01:00.000Z'),
		}),
		agent({
			agentId: 'agent-claude',
			sessionId: 'session-claude',
			observedClientType: 'claude-code',
			displayName: 'Claude Code',
			lastUsedAt: '',
			lastSuccessfulTool: '',
		}),
		agent({
			agentId: 'agent-cursor',
			sessionId: 'session-cursor',
			observedClientType: 'cursor',
			displayName: 'Cursor',
			connectedAt: '',
		}),
		agent({
			agentId: 'agent-custom',
			sessionId: 'session-custom',
			observedClientType: 'custom',
			displayName: 'Custom client',
			resultStatus: 'failed',
		}),
		agent({
			agentId: 'agent-unknown',
			sessionId: 'session-unknown',
			observedClientType: 'unknown',
			displayName: 'Unknown client',
		}),
		agent({
			agentId: 'tracekeeper-plugin-ui',
			sessionId: 'plugin-ui-session',
			observedClientType: 'custom',
			displayName: 'Custom client',
			transport: 'obsidian-direct',
		}),
		agent({
			agentId: 'agent-gemini',
			sessionId: 'session-gemini',
			observedClientType: 'gemini',
			displayName: 'Gemini CLI',
		}),
		agent({
			agentId: 'agent-grok',
			sessionId: 'session-grok',
			observedClientType: 'grok',
			displayName: 'Grok Build',
		}),
		agent({
			agentId: 'agent-zcode',
			sessionId: 'session-zcode',
			observedClientType: 'zcode',
			displayName: 'ZCode',
		}),
	]);

	assert.equal(projection.visibleAgents.length, 4);
	assert.deepEqual(
		projection.visibleAgents.map(({ config: visibleConfig }) => visibleConfig.clientId),
		['codex', 'gemini', 'grok', 'zcode']
	);
	assert.equal(
		projection.visibleAgents.find(({ config: visibleConfig }) => visibleConfig.clientId === 'codex').agent.sessionCount,
		2
	);
	assert.deepEqual(
		projection.candidateConfigs.map((candidate) => candidate.clientId),
		['claude-code', 'claude-desktop', 'cursor', 'custom']
	);
	assert.equal(
		projection.candidateConfigs.some((candidate) => candidate.clientId === 'codex'),
		false
	);
	assert.equal(
		projection.visibleAgents.some(({ config: visibleConfig }) => visibleConfig.clientId === 'custom'),
		false
	);

	const manualConfigProof = buildAgentConfigurationViewModel(
		[config('custom')],
		[agent({ observedClientType: 'custom', displayName: 'Custom client' })]
	);
	assert.equal(manualConfigProof.visibleAgents.length, 1);
	assert.equal(manualConfigProof.candidateConfigs.length, 0);

	const staleManagedConfig = buildAgentConfigurationViewModel(
		[config('codex', { configState: 'needs_update' })],
		[agent()]
	);
	assert.equal(staleManagedConfig.visibleAgents.length, 1);
	assert.equal(staleManagedConfig.candidateConfigs.length, 0);

	for (const clientId of ['gemini', 'grok', 'zcode']) {
		const unconfiguredManaged = buildAgentConfigurationViewModel(
			[config(clientId, { configState: 'not_configured' })],
			[agent({ observedClientType: clientId, displayName: clientId })]
		);
		assert.equal(unconfiguredManaged.visibleAgents.length, 1);
		assert.equal(unconfiguredManaged.candidateConfigs.length, 0);
	}

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 18 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
