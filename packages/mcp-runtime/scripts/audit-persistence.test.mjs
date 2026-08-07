import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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
		assert.equal(fs.existsSync(path.join(vaultRoot, '00_tracekeeper/control/agent_activity/index.md')), true);

		const sections = await readMergedAuditSections(vaultRoot, {});
		assert.equal(sections.length, 1);
		assert.equal(sections[0].source_path, first.path);
		assert.equal(sections[0].source_kind, 'shard');
	} finally {
		fs.rmSync(vaultRoot, { recursive: true, force: true });
	}
});
