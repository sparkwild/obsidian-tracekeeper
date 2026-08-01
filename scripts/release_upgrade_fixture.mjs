#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const FIXTURE_SCHEMA_VERSION = 1;
export const PREVIOUS_PUBLIC_VERSION = '0.2.3';
export const PUBLISHED_023_ASSETS = Object.freeze({
	'main.js': Object.freeze({
		bytes: 354_699,
		sha256: 'd34049fa364f90d186094c4e93eb55d524466c7c243073636afad5ef6e27b65b',
	}),
	'manifest.json': Object.freeze({
		bytes: 291,
		sha256: '55f1bfb6bbfe0824a836efec0a6a3ef304cf940770571c4a1c9974594506d753',
	}),
	'styles.css': Object.freeze({
		bytes: 23_897,
		sha256: '1c1a0473e9a588c503844cca5c2ede027b220c92c87605e156c543db1b7c0761',
	}),
});

const RELEASE_ASSET_NAMES = Object.freeze(Object.keys(PUBLISHED_023_ASSETS));
const PLUGIN_DIRECTORY = '.obsidian/plugins/tracekeeper';
const PLUGIN_DATA_PATH = `${PLUGIN_DIRECTORY}/data.json`;
const FIXTURE_TIME = '2026-01-15T08:00:00.000Z';
const PRESERVED_SETTING_KEYS = Object.freeze([
	'defaultAgentScope',
	'mcpRuntimeEnabled',
	'mcpPort',
	'graphProfile',
	'globalMemoryRule',
	'projectMemoryRule',
	'taskMemoryProposalMode',
	'autoRefreshEnabled',
	'autoRefreshIntervalSeconds',
]);
const LEGACY_CREDENTIAL_KEYS = Object.freeze([
	'runtimeToken',
	'runtimeTokenCreatedAt',
	'runtimeCredentials',
]);
const ONBOARDING_CONNECTION_EVIDENCE_KEYS = Object.freeze([
	'clientConfiguredAt',
	'connectionVerifiedAt',
	'connectionVerifiedSessionId',
	'firstRecallCompletedAt',
	'firstRecallMatchedCount',
	'firstRecallQuery',
	'trackedWorkflowObservedAt',
	'trackedWorkflowTaskId',
]);
const ONBOARDING_SKILL_EVIDENCE_KEYS = Object.freeze([
	'skillSetupCompletedAt',
	'skillCopiedAt',
	'skillUserConfirmedAt',
	'skillFileVerifiedAt',
	'skillVerifiedBundleHash',
	'skillUpdateAvailableAt',
	'agentRestartCompletedAt',
]);
const TRACEKEEPER_INVENTORY_ROOTS = Object.freeze([
	'00_tracekeeper',
	'01_knowledge',
	'02_archive',
	'00_control',
	'01_inbox',
	'02_timeline',
	'03_sources',
	'04_memory',
	'04_projects',
	'05_memory',
	'05_projects',
	'06_outputs',
	'07_archive',
]);

const SEEDED_RECORDS = Object.freeze([
	Object.freeze({
		path: '00_tracekeeper/work/tasks/upgrade-task.md',
		identity: 'upgrade-task',
		content: `---
type: agent-task
fixture_record_id: upgrade-task
task_id: obs_task_upgrade_fixture
status: completed
agent: codex
started_at: ${FIXTURE_TIME}
completed_at: ${FIXTURE_TIME}
---

# Upgrade fixture task

Synthetic task linked to [[upgrade-session]] and [[upgrade-project-memory]].
`,
	}),
	Object.freeze({
		path: '00_tracekeeper/work/sessions/upgrade-session.md',
		identity: 'upgrade-session',
		content: `---
type: agent-session
fixture_record_id: upgrade-session
session_id: obs_session_upgrade_fixture
task_id: obs_task_upgrade_fixture
client: codex
status: completed
created_at: ${FIXTURE_TIME}
---

# Upgrade fixture session

Observed synthetic Codex session for [[upgrade-task]].
`,
	}),
	Object.freeze({
		path: '01_knowledge/memory/global/upgrade-global-memory.md',
		identity: 'upgrade-global-memory',
		content: `---
type: memory
fixture_record_id: upgrade-global-memory
memory_id: memory_upgrade_global
scope: global
status: active
created_at: ${FIXTURE_TIME}
related_wiki:
  - "[[upgrade-wiki]]"
---

# Upgrade global memory

Synthetic global memory remains review-governed and byte-stable during upgrade.
`,
	}),
	Object.freeze({
		path: '01_knowledge/memory/projects/tracekeeper/memory.md',
		identity: 'upgrade-project-memory',
		content: `---
type: project-memory
fixture_record_id: upgrade-project-memory
memory_id: memory_upgrade_project_legacy
project_id: project_upgrade_tracekeeper
repo_path: /synthetic/tracekeeper
status: active
created_at: ${FIXTURE_TIME}
related_wiki:
  - "[[upgrade-wiki]]"
---

# Upgrade project memory

Legacy shared project memory stays readable and is never split automatically.
`,
	}),
	Object.freeze({
		path: '01_knowledge/memory/projects/tracekeeper/index.md',
		identity: 'upgrade-project-hub',
		content: `---
type: project_memory_index
fixture_record_id: upgrade-project-hub
project_id: project_upgrade_tracekeeper
repo_path: /synthetic/tracekeeper
created_at: ${FIXTURE_TIME}
---

# Upgrade project hub

Backlinks aggregate legacy and immutable project-memory records.
`,
	}),
	Object.freeze({
		path: '01_knowledge/wiki/concepts/upgrade-wiki.md',
		identity: 'upgrade-wiki',
		content: `---
type: wiki
fixture_record_id: upgrade-wiki
wiki_id: wiki_upgrade_fixture
status: active
created_at: ${FIXTURE_TIME}
sources:
  - "[[upgrade-source]]"
---

# Upgrade Wiki

Synthetic Wiki record linked to [[upgrade-global-memory]].
`,
	}),
	Object.freeze({
		path: '01_knowledge/sources/web/upgrade-source.md',
		identity: 'upgrade-source',
		content: `---
type: source
fixture_record_id: upgrade-source
source_id: source_upgrade_fixture
source_kind: synthetic
status: captured
created_at: ${FIXTURE_TIME}
---

# Upgrade source

Synthetic source content with no external URL or secret.
`,
	}),
	Object.freeze({
		path: '00_tracekeeper/inbox/review_queue/upgrade-pending-proposal.md',
		identity: 'upgrade-pending-proposal',
		content: `---
type: memory_proposal
fixture_record_id: upgrade-pending-proposal
proposal_id: proposal_upgrade_pending
proposal_kind: global_memory
status: pending
target_note: 01_knowledge/memory/global/upgrade-global-memory.md
risk_level: low
created_at: ${FIXTURE_TIME}
---

# Pending upgrade proposal

Synthetic pending proposal must remain review-gated.
`,
	}),
	Object.freeze({
		path: '02_archive/review_queue/upgrade-completed-proposal.md',
		identity: 'upgrade-completed-proposal',
		content: `---
type: memory_proposal
fixture_record_id: upgrade-completed-proposal
proposal_id: proposal_upgrade_completed
proposal_kind: project_memory
status: applied
target_note: 01_knowledge/memory/projects/tracekeeper/memory.md
created_at: ${FIXTURE_TIME}
updated_at: ${FIXTURE_TIME}
---

# Completed upgrade proposal

Synthetic completed proposal remains available to history readers.
`,
	}),
	Object.freeze({
		path: '00_tracekeeper/work/context_packs/upgrade-context-pack.md',
		identity: 'upgrade-context-pack',
		content: `---
type: context-pack
fixture_record_id: upgrade-context-pack
context_pack_id: context_upgrade_fixture
task_id: obs_task_upgrade_fixture
created_at: ${FIXTURE_TIME}
related_wiki:
  - "[[upgrade-wiki]]"
---

# Upgrade context pack

Synthetic context retained for [[upgrade-task]] and [[upgrade-source]].
`,
	}),
	Object.freeze({
		path: '00_tracekeeper/inbox/review_queue/upgrade-approved-proposal.md',
		identity: 'upgrade-approved-proposal',
		content: `---
type: memory_proposal
fixture_record_id: upgrade-approved-proposal
proposal_id: proposal_upgrade_approved
proposal_kind: global_memory
status: approved
target_note: 01_knowledge/memory/global/upgrade-global-memory.md
created_at: ${FIXTURE_TIME}
updated_at: ${FIXTURE_TIME}
---

# Approved upgrade proposal

Synthetic approved proposal remains eligible for review-gated writeback.
`,
	}),
	Object.freeze({
		path: '02_archive/review_queue/upgrade-rejected-proposal.md',
		identity: 'upgrade-rejected-proposal',
		content: `---
type: memory_proposal
fixture_record_id: upgrade-rejected-proposal
proposal_id: proposal_upgrade_rejected
proposal_kind: global_memory
status: rejected
target_note: 01_knowledge/memory/global/upgrade-global-memory.md
created_at: ${FIXTURE_TIME}
updated_at: ${FIXTURE_TIME}
---

# Rejected upgrade proposal

Synthetic rejected proposal remains available to history readers.
`,
	}),
	Object.freeze({
		path: '00_control/legacy-system.md',
		identity: 'upgrade-legacy-control',
		content: `---
type: legacy-control
fixture_record_id: upgrade-legacy-control
created_at: ${FIXTURE_TIME}
---

# Legacy control

Synthetic legacy structure remains non-destructive and review-gated.
`,
	}),
	Object.freeze({
		path: '04_memory/legacy-conflict.md',
		identity: 'upgrade-legacy-conflict',
		content: `---
type: memory
fixture_record_id: upgrade-legacy-conflict
memory_id: memory_upgrade_legacy_conflict
scope: global
status: active
created_at: ${FIXTURE_TIME}
---

# Legacy conflict

Synthetic legacy content intentionally conflicts with no current note and must
not move without explicit migration confirmation.
`,
	}),
	Object.freeze({
		path: '00_tracekeeper/control/audit_log.md',
		identity: 'upgrade-audit-event',
		content: `---
type: audit-log
fixture_record_id: upgrade-audit-event
audit_event_id: audit_upgrade_fixture
created_at: ${FIXTURE_TIME}
---

# Tracekeeper Audit Log

- time: ${FIXTURE_TIME}
  event: synthetic_upgrade_fixture
  result: success

- time: ${FIXTURE_TIME}
  event: legacy_agent_observed
  agent: codex-legacy-observed
  session_id: legacy-session-upgrade-fixture
  transport: streamable_http
  result: success
`,
	}),
	Object.freeze({
		path: '00_tracekeeper/control/audit/2026-01-15.md',
		identity: 'upgrade-agent-observation',
		content: `---
type: audit-shard
fixture_record_id: upgrade-agent-observation
audit_event_id: audit_upgrade_agent_observed
created_at: ${FIXTURE_TIME}
---

# Tracekeeper Audit Shard

- time: ${FIXTURE_TIME}
  event: client_configuration_written
  client: codex
  target: synthetic-home/.codex/config.toml
  result: success
`,
	}),
]);

const PROTECTED_VAULT_FILES = Object.freeze([
	Object.freeze({
		path: 'Unrelated/keep.md',
		content: '# Unrelated fixture note\n\nTracekeeper must not change this file during upgrade.\n',
	}),
	Object.freeze({
		path: '.obsidian/plugins/unrelated-fixture/data.json',
		content: '{\n  "enabled": true,\n  "owner": "unrelated-fixture"\n}\n',
	}),
]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const assert = (condition, message) => {
	if (!condition) {
		throw new Error(message);
	}
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizedRelativePath = (value) => value.replace(/\\/g, '/').replace(/^\/+/, '');

const resolveInside = (root, relativePath) => {
	const normalized = normalizedRelativePath(relativePath);
	assert(normalized && !path.isAbsolute(normalized), `Unsafe relative path: ${relativePath}`);
	const resolved = path.resolve(root, normalized);
	const relative = path.relative(path.resolve(root), resolved);
	assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Path escapes fixture root: ${relativePath}`);
	return resolved;
};

const fileEvidence = async (filePath) => {
	const stat = await fs.lstat(filePath);
	assert(stat.isFile() && !stat.isSymbolicLink(), `Expected a regular non-symlink file: ${filePath}`);
	const content = await fs.readFile(filePath);
	return {
		bytes: content.byteLength,
		sha256: sha256(content),
	};
};

const readJson = async (filePath) => {
	const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
	assert(isRecord(parsed), `Expected a JSON object: ${filePath}`);
	return parsed;
};

const writeRelativeFile = async (root, relativePath, content) => {
	const target = resolveInside(root, relativePath);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, content, { flag: 'wx' });
};

const stableSyntheticLegacyToken = () =>
	createHash('sha256').update('tracekeeper-0.2.3-upgrade-fixture-token').digest('base64url');

const fixtureSettings = () => ({
	memoryRulesVersion: 3,
	defaultAgentScope: 'vault',
	mcpRuntimeEnabled: false,
	mcpPort: 58_439,
	runtimeToken: stableSyntheticLegacyToken(),
	runtimeTokenCreatedAt: FIXTURE_TIME,
	graphProfile: 'strict',
	globalMemoryRule: 'disabled',
	projectMemoryRule: 'auto_write',
	taskMemoryProposalMode: 'review_queue',
	autoRefreshEnabled: false,
	autoRefreshIntervalSeconds: 30,
});

const normalizeExpectedAssets = (expectedAssets) => {
	assert(isRecord(expectedAssets), 'Expected asset metadata must be an object.');
	const normalized = {};
	for (const name of RELEASE_ASSET_NAMES) {
		const evidence = expectedAssets[name];
		assert(isRecord(evidence), `Missing expected metadata for ${name}.`);
		assert(Number.isInteger(evidence.bytes) && evidence.bytes > 0, `Invalid expected byte size for ${name}.`);
		assert(/^[0-9a-f]{64}$/.test(evidence.sha256), `Invalid expected SHA-256 for ${name}.`);
		normalized[name] = { bytes: evidence.bytes, sha256: evidence.sha256 };
	}
	return normalized;
};

export async function validatePublishedAssets(
	assetsDirectory,
	expectedAssets = PUBLISHED_023_ASSETS
) {
	const expected = normalizeExpectedAssets(expectedAssets);
	const actual = {};
	for (const name of RELEASE_ASSET_NAMES) {
		const source = resolveInside(assetsDirectory, name);
		actual[name] = await fileEvidence(source);
		assert(
			actual[name].bytes === expected[name].bytes,
			`Published ${name} size mismatch: expected ${expected[name].bytes}, received ${actual[name].bytes}.`
		);
		assert(
			actual[name].sha256 === expected[name].sha256,
			`Published ${name} SHA-256 mismatch: expected ${expected[name].sha256}, received ${actual[name].sha256}.`
		);
	}
	const manifest = await readJson(resolveInside(assetsDirectory, 'manifest.json'));
	assert(manifest.version === PREVIOUS_PUBLIC_VERSION, `Published manifest version must be ${PREVIOUS_PUBLIC_VERSION}.`);
	return actual;
}

const buildFixtureManifest = (assets) => {
	const seededFiles = SEEDED_RECORDS.map((record) => ({
		path: record.path,
		identity_field: 'fixture_record_id',
		identity: record.identity,
		bytes: Buffer.byteLength(record.content),
		sha256: sha256(record.content),
	}));
	const protectedVaultFiles = PROTECTED_VAULT_FILES.map((record) => ({
		path: record.path,
		bytes: Buffer.byteLength(record.content),
		sha256: sha256(record.content),
	}));
	const base = {
		schema_version: FIXTURE_SCHEMA_VERSION,
		fixture_kind: 'tracekeeper_previous_release_upgrade',
		previous_version: PREVIOUS_PUBLIC_VERSION,
		previous_memory_rules_version: 3,
		fixture_time: FIXTURE_TIME,
		vault_directory: 'vault',
		published_assets: assets,
		preserved_settings: Object.fromEntries(
			PRESERVED_SETTING_KEYS.map((key) => [key, fixtureSettings()[key]])
		),
		seeded_files: seededFiles,
		protected_vault_files: protectedVaultFiles,
		inventory_roots: [...TRACEKEEPER_INVENTORY_ROOTS],
	};
	return {
		...base,
		fixture_id: `upgrade-${sha256(JSON.stringify(base)).slice(0, 24)}`,
	};
};

export async function createUpgradeFixture({
	assetsDirectory,
	outputDirectory,
	expectedAssets = PUBLISHED_023_ASSETS,
}) {
	const output = path.resolve(outputDirectory);
	assert(output !== path.parse(output).root, 'Fixture output must not be a filesystem root.');
	const assets = await validatePublishedAssets(path.resolve(assetsDirectory), expectedAssets);
	try {
		await fs.lstat(output);
		throw new Error(`Fixture output already exists: ${output}`);
	} catch (error) {
		if (!error || error.code !== 'ENOENT') {
			throw error;
		}
	}
	const outputParent = path.dirname(output);
	await fs.access(outputParent);
	const staging = await fs.mkdtemp(path.join(outputParent, '.tracekeeper-upgrade-fixture-'));
	const stagingVault = path.resolve(staging, 'vault');
	await fs.mkdir(stagingVault, { recursive: false });

	try {
		for (const name of RELEASE_ASSET_NAMES) {
			const source = resolveInside(assetsDirectory, name);
			const target = resolveInside(stagingVault, `${PLUGIN_DIRECTORY}/${name}`);
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.copyFile(source, target, fsConstants.COPYFILE_EXCL);
		}
		await writeRelativeFile(stagingVault, PLUGIN_DATA_PATH, `${JSON.stringify(fixtureSettings(), null, 2)}\n`);
		await writeRelativeFile(stagingVault, '.obsidian/community-plugins.json', '["tracekeeper"]\n');
		for (const record of SEEDED_RECORDS) {
			await writeRelativeFile(stagingVault, record.path, record.content);
		}
		for (const record of PROTECTED_VAULT_FILES) {
			await writeRelativeFile(stagingVault, record.path, record.content);
		}

		const manifest = buildFixtureManifest(assets);
		await fs.writeFile(path.resolve(staging, 'fixture.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
		await fs.cp(staging, output, { recursive: true, force: false, errorOnExist: true });
		await fs.rm(staging, { recursive: true, force: true });
		return {
			fixture_id: manifest.fixture_id,
			manifest_path: path.resolve(output, 'fixture.json'),
			vault_path: path.resolve(output, 'vault'),
			seeded_file_count: manifest.seeded_files.length,
			protected_vault_file_count: manifest.protected_vault_files.length,
			published_assets: assets,
		};
	} catch (error) {
		await fs.rm(staging, { recursive: true, force: true });
		throw error;
	}
}

const walkFiles = async (root, relativeDirectory = '') => {
	const directory = relativeDirectory ? resolveInside(root, relativeDirectory) : path.resolve(root);
	let entries;
	try {
		entries = await fs.readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error && error.code === 'ENOENT') {
			return [];
		}
		throw error;
	}
	const files = [];
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		const relativePath = normalizedRelativePath(path.join(relativeDirectory, entry.name));
		const absolutePath = resolveInside(root, relativePath);
		const stat = await fs.lstat(absolutePath);
		assert(!stat.isSymbolicLink(), `Upgrade fixture inventory refuses symlink: ${relativePath}`);
		if (stat.isDirectory()) {
			files.push(...await walkFiles(root, relativePath));
		} else if (stat.isFile()) {
			files.push(relativePath);
		}
	}
	return files;
};

const inventoryFiles = async (vault, roots) => {
	const paths = [];
	for (const root of roots) {
		paths.push(...await walkFiles(vault, root));
	}
	const uniquePaths = [...new Set(paths)].sort();
	const inventory = [];
	for (const relativePath of uniquePaths) {
		inventory.push({
			path: relativePath,
			...await fileEvidence(resolveInside(vault, relativePath)),
		});
	}
	return inventory;
};

const hasSettingsEvidence = (record, keys) => keys.some((key) => {
	const value = record[key];
	if (typeof value === 'string') return value.trim() !== '';
	if (typeof value === 'number') return value !== 0;
	if (typeof value === 'boolean') return value;
	return value !== undefined && value !== null;
});

const normalizeSettingsEvidence = (settings) => {
	const onboarding = isRecord(settings.onboarding) ? settings.onboarding : null;
	const skillInstallReceipts = isRecord(settings.skillInstallReceipts)
		? settings.skillInstallReceipts
		: null;
	return {
		preserved: Object.fromEntries(PRESERVED_SETTING_KEYS.map((key) => [key, settings[key]])),
		memory_rules_version: Number.isInteger(settings.memoryRulesVersion)
			? settings.memoryRulesVersion
			: null,
		legacy_credentials: Object.fromEntries(
			LEGACY_CREDENTIAL_KEYS.map((key) => [key, Object.hasOwn(settings, key)])
		),
		current_access_token: {
			present: Object.hasOwn(settings, 'runtimeAccessToken'),
			valid_32_byte_base64url: typeof settings.runtimeAccessToken === 'string'
				&& /^[A-Za-z0-9_-]{43}$/.test(settings.runtimeAccessToken)
				&& Buffer.from(settings.runtimeAccessToken, 'base64url').byteLength === 32
				&& Buffer.from(settings.runtimeAccessToken, 'base64url').toString('base64url') === settings.runtimeAccessToken,
			matches_previous_fixture_token: settings.runtimeAccessToken === stableSyntheticLegacyToken(),
		},
		agent_skill_state: {
			onboarding_present: onboarding !== null,
			selected_client_id: onboarding && typeof onboarding.selectedClientId === 'string'
				? onboarding.selectedClientId.trim()
				: null,
			connection_evidence_present: onboarding
				? hasSettingsEvidence(onboarding, ONBOARDING_CONNECTION_EVIDENCE_KEYS)
				: false,
			skill_evidence_present: onboarding
				? hasSettingsEvidence(onboarding, ONBOARDING_SKILL_EVIDENCE_KEYS)
				: false,
			skill_install_receipts_present: skillInstallReceipts !== null,
			skill_install_receipt_count: skillInstallReceipts
				? Object.keys(skillInstallReceipts).length
				: null,
			note_content_language: typeof settings.noteContentLanguage === 'string'
				? settings.noteContentLanguage
				: null,
		},
	};
};

const identityOccurrences = async (vault, inventory, seededFiles) => {
	const markdownPaths = inventory
		.map((entry) => entry.path)
		.filter((entryPath) => entryPath.endsWith('.md'));
	const contents = new Map();
	for (const relativePath of markdownPaths) {
		contents.set(relativePath, await fs.readFile(resolveInside(vault, relativePath), 'utf8'));
	}
	return Object.fromEntries(seededFiles.map((seed) => {
		const escapedField = seed.identity_field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const escapedIdentity = seed.identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const pattern = new RegExp(`^${escapedField}:\\s*["']?${escapedIdentity}["']?\\s*$`, 'm');
		const matches = markdownPaths.filter((relativePath) => pattern.test(contents.get(relativePath)));
		return [seed.identity, matches];
	}));
};

const releaseAssetSnapshot = async (vault) => {
	const assets = {};
	for (const name of RELEASE_ASSET_NAMES) {
		const target = resolveInside(vault, `${PLUGIN_DIRECTORY}/${name}`);
		try {
			assets[name] = { present: true, ...await fileEvidence(target) };
		} catch (error) {
			if (error && error.code === 'ENOENT') {
				assets[name] = { present: false, bytes: null, sha256: null };
				continue;
			}
			throw error;
		}
	}
	let version = null;
	if (assets['manifest.json'].present) {
		version = (await readJson(resolveInside(vault, `${PLUGIN_DIRECTORY}/manifest.json`))).version || null;
	}
	return { version, assets };
};

export async function snapshotUpgradeFixture({ fixturePath, vaultPath, phase }) {
	assert(phase === 'before' || phase === 'after', 'Snapshot phase must be before or after.');
	const fixture = await readJson(path.resolve(fixturePath));
	assert(fixture.schema_version === FIXTURE_SCHEMA_VERSION, 'Unsupported upgrade fixture schema.');
	const { fixture_id: fixtureId, ...fixtureBase } = fixture;
	assert(
		fixtureId === `upgrade-${sha256(JSON.stringify(fixtureBase)).slice(0, 24)}`,
		'Upgrade fixture manifest identity does not match its content.'
	);
	const canonicalFixture = buildFixtureManifest(normalizeExpectedAssets(fixture.published_assets));
	assert(
		JSON.stringify(fixture) === JSON.stringify(canonicalFixture),
		'Upgrade fixture manifest does not match the canonical declaration.'
	);
	assert(Array.isArray(fixture.seeded_files), 'Fixture seeded_files must be an array.');
	assert(Array.isArray(fixture.protected_vault_files), 'Fixture protected_vault_files must be an array.');
	assert(Array.isArray(fixture.inventory_roots), 'Fixture inventory_roots must be an array.');
	const vault = path.resolve(vaultPath);
	const settings = await readJson(resolveInside(vault, PLUGIN_DATA_PATH));
	const inventory = await inventoryFiles(vault, fixture.inventory_roots);
	const seededFiles = [];
	for (const seed of fixture.seeded_files) {
		assert(isRecord(seed) && typeof seed.path === 'string', 'Invalid seeded file declaration.');
		const target = resolveInside(vault, seed.path);
		try {
			seededFiles.push({ path: seed.path, present: true, ...await fileEvidence(target) });
		} catch (error) {
			if (error && error.code === 'ENOENT') {
				seededFiles.push({ path: seed.path, present: false, bytes: null, sha256: null });
				continue;
			}
			throw error;
		}
	}
	const protectedVaultFiles = [];
	for (const declaration of fixture.protected_vault_files) {
		assert(isRecord(declaration) && typeof declaration.path === 'string', 'Invalid protected Vault file declaration.');
		const target = resolveInside(vault, declaration.path);
		try {
			protectedVaultFiles.push({ path: declaration.path, present: true, ...await fileEvidence(target) });
		} catch (error) {
			if (error && error.code === 'ENOENT') {
				protectedVaultFiles.push({ path: declaration.path, present: false, bytes: null, sha256: null });
				continue;
			}
			throw error;
		}
	}
	return {
		schema_version: FIXTURE_SCHEMA_VERSION,
		fixture_id: fixtureId,
		phase,
		previous_version: fixture.previous_version,
		previous_memory_rules_version: fixture.previous_memory_rules_version,
		published_assets: fixture.published_assets,
		fixture_preserved_settings: fixture.preserved_settings,
		fixture_seeded_files: fixture.seeded_files,
		fixture_protected_vault_files: fixture.protected_vault_files,
		settings: normalizeSettingsEvidence(settings),
		release: await releaseAssetSnapshot(vault),
		seeded_files: seededFiles,
		protected_vault_files: protectedVaultFiles,
		identity_occurrences: await identityOccurrences(vault, inventory, fixture.seeded_files),
		inventory,
	};
}

const mapByPath = (entries) => new Map(entries.map((entry) => [entry.path, entry]));

const assertSameJson = (left, right, message) => {
	assert(JSON.stringify(left) === JSON.stringify(right), message);
};

export function compareUpgradeSnapshots(
	before,
	after,
	{
		expectedVersion = '0.3.0',
		expectedMemoryRulesVersion = 4,
		expectedPreviousAssets = PUBLISHED_023_ASSETS,
		expectedTargetAssets,
	} = {}
) {
	assert(before.schema_version === FIXTURE_SCHEMA_VERSION, 'Unsupported before snapshot schema.');
	assert(after.schema_version === FIXTURE_SCHEMA_VERSION, 'Unsupported after snapshot schema.');
	assert(before.fixture_id === after.fixture_id, 'Snapshot fixture identities do not match.');
	assert(before.phase === 'before' && after.phase === 'after', 'Snapshots must use before then after phases.');
	assert(before.release.version === PREVIOUS_PUBLIC_VERSION, `Before release must be ${PREVIOUS_PUBLIC_VERSION}.`);
	assert(after.release.version === expectedVersion, `After release must be ${expectedVersion}.`);

	const previousAssets = normalizeExpectedAssets(expectedPreviousAssets);
	const targetAssets = normalizeExpectedAssets(expectedTargetAssets);
	assertSameJson(before.published_assets, after.published_assets, 'Snapshot published-asset declarations do not match.');
	assertSameJson(before.published_assets, previousAssets, 'Snapshot published-asset declaration is not the accepted baseline.');
	for (const name of RELEASE_ASSET_NAMES) {
		const beforeAsset = before.release.assets[name];
		const expectedAsset = previousAssets[name];
		assert(beforeAsset.present, `Before snapshot is missing ${name}.`);
		assert(beforeAsset.bytes === expectedAsset.bytes, `Before ${name} size does not match published ${PREVIOUS_PUBLIC_VERSION}.`);
		assert(beforeAsset.sha256 === expectedAsset.sha256, `Before ${name} hash does not match published ${PREVIOUS_PUBLIC_VERSION}.`);
		assert(after.release.assets[name].present, `After snapshot is missing ${name}.`);
		assert(after.release.assets[name].bytes === targetAssets[name].bytes, `After ${name} size does not match the qualified target.`);
		assert(after.release.assets[name].sha256 === targetAssets[name].sha256, `After ${name} hash does not match the qualified target.`);
	}

	assertSameJson(before.fixture_seeded_files, after.fixture_seeded_files, 'Snapshot seeded-file declarations do not match.');
	assertSameJson(
		before.fixture_protected_vault_files,
		after.fixture_protected_vault_files,
		'Snapshot protected-Vault-file declarations do not match.'
	);
	assertSameJson(before.fixture_preserved_settings, after.fixture_preserved_settings, 'Snapshot preserved-setting declarations do not match.');
	const expectedSeededFiles = mapByPath(before.fixture_seeded_files);
	const beforeFiles = mapByPath(before.seeded_files);
	const afterFiles = mapByPath(after.seeded_files);
	assert(
		expectedSeededFiles.size > 0
			&& expectedSeededFiles.size === beforeFiles.size
			&& beforeFiles.size === afterFiles.size,
		'Seeded file sets do not match.'
	);
	for (const [relativePath, beforeFile] of beforeFiles) {
		const expectedFile = expectedSeededFiles.get(relativePath);
		const afterFile = afterFiles.get(relativePath);
		assert(expectedFile, `Unexpected seeded file ${relativePath}.`);
		assert(beforeFile.present, `Before snapshot is missing seeded file ${relativePath}.`);
		assert(beforeFile.bytes === expectedFile.bytes, `Before seeded file size is not canonical: ${relativePath}.`);
		assert(beforeFile.sha256 === expectedFile.sha256, `Before seeded file hash is not canonical: ${relativePath}.`);
		assert(afterFile?.present, `Upgrade lost seeded file ${relativePath}.`);
		assert(afterFile.bytes === beforeFile.bytes, `Upgrade changed seeded file size: ${relativePath}.`);
		assert(afterFile.sha256 === beforeFile.sha256, `Upgrade changed seeded file bytes: ${relativePath}.`);
	}
	for (const [identity, beforePaths] of Object.entries(before.identity_occurrences)) {
		const afterPaths = after.identity_occurrences[identity];
		assert(beforePaths.length === 1, `Before fixture identity ${identity} is not unique.`);
		assert(Array.isArray(afterPaths) && afterPaths.length === 1, `Upgrade lost or duplicated fixture identity ${identity}.`);
		assert(afterPaths[0] === beforePaths[0], `Upgrade moved fixture identity ${identity} unexpectedly.`);
	}
	const canonicalInventory = before.fixture_seeded_files
		.map(({ path: relativePath, bytes, sha256: digest }) => ({
			path: relativePath,
			bytes,
			sha256: digest,
		}))
		.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
	assertSameJson(
		before.inventory,
		canonicalInventory,
		'Before Tracekeeper durable inventory is not canonical.'
	);
	assertSameJson(
		after.inventory,
		before.inventory,
		'Upgrade changed the Tracekeeper durable inventory.'
	);
	const expectedProtectedFiles = mapByPath(before.fixture_protected_vault_files);
	const beforeProtectedFiles = mapByPath(before.protected_vault_files);
	const afterProtectedFiles = mapByPath(after.protected_vault_files);
	assert(
		expectedProtectedFiles.size > 0
			&& expectedProtectedFiles.size === beforeProtectedFiles.size
			&& beforeProtectedFiles.size === afterProtectedFiles.size,
		'Protected Vault file sets do not match.'
	);
	for (const [relativePath, beforeFile] of beforeProtectedFiles) {
		const expectedFile = expectedProtectedFiles.get(relativePath);
		const afterFile = afterProtectedFiles.get(relativePath);
		assert(expectedFile, `Unexpected protected Vault file ${relativePath}.`);
		assert(beforeFile.present, `Before snapshot is missing protected Vault file ${relativePath}.`);
		assert(beforeFile.bytes === expectedFile.bytes, `Before protected Vault file size is not canonical: ${relativePath}.`);
		assert(beforeFile.sha256 === expectedFile.sha256, `Before protected Vault file hash is not canonical: ${relativePath}.`);
		assert(afterFile?.present, `Upgrade removed protected Vault file ${relativePath}.`);
		assert(afterFile.bytes === beforeFile.bytes, `Upgrade changed protected Vault file size: ${relativePath}.`);
		assert(afterFile.sha256 === beforeFile.sha256, `Upgrade changed protected Vault file bytes: ${relativePath}.`);
	}

	assertSameJson(
		before.fixture_preserved_settings,
		before.settings.preserved,
		'Before fixture settings do not match the declared baseline.'
	);
	assertSameJson(
		before.settings.preserved,
		after.settings.preserved,
		'Upgrade changed a preserved plugin setting.'
	);
	assert(
		before.settings.legacy_credentials.runtimeToken
			&& before.settings.legacy_credentials.runtimeTokenCreatedAt,
		'Before fixture must contain the published runtime token fields.'
	);
	assert(
		Object.values(after.settings.legacy_credentials).every((present) => !present),
		'Upgrade retained a legacy credential key.'
	);
	assert(!before.settings.current_access_token.present, 'Before fixture unexpectedly contains a current access token.');
	assert(
		before.settings.memory_rules_version === before.previous_memory_rules_version,
		'Before memory rules version does not match the fixture baseline.'
	);
	assert(after.settings.current_access_token.present, 'Upgrade did not create a current access token.');
	assert(after.settings.current_access_token.valid_32_byte_base64url, 'Upgrade created an invalid current access token.');
	assert(!after.settings.current_access_token.matches_previous_fixture_token, 'Upgrade reused the legacy fixture token.');
	const beforeAgentSkillState = before.settings.agent_skill_state;
	const afterAgentSkillState = after.settings.agent_skill_state;
	assert(!beforeAgentSkillState.onboarding_present, 'Published fixture unexpectedly contains candidate onboarding state.');
	assert(!beforeAgentSkillState.skill_install_receipts_present, 'Published fixture unexpectedly contains managed Skill receipts.');
	assert(beforeAgentSkillState.note_content_language === null, 'Published fixture unexpectedly contains candidate language state.');
	assert(afterAgentSkillState.onboarding_present, 'Upgrade did not initialize bounded onboarding state.');
	assert(afterAgentSkillState.selected_client_id === 'codex', 'Upgrade changed the default selected client unexpectedly.');
	assert(!afterAgentSkillState.connection_evidence_present, 'Upgrade implicitly claimed Agent connection evidence.');
	assert(!afterAgentSkillState.skill_evidence_present, 'Upgrade implicitly claimed Skill setup evidence.');
	assert(afterAgentSkillState.skill_install_receipts_present, 'Upgrade did not initialize managed Skill receipt state.');
	assert(afterAgentSkillState.skill_install_receipt_count === 0, 'Upgrade implicitly claimed managed Skill ownership.');
	assert(afterAgentSkillState.note_content_language === 'auto', 'Upgrade did not initialize the expected note language setting.');
	assert(
		after.settings.memory_rules_version === expectedMemoryRulesVersion,
		`After memory rules version must be ${expectedMemoryRulesVersion}.`
	);

	return {
		result: 'pass',
		fixture_id: before.fixture_id,
		previous_version: PREVIOUS_PUBLIC_VERSION,
		target_version: expectedVersion,
		seeded_files_preserved: beforeFiles.size,
		protected_vault_files_preserved: beforeProtectedFiles.size,
		identities_unique: Object.keys(before.identity_occurrences).length,
		legacy_credentials_removed: true,
		legacy_token_rotated: true,
		current_access_token_valid: true,
		agent_reauthorization_required: true,
		managed_skill_ownership_claimed: false,
		preserved_settings: Object.keys(before.settings.preserved),
	};
}

const parseOptions = (values) => {
	const options = {};
	for (let index = 0; index < values.length; index += 1) {
		const key = values[index];
		assert(key.startsWith('--'), `Unexpected argument: ${key}`);
		const value = values[index + 1];
		assert(value && !value.startsWith('--'), `Missing value for ${key}.`);
		options[key.slice(2)] = value;
		index += 1;
	}
	return options;
};

const requiredOption = (options, name) => {
	const value = options[name];
	assert(typeof value === 'string' && value.trim(), `Missing required --${name}.`);
	return value;
};

const writeJsonExclusive = async (target, value) => {
	await fs.writeFile(path.resolve(target), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
};

async function main() {
	const [command, ...rawOptions] = process.argv.slice(2);
	const options = parseOptions(rawOptions);
	if (command === 'create') {
		const result = await createUpgradeFixture({
			assetsDirectory: requiredOption(options, 'assets'),
			outputDirectory: requiredOption(options, 'output'),
		});
		console.log(JSON.stringify(result, null, 2));
		return;
	}
	if (command === 'snapshot') {
		const snapshot = await snapshotUpgradeFixture({
			fixturePath: requiredOption(options, 'fixture'),
			vaultPath: requiredOption(options, 'vault'),
			phase: requiredOption(options, 'phase'),
		});
		await writeJsonExclusive(requiredOption(options, 'output'), snapshot);
		console.log(JSON.stringify({ result: 'pass', phase: snapshot.phase, fixture_id: snapshot.fixture_id }, null, 2));
		return;
	}
	if (command === 'compare') {
		const before = await readJson(requiredOption(options, 'before'));
		const after = await readJson(requiredOption(options, 'after'));
		const expectedTargetAssets = await readJson(requiredOption(options, 'expected-target-assets'));
		const result = compareUpgradeSnapshots(before, after, {
			expectedVersion: options['expected-version'] || '0.3.0',
			expectedMemoryRulesVersion: options['expected-memory-rules-version']
				? Number.parseInt(options['expected-memory-rules-version'], 10)
				: 4,
			expectedTargetAssets,
		});
		if (options.output) {
			await writeJsonExclusive(options.output, result);
		}
		console.log(JSON.stringify(result, null, 2));
		return;
	}
	throw new Error('Usage: release_upgrade_fixture.mjs <create|snapshot|compare> [options]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
