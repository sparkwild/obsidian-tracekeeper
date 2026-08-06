#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { callTool } from '../dist/index.js';

function write(vaultRoot, relativePath, content) {
	const target = path.join(vaultRoot, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content, 'utf8');
}

test('lint v3 exposes a closed read-only lifecycle Doctor report without inferring claims', async (t) => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-lifecycle-lint-'));
	const vaultRoot = path.join(tempRoot, 'vault');
	t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
	write(vaultRoot, '01_knowledge/memory/global/index.md', '# Global memory\n');
	write(vaultRoot, '01_knowledge/memory/global/memory.md', [
		'---',
		'type: memory',
		'---',
		'',
		'# Legacy memory',
		'',
		'No claim key is inferred by diagnostics.',
	].join('\n'));

	const result = await callTool('tracekeeper.lint', {
		graph_profile: 'off',
		stale_after_days: 30,
	}, {
		defaultVaultRoot: vaultRoot,
		principalId: 'lifecycle-lint-principal',
		credentialCapabilities: ['*'],
		agentId: 'lifecycle-lint-agent',
		sessionId: 'lifecycle-lint-session',
		clientName: 'lifecycle-lint-test',
		transport: 'test',
		runtimeVersion: 'test',
	});

	assert.equal(result.isError, false);
	const payload = result.structuredContent;
	assert.equal(payload.ok, true);
	assert.equal(payload.read_only, true);
	assert.equal(payload.graph_profile_disabled, true);
	assert.equal(payload.issues.some((issue) => issue.kind === 'memory_legacy_unkeyed'), true);
	assert.deepEqual(payload.lifecycle_doctor.legacy_candidates, [{
		path: '01_knowledge/memory/global/memory.md',
		content_hash: payload.lifecycle_doctor.legacy_candidates[0].content_hash,
		scope: 'global',
		project_id: null,
		suggestions: [],
	}]);
	assert.match(payload.lifecycle_doctor.legacy_candidates[0].content_hash, /^[a-f0-9]{64}$/);
	assert.equal(Array.isArray(payload.lifecycle_doctor.directory_counts), true);
});
