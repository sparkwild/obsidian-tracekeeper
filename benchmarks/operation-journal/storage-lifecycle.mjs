import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { NodeFileOperationJournal } from '@tracekeeper/core';
const [baselineFile, output] = process.argv.slice(2);
if (!baselineFile || !output || !path.isAbsolute(baselineFile) || !path.isAbsolute(output))
	throw new Error('Provide absolute baseline module and report directory.');
const baseline = createRequire(import.meta.url)(baselineFile);
await fs.mkdir(output, { recursive: true });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-log-scale-'));
const payload = { text: 'Synthetic lossless journal fixture. '.repeat(256) };
const report = { node: process.version, platform: process.platform, baseline_sha256: crypto.createHash('sha256').update(await fs.readFile(baselineFile)).digest('hex'), candidate_sha256: crypto.createHash('sha256').update(await fs.readFile(new URL('../../packages/core/dist/operation-journal.js', import.meta.url))).digest('hex'), archive_sha256: crypto.createHash('sha256').update(await fs.readFile(new URL('../../packages/core/dist/log-archive.js', import.meta.url))).digest('hex'), cases: [] };
const makeRecord = n => ({ operation_id: `operation-${n}`, idempotency_key: `key-${n}`, payload_hash: baseline.computePayloadHash(payload), payload, completed_steps: [], status: 'completed', result: { ok: true, index: n }, created_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z' });
async function inventory(root) { let files = 0, bytes = 0; for (const entry of await fs.readdir(root, { withFileTypes: true })) {
	const p = path.join(root, entry.name);
	if (entry.isDirectory()) {
		const child = await inventory(p);
		files += child.files;
		bytes += child.bytes;
	}
	else {
		files++;
		bytes += (await fs.stat(p)).size;
	}
} return { files, bytes }; }
async function measure(action) {
	const counters = { lists: 0, full_reads: 0, range_reads: 0, read_bytes: 0, opens: 0, decryptions: 0 };
	const read = fs.readFile, list = fs.readdir, open = fs.open, decipher = crypto.createDecipheriv;
	fs.readFile = async (...args) => { counters.full_reads++; const result = await read(...args); counters.read_bytes += Buffer.byteLength(result); return result; };
	fs.open = async (...args) => { counters.opens++; const handle = await open(...args), readAll = handle.readFile.bind(handle), readRange = handle.read.bind(handle); handle.readFile = async (...values) => { counters.full_reads++; const result = await readAll(...values); counters.read_bytes += Buffer.byteLength(result); return result; }; handle.read = async (...values) => { const result = await readRange(...values); counters.range_reads++; counters.read_bytes += result.bytesRead; return result; }; return handle; };
	fs.readdir = async (...args) => { counters.lists++; return list(...args); };
	crypto.createDecipheriv = (...args) => { counters.decryptions++; return decipher(...args); };
	const start = performance.now();
	try {
		await action();
		return { ms: performance.now() - start, ...counters, rss: process.memoryUsage().rss };
	}
	finally {
		fs.readFile = read;
		fs.readdir = list;
		fs.open = open;
		crypto.createDecipheriv = decipher;
	}
}
try {
	for (const size of [1000, 10000, 20000]) {
		const directory = path.join(temporary, String(size));
		const original = new baseline.NodeFileOperationJournal({ directory });
		await original.save(makeRecord(0));
		// 夹具准备不计时；仍使用基线编码器产生真实身份绑定与恢复证明。
		for (let start = 1; start < size; start += 32)
			await Promise.all(Array.from({ length: Math.min(32, size - start) }, async (_, offset) => {
				const record = makeRecord(start + offset), stored = await original.persistedRecord(record), anchor = await original.buildProgressAnchor(record);
				await Promise.all([
					fs.writeFile(path.join(directory, `${record.operation_id}.json`), JSON.stringify(stored)),
					fs.writeFile(path.join(directory, `.progress-${record.operation_id}.anchor`), JSON.stringify(anchor)),
					fs.writeFile(path.join(directory, `.idempotency-${crypto.createHash('sha256').update(record.idempotency_key).digest('hex')}.ref`), record.operation_id + '\n')
				]);
			}));
		const before = await inventory(directory), baselineCold = await measure(() => original.loadByIdempotencyKey('missing-before'));
		const candidate = new NodeFileOperationJournal({ directory });
		const archiveStart = performance.now();
		let archived = 0;
		for (;;) {
			const result = await candidate.archiveCompleted();
			archived += result.archived;
			if (!result.archived)
				break;
		}
		const archiveMs = performance.now() - archiveStart, after = await inventory(directory);
		assert.equal(archived, size);
		assert.ok(after.files <= before.files * 0.1);
		assert.ok(after.bytes <= before.bytes * 0.5);
		const fresh = new NodeFileOperationJournal({ directory });
		const cold = await measure(async () => assert.equal(await fresh.loadByIdempotencyKey('missing-after'), null));
		const exact = await measure(async () => { const result = await fresh.loadByIdempotencyKey(`key-${size - 1}`); assert.deepEqual(result.payload, payload); assert.deepEqual(result.result, { ok: true, index: size - 1 }); });
		const recovery = await measure(async () => assert.deepEqual(await fresh.listRecoverable(), []));
		assert.equal(cold.decryptions, 0);
		assert.equal(recovery.decryptions, 0);
		const samples = [];
		for (let n = 0; n < 10; n++)
			samples.push((await measure(() => fresh.loadByIdempotencyKey(`absent-${n}`))).ms);
		samples.sort((a, b) => a - b);
		const row = { size, before, after, file_reduction: 1 - after.files / before.files, byte_reduction: 1 - after.bytes / before.bytes, archive_ms: archiveMs, baseline_cold: baselineCold, candidate_cold: cold, exact, recovery, warm_p50_ms: samples[4], warm_p95_ms: samples[9] };
		report.cases.push(row);
		await fs.writeFile(path.join(output, 'storage-lifecycle.json'), JSON.stringify(report, null, 2));
		console.log(JSON.stringify(row));
		await fs.rm(directory, { recursive: true, force: true });
	}
}
finally {
	await fs.rm(temporary, { recursive: true, force: true });
}
