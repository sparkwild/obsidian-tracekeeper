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
	action: 'mcp.connection',
	target: '',
	reason: '',
	taskId: '',
	timestamp: '2026-07-28T02:00:00.000Z',
	sortTimestamp: Date.parse('2026-07-28T02:00:00.000Z'),
	snippet: '',
	eventType: 'mcp.connection',
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
	const toolCallOutsideConnectionWindow = toolCall({
		principalId: 'local-user',
		integrationId: 'integration-zcode',
		credentialId: 'credential-zcode',
		authMode: 'bearer',
		agentId: 'session-zcode',
		sessionId: 'session-zcode',
		clientName: 'zcode',
		observedClientNameRaw: 'zcode',
		observedClientType: 'zcode',
		observedClientVersion: '0.16.1',
		toolName: 'tracekeeper.memory',
		timestamp: '2026-07-28T05:30:00.000Z',
		lastUsedAt: '2026-07-28T05:30:00.000Z',
		lastSuccessfulTool: 'tracekeeper.memory',
		sortTimestamp: Date.parse('2026-07-28T05:30:00.000Z'),
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
		[toolCall(), failedAfterSuccess, failedOnly, toolCallOutsideConnectionWindow, pluginUiRecall]
	);

	assert.equal(connections.length, 4);
	const codex = connections.find((connection) => connection.sessionId === 'session-one');
	assert.equal(codex?.integrationId, 'integration-codex');
	assert.equal(codex?.credentialId, 'credential-codex');
	assert.equal(codex?.authMode, 'oauth');
	assert.equal(codex?.observedClientType, 'codex');
	assert.equal(codex?.connectedAt, '2026-07-28T02:00:00.000Z');
	assert.equal(codex?.lastUsedAt, '2026-07-28T03:00:00.000Z');
	assert.equal(codex?.lastSuccessfulTool, 'tracekeeper.status');
	assert.equal(codex?.sortTimestamp, Date.parse('2026-07-28T03:00:00.000Z'));
	const zcode = connections.find((connection) => connection.sessionId === 'session-zcode');
	assert.equal(zcode?.observedClientType, 'zcode');
	assert.equal(zcode?.connectedAt, '');
	assert.equal(zcode?.resultStatus, 'success');
	assert.equal(zcode?.lastUsedAt, '2026-07-28T05:30:00.000Z');
	assert.equal(zcode?.lastSuccessfulTool, 'tracekeeper.memory');
	assert.equal(connections.some((connection) => connection.sessionId === 'session-failed-only'), false);
	assert.equal(connections.some((connection) => connection.sessionId === 'plugin-ui-session'), false);
	const claudeDesktop = connections.find((connection) => connection.sessionId === 'session-legacy');
	assert.equal(claudeDesktop?.observedClientType, 'claude-desktop');
	assert.equal(claudeDesktop?.connectedAt, '2026-07-28T00:00:00.000Z');

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

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 32 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
