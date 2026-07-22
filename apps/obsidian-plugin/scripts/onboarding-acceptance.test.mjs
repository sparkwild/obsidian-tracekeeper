#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-onboarding-acceptance-'));

const readFile = (relativePath) => {
	const absolute = path.resolve(relativePath);
	return fs.readFileSync(absolute, 'utf8');
};

try {
	const stateBundle = path.join(tempRoot, 'onboarding-state.bundle.mjs');
	const viewModelBundle = path.join(tempRoot, 'onboarding-view-model.bundle.mjs');
	const pluginBundle = path.join(tempRoot, 'main.bundle.mjs');

	await build({
		entryPoints: [path.resolve('src/features/onboarding/onboarding-state.ts')],
		outfile: stateBundle,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	await build({
		entryPoints: [path.resolve('src/features/onboarding/onboarding-view-model.ts')],
		outfile: viewModelBundle,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	await build({
		entryPoints: [path.resolve('src/main.ts')],
		outfile: pluginBundle,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: ['es2018'],
		external: ['obsidian'],
		logLevel: 'silent',
		loader: { '.md': 'text' },
	});

	const onboardingState = await import(`${pathToFileURL(stateBundle).href}?test=${Date.now()}`);
	const onboardingViewModel = await import(`${pathToFileURL(viewModelBundle).href}?test=${Date.now()}`);
	const pluginMainSource = readFile('src/features/settings/tracekeeper-setting-tab.ts');
	const pluginBuildSource = readFile('scripts/build.mjs');
	const pluginBundleSource = readFile(pluginBundle);
	const skillSource = readFile(path.join('..', '..', 'skills', 'tracekeeper', 'SKILL.md'));

	assert.equal(onboardingState.ONBOARDING_STEP_SEQUENCE[3], 'skill_setup');
	assert.equal(onboardingState.ONBOARDING_STEP_SEQUENCE[4], 'agent_restart');
	assert.ok(onboardingState.ONBOARDING_STEP_SEQUENCE.includes('connection_verification'));
	assert.ok(onboardingState.ONBOARDING_STEP_SEQUENCE.includes('first_recall'));

	const baseState = onboardingState.DEFAULT_ONBOARDING_SETTINGS;
	const baseContext = {
		vaultReady: true,
		runtimeRunning: true,
		clientConfigured: false,
		skillSetupConfirmed: false,
		agentRestartConfirmed: false,
		connectionVerified: false,
		firstRecallCompleted: false,
	};

	assert.equal(onboardingState.getNextOnboardingStep(baseState, baseContext), 'client_configuration');
	assert.ok(onboardingState.markFirstRecallDone(baseState, 0, 'tracekeeper') === baseState);

	const configured = onboardingState.markClientConfigured(baseState, 'codex');
	const contextWithClient = { ...baseContext, clientConfigured: true };
	assert.equal(onboardingState.getNextOnboardingStep(configured, contextWithClient), 'skill_setup');

	const skillDone = onboardingState.markSkillSetupDone(configured);
	assert.equal(onboardingState.getNextOnboardingStep(skillDone, { ...contextWithClient, skillSetupConfirmed: true }), 'agent_restart');

	const restarted = onboardingState.markAgentRestartDone(skillDone);
	assert.equal(
		onboardingState.getNextOnboardingStep(
			restarted,
			{ ...contextWithClient, skillSetupConfirmed: true, agentRestartConfirmed: true }
		),
		'connection_verification'
	);

	assert.equal(
		onboardingState.hasOnboardingConnectionEvidence(
			[{ principalId: 'client-codex', transport: 'obsidian-direct', sortTimestamp: 200 }],
			'client-codex',
			0
		),
		false
	);
	assert.equal(
		onboardingState.hasOnboardingConnectionEvidence(
			[{ principalId: 'client-codex', transport: 'streamable-http', sortTimestamp: 20 }],
			'client-codex',
			30
		),
		false
	);
	assert.equal(
		onboardingState.hasOnboardingConnectionEvidence(
			[{ principalId: 'client-codex', transport: 'streamable-http', sortTimestamp: 200 }],
			'client-codex',
			30
		),
		true
	);

	assert.equal(
		onboardingState.findOnboardingRecallEvidence(
			[
				{
					principalId: 'client-codex',
					toolName: 'tracekeeper.recall',
					resultStatus: 'success',
					resultSummary: 'matched_count=0',
					argsSummary: '{"query":"tracekeeper"}',
					sortTimestamp: 200,
				},
			],
			'client-codex',
			30
		),
		null
	);

	const recallEvidence = onboardingState.findOnboardingRecallEvidence(
		[
			{
				principalId: 'client-codex',
				toolName: 'tracekeeper.recall',
				resultStatus: 'success',
				resultSummary: 'ok=true | matched_count=2',
				argsSummary: '{"query":"tracekeeper"}',
				sortTimestamp: 200,
			},
		],
		'client-codex',
		30
	);
	assert.equal(recallEvidence?.matchedCount, 2);

	const connected = onboardingState.markConnectionVerified(restarted);
	const firstRecallState = onboardingState.markFirstRecallDone(connected, 2, 'tracekeeper');
	const completedContext = {
		vaultReady: true,
		runtimeRunning: true,
		clientConfigured: true,
		skillSetupConfirmed: true,
		agentRestartConfirmed: true,
		connectionVerified: true,
		firstRecallCompleted: true,
	};
	assert.equal(onboardingState.getNextOnboardingStep(firstRecallState, completedContext), 'complete');
	assert.equal(onboardingState.hasOnboardingRecallResult(firstRecallState), true);

	const fromViewModel = onboardingViewModel.buildOnboardingContext({
		vaultReady: true,
		runtimeState: 'running',
		runtimeEnabled: true,
		onboarding: firstRecallState,
		selectedClient: { clientId: 'codex', configState: 'configured' },
	});
	assert.equal(fromViewModel.firstRecallCompleted, true);
	assert.equal(fromViewModel.connectionVerified, true);

	const fallbackClientSelection = onboardingViewModel.resolveOnboardingSelectedClient(
		{ ...firstRecallState, selectedClientId: 'legacy' },
		[{ clientId: 'codex', configState: 'configured' }, { clientId: 'cursor' }],
		'2026-07-22T00:00:00.000Z'
	);
	assert.equal(fallbackClientSelection.selectedClientId, 'codex');
	assert.equal(fallbackClientSelection.state.selectedClientId, 'codex');
	assert.equal(fallbackClientSelection.state.lastUpdatedAt, '2026-07-22T00:00:00.000Z');

	assert.ok(/import tracekeeperSkillContent from ['"]\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/skills\/tracekeeper\/SKILL\.md['"]/.test(pluginMainSource));
	assert.ok(/loader:\s*\{\s*['"]\.md['"]\s*:\s*['"]text['"]\s*\}/m.test(pluginBuildSource));
	assert.ok(skillSource.includes('## Golden Workflow（执行顺序）'));
	assert.ok(skillSource.includes('Never expose, copy, or persist MCP token/secret values.'));
	assert.ok(pluginBundleSource.includes('Tracekeeper Agent Skill'));
	assert.ok(pluginBundleSource.includes('Never expose, copy, or persist MCP token/secret values.'));
	assert.ok(pluginMainSource.includes('This step does not write into client directories.'));
	assert.ok(pluginMainSource.includes('Copy the content into a tracekeeper/SKILL.md file in a personal or project Skills directory that Codex can discover.'));
	assert.ok(/Copy and install it through the selected client\\'s supported Skill, rules, or persistent workflow-instruction mechanism/.test(pluginMainSource));
	assert.ok(pluginMainSource.includes('Confirm Skill setup'));
	assert.ok(pluginMainSource.includes('Skill setup is done'));

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 33 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
