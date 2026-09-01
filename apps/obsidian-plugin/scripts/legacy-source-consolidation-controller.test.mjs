#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-legacy-source-consolidation-'));
const output = path.join(tempRoot, 'legacy-source-consolidation-controller.cjs');
const require = createRequire(import.meta.url);

await build({
	entryPoints: [path.resolve('src/features/sources/legacy-source-consolidation-controller.ts')],
	outfile: output,
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: ['node20'],
	logLevel: 'silent',
});

const { LegacySourceConsolidationController } = require(output);
const { hashVaultContent, scannedNoteFromContent } = require('@tracekeeper/core');

const files = new Map();
const sourceNotes = Array.from({ length: 17 }, (_, index) => {
	const segment = String(index + 1).padStart(3, '0');
	const relativePath = `01_knowledge/sources/files/full-pdf-test-segment-${segment}.md`;
	const content = [
		'---',
		'type: source_capture',
		'source_kind: file',
		`source: /tmp/test.pdf#content-segment-${segment}`,
		`source_id: source-${segment}`,
		'---',
		`# Segment ${segment}`,
		'',
		`payload-${segment}`,
	].join('\n');
	files.set(relativePath, content);
	return scannedNoteFromContent({
		absolutePath: `/vault/${relativePath}`,
		relativePath,
		fallbackTitle: `full-pdf-test-segment-${segment}`,
		size: Buffer.byteLength(content, 'utf8'),
		modifiedAt: '2026-09-01T00:00:00.000Z',
		content,
	});
});

const folders = [];
const host = {
	async loadSourceNotes() {
		return sourceNotes;
	},
	async listMarkdownPaths() {
		return [...files.keys()].filter((filePath) => filePath.endsWith('.md')).sort();
	},
	async readText(relativePath) {
		return files.get(relativePath) ?? null;
	},
	async createText(relativePath, content) {
		assert.equal(files.has(relativePath), false, `create target already exists: ${relativePath}`);
		files.set(relativePath, content);
	},
	async writeText(relativePath, content) {
		assert.equal(files.has(relativePath), true, `write target is missing: ${relativePath}`);
		files.set(relativePath, content);
	},
	async ensureFolder(relativePath) {
		folders.push(relativePath);
	},
	async moveText(sourcePath, destinationPath) {
		assert.equal(files.has(sourcePath), true, `move source is missing: ${sourcePath}`);
		assert.equal(files.has(destinationPath), false, `move target already exists: ${destinationPath}`);
		files.set(destinationPath, files.get(sourcePath));
		files.delete(sourcePath);
	},
	async listJournalPaths() {
		return [...files.keys()].filter((filePath) => filePath.includes('/source-consolidations/') && filePath.endsWith('.json')).sort();
	},
	now() {
		return '2026-09-01T00:00:00.000Z';
	},
};

const controller = new LegacySourceConsolidationController(host);
const preview = await controller.preview('legacy-source-consolidation-test');
assert.equal(preview.canApply, true);
assert.equal(preview.plan.oldSegmentCount, 17);
assert.equal(preview.plan.newParentCount, 2);
assert.equal(preview.plan.newPartCount, 17);
const expiredAt = '2020-01-01T00:00:00.000Z';
await assert.rejects(
	() => controller.apply({
		...preview,
		expiresAt: expiredAt,
		confirmationToken: hashVaultContent(`${preview.previewHash}\0${preview.plan.planHash}\0${expiredAt}`),
	}, hashVaultContent(`${preview.previewHash}\0${preview.plan.planHash}\0${expiredAt}`)),
	/expired/
);

const first = await controller.apply(preview, preview.confirmationToken);
assert.equal(first.status, 'completed');
assert.equal(first.verifiedCount, 19);
assert.equal(folders.length > 0, true);

const retry = await controller.apply(preview, preview.confirmationToken);
assert.equal(retry.status, 'completed');
assert.equal(retry.conflictCount, 0);
assert.equal(retry.failedCount, 0);

const archivePreview = await controller.previewArchive(preview.migrationId);
assert.equal(archivePreview.canApply, true);
assert.equal(archivePreview.items.length, 17);
const archived = await controller.archive(archivePreview, archivePreview.confirmationToken);
assert.equal(archived.status, 'completed');
assert.equal(archived.verifiedCount, 17);
assert.equal([...files.keys()].filter((filePath) => filePath.startsWith('01_knowledge/sources/files/full-pdf-test-segment-')).length, 0);

const archiveRetry = await controller.archive(archivePreview, archivePreview.confirmationToken);
assert.equal(archiveRetry.status, 'completed');
assert.equal(archiveRetry.conflictCount, 0);

console.log(JSON.stringify({
	suite: 'plugin-legacy-source-consolidation-controller',
	result: 'pass',
	rows: ['preview-bindings', 'materialize-and-hash-verify', 'exact-retry', 'archive-confirmation', 'archive-retry'],
}));
