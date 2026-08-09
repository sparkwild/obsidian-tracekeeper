import type { ToolCapability, TracekeeperToolName } from './contracts';

export const AGENT_ACTION_KINDS = ['tool_call', 'user_review', 'report_status', 'stop'] as const;
export type AgentActionKind = (typeof AGENT_ACTION_KINDS)[number];

export const AGENT_ACTION_TIMINGS = ['immediate', 'if_context_insufficient', 'at_task_closeout', 'after_user_approval', 'next_session'] as const;
export type AgentActionTiming = (typeof AGENT_ACTION_TIMINGS)[number];

export const AGENT_ACTION_REASON_CODES = [
	'TASK_CONTEXT_REQUIRED',
	'TASK_CLOSEOUT_REQUIRED',
	'RECALL_EXCERPT_MAY_BE_INSUFFICIENT',
	'RECALL_ZERO_MATCH',
	'PROJECT_SCOPE_UNCERTAIN',
	'INDEX_REBUILDING',
	'PERMISSION_DENIED',
	'MEMORY_REVIEW_REQUIRED',
	'MEMORY_RECORDED',
	'MEMORY_NOT_PERSISTED',
	'USER_REVIEW_REQUIRED',
	'PROPOSAL_PENDING',
	'FINISH_ALREADY_COMPLETED',
	'IDEMPOTENCY_CONFLICT',
	'TOOL_UNAVAILABLE',
] as const;
export type AgentActionReasonCode = (typeof AGENT_ACTION_REASON_CODES)[number];

export type AgentAction = {
	readonly action_id: string;
	readonly kind: AgentActionKind;
	readonly tool?: TracekeeperToolName;
	readonly arguments?: Record<string, unknown>;
	readonly priority: number;
	readonly required: boolean;
	readonly timing: AgentActionTiming;
	readonly reason_code: AgentActionReasonCode;
	readonly reason: string;
	readonly capability_required?: ToolCapability;
};

export type AgentActionSchema = {
	readonly type: 'object';
	readonly properties: Record<string, unknown>;
	readonly required: readonly string[];
};

export const AGENT_ACTION_SCHEMA = {
	type: 'object',
	properties: {
		action_id: { type: 'string', minLength: 1 },
		kind: {
			type: 'string',
			enum: AGENT_ACTION_KINDS,
		},
		tool: { type: 'string' },
		arguments: { type: 'object', additionalProperties: true },
		priority: { type: 'integer', minimum: 0 },
		required: { type: 'boolean' },
		timing: {
			type: 'string',
			enum: AGENT_ACTION_TIMINGS,
		},
		reason_code: {
			type: 'string',
			enum: AGENT_ACTION_REASON_CODES,
		},
		reason: { type: 'string', minLength: 1 },
		capability_required: {
			type: 'string',
			enum: ['vault.read', 'vault.write', 'memory.propose', 'memory.apply', 'memory.review', 'workflow.manage', 'review-gated.apply'],
		},
		parent_action_id: { type: 'string' },
	},
	required: ['action_id', 'kind', 'priority', 'required', 'timing', 'reason_code', 'reason'],
	additionalProperties: false,
	description: 'AgentAction envelope for structured next actions.',
} as const;
