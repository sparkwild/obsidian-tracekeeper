import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCodexTrace, parseCodexJsonl, parseToTraceEvents } from './trace-parser.mjs';

test('parseCodexJsonl skips invalid JSON lines and keeps valid records', () => {
	const raw = [
		'{"type":"tool_call","tool":"tracekeeper.start_task"}',
		'not-a-json',
		'{"type":"tool_result","tool":"tracekeeper.start_task","result":{"task_id":"task-1"}}',
		'',
	].join('\n');
	const records = parseCodexJsonl(raw);
	assert.equal(records.length, 2);
	assert.equal(records[0].type, 'tool_call');
	assert.equal(records[1].type, 'tool_result');
});

test('normalizeCodexTrace builds tracked_task events and derives closeout status', () => {
	const raw = [
		'{"type":"tool_call","tool":"tracekeeper.start_task","arguments":{"goal":"Do task"}}',
		'{"type":"tool_result","tool":"tracekeeper.start_task","result":{"task_id":"task-1"}}',
		'{"type":"tool_call","tool":"tracekeeper.recall","arguments":{"query":"history","scope":"project"}}',
		'{"type":"tool_result","tool":"tracekeeper.recall","result":{"matches":[]}}',
		'{"type":"tool_call","tool":"tracekeeper.finish_task","arguments":{"task_id":"task-1","summary":"Done"}}',
		'{"type":"tool_result","tool":"tracekeeper.finish_task","result":{"memory_closeout_status":"recorded"}}',
	].join('\n');
	const trace = normalizeCodexTrace('real-track-basic', raw, { fallbackClass: 'tracked_task' });
	assert.equal(trace.scenario_id, 'real-track-basic');
	assert.equal(trace.classification, 'tracked_task');
	const tools = trace.events.filter((event) => event.type === 'tool_call').map((event) => event.tool);
	assert.deepEqual(tools, ['tracekeeper.start_task', 'tracekeeper.recall', 'tracekeeper.finish_task']);
	const report = trace.events.find((event) => event.type === 'assistant_report');
	assert.equal(report.closeout_status, 'recorded');
});

test('normalizeCodexTrace parses MCP item.started/item.completed envelopes', () => {
	const raw = [
		'{"item":{"type":"mcp_tool_call","id":"1","server":"tracekeeper","tool":"start_task","arguments":{"goal":"Trace continuity"}},"type":"item.started"}',
		'{"item":{"type":"mcp_tool_call","id":"1","server":"tracekeeper","tool":"start_task","result":{"structuredContent":{"task_id":"task-1"}},"arguments":{"goal":"Trace continuity"}},"type":"item.completed"}',
		'{"item":{"type":"mcp_tool_call","id":"2","server":"tracekeeper","tool":"finish_task","arguments":{"task_id":"task-1","summary":"done","related_wiki":["wiki/project.md"],"related_sources":["source/design.md"]},"result":{"content":[{"type":"text","text":"{\\"memory_closeout_status\\":\\"recorded\\"}" }]}},"type":"item.completed"}',
		'{"item":{"type":"agent_message","id":"3","text":"Finished once."},"type":"item.completed"}',
	].join('\n');
	const trace = normalizeCodexTrace('real-track-mcp', raw, { fallbackClass: 'tracked_task' });
	const tools = trace.events.filter((event) => event.type === 'tool_call').map((event) => event.tool);
	assert.deepEqual(tools, ['tracekeeper.start_task', 'tracekeeper.finish_task']);
	const finish = trace.events.find((event) => event.type === 'tool_result' && event.tool === 'tracekeeper.finish_task');
	assert.equal(finish?.result?.memory_closeout_status, 'recorded');
	const report = trace.events.find((event) => event.type === 'assistant_report');
	assert.equal(report.closeout_status, 'recorded');
	assert.equal(trace.agent_message, 'Finished once.');
});

test('parseToTraceEvents captures unknown event types and non-json lines', () => {
	const raw = [
		'{"type":"assistant_message","message":"hi"}',
		'{"type":"item.completed","item":{"id":"cmd-1","type":"command_execution","status":"completed"}}',
		'not-json-line',
		'{"type":"tracekeeper.custom","foo":"bar"}',
	].join('\n');
	const parsed = parseToTraceEvents(raw);
	assert.ok(parsed.diagnostics.some((entry) => entry.type === 'non_json_stdout'));
	assert.ok(parsed.unknownEventTypes['type:tracekeeper.custom']);
	assert.equal(parsed.unknownEventTypes['item_type:command_execution'], undefined);
	assert.equal(parsed.final_agent_message, parsed.finalAgentMessage);
	const final = parsed.final_agent_message;
	assert.equal(final, 'hi');
});

test('normalizeCodexTrace does not borrow an expected tracked classification when no tool was observed', () => {
	const trace = normalizeCodexTrace('missing-tools', '{"type":"turn.completed"}');
	assert.equal(trace.classification, 'no_track');
	assert.deepEqual(trace.events, []);
});
