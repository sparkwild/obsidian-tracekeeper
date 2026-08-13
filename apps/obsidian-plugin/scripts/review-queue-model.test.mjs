#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-review-queue-model-test-'));
const output = path.join(tempRoot, 'review-queue-model.test.mjs');

const makeProposal = (overrides = {}) => ({
	path: `review_queue/${overrides.proposalId || 'item'}.md`,
	classification: 'memory_proposal',
	proposalId: overrides.proposalId || 'p-default',
	proposalKind: overrides.proposalKind || 'memory',
	proposedBy: overrides.proposedBy || 'agent',
	relatedProject: overrides.relatedProject || '',
	memoryScope: overrides.memoryScope || '',
	taskId: overrides.taskId || '',
	sourceSessionNote: overrides.sourceSessionNote || '',
	targetNote: overrides.targetNote || '',
	evidence: [],
	relatedSources: [],
	rationale: overrides.rationale || '',
	riskLevel: overrides.riskLevel || 'unknown',
	approvalStatus: overrides.approvalStatus || 'pending',
	created: overrides.created || '',
	snippet: overrides.snippet || '',
	sortTimestamp: overrides.sortTimestamp || 0,
	revisionComment: overrides.revisionComment || '',
	revisionRequestedAt: overrides.revisionRequestedAt || '',
	revisionRequestedBy: overrides.revisionRequestedBy || '',
	writebackContent: overrides.writebackContent || '',
	...overrides,
});

const baseProposals = [
	makeProposal({
		proposalId: 'pending-complete',
		targetNote: '01_knowledge/memory/projects/project-alpha/memory.md',
		writebackContent: 'append this\nline',
		approvalStatus: 'pending',
		relatedProject: 'project alpha',
		sortTimestamp: 3000,
		riskLevel: 'low',
	}),
	makeProposal({
		proposalId: 'pending-incomplete',
		targetNote: '',
		writebackContent: 'append this',
		approvalStatus: 'pending',
		relatedProject: 'project beta',
		sortTimestamp: 4000,
	}),
	makeProposal({
		proposalId: 'revision-needed',
		targetNote: '01_knowledge/wiki/revision.md',
		writebackContent: 'append this',
		approvalStatus: 'revision_requested',
		relatedProject: 'project alpha',
		sortTimestamp: 3500,
	}),
	makeProposal({
		proposalId: 'approved-ready',
		targetNote: '01_knowledge/memory/global/ready.md',
		writebackContent: 'append this',
		approvalStatus: 'approved',
		relatedProject: 'project alpha',
		sortTimestamp: 2500,
	}),
	makeProposal({
		proposalId: 'blocked-project',
		targetNote: '01_knowledge/memory/projects/project-old/index.md',
		writebackContent: 'append this',
		approvalStatus: 'pending',
		memoryScope: 'project',
		reviewReason: 'missing_memory_hub',
		relatedProject: 'project old',
		sortTimestamp: 5000,
	}),
	makeProposal({
		proposalId: 'history-item',
		targetNote: '01_knowledge/wiki/history.md',
		writebackContent: 'append this',
		approvalStatus: 'applied',
		relatedProject: 'project gamma',
		sortTimestamp: 2000,
	}),
];

const riskProposals = [
	makeProposal({
		proposalId: 'risk-low',
		targetNote: '01_knowledge/wiki/risk-low.md',
		writebackContent: 'append',
		approvalStatus: 'pending',
		riskLevel: 'low',
		sortTimestamp: 1,
	}),
	makeProposal({
		proposalId: 'risk-high',
		targetNote: '01_knowledge/wiki/risk-high.md',
		writebackContent: 'append',
		approvalStatus: 'pending',
		riskLevel: 'high',
		sortTimestamp: 2,
	}),
	makeProposal({
		proposalId: 'risk-medium',
		targetNote: '01_knowledge/wiki/risk-medium.md',
		writebackContent: 'append',
		approvalStatus: 'pending',
		riskLevel: 'medium',
		sortTimestamp: 3,
	}),
];

const pagedProposals = Array.from({ length: 21 }, (_, index) => makeProposal({
	proposalId: `page-${index + 1}`,
	approvalStatus: 'approved',
	targetNote: `01_knowledge/wiki/page-${index + 1}.md`,
	writebackContent: 'append',
	riskLevel: 'low',
	sortTimestamp: 10000 + index,
}));

try {
	await build({
		entryPoints: [path.resolve('src/features/review/review-queue-model.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
		plugins: [
			{
				name: 'obsidian-stub',
				setup(build) {
					build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian-stub', namespace: 'obsidian-stub' }));
					build.onLoad({ filter: /^obsidian-stub$/, namespace: 'obsidian-stub' }, () => ({
						loader: 'js',
						contents: 'export function getLanguage() { return \"en\"; }',
					}));
				},
			},
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
							export const TRACEKEEPER_REVIEW_QUEUE_DIR = 'review_queue';
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

	const queueModule = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

	const blocked = queueModule.filterReviewQueueItems([...baseProposals], {
		filter: 'blocked',
		sort: 'attention',
		search: '',
		pageIndex: 0,
		pageSize: 20,
	});
	assert.equal(blocked.totalItems, 1);
	assert.equal(blocked.counts.blocked, 1);
	assert.equal(blocked.items[0].proposalId, 'blocked-project');

	const filteredNeedsCompletion = queueModule.filterReviewQueueItems([...baseProposals], {
		filter: 'needs_completion',
		sort: 'attention',
		search: '',
		pageIndex: 0,
		pageSize: 20,
	});
	assert.equal(filteredNeedsCompletion.totalItems, 1);
	assert.equal(filteredNeedsCompletion.counts.needs_completion, 1);
	assert.equal(filteredNeedsCompletion.items[0].proposalId, 'pending-incomplete');

	const filteredNeedsReview = queueModule.filterReviewQueueItems([...baseProposals], {
		filter: 'needs_review',
		sort: 'attention',
		search: '',
		pageIndex: 0,
		pageSize: 20,
	});
	assert.equal(filteredNeedsReview.totalItems, 1);
	assert.equal(filteredNeedsReview.counts.needs_review, 1);
	assert.equal(filteredNeedsReview.items[0].proposalId, 'pending-complete');

	const unresolvedContexts = {
		[baseProposals[0].path]: {
			target: { exists: false },
		},
	};
	const unresolvedCompletion = queueModule.filterReviewQueueItems([...baseProposals], {
		filter: 'needs_completion',
		sort: 'attention',
		search: '',
		pageIndex: 0,
		pageSize: 20,
	}, unresolvedContexts);
	assert.equal(unresolvedCompletion.totalItems, 2);
	assert.equal(unresolvedCompletion.items.some((item) => item.proposalId === 'pending-complete'), true);
	const unresolvedReview = queueModule.filterReviewQueueItems([...baseProposals], {
		filter: 'needs_review',
		sort: 'attention',
		search: '',
		pageIndex: 0,
		pageSize: 20,
	}, unresolvedContexts);
	assert.equal(unresolvedReview.totalItems, 0);

	const ready = queueModule.filterReviewQueueItems([...baseProposals], {
		filter: 'ready_to_apply',
		sort: 'newest',
		search: '',
		pageIndex: 0,
		pageSize: 20,
	});
	assert.equal(ready.totalItems, 1);
	assert.equal(ready.items[0].proposalId, 'approved-ready');

	const awaiting = queueModule.filterReviewQueueItems([...baseProposals], {
		filter: 'awaiting_revision',
		sort: 'newest',
		search: '',
		pageIndex: 0,
		pageSize: 20,
	});
	awaiting.items.forEach((item) => {
		assert.equal(queueModule.getReviewProposalAttentionFilterMatch(item, 'awaiting_revision'), true);
	});
	assert.equal(awaiting.counts.awaiting_revision, 1);

	const searchAlpha = queueModule.filterReviewQueueItems([...baseProposals], {
		filter: 'needs_review',
		sort: 'newest',
		search: 'project alpha',
		pageIndex: 0,
		pageSize: 20,
	});
	assert.equal(searchAlpha.totalItems, 1);
	assert.equal(searchAlpha.items[0].proposalId, 'pending-complete');

	const riskSort = queueModule.filterReviewQueueItems(riskProposals, {
		filter: 'needs_review',
		sort: 'risk',
		pageIndex: 0,
		pageSize: 20,
	});
	assert.equal(riskSort.items[0].riskLevel, 'high');
	assert.equal(riskSort.items[1].riskLevel, 'medium');
	assert.equal(riskSort.items[2].riskLevel, 'low');

	const pageOne = queueModule.filterReviewQueueItems([...pagedProposals], {
		filter: 'ready_to_apply',
		sort: 'newest',
		search: '',
		pageIndex: 0,
		pageSize: 20,
	});
	assert.equal(pageOne.totalItems, 21);
	assert.equal(pageOne.items.length, 20);
	assert.equal(pageOne.page.hasNext, true);
	assert.equal(pageOne.page.pageIndex, 0);
	assert.equal(pageOne.page.totalPages, 2);
	assert.equal(pageOne.counts.ready_to_apply, 21);

	const pageTwo = queueModule.filterReviewQueueItems([...pagedProposals], {
		filter: 'ready_to_apply',
		sort: 'newest',
		search: '',
		pageIndex: 1,
		pageSize: 20,
	});
	assert.equal(pageTwo.items.length, 1);
	assert.equal(pageTwo.page.hasNext, false);
	assert.equal(pageTwo.page.pageIndex, 1);
	assert.equal(pageTwo.page.hasPrevious, true);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 23 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
