#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-observed-client-model-test-'));
const output = path.join(tempRoot, 'activity-observed-client.mjs');

const auditEvent = (overrides = {}) => ({
	path: '00_tracekeeper/control/audit_log.md',
	auditId: '',
	actor: 'client',
	action: 'connection',
	target: '',
	reason: '',
	taskId: '',
	timestamp: '2026-07-28T02:00:00.000Z',
	sortTimestamp: Date.parse('2026-07-28T02:00:00.000Z'),
	snippet: '',
	eventType: 'connection',
	principalId: 'local-user',
	integrationId: 'integration-codex',
	credentialId: 'credential-codex',
	authMode: 'oauth',
	agentId: 'session-one',
	sessionId: 'session-one',
	clientName: 'spoofed Codex name',
	auditSchemaVersion: '2',
	observedClientNameRaw: 'spoofed Codex name',
	observedClientType: 'codex',
	observedClientVersion: '9.9.9',
	connectedAt: '2026-07-28T02:00:00.000Z',
	lastUsedAt: '',
	lastSuccessfulTool: '',
	toolName: '',
	resultStatus: 'success',
	targetPaths: [],
	durationMs: '',
	riskLevel: '',
	argsSummary: '',
	resultSummary: '',
	transport: 'streamable-http',
	runtimeVersion: '0.2.4',
	workflowContractVersion: '',
	resultSchemaVersion: '',
	workflowMode: '',
	workflowId: '',
	recallId: '',
	actionId: '',
	actionReasonCode: '',
	snapshotGeneration: '',
	scopeMode: '',
	scopeConfidence: '',
	matchedCount: '',
	memoryCloseoutStatus: '',
	diagnosticReason: '',
	...overrides,
});

const toolCall = (overrides = {}) => ({
	principalId: 'local-user',
	integrationId: 'integration-codex',
	credentialId: 'credential-codex',
	authMode: 'oauth',
	taskId: '',
	agentId: 'session-one',
	sessionId: 'session-one',
	clientName: 'spoofed Codex name',
	observedClientNameRaw: 'spoofed Codex name',
	observedClientType: 'codex',
	observedClientVersion: '9.9.9',
	toolName: 'tracekeeper.status',
	resultStatus: 'success',
	targetPaths: [],
	timestamp: '2026-07-28T03:00:00.000Z',
	lastUsedAt: '2026-07-28T03:00:00.000Z',
	lastSuccessfulTool: 'tracekeeper.status',
	transport: 'streamable-http',
	durationMs: '2',
	riskLevel: 'read-only',
	argsSummary: '',
	resultSummary: '',
	sortTimestamp: Date.parse('2026-07-28T03:00:00.000Z'),
	...overrides,
});

try {
	await build({
		entryPoints: [path.resolve('src/features/activity/activity-observed-client.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const {
		buildRecentObservedClientConnections,
		normalizeObservedClientType,
		observedClientTypeLabel,
	} = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

	assert.equal(normalizeObservedClientType('Codex CLI', ''), 'codex');
	assert.equal(normalizeObservedClientType('Claude Code', ''), 'claude-code');
	assert.equal(normalizeObservedClientType('gemini-cli-mcp-client', ''), 'gemini');
	assert.equal(normalizeObservedClientType('grok-shell-tracekeeper', ''), 'grok');
	assert.equal(normalizeObservedClientType('zcode', ''), 'zcode');
	assert.equal(normalizeObservedClientType('unrelated', 'gemini'), 'gemini');
	assert.equal(normalizeObservedClientType('unrelated', 'grok'), 'grok');
	assert.equal(normalizeObservedClientType('unrelated', 'zcode'), 'zcode');
	assert.equal(observedClientTypeLabel('gemini'), 'Gemini CLI');
	assert.equal(observedClientTypeLabel('grok'), 'Grok Build');
	assert.equal(observedClientTypeLabel('zcode'), 'ZCode');
	assert.equal(normalizeObservedClientType('', ''), 'unknown');
	assert.equal(normalizeObservedClientType('Acme MCP Client', ''), 'custom');

	const secondSession = auditEvent({
		agentId: 'session-two',
		sessionId: 'session-two',
		clientName: 'Codex',
		observedClientNameRaw: 'Codex',
		observedClientVersion: '1.0.0',
		timestamp: '2026-07-28T01:00:00.000Z',
		connectedAt: '2026-07-28T01:00:00.000Z',
		sortTimestamp: Date.parse('2026-07-28T01:00:00.000Z'),
	});
	const legacyClaudeDesktop = auditEvent({
		agentId: 'session-legacy',
		sessionId: 'session-legacy',
		clientName: 'Claude Desktop',
		auditSchemaVersion: '',
		observedClientNameRaw: '',
		observedClientType: '',
		observedClientVersion: '',
		timestamp: '2026-07-28T00:00:00.000Z',
		connectedAt: '',
		sortTimestamp: Date.parse('2026-07-28T00:00:00.000Z'),
	});
	const failedAfterSuccess = toolCall({
		toolName: 'tracekeeper.read_note',
		resultStatus: 'failed',
		timestamp: '2026-07-28T04:00:00.000Z',
		lastUsedAt: '',
		lastSuccessfulTool: '',
		sortTimestamp: Date.parse('2026-07-28T04:00:00.000Z'),
	});
	const failedOnly = toolCall({
		agentId: 'session-failed-only',
		sessionId: 'session-failed-only',
		clientName: 'Acme MCP Client',
		observedClientNameRaw: 'Acme MCP Client',
		observedClientType: 'custom',
		toolName: 'tracekeeper.read_note',
		resultStatus: 'failed',
		timestamp: '2026-07-28T05:00:00.000Z',
		lastUsedAt: '',
		lastSuccessfulTool: '',
		sortTimestamp: Date.parse('2026-07-28T05:00:00.000Z'),
	});
	const pluginUiRecall = toolCall({
		principalId: 'obsidian-plugin-ui',
		agentId: 'tracekeeper-plugin-ui',
		sessionId: 'plugin-ui-session',
		clientName: 'tracekeeper-plugin-ui',
		observedClientNameRaw: 'tracekeeper-plugin-ui',
		observedClientType: 'custom',
		toolName: 'tracekeeper.recall',
		transport: 'obsidian-direct',
		timestamp: '2026-07-28T06:00:00.000Z',
		lastUsedAt: '2026-07-28T06:00:00.000Z',
		lastSuccessfulTool: 'tracekeeper.recall',
		sortTimestamp: Date.parse('2026-07-28T06:00:00.000Z'),
	});
	const connections = buildRecentObservedClientConnections(
		[auditEvent(), secondSession, legacyClaudeDesktop],
		[toolCall(), failedAfterSuccess, failedOnly, pluginUiRecall]
	);

	assert.equal(connections.length, 3);
	assert.equal(connections[0].sessionId, 'session-one');
	assert.equal(connections[0].integrationId, 'integration-codex');
	assert.equal(connections[0].credentialId, 'credential-codex');
	assert.equal(connections[0].authMode, 'oauth');
	assert.equal(connections[0].observedClientType, 'codex');
	assert.equal(connections[0].connectedAt, '2026-07-28T02:00:00.000Z');
	assert.equal(connections[0].lastUsedAt, '2026-07-28T03:00:00.000Z');
	assert.equal(connections[0].lastSuccessfulTool, 'tracekeeper.status');
	assert.equal(connections[0].sortTimestamp, Date.parse('2026-07-28T03:00:00.000Z'));
	assert.equal(connections.some((connection) => connection.sessionId === 'session-failed-only'), false);
		assert.equal(connections.some((connection) => connection.sessionId === 'plugin-ui-session'), false);
		assert.equal(connections[2].observedClientType, 'claude-desktop');
		assert.equal(connections[2].connectedAt, '2026-07-28T00:00:00.000Z');

		const [sessionlessConnection] = buildRecentObservedClientConnections([
			auditEvent({
				agentId: 'legacy-agent-id',
				sessionId: '',
				clientName: 'Cursor',
				observedClientNameRaw: 'Cursor',
				observedClientType: 'cursor',
			}),
		], []);
		assert.equal(sessionlessConnection.agentId, 'legacy-agent-id');
		assert.equal(sessionlessConnection.sessionId, '');

		process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 27 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
