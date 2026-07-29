#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-skill-install-view-model-test-'));
const output = path.join(tempRoot, 'skill-install-view-model.mjs');

const state = (overrides = {}) => ({
	clientId: 'codex',
	targetId: 'codex',
	targetDirectory: '/tmp/codex/tracekeeper',
	legacyTargetDirectories: [],
	deliveryMode: 'managed',
	activationMode: 'automatic_with_restart_fallback',
	restartRequired: false,
	state: 'installed',
	fileVerified: true,
	updateAvailable: false,
	installedVersion: '2.1.0',
	expectedVersion: '2.1.0',
	detail: '',
	...overrides,
});

try {
	await build({
		entryPoints: [path.resolve('src/features/skill-installation/skill-install-view-model.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const { buildSkillInstallPrompt } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const localize = (zh) => zh;

	assert.deepEqual(buildSkillInstallPrompt(state(), localize), {
		label: 'Skill 已安装',
		detail: '这个 Agent 已能主动召回相关记忆，并在任务完成时整理值得长期保留的结论。',
		currentVersion: 'v2.1.0',
		bundledVersion: 'v2.1.0',
		tone: 'success',
		action: null,
		actionLabel: '',
	});
	const notInstalled = buildSkillInstallPrompt(state({ state: 'not_installed', installedVersion: '', fileVerified: false }), localize);
	assert.equal(notInstalled.action, 'install');
	assert.equal(notInstalled.currentVersion, '未安装');
	assert.equal(notInstalled.bundledVersion, 'v2.1.0');
	assert.equal(notInstalled.detail, '安装后，这个 Agent 会主动召回相关记忆，并在任务完成时整理值得长期保留的结论，减少重复说明和跨会话上下文丢失。');
	const update = buildSkillInstallPrompt(state({ state: 'update_available', installedVersion: '2.0.0', expectedVersion: '2.2.0', updateAvailable: true, fileVerified: false }), localize);
	assert.equal(update.action, 'update');
	assert.equal(update.currentVersion, 'v2.0.0');
	assert.equal(update.bundledVersion, 'v2.2.0');
	assert.equal(update.detail, '更新后，这个 Agent 会使用最新的记忆召回和任务收尾规则。');
	const legacy = buildSkillInstallPrompt(state({ state: 'legacy_install', installedVersion: '2.0.0', fileVerified: false }), localize);
	assert.equal(legacy.action, 'migrate');
	assert.equal(legacy.currentVersion, 'v2.0.0（旧位置）');
	const copyOnly = buildSkillInstallPrompt(state({ state: 'copy_only', deliveryMode: 'copy_only', installedVersion: '', fileVerified: false }), localize);
	assert.equal(copyOnly.action, 'copy');
	assert.equal(copyOnly.currentVersion, '需在客户端确认');
	assert.equal(copyOnly.detail, '保存后，这个 Agent 会主动召回相关记忆，并在任务完成时整理值得长期保留的结论；需要按客户端方式手动保存。');
	assert.equal(buildSkillInstallPrompt(state({ state: 'unavailable', deliveryMode: 'copy_only', installedVersion: '', fileVerified: false }), localize).currentVersion, '需在客户端确认');
	const modified = buildSkillInstallPrompt(state({ state: 'modified', installedVersion: '2.1.0', fileVerified: false }), localize);
	assert.equal(modified.action, null);
	assert.equal(modified.currentVersion, 'v2.1.0（未验证）');
	assert.equal(buildSkillInstallPrompt(state({ state: 'modified', installedVersion: '', fileVerified: false }), localize).currentVersion, '无法验证');
	const newer = buildSkillInstallPrompt(state({ state: 'newer_than_bundled', installedVersion: '3.0.0' }), localize);
	assert.equal(newer.action, null);
	assert.equal(newer.currentVersion, 'v3.0.0');
	const conflict = buildSkillInstallPrompt(state({ state: 'location_conflict', installedVersion: '', fileVerified: false }), localize);
	assert.equal(conflict.action, null);
	assert.equal(conflict.currentVersion, '多个位置，无法确认');

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 22 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
