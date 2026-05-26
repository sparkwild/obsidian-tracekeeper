#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { StreamableHttpMcpRuntime } = require('../dist/http-runtime.js');

function writeNote(vaultRoot, relativePath, content) {
	const target = path.join(vaultRoot, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content, 'utf8');
	return target;
}

function decodeResponse(line) {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

function readAuditLog(vaultRoot) {
	return fs.readFileSync(path.join(vaultRoot, '00_tracekeeper/control/audit_log.md'), 'utf8');
}

function countReviewQueueFiles(vaultRoot) {
	const queuePath = path.join(vaultRoot, '00_tracekeeper', 'inbox', 'review_queue');
	if (!fs.existsSync(queuePath)) {
		return 0;
	}
	return fs.readdirSync(queuePath).filter((entry) => entry.endsWith('.md')).length;
}

function hasSectionWithValues(log, linesToMatch) {
	return linesToMatch.every((needle) => log.includes(needle));
}

function assertToolCallEvent(log, toolName, status) {
	const found = hasToolCallSection(log, toolName, status);
	assert.ok(found, `tool-call event expected for ${toolName} with status ${status}`);
}

function hasToolCallSection(log, toolName, status, extraNeedles = []) {
	const quotedToolName = JSON.stringify(toolName);
	const quotedStatus = JSON.stringify(status);
	const sections = log.split('\n## ').map((entry) => entry.trim());
	for (const section of sections) {
		if (!section) {
			continue;
		}
		const hasType = section.includes('- type: tool-call');
		const hasTool =
			section.includes(`- tool_name: ${toolName}`) || section.includes(`- tool_name: ${quotedToolName}`);
		const hasStatus =
			section.includes(`- result_status: ${status}`) || section.includes(`- result_status: ${quotedStatus}`);
		const extraMatch = extraNeedles.every((needle) => section.includes(needle));
		if (hasType && hasTool && hasStatus && extraMatch) {
			return true;
		}
	}
	return false;
}

function assertContainsNoSensitiveText(log, values) {
	for (const value of values) {
		assert.ok(!log.includes(value), `sensitive value should not appear in audit: ${value}`);
	}
}

class McpTestClient {
	constructor(vaultRoot, vaultConfigDir, options = {}) {
		this.vaultRoot = vaultRoot;
		this.vaultConfigDir = vaultConfigDir;
		this.token = 'tracekeeper-smoke-token';
		this.nextId = 1;
		this.sessionId = '';
		this.options = options;
	}

	async start() {
		this.runtime = new StreamableHttpMcpRuntime({
			host: '127.0.0.1',
			port: 0,
			token: this.token,
			defaultVaultRoot: this.vaultRoot,
			vaultConfigDir: this.vaultConfigDir,
			memoryRules: this.options.memoryRules,
		});
		const status = await this.runtime.start();
		this.endpoint = `${status.endpoint}?token=${encodeURIComponent(this.token)}`;
	}

	async call(method, params = {}) {
		const id = this.nextId;
		this.nextId += 1;
		const payload = {
			jsonrpc: '2.0',
			id,
			method,
			params,
		};

		const headers = {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		};
		if (this.sessionId) {
			headers['mcp-session-id'] = this.sessionId;
		}
		const response = await fetch(this.endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
		});
		if (method === 'initialize') {
			this.sessionId = response.headers.get('mcp-session-id') || '';
			assert.ok(this.sessionId, 'initialize should return Mcp-Session-Id');
		}
		const json = await response.json();
		const structured = buildStructured(json.result);
		if (json.error) {
			throw new Error(json.error.message || `JSON-RPC error for ${method}`);
		}
		if (json.result && json.result.isError) {
			throw new Error(json.result.structuredContent?.error || `Tool error for ${method}`);
		}
		if (structured && structured.isError) {
			throw new Error(structured.error || `Tool error for ${method}`);
		}
		if (!json.result) {
			throw new Error(`Missing result for ${method} #${id}`);
		}
		return json.result;
	}

	async expectHttpStatus({ token = this.token, origin = '', sessionId = this.sessionId, method = 'tools/list', status }) {
		const endpoint = `${this.runtime.getStatus().endpoint}?token=${encodeURIComponent(token)}`;
		const headers = {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		};
		if (origin) {
			headers.origin = origin;
		}
		if (sessionId) {
			headers['mcp-session-id'] = sessionId;
		}
		const response = await fetch(endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: this.nextId++,
				method,
				params: {},
			}),
		});
		assert.equal(response.status, status);
		return response;
	}

	async assertEventStream() {
		const response = await fetch(this.endpoint, {
			method: 'GET',
			headers: {
				accept: 'text/event-stream',
				'mcp-session-id': this.sessionId,
			},
		});
		assert.equal(response.status, 200);
		assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
		await response.body?.cancel();
	}

	async deleteSession() {
		const response = await fetch(this.endpoint, {
			method: 'DELETE',
			headers: {
				'mcp-session-id': this.sessionId,
			},
		});
		assert.equal(response.status, 204);
	}

	close() {
		return this.runtime ? this.runtime.stop() : Promise.resolve();
	}
}

function buildStructured(result) {
	if (result && typeof result === 'object' && result.structuredContent && typeof result.structuredContent === 'object') {
		return result.structuredContent;
	}
	return result;
}

function ensureToolNames(result, names) {
	const toolList = (buildStructured(result).tools || []).map((tool) => tool.name);
	for (const expected of names) {
		assert.ok(toolList.includes(expected), `Missing MCP tool: ${expected}`);
	}
	return toolList;
}

async function main() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-mcp-smoke-'));
	const vaultRoot = path.join(tempRoot, 'vault');
	const vaultConfigDir = 'vault-config';
	const fixturePath = path.join(vaultRoot, '00_tracekeeper', 'inbox', 'agent_requests', 'local-source-request.md');
	const lintFixturePath = path.join(vaultRoot, '01_knowledge', 'wiki', 'concepts', 'smoke-lint-fixture.md');
	const client = new McpTestClient(vaultRoot, vaultConfigDir);

	try {
		if (!fs.existsSync(path.join(process.cwd(), 'dist', 'server.js'))) {
			throw new Error('dist/server.js not found. Run npm run build first.');
		}
		assert.throws(
			() => new StreamableHttpMcpRuntime({ host: '127.0.0.1', port: 0, defaultVaultRoot: vaultRoot }),
			/MCP Runtime token is required/
		);
		const devRuntime = new StreamableHttpMcpRuntime({
			host: '127.0.0.1',
			port: 0,
			defaultVaultRoot: vaultRoot,
			vaultConfigDir,
			allowMissingTokenForDev: true,
		});
		const devStatus = await devRuntime.start();
		assert.equal(devStatus.state, 'running');
		await devRuntime.stop();

		fs.mkdirSync(vaultRoot, { recursive: true });
		writeNote(vaultRoot, `${vaultConfigDir}/config.md`, '# Config\n');
		writeNote(vaultRoot, '00_tracekeeper/control/system.md', '# System\n');
		writeNote(vaultRoot, '00_tracekeeper/control/audit_log.md', '# Audit Log\n');
		writeNote(vaultRoot, '01_knowledge/index.md', '# Knowledge Index\n\n- [[memory/index]]\n- [[wiki/index]]\n- [[sources/index]]\n');
		writeNote(vaultRoot, '01_knowledge/memory/index.md', '# Memory Index\n\n- [[projects/index]]\n');
		writeNote(vaultRoot, '01_knowledge/memory/projects/index.md', '# Project Memory Index\n\n- [[demo/index]]\n');
		writeNote(vaultRoot, '01_knowledge/wiki/index.md', '# Wiki Index\n\n- [[hubs/index]]\n- [[concepts/smoke-lint-fixture]]\n');
		writeNote(vaultRoot, '01_knowledge/wiki/hubs/index.md', '# Wiki Hubs\n\n- [[smoke-hub]]\n');
		writeNote(vaultRoot, '01_knowledge/sources/index.md', '# Sources Index\n\n- [[local-source]]\n');
		writeNote(vaultRoot, '01_knowledge/memory/projects/demo/index.md', [
			'---',
			'type: project_memory_index',
			'project_hint: demo',
			'related_wiki: [01_knowledge/wiki/hubs/smoke-hub.md]',
			'---',
			'# Demo Project Memory',
			'',
			'## Related wiki',
			'- [[01_knowledge/wiki/hubs/smoke-hub|Smoke Graph Hub]]',
		].join('\n'));
		writeNote(vaultRoot, '01_knowledge/memory/projects/demo/memory.md', [
			'---',
			'type: memory',
			'project_hint: demo',
			'related_wiki: [01_knowledge/wiki/hubs/smoke-hub.md]',
			'---',
			'# Demo Project Memory Log',
			'',
			'## Graph links',
			'- [[01_knowledge/wiki/hubs/smoke-hub|Smoke Graph Hub]]',
			'',
			'Initial project memory.',
		].join('\n'));
		writeNote(vaultRoot, '00_tracekeeper/inbox/agent_requests/local-source-request.md', [
			'---',
			'type: agent-request',
			'source: 01_knowledge/sources/local-source.md',
			'sourceKind: local_file',
			'status: pending',
			'purpose: smoke test',
			'analysis_mode: default',
			'---',
			'',
			'## Selected Text',
			'Source request body used for deterministic smoke flow.',
			'',
		].join('\n'));
		writeNote(vaultRoot, '00_tracekeeper/inbox/review_queue/approved-writeback.md', [
			'---',
			'type: memory-proposal',
			'proposal_id: prop_smoke_apply',
			'proposal_kind: project_update',
			'approval_status: approved',
			'target_note: 01_knowledge/memory/projects/demo/memory.md',
			'risk_level: medium',
			'---',
			'',
			'# Approved Writeback Proposal',
			'',
			'## Writeback',
			'',
			'- Runtime-approved memory from smoke test.',
			'',
		].join('\n'));
		writeNote(vaultRoot, '01_knowledge/sources/local-source.md', '# Source\n\nThis is source content for mcp smoke source-analysis test.');
		writeNote(vaultRoot, '01_knowledge/wiki/hubs/smoke-hub.md', [
			'# Smoke Graph Hub',
			'',
			'## Related memory',
			'- [[01_knowledge/memory/projects/demo/memory|Demo memory]]',
			'',
			'[[01_knowledge/wiki/concepts/smoke-lint-fixture|Smoke Lint Fixture]]',
			'',
		].join('\n'));
		writeNote(vaultRoot, '01_knowledge/wiki/concepts/smoke-lint-fixture.md', [
			'# Smoke Lint Fixture',
			'This note references [[smoke_missing_page]] and [[01_knowledge/memory/projects/demo/memory|demo memory]] for path resolution.',
			'',
			'',
			'> [!claim]',
			'> This is a claim that should require source refs.',
			'',
		].join('\n'));
		assert.ok(fs.existsSync(lintFixturePath), 'lint fixture created');

		await client.start();

		const initialize = await client.call('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: {
				name: 'tracekeeper-smoke',
				version: '0.1.7',
			},
		});
		assert.equal(initialize.capabilities.tools.listChanged, false);
		await client.expectHttpStatus({ token: 'wrong-token', status: 401 });
		const forbiddenOrigin = await client.expectHttpStatus({ origin: 'https://example.com', status: 403 });
		assert.equal(forbiddenOrigin.headers.get('access-control-allow-origin'), null);
		const allowedOrigin = await client.expectHttpStatus({ origin: 'http://localhost:3210', status: 200 });
		assert.equal(allowedOrigin.headers.get('access-control-allow-origin'), 'http://localhost:3210');
		await client.expectHttpStatus({ sessionId: '', status: 400 });
		await client.assertEventStream();
		const initAudit = readAuditLog(vaultRoot);
		assert.ok(hasSectionWithValues(initAudit, ['- type: connection', '- event: connection', '- agent_id:']));
		assert.ok(hasSectionWithValues(initAudit, ['- session_id:']));
		assert.ok(hasSectionWithValues(initAudit, ['- timestamp:']));
		assert.ok(hasSectionWithValues(initAudit, ['- transport: "streamable-http"']));

		const tools = await client.call('tools/list');
		const listedTools = ensureToolNames(tools, [
			'tracekeeper.status',
			'tracekeeper.lint',
			'tracekeeper.recall',
			'tracekeeper.read_note',
			'tracekeeper.start_task',
			'tracekeeper.finish_task',
			'tracekeeper.build_context_pack',
			'tracekeeper.review_queue',
			'tracekeeper.apply_approved_writeback',
			'tracekeeper.source_request',
			'tracekeeper.capture_source',
			'tracekeeper.propose_memory',
		]);
		assert.equal(listedTools.length, 12, 'tools/list should expose only the reduced public toolset');
		for (const hiddenTool of [
			'tracekeeper.graph_health',
			'tracekeeper.project_context',
			'tracekeeper.project_history',
			'tracekeeper.list_review_queue',
			'tracekeeper.list_source_requests',
			'tracekeeper.list_approved_writebacks',
			'tracekeeper.audit_recent',
			'tracekeeper.distill_session',
			'tracekeeper.write_context_pack',
			'tracekeeper.write_session_note',
			'tracekeeper.analyze_source_request',
		]) {
			assert.equal(listedTools.includes(hiddenTool), false, `Deprecated MCP tool should not be public: ${hiddenTool}`);
		}

		const resources = await client.call('resources/list');
		assert.ok((buildStructured(resources).resources || []).length > 0, 'resources/list should return resources');

		const prompts = await client.call('prompts/list');
		assert.ok((buildStructured(prompts).prompts || []).length > 0, 'prompts/list should return prompts');

		const status = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.status',
			arguments: {},
		}));
		assert.equal(status.ok, true);
		assert.equal(typeof status.counts.notes === 'number', true);
		const graphHealth = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.graph_health',
			arguments: {},
		}));
		assert.equal(graphHealth.ok, true);
		assert.equal(graphHealth.profile, 'advisory');
		assert.equal(graphHealth.disabled, false);
		assert.equal(Array.isArray(graphHealth.profile_issues), true);
		assert.ok(graphHealth.profile_issues.some((issue) => issue.severity === 'warning'));
		assert.equal(typeof graphHealth.note_count, 'number');
		assert.equal(typeof graphHealth.wikilink_edge_count, 'number');
		assert.equal(Array.isArray(graphHealth.unresolved_edges), true);
		assert.equal(typeof graphHealth.resolved_edge_count, 'number');
		assert.equal(typeof graphHealth.unresolved_edge_count, 'number');
		assert.equal(graphHealth.resolved_edge_count > 0, true);
		assert.equal(
			graphHealth.wikilink_edge_count,
			graphHealth.resolved_edge_count + graphHealth.unresolved_edge_count
		);
		assert.equal(Array.isArray(graphHealth.isolated_nodes), true);
		assert.equal(Array.isArray(graphHealth.only_inbound_nodes), true);
		assert.equal(Array.isArray(graphHealth.only_outbound_nodes), true);
		assert.equal(Array.isArray(graphHealth.hub_candidates), true);
		assert.equal(graphHealth.hub_candidates.length > 0, true);
		if (graphHealth.hub_candidates.length > 0) {
			assert.equal(typeof graphHealth.hub_candidates[0].path, 'string');
			assert.equal(typeof graphHealth.hub_candidates[0].degree, 'number');
			assert.equal(typeof graphHealth.hub_candidates[0].inbound, 'number');
			assert.equal(typeof graphHealth.hub_candidates[0].outbound, 'number');
		}
		assert.equal(Array.isArray(graphHealth.recommendations), true);

		const disabledGraphHealth = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.graph_health',
			arguments: {
				graph_profile: 'off',
			},
		}));
		assert.equal(disabledGraphHealth.ok, true);
		assert.equal(disabledGraphHealth.profile, 'off');
		assert.equal(disabledGraphHealth.disabled, true);
		assert.deepEqual(disabledGraphHealth.profile_issues, []);

		const strictGraphHealth = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.graph_health',
			arguments: {
				graph_profile: 'strict',
				max_items: 5,
			},
		}));
		assert.equal(strictGraphHealth.ok, true);
		assert.equal(strictGraphHealth.profile, 'strict');
		assert.ok(strictGraphHealth.profile_issues.some((issue) => issue.severity === 'error'));

		const limitedGraphHealth = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.graph_health',
			arguments: {
				max_items: 1,
			},
		}));
		assert.equal(limitedGraphHealth.ok, true);
		assert.equal(limitedGraphHealth.isolated_nodes.length <= 1, true);
		assert.equal(limitedGraphHealth.hub_candidates.length <= 1, true);
		assert.equal(limitedGraphHealth.only_inbound_nodes.length <= 1, true);
		assert.equal(limitedGraphHealth.only_outbound_nodes.length <= 1, true);
		assert.equal(limitedGraphHealth.recommendations.length <= 1, true);

		const readNote = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.read_note',
			arguments: { path: '00_tracekeeper/control/system.md' },
		}));
		assert.equal(readNote.ok, true);
		assert.equal(readNote.path, '00_tracekeeper/control/system.md');
		const afterReadAudit = readAuditLog(vaultRoot);
		assertToolCallEvent(afterReadAudit, 'tracekeeper.read_note', 'success');

		await assert.rejects(
			() =>
				client.call('tools/call', {
					name: 'tracekeeper.read_note',
					arguments: { path: `${vaultConfigDir}/config.md` },
				}),
			/Obsidian configuration paths are not allowed/,
			'should reject reads from the configured Obsidian settings directory'
		);

		const sensitiveText = 'SENSITIVE_TOKEN_123ABC456DEF';
		const startTask = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.start_task',
			arguments: {
				goal: 'Smoke sensitive summary',
				client: 'agent-smoke',
				api_key: sensitiveText,
				authorization: `Bearer ${sensitiveText}`,
				secret: `secret_${sensitiveText}`,
				password: `pwd_${sensitiveText}`,
				cookie: `cookie=${sensitiveText}`,
				token: `token_${sensitiveText}`,
				project_hint: 'demo',
			},
		}));
		assert.equal(startTask.ok, true);
		assert.equal(startTask.read_only, false);
		assert.ok(startTask.task_id, 'start_task should return task_id');
		assert.ok(startTask.path, 'start_task should return task path');
		assert.ok(fs.existsSync(path.join(vaultRoot, startTask.path)));
		const taskId = startTask.task_id;
		const activeTaskText = fs.readFileSync(path.join(vaultRoot, startTask.path), 'utf8');
		assert.ok(activeTaskText.includes('status: "active"'));
		assert.ok(activeTaskText.includes(`task_id: "${taskId}"`));
		assert.ok(activeTaskText.includes('project_hint: "demo"'));

		const afterSensitiveAudit = readAuditLog(vaultRoot);
		assertToolCallEvent(afterSensitiveAudit, 'tracekeeper.start_task', 'success');
		assert.ok(
			hasToolCallSection(afterSensitiveAudit, 'tracekeeper.start_task', 'success', [
				'- session_id:',
				'- client_name: "tracekeeper-smoke"',
				'- transport: "streamable-http"',
			]),
			'start_task audit should include session/client/transport'
		);
		assertContainsNoSensitiveText(afterSensitiveAudit, [
			sensitiveText,
			`secret_${sensitiveText}`,
			`pwd_${sensitiveText}`,
			`cookie=${sensitiveText}`,
			`token_${sensitiveText}`,
		]);
		assert.ok(
			hasToolCallSection(afterSensitiveAudit, 'tracekeeper.start_task', 'success', ['- args_summary:']),
			'tool-call should include args summary field'
		);

		const writeContext = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.write_context_pack',
			arguments: {
				filename: 'smoke-context-pack',
				content: '# Context Pack\n\nSmoke content',
				title: 'Smoke context pack',
				task_id: taskId,
			},
		}));
		assert.equal(writeContext.ok, true);
		assert.ok(fs.existsSync(path.join(vaultRoot, writeContext.path)));

		const buildContextRead = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.build_context_pack',
			arguments: {
				query: 'smoke',
				candidate_limit: 5,
				stale_after_days: 30,
				write: false,
			},
		}));
		assert.equal(buildContextRead.ok, true);
		assert.equal(buildContextRead.read_only, true);
		assert.equal(buildContextRead.query, 'smoke');
		assert.equal(Array.isArray(buildContextRead.context_pack.relevantNotes), true);

		const buildContextWrite = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.build_context_pack',
			arguments: {
				query: 'smoke',
				write: true,
				filename: 'smoke-context-pack-auto',
				title: 'Smoke build context pack',
				task_id: taskId,
			},
		}));
		assert.equal(buildContextWrite.ok, true);
		assert.equal(buildContextWrite.read_only, false);
		assert.ok(fs.existsSync(path.join(vaultRoot, buildContextWrite.artifact.path)));
		assert.ok(buildContextWrite.artifact.path.startsWith('00_tracekeeper/work/context_packs/'));
		assert.ok(buildContextWrite.artifact.path.endsWith('.md'));
		let taskText = fs.readFileSync(path.join(vaultRoot, startTask.path), 'utf8');
		assert.ok(taskText.includes(writeContext.path), 'task should reference written context pack');
		assert.ok(taskText.includes(buildContextWrite.artifact.path), 'task should reference generated context pack');

		const lintResult = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.lint',
			arguments: {
				max_items: 20,
			},
		}));
		assert.equal(lintResult.ok, true);
		const lintGraphHealth = lintResult.graph_health || lintResult.graph_health_summary;
		assert.ok(lintGraphHealth, 'tracekeeper.lint should include graph health summary fields');
		assert.equal(lintGraphHealth.profile, 'advisory');
		assert.equal(lintGraphHealth.disabled, false);
		assert.ok(Array.isArray(lintGraphHealth.profile_issues));
		assert.equal(typeof lintGraphHealth.note_count, 'number');
		assert.equal(typeof lintGraphHealth.wikilink_edge_count, 'number');
		assert.equal(typeof lintGraphHealth.resolved_edge_count, 'number');
		assert.equal(typeof lintGraphHealth.unresolved_edge_count, 'number');
		assert.ok(Array.isArray(lintGraphHealth.hub_candidates));
		assert.ok(Array.isArray(lintGraphHealth.only_inbound_nodes));
		assert.ok(Array.isArray(lintGraphHealth.only_outbound_nodes));
		assert.ok(Array.isArray(lintGraphHealth.isolated_nodes));
		assert.equal(lintResult.profile, 'advisory');
		assert.equal(lintResult.graph_profile_disabled, false);
		assert.equal(Array.isArray(lintResult.profile_issues), true);
		assert.equal(typeof lintResult.issue_count, 'number');
		assert.ok(Array.isArray(lintResult.issues));
		assert.ok(lintResult.issues.length > 0);
		assert.ok(lintResult.issues.some((issue) => issue.kind.startsWith('graph_') && issue.severity === 'warning'));
		assert.ok(Array.isArray(lintResult.fix_plan_summary));

		const offLintResult = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.lint',
			arguments: {
				graph_profile: 'off',
				max_items: 100,
			},
		}));
		assert.equal(offLintResult.ok, true);
		assert.equal(offLintResult.profile, 'off');
		assert.equal(offLintResult.graph_profile_disabled, true);
		assert.equal(offLintResult.issues.some((issue) => issue.kind.startsWith('graph_')), false);

		const strictLintResult = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.lint',
			arguments: {
				graph_profile: 'strict',
				max_items: 100,
			},
		}));
		assert.equal(strictLintResult.ok, true);
		assert.equal(strictLintResult.profile, 'strict');
		assert.ok(strictLintResult.issues.some((issue) => issue.kind.startsWith('graph_') && issue.severity === 'error'));

		const finishTask = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.finish_task',
			arguments: {
				task_id: taskId,
				summary: 'Smoke task finish session.',
				outcomes: ['Complete smoke validation'],
				next_actions: ['Run lint and distill'],
			},
		}));
		assert.equal(finishTask.ok, true);
		assert.equal(finishTask.read_only, false);
		assert.equal(finishTask.review_proposal_mode, 'off');
		assert.equal(finishTask.proposal_count, undefined);
		assert.equal(finishTask.proposals, undefined);
		assert.equal(finishTask.suggestion_count, undefined);
		assert.equal(finishTask.suggested_memory_updates, undefined);
		assert.ok(fs.existsSync(path.join(vaultRoot, finishTask.path)));
		taskText = fs.readFileSync(path.join(vaultRoot, startTask.path), 'utf8');
		assert.ok(taskText.includes('status: completed') || taskText.includes('status: "completed"'));
		assert.ok(taskText.includes(finishTask.path));

		const projectContext = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.recall',
			arguments: {
				query: 'project_overview',
				scope: 'project',
				project_hint: 'demo',
				max_items: 5,
			},
		}));
		assert.equal(projectContext.ok, true);
		assert.equal(projectContext.read_only, true);
		assert.equal(projectContext.uncertain, false);
		const projectContextEntries = projectContext.entries || projectContext.matches || [];
		assert.ok(Array.isArray(projectContextEntries));
		assert.ok(projectContextEntries.length >= 1);
		assert.ok(projectContext.scope === 'project' || (projectContext.scope && projectContext.scope.scope === 'project'));
		assert.equal(projectContext.scope?.project_hint || projectContext.project_hint || null, 'demo');

		const projectHistory = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.recall',
			arguments: {
				scope: 'project_history',
				project_hint: 'demo',
				max_items: 5,
			},
		}));
		assert.equal(projectHistory.ok, true);
		assert.equal(projectHistory.read_only, true);
		assert.equal(projectHistory.uncertain, false);
		const projectHistoryEntries = projectHistory.entries || projectHistory.matches || [];
		assert.ok(Array.isArray(projectHistoryEntries));
		assert.ok(projectHistoryEntries.length >= 1);
		assert.ok(
			projectHistoryEntries.some((entry) => entry.path === finishTask.path),
			'project_history should include prior session notes linked through the project task'
		);
		assert.ok(projectHistory.scope === 'project_history' || (projectHistory.scope && projectHistory.scope.scope === 'project_history'));

		const queueCountBeforeSuggest = countReviewQueueFiles(vaultRoot);
		const finishWithSuggestions = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.finish_task',
			arguments: {
				task_id: taskId,
				summary: 'Smoke finish task with suggestion mode.',
				outcomes: ['Closeout proposal capture'],
				next_actions: ['Verify memory proposals'],
				decisions: ['Use project-scoped recall for context'],
				solution_changes: ['Added finish_task closeout proposal flow'],
				lessons: ['Prefer explicit session scope filtering'],
				preferences: ['Favor local vault-first memory'],
				memory_candidates: ['01_knowledge/memory/projects/demo/memory.md'],
				review_proposal_mode: 'suggest',
			},
		}));
		assert.equal(finishWithSuggestions.ok, true);
		assert.equal(finishWithSuggestions.read_only, false);
		assert.equal(finishWithSuggestions.review_proposal_mode, 'suggest');
		assert.equal(finishWithSuggestions.proposal_count, undefined);
		assert.equal(finishWithSuggestions.proposals, undefined);
		assert.equal(finishWithSuggestions.suggestion_count, 6);
		assert.ok(Array.isArray(finishWithSuggestions.suggested_memory_updates));
		assert.equal(finishWithSuggestions.suggested_memory_updates.length, 6);
		assert.equal(countReviewQueueFiles(vaultRoot), queueCountBeforeSuggest, 'suggest mode should not create Review Queue files');
		const suggestionKinds = finishWithSuggestions.suggested_memory_updates.map((proposal) => proposal.kind).sort();
		assert.ok(suggestionKinds.includes('task_decision'));
		assert.ok(suggestionKinds.includes('solution_change'));
		assert.ok(suggestionKinds.includes('lesson_learned'));
		assert.ok(suggestionKinds.includes('user_preference'));
		assert.ok(suggestionKinds.includes('project_next_action'));
		assert.ok(suggestionKinds.includes('memory_candidate'));

		const finishWithReviewQueue = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.finish_task',
			arguments: {
				task_id: `${taskId}-review`,
				summary: 'Smoke finish task with review queue mode.',
				outcomes: ['Closeout proposal review'],
				next_actions: ['Review memory proposals'],
				decisions: ['Use explicit review queue mode for closeout'],
				solution_changes: ['Added review_queue closeout mode'],
				lessons: ['Review mode should queue candidates'],
				preferences: ['Keep review option user-visible'],
				memory_candidates: ['01_knowledge/memory/projects/demo/memory.md'],
				review_proposal_mode: 'review_queue',
			},
		}));
		assert.equal(finishWithReviewQueue.ok, true);
		assert.equal(finishWithReviewQueue.read_only, false);
		assert.equal(finishWithReviewQueue.review_proposal_mode, 'review_queue');
		assert.equal(finishWithReviewQueue.suggestion_count, undefined);
		assert.equal(finishWithReviewQueue.suggested_memory_updates, undefined);
		assert.equal(finishWithReviewQueue.proposal_count, 6);
		assert.equal(finishWithReviewQueue.auto_applied_count, 0);
		for (const proposal of finishWithReviewQueue.proposals) {
			assert.ok(fs.existsSync(path.join(vaultRoot, proposal.path)));
		}

		const finishWithProposals = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.finish_task',
			arguments: {
				task_id: taskId,
				summary: 'Smoke finish task with auto proposal mode.',
				outcomes: ['Closeout proposal capture'],
				next_actions: ['Verify memory proposals'],
				decisions: ['Use project-scoped recall for context'],
				solution_changes: ['Added finish_task closeout proposal flow'],
				lessons: ['Prefer explicit session scope filtering'],
				preferences: ['Favor local vault-first memory'],
				memory_candidates: ['01_knowledge/memory/projects/demo/memory.md'],
				review_proposal_mode: 'auto_propose',
			},
		}));
		assert.equal(finishWithProposals.ok, true);
		assert.equal(finishWithProposals.read_only, false);
		assert.equal(finishWithProposals.review_proposal_mode, 'auto_propose');
		assert.equal(finishWithProposals.suggestion_count, undefined);
		assert.equal(finishWithProposals.suggested_memory_updates, undefined);
		assert.equal(finishWithProposals.proposal_count, 6);
		assert.ok(Array.isArray(finishWithProposals.proposals));
		assert.equal(finishWithProposals.proposals.length, 6);
		for (const proposal of finishWithProposals.proposals) {
			assert.ok(fs.existsSync(path.join(vaultRoot, proposal.path)));
		}
		const kinds = finishWithProposals.proposals.map((proposal) => proposal.kind).sort();
		assert.ok(kinds.includes('task_decision'));
		assert.ok(kinds.includes('solution_change'));
		assert.ok(kinds.includes('lesson_learned'));
		assert.ok(kinds.includes('user_preference'));
		assert.ok(kinds.includes('project_next_action'));
		assert.ok(kinds.includes('memory_candidate'));
		const queueCountAfterAutoPropose = countReviewQueueFiles(vaultRoot);
		const retryFinishWithProposals = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.finish_task',
			arguments: {
				task_id: taskId,
				summary: 'Smoke finish task with auto proposal retry.',
				outcomes: ['Closeout proposal capture'],
				next_actions: ['Verify memory proposals'],
				decisions: ['Use project-scoped recall for context'],
				solution_changes: ['Added finish_task closeout proposal flow'],
				lessons: ['Prefer explicit session scope filtering'],
				preferences: ['Favor local vault-first memory'],
				memory_candidates: ['01_knowledge/memory/projects/demo/memory.md'],
				review_proposal_mode: 'auto_propose',
			},
		}));
		assert.equal(retryFinishWithProposals.proposal_count, 6);
		assert.deepEqual(
			retryFinishWithProposals.proposals.map((proposal) => proposal.path).sort(),
			finishWithProposals.proposals.map((proposal) => proposal.path).sort(),
			'auto_propose retry should reuse existing finish_task proposals'
		);
		assert.equal(countReviewQueueFiles(vaultRoot), queueCountAfterAutoPropose, 'auto_propose retry should not duplicate proposals');

		const distillSession = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.distill_session',
			arguments: {
				task_id: taskId,
				summary: 'Smoke distill session.',
				decisions: ['Prefer deterministic artifacts'],
				possible_preferences: ['Prefer markdown session notes'],
				outcomes: ['Generated distill proposals'],
				next_actions: ['Review proposals'],
			},
		}));
		assert.equal(distillSession.ok, true);
		assert.equal(distillSession.read_only, false);
		assert.equal(distillSession.proposal_count, 2);
		assert.ok(Array.isArray(distillSession.proposals));
		assert.equal(distillSession.proposals.length, 2);
		for (const proposal of distillSession.proposals) {
			assert.ok(fs.existsSync(path.join(vaultRoot, proposal.path)));
		}
		taskText = fs.readFileSync(path.join(vaultRoot, startTask.path), 'utf8');
		for (const proposal of distillSession.proposals) {
			assert.ok(taskText.includes(proposal.path), 'task should reference distilled proposal');
		}

		const writeSession = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.write_session_note',
			arguments: {
				filename: 'smoke-session',
				content: '# Session\n\nSmoke session note',
				task_id: taskId,
			},
		}));
		assert.equal(writeSession.ok, true);
		assert.ok(fs.existsSync(path.join(vaultRoot, writeSession.path)));

		const proposedMemory = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.propose_memory',
			arguments: {
				proposal_kind: 'smoke_memory',
				content: 'Smoke proposal content.',
				evidence: 'smoke test',
				target_note: '01_knowledge/memory/projects/demo/memory.md',
				risk_level: 'medium',
				task_id: taskId,
			},
		}));
		assert.equal(proposedMemory.ok, true);
		assert.ok(fs.existsSync(path.join(vaultRoot, proposedMemory.path)));

		const autoMemoryClient = new McpTestClient(vaultRoot, vaultConfigDir, {
			memoryRules: {
				globalMemoryRule: 'review_queue',
				projectMemoryRule: 'auto_write',
				taskMemoryProposalMode: 'off',
			},
		});
		try {
			await autoMemoryClient.start();
			await autoMemoryClient.call('initialize', {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: {
					name: 'tracekeeper-smoke-auto-memory',
					version: '0.1.7',
				},
			});
			const queueCountBeforeAutoMemory = countReviewQueueFiles(vaultRoot);
			const autoMemory = buildStructured(await autoMemoryClient.call('tools/call', {
				name: 'tracekeeper.propose_memory',
				arguments: {
					proposal_kind: 'project_update',
					content: '- Auto-saved project memory from smoke test.',
					evidence: 'smoke test',
					risk_level: 'medium',
					task_id: taskId,
					project_hint: 'demo',
					memory_scope: 'project',
					related_wiki: ['01_knowledge/wiki/hubs/smoke-hub.md'],
					related_sources: ['01_knowledge/sources/local-source.md'],
				},
			}));
			assert.equal(autoMemory.ok, true);
			assert.equal(autoMemory.auto_applied, true);
			assert.equal(autoMemory.path, '01_knowledge/memory/projects/demo/memory.md');
			assert.equal(countReviewQueueFiles(vaultRoot), queueCountBeforeAutoMemory);
			assert.equal(Array.isArray(autoMemory.missing_graph_bridges), true);
			assert.equal(autoMemory.missing_wiki_bridge, false);
			const autoTargetText = fs.readFileSync(path.join(vaultRoot, '01_knowledge/memory/projects/demo/memory.md'), 'utf8');
			assert.ok(autoTargetText.includes('Auto-saved project memory from smoke test.'));
			assert.ok(autoTargetText.includes('content_signature:'));

			const duplicateAutoMemory = buildStructured(await autoMemoryClient.call('tools/call', {
				name: 'tracekeeper.propose_memory',
				arguments: {
					proposal_kind: 'project_update',
					content: '- Auto-saved project memory from smoke test.',
					evidence: 'smoke test',
					risk_level: 'medium',
					task_id: taskId,
					project_hint: 'demo',
					memory_scope: 'project',
					related_wiki: ['01_knowledge/wiki/hubs/smoke-hub.md'],
					related_sources: ['01_knowledge/sources/local-source.md'],
				},
			}));
			assert.equal(duplicateAutoMemory.ok, true);
			assert.equal(duplicateAutoMemory.status, 'skipped');
			assert.equal(duplicateAutoMemory.duplicate, true);
			assert.equal(countReviewQueueFiles(vaultRoot), queueCountBeforeAutoMemory);
			const missingBridgeAutoMemory = buildStructured(await autoMemoryClient.call('tools/call', {
				name: 'tracekeeper.propose_memory',
				arguments: {
					proposal_kind: 'project_update',
					content: '- Missing wiki bridge path should fallback to review queue.',
					evidence: 'smoke test',
					risk_level: 'medium',
					task_id: taskId,
					project_hint: 'demo',
					memory_scope: 'project',
					related_wiki: ['nonexistent-wiki-note'],
				},
			}));
			assert.equal(missingBridgeAutoMemory.ok, true);
			assert.equal(missingBridgeAutoMemory.auto_applied, false);
			assert.equal(missingBridgeAutoMemory.memory_rule, 'review_queue');
			assert.equal(missingBridgeAutoMemory.missing_wiki_bridge, true);
			assert.equal(countReviewQueueFiles(vaultRoot), queueCountBeforeAutoMemory + 1);
			assert.equal(fs.readFileSync(path.join(vaultRoot, missingBridgeAutoMemory.path), 'utf8').includes('related_wiki'), true);

			const autoFinishQueueBefore = countReviewQueueFiles(vaultRoot);
			const autoFinish = buildStructured(await autoMemoryClient.call('tools/call', {
				name: 'tracekeeper.finish_task',
				arguments: {
					task_id: 'auto-memory-task',
					summary: 'Smoke finish task with project auto memory.',
					outcomes: ['Project memory auto-write validated'],
					next_actions: ['Keep project memory scoped'],
					decisions: ['Project memory can save without repeated manual review'],
					solution_changes: ['Added project memory auto-save rule'],
					lessons: ['Prefer project-scoped automatic memory for routine work'],
					preferences: ['Keep global memory reviewed by default'],
					memory_candidates: ['01_knowledge/memory/projects/demo/memory.md'],
					project_hint: 'demo',
					review_proposal_mode: 'auto_propose',
					memory_scope: 'project',
					related_wiki: ['01_knowledge/wiki/hubs/smoke-hub.md'],
					related_sources: ['01_knowledge/sources/local-source.md'],
				},
			}));
			assert.equal(autoFinish.ok, true);
			assert.equal(autoFinish.review_proposal_mode, 'auto_propose');
			assert.equal(autoFinish.proposal_count, 0);
			assert.equal(autoFinish.auto_applied_count, 6);
			assert.equal(countReviewQueueFiles(vaultRoot), autoFinishQueueBefore);
			const autoProjectMemoryText = fs.readFileSync(path.join(vaultRoot, '01_knowledge/memory/projects/demo/memory.md'), 'utf8');
			assert.ok(autoProjectMemoryText.includes('Project memory can save without repeated manual review'));
			assert.ok(autoProjectMemoryText.includes('Keep global memory reviewed by default'));
			assert.equal(autoFinish.architecture_status === 'healthy' || autoFinish.architecture_status === 'needs_attention', true);
			assert.equal(Array.isArray(autoFinish.missing_graph_bridges), true);

			const autoFinishBridgeFallback = buildStructured(await autoMemoryClient.call('tools/call', {
				name: 'tracekeeper.finish_task',
				arguments: {
					task_id: 'auto-memory-task-no-bridge',
					summary: 'Smoke finish task with missing wiki bridge.',
					outcomes: ['Project finish should use review queue'],
					next_actions: ['Review proposal candidates'],
					decisions: ['Wiki bridge is required for project auto save'],
					solution_changes: ['Added fallback behavior'],
					lessons: ['Missing wiki bridge should force review queue'],
					preferences: ['Prefer explicit review queue fallback'],
					memory_candidates: ['01_knowledge/memory/projects/demo/memory.md'],
					project_hint: 'demo',
					memory_scope: 'project',
					related_wiki: ['missing-wiki-demo-note'],
					related_sources: ['01_knowledge/sources/local-source.md'],
					review_proposal_mode: 'auto_propose',
				},
			}));
			assert.equal(autoFinishBridgeFallback.ok, true);
			assert.equal(autoFinishBridgeFallback.proposal_count, 6);
			assert.equal(autoFinishBridgeFallback.auto_applied_count, 0);
			assert.equal(autoFinishBridgeFallback.missing_wiki_bridge, true);
			await autoMemoryClient.deleteSession();
		} finally {
			await autoMemoryClient.close().catch(() => {});
		}

		const captureSource = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.capture_source',
			arguments: {
				source: '01_knowledge/sources/local-source.md',
				mode: 'local_copy',
				content: '# Source\n\ncopied content.',
				task_id: taskId,
			},
		}));
		assert.equal(captureSource.ok, true);
		taskText = fs.readFileSync(path.join(vaultRoot, startTask.path), 'utf8');
		assert.ok(taskText.includes(writeSession.path), 'task should reference written session');
		assert.ok(taskText.includes(proposedMemory.path), 'task should reference proposed memory');
		assert.ok(taskText.includes(captureSource.path), 'task should reference captured source');

		await assert.rejects(
			() =>
				client.call('tools/call', {
					name: 'tracekeeper.write_context_pack',
					arguments: {
						filename: '../outside',
						content: '# Reject',
					},
				}),
			/Path traversal is not allowed/,
			'should reject writes outside vault'
		);
		const afterFailureAudit = readAuditLog(vaultRoot);
		assertToolCallEvent(afterFailureAudit, 'tracekeeper.write_context_pack', 'failed');

		const sourceRequestList = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.source_request',
			arguments: {
				action: 'list',
				max_items: 10,
			},
		}));
		assert.equal(sourceRequestList.ok, true);
		const sourceRequestEntries = sourceRequestList.entries || sourceRequestList.requests || [];
		assert.ok(Array.isArray(sourceRequestEntries));
		assert.ok(sourceRequestEntries.some((entry) => entry.path === '00_tracekeeper/inbox/agent_requests/local-source-request.md'));

		const analyze = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.source_request',
			arguments: {
				action: 'analyze',
				request_path: '00_tracekeeper/inbox/agent_requests/local-source-request.md',
				task_id: taskId,
			},
		}));
		assert.equal(analyze.ok, true);
		assert.equal(analyze.status, 'completed');
		assert.ok(analyze.source_note && analyze.source_note.path);
		assert.ok(analyze.report && analyze.report.path);
		assert.ok(fs.existsSync(path.join(vaultRoot, analyze.source_note.path)));
		assert.ok(fs.existsSync(path.join(vaultRoot, analyze.report.path)));
		assert.ok(fs.readFileSync(fixturePath, 'utf8').includes('status: completed'));
		taskText = fs.readFileSync(path.join(vaultRoot, startTask.path), 'utf8');
		assert.ok(taskText.includes(analyze.source_note.path), 'task should reference analyzed source note');
		assert.ok(taskText.includes(analyze.report.path), 'task should reference analyzed source report');

		const pendingReviewQueue = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.review_queue',
			arguments: {
				action: 'list_pending',
				max_items: 20,
			},
		}));
		assert.equal(pendingReviewQueue.ok, true);
		assert.ok(Array.isArray(pendingReviewQueue.entries));

		const approvedWritebacks = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.review_queue',
			arguments: {
				action: 'list_approved',
				max_items: 20,
			},
		}));
		assert.equal(approvedWritebacks.ok, true);
		assert.equal(approvedWritebacks.count, 1);
		assert.equal(approvedWritebacks.entries[0].ready_to_apply, true);

		const dryRunApply = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.apply_approved_writeback',
			arguments: {
				proposal_id: 'prop_smoke_apply',
				dry_run: true,
				task_id: taskId,
			},
		}));
		assert.equal(dryRunApply.ok, true);
		assert.equal(dryRunApply.read_only, true);
		assert.equal(dryRunApply.target_note, '01_knowledge/memory/projects/demo/memory.md');

		const applied = buildStructured(await client.call('tools/call', {
			name: 'tracekeeper.apply_approved_writeback',
			arguments: {
				proposal_id: 'prop_smoke_apply',
				task_id: taskId,
			},
		}));
		assert.equal(applied.ok, true);
		assert.equal(applied.status, 'applied');
		const targetText = fs.readFileSync(path.join(vaultRoot, '01_knowledge/memory/projects/demo/memory.md'), 'utf8');
		assert.ok(targetText.includes('## Approved Writeback: prop_smoke_apply'));
		assert.ok(targetText.includes('Runtime-approved memory from smoke test.'));
		const proposalText = fs.readFileSync(path.join(vaultRoot, '00_tracekeeper/inbox/review_queue/approved-writeback.md'), 'utf8');
		assert.ok(proposalText.includes('approval_status: applied'));
		assert.ok(proposalText.includes('status: applied'));
		taskText = fs.readFileSync(path.join(vaultRoot, startTask.path), 'utf8');
		assert.ok(taskText.includes('01_knowledge/memory/projects/demo/memory.md'), 'task should reference applied writeback target');

		writeNote(vaultRoot, '00_tracekeeper/inbox/review_queue/approved-secret-writeback.md', [
			'---',
			'type: memory-proposal',
			'proposal_id: prop_secret_apply',
			'proposal_kind: project_update',
			'approval_status: approved',
			'target_note: 01_knowledge/memory/projects/demo/memory.md',
			'risk_level: medium',
			'---',
			'',
			'# Approved Secret Writeback Proposal',
			'',
			'## Writeback',
			'',
			'api_key: sk-secretvalue123456789012345',
			'',
		].join('\n'));
		await assert.rejects(
			() =>
				client.call('tools/call', {
					name: 'tracekeeper.apply_approved_writeback',
					arguments: {
						proposal_id: 'prop_secret_apply',
					},
				}),
			/Refusing to write potential secret/,
			'should reject approved writeback content that looks like a secret'
		);
		await client.deleteSession();
		await client.expectHttpStatus({ status: 404 });

		console.log(JSON.stringify({ result: 'pass', vaultRoot }, null, 2));
	} finally {
		await client.close().catch(() => {});
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
