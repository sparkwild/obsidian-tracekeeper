import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	InMemoryKnowledgeIndex, scannedNoteFromContent, lintNotes,
	REQUIRED_ARCHITECTURE_ENTRIES, computeFileVersion, TRACEKEEPER_AGENT_ACTIVITY_DIR,
	encodeMaintenanceCursor, decodeMaintenanceCursor,
} from '@tracekeeper/core';
import { callTool } from '../dist/index.js';

function fixture(t, extra = []) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-lint-diagnostics-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const make = (relativePath, content) => scannedNoteFromContent({
		absolutePath: path.join(root, relativePath), relativePath, fallbackTitle: relativePath,
		content, size: Buffer.byteLength(content), modifiedAt: '2026-09-08T00:00:00.000Z',
	});
	const notes = [...REQUIRED_ARCHITECTURE_ENTRIES.map(row => [row.path, '# Entry\n']), ...extra]
		.map(([relativePath, content]) => make(relativePath, content));
	for (const note of notes) {
		fs.mkdirSync(path.dirname(note.absolutePath), { recursive: true });
		fs.writeFileSync(note.absolutePath, note.text);
	}
	const scan = { vaultRoot: root, scannedAt: '2026-09-08T00:00:00.000Z', notes, errors: [] };
	const index = new InMemoryKnowledgeIndex({ vaultRoot: root, initialScan: scan });
	const context = { defaultVaultRoot: root, transport: 'obsidian-direct', credentialCapabilities: ['vault.read'] };
	const run = (view, args = {}) => callTool('tracekeeper.lint', { graph_profile: 'off', max_items: 200, ...args }, {
		...context, ...(view ? { knowledgeReadViewProvider: async () => view } : {}),
	});
	return { root, notes, make, index, run };
}
const proposalPath = n => `00_tracekeeper/inbox/review_queue/proposal-${n}.md`;
function task(n, ids, { legacy = false, session = false, lines } = {}) {
	const paths = ids.map(proposalPath), links = ids.map(id => `[[proposal-${id}]]`);
	return [`00_tracekeeper/work/${session ? 'sessions' : 'tasks'}/${n}.md`, [
		'---', `type: ${session ? 'session-note' : 'agent-task'}`,
		`proposal_ids: ${JSON.stringify(ids.map(id => 'proposal-' + id))}`,
		`proposal_paths: ${JSON.stringify(paths)}`,
		`proposal_links: ${JSON.stringify(legacy ? links.join(', ') : links)}`, '---', '# Task',
		...(lines ?? ids.map((id, i) => `- ${links[i]} ^tracekeeper-proposal-proposal-${id}`)),
	].join('\n')];
}
const managed = rows => rows.filter(row => row.kind.startsWith('managed_proposal_reference_'));

// 对真实整理场景使用合成内容，不读取正式 Vault。
test('four tasks and 25 valid proposal mirrors agree through indexed and filesystem lint', async t => {
	const groups = [Array.from({ length: 11 }, (_, i) => i), Array.from({ length: 12 }, (_, i) => i + 11), [23], [24]];
	const f = fixture(t, [
		...Array.from({ length: 25 }, (_, i) => [proposalPath(i), '# Proposal\n']),
		...groups.map((ids, i) => task('task-' + i, ids, { session: i === 3 })),
	]);
	for (const view of [await f.index.readView(), null]) {
		const r = await f.run(view);
		assert.equal(r.isError, false, JSON.stringify(r.structuredContent));
		assert.deepEqual(managed(r.structuredContent.issues), []);
		assert.equal(r.structuredContent.issue_count, 0);
		assert.match(r.structuredContent.fix_plan_summary.join(' '), /no lint issues were found/);
	}
});

test('valid legacy links receive only format advice; claims retain source checks', async t => {
	const f = fixture(t, [[proposalPath(1), '# P1'], [proposalPath(2), '# P2'],
		task('legacy-many', [1, 2], { legacy: true }), task('legacy-single', [1], { legacy: true, session: true }),
		['01_knowledge/wiki/claims.md', '# Claims\n\n> [!claim] Unsupported\n> Text\n\n> [!claim] Supported\n> source:: [[proposal-1]]\n'],
		['01_knowledge/sources/files/raw.md', '---\ntype: source_capture\n---\n# Raw\n[[missing-raw-evidence]]\n'],
		['01_knowledge/wiki/empty.md', ''],
	]);
	const core = lintNotes(f.root, f.notes, { graphProfile: 'off' });
	for (const view of [await f.index.readView(), null]) {
		const r = await f.run(view), payload = r.structuredContent;
		assert.equal(r.isError, false, JSON.stringify(r.structuredContent));
		assert.deepEqual(payload.issues, core.issues);
		assert.deepEqual(managed(payload.issues).map(i => i.kind), ['managed_proposal_reference_legacy_format']);
		assert.deepEqual(payload.issues.filter(i => i.kind === 'claim_missing_source').map(i => i.line), [3]);
		assert.equal(payload.issues.some(i => i.kind === 'broken_wikilink'), false);
		assert.match(payload.fix_plan_summary.join(' '), /YAML array/);
		assert.doesNotMatch(payload.fix_plan_summary.join(' '), /no lint issues/);
	}
});

test('missing, repeated, wrong, deleted and ambiguous references remain findings with actual marker lines', async t => {
	const f = fixture(t, [[proposalPath(1), '# P1'], [proposalPath(2), '# P2'],
		task('missing-marker', [1], { lines: ['- [[proposal-1]]'] }),
		task('repeated-marker', [1], { lines: ['- [[proposal-1]] ^tracekeeper-proposal-proposal-1', '- [[proposal-1]] ^tracekeeper-proposal-proposal-1'] }),
		task('wrong-target', [1], { lines: ['- [[proposal-2]] ^tracekeeper-proposal-proposal-1'] }),
		task('deleted-target', [3]),
		[task('ambiguous', [1])[0], task('ambiguous', [1])[1].replace('proposal_ids: ["proposal-1"]', 'proposal_ids: ["proposal-1","proposal-2"]')],
	]);
	const r = await f.run(await f.index.readView());
	assert.equal(r.isError, false, JSON.stringify(r.structuredContent));
	const rows = managed(r.structuredContent.issues);
	assert.equal(rows.length, 5);
	assert.equal(rows.find(i => i.path.endsWith('wrong-target.md')).line, 8);
	assert.equal(rows.find(i => i.path.endsWith('repeated-marker.md')).line, 8);
	assert.equal(rows.find(i => i.path.endsWith('deleted-target.md')).line, 8);
	assert.equal(rows.find(i => i.path.endsWith('ambiguous.md')).kind, 'managed_proposal_reference_ambiguous');
	assert.match(r.structuredContent.fix_plan_summary.join(' '), /positionally aligned/);
});

test('summary never calls an unhandled finding a clean result', async t => {
	const f = fixture(t, [['01_knowledge/memory/global/memory.md', '---\ntype: memory\n---\n# Legacy']]);
	const r = await f.run(await f.index.readView());
	assert.deepEqual(r.structuredContent.issues.map(i => i.kind), ['memory_legacy_unkeyed']);
	assert.match(r.structuredContent.fix_plan_summary.join(' '), /reported issue details/);
	assert.doesNotMatch(r.structuredContent.fix_plan_summary.join(' '), /no lint issues/);
});

test('diagnostic snapshots survive mutation, rename and deletion and do not expose mutable index state', async t => {
	const f = fixture(t, [[proposalPath(1), '# P1'], task('one', [1])]);
	const old = await f.index.readView(), original = old.diagnosticReader.read(task('one', [1])[0]);
	const copy = old.diagnosticReader.read(original.path);
	copy.frontmatter.proposal_ids.push('other');
	copy.edges[0].resolution.path = 'wrong.md';
	assert.deepEqual(old.diagnosticReader.read(original.path), original);
	const changed = f.make(original.path, original.text.replace('^tracekeeper-proposal-proposal-1', ''));
	await f.index.applyScanned({ kind: 'modify', path: changed.path, fileVersion: computeFileVersion(changed.size, changed.modifiedAt) }, changed);
	const edited = await f.index.readView();
	assert.equal(managed((await f.run(old)).structuredContent.issues).length, 0);
	assert.equal(managed((await f.run(edited)).structuredContent.issues).length, 1);
	const renamed = f.make('00_tracekeeper/work/tasks/renamed.md', original.text);
	await f.index.applyScanned({ kind: 'rename', path: original.path, newPath: renamed.path, fileVersion: computeFileVersion(renamed.size, renamed.modifiedAt) }, renamed);
	const moved = await f.index.readView();
	assert.equal(moved.diagnosticReader.read(original.path), null);
	assert.equal(edited.diagnosticReader.read(renamed.path), null);
	await f.index.applyScanned({ kind: 'delete', path: proposalPath(1), fileVersion: 'deleted' });
	const deleted = await f.index.readView();
	assert.equal(deleted.diagnosticReader.read(proposalPath(1)), null);
	assert.ok(old.diagnosticReader.read(proposalPath(1)));
	assert.equal(managed((await f.run(moved)).structuredContent.issues).length, 0);
	assert.equal(managed((await f.run(deleted)).structuredContent.issues).length, 1);
});

test('activity changes inventory generation without invalidating lint knowledge generation', async t => {
	const f = fixture(t, [[proposalPath(1), '# P1'], task('one', [1])]);
	const old = await f.index.readView();
	const activity = f.make(TRACEKEEPER_AGENT_ACTIVITY_DIR + '/2026/2026-09-08.md', '# Activity\n');
	await f.index.applyScanned({ kind: 'create', path: activity.path, fileVersion: computeFileVersion(activity.size, activity.modifiedAt) }, activity);
	const next = await f.index.readView();
	assert.notEqual(old.generation, next.generation);
	assert.equal(old.knowledge_generation, next.knowledge_generation);
	const r = await f.run(next);
	assert.equal(r.isError, false, JSON.stringify(r.structuredContent));
	assert.equal(r.structuredContent.snapshot_generation, old.knowledge_generation);
	assert.equal(managed(r.structuredContent.issues).length, 0);
});

test('incomplete diagnostic readers fail with retryable INDEX_NOT_READY', async t => {
	const f = fixture(t), view = await f.index.readView();
	const reader = view.diagnosticReader;
	const broken = [
		{ ...view, index_state: 'initializing' }, { ...view, index_state: 'rebuilding' },
		{ ...view, errors: [{ path: 'missing.md', error: 'unreadable' }] },
		{ ...view, diagnosticReader: undefined },
		{ ...view, diagnosticReader: { ...reader, generation: reader.generation + 1 } },
		{ ...view, diagnosticReader: { ...reader, read: () => null } },
		{ ...view, diagnosticReader: { ...reader, read: () => { throw new Error('sensitive body sentinel'); } } },
		...[{ path: 'wrong.md' }, { relativePath: 'wrong.md' }, { contentHash: '0'.repeat(64) }, { text: 'different' }, { text: undefined }].map(patch => ({
			...view, diagnosticReader: { ...reader, read: p => ({ ...reader.read(p), ...patch }) },
		})),
	];
	for (const input of broken) {
		const r = await f.run(input);
		assert.equal(r.isError, true);
		assert.equal(r.structuredContent.error_detail.code, 'INDEX_NOT_READY');
		assert.equal(r.structuredContent.error_detail.retryable, true);
		assert.doesNotMatch(JSON.stringify(r), /sensitive body sentinel/);
	}
});

test('native resolution remains authoritative when a basename is ambiguous', async t => {
	const f = fixture(t, [[proposalPath(1), '# P1'], ['02_archive/review_queue/proposal-1.md', '# Archived P1'], task('native', [1])]);
	assert.ok(managed((await f.run(await f.index.readView())).structuredContent.issues).length > 0);
	const note = f.notes.find(n => n.path.endsWith('/native.md'));
	note.edges = note.edges.map(edge => ({ ...edge, resolution: { status: 'resolved', path: proposalPath(1), authority: 'native' } }));
	note.wikilinks = note.edges;
	await f.index.rebuild({ vaultRoot: f.root, scannedAt: '2026-09-08T00:00:00.000Z', notes: f.notes, errors: [] });
	const view = await f.index.readView();
	assert.ok(view.diagnosticReader.read(note.path).edges.every(e => e.resolution.authority === 'native'));
	const r = await f.run(view);
	assert.equal(r.isError, false, JSON.stringify(r.structuredContent));
	assert.deepEqual(managed(r.structuredContent.issues), []);
});

test('hot lint performs no note-body IO or storage writes', async t => {
	const f = fixture(t, [[proposalPath(1), '# P1'], task('one', [1])]);
	const view = await f.index.readView(), paths = new Set(f.notes.map(n => n.absolutePath));
	const originals = [], attempts = [];
	const guard = (object, key, writes) => {
		const original = object[key]; originals.push(() => { object[key] = original; });
		object[key] = function (...args) {
			if (writes || paths.has(String(args[0]))) { attempts.push(key); throw new Error('Unexpected IO'); }
			return original.apply(this, args);
		};
	};
	try {
		for (const key of ['readFileSync', 'openSync']) guard(fs, key, false);
		for (const key of ['readFile', 'open']) guard(fs.promises, key, false);
		for (const key of ['mkdirSync', 'writeFileSync', 'appendFileSync', 'renameSync', 'unlinkSync']) guard(fs, key, true);
		for (const key of ['mkdir', 'writeFile', 'appendFile', 'rename', 'unlink']) guard(fs.promises, key, true);
		const r = await f.run(view);
		assert.equal(r.isError, false, JSON.stringify(r.structuredContent));
		assert.deepEqual(attempts, []);
	} finally { for (const restore of originals.reverse()) restore(); }
});

// 问题数量与维护候选分页分别验证，避免再次用问题上限产生越界页长。
test('lint page defaults respect the 200-candidate boundary even with no candidates', async t => {
	const f = fixture(t), view = await f.index.readView();
	for (const [args, expected] of [
		[{ max_items: undefined }, 40], [{ max_items: 1 }, 1],
		[{ max_items: 199 }, 199], [{ max_items: 200 }, 200],
		[{ max_items: 201 }, 200], [{ max_items: 2000 }, 200],
		[{ max_items: 2000, page_size: 50 }, 50],
		[{ max_items: 1, page_size: 200 }, 200],
	]) {
		const r = await f.run(view, args);
		assert.equal(r.isError, false, JSON.stringify(r.structuredContent));
		assert.equal(r.structuredContent.maintenance.page_size, expected);
		assert.equal(r.structuredContent.maintenance.candidate_count, 0);
		assert.deepEqual(r.structuredContent.maintenance.candidates, []);
		assert.equal(r.structuredContent.maintenance.cursor, null);
	}
});

test('invalid explicit lint limits are rejected before the index is read', async t => {
	const f = fixture(t);
	for (const args of [
		...[0, -1, 2001, 1.5, '200'].map(max_items => ({ max_items })),
		...[0, -1, 201, 1.5, '200'].map(page_size => ({ page_size })),
	]) {
		let reads = 0;
		const r = await callTool('tracekeeper.lint', args, {
			defaultVaultRoot: f.root, transport: 'obsidian-direct', credentialCapabilities: ['vault.read'],
			knowledgeReadViewProvider: async () => { reads++; throw new Error('Index must not be read'); },
		});
		assert.equal(r.isError, true);
		assert.equal(r.structuredContent.error_detail.code, 'INVALID_REQUEST');
		assert.equal(reads, 0);
	}
});

test('201 maintenance candidates page without loss while issue limits remain independent', async t => {
	const f = fixture(t, [
		...Array.from({ length: 201 }, (_, i) => [
			`01_knowledge/sources/files/source-${i}.md`, `---\ntype: source_capture\n---\n# Source ${i}\n`,
		]),
		['notes/claims.md', '# Claims\n\n' + Array.from({ length: 205 }, (_, i) =>
			`> [!claim] Claim ${i}\n> No source.\n`).join('\n')],
	]);
	const view = await f.index.readView();
	const firstResult = await f.run(view, { max_items: 201 });
	assert.equal(firstResult.isError, false, JSON.stringify(firstResult.structuredContent));
	const first = firstResult.structuredContent;
	assert.equal(first.issue_count, 205);
	assert.equal(first.issues.length, 201);
	assert.equal(first.maintenance.candidate_count, 201);
	assert.equal(first.maintenance.candidates.length, 200);
	const cursor = first.maintenance.cursor;
	assert.equal(typeof cursor, 'string');
	assert.equal(decodeMaintenanceCursor(cursor).page_size, 200);
	const secondResult = await f.run(view, { max_items: 2000, cursor });
	assert.equal(secondResult.isError, false, JSON.stringify(secondResult.structuredContent));
	const second = secondResult.structuredContent;
	assert.equal(second.issue_count, 205);
	assert.equal(second.issues.length, 205);
	assert.equal(second.maintenance.candidate_count, 201);
	assert.equal(second.maintenance.candidates.length, 1);
	assert.equal(second.maintenance.cursor, null);
	const ids = [...first.maintenance.candidates, ...second.maintenance.candidates].map(c => c.candidate_id);
	assert.equal(new Set(ids).size, 201);
	const all = await f.run(view, { max_items: 1, page_size: 200 });
	assert.equal(all.structuredContent.issues.length, 1);
	assert.deepEqual(all.structuredContent.maintenance.candidates.map(c => c.candidate_id), ids.slice(0, 200));
	for (const args of [{ max_items: 199 }, { page_size: 199 }, { graph_profile: 'strict' }]) {
		const wrong = await f.run(view, { max_items: 2000, cursor, ...args });
		assert.equal(wrong.structuredContent.error_detail.code, 'INVALID_CURSOR');
	}
	const activity = f.make(TRACEKEEPER_AGENT_ACTIVITY_DIR + '/2026/2026-09-08.md', '# Activity');
	await f.index.applyScanned({ kind: 'create', path: activity.path, fileVersion: computeFileVersion(activity.size, activity.modifiedAt) }, activity);
	const afterActivity = await f.run(await f.index.readView(), { max_items: 2000, cursor });
	assert.equal(afterActivity.isError, false);
	assert.deepEqual(afterActivity.structuredContent.maintenance.candidates, second.maintenance.candidates);
	const changed = f.make('01_knowledge/wiki/changed.md', '# Changed');
	await f.index.applyScanned({ kind: 'create', path: changed.path, fileVersion: computeFileVersion(changed.size, changed.modifiedAt) }, changed);
	const stale = await f.run(await f.index.readView(), { max_items: 2000, cursor });
	assert.equal(stale.structuredContent.error_detail.code, 'STALE_CURSOR');
});

test('maintenance cursor decoder rejects out-of-range page sizes with valid checksums', async t => {
	const f = fixture(t), view = await f.index.readView();
	for (const page_size of [0, 201, 2000]) {
		const cursor = encodeMaintenanceCursor({ version: 1, generation: view.knowledge_generation, profile: 'off', page_size, offset: 0 });
		assert.throws(() => decodeMaintenanceCursor(cursor), /cursor is invalid/);
		const r = await f.run(view, { cursor });
		assert.equal(r.structuredContent.error_detail.code, 'INVALID_CURSOR');
	}
	for (const page_size of [1, 200]) {
		const payload = { version: 1, generation: view.knowledge_generation, profile: 'off', page_size, offset: 0 };
		assert.deepEqual(decodeMaintenanceCursor(encodeMaintenanceCursor(payload)), payload);
	}
});
