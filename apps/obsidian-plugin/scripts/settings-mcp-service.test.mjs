#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/features/settings/tracekeeper-setting-tab.ts', 'utf8');
const modalSource = fs.readFileSync('src/features/runtime/mcp-capabilities-modal.ts', 'utf8');
const stylesSource = fs.readFileSync('styles.css', 'utf8');

function methodBody(name, nextName) {
	const start = source.indexOf(`private ${name}`);
	const end = source.indexOf(`private ${nextName}`, start + 1);
	assert.ok(start >= 0, `${name} must exist`);
	assert.ok(end > start, `${nextName} must follow ${name}`);
	return source.slice(start, end);
}

const serviceSection = methodBody('renderConnectionInfoSection', 'renderRuntimeEnabledSetting');
const endpointSetting = methodBody('renderEndpointSetting', 'renderAccessProtectionSetting');
const advancedSection = methodBody('renderAdvancedMaintenanceSection', 'renderPortSetting');

assert.ok(serviceSection.includes('renderRuntimeEnabledSetting'));
assert.ok(serviceSection.includes('renderEndpointSetting'));
assert.ok(serviceSection.includes('renderAccessProtectionSetting'));
assert.ok(serviceSection.includes('renderCapabilitiesSetting'));
assert.equal(serviceSection.includes('renderObservedAiToolsSetting'), false);
assert.equal(serviceSection.includes('renderConnectAiToolSetting'), false);
assert.equal(serviceSection.includes('renderPortSetting'), false);

assert.ok(source.includes("ui('本机访问已保护', 'Local access protected')"));
assert.ok(source.includes("ui('MCP 端点', 'MCP endpoint')"));
assert.ok(source.includes("setIcon('copy')"));
assert.ok(source.includes("ui('复制 MCP 端点', 'Copy MCP endpoint')"));
assert.ok(source.includes("ui('高级选项', 'Advanced options')"));
assert.ok(source.includes("tracekeeper-settings-advanced"));
assert.ok(endpointSetting.includes('tracekeeper-settings-endpoint-advanced'));
assert.equal(endpointSetting.includes('scrollIntoView'), false);
assert.ok(endpointSetting.includes('renderPortSetting'));
assert.ok(endpointSetting.includes("focus({ preventScroll: true })"));
assert.ok(endpointSetting.includes("setAttribute('aria-controls'"));
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
assert.ok(stylesSource.includes('.tracekeeper-capability-row__tool'));
assert.ok(stylesSource.includes('.tracekeeper-capability-row__subtitle'));
assert.equal(stylesSource.includes('.tracekeeper-capability-row__heading'), false);

assert.ok(advancedSection.includes("createEl('details'"));
assert.ok(advancedSection.includes("createEl('summary'"));
assert.equal(advancedSection.includes('renderPortSetting'), false);
assert.ok(advancedSection.includes("ui('重启服务', 'Restart service')"));
assert.ok(advancedSection.includes("ui('撤销全部 Agent 访问', 'Revoke all Agent access')"));
assert.ok(advancedSection.includes('TRACEKEEPER_ACTIVITY_VIEW'));

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 41 })}\n`);
