#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-index-adapter-test-'));
const bundlePath = path.join(tempRoot, 'knowledge-index-adapter.bundle.cjs');
const require = createRequire(import.meta.url);

function createFile(filePath, content, modifiedAt) {
	return {
		path: filePath,
		extension: 'md',
		basename: path.basename(filePath, '.md'),
		stat: {
			size: Buffer.byteLength(content, 'utf8'),
			mtime: modifiedAt,
		},
	};
}

try {
	await build({
		entryPoints: [path.resolve('src/knowledge-index-adapter.ts')],
		outfile: bundlePath,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
	});
	const { ObsidianKnowledgeIndexAdapter } = require(bundlePath);
	const vaultRoot = path.join(tempRoot, 'vault');
	const contents = new Map([
		['01_knowledge/wiki/b.md', '# B\n\nold value'],
		['01_knowledge/wiki/a.md', '# A\n\nstable value'],
	]);
	const files = [
		createFile('01_knowledge/wiki/b.md', contents.get('01_knowledge/wiki/b.md'), 1000),
		createFile('01_knowledge/wiki/a.md', contents.get('01_knowledge/wiki/a.md'), 1000),
	];
	let blockedPath = '';
	let releaseBlockedRead = null;
	let announceBlockedRead = null;
	const blockedReadStarted = new Promise((resolve) => {
		announceBlockedRead = resolve;
	});
	const app = {
		vault: {
			getMarkdownFiles: () => files,
			cachedRead: async (file) => {
				if (file.path === blockedPath) {
					announceBlockedRead?.();
					await new Promise((resolve) => {
						releaseBlockedRead = resolve;
					});
				}
				return contents.get(file.path) || '';
			},
		},
	};

	const adapter = ObsidianKnowledgeIndexAdapter.create(app, vaultRoot);
	assert.equal(adapter.scanSnapshot(vaultRoot).index.index_state, 'initializing');
	assert.equal(adapter.scanSnapshot(vaultRoot).notes.length, 0);
	await adapter.rebuild();
	assert.equal(adapter.scanSnapshot(vaultRoot).index.index_state, 'ready');
	assert.equal(adapter.scanSnapshot(vaultRoot).notes.length, 2);

	blockedPath = '01_knowledge/wiki/a.md';
	const rebuildPromise = adapter.rebuild();
	await blockedReadStarted;
	assert.equal(adapter.scanSnapshot(vaultRoot).index.index_state, 'rebuilding');
	assert.equal((await adapter.knowledgeSnapshot()).index_state, 'rebuilding');
	const updatedContent = '# B\n\nnew value from queued event';
	contents.set('01_knowledge/wiki/b.md', updatedContent);
	files[0].stat = {
		size: Buffer.byteLength(updatedContent, 'utf8'),
		mtime: 2000,
	};
	await adapter.applyModify(files[0]);
	releaseBlockedRead?.();
	await rebuildPromise;
	const updated = adapter.scanSnapshot(vaultRoot).notes.find((note) => note.relativePath === files[0].path);
	assert.match(updated?.content || '', /new value from queued event/);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 7 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
