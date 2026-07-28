import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	TRACEKEEPER_SKILL_SOURCE_FILES,
	TRACEKEEPER_SKILL_RELEASE_PATH,
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
		'docs/features/AGENT_WORKFLOW.md',
		await readFile(path.join(REPO_ROOT, 'docs/features/AGENT_WORKFLOW.md'), 'utf8'),
	);
	for (const relativePath of TRACEKEEPER_SKILL_SOURCE_FILES) {
		await writeFixtureFile(
			root,
			`skills/tracekeeper/${relativePath}`,
			await readFile(path.join(REPO_ROOT, 'skills', 'tracekeeper', ...relativePath.split('/')), 'utf8'),
		);
	}
	await writeFixtureFile(root, 'docs/features/INDEX.md', '[Agent workflow](AGENT_WORKFLOW.md)\n');
	await writeFixtureFile(root, 'docs/architecture/SYSTEM_ARCHITECTURE.md', '[Agent workflow](../features/AGENT_WORKFLOW.md)\n');
	await writeFixtureFile(root, 'docs/development/ENGINEERING_AND_RELEASE.md', '# Engineering\n');
	await writeFixtureFile(root, `skills/tracekeeper/${TRACEKEEPER_SKILL_RELEASE_PATH}`, await readFile(path.join(REPO_ROOT, 'skills', 'tracekeeper', TRACEKEEPER_SKILL_RELEASE_PATH), 'utf8'));
	for (const relativePath of [
		'apps/obsidian-plugin/src/features/settings/tracekeeper-setting-tab.ts',
		'apps/obsidian-plugin/src/features/onboarding/onboarding-state.ts',
		'apps/obsidian-plugin/src/features/onboarding/onboarding-view-model.ts',
		'apps/obsidian-plugin/src/features/skill-installation/skill-bundle.ts',
		'apps/obsidian-plugin/src/features/skill-installation/skill-install-audit.ts',
		'apps/obsidian-plugin/src/features/skill-installation/skill-install-receipts.ts',
		'apps/obsidian-plugin/src/adapters/client-skill-adapter.ts',
		'apps/obsidian-plugin/src/adapters/client-skill-target-registry.ts',
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

test('rejects onboarding guidance that drifts from project Recall or workflow capability contracts', async () => {
	await withFixture(async (root) => {
		const onboardingViewModelPath = path.join(root, 'apps/obsidian-plugin/src/features/onboarding/onboarding-view-model.ts');
		const onboardingViewModel = await readFile(onboardingViewModelPath, 'utf8');
		await writeFile(
			onboardingViewModelPath,
			onboardingViewModel
				.replace(/repo_path/g, 'project_hint')
				.replace(/workflow\.manage/g, 'workflow.disabled'),
			'utf8',
		);
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /(plugin-generated onboarding guidance|project_hint)/);
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

test('rejects a bundle that loses next_action timing semantics', async () => {
	await withFixture(async (root) => {
		const trackedPath = path.join(root, 'skills/tracekeeper/SKILL.md');
		const tracked = await readFile(trackedPath, 'utf8');
		await writeFile(
			trackedPath,
			tracked
				.replace(/\n-\s*`immediate`:[^\n]*\n/, '\n')
				.replace(/\n-\s*`if_context_insufficient`:[^\n]*\n/, '\n')
				.replace(/\n-\s*`at_task_closeout`:[^\n]*\n/, '\n')
				.replace(/\n\d+\.\s*`required: true`[^\n]*\n/, '\n'),
			'utf8',
		);
		await writeTracekeeperSkillBundle(root);
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		const errors = result.errors.join('\n');
		assert.match(errors, /(required action semantics|immediate next_action timing|if_context_insufficient|at_task_closeout)/);
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

test('rejects a bundle that loses local knowledge naming', async () => {
	await withFixture(async (root) => {
		const skillPath = path.join(root, 'skills/tracekeeper/SKILL.md');
		const skill = await readFile(skillPath, 'utf8');
		await writeFile(
			skillPath,
			skill.replace(
				'Unqualified `Vault`, `Wiki`, or `Memory` means the active local Obsidian Vault.',
				'Choose any available Wiki destination.',
			),
			'utf8',
		);
		await writeTracekeeperSkillBundle(root);
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /does not define unqualified knowledge names as local Vault content/);
	});
});

test('rejects a bundle that loses explicit external-destination and durable-output rules', async () => {
	await withFixture(async (root) => {
		const skillPath = path.join(root, 'skills/tracekeeper/SKILL.md');
		const skill = await readFile(skillPath, 'utf8');
		await writeFile(
			skillPath,
			skill
				.replace(
					'Use an external connector or service such as Atlassian, Confluence, or Notion only when the user explicitly names that external destination.',
					'Use any available external connector.',
				)
				.replace(
					'Treat explicit durable-output cues such as “可落库”, “沉淀”, “持续性结论”, “同步到项目 Wiki”, “复盘”, a closeout reason, or continuing an implementation plan as `tracked_task`, even when the immediate answer is short.',
					'Use recall_only when the answer is short.',
				),
			'utf8',
		);
		await writeTracekeeperSkillBundle(root);
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /does not require an explicit external knowledge destination/);
		assert.match(result.errors.join('\n'), /does not route durable-output cues to tracked_task/);
	});
});

test('rejects a bundle that loses Recall routing and operation-specific idempotency rules', async () => {
	await withFixture(async (root) => {
		const skillPath = path.join(root, 'skills/tracekeeper/SKILL.md');
		const skill = await readFile(skillPath, 'utf8');
		await writeFile(
			skillPath,
			skill
				.replace(
					'- Known project: the first knowledge Recall uses `scope: "project"` and passes `repo_path`; pass canonical `project_hint` only when it is known.',
					'- Known project: choose any convenient Recall scope.',
				)
				.replace(
					'- `recall_only`: never start with `scope: "global"` or `scope: "project_history"`.',
					'- `recall_only`: any scope is acceptable.',
				)
				.replace(
					'- `tracked_task`: start first, then copy the returned `next_actions` or `recommended_recall` arguments for Recall.',
					'- `tracked_task`: reconstruct Recall arguments.',
				)
				.replace(
					'- Use `project_history` only after project identity is established and task or session continuity is specifically needed.',
					'- Use `project_history` at any time.',
				)
				.replace(
					'- Use `global` only for an explicit cross-project request or when the Runtime reports uncertain project identity.',
					'- Use `global` by default.',
				)
				.replace(
					'- One idempotency key replays only the same logical operation. Never reuse a start key for finish or a finish key for start.',
					'- Reuse one idempotency key for the whole lifecycle.',
				),
			'utf8',
		);
		await writeTracekeeperSkillBundle(root);
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		const errors = result.errors.join('\n');
		assert.match(errors, /does not route the first known-project Recall to project scope with repo_path/);
		assert.match(errors, /does not prohibit global and project_history as the first recall_only route/);
		assert.match(errors, /does not route tracked-task Recall from the start result/);
		assert.match(errors, /does not reserve project_history for established continuity/);
		assert.match(errors, /does not constrain global Recall routing/);
		assert.match(errors, /does not separate start and finish idempotency keys/);
	});
});

test('rejects closeout guidance that loses recalled graph-path propagation', async () => {
	await withFixture(async (root) => {
		const closeoutPath = path.join(root, 'skills/tracekeeper/references/closeout-fields.md');
		const closeout = await readFile(closeoutPath, 'utf8');
		await writeFile(
			closeoutPath,
			closeout
				.replace(/-\s*`related_wiki`:[^\n]*\n/, '')
				.replace(/-\s*`related_sources`:[^\n]*\n/, '')
				.replace(/relation_evidence\./g, 'related_evidence.')
				.replace(/correlated\s+(?:`?note`?|`?read_note`?)/i, ''),
			'utf8',
		);
		await writeTracekeeperSkillBundle(root);
		const result = await checkAgentEcosystem(root);
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /does not preserve related_wiki at closeout/);
		assert.match(result.errors.join('\n'), /does not preserve related_sources at closeout/);
		assert.match(result.errors.join('\n'), /does not constrain closeout graph paths to Runtime-validated relation evidence/);
		assert.match(result.errors.join('\n'), /does not allow closeout field reuse from correlated read_note evidence/);
	});
});
