#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-skill-install-audit-test-'));
const output = path.join(tempRoot, 'skill-install-audit.mjs');

try {
	await build({
		entryPoints: [path.resolve('src/features/skill-installation/skill-install-audit.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const audit = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const hash = `sha256:${'a'.repeat(64)}`;
	const success = audit.buildSkillInstallAuditEntry({
		action: 'update',
		clientId: 'codex',
		bundleHash: hash,
		backupCreated: true,
		result: 'success',
		timestamp: '2026-07-23T00:00:00.000Z',
	});
	assert.match(success, /action: skill_update/);
	assert.match(success, /client_id: codex/);
	assert.match(success, new RegExp(`bundle_hash: ${hash}`));
	assert.match(success, /backup_created: true/);
	assert.match(success, /install_method: tracekeeper_install/);
	assert.match(success, /result: success/);
	assert.equal(success.includes('/Users/'), false);
	assert.equal(success.includes('token='), false);

	const migration = audit.buildSkillInstallAuditEntry({
		action: 'migrate',
		clientId: 'codex',
		bundleHash: hash,
		backupCreated: false,
		result: 'success',
		timestamp: '2026-07-23T00:00:00.000Z',
	});
	assert.match(migration, /action: skill_migrate/);
	const external = audit.buildSkillInstallAuditEntry({
		action: 'verify_external',
		clientId: 'cursor',
		bundleHash: hash,
		backupCreated: false,
		result: 'success',
		installMethod: 'external_verified',
		timestamp: '2026-07-23T00:00:00.000Z',
	});
	assert.match(external, /action: skill_verify_external/);
	assert.match(external, /install_method: external_verified/);
	const partial = audit.buildSkillInstallAuditEntry({
		action: 'install',
		clientId: 'codex',
		bundleHash: hash,
		backupCreated: false,
		result: 'partial',
		timestamp: '2026-07-23T00:00:00.000Z',
	});
	assert.match(partial, /result: partial/);

	const failed = audit.buildSkillInstallAuditEntry({
		action: 'install',
		clientId: 'codex\ntoken=secret/path',
		bundleHash: 'token=secret',
		backupCreated: false,
		result: 'failed',
		timestamp: '2026-07-23T00:00:00.000Z',
	});
	assert.match(failed, /action: skill_install/);
	assert.match(failed, /client_id: codex_token_secret_path/);
	assert.match(failed, /bundle_hash: unavailable/);
	assert.match(failed, /backup_created: false/);
	assert.match(failed, /result: failed/);
	assert.equal(failed.includes('token=secret'), false);
	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 14 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
