#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-obsidian-repository-test-'));
const bundlePath = path.join(tempRoot, 'obsidian-vault-repository.bundle.cjs');
const require = createRequire(import.meta.url);

try {
	await build({
		stdin: {
			contents: [
				"export { ObsidianVaultRepository } from './src/adapters/obsidian-vault-repository';",
				"export { TFile, TFolder } from 'obsidian';",
			].join('\n'),
			resolveDir: path.resolve('.'),
			sourcefile: 'obsidian-vault-repository-test-entry.ts',
			loader: 'ts',
		},
		outfile: bundlePath,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
		plugins: [{
			name: 'fake-obsidian',
			setup(builder) {
				builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'fake' }));
				builder.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
					contents: [
						'export class TFile {}',
						'export class TFolder {}',
						'export class Vault {}',
						'export const normalizePath = (value) => value.replace(/\\\\/g, "/").replace(/\\/{2,}/g, "/");',
					].join('\n'),
					loader: 'js',
				}));
			},
		}],
	});
	const { ObsidianVaultRepository, TFile, TFolder } = require(bundlePath);

	const records = new Map();
	let readCalls = 0;
	const makeFile = (filePath, content, mtime = 1000) => {
		const file = new TFile();
		Object.assign(file, {
			path: filePath,
			extension: path.extname(filePath).slice(1),
			stat: { size: Buffer.byteLength(content, 'utf8'), mtime },
		});
		records.set(filePath, { file, content });
		return file;
	};

	const vault = {
		configDir: '.obsidian',
		getAbstractFileByPath: (filePath) => records.get(filePath)?.file ?? null,
		read: async (file) => {
			readCalls += 1;
			return records.get(file.path).content;
		},
		cachedRead: async () => {
			throw new Error('cachedRead must not be used for repository CAS content');
		},
		create: async (filePath, content) => makeFile(filePath, content, 2000),
		modify: async (file, content) => {
			const record = records.get(file.path);
			record.content = content;
			file.stat = { size: Buffer.byteLength(content, 'utf8'), mtime: file.stat.mtime + 1 };
		},
		getFiles: () => Array.from(records.values(), (record) => record.file).filter((file) => file instanceof TFile),
		createFolder: async (folderPath) => {
			const folder = new TFolder();
			Object.assign(folder, { path: folderPath, children: [] });
			records.set(folderPath, { file: folder, content: '' });
		},
	};

	const existing = makeFile('01_knowledge/wiki/topic.md', '# Topic\nfresh', 1000);
	const repository = new ObsidianVaultRepository(vault);
	const firstRead = await repository.readText(existing.path);
	assert.equal(firstRead.content, '# Topic\nfresh');
	assert.equal(readCalls, 1);
	await assert.rejects(() => repository.createText(existing.path, 'duplicate'), /already exists/);
	await assert.rejects(() => repository.replaceText(existing.path, 'stale-version', 'overwrite'), /CAS check failed/);
	const replacement = await repository.replaceText(existing.path, firstRead.version, '# Topic\nupdated');
	assert.equal(records.get(existing.path).content, '# Topic\nupdated');
	assert.equal(replacement.path, existing.path);
	const created = await repository.createText('01_knowledge/wiki/new.md', '# New');
	assert.equal(created.path, '01_knowledge/wiki/new.md');
	makeFile('.obsidian/private.md', '# hidden');
	const listed = await repository.listMarkdown();
	assert.deepEqual(listed.map((entry) => entry.path), [
		'01_knowledge/wiki/new.md',
		'01_knowledge/wiki/topic.md',
	]);
	await assert.rejects(() => repository.readText('../outside.md'), /Unsafe vault path/);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 10 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
