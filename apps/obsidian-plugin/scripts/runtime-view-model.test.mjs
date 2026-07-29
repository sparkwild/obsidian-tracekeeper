#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

function enLocalize(_zh, en) {
	return en;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-runtime-view-model-test-'));
const output = path.join(tempRoot, 'runtime-view-model.mjs');

function status(overrides) {
	return {
		enabled: false,
		state: 'stopped',
		label: 'Old label',
		detail: 'Old detail',
		endpoint: 'http://127.0.0.1:58437/mcp',
		host: '127.0.0.1',
		port: 58437,
		startedAt: '',
		activeSessions: 0,
		lastError: '',
		recovery: null,
		...overrides,
	};
}

try {
	await build({
		entryPoints: [path.resolve('src/features/runtime/runtime-view-model.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const { runtimeToneBadgeClass, runtimeViewModel } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

	const disabled = runtimeViewModel(
		status({ enabled: false, state: 'running', lastError: 'ignored' }),
		enLocalize
	);
	assert.equal(disabled.state, 'disabled');
	assert.equal(disabled.label, 'Off');
	assert.equal(disabled.primaryAction, 'enable');
	assert.equal(disabled.busy, false);
	assert.equal(disabled.canOpenLogs, false);
	assert.equal(disabled.canEditPort, false);

	const stopped = runtimeViewModel(
		status({ enabled: true, state: 'stopped' }),
		enLocalize
	);
	assert.equal(stopped.state, 'stopped-enabled');
	assert.equal(stopped.primaryAction, 'retry');
	assert.equal(stopped.tone, 'default');

	const starting = runtimeViewModel(status({ enabled: true, state: 'starting' }), enLocalize);
	assert.equal(starting.state, 'starting');
	assert.equal(starting.busy, true);
	assert.equal(starting.primaryAction, 'none');
	assert.equal(starting.tone, 'warning');

	const running = runtimeViewModel(status({ enabled: true, state: 'running' }), enLocalize);
	assert.equal(running.state, 'running');
	assert.equal(running.busy, false);
	assert.equal(running.primaryAction, 'none');
	assert.equal(running.canOpenLogs, false);
	assert.equal(running.label, 'Running');
	assert.equal(runtimeToneBadgeClass(running.tone), 'tracekeeper-badge--success');
	assert.equal(
		running.detail,
		'Obsidian is hosting the local MCP service. AI tools can connect while Obsidian is open.'
	);

	const stopping = runtimeViewModel(status({ enabled: true, state: 'stopping' }), enLocalize);
	assert.equal(stopping.state, 'stopping');
	assert.equal(stopping.busy, true);

	const portConflict = runtimeViewModel(
		status({ enabled: true, state: 'port_conflict', port: 58555 }),
		enLocalize
	);
	assert.equal(portConflict.state, 'port_conflict');
	assert.equal(portConflict.canEditPort, true);
	assert.equal(portConflict.canOpenLogs, true);
	assert.equal(portConflict.primaryAction, 'retry');
	assert.equal(
		portConflict.detail,
		'Port 58555 is already used, possibly by another Obsidian Vault or local process. Choose another port for this Vault or stop the owner.'
	);

	const failed = runtimeViewModel(
		status({ enabled: true, state: 'failed', lastError: 'boom-fail' }),
		enLocalize
	);
	assert.equal(failed.state, 'failed');
	assert.equal(failed.canOpenLogs, true);
	assert.equal(failed.primaryAction, 'retry');
	assert.equal(failed.detail, 'MCP service failed to start: boom-fail');
	assert.equal(runtimeToneBadgeClass(failed.tone), 'tracekeeper-badge--error');
	assert.equal(runtimeToneBadgeClass(starting.tone), 'tracekeeper-badge--warning');
	assert.equal(runtimeToneBadgeClass(stopped.tone), 'tracekeeper-badge--muted');
	assert.equal(runtimeToneBadgeClass(disabled.tone), 'tracekeeper-badge--muted');

	const fromRuntimeViewStatus = runtimeViewModel(
		status({
			enabled: true,
			state: 'running',
			label: 'Running',
			detail: 'Old detail',
		}),
		enLocalize
	);
	assert.equal(fromRuntimeViewStatus.state, 'running');

	process.stdout.write(`${JSON.stringify({
		result: 'pass',
		checks: 13,
	})}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
