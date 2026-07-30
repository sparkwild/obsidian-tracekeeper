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

function fakeObsidianApp(root) {
	return {
		vault: {
			getMarkdownFiles: () => markdownFiles(root),
			cachedRead: async (file) =>
				fsPromises.readFile(path.join(root, ...file.path.split('/')), 'utf8'),
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

async function waitForReady(adapter, vaultRoot) {
	for (;;) {
		const snapshot = adapter.scanSnapshot(vaultRoot);
		if (snapshot?.index?.index_state === 'ready') {
			return snapshot;
		}
		await new Promise((resolve) => setImmediate(resolve));
	}
}

async function createReadyAdapter(bundlePath, fixtureRoot) {
	const Adapter = loadAdapter(bundlePath);
	const adapter = Adapter.create(fakeObsidianApp(fixtureRoot), fixtureRoot);
	const rebuildPromise = adapter.rebuild();
	const runtimeStartedAt = nowNs();
	const [report, readyScan] = await Promise.all([
		rebuildPromise,
		waitForReady(adapter, fixtureRoot),
	]);
	return {
		adapter,
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

async function applyIncrementalEvent(adapter, fixtureRoot, event) {
	const beforeSnapshot = await adapter.knowledgeSnapshot();
	const mutationStartedAt = nowNs();
	let apply;

	if (event.kind === 'create' || event.kind === 'modify') {
		const content = contentForIncrementalEvent(event);
		const absolutePath = path.join(fixtureRoot, ...event.path.split('/'));
		await writeEventContent(absolutePath, content, event.modified_at);
		const file = abstractFile(fixtureRoot, event.path);
		apply = () => event.kind === 'create'
			? adapter.applyCreate(file)
			: adapter.applyModify(file);
	} else if (event.kind === 'delete') {
		const file = abstractFile(fixtureRoot, event.path);
		await fsPromises.unlink(path.join(fixtureRoot, ...event.path.split('/')));
		apply = () => adapter.applyDelete(file);
	} else {
		const sourcePath = path.join(fixtureRoot, ...event.path.split('/'));
		const targetPath = path.join(fixtureRoot, ...event.new_path.split('/'));
		await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
		await fsPromises.rename(sourcePath, targetPath);
		const file = abstractFile(fixtureRoot, event.new_path);
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

async function applyIncrementalEvents(adapter, fixtureRoot, eventScript) {
	const results = [];
	for (const event of eventScript.events) {
		const result = await applyIncrementalEvent(adapter, fixtureRoot, event);
		results.push(result);
		if (result.status !== 'passed') {
			throw new Error(
				`Incremental ${event.kind} event ${event.sequence} changed generation unexpectedly.`
			);
		}
	}
	return results;
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
		const fixturePhase = await measurePhase(async () => {
			fixture = await generateFixture({
				fixtureRoot,
				tier: options.tier,
				seed: options.seed,
				eventCounts: options.eventCounts,
			});
			return fixture;
		});
		const fixtureCheck = await verifyFixture(fixture);
		if (!fixtureCheck.ok) {
			throw new Error(`Fixture verification failed: ${fixtureCheck.failures.join('; ')}`);
		}

		const scanPhase = await measurePhase(
			async () => core.scanVault(fixtureRoot)
		);
		const scan = scanPhase.result;
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
		const coreFirstReadyPhase = await measurePhase(async () => {
			const index = new core.InMemoryKnowledgeIndex({ vaultRoot: fixtureRoot });
			await index.rebuild(scan);
			return index.snapshot();
		});

		const adapterPhase = await measurePhase(
			async () => createReadyAdapter(options.adapterBundlePath, fixtureRoot)
		);
		const adapter = adapterPhase.result.adapter;
		const incrementalEvents = await applyIncrementalEvents(
			adapter,
			fixtureRoot,
			fixture.incrementalEvents
		);
		const incrementalSnapshot = await adapter.knowledgeSnapshot();
		const incrementalDigest = snapshotDigests(incrementalSnapshot);

		const rebuildAfterEventsPhase = await measurePhase(async () =>
			createReadyAdapter(options.adapterBundlePath, fixtureRoot)
		);
		const freshAdapter = rebuildAfterEventsPhase.result.adapter;
		const freshSnapshot = await freshAdapter.knowledgeSnapshot();
		const freshDigest = snapshotDigests(freshSnapshot);
		const convergence = incrementalDigest.content_sha256 === freshDigest.content_sha256;
		if (!convergence) {
			throw new Error('Incremental index did not converge with a fresh full rebuild.');
		}

		const recallResults = await measureRecallQueries(
			fixture.manifest,
			freshAdapter.scanSnapshot(fixtureRoot),
			fixtureRoot
		);
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
