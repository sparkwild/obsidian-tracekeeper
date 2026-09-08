import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyTaskMigration, assertTaskMigrationCommitted, createVaultOperationJournal, diagnoseTaskRelations, findTaskById, makeTaskRelation, maintainTaskNavigation, migrateTaskRecord, NodeFsVaultRepository, parseMarkdown, parseTaskRecord, patchTaskMetadata, pendingTaskMigrations, previewTaskMigration, readTaskVaultSnapshot, requireWritableTaskV2, resolveTaskRelations, restoreVaultBackup, renderTaskRelationProjection, taskPresentationFields, taskTargets, updateTaskRelations } from '../dist/index.js';

const task = (id, extra = '', body = '# User body\n') => `---\ntype: agent-task\ntask_id: ${id}\nstatus: completed\nstarted_at: 2026-09-01T00:00:00Z\nrepo_path: /work/example\n${extra}---\n${body}`;
async function fixture(t) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-relations-'));
	const vault = path.join(root, 'vault'); await fs.mkdir(vault);
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const repository = new NodeFsVaultRepository({ vaultRoot: vault });
	return { root, vault, repository };
}

test('V2 relations preserve original evidence while identities resolve rename, archive and replacement', () => {
	const original = task('task-one', 'source_captures: 01_knowledge/sources/a.md\n');
	const target = { path: '01_knowledge/sources/a.md', frontmatter: { type: 'source_capture', source_id: 'same-source', source_operation_id: 'capture-one' }, contentHash: 'original' };
	const other = { path: '01_knowledge/sources/b.md', frontmatter: { ...target.frontmatter, source_operation_id: 'capture-two' } };
	const migrated = migrateTaskRecord(original, [target, other]);
	const record = parseTaskRecord(parseMarkdown(migrated).frontmatter.fields);
	assert.equal(record.relations.length, 1);
	assert.equal(record.relations[0].recorded_path, target.path);
	assert.equal(record.relations[0].content_hash, 'original');
	const moved = { ...target, path: '02_archive/sources/renamed.md', contentHash: 'edited' };
	assert.equal(resolveTaskRelations(record, [moved, other])[0].current_path, moved.path);
	assert.equal(resolveTaskRelations(record, [moved, other])[0].location, 'archive');
	assert.equal(resolveTaskRelations(record, [{ ...other, path: target.path }])[0].status, 'missing');
	assert.equal(resolveTaskRelations(record, [target, moved])[0].status, 'ambiguous');
	assert.equal(record.relations[0].content_hash, 'original');
	assert.deepEqual(taskPresentationFields(migrated, [moved]).source_captures, [moved.path]);
});

test('unverified history stays explicit, YAML bodies survive, duplicate keys and path escapes fail closed', () => {
	const original = task('old', 'source_captures: 01_knowledge/sources/missing.md\ncustom: preserved\n', '# Original\n\nDo not change.\n').replace(/\n/g, '\r\n');
	const converted = migrateTaskRecord(original, []);
	assert.equal(converted.slice(converted.indexOf('\r\n---\r\n') + 7), original.slice(original.indexOf('\r\n---\r\n') + 7));
	assert.match(converted, /custom: preserved/);
	assert.doesNotMatch(converted, /^source_captures:/m);
	const parsed = parseTaskRecord(parseMarkdown(converted).frontmatter.fields);
	assert.equal(resolveTaskRelations(parsed, [])[0].status, 'unverified');
	assert.equal(migrateTaskRecord(converted, []), converted);
	assert.throws(() => migrateTaskRecord(task('bad', 'task_id: duplicate\n'), []));
	assert.throws(() => migrateTaskRecord(task('bad', 'memory_writes: ../outside.md\n'), []));
	assert.throws(() => parseTaskRecord({ task_record_version: 3, task_id: 'future' }));
	assert.throws(() => updateTaskRelations(original, []), /requires preview/);
	assert.match(patchTaskMetadata(converted, { status: 'partial' }), /status: partial/);
});

test('new relationship exact retries retain their original metadata and distinct captures remain distinct', () => {
	const content = migrateTaskRecord(task('one'), []);
	const first = makeTaskRelation({ taskId: 'one', role: 'captured_source', path: '01_knowledge/sources/a.md', target: { path: '01_knowledge/sources/a.md', frontmatter: { type: 'source_capture', source_operation_id: 'a' } }, operationId: 'a', recordedAt: '2026-09-01T00:00:00Z' });
	const next = updateTaskRelations(content, [first]);
	assert.equal(updateTaskRelations(next, [{ ...first, recorded_at: '2026-09-02T00:00:00Z' }]), next);
	assert.equal(parseTaskRecord(parseMarkdown(next).frontmatter.fields).relations.length, 1);
	const proposal = makeTaskRelation({ taskId: 'one', role: 'review_proposal', path: '00_tracekeeper/inbox/review_queue/one.md', proposalId: 'proposal-one', operationId: 'created' });
	const withProposal = updateTaskRelations(next, [proposal]);
	const closed = updateTaskRelations(withProposal, [{ ...proposal, relation_id: 'relation-closeout', operation_id: 'closed' }]);
	assert.equal(closed, withProposal);
	const unknownOutputs = ['00_tracekeeper/work/sessions/a.md', '00_tracekeeper/work/sessions/b.md'].map(path => makeTaskRelation({ taskId: 'one', role: 'written_output', path, operationId: 'same-round' }));
	assert.equal(parseTaskRecord(parseMarkdown(updateTaskRelations(content, unknownOutputs)).frontmatter.fields).relations.length, 2);
});

test('several historical segments keep every recorded path when consolidated into one parent', () => {
	const first = '01_knowledge/sources/old-1.md', second = '01_knowledge/sources/old-2.md';
	const target = { path: '01_knowledge/sources/files/parent.md', frontmatter: { type: 'source_capture', source_id: 'shard-one', migration_id: 'merge-one' }, historical_paths: [first, second], contentHash: 'verified-parent' };
	const migrated = migrateTaskRecord(task('history', `sourceCaptures: [${first}, ${second}]\n`), [target]);
	const record = parseTaskRecord(parseMarkdown(migrated).frontmatter.fields);
	assert.deepEqual(record.relations.map(row => row.recorded_path), [first, second]);
	assert.equal(record.relations.length, 2);
	assert.equal(resolveTaskRelations(record, [target]).every(row => row.current_path === target.path), true);
	assert.doesNotMatch(migrated, /^sourceCaptures:/m);
	assert.throws(() => migrateTaskRecord(task('conflict', `sourceCaptures: ${first}\nsource_captures: ${second}\n`), [target]), /Conflicting/);
});

test('native link updates repair the projection hash but user prose remains a conflict', () => {
	const target = { path: '01_knowledge/wiki/old.md', frontmatter: { wiki_id: 'wiki-one' } };
	const content = migrateTaskRecord(task('native-link', 'related_wiki: 01_knowledge/wiki/old.md\n'), [target]);
	const record = parseTaskRecord(parseMarkdown(content).frontmatter.fields);
	const link = path => `[[${path}]]`;
	const projected = renderTaskRelationProjection(content, resolveTaskRelations(record, [target]), link);
	const moved = { ...target, path: '01_knowledge/wiki/renamed.md' };
	const nativeUpdated = projected.replace('[[01_knowledge/wiki/old.md]]', '[[01_knowledge/wiki/renamed.md]]');
	const repaired = renderTaskRelationProjection(nativeUpdated, resolveTaskRelations(record, [moved]), link);
	assert.equal(parseTaskRecord(parseMarkdown(repaired).frontmatter.fields).relations[0].recorded_path, target.path);
	assert.notEqual(parseMarkdown(projected).frontmatter.fields.task_projection_hash, parseMarkdown(repaired).frontmatter.fields.task_projection_hash);
	assert.throws(() => renderTaskRelationProjection(nativeUpdated.replace('## Task relations', '## My own notes'), resolveTaskRelations(record, [moved]), link), /edited/);
	assert.ok(diagnoseTaskRelations([{ path: '00_tracekeeper/work/tasks/native-link.md', frontmatter: parseMarkdown(nativeUpdated).frontmatter.fields, content: nativeUpdated }, moved]).some(issue => issue.kind === 'task_navigation_pending'));
});

test('58-task migration is read-only at preview, resumable after a committed file, and restores a full backup', async (t) => {
	const { root, vault, repository } = await fixture(t);
	for (let i = 0; i < 58; i++) await repository.createText(`00_tracekeeper/work/tasks/task-${i}.md`, task(`task-${i}`, i < 4 ? `related_wiki: 01_knowledge/wiki/topic.md\n` : ''));
	await repository.createText('01_knowledge/wiki/topic.md', '# Wiki body\n');
	const before = await readTaskVaultSnapshot(repository);
	const preview = previewTaskMigration(before);
	assert.equal(preview.legacy_tasks, 58);
	assert.deepEqual(preview.blocked, []);
	assert.equal((await readTaskVaultSnapshot(repository)).map((f) => f.content).join('\0'), before.map((f) => f.content).join('\0'));
	assert.equal(await fs.stat(path.join(vault, '.tracekeeper')).catch(() => null), null);
	await assert.rejects(requireWritableTaskV2(repository, 'task-1'), /requires preview/);
	let injected = false;
	const options = { vault, repository, preview, backup: path.join(root, 'backup') };
	await assert.rejects(applyTaskMigration({ ...options, failure: (phase, file) => { if (!injected && phase === 'after_write' && file.endsWith('task-1.md')) { injected = true; throw new Error('interrupted'); } } }), /interrupted/);
	await assert.rejects(assertTaskMigrationCommitted(createVaultOperationJournal(vault), parseMarkdown((await repository.readText('00_tracekeeper/work/tasks/task-1.md')).content).frontmatter.fields), /requires preview/);
	assert.equal((await pendingTaskMigrations(vault)).length, 1);
	const { logDirectory } = await import('../dist/index.js');
	for (const name of await fs.readdir(logDirectory(vault))) {
		if (name.startsWith('task-relations-') && name.endsWith('.json')) {
			const raw = await fs.readFile(path.join(logDirectory(vault), name), 'utf8');
			assert.doesNotMatch(raw, /User body|Wiki body/);
			assert.ok(JSON.parse(raw).payload_encrypted);
		}
	}
	const pending = (await pendingTaskMigrations(vault))[0];
	const completed = await applyTaskMigration({ ...options, preview: pending.preview });
	assert.equal(completed.status, 'completed');
	await assertTaskMigrationCommitted(createVaultOperationJournal(vault), parseMarkdown((await repository.readText('00_tracekeeper/work/tasks/task-1.md')).content).frontmatter.fields);
	assert.equal((await pendingTaskMigrations(vault)).length, 0);
	const after = await readTaskVaultSnapshot(repository);
	assert.equal(after.filter((file) => parseMarkdown(file.content).frontmatter.fields.type === 'agent-task').length, 58);
	assert.equal(diagnoseTaskRelations(taskTargets(after)).length, 0);
	assert.equal(parseMarkdown((await repository.readText('01_knowledge/wiki/topic.md')).content).body, '# Wiki body\n');
	assert.deepEqual(await applyTaskMigration(options), completed);
	const navigation = after.filter((file) => file.path === '00_tracekeeper/work/index.md' || file.path.startsWith('00_tracekeeper/work/task_index/'));
	for (const file of navigation) await repository.deleteText(file.path, file.version);
	const rebuilt = await maintainTaskNavigation(repository);
	assert.deepEqual(rebuilt.issues, []);
	for (const file of navigation) assert.equal((await repository.readText(file.path)).content, file.content);
	await restoreVaultBackup(options.backup, path.join(root, 'restored'));
	const restored = new NodeFsVaultRepository({ vaultRoot: path.join(root, 'restored') });
	for (const file of before) assert.equal((await restored.readText(file.path)).content, file.content);
});

test('continuation rejects a tampered backup before enabling a historical task', async t => {
	const { root, vault, repository } = await fixture(t);
	const taskPath = '00_tracekeeper/work/tasks/one.md';
	await repository.createText(taskPath, task('one'));
	const preview = previewTaskMigration(await readTaskVaultSnapshot(repository));
	const backup = path.join(root, 'backup');
	await assert.rejects(applyTaskMigration({ vault, repository, preview, backup, failure: () => { throw new Error('interrupt'); } }), /interrupt/);
	await fs.appendFile(path.join(backup, 'vault', taskPath), 'tampered');
	const pending = (await pendingTaskMigrations(vault))[0];
	await assert.rejects(applyTaskMigration({ vault, repository, preview: pending.preview, backup }), /Backup verification/);
	assert.equal(parseTaskRecord(parseMarkdown((await repository.readText(taskPath)).content).frontmatter.fields), null);
});

test('task rename resolves by identity, duplicate and out-of-scope records block writes', async (t) => {
	const { repository } = await fixture(t);
	const content = migrateTaskRecord(task('renamed'), []);
	await repository.createText('00_tracekeeper/work/tasks/user-name.md', content);
	assert.equal((await findTaskById(repository, 'renamed', true)).path, '00_tracekeeper/work/tasks/user-name.md');
	await repository.createText('01_knowledge/wiki/copied.md', content);
	await assert.rejects(findTaskById(repository, 'renamed', true), /Duplicate/);
	const original = await repository.readText('00_tracekeeper/work/tasks/user-name.md');
	await repository.deleteText(original.path, original.version);
	await assert.rejects(findTaskById(repository, 'renamed', true), /outside/);
});

test('stale migration preview and edited generated navigation never overwrite user changes', async (t) => {
	const { root, vault, repository } = await fixture(t);
	const file = await repository.createText('00_tracekeeper/work/tasks/one.md', task('one'));
	const preview = previewTaskMigration(await readTaskVaultSnapshot(repository));
	await repository.replaceText(file.path, file.version, task('one', 'objective: user change\n'));
	await assert.rejects(applyTaskMigration({ vault, repository, preview, backup: path.join(root, 'backup') }), /stale/);
	const fresh = previewTaskMigration(await readTaskVaultSnapshot(repository));
	await applyTaskMigration({ vault, repository, preview: fresh, backup: path.join(root, 'fresh-backup') });
	const nav = await repository.readText('00_tracekeeper/work/index.md');
	await repository.replaceText(nav.path, nav.version, nav.content + 'User edit\n');
	assert.ok((await maintainTaskNavigation(repository)).issues.length);
	assert.match((await repository.readText(nav.path)).content, /User edit/);
});
