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
	const activityDataSource = fs.readFileSync('src/features/activity/activity-data-controller.ts', 'utf8');
	const mainSource = fs.readFileSync('src/main.ts', 'utf8');
	const entryModalSource = fs.readFileSync('src/features/onboarding/onboarding-entry-modal.ts', 'utf8');
	const runtimeStatusSource = fs.readFileSync('src/features/runtime/runtime-status-view.ts', 'utf8');
	const capabilitiesModalSource = fs.readFileSync('src/features/runtime/mcp-capabilities-modal.ts', 'utf8');
	const buildSource = fs.readFileSync('scripts/build.mjs', 'utf8');
	const clientSkillPromptSource = fs.readFileSync('src/features/skill-installation/client-skill-prompt.ts', 'utf8');
	const skillBundleSource = fs.readFileSync('src/features/skill-installation/skill-bundle.ts', 'utf8');
	const skillPromptSource = fs.readFileSync('src/features/skill-installation/skill-install-view-model.ts', 'utf8');
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
		connectionVerifiedSessionId: 'session-codex',
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
	assert.ok(settingsSource.includes('renderClientSkillPrompt'));
	assert.ok(clientSkillPromptSource.includes('SkillInstallPreviewModal'));
	assert.ok(clientSkillPromptSource.includes('buildSkillInstallPrompt'));
	const directoryActionStart = clientSkillPromptSource.indexOf("const operationStatus = prompt.action === 'update'");
	const directoryActionEnd = clientSkillPromptSource.indexOf('if (prompt.assistantLabel)', directoryActionStart);
	assert.ok(directoryActionStart >= 0 && directoryActionEnd > directoryActionStart);
	const directoryActionSource = clientSkillPromptSource.slice(directoryActionStart, directoryActionEnd);
	assert.match(directoryActionSource, /prompt\.action === 'update'/);
	assert.match(directoryActionSource, /role: 'status'/);
	assert.match(directoryActionSource, /'aria-live': 'polite'/);
	assert.match(directoryActionSource, /actionButton\.setAttribute\('aria-busy', 'true'\)/);
	assert.match(directoryActionSource, /ui\('更新中…', 'Updating…'\)/);
	assert.match(directoryActionSource, /正在重新校验并更新原安装目录/);
	assert.match(directoryActionSource, /plugin\.updateSkillAtInstalledDirectory\(config\.clientId\)/);
	assert.match(directoryActionSource, /更新成功，正在刷新状态/);
	assert.match(directoryActionSource, /await onChanged\?\.\(\)/);
	assert.match(directoryActionSource, /updated Skill but failed to refresh its visible state/);
	assert.match(directoryActionSource, /Skill 已更新，但页面状态刷新失败/);
	assert.match(directoryActionSource, /if \(actionButton\.isConnected\)/);
	assert.match(directoryActionSource, /new SkillInstallPreviewModal\(app, plugin, config\.clientId, onChanged\)\.open\(\)/);
	assert.match(
		directoryActionSource,
		/\.finally\(\(\) => \{ actionButton\.disabled = false; \}\);/,
		'the directory-selection action must be re-enabled after modal opening or failure'
	);
	assert.ok(settingsSource.includes('renderClientSkillPrompt'));
	assert.ok(clientSkillPromptSource.includes('tracekeeper-settings-client-skill'));
	assert.equal(skillPromptSource.includes('使用指南'), false);
	assert.equal(clientSkillPromptSource.includes('使用指南'), false);
	assert.equal(mainSource.includes('使用指南'), false);
	assert.equal(clientSkillPromptSource.includes("ui('技术信息', 'Technical information')"), false);
	assert.equal(clientSkillPromptSource.includes('tracekeeper-settings-client-skill__technical'), false);
	assert.ok(settingsSource.includes('McpCapabilitiesModal'));
	assert.ok(settingsSource.includes('View capabilities'));
	assert.ok(capabilitiesModalSource.includes('LOCAL_TRUST_CAPABILITIES'));
	assert.ok(capabilitiesModalSource.includes('toolDefinitions(LOCAL_TRUST_CAPABILITIES)'));
	assert.ok(capabilitiesModalSource.includes('人工审核和确认写入仍在 Obsidian 中完成'));
	assert.ok(capabilitiesModalSource.includes('Human review and confirmed writeback remain in Obsidian'));
	assert.equal(capabilitiesModalSource.includes('Connected agents can call the capabilities below'), false);
	assert.ok(settingsSource.includes('new SettingGroup(container).setHeading(title)'));
	assert.ok(settingsSource.includes('group.addExtraButton'));
	assert.equal(settingsSource.includes('tracekeeper-settings-section__header'), false);
	assert.equal(settingsSource.includes('持久 Agent 卡片独立展示 MCP 配置、授权、连接、使用和 Skill 状态。'), false);
	assert.equal(settingsSource.includes('Persistent Agent cards show MCP setup, authorization, connection, usage, and Skill state independently.'), false);
	assert.equal(settingsSource.includes('renderOnboardingSection'), false);
	assert.equal(settingsSource.includes('tracekeeper-onboarding-steps'), false);
	assert.equal(settingsSource.includes("ui('首次接入引导', 'Onboarding')"), false);
	assert.equal(settingsSource.includes('runtimePublicTools'), false);
	assert.equal(settingsSource.includes('RUNTIME_CREDENTIAL_PRESET_DEFINITIONS'), false);
	assert.equal(settingsSource.includes('tracekeeper-capability-preset'), false);
	assert.equal(settingsSource.includes("ui('能力预设', 'Capability profile')"), false);
	assert.ok(skillPromptSource.includes("case 'not_installed'"));
	assert.ok(skillPromptSource.includes("case 'update_available'"));
	assert.ok(skillPromptSource.includes("case 'modified'"));
	assert.ok(skillPromptSource.includes("case 'newer_than_bundled'"));
	assert.ok(skillPromptSource.includes("case 'location_conflict'"));
assert.ok(skillPromptSource.includes("case 'location_required'"));
	assert.ok(clientSkillPromptSource.includes("setIcon(assistant, 'bot')"));
	assert.ok(clientSkillPromptSource.includes('tracekeeper-copy-button'));
	assert.ok(mainSource.includes("projectMemoryRule: 'auto_write'"));
	assert.ok(mainSource.includes('normalizeMemoryRuleSettings(saved, DEFAULT_SETTINGS)'));
	assert.ok(mainSource.includes('DEFAULT_SETTINGS.projectMemoryRule'));
	assert.equal(mainSource.includes('savedMemoryRulesVersion'), false);
	assert.ok(settingsSource.includes('自动创建符合条件的不可变 Project MemoryRecord v2；不要求 Wiki'));
	assert.ok(settingsSource.includes('Automatically create eligible immutable Project MemoryRecord v2 records without requiring Wiki context'));
	assert.ok(settingsSource.includes('setDesc(this.projectMemoryRuleDescription())'));
	assert.equal(settingsSource.includes("clientId === 'codex'"), false);
	assert.ok(mainSource.includes('runtimeCapabilities: LOCAL_TRUST_CAPABILITIES'));
	assert.ok(mainSource.includes('clearOnboardingAgentBehaviorEvidence'));
	assert.equal(mainSource.includes('LOCAL_TRUST_PRINCIPAL_ID'), false);
		assert.equal(mainSource.includes('hasOnboardingConnectionEvidence'), false);
		assert.ok(mainSource.includes('connectionVerifiedSessionId'));
		const completionMethodSource = mainSource.slice(
			mainSource.indexOf('async isOnboardingComplete(): Promise<boolean>'),
			mainSource.indexOf(
				'getOnboardingSelectedClient(',
				mainSource.indexOf('async isOnboardingComplete(): Promise<boolean>')
			)
		);
		assert.ok(completionMethodSource.includes('resolveOnboardingSelectedClient'));
		assert.ok(completionMethodSource.includes('await this.isVaultStructureReady()'));
		assert.equal(activityDataSource.includes('sessionId: event.sessionId || event.agentId'), false);
		assert.ok(activityDataSource.includes('sessionId: event.sessionId,'));
		assert.equal(
			fs.readFileSync('src/features/onboarding/onboarding-view-model.ts', 'utf8').toLowerCase().includes('principal'),
			false
	);
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
	assert.ok(pluginBundleSource.includes('2.2.0'));
	assert.ok(pluginBundleSource.includes('memoryPolicyConfirmedAt'));
	assert.ok(pluginBundleSource.includes('if_context_insufficient'));
	assert.ok(pluginBundleSource.includes('at_task_closeout'));
	for (const content of Object.values(embeddedBundle.TRACEKEEPER_SKILL_BUNDLE.installFiles)) {
		assert.equal(/(?:sk-[A-Za-z0-9_-]{12,}|api_key\s*[:=]\s*[A-Za-z0-9._-]{12,})/i.test(content), false);
	}

		process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 65 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
