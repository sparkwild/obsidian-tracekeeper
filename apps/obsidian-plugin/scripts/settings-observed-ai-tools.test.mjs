#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/features/settings/tracekeeper-setting-tab.ts', 'utf8');
const mainSource = fs.readFileSync('src/main.ts', 'utf8');
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
const clientRow = methodBody('renderClientConfigRow', 'connectionStateLabel');

assert.ok(agentSection.includes('buildAgentConfigurationViewModel('));
assert.ok(agentSection.includes("ui('添加 Agent', 'Add Agent')"));
assert.ok(agentSection.includes('candidateConfigs'));
assert.ok(agentSection.includes('visibleAgents'));
assert.ok(agentSection.includes('this.renderClientConfigRow'));
assert.equal(agentSection.includes('skillOnlyConfigs'), false);
assert.equal(source.includes('private renderSkillOnlyRow'), false);
assert.equal(source.includes("ui('仅 Skill', 'Skill only')"), false);
assert.ok(agentSection.includes("'add'"));
assert.ok(agentSection.includes('() => this.renderSettings()'));
assert.ok(agentSection.includes('new Menu().setNoIcon()'));
assert.ok(agentSection.includes('for (const config of candidateConfigs)'));
assert.ok(agentSection.includes('menu.addItem'));
assert.ok(agentSection.includes('.setTitle(config.displayName)'));
assert.ok(agentSection.includes('menu.showAtPosition'));
assert.ok(agentSection.includes("setAttribute('aria-haspopup', 'menu')"));
assert.ok(agentSection.includes("setAttribute('aria-expanded', 'false')"));
assert.equal(projectionSource.includes("config.configState !== 'configured'"), false);
assert.equal(projectionSource.includes('config.supportsAutoConfigure'), false);
assert.ok(clientRow.includes('最近活动时间'));
assert.ok(clientRow.includes('Latest activity'));
assert.ok(clientRow.includes('agent?.sortTimestamp'));
assert.ok(clientRow.includes('暂无活动'));
assert.ok(clientRow.includes('No activity'));
assert.equal(clientRow.includes("ui('授权方式', 'Auth mode')"), false);
assert.equal(clientRow.includes("ui('最近连接', 'Last connected')"), false);
assert.equal(clientRow.includes("ui('最近使用', 'Last used')"), false);
assert.ok(clientRow.includes("ui('管理 Agent', 'Manage Agent')"));
assert.ok(clientRow.includes("'manage'"));
assert.ok(clientRow.includes('() => this.renderSettings()'));
assert.ok(clientRow.includes('renderClientSkillPrompt'));
assert.ok(source.includes("case 'used': return ui('已连接', 'Connected');"));
assert.equal(source.includes("case 'used': return ui('已使用', 'Used');"), false);

assert.equal(serviceSection.includes('renderObservedAiToolsSetting'), false);
assert.equal(serviceSection.includes('renderConnectAiToolSetting'), false);
assert.equal(source.includes('private renderObservedAiToolsSetting'), false);
assert.equal(source.includes('private renderConnectAiToolSetting'), false);
assert.equal(source.includes("ui('已观察 AI 工具', 'Observed AI tools')"), false);
assert.equal(source.includes("ui('连接 AI 工具', 'Connect AI tool')"), false);
assert.equal(agentSection.includes('for (const config of snapshot.clientConfigs)'), false);
assert.equal(agentSection.includes('snapshot.clientConfigs.find'), false);
assert.equal(agentSection.includes("createEl('select'"), false);
assert.ok(source.includes('async refreshAgentList(force = false): Promise<void>'));
assert.ok(source.includes('isAgentListVisible(): boolean'));
assert.ok(source.includes('tracekeeper-settings-agent-list-host'));
assert.ok(source.includes('buildAgentListFingerprint'));
assert.ok(source.includes('agentListRefreshPending'));
assert.ok(source.includes('agentListForceRefreshPending'));
assert.ok(source.includes('agentListRefreshPromise'));
assert.ok(source.includes('drainAgentListRefreshes'));
assert.ok(source.includes('if (this.agentListRefreshPromise) return this.agentListRefreshPromise'));
assert.ok(source.includes('hide(): void'));
assert.ok(source.includes('focusAgentConfiguration(): void'));
assert.ok(source.includes("setAttribute('data-tracekeeper-section', 'agent-configuration')"));
assert.ok(source.includes('this.renderAgentClientConfigSection(containerEl, snapshot)'));
assert.ok(source.includes(".addClass('tracekeeper-settings-agent-list-host')"));
assert.ok(source.includes("host.ownerDocument.createElement('div')"));
assert.ok(source.includes('host.replaceWith(replacement)'));
assert.ok(source.includes('shouldReplaceAgentConfiguration(this.agentListFingerprint, fingerprint, force)'));
assert.equal(source.includes("containerEl.createDiv({\n\t\t\tcls: 'tracekeeper-settings-agent-list-host'"), false);
assert.ok(source.includes("scrollIntoView({ block: 'start', behavior: 'auto' })"));
const settingsRender = methodBody('async renderSettings', 'buildAgentListFingerprint');
assert.ok(settingsRender.includes('const previousScrollTop = containerEl.scrollTop'));
assert.ok(settingsRender.includes('containerEl.scrollTop = previousScrollTop'));
assert.ok(
	settingsRender.indexOf('const previousScrollTop = containerEl.scrollTop')
		< settingsRender.indexOf('containerEl.empty()'),
	'Settings rerender must capture the native scroll position before clearing the page'
);
assert.ok(
	settingsRender.indexOf('containerEl.scrollTop = previousScrollTop')
		> settingsRender.indexOf('this.renderAdvancedMaintenanceSection(containerEl, snapshot)'),
	'Settings rerender must restore the native scroll position after rebuilding the complete page'
);
assert.ok(source.includes('private agentConfigurationFocusFrame: number | null = null'));
assert.ok(source.includes('private agentConfigurationFocusTimer: number | null = null'));
assert.ok(source.includes('window.cancelAnimationFrame(this.agentConfigurationFocusFrame)'));
assert.ok(source.includes('window.clearTimeout(this.agentConfigurationFocusTimer)'));
const focusSection = methodBody('applyAgentConfigurationFocus', 'renderAgentClientConfigSection');
assert.equal(
	(focusSection.match(/window\.requestAnimationFrame/g) ?? []).length,
	2,
	'Agent configuration focus must wait for Obsidian to finish restoring the settings scroll position'
);
assert.ok(focusSection.includes('window.setTimeout'));
assert.ok(focusSection.includes('AGENT_CONFIGURATION_FOCUS_SETTLE_DELAY_MS'));
assert.ok(focusSection.includes('this.agentListHostEl !== target'));
assert.ok(
	focusSection.indexOf("focus({ preventScroll: true })")
		< focusSection.indexOf("scrollIntoView({ block: 'start', behavior: 'auto' })"),
	'Final scrolling must happen after focus so the target remains visible'
);
assert.ok(
	source.indexOf('this.applyAgentConfigurationFocus();', source.indexOf('private async renderSettings'))
		> source.indexOf('this.renderAdvancedMaintenanceSection(containerEl, snapshot);'),
	'Agent configuration focus must run after the complete settings page is laid out'
);
assert.ok(source.includes('自动同步 Agent 配置和已打开的 Tracekeeper 动态视图。'));
assert.ok(mainSource.includes('private settingTab: TracekeeperSettingTab | null = null'));
assert.ok(mainSource.includes('Boolean(this.settingTab?.isAgentListVisible())'));
assert.ok(mainSource.includes('tasks.push(this.settingTab.refreshAgentList())'));
assert.ok(mainSource.includes("openSettingsTab(focus?: 'agent-configuration')"));
assert.ok(mainSource.includes('private scheduleAgentStateViewRefresh(): void'));

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

assert.match(styles, /\.tracekeeper-settings-client-item\s*\{/);
assert.match(styles, /\.tracekeeper-settings-client-row__meta\s*\{/);
assert.equal(styles.includes('.tracekeeper-settings-section'), false);
assert.equal(styles.includes('.tracekeeper-settings-observed-tools'), false);
assert.equal(styles.includes('.tracekeeper-settings-observed-tool'), false);

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 92 })}\n`);
