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
		label: '使用指南已安装',
		detail: '文件已验证。是否被 Agent 实际采用仍需后续使用观察；若客户端未加载，再重启客户端。',
		currentVersion: 'v2.1.0',
		bundledVersion: 'v2.1.0',
		tone: 'success',
		action: null,
		actionLabel: '',
	});
	const notInstalled = buildSkillInstallPrompt(state({ state: 'not_installed', installedVersion: '', fileVerified: false }), localize);
	assert.equal(notInstalled.action, 'install');
	assert.equal(notInstalled.label, '使用指南未安装');
	assert.equal(notInstalled.actionLabel, '安装使用指南');
	assert.equal(notInstalled.currentVersion, '未安装');
	assert.equal(notInstalled.bundledVersion, 'v2.1.0');
	assert.equal(notInstalled.detail, '安装会把记忆协作使用指南放到客户端约定位置，但不会增加访问权限；安装后仍需通过实际使用观察效果。');
	const update = buildSkillInstallPrompt(state({ state: 'update_available', installedVersion: '2.0.0', expectedVersion: '2.2.0', updateAvailable: true, fileVerified: false }), localize);
	assert.equal(update.action, 'update');
	assert.equal(update.label, '使用指南可更新');
	assert.equal(update.actionLabel, '更新使用指南');
	assert.equal(update.currentVersion, 'v2.0.0');
	assert.equal(update.bundledVersion, 'v2.2.0');
	assert.equal(update.detail, '更新会替换为最新的记忆协作使用指南；是否被 Agent 采用仍需通过实际使用观察。');
	const legacy = buildSkillInstallPrompt(state({ state: 'legacy_install', installedVersion: '2.0.0', fileVerified: false }), localize);
	assert.equal(legacy.action, 'migrate');
	assert.equal(legacy.label, '使用指南位置待迁移');
	assert.equal(legacy.actionLabel, '迁移使用指南');
	assert.equal(legacy.currentVersion, 'v2.0.0（旧位置）');
	const copyOnly = buildSkillInstallPrompt(state({ state: 'copy_only', deliveryMode: 'copy_only', installedVersion: '', fileVerified: false }), localize);
	assert.equal(copyOnly.action, 'copy');
	assert.equal(copyOnly.label, '使用指南需手动设置');
	assert.equal(copyOnly.actionLabel, '复制使用指南');
	assert.equal(copyOnly.currentVersion, '需在客户端确认');
	assert.equal(copyOnly.detail, '请按客户端方式手动保存使用指南；保存只提供工作流指导，不会增加访问权限，仍需通过实际使用观察效果。');
	assert.equal(JSON.stringify([
		buildSkillInstallPrompt(state(), localize),
		notInstalled,
		update,
		copyOnly,
	]).includes('已能主动'), false);
	assert.equal(JSON.stringify([
		buildSkillInstallPrompt(state(), localize),
		notInstalled,
		update,
		copyOnly,
	]).includes('start → recall → finish'), false);
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

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 23 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
