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

function zhLocalize(zh, _en) {
	return zh;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-runtime-view-model-test-'));
const output = path.join(tempRoot, 'runtime-view-model.mjs');
const runtimeStatusSource = fs.readFileSync('src/features/runtime/runtime-status-view.ts', 'utf8');
const mainSource = fs.readFileSync('src/main.ts', 'utf8');

function status(overrides) {
	return {
		enabled: false,
		state: 'stopped',
		label: 'Old label',
		detail: 'Old detail',
		endpoint: 'http://127.0.0.1:51601/mcp',
		host: '127.0.0.1',
		port: 51601,
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
	assert.equal(
		failed.detail,
		'MCP service failed to start. Retry, then check Technical details or the Obsidian console if the problem persists.'
	);
	assert.equal(failed.detail.includes('boom-fail'), false);
	const failedZh = runtimeViewModel(
		status({ enabled: true, state: 'failed', lastError: 'RAW_RUNTIME_SENTINEL' }),
		zhLocalize
	);
	assert.equal(
		failedZh.detail,
		'MCP 服务启动失败。请重试；如果问题持续存在，请查看技术信息或 Obsidian 控制台。'
	);
	assert.equal(failedZh.detail.includes('RAW_RUNTIME_SENTINEL'), false);
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

	assert.ok(runtimeStatusSource.includes("text: ui('技术信息', 'Technical details')"));
	assert.ok(runtimeStatusSource.includes("this.renderDetail(technical, ui('最近错误', 'Last error'), status.lastError)"));
	assert.equal(runtimeStatusSource.includes('error instanceof Error ? error.message'), false);
	assert.ok(runtimeStatusSource.includes('reportUiFailure(error'));
	const statusRecoverySource = runtimeStatusSource.slice(
		runtimeStatusSource.indexOf('await this.plugin.ensureMcpRuntimeRunning()'),
		runtimeStatusSource.indexOf('if (runtime.canOpenLogs)')
	);
	assert.equal((statusRecoverySource.match(/catch \(error\)/g) || []).length, 2);
	assert.ok(statusRecoverySource.indexOf('ensureMcpRuntimeRunning') < statusRecoverySource.indexOf('await this.refresh()'));
	assert.ok(statusRecoverySource.includes('MCP 服务已启动，但连接状态视图刷新失败'));
	assert.ok(statusRecoverySource.includes("this.plugin.getRuntimeViewStatus().state === 'running'"));

	const rebuildSource = mainSource.slice(
		mainSource.indexOf('async rebuildKnowledgeIndex'),
		mainSource.indexOf('private restartAutoRefresh')
	);
	assert.ok(rebuildSource.includes('reportUiFailure(error'));
	assert.equal(rebuildSource.includes('error.message'), false);
	assert.equal(rebuildSource.includes('${message}'), false);
	const runtimeStartSource = mainSource.slice(
		mainSource.indexOf('private async runMcpRuntimeStart'),
		mainSource.indexOf('private async stopMcpRuntime')
	);
	assert.ok(runtimeStartSource.includes('reportUiFailure(error'));
	assert.equal(runtimeStartSource.includes('error.message'), false);
	assert.equal(runtimeStartSource.includes('${message}'), false);

	process.stdout.write(`${JSON.stringify({
		result: 'pass',
		checks: 31,
	})}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
