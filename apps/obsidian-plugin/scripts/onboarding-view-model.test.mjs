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
		connectionVerifiedSessionId: '',
		firstRecallCompletedAt: '',
		firstRecallMatchedCount: 0,
		firstRecallQuery: '',
		trackedWorkflowObservedAt: '',
		trackedWorkflowTaskId: '',
		lastUpdatedAt: '',
	};
	const observed = vm.buildOnboardingObservedEvidence({
		selectedClient: { clientId: 'codex', configState: 'configured' },
		onboarding: {
			...base,
			selectedClientId: 'codex',
			connectionVerifiedAt: '2026-07-22T00:09:00.000Z',
			connectionVerifiedSessionId: 'session-codex',
			firstRecallCompletedAt: '2026-07-22T00:10:00.000Z',
			firstRecallMatchedCount: 2,
			firstRecallQuery: 'tracekeeper onboarding',
			trackedWorkflowObservedAt: '2026-07-22T00:11:00.000Z',
			trackedWorkflowTaskId: 'task-7',
		},
		skillBundleVersion: '2.1.0',
	});
	assert.equal(observed.selectedClientId, 'codex');
	assert.equal(observed.sessionId, 'session-codex');
	assert.equal(observed.firstRecallQuery, 'tracekeeper onboarding');
	assert.equal(observed.firstRecallMatchedCount, 2);
	assert.equal(observed.firstRecallMatchedAt, '2026-07-22T00:10:00.000Z');
	assert.equal(observed.skillBundleVersion, '2.1.0');
	assert.equal(observed.trackedWorkflowStatus, 'observed');
	assert.equal(observed.trackedWorkflowTaskId, 'task-7');
	const instructionZh = vm.buildOnboardingRecallInstruction({
		keyword: 'tracekeeper onboarding',
		workflowManageAvailable: true,
		localize: (zh) => zh,
	});
	assert.ok(instructionZh.instruction.includes('端到端验证'));
	assert.ok(instructionZh.instruction.includes('next_actions'));
	assert.ok(instructionZh.instruction.includes('repo_path'));
	assert.equal(instructionZh.instruction.includes('Principal'), false);
	assert.equal(/"project_hint"\s*:/.test(instructionZh.instruction), false);
	const instructionEn = vm.buildOnboardingRecallInstruction({
		keyword: 'tracekeeper onboarding',
		workflowManageAvailable: true,
		localize: (_zh, en) => en,
	});
	assert.ok(instructionEn.instruction.includes('end-to-end verification'));
	assert.ok(instructionEn.instruction.includes('\"tracekeeper onboarding\"'));
	assert.equal(instructionEn.instruction.toLowerCase().includes('principal'), false);
	const recallOnlyInstruction = vm.buildOnboardingRecallInstruction({
		keyword: 'tracekeeper onboarding',
		workflowManageAvailable: false,
		localize: (_zh, en) => en,
	});
	assert.ok(recallOnlyInstruction.instruction.includes('does not have workflow.manage'));
	assert.ok(recallOnlyInstruction.instruction.includes('repo_path'));
	assert.ok(recallOnlyInstruction.instruction.includes('do not call tracekeeper.start_task'));
	assert.equal(recallOnlyInstruction.instruction.toLowerCase().includes('principal'), false);

	const verified = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured', runtimeCapabilities: ['vault.read', 'workflow.manage'] },
		skillInstallState: { state: 'installed', fileVerified: true, updateAvailable: false },
		onboarding: { ...base, agentRestartCompletedAt: '2026-07-23T00:00:00.000Z' },
	});
	assert.equal(verified.skillAvailable, true);
	assert.equal(verified.skillFileVerified, true);
	assert.equal(verified.skillSetupConfirmed, true);
	assert.equal(verified.skillUserConfirmed, false);
	assert.equal(verified.memoryPolicyConfirmed, false);
	assert.equal(verified.workflowManageAvailable, true);
	const memoryPolicyConfirmed = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured', runtimeCapabilities: ['vault.read'] },
		skillInstallState: { state: 'installed', fileVerified: true, updateAvailable: false },
		onboarding: { ...base, memoryPolicyConfirmedAt: '2026-07-23T00:00:00.000Z' },
	});
	assert.equal(memoryPolicyConfirmed.memoryPolicyConfirmed, true);
	assert.equal(memoryPolicyConfirmed.workflowManageAvailable, false);
	const automaticActivation = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured', runtimeCapabilities: ['*'] },
		skillInstallState: { state: 'installed', fileVerified: true, updateAvailable: false, restartRequired: false },
		onboarding: base,
	});
	assert.equal(automaticActivation.clientReloaded, true);
	assert.equal(automaticActivation.agentRestartConfirmed, true);
	assert.equal(automaticActivation.workflowManageAvailable, true);

	const uncorrelatedEvidence = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured', runtimeCapabilities: ['vault.read', 'workflow.manage'] },
		skillInstallState: { state: 'installed', fileVerified: true, updateAvailable: false, restartRequired: false },
		onboarding: {
			...base,
			connectionVerifiedAt: '2026-07-23T00:01:00.000Z',
			firstRecallCompletedAt: '2026-07-23T00:02:00.000Z',
			firstRecallMatchedCount: 2,
		},
	});
	assert.equal(uncorrelatedEvidence.connectionVerified, false);
	assert.equal(uncorrelatedEvidence.firstRecallCompleted, false);
	const initializeOnly = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured', runtimeCapabilities: ['vault.read', 'workflow.manage'] },
		skillInstallState: { state: 'installed', fileVerified: true, updateAvailable: false, restartRequired: false },
		onboarding: {
			...base,
			connectionVerifiedAt: '2026-07-23T00:01:00.000Z',
			connectionVerifiedSessionId: 'session-codex',
		},
	});
	assert.equal(initializeOnly.connectionVerified, true);
	assert.equal(initializeOnly.firstRecallCompleted, false);
	assert.equal(initializeOnly.trackedWorkflowObserved, false);

	const selfAttested = vm.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'cursor', configState: 'unavailable' },
		skillInstallState: { state: 'unavailable', fileVerified: false, updateAvailable: false },
		onboarding: { ...base, selectedClientId: 'cursor', clientConfiguredAt: '2026-07-23T00:00:00.000Z', skillUserConfirmedAt: '2026-07-23T00:00:00.000Z' },
	});
	assert.equal(selfAttested.skillSetupConfirmed, true);
	assert.equal(selfAttested.clientConfigured, true);
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
	assert.equal(behaviorCleared.connectionVerifiedSessionId, '');
	assert.equal(behaviorCleared.firstRecallCompletedAt, '');
	assert.equal(behaviorCleared.trackedWorkflowObservedAt, '');
	const runtimeCleared = vm.clearOnboardingRuntimeEvidence({
		...base,
		clientConfiguredAt: '2026-07-23T00:00:00.000Z',
		firstRecallCompletedAt: '2026-07-23T00:03:00.000Z',
		trackedWorkflowObservedAt: '2026-07-23T00:04:00.000Z',
	}, '2026-07-23T01:00:00.000Z');
	assert.equal(runtimeCleared.clientConfiguredAt, '');
	assert.equal(runtimeCleared.connectionVerifiedSessionId, '');
	assert.equal(runtimeCleared.firstRecallCompletedAt, '');
	assert.equal(runtimeCleared.trackedWorkflowObservedAt, '');
	assert.equal(vm.hasWorkflowManageCapability(['vault.read']), false);
	assert.equal(vm.hasWorkflowManageCapability(['workflow.manage']), true);
	assert.equal(vm.hasWorkflowManageCapability(['*']), true);
	assert.equal(vm.parseOnboardingRecallQuery('{"query":"tracekeeper"}'), 'tracekeeper');

		const resolved = vm.resolveOnboardingSelectedClient({
			...base,
			selectedClientId: 'missing',
			clientConfiguredAt: '2026-07-22T00:00:00.000Z',
			skillUserConfirmedAt: '2026-07-22T00:00:00.000Z',
			memoryPolicyConfirmedAt: '2026-07-22T00:00:00.000Z',
			connectionVerifiedAt: '2026-07-22T00:01:00.000Z',
			connectionVerifiedSessionId: 'stale-session',
			firstRecallCompletedAt: '2026-07-22T00:02:00.000Z',
			firstRecallMatchedCount: 2,
			trackedWorkflowObservedAt: '2026-07-22T00:03:00.000Z',
			trackedWorkflowTaskId: 'stale-task',
		}, [{ clientId: 'codex', configState: 'configured' }], '2026-07-23T00:00:00.000Z');
		assert.equal(resolved.selectedClientId, 'codex');
		assert.equal(resolved.state.clientConfiguredAt, '');
		assert.equal(resolved.state.skillUserConfirmedAt, '');
		assert.equal(resolved.state.memoryPolicyConfirmedAt, '2026-07-22T00:00:00.000Z');
		assert.equal(resolved.state.connectionVerifiedSessionId, '');
		assert.equal(resolved.state.firstRecallCompletedAt, '');
		assert.equal(resolved.state.trackedWorkflowObservedAt, '');
		process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 46 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
