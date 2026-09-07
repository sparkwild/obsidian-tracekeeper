import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { resolveOutputRoot } from '../knowledge-index/output-options.mjs';

if (process.argv.slice(2).length % 2 !== 0 || process.argv.slice(2).some((value, index) => index % 2 === 0 && !['--baseline-root', '--candidate-root', '--output-dir'].includes(value))) throw new Error('Unknown or incomplete journal benchmark option.');
const options = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, values) => index % 2 === 0 ? [...rows, [value, values[index + 1]]] : rows, []));
if (!options['--baseline-root'] || !options['--output-dir']) throw new Error('Use --baseline-root and --output-dir.');
const baselineRoot = path.resolve(options['--baseline-root']);
const candidateRoot = path.resolve(options['--candidate-root'] ?? process.cwd());
const output = resolveOutputRoot(options['--output-dir']);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output);
const implementations = Object.fromEntries(Object.entries({ baseline: baselineRoot, candidate: candidateRoot }).map(([label, root]) => [label, createRequire(path.join(root, 'package.json'))('@tracekeeper/core')]));
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const report = { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length, total_memory: os.totalmem(), results: [], fingerprints: {} };
for (const [label, root] of Object.entries({ baseline: baselineRoot, candidate: candidateRoot })) report.fingerprints[label] = sha(await fs.readFile(path.join(root, 'packages/core/dist/operation-journal.js')));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-journal-scale-'));
const makeRecord = (number) => ({ operation_id: `operation-${number}`, idempotency_key: `key-${number}`, payload: { text: 'Synthetic journal benchmark. '.repeat(100) },
	payload_hash: implementations.baseline.computePayloadHash({ text: 'Synthetic journal benchmark. '.repeat(100) }), status: 'completed',
	created_at: '2026-09-06T00:00:00Z', updated_at: '2026-09-06T00:00:00Z', completed_steps: [], result: { ok: true } });
const measure = async (journal, directory, action) => {
	const counts = { directory_lists: 0, record_reads: 0, historical_reference_reads: 0, decryptions: 0 };
	const read = fs.readFile, list = fs.readdir, decipher = crypto.createDecipheriv;
	crypto.createDecipheriv = (...args) => { counts.decryptions++; return decipher(...args); };
	fs.readFile = async (...args) => {
		const target = String(args[0]);
		if (path.dirname(target) === directory && target.endsWith('.json')) counts.record_reads++;
		const result = await read(...args);
		if (path.dirname(target) === directory && target.endsWith('.ref')) counts.historical_reference_reads++;
		return result;
	};
	fs.readdir = async (...args) => { if (String(args[0]) === directory) counts.directory_lists++; return list(...args); };
	global.gc?.();
	const before = process.memoryUsage();
	let peak = before.rss;
	let heapPeak = before.heapUsed;
	const timer = setInterval(() => {
		const current = process.memoryUsage();
		peak = Math.max(peak, current.rss);
		heapPeak = Math.max(heapPeak, current.heapUsed);
	}, 10);
	const started = performance.now();
	try {
		await action();
		const after = process.memoryUsage();
		return { duration_ms: performance.now() - started, ...counts, rss_before: before.rss, rss_peak: Math.max(peak, after.rss), heap_peak: Math.max(heapPeak, after.heapUsed), heap_after: after.heapUsed };
	} finally { clearInterval(timer); fs.readFile = read; fs.readdir = list; crypto.createDecipheriv = decipher; }
};
try {
	for (const size of [1000, 10000]) {
		const seed = path.join(root, `seed-${size}`);
		const seedJournal = new implementations.baseline.NodeFileOperationJournal({ directory: seed });
		await seedJournal.save(makeRecord(0));
		// 夹具准备不计时；密钥建立后并行写独立记录，避免准备阶段占用规模验证预算。
		for (let start = 1; start < size; start += 8) {
			await Promise.all(Array.from({ length: Math.min(8, size - start) }, (_, offset) => seedJournal.save(makeRecord(start + offset))));
		}
		for (const [label, module] of Object.entries(implementations)) {
			const directory = path.join(root, `${label}-${size}`);
			await fs.cp(seed, directory, { recursive: true });
			const journal = new module.NodeFileOperationJournal({ directory });
			const cold = await measure(journal, directory, async () => { if (await journal.loadByIdempotencyKey('missing-cold')) throw new Error('Unexpected cold match.'); });
			const samples = [];
			for (let sample = 0; sample < 5; sample++) samples.push(await measure(journal, directory, async () => {
				const release = await journal.acquireLock(`new-${sample}`);
				try {
					if (await journal.loadByIdempotencyKey(`new-${sample}`)) throw new Error('Unexpected warm match.');
					await journal.save({ ...makeRecord(`new-${sample}`), idempotency_key: `new-${sample}` });
				} finally { await release(); }
			}));
			const exact = await measure(journal, directory, async () => { if ((await journal.loadByIdempotencyKey('key-0'))?.operation_id !== 'operation-0') throw new Error('Exact retry mismatch.'); });
			const recovery = await measure(journal, directory, async () => { if ((await journal.listRecoverable()).length !== 0) throw new Error('Unexpected recovery candidate.'); });
			const ordered = samples.map((sample) => sample.duration_ms).sort((a, b) => a - b);
			const result = { label, size, cold, warm_samples: samples, warm_p50_ms: ordered[2], warm_p95_ms: ordered[4], exact, recovery,
				bounded_warm_lookup: samples.every((sample) => sample.directory_lists === 0 && sample.historical_reference_reads === 0 && sample.record_reads === 1 && sample.decryptions === 0) };
			report.results.push(result);
			await fs.writeFile(path.join(output, 'journal-scale.json'), `${JSON.stringify(report, null, 2)}\n`);
			console.log(JSON.stringify({ label, size, warm_p50_ms: result.warm_p50_ms, bounded_warm_lookup: result.bounded_warm_lookup }));
			if (label === 'candidate' && !result.bounded_warm_lookup) process.exitCode = 1;
		}
	}
} finally { await fs.rm(root, { recursive: true, force: true }); }
