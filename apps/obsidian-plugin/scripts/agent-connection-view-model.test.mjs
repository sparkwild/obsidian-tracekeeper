#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-agent-connection-view-model-test-'));
const output = path.join(tempRoot, 'agent-connection-view-model.mjs');

try {
	await build({
		entryPoints: [path.resolve('src/features/client-config/agent-connection-view-model.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const { buildConnectionPresentation } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

	const base = (overrides = {}) => ({
		mode: 'add',
		supportsLocalOAuth: true,
		pairingLoading: false,
		pairingState: null,
		hasPairingTicket: false,
		clipboardState: 'idle',
		...overrides,
	});
	const presentations = [
		buildConnectionPresentation(base()),
		buildConnectionPresentation(base({ pairingLoading: true })),
		buildConnectionPresentation(base({ pairingState: 'ready', hasPairingTicket: true, clipboardState: 'copied' })),
		buildConnectionPresentation(base({ pairingState: 'awaiting_confirmation', hasPairingTicket: true })),
		buildConnectionPresentation(base({ pairingState: 'redeemed' })),
		buildConnectionPresentation(base({ pairingState: 'expired' })),
		buildConnectionPresentation(base({ pairingState: 'failed' })),
		buildConnectionPresentation(base({ pairingState: 'retry' })),
	];

	assert.deepEqual(presentations.map(({ state }) => state), [
		'idle',
		'preparing',
		'ready',
		'awaiting_confirmation',
		'authorized',
		'expired',
		'failed',
		'retry',
	]);
	assert.deepEqual(presentations.map(({ primaryAction }) => primaryAction), [
		'start',
		null,
		null,
		null,
		'close',
		'retry',
		'retry',
		'retry',
	]);
	assert.equal(presentations.every(({ primaryAction }) => typeof primaryAction === 'string' || primaryAction === null), true);
	assert.equal(
		buildConnectionPresentation(base({ pairingState: 'ready', hasPairingTicket: true, clipboardState: 'failed' })).primaryAction,
		'copy_setup'
	);
	assert.deepEqual(
		buildConnectionPresentation(base({ mode: 'manage' })).visibleSections,
		['usage_summary', 'skill', 'technical_details']
	);
	assert.equal(buildConnectionPresentation(base({ mode: 'manage' })).primaryAction, 'reconnect');
	const manual = buildConnectionPresentation(base({ supportsLocalOAuth: false }));
	assert.deepEqual(manual, {
		state: 'manual',
		primaryAction: 'copy_setup',
		secondaryActions: ['technical_details'],
		visibleSections: ['manual_setup', 'technical_details'],
		isBusy: false,
	});
	assert.equal(buildConnectionPresentation(base({ pairingLoading: true, supportsLocalOAuth: false })).state, 'manual');

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 19 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
