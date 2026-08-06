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

const memoryV2Frontmatter = (memoryId, claimKey, overrides = {}) => ({
	schema_version: 2,
	type: 'memory_record',
	memory_id: memoryId,
	scope: 'global',
	agent_type: 'codex',
	operation_id: `op-${memoryId}`,
	memory_kind: 'fact',
	claim_key: claimKey,
	authority: 'source',
	confidence_level: 'supported',
	declared_state: 'active',
	observed_at: '2026-07-28T03:00:00.000Z',
	evidence: ['01_knowledge/sources/web/example.md'],
	supersedes: [],
	contradicts: [],
	global_hub: '01_knowledge/memory/global/index.md',
	related_wiki: [],
	related_sources: ['01_knowledge/sources/web/example.md'],
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
	const currentMemoryPath = '01_knowledge/memory/global/current.md';
	const historyMemoryPath = '01_knowledge/memory/global/history.md';
	const conflictOnePath = '01_knowledge/memory/global/conflict-one.md';
	const conflictTwoPath = '01_knowledge/memory/global/conflict-two.md';
	const reviewMemoryPath = '01_knowledge/memory/global/review.md';
	const sourcePath = '01_knowledge/sources/web/example.md';
	const sourcePartPath = '01_knowledge/sources/transcripts/interview.part-001.md';
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
			note(historyMemoryPath, {
				type: 'memory_record',
				frontmatter: memoryV2Frontmatter('mem-history', 'preference:editor'),
			}),
			note(currentMemoryPath, {
				type: 'memory_record',
				frontmatter: memoryV2Frontmatter('mem-current', 'preference:editor', {
					supersedes: ['mem-history'],
				}),
			}),
			note(conflictOnePath, {
				type: 'memory_record',
				frontmatter: memoryV2Frontmatter('mem-conflict-one', 'fact:conflict'),
			}),
			note(conflictTwoPath, {
				type: 'memory_record',
				frontmatter: memoryV2Frontmatter('mem-conflict-two', 'fact:conflict'),
			}),
			note(reviewMemoryPath, {
				type: 'memory_record',
				frontmatter: memoryV2Frontmatter('mem-review', 'fact:review', {
					declared_state: 'review',
					valid_from: '2027-01-01T00:00:00.000Z',
				}),
			}),
			note(sourcePath, {
				title: 'Example source',
				type: 'source_capture',
				frontmatter: {
					type: 'source_capture',
					source: 'https://example.com',
					source_kind: 'web',
					source_id: 'src_example',
					content_hash: 'sha256:example',
					route: '01_knowledge/sources/web',
					part_count: 2,
					part_manifest: [
						'01_knowledge/sources/web/example.part-001.md',
						'01_knowledge/sources/web/example.part-002.md',
					],
					index_path: sourcePath,
					mode: 'extracted_snapshot',
					task_id: 'task-1',
				},
			}),
			note(sourcePartPath, {
				title: 'Interview part 1',
				type: 'source_part',
				frontmatter: {
					type: 'source_part',
					source_id: 'src_interview',
					content_hash: 'sha256:interview',
					part_number: 1,
					part_count: 2,
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
			sourceCaptures: [sourcePath, sourcePartPath, missingSourcePath],
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
	assert.equal(memory.totalItems, 10);
	assert.equal(memory.records.filter((record) => record.state === 'persisted').length, 8);
	assert.equal(memory.records.filter((record) => record.state === 'queued').length, 1);
	assert.equal(memory.records.filter((record) => record.state === 'missing').length, 1);
	assert.equal(memory.staleRecordCount, 1);
	assert.equal(memory.readFailures.length, 1);
	assert.equal(memory.indexGeneration, 7);
	assert.deepEqual(memory.projectMemoryCounts, {
		immutableEntries: 1,
		legacyNotes: 1,
	});
	assert.deepEqual(memory.lifecycleCounts, {
		current: 1,
		history: 1,
		conflict: 2,
		review: 3,
		legacy_unkeyed: 3,
	});
	assert.equal(memory.records.find((record) => record.path === currentMemoryPath)?.lifecycleState, 'current');
	assert.equal(memory.records.find((record) => record.path === historyMemoryPath)?.lifecycleState, 'history');
	assert.equal(memory.records.find((record) => record.path === conflictOnePath)?.lifecycleState, 'conflict');
	assert.equal(memory.records.find((record) => record.path === reviewMemoryPath)?.lifecycleState, 'review');
	assert.equal(memory.records.find((record) => record.path === persistedGlobalPath)?.lifecycleState, 'legacy_unkeyed');
	assert.equal(memory.records.find((record) => record.path === currentMemoryPath)?.claimKey, 'preference:editor');
	assert.equal(memory.records.find((record) => record.path === currentMemoryPath)?.authority, 'source');
	assert.equal(memory.records.find((record) => record.path === currentMemoryPath)?.confidenceLevel, 'supported');
	assert.deepEqual(memory.records.find((record) => record.path === currentMemoryPath)?.evidence, [
		'[[01_knowledge/sources/web/example]]',
	]);

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
	assert.equal(source.records.some((record) => record.path === sourcePartPath), false);
	assert.equal(captured.indexPath, sourcePath);
	assert.equal(captured.sourceId, 'src_example');
	assert.equal(captured.contentHash, 'sha256:example');
	assert.equal(captured.route, '01_knowledge/sources/web');
	assert.equal(captured.partCount, 2);
	assert.deepEqual(captured.partManifest, [
		'01_knowledge/sources/web/example.part-001.md',
		'01_knowledge/sources/web/example.part-002.md',
	]);
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

	const legacySourcePath = '01_knowledge/sources/files/legacy.md';
	const legacySource = buildSourceStatusSnapshot({
		index: {
			...index,
			notes: [note(legacySourcePath, { frontmatter: { source: 'legacy.pdf' } })],
			errors: [],
		},
		proposals: [],
		tasks: [],
		requests: [],
		missingSourceFolder: false,
		missingRequestFolder: false,
	});
	assert.equal(legacySource.totalItems, 1);
	assert.equal(legacySource.records[0].indexPath, legacySourcePath);
	assert.equal(legacySource.records[0].sourceKind, 'source');
	assert.equal(legacySource.records[0].sourceId, '');
	assert.equal(legacySource.records[0].contentHash, '');
	assert.equal(legacySource.records[0].route, '');
	assert.equal(legacySource.records[0].partCount, 0);
	assert.deepEqual(legacySource.records[0].partManifest, []);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 38 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
