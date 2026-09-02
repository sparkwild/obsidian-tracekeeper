import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	LOCAL_TRUST_CAPABILITIES,
	LOCAL_TRUST_PRINCIPAL_ID,
	DEFAULT_MCP_PORT,
	McpJsonRpcHandler,
	StreamableHttpMcpRuntime,
	toolDefinitions,
} from '../dist/index.js';

const ACCEPTED_LOCAL_TRUST_TOOLS = [
	'tracekeeper.status',
	'tracekeeper.agent_activity_recent',
	'tracekeeper.lint',
	'tracekeeper.request_maintenance',
	'tracekeeper.recall',
	'tracekeeper.memory',
	'tracekeeper.read_note',
	'tracekeeper.start_task',
	'tracekeeper.finish_task',
	'tracekeeper.build_context_pack',
	'tracekeeper.source_request',
	'tracekeeper.capture_source',
	'tracekeeper.propose_memory',
];

const SERVICE_TOKEN = 'tracekeeper-runtime-test-token-0123456789abcdef';

function connectionState(sessionId) {
	return {
		sessionId,
		principalId: LOCAL_TRUST_PRINCIPAL_ID,
		credentialCapabilities: LOCAL_TRUST_CAPABILITIES,
		agentId: sessionId,
		clientName: null,
		clientVersion: null,
		observedClientType: 'unknown',
		initialized: false,
	};
}

async function initializeAndList(handler, clientName, clientVersion, sessionId) {
	const state = connectionState(sessionId);
	const initialize = await handler.handleMessage({
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: {
				name: clientName,
				version: clientVersion,
			},
		},
	}, state);
	const listed = await handler.handleMessage({
		jsonrpc: '2.0',
		id: 2,
		method: 'tools/list',
		params: {},
	}, state);
	return {
		initialize,
		state,
		toolNames: listed.result.tools.map((definition) => definition.name),
	};
}

function auditSections(vaultRoot) {
	const auditRoot = path.join(vaultRoot, '00_tracekeeper', 'control', 'agent_activity');
	const documents = [];
	if (fs.existsSync(auditRoot)) {
		for (const year of fs.readdirSync(auditRoot, { withFileTypes: true })) {
			if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) {
				continue;
			}
			const yearRoot = path.join(auditRoot, year.name);
			for (const file of fs.readdirSync(yearRoot, { withFileTypes: true })) {
				if (file.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) {
					documents.push(path.join(yearRoot, file.name));
				}
			}
		}
	}
	return documents
		.sort()
		.map((documentPath) => fs.readFileSync(documentPath, 'utf8'))
		.join('\n')
		.split('\n## ')
		.map((section) => section.trim())
		.filter(Boolean);
}

test('accepted local trust capabilities expose the exact fixed public surface', () => {
	assert.deepEqual(LOCAL_TRUST_CAPABILITIES, [
		'vault.read',
		'workflow.manage',
		'vault.write',
		'memory.propose',
	]);
	const toolNames = toolDefinitions(LOCAL_TRUST_CAPABILITIES)
		.map((definition) => definition.name);
	assert.deepEqual(toolNames, ACCEPTED_LOCAL_TRUST_TOOLS);
	assert.equal(toolDefinitions().length, 15);
	assert.equal(toolNames.includes('tracekeeper.review_queue'), false);
	assert.equal(toolNames.includes('tracekeeper.apply_approved_writeback'), false);
});

test('local MCP runtime keeps the shared default port in the 516xx namespace', () => {
	assert.equal(DEFAULT_MCP_PORT, 51601);
});

test('clientInfo remains an observation claim and cannot change the fixed tool surface', async () => {
	const handler = new McpJsonRpcHandler();
	const codex = await initializeAndList(handler, 'Codex', '9.9.9', 'session-codex');
	const spoofed = await initializeAndList(handler, 'Codex', 'spoofed', 'session-spoofed');
	const unknown = await initializeAndList(handler, 'unknown-local-client', '1.0.0', 'session-unknown');
	const gemini = await initializeAndList(handler, 'gemini-cli-mcp-client', '1.0.0', 'session-gemini');
	const grok = await initializeAndList(handler, 'grok-shell-tracekeeper', '1.0.0', 'session-grok');
	const zcode = await initializeAndList(handler, 'zcode', '1.0.0', 'session-zcode');

	assert.equal(codex.initialize.result.protocolVersion, '2025-06-18');
	assert.equal(codex.state.clientName, 'Codex');
	assert.equal(codex.state.clientVersion, '9.9.9');
	assert.equal(codex.state.observedClientType, 'codex');
	assert.equal(spoofed.state.clientName, 'Codex');
	assert.equal(unknown.state.clientName, 'unknown-local-client');
	assert.equal(gemini.state.observedClientType, 'gemini');
	assert.equal(grok.state.observedClientType, 'grok');
	assert.equal(zcode.state.observedClientType, 'zcode');
	assert.deepEqual(codex.toolNames, ACCEPTED_LOCAL_TRUST_TOOLS);
	assert.deepEqual(spoofed.toolNames, codex.toolNames);
	assert.deepEqual(unknown.toolNames, codex.toolNames);
	assert.deepEqual(gemini.toolNames, codex.toolNames);
	assert.deepEqual(grok.toolNames, codex.toolNames);
	assert.deepEqual(zcode.toolNames, codex.toolNames);
	assert.deepEqual(codex.state.credentialCapabilities, LOCAL_TRUST_CAPABILITIES);
	assert.deepEqual(spoofed.state.credentialCapabilities, LOCAL_TRUST_CAPABILITIES);
	assert.deepEqual(unknown.state.credentialCapabilities, LOCAL_TRUST_CAPABILITIES);
});

test('observed-client audit timestamps only successful initialize and tool use', async () => {
	const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-observed-client-'));
	try {
		const handler = new McpJsonRpcHandler({ defaultVaultRoot: vaultRoot });
		const { state } = await initializeAndList(handler, 'Codex CLI', '9.9.9', 'session-observed');
		let sections = auditSections(vaultRoot);
		const connection = sections.find((section) => section.includes('- type: "mcp.connection"'));
		assert.ok(connection);
		assert.match(connection, /- agent_activity_schema_version: 1/);
		assert.match(connection, /- observed_client_name_raw: "Codex CLI"/);
		assert.match(connection, /- observed_client_type: "codex"/);
		assert.match(connection, /- observed_client_version: "9.9.9"/);
		assert.match(connection, /- connected_at:/);
		assert.match(connection, /- result_status: "success"/);
		assert.doesNotMatch(connection, /- last_used_at:/);
		assert.doesNotMatch(connection, /- last_successful_tool:/);

		const successful = await handler.handleMessage({
			jsonrpc: '2.0',
			id: 3,
			method: 'tools/call',
			params: {
				name: 'tracekeeper.status',
				arguments: {},
			},
		}, state);
		assert.equal(successful.result.isError, false);

		const failed = await handler.handleMessage({
			jsonrpc: '2.0',
			id: 4,
			method: 'tools/call',
			params: {
				name: 'tracekeeper.read_note',
				arguments: {},
			},
		}, state);
		assert.equal(failed.result.isError, true);

		const unknown = await handler.handleMessage({
			jsonrpc: '2.0',
			id: 5,
			method: 'tools/call',
			params: {
				name: 'tracekeeper.not_a_real_tool',
				arguments: {},
			},
		}, state);
		assert.equal(unknown.result.isError, true);

		const invalidArguments = await handler.handleMessage({
			jsonrpc: '2.0',
			id: 6,
			method: 'tools/call',
			params: {
				name: 'tracekeeper.status',
				arguments: 'not-an-object',
			},
		}, state);
		assert.equal(invalidArguments.error.code, -32602);

		sections = auditSections(vaultRoot);
		const successfulUse = sections.find(
			(section) => section.includes('- tool_name: "tracekeeper.status"')
				&& section.includes('- result_status: "success"')
		);
		const failedUse = sections.find(
			(section) => section.includes('- tool_name: "tracekeeper.read_note"')
				&& section.includes('- result_status: "failed"')
		);
		assert.ok(successfulUse);
		assert.match(successfulUse, /- last_used_at:/);
		assert.match(successfulUse, /- last_successful_tool: "tracekeeper.status"/);
		assert.ok(failedUse);
		assert.doesNotMatch(failedUse, /- last_used_at:/);
		assert.doesNotMatch(failedUse, /- last_successful_tool:/);
		for (const reason of ['tool_call_unknown', 'tool_call_invalid_arguments']) {
			const rejectedUse = sections.find(
				(section) => section.includes('- type: "mcp.tool_call"')
					&& section.includes(`- diagnostic_reason: "${reason}"`)
			);
			assert.ok(rejectedUse);
			assert.doesNotMatch(rejectedUse, /- last_used_at:/);
			assert.doesNotMatch(rejectedUse, /- last_successful_tool:/);
		}
	} finally {
		fs.rmSync(vaultRoot, { recursive: true, force: true });
	}
});

test('local trust and its per-Agent credential verifier must be explicit', () => {
	assert.throws(
		() => new StreamableHttpMcpRuntime({
			host: '127.0.0.1',
			port: 0,
			credentialVerifier: { verifyBearer: async () => null },
			writebackConfirmationSecret: SERVICE_TOKEN,
		}),
		/requires explicit localTrust: true/
	);
	for (const credentialVerifier of [undefined, { verifyBearer: null }]) {
		assert.throws(
			() => new StreamableHttpMcpRuntime({
				localTrust: true,
				host: '127.0.0.1',
				port: 0,
				credentialVerifier,
				writebackConfirmationSecret: SERVICE_TOKEN,
			}),
			/credentialVerifier/i
		);
	}
	assert.throws(
		() => new StreamableHttpMcpRuntime({
			localTrust: true,
			host: '127.0.0.1',
			port: 0,
			credentialVerifier: { verifyBearer: async () => null },
		}),
		/writebackConfirmationSecret/i
	);
	const runtime = new StreamableHttpMcpRuntime({
		localTrust: true,
		host: '127.0.0.1',
		port: 0,
		credentialVerifier: { verifyBearer: async () => null },
		writebackConfirmationSecret: SERVICE_TOKEN,
	});
	assert.equal(runtime.getStatus().host, '127.0.0.1');
	assert.equal('credentialCount' in runtime.getStatus(), false);
	assert.equal(JSON.stringify(runtime.getStatus()).includes(SERVICE_TOKEN), false);
});

test('local trust rejects every bind address other than exact 127.0.0.1', () => {
	for (const host of ['0.0.0.0', 'localhost', '::1']) {
		assert.throws(
			() => new StreamableHttpMcpRuntime({
				localTrust: true,
				host,
				port: 0,
				credentialVerifier: { verifyBearer: async () => null },
				writebackConfirmationSecret: SERVICE_TOKEN,
			}),
			/requires host 127\.0\.0\.1/
		);
	}
});
