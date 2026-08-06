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
				source: '01_knowledge/sources/direct-source.md',
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
	assert.equal(writes[1].kind, 'report');
	assert.ok(writes.some((write) => write.kind === 'proposal'));
	assert.deepEqual(statuses, [{
		requestPath: '00_tracekeeper/inbox/agent_requests/direct-request.md',
		status: 'completed',
	}]);
	assert.equal(audits.length, 1);
	assert.equal(audits[0].metadata.action, 'source.request.completed');
	assert.equal(taskUpdates.length, 1);
	assert.deepEqual(taskUpdates[0].notePaths, [
		'01_knowledge/sources/direct-source.md',
		'00_tracekeeper/work/source-analysis/direct-report.md',
	]);
	assert.equal(managedReferences.length, 1);
	assert.equal(managedReferences[0].recordPath, '00_tracekeeper/work/tasks/direct-task.md');
});
