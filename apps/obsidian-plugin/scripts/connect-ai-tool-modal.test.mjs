#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const settingsSource = fs.readFileSync('src/features/settings/tracekeeper-setting-tab.ts', 'utf8');
const modalSource = fs.readFileSync('src/features/client-config/client-config-modals.ts', 'utf8');
const stylesSource = fs.readFileSync('styles.css', 'utf8');

assert.equal(settingsSource.includes('renderConnectAiToolSetting'), false);
assert.match(settingsSource, /renderAgentClientConfigSection/);
assert.match(settingsSource, /candidateConfigs/);
assert.match(settingsSource, /new ConnectAiToolModal\(/);
assert.match(settingsSource, /'add'/);
assert.match(settingsSource, /'manage'/);
assert.match(settingsSource, /integration/);

for (const required of [
	'private async ensureIntegration',
	'!this.config.supportedAuthModes.includes(existing.authMode) && !existing.credential',
	'this.plugin.setAgentAuthMode(existing.integrationId, defaultMode)',
	'private renderAuthMode',
	'private renderSetup',
	'private renderAuthorization',
	'private renderMaintenance',
	'private renderSkill',
	'createAgentIntegration',
	'markAgentSetupCommandCopied',
	'issueManualBearerCredential',
	'decideOAuthRequest',
	'getPendingOAuthRequests',
	'copyToClipboard',
	'setIcon(copy, \'copy\')',
	"clickable-icon tracekeeper-copy-button",
	"createDiv({ cls: 'tracekeeper-copyable-command' })",
	"'aria-label': copyLabel",
	"tabindex: '0'",
	"'aria-label': copyTokenLabel",
	'reauthorizationInstruction',
	'this.mode === \'manage\'',
	"ui('移除配置', 'Remove configuration')",
	"ui('自动', 'Automatic')",
	"ui('手动', 'Manual')",
	"ui('配置方式', 'Setup mode')",
	"this.selectedAuthMode === 'bearer'",
	'this.plugin.getMcpHttpEndpoint()',
	"ui('复制 MCP 端点', 'Copy MCP endpoint')",
	'在客户端的 MCP 设置中手动填写以下端点',
	'手动访问令牌适用于',
	'Allow',
	'Deny',
	'需要授权确认',
	'Authorization required',
	"role: 'alert'",
	"'aria-live': 'assertive'",
	'客户端',
	'Redirect origin',
	'urlOrigin(pending.redirectUri)',
	'明文凭据只在当前弹窗内存中显示',
	'plaintext credential is shown only in this modal memory',
	'不会自动修改客户端配置',
	'never edits client configuration automatically',
	"'aria-live': 'polite'",
	"'aria-atomic': 'true'",
]) {
	assert.ok(modalSource.includes(required), `${required} must be present`);
}

assert.ok(modalSource.indexOf('this.renderSkill(container);') < modalSource.indexOf('this.renderMaintenance(container);'));
assert.equal(modalSource.includes('忘记 Agent 卡片'), false);
assert.equal(modalSource.includes('Forget Agent card'), false);
assert.equal(modalSource.includes('手工 Bearer'), false);
assert.equal(modalSource.includes('Manual Bearer'), false);
assert.equal(modalSource.includes('不可信'), false);
assert.equal(modalSource.includes('untrusted'), false);

const removeFlowStart = modalSource.indexOf("ui('移除配置', 'Remove configuration')");
const removeFlowEnd = modalSource.indexOf('const close =', removeFlowStart);
const removeFlowSource = modalSource.slice(removeFlowStart, removeFlowEnd);
assert.match(removeFlowSource, /this\.close\(\)/);
assert.equal(removeFlowSource.includes('this.renderPanel()'), false);

for (const forbidden of [
	'issueAgentPairingTicket',
	'getAgentPairingTicketStatus',
	'pairingTicket',
	'pairing code',
	'配对码',
	'supportsLocalOAuth',
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
	'private configs:',
	'复制终端 / AI 指令',
	'Copy terminal / AI instruction',
	'生成新配对码',
	'Generate new pairing code',
]) {
	assert.equal(modalSource.includes(forbidden), false, `${forbidden} must stay out of the normal modal`);
}

assert.match(stylesSource, /\.tracekeeper-connect-ai-tool-modal\s*\{/);
assert.match(stylesSource, /\.tracekeeper-connect-ai-tool-modal__pending\s*\{[\s\S]*?border-left-width:\s*4px;[\s\S]*?background:\s*var\(--background-secondary\);/);
assert.match(stylesSource, /\.tracekeeper-connect-ai-tool-modal__pending-details\s*\{[\s\S]*?display:\s*grid;/);
assert.match(stylesSource, /\.tracekeeper-settings-add-agent\s*\{/);
assert.match(stylesSource, /\.tracekeeper-copyable-command\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;/);
assert.match(stylesSource, /\.tracekeeper-copyable-command \.tracekeeper-code-block\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?overflow-x:\s*auto;[\s\S]*?white-space:\s*nowrap;[\s\S]*?user-select:\s*text;[\s\S]*?cursor:\s*text;/);
assert.match(stylesSource, /\.tracekeeper-copyable-command \.tracekeeper-copy-button\s*\{[\s\S]*?flex:\s*0 0 auto;/);
assert.doesNotMatch(stylesSource, /\.tracekeeper-connect-ai-tool-modal__select\s*\{/);
assert.doesNotMatch(stylesSource, /\.tracekeeper-connect-ai-tool-modal__selector\s*\{/);
assert.match(stylesSource, /max-width:\s*min\(720px,\s*calc\(100vw - 32px\)\)/);
assert.match(stylesSource, /@media \(max-width: 520px\)/);

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 50 })}\n`);
