#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/features/settings/tracekeeper-setting-tab.ts', 'utf8');

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

assert.ok(advancedSection.includes("createEl('details'"));
assert.ok(advancedSection.includes("createEl('summary'"));
assert.ok(advancedSection.includes('renderPortSetting'));
assert.ok(advancedSection.includes("ui('重启服务', 'Restart service')"));
assert.ok(advancedSection.includes("ui('重置访问凭据', 'Reset access credential')"));
assert.ok(advancedSection.includes('TRACEKEEPER_RUNTIME_LOG_VIEW'));

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 20 })}\n`);
