#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-legacy-migration-controller-test-'));
const bundlePath = path.join(tempRoot, 'legacy-migration-controller.bundle.cjs');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function stableStringify(value) {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
	}
	const keys = Object.keys(value).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashText(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizePath(value) {
	return String(value).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function parentPath(value) {
	const normalized = normalizePath(value);
	const segments = normalized.split('/');
	segments.pop();
	return segments.join('/');
}

function resolveRelativePath(sourcePath, targetPath) {
	const sourceFolder = parentPath(sourcePath);
	if (!targetPath.startsWith('.') && !targetPath.startsWith('..')) {
		return normalizePath(targetPath);
	}
	return normalizePath(path.posix.normalize(path.posix.join(sourceFolder || '.', targetPath)));
}

function splitLinkTarget(rawTarget) {
	const hashIndex = rawTarget.indexOf('#');
	if (hashIndex === -1) {
		return { pathPart: rawTarget, subpath: '' };
	}
	return {
		pathPart: rawTarget.slice(0, hashIndex),
		subpath: rawTarget.slice(hashIndex),
	};
}

function extractLinks(content, sourcePath) {
	const links = [];
	const text = String(content || '');
	const pattern = /(!)?\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)/g;
	for (const match of text.matchAll(pattern)) {
		if (match[2]) {
			const embed = Boolean(match[1]);
			const raw = match[2];
			const aliasSplit = raw.split('|');
			const targetWithSubpath = aliasSplit[0];
			const alias = aliasSplit.length > 1 ? aliasSplit.slice(1).join('|') : '';
			const { pathPart, subpath } = splitLinkTarget(targetWithSubpath);
			links.push({
				kind: embed ? 'embed' : 'wikilink',
				raw: match[0],
				alias,
				subpath,
				resolvedPath: resolveRelativePath(sourcePath, pathPart || sourcePath),
			});
			continue;
		}
		const label = match[3];
		const target = match[4];
		const { pathPart, subpath } = splitLinkTarget(target);
		links.push({
			kind: 'markdown',
			raw: match[0],
			alias: label,
			subpath,
			resolvedPath: resolveRelativePath(sourcePath, pathPart || sourcePath),
		});
	}
	return links;
}

function clone(value) {
	return structuredClone(value);
}

function makeFile(filePath, kind, content = '', extra = {}) {
	const normalizedPath = normalizePath(filePath);
	const base = {
		path: normalizedPath,
		extension: path.extname(normalizedPath).slice(1).toLowerCase(),
		basename: path.basename(normalizedPath, path.extname(normalizedPath)),
		stat: {
			size: Buffer.isBuffer(content) ? content.length : Buffer.byteLength(String(content), 'utf8'),
			mtime: 1000,
		},
	};
	return Object.assign(base, { __tracekeeper_kind: kind }, extra);
}

function makeFolder(filePath, children = []) {
	return makeFile(filePath, 'folder', '', { children });
}

function createVaultFixture(options = {}) {
	const settings = {
		autoUpdateLinks: options.autoUpdateLinks ?? true,
		linkCapabilityStatus: options.linkCapabilityStatus ?? 'required',
		metadataDelayGenerations: options.metadataDelayGenerations ?? 0,
		metadataWaitTimeoutMs: options.metadataWaitTimeoutMs ?? 100,
		nativePathDerivedEmbedDisplay: options.nativePathDerivedEmbedDisplay ?? false,
		trashFailures: new Set(options.trashFailures ?? []),
	};

	const files = new Map();
	const folders = new Map();
	const content = new Map();
	const binaryContent = new Map();
	const auditEntries = [];
	const events = {
		read: 0,
		cachedRead: 0,
		readBinary: 0,
		process: 0,
		create: 0,
		createFolder: 0,
		createBinary: 0,
		renameFile: 0,
		trashFile: 0,
		generateMarkdownLink: 0,
		loadKnowledgeSnapshot: 0,
		waitForKnowledgeSnapshot: 0,
	};

	const pendingSnapshotWaiters = [];
	let knowledgeGeneration = 1;
	let indexCreatedAt = new Date(Date.now() - 60_000).toISOString();
	let snapshotCount = 0;
	let metadataDelayRemaining = 0;

	const notifyKnowledgeChange = () => {
		knowledgeGeneration += 1;
		for (let index = 0; index < pendingSnapshotWaiters.length; ) {
			const waiter = pendingSnapshotWaiters[index];
			if (knowledgeGeneration >= waiter.minGeneration) {
				pendingSnapshotWaiters.splice(index, 1);
				waiter.resolve(fixture.loadKnowledgeSnapshot());
				continue;
			}
			index += 1;
		}
	};

	const registerFolder = (filePath) => {
		const folder = makeFolder(filePath, []);
		folders.set(folder.path, folder);
		files.set(folder.path, folder);
		const parent = parentPath(folder.path);
		if (parent && folders.has(parent)) {
			folders.get(parent).children.push(folder);
		}
		return folder;
	};

	const registerTextFile = (filePath, text, extra = {}) => {
		const file = makeFile(filePath, 'file', text, extra);
		files.set(file.path, file);
		content.set(file.path, String(text));
		binaryContent.delete(file.path);
		const parent = parentPath(file.path);
		if (parent && folders.has(parent)) {
			folders.get(parent).children.push(file);
		}
		return file;
	};

	const registerBinaryFile = (filePath, bytes, extra = {}) => {
		const buffer = Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(bytes);
		const file = makeFile(filePath, 'file', buffer, extra);
		files.set(file.path, file);
		binaryContent.set(file.path, buffer);
		content.set(file.path, buffer.toString('utf8'));
		const parent = parentPath(file.path);
		if (parent && folders.has(parent)) {
			folders.get(parent).children.push(file);
		}
		return file;
	};

	const removeEntry = (filePath) => {
		const normalized = normalizePath(filePath);
		const entry = files.get(normalized) || folders.get(normalized);
		if (!entry) {
			return;
		}
		if (entry.__tracekeeper_kind === 'folder') {
			for (const child of [...entry.children]) {
				removeEntry(child.path);
			}
		}
		files.delete(normalized);
		folders.delete(normalized);
		content.delete(normalized);
		binaryContent.delete(normalized);
		const parent = parentPath(normalized);
		if (parent && folders.has(parent)) {
			folders.get(parent).children = folders
				.get(parent)
				.children
				.filter((child) => child.path !== normalized);
		}
	};

	registerFolder('04_memory');
	registerFolder('04_memory/concepts');
	registerFolder('04_memory/claims');
	registerFolder('04_memory/procedures');
	registerFolder('04_memory/notes');
	registerFolder('01_knowledge');
	registerFolder('01_knowledge/wiki');
	registerFolder('01_knowledge/wiki/concepts');
	registerFolder('01_knowledge/wiki/claims');
	registerFolder('01_knowledge/wiki/guides');
	registerFolder('01_knowledge/wiki/hubs');
	registerFolder('01_knowledge/memory');

	const topicSourcePath = '04_memory/concepts/topic.md';
	const relatedSourcePath = '04_memory/concepts/related.md';
	const diagramSourcePath = '04_memory/concepts/diagram.png';
	const duplicateSourcePath = '04_memory/claims/duplicate.md';
	const conflictSourcePath = '04_memory/claims/conflict-file.md';
	const folderConflictSourcePath = '04_memory/procedures/folder-target.md';
	const unmappedSourcePath = '04_memory/notes/unmapped.md';
	const outsidePath = '01_knowledge/wiki/outside.md';
	const topicTargetPath = '01_knowledge/wiki/concepts/topic.md';
	const duplicateTargetPath = '01_knowledge/wiki/claims/duplicate.md';
	const conflictTargetPath = '01_knowledge/wiki/claims/conflict-file.md';
	const folderConflictTargetPath = '01_knowledge/wiki/guides/folder-target.md';
	const diagramTargetPath = '01_knowledge/wiki/concepts/diagram.png';

	registerTextFile(
		topicSourcePath,
		[
			'---',
			'title: Topic',
			'---',
			'# Topic',
			'',
			'Inside wikilink: [[related]]',
			'Inside alias: [[related|Topic alias]]',
			'Inside embed: ![[related#Heading]]',
			'Inside heading: [[related#Heading]]',
			'Inside block: [[related#^topic-block]]',
			'Inside relative markdown: [Related](./related.md)',
			'Outside wikilink: [[01_knowledge/wiki/outside]]',
			'Outside markdown: [Outside](../../01_knowledge/wiki/outside.md)',
			'',
		].join('\n')
	);
	registerTextFile(
		relatedSourcePath,
		[
			'# Related',
			'',
			'## Heading',
			'',
			'Stable block target. ^topic-block',
			'',
			'Backlink to topic: [[topic]]',
			'Outside reference: [Outside](../../01_knowledge/wiki/outside.md)',
			'',
		].join('\n')
	);
	registerBinaryFile(diagramSourcePath, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
	registerTextFile(
		duplicateSourcePath,
		[
			'# Duplicate',
			'',
			'Same content move candidate.',
			'',
		].join('\n')
	);
	registerTextFile(
		conflictSourcePath,
		[
			'# Conflict',
			'',
			'This file should collide with different target content.',
			'',
		].join('\n')
	);
	registerTextFile(
		folderConflictSourcePath,
		[
			'# Folder conflict',
			'',
			'This file should collide with a folder target.',
			'',
		].join('\n')
	);
	registerTextFile(
		unmappedSourcePath,
		[
			'# Unmapped',
			'',
			'This source intentionally has no stable target mapping.',
			'',
		].join('\n')
	);
	registerTextFile(
		outsidePath,
		[
			'# Outside',
			'',
			'This note lives outside the legacy roots and links back to the topic.',
			'',
			'[[04_memory/concepts/topic]]',
			'',
		].join('\n')
	);
	registerTextFile('01_knowledge/index.md', '# Knowledge index\n');
	registerTextFile('01_knowledge/memory/index.md', '# Memory index\n');
	registerTextFile('01_knowledge/wiki/hubs/index.md', '# Wiki hubs\n');
	registerTextFile(
		duplicateTargetPath,
		[
			'# Duplicate',
			'',
			'Same content move candidate.',
			'',
		].join('\n'),
		{ __tracekeeper_seed: 'same-content-target' }
	);
	registerTextFile(
		conflictTargetPath,
		[
			'# Conflict',
			'',
			'Existing target content that should cause a conflict.',
			'',
		].join('\n'),
		{ __tracekeeper_seed: 'different-content-target' }
	);
	registerFolder(folderConflictTargetPath, []);
	if (options.cleanMigration) {
		for (const entryPath of [
			duplicateSourcePath,
			conflictSourcePath,
			folderConflictSourcePath,
			unmappedSourcePath,
			duplicateTargetPath,
			conflictTargetPath,
			folderConflictTargetPath,
		]) {
			removeEntry(entryPath);
		}
	}
	const resolveFixtureLink = (sourcePath, resolvedPath) => {
		const normalized = normalizePath(resolvedPath);
		const candidates = [
			normalized,
			`${normalized}.md`,
		];
		for (const candidate of candidates) {
			const entry = files.get(candidate);
			if (entry?.__tracekeeper_kind === 'file') {
				return candidate;
			}
		}
		const basename = path.posix.basename(normalized).replace(/\.md$/i, '');
		const shortestMatches = [...files.values()]
			.filter((entry) =>
				entry.__tracekeeper_kind === 'file'
				&& entry.basename === basename
			)
			.map((entry) => entry.path)
			.sort();
		if (shortestMatches.length === 1) {
			return shortestMatches[0];
		}
		if (!normalized.includes('/')) {
			const sibling = normalizePath(
				path.posix.join(parentPath(sourcePath), `${normalized}.md`)
			);
			if (files.get(sibling)?.__tracekeeper_kind === 'file') {
				return sibling;
			}
		}
		return null;
	};

	const graphSnapshot = () => {
		snapshotCount += 1;
		const fileEntries = Array.from(files.values())
			.filter((file) => file.__tracekeeper_kind === 'file')
			.map((file) => {
				const fileText = binaryContent.has(file.path)
					? binaryContent.get(file.path).toString('utf8')
					: content.get(file.path) || '';
				return {
					path: file.path,
					kind: file.extension === 'png' ? 'binary' : 'markdown',
					hash: hashText(fileText),
					outgoing: extractLinks(fileText, file.path),
				};
			})
			.sort((left, right) => left.path.localeCompare(right.path));
		return {
			generation: knowledgeGeneration,
			snapshotCount,
			files: fileEntries,
		};
	};

	const knowledgeSnapshot = () => {
		const fixtureGraph = graphSnapshot();
		const markdownEntries = fixtureGraph.files.filter(
			(entry) => entry.kind === 'markdown'
		);
		const notes = new Map();
		const edges = [];
		const unresolvedEdges = [];
		const outgoing = new Map();
		const incoming = new Map();
		for (const entry of markdownEntries) {
			const text = content.get(entry.path) || '';
			notes.set(entry.path, {
				schemaVersion: '1.0',
				path: entry.path,
				exists: true,
				contentHash: hashText(text),
				title: entry.path,
				aliases: [],
				frontmatter: {},
				semanticErrors: [],
				tags: [],
				headings: [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim()),
				blockIds: [...text.matchAll(/\^([A-Za-z0-9_-]+)/g)].map((match) => match[1]),
				sections: [],
				callouts: [],
				edges: [],
				wikilinks: [],
				backlinks: [],
				searchTokens: [],
				excerptSource: text,
				text,
				content: text,
				modifiedAt: new Date(1000).toISOString(),
				size: Buffer.byteLength(text, 'utf8'),
				fileVersion: `${entry.path}:1000`,
				type: null,
			});
			outgoing.set(entry.path, []);
		}
		for (const entry of markdownEntries) {
			const normalizedEdges = [];
			for (const [index, fixtureEdge] of entry.outgoing.entries()) {
				const resolvedPath = resolveFixtureLink(entry.path, fixtureEdge.resolvedPath);
				const subpath = fixtureEdge.subpath.replace(/^#/, '');
				const pathDerivedDisplay = settings.nativePathDerivedEmbedDisplay
					&& fixtureEdge.kind === 'embed'
					&& !fixtureEdge.alias
					&& resolvedPath
					? `${resolvedPath.replace(/\.md$/i, '')}${subpath ? ` > ${subpath}` : ''}`
					: undefined;
				const normalizedEdge = {
					kind: fixtureEdge.kind === 'embed' ? 'embed' : 'link',
					source: 'body',
					raw: fixtureEdge.raw,
					target: fixtureEdge.resolvedPath,
					linkPath: fixtureEdge.resolvedPath,
					displayText: fixtureEdge.alias || pathDerivedDisplay,
					alias: fixtureEdge.alias || pathDerivedDisplay,
					heading: subpath || undefined,
					subpath: subpath || undefined,
					subpathKind: subpath
						? subpath.startsWith('^') ? 'block' : 'heading'
						: undefined,
					line: index,
					position: {
						start: { line: index, column: 0, offset: index },
						end: { line: index, column: 1, offset: index + 1 },
					},
					sourcePath: entry.path,
					resolution: resolvedPath
						? { status: 'resolved', path: resolvedPath, authority: 'native' }
						: { status: 'unresolved', reason: 'not_found', authority: 'native' },
				};
				normalizedEdges.push(normalizedEdge);
				if (resolvedPath) {
					edges.push(normalizedEdge);
					outgoing.get(entry.path).push(resolvedPath);
					const sources = incoming.get(resolvedPath) || [];
					sources.push(entry.path);
					incoming.set(resolvedPath, sources);
				} else {
					unresolvedEdges.push(normalizedEdge);
				}
			}
			const note = notes.get(entry.path);
			note.edges = normalizedEdges;
			note.wikilinks = normalizedEdges;
		}
		for (const [targetPath, sourcePaths] of incoming) {
			incoming.set(targetPath, [...new Set(sourcePaths)].sort());
		}
		for (const [sourcePath, targetPaths] of outgoing) {
			outgoing.set(sourcePath, [...new Set(targetPaths)].sort());
		}
		return {
			version: '1.0',
			createdAt: indexCreatedAt,
			generation: knowledgeGeneration,
			event_sequence: knowledgeGeneration,
			index_state: 'ready',
			notes,
			graph: {
				outgoing,
				incoming,
				edges,
				unresolvedEdges,
			},
			scopes: {
				byType: new Map(),
				byTag: new Map(),
			},
			last_event: null,
			last_rebuild: null,
			files: fixtureGraph.files,
		};
	};

	const getFileRecord = (filePath) => files.get(normalizePath(filePath)) || folders.get(normalizePath(filePath)) || null;

	const refreshLinksAfterRename = (oldPath, newPath) => {
		if (!settings.autoUpdateLinks) {
			return;
		}
		const oldNoExt = oldPath.replace(/\.md$/i, '');
		const newNoExt = newPath.replace(/\.md$/i, '');
		for (const [filePath, fileContent] of content.entries()) {
			const sourceFolder = parentPath(filePath) || '.';
			const oldRelative = path.posix.relative(sourceFolder, oldPath).replace(/\.md$/i, '');
			const newRelative = path.posix.relative(sourceFolder, newPath).replace(/\.md$/i, '');
			const oldRelativeWithPrefix = oldRelative.startsWith('.')
				? oldRelative
				: `./${oldRelative}`;
			const newRelativeWithPrefix = newRelative.startsWith('.')
				? newRelative
				: `./${newRelative}`;
			let next = fileContent
				.replaceAll(`[[${oldNoExt}]]`, `[[${newNoExt}]]`)
				.replaceAll(`[[${oldPath}]]`, `[[${newPath}]]`)
				.replaceAll(`![[${oldNoExt}]]`, `![[${newNoExt}]]`)
				.replaceAll(`![[${oldPath}]]`, `![[${newPath}]]`)
				.replaceAll(`(${oldPath})`, `(${newPath})`)
				.replaceAll(`(${oldNoExt})`, `(${newNoExt})`)
				.replaceAll(oldRelativeWithPrefix, newRelativeWithPrefix);
			if (next !== fileContent) {
				content.set(filePath, next);
				const file = files.get(filePath);
				if (file) {
					file.stat = {
						size: Buffer.byteLength(next, 'utf8'),
						mtime: file.stat.mtime + 1,
					};
				}
			}
		}
	};

	const vault = {
		getAbstractFileByPath(filePath) {
			return getFileRecord(filePath);
		},
		read: async (file) => {
			events.read += 1;
			const text = binaryContent.has(file.path)
				? binaryContent.get(file.path).toString('utf8')
				: content.get(file.path) || '';
			return text;
		},
		cachedRead: async (file) => {
			events.cachedRead += 1;
			const text = binaryContent.has(file.path)
				? binaryContent.get(file.path).toString('utf8')
				: content.get(file.path) || '';
			return text;
		},
		readBinary: async (file) => {
			events.readBinary += 1;
			if (binaryContent.has(file.path)) {
				return Buffer.from(binaryContent.get(file.path));
			}
			return Buffer.from(content.get(file.path) || '', 'utf8');
		},
		process: async (file, updater) => {
			events.process += 1;
			const current = binaryContent.has(file.path)
				? binaryContent.get(file.path).toString('utf8')
				: content.get(file.path) || '';
			const next = updater(current);
			content.set(file.path, next);
			binaryContent.delete(file.path);
			file.stat = {
				size: Buffer.byteLength(next, 'utf8'),
				mtime: file.stat.mtime + 1,
			};
			notifyKnowledgeChange();
			if (
				file.path.startsWith('01_knowledge/wiki/concepts/')
				&& settings.metadataDelayGenerations > 0
			) {
				metadataDelayRemaining = settings.metadataDelayGenerations;
			}
			return next;
		},
		create: async (filePath, data) => {
			events.create += 1;
			const normalized = normalizePath(filePath);
			if (files.has(normalized) || folders.has(normalized)) {
				throw new Error(`destination exists: ${normalized}`);
			}
			const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
			const file = registerTextFile(normalized, text);
			notifyKnowledgeChange();
			return file;
		},
		createFolder: async (folderPath) => {
			events.createFolder += 1;
			const normalized = normalizePath(folderPath);
			if (files.has(normalized) || folders.has(normalized)) {
				throw new Error(`destination exists: ${normalized}`);
			}
			const parent = parentPath(normalized);
			if (parent && !folders.has(parent)) {
				throw new Error(`missing fixture parent: ${parent}`);
			}
			const folder = registerFolder(normalized);
			notifyKnowledgeChange();
			return folder;
		},
		createBinary: async (filePath, bytes) => {
			events.createBinary += 1;
			const normalized = normalizePath(filePath);
			const file = registerBinaryFile(normalized, bytes);
			notifyKnowledgeChange();
			return file;
		},
		trash: async (file) => {
			events.trashFile += 1;
			files.delete(file.path);
			folders.delete(file.path);
			content.delete(file.path);
			binaryContent.delete(file.path);
			const parent = parentPath(file.path);
			if (parent && folders.has(parent)) {
				folders.get(parent).children = folders.get(parent).children.filter((child) => child.path !== file.path);
			}
			notifyKnowledgeChange();
		},
	};

	const fileManager = {
		generateMarkdownLink: (file, sourcePath, subpath = '', alias = '') => {
			events.generateMarkdownLink += 1;
			const targetPath = normalizePath(file.path);
			const normalizedSource = normalizePath(sourcePath);
			const relativeBase = parentPath(normalizedSource) || '.';
			const relativeTarget = path.posix.relative(relativeBase, targetPath).replace(/\.md$/i, '');
			const prefix = relativeTarget.startsWith('.') ? relativeTarget : `./${relativeTarget}`;
			const label = alias ? `|${alias}` : '';
			return `[[${prefix}${subpath}${label}]]`;
		},
		async renameFile(file, targetPath) {
			events.renameFile += 1;
			const oldPath = file.path;
			const normalizedTarget = normalizePath(targetPath);
			if (files.has(normalizedTarget) || folders.has(normalizedTarget)) {
				throw new Error(`destination exists: ${normalizedTarget}`);
			}
			files.delete(oldPath);
			const existingBinary = binaryContent.get(oldPath);
			binaryContent.delete(oldPath);
			const existingText = content.get(oldPath) || '';
			content.delete(oldPath);
			const oldParent = parentPath(oldPath);
			if (oldParent && folders.has(oldParent)) {
				folders.get(oldParent).children = folders
					.get(oldParent)
					.children
					.filter((child) => child.path !== oldPath);
			}
			file.path = normalizedTarget;
			file.basename = path.basename(normalizedTarget, path.extname(normalizedTarget));
			file.extension = path.extname(normalizedTarget).slice(1).toLowerCase();
			files.set(normalizedTarget, file);
			content.set(normalizedTarget, existingText);
			if (existingBinary) {
				binaryContent.set(normalizedTarget, Buffer.from(existingBinary));
			}
			const newParent = parentPath(normalizedTarget);
			if (newParent && folders.has(newParent)) {
				folders.get(newParent).children.push(file);
			}
			refreshLinksAfterRename(oldPath, normalizedTarget);
			notifyKnowledgeChange();
			if (settings.metadataDelayGenerations > 0) {
				metadataDelayRemaining = settings.metadataDelayGenerations;
			}
			return file;
		},
		async trashFile(file) {
			events.trashFile += 1;
			if (settings.trashFailures.has(file.path)) {
				throw new Error(`configured trash failure: ${file.path}`);
			}
			files.delete(file.path);
			folders.delete(file.path);
			content.delete(file.path);
			binaryContent.delete(file.path);
			const parent = parentPath(file.path);
			if (parent && folders.has(parent)) {
				folders.get(parent).children = folders.get(parent).children.filter((child) => child.path !== file.path);
			}
			notifyKnowledgeChange();
		},
	};

	const loadKnowledgeSnapshot = () => {
		events.loadKnowledgeSnapshot += 1;
		const snapshot = knowledgeSnapshot();
		if (metadataDelayRemaining > 0) {
			metadataDelayRemaining -= 1;
			snapshot.index_state = 'initializing';
		}
		return snapshot;
	};

	const waitForKnowledgeSnapshot = async (minGeneration) => {
		events.waitForKnowledgeSnapshot += 1;
		if (knowledgeGeneration >= minGeneration) {
			return loadKnowledgeSnapshot();
		}
		return new Promise((resolve) => {
			pendingSnapshotWaiters.push({ minGeneration, resolve });
		});
	};

	const fixture = {
		app: {
			vault,
			fileManager,
			metadataCache: {
				getFileCache(file) {
					return {
						path: file.path,
						generation: knowledgeGeneration,
						links: extractLinks(content.get(file.path) || '', file.path),
					};
				},
			},
		},
		host: {
			initializeMemoryStructure: async () => {},
			ensureFolderExists: async (folderPath) => {
				let current = '';
				for (const segment of normalizePath(folderPath).split('/').filter(Boolean)) {
					current = current ? `${current}/${segment}` : segment;
					const existing = files.get(current) || folders.get(current);
					if (existing && existing.__tracekeeper_kind !== 'folder') {
						throw new Error(`folder path occupied: ${current}`);
					}
					if (!existing) {
						registerFolder(current);
					}
				}
			},
			ensureFileDoesNotExist: async (filePath, nextContent) => {
				const normalized = normalizePath(filePath);
				if (files.has(normalized) || folders.has(normalized)) {
					throw new Error(`destination exists: ${normalized}`);
				}
				registerTextFile(normalized, nextContent);
				notifyKnowledgeChange();
			},
			normalizeVaultPath: (value) => normalizePath(value),
			appendToAuditLog: async (entry) => {
				auditEntries.push({ operationId: null, entry });
			},
			appendOperationAuditEvent: async (operationId, entry) => {
				auditEntries.push({ operationId, entry });
			},
			refreshGovernanceViews: async () => {},
			loadKnowledgeSnapshot,
			waitForKnowledgeSnapshot,
			resolveLegacyTarget: (sourcePath) => sourcePath === unmappedSourcePath
				? null
				: undefined,
			metadataWaitTimeoutMs: settings.metadataWaitTimeoutMs,
		},
		events,
		auditEntries,
		settings,
		getFileRecord,
		loadKnowledgeSnapshot,
		waitForKnowledgeSnapshot,
		graphSnapshot,
		readText(filePath) {
			return content.get(normalizePath(filePath)) || '';
		},
		readBinaryText(filePath) {
			return binaryContent.get(normalizePath(filePath)) || Buffer.from(content.get(normalizePath(filePath)) || '', 'utf8');
		},
		writeText(filePath, nextContent) {
			const normalized = normalizePath(filePath);
			content.set(normalized, String(nextContent));
			const file = files.get(normalized);
			if (file) {
				file.stat = {
					size: Buffer.byteLength(String(nextContent), 'utf8'),
					mtime: file.stat.mtime + 1,
				};
			}
			notifyKnowledgeChange();
		},
		mutateSource(filePath, transform) {
			const normalized = normalizePath(filePath);
			const next = transform(content.get(normalized) || '');
			this.writeText(normalized, next);
		},
		addTextFile(filePath, nextContent) {
			const normalized = normalizePath(filePath);
			const parent = parentPath(normalized);
			if (parent && !folders.has(parent)) {
				throw new Error(`missing fixture parent: ${parent}`);
			}
			const file = registerTextFile(normalized, nextContent);
			notifyKnowledgeChange();
			return file;
		},
		removeEntry,
		restartKnowledgeIndex() {
			knowledgeGeneration = 1;
			indexCreatedAt = new Date(Date.now() + 1_000).toISOString();
		},
		futurePlanFrom(rawPlan) {
			const normalizedItems = rawPlan.items.map((item) => {
				const targetFile = files.get(normalizePath(item.newPath));
				const targetFolder = folders.get(normalizePath(item.newPath));
				let action = 'native_move';
					if (!item.newPath || item.oldPath === unmappedSourcePath || item.newPath === 'unmapped' || !item.newPath.trim()) {
						action = 'unmapped';
					} else if (targetFolder) {
					action = 'conflict';
				} else if (targetFile) {
					const sourceFile = files.get(normalizePath(item.oldPath));
					const sourceText = sourceFile && sourceFile.extension === 'png'
						? (binaryContent.get(sourceFile.path) || Buffer.from('')).toString('utf8')
						: content.get(sourceFile?.path || '') || '';
					const targetText = targetFile.extension === 'png'
						? (binaryContent.get(targetFile.path) || Buffer.from('')).toString('utf8')
						: content.get(targetFile.path) || '';
					action = sourceText === targetText ? 'already_moved' : 'conflict';
				}
				return {
					oldPath: item.oldPath,
					newPath: item.newPath,
					kind: item.kind,
					action,
					reason: item.reason,
					isMarkdown: item.isMarkdown,
				};
			});
			const payload = {
				migrationId: rawPlan.migrationId,
				legacyRoots: rawPlan.legacyRoots,
				items: normalizedItems,
				fileCount: rawPlan.fileCount,
				markdownCount: rawPlan.markdownCount,
				nonMarkdownCount: rawPlan.nonMarkdownCount,
				copyCount: normalizedItems.filter((item) => item.action === 'native_move').length,
				conflictCount: normalizedItems.filter((item) => item.action === 'conflict').length,
				reviewCount: normalizedItems.filter((item) => item.action === 'conflict').length,
				skipCount: normalizedItems.filter((item) => item.action === 'already_moved').length,
				uncoveredCount: normalizedItems.filter((item) => item.action === 'unmapped').length,
				linkCapability: {
					status: settings.linkCapabilityStatus,
					passed: settings.linkCapabilityStatus === 'passed',
					blocked: settings.linkCapabilityStatus === 'blocked',
					required: settings.linkCapabilityStatus === 'required',
					not_required: settings.linkCapabilityStatus === 'not_required',
				},
				graph: loadKnowledgeSnapshot(),
			};
			payload.planHash = hashText(stableStringify(payload));
			return payload;
		},
		buildCleanupPreview(migrationId) {
			const fileSnapshot = loadKnowledgeSnapshot();
			const roots = Array.from(files.values())
				.filter((file) => file.path.startsWith('04_memory/'))
				.map((file) => file.path);
			const verified = roots.filter((root) => root.endsWith('/concepts/topic.md') || root.endsWith('/concepts/related.md'));
			const blocked = roots.filter((root) => root.endsWith('/claims/conflict-file.md'));
			const failed = roots.filter((root) => root.endsWith('/procedures/folder-target.md'));
			const unjournaled = roots.filter((root) => root.endsWith('/notes/unmapped.md'));
			const remaining = roots.filter((root) => root.endsWith('/concepts/diagram.png'));
			return {
				migrationId,
				cleanupId: `legacy-cleanup-${migrationId}`,
				planHash: hashText(stableStringify({ migrationId, fileSnapshot })),
				linkCapability: {
					status: settings.linkCapabilityStatus,
					passed: settings.linkCapabilityStatus === 'passed',
					blocked: settings.linkCapabilityStatus === 'blocked',
					required: settings.linkCapabilityStatus === 'required',
					not_required: settings.linkCapabilityStatus === 'not_required',
				},
				verified,
				blocked,
				failed,
				unjournaled,
				remaining,
				graph: fileSnapshot,
				reportPath: `00_tracekeeper/control/migrations/legacy-cleanup-${migrationId}.md`,
				taskPath: `00_tracekeeper/work/tasks/obs_task_${migrationId.replace(/[^0-9A-Za-z]+/g, '_')}.md`,
			};
		},
	};

	return fixture;
}

function runCharacterizationRows(suite, rows) {
	const passed = [];
	const failures = [];
	return (async () => {
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
	})();
}

function assertLinkForms(content) {
	assert.match(content, /\[\[related\]\]/, 'wikilink should be present');
	assert.match(content, /\[\[related\|Topic alias\]\]/, 'wikilink alias should be present');
	assert.match(content, /!\[\[related#Heading\]\]/, 'embed should be present');
	assert.match(content, /\[\[related#Heading\]\]/, 'heading link should be present');
	assert.match(content, /\[\[related#\^topic-block\]\]/, 'block-id link should be present');
	assert.match(content, /\[Related\]\(\.\/related\.md\)/, 'markdown link should be present');
	assert.match(content, /\[\[01_knowledge\/wiki\/outside\]\]/, 'outside wikilink should be present');
	assert.match(content, /\[Outside\]\(\.\.\/\.\.\/01_knowledge\/wiki\/outside\.md\)/, 'outside markdown link should be present');
}

function expectFuturePlanShape(plan) {
	assert.equal(typeof plan.planHash, 'string', 'future plans must carry a planHash');
	assert.equal(typeof plan.linkCapability?.status, 'string', 'future plans must carry link capability status');
	assert.ok(
		['required', 'passed', 'blocked', 'not_required'].includes(plan.linkCapability.status),
		`unexpected link capability status: ${plan.linkCapability.status}`
	);
	for (const item of plan.items) {
		assert.ok(
			['native_move', 'already_moved', 'conflict', 'unmapped'].includes(item.action),
			`unexpected future action: ${item.action}`
		);
	}
}

function createController(bundleExport, fixture) {
	return new bundleExport.LegacyMigrationController(fixture.app, fixture.host);
}

function callMaybeFutureMethod(controller, fixture, methodName, fallback, ...args) {
	const method = controller[methodName];
	if (typeof method === 'function') {
		return method.apply(controller, args);
	}
	return fallback(...args);
}

function createSourceMutationFixture() {
	const fixture = createVaultFixture({
		autoUpdateLinks: true,
		linkCapabilityStatus: 'required',
	});
	return fixture;
}

try {
	const scriptDir = path.dirname(fileURLToPath(import.meta.url));
	const entryPoint = path.resolve(
		scriptDir,
		'../src/features/structure/legacy-migration-controller.ts'
	);

	await build({
		entryPoints: [entryPoint],
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
					loader: 'js',
					contents: [
						'export class App {}',
						'export class Notice { constructor(message) { globalThis.__tracekeeperNotices ||= []; globalThis.__tracekeeperNotices.push(String(message)); } }',
						'export class Plugin {}',
						'export class Modal {}',
						'export class PluginSettingTab {}',
						'export class Menu {}',
						'export class Setting {}',
						'export class WorkspaceLeaf {}',
						'export class MarkdownView {}',
						'export class ItemView {}',
						'export class TFile { static [Symbol.hasInstance](value) { return Boolean(value && value.__tracekeeper_kind === "file"); } }',
						'export class TFolder { static [Symbol.hasInstance](value) { return Boolean(value && value.__tracekeeper_kind === "folder"); } }',
						'export const Platform = { isDesktopApp: false };',
						'export function getLanguage() { return "en"; }',
						'export const normalizePath = (value) => String(value).replace(/\\\\/g, "/").replace(/^\\/+/, "").replace(/\\/+/g, "/");',
						'export async function requestUrl() { throw new Error("requestUrl is not available in this test shim"); }',
					].join('\n'),
				}));
			},
		}],
	});

	const bundle = require(bundlePath);

	await runCharacterizationRows('legacy-migration-controller-contract', [
		['plan-uses-native-actions-and-plan-hash', async () => {
			const fixture = createVaultFixture();
			const controller = createController(bundle, fixture);
			const plan = await controller.buildLegacyStructurePlan('legacy-migration-1');

			assert.match(plan.planHash, /^[a-f0-9]{64}$/);
			assert.match(plan.evidenceHash, /^[a-f0-9]{64}$/);
			assert.match(plan.confirmationHash, /^[a-f0-9]{64}$/);
			assert.equal(plan.linkCapability.status, 'required');
			expectFuturePlanShape(plan);
			assert.deepEqual(
				plan.items
					.slice()
					.sort((left, right) => left.oldPath.localeCompare(right.oldPath))
					.map((item) => item.action),
				['conflict', 'conflict', 'native_move', 'native_move', 'native_move', 'unmapped', 'conflict']
			);
			const duplicate = plan.items.find((item) => item.oldPath.endsWith('/duplicate.md'));
			assert.equal(duplicate.action, 'conflict', 'same content does not establish migration ownership');
			assert.ok(
				plan.items.find((item) => item.oldPath.endsWith('/topic.md')).inboundEdges.length > 0,
				'preview should bind native inbound-edge evidence'
			);
			assert.equal(fixture.events.cachedRead, 0);
		}],
		['preflight-passes-or-blocks-before-user-moves-and-stale-preview-is-rejected', async () => {
			const fixture = createSourceMutationFixture();
			const controller = createController(bundle, fixture);
			const rawPlan = await controller.buildLegacyStructurePlan('legacy-migration-2a');
			const sourceBefore = fixture.readText('04_memory/concepts/topic.md');
			assertLinkForms(sourceBefore);

			const passed = await controller.runLegacyLinkPreflight(rawPlan);
			assert.equal(passed.linkCapability.status, 'passed');
			assert.notEqual(passed.planHash, rawPlan.planHash);
			assert.equal(passed.linkCapability.cleanupStatus, 'complete');
			assert.equal(fixture.events.generateMarkdownLink, 1);
			assert.equal(fixture.events.cachedRead, 0);

			fixture.mutateSource('04_memory/concepts/topic.md', (value) => `${value}\nPreview invalidated: yes\n`);
			await assert.rejects(
				() => controller.runLegacyLinkPreflight(rawPlan),
				/stale/i
			);

			const disabled = createVaultFixture({ autoUpdateLinks: false });
			const disabledController = createController(bundle, disabled);
			const disabledPlan = await disabledController.buildLegacyStructurePlan('legacy-migration-2b');
			const blocked = await disabledController.runLegacyLinkPreflight(disabledPlan);
			assert.equal(blocked.linkCapability.status, 'blocked');
			const renameCountAfterProbe = disabled.events.renameFile;
			await assert.rejects(
				() => disabledController.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: blocked,
					state: 'legacy_detected',
				}),
				/preflight/i
			);
			assert.equal(disabled.events.renameFile, renameCountAfterProbe);
			const modalSource = fs.readFileSync(
				path.join(
					path.dirname(fileURLToPath(import.meta.url)),
					'../src/features/structure/initialize-memory-structure-modal.ts'
				),
				'utf8'
			);
			assert.match(modalSource, /Choose “Do not update”/);
			assert.match(modalSource, /does not authorize moving any legacy file/);
			assert.doesNotMatch(modalSource, /getConfig\s*(?:\?\.|\()/u);
		}],
		['preflight-does-not-adopt-or-trash-a-preexisting-probe-path', async () => {
			const fixture = createSourceMutationFixture();
			const controller = createController(bundle, fixture);
			const migrationId = 'legacy-migration-2-probe-conflict';
			const draft = await controller.buildLegacyStructurePlan(migrationId);
			const probeId = hashText(
				`${migrationId}|${draft.linkCapability.inboundLinkCount}|legacy-link-preflight`
			).slice(0, 16);
			const probeFolder =
				`00_tracekeeper/control/operations/legacy-link-probes/${probeId}`;
			await fixture.host.ensureFolderExists(probeFolder);
			const preexistingPath = `${probeFolder}/source.md`;
			fixture.addTextFile(preexistingPath, '# User-owned probe collision\n');
			const plan = await controller.buildLegacyStructurePlan(migrationId);
			const trashCount = fixture.events.trashFile;

			const blocked = await controller.runLegacyLinkPreflight(plan);

			assert.equal(blocked.linkCapability.status, 'blocked');
			assert.equal(blocked.linkCapability.reason, 'probe_path_exists');
			assert.equal(blocked.linkCapability.cleanupStatus, 'complete');
			assert.equal(fixture.events.trashFile, trashCount);
			assert.equal(
				fixture.readText(preexistingPath),
				'# User-owned probe collision\n'
			);
			assert.ok(fixture.getFileRecord(probeFolder));

			const raceFixture = createSourceMutationFixture();
			const raceController = createController(bundle, raceFixture);
			const raceMigrationId = 'legacy-migration-2-probe-race';
			const racePlan = await raceController.buildLegacyStructurePlan(
				raceMigrationId
			);
			const raceProbeId = hashText(
				`${raceMigrationId}|${racePlan.linkCapability.inboundLinkCount}|legacy-link-preflight`
			).slice(0, 16);
			const raceProbeFolder =
				`00_tracekeeper/control/operations/legacy-link-probes/${raceProbeId}`;
			const nativeCreateFolder = raceFixture.app.vault.createFolder;
			let injectedRace = false;
			raceFixture.app.vault.createFolder = async (folderPath) => {
				if (!injectedRace && folderPath === raceProbeFolder) {
					injectedRace = true;
					await nativeCreateFolder(folderPath);
					throw new Error('simulated create-folder race');
				}
				return nativeCreateFolder(folderPath);
			};
			const raceTrashCount = raceFixture.events.trashFile;
			const raceBlocked = await raceController.runLegacyLinkPreflight(
				racePlan
			);
			assert.equal(raceBlocked.linkCapability.status, 'blocked');
			assert.equal(raceBlocked.linkCapability.reason, 'probe_path_exists');
			assert.equal(raceFixture.events.trashFile, raceTrashCount);
			assert.ok(raceFixture.getFileRecord(raceProbeFolder));
		}],
		['native-move-keeps-inside-and-outside-link-graph-visible', async () => {
			const fixture = createVaultFixture({ cleanMigration: true });
			const controller = createController(bundle, fixture);
			const rawPlan = await controller.buildLegacyStructurePlan('legacy-migration-3');
			const sourceGraph = fixture.loadKnowledgeSnapshot();
			const topicNode = sourceGraph.files.find((entry) => entry.path === '04_memory/concepts/topic.md');
			assert.ok(topicNode, 'topic note must exist in the graph snapshot');
			assertLinkForms(fixture.readText('04_memory/concepts/topic.md'));
			assert.ok(topicNode.outgoing.some((edge) => edge.resolvedPath.endsWith('04_memory/concepts/related.md')));
			assert.ok(topicNode.outgoing.some((edge) => edge.resolvedPath.endsWith('01_knowledge/wiki/outside.md')));

			const refreshedPlan = await controller.runLegacyLinkPreflight(rawPlan);
			const result = await controller.migrateLegacyStructure({
				basePlan: {
					foldersToCreate: [],
					filesToCreate: [],
					missingAuditLog: false,
				},
				legacyPlan: refreshedPlan,
				state: 'legacy_detected',
			});

			assert.equal(
				result.verifiedCount,
				3,
				`${JSON.stringify(result)}\n${fixture.readText(result.journalPath)}`
			);
			assert.equal(result.cleanupAvailable, true, JSON.stringify(result));
			assert.ok(fixture.events.renameFile >= 4, 'one probe plus three user files should move natively');
			assert.equal(fixture.events.cachedRead, 0);
			assert.equal(fixture.getFileRecord('04_memory/concepts/topic.md'), null);
			assert.ok(fixture.getFileRecord('01_knowledge/wiki/concepts/topic.md'));
			const graph = fixture.loadKnowledgeSnapshot();
			assert.ok(
				graph.graph.edges.some((edge) =>
					edge.sourcePath === '01_knowledge/wiki/outside.md'
					&& edge.resolution.status === 'resolved'
					&& edge.resolution.path === '01_knowledge/wiki/concepts/topic.md'
				),
				'outside backlink should resolve to the moved topic'
			);
			assert.ok(
				graph.graph.edges.some((edge) =>
					edge.sourcePath === '01_knowledge/wiki/concepts/topic.md'
					&& edge.resolution.status === 'resolved'
					&& edge.resolution.path === '01_knowledge/wiki/concepts/related.md'
				),
				'inside shortest/relative links should still resolve'
			);
			const movedTopicEdges = graph.graph.edges.filter((edge) =>
				edge.sourcePath === '01_knowledge/wiki/concepts/topic.md'
				&& edge.resolution.status === 'resolved'
				&& edge.resolution.path === '01_knowledge/wiki/concepts/related.md'
			);
			assert.ok(
				movedTopicEdges.some((edge) => edge.kind === 'embed'),
				'the embed relation should remain resolved'
			);
			assert.ok(
				movedTopicEdges.some((edge) => edge.displayText === 'Topic alias'),
				'the aliased relation should remain resolved'
			);
			assert.ok(
				movedTopicEdges.some((edge) =>
					edge.subpathKind === 'heading' && edge.subpath === 'Heading'
				),
				'the heading relation should remain resolved'
			);
			assert.ok(
				movedTopicEdges.some((edge) =>
					edge.subpathKind === 'block' && edge.subpath === '^topic-block'
				),
				'the block relation should remain resolved'
			);
			assert.ok(
				graph.graph.edges.some((edge) =>
					edge.sourcePath === '01_knowledge/wiki/concepts/related.md'
					&& edge.resolution.status === 'resolved'
					&& edge.resolution.path === '01_knowledge/wiki/concepts/topic.md'
				),
				'the shortest backlink between moved notes should remain resolved'
			);
			const movedTopic = fixture.readText('01_knowledge/wiki/concepts/topic.md');
			assert.match(movedTopic, /\[\[.*\|Topic alias\]\]/);
			assert.match(movedTopic, /#\^topic-block/);
			assert.match(movedTopic, /#Heading/);
			const journal = fixture.readText(result.journalPath);
			assert.doesNotMatch(journal, /Inside wikilink/);
			assert.doesNotMatch(journal, /Stable block target/);
		}],
		['path-derived-embed-display-converges-without-weakening-alias-checks', async () => {
			const fixture = createVaultFixture({
				cleanMigration: true,
				nativePathDerivedEmbedDisplay: true,
			});
			const controller = createController(bundle, fixture);
			const rawPlan = await controller.buildLegacyStructurePlan(
				'legacy-migration-3-path-derived-display'
			);
			const plan = await controller.runLegacyLinkPreflight(rawPlan);

			const result = await controller.migrateLegacyStructure({
				basePlan: {
					foldersToCreate: [],
					filesToCreate: [],
					missingAuditLog: false,
				},
				legacyPlan: plan,
				state: 'legacy_detected',
			});

			assert.equal(result.verifiedCount, 3, fixture.readText(result.journalPath));
			assert.match(
				fixture.readText('01_knowledge/wiki/concepts/topic.md'),
				/\[\[.*\|Topic alias\]\]/
			);
		}],
		['markdown-and-binary-items-use-fresh-read-process-and-preserve-bytes', async () => {
			const fixture = createVaultFixture({ cleanMigration: true });
			const controller = createController(bundle, fixture);
			const rawPlan = await controller.buildLegacyStructurePlan('legacy-migration-4');
			const plan = await controller.runLegacyLinkPreflight(rawPlan);
			const originalBytes = Buffer.from(fixture.readBinaryText('04_memory/concepts/diagram.png'));

			await controller.migrateLegacyStructure({
				basePlan: {
					foldersToCreate: [],
					filesToCreate: [],
					missingAuditLog: false,
				},
				legacyPlan: plan,
				state: 'legacy_detected',
			});

			assert.ok(fixture.events.read >= 1);
			assert.ok(fixture.events.readBinary >= 1);
			assert.ok(fixture.events.process >= 1);
			assert.equal(fixture.events.createBinary, 0, 'binary migration must not create a duplicate');
			assert.deepEqual(
				fixture.readBinaryText('01_knowledge/wiki/concepts/diagram.png'),
				originalBytes
			);
			assert.equal(fixture.events.cachedRead, 0);
		}],
		['conflicts-duplicates-and-unmapped-items-stay-differentiated', async () => {
			const fixture = createVaultFixture();
			const controller = createController(bundle, fixture);
			const plan = await controller.buildLegacyStructurePlan('legacy-migration-5');

			assert.deepEqual(
				plan.items
					.slice()
					.sort((left, right) => left.oldPath.localeCompare(right.oldPath))
					.map((item) => [item.oldPath, item.action]),
				[
					['04_memory/claims/conflict-file.md', 'conflict'],
					['04_memory/claims/duplicate.md', 'conflict'],
					['04_memory/concepts/diagram.png', 'native_move'],
					['04_memory/concepts/related.md', 'native_move'],
					['04_memory/concepts/topic.md', 'native_move'],
					['04_memory/notes/unmapped.md', 'unmapped'],
					['04_memory/procedures/folder-target.md', 'conflict'],
				]
			);
			assert.equal(plan.items.find((item) => item.oldPath.endsWith('/duplicate.md')).targetHash?.length, 64);
			assert.equal(fixture.events.cachedRead, 0);
		}],
		['source-mutation-invalidates-final-confirmation-before-user-move', async () => {
			const fixture = createVaultFixture({ cleanMigration: true });
			const controller = createController(bundle, fixture);
			const initial = await controller.buildLegacyStructurePlan('legacy-migration-6');
			const confirmed = await controller.runLegacyLinkPreflight(initial);
			const renameCount = fixture.events.renameFile;
			fixture.mutateSource('04_memory/concepts/topic.md', (value) => `${value}\nchanged\n`);
			await assert.rejects(
				() => controller.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: confirmed,
					state: 'legacy_detected',
				}),
				/stale/i
			);
			assert.equal(fixture.events.renameFile, renameCount);
		}],
		['post-intent-source-drift-is-rejected-before-native-rename', async () => {
			const fixture = createVaultFixture({ cleanMigration: true });
			const controller = createController(bundle, fixture);
			const migrationId = 'legacy-migration-6-post-intent-source';
			const initial = await controller.buildLegacyStructurePlan(migrationId);
			const confirmed = await controller.runLegacyLinkPreflight(initial);
			const journalPath =
				`00_tracekeeper/control/operations/legacy-migrations/${migrationId}.json`;
			const nativeProcess = fixture.app.vault.process;
			let injected = false;
			let renameCountAtInjection = -1;
			fixture.app.vault.process = async (file, updater) => {
				const result = await nativeProcess(file, updater);
				if (file.path === journalPath && !injected) {
					const journal = JSON.parse(fixture.readText(journalPath));
					if (journal.items.some((item) =>
						item.oldPath === '04_memory/concepts/topic.md'
						&& item.state === 'preflight_passed'
					)) {
						injected = true;
						renameCountAtInjection = fixture.events.renameFile;
						fixture.mutateSource(
							'04_memory/concepts/topic.md',
							(value) => `${value}\nconcurrent user edit\n`
						);
					}
				}
				return result;
			};

			const result = await controller.migrateLegacyStructure({
				basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
				legacyPlan: confirmed,
				state: 'legacy_detected',
			});
			assert.equal(injected, true);
			assert.ok(result.blockedCount >= 1);
			assert.equal(fixture.events.renameFile, renameCountAtInjection);
			assert.ok(fixture.getFileRecord('04_memory/concepts/topic.md'));
			assert.equal(
				fixture.getFileRecord('01_knowledge/wiki/concepts/topic.md'),
				null
			);
		}],
		['preview-identity-invalidates-target-mapping-generation-and-capability-drift', async () => {
			const targetFixture = createVaultFixture({ cleanMigration: true });
			const targetController = createController(bundle, targetFixture);
			const targetInitial = await targetController.buildLegacyStructurePlan(
				'legacy-migration-6-target'
			);
			const targetConfirmed = await targetController.runLegacyLinkPreflight(
				targetInitial
			);
			const targetRenameCount = targetFixture.events.renameFile;
			targetFixture.addTextFile(
				'01_knowledge/wiki/concepts/topic.md',
				'# Appeared after preview\n'
			);
			await assert.rejects(
				() => targetController.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: targetConfirmed,
					state: 'legacy_detected',
				}),
				/stale/i
			);
			assert.equal(targetFixture.events.renameFile, targetRenameCount);

			const mappingFixture = createVaultFixture({ cleanMigration: true });
			const mappingController = createController(bundle, mappingFixture);
			const mappingInitial = await mappingController.buildLegacyStructurePlan(
				'legacy-migration-6-mapping'
			);
			const mappingConfirmed = await mappingController.runLegacyLinkPreflight(
				mappingInitial
			);
			const mappingRenameCount = mappingFixture.events.renameFile;
			mappingFixture.host.resolveLegacyTarget = (sourcePath) =>
				sourcePath === '04_memory/concepts/topic.md'
					? {
							oldPath: sourcePath,
							newPath: '01_knowledge/wiki/concepts/topic-mapping-drift.md',
							kind: 'wiki_concept',
					  }
					: undefined;
			await assert.rejects(
				() => mappingController.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: mappingConfirmed,
					state: 'legacy_detected',
				}),
				/stale/i
			);
			assert.equal(mappingFixture.events.renameFile, mappingRenameCount);

			const generationFixture = createVaultFixture({ cleanMigration: true });
			const generationController = createController(bundle, generationFixture);
			const generationInitial = await generationController.buildLegacyStructurePlan(
				'legacy-migration-6-generation'
			);
			const generationConfirmed = await generationController.runLegacyLinkPreflight(
				generationInitial
			);
			const generationRenameCount = generationFixture.events.renameFile;
			generationFixture.addTextFile(
				'01_knowledge/wiki/unrelated-generation.md',
				'# Unrelated metadata generation\n'
			);
			await assert.rejects(
				() => generationController.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: generationConfirmed,
					state: 'legacy_detected',
				}),
				/stale/i
			);
			assert.equal(generationFixture.events.renameFile, generationRenameCount);

			const tamperFixture = createVaultFixture({ cleanMigration: true });
			const tamperController = createController(bundle, tamperFixture);
			const tamperInitial = await tamperController.buildLegacyStructurePlan(
				'legacy-migration-6-tamper'
			);
			const tamperConfirmed = await tamperController.runLegacyLinkPreflight(
				tamperInitial
			);
			const capabilityTamper = clone(tamperConfirmed);
			capabilityTamper.linkCapability.afterGeneration =
				(capabilityTamper.linkCapability.afterGeneration ?? 0) + 1;
			await assert.rejects(
				() => tamperController.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: capabilityTamper,
					state: 'legacy_detected',
				}),
				/modified after creation/i
			);
			const confirmationTamper = clone(tamperConfirmed);
			confirmationTamper.confirmationHash = '0'.repeat(64);
			await assert.rejects(
				() => tamperController.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: confirmationTamper,
					state: 'legacy_detected',
				}),
				/integrity/i
			);
		}],
		['crash-after-native-move-resumes-from-journal-with-delayed-metadata', async () => {
			const fixture = createVaultFixture({ cleanMigration: true, metadataDelayGenerations: 2 });
			const controller = createController(bundle, fixture);
			const initial = await controller.buildLegacyStructurePlan('legacy-migration-7');
			const confirmed = await controller.runLegacyLinkPreflight(initial);
			const nativeRename = fixture.app.fileManager.renameFile;
			let crashed = false;
			fixture.app.fileManager.renameFile = async (file, targetPath) => {
				const result = await nativeRename(file, targetPath);
				if (!crashed && file.path.includes('/concepts/')) {
					crashed = true;
					throw new Error('simulated crash after move');
				}
				return result;
			};
			await assert.rejects(
				() => controller.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: confirmed,
					state: 'legacy_detected',
				}),
				/simulated crash/
			);
			fixture.app.fileManager.renameFile = nativeRename;
			const restarted = createController(bundle, fixture);
			const recoveryPlan = await restarted.buildLegacyStructurePlan('legacy-migration-7');
			assert.equal(recoveryPlan.recovery, true);
			assert.ok(recoveryPlan.items.some((item) => item.action === 'already_moved'));
			const tamperedRecovery = clone(recoveryPlan);
			tamperedRecovery.items[0].newPath =
				'01_knowledge/wiki/concepts/tampered-lock-target.md';
			const renameCountBeforeTamper = fixture.events.renameFile;
			await assert.rejects(
				() => restarted.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: tamperedRecovery,
					state: 'legacy_detected',
				}),
				/stale or was modified/i
			);
			assert.equal(fixture.events.renameFile, renameCountBeforeTamper);
			const refreshedRecoveryPlan = await restarted.buildLegacyStructurePlan(
				'legacy-migration-7'
			);
			const result = await restarted.migrateLegacyStructure({
				basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
				legacyPlan: refreshedRecoveryPlan,
				state: 'legacy_detected',
			});
			assert.equal(result.verifiedCount, 3);
			assert.equal(result.failedCount, 0);
			assert.ok(fixture.events.loadKnowledgeSnapshot > 5);
		}],
		['journal-binding-tamper-is-rejected-before-recovery', async () => {
			const fixture = createVaultFixture({ cleanMigration: true });
			const controller = createController(bundle, fixture);
			const migrationId = 'legacy-migration-7-journal-tamper';
			const initial = await controller.buildLegacyStructurePlan(migrationId);
			const confirmed = await controller.runLegacyLinkPreflight(initial);
			fixture.app.fileManager.renameFile = async () => {
				throw new Error('simulated move interruption');
			};
			await assert.rejects(
				() => controller.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: confirmed,
					state: 'legacy_detected',
				}),
				/simulated move interruption/
			);
			const journalPath =
				`00_tracekeeper/control/operations/legacy-migrations/${migrationId}.json`;
			const journal = JSON.parse(fixture.readText(journalPath));
			journal.items[0].sourceHash = '0'.repeat(64);
			fixture.writeText(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

			const restarted = createController(bundle, fixture);
			await assert.rejects(
				() => restarted.buildLegacyStructurePlan(migrationId),
				/integrity/i
			);
		}],
		['concurrent-controllers-converge-through-journal-cas-without-duplicate-moves', async () => {
			const fixture = createVaultFixture({ cleanMigration: true });
			const first = createController(bundle, fixture);
			const second = createController(bundle, fixture);
			const migrationId = 'legacy-migration-7-concurrent';
			const initial = await first.buildLegacyStructurePlan(migrationId);
			const confirmed = await first.runLegacyLinkPreflight(initial);
			const renameCountAfterProbe = fixture.events.renameFile;

			const outcomes = await Promise.allSettled([
				first.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: confirmed,
					state: 'legacy_detected',
				}),
				second.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: confirmed,
					state: 'legacy_detected',
				}),
			]);
			assert.ok(
				outcomes.some((outcome) => outcome.status === 'fulfilled'),
				'at least one concurrent controller should retain journal ownership'
			);

			const recoveryPlan = await first.buildLegacyStructurePlan(migrationId);
			const finalResult = await first.migrateLegacyStructure({
				basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
				legacyPlan: recoveryPlan,
				state: 'legacy_detected',
			});
			assert.equal(finalResult.verifiedCount, 3);
			assert.equal(
				fixture.events.renameFile - renameCountAfterProbe,
				3,
				'each user file should be moved exactly once'
			);
			assert.equal(fixture.getFileRecord('04_memory/concepts/topic.md'), null);
			assert.ok(fixture.getFileRecord('01_knowledge/wiki/concepts/topic.md'));
		}],
		['owned-report-create-race-is-reread-and-accepted-for-identical-content', async () => {
			const fixture = createVaultFixture({ cleanMigration: true });
			const controller = createController(bundle, fixture);
			const migrationId = 'legacy-migration-7-report-race';
			const initial = await controller.buildLegacyStructurePlan(migrationId);
			const confirmed = await controller.runLegacyLinkPreflight(initial);
			const reportPath = `00_tracekeeper/control/migrations/${migrationId}.md`;
			const nativeCreate = fixture.app.vault.create;
			let raced = false;
			fixture.app.vault.create = async (filePath, content) => {
				if (!raced && filePath === reportPath) {
					raced = true;
					await nativeCreate(filePath, content);
					throw new Error('simulated destination creation race');
				}
				return nativeCreate(filePath, content);
			};

			const result = await controller.migrateLegacyStructure({
				basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
				legacyPlan: confirmed,
				state: 'legacy_detected',
			});

			assert.equal(raced, true);
			assert.equal(result.verifiedCount, 3);
			assert.equal(result.reportMdPath, reportPath);
			assert.match(fixture.readText(reportPath), /- Verified: 3/);
		}],
		['pending-source-link-drift-blocks-before-that-source-moves', async () => {
			const fixture = createVaultFixture({ cleanMigration: true });
			const controller = createController(bundle, fixture);
			const migrationId = 'legacy-migration-7-link-drift';
			const initial = await controller.buildLegacyStructurePlan(migrationId);
			const confirmed = await controller.runLegacyLinkPreflight(initial);
			const nativeRename = fixture.app.fileManager.renameFile;
			fixture.app.fileManager.renameFile = async (file, targetPath) => {
				const sourcePath = file.path;
				const result = await nativeRename(file, targetPath);
				if (sourcePath === '04_memory/concepts/related.md') {
					fixture.mutateSource(
						'04_memory/concepts/topic.md',
						(value) => value.replace(
							'[[related]]',
							'[[01_knowledge/wiki/outside]]'
						)
					);
				}
				return result;
			};

			const result = await controller.migrateLegacyStructure({
				basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
				legacyPlan: confirmed,
				state: 'legacy_detected',
			});

			assert.ok(result.blockedCount >= 1);
			assert.ok(fixture.getFileRecord('04_memory/concepts/topic.md'));
			assert.equal(
				fixture.getFileRecord('01_knowledge/wiki/concepts/topic.md'),
				null
			);
			const journal = JSON.parse(fixture.readText(result.journalPath));
			const topic = journal.items.find(
				(item) => item.oldPath === '04_memory/concepts/topic.md'
			);
			assert.equal(topic.state, 'blocked');
			assert.match(topic.error, /source relation changed/i);
		}],
		['crash-after-enrichment-and-before-verification-resumes-idempotently', async () => {
			const enrichmentFixture = createVaultFixture({ cleanMigration: true });
			const enrichmentController = createController(bundle, enrichmentFixture);
			const enrichmentInitial = await enrichmentController.buildLegacyStructurePlan(
				'legacy-migration-7-enrichment'
			);
			const enrichmentConfirmed = await enrichmentController.runLegacyLinkPreflight(
				enrichmentInitial
			);
			const nativeProcess = enrichmentFixture.app.vault.process;
			let enrichmentCrash = false;
			enrichmentFixture.app.vault.process = async (file, updater) => {
				const result = await nativeProcess(file, updater);
				if (
					!enrichmentCrash
					&& file.path === '01_knowledge/wiki/concepts/related.md'
				) {
					enrichmentCrash = true;
					throw new Error('simulated crash after enrichment');
				}
				return result;
			};
			await assert.rejects(
				() => enrichmentController.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: enrichmentConfirmed,
					state: 'legacy_detected',
				}),
				/simulated crash after enrichment/
			);
			enrichmentFixture.app.vault.process = nativeProcess;
			const enrichmentRestart = createController(bundle, enrichmentFixture);
			const enrichmentRecovery = await enrichmentRestart.buildLegacyStructurePlan(
				'legacy-migration-7-enrichment'
			);
			const enrichmentResult = await enrichmentRestart.migrateLegacyStructure({
				basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
				legacyPlan: enrichmentRecovery,
				state: 'legacy_detected',
			});
			assert.equal(enrichmentResult.verifiedCount, 3);

			const verificationFixture = createVaultFixture({
				cleanMigration: true,
				metadataWaitTimeoutMs: 40,
			});
			const verificationController = createController(bundle, verificationFixture);
			const verificationInitial = await verificationController.buildLegacyStructurePlan(
				'legacy-migration-7-verification'
			);
			const verificationConfirmed = await verificationController.runLegacyLinkPreflight(
				verificationInitial
			);
			const nativeSnapshot = verificationFixture.host.loadKnowledgeSnapshot;
			let blockVerification = true;
			verificationFixture.host.loadKnowledgeSnapshot = async () => {
				if (
					blockVerification
					&& verificationFixture.getFileRecord(
						'01_knowledge/wiki/concepts/related.md'
					)
				) {
					throw new Error('simulated crash before verification');
				}
				return nativeSnapshot();
			};
			const verificationBlocked =
				await verificationController.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: verificationConfirmed,
					state: 'legacy_detected',
				});
			assert.ok(verificationBlocked.blockedCount >= 1);
			const blockedReport = verificationFixture.readText(
				verificationBlocked.reportMdPath
			);
			assert.match(blockedReport, /- Blocked: [1-9]/);
			assert.equal(verificationFixture.auditEntries.length, 1);
			assert.match(
				verificationFixture.auditEntries[0].entry,
				/result: blocked/
			);
			blockVerification = false;
			const blockedJournal = JSON.parse(
				verificationFixture.readText(verificationBlocked.journalPath)
			);
			verificationFixture.restartKnowledgeIndex();
			assert.ok(
				verificationFixture.loadKnowledgeSnapshot().generation
					<= blockedJournal.metadataGeneration
			);
			const verificationRestart = createController(bundle, verificationFixture);
			const verificationRecovery = await verificationRestart.buildLegacyStructurePlan(
				'legacy-migration-7-verification'
			);
			const verificationResult = await verificationRestart.migrateLegacyStructure({
				basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
				legacyPlan: verificationRecovery,
				state: 'legacy_detected',
			});
			assert.equal(verificationResult.verifiedCount, 3);
			const completedReport = verificationFixture.readText(
				verificationResult.reportMdPath
			);
			assert.notEqual(completedReport, blockedReport);
			assert.match(completedReport, /- Verified: 3/);
			assert.match(completedReport, /- Blocked: 0/);
			assert.equal(verificationFixture.auditEntries.length, 2);
			assert.match(
				verificationFixture.auditEntries[1].entry,
				/result: completed/
			);
		}],
		['both-and-neither-path-recovery-states-stop-without-overwrite', async () => {
			for (const recoveryState of ['both', 'neither']) {
				const fixture = createVaultFixture({ cleanMigration: true });
				const controller = createController(bundle, fixture);
				const migrationId = `legacy-migration-8-${recoveryState}`;
				const initial = await controller.buildLegacyStructurePlan(migrationId);
				const confirmed = await controller.runLegacyLinkPreflight(initial);
				const nativeRename = fixture.app.fileManager.renameFile;
				let crashed = false;
				fixture.app.fileManager.renameFile = async (file, targetPath) => {
					const oldPath = file.path;
					const oldText = fixture.readText(oldPath);
					const result = await nativeRename(file, targetPath);
					if (!crashed && oldPath.endsWith('/topic.md')) {
						crashed = true;
						if (recoveryState === 'both') {
							fixture.addTextFile(oldPath, oldText);
						} else {
							fixture.removeEntry(targetPath);
						}
						throw new Error(`simulated ${recoveryState} path crash`);
					}
					return result;
				};
				await assert.rejects(
					() => controller.migrateLegacyStructure({
						basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
						legacyPlan: confirmed,
						state: 'legacy_detected',
					}),
					/simulated/
				);
				fixture.app.fileManager.renameFile = nativeRename;
				const restarted = createController(bundle, fixture);
				const recoveryPlan = await restarted.buildLegacyStructurePlan(migrationId);
				const result = await restarted.migrateLegacyStructure({
					basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
					legacyPlan: recoveryPlan,
					state: 'legacy_detected',
				});
				assert.ok(
					recoveryState === 'both'
						? result.blockedCount >= 1
						: result.failedCount >= 1
				);
				const cleanupPreview = await restarted.previewLegacyStructureCleanup(
					migrationId
				);
				assert.equal(cleanupPreview.canCleanup, false);
				assert.ok(
					cleanupPreview.blockingItems.some((item) =>
						recoveryState === 'both'
							? item.state === 'blocked'
							: item.state === 'failed'
					)
				);
			}
		}],
		['cleanup-resumes-a-persisted-attempting-root-after-post-trash-journal-failure', async () => {
			const fixture = createVaultFixture({ cleanMigration: true });
			const controller = createController(bundle, fixture);
			const migrationId = 'legacy-migration-9-cleanup-resume';
			const initial = await controller.buildLegacyStructurePlan(migrationId);
			const confirmed = await controller.runLegacyLinkPreflight(initial);
			await controller.migrateLegacyStructure({
				basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
				legacyPlan: confirmed,
				state: 'legacy_detected',
			});
			const preview = await controller.previewLegacyStructureCleanup(migrationId);
			const journalPath =
				`00_tracekeeper/control/operations/legacy-migrations/${migrationId}.json`;
			const nativeProcess = fixture.app.vault.process;
			fixture.app.vault.process = async (file, updater) => {
				if (
					file.path === journalPath
					&& !fixture.getFileRecord('04_memory')
				) {
					throw new Error('simulated post-trash journal failure');
				}
				return nativeProcess(file, updater);
			};
			await assert.rejects(
				() => controller.cleanupLegacyStructure(preview),
				/simulated post-trash journal failure/
			);
			fixture.app.vault.process = nativeProcess;
			const interruptedJournal = JSON.parse(fixture.readText(journalPath));
			assert.equal(interruptedJournal.cleanup.attemptingRoot, '04_memory');
			assert.equal(fixture.getFileRecord('04_memory'), null);

			const restarted = createController(bundle, fixture);
			const recoveryPreview = await restarted.previewLegacyStructureCleanup(
				migrationId
			);
			const recovered = await restarted.cleanupLegacyStructure(recoveryPreview);
			assert.deepEqual(recovered.trashedRoots, ['04_memory']);
			assert.deepEqual(recovered.missingRoots, []);
			assert.deepEqual(recovered.failedRoots, []);
			const recoveredJournal = JSON.parse(fixture.readText(journalPath));
			assert.equal(recoveredJournal.cleanup.attemptingRoot, '');
			assert.ok(recoveredJournal.cleanup.completedAt);
		}],
		['cleanup-rechecks-root-emptiness-after-durable-trash-intent', async () => {
			const fixture = createVaultFixture({ cleanMigration: true });
			const controller = createController(bundle, fixture);
			const migrationId = 'legacy-migration-9-cleanup-final-recheck';
			const initial = await controller.buildLegacyStructurePlan(migrationId);
			const confirmed = await controller.runLegacyLinkPreflight(initial);
			await controller.migrateLegacyStructure({
				basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
				legacyPlan: confirmed,
				state: 'legacy_detected',
			});
			const preview = await controller.previewLegacyStructureCleanup(migrationId);
			const journalPath =
				`00_tracekeeper/control/operations/legacy-migrations/${migrationId}.json`;
			const nativeProcess = fixture.app.vault.process;
			let injected = false;
			fixture.app.vault.process = async (file, updater) => {
				const result = await nativeProcess(file, updater);
				if (file.path === journalPath && !injected) {
					const journal = JSON.parse(fixture.readText(journalPath));
					if (journal.cleanup?.attemptingRoot === '04_memory') {
						injected = true;
						fixture.addTextFile(
							'04_memory/concurrent-user-note.md',
							'# Concurrent user note\n'
						);
					}
				}
				return result;
			};

			const trashCount = fixture.events.trashFile;
			const cleanup = await controller.cleanupLegacyStructure(preview);
			assert.equal(injected, true);
			assert.equal(fixture.events.trashFile, trashCount);
			assert.ok(fixture.getFileRecord('04_memory/concurrent-user-note.md'));
			assert.deepEqual(
				cleanup.failedRoots.map((failure) => failure.path),
				['04_memory']
			);
		}],
		['cleanup-requires-journal-verification-empty-root-and-separate-preview', async () => {
			const unjournaled = createVaultFixture({ cleanMigration: true });
			const unjournaledController = createController(bundle, unjournaled);
			await assert.rejects(
				() => unjournaledController.previewLegacyStructureCleanup('missing-journal'),
				/verified migration journal/i
			);

			const fixture = createVaultFixture({ cleanMigration: true });
			const controller = createController(bundle, fixture);
			const initial = await controller.buildLegacyStructurePlan('legacy-migration-9');
			const confirmed = await controller.runLegacyLinkPreflight(initial);
			const result = await controller.migrateLegacyStructure({
				basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
				legacyPlan: confirmed,
				state: 'legacy_detected',
			});
			assert.equal(result.cleanupAvailable, true);
			fixture.addTextFile('04_memory/remaining.md', '# Remaining\n');
			const blockedPreview = await controller.previewLegacyStructureCleanup(
				'legacy-migration-9'
			);
			assert.equal(blockedPreview.canCleanup, false);
			assert.deepEqual(blockedPreview.remainingFiles, ['04_memory/remaining.md']);
			await assert.rejects(
				() => controller.cleanupLegacyStructure(blockedPreview),
				/blocked/i
			);
			fixture.removeEntry('04_memory/remaining.md');
			const preview = await controller.previewLegacyStructureCleanup(
				'legacy-migration-9'
			);
			assert.equal(preview.canCleanup, true);
			assert.deepEqual(preview.eligibleRoots, ['04_memory']);
			const cleanup = await controller.cleanupLegacyStructure(preview);
			assert.deepEqual(cleanup.trashedRoots, ['04_memory']);
			assert.equal(fixture.getFileRecord('04_memory'), null);
			assert.equal(fixture.events.cachedRead, 0);

			const failedFixture = createVaultFixture({
				cleanMigration: true,
				trashFailures: ['04_memory'],
			});
			const failedController = createController(bundle, failedFixture);
			const failedInitial = await failedController.buildLegacyStructurePlan(
				'legacy-migration-9-failed-cleanup'
			);
			const failedConfirmed = await failedController.runLegacyLinkPreflight(
				failedInitial
			);
			await failedController.migrateLegacyStructure({
				basePlan: { foldersToCreate: [], filesToCreate: [], missingAuditLog: false },
				legacyPlan: failedConfirmed,
				state: 'legacy_detected',
			});
			const failedPreview = await failedController.previewLegacyStructureCleanup(
				'legacy-migration-9-failed-cleanup'
			);
			const failedCleanup = await failedController.cleanupLegacyStructure(
				failedPreview
			);
			assert.deepEqual(
				failedCleanup.failedRoots.map((failure) => failure.path),
				['04_memory']
			);
			assert.ok(failedFixture.getFileRecord('04_memory'));
			}],
	]);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
