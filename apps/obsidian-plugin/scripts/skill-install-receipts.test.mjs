#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-skill-install-receipts-test-'));
const output = path.join(tempRoot, 'skill-install-receipts.mjs');
const hash = `sha256:${'a'.repeat(64)}`;

try {
	await build({
		entryPoints: [path.resolve('src/features/skill-installation/skill-install-receipts.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const receipts = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const normalized = receipts.normalizeSkillInstallReceipts({
		'codex-user': {
			targetId: 'codex-user',
			bundleHash: hash.toUpperCase(),
			skillVersion: '2.1.0',
			installedAt: '2026-07-25T00:00:00.000Z',
		},
		invalid: {
			targetId: 'different-target',
			bundleHash: 'not-a-hash',
			skillVersion: '2',
			installedAt: 'invalid',
		},
	});
	assert.deepEqual(normalized, {
		'codex-user': {
			targetId: 'codex-user',
			bundleHash: hash,
			skillVersion: '2.1.0',
			installedAt: '2026-07-25T00:00:00.000Z',
		},
	});
	const recorded = receipts.recordSkillInstallReceipt(normalized, {
		targetId: 'claude-code-user',
		bundleHash: `sha256:${'b'.repeat(64)}`,
		skillVersion: '2.1.1-rc.1',
		installedAt: '2026-07-25T00:01:00.000Z',
	});
	assert.equal(normalized['claude-code-user'], undefined);
	assert.equal(recorded['claude-code-user'].skillVersion, '2.1.1-rc.1');
	assert.throws(() => receipts.recordSkillInstallReceipt(normalized, {
		targetId: 'Invalid',
		bundleHash: hash,
		skillVersion: '2.1.0',
		installedAt: '2026-07-25T00:01:00.000Z',
	}));
	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 7 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
