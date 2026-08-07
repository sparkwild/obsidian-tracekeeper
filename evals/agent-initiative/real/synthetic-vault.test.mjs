import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	createSyntheticVault,
	cleanupSyntheticVault,
	SYNTHETIC_PATHS,
	SYNTHETIC_WORKSPACE_MATERIALS_DIR,
} from './synthetic-vault.mjs';

test('createSyntheticVault creates expected synthetic files and injects scenario metadata', async () => {
	const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-synthetic-vault-'));
	const vaultRoot = path.join(temporaryRoot, 'vault');
	const scenario = {
		id: 'real-greeting',
		project_hint: 'obsidian-tracekeeper',
		repo_path: 'obsidian-tracekeeper',
		related_wiki: [SYNTHETIC_PATHS.wiki],
		related_sources: [SYNTHETIC_PATHS.designSource],
	};
	const result = await createSyntheticVault({
		vaultRoot,
		runId: 'unit-test-run',
		label: 'test-run',
		scenario,
		repoPath: temporaryRoot,
	});

	assert.equal(result.scenario, 'real-greeting');
	assert.equal(result.fileCount, Object.keys(SYNTHETIC_PATHS).length);

	const expectedFiles = Object.values(SYNTHETIC_PATHS);
	for (const relativePath of expectedFiles) {
		const absolutePath = path.join(vaultRoot, relativePath);
		const content = await fs.readFile(absolutePath, 'utf8');
		assert.equal(content.includes('obsidian-tracekeeper'), true);
	}

	const memory = await fs.readFile(path.join(vaultRoot, SYNTHETIC_PATHS.projectMemory), 'utf8');
	assert.ok(memory.includes('project_hint:'));
	assert.ok(memory.includes('repo_path:'));
	assert.ok(memory.includes(SYNTHETIC_PATHS.wiki));
	assert.ok(memory.includes(SYNTHETIC_PATHS.designSource));
	assert.ok(memory.includes(`[[${scenario.related_wiki[0]}]]`));
	assert.ok(memory.includes(`[[${scenario.related_sources[0]}]]`));

	const task = await fs.readFile(path.join(vaultRoot, SYNTHETIC_PATHS.task), 'utf8');
	assert.equal(task.includes('related_wiki:'), false);
	assert.equal(task.includes('related_sources:'), false);

	const control = await fs.readFile(path.join(vaultRoot, SYNTHETIC_PATHS.control), 'utf8');
	assert.equal(control.includes('related_wiki:'), false);
	assert.equal(control.includes('related_sources:'), false);

	const inbox = await fs.readFile(path.join(vaultRoot, SYNTHETIC_PATHS.inbox), 'utf8');
	assert.equal(inbox.includes('related_wiki:'), false);
	assert.equal(inbox.includes('related_sources:'), false);
	await cleanupSyntheticVault(vaultRoot);
	await fs.access(vaultRoot).catch((error) => {
		assert.equal(error.code, 'ENOENT');
	});
});

test('createSyntheticVault materializes user-authorized Agent source files outside the Vault', async () => {
	const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-synthetic-materials-'));
	const vaultRoot = path.join(temporaryRoot, 'vault');
	const result = await createSyntheticVault({
		vaultRoot,
		runId: 'unit-test-materials',
		label: 'test-materials',
		repoPath: temporaryRoot,
		scenario: {
			id: 'real-ingest-local-snapshot',
			agent_materials: [{
				path: 'research/brief.md',
				content: '# Brief\n\nLocal source evidence.',
			}],
		},
	});

	assert.equal(result.agentMaterialCount, 1);
	assert.equal(result.agentMaterialsRoot, path.join(temporaryRoot, SYNTHETIC_WORKSPACE_MATERIALS_DIR));
	const material = await fs.readFile(path.join(result.agentMaterialsRoot, 'research', 'brief.md'), 'utf8');
	assert.match(material, /Local source evidence/);
	await fs.access(path.join(vaultRoot, SYNTHETIC_WORKSPACE_MATERIALS_DIR)).then(
		() => assert.fail('Agent material directory must stay outside the Vault'),
		(error) => assert.equal(error.code, 'ENOENT'),
	);
	await fs.rm(temporaryRoot, { recursive: true, force: true });
});
