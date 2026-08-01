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
		{ ...memoryProposal, approvalStatus: 'pending' },
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

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 43 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
