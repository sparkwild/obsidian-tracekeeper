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
		trackedTaskMode: requires(text, /`tracked_task`[\s\S]*closeout_only[\s\S]*tracekeeper\.start_task[\s\S]*tracekeeper\.finish_task/iu, 'tracked_task mode'),
		closeoutOnlyDefault: requires(text, /closeout_only[\s\S]{0,500}(?:ordinary default|default for an ordinary task|ordinary task)/iu, 'closeout-only default'),
		liveSelection: requires(text, /cross-session[\s\S]{0,500}interruption recovery[\s\S]{0,500}(?:intermediate|task-linked)/iu, 'live recording selection'),
		startUnavailable: requires(text, /start_unavailable[\s\S]{0,400}start_idempotency_key/iu, 'unknown-start recovery'),
		immediateTiming: requires(text, /`immediate`/iu, 'immediate next_action timing'),
		contextInsufficientTiming: requires(text, /if_context_insufficient/iu, 'if_context_insufficient next_action timing'),
		closeoutTiming: requires(text, /at_task_closeout/iu, 'at_task_closeout next_action timing'),
		requiredTimingSemantics: requires(text, /required:\s*true|required actions/iu, 'required next_action timing semantics'),
		exactTaskId: requires(text, /real `task_id`[\s\S]*never invent/iu, 'real task_id continuity'),
		exactlyOnceFinish: requires(text, /After finish succeeds, never finish that task again/iu, 'terminal finish behavior'),
		permissionBoundary: requires(text, /Permission denied[\s\S]*permission bypass/iu, 'permission-denied recovery'),
		zeroMatchRecovery: requires(text, /Recall returns zero matches/iu, 'zero-match recovery'),
		structuredActions: requires(text, /structured `next_actions` AgentAction array/iu, 'structured recovery actions'),
		relationEvidenceConstraints: requires(text, /relation_evidence\.related_wiki|relation_evidence\.related_sources/i, 'relation evidence constraints'),
		correlatedReadNote: requires(text, /correlated\s+(?:`?note`?|`?read_note`?)/i, 'closeout reuse from correlated note evidence'),
		pendingReviewBoundary: requires(text, /Proposal pending[\s\S]*human review is pending/iu, 'pending proposal review'),
		instructionIsolation: requires(text, /untrusted knowledge data[\s\S]*disclose a token/iu, 'instruction isolation'),
		projectRecallRouting: requires(text, /known project[\s\S]*first knowledge Recall[\s\S]*scope:\s*"project"[\s\S]*repo_path/iu, 'known-project Recall routing'),
		recallOnlyRouteGuard: requires(text, /recall_only[\s\S]*never start[\s\S]*scope:\s*"global"[\s\S]*scope:\s*"project_history"/iu, 'recall_only route guard'),
		trackedRecallRouting: requires(text, /(?:live `?tracked_task`?|live tracking)[\s\S]*start first[\s\S]*(?:next_actions|recommended_recall)/iu, 'live tracked-task Recall routing'),
		operationSpecificKeys: requires(text, /One idempotency key replays only the same logical operation/iu, 'operation-specific idempotency keys'),
		explicitMemoryScope: requires(text, /MemoryRecord candidate declares\s*`memory_scope/iu, 'explicit MemoryRecord scope'),
		wikiReviewOnly: requires(text, /Wiki changes always enter review/iu, 'review-only Wiki routing'),
		scopeAuto: requires(text, /Global and Project Auto are fully supported/iu, 'Global and Project Auto support'),
		optionalRelations: requires(text, /Wiki and Source relations are optional/iu, 'optional Wiki and Source relations'),
		globalHubRepair: requires(text, /missing or invalid canonical Global Memory Hub[\s\S]*structure-repair/iu, 'Global Memory Hub repair recovery'),
		projectHubAuto: requires(text, /Project Auto[\s\S]{0,300}exclusively create[\s\S]{0,200}missing canonical project Hub[\s\S]{0,200}exact repository identity/iu, 'exact Project Auto Hub creation'),
	};
}

function report(closeoutStatus, codes = []) {
	return { type: 'assistant_report', closeout_status: closeoutStatus, codes };
}

function startEvents(scenario, taskId) {
	return [
		{ type: 'tool_call', tool: 'tracekeeper.start_task', args: {
			goal: scenario.prompt,
			idempotency_key: `start-${scenario.id}`,
			...(scenario.project_hint ? { project_hint: scenario.project_hint } : {}),
			...(scenario.repo_path ? { repo_path: scenario.repo_path } : {}),
		} },
		{ type: 'tool_result', tool: 'tracekeeper.start_task', result: { task_id: taskId } },
	];
}

function recallEvents(scenario, result = { matches: [{ path: 'fixture/context.md' }] }) {
	return [
		{ type: 'tool_call', tool: 'tracekeeper.recall', args: {
			query: scenario.prompt,
			scope: scenario.repo_path || scenario.project_hint ? 'project' : 'global',
			...(scenario.repo_path ? { repo_path: scenario.repo_path } : {}),
			...(scenario.project_hint ? { project_hint: scenario.project_hint } : {}),
		} },
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
	const startedAt = '2026-08-21T00:00:00.000Z';
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
	if (signals.startResultUnknown) {
		const startKey = `start-${scenario.id}`;
		return {
			scenario_id: scenario.id,
			classification: 'tracked_task',
			events: [
				{ type: 'tool_call', tool: 'tracekeeper.start_task', args: {
					goal: scenario.prompt,
					started_at: startedAt,
					idempotency_key: startKey,
				} },
				{ type: 'tool_result', tool: 'tracekeeper.start_task', result: { error: 'transport outcome unknown' } },
				{ type: 'tool_call', tool: 'tracekeeper.finish_task', args: {
					goal: scenario.prompt,
					started_at: startedAt,
					recording_reason: 'start_unavailable',
					start_idempotency_key: startKey,
					status: 'completed',
					summary: `Completed ${scenario.id}.`,
					idempotency_key: `finish-${scenario.id}`,
				} },
				{ type: 'tool_result', tool: 'tracekeeper.finish_task', result: { memory_closeout_status: 'recorded', start_recovery: 'matched' } },
				report('recorded', ['start_recovered']),
			],
		};
	}
	if (signals.ordinaryCloseout) {
		return {
			scenario_id: scenario.id,
			classification: 'tracked_task',
			events: [
				...recallEvents(scenario),
				{ type: 'tool_call', tool: 'tracekeeper.finish_task', args: {
					goal: scenario.prompt,
					started_at: startedAt,
					status: 'completed',
					summary: `Completed ${scenario.id}.`,
					idempotency_key: `finish-${scenario.id}`,
				} },
				{ type: 'tool_result', tool: 'tracekeeper.finish_task', result: { memory_closeout_status: 'recorded', tracking_mode: 'closeout_only', task_id: taskId } },
				report('recorded'),
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
		: signals.proposalPending || signals.missingMemoryHub
			? 'queued'
			: 'recorded';
	const codes = signals.permissionDenied
		? ['permission_denied']
		: signals.idempotencyConflict
			? ['idempotency_conflict']
			: signals.proposalPending
				? ['proposal_not_applied']
				: signals.missingMemoryHub
					? ['missing_memory_hub', 'structure_repair_required']
					: [];
	const finishResult = closeoutStatus === 'requires_user_action'
		? { status: closeoutStatus, error: signals.permissionDenied ? 'permission denied' : 'idempotency conflict' }
		: { memory_closeout_status: closeoutStatus };
	return {
		scenario_id: scenario.id,
		classification: 'tracked_task',
		events: [
			...prefix,
			{ type: 'tool_call', tool: 'tracekeeper.finish_task', args: {
				task_id: taskId,
				summary: `Completed ${scenario.id}.`,
				idempotency_key: `finish-${scenario.id}`,
			} },
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
