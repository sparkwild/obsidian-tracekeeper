import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { cleanupFixture, contentForIncrementalEvent, generateFixture, verifyFixture } from './fixture.mjs';
import { snapshotCounts, snapshotDigests } from './normalize.mjs';

const require = createRequire(import.meta.url);
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(moduleDirectory, '../..');
const pluginRequire = createRequire(
	path.join(repositoryRoot, 'apps/obsidian-plugin/package.json')
);
const { build } = pluginRequire('esbuild');
const core = require('@tracekeeper/core');
const runtime = require('@tracekeeper/mcp-runtime');

function nowNs() {
	return process.hrtime.bigint();
}

function elapsedNs(startedAt) {
	return Number(nowNs() - startedAt);
}

function memoryPoint() {
	const usage = process.memoryUsage();
	return {
		rss_bytes: usage.rss,
		heap_used_bytes: usage.heapUsed,
		external_bytes: usage.external,
	};
}

async function measurePhase(operation, options = {}) {
	const samplingIntervalMs = options.samplingIntervalMs ?? 10;
	const gcAvailable = typeof global.gc === 'function';
	if (gcAvailable) {
		global.gc();
	}
	const before = memoryPoint();
	let rssPeak = before.rss_bytes;
	let heapPeak = before.heap_used_bytes;
	const sampler = setInterval(() => {
		const current = memoryPoint();
		rssPeak = Math.max(rssPeak, current.rss_bytes);
		heapPeak = Math.max(heapPeak, current.heap_used_bytes);
	}, samplingIntervalMs);
	const startedAt = nowNs();
	try {
		const result = await operation();
		const durationNs = elapsedNs(startedAt);
		const after = memoryPoint();
		rssPeak = Math.max(rssPeak, after.rss_bytes);
		heapPeak = Math.max(heapPeak, after.heap_used_bytes);
		return {
			result,
			measurement: {
				duration_ns: durationNs,
				memory: {
					rss_before_bytes: before.rss_bytes,
					rss_peak_bytes: rssPeak,
					rss_after_bytes: after.rss_bytes,
					heap_used_before_bytes: before.heap_used_bytes,
					heap_used_peak_bytes: heapPeak,
					heap_used_after_bytes: after.heap_used_bytes,
					external_after_bytes: after.external_bytes,
					gc_available: gcAvailable,
					gc_invoked_before_baseline: gcAvailable,
					sampling_interval_ms: samplingIntervalMs,
				},
			},
		};
	} finally {
		clearInterval(sampler);
	}
}

function markdownFiles(root) {
	const files = [];
	const walk = (directory) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const absolutePath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				walk(absolutePath);
				continue;
			}
			const extension = path.extname(entry.name).toLowerCase();
			if (extension !== '.md' && extension !== '.markdown') {
				continue;
			}
			const stat = fs.statSync(absolutePath);
			const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
			files.push({
				path: relativePath,
				extension: extension.slice(1),
				basename: path.basename(entry.name, extension),
				stat: {
					size: stat.size,
					mtime: stat.mtimeMs,
				},
			});
		}
	};
	walk(root);
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

function abstractFile(root, relativePath) {
	const absolutePath = path.join(root, ...relativePath.split('/'));
	const stat = fs.statSync(absolutePath);
	const extension = path.extname(relativePath).toLowerCase();
	return {
		path: relativePath,
		extension: extension.slice(1),
		basename: path.basename(relativePath, extension),
		stat: {
			size: stat.size,
			mtime: stat.mtimeMs,
		},
	};
}

function nativeReference(edge) {
	return {
		link: `${edge.linkPath}${edge.subpath ? `#${edge.subpath}` : ''}`,
		original: edge.raw,
		displayText: edge.displayText,
		position: edge.position,
		...(edge.referenceLabel ? { id: edge.referenceLabel } : {}),
	};
}

function nativeSectionType(type) {
	switch (type) {
		case 'heading':
			return 'heading';
		case 'fenced-code':
			return 'code';
		case 'html-comment':
			return 'html';
		case 'callout':
			return 'callout';
		default:
			return null;
	}
}

function nativeMetadata(root, file) {
	const absolutePath = path.join(root, ...file.path.split('/'));
	const content = fs.readFileSync(absolutePath, 'utf8');
	const note = core.scannedNoteFromContent({
		absolutePath,
		relativePath: file.path,
		fallbackTitle: file.basename,
		size: file.stat.size,
		modifiedAt: new Date(file.stat.mtime).toISOString(),
		content,
	});
	const frontmatterPosition = note.sections.find(
		(section) => section.type === 'frontmatter'
	)?.position;
	const headingSections = note.sections.filter(
		(section) => section.type === 'heading'
	);
	const sections = note.sections.flatMap((section) => {
		const type = nativeSectionType(section.type);
		return type ? [{ type, position: section.position }] : [];
	});
	const edges = (kind) => note.edges
		.filter((edge) => edge.kind === kind)
		.map(nativeReference);
	const fallbackPosition = {
		start: { line: 0, col: 0, offset: 0 },
		end: { line: 0, col: 0, offset: 0 },
	};

	return {
		frontmatter: note.frontmatter,
		...(frontmatterPosition ? { frontmatterPosition } : {}),
		frontmatterLinks: edges('frontmatter'),
		tags: note.tags.map((tag) => ({
			tag: `#${tag}`,
			position: frontmatterPosition ?? fallbackPosition,
		})),
		headings: note.headings.map((heading, index) => ({
			heading,
			level: 1,
			position: headingSections[index]?.position ?? fallbackPosition,
		})),
		blocks: Object.fromEntries(note.blockIds.map((id) => [
			id,
			{ id, position: fallbackPosition },
		])),
		links: edges('link'),
		embeds: edges('embed'),
		referenceLinks: edges('reference'),
		sections,
	};
}

export function createMarkdownFileCatalog(root) {
	const filesByPath = new Map();
	const pathsByBasename = new Map();

	const remove = (filePath) => {
		const existing = filesByPath.get(filePath);
		if (!existing) {
			return;
		}
		filesByPath.delete(filePath);
		const matchingPaths = pathsByBasename.get(existing.basename);
		matchingPaths?.delete(filePath);
		if (matchingPaths?.size === 0) {
			pathsByBasename.delete(existing.basename);
		}
	};
	const upsert = (file) => {
		remove(file.path);
		filesByPath.set(file.path, file);
		const matchingPaths = pathsByBasename.get(file.basename) ?? new Set();
		matchingPaths.add(file.path);
		pathsByBasename.set(file.basename, matchingPaths);
	};

	for (const file of markdownFiles(root)) {
		upsert(file);
	}

	return {
		all: () => [...filesByPath.values()].sort((left, right) =>
			left.path.localeCompare(right.path)
		),
		find: (filePath) => filesByPath.get(filePath) ?? null,
		remove,
		rename: (oldPath, file) => {
			remove(oldPath);
			upsert(file);
		},
		resolve: (linkPath, sourcePath) => {
			const normalized = linkPath.replace(/\\/gu, '/').replace(/^\/+/u, '');
			const sourceDirectory = path.posix.dirname(sourcePath);
			const withExtension = normalized.endsWith('.md') ? normalized : `${normalized}.md`;
			const candidates = new Set([
				normalized,
				withExtension,
				path.posix.join(sourceDirectory, normalized),
				path.posix.join(sourceDirectory, withExtension),
			]);
			for (const candidate of candidates) {
				const file = filesByPath.get(candidate);
				if (file) {
					return file;
				}
			}
			const basename = path.posix.basename(normalized, path.posix.extname(normalized));
			const basenameMatches = pathsByBasename.get(basename);
			if (basenameMatches?.size !== 1) {
				return null;
			}
			const [matchingPath] = basenameMatches;
			return filesByPath.get(matchingPath) ?? null;
		},
		upsert,
	};
}

function createReadController(root) {
	let gate = null;
	return {
		blockNextRead(filePath) {
			let announceEntered;
			let releaseRead;
			const entered = new Promise((resolve) => {
				announceEntered = resolve;
			});
			const released = new Promise((resolve) => {
				releaseRead = resolve;
			});
			gate = { filePath, announceEntered, released };
			return {
				entered,
				release: () => releaseRead(),
			};
		},
		async read(file) {
			if (gate?.filePath === file.path) {
				const activeGate = gate;
				gate = null;
				activeGate.announceEntered();
				await activeGate.released;
			}
			return fsPromises.readFile(path.join(root, ...file.path.split('/')), 'utf8');
		},
	};
}

function fakeObsidianApp(root, fileCatalog, readController) {
	return {
		vault: {
			getMarkdownFiles: () => fileCatalog.all(),
			getAbstractFileByPath: (filePath) => fileCatalog.find(filePath),
			cachedRead: (file) => readController.read(file),
			read: (file) => readController.read(file),
		},
		metadataCache: {
			getFileCache: (file) => nativeMetadata(root, file),
			getFirstLinkpathDest: (linkPath, sourcePath) =>
				fileCatalog.resolve(linkPath, sourcePath),
			resolvedLinks: {},
			unresolvedLinks: {},
			on: () => ({ id: 'benchmark-metadata-cache-listener' }),
			offref: () => {},
		},
		fileManager: {
			generateMarkdownLink: (target, _sourcePath, subpath = '', alias = '') =>
				`[[${target.path.replace(/\.md$/u, '')}${subpath}${alias ? `|${alias}` : ''}]]`,
		},
	};
}

export async function buildAdapterBundle(outputDirectory) {
	await fsPromises.mkdir(outputDirectory, { recursive: true });
	const outputPath = path.join(outputDirectory, 'knowledge-index-adapter.bundle.cjs');
	await build({
		entryPoints: [path.join(repositoryRoot, 'apps/obsidian-plugin/src/knowledge-index-adapter.ts')],
		outfile: outputPath,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
	});
	return outputPath;
}

function loadAdapter(bundlePath) {
	delete require.cache[require.resolve(bundlePath)];
	return require(bundlePath).ObsidianKnowledgeIndexAdapter;
}

async function waitForReady(adapter, vaultRoot, rebuildState) {
	for (;;) {
		const snapshot = adapter.scanSnapshot(vaultRoot);
		if (snapshot?.index?.index_state === 'ready') {
			return snapshot;
		}
		if (rebuildState.error) {
			throw rebuildState.error;
		}
		if (rebuildState.settled) {
			throw new Error(
				`Adapter rebuild completed without reaching ready state: ${snapshot?.index?.index_state ?? 'missing'}.`
			);
		}
		await new Promise((resolve) => setImmediate(resolve));
	}
}

async function createReadyAdapter(bundlePath, fixtureRoot) {
	const Adapter = loadAdapter(bundlePath);
	const fileCatalog = createMarkdownFileCatalog(fixtureRoot);
	const readController = createReadController(fixtureRoot);
	const adapter = Adapter.create(
		fakeObsidianApp(fixtureRoot, fileCatalog, readController),
		fixtureRoot
	);
	const rebuildPromise = adapter.rebuild();
	const rebuildState = { settled: false, error: null };
	void rebuildPromise.then(
		() => {
			rebuildState.settled = true;
		},
		(error) => {
			rebuildState.error = error;
			rebuildState.settled = true;
		}
	);
	const runtimeStartedAt = nowNs();
	const [report, readyScan] = await Promise.all([
		rebuildPromise,
		waitForReady(adapter, fixtureRoot, rebuildState),
	]);
	return {
		adapter,
		fileCatalog,
		readController,
		report,
		readyScan,
		runtimeFirstReadyNs: elapsedNs(runtimeStartedAt),
	};
}

async function writeEventContent(filePath, content, modifiedAt) {
	await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
	await fsPromises.writeFile(filePath, content, 'utf8');
	const time = new Date(modifiedAt);
	await fsPromises.utimes(filePath, time, time);
}

async function applyIncrementalEvent(adapter, fileCatalog, fixtureRoot, event) {
	const beforeSnapshot = await adapter.knowledgeSnapshot();
	const mutationStartedAt = nowNs();
	let apply;

	if (event.kind === 'create' || event.kind === 'modify') {
		const content = contentForIncrementalEvent(event);
		const absolutePath = path.join(fixtureRoot, ...event.path.split('/'));
		await writeEventContent(absolutePath, content, event.modified_at);
		const file = abstractFile(fixtureRoot, event.path);
		fileCatalog.upsert(file);
		apply = () => event.kind === 'create'
			? adapter.applyCreate(file)
			: adapter.applyModify(file);
	} else if (event.kind === 'delete') {
		const file = abstractFile(fixtureRoot, event.path);
		await fsPromises.unlink(path.join(fixtureRoot, ...event.path.split('/')));
		fileCatalog.remove(event.path);
		apply = () => adapter.applyDelete(file);
	} else {
		const sourcePath = path.join(fixtureRoot, ...event.path.split('/'));
		const targetPath = path.join(fixtureRoot, ...event.new_path.split('/'));
		await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
		await fsPromises.rename(sourcePath, targetPath);
		const file = abstractFile(fixtureRoot, event.new_path);
		fileCatalog.rename(event.path, file);
		apply = () => adapter.applyRename(file, event.path);
	}

	const mutationNs = elapsedNs(mutationStartedAt);
	const applyStartedAt = nowNs();
	await apply();
	const adapterApplyNs = elapsedNs(applyStartedAt);
	const afterSnapshot = await adapter.knowledgeSnapshot();
	const generationDelta = afterSnapshot.generation - beforeSnapshot.generation;
	const accepted = generationDelta === event.expected_generation_delta;

	return {
		sequence: event.sequence,
		kind: event.kind,
		status: accepted ? 'passed' : 'failed',
		filesystem_mutation_ns: mutationNs,
		adapter_apply_ns: adapterApplyNs,
		generation_before: beforeSnapshot.generation,
		generation_after: afterSnapshot.generation,
		expected_generation_delta: event.expected_generation_delta,
		counts: snapshotCounts(afterSnapshot),
	};
}

async function applyIncrementalEvents(adapter, fileCatalog, fixtureRoot, eventScript) {
	const results = [];
	for (const event of eventScript.events) {
		const result = await applyIncrementalEvent(adapter, fileCatalog, fixtureRoot, event);
		results.push(result);
		if (result.status !== 'passed') {
			throw new Error(
				`Incremental ${event.kind} event ${event.sequence} changed generation unexpectedly.`
			);
		}
	}
	return results;
}

function fileVersion(file) {
	return `${new Date(file.stat.mtime).toISOString()}|${file.stat.size}`;
}

function currentFileVersions(fileCatalog) {
	return new Map(fileCatalog.all().map((file) => [file.path, fileVersion(file)]));
}

function replayPrecondition(event, versions) {
	const currentVersion = versions.get(event.path) ?? null;
	if (currentVersion !== event.before_file_version) {
		return {
			accepted: false,
			reason: 'source_version_mismatch',
			current_version: currentVersion,
		};
	}
	if (
		event.kind === 'rename' &&
		event.new_path !== event.path &&
		versions.has(event.new_path)
	) {
		return {
			accepted: false,
			reason: 'target_exists',
			current_version: currentVersion,
		};
	}
	return { accepted: true, reason: null, current_version: currentVersion };
}

async function mutateReplayFilesystem(root, fileCatalog, versions, event) {
	if (event.kind === 'create' || event.kind === 'modify') {
		const content = contentForIncrementalEvent(event);
		const absolutePath = path.join(root, ...event.path.split('/'));
		await writeEventContent(absolutePath, content, event.modified_at);
		const file = abstractFile(root, event.path);
		fileCatalog.upsert(file);
		versions.set(event.path, fileVersion(file));
		if (versions.get(event.path) !== event.after_file_version) {
			throw new Error(`Replay ${event.kind} ${event.sequence} produced an unexpected file version.`);
		}
		return { file };
	}
	if (event.kind === 'delete') {
		const file = fileCatalog.find(event.path);
		if (!file) {
			throw new Error(`Replay delete ${event.sequence} has no current file.`);
		}
		await fsPromises.unlink(path.join(root, ...event.path.split('/')));
		fileCatalog.remove(event.path);
		versions.delete(event.path);
		return { file };
	}

	const file = fileCatalog.find(event.path);
	if (!file) {
		throw new Error(`Replay rename ${event.sequence} has no current source file.`);
	}
	const sourcePath = path.join(root, ...event.path.split('/'));
	const targetPath = path.join(root, ...event.new_path.split('/'));
	await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
	await fsPromises.rename(sourcePath, targetPath);
	const renamedFile = abstractFile(root, event.new_path);
	fileCatalog.rename(event.path, renamedFile);
	versions.delete(event.path);
	versions.set(event.new_path, fileVersion(renamedFile));
	return { file: renamedFile, oldFile: file };
}

async function queueReplayAttempts(adapterState, replayEvents) {
	const versions = currentFileVersions(adapterState.fileCatalog);
	const attempts = [];
	for (const event of replayEvents.events) {
		const precondition = replayPrecondition(event, versions);
		if (!precondition.accepted) {
			if (event.expected_generation_delta !== 0) {
				throw new Error(`Replay event ${event.sequence} failed a required precondition.`);
			}
			attempts.push({
				sequence: event.sequence,
				kind: event.kind,
				case: event.case ?? null,
				status: 'rejected_precondition',
				reason: precondition.reason,
				expected_generation_delta: event.expected_generation_delta,
			});
			continue;
		}
		if (event.expected_generation_delta !== 1) {
			throw new Error(`Replay event ${event.sequence} unexpectedly passed its precondition.`);
		}

		const mutationStartedAt = nowNs();
		const mutation = await mutateReplayFilesystem(
			adapterState.fixtureRoot,
			adapterState.fileCatalog,
			versions,
			event
		);
		const filesystemMutationNs = elapsedNs(mutationStartedAt);
		const applyStartedAt = nowNs();
		if (event.kind === 'create') {
			await adapterState.adapter.applyCreate(mutation.file);
		} else if (event.kind === 'modify') {
			await adapterState.adapter.applyModify(mutation.file);
		} else if (event.kind === 'delete') {
			await adapterState.adapter.applyDelete(mutation.file);
		} else {
			await adapterState.adapter.applyRename(mutation.file, event.path);
		}
		attempts.push({
			sequence: event.sequence,
			kind: event.kind,
			case: event.case ?? null,
			status: 'queued',
			filesystem_mutation_ns: filesystemMutationNs,
			public_apply_ns: elapsedNs(applyStartedAt),
			expected_generation_delta: event.expected_generation_delta,
		});
	}
	return attempts;
}

async function applyReferenceReplay(referenceState, replayEvents) {
	const versions = currentFileVersions(referenceState.fileCatalog);
	const trace = [];
	for (const event of replayEvents.events) {
		const before = await referenceState.adapter.knowledgeSnapshot();
		const precondition = replayPrecondition(event, versions);
		if (!precondition.accepted) {
			if (event.expected_generation_delta !== 0) {
				throw new Error(`Reference replay event ${event.sequence} failed unexpectedly.`);
			}
			trace.push({
				sequence: event.sequence,
				kind: event.kind,
				case: event.case ?? null,
				status: 'rejected_precondition',
				generation_before: before.generation,
				generation_after: before.generation,
				expected_generation_delta: event.expected_generation_delta,
			});
			continue;
		}

		const mutation = await mutateReplayFilesystem(
			referenceState.fixtureRoot,
			referenceState.fileCatalog,
			versions,
			event
		);
		if (event.kind === 'create') {
			await referenceState.adapter.applyCreate(mutation.file);
		} else if (event.kind === 'modify') {
			await referenceState.adapter.applyModify(mutation.file);
		} else if (event.kind === 'delete') {
			await referenceState.adapter.applyDelete(mutation.file);
		} else {
			await referenceState.adapter.applyRename(mutation.file, event.path);
		}
		const after = await referenceState.adapter.knowledgeSnapshot();
		const generationDelta = after.generation - before.generation;
		if (generationDelta !== event.expected_generation_delta) {
			throw new Error(
				`Reference replay event ${event.sequence} changed generation by ${generationDelta}.`
			);
		}
		trace.push({
			sequence: event.sequence,
			kind: event.kind,
			case: event.case ?? null,
			status: 'applied',
			generation_before: before.generation,
			generation_after: after.generation,
			expected_generation_delta: event.expected_generation_delta,
		});
	}
	return { trace, snapshot: await referenceState.adapter.knowledgeSnapshot() };
}

function installReplayObserver(adapter) {
	const queueCalls = [];
	let rebuildStartedAt = null;
	let replay = null;
	const originalQueuePendingEvent = adapter.queuePendingEvent.bind(adapter);
	const originalReplayPendingEvents = adapter.replayPendingEvents.bind(adapter);
	adapter.queuePendingEvent = (event) => {
		const result = originalQueuePendingEvent(event);
		queueCalls.push({
			sequence: event.sequence,
			kind: event.kind === 'upsert' ? event.eventKind : event.kind,
			path: event.path,
			new_path: event.kind === 'rename' ? event.newPath : null,
			pending_path_count: adapter.pendingEvents.size,
			rescan_pending: Boolean(adapter.pendingRescanEvent),
		});
		return result;
	};
	adapter.replayPendingEvents = async (...args) => {
		const replayStartedAt = nowNs();
		const pendingPathCount = adapter.pendingEvents.size;
		const rescanPending = Boolean(adapter.pendingRescanEvent);
		const warnings = await originalReplayPendingEvents(...args);
		replay = {
			base_rebuild_ns: rebuildStartedAt === null
				? null
				: Number(replayStartedAt - rebuildStartedAt),
			queued_apply_ns: elapsedNs(replayStartedAt),
			pending_path_count_at_start: pendingPathCount,
			rescan_pending_at_start: rescanPending,
			warning_count: warnings.length,
		};
		return warnings;
	};
	return {
		queueCalls,
		markRebuildStart: () => {
			rebuildStartedAt = nowNs();
			return rebuildStartedAt;
		},
		result: () => replay,
	};
}

function replayPaths(snapshot) {
	return [...snapshot.notes.keys()].filter((notePath) =>
		notePath.startsWith('01_knowledge/wiki/replay/') ||
		notePath.startsWith('01_knowledge/wiki/replay-renamed/')
	);
}

function contentDifference(left, right) {
	const firstDifference = (leftRows, rightRows) => {
		const leftMap = new Map(leftRows);
		const rightMap = new Map(rightRows);
		for (const rowPath of [...new Set([...leftMap.keys(), ...rightMap.keys()])]
			.sort((leftPath, rightPath) => leftPath.localeCompare(rightPath))) {
			if (JSON.stringify(leftMap.get(rowPath)) !== JSON.stringify(rightMap.get(rowPath))) {
				return rowPath;
			}
		}
		return null;
	};
	return {
		version_equal: left.version === right.version,
		notes_equal: JSON.stringify(left.notes) === JSON.stringify(right.notes),
		first_note_difference: firstDifference(left.notes, right.notes),
		graph_outgoing_equal:
			JSON.stringify(left.graph.outgoing) === JSON.stringify(right.graph.outgoing),
		graph_incoming_equal:
			JSON.stringify(left.graph.incoming) === JSON.stringify(right.graph.incoming),
		scopes_by_type_equal:
			JSON.stringify(left.scopes.by_type) === JSON.stringify(right.scopes.by_type),
		scopes_by_tag_equal:
			JSON.stringify(left.scopes.by_tag) === JSON.stringify(right.scopes.by_tag),
	};
}

export async function runReplayStress(options) {
	const fixtureRoot = path.resolve(options.fixtureRoot);
	const referenceRoot = path.resolve(options.referenceRoot);
	let fixture = null;
	let referenceFixture = null;
	try {
		[fixture, referenceFixture] = await Promise.all([
			generateFixture({
				fixtureRoot,
				tier: options.tier,
				seed: options.seed,
				eventCounts: options.eventCounts,
			}),
			generateFixture({
				fixtureRoot: referenceRoot,
				tier: options.tier,
				seed: options.seed,
				eventCounts: options.eventCounts,
			}),
		]);
		const [fixtureCheck, referenceCheck] = await Promise.all([
			verifyFixture(fixture),
			verifyFixture(referenceFixture),
		]);
		if (!fixtureCheck.ok || !referenceCheck.ok) {
			throw new Error('Replay fixture verification failed.');
		}
		if (fixture.manifest.manifest_sha256 !== referenceFixture.manifest.manifest_sha256) {
			throw new Error('Replay reference fixture identity does not match.');
		}

		const adapterState = await createReadyAdapter(options.adapterBundlePath, fixtureRoot);
		const initialAdapterSnapshot = await adapterState.adapter.knowledgeSnapshot();
		const observer = installReplayObserver(adapterState.adapter);
		const blockerPath = adapterState.fileCatalog.all().at(-1)?.path;
		if (!blockerPath) {
			throw new Error('Replay stress requires at least one fixture note.');
		}
		const readGate = adapterState.readController.blockNextRead(blockerPath);
		const rebuildStartedAt = observer.markRebuildStart();
		const rebuildPromise = adapterState.adapter.rebuild();
		await readGate.entered;
		const attempts = await queueReplayAttempts(
			{ ...adapterState, fixtureRoot },
			fixture.replayEvents
		);
		const pendingBeforeRelease = {
			pending_path_count: adapterState.adapter.pendingEvents.size,
			rescan_pending: Boolean(adapterState.adapter.pendingRescanEvent),
		};
		readGate.release();
		const rebuildReport = await rebuildPromise;
		const totalRebuildReplayNs = elapsedNs(rebuildStartedAt);
		const replayObservation = observer.result();
		if (!replayObservation) {
			throw new Error('Replay observer did not observe the adapter replay boundary.');
		}

		const referenceAdapterState = await createReadyAdapter(
			options.adapterBundlePath,
			referenceRoot
		);
		const referenceResult = await applyReferenceReplay({
			fixtureRoot: referenceRoot,
			fileCatalog: referenceAdapterState.fileCatalog,
			adapter: referenceAdapterState.adapter,
		}, fixture.replayEvents);
		const finalAdapterSnapshot = await adapterState.adapter.knowledgeSnapshot();
		const freshAdapterState = await createReadyAdapter(options.adapterBundlePath, fixtureRoot);
		const freshSnapshot = await freshAdapterState.adapter.knowledgeSnapshot();
		const adapterDigest = snapshotDigests(finalAdapterSnapshot);
		const freshDigest = snapshotDigests(freshSnapshot);
		const referenceDigest = snapshotDigests(referenceResult.snapshot);
		const queuedAttempts = attempts.filter((attempt) => attempt.status === 'queued');
		const rejectedAttempts = attempts.filter(
			(attempt) => attempt.status === 'rejected_precondition'
		);
		const queuedSequenceSet = new Set(observer.queueCalls.map((event) => event.sequence));
		const referenceApplied = referenceResult.trace.filter((event) => event.status === 'applied');
		const referenceRejected = referenceResult.trace.filter(
			(event) => event.status === 'rejected_precondition'
		);
		const correctness = {
			fixture_ok: fixtureCheck.ok && referenceCheck.ok,
			attempt_count: attempts.length,
			queued_attempt_count: queuedAttempts.length,
			rejected_attempt_count: rejectedAttempts.length,
			queue_call_count: observer.queueCalls.length,
			queue_sequences_unique: queuedSequenceSet.size === observer.queueCalls.length,
			queue_sequences_contiguous: observer.queueCalls.every(
				(event, index) => event.sequence === index + 1
			),
			reference_applied_count: referenceApplied.length,
			reference_rejected_count: referenceRejected.length,
			adapter_content_sha256: adapterDigest.content_sha256,
			fresh_content_sha256: freshDigest.content_sha256,
			reference_content_sha256: referenceDigest.content_sha256,
			content_converged:
				adapterDigest.content_sha256 === freshDigest.content_sha256 &&
				adapterDigest.content_sha256 === referenceDigest.content_sha256,
			adapter_reference_difference: contentDifference(
				adapterDigest.content,
				referenceDigest.content
			),
			stale_replay_paths: replayPaths(finalAdapterSnapshot),
			pending_path_count_after: adapterState.adapter.pendingEvents.size,
			rescan_pending_after: Boolean(adapterState.adapter.pendingRescanEvent),
			adapter_ready: finalAdapterSnapshot.index_state === 'ready',
			fresh_ready: freshSnapshot.index_state === 'ready',
		};
		const ok =
			correctness.fixture_ok &&
			correctness.attempt_count === fixture.replayEvents.events.length &&
			correctness.queued_attempt_count === 80 &&
			correctness.rejected_attempt_count === 8 &&
			correctness.queue_call_count === 80 &&
			correctness.queue_sequences_unique &&
			correctness.queue_sequences_contiguous &&
			correctness.reference_applied_count === 80 &&
			correctness.reference_rejected_count === 8 &&
			correctness.content_converged &&
			correctness.stale_replay_paths.length === 0 &&
			correctness.pending_path_count_after === 0 &&
			!correctness.rescan_pending_after &&
			correctness.adapter_ready &&
			correctness.fresh_ready;
		return {
			schema: 'tracekeeper-index-replay-stress/v1',
			status: ok ? 'passed' : 'failed',
			tier: options.tier,
			fixture_manifest_sha256: fixture.manifest.manifest_sha256,
			generator_sha256: fixture.manifest.generator_sha256,
			replay_events_sha256: fixture.manifest.replay_events_sha256,
			metrics: {
				...replayObservation,
				total_rebuild_replay_ns: totalRebuildReplayNs,
				queued_event_count: observer.queueCalls.length,
				attempted_event_count: attempts.length,
			},
			pending_before_release: pendingBeforeRelease,
			generation: {
				adapter_initial: initialAdapterSnapshot.generation,
				adapter_final: finalAdapterSnapshot.generation,
				adapter_event_sequence: finalAdapterSnapshot.event_sequence,
				reference_final: referenceResult.snapshot.generation,
				reference_event_sequence: referenceResult.snapshot.event_sequence,
				rebuild_report_generation: rebuildReport.generation,
				rebuild_report_event_sequence: rebuildReport.event_sequence,
			},
			attempts,
			queue_trace: observer.queueCalls,
			reference_generation_trace: referenceResult.trace,
			correctness: { ...correctness, ok },
			counts: snapshotCounts(finalAdapterSnapshot),
		};
	} finally {
		if (!options.retainFixture) {
			await Promise.all([
				cleanupFixture(fixtureRoot),
				cleanupFixture(referenceRoot),
			]);
		}
	}
}

function recallAssertions(queryId, payload) {
	if (!payload || payload.ok !== true) {
		throw new Error(`${queryId}: Recall did not return a successful structured result.`);
	}
	switch (queryId) {
		case 'global_exact':
		case 'global_fanout':
			if (!(payload.matched_count > 0)) {
				throw new Error(`${queryId}: expected at least one result.`);
			}
			break;
		case 'global_zero':
			if (payload.matched_count !== 0) {
				throw new Error('global_zero: expected a successful zero result.');
			}
			break;
		case 'project_exact':
			if (payload.project_identity?.project_id !== 'project-id-001') {
				throw new Error('project_exact: expected exact project identity.');
			}
			break;
		case 'project_uncertain':
			if (payload.uncertain !== true) {
				throw new Error('project_uncertain: expected visible uncertainty.');
			}
			break;
		case 'project_history':
			if (!(payload.matched_count >= 2)) {
				throw new Error('project_history: expected deterministic task and session results.');
			}
			break;
		default:
			throw new Error(`Unknown Recall query id: ${queryId}`);
	}
}

async function measureRecallQueries(manifest, scan, fixtureRoot) {
	const context = {
		defaultVaultRoot: fixtureRoot,
		principalId: runtime.LOCAL_TRUST_PRINCIPAL_ID,
		credentialCapabilities: runtime.LOCAL_TRUST_CAPABILITIES,
		agentId: 'index-benchmark-agent',
		sessionId: 'index-benchmark-session',
		clientName: 'index-benchmark',
		knowledgeSnapshotProvider: (requestedRoot) =>
			path.resolve(requestedRoot) === path.resolve(fixtureRoot) ? scan : null,
	};
	const results = [];
	for (const [queryId, args] of Object.entries(manifest.queries)) {
		const startedAt = nowNs();
		const result = await runtime.callTool('tracekeeper.recall', args, context);
		const durationNs = elapsedNs(startedAt);
		recallAssertions(queryId, result.structuredContent);
		results.push({
			query_id: queryId,
			duration_ns: durationNs,
			status: 'passed',
			matched_count: result.structuredContent.matched_count,
		});
	}
	return results;
}

export async function runSingleRepetition(options) {
	const startedAt = options.now?.() ?? new Date().toISOString();
	const fixtureRoot = path.resolve(options.fixtureRoot);
	let fixture = null;
	try {
		const checkpoint = async (phase, details = {}) => {
			await options.onProgress?.({ phase, ...details });
		};
		await checkpoint('worker_started');
		const fixturePhase = await measurePhase(async () => {
			fixture = await generateFixture({
				fixtureRoot,
				tier: options.tier,
				seed: options.seed,
				eventCounts: options.eventCounts,
				onProgress: options.onProgress,
			});
			return fixture;
		});
		await checkpoint('fixture_generate_complete', {
			duration_ns: fixturePhase.measurement.duration_ns,
		});
		const fixtureCheck = await verifyFixture(fixture, { onProgress: options.onProgress });
		if (!fixtureCheck.ok) {
			throw new Error(`Fixture verification failed: ${fixtureCheck.failures.join('; ')}`);
		}
		await checkpoint('fixture_verify_complete');

		const scanPhase = await measurePhase(
			async () => core.scanVault(fixtureRoot)
		);
		const scan = scanPhase.result;
		await checkpoint('scan_complete', {
			duration_ns: scanPhase.measurement.duration_ns,
			note_count: scan.notes.length,
		});
		if (scan.notes.length !== fixture.manifest.note_count || scan.errors.length !== 0) {
			throw new Error(
				`Scan mismatch: expected ${fixture.manifest.note_count} notes, got ${scan.notes.length} with ${scan.errors.length} errors.`
			);
		}

		const coreRebuildPhase = await measurePhase(async () => {
			const index = new core.InMemoryKnowledgeIndex({ vaultRoot: fixtureRoot });
			const report = await index.rebuild(scan);
			return { index, report, snapshot: await index.snapshot() };
		});
		await checkpoint('core_rebuild_complete', {
			duration_ns: coreRebuildPhase.measurement.duration_ns,
		});
		const coreFirstReadyPhase = await measurePhase(async () => {
			const index = new core.InMemoryKnowledgeIndex({ vaultRoot: fixtureRoot });
			await index.rebuild(scan);
			return index.snapshot();
		});
		await checkpoint('core_first_ready_complete', {
			duration_ns: coreFirstReadyPhase.measurement.duration_ns,
		});

		const adapterPhase = await measurePhase(
			async () => createReadyAdapter(options.adapterBundlePath, fixtureRoot)
		);
		const adapter = adapterPhase.result.adapter;
		await checkpoint('adapter_first_ready_complete', {
			duration_ns: adapterPhase.measurement.duration_ns,
		});
		const incrementalEvents = await applyIncrementalEvents(
			adapter,
			adapterPhase.result.fileCatalog,
			fixtureRoot,
			fixture.incrementalEvents
		);
		await checkpoint('incremental_events_complete', {
			event_count: incrementalEvents.length,
		});
		const incrementalSnapshot = await adapter.knowledgeSnapshot();
		const incrementalDigest = snapshotDigests(incrementalSnapshot);

		const rebuildAfterEventsPhase = await measurePhase(async () =>
			createReadyAdapter(options.adapterBundlePath, fixtureRoot)
		);
		const freshAdapter = rebuildAfterEventsPhase.result.adapter;
		const freshSnapshot = await freshAdapter.knowledgeSnapshot();
		const freshDigest = snapshotDigests(freshSnapshot);
		await checkpoint('rebuild_after_events_complete', {
			duration_ns: rebuildAfterEventsPhase.measurement.duration_ns,
		});
		const convergence = incrementalDigest.content_sha256 === freshDigest.content_sha256;
		if (!convergence) {
			throw new Error('Incremental index did not converge with a fresh full rebuild.');
		}

		const recallResults = await measureRecallQueries(
			fixture.manifest,
			freshAdapter.scanSnapshot(fixtureRoot),
			fixtureRoot
		);
		await checkpoint('recall_complete', {
			query_count: recallResults.length,
		});
		const endedAt = options.now?.() ?? new Date().toISOString();
		const sample = {
			schema: 'tracekeeper-index-benchmark-sample/v1',
			run_id: options.runId,
			repetition: options.repetition,
			warmup: Boolean(options.warmup),
			tier: options.tier,
			status: 'passed',
			started_at: startedAt,
			ended_at: endedAt,
			phases: {
				fixture_generate: fixturePhase.measurement,
				scan: scanPhase.measurement,
				core_rebuild: coreRebuildPhase.measurement,
				core_first_ready: coreFirstReadyPhase.measurement,
				adapter_first_ready: adapterPhase.measurement,
				runtime_first_ready: {
					duration_ns: adapterPhase.result.runtimeFirstReadyNs,
					memory: {
						...adapterPhase.measurement.memory,
						shared_with: 'adapter_first_ready',
					},
				},
				rebuild_after_events: rebuildAfterEventsPhase.measurement,
			},
			incremental_events: incrementalEvents,
			replay: {
				status: 'unavailable',
				reason: 'P1 does not expose direct adapter queue and replay phase timing.',
			},
			recall: recallResults,
			correctness: {
				ok: fixtureCheck.ok && convergence,
				fixture: fixtureCheck,
				scan_note_count: scan.notes.length,
				scan_error_count: scan.errors.length,
				incremental_content_sha256: incrementalDigest.content_sha256,
				fresh_rebuild_content_sha256: freshDigest.content_sha256,
				generation_trace: incrementalEvents.map((event) => ({
					sequence: event.sequence,
					kind: event.kind,
					before: event.generation_before,
					after: event.generation_after,
					expected_delta: event.expected_generation_delta,
				})),
			},
			counts: snapshotCounts(freshSnapshot),
		};
		return {
			sample,
			fixtureManifest: fixture.manifest,
			incrementalEvents: fixture.incrementalEvents,
			replayEvents: fixture.replayEvents,
		};
	} catch (error) {
		return {
			sample: {
				schema: 'tracekeeper-index-benchmark-sample/v1',
				run_id: options.runId,
				repetition: options.repetition,
				warmup: Boolean(options.warmup),
				tier: options.tier,
				status: 'failed',
				started_at: startedAt,
				ended_at: options.now?.() ?? new Date().toISOString(),
				error: (error instanceof Error ? error.message : String(error))
					.replace(/\s+/gu, ' ')
					.slice(0, 500),
			},
			fixtureManifest: fixture?.manifest ?? null,
			incrementalEvents: fixture?.incrementalEvents ?? null,
			replayEvents: fixture?.replayEvents ?? null,
		};
	} finally {
		if (!options.retainFixture) {
			await cleanupFixture(fixtureRoot);
		}
	}
}

export async function createFixtureRoot(prefix = 'tracekeeper-index-benchmark-') {
	return fsPromises.mkdtemp(path.join(os.tmpdir(), prefix));
}
