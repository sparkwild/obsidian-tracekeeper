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
			targetDirectory: '/tmp/tracekeeper/codex',
			bundleHash: hash.toUpperCase(),
			skillVersion: '2.1.0',
			installedAt: '2026-07-25T00:00:00.000Z',
			provenance: 'tracekeeper_install',
		},
		invalid: {
			targetId: 'different-target',
			bundleHash: 'not-a-hash',
			skillVersion: '2',
			installedAt: 'invalid',
		},
	});
	const migrated = receipts.normalizeSkillInstallReceipts({
		'codex-user': {
			targetId: 'codex-user',
			bundleHash: hash,
			skillVersion: '2.1.0',
			installedAt: '2026-07-25T00:00:00.000Z',
		},
		'claude-code-user': {
			schemaVersion: 2,
			targetId: 'claude-code-user',
			bundleHash: hash,
			skillVersion: '2.1.0',
			installedAt: '2026-07-25T00:00:00.000Z',
		},
	}, { legacyTargetDirectory: (targetId) => targetId === 'codex-user' ? '/legacy/codex/tracekeeper' : null });
	assert.equal(migrated['codex-user'].targetDirectory, '/legacy/codex/tracekeeper');
	assert.equal(migrated['claude-code-user'], undefined);
	const malformedV2 = receipts.normalizeSkillInstallReceipts({
		'codex-user': {
			schemaVersion: 2,
			targetId: 'codex-user',
			targetDirectory: '/tmp/tracekeeper/codex',
			bundleHash: hash,
			skillVersion: '2.1.0',
			installedAt: '2026-07-25T00:00:00.000Z',
			provenance: 'unknown',
		},
	});
	assert.deepEqual(malformedV2, {});
	assert.deepEqual(normalized, {
		'codex-user': {
			schemaVersion: 2,
			targetId: 'codex-user',
			targetDirectory: '/tmp/tracekeeper/codex',
			bundleHash: hash,
			skillVersion: '2.1.0',
			installedAt: '2026-07-25T00:00:00.000Z',
			provenance: 'tracekeeper_install',
		},
	});
	const recorded = receipts.recordSkillInstallReceipt(normalized, {
		schemaVersion: 2,
		targetId: 'claude-code-user',
		targetDirectory: '/tmp/tracekeeper/claude',
		bundleHash: `sha256:${'b'.repeat(64)}`,
		skillVersion: '2.1.1-rc.1',
		installedAt: '2026-07-25T00:01:00.000Z',
		provenance: 'external_verified',
	});
	assert.equal(normalized['claude-code-user'], undefined);
	assert.equal(recorded['claude-code-user'].skillVersion, '2.1.1-rc.1');
	assert.equal(recorded['claude-code-user'].provenance, 'external_verified');
	assert.throws(() => receipts.recordSkillInstallReceipt(normalized, {
		schemaVersion: 2,
		targetId: 'Invalid',
		targetDirectory: '/tmp/tracekeeper/invalid',
		bundleHash: hash,
		skillVersion: '2.1.0',
		installedAt: '2026-07-25T00:01:00.000Z',
		provenance: 'tracekeeper_install',
	}));
	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 10 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
