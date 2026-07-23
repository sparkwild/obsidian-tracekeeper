#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-client-skill-adapter-test-'));
const output = path.join(tempRoot, 'client-skill-adapter.bundle.mjs');

try {
	await build({
		entryPoints: [path.resolve('src/adapters/client-skill-adapter.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
		loader: { '.md': 'text', '.json': 'text' },
	});
	const module = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const files = new Map();
	let renameFailureTarget = '';
	const fileApi = {
		existsSync: (filePath) => files.has(filePath),
		readFileSync: (filePath) => {
			if (!files.has(filePath)) throw new Error(`missing ${filePath}`);
			return files.get(filePath);
		},
		writeFileSync: (filePath, content) => files.set(filePath, content),
		mkdirSync: () => undefined,
		renameSync: (oldPath, newPath) => {
			if (!files.has(oldPath)) throw new Error(`missing ${oldPath}`);
			if (files.has(newPath)) throw new Error(`destination exists ${newPath}`);
			if (newPath === renameFailureTarget && oldPath.includes('.tracekeeper-stage-')) {
				renameFailureTarget = '';
				throw new Error(`simulated rename failure ${newPath}`);
			}
			files.set(newPath, files.get(oldPath));
			files.delete(oldPath);
		},
		rmSync: (target, options = {}) => {
			for (const key of [...files.keys()]) {
				if (key === target || (options.recursive && key.startsWith(`${target}/`))) files.delete(key);
			}
		},
	};
	let now = new Date('2026-07-23T00:00:00.000Z');
	const targetDirectory = '/tmp/codex/skills/tracekeeper';
	const profile = {
		id: 'codex',
		displayName: 'Codex',
		supportsManagedInstall: true,
		targetDirectory,
		restartRequired: true,
		profileLabel: 'Local default profile',
	};
	const oldBundle = buildBundle('1.9.0', '# Tracekeeper old\n');
	const currentBundle = buildBundle('2.0.0', '# Tracekeeper current\n');
	const oldAdapter = new module.ClientSkillAdapter({
		fs: fileApi,
		path: { dirname: path.dirname, join: path.join },
		bundle: oldBundle,
		now: () => now,
		planTtlMs: 1_000,
	});

	assert.equal(oldAdapter.detect(profile).state, 'not_installed');
	const installPlan = oldAdapter.previewInstall(profile);
	assert.equal(installPlan.action, 'install');
	assert.equal(installPlan.canConfirm, true);
	assert.ok(installPlan.files.every((file) => file.change === 'create'));
	oldAdapter.confirmInstall(installPlan.planId);
	files.set(path.join(targetDirectory, 'notes.txt'), 'unrelated user file\n');
	assert.equal(oldAdapter.detect(profile).fileVerified, true);

	const currentAdapter = new module.ClientSkillAdapter({
		fs: fileApi,
		path: { dirname: path.dirname, join: path.join },
		bundle: currentBundle,
		now: () => now,
		planTtlMs: 1_000,
	});
	assert.equal(currentAdapter.detect(profile).state, 'update_available');
	const conflictPlan = currentAdapter.previewUpdate(profile);
	files.set(path.join(targetDirectory, 'SKILL.md'), `${files.get(path.join(targetDirectory, 'SKILL.md'))}changed after preview\n`);
	assert.throws(
		() => currentAdapter.confirmUpdate(conflictPlan.planId),
		(error) => error instanceof module.ClientSkillPlanConflictError && /changed after preview/.test(error.message)
	);
	files.set(path.join(targetDirectory, 'SKILL.md'), oldBundle.installFiles['SKILL.md']);

	const updatePlan = currentAdapter.previewUpdate(profile);
	const updateResult = currentAdapter.confirmUpdate(updatePlan.planId);
	assert.equal(updateResult.action, 'update');
	assert.ok(updateResult.backupDirectory);
	assert.equal(files.get(path.join(targetDirectory, 'notes.txt')), 'unrelated user file\n');
	assert.equal(currentAdapter.detect(profile).state, 'installed');
	assert.equal(currentAdapter.detect(profile).fileVerified, true);
	assert.ok([...files.keys()].some((filePath) => filePath.startsWith(updateResult.backupDirectory)));

	files.set(path.join(targetDirectory, 'SKILL.md'), '# user customization\n');
	assert.equal(currentAdapter.detect(profile).state, 'modified');
	const modifiedPreview = currentAdapter.previewUpdate(profile);
	assert.equal(modifiedPreview.action, 'conflict');
	assert.equal(modifiedPreview.canConfirm, false);
	files.set(path.join(targetDirectory, 'SKILL.md'), currentBundle.installFiles['SKILL.md']);

	const nextBundle = buildBundle('2.1.0', '# Tracekeeper next\n');
	const nextAdapter = new module.ClientSkillAdapter({
		fs: fileApi,
		path: { dirname: path.dirname, join: path.join },
		bundle: nextBundle,
		now: () => now,
		planTtlMs: 1_000,
	});
	const beforeFailedUpdate = new Map(
		Object.keys(currentBundle.installFiles).map((filePath) => [filePath, files.get(path.join(targetDirectory, filePath))])
	);
	const failedUpdatePlan = nextAdapter.previewUpdate(profile);
	renameFailureTarget = path.join(targetDirectory, 'dist/tracekeeper.flattened.md');
	assert.throws(() => nextAdapter.confirmUpdate(failedUpdatePlan.planId), /simulated rename failure/);
	for (const [filePath, content] of beforeFailedUpdate) {
		assert.equal(files.get(path.join(targetDirectory, filePath)), content);
	}
	assert.equal(currentAdapter.detect(profile).state, 'installed');

	now = new Date('2026-07-23T00:00:02.000Z');
	const copyOnly = module.buildClientSkillProfile('cursor', 'Cursor', '/tmp/home', path.join);
	assert.equal(copyOnly.supportsManagedInstall, false);
	assert.equal(currentAdapter.previewInstall(copyOnly).action, 'copy_only');

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 26 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}

function buildBundle(version, skillContent) {
	const normalize = (value) => `${value.replace(/\r\n?/g, '\n').trimEnd()}\n`;
	const sha = (value) => `sha256:${createHash('sha256').update(normalize(value), 'utf8').digest('hex')}`;
	const sourceFiles = {
		'SKILL.md': normalize(skillContent),
		'references/workflow-state-machine.md': '# Workflow\n',
		'references/ingestion-workflow.md': '# Ingestion\n',
		'references/failure-recovery.md': '# Recovery\n',
		'references/closeout-fields.md': '# Closeout\n',
		'references/instruction-isolation.md': '# Isolation\n',
	};
	const flattened = normalize(`${skillContent}\n# References\n`);
	const manifestFiles = Object.entries(sourceFiles).map(([filePath, content]) => ({ path: filePath, sha256: sha(content) }));
	const canonical = ['tracekeeper-skill-bundle-v1', ...manifestFiles.map((file) => `${file.path}\0${file.sha256}`), ''].join('\n');
	const manifest = {
		format_version: 1,
		name: 'tracekeeper',
		skill_version: version,
		workflow_contract_version: 3,
		minimum_tracekeeper_version: '0.2.4',
		hash_algorithm: 'sha256',
		bundle_hash: sha(canonical),
		files: manifestFiles,
		artifacts: { flattened: { path: 'dist/tracekeeper.flattened.md', sha256: sha(flattened) } },
	};
	const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
	return {
		manifest,
		manifestText,
		flattened,
		sourceFiles,
		installFiles: { ...sourceFiles, 'manifest.json': manifestText, 'dist/tracekeeper.flattened.md': flattened },
	};
}
