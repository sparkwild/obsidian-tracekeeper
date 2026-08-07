#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const settingsSource = fs.readFileSync('src/features/settings/tracekeeper-setting-tab.ts', 'utf8');
const modalSource = fs.readFileSync('src/features/client-config/client-config-modals.ts', 'utf8');
const skillModalSource = fs.readFileSync('src/features/skill-installation/skill-install-modals.ts', 'utf8');
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
	"await this.refreshSettings('structure')",
	"await this.refreshSettings('content')",
	'!this.config.supportedAuthModes.includes(existing.authMode) && !existing.credential',
	'this.plugin.setAgentAuthMode(existing.integrationId, defaultMode)',
	'private renderAuthMode',
	'private renderSetup',
	'private renderManualBearer',
	'private renderAuthorization',
	'private renderMaintenance',
	'private renderSkill',
	'createAgentIntegration',
	'markAgentSetupCommandCopied',
	'issueManualBearerCredential',
	'decideOAuthRequest',
	'getPendingOAuthRequests',
	'copyToClipboard',
	'buildManualMcpJsonConfig',
	'revokeAndRemoveAgentIntegration',
	'setIcon(copy, \'copy\')',
	"clickable-icon tracekeeper-copy-button",
	"createDiv({ cls: 'tracekeeper-copyable-command' })",
	"'aria-label': copyLabel",
	"tabindex: '0'",
	'reauthorizationInstruction',
	'this.mode === \'manage\'',
	"ui('撤销 Agent 访问', 'Revoke Agent access')",
	"ui('自动', 'Automatic')",
	"ui('手动', 'Manual')",
	"ui('配置方式', 'Setup mode')",
	"this.selectedAuthMode === 'bearer'",
	'this.plugin.getMcpHttpEndpoint()',
	"ui('复制完整 JSON', 'Copy complete JSON')",
	"ui('重新生成完整 JSON', 'Regenerate complete JSON')",
	"row.addClass('tracekeeper-copyable-json')",
	'复制并粘贴到客户端的“完整配置 / JSON”入口',
	'复制不会轮换凭据',
	'生成完整 JSON 后，再粘贴到客户端的原生配置入口',
	"presentation: 'modal-collapsible'",
	'onExpandedChange',
	"this.config.supportedAuthModes.length === 1",
	"tracekeeper-connect-ai-tool-modal__auth-static",
	'Allow',
	'Deny',
	'需要授权确认',
	'Authorization required',
	"role: 'alert'",
	"'aria-live': 'assertive'",
	'客户端',
	'Redirect origin',
	'urlOrigin(pending.redirectUri)',
	'完整 JSON 只在当前弹窗中显示',
	'complete JSON is shown only in this modal',
	'撤销会删除 Tracekeeper 中的 MCP 配置、授权和 Skill 状态记录',
	'Revocation deletes MCP setup, authorization, and Skill state records from Tracekeeper',
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
assert.equal(modalSource.includes("ui('移除配置', 'Remove configuration')"), false);
assert.equal(modalSource.includes("ui('生成访问凭据', 'Generate access credential')"), false);
assert.equal(modalSource.includes("ui('替换访问凭据', 'Replace access credential')"), false);
for (const forbiddenCredentialMetadata of ['credentialId', 'issuedAt', 'tokenDigest', 'tokenDigestSha256']) {
	assert.equal(modalSource.includes(forbiddenCredentialMetadata), false, `${forbiddenCredentialMetadata} must stay out of the management modal`);
}
assert.match(modalSource, /this\.setTitle\(this\.mode === 'add'/);
assert.equal(modalSource.includes("this.contentEl.createEl('h2'"), false);
assert.equal(modalSource.includes("section.createEl('h4'"), false);
const copyFlowStart = modalSource.indexOf('private renderCopyableCommand');
const copyFlowEnd = modalSource.indexOf('private renderAuthorization', copyFlowStart);
assert.doesNotMatch(modalSource.slice(copyFlowStart, copyFlowEnd), /issueManualBearerCredential/);

const revokeFlowStart = modalSource.indexOf("ui('撤销 Agent 访问', 'Revoke Agent access')");
const revokeFlowEnd = modalSource.indexOf('const close =', revokeFlowStart);
const revokeFlowSource = modalSource.slice(revokeFlowStart, revokeFlowEnd);
assert.match(revokeFlowSource, /revokeAndRemoveAgentIntegration/);
assert.match(revokeFlowSource, /await this\.refreshSettings\('structure'\)/);
assert.match(revokeFlowSource, /this\.close\(\)/);
assert.equal(revokeFlowSource.includes('forgetAgentIntegration'), false);
assert.match(modalSource, /structure: this\.onStructureChanged/);
assert.match(modalSource, /content: this\.onChanged/);
assert.match(modalSource, /createAgentIntegration[\s\S]*await this\.refreshSettings\('structure'\)/);
assert.match(skillModalSource, /confirmSkillWrite[\s\S]*await this\.onChanged\?\.\(\)[\s\S]*this\.close\(\)/);
assert.match(skillModalSource, /verifyExternalSkill[\s\S]*await this\.onChanged\?\.\(\)[\s\S]*this\.close\(\)/);

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
	"ui('复制 MCP 端点', 'Copy MCP endpoint')",
	'在客户端的 MCP 设置中手动填写以下端点',
	'复制访问凭据',
	'Copy access credential',
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
assert.match(stylesSource, /\.tracekeeper-copyable-json\s*\{[\s\S]*?align-items:\s*flex-start;/);
assert.match(stylesSource, /\.tracekeeper-copyable-json \.tracekeeper-code-block\s*\{[\s\S]*?max-height:\s*220px;[\s\S]*?overflow:\s*auto;[\s\S]*?white-space:\s*pre;/);
assert.match(stylesSource, /\.tracekeeper-settings-client-skill--modal-collapsible\s*\{/);
assert.match(stylesSource, /\.tracekeeper-settings-client-skill--modal-collapsible > summary\s*\{[\s\S]*?cursor:\s*pointer;/);
assert.match(stylesSource, /\.tracekeeper-connect-ai-tool-modal__auth-row\s*\{/);
assert.match(stylesSource, /\.tracekeeper-connect-ai-tool-modal__auth-static\s*\{/);
assert.doesNotMatch(stylesSource, /\.tracekeeper-connect-ai-tool-modal__select\s*\{/);
assert.doesNotMatch(stylesSource, /\.tracekeeper-connect-ai-tool-modal__selector\s*\{/);
assert.match(stylesSource, /max-width:\s*min\(720px,\s*calc\(100vw - 32px\)\)/);
assert.match(stylesSource, /@media \(max-width: 520px\)/);

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 68 })}\n`);
