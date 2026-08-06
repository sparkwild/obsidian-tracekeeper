#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-runtime-lifecycle-test-'));
const output = path.join(tempRoot, 'runtime-lifecycle-controller.mjs');

function deferred() {
	let resolve;
	const promise = new Promise((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function status(state, port) {
	return {
		state,
		host: '127.0.0.1',
		port,
		path: '/mcp',
		endpoint: `http://127.0.0.1:${port}/mcp`,
		startedAt: state === 'running' ? '2026-07-24T00:00:00.000Z' : '',
		activeSessions: 0,
		lastError: '',
		maxSessions: 32,
		maxRequestBytes: 1024,
		sessionIdleTtlMs: 1000,
		maxStreamsPerSession: 2,
		requestTimeoutMs: 1000,
		recovery: null,
	};
}

function fakeRuntime(name, port, events, startGate) {
	let current = status('stopped', port);
	return {
		async start() {
			events.push(`${name}:start`);
			current = status('starting', port);
			if (startGate) {
				await startGate.promise;
			}
			current = status('running', port);
			return current;
		},
		async stop() {
			events.push(`${name}:stop`);
			current = status('stopping', port);
			current = status('stopped', port);
		},
		getStatus() {
			return current;
		},
	};
}

try {
	await build({
		entryPoints: [path.resolve('src/features/runtime/runtime-lifecycle-controller.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const { McpRuntimeLifecycleController } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

	const events = [];
	const controller = new McpRuntimeLifecycleController();
	const firstRuntime = fakeRuntime('first', 51601, events);
	let duplicateFactoryCalls = 0;
	const firstStart = controller.start(() => firstRuntime);
	const duplicateStart = controller.start(() => {
		duplicateFactoryCalls += 1;
		return fakeRuntime('duplicate', 51602, events);
	});
	assert.equal((await firstStart)?.state, 'running');
	assert.equal(controller.getRuntime(), firstRuntime);
	assert.equal((await duplicateStart)?.port, 51601);
	assert.equal(duplicateFactoryCalls, 0);

	const secondRuntime = fakeRuntime('second', 51602, events);
	assert.equal((await controller.restart(() => secondRuntime))?.port, 51602);
	assert.equal(controller.getRuntime(), secondRuntime);
	assert.deepEqual(events.slice(0, 3), ['first:start', 'first:stop', 'second:start']);
	assert.equal((await controller.stop())?.state, 'stopped');
	assert.equal(controller.getRuntime(), null);

	const delayedEvents = [];
	const startGate = deferred();
	const closingController = new McpRuntimeLifecycleController();
	const delayedRuntime = fakeRuntime('delayed', 51603, delayedEvents, startGate);
	const delayedStart = closingController.start(() => delayedRuntime);
	await Promise.resolve();
	const close = closingController.close();
	startGate.resolve();
	assert.equal(await delayedStart, null);
	assert.equal((await close)?.state ?? 'stopped', 'stopped');
	assert.equal(closingController.getRuntime(), null);
	assert.deepEqual(delayedEvents, ['delayed:start', 'delayed:stop']);

	let postCloseFactoryCalls = 0;
	assert.equal(await closingController.start(() => {
		postCloseFactoryCalls += 1;
		return fakeRuntime('post-close', 51604, delayedEvents);
	}), null);
	assert.equal(postCloseFactoryCalls, 0);

	process.stdout.write(`${JSON.stringify({
		result: 'pass',
		checks: ['deduplicated-start', 'runtime-access', 'serialized-restart', 'stop-clears-runtime', 'close-preempts-start', 'closed-controller-rejects-start'],
	})}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
