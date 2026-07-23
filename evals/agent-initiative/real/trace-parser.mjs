const CONNECTION_SIGNAL = /\b(401|403|network|connect|socket|timeout|unreachable|refused|econn|socket hang up|failed to connect)\b/i;

const CODE_MAP = {
	TASK_CONTEXT_REQUIRED: 'task_id_missing',
	TASK_CLOSEOUT_REQUIRED: 'proposal_not_applied',
	RECALL_EXCERPT_MAY_BE_INSUFFICIENT: 'scope_uncertain',
	RECALL_ZERO_MATCH: 'zero_match',
	INDEX_REBUILDING: 'index_rebuilding',
	PROJECT_SCOPE_UNCERTAIN: 'scope_uncertain',
	PERMISSION_DENIED: 'permission_denied',
	MEMORY_REVIEW_REQUIRED: 'proposal_not_applied',
	MEMORY_RECORDED: 'policy_refusal',
	USER_REVIEW_REQUIRED: 'proposal_not_applied',
	FINISH_ALREADY_COMPLETED: 'idempotency_conflict',
	IDEMPOTENCY_CONFLICT: 'idempotency_conflict',
	TOOL_UNAVAILABLE: 'tool_unavailable',
};

const CLOSEOUT_CANONICAL = {
	queued_for_review: 'queued',
	partially_auto_saved: 'auto_saved',
	auto_saved: 'auto_saved',
	disabled: 'ignored',
	no_candidates: 'ignored',
	conflict: 'requires_user_action',
	requires_wiki_bridge: 'requires_user_action',
	empty: 'ignored',
	requires_user_action: 'requires_user_action',
	recorded: 'recorded',
	queued: 'queued',
	ignored: 'ignored',
};

function splitLines(value) {
	if (typeof value !== 'string') {
		return [];
	}
	return value.split(/\r?\n/);
}

function normalizeText(value) {
	return typeof value === 'string' ? value.trim() : '';
}

function normalizeObject(value) {
	return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeCloseoutStatus(rawStatus) {
	if (!rawStatus || typeof rawStatus !== 'string') {
		return '';
	}
	return CLOSEOUT_CANONICAL[rawStatus] || rawStatus;
}

function addReportCode(target, code) {
	if (typeof code === 'string' && code.length > 0) {
		target.add(code);
	}
}

function addErrorCodes(target, message) {
	if (!message) {
		return;
	}
	const text = normalizeText(message).toLowerCase();
	if (/(permission denied|forbidden|unauthorized|not authorized)/i.test(text)) {
		addReportCode(target, 'permission_denied');
	}
	if (/(tool unavailable|unknown tool|not available|unregistered)/i.test(text)) {
		addReportCode(target, 'tool_unavailable');
	}
	if (/idempotency/i.test(text)) {
		addReportCode(target, 'idempotency_conflict');
	}
	if (CONNECTION_SIGNAL.test(text)) {
		addReportCode(target, 'mcp_unreachable');
	}
}

function addReasonCodesFromAction(action, reportCodes) {
	if (!normalizeObject(action)) {
		if (typeof action === 'string') {
			const reason = action.match(/reason_code\\s*[:=]\\s*([A-Z_]+)/i)?.[1];
			addReportCode(reportCodes, reason ? CODE_MAP[reason.toUpperCase()] : null);
		}
		return;
	}
	addReportCode(reportCodes, CODE_MAP[action.reason_code] || null);
	addErrorCodes(reportCodes, action.reason);
}

function toToolName(value) {
	const normalized = normalizeText(value);
	return normalized || null;
}

function toToolArgs(value) {
	return normalizeObject(value) ? value : {};
}

function toToolResult(value) {
	const object = normalizeObject(value);
	if (!object) {
		if (typeof value === 'string') {
			try {
				return normalizeObject(JSON.parse(value)) || { text: value };
			} catch {
				return { text: value };
			}
		}
		return {};
	}
	const structured = normalizeObject(object.structuredContent ?? object.structured_content);
	if (structured) {
		return structured;
	}
	if (Array.isArray(object.content)) {
		for (const entry of object.content) {
			if (entry?.type === 'text' && typeof entry.text === 'string') {
				try {
					const parsed = JSON.parse(entry.text);
					if (normalizeObject(parsed)) {
						return parsed;
					}
				} catch {
					// Keep the transport envelope when text is not structured JSON.
				}
			}
		}
	}
	return object;
}

function inferTool(record) {
	const tool = toToolName(record?.tool ?? record?.name ?? record?.tool_name ?? record?.function?.name);
	const server = toToolName(record?.server ?? record?.server_name);
	if (!tool) {
		return null;
	}
	if (tool.includes('.')) {
		return tool;
	}
	if (server) {
		return `${server}.${tool}`;
	}
	return tool;
}

function pushToolCall(container, events, reportCodes) {
	const tool = inferTool(container);
	if (!tool) {
		return false;
	}
	const args = toToolArgs(container?.arguments ?? container?.input ?? container?.args ?? container?.params);
	events.push({ type: 'tool_call', tool, args, server: container?.server ?? undefined });
	const nextActions = normalizeObject(container?.result)?.next_actions;
	if (Array.isArray(nextActions)) {
		for (const action of nextActions) {
			addReasonCodesFromAction(action, reportCodes);
		}
	}
	return true;
}

function pushToolResult(container, events, reportCodes) {
	const tool = inferTool(container);
	if (!tool) {
		return false;
	}
	const result = toToolResult(container?.result ?? container?.output ?? container?.response ?? container?.content);
	events.push({ type: 'tool_result', tool, result });
	if (normalizeObject(result) && typeof result.error === 'string') {
		addErrorCodes(reportCodes, result.error);
	}
	const mapped = normalizeCloseoutStatus(result?.memory_closeout_status ?? result?.memory_closeout_state ?? result?.status ?? '');
	if (mapped) {
		events.push({ type: 'assistant_report', closeout_status: mapped, codes: [] });
	}
	const nextActions = normalizeObject(result)?.next_actions;
	if (Array.isArray(nextActions)) {
		for (const action of nextActions) {
			addReasonCodesFromAction(action, reportCodes);
		}
	}
	const nextActionsForAgent = normalizeObject(result)?.next_actions_for_agent;
	if (Array.isArray(nextActionsForAgent)) {
		for (const action of nextActionsForAgent) {
			if (typeof action === 'string') {
				const match = action.match(/reason_code\\s*[:=]\\s*([A-Z_]+)/i);
				addReportCode(reportCodes, match?.[1] ? CODE_MAP[match[1]] : null);
			}
			if (normalizeObject(action)) {
				addReportCode(reportCodes, CODE_MAP[action.reason_code] || null);
			}
		}
	}
	addErrorCodes(reportCodes, result?.error || (normalizeObject(container)?.error && container.error.message));
	return true;
}

function collectMessage(value, messages) {
	if (!value) {
		return;
	}
	if (typeof value === 'string') {
		const text = normalizeText(value);
		if (text) {
			messages.push(text);
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			collectMessage(entry, messages);
		}
		return;
	}
	if (typeof value === 'object') {
		if (typeof value.content === 'string') {
			collectMessage(value.content, messages);
		}
		if (typeof value.message === 'string') {
			collectMessage(value.message, messages);
		}
		if (Array.isArray(value.content)) {
			for (const entry of value.content) {
				collectMessage(entry, messages);
			}
		}
	}
}

function parseMcpItemEvent(record, context) {
	const item = normalizeObject(record?.item);
	if (!item) {
		context.diagnostics.push({ type: 'unsupported_record', reason: 'mcp event missing item', record_type: record.type });
		context.unknownEventTypes[`item:${record.type}`] = (context.unknownEventTypes[`item:${record.type}`] || 0) + 1;
		addErrorCodes(context.reportCodes, 'tool unavailable');
		return;
	}
	if (item.type === 'agent_message') {
		collectMessage(item.text ?? item.content ?? item.message, context.messages);
		return;
	}
	if (item.type === 'command_execution') {
		return;
	}
	if (item.type !== 'mcp_tool_call') {
		context.diagnostics.push({ type: 'unsupported_record', reason: `unsupported item type ${item.type || 'none'}`, tool: item.tool || null });
		context.unknownEventTypes[`item_type:${item.type || 'none'}`] = (context.unknownEventTypes[`item_type:${item.type || 'none'}`] || 0) + 1;
		return;
	}
	const status = normalizeText(record?.status || item?.status);
	if (record.type === 'item.completed') {
		const itemId = item.id ? `${item.id}` : null;
		const shouldSkipCall = itemId && context.seenItemCallIds.has(itemId);
		if (!shouldSkipCall) {
			const pushedCall = pushToolCall(item, context.events, context.reportCodes);
			if (pushedCall && itemId) {
				context.seenItemCallIds.add(itemId);
			}
		}
		const isFailure = status === 'failed' || status === 'error' || item.error;
		if (!isFailure && item.result) {
			const pushedResult = pushToolResult(item, context.events, context.reportCodes);
			if (!pushedResult) {
				context.unknownEventTypes[`item:${record.type}`] = (context.unknownEventTypes[`item:${record.type}`] || 0) + 1;
			}
			return;
		}
		if (isFailure) {
			addErrorCodes(context.reportCodes, status);
			addErrorCodes(context.reportCodes, item.error?.message || item.error);
			pushToolResult({ ...item, result: { error: item.error?.message || item.error || status } }, context.events, context.reportCodes);
			return;
		}
		return;
	}
	if (record.type === 'item.failed' || status === 'failed' || status === 'error') {
		addErrorCodes(context.reportCodes, item?.error || record?.error || status);
		pushToolResult({ ...item, result: { error: item?.error?.message || item?.error || status } }, context.events, context.reportCodes);
		return;
	}
	if (!pushToolCall(item, context.events, context.reportCodes)) {
		context.unknownEventTypes[`item:${record.type}`] = (context.unknownEventTypes[`item:${record.type}`] || 0) + 1;
	}
	const itemId = item?.id ? `${item.id}` : null;
	if (itemId) {
		context.seenItemCallIds.add(itemId);
	}
}

function parseToolCall(record, context) {
	if (!pushToolCall(record, context.events, context.reportCodes)) {
		context.unknownEventTypes[`type:${record.type}`] = (context.unknownEventTypes[`type:${record.type}`] || 0) + 1;
	}
}

function parseToolResult(record, context) {
	if (!pushToolResult(record, context.events, context.reportCodes)) {
		context.unknownEventTypes[`type:${record.type}`] = (context.unknownEventTypes[`type:${record.type}`] || 0) + 1;
	}
}

function parseAssistantReport(record, context) {
	context.events.push({
		type: 'assistant_report',
		closeout_status: normalizeText(record.closeout_status ?? record.status ?? ''),
		codes: Array.isArray(record.codes) ? record.codes : [],
	});
}

function parseContentEntry(entry, context) {
	if (!entry || typeof entry !== 'object') {
		return;
	}
	if (entry.type === 'tool_call' || entry.type === 'tool-use' || entry.type === 'function') {
		parseToolCall(entry, context);
		return;
	}
	if (entry.type === 'tool_result') {
		parseToolResult(entry, context);
		return;
	}
	if (entry.type === 'assistant_report') {
		parseAssistantReport(entry, context);
		return;
	}
	if (entry.type === 'item.started' || entry.type === 'item.updated' || entry.type === 'item.completed') {
		parseMcpItemEvent(entry, context);
		return;
	}
	if (Array.isArray(entry.content)) {
		for (const nested of entry.content) {
			parseContentEntry(nested, context);
		}
	}
	if (Array.isArray(entry.tool_calls)) {
		for (const call of entry.tool_calls) {
			parseToolCall(call, context);
		}
	}
	if (Array.isArray(entry.tool_results)) {
		for (const callResult of entry.tool_results) {
			parseToolResult(callResult, context);
		}
	}
}

function parseRecord(record, context) {
	if (!record || typeof record !== 'object') {
		context.diagnostics.push({ type: 'invalid_record', value: record });
		return;
	}
	if (record.type === 'tool_call') {
		parseToolCall(record, context);
		return;
	}
	if (record.type === 'tool_result') {
		parseToolResult(record, context);
		return;
	}
	if (record.type === 'item.started' || record.type === 'item.updated' || record.type === 'item.completed' || record.type === 'item.failed') {
		parseMcpItemEvent(record, context);
		return;
	}
	if (record.type === 'assistant_report') {
		parseAssistantReport(record, context);
		return;
	}
	if (record.type === 'assistant' || record.type === 'message') {
		collectMessage(record.content ?? record.message, context.messages);
		if (Array.isArray(record.content)) {
			for (const entry of record.content) {
				parseContentEntry(entry, context);
			}
		}
		if (record.item) {
			parseContentEntry(record.item, context);
		}
		if (record.message) {
			parseRecord(record.message, context);
		}
		return;
	}
	if (record.type === 'behavior') {
		const name = normalizeText(record.name ?? record.behavior ?? record.event);
		if (name) {
			context.behaviors.push({ type: 'behavior', name });
			if (name === 'connection_check' && record.status === 'failed') {
				addReportCode(context.reportCodes, 'mcp_unreachable');
			}
		}
		return;
	}
	if (record.type === 'error' || record.type === 'turn.failed' || record.type === 'item.failed') {
		addErrorCodes(context.reportCodes, record.error?.message ?? record.message ?? record.error);
		return;
	}
	if (record.type === 'assistant_message' || record.type === 'final') {
		collectMessage(record.text ?? record.message ?? record.content, context.messages);
		if (record.choices && Array.isArray(record.choices)) {
			for (const choice of record.choices) {
				collectMessage(choice, context.messages);
			}
		}
		return;
	}
	if (
		record.type === 'thread.started' ||
		record.type === 'turn.started' ||
		record.type === 'turn.completed'
	) {
		return;
	}
	context.unknownEventTypes[`type:${record.type}`] = (context.unknownEventTypes[`type:${record.type}`] || 0) + 1;
	context.diagnostics.push({ type: 'unsupported_event_type', event_type: record.type });
}

function inferClassification(events, fallbackClass = 'no_track') {
	const toolCalls = new Set(
		events.filter((event) => event.type === 'tool_call').map((event) => event.tool),
	);
	if (
		toolCalls.has('tracekeeper.start_task') ||
		toolCalls.has('tracekeeper.finish_task') ||
		toolCalls.has('tracekeeper.apply_approved_writeback')
	) {
		return 'tracked_task';
	}
	if (toolCalls.has('tracekeeper.recall') || toolCalls.has('tracekeeper.review_queue')) {
		return 'recall_only';
	}
	return fallbackClass;
}

function canonicalizeCloseoutStatusFromCodesAndEvents(events, existingStatus) {
	if (existingStatus) {
		const normalized = normalizeCloseoutStatus(existingStatus);
		if (normalized) {
			return normalized;
		}
	}
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event.type === 'tool_result' && event.tool === 'tracekeeper.finish_task' && event.result) {
			const normalized = normalizeCloseoutStatus(
				event.result.memory_closeout_status ?? event.result.memory_closeout_state ?? event.result.status ?? '',
			);
			if (normalized) {
				return normalized;
			}
		}
	}
	return '';
}

export function parseCodexJsonl(raw) {
	if (typeof raw !== 'string' || raw.length === 0) {
		return [];
	}
	const records = [];
	for (const line of splitLines(raw)) {
		const text = normalizeText(line);
		if (!text) {
			continue;
		}
		try {
			records.push(JSON.parse(text));
		} catch {
			// non-json output is handled by parseToTraceEvents as diagnostics
		}
	}
	return records;
}

export function parseToTraceEvents(raw) {
	const text = typeof raw === 'string' ? raw : '';
	const records = parseCodexJsonl(text);
	const events = [];
	const behaviors = [];
	const reportCodes = new Set();
	const diagnostics = [];
	const messages = [];
	const unknownEventTypes = {};
	const seenItemCallIds = new Set();
	for (const record of records) {
		parseRecord(record, {
			events,
			behaviors,
			reportCodes,
			diagnostics,
			messages,
			unknownEventTypes,
			seenItemCallIds,
		});
	}
	for (const line of splitLines(text)) {
		const trimmed = normalizeText(line);
		if (!trimmed) {
			continue;
		}
		try {
			JSON.parse(trimmed);
		} catch {
			diagnostics.push({ type: 'non_json_stdout', text: trimmed });
		}
	}
	return {
		events: [...events, ...behaviors],
		reportCodes,
		diagnostics,
		unknownEventTypes,
		unknown_event_types: unknownEventTypes,
		final_agent_message: messages.at(-1) || '',
		finalAgentMessage: messages.at(-1) || '',
	};
}

export function normalizeCodexTrace(scenarioId, raw, options = {}) {
	const fallbackClass = options.fallbackClass || 'no_track';
	const parsed = parseToTraceEvents(raw);
	const events = parsed.events;
	const reportCodes = parsed.reportCodes;
	const reportEvents = events.filter((event) => event.type === 'assistant_report');
	const codes = new Set([...reportCodes]);
	for (const report of reportEvents) {
		for (const code of report.codes || []) {
			addReportCode(codes, code);
		}
	}

	const closeoutStatus = canonicalizeCloseoutStatusFromCodesAndEvents(events, reportEvents.at(-1)?.closeout_status);
	const mergedReport = {
		closeout_status: closeoutStatus,
		codes: Array.from(codes),
	};
	const reportSeen = events.find((event) => event.type === 'assistant_report');
	if (reportSeen) {
		reportSeen.codes = Array.from(new Set([...(reportSeen.codes || []), ...mergedReport.codes]));
		if (!reportSeen.closeout_status && mergedReport.closeout_status) {
			reportSeen.closeout_status = mergedReport.closeout_status;
		}
	} else if (codes.size > 0 || closeoutStatus) {
		events.push({ type: 'assistant_report', closeout_status: mergedReport.closeout_status, codes: mergedReport.codes });
	}

	return {
		scenario_id: scenarioId,
		classification: inferClassification(events, fallbackClass),
		events,
		diagnostics: parsed.diagnostics,
		unknown_event_types: Object.entries(parsed.unknown_event_types).map(([type, count]) => ({ type, count })),
		agent_message: parsed.finalAgentMessage || parsed.final_agent_message,
	};
}
