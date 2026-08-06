import assert from 'node:assert/strict';
import test from 'node:test';

import { getContractByName, PUBLIC_TOOL_NAME_ORDER } from '@tracekeeper/contracts';

import { validateStructuredContent } from '../dist/result-validation.js';

const SCHEMA_VERSION = 2;

const projectIdentity = {
	project_hint: null,
	project_id: null,
	repo_path: null,
	source: 'unknown',
	confidence: 'uncertain',
	warnings: [],
};

const contextPack = {
	query: 'q',
	generatedAt: '2026-08-03T00:00:00.000Z',
	relevantNotes: [],
	sourceCandidates: [],
	evidenceCandidates: [],
	gaps: [],
	staleWarnings: [],
	suggestedWritebackTargets: [],
	scanErrors: [],
};

function envelope(tool) {
	return { schema_version: SCHEMA_VERSION, ok: true, tool };
}

function failure(tool) {
	return {
		schema_version: SCHEMA_VERSION,
		ok: false,
		tool,
		error: 'request rejected',
		error_detail: {
			code: 'INVALID_REQUEST',
			message: 'request rejected',
			retryable: false,
			recovery_actions: [],
		},
	};
}

function startTaskSuccess() {
	return {
		...envelope('tracekeeper.start_task'),
		read_only: false,
		operation_id: 'op-start',
		idempotency_key: 'idem-start',
		task_id: 'task-start',
		path: 'Tracekeeper/Tasks/task-start.md',
		activity_path: 'Tracekeeper/AgentActivity/2026-08-03.md',
		vault_root: 'vault',
		workflow: { mode: 'tracked_task', state: 'active' },
		recommended_recall: 'tracekeeper.recall',
		next_actions: [],
	};
}

function recallSuccess() {
	return {
		...envelope('tracekeeper.recall'),
		read_only: true,
		vault_root: 'vault',
		recall: {
			recall_id: 'recall-1',
			scope: 'global',
			scope_confidence: 1,
			query: 'q',
			matched_count: 0,
			snapshot_generation: 0,
		},
		matches: [],
		next_actions: [],
	};
}

function memorySuccess() {
	return {
		...envelope('tracekeeper.memory'),
		read_only: true,
		scope: 'global',
		view: 'current',
		project_id: null,
		generation: 0,
		total: 0,
		complete: true,
		sort: 'observed_at_desc_memory_id_path_asc',
		page: { page_size: 50, next_cursor: null },
		entries: [],
	};
}

function finishTaskSuccess() {
	return {
		...envelope('tracekeeper.finish_task'),
		read_only: false,
		operation_id: 'op-finish',
		idempotency_key: 'idem-finish',
		task_id: 'task-finish',
		task_path: 'Tracekeeper/Tasks/task-finish.md',
		path: 'Tracekeeper/Sessions/session-finish.md',
		activity_path: 'Tracekeeper/AgentActivity/2026-08-03.md',
		workflow: { mode: 'tracked_task', state: 'finished' },
		memory: { status: 'no_candidates' },
		memory_closeout_state: 'no_candidates',
		memory_candidate_records: [],
		memory_changes: [],
		proposal_transition_receipts: [],
		next_actions: [],
	};
}

const successFixtures = new Map([
	[
		'tracekeeper.status',
		[
			{
				...envelope('tracekeeper.status'),
				read_only: true,
				vault_root: 'vault',
				scanned_at: '2026-08-03T00:00:00.000Z',
				index_state: 'ready',
				snapshot_generation: 0,
				snapshot_warning: null,
				content_language: 'en',
				content_language_source: 'default',
				counts: {},
				scan_errors: [],
			},
		],
	],
	[
		'tracekeeper.agent_activity_recent',
		[
			{
				...envelope('tracekeeper.agent_activity_recent'),
				read_only: true,
				activity_path: '00_tracekeeper/control/agent_activity/index.md',
				total_sections: 0,
				sections: [],
			},
		],
	],
	[
		'tracekeeper.lint',
		[
			{
				...envelope('tracekeeper.lint'),
				read_only: true,
				profile: 'off',
				graph_profile_disabled: true,
				profile_issues: [],
				vault_root: 'vault',
				scanned_at: '2026-08-03T00:00:00.000Z',
				index_state: 'ready',
				snapshot_generation: 0,
				snapshot_warning: null,
				issue_count: 0,
				issues: [],
				graph_summary: null,
				graph_health: null,
				legacy_structure: {},
				lifecycle_doctor: {
					directory_counts: [],
					legacy_candidates: [],
				},
				fix_plan_summary: [],
			},
		],
	],
	[
		'tracekeeper.recall',
		[recallSuccess()],
	],
	[
		'tracekeeper.memory',
		[memorySuccess()],
	],
	[
		'tracekeeper.read_note',
		[
			{
				...envelope('tracekeeper.read_note'),
				read_only: true,
				vault_root: 'vault',
				path: 'Wiki/Test.md',
				title: 'Test',
				mime_type: 'text/markdown',
				recall_id: null,
				content_origin: 'vault_note',
				instruction_trust: 'data_only',
				content: 'body',
				excerpt: 'body',
				relation_evidence: {},
			},
		],
	],
	[
		'tracekeeper.start_task',
		[startTaskSuccess()],
	],
	[
		'tracekeeper.finish_task',
		[finishTaskSuccess()],
	],
	[
		'tracekeeper.build_context_pack',
		[
			{
				...envelope('tracekeeper.build_context_pack'),
				read_only: true,
				vault_root: 'vault',
				task_id: null,
				project_hint: null,
				project_id: null,
				repo_path: null,
				project_identity: projectIdentity,
				query: 'q',
				index_state: 'ready',
				snapshot_generation: 0,
				snapshot_warning: null,
				context_pack: contextPack,
			},
			{
				...envelope('tracekeeper.build_context_pack'),
				read_only: false,
				vault_root: 'vault',
				task_id: null,
				project_hint: null,
				project_id: null,
				repo_path: null,
				project_identity: projectIdentity,
				query: 'q',
				index_state: 'ready',
				snapshot_generation: 0,
				snapshot_warning: null,
				context_pack: contextPack,
				artifact: { path: 'Tracekeeper/Context/q.md', activity_path: 'Tracekeeper/AgentActivity/2026-08-03.md' },
			},
		],
	],
	[
		'tracekeeper.review_queue',
		[
			{
				...envelope('tracekeeper.review_queue'),
				action: 'list_pending',
				read_only: true,
				vault_root: 'vault',
				count: 0,
				entries: [],
			},
			{
				...envelope('tracekeeper.review_queue'),
				action: 'list_approved',
				read_only: true,
				vault_root: 'vault',
				count: 0,
				entries: [],
			},
		],
	],
	[
		'tracekeeper.apply_approved_writeback',
		[
			{
				...envelope('tracekeeper.apply_approved_writeback'),
				read_only: true,
				dry_run: true,
				permission_level: 'review-gated apply',
				proposal_id: 'proposal-1',
				proposal_path: 'Tracekeeper/Proposals/proposal-1.md',
				target_note: 'Memory/project.md',
				touched_notes: [],
				writeback_preview: 'preview',
				confirmation_token: 'token',
				confirmation_expires_at: '2026-08-03T00:01:00.000Z',
			},
			{
				...envelope('tracekeeper.apply_approved_writeback'),
				read_only: false,
				permission_level: 'review-gated apply',
				status: 'applied',
				operation_id: 'op-apply',
				proposal_id: 'proposal-1',
				proposal_path: 'Tracekeeper/Proposals/proposal-1.md',
				target_note: 'Memory/project.md',
				touched_notes: [],
		activity_path: 'Tracekeeper/AgentActivity/2026-08-03.md',
			},
		],
	],
	[
		'tracekeeper.source_request',
		[
			{
				...envelope('tracekeeper.source_request'),
				action: 'list',
				read_only: true,
				vault_root: 'vault',
				count: 0,
				filter: { status: '', source_kind: '' },
				entries: [],
			},
			{
				...envelope('tracekeeper.source_request'),
				action: 'analyze',
				read_only: false,
				status: 'completed',
				vault_root: 'vault',
				request_path: 'Sources/Requests/request.md',
				mode: 'external_reference',
				source_note: {
					path: '01_knowledge/sources/web/source.md',
					activity_path: 'Tracekeeper/AgentActivity/2026-08-03.md',
					source_kind: 'web',
					source_id: 'source-1234',
					content_hash: `sha256:${'a'.repeat(64)}`,
					route: '01_knowledge/sources/web',
					index_path: '01_knowledge/sources/web/source.md',
					part_manifest: [],
				},
				report: { path: 'Sources/Reports/report.md', activity_path: 'Tracekeeper/AgentActivity/2026-08-03.md' },
				proposals: [],
			activity_path: 'Tracekeeper/AgentActivity/2026-08-03.md',
				summary: 'summary',
				warnings: [],
			},
		],
	],
	[
		'tracekeeper.capture_source',
		[
			{
				...envelope('tracekeeper.capture_source'),
				operation_id: 'op-capture',
				idempotency_key: 'idem-capture',
				status: 'captured',
				path: 'Sources/Notes/source.md',
		activity_path: 'Tracekeeper/AgentActivity/2026-08-03.md',
				warnings: [],
				metadata: {
					source: 'https://example.test/source',
					mode: 'external_reference',
					source_kind: 'web',
					source_id: 'source-123',
					content_hash: `sha256:${'a'.repeat(64)}`,
					route: '01_knowledge/sources/web',
					index_path: '01_knowledge/sources/web/source.md',
					part_manifest: [],
				},
			},
		],
	],
	[
		'tracekeeper.propose_memory',
		[
				{
					...envelope('tracekeeper.propose_memory'),
					operation_id: 'op-propose',
					idempotency_key: 'idem-propose',
				status: 'auto_applied',
				path: 'Memory/global.md',
		activity_path: 'Tracekeeper/AgentActivity/2026-08-03.md',
				warnings: [],
				auto_applied: true,
				duplicate: false,
				memory_rule: 'auto_write',
				memory_scope: 'global',
				project_hint: null,
				related_wiki: [],
				related_sources: [],
					missing_related_sources: [],
					architecture_status: 'healthy',
					missing_graph_bridges: [],
					missing_wiki_bridge: false,
					record_identity: {
						scope: 'project',
						project_id: 'project-1',
						claim_key: 'claim-key-1',
						memory_id: 'memory-1',
					},
					predicted_state: 'current',
					predicted_record: {
						scope: 'project',
						project_id: 'project-1',
						memory_id: 'memory-1',
						memory_kind: 'knowledge',
						claim_key: 'claim-key-1',
						authority: 'agent',
						confidence_level: 'supported',
						declared_state: 'active',
						observed_at: '2026-08-03T00:00:00.000Z',
						valid_from: '2026-08-01T00:00:00.000Z',
						valid_to: null,
						last_verified_at: null,
						evidence: ['source/1.md'],
						supersedes: [],
						contradicts: [],
						related_wiki: [],
						related_sources: [],
						effective_state: 'current',
					},
					proposal_transition_preview: {
						operation_id: 'op-preview-1',
						kind: 'draft',
						previous_status: 'pending',
						next_status: 'approved',
						expected_revision: 'rev-1',
						committed_revision: 'rev-2',
						proposal_id: 'proposal-1',
						proposal_path: 'Tracekeeper/Proposals/proposal-1.md',
					},
					proposal_id: null,
					proposal_path: null,
				},
			{
				...envelope('tracekeeper.propose_memory'),
				operation_id: 'op-propose',
				idempotency_key: 'idem-propose',
				status: 'queued_for_review',
				path: 'Memory/project.md',
		activity_path: 'Tracekeeper/AgentActivity/2026-08-03.md',
				warnings: [],
				auto_applied: false,
				duplicate: false,
				proposal_id: 'proposal-1',
				proposal_path: 'Tracekeeper/Proposals/proposal-1.md',
				proposal_link_target: 'Tracekeeper/Proposals/proposal-1.md',
				memory_rule: 'review_queue',
				memory_scope: 'project',
				project_hint: 'project-1',
				related_wiki: [],
				related_sources: [],
				missing_related_sources: [],
				architecture_status: 'healthy',
				missing_graph_bridges: [],
				missing_wiki_bridge: false,
			},
		],
	],
]);

for (const tool of PUBLIC_TOOL_NAME_ORDER) {
	test(`public success output is accepted: ${tool}`, () => {
		const contract = getContractByName(tool);
		assert.ok(contract, `missing contract for ${tool}`);
		const fixtures = successFixtures.get(tool);
		assert.ok(fixtures?.length, `missing success fixture for ${tool}`);
		for (const fixture of fixtures) {
			const result = validateStructuredContent(fixture, contract.resultSchema);
			assert.equal(result.valid, true, `${tool}: ${result.errors.join('; ')}`);
		}
	});

	test(`public failure output is accepted: ${tool}`, () => {
		const contract = getContractByName(tool);
		assert.ok(contract, `missing contract for ${tool}`);
		const result = validateStructuredContent(failure(tool), contract.resultSchema);
		assert.equal(result.valid, true, `${tool}: ${result.errors.join('; ')}`);
	});
}

test('public success branches reject unknown top-level fields', () => {
	for (const tool of PUBLIC_TOOL_NAME_ORDER) {
		const contract = getContractByName(tool);
		assert.ok(contract);
		for (const fixture of successFixtures.get(tool)) {
			const invalid = { ...fixture, unexpected_top_level: true };
			const result = validateStructuredContent(invalid, contract.resultSchema);
			assert.equal(result.valid, false, `${tool} unexpectedly accepted an unknown top-level field`);
		}
	}
});

test('public failures reject unknown top-level fields and preserve typed details', () => {
	for (const tool of PUBLIC_TOOL_NAME_ORDER) {
		const contract = getContractByName(tool);
		assert.ok(contract);
		const invalid = { ...failure(tool), unexpected_top_level: true };
		const result = validateStructuredContent(invalid, contract.resultSchema);
		assert.equal(result.valid, false, `${tool} unexpectedly accepted an unknown failure field`);
	}
});

test('every public success fixture requires the common schema version', () => {
	for (const tool of PUBLIC_TOOL_NAME_ORDER) {
		const contract = getContractByName(tool);
		assert.ok(contract);
		for (const fixture of successFixtures.get(tool)) {
			const invalid = { ...fixture };
			delete invalid.schema_version;
			const result = validateStructuredContent(invalid, contract.resultSchema);
			assert.equal(result.valid, false, `${tool} accepted a success result without schema_version`);
		}
	}
});
