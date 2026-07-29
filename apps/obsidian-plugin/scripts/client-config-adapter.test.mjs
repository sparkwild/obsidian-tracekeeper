#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-client-config-adapter-test-'));
const output = path.join(tempRoot, 'client-config-adapter.bundle.mjs');

try {
	await build({
		entryPoints: [path.resolve('src/adapters/client-config-adapter.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const module = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const files = new Map();
	const fileApi = {
		existsSync: (filePath) => files.has(filePath),
		readFileSync: (filePath) => {
			if (!files.has(filePath)) throw new Error(`missing ${filePath}`);
			return files.get(filePath);
		},
		writeFileSync: (filePath, content) => files.set(filePath, content),
		mkdirSync: () => undefined,
		renameSync: (oldPath, newPath) => {
			if (!files.has(oldPath)) throw new Error(`missing ${oldPath}`);
			files.set(newPath, files.get(oldPath));
			files.delete(oldPath);
		},
	};
	let now = new Date('2026-07-22T00:00:00.000Z');
	const targetPath = '/home/test/client.json';
	const currentAccessToken = 'A'.repeat(43);
	const previousAccessToken = 'B'.repeat(43);
	const currentAuthorization = `Bearer ${currentAccessToken}`;
	const config = {
		clientId: 'test-client',
		displayName: 'Test Client',
		description: '',
		transport: 'streamable-http',
		completeConfigText: JSON.stringify({
			mcpServers: {
				tracekeeper: {
					url: 'http://127.0.0.1:58437/mcp',
					headers: { Authorization: currentAuthorization },
				},
			},
		}),
		redactedConfigText: JSON.stringify({
			mcpServers: {
				tracekeeper: {
					url: 'http://127.0.0.1:58437/mcp',
					headers: { Authorization: 'Bearer <redacted>' },
				},
			},
		}),
		supportsAutoConfigure: true,
		restartRequired: true,
		configFormat: 'mcp-json',
		targetPath,
		configState: 'not_configured',
		configStatusLabel: '',
		configStatusDetail: '',
	};
	files.set(targetPath, `${JSON.stringify({ mcpServers: { other: { url: 'http://other' } } }, null, 2)}\n`);
	let connectionUrl = 'http://127.0.0.1:58437/mcp';
	let accessToken = currentAccessToken;
	let accessTokenReads = 0;
	const adapter = new module.ClientConfigAdapter({
		fs: fileApi,
		path: { dirname: path.dirname },
		getConnectionUrl: () => connectionUrl,
		getAccessToken: () => {
			accessTokenReads += 1;
			return accessToken;
		},
		now: () => now,
		planTtlMs: 1_000,
	});

	const applyPlan = adapter.previewChange(config, 'apply');
	assert.equal(applyPlan.action, 'apply');
	assert.equal(applyPlan.targetPath, targetPath);
	assert.equal('nextContent' in applyPlan, false);
	assert.equal('connectionConfigHash' in applyPlan, false);
	assert.equal(applyPlan.previewText.includes(currentAccessToken), false);
	assert.equal(applyPlan.previewText.includes('Bearer <redacted>'), true);
	const applyResult = adapter.applyConfirmedChange(applyPlan.planId);
	const installed = JSON.parse(files.get(targetPath));
	assert.equal(installed.mcpServers.other.url, 'http://other');
	assert.equal(installed.mcpServers.tracekeeper.url, 'http://127.0.0.1:58437/mcp');
	assert.equal(installed.mcpServers.tracekeeper.headers.Authorization, currentAuthorization);
	assert.equal(files.has(applyResult.backupPath), true);
	assert.equal(adapter.verifyInstalledConfig({
		id: config.clientId,
		displayName: config.displayName,
		description: '',
		preferredTransport: config.transport,
		supportsAutoConfigure: true,
		restartRequired: true,
		configFormat: config.configFormat,
		targetPath,
		}, (_zh, en) => en).state, 'configured');
	const urlConflictPlan = adapter.previewChange(config, 'apply');
	connectionUrl = 'http://127.0.0.1:58438/mcp';
	assert.throws(() => adapter.applyConfirmedChange(urlConflictPlan.planId), /connection settings changed after preview/);
	connectionUrl = 'http://127.0.0.1:58437/mcp';

	const tokenConflictPlan = adapter.previewChange(config, 'apply');
	accessToken = previousAccessToken;
	assert.throws(
		() => adapter.applyConfirmedChange(tokenConflictPlan.planId),
		(error) => /connection settings changed after preview/.test(error.message)
			&& !error.message.includes(currentAccessToken)
			&& !error.message.includes(previousAccessToken)
	);
	accessToken = currentAccessToken;

	files.set(targetPath, `${JSON.stringify({
		mcpServers: {
			other: { url: 'http://other' },
			tracekeeper: {
				url: 'http://127.0.0.1:58437/mcp?token=retired-query-secret',
				headers: { Authorization: `Bearer ${previousAccessToken}` },
			},
		},
	}, null, 2)}\n`);
	const migrationPlan = adapter.previewChange(config, 'apply');
	assert.equal(migrationPlan.previewText.includes(previousAccessToken), false);
	assert.equal(migrationPlan.previewText.includes('retired-query-secret'), false);
	const migrationResult = adapter.applyConfirmedChange(migrationPlan.planId);
	const migrated = JSON.parse(files.get(targetPath));
	assert.equal(migrated.mcpServers.other.url, 'http://other');
	assert.equal(migrated.mcpServers.tracekeeper.url, connectionUrl);
	assert.equal(migrated.mcpServers.tracekeeper.headers.Authorization, currentAuthorization);
	assert.equal(JSON.stringify(migrated).includes('retired-query-secret'), false);
	assert.equal(files.get(migrationResult.backupPath).includes('retired-query-secret'), true);
	assert.equal(files.get(migrationResult.backupPath).includes(previousAccessToken), true);

	const conflictPlan = adapter.previewChange(config, 'remove');
	files.set(targetPath, `${files.get(targetPath)}\n`);
	assert.throws(
		() => adapter.removeConfirmedChange(conflictPlan.planId),
		(error) => error instanceof module.ClientConfigPlanConflictError && /changed after preview/.test(error.message)
	);

	const expiredPlan = adapter.previewChange(config, 'remove');
	now = new Date('2026-07-22T00:00:02.000Z');
	assert.throws(() => adapter.removeConfirmedChange(expiredPlan.planId), /expired/);

	now = new Date('2026-07-22T00:00:03.000Z');
	const accessTokenReadsBeforeRemove = accessTokenReads;
	const removePlan = adapter.previewChange(config, 'remove');
	adapter.removeConfirmedChange(removePlan.planId);
	assert.equal('tracekeeper' in JSON.parse(files.get(targetPath)).mcpServers, false);
	assert.equal(accessTokenReads, accessTokenReadsBeforeRemove);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 28 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
