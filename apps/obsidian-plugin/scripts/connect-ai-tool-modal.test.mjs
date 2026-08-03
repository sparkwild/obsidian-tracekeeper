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
	'Allow',
	'Deny',
	'明文凭据只在当前弹窗内存中显示',
	'plaintext credential is shown only in this modal memory',
	'不会自动修改客户端配置',
	'never edits client configuration automatically',
	"'aria-live': 'polite'",
	"'aria-atomic': 'true'",
]) {
	assert.ok(modalSource.includes(required), `${required} must be present`);
}

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
assert.match(stylesSource, /\.tracekeeper-settings-add-agent\s*\{/);
assert.doesNotMatch(stylesSource, /\.tracekeeper-connect-ai-tool-modal__select\s*\{/);
assert.doesNotMatch(stylesSource, /\.tracekeeper-connect-ai-tool-modal__selector\s*\{/);
assert.match(stylesSource, /max-width:\s*min\(720px,\s*calc\(100vw - 32px\)\)/);
assert.match(stylesSource, /@media \(max-width: 520px\)/);

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 34 })}\n`);
