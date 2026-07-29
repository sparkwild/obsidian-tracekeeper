#!/usr/bin/env node
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-runtime-access-reset-test-'));
const controllerOutput = path.join(tempRoot, 'runtime-access-reset-controller.mjs');
const clientConfigOutput = path.join(tempRoot, 'client-config.mjs');

const previousToken = Buffer.alloc(32, 0x31).toString('base64url');
const replacementToken = Buffer.alloc(32, 0x32).toString('base64url');
const endpoint = 'http://127.0.0.1:58437/mcp';

function createHost({
	enabled = true,
	failSavingReplacement = false,
	failStartingReplacement = false,
} = {}) {
	let accessToken = previousToken;
	let persistedToken = previousToken;
	let runtimeToken = enabled ? previousToken : null;
	const sessions = new Set(enabled ? ['old-session'] : []);
	const events = [];
	let saveFailurePending = failSavingReplacement;
	let startFailurePending = failStartingReplacement;

	return {
		options: {
			getAccessToken: () => accessToken,
			setAccessToken: (value) => {
				events.push(`set:${value === previousToken ? 'previous' : 'replacement'}`);
				accessToken = value;
			},
			isRuntimeEnabled: () => enabled,
			stopRuntime: async () => {
				events.push('stop');
				runtimeToken = null;
				sessions.clear();
			},
			persistSettings: async () => {
				events.push(`save:${accessToken === previousToken ? 'previous' : 'replacement'}`);
				if (accessToken === replacementToken && saveFailurePending) {
					saveFailurePending = false;
					throw new Error(`save failed for ${replacementToken}`);
				}
				persistedToken = accessToken;
			},
			startRuntime: async () => {
				events.push(`start:${accessToken === previousToken ? 'previous' : 'replacement'}`);
				if (accessToken === replacementToken && startFailurePending) {
					startFailurePending = false;
					throw new Error(`start failed for ${replacementToken}`);
				}
				runtimeToken = accessToken;
			},
			createToken: () => replacementToken,
		},
		snapshot: () => ({
			accessToken,
			persistedToken,
			runtimeToken,
			sessions: [...sessions],
			events: [...events],
		}),
	};
}

const localize = (_zh, en) => en;
const codexProfile = {
	id: 'codex',
	displayName: 'Codex',
	description: '',
	preferredTransport: 'streamable-http',
	supportsAutoConfigure: true,
	restartRequired: true,
	configFormat: 'codex-toml',
	targetPath: '/tmp/config.toml',
};

try {
	await Promise.all([
		build({
			entryPoints: [path.resolve('src/features/runtime/runtime-access-reset-controller.ts')],
			outfile: controllerOutput,
			bundle: true,
			platform: 'node',
			format: 'esm',
			logLevel: 'silent',
		}),
		build({
			entryPoints: [path.resolve('src/features/client-config/client-config.ts')],
			outfile: clientConfigOutput,
			bundle: true,
			platform: 'node',
			format: 'esm',
			logLevel: 'silent',
		}),
	]);

	const reset = await import(`${pathToFileURL(controllerOutput).href}?test=${Date.now()}`);
	const clientConfig = await import(`${pathToFileURL(clientConfigOutput).href}?test=${Date.now()}`);

	const configuredWithPreviousToken = clientConfig.buildClientConfigTexts(
		codexProfile,
		endpoint,
		previousToken
	).completeConfigText;
	const successHost = createHost();
	const successController = new reset.RuntimeAccessResetController(successHost.options);
	const success = await successController.reset();
	assert.deepEqual(success, { runtimeRestarted: true });
	assert.deepEqual(successHost.snapshot(), {
		accessToken: replacementToken,
		persistedToken: replacementToken,
		runtimeToken: replacementToken,
		sessions: [],
		events: ['stop', 'set:replacement', 'save:replacement', 'start:replacement'],
	});
	assert.equal(
		clientConfig.detectClientConfigStatus(
			codexProfile,
			configuredWithPreviousToken,
			endpoint,
			replacementToken,
			localize
		).state,
		'needs_update'
	);
	assert.equal(JSON.stringify(success).includes(previousToken), false);
	assert.equal(JSON.stringify(success).includes(replacementToken), false);

	const disabledHost = createHost({ enabled: false });
	const disabledResult = await new reset.RuntimeAccessResetController(disabledHost.options).reset();
	assert.deepEqual(disabledResult, { runtimeRestarted: false });
	assert.deepEqual(disabledHost.snapshot().events, ['stop', 'set:replacement', 'save:replacement']);
	assert.equal(disabledHost.snapshot().runtimeToken, null);

	const saveFailureHost = createHost({ failSavingReplacement: true });
	await assert.rejects(
		() => new reset.RuntimeAccessResetController(saveFailureHost.options).reset(),
		(error) => {
			assert.equal(error instanceof reset.RuntimeAccessResetError, true);
			assert.equal(error.rollbackSucceeded, true);
			assert.equal(error.message.includes(previousToken), false);
			assert.equal(error.message.includes(replacementToken), false);
			return true;
		}
	);
	assert.deepEqual(saveFailureHost.snapshot(), {
		accessToken: previousToken,
		persistedToken: previousToken,
		runtimeToken: previousToken,
		sessions: [],
		events: [
			'stop',
			'set:replacement',
			'save:replacement',
			'stop',
			'set:previous',
			'save:previous',
			'start:previous',
		],
	});

	const startFailureHost = createHost({ failStartingReplacement: true });
	await assert.rejects(
		() => new reset.RuntimeAccessResetController(startFailureHost.options).reset(),
		(error) => {
			assert.equal(error instanceof reset.RuntimeAccessResetError, true);
			assert.equal(error.rollbackSucceeded, true);
			assert.equal(error.message.includes(previousToken), false);
			assert.equal(error.message.includes(replacementToken), false);
			return true;
		}
	);
	assert.deepEqual(startFailureHost.snapshot(), {
		accessToken: previousToken,
		persistedToken: previousToken,
		runtimeToken: previousToken,
		sessions: [],
		events: [
			'stop',
			'set:replacement',
			'save:replacement',
			'start:replacement',
			'stop',
			'set:previous',
			'save:previous',
			'start:previous',
		],
	});

	const generationFailureHost = createHost();
	generationFailureHost.options.createToken = () => {
		throw new Error(`generation failed near ${replacementToken}`);
	};
	await assert.rejects(
		() => new reset.RuntimeAccessResetController(generationFailureHost.options).reset(),
		(error) => {
			assert.equal(error instanceof reset.RuntimeAccessResetError, true);
			assert.equal(error.rollbackSucceeded, true);
			assert.equal(error.message.includes(replacementToken), false);
			return true;
		}
	);
	assert.deepEqual(generationFailureHost.snapshot().events, []);

	const mainSource = fs.readFileSync(path.resolve('src/main.ts'), 'utf8');
	const settingsSource = fs.readFileSync(
		path.resolve('src/features/settings/tracekeeper-setting-tab.ts'),
		'utf8'
	);
	const modalSource = fs.readFileSync(
		path.resolve('src/features/runtime/runtime-access-reset-modal.ts'),
		'utf8'
	);
	assert.match(mainSource, /resetRuntimeAccessCredential\(\)/);
	assert.match(mainSource, /runtimeAccessResetController\.reset\(\)/);
	assert.match(settingsSource, /RuntimeAccessResetModal/);
	assert.match(settingsSource, /重置访问凭据/);
	assert.match(settingsSource, /new RuntimeAccessResetModal\(this\.app, this\.plugin, \(\) =>/);
	assert.match(modalSource, /全部现有 MCP Session/);
	assert.match(modalSource, /不会自动改写客户端配置/);
	assert.doesNotMatch(modalSource, /runtimeAccessToken|completeConfigText|copyToClipboard/);

	process.stdout.write(`${JSON.stringify({
		result: 'pass',
		checks: [
			'successful-reset-restarts-runtime',
			'old-sessions-cleared',
			'client-config-needs-update',
			'disabled-runtime-remains-stopped',
			'save-failure-rolls-back',
			'start-failure-rolls-back',
			'generation-failure-is-secret-free',
			'secret-free-results-and-errors',
			'confirmation-ui-boundary',
		],
	})}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
