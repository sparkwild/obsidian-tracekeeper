import { isDeepStrictEqual } from 'node:util';

export const SCORE_WEIGHTS = Object.freeze({
	classification: 25,
	required_tools: 20,
	forbidden_tools: 15,
	order: 10,
	arguments: 10,
	task_continuity: 10,
	closeout_report: 5,
	failure_recovery: 5,
});

function orderedSubsequence(actual, expected) {
	let cursor = 0;
	for (const value of actual) {
		if (value === expected[cursor]) {
			cursor += 1;
		}
	}
	return cursor === expected.length;
}

function resultStatus(result) {
	if (!result || typeof result !== 'object') {
		return '';
	}
	return result.memory_closeout_status || result.closeout_status || result.status || '';
}

function rulePasses(rule, toolCalls) {
	const candidates = toolCalls.filter((event) => event.tool === rule.tool);
	const call = rule.occurrence === 'last' ? candidates.at(-1) : candidates[0];
	if (!call) {
		return false;
	}
	const args = call.args && typeof call.args === 'object' ? call.args : {};
	for (const key of rule.required || []) {
		if (!(key in args) || args[key] === '' || args[key] === null || args[key] === undefined) {
			return false;
		}
	}
	for (const [key, expectedValue] of Object.entries(rule.equals || {})) {
		if (!isDeepStrictEqual(args[key], expectedValue)) {
			return false;
		}
	}
	return true;
}

function taskContinuity(toolCalls, toolResults, expected) {
	const finishes = toolCalls.filter((event) => event.tool === 'tracekeeper.finish_task');
	const finishCountPass = expected.finish_exactly_once ? finishes.length === 1 : finishes.length === 0;
	if (!expected.same_task_id) {
		return { continuity: true, finishCountPass };
	}
	const startResult = toolResults.find((event) => event.tool === 'tracekeeper.start_task');
	const taskId = startResult?.result?.task_id;
	if (typeof taskId !== 'string' || taskId.length === 0 || finishes.length === 0) {
		return { continuity: false, finishCountPass };
	}
	const callsWithTaskId = toolCalls.filter((event) => event.args && 'task_id' in event.args);
	return {
		continuity: callsWithTaskId.length > 0 && callsWithTaskId.every((event) => event.args.task_id === taskId),
		finishCountPass,
	};
}

function closeoutPass(toolResults, reports, expected) {
	if (!expected.required) {
		return true;
	}
	const report = reports.find((event) => typeof event.closeout_status === 'string');
	if (!report || !expected.allowed_statuses.includes(report.closeout_status)) {
		return false;
	}
	if (!expected.match_finish_result) {
		return true;
	}
	const finishResult = toolResults.find((event) => event.tool === 'tracekeeper.finish_task');
	return report.closeout_status === resultStatus(finishResult?.result);
}

export function evaluateTrace(scenario, trace) {
	if (!trace || trace.scenario_id !== scenario.id || !Array.isArray(trace.events)) {
		throw new Error(`Trace does not match scenario ${scenario.id}.`);
	}
	const expected = scenario.expected;
	const toolCalls = trace.events.filter((event) => event.type === 'tool_call');
	const toolResults = trace.events.filter((event) => event.type === 'tool_result');
	const reports = trace.events.filter((event) => event.type === 'assistant_report');
	const behaviors = trace.events.filter((event) => event.type === 'behavior').map((event) => event.name);
	const toolNames = toolCalls.map((event) => event.tool);
	const task = taskContinuity(toolCalls, toolResults, expected);
	const reportCodes = reports.flatMap((event) => Array.isArray(event.codes) ? event.codes : []);
	const checks = {
		classification: trace.classification === scenario.class,
		required_tools: expected.required_tools.every((tool) => toolNames.includes(tool)),
		forbidden_tools:
			expected.forbidden_tools.every((tool) => !toolNames.includes(tool)) &&
			expected.forbidden_behaviors.every((behavior) => !behaviors.includes(behavior)),
		order: orderedSubsequence(toolNames, expected.ordered_subsequence),
		arguments: expected.argument_rules.every((rule) => rulePasses(rule, toolCalls)),
		task_id_continuity: task.continuity,
		finish_exactly_once: task.finishCountPass,
		closeout_report: closeoutPass(toolResults, reports, expected.closeout_report),
		failure_recovery: expected.required_reports.every((code) => reportCodes.includes(code)),
	};
	const weightedPass = {
		classification: checks.classification,
		required_tools: checks.required_tools,
		forbidden_tools: checks.forbidden_tools,
		order: checks.order,
		arguments: checks.arguments,
		task_continuity: checks.task_id_continuity && checks.finish_exactly_once,
		closeout_report: checks.closeout_report,
		failure_recovery: checks.failure_recovery,
	};
	const score = Object.entries(SCORE_WEIGHTS).reduce(
		(total, [dimension, weight]) => total + (weightedPass[dimension] ? weight : 0),
		0
	);
	return {
		scenario_id: scenario.id,
		expected_class: scenario.class,
		observed_class: trace.classification,
		score,
		passed: Object.values(checks).every(Boolean),
		checks,
	};
}

export function evaluateTraces(scenarios, traces, metadata = {}) {
	const traceByScenario = new Map(traces.map((trace) => [trace.scenario_id, trace]));
	const cases = scenarios.map((scenario) => {
		const trace = traceByScenario.get(scenario.id);
		if (!trace) {
			throw new Error(`Missing trace for scenario ${scenario.id}.`);
		}
		return evaluateTrace(scenario, trace);
	});
	const classSummary = {};
	for (const scenarioClass of ['no_track', 'recall_only', 'tracked_task']) {
		const selected = cases.filter((entry) => entry.expected_class === scenarioClass);
		classSummary[scenarioClass] = {
			count: selected.length,
			average_score: selected.length
				? Number((selected.reduce((sum, entry) => sum + entry.score, 0) / selected.length).toFixed(2))
				: 0,
			classification_accuracy: selected.length
				? Number((selected.filter((entry) => entry.checks.classification).length / selected.length).toFixed(4))
				: 0,
		};
	}
	return {
		...metadata,
		scenario_count: cases.length,
		average_score: Number((cases.reduce((sum, entry) => sum + entry.score, 0) / cases.length).toFixed(2)),
		passed_count: cases.filter((entry) => entry.passed).length,
		failed_scenario_ids: cases.filter((entry) => !entry.passed).map((entry) => entry.scenario_id),
		class_summary: classSummary,
		cases,
	};
}
