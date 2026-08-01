import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { canonicalJson, REPORT_SCHEMA, sha256 } from './config.mjs';
import { summarizeNanoseconds } from './normalize.mjs';

const PHASE_KEYS = Object.freeze([
	'fixture_generate',
	'scan',
	'core_rebuild',
	'core_first_ready',
	'adapter_first_ready',
	'runtime_first_ready',
	'rebuild_after_events',
]);
const MEMORY_BYTE_KEYS = Object.freeze([
	'rss_before_bytes',
	'rss_peak_bytes',
	'rss_after_bytes',
	'heap_used_before_bytes',
	'heap_used_peak_bytes',
	'heap_used_after_bytes',
	'external_after_bytes',
]);

function command(commandName, args, cwd) {
	const result = spawnSync(commandName, args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 5_000,
	});
	if (result.status !== 0) {
		return '';
	}
	return String(result.stdout ?? '').trim();
}

function commandBuffer(commandName, args, cwd) {
	const result = spawnSync(commandName, args, {
		cwd,
		encoding: null,
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 5_000,
	});
	return result.status === 0 ? result.stdout : Buffer.alloc(0);
}

async function workingTreeFingerprint(repositoryRoot, status, trackedDiff) {
	const untrackedOutput = commandBuffer(
		'git',
		['ls-files', '--others', '--exclude-standard', '-z'],
		repositoryRoot
	);
	const untrackedPaths = untrackedOutput
		.toString('utf8')
		.split('\0')
		.filter(Boolean)
		.sort((left, right) => left.localeCompare(right));
	const hash = crypto.createHash('sha256');
	hash.update('status\0');
	hash.update(status);
	hash.update('\0tracked-diff\0');
	hash.update(trackedDiff);
	for (const relativePath of untrackedPaths) {
		const absolutePath = path.join(repositoryRoot, relativePath);
		const fileStat = await fs.lstat(absolutePath);
		hash.update('\0untracked\0');
		hash.update(relativePath);
		hash.update('\0');
		if (fileStat.isSymbolicLink()) {
			hash.update('symlink\0');
			hash.update(await fs.readlink(absolutePath));
		} else if (fileStat.isFile()) {
			hash.update('file\0');
			hash.update(await fs.readFile(absolutePath));
		} else {
			hash.update(`other:${fileStat.mode}\0`);
		}
	}
	return {
		sha256: hash.digest('hex'),
		untrackedFileCount: untrackedPaths.length,
	};
}

async function fileSha(filePath) {
	try {
		return sha256(await fs.readFile(filePath));
	} catch {
		return null;
	}
}

export async function collectProvenance(options) {
	const repositoryRoot = path.resolve(options.repositoryRoot);
	const commit = command('git', ['rev-parse', 'HEAD'], repositoryRoot);
	const branch = command('git', ['branch', '--show-current'], repositoryRoot);
	const status = command(
		'git',
		['status', '--porcelain', '--untracked-files=all'],
		repositoryRoot
	);
	const trackedDiff = status
		? commandBuffer('git', ['diff', '--binary', 'HEAD'], repositoryRoot)
		: Buffer.alloc(0);
	const workingTree = await workingTreeFingerprint(repositoryRoot, status, trackedDiff);
	const cpu = os.cpus()[0] ?? { model: 'unknown' };
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
	const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'unknown';
	const packagePaths = [
		'package.json',
		'packages/core/package.json',
		'packages/mcp-runtime/package.json',
		'apps/obsidian-plugin/package.json',
	];
	const packageVersions = {};
	for (const relativePath of packagePaths) {
		const parsed = JSON.parse(await fs.readFile(path.join(repositoryRoot, relativePath), 'utf8'));
		packageVersions[relativePath] = parsed.version;
	}
	const npmVersion = command('npm', ['--version'], repositoryRoot);

	return {
		schema: REPORT_SCHEMA,
		status: status ? 'diagnostic' : 'comparable',
		git: {
			commit,
			branch,
			clean: status.length === 0,
			tracked_diff_sha256: status ? sha256(trackedDiff) : null,
			working_tree_sha256: workingTree.sha256,
			untracked_file_count: workingTree.untrackedFileCount,
		},
		packages: packageVersions,
		runtime: {
			node: process.version,
			npm: npmVersion,
			platform: process.platform,
			os_release: os.release(),
			architecture: process.arch,
			cpu_model: cpu.model,
			logical_core_count: os.cpus().length,
			total_memory_bytes: os.totalmem(),
			process_args: process.execArgv.filter((arg) =>
				arg === '--expose-gc' ||
				arg.startsWith('--max-old-space-size')
			),
			timezone,
			locale,
		},
		hashes: {
			package_lock_sha256: await fileSha(path.join(repositoryRoot, 'package-lock.json')),
			generator_sha256: options.generatorSha256,
			harness_sha256: options.harnessSha256,
			fixture_manifest_sha256: options.fixtureManifestSha256,
		},
		config: options.config,
	};
}

function replaceAll(value, search, replacement) {
	if (!search) {
		return value;
	}
	return value.split(search).join(replacement);
}

export function sanitizeReportValue(value, forbiddenRoots = []) {
	if (typeof value === 'string') {
		let sanitized = value;
		for (const root of forbiddenRoots.filter(Boolean)) {
			sanitized = replaceAll(sanitized, root, '[REDACTED_PATH]');
		}
		return sanitized;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => sanitizeReportValue(entry, forbiddenRoots));
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				key,
				sanitizeReportValue(entry, forbiddenRoots),
			])
		);
	}
	return value;
}

async function writeDurable(filePath, content, flag = 'w') {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const handle = await fs.open(filePath, flag);
	try {
		await handle.writeFile(content, 'utf8');
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function writeOnce(filePath, value) {
	const content = canonicalJson(value);
	try {
		const existing = await fs.readFile(filePath, 'utf8');
		if (existing !== content) {
			throw new Error(`${path.basename(filePath)} already exists with different content.`);
		}
		return;
	} catch (error) {
		if (error?.code !== 'ENOENT') {
			throw error;
		}
	}
	await writeDurable(filePath, content);
}

function boundedError(error) {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/\s+/gu, ' ').slice(0, 500);
}

export function failedSample(input, error) {
	return {
		...input,
		status: 'failed',
		error: boundedError(error),
	};
}

function groupEventDurations(samples) {
	const grouped = {
		create: [],
		modify: [],
		delete: [],
		rename: [],
	};
	for (const sample of samples.filter((entry) => entry.status === 'passed')) {
		for (const event of sample.incremental_events ?? []) {
			if (event.status === 'passed' && grouped[event.kind]) {
				grouped[event.kind].push(event.adapter_apply_ns);
			}
		}
	}
	return Object.fromEntries(
		Object.entries(grouped).map(([kind, values]) => [
			kind,
			summarizeNanoseconds(values),
		])
	);
}

function phaseSummary(samples, key) {
	return summarizeNanoseconds(
		samples
			.filter((entry) => entry.status === 'passed')
			.map((entry) => entry.phases?.[key]?.duration_ns)
	);
}

function summarizeBytes(values) {
	const summary = summarizeNanoseconds(values);
	return {
		count: summary.count,
		min_bytes: summary.min_ns,
		p50_bytes: summary.p50_ns,
		p95_bytes: summary.p95_ns,
		max_bytes: summary.max_ns,
		mean_bytes: summary.mean_ns,
	};
}

function memorySummary(samples, phaseKey) {
	const memoryRows = samples
		.filter((entry) => entry.status === 'passed')
		.map((entry) => entry.phases?.[phaseKey]?.memory)
		.filter(Boolean);
	return {
		...Object.fromEntries(MEMORY_BYTE_KEYS.map((key) => [
			key,
			summarizeBytes(memoryRows.map((memory) => memory[key])),
		])),
		gc_available: memoryRows.length > 0 && memoryRows.every((memory) => memory.gc_available),
		gc_invoked_before_baseline:
			memoryRows.length > 0 && memoryRows.every((memory) => memory.gc_invoked_before_baseline),
		sampling_interval_ms: [...new Set(memoryRows.map((memory) => memory.sampling_interval_ms))]
			.sort((left, right) => left - right),
	};
}

function recallSummary(samples) {
	const grouped = new Map();
	for (const sample of samples.filter((entry) => entry.status === 'passed')) {
		for (const recall of sample.recall ?? []) {
			if (recall.status !== 'passed') {
				continue;
			}
			const durations = grouped.get(recall.query_id) ?? [];
			durations.push(recall.duration_ns);
			grouped.set(recall.query_id, durations);
		}
	}
	return Object.fromEntries(
		[...grouped.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([queryId, values]) => [queryId, summarizeNanoseconds(values)])
	);
}

export function summarizeSamples(samples) {
	const passed = samples.filter((sample) => sample.status === 'passed');
	const failed = samples.filter((sample) => sample.status === 'failed');
	return {
		schema: REPORT_SCHEMA,
		sample_count: samples.length,
		passed_count: passed.length,
		failed_count: failed.length,
		phases: Object.fromEntries(PHASE_KEYS.map((key) => [key, phaseSummary(samples, key)])),
		memory: Object.fromEntries(PHASE_KEYS.map((key) => [key, memorySummary(samples, key)])),
		incremental_events: groupEventDurations(samples),
		recall: recallSummary(samples),
		correctness_passed:
			passed.length > 0 &&
			passed.every((sample) => sample.correctness?.ok === true),
	};
}

function milliseconds(value) {
	return value === null ? 'n/a' : (value / 1_000_000).toFixed(3);
}

function mebibytes(value) {
	return value === null ? 'n/a' : (value / (1024 * 1024)).toFixed(2);
}

function latencyRows(entries) {
	return Object.entries(entries).map(([name, values]) =>
		`| \`${name}\` | ${values.count} | ${milliseconds(values.p50_ns)} | ${milliseconds(values.p95_ns)} |`
	);
}

function renderMarkdown(summary, provenance) {
	return [
		'# Knowledge index benchmark report',
		'',
		`- Schema: \`${summary.schema}\``,
		`- Tier: \`${provenance.config.tier}\``,
		`- Status: \`${provenance.status}\``,
		`- Git commit: \`${provenance.git.commit}\``,
		`- Samples: ${summary.sample_count}`,
		`- Passed: ${summary.passed_count}`,
		`- Failed: ${summary.failed_count}`,
		`- Correctness: ${summary.correctness_passed ? 'passed' : 'failed or incomplete'}`,
		'',
		'## Phase latency',
		'',
		'| Phase | Count | p50 ms | p95 ms |',
		'| --- | ---: | ---: | ---: |',
		...latencyRows(summary.phases),
		'',
		'## Incremental event latency',
		'',
		'| Event | Count | p50 ms | p95 ms |',
		'| --- | ---: | ---: | ---: |',
		...latencyRows(summary.incremental_events),
		'',
		'## Recall latency',
		'',
		'| Query | Count | p50 ms | p95 ms |',
		'| --- | ---: | ---: | ---: |',
		...latencyRows(summary.recall),
		'',
		'## Peak memory',
		'',
		'| Phase | RSS p50 MiB | RSS p95 MiB | Heap p50 MiB | Heap p95 MiB |',
		'| --- | ---: | ---: | ---: | ---: |',
		...Object.entries(summary.memory).map(([phase, memory]) => [
			`| \`${phase}\``,
			mebibytes(memory.rss_peak_bytes.p50_bytes),
			mebibytes(memory.rss_peak_bytes.p95_bytes),
			mebibytes(memory.heap_used_peak_bytes.p50_bytes),
			`${mebibytes(memory.heap_used_peak_bytes.p95_bytes)} |`,
		].join(' | ')),
		'',
		'This report is synthetic evidence. It is not a product SLO or a cache decision.',
		'',
	].join('\n');
}

export async function createReportWriter(options) {
	const reportRoot = path.resolve(options.reportRoot);
	const runGroupId = options.runGroupId;
	if (!/^[a-zA-Z0-9._-]+$/u.test(runGroupId)) {
		throw new Error('Run group id contains unsafe characters.');
	}
	const runDirectory = path.join(reportRoot, runGroupId);
	await fs.mkdir(runDirectory, { recursive: true });
	const forbiddenRoots = [...new Set(options.forbiddenRoots ?? [])];
	const samplesPath = path.join(runDirectory, 'samples.jsonl');

	return {
		runDirectory,
		async initialize(input) {
			await writeOnce(
				path.join(runDirectory, 'fixture-manifest.json'),
				sanitizeReportValue(input.fixtureManifest, forbiddenRoots)
			);
			await writeOnce(
				path.join(runDirectory, 'incremental-events.json'),
				sanitizeReportValue(input.incrementalEvents, forbiddenRoots)
			);
			await writeOnce(
				path.join(runDirectory, 'replay-events.json'),
				sanitizeReportValue(input.replayEvents, forbiddenRoots)
			);
			await writeOnce(
				path.join(runDirectory, 'provenance.json'),
				sanitizeReportValue(input.provenance, forbiddenRoots)
			);
		},
		async appendSample(sample) {
			const safeSample = sanitizeReportValue(sample, forbiddenRoots);
			await writeDurable(samplesPath, `${JSON.stringify(safeSample)}\n`, 'a');
		},
		async readSamples() {
			try {
				const content = await fs.readFile(samplesPath, 'utf8');
				return content
					.split('\n')
					.filter(Boolean)
					.map((line) => JSON.parse(line));
			} catch (error) {
				if (error?.code === 'ENOENT') {
					return [];
				}
				throw error;
			}
		},
		async finalize(provenance) {
			const samples = await this.readSamples();
			const summary = summarizeSamples(samples);
			const correctness = {
				schema: REPORT_SCHEMA,
				ok: summary.failed_count === 0 && summary.correctness_passed,
				samples: samples.map((sample) => ({
					run_id: sample.run_id,
					repetition: sample.repetition,
					status: sample.status,
					correctness: sample.correctness ?? null,
				})),
			};
			await writeDurable(path.join(runDirectory, 'summary.json'), canonicalJson(summary));
			await writeDurable(path.join(runDirectory, 'correctness.json'), canonicalJson(correctness));
			await writeDurable(path.join(runDirectory, 'REPORT.md'), renderMarkdown(summary, provenance));
			return { summary, correctness };
		},
	};
}

export function configurationHash(config) {
	return crypto.createHash('sha256').update(canonicalJson(config)).digest('hex').slice(0, 12);
}
