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
	const localize = (_zh, en) => en;
	const endpoint = 'http://127.0.0.1:51601/mcp';
	const profiles = config.buildClientProfiles('/home/test', localize, path.join);

	assert.equal(profiles.length, 8);
	assert.deepEqual(profiles.map((profile) => profile.id), [
		'codex',
		'claude-code',
		'claude-desktop',
		'cursor',
		'gemini',
		'grok',
		'zcode',
		'custom',
	]);
	assert.equal(profiles.filter((profile) => profile.supportedAuthModes.includes('oauth')).length, 3);
	assert.equal(profiles.some((profile) => 'targetPath' in profile), false);
	assert.equal(profiles.some((profile) => 'supportsAutoConfigure' in profile), false);
	assert.equal(profiles.some((profile) => 'configFormat' in profile), false);

	const byId = (id) => profiles.find((profile) => profile.id === id);
	const codex = config.buildGeneratedClientSetup(byId('codex'), endpoint);
	assert.equal(codex.setupInstruction, `codex mcp add tracekeeper --url ${endpoint}`);
	assert.deepEqual(codex.supportedAuthModes, ['oauth', 'bearer']);
	assert.equal(codex.setupCapability, 'oauth-cli');
	assert.equal(codex.setupFollowup, undefined);
	assert.equal(codex.reauthorizationInstruction, 'codex mcp login tracekeeper --scopes mcp');

	const claude = config.buildGeneratedClientSetup(byId('claude-code'), endpoint);
	assert.equal(claude.setupInstruction, `claude mcp add --transport http --scope user tracekeeper ${endpoint}`);
	assert.deepEqual(claude.supportedAuthModes, ['oauth', 'bearer']);
	const gemini = config.buildGeneratedClientSetup(byId('gemini'), endpoint);
	assert.equal(gemini.setupInstruction, `gemini mcp add --transport http --scope user tracekeeper ${endpoint}`);
	assert.deepEqual(gemini.supportedAuthModes, ['oauth', 'bearer']);

	for (const id of ['claude-desktop', 'cursor', 'grok', 'zcode', 'custom']) {
		const setup = config.buildGeneratedClientSetup(byId(id), endpoint);
		assert.equal(setup.setupInstruction, endpoint);
		assert.deepEqual(setup.supportedAuthModes, ['bearer']);
	}

	const bearerToken = 'A'.repeat(43);
	const manualJson = config.buildManualMcpJsonConfig(endpoint, bearerToken);
	assert.equal(manualJson.includes('\n  "mcpServers"'), true);
	assert.deepEqual(JSON.parse(manualJson), {
		mcpServers: {
			tracekeeper: {
				type: 'http',
				url: endpoint,
				headers: { Authorization: `Bearer ${bearerToken}` },
			},
		},
	});
	for (const invalidToken of ['', 'short', 'B'.repeat(44), 'contains whitespace', 'line\nbreak']) {
		assert.throws(
			() => config.buildManualMcpJsonConfig(endpoint, invalidToken),
			/valid access credential/,
		);
	}

	for (const invalid of [
		'https://127.0.0.1:51601/mcp',
		'http://localhost:51601/mcp',
		'http://127.0.0.1:51601/other',
		'http://127.0.0.1/mcp',
		'http://user@127.0.0.1:51601/mcp',
		'http://127.0.0.1:51601/mcp?token=secret',
		'http://127.0.0.1:51601/mcp#fragment',
		'not-a-url',
	]) {
		assert.throws(
			() => config.buildGeneratedClientSetup(byId('custom'), invalid),
			/local MCP endpoint|exact local MCP endpoint/
		);
	}

	for (const removedExport of [
		'buildClientConfigTexts',
		'detectClientConfigStatus',
		'mergeClientConfigContent',
		'removeClientConfigContent',
		'parseMcpJsonConfig',
		'parseZcodeJsonConfig',
	]) {
		assert.equal(removedExport in config, false);
	}

	const mainSource = fs.readFileSync(path.resolve('src/main.ts'), 'utf8');
	for (const removedCapability of [
		'ClientConfigAdapter',
		'prepareClientConfigChange',
		'applyClientConfig',
		'removeClientConfig',
		'openClientConfigFile',
		'completeConfigText',
		'redactedConfigText',
	]) {
		assert.equal(mainSource.includes(removedCapability), false);
	}
	assert.doesNotMatch(mainSource, /configState:\s*'unavailable'/);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 54 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
