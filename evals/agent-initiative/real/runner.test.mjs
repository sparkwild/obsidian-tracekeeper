import assert from 'node:assert/strict';
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
	repositoryRoot,
	mcpRuntimePath,
} from './runner.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const scenariosPath = path.join(testDir, 'scenarios.json');

async function loadRealScenarios() {
	const raw = await fs.readFile(scenariosPath, 'utf8');
	return JSON.parse(raw);
}

test('parseArgs normalizes scenario IDs, arm list, and numeric options', () => {
	const args = parseArgs([
		'--scenario', 'real-greeting,real-translation',
		'--scenario', 'real-greeting',
		'--arm', 'both,mcp-only,invalid',
		'--repetitions', '2',
		'--max-scenarios', '3',
	]);
	assert.deepEqual(args.scenarioIds, ['real-greeting', 'real-translation']);
	assert.deepEqual(args.arm, ['both', 'mcp-only']);
	assert.equal(args.repetitions, 2);
	assert.equal(args.maxScenarios, 3);
});

test('runner resolves repository and built MCP entrypoint from the real directory depth', async () => {
	assert.equal(repositoryRoot, path.resolve(testDir, '../../..'));
	assert.equal(mcpRuntimePath, path.join(repositoryRoot, 'apps/mcp-server/dist/server.js'));
	await fs.access(mcpRuntimePath);
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
			track_task_flow_ok: null,
			track_task_finish_once: null,
			finish_task_id_continuity: null,
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
			track_task_flow_ok: null,
			track_task_finish_once: null,
			finish_task_id_continuity: null,
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
			track_task_flow_ok: true,
			track_task_finish_once: true,
			finish_task_id_continuity: true,
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
			track_task_flow_ok: false,
			track_task_finish_once: false,
			finish_task_id_continuity: false,
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
	const delta = buildDelta({ 'mcp-only': mcpOnlyAggregate, 'mcp-skill': mcpSkillAggregate });
	assert.equal(typeof delta, 'object');
	assert.deepEqual(Object.keys(delta).sort(), [
		'mode_classification_rate',
		'no_track_false_positive_rate',
		'recall_invocation_rate',
		'related_sources_propagation',
		'related_wiki_propagation',
		'task_id_continuity_rate',
		'tool_error_rate',
		'tracked_finish_once_rate',
		'tracked_start_recall_finish_rate',
	].sort());
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
