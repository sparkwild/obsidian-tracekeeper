#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-memory-rule-settings-test-'));
const output = path.join(tempRoot, 'settings-model.mjs');
const obsidianStub = path.join(tempRoot, 'obsidian-stub.mjs');

try {
	fs.writeFileSync(obsidianStub, "export const getLanguage = () => 'en';\n", 'utf8');
	await build({
		entryPoints: [path.resolve('src/features/settings/settings-model.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
		plugins: [{
			name: 'obsidian-test-stub',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({ path: obsidianStub }));
			},
		}],
	});
	const settings = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const defaults = {
		globalMemoryRule: 'review_queue',
		projectMemoryRule: 'auto_write',
		taskMemoryProposalMode: 'auto_propose',
	};

	assert.deepEqual(settings.normalizeMemoryRuleSettings({}, defaults), {
		memoryRulesVersion: settings.MEMORY_RULES_VERSION,
		...defaults,
	});

	for (const projectMemoryRule of ['review_queue', 'auto_write', 'disabled']) {
		const migrated = settings.normalizeMemoryRuleSettings({
			memoryRulesVersion: settings.MEMORY_RULES_VERSION - 1,
			globalMemoryRule: projectMemoryRule,
			projectMemoryRule,
			taskMemoryProposalMode: 'auto_propose',
		}, defaults);
		assert.equal(migrated.globalMemoryRule, projectMemoryRule);
		assert.equal(migrated.projectMemoryRule, projectMemoryRule);
		assert.equal(migrated.memoryRulesVersion, settings.MEMORY_RULES_VERSION);
	}

	for (const taskMemoryProposalMode of ['off', 'review_queue', 'auto_propose']) {
		const migrated = settings.normalizeMemoryRuleSettings({
			memoryRulesVersion: settings.MEMORY_RULES_VERSION - 1,
			projectMemoryRule: 'review_queue',
			taskMemoryProposalMode,
		}, defaults);
		assert.equal(migrated.taskMemoryProposalMode, taskMemoryProposalMode);
	}

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 11 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
