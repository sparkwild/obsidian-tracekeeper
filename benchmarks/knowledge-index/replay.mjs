#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
	canonicalJson,
	resolveFixtureConfig,
	sha256,
	TIER_NOTE_COUNTS,
} from './config.mjs';
import {
	buildAdapterBundle,
	createFixtureRoot,
	repositoryRoot,
	runReplayStress,
} from './harness.mjs';
import {
	collectProvenance,
	configurationHash,
} from './report.mjs';

const modulePath = fileURLToPath(import.meta.url);
const moduleDirectory = path.dirname(modulePath);
const reportRoot = path.join(
	repositoryRoot,
	'.specs/runtime-modularization/audits/index-replay-reports'
);

function parseArgs(argv) {
	const options = {
		tier: 'tiny',
		seed: 'tracekeeper-index-v1',
		allowScale: false,
		retainFixtures: false,
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
		} else if (arg === '--allow-scale') {
			options.allowScale = true;
		} else if (arg === '--retain-fixtures') {
			options.retainFixtures = true;
		} else {
			throw new Error(`Unknown replay argument: ${arg}`);
		}
	}
	if (!TIER_NOTE_COUNTS[options.tier]) {
		throw new Error(`Unknown replay tier: ${options.tier}`);
	}
	if (options.tier !== 'tiny' && !options.allowScale) {
		throw new Error('Scale replay tiers require --allow-scale.');
	}
	return options;
}

function compactUtc(value) {
	return value.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

function verifyReportRootIgnored() {
	const result = spawnSync(
		'git',
		['check-ignore', '-q', '--no-index', path.join(reportRoot, 'probe', 'replay-stress.json')],
		{ cwd: repositoryRoot, stdio: 'ignore', timeout: 5_000 }
	);
	if (result.status !== 0) {
		throw new Error('Replay report root is not ignored by Git.');
	}
}

async function sourceSha() {
	const sourceFiles = [
		'config.mjs',
		'fixture.mjs',
		'harness.mjs',
		'normalize.mjs',
		'replay.mjs',
		'report.mjs',
	];
	const contents = await Promise.all(
		sourceFiles.map((filename) => fs.readFile(path.join(moduleDirectory, filename), 'utf8'))
	);
	return sha256(contents.join('\u0000'));
}

async function writeDurable(filePath, content) {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const handle = await fs.open(filePath, 'w');
	try {
		await handle.writeFile(content, 'utf8');
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function renderMarkdown(stress, provenance) {
	return [
		'# Knowledge index replay stress',
		'',
		`- Schema: \`${stress.schema}\``,
		`- Tier: \`${stress.tier}\``,
		`- Status: \`${stress.status}\``,
		`- Evidence status: \`${provenance.status}\``,
		`- Git commit: \`${provenance.git.commit}\``,
		`- Attempted events: ${stress.metrics.attempted_event_count}`,
		`- Queued events: ${stress.metrics.queued_event_count}`,
		`- Base rebuild ms: ${(stress.metrics.base_rebuild_ns / 1_000_000).toFixed(3)}`,
		`- Queued apply ms: ${(stress.metrics.queued_apply_ns / 1_000_000).toFixed(3)}`,
		`- Total rebuild plus replay ms: ${(stress.metrics.total_rebuild_replay_ns / 1_000_000).toFixed(3)}`,
		`- Content convergence: ${stress.correctness.content_converged ? 'passed' : 'failed'}`,
		`- Correctness: ${stress.correctness.ok ? 'passed' : 'failed'}`,
		'',
		'This report uses synthetic temporary Vaults and a benchmark-only observer over the production adapter logic.',
		'',
	].join('\n');
}

async function main() {
	verifyReportRootIgnored();
	const options = parseArgs(process.argv.slice(2));
	const startedAt = new Date().toISOString();
	const config = resolveFixtureConfig({ tier: options.tier, seed: options.seed });
	const supportRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-index-replay-support-'));
	const fixtureRoot = await createFixtureRoot('tracekeeper-index-replay-fixture-');
	const referenceRoot = await createFixtureRoot('tracekeeper-index-replay-reference-');
	try {
		const adapterBundlePath = await buildAdapterBundle(supportRoot);
		const stress = await runReplayStress({
			fixtureRoot,
			referenceRoot,
			adapterBundlePath,
			tier: options.tier,
			seed: options.seed,
			retainFixture: options.retainFixtures,
		});
		const endedAt = new Date().toISOString();
		const provenance = {
			...(await collectProvenance({
				repositoryRoot,
				generatorSha256: stress.generator_sha256,
				harnessSha256: await sourceSha(),
				fixtureManifestSha256: stress.fixture_manifest_sha256,
				config,
			})),
			started_at: startedAt,
			ended_at: endedAt,
		};
		const commit = provenance.git.commit.slice(0, 8);
		const runGroupId = [
			compactUtc(startedAt),
			commit,
			options.tier,
			configurationHash(config),
		].join('-');
		const runDirectory = path.join(reportRoot, runGroupId);
		await Promise.all([
			writeDurable(path.join(runDirectory, 'replay-stress.json'), canonicalJson(stress)),
			writeDurable(path.join(runDirectory, 'provenance.json'), canonicalJson(provenance)),
			writeDurable(path.join(runDirectory, 'REPORT.md'), renderMarkdown(stress, provenance)),
		]);
		process.stdout.write(`${JSON.stringify({
			result: stress.status === 'passed' ? 'pass' : 'fail',
			run_group_id: runGroupId,
			report_directory: path.relative(repositoryRoot, runDirectory),
			metrics: stress.metrics,
			correctness: stress.correctness,
		}, null, 2)}\n`);
		if (stress.status !== 'passed') {
			process.exitCode = 1;
		}
	} finally {
		await fs.rm(supportRoot, { recursive: true, force: true });
		if (!options.retainFixtures) {
			await Promise.all([
				fs.rm(fixtureRoot, { recursive: true, force: true }),
				fs.rm(referenceRoot, { recursive: true, force: true }),
			]);
		}
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
