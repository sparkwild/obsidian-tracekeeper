#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-agent-refresh-test-'));
const output = path.join(tempRoot, 'agent-configuration-refresh.mjs');

try {
	await build({
		entryPoints: [path.resolve('src/features/settings/agent-configuration-refresh.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const {
		commitWithBestEffortRefresh,
		isSettingGroupHTMLElement,
		refreshAgentConfiguration,
		shouldReplaceAgentConfiguration,
	} = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const committed = { integrationId: 'integration-1' };
	const committedOutcome = await commitWithBestEffortRefresh(
		async () => committed,
		async () => {}
	);
	assert.equal(committedOutcome.result, committed);
	assert.equal(committedOutcome.refreshError, null);

	const refreshFailure = new Error('refresh failed');
	const staleOutcome = await commitWithBestEffortRefresh(
		async () => committed,
		async () => { throw refreshFailure; }
	);
	assert.equal(staleOutcome.result, committed);
	assert.equal(staleOutcome.refreshError, refreshFailure);

	const commitFailure = new Error('commit failed');
	let refreshedAfterCommitFailure = false;
	await assert.rejects(
		commitWithBestEffortRefresh(
			async () => { throw commitFailure; },
			async () => { refreshedAfterCommitFailure = true; }
		),
		(error) => error === commitFailure
	);
	assert.equal(refreshedAfterCommitFailure, false);
	const calls = [];
	let release;
	const blocked = new Promise((resolve) => { release = resolve; });
	const structureRefresh = refreshAgentConfiguration('structure', {
		content: () => { calls.push('content'); },
		structure: async () => {
			calls.push('structure:start');
			await blocked;
			calls.push('structure:end');
		},
	});
	await Promise.resolve();
	assert.deepEqual(calls, ['structure:start']);
	release();
	await structureRefresh;
	assert.deepEqual(calls, ['structure:start', 'structure:end']);

	await refreshAgentConfiguration('content', {
		content: () => { calls.push('content'); },
		structure: () => { calls.push('structure:unexpected'); },
	});
	assert.equal(calls.at(-1), 'content');

	await refreshAgentConfiguration('structure', {
		content: () => { calls.push('fallback'); },
	});
	assert.equal(calls.at(-1), 'fallback');
	assert.equal(shouldReplaceAgentConfiguration('same', 'same', false), false);
	assert.equal(shouldReplaceAgentConfiguration('before', 'after', false), true);
	assert.equal(shouldReplaceAgentConfiguration('same', 'same', true), true);

	const settingGroup = { tagName: 'DIV', classList: { contains: (value) => value === 'setting-group' } };
	assert.equal(isSettingGroupHTMLElement(settingGroup), true);
	assert.equal(isSettingGroupHTMLElement({ ...settingGroup, tagName: 'SECTION' }), false);
	assert.equal(isSettingGroupHTMLElement({ ...settingGroup, classList: { contains: () => false } }), false);
	assert.equal(isSettingGroupHTMLElement(null), false);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 17 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
