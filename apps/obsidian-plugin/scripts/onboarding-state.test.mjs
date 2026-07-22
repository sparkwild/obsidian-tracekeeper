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
	await build({
		entryPoints: [path.resolve('src/features/onboarding/onboarding-state.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const stateModule = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const state = stateModule.normalizeOnboardingSettingsState({ selectedClientId: 'codex' });
	const context = {
		vaultReady: true,
		runtimeRunning: true,
		clientConfigured: true,
		skillSetupConfirmed: true,
		agentRestartConfirmed: true,
		connectionVerified: false,
		firstRecallCompleted: false,
	};

	assert.equal(stateModule.getNextOnboardingStep(state, context), 'connection_verification');
	assert.equal(stateModule.hasOnboardingRecallResult(state), false);
	const configuredOnly = stateModule.markClientConfigured(state, 'codex');
	assert.equal(stateModule.getNextOnboardingStep(configuredOnly, context), 'connection_verification');

	const connected = stateModule.markConnectionVerified(configuredOnly);
	const connectedContext = { ...context, connectionVerified: true };
	assert.equal(stateModule.getNextOnboardingStep(connected, connectedContext), 'first_recall');

	const zeroMatch = stateModule.markFirstRecallDone(connected, 0, 'missing');
	assert.equal(zeroMatch, connected);
	assert.equal(stateModule.hasOnboardingRecallResult(zeroMatch), false);

	const recalled = stateModule.markFirstRecallDone(connected, 2, 'tracekeeper');
	assert.equal(stateModule.hasOnboardingRecallResult(recalled), true);
	assert.equal(
		stateModule.getNextOnboardingStep(recalled, { ...connectedContext, firstRecallCompleted: true }),
		'complete'
	);

	const reset = stateModule.resetOnboardingState();
	assert.equal(reset.selectedClientId, 'codex');
	assert.equal(reset.connectionVerifiedAt, '');
	assert.equal(reset.firstRecallMatchedCount, 0);
	assert.equal(stateModule.hasOnboardingConnectionEvidence([
		{ principalId: 'client-codex', transport: 'obsidian-direct', sortTimestamp: 20 },
		{ principalId: 'legacy-shared-token', transport: 'streamable-http', sortTimestamp: 20 },
	], 'client-codex', 10), false);
	assert.equal(stateModule.hasOnboardingConnectionEvidence([
		{ principalId: 'client-codex', transport: 'streamable-http', sortTimestamp: 20 },
	], 'client-codex', 10), true);
	assert.equal(stateModule.findOnboardingRecallEvidence([
		{ principalId: 'client-codex', toolName: 'tracekeeper.recall', resultStatus: 'success', resultSummary: 'matched_count=0', argsSummary: '{}', sortTimestamp: 20 },
	], 'client-codex', 10), null);
	const recallEvidence = stateModule.findOnboardingRecallEvidence([
		{ principalId: 'client-codex', toolName: 'tracekeeper.recall', resultStatus: 'success', resultSummary: 'ok=true | matched_count=3', argsSummary: '{"query":"tracekeeper"}', sortTimestamp: 20 },
	], 'client-codex', 10);
	assert.equal(recallEvidence?.matchedCount, 3);
	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 14 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
