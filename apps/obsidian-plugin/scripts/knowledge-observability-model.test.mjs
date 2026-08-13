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
	const sourcePartOnePath = '01_knowledge/sources/web/example.parts/part-0001.md';
	const sourcePartTwoPath = '01_knowledge/sources/web/example.parts/part-0002.md';
	const sourcePartPath = '01_knowledge/sources/transcripts/interview.part-001.md';
	const missingSourcePath = '01_knowledge/sources/files/missing.md';
	const exampleSourceId = `source-${'a'.repeat(32)}`;
	const exampleContentHash = `sha256:${'b'.repeat(64)}`;
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
					source_id: exampleSourceId,
					content_hash: exampleContentHash,
					route: '01_knowledge/sources/web',
					part_count: 2,
					part_manifest: [
						sourcePartOnePath,
						sourcePartTwoPath,
					],
					index_path: sourcePath,
					mode: 'extracted_snapshot',
					task_id: 'task-1',
				},
			}),
			note(sourcePartOnePath, {
				title: 'Example part 1',
				type: 'source_part',
				frontmatter: {
					type: 'source_part',
					source_id: exampleSourceId,
					content_hash: `sha256:${'c'.repeat(64)}`,
					part_number: 1,
					part_count: 2,
					parent_source: sourcePath,
				},
			}),
			note(sourcePartTwoPath, {
				title: 'Example part 2',
				type: 'source_part',
				frontmatter: {
					type: 'source_part',
					source_id: exampleSourceId,
					content_hash: `sha256:${'d'.repeat(64)}`,
					part_number: 2,
					part_count: 2,
					parent_source: sourcePath,
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

	const v2ProjectPath = '01_knowledge/memory/projects/tracekeeper/agents/codex/propose_memory-op-v2.md';
	const v2ProjectMemory = buildMemoryInspectorSnapshot({
		index: {
			...index,
			notes: [note(v2ProjectPath, {
				type: 'memory_record',
				frontmatter: memoryV2Frontmatter('mem-project-v2', 'project:decision', {
					scope: 'project',
					project_id: 'tracekeeper-project',
					global_hub: null,
					project_hub: '01_knowledge/memory/projects/tracekeeper/index.md',
				}),
			})],
		},
		proposals: [],
		tasks: [],
		missingMemoryFolder: false,
	});
	assert.deepEqual(v2ProjectMemory.projectMemoryCounts, {
		immutableEntries: 1,
		legacyNotes: 0,
	});

	const conflictMemory = buildMemoryInspectorSnapshot({
		index,
		proposals,
		tasks,
		missingMemoryFolder: false,
		query: { lifecycle: 'conflict' },
	});
	assert.equal(conflictMemory.lifecycle, 'conflict');
	assert.equal(conflictMemory.totalItems, 2);
	assert.equal(conflictMemory.records.every((record) => record.lifecycleState === 'conflict'), true);

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
	assert.equal(captured.sourceId, exampleSourceId);
	assert.equal(captured.contentHash, exampleContentHash);
	assert.equal(captured.route, '01_knowledge/sources/web');
	assert.equal(captured.partCount, 2);
	assert.deepEqual(captured.evidenceIssues, []);
	assert.deepEqual(captured.partManifest, [
		sourcePartOnePath,
		sourcePartTwoPath,
	]);
	assert.deepEqual(captured.taskPaths, ['00_tracekeeper/work/tasks/task-1.md']);
	assert.deepEqual(captured.proposalPaths, ['00_tracekeeper/inbox/review_queue/proposal-1.md']);
	assert.deepEqual(captured.finalNotePaths, ['00_tracekeeper/work/sessions/task-1-final.md']);
	assert.equal(source.records.find((record) => record.path === missingSourcePath)?.state, 'missing');

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
	assert.equal(legacySource.records[0].state, 'incomplete');
	assert.deepEqual(legacySource.records[0].evidenceIssues, [
		'type',
		'source_kind',
		'source_id',
		'content_hash',
		'route',
		'mode',
		'part_count',
		'part_manifest',
	]);

	const receiptRoot = '01_knowledge/sources/files';
	const receiptSourceId = `source-${'1'.repeat(32)}`;
	const sourceReceipt = {
		type: 'source_capture',
		source: 'receipt.txt',
		source_kind: 'file',
		source_id: receiptSourceId,
		content_hash: `sha256:${'2'.repeat(64)}`,
		route: receiptRoot,
		part_count: 0,
		part_manifest: [],
		mode: 'local_copy',
	};
	const withoutField = (record, field) => {
		const next = { ...record };
		delete next[field];
		return next;
	};
	const receiptPaths = {
		sourceRequestSingle: `${receiptRoot}/source-request-single.md`,
		directMultipart: `${receiptRoot}/direct-multipart.md`,
		directPartOne: `${receiptRoot}/direct-multipart.parts/part-0001.md`,
		directPartTwo: `${receiptRoot}/direct-multipart.parts/part-0002.md`,
		missingId: `${receiptRoot}/missing-id.md`,
		missingHash: `${receiptRoot}/missing-hash.md`,
		missingRoute: `${receiptRoot}/missing-route.md`,
		missingParts: `${receiptRoot}/missing-parts.md`,
		inconsistentParts: `${receiptRoot}/inconsistent-parts.md`,
		missingChild: `${receiptRoot}/missing-child.md`,
		mismatchedChild: `${receiptRoot}/mismatched-child.md`,
		mismatchedChildPart: `${receiptRoot}/mismatched-child.parts/part-0001.md`,
		zeroWithChild: `${receiptRoot}/zero-with-child.md`,
		zeroWithChildPart: `${receiptRoot}/zero-with-child.parts/part-0001.md`,
	};
	const receiptSnapshot = buildSourceStatusSnapshot({
		index: {
			...index,
			notes: [
				note('01_knowledge/sources/index.md'),
				note(receiptPaths.sourceRequestSingle, {
					type: 'source_capture',
					frontmatter: sourceReceipt,
				}),
				note(receiptPaths.directMultipart, {
					type: 'source_capture',
					frontmatter: {
						...sourceReceipt,
						index_path: receiptPaths.directMultipart,
						source_operation_id: 'capture-source-direct-receipt',
						part_count: 2,
						part_manifest: [receiptPaths.directPartOne, receiptPaths.directPartTwo],
					},
				}),
				note(receiptPaths.directPartOne, {
					type: 'source_part',
					frontmatter: {
						type: 'source_part',
						source_id: receiptSourceId,
						content_hash: `sha256:${'3'.repeat(64)}`,
						part_number: 1,
						part_count: 2,
						parent_source: receiptPaths.directMultipart,
					},
				}),
				note(receiptPaths.directPartTwo, {
					type: 'source_part',
					frontmatter: {
						type: 'source_part',
						source_id: receiptSourceId,
						content_hash: `sha256:${'4'.repeat(64)}`,
						part_number: 2,
						part_count: 2,
						parent_source: receiptPaths.directMultipart,
					},
				}),
				note(receiptPaths.missingId, {
					type: 'source_capture',
					frontmatter: withoutField(sourceReceipt, 'source_id'),
				}),
				note(receiptPaths.missingHash, {
					type: 'source_capture',
					frontmatter: withoutField(sourceReceipt, 'content_hash'),
				}),
				note(receiptPaths.missingRoute, {
					type: 'source_capture',
					frontmatter: withoutField(sourceReceipt, 'route'),
				}),
				note(receiptPaths.missingParts, {
					type: 'source_capture',
					frontmatter: withoutField(withoutField(sourceReceipt, 'part_count'), 'part_manifest'),
				}),
				note(receiptPaths.inconsistentParts, {
					type: 'source_capture',
					frontmatter: {
						...sourceReceipt,
						part_count: 2,
						part_manifest: [`${receiptRoot}/inconsistent-parts.parts/part-0001.md`],
					},
				}),
				note(receiptPaths.missingChild, {
					type: 'source_capture',
					frontmatter: {
						...sourceReceipt,
						part_count: 1,
						part_manifest: [`${receiptRoot}/missing-child.parts/part-0001.md`],
					},
				}),
				note(receiptPaths.mismatchedChild, {
					type: 'source_capture',
					frontmatter: {
						...sourceReceipt,
						part_count: 1,
						part_manifest: [receiptPaths.mismatchedChildPart],
					},
				}),
				note(receiptPaths.mismatchedChildPart, {
					type: 'source_part',
					frontmatter: {
						type: 'source_part',
						source_id: `source-${'9'.repeat(32)}`,
						content_hash: 'invalid-hash',
						part_number: 2,
						part_count: 2,
						parent_source: `${receiptRoot}/another-parent.md`,
					},
				}),
				note(receiptPaths.zeroWithChild, {
					type: 'source_capture',
					frontmatter: sourceReceipt,
				}),
				note(receiptPaths.zeroWithChildPart, {
					type: 'source_part',
					frontmatter: {
						type: 'source_part',
						source_id: receiptSourceId,
						content_hash: `sha256:${'5'.repeat(64)}`,
						part_number: 1,
						part_count: 1,
						parent_source: receiptPaths.zeroWithChild,
					},
				}),
			],
			errors: [],
		},
		proposals: [],
		tasks: [],
		requests: [],
		missingSourceFolder: false,
		missingRequestFolder: false,
	});
	assert.equal(receiptSnapshot.totalItems, 10);
	assert.equal(receiptSnapshot.records.some((record) => record.path === '01_knowledge/sources/index.md'), false);
	const receiptByPath = new Map(receiptSnapshot.records.map((record) => [record.path, record]));
	assert.equal(receiptByPath.get(receiptPaths.sourceRequestSingle)?.state, 'captured');
	assert.deepEqual(receiptByPath.get(receiptPaths.sourceRequestSingle)?.evidenceIssues, []);
	assert.equal(receiptByPath.get(receiptPaths.directMultipart)?.state, 'captured');
	assert.deepEqual(receiptByPath.get(receiptPaths.directMultipart)?.evidenceIssues, []);
	assert.deepEqual(receiptByPath.get(receiptPaths.missingId)?.evidenceIssues, ['source_id']);
	assert.deepEqual(receiptByPath.get(receiptPaths.missingHash)?.evidenceIssues, ['content_hash']);
	assert.deepEqual(receiptByPath.get(receiptPaths.missingRoute)?.evidenceIssues, ['route']);
	assert.deepEqual(receiptByPath.get(receiptPaths.missingParts)?.evidenceIssues, ['part_count', 'part_manifest']);
	assert.ok(receiptByPath.get(receiptPaths.inconsistentParts)?.evidenceIssues.includes('part_manifest'));
	assert.ok(receiptByPath.get(receiptPaths.missingChild)?.evidenceIssues.includes('source_part'));
	assert.deepEqual(
		receiptByPath.get(receiptPaths.mismatchedChild)?.evidenceIssues,
		[
			'part_manifest',
			'source_part.parent_source',
			'source_part.source_id',
			'source_part.content_hash',
			'source_part.part_count',
			'source_part.part_number',
		]
	);
	assert.deepEqual(receiptByPath.get(receiptPaths.zeroWithChild)?.evidenceIssues, ['part_manifest']);
	assert.equal(
		receiptSnapshot.records.filter((record) => record.state === 'incomplete').length,
		8
	);

	const classifyReceipt = (recordPath, frontmatter, parts = []) => {
		const snapshot = buildSourceStatusSnapshot({
			index: {
				...index,
				notes: [note(recordPath, { type: 'source_capture', frontmatter }), ...parts],
				errors: [],
			},
			proposals: [],
			tasks: [],
			requests: [],
			missingSourceFolder: false,
			missingRequestFolder: false,
		});
		return snapshot.records.find((record) => record.path === recordPath);
	};
	const equivalentAliasesPath = `${receiptRoot}/equivalent-aliases.md`;
	const equivalentAliases = classifyReceipt(equivalentAliasesPath, {
		...sourceReceipt,
		sourceUrl: ' receipt.txt ',
		sourceKind: ' FILE ',
		sourceId: ` ${receiptSourceId} `,
		contentHash: ` sha256:${'2'.repeat(64)} `,
		sourceRoute: `./${receiptRoot}`,
		sourceMode: ' LOCAL_COPY ',
		partCount: '0',
		partManifest: [],
	});
	assert.equal(equivalentAliases?.state, 'captured');
	assert.deepEqual(equivalentAliases?.evidenceIssues, []);

	const externalReferencePath = '01_knowledge/sources/web/reference-only.md';
	const externalReference = classifyReceipt(externalReferencePath, {
		...sourceReceipt,
		source: 'https://example.com/reference',
		source_kind: 'web',
		route: '01_knowledge/sources/web',
		mode: 'external_reference',
	});
	assert.equal(externalReference?.state, 'reference_only');
	assert.deepEqual(externalReference?.evidenceIssues, []);

	const malformedExternalReference = classifyReceipt(
		'01_knowledge/sources/web/malformed-reference.md',
		withoutField({
			...sourceReceipt,
			source: 'https://example.com/malformed',
			source_kind: 'web',
			route: '01_knowledge/sources/web',
			mode: 'external_reference',
		}, 'source_id')
	);
	assert.equal(malformedExternalReference?.state, 'incomplete');
	assert.deepEqual(malformedExternalReference?.evidenceIssues, ['source_id']);

	const extractedSnapshot = classifyReceipt(`${receiptRoot}/extracted-snapshot.md`, {
		...sourceReceipt,
		mode: 'extracted_snapshot',
	});
	assert.equal(extractedSnapshot?.state, 'captured');
	assert.equal(receiptByPath.get(receiptPaths.sourceRequestSingle)?.mode, 'local_copy');

	const arrayFields = classifyReceipt(`${receiptRoot}/array-fields.md`, {
		...sourceReceipt,
		type: ['source_capture'],
		source: ['receipt.txt'],
		source_kind: ['file'],
		source_id: [receiptSourceId],
		content_hash: [`sha256:${'2'.repeat(64)}`],
		route: [receiptRoot],
		mode: ['local_copy'],
		part_count: [0],
		part_manifest: '[]',
	});
	assert.deepEqual(arrayFields?.evidenceIssues, [
		'type',
		'source',
		'source_kind',
		'source_id',
		'content_hash',
		'route',
		'mode',
		'part_count',
		'part_manifest',
	]);
	const malformedPartTypePath = `${receiptRoot}/malformed-part-type.md`;
	const malformedPartType = classifyReceipt(malformedPartTypePath, {
		...sourceReceipt,
		type: ['source_part', 'source_capture'],
	});
	assert.equal(malformedPartType?.path, malformedPartTypePath);
	assert.equal(malformedPartType?.state, 'incomplete');
	assert.deepEqual(malformedPartType?.evidenceIssues, ['type']);

	for (const [field, aliasOverride] of [
		['source', { sourceUrl: 'different.txt' }],
		['source_kind', { sourceKind: 'web' }],
		['source_id', { sourceId: `source-${'8'.repeat(32)}` }],
		['content_hash', { contentHash: `sha256:${'8'.repeat(64)}` }],
		['route', { sourceRoute: '01_knowledge/sources/web' }],
		['mode', { sourceMode: 'external_reference' }],
		['part_count', { partCount: 1 }],
		['part_manifest', { partManifest: [`${receiptRoot}/conflicting.parts/part-0001.md`] }],
	]) {
		const record = classifyReceipt(`${receiptRoot}/conflict-${field}.md`, {
			...sourceReceipt,
			...aliasOverride,
		});
		assert.ok(record?.evidenceIssues.includes(field));
	}

	const childAliasConflictPath = `${receiptRoot}/child-alias-conflict.md`;
	const childAliasConflictPartPath = `${receiptRoot}/child-alias-conflict.parts/part-0001.md`;
	const childAliasConflict = classifyReceipt(
		childAliasConflictPath,
		{
			...sourceReceipt,
			part_count: 1,
			part_manifest: [childAliasConflictPartPath],
		},
		[
			note(childAliasConflictPartPath, {
				type: 'source_part',
				frontmatter: {
					type: 'source_part',
					parent_source: childAliasConflictPath,
					parentSource: `./${childAliasConflictPath}`,
					source_id: receiptSourceId,
					sourceId: `source-${'7'.repeat(32)}`,
					content_hash: [`sha256:${'6'.repeat(64)}`],
					part_count: 1,
					partCount: 2,
					part_number: 1,
					partNumber: [1],
				},
			}),
		]
	);
	assert.deepEqual(childAliasConflict?.evidenceIssues, [
		'source_part.source_id',
		'source_part.content_hash',
		'source_part.part_count',
		'source_part.part_number',
	]);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 77 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
