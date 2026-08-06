#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { ProposeMemoryApplicationService } from '../dist/application/propose-memory.js';

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

test('ProposeMemoryApplicationService owns normalization, journaling, and proposal writes', async () => {
	const journal = createInMemoryJournal();
	const writes = [];
	const taskReferences = [];
	const service = new ProposeMemoryApplicationService({
		journal,
		createIdentity: (_requestHash, idempotencyKey) => ({
			operationId: 'propose-memory-direct',
			idempotencyKey,
		}),
		observedAgentType: 'custom',
		now: () => '2026-08-03T00:00:00.000Z',
		buildFilename: (rawFilename, fallbackPrefix) => rawFilename || fallbackPrefix,
		resolveMemoryScope: () => 'global',
		buildArchitectureStatus: () => ({
			architecture_status: 'healthy',
			missing_graph_bridges: [],
		}),
		resolveBridgeMetadata: (_scope, _hint, relatedWiki, relatedSources) => ({
			missing_wiki_bridge: false,
			related_wiki: relatedWiki,
			missing_related_wiki: [],
			related_sources: relatedSources,
			missing_related_sources: [],
		}),
		resolveProjectIdentity: () => null,
		assertAllowed: () => undefined,
		memoryRule: () => 'review_queue',
		writeImmutableProjectMemory: async () => ({ status: 'review_required' }),
		resolveAutoMemoryTarget: () => null,
		appendAutoMemoryWrite: async () => {
			throw new Error('unexpected auto write');
		},
		findOwnedProposalNote: async () => null,
		writeProposalNote: async (input) => {
			writes.push(input);
			return {
				path: '00_tracekeeper/review_queue/direct-proposal.md',
				activity_path: '00_tracekeeper/control/agent_activity/2026/2026-08-03.md',
				status: 'written',
				warnings: [],
			};
		},
		ensureOwnedProposalIdentity: async () => undefined,
		updateTaskMemoryWrite: async () => undefined,
		updateTaskProposalReference: async (taskId, proposal) => {
			taskReferences.push({ taskId, proposal });
		},
		assertSafeText: () => undefined,
		renderText: (_zh, en) => en,
	});

	const request = {
		rawArgs: {
		proposal_kind: 'task_decision',
		content: 'Keep the bounded decision.',
		evidence: 'direct test',
		task_id: 'direct-task',
		filename: 'direct-proposal',
		related_wiki: ['01_knowledge/wiki/one.md, 01_knowledge/wiki/two.md'],
		related_sources: ['01_knowledge/sources/source.md'],
		idempotency_key: 'direct-proposal-idempotency',
	},
	};

	const result = await service.execute(request);
	assert.equal(result.ok, true);
	assert.equal(result.tool, 'tracekeeper.propose_memory');
	assert.equal(result.memory_rule, 'review_queue');
	assert.equal(result.memory_scope, 'global');
	assert.equal(result.proposal_path, '00_tracekeeper/review_queue/direct-proposal.md');
	assert.equal(writes.length, 1);
	assert.match(writes[0].body, /Keep the bounded decision\./);
	assert.deepEqual(taskReferences, [{
		taskId: 'direct-task',
		proposal: {
			proposalId: result.proposal_id,
			path: '00_tracekeeper/review_queue/direct-proposal.md',
			linkTarget: '00_tracekeeper/review_queue/direct-proposal.md',
		},
	}]);

	const replay = await service.execute(request);
	assert.deepEqual(replay, result);
	assert.equal(writes.length, 1);
});
