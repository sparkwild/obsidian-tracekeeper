#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-activity-view-model-test-'));
const output = path.join(tempRoot, 'activity-view-model.mjs');

const runtimeStatus = (overrides = {}) => ({
	enabled: true,
	state: 'running',
	port: 51601,
	lastError: '',
	...overrides,
});

const actionInput = (overrides = {}) => ({
	structureState: 'initialized',
	runtimeStatus: runtimeStatus(),
	actionableReviewQueueItemCount: 0,
	agedWorkflowCount: 0,
	permissionDeniedCount: 0,
	...overrides,
});

const agent = (overrides = {}) => ({
	principalId: 'principal-codex',
	integrationId: 'integration-codex',
	credentialId: 'credential-codex',
	authMode: 'oauth',
	agentId: 'codex',
	sessionId: 'session-codex',
	clientName: 'codex',
	observedClientNameRaw: 'Codex',
	observedClientType: 'codex',
	observedClientVersion: '1.2.3',
	displayName: 'Codex',
	transport: 'streamable-http',
	status: 'active',
	lastSeen: '2026-07-28T03:00:00.000Z',
	lastToolCall: 'recall',
	connectedAt: '2026-07-28T02:00:00.000Z',
	resultStatus: 'success',
	lastUsedAt: '2026-07-28T03:00:00.000Z',
	lastSuccessfulTool: 'tracekeeper.recall',
	runtimeVersion: '0.2.4',
	permissionProfile: 'knowledge-assistant',
	sortTimestamp: Date.parse('2026-07-28T03:00:00.000Z'),
	...overrides,
});

try {
	await build({
		entryPoints: [path.resolve('src/features/activity/activity-view-model.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const {
		buildActivityAgentSummary,
		buildSuccessfullyUsedAgentSummary,
		selectLatestTaskPlacement,
		selectActivityPrimaryAction,
	} = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

	assert.equal(
		selectActivityPrimaryAction(actionInput({
			structureState: 'partial',
			runtimeStatus: runtimeStatus({ enabled: false, state: 'stopped' }),
			actionableReviewQueueItemCount: 3,
		})),
		'repair_structure'
	);
	assert.equal(
		selectActivityPrimaryAction(actionInput({
			runtimeStatus: runtimeStatus({ enabled: true, state: 'failed', lastError: 'boom' }),
			actionableReviewQueueItemCount: 3,
		})),
		'recover_runtime'
	);
	assert.equal(
		selectActivityPrimaryAction(actionInput({
			actionableReviewQueueItemCount: 3,
		})),
		'review_changes'
	);
	assert.equal(
		selectActivityPrimaryAction(actionInput({
			actionableReviewQueueItemCount: 3,
			agedWorkflowCount: 1,
		})),
		'review_changes'
	);
	assert.equal(
		selectActivityPrimaryAction(actionInput({ permissionDeniedCount: 1 })),
		'inspect_diagnostics'
	);
	assert.equal(
		selectActivityPrimaryAction(actionInput({
			runtimeStatus: runtimeStatus({ state: 'starting' }),
		})),
		'none'
	);
	assert.equal(selectActivityPrimaryAction(actionInput()), 'none');
	assert.equal(selectLatestTaskPlacement(null), 'hidden');
	for (const status of ['completed', 'done', 'success']) {
		assert.equal(selectLatestTaskPlacement({ status }), 'memory_loop');
	}
	for (const status of ['active', 'running', 'failed', 'error', 'interrupted', 'unknown']) {
		assert.equal(selectLatestTaskPlacement({ status }), 'standalone');
	}

	assert.deepEqual(buildActivityAgentSummary([]), {
		state: 'not_observed',
		observedAgentCount: 0,
		agentGroups: [],
	});
	const latest = agent();
	const earlierCodexSession = agent({
		agentId: 'codex-session-two',
		sessionId: 'session-codex-two',
		lastToolCall: 'start_task',
		sortTimestamp: Date.parse('2026-07-27T12:00:00.000Z'),
	});
	const claude = agent({
		principalId: 'principal-codex',
		clientName: 'claude-code',
		observedClientNameRaw: 'Claude Code',
		observedClientType: 'claude-code',
		displayName: 'Claude Code',
		connectedAt: '2026-07-27T02:00:00.000Z',
		lastUsedAt: '',
		lastSuccessfulTool: '',
		sortTimestamp: Date.parse('2026-07-27T03:00:00.000Z'),
	});
	assert.deepEqual(buildActivityAgentSummary([latest, earlierCodexSession, claude]), {
		state: 'observed',
		observedAgentCount: 2,
		agentGroups: [
			{
				displayName: 'Codex',
				observedClientType: 'codex',
				sessionCount: 2,
				lastConnectedAt: Date.parse('2026-07-28T02:00:00.000Z'),
				lastUsedAt: Date.parse('2026-07-28T03:00:00.000Z'),
				sortTimestamp: Date.parse('2026-07-28T03:00:00.000Z'),
			},
			{
				displayName: 'Claude Code',
				observedClientType: 'claude-code',
				sessionCount: 1,
				lastConnectedAt: Date.parse('2026-07-27T02:00:00.000Z'),
				lastUsedAt: 0,
				sortTimestamp: Date.parse('2026-07-27T03:00:00.000Z'),
			},
		],
	});

	const toolCallOnly = agent({
		clientName: 'cursor',
		observedClientNameRaw: 'Cursor',
		observedClientType: 'cursor',
		displayName: 'Cursor',
		connectedAt: '',
	});
	const failedUse = agent({
		clientName: 'custom',
		observedClientNameRaw: 'Custom client',
		observedClientType: 'custom',
		displayName: 'Custom client',
		resultStatus: 'failed',
	});
	const pluginDirect = agent({
		agentId: 'tracekeeper-plugin-ui',
		sessionId: 'plugin-ui-session',
		clientName: 'tracekeeper-plugin-ui',
		observedClientNameRaw: 'tracekeeper-plugin-ui',
		observedClientType: 'custom',
		displayName: 'Custom client',
		transport: 'obsidian-direct',
	});
	const sessionless = agent({
		agentId: 'legacy-agent',
		sessionId: '',
	});
	assert.deepEqual(
		buildSuccessfullyUsedAgentSummary([
			latest,
			earlierCodexSession,
			claude,
			toolCallOnly,
			failedUse,
			pluginDirect,
			sessionless,
		]),
		{
			state: 'observed',
			observedAgentCount: 2,
			agentGroups: [
				{
					displayName: 'Codex',
					observedClientType: 'codex',
					sessionCount: 2,
					lastConnectedAt: Date.parse('2026-07-28T02:00:00.000Z'),
					lastUsedAt: Date.parse('2026-07-28T03:00:00.000Z'),
					sortTimestamp: Date.parse('2026-07-28T03:00:00.000Z'),
				},
				{
					displayName: 'Cursor',
					observedClientType: 'cursor',
					sessionCount: 1,
					lastConnectedAt: 0,
					lastUsedAt: Date.parse('2026-07-28T03:00:00.000Z'),
					sortTimestamp: Date.parse('2026-07-28T03:00:00.000Z'),
				},
			],
		}
	);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 19 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
