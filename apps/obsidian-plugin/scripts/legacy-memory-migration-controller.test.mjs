#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-legacy-memory-migration-test-'));
const output = path.join(tempRoot, 'legacy-memory-migration-controller.test.cjs');

await build({
	entryPoints: [path.resolve('src/features/structure/legacy-memory-migration-controller.ts')],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: ['node20'],
	outfile: output,
});

const { LegacyMemoryMigrationController } = await import(
	`${pathToFileURL(output).href}?test=${Date.now()}`
);

const digest = (value) => createHash('sha256').update(value).digest('hex');

const suggestion = (claimKey, overrides = {}) => ({
	claimKey,
	authority: 'agent',
	confidence: 'supported',
	relatedSources: ['01_knowledge/sources/web/evidence.md'],
	...overrides,
});

const candidate = (name, suggestions, overrides = {}) => ({
	path: `01_knowledge/memory/projects/demo/${name}.md`,
	contentHash: digest(`legacy:${name}`),
	scope: 'project',
	projectId: 'project-demo-id',
	suggestions,
	...overrides,
});

const createHarness = (candidates, options = {}) => {
	const files = new Map(options.files ?? []);
	const creates = [];
	const sourceWrites = [];
	let snapshot = {
		generation: options.generation ?? 7,
		indexState: options.indexState ?? 'ready',
		candidates,
	};
	let loadCount = 0;
	let failPath = options.failPath ?? null;
	return {
		files,
		creates,
		sourceWrites,
		get loadCount() {
			return loadCount;
		},
		setSnapshot(next) {
			snapshot = next;
		},
		clearFailure() {
			failPath = null;
		},
		host: {
			async loadDoctorSnapshot() {
				loadCount += 1;
				return structuredClone(snapshot);
			},
			async readText(filePath) {
				return files.get(filePath) ?? null;
			},
			async createText(filePath, content) {
				if (filePath === failPath) {
					throw new Error(`configured create failure: ${filePath}`);
				}
				if (files.has(filePath)) {
					throw new Error(`file already exists: ${filePath}`);
				}
				if (!filePath.startsWith('00_tracekeeper/inbox/review_queue/')) {
					sourceWrites.push(filePath);
				}
				files.set(filePath, content);
				creates.push(filePath);
			},
		},
	};
};

{
	const harness = createHarness([
		candidate('none', []),
		candidate('unique', [suggestion('project:unique')]),
		candidate('ambiguous', [suggestion('project:first'), suggestion('project:second')]),
	]);
	const controller = new LegacyMemoryMigrationController(harness.host);
	assert.equal(harness.loadCount, 0, 'controller construction must not start migration');
	const preview = await controller.preview('legacy-memory-1');
	assert.equal(preview.executableCount, 1);
	assert.equal(preview.blockedCount, 2);
	assert.deepEqual(preview.rows.map((row) => row.status), [
		'ambiguous',
		'no_suggestion',
		'unique_suggestion',
	]);
	assert.deepEqual(
		preview.rows[0].suggestions.map((row) => row.claimKey),
		['project:first', 'project:second'],
		'ambiguous suggestions must remain visible without inference'
	);
	assert.equal(preview.rows[0].proposalPath, null);
	assert.equal(preview.rows[1].proposalPath, null);
	assert.match(preview.rollbackBehavior, /never rewritten, moved, or deleted/i);

	const result = await controller.apply(preview);
	assert.equal(result.createdCount, 1);
	assert.equal(result.blockedCount, 2);
	assert.equal(harness.creates.length, 1);
	assert.deepEqual(harness.sourceWrites, []);
	const proposal = harness.files.get(harness.creates[0]);
	assert.match(proposal, /proposal_type: legacy-migration-review/);
	assert.match(proposal, /migration_kind: legacy-memory-identity/);
	assert.match(proposal, /claim_key: "project:unique"/);
	assert.match(proposal, /proposed_authority: "agent"/);
	assert.match(proposal, /proposed_confidence: "supported"/);
	assert.match(proposal, /legacy_path:/);
	assert.match(proposal, /original legacy note remains unchanged/i);
}

{
	const candidates = [candidate('stale', [suggestion('project:stale')])];
	const harness = createHarness(candidates);
	const controller = new LegacyMemoryMigrationController(harness.host);
	const preview = await controller.preview('legacy-memory-stale');
	harness.setSnapshot({ generation: 8, indexState: 'ready', candidates });
	await assert.rejects(() => controller.apply(preview), /stale/i);
	assert.deepEqual(harness.creates, []);
	const freshGeneration = await controller.preview('legacy-memory-content-stale');
	harness.setSnapshot({
		generation: 8,
		indexState: 'ready',
		candidates: [{ ...candidates[0], contentHash: digest('changed content') }],
	});
	await assert.rejects(() => controller.apply(freshGeneration), /stale/i);
	assert.deepEqual(harness.creates, []);

	harness.setSnapshot({ generation: 8, indexState: 'ready', candidates });
	const tampered = structuredClone(await controller.preview('legacy-memory-tamper'));
	tampered.rows[0].suggestions[0].claimKey = 'project:tampered';
	await assert.rejects(() => controller.apply(tampered), /integrity/i);
	assert.deepEqual(harness.creates, []);
}

{
	const candidates = [candidate('recovering', [suggestion('project:recovering')])];
	const harness = createHarness(candidates, { indexState: 'recovering' });
	const controller = new LegacyMemoryMigrationController(harness.host);
	const preview = await controller.preview('legacy-memory-recovering');
	assert.equal(preview.canApply, false);
	assert.equal(preview.executableCount, 0);
	assert.equal(preview.blockedCount, 1);
	await assert.rejects(() => controller.apply(preview), /ready fresh Doctor snapshot/i);
	assert.deepEqual(harness.creates, []);
}

{
	const candidates = [
		candidate('first', [suggestion('project:first')]),
		candidate('second', [suggestion('project:second')]),
	];
	const initial = createHarness(candidates);
	const firstController = new LegacyMemoryMigrationController(initial.host);
	const preview = await firstController.preview('legacy-memory-restart');
	const secondPath = preview.rows.find((row) => row.path.endsWith('/second.md')).proposalPath;
	const failing = createHarness(candidates, { files: initial.files, failPath: secondPath });
	const firstAttempt = await new LegacyMemoryMigrationController(failing.host).apply(preview);
	assert.equal(firstAttempt.createdCount, 1);
	assert.equal(firstAttempt.failedCount, 1);
	assert.match(firstAttempt.recoveryBehavior, /fresh preview and retry/i);

	failing.clearFailure();
	const restarted = new LegacyMemoryMigrationController(failing.host);
	const retryPreview = await restarted.preview('legacy-memory-restart');
	const retry = await restarted.apply(retryPreview);
	assert.equal(retry.alreadyCreatedCount, 1);
	assert.equal(retry.createdCount, 1);
	assert.equal(retry.failedCount, 0);
	assert.deepEqual(failing.sourceWrites, []);
}

{
	const candidates = [candidate('conflict', [suggestion('project:conflict')])];
	const harness = createHarness(candidates);
	const controller = new LegacyMemoryMigrationController(harness.host);
	const preview = await controller.preview('legacy-memory-conflict');
	harness.files.set(preview.rows[0].proposalPath, 'unrelated note');
	const result = await controller.apply(preview);
	assert.equal(result.failedCount, 1);
	assert.equal(result.rows[0].status, 'conflict');
	assert.equal(harness.files.get(preview.rows[0].proposalPath), 'unrelated note');
}

const source = fs.readFileSync(
	path.resolve('src/features/structure/legacy-memory-migration-controller.ts'),
	'utf8'
);
assert.doesNotMatch(source, /\.vault\.delete\s*\(/);
assert.doesNotMatch(source, /trashFile\s*\(/);
assert.doesNotMatch(source, /renameFile\s*\(/);

const mainSource = fs.readFileSync(path.resolve('src/main.ts'), 'utf8');
const inspectorSource = fs.readFileSync(
	path.resolve('src/features/memory/memory-inspector-view.ts'),
	'utf8'
);
assert.match(mainSource, /new LegacyMemoryMigrationController\s*\(/);
assert.match(mainSource, /previewLegacyMemoryMigration\s*\(/);
assert.match(mainSource, /applyLegacyMemoryMigration\s*\(/);
assert.match(mainSource, /Legacy memory migration can only create review proposals/);
const onloadSource = mainSource.slice(
	mainSource.indexOf('async onload()'),
	mainSource.indexOf('\n\tonunload(): void')
);
assert.doesNotMatch(
	onloadSource,
	/legacyMemoryMigrationController\.preview\s*\(/,
	'plugin load must not start a legacy memory migration preview'
);
assert.match(inspectorSource, /aria-live/);
assert.match(inspectorSource, /Preview Doctor candidates/);
assert.match(inspectorSource, /executableCount > 0/);

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('legacy memory migration controller tests passed');
