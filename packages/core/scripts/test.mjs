#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import safety from '../dist/safety.js';
import sourceAnalysisModule from '../dist/source-analysis.js';
import scanModule from '../dist/scan.js';
import graphHealthModule from '../dist/graph-health.js';
import lintModule from '../dist/lint.js';
import recallModule from '../dist/recall.js';
import legacyStructureModule from '../dist/legacy-structure.js';
import operationJournalModule from '../dist/operation-journal.js';
import knowledgeIndexModule from '../dist/knowledge-index.js';
import vaultRepositoryModule from '../dist/vault-repository.js';

const KNOWLEDGE_DIR = '01_knowledge';
const CONFIG_DIR = 'vault-config';

function writeFile(relativePath, content, basePath) {
	const target = path.join(basePath, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content, 'utf8');
	return target;
}

function createFixture(rootPath) {
	const vaultRoot = path.join(rootPath, 'vault');
	fs.mkdirSync(vaultRoot, { recursive: true });
	return vaultRoot;
}

function createSourceSeed(vaultRoot) {
	writeFile(
		`${CONFIG_DIR}/config.json`,
		'{}',
		vaultRoot
	);
	writeFile('00_tracekeeper/control/system.md', '# System\n', vaultRoot);
	writeFile('01_knowledge/sources/source_seed.md', '# Source Seed\n\nProof text used for scan tests.', vaultRoot);
	writeFile('03_sources/legacy_source.md', '# Legacy Source\n', vaultRoot);
}

function createGraphAndLintFixture(vaultRoot) {
	writeFile(
		`${KNOWLEDGE_DIR}/wiki/hubs/wiki-bridge.md`,
		'# Wiki Bridge\n',
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/wiki/hubs/wiki-only-link.md`,
		'# Wiki Link\n',
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/memory/memory-bridge.md`,
		['---', 'type: memory', 'related_wiki: [01_knowledge/wiki/hubs/wiki-bridge.md, 00_tracekeeper/work/sessions/session-invalid.md]', '---', '# Memory Bridge'].join('\n'),
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/memory/memory-yaml-only.md`,
		['---', 'type: memory', '---', '# Memory YAML Only', '[[01_knowledge/wiki/hubs/wiki-only-link]]'].join('\n'),
		vaultRoot
	);

	writeFile(
		`${KNOWLEDGE_DIR}/memory/projects/alpha/note.md`,
		'# Project Alpha\n',
		vaultRoot
	);

	writeFile(
		`${KNOWLEDGE_DIR}/wiki/concepts/recall-priority.md`,
		'# Recall Priority\nRecall priority token for recall ranking.\n',
		vaultRoot
	);
	writeFile(
		'04_memory/recall-priority.md',
		'# Recall Priority\nRecall priority token for recall ranking.\n',
		vaultRoot
	);
}

function createReciprocalCase(vaultRoot) {
	writeFile(
		`${KNOWLEDGE_DIR}/wiki/hubs/wiki-bad-bridge.md`,
		'# Wiki Bad Bridge\n',
		vaultRoot
	);
}

function assertLintKinds(issues, expectedKinds) {
	const actualKinds = new Set(issues.map((issue) => issue.kind));
	for (const kind of expectedKinds) {
		assert.equal(actualKinds.has(kind), true, `Expected lint kind "${kind}" to be present`);
	}
}

function fileVersionForPath(filePath) {
	const stats = fs.statSync(filePath);
	return knowledgeIndexModule.computeFileVersion(stats.size, stats.mtime.toISOString());
}

function normalizeSnapshotNotes(snapshot) {
	const normalized = [];
	for (const [notePath, note] of snapshot.notes.entries()) {
		normalized.push({
			path: notePath,
			title: note.title,
			aliases: [...note.aliases],
			type: note.type,
			tags: [...note.tags],
			fileVersion: note.fileVersion,
			backlinks: [...note.backlinks],
		});
	}

	return normalized.sort((left, right) => left.path.localeCompare(right.path));
}

async function run() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-core-test-'));
	let symlinkSupported = false;

	try {
		const vaultRoot = createFixture(tempRoot);
		createSourceSeed(vaultRoot);
	createGraphAndLintFixture(vaultRoot);
	createReciprocalCase(vaultRoot);

		const results = { skipped: [] };
		const rootConfigPath = path.join(vaultRoot, CONFIG_DIR, 'config.json');
		const outsideFile = path.join(tempRoot, 'outside.md');
		fs.writeFileSync(outsideFile, 'outside', 'utf8');
		const repo = new vaultRepositoryModule.NodeFsVaultRepository({
			vaultRoot,
			allowHidden: false,
			protectedDirectoryName: CONFIG_DIR,
		});

		assert.equal(safety.isSafeDirectoryName(CONFIG_DIR, { protectedDirectoryName: CONFIG_DIR }), false);
		assert.equal(safety.isSafeDirectoryName('.hidden', { allowHidden: false }), false);
		assert.equal(safety.isSafeDirectoryName('.hidden', { allowHidden: true }), true);

		assert.equal(safety.isSafeDirectoryName('notes'), true);
		assert.equal(safety.isSafeDirectoryName('..'), false);
		assert.equal(safety.ensureInsideVaultRoot(vaultRoot, path.join(vaultRoot, '00_tracekeeper/control/system.md')), path.join(vaultRoot, '00_tracekeeper/control/system.md'));
		assert.throws(() => safety.ensureInsideVaultRoot(vaultRoot, outsideFile), /outside vault root/);
		assert.throws(() => safety.ensureInsideVaultRoot(vaultRoot, path.join(vaultRoot, '../outside.md')), /outside vault root/);
		assert.equal(fs.existsSync(rootConfigPath), true);

		const scanBeforeSymlink = scanModule.scanVault(vaultRoot, { vaultConfigDir: CONFIG_DIR });
		assert.ok(scanBeforeSymlink.notes.some((note) => note.relativePath === '00_tracekeeper/control/system.md'));
		assert.ok(!scanBeforeSymlink.notes.some((note) => note.relativePath.startsWith(`${CONFIG_DIR}/`)), 'Expected vault config directory to be skipped');

		const recallScan = scanModule.scanVault(vaultRoot, { vaultConfigDir: CONFIG_DIR });
		const recallMatches = recallModule.recallNotes(recallScan.notes, 'recall priority', { limit: 3 });
		assert.ok(recallMatches.length > 0, 'recall should return at least one result');
		assert.equal(recallMatches[0].note.relativePath, `${KNOWLEDGE_DIR}/wiki/concepts/recall-priority.md`);

		const graphHealth = graphHealthModule.analyzeGraphHealth(scanBeforeSymlink.notes, { maxItems: 10 });
		const advisoryGraphProfile = graphHealthModule.evaluateGraphProfile(graphHealth, 'advisory');
		assert.equal(advisoryGraphProfile.profile, 'advisory');
		assert.equal(advisoryGraphProfile.disabled, false);
		assert.ok(advisoryGraphProfile.profile_issues.every((issue) => issue.severity === 'warning'));
		const strictGraphProfile = graphHealthModule.evaluateGraphProfile(graphHealth, 'strict');
		assert.equal(strictGraphProfile.profile, 'strict');
		assert.ok(strictGraphProfile.profile_issues.some((issue) => issue.severity === 'error'));
		const offGraphProfile = graphHealthModule.evaluateGraphProfile(graphHealth, 'off');
		assert.equal(offGraphProfile.profile, 'off');
		assert.equal(offGraphProfile.disabled, true);
		assert.equal(offGraphProfile.profile_issues.length, 0);

		const advisoryLint = lintModule.lintNotes(vaultRoot, scanBeforeSymlink.notes, {
			graphHealth,
			graphProfile: 'advisory',
		});
		assert.ok(advisoryLint.issues.some((issue) => issue.kind.startsWith('graph_') && issue.severity === 'warning'));
		assertLintKinds(advisoryLint.issues, [
			'architecture_legacy_directory',
			'architecture_missing_required_path',
			'architecture_invalid_wiki_path',
			'graph_missing_memory_wiki_bridge',
			'graph_missing_wiki_memory_backlink',
			'graph_missing_project_index',
			'graph_yaml_only_relation',
		]);

		const strictLint = lintModule.lintNotes(vaultRoot, scanBeforeSymlink.notes, {
			graphHealth,
			graphProfile: 'strict',
		});
		assert.ok(strictLint.issues.some((issue) => issue.kind.startsWith('graph_') && issue.severity === 'error'));
		const offLint = lintModule.lintNotes(vaultRoot, scanBeforeSymlink.notes, {
			graphHealth,
			graphProfile: 'off',
		});
		assert.equal(offLint.issues.some((issue) => issue.kind.startsWith('graph_')), false);

		const linkedTarget = path.join(vaultRoot, '01_knowledge', 'sources', 'target.md');
		const linkedSource = path.join(vaultRoot, '01_knowledge', 'sources', 'symlink_source.md');
		fs.mkdirSync(path.dirname(linkedTarget), { recursive: true });
		fs.writeFileSync(linkedTarget, '# Target\n', 'utf8');

		try {
			fs.symlinkSync(linkedTarget, linkedSource, process.platform === 'win32' ? 'file' : undefined);
			symlinkSupported = true;
		} catch {
			symlinkSupported = false;
			results.skipped.push('symlink');
		}

		if (symlinkSupported) {
			const scanWithSymlink = scanModule.scanVault(vaultRoot, { vaultConfigDir: CONFIG_DIR });
			assert.equal(scanWithSymlink.notes.some((note) => note.relativePath === '01_knowledge/sources/symlink_source.md'), false);
		} else {
			console.log('SKIP: platform does not support creating symlinks in this environment');
		}

		const sourceAnalysis = sourceAnalysisModule.analyzeSourceText({
			source: '01_knowledge/sources/source_seed.md',
			sourceKind: 'local_file',
			analysisMode: 'default',
			purpose: 'smoke test for source analysis',
			content: '# Source\n\nThis is a claim that indicates a source-backed fact and provides evidence.',
			requestPath: '00_tracekeeper/inbox/agent_requests/request.md',
		});

		assert.ok(typeof sourceAnalysis.summary === 'string' && sourceAnalysis.summary.length > 0);
		assert.ok(typeof sourceAnalysis.excerpt === 'string');
		assert.equal(Array.isArray(sourceAnalysis.evidenceScaffolds), true);
		assert.equal(Array.isArray(sourceAnalysis.claimScaffolds), true);
		assert.equal(Array.isArray(sourceAnalysis.proposalDrafts), true);

		const sourceTarget = legacyStructureModule.getLegacyStructureTarget('03_sources/web/example.md');
		assert.deepEqual(sourceTarget, {
			oldPath: '03_sources/web/example.md',
			newPath: '01_knowledge/sources/web/example.md',
			kind: 'source',
		});
		const wikiTarget = legacyStructureModule.getLegacyStructureTarget('04_memory/concepts/topic.md');
		assert.deepEqual(wikiTarget, {
			oldPath: '04_memory/concepts/topic.md',
			newPath: '01_knowledge/wiki/concepts/topic.md',
			kind: 'wiki_concept',
		});
		const dashboardTarget = legacyStructureModule.getLegacyStructureTarget('00_control/dashboards/knowledge.base');
		assert.deepEqual(dashboardTarget, {
			oldPath: '00_control/dashboards/knowledge.base',
			newPath: '00_tracekeeper/control/dashboards/knowledge.base',
			kind: 'dashboard',
		});
		const enrichedMemory = legacyStructureModule.enrichLegacyMarkdownContent('# Preference\n', {
			migrationId: 'legacy-test',
			oldPath: '04_memory/preferences/style.md',
			newPath: '01_knowledge/memory/global/preferences/style.md',
			kind: 'memory_global',
		});
		assert.match(enrichedMemory, /## Tracekeeper migration/);
		assert.match(enrichedMemory, /## Graph links/);
		const enrichedWiki = legacyStructureModule.enrichLegacyMarkdownContent('# Topic\n', {
			migrationId: 'legacy-test',
			oldPath: '04_memory/concepts/topic.md',
			newPath: '01_knowledge/wiki/concepts/topic.md',
			kind: 'wiki_concept',
		});
		assert.match(enrichedWiki, /## Related memory/);
		const review = legacyStructureModule.renderLegacyMigrationReview({
			migrationId: 'legacy-test',
			oldPath: '00_control/system.md',
			newPath: '00_tracekeeper/control/system.md',
			kind: 'control',
			reason: 'conflict',
			sourceContent: '# Old system',
		});
		assert.match(review, /type: legacy_migration_review/);
		assert.match(review, /source_path: "00_control\/system.md"/);

		const operationJournalDirectory = path.join(vaultRoot, 'operation-journal');
		let stepResult = [];
		const fixedOperationTime = '2026-07-22T00:00:00.000Z';
		const normalRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-normal',
			idempotencyKey: 'idempotency-normal',
			payload: { value: 42 },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			clock: () => fixedOperationTime,
			steps: [
				{
					name: 'step-1',
					execute: async () => {
						stepResult.push('step-1');
					},
				},
				{
					name: 'step-2',
					execute: async () => {
						stepResult.push('step-2');
					},
				},
			],
			finalize: async () => {
				return { status: 'completed', steps: 2 };
			},
		});
		const normalOutcome = await normalRunner.run();
		assert.deepEqual(normalOutcome, { status: 'completed', steps: 2 });
		assert.deepEqual(stepResult, ['step-1', 'step-2']);
		const normalRecord = await new operationJournalModule.NodeFileOperationJournal({
			directory: operationJournalDirectory,
		}).loadById('op-normal');
		assert.equal(normalRecord?.created_at, fixedOperationTime);
		assert.equal(normalRecord?.updated_at, fixedOperationTime);
		assert.deepEqual(normalRecord?.completed_steps.map((step) => step.completed_at), [
			fixedOperationTime,
			fixedOperationTime,
		]);

		const concurrentSteps = [];
		const concurrentRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-concurrent',
			idempotencyKey: 'idempotency-concurrent',
			payload: { value: 'concurrent' },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			steps: [
				{
					name: 'slow-step',
					execute: async () => {
						await new Promise((resolve) => setTimeout(resolve, 30));
						concurrentSteps.push('slow-step');
					},
				},
			],
			finalize: async () => {
				concurrentSteps.push('finalize');
				return { status: 'ok' };
			},
		});
		const concurrentResults = await Promise.all([
			concurrentRunner.run(),
			concurrentRunner.run(),
		]);
		assert.deepEqual(concurrentResults, [{ status: 'ok' }, { status: 'ok' }]);
		assert.deepEqual(concurrentSteps, ['slow-step', 'finalize']);

		const processLockDirectory = path.join(vaultRoot, 'operation-journal-process-lock');
		const firstProcessJournal = new operationJournalModule.NodeFileOperationJournal({
			directory: processLockDirectory,
			lockWaitTimeoutMs: 1_000,
		});
		const secondProcessJournal = new operationJournalModule.NodeFileOperationJournal({
			directory: processLockDirectory,
			lockWaitTimeoutMs: 1_000,
		});
		const releaseFirstProcessLock = await firstProcessJournal.acquireLock('shared-process-key');
		let secondLockAcquired = false;
		const secondLockPromise = secondProcessJournal.acquireLock('shared-process-key').then((release) => {
			secondLockAcquired = true;
			return release;
		});
		await new Promise((resolve) => setTimeout(resolve, 40));
		assert.equal(secondLockAcquired, false);
		await releaseFirstProcessLock();
		const releaseSecondProcessLock = await secondLockPromise;
		assert.equal(secondLockAcquired, true);
		await releaseSecondProcessLock();

		const claimJournal = new operationJournalModule.NodeFileOperationJournal({ directory: processLockDirectory });
		const claimBase = {
			idempotency_key: 'atomic-claim-key',
			payload_hash: operationJournalModule.computePayloadHash({ claim: true }),
			payload: { claim: true },
			status: 'in_progress',
			created_at: fixedOperationTime,
			updated_at: fixedOperationTime,
			completed_steps: [],
		};
		const claimResults = await Promise.all([
			claimJournal.claim({ ...claimBase, operation_id: 'atomic-claim-a' }),
			claimJournal.claim({ ...claimBase, operation_id: 'atomic-claim-b' }),
		]);
		assert.equal(claimResults.filter(Boolean).length, 1);
		const claimedRecord = await claimJournal.loadByIdempotencyKey('atomic-claim-key');
		assert.ok(claimedRecord);
		assert.equal(claimedRecord.operation_id, claimResults[0] ? 'atomic-claim-a' : 'atomic-claim-b');

		const replayRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-normal',
			idempotencyKey: 'idempotency-normal',
			payload: { value: 42 },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			steps: [
				{
					name: 'step-1',
					execute: async () => {
						stepResult.push('replayed-step-1');
					},
				},
				{
					name: 'step-2',
					execute: async () => {
						stepResult.push('replayed-step-2');
					},
				},
			],
			finalize: async () => ({ status: 'should-not-run' }),
		});
		const replayOutcome = await replayRunner.run();
		assert.deepEqual(replayOutcome, normalOutcome);
		assert.deepEqual(stepResult, ['step-1', 'step-2']);

		const operationIdConflictRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-normal-id-mismatch',
			idempotencyKey: 'idempotency-normal',
			payload: { value: 42 },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			steps: [],
			finalize: async () => ({ status: 'id-mismatch' }),
		});
		await assert.rejects(
			() => operationIdConflictRunner.run(),
			(error) => {
				return error instanceof operationJournalModule.OperationConflictError;
			}
		);

		const conflictRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-normal',
			idempotencyKey: 'idempotency-normal',
			payload: { value: 99 },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			steps: [],
			finalize: async () => ({ status: 'conflict' }),
		});
		await assert.rejects(
			() => conflictRunner.run(),
			(error) => {
				return error instanceof operationJournalModule.OperationConflictError && /idempotency key conflict/i.test(error.message);
			}
		);
		const recordAfterConflict = await new operationJournalModule.NodeFileOperationJournal({
			directory: operationJournalDirectory,
		}).loadById('op-normal');
		assert.equal(recordAfterConflict?.status, 'completed');
		assert.deepEqual(recordAfterConflict?.result, normalOutcome);

		const failureSteps = [];
		const failureRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-failure',
			idempotencyKey: 'idempotency-failure',
			payload: { value: 'retry' },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			steps: [
				{
					name: 'prepare',
					execute: async () => {
						failureSteps.push('prepare');
					},
				},
				{
					name: 'write',
					execute: async () => {
						failureSteps.push('write');
					},
				},
				{
					name: 'final',
					execute: async () => {
						failureSteps.push('final');
					},
				},
			],
			finalize: async () => {
				failureSteps.push('finalize');
				return { status: 'done' };
			},
			failureInjection: (context) => {
				if (context.phase === 'after_step' && context.stepName === 'prepare') {
					throw new Error('simulated failure');
				}
			},
		});
		await assert.rejects(
			() => failureRunner.run(),
			(error) => {
				return error instanceof Error && error.message === 'simulated failure';
			}
		);
		assert.deepEqual(failureSteps, ['prepare']);
		const recoverableAfterFailure = await new operationJournalModule.NodeFileOperationJournal({
			directory: operationJournalDirectory,
		}).listRecoverable();
		const recoverableFailure = recoverableAfterFailure.find((record) => record.operation_id === 'op-failure');
		assert.deepEqual(recoverableFailure?.payload, { value: 'retry' });
		assert.equal(recoverableFailure?.status, 'failed');

		const resumeRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-failure',
			idempotencyKey: 'idempotency-failure',
			payload: { value: 'retry' },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			steps: [
				{
					name: 'prepare',
					execute: async () => {
						failureSteps.push('prepare');
					},
				},
				{
					name: 'write',
					execute: async () => {
						failureSteps.push('write');
					},
				},
				{
					name: 'final',
					execute: async () => {
						failureSteps.push('final');
					},
				},
			],
			finalize: async () => {
				failureSteps.push('finalize');
				return { status: 'done', steps: failureSteps.length };
			},
		});
		const resumedOutcome = await resumeRunner.run();
		assert.deepEqual(failureSteps, ['prepare', 'write', 'final', 'finalize']);
		assert.deepEqual(resumedOutcome, { status: 'done', steps: 4 });
		const recoverableAfterResume = await new operationJournalModule.NodeFileOperationJournal({
			directory: operationJournalDirectory,
		}).listRecoverable();
		assert.equal(recoverableAfterResume.some((record) => record.operation_id === 'op-failure'), false);

		const corruptedJournalDir = path.join(vaultRoot, 'operation-journal-corrupt');
		const corruptedJournal = new operationJournalModule.NodeFileOperationJournal({ directory: corruptedJournalDir });
		const corruptedPath = path.join(corruptedJournalDir, 'op-corrupt.json');
		fs.mkdirSync(corruptedJournalDir, { recursive: true });
		fs.writeFileSync(corruptedPath, '{bad json', 'utf8');
		const corruptedRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-corrupt',
			idempotencyKey: 'idempotency-corrupt',
			payload: { value: 'corrupt' },
			journal: corruptedJournal,
			steps: [
				{
					name: 'never',
					execute: async () => {
						assert.fail('should not execute due corrupted journal');
					},
				},
			],
			finalize: async () => ({ status: 'corrupt' }),
		});
		await assert.rejects(() => corruptedRunner.run(), (error) => error instanceof operationJournalModule.CorruptedOperationJournalError);

		const initialIndex = new knowledgeIndexModule.InMemoryKnowledgeIndex({
			vaultRoot,
			vaultConfigDir: CONFIG_DIR,
			initialScan: scanBeforeSymlink,
		});
		const uninitializedIndex = new knowledgeIndexModule.InMemoryKnowledgeIndex({
			vaultRoot,
			vaultConfigDir: CONFIG_DIR,
		});
		assert.equal((await uninitializedIndex.snapshot()).index_state, 'initializing');
		await uninitializedIndex.rebuild(scanBeforeSymlink);
		assert.equal((await uninitializedIndex.snapshot()).index_state, 'ready');
		await initialIndex.rebuild(scanBeforeSymlink);
		const baselineSnapshot = await initialIndex.snapshot();
		const scanSnapshot = knowledgeIndexModule.buildKnowledgeSnapshot(scanBeforeSymlink, {
			indexState: 'ready',
			generation: 1,
			lastEvent: null,
			lastRebuild: scanBeforeSymlink.scannedAt,
		});
		assert.deepEqual(normalizeSnapshotNotes(baselineSnapshot), normalizeSnapshotNotes(scanSnapshot));
		assert.equal(baselineSnapshot.index_state, 'ready');

		const incrementalPath = '01_knowledge/wiki/incremental_event.md';
		const incrementalAbsolute = path.join(vaultRoot, incrementalPath);
		writeFile(incrementalPath, '# Incremental Seed\nBody', vaultRoot);
		const createVersion = fileVersionForPath(incrementalAbsolute);

		await initialIndex.apply({
			kind: 'create',
			path: incrementalPath,
			fileVersion: createVersion,
		});
		const afterCreate = await initialIndex.snapshot();
		assert.equal(afterCreate.notes.has(incrementalPath), true);

		const firstCreateCount = afterCreate.notes.size;
		await initialIndex.apply({
			kind: 'create',
			path: incrementalPath,
			fileVersion: createVersion,
		});
		const afterDuplicateCreate = await initialIndex.snapshot();
		assert.equal(afterDuplicateCreate.notes.size, firstCreateCount);
		assert.equal(afterDuplicateCreate.generation, afterCreate.generation);

		const externalPath = '01_knowledge/wiki/obsidian_event.md';
		const externalContent = '# Obsidian Event\nOnly supplied through the adapter.';
		const externalModifiedAt = new Date().toISOString();
		const externalNote = scanModule.scannedNoteFromContent({
			absolutePath: path.join(vaultRoot, externalPath),
			relativePath: externalPath,
			fallbackTitle: 'obsidian_event',
			size: Buffer.byteLength(externalContent),
			modifiedAt: externalModifiedAt,
			content: externalContent,
		});
		const externalVersion = knowledgeIndexModule.computeFileVersion(externalNote.size, externalNote.modifiedAt);
		await initialIndex.applyScanned({
			kind: 'create',
			path: externalPath,
			fileVersion: externalVersion,
		}, externalNote);
		const afterExternalCreate = await initialIndex.snapshot();
		assert.equal(afterExternalCreate.notes.get(externalPath)?.title, 'obsidian_event');
		assert.equal(afterExternalCreate.notes.get(externalPath)?.excerptSource.includes('Obsidian Event'), true);
		assert.equal(initialIndex.scanSnapshot().notes.some((note) => note.relativePath === externalPath), true);
		await initialIndex.applyScanned({
			kind: 'delete',
			path: externalPath,
			fileVersion: externalVersion,
		});
		assert.equal(initialIndex.scanSnapshot().notes.some((note) => note.relativePath === externalPath), false);

		const orderedPath = '01_knowledge/wiki/ordered_event.md';
		const newerContent = '# Newer Event';
		const newerNote = scanModule.scannedNoteFromContent({
			absolutePath: path.join(vaultRoot, orderedPath),
			relativePath: orderedPath,
			fallbackTitle: 'ordered_event',
			size: Buffer.byteLength(newerContent),
			modifiedAt: '2026-07-22T02:00:00.000Z',
			content: newerContent,
		});
		const olderContent = '# Older Event';
		const olderNote = scanModule.scannedNoteFromContent({
			absolutePath: path.join(vaultRoot, orderedPath),
			relativePath: orderedPath,
			fallbackTitle: 'ordered_event',
			size: Buffer.byteLength(olderContent),
			modifiedAt: '2026-07-22T01:00:00.000Z',
			content: olderContent,
		});
		await initialIndex.applyScanned({
			kind: 'modify',
			path: orderedPath,
			fileVersion: knowledgeIndexModule.computeFileVersion(newerNote.size, newerNote.modifiedAt),
		}, newerNote);
		const generationAfterNewerEvent = (await initialIndex.snapshot()).generation;
		await initialIndex.applyScanned({
			kind: 'modify',
			path: orderedPath,
			fileVersion: knowledgeIndexModule.computeFileVersion(olderNote.size, olderNote.modifiedAt),
		}, olderNote);
		const afterOutOfOrderEvent = await initialIndex.snapshot();
		assert.equal(afterOutOfOrderEvent.notes.get(orderedPath)?.excerptSource.includes('Newer Event'), true);
		assert.equal(afterOutOfOrderEvent.generation, generationAfterNewerEvent);
		await initialIndex.applyScanned({
			kind: 'delete',
			path: orderedPath,
			fileVersion: knowledgeIndexModule.computeFileVersion(newerNote.size, newerNote.modifiedAt),
		});

		writeFile(incrementalPath, '# Incremental Updated\nBody v2', vaultRoot);
		const modifyVersion = fileVersionForPath(incrementalAbsolute);
		await initialIndex.apply({
			kind: 'modify',
			path: incrementalPath,
			fileVersion: modifyVersion,
		});
		const afterModify = await initialIndex.snapshot();
		assert.equal(afterModify.notes.get(incrementalPath)?.excerptSource.includes('Incremental Updated'), true);

		const renamedPath = '01_knowledge/wiki/incremental_event_renamed.md';
		const renamedAbsolute = path.join(vaultRoot, renamedPath);
		fs.renameSync(incrementalAbsolute, renamedAbsolute);
		const renameVersion = fileVersionForPath(renamedAbsolute);
		await initialIndex.apply({
			kind: 'rename',
			path: incrementalPath,
			newPath: renamedPath,
			fileVersion: renameVersion,
		});
		const afterRename = await initialIndex.snapshot();
		assert.equal(afterRename.notes.has(incrementalPath), false);
		assert.equal(afterRename.notes.has(renamedPath), true);

		const renamedDeleteVersion = fileVersionForPath(renamedAbsolute);
		await initialIndex.apply({
			kind: 'delete',
			path: renamedPath,
			fileVersion: renamedDeleteVersion,
		});
		const afterDelete = await initialIndex.snapshot();
		assert.equal(afterDelete.notes.has(renamedPath), false);
		assert.equal(afterDelete.notes.size, afterCreate.notes.size - 1);

		const rebuildPath = '01_knowledge/wiki/rebuild_event.md';
		writeFile(rebuildPath, '# Rebuild Note\n', vaultRoot);
		const rebuildSnapshot = await initialIndex.rebuild();
		const rebuiltSnapshot = await initialIndex.snapshot();
		assert.equal(rebuiltSnapshot.index_state, 'ready');
		assert.equal(rebuiltSnapshot.notes.has(rebuildPath), true);
		assert.equal(rebuildSnapshot.note_count, rebuiltSnapshot.notes.size);

		const repoScope = '03_sources';
		const repositoryRootNote = path.join(repoScope, 'repository-note.md');
		const repositoryCreated = await repo.createText(repositoryRootNote, '# Repository Note\n');
		assert.equal(repositoryCreated.path, repositoryRootNote);
		assert.equal(typeof repositoryCreated.version, 'string');
		const repositoryRead = await repo.readText(repositoryRootNote);
		assert.equal(repositoryRead?.path, repositoryRootNote);
		assert.equal(repositoryRead?.content, '# Repository Note\n');
		assert.equal(repositoryRead?.version, repositoryCreated.version);

		await assert.rejects(
			() => repo.createText(repositoryRootNote, '# Duplicate Repository Note\n'),
			(error) => {
				return error instanceof operationJournalModule.OperationConflictError;
			}
		);

		const repositoryReplaced = await repo.replaceText(
			repositoryRootNote,
			repositoryRead?.version ?? repositoryCreated.version,
			'# Repository Note\n\nUpdated by repository seam test.\n'
		);
		assert.equal(repositoryReplaced.path, repositoryRootNote);
		assert.equal(repositoryReplaced.version !== repositoryCreated.version, true);

		await assert.rejects(
			() => repo.replaceText(repositoryRootNote, 'not-a-version', '# Collision\n'),
			(error) => error instanceof operationJournalModule.OperationConflictError
		);

		await assert.rejects(
			() => repo.readText('../outside-repo.md'),
			(error) => error instanceof safety.VaultPathError
		);

		const scopedNotes = await repo.listMarkdown(repoScope);
		assert.ok(scopedNotes.some((note) => note.path === repositoryRootNote));

		console.log(
			JSON.stringify(
				{
					result: 'pass',
					vaultRoot,
					scannedNotes: scanBeforeSymlink.notes.length,
					symlinkSupported,
					skipped: results.skipped,
				},
				null,
				2
			)
		);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
