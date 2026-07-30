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
const copyActionEnd = modalSource.indexOf('private async beginPairing', copyActionStart + 1);
assert.ok(copyActionStart >= 0, 'renderConnectionActions must exist');
assert.ok(copyActionEnd > copyActionStart, 'beginPairing must follow renderConnectionActions');
const copyAction = modalSource.slice(copyActionStart, copyActionEnd);
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

assert.ok(modalSource.includes('`Add ${this.config.displayName}`'));
assert.ok(modalSource.includes('`Manage ${this.config.displayName}`'));
assert.ok(modalSource.includes('private config: GeneratedClientConfig'));
assert.ok(modalSource.includes("private mode: 'add' | 'manage'"));
assert.ok(modalSource.includes("ui('已正常使用', 'Successfully used')"));
assert.ok(modalSource.includes('config.supportsLocalOAuth'));
assert.ok(modalSource.includes('issueAgentPairingTicket(this.config.clientId)'));
assert.ok(modalSource.includes('getAgentPairingTicketStatus(ticket.id)'));
assert.ok(modalSource.includes("case 'pending'"));
assert.ok(modalSource.includes("case 'awaiting_confirmation'"));
assert.ok(modalSource.includes("case 'authorized'"));
assert.ok(modalSource.includes("case 'expired'"));
assert.ok(modalSource.includes("case 'attempts_exhausted'"));
assert.ok(modalSource.includes("finishPairingState('redeemed')"));
assert.ok(modalSource.includes("finishPairingState('retry')"));
assert.ok(modalSource.includes("ui('等待授权页确认', 'Awaiting authorization confirmation')"));
assert.ok(modalSource.includes('无需再次输入配对码'));
assert.ok(modalSource.includes('do not enter the code again'));
assert.ok(modalSource.includes("this.pairingState === 'ready' && this.pairingTicket"));
assert.equal(modalSource.match(/this\.pairingTicket\.code/g)?.length, 1);
assert.ok(modalSource.includes('this.pairingTicket.code'));
assert.ok(modalSource.includes('请勿复制给 AI、终端或聊天'));
assert.ok(modalSource.includes('Do not copy it to an AI, terminal, or chat'));
assert.equal(onOpenBody.includes('beginPairing'), false);
assert.ok(copyAction.includes("this.pairingState === null"));
assert.ok(modalSource.includes("ui('待生成配对码', 'Pairing code not generated')"));
assert.ok(modalSource.includes('renderClientSkillPrompt'));
assert.ok(modalSource.includes("ui('复制终端 / AI 指令', 'Copy terminal / AI instruction')"));
assert.ok(modalSource.includes("ui('复制本机端点', 'Copy local endpoint')"));
assert.ok(copyAction.includes('this.config.setupInstruction'));
assert.ok(copyAction.includes('copyToClipboard('));
assert.equal(copyAction.includes('pairingTicket.code'), false);
assert.equal(copyAction.includes('pairingTicket.id'), false);
assert.equal(copyAction.includes('runtimeAccessToken'), false);

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
]) {
	assert.equal(modalSource.includes(forbidden), false, `${forbidden} must stay out of the normal modal`);
}

assert.match(stylesSource, /\.tracekeeper-connect-ai-tool-modal\s*\{/);
assert.match(stylesSource, /\.tracekeeper-settings-add-agent\s*\{/);
assert.doesNotMatch(stylesSource, /\.tracekeeper-connect-ai-tool-modal__select\s*\{/);
assert.doesNotMatch(stylesSource, /\.tracekeeper-connect-ai-tool-modal__selector\s*\{/);
assert.match(stylesSource, /max-width:\s*min\(720px,\s*calc\(100vw - 32px\)\)/);

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 69 })}\n`);
