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
assert.ok(advancedSection.includes('renderPortSetting'));
assert.ok(advancedSection.includes("ui('重启服务', 'Restart service')"));
assert.ok(advancedSection.includes("ui('重置访问凭据', 'Reset access credential')"));
assert.ok(advancedSection.includes('TRACEKEEPER_RUNTIME_LOG_VIEW'));

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 29 })}\n`);
