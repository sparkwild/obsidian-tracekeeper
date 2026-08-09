import type { ToolCapability, TracekeeperToolName } from './contracts';
export declare const AGENT_ACTION_KINDS: readonly ["tool_call", "user_review", "report_status", "stop"];
export type AgentActionKind = (typeof AGENT_ACTION_KINDS)[number];
export declare const AGENT_ACTION_TIMINGS: readonly ["immediate", "if_context_insufficient", "at_task_closeout", "after_user_approval", "next_session"];
export type AgentActionTiming = (typeof AGENT_ACTION_TIMINGS)[number];
export declare const AGENT_ACTION_REASON_CODES: readonly ["TASK_CONTEXT_REQUIRED", "TASK_CLOSEOUT_REQUIRED", "RECALL_EXCERPT_MAY_BE_INSUFFICIENT", "RECALL_ZERO_MATCH", "PROJECT_SCOPE_UNCERTAIN", "INDEX_REBUILDING", "PERMISSION_DENIED", "MEMORY_REVIEW_REQUIRED", "MEMORY_RECORDED", "MEMORY_NOT_PERSISTED", "USER_REVIEW_REQUIRED", "PROPOSAL_PENDING", "FINISH_ALREADY_COMPLETED", "IDEMPOTENCY_CONFLICT", "TOOL_UNAVAILABLE"];
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
export declare const AGENT_ACTION_SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly action_id: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly kind: {
            readonly type: "string";
            readonly enum: readonly ["tool_call", "user_review", "report_status", "stop"];
        };
        readonly tool: {
            readonly type: "string";
        };
        readonly arguments: {
            readonly type: "object";
            readonly additionalProperties: true;
        };
        readonly priority: {
            readonly type: "integer";
            readonly minimum: 0;
        };
        readonly required: {
            readonly type: "boolean";
        };
        readonly timing: {
            readonly type: "string";
            readonly enum: readonly ["immediate", "if_context_insufficient", "at_task_closeout", "after_user_approval", "next_session"];
        };
        readonly reason_code: {
            readonly type: "string";
            readonly enum: readonly ["TASK_CONTEXT_REQUIRED", "TASK_CLOSEOUT_REQUIRED", "RECALL_EXCERPT_MAY_BE_INSUFFICIENT", "RECALL_ZERO_MATCH", "PROJECT_SCOPE_UNCERTAIN", "INDEX_REBUILDING", "PERMISSION_DENIED", "MEMORY_REVIEW_REQUIRED", "MEMORY_RECORDED", "MEMORY_NOT_PERSISTED", "USER_REVIEW_REQUIRED", "PROPOSAL_PENDING", "FINISH_ALREADY_COMPLETED", "IDEMPOTENCY_CONFLICT", "TOOL_UNAVAILABLE"];
        };
        readonly reason: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly capability_required: {
            readonly type: "string";
            readonly enum: readonly ["vault.read", "vault.write", "memory.propose", "memory.apply", "memory.review", "workflow.manage", "review-gated.apply"];
        };
        readonly parent_action_id: {
            readonly type: "string";
        };
    };
    readonly required: readonly ["action_id", "kind", "priority", "required", "timing", "reason_code", "reason"];
    readonly additionalProperties: false;
    readonly description: "AgentAction envelope for structured next actions.";
};
