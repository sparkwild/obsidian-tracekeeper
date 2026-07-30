#!/usr/bin/env node
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-local-trust-settings-test-'));
const output = path.join(tempRoot, 'local-trust-settings.bundle.mjs');

try {
	await build({
		entryPoints: [path.resolve('src/features/settings/local-trust-settings.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});

	const settings = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const stableToken = Buffer.alloc(32, 0x5a).toString('base64url');
	const replacementToken = Buffer.alloc(32, 0xa5).toString('base64url');
	const generatedToken = settings.generateRuntimeAccessToken();

	assert.match(generatedToken, /^[A-Za-z0-9_-]{43}$/);
	assert.equal(Buffer.from(generatedToken, 'base64url').byteLength, 32);
	assert.equal(settings.isRuntimeAccessToken(generatedToken), true);
	assert.equal(settings.isRuntimeAccessToken(`${generatedToken}=`), false);
	assert.equal(settings.isRuntimeAccessToken('too-short'), false);

	const newInstall = settings.normalizeLocalTrustSettings({
		runtimeEnabled: true,
		customSetting: 'preserved',
	}, () => stableToken);
	assert.equal(newInstall.runtimeAccessToken, stableToken);
	assert.equal(newInstall.customSetting, 'preserved');

	const restarted = settings.normalizeLocalTrustSettings(newInstall, () => {
		throw new Error('stable token should not be regenerated');
	});
	assert.equal(restarted.runtimeAccessToken, stableToken);

	const invalidCurrent = settings.normalizeLocalTrustSettings({
		runtimeAccessToken: 'invalid-current-secret',
	}, () => replacementToken);
	assert.equal(invalidCurrent.runtimeAccessToken, replacementToken);

	const sanitized = settings.stripLegacyConnectionSettings({
		runtimeEnabled: true,
		runtimePort: 58437,
		runtimeToken: stableToken,
		runtimeTokenCreatedAt: '2026-07-01T00:00:00.000Z',
		runtimeCredentials: [
			{
				clientId: 'codex',
				token: 'legacy-client-secret',
				capabilityProfile: 'knowledge-assistant',
			},
		],
		customSetting: 'preserved',
	});

	assert.deepEqual(sanitized, {
		runtimeEnabled: true,
		runtimePort: 58437,
		customSetting: 'preserved',
	});
	assert.equal(JSON.stringify(sanitized).includes(stableToken), false);
	assert.equal(JSON.stringify(sanitized).includes('legacy-client-secret'), false);
	assert.deepEqual(settings.stripLegacyConnectionSettings(null), {});
	assert.deepEqual(settings.stripLegacyConnectionSettings([]), {});

	const upgraded = settings.normalizeLocalTrustSettings({
		runtimeToken: stableToken,
		runtimeCredentials: [{ token: 'legacy-client-secret' }],
	}, () => replacementToken);
	assert.equal(upgraded.runtimeAccessToken, replacementToken);
	assert.equal(JSON.stringify(upgraded).includes(stableToken), false);
	assert.equal(JSON.stringify(upgraded).includes('legacy-client-secret'), false);

	const mainSource = fs.readFileSync(path.resolve('src/main.ts'), 'utf8');
	assert.match(mainSource, /normalizeLocalTrustSettings\(raw\)/);
	assert.match(mainSource, /saveData\(stripLegacyConnectionSettings\(this\.settings\)\)/);
	assert.match(mainSource, /runtimeAccessToken:\s*string/);
	assert.match(mainSource, /serviceToken:\s*this\.settings\.runtimeAccessToken/);
	assert.match(mainSource, /getSharedBearerToken:\s*\(\)\s*=>\s*this\.settings\.runtimeAccessToken/);
	assert.match(mainSource, /issueAgentPairingTicket\(clientId:\s*string\)/);
	assert.match(mainSource, /getAgentPairingTicketStatus\(id:\s*string\)/);
	assert.match(mainSource, /buildGeneratedClientSetup\(profile,\s*this\.getMcpConnectionUrl\(\)\)/);
	assert.doesNotMatch(mainSource, /readClientConfigStatus\(/);
	assert.doesNotMatch(mainSource, /buildClientConfigTexts\(\s*profile,\s*this\.getMcpConnectionUrl\(\)/);
	assert.match(mainSource, /accessProtected:\s*isRuntimeAccessToken\(this\.settings\.runtimeAccessToken\)/);
	assert.doesNotMatch(mainSource, /runtimeToken\s*[?:]/);
	assert.doesNotMatch(mainSource, /runtimeCredentials\s*[?:]/);
	assert.doesNotMatch(mainSource, /regenerateRuntimeToken|rotateRuntimeCredential|setRuntimeCredentialProfile/);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 30 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
