import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	TRACEKEEPER_SKILL_SOURCE_FILES,
	writeTracekeeperSkillBundle,
} from './build_tracekeeper_skill.mjs';
import { checkAgentEcosystem } from './check_agent_ecosystem.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function writeFixtureFile(root, relativePath, content) {
	const target = path.join(root, ...relativePath.split('/'));
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, content, 'utf8');
}

async function createFixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'tracekeeper-agent-ecosystem-'));
	await writeFixtureFile(
		root,
		'docs/architecture/AGENT_WORKFLOW_CONTRACT.md',
		await readFile(path.join(REPO_ROOT, 'docs/architecture/AGENT_WORKFLOW_CONTRACT.md'), 'utf8'),
	);
	for (const relativePath of TRACEKEEPER_SKILL_SOURCE_FILES) {
		await writeFixtureFile(
			root,
			`skills/tracekeeper/${relativePath}`,
			await readFile(path.join(REPO_ROOT, 'skills', 'tracekeeper', ...relativePath.split('/')), 'utf8'),
		);
	}
	await writeFixtureFile(root, 'docs/product/INDEX.md', '[Agent workflow](../architecture/AGENT_WORKFLOW_CONTRACT.md)\n');
	await writeFixtureFile(root, 'docs/architecture/INDEX.md', '[Agent workflow](AGENT_WORKFLOW_CONTRACT.md)\n');
	await writeFixtureFile(root, 'docs/engineering/INDEX.md', '# Engineering\n');
	await writeFixtureFile(root, 'docs/status/INDEX.md', '# Status\n');
	for (const relativePath of [
		'apps/obsidian-plugin/src/features/settings/tracekeeper-setting-tab.ts',
		'apps/obsidian-plugin/src/features/onboarding/onboarding-state.ts',
		'apps/obsidian-plugin/src/features/skill-installation/skill-bundle.ts',
		'apps/obsidian-plugin/src/features/skill-installation/skill-install-audit.ts',
		'apps/obsidian-plugin/src/adapters/client-skill-adapter.ts',
		'apps/obsidian-plugin/scripts/build.mjs',
	]) {
		await writeFixtureFile(root, relativePath, await readFile(path.join(REPO_ROOT, ...relativePath.split('/')), 'utf8'));
	}
	await writeTracekeeperSkillBundle(root);
	return root;
}

async function withFixture(run) {
	const root = await createFixture();
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('accepts the generated Skill v2 bundle and completed plugin integration', async () => {
	await withFixture(async (root) => {
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, true, result.errors.join('\n'));
		assert.deepEqual(result.warnings, []);
	});
});

test('rejects an incomplete plugin Skill bundle integration', async () => {
	await withFixture(async (root) => {
		const bundlePath = path.join(root, 'apps/obsidian-plugin/src/features/skill-installation/skill-bundle.ts');
		const bundle = await readFile(bundlePath, 'utf8');
		await writeFile(bundlePath, bundle.replace("\t'references/failure-recovery.md': normalizeText(failureRecovery),\n", ''), 'utf8');
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /failure recovery guidance/);
	});
});

test('rejects source tampering and stale generated artifacts', async () => {
	await withFixture(async (root) => {
		const skillPath = path.join(root, 'skills/tracekeeper/SKILL.md');
		await writeFile(skillPath, `${await readFile(skillPath, 'utf8')}\ntampered\n`, 'utf8');
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /manifest hashes or metadata are stale/);
		assert.match(result.errors.join('\n'), /flattened compatibility artifact is stale/);
	});
});

test('rejects a stale flattened artifact', async () => {
	await withFixture(async (root) => {
		const flattenedPath = path.join(root, 'skills/tracekeeper/dist/tracekeeper.flattened.md');
		await writeFile(flattenedPath, `${await readFile(flattenedPath, 'utf8')}stale\n`, 'utf8');
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /flattened compatibility artifact is stale/);
	});
});

test('rejects a flattened artifact that depends on external reference files', async () => {
	await withFixture(async (root) => {
		const flattenedPath = path.join(root, 'skills/tracekeeper/dist/tracekeeper.flattened.md');
		const flattened = await readFile(flattenedPath, 'utf8');
		await writeFile(flattenedPath, flattened.replace('](#workflow-state-machine)', '](references/workflow-state-machine.md)'), 'utf8');
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /must not depend on external reference files/);
	});
});

test('rejects missing, duplicate, unexpected, and unsafe manifest paths', async () => {
	await withFixture(async (root) => {
		const manifestPath = path.join(root, 'skills/tracekeeper/manifest.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		manifest.files.shift();
		manifest.files.push({ ...manifest.files[0] });
		manifest.files.push({ path: 'references/extra.md', sha256: `sha256:${'0'.repeat(64)}` });
		manifest.files.push({ path: '../outside.md', sha256: `sha256:${'0'.repeat(64)}` });
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /missing authoritative source/);
		assert.match(result.errors.join('\n'), /duplicate manifest source path/);
		assert.match(result.errors.join('\n'), /unexpected source/);
		assert.match(result.errors.join('\n'), /unsafe manifest source path/);
	});
});

test('rejects untracked files and symlink-like bundle expansion through the manifest', async () => {
	await withFixture(async (root) => {
		await writeFixtureFile(root, 'skills/tracekeeper/references/extra.md', '# Extra\n');
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /untracked file in the Skill bundle/);
	});
});

test('rejects deprecated tool names even when hashes are regenerated', async () => {
	await withFixture(async (root) => {
		const recoveryPath = path.join(root, 'skills/tracekeeper/references/failure-recovery.md');
		await writeFile(recoveryPath, `${await readFile(recoveryPath, 'utf8')}\nNever call tracekeeper.begin_task.\n`, 'utf8');
		await writeTracekeeperSkillBundle(root);
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /deprecated or unknown Tracekeeper tool name/);
	});
});

test('rejects absolute developer paths and sensitive credential examples', async () => {
	await withFixture(async (root) => {
		const isolationPath = path.join(root, 'skills/tracekeeper/references/instruction-isolation.md');
		await writeFile(
			isolationPath,
			`${await readFile(isolationPath, 'utf8')}\nExample: /Users/example/private and api_key=abcdefghijklmnop\n`,
			'utf8',
		);
		await writeTracekeeperSkillBundle(root);
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /absolute developer path/);
		assert.match(result.errors.join('\n'), /sensitive credential example/);
	});
});

test('rejects a bundle that loses recall_only lifecycle isolation', async () => {
	await withFixture(async (root) => {
		const skillPath = path.join(root, 'skills/tracekeeper/SKILL.md');
		const skill = await readFile(skillPath, 'utf8');
		await writeFile(
			skillPath,
			skill.replace('Never call `tracekeeper.start_task` or `tracekeeper.finish_task` in this mode.', 'Start and finish when convenient.'),
			'utf8',
		);
		await writeTracekeeperSkillBundle(root);
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /prohibit start and finish in recall_only/);
	});
});
