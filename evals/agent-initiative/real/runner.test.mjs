import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	parseArgs,
	runRealMatrix,
	selectScenarios,
	computeArmAggregate,
	buildDelta,
	buildCodexPrompt,
	parseEvaluationAndSummary,
	replayRealReport,
	buildRunPlan,
	buildPairedOutcomes,
	buildWorkingTreeMetadata,
	resolveOutputPaths,
	repositoryRoot,
	mcpRuntimePath,
} from './runner.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const scenariosPath = path.join(testDir, 'scenarios.json');

async function loadRealScenarios() {
	const raw = await fs.readFile(scenariosPath, 'utf8');
	return JSON.parse(raw);
}

function createFakeRunSingle(resultByKey = {}) {
	let calls = 0;
	const runSingle = async (scenario, options) => {
		calls += 1;
		const key = `${scenario.id}:${options.repetition}:${options.arm}`;
		const pass = Object.prototype.hasOwnProperty.call(resultByKey, key) ? resultByKey[key] : true;
		return {
			scenario_id: scenario.id,
			arm: options.arm,
			repetition: options.repetition,
			executed: true,
			trace: { classification: scenario.class, unknown_event_types: [] },
			evaluation: {
				passed: pass,
				checks: { execution: true },
			},
			files: {
				raw: `${key}-raw.jsonl`,
				trace: `${key}-trace.json`,
				message: `${key}-message.json`,
				diagnostics: `${key}-diagnostics.json`,
			},
			kept_vault: null,
			summary: {
				scenario_id: scenario.id,
				arm: options.arm,
				repetition: options.repetition,
				expected: scenario.class,
				observed: scenario.class,
				execution_ok: true,
				passed: pass,
				checks: { execution: true },
				tool_error: false,
				tool_error_count: 0,
				tool_call_count: 0,
				recall_called: false,
				review_queue_called: false,
				start_called: false,
				finish_called: false,
				related_wiki_propagation: null,
				related_sources_propagation: null,
				related_wiki_evidence_available: null,
				related_sources_evidence_available: null,
				related_wiki_propagated_when_available: null,
				related_sources_propagated_when_available: null,
				no_track_false_positive: false,
				no_track_true_negative: scenario.class === 'no_track' ? true : null,
				track_task_flow_ok: null,
				track_task_finish_once: null,
				finish_task_id_continuity: null,
				start_project_identity_correct: null,
				first_project_recall_identity_correct: null,
				first_recall_durable_project_memory_hit: null,
				project_identity_recovery_required: null,
				duplicate_recall: null,
				tool_calls_before_effective_recall: null,
			},
		};
	};
	return {
		runSingle,
		calls: () => calls,
	};
}

test('working-tree provenance changes when untracked bytes change', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-eval-git-state-'));
	try {
		spawnSync('git', ['init', '-q'], { cwd: root });
		await fs.writeFile(path.join(root, 'tracked.txt'), 'tracked\n', 'utf8');
		spawnSync('git', ['add', '.'], { cwd: root });
		spawnSync('git', ['-c', 'user.name=Tracekeeper Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });
		await fs.writeFile(path.join(root, 'untracked.txt'), 'first\n', 'utf8');
		const first = await buildWorkingTreeMetadata(root);
		await fs.writeFile(path.join(root, 'untracked.txt'), 'second\n', 'utf8');
		const second = await buildWorkingTreeMetadata(root);

		assert.equal(first.dirty, true);
		assert.equal(first.untracked_file_count, 1);
		assert.match(first.working_tree_diff_sha256, /^[a-f0-9]{64}$/);
		assert.notEqual(first.working_tree_diff_sha256, second.working_tree_diff_sha256);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

function createFlakyRunSingle(attemptsByKey = {}) {
	let calls = 0;
	const attempts = new Map();
	const runSingle = async (scenario, options) => {
		calls += 1;
		const key = `${scenario.id}:${options.repetition}:${options.arm}`;
		const nextAttempt = (attempts.get(key) || 0) + 1;
		attempts.set(key, nextAttempt);
		const failUntilAttempt = Number.isFinite(attemptsByKey[key]) ? Number(attemptsByKey[key]) : 0;
		const executed = nextAttempt > failUntilAttempt;
		const pass = executed;
		return {
			scenario_id: scenario.id,
			arm: options.arm,
			repetition: options.repetition,
			executed,
			trace: { classification: scenario.class, unknown_event_types: [] },
			evaluation: {
				passed: pass,
				checks: { execution: executed },
			},
			files: {
				raw: `${key}-raw-${nextAttempt}.jsonl`,
				trace: `${key}-trace-${nextAttempt}.json`,
				message: `${key}-message-${nextAttempt}.json`,
				diagnostics: `${key}-diagnostics-${nextAttempt}.json`,
			},
			kept_vault: null,
			summary: {
				scenario_id: scenario.id,
				arm: options.arm,
				repetition: options.repetition,
				expected: scenario.class,
				observed: scenario.class,
				execution_ok: executed,
				passed: pass,
				checks: { execution: executed },
				tool_error: false,
				tool_error_count: 0,
				tool_call_count: 0,
				recall_called: false,
				review_queue_called: false,
				start_called: false,
				finish_called: false,
				related_wiki_propagation: null,
				related_sources_propagation: null,
				related_wiki_evidence_available: null,
				related_sources_evidence_available: null,
				related_wiki_propagated_when_available: null,
				related_sources_propagated_when_available: null,
				no_track_false_positive: false,
				no_track_true_negative: scenario.class === 'no_track' ? true : null,
				track_task_flow_ok: null,
				track_task_finish_once: null,
				finish_task_id_continuity: null,
				start_project_identity_correct: null,
				first_project_recall_identity_correct: null,
				first_recall_durable_project_memory_hit: null,
				project_identity_recovery_required: null,
				duplicate_recall: null,
				tool_calls_before_effective_recall: null,
			},
		};
	};
	return {
		runSingle,
		calls: () => calls,
		attempts: (key) => attempts.get(key) || 0,
	};
}

test('parseArgs normalizes scenario IDs, arm list, and numeric options', () => {
	const args = parseArgs([
		'--scenario', 'real-greeting,real-translation',
		'--scenario', 'real-greeting',
		'--arm', 'both,mcp-only,invalid',
		'--repetitions', '2',
		'--max-scenarios', '3',
		'--replay-report', 'evals/agent-initiative/reports/real/source/aggregate.json',
	]);
	assert.deepEqual(args.scenarioIds, ['real-greeting', 'real-translation']);
	assert.deepEqual(args.arm, ['both', 'mcp-only']);
	assert.equal(args.repetitions, 2);
	assert.equal(args.maxInfraRetries, 2);
	assert.equal(args.maxScenarios, 3);
	assert.equal(args.replayReportArg, 'evals/agent-initiative/reports/real/source/aggregate.json');
});

test('parseArgs clamps infra retry budget', () => {
	const args = parseArgs([
		'--max-infra-retries', '7',
		'--repetitions', '1',
		'--scenario', 'real-greeting',
	]);
	assert.equal(args.maxInfraRetries, 5);
});

test('buildRunPlan is deterministic and counterbalances two-arm order with seed', () => {
	const scenarios = [
		{ id: 's1', class: 'no_track', kind: 'positive' },
		{ id: 's2', class: 'recall_only', kind: 'negative' },
		{ id: 's3', class: 'tracked_task', kind: 'positive' },
	];
	const first = buildRunPlan(scenarios, 2, ['both'], 'run-seed-1');
	const second = buildRunPlan(scenarios, 2, ['both'], 'run-seed-1');
	assert.deepEqual(first, second);
	const firstFirst = first.filter((entry) => entry.armOrder[0] === 'mcp-only').length;
	const secondFirst = first.filter((entry) => entry.armOrder[0] === 'mcp-skill').length;
	assert.ok(Math.abs(firstFirst - secondFirst) <= 1);
	const single = buildRunPlan(scenarios, 2, ['mcp-only'], 'run-seed-1');
	assert.equal(single.every((entry) => entry.armOrder.join() === 'mcp-only'), true);
	const pairCounts = {};
	for (const entry of first) {
		const key = `${entry.scenario_id}|${entry.repetition}`;
		pairCounts[key] = (pairCounts[key] || 0) + 1;
		assert.equal(entry.armOrder.length, 2);
	}
	for (const count of Object.values(pairCounts)) {
		assert.equal(count, 1);
	}
	assert.equal(first.length, Object.keys(pairCounts).length);
});

test('runner resolves repository and built MCP entrypoint from the real directory depth', async () => {
	assert.equal(repositoryRoot, path.resolve(testDir, '../../..'));
	assert.equal(mcpRuntimePath, path.join(repositoryRoot, 'apps/mcp-server/dist/server.js'));
	await fs.access(mcpRuntimePath);
});

test('resolveOutputPaths keeps experiments under real reports and requires a stable resume target', () => {
	const experiment = resolveOutputPaths(parseArgs([
		'--execute',
		'--experiment-id', 'smoke-seed-1',
	]));
	assert.equal(
		experiment.outputDir,
		path.join(repositoryRoot, 'evals/agent-initiative/reports/real/smoke-seed-1'),
	);
	assert.equal(experiment.checkpointPath, path.join(experiment.outputDir, 'checkpoint.json'));
	const automatic = resolveOutputPaths(parseArgs(['--execute']));
	assert.equal(automatic.checkpointPath, path.join(automatic.outputDir, 'checkpoint.json'));
	assert.throws(
		() => resolveOutputPaths(parseArgs(['--execute', '--resume'])),
		/--resume requires/,
	);
	assert.throws(
		() => resolveOutputPaths(parseArgs(['--execute', '--experiment-id', '../escape'])),
		/--experiment-id may contain only/,
	);
	assert.throws(
		() => resolveOutputPaths(parseArgs([
			'--execute',
			'--experiment-id', 'conflict',
			'--report', 'evals/agent-initiative/reports/real/conflict.json',
		])),
		/--experiment-id cannot be used/,
	);
});

test('runRealMatrix writes paired outcome summary in aggregate', () => {
	const scenarios = [
		{ id: 's1', class: 'no_track' },
		{ id: 's2', class: 'tracked_task' },
	];
	const summaries = [
		{ scenario_id: 's1', arm: 'mcp-only', repetition: 1, passed: false },
		{ scenario_id: 's1', arm: 'mcp-skill', repetition: 1, passed: true },
		{ scenario_id: 's2', arm: 'mcp-only', repetition: 1, passed: true },
		{ scenario_id: 's2', arm: 'mcp-skill', repetition: 1, passed: true },
	];
	const paired = buildPairedOutcomes(summaries, scenarios);
	assert.equal(paired.total_pairs, 2);
	assert.equal(paired.skill_win, 1);
	assert.equal(paired.mcp_only_win, 0);
	assert.equal(paired.tie_pass, 1);
	assert.equal(paired.discordant_pairs, 1);
	assert.equal(paired.strict_pass_counts.overall.total, 2);
	assert.equal(paired.strict_pass_delta.overall.delta, 0.5);
	assert.equal(paired.strict_pass_delta.tracked_task.delta, 0);
	assert.equal(paired.strict_pass_delta.no_track.delta, 1);
});

test('paired outcomes exclude infrastructure-failed arm pairs', () => {
	const scenarios = [{ id: 's1', class: 'tracked_task' }];
	const paired = buildPairedOutcomes([
		{ scenario_id: 's1', arm: 'mcp-only', repetition: 1, passed: false, execution_ok: false },
		{ scenario_id: 's1', arm: 'mcp-skill', repetition: 1, passed: true, execution_ok: true },
	], scenarios);
	assert.equal(paired.total_pairs, 0);
	assert.equal(paired.strict_pass_counts.overall.total, 0);
});

test('runRealMatrix supports resume with checkpoint and skips already completed tuples', async (context) => {
	const experimentId = `resume-checkpoint-${Date.now()}`;
	context.after(async () => {
		await fs.rm(path.join(repositoryRoot, 'evals', 'agent-initiative', 'reports', 'real', experimentId), { recursive: true, force: true });
	});
	const scenario = {
		id: 'resume-scenario',
		class: 'no_track',
		prompt: 'Run a no-track scenario.',
		kind: 'positive',
		expected: { required_tools: [] },
	};
	const firstArgs = parseArgs([
		'--execute',
		'--scenario', scenario.id,
		'--arm', 'both',
		'--repetitions', '1',
		'--seed', 'seed-resume',
		'--codex-bin', 'node',
		'--experiment-id', experimentId,
	]);
	const output = resolveOutputPaths(firstArgs);
	const firstRun = createFakeRunSingle({
		'resume-scenario:1:mcp-only': true,
		'resume-scenario:1:mcp-skill': true,
	});
	const firstReport = await runRealMatrix([scenario], firstArgs, output, firstRun.runSingle);
	assert.equal(firstRun.calls(), 2);
	const resumeArgs = parseArgs([
		'--execute',
		'--scenario', scenario.id,
		'--arm', 'both',
		'--repetitions', '1',
		'--seed', 'seed-resume',
		'--codex-bin', 'node',
		'--experiment-id', experimentId,
		'--resume',
	]);
	const resumeOutput = resolveOutputPaths(resumeArgs);
	const resumeRun = createFakeRunSingle();
	const secondReport = await runRealMatrix([scenario], resumeArgs, resumeOutput, resumeRun.runSingle);
	assert.equal(resumeRun.calls(), 0);
	assert.equal(firstReport.runs.length, 2);
	assert.equal(secondReport.runs.length, 2);
	assert.equal(secondReport.runs[0].scenario_id, scenario.id);

	const mismatchSeedArgs = parseArgs([
		'--execute',
		'--scenario', scenario.id,
		'--arm', 'both',
		'--repetitions', '1',
		'--seed', 'seed-mismatch',
		'--codex-bin', 'node',
		'--experiment-id', experimentId,
		'--resume',
	]);
	const mismatchOutput = resolveOutputPaths(mismatchSeedArgs);
	await assert.rejects(
		runRealMatrix([scenario], mismatchSeedArgs, mismatchOutput, resumeRun.runSingle),
		/Cannot resume: checkpoint config differs/,
	);

	const checkpoint = JSON.parse(await fs.readFile(output.checkpointPath, 'utf8'));
	checkpoint.completed_runs[0].passed = !checkpoint.completed_runs[0].passed;
	await fs.writeFile(output.checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
	await assert.rejects(
		runRealMatrix([scenario], resumeArgs, resumeOutput, resumeRun.runSingle),
		/Cannot resume: checkpoint integrity check failed/,
	);
});

test('runRealMatrix includes experiment provenance fields and runtime metadata', async (context) => {
	const experimentId = `provenance-${Date.now()}`;
	context.after(async () => {
		await fs.rm(path.join(repositoryRoot, 'evals', 'agent-initiative', 'reports', 'real', experimentId), { recursive: true, force: true });
	});
	const scenario = {
		id: 'provenance-scenario',
		class: 'tracked_task',
		prompt: 'Run tracked task.',
		kind: 'positive',
		related_wiki: ['wiki.md'],
		related_sources: ['source.md'],
		expected: { required_tools: ['tracekeeper.start_task', 'tracekeeper.recall', 'tracekeeper.finish_task'] },
	};
	const args = parseArgs([
		'--execute',
		'--scenario', scenario.id,
		'--arm', 'both',
		'--repetitions', '1',
		'--seed', 'seed-prov',
		'--codex-bin', 'node',
		'--experiment-id', experimentId,
	]);
	const output = resolveOutputPaths(args);
	const run = createFakeRunSingle();
	const report = await runRealMatrix([scenario], args, output, run.runSingle);
	const { provenance } = report;
	assert.equal(typeof provenance.commit_sha, 'undefined');
	assert.equal(typeof provenance.git.commit_sha, 'string');
	assert.match(provenance.git.commit_sha, /^[a-f0-9]{40}$/);
	assert.equal(typeof provenance.git.dirty, 'boolean');
	assert.match(provenance.git.working_tree_diff_sha256, /^[a-f0-9]{64}$/);
	assert.equal(provenance.seed, 'seed-prov');
	assert.equal(provenance.model, 'resolved_default_unknown');
	assert.match(provenance.evaluator_code_sha256, /^[a-f0-9]{64}$/);
	assert.match(provenance.scenario_set_sha256, /^[a-f0-9]{64}$/);
	assert.match(provenance.mcp_stack_sha256, /^[a-f0-9]{64}$/);
	assert.equal(typeof provenance.skill_manifest.skill_version, 'string');
	assert.match(provenance.skill_manifest.skill_bundle_hash, /^sha256:[a-f0-9]{64}$/);
	assert.equal(typeof provenance.skill_manifest.workflow_contract_version, 'number');
	assert.equal(provenance.codex.binary_id, 'node');
	assert.equal(typeof provenance.codex.version, 'string');
	assert.equal(typeof provenance.execution_env.platform, 'string');
	assert.equal(typeof provenance.execution_env.arch, 'string');
	assert.equal(typeof provenance.start_timestamp, 'string');
	assert.equal(typeof provenance.completion_timestamp, 'string');
	assert.equal(Date.parse(provenance.start_timestamp) > 0, true);
	assert.equal(Date.parse(provenance.completion_timestamp) >= Date.parse(provenance.start_timestamp), true);
	assert.equal(provenance.model_status, 'unknown');
	assert.equal(provenance.release_grade, false);
	assert.equal(provenance.git.changed_during_run, false);
	assert.deepEqual(provenance.skill_manifest.contamination_scan, {
		external_tracekeeper_skills_detected: false,
		external_tracekeeper_skill_count: 0,
	});
	assert.equal(JSON.stringify(provenance).includes(os.homedir()), false);
});

test('runRealMatrix tracks requested model provenance and release_grade markers', async (context) => {
	const experimentId = `provenance-model-${Date.now()}`;
	context.after(async () => {
		await fs.rm(path.join(repositoryRoot, 'evals', 'agent-initiative', 'reports', 'real', experimentId), { recursive: true, force: true });
	});
	const scenario = {
		id: 'provenance-model-scenario',
		class: 'recall_only',
		kind: 'positive',
		prompt: 'Use recall-only mode.',
		expected: { required_tools: ['tracekeeper.recall'] },
	};
	const args = parseArgs([
		'--execute',
		'--scenario', scenario.id,
		'--arm', 'mcp-only',
		'--repetitions', '1',
		'--codex-bin', 'node',
		'--model', 'o4-mini',
		'--experiment-id', experimentId,
	]);
	const output = resolveOutputPaths(args);
	const run = createFakeRunSingle({ 'provenance-model-scenario:1:mcp-only': true });
	const report = await runRealMatrix([scenario], args, output, run.runSingle);
	assert.equal(report.provenance.model, 'o4-mini');
	assert.equal(report.provenance.model_status, 'requested');
	assert.equal(report.provenance.release_grade, true);
});

test('runRealMatrix retries infra-failed runs on resume up to the configured budget', async (context) => {
	const experimentId = `resume-infra-retry-${Date.now()}`;
	context.after(async () => {
		await fs.rm(path.join(repositoryRoot, 'evals', 'agent-initiative', 'reports', 'real', experimentId), { recursive: true, force: true });
		await fs.rm(path.join(repositoryRoot, 'evals', 'agent-initiative', 'reports', 'real', `${experimentId}-hard-limit`), { recursive: true, force: true });
	});
	const scenario = {
		id: 'resume-retry-scenario',
		class: 'no_track',
		prompt: 'Run retryable no-track case.',
		kind: 'positive',
	};

	const retryArgs = parseArgs([
		'--execute',
		'--scenario', scenario.id,
		'--arm', 'mcp-only',
		'--repetitions', '1',
		'--seed', 'seed-retry',
		'--codex-bin', 'node',
		'--experiment-id', experimentId,
		'--max-infra-retries', '2',
	]);
	const retryOutput = resolveOutputPaths(retryArgs);
	const retryRun = createFlakyRunSingle({ 'resume-retry-scenario:1:mcp-only': 1 });
	const firstRetryReport = await runRealMatrix([scenario], retryArgs, retryOutput, retryRun.runSingle);
	assert.equal(retryRun.calls(), 1);
	assert.equal(firstRetryReport.runs[0].executed, false);
	assert.equal(firstRetryReport.runs[0].attempts, 1);
	assert.equal(firstRetryReport.runs[0].passed, false);

	const retryResumeArgs = parseArgs([
		'--execute',
		'--scenario', scenario.id,
		'--arm', 'mcp-only',
		'--repetitions', '1',
		'--seed', 'seed-retry',
		'--codex-bin', 'node',
		'--experiment-id', experimentId,
		'--max-infra-retries', '2',
		'--resume',
	]);
	const retryResumeOutput = resolveOutputPaths(retryResumeArgs);
	const secondRetryReport = await runRealMatrix([scenario], retryResumeArgs, retryResumeOutput, retryRun.runSingle);
	assert.equal(retryRun.calls(), 2);
	assert.equal(secondRetryReport.runs[0].executed, true);
	assert.equal(secondRetryReport.runs[0].attempts, 2);
	assert.equal(secondRetryReport.runs[0].passed, true);
	const retryCheckpoint = JSON.parse(await fs.readFile(retryOutput.checkpointPath, 'utf8'));
	assert.equal(retryCheckpoint.completed_runs[0].attempts, 2);

	const hardLimitArgs = parseArgs([
		'--execute',
		'--scenario', scenario.id,
		'--arm', 'mcp-only',
		'--repetitions', '1',
		'--seed', 'seed-hard-limit',
		'--codex-bin', 'node',
		'--experiment-id', `${experimentId}-hard-limit`,
		'--max-infra-retries', '0',
	]);
	const hardLimitOutput = resolveOutputPaths(hardLimitArgs);
	const hardLimitRun = createFlakyRunSingle({ 'resume-retry-scenario:1:mcp-only': 1 });
	const hardLimitReport = await runRealMatrix([scenario], hardLimitArgs, hardLimitOutput, hardLimitRun.runSingle);
	assert.equal(hardLimitRun.calls(), 1);
	assert.equal(hardLimitReport.runs[0].executed, false);
	assert.equal(hardLimitReport.runs[0].attempts, 1);
	assert.equal(hardLimitReport.runs[0].passed, false);

	const hardLimitResumeArgs = parseArgs([
		'--execute',
		'--scenario', scenario.id,
		'--arm', 'mcp-only',
		'--repetitions', '1',
		'--seed', 'seed-hard-limit',
		'--codex-bin', 'node',
		'--experiment-id', `${experimentId}-hard-limit`,
		'--max-infra-retries', '0',
		'--resume',
	]);
	const hardLimitResumeOutput = resolveOutputPaths(hardLimitResumeArgs);
	const hardLimitResumeReport = await runRealMatrix([scenario], hardLimitResumeArgs, hardLimitResumeOutput, hardLimitRun.runSingle);
	assert.equal(hardLimitRun.calls(), 1);
	assert.equal(hardLimitResumeReport.runs[0].executed, false);
	assert.equal(hardLimitResumeReport.runs[0].attempts, 1);
	assert.equal(hardLimitResumeReport.runs[0].passed, false);
	const hardLimitCheckpoint = JSON.parse(await fs.readFile(hardLimitOutput.checkpointPath, 'utf8'));
	assert.equal(hardLimitCheckpoint.completed_runs[0].attempts, 1);
});

test('runRealMatrix returns dry-run payload without executing codex', async () => {
	const all = await loadRealScenarios();
	const selected = selectScenarios(all, ['real-greeting'], 0);
	const options = parseArgs(['--scenario', 'real-greeting', '--arm', 'both', '--repetitions', '2']);
	const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-real-dry-run-'));
	const outputDir = path.join(temporaryRoot, 'run');
	const outputPaths = {
		runId: 'manual-dry-run',
		outputDir,
		aggregatePath: path.join(outputDir, 'aggregate.json'),
	};
	const report = await runRealMatrix(selected, options, outputPaths);
	assert.equal(report.dry_run, true);
	assert.equal(report.scenario_count, 1);
	assert.equal(report.repetitions, 2);
	assert.equal(report.scenario_ids.join(), 'real-greeting');
	assert.equal(report.runs.length, 0);
	await assert.rejects(fs.access(outputDir), /ENOENT/);
});

test('replayRealReport reevaluates bounded raw artifacts without model execution', async (context) => {
	const allScenarios = await loadRealScenarios();
	const scenario = allScenarios.find((entry) => entry.id === 'real-track-wiki-closeout');
	const reportsDirectory = path.join(repositoryRoot, 'evals/agent-initiative/reports/real');
	await fs.mkdir(reportsDirectory, { recursive: true });
	const fixtureDirectory = await fs.mkdtemp(path.join(reportsDirectory, 'replay-test-'));
	context.after(async () => {
		await fs.rm(fixtureDirectory, { recursive: true, force: true });
	});

	const taskId = 'task-replay-local-wiki';
	const raw = [
		{ type: 'tool_call', tool: 'tracekeeper.start_task', arguments: { goal: scenario.prompt } },
		{ type: 'tool_result', tool: 'tracekeeper.start_task', result: { task_id: taskId } },
		{
			type: 'tool_call',
			tool: 'tracekeeper.recall',
			arguments: { query: 'latest closeout', scope: 'project' },
		},
		{ type: 'tool_result', tool: 'tracekeeper.recall', result: { matches: [] } },
		{
			type: 'tool_call',
			tool: 'tracekeeper.finish_task',
			arguments: {
				task_id: taskId,
				summary: 'Synced the local Wiki.',
				related_wiki: scenario.related_wiki[0],
				related_sources: scenario.related_sources[0],
			},
		},
		{
			type: 'tool_result',
			tool: 'tracekeeper.finish_task',
			result: { memory_closeout_status: 'ignored' },
		},
	].map((entry) => JSON.stringify(entry)).join('\n');
	const rawPath = path.join(fixtureDirectory, 'raw.jsonl');
	await fs.writeFile(rawPath, `${raw}\n`, 'utf8');
	const sourceReportPath = path.join(fixtureDirectory, 'aggregate.json');
	await fs.writeFile(sourceReportPath, `${JSON.stringify({
		run_id: 'fixture-source-run',
		repetition_count: 1,
		runs: [{
			scenario_id: scenario.id,
			arm: 'mcp-skill',
			repetition: 1,
			checks: { execution: true },
			files: { raw: path.relative(repositoryRoot, rawPath) },
		}],
	}, null, 2)}\n`, 'utf8');

	const replay = await replayRealReport(sourceReportPath, [scenario], ['mcp-skill']);
	assert.equal(replay.replay, true);
	assert.equal(replay.source_run_id, 'fixture-source-run');
	assert.deepEqual(replay.arms, ['mcp-skill']);
	assert.equal(replay.runs.length, 1);
	assert.equal(replay.runs[0].passed, true);
	assert.match(replay.runs[0].raw_sha256, /^[a-f0-9]{64}$/);
	assert.match(replay.source_report_sha256, /^[a-f0-9]{64}$/);
	assert.match(replay.evaluation_code_sha256, /^[a-f0-9]{64}$/);
	assert.match(replay.scenario_set_sha256, /^[a-f0-9]{64}$/);
	assert.equal(replay.aggregates['mcp-skill'].strict_scenario_pass_rate, 1);
	assert.equal(replay.aggregates['mcp-skill'].related_wiki_propagation, 1);
	assert.equal(replay.aggregates['mcp-skill'].related_sources_propagation, 1);
	assert.equal(replay.aggregates['mcp-skill'].tool_error_rate, 0);
	const sourceReportBeforeOverwriteAttempt = await fs.readFile(sourceReportPath, 'utf8');
	const overwriteAttempt = spawnSync(process.execPath, [
		path.join(testDir, 'runner.mjs'),
		'--replay-report', sourceReportPath,
		'--report', sourceReportPath,
	], {
		cwd: repositoryRoot,
		encoding: 'utf8',
	});
	assert.notEqual(overwriteAttempt.status, 0);
	assert.match(overwriteAttempt.stderr, /Replay output must not overwrite its source report/);
	assert.equal(await fs.readFile(sourceReportPath, 'utf8'), sourceReportBeforeOverwriteAttempt);
	await assert.rejects(
		replayRealReport(sourceReportPath, [scenario], ['mcp-only']),
		/no runs matching the selected scenarios and arms/,
	);

	const escapedReportPath = path.join(fixtureDirectory, 'escaped-aggregate.json');
	await fs.writeFile(escapedReportPath, `${JSON.stringify({
		runs: [{
			scenario_id: scenario.id,
			arm: 'mcp-skill',
			repetition: 1,
			checks: { execution: true },
			files: { raw: '../outside-reports.jsonl' },
		}],
	})}\n`, 'utf8');
	await assert.rejects(
		replayRealReport(escapedReportPath, [scenario], ['mcp-skill']),
		/Replay raw artifacts must remain inside/,
	);
	await assert.rejects(
		replayRealReport(path.join(os.tmpdir(), 'outside-report.json'), [scenario]),
		/--replay-report must resolve inside/,
	);
});

test('real scenarios keep expected distribution', async () => {
	const scenarios = await loadRealScenarios();
	assert.equal(scenarios.length, 12);
	const classCounts = { no_track: 0, recall_only: 0, tracked_task: 0 };
	const kindCounts = { positive: 0, negative: 0, forbidden: 0, failure_recovery: 0 };
	const trackedKinds = { positive: 0, forbidden: 0, failure_recovery: 0 };
	for (const scenario of scenarios) {
		classCounts[scenario.class] += 1;
		kindCounts[scenario.kind] += 1;
		if (scenario.class === 'tracked_task') {
			trackedKinds[scenario.kind] += 1;
		}
	}
	assert.equal(classCounts.no_track, 3);
	assert.equal(classCounts.recall_only, 3);
	assert.equal(classCounts.tracked_task, 6);
	assert.equal(trackedKinds.positive, 4);
	assert.equal(trackedKinds.forbidden, 1);
	assert.equal(trackedKinds.failure_recovery, 1);
	assert.ok(scenarios.every((scenario) => scenario.expected.required_reports.length === 0));
});

test('computeArmAggregate and buildDelta produce expected task metrics', () => {
	const scenarios = [
		{ id: 'no-track-a', class: 'no_track', expected: { required_tools: [] } },
		{ id: 'recall-a', class: 'recall_only', expected: { required_tools: ['tracekeeper.recall'] } },
		{
			id: 'track-a',
			class: 'tracked_task',
			related_wiki: ['wiki.md'],
			related_sources: ['source.md'],
			expected: { required_tools: ['tracekeeper.recall'] },
		},
		{
			id: 'track-b',
			class: 'tracked_task',
			related_wiki: ['wiki.md'],
			related_sources: ['source.md'],
			expected: { required_tools: ['tracekeeper.recall'] },
		},
	];
	const mcpOnlySummaries = [
		{
			scenario_id: 'no-track-a',
			arm: 'mcp-only',
			expected: 'no_track',
			observed: 'no_track',
			execution_ok: true,
			passed: true,
			repeat: 1,
			recall_called: false,
			review_queue_called: false,
			start_called: false,
			finish_called: false,
			no_track_false_positive: false,
			tool_error: false,
			tool_error_count: 0,
			tool_call_count: 0,
			related_wiki_propagation: null,
			related_sources_propagation: null,
			related_wiki_evidence_available: null,
			related_sources_evidence_available: null,
			related_wiki_propagated_when_available: null,
			related_sources_propagated_when_available: null,
			track_task_flow_ok: null,
			track_task_finish_once: null,
			finish_task_id_continuity: null,
			start_project_identity_correct: null,
			first_project_recall_identity_correct: null,
			first_recall_durable_project_memory_hit: null,
			project_identity_recovery_required: null,
			duplicate_recall: null,
			tool_calls_before_effective_recall: null,
			tool_calls: [],
		},
		{
			scenario_id: 'recall-a',
			arm: 'mcp-only',
			expected: 'recall_only',
			observed: 'recall_only',
			execution_ok: true,
			passed: true,
			repeat: 1,
			recall_called: true,
			review_queue_called: false,
			start_called: false,
			finish_called: false,
			no_track_false_positive: false,
			tool_error: false,
			tool_error_count: 0,
			tool_call_count: 1,
			related_wiki_propagation: true,
			related_sources_propagation: true,
			related_wiki_evidence_available: null,
			related_sources_evidence_available: null,
			related_wiki_propagated_when_available: null,
			related_sources_propagated_when_available: null,
			track_task_flow_ok: null,
			track_task_finish_once: null,
			finish_task_id_continuity: null,
			start_project_identity_correct: null,
			first_project_recall_identity_correct: null,
			first_recall_durable_project_memory_hit: null,
			project_identity_recovery_required: null,
			duplicate_recall: false,
			tool_calls_before_effective_recall: null,
			tool_calls: [],
		},
		{
			scenario_id: 'track-a',
			arm: 'mcp-only',
			expected: 'tracked_task',
			observed: 'tracked_task',
			execution_ok: true,
			passed: true,
			repeat: 1,
			recall_called: true,
			review_queue_called: false,
			start_called: true,
			finish_called: true,
			no_track_false_positive: false,
			tool_error: false,
			tool_error_count: 0,
			tool_call_count: 3,
			related_wiki_propagation: true,
			related_sources_propagation: true,
			related_wiki_evidence_available: true,
			related_sources_evidence_available: true,
			related_wiki_propagated_when_available: true,
			related_sources_propagated_when_available: true,
			track_task_flow_ok: true,
			track_task_finish_once: true,
			finish_task_id_continuity: true,
			start_project_identity_correct: true,
			first_project_recall_identity_correct: true,
			first_recall_durable_project_memory_hit: true,
			project_identity_recovery_required: false,
			duplicate_recall: false,
			tool_calls_before_effective_recall: 2,
			tool_calls: [],
		},
		{
			scenario_id: 'track-b',
			arm: 'mcp-only',
			expected: 'tracked_task',
			observed: 'recall_only',
			execution_ok: true,
			passed: false,
			repeat: 1,
			recall_called: false,
			review_queue_called: false,
			start_called: true,
			finish_called: true,
			no_track_false_positive: false,
			tool_error: false,
			tool_error_count: 0,
			tool_call_count: 2,
			related_wiki_propagation: false,
			related_sources_propagation: false,
			related_wiki_evidence_available: true,
			related_sources_evidence_available: true,
			related_wiki_propagated_when_available: false,
			related_sources_propagated_when_available: false,
			track_task_flow_ok: false,
			track_task_finish_once: false,
			finish_task_id_continuity: false,
			start_project_identity_correct: false,
			first_project_recall_identity_correct: false,
			first_recall_durable_project_memory_hit: false,
			project_identity_recovery_required: true,
			duplicate_recall: true,
			tool_calls_before_effective_recall: null,
			tool_calls: [],
		},
	];
	const mcpSkillSummaries = mcpOnlySummaries.map((entry) => ({
		...entry,
		arm: 'mcp-skill',
		passed: entry.scenario_id === 'track-b' ? false : entry.passed,
	}));
	const mcpOnlyAggregate = computeArmAggregate(scenarios, mcpOnlySummaries, 'mcp-only');
	const mcpSkillAggregate = computeArmAggregate(scenarios, mcpSkillSummaries, 'mcp-skill');
	assert.equal(mcpOnlyAggregate.total_runs, 4);
	assert.equal(mcpOnlyAggregate.executed_runs, 4);
	assert.equal(mcpOnlyAggregate.recall_invocation_rate, 0.6667);
	assert.equal(mcpOnlyAggregate.mode_classification_rate, 0.75);
	assert.equal(mcpOnlyAggregate.tracked_start_recall_finish_rate, 0.5);
	assert.equal(mcpOnlyAggregate.tracked_finish_once_rate, 0.5);
	assert.equal(mcpOnlyAggregate.task_id_continuity_rate, 0.5);
	assert.equal(mcpOnlyAggregate.no_track_false_positive_rate, 0);
	assert.equal(mcpOnlyAggregate.start_project_identity_resolution_rate, 0.5);
	assert.equal(mcpOnlyAggregate.first_project_recall_identity_rate, 0.5);
	assert.equal(mcpOnlyAggregate.first_recall_durable_memory_hit_rate, 0.5);
	assert.equal(mcpOnlyAggregate.project_identity_recovery_rate, 0.5);
	assert.equal(mcpOnlyAggregate.duplicate_recall_rate, 0.3333);
	assert.equal(mcpOnlyAggregate.average_tool_calls_per_run, 1.5);
	assert.equal(mcpOnlyAggregate.average_tool_calls_before_effective_recall, 2);
	assert.equal(mcpOnlyAggregate.related_wiki_evidence_available, 1);
	assert.equal(mcpOnlyAggregate.related_sources_evidence_available, 1);
	assert.equal(mcpOnlyAggregate.related_wiki_propagated_when_available, 0.5);
	assert.equal(mcpOnlyAggregate.related_sources_propagated_when_available, 0.5);
	assert.equal(mcpOnlyAggregate.strict_scenario_pass_rate, 0.75);
	assert.equal(mcpOnlyAggregate.strict_no_track_pass_rate, 1);
	assert.equal(mcpOnlyAggregate.strict_recall_only_pass_rate, 1);
	assert.equal(mcpOnlyAggregate.strict_tracked_task_pass_rate, 0.5);
	const delta = buildDelta({ 'mcp-only': mcpOnlyAggregate, 'mcp-skill': mcpSkillAggregate });
	assert.equal(typeof delta, 'object');
	assert.deepEqual(Object.keys(delta).sort(), [
		'mode_classification_rate',
		'no_track_false_positive_rate',
		'recall_invocation_rate',
		'start_project_identity_resolution_rate',
		'first_project_recall_identity_rate',
		'first_recall_durable_memory_hit_rate',
		'project_identity_recovery_rate',
		'duplicate_recall_rate',
		'average_tool_calls_per_run',
		'average_tool_calls_before_effective_recall',
		'related_sources_propagation',
		'related_wiki_propagation',
		'task_id_continuity_rate',
		'tool_error_rate',
		'tracked_finish_once_rate',
		'tracked_start_recall_finish_rate',
		'strict_scenario_pass_rate',
		'strict_no_track_pass_rate',
		'strict_recall_only_pass_rate',
		'strict_tracked_task_pass_rate',
		'related_wiki_evidence_available',
		'related_wiki_propagated_when_available',
		'related_sources_evidence_available',
		'related_sources_propagated_when_available',
	].sort());
	assert.equal(delta.strict_scenario_pass_rate, 0);
	assert.equal(delta.strict_no_track_pass_rate, 0);
	assert.equal(delta.strict_recall_only_pass_rate, 0);
	assert.equal(delta.strict_tracked_task_pass_rate, 0);
});

test('strict pass rates report null when a class has no sampled runs', () => {
	const scenarios = [
		{ id: 'no-track-only', class: 'no_track', expected: { required_tools: [] } },
		{ id: 'recall-only', class: 'recall_only', expected: { required_tools: ['tracekeeper.recall'] } },
	];
	const summaries = [
		{
			scenario_id: 'no-track-only',
			arm: 'mcp-only',
			expected: 'no_track',
			observed: 'no_track',
			execution_ok: true,
			passed: false,
			repeat: 1,
			recall_called: false,
			review_queue_called: false,
			start_called: false,
			finish_called: false,
			no_track_false_positive: false,
			tool_error: false,
			tool_error_count: 0,
			tool_call_count: 0,
			related_wiki_propagation: null,
			related_sources_propagation: null,
			related_wiki_evidence_available: null,
			related_sources_evidence_available: null,
			related_wiki_propagated_when_available: null,
			related_sources_propagated_when_available: null,
			track_task_flow_ok: null,
			track_task_finish_once: null,
			finish_task_id_continuity: null,
			start_project_identity_correct: null,
			first_project_recall_identity_correct: null,
			first_recall_durable_project_memory_hit: null,
			project_identity_recovery_required: null,
			duplicate_recall: null,
			tool_calls_before_effective_recall: null,
			tool_calls: [],
		},
	];
	const aggregate = computeArmAggregate(scenarios, summaries, 'mcp-only');
	assert.equal(aggregate.strict_scenario_pass_rate, 0);
	assert.equal(aggregate.strict_no_track_pass_rate, 0);
	assert.equal(aggregate.strict_recall_only_pass_rate, null);
	assert.equal(aggregate.strict_tracked_task_pass_rate, null);
});

test('identity probe measures first-pass project identity and durable recall without counting recovery', async () => {
	const scenarios = await loadRealScenarios();
	const scenario = scenarios.find((entry) => entry.id === 'real-track-basic');
	const taskId = 'obs_task_identity_probe';
	const trace = {
		scenario_id: scenario.id,
		arm: 'mcp-only',
		repetition: 1,
		classification: 'tracked_task',
		diagnostics: [],
		unknown_event_types: [],
		events: [
			{ type: 'tool_call', tool: 'tracekeeper.start_task', args: { goal: scenario.prompt, project_hint: '/tmp/work/obsidian-tracekeeper' } },
			{
				type: 'tool_result',
				tool: 'tracekeeper.start_task',
				result: {
					task_id: taskId,
					project_identity: {
						project_hint: 'obsidian-tracekeeper',
						repo_path: '/tmp/work/obsidian-tracekeeper',
					},
				},
			},
			{
				type: 'tool_call',
				tool: 'tracekeeper.recall',
				args: {
					query: scenario.prompt,
					scope: 'project',
					project_hint: 'obsidian-tracekeeper',
					repo_path: '/tmp/work/obsidian-tracekeeper',
				},
			},
			{
				type: 'tool_result',
				tool: 'tracekeeper.recall',
				result: {
					project_identity: {
						project_hint: 'obsidian-tracekeeper',
						repo_path: '/tmp/work/obsidian-tracekeeper',
					},
					entries: [{ path: '01_knowledge/memory/projects/obsidian-tracekeeper/memory.md' }],
				},
			},
			{
				type: 'tool_call',
				tool: 'tracekeeper.finish_task',
				args: {
					task_id: taskId,
					summary: 'Finished identity probe.',
					related_wiki: scenario.related_wiki,
					related_sources: scenario.related_sources,
				},
			},
			{ type: 'tool_result', tool: 'tracekeeper.finish_task', result: { memory_closeout_state: 'no_candidates' } },
			{ type: 'assistant_report', closeout_status: 'ignored', codes: [] },
		],
	};
	const summary = parseEvaluationAndSummary(scenario, trace, { exitCode: 0 });
	assert.equal(summary.start_project_identity_correct, true);
	assert.equal(summary.first_project_recall_identity_correct, true);
	assert.equal(summary.first_recall_durable_project_memory_hit, true);
	assert.equal(summary.project_identity_recovery_required, false);
	assert.equal(summary.duplicate_recall, false);
	assert.equal(summary.tool_calls_before_effective_recall, 2);
});

test('summary propagation accepts schema-supported scalar Wiki and source paths', () => {
	const scenario = {
		id: 'scalar-related-paths',
		class: 'tracked_task',
		prompt: 'Sync the local Wiki.',
		related_wiki: ['01_knowledge/wiki/hubs/project-overview.md'],
		related_sources: ['01_knowledge/sources/design-notes.md'],
		expected: {
			required_tools: ['tracekeeper.start_task', 'tracekeeper.recall', 'tracekeeper.finish_task'],
			forbidden_tools: [],
			ordered_subsequence: ['tracekeeper.start_task', 'tracekeeper.recall', 'tracekeeper.finish_task'],
			argument_rules: [],
			same_task_id: true,
			finish_exactly_once: true,
			forbidden_behaviors: [],
			required_reports: [],
			closeout_report: { required: true, allowed_statuses: ['ignored'], match_finish_result: true },
		},
	};
	const taskId = 'task-scalar-related-paths';
	const trace = {
		scenario_id: scenario.id,
		arm: 'mcp-only',
		repetition: 1,
		classification: 'tracked_task',
		diagnostics: [],
		unknown_event_types: [],
		events: [
			{ type: 'tool_call', tool: 'tracekeeper.start_task', args: { goal: scenario.prompt } },
			{ type: 'tool_result', tool: 'tracekeeper.start_task', result: { task_id: taskId } },
			{ type: 'tool_call', tool: 'tracekeeper.recall', args: { query: 'latest closeout', scope: 'project' } },
			{ type: 'tool_result', tool: 'tracekeeper.recall', result: { matches: [] } },
			{
				type: 'tool_call',
				tool: 'tracekeeper.finish_task',
				args: {
					task_id: taskId,
					summary: 'Queued local Wiki update.',
					related_wiki: scenario.related_wiki[0],
					related_sources: scenario.related_sources[0],
				},
			},
			{ type: 'tool_result', tool: 'tracekeeper.finish_task', result: { memory_closeout_status: 'ignored' } },
			{ type: 'assistant_report', closeout_status: 'ignored', codes: [] },
		],
	};
	const summary = parseEvaluationAndSummary(scenario, trace, { exitCode: 0 });
	assert.equal(summary.related_wiki_propagation, true);
	assert.equal(summary.related_sources_propagation, true);
	assert.equal(summary.related_wiki_evidence_available, false);
	assert.equal(summary.related_sources_evidence_available, false);
	assert.equal(summary.related_wiki_propagated_when_available, null);
	assert.equal(summary.related_sources_propagated_when_available, null);
});

test('summary propagation tracks relational evidence and conditional propagation from recall/read_note', () => {
	const scenario = {
		id: 'evidence-related-paths',
		class: 'tracked_task',
		related_wiki: ['01_knowledge/wiki/hubs/project-overview.md'],
		related_sources: ['01_knowledge/sources/design-notes.md'],
		expected: {
			required_tools: ['tracekeeper.start_task', 'tracekeeper.recall', 'tracekeeper.finish_task'],
			forbidden_tools: [],
			ordered_subsequence: ['tracekeeper.start_task', 'tracekeeper.recall', 'tracekeeper.finish_task'],
			argument_rules: [],
			same_task_id: true,
			finish_exactly_once: true,
			forbidden_behaviors: [],
			required_reports: [],
			closeout_report: {
				required: true,
				allowed_statuses: ['ignored'],
				match_finish_result: true,
			},
		},
	};
	const taskId = 'task-evidence-related-paths';
	const trace = {
		scenario_id: scenario.id,
		arm: 'mcp-skill',
		repetition: 1,
		classification: 'tracked_task',
		diagnostics: [],
		unknown_event_types: [],
		events: [
			{ type: 'tool_call', tool: 'tracekeeper.start_task', args: { goal: scenario.prompt } },
			{ type: 'tool_result', tool: 'tracekeeper.start_task', result: { task_id: taskId } },
			{ type: 'tool_call', tool: 'tracekeeper.recall', args: { query: 'Sync', scope: 'project' } },
			{
				type: 'tool_result',
				tool: 'tracekeeper.recall',
				result: {
					matches: [{
						path: '01_knowledge/memory/projects/obsidian-tracekeeper/memory.md',
						relation_evidence: {
							related_wiki: [{ path: scenario.related_wiki[0] }],
							related_sources: [],
						},
					}],
				},
			},
			{ type: 'tool_call', tool: 'tracekeeper.read_note', args: { path: scenario.related_sources[0] } },
			{
				type: 'tool_result',
				tool: 'tracekeeper.read_note',
				result: {
					path: scenario.related_sources[0],
					relation_evidence: {
						related_wiki: [],
						related_sources: [{ path: scenario.related_sources[0] }],
					},
				},
			},
			{
				type: 'tool_call',
				tool: 'tracekeeper.finish_task',
				args: {
					task_id: taskId,
					summary: 'Updated references without propagation fields.',
				},
			},
			{ type: 'tool_result', tool: 'tracekeeper.finish_task', result: { memory_closeout_status: 'ignored' } },
			{ type: 'assistant_report', closeout_status: 'ignored', codes: [] },
		],
	};
	const summary = parseEvaluationAndSummary(scenario, trace, { exitCode: 0 });
	assert.equal(summary.related_wiki_propagation, false);
	assert.equal(summary.related_sources_propagation, false);
	assert.equal(summary.related_wiki_evidence_available, true);
	assert.equal(summary.related_sources_evidence_available, true);
	assert.equal(summary.related_wiki_propagated_when_available, false);
	assert.equal(summary.related_sources_propagated_when_available, false);
});

test('buildCodexPrompt is identical across arms and does not leak expectations', () => {
	const scenario = {
		id: 'tracked-secret',
		class: 'tracked_task',
		prompt: 'Continue the project decision.',
		related_wiki: ['private-wiki.md'],
		related_sources: ['private-source.md'],
	};
	const prompt = buildCodexPrompt(scenario);
	assert.match(prompt, /Continue the project decision/);
	assert.doesNotMatch(prompt, /tracked_task|mcp-only|mcp-skill|private-wiki|private-source/);
});
