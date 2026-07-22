#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-runtime-credentials-test-'));
const output = path.join(tempRoot, 'runtime-credentials.mjs');

try {
	await build({
		entryPoints: [path.resolve('src/features/settings/runtime-credentials.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const credentialModule = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const credentials = [
		{ id: 'client-codex', clientId: 'codex', token: 'codex-old', capabilities: ['*'], createdAt: '2026-01-01T00:00:00.000Z' },
		{ id: 'client-cursor', clientId: 'cursor', token: 'cursor-stable', capabilities: ['vault.read'], createdAt: '2026-01-01T00:00:00.000Z' },
	];
	const rotated = credentialModule.rotateClientRuntimeCredential(
		credentials,
		'codex',
		'codex-new',
		'2026-07-22T00:00:00.000Z'
	);
	assert.equal(rotated[0].token, 'codex-new');
	assert.equal(rotated[0].id, 'client-codex');
	assert.deepEqual(rotated[1], credentials[1]);
	assert.equal(credentials[0].token, 'codex-old');
	assert.throws(
		() => credentialModule.rotateClientRuntimeCredential(credentials, 'missing', 'new-token', '2026-07-22T00:00:00.000Z'),
		/Missing runtime credential/
	);
	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 5 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
