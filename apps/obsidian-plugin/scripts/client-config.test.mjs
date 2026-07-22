#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-client-config-test-'));
const output = path.join(tempRoot, 'client-config.bundle.mjs');

try {
	await build({
		entryPoints: [path.resolve('src/features/client-config/client-config.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});

	const config = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

	const profiles = config.buildClientProfiles('/home/test-user', (zh, en) => en, (...parts) => parts.join('/'));
	assert.equal(profiles.length, 5);
	assert.equal(profiles[0].id, 'codex');
	assert.equal(profiles[0].targetPath, '/home/test-user/.codex/config.toml');
	assert.equal(profiles[2].id, 'claude-desktop');
	assert.equal(profiles[2].targetPath, '/home/test-user/Library/Application Support/Claude/claude_desktop_config.json');
	assert.equal(profiles[2].supportsAutoConfigure, true);

	const noHomeProfiles = config.buildClientProfiles(undefined, (zh, en) => en, (...parts) => parts.join('/'));
	assert.equal(noHomeProfiles[0].supportsAutoConfigure, false);
	assert.equal(noHomeProfiles[0].targetPath, undefined);

	const codexProfile = profiles[0];
	const mcpProfile = profiles[1];
	const cursorProfile = profiles[3];
	const configTextUrl = 'http://localhost:58437/mcp?token=abc';

	assert.equal(
		config.buildClientConfigText(codexProfile, () => configTextUrl),
		'[mcp_servers.tracekeeper]\nurl = "http://localhost:58437/mcp?token=abc"'
	);
	assert.equal(
		JSON.parse(config.buildClientConfigText(mcpProfile, () => configTextUrl)).mcpServers.tracekeeper.url,
		configTextUrl
	);

	assert.equal(
		config.detectClientConfigStatus(codexProfile, '', configTextUrl, (zh, en) => en).state,
		'not_configured'
	);
	assert.equal(
		config.detectClientConfigStatus(codexProfile, '[mcp_servers.tracekeeper]\ncommand = "npx"\n', configTextUrl, (zh, en) => en).state,
		'needs_update'
	);
	assert.equal(
		config.detectClientConfigStatus(
			codexProfile,
			'[mcp_servers.tracekeeper]\nurl = "http://localhost:58437/mcp?token=abc"\n',
			configTextUrl,
			(zh, en) => en
		).state,
		'configured'
	);

	const generatedCodex = {
		...codexProfile,
		clientId: codexProfile.id,
		displayName: codexProfile.displayName,
		description: codexProfile.description,
		transport: codexProfile.preferredTransport,
		configText: config.buildClientConfigText(codexProfile, () => configTextUrl),
		supportsAutoConfigure: codexProfile.supportsAutoConfigure,
		restartRequired: codexProfile.restartRequired,
		configFormat: codexProfile.configFormat,
		targetPath: '/tmp/tracekeeper-codex.toml',
		configState: 'not_configured',
		configStatusLabel: '',
		configStatusDetail: '',
	};
	const mergedCodexContent = config.mergeClientConfigContent(
		generatedCodex,
		'[mcp_servers.tracekeeper]\nurl = "http://old"\nfoo = "keep"\n',
		() => configTextUrl
	);
	assert.equal(mergedCodexContent.includes('url = "http://old"'), false);
	assert.equal(mergedCodexContent.includes('url = "http://localhost:58437/mcp?token=abc"'), true);
	assert.equal(
		config.removeClientConfigContent(generatedCodex, mergedCodexContent).includes('[mcp_servers.tracekeeper]'),
		false
	);

	const generatedMcp = {
		...mcpProfile,
		clientId: mcpProfile.id,
		displayName: mcpProfile.displayName,
		description: mcpProfile.description,
		transport: mcpProfile.preferredTransport,
		configText: config.buildClientConfigText(mcpProfile, () => configTextUrl),
		supportsAutoConfigure: mcpProfile.supportsAutoConfigure,
		restartRequired: mcpProfile.restartRequired,
		configFormat: mcpProfile.configFormat,
		targetPath: '/tmp/tracekeeper-mcp.json',
		configState: 'not_configured',
		configStatusLabel: '',
		configStatusDetail: '',
	};
	const mergedJson = config.mergeClientConfigContent(
		generatedMcp,
		JSON.stringify({ mcpServers: { other: { url: 'ws://example.com' } } }, null, 2),
		() => configTextUrl
	);
	const parsedMerged = config.parseMcpJsonConfig(mergedJson);
	assert.equal(parsedMerged.mcpServers.tracekeeper.url, configTextUrl);
	assert.equal(parsedMerged.mcpServers.other.url, 'ws://example.com');
	const removedJson = config.removeClientConfigContent(generatedMcp, mergedJson);
	assert.equal(removedJson.includes('tracekeeper'), false);
	assert.equal(config.detectClientConfigStatus(cursorProfile, '', configTextUrl, (zh, en) => en).state, 'not_configured');
	assert.equal(config.clientConfigStatusClass('configured'), 'tracekeeper-badge--success');
	assert.equal(config.clientConfigStatusClass('needs_update'), 'tracekeeper-badge--warning');
	assert.equal(config.clientConfigStatusClass('not_configured'), 'tracekeeper-badge--muted');

	assert.throws(() => config.parseMcpJsonConfig('not-json'), /Client config must be a JSON object/);
	assert.throws(() => config.mergeClientConfigContent({ ...generatedCodex, configFormat: 'copy-only' }, ''));

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 22 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
