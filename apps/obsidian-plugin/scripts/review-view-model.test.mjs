#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-review-view-model-test-'));
const output = path.join(tempRoot, 'review-view-model.test.mjs');

try {
	await build({
		entryPoints: [path.resolve('src/features/review/review-view-model.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
		plugins: [
			{
				name: 'tracekeeper-core-stub',
				setup(build) {
					build.onResolve({ filter: /^@tracekeeper\/core$/ }, () => ({
						path: 'tracekeeper-core-stub',
						namespace: 'tracekeeper-core-stub',
					}));
					build.onLoad({ filter: /^tracekeeper-core-stub$/, namespace: 'tracekeeper-core-stub' }, () => ({
						loader: 'js',
						contents: `
							export const ARCHIVE_REVIEW_QUEUE_DIR = '02_archive/review_queue';
							export const KNOWLEDGE_INDEX_PATH = '01_knowledge/index.md';
							export const KNOWLEDGE_MEMORY_DIR = '01_knowledge/memory';
							export const KNOWLEDGE_WIKI_DIR = '01_knowledge/wiki';
							export const normalizeKnowledgePath = (value) => value.replace(/\\\\/g, '/').trim().replace(/^\\.\\//, '').replace(/^\\/+/, '').replace(/\\/+/g, '/');
							export const startsWithPathPrefix = (value, prefix) => {
								const normalized = normalizeKnowledgePath(value);
								const normalizedPrefix = normalizeKnowledgePath(prefix).replace(/\\/+$/, '');
								return normalized === normalizedPrefix || normalized.startsWith(normalizedPrefix + '/');
							};
							export const computeProposalContentHash = (value) => 'content:' + JSON.stringify(value);
							export const computeProposalRevision = (value) => {
								const copy = { ...value, writebackContent: '' };
								return 'revision:' + JSON.stringify(copy);
							};
							export const proposalTransitionReceiptFromFrontmatter = () => undefined;
						`,
					}));
				},
			},
		],
	});

	const reviewModule = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

	assert.equal(reviewModule.normalizeProposalStatus('approved'), 'approved');
	assert.equal(reviewModule.normalizeProposalStatus('pending_review'), 'pending');
	assert.equal(reviewModule.normalizeProposalStatus('   '), 'pending');

	const memoryProposal = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/memory-proposal.md',
		fileMtime: 1700000300000,
		fields: {
			type: 'memory-proposal',
			proposal_id: 'prop-1',
			proposal_kind: 'memory',
			approval_status: 'pending_review',
			proposed_by: 'trace-operator',
			related_project: 'tracekeeper',
			project_id: 'tracekeeper-id',
			claim_key: 'project:review-lifecycle',
			proposed_authority: 'user',
			proposed_confidence: 'verified',
			review_reason: 'user_authority_requires_human_review',
			review_warnings: ['Agent-originated memory cannot self-assign user authority.'],
			declared_state: 'active',
			observed_at: '2026-08-06T00:00:00.000Z',
			supersedes: ['memory-old'],
			contradicts: ['memory-conflict'],
			target_note: '01_knowledge/memory/projects/tracekeeper/memory.md',
			task_id: 'task-42',
			evidence: ['e1', 'e2', 'e1'],
			related_sources: ['01_knowledge/sources/web/a.md', '01_knowledge/sources/web/a.md'],
			proposal_source_session_note: '00_tracekeeper/work/sessions/task-42.md',
			risk_level: 'low',
			writeback_content: 'frontmatter line1\\nfrontmatter line2',
			rationale: 'Preserve a durable implementation decision.',
			revision_requested_by: 'agent',
			revision_requested_at: '2026-01-01T00:00:00Z',
			revision_comment: 'please keep scope',
		},
		body: '# Memory proposal\n\nNo details\n\n## Writeback\nBody writeback should be ignored when frontmatter exists.\n',
	});

	assert.equal(memoryProposal?.classification, 'memory_proposal');
	assert.equal(memoryProposal?.proposalId, 'prop-1');
	assert.equal(memoryProposal?.approvalStatus, 'pending');
	assert.equal(memoryProposal?.targetNote, '01_knowledge/memory/projects/tracekeeper/memory.md');
	assert.equal(memoryProposal?.claimKey, 'project:review-lifecycle');
	assert.equal(memoryProposal?.proposedAuthority, 'user');
	assert.equal(memoryProposal?.proposedConfidence, 'verified');
	assert.equal(memoryProposal?.reviewReason, 'user_authority_requires_human_review');
	assert.deepEqual(memoryProposal?.reviewWarnings, [
		'Agent-originated memory cannot self-assign user authority.',
	]);
	assert.deepEqual(memoryProposal?.supersedes, ['memory-old']);
	assert.deepEqual(memoryProposal?.contradicts, ['memory-conflict']);
	const lifecycleCreateValidity = reviewModule.getReviewProposalValidity(memoryProposal, { exists: false });
	assert.equal(lifecycleCreateValidity.isComplete, true);
	assert.equal(lifecycleCreateValidity.missingTargetEvidence, false);

	const missingMemoryAppendWithoutClaim = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/missing-memory-append-no-claim.md',
		fields: {
			type: 'memory-proposal',
			proposal_id: 'append-without-claim',
			target_note: '01_knowledge/memory/projects/tracekeeper/memory.md',
			writeback_effect: 'append',
			writeback_content: 'append legacy',
		},
		body: '# Missing claim append\n',
	});
	const appendWithoutClaimValidity = reviewModule.getReviewProposalValidity(
		{
			...(missingMemoryAppendWithoutClaim || {}),
			claimKey: '',
		},
		{ exists: false }
	);
	assert.equal(appendWithoutClaimValidity.isComplete, false);
	assert.equal(appendWithoutClaimValidity.missingTargetEvidence, true);

	const wikiCreateMissing = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/wiki-create-missing.md',
		fields: {
			type: 'memory-proposal',
			proposal_id: 'wiki-create-missing',
			target_note: '01_knowledge/wiki/new-topic.md',
			writeback_content: 'new wiki content',
		},
		body: '# Missing wiki create\n',
	});
	assert.equal(wikiCreateMissing?.invalidWritebackEffect, false);
	const wikiMissingCreateValidity = reviewModule.getReviewProposalValidity(wikiCreateMissing, { exists: false });
	assert.equal(wikiMissingCreateValidity.isComplete, true);

	const wikiCreateConflict = reviewModule.getReviewProposalValidity({
		...wikiCreateMissing,
		writebackEffect: 'create_wiki_note',
	}, { exists: true });
	assert.equal(wikiCreateConflict.isComplete, false);
	assert.equal(wikiCreateConflict.effectTargetMismatch, false);

	const wikiCreateTargetedMemory = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/wiki-create-memory.md',
		fields: {
			type: 'memory-proposal',
			proposal_id: 'wiki-create-memory',
			target_note: '01_knowledge/memory/projects/tracekeeper/memory.md',
			writeback_effect: 'create_wiki_note',
			writeback_content: 'should not be able',
		},
		body: '# Wiki create against memory target\n',
	});
	assert.equal(
		reviewModule.getReviewProposalValidity(wikiCreateTargetedMemory, { exists: false }).isComplete,
		false
	);
	assert.equal(
		reviewModule.getReviewProposalValidity(wikiCreateTargetedMemory, { exists: false }).effectTargetMismatch,
		true
	);
	const wikiCreateTargetedMemoryExisting = reviewModule.getReviewProposalValidity(
		wikiCreateTargetedMemory,
		{ exists: true }
	);
	assert.equal(wikiCreateTargetedMemoryExisting.effectTargetMismatch, true);
	assert.equal(wikiCreateTargetedMemoryExisting.isComplete, false);
	assert.equal(wikiCreateTargetedMemoryExisting.missingTargetEvidence, false);

	const memoryCreateTargetedWikiExisting = reviewModule.getReviewProposalValidity(
		reviewModule.parseMemoryProposalRecord({
			filePath: 'review_queue/memory-create-to-wiki.md',
			fields: {
				type: 'memory-proposal',
				proposal_id: 'memory-create-to-wiki',
				target_note: '01_knowledge/wiki/topics/memory-like-target.md',
				writeback_effect: 'create_memory_record',
				writeback_content: 'this is wrong target type',
			},
			body: '# MemoryRecord create against wiki target',
		}),
		{ exists: true }
	);
	assert.equal(memoryCreateTargetedWikiExisting.effectTargetMismatch, true);
	assert.equal(memoryCreateTargetedWikiExisting.isComplete, false);

	const writebackEffectConflict = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/writeback-effect-conflict.md',
		fields: {
			type: 'memory-proposal',
			proposal_id: 'writeback-effect-conflict',
			target_note: '01_knowledge/wiki/conflict.md',
			writeback_effect: 'append',
			writebackEffect: 'create_memory_record',
			writeback_content: 'content',
		},
		body: '# Effect conflict\n',
	});
	assert.ok(writebackEffectConflict);
	assert.equal(writebackEffectConflict?.invalidWritebackEffect, true);
	const writebackEffectArray = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/writeback-effect-array.md',
		fields: {
			type: 'memory-proposal',
			proposal_id: 'writeback-effect-array',
			target_note: '01_knowledge/wiki/conflict-array.md',
			writeback_effect: ['append', 'create_wiki_note'],
			writeback_content: 'content',
		},
		body: '# Effect array\n',
	});
	assert.ok(writebackEffectArray);
	assert.equal(writebackEffectArray?.invalidWritebackEffect, true);
	assert.equal(writebackEffectArray?.writebackEffect, undefined);

	assert.equal(memoryProposal?.riskLevel, 'low');
	assert.equal(memoryProposal?.revisionRequestedBy, 'agent');
	assert.equal(memoryProposal?.evidence.length, 2);
	assert.deepEqual(memoryProposal?.relatedSources, ['01_knowledge/sources/web/a.md']);
	assert.equal(memoryProposal?.sourceSessionNote, '00_tracekeeper/work/sessions/task-42.md');
	assert.equal(memoryProposal?.rationale, 'Preserve a durable implementation decision.');
	assert.equal(memoryProposal?.writebackContent, 'frontmatter line1\nfrontmatter line2');
	assert.equal(memoryProposal?.writebackSource, 'frontmatter');
	assert.equal(memoryProposal?.archived, false);
	assert.match(memoryProposal?.contentHash || '', /^content:/);
	assert.match(memoryProposal?.revision || '', /^revision:/);
	assert.equal(memoryProposal?.targetNote, '01_knowledge/memory/projects/tracekeeper/memory.md');

	const appliedCreateReceipt = {
		schemaVersion: 1,
		operationId: 'apply-create-wiki',
		payloadHash: 'payload-hash',
		kind: 'apply',
		proposalPath: 'review_queue/applied-create-wiki.md',
		proposalId: 'applied-create-wiki',
		taskId: 'task-42',
		previousStatus: 'approved',
		nextStatus: 'applied',
		expectedRevision: 'expected-revision',
		expectedContentHash: 'expected-content-hash',
		previousRevision: 'previous-revision',
		committedRevision: 'committed-revision',
		previousContentHash: 'previous-content-hash',
		committedContentHash: 'applied-create-content-hash',
		committedAt: '2026-08-10T01:02:03.000Z',
	};
	const appliedMetadataRecord = reviewModule.parseMemoryProposalRecord({
		filePath: appliedCreateReceipt.proposalPath,
		fields: {
			type: 'memory-proposal',
			proposal_id: appliedCreateReceipt.proposalId,
			approval_status: 'applied',
			target_note: '01_knowledge/wiki/applied-create-wiki.md',
			writeback_content: 'created Wiki body',
			writeback_effect: 'create_wiki_note',
			writeback_operation_id: appliedCreateReceipt.operationId,
			writeback_applied_at: appliedCreateReceipt.committedAt,
			writeback_target: '01_knowledge/wiki/applied-create-wiki.md',
		},
		body: '# Applied create Wiki\n',
	});
	assert.equal(appliedMetadataRecord?.writebackOperationId, 'apply-create-wiki');
	assert.equal(appliedMetadataRecord?.writebackAppliedAt, '2026-08-10T01:02:03.000Z');
	assert.equal(appliedMetadataRecord?.writebackTarget, '01_knowledge/wiki/applied-create-wiki.md');
	const conflictingOperationMetadata = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/conflicting-operation.md',
		fields: {
			type: 'memory-proposal',
			proposal_id: 'conflicting-operation',
			approval_status: 'applied',
			target_note: '01_knowledge/wiki/conflicting-operation.md',
			writeback_content: 'content',
			writeback_effect: 'create_wiki_note',
			writeback_operation_id: 'canonical-operation',
			writebackOperationId: 'conflicting-operation',
		},
		body: '# Conflicting operation metadata\n',
	});
	assert.equal(conflictingOperationMetadata?.invalidWritebackOperationId, true);
	const placeholderOperationMetadata = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/placeholder-operation.md',
		fields: {
			type: 'memory-proposal',
			proposal_id: 'placeholder-operation',
			approval_status: 'applied',
			target_note: '01_knowledge/wiki/placeholder-operation.md',
			writeback_content: 'content',
			writeback_effect: 'create_wiki_note',
			writeback_operation_id: 'unknown',
		},
		body: '# Placeholder operation metadata\n',
	});
	assert.equal(placeholderOperationMetadata?.invalidWritebackOperationId, true);
	const conflictingTargetMetadata = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/conflicting-target-metadata.md',
		fields: {
			type: 'memory-proposal',
			proposal_id: 'conflicting-target-metadata',
			approval_status: 'applied',
			target_note: '01_knowledge/wiki/conflicting-target-metadata.md',
			writeback_content: 'content',
			writeback_effect: 'create_wiki_note',
			writeback_target: '01_knowledge/wiki/conflicting-target-metadata.md',
			writebackTarget: '01_knowledge/wiki/different-target.md',
		},
		body: '# Conflicting target metadata\n',
	});
	assert.equal(conflictingTargetMetadata?.invalidWritebackTarget, true);
	const appliedCreateHistory = reviewModule.getReviewAppliedHistory({
		...memoryProposal,
		path: appliedCreateReceipt.proposalPath,
		proposalId: appliedCreateReceipt.proposalId,
		taskId: appliedCreateReceipt.taskId,
		approvalStatus: 'applied',
		targetNote: '01_knowledge/wiki/applied-create-wiki.md',
		writebackEffect: 'create_wiki_note',
		writebackOperationId: appliedCreateReceipt.operationId,
		writebackAppliedAt: appliedCreateReceipt.committedAt,
		writebackTarget: '01_knowledge/wiki/applied-create-wiki.md',
		contentHash: appliedCreateReceipt.committedContentHash,
		revision: appliedCreateReceipt.committedRevision,
		lastTransition: appliedCreateReceipt,
	});
	assert.equal(appliedCreateHistory?.receiptVerified, true);
	assert.equal(appliedCreateHistory?.writebackEffect, 'create_wiki_note');
	assert.equal(appliedCreateHistory?.operationId, 'apply-create-wiki');

	const legacyAppliedHistory = reviewModule.getReviewAppliedHistory({
		...memoryProposal,
		path: 'review_queue/legacy-applied.md',
		proposalId: 'legacy-applied',
		approvalStatus: 'applied',
		writebackEffect: undefined,
		writebackOperationId: 'apply-legacy',
		contentHash: 'legacy-applied-content-hash',
		revision: appliedCreateReceipt.committedRevision,
		lastTransition: {
			...appliedCreateReceipt,
			operationId: 'apply-legacy',
			proposalPath: 'review_queue/legacy-applied.md',
			proposalId: 'legacy-applied',
			committedContentHash: 'legacy-applied-content-hash',
		},
	});
	assert.equal(legacyAppliedHistory?.receiptVerified, true);
	assert.equal(legacyAppliedHistory?.writebackEffect, undefined);
	assert.equal(reviewModule.getReviewAppliedHistory({
		...memoryProposal,
		path: appliedCreateReceipt.proposalPath,
		proposalId: appliedCreateReceipt.proposalId,
		taskId: appliedCreateReceipt.taskId,
		approvalStatus: 'applied',
		targetNote: '01_knowledge/wiki/applied-create-wiki.md',
		writebackEffect: 'create_wiki_note',
		writebackOperationId: appliedCreateReceipt.operationId,
		writebackAppliedAt: '2026-08-10T01:02:04.000Z',
		writebackTarget: '01_knowledge/wiki/applied-create-wiki.md',
		contentHash: appliedCreateReceipt.committedContentHash,
		revision: appliedCreateReceipt.committedRevision,
		lastTransition: appliedCreateReceipt,
	})?.receiptVerified, false);
	assert.equal(reviewModule.getReviewAppliedHistory({
		...memoryProposal,
		path: appliedCreateReceipt.proposalPath,
		proposalId: appliedCreateReceipt.proposalId,
		taskId: appliedCreateReceipt.taskId,
		approvalStatus: 'applied',
		targetNote: '01_knowledge/wiki/applied-create-wiki.md',
		writebackEffect: 'create_wiki_note',
		writebackOperationId: appliedCreateReceipt.operationId,
		writebackAppliedAt: appliedCreateReceipt.committedAt,
		writebackTarget: '01_knowledge/wiki/drifted-target.md',
		contentHash: appliedCreateReceipt.committedContentHash,
		revision: appliedCreateReceipt.committedRevision,
		lastTransition: appliedCreateReceipt,
	})?.receiptVerified, false);

	const driftedAppliedHistory = reviewModule.getReviewAppliedHistory({
		...memoryProposal,
		path: appliedCreateReceipt.proposalPath,
		proposalId: appliedCreateReceipt.proposalId,
		taskId: appliedCreateReceipt.taskId,
		approvalStatus: 'applied',
		writebackEffect: 'append',
		writebackOperationId: 'different-operation',
		contentHash: 'drifted-content-hash',
		lastTransition: appliedCreateReceipt,
	});
	assert.equal(driftedAppliedHistory?.receiptVerified, false);
	assert.equal(driftedAppliedHistory?.writebackEffect, undefined);

	const bodyOnlyProposal = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/body-only.md',
		fields: {
			type: 'memory-proposal',
			proposal_id: 'body-only',
			target_note: '01_knowledge/wiki/guides/target.md',
		},
		body: '# Body only\n\n## Writeback\n\n- body value\n',
	});
	assert.equal(bodyOnlyProposal?.writebackSource, 'body');
	const archivedProposal = reviewModule.parseMemoryProposalRecord({
		filePath: '02_archive/review_queue/archived.md',
		fields: {
			type: 'memory-proposal',
			proposal_id: 'archived',
			target_note: '01_knowledge/wiki/guides/target.md',
		},
		body: '# Archived\n',
	});
	assert.equal(archivedProposal?.archived, true);

	const invalidTarget = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/invalid-target.md',
		fileMtime: 1700000400000,
		fields: {
			type: 'memory-proposal',
			approval_status: 'pending',
			target_note: 'null',
			writeback_content: 'frontmatter line',
		},
		body: '# Invalid proposal\n',
	});
	assert.ok(invalidTarget);
	assert.equal(invalidTarget?.targetNote, '');
	assert.equal(reviewModule.getReviewProposalAttentionState(invalidTarget), 'incomplete');

	const missingWriteback = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/missing-writeback.md',
		fileMtime: 1700000450000,
		fields: {
			type: 'memory-proposal',
			approval_status: 'pending',
			target_note: '01_knowledge/wiki/guides/target.md',
			writeback_content: 'unknown',
		},
		body: '# Missing writeback\n',
	});
	assert.ok(missingWriteback);
	const validity = reviewModule.getReviewProposalValidity(missingWriteback);
	assert.equal(validity.missingTargetNote, false);
	assert.equal(validity.missingWritebackContent, true);
	assert.equal(validity.isComplete, false);
	assert.equal(reviewModule.getReviewProposalAttentionState(missingWriteback), 'incomplete');
	const unresolvedTarget = reviewModule.getReviewProposalValidity(
		{ ...memoryProposal, claimKey: '', approvalStatus: 'pending' },
		{ exists: false }
	);
	assert.equal(unresolvedTarget.targetPathAllowed, true);
	assert.equal(unresolvedTarget.targetExists, false);
	assert.equal(unresolvedTarget.missingTargetEvidence, true);
	assert.equal(unresolvedTarget.isComplete, false);

	const outsideTarget = {
		...memoryProposal,
		targetNote: '00_tracekeeper/work/tasks/task-42.md',
		approvalStatus: 'pending',
	};
	const outsideValidity = reviewModule.getReviewProposalValidity(outsideTarget);
	assert.equal(outsideValidity.invalidTargetNote, true);
	assert.equal(outsideValidity.isComplete, false);
	assert.equal(reviewModule.getReviewProposalAttentionState({ ...outsideTarget, approvalStatus: 'approved' }), 'incomplete');

	const legacyPlaceholders = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/legacy-placeholders.md',
		fileMtime: 1700000470000,
		fields: {
			type: 'memory-proposal',
			approval_status: 'pending',
			target_note: '未指定',
			writeback_content: 'undefined',
		},
		body: '# Legacy placeholders\n',
	});
	assert.ok(legacyPlaceholders);
	assert.equal(legacyPlaceholders?.targetNote, '');
	assert.equal(legacyPlaceholders?.writebackContent, '');
	assert.equal(reviewModule.getReviewProposalAttentionState(legacyPlaceholders), 'incomplete');

	const legacyProposal = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/legacy.md',
		fileMtime: 1700000200000,
		fields: {
			type: 'legacy-migration-review',
			created: '2020-01-01T00:00:00Z',
		},
		body: '# Title\n\nlegacy payload',
	});

	assert.equal(legacyProposal?.classification, 'legacy_migration_review');

	const pending = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/pending.md',
		fileMtime: 1700000100000,
		fields: { type: 'memory-proposal', approval_status: 'pending', proposal_id: 'p1', target_note: '01_knowledge/wiki/a.md' },
		body: 'pending',
	});
	const applied = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/applied.md',
		fileMtime: 1700000000000,
		fields: { type: 'memory-proposal', approval_status: 'applied', proposal_id: 'p2', target_note: '01_knowledge/wiki/b.md' },
		body: 'applied',
	});
	const rejected = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/rejected.md',
		fileMtime: 1700000200000,
		fields: { type: 'memory-proposal', approval_status: 'rejected', proposal_id: 'p3', target_note: '01_knowledge/wiki/c.md' },
		body: 'rejected',
	});

	assert.ok(reviewModule.compareProposalRecords(pending, applied) < 0);
	assert.ok(reviewModule.compareProposalRecords(rejected, applied) > 0);
	assert.ok(reviewModule.compareProposalRecords(applied, rejected) < 0);
	assert.equal(reviewModule.getReviewProposalAttentionState({ ...memoryProposal, approvalStatus: 'approved' }), 'ready_to_apply');
	assert.equal(reviewModule.getReviewProposalAttentionState({ ...pending, approvalStatus: 'revision_requested' }), 'awaiting_revision');
	assert.equal(reviewModule.getReviewProposalAttentionState({ ...applied, approvalStatus: 'applied' }), 'completed');
	assert.equal(reviewModule.getReviewProposalAttentionState({ ...invalidTarget, approvalStatus: 'pending' }), 'incomplete');
	assert.equal(reviewModule.getReviewProposalAttentionState({ ...legacyProposal, approvalStatus: 'approved' }), 'completed');

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 61 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
