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
				"export { withObsidianVaultPathLock } from './src/adapters/obsidian-vault-path-lock';",
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
	const {
		ObsidianVaultRepository,
		withObsidianVaultPathLock,
		TFile,
		TFolder,
	} = require(bundlePath);

	const records = new Map();
	let readCalls = 0;
	let processCalls = 0;
	const generatedLinks = [];
	let beforeProcess;
	let beforeCreateFolder;
	const createFolderCalls = [];
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
		delete: async (file) => {
			records.delete(file.path);
		},
		modify: async () => {
			throw new Error('modify must not be used for repository CAS writes');
		},
		process: async (file, callback) => {
			processCalls += 1;
			const record = records.get(file.path);
			beforeProcess?.(record);
			const nextContent = callback(record.content);
			record.content = nextContent;
			file.stat = {
				size: Buffer.byteLength(nextContent, 'utf8'),
				mtime: file.stat.mtime + 1,
			};
			return nextContent;
		},
		getFiles: () => Array.from(records.values(), (record) => record.file).filter((file) => file instanceof TFile),
		createFolder: async (folderPath) => {
			createFolderCalls.push(folderPath);
			await beforeCreateFolder?.(folderPath);
			if (records.has(folderPath)) {
				throw new Error(`folder destination exists: ${folderPath}`);
			}
			const folder = new TFolder();
			Object.assign(folder, { path: folderPath, children: [] });
			records.set(folderPath, { file: folder, content: '' });
		},
	};
	const fileManager = {
		trashFile: async (file) => {
			records.delete(file.path);
		},
		generateMarkdownLink: (file, sourcePath, subpath, alias) => {
			generatedLinks.push({
				targetPath: file.path,
				sourcePath,
				subpath,
				alias,
			});
			return `[[${file.path.replace(/\.md$/i, '')}${subpath}|${alias}]]`;
		},
	};

	const existing = makeFile('01_knowledge/wiki/topic.md', '# Topic\nfresh', 1000);
	const repository = new ObsidianVaultRepository(vault, fileManager);
	const firstRead = await repository.readText(existing.path);
	assert.equal(firstRead.content, '# Topic\nfresh');
	assert.equal(readCalls, 1);
	await assert.rejects(() => repository.createText(existing.path, 'duplicate'), /already exists/);
	await assert.rejects(() => repository.replaceText(existing.path, 'stale-version', 'overwrite'), /CAS check failed/);
	assert.equal(records.get(existing.path).content, '# Topic\nfresh');

	const sameStatRecord = records.get(existing.path);
	const sameStat = { ...existing.stat };
	sameStatRecord.content = '# Topic\nstale';
	existing.stat = sameStat;
	await assert.rejects(
		() => repository.replaceText(existing.path, firstRead.version, '# Topic\noverwrite'),
		/CAS check failed/
	);
	assert.equal(records.get(existing.path).content, '# Topic\nstale');
	assert.deepEqual(existing.stat, sameStat);

	const beforeRace = await repository.readText(existing.path);
	beforeProcess = (record) => {
		beforeProcess = undefined;
		record.content = '# Topic\nraced';
		record.file.stat = {
			size: Buffer.byteLength(record.content, 'utf8'),
			mtime: record.file.stat.mtime + 1,
		};
	};
	await assert.rejects(
		() => repository.replaceText(existing.path, beforeRace.version, '# Topic\noverwrite'),
		/CAS check failed/
	);
	assert.equal(records.get(existing.path).content, '# Topic\nraced');

	const current = await repository.readText(existing.path);
	const replacement = await repository.replaceText(existing.path, current.version, '# Topic\nupdated');
	assert.equal(records.get(existing.path).content, '# Topic\nupdated');
	assert.equal(replacement.path, existing.path);
	const replacedRead = await repository.readText(existing.path);
	assert.equal(replacement.version, replacedRead.version);
	assert.equal(processCalls, 4);

	const created = await repository.createText('01_knowledge/wiki/new.md', '# New');
	assert.equal(created.path, '01_knowledge/wiki/new.md');
	const createdRead = await repository.readText(created.path);
	assert.equal(created.version, createdRead.version);
	const deletable = await repository.createText('01_knowledge/wiki/delete.md', '# Delete');
	await assert.rejects(
		() => repository.deleteText(deletable.path, 'stale-version'),
		/CAS check failed/
	);
	assert.equal(records.get(deletable.path).content, '# Delete');
	await repository.deleteText(deletable.path, deletable.version);
	assert.equal(records.has(deletable.path), false);
	makeFile('.obsidian/private.md', '# hidden');
	const listed = await repository.listMarkdown();
	assert.deepEqual(listed.map((entry) => entry.path), [
		'01_knowledge/wiki/new.md',
		'01_knowledge/wiki/topic.md',
	]);
	assert.equal(
		listed.find((entry) => entry.path === existing.path).version,
		replacedRead.version
	);
	assert.equal(
		listed.find((entry) => entry.path === created.path).version,
		createdRead.version
	);
	assert.equal(
		repository.generateMarkdownLink(
			existing.path,
			'00_tracekeeper/work/tasks/task.md',
			'#Decision',
			'Topic'
		),
		'[[01_knowledge/wiki/topic#Decision|Topic]]'
	);
	assert.deepEqual(generatedLinks, [{
		targetPath: existing.path,
		sourcePath: '00_tracekeeper/work/tasks/task.md',
		subpath: '#Decision',
		alias: 'Topic',
	}]);
	assert.throws(
		() => repository.generateMarkdownLink(
			'01_knowledge/wiki/missing.md',
			'00_tracekeeper/work/tasks/task.md'
		),
		/not a file/
	);
	const lockedRead = await repository.readText(existing.path);
	let signalLockEntered;
	let releaseLock;
	const lockEntered = new Promise((resolve) => {
		signalLockEntered = resolve;
	});
	const lockGate = new Promise((resolve) => {
		releaseLock = resolve;
	});
	const heldLock = withObsidianVaultPathLock(
		vault,
		existing.path,
		async () => {
			signalLockEntered();
			await lockGate;
		}
	);
	await lockEntered;
	const processCountBeforeBlockedReplace = processCalls;
	const blockedReplace = repository.replaceText(
		existing.path,
		lockedRead.version,
		'# Topic\nserialized'
	);
	await Promise.resolve();
	assert.equal(processCalls, processCountBeforeBlockedReplace);
	releaseLock();
	await Promise.all([heldLock, blockedReplace]);
	assert.equal(records.get(existing.path).content, '# Topic\nserialized');
	assert.equal(processCalls, processCountBeforeBlockedReplace + 1);
	let signalFolderCreateEntered;
	let releaseFolderCreate;
	let firstFolderCreate = true;
	const folderCreateEntered = new Promise((resolve) => {
		signalFolderCreateEntered = resolve;
	});
	const folderCreateGate = new Promise((resolve) => {
		releaseFolderCreate = resolve;
	});
	beforeCreateFolder = async (folderPath) => {
		if (folderPath === '02_sources' && firstFolderCreate) {
			firstFolderCreate = false;
			signalFolderCreateEntered();
			await folderCreateGate;
		}
	};
	const firstNestedCreate = new ObsidianVaultRepository(vault, fileManager).createText(
		'02_sources/inbox/first.md',
		'# First'
	);
	await folderCreateEntered;
	const secondNestedCreate = new ObsidianVaultRepository(vault, fileManager).createText(
		'02_sources/inbox/second.md',
		'# Second'
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(
		createFolderCalls.filter((folderPath) => folderPath === '02_sources').length,
		1
	);
	releaseFolderCreate();
	await Promise.all([firstNestedCreate, secondNestedCreate]);
	assert.equal(records.get('02_sources/inbox/first.md').content, '# First');
	assert.equal(records.get('02_sources/inbox/second.md').content, '# Second');
	assert.equal(
		createFolderCalls.filter((folderPath) => folderPath === '02_sources/inbox').length,
		1
	);
	let injectedExternalFolder = false;
	beforeCreateFolder = async (folderPath) => {
		if (folderPath !== '03_external' || injectedExternalFolder) {
			return;
		}
		injectedExternalFolder = true;
		const folder = new TFolder();
		Object.assign(folder, { path: folderPath, children: [] });
		records.set(folderPath, { file: folder, content: '' });
	};
	const externallyRacedCreate = await repository.createText(
		'03_external/recovered.md',
		'# Recovered'
	);
	assert.equal(externallyRacedCreate.path, '03_external/recovered.md');
	assert.equal(records.get('03_external/recovered.md').content, '# Recovered');
	await assert.rejects(() => repository.readText('../outside.md'), /Unsafe vault path/);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 38 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
