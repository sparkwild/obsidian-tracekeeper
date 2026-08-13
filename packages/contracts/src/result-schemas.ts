import { AGENT_ACTION_SCHEMA } from './action-envelope';

export type JsonSchema2020 = {
	readonly [key: string]: unknown;
	readonly type: 'object';
};

export const SCHEMA_VERSION = 2 as const;

export const COMMON_TOOL_SUCCESS_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	required: ['schema_version', 'ok', 'tool'],
	properties: {
		schema_version: { const: SCHEMA_VERSION, type: 'integer' },
		ok: { const: true, type: 'boolean' },
		tool: { type: 'string', minLength: 1 },
	},
	description: 'Common successful MCP envelope for Tracekeeper tools.',
	additionalProperties: true,
};

export const COMMON_TOOL_FAILURE_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	required: ['schema_version', 'ok', 'tool', 'error', 'error_detail'],
	properties: {
		schema_version: { const: SCHEMA_VERSION, type: 'integer' },
		ok: { const: false, type: 'boolean' },
		tool: { type: 'string', minLength: 1 },
		error: { type: 'string' },
		error_detail: {
			type: 'object',
			additionalProperties: true,
		},
	},
	description: 'Runtime failure envelope; legacy callers rely on a stable field set.',
	additionalProperties: true,
};

const PROJECT_IDENTITY_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	required: ['project_hint', 'project_id', 'repo_path', 'source', 'confidence', 'warnings'],
	properties: {
		project_hint: { oneOf: [{ type: 'string' }, { type: 'null' }] },
		project_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
		repo_path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
		source: {
			type: 'string',
			enum: [
				'explicit_project_id',
				'explicit_project_hint',
				'vault_match',
				'repo_leaf',
				'task_metadata',
				'unknown',
			],
		},
		confidence: { type: 'string', enum: ['exact', 'derived', 'uncertain'] },
		warnings: { type: 'array', items: { type: 'string' } },
	},
	additionalProperties: false,
};

const MEMORY_RECORD_SCOPE_SCHEMA = {
	type: 'string',
	enum: ['global', 'project'],
};
const MEMORY_RECORD_AUTHORITY_SCHEMA = {
	type: 'string',
	enum: ['agent', 'source', 'user'],
};
const MEMORY_RECORD_CONFIDENCE_SCHEMA = {
	type: 'string',
	enum: ['uncertain', 'inferred', 'supported', 'verified'],
};
const MEMORY_RECORD_DECLARED_STATE_SCHEMA = {
	type: 'string',
	enum: ['active', 'disputed', 'retracted', 'review'],
};
const MEMORY_RECORD_EFFECTIVE_STATE_SCHEMA = {
	type: 'string',
	enum: ['current', 'superseded', 'disputed', 'retracted', 'review', 'legacy_unkeyed'],
};
const NULLABLE_STRING_ARRAY_SCHEMA = {
	oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
};

const MEMORY_RECORD_IDENTITY_SCHEMA = {
	type: 'object',
	required: ['scope', 'claim_key'],
	properties: {
		scope: MEMORY_RECORD_SCOPE_SCHEMA,
		project_id: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		claim_key: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		memory_id: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
	},
	additionalProperties: false,
};

const PROPOSED_MEMORY_RECORD_SCHEMA = {
	type: 'object',
	required: ['scope', 'claim_key', 'authority', 'confidence_level', 'declared_state', 'observed_at'],
	properties: {
		scope: MEMORY_RECORD_SCOPE_SCHEMA,
		project_id: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		memory_id: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		memory_kind: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		claim_key: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		authority: { oneOf: [MEMORY_RECORD_AUTHORITY_SCHEMA, { type: 'null' }] },
		confidence_level: { oneOf: [MEMORY_RECORD_CONFIDENCE_SCHEMA, { type: 'null' }] },
		declared_state: { oneOf: [MEMORY_RECORD_DECLARED_STATE_SCHEMA, { type: 'null' }] },
		observed_at: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		valid_from: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		valid_to: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		last_verified_at: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		evidence: NULLABLE_STRING_ARRAY_SCHEMA,
		supersedes: NULLABLE_STRING_ARRAY_SCHEMA,
		contradicts: NULLABLE_STRING_ARRAY_SCHEMA,
		related_wiki: NULLABLE_STRING_ARRAY_SCHEMA,
		related_sources: NULLABLE_STRING_ARRAY_SCHEMA,
		effective_state: { oneOf: [MEMORY_RECORD_EFFECTIVE_STATE_SCHEMA, { type: 'null' }] },
	},
	additionalProperties: false,
};

const PROPOSAL_TRANSITION_PREVIEW_SCHEMA = {
	type: 'object',
	properties: {
		operation_id: { type: 'string', minLength: 1 },
		kind: { type: 'string' },
		previous_status: { type: 'string' },
		next_status: { type: 'string' },
		expected_revision: { type: 'string', minLength: 1 },
		committed_revision: { type: 'string', minLength: 1 },
		proposal_path: { type: 'string', minLength: 1 },
		proposal_id: { type: 'string', minLength: 1 },
	},
	additionalProperties: true,
};

const FINISH_TASK_CLAIM_RECORD_SCHEMA = {
	type: 'object',
	required: ['content', 'scope'],
	properties: {
		proposal_kind: { type: 'string' },
		content: { type: 'string', minLength: 1 },
		scope: { type: 'string', enum: ['global', 'project'] },
		project_hint: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		project_id: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		repo_path: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		related_wiki: { type: 'array', items: { type: 'string' } },
		related_sources: { type: 'array', items: { type: 'string' } },
		evidence: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }, { type: 'null' }] },
		target_note: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		claim_key: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		proposed_authority: { oneOf: [MEMORY_RECORD_AUTHORITY_SCHEMA, { type: 'null' }] },
		proposed_confidence: { oneOf: [MEMORY_RECORD_CONFIDENCE_SCHEMA, { type: 'null' }] },
		declared_state: { oneOf: [MEMORY_RECORD_DECLARED_STATE_SCHEMA, { type: 'null' }] },
		observed_at: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		valid_from: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		valid_to: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		last_verified_at: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		supersedes: { type: 'array', items: { type: 'string' } },
		contradicts: { type: 'array', items: { type: 'string' } },
		authority: { oneOf: [MEMORY_RECORD_AUTHORITY_SCHEMA, { type: 'null' }] },
		confidence_level: { oneOf: [MEMORY_RECORD_CONFIDENCE_SCHEMA, { type: 'null' }] },
		effective_state: { oneOf: [MEMORY_RECORD_EFFECTIVE_STATE_SCHEMA, { type: 'null' }] },
	},
	additionalProperties: false,
};

const FINISH_TASK_MEMORY_CHANGE_SCHEMA = {
	type: 'object',
	required: ['source', 'change_kind'],
	properties: {
		source: { type: 'string', minLength: 1 },
		change_kind: { type: 'string' },
		candidate_index: { type: 'integer', minimum: 0 },
		scope: { type: 'string', enum: ['global', 'project'] },
		reason: { type: 'string' },
		proposal_id: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		record_identity: MEMORY_RECORD_IDENTITY_SCHEMA,
		previous_effective_state: { oneOf: [MEMORY_RECORD_EFFECTIVE_STATE_SCHEMA, { type: 'null' }] },
		next_effective_state: { oneOf: [MEMORY_RECORD_EFFECTIVE_STATE_SCHEMA, { type: 'null' }] },
		proposal_transition: PROPOSAL_TRANSITION_PREVIEW_SCHEMA,
	},
	additionalProperties: false,
};

export const START_TASK_SUCCESS_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	required: [
		'schema_version',
		'ok',
		'tool',
		'read_only',
		'operation_id',
		'idempotency_key',
		'task_id',
		'path',
		'activity_path',
		'vault_root',
		'workflow',
		'recommended_recall',
		'next_actions',
	],
	properties: {
		schema_version: { const: SCHEMA_VERSION, type: 'integer' },
		ok: { const: true, type: 'boolean' },
		tool: { const: 'tracekeeper.start_task', type: 'string' },
		read_only: { const: false, type: 'boolean' },
		operation_id: { type: 'string', minLength: 1 },
		idempotency_key: { type: 'string', minLength: 1 },
		task_id: { type: 'string', minLength: 1 },
		path: { type: 'string', minLength: 1 },
		activity_path: { type: 'string', minLength: 1 },
		client: { oneOf: [{ type: 'string' }, { type: 'null' }] },
		project_hint: { oneOf: [{ type: 'string' }, { type: 'null' }] },
		project_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
		repo_path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
		vault_root: { type: 'string', minLength: 1 },
		scanned_at: { type: 'string', minLength: 1 },
		index_state: { type: 'string', minLength: 1 },
		snapshot_generation: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
		snapshot_warning: { oneOf: [{ type: 'string' }, { type: 'null' }] },
		content_language: { type: 'string', minLength: 1 },
		content_language_source: { type: 'string', minLength: 1 },
		project_identity: PROJECT_IDENTITY_OUTPUT_SCHEMA,
		workflow: { type: 'object', additionalProperties: true },
		context_pack_summary: { type: 'object', additionalProperties: true },
		related_projects: { type: 'array', items: { type: 'object', additionalProperties: true } },
		recent_sessions: { type: 'array', items: { type: 'object', additionalProperties: true } },
		user_preferences: { type: 'object', additionalProperties: true },
		recommended_next_tool: { type: 'string', minLength: 1 },
		recommended_recall: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] },
		closeout_contract: { type: 'object', additionalProperties: true },
		next_actions: { type: 'array', items: AGENT_ACTION_SCHEMA },
		next_actions_for_agent: { type: 'array', items: { type: 'string' } },
	},
	allOf: [
		COMMON_TOOL_SUCCESS_OUTPUT_SCHEMA,
		{
			required: ['workflow', 'task_id', 'recommended_recall', 'next_actions'],
			properties: {
				tool: { const: 'tracekeeper.start_task' },
				task_id: { type: 'string', minLength: 1 },
				project_hint: { oneOf: [{ type: 'string' }, { type: 'null' }] },
				project_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
				repo_path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
				project_identity: PROJECT_IDENTITY_OUTPUT_SCHEMA,
				workflow: {
					type: 'object',
					required: ['mode', 'state'],
					properties: {
						mode: { const: 'tracked_task', type: 'string' },
						state: { type: 'string' },
						task_id: { type: 'string' },
						operation_id: { type: 'string' },
						project_hint: { oneOf: [{ type: 'string' }, { type: 'null' }] },
						project_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
						repo_path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
					},
					additionalProperties: true,
				},
				recommended_recall: {
					oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }],
				},
				closeout_contract: {
					type: 'object',
					required: ['required_tool', 'default_mode', 'fields'],
					properties: {
						required_tool: { type: 'string' },
						default_mode: { type: 'string' },
						content_language: { type: 'string' },
						content_language_source: { type: 'string' },
						fields: {
							type: 'array',
							items: { type: 'string' },
						},
						project_hint_required_for_project_memory: { type: 'boolean' },
						note: { type: 'string' },
					},
					additionalProperties: true,
				},
				next_actions: { type: 'array', items: AGENT_ACTION_SCHEMA },
				next_actions_for_agent: { type: 'array', items: { type: 'string' } },
				recommended_next_actions: { type: 'array', items: { type: 'string' } },
			},
		},
	],
	additionalProperties: false,
};

export const RECALL_SUCCESS_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	required: [
		'schema_version',
		'ok',
		'tool',
		'read_only',
		'vault_root',
		'query',
		'max_items',
		'matched_count',
		'scope_mode',
		'index_state',
		'snapshot_generation',
		'snapshot_warning',
		'recall',
		'matches',
		'next_actions',
	],
	properties: {
		schema_version: { const: SCHEMA_VERSION, type: 'integer' },
		ok: { const: true, type: 'boolean' },
		tool: { const: 'tracekeeper.recall', type: 'string' },
		read_only: { const: true, type: 'boolean' },
		vault_root: { type: 'string', minLength: 1 },
		query: { oneOf: [{ type: 'string' }, { type: 'null' }] },
		max_items: { type: 'integer', minimum: 1, maximum: 20 },
		matched_count: { type: 'integer', minimum: 0 },
		total_matches: { type: 'integer', minimum: 0 },
		task_id: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		uncertain: { type: 'boolean' },
		scope_mode: { type: 'string', enum: ['global', 'project', 'project_history', 'task_history'] },
		scope: { type: 'object', additionalProperties: true },
		project_identity: PROJECT_IDENTITY_OUTPUT_SCHEMA,
		candidates: { type: 'array', items: { type: 'string' } },
		candidate_notes: { type: 'array', items: { type: 'object', additionalProperties: true } },
		scope_evidence: { type: 'array', items: { type: 'object', additionalProperties: true } },
		index_state: { type: 'string', minLength: 1 },
		snapshot_generation: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
		snapshot_warning: { oneOf: [{ type: 'string' }, { type: 'null' }] },
		recall: { type: 'object', additionalProperties: true },
		matches: { type: 'array', items: { type: 'object', additionalProperties: true } },
		entries: { type: 'array', items: { type: 'object', additionalProperties: true } },
		next_actions: { type: 'array', items: AGENT_ACTION_SCHEMA },
		next_actions_for_agent: { type: 'array', items: { type: 'string' } },
		recommended_actions: { type: 'array', items: { type: 'string' } },
		remembered_scope: { type: 'string' },
	},
	allOf: [
		COMMON_TOOL_SUCCESS_OUTPUT_SCHEMA,
		{
			required: ['recall', 'matches', 'next_actions'],
			properties: {
				tool: { const: 'tracekeeper.recall' },
				project_identity: PROJECT_IDENTITY_OUTPUT_SCHEMA,
				recall: {
					type: 'object',
					required: ['recall_id', 'scope', 'scope_confidence', 'query', 'matched_count', 'snapshot_generation'],
					properties: {
						recall_id: { type: 'string', minLength: 1 },
						scope: { type: 'string', enum: ['global', 'project', 'project_history', 'task_history'] },
						scope_confidence: { type: 'number', minimum: 0, maximum: 1 },
						query: { type: 'string' },
						matched_count: { type: 'integer', minimum: 0 },
						snapshot_generation: { type: ['integer', 'null'], minimum: 0 },
						index_state: { type: 'string' },
						snapshot_warning: { type: ['string', 'null'] },
					},
					additionalProperties: true,
				},
				matches: {
					type: 'array',
					items: {
						type: 'object',
						required: ['path', 'excerpt', 'why_matched', 'content_origin', 'instruction_trust', 'relation_evidence'],
						properties: {
							path: { type: 'string', minLength: 1 },
							excerpt: { type: 'string' },
							why_matched: { type: 'string', minLength: 1 },
							content_origin: {
								type: 'string',
								enum: ['captured_source', 'tracekeeper_generated', 'vault_note'],
							},
							instruction_trust: { const: 'data_only', type: 'string' },
							relation_evidence: {
								type: 'object',
								required: ['related_wiki', 'related_sources'],
								properties: {
									related_wiki: {
										type: 'array',
										items: {
											type: 'object',
											required: ['path', 'declared_by', 'declared_via', 'verified_by'],
											properties: {
												path: { type: 'string', minLength: 1 },
												declared_by: { type: 'string', minLength: 1 },
												declared_via: {
													type: 'array',
													items: { type: 'string', enum: ['frontmatter', 'body_wikilink'] },
												},
												verified_by: { const: 'active_vault_snapshot', type: 'string' },
											},
											additionalProperties: true,
										},
									},
									related_sources: {
										type: 'array',
										items: {
											type: 'object',
											required: ['path', 'declared_by', 'declared_via', 'verified_by'],
											properties: {
												path: { type: 'string', minLength: 1 },
												declared_by: { type: 'string', minLength: 1 },
												declared_via: {
													type: 'array',
													items: { type: 'string', enum: ['frontmatter', 'body_wikilink'] },
												},
												verified_by: { const: 'active_vault_snapshot', type: 'string' },
											},
											additionalProperties: true,
										},
									},
								},
								additionalProperties: false,
							},
						},
						additionalProperties: true,
					},
				},
				candidate_notes: {
					type: 'array',
					items: {
						type: 'object',
						required: ['path', 'title', 'type'],
						properties: {
							path: { type: 'string', minLength: 1 },
							title: { type: 'string' },
							type: { oneOf: [{ type: 'string' }, { type: 'null' }] },
						},
						additionalProperties: false,
					},
				},
				workflow: {
					type: 'object',
					properties: {
						mode: { type: 'string' },
						state: { type: 'string' },
					},
					additionalProperties: true,
				},
				next_actions: { type: 'array', items: AGENT_ACTION_SCHEMA },
				next_actions_for_agent: { type: 'array', items: { type: 'string' } },
				recommended_actions: { type: 'array', items: { type: 'string' } },
				remembered_scope: { type: 'string' },
			},
		},
	],
	additionalProperties: false,
};

const DURABLE_OUTPUT_STATUS_SCHEMA = {
	type: 'string',
	enum: [
		'none',
		'pending_review',
		'ready_to_apply',
		'revision_requested',
		'applied',
		'rejected',
		'unresolved',
		'mixed',
	],
};

const DURABLE_OUTPUT_SUMMARY_SCHEMA: JsonSchema2020 = {
	type: 'object',
	required: [
		'status',
		'source_capture_count',
		'proposal_count',
		'pending_review_count',
		'ready_to_apply_count',
		'revision_requested_count',
		'applied_count',
		'rejected_count',
		'unresolved_count',
		'proposal_paths',
		'target_paths',
	],
	properties: {
		status: DURABLE_OUTPUT_STATUS_SCHEMA,
		source_capture_count: { type: 'integer', minimum: 0 },
		proposal_count: { type: 'integer', minimum: 0 },
		pending_review_count: { type: 'integer', minimum: 0 },
		ready_to_apply_count: { type: 'integer', minimum: 0 },
		revision_requested_count: { type: 'integer', minimum: 0 },
		applied_count: { type: 'integer', minimum: 0 },
		rejected_count: { type: 'integer', minimum: 0 },
		unresolved_count: { type: 'integer', minimum: 0 },
		proposal_paths: { type: 'array', items: { type: 'string' } },
		target_paths: { type: 'array', items: { type: 'string' } },
	},
	additionalProperties: false,
};

export const FINISH_TASK_SUCCESS_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	required: [
		'schema_version',
		'ok',
		'tool',
		'read_only',
		'operation_id',
		'idempotency_key',
		'task_id',
		'task_path',
		'path',
		'activity_path',
		'workflow',
		'memory',
		'durable_output',
		'status',
		'next_actions',
	],
	properties: {
		schema_version: { const: SCHEMA_VERSION, type: 'integer' },
		ok: { const: true, type: 'boolean' },
		tool: { const: 'tracekeeper.finish_task', type: 'string' },
		read_only: { const: false, type: 'boolean' },
		operation_id: { type: 'string', minLength: 1 },
		idempotency_key: { type: 'string', minLength: 1 },
		task_id: { type: 'string', minLength: 1 },
		task_path: {
			description: 'Canonical task record completed by finish_task, reconstructed at this path when the start_task record is missing.',
			oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
		},
		path: {
			type: 'string',
			minLength: 1,
			description: 'Primary finish record path. For current operations this is the canonical task_path.',
		},
		activity_path: { type: 'string', minLength: 1 },
		status: { type: 'string', enum: ['completed', 'partial', 'blocked'] },
		session_path: {
			type: 'string',
			minLength: 1,
			description: 'Compatibility alias for path. Current finish operations do not create an implicit session note.',
		},
		content_language: { type: 'string', minLength: 1 },
		content_language_source: { type: 'string', minLength: 1 },
		outcome_count: { type: 'integer', minimum: 0 },
		next_action_count: { type: 'integer', minimum: 0 },
		proposal_count: { type: 'integer', minimum: 0 },
		suggestion_count: { type: 'integer', minimum: 0 },
		auto_applied_count: { type: 'integer', minimum: 0 },
		memory_status: { type: 'string', enum: ['no_candidates', 'disabled', 'queued_for_review', 'partially_auto_saved', 'auto_saved', 'requires_wiki_bridge', 'conflict'] },
		project_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
		repo_path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
		project_hint: { oneOf: [{ type: 'string' }, { type: 'null' }] },
		project_identity: PROJECT_IDENTITY_OUTPUT_SCHEMA,
		related_wiki: { type: 'array', items: { type: 'string' } },
		related_sources: { type: 'array', items: { type: 'string' } },
		architecture_status: { type: 'string', enum: ['healthy', 'needs_attention'] },
		missing_graph_bridges: { type: 'array', items: { type: 'string' } },
		missing_wiki_bridge: { type: 'boolean' },
		missing_related_sources: { type: 'array', items: { type: 'string' } },
		workflow: { type: 'object', additionalProperties: true },
		memory: { type: 'object', additionalProperties: true },
		durable_output: DURABLE_OUTPUT_SUMMARY_SCHEMA,
		closeout_contract: { type: 'object', additionalProperties: true },
		memory_candidate_records: { type: 'array', items: FINISH_TASK_CLAIM_RECORD_SCHEMA },
		memory_changes: { type: 'array', items: FINISH_TASK_MEMORY_CHANGE_SCHEMA },
		proposals: { type: 'array', items: { type: 'object', additionalProperties: true } },
		proposal_transition_receipts: { type: 'array', items: PROPOSAL_TRANSITION_PREVIEW_SCHEMA },
		suggested_memory_updates: { type: 'array', items: { type: 'object', additionalProperties: true } },
		auto_applied_memory_updates: { type: 'array', items: { type: 'object', additionalProperties: true } },
		next_actions: { type: 'array', items: AGENT_ACTION_SCHEMA },
		next_actions_for_agent: { type: 'array', items: { type: 'string' } },
		recommended_memory_actions: { type: 'array', items: { type: 'string' } },
	},
	allOf: [
		COMMON_TOOL_SUCCESS_OUTPUT_SCHEMA,
		{
			required: ['workflow', 'memory', 'durable_output', 'status', 'next_actions'],
			properties: {
				tool: { const: 'tracekeeper.finish_task' },
				task_id: { type: 'string', minLength: 1 },
				project_hint: { oneOf: [{ type: 'string' }, { type: 'null' }] },
				project_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
				repo_path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
				project_identity: PROJECT_IDENTITY_OUTPUT_SCHEMA,
				workflow: {
					type: 'object',
					required: ['mode', 'state'],
					properties: {
						mode: { const: 'tracked_task', type: 'string' },
						state: { const: 'finished', type: 'string' },
						task_id: { type: 'string' },
						project_hint: { oneOf: [{ type: 'string' }, { type: 'null' }] },
						project_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
						repo_path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
					},
					additionalProperties: true,
				},
				memory: {
					type: 'object',
					required: ['status'],
					properties: {
						status: {
							type: 'string',
							enum: [
								'no_candidates',
								'disabled',
								'suggested',
								'queued_for_review',
								'partially_auto_saved',
								'auto_saved',
								'requires_wiki_bridge',
								'conflict',
							],
						},
						proposal_count: { type: 'integer', minimum: 0 },
						auto_applied_count: { type: 'integer', minimum: 0 },
						action_required: { type: 'boolean' },
						suggestions: { type: 'array', items: { type: 'string' } },
					},
					additionalProperties: true,
				},
				status: { type: 'string', enum: ['completed', 'partial', 'blocked'] },
				closeout_contract: {
					type: 'object',
					required: ['required_tool', 'default_mode', 'fields'],
					properties: {
						required_tool: { type: 'string' },
						default_mode: { type: 'string' },
						content_language: { type: 'string' },
						content_language_source: { type: 'string' },
						fields: {
							type: 'array',
							items: { type: 'string' },
						},
						project_hint_required_for_project_memory: { type: 'boolean' },
						note: { type: 'string' },
					},
					additionalProperties: true,
				},
				memory_status: { type: 'string' },
				next_actions: { type: 'array', items: AGENT_ACTION_SCHEMA },
				next_actions_for_agent: { type: 'array', items: { type: 'string' } },
				memory_candidate_records: { type: 'array', items: FINISH_TASK_CLAIM_RECORD_SCHEMA },
				memory_changes: { type: 'array', items: FINISH_TASK_MEMORY_CHANGE_SCHEMA },
				proposal_transition_receipts: { type: 'array', items: PROPOSAL_TRANSITION_PREVIEW_SCHEMA },
				recommended_memory_actions: { type: 'array', items: { type: 'string' } },
			},
		},
	],
	additionalProperties: false,
};

const MEMORY_CATALOG_ENTRY_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	required: [
		'path', 'legacy', 'memory_id', 'scope', 'project_id', 'claim_key', 'memory_kind',
		'authority', 'confidence_level', 'declared_state', 'effective_state',
		'observed_at', 'valid_from', 'valid_to', 'last_verified_at', 'evidence',
		'supersedes', 'contradicts', 'related_wiki', 'related_sources', 'reasons',
	],
	properties: {
		path: { type: 'string', minLength: 1 },
		legacy: { type: 'boolean' },
		memory_id: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		scope: { type: 'string', enum: ['global', 'project'] },
		project_id: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		claim_key: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		memory_kind: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		authority: { oneOf: [{ type: 'string', enum: ['agent', 'source', 'user'] }, { type: 'null' }] },
		confidence_level: { oneOf: [{ type: 'string', enum: ['uncertain', 'inferred', 'supported', 'verified'] }, { type: 'null' }] },
		declared_state: { oneOf: [{ type: 'string', enum: ['active', 'disputed', 'retracted', 'review'] }, { type: 'null' }] },
		effective_state: { type: 'string', enum: ['current', 'superseded', 'disputed', 'retracted', 'review', 'legacy_unkeyed'] },
		observed_at: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		valid_from: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		valid_to: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		last_verified_at: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		evidence: { type: 'array', items: { type: 'string' } },
		supersedes: { type: 'array', items: { type: 'string' } },
		contradicts: { type: 'array', items: { type: 'string' } },
		related_wiki: { type: 'array', items: { type: 'string' } },
		related_sources: { type: 'array', items: { type: 'string' } },
		reasons: { type: 'array', items: { type: 'string' } },
	},
	additionalProperties: false,
};

export const MEMORY_SUCCESS_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	required: [
		'schema_version',
		'ok',
		'tool',
		'read_only',
		'scope',
		'view',
		'project_id',
		'generation',
		'total',
		'complete',
		'sort',
		'page',
		'entries',
	],
	properties: {
		schema_version: { const: SCHEMA_VERSION, type: 'integer' },
		ok: { const: true, type: 'boolean' },
		tool: { const: 'tracekeeper.memory' },
		read_only: { const: true, type: 'boolean' },
		scope: { type: 'string', enum: ['global', 'project'] },
		view: { type: 'string', enum: ['current', 'history', 'conflicts', 'all'] },
		project_id: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
		generation: { type: 'integer', minimum: 0 },
		total: { type: 'integer', minimum: 0 },
		complete: { const: true, type: 'boolean' },
		sort: {
			const: 'observed_at_desc_memory_id_path_asc',
			type: 'string',
		},
		page: {
			type: 'object',
			required: ['page_size', 'next_cursor'],
			properties: {
				page_size: { type: 'integer', minimum: 1, maximum: 200 },
				next_cursor: {
					oneOf: [
						{ type: 'string', minLength: 1 },
						{ type: 'null' },
					],
				},
			},
			additionalProperties: false,
		},
		entries: {
			type: 'array',
			items: MEMORY_CATALOG_ENTRY_OUTPUT_SCHEMA,
		},
	},
	additionalProperties: false,
};

const STRING_ARRAY_SCHEMA = { type: 'array', items: { type: 'string' } };
const OPEN_OBJECT_SCHEMA = { type: 'object', additionalProperties: true };
const NULLABLE_STRING_SCHEMA = { oneOf: [{ type: 'string' }, { type: 'null' }] };
const SCAN_PROVENANCE_PROPERTIES = {
	index_state: { type: 'string', minLength: 1 },
	snapshot_generation: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
	snapshot_warning: NULLABLE_STRING_SCHEMA,
};

const ERROR_DETAIL_SCHEMA = {
	type: 'object',
	required: ['code', 'message', 'retryable', 'recovery_actions'],
	properties: {
		code: {
			type: 'string',
			enum: [
				'PERMISSION_DENIED',
				'STALE_CURSOR',
				'INVALID_CURSOR',
				'FINISH_ALREADY_COMPLETED',
				'IDEMPOTENCY_CONFLICT',
				'TOOL_UNAVAILABLE',
				'INVALID_REQUEST',
				'INTERNAL_CONTRACT_ERROR',
			],
		},
		message: { type: 'string' },
		retryable: { type: 'boolean' },
		recovery_actions: { type: 'array', items: AGENT_ACTION_SCHEMA },
		diagnostics: STRING_ARRAY_SCHEMA,
	},
	additionalProperties: false,
};

export const PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	required: ['schema_version', 'ok', 'tool', 'error', 'error_detail'],
	properties: {
		schema_version: { const: SCHEMA_VERSION, type: 'integer' },
		ok: { const: false, type: 'boolean' },
		tool: { type: 'string', minLength: 1 },
		error: { type: 'string' },
		error_detail: ERROR_DETAIL_SCHEMA,
		execution_status: { type: 'string', enum: ['failed', 'succeeded'] },
		contract_status: { const: 'invalid', type: 'string' },
		operation_id: { type: 'string', minLength: 1 },
		idempotency_key: { type: 'string', minLength: 1 },
		task_id: { type: 'string', minLength: 1 },
		task_path: { type: 'string', minLength: 1 },
		path: { type: 'string', minLength: 1 },
		activity_path: { type: 'string', minLength: 1 },
		proposal_id: { type: 'string', minLength: 1 },
		proposal_path: { type: 'string', minLength: 1 },
		target_note: { type: 'string', minLength: 1 },
		request_path: { type: 'string', minLength: 1 },
	},
	description: 'Closed public failure envelope with typed recovery details.',
	additionalProperties: false,
};

export const STATUS_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [
		{
			type: 'object',
			required: [
				'schema_version', 'ok', 'tool', 'read_only', 'vault_root', 'scanned_at',
				'index_state', 'snapshot_generation', 'snapshot_warning', 'content_language',
				'content_language_source', 'counts', 'scan_errors',
			],
			properties: {
				schema_version: { const: SCHEMA_VERSION, type: 'integer' },
				ok: { const: true, type: 'boolean' },
				tool: { const: 'tracekeeper.status', type: 'string' },
				read_only: { const: true, type: 'boolean' },
				vault_root: { type: 'string', minLength: 1 },
				scanned_at: { type: 'string', minLength: 1 },
				...SCAN_PROVENANCE_PROPERTIES,
				content_language: { type: 'string', minLength: 1 },
				content_language_source: { type: 'string', minLength: 1 },
				counts: OPEN_OBJECT_SCHEMA,
				scan_errors: { type: 'array', items: OPEN_OBJECT_SCHEMA },
			},
			additionalProperties: false,
		},
		PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA,
	],
};

const LIFECYCLE_DOCTOR_SCHEMA = {
	type: 'object',
	required: ['directory_counts', 'legacy_candidates'],
	properties: {
		directory_counts: {
			type: 'array',
			items: {
				type: 'object',
				required: ['directory', 'record_count'],
				properties: {
					directory: { type: 'string', minLength: 1 },
					record_count: { type: 'integer', minimum: 0 },
				},
				additionalProperties: false,
			},
		},
		legacy_candidates: {
			type: 'array',
			items: {
				type: 'object',
				required: ['path', 'content_hash', 'scope', 'project_id', 'suggestions'],
				properties: {
					path: { type: 'string', minLength: 1 },
					content_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
					scope: { type: 'string', enum: ['global', 'project'] },
					project_id: NULLABLE_STRING_SCHEMA,
					suggestions: { type: 'array', items: OPEN_OBJECT_SCHEMA },
				},
				additionalProperties: false,
			},
		},
	},
	additionalProperties: false,
};

export const LINT_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [
		{
			type: 'object',
			required: [
				'schema_version', 'ok', 'tool', 'read_only', 'profile', 'graph_profile_disabled',
				'profile_issues', 'vault_root', 'scanned_at', 'index_state', 'snapshot_generation',
				'snapshot_warning', 'issue_count', 'issues', 'graph_summary', 'graph_health',
				'legacy_structure', 'lifecycle_doctor', 'fix_plan_summary',
			],
			properties: {
				schema_version: { const: SCHEMA_VERSION, type: 'integer' },
				ok: { const: true, type: 'boolean' },
				tool: { const: 'tracekeeper.lint', type: 'string' },
				read_only: { const: true, type: 'boolean' },
				profile: { type: 'string', enum: ['off', 'advisory', 'strict'] },
				graph_profile_disabled: { type: 'boolean' },
				profile_issues: { type: 'array', items: OPEN_OBJECT_SCHEMA },
				vault_root: { type: 'string', minLength: 1 },
				scanned_at: { type: 'string', minLength: 1 },
				...SCAN_PROVENANCE_PROPERTIES,
				issue_count: { type: 'integer', minimum: 0 },
				issues: { type: 'array', items: OPEN_OBJECT_SCHEMA },
				graph_summary: { oneOf: [OPEN_OBJECT_SCHEMA, { type: 'null' }] },
				graph_health: { oneOf: [OPEN_OBJECT_SCHEMA, { type: 'null' }] },
				legacy_structure: OPEN_OBJECT_SCHEMA,
				lifecycle_doctor: LIFECYCLE_DOCTOR_SCHEMA,
				fix_plan_summary: STRING_ARRAY_SCHEMA,
			},
			additionalProperties: false,
		},
		PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA,
	],
};

export const READ_NOTE_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [
		{
			type: 'object',
			required: [
				'schema_version', 'ok', 'tool', 'read_only', 'vault_root', 'path', 'title',
				'mime_type', 'recall_id', 'content_origin', 'instruction_trust', 'content',
				'excerpt', 'relation_evidence',
			],
			properties: {
				schema_version: { const: SCHEMA_VERSION, type: 'integer' },
				ok: { const: true, type: 'boolean' },
				tool: { const: 'tracekeeper.read_note', type: 'string' },
				read_only: { const: true, type: 'boolean' },
				vault_root: { type: 'string', minLength: 1 },
				path: { type: 'string', minLength: 1 },
				title: { type: 'string' },
				mime_type: { type: 'string', minLength: 1 },
				recall_id: NULLABLE_STRING_SCHEMA,
				content_origin: { type: 'string', enum: ['captured_source', 'tracekeeper_generated', 'vault_note'] },
				instruction_trust: { const: 'data_only', type: 'string' },
				content: { type: 'string' },
				excerpt: { type: 'string' },
				relation_evidence: OPEN_OBJECT_SCHEMA,
			},
			additionalProperties: false,
		},
		PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA,
	],
};

const CONTEXT_PACK_OUTPUT_SCHEMA = {
	type: 'object',
	required: [
		'query', 'generatedAt', 'relevantNotes', 'sourceCandidates', 'evidenceCandidates',
		'gaps', 'staleWarnings', 'suggestedWritebackTargets', 'scanErrors',
	],
	properties: {
		query: { type: 'string' },
		generatedAt: { type: 'string', minLength: 1 },
		relevantNotes: { type: 'array', items: OPEN_OBJECT_SCHEMA },
		sourceCandidates: { type: 'array', items: OPEN_OBJECT_SCHEMA },
		evidenceCandidates: { type: 'array', items: OPEN_OBJECT_SCHEMA },
		gaps: STRING_ARRAY_SCHEMA,
		staleWarnings: STRING_ARRAY_SCHEMA,
		suggestedWritebackTargets: STRING_ARRAY_SCHEMA,
		scanErrors: { type: 'array', items: OPEN_OBJECT_SCHEMA },
	},
	additionalProperties: false,
};

const CONTEXT_PACK_COMMON_PROPERTIES = {
	schema_version: { const: SCHEMA_VERSION, type: 'integer' },
	ok: { const: true, type: 'boolean' },
	tool: { const: 'tracekeeper.build_context_pack', type: 'string' },
	read_only: { type: 'boolean' },
	vault_root: { type: 'string', minLength: 1 },
	task_id: NULLABLE_STRING_SCHEMA,
	project_hint: NULLABLE_STRING_SCHEMA,
	project_id: NULLABLE_STRING_SCHEMA,
	repo_path: NULLABLE_STRING_SCHEMA,
	project_identity: PROJECT_IDENTITY_OUTPUT_SCHEMA,
	query: { type: 'string' },
	...SCAN_PROVENANCE_PROPERTIES,
	context_pack: CONTEXT_PACK_OUTPUT_SCHEMA,
};

export const BUILD_CONTEXT_PACK_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [
		{
			type: 'object',
			required: [
				'schema_version', 'ok', 'tool', 'read_only', 'vault_root', 'task_id', 'project_hint',
				'project_id', 'repo_path', 'project_identity', 'query', 'index_state',
				'snapshot_generation', 'snapshot_warning', 'context_pack',
			],
			properties: {
				...CONTEXT_PACK_COMMON_PROPERTIES,
				read_only: { const: true, type: 'boolean' },
			},
			additionalProperties: false,
		},
		{
			type: 'object',
			required: [
				'schema_version', 'ok', 'tool', 'read_only', 'vault_root', 'task_id', 'project_hint',
				'project_id', 'repo_path', 'project_identity', 'query', 'index_state',
				'snapshot_generation', 'snapshot_warning', 'context_pack', 'artifact',
			],
			properties: {
				...CONTEXT_PACK_COMMON_PROPERTIES,
				read_only: { const: false, type: 'boolean' },
				artifact: {
					type: 'object',
					required: ['path', 'activity_path'],
					properties: { path: { type: 'string', minLength: 1 }, activity_path: { type: 'string', minLength: 1 } },
					additionalProperties: false,
				},
			},
			additionalProperties: false,
		},
		PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA,
	],
};

const REVIEW_PENDING_ENTRY_SCHEMA = {
	type: 'object',
	required: ['path', 'title', 'modifiedAt', 'status', 'proposal_kind', 'risk_level'],
	properties: {
		path: { type: 'string', minLength: 1 },
		title: { type: 'string' },
		modifiedAt: { type: 'string', minLength: 1 },
		status: { type: 'string' },
		proposal_kind: NULLABLE_STRING_SCHEMA,
		risk_level: NULLABLE_STRING_SCHEMA,
		record_identity: MEMORY_RECORD_IDENTITY_SCHEMA,
		proposed_record: PROPOSED_MEMORY_RECORD_SCHEMA,
		prior_memory_ids: { type: 'array', items: { type: 'string' } },
		predicted_state: MEMORY_RECORD_EFFECTIVE_STATE_SCHEMA,
	},
	additionalProperties: false,
};

const REVIEW_APPROVED_ENTRY_SCHEMA = {
	type: 'object',
	required: [
		'proposal_id', 'proposal_path', 'proposal_kind', 'target_note', 'risk_level',
		'task_id', 'ready_to_apply', 'blocker',
	],
	properties: {
		proposal_id: { type: 'string', minLength: 1 },
		proposal_path: { type: 'string', minLength: 1 },
		proposal_kind: { type: 'string' },
		target_note: NULLABLE_STRING_SCHEMA,
		risk_level: { type: 'string' },
		task_id: NULLABLE_STRING_SCHEMA,
		ready_to_apply: { type: 'boolean' },
		blocker: NULLABLE_STRING_SCHEMA,
		record_identity: MEMORY_RECORD_IDENTITY_SCHEMA,
		proposed_record: PROPOSED_MEMORY_RECORD_SCHEMA,
		prior_memory_ids: { type: 'array', items: { type: 'string' } },
		predicted_state: MEMORY_RECORD_EFFECTIVE_STATE_SCHEMA,
	},
	additionalProperties: false,
};

export const REVIEW_QUEUE_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [
		{
			type: 'object',
			required: ['schema_version', 'ok', 'tool', 'action', 'read_only', 'vault_root', 'count', 'entries'],
			properties: {
				schema_version: { const: SCHEMA_VERSION, type: 'integer' },
				ok: { const: true, type: 'boolean' },
				tool: { const: 'tracekeeper.review_queue', type: 'string' },
				action: { const: 'list_pending', type: 'string' },
				read_only: { const: true, type: 'boolean' },
				vault_root: { type: 'string', minLength: 1 },
				count: { type: 'integer', minimum: 0 },
				entries: { type: 'array', items: REVIEW_PENDING_ENTRY_SCHEMA },
			},
			additionalProperties: false,
		},
		{
			type: 'object',
			required: ['schema_version', 'ok', 'tool', 'action', 'read_only', 'vault_root', 'count', 'entries'],
			properties: {
				schema_version: { const: SCHEMA_VERSION, type: 'integer' },
				ok: { const: true, type: 'boolean' },
				tool: { const: 'tracekeeper.review_queue', type: 'string' },
				action: { const: 'list_approved', type: 'string' },
				read_only: { const: true, type: 'boolean' },
				vault_root: { type: 'string', minLength: 1 },
				count: { type: 'integer', minimum: 0 },
				entries: { type: 'array', items: REVIEW_APPROVED_ENTRY_SCHEMA },
			},
			additionalProperties: false,
		},
		PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA,
	],
};

export const APPLY_APPROVED_WRITEBACK_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [
		{
			type: 'object',
			required: [
				'schema_version', 'ok', 'tool', 'read_only', 'dry_run', 'permission_level',
				'proposal_id', 'proposal_path', 'target_note', 'touched_notes', 'writeback_effect', 'writeback_preview',
				'confirmation_token', 'confirmation_expires_at',
			],
			properties: {
				schema_version: { const: SCHEMA_VERSION, type: 'integer' },
				ok: { const: true, type: 'boolean' },
				tool: { const: 'tracekeeper.apply_approved_writeback', type: 'string' },
				read_only: { const: true, type: 'boolean' },
				dry_run: { const: true, type: 'boolean' },
				permission_level: { const: 'review-gated apply', type: 'string' },
				proposal_id: { type: 'string', minLength: 1 },
				proposal_path: { type: 'string', minLength: 1 },
				target_note: { type: 'string', minLength: 1 },
				touched_notes: STRING_ARRAY_SCHEMA,
				writeback_effect: {
					type: 'string',
					enum: ['append', 'create_wiki_note', 'create_memory_record'],
				},
				writeback_preview: { type: 'string', minLength: 1 },
				confirmation_token: { type: 'string', minLength: 1 },
				confirmation_expires_at: { type: 'string', minLength: 1 },
			},
			additionalProperties: false,
		},
		{
			type: 'object',
			required: [
				'schema_version', 'ok', 'tool', 'read_only', 'permission_level', 'status',
				'operation_id', 'proposal_id', 'proposal_path', 'target_note', 'touched_notes', 'activity_path',
			],
			properties: {
				schema_version: { const: SCHEMA_VERSION, type: 'integer' },
				ok: { const: true, type: 'boolean' },
				tool: { const: 'tracekeeper.apply_approved_writeback', type: 'string' },
				read_only: { const: false, type: 'boolean' },
				permission_level: { const: 'review-gated apply', type: 'string' },
				status: { const: 'applied', type: 'string' },
				operation_id: { type: 'string', minLength: 1 },
				proposal_id: { type: 'string', minLength: 1 },
				proposal_path: { type: 'string', minLength: 1 },
				target_note: { type: 'string', minLength: 1 },
				touched_notes: STRING_ARRAY_SCHEMA,
				activity_path: { type: 'string', minLength: 1 },
			},
			additionalProperties: false,
		},
		PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA,
	],
};

const SOURCE_REQUEST_LIST_ENTRY_SCHEMA = {
	type: 'object',
	required: ['path', 'source', 'sourceKind', 'purpose', 'relatedProject', 'analysisMode', 'status', 'modifiedAt'],
	properties: {
		path: { type: 'string', minLength: 1 },
		source: { type: 'string' },
		sourceKind: { type: 'string' },
		purpose: { type: 'string' },
		relatedProject: { type: 'string' },
		analysisMode: { type: 'string' },
		status: { type: 'string' },
		modifiedAt: { type: 'string', minLength: 1 },
	},
	additionalProperties: false,
};

const SOURCE_ANALYSIS_PROPOSAL_SCHEMA = {
	type: 'object',
	required: ['proposal_id', 'path', 'proposal_link_target'],
	properties: {
		proposal_id: { type: 'string', minLength: 1 },
		path: { type: 'string', minLength: 1 },
		proposal_link_target: { type: 'string', minLength: 1 },
	},
	additionalProperties: false,
};

export const SOURCE_REQUEST_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [
		{
			type: 'object',
			required: ['schema_version', 'ok', 'tool', 'action', 'read_only', 'vault_root', 'count', 'filter', 'entries'],
			properties: {
				schema_version: { const: SCHEMA_VERSION, type: 'integer' },
				ok: { const: true, type: 'boolean' },
				tool: { const: 'tracekeeper.source_request', type: 'string' },
				action: { const: 'list', type: 'string' },
				read_only: { const: true, type: 'boolean' },
				vault_root: { type: 'string', minLength: 1 },
				count: { type: 'integer', minimum: 0 },
				filter: {
					type: 'object',
					required: ['status', 'source_kind'],
					properties: { status: { type: 'string' }, source_kind: { type: 'string' } },
					additionalProperties: false,
				},
				entries: { type: 'array', items: SOURCE_REQUEST_LIST_ENTRY_SCHEMA },
			},
			additionalProperties: false,
		},
		{
			type: 'object',
			required: [
				'schema_version', 'ok', 'tool', 'action', 'read_only', 'status', 'vault_root', 'request_path',
				'mode', 'source_note', 'report', 'proposals', 'activity_path', 'summary', 'warnings',
			],
			properties: {
				schema_version: { const: SCHEMA_VERSION, type: 'integer' },
				ok: { const: true, type: 'boolean' },
				tool: { const: 'tracekeeper.source_request', type: 'string' },
				action: { const: 'analyze', type: 'string' },
				read_only: { const: false, type: 'boolean' },
				status: { type: 'string' },
				vault_root: { type: 'string', minLength: 1 },
				request_path: { type: 'string', minLength: 1 },
				mode: { type: 'string', enum: ['external_reference', 'extracted_snapshot', 'local_copy'] },
				source_note: {
					type: 'object',
					required: [
						'path', 'activity_path', 'source_kind', 'source_id', 'content_hash', 'route', 'index_path', 'part_manifest',
					],
					properties: {
						path: { type: 'string', minLength: 1 },
						activity_path: { type: 'string', minLength: 1 },
						source_kind: { type: 'string', enum: ['web', 'file', 'transcript'] },
						source_id: { type: 'string', minLength: 1 },
						content_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
						route: { type: 'string', minLength: 1 },
						index_path: { type: 'string', minLength: 1 },
						part_manifest: STRING_ARRAY_SCHEMA,
					},
					additionalProperties: false,
				},
				report: {
					type: 'object',
					required: ['path', 'activity_path'],
					properties: { path: { type: 'string', minLength: 1 }, activity_path: { type: 'string', minLength: 1 } },
					additionalProperties: false,
				},
				proposals: { type: 'array', items: SOURCE_ANALYSIS_PROPOSAL_SCHEMA },
				activity_path: { type: 'string', minLength: 1 },
				summary: { type: 'string' },
				warnings: STRING_ARRAY_SCHEMA,
			},
			additionalProperties: false,
		},
		PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA,
	],
};

export const CAPTURE_SOURCE_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [
		{
			type: 'object',
			required: ['schema_version', 'ok', 'tool', 'operation_id', 'idempotency_key', 'status', 'path', 'activity_path', 'warnings', 'metadata'],
			properties: {
				schema_version: { const: SCHEMA_VERSION, type: 'integer' },
				ok: { const: true, type: 'boolean' },
				tool: { const: 'tracekeeper.capture_source', type: 'string' },
				operation_id: { type: 'string', minLength: 1 },
				idempotency_key: { type: 'string', minLength: 1 },
				status: { type: 'string' },
				path: { type: 'string', minLength: 1 },
				activity_path: { type: 'string', minLength: 1 },
				warnings: STRING_ARRAY_SCHEMA,
				metadata: {
					type: 'object',
					required: ['source', 'mode', 'source_kind', 'source_id', 'content_hash', 'route', 'index_path', 'part_manifest'],
					properties: {
						source: { type: 'string', minLength: 1 },
						mode: { type: 'string', enum: ['external_reference', 'extracted_snapshot', 'local_copy'] },
						source_kind: { type: 'string', enum: ['web', 'file', 'transcript'] },
						source_id: { type: 'string', minLength: 1 },
						content_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
						route: { type: 'string', minLength: 1 },
						index_path: { type: 'string', minLength: 1 },
						part_manifest: STRING_ARRAY_SCHEMA,
					},
					additionalProperties: false,
				},
			},
			additionalProperties: false,
		},
		PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA,
	],
};

const PROPOSE_MEMORY_COMMON_PROPERTIES = {
	schema_version: { const: SCHEMA_VERSION, type: 'integer' },
	ok: { const: true, type: 'boolean' },
	tool: { const: 'tracekeeper.propose_memory', type: 'string' },
	operation_id: { type: 'string', minLength: 1 },
	idempotency_key: { type: 'string', minLength: 1 },
	status: { type: 'string' },
	path: { type: 'string', minLength: 1 },
	activity_path: { type: 'string', minLength: 1 },
	warnings: STRING_ARRAY_SCHEMA,
	persisted: { type: 'boolean' },
	auto_applied: { type: 'boolean' },
	duplicate: { type: 'boolean' },
	proposal_destination: { type: 'string', enum: ['memory', 'wiki'] },
	memory_rule: {
		oneOf: [
			{ type: 'string', enum: ['review_queue', 'auto_write', 'disabled'] },
			{ type: 'null' },
		],
	},
	memory_scope: {
		oneOf: [
			{ type: 'string', enum: ['global', 'project'] },
			{ type: 'null' },
		],
	},
	project_hint: NULLABLE_STRING_SCHEMA,
	related_wiki: STRING_ARRAY_SCHEMA,
	related_sources: STRING_ARRAY_SCHEMA,
	missing_related_sources: STRING_ARRAY_SCHEMA,
	architecture_status: { type: 'string', enum: ['healthy', 'needs_attention'] },
	missing_graph_bridges: STRING_ARRAY_SCHEMA,
	missing_wiki_bridge: { type: 'boolean' },
	project_id: NULLABLE_STRING_SCHEMA,
	project_hub: NULLABLE_STRING_SCHEMA,
	global_hub: NULLABLE_STRING_SCHEMA,
	agent_type: { type: 'string', minLength: 1 },
	operation_hash: { type: 'string', minLength: 1 },
	target_note: { type: 'string', minLength: 1 },
	record_identity: MEMORY_RECORD_IDENTITY_SCHEMA,
	predicted_state: { oneOf: [MEMORY_RECORD_EFFECTIVE_STATE_SCHEMA, { type: 'null' }] },
	predicted_record: PROPOSED_MEMORY_RECORD_SCHEMA,
	proposal_transition_preview: PROPOSAL_TRANSITION_PREVIEW_SCHEMA,
	proposal_id: NULLABLE_STRING_SCHEMA,
	proposal_path: NULLABLE_STRING_SCHEMA,
	proposal_link_target: { type: 'string', minLength: 1 },
	review_reason: NULLABLE_STRING_SCHEMA,
	review_warnings: STRING_ARRAY_SCHEMA,
	next_actions: { type: 'array', items: AGENT_ACTION_SCHEMA },
};

export const PROPOSE_MEMORY_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [
		{
			type: 'object',
			required: [
				'schema_version', 'ok', 'tool', 'operation_id', 'idempotency_key', 'status', 'path',
				'activity_path', 'warnings', 'auto_applied', 'duplicate', 'memory_rule', 'memory_scope',
				'project_hint', 'related_wiki', 'related_sources', 'missing_related_sources',
				'architecture_status', 'missing_graph_bridges', 'missing_wiki_bridge', 'proposal_id', 'proposal_path',
				'next_actions',
			],
			properties: { ...PROPOSE_MEMORY_COMMON_PROPERTIES, auto_applied: { const: true, type: 'boolean' }, proposal_id: { const: null, type: 'null' }, proposal_path: { const: null, type: 'null' } },
			additionalProperties: false,
		},
		{
			type: 'object',
			required: [
				'schema_version', 'ok', 'tool', 'operation_id', 'idempotency_key', 'status', 'path',
				'activity_path', 'warnings', 'auto_applied', 'duplicate', 'proposal_id', 'proposal_path',
				'proposal_link_target', 'memory_rule', 'memory_scope', 'project_hint', 'related_wiki',
				'related_sources', 'missing_related_sources', 'architecture_status', 'missing_graph_bridges',
				'missing_wiki_bridge', 'review_reason', 'review_warnings', 'next_actions',
			],
			properties: { ...PROPOSE_MEMORY_COMMON_PROPERTIES, auto_applied: { const: false, type: 'boolean' }, proposal_id: { type: 'string', minLength: 1 }, proposal_path: { type: 'string', minLength: 1 } },
			additionalProperties: false,
		},
		{
			type: 'object',
			required: [
				'schema_version', 'ok', 'tool', 'operation_id', 'idempotency_key', 'status',
				'persisted', 'warnings', 'auto_applied', 'duplicate', 'proposal_destination',
				'memory_rule', 'memory_scope', 'project_hint', 'proposal_id', 'proposal_path',
				'review_reason', 'review_warnings', 'next_actions',
			],
			properties: {
				...PROPOSE_MEMORY_COMMON_PROPERTIES,
				status: { const: 'ignored', type: 'string' },
				persisted: { const: false, type: 'boolean' },
				auto_applied: { const: false, type: 'boolean' },
				proposal_destination: { const: 'memory', type: 'string' },
				memory_rule: { const: 'disabled', type: 'string' },
				proposal_id: { const: null, type: 'null' },
				proposal_path: { const: null, type: 'null' },
			},
			additionalProperties: false,
		},
		PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA,
	],
};

export const START_TASK_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [START_TASK_SUCCESS_OUTPUT_SCHEMA, PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA],
};

export const RECALL_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [RECALL_SUCCESS_OUTPUT_SCHEMA, PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA],
};

export const MEMORY_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [MEMORY_SUCCESS_OUTPUT_SCHEMA, PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA],
};

export const FINISH_TASK_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [FINISH_TASK_SUCCESS_OUTPUT_SCHEMA, PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA],
};

export const GENERIC_TOOL_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [COMMON_TOOL_SUCCESS_OUTPUT_SCHEMA, COMMON_TOOL_FAILURE_OUTPUT_SCHEMA],
};

const AGENT_ACTIVITY_SECTION_SCHEMA: JsonSchema2020 = {
	type: 'object',
	required: [
		'heading',
		'body',
		'at_line',
		'activity_event_id',
		'timestamp',
		'source_path',
		'source_kind',
		'action',
	],
	properties: {
		heading: { type: 'string', minLength: 1 },
		body: { type: 'array', items: { type: 'string' } },
		at_line: { type: 'integer', minimum: 1 },
		activity_event_id: { type: 'string', minLength: 1 },
		timestamp: { type: 'string', minLength: 1 },
		source_path: { type: 'string', minLength: 1 },
		source_kind: { const: 'shard', type: 'string' },
		action: { type: 'string', minLength: 1 },
	},
	additionalProperties: false,
};

export const AGENT_ACTIVITY_RECENT_OUTPUT_SCHEMA: JsonSchema2020 = {
	type: 'object',
	oneOf: [
		{
			type: 'object',
			required: [
				'schema_version',
				'ok',
				'tool',
				'read_only',
				'activity_path',
				'total_sections',
				'sections',
			],
			properties: {
				schema_version: { const: SCHEMA_VERSION, type: 'integer' },
				ok: { const: true, type: 'boolean' },
				tool: { const: 'tracekeeper.agent_activity_recent', type: 'string' },
				read_only: { const: true, type: 'boolean' },
				vault_root: { type: 'string', minLength: 1 },
				activity_path: { type: 'string', minLength: 1 },
				total_sections: { type: 'integer', minimum: 0 },
				sections: { type: 'array', items: AGENT_ACTIVITY_SECTION_SCHEMA },
			},
			additionalProperties: false,
		},
		PUBLIC_TOOL_FAILURE_OUTPUT_SCHEMA,
	],
};
