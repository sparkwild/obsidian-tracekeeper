import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	compareUpgradeSnapshots,
	createUpgradeFixture,
	snapshotUpgradeFixture,
} from './release_upgrade_fixture.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const writeFile = async (root, relativePath, content) => {
	const target = path.resolve(root, relativePath);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, content);
};

const createTestAssets = async (root) => {
	const contents = {
		'main.js': Buffer.from('synthetic published 0.2.3 main'),
		'manifest.json': Buffer.from(`${JSON.stringify({
			id: 'tracekeeper',
			name: 'Tracekeeper',
			version: '0.2.3',
			minAppVersion: '1.8.7',
		}, null, 2)}\n`),
		'styles.css': Buffer.from('.tracekeeper { color: inherit; }\n'),
	};
	const expected = {};
	for (const [name, content] of Object.entries(contents)) {
		await writeFile(root, name, content);
		expected[name] = { bytes: content.byteLength, sha256: sha256(content) };
	}
	return expected;
};

const upgradeFixture = async (vault) => {
	const contents = {
		'main.js': Buffer.from('synthetic candidate main'),
		'manifest.json': Buffer.from(`${JSON.stringify({
		id: 'tracekeeper',
		name: 'Tracekeeper',
		version: '0.3.0',
		minAppVersion: '1.8.7',
	}, null, 2)}\n`),
		'styles.css': Buffer.from('.tracekeeper { color: currentColor; }\n'),
	};
	const expectedTargetAssets = {};
	for (const [name, content] of Object.entries(contents)) {
		await writeFile(vault, `.obsidian/plugins/tracekeeper/${name}`, content);
		expectedTargetAssets[name] = { bytes: content.byteLength, sha256: sha256(content) };
	}
	const settingsPath = path.resolve(vault, '.obsidian/plugins/tracekeeper/data.json');
	const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
	delete settings.runtimeToken;
	delete settings.runtimeTokenCreatedAt;
	delete settings.runtimeCredentials;
	settings.runtimeSecuritySecret = createHash('sha256').update('tracekeeper-0.3.0-upgrade-fixture-runtime-secret').digest('base64url');
	settings.agentIntegrations = [];
	settings.memoryRulesVersion = 4;
	settings.noteContentLanguage = 'auto';
	settings.onboarding = {
		selectedClientId: 'codex',
		skillSetupCompletedAt: '',
		skillCopiedAt: '',
		skillUserConfirmedAt: '',
		skillFileVerifiedAt: '',
		skillVerifiedBundleHash: '',
		skillUpdateAvailableAt: '',
		agentRestartCompletedAt: '',
		connectionVerifiedAt: '',
		connectionVerifiedSessionId: '',
		firstRecallCompletedAt: '',
		firstRecallMatchedCount: 0,
		firstRecallQuery: '',
		trackedWorkflowObservedAt: '',
		trackedWorkflowTaskId: '',
	};
	settings.skillInstallReceipts = {};
	await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
	return expectedTargetAssets;
};

const withFixture = async (run) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-upgrade-fixture-'));
	try {
		const assets = path.resolve(root, 'assets');
		await fs.mkdir(assets);
		const expectedAssets = await createTestAssets(assets);
		const output = path.resolve(root, 'fixture');
		const created = await createUpgradeFixture({
			assetsDirectory: assets,
			outputDirectory: output,
			expectedAssets,
		});
		await run({ root, assets, expectedAssets, output, created });
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
};

test('creates one deterministic previous-release fixture without exposing its synthetic token', async () => {
	await withFixture(async ({ expectedAssets, created }) => {
		assert.equal(created.seeded_file_count, 16);
		assert.equal(created.protected_vault_file_count, 2);
		assert.deepEqual(created.published_assets, expectedAssets);
		const first = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'before',
		});
		assert.equal(first.release.version, '0.2.3');
		assert.equal(first.seeded_files.every((entry) => entry.present), true);
		assert.equal(Object.values(first.identity_occurrences).every((paths) => paths.length === 1), true);
		assert.equal(first.settings.runtime_security_secret.present, false);
		assert.equal(first.settings.legacy_credentials.runtimeToken, true);
		assert.equal(first.settings.legacy_credentials.runtimeTokenCreatedAt, true);
		assert.equal(first.settings.legacy_credentials.runtimeCredentials, false);
		const rawSettings = JSON.parse(await fs.readFile(
			path.resolve(created.vault_path, '.obsidian/plugins/tracekeeper/data.json'),
			'utf8'
		));
		assert.equal(JSON.stringify(first).includes(rawSettings.runtimeToken), false);
	});
});

test('compares a normalized upgrade while preserving every seeded record and setting', async () => {
	await withFixture(async ({ expectedAssets, created }) => {
		const before = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'before',
		});
		const expectedTargetAssets = await upgradeFixture(created.vault_path);
		const after = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'after',
		});
		const result = compareUpgradeSnapshots(before, after, {
			expectedPreviousAssets: expectedAssets,
			expectedTargetAssets,
		});
		assert.equal(result.result, 'pass');
		assert.equal(result.seeded_files_preserved, 16);
		assert.equal(result.identities_unique, 16);
		assert.equal(result.protected_vault_files_preserved, 2);
		assert.equal(result.legacy_credentials_removed, true);
		assert.equal(result.legacy_token_rejected, true);
		assert.equal(result.runtime_security_secret_valid, true);
		assert.equal(result.agent_reauthorization_required, true);
		assert.equal(result.managed_skill_ownership_claimed, false);
		const wrongTargetAssets = structuredClone(expectedTargetAssets);
		wrongTargetAssets['main.js'].sha256 = '0'.repeat(64);
		assert.throws(
			() => compareUpgradeSnapshots(before, after, {
				expectedPreviousAssets: expectedAssets,
				expectedTargetAssets: wrongTargetAssets,
			}),
			/qualified target/
		);
	});
});

test('rejects changed durable records and duplicated fixture identities', async () => {
	await withFixture(async ({ expectedAssets, created }) => {
		const before = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'before',
		});
		const expectedTargetAssets = await upgradeFixture(created.vault_path);
		const wikiPath = path.resolve(created.vault_path, '01_knowledge/wiki/concepts/upgrade-wiki.md');
		const originalWiki = await fs.readFile(wikiPath, 'utf8');
		await fs.appendFile(wikiPath, 'changed\n');
		let after = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'after',
		});
		assert.throws(
			() => compareUpgradeSnapshots(before, after, { expectedPreviousAssets: expectedAssets, expectedTargetAssets }),
			/changed seeded file/
		);
		await fs.writeFile(wikiPath, originalWiki);

		const original = await fs.readFile(
			path.resolve(created.vault_path, '00_tracekeeper/work/tasks/upgrade-task.md'),
			'utf8'
		);
		const copyPath = '00_tracekeeper/work/tasks/upgrade-task-copy.md';
		await writeFile(created.vault_path, copyPath, original);
		after = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'after',
		});
		assert.throws(
			() => compareUpgradeSnapshots(before, after, { expectedPreviousAssets: expectedAssets, expectedTargetAssets }),
			/lost or duplicated fixture identity/
		);
		await fs.rm(path.resolve(created.vault_path, copyPath));

		const unexpectedPath = '00_tracekeeper/work/tasks/unexpected-upgrade-record.md';
		await writeFile(
			created.vault_path,
			unexpectedPath,
			'# Unexpected upgrade record\n'
		);
		after = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'after',
		});
		assert.throws(
			() => compareUpgradeSnapshots(before, after, { expectedPreviousAssets: expectedAssets, expectedTargetAssets }),
			/changed the Tracekeeper durable inventory/
		);
		await fs.rm(path.resolve(created.vault_path, unexpectedPath));

		await fs.appendFile(path.resolve(created.vault_path, 'Unrelated/keep.md'), 'changed\n');
		after = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'after',
		});
		assert.throws(
			() => compareUpgradeSnapshots(before, after, { expectedPreviousAssets: expectedAssets, expectedTargetAssets }),
			/changed protected Vault file/
		);
	});
});

test('rejects retained legacy credentials and invalid published assets', async () => {
	await withFixture(async ({ root, assets, expectedAssets, created }) => {
		const legacySettings = JSON.parse(await fs.readFile(
			path.resolve(created.vault_path, '.obsidian/plugins/tracekeeper/data.json'),
			'utf8'
		));
		const before = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'before',
		});
		const expectedTargetAssets = await upgradeFixture(created.vault_path);
		const settingsPath = path.resolve(created.vault_path, '.obsidian/plugins/tracekeeper/data.json');
		const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
		settings.runtimeToken = 'retained-legacy-value';
		await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
		const after = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'after',
		});
		assert.throws(
			() => compareUpgradeSnapshots(before, after, { expectedPreviousAssets: expectedAssets, expectedTargetAssets }),
			/retained a legacy credential key/
		);
		delete settings.runtimeToken;
		settings.runtimeAccessToken = legacySettings.runtimeToken;
		await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
		const reusedTokenAfter = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'after',
		});
		assert.throws(
			() => compareUpgradeSnapshots(before, reusedTokenAfter, { expectedPreviousAssets: expectedAssets, expectedTargetAssets }),
			/retained a legacy credential key/
		);

		await fs.appendFile(path.resolve(assets, 'styles.css'), 'tampered');
		await assert.rejects(
			createUpgradeFixture({
				assetsDirectory: assets,
				outputDirectory: path.resolve(root, 'invalid-fixture'),
				expectedAssets,
			}),
			/size mismatch/
		);
		await assert.rejects(fs.access(path.resolve(root, 'invalid-fixture')));
	});
});

test('rejects implicit Agent connection evidence and managed Skill ownership', async () => {
	await withFixture(async ({ expectedAssets, created }) => {
		const before = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'before',
		});
		const expectedTargetAssets = await upgradeFixture(created.vault_path);
		const settingsPath = path.resolve(created.vault_path, '.obsidian/plugins/tracekeeper/data.json');
		const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
		settings.onboarding.connectionVerifiedAt = '2026-01-15T09:00:00.000Z';
		await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
		let after = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'after',
		});
		assert.throws(
			() => compareUpgradeSnapshots(before, after, { expectedPreviousAssets: expectedAssets, expectedTargetAssets }),
			/implicitly claimed Agent connection evidence/
		);

		settings.onboarding.connectionVerifiedAt = '';
		settings.skillInstallReceipts = {
			'codex-user': {
				targetId: 'codex-user',
				bundleHash: `sha256:${'a'.repeat(64)}`,
				skillVersion: '2.1.1',
				installedAt: '2026-01-15T09:00:00.000Z',
			},
		};
		await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
		after = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'after',
		});
		assert.throws(
			() => compareUpgradeSnapshots(before, after, { expectedPreviousAssets: expectedAssets, expectedTargetAssets }),
			/implicitly claimed managed Skill ownership/
		);
	});
});

test('rejects a tampered fixture manifest and a noncanonical before state', async () => {
	await withFixture(async ({ expectedAssets, created }) => {
		const canonicalManifest = await fs.readFile(created.manifest_path, 'utf8');
		const tamperedManifest = JSON.parse(canonicalManifest);
		tamperedManifest.fixture_time = '2026-01-16T08:00:00.000Z';
		await fs.writeFile(created.manifest_path, `${JSON.stringify(tamperedManifest, null, 2)}\n`);
		await assert.rejects(
			snapshotUpgradeFixture({
				fixturePath: created.manifest_path,
				vaultPath: created.vault_path,
				phase: 'before',
			}),
			/manifest identity/
		);

		const reducedManifest = JSON.parse(canonicalManifest);
		reducedManifest.seeded_files.pop();
		const { fixture_id: ignoredFixtureId, ...reducedBase } = reducedManifest;
		reducedManifest.fixture_id = `upgrade-${sha256(JSON.stringify(reducedBase)).slice(0, 24)}`;
		await fs.writeFile(created.manifest_path, `${JSON.stringify(reducedManifest, null, 2)}\n`);
		await assert.rejects(
			snapshotUpgradeFixture({
				fixturePath: created.manifest_path,
				vaultPath: created.vault_path,
				phase: 'before',
			}),
			/canonical declaration/
		);
		await fs.writeFile(created.manifest_path, canonicalManifest);

		await fs.appendFile(
			path.resolve(created.vault_path, '00_tracekeeper/work/sessions/upgrade-session.md'),
			'noncanonical-before-state\n'
		);
		const before = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'before',
		});
		const expectedTargetAssets = await upgradeFixture(created.vault_path);
		const after = await snapshotUpgradeFixture({
			fixturePath: created.manifest_path,
			vaultPath: created.vault_path,
			phase: 'after',
		});
		assert.throws(
			() => compareUpgradeSnapshots(before, after, {
				expectedPreviousAssets: expectedAssets,
				expectedTargetAssets,
			}),
			/Before seeded file (size|hash) is not canonical/
		);
	});
});
