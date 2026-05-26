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
import recallModule from '../dist/recall.js';

const KNOWLEDGE_DIR = '01_knowledge';
const CONFIG_DIR = 'vault-config';

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

function createSourceSeed(vaultRoot) {
	writeFile(
		`${CONFIG_DIR}/config.json`,
		'{}',
		vaultRoot
	);
	writeFile('00_tracekeeper/control/system.md', '# System\n', vaultRoot);
	writeFile('01_knowledge/sources/source_seed.md', '# Source Seed\n\nProof text used for scan tests.', vaultRoot);
	writeFile('03_sources/legacy_source.md', '# Legacy Source\n', vaultRoot);
}

function createGraphAndLintFixture(vaultRoot) {
	writeFile(
		`${KNOWLEDGE_DIR}/wiki/hubs/wiki-bridge.md`,
		'# Wiki Bridge\n',
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/wiki/hubs/wiki-only-link.md`,
		'# Wiki Link\n',
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/memory/memory-bridge.md`,
		['---', 'type: memory', 'related_wiki: [01_knowledge/wiki/hubs/wiki-bridge.md, 00_tracekeeper/work/sessions/session-invalid.md]', '---', '# Memory Bridge'].join('\n'),
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/memory/memory-yaml-only.md`,
		['---', 'type: memory', '---', '# Memory YAML Only', '[[01_knowledge/wiki/hubs/wiki-only-link]]'].join('\n'),
		vaultRoot
	);

	writeFile(
		`${KNOWLEDGE_DIR}/memory/projects/alpha/note.md`,
		'# Project Alpha\n',
		vaultRoot
	);

	writeFile(
		`${KNOWLEDGE_DIR}/wiki/concepts/recall-priority.md`,
		'# Recall Priority\nRecall priority token for recall ranking.\n',
		vaultRoot
	);
	writeFile(
		'04_memory/recall-priority.md',
		'# Recall Priority\nRecall priority token for recall ranking.\n',
		vaultRoot
	);
}

function createReciprocalCase(vaultRoot) {
	writeFile(
		`${KNOWLEDGE_DIR}/wiki/hubs/wiki-bad-bridge.md`,
		'# Wiki Bad Bridge\n',
		vaultRoot
	);
}

function assertLintKinds(issues, expectedKinds) {
	const actualKinds = new Set(issues.map((issue) => issue.kind));
	for (const kind of expectedKinds) {
		assert.equal(actualKinds.has(kind), true, `Expected lint kind "${kind}" to be present`);
	}
}

function run() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-core-test-'));
	let symlinkSupported = false;

	try {
		const vaultRoot = createFixture(tempRoot);
		createSourceSeed(vaultRoot);
		createGraphAndLintFixture(vaultRoot);
		createReciprocalCase(vaultRoot);

		const results = { skipped: [] };
		const rootConfigPath = path.join(vaultRoot, CONFIG_DIR, 'config.json');
		const outsideFile = path.join(tempRoot, 'outside.md');
		fs.writeFileSync(outsideFile, 'outside', 'utf8');

		assert.equal(safety.isSafeDirectoryName(CONFIG_DIR, { protectedDirectoryName: CONFIG_DIR }), false);
		assert.equal(safety.isSafeDirectoryName('.hidden', { allowHidden: false }), false);
		assert.equal(safety.isSafeDirectoryName('.hidden', { allowHidden: true }), true);

		assert.equal(safety.isSafeDirectoryName('notes'), true);
		assert.equal(safety.isSafeDirectoryName('..'), false);
		assert.equal(safety.ensureInsideVaultRoot(vaultRoot, path.join(vaultRoot, '00_tracekeeper/control/system.md')), path.join(vaultRoot, '00_tracekeeper/control/system.md'));
		assert.throws(() => safety.ensureInsideVaultRoot(vaultRoot, outsideFile), /outside vault root/);
		assert.throws(() => safety.ensureInsideVaultRoot(vaultRoot, path.join(vaultRoot, '../outside.md')), /outside vault root/);
		assert.equal(fs.existsSync(rootConfigPath), true);

		const scanBeforeSymlink = scanModule.scanVault(vaultRoot, { vaultConfigDir: CONFIG_DIR });
		assert.ok(scanBeforeSymlink.notes.some((note) => note.relativePath === '00_tracekeeper/control/system.md'));
		assert.ok(!scanBeforeSymlink.notes.some((note) => note.relativePath.startsWith(`${CONFIG_DIR}/`)), 'Expected vault config directory to be skipped');

		const recallScan = scanModule.scanVault(vaultRoot, { vaultConfigDir: CONFIG_DIR });
		const recallMatches = recallModule.recallNotes(recallScan.notes, 'recall priority', { limit: 3 });
		assert.ok(recallMatches.length > 0, 'recall should return at least one result');
		assert.equal(recallMatches[0].note.relativePath, `${KNOWLEDGE_DIR}/wiki/concepts/recall-priority.md`);

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
		assertLintKinds(advisoryLint.issues, [
			'architecture_legacy_directory',
			'architecture_missing_required_path',
			'architecture_invalid_wiki_path',
			'graph_missing_memory_wiki_bridge',
			'graph_missing_wiki_memory_backlink',
			'graph_missing_project_index',
			'graph_yaml_only_relation',
		]);

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

		const linkedTarget = path.join(vaultRoot, '01_knowledge', 'sources', 'target.md');
		const linkedSource = path.join(vaultRoot, '01_knowledge', 'sources', 'symlink_source.md');
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
			const scanWithSymlink = scanModule.scanVault(vaultRoot, { vaultConfigDir: CONFIG_DIR });
			assert.equal(scanWithSymlink.notes.some((note) => note.relativePath === '01_knowledge/sources/symlink_source.md'), false);
		} else {
			console.log('SKIP: platform does not support creating symlinks in this environment');
		}

		const sourceAnalysis = sourceAnalysisModule.analyzeSourceText({
			source: '01_knowledge/sources/source_seed.md',
			sourceKind: 'local_file',
			analysisMode: 'default',
			purpose: 'smoke test for source analysis',
			content: '# Source\n\nThis is a claim that indicates a source-backed fact and provides evidence.',
			requestPath: '00_tracekeeper/inbox/agent_requests/request.md',
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
