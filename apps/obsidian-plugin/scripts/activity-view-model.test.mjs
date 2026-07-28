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
	port: 58437,
	lastError: '',
	...overrides,
});

const actionInput = (overrides = {}) => ({
	structureState: 'initialized',
	runtimeStatus: runtimeStatus(),
	onboardingComplete: true,
	actionableReviewQueueItemCount: 0,
	agedWorkflowCount: 0,
	permissionDeniedCount: 0,
	...overrides,
});

const agent = (overrides = {}) => ({
	principalId: 'principal-codex',
	agentId: 'codex',
	sessionId: 'session-codex',
	clientName: 'codex',
	displayName: 'Codex',
	transport: 'streamable-http',
	status: 'active',
	lastSeen: '2026-07-28T03:00:00.000Z',
	lastToolCall: 'recall',
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
		selectActivityPrimaryAction,
	} = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

	assert.equal(
		selectActivityPrimaryAction(actionInput({
			structureState: 'partial',
			runtimeStatus: runtimeStatus({ enabled: false, state: 'stopped' }),
			onboardingComplete: false,
			actionableReviewQueueItemCount: 3,
		})),
		'repair_structure'
	);
	assert.equal(
		selectActivityPrimaryAction(actionInput({
			runtimeStatus: runtimeStatus({ enabled: true, state: 'failed', lastError: 'boom' }),
			onboardingComplete: false,
			actionableReviewQueueItemCount: 3,
		})),
		'recover_runtime'
	);
	assert.equal(
		selectActivityPrimaryAction(actionInput({
			onboardingComplete: false,
			actionableReviewQueueItemCount: 3,
		})),
		'continue_onboarding'
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
			onboardingComplete: false,
		})),
		'none'
	);
	assert.equal(selectActivityPrimaryAction(actionInput()), 'none');

	assert.deepEqual(buildActivityAgentSummary([]), {
		state: 'not_observed',
		latestAgent: null,
	});
	const latest = agent();
	const older = agent({
		clientName: 'claude-code',
		displayName: 'Claude Code',
		sortTimestamp: Date.parse('2026-07-27T03:00:00.000Z'),
	});
	assert.deepEqual(buildActivityAgentSummary([latest, older]), {
		state: 'observed',
		latestAgent: latest,
	});

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 9 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
