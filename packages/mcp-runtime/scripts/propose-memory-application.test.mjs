#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { computePayloadHash } from '@tracekeeper/core';
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
		writeImmutableMemoryRecord: async () => ({
			status: 'review_required',
			reason: 'test_review_required',
			warnings: ['Test review requirement.'],
		}),
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
			memory_scope: 'global',
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
	assert.equal(writes[0].frontmatter.writeback_effect, 'create_memory_record');
	assert.match(writes[0].body, /Keep the bounded decision\./);
	assert.match(
		writes[0].body,
		new RegExp(`tracekeeper:writeback:start proposal_id="${result.proposal_id}"`)
	);
	assert.match(
		writes[0].body,
		new RegExp(`tracekeeper:writeback:end proposal_id="${result.proposal_id}"`)
	);
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

test('ProposeMemoryApplicationService marks missing wiki target as create_wiki_note', async () => {
	const journal = createInMemoryJournal();
	const writes = [];
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
		writeImmutableMemoryRecord: async () => ({
			status: 'review_required',
			reason: 'test_review_required',
			warnings: ['Test review requirement.'],
		}),
		resolveAutoMemoryTarget: () => null,
		appendAutoMemoryWrite: async () => {
			throw new Error('unexpected auto write');
		},
		findOwnedProposalNote: async () => null,
		isTargetNoteMissing: async (targetNote) => targetNote === '01_knowledge/wiki/new-missing-note.md',
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
		updateTaskProposalReference: async () => undefined,
		assertSafeText: () => undefined,
		renderText: (_zh, en) => en,
	});

	const request = {
		rawArgs: {
			proposal_kind: 'task_decision',
			content: 'Writeback missing wiki note directly.',
			evidence: 'direct test',
			task_id: 'direct-task',
			filename: 'direct-proposal',
			target_note: '01_knowledge/wiki/new-missing-note.md',
			related_wiki: ['01_knowledge/wiki/related.md'],
			related_sources: ['01_knowledge/sources/source.md'],
			idempotency_key: 'direct-proposal-idempotency-wiki-missing',
		},
	};

	const result = await service.execute(request);
	assert.equal(result.ok, true);
	assert.equal(writes.length, 1);
	assert.equal(writes[0].frontmatter.writeback_effect, 'create_wiki_note');
	assert.match(writes[0].body, /^- writeback_effect: create_wiki_note$/m);
});

test('ProposeMemoryApplicationService keeps append effect for existing Wiki and Memory targets', async () => {
	const journal = createInMemoryJournal();
	const writes = [];
	const service = new ProposeMemoryApplicationService({
		journal,
		createIdentity: (_requestHash, idempotencyKey) => ({
			operationId: `propose-memory-direct-existing-${idempotencyKey}`,
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
		writeImmutableMemoryRecord: async () => ({
			status: 'review_required',
			reason: 'test_review_required',
			warnings: ['Test review requirement.'],
		}),
		resolveAutoMemoryTarget: () => null,
		appendAutoMemoryWrite: async () => {
			throw new Error('unexpected auto write');
		},
		findOwnedProposalNote: async () => null,
		isTargetNoteMissing: async () => false,
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
		updateTaskProposalReference: async () => undefined,
		assertSafeText: () => undefined,
		renderText: (_zh, en) => en,
	});

	const request = {
		rawArgs: {
			proposal_kind: 'task_decision',
			content: 'Writeback existing wiki note directly.',
			evidence: 'direct test',
			task_id: 'direct-task',
			filename: 'direct-proposal',
			target_note: '01_knowledge/wiki/existing-wiki-note.md',
			related_wiki: ['01_knowledge/wiki/related.md'],
			related_sources: ['01_knowledge/sources/source.md'],
			idempotency_key: 'direct-proposal-idempotency-wiki-existing',
		},
	};

	const result = await service.execute(request);
	assert.equal(result.ok, true);
	assert.equal(writes.length, 1);
	assert.equal(writes[0].frontmatter.writeback_effect, 'append');

	const memoryResult = await service.execute({
		rawArgs: {
			proposal_kind: 'task_decision',
			memory_scope: 'global',
			content: 'Append to an existing governed Memory note.',
			evidence: 'direct test',
			task_id: 'direct-task',
			filename: 'direct-memory-proposal',
			target_note: '01_knowledge/memory/global/existing-memory-note.md',
			claim_key: 'existing-memory-claim',
			related_wiki: ['01_knowledge/wiki/related.md'],
			related_sources: ['01_knowledge/sources/source.md'],
			idempotency_key: 'direct-proposal-idempotency-memory-existing',
		},
	});
	assert.equal(memoryResult.ok, true);
	assert.equal(writes.length, 2);
	assert.equal(writes[1].frontmatter.writeback_effect, 'append');
});

test('ProposeMemoryApplicationService keeps legacy wiki behavior when claim_key is explicit', async () => {
	const journal = createInMemoryJournal();
	const writes = [];
	const service = new ProposeMemoryApplicationService({
		journal,
		createIdentity: (_requestHash, idempotencyKey) => ({
			operationId: 'propose-memory-direct-claim',
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
		writeImmutableMemoryRecord: async () => ({
			status: 'review_required',
			reason: 'test_review_required',
			warnings: ['Test review requirement.'],
		}),
		resolveAutoMemoryTarget: () => null,
		appendAutoMemoryWrite: async () => {
			throw new Error('unexpected auto write');
		},
		findOwnedProposalNote: async () => null,
		isTargetNoteMissing: async (targetNote) => targetNote === '01_knowledge/wiki/claimed-missing-note.md',
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
		updateTaskProposalReference: async () => undefined,
		assertSafeText: () => undefined,
		renderText: (_zh, en) => en,
	});

	const request = {
		rawArgs: {
			proposal_kind: 'task_decision',
			content: 'Wiki claim key should not force memory record.',
			evidence: 'direct test',
			task_id: 'direct-task',
			filename: 'direct-proposal',
			target_note: '01_knowledge/wiki/claimed-existing-note.md',
			claim_key: 'legacy-claim-key',
			related_wiki: ['01_knowledge/wiki/related.md'],
			related_sources: ['01_knowledge/sources/source.md'],
			idempotency_key: 'direct-proposal-idempotency-wiki-claim',
		},
	};

	const result = await service.execute(request);
	assert.equal(result.ok, true);
	assert.equal(writes.length, 1);
	assert.equal(writes[0].frontmatter.writeback_effect, 'append');
});

test('ProposeMemoryApplicationService with claim_key but no target_note defaults to create_memory_record', async () => {
	const journal = createInMemoryJournal();
	const writes = [];
	const service = new ProposeMemoryApplicationService({
		journal,
		createIdentity: (_requestHash, idempotencyKey) => ({
			operationId: 'propose-memory-direct-governed-missing-target',
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
		writeImmutableMemoryRecord: async () => ({
			status: 'review_required',
			reason: 'test_review_required',
			warnings: ['Test review requirement.'],
		}),
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
		updateTaskProposalReference: async () => undefined,
		assertSafeText: () => undefined,
		renderText: (_zh, en) => en,
	});

	const request = {
		rawArgs: {
			proposal_kind: 'task_decision',
			memory_scope: 'global',
			content: 'Controlled review queue proposal without explicit target.',
			evidence: 'direct test',
			task_id: 'direct-task',
			filename: 'direct-proposal',
			claim_key: 'governed-claim-key',
			related_wiki: ['01_knowledge/wiki/related.md'],
			related_sources: ['01_knowledge/sources/source.md'],
			idempotency_key: 'direct-proposal-idempotency-governed-targetless',
		},
	};

	const result = await service.execute(request);
	assert.equal(result.ok, true);
	assert.equal(writes.length, 1);
	assert.equal(writes[0].frontmatter.writeback_effect, 'create_memory_record');
});

test('ProposeMemoryApplicationService persists writeback effect after first journal write', async () => {
	let targetChecks = 0;
	const calls = [];
	const journal = createInMemoryJournal();
	const writes = [];
	const service = new ProposeMemoryApplicationService({
		journal,
		createIdentity: (_requestHash, idempotencyKey) => ({
			operationId: 'propose-memory-direct-persist',
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
		writeImmutableMemoryRecord: async () => ({
			status: 'review_required',
			reason: 'test_review_required',
			warnings: ['Test review requirement.'],
		}),
		resolveAutoMemoryTarget: () => null,
		appendAutoMemoryWrite: async () => {
			throw new Error('unexpected auto write');
		},
		findOwnedProposalNote: async () => null,
		isTargetNoteMissing: async (targetNote) => {
			calls.push(targetNote);
			targetChecks += 1;
			return calls.length === 1;
		},
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
		updateTaskProposalReference: async () => undefined,
		assertSafeText: () => undefined,
		renderText: (_zh, en) => en,
	});

	const request = {
		rawArgs: {
			proposal_kind: 'task_decision',
			content: 'Persist writeback effect on first write.',
			evidence: 'direct test',
			task_id: 'direct-task',
			filename: 'direct-proposal',
			target_note: '01_knowledge/wiki/persisting-missing-note.md',
			related_wiki: ['01_knowledge/wiki/related.md'],
			related_sources: ['01_knowledge/sources/source.md'],
			idempotency_key: 'direct-proposal-idempotency-persist',
		},
	};

	const first = await service.execute(request);
	assert.equal(first.ok, true);
	assert.equal(writes.length, 1);
	assert.equal(writes[0].frontmatter.writeback_effect, 'create_wiki_note');
	const recorded = await journal.loadById('propose-memory-direct-persist');
	assert.equal(recorded?.payload?.writebackEffect, 'create_wiki_note');
	assert.equal(targetChecks, 1);

	const second = await service.execute(request);
	assert.deepEqual(second, first);
	assert.equal(writes.length, 1);
	assert.equal(targetChecks, 1);
});

test('ProposeMemoryApplicationService does not synthesize a live effect for a legacy journal payload', async () => {
	let interruptBeforeFinalize = true;
	let targetChecks = 0;
	const journal = createInMemoryJournal();
	const writes = [];
	const operationId = 'propose-memory-direct-legacy-effect';
	const service = new ProposeMemoryApplicationService({
		journal,
		createIdentity: (_requestHash, idempotencyKey) => ({ operationId, idempotencyKey }),
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
		writeImmutableMemoryRecord: async () => ({
			status: 'review_required',
			reason: 'test_review_required',
			warnings: ['Test review requirement.'],
		}),
		resolveAutoMemoryTarget: () => null,
		appendAutoMemoryWrite: async () => {
			throw new Error('unexpected auto write');
		},
		findOwnedProposalNote: async () => null,
		isTargetNoteMissing: async () => {
			targetChecks += 1;
			return true;
		},
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
		updateTaskProposalReference: async () => undefined,
		assertSafeText: () => undefined,
		renderText: (_zh, en) => en,
		failureInjection: ({ phase }) => {
			if (interruptBeforeFinalize && phase === 'before_finalize') {
				throw new Error('simulate legacy in-flight operation');
			}
		},
	});
	const request = {
		rawArgs: {
			proposal_kind: 'task_decision',
			content: 'Legacy operation payload should remain stable during recovery.',
			evidence: 'direct test',
			task_id: 'direct-task',
			filename: 'direct-legacy-proposal',
			target_note: '01_knowledge/wiki/legacy-journal-target.md',
			related_wiki: ['01_knowledge/wiki/related.md'],
			related_sources: ['01_knowledge/sources/source.md'],
			idempotency_key: 'direct-proposal-idempotency-legacy-effect',
		},
	};

	await assert.rejects(() => service.execute(request), /legacy in-flight operation/i);
	const legacyRecord = await journal.loadById(operationId);
	delete legacyRecord.payload.writebackEffect;
	legacyRecord.payload_hash = computePayloadHash(legacyRecord.payload);
	await journal.save(legacyRecord);
	interruptBeforeFinalize = false;

	const recovered = await service.execute(request);
	assert.equal(recovered.ok, true);
	assert.equal(targetChecks, 1);
	assert.equal(writes.length, 1);
	assert.equal('writeback_effect' in writes[0].frontmatter, false);
	assert.doesNotMatch(writes[0].body, /^- writeback_effect:/m);
});

test('ProposeMemoryApplicationService fails closed for unfinished legacy Memory writes', async () => {
	let interruptBeforeFinalize = true;
	let durableWrites = 0;
	const journal = createInMemoryJournal();
	const operationId = 'propose-memory-unfinished-legacy-global';
	const service = new ProposeMemoryApplicationService({
		journal,
		createIdentity: (_requestHash, idempotencyKey) => ({ operationId, idempotencyKey }),
		observedAgentType: 'custom',
		now: () => '2026-08-03T00:00:00.000Z',
		buildFilename: (rawFilename, fallbackPrefix) => rawFilename || fallbackPrefix,
		resolveMemoryScope: () => 'global',
		buildArchitectureStatus: () => ({ architecture_status: 'healthy', missing_graph_bridges: [] }),
		resolveBridgeMetadata: () => ({
			missing_wiki_bridge: false,
			related_wiki: [],
			missing_related_wiki: [],
			related_sources: [],
			missing_related_sources: [],
		}),
		resolveProjectIdentity: () => null,
		assertAllowed: () => undefined,
		memoryRule: () => 'auto_write',
		writeImmutableMemoryRecord: async () => {
			durableWrites += 1;
			throw new Error('legacy recovery must not invoke the v2 writer');
		},
		findOwnedProposalNote: async () => null,
		writeProposalNote: async () => {
			durableWrites += 1;
			throw new Error('legacy recovery must not create a proposal');
		},
		ensureOwnedProposalIdentity: async () => undefined,
		updateTaskMemoryWrite: async () => undefined,
		updateTaskProposalReference: async () => undefined,
		assertSafeText: () => undefined,
		renderText: (_zh, en) => en,
		failureInjection: ({ phase }) => {
			if (interruptBeforeFinalize && phase === 'before_finalize') {
				throw new Error('simulate unfinished v2 global operation');
			}
		},
	});
	const request = {
		rawArgs: {
			proposal_kind: 'agent_preference',
			content: 'An unfinished legacy Global append cannot be promoted during recovery.',
			memory_scope: 'global',
			claim_key: 'preference:legacy-global-recovery',
			idempotency_key: 'unfinished-legacy-global-key',
		},
	};
	await assert.rejects(() => service.execute(request), /unfinished v2 global operation/i);
	const legacyRecord = await journal.loadById(operationId);
	delete legacyRecord.payload.memoryRecordWriteVersion;
	legacyRecord.payload_hash = computePayloadHash(legacyRecord.payload);
	await journal.save(legacyRecord);
	interruptBeforeFinalize = false;
	await assert.rejects(
		() => service.execute(request),
		/Cannot recover unfinished legacy propose_memory operation/i
	);
	assert.equal(durableWrites, 0);
});

test('ProposeMemoryApplicationService validates allowed target before missing-target probe', async () => {
	const writes = [];
	let order = '';
	const service = new ProposeMemoryApplicationService({
		journal: createInMemoryJournal(),
		createIdentity: (_requestHash, idempotencyKey) => ({
			operationId: 'propose-memory-direct-boundary',
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
		assertAllowed: () => {
			order += 'a';
			throw new Error('policy denied');
		},
		memoryRule: () => 'review_queue',
		writeImmutableMemoryRecord: async () => ({
			status: 'review_required',
			reason: 'test_review_required',
			warnings: ['Test review requirement.'],
		}),
		resolveAutoMemoryTarget: () => null,
		appendAutoMemoryWrite: async () => {
			throw new Error('unexpected auto write');
		},
		findOwnedProposalNote: async () => null,
		isTargetNoteMissing: async () => {
			order += 'm';
			throw new Error('target lookup should not occur');
		},
		writeProposalNote: async (input) => {
			writes.push(input);
			throw new Error('unexpected write');
		},
		ensureOwnedProposalIdentity: async () => undefined,
		updateTaskMemoryWrite: async () => undefined,
		updateTaskProposalReference: async () => undefined,
		assertSafeText: () => undefined,
		renderText: (_zh, en) => en,
	});

	const request = {
		rawArgs: {
			proposal_kind: 'task_decision',
			memory_scope: 'global',
			content: 'Policy check should happen before target probe.',
			evidence: 'direct test',
			task_id: 'direct-task',
			filename: 'direct-proposal',
			target_note: '../outside/vault.md',
			related_wiki: ['01_knowledge/wiki/related.md'],
			related_sources: ['01_knowledge/sources/source.md'],
			idempotency_key: 'direct-proposal-idempotency-policy',
		},
	};

	await assert.rejects(
		() => service.execute(request),
		/policy denied/,
		'assertAllowed should reject before target probe'
	);
	assert.equal(order, 'a');
	assert.equal(writes.length, 0);
});

test('disabled Memory result is a journaled completed no-op with exact replay and conflict semantics', async () => {
	const journal = createInMemoryJournal();
	let activeRule = 'disabled';
	let durableWrites = 0;
	const service = new ProposeMemoryApplicationService({
		journal,
		createIdentity: (_requestHash, idempotencyKey) => ({
			operationId: 'propose-memory-disabled-noop',
			idempotencyKey,
		}),
		observedAgentType: 'custom',
		now: () => '2026-08-03T00:00:00.000Z',
		buildFilename: (rawFilename, fallbackPrefix) => rawFilename || fallbackPrefix,
		resolveMemoryScope: () => 'global',
		buildArchitectureStatus: () => ({ architecture_status: 'healthy', missing_graph_bridges: [] }),
		resolveBridgeMetadata: () => ({
			missing_wiki_bridge: false,
			related_wiki: [],
			missing_related_wiki: [],
			related_sources: [],
			missing_related_sources: [],
		}),
		resolveProjectIdentity: () => null,
		assertAllowed: () => undefined,
		memoryRule: () => activeRule,
		writeImmutableMemoryRecord: async () => {
			durableWrites += 1;
			throw new Error('disabled result must not invoke the writer');
		},
		findOwnedProposalNote: async () => null,
		writeProposalNote: async () => {
			durableWrites += 1;
			throw new Error('disabled result must not create a proposal');
		},
		ensureOwnedProposalIdentity: async () => undefined,
		updateTaskMemoryWrite: async () => undefined,
		updateTaskProposalReference: async () => undefined,
		assertSafeText: () => undefined,
		renderText: (_zh, en) => en,
	});
	const request = {
		rawArgs: {
			proposal_kind: 'agent_preference',
			content: 'Disabled result must remain a durable no-op.',
			memory_scope: 'global',
			idempotency_key: 'disabled-noop-key',
		},
	};
	const first = await service.execute(request);
	assert.equal(first.status, 'ignored');
	assert.equal(first.persisted, false);
	const record = await journal.loadById('propose-memory-disabled-noop');
	assert.equal(record.status, 'completed');
	assert.equal(record.payload.policyOutcome, 'disabled');
	assert.equal(record.payload.memoryRule, 'disabled');

	activeRule = 'auto_write';
	const replay = await service.execute(request);
	assert.deepEqual(replay, first);
	assert.equal(durableWrites, 0);
	await assert.rejects(
		() => service.execute({
			rawArgs: {
				...request.rawArgs,
				content: 'Changed payload must conflict.',
			},
		}),
		/different propose_memory request hash/i
	);
	assert.equal(durableWrites, 0);
});
