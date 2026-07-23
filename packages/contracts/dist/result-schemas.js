"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERIC_TOOL_OUTPUT_SCHEMA = exports.FINISH_TASK_OUTPUT_SCHEMA = exports.RECALL_OUTPUT_SCHEMA = exports.START_TASK_OUTPUT_SCHEMA = exports.FINISH_TASK_SUCCESS_OUTPUT_SCHEMA = exports.RECALL_SUCCESS_OUTPUT_SCHEMA = exports.START_TASK_SUCCESS_OUTPUT_SCHEMA = exports.COMMON_TOOL_FAILURE_OUTPUT_SCHEMA = exports.COMMON_TOOL_SUCCESS_OUTPUT_SCHEMA = exports.SCHEMA_VERSION = void 0;
const action_envelope_1 = require("./action-envelope");
exports.SCHEMA_VERSION = 2;
exports.COMMON_TOOL_SUCCESS_OUTPUT_SCHEMA = {
    type: 'object',
    required: ['schema_version', 'ok', 'tool'],
    properties: {
        schema_version: { const: exports.SCHEMA_VERSION, type: 'integer' },
        ok: { const: true, type: 'boolean' },
        tool: { type: 'string', minLength: 1 },
    },
    description: 'Common successful MCP envelope for Tracekeeper tools.',
    additionalProperties: true,
};
exports.COMMON_TOOL_FAILURE_OUTPUT_SCHEMA = {
    type: 'object',
    required: ['schema_version', 'ok', 'tool', 'error', 'error_detail'],
    properties: {
        schema_version: { const: exports.SCHEMA_VERSION, type: 'integer' },
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
const PROJECT_IDENTITY_OUTPUT_SCHEMA = {
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
exports.START_TASK_SUCCESS_OUTPUT_SCHEMA = {
    type: 'object',
    allOf: [
        exports.COMMON_TOOL_SUCCESS_OUTPUT_SCHEMA,
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
                memory_closeout_summary: { type: 'string' },
                next_actions: { type: 'array', items: action_envelope_1.AGENT_ACTION_SCHEMA },
                next_actions_for_agent: { type: 'array', items: { type: 'string' } },
                recommended_next_actions: { type: 'array', items: { type: 'string' } },
            },
        },
    ],
    additionalProperties: true,
};
exports.RECALL_SUCCESS_OUTPUT_SCHEMA = {
    type: 'object',
    allOf: [
        exports.COMMON_TOOL_SUCCESS_OUTPUT_SCHEMA,
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
                        scope: { type: 'string', enum: ['global', 'project', 'project_history'] },
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
                        required: ['path', 'content_origin', 'instruction_trust'],
                        properties: {
                            path: { type: 'string', minLength: 1 },
                            content_origin: {
                                type: 'string',
                                enum: ['captured_source', 'tracekeeper_generated', 'vault_note'],
                            },
                            instruction_trust: { const: 'data_only', type: 'string' },
                        },
                        additionalProperties: true,
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
                next_actions: { type: 'array', items: action_envelope_1.AGENT_ACTION_SCHEMA },
                next_actions_for_agent: { type: 'array', items: { type: 'string' } },
                recommended_actions: { type: 'array', items: { type: 'string' } },
                remembered_scope: { type: 'string' },
            },
        },
    ],
    additionalProperties: true,
};
exports.FINISH_TASK_SUCCESS_OUTPUT_SCHEMA = {
    type: 'object',
    allOf: [
        exports.COMMON_TOOL_SUCCESS_OUTPUT_SCHEMA,
        {
            required: ['workflow', 'memory', 'memory_closeout_state', 'next_actions'],
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
                memory_closeout_state: {
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
                memory_closeout_summary: { type: 'string' },
                next_actions: { type: 'array', items: action_envelope_1.AGENT_ACTION_SCHEMA },
                next_actions_for_agent: { type: 'array', items: { type: 'string' } },
                recommended_memory_actions: { type: 'array', items: { type: 'string' } },
            },
        },
    ],
    additionalProperties: true,
};
exports.START_TASK_OUTPUT_SCHEMA = {
    type: 'object',
    oneOf: [exports.START_TASK_SUCCESS_OUTPUT_SCHEMA, exports.COMMON_TOOL_FAILURE_OUTPUT_SCHEMA],
};
exports.RECALL_OUTPUT_SCHEMA = {
    type: 'object',
    oneOf: [exports.RECALL_SUCCESS_OUTPUT_SCHEMA, exports.COMMON_TOOL_FAILURE_OUTPUT_SCHEMA],
};
exports.FINISH_TASK_OUTPUT_SCHEMA = {
    type: 'object',
    oneOf: [exports.FINISH_TASK_SUCCESS_OUTPUT_SCHEMA, exports.COMMON_TOOL_FAILURE_OUTPUT_SCHEMA],
};
exports.GENERIC_TOOL_OUTPUT_SCHEMA = {
    type: 'object',
    oneOf: [exports.COMMON_TOOL_SUCCESS_OUTPUT_SCHEMA, exports.COMMON_TOOL_FAILURE_OUTPUT_SCHEMA],
};
