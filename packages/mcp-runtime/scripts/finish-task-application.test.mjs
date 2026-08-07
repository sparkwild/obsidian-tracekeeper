#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DistillSessionApplicationService,
	FinishTaskApplicationService,
} from '../dist/application/finish-task.js';

function createInMemoryJournal() {
	const records = new Map();
	const clone = (value) => JSON.parse(JSON.stringify(value));
	return {
		async loadByIdempotencyKey(idempotencyKey) {
			for (const record of records.values()) {
				if (record.idempotency_key === idempotencyKey) {
					return clone(record);
				}
			}
			return null;
		},
		async loadById(operationId) {
			const record = records.get(operationId);
			return record ? clone(record) : null;
		},
		async listRecoverable() {
			return [...records.values()]
				.filter((record) => record.status !== 'completed' && record.status !== 'conflicted')
				.map(clone);
		},
		async save(record) {
			records.set(record.operation_id, clone(record));
		},
	};
}

test('FinishTaskApplicationService preserves lifecycle guards, step names, and replay', async () => {
	const journal = createInMemoryJournal();
	const events = [];
	const service = new FinishTaskApplicationService({
		journal,
		requestSnapshot: (rawArgs) => ({ task_id: rawArgs.task_id, summary: rawArgs.summary }),
		requestIdempotencyKey: (rawArgs) => rawArgs.idempotency_key || '',
		createIdentity: (_hash, idempotencyKey) => ({
			operationId: 'finish-task-direct',
			idempotencyKey,
		}),
		loadExistingPayload: (payload) => Boolean(payload?.requestHash),
		storedRequestHash: (payload) => payload?.requestHash || '',
		buildPayload: async (_rawArgs, _operationId, requestHash) => ({
			requestHash,
			taskId: 'task-direct',
		}),
		getTaskId: (payload) => payload.taskId,
		readLifecycle: async () => null,
		markClosing: async (_payload, operationId) => events.push(['closing', operationId]),
		buildSteps: (_payload, operationId) => [
			{
				name: 'finish-task:session-note',
				execute: async () => events.push(['session-note', operationId]),
			},
			{
				name: 'finish-task:update-task-record',
				execute: async () => events.push(['update-task-record', operationId]),
			},
		],
		finalize: async (_payload, operationId, idempotencyKey) => ({
			ok: true,
			operation_id: operationId,
			idempotency_key: idempotencyKey,
		}),
	});

	const request = { task_id: 'task-direct', summary: 'completed', idempotency_key: 'finish-direct' };
	const result = await service.execute(request);
	assert.deepEqual(result, {
		ok: true,
		operation_id: 'finish-task-direct',
		idempotency_key: 'finish-direct',
	});
	assert.deepEqual(events, [
		['closing', 'finish-task-direct'],
		['session-note', 'finish-task-direct'],
		['update-task-record', 'finish-task-direct'],
	]);
	assert.deepEqual(await service.execute(request), result);
	assert.equal(events.length, 3);
});

test('DistillSessionApplicationService owns note, proposal, and task-reference flow', async () => {
	const writes = [];
	const references = [];
	const service = new DistillSessionApplicationService({
		resolveProjectHint: async (_taskId, explicit) => explicit || 'direct-project',
		assertSafeText: () => undefined,
		buildFilename: () => 'direct-session',
		now: () => '2026-08-03T00:00:00.000Z',
		renderText: (_zh, en) => en,
		buildBody: (summary) => `# Distilled\n\n${summary}`,
		writeSessionNote: async (input) => {
			writes.push(input);
			return { path: '00_tracekeeper/work/sessions/direct-session.md', activity_path: '00_tracekeeper/control/agent_activity/2026/2026-08-03.md' };
		},
		memoryProposalAllowed: (kind) => kind === 'distill_decisions',
		createProposal: async () => ({
			proposalId: 'distill-proposal-1',
			path: '00_tracekeeper/review_queue/distill-proposal-1.md',
			linkTarget: '00_tracekeeper/review_queue/distill-proposal-1.md',
		}),
		updateTask: async (taskId, notePath, proposals) => {
			references.push({ kind: 'task', taskId, notePath, proposals });
			return '00_tracekeeper/work/tasks/direct-task.md';
		},
		updateManagedProposalReferences: async (recordPath, proposals) => {
			references.push({ kind: 'managed', recordPath, proposals });
		},
	});

	const result = await service.execute({
		task_id: 'direct-task',
		summary: 'direct summary',
		decisions: ['Keep decision'],
		possible_preferences: ['Keep preference'],
	});
	assert.equal(result.ok, true);
	assert.equal(result.proposal_count, 1);
	assert.equal(writes.length, 1);
	assert.match(writes[0].body, /direct summary/);
	assert.equal(references.length, 3);
});
