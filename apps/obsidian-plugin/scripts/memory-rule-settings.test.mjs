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
const settingsSource = fs.readFileSync('src/features/settings/tracekeeper-setting-tab.ts', 'utf8');

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
		taskTrackingEnabled: true,
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
			taskTrackingEnabled: true,
		}, defaults);
		assert.equal(migrated.globalMemoryRule, projectMemoryRule);
		assert.equal(migrated.projectMemoryRule, projectMemoryRule);
		assert.equal(migrated.memoryRulesVersion, settings.MEMORY_RULES_VERSION);
	}

	for (const taskTrackingEnabled of [true, false]) {
		const migrated = settings.normalizeMemoryRuleSettings({
			memoryRulesVersion: settings.MEMORY_RULES_VERSION - 1,
			projectMemoryRule: 'review_queue',
			taskTrackingEnabled,
		}, defaults);
		assert.equal(migrated.taskTrackingEnabled, taskTrackingEnabled);
	}

	assert.ok(settingsSource.includes('用于跨项目复用的偏好、决策和经验。'));
	assert.ok(settingsSource.includes('用于延续当前项目、仓库或工作区的决策、经验和上下文。'));
	assert.ok(settingsSource.includes("ui('任务追踪', 'Task tracking')"));
	assert.ok(settingsSource.includes('记录任务的目标、执行过程和结果，供后续查看与继续。'));
	assert.ok(settingsSource.includes("ui('启用任务追踪', 'Enable task tracking')"));
	assert.equal(settingsSource.includes('也可以改为自动保存或不接收'), false);
	assert.equal(settingsSource.includes('旧版共享记忆笔记不会被改写'), false);
	assert.equal(settingsSource.includes("ui('任务结束记忆提案', 'Task closeout memory proposals')"), false);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 18 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
