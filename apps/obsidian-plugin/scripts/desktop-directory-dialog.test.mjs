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
	assert.match(modalSource, /import \{ reportUiFailure \} from '\.\.\/\.\.\/ui\/user-facing-error';/);
	assert.doesNotMatch(modalSource, /\berror\.message\b/);
	for (const context of [
		'tracekeeper failed to choose Skill directory for installation preview',
		'tracekeeper failed to preview Skill change',
		'tracekeeper failed to export Skill source directory',
		'tracekeeper failed to choose installed Skill directory for verification',
		'tracekeeper failed to verify externally installed Skill',
	]) {
		assert.ok(modalSource.includes(`context: '${context}'`));
	}
	assert.ok(modalSource.includes("zh: 'Skill \u9a8c\u8bc1\u5931\u8d25\u3002\u8bf7\u68c0\u67e5\u6240\u9009\u76ee\u5f55\u540e\u91cd\u8bd5\u3002'"));
	assert.ok(modalSource.includes("en: 'Skill verification failed. Check the selected directory and try again.'"));
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
	const directUpdateStart = mainSource.indexOf('async updateSkillAtInstalledDirectory');
	const confirmSkillWriteStart = mainSource.indexOf('async confirmSkillWrite');
	assert.ok(directUpdateStart >= 0 && confirmSkillWriteStart > directUpdateStart);
	const directUpdateSource = mainSource.slice(directUpdateStart, confirmSkillWriteStart);
	assert.match(directUpdateSource, /state\.state !== 'update_available'/);
	assert.match(directUpdateSource, /!state\.targetDirectory/);
	assert.match(directUpdateSource, /this\.prepareSkillWrite\(clientId, state\.targetDirectory\)/);
	assert.match(directUpdateSource, /plan\.action !== 'update' \|\| !plan\.canConfirm/);
	assert.match(directUpdateSource, /return this\.confirmSkillWrite\(plan\.planId, clientId\)/);
	const prepareAiSkillAssistantStart = mainSource.indexOf('async prepareAiSkillAssistant', confirmSkillWriteStart);
	const confirmSkillWriteSource = mainSource.slice(confirmSkillWriteStart, prepareAiSkillAssistantStart);
	assert.match(confirmSkillWriteSource, /detect\(\{[\s\S]*legacyTargetDirectories: \[\][\s\S]*verified\.state !== 'installed'/);
	assert.ok(
		confirmSkillWriteSource.indexOf("verified.state !== 'installed'")
			< confirmSkillWriteSource.indexOf('recordSkillInstallReceipt'),
		'Direct Skill writes must be verified before the install receipt is recorded'
	);
	assert.match(confirmSkillWriteSource, /请重启 \$\{profile\.displayName\} 后使用新版本/);
	assert.match(confirmSkillWriteSource, /action === 'update' \? 8000 : undefined/);
	assert.match(confirmSkillWriteSource, /this\.scheduleAgentStateViewRefresh\(\);[\s\S]*return result;/);
	assert.match(stylesSource, /\.tracekeeper-skill-directory-row \{[\s\S]*?flex/);
	assert.match(stylesSource, /\.tracekeeper-skill-directory-row input \{[\s\S]*?text-overflow: ellipsis/);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 40 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
