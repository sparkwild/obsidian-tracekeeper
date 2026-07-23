import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSyntheticVault, cleanupSyntheticVault, SYNTHETIC_PATHS } from './synthetic-vault.mjs';

test('createSyntheticVault creates expected synthetic files and injects scenario metadata', async () => {
	const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-synthetic-vault-'));
	const vaultRoot = path.join(temporaryRoot, 'vault');
	const result = await createSyntheticVault({
		vaultRoot,
		runId: 'unit-test-run',
		label: 'test-run',
		scenario: {
			id: 'real-greeting',
			project_hint: 'obsidian-tracekeeper',
			repo_path: 'obsidian-tracekeeper',
			related_wiki: [SYNTHETIC_PATHS.wiki],
			related_sources: [SYNTHETIC_PATHS.designSource],
		},
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
	await cleanupSyntheticVault(vaultRoot);
	await fs.access(vaultRoot).catch((error) => {
		assert.equal(error.code, 'ENOENT');
	});
});
