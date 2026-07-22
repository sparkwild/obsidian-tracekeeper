#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-onboarding-view-model-test-'));
const vmOutput = path.join(tempRoot, 'onboarding-view-model.bundle.mjs');
const stateOutput = path.join(tempRoot, 'onboarding-state.bundle.mjs');

try {
	await build({
		entryPoints: [path.resolve('src/features/onboarding/onboarding-view-model.ts')],
		outfile: vmOutput,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	await build({
		entryPoints: [path.resolve('src/features/onboarding/onboarding-state.ts')],
		outfile: stateOutput,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});

	const vm = await import(`${pathToFileURL(vmOutput).href}?test=${Date.now()}`);
	const state = await import(`${pathToFileURL(stateOutput).href}?test=${Date.now()}`);

	const localize = (zh, en) => en;
	const base = state.normalizeOnboardingSettingsState({ selectedClientId: 'legacy' });
	const resolvedMissing = vm.resolveOnboardingSelectedClient(
		base,
		[
			{ clientId: 'codex', configState: 'configured' },
			{ clientId: 'cursor', configState: 'not_configured' },
		],
		'2026-07-22T00:00:00.000Z'
	);
	assert.equal(resolvedMissing.selectedClientId, 'codex');
	assert.equal(resolvedMissing.state.lastUpdatedAt, '2026-07-22T00:00:00.000Z');

	const resolvedHit = vm.resolveOnboardingSelectedClient(
		resolvedMissing.state,
		[
			{ clientId: 'cursor', configState: 'configured' },
			{ clientId: 'codex', configState: 'needs_update' },
		],
		'2026-07-22T00:00:01.000Z'
	);
	assert.equal(resolvedHit.selectedClientId, 'codex');
	assert.equal(resolvedHit.selectedClient.configState, 'needs_update');

	const cleared = vm.clearOnboardingClientEvidence({
		...base,
		clientConfiguredAt: '2026-07-22T00:00:00.000Z',
		skillSetupCompletedAt: '2026-07-22T00:00:00.000Z',
		agentRestartCompletedAt: '2026-07-22T00:00:00.000Z',
		connectionVerifiedAt: '2026-07-22T00:00:00.000Z',
		firstRecallCompletedAt: '2026-07-22T00:00:00.000Z',
		firstRecallMatchedCount: 3,
		firstRecallQuery: 'x',
	});
	assert.equal(cleared.clientConfiguredAt, '');
	assert.equal(cleared.firstRecallMatchedCount, 0);
	assert.equal(cleared.firstRecallQuery, '');
	const runtimeCleared = vm.clearOnboardingRuntimeEvidence({
		...base,
		clientConfiguredAt: '2026-07-22T00:00:00.000Z',
		skillSetupCompletedAt: '2026-07-22T00:00:00.000Z',
		agentRestartCompletedAt: '2026-07-22T00:00:00.000Z',
		connectionVerifiedAt: '2026-07-22T00:00:00.000Z',
		firstRecallCompletedAt: '2026-07-22T00:00:00.000Z',
		firstRecallMatchedCount: 3,
		firstRecallQuery: 'x',
	}, '2026-07-22T00:00:01.000Z');
	assert.equal(runtimeCleared.clientConfiguredAt, '');
	assert.equal(runtimeCleared.skillSetupCompletedAt, '2026-07-22T00:00:00.000Z');
	assert.equal(runtimeCleared.agentRestartCompletedAt, '');
	assert.equal(runtimeCleared.connectionVerifiedAt, '');
	assert.equal(runtimeCleared.firstRecallCompletedAt, '');
	assert.equal(runtimeCleared.firstRecallMatchedCount, 0);
	assert.equal(runtimeCleared.firstRecallQuery, '');
	assert.equal(runtimeCleared.lastUpdatedAt, '2026-07-22T00:00:01.000Z');

	assert.equal(vm.onboardingEvidenceNotBefore({
		...base,
		clientConfiguredAt: '2026-07-22T00:00:02.000Z',
		agentRestartCompletedAt: '2026-07-22T00:00:10.000Z',
	}), Date.parse('2026-07-22T00:00:10.000Z'));

	assert.equal(vm.parseOnboardingRecallQuery('{\"query\":\"tracekeeper\"}'), 'tracekeeper');
	assert.equal(vm.parseOnboardingRecallQuery('{}'), '');
	assert.equal(vm.parseOnboardingRecallQuery('not-json'), '');

	assert.equal(vm.findOnboardingRuntimePrincipal([
		{ clientId: 'codex', id: 'token-codex' },
		{ clientId: 'cursor', id: 'token-cursor' },
	], 'cursor'), 'token-cursor');
	assert.equal(vm.findOnboardingRuntimePrincipal([], 'missing'), '');

	assert.equal(
		vm.onboardingStepLabel('runtime', localize),
		'Start MCP service'
	);
	assert.equal(
		vm.onboardingStepLabel('complete', localize),
		'Done'
	);

	const context = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured' },
		onboarding: state.markClientConfigured(base, 'codex'),
	});
	assert.equal(context.runtimeRunning, true);
	assert.equal(context.clientConfigured, true);
	const invalidConfigContext = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'needs_update' },
		onboarding: state.markClientConfigured(base, 'codex'),
	});
	assert.equal(invalidConfigContext.clientConfigured, false);
	const unavailableConfigContext = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'unavailable' },
		onboarding: state.markClientConfigured(base, 'codex'),
	});
	assert.equal(unavailableConfigContext.clientConfigured, true);
	const partialDescription = vm.onboardingContextDescription(context, localize);
	assert.ok(partialDescription.includes('items remaining.'));

	const completedContext = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured' },
		onboarding: state.markFirstRecallDone(
			state.markConnectionVerified(
				state.markAgentRestartDone(
					state.markSkillSetupDone(
						state.markClientConfigured(base, 'codex')
					)
				)
			),
			2,
			'tracekeeper'
		),
	});
	assert.equal(
		vm.onboardingContextDescription(completedContext, localize),
		'Onboarding is complete. You can start meaningful work.'
	);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 28 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
