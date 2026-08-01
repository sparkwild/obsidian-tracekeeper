import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

import {
	canonicalJson,
	largestRemainder,
	resolveFixtureConfig,
} from './config.mjs';
import {
	buildAdapterBundle,
	createMarkdownFileCatalog,
	runSingleRepetition,
} from './harness.mjs';
import {
	cleanupFixture,
	generateFixture,
	verifyFixture,
} from './fixture.mjs';
import {
	snapshotDigests,
	summarizeNanoseconds,
} from './normalize.mjs';
import {
	collectProvenance,
	createReportWriter,
	sanitizeReportValue,
	summarizeSamples,
} from './report.mjs';
import { parseArgs } from './run.mjs';

const require = createRequire(import.meta.url);
const core = require('@tracekeeper/core');

function tempDirectory(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function markdownFile(root, relativePath) {
	const absolutePath = path.join(root, ...relativePath.split('/'));
	const extension = path.extname(relativePath).toLowerCase();
	const stat = fs.statSync(absolutePath);
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

test('largest-remainder allocation is exact and declaration-order deterministic', () => {
	assert.deepEqual(
		largestRemainder(7, [
			{ weight: 1 },
			{ weight: 1 },
			{ weight: 1 },
		]),
		[3, 2, 2]
	);
	assert.equal(
		largestRemainder(40, resolveFixtureConfig({ tier: 'tiny' }).roots)
			.reduce((sum, count) => sum + count, 0),
		40
	);
});

test('tiny fixture generation is deterministic, complete, and cleans its temporary roots', async () => {
	const firstRoot = tempDirectory('tracekeeper-index-fixture-first-');
	const secondRoot = tempDirectory('tracekeeper-index-fixture-second-');
	try {
		const first = await generateFixture({ fixtureRoot: firstRoot, tier: 'tiny' });
		const second = await generateFixture({ fixtureRoot: secondRoot, tier: 'tiny' });
		const firstCheck = await verifyFixture(first);
		const secondCheck = await verifyFixture(second);
		assert.equal(firstCheck.ok, true);
		assert.equal(secondCheck.ok, true);
		assert.equal(first.manifest.note_count, 40);
		assert.equal(first.manifest.notes.length, 40);
		assert.equal(first.manifest.manifest_sha256, second.manifest.manifest_sha256);
		assert.equal(
			canonicalJson(first.incrementalEvents),
			canonicalJson(second.incrementalEvents)
		);
		assert.equal(
			canonicalJson(first.replayEvents),
			canonicalJson(second.replayEvents)
		);
		const replaySuccessCounts = first.replayEvents.events
			.filter((event) => !event.case)
			.reduce((counts, event) => ({
				...counts,
				[event.kind]: (counts[event.kind] ?? 0) + 1,
			}), {});
		assert.deepEqual(replaySuccessCounts, {
			create: 20,
			modify: 20,
			rename: 20,
			delete: 20,
		});
		const replayCases = first.replayEvents.events.filter((event) => event.case);
		assert.equal(replayCases.length, 8);
		assert.equal(replayCases.every((event) => event.expected_generation_delta === 0), true);
		assert.deepEqual(
			first.replayEvents.events.map((event) => event.sequence),
			Array.from(
				{ length: first.replayEvents.events.length },
				(_, index) => index + 1
			)
		);
		const serialized = canonicalJson(first.manifest);
		assert.doesNotMatch(serialized, new RegExp(firstRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
		assert.doesNotMatch(serialized, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
	} finally {
		await cleanupFixture(firstRoot);
		await cleanupFixture(secondRoot);
	}
	assert.equal(fs.existsSync(firstRoot), false);
	assert.equal(fs.existsSync(secondRoot), false);
});

test('benchmark file catalog preserves native link resolution while tracking mutations', async () => {
	const root = tempDirectory('tracekeeper-index-catalog-');
	try {
		for (const relativePath of ['alpha/Note.md', 'beta/Note.md', 'local/Target.md']) {
			const absolutePath = path.join(root, ...relativePath.split('/'));
			await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
			await fsPromises.writeFile(absolutePath, `# ${relativePath}\n`, 'utf8');
		}
		const catalog = createMarkdownFileCatalog(root);
		assert.equal(catalog.resolve('alpha/Note', 'Source.md')?.path, 'alpha/Note.md');
		assert.equal(catalog.resolve('Target', 'local/Source.md')?.path, 'local/Target.md');
		assert.equal(catalog.resolve('Note', 'Source.md'), null);

		catalog.remove('beta/Note.md');
		assert.equal(catalog.resolve('Note', 'Source.md')?.path, 'alpha/Note.md');

		const renamedPath = path.join(root, 'archive/Renamed.md');
		await fsPromises.mkdir(path.dirname(renamedPath), { recursive: true });
		await fsPromises.rename(path.join(root, 'alpha/Note.md'), renamedPath);
		catalog.rename('alpha/Note.md', markdownFile(root, 'archive/Renamed.md'));
		assert.equal(catalog.resolve('Note', 'Source.md'), null);
		assert.equal(catalog.resolve('Renamed', 'Source.md')?.path, 'archive/Renamed.md');
		assert.deepEqual(
			catalog.all().map((file) => file.path),
			['archive/Renamed.md', 'local/Target.md']
		);
	} finally {
		await fsPromises.rm(root, { recursive: true, force: true });
	}
});

test('content digest ignores volatile state while state digest preserves generation and last event', async () => {
	const root = tempDirectory('tracekeeper-index-normalize-');
	try {
		const fixture = await generateFixture({ fixtureRoot: root, tier: 'tiny' });
		const scan = core.scanVault(root);
		const first = core.buildKnowledgeSnapshot(scan, {
			indexState: 'ready',
			generation: 1,
			lastEvent: null,
			lastRebuild: '2026-01-01T00:00:00.000Z',
		});
		const second = core.buildKnowledgeSnapshot(
			{ ...scan, scannedAt: '2030-01-01T00:00:00.000Z' },
			{
				indexState: 'ready',
				generation: 9,
				lastEvent: {
					kind: 'modify',
					path: fixture.manifest.notes[0].relative_path,
					fileVersion: fixture.manifest.notes[0].file_version,
				},
				lastRebuild: '2030-01-01T00:00:00.000Z',
			}
		);
		const firstDigest = snapshotDigests(first);
		const secondDigest = snapshotDigests(second);
		assert.equal(firstDigest.content_sha256, secondDigest.content_sha256);
		assert.notEqual(firstDigest.state_sha256, secondDigest.state_sha256);
		assert.equal(secondDigest.state.generation, 9);
		assert.equal(secondDigest.state.last_event.kind, 'modify');
	} finally {
		await cleanupFixture(root);
	}
});

test('report writer appends failed samples and removes forbidden absolute paths', async () => {
	const reportRoot = tempDirectory('tracekeeper-index-report-');
	const forbiddenRoot = path.join(os.tmpdir(), 'private-fixture-root');
	try {
		const writer = await createReportWriter({
			reportRoot,
			runGroupId: 'fixed-run',
			forbiddenRoots: [forbiddenRoot, os.homedir()],
		});
		const manifest = { schema: 'fixture', manifest_sha256: 'abc' };
		await writer.initialize({
			fixtureManifest: manifest,
			incrementalEvents: { events: [] },
			replayEvents: { events: [] },
			provenance: {
				status: 'diagnostic',
				config: { tier: 'tiny' },
				git: { commit: 'deadbeef' },
			},
		});
		await writer.appendSample({
			run_id: 'passed',
			status: 'passed',
			phases: {},
			incremental_events: [],
			correctness: { ok: true },
		});
		await writer.appendSample({
			run_id: 'failed',
			status: 'failed',
			error: `${forbiddenRoot}/note.md could not be read`,
			correctness: { ok: false },
		});
		const finalized = await writer.finalize({
			status: 'diagnostic',
			config: { tier: 'tiny' },
			git: { commit: 'deadbeef' },
		});
		assert.equal(finalized.summary.sample_count, 2);
		assert.equal(finalized.summary.failed_count, 1);
		assert.equal(finalized.correctness.ok, false);
		const samples = await fsPromises.readFile(
			path.join(reportRoot, 'fixed-run', 'samples.jsonl'),
			'utf8'
		);
		assert.doesNotMatch(samples, new RegExp(forbiddenRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
		assert.match(samples, /\[REDACTED_PATH\]/u);
		assert.equal(samples.trim().split('\n').length, 2);
	} finally {
		await fsPromises.rm(reportRoot, { recursive: true, force: true });
	}
});

test('benchmark provenance binds untracked paths and bytes', async () => {
	const repositoryRoot = tempDirectory('tracekeeper-index-provenance-');
	try {
		for (const relativePath of [
			'package.json',
			'packages/core/package.json',
			'packages/mcp-runtime/package.json',
			'apps/obsidian-plugin/package.json',
		]) {
			const absolutePath = path.join(repositoryRoot, relativePath);
			await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
			await fsPromises.writeFile(absolutePath, '{"version":"0.3.0"}\n', 'utf8');
		}
		execFileSync('git', ['init', '-q'], { cwd: repositoryRoot });
		execFileSync('git', ['add', '.'], { cwd: repositoryRoot });
		execFileSync('git', ['-c', 'user.name=Tracekeeper Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], { cwd: repositoryRoot });

		await fsPromises.writeFile(path.join(repositoryRoot, 'untracked.txt'), 'first\n', 'utf8');
		const first = await collectProvenance({
			repositoryRoot,
			generatorSha256: 'generator',
			harnessSha256: 'harness',
			fixtureManifestSha256: 'fixture',
			config: { tier: 'tiny' },
		});
		await fsPromises.writeFile(path.join(repositoryRoot, 'untracked.txt'), 'second\n', 'utf8');
		const second = await collectProvenance({
			repositoryRoot,
			generatorSha256: 'generator',
			harnessSha256: 'harness',
			fixtureManifestSha256: 'fixture',
			config: { tier: 'tiny' },
		});

		assert.equal(first.status, 'diagnostic');
		assert.equal(first.git.clean, false);
		assert.equal(first.git.untracked_file_count, 1);
		assert.match(first.git.working_tree_sha256, /^[a-f0-9]{64}$/);
		assert.notEqual(first.git.working_tree_sha256, second.git.working_tree_sha256);
	} finally {
		await fsPromises.rm(repositoryRoot, { recursive: true, force: true });
	}
});

test('summary uses nearest-rank p50/p95 and keeps raw failures out of latency aggregates', () => {
	assert.deepEqual(summarizeNanoseconds([10, 20, 30, 40, 50]), {
		count: 5,
		min_ns: 10,
		p50_ns: 30,
		p95_ns: 50,
		max_ns: 50,
		mean_ns: 30,
	});
	const summary = summarizeSamples([
		{
			status: 'passed',
			phases: { scan: { duration_ns: 10 } },
			incremental_events: [],
			correctness: { ok: true },
		},
		{
			status: 'failed',
			phases: { scan: { duration_ns: 999 } },
			correctness: { ok: false },
		},
	]);
	assert.equal(summary.phases.scan.count, 1);
	assert.equal(summary.phases.scan.max_ns, 10);
	assert.equal(summary.failed_count, 1);
});

test('CLI defaults to one warm-up and five samples and gates scale tiers', () => {
	assert.deepEqual(
		{
			tier: parseArgs([]).tier,
			warmups: parseArgs([]).warmups,
			repetitions: parseArgs([]).repetitions,
		},
		{ tier: 'tiny', warmups: 1, repetitions: 5 }
	);
	assert.throws(() => parseArgs(['--tier', '1k']), /require --allow-scale/u);
	assert.equal(parseArgs(['--tier', '1k', '--allow-scale']).tier, '1k');
});

test('sanitizer recursively redacts repository, home, and temporary roots', () => {
	const value = {
		message: `${os.homedir()}/secret`,
		nested: [`${os.tmpdir()}/fixture`],
	};
	const sanitized = sanitizeReportValue(value, [os.homedir(), os.tmpdir()]);
	assert.equal(sanitized.message, '[REDACTED_PATH]/secret');
	assert.equal(sanitized.nested[0], '[REDACTED_PATH]/fixture');
});

test('tiny harness measures separate phases, converges, retains no fixture, and uses no replay estimate', async () => {
	const supportRoot = tempDirectory('tracekeeper-index-harness-support-');
	const fixtureRoot = tempDirectory('tracekeeper-index-harness-fixture-');
	try {
		const adapterBundlePath = await buildAdapterBundle(supportRoot);
		const result = await runSingleRepetition({
			fixtureRoot,
			adapterBundlePath,
			tier: 'tiny',
			seed: 'tracekeeper-index-v1',
			repetition: 1,
			warmup: false,
			runId: 'tiny-test',
			retainFixture: false,
			now: () => '2026-07-30T00:00:00.000Z',
		});
		assert.equal(result.sample.status, 'passed', result.sample.error);
		assert.equal(result.sample.correctness.ok, true);
		assert.equal(
			result.sample.correctness.incremental_content_sha256,
			result.sample.correctness.fresh_rebuild_content_sha256
		);
		for (const phase of [
			'fixture_generate',
			'scan',
			'core_rebuild',
			'core_first_ready',
			'adapter_first_ready',
			'runtime_first_ready',
			'rebuild_after_events',
		]) {
			assert.ok(result.sample.phases[phase].duration_ns >= 0, `${phase} should be measured`);
		}
		assert.equal(result.sample.incremental_events.length, 16);
		assert.equal(result.sample.incremental_events.every((event) => event.status === 'passed'), true);
		assert.equal(result.sample.recall.length, 6);
		assert.equal(result.sample.replay.status, 'unavailable');
		assert.match(result.sample.replay.reason, /does not expose direct/u);
		assert.equal(result.fixtureManifest.note_count, 40);
	} finally {
		await fsPromises.rm(supportRoot, { recursive: true, force: true });
		await fsPromises.rm(fixtureRoot, { recursive: true, force: true });
	}
	assert.equal(fs.existsSync(fixtureRoot), false);
});
