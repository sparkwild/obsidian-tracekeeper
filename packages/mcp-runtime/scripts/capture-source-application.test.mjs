#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NodeFsVaultRepository } from '@tracekeeper/core';
import { callTool } from '../dist/index.js';
import { CaptureSourceApplicationService } from '../dist/application/capture-source.js';

function createFixture(t) {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-capture-source-runtime-'));
	const vaultRoot = path.join(tempRoot, 'vault');
	fs.mkdirSync(vaultRoot, { recursive: true });
	t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
	const repository = new NodeFsVaultRepository({ vaultRoot });
	const context = {
		defaultVaultRoot: vaultRoot,
		vaultRepository: repository,
		principalId: 'capture-source-principal',
		credentialCapabilities: ['*'],
		agentId: 'capture-source-agent',
		sessionId: 'capture-source-session',
		clientName: 'capture-source-test',
		transport: 'test',
		runtimeVersion: 'test',
		contentLanguage: 'en',
	};
	return {
		vaultRoot,
		context,
		write(relativePath, content) {
			const absolutePath = path.join(vaultRoot, relativePath);
			fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
			fs.writeFileSync(absolutePath, content, 'utf8');
		},
		read(relativePath) {
			return fs.readFileSync(path.join(vaultRoot, relativePath), 'utf8');
		},
	};
}

async function invoke(name, args, context) {
	const result = await callTool(name, args, context);
	assert.equal(result.isError, false, `${name} failed: ${JSON.stringify(result.structuredContent)}`);
	assert.equal(result.structuredContent?.ok, true);
	return result.structuredContent;
}

function createInMemoryJournal() {
	const records = new Map();
	const clone = (value) => JSON.parse(JSON.stringify(value));
	return {
		records,
		async loadByIdempotencyKey(idempotencyKey) {
			for (const record of records.values()) {
				if (record.idempotency_key === idempotencyKey) {
					return clone(record);
				}
			}
			return null;
		},
		async loadById(operationId) {
			const record = records.get(operationId);
			return record ? clone(record) : null;
		},
		async listRecoverable() {
			return [...records.values()]
				.filter((record) => record.status !== 'completed' && record.status !== 'conflicted')
				.map(clone);
		},
		async save(record) {
			records.set(record.operation_id, clone(record));
		},
	};
}

test('CaptureSourceApplicationService owns the runner and injected write ports', async () => {
	const journal = createInMemoryJournal();
	const writes = [];
	const taskLinks = [];
	const safetyChecks = [];
	const service = new CaptureSourceApplicationService({
		journal,
		createIdentity: (requestHash, idempotencyKey) => ({
			operationId: `capture-source-${requestHash}`,
			idempotencyKey,
		}),
		now: () => '2026-08-03T00:00:00.000Z',
		buildFilename: (rawFilename, fallbackPrefix) => rawFilename || fallbackPrefix,
		renderText: (zh, en) => `${zh}/${en}`,
		assertSafeText: (values) => safetyChecks.push(values),
		findOwnedSourceNote: async () => null,
		writeSourceNote: async (input) => {
			writes.push(input);
			return {
				path: 'knowledge/sources/captured.md',
			activity_path: '00_tracekeeper/control/agent_activity/2026/2026-08-03.md',
				status: 'written',
				warnings: [],
			};
		},
		updateTaskSourceCapture: async (taskId, sourcePath) => {
			taskLinks.push({ taskId, sourcePath });
		},
	});

	const request = {
		rawArgs: {
			source: 'direct-source',
			mode: 'local_copy',
			content: 'direct content',
			task_id: 'task-direct',
			filename: 'captured',
		},
		requestHash: 'direct-hash',
		idempotencyKey: 'direct-idempotency',
	};
	const result = await service.execute(request);

	assert.equal(result.operation_id, 'capture-source-direct-hash');
	assert.equal(result.path, 'knowledge/sources/captured.md');
	assert.equal(result.metadata.source, 'direct-source');
	assert.equal(result.metadata.mode, 'local_copy');
	assert.equal(result.metadata.source_kind, 'file');
	assert.equal(result.metadata.route, '01_knowledge/sources/files');
	assert.equal(result.metadata.index_path, '01_knowledge/sources/files/captured.md');
	assert.match(result.metadata.source_id, /^source-[a-f0-9]{32}$/);
	assert.match(result.metadata.content_hash, /^sha256:[a-f0-9]{64}$/);
	assert.deepEqual(result.metadata.part_manifest, []);
	assert.equal(writes.length, 1);
	assert.equal(writes[0].frontmatter.source_operation_id, 'capture-source-direct-hash');
	assert.match(writes[0].body, /direct content/);
	assert.deepEqual(taskLinks, [{ taskId: 'task-direct', sourcePath: 'knowledge/sources/captured.md' }]);
	assert.equal(safetyChecks.length, 1);

	const replay = await service.execute(request);
	assert.deepEqual(replay, result);
	assert.equal(writes.length, 1);
});

test('capture_source preserves all modes, aliases, warnings, and generated metadata', async (t) => {
	const fixture = createFixture(t);
	const external = await invoke('tracekeeper.capture_source', {
		source: 'https://example.test/reference',
		mode: 'external_reference',
		content: 'ignored external body',
		capture_reason: 'characterize external reference',
		filename: 'capture-external',
	}, fixture.context);
	assert.equal(external.metadata.source, 'https://example.test/reference');
	assert.equal(external.metadata.mode, 'external_reference');
	assert.equal(external.metadata.source_kind, 'web');
	assert.equal(external.metadata.route, '01_knowledge/sources/web');
	assert.deepEqual(external.warnings, ['content/text is ignored for external_reference mode.']);
	assert.match(fixture.read(external.path), /mode: external_reference/);
	assert.doesNotMatch(fixture.read(external.path), /ignored external body/);

	const extracted = await invoke('tracekeeper.capture_source', {
		source: 'agent-extracted-source',
		mode: 'extracted_snapshot',
		content: '# Extracted\n\nBounded snapshot.',
		filename: 'capture-extracted',
	}, fixture.context);
	assert.deepEqual(extracted.warnings, []);
	assert.match(fixture.read(extracted.path), /Bounded snapshot\./);

	const local = await invoke('tracekeeper.capture_source', {
		source: 'local-copy-source',
		mode: 'local_copy',
		text: '# Local\n\nCopied material.',
		filename: 'capture-local',
	}, fixture.context);
	assert.deepEqual(local.warnings, []);
	assert.match(fixture.read(local.path), /Copied material\./);
});

test('capture_source exact retry reuses one receipt and changed payload conflicts', async (t) => {
	const fixture = createFixture(t);
	const args = {
		source: 'local-retry-source',
		mode: 'local_copy',
		content: '# Retry\n\nStable content.',
		filename: 'capture-retry',
		idempotency_key: 'capture-source-characterization',
	};
	const first = await invoke('tracekeeper.capture_source', args, fixture.context);
	const replay = await invoke('tracekeeper.capture_source', args, fixture.context);
	assert.deepEqual(replay, first);

	const changed = await callTool('tracekeeper.capture_source', {
		...args,
		content: '# Retry\n\nChanged content.',
	}, fixture.context);
	assert.equal(changed.isError, true);
	assert.match(String(changed.structuredContent?.error), /Idempotency key conflict/);
	assert.equal(fs.existsSync(path.join(fixture.vaultRoot, first.path)), true);
});

test('capture_source routes typed owners and splits large content into bounded visible parts', async (t) => {
	const fixture = createFixture(t);
	const largeContent = '🙂'.repeat(40_000);
	const captured = await invoke('tracekeeper.capture_source', {
		source: 'meeting-2026-08-06',
		source_kind: 'transcript',
		mode: 'extracted_snapshot',
		content: largeContent,
		filename: 'large-transcript',
		idempotency_key: 'large-transcript-capture',
	}, fixture.context);
	assert.equal(captured.metadata.source_kind, 'transcript');
	assert.equal(captured.metadata.route, '01_knowledge/sources/transcripts');
	assert.equal(captured.metadata.index_path, captured.path);
	assert.ok(captured.metadata.part_manifest.length > 1);
	assert.equal(captured.path, '01_knowledge/sources/transcripts/large-transcript.md');
	const indexText = fixture.read(captured.path);
	assert.match(indexText, /type: "?source_capture"?/);
	assert.match(indexText, /## Parts/);
	assert.doesNotMatch(indexText, new RegExp(largeContent.slice(0, 100)));
	for (const [index, partPath] of captured.metadata.part_manifest.entries()) {
		const partText = fixture.read(partPath);
		assert.match(partText, /type: "?source_part"?/);
		assert.match(partText, new RegExp(`part_number: ${index + 1}`));
		assert.match(partText, new RegExp(`source_id: "?${captured.metadata.source_id}"?`));
		assert.match(partText, /Parent source:/);
		const body = partText.split('---\n').at(-1) || '';
		assert.ok(Buffer.byteLength(body, 'utf8') < 66 * 1024);
	}
	const replayed = await invoke('tracekeeper.capture_source', {
		source: 'meeting-2026-08-06',
		source_kind: 'transcript',
		mode: 'extracted_snapshot',
		content: largeContent,
		filename: 'large-transcript',
		idempotency_key: 'large-transcript-capture',
	}, fixture.context);
	assert.deepEqual(replayed, captured);
});

test('capture_source validates mode/content and links a captured note to an existing task', async (t) => {
	const fixture = createFixture(t);
	fixture.write('00_tracekeeper/work/tasks/capture-task.md', [
		'---',
		'type: agent_task',
		'task_id: capture-task',
		'status: active',
		'---',
		'',
		'# Capture task',
		'',
	].join('\n'));

	const captured = await invoke('tracekeeper.capture_source', {
		source: 'task-source',
		mode: 'local_copy',
		content: '# Task source\n\nLinked content.',
		task_id: 'capture-task',
		filename: 'capture-task-source',
	}, fixture.context);
	assert.match(fixture.read('00_tracekeeper/work/tasks/capture-task.md'), new RegExp(captured.path));

	const missingContent = await callTool('tracekeeper.capture_source', {
		source: 'missing-content',
		mode: 'extracted_snapshot',
	}, fixture.context);
	assert.equal(missingContent.isError, true);
	assert.match(String(missingContent.structuredContent?.error), /content\/text is required/);

	const invalidMode = await callTool('tracekeeper.capture_source', {
		source: 'invalid-mode',
		mode: 'remote_fetch',
	}, fixture.context);
	assert.equal(invalidMode.isError, true);
	assert.match(String(invalidMode.structuredContent?.error), /capture_source mode must be one of/);
});
