import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';
import { build } from 'esbuild';
import { hashVaultContent, scannedNoteFromContent, toIndexedKnowledgeNote } from '@tracekeeper/core';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-ui-regressions-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const require = createRequire(import.meta.url);
class Base {
	constructor() { this.app = {}; }
	async onClose() {}
}
const obsidian = { ItemView: Base, Modal: Base, Notice: Base, TFile: Base, Setting: Base, getLanguage: () => 'en' };
async function load(relativePath) {
	const result = await build({ entryPoints: [path.resolve(relativePath)], bundle: true, platform: 'node', format: 'cjs',
		write: false, external: ['obsidian'], logLevel: 'silent' });
	const entry = new Module(path.join(temp, `${path.basename(relativePath)}.cjs`));
	entry.filename = path.join(temp, `${path.basename(relativePath)}.cjs`);
	entry.require = name => name === 'obsidian' ? obsidian : require(name);
	entry._compile(result.outputFiles[0].text, entry.filename);
	return entry.exports;
}

for (const [file, className, loadMethod] of [
	['memory/memory-inspector-view', 'TracekeeperMemoryInspectorView', 'loadMemoryInspectorSnapshot'],
	['sources/source-status-view', 'TracekeeperSourceStatusView', 'loadSourceStatusSnapshot'],
]) {
	test(`${className} ignores stale responses and responses after close`, async () => {
		const View = (await load(`src/features/${file}.ts`))[className];
		const requests = [];
		const view = new View({}, { [loadMethod]: query => new Promise(resolve => requests.push({ query, resolve })) });
		const rendered = [];
		view.render = async snapshot => rendered.push(snapshot.scope);
		view.query = { scope: 'global' };
		const old = view.refresh();
		view.query = { scope: 'project' };
		const current = view.refresh();
		requests[1].resolve({ scope: 'project' });
		await current;
		requests[0].resolve({ scope: 'global' });
		await old;
		assert.deepEqual(rendered, ['project']);
		const closing = view.refresh();
		await view.onClose();
		requests[2].resolve({ scope: 'closed' });
		await closing;
		assert.deepEqual(rendered, ['project']);
	});
}

test('review auto-refresh preserves focused input as well as the detail view', async () => {
	const { TracekeeperReviewQueueView } = await load('src/features/review/review-queue-view.ts');
	let reads = 0;
	const view = new TracekeeperReviewQueueView({}, { loadMemoryReviewQueueSnapshot: async () => { reads++; return { windowOffset: 0 }; } });
	view.contentEl = { ownerDocument: { activeElement: { tagName: 'INPUT' } }, contains: () => true };
	view.render = async () => {};
	await view.refresh({ automatic: true });
	assert.equal(reads, 0);
	view.contentEl.contains = () => false;
	await view.refresh({ automatic: true });
	assert.equal(reads, 1);
	view.contentEl.contains = () => true;
	view.contentEl.ownerDocument.activeElement = { tagName: 'BUTTON', getAttribute: () => null };
	await view.refresh({ automatic: true });
	assert.equal(reads, 2);
});

test('single rename reads affected files only and folder changes remove obsolete descendants', async () => {
	const { ObsidianKnowledgeIndexAdapter } = await load('src/knowledge-index-adapter.ts');
	const contents = new Map(Array.from({ length: 100 }, (_, i) => [`01_knowledge/wiki/n${i}.md`, `# N${i}`]));
	const files = new Map([...contents].map(([filePath, content]) => [filePath, {
		path: filePath, extension: 'md', basename: path.basename(filePath, '.md'), stat: { size: content.length, mtime: 1 },
	}]));
	let reads = 0;
	const app = { vault: { getMarkdownFiles: () => [...files.values()], getAbstractFileByPath: filePath => files.get(filePath),
		read: async file => { reads++; return contents.get(file.path); } },
		metadataCache: { getFileCache: () => ({}), getFirstLinkpathDest: () => null, resolvedLinks: {}, unresolvedLinks: {} } };
	const adapter = ObsidianKnowledgeIndexAdapter.create(app, temp);
	await adapter.rebuild();
	const oldPath = '01_knowledge/wiki/n0.md';
	const newPath = '01_knowledge/wiki/renamed.md';
	const file = files.get(oldPath);
	files.delete(oldPath); contents.set(newPath, contents.get(oldPath)); contents.delete(oldPath);
	file.path = newPath; file.basename = 'renamed'; files.set(newPath, file);
	reads = 0;
	await adapter.applyRename(file, oldPath);
	assert.equal(reads, 1);
	assert.equal((await adapter.knowledgeSnapshot()).notes.has(oldPath), false);
	for (const [old, file] of [...files]) {
		const moved = old.replace('/wiki/', '/moved/');
		contents.set(moved, contents.get(old)); contents.delete(old); files.delete(old); file.path = moved; files.set(moved, file);
	}
	await adapter.applyRename({ path: '01_knowledge/moved', children: [...files.values()] }, '01_knowledge/wiki');
	const snapshot = await adapter.knowledgeSnapshot();
	assert.equal(snapshot.notes.size, 100);
	assert.equal([...snapshot.notes.keys()].some(key => key.startsWith('01_knowledge/wiki/')), false);
	files.clear();
	await adapter.applyDelete({ path: '01_knowledge/moved', children: [] });
	assert.equal((await adapter.knowledgeSnapshot()).notes.size, 0);
});

test('verified source migration associates historical references without rewriting tasks', async () => {
	const { LegacySourceConsolidationController } = await load('src/features/sources/legacy-source-consolidation-controller.ts');
	const { buildSourceStatusSnapshot } = await load('src/features/observability/knowledge-observability-model.ts');
	const parent = '01_knowledge/sources/files/current.md';
	const part = '01_knowledge/sources/files/current.parts/part-0001.md';
	const old = '01_knowledge/sources/files/legacy-segment-001.md';
	const sourceId = `source-${'a'.repeat(32)}`;
	const contentHash = `sha256:${'b'.repeat(64)}`;
	const parentText = `---\ntype: source_capture\nsource: fixture\nsource_kind: file\nsource_id: ${sourceId}\ncontent_hash: ${contentHash}\nroute: 01_knowledge/sources/files\npart_count: 1\npart_manifest: [${JSON.stringify(part)}]\nmode: local_copy\n---\n# Source`;
	const partText = `---\ntype: source_part\nsource_id: ${sourceId}\ncontent_hash: ${contentHash}\nparent_source: ${parent}\npart_count: 1\npart_number: 1\nlegacy_source_path: ${old}\n---\nOriginal evidence`;
	const notes = [[parent, parentText], [part, partText]].map(([notePath, content]) => toIndexedKnowledgeNote(scannedNoteFromContent({
		absolutePath: path.join(temp, notePath), relativePath: notePath, fallbackTitle: notePath, size: content.length,
		modifiedAt: '2026-08-01T00:00:00.000Z', content,
	})));
	const base = { version: 1, migrationId: 'fixture', planHash: 'plan', revision: 1, status: 'completed', archive: [], updatedAt: '2026-08-01T00:00:00.000Z',
		outputs: notes.map((note, i) => ({ path: note.path, kind: i === 0 ? 'source_capture' : 'source_part', expectedHash: note.contentHash, legacyPath: i === 0 ? '' : old, state: 'verified', error: '' })) };
	const canonical = JSON.stringify(base, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
	const raw = JSON.stringify({ ...base, bindingHash: hashVaultContent(canonical) });
	const controller = new LegacySourceConsolidationController({ listJournalPaths: async () => ['00_tracekeeper/control/operations/source-consolidations/fixture.json'], readText: async () => raw });
	const hashes = new Map(notes.map(note => [note.path, note.contentHash]));
	const replacements = await controller.verifiedReplacements(hashes);
	assert.equal(replacements.get(old), parent);
	const task = { path: '00_tracekeeper/work/tasks/task.md', taskId: 'task', sourceCaptures: [old], proposals: [], sessionNote: '', objective: 'Imported sources', sortTimestamp: 0 };
	const input = { index: { state: 'ready', generation: 1, lastRebuild: '', notes, errors: [] }, tasks: [task], proposals: [], requests: [], missingSourceFolder: false, missingRequestFolder: false };
	const result = buildSourceStatusSnapshot({ ...input, sourceReplacements: replacements });
	assert.equal(result.staleRecordCount, 0);
	assert.deepEqual(result.records[0].historicalPaths, [old]);
	assert.deepEqual(task.sourceCaptures, [old]);
	hashes.set(part, 'changed');
	const invalid = await controller.verifiedReplacements(hashes);
	assert.equal(invalid.size, 0);
	assert.equal(buildSourceStatusSnapshot({ ...input, sourceReplacements: invalid }).staleRecordCount, 1);
});


test('historical diagnostics preserve records, distinguish receipt failures, and bound receipt reads', async () => {
	const { inspectHistoricalRecords } = await load('src/features/observability/historical-record-diagnostics.ts');
	const id = `propose-memory-${'a'.repeat(24)}`;
	const target = '01_knowledge/memory/global/absent.md';
	const oldSource = '01_knowledge/sources/files/old.md';
	const note = { path: '00_tracekeeper/work/tasks/task.md', contentHash: 'fixture-hash', frontmatter: {
		task_id: 'fixture-task', proposal_links: '[[one]], [[two]]', source_captures: [oldSource],
		auto_write_operation_ids: [id], memory_writes: [target],
	} };
	const original = structuredClone(note);
	const valid = { status: 'completed', payload: { requestSnapshot: { task_id: 'fixture-task' } }, result: { auto_applied: true, path: target } };
	const report = await inspectHistoricalRecords([note], new Map(), async () => valid);
	assert.deepEqual(report.entries.map((entry) => entry.kind), ['legacy_links', 'missing_source', 'missing_auto_target']);
	assert.equal(report.entries.every((entry) => entry.contentHash === 'fixture-hash'), true);
	assert.deepEqual(note, original);
	const missing = await inspectHistoricalRecords([note], new Map([[oldSource, '01_knowledge/sources/files/new.md']]), async () => null);
	assert.deepEqual(missing.entries.map((entry) => entry.kind), ['legacy_links', 'unverified_auto_receipt']);
	let reads = 0;
	const many = Array.from({ length: 60 }, (_, i) => ({ ...note, path: `task-${i}.md` }));
	const bounded = await inspectHistoricalRecords(many, new Map(), async () => { reads++; return null; });
	assert.equal(reads, 20);
	assert.equal(bounded.truncated, true);
	assert.equal(bounded.inspectedRecords, 50);
});

test('historical disclosure refresh preserves expansion and focus only for unchanged evidence', async () => {
	const { captureHistoricalDisclosureState, renderHistoricalDiagnostics } = await load('src/features/observability/historical-record-diagnostics.ts');
	const document = { activeElement: null };
	class Element {
		constructor(tagName = 'div') { this.tagName = tagName.toUpperCase(); this.ownerDocument = document; this.dataset = {}; this.children = []; this.open = false; }
		createEl(tagName) { const child = new Element(tagName); this.children.push(child); return child; }
		all() { return this.children.flatMap(child => [child, ...child.all()]); }
		querySelectorAll() { return this.all().filter(child => child.tagName === 'DETAILS' && child.dataset.tracekeeperHistoryKey !== undefined); }
		querySelector(tagName) { return this.all().find(child => child.tagName === tagName.toUpperCase()) ?? null; }
		focus(options) { document.activeElement = this; this.focusOptions = options; }
		empty() { this.children = []; document.activeElement = null; }
	}
	const container = new Element();
	const diagnostic = { entries: [{ kind: 'missing_source', ownerPath: 'task.md', contentHash: 'hash-a', targetPaths: ['missing.md'], evidence: ['source_captures'] }], inspectedRecords: 1, totalRecords: 1, truncated: false };
	const ui = (_zh, en) => en;
	renderHistoricalDiagnostics(container, diagnostic, ui);
	let [panel, row] = container.querySelectorAll();
	panel.open = true; row.open = true; row.querySelector('summary').focus();
	const first = captureHistoricalDisclosureState(container);
	container.empty();
	renderHistoricalDiagnostics(container, structuredClone(diagnostic), ui, first);
	[panel, row] = container.querySelectorAll();
	assert.equal(panel.open, true); assert.equal(row.open, true);
	assert.equal(document.activeElement, row.querySelector('summary'));
	assert.deepEqual(document.activeElement.focusOptions, { preventScroll: true });

	const second = captureHistoricalDisclosureState(container);
	container.empty();
	const changed = structuredClone(diagnostic); changed.entries[0].contentHash = 'hash-b';
	renderHistoricalDiagnostics(container, changed, ui, second);
	[panel, row] = container.querySelectorAll();
	assert.equal(panel.open, true); assert.equal(row.open, false);
	assert.equal(document.activeElement, panel.querySelector('summary'));

	const third = captureHistoricalDisclosureState(container);
	container.empty(); const refresh = container.createEl('button');
	renderHistoricalDiagnostics(container, undefined, ui, third);
	assert.equal(document.activeElement, refresh);
	const beforeUnfocused = captureHistoricalDisclosureState(container);
	renderHistoricalDiagnostics(container, diagnostic, ui, beforeUnfocused);
	assert.equal(document.activeElement, refresh, 'A refresh must not steal unrelated focus.');
});
