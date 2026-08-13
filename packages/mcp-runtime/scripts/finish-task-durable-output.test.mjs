#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	NodeFileOperationJournal,
	NodeFsVaultRepository,
	parseMarkdown,
} from '@tracekeeper/core';
import { callTool } from '../dist/index.js';

function createFixture(t) {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-finish-durable-output-'));
	const vaultRoot = path.join(tempRoot, 'vault');
	fs.mkdirSync(vaultRoot, { recursive: true });
	t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
	const context = {
		defaultVaultRoot: vaultRoot,
		vaultRepository: new NodeFsVaultRepository({ vaultRoot }),
		principalId: 'finish-durable-output-principal',
		credentialCapabilities: ['*'],
		agentId: 'finish-durable-output-agent',
		sessionId: 'finish-durable-output-session',
		clientName: 'finish-durable-output-test',
		transport: 'test',
		runtimeVersion: 'test',
		contentLanguage: 'en',
		memoryRules: {
			globalMemoryRule: 'review_queue',
			projectMemoryRule: 'review_queue',
		},
	};
	return {
		vaultRoot,
		context,
		read(relativePath) {
			return fs.readFileSync(path.join(vaultRoot, relativePath), 'utf8');
		},
		write(relativePath, content) {
			const absolutePath = path.join(vaultRoot, relativePath);
			fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
			fs.writeFileSync(absolutePath, content, 'utf8');
		},
	};
}

async function invoke(name, args, context) {
	const result = await callTool(name, args, context);
	assert.equal(result.isError, false, `${name} failed: ${JSON.stringify(result.structuredContent)}`);
	assert.equal(result.structuredContent?.ok, true);
	return result.structuredContent;
}

async function startTask(fixture, suffix) {
	return invoke('tracekeeper.start_task', {
		goal: `Finish durable output ${suffix}`,
		idempotency_key: `finish-durable-output-start-${suffix}`,
	}, fixture.context);
}

async function proposeForTask(fixture, taskId, suffix) {
	return invoke('tracekeeper.propose_memory', {
		proposal_kind: 'task_decision',
		content: `Durable proposal ${suffix}.`,
		target_note: `01_knowledge/wiki/${suffix}.md`,
		task_id: taskId,
		idempotency_key: `finish-durable-output-proposal-${suffix}`,
	}, fixture.context);
}

function addTaskReferences(fixture, taskId, proposalIds, proposalPaths) {
	const taskPath = `00_tracekeeper/work/tasks/${taskId}.md`;
	const current = fixture.read(taskPath);
	const closing = current.indexOf('\n---', 4);
	assert.notEqual(closing, -1);
	const fields = [
		`proposal_ids: ${proposalIds.join(', ')}`,
		`proposal_paths: ${proposalPaths.join(', ')}`,
	].join('\n');
	fixture.write(taskPath, `${current.slice(0, closing)}\n${fields}${current.slice(closing)}`);
}

function replaceProposalStatus(fixture, proposalPath, status) {
	const current = fixture.read(proposalPath);
	assert.match(current, /^status:\s*"?pending"?\s*$/m);
	fixture.write(proposalPath, current.replace(/^status:\s*"?pending"?\s*$/m, `status: ${status}`));
}

function finishArgs(taskId, suffix) {
	return {
		task_id: taskId,
		status: 'completed',
		summary: `Finished durable output ${suffix}.`,
		idempotency_key: `finish-durable-output-finish-${suffix}`,
	};
}

function operationJournal(fixture) {
	return new NodeFileOperationJournal({
		directory: path.join(
			fixture.vaultRoot,
			'00_tracekeeper',
			'control',
			'operations'
		),
	});
}

function frontmatterList(value) {
	if (Array.isArray(value)) {
		return value.map(String).map((entry) => entry.trim()).filter(Boolean);
	}
	return String(value || '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function replaceFrontmatterField(fixture, recordPath, key, value) {
	const current = fixture.read(recordPath);
	const pattern = new RegExp(`^${key}:.*$`, 'm');
	assert.match(current, pattern);
	fixture.write(recordPath, current.replace(pattern, `${key}: ${value}`));
}

function removeDurableOutputFields(fixture, recordPath) {
	const current = fixture.read(recordPath);
	fixture.write(recordPath, current
		.split('\n')
		.filter((line) => !line.startsWith('durable_output_'))
		.join('\n'));
}

function taskWriteInterruptingRepository(vaultRoot, taskPath, phase) {
	const repository = new NodeFsVaultRepository({ vaultRoot });
	let interrupted = false;
	return {
		get interrupted() {
			return interrupted;
		},
		repository: new Proxy(repository, {
			get(target, property) {
				if (property === 'replaceText') {
					return async (...args) => {
						const [recordPath, expectedVersion, content] = args;
						const matches = !interrupted
							&& recordPath === taskPath
							&& String(content).includes('durable_output_status_at_finish:');
						if (matches && phase === 'before') {
							interrupted = true;
							throw new Error('interrupt before task durable-output write');
						}
						const result = await target.replaceText(
							recordPath,
							expectedVersion,
							content
						);
						if (matches && phase === 'after') {
							interrupted = true;
							throw new Error('interrupt after task durable-output write');
						}
						return result;
					};
				}
				const value = Reflect.get(target, property, target);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		}),
	};
}

test('finish_task reports a directly linked pending proposal without creating a duplicate', async (t) => {
	const fixture = createFixture(t);
	const task = await startTask(fixture, 'direct-pending');
	const captured = await invoke('tracekeeper.capture_source', {
		source: 'https://example.test/direct-pending',
		mode: 'extracted_snapshot',
		content: '# Captured source\n\nDirect proposal evidence.',
		task_id: task.task_id,
		filename: 'direct-pending-source',
		idempotency_key: 'finish-durable-output-capture-direct-pending',
	}, fixture.context);
	const proposal = await proposeForTask(fixture, task.task_id, 'direct-pending');
	const queueBefore = fs.readdirSync(path.join(
		fixture.vaultRoot,
		'00_tracekeeper/inbox/review_queue'
	));
	const finished = await invoke(
		'tracekeeper.finish_task',
		finishArgs(task.task_id, 'direct-pending'),
		fixture.context
	);
	const queueAfter = fs.readdirSync(path.join(
		fixture.vaultRoot,
		'00_tracekeeper/inbox/review_queue'
	));

	assert.deepEqual(queueAfter, queueBefore);
	assert.equal(finished.status, 'completed');
	assert.equal(finished.memory_status, 'queued_for_review');
	assert.equal(finished.proposal_count, 1);
	assert.equal(finished.proposals.length, 1);
	assert.equal(finished.proposals[0].proposal_id, proposal.proposal_id);
	assert.deepEqual(finished.durable_output, {
		status: 'pending_review',
		source_capture_count: 1,
		proposal_count: 1,
		pending_review_count: 1,
		ready_to_apply_count: 0,
		revision_requested_count: 0,
		applied_count: 0,
		rejected_count: 0,
		unresolved_count: 0,
		proposal_paths: [proposal.proposal_path],
		target_paths: ['01_knowledge/wiki/direct-pending.md'],
	});
	assert.equal(finished.next_actions[0].kind, 'user_review');
	assert.equal(finished.next_actions[0].required, true);
	assert.equal(finished.next_actions[0].reason_code, 'MEMORY_REVIEW_REQUIRED');
	assert.match(finished.next_actions[0].reason, /Captured Source or Recall.*does not prove.*applied/i);

	const taskText = fixture.read(finished.task_path);
	const taskFrontmatter = parseMarkdown(taskText).frontmatter.fields;
	assert.equal(taskFrontmatter.status, 'completed');
	assert.equal(taskFrontmatter.durable_output_status_at_finish, 'pending_review');
	assert.equal(taskFrontmatter.durable_output_source_capture_count, 1);
	assert.equal(taskFrontmatter.durable_output_proposal_count, 1);
	assert.equal(taskFrontmatter.durable_output_pending_review_count, 1);
	assert.equal(taskFrontmatter.durable_output_unresolved_count, 0);
	assert.equal(taskFrontmatter.durable_output_proposal_ids_at_finish, proposal.proposal_id);
	assert.equal(taskFrontmatter.durable_output_proposal_paths, proposal.proposal_path);
	assert.equal(taskFrontmatter.durable_output_target_paths, '01_knowledge/wiki/direct-pending.md');
	assert.match(taskText, new RegExp(captured.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	assert.equal(finished.session_path, finished.task_path);
});

test('finish_task exact retry preserves the journaled proposal snapshot', async (t) => {
	const fixture = createFixture(t);
	const task = await startTask(fixture, 'retry-snapshot');
	const proposal = await proposeForTask(fixture, task.task_id, 'retry-snapshot');
	const args = finishArgs(task.task_id, 'retry-snapshot');
	const first = await invoke('tracekeeper.finish_task', args, fixture.context);
	const operation = await operationJournal(fixture).loadById(first.operation_id);
	assert.deepEqual(operation?.payload?.durableOutputSnapshot, {
		sourceCapturePaths: [],
		proposals: [{
			proposalId: proposal.proposal_id,
			path: proposal.proposal_path,
			proposalKind: 'task_decision',
			targetPath: '01_knowledge/wiki/retry-snapshot.md',
			status: 'pending_review',
			exact: true,
		}],
	});
	replaceProposalStatus(fixture, proposal.proposal_path, 'rejected');

	const replay = await invoke('tracekeeper.finish_task', args, {
		...fixture.context,
		vaultRepository: new NodeFsVaultRepository({ vaultRoot: fixture.vaultRoot }),
	});
	assert.equal(replay.operation_id, first.operation_id);
	assert.deepEqual(replay.durable_output, first.durable_output);
	assert.equal(replay.durable_output.status, 'pending_review');
	assert.equal(replay.memory_status, 'queued_for_review');
});

test('finish_task decorates a legacy completed journal result without Vault recomputation', async (t) => {
	const fixture = createFixture(t);
	const task = await startTask(fixture, 'legacy-result');
	const proposal = await proposeForTask(fixture, task.task_id, 'legacy-result');
	const args = finishArgs(task.task_id, 'legacy-result');
	const first = await invoke('tracekeeper.finish_task', args, fixture.context);
	const journal = operationJournal(fixture);
	const record = await journal.loadById(first.operation_id);
	assert.ok(record?.result);
	delete record.result.durable_output;
	await journal.save(record);
	replaceProposalStatus(fixture, proposal.proposal_path, 'rejected');

	const replay = await invoke('tracekeeper.finish_task', args, {
		...fixture.context,
		vaultRepository: new NodeFsVaultRepository({ vaultRoot: fixture.vaultRoot }),
	});
	assert.deepEqual(replay.durable_output, {
		status: 'pending_review',
		source_capture_count: 0,
		proposal_count: 1,
		pending_review_count: 1,
		ready_to_apply_count: 0,
		revision_requested_count: 0,
		applied_count: 0,
		rejected_count: 0,
		unresolved_count: 0,
		proposal_paths: [proposal.proposal_path],
		target_paths: [],
	});
	assert.equal(replay.memory_status, 'queued_for_review');
});

test('finish_task aggregates direct and finish-generated proposals exactly once', async (t) => {
	const fixture = createFixture(t);
	const task = await startTask(fixture, 'combined-generated');
	const direct = await proposeForTask(fixture, task.task_id, 'combined-generated-direct');
	const finished = await invoke('tracekeeper.finish_task', {
		...finishArgs(task.task_id, 'combined-generated'),
		memory_candidate_records: [{
			proposal_kind: 'task_decision',
			content: 'Finish-generated durable proposal.',
			scope: 'global',
			target_note: '01_knowledge/wiki/combined-generated-finish.md',
		}],
	}, fixture.context);

	assert.equal(finished.durable_output.status, 'pending_review');
	assert.equal(finished.durable_output.proposal_count, 2);
	assert.equal(finished.durable_output.pending_review_count, 2);
	assert.equal(new Set(finished.durable_output.proposal_paths).size, 2);
	assert.equal(finished.durable_output.proposal_paths.includes(direct.proposal_path), true);
	assert.equal(finished.proposal_count, 2);
	assert.equal(finished.proposals.length, 2);
	assert.equal(new Set(finished.proposals.map((proposal) => proposal.proposal_id)).size, 2);
	const expectedProposalIds = finished.proposals.map((proposal) => proposal.proposal_id);
	assert.equal(finished.session_path, finished.task_path);
	const fields = parseMarkdown(fixture.read(finished.task_path)).frontmatter.fields;
	assert.deepEqual(
		frontmatterList(fields.durable_output_proposal_ids_at_finish),
		expectedProposalIds
	);
	assert.equal(finished.memory_status, 'queued_for_review');
	assert.equal(finished.next_actions[0].kind, 'user_review');
	assert.equal(finished.next_actions[0].reason_code, 'MEMORY_REVIEW_REQUIRED');
});

test('finish_task keeps an explicitly unresolved Wiki relation pending for review', async (t) => {
	const fixture = createFixture(t);
	fixture.context.memoryRules.projectMemoryRule = 'auto_write';
	const task = await invoke('tracekeeper.start_task', {
		goal: 'Finish candidate declares a Wiki relation that must resolve',
		project_hint: 'demo',
		project_id: 'demo-project-id',
		idempotency_key: 'finish-durable-output-start-missing-wiki-bridge',
	}, fixture.context);
	const finished = await invoke('tracekeeper.finish_task', {
		...finishArgs(task.task_id, 'missing-wiki-bridge'),
		project_hint: 'demo',
		project_id: 'demo-project-id',
		related_wiki: ['missing-wiki-demo-note'],
		memory_candidate_records: [{
			proposal_kind: 'project_update',
			content: 'An explicitly unresolved Wiki relation must keep this candidate review-gated.',
			scope: 'project',
			project_hint: 'demo',
			project_id: 'demo-project-id',
			related_wiki: ['missing-wiki-demo-note'],
		}],
	}, fixture.context);

	assert.equal(finished.missing_wiki_bridge, false);
	assert.equal(finished.memory_status, 'queued_for_review');
	assert.equal(finished.memory_changes[0].reason, 'unresolved_relation_evidence');
	assert.equal(finished.durable_output.status, 'pending_review');
	assert.equal(finished.durable_output.proposal_count, 1);
	assert.equal(finished.durable_output.pending_review_count, 1);
	assert.equal(finished.durable_output.unresolved_count, 0);
	assert.deepEqual(finished.durable_output.target_paths, []);
	assert.equal(finished.next_actions[0].kind, 'user_review');
	assert.equal(finished.next_actions[0].required, true);
	assert.equal(finished.next_actions[0].reason_code, 'MEMORY_REVIEW_REQUIRED');
});

test('finish_task recovery reuses persisted generated-output evidence', async (t) => {
	const fixture = createFixture(t);
	const task = await startTask(fixture, 'generated-recovery');
	const args = {
		...finishArgs(task.task_id, 'generated-recovery'),
		memory_candidate_records: [{
			proposal_kind: 'task_decision',
			content: 'Recovery must retain the generated pending snapshot.',
			scope: 'global',
			target_note: '01_knowledge/wiki/generated-recovery.md',
		}],
	};
	let injected = false;
	const interrupted = await callTool('tracekeeper.finish_task', args, {
		...fixture.context,
		operationFailureInjection(injection) {
			if (
				!injected
				&& injection.operationId.startsWith('finish-task-')
				&& injection.phase === 'before_finalize'
			) {
				injected = true;
				throw new Error('interrupt finish before finalize');
			}
		},
	});
	assert.equal(injected, true);
	assert.equal(interrupted.isError, true);

	const taskPath = `00_tracekeeper/work/tasks/${task.task_id}.md`;
	const taskFields = parseMarkdown(fixture.read(taskPath)).frontmatter.fields;
	assert.equal(taskFields.durable_output_status_at_finish, 'pending_review');
	const proposalPaths = frontmatterList(taskFields.durable_output_proposal_paths);
	assert.equal(proposalPaths.length, 1);
	const proposalIdsAtFinish = frontmatterList(
		taskFields.durable_output_proposal_ids_at_finish
	);
	assert.equal(proposalIdsAtFinish.length, 1);
	assert.equal(taskFields.session_note, undefined);
	assert.equal(
		fs.existsSync(path.join(fixture.vaultRoot, '00_tracekeeper/work/sessions')),
		false
	);
	replaceProposalStatus(fixture, proposalPaths[0], 'rejected');

	const recovered = await invoke('tracekeeper.finish_task', args, {
		...fixture.context,
		vaultRepository: new NodeFsVaultRepository({ vaultRoot: fixture.vaultRoot }),
	});
	assert.equal(recovered.durable_output.status, 'pending_review');
	assert.equal(recovered.durable_output.pending_review_count, 1);
	assert.equal(recovered.durable_output.rejected_count, 0);
	assert.equal(recovered.memory_status, 'queued_for_review');
	assert.equal(
		parseMarkdown(fixture.read(taskPath)).frontmatter.fields.durable_output_status_at_finish,
		'pending_review'
	);
});

for (const corruption of [
	{
		name: 'status and counts disagree',
		key: 'durable_output_status_at_finish',
		value: () => 'applied',
	},
	{
		name: 'proposal count is below state counts',
		key: 'durable_output_proposal_count',
		value: () => '0',
	},
	{
		name: 'proposal paths exceed proposal count',
		key: 'durable_output_proposal_paths',
		value: (proposal) => `${proposal.proposal_path}, 00_tracekeeper/inbox/review_queue/extra.md`,
	},
	{
		name: 'target paths exceed durable output capacity',
		key: 'durable_output_target_paths',
		value: () => '01_knowledge/wiki/corrupt.md, 01_knowledge/wiki/extra.md',
	},
	{
		name: 'proposal ids exceed proposal count',
		key: 'durable_output_proposal_ids_at_finish',
		value: (proposal) => `${proposal.proposal_id}, proposal-extra-id`,
	},
	{
		name: 'status is unsupported',
		key: 'durable_output_status_at_finish',
		value: () => 'future_state',
	},
]) {
	test(`finish_task refuses internally inconsistent persisted evidence when ${corruption.name}`, async (t) => {
		const fixture = createFixture(t);
		const suffix = corruption.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
		const task = await startTask(fixture, `corrupt-${suffix}`);
		const proposal = await proposeForTask(fixture, task.task_id, `corrupt-${suffix}`);
		const args = finishArgs(task.task_id, `corrupt-${suffix}`);
		let injected = false;
		const interrupted = await callTool('tracekeeper.finish_task', args, {
			...fixture.context,
			operationFailureInjection(injection) {
				if (!injected && injection.phase === 'before_finalize') {
					injected = true;
					throw new Error('interrupt before durable-output validation replay');
				}
			},
		});
		assert.equal(interrupted.isError, true);
		assert.equal(injected, true);
		const taskPath = `00_tracekeeper/work/tasks/${task.task_id}.md`;
		const corruptedValue = corruption.value(proposal);
		replaceFrontmatterField(
			fixture,
			taskPath,
			corruption.key,
			corruptedValue
		);

		const replay = await callTool('tracekeeper.finish_task', args, fixture.context);
		assert.equal(replay.isError, true);
		assert.match(
			String(replay.structuredContent?.error || ''),
			/durable-output evidence|finalization|inconsistent|conflict/i
		);
	});
}

for (const phase of ['before', 'after']) {
	test(`finish_task repairs a ${phase}-task-write interruption from canonical evidence`, async (t) => {
		const fixture = createFixture(t);
		const task = await startTask(fixture, `task-write-${phase}`);
		const proposal = await proposeForTask(fixture, task.task_id, `task-write-${phase}`);
		const args = finishArgs(task.task_id, `task-write-${phase}`);
		const taskPath = `00_tracekeeper/work/tasks/${task.task_id}.md`;
		const interruption = taskWriteInterruptingRepository(
			fixture.vaultRoot,
			taskPath,
			phase
		);
		const first = await callTool('tracekeeper.finish_task', args, {
			...fixture.context,
			vaultRepository: interruption.repository,
		});
		assert.equal(first.isError, true);
		assert.equal(interruption.interrupted, true);
		const taskBeforeRecovery = parseMarkdown(fixture.read(taskPath)).frontmatter.fields;
		assert.equal(
			Object.hasOwn(taskBeforeRecovery, 'durable_output_status_at_finish'),
			phase === 'after'
		);
		replaceProposalStatus(fixture, proposal.proposal_path, 'rejected');

		const recovered = await invoke('tracekeeper.finish_task', args, fixture.context);
		assert.equal(recovered.durable_output.status, 'pending_review');
		assert.equal(recovered.durable_output.rejected_count, 0);
		const taskFields = parseMarkdown(fixture.read(taskPath)).frontmatter.fields;
		assert.equal(taskFields.durable_output_status_at_finish, 'pending_review');
		assert.equal(taskFields.durable_output_rejected_count, 0);
		assert.equal(taskFields.session_note, undefined);
	});
}

test('finish_task finalization refuses a missing task-record durable-output snapshot', async (t) => {
	const fixture = createFixture(t);
	const task = await startTask(fixture, 'single-sided-finalize');
	await proposeForTask(fixture, task.task_id, 'single-sided-finalize');
	const args = finishArgs(task.task_id, 'single-sided-finalize');
	let injected = false;
	const interrupted = await callTool('tracekeeper.finish_task', args, {
		...fixture.context,
		operationFailureInjection(injection) {
			if (!injected && injection.phase === 'before_finalize') {
				injected = true;
				throw new Error('interrupt after both durable-output writes');
			}
		},
	});
	assert.equal(interrupted.isError, true);
	const taskPath = `00_tracekeeper/work/tasks/${task.task_id}.md`;
	removeDurableOutputFields(fixture, taskPath);

	const replay = await callTool('tracekeeper.finish_task', args, fixture.context);
	assert.equal(replay.isError, true);
	assert.match(
		String(replay.structuredContent?.error || ''),
		/durable-output evidence.*task record|finalization/i
	);
});

test('finish_task treats missing and mismatched task proposal pairs as unresolved', async (t) => {
	const fixture = createFixture(t);
	const missingTask = await startTask(fixture, 'missing-pair');
	const missingPath = '00_tracekeeper/inbox/review_queue/missing-pair.md';
	addTaskReferences(fixture, missingTask.task_id, ['proposal-missing-pair'], [missingPath]);
	const missing = await invoke(
		'tracekeeper.finish_task',
		finishArgs(missingTask.task_id, 'missing-pair'),
		fixture.context
	);
	assert.equal(missing.durable_output.status, 'unresolved');
	assert.equal(missing.durable_output.proposal_count, 1);
	assert.equal(missing.durable_output.unresolved_count, 1);
	assert.deepEqual(missing.durable_output.proposal_paths, [missingPath]);
	assert.equal(missing.memory_status, 'conflict');
	assert.equal(missing.next_actions[0].kind, 'report_status');
	assert.equal(missing.next_actions[0].reason_code, 'MEMORY_NOT_PERSISTED');
	assert.match(missing.next_actions[0].reason, /not persisted/i);
	assert.deepEqual(
		frontmatterList(
			parseMarkdown(fixture.read(missing.task_path)).frontmatter.fields
				.durable_output_proposal_ids_at_finish
		),
		[]
	);

	const otherTask = await startTask(fixture, 'mismatch-owner');
	const unrelated = await proposeForTask(fixture, otherTask.task_id, 'mismatch-owner');
	const mismatchedTask = await startTask(fixture, 'mismatch-pair');
	addTaskReferences(
		fixture,
		mismatchedTask.task_id,
		[unrelated.proposal_id],
		[unrelated.proposal_path]
	);
	const mismatched = await invoke(
		'tracekeeper.finish_task',
		finishArgs(mismatchedTask.task_id, 'mismatch-pair'),
		fixture.context
	);
	assert.equal(mismatched.durable_output.status, 'unresolved');
	assert.equal(mismatched.durable_output.proposal_count, 1);
	assert.equal(mismatched.durable_output.unresolved_count, 1);
	assert.deepEqual(mismatched.durable_output.target_paths, []);
	assert.equal(mismatched.memory_status, 'conflict');
	assert.deepEqual(
		frontmatterList(
			parseMarkdown(fixture.read(mismatched.task_path)).frontmatter.fields
				.durable_output_proposal_ids_at_finish
		),
		[]
	);

	const idMismatchTask = await startTask(fixture, 'id-mismatch-pair');
	const idMismatchPath = '00_tracekeeper/inbox/review_queue/id-mismatch-pair.md';
	fixture.write(idMismatchPath, [
		'---',
		'type: memory_proposal',
		'proposal_id: proposal-actual-id',
		'proposal_kind: task_decision',
		'status: pending',
		`task_id: ${idMismatchTask.task_id}`,
		'target_note: 01_knowledge/wiki/id-mismatch-pair.md',
		'---',
		'## Writeback',
		'An id mismatch must fail closed.',
		'',
	].join('\n'));
	addTaskReferences(
		fixture,
		idMismatchTask.task_id,
		['proposal-expected-id'],
		[idMismatchPath]
	);
	const idMismatch = await invoke(
		'tracekeeper.finish_task',
		finishArgs(idMismatchTask.task_id, 'id-mismatch-pair'),
		fixture.context
	);
	assert.equal(idMismatch.durable_output.status, 'unresolved');
	assert.equal(idMismatch.durable_output.unresolved_count, 1);
	assert.deepEqual(idMismatch.durable_output.target_paths, []);
	assert.deepEqual(
		frontmatterList(
			parseMarkdown(fixture.read(idMismatch.task_path)).frontmatter.fields
				.durable_output_proposal_ids_at_finish
		),
		[]
	);

	const invalidTargetTask = await startTask(fixture, 'invalid-target-pair');
	const invalidTargetId = 'proposal-invalid-target';
	const invalidTargetPath = '00_tracekeeper/inbox/review_queue/invalid-target-pair.md';
	fixture.write(invalidTargetPath, [
		'---',
		'type: memory_proposal',
		`proposal_id: ${invalidTargetId}`,
		'proposal_kind: task_decision',
		'status: pending',
		`task_id: ${invalidTargetTask.task_id}`,
		'target_note: 00_tracekeeper/control/unsafe-target.md',
		'---',
		'## Writeback',
		'A non-empty target outside Wiki or Memory must fail closed.',
		'',
	].join('\n'));
	addTaskReferences(
		fixture,
		invalidTargetTask.task_id,
		[invalidTargetId],
		[invalidTargetPath]
	);
	const invalidTarget = await invoke(
		'tracekeeper.finish_task',
		finishArgs(invalidTargetTask.task_id, 'invalid-target-pair'),
		fixture.context
	);
	assert.equal(invalidTarget.durable_output.status, 'unresolved');
	assert.equal(invalidTarget.durable_output.unresolved_count, 1);
	assert.deepEqual(invalidTarget.durable_output.target_paths, []);
	assert.deepEqual(
		frontmatterList(
			parseMarkdown(fixture.read(invalidTarget.task_path)).frontmatter.fields
				.durable_output_proposal_ids_at_finish
		),
		[invalidTargetId]
	);

	const outsideTask = await startTask(fixture, 'outside-owner-pair');
	const outsidePath = '01_knowledge/wiki/proposal-looking-note.md';
	fixture.write(outsidePath, [
		'---',
		'type: memory_proposal',
		'proposal_id: proposal-outside-owner',
		'proposal_kind: task_decision',
		'status: pending',
		`task_id: ${outsideTask.task_id}`,
		'target_note: 01_knowledge/wiki/outside-owner-target.md',
		'---',
		'## Writeback',
		'An out-of-owner proposal-looking note must not count as exact.',
		'',
	].join('\n'));
	addTaskReferences(
		fixture,
		outsideTask.task_id,
		['proposal-outside-owner'],
		[outsidePath]
	);
	const outside = await invoke(
		'tracekeeper.finish_task',
		finishArgs(outsideTask.task_id, 'outside-owner-pair'),
		fixture.context
	);
	assert.equal(outside.durable_output.status, 'unresolved');
	assert.equal(outside.durable_output.unresolved_count, 1);
	assert.deepEqual(outside.durable_output.proposal_paths, []);
	assert.deepEqual(outside.durable_output.target_paths, []);
	assert.deepEqual(
		frontmatterList(
			parseMarkdown(fixture.read(outside.task_path)).frontmatter.fields
				.durable_output_proposal_ids_at_finish
		),
		[]
	);
});

test('finish_task never correlates an unrelated review proposal', async (t) => {
	const fixture = createFixture(t);
	const unrelatedTask = await startTask(fixture, 'unrelated-owner');
	await proposeForTask(fixture, unrelatedTask.task_id, 'unrelated-owner');
	const task = await startTask(fixture, 'unrelated-decoy');
	const finished = await invoke(
		'tracekeeper.finish_task',
		finishArgs(task.task_id, 'unrelated-decoy'),
		fixture.context
	);
	assert.deepEqual(finished.durable_output, {
		status: 'none',
		source_capture_count: 0,
		proposal_count: 0,
		pending_review_count: 0,
		ready_to_apply_count: 0,
		revision_requested_count: 0,
		applied_count: 0,
		rejected_count: 0,
		unresolved_count: 0,
		proposal_paths: [],
		target_paths: [],
	});
	assert.equal(finished.memory_status, 'no_candidates');
});

test('finish_task maps exact proposal lifecycle states independently from task status', async (t) => {
	const fixture = createFixture(t);
	const cases = [
		['approved', 'ready_to_apply', 'ready_to_apply_count', 'queued_for_review', 'user_review', 'MEMORY_REVIEW_REQUIRED'],
		['revision_requested', 'revision_requested', 'revision_requested_count', 'queued_for_review', 'user_review', 'MEMORY_REVIEW_REQUIRED'],
		['applied', 'applied', 'applied_count', 'auto_saved', 'report_status', 'MEMORY_RECORDED'],
		['rejected', 'rejected', 'rejected_count', 'conflict', 'report_status', 'MEMORY_NOT_PERSISTED'],
	];
	for (const [proposalStatus, durableStatus, countField, memoryStatus, actionKind, reasonCode] of cases) {
		const task = await startTask(fixture, `state-${proposalStatus}`);
		const proposal = await proposeForTask(fixture, task.task_id, `state-${proposalStatus}`);
		replaceProposalStatus(fixture, proposal.proposal_path, proposalStatus);
		const finished = await invoke(
			'tracekeeper.finish_task',
			finishArgs(task.task_id, `state-${proposalStatus}`),
			fixture.context
		);
		assert.equal(finished.status, 'completed');
		assert.equal(finished.durable_output.status, durableStatus);
		assert.equal(finished.durable_output[countField], 1);
		assert.equal(finished.memory_status, memoryStatus);
		assert.equal(finished.next_actions[0].kind, actionKind);
		assert.equal(finished.next_actions[0].reason_code, reasonCode);
	}

	const mixedTask = await startTask(fixture, 'state-mixed');
	await proposeForTask(fixture, mixedTask.task_id, 'state-mixed-pending');
	const rejected = await proposeForTask(fixture, mixedTask.task_id, 'state-mixed-rejected');
	replaceProposalStatus(fixture, rejected.proposal_path, 'rejected');
	const mixed = await invoke(
		'tracekeeper.finish_task',
		finishArgs(mixedTask.task_id, 'state-mixed'),
		fixture.context
	);
	assert.equal(mixed.durable_output.status, 'mixed');
	assert.equal(mixed.durable_output.proposal_count, 2);
	assert.equal(mixed.durable_output.pending_review_count, 1);
	assert.equal(mixed.durable_output.rejected_count, 1);
	assert.equal(mixed.memory_status, 'conflict');
	assert.deepEqual(
		mixed.next_actions.map((action) => [action.kind, action.reason_code]),
		[
			['user_review', 'MEMORY_REVIEW_REQUIRED'],
			['report_status', 'MEMORY_NOT_PERSISTED'],
		]
	);
});

test('finish_task keeps source-only evidence separate from durable output', async (t) => {
	const fixture = createFixture(t);
	const task = await startTask(fixture, 'source-only');
	await invoke('tracekeeper.capture_source', {
		source: 'https://example.test/source-only',
		mode: 'extracted_snapshot',
		content: '# Source only\n\nEvidence without a durable proposal.',
		task_id: task.task_id,
		filename: 'source-only',
		idempotency_key: 'finish-durable-output-capture-source-only',
	}, fixture.context);
	const finished = await invoke(
		'tracekeeper.finish_task',
		finishArgs(task.task_id, 'source-only'),
		fixture.context
	);
	assert.equal(finished.status, 'completed');
	assert.equal(finished.durable_output.status, 'none');
	assert.equal(finished.durable_output.source_capture_count, 1);
	assert.equal(finished.durable_output.proposal_count, 0);
	assert.equal(finished.memory_status, 'no_candidates');
	assert.equal(finished.next_actions[0].kind, 'report_status');
	assert.equal(finished.next_actions[0].reason_code, 'MEMORY_NOT_PERSISTED');
	assert.match(finished.next_actions[0].reason, /Source.*provenance only.*no Wiki\/Memory output was applied/i);
	assert.match(finished.next_actions_for_agent[0], /Source.*provenance.*no Wiki\/Memory output was applied/i);
});

test('finish_task without sources or proposals reports no durable output', async (t) => {
	const fixture = createFixture(t);
	const task = await startTask(fixture, 'normal-none');
	const finished = await invoke(
		'tracekeeper.finish_task',
		finishArgs(task.task_id, 'normal-none'),
		fixture.context
	);
	assert.equal(finished.status, 'completed');
	assert.equal(finished.durable_output.status, 'none');
	assert.equal(finished.durable_output.source_capture_count, 0);
	assert.equal(finished.durable_output.proposal_count, 0);
	assert.equal(finished.memory_status, 'no_candidates');
	assert.equal(finished.next_actions[0].kind, 'report_status');
	assert.equal(finished.next_actions[0].reason_code, 'MEMORY_NOT_PERSISTED');
	assert.equal(finished.session_path, finished.task_path);
	const fields = parseMarkdown(fixture.read(finished.task_path)).frontmatter.fields;
	assert.equal(fields.durable_output_status_at_finish, 'none');
	for (const key of [
		'durable_output_source_capture_count',
		'durable_output_proposal_count',
		'durable_output_pending_review_count',
		'durable_output_ready_to_apply_count',
		'durable_output_revision_requested_count',
		'durable_output_applied_count',
		'durable_output_rejected_count',
		'durable_output_unresolved_count',
		'durable_output_proposal_ids_at_finish',
		'durable_output_proposal_paths',
		'durable_output_target_paths',
	]) {
		assert.equal(Object.hasOwn(fields, key), true, `${finished.task_path} missing ${key}`);
	}
});
