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
		selectedClientId: 'codex',
		entryPromptVersion: 0,
		entryDeferredAt: '',
		clientConfiguredAt: '',
		skillSetupCompletedAt: '',
		skillCopiedAt: '',
		skillUserConfirmedAt: '',
		skillFileVerifiedAt: '',
		skillVerifiedBundleHash: '',
		skillUpdateAvailableAt: '',
		memoryPolicyConfirmedAt: '',
		agentRestartCompletedAt: '',
		connectionVerifiedAt: '',
		firstRecallCompletedAt: '',
		firstRecallMatchedCount: 0,
		firstRecallQuery: '',
		trackedWorkflowObservedAt: '',
		trackedWorkflowTaskId: '',
		lastUpdatedAt: '',
	};
	const observed = vm.buildOnboardingObservedEvidence({
		selectedClient: { clientId: 'codex', configState: 'configured' },
		principalId: 'principal-codex',
		onboarding: {
			...base,
			selectedClientId: 'codex',
			firstRecallCompletedAt: '2026-07-22T00:10:00.000Z',
			firstRecallMatchedCount: 2,
			firstRecallQuery: 'tracekeeper onboarding',
			trackedWorkflowObservedAt: '2026-07-22T00:11:00.000Z',
			trackedWorkflowTaskId: 'task-7',
		},
		skillBundleVersion: '2.1.0',
	});
	assert.equal(observed.selectedClientId, 'codex');
	assert.equal(observed.principalId, 'principal-codex');
	assert.equal(observed.firstRecallQuery, 'tracekeeper onboarding');
	assert.equal(observed.firstRecallMatchedCount, 2);
	assert.equal(observed.firstRecallMatchedAt, '2026-07-22T00:10:00.000Z');
	assert.equal(observed.skillBundleVersion, '2.1.0');
	assert.equal(observed.trackedWorkflowStatus, 'observed');
	assert.equal(observed.trackedWorkflowTaskId, 'task-7');
	const instructionZh = vm.buildOnboardingRecallInstruction({
		keyword: 'tracekeeper onboarding',
		localize: (zh) => zh,
	});
	assert.ok(instructionZh.instruction.includes('先识别当前仓库/工作区身份'));
	const instructionEn = vm.buildOnboardingRecallInstruction({
		keyword: 'tracekeeper onboarding',
		localize: (_zh, en) => en,
	});
	assert.ok(instructionEn.instruction.includes('project-scoped tracekeeper.recall'));
	assert.ok(instructionEn.instruction.includes('\"tracekeeper onboarding\"'));

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
	assert.equal(verified.memoryPolicyConfirmed, false);
	const memoryPolicyConfirmed = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured' },
		skillInstallState: { state: 'installed', fileVerified: true, updateAvailable: false },
		onboarding: { ...base, memoryPolicyConfirmedAt: '2026-07-23T00:00:00.000Z' },
	});
	assert.equal(memoryPolicyConfirmed.memoryPolicyConfirmed, true);
	const automaticActivation = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured' },
		skillInstallState: { state: 'installed', fileVerified: true, updateAvailable: false, restartRequired: false },
		onboarding: base,
	});
	assert.equal(automaticActivation.clientReloaded, true);
	assert.equal(automaticActivation.agentRestartConfirmed, true);

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
	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 30 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
