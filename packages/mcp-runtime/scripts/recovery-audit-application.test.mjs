#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentActivityRecentApplicationService } from '../dist/application/audit.js';
import { RuntimeRecoveryController } from '../dist/application/recovery.js';

function record(operationId, payload = {}) {
	return {
		operation_id: operationId,
		idempotency_key: `${operationId}-key`,
		payload_hash: `${operationId}-hash`,
		payload,
		status: 'in_progress',
		created_at: '2026-08-03T00:00:00.000Z',
		updated_at: '2026-08-03T00:00:00.000Z',
		completed_steps: [],
	};
}

test('RuntimeRecoveryController separates recovered, failed, and skipped records', async () => {
	const records = [
		record('start-task-direct', { goal: 'recover this', client: 'test' }),
		record('writeback-invalid', { proposalPath: 'review.md', taskId: 'task-direct' }),
		record('unknown-operation', { value: true }),
	];
	const saved = [];
	const invoked = [];
	const journal = {
		async listRecoverable() {
			return records;
		},
		async save(next) {
			saved.push(next);
		},
	};
	const controller = new RuntimeRecoveryController(journal, {
		isApplyApprovedWritebackPayload: () => false,
		isProposeMemoryOperationPayload: () => false,
		invoke: async (request) => {
			invoked.push(request);
			return { isError: false };
		},
	});

	const result = await controller.recover('/vault');
	assert.deepEqual(result.recovered, ['start-task-direct']);
	assert.deepEqual(result.failed, [{
		operation_id: 'writeback-invalid',
		error: 'Incompatible writeback recovery record requires a fresh preview.',
	}]);
	assert.deepEqual(result.skipped, ['unknown-operation']);
	assert.deepEqual(invoked, [{
		tool: 'tracekeeper.start_task',
		args: {
			goal: 'recover this',
			client: 'test',
			project_hint: undefined,
			project_id: undefined,
			repo_path: undefined,
			idempotency_key: 'start-task-direct-key',
		},
	}]);
	assert.equal(saved.length, 1);
	assert.equal(saved[0].status, 'conflicted');
});

test('AgentActivityRecentApplicationService owns section limiting and activity path selection', async () => {
	const service = new AgentActivityRecentApplicationService({
		agentActivityPath: '00_tracekeeper/control/agent_activity/index.md',
		readSections: async () => [
			{ source_path: '00_tracekeeper/audit/events-2026-08-03.jsonl', id: 1 },
			{ source_path: 'legacy.jsonl', id: 2 },
		],
	});

	assert.deepEqual(await service.execute(1), {
		ok: true,
		read_only: true,
		activity_path: '00_tracekeeper/audit/events-2026-08-03.jsonl',
		total_sections: 2,
		sections: [{ source_path: '00_tracekeeper/audit/events-2026-08-03.jsonl', id: 1 }],
	});
});
