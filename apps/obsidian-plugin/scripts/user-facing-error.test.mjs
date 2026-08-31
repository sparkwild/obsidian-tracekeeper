#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-user-facing-error-'));
const output = path.join(tempRoot, 'user-facing-error.cjs');
const require = createRequire(import.meta.url);

try {
	await build({
		entryPoints: [path.resolve('src/ui/user-facing-error.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
		plugins: [{
			name: 'obsidian-stub',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
					path: 'obsidian-stub',
					namespace: 'obsidian-stub',
				}));
				buildContext.onLoad({ filter: /.*/, namespace: 'obsidian-stub' }, () => ({
					loader: 'js',
					contents: 'export function getLanguage() { return globalThis.__tracekeeperErrorTestLanguage || "en"; }',
				}));
			},
		}],
	});

	const { reportUiFailure } = require(output);
	const rawError = new Error('RAW ENGLISH INTERNAL ERROR');
	const calls = [];
	const originalConsoleError = console.error;
	console.error = (...args) => calls.push(args);
	try {
		for (const [language, expected] of [
			['zh-CN', '操作失败，请重试。'],
			['en', 'The operation failed. Try again.'],
		]) {
			globalThis.__tracekeeperErrorTestLanguage = language;
			const message = reportUiFailure(rawError, {
				context: 'tracekeeper test operation failed',
				fallback: {
					zh: '操作失败，请重试。',
					en: 'The operation failed. Try again.',
				},
			});
			assert.equal(message, expected);
			assert.equal(message.includes(rawError.message), false);
		}
	} finally {
		console.error = originalConsoleError;
		delete globalThis.__tracekeeperErrorTestLanguage;
	}

	assert.equal(calls.length, 2);
	assert.equal(calls.every(([context, error]) =>
		context === 'tracekeeper test operation failed' && error === rawError
	), true);

	const primaryUiFiles = [
		'src/features/activity/activity-view.ts',
		'src/features/client-config/client-config-modals.ts',
		'src/features/graph/graph-health-view.ts',
		'src/features/runtime/runtime-status-view.ts',
		'src/features/settings/tracekeeper-setting-tab.ts',
		'src/features/skill-installation/client-skill-prompt.ts',
		'src/features/skill-installation/skill-install-modals.ts',
	];
	const rawErrorSink = /error instanceof Error\s*\?\s*error\.message|new Notice\(error\.message|text:\s*error\.message|setText\(error\.message/;
	for (const file of primaryUiFiles) {
		const source = fs.readFileSync(file, 'utf8');
		assert.doesNotMatch(source, rawErrorSink, `${file} must not render arbitrary Error.message`);
	}

	const mainSource = fs.readFileSync('src/main.ts', 'utf8');
	for (const [startMarker, endMarker] of [
		['async rebuildKnowledgeIndex', 'private restartAutoRefresh'],
		['private async runMcpRuntimeStart', 'private async stopMcpRuntime'],
	]) {
		const start = mainSource.indexOf(startMarker);
		const end = mainSource.indexOf(endMarker, start);
		assert.ok(start >= 0 && end > start);
		const operationSource = mainSource.slice(start, end);
		assert.match(operationSource, /reportUiFailure\(error/);
		assert.doesNotMatch(operationSource, /error\.message|String\(error\)/);
	}

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 19 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
