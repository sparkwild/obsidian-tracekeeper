#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-onboarding-test-'));
const output = path.join(tempRoot, 'onboarding-state.mjs');

try {
	await build({ entryPoints: [path.resolve('src/features/onboarding/onboarding-state.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
	const stateModule = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const legacyTime = '2026-07-22T00:00:00.000Z';
	const legacy = stateModule.normalizeOnboardingSettingsState({ selectedClientId: 'codex', skillSetupCompletedAt: legacyTime });
	assert.equal(legacy.skillUserConfirmedAt, legacyTime);
	assert.equal(legacy.skillFileVerifiedAt, '');
	assert.equal(legacy.memoryPolicyConfirmedAt, '');
	assert.equal(legacy.entryPromptVersion, 0);
	assert.equal(legacy.entryDeferredAt, '');
	assert.equal(stateModule.shouldShowOnboardingEntryPrompt(legacy), true);

	const deferred = stateModule.markOnboardingEntryPromptDeferred(legacy);
	assert.equal(deferred.entryPromptVersion, stateModule.CURRENT_ONBOARDING_ENTRY_PROMPT_VERSION);
	assert.ok(deferred.entryDeferredAt);
	assert.equal(stateModule.shouldShowOnboardingEntryPrompt(deferred), false);
	const reopened = stateModule.markOnboardingEntryPromptOpened(deferred);
	assert.equal(reopened.entryPromptVersion, stateModule.CURRENT_ONBOARDING_ENTRY_PROMPT_VERSION);
	assert.equal(reopened.entryDeferredAt, '');
	assert.equal(stateModule.shouldShowOnboardingEntryPrompt(reopened), false);

	const migrated = stateModule.normalizeOnboardingSettingsState({
		selectedClientId: 'codex',
		entryPromptVersion: '1',
		entryDeferredAt: legacyTime,
	});
	assert.equal(migrated.entryPromptVersion, 1);
	assert.equal(migrated.entryDeferredAt, legacyTime);
	assert.equal(stateModule.shouldShowOnboardingEntryPrompt(migrated), false);

	let state = stateModule.normalizeOnboardingSettingsState({ selectedClientId: 'codex' });
	state = stateModule.markSkillCopied(state);
	assert.ok(state.skillCopiedAt);
	state = stateModule.markSkillUserConfirmed(state);
	assert.ok(state.skillUserConfirmedAt);
	assert.equal(state.skillFileVerifiedAt, '');
	state = stateModule.markSkillFileVerified(state, 'sha256:bundle');
	assert.equal(state.skillVerifiedBundleHash, 'sha256:bundle');
	assert.ok(state.skillFileVerifiedAt);
	state = stateModule.markSkillUpdateAvailable(state, true);
	assert.ok(state.skillUpdateAvailableAt);
	assert.equal(state.skillFileVerifiedAt, '');

	const connection = stateModule.findOnboardingConnectionEvidence([
		{
			principalId: 'local-user',
			sessionId: 'session-codex',
			transport: 'streamable-http',
			connectedAt: '2026-07-28T00:00:20.000Z',
			resultStatus: 'success',
			sortTimestamp: 30,
		},
	], Date.parse('2026-07-28T00:00:10.000Z'));
	assert.equal(connection?.sessionId, 'session-codex');
	assert.equal(connection?.connectedTimestamp, Date.parse('2026-07-28T00:00:20.000Z'));
	assert.equal(stateModule.findOnboardingConnectionEvidence([
		{
			principalId: 'local-user',
			sessionId: '',
			transport: 'streamable-http',
			connectedAt: '2026-07-28T00:00:20.000Z',
			resultStatus: 'success',
			sortTimestamp: 30,
		},
	], 0), null);
	assert.equal(stateModule.findOnboardingConnectionEvidence([
		{
			principalId: 'local-user',
			sessionId: 'plugin-ui-session',
			transport: 'obsidian-direct',
			connectedAt: '2026-07-28T00:00:20.000Z',
			resultStatus: 'success',
			sortTimestamp: 30,
		},
	], 0), null);
	assert.equal(stateModule.findOnboardingConnectionEvidence([
		{
			principalId: 'local-user',
			sessionId: 'session-before-config',
			transport: 'streamable-http',
			connectedAt: '2026-07-28T00:00:05.000Z',
			resultStatus: 'success',
			sortTimestamp: 100,
		},
	], Date.parse('2026-07-28T00:00:10.000Z')), null);
	assert.equal(stateModule.findOnboardingConnectionEvidence([
		{
			principalId: 'local-user',
			sessionId: 'session-failed',
			transport: 'streamable-http',
			connectedAt: '2026-07-28T00:00:20.000Z',
			resultStatus: 'failed',
			sortTimestamp: 30,
		},
	], 0), null);

	const tracked = stateModule.findOnboardingTrackedWorkflowEvidence([
		{ principalId: 'spoofed-one', sessionId: 'session-codex', transport: 'streamable-http', taskId: 'task-7', toolName: 'tracekeeper.start_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 10 },
		{ principalId: 'spoofed-two', sessionId: 'session-codex', transport: 'streamable-http', toolName: 'tracekeeper.recall', resultStatus: 'success', resultSummary: 'matched_count=2', argsSummary: '{}', sortTimestamp: 20 },
		{ principalId: 'spoofed-three', sessionId: 'session-codex', transport: 'streamable-http', taskId: 'task-7', toolName: 'tracekeeper.finish_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 30 },
	], 'session-codex', 0);
	assert.equal(tracked?.taskId, 'task-7');
	assert.equal(stateModule.findOnboardingTrackedWorkflowEvidence([
		{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', taskId: 'task-7', toolName: 'tracekeeper.start_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 10 },
		{ principalId: 'local-user', sessionId: 'session-other', transport: 'streamable-http', toolName: 'tracekeeper.recall', resultStatus: 'success', resultSummary: 'matched_count=2', argsSummary: '{}', sortTimestamp: 20 },
		{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', taskId: 'task-7', toolName: 'tracekeeper.finish_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 30 },
	], 'session-codex', 0), null);
	assert.equal(stateModule.findOnboardingTrackedWorkflowEvidence([
		{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', taskId: 'task-7', toolName: 'tracekeeper.start_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 10 },
		{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', toolName: 'tracekeeper.recall', resultStatus: 'success', resultSummary: 'matched_count=2', argsSummary: '{}', sortTimestamp: 20 },
		{ principalId: 'local-user', sessionId: 'session-other', transport: 'streamable-http', taskId: 'task-7', toolName: 'tracekeeper.finish_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 30 },
	], 'session-codex', 0), null);
		assert.equal(stateModule.findOnboardingTrackedWorkflowEvidence([
			{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', taskId: 'task-7', toolName: 'tracekeeper.start_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 20 },
			{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', toolName: 'tracekeeper.recall', resultStatus: 'success', resultSummary: 'matched_count=2', argsSummary: '{}', sortTimestamp: 10 },
			{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', taskId: 'task-7', toolName: 'tracekeeper.finish_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 30 },
		], 'session-codex', 0), null);
		assert.equal(stateModule.findOnboardingTrackedWorkflowEvidence([
			{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', toolName: 'tracekeeper.recall', resultStatus: 'success', resultSummary: 'matched_count=2', argsSummary: '{}', sortTimestamp: 10 },
			{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', taskId: 'task-7', toolName: 'tracekeeper.start_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 10 },
			{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', taskId: 'task-7', toolName: 'tracekeeper.finish_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 30 },
		], 'session-codex', 0), null);
		assert.equal(stateModule.findOnboardingTrackedWorkflowEvidence([
			{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', taskId: 'task-7', toolName: 'tracekeeper.start_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 10 },
			{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', toolName: 'tracekeeper.recall', resultStatus: 'success', resultSummary: 'matched_count=2', argsSummary: '{}', sortTimestamp: 20 },
			{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', taskId: 'other-task', toolName: 'tracekeeper.finish_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{"task_id":"other-task"}', sortTimestamp: 30 },
	], 'session-codex', 0), null);
	assert.equal(stateModule.findOnboardingTrackedWorkflowEvidence([
		{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', toolName: 'tracekeeper.start_task', resultStatus: 'success', resultSummary: 'task_id=task-legacy', argsSummary: '{}', sortTimestamp: 10 },
		{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', toolName: 'tracekeeper.recall', resultStatus: 'success', resultSummary: 'matched_count=1', argsSummary: '{}', sortTimestamp: 20 },
		{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', toolName: 'tracekeeper.finish_task', resultStatus: 'success', resultSummary: 'ok=true', argsSummary: '{"task_id":"task-legacy"}', sortTimestamp: 30 },
	], 'session-codex', 0)?.taskId, 'task-legacy');

	const recall = stateModule.findOnboardingRecallEvidence([
		{ principalId: 'spoofed-name', sessionId: 'session-codex', transport: 'streamable-http', toolName: 'tracekeeper.recall', resultStatus: 'success', scopeMode: 'project', matchedCount: '3', resultSummary: 'matched_count=3', argsSummary: '{"scope":"project"}', sortTimestamp: 20 },
	], 'session-codex', 10);
	assert.equal(recall?.matchedCount, 3);
	assert.equal(stateModule.findOnboardingRecallEvidence([
		{ principalId: 'local-user', sessionId: 'session-other', transport: 'streamable-http', toolName: 'tracekeeper.recall', resultStatus: 'success', scopeMode: 'project', matchedCount: '3', resultSummary: 'matched_count=3', argsSummary: '{"scope":"project"}', sortTimestamp: 20 },
	], 'session-codex', 10), null);
	assert.equal(stateModule.findOnboardingRecallEvidence([
		{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', toolName: 'tracekeeper.recall', resultStatus: 'success', scopeMode: 'global', matchedCount: '3', resultSummary: 'matched_count=3', argsSummary: '{"scope":"global"}', sortTimestamp: 20 },
	], 'session-codex', 10), null);
	assert.equal(stateModule.findOnboardingRecallEvidence([
		{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', toolName: 'tracekeeper.recall', resultStatus: 'success', scopeMode: 'project', matchedCount: '0', resultSummary: 'matched_count=0', argsSummary: '{"scope":"project"}', sortTimestamp: 20 },
	], 'session-codex', 10), null);
	assert.equal(stateModule.findOnboardingRecallEvidence([
		{ principalId: 'local-user', sessionId: 'session-codex', transport: 'streamable-http', toolName: 'tracekeeper.recall', resultStatus: 'failed', scopeMode: 'project', matchedCount: '3', resultSummary: 'matched_count=3', argsSummary: '{"scope":"project"}', sortTimestamp: 20 },
	], 'session-codex', 10), null);

	const connectionMarked = stateModule.markConnectionVerified(
		{
			...state,
			firstRecallCompletedAt: '2026-07-28T00:00:15.000Z',
			firstRecallMatchedCount: 2,
			firstRecallQuery: 'stale recall',
			trackedWorkflowObservedAt: '2026-07-28T00:00:16.000Z',
			trackedWorkflowTaskId: 'stale-task',
		},
		'session-codex',
		'2026-07-28T00:00:20.000Z'
	);
	assert.equal(connectionMarked.connectionVerifiedSessionId, 'session-codex');
	assert.equal(connectionMarked.connectionVerifiedAt, '2026-07-28T00:00:20.000Z');
	assert.equal(connectionMarked.firstRecallCompletedAt, '');
	assert.equal(connectionMarked.trackedWorkflowObservedAt, '');
	const observed = stateModule.markTrackedWorkflowObserved(state, 'task-7');
	assert.equal(observed.trackedWorkflowTaskId, 'task-7');
	const policyConfirmed = stateModule.markMemoryPolicyConfirmed(observed);
	assert.ok(policyConfirmed.memoryPolicyConfirmedAt);
	const reset = stateModule.resetOnboardingState();
	assert.equal(reset.skillUserConfirmedAt, '');
	assert.equal(reset.memoryPolicyConfirmedAt, '');
	assert.equal(reset.trackedWorkflowObservedAt, '');
	assert.equal(reset.connectionVerifiedSessionId, '');
	assert.equal(reset.entryPromptVersion, 0);
	assert.equal(reset.entryDeferredAt, '');
		process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 47 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
