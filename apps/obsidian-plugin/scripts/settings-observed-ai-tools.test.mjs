#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/features/settings/tracekeeper-setting-tab.ts', 'utf8');
const projectionSource = fs.readFileSync(
	'src/features/settings/agent-configuration-view-model.ts',
	'utf8'
);
const styles = fs.readFileSync('styles.css', 'utf8');

function methodBody(name, nextName) {
	const start = source.indexOf(`private ${name}`);
	const end = source.indexOf(`private ${nextName}`, start + 1);
	assert.ok(start >= 0, `${name} must exist`);
	assert.ok(end > start, `${nextName} must follow ${name}`);
	return source.slice(start, end);
}

const agentSection = methodBody('renderAgentClientConfigSection', 'renderConnectionInfoSection');
const serviceSection = methodBody('renderConnectionInfoSection', 'renderRuntimeEnabledSetting');
const clientRow = methodBody('renderClientConfigRow', 'createSection');

assert.ok(agentSection.includes('buildAgentConfigurationViewModel('));
assert.ok(agentSection.includes("ui('添加 Agent', 'Add Agent')"));
assert.ok(agentSection.includes('candidateConfigs'));
assert.ok(agentSection.includes('visibleAgents'));
assert.ok(agentSection.includes('this.renderClientConfigRow'));
assert.ok(agentSection.includes("'add'"));
assert.ok(agentSection.includes('new Menu().setNoIcon()'));
assert.ok(agentSection.includes('for (const config of candidateConfigs)'));
assert.ok(agentSection.includes('menu.addItem'));
assert.ok(agentSection.includes('.setTitle(config.displayName)'));
assert.ok(agentSection.includes('menu.showAtPosition'));
assert.ok(agentSection.includes("'aria-haspopup': 'menu'"));
assert.ok(agentSection.includes("'aria-expanded': 'false'"));
assert.ok(projectionSource.includes("config.configState !== 'configured'"));
assert.ok(projectionSource.includes('config.supportsAutoConfigure'));
assert.ok(clientRow.includes("ui('已正常使用', 'Successfully used')"));
assert.ok(clientRow.includes("ui('最近连接', 'Last connected')"));
assert.ok(clientRow.includes("ui('最近成功使用', 'Last successful use')"));
assert.ok(clientRow.includes('agent.lastConnectedAt'));
assert.ok(clientRow.includes('agent.lastUsedAt'));
assert.ok(clientRow.includes("ui('管理 Agent', 'Manage Agent')"));
assert.ok(clientRow.includes("'manage'"));
assert.ok(clientRow.includes('renderClientSkillPrompt'));

assert.equal(serviceSection.includes('renderObservedAiToolsSetting'), false);
assert.equal(serviceSection.includes('renderConnectAiToolSetting'), false);
assert.equal(source.includes('private renderObservedAiToolsSetting'), false);
assert.equal(source.includes('private renderConnectAiToolSetting'), false);
assert.equal(source.includes("ui('已观察 AI 工具', 'Observed AI tools')"), false);
assert.equal(source.includes("ui('连接 AI 工具', 'Connect AI tool')"), false);
assert.equal(agentSection.includes('for (const config of snapshot.clientConfigs)'), false);
assert.equal(agentSection.includes('snapshot.clientConfigs.find'), false);
assert.equal(agentSection.includes("createEl('select'"), false);

for (const forbidden of [
	'observedClientNameRaw',
	'observedClientVersion',
	'clientName',
	'sessionId',
	'sessionCount',
	'principalId',
	'permissionProfile',
	'runtimeAccessToken',
	'completeConfigText',
	'Authenticated agent',
	'认证 Agent',
]) {
	assert.equal(clientRow.includes(forbidden), false, `${forbidden} must stay out of the normal list`);
}

assert.match(styles, /\.tracekeeper-settings-agent-actions\s*\{/);
assert.match(styles, /\.tracekeeper-settings-client-row__meta\s*\{/);
assert.equal(styles.includes('.tracekeeper-settings-observed-tools'), false);
assert.equal(styles.includes('.tracekeeper-settings-observed-tool'), false);

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 49 })}\n`);
