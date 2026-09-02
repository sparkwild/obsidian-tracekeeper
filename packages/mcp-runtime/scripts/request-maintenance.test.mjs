import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	InMemoryKnowledgeIndex,
	NodeFsVaultRepository,
	parseMaintenanceRequestMarkdown,
	renderManagedRelationsBlock,
	scanVault,
} from '@tracekeeper/core';

import { callTool, LOCAL_TRUST_CAPABILITIES } from '../dist/tools.js';

function write(root, relativePath, content) {
	const absolute = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content, 'utf8');
}

async function fixture() {
	const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-maintenance-request-'));
	write(vaultRoot, '01_knowledge/wiki/index.md', '# Wiki');
	write(vaultRoot, '01_knowledge/wiki/legacy.md', `# Legacy\n\n${renderManagedRelationsBlock({ parent: '01_knowledge/wiki/index.md' })}`);
	write(vaultRoot, '01_knowledge/sources/files/unassociated.md', '---\ntype: source_capture\n---\n# Source');
	const index = new InMemoryKnowledgeIndex({ vaultRoot });
	await index.rebuild(scanVault(vaultRoot));
	const context = {
		defaultVaultRoot: vaultRoot,
		vaultRepository: new NodeFsVaultRepository({ vaultRoot }),
		knowledgeReadViewProvider: async () => index.readView(),
		credentialCapabilities: [...LOCAL_TRUST_CAPABILITIES],
		principalId: 'local-user',
		agentId: 'maintenance-test',
	};
	return { vaultRoot, index, context };
}

function payload(result) {
	assert.notEqual(result.isError, true);
	assert.equal(result.structuredContent.ok, true, JSON.stringify(result.structuredContent));
	return result.structuredContent;
}

test('lint v4 candidates create one idempotent human-review request without delete authority', async () => {
	const { vaultRoot, index, context } = await fixture();
	const lint = payload(await callTool('tracekeeper.lint', { page_size: 20 }, context));
	assert.equal(lint.maintenance.schema_version, 1);
	const candidate = lint.maintenance.candidates.find((item) => item.requestable);
	assert.ok(candidate);
	const args = {
		snapshot_generation: lint.snapshot_generation,
		candidate_ids: [candidate.candidate_id],
		idempotency_key: 'request-maintenance-one',
	};
	const first = payload(await callTool('tracekeeper.request_maintenance', args, context));
	await index.rebuild(scanVault(vaultRoot));
	const retry = payload(await callTool('tracekeeper.request_maintenance', args, context));
	assert.equal(retry.request_path, first.request_path);
	assert.equal(retry.activity_path, first.activity_path);
	const requestAbsolute = path.join(vaultRoot, first.request_path);
	const record = fs.readFileSync(requestAbsolute, 'utf8');
	const parsed = parseMaintenanceRequestMarkdown(record);
	assert.equal(parsed.valid, true);
	assert.equal(parsed.valid && parsed.request.candidate_manifest.length, 1);
	assert.equal(parsed.valid && parsed.request.task_id, null);
	assert.match(record, /type: "maintenance_request"/);
	assert.match(record, /status: "pending"/);
	assert.doesNotMatch(record, /confirmation_token|writeback_content|delete_mode/);
	fs.writeFileSync(requestAbsolute, record.replace('status: "pending"', 'status: "completed"'));
	const terminalRetry = payload(await callTool('tracekeeper.request_maintenance', args, context));
	assert.equal(terminalRetry.status, 'completed');
	const injected = await callTool('tracekeeper.request_maintenance', { ...args, path: '02_archive/anything.md' }, context);
	assert.equal(injected.structuredContent.ok, false);
	assert.match(injected.structuredContent.error, /Unsupported maintenance request argument/);
});

test('maintenance requests reject stale generations and forged candidate ids', async () => {
	const { context } = await fixture();
	const lint = payload(await callTool('tracekeeper.lint', {}, context));
	for (const args of [
		{ snapshot_generation: lint.snapshot_generation + 1, candidate_ids: [lint.maintenance.candidates[0].candidate_id], idempotency_key: 'stale' },
		{ snapshot_generation: lint.snapshot_generation, candidate_ids: ['maintenance_forged'], idempotency_key: 'forged' },
	]) {
		const result = await callTool('tracekeeper.request_maintenance', args, context);
		assert.equal(result.structuredContent.ok, false);
	}
});

test('lint v4 cursor binds generation, graph profile, and page size', async () => {
	const { vaultRoot, index, context } = await fixture();
	const first = payload(await callTool('tracekeeper.lint', { page_size: 1, graph_profile: 'advisory' }, context));
	assert.equal(typeof first.maintenance.cursor, 'string');
	const wrongPage = await callTool('tracekeeper.lint', { page_size: 2, graph_profile: 'advisory', cursor: first.maintenance.cursor }, context);
	assert.equal(wrongPage.structuredContent.ok, false);
	const wrongProfile = await callTool('tracekeeper.lint', { page_size: 1, graph_profile: 'strict', cursor: first.maintenance.cursor }, context);
	assert.equal(wrongProfile.structuredContent.ok, false);
	write(vaultRoot, '01_knowledge/wiki/changed.md', '# Changed');
	await index.rebuild(scanVault(vaultRoot));
	const stale = await callTool('tracekeeper.lint', { page_size: 1, graph_profile: 'advisory', cursor: first.maintenance.cursor }, {
		...context,
		knowledgeReadViewPromise: undefined,
	});
	assert.equal(stale.structuredContent.ok, false);
	assert.match(stale.structuredContent.error, /stale/i);
});
