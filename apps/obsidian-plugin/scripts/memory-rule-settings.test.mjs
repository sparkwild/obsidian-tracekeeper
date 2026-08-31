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
const mainSource = fs.readFileSync('src/main.ts', 'utf8');
const structureModalSource = fs.readFileSync('src/features/structure/initialize-memory-structure-modal.ts', 'utf8');

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
		wikiChangeRule: 'review_batch',
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
		assert.equal(migrated.wikiChangeRule, 'review_batch');
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

	for (const rule of ['review_each', 'review_batch', 'auto_managed', 'disabled']) {
		assert.equal(settings.normalizeWikiChangeRule(rule), rule);
	}
	assert.equal(settings.normalizeWikiChangeRule('legacy'), 'review_batch');
	assert.ok(settingsSource.includes('按任务汇总低、中风险 Wiki 变更'));
	assert.ok(settingsSource.includes('高风险正文变更仍逐项审核'));
	assert.ok(settingsSource.includes('自动创建符合条件的不可变 Global MemoryRecord v2'));
	assert.ok(settingsSource.includes('这是新安装的默认设置。'));
	assert.ok(settingsSource.includes('对可精确识别的新项目，以仅创建方式安全初始化 canonical 项目 Hub'));
	assert.ok(settingsSource.includes('For an exactly identified new project, safely initialize its canonical Hub with create-only semantics'));
	assert.ok(settingsSource.includes('项目记忆保存前进入知识变更审核。'));
	assert.ok(settingsSource.includes('不接收新的项目记忆。'));
	assert.ok(settingsSource.includes('setDesc(this.globalMemoryRuleDescription())'));
	assert.ok(settingsSource.includes('setDesc(this.projectMemoryRuleDescription())'));
	assert.ok(settingsSource.includes("globalHub.state !== 'ready'"));
	assert.ok(settingsSource.includes('全局记忆建议可以进入审核，但在修复前不会被描述为已持久化'));
	assert.ok(settingsSource.includes('openInitializeMemoryStructureModal'));
	assert.ok(mainSource.includes("globalMemoryRule: 'review_queue'"));
	assert.ok(mainSource.includes("wikiChangeRule: 'review_batch'"));
	assert.ok(mainSource.includes('全局 MemoryRecord 默认进入审核；全局与项目写入遵循 Obsidian 中的记忆规则。'));
	assert.ok(mainSource.includes('Wiki 变更'));
	assert.ok(mainSource.includes('getGlobalMemoryHubStatus()'));
	assert.ok(mainSource.includes("state: entry === null ? 'missing' : entry instanceof TFile ? 'ready' : 'invalid'"));
	assert.ok(structureModalSource.includes('基础结构修复已阻断'));
	assert.ok(structureModalSource.includes('Tracekeeper 不会删除或覆盖它们'));
	assert.ok(settingsSource.includes("ui('任务追踪', 'Task tracking')"));
	assert.ok(settingsSource.includes('记录任务的目标、执行过程和结果，供后续查看与继续。'));
	assert.ok(settingsSource.includes("ui('启用任务追踪', 'Enable task tracking')"));
	assert.equal(settingsSource.includes('也可以改为自动保存或不接收'), false);
	assert.equal(settingsSource.includes('旧版共享记忆笔记不会被改写'), false);
	assert.equal(settingsSource.includes("ui('任务结束记忆提案', 'Task closeout memory proposals')"), false);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 43 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
