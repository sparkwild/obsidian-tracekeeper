import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	BENCHMARK_REPORT_ROOT_DEFAULT,
	REPLAY_REPORT_ROOT_DEFAULT,
	parseOutputDir,
	repositoryRoot,
	resolveOutputRoot,
} from './output-options.mjs';

function createTemporaryRoot(name) {
	return fs.mkdtemp(path.join(os.tmpdir(), name));
}

async function createTemporaryFile() {
	const directory = await createTemporaryRoot('tracekeeper-output-options-file-');
	const filePath = path.join(directory, 'output.txt');
	await fs.writeFile(filePath, 'placeholder', 'utf8');
	return { directory, filePath };
}

test('parseOutputDir supports default, explicit, and filtered arguments', () => {
	assert.equal(
		parseOutputDir([], BENCHMARK_REPORT_ROOT_DEFAULT).outputDir,
		BENCHMARK_REPORT_ROOT_DEFAULT
	);
	const custom = '/tmp/custom-output-root';
	const parsed = parseOutputDir(['--tier', 'tiny', '--output-dir', custom], REPLAY_REPORT_ROOT_DEFAULT);
	assert.equal(parsed.outputDir, custom);
	assert.deepEqual(parsed.argv, ['--tier', 'tiny']);
});

test('parseOutputDir rejects missing output-dir argument', () => {
	assert.throws(
		() => parseOutputDir(['--output-dir'], BENCHMARK_REPORT_ROOT_DEFAULT),
		/output-dir requires a directory argument\./u
	);
	assert.throws(
		() => parseOutputDir(['--output-dir', '--tier', 'tiny'], BENCHMARK_REPORT_ROOT_DEFAULT),
		/output-dir requires a directory argument\./u
	);
});

test('resolveOutputRoot accepts default and explicit temporary directory', async () => {
	assert.equal(resolveOutputRoot(BENCHMARK_REPORT_ROOT_DEFAULT), BENCHMARK_REPORT_ROOT_DEFAULT);
	assert.equal(resolveOutputRoot(REPLAY_REPORT_ROOT_DEFAULT), REPLAY_REPORT_ROOT_DEFAULT);
	assert.equal(
		BENCHMARK_REPORT_ROOT_DEFAULT,
		path.join(repositoryRoot, 'tmp', 'knowledge-index-reports')
	);
	assert.equal(
		REPLAY_REPORT_ROOT_DEFAULT,
		path.join(repositoryRoot, 'tmp', 'index-replay-reports')
	);
	const tempOutputRoot = await createTemporaryRoot('tracekeeper-output-options-root-');
	try {
		assert.equal(resolveOutputRoot(tempOutputRoot), tempOutputRoot);
	} finally {
		await fs.rm(tempOutputRoot, { recursive: true, force: true });
	}
});

test('resolveOutputRoot rejects repository root and non-whitelisted in-repo directories', async () => {
	const sourcePath = path.join(repositoryRoot, 'benchmarks', 'knowledge-index');
	assert.throws(
		() => resolveOutputRoot(sourcePath),
		/Git-ignored in repository runs|repository source path/u
	);
	assert.throws(
		() => resolveOutputRoot(repositoryRoot),
		/repository root/u
	);
	const unapprovedInRepoTempRoot = path.join(repositoryRoot, '.tracekeeper-output-options-private');
	try {
		await fs.mkdir(unapprovedInRepoTempRoot, { recursive: true });
		assert.throws(
			() => resolveOutputRoot(unapprovedInRepoTempRoot),
			/Git-ignored in repository runs|repository source path/u
		);
	} finally {
		await fs.rm(unapprovedInRepoTempRoot, { recursive: true, force: true });
	}
});

test('resolveOutputRoot rejects file paths and empty paths', async () => {
	const { directory, filePath } = await createTemporaryFile();
	try {
		assert.throws(
			() => resolveOutputRoot(filePath),
		/Output directory must not be a file path\./u
		);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
	assert.throws(
		() => resolveOutputRoot(''),
		/cannot be empty\./u
	);
	assert.throws(
		() => resolveOutputRoot('   '),
		/cannot be empty\./u
	);
});


test('report allocation refuses a reused run directory', async () => {
 const { createReportWriter } = await import('./report.mjs');
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-output-exclusive-'));
 try {
  const first = await createReportWriter({ reportRoot: root, runGroupId: 'same-run' });
  await fs.writeFile(path.join(first.runDirectory, 'retained.txt'), 'keep');
  await assert.rejects(createReportWriter({ reportRoot: root, runGroupId: 'same-run' }), /EEXIST/);
  assert.equal(await fs.readFile(path.join(first.runDirectory, 'retained.txt'), 'utf8'), 'keep');
 } finally { await fs.rm(root, {recursive:true,force:true}); }
});
