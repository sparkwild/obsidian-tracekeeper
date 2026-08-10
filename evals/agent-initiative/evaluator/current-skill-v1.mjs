import { classifySkillV1Prompt, promptSignals } from './prompt-semantics.mjs';

function bundleText(sourceDocuments) {
	return sourceDocuments.map((document) => document.text).join('\n');
}

export function buildSkillV1Profile(sourceDocuments) {
	const text = bundleText(sourceDocuments);
	const profile = {
		trackedWorkflow: /Golden Workflow/u.test(text) && /tracekeeper\.start_task/u.test(text) && /tracekeeper\.finish_task/u.test(text),
		recallOnlyMode: /`recall_only`/u.test(text),
	};
	if (!profile.trackedWorkflow || profile.recallOnlyMode) {
		throw new Error('Skill v1 fixture no longer matches its historical workflow profile.');
	}
	return profile;
}

function report(closeoutStatus, codes = []) {
	return { type: 'assistant_report', closeout_status: closeoutStatus, codes };
}

function trackedTrace(scenario, options = {}) {
	const taskId = `task-${scenario.id}`;
	const closeoutStatus = options.closeoutStatus || 'recorded';
	const recallResult = options.recallResult || { matches: [{ path: 'fixture/context.md' }] };
	const finishResult = options.finishResult || { memory_closeout_status: closeoutStatus };
	return {
		scenario_id: scenario.id,
		classification: 'tracked_task',
		events: [
			{ type: 'tool_call', tool: 'tracekeeper.start_task', args: { goal: scenario.prompt, ...(scenario.project_hint ? { project_hint: scenario.project_hint } : {}) } },
			{ type: 'tool_result', tool: 'tracekeeper.start_task', result: { task_id: taskId } },
			{ type: 'tool_call', tool: 'tracekeeper.recall', args: { query: scenario.prompt, scope: scenario.project_hint ? 'project' : 'global' } },
			{ type: 'tool_result', tool: 'tracekeeper.recall', result: recallResult },
			{ type: 'tool_call', tool: 'tracekeeper.finish_task', args: { task_id: options.finishTaskId || taskId, summary: `Completed ${scenario.id}.` } },
			{ type: 'tool_result', tool: 'tracekeeper.finish_task', result: finishResult },
			report(closeoutStatus, options.codes || []),
		],
	};
}

function noTrackTrace(scenario, codes = []) {
	return {
		scenario_id: scenario.id,
		classification: 'no_track',
		events: codes.length ? [report('', codes)] : [],
	};
}

export function buildCurrentSkillV1Trace(scenario, profile) {
	if (!profile?.trackedWorkflow || profile.recallOnlyMode) {
		throw new Error('A verified Skill v1 profile is required.');
	}
	const signals = promptSignals(scenario.prompt);
	if (signals.mcpUnavailable) {
		return {
			scenario_id: scenario.id,
			classification: 'tracked_task',
			events: [
				{ type: 'behavior', name: 'connection_check', status: 'failed' },
				report('', ['mcp_unreachable']),
			],
		};
	}
	if (signals.toolUnavailable) {
		return {
			scenario_id: scenario.id,
			classification: 'tracked_task',
			events: [
				{ type: 'tool_call', tool: 'tracekeeper.start_task', args: { goal: scenario.prompt } },
				{ type: 'tool_result', tool: 'tracekeeper.start_task', result: { error: 'tool not available' } },
				report('', ['tool_unavailable']),
			],
		};
	}
	if (signals.permissionDenied) {
		return trackedTrace(scenario, {
			closeoutStatus: 'requires_user_action',
			finishResult: { status: 'requires_user_action', error: 'permission denied' },
			codes: ['permission_denied'],
		});
	}
	if (signals.zeroMatch) {
		return trackedTrace(scenario, { recallResult: { matches: [] } });
	}
	if (signals.indexRebuilding) {
		return trackedTrace(scenario, { recallResult: { matches: [], index_state: 'rebuilding' } });
	}
	if (signals.taskIdLost) {
		return trackedTrace(scenario, { finishTaskId: 'guessed-task-id' });
	}
	if (signals.idempotencyConflict) {
		return trackedTrace(scenario, {
			closeoutStatus: 'requires_user_action',
			finishResult: { status: 'requires_user_action', error: 'idempotency conflict' },
		});
	}
	if (signals.proposalPending) {
		return trackedTrace(scenario, { closeoutStatus: 'queued', codes: ['proposal_not_applied'] });
	}
	if (signals.proposalReview) {
		return noTrackTrace(scenario, ['proposal_not_applied']);
	}
	if (signals.secretRequest) {
		return noTrackTrace(scenario, ['secret_refused']);
	}
	if (signals.directMemoryWrite || signals.capabilityEscalation) {
		return noTrackTrace(scenario, ['policy_refusal']);
	}
	return classifySkillV1Prompt(scenario.prompt) === 'no_track'
		? noTrackTrace(scenario)
		: trackedTrace(scenario);
}

export function buildCurrentSkillV1Traces(scenarios, sourceDocuments) {
	const profile = buildSkillV1Profile(sourceDocuments);
	return scenarios.map((scenario) => buildCurrentSkillV1Trace(scenario, profile));
}
