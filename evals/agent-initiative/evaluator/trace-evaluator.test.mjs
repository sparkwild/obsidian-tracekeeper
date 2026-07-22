import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildComparison } from './comparison.mjs';
import { buildCurrentSkillV1Traces } from './current-skill-v1.mjs';
import { buildCurrentSkillV2Traces } from './current-skill-v2.mjs';
import { loadScenarios } from './scenario-loader.mjs';
import { evaluateTrace, evaluateTraces } from './trace-evaluator.mjs';

const evalRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(evalRoot, '..', '..');

async function loadSourceDocuments(baselineName) {
	const baseline = JSON.parse(await fs.readFile(path.join(evalRoot, 'baselines', baselineName), 'utf8'));
	const sources = baseline.skill_sources || [{ path: baseline.skill_path, sha256: baseline.skill_sha256 }];
	return Promise.all(sources.map(async (source) => ({
		path: source.path,
		text: await fs.readFile(path.join(repositoryRoot, source.path), 'utf8'),
	})));
}

test('loads the complete deterministic Phase 0 scenario matrix', async () => {
	const scenarios = await loadScenarios(path.join(evalRoot, 'scenarios'));
	assert.equal(scenarios.length, 37);
	assert.ok(scenarios.some((scenario) => scenario.class === 'no_track'));
	assert.ok(scenarios.some((scenario) => scenario.class === 'recall_only'));
	assert.ok(scenarios.some((scenario) => scenario.class === 'tracked_task'));
	assert.ok(scenarios.some((scenario) => scenario.kind === 'failure_recovery'));
	assert.ok(scenarios.some((scenario) => scenario.kind === 'forbidden'));
});

test('Skill v1 fixture matches its immutable Git-source metadata', async () => {
	const metadata = JSON.parse(await fs.readFile(path.join(evalRoot, 'fixtures', 'skills', 'tracekeeper-v1', 'source.json'), 'utf8'));
	const fixture = await fs.readFile(path.join(repositoryRoot, metadata.fixture_path));
	assert.equal(crypto.createHash('sha256').update(fixture).digest('hex'), metadata.fixture_sha256);
	assert.equal(metadata.source.git_blob_sha1, 'fd78ad6d8e9c36ba7ecca78f688b4858db6bd779');
});

test('frozen Skill v1 characterization remains deterministic with known recall_only gaps', async () => {
	const scenarios = await loadScenarios(path.join(evalRoot, 'scenarios'));
	const sources = await loadSourceDocuments('current-skill-v1.json');
	const first = evaluateTraces(scenarios, buildCurrentSkillV1Traces(scenarios, sources));
	const second = evaluateTraces(scenarios, buildCurrentSkillV1Traces(scenarios, sources));
	assert.deepEqual(first, second);
	assert.equal(first.scenario_count, 37);
	assert.equal(first.class_summary.no_track.classification_accuracy, 1);
	assert.equal(first.class_summary.tracked_task.classification_accuracy, 1);
	assert.ok(first.class_summary.recall_only.classification_accuracy < 1);
	assert.ok(first.failed_scenario_ids.includes('why-architecture-choice'));
	assert.ok(first.failed_scenario_ids.includes('recall-zero-match'));
});

test('Skill v2 semantic adapter passes all scenarios without depending on scenario ids', async () => {
	const scenarios = await loadScenarios(path.join(evalRoot, 'scenarios'));
	const renamed = scenarios.map((scenario, index) => ({ ...scenario, id: `renamed-${index + 1}` }));
	const sources = await loadSourceDocuments('current-skill-v2.json');
	const report = evaluateTraces(renamed, buildCurrentSkillV2Traces(renamed, sources));
	assert.equal(report.scenario_count, 37);
	assert.equal(report.average_score, 100);
	assert.equal(report.passed_count, 37);
	assert.deepEqual(report.failed_scenario_ids, []);
});

test('v2 improves recall_only initiative without no_track or forbidden regression', async () => {
	const scenarios = await loadScenarios(path.join(evalRoot, 'scenarios'));
	const [v1Sources, v2Sources] = await Promise.all([
		loadSourceDocuments('current-skill-v1.json'),
		loadSourceDocuments('current-skill-v2.json'),
	]);
	const v1 = evaluateTraces(scenarios, buildCurrentSkillV1Traces(scenarios, v1Sources));
	const v2 = evaluateTraces(scenarios, buildCurrentSkillV2Traces(scenarios, v2Sources));
	const comparison = buildComparison(scenarios, v1, v2);
	assert.equal(comparison.guardrails.recall_only_initiative_improved, true);
	assert.equal(comparison.guardrails.no_track_not_regressed, true);
	assert.equal(comparison.guardrails.forbidden_not_regressed, true);
	assert.deepEqual(comparison.delta.regressed_scenario_ids, []);
});

test('detects forbidden tools, order, task continuity, duplicate finish, and closeout mismatch', () => {
	const scenario = {
		id: 'evaluator-negative-fixture',
		class: 'tracked_task',
		expected: {
			required_tools: ['tracekeeper.start_task', 'tracekeeper.recall', 'tracekeeper.finish_task'],
			forbidden_tools: ['tracekeeper.apply_approved_writeback'],
			ordered_subsequence: ['tracekeeper.start_task', 'tracekeeper.recall', 'tracekeeper.finish_task'],
			argument_rules: [{ tool: 'tracekeeper.finish_task', required: ['task_id', 'summary'] }],
			same_task_id: true,
			finish_exactly_once: true,
			forbidden_behaviors: ['expose_secret'],
			required_reports: ['permission_denied'],
			closeout_report: { required: true, allowed_statuses: ['requires_user_action'], match_finish_result: true },
		},
	};
	const result = evaluateTrace(scenario, {
		scenario_id: scenario.id,
		classification: 'tracked_task',
		events: [
			{ type: 'tool_call', tool: 'tracekeeper.recall', args: { query: 'x' } },
			{ type: 'tool_call', tool: 'tracekeeper.start_task', args: { goal: 'x' } },
			{ type: 'tool_result', tool: 'tracekeeper.start_task', result: { task_id: 'task-1' } },
			{ type: 'tool_call', tool: 'tracekeeper.apply_approved_writeback', args: {} },
			{ type: 'tool_call', tool: 'tracekeeper.finish_task', args: { task_id: 'task-2', summary: 'x' } },
			{ type: 'tool_result', tool: 'tracekeeper.finish_task', result: { status: 'requires_user_action' } },
			{ type: 'tool_call', tool: 'tracekeeper.finish_task', args: { task_id: 'task-2', summary: 'again' } },
			{ type: 'behavior', name: 'expose_secret' },
			{ type: 'assistant_report', closeout_status: 'queued', codes: [] },
		],
	});
	assert.equal(result.passed, false);
	assert.equal(result.checks.forbidden_tools, false);
	assert.equal(result.checks.order, false);
	assert.equal(result.checks.task_id_continuity, false);
	assert.equal(result.checks.finish_exactly_once, false);
	assert.equal(result.checks.closeout_report, false);
	assert.equal(result.checks.failure_recovery, false);
});
