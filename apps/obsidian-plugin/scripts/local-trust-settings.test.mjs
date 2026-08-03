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
	const stableSecret = Buffer.alloc(32, 0x5a).toString('base64url');
	const replacementSecret = Buffer.alloc(32, 0xa5).toString('base64url');
	const generatedSecret = settings.generateRuntimeSecuritySecret();

	assert.match(generatedSecret, /^[A-Za-z0-9_-]{43}$/);
	assert.equal(Buffer.from(generatedSecret, 'base64url').byteLength, 32);
	assert.equal(settings.isRuntimeSecuritySecret(generatedSecret), true);
	assert.equal(settings.isRuntimeSecuritySecret(`${generatedSecret}=`), false);
	assert.equal(settings.isRuntimeSecuritySecret('too-short'), false);

	const newInstall = settings.normalizeLocalTrustSettings({
		runtimeEnabled: true,
		customSetting: 'preserved',
	}, () => stableSecret);
	assert.equal(newInstall.runtimeSecuritySecret, stableSecret);
	assert.deepEqual(newInstall.agentIntegrations, []);
	assert.equal(newInstall.customSetting, 'preserved');

	const restarted = settings.normalizeLocalTrustSettings(newInstall, () => {
		throw new Error('stable secret should not be regenerated');
	});
	assert.equal(restarted.runtimeSecuritySecret, stableSecret);

	const invalidCurrent = settings.normalizeLocalTrustSettings({
		runtimeAccessToken: 'invalid-current-secret',
	}, () => replacementSecret);
	assert.equal(invalidCurrent.runtimeSecuritySecret, replacementSecret);

	const sanitized = settings.stripLegacyConnectionSettings({
		runtimeEnabled: true,
		runtimePort: 58437,
		runtimeToken: stableSecret,
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
	assert.equal(JSON.stringify(sanitized).includes(stableSecret), false);
	assert.equal(JSON.stringify(sanitized).includes('legacy-client-secret'), false);
	assert.deepEqual(settings.stripLegacyConnectionSettings(null), {});
	assert.deepEqual(settings.stripLegacyConnectionSettings([]), {});

	const upgraded = settings.normalizeLocalTrustSettings({
		runtimeToken: stableSecret,
		runtimeCredentials: [{ token: 'legacy-client-secret' }],
	}, () => replacementSecret);
	assert.equal(upgraded.runtimeSecuritySecret, replacementSecret);
	assert.equal(upgraded.agentIntegrations.length, 0);
	assert.equal(JSON.stringify(upgraded).includes(stableSecret), false);
	assert.equal(JSON.stringify(upgraded).includes('legacy-client-secret'), false);

	const mainSource = fs.readFileSync(path.resolve('src/main.ts'), 'utf8');
	assert.match(mainSource, /normalizeLocalTrustSettings\(raw\)/);
	assert.match(mainSource, /saveData\(stripLegacyConnectionSettings\(this\.settings\)\)/);
	assert.match(mainSource, /runtimeSecuritySecret:\s*string/);
	assert.match(mainSource, /agentIntegrations:\s*AgentIntegrationRecord\[\]/);
	assert.match(mainSource, /getOAuthUiLocale:\s*\(\)\s*=>\s*\(isChineseLanguage\(getLanguage\(\)\)\s*\?\s*'zh-CN'\s*:\s*'en'\)/);
	assert.match(mainSource, /credentialVerifier:\s*\{/);
	assert.match(mainSource, /writebackConfirmationSecret:\s*this\.settings\.runtimeSecuritySecret/);
	assert.match(mainSource, /issueManualBearerCredential\(integrationId:\s*string\)/);
	assert.match(mainSource, /decideOAuthRequest\(requestId:\s*string/);
	assert.match(mainSource, /revokeAllAgentAccess\(\)/);
	assert.match(mainSource, /buildGeneratedClientSetup\(profile,\s*this\.getMcpConnectionUrl\(\)\)/);
	assert.doesNotMatch(mainSource, /readClientConfigStatus\(/);
	assert.doesNotMatch(mainSource, /buildClientConfigTexts\(\s*profile,\s*this\.getMcpConnectionUrl\(\)/);
	assert.match(mainSource, /accessProtected:\s*isRuntimeSecuritySecret\(this\.settings\.runtimeSecuritySecret\)/);
	assert.doesNotMatch(mainSource, /runtimeAccessToken\s*:/);
	assert.doesNotMatch(mainSource, /runtimeToken\s*[?:]/);
	assert.doesNotMatch(mainSource, /runtimeCredentials\s*[?:]/);
	assert.doesNotMatch(mainSource, /regenerateRuntimeToken|rotateRuntimeCredential|setRuntimeCredentialProfile/);
	assert.doesNotMatch(mainSource, /issueAgentPairingTicket|getAgentPairingTicketStatus|serviceToken|getSharedBearerToken|supportsLocalOAuth|markClientConfigured/);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 31 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
