import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createVaultOperationJournal, logDirectory, NodeFsVaultRepository, parseMarkdown, parseTaskRecord, resolveTaskRelations, taskTargets, readTaskVaultSnapshot } from '@tracekeeper/core';
import { callTool, recoverPendingOperations } from '../dist/index.js';

async function fixture(t) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-task-runtime-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const repository = new NodeFsVaultRepository({ vaultRoot: root });
	const context = { defaultVaultRoot: root, vaultRepository: repository, credentialCapabilities: ['*'], principalId: 'test', agentId: 'test', transport: 'obsidian-direct', contentLanguage: 'en' };
	const invoke = async (tool, args, override = {}) => {
		const result = await callTool(tool, args, { ...context, ...override });
		assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
		return result.structuredContent;
	};
	return { root, repository, context, invoke };
}

test('unmigrated task is rejected before business writes or operation records', async t => {
	const f = await fixture(t);
	await f.repository.createText('00_tracekeeper/work/tasks/old.md', '---\ntype: agent_task\ntask_id: old\n---\n# Old\n');
	const before = await readTaskVaultSnapshot(f.repository);
	for (const [tool, args] of [
		['tracekeeper.capture_source', { source: 'https://example.test', mode: 'external_reference', source_kind: 'web', idempotency_key: 'capture' }],
		['tracekeeper.propose_memory', { content: 'Keep the test evidence.', proposal_kind: 'task_decision', idempotency_key: 'memory' }],
		['tracekeeper.finish_task', { summary: 'Done', status: 'completed', idempotency_key: 'finish' }],
	]) {
		const result = await callTool(tool, { ...args, task_id: 'old' }, f.context);
		assert.equal(result.structuredContent.error_detail.code, 'TASK_MIGRATION_REQUIRED');
	}
	assert.deepEqual((await readTaskVaultSnapshot(f.repository)).map(row => row.content), before.map(row => row.content));
	assert.equal((await createVaultOperationJournal(f.root).inspect()).hot, 0);
});

test('capture identities remain distinct and a renamed task closes without recreating its old path', async t => {
	const f = await fixture(t);
	const task = await f.invoke('tracekeeper.start_task', { goal: 'Record real source relations', idempotency_key: 'start' });
	const first = await f.invoke('tracekeeper.capture_source', { task_id: task.task_id, source: 'https://example.test', source_kind: 'web', mode: 'extracted_snapshot', content: 'First capture', idempotency_key: 'capture-one' });
	const second = await f.invoke('tracekeeper.capture_source', { task_id: task.task_id, source: 'https://example.test', source_kind: 'web', mode: 'extracted_snapshot', content: 'Second capture', idempotency_key: 'capture-two' });
	assert.equal(first.metadata.source_id, second.metadata.source_id);
	const renamed = '00_tracekeeper/work/tasks/renamed.md';
	await fs.rename(path.join(f.root, task.path), path.join(f.root, renamed));
	const finished = await f.invoke('tracekeeper.finish_task', { task_id: task.task_id, summary: 'Captured both versions.', status: 'completed', idempotency_key: 'finish' });
	assert.equal(finished.task_path, renamed);
	assert.equal(await f.repository.readText(task.path), null);
	const record = parseTaskRecord(parseMarkdown((await f.repository.readText(renamed)).content).frontmatter.fields);
	assert.equal(record.relations.filter(row => row.role === 'captured_source').length, 2);
	assert.equal(new Set(record.relations.map(row => row.target_id)).size, 2);
	assert.equal(resolveTaskRelations(record, taskTargets(await readTaskVaultSnapshot(f.repository))).every(row => row.status === 'resolved'), true);
	const retry = await f.invoke('tracekeeper.finish_task', { task_id: task.task_id, summary: 'Captured both versions.', status: 'completed', idempotency_key: 'finish' });
	assert.deepEqual(retry, finished);
});

test('Source analysis resumes after output writes without repeating captures or reports', async t => {
	const f = await fixture(t);
	const task = await f.invoke('tracekeeper.start_task', { goal: 'Analyze one source safely', idempotency_key: 'analysis-start' });
	await f.repository.createText('inbox/input.md', '# Input\n\nAn evidence-backed statement for the analysis.');
	const requestPath = '00_tracekeeper/inbox/agent_requests/input.md';
	await f.repository.createText(requestPath, `---\ntype: agent-request\nsource: inbox/input.md\nsource_kind: local_file\nstatus: pending\ntask_id: ${task.task_id}\n---\n# Request\n`);
	const args = { action: 'analyze', request_path: requestPath };
	const failed = await callTool('tracekeeper.source_request', args, { ...f.context, operationFailureInjection: ({ phase, stepName }) => { if (phase === 'before_step' && stepName === 'task-relations') throw new Error('Interrupted at relation commit'); } });
	assert.equal(failed.isError, true);
	for (const file of await fs.readdir(logDirectory(f.root), { withFileTypes: true })) {
		if (file.isFile()) assert.doesNotMatch(await fs.readFile(path.join(logDirectory(f.root), file.name), 'utf8'), /An evidence-backed statement for the analysis/);
	}
	const countOutputs = async () => (await readTaskVaultSnapshot(f.repository)).filter(row => ['source_capture', 'source_analysis_report'].includes(parseMarkdown(row.content).frontmatter.fields.type)).map(row => row.path).sort();
	const before = await countOutputs();
	assert.equal(before.length, 2);
	const recovered = await recoverPendingOperations(f.root, f.context);
	assert.deepEqual(recovered.failed, []);
	assert.equal(recovered.recovered.some(id => id.startsWith('source-request-')), true);
	assert.deepEqual(await countOutputs(), before);
	const record = parseTaskRecord(parseMarkdown((await f.repository.readText(task.path)).content).frontmatter.fields);
	assert.equal(record.relations.some(row => row.role === 'captured_source'), true);
	assert.equal(record.relations.some(row => row.role === 'written_output'), true);
});
