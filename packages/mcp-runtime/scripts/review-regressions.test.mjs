import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InMemoryKnowledgeIndex, NodeFsVaultRepository, computeFileVersion, scanVault } from '@tracekeeper/core';
import { callTool, LOCAL_TRUST_CAPABILITIES } from '../dist/index.js';
import { resolveProjectIdentity } from '../dist/application/project-identity.js';
import { getContractByName } from '@tracekeeper/contracts';
import { validateStructuredContent } from '../dist/result-validation.js';

async function fixture(t) {
	const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-review-regressions-'));
	t.after(() => fs.rmSync(vaultRoot, { recursive: true, force: true }));
	const write = (relativePath, content) => {
		const absolute = path.join(vaultRoot, relativePath);
		fs.mkdirSync(path.dirname(absolute), { recursive: true });
		fs.writeFileSync(absolute, content);
	};
	write('01_knowledge/memory/global/a.md', '# Memory A');
	write('01_knowledge/memory/global/b.md', '# Memory B');
	write('01_knowledge/sources/files/unassociated.md', '---\ntype: source_capture\n---\n# Source');
	const index = new InMemoryKnowledgeIndex({ vaultRoot, initialScan: scanVault(vaultRoot) });
	const context = () => ({
		defaultVaultRoot: vaultRoot,
		vaultRepository: new NodeFsVaultRepository({ vaultRoot }),
		principalId: 'local-user',
		credentialCapabilities: [...LOCAL_TRUST_CAPABILITIES],
		agentId: 'review-regression',
		sessionId: 'review-regression-session',
		transport: 'streamable-http',
		knowledgeReadViewProvider: () => index.readView(),
	});
	const synchronize = async () => {
		const current = await index.readView();
		for (const note of scanVault(vaultRoot).notes) {
			if (current.catalog.get(note.path)?.contentHash === note.contentHash) continue;
			await index.applyScanned({
				kind: current.catalog.has(note.path) ? 'modify' : 'create',
				path: note.path,
				fileVersion: computeFileVersion(note.size, note.modifiedAt),
				exists: true,
				contentHash: note.contentHash,
			}, note);
		}
	};
	return { vaultRoot, index, context, write, synchronize };
}

function success(result) {
	assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
	return result.structuredContent;
}

test('MCP audit indexing preserves memory pagination but knowledge edits invalidate it', async (t) => {
	const f = await fixture(t);
	const args = { scope: 'global', view: 'all', page_size: 1 };
	const first = success(await callTool('tracekeeper.memory', args, f.context()));
	assert.equal(first.total, 2);
	assert.ok(first.page.next_cursor);
	await f.synchronize();
	assert.ok((await f.index.readView()).generation > first.generation);
	const second = success(await callTool('tracekeeper.memory', { ...args, cursor: first.page.next_cursor }, f.context()));
	assert.equal(second.generation, first.generation);
	assert.notEqual(second.entries[0].path, first.entries[0].path);
	f.write('01_knowledge/memory/global/c.md', '# Memory C');
	await f.synchronize();
	const stale = await callTool('tracekeeper.memory', { ...args, cursor: first.page.next_cursor }, f.context());
	assert.equal(stale.isError, true);
	assert.equal(stale.structuredContent.error_detail.code, 'STALE_CURSOR');
});

test('lint candidates survive their own MCP audit before a maintenance request', async (t) => {
	const f = await fixture(t);
	const lint = success(await callTool('tracekeeper.lint', { page_size: 20 }, f.context()));
	const candidate = lint.maintenance.candidates.find((row) => row.requestable);
	assert.ok(candidate);
	await f.synchronize();
	const result = success(await callTool('tracekeeper.request_maintenance', {
		snapshot_generation: lint.snapshot_generation,
		candidate_ids: [candidate.candidate_id],
		idempotency_key: 'maintenance-audit-regression',
	}, f.context()));
	assert.equal(result.status, 'pending');
});

test('memory does not claim a complete empty catalog before indexing is ready', async (t) => {
	const f = await fixture(t);
	const empty = new InMemoryKnowledgeIndex({ vaultRoot: f.vaultRoot });
	const result = await callTool('tracekeeper.memory', { scope: 'global', view: 'all' }, {
		...f.context(), knowledgeReadViewProvider: () => empty.readView(),
	});
	assert.equal(result.isError, true);
	assert.equal(result.structuredContent.error_detail.code, 'INDEX_NOT_READY');
	assert.equal(result.structuredContent.error_detail.retryable, true);
	assert.notEqual(result.structuredContent.complete, true);
});

for (const removeTarget of [false, true]) {
	test(`direct Auto memory is included in closeout, missing target=${removeTarget}`, async (t) => {
		const f = await fixture(t);
		f.write('01_knowledge/memory/global/index.md', '# Global memory');
		const context = () => ({ ...f.context(), knowledgeReadViewProvider: undefined,
			transport: 'obsidian-direct', memoryRules: { globalMemoryRule: 'auto_write' } });
		const started = success(await callTool('tracekeeper.start_task', {
			goal: 'Remember a fixture preference', idempotency_key: 'direct-auto-start',
		}, context()));
		const saved = success(await callTool('tracekeeper.propose_memory', {
			task_id: started.task_id, proposal_kind: 'agent_preference', content: 'Prefer concise fixture output.',
			memory_scope: 'global', claim_key: 'preference:regression', idempotency_key: 'direct-auto-propose',
		}, context()));
		assert.equal(saved.auto_applied, true);
		assert.ok(fs.existsSync(path.join(f.vaultRoot, saved.path)));
		if (removeTarget) fs.unlinkSync(path.join(f.vaultRoot, saved.path));
		const args = { task_id: started.task_id, status: 'completed', summary: 'Preference processed.', idempotency_key: 'direct-auto-finish' };
		const finished = success(await callTool('tracekeeper.finish_task', args, context()));
		assert.equal(finished.durable_output.status, removeTarget ? 'unresolved' : 'applied');
		assert.equal(finished.durable_output.applied_count, removeTarget ? 0 : 1);
		assert.equal(finished.durable_output.unresolved_count, removeTarget ? 1 : 0);
		assert.deepEqual(finished.durable_output.target_paths, [saved.path]);
		assert.equal(finished.memory_status, removeTarget ? 'conflict' : 'auto_saved');
		const retry = success(await callTool('tracekeeper.finish_task', args, context()));
		assert.deepEqual(retry.durable_output, finished.durable_output);
	});
}

test('Recall retains a title match beyond the old 32-row cutoff and finds long-note tail evidence', async (t) => {
	const f = await fixture(t);
	for (let i = 0; i < 50; i++) f.write(`01_knowledge/wiki/a-${String(i).padStart(3, '0')}.md`, `# Generic ${i}\nIncidental needle mention.`);
	f.write('01_knowledge/wiki/zzz-needle.md', '---\ntitle: Needle\n---\n# Canonical needle decision');
	f.write('01_knowledge/wiki/long.md', '# Long document\n' + Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ') + '\nTailmarker retention is 30 days.');
	await f.index.rebuild(scanVault(f.vaultRoot));
	const ranked = success(await callTool('tracekeeper.recall', { scope: 'global', query: 'needle' }, f.context()));
	assert.equal(ranked.matches[0].path, '01_knowledge/wiki/zzz-needle.md');
	const tail = success(await callTool('tracekeeper.recall', { scope: 'global', query: 'tailmarker' }, f.context()));
	assert.equal(tail.matches.length, 1);
	assert.match(tail.matches[0].excerpt, /30 days/);
});

test('note windows are bounded, reconstruct the original content and reject a changed note', async (t) => {
	const f = await fixture(t);
	const notePath = '01_knowledge/wiki/large.md';
	const content = '# Large\n' + 'Knowledge 😀 '.repeat(5000);
	f.write(notePath, content);
	let args = { path: notePath, max_chars: 4096 };
	let assembled = '';
	let first;
	for (let page = 0; page < 30; page++) {
		const result = success(await callTool('tracekeeper.read_note', args, f.context()));
		first ??= result;
		assert.ok(result.content.length <= 4097);
		assembled += result.content;
		if (result.next_offset === null) break;
		args = result.next_actions[0].arguments;
	}
	assert.equal(assembled, content);
	assert.equal(first.truncated, true);
	f.write(notePath, content + '\nChanged');
	const changed = await callTool('tracekeeper.read_note', first.next_actions[0].arguments, f.context());
	assert.equal(changed.isError, true);
	assert.equal(changed.structuredContent.error_detail.code, 'NOTE_CHANGED');
});

test('project name and returned project id apply the same repository conflict rule', async (t) => {
	const f = await fixture(t);
	f.write('01_knowledge/memory/projects/atlas/index.md', '---\ntype: project_memory_index\nproject_hint: atlas\nproject_id: project-atlas\nrepo_path: /workspace/atlas\n---\n# Atlas');
	const notes = scanVault(f.vaultRoot).notes;
	const input = { project_hint: 'atlas', repo_path: '/workspace/worktrees/atlas' };
	const initial = resolveProjectIdentity(input, notes);
	const reused = resolveProjectIdentity({ ...input, project_id: initial.projectId }, notes);
	assert.equal(initial.confidence, 'uncertain');
	assert.equal(reused.confidence, initial.confidence);
});

test('managed proposal links use YAML arrays and replace an existing block sequence cleanly', async (t) => {
	const f = await fixture(t);
	f.write('01_knowledge/memory/global/index.md', '# Global');
	const repository = new NodeFsVaultRepository({ vaultRoot: f.vaultRoot });
	repository.generateMarkdownLink = (target) => `[[${target}]]`;
	const context = () => ({ ...f.context(), vaultRepository: repository, knowledgeReadViewProvider: undefined,
		transport: 'obsidian-direct', memoryRules: { globalMemoryRule: 'review_queue' } });
	const start = success(await callTool('tracekeeper.start_task', { goal: 'Verify proposal links', idempotency_key: 'link-start' }, context()));
	for (let i = 0; i < 2; i++) {
		success(await callTool('tracekeeper.propose_memory', { task_id: start.task_id, memory_scope: 'global',
			proposal_kind: 'agent_preference', content: `Preference ${i}`, claim_key: `pref:links-${i}`, idempotency_key: `link-proposal-${i}` }, context()));
	}
	const { parseMarkdown } = await import('@tracekeeper/core');
	const taskPath = `00_tracekeeper/work/tasks/${start.task_id}.md`;
	let text = fs.readFileSync(path.join(f.vaultRoot, taskPath), 'utf8');
	const links = parseMarkdown(text).frontmatter.fields.proposal_links;
	assert.equal(Array.isArray(links), true);
	assert.equal(links.length, 2);
	text = text.replace(/^proposal_links:.*$/m, 'proposal_links:\n' + links.map(link => `  - ${JSON.stringify(link)}`).join('\n'));
	f.write(taskPath, text);
	success(await callTool('tracekeeper.propose_memory', { task_id: start.task_id, memory_scope: 'global',
		proposal_kind: 'agent_preference', content: 'Preference 2', claim_key: 'pref:links-2', idempotency_key: 'link-proposal-2' }, context()));
	const parsed = parseMarkdown(fs.readFileSync(path.join(f.vaultRoot, taskPath), 'utf8'));
	assert.deepEqual(parsed.frontmatter.errors, []);
	assert.equal(parsed.frontmatter.fields.proposal_links.length, 3);
});


test('read_note final windows end explicitly and preserve Unicode pairs', async (t) => {
	const f = await fixture(t);
	const notePath = '01_knowledge/wiki/unicode.md';
	f.write(notePath, 'A😀B');
	let offset = 0, hash, output = '', reads = 0;
	do {
		const result = success(await callTool('tracekeeper.read_note', { path: notePath, offset, max_chars: 1, ...(hash ? { expected_hash: hash } : {}) }, f.context()));
		hash ??= result.content_hash;
		assert.equal(result.content_hash, hash);
		assert.equal(result.content.includes('\ufffd'), false);
		assert.ok(result.content.length <= 2);
		output += result.content;
		offset = result.next_offset;
		reads++;
		if (offset === null) { assert.equal(result.truncated, true); assert.deepEqual(result.next_actions, []); }
	} while (offset !== null && reads < 10);
	assert.equal(output, 'A😀B');
	assert.equal(reads, 3);
});

test('read_note output contract still accepts legacy whole-note responses without pagination fields', async (t) => {
	const f = await fixture(t);
	const content = '# Legacy\n\n完整正文 😀';
	f.write('01_knowledge/wiki/legacy-read.md', content);
	const legacy = success(await callTool('tracekeeper.read_note', { path: '01_knowledge/wiki/legacy-read.md' }, f.context()));
	for (const field of ['content_hash', 'offset', 'next_offset', 'total_chars', 'truncated', 'next_actions']) delete legacy[field];
	const validation = validateStructuredContent(legacy, getContractByName('tracekeeper.read_note').outputSchema);
	assert.deepEqual(validation.errors, []);
	assert.equal(legacy.content, content);
	assert.equal(Object.hasOwn(legacy, 'next_offset'), false);
});

test('invalid Memory records are explicit incomplete diagnostics and are not retryable empty pages', async (t) => {
	const f = await fixture(t);
	f.write('01_knowledge/memory/global/invalid.md', '---\ntype: memory_record\n---\nMalformed record');
	await f.synchronize();
	const result = await callTool('tracekeeper.memory', { scope: 'global', view: 'all' }, f.context());
	assert.equal(result.structuredContent.ok, false);
	assert.equal(result.structuredContent.error_detail.code, 'MEMORY_CATALOG_INCOMPLETE');
	assert.equal(result.structuredContent.error_detail.retryable, false);
});
