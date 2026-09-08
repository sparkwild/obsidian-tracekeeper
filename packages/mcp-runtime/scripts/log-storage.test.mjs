import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NodeFileOperationJournal, createVaultOperationJournal, logDirectory, previewLogMigration, migrateLogStorage, restoreVaultBackup, computePayloadHash, LogArchive } from '@tracekeeper/core';
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-log-storage-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
function record(n, text = 'repeatable knowledge '.repeat(1000)) { const payload = { text }; return { error: undefined, failed_at: undefined, operation_id: `operation-${n}`, idempotency_key: `key-${n}`, payload_hash: computePayloadHash(payload), payload, result: { ok: true }, completed_steps: [], status: 'completed', created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' }; }
test('inspection is read-only, including a missing store', async (t) => { const root = await fixture(t), dir = path.join(root, 'absent'); assert.equal((await new NodeFileOperationJournal({ directory: dir }).inspect()).hot, 0); await assert.rejects(fs.stat(dir), { code: 'ENOENT' }); });
test('compression writes v2 only when useful; missing keys are never replaced', async (t) => { const root = await fixture(t), j = new NodeFileOperationJournal({ directory: root }); await j.save(record(1)); const raw = JSON.parse(await fs.readFile(path.join(root, 'operation-1.json'), 'utf8')); assert.equal(raw.payload_encrypted.version, 2); assert.equal(raw.payload_encrypted.compression, 'gzip'); assert.deepEqual((await j.loadById('operation-1')).payload, record(1).payload); await fs.unlink(path.join(root, '.payload-encryption-key')); await assert.rejects(j.loadById('operation-1'), /key missing/); await assert.rejects(fs.stat(path.join(root, '.payload-encryption-key')), { code: 'ENOENT' }); });
test('archive preserves exact retries and rejects tampered indexed history', async (t) => { const root = await fixture(t), j = new NodeFileOperationJournal({ directory: root }); for (let i = 0; i < 40; i++)
	await j.save(record(i)); assert.equal((await j.archiveCompleted()).archived, 40); const fresh = new NodeFileOperationJournal({ directory: root }); assert.deepEqual(await fresh.loadByIdempotencyKey('key-7'), record(7)); assert.deepEqual(await fresh.listRecoverable(), []); assert.equal(await fresh.loadByIdempotencyKey('new'), null); await assert.rejects(fresh.save({ ...record(7), result: { ok: false } }), /immutable/); const cold = path.join(root, '.cold'); const index = (await fs.readdir(cold)).find(n => n.endsWith('.index')); await fs.writeFile(path.join(cold, index), '{}'); await assert.rejects(new LogArchive(root).verify(), /corrupt/); });
test('whole-Vault backup, activation and restore preserve knowledge and exact results', async (t) => { const root = await fixture(t), vault = path.join(root, 'vault'); await fs.mkdir(vault); await fs.writeFile(path.join(vault, 'note.md'), 'unchanged knowledge'); const legacy = path.join(vault, '00_tracekeeper/control/operations'); const j = new NodeFileOperationJournal({ directory: legacy }); await j.save(record(1)); const preview = await previewLogMigration(vault); assert.equal(preview.canMigrate, true); const backup = path.join(root, 'backup'); await migrateLogStorage(vault, backup, preview); assert.ok(logDirectory(vault).includes('.tracekeeper')); assert.deepEqual(await createVaultOperationJournal(vault).loadByIdempotencyKey('key-1'), record(1)); assert.equal(await fs.readFile(path.join(vault, 'note.md'), 'utf8'), 'unchanged knowledge'); await assert.rejects(fs.stat(legacy), { code: 'ENOENT' }); const restored = path.join(root, 'restored'); await restoreVaultBackup(backup, restored); assert.equal(await fs.readFile(path.join(restored, 'note.md'), 'utf8'), 'unchanged knowledge'); assert.deepEqual(await new NodeFileOperationJournal({ directory: path.join(restored, '00_tracekeeper/control/operations') }).loadByIdempotencyKey('key-1'), record(1)); });
test('stale migration preview does not activate or create a backup', async (t) => { const root = await fixture(t), vault = path.join(root, 'vault'); await fs.mkdir(vault); const j = new NodeFileOperationJournal({ directory: path.join(vault, '00_tracekeeper/control/operations') }); await j.save(record(1)); const preview = await previewLogMigration(vault); await j.save(record(2)); await assert.rejects(migrateLogStorage(vault, path.join(root, 'backup'), preview), /stale/); await assert.rejects(fs.stat(path.join(root, 'backup')), { code: 'ENOENT' }); });
test('interrupted archive publication resumes without re-executing a business effect', async (t) => {
	const root = await fixture(t), j = new NodeFileOperationJournal({ directory: root });
	await j.save(record(1));
	const rename = fs.rename;
	let injected = false;
	fs.rename = async (...args) => { if (!injected && String(args[1]).endsWith('/.cold/CURRENT')) {
		injected = true;
		throw new Error('injected publication interruption');
	} return rename(...args); };
	try {
		await assert.rejects(j.archiveCompleted(), /injected/);
	}
	finally {
		fs.rename = rename;
	}
	await new NodeFileOperationJournal({ directory: root }).recoverStorage();
	const restored = await new NodeFileOperationJournal({ directory: root }).loadByIdempotencyKey('key-1');
	assert.deepEqual(restored.result, record(1).result);
	assert.deepEqual(restored.payload, record(1).payload);
	await assert.rejects(fs.stat(path.join(root, 'operation-1.json')), { code: 'ENOENT' });
});
test('interrupted hot-copy retirement converges and a corrupt index can be rebuilt', async (t) => {
	const root = await fixture(t), j = new NodeFileOperationJournal({ directory: root });
	await j.save(record(1));
	await j.save(record(2));
	const unlink = fs.unlink;
	let injected = false;
	fs.unlink = async (...args) => { if (!injected && String(args[0]).endsWith('operation-2.json')) {
		injected = true;
		throw new Error('injected retirement interruption');
	} return unlink(...args); };
	try {
		await assert.rejects(j.archiveCompleted(), /injected/);
	}
	finally {
		fs.unlink = unlink;
	}
	await j.recoverStorage();
	const cold = path.join(root, '.cold');
	const index = (await fs.readdir(cold)).find(name => name.endsWith('.index'));
	await fs.writeFile(path.join(cold, index), '{}');
	await assert.rejects(j.verifyStorage(), /corrupt/);
	await j.repairArchive();
	assert.deepEqual((await j.loadByIdempotencyKey('key-2')).result, record(2).result);
});
test('backup drift prevents activation and leaves the original operational data intact', async (t) => {
	const root = await fixture(t), vault = path.join(root, 'vault');
	await fs.mkdir(vault);
	await fs.writeFile(path.join(vault, 'note.md'), 'before');
	const legacy = path.join(vault, '00_tracekeeper/control/operations');
	const j = new NodeFileOperationJournal({ directory: legacy });
	await j.save(record(1));
	const preview = await previewLogMigration(vault), copy = fs.copyFile;
	let injected = false;
	fs.copyFile = async (...args) => { await copy(...args); if (!injected) {
		injected = true;
		await fs.writeFile(path.join(vault, 'note.md'), 'changed during backup');
	} };
	try {
		await assert.rejects(migrateLogStorage(vault, path.join(root, 'backup'), preview), /changed|snapshot/);
	}
	finally {
		fs.copyFile = copy;
	}
	await assert.rejects(fs.stat(path.join(vault, '.tracekeeper/logs/ACTIVE')), { code: 'ENOENT' });
	assert.deepEqual((await j.loadByIdempotencyKey('key-1')).result, record(1).result);
});
test('v1 small values remain uncompressed and oversized decoded writes are rejected', async (t) => {
	const root = await fixture(t), j = new NodeFileOperationJournal({ directory: root });
	await j.save(record(1, 'small'));
	const raw = JSON.parse(await fs.readFile(path.join(root, 'operation-1.json'), 'utf8'));
	assert.equal(raw.payload_encrypted.version, 1);
	assert.equal(raw.payload_encrypted.compression, undefined);
	await assert.rejects(j.save(record(2, 'x'.repeat(64 * 1024 * 1024))), /decoded size limit/);
	await assert.rejects(fs.stat(path.join(root, 'operation-2.json')), { code: 'ENOENT' });
});

test('public note resolution cannot enter hidden logs or their legacy aliases', async () => {
 const {normalizeNotePath}=await import('../dist/safety.js');
 for(const name of ['.tracekeeper/logs/private.md','.TRACEKEEPER/logs/private.md','00_tracekeeper/control/operations/private.md']) assert.throws(()=>normalizeNotePath(name),/Operational log storage/);
 assert.equal(normalizeNotePath('01_knowledge/wiki/example.md'),'01_knowledge/wiki/example.md');
});
