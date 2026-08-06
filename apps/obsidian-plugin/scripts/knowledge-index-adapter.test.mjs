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
		extension: path.extname(filePath).slice(1).toLowerCase(),
		basename: path.basename(filePath, path.extname(filePath)),
		stat: {
			size: Buffer.byteLength(content, 'utf8'),
			mtime: modifiedAt,
		},
	};
}

function cachePosition(line = 0) {
	return {
		start: { line, col: 0, offset: 0 },
		end: { line, col: 1, offset: 1 },
	};
}

function emptyCachedMetadata() {
	return {
		frontmatter: {},
		frontmatterLinks: [],
		tags: [],
		headings: [],
		blocks: {},
		links: [],
		embeds: [],
		sections: [],
	};
}

function createMetadataCache(caches = new Map(), options = {}) {
	return {
		getFileCache: (file) => caches.has(file.path) ? caches.get(file.path) : emptyCachedMetadata(),
		getFirstLinkpathDest: options.getFirstLinkpathDest ?? (() => null),
		resolvedLinks: options.resolvedLinks ?? {},
		unresolvedLinks: options.unresolvedLinks ?? {},
		on: () => ({ id: 'metadata-cache-listener' }),
		offref: () => {},
	};
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

async function runCharacterizationRows(suite, rows) {
	const passed = [];
	const failures = [];

	for (const [name, execute] of rows) {
		try {
			await execute();
			passed.push(name);
			process.stdout.write(`${JSON.stringify({ suite, row: name, result: 'pass' })}\n`);
		} catch (error) {
			failures.push({ name, error });
			process.stdout.write(`${JSON.stringify({
				suite,
				row: name,
				result: 'fail',
				error: errorMessage(error),
			})}\n`);
		}
	}

	process.stdout.write(`${JSON.stringify({
		suite,
		result: failures.length === 0 ? 'pass' : 'expected-characterization-failures',
		passed,
		failed: failures.map(({ name }) => name),
	})}\n`);

	if (failures.length > 0) {
		throw new AggregateError(
			failures.map(({ name }) => name),
			`${suite} failed rows: ${failures.map(({ name }) => name).join(', ')}`
		);
	}
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
	const readFile = async (file) => {
		if (file.path === blockedPath) {
			announceBlockedRead?.();
			await new Promise((resolve) => {
				releaseBlockedRead = resolve;
			});
		}
		return contents.get(file.path) || '';
	};
	const app = {
		vault: {
			getMarkdownFiles: () => files,
			cachedRead: readFile,
			read: readFile,
		},
		metadataCache: createMetadataCache(),
	};

	const adapter = ObsidianKnowledgeIndexAdapter.create(app, vaultRoot);
	assert.equal(adapter.scanSnapshot(vaultRoot).index.index_state, 'initializing');
	assert.equal(adapter.scanSnapshot(vaultRoot).notes.length, 0);
	await adapter.rebuild();
	assert.equal(adapter.scanSnapshot(vaultRoot).index.index_state, 'ready');
	assert.equal(adapter.scanSnapshot(vaultRoot).notes.length, 2);
	const readView = await adapter.knowledgeReadView(vaultRoot);
	assert.equal(readView.index_state, 'ready');
	assert.equal(readView.catalog.size, 2);
	assert.equal(Object.hasOwn(readView.catalog.values().next().value, 'content'), false);
	assert.equal(await adapter.knowledgeReadView(path.join(tempRoot, 'different-vault')), null);

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

	process.stdout.write(`${JSON.stringify({
		suite: 'obsidian-index-adapter-legacy-baseline',
		result: 'pass',
		checks: 11,
	})}\n`);

	await runCharacterizationRows('obsidian-native-metadata-and-events', [
		['metadata-cache-is-semantic-authority', async () => {
			const filePath = '01_knowledge/wiki/native-authority.md';
			const rawContent = [
				'---',
				'title: Raw title',
				'aliases: [Raw alias]',
				'---',
				'# Raw heading',
			].join('\n');
			const file = createFile(filePath, rawContent, 1000);
			const nativeCaches = new Map([
				[filePath, {
					frontmatter: {
						title: 'Native title',
						aliases: ['Native alias'],
						nested: { owners: ['Ada', 'Lin'] },
					},
					frontmatterLinks: [],
					tags: [{ tag: '#缓存/标签', position: cachePosition(1) }],
					headings: [{ heading: 'Cached heading', level: 2, position: cachePosition(2) }],
					blocks: {
						'cached-block': { id: 'cached-block', position: cachePosition(3) },
					},
					links: [],
					embeds: [],
					sections: [],
				}],
			]);
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [file],
					cachedRead: async () => rawContent,
					read: async () => rawContent,
				},
				metadataCache: createMetadataCache(nativeCaches),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			const note = (await rowAdapter.knowledgeSnapshot()).notes.get(filePath);
			assert.equal(note?.title, 'Native title');
			assert.deepEqual(note?.frontmatter.nested, { owners: ['Ada', 'Lin'] });
			assert.deepEqual(note?.tags, ['缓存/标签']);
			assert.deepEqual(note?.headings, ['Cached heading']);
			assert.deepEqual(note?.blockIds, ['cached-block']);
		}],
		['metadata-cache-resolved-link-authority', async () => {
			const sourcePath = '01_knowledge/wiki/source.md';
			const targetPath = '01_knowledge/wiki/topics/target.md';
			const sourceContent = '# Source\n\n[[Target|Alias]]';
			const targetContent = '# Target';
			const sourceFile = createFile(sourcePath, sourceContent, 1000);
			const targetFile = createFile(targetPath, targetContent, 1000);
			const nativeCaches = new Map([
				[sourcePath, {
					...emptyCachedMetadata(),
					links: [{
						link: 'Target',
						original: '[[Target|Alias]]',
						displayText: 'Alias',
						position: cachePosition(2),
					}],
				}],
				[targetPath, emptyCachedMetadata()],
			]);
			const rowContents = new Map([
				[sourcePath, sourceContent],
				[targetPath, targetContent],
			]);
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [sourceFile, targetFile],
					cachedRead: async (file) => rowContents.get(file.path) || '',
					read: async (file) => rowContents.get(file.path) || '',
				},
				metadataCache: createMetadataCache(nativeCaches, {
					getFirstLinkpathDest: (linkPath) => linkPath === 'Target' ? targetFile : null,
					resolvedLinks: { [sourcePath]: { [targetPath]: 1 } },
				}),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.deepEqual(snapshot.graph.outgoing.get(sourcePath), [targetPath]);
			assert.deepEqual(snapshot.graph.incoming.get(targetPath), [sourcePath]);
			assert.equal(snapshot.graph.incoming.has('Target'), false);
		}],
		['metadata-cache-native-edge-retains-binary-target', async () => {
			const sourcePath = '01_knowledge/wiki/native-binary-source.md';
			const targetPath = '01_knowledge/sources/attachments/diagram.png';
			const sourceContent = '# Source\n\n![[01_knowledge/sources/attachments/diagram.png]]';
			const sourceFile = createFile(sourcePath, sourceContent, 1000);
			const targetFile = createFile(targetPath, 'binary', 1000);
			const nativeCaches = new Map([
				[sourcePath, {
					...emptyCachedMetadata(),
					embeds: [{
						link: '01_knowledge/sources/attachments/diagram.png',
						original: '![[01_knowledge/sources/attachments/diagram.png]]',
						position: cachePosition(2),
					}],
				}],
			]);
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [sourceFile],
					cachedRead: async () => sourceContent,
					read: async () => sourceContent,
				},
				metadataCache: createMetadataCache(nativeCaches, {
					getFirstLinkpathDest: (linkPath) =>
						linkPath === '01_knowledge/sources/attachments/diagram.png'
							? targetFile
							: null,
				}),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.deepEqual(snapshot.graph.outgoing.get(sourcePath), [targetPath]);
			assert.deepEqual(snapshot.graph.incoming.get(targetPath), [sourcePath]);
			assert.equal(snapshot.graph.edges[0]?.kind, 'embed');
			assert.equal(snapshot.graph.unresolvedEdges.length, 0);
		}],
		['metadata-cache-unresolved-link-remains-authoritative', async () => {
			const sourcePath = '01_knowledge/wiki/native-unresolved-source.md';
			const targetPath = '01_knowledge/wiki/native-unresolved-target.md';
			const sourceContent = '# Source\n\n[[Native Maybe]]';
			const targetContent = '# Native Maybe';
			const sourceFile = createFile(sourcePath, sourceContent, 1000);
			const targetFile = createFile(targetPath, targetContent, 1000);
			const nativeCaches = new Map([
				[sourcePath, {
					...emptyCachedMetadata(),
					links: [{
						link: 'Native Maybe',
						original: '[[Native Maybe]]',
						position: cachePosition(2),
					}],
				}],
				[targetPath, {
					...emptyCachedMetadata(),
					frontmatter: {
						title: 'Native Maybe',
						aliases: ['Native Maybe'],
					},
				}],
			]);
			const rowContents = new Map([
				[sourcePath, sourceContent],
				[targetPath, targetContent],
			]);
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [sourceFile, targetFile],
					cachedRead: async (file) => rowContents.get(file.path) || '',
					read: async (file) => rowContents.get(file.path) || '',
				},
				metadataCache: createMetadataCache(nativeCaches, {
					getFirstLinkpathDest: () => null,
				}),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.deepEqual(snapshot.graph.outgoing.get(sourcePath), []);
			assert.deepEqual(snapshot.graph.incoming.get(targetPath), []);
			assert.deepEqual(snapshot.graph.unresolvedEdges[0]?.resolution, {
				status: 'unresolved',
				reason: 'not_found',
				authority: 'native',
			});
		}],
		['missing-metadata-remains-visible', async () => {
			const filePath = '01_knowledge/wiki/missing-metadata.md';
			const content = '# Missing metadata';
			const file = createFile(filePath, content, 1000);
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [file],
					cachedRead: async () => content,
					read: async () => content,
				},
				metadataCache: {
					...createMetadataCache(),
					getFileCache: () => null,
				},
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.equal(['initializing', 'degraded'].includes(snapshot.index_state), true);
		}],
		['delayed-metadata-converges-after-event', async () => {
			const filePath = '01_knowledge/wiki/delayed-metadata.md';
			const content = [
				'---',
				'title: Raw delayed title',
				'---',
				'# Delayed metadata',
			].join('\n');
			const file = createFile(filePath, content, 1000);
			let cache = null;
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [file],
					cachedRead: async () => content,
					read: async () => content,
				},
				metadataCache: {
					...createMetadataCache(),
					getFileCache: () => cache,
				},
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			cache = {
				...emptyCachedMetadata(),
				frontmatter: { title: 'Native delayed title' },
			};
			await rowAdapter.applyModify(file);
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.equal(snapshot.index_state, 'ready');
			assert.equal(snapshot.notes.get(filePath)?.title, 'Native delayed title');
			assert.deepEqual(rowAdapter.scanSnapshot(vaultRoot)?.errors, []);
		}],
		['metadata-resolution-event-updates-stable-content-hash', async () => {
			const sourcePath = '01_knowledge/wiki/metadata-resolve-source.md';
			const firstTargetPath = '01_knowledge/wiki/topics/first-resolved-target.md';
			const secondTargetPath = '01_knowledge/wiki/topics/second-resolved-target.md';
			const sourceContent = '# Source\n\n[[Stable Alias]]';
			const firstTargetContent = '# First target';
			const secondTargetContent = '# Second target';
			const sourceFile = createFile(sourcePath, sourceContent, 1000);
			const firstTargetFile = createFile(firstTargetPath, firstTargetContent, 1000);
			const secondTargetFile = createFile(secondTargetPath, secondTargetContent, 1000);
			const sourceCache = {
				...emptyCachedMetadata(),
				links: [{
					link: 'Stable Alias',
					original: '[[Stable Alias]]',
					position: cachePosition(2),
				}],
			};
			const nativeCaches = new Map([
				[sourcePath, sourceCache],
				[firstTargetPath, emptyCachedMetadata()],
				[secondTargetPath, emptyCachedMetadata()],
			]);
			const rowContents = new Map([
				[sourcePath, sourceContent],
				[firstTargetPath, firstTargetContent],
				[secondTargetPath, secondTargetContent],
			]);
			let resolvedTarget = firstTargetFile;
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [sourceFile, firstTargetFile, secondTargetFile],
					cachedRead: async (file) => rowContents.get(file.path) || '',
					read: async (file) => rowContents.get(file.path) || '',
				},
				metadataCache: createMetadataCache(nativeCaches, {
					getFirstLinkpathDest: (linkPath) =>
						linkPath === 'Stable Alias' ? resolvedTarget : null,
				}),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			const before = await rowAdapter.knowledgeSnapshot();
			resolvedTarget = secondTargetFile;
			await rowAdapter.applyModify(sourceFile, sourceContent, sourceCache);
			const after = await rowAdapter.knowledgeSnapshot();
			assert.equal(
				after.notes.get(sourcePath)?.contentHash,
				before.notes.get(sourcePath)?.contentHash
			);
			assert.deepEqual(after.graph.outgoing.get(sourcePath), [secondTargetPath]);
			assert.equal(after.generation, before.generation + 1);
		}],
		['same-size-same-mtime-modify-converges', async () => {
			const filePath = '01_knowledge/wiki/same-tuple.md';
			const initialContent = '# Same\n\nalpha';
			const replacementContent = '# Same\n\nbravo';
			assert.equal(Buffer.byteLength(initialContent), Buffer.byteLength(replacementContent));
			const file = createFile(filePath, initialContent, 1000);
			const rowContents = new Map([[filePath, initialContent]]);
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [file],
					cachedRead: async (entry) => rowContents.get(entry.path) || '',
					read: async (entry) => rowContents.get(entry.path) || '',
				},
				metadataCache: createMetadataCache(),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			const before = await rowAdapter.knowledgeSnapshot();
			rowContents.set(filePath, replacementContent);
			await rowAdapter.applyModify(file);
			const after = await rowAdapter.knowledgeSnapshot();
			assert.notEqual(after.notes.get(filePath)?.contentHash, before.notes.get(filePath)?.contentHash);
			assert.match(after.notes.get(filePath)?.excerptSource ?? '', /bravo/);
			assert.equal(after.generation, before.generation + 1);
		}],
		['mismatched-delete-removes-ghost', async () => {
			const filePath = '01_knowledge/wiki/delete-ghost.md';
			const content = '# Delete ghost';
			const file = createFile(filePath, content, 1000);
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [file],
					cachedRead: async () => content,
					read: async () => content,
				},
				metadataCache: createMetadataCache(),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			file.stat = {
				size: file.stat.size + 1,
				mtime: 2000,
			};
			await rowAdapter.applyDelete(file);
			assert.equal((await rowAdapter.knowledgeSnapshot()).notes.has(filePath), false);
		}],
		['rename-markdown-removes-old-identity', async () => {
			const oldPath = '01_knowledge/wiki/before-rename.md';
			const newPath = '01_knowledge/wiki/after-rename.md';
			const content = '# Rename markdown';
			const file = createFile(oldPath, content, 1000);
			const rowContents = new Map([[oldPath, content]]);
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [file],
					cachedRead: async (entry) => rowContents.get(entry.path) || '',
					read: async (entry) => rowContents.get(entry.path) || '',
				},
				metadataCache: createMetadataCache(),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			rowContents.delete(oldPath);
			rowContents.set(newPath, content);
			file.path = newPath;
			file.basename = 'after-rename';
			file.stat = {
				size: file.stat.size + 1,
				mtime: 2000,
			};
			await rowAdapter.applyRename(file, oldPath);
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.equal(snapshot.notes.has(oldPath), false);
			assert.equal(snapshot.notes.has(newPath), true);
		}],
		['rename-refreshes-resolved-edges', async () => {
			const sourcePath = '01_knowledge/wiki/rename-source.md';
			const oldTargetPath = '01_knowledge/wiki/topics/rename-target.md';
			const newTargetPath = '01_knowledge/wiki/archive/rename-target.md';
			const sourceContent = '# Source\n\n[[Rename Target]]';
			const targetContent = '# Rename target';
			const sourceFile = createFile(sourcePath, sourceContent, 1000);
			const targetFile = createFile(oldTargetPath, targetContent, 1000);
			const rowContents = new Map([
				[sourcePath, sourceContent],
				[oldTargetPath, targetContent],
			]);
			const nativeCaches = new Map([
				[sourcePath, {
					...emptyCachedMetadata(),
					links: [{
						link: 'Rename Target',
						original: '[[Rename Target]]',
						position: cachePosition(2),
					}],
				}],
				[oldTargetPath, emptyCachedMetadata()],
			]);
			const resolvedLinks = {
				[sourcePath]: { [oldTargetPath]: 1 },
			};
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [sourceFile, targetFile],
					cachedRead: async (file) => rowContents.get(file.path) || '',
					read: async (file) => rowContents.get(file.path) || '',
				},
				metadataCache: createMetadataCache(nativeCaches, {
					getFirstLinkpathDest: (linkPath) => linkPath === 'Rename Target' ? targetFile : null,
					resolvedLinks,
				}),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			rowContents.delete(oldTargetPath);
			rowContents.set(newTargetPath, targetContent);
			nativeCaches.delete(oldTargetPath);
			nativeCaches.set(newTargetPath, emptyCachedMetadata());
			delete resolvedLinks[sourcePath][oldTargetPath];
			resolvedLinks[sourcePath][newTargetPath] = 1;
			targetFile.path = newTargetPath;
			targetFile.basename = 'rename-target';
			await rowAdapter.applyRename(targetFile, oldTargetPath);
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.equal(snapshot.notes.has(oldTargetPath), false);
			assert.equal(snapshot.notes.has(newTargetPath), true);
			assert.deepEqual(snapshot.graph.outgoing.get(sourcePath), [newTargetPath]);
			assert.deepEqual(snapshot.graph.incoming.get(newTargetPath), [sourcePath]);
			assert.equal(snapshot.graph.incoming.has(oldTargetPath), false);
		}],
		['rename-pipeline-cannot-be-overtaken-by-later-modify', async () => {
			const oldPath = '01_knowledge/wiki/ordered-before.md';
			const newPath = '01_knowledge/wiki/ordered-after.md';
			const initialContent = '# Ordered\n\nbefore';
			const laterContent = '# Ordered\n\nafter';
			const file = createFile(oldPath, initialContent, 1000);
			const rowContents = new Map([[oldPath, initialContent]]);
			const nativeCaches = new Map([[oldPath, emptyCachedMetadata()]]);
			let blockNextRead = false;
			let releaseRead;
			let announceRead;
			const blockedRead = new Promise((resolve) => {
				announceRead = resolve;
			});
			const readFile = async (entry) => {
				if (blockNextRead && entry.path === newPath) {
					blockNextRead = false;
					announceRead?.();
					await new Promise((resolve) => {
						releaseRead = resolve;
					});
				}
				return rowContents.get(entry.path) || '';
			};
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [file],
					cachedRead: readFile,
					read: readFile,
				},
				metadataCache: createMetadataCache(nativeCaches),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			rowContents.delete(oldPath);
			rowContents.set(newPath, initialContent);
			nativeCaches.delete(oldPath);
			nativeCaches.set(newPath, emptyCachedMetadata());
			file.path = newPath;
			file.basename = 'ordered-after';
			blockNextRead = true;
			const renamePromise = rowAdapter.applyRename(file, oldPath);
			await blockedRead;
			rowContents.set(newPath, laterContent);
			let modifySettled = false;
			const modifyPromise = rowAdapter
				.applyModify(file, laterContent, nativeCaches.get(newPath))
				.finally(() => {
					modifySettled = true;
				});
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(modifySettled, false);
			releaseRead?.();
			await Promise.all([renamePromise, modifyPromise]);
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.equal(snapshot.notes.has(oldPath), false);
			assert.match(snapshot.notes.get(newPath)?.excerptSource ?? '', /after/);
			assert.equal(snapshot.event_sequence, 2);
		}],
		['rename-markdown-to-non-markdown-removes-old-identity', async () => {
			const oldPath = '01_knowledge/wiki/before-extension-rename.md';
			const content = '# Rename extension';
			const file = createFile(oldPath, content, 1000);
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [file],
					cachedRead: async () => content,
					read: async () => content,
				},
				metadataCache: createMetadataCache(),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			file.path = '01_knowledge/wiki/after-extension-rename.txt';
			file.basename = 'after-extension-rename';
			file.extension = 'txt';
			file.stat = {
				size: file.stat.size + 1,
				mtime: 2000,
			};
			await rowAdapter.applyRename(file, oldPath);
			assert.equal((await rowAdapter.knowledgeSnapshot()).notes.has(oldPath), false);
		}],
		['queued-replay-preserves-sequence-and-generation', async () => {
			const eventPath = '01_knowledge/wiki/queued-event.md';
			const blockerPath = '01_knowledge/wiki/queued-blocker.md';
			const initialContent = '# Queue\n\nAAAA';
			const secondContent = '# Queue\n\nBBBB';
			const finalContent = '# Queue\n\nCCCC';
			assert.equal(Buffer.byteLength(initialContent), Buffer.byteLength(secondContent));
			assert.equal(Buffer.byteLength(secondContent), Buffer.byteLength(finalContent));
			const eventFile = createFile(eventPath, initialContent, 1000);
			const blockerFile = createFile(blockerPath, '# Blocker', 1000);
			const rowContents = new Map([
				[eventPath, initialContent],
				[blockerPath, '# Blocker'],
			]);
			let blockNextRead = false;
			let releaseRead;
			let announceRead;
			const blockedRead = new Promise((resolve) => {
				announceRead = resolve;
			});
			const readFile = async (file) => {
				if (blockNextRead && file.path === blockerPath) {
					blockNextRead = false;
					announceRead?.();
					await new Promise((resolve) => {
						releaseRead = resolve;
					});
				}
				return rowContents.get(file.path) || '';
			};
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [eventFile, blockerFile],
					cachedRead: readFile,
					read: readFile,
				},
				metadataCache: createMetadataCache(),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			blockNextRead = true;
			const rebuildPromise = rowAdapter.rebuild();
			await blockedRead;
			rowContents.set(eventPath, secondContent);
			await rowAdapter.applyModify(eventFile);
			rowContents.set(eventPath, finalContent);
			await rowAdapter.applyModify(eventFile);
			assert.equal(rowAdapter.pendingEvents.size, 1);
			assert.equal(rowAdapter.pendingRescanEvent, null);
			assert.deepEqual([...rowAdapter.pendingEvents.values()], [{
				kind: 'upsert',
				eventKind: 'modify',
				path: eventPath,
				sequence: 2,
			}]);
			assert.equal(JSON.stringify([...rowAdapter.pendingEvents.values()]).includes('CCCC'), false);
			releaseRead?.();
			const report = await rebuildPromise;
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.match(snapshot.notes.get(eventPath)?.excerptSource ?? '', /CCCC/);
			assert.equal(report.generation, snapshot.generation);
			assert.equal(report.event_sequence, snapshot.event_sequence);
			assert.equal(snapshot.event_sequence, 2);
			assert.equal(snapshot.index_state, 'ready');
		}],
		['queued-replay-recovers-after-one-event-fails', async () => {
			const blockerPath = '01_knowledge/wiki/replay-failure-blocker.md';
			const failedPath = '01_knowledge/wiki/replay-failure-first.md';
			const laterPath = '01_knowledge/wiki/replay-failure-later.md';
			const blockerFile = createFile(blockerPath, '# Blocker', 1000);
			const failedFile = createFile(failedPath, '# First', 1000);
			const laterFile = createFile(laterPath, '# Later', 1000);
			const files = [blockerFile];
			const rowContents = new Map([
				[blockerPath, '# Blocker'],
				[failedPath, '# First'],
				[laterPath, '# Later'],
			]);
			let blockNextRead = false;
			let failFirstReplayRead = false;
			let releaseRead;
			let announceRead;
			const blockedRead = new Promise((resolve) => {
				announceRead = resolve;
			});
			const readFile = async (file) => {
				if (blockNextRead && file.path === blockerPath) {
					blockNextRead = false;
					announceRead?.();
					await new Promise((resolve) => {
						releaseRead = resolve;
					});
				}
				if (failFirstReplayRead && file.path === failedPath) {
					failFirstReplayRead = false;
					throw new Error('injected queued replay failure');
				}
				return rowContents.get(file.path) || '';
			};
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [...files],
					cachedRead: readFile,
					read: readFile,
				},
				metadataCache: createMetadataCache(),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			blockNextRead = true;
			const rebuildPromise = rowAdapter.rebuild();
			await blockedRead;
			files.push(failedFile, laterFile);
			failFirstReplayRead = true;
			await rowAdapter.applyCreate(failedFile);
			await rowAdapter.applyCreate(laterFile);
			releaseRead?.();
			const report = await rebuildPromise;
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.equal(snapshot.notes.has(failedPath), true);
			assert.equal(snapshot.notes.has(laterPath), true);
			assert.equal(snapshot.event_sequence, 2);
			assert.equal(snapshot.index_state, 'ready');
			assert.match(report.warnings.join('\n'), /queued replay/i);
		}],
		['queued-event-bound-falls-back-to-current-vault-rescan', async () => {
			const blockerPath = '01_knowledge/wiki/bounded-queue-blocker.md';
			const blockerFile = createFile(blockerPath, '# Blocker', 1000);
			let blockNextRead = false;
			let releaseRead;
			let announceRead;
			const blockedRead = new Promise((resolve) => {
				announceRead = resolve;
			});
			const readFile = async () => {
				if (blockNextRead) {
					blockNextRead = false;
					announceRead?.();
					await new Promise((resolve) => {
						releaseRead = resolve;
					});
				}
				return '# Blocker';
			};
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [blockerFile],
					cachedRead: readFile,
					read: readFile,
				},
				metadataCache: createMetadataCache(),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			blockNextRead = true;
			const rebuildPromise = rowAdapter.rebuild();
			await blockedRead;
			const eventCount = ObsidianKnowledgeIndexAdapter.MAX_PENDING_INDEX_EVENTS + 1;
			for (let index = 0; index < eventCount; index += 1) {
				await rowAdapter.applyDelete(createFile(
					`01_knowledge/wiki/bounded-${index}.md`,
					'',
					1000
				));
			}
			assert.equal(rowAdapter.pendingEvents.size, 0);
			assert.equal(rowAdapter.pendingRescanEvent?.sequence, eventCount);
			releaseRead?.();
			const report = await rebuildPromise;
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.equal(snapshot.event_sequence, eventCount);
			assert.equal(snapshot.index_state, 'ready');
			assert.match(report.warnings.join('\n'), /queued-event bound/i);
		}],
		['queued-replay-retains-failed-event-when-recovery-rebuild-fails', async () => {
			const blockerPath = '01_knowledge/wiki/recovery-failure-blocker.md';
			const createdPath = '01_knowledge/wiki/recovery-failure-created.md';
			const blockerFile = createFile(blockerPath, '# Blocker', 1000);
			const createdFile = createFile(createdPath, '# Created', 1000);
			const files = [blockerFile];
			const rowContents = new Map([
				[blockerPath, '# Blocker'],
				[createdPath, '# Created'],
			]);
			let listingCount = 0;
			let failRecoveryListing = false;
			let failFirstReplayRead = false;
			let blockNextRead = false;
			let releaseRead;
			let announceRead;
			const blockedRead = new Promise((resolve) => {
				announceRead = resolve;
			});
			const readFile = async (file) => {
				if (blockNextRead && file.path === blockerPath) {
					blockNextRead = false;
					announceRead?.();
					await new Promise((resolve) => {
						releaseRead = resolve;
					});
				}
				if (failFirstReplayRead && file.path === createdPath) {
					failFirstReplayRead = false;
					throw new Error('injected queued event failure');
				}
				return rowContents.get(file.path) || '';
			};
			const rowApp = {
				vault: {
					getAbstractFileByPath: (filePath) => files.find((file) => file.path === filePath) ?? null,
					getMarkdownFiles: () => {
						listingCount += 1;
						if (failRecoveryListing && listingCount === 3) {
							throw new Error('injected recovery listing failure');
						}
						return [...files];
					},
					cachedRead: readFile,
					read: readFile,
				},
				metadataCache: createMetadataCache(),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			blockNextRead = true;
			const rebuildPromise = rowAdapter.rebuild();
			await blockedRead;
			files.push(createdFile);
			failFirstReplayRead = true;
			failRecoveryListing = true;
			await rowAdapter.applyCreate(createdFile);
			releaseRead?.();
			await assert.rejects(rebuildPromise, /injected recovery listing failure/);
			assert.equal((await rowAdapter.knowledgeSnapshot()).index_state, 'initializing');
			assert.equal(rowAdapter.pendingEvents.size, 0);
			assert.equal(rowAdapter.pendingRescanEvent?.sequence, 1);

			failRecoveryListing = false;
			await rowAdapter.rebuild();
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.equal(snapshot.notes.has(createdPath), true);
			assert.equal(snapshot.event_sequence, 1);
			assert.equal(snapshot.index_state, 'ready');
			assert.equal(rowAdapter.pendingEvents.size, 0);
			assert.equal(rowAdapter.pendingRescanEvent, null);
		}],
		['rebuild-finalization-cannot-strand-a-late-event', async () => {
			const filePath = '01_knowledge/wiki/finalization-window.md';
			const content = '# Finalization window';
			const file = createFile(filePath, content, 1000);
			const files = [file];
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [...files],
					cachedRead: async () => content,
					read: async () => content,
				},
				metadataCache: createMetadataCache(),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			await rowAdapter.rebuild();
			const originalReplayPendingEvents = rowAdapter.replayPendingEvents.bind(rowAdapter);
			let deletePromise;
			let injectDelete = true;
			rowAdapter.replayPendingEvents = async (...args) => {
				const warnings = await originalReplayPendingEvents(...args);
				if (injectDelete) {
					injectDelete = false;
					files.splice(0);
					deletePromise = rowAdapter.applyDelete(file);
					await deletePromise;
				}
				return warnings;
			};
			await rowAdapter.rebuild();
			await deletePromise;
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.equal(snapshot.notes.has(filePath), false);
			assert.equal(snapshot.event_sequence, 1);
			assert.equal(rowAdapter.pendingEvents.size, 0);
			assert.equal(rowAdapter.pendingRescanEvent, null);
			assert.equal(snapshot.index_state, 'ready');
		}],
		['queued-create-reloads-content-after-baseline-observation', async () => {
			const eventPath = '01_knowledge/wiki/stale-create.md';
			const blockerPath = '01_knowledge/wiki/stale-create-blocker.md';
			const oldContent = '# old\n';
			const newContent = '# new\n';
			assert.equal(Buffer.byteLength(oldContent), Buffer.byteLength(newContent));
			const eventFile = createFile(eventPath, oldContent, 1000);
			const blockerFile = createFile(blockerPath, '# Blocker', 1000);
			const rowContents = new Map([
				[eventPath, oldContent],
				[blockerPath, '# Blocker'],
			]);
			let releaseRead;
			let announceRead;
			const blockedRead = new Promise((resolve) => {
				announceRead = resolve;
			});
			const readFile = async (file) => {
				if (file.path === blockerPath && !releaseRead) {
					announceRead?.();
					await new Promise((resolve) => {
						releaseRead = resolve;
					});
				}
				return rowContents.get(file.path) || '';
			};
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [eventFile, blockerFile],
					cachedRead: readFile,
					read: readFile,
				},
				metadataCache: createMetadataCache(),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			const rebuildPromise = rowAdapter.rebuild();
			await blockedRead;
			rowContents.set(eventPath, newContent);
			await rowAdapter.applyCreate(eventFile);
			releaseRead?.();
			await rebuildPromise;
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.match(snapshot.notes.get(eventPath)?.excerptSource ?? '', /# new/);
			assert.equal(snapshot.event_sequence, 1);
			assert.equal(snapshot.index_state, 'ready');
		}],
		['startup-existing-create-keeps-one-baseline-and-one-current-event-read', async () => {
			const filePath = '01_knowledge/wiki/startup-existing.md';
			const content = '# Startup existing';
			const file = createFile(filePath, content, 1000);
			let readCount = 0;
			let releaseFirstRead;
			let announceFirstRead;
			const firstReadStarted = new Promise((resolve) => {
				announceFirstRead = resolve;
			});
			const readFile = async () => {
				readCount += 1;
				if (readCount === 1) {
					announceFirstRead?.();
					await new Promise((resolve) => {
						releaseFirstRead = resolve;
					});
				}
				return content;
			};
			const rowApp = {
				vault: {
					getMarkdownFiles: () => [file],
					cachedRead: readFile,
					read: readFile,
				},
				metadataCache: createMetadataCache(),
			};
			const rowAdapter = ObsidianKnowledgeIndexAdapter.create(rowApp, vaultRoot);
			const rebuildPromise = rowAdapter.rebuild();
			await firstReadStarted;
			await rowAdapter.applyCreate(file);
			releaseFirstRead?.();
			await rebuildPromise;
			const snapshot = await rowAdapter.knowledgeSnapshot();
			assert.equal(readCount, 2);
			assert.equal(snapshot.notes.size, 1);
			assert.equal(snapshot.generation, 1);
			assert.equal(snapshot.event_sequence, 1);
		}],
	]);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
