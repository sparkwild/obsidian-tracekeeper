#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-desktop-directory-dialog-test-'));
const output = path.join(tempRoot, 'desktop-directory-dialog.bundle.mjs');

try {
	await build({
		entryPoints: [path.resolve('src/adapters/desktop-directory-dialog.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const module = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const directDialog = { showOpenDialog: async () => ({ canceled: false, filePaths: ['/direct'] }) };
	const remoteDialog = { showOpenDialog: async () => ({ canceled: false, filePaths: ['/remote'] }) };
	const legacyDialog = { showOpenDialog: async () => ({ canceled: false, filePaths: ['/legacy'] }) };

	assert.equal(module.resolveDesktopDirectoryDialog({ dialog: directDialog }, { dialog: remoteDialog }), directDialog);
	assert.equal(module.resolveDesktopDirectoryDialog({}, { dialog: remoteDialog }), remoteDialog);
	assert.equal(module.resolveDesktopDirectoryDialog({ remote: { dialog: legacyDialog } }, null), legacyDialog);
	assert.equal(module.resolveDesktopDirectoryDialog({ dialog: {} }, { dialog: null }), undefined);

	const modalSource = fs.readFileSync('src/features/skill-installation/skill-install-modals.ts', 'utf8');
	const mainSource = fs.readFileSync('src/main.ts', 'utf8');
	const stylesSource = fs.readFileSync('styles.css', 'utf8');
	assert.match(modalSource, /tracekeeper-skill-directory-row/);
	assert.match(modalSource, /createEl\('input', \{[\s\S]*placeholder: ui\('输入或粘贴已安装目录'/);
	assert.match(modalSource, /const choose = directoryRow\.createEl\('button', \{ text: ui\('选择目录'/);
	assert.match(modalSource, /const verify = directoryRow\.createEl\('button', \{ text: ui\('验证'/);
	assert.match(modalSource, /this\.plugin\.verifyExternalSkill\(this\.clientId, selectedDirectory\)/);
	assert.match(modalSource, /recommendation\.skillDirectory/);
	assert.match(modalSource, /sameSkillTargetDirectory\(currentTarget, recommendation\.skillDirectory\)/);
	assert.match(modalSource, /if \(recommendation && currentMatchesRecommendation\)/);
	assert.match(modalSource, /ui\('当前使用的官方位置', 'Current official location'\)/);
	assert.match(modalSource, /renderDirectoryCard\(\{[\s\S]*selectedDirectory: recommendation\.skillsRootDirectory/);
	const chooseFlowStart = modalSource.indexOf('const choose = directoryRow.createEl');
	const verifyFlowStart = modalSource.indexOf('const verify = directoryRow.createEl');
	assert.ok(chooseFlowStart >= 0 && verifyFlowStart > chooseFlowStart);
	assert.doesNotMatch(modalSource.slice(verifyFlowStart), /pickSkillDirectory/);
	assert.match(mainSource, /properties: \['openDirectory', 'createDirectory', 'showHiddenFiles'\]/);
	assert.match(mainSource, /skillVerificationFailureDetail\(detected, ui\)/);
	assert.match(stylesSource, /\.tracekeeper-skill-directory-row \{[\s\S]*?flex/);
	assert.match(stylesSource, /\.tracekeeper-skill-directory-row input \{[\s\S]*?text-overflow: ellipsis/);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 20 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
