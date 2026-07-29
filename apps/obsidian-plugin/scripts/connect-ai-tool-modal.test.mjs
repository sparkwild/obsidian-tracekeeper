#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const settingsSource = fs.readFileSync('src/features/settings/tracekeeper-setting-tab.ts', 'utf8');
const modalSource = fs.readFileSync('src/features/client-config/client-config-modals.ts', 'utf8');
const stylesSource = fs.readFileSync('styles.css', 'utf8');

function methodBody(source, name, nextName) {
	const start = source.indexOf(`private ${name}`);
	const end = source.indexOf(`private ${nextName}`, start + 1);
	assert.ok(start >= 0, `${name} must exist`);
	assert.ok(end > start, `${nextName} must follow ${name}`);
	return source.slice(start, end);
}

const serviceSection = methodBody(
	settingsSource,
	'renderConnectionInfoSection',
	'renderRuntimeEnabledSetting'
);
const agentSection = methodBody(
	settingsSource,
	'renderAgentClientConfigSection',
	'renderConnectionInfoSection'
);
const clientRow = methodBody(settingsSource, 'renderClientConfigRow', 'createSection');
const connectModalStart = modalSource.indexOf('export class ConnectAiToolModal');
assert.ok(connectModalStart >= 0, 'ConnectAiToolModal must exist');
const connectModal = modalSource.slice(connectModalStart);

assert.equal(serviceSection.includes('renderConnectAiToolSetting'), false);
assert.ok(agentSection.includes("ui('添加 Agent', 'Add Agent')"));
assert.ok(agentSection.includes('candidateConfigs'));
assert.ok(agentSection.includes("new ConnectAiToolModal("));
assert.ok(agentSection.includes("'add'"));
assert.ok(agentSection.includes('new Menu().setNoIcon()'));
assert.ok(agentSection.includes('menu.addItem'));
assert.ok(agentSection.includes('menu.showAtPosition'));
assert.ok(agentSection.includes("'aria-haspopup': 'menu'"));
assert.ok(agentSection.includes("'aria-expanded': 'false'"));
assert.ok(agentSection.includes('config,'));
assert.ok(clientRow.includes("ui('管理 Agent', 'Manage Agent')"));
assert.ok(clientRow.includes("new ConnectAiToolModal("));
assert.ok(clientRow.includes("'manage'"));

assert.equal(clientRow.includes('ClientConfigCopyModal'), false);
assert.equal(clientRow.includes('ClientConfigPreviewModal'), false);

assert.ok(connectModal.includes('`Add ${this.config.displayName}`'));
assert.ok(connectModal.includes('`Manage ${this.config.displayName}`'));
assert.ok(connectModal.includes('private config: GeneratedClientConfig'));
assert.ok(connectModal.includes("private mode: 'add' | 'manage'"));
assert.ok(connectModal.includes("ui('已正常使用', 'Successfully used')"));
assert.ok(connectModal.includes("ui('重新复制配置', 'Copy config again')"));
assert.ok(connectModal.includes('Tracekeeper 已验证真实使用'));
assert.ok(connectModal.includes('Tracekeeper has verified real use'));
assert.equal(connectModal.includes("createEl('select'"), false);
assert.equal(connectModal.includes("createEl('option'"), false);
assert.equal(connectModal.includes('selectedClientId'), false);
assert.equal(connectModal.includes('private configs:'), false);
assert.ok(connectModal.includes('config.redactedConfigText'));
assert.ok(connectModal.includes('Authorization Header'));
assert.ok(connectModal.includes('config.supportsAutoConfigure'));
assert.ok(connectModal.includes('new ClientConfigCopyModal('));
assert.ok(connectModal.includes('new ClientConfigPreviewModal('));
assert.ok(connectModal.includes('renderClientSkillPrompt'));
assert.ok(connectModal.includes("ui('打开配置文件', 'Open config file')"));
assert.ok(connectModal.includes("ui('移除配置', 'Remove config')"));
assert.ok(connectModal.includes('不兼容当前安全连接'));
assert.ok(connectModal.includes('Not compatible with the current secure connection'));
assert.ok(connectModal.includes("'aria-label'"));
assert.ok(connectModal.includes("'aria-live'"));
assert.equal(connectModal.includes('select.focus()'), false);

assert.equal(connectModal.includes('runtimeAccessToken'), false);
assert.equal(connectModal.includes('config.completeConfigText'), false);
assert.equal(connectModal.includes('copyToClipboard'), false);
assert.equal(connectModal.includes('?token='), false);

assert.match(stylesSource, /\.tracekeeper-connect-ai-tool-modal\s*\{/);
assert.match(stylesSource, /\.tracekeeper-settings-add-agent\s*\{/);
assert.doesNotMatch(stylesSource, /\.tracekeeper-connect-ai-tool-modal__select\s*\{/);
assert.doesNotMatch(stylesSource, /\.tracekeeper-connect-ai-tool-modal__selector\s*\{/);
assert.match(stylesSource, /max-width:\s*min\(720px,\s*calc\(100vw - 32px\)\)/);

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 50 })}\n`);
