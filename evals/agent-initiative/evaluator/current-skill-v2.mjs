import { classifySkillV2Prompt, promptSignals } from './prompt-semantics.mjs';

function bundleText(sourceDocuments) {
	return sourceDocuments.map((document) => document.text).join('\n');
}

function requires(text, pattern, label) {
	if (!pattern.test(text)) {
		throw new Error(`Skill v2 source does not define ${label}.`);
	}
	return true;
}

export function buildSkillV2Profile(sourceDocuments) {
	const text = bundleText(sourceDocuments);
	return {
		noTrackMode: requires(text, /`no_track`[\s\S]*do not call Tracekeeper/iu, 'no_track mode'),
		recallOnlyMode: requires(text, /`recall_only`[\s\S]*tracekeeper\.recall/iu, 'recall_only mode'),
		trackedTaskMode: requires(text, /`tracked_task`[\s\S]*tracekeeper\.start_task[\s\S]*tracekeeper\.finish_task/iu, 'tracked_task mode'),
		exactTaskId: requires(text, /real `task_id`[\s\S]*never invent/iu, 'real task_id continuity'),
		exactlyOnceFinish: requires(text, /After finish succeeds, never finish that task again/iu, 'terminal finish behavior'),
		permissionBoundary: requires(text, /Permission denied[\s\S]*permission bypass/iu, 'permission-denied recovery'),
		zeroMatchRecovery: requires(text, /Recall returns zero matches/iu, 'zero-match recovery'),
		structuredActions: requires(text, /structured `next_actions` AgentAction array/iu, 'structured recovery actions'),
		pendingReviewBoundary: requires(text, /Proposal pending[\s\S]*human review is pending/iu, 'pending proposal review'),
		instructionIsolation: requires(text, /untrusted knowledge data[\s\S]*disclose a token/iu, 'instruction isolation'),
	};
}

function report(closeoutStatus, codes = []) {
	return { type: 'assistant_report', closeout_status: closeoutStatus, codes };
}

function startEvents(scenario, taskId) {
	return [
		{ type: 'tool_call', tool: 'tracekeeper.start_task', args: { goal: scenario.prompt, ...(scenario.project_hint ? { project_hint: scenario.project_hint } : {}) } },
		{ type: 'tool_result', tool: 'tracekeeper.start_task', result: { task_id: taskId } },
	];
}

function recallEvents(scenario, result = { matches: [{ path: 'fixture/context.md' }] }) {
	return [
		{ type: 'tool_call', tool: 'tracekeeper.recall', args: { query: scenario.prompt, scope: scenario.project_hint ? 'project' : 'global' } },
		{ type: 'tool_result', tool: 'tracekeeper.recall', result },
	];
}

function noTrackTrace(scenario, codes = []) {
	return {
		scenario_id: scenario.id,
		classification: 'no_track',
		events: codes.length ? [report('', codes)] : [],
	};
}

function recallOnlyTrace(scenario, signals) {
	if (signals.proposalReview) {
		return {
			scenario_id: scenario.id,
			classification: 'recall_only',
			events: [
				{ type: 'tool_call', tool: 'tracekeeper.review_queue', args: {} },
				{ type: 'tool_result', tool: 'tracekeeper.review_queue', result: { proposals: [{ status: 'pending' }] } },
				report('', ['proposal_not_applied']),
			],
		};
	}
	const recallResult = signals.zeroMatch
		? { matches: [] }
		: signals.indexRebuilding
			? { matches: [], index_state: 'rebuilding' }
			: { matches: [{ path: 'fixture/context.md' }] };
	const codes = signals.zeroMatch
		? ['zero_match']
		: signals.scopeUncertain
			? ['scope_uncertain']
			: signals.indexRebuilding
				? ['index_rebuilding']
				: signals.promptInjection
					? ['prompt_injection_ignored']
					: [];
	return {
		scenario_id: scenario.id,
		classification: 'recall_only',
		events: [...recallEvents(scenario, recallResult), ...(codes.length ? [report('', codes)] : [])],
	};
}

function trackedTrace(scenario, signals) {
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
	const taskId = `task-${scenario.id}`;
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
	const prefix = [...startEvents(scenario, taskId), ...recallEvents(scenario)];
	if (signals.taskIdLost) {
		return {
			scenario_id: scenario.id,
			classification: 'tracked_task',
			events: [...prefix, report('', ['task_id_missing'])],
		};
	}
	const closeoutStatus = signals.permissionDenied || signals.idempotencyConflict
		? 'requires_user_action'
		: signals.proposalPending || signals.missingWikiBridge
			? 'queued'
			: 'recorded';
	const codes = signals.permissionDenied
		? ['permission_denied']
		: signals.idempotencyConflict
			? ['idempotency_conflict']
			: signals.proposalPending
				? ['proposal_not_applied']
				: signals.missingWikiBridge
					? ['missing_wiki_bridge']
					: [];
	const finishResult = closeoutStatus === 'requires_user_action'
		? { status: closeoutStatus, error: signals.permissionDenied ? 'permission denied' : 'idempotency conflict' }
		: { memory_closeout_status: closeoutStatus };
	return {
		scenario_id: scenario.id,
		classification: 'tracked_task',
		events: [
			...prefix,
			{ type: 'tool_call', tool: 'tracekeeper.finish_task', args: { task_id: taskId, summary: `Completed ${scenario.id}.` } },
			{ type: 'tool_result', tool: 'tracekeeper.finish_task', result: finishResult },
			report(closeoutStatus, codes),
		],
	};
}

export function buildCurrentSkillV2Trace(scenario, profile) {
	if (!profile?.noTrackMode || !profile.recallOnlyMode || !profile.trackedTaskMode) {
		throw new Error('A verified Skill v2 profile is required.');
	}
	const signals = promptSignals(scenario.prompt);
	if (signals.secretRequest) {
		return noTrackTrace(scenario, ['secret_refused']);
	}
	if (signals.directMemoryWrite || signals.capabilityEscalation) {
		return noTrackTrace(scenario, ['policy_refusal']);
	}
	const mode = classifySkillV2Prompt(scenario.prompt);
	if (mode === 'no_track') {
		return noTrackTrace(scenario);
	}
	if (mode === 'recall_only') {
		return recallOnlyTrace(scenario, signals);
	}
	return trackedTrace(scenario, signals);
}

export function buildCurrentSkillV2Traces(scenarios, sourceDocuments) {
	const profile = buildSkillV2Profile(sourceDocuments);
	return scenarios.map((scenario) => buildCurrentSkillV2Trace(scenario, profile));
}
