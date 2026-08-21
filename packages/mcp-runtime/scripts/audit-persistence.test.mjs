import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
	AGENT_ACTIVITY_HUB_TYPE,
	AGENT_ACTIVITY_SCHEMA_VERSION,
	renderAgentActivityHub,
} = require('@tracekeeper/core');

import {
	appendAuditEvent,
	projectArgumentsForAudit,
	readMergedAuditSections,
	summarizeForAudit,
} from '../dist/infrastructure/audit-persistence.js';

test('audit persistence owns redaction and bounded argument projection', () => {
	assert.deepEqual(projectArgumentsForAudit('tracekeeper.recall', {
		query: 'private query',
		project_hint: 'demo',
		project_id: { nested: 'invalid' },
	}), {
		query: '[redacted]',
		project_hint: 'demo',
		project_id: '[invalid]',
	});

	const summary = summarizeForAudit(projectArgumentsForAudit('tracekeeper.lint', {
		content: 'private note content',
		api_key: 'secret-value',
		nested: { value: 'safe' },
	}));
	assert.doesNotMatch(summary, /private note content|secret-value/);
	assert.match(summary, /\[redacted\]/);

	const idempotencySummary = summarizeForAudit(projectArgumentsForAudit('tracekeeper.finish_task', {
		idempotency_key: 'finish-key-material',
		start_idempotency_key: 'start-key-material',
		'retry-idempotency-key': 'retry-key-material',
		nested: {
			startIdempotencyKey: 'nested-key-material',
			status: 'safe',
		},
		deeply_nested: {
			one: {
				two: {
					startIdempotencyKey: 'deep-camel-key-material',
					'start-idempotency-key': 'deep-kebab-key-material',
					start_idempotency_key: 'deep-snake-key-material',
				},
			},
		},
		array_nested: [{
			one: {
				startIdempotencyKey: 'deep-array-key-material',
			},
		}],
		recording_reason: 'start_unavailable',
	}));
	assert.doesNotMatch(
		idempotencySummary,
		/finish-key-material|start-key-material|retry-key-material|nested-key-material|deep-camel-key-material|deep-kebab-key-material|deep-snake-key-material|deep-array-key-material/
	);
	assert.match(idempotencySummary, /recording_reason/);
	assert.match(idempotencySummary, /start_unavailable/);
	assert.match(idempotencySummary, /"status":"safe"/);
});

test('audit persistence appends idempotent UTC shards and reads merged sections', async () => {
	const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-audit-persistence-'));
	try {
		const input = {
			type: 'mcp.tool_call',
			event: 'mcp.tool_call',
			action: 'tracekeeper.agent_activity_recent',
			operationId: 'audit-persistence-operation',
			tool: 'tracekeeper.agent_activity_recent',
			resultStatus: 'success',
			timestamp: '2026-08-03T12:00:00.000Z',
			argsSummary: '{"query":"[redacted]"}',
		};
		const first = appendAuditEvent(vaultRoot, input);
		const second = appendAuditEvent(vaultRoot, input);
		assert.equal(first.path, '00_tracekeeper/control/agent_activity/2026/2026-08-03.md');
		assert.deepEqual(second, first);

		const shardPath = path.join(vaultRoot, first.path);
		const shard = fs.readFileSync(shardPath, 'utf8');
		assert.equal((shard.match(/activity_event_id:/g) || []).length, 1);
		assert.match(shard, /type: tracekeeper_agent_activity_shard/);
		const hubPath = path.join(vaultRoot, '00_tracekeeper/control/agent_activity/index.md');
		assert.equal(fs.existsSync(hubPath), true);
		const hub = fs.readFileSync(hubPath, 'utf8');
		assert.equal(hub, renderAgentActivityHub(input.timestamp));
		assert.equal(hub.match(/^created_at:\s*(\S+)\s*$/m)?.[1], input.timestamp);
		assert.equal(hub.match(/^updated_at:\s*(\S+)\s*$/m)?.[1], input.timestamp);
		assert.match(
			hub,
			/^Daily Agent activity shards link back to this hub and remain discoverable through Backlinks\.$/m
		);

		const sections = await readMergedAuditSections(vaultRoot, {});
		assert.equal(sections.length, 1);
		assert.equal(sections[0].source_path, first.path);
		assert.equal(sections[0].source_kind, 'shard');
	} finally {
		fs.rmSync(vaultRoot, { recursive: true, force: true });
	}
});

test('audit persistence preserves an existing legacy Agent activity Hub byte-for-byte', () => {
	const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-audit-legacy-hub-'));
	try {
		const hubPath = path.join(vaultRoot, '00_tracekeeper/control/agent_activity/index.md');
		const legacyHub = [
			'---',
			`type: ${AGENT_ACTIVITY_HUB_TYPE}`,
			`agent_activity_schema_version: ${AGENT_ACTIVITY_SCHEMA_VERSION}`,
			'created_at: 2025-01-01T00:00:00.000Z',
			'---',
			'# Custom legacy Agent activity Hub',
			'',
			'This user-owned body must remain byte-identical.',
			'',
		].join('\n');
		fs.mkdirSync(path.dirname(hubPath), { recursive: true });
		fs.writeFileSync(hubPath, legacyHub, 'utf8');

		appendAuditEvent(vaultRoot, {
			type: 'mcp.tool_call',
			event: 'mcp.tool_call',
			action: 'tracekeeper.status',
			operationId: 'audit-persistence-legacy-hub',
			tool: 'tracekeeper.status',
			resultStatus: 'success',
			timestamp: '2026-08-03T12:00:00.000Z',
		});

		assert.equal(fs.readFileSync(hubPath, 'utf8'), legacyHub);
	} finally {
		fs.rmSync(vaultRoot, { recursive: true, force: true });
	}
});
