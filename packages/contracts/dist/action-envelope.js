"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_ACTION_SCHEMA = exports.AGENT_ACTION_REASON_CODES = exports.AGENT_ACTION_TIMINGS = exports.AGENT_ACTION_KINDS = void 0;
exports.AGENT_ACTION_KINDS = ['tool_call', 'user_review', 'report_status', 'stop'];
exports.AGENT_ACTION_TIMINGS = ['immediate', 'if_context_insufficient', 'at_task_closeout', 'after_user_approval', 'next_session'];
exports.AGENT_ACTION_REASON_CODES = [
    'TASK_CONTEXT_REQUIRED',
    'TASK_CLOSEOUT_REQUIRED',
    'RECALL_EXCERPT_MAY_BE_INSUFFICIENT',
    'RECALL_ZERO_MATCH',
    'PROJECT_SCOPE_UNCERTAIN',
    'INDEX_REBUILDING',
    'PERMISSION_DENIED',
    'MEMORY_REVIEW_REQUIRED',
    'MEMORY_RECORDED',
    'USER_REVIEW_REQUIRED',
    'PROPOSAL_PENDING',
    'FINISH_ALREADY_COMPLETED',
    'IDEMPOTENCY_CONFLICT',
    'TOOL_UNAVAILABLE',
];
exports.AGENT_ACTION_SCHEMA = {
    type: 'object',
    properties: {
        action_id: { type: 'string', minLength: 1 },
        kind: {
            type: 'string',
            enum: exports.AGENT_ACTION_KINDS,
        },
        tool: { type: 'string' },
        arguments: { type: 'object', additionalProperties: true },
        priority: { type: 'integer', minimum: 0 },
        required: { type: 'boolean' },
        timing: {
            type: 'string',
            enum: exports.AGENT_ACTION_TIMINGS,
        },
        reason_code: {
            type: 'string',
            enum: exports.AGENT_ACTION_REASON_CODES,
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
};
