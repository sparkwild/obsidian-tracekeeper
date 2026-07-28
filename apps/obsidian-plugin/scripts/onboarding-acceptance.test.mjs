#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-onboarding-acceptance-'));

try {
	const stateBundle = path.join(tempRoot, 'onboarding-state.bundle.mjs');
	const viewModelBundle = path.join(tempRoot, 'onboarding-view-model.bundle.mjs');
	const pluginBundle = path.join(tempRoot, 'main.bundle.mjs');
	const embeddedBundleOutput = path.join(tempRoot, 'skill-bundle.mjs');
	await build({ entryPoints: [path.resolve('src/features/onboarding/onboarding-state.ts')], outfile: stateBundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
	await build({ entryPoints: [path.resolve('src/features/onboarding/onboarding-view-model.ts')], outfile: viewModelBundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
	await build({
		entryPoints: [path.resolve('src/main.ts')],
		outfile: pluginBundle,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: ['es2018'],
		external: ['obsidian'],
		logLevel: 'silent',
		loader: { '.md': 'text', '.json': 'text' },
	});
	await build({
		entryPoints: [path.resolve('src/features/skill-installation/skill-bundle.ts')],
		outfile: embeddedBundleOutput,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
		loader: { '.md': 'text', '.json': 'text' },
	});

	const onboardingState = await import(`${pathToFileURL(stateBundle).href}?test=${Date.now()}`);
	const onboardingViewModel = await import(`${pathToFileURL(viewModelBundle).href}?test=${Date.now()}`);
	const embeddedBundle = await import(`${pathToFileURL(embeddedBundleOutput).href}?test=${Date.now()}`);
	const settingsSource = fs.readFileSync('src/features/settings/tracekeeper-setting-tab.ts', 'utf8');
	const mainSource = fs.readFileSync('src/main.ts', 'utf8');
	const entryModalSource = fs.readFileSync('src/features/onboarding/onboarding-entry-modal.ts', 'utf8');
	const runtimeStatusSource = fs.readFileSync('src/features/runtime/runtime-status-view.ts', 'utf8');
	const buildSource = fs.readFileSync('scripts/build.mjs', 'utf8');
	const skillBundleSource = fs.readFileSync('src/features/skill-installation/skill-bundle.ts', 'utf8');
	const pluginBundleSource = fs.readFileSync(pluginBundle, 'utf8');

	assert.equal(onboardingState.ONBOARDING_STEP_SEQUENCE[3], 'skill_setup');
	assert.equal(onboardingState.ONBOARDING_STEP_SEQUENCE[4], 'memory_policy');
	assert.equal(onboardingState.ONBOARDING_STEP_SEQUENCE[5], 'agent_restart');
	assert.equal(onboardingState.ONBOARDING_STEP_SEQUENCE[8], 'tracked_workflow');
	const migrated = onboardingState.normalizeOnboardingSettingsState({
		selectedClientId: 'codex',
		skillSetupCompletedAt: '2026-07-22T00:00:00.000Z',
	});
	assert.equal(migrated.skillUserConfirmedAt, '2026-07-22T00:00:00.000Z');
	assert.equal(migrated.skillFileVerifiedAt, '');

	const evidenceState = {
		...migrated,
		skillUserConfirmedAt: '',
		skillSetupCompletedAt: '',
		agentRestartCompletedAt: '2026-07-22T00:00:01.000Z',
		connectionVerifiedAt: '2026-07-22T00:00:02.000Z',
		firstRecallCompletedAt: '2026-07-22T00:00:03.000Z',
		firstRecallMatchedCount: 2,
	};
	const context = onboardingViewModel.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured', runtimeCapabilities: ['vault.read', 'workflow.manage'] },
		skillInstallState: { state: 'installed', fileVerified: true, updateAvailable: false },
		onboarding: evidenceState,
	});
	assert.equal(context.skillFileVerified, true);
	assert.equal(context.skillUserConfirmed, false);
	assert.equal(context.recallObserved, true);
	assert.equal(context.trackedWorkflowObserved, false);
	assert.equal(context.workflowManageAvailable, true);
	assert.equal(context.memoryPolicyConfirmed, false);
	assert.equal(onboardingState.getNextOnboardingStep(evidenceState, context), 'memory_policy');
	const confirmedPolicyState = {
		...evidenceState,
		memoryPolicyConfirmedAt: '2026-07-22T00:00:04.000Z',
	};
	const confirmedPolicyContext = onboardingViewModel.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured', runtimeCapabilities: ['vault.read', 'workflow.manage'] },
		skillInstallState: { state: 'installed', fileVerified: true, updateAvailable: false },
		onboarding: confirmedPolicyState,
	});
	assert.equal(onboardingState.getNextOnboardingStep(confirmedPolicyState, confirmedPolicyContext), 'tracked_workflow');
	const trackedWorkflowState = {
		...confirmedPolicyState,
		trackedWorkflowObservedAt: '2026-07-22T00:00:05.000Z',
		trackedWorkflowTaskId: 'task-onboarding',
	};
	const trackedWorkflowContext = onboardingViewModel.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'codex', configState: 'configured', runtimeCapabilities: ['vault.read', 'workflow.manage'] },
		skillInstallState: { state: 'installed', fileVerified: true, updateAvailable: false },
		onboarding: trackedWorkflowState,
	});
	assert.equal(onboardingState.getNextOnboardingStep(trackedWorkflowState, trackedWorkflowContext), 'complete');
	const recallOnlyContext = onboardingViewModel.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		selectedClient: { clientId: 'maintenance', configState: 'configured', runtimeCapabilities: ['vault.read'] },
		skillInstallState: { state: 'installed', fileVerified: true, updateAvailable: false },
		onboarding: { ...confirmedPolicyState, selectedClientId: 'maintenance' },
	});
	assert.equal(recallOnlyContext.workflowManageAvailable, false);
	assert.equal(onboardingState.getOnboardingStepSequence(recallOnlyContext).includes('tracked_workflow'), false);
	assert.equal(onboardingState.getNextOnboardingStep({ ...confirmedPolicyState, selectedClientId: 'maintenance' }, recallOnlyContext), 'complete');

	assert.ok(buildSource.includes('checkTracekeeperSkillBundle'));
	assert.ok(buildSource.includes("'.json': 'text'"));
	assert.ok(skillBundleSource.includes('references/workflow-state-machine.md'));
	assert.ok(skillBundleSource.includes('references/ingestion-workflow.md'));
	assert.ok(skillBundleSource.includes('references/failure-recovery.md'));
	assert.ok(skillBundleSource.includes('references/closeout-fields.md'));
	assert.ok(skillBundleSource.includes('references/instruction-isolation.md'));
	assert.ok(skillBundleSource.includes('dist/tracekeeper.flattened.md'));
	assert.ok(skillBundleSource.includes('manifest.json'));
	assert.equal(/skills\/tracekeeper\/SKILL\.md['"]/.test(settingsSource), false);
	assert.ok(settingsSource.includes('SkillInstallPreviewModal'));
	assert.ok(settingsSource.includes('not file verification'));
	assert.ok(settingsSource.includes('Does not prove automatic Skill triggering'));
	assert.ok(settingsSource.includes('Local single-user managed profile (not team RBAC)'));
	assert.ok(settingsSource.includes('Confirm memory policy'));
	assert.ok(settingsSource.includes('New installations start in review'));
	assert.ok(mainSource.includes("projectMemoryRule: 'review_queue'"));
	assert.ok(mainSource.includes('normalizeMemoryRuleSettings(saved, DEFAULT_SETTINGS)'));
	assert.equal(mainSource.includes('savedMemoryRulesVersion'), false);
	assert.ok(settingsSource.includes('skillActionForState'));
	assert.ok(settingsSource.includes('legacy_install'));
	assert.ok(settingsSource.includes('newer_than_bundled'));
	assert.equal(settingsSource.includes("clientId === 'codex'"), false);
	assert.ok(settingsSource.includes('buildOnboardingRecallInstruction'));
	assert.ok(settingsSource.includes('Recall-only capability limit'));
	assert.ok(mainSource.includes('runtimeCapabilities: selectedClient.runtimeCapabilities'));
	assert.ok(mainSource.includes('clearOnboardingAgentBehaviorEvidence'));
	assert.ok(settingsSource.includes('Local preview does not complete agent connection or first-recall verification.'));
	assert.ok(entryModalSource.includes('Start connecting Agent'));
	assert.ok(entryModalSource.includes('Set up later'));
	assert.ok(entryModalSource.includes('onStartConnectingAgent'));
	assert.ok(entryModalSource.includes('onSetupLater'));
	assert.equal(entryModalSource.includes('setMcpRuntimeEnabled'), false);
	assert.equal(entryModalSource.includes('applyClientConfig'), false);
	assert.equal(runtimeStatusSource.includes('getMcpConnectionUrl'), false);
	assert.ok(runtimeStatusSource.includes('status.endpoint'));

	assert.ok(pluginBundleSource.includes('tracekeeper-skill-bundle-v'));
	assert.ok(pluginBundleSource.includes('"format_version": 1'));
	assert.ok(pluginBundleSource.includes('Workflow State Machine'));
	assert.ok(pluginBundleSource.includes('Multi-source Ingestion Workflow'));
	assert.ok(pluginBundleSource.includes('Failure Recovery'));
	assert.ok(pluginBundleSource.includes('Instruction Isolation'));
	assert.ok(pluginBundleSource.includes('Generated by scripts/build_tracekeeper_skill.mjs'));
	assert.ok(pluginBundleSource.includes('skill_version'));
	assert.ok(pluginBundleSource.includes('2.1.0'));
	assert.ok(pluginBundleSource.includes('memoryPolicyConfirmedAt'));
	assert.ok(pluginBundleSource.includes('if_context_insufficient'));
	assert.ok(pluginBundleSource.includes('at_task_closeout'));
	for (const content of Object.values(embeddedBundle.TRACEKEEPER_SKILL_BUNDLE.installFiles)) {
		assert.equal(/(?:sk-[A-Za-z0-9_-]{12,}|api_key\s*[:=]\s*[A-Za-z0-9._-]{12,})/i.test(content), false);
	}

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 39 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
