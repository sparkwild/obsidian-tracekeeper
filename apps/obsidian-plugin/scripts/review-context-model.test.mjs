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

const knowledgeNotes = [
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
	assert.equal(reviewModule.isReviewApprovalTargetPath('01_knowledge/index.md'), true);
	assert.equal(reviewModule.isReviewRemediationTargetPath('01_knowledge/index.md'), false);
	assert.equal(reviewModule.isReviewRemediationTargetPath('01_knowledge/wiki/guides/a.md'), true);
	assert.equal(reviewModule.isReviewRemediationTargetPath('01_knowledge/sources/a.md'), false);
	assert.equal(reviewModule.isReviewRemediationTargetPath('01_knowledge/wiki/../sources/a.md'), false);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 20 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
