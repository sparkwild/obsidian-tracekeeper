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
const copyActionStart = modalSource.indexOf('private renderConnectionActions');
const copyActionEnd = modalSource.indexOf('private async beginConnection', copyActionStart + 1);
assert.ok(copyActionStart >= 0, 'renderConnectionActions must exist');
assert.ok(copyActionEnd > copyActionStart, 'beginConnection must follow renderConnectionActions');
const copyAction = modalSource.slice(copyActionStart, copyActionEnd);
const beginConnectionStart = modalSource.indexOf('private async beginConnection');
const beginConnectionEnd = modalSource.indexOf('private async copySetupInstruction', beginConnectionStart + 1);
assert.ok(beginConnectionStart >= 0, 'beginConnection must exist');
assert.ok(beginConnectionEnd > beginConnectionStart, 'copySetupInstruction must follow beginConnection');
const beginConnection = modalSource.slice(beginConnectionStart, beginConnectionEnd);
const onOpenStart = modalSource.indexOf('onOpen(): void');
const onOpenEnd = modalSource.indexOf('onClose(): void', onOpenStart + 1);
assert.ok(onOpenStart >= 0, 'onOpen must exist');
assert.ok(onOpenEnd > onOpenStart, 'onClose must follow onOpen');
const onOpenBody = modalSource.slice(onOpenStart, onOpenEnd);

assert.equal(serviceSection.includes('renderConnectAiToolSetting'), false);
assert.ok(agentSection.includes("ui('添加 Agent', 'Add Agent')"));
assert.ok(agentSection.includes('candidateConfigs'));
assert.ok(agentSection.includes('new ConnectAiToolModal('));
assert.ok(agentSection.includes("'add'"));
assert.ok(agentSection.includes('new Menu().setNoIcon()'));
assert.ok(agentSection.includes('menu.addItem'));
assert.ok(agentSection.includes('menu.showAtPosition'));
assert.ok(agentSection.includes("'aria-haspopup': 'menu'"));
assert.ok(agentSection.includes("'aria-expanded': 'false'"));
assert.ok(clientRow.includes("ui('管理 Agent', 'Manage Agent')"));
assert.ok(clientRow.includes('new ConnectAiToolModal('));
assert.ok(clientRow.includes("'manage'"));

assert.ok(modalSource.includes('`连接 ${this.config.displayName}`'));
assert.ok(modalSource.includes('`管理 ${this.config.displayName}`'));
assert.ok(modalSource.includes('private config: GeneratedClientConfig'));
assert.ok(modalSource.includes("private mode: 'add' | 'manage'"));
assert.ok(modalSource.includes("ui('已正常使用', 'Successfully used')"));
assert.ok(modalSource.includes('config.supportsLocalOAuth'));
assert.ok(modalSource.includes('issueAgentPairingTicket(this.config.clientId)'));
assert.ok(modalSource.includes('getAgentPairingTicketStatus(ticket.id)'));
assert.ok(modalSource.includes('private async beginConnection'));
assert.ok(modalSource.includes('await this.plugin.copyToClipboard('));
assert.ok(modalSource.includes("ui('开始连接', 'Start connection')"));
assert.ok(modalSource.includes("ui('重新开始连接', 'Start again')"));
assert.ok(modalSource.includes("case 'pending'"));
assert.ok(modalSource.includes("case 'awaiting_confirmation'"));
assert.ok(modalSource.includes("case 'authorized'"));
assert.ok(modalSource.includes("case 'expired'"));
assert.ok(modalSource.includes("case 'attempts_exhausted'"));
assert.ok(modalSource.includes("finishPairingState('redeemed')"));
assert.ok(modalSource.includes("finishPairingState('retry')"));
assert.ok(modalSource.includes("ui('等待本机确认', 'Waiting for local confirmation')"));
assert.ok(modalSource.includes('配对码只在本机授权页手工输入'));
assert.ok(modalSource.includes('The pairing code is typed only in the local authorization page'));
assert.equal(modalSource.match(/this\.pairingTicket\.code/g)?.length, 1);
assert.ok(modalSource.includes('this.pairingTicket.code'));
assert.ok(modalSource.includes('配对码只在本机授权页手工输入，不会进入命令、剪贴板、日志或客户端配置'));
assert.ok(modalSource.includes('The pairing code is typed only in the local authorization page'));
assert.equal(onOpenBody.includes('beginPairing'), false);
assert.ok(copyAction.includes("presentation.primaryAction"));
assert.ok(modalSource.includes("ui('连接命令已复制', 'Connection command copied')"));
assert.ok(modalSource.includes('renderClientSkillPrompt'));
assert.ok(modalSource.includes("ui('再次复制连接命令', 'Copy connection command again')"));
assert.ok(modalSource.includes("ui('复制本机连接地址', 'Copy local connection address')"));
assert.ok(copyAction.includes('this.config.setupInstruction'));
assert.ok(beginConnection.includes('this.config.setupInstruction'));
assert.ok(beginConnection.includes('copyToClipboard('));
assert.ok(beginConnection.includes('this.clipboardState = \'failed\''));
assert.equal(beginConnection.includes('pairingTicket.code'), false);
assert.equal(beginConnection.includes('pairingTicket.id'), false);
assert.equal(copyAction.includes('pairingTicket.code'), false);
assert.equal(copyAction.includes('pairingTicket.id'), false);
assert.equal(copyAction.includes('runtimeAccessToken'), false);
assert.ok(modalSource.includes("createEl('details'"));
assert.ok(modalSource.includes("ui('技术详情', 'Technical details')"));
assert.ok(modalSource.includes("presentation: this.mode === 'manage' ? 'compact' : 'optional'"));
assert.ok(modalSource.includes("'aria-live': 'polite'"));
assert.ok(modalSource.includes("'aria-atomic': 'true'"));
assert.ok(modalSource.includes('private updatePairingMetadata'));
assert.ok(modalSource.includes('this.lastRenderedState = presentation.state'));
assert.ok(modalSource.includes('heading.tabIndex = -1'));

for (const forbidden of [
	'ClientConfigCopyModal',
	'ClientConfigPreviewModal',
	'config.completeConfigText',
	'config.redactedConfigText',
	'Authorization Header',
	'Bearer <redacted>',
	'config.targetPath',
	'config.supportsAutoConfigure',
	'prepareClientConfigChange',
	'applyClientConfig',
	'removeClientConfig',
	'openClientConfigFile',
	'?token=',
	"createEl('select'",
	"createEl('option'",
	'selectedClientId',
	'private configs:',
	'复制终端 / AI 指令',
	'Copy terminal / AI instruction',
	'生成新配对码',
	'Generate new pairing code',
	'待生成配对码',
	'Pairing code not generated',
]) {
	assert.equal(modalSource.includes(forbidden), false, `${forbidden} must stay out of the normal modal`);
}

assert.match(stylesSource, /\.tracekeeper-connect-ai-tool-modal\s*\{/);
assert.match(stylesSource, /\.tracekeeper-settings-add-agent\s*\{/);
assert.doesNotMatch(stylesSource, /\.tracekeeper-connect-ai-tool-modal__select\s*\{/);
assert.doesNotMatch(stylesSource, /\.tracekeeper-connect-ai-tool-modal__selector\s*\{/);
assert.match(stylesSource, /max-width:\s*min\(720px,\s*calc\(100vw - 32px\)\)/);
assert.match(stylesSource, /\.tracekeeper-connect-ai-tool-modal__technical-details\s*\{/);
assert.match(stylesSource, /@media \(max-width: 520px\)/);

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 78 })}\n`);
