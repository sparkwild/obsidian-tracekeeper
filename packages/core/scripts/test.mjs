#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import safety from '../dist/safety.js';
import sourceAnalysisModule from '../dist/source-analysis.js';
import scanModule from '../dist/scan.js';
import graphHealthModule from '../dist/graph-health.js';
import lintModule from '../dist/lint.js';

function writeFile(relativePath, content, basePath) {
	const target = path.join(basePath, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content, 'utf8');
	return target;
}

function createFixture(rootPath) {
	const vaultRoot = path.join(rootPath, 'vault');
	fs.mkdirSync(vaultRoot, { recursive: true });
	return vaultRoot;
}

function run() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-core-test-'));
	let symlinkSupported = false;

	try {
		const vaultRoot = createFixture(tempRoot);
		const configDir = 'vault-config';
		writeFile('00_control/system.md', '# System\n', vaultRoot);
		writeFile('05_knowledge/notes/entry.md', '# Entry\n', vaultRoot);
		writeFile(`${configDir}/config.json`, '{}', vaultRoot);

		writeFile('03_sources/source_seed.md', '# Source Seed\n\nProof text used for scan tests.', vaultRoot);
		const outsideFile = path.join(tempRoot, 'outside.md');
		fs.writeFileSync(outsideFile, 'outside', 'utf8');

		const results = { skipped: [] };

		assert.equal(safety.isSafeDirectoryName(configDir, { protectedDirectoryName: configDir }), false);
		assert.equal(safety.isSafeDirectoryName('.hidden', { allowHidden: false }), false);
		assert.equal(safety.isSafeDirectoryName('.hidden', { allowHidden: true }), true);

		assert.equal(safety.isSafeDirectoryName('notes'), true);
		assert.equal(safety.isSafeDirectoryName('..'), false);
		assert.equal(safety.ensureInsideVaultRoot(vaultRoot, path.join(vaultRoot, '00_control/system.md')), path.join(vaultRoot, '00_control/system.md'));
		assert.throws(() => safety.ensureInsideVaultRoot(vaultRoot, outsideFile), /outside vault root/);
		assert.throws(() => safety.ensureInsideVaultRoot(vaultRoot, path.join(vaultRoot, '../outside.md')), /outside vault root/);

		const scanBeforeSymlink = scanModule.scanVault(vaultRoot, { vaultConfigDir: configDir });
		assert.ok(scanBeforeSymlink.notes.some((note) => note.relativePath === '00_control/system.md'));
		assert.ok(!scanBeforeSymlink.notes.some((note) => note.relativePath.startsWith(`${configDir}/`)), 'Expected vault config directory to be skipped');
		const graphHealth = graphHealthModule.analyzeGraphHealth(scanBeforeSymlink.notes, { maxItems: 10 });
		const advisoryGraphProfile = graphHealthModule.evaluateGraphProfile(graphHealth, 'advisory');
		assert.equal(advisoryGraphProfile.profile, 'advisory');
		assert.equal(advisoryGraphProfile.disabled, false);
		assert.ok(advisoryGraphProfile.profile_issues.every((issue) => issue.severity === 'warning'));
		const strictGraphProfile = graphHealthModule.evaluateGraphProfile(graphHealth, 'strict');
		assert.equal(strictGraphProfile.profile, 'strict');
		assert.ok(strictGraphProfile.profile_issues.some((issue) => issue.severity === 'error'));
		const offGraphProfile = graphHealthModule.evaluateGraphProfile(graphHealth, 'off');
		assert.equal(offGraphProfile.profile, 'off');
		assert.equal(offGraphProfile.disabled, true);
		assert.equal(offGraphProfile.profile_issues.length, 0);
		const advisoryLint = lintModule.lintNotes(vaultRoot, scanBeforeSymlink.notes, {
			graphHealth,
			graphProfile: 'advisory',
		});
		assert.ok(advisoryLint.issues.some((issue) => issue.kind.startsWith('graph_') && issue.severity === 'warning'));
		const strictLint = lintModule.lintNotes(vaultRoot, scanBeforeSymlink.notes, {
			graphHealth,
			graphProfile: 'strict',
		});
		assert.ok(strictLint.issues.some((issue) => issue.kind.startsWith('graph_') && issue.severity === 'error'));
		const offLint = lintModule.lintNotes(vaultRoot, scanBeforeSymlink.notes, {
			graphHealth,
			graphProfile: 'off',
		});
		assert.equal(offLint.issues.some((issue) => issue.kind.startsWith('graph_')), false);

		const linkedTarget = path.join(vaultRoot, '03_sources', 'target.md');
		const linkedSource = path.join(vaultRoot, '03_sources', 'symlink_source.md');
		fs.mkdirSync(path.dirname(linkedTarget), { recursive: true });
		fs.writeFileSync(linkedTarget, '# Target\n', 'utf8');

		try {
			fs.symlinkSync(linkedTarget, linkedSource, process.platform === 'win32' ? 'file' : undefined);
			symlinkSupported = true;
		} catch {
			symlinkSupported = false;
			results.skipped.push('symlink');
		}

		if (symlinkSupported) {
			const scanWithSymlink = scanModule.scanVault(vaultRoot, { vaultConfigDir: configDir });
			assert.equal(scanWithSymlink.notes.some((note) => note.relativePath === '03_sources/symlink_source.md'), false);
		} else {
			console.log('SKIP: platform does not support creating symlinks in this environment');
		}

		const sourceAnalysis = sourceAnalysisModule.analyzeSourceText({
			source: '03_sources/source_seed.md',
			sourceKind: 'local_file',
			analysisMode: 'default',
			purpose: 'smoke test for source analysis',
			content: '# Source\n\nThis is a claim that indicates a source-backed fact and provides evidence.',
			requestPath: '01_inbox/agent_requests/request.md',
		});

		assert.ok(typeof sourceAnalysis.summary === 'string' && sourceAnalysis.summary.length > 0);
		assert.ok(typeof sourceAnalysis.excerpt === 'string');
		assert.equal(Array.isArray(sourceAnalysis.evidenceScaffolds), true);
		assert.equal(Array.isArray(sourceAnalysis.claimScaffolds), true);
		assert.equal(Array.isArray(sourceAnalysis.proposalDrafts), true);

		console.log(
			JSON.stringify(
				{
					result: 'pass',
					vaultRoot,
					scannedNotes: scanBeforeSymlink.notes.length,
					symlinkSupported,
					proposalDrafts: sourceAnalysis.proposalDrafts.length,
					skipped: results.skipped,
				},
				null,
				2
			)
		);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

run();
