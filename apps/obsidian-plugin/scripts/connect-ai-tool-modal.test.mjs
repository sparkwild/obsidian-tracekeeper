#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const settingsSource = fs.readFileSync('src/features/settings/tracekeeper-setting-tab.ts', 'utf8');
const modalSource = fs.readFileSync('src/features/client-config/client-config-modals.ts', 'utf8');
const mainSource = fs.readFileSync('src/main.ts', 'utf8');
const oauthPendingSource = fs.readFileSync('src/features/client-config/oauth-pending.ts', 'utf8');
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
	"() => this.refreshSettings('structure')",
	"await this.refreshSettings('content')",
	'commitWithBestEffortRefresh',
	'!this.config.supportedAuthModes.includes(existing.authMode) && !existing.credential',
	'this.plugin.setAgentAuthMode(integrationId, defaultMode)',
	'private renderAuthMode',
	'private renderSetup',
	'private renderManualBearer',
	'private renderAuthorization',
	'private refreshAgentState',
	'private renderMaintenance',
	'private renderSkill',
	'createAgentIntegration',
	'markAgentSetupCommandCopied',
	'issueManualBearerCredential',
	'decideOAuthRequest',
	'getPendingOAuthRequests',
	'pendingOAuthRequestsForModal',
	'selectedUnboundRequestId',
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
	'OAuth 客户端 ID',
	'客户端自报名称（不可信）',
	'Allowing it binds this OAuth client',
	'Redirect origin',
	'urlOrigin(pending.redirectUri)',
	'完整 JSON 只在当前弹窗中显示',
	'complete JSON is shown only in this modal',
	'撤销会删除 Tracekeeper 中的 MCP 配置、授权和 Skill 状态记录',
	'Revocation deletes MCP setup, authorization, and Skill state records from Tracekeeper',
	"'aria-live': 'polite'",
	"'aria-atomic': 'true'",
	'this.plugin.subscribeAgentStateChanges',
	'this.stopAgentStateSubscription?.()',
	'reportUiFailure',
]) {
	assert.ok(modalSource.includes(required), `${required} must be present`);
}

assert.doesNotMatch(modalSource, /error instanceof Error\s*\?\s*error\.message/);
assert.doesNotMatch(modalSource, /new Notice\(error\.message/);
assert.equal((modalSource.match(/new Notice\(reportUiFailure\(/g) ?? []).length, 7);
assert.equal((modalSource.match(/commitWithBestEffortRefresh\(/g) ?? []).length, 6);
for (const [context, zh, en] of [
	['tracekeeper failed to correct Agent setup mode', '无法修正 Agent 配置方式。', 'Unable to correct the Agent setup mode.'],
	['tracekeeper failed to create Agent integration', '无法创建 Agent 集成。', 'Unable to create the Agent integration.'],
	['tracekeeper failed to switch Agent authorization mode', '无法切换授权方式。', 'Unable to switch authorization mode.'],
	['tracekeeper failed to issue a manual Agent credential', '无法生成完整 JSON。', 'Unable to generate the complete JSON.'],
	['tracekeeper failed to revoke Agent access', '无法撤销 Agent 访问。', 'Unable to revoke Agent access.'],
	['tracekeeper failed to update OAuth approval', '无法更新 OAuth 审批。', 'Unable to update OAuth approval.'],
]) {
	assert.ok(modalSource.includes(context), `${context} must log the raw failure`);
	assert.ok(modalSource.includes(`zh: '${zh}'`), `${context} must have a Chinese fallback`);
	assert.ok(modalSource.includes(`en: '${en}'`), `${context} must have an English fallback`);
}
for (const [context, zh, en] of [
	['tracekeeper corrected Agent setup mode but failed to refresh the Agent view', 'Agent 配置方式已修正，但 Agent 视图暂未刷新。请重新打开设置页查看最新状态。', 'The Agent setup mode was corrected, but the Agent view is stale. Reopen Settings to see the latest state.'],
	['tracekeeper created Agent integration but failed to refresh the Agent view', 'Agent 集成已创建，但 Agent 列表暂未刷新。请重新打开设置页查看最新状态。', 'The Agent integration was created, but the Agent list is stale. Reopen Settings to see the latest state.'],
	['tracekeeper switched Agent authorization mode but failed to refresh the Agent view', '授权方式已切换，但 Agent 视图暂未刷新。请重新打开设置页查看最新状态。', 'The authorization mode was switched, but the Agent view is stale. Reopen Settings to see the latest state.'],
	['tracekeeper issued a manual Agent credential but failed to refresh the Agent view', '完整 JSON 已生成，但 Agent 视图暂未刷新。当前弹窗中的 JSON 仍可复制使用。', 'The complete JSON was generated, but the Agent view is stale. You can still copy and use the JSON in this modal.'],
	['tracekeeper revoked Agent access but failed to refresh the Agent view', 'Agent 访问已撤销，但 Agent 列表暂未刷新。请重新打开设置页查看最新状态。', 'Agent access was revoked, but the Agent list is stale. Reopen Settings to see the latest state.'],
]) {
	assert.ok(modalSource.includes(context), `${context} must log the refresh failure`);
	assert.ok(modalSource.includes(zh), `${context} must explain the committed result in Chinese`);
	assert.ok(modalSource.includes(en), `${context} must explain the committed result in English`);
}

assert.ok(modalSource.indexOf('this.renderSkill(container);') < modalSource.indexOf('this.renderMaintenance(container);'));
assert.equal(modalSource.includes('忘记 Agent 卡片'), false);
assert.equal(modalSource.includes('Forget Agent card'), false);
assert.equal(modalSource.includes('手工 Bearer'), false);
assert.equal(modalSource.includes('Manual Bearer'), false);
assert.ok(modalSource.includes('不可信'));
assert.ok(modalSource.includes('untrusted'));
assert.equal(modalSource.includes("ui('移除配置', 'Remove configuration')"), false);
assert.equal(modalSource.includes("ui('生成访问凭据', 'Generate access credential')"), false);
assert.equal(modalSource.includes("ui('替换访问凭据', 'Replace access credential')"), false);
for (const forbiddenCredentialMetadata of ['credentialId', 'issuedAt', 'tokenDigest', 'tokenDigestSha256']) {
	assert.equal(modalSource.includes(forbiddenCredentialMetadata), false, `${forbiddenCredentialMetadata} must stay out of the management modal`);
}
assert.match(modalSource, /this\.setTitle\(this\.mode === 'add'/);
assert.match(modalSource, /subscribeAgentStateChanges\(\(\) => this\.refreshAgentState\(\)\)/);
assert.match(modalSource, /refreshAgentState\(\)[\s\S]*getAgentIntegrationsSnapshot\(\)\.find[\s\S]*this\.renderPanel\(\)/);
const authorizationStart = modalSource.indexOf('private renderAuthorization');
const authorizationEnd = modalSource.indexOf('private renderMaintenance', authorizationStart);
const authorizationSource = modalSource.slice(authorizationStart, authorizationEnd);
assert.match(authorizationSource, /const pendingRequests = this\.pendingOAuthRequests\(\)/);
assert.equal(authorizationSource.includes('this.plugin.getPendingOAuthRequests()'), false);
const decisionStart = modalSource.indexOf('private async decide');
const decisionEnd = modalSource.indexOf('private async refreshSettings', decisionStart);
const decisionSource = modalSource.slice(decisionStart, decisionEnd);
assert.match(decisionSource, /commitOAuthDecisionWithBestEffortRefresh/);
assert.match(decisionSource, /\(\) => this\.plugin\.decideOAuthRequest/);
assert.match(decisionSource, /\(\) => this\.refreshSettings\('content'\)/);
assert.ok(decisionSource.indexOf('Unable to update OAuth approval') < decisionSource.indexOf('Authorization submitted'));
assert.match(decisionSource, /refreshError[\s\S]*Agent view is stale/);
assert.match(decisionSource, /this\.renderPanel\(\)/);
assert.match(settingsSource, /commitOAuthDecisionWithBestEffortRefresh[\s\S]*\(\) => this\.plugin\.decideOAuthRequest\(requestId, \{ decision: 'deny' \}\)[\s\S]*\(\) => this\.refreshAgentList\(true\)/);
assert.match(settingsSource, /request was denied, but the Agent list is stale/);
assert.match(mainSource, /pruneExpiredPendingOAuthRequests\(\);[\s\S]*pendingOAuthRequests\.set/);
assert.match(mainSource, /request\.expiresAt > now/);
assert.match(mainSource, /pendingOAuthClientReservations\.reserve\(request, target\.integrationId\)/);
assert.match(mainSource, /pendingOAuthClientReservations\.releaseRequest\(requestId\)/);
assert.match(oauthPendingSource, /OAuth client already has a pending approval for another Agent integration/);
assert.match(oauthPendingSource, /request\.expiresAt \+ OAUTH_AUTHORIZATION_CODE_RESERVATION_TTL_MS/);
assert.match(mainSource, /getBoundOAuthClients: \(\) => uniqueOAuthClientOwners/);
const issueStart = mainSource.indexOf('issueOAuthCredential: async');
const issueEnd = mainSource.indexOf('revokeOAuthCredential: async', issueStart);
const issueSource = mainSource.slice(issueStart, issueEnd);
assert.match(issueSource, /enqueueAgentCredentialOperation/);
assert.match(issueSource, /enqueueSingleOwnerOAuthCredentialIssue/);
const coordinatorStart = oauthPendingSource.indexOf('export const enqueueSingleOwnerOAuthCredentialIssue');
const coordinatorEnd = oauthPendingSource.indexOf('export const isActivePendingOAuthRequest', coordinatorStart);
const coordinatorSource = oauthPendingSource.slice(coordinatorStart, coordinatorEnd);
assert.ok(coordinatorSource.indexOf('assertOAuthClientOwnershipAvailable') < coordinatorSource.indexOf('return await issue()'));
assert.match(coordinatorSource, /finally[\s\S]*reservations\.releaseClientOwner/);
assert.match(settingsSource, /OAuth client ownership conflict/);
assert.match(settingsSource, /not shown on any Agent card and cannot be allowed/);
assert.equal(modalSource.includes("this.contentEl.createEl('h2'"), false);
assert.equal(modalSource.includes("section.createEl('h4'"), false);
const copyFlowStart = modalSource.indexOf('private renderCopyableCommand');
const copyFlowEnd = modalSource.indexOf('private renderAuthorization', copyFlowStart);
assert.doesNotMatch(modalSource.slice(copyFlowStart, copyFlowEnd), /issueManualBearerCredential/);

const revokeFlowStart = modalSource.indexOf("ui('撤销 Agent 访问', 'Revoke Agent access')");
const revokeFlowEnd = modalSource.indexOf('const close =', revokeFlowStart);
const revokeFlowSource = modalSource.slice(revokeFlowStart, revokeFlowEnd);
assert.match(revokeFlowSource, /revokeAndRemoveAgentIntegration/);
assert.match(revokeFlowSource, /commitWithBestEffortRefresh/);
assert.match(revokeFlowSource, /\(\) => this\.refreshSettings\('structure'\)/);
assert.match(revokeFlowSource, /this\.close\(\)/);
assert.equal(revokeFlowSource.includes('forgetAgentIntegration'), false);
assert.match(modalSource, /structure: this\.onStructureChanged/);
assert.match(modalSource, /content: this\.onChanged/);
assert.match(modalSource, /createAgentIntegration[\s\S]*\(\) => this\.refreshSettings\('structure'\)/);
assert.match(skillModalSource, /confirmSkillWrite[\s\S]*this\.close\(\)[\s\S]*await this\.onChanged\?\.\(\)/);
assert.match(skillModalSource, /failed to refresh Skill state after confirmed write/);
assert.match(skillModalSource, /verifyExternalSkill[\s\S]*await this\.onChanged\?\.\(\)[\s\S]*this\.close\(\)/);
assert.match(settingsSource, /'add',\s*\(\) => this\.refreshAgentList\(true\),/);
assert.match(settingsSource, /'manage',\s*\(\) => this\.refreshAgentList\(true\),/);
assert.match(settingsSource, /renderClientSkillPrompt\([\s\S]*onChanged: \(\) => this\.refreshAgentList\(true\)/);

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

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 137 })}\n`);
