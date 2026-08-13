#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { resolveMinimumAppVersion } from '../../../scripts/version_compatibility.mjs';

const source = fs.readFileSync('src/features/settings/tracekeeper-setting-tab.ts', 'utf8');
const modalSource = fs.readFileSync('src/features/runtime/mcp-capabilities-modal.ts', 'utf8');
const stylesSource = fs.readFileSync('styles.css', 'utf8');
const pluginManifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const rootManifest = JSON.parse(fs.readFileSync('../../manifest.json', 'utf8'));
const versions = JSON.parse(fs.readFileSync('../../versions.json', 'utf8'));

function methodBody(name, nextName) {
	const start = source.indexOf(`private ${name}`);
	const end = source.indexOf(`private ${nextName}`, start + 1);
	assert.ok(start >= 0, `${name} must exist`);
	assert.ok(end > start, `${nextName} must follow ${name}`);
	return source.slice(start, end);
}

const serviceSection = methodBody('renderConnectionInfoSection', 'renderRuntimeEnabledSetting');
const endpointSetting = methodBody('renderEndpointSetting', 'renderViewRefreshSection');
const advancedSection = methodBody('renderAdvancedMaintenanceSection', 'renderPortSetting');
const definitionsStart = source.indexOf('getSettingDefinitions(): SettingRenderDefinitionCompat[]');
const definitionsEnd = source.indexOf('private mountSettings', definitionsStart);
assert.ok(definitionsStart >= 0 && definitionsEnd > definitionsStart);
const definitions = source.slice(definitionsStart, definitionsEnd);

assert.ok(serviceSection.includes('renderRuntimeEnabledSetting'));
assert.ok(serviceSection.includes('renderEndpointSetting'));
assert.ok(serviceSection.includes('snapshot.runtimeStatus.accessProtected'));
assert.equal(serviceSection.includes('renderAccessProtectionSetting'), false);
assert.equal(source.includes('private renderAccessProtectionSetting'), false);
assert.ok(serviceSection.includes('renderCapabilitiesSetting'));
assert.equal(serviceSection.includes('renderObservedAiToolsSetting'), false);
assert.equal(serviceSection.includes('renderConnectAiToolSetting'), false);
assert.equal(serviceSection.includes('renderPortSetting'), false);

assert.ok(source.includes("ui('本机访问已保护', 'Local access protected')"));
assert.ok(source.includes("ui('MCP 端点', 'MCP endpoint')"));
assert.ok(endpointSetting.includes("ui('全部 Agent 访问', 'All Agent access')"));
assert.ok(endpointSetting.includes('tracekeeper-settings-endpoint-access'));
assert.ok(stylesSource.includes('.tracekeeper-settings-endpoint-access'));
assert.ok(source.includes("setIcon('copy')"));
assert.ok(source.includes("ui('复制 MCP 端点', 'Copy MCP endpoint')"));
assert.ok(source.includes("ui('高级选项', 'Advanced options')"));
assert.ok(endpointSetting.includes('tracekeeper-settings-endpoint-advanced'));
assert.equal(endpointSetting.includes('scrollIntoView'), false);
assert.ok(endpointSetting.includes('renderPortSetting'));
assert.ok(endpointSetting.includes("focus({ preventScroll: true })"));
assert.ok(endpointSetting.includes("setAttribute('aria-controls'"));
assert.ok(endpointSetting.includes('setting.settingEl.hide()'));
assert.ok(endpointSetting.includes('advancedSetting.settingEl.show()'));
assert.equal(endpointSetting.includes('settingEl.hidden'), false);
assert.ok(source.includes("ui('端口号', 'Port')"));
assert.ok(source.includes('DEFAULT_MCP_PORT'));
assert.ok(source.includes('restartMcpRuntime'));
assert.ok(source.includes("ui('应用并重启', 'Apply and restart')"));
assert.ok(source.includes("ui('查看功能', 'View capabilities')"));
assert.ok(source.includes('runtimeStatus.accessProtected'));
assert.equal(source.includes('runtimeAccessToken'), false);
assert.equal(source.includes('credentialCount'), false);

assert.ok(modalSource.includes('const subtitle = `${title} · ${riskLabel}`;'));
assert.ok(modalSource.includes('const accessibleLabel = `${definition.name}\\n${subtitle}\\n${description}`;'));
assert.ok(modalSource.includes("cls: 'tracekeeper-capability-row__tool'"));
assert.ok(modalSource.includes("cls: 'tracekeeper-capability-row__subtitle'"));
const toolNodeIndex = modalSource.indexOf("body.createEl('code'");
const subtitleNodeIndex = modalSource.indexOf("body.createEl('small'");
assert.ok(toolNodeIndex >= 0 && subtitleNodeIndex > toolNodeIndex);
assert.equal(modalSource.includes('tracekeeper-capability-row__heading'), false);
assert.ok(modalSource.includes('Human review must happen in Obsidian'));
assert.ok(modalSource.includes('public MCP tool after a dry-run'));
assert.ok(modalSource.includes('short-lived confirmation token'));
assert.ok(modalSource.includes('explicitly approved Wiki/MemoryRecord'));
assert.equal(modalSource.includes('Human review and confirmed writeback remain in Obsidian'), false);
assert.ok(stylesSource.includes('.tracekeeper-capability-row__tool'));
assert.ok(stylesSource.includes('.tracekeeper-capability-row__subtitle'));
assert.equal(stylesSource.includes('.tracekeeper-capability-row__heading'), false);

assert.ok(source.includes("import { App, Menu, Notice, PluginSettingTab, Setting, SettingGroup } from 'obsidian';"));
assert.ok(source.includes('display(): void {\n\t\tthis.mountSettings(this.containerEl);'));
assert.ok(definitions.includes("name: ui('Tracekeeper 设置', 'Tracekeeper settings')"));
assert.ok(definitions.includes('aliases: [...SETTING_SEARCH_ALIASES]'));
assert.equal((definitions.match(/\brender:/g) ?? []).length, 1);
assert.ok(definitions.includes('this.mountSettings(setting.settingEl)'));
assert.ok(definitions.includes('this.unmountSettings(setting.settingEl)'));
assert.equal(definitions.includes('loadAgentConnectionsSnapshot'), false);
assert.equal(definitions.includes('await '), false);
assert.ok(source.includes('const declarativeTab = this as DeclarativeSettingTabCompat'));
assert.ok(source.includes('declarativeTab.update();'));
assert.ok(source.includes('void this.renderSettings();'));
assert.ok(advancedSection.includes("this.createGroup(container, ui('高级维护', 'Advanced maintenance'))"));
assert.ok(advancedSection.includes('group.addSetting'));
assert.equal(advancedSection.includes("createEl('details'"), false);
assert.equal(advancedSection.includes("createEl('summary'"), false);
assert.equal(stylesSource.includes('.tracekeeper-settings-section'), false);
assert.equal(stylesSource.includes('.tracekeeper-settings-advanced'), false);
assert.equal(advancedSection.includes('renderPortSetting'), false);
assert.ok(advancedSection.includes("ui('重启服务', 'Restart service')"));
assert.ok(advancedSection.includes("ui('撤销全部 Agent 访问', 'Revoke all Agent access')"));
assert.equal(advancedSection.includes("ui('Agent 活动', 'Agent activity')"), false);
assert.equal(advancedSection.includes("ui('召回预览', 'Recall preview')"), false);
assert.equal(advancedSection.includes('TRACEKEEPER_ACTIVITY_VIEW'), false);
assert.equal(pluginManifest.minAppVersion, '1.11.0');
assert.equal(rootManifest.minAppVersion, '1.11.0');
assert.equal(resolveMinimumAppVersion(versions, pluginManifest.version), '1.11.0');

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 77 })}\n`);
