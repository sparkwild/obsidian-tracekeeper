#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-source-archive-purge-'));
const purgeOutput = path.join(tempRoot, 'source-archive-purge-controller.cjs');
const consolidationOutput = path.join(tempRoot, 'legacy-source-consolidation-controller.cjs');
const modalOutput = path.join(tempRoot, 'source-archive-purge-modal.cjs');
const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL('../', import.meta.url));

for (const [entry, outfile] of [
	[path.join(appRoot, 'src/features/sources/source-archive-purge-controller.ts'), purgeOutput],
	[path.join(appRoot, 'src/features/sources/legacy-source-consolidation-controller.ts'), consolidationOutput],
]) {
	await build({ entryPoints: [path.resolve(entry)], outfile, bundle: true, platform: 'node', format: 'cjs', target: ['node20'], logLevel: 'silent' });
}

await build({
	stdin: {
		contents: [
			"export { SourceArchivePurgeModal } from './src/features/sources/legacy-source-consolidation-modal';",
			"export { SourceArchivePurgeError } from './src/features/sources/source-archive-purge-controller';",
		].join('\n'),
		resolveDir: appRoot,
		sourcefile: 'source-archive-purge-modal-test-entry.ts',
		loader: 'ts',
	},
	outfile: modalOutput,
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: ['node20'],
	logLevel: 'silent',
	plugins: [{
		name: 'obsidian-stub',
		setup(context) {
			context.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian-stub', namespace: 'obsidian-stub' }));
			context.onLoad({ filter: /^obsidian-stub$/, namespace: 'obsidian-stub' }, () => ({
				loader: 'js',
				contents: `
					class FakeElement {
						constructor(options = {}) { this.text = options.text || ''; this.children = []; this.handlers = {}; this.disabled = false; this.focused = false; }
						empty() { this.children = []; this.text = ''; }
						addClass() {}
						createEl(tag, options = {}) { const child = new FakeElement(options); child.tag = tag; this.children.push(child); return child; }
						createDiv(options = {}) { return this.createEl('div', options); }
						createSpan(options = {}) { return this.createEl('span', options); }
						addEventListener(name, handler) { this.handlers[name] = handler; }
						setText(value) { this.text = String(value); }
						setAttr(name, value) { this[name] = value; }
						focus() { this.focused = true; globalThis.__tracekeeperPurgeFocused = this; }
						remove() { this.removed = true; }
					}
					export class Modal {
						constructor(app) { this.app = app; this.contentEl = new FakeElement(); this.titleEl = new FakeElement(); }
						open() { globalThis.__tracekeeperPurgeOpenedModal = this; this.onOpen(); }
						close() { this.closed = true; }
					}
					export class Notice { constructor() {} }
					export function getLanguage() { return 'en'; }
				`,
			}));
		},
	}],
});

const { SourceArchivePurgeController, SourceArchivePurgeError } = require(purgeOutput);
const { SourceArchivePurgeModal, SourceArchivePurgeError: ModalPurgeError } = require(modalOutput);
const { LegacySourceConsolidationController } = require(consolidationOutput);
const {
	InMemoryKnowledgeIndex,
	hashVaultContent,
	renderManagedRelationsBlock,
	scannedNoteFromContent,
} = require('@tracekeeper/core');
const purgeSource = fs.readFileSync(path.join(appRoot, 'src/features/sources/source-archive-purge-controller.ts'), 'utf8');
const modalSource = fs.readFileSync(path.join(appRoot, 'src/features/sources/legacy-source-consolidation-modal.ts'), 'utf8');
const mainSource = fs.readFileSync(path.join(appRoot, 'src/main.ts'), 'utf8');

function findElement(root, predicate) {
	if (predicate(root)) return root;
	for (const child of root.children || []) {
		const match = findElement(child, predicate);
		if (match) return match;
	}
	return null;
}

function modalPreview() {
	return {
		version: 1,
		operationId: 'source-archive-purge-111111111111111111111111',
		snapshotGeneration: 1,
		items: [{ archivePath: '02_archive/source_migrations/test/source.md', replacementPartPath: '01_knowledge/sources/files/source.parts/part-0001.md' }],
		blocked: [], totalBytes: 10, deletionBehavior: 'Vault trash', manifestHash: 'a'.repeat(64),
		confirmationToken: 'token', expiresAt: '2026-09-02T00:05:00.000Z', canApply: true,
	};
}

function legacySegment(number, family) {
	const segment = String(number).padStart(3, '0');
	return [
		'---',
		'type: source_capture',
		'source_kind: file',
		`source: /tmp/book-${family}.pdf#content-segment-${segment}`,
		`source_id: source-${family}-${segment}`,
		'---',
		`# Segment ${segment}`,
		'',
		`payload-${segment}`,
	].join('\n');
}

async function setup({ trashThrowsAfterDelete = false, counts = [2], migrationTreeResult = 'cleaned', migrationTreeFailsOnce = false } = {}) {
	const files = new Map();
	for (let family = 0; family < counts.length; family += 1) {
		for (let number = 1; number <= counts[family]; number += 1) {
			files.set(`01_knowledge/sources/files/book-${family + 1}-segment-${String(number).padStart(3, '0')}.md`, legacySegment(number, family + 1));
		}
	}
	const foldersTrashed = [];
	const sourceNotes = () => [...files.entries()]
		.filter(([filePath]) => filePath.startsWith('01_knowledge/sources/files/') && filePath.endsWith('.md'))
		.map(([filePath, content]) => scannedNoteFromContent({
			absolutePath: `/vault/${filePath}`,
			relativePath: filePath,
			fallbackTitle: path.basename(filePath, '.md'),
			size: Buffer.byteLength(content),
			modifiedAt: '2026-09-02T00:00:00.000Z',
			content,
		}));
	const consolidationHost = {
		async loadSourceNotes() { return sourceNotes(); },
		async listMarkdownPaths() { return [...files.keys()].filter((item) => item.endsWith('.md')).sort(); },
		async readText(filePath) { return files.get(filePath) ?? null; },
		async createText(filePath, content) { assert.equal(files.has(filePath), false); files.set(filePath, content); },
		async writeText(filePath, content) { assert.equal(files.has(filePath), true); files.set(filePath, content); },
		async ensureFolder() {},
		async moveText(sourcePath, destinationPath) { files.set(destinationPath, files.get(sourcePath)); files.delete(sourcePath); },
		async listJournalPaths() { return [...files.keys()].filter((item) => item.includes('/source-consolidations/')).sort(); },
		now() { return '2026-09-02T00:00:00.000Z'; },
	};
	const consolidation = new LegacySourceConsolidationController(consolidationHost);
	const materializePreview = await consolidation.preview('migration-test');
	await consolidation.apply(materializePreview, materializePreview.confirmationToken);
	const archivePreview = await consolidation.previewArchive('migration-test');
	await consolidation.archive(archivePreview, archivePreview.confirmationToken);
	const sourceIndexPath = materializePreview.plan.oldToNewParent[0].newParentPath;
	files.set('01_knowledge/wiki/index.md', '# Wiki');
	files.set('01_knowledge/wiki/book.md', `# Book\n\n${renderManagedRelationsBlock({ sources: [sourceIndexPath] }, 'topic')}`);

	let view;
	let rebuildCalls = 0;
	const rebuild = async () => {
		rebuildCalls += 1;
		const notes = [...files.entries()].filter(([filePath]) => filePath.endsWith('.md')).map(([filePath, content]) => scannedNoteFromContent({
			absolutePath: `/vault/${filePath}`,
			relativePath: filePath,
			fallbackTitle: path.basename(filePath, '.md'),
			size: Buffer.byteLength(content),
			modifiedAt: '2026-09-02T00:00:00.000Z',
			content,
		}));
		const index = new InMemoryKnowledgeIndex({ vaultRoot: tempRoot });
		await index.rebuild({ vaultRoot: tempRoot, scannedAt: '2026-09-02T00:00:00.000Z', notes, errors: [] });
		view = await index.readView();
	};
	await rebuild();
	let trashCalls = 0;
	let migrationTreeCalls = 0;
	const host = {
		async readText(filePath) { return files.get(filePath) ?? null; },
		async createText(filePath, content) { assert.equal(files.has(filePath), false, filePath); files.set(filePath, content); },
		async writeText(filePath, content) { assert.equal(files.has(filePath), true, filePath); files.set(filePath, content); },
		async listPaths(prefix) { return [...files.keys()].filter((item) => item.startsWith(`${prefix}/`)).sort(); },
		async trashFile(filePath) {
			trashCalls += 1;
			assert.equal(files.has(filePath), true);
			files.delete(filePath);
			if (trashThrowsAfterDelete) throw new Error('simulated uncertain trash outcome');
		},
		async trashEmptyMigrationTree(folderPath) {
			migrationTreeCalls += 1;
			foldersTrashed.push(folderPath);
			if (migrationTreeFailsOnce && migrationTreeCalls === 1) throw new Error('simulated migration tree failure');
			return migrationTreeResult;
		},
		async knowledgeReadView() { return view; },
		async rebuildKnowledgeIndex() { await rebuild(); },
		getDeletionBehavior() { return 'Vault trash'; },
		now() { return '2026-09-02T00:00:00.000Z'; },
	};
	return {
		files, host, sourceIndexPath, foldersTrashed,
		trashCalls: () => trashCalls,
		migrationTreeCalls: () => migrationTreeCalls,
		rebuildCalls: () => rebuildCalls,
	};
}

{
	globalThis.window = globalThis;
	let regenerated = 0;
	const preview = modalPreview();
	const plugin = {
		async confirmSourceArchivePurge() {
			throw new ModalPurgeError('PREVIEW_EXPIRED', 'expired');
		},
		async previewSourceArchivePurge() {
			regenerated += 1;
			return preview;
		},
	};
	const modal = new SourceArchivePurgeModal({}, plugin, preview);
	modal.open();
	const confirm = findElement(modal.contentEl, (item) => item.tag === 'button' && item.text.startsWith('Clean '));
	const cancel = findElement(modal.contentEl, (item) => item.tag === 'button' && item.text === 'Cancel');
	confirm.handlers.click();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(confirm.text, 'Regenerate preview');
	assert.equal(confirm.disabled, false);
	assert.equal(cancel.disabled, false);
	assert.equal(globalThis.__tracekeeperPurgeFocused, cancel);
	confirm.handlers.click();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(regenerated, 1);
	assert.notEqual(globalThis.__tracekeeperPurgeOpenedModal, modal);
}

{
	globalThis.window = globalThis;
	const preview = modalPreview();
	const plugin = {
		async confirmSourceArchivePurge() {
			throw new ModalPurgeError('INVALID_CONFIRMATION', 'tampered');
		},
	};
	const modal = new SourceArchivePurgeModal({}, plugin, preview);
	modal.open();
	const confirm = findElement(modal.contentEl, (item) => item.tag === 'button' && item.text.startsWith('Clean '));
	confirm.handlers.click();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(confirm.disabled, true);
	assert.match(modal.statusEl.text, /integrity check failed/i);
}

{
	const fixture = await setup();
	const controller = new SourceArchivePurgeController(fixture.host);
	const preview = await controller.preview();
	fixture.host.now = () => preview.expiresAt;
	await assert.rejects(
		() => controller.confirm(preview, preview.confirmationToken),
		(error) => error instanceof SourceArchivePurgeError && error.code === 'PREVIEW_EXPIRED',
	);
	assert.equal(fixture.trashCalls(), 0);
}

{
	const fixture = await setup();
	const controller = new SourceArchivePurgeController(fixture.host);
	const preview = await controller.preview();
	await assert.rejects(
		() => controller.confirm(preview, 'tampered'),
		(error) => error instanceof SourceArchivePurgeError && error.code === 'INVALID_CONFIRMATION',
	);
	assert.equal(fixture.trashCalls(), 0);
}

{
	const fixture = await setup();
	const controller = new SourceArchivePurgeController(fixture.host);
	const preview = await controller.preview();
	fixture.files.set(preview.items[0].archivePath, `${fixture.files.get(preview.items[0].archivePath)}\ndrift`);
	await assert.rejects(
		() => controller.confirm(preview, preview.confirmationToken),
		(error) => error instanceof SourceArchivePurgeError && error.code === 'PREVIEW_STALE',
	);
	assert.equal(fixture.trashCalls(), 0);
}

{
	const fixture = await setup({ migrationTreeResult: 'retained' });
	const controller = new SourceArchivePurgeController(fixture.host);
	const preview = await controller.preview();
	const receipt = await controller.confirm(preview, preview.confirmationToken);
	assert.equal(receipt.status, 'completed');
	assert.equal(receipt.retainedMigrationRootCount, 1);
	assert.equal(receipt.cleanedMigrationRootCount, 0);
}

{
	const fixture = await setup({ migrationTreeFailsOnce: true });
	const controller = new SourceArchivePurgeController(fixture.host);
	const preview = await controller.preview();
	const partial = await controller.confirm(preview, preview.confirmationToken);
	assert.equal(partial.status, 'partial');
	assert.equal(partial.failedMigrationRootCount, 1);
	const fileTrashCalls = fixture.trashCalls();
	const rebuildCalls = fixture.rebuildCalls();
	const completed = await controller.resume(preview.operationId);
	assert.equal(completed.status, 'completed');
	assert.equal(completed.cleanedMigrationRootCount, 1);
	assert.equal(fixture.trashCalls(), fileTrashCalls);
	assert.equal(fixture.migrationTreeCalls(), 2);
	assert.equal(fixture.rebuildCalls(), rebuildCalls);
}

{
	const fixture = await setup({ counts: [27, 19, 22, 27] });
	const controller = new SourceArchivePurgeController(fixture.host);
	const preview = await controller.preview();
	assert.equal(preview.canApply, true, JSON.stringify(preview.blocked));
	assert.equal(preview.items.length, 95);
	assert.equal(preview.blocked.length, 0);
	assert.equal([...fixture.files.keys()].filter((item) => item.startsWith('01_knowledge/sources/files/') && item.endsWith('.md')).length, 103);
	const partHashes = new Map(preview.items.map((item) => [item.replacementPartPath, hashVaultContent(fixture.files.get(item.replacementPartPath))]));
	const progress = [];
	const receipt = await controller.confirm(preview, preview.confirmationToken, (item) => progress.push(item));
	assert.equal(receipt.status, 'completed');
	assert.equal(receipt.completedCount, 95);
	assert.equal(receipt.cleanedMigrationRootCount, 1);
	assert.equal(receipt.retainedMigrationRootCount, 0);
	assert.equal(receipt.failedMigrationRootCount, 0);
	assert.equal(fixture.trashCalls(), 95);
	assert.equal(preview.items.every((item) => !fixture.files.has(item.archivePath)), true);
	for (const [partPath, partHash] of partHashes) assert.equal(hashVaultContent(fixture.files.get(partPath)), partHash);
	assert.equal(progress.some((item) => item.phase === 'reindex'), true);
	assert.equal(fixture.files.has(receipt.receiptPath), true);
	const retry = await controller.resume(preview.operationId);
	assert.equal(retry.completedCount, 95);
	assert.equal(fixture.trashCalls(), 95);
}

assert.equal(purgeSource.includes('Vault.delete'), false);
assert.equal(purgeSource.includes('.deleteText('), false);
assert.ok(mainSource.includes('this.app.fileManager.trashFile(file)'));
assert.ok(mainSource.includes('trashEmptyMigrationTree'));
assert.ok(mainSource.includes('this.app.fileManager.trashFile(folder)'));
assert.ok(mainSource.includes('/^02_archive\\/source_migrations\\/[^/]+$/u'));
assert.ok(modalSource.includes("setAttr('aria-live', 'polite')"));
assert.ok(modalSource.includes('10_000'));
assert.ok(modalSource.includes('cancel.focus()'));
assert.ok(modalSource.includes("code === 'PREVIEW_EXPIRED'"));
assert.ok(modalSource.includes("ui('重新生成预览', 'Regenerate preview')"));

{
	const fixture = await setup({ trashThrowsAfterDelete: true });
	const controller = new SourceArchivePurgeController(fixture.host);
	const preview = await controller.preview();
	const receipt = await controller.confirm(preview, preview.confirmationToken);
	assert.equal(receipt.status, 'outcome_unknown');
	assert.equal(receipt.outcomeUnknownCount, 2);
	const calls = fixture.trashCalls();
	const retry = await controller.resume(preview.operationId);
	assert.equal(retry.status, 'outcome_unknown');
	assert.equal(fixture.trashCalls(), calls);
}

{
	const fixture = await setup();
	const controller = new SourceArchivePurgeController(fixture.host);
	const preview = await controller.preview();
	const target = preview.items[0].archivePath;
	const originalRead = fixture.host.readText;
	let targetReads = 0;
	fixture.host.readText = async (filePath) => {
		if (filePath === target && ++targetReads === 2) throw new Error('temporary read failure');
		return originalRead(filePath);
	};
	const partial = await controller.confirm(preview, preview.confirmationToken);
	assert.equal(partial.status, 'partial');
	assert.equal(partial.resumableCount, 1);
	fixture.host.readText = originalRead;
	const completed = await controller.resume(preview.operationId);
	assert.equal(completed.status, 'completed');
	assert.equal(completed.completedCount, 2);
	assert.equal(fixture.trashCalls(), 2);
}

console.log(JSON.stringify({
	suite: 'plugin-source-archive-purge-controller',
	result: 'pass',
	rows: ['95-to-103-byte-exact-fixture', 'separate-confirmation', 'trash-only-once', 'replacement-stability', 'preclaim-error-codes', 'modal-preview-regeneration', 'modal-integrity-fail-closed', 'migration-tree-cleanup', 'migration-tree-partial-resume', 'partial-resume', 'outcome-unknown-no-repeat', 'trash-api-only', 'modal-live-progress'],
}));
