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
	const {
		buildSkillInstallPrompt,
		skillFileChangeLabel,
		skillInstallActionLabel,
		skillInstallPlanDetail,
		skillVerificationFailureDetail,
	} = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const localize = (zh) => zh;
	const english = (_zh, en) => en;

	assert.equal(skillInstallActionLabel('none', localize), '无需变更');
	assert.equal(skillInstallActionLabel('update', english), 'Update');
	assert.equal(skillFileChangeLabel('unchanged', localize), '未变化');
	assert.equal(skillFileChangeLabel('replace', english), 'Replace');
	assert.equal(skillInstallPlanDetail({
		action: 'none',
		targetDirectory: '/tmp/zcode/tracekeeper',
		files: [{ path: 'SKILL.md', change: 'unchanged', originalHash: 'hash' }],
	}, localize), '已安装文件与插件内置版本一致，无需写入。');
	assert.equal(skillInstallPlanDetail({
		action: 'none',
		targetDirectory: '/tmp/zcode/tracekeeper',
		files: [{ path: 'SKILL.md', change: 'replace', originalHash: 'hash' }],
	}, english), 'The installed Skill is newer than the embedded bundle, so downgrade overwrite is blocked.');
	assert.deepEqual(buildSkillInstallPrompt(state(), localize), {
		label: '强化技能已安装',
		detail: '文件已验证：/tmp/codex/tracekeeper。如需更改位置，请重新选择目录；Agent 是否实际采用仍需后续使用观察。',
		currentVersion: 'v2.1.0',
		bundledVersion: 'v2.1.0',
		tone: 'success',
		action: 'install',
		actionLabel: '更改目录',
		assistantLabel: 'AI 辅助安装',
	});
	const notInstalled = buildSkillInstallPrompt(state({ state: 'not_installed', installedVersion: '', fileVerified: false }), localize);
	assert.equal(notInstalled.action, 'install');
	assert.equal(notInstalled.label, '强化技能未安装');
	assert.equal(notInstalled.actionLabel, '选择目录安装');
	assert.equal(notInstalled.assistantLabel, 'AI 辅助安装');
	assert.equal(notInstalled.currentVersion, '未安装');
	assert.equal(notInstalled.bundledVersion, 'v2.1.0');
	assert.equal(notInstalled.detail, '请选择 Skills 根目录，Tracekeeper 会预览并在确认后写入 tracekeeper 子目录；也可以让 Agent 按提示词协助安装。');
	const update = buildSkillInstallPrompt(state({ state: 'update_available', installedVersion: '2.0.0', expectedVersion: '2.2.0', updateAvailable: true, fileVerified: false }), localize);
	assert.equal(update.action, 'update');
	assert.equal(update.label, '强化技能可更新');
	assert.equal(update.actionLabel, '更新');
	assert.equal(update.currentVersion, 'v2.0.0');
	assert.equal(update.bundledVersion, 'v2.2.0');
	assert.equal(update.detail, '将按当前安装目录 /tmp/codex/tracekeeper 直接更新。写入前会重新校验并保留备份；检测到用户修改时不会覆盖。');
	const legacy = buildSkillInstallPrompt(state({ state: 'legacy_install', installedVersion: '2.0.0', fileVerified: false }), localize);
	assert.equal(legacy.action, 'migrate');
	assert.equal(legacy.label, '强化技能位置待迁移');
	assert.equal(legacy.actionLabel, '选择目录迁移');
	assert.equal(legacy.currentVersion, 'v2.0.0（旧位置）');
	const locationRequired = buildSkillInstallPrompt(state({ state: 'location_required', installedVersion: '', fileVerified: false, targetDirectory: undefined }), localize);
	assert.equal(locationRequired.action, 'install');
	assert.equal(locationRequired.currentVersion, '尚未选择目录');
	assert.equal(JSON.stringify([
		buildSkillInstallPrompt(state(), localize),
		notInstalled,
		update,
		locationRequired,
	]).includes('已能主动'), false);
	assert.equal(JSON.stringify([
		buildSkillInstallPrompt(state(), localize),
		notInstalled,
		update,
		locationRequired,
	]).includes('start → recall → finish'), false);
	assert.equal(buildSkillInstallPrompt(state({ state: 'unavailable', installedVersion: '', fileVerified: false }), localize).currentVersion, '暂不可用');
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
	assert.equal(
		skillVerificationFailureDetail(state({ state: 'modified', fileVerified: false }), localize),
		'已安装 Skill 的版本与插件内置版本一致，但内容不一致。'
	);
	assert.equal(
		skillVerificationFailureDetail(state({ state: 'modified', installedVersion: '', fileVerified: false }), english),
		'The selected Skill content failed integrity verification.'
	);
	assert.equal(
		skillVerificationFailureDetail(state({ state: 'not_installed', installedVersion: '', fileVerified: false }), localize),
		'所选目录中未找到 Tracekeeper Skill。'
	);
	assert.equal(
		skillVerificationFailureDetail(state({ state: 'update_available', installedVersion: '2.0.0', expectedVersion: '2.1.0', fileVerified: true }), localize),
		'所选 Skill 版本低于插件内置版本，无法作为当前版本验证。'
	);
	assert.equal(
		skillVerificationFailureDetail(state({ state: 'newer_than_bundled', installedVersion: '3.0.0', fileVerified: true }), english),
		'The selected Skill is newer than the embedded version and cannot be verified as current.'
	);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 34 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
