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
			target_note: 'projects/tracekeeper/index.md',
			task_id: 'task-42',
			evidence: ['e1', 'e2', 'e1'],
			risk_level: 'low',
			writeback_content: 'frontmatter line1\\nfrontmatter line2',
			revision_requested_by: 'agent',
			revision_requested_at: '2026-01-01T00:00:00Z',
			revision_comment: 'please keep scope',
		},
		body: '# Memory proposal\n\nNo details\n\n## Writeback\nBody writeback should be ignored when frontmatter exists.\n',
	});

	assert.equal(memoryProposal?.classification, 'memory_proposal');
	assert.equal(memoryProposal?.proposalId, 'prop-1');
	assert.equal(memoryProposal?.approvalStatus, 'pending');
	assert.equal(memoryProposal?.targetNote, 'projects/tracekeeper/index.md');
	assert.equal(memoryProposal?.riskLevel, 'low');
	assert.equal(memoryProposal?.revisionRequestedBy, 'agent');
	assert.equal(memoryProposal?.evidence.length, 2);
	assert.equal(memoryProposal?.writebackContent, 'frontmatter line1\nfrontmatter line2');
	assert.equal(memoryProposal?.targetNote, 'projects/tracekeeper/index.md');

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
			target_note: 'notes/target.md',
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
		fields: { type: 'memory-proposal', approval_status: 'pending', proposal_id: 'p1', target_note: 'a.md' },
		body: 'pending',
	});
	const applied = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/applied.md',
		fileMtime: 1700000000000,
		fields: { type: 'memory-proposal', approval_status: 'applied', proposal_id: 'p2', target_note: 'b.md' },
		body: 'applied',
	});
	const rejected = reviewModule.parseMemoryProposalRecord({
		filePath: 'review_queue/rejected.md',
		fileMtime: 1700000200000,
		fields: { type: 'memory-proposal', approval_status: 'rejected', proposal_id: 'p3', target_note: 'c.md' },
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

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 27 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
