#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-review-context-model-test-'));
const output = path.join(tempRoot, 'review-context-model.test.mjs');

const proposal = {
	path: '00_tracekeeper/inbox/review_queue/proposal.md',
	classification: 'memory_proposal',
	proposalId: 'proposal-42',
	proposalKind: 'project_decision',
	proposedBy: 'agent',
	relatedProject: 'Tracekeeper',
	memoryScope: 'project',
	projectId: 'tracekeeper-id',
	claimKey: '',
	taskId: 'task-42',
	sourceSessionNote: '00_tracekeeper/work/sessions/task-42.md',
	targetNote: '',
	evidence: ['01_knowledge/sources/web/source.md'],
	relatedSources: ['01_knowledge/sources/web/source.md'],
	rationale: 'Preserve the accepted project decision.',
	riskLevel: 'low',
	approvalStatus: 'pending',
	created: '2026-07-28T00:00:00Z',
	snippet: 'Project decision',
	sortTimestamp: 1,
	revisionComment: '',
	revisionRequestedAt: '',
	revisionRequestedBy: '',
	writebackContent: '- Keep approval and apply separate.',
};
const existingWikiCreateConflictPath = '01_knowledge/wiki/guide-for-existing-target.md';

const knowledgeNotes = [
	{
		path: '01_knowledge/memory/projects/tracekeeper/agents/codex/prior.md',
		title: 'Prior memory',
		excerpt: 'Prior lifecycle record.',
		frontmatter: {
			type: 'memory_record',
			memory_id: 'memory-prior',
			project_id: 'tracekeeper-id',
			claim_key: 'project:review-lifecycle',
			authority: 'agent',
			confidence_level: 'supported',
			declared_state: 'active',
			observed_at: '2026-08-01T00:00:00.000Z',
		},
	},
	{
		path: '01_knowledge/memory/projects/tracekeeper/memory.md',
		title: 'Tracekeeper memory',
		excerpt: '# Tracekeeper memory\n\nCurrent project context.',
		frontmatter: { project: 'Tracekeeper', type: 'project-memory' },
	},
	{
		path: '01_knowledge/memory/global/preferences.md',
		title: 'Preferences',
		excerpt: '# Preferences',
		frontmatter: { type: 'global-memory' },
	},
	{
		path: '01_knowledge/wiki/guides/tracekeeper.md',
		title: 'Tracekeeper guide',
		excerpt: '# Tracekeeper guide\n\nDurable project guide.',
		frontmatter: { project: 'Tracekeeper', type: 'guide' },
	},
	{
		path: '01_knowledge/sources/web/source.md',
		title: 'Source evidence',
		excerpt: '# Source\n\nCaptured evidence.',
		frontmatter: { source: 'https://example.com', source_kind: 'web' },
	},
	{
		path: '00_tracekeeper/work/tasks/task-42.md',
		title: 'Task record',
		excerpt: 'Task details',
		frontmatter: { task_id: 'task-42' },
	},
];

const tasks = [
	{
		path: '00_tracekeeper/work/tasks/task-42.md',
		type: 'agent-task',
		taskId: 'task-42',
		agent: 'codex',
		objective: 'Improve proposal review',
		status: 'completed',
		startedAt: '',
		finishedAt: '',
		contextPack: '',
		sessionNote: '00_tracekeeper/work/sessions/task-42.md',
		relatedProject: 'Tracekeeper',
		memoryReads: [],
		memoryWrites: [],
		sourceCaptures: ['01_knowledge/sources/web/source.md'],
		proposals: [proposal.path],
		memoryCandidates: [],
		snippet: 'Implemented the review completion flow.',
		sortTimestamp: 1,
	},
];

try {
	await build({
		entryPoints: [path.resolve('src/features/review/review-context-model.ts')],
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
							export const KNOWLEDGE_GLOBAL_MEMORY_DIR = '01_knowledge/memory/global';
							export const KNOWLEDGE_PROJECTS_MEMORY_DIR = '01_knowledge/memory/projects';
							export const KNOWLEDGE_SOURCES_DIR = '01_knowledge/sources';
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
	const candidates = reviewModule.buildReviewTargetCandidates(proposal, knowledgeNotes);
	assert.equal(candidates.length, 3);
	assert.equal(candidates[0].path, '01_knowledge/memory/projects/tracekeeper/memory.md');
	assert.equal(candidates[0].reason, 'project_match');
	assert.equal(candidates.some((candidate) => candidate.path.includes('/sources/')), false);
	assert.equal(candidates.some((candidate) => candidate.path.startsWith('00_tracekeeper/')), false);

	const contexts = reviewModule.buildReviewProposalContexts({
		proposals: [proposal],
		knowledge: { state: 'ready', notes: knowledgeNotes },
		tasks,
		existingTargetPaths: new Set(),
	});
	const context = contexts[proposal.path];
	assert.ok(context);
	assert.equal(context.validity.isComplete, false);
	assert.equal(context.validity.missingTargetNote, true);
	assert.equal(context.task?.objective, 'Improve proposal review');
	assert.equal(context.sources.length, 1);
	assert.equal(context.sources[0].sourceKind, 'web');
	assert.match(context.diffPreview, /after explicit apply/);
	assert.match(context.diffPreview, /\+## Approved Writeback: proposal-42/);

	const wikiCreateProposal = {
		...proposal,
		path: 'review_queue/wiki-create-preview.md',
		proposalId: 'wiki-create-preview',
		targetNote: '01_knowledge/wiki/create-preview.md',
		writebackContent: '- create new wiki note',
		writebackEffect: undefined,
	};
	const wikiCreateContexts = reviewModule.buildReviewProposalContexts({
		proposals: [wikiCreateProposal],
		knowledge: { state: 'ready', notes: knowledgeNotes },
		tasks,
		existingTargetPaths: new Set(),
	});
	assert.equal(wikiCreateContexts[wikiCreateProposal.path].validity.isComplete, true);
	assert.equal(wikiCreateContexts[wikiCreateProposal.path].target.exists, false);
	assert.match(wikiCreateContexts[wikiCreateProposal.path].diffPreview, /--- \/dev\/null/);
	assert.match(wikiCreateContexts[wikiCreateProposal.path].diffPreview, /\+\+\+ 01_knowledge\/wiki\/create-preview\.md/);
	assert.match(wikiCreateContexts[wikiCreateProposal.path].diffPreview, /\^writeback-wiki-create-preview/);
	assert.match(wikiCreateContexts[wikiCreateProposal.path].diffPreview, /\+\- create new wiki note/);
	assert.doesNotMatch(wikiCreateContexts[wikiCreateProposal.path].diffPreview, /\+## Approved Writeback:/);

	const wikiCreateMultilineProposal = {
		...proposal,
		path: 'review_queue/wiki-create-multiline.md',
		proposalId: 'wiki-create-multiline',
		targetNote: '01_knowledge/wiki/create-multiline.md',
		writebackContent: '- line 1\n- line 2\nline 3',
		writebackEffect: undefined,
	};
	const wikiCreateMultilineContexts = reviewModule.buildReviewProposalContexts({
		proposals: [wikiCreateMultilineProposal],
		knowledge: { state: 'ready', notes: knowledgeNotes },
		tasks,
		existingTargetPaths: new Set(),
	});
	const multilineDiff = wikiCreateMultilineContexts[wikiCreateMultilineProposal.path].diffPreview;
	assert.match(multilineDiff, /--- \/dev\/null/);
	assert.match(multilineDiff, /\+\+\+ 01_knowledge\/wiki\/create-multiline\.md/);
	const expectedMultilineDiffLines = [
		'--- /dev/null',
		'+++ 01_knowledge/wiki/create-multiline.md',
		'+- line 1',
		'+- line 2',
		'+line 3',
		'+',
		'+^writeback-wiki-create-multiline',
	];
	assert.deepStrictEqual(multilineDiff.split('\n'), expectedMultilineDiffLines);

	const wikiCreateConflictProposal = {
		...proposal,
		path: 'review_queue/wiki-create-conflict.md',
		proposalId: 'wiki-create-conflict',
		targetNote: existingWikiCreateConflictPath,
		writebackContent: '- conflicting create',
		writebackEffect: 'create_wiki_note',
	};
	const occupiedCreateContext = reviewModule.buildReviewProposalContexts({
		proposals: [wikiCreateConflictProposal],
		knowledge: { state: 'ready', notes: knowledgeNotes },
		tasks,
		existingTargetPaths: new Set([existingWikiCreateConflictPath]),
	});
	const conflictDiff = occupiedCreateContext[wikiCreateConflictProposal.path].diffPreview;
	assert.equal(occupiedCreateContext[wikiCreateConflictProposal.path].validity.isComplete, false);
	assert.equal(occupiedCreateContext[wikiCreateConflictProposal.path].validity.missingTargetEvidence, false);
	assert.match(conflictDiff, /\[Blocked\] target already exists for create_wiki_note/);
	assert.doesNotMatch(conflictDiff, /\+\+\+ [\s\S]*create-preview\.md/);
	assert.doesNotMatch(conflictDiff, /\+conflicting create/);

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
	const appliedCreateProposal = {
		...wikiCreateConflictProposal,
		path: appliedCreateReceipt.proposalPath,
		proposalId: appliedCreateReceipt.proposalId,
		approvalStatus: 'applied',
		writebackOperationId: appliedCreateReceipt.operationId,
		writebackAppliedAt: appliedCreateReceipt.committedAt,
		writebackTarget: existingWikiCreateConflictPath,
		contentHash: appliedCreateReceipt.committedContentHash,
		revision: appliedCreateReceipt.committedRevision,
		lastTransition: appliedCreateReceipt,
	};
	const appliedCreateContexts = reviewModule.buildReviewProposalContexts({
		proposals: [appliedCreateProposal],
		knowledge: { state: 'ready', notes: knowledgeNotes },
		tasks,
		existingTargetPaths: new Set([existingWikiCreateConflictPath]),
	});
	const appliedCreateDiff = appliedCreateContexts[appliedCreateProposal.path].diffPreview;
	assert.match(appliedCreateDiff, /\[Applied\] Wiki note created/);
	assert.match(appliedCreateDiff, /Historical writeback effect: create_wiki_note/);
	assert.match(appliedCreateDiff, /Operation ID: apply-create-wiki/);
	assert.doesNotMatch(appliedCreateDiff, /\[Blocked\]/);
	const driftedAppliedTargetProposal = {
		...appliedCreateProposal,
		path: 'review_queue/drifted-applied-target.md',
		proposalId: 'drifted-applied-target',
		targetNote: '01_knowledge/wiki/target-not-matching-historical-target.md',
		contentHash: appliedCreateReceipt.committedContentHash,
	};
	const driftedAppliedTargetContexts = reviewModule.buildReviewProposalContexts({
		proposals: [driftedAppliedTargetProposal],
		knowledge: { state: 'ready', notes: knowledgeNotes },
		tasks,
		existingTargetPaths: new Set([existingWikiCreateConflictPath]),
	});
	const driftedAppliedTargetDiff = driftedAppliedTargetContexts[driftedAppliedTargetProposal.path].diffPreview;
	assert.match(driftedAppliedTargetDiff, /Target path: 01_knowledge\/wiki\/guide-for-existing-target\.md/);
	assert.doesNotMatch(driftedAppliedTargetDiff, /Target path: 01_knowledge\/wiki\/target-not-matching-historical-target\.md/);
	const missingWritebackTargetProposal = {
		...appliedCreateProposal,
		path: 'review_queue/missing-writeback-target.md',
		proposalId: 'missing-writeback-target',
		targetNote: '01_knowledge/wiki/missing-writeback-target.md',
		writebackTarget: '',
		contentHash: appliedCreateReceipt.committedContentHash,
	};
	const missingWritebackTargetContexts = reviewModule.buildReviewProposalContexts({
		proposals: [missingWritebackTargetProposal],
		knowledge: { state: 'ready', notes: knowledgeNotes },
		tasks,
		existingTargetPaths: new Set([existingWikiCreateConflictPath]),
	});
	const missingWritebackTargetDiff = missingWritebackTargetContexts[missingWritebackTargetProposal.path].diffPreview;
	assert.match(missingWritebackTargetDiff, /Target path: \(not recorded\)/);
	const invalidWritebackTargetProposal = {
		...appliedCreateProposal,
		path: 'review_queue/invalid-writeback-target.md',
		proposalId: 'invalid-writeback-target',
		targetNote: '01_knowledge/wiki/invalid-writeback-target.md',
		writebackTarget: 'unknown',
		invalidWritebackTarget: true,
		contentHash: appliedCreateReceipt.committedContentHash,
	};
	const invalidWritebackTargetContexts = reviewModule.buildReviewProposalContexts({
		proposals: [invalidWritebackTargetProposal],
		knowledge: { state: 'ready', notes: knowledgeNotes },
		tasks,
		existingTargetPaths: new Set([existingWikiCreateConflictPath]),
	});
	const invalidWritebackTargetDiff = invalidWritebackTargetContexts[invalidWritebackTargetProposal.path].diffPreview;
	assert.match(invalidWritebackTargetDiff, /Target path: \(not recorded\)/);

	const driftedAppliedProposal = {
		...appliedCreateProposal,
		contentHash: 'drifted-after-apply',
	};
	const driftedAppliedContexts = reviewModule.buildReviewProposalContexts({
		proposals: [driftedAppliedProposal],
		knowledge: { state: 'ready', notes: knowledgeNotes },
		tasks,
		existingTargetPaths: new Set([existingWikiCreateConflictPath]),
	});
	const driftedAppliedDiff = driftedAppliedContexts[driftedAppliedProposal.path].diffPreview;
	assert.match(driftedAppliedDiff, /Historical writeback effect: unknown/);
	assert.match(driftedAppliedDiff, /receipt: unavailable or no longer matches/);
	assert.doesNotMatch(driftedAppliedDiff, /Wiki note created|create_wiki_note/);
	assert.doesNotMatch(driftedAppliedDiff, /\[Blocked\]/);

	const legacyAppliedProposal = {
		...appliedCreateProposal,
		path: 'review_queue/legacy-applied.md',
		proposalId: 'legacy-applied',
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
	};
	const legacyAppliedContexts = reviewModule.buildReviewProposalContexts({
		proposals: [legacyAppliedProposal],
		knowledge: { state: 'ready', notes: knowledgeNotes },
		tasks,
		existingTargetPaths: new Set([existingWikiCreateConflictPath]),
	});
	const legacyAppliedDiff = legacyAppliedContexts[legacyAppliedProposal.path].diffPreview;
	assert.match(legacyAppliedDiff, /\[Applied\] Writeback completed/);
	assert.match(legacyAppliedDiff, /Historical writeback effect: unknown/);
	assert.match(legacyAppliedDiff, /No append or create effect is inferred/);
	assert.doesNotMatch(legacyAppliedDiff, /Expected append diff|\[Blocked\]/);

	const readyCreateProposal = {
		...wikiCreateProposal,
		path: 'review_queue/wiki-create-preview-ready.md',
		approvalStatus: 'approved',
	};
	const activeCreateContexts = reviewModule.buildReviewProposalContexts({
		proposals: [wikiCreateProposal, readyCreateProposal],
		knowledge: { state: 'ready', notes: knowledgeNotes },
		tasks,
		existingTargetPaths: new Set(),
	});
	for (const activeProposal of [wikiCreateProposal, readyCreateProposal]) {
		const activeDiff = activeCreateContexts[activeProposal.path].diffPreview;
		assert.match(activeDiff, /--- \/dev\/null/);
		assert.match(activeDiff, /\+\+\+ 01_knowledge\/wiki\/create-preview\.md/);
		assert.doesNotMatch(activeDiff, /\[Applied\]/);
	}

	const completedProposal = {
		...proposal,
		targetNote: '01_knowledge/memory/projects/tracekeeper/memory.md',
	};
	const completedContexts = reviewModule.buildReviewProposalContexts({
		proposals: [completedProposal],
		knowledge: { state: 'ready', notes: knowledgeNotes },
		tasks,
		existingTargetPaths: new Set([completedProposal.targetNote]),
	});
	assert.equal(completedContexts[proposal.path].validity.isComplete, true);
	assert.equal(completedContexts[proposal.path].target.exists, true);
	assert.match(completedContexts[proposal.path].diffPreview, /Current project context/);
	const lifecycleProposal = {
		...proposal,
		projectId: 'tracekeeper-id',
		claimKey: 'project:review-lifecycle',
		targetNote: '01_knowledge/memory/projects/tracekeeper/agents/codex/approved.md',
	};
	const lifecycleContexts = reviewModule.buildReviewProposalContexts({
		proposals: [lifecycleProposal],
		knowledge: { state: 'ready', notes: knowledgeNotes },
		tasks,
		existingTargetPaths: new Set(),
	});
	assert.equal(lifecycleContexts[proposal.path].validity.isComplete, true);
	assert.equal(lifecycleContexts[proposal.path].priorMemory.length, 1);
	assert.equal(lifecycleContexts[proposal.path].priorMemory[0].memoryId, 'memory-prior');
	assert.equal(reviewModule.isReviewApprovalTargetPath('01_knowledge/index.md'), true);
	assert.equal(reviewModule.isReviewRemediationTargetPath('01_knowledge/index.md'), false);
	assert.equal(reviewModule.isReviewRemediationTargetPath('01_knowledge/wiki/guides/a.md'), true);
	assert.equal(reviewModule.isReviewRemediationTargetPath('01_knowledge/sources/a.md'), false);
	assert.equal(reviewModule.isReviewRemediationTargetPath('01_knowledge/wiki/../sources/a.md'), false);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 40 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
