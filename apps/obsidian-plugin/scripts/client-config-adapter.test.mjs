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
	const config = {
		clientId: 'test-client',
		displayName: 'Test Client',
		description: '',
		transport: 'streamable-http',
		configText: '{"mcpServers":{"tracekeeper":{"url":"http://127.0.0.1:58437/mcp?token=new"}}}',
		supportsAutoConfigure: true,
		restartRequired: true,
		configFormat: 'mcp-json',
		targetPath,
		configState: 'not_configured',
		configStatusLabel: '',
		configStatusDetail: '',
	};
	files.set(targetPath, `${JSON.stringify({ mcpServers: { other: { url: 'http://other' } } }, null, 2)}\n`);
	let connectionUrl = 'http://127.0.0.1:58437/mcp?token=new';
	const adapter = new module.ClientConfigAdapter({
		fs: fileApi,
		path: { dirname: path.dirname },
		getConnectionUrl: () => connectionUrl,
		now: () => now,
		planTtlMs: 1_000,
	});

	const applyPlan = adapter.previewChange(config, 'apply');
	assert.equal(applyPlan.action, 'apply');
	assert.equal(applyPlan.targetPath, targetPath);
	assert.equal('nextContent' in applyPlan, false);
	const applyResult = adapter.applyConfirmedChange(applyPlan.planId);
	const installed = JSON.parse(files.get(targetPath));
	assert.equal(installed.mcpServers.other.url, 'http://other');
	assert.equal(installed.mcpServers.tracekeeper.url, 'http://127.0.0.1:58437/mcp?token=new');
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
	const credentialConflictPlan = adapter.previewChange(config, 'apply');
	connectionUrl = 'http://127.0.0.1:58437/mcp?token=rotated';
	assert.throws(() => adapter.applyConfirmedChange(credentialConflictPlan.planId), /credential changed after preview/);
	connectionUrl = 'http://127.0.0.1:58437/mcp?token=new';

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
	const removePlan = adapter.previewChange(config, 'remove');
	adapter.removeConfirmedChange(removePlan.planId);
	assert.equal('tracekeeper' in JSON.parse(files.get(targetPath)).mcpServers, false);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 12 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
