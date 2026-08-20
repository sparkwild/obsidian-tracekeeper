#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { SourceRequestApplicationService } from '../dist/application/source-request.js';

test('SourceRequestApplicationService owns analysis, generated notes, and task references', async () => {
	const writes = [];
	const statuses = [];
	const audits = [];
	const taskUpdates = [];
	const managedReferences = [];
	const service = new SourceRequestApplicationService({
		readRequest: async () => ({
			type: 'agent-request',
			path: '00_tracekeeper/inbox/agent_requests/direct-request.md',
			source: 'direct-source',
			sourceKind: 'selection',
			purpose: 'verify direct application ownership',
			relatedProject: 'tracekeeper',
			analysisMode: 'default',
			status: 'pending',
			taskId: 'direct-task',
			created: '2026-08-03T00:00:00.000Z',
			content: '# Selected Text\n\nA source sentence with evidence and a claim.',
			filename: '00_tracekeeper/inbox/agent_requests/direct-request.md',
		}),
		readSourceText: async () => null,
		writeNote: async (input) => {
			writes.push(input);
			const pathByKind = {
				source: `01_knowledge/sources/web/${input.filename}.md`,
				source_part: `01_knowledge/sources/web/${input.filename}.md`,
				report: '00_tracekeeper/work/source-analysis/direct-report.md',
				proposal: `00_tracekeeper/review_queue/direct-proposal-${writes.length}.md`,
			};
			return {
				path: pathByKind[input.kind],
				activity_path: '00_tracekeeper/control/agent_activity/2026/2026-08-03.md',
				status: 'written',
				warnings: [],
			};
		},
		updateRequestStatus: async (requestPath, status) => {
			statuses.push({ requestPath, status });
			return { path: requestPath };
		},
		appendAudit: async (input) => {
			audits.push(input);
			return { path: '00_tracekeeper/audit/events.jsonl' };
		},
		updateTaskRecord: async (taskId, notePaths, proposals) => {
			taskUpdates.push({ taskId, notePaths, proposals });
			return `00_tracekeeper/work/tasks/${taskId}.md`;
		},
		updateManagedProposalReferences: async (recordPath, proposals) => {
			managedReferences.push({ recordPath, proposals });
		},
		assertSafeText: () => undefined,
		renderText: (_zh, en) => en,
		contentLanguage: 'en',
		now: () => '2026-08-03T00:00:00.000Z',
		buildFilename: (rawFilename) => rawFilename,
		proposalDirectory: '00_tracekeeper/review_queue',
		renderMarkdownLink: (targetPath) => `[source](${targetPath})`,
	});

	const result = await service.execute({
		requestPath: '00_tracekeeper/inbox/agent_requests/direct-request.md',
		taskId: null,
		updateRequestStatus: true,
		forceReprocess: false,
		toolName: 'tracekeeper.source_request',
	});

	assert.equal(result.ok, true);
	assert.equal(result.read_only, false);
	assert.equal(result.tool, 'tracekeeper.source_request');
	assert.equal(result.status, 'completed');
	assert.equal(result.request_path, '00_tracekeeper/inbox/agent_requests/direct-request.md');
	assert.equal(writes[0].kind, 'source');
	assert.equal(writes[0].directory, '01_knowledge/sources/web');
	assert.equal(writes[0].frontmatter.type, 'source_capture');
	assert.equal(writes[0].frontmatter.source_kind, 'web');
	assert.match(writes[0].frontmatter.source_id, /^source-[a-f0-9]{32}$/);
	assert.match(writes[0].frontmatter.content_hash, /^sha256:[a-f0-9]{64}$/);
	assert.equal(writes[1].kind, 'report');
	assert.ok(writes.some((write) => write.kind === 'proposal'));
	const proposal = writes.find((write) => write.kind === 'proposal');
	assert.match(proposal.frontmatter.claim_key, /^source:source-[a-f0-9]{32}:/);
	assert.equal(proposal.frontmatter.proposed_authority, 'source');
	assert.equal(proposal.frontmatter.proposed_confidence, 'supported');
	assert.equal(proposal.frontmatter.project_hint, 'tracekeeper');
	assert.equal(proposal.frontmatter.project_id, undefined);
	assert.equal(proposal.frontmatter.observed_at, '2026-08-03T00:00:00.000Z');
	assert.deepEqual(proposal.frontmatter.evidence, [writes[0].directory + '/' + writes[0].filename + '.md']);
	assert.deepEqual(proposal.frontmatter.related_sources, proposal.frontmatter.evidence);
	assert.match(proposal.body, /- source: \[source\]\(/);
	assert.match(
		proposal.body,
		new RegExp(`tracekeeper:writeback:start proposal_id="${proposal.frontmatter.proposal_id}"`)
	);
	assert.match(
		proposal.body,
		new RegExp(`tracekeeper:writeback:end proposal_id="${proposal.frontmatter.proposal_id}"`)
	);
	assert.deepEqual(statuses, [{
		requestPath: '00_tracekeeper/inbox/agent_requests/direct-request.md',
		status: 'completed',
	}]);
	assert.equal(audits.length, 1);
	assert.equal(audits[0].metadata.action, 'source.request.completed');
	assert.equal(taskUpdates.length, 1);
	assert.deepEqual(taskUpdates[0].notePaths, [
		`01_knowledge/sources/web/${writes[0].filename}.md`,
		'00_tracekeeper/work/source-analysis/direct-report.md',
	]);
	assert.equal(managedReferences.length, 1);
	assert.equal(managedReferences[0].recordPath, '00_tracekeeper/work/tasks/direct-task.md');
});

test('SourceRequestApplicationService routes and splits a large transcript under one typed source owner', async () => {
	const writes = [];
	const selectedText = '证据段落。'.repeat(30_000);
	const service = new SourceRequestApplicationService({
		readRequest: async () => ({
			type: 'agent-request',
			path: '00_tracekeeper/inbox/agent_requests/transcript-request.md',
			source: 'meeting-2026-08-03',
			sourceKind: 'transcript',
			purpose: 'analyze a bounded transcript',
			relatedProject: '',
			analysisMode: 'default',
			status: 'pending',
			taskId: '',
			created: '2026-08-03T00:00:00.000Z',
			content: `## Selected Text\n\n> ${selectedText}`,
			filename: '00_tracekeeper/inbox/agent_requests/transcript-request.md',
		}),
		readSourceText: async () => null,
		writeNote: async (input) => {
			writes.push(input);
			return {
				path: `${input.directory || 'generated'}/${input.filename}.md`,
				activity_path: '00_tracekeeper/control/agent_activity/2026/2026-08-03.md',
				status: 'written',
				warnings: [],
			};
		},
		updateRequestStatus: async (requestPath) => ({ path: requestPath }),
		appendAudit: async () => ({ path: '00_tracekeeper/audit/events.jsonl' }),
		updateTaskRecord: async () => null,
		updateManagedProposalReferences: async () => undefined,
		assertSafeText: () => undefined,
		renderText: (_zh, en) => en,
		contentLanguage: 'en',
		now: () => '2026-08-03T00:00:00.000Z',
		buildFilename: (rawFilename) => rawFilename,
		proposalDirectory: '00_tracekeeper/review_queue',
		renderMarkdownLink: (targetPath) => `[[${targetPath.replace(/\.md$/, '')}]]`,
	});

	const result = await service.execute({
		requestPath: '00_tracekeeper/inbox/agent_requests/transcript-request.md',
		taskId: null,
		updateRequestStatus: false,
		forceReprocess: false,
		toolName: 'tracekeeper.source_request',
	});

	const sourceParts = writes.filter((write) => write.kind === 'source_part');
	const sourceIndex = writes.find((write) => write.kind === 'source');
	assert.ok(sourceParts.length > 1);
	assert.ok(sourceIndex);
	assert.equal(sourceIndex.directory, '01_knowledge/sources/transcripts');
	assert.equal(sourceIndex.frontmatter.source_kind, 'transcript');
	assert.deepEqual(sourceIndex.frontmatter.part_manifest, result.source_note.part_manifest);
	assert.equal(result.source_note.source_kind, 'transcript');
	assert.equal(result.source_note.route, '01_knowledge/sources/transcripts');
	assert.equal(result.source_note.index_path, result.source_note.path);
	assert.equal(result.source_note.part_manifest.length, sourceParts.length);
	assert.ok(sourceParts.every((part) => part.frontmatter.source_id === sourceIndex.frontmatter.source_id));
	assert.ok(sourceParts.every((part) => part.frontmatter.parent_source === result.source_note.path));
	assert.ok(sourceParts.every((part) => part.directory.endsWith(`${sourceIndex.filename}.parts`)));
	assert.match(sourceIndex.body, /## Source content/);
	for (const partPath of result.source_note.part_manifest) {
		assert.ok(sourceIndex.body.includes(partPath.replace(/\.md$/, '')));
	}
});
