export type ToolVisibility = 'public' | 'compatibility' | 'internal';
export type ToolRisk = 'read-only' | 'low-risk-write' | 'review-gated-write';
export type ToolCapability =
	| 'vault.read'
	| 'vault.write'
	| 'memory.propose'
	| 'memory.apply'
	| 'memory.review'
	| 'workflow.manage'
	| 'review-gated.apply';

export interface ToolDeprecation {
	readonly replacement: string;
	readonly removalAfter?: string;
}

export interface ToolResultSchema {
	readonly type: string;
	readonly [key: string]: unknown;
}

export type ToolInputSchema = Record<string, unknown> & {
	readonly type: 'object';
	readonly properties: Record<string, unknown>;
	readonly required?: readonly string[];
	readonly additionalProperties?: boolean;
};

export interface ToolContract<Name extends string = string> {
	readonly name: Name;
	readonly version: number;
	readonly visibility: ToolVisibility;
	readonly capability: ToolCapability;
	readonly risk: ToolRisk;
	readonly useCase: string;
	readonly inputSchema: ToolInputSchema;
	readonly resultSchema: ToolResultSchema;
	readonly deprecated?: ToolDeprecation;
	readonly description?: string;
}

export type TracekeeperToolName =
	| 'tracekeeper.status'
	| 'tracekeeper.graph_health'
	| 'tracekeeper.start_task'
	| 'tracekeeper.recall'
	| 'tracekeeper.project_context'
	| 'tracekeeper.project_history'
	| 'tracekeeper.read_note'
	| 'tracekeeper.review_queue'
	| 'tracekeeper.list_review_queue'
	| 'tracekeeper.list_source_requests'
	| 'tracekeeper.list_approved_writebacks'
	| 'tracekeeper.audit_recent'
	| 'tracekeeper.source_request'
	| 'tracekeeper.analyze_source_request'
	| 'tracekeeper.apply_approved_writeback'
	| 'tracekeeper.build_context_pack'
	| 'tracekeeper.lint'
	| 'tracekeeper.finish_task'
	| 'tracekeeper.distill_session'
	| 'tracekeeper.write_context_pack'
	| 'tracekeeper.write_session_note'
	| 'tracekeeper.capture_source'
	| 'tracekeeper.propose_memory';

const vaultRootProperty = {
	type: 'string',
	description: 'Vault root path. If omitted, uses server configured --vault-root.',
};

function withVaultRoot(properties: Record<string, unknown>, required: string[] = []): ToolInputSchema {
	return {
		type: 'object',
		properties: {
			vaultRoot: vaultRootProperty,
			...properties,
		},
		additionalProperties: false,
		...(required.length > 0 ? { required } : {}),
	};
}

const RESULT_SCHEMA_BASE: ToolResultSchema = {
	type: 'object',
	additionalProperties: true,
	description: 'MCP tool result payload.',
};

export const PUBLIC_TOOL_NAME_ORDER = [
	'tracekeeper.status',
	'tracekeeper.lint',
	'tracekeeper.recall',
	'tracekeeper.read_note',
	'tracekeeper.start_task',
	'tracekeeper.finish_task',
	'tracekeeper.build_context_pack',
	'tracekeeper.review_queue',
	'tracekeeper.apply_approved_writeback',
	'tracekeeper.source_request',
	'tracekeeper.capture_source',
	'tracekeeper.propose_memory',
] as const;

type PublicToolName = (typeof PUBLIC_TOOL_NAME_ORDER)[number];

const compatibilityFallbackTools: ReadonlyArray<{ name: TracekeeperToolName; replacement: string; description: string }> = [
	{
		name: 'tracekeeper.graph_health',
		replacement: 'tracekeeper.lint',
		description: '[deprecated] Use tracekeeper.lint for graph checks. This compatibility tool is read-only.',
	},
	{
		name: 'tracekeeper.project_context',
		replacement: 'tracekeeper.recall with scope="project"',
		description: '[deprecated] Use tracekeeper.recall with scope="project". Compatibility tool, read-only.',
	},
	{
		name: 'tracekeeper.project_history',
		replacement: 'tracekeeper.recall with scope="project_history"',
		description:
			'[deprecated] Use tracekeeper.recall with scope="project_history". Compatibility tool, read-only.',
	},
	{
		name: 'tracekeeper.list_review_queue',
		replacement: 'tracekeeper.review_queue with action="list_pending"',
		description:
			'[deprecated] Use tracekeeper.review_queue with action="list_pending". Compatibility tool, read-only.',
	},
	{
		name: 'tracekeeper.list_source_requests',
		replacement: 'tracekeeper.source_request with action="list"',
		description: '[deprecated] Use tracekeeper.source_request with action="list". Compatibility tool, read-only.',
	},
	{
		name: 'tracekeeper.list_approved_writebacks',
		replacement: 'tracekeeper.review_queue with action="list_approved"',
		description:
			'[deprecated] Use tracekeeper.review_queue with action="list_approved". Compatibility tool, read-only.',
	},
	{
		name: 'tracekeeper.audit_recent',
		replacement: 'Obsidian runtime log view',
		description: '[deprecated] Prefer the Obsidian runtime log view. Compatibility tool, read-only.',
	},
	{
		name: 'tracekeeper.analyze_source_request',
		replacement: 'tracekeeper.source_request with action="analyze"',
		description:
			'[deprecated] Use tracekeeper.source_request with action="analyze". Compatibility tool, low-risk write.',
	},
	{
		name: 'tracekeeper.distill_session',
		replacement: 'tracekeeper.finish_task',
		description: '[deprecated] Use tracekeeper.finish_task. Compatibility tool for older session distillation flows.',
	},
	{
		name: 'tracekeeper.write_context_pack',
		replacement: 'tracekeeper.build_context_pack with write=true',
		description:
			'[deprecated] Use tracekeeper.build_context_pack with write=true. Compatibility tool, low-risk write.',
	},
	{
		name: 'tracekeeper.write_session_note',
		replacement: 'tracekeeper.finish_task',
		description: '[deprecated] Use tracekeeper.finish_task. Compatibility tool, low-risk write.',
	},
];

const compatibilityToolNameSet = new Set(compatibilityFallbackTools.map((entry) => entry.name));

export const toolContracts = [
	{
		name: 'tracekeeper.status',
		version: 1,
		visibility: 'public',
		capability: 'vault.read',
		risk: 'read-only',
		useCase: 'status',
		description:
			'[read-only] Quick vault and service summary. Does not read full note content or write files.',
		inputSchema: withVaultRoot({}),
		resultSchema: RESULT_SCHEMA_BASE,
	},
	{
		name: 'tracekeeper.graph_health',
		version: 1,
		visibility: 'compatibility',
		capability: 'vault.read',
		risk: 'read-only',
		useCase: 'graph_health',
		description: '[deprecated] Use tracekeeper.lint for graph checks. This compatibility tool is read-only.',
		inputSchema: withVaultRoot({
			max_items: { type: 'integer', description: 'Maximum number of array entries to return.' },
			graph_profile: {
				type: 'string',
				enum: ['off', 'advisory', 'strict'],
				description: 'Graph checking mode. Defaults to the server graphProfile setting.',
			},
		}),
		resultSchema: RESULT_SCHEMA_BASE,
		deprecated: {
			replacement: 'tracekeeper.lint',
		},
	},
	{
		name: 'tracekeeper.start_task',
		version: 1,
		visibility: 'public',
		capability: 'workflow.manage',
		risk: 'low-risk-write',
		useCase: 'start_task',
		description:
			'[low-risk write] Call once when starting meaningful work. Records a bounded task and returns the recommended recall step.',
		inputSchema: withVaultRoot(
			{
				goal: { type: 'string', description: 'Task goal statement.' },
				client: { type: 'string', description: 'Optional client context.' },
				project_hint: { type: 'string', description: 'Optional project hint.' },
				idempotency_key: {
					type: 'string',
					description: 'Optional stable retry key. Reusing it with different arguments is rejected.',
				},
			},
			['goal'],
		),
		resultSchema: RESULT_SCHEMA_BASE,
	},
	{
		name: 'tracekeeper.recall',
		version: 1,
		visibility: 'public',
		capability: 'vault.read',
		risk: 'read-only',
		useCase: 'recall',
		description:
			'[read-only] Use before read_note to find relevant memory, wiki, and source notes. Supports global, project, and project_history scopes.',
		inputSchema: withVaultRoot({
			query: { type: 'string', description: 'Recall query text. Required unless scope is project_history.' },
			scope: {
				type: 'string',
				enum: ['global', 'project', 'project_history'],
				description: 'Recall scope. Defaults to global.',
			},
			project_hint: { type: 'string', description: 'Project hint for scoped matching.' },
			project_id: { type: 'string', description: 'Project id for scoped matching.' },
			repo_path: { type: 'string', description: 'Repository/path prefix for scoped matching.' },
			repo: { type: 'string', description: 'Alias of repo_path for repository-scoped matching.' },
			project_path: { type: 'string', description: 'Alias of repo_path for workspace/project path matching.' },
			max_items: { type: 'integer', description: 'Maximum number of matches to return.' },
		}),
		resultSchema: RESULT_SCHEMA_BASE,
	},
	{
		name: 'tracekeeper.project_context',
		version: 1,
		visibility: 'compatibility',
		capability: 'vault.read',
		risk: 'read-only',
		useCase: 'project_context',
		description:
			'[deprecated] Use tracekeeper.recall with scope="project". Compatibility tool, read-only.',
		inputSchema: withVaultRoot({
			query: { type: 'string', description: 'Project-scoped recall query.' },
			project_hint: { type: 'string', description: 'Project hint for scoped matching.' },
			project_id: { type: 'string', description: 'Project id for scoped matching.' },
			repo_path: { type: 'string', description: 'Repository/path prefix for scoped matching.' },
			repo: { type: 'string', description: 'Alias of repo_path for repository-scoped matching.' },
			project_path: { type: 'string', description: 'Alias of repo_path for workspace/project path matching.' },
			max_items: { type: 'integer', description: 'Maximum number of matches to return.' },
		}, ['query']),
		resultSchema: RESULT_SCHEMA_BASE,
		deprecated: {
			replacement: 'tracekeeper.recall with scope="project"',
		},
	},
	{
		name: 'tracekeeper.project_history',
		version: 1,
		visibility: 'compatibility',
		capability: 'vault.read',
		risk: 'read-only',
		useCase: 'project_history',
		description:
			'[deprecated] Use tracekeeper.recall with scope="project_history". Compatibility tool, read-only.',
		inputSchema: withVaultRoot({
			project_hint: { type: 'string', description: 'Project hint for scoped matching.' },
			project_id: { type: 'string', description: 'Project id for scoped matching.' },
			repo_path: { type: 'string', description: 'Repository/path prefix for scoped matching.' },
			repo: { type: 'string', description: 'Alias of repo_path for repository-scoped matching.' },
			project_path: { type: 'string', description: 'Alias of repo_path for workspace/project path matching.' },
			query: { type: 'string', description: 'Optional query filter.' },
			max_items: { type: 'integer', description: 'Maximum number of entries to return.' },
		}),
		resultSchema: RESULT_SCHEMA_BASE,
		deprecated: {
			replacement: 'tracekeeper.recall with scope="project_history"',
		},
	},
	{
		name: 'tracekeeper.read_note',
		version: 1,
		visibility: 'public',
		capability: 'vault.read',
		risk: 'read-only',
		useCase: 'read_note',
		description:
			'[read-only] Read one vault note only after recall excerpts are not enough. Does not write files.',
		inputSchema: withVaultRoot({
			path: { type: 'string', description: 'Vault-relative note path.' },
		}, ['path']),
		resultSchema: RESULT_SCHEMA_BASE,
	},
	{
		name: 'tracekeeper.review_queue',
		version: 1,
		visibility: 'public',
		capability: 'memory.review',
		risk: 'read-only',
		useCase: 'review_queue',
		description:
			'[read-only] Inspect pending proposals or approved writeback candidates. Does not approve or apply changes.',
		inputSchema: withVaultRoot({
			action: {
				type: 'string',
				enum: ['list_pending', 'list_approved'],
				description: 'Review Queue action. Defaults to list_pending.',
			},
			scope: {
				type: 'string',
				description: 'Optional proposal kind or target-note prefix filter for approved proposals.',
			},
			max_items: { type: 'integer', description: 'Maximum number of entries to return.' },
			limit: { type: 'integer', description: 'Alias of max_items.' },
		}),
		resultSchema: RESULT_SCHEMA_BASE,
	},
	{
		name: 'tracekeeper.list_review_queue',
		version: 1,
		visibility: 'compatibility',
		capability: 'memory.review',
		risk: 'read-only',
		useCase: 'review_queue',
		description:
			'[deprecated] Use tracekeeper.review_queue with action="list_pending". Compatibility tool, read-only.',
		inputSchema: withVaultRoot({
			max_items: { type: 'integer', description: 'Maximum number of pending entries.' },
		}),
		resultSchema: RESULT_SCHEMA_BASE,
		deprecated: {
			replacement: 'tracekeeper.review_queue with action="list_pending"',
		},
	},
	{
		name: 'tracekeeper.list_source_requests',
		version: 1,
		visibility: 'compatibility',
		capability: 'vault.read',
		risk: 'read-only',
		useCase: 'source_request',
		description:
			'[deprecated] Use tracekeeper.source_request with action="list". Compatibility tool, read-only.',
		inputSchema: withVaultRoot({
			max_items: { type: 'integer', description: 'Maximum number of pending requests to return.' },
			status: { type: 'string', description: 'Optional status filter, defaults to pending.' },
			source_kind: { type: 'string', description: 'Optional source kind filter.' },
		}),
		resultSchema: RESULT_SCHEMA_BASE,
		deprecated: {
			replacement: 'tracekeeper.source_request with action="list"',
		},
	},
	{
		name: 'tracekeeper.list_approved_writebacks',
		version: 1,
		visibility: 'compatibility',
		capability: 'memory.review',
		risk: 'read-only',
		useCase: 'review_queue',
		description:
			'[deprecated] Use tracekeeper.review_queue with action="list_approved". Compatibility tool, read-only.',
		inputSchema: withVaultRoot({
			scope: { type: 'string', description: 'Optional proposal kind or target-note prefix filter.' },
			max_items: { type: 'integer', description: 'Maximum number of approved writebacks to return.' },
			limit: { type: 'integer', description: 'Alias of max_items.' },
		}),
		resultSchema: RESULT_SCHEMA_BASE,
		deprecated: {
			replacement: 'tracekeeper.review_queue with action="list_approved"',
		},
	},
	{
		name: 'tracekeeper.audit_recent',
		version: 1,
		visibility: 'compatibility',
		capability: 'vault.read',
		risk: 'read-only',
		useCase: 'audit_recent',
		description: '[deprecated] Prefer the Obsidian runtime log view. Compatibility tool, read-only.',
		inputSchema: withVaultRoot({
			max_items: { type: 'integer', description: 'Maximum number of parsed sections.' },
		}),
		resultSchema: RESULT_SCHEMA_BASE,
		deprecated: {
			replacement: 'Obsidian runtime log view',
		},
	},
	{
		name: 'tracekeeper.source_request',
		version: 1,
		visibility: 'public',
		capability: 'vault.write',
		risk: 'low-risk-write',
		useCase: 'source_request',
		description:
			'[read-only | low-risk write] List source requests or analyze one existing request. Does not fetch network content.',
		inputSchema: withVaultRoot({
			action: {
				type: 'string',
				enum: ['list', 'analyze'],
				description: 'Source request action. Defaults to list unless request_path/path is provided.',
			},
			request_path: { type: 'string', description: 'Vault-relative path to an agent-request note when action is analyze.' },
			path: { type: 'string', description: 'Alias of request_path.' },
			task_id: { type: 'string', description: 'Optional task id to update with generated source/proposal paths.' },
			update_request_status: {
				type: 'boolean',
				description: 'Whether to update request status to completed/failed. Defaults to true.',
			},
			force_reprocess: {
				type: 'boolean',
				description: 'Process request even if status is not pending.',
			},
			max_items: { type: 'integer', description: 'Maximum number of pending requests to return when listing.' },
			status: { type: 'string', description: 'Optional status filter when listing, defaults to pending.' },
			source_kind: { type: 'string', description: 'Optional source kind filter when listing.' },
		}),
		resultSchema: RESULT_SCHEMA_BASE,
	},
	{
		name: 'tracekeeper.analyze_source_request',
		version: 1,
		visibility: 'compatibility',
		capability: 'vault.write',
		risk: 'low-risk-write',
		useCase: 'source_request',
		description:
			'[deprecated] Use tracekeeper.source_request with action="analyze". Compatibility tool, low-risk write.',
		inputSchema: withVaultRoot({
			request_path: { type: 'string', description: 'Vault-relative path to an agent-request note.' },
			path: { type: 'string', description: 'Alias of request_path.' },
			task_id: { type: 'string', description: 'Optional task id to update with generated source/proposal paths.' },
			update_request_status: {
				type: 'boolean',
				description: 'Whether to update request status to completed/failed. Defaults to true.',
			},
			force_reprocess: { type: 'boolean', description: 'Process request even if status is not pending.' },
		}),
		resultSchema: RESULT_SCHEMA_BASE,
		deprecated: {
			replacement: 'tracekeeper.source_request with action="analyze"',
		},
	},
	{
		name: 'tracekeeper.apply_approved_writeback',
		version: 1,
		visibility: 'public',
		capability: 'memory.apply',
		risk: 'review-gated-write',
		useCase: 'apply_approved_writeback',
		description:
			'[review-gated apply] Use only after the user approves a Review Queue proposal. Appends approved content to the target note.',
		inputSchema: withVaultRoot({
			proposal_id: { type: 'string', description: 'Proposal id to apply.' },
			proposal_path: { type: 'string', description: 'Vault-relative proposal note path.' },
			path: { type: 'string', description: 'Alias of proposal_path.' },
			task_id: { type: 'string', description: 'Optional task id to update with the applied writeback target.' },
			dry_run: { type: 'boolean', description: 'When true, return the writeback plan without modifying files.' },
		}),
		resultSchema: RESULT_SCHEMA_BASE,
	},
	{
		name: 'tracekeeper.build_context_pack',
		version: 1,
		visibility: 'public',
		capability: 'workflow.manage',
		risk: 'low-risk-write',
		useCase: 'build_context_pack',
		description:
			'[read-only | optional write] Build a compact context pack from recall results. Writes an artifact only when write=true.',
		inputSchema: withVaultRoot({
			query: { type: 'string', description: 'Context pack query.' },
			task_id: { type: 'string', description: 'Optional task id for traceability.' },
			candidate_limit: { type: 'integer', description: 'How many matches to include.' },
			stale_after_days: { type: 'integer', description: 'Stale warning threshold in days.' },
			write: { type: 'boolean', description: 'Whether to write a markdown context-pack artifact.' },
			filename: { type: 'string', description: 'Optional file stem.' },
			title: { type: 'string', description: 'Optional note title when writing markdown artifact.' },
		}, ['query']),
		resultSchema: RESULT_SCHEMA_BASE,
	},
	{
		name: 'tracekeeper.lint',
		version: 1,
		visibility: 'public',
		capability: 'vault.read',
		risk: 'read-only',
		useCase: 'lint',
		description:
			'[read-only] Run the single vault check entry for structure, links, sources, claims, and graph health.',
		inputSchema: withVaultRoot({
			max_items: { type: 'integer', description: 'Maximum number of issues to return.' },
			graph_profile: {
				type: 'string',
				enum: ['off', 'advisory', 'strict'],
				description: 'Graph checking mode. Defaults to the server graphProfile setting.',
			},
		}),
		resultSchema: RESULT_SCHEMA_BASE,
	},
	{
		name: 'tracekeeper.finish_task',
		version: 1,
		visibility: 'public',
		capability: 'workflow.manage',
		risk: 'low-risk-write',
		useCase: 'finish_task',
		description:
			'[low-risk write] Required once at task closeout. Record the session and submit durable decisions, solution changes, lessons, preferences, next actions, and memory candidates according to memory rules.',
		inputSchema: withVaultRoot(
			{
				task_id: { type: 'string', description: 'Task id.' },
				summary: { type: 'string', description: 'Task summary.' },
				outcomes: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Optional outcomes.' },
				decisions: {
					oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
					description: 'Optional decisions.',
				},
				solution_changes: {
					oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
					description: 'Optional solution changes.',
				},
				lessons: {
					oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
					description: 'Optional lessons learned.',
				},
				preferences: {
					oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
					description: 'Optional user preferences.',
				},
				memory_candidates: {
					oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
					description: 'Optional memory candidates.',
				},
				next_actions: {
					oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
					description: 'Optional next actions.',
				},
				review_proposal_mode: {
					type: 'string',
					enum: ['off', 'suggest', 'review_queue', 'auto_propose'],
					description: 'Propose mode for closeout fields.',
				},
				client: { type: 'string', description: 'Optional client context.' },
				project_hint: { type: 'string', description: 'Optional project hint.' },
				memory_scope: { type: 'string', enum: ['global', 'project'], description: 'Optional memory scope override.' },
				related_wiki: {
					oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
					description: 'Optional related wiki note references.',
				},
				related_sources: {
					oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
					description: 'Optional related sources.',
				},
				filename: { type: 'string', description: 'Optional file stem.' },
				idempotency_key: {
					type: 'string',
					description: 'Optional stable retry key. Reusing it with different closeout content is rejected.',
				},
			},
			['task_id', 'summary'],
		),
		resultSchema: RESULT_SCHEMA_BASE,
	},
	{
		name: 'tracekeeper.distill_session',
		version: 1,
		visibility: 'compatibility',
		capability: 'workflow.manage',
		risk: 'low-risk-write',
		useCase: 'finish_task',
		description: '[deprecated] Use tracekeeper.finish_task. Compatibility tool for older session distillation flows.',
		inputSchema: withVaultRoot({
			task_id: { type: 'string', description: 'Task id.' },
			summary: { type: 'string', description: 'Session summary.' },
			decisions: {
				oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
				description: 'Session decisions.',
			},
			next_actions: {
				oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
				description: 'Optional next actions.',
			},
			possible_preferences: {
				oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
				description: 'Possible preferences.',
			},
			outcomes: {
				oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
				description: 'Optional outcomes.',
			},
			project_hint: { type: 'string', description: 'Optional project hint.' },
			filename: { type: 'string', description: 'Optional file stem.' },
		}, ['task_id', 'summary']),
		resultSchema: RESULT_SCHEMA_BASE,
		deprecated: {
			replacement: 'tracekeeper.finish_task',
		},
	},
	{
		name: 'tracekeeper.write_context_pack',
		version: 1,
		visibility: 'compatibility',
		capability: 'workflow.manage',
		risk: 'low-risk-write',
		useCase: 'build_context_pack',
		description:
			'[deprecated] Use tracekeeper.build_context_pack with write=true. Compatibility tool, low-risk write.',
		inputSchema: withVaultRoot({
			filename: { type: 'string', description: 'Optional file stem. If omitted, auto-generates one.' },
			title: { type: 'string', description: 'Optional note title.' },
			content: { type: 'string', description: 'Context pack markdown/text content.' },
			task_id: { type: 'string', description: 'Optional task id for traceability.' },
		}, ['content']),
		resultSchema: RESULT_SCHEMA_BASE,
		deprecated: {
			replacement: 'tracekeeper.build_context_pack with write=true',
		},
	},
	{
		name: 'tracekeeper.write_session_note',
		version: 1,
		visibility: 'compatibility',
		capability: 'workflow.manage',
		risk: 'low-risk-write',
		useCase: 'finish_task',
		description: '[deprecated] Use tracekeeper.finish_task. Compatibility tool, low-risk write.',
		inputSchema: withVaultRoot({
			filename: { type: 'string', description: 'Optional file stem. If omitted, auto-generates one.' },
			content: { type: 'string', description: 'Session content.' },
			task_id: { type: 'string', description: 'Optional task id for traceability.' },
		}, ['content']),
		resultSchema: RESULT_SCHEMA_BASE,
		deprecated: {
			replacement: 'tracekeeper.finish_task',
		},
	},
	{
		name: 'tracekeeper.capture_source',
		version: 1,
		visibility: 'public',
		capability: 'vault.write',
		risk: 'low-risk-write',
		useCase: 'capture_source',
		description:
			'[low-risk write] Save user-provided source metadata or content under sources. Does not fetch external content.',
		inputSchema: withVaultRoot(
			{
				source: { type: 'string', description: 'Source identifier (usually URL or local path).' },
				source_kind: { type: 'string', description: 'Source type label (optional).' },
				capture_reason: { type: 'string', description: 'Capture reason.' },
				task_id: { type: 'string', description: 'Optional task id for traceability.' },
				related_project: { type: 'string', description: 'Optional project hint.' },
				mode: {
					type: 'string',
					enum: ['external_reference', 'extracted_snapshot', 'local_copy'],
					description: 'Capture mode.',
				},
				filename: { type: 'string', description: 'Optional file stem. If omitted, auto-generates one.' },
				title: { type: 'string', description: 'Optional source note title.' },
				content: { type: 'string', description: 'Required when mode is extracted_snapshot or local_copy.' },
				text: { type: 'string', description: 'Alias of content for compatibility.' },
			},
			['source', 'mode'],
		),
		resultSchema: RESULT_SCHEMA_BASE,
	},
	{
		name: 'tracekeeper.propose_memory',
		version: 1,
		visibility: 'public',
		capability: 'memory.propose',
		risk: 'low-risk-write',
		useCase: 'propose_memory',
		description:
			'[low-risk write] Submit a memory update through Tracekeeper rules. Global memory stays review-gated by default.',
		inputSchema: withVaultRoot(
			{
				proposal_kind: { type: 'string', description: 'Proposal kind.' },
				content: { type: 'string', description: 'Proposal markdown/text content.' },
				evidence: { type: 'string', description: 'Optional evidence summary.' },
				target_note: { type: 'string', description: 'Optional target note path.' },
				risk_level: { type: 'string', description: 'Risk level label.' },
				task_id: { type: 'string', description: 'Optional task id for traceability.' },
				project_hint: { type: 'string', description: 'Optional project hint for project memory routing.' },
				memory_scope: { type: 'string', enum: ['global', 'project'], description: 'Optional memory scope override.' },
				related_wiki: {
					oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
					description: 'Optional related wiki note references.',
				},
				related_sources: {
					oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
					description: 'Optional related sources.',
				},
				filename: { type: 'string', description: 'Optional file stem. If omitted, auto-generates one.' },
				title: { type: 'string', description: 'Optional proposal title.' },
			},
			['proposal_kind', 'content'],
		),
		resultSchema: RESULT_SCHEMA_BASE,
	},
] as const satisfies readonly ToolContract<TracekeeperToolName>[];

type ContractByName = {
	readonly [K in TracekeeperToolName]: ToolContract<K>;
};

const contractMap = new Map<TracekeeperToolName, ToolContract<TracekeeperToolName>>();
for (const contract of toolContracts) {
	contractMap.set(contract.name, contract);
}

export const compatibilityToolNames = compatibilityFallbackTools.map((entry) => entry.name);

export function isPublicTool(name: string): name is PublicToolName {
	return PUBLIC_TOOL_NAME_ORDER.includes(name as PublicToolName);
}

export function isCompatibilityTool(name: string): name is Exclude<TracekeeperToolName, PublicToolName> {
	return compatibilityToolNameSet.has(name as Exclude<TracekeeperToolName, PublicToolName>);
}

export function getContractByName(name: string): ToolContract<TracekeeperToolName> | undefined {
	return contractMap.get(name as TracekeeperToolName);
}

export function getContractNamesByVisibility(visibility: ToolVisibility): TracekeeperToolName[] {
	return toolContracts.filter((contract) => contract.visibility === visibility).map((contract) => contract.name);
}

export const publicContracts: readonly ToolContract<TracekeeperToolName>[] = PUBLIC_TOOL_NAME_ORDER.map(
	(name) => contractMap.get(name),
).filter((contract): contract is ToolContract<TracekeeperToolName> => Boolean(contract));

export { type ContractByName };
