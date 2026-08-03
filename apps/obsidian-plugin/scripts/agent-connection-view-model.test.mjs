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
		authMode: 'oauth',
		hasCredential: false,
		...overrides,
	});
	const presentations = [
		buildConnectionPresentation(base()),
		buildConnectionPresentation(base({ setupCommandCopiedAt: '2026-08-03T00:00:00.000Z' })),
		buildConnectionPresentation(base({ hasPendingApproval: true })),
		buildConnectionPresentation(base({ hasCredential: true })),
		buildConnectionPresentation(base({ hasCredential: true, connected: true })),
		buildConnectionPresentation(base({ hasCredential: true, connected: true, used: true })),
		buildConnectionPresentation(base({ revoked: true })),
		buildConnectionPresentation(base({ needsUpdate: true })),
	];

	assert.deepEqual(presentations.map(({ state }) => state), [
		'not_configured',
		'copied_unverified',
		'pending_approval',
		'authorized',
		'connected',
		'used',
		'revoked',
		'needs_update',
	]);
	assert.deepEqual(presentations.map(({ primaryAction }) => primaryAction), [
		'copy_setup',
		'copy_setup',
		null,
		'revoke',
		'revoke',
		'revoke',
		'copy_setup',
		'copy_setup',
	]);
	assert.deepEqual(buildConnectionPresentation(base()).visibleSections, ['setup', 'authorization', 'skill']);
	assert.deepEqual(buildConnectionPresentation(base({ hasCredential: true, used: true })).visibleSections, ['setup', 'authorization', 'usage', 'skill']);
	assert.deepEqual(buildConnectionPresentation(base({ authMode: 'bearer' })), {
		state: 'manual',
		mcpState: 'not_started',
		authorizationState: 'not_authorized',
		usageState: 'never_used',
		primaryAction: 'generate_bearer',
		visibleSections: ['setup', 'authorization', 'skill'],
	});
	assert.equal(buildConnectionPresentation(base({ authMode: 'bearer', revoked: true })).primaryAction, 'generate_bearer');
	assert.deepEqual(
		buildConnectionPresentation(base({ hasCredential: true, connected: true, used: true })),
		{
			state: 'used',
			mcpState: 'connected',
			authorizationState: 'authorized',
			usageState: 'used',
			primaryAction: 'revoke',
			visibleSections: ['setup', 'authorization', 'usage', 'skill'],
		}
	);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 19 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
