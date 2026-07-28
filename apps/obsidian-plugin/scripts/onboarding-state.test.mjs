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

	const tracked = stateModule.findOnboardingTrackedWorkflowEvidence([
		{ principalId: 'client-codex', taskId: 'task-7', toolName: 'tracekeeper.start_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 10 },
		{ principalId: 'client-codex', toolName: 'tracekeeper.recall', resultStatus: 'success', resultSummary: 'matched_count=2', argsSummary: '{}', sortTimestamp: 20 },
		{ principalId: 'client-codex', taskId: 'task-7', toolName: 'tracekeeper.finish_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 30 },
	], 'client-codex', 0);
	assert.equal(tracked?.taskId, 'task-7');
	assert.equal(stateModule.findOnboardingTrackedWorkflowEvidence([
		{ principalId: 'client-codex', taskId: 'task-7', toolName: 'tracekeeper.start_task', resultStatus: 'success', resultSummary: 'opaque', argsSummary: '{}', sortTimestamp: 10 },
		{ principalId: 'client-codex', toolName: 'tracekeeper.recall', resultStatus: 'success', resultSummary: 'matched_count=2', argsSummary: '{}', sortTimestamp: 20 },
		{ principalId: 'client-codex', taskId: 'other', toolName: 'tracekeeper.finish_task', resultStatus: 'success', resultSummary: 'task_id=task-7', argsSummary: '{"task_id":"task-7"}', sortTimestamp: 30 },
	], 'client-codex', 0), null);
	assert.equal(stateModule.findOnboardingTrackedWorkflowEvidence([
		{ principalId: 'client-codex', toolName: 'tracekeeper.start_task', resultStatus: 'success', resultSummary: 'task_id=task-legacy', argsSummary: '{}', sortTimestamp: 10 },
		{ principalId: 'client-codex', toolName: 'tracekeeper.recall', resultStatus: 'success', resultSummary: 'matched_count=1', argsSummary: '{}', sortTimestamp: 20 },
		{ principalId: 'client-codex', toolName: 'tracekeeper.finish_task', resultStatus: 'success', resultSummary: 'ok=true', argsSummary: '{"task_id":"task-legacy"}', sortTimestamp: 30 },
	], 'client-codex', 0)?.taskId, 'task-legacy');

	const recall = stateModule.findOnboardingRecallEvidence([
		{ principalId: 'client-codex', toolName: 'tracekeeper.recall', resultStatus: 'success', resultSummary: 'matched_count=3', argsSummary: '{}', sortTimestamp: 20 },
	], 'client-codex', 10);
	assert.equal(recall?.matchedCount, 3);
	assert.equal(stateModule.hasOnboardingConnectionEvidence([
		{ principalId: 'client-codex', transport: 'streamable-http', sortTimestamp: 20 },
	], 'client-codex', 10), true);

	const observed = stateModule.markTrackedWorkflowObserved(state, 'task-7');
	assert.equal(observed.trackedWorkflowTaskId, 'task-7');
	const reset = stateModule.resetOnboardingState();
	assert.equal(reset.skillUserConfirmedAt, '');
	assert.equal(reset.trackedWorkflowObservedAt, '');
	assert.equal(reset.entryPromptVersion, 0);
	assert.equal(reset.entryDeferredAt, '');
	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 30 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
