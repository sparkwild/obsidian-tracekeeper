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
	assert.equal(profiles.length, 8);
	assert.deepEqual(
		profiles.map((profile) => profile.id),
		['codex', 'claude-code', 'claude-desktop', 'cursor', 'gemini', 'grok', 'zcode', 'custom']
	);
	const profileById = (id) => profiles.find((profile) => profile.id === id);
	assert.equal(profileById('codex').targetPath, '/home/test-user/.codex/config.toml');
	assert.equal(profileById('claude-desktop').targetPath, '/home/test-user/Library/Application Support/Claude/claude_desktop_config.json');
	assert.equal(profileById('claude-desktop').supportsAutoConfigure, true);
	assert.equal(profileById('gemini').targetPath, '/home/test-user/.gemini/settings.json');
	assert.equal(profileById('grok').targetPath, '/home/test-user/.grok/config.toml');
	assert.equal(profileById('zcode').targetPath, '/home/test-user/.zcode/cli/config.json');

	const noHomeProfiles = config.buildClientProfiles(undefined, (zh, en) => en, (...parts) => parts.join('/'));
	assert.equal(noHomeProfiles[0].supportsAutoConfigure, false);
	assert.equal(noHomeProfiles[0].targetPath, undefined);
	assert.equal(noHomeProfiles.find((profile) => profile.id === 'gemini').supportsAutoConfigure, false);
	assert.equal(noHomeProfiles.find((profile) => profile.id === 'grok').supportsAutoConfigure, false);
	assert.equal(noHomeProfiles.find((profile) => profile.id === 'zcode').supportsAutoConfigure, false);

	const codexProfile = profileById('codex');
	const mcpProfile = profileById('claude-code');
	const cursorProfile = profileById('cursor');
	const geminiProfile = profileById('gemini');
	const grokProfile = profileById('grok');
	const zcodeProfile = profileById('zcode');
	const configTextUrl = 'http://127.0.0.1:58437/mcp';
	const accessToken = 'A'.repeat(43);
	const previousAccessToken = 'B'.repeat(43);
	const authorization = `Bearer ${accessToken}`;
	const localize = (_zh, en) => en;

	const codexTexts = config.buildClientConfigTexts(codexProfile, configTextUrl, accessToken);
	assert.equal(codexTexts.completeConfigText, [
		'[mcp_servers.tracekeeper]',
		'url = "http://127.0.0.1:58437/mcp"',
		'http_headers.Authorization = "Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"',
	].join('\n'));
	assert.equal(codexTexts.completeConfigText.includes(accessToken), true);
	assert.equal(codexTexts.redactedConfigText.includes(accessToken), false);
	assert.equal(codexTexts.redactedConfigText.includes('Bearer <redacted>'), true);
	assert.equal(codexTexts.completeConfigText.includes('?token='), false);

	const mcpTexts = config.buildClientConfigTexts(mcpProfile, configTextUrl, accessToken);
	const completeMcp = JSON.parse(mcpTexts.completeConfigText);
	const redactedMcp = JSON.parse(mcpTexts.redactedConfigText);
	assert.equal(completeMcp.mcpServers.tracekeeper.url, configTextUrl);
	assert.equal(completeMcp.mcpServers.tracekeeper.headers.Authorization, authorization);
	assert.equal(redactedMcp.mcpServers.tracekeeper.headers.Authorization, 'Bearer <redacted>');
	assert.equal(mcpTexts.redactedConfigText.includes(accessToken), false);

	const copyOnlyTexts = config.buildClientConfigTexts(cursorProfile, configTextUrl, accessToken);
	assert.equal(JSON.parse(copyOnlyTexts.completeConfigText).mcpServers.tracekeeper.headers.Authorization, authorization);

	const geminiTexts = config.buildClientConfigTexts(geminiProfile, configTextUrl, accessToken);
	const completeGemini = JSON.parse(geminiTexts.completeConfigText);
	assert.equal(completeGemini.mcpServers.tracekeeper.httpUrl, configTextUrl);
	assert.equal(completeGemini.mcpServers.tracekeeper.url, undefined);
	assert.equal(completeGemini.mcpServers.tracekeeper.headers.Authorization, authorization);
	assert.equal(geminiTexts.redactedConfigText.includes(accessToken), false);

	const grokTexts = config.buildClientConfigTexts(grokProfile, configTextUrl, accessToken);
	assert.equal(grokTexts.completeConfigText, [
		'[mcp_servers.tracekeeper]',
		'url = "http://127.0.0.1:58437/mcp"',
		'headers = { "Authorization" = "Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }',
	].join('\n'));
	assert.equal(grokTexts.redactedConfigText.includes(accessToken), false);

	const zcodeTexts = config.buildClientConfigTexts(zcodeProfile, configTextUrl, accessToken);
	const completeZcode = JSON.parse(zcodeTexts.completeConfigText);
	assert.equal(completeZcode.mcpServers.tracekeeper.type, 'http');
	assert.equal(completeZcode.mcpServers.tracekeeper.url, configTextUrl);
	assert.equal(completeZcode.mcpServers.tracekeeper.headers.Authorization, authorization);
	assert.equal(zcodeTexts.redactedConfigText.includes(accessToken), false);

	assert.equal(
		config.detectClientConfigStatus(codexProfile, '', configTextUrl, accessToken, localize).state,
		'not_configured'
	);
	assert.equal(
		config.detectClientConfigStatus(
			codexProfile,
			'[mcp_servers.tracekeeper]\ncommand = "npx"\n',
			configTextUrl,
			accessToken,
			localize
		).state,
		'needs_update'
	);
	assert.equal(
		config.detectClientConfigStatus(
			codexProfile,
			codexTexts.completeConfigText,
			configTextUrl,
			accessToken,
			localize
		).state,
		'configured'
	);
	const queryTokenStatus = config.detectClientConfigStatus(
		codexProfile,
		`[mcp_servers.tracekeeper]\nurl = "${configTextUrl}?token=retired-query-secret"\nhttp_headers.Authorization = ${JSON.stringify(authorization)}\n`,
		configTextUrl,
		accessToken,
		localize
	);
	assert.equal(queryTokenStatus.state, 'needs_update');
	assert.match(queryTokenStatus.detail, /query credential/);
	assert.equal(queryTokenStatus.detail.includes('retired-query-secret'), false);

	const urlOnlyStatus = config.detectClientConfigStatus(
		codexProfile,
		`[mcp_servers.tracekeeper]\nurl = ${JSON.stringify(configTextUrl)}\n`,
		configTextUrl,
		accessToken,
		localize
	);
	assert.equal(urlOnlyStatus.state, 'needs_update');
	assert.match(urlOnlyStatus.detail, /missing the required access header/);

	const oldBearerStatus = config.detectClientConfigStatus(
		codexProfile,
		`[mcp_servers.tracekeeper]\nurl = ${JSON.stringify(configTextUrl)}\nhttp_headers.Authorization = ${JSON.stringify(`Bearer ${previousAccessToken}`)}\n`,
		configTextUrl,
		accessToken,
		localize
	);
	assert.equal(oldBearerStatus.state, 'needs_update');
	assert.match(oldBearerStatus.detail, /no longer matches/);
	assert.equal(oldBearerStatus.detail.includes(previousAccessToken), false);

	const endpointDriftStatus = config.detectClientConfigStatus(
		codexProfile,
		`[mcp_servers.tracekeeper]\nurl = "http://127.0.0.1:58438/mcp"\nhttp_headers.Authorization = ${JSON.stringify(authorization)}\n`,
		configTextUrl,
		accessToken,
		localize
	);
	assert.equal(endpointDriftStatus.state, 'needs_update');
	assert.match(endpointDriftStatus.detail, /URL differs/);

	const generatedCodex = {
		...codexProfile,
		clientId: codexProfile.id,
		displayName: codexProfile.displayName,
		description: codexProfile.description,
		transport: codexProfile.preferredTransport,
		...codexTexts,
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
		'[mcp_servers.tracekeeper]\nurl = "http://old"\n\n[mcp_servers.tracekeeper.http_headers]\nAuthorization = "Bearer retired"\n\n[mcp_servers.other]\nurl = "http://other"\n',
		configTextUrl,
		accessToken
	);
	assert.equal(mergedCodexContent.includes('url = "http://old"'), false);
	assert.equal(mergedCodexContent.includes('url = "http://127.0.0.1:58437/mcp"'), true);
	assert.equal(mergedCodexContent.includes(authorization), true);
	assert.equal(mergedCodexContent.includes('Bearer retired'), false);
	assert.equal(mergedCodexContent.includes('[mcp_servers.other]'), true);
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
		...mcpTexts,
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
		configTextUrl,
		accessToken
	);
	const parsedMerged = config.parseMcpJsonConfig(mergedJson);
	assert.equal(parsedMerged.mcpServers.tracekeeper.url, configTextUrl);
	assert.equal(parsedMerged.mcpServers.tracekeeper.headers.Authorization, authorization);
	assert.equal(parsedMerged.mcpServers.other.url, 'ws://example.com');
	const legacyJsonStatus = config.detectClientConfigStatus(
		mcpProfile,
		JSON.stringify({
			mcpServers: {
				tracekeeper: {
					url: 'http://127.0.0.1:58437/mcp',
					headers: { Authorization: `Bearer ${previousAccessToken}` },
				},
			},
		}),
		configTextUrl,
		accessToken,
		localize
	);
	assert.equal(legacyJsonStatus.state, 'needs_update');
	assert.match(legacyJsonStatus.detail, /no longer matches/);
	assert.equal(legacyJsonStatus.detail.includes(previousAccessToken), false);
	assert.equal(
		config.detectClientConfigStatus(
			mcpProfile,
			mcpTexts.completeConfigText,
			configTextUrl,
			accessToken,
			localize
		).state,
		'configured'
	);
	assert.match(
		config.detectClientConfigStatus(
			mcpProfile,
			JSON.stringify({ mcpServers: { tracekeeper: { url: configTextUrl } } }),
			configTextUrl,
			accessToken,
			localize
		).detail,
		/missing the required access header/
	);
	const removedJson = config.removeClientConfigContent(generatedMcp, mergedJson);
	assert.equal(removedJson.includes('tracekeeper'), false);

	const generatedGemini = {
		...geminiProfile,
		clientId: geminiProfile.id,
		transport: geminiProfile.preferredTransport,
		...geminiTexts,
		targetPath: '/tmp/tracekeeper-gemini.json',
		configState: 'not_configured',
		configStatusLabel: '',
		configStatusDetail: '',
	};
	assert.equal(
		config.detectClientConfigStatus(
			geminiProfile,
			geminiTexts.completeConfigText,
			configTextUrl,
			accessToken,
			localize
		).state,
		'configured'
	);
	assert.equal(
		config.detectClientConfigStatus(
			geminiProfile,
			JSON.stringify({
				mcpServers: {
					tracekeeper: {
						url: configTextUrl,
						headers: { Authorization: authorization },
					},
				},
			}),
			configTextUrl,
			accessToken,
			localize
		).state,
		'needs_update'
	);
	const mergedGemini = config.mergeClientConfigContent(
		generatedGemini,
		JSON.stringify({ theme: 'dark', mcpServers: { other: { httpUrl: 'https://example.test/mcp' } } }),
		configTextUrl,
		accessToken
	);
	const parsedGemini = config.parseMcpJsonConfig(mergedGemini);
	assert.equal(parsedGemini.theme, 'dark');
	assert.equal(parsedGemini.mcpServers.other.httpUrl, 'https://example.test/mcp');
	assert.equal(parsedGemini.mcpServers.tracekeeper.httpUrl, configTextUrl);
	assert.equal(parsedGemini.mcpServers.tracekeeper.headers.Authorization, authorization);
	assert.equal(
		config.removeClientConfigContent(generatedGemini, mergedGemini).includes('"tracekeeper"'),
		false
	);

	const generatedGrok = {
		...grokProfile,
		clientId: grokProfile.id,
		transport: grokProfile.preferredTransport,
		...grokTexts,
		targetPath: '/tmp/tracekeeper-grok.toml',
		configState: 'not_configured',
		configStatusLabel: '',
		configStatusDetail: '',
	};
	assert.equal(
		config.detectClientConfigStatus(
			grokProfile,
			grokTexts.completeConfigText,
			configTextUrl,
			accessToken,
			localize
		).state,
		'configured'
	);
	assert.equal(
		config.detectClientConfigStatus(
			grokProfile,
			`${grokTexts.completeConfigText}\nenabled = false\n`,
			configTextUrl,
			accessToken,
			localize
		).state,
		'needs_update'
	);
	const mergedGrok = config.mergeClientConfigContent(
		generatedGrok,
		'[mcp_servers.other]\nurl = "https://example.test/mcp"\n\n[mcp_servers.tracekeeper]\nurl = "http://old"\nheaders = { "Authorization" = "Bearer old" }\n',
		configTextUrl,
		accessToken
	);
	assert.equal(mergedGrok.includes('[mcp_servers.other]'), true);
	assert.equal(mergedGrok.includes('http://old'), false);
	assert.equal(mergedGrok.includes(authorization), true);
	assert.equal(
		config.removeClientConfigContent(generatedGrok, mergedGrok).includes('[mcp_servers.tracekeeper]'),
		false
	);

	const generatedZcode = {
		...zcodeProfile,
		clientId: zcodeProfile.id,
		transport: zcodeProfile.preferredTransport,
		...zcodeTexts,
		targetPath: '/tmp/tracekeeper-zcode.json',
		configState: 'not_configured',
		configStatusLabel: '',
		configStatusDetail: '',
	};
	assert.equal(
		config.detectClientConfigStatus(
			zcodeProfile,
			zcodeTexts.completeConfigText,
			configTextUrl,
			accessToken,
			localize
		).state,
		'configured'
	);
	assert.equal(
		config.detectClientConfigStatus(
			zcodeProfile,
			JSON.stringify({
				mcp: {
					servers: {
						tracekeeper: {
							type: 'sse',
							url: configTextUrl,
							headers: { Authorization: authorization },
						},
					},
				},
			}),
			configTextUrl,
			accessToken,
			localize
		).state,
		'needs_update'
	);
	const mergedZcode = config.mergeClientConfigContent(
		generatedZcode,
		JSON.stringify({
			editor: { fontSize: 14 },
			mcp: { timeout: 30, servers: { other: { type: 'http', url: 'https://example.test/mcp' } } },
		}),
		configTextUrl,
		accessToken
	);
	const parsedZcode = config.parseZcodeJsonConfig(mergedZcode);
	assert.equal(parsedZcode.editor.fontSize, 14);
	assert.equal(parsedZcode.mcp.timeout, 30);
	assert.equal(parsedZcode.mcp.servers.other.url, 'https://example.test/mcp');
	assert.equal(parsedZcode.mcp.servers.tracekeeper.type, 'http');
	assert.equal(parsedZcode.mcp.servers.tracekeeper.headers.Authorization, authorization);
	const removedZcode = config.parseZcodeJsonConfig(
		config.removeClientConfigContent(generatedZcode, mergedZcode)
	);
	assert.equal(removedZcode.mcp.servers.tracekeeper, undefined);
	assert.equal(removedZcode.mcp.servers.other.url, 'https://example.test/mcp');

	assert.equal(config.detectClientConfigStatus(cursorProfile, '', configTextUrl, accessToken, localize).state, 'not_configured');
	assert.equal(config.clientConfigStatusClass('configured'), 'tracekeeper-badge--success');
	assert.equal(config.clientConfigStatusClass('needs_update'), 'tracekeeper-badge--warning');
	assert.equal(config.clientConfigStatusClass('not_configured'), 'tracekeeper-badge--muted');

	assert.throws(() => config.parseMcpJsonConfig('not-json'), /Client config must be a JSON object/);
	assert.throws(() => config.mergeClientConfigContent({ ...generatedCodex, configFormat: 'copy-only' }, ''));

	const modalSource = fs.readFileSync(path.resolve('src/features/client-config/client-config-modals.ts'), 'utf8');
	const settingsSource = fs.readFileSync(path.resolve('src/features/settings/tracekeeper-setting-tab.ts'), 'utf8');
	assert.match(modalSource, /text:\s*this\.config\.redactedConfigText/);
	assert.match(modalSource, /this\.config\.completeConfigText/);
	assert.match(modalSource, /clipboard will contain a local access credential/i);
	assert.match(settingsSource, /new ConnectAiToolModal\(/);
	assert.match(modalSource, /new ClientConfigCopyModal\(this\.app, this\.plugin, config\)\.open\(\)/);
	assert.doesNotMatch(settingsSource, /copyToClipboard\(config\.completeConfigText/);
	assert.doesNotMatch(settingsSource, /copyToClipboard\(\s*connectionUrl/);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 89 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
