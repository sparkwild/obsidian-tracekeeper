#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callTool } from '../dist/index.js';

const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-read-port-'));
fs.mkdirSync(path.join(vaultRoot, '01_knowledge/wiki'), { recursive: true });
fs.writeFileSync(path.join(vaultRoot, '01_knowledge/wiki/read.md'), '# Read\n\nTargeted body', 'utf8');

const record = {
	schema_version: 2,
	type: 'memory_record',
	path: '01_ai_core/memory/m-1.md',
	memory_id: 'm-1',
	scope: 'global',
	project_id: null,
	agent_type: 'codex',
	operation_id: 'op-1',
	memory_kind: 'decision',
	claim_key: 'runtime:read-port',
	authority: 'source',
	confidence_level: 'supported',
	declared_state: 'active',
	observed_at: '2026-08-06T00:00:00.000Z',
	valid_from: null,
	valid_to: null,
	last_verified_at: null,
	evidence: ['[[03_raw/source]]'],
	supersedes: [],
	contradicts: [],
	project_hub: null,
	global_hub: '[[01_ai_core/longterm_context]]',
	related_wiki: [],
	related_sources: ['[[03_raw/source]]'],
};

const resolved = { record, effective_state: 'current', reasons: [] };

function catalogEntry(path, frontmatter = {}) {
	return {
		path,
		fileVersion: 'v1',
		contentHash: `hash:${path}`,
		frontmatterHash: `frontmatter:${path}`,
		frontmatter,
		title: path.split('/').at(-1).replace(/\.md$/, ''),
		aliases: [],
		type: typeof frontmatter.type === 'string' ? frontmatter.type : null,
		tags: [],
		searchTokens: [],
		excerpt: '',
		modifiedAt: '2026-08-06T00:00:00.000Z',
		size: 1,
	};
}

const view = {
	version: '1.0',
	source: 'index',
	createdAt: '2026-08-06T00:00:00.000Z',
	generation: 7,
	event_sequence: 3,
	index_state: 'ready',
	catalog: new Map([
		['00_tracekeeper/inbox/agent_requests/source.md', catalogEntry(
			'00_tracekeeper/inbox/agent_requests/source.md',
			{ type: 'agent-request', status: 'pending', source: 'paper.pdf', source_kind: 'files' },
		)],
		['00_tracekeeper/inbox/review_queue/pending.md', catalogEntry(
			'00_tracekeeper/inbox/review_queue/pending.md',
			{ type: 'memory_proposal', status: 'pending', proposal_kind: 'memory' },
		)],
		['01_knowledge/wiki/read.md', catalogEntry('01_knowledge/wiki/read.md', { type: 'wiki' })],
	]),
	graph: { outgoing: new Map(), incoming: new Map(), edges: [], unresolvedEdges: [] },
	scopes: { byType: new Map(), byTag: new Map() },
	lexical: { postings: new Map() },
	memory: {
		byId: new Map([['m-1', record]]),
		byClaimKey: new Map([['runtime:read-port', ['m-1']]]),
		invalidPaths: [],
		lifecycle: {
			generation: 7,
			resolved_at: '2026-08-06T00:00:00.000Z',
			records: [resolved],
			legacy: [{
				projection: {
					kind: 'legacy_unkeyed', legacy: true, path: '04_memory/legacy.md',
					scope: 'global', project_id: null, claim_key: null,
				},
				effective_state: 'legacy_unkeyed',
				reasons: ['missing_claim_key'],
			}],
			current: [resolved], history: [], conflicts: [], issues: [],
		},
	},
	last_update: { mode: 'incremental', affectedPaths: [], reason: null },
	warnings: [],
	errors: [],
	contentReader: { generation: 7, read: async () => null },
};

function context(counter) {
	return {
		defaultVaultRoot: vaultRoot,
		credentialCapabilities: ['vault.read', 'memory.review'],
		knowledgeSnapshotProvider: () => {
			throw new Error('memory catalog must not request a full scan');
		},
		knowledgeReadViewProvider: async () => {
			counter.calls += 1;
			return view;
		},
	};
}

test('canonical memory uses one generation-bound read view and current excludes legacy history', async () => {
	const counter = { calls: 0 };
	const result = await callTool('tracekeeper.memory', { scope: 'global', view: 'current' }, context(counter));
	assert.equal(result.isError, false);
	assert.equal(counter.calls, 1);
	assert.equal(result.structuredContent.tool, 'tracekeeper.memory');
	assert.equal(result.structuredContent.generation, 7);
	assert.equal(result.structuredContent.total, 1);
	assert.equal(result.structuredContent.entries[0].memory_id, 'm-1');
	assert.equal(result.structuredContent.entries[0].legacy, false);
});

test('history catalog exposes legacy-unkeyed metadata without note bodies', async () => {
	const counter = { calls: 0 };
	const result = await callTool('tracekeeper.memory', { scope: 'global', view: 'history' }, context(counter));
	assert.equal(result.isError, false);
	assert.equal(counter.calls, 1);
	assert.equal(result.structuredContent.total, 1);
	assert.equal(result.structuredContent.entries[0].effective_state, 'legacy_unkeyed');
	assert.equal(result.structuredContent.entries[0].claim_key, null);
	assert.equal('content' in result.structuredContent.entries[0], false);
});

test('project scope requires an exact project id', async () => {
	const counter = { calls: 0 };
	const result = await callTool('tracekeeper.memory', { scope: 'project' }, context(counter));
	assert.equal(result.isError, true);
	assert.match(result.structuredContent.error, /requires project_id/i);
	assert.equal(counter.calls, 0);
});

test('status, source listing, and review listing use the lightweight read view', async () => {
	for (const [tool, args] of [
		['tracekeeper.status', {}],
		['tracekeeper.graph_health', {}],
		['tracekeeper.lint', {}],
		['tracekeeper.list_source_requests', {}],
		['tracekeeper.review_queue', { action: 'list_pending' }],
	]) {
		const counter = { calls: 0 };
		const result = await callTool(tool, args, context(counter));
		assert.equal(result.isError, false, `${tool} should succeed: ${JSON.stringify(result.structuredContent)}`);
		assert.equal(counter.calls, 1, `${tool} should bind one read view`);
	}
});

test('read_note performs one targeted body read and gets relations from the read view', async () => {
	const counter = { calls: 0 };
	let bodyReads = 0;
	const toolContext = {
		...context(counter),
		vaultRepository: {
			async readText(notePath) {
				if (notePath === '01_knowledge/wiki/read.md') bodyReads += 1;
				return {
					path: notePath,
					content: '# Read\n\nTargeted body',
					version: 'v1',
					contentHash: 'hash',
					modifiedAt: '2026-08-06T00:00:00.000Z',
					size: 20,
				};
			},
		},
	};
	const result = await callTool('tracekeeper.read_note', { path: '01_knowledge/wiki/read.md' }, toolContext);
	assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
	assert.equal(bodyReads, 1);
	assert.equal(counter.calls, 1);
	assert.match(result.structuredContent.content, /Targeted body/);
});
