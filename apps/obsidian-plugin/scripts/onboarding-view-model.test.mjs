#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-onboarding-view-model-test-'));
const output = path.join(tempRoot, 'onboarding-view-model.bundle.mjs');

try {
	await build({ entryPoints: [path.resolve('src/features/onboarding/onboarding-view-model.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
	const vm = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const base = {
		selectedClientId: 'codex', clientConfiguredAt: '', skillSetupCompletedAt: '', skillCopiedAt: '', skillUserConfirmedAt: '', skillFileVerifiedAt: '', skillVerifiedBundleHash: '', skillUpdateAvailableAt: '', agentRestartCompletedAt: '', connectionVerifiedAt: '', firstRecallCompletedAt: '', firstRecallMatchedCount: 0, firstRecallQuery: '', trackedWorkflowObservedAt: '', trackedWorkflowTaskId: '', lastUpdatedAt: '',
	};
	const verified = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured' },
		skillInstallState: { state: 'installed', fileVerified: true, updateAvailable: false },
		onboarding: { ...base, agentRestartCompletedAt: '2026-07-23T00:00:00.000Z' },
	});
	assert.equal(verified.skillAvailable, true);
	assert.equal(verified.skillFileVerified, true);
	assert.equal(verified.skillSetupConfirmed, true);
	assert.equal(verified.skillUserConfirmed, false);

	const selfAttested = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'cursor', configState: 'unavailable' },
		skillInstallState: { state: 'unavailable', fileVerified: false, updateAvailable: false },
		onboarding: { ...base, selectedClientId: 'cursor', clientConfiguredAt: '2026-07-23T00:00:00.000Z', skillUserConfirmedAt: '2026-07-23T00:00:00.000Z' },
	});
	assert.equal(selfAttested.skillSetupConfirmed, true);
	assert.equal(selfAttested.skillFileVerified, false);
	assert.equal(selfAttested.skillUserConfirmed, true);

	const update = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured' },
		skillInstallState: { state: 'update_available', fileVerified: false, updateAvailable: true },
		onboarding: base,
	});
	assert.equal(update.skillUpdateAvailable, true);
	assert.equal(update.skillFileVerified, false);

	const cleared = vm.clearOnboardingClientEvidence({ ...base, skillCopiedAt: '2026-07-23T00:00:00.000Z', skillUserConfirmedAt: '2026-07-23T00:00:00.000Z', trackedWorkflowObservedAt: '2026-07-23T00:00:00.000Z' });
	assert.equal(cleared.skillCopiedAt, '');
	assert.equal(cleared.skillUserConfirmedAt, '');
	assert.equal(cleared.trackedWorkflowObservedAt, '');
	const behaviorCleared = vm.clearOnboardingAgentBehaviorEvidence({
		...base,
		clientConfiguredAt: '2026-07-23T00:00:00.000Z',
		agentRestartCompletedAt: '2026-07-23T00:01:00.000Z',
		connectionVerifiedAt: '2026-07-23T00:02:00.000Z',
		firstRecallCompletedAt: '2026-07-23T00:03:00.000Z',
		trackedWorkflowObservedAt: '2026-07-23T00:04:00.000Z',
	}, '2026-07-23T01:00:00.000Z');
	assert.equal(behaviorCleared.clientConfiguredAt, '2026-07-23T00:00:00.000Z');
	assert.equal(behaviorCleared.agentRestartCompletedAt, '');
	assert.equal(behaviorCleared.connectionVerifiedAt, '');
	assert.equal(behaviorCleared.firstRecallCompletedAt, '');
	assert.equal(behaviorCleared.trackedWorkflowObservedAt, '');
	assert.equal(vm.parseOnboardingRecallQuery('{"query":"tracekeeper"}'), 'tracekeeper');
	assert.equal(vm.findOnboardingRuntimePrincipal([{ clientId: 'codex', id: 'principal-codex' }], 'codex'), 'principal-codex');

	const resolved = vm.resolveOnboardingSelectedClient({ ...base, selectedClientId: 'missing' }, [{ clientId: 'codex', configState: 'configured' }], '2026-07-23T00:00:00.000Z');
	assert.equal(resolved.selectedClientId, 'codex');
	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 19 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
