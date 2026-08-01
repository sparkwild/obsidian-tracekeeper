#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-observability-model-test-'));
const output = path.join(tempRoot, 'knowledge-observability-model.cjs');
const require = createRequire(import.meta.url);

const note = (notePath, overrides = {}) => ({
	path: notePath,
	fileVersion: 'v1',
	title: path.basename(notePath, '.md'),
	aliases: [],
	type: null,
	tags: [],
	frontmatter: {},
	headings: [],
	blockIds: [],
	wikilinks: [],
	backlinks: [],
	searchTokens: [],
	excerptSource: 'indexed excerpt',
	contentHash: 'hash',
	modifiedAt: '2026-07-28T04:00:00.000Z',
	size: 100,
	...overrides,
});

const task = (overrides = {}) => ({
	path: '00_tracekeeper/work/tasks/task-1.md',
	type: 'agent-task',
	taskId: 'task-1',
	agent: 'codex',
	objective: 'Inspect source and memory evidence',
	status: 'completed',
	startedAt: '2026-07-28T03:00:00.000Z',
	finishedAt: '2026-07-28T04:00:00.000Z',
	contextPack: '',
	sessionNote: '00_tracekeeper/work/sessions/task-1-final.md',
	relatedProject: 'tracekeeper',
	memoryReads: [],
	memoryWrites: [],
	sourceCaptures: [],
	proposals: [],
	memoryCandidates: [],
	snippet: 'task excerpt',
	sortTimestamp: Date.parse('2026-07-28T04:00:00.000Z'),
	...overrides,
});

const proposal = (overrides = {}) => ({
	path: '00_tracekeeper/inbox/review_queue/proposal-1.md',
	classification: 'memory_proposal',
	proposalId: 'proposal-1',
	proposalKind: 'project_memory',
	proposedBy: 'codex',
	relatedProject: 'tracekeeper',
	taskId: 'task-1',
	sourceSessionNote: '00_tracekeeper/work/sessions/task-1-final.md',
	targetNote: '01_knowledge/memory/projects/tracekeeper/memory.md',
	evidence: [],
	relatedSources: [],
	riskLevel: 'low',
	approvalStatus: 'pending',
	created: '2026-07-28T04:00:00.000Z',
	snippet: 'proposal excerpt',
	sortTimestamp: Date.parse('2026-07-28T04:00:00.000Z'),
	revisionComment: '',
	revisionRequestedAt: '',
	revisionRequestedBy: '',
	writebackContent: 'candidate',
	...overrides,
});

try {
	await build({
		entryPoints: [path.resolve('src/features/observability/knowledge-observability-model.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
	});
	const {
		buildMemoryInspectorSnapshot,
		buildSourceStatusSnapshot,
	} = require(output);

	const persistedProjectPath = '01_knowledge/memory/projects/tracekeeper/memory.md';
	const immutableProjectPath = '01_knowledge/memory/projects/tracekeeper/agents/codex/finish_task-op-1.md';
	const persistedGlobalPath = '01_knowledge/memory/global/preferences.md';
	const missingMemoryPath = '01_knowledge/memory/projects/tracekeeper/missing.md';
	const sourcePath = '01_knowledge/sources/web/example.md';
	const missingSourcePath = '01_knowledge/sources/files/missing.md';
	const index = {
		state: 'ready',
		generation: 7,
		lastRebuild: '2026-07-28T03:55:00.000Z',
		notes: [
			note(persistedProjectPath, {
				title: 'Tracekeeper memory',
				type: 'memory',
				frontmatter: {
					project_hint: 'tracekeeper',
					source: 'tracekeeper.propose_memory',
					task_id: 'task-0',
				},
			}),
			note(immutableProjectPath, {
				title: 'Immutable project entry',
				type: 'project_memory_entry',
				frontmatter: {
					type: 'project_memory_entry',
					project_id: 'tracekeeper-project',
					agent_type: 'codex',
					operation_id: 'op-1',
				},
			}),
			note(persistedGlobalPath, {
				title: 'Preferences',
				type: 'memory',
			}),
			note(sourcePath, {
				title: 'Example source',
				type: 'source_capture',
				frontmatter: {
					source: 'https://example.com',
					source_kind: 'web',
					mode: 'extracted_snapshot',
					task_id: 'task-1',
				},
			}),
		],
		errors: [
			{ path: '01_knowledge/memory/global/unreadable.md', error: 'denied' },
			{ path: '01_knowledge/sources/web/unreadable.md', error: 'denied' },
		],
	};
	const tasks = [
		task({
			memoryReads: [persistedGlobalPath],
			memoryWrites: [missingMemoryPath],
			sourceCaptures: [sourcePath, missingSourcePath],
			proposals: ['00_tracekeeper/inbox/review_queue/proposal-1.md'],
		}),
	];
	const proposals = [
		proposal({
			targetNote: '01_knowledge/memory/projects/tracekeeper/queued.md',
			relatedSources: [sourcePath],
		}),
	];

	const memory = buildMemoryInspectorSnapshot({
		index,
		proposals,
		tasks,
		missingMemoryFolder: false,
		now: '2026-07-28T05:00:00.000Z',
	});
	assert.equal(memory.totalItems, 5);
	assert.equal(memory.records.filter((record) => record.state === 'persisted').length, 3);
	assert.equal(memory.records.filter((record) => record.state === 'queued').length, 1);
	assert.equal(memory.records.filter((record) => record.state === 'missing').length, 1);
	assert.equal(memory.staleRecordCount, 1);
	assert.equal(memory.readFailures.length, 1);
	assert.equal(memory.indexGeneration, 7);
	assert.deepEqual(memory.projectMemoryCounts, {
		immutableEntries: 1,
		legacyNotes: 1,
	});

	const projectMemory = buildMemoryInspectorSnapshot({
		index,
		proposals,
		tasks,
		missingMemoryFolder: false,
		query: { scope: 'project', state: 'persisted' },
	});
	assert.equal(projectMemory.totalItems, 2);
	assert.deepEqual(
		new Set(projectMemory.records.map((record) => record.path)),
		new Set([persistedProjectPath, immutableProjectPath])
	);

	const focusedMemory = buildMemoryInspectorSnapshot({
		index,
		proposals,
		tasks,
		missingMemoryFolder: false,
		query: { taskId: 'task-1' },
	});
	assert.equal(focusedMemory.focused, true);
	assert.equal(focusedMemory.records.some((record) => record.state === 'queued'), true);
	assert.equal(focusedMemory.records.some((record) => record.state === 'missing'), true);

	const source = buildSourceStatusSnapshot({
		index,
		proposals,
		tasks,
		requests: [],
		missingSourceFolder: false,
		missingRequestFolder: false,
		now: '2026-07-28T05:00:00.000Z',
	});
	assert.equal(source.totalItems, 2);
	assert.equal(source.staleRecordCount, 1);
	assert.equal(source.readFailures.length, 1);
	const captured = source.records.find((record) => record.state === 'captured');
	assert.ok(captured);
	assert.deepEqual(captured.taskPaths, ['00_tracekeeper/work/tasks/task-1.md']);
	assert.deepEqual(captured.proposalPaths, ['00_tracekeeper/inbox/review_queue/proposal-1.md']);
	assert.deepEqual(captured.finalNotePaths, ['00_tracekeeper/work/sessions/task-1-final.md']);

	const focusedSource = buildSourceStatusSnapshot({
		index,
		proposals,
		tasks,
		requests: [],
		missingSourceFolder: false,
		missingRequestFolder: false,
		query: { focusPaths: [sourcePath], pageSize: 1 },
	});
	assert.equal(focusedSource.focused, true);
	assert.equal(focusedSource.totalItems, 1);
	assert.equal(focusedSource.records[0].path, sourcePath);

	const pagedSource = buildSourceStatusSnapshot({
		index,
		proposals,
		tasks,
		requests: [],
		missingSourceFolder: false,
		missingRequestFolder: false,
		query: { page: 2, pageSize: 1 },
	});
	assert.equal(pagedSource.page, 2);
	assert.equal(pagedSource.totalPages, 2);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 23 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
