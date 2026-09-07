import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { NodeFileOperationJournal, computePayloadHash } from '@tracekeeper/core';

function fixture(t) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-journal-regressions-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const journal = new NodeFileOperationJournal({ directory });
	const record = (suffix, status = 'completed', content = 'fixture') => {
		const payload = { content };
		return { operation_id: `operation-${suffix}`, idempotency_key: `key-${suffix}`,
			payload_hash: computePayloadHash(payload), payload, status,
			created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
			completed_steps: [], ...(status === 'completed' ? { result: { content, ok: true } } : {}) };
	};
	return { directory, journal, record };
}

test('new retry keys do not decrypt referenced historical records; orphan lookup still repairs its reference', async (t) => {
	const { directory, journal, record } = fixture(t);
	for (let i = 0; i < 20; i++) await journal.save(record(i));
	const originalRead = journal.readRecord.bind(journal);
	let reads = 0;
	journal.readRecord = (...args) => { reads++; return originalRead(...args); };
	assert.equal(await journal.loadByIdempotencyKey('new-key'), null);
	assert.equal(reads, 0);
	const keyHash = crypto.createHash('sha256').update('key-0').digest('hex');
	const reference = path.join(directory, `.idempotency-${keyHash}.ref`);
	fs.unlinkSync(reference);
	assert.equal((await journal.loadByIdempotencyKey('key-0')).operation_id, 'operation-0');
	assert.equal(reads, 1);
	assert.ok(fs.existsSync(reference));
});

test('terminal anchors avoid loading historical bodies and damaged active records do not block healthy recovery', async (t) => {
	const { directory, journal, record } = fixture(t);
	await journal.save(record('done'));
	await journal.save(record('active', 'in_progress'));
	fs.writeFileSync(path.join(directory, 'damaged.json'), '{invalid fixture');
	const read = journal.readRecord.bind(journal);
	const paths = [];
	journal.readRecord = (...args) => { paths.push(path.basename(args[0])); return read(...args); };
	const recoverable = await journal.listRecoverable();
	assert.deepEqual(recoverable.map(row => row.operation_id), ['operation-active']);
	assert.equal(paths.includes('operation-done.json'), false);
	assert.equal(journal.getRecoveryIssues()[0].operation_id, 'damaged');
	assert.equal(journal.getRecoveryIssues().length, 1);
});

test('writes remain v1 while existing authenticated compressed v2 payloads remain readable', async (t) => {
	const { directory, journal, record } = fixture(t);
	const expected = record('large', 'completed', 'Private fixture content. '.repeat(10_000));
	await journal.save(expected);
	const raw = fs.readFileSync(path.join(directory, 'operation-large.json'), 'utf8');
	const stored = JSON.parse(raw);
	assert.equal(stored.payload_encrypted.version, 1);
	assert.equal(stored.payload_encrypted.compression, undefined);
	assert.equal(raw.includes('Private fixture content'), false);
	const reloaded = await new NodeFileOperationJournal({ directory }).loadByIdempotencyKey('key-large');
	assert.deepEqual(reloaded.payload, expected.payload);
	assert.deepEqual(reloaded.result, expected.result);
	const key = fs.readFileSync(path.join(directory, '.payload-encryption-key'));
	const keyBytes = Buffer.from(key.toString('utf8').trim(), 'base64');
	const nonce = Buffer.alloc(12, 7);
	const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, nonce);
	cipher.setAAD(Buffer.from(`${expected.operation_id}\0${expected.idempotency_key}\0${expected.payload_hash}\0payload\0gzip`));
	const ciphertext = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(expected.payload)))), cipher.final()]);
	stored.payload_encrypted = { version: 2, algorithm: 'aes-256-gcm', compression: 'gzip', nonce: nonce.toString('base64'), auth_tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
	fs.writeFileSync(path.join(directory, 'operation-large.json'), JSON.stringify(stored));
	assert.deepEqual((await journal.loadByIdempotencyKey('key-large')).payload, expected.payload);
	stored.payload_encrypted.compression = 'invalid';
	fs.writeFileSync(path.join(directory, 'operation-large.json'), JSON.stringify(stored));
	await assert.rejects(() => journal.loadByIdempotencyKey('key-large'), /invalid|authentication/);
	assert.equal(await journal.loadByIdempotencyKey('unrelated-new-key'), null);
});


test('directory catalog survives own writes and per-key locks, and invalidates after another instance writes', async (t) => {
	const { directory, journal, record } = fixture(t);
	for (let i = 0; i < 25; i++) await journal.save(record(i));
	assert.equal(await journal.loadByIdempotencyKey('new-0'), null);
	const catalog = journal.directoryCatalog;
	const release = await journal.acquireLock('new-1');
	assert.equal(await journal.loadByIdempotencyKey('new-1'), null);
	await journal.save(record('own'));
	await release();
	assert.equal(journal.directoryCatalog, catalog);
	assert.equal(await journal.loadByIdempotencyKey('new-2'), null);
	assert.equal(journal.directoryCatalog, catalog);
	const second = new NodeFileOperationJournal({ directory });
	await second.save(record('external', 'in_progress'));
	const ref = path.join(directory, `.idempotency-${crypto.createHash('sha256').update('key-external').digest('hex')}.ref`);
	fs.unlinkSync(ref);
	assert.equal((await journal.loadByIdempotencyKey('key-external')).operation_id, 'operation-external');
	assert.notEqual(journal.directoryCatalog, catalog);
	journal.clearCache();
	assert.equal(journal.directoryCatalog, null);
});

test('cached terminal anchors are invalidated by in-place tampering', async (t) => {
	const { directory, journal, record } = fixture(t);
	await journal.save(record('terminal'));
	assert.deepEqual(await journal.listRecoverable(), []);
	const anchorPath = path.join(directory, '.progress-operation-terminal.anchor');
	const anchor = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
	anchor.mac = '0'.repeat(64);
	fs.writeFileSync(anchorPath, JSON.stringify(anchor));
	await journal.listRecoverable();
	assert.equal(journal.getRecoveryIssues().length, 1);
	await assert.rejects(journal.loadById('operation-terminal'), /authentication/);
});

test('directory coordination rejects symlinked lock directories', async (t) => {
	const { directory, journal, record } = fixture(t);
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-lock-outside-'));
	t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
	fs.symlinkSync(outside, path.join(directory, '.coordination'));
	await assert.rejects(journal.save(record('blocked')), /real directory/);
	assert.deepEqual(fs.readdirSync(outside), []);
});


test('explicit revision invalidates other instances even with a coarse directory timestamp', async (t) => {
 const { directory, journal, record } = fixture(t);
 const other = new NodeFileOperationJournal({ directory });
 for (const instance of [journal, other]) {
  const stamp = instance.fileStamp.bind(instance);
  instance.fileStamp = target => target === directory ? Promise.resolve('coarse-stamp') : stamp(target);
 }
 await journal.loadByIdempotencyKey('new');
 const oldCatalog = journal.directoryCatalog;
 await other.save(record('external'));
 await journal.loadByIdempotencyKey('another-new');
 assert.notEqual(journal.directoryCatalog, oldCatalog);
 const ref = path.join(directory, `.idempotency-${crypto.createHash('sha256').update('key-external').digest('hex')}.ref`);
 fs.unlinkSync(ref);
 assert.equal((await journal.loadByIdempotencyKey('key-external')).operation_id, 'operation-external');
});
