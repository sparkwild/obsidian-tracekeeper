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
	const symbolicLinks = new Set();
	let renameFailureTarget = '';
	const fileApi = {
		existsSync: (filePath) => files.has(filePath) || symbolicLinks.has(filePath),
		lstatSync: (filePath) => ({
			isSymbolicLink: () => symbolicLinks.has(filePath),
		}),
		readFileSync: (filePath) => {
			if (!files.has(filePath)) {
				throw new Error(`missing ${filePath}`);
			}
			return files.get(filePath);
		},
		writeFileSync: (filePath, content) => files.set(filePath, content),
		mkdirSync: () => undefined,
		renameSync: (oldPath, newPath) => {
			if (!files.has(oldPath)) {
				throw new Error(`missing ${oldPath}`);
			}
			if (files.has(newPath)) {
				throw new Error(`destination exists ${newPath}`);
			}
			if (newPath === renameFailureTarget && oldPath.includes('.tracekeeper-stage-')) {
				renameFailureTarget = '';
				throw new Error(`simulated rename failure ${newPath}`);
			}
			files.set(newPath, files.get(oldPath));
			files.delete(oldPath);
		},
		rmSync: (target, options = {}) => {
			for (const key of [...files.keys()]) {
				if (key === target || (options.recursive && key.startsWith(`${target}/`))) {
					files.delete(key);
				}
			}
		},
	};
	let now = new Date('2026-07-23T00:00:00.000Z');
	const homeDirectory = '/tmp/tracekeeper-user';
	const primaryDirectory = path.join(homeDirectory, '.agents', 'skills', 'tracekeeper');
	const legacyDirectory = path.join(homeDirectory, '.codex', 'skills', 'tracekeeper');
	const claudeCodeDirectory = path.join(homeDirectory, '.claude', 'skills', 'tracekeeper');
	const geminiDirectory = path.join(homeDirectory, '.gemini', 'skills', 'tracekeeper');
	const grokDirectory = path.join(homeDirectory, '.grok', 'skills', 'tracekeeper');
	const zcodeDirectory = path.join(homeDirectory, '.zcode', 'skills', 'tracekeeper');

	const codexProfile = module.buildClientSkillProfile('codex', 'Codex', homeDirectory, path.join);
	assert.equal(codexProfile.supportsManagedInstall, true);
	assert.equal(codexProfile.deliveryMode, 'managed');
	assert.equal(codexProfile.targetDirectory, primaryDirectory);
	assert.deepEqual(codexProfile.legacyTargetDirectories, [legacyDirectory]);
	assert.equal(codexProfile.targetDirectory, path.join(homeDirectory, '.agents', 'skills', 'tracekeeper'));

	const claudeCodeProfile = module.buildClientSkillProfile('claude-code', 'Claude Code', homeDirectory, path.join);
	assert.equal(claudeCodeProfile.supportsManagedInstall, true);
	assert.equal(claudeCodeProfile.targetDirectory, claudeCodeDirectory);

	const cursorProfile = module.buildClientSkillProfile('cursor', 'Cursor', homeDirectory, path.join);
	assert.equal(cursorProfile.supportsManagedInstall, false);
	assert.equal(cursorProfile.deliveryMode, 'copy-only');
	assert.equal(cursorProfile.targetDirectory, undefined);

	for (const [clientId, displayName, targetDirectory] of [
		['gemini', 'Gemini CLI', geminiDirectory],
		['grok', 'Grok Build', grokDirectory],
		['zcode', 'ZCode', zcodeDirectory],
	]) {
		const profile = module.buildClientSkillProfile(clientId, displayName, homeDirectory, path.join);
		assert.equal(profile.supportsManagedInstall, true);
		assert.equal(profile.deliveryMode, 'managed');
		assert.equal(profile.targetDirectory, targetDirectory);
		assert.equal(profile.restartRequired, true);
	}

	const legacyBundle = buildBundle('2.0.0', '# Tracekeeper legacy\n');
	const embeddedBundle = buildBundle('2.1.0', '# Tracekeeper current\n');
	const preReleaseBundle = buildBundle('2.1.0-rc.1', '# Tracekeeper prerelease\n');
	const newerBundle = buildBundle('2.2.0', '# Tracekeeper newer\n');

	const emptyAdapter = new module.ClientSkillAdapter({
		fs: fileApi,
		path: { dirname: path.dirname, join: path.join },
		bundle: embeddedBundle,
		now: () => now,
		planTtlMs: 1_000,
	});
	assert.equal(emptyAdapter.detect(codexProfile).state, 'not_installed');
	symbolicLinks.add(path.join(homeDirectory, '.agents'));
	assert.throws(
		() => emptyAdapter.detect(codexProfile),
		(error) => error instanceof module.ClientSkillPlanConflictError
			&& /symbolic link/i.test(error.message)
	);
	symbolicLinks.clear();
	const installPlan = emptyAdapter.previewInstall(codexProfile);
	assert.equal(installPlan.action, 'install');
	assert.equal(installPlan.canConfirm, true);
	assert.ok(installPlan.files.every((file) => file.change === 'create'));
	assert.equal(installPlan.files.some((file) => file.path === 'dist/tracekeeper.flattened.md'), false);
	emptyAdapter.confirmInstall(installPlan.planId);
	assert.equal(emptyAdapter.detect(codexProfile).state, 'installed');

	seedBundle(files, primaryDirectory, legacyBundle);
	const updateAdapter = new module.ClientSkillAdapter({
		fs: fileApi,
		path: { dirname: path.dirname, join: path.join },
		bundle: embeddedBundle,
		now: () => now,
		planTtlMs: 1_000,
	});
	assert.equal(updateAdapter.detect(codexProfile).state, 'modified');
	const ownedCodexProfile = {
		...codexProfile,
		ownedBundleHash: legacyBundle.manifest.bundle_hash,
		ownedSkillVersion: legacyBundle.manifest.skill_version,
	};
	assert.equal(updateAdapter.detect(ownedCodexProfile).state, 'update_available');
	assert.equal(updateAdapter.detect(ownedCodexProfile).installedVersion, '2.0.0');
	const updatePlan = updateAdapter.previewUpdate(ownedCodexProfile);
	assert.equal(updatePlan.action, 'update');
	assert.equal(updatePlan.canConfirm, true);
	const beforeUpdateFiles = new Map(updatePlan.files.map((entry) => [entry.path, entry.change]));
	assert.equal(beforeUpdateFiles.get('SKILL.md'), 'replace');
	const updated = updateAdapter.confirmUpdate(updatePlan.planId);
	assert.equal(updated.action, 'update');
	assert.equal(updated.backupDirectory !== '', true);
	assert.equal(updateAdapter.detect(ownedCodexProfile).state, 'installed');
	const nextBundle = buildBundle('2.2.0', '# Tracekeeper next\n');
	const nextAdapter = new module.ClientSkillAdapter({
		fs: fileApi,
		path: { dirname: path.dirname, join: path.join },
		bundle: nextBundle,
		now: () => now,
		planTtlMs: 1_000,
	});
	const currentProfile = {
		...codexProfile,
		ownedBundleHash: embeddedBundle.manifest.bundle_hash,
		ownedSkillVersion: embeddedBundle.manifest.skill_version,
	};
	const beforeFailedUpdate = new Map(
		Object.keys(embeddedBundle.installFiles).map((filePath) => [filePath, files.get(path.join(primaryDirectory, filePath))])
	);
	const failedUpdatePlan = nextAdapter.previewUpdate(currentProfile);
	renameFailureTarget = path.join(primaryDirectory, 'SKILL.md');
	assert.throws(() => nextAdapter.confirmUpdate(failedUpdatePlan.planId), /simulated rename failure/);
	for (const [filePath, content] of beforeFailedUpdate) {
		assert.equal(files.get(path.join(primaryDirectory, filePath)), content);
	}

	files.clear();
	seedBundle(files, primaryDirectory, preReleaseBundle);
	const preReleaseAdapter = new module.ClientSkillAdapter({
		fs: fileApi,
		path: { dirname: path.dirname, join: path.join },
		bundle: embeddedBundle,
		now: () => now,
		planTtlMs: 1_000,
	});
	assert.equal(preReleaseAdapter.detect({
		...codexProfile,
		ownedBundleHash: preReleaseBundle.manifest.bundle_hash,
		ownedSkillVersion: preReleaseBundle.manifest.skill_version,
	}).state, 'update_available');

	const modifiedAdapter = new module.ClientSkillAdapter({
		fs: fileApi,
		path: { dirname: path.dirname, join: path.join },
		bundle: embeddedBundle,
		now: () => now,
		planTtlMs: 1_000,
	});
	const installedSkillPath = path.join(primaryDirectory, 'SKILL.md');
	const installedBundle = files.get(installedSkillPath);
	files.set(installedSkillPath, `${installedBundle}\n\nuser custom append`);
	const modifiedState = modifiedAdapter.detect(codexProfile);
	assert.equal(modifiedState.state, 'modified');
	assert.equal(modifiedState.fileVerified, false);
	const modifiedPreview = modifiedAdapter.previewUpdate(codexProfile);
	assert.equal(modifiedPreview.action, 'conflict');
	assert.equal(modifiedPreview.canConfirm, false);

	files.set(installedSkillPath, installedBundle);
	const newerAdapter = new module.ClientSkillAdapter({
		fs: fileApi,
		path: { dirname: path.dirname, join: path.join },
		bundle: embeddedBundle,
		now: () => now,
		planTtlMs: 1_000,
	});
	seedBundle(files, primaryDirectory, newerBundle);
	assert.equal(newerAdapter.detect(codexProfile).state, 'newer_than_bundled');
	assert.equal(newerAdapter.detect(codexProfile).installedVersion, '2.2.0');
	const newerPreview = newerAdapter.previewUpdate(codexProfile);
	assert.equal(newerPreview.action, 'none');
	assert.equal(newerPreview.canConfirm, false);

	const legacyAdapter = new module.ClientSkillAdapter({
		fs: fileApi,
		path: { dirname: path.dirname, join: path.join },
		bundle: embeddedBundle,
		now: () => now,
		planTtlMs: 1_000,
	});
	files.clear();
	seedBundle(files, legacyDirectory, legacyBundle);
	const legacyDetected = legacyAdapter.detect(codexProfile);
	assert.equal(legacyDetected.state, 'legacy_install');
	const legacyPreview = legacyAdapter.previewMigrate(codexProfile);
	assert.equal(legacyPreview.action, 'migrate');
	assert.equal(legacyPreview.canConfirm, true);
	const legacyResult = legacyAdapter.confirmMigrate(legacyPreview.planId);
	assert.equal(legacyResult.action, 'migrate');
	assert.equal(legacyAdapter.detect(codexProfile).state, 'location_conflict');
	assert.ok(files.has(path.join(legacyDirectory, 'SKILL.md')));
	assert.ok(files.has(path.join(primaryDirectory, 'SKILL.md')));

	const conflictAdapter = new module.ClientSkillAdapter({
		fs: fileApi,
		path: { dirname: path.dirname, join: path.join },
		bundle: embeddedBundle,
		now: () => now,
		planTtlMs: 1_000,
	});
	files.clear();
	seedBundle(files, primaryDirectory, embeddedBundle);
	seedBundle(files, legacyDirectory, legacyBundle);
	const conflictState = conflictAdapter.detect(codexProfile);
	assert.equal(conflictState.state, 'location_conflict');
	assert.equal(conflictAdapter.previewInstall(codexProfile).action, 'conflict');
	assert.equal(conflictAdapter.previewInstall(codexProfile).canConfirm, false);

	const nonDowngradeLegacyAdapter = new module.ClientSkillAdapter({
		fs: fileApi,
		path: { dirname: path.dirname, join: path.join },
		bundle: embeddedBundle,
		now: () => now,
		planTtlMs: 1_000,
	});
	files.clear();
	seedBundle(files, legacyDirectory, newerBundle);
	const nonDowngradeState = nonDowngradeLegacyAdapter.detect(codexProfile);
	assert.equal(nonDowngradeState.state, 'newer_than_bundled');
	assert.throws(
		() => nonDowngradeLegacyAdapter.previewMigrate(codexProfile),
		(error) => error instanceof module.ClientSkillPlanConflictError && /Expected a Skill install preview/.test(error.message)
	);

	console.log(JSON.stringify({ result: 'pass', checks: 47 }));
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}

function seedBundle(files, targetDirectory, bundle) {
	for (const [filePath, content] of Object.entries(bundle.installFiles)) {
		files.set(path.join(targetDirectory, filePath), content);
	}
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
		installFiles: { ...sourceFiles, 'manifest.json': manifestText },
	};
}
