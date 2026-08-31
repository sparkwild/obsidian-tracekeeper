#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { canonicalJson, resolveFixtureConfig, sha256, TIER_NOTE_COUNTS } from './config.mjs';
import {
	buildAdapterBundle,
	createFixtureRoot,
	repositoryRoot,
	runSingleRepetition,
} from './harness.mjs';
import {
	collectProvenance,
	configurationHash,
	createReportWriter,
} from './report.mjs';

const modulePath = fileURLToPath(import.meta.url);
const moduleDirectory = path.dirname(modulePath);
const defaultReportRoot = path.join(
	repositoryRoot,
	'.specs/runtime-modularization/audits/index-benchmark-reports'
);
const WORKER_TIMEOUT_MS_BY_TIER = Object.freeze({
	tiny: 10 * 60 * 1_000,
	'1k': 10 * 60 * 1_000,
	'5k': 15 * 60 * 1_000,
	'20k': 30 * 60 * 1_000,
});

function parsePositiveInt(value, label) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`${label} must be a non-negative integer.`);
	}
	return parsed;
}

export function parseArgs(argv) {
	const options = {
		tier: 'tiny',
		seed: 'tracekeeper-index-v1',
		warmups: 1,
		repetitions: 5,
		allowScale: false,
		retainFixtures: false,
		worker: false,
		resultPath: '',
		adapterBundlePath: '',
		runId: '',
		repetition: 0,
		warmup: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = argv[index + 1];
		if (arg === '--tier' && next) {
			options.tier = next;
			index += 1;
		} else if (arg === '--seed' && next) {
			options.seed = next;
			index += 1;
		} else if (arg === '--warmups' && next) {
			options.warmups = parsePositiveInt(next, 'warmups');
			index += 1;
		} else if (arg === '--repetitions' && next) {
			options.repetitions = parsePositiveInt(next, 'repetitions');
			index += 1;
		} else if (arg === '--allow-scale') {
			options.allowScale = true;
		} else if (arg === '--retain-fixtures') {
			options.retainFixtures = true;
		} else if (arg === '--worker') {
			options.worker = true;
		} else if (arg === '--result' && next) {
			options.resultPath = next;
			index += 1;
		} else if (arg === '--adapter-bundle' && next) {
			options.adapterBundlePath = next;
			index += 1;
		} else if (arg === '--run-id' && next) {
			options.runId = next;
			index += 1;
		} else if (arg === '--repetition' && next) {
			options.repetition = parsePositiveInt(next, 'repetition');
			index += 1;
		} else if (arg === '--warmup') {
			options.warmup = true;
		} else {
			throw new Error(`Unknown benchmark argument: ${arg}`);
		}
	}
	if (!TIER_NOTE_COUNTS[options.tier]) {
		throw new Error(`Unknown benchmark tier: ${options.tier}`);
	}
	if (options.repetitions < 1) {
		throw new Error('repetitions must be at least 1.');
	}
	if (options.tier !== 'tiny' && !options.allowScale && !options.worker) {
		throw new Error('Scale tiers require --allow-scale and belong to Phase P2.');
	}
	return options;
}

function compactUtc(value) {
	return value
		.replace(/[-:]/gu, '')
		.replace(/\.\d{3}Z$/u, 'Z');
}

async function sourceSha() {
	const sourceFiles = [
		'config.mjs',
		'fixture.mjs',
		'harness.mjs',
		'normalize.mjs',
		'report.mjs',
		'run.mjs',
	];
	const contents = await Promise.all(
		sourceFiles.map((filename) => fs.readFile(path.join(moduleDirectory, filename), 'utf8'))
	);
	return sha256(contents.join('\u0000'));
}

async function writeWorkerResult(resultPath, result) {
	await fs.mkdir(path.dirname(resultPath), { recursive: true });
	const handle = await fs.open(resultPath, 'w');
	try {
		await handle.writeFile(canonicalJson(result), 'utf8');
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function runWorker(options) {
	if (!options.resultPath || !options.adapterBundlePath || !options.runId) {
		throw new Error('Worker requires --result, --adapter-bundle, and --run-id.');
	}
	const fixtureRoot = await createFixtureRoot();
	const progressPath = `${options.resultPath}.progress.json`;
	const result = await runSingleRepetition({
		fixtureRoot,
		adapterBundlePath: options.adapterBundlePath,
		tier: options.tier,
		seed: options.seed,
		repetition: options.repetition,
		warmup: options.warmup,
		runId: options.runId,
		retainFixture: options.retainFixtures,
		onProgress: (progress) => writeWorkerResult(progressPath, {
			schema: 'tracekeeper-index-benchmark-progress/v1',
			run_id: options.runId,
			updated_at: new Date().toISOString(),
			...progress,
		}),
	});
	if (options.retainFixtures) {
		result.retainedFixturePath = fixtureRoot;
	}
	await writeWorkerResult(options.resultPath, result);
	process.exitCode = result.sample.status === 'passed' ? 0 : 1;
}

function verifyReportRootIgnored(reportRoot) {
	const result = spawnSync(
		'git',
		['check-ignore', '-q', '--no-index', path.join(reportRoot, 'probe', 'summary.json')],
		{
			cwd: repositoryRoot,
			stdio: 'ignore',
			timeout: 5_000,
		}
	);
	if (result.status !== 0) {
		throw new Error('Benchmark report root is not ignored by Git.');
	}
}

function workerArgs(options, input) {
	return [
		'--expose-gc',
		modulePath,
		'--worker',
		'--tier',
		options.tier,
		'--seed',
		options.seed,
		'--result',
		input.resultPath,
		'--adapter-bundle',
		input.adapterBundlePath,
		'--run-id',
		input.runId,
		'--repetition',
		String(input.repetition),
		...(input.warmup ? ['--warmup'] : []),
		...(options.retainFixtures ? ['--retain-fixtures'] : []),
	];
}

async function executeWorker(options, input) {
	const result = spawnSync(process.execPath, workerArgs(options, input), {
		cwd: repositoryRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: WORKER_TIMEOUT_MS_BY_TIER[options.tier],
	});
	let payload;
	try {
		payload = JSON.parse(await fs.readFile(input.resultPath, 'utf8'));
	} catch {
		let progress = null;
		try {
			progress = JSON.parse(await fs.readFile(`${input.resultPath}.progress.json`, 'utf8'));
		} catch {
			progress = null;
		}
		const diagnostic = [
			result.error instanceof Error ? result.error.message : '',
			String(result.stderr ?? '').trim(),
			result.signal ? `signal ${result.signal}` : '',
			progress
				? `last checkpoint ${progress.phase} ${progress.completed ?? ''}/${progress.total ?? ''}`.trim()
				: 'no worker checkpoint',
		].filter(Boolean).join('; ').slice(0, 300);
		throw new Error(
			`Benchmark worker did not produce a result${diagnostic ? `: ${diagnostic}` : '.'}`
		);
	}
	return {
		payload,
		exitStatus: result.status,
	};
}

export async function runBenchmark(options) {
	verifyReportRootIgnored(defaultReportRoot);
	const config = resolveFixtureConfig({ tier: options.tier, seed: options.seed });
	const startedAt = new Date().toISOString();
	const harnessSha256 = await sourceSha();
	const supportRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-index-support-'));
	const adapterBundlePath = await buildAdapterBundle(supportRoot);
	const commit = spawnSync('git', ['rev-parse', '--short=8', 'HEAD'], {
		cwd: repositoryRoot,
		encoding: 'utf8',
	}).stdout.trim();
	const runGroupId = [
		compactUtc(startedAt),
		commit,
		options.tier,
		configurationHash(config),
	].join('-');
	const measuredResults = [];
	const retainedFixturePaths = [];

	try {
		for (let index = 0; index < options.warmups + options.repetitions; index += 1) {
			const warmup = index < options.warmups;
			const repetition = warmup ? index + 1 : index - options.warmups + 1;
			const runId = `${runGroupId}-${warmup ? 'warmup' : 'sample'}-${repetition}`;
			const resultPath = path.join(supportRoot, `${runId}.json`);
			const workerResult = await executeWorker(options, {
				resultPath,
				adapterBundlePath,
				runId,
				repetition,
				warmup,
			});
			if (workerResult.payload.retainedFixturePath) {
				retainedFixturePaths.push(workerResult.payload.retainedFixturePath);
			}
			if (!warmup) {
				measuredResults.push(workerResult.payload);
			}
		}

		const fixtureSource = measuredResults.find((result) => result.fixtureManifest);
		if (!fixtureSource) {
			throw new Error('No measured repetition produced fixture metadata.');
		}
		const endedAt = new Date().toISOString();
		const provenance = {
			...(await collectProvenance({
				repositoryRoot,
				generatorSha256: fixtureSource.fixtureManifest.generator_sha256,
				harnessSha256,
				fixtureManifestSha256: fixtureSource.fixtureManifest.manifest_sha256,
				config,
			})),
			run_group_id: runGroupId,
			started_at: startedAt,
			ended_at: endedAt,
			warmup_count: options.warmups,
			measured_repetition_count: options.repetitions,
		};
		const writer = await createReportWriter({
			reportRoot: defaultReportRoot,
			runGroupId,
			forbiddenRoots: [
				repositoryRoot,
				os.homedir(),
				os.tmpdir(),
				...retainedFixturePaths,
			],
		});
		await writer.initialize({
			fixtureManifest: fixtureSource.fixtureManifest,
			incrementalEvents: fixtureSource.incrementalEvents,
			replayEvents: fixtureSource.replayEvents,
			provenance,
		});
		for (const result of measuredResults) {
			await writer.appendSample(result.sample);
		}
		const finalized = await writer.finalize(provenance);
		return {
			runGroupId,
			reportDirectory: writer.runDirectory,
			...finalized,
			retainedFixturePaths,
		};
	} finally {
		await fs.rm(supportRoot, { recursive: true, force: true });
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.worker) {
		await runWorker(options);
		return;
	}
	const result = await runBenchmark(options);
	process.stdout.write(`${JSON.stringify({
		result: result.correctness.ok ? 'pass' : 'fail',
		run_group_id: result.runGroupId,
		report_directory: path.relative(repositoryRoot, result.reportDirectory),
		summary: result.summary,
		retained_fixture_paths: result.retainedFixturePaths,
	}, null, 2)}\n`);
	if (!result.correctness.ok) {
		process.exitCode = 1;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
