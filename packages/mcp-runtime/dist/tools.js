"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCAL_TRUST_CAPABILITIES = exports.LOCAL_TRUST_PRINCIPAL_ID = void 0;
exports.readMergedAuditSections = readMergedAuditSections;
exports.appendConnectionAuditEvent = appendConnectionAuditEvent;
exports.appendRuntimeDiagnosticAuditEvent = appendRuntimeDiagnosticAuditEvent;
exports.recordToolCallAuditEvent = recordToolCallAuditEvent;
exports.recordRejectedToolCallAuditEvent = recordRejectedToolCallAuditEvent;
exports.toolDefinitions = toolDefinitions;
exports.toolPrompts = toolPrompts;
exports.callTool = callTool;
exports.recoverPendingOperations = recoverPendingOperations;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const crypto = __importStar(require("node:crypto"));
const core_1 = require("@tracekeeper/core");
const contracts_1 = require("@tracekeeper/contracts");
const protocol_1 = require("./protocol");
const result_validation_1 = require("./result-validation");
const safety_1 = require("./safety");
const apply_approved_writeback_1 = require("./application/apply-approved-writeback");
const project_identity_1 = require("./application/project-identity");
const project_memory_1 = require("./application/project-memory");
const recall_1 = require("./application/recall");
const observed_client_1 = require("./observed-client");
exports.LOCAL_TRUST_PRINCIPAL_ID = 'local-user';
exports.LOCAL_TRUST_CAPABILITIES = [
    'vault.read',
    'workflow.manage',
    'vault.write',
    'memory.propose',
];
const REVIEW_QUEUE_PREFIX = core_1.TRACEKEEPER_REVIEW_QUEUE_DIR;
const AUDIT_LOG_PATH = core_1.TRACEKEEPER_AUDIT_LOG_PATH;
const AUDIT_DIR = core_1.TRACEKEEPER_AUDIT_DIR;
const AUDIT_HUB_PATH = `${core_1.TRACEKEEPER_AUDIT_DIR}/index.md`;
const AUDIT_SCHEMA_VERSION = 3;
const MAX_LIST_QUEUE_ITEMS = 20;
const MAX_AUDIT_ITEMS = 20;
const MAX_AUDIT_SCALAR_LENGTH = 240;
const MAX_AUDIT_ARRAY_ITEMS = 12;
const MAX_AUDIT_METADATA_FIELDS = 32;
const MAX_APPROVED_WRITEBACKS = 20;
const MAX_PROJECT_TOOL_ITEMS = 20;
const CONTEXT_PACK_DIR = core_1.TRACEKEEPER_CONTEXT_PACKS_DIR;
const SESSION_NOTE_DIR = core_1.TRACEKEEPER_SESSIONS_DIR;
const AGENT_TASK_DIR = core_1.TRACEKEEPER_TASKS_DIR;
const PROJECT_MEMORY_DIRS = [core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR, '05_projects', '04_projects'];
const PROJECT_MEMORY_READ_DIRS = PROJECT_MEMORY_DIRS;
const GLOBAL_MEMORY_DIRS = [core_1.KNOWLEDGE_GLOBAL_MEMORY_DIR, '04_memory', '05_memory'];
const SOURCE_REQUESTS_DIR = core_1.TRACEKEEPER_AGENT_REQUESTS_DIR;
const SOURCES_DIR = core_1.KNOWLEDGE_SOURCES_DIR;
const SOURCE_ANALYSIS_REPORT_DIR = core_1.TRACEKEEPER_SOURCE_ANALYSIS_DIR;
const MEMORY_PROPOSAL_DIR = core_1.TRACEKEEPER_REVIEW_QUEUE_DIR;
const MAX_SOURCE_EXCERPT_LENGTH = 1000;
const MAX_RECALL_RELATIONS = 8;
const DEFAULT_FINISH_TASK_REVIEW_MODE = 'auto_propose';
function normalizeContentLanguage(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized === 'zh' || normalized.startsWith('zh-') || normalized.startsWith('zh_') ? 'zh-CN' : 'en';
}
function normalizeContentLanguageSource(value) {
    switch (value) {
        case 'setting':
        case 'obsidian':
        case 'navigator':
        case 'fallback':
            return value;
        default:
            return 'fallback';
    }
}
function contentLanguageFromContext(context) {
    return normalizeContentLanguage(context.contentLanguage);
}
function contentLanguageSourceFromContext(context) {
    return normalizeContentLanguageSource(context.contentLanguageSource);
}
function contentText(context, zh, en) {
    return contentLanguageFromContext(context) === 'zh-CN' ? zh : en;
}
const TRACEKEEPER_TOOL_CONTRACTS = contracts_1.toolContracts;
const READ_ONLY_TOOL_NAMES = new Set(TRACEKEEPER_TOOL_CONTRACTS.filter((contract) => contract.risk === 'read-only').map((contract) => contract.name));
const REVIEW_GATED_TOOL_NAMES = new Set(TRACEKEEPER_TOOL_CONTRACTS.filter((contract) => contract.risk === 'review-gated-write').map((contract) => contract.name));
const LOW_RISK_TOOL_NAMES = new Set(TRACEKEEPER_TOOL_CONTRACTS.filter((contract) => contract.risk === 'low-risk-write').map((contract) => contract.name));
const SENSITIVE_KEY_PATTERNS = [
    /token/i,
    /secret/i,
    /api[_-]?key/i,
    /password/i,
    /cookie/i,
    /authorization/i,
    /access[_-]?token/i,
    /refresh[_-]?token/i,
];
const MAX_ARGS_SUMMARY_LENGTH = 512;
const TOOL_NAME_SET = new Set(TRACEKEEPER_TOOL_CONTRACTS.map((contract) => contract.name));
const DEPRECATED_TOOL_REPLACEMENTS = Object.fromEntries(TRACEKEEPER_TOOL_CONTRACTS
    .filter((contract) => Boolean(contract.deprecated))
    .map((contract) => [contract.name, contract.deprecated?.replacement || '']));
const TOOL_CONTRACT_BY_NAME = new Map(TRACEKEEPER_TOOL_CONTRACTS.map((contract) => [contract.name, contract]));
function isToolName(value) {
    return TOOL_NAME_SET.has(value);
}
function buildFinishTaskCloseoutGroups(closeout, context) {
    return [
        {
            kind: 'task_decision',
            label: contentText(context, '任务决策', 'Task Decisions'),
            values: normalizeFinishTaskProposalValues(closeout.decisions),
        },
        {
            kind: 'solution_change',
            label: contentText(context, '方案调整', 'Solution Changes'),
            values: normalizeFinishTaskProposalValues(closeout.solution_changes),
        },
        {
            kind: 'lesson_learned',
            label: contentText(context, '经验教训', 'Lessons'),
            values: normalizeFinishTaskProposalValues(closeout.lessons),
        },
        {
            kind: 'user_preference',
            label: contentText(context, '用户偏好', 'User Preferences'),
            values: normalizeFinishTaskProposalValues(closeout.preferences),
        },
        {
            kind: 'project_next_action',
            label: contentText(context, '项目下一步', 'Project Next Actions'),
            values: normalizeFinishTaskProposalValues(closeout.next_actions),
        },
        {
            kind: 'memory_candidate',
            label: contentText(context, '记忆候选', 'Memory Candidates'),
            values: normalizeFinishTaskProposalValues(closeout.memory_candidates),
        },
    ];
}
function buildProposeMemoryRequestSnapshot(rawArgs) {
    return {
        proposal_kind: coerceNonEmptyString(rawArgs.proposal_kind, true, 'proposal_kind'),
        content: coerceNonEmptyString(rawArgs.content, true, 'content'),
        evidence: coerceOptionalString(rawArgs.evidence) || null,
        target_note: coerceOptionalString(rawArgs.target_note) || null,
        risk_level: coerceOptionalString(rawArgs.risk_level) || null,
        task_id: coerceOptionalString(rawArgs.task_id) || null,
        filename: coerceOptionalString(rawArgs.filename) || null,
        title: coerceOptionalString(rawArgs.title) || null,
        project_hint: coerceOptionalString(rawArgs.project_hint) || null,
        project_id: coerceOptionalString(rawArgs.project_id) || null,
        repo_path: coerceOptionalString(rawArgs.repo_path) || null,
        repo: coerceOptionalString(rawArgs.repo) || null,
        project_path: coerceOptionalString(rawArgs.project_path) || null,
        memory_scope: coerceOptionalString(rawArgs.memory_scope) || null,
        related_wiki: normalizeMultiValueList(rawArgs.related_wiki, 'related_wiki'),
        related_sources: normalizeMultiValueList(rawArgs.related_sources, 'related_sources'),
    };
}
function isProposeMemoryOperationPayload(payload) {
    if (!(0, protocol_1.isRecord)(payload) || !(0, protocol_1.isRecord)(payload.requestSnapshot)) {
        return false;
    }
    return typeof payload.requestHash === 'string'
        && payload.requestHash.length > 0
        && typeof payload.requestSnapshot.proposal_kind === 'string'
        && payload.requestSnapshot.proposal_kind.length > 0
        && typeof payload.requestSnapshot.content === 'string'
        && payload.requestSnapshot.content.length > 0
        && Array.isArray(payload.requestSnapshot.related_wiki)
        && payload.requestSnapshot.related_wiki.every((value) => typeof value === 'string')
        && Array.isArray(payload.requestSnapshot.related_sources)
        && payload.requestSnapshot.related_sources.every((value) => typeof value === 'string')
        && typeof payload.projectMemoryCreatedAt === 'string'
        && !Number.isNaN(Date.parse(payload.projectMemoryCreatedAt))
        && typeof payload.projectMemoryAgentType === 'string'
        && payload.projectMemoryAgentType.length > 0;
}
function getRecordValue(record, key) {
    return (0, protocol_1.isRecord)(record) ? record[key] : undefined;
}
function addTrimmedTarget(targets, value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
            targets.add(trimmed);
        }
    }
}
function truncateSummaryText(value, maxLength = 900) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
function summarizeToolPayload(payload, isError) {
    if (isError) {
        return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    }
    if (!(0, protocol_1.isRecord)(payload)) {
        return truncateSummaryText(typeof payload === 'string' ? payload : 'Tracekeeper MCP tool completed.');
    }
    const summaryParts = [];
    const keys = [
        'ok',
        'read_only',
        'tool',
        'action',
        'scope_mode',
        'review_proposal_mode',
        'task_id',
        'project_id',
        'path',
        'matched_count',
        'total_matches',
        'total',
        'count',
        'complete',
        'generation',
        'issue_count',
        'proposal_count',
        'suggestion_count',
        'auto_applied_count',
    ];
    for (const key of keys) {
        const value = payload[key];
        if (value === undefined || value === null || Array.isArray(value) || (0, protocol_1.isRecord)(value)) {
            continue;
        }
        summaryParts.push(`${key}=${String(value)}`);
    }
    if (payload.tool === 'tracekeeper.project_memory'
        && (0, protocol_1.isRecord)(payload.page)) {
        const pageSize = payload.page.page_size;
        const hasNextPage = typeof payload.page.next_cursor === 'string'
            && payload.page.next_cursor.length > 0;
        if (typeof pageSize === 'number'
            && Number.isFinite(pageSize)) {
            summaryParts.push(`page_size=${pageSize}`);
        }
        summaryParts.push(`has_next_page=${String(hasNextPage)}`);
    }
    const nextActions = Array.isArray(payload.next_actions_for_agent)
        ? payload.next_actions_for_agent
            .filter((item) => typeof item === 'string' && item.trim().length > 0)
            .slice(0, 2)
        : [];
    const base = summaryParts.length > 0 ? summaryParts.join(' | ') : 'Tracekeeper MCP tool completed.';
    return truncateSummaryText([base, ...nextActions].join('\n'));
}
function buildWorkflowAuditMetadata(toolName, args, payload) {
    if (!(0, protocol_1.isRecord)(payload)) {
        return {};
    }
    const workflow = (0, protocol_1.isRecord)(payload.workflow) ? payload.workflow : {};
    const recall = (0, protocol_1.isRecord)(payload.recall) ? payload.recall : {};
    const nextAction = Array.isArray(payload.next_actions) && (0, protocol_1.isRecord)(payload.next_actions[0])
        ? payload.next_actions[0]
        : {};
    const taskId = typeof payload.task_id === 'string'
        ? payload.task_id
        : typeof workflow.task_id === 'string'
            ? workflow.task_id
            : typeof args.task_id === 'string'
                ? args.task_id
                : '';
    const recallId = typeof recall.recall_id === 'string'
        ? recall.recall_id
        : typeof payload.recall_id === 'string'
            ? payload.recall_id
            : typeof args.recall_id === 'string'
                ? args.recall_id
                : '';
    const workflowMode = typeof workflow.mode === 'string'
        ? workflow.mode
        : toolName === 'tracekeeper.recall'
            ? 'recall_only_or_tracked'
            : '';
    return {
        workflow_contract_version: contracts_1.SCHEMA_VERSION,
        result_schema_version: typeof payload.schema_version === 'number' ? payload.schema_version : undefined,
        workflow_mode: workflowMode || undefined,
        workflow_id: taskId || recallId || undefined,
        task_id: taskId || undefined,
        recall_id: recallId || undefined,
        action_id: typeof nextAction.action_id === 'string' ? nextAction.action_id : undefined,
        action_reason_code: typeof nextAction.reason_code === 'string' ? nextAction.reason_code : undefined,
        snapshot_generation: typeof recall.snapshot_generation === 'number'
            ? recall.snapshot_generation
            : typeof payload.snapshot_generation === 'number'
                ? payload.snapshot_generation
                : undefined,
        scope_mode: typeof recall.scope === 'string'
            ? recall.scope
            : typeof payload.scope_mode === 'string'
                ? payload.scope_mode
                : undefined,
        scope_confidence: typeof recall.scope_confidence === 'number' ? recall.scope_confidence : undefined,
        matched_count: typeof recall.matched_count === 'number'
            ? recall.matched_count
            : typeof payload.matched_count === 'number'
                ? payload.matched_count
                : undefined,
        memory_closeout_status: typeof payload.memory_closeout_state === 'string'
            ? payload.memory_closeout_state
            : typeof payload.memory_closeout_status === 'string'
                ? payload.memory_closeout_status
                : undefined,
    };
}
function toolResult(payload, isError = false) {
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(payload) ?? 'null',
            },
        ],
        structuredContent: payload,
        isError,
    };
}
function toolError(message) {
    return toolResult({ ok: false, error: message }, true);
}
function hasCredentialCapability(context, capability) {
    const capabilities = context.credentialCapabilities;
    return Boolean(capabilities?.includes('*') || capabilities?.includes(capability));
}
function actionBaseId(payload, fallback) {
    for (const key of ['operation_id', 'recall_id', 'task_id']) {
        const value = payload[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return fallback;
}
function buildStartTaskActions(payload, context) {
    const actions = [];
    const baseId = actionBaseId(payload, 'start-task');
    const recommendedRecall = (0, protocol_1.isRecord)(payload.recommended_recall) ? payload.recommended_recall : null;
    const recallArguments = recommendedRecall && (0, protocol_1.isRecord)(recommendedRecall.arguments)
        ? recommendedRecall.arguments
        : null;
    if (recallArguments && hasCredentialCapability(context, 'vault.read')) {
        actions.push({
            action_id: `${baseId}:recall`,
            kind: 'tool_call',
            tool: 'tracekeeper.recall',
            arguments: recallArguments,
            priority: 100,
            required: true,
            timing: 'immediate',
            reason_code: 'TASK_CONTEXT_REQUIRED',
            reason: 'Recall scoped local context before reading individual notes.',
            capability_required: 'vault.read',
        });
    }
    else if (!hasCredentialCapability(context, 'vault.read')) {
        actions.push({
            action_id: `${baseId}:recall-unavailable`,
            kind: 'report_status',
            priority: 100,
            required: true,
            timing: 'immediate',
            reason_code: 'PERMISSION_DENIED',
            reason: 'This principal cannot recall local context; continue without claiming that memory was loaded.',
        });
    }
    if (hasCredentialCapability(context, 'workflow.manage') && typeof payload.task_id === 'string') {
        actions.push({
            action_id: `${baseId}:finish`,
            kind: 'tool_call',
            tool: 'tracekeeper.finish_task',
            arguments: { task_id: payload.task_id },
            priority: 90,
            required: true,
            timing: 'at_task_closeout',
            reason_code: 'TASK_CLOSEOUT_REQUIRED',
            reason: 'Close the tracked task exactly once with a useful summary and durable closeout fields.',
            capability_required: 'workflow.manage',
        });
    }
    return actions;
}
function firstRecallMatchPath(matches) {
    for (const match of matches) {
        if (!(0, protocol_1.isRecord)(match)) {
            continue;
        }
        for (const key of ['path', 'note_path']) {
            const value = match[key];
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
    }
    return '';
}
function buildRecallActions(payload, context, recallId, scope, matches) {
    if (payload.index_state === 'rebuilding') {
        return [{
                action_id: `${recallId}:index-rebuilding`,
                kind: 'stop',
                priority: 100,
                required: true,
                timing: 'immediate',
                reason_code: 'INDEX_REBUILDING',
                reason: 'The local index is rebuilding; use the returned snapshot only as provisional context and retry later.',
            }];
    }
    if (payload.uncertain === true) {
        return [{
                action_id: `${recallId}:scope-uncertain`,
                kind: 'stop',
                priority: 100,
                required: true,
                timing: 'immediate',
                reason_code: 'PROJECT_SCOPE_UNCERTAIN',
                reason: 'Project scope is uncertain; inspect the returned candidates and ask for a narrower project hint instead of guessing.',
            }];
    }
    if (matches.length === 0) {
        const candidates = Array.isArray(payload.candidate_notes) ? payload.candidate_notes : [];
        const candidatePath = firstRecallMatchPath(candidates);
        if (scope === 'project' &&
            payload.uncertain !== true &&
            candidatePath &&
            hasCredentialCapability(context, 'vault.read')) {
            return [{
                    action_id: `${recallId}:read-project-candidate`,
                    kind: 'tool_call',
                    tool: 'tracekeeper.read_note',
                    arguments: { path: candidatePath, recall_id: recallId },
                    priority: 80,
                    required: false,
                    timing: 'immediate',
                    reason_code: 'RECALL_ZERO_MATCH',
                    reason: 'No lexical result matched inside the resolved project; inspect one bounded project-memory candidate without broadening to unrelated global notes.',
                    capability_required: 'vault.read',
                }];
        }
        return [{
                action_id: `${recallId}:no-match`,
                kind: 'stop',
                priority: 80,
                required: true,
                timing: 'immediate',
                reason_code: 'RECALL_ZERO_MATCH',
                reason: 'No local knowledge matched; continue without claiming prior context was found.',
            }];
    }
    const pathValue = firstRecallMatchPath(matches);
    if (!pathValue || !hasCredentialCapability(context, 'vault.read')) {
        return [];
    }
    return [{
            action_id: `${recallId}:read-top-note`,
            kind: 'tool_call',
            tool: 'tracekeeper.read_note',
            arguments: { path: pathValue, recall_id: recallId },
            priority: 60,
            required: false,
            timing: 'if_context_insufficient',
            reason_code: 'RECALL_EXCERPT_MAY_BE_INSUFFICIENT',
            reason: 'Read the highest-ranked note only if its bounded excerpt is insufficient.',
            capability_required: 'vault.read',
        }];
}
function canonicalMemoryCloseoutStatus(payload) {
    const state = payload.memory_closeout_state;
    if (state === 'no_candidates' ||
        state === 'disabled' ||
        state === 'suggested' ||
        state === 'queued_for_review' ||
        state === 'partially_auto_saved' ||
        state === 'auto_saved' ||
        state === 'requires_wiki_bridge' ||
        state === 'conflict') {
        return state;
    }
    switch (payload.memory_closeout_status) {
        case 'auto_saved':
            return 'auto_saved';
        case 'queued':
            return 'queued_for_review';
        case 'mixed':
            return 'partially_auto_saved';
        case 'empty':
            return 'no_candidates';
        case 'ignored':
        default:
            return 'disabled';
    }
}
function buildFinishTaskActions(payload) {
    const baseId = actionBaseId(payload, 'finish-task');
    const memoryStatus = canonicalMemoryCloseoutStatus(payload);
    if (memoryStatus === 'queued_for_review' ||
        memoryStatus === 'partially_auto_saved' ||
        memoryStatus === 'requires_wiki_bridge') {
        return [{
                action_id: `${baseId}:report-review`,
                kind: 'user_review',
                priority: 100,
                required: true,
                timing: 'immediate',
                reason_code: 'MEMORY_REVIEW_REQUIRED',
                reason: 'Report that durable memory candidates await review in Obsidian; do not call finish_task again.',
            }];
    }
    return [{
            action_id: `${baseId}:report`,
            kind: 'report_status',
            priority: 100,
            required: true,
            timing: 'immediate',
            reason_code: 'MEMORY_RECORDED',
            reason: 'Report the returned memory closeout status and do not call finish_task again.',
        }];
}
function classifyToolError(message) {
    if (/lacks capability|permission denied/i.test(message)) {
        return { code: 'PERMISSION_DENIED', retryable: false, reasonCode: 'PERMISSION_DENIED' };
    }
    if (/cursor generation .* stale|stale .*cursor/i.test(message)) {
        return { code: 'STALE_CURSOR', retryable: true };
    }
    if (/project-memory cursor|catalog cursor|cursor checksum|cursor .*invalid|invalid .*cursor/i.test(message)) {
        return { code: 'INVALID_CURSOR', retryable: false };
    }
    if (/already completed/i.test(message)) {
        return { code: 'FINISH_ALREADY_COMPLETED', retryable: false, reasonCode: 'FINISH_ALREADY_COMPLETED' };
    }
    if (/idempotency.*conflict|already associated with operation|different .*hash/i.test(message)) {
        return { code: 'IDEMPOTENCY_CONFLICT', retryable: false, reasonCode: 'IDEMPOTENCY_CONFLICT' };
    }
    if (/unknown tool|tool not available/i.test(message)) {
        return { code: 'TOOL_UNAVAILABLE', retryable: true, reasonCode: 'TOOL_UNAVAILABLE' };
    }
    return { code: 'INVALID_REQUEST', retryable: false };
}
function safeToolErrorDescription(code) {
    switch (code) {
        case 'PERMISSION_DENIED':
            return 'The current principal is not allowed to perform this action.';
        case 'FINISH_ALREADY_COMPLETED':
            return 'The tracked task is already closed and must not be finished again.';
        case 'IDEMPOTENCY_CONFLICT':
            return 'Idempotency key conflict: the retry key conflicts with an existing operation; preserve the original result.';
        case 'STALE_CURSOR':
            return 'The project-memory snapshot changed; restart enumeration from the first page.';
        case 'INVALID_CURSOR':
            return 'The project-memory cursor is invalid for this request.';
        case 'TOOL_UNAVAILABLE':
            return 'The requested Tracekeeper tool is not available in this connection.';
        default:
            return 'The Tracekeeper request was rejected; inspect the legacy error field for local diagnostics.';
    }
}
function decorateToolResult(toolName, result, context) {
    const payload = (0, protocol_1.isRecord)(result.structuredContent) ? result.structuredContent : {};
    if (isToolResultFailure(result)) {
        const message = typeof payload.error === 'string' ? payload.error : 'Tracekeeper tool call failed.';
        const classified = classifyToolError(message);
        const safeMessage = safeToolErrorDescription(classified.code);
        const recoveryActions = classified.reasonCode
            ? [{
                    action_id: `${toolName}:error:${classified.code.toLowerCase()}`,
                    kind: classified.code === 'PERMISSION_DENIED' ? 'report_status' : 'stop',
                    priority: 100,
                    required: true,
                    timing: 'immediate',
                    reason_code: classified.reasonCode,
                    reason: safeMessage,
                }]
            : [];
        return toolResult({
            ...payload,
            schema_version: contracts_1.SCHEMA_VERSION,
            ok: false,
            tool: toolName,
            error: message,
            error_detail: {
                code: classified.code,
                message: safeMessage,
                retryable: classified.retryable,
                recovery_actions: recoveryActions,
            },
        }, true);
    }
    const decorated = {
        ...payload,
        schema_version: contracts_1.SCHEMA_VERSION,
        ok: true,
        tool: toolName,
    };
    if (toolName === 'tracekeeper.start_task') {
        decorated.workflow = {
            mode: 'tracked_task',
            state: 'started',
            task_id: payload.task_id,
            operation_id: payload.operation_id,
            project_hint: payload.project_hint ?? null,
            project_id: payload.project_id ?? null,
            repo_path: payload.repo_path ?? null,
        };
        decorated.next_actions = buildStartTaskActions(decorated, context);
    }
    if (toolName === 'tracekeeper.recall') {
        const scope = payload.scope_mode === 'project' || payload.scope_mode === 'project_history'
            ? payload.scope_mode
            : 'global';
        const matches = Array.isArray(payload.matches)
            ? payload.matches
            : Array.isArray(payload.entries)
                ? payload.entries
                : [];
        const recallSeed = JSON.stringify({
            scope,
            query: payload.query ?? '',
            snapshot_generation: payload.snapshot_generation ?? null,
            paths: matches.map((entry) => (0, protocol_1.isRecord)(entry) ? entry.path ?? entry.note_path ?? '' : ''),
        });
        const recallId = `recall_${crypto.createHash('sha256').update(recallSeed).digest('hex').slice(0, 16)}`;
        decorated.recall = {
            recall_id: recallId,
            scope,
            scope_confidence: payload.uncertain === true ? 0.25 : 1,
            query: typeof payload.query === 'string' ? payload.query : '',
            matched_count: matches.length,
            snapshot_generation: typeof payload.snapshot_generation === 'number'
                ? payload.snapshot_generation
                : null,
            index_state: typeof payload.index_state === 'string' ? payload.index_state : 'unknown',
            snapshot_warning: typeof payload.snapshot_warning === 'string' ? payload.snapshot_warning : null,
        };
        decorated.matches = matches;
        decorated.next_actions = buildRecallActions(decorated, context, recallId, scope, matches);
    }
    if (toolName === 'tracekeeper.finish_task') {
        const memoryStatus = canonicalMemoryCloseoutStatus(payload);
        decorated.memory_closeout_state = memoryStatus;
        decorated.workflow = {
            mode: 'tracked_task',
            state: 'finished',
            task_id: payload.task_id,
            operation_id: payload.operation_id,
            project_hint: payload.project_hint ?? null,
            project_id: payload.project_id ?? null,
            repo_path: payload.repo_path ?? null,
        };
        decorated.memory = {
            status: memoryStatus,
            proposal_count: typeof payload.proposal_count === 'number' ? payload.proposal_count : 0,
            auto_applied_count: typeof payload.auto_applied_count === 'number' ? payload.auto_applied_count : 0,
            action_required: memoryStatus === 'queued_for_review' ||
                memoryStatus === 'partially_auto_saved' ||
                memoryStatus === 'requires_wiki_bridge',
        };
        decorated.next_actions = buildFinishTaskActions(decorated);
    }
    return toolResult(decorated);
}
function validateToolResult(toolName, result) {
    const contract = TOOL_CONTRACT_BY_NAME.get(toolName);
    if (!contract) {
        return result;
    }
    const validation = (0, result_validation_1.validateStructuredContent)(result.structuredContent, contract.outputSchema);
    if (validation.valid) {
        return result;
    }
    const payload = (0, protocol_1.isRecord)(result.structuredContent) ? result.structuredContent : {};
    const recoveryMetadata = {};
    for (const key of ['operation_id', 'idempotency_key', 'task_id', 'path', 'task_path', 'audit_path', 'proposal_path']) {
        const value = payload[key];
        if (typeof value === 'string' && value.trim()) {
            recoveryMetadata[key] = value;
        }
    }
    const message = `Tracekeeper produced a result that does not match the ${toolName} output contract.`;
    return toolResult({
        ...recoveryMetadata,
        schema_version: contracts_1.SCHEMA_VERSION,
        ok: false,
        tool: toolName,
        execution_status: isToolResultFailure(result) ? 'failed' : 'succeeded',
        contract_status: 'invalid',
        error: message,
        error_detail: {
            code: 'INTERNAL_CONTRACT_ERROR',
            message,
            retryable: false,
            recovery_actions: [],
            diagnostics: validation.errors.slice(0, 5),
        },
    }, true);
}
function vaultRootFromArgs(args, context) {
    if (args.vaultRoot !== undefined) {
        return (0, safety_1.toSafeVaultRoot)(args.vaultRoot);
    }
    if (!context.defaultVaultRoot) {
        throw new safety_1.ToolInputError('vaultRoot is required unless --vault-root is configured.');
    }
    return (0, safety_1.toSafeVaultRoot)(context.defaultVaultRoot);
}
function pathSafetyOptions(context) {
    return {
        vaultConfigDir: context.vaultConfigDir,
    };
}
function graphProfileFromArgs(value, context) {
    return (0, core_1.normalizeGraphProfile)(value ?? context.graphProfile);
}
function coerceRecallScope(value) {
    const normalized = coerceOptionalString(value).toLowerCase();
    if (!normalized || normalized === 'global') {
        return 'global';
    }
    if (normalized === 'project' || normalized === 'project_context') {
        return 'project';
    }
    if (normalized === 'project_history' || normalized === 'history') {
        return 'project_history';
    }
    throw new safety_1.ToolInputError('scope must be one of: global, project, project_history.');
}
function coerceReviewQueueAction(value) {
    const normalized = coerceOptionalString(value).toLowerCase();
    if (!normalized || normalized === 'list_pending' || normalized === 'pending') {
        return 'list_pending';
    }
    if (normalized === 'list_approved' || normalized === 'approved') {
        return 'list_approved';
    }
    throw new safety_1.ToolInputError('review_queue action must be one of: list_pending, list_approved.');
}
function coerceSourceRequestAction(value, rawArgs) {
    const normalized = coerceOptionalString(value).toLowerCase();
    if (!normalized) {
        return rawArgs.request_path || rawArgs.path ? 'analyze' : 'list';
    }
    if (normalized === 'list' || normalized === 'pending') {
        return 'list';
    }
    if (normalized === 'analyze' || normalized === 'process') {
        return 'analyze';
    }
    throw new safety_1.ToolInputError('source_request action must be one of: list, analyze.');
}
function scanVaultForContext(vaultRoot, context) {
    const snapshot = context.knowledgeSnapshotProvider?.(vaultRoot);
    if (snapshot) {
        return snapshot;
    }
    return (0, core_1.scanVault)(vaultRoot, pathSafetyOptions(context));
}
function projectMemoryRepository(vaultRoot, context) {
    if (context.vaultRepository) {
        return context.vaultRepository;
    }
    return new core_1.NodeFsVaultRepository({
        vaultRoot,
        protectedDirectoryName: context.vaultConfigDir,
    });
}
function projectMemoryApplication(vaultRoot, context) {
    return new project_memory_1.ProjectMemoryApplicationService({
        repository: projectMemoryRepository(vaultRoot, context),
        loadScan: () => scanVaultForContext(vaultRoot, context),
    });
}
function scanProvenance(scan) {
    const indexState = scan.index?.index_state ?? 'filesystem_scan';
    return {
        index_state: indexState,
        snapshot_generation: scan.index?.generation ?? null,
        snapshot_warning: indexState === 'rebuilding'
            ? 'Knowledge index is rebuilding; this result may come from the previous snapshot generation.'
            : indexState === 'initializing'
                ? 'Knowledge index metadata is still initializing; this result may be incomplete.'
                : null,
    };
}
function buildContextPackForContext(vaultRoot, query, context, options = {}, scan) {
    return (0, core_1.buildContextPackFromScan)(scan ?? scanVaultForContext(vaultRoot, context), query, options);
}
function coerceNonEmptyString(value, required = false, field = 'value') {
    if (typeof value !== 'string' || value.trim() === '') {
        if (required) {
            throw new safety_1.ToolInputError(`Missing required string argument: ${field}.`);
        }
        return '';
    }
    return value.trim();
}
function coerceOptionalString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function coerceMemoryScope(value) {
    const normalized = coerceOptionalString(value).toLowerCase();
    if (!normalized) {
        return undefined;
    }
    if (normalized === 'global' || normalized === 'project') {
        return normalized;
    }
    throw new safety_1.ToolInputError('memory_scope must be one of: global, project.');
}
function resolveMemoryScope(proposalKind, targetNote, projectHint, memoryScopeValue) {
    return coerceMemoryScope(memoryScopeValue) || normalizeMemoryScope(proposalKind, targetNote, projectHint, '');
}
function dedupeAndNormalizeList(values) {
    const normalized = values
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.replace(/\s+/g, ' '))
        .sort((a, b) => a.localeCompare(b));
    return Array.from(new Set(normalized));
}
function normalizeMultiValueList(value, field, required = false) {
    const source = coerceStringOrStringArray(value, field, required);
    const normalized = [];
    for (const entry of source) {
        const chunks = entry
            .split(/[\n,]/g)
            .map((item) => item.trim())
            .filter(Boolean);
        normalized.push(...chunks);
    }
    return dedupeAndNormalizeList(normalized);
}
function normalizeWikilinkOrSourceValue(value) {
    let candidate = value.trim();
    if (!candidate) {
        return '';
    }
    const markdownLink = candidate.match(/\]\(([^)]+)\)/);
    if (markdownLink?.[1]) {
        candidate = markdownLink[1].trim();
    }
    candidate = candidate
        .replace(/^\s*!\[\[(.*?)\]\]\s*$/, (_, body) => body)
        .replace(/^\s*\[\[(.*?)\]\]\s*$/, (_, body) => body);
    const aliasSplit = candidate.indexOf('|');
    if (aliasSplit >= 0) {
        candidate = candidate.slice(0, aliasSplit).trim();
    }
    return candidate.replace(/^['"]|['"]$/g, '').trim();
}
function normalizeMemoryScope(proposalKind, targetNote, projectHint, memoryScopeValue) {
    const normalized = coerceOptionalString(memoryScopeValue).toLowerCase();
    if (normalized === 'project' || normalized === 'global') {
        return normalized;
    }
    return isProjectMemoryProposal(proposalKind, targetNote, projectHint) ? 'project' : 'global';
}
function buildArchitectureStatus(vaultRoot, context) {
    const scan = scanVaultForContext(vaultRoot, context);
    const graphHealth = (0, core_1.analyzeGraphHealth)(scan.notes, { maxItems: 20 });
    const missingGraphBridges = [
        ...graphHealth.missing_recommended_hubs,
        graphHealth.missing_recommended_entry,
    ].filter((value) => Boolean(value));
    const isHealthy = graphHealth.unresolved_edge_count === 0 &&
        graphHealth.component_count <= 1 &&
        missingGraphBridges.length === 0;
    return {
        architecture_status: isHealthy ? 'healthy' : 'needs_attention',
        missing_graph_bridges: dedupeAndNormalizeList(missingGraphBridges),
    };
}
function resolveProjectMemoryBridgeMetadata(vaultRoot, memoryScope, projectHint, relatedWikiRaw, relatedSourcesRaw, context) {
    const options = pathSafetyOptions(context);
    const scan = scanVaultForContext(vaultRoot, context);
    const pathSet = new Set(scan.notes.map((note) => note.relativePath.toLowerCase()));
    if (projectHint && !projectHint.trim()) {
        projectHint = '';
    }
    const relatedWiki = dedupeAndNormalizeList(relatedWikiRaw.map(normalizeWikilinkOrSourceValue));
    const relatedSources = dedupeAndNormalizeList(relatedSourcesRaw.map(normalizeWikilinkOrSourceValue));
    const missing_related_wiki = [];
    const resolved = [];
    const missing_related_sources = [];
    const resolvedSources = [];
    const resolveReference = (rawReference, isValid) => {
        const candidates = new Set();
        candidates.add(rawReference);
        if (!rawReference.toLowerCase().endsWith('.md')) {
            candidates.add(`${rawReference}.md`);
        }
        if (rawReference.endsWith('.md') && rawReference.length > 3) {
            candidates.add(rawReference.slice(0, -3));
        }
        for (const candidate of candidates) {
            const normalizedCandidate = coerceOptionalString(candidate);
            if (!normalizedCandidate) {
                continue;
            }
            let notePath;
            try {
                notePath = (0, safety_1.normalizeNotePath)(normalizedCandidate, options);
            }
            catch {
                continue;
            }
            const lowerPath = notePath.toLowerCase();
            if (pathSet.has(lowerPath)) {
                return notePath;
            }
            const absolutePath = path.join(vaultRoot, notePath);
            if (fs.existsSync(absolutePath)) {
                return notePath;
            }
        }
        const title = rawReference.toLowerCase().replace(/\.md$/i, '');
        for (const note of scan.notes) {
            if (!isValid(note.relativePath)) {
                continue;
            }
            const noteTitle = note.title.toLowerCase();
            const basePath = note.relativePath.toLowerCase().split('/').pop()?.replace(/\.md$/i, '') || '';
            if (noteTitle === title || basePath === title) {
                return note.relativePath;
            }
        }
        return null;
    };
    for (const reference of relatedWiki) {
        const resolvedPath = resolveReference(reference, core_1.isKnowledgeWikiPath);
        if (resolvedPath && (0, core_1.isKnowledgeWikiPath)(resolvedPath)) {
            resolved.push(resolvedPath);
        }
        else {
            missing_related_wiki.push(reference);
        }
    }
    for (const reference of relatedSources) {
        const resolvedPath = resolveReference(reference, core_1.isKnowledgeSourcePath);
        if (resolvedPath && (0, core_1.isKnowledgeSourcePath)(resolvedPath)) {
            resolvedSources.push(resolvedPath);
        }
        else {
            missing_related_sources.push(reference);
        }
    }
    if (memoryScope !== 'project') {
        return {
            missing_wiki_bridge: false,
            related_wiki: dedupeAndNormalizeList(resolved),
            missing_related_wiki: dedupeAndNormalizeList(missing_related_wiki),
            related_sources: dedupeAndNormalizeList(resolvedSources),
            missing_related_sources: dedupeAndNormalizeList(missing_related_sources),
        };
    }
    const relatedWikiMissing = relatedWiki.length === 0 || missing_related_wiki.length > 0 || dedupeAndNormalizeList(resolved).length === 0;
    if (relatedWikiMissing) {
        return {
            missing_wiki_bridge: true,
            related_wiki: dedupeAndNormalizeList(resolved),
            missing_related_wiki: dedupeAndNormalizeList(missing_related_wiki),
            related_sources: dedupeAndNormalizeList(resolvedSources),
            missing_related_sources: dedupeAndNormalizeList(missing_related_sources),
        };
    }
    return {
        missing_wiki_bridge: false,
        related_wiki: dedupeAndNormalizeList(resolved),
        missing_related_wiki: [],
        related_sources: dedupeAndNormalizeList(resolvedSources),
        missing_related_sources: dedupeAndNormalizeList(missing_related_sources),
    };
}
function coerceStringOrStringArray(value, field, required = false) {
    if (value === undefined || value === null) {
        if (required) {
            throw new safety_1.ToolInputError(`Missing required argument: ${field}.`);
        }
        return [];
    }
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (!normalized) {
            if (required) {
                throw new safety_1.ToolInputError(`Missing required argument: ${field}.`);
            }
            return [];
        }
        return [normalized];
    }
    if (Array.isArray(value)) {
        const normalized = value
            .filter((entry) => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
        if (required && normalized.length === 0) {
            throw new safety_1.ToolInputError(`Missing required argument: ${field}.`);
        }
        if (normalized.length !== value.length) {
            throw new safety_1.ToolInputError(`${field} array must contain only strings.`);
        }
        return normalized;
    }
    throw new safety_1.ToolInputError(`${field} must be a string or string array.`);
}
function coerceReviewProposalMode(value, fallback = DEFAULT_FINISH_TASK_REVIEW_MODE) {
    const normalized = coerceOptionalString(value).toLowerCase();
    if (!normalized) {
        return fallback;
    }
    if (normalized === 'off' || normalized === 'suggest' || normalized === 'review_queue' || normalized === 'auto_propose') {
        return normalized;
    }
    throw new safety_1.ToolInputError('review_proposal_mode must be one of: off, suggest, review_queue, auto_propose.');
}
const FINISH_TASK_PROPOSAL_SIGNATURE_KEY = 'content_signature';
function normalizeFinishTaskProposalValues(values) {
    return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort((a, b) => a.localeCompare(b));
}
function buildFinishTaskProposalSignature(taskId, proposalKind, values) {
    const payload = {
        taskId,
        proposalKind,
        values: normalizeFinishTaskProposalValues(values),
    };
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
function finishTaskProposalLabel(proposalKind) {
    switch (proposalKind) {
        case 'task_decision':
            return 'Task Decisions';
        case 'solution_change':
            return 'Solution Changes';
        case 'lesson_learned':
            return 'Lessons';
        case 'user_preference':
            return 'User Preferences';
        case 'project_next_action':
            return 'Project Next Actions';
        case 'memory_candidate':
            return 'Memory Candidates';
        default:
            return 'Closeout Items';
    }
}
function extractFinishTaskSectionValues(body, label) {
    const needle = `## ${label.toLowerCase()}`;
    const lines = body.split('\n');
    let inSection = false;
    const values = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('## ')) {
            inSection = trimmed.toLowerCase() === needle;
            continue;
        }
        if (!inSection || !trimmed.startsWith('- ')) {
            continue;
        }
        const value = trimmed.slice(2).trim();
        if (value.length > 0) {
            values.push(value);
        }
    }
    return normalizeFinishTaskProposalValues(values);
}
function findExistingFinishTaskProposal(vaultRoot, taskId, proposalKind, proposalValues, context) {
    const scan = scanVaultForContext(vaultRoot, context);
    const signature = buildFinishTaskProposalSignature(taskId, proposalKind, proposalValues);
    const label = finishTaskProposalLabel(proposalKind);
    for (const note of scan.notes) {
        if (!note.relativePath.startsWith(`${MEMORY_PROPOSAL_DIR}/`)) {
            continue;
        }
        const sourceTool = stripYamlQuotes(readFrontmatterString(note.frontmatter, ['proposal_source_tool', 'proposalSourceTool']));
        const noteTaskId = stripYamlQuotes(readFrontmatterString(note.frontmatter, ['proposal_source_task_id', 'proposalSourceTaskId']));
        const noteProposalKind = stripYamlQuotes(readFrontmatterString(note.frontmatter, ['proposal_kind', 'proposalKind']));
        if (sourceTool !== 'tracekeeper.finish_task' ||
            noteTaskId !== taskId ||
            noteProposalKind !== proposalKind) {
            continue;
        }
        const noteSignature = stripYamlQuotes(readFrontmatterString(note.frontmatter, [FINISH_TASK_PROPOSAL_SIGNATURE_KEY, 'proposal_signature']));
        if (noteSignature && noteSignature === signature) {
            return note.relativePath;
        }
        const sectionValues = extractFinishTaskSectionValues(note.content, label);
        const candidateSignature = buildFinishTaskProposalSignature(taskId, proposalKind, sectionValues);
        if (candidateSignature === signature && sectionValues.length > 0) {
            return note.relativePath;
        }
    }
    return null;
}
function normalizeReviewProposalMode(value, fallback = DEFAULT_FINISH_TASK_REVIEW_MODE) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized === 'off' || normalized === 'suggest' || normalized === 'review_queue' || normalized === 'auto_propose'
        ? normalized
        : fallback;
}
function defaultReviewProposalMode(context) {
    return normalizeReviewProposalMode(context.memoryRules?.taskMemoryProposalMode, DEFAULT_FINISH_TASK_REVIEW_MODE);
}
function normalizeMemoryProposalRule(value, fallback = 'review_queue') {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'disabled') {
        return 'disabled';
    }
    if (normalized === 'auto_write' || normalized === 'auto' || normalized === 'automatic' || normalized === 'auto_save') {
        return 'auto_write';
    }
    if (normalized === 'review_queue' || normalized === 'review') {
        return 'review_queue';
    }
    return fallback;
}
function isProjectMemoryProposal(proposalKind, targetNote, projectHint) {
    const normalizedKind = proposalKind.trim().toLowerCase();
    const normalizedTarget = targetNote.trim().toLowerCase();
    return Boolean(projectHint.trim()
        || normalizedKind.includes('project')
        || normalizedKind.includes('workspace')
        || normalizedKind.includes('repo')
        || PROJECT_MEMORY_READ_DIRS.some((projectDir) => normalizedTarget.startsWith(`${projectDir}/`)));
}
function isProjectMemoryProposalForScope(proposalKind, targetNote, projectHint, memoryScope) {
    if (memoryScope === 'global') {
        return false;
    }
    if (memoryScope === 'project') {
        return true;
    }
    return isProjectMemoryProposal(proposalKind, targetNote, projectHint);
}
function memoryProposalRuleFor(proposalKind, targetNote, projectHint, context, memoryScope) {
    const projectScoped = isProjectMemoryProposalForScope(proposalKind, targetNote, projectHint, memoryScope);
    return normalizeMemoryProposalRule(projectScoped ? context.memoryRules?.projectMemoryRule : context.memoryRules?.globalMemoryRule, projectScoped ? 'auto_write' : 'review_queue');
}
function isMemoryProposalAllowed(proposalKind, targetNote, projectHint, context, memoryScope) {
    return memoryProposalRuleFor(proposalKind, targetNote, projectHint, context, memoryScope) !== 'disabled';
}
function assertMemoryProposalAllowed(proposalKind, targetNote, projectHint, context, memoryScope) {
    if (isMemoryProposalAllowed(proposalKind, targetNote, projectHint, context, memoryScope)) {
        return;
    }
    const scope = isProjectMemoryProposalForScope(proposalKind, targetNote, projectHint, memoryScope) ? 'project' : 'global';
    throw new safety_1.ToolInputError(`${scope} memory proposals are disabled by Tracekeeper memory rules.`);
}
function buildSafePathSegment(raw, fallback) {
    const segment = raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return segment || fallback;
}
function buildDefaultProjectMemoryTarget(vaultRoot, projectHint) {
    void vaultRoot;
    return (0, core_1.projectMemoryPath)(projectHint || 'project');
}
function inferAutoMemoryAllowedDir(targetNote, projectScoped, context) {
    const normalized = (0, safety_1.normalizeNotePath)(targetNote, pathSafetyOptions(context));
    const allowedDirs = projectScoped ? PROJECT_MEMORY_READ_DIRS : GLOBAL_MEMORY_DIRS;
    return allowedDirs.find((dir) => normalized.startsWith(`${dir}/`)) || '';
}
function resolveAutoMemoryTarget(vaultRoot, proposalKind, targetNote, projectHint, context, memoryScope) {
    const projectScoped = isProjectMemoryProposalForScope(proposalKind, targetNote, projectHint, memoryScope);
    if (targetNote) {
        const normalized = (0, safety_1.normalizeNotePath)(targetNote, pathSafetyOptions(context));
        const allowedDir = inferAutoMemoryAllowedDir(normalized, projectScoped, context);
        return allowedDir ? { targetNote: normalized, allowedDir } : null;
    }
    if (projectScoped && projectHint) {
        const defaultTarget = buildDefaultProjectMemoryTarget(vaultRoot, projectHint);
        const allowedDir = inferAutoMemoryAllowedDir(defaultTarget, true, context);
        return allowedDir ? { targetNote: defaultTarget, allowedDir } : null;
    }
    return null;
}
function coerceProjectScope(rawArgs, notes = []) {
    return (0, project_identity_1.resolveProjectIdentity)(rawArgs, notes);
}
function hasProjectScope(scope) {
    return Boolean(scope.projectHint || scope.projectId || scope.repoPath);
}
function normalizeRepoPrefix(value) {
    return value
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/\\/g, '/');
}
function valueContainsAnyToken(value, tokens) {
    const normalized = value.toLowerCase();
    return tokens.some((token) => token.length > 0 && normalized.includes(token));
}
function projectTokens(value) {
    const normalized = value.toLowerCase().trim();
    if (!normalized) {
        return [];
    }
    const variants = new Set([
        normalized,
        normalized.replace(/\s+/g, '-'),
        normalized.replace(/\s+/g, '_'),
        normalized.replace(/[-_]+/g, ' '),
    ]);
    return Array.from(variants).filter(Boolean);
}
function noteMatchesRepoPath(note, repoPath) {
    if (!repoPath) {
        return false;
    }
    const normalizedRepo = normalizeRepoPrefix(repoPath).toLowerCase();
    if (!normalizedRepo) {
        return false;
    }
    const repoLeaf = normalizedRepo.split('/').filter(Boolean).pop() || normalizedRepo;
    const pathValue = note.relativePath.toLowerCase();
    if (pathValue.startsWith(normalizedRepo) || pathValue.includes(`/${repoLeaf}/`) || pathValue.includes(`/${repoLeaf}.`)) {
        return true;
    }
    const frontmatterValue = [
        readFrontmatterString(note.frontmatter, ['repo_path', 'repoPath', 'repository_path', 'repositoryPath']),
        readFrontmatterString(note.frontmatter, ['repo', 'repository']),
        readFrontmatterString(note.frontmatter, ['project_path', 'projectPath', 'project_paths', 'projectPaths']),
        readFrontmatterString(note.frontmatter, ['workspace', 'cwd']),
    ].join(' ');
    return valueContainsAnyToken(frontmatterValue, [normalizedRepo, repoLeaf]);
}
function noteMatchesProjectId(note, projectId) {
    if (!projectId) {
        return false;
    }
    const token = projectId.toLowerCase();
    const source = [
        readFrontmatterString(note.frontmatter, ['project_id', 'projectId', 'project-id', 'pid']),
        readFrontmatterString(note.frontmatter, ['id']),
        note.title,
    ].map((item) => item.toLowerCase());
    if (source.some((item) => item.includes(token))) {
        return true;
    }
    const pathValue = note.relativePath.toLowerCase();
    return pathValue.includes(`/${token}/`) || pathValue.includes(`_${token}_`) || pathValue.includes(`-${token}-`);
}
function hasExplicitProjectIdMetadata(note) {
    return Boolean(readFrontmatterString(note.frontmatter, ['project_id', 'projectId', 'project-id', 'pid']));
}
function noteMatchesProjectHint(note, projectHint) {
    if (!projectHint) {
        return false;
    }
    const tokens = projectTokens(projectHint);
    if (tokens.length === 0) {
        return false;
    }
    const pathValue = note.relativePath.toLowerCase();
    if (tokens.some((token) => PROJECT_MEMORY_READ_DIRS.some((dir) => pathValue.includes(`${dir}/${token}`)) || pathValue.includes(`/${token}/`))) {
        return true;
    }
    if (tokens.some((token) => PROJECT_MEMORY_READ_DIRS.some((dir) => pathValue.startsWith(`${dir}/${token}/`)))) {
        return true;
    }
    const frontmatterValues = [
        readFrontmatterString(note.frontmatter, ['project', 'project_hint', 'related_project', 'relatedProject']),
        readFrontmatterString(note.frontmatter, ['project_name', 'project-name']),
        readFrontmatterString(note.frontmatter, ['tags']),
        note.title,
    ].join(' ');
    return valueContainsAnyToken(frontmatterValues, tokens);
}
function noteRepoMetadataValues(note) {
    return [
        readFrontmatterString(note.frontmatter, ['repo_path', 'repoPath', 'repository_path', 'repositoryPath']),
        readFrontmatterString(note.frontmatter, ['repo', 'repository']),
        readFrontmatterString(note.frontmatter, ['project_path', 'projectPath', 'project_paths', 'projectPaths']),
        readFrontmatterString(note.frontmatter, ['workspace', 'cwd']),
    ]
        .map((value) => value.toLowerCase().trim())
        .filter(Boolean);
}
function hasExplicitRepoMetadata(note) {
    return noteRepoMetadataValues(note).length > 0;
}
function noteMatchesExplicitRepoMetadata(note, normalizedRepoPath) {
    if (!normalizedRepoPath) {
        return false;
    }
    const repoMetadata = noteRepoMetadataValues(note);
    if (repoMetadata.length === 0) {
        return false;
    }
    const repoLeaf = normalizedRepoPath.split('/').filter(Boolean).pop() || normalizedRepoPath;
    return repoMetadata.some((value) => valueContainsAnyToken(value, [normalizedRepoPath, repoLeaf]));
}
function filterNotesByProjectScope(notes, scope) {
    if (!hasProjectScope(scope)) {
        return notes.filter((note) => PROJECT_MEMORY_READ_DIRS.some((dir) => note.relativePath.startsWith(`${dir}/`)));
    }
    const hasRepoPath = Boolean(scope.repoPath);
    const normalizedRepo = hasRepoPath ? normalizeRepoPrefix(scope.repoPath).toLowerCase() : '';
    const projectHint = scope.projectHint.toLowerCase();
    const projectId = scope.projectId.toLowerCase();
    const hasProjectIdentity = Boolean(projectHint || projectId);
    return notes.filter((note) => {
        if (hasRepoPath && hasProjectIdentity) {
            const explicitMetadata = hasExplicitRepoMetadata(note);
            if (explicitMetadata && !noteMatchesExplicitRepoMetadata(note, normalizedRepo)) {
                return false;
            }
        }
        else if (hasRepoPath && !noteMatchesRepoPath(note, normalizedRepo)) {
            return false;
        }
        if (projectHint && !noteMatchesProjectHint(note, projectHint)) {
            return false;
        }
        if (projectId) {
            if (hasExplicitProjectIdMetadata(note) && !noteMatchesProjectId(note, projectId)) {
                return false;
            }
            if (!hasExplicitProjectIdMetadata(note) && !projectHint && !noteMatchesProjectId(note, projectId)) {
                return false;
            }
        }
        return true;
    });
}
function scopedTaskIdsFromNotes(notes, scope) {
    const taskIds = new Set();
    for (const note of filterNotesByProjectScope(notes, scope)) {
        if (!note.relativePath.startsWith(`${AGENT_TASK_DIR}/`)) {
            continue;
        }
        const taskId = readFrontmatterString(note.frontmatter, ['task_id', 'taskId']);
        if (taskId) {
            taskIds.add(taskId);
        }
    }
    return taskIds;
}
function filterNotesByProjectScopeWithSessions(notes, scope) {
    const directMatches = filterNotesByProjectScope(notes, scope);
    if (!hasProjectScope(scope)) {
        return directMatches;
    }
    const directPaths = new Set(directMatches.map((note) => note.relativePath));
    const taskIds = scopedTaskIdsFromNotes(notes, scope);
    const results = [...directMatches];
    for (const note of notes) {
        if (!note.relativePath.startsWith(`${SESSION_NOTE_DIR}/`)) {
            continue;
        }
        if (directPaths.has(note.relativePath)) {
            continue;
        }
        const taskId = readFrontmatterString(note.frontmatter, ['task_id', 'taskId']);
        if (taskId && taskIds.has(taskId)) {
            results.push(note);
        }
    }
    return results;
}
function relationValues(value) {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return values
        .filter((entry) => typeof entry === 'string')
        .flatMap((entry) => entry.split(/[\n,]/g))
        .map(normalizeWikilinkOrSourceValue)
        .filter(Boolean);
}
function resolveSnapshotRelation(reference, notes) {
    const normalized = normalizeWikilinkOrSourceValue(reference)
        .replace(/#.*$/, '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '');
    if (!normalized) {
        return null;
    }
    const candidates = new Set([
        normalized.toLowerCase(),
        normalized.toLowerCase().endsWith('.md')
            ? normalized.toLowerCase().slice(0, -3)
            : `${normalized.toLowerCase()}.md`,
    ]);
    for (const note of notes) {
        const notePath = note.relativePath.replace(/\\/g, '/').toLowerCase();
        if (candidates.has(notePath) || candidates.has(notePath.replace(/\.md$/i, ''))) {
            return note;
        }
    }
    return null;
}
function normalizeRelationEdgeTarget(value) {
    return normalizeWikilinkOrSourceValue(value)
        .replace(/#.*$/, '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .toLowerCase();
}
function findSnapshotNoteByPath(notePath, notes) {
    const normalizedPath = notePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    return notes.find((note) => note.relativePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase() === normalizedPath) ?? null;
}
function resolveFrontmatterRelationEdge(note, reference, allNotes) {
    const normalizedReference = normalizeRelationEdgeTarget(reference);
    if (!normalizedReference) {
        return { matched: false, note: null };
    }
    for (const edge of note.edges) {
        if (edge.source !== 'frontmatter' ||
            normalizeRelationEdgeTarget(edge.linkPath || edge.target) !== normalizedReference) {
            continue;
        }
        return {
            matched: true,
            note: edge.resolution.status === 'resolved'
                ? findSnapshotNoteByPath(edge.resolution.path, allNotes)
                : null,
        };
    }
    return { matched: false, note: null };
}
function buildRecallRelationEvidence(note, allNotes) {
    const relationMap = new Map();
    const addResolvedRelation = (resolved, declaredVia) => {
        if (!resolved) {
            return;
        }
        const relationKind = (0, core_1.isKnowledgeWikiPath)(resolved.relativePath)
            ? 'related_wiki'
            : (0, core_1.isKnowledgeSourcePath)(resolved.relativePath)
                ? 'related_sources'
                : null;
        if (!relationKind) {
            return;
        }
        const key = `${relationKind}:${resolved.relativePath.toLowerCase()}`;
        const existing = relationMap.get(key);
        if (existing) {
            if (!existing.declared_via.includes(declaredVia)) {
                existing.declared_via.push(declaredVia);
            }
            return;
        }
        relationMap.set(key, {
            path: resolved.relativePath,
            declared_by: note.relativePath,
            declared_via: [declaredVia],
            verified_by: 'active_vault_snapshot',
        });
    };
    const addFrontmatterRelation = (reference) => {
        const sharedEdge = resolveFrontmatterRelationEdge(note, reference, allNotes);
        addResolvedRelation(sharedEdge.matched
            ? sharedEdge.note
            : resolveSnapshotRelation(reference, allNotes), 'frontmatter');
    };
    for (const key of ['related_wiki', 'relatedWiki', 'wiki']) {
        for (const value of relationValues(note.frontmatter[key])) {
            addFrontmatterRelation(value);
        }
    }
    for (const key of ['related_sources', 'relatedSources', 'sources', 'source']) {
        for (const value of relationValues(note.frontmatter[key])) {
            addFrontmatterRelation(value);
        }
    }
    for (const edge of note.edges) {
        if (edge.source !== 'body') {
            continue;
        }
        addResolvedRelation(edge.resolution.status === 'resolved'
            ? findSnapshotNoteByPath(edge.resolution.path, allNotes)
            : null, 'body_wikilink');
    }
    const evidence = {
        related_wiki: [],
        related_sources: [],
    };
    for (const [key, relation] of relationMap) {
        if (key.startsWith('related_wiki:') && evidence.related_wiki.length < MAX_RECALL_RELATIONS) {
            evidence.related_wiki.push(relation);
        }
        if (key.startsWith('related_sources:') && evidence.related_sources.length < MAX_RECALL_RELATIONS) {
            evidence.related_sources.push(relation);
        }
    }
    return evidence;
}
function recallContentOrigin(relativePath, noteType) {
    const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const normalizedType = (noteType ?? '').trim().toLowerCase();
    if (normalizedPath === core_1.KNOWLEDGE_SOURCES_DIR ||
        normalizedPath.startsWith(`${core_1.KNOWLEDGE_SOURCES_DIR}/`) ||
        normalizedType.includes('source')) {
        return 'captured_source';
    }
    if (normalizedPath === core_1.TRACEKEEPER_ROOT || normalizedPath.startsWith(`${core_1.TRACEKEEPER_ROOT}/`)) {
        return 'tracekeeper_generated';
    }
    return 'vault_note';
}
function buildFinishTaskProposalEvidence(taskId, sessionNotePath, projectHint, proposalKind, mode) {
    const parts = [
        `tool_name=tracekeeper.finish_task`,
        `task_id=${taskId}`,
        `session_note=${sessionNotePath}`,
        `project_hint=${projectHint || 'unset'}`,
        `proposal_kind=${proposalKind}`,
        `proposal_mode=${mode}`,
    ];
    return parts.join(' | ');
}
async function readVaultNoteContent(vaultRoot, notePath, context) {
    if (context.vaultRepository) {
        const note = await context.vaultRepository.readText(notePath);
        return note?.content ?? null;
    }
    const absolutePath = (0, safety_1.resolveSafeNotePath)(vaultRoot, notePath, pathSafetyOptions(context));
    return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : null;
}
async function readOperationOwnerFromNote(vaultRoot, notePath, operationField, context) {
    const content = await readVaultNoteContent(vaultRoot, notePath, context);
    if (content === null) {
        return '';
    }
    return stripYamlQuotes(readFrontmatterString((0, core_1.parseMarkdown)(content).frontmatter.fields, [operationField]));
}
function proposalIdFromOperation(operationId, discriminator) {
    return (0, core_1.buildStableProposalId)(`${operationId}\0${discriminator}`);
}
function generateProposalMarkdownLink(context, proposalPath, sourcePath) {
    const repository = context.vaultRepository;
    if (!repository || typeof repository.generateMarkdownLink !== 'function') {
        return null;
    }
    return repository.generateMarkdownLink(proposalPath, sourcePath);
}
function explicitProposalId(frontmatter) {
    return stripYamlQuotes(readFrontmatterString(frontmatter, ['proposal_id', 'proposalId']));
}
async function ensureOperationOwnedProposalIdentity(vaultRoot, proposalPath, proposalId, operationField, operationId, context) {
    const current = await readCurrentVaultTextState(vaultRoot, proposalPath, context);
    if (!current) {
        throw new core_1.OperationConflictError(`Proposal is unavailable: ${proposalPath}`);
    }
    const frontmatter = (0, core_1.parseMarkdown)(current.content).frontmatter.fields;
    if (stripYamlQuotes(readFrontmatterString(frontmatter, [operationField]))
        !== operationId) {
        throw new core_1.OperationConflictError(`Proposal is not owned by the current operation: ${proposalPath}`);
    }
    const currentProposalId = explicitProposalId(frontmatter);
    if (currentProposalId) {
        if (currentProposalId !== proposalId) {
            throw new core_1.OperationConflictError(`Proposal identity changed for operation-owned note: ${proposalPath}`);
        }
        return;
    }
    const next = updateFrontmatterFields(current.content, {
        proposal_id: proposalId,
    });
    if (context.vaultRepository) {
        if (!current.version) {
            throw new core_1.OperationConflictError('Proposal version is unavailable.');
        }
        await context.vaultRepository.replaceText(current.path, current.version, next);
        return;
    }
    const absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, current.path, pathSafetyOptions(context));
    replaceTextFileAtomically(absolute, next, current.content);
}
async function readRequiredProposalId(vaultRoot, proposalPath, context) {
    const content = await readVaultNoteContent(vaultRoot, proposalPath, context);
    if (content === null) {
        throw new safety_1.ToolInputError(`Proposal artifact is missing: ${proposalPath}`);
    }
    const proposalId = explicitProposalId((0, core_1.parseMarkdown)(content).frontmatter.fields);
    if (!proposalId) {
        throw new safety_1.ToolInputError(`Proposal artifact has no stable proposal_id: ${proposalPath}`);
    }
    return proposalId;
}
async function createFinishTaskProposal(vaultRoot, taskId, sessionNotePath, operationId, proposalKind, label, values, projectHint, reviewProposalMode, memoryScope, relatedWiki, relatedSources, architectureStatus, missingGraphBridges, missingWikiBridge, missingRelatedWiki, missingRelatedSources, context, suppressAutoTarget = false) {
    const normalizedValues = normalizeFinishTaskProposalValues(values);
    const proposalId = proposalIdFromOperation(operationId, proposalKind);
    const proposalSignature = buildFinishTaskProposalSignature(taskId, proposalKind, normalizedValues);
    const proposalAuditMetadata = {
        target_type: 'memory_proposal',
        proposal_kind: proposalKind,
        source_note: sessionNotePath,
    };
    const existingProposal = findExistingFinishTaskProposal(vaultRoot, taskId, proposalKind, normalizedValues, context);
    if (existingProposal) {
        const existingOperationId = await readOperationOwnerFromNote(vaultRoot, existingProposal, 'finish_operation_id', context);
        const ownedByCurrentOperation = existingOperationId === operationId;
        await appendAuditEventAsync(vaultRoot, {
            operationId,
            tool: 'tracekeeper.finish_task',
            targetPath: existingProposal,
            status: ownedByCurrentOperation ? 'written' : 'skipped',
            taskId,
            metadata: ownedByCurrentOperation
                ? proposalAuditMetadata
                : { ...proposalAuditMetadata, action: 'memory.proposal.duplicate' },
        }, context);
        if (ownedByCurrentOperation) {
            await ensureOperationOwnedProposalIdentity(vaultRoot, existingProposal, proposalId, 'finish_operation_id', operationId, context);
        }
        return {
            path: existingProposal,
            proposalId: await readRequiredProposalId(vaultRoot, existingProposal, context),
        };
    }
    const existingForOperation = await findOperationOwnedNoteAsync(vaultRoot, MEMORY_PROPOSAL_DIR, `finish-task-${proposalKind}-${taskId}-${operationId}`, 'finish_operation_id', operationId, context);
    if (existingForOperation) {
        await ensureOperationOwnedProposalIdentity(vaultRoot, existingForOperation.path, proposalId, 'finish_operation_id', operationId, context);
        await appendAuditEventAsync(vaultRoot, {
            operationId,
            tool: 'tracekeeper.finish_task',
            targetPath: existingForOperation.path,
            status: 'written',
            taskId,
            metadata: proposalAuditMetadata,
        }, context);
        return { path: existingForOperation.path, proposalId };
    }
    const now = new Date().toISOString();
    const filename = buildSafeFilename(`finish-task-${proposalKind}-${taskId}-${operationId}`, 'proposal', context);
    const evidence = buildFinishTaskProposalEvidence(taskId, sessionNotePath, projectHint, proposalKind, reviewProposalMode);
    const writebackContent = normalizedValues.map((item) => `- ${item}`).join('\n');
    const writebackTarget = suppressAutoTarget
        ? null
        : resolveAutoMemoryTarget(vaultRoot, proposalKind, '', projectHint, context, memoryScope);
    const body = [
        contentText(context, '## 任务收尾提案来源', '## Finish Task Proposal Source'),
        `- tool_name: tracekeeper.finish_task`,
        `- task_id: ${taskId}`,
        `- session_note: ${sessionNotePath}`,
        `- memory_scope: ${memoryScope}`,
        writebackTarget ? `- target_note: ${writebackTarget.targetNote}` : '',
        projectHint ? `- project_hint: ${projectHint}` : '',
        relatedWiki.length ? `- related_wiki: ${JSON.stringify(relatedWiki)}` : '',
        relatedSources.length ? `- related_sources: ${JSON.stringify(relatedSources)}` : '',
        `- proposal_kind: ${proposalKind}`,
        `- architecture_status: ${architectureStatus.architecture_status}`,
        missingGraphBridges.length ? `- missing_graph_bridges: ${JSON.stringify(missingGraphBridges)}` : '',
        missingWikiBridge ? '- missing_wiki_bridge: true' : '',
        missingRelatedWiki.length ? `- missing_related_wiki: ${JSON.stringify(missingRelatedWiki)}` : '',
        missingRelatedSources.length ? `- missing_related_sources: ${JSON.stringify(missingRelatedSources)}` : '',
        `- evidence: ${evidence}`,
        '',
        `## ${label}`,
        writebackContent,
        '',
        contentText(context, '## 写回内容', '## Writeback'),
        writebackContent,
    ].filter(Boolean).join('\n');
    return buildAndWriteNoteAsync(vaultRoot, 'tracekeeper.finish_task', MEMORY_PROPOSAL_DIR, filename, {
        tool: 'tracekeeper.finish_task',
        type: 'memory_proposal',
        proposal_id: proposalId,
        title: `${label} ${taskId}`,
        proposal_kind: proposalKind,
        finish_operation_id: operationId,
        status: 'pending',
        target_note: writebackTarget?.targetNote || null,
        risk_level: 'medium',
        proposal_source_tool: 'tracekeeper.finish_task',
        proposal_source_task_id: taskId,
        proposal_source_session_note: sessionNotePath,
        project_hint: projectHint || null,
        evidence,
        created_at: now,
        task_id: taskId,
        [FINISH_TASK_PROPOSAL_SIGNATURE_KEY]: proposalSignature,
    }, body, taskId, context, proposalAuditMetadata, operationId).then((note) => ({
        path: note.path,
        proposalId,
    }));
}
async function readFinishTaskProjectMemoryStepReceipt(vaultRoot, operationId) {
    const record = await operationJournalForVault(vaultRoot).loadById(operationId);
    const result = record?.completed_steps.find((step) => step.name === 'finish-task:project-memory'
        || (step.name.startsWith('finish-task:')
            && (0, protocol_1.isRecord)(step.result)
            && (step.result.outcome === 'immutable'
                || step.result.outcome === 'review_fallback')))?.result;
    if (!(0, protocol_1.isRecord)(result)) {
        return null;
    }
    if (result.outcome === 'review_fallback') {
        return { outcome: 'review_fallback' };
    }
    if (result.outcome !== 'immutable'
        || typeof result.path !== 'string'
        || typeof result.project_id !== 'string'
        || typeof result.agent_type !== 'string'
        || typeof result.operation_id !== 'string'
        || typeof result.operation_hash !== 'string'
        || !Array.isArray(result.memory_kinds)
        || !result.memory_kinds.every((value) => typeof value === 'string')
        || (result.write_status !== 'written' && result.write_status !== 'skipped')) {
        throw new core_1.OperationConflictError('Finish-task project-memory step receipt is invalid.');
    }
    return {
        outcome: 'immutable',
        path: result.path,
        project_id: result.project_id,
        agent_type: result.agent_type,
        operation_id: result.operation_id,
        operation_hash: result.operation_hash,
        memory_kinds: [...result.memory_kinds],
        write_status: result.write_status,
    };
}
async function verifyFinishTaskProjectMemoryStepReceipt(vaultRoot, operationId, receipt, context) {
    const safePath = (0, safety_1.normalizeNotePath)(receipt.path, pathSafetyOptions(context));
    const content = await readVaultNoteContent(vaultRoot, safePath, context);
    if (!content) {
        throw new safety_1.ToolInputError(`Finish-task project-memory artifact is missing: ${safePath}`);
    }
    const frontmatter = (0, core_1.parseMarkdown)(content).frontmatter.fields;
    const memoryKinds = readFrontmatterStringList(frontmatter, 'memory_kinds').sort();
    if (readFrontmatterString(frontmatter, ['type']) !== 'project_memory_entry'
        || readFrontmatterString(frontmatter, ['project_id']) !== receipt.project_id
        || readFrontmatterString(frontmatter, ['agent_type']) !== receipt.agent_type
        || readFrontmatterString(frontmatter, ['operation_id']) !== operationId
        || readFrontmatterString(frontmatter, ['operation_hash']) !== receipt.operation_hash
        || JSON.stringify(memoryKinds) !== JSON.stringify([...receipt.memory_kinds].sort())) {
        throw new core_1.OperationConflictError('Finish-task project-memory artifact no longer matches its operation receipt.');
    }
}
async function collectFinishTaskArtifacts(vaultRoot, taskId, sessionNotePath, proposalMode, projectHint, rawMemoryScope, relatedWiki, relatedSources, architectureStatus, closeout, context, operationId, expectImmutableProjectMemory = false) {
    if (proposalMode === 'off') {
        return {
            proposals: [],
            suggestedMemoryUpdates: [],
            autoAppliedMemoryUpdates: [],
            hasMissingWikiBridge: false,
            hasMissingRelatedSources: false,
        };
    }
    const groups = buildFinishTaskCloseoutGroups(closeout, context);
    const proposals = [];
    const suggestedMemoryUpdates = [];
    const autoAppliedMemoryUpdates = [];
    const projectMemoryReceipt = await readFinishTaskProjectMemoryStepReceipt(vaultRoot, operationId);
    if (expectImmutableProjectMemory && !projectMemoryReceipt) {
        throw new core_1.OperationConflictError('Finish-task project-memory step receipt is missing.');
    }
    if (projectMemoryReceipt?.outcome === 'immutable') {
        await verifyFinishTaskProjectMemoryStepReceipt(vaultRoot, operationId, projectMemoryReceipt, context);
    }
    let projectMemoryReceiptCollected = false;
    let hasMissingWikiBridge = false;
    let hasMissingRelatedSources = false;
    for (const group of groups) {
        if (group.values.length === 0) {
            continue;
        }
        const memoryScope = resolveMemoryScope(group.kind, '', projectHint, rawMemoryScope);
        const bridgeMetadata = resolveProjectMemoryBridgeMetadata(vaultRoot, memoryScope, projectHint, relatedWiki, relatedSources, context);
        const memoryRule = memoryProposalRuleFor(group.kind, '', projectHint, context, memoryScope);
        if (memoryRule === 'disabled') {
            continue;
        }
        if (proposalMode === 'suggest') {
            suggestedMemoryUpdates.push({
                kind: group.kind,
                label: group.label,
                values: group.values,
            });
            continue;
        }
        if (proposalMode === 'auto_propose' && memoryRule === 'auto_write') {
            const canAutoWrite = !(memoryScope === 'project' &&
                bridgeMetadata.missing_wiki_bridge);
            if (memoryScope === 'project' && bridgeMetadata.missing_wiki_bridge) {
                hasMissingWikiBridge = true;
            }
            if (memoryScope === 'project' && bridgeMetadata.missing_related_sources.length > 0) {
                hasMissingRelatedSources = true;
            }
            if (canAutoWrite
                && memoryScope === 'project'
                && projectMemoryReceipt !== null) {
                if (projectMemoryReceipt?.outcome === 'immutable'
                    && !projectMemoryReceipt.memory_kinds.includes(group.kind)) {
                    throw new core_1.OperationConflictError('Finish-task project-memory receipt is missing an eligible memory kind.');
                }
                if (projectMemoryReceipt?.outcome === 'immutable'
                    && !projectMemoryReceiptCollected) {
                    autoAppliedMemoryUpdates.push({
                        kind: 'finish_task',
                        path: projectMemoryReceipt.path,
                        status: projectMemoryReceipt.write_status,
                        operation_id: projectMemoryReceipt.operation_id,
                        operation_hash: projectMemoryReceipt.operation_hash,
                        agent_type: projectMemoryReceipt.agent_type,
                        memory_kinds: [...projectMemoryReceipt.memory_kinds],
                    });
                    projectMemoryReceiptCollected = true;
                }
                if (projectMemoryReceipt?.outcome === 'immutable') {
                    continue;
                }
            }
            if (canAutoWrite
                && !(memoryScope === 'project' && projectMemoryReceipt !== null)) {
                const autoTarget = resolveAutoMemoryTarget(vaultRoot, group.kind, '', projectHint, context, memoryScope);
                if (autoTarget) {
                    const signature = buildFinishTaskProposalSignature(taskId, group.kind, group.values);
                    const targetContent = await readVaultNoteContent(vaultRoot, autoTarget.targetNote, context);
                    if (!targetContent?.includes(`content_signature: ${signature}`)) {
                        throw new safety_1.ToolInputError(`Auto memory closeout artifact is missing: ${autoTarget.targetNote}`);
                    }
                    autoAppliedMemoryUpdates.push({
                        kind: group.kind,
                        path: autoTarget.targetNote,
                        status: 'written',
                    });
                    continue;
                }
            }
        }
        const operationProposal = await findOperationOwnedNoteAsync(vaultRoot, MEMORY_PROPOSAL_DIR, `finish-task-${group.kind}-${taskId}-${operationId}`, 'finish_operation_id', operationId, context);
        const proposalPath = operationProposal?.path || findExistingFinishTaskProposal(vaultRoot, taskId, group.kind, group.values, context);
        if (!proposalPath) {
            throw new safety_1.ToolInputError(`Finish-task proposal artifact is missing for ${group.kind}.`);
        }
        const proposalId = await readRequiredProposalId(vaultRoot, proposalPath, context);
        const link = generateProposalMarkdownLink(context, proposalPath, sessionNotePath);
        proposals.push({
            kind: group.kind,
            proposalId,
            path: proposalPath,
            linkTarget: proposalPath,
            ...(link ? { link } : {}),
        });
    }
    return {
        proposals,
        suggestedMemoryUpdates,
        autoAppliedMemoryUpdates,
        hasMissingWikiBridge,
        hasMissingRelatedSources,
    };
}
function formatListMarkdown(values) {
    if (values.length === 0) {
        return '- (none)';
    }
    return values.map((item) => `- ${item}`).join('\n');
}
function coercePositiveInt(value, fallback, min = 1, max = 100) {
    if (value === undefined || value === null) {
        return fallback;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new safety_1.ToolInputError('Expected integer within allowed bounds.');
    }
    return value;
}
function coerceBoolean(value, field, fallback = false) {
    if (value === undefined || value === null) {
        return fallback;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
            return true;
        }
        if (normalized === 'false' || normalized === '0' || normalized === 'no') {
            return false;
        }
    }
    throw new safety_1.ToolInputError(`Invalid boolean argument: ${field}.`);
}
function sanitizeYamlValue(value) {
    if (value === null || value === undefined) {
        return 'null';
    }
    if (typeof value === 'string') {
        return `"${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return JSON.stringify(value);
}
function buildYamlFrontMatter(frontmatter) {
    const entries = Object.entries(frontmatter)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}: ${sanitizeYamlValue(value)}`);
    const body = entries.length === 0 ? '' : `${entries.join('\n')}`;
    return `---\n${body}\n---`;
}
function buildMarkdownNote(frontmatter, body) {
    const front = buildYamlFrontMatter(frontmatter);
    return `${front}\n\n${body.trim()}\n`;
}
function scanSensitiveText(value) {
    const patterns = [
        { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, reason: 'private key block' },
        { pattern: /\b(?:password|passwd|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*['"]?[^'"\s]+/i, reason: 'credential assignment' },
        { pattern: /[?&](?:token|access_token|refresh_token|api_key|apikey|key|secret)=([^&#\s]+)/i, reason: 'secret-like URL query parameter' },
        { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/, reason: 'secret key token' },
    ];
    for (const item of patterns) {
        if (item.pattern.test(value)) {
            return { ok: false, reason: item.reason };
        }
    }
    return { ok: true };
}
function assertNoSensitiveText(values) {
    for (const item of values) {
        if (!item.value) {
            continue;
        }
        const scan = scanSensitiveText(item.value);
        if (!scan.ok) {
            throw new safety_1.ToolInputError(`Refusing to write potential secret in ${item.label}: ${scan.reason}.`);
        }
    }
}
function toText(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value
            .map((entry) => toText(entry))
            .filter((entry) => entry.length > 0)
            .join('\n');
    }
    return '';
}
function readFrontmatterString(frontmatter, keys) {
    for (const key of keys) {
        const value = frontmatter[key];
        if (value === undefined) {
            continue;
        }
        const text = toText(value);
        if (text) {
            return text;
        }
    }
    return '';
}
function isLikelyVaultPath(value, sourceKind) {
    const trimmed = value.trim();
    if (!trimmed) {
        return false;
    }
    if (trimmed.includes('\n') || trimmed.includes('\r')) {
        return false;
    }
    if (/^https?:\/\//i.test(trimmed) || /^(mailto:|file:|ftp:)/i.test(trimmed)) {
        return false;
    }
    if (['url', 'selection', 'http', 'external'].includes(sourceKind.toLowerCase())) {
        return false;
    }
    if (trimmed.startsWith('.') && !trimmed.includes('/')) {
        return false;
    }
    return /\.(md|markdown|txt)$/i.test(trimmed) || trimmed.includes('/') || sourceKind === 'current_note' || sourceKind === 'local_file';
}
function isSourceRequestPending(status) {
    const normalized = status.toLowerCase();
    return ['pending', 'todo', 'open', 'queued', 'new'].includes(normalized);
}
function isUrlSource(source) {
    return /^https?:\/\//i.test(source.trim());
}
function safeReadNote(vaultRoot, notePath, context) {
    const options = pathSafetyOptions(context);
    const normalized = (0, safety_1.normalizeNotePath)(notePath, options);
    const absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, normalized, options);
    return {
        path: (0, safety_1.relativeFromAbsolute)(vaultRoot, absolute),
        text: fs.readFileSync(absolute, 'utf8'),
    };
}
function safeReadTextFile(vaultRoot, notePath, context) {
    const options = pathSafetyOptions(context);
    const normalized = (0, safety_1.normalizeNotePath)(notePath, options);
    const absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, normalized, options);
    (0, safety_1.assertNoSymlinkSegments)(vaultRoot, absolute);
    return fs.readFileSync(absolute, 'utf8');
}
async function safeReadTextFileAsync(vaultRoot, notePath, context) {
    if (!context.vaultRepository) {
        return safeReadTextFile(vaultRoot, notePath, context);
    }
    const normalized = (0, safety_1.normalizeNotePath)(notePath, pathSafetyOptions(context));
    const repositoryFile = await context.vaultRepository.readText(normalized);
    if (!repositoryFile) {
        throw new safety_1.ToolInputError(`Source path is not readable: ${normalized}`);
    }
    return repositoryFile.content;
}
function assertSourceRequestPath(relativePath) {
    if (!relativePath.startsWith(`${SOURCE_REQUESTS_DIR}/`)) {
        throw new safety_1.ToolInputError(`Source request path must be under ${SOURCE_REQUESTS_DIR}.`);
    }
}
function parseSourceRequest(data) {
    assertSourceRequestPath(data.path);
    const parsed = (0, core_1.parseMarkdown)(data.text);
    const frontmatter = parsed.frontmatter.fields;
    const sourceKind = readFrontmatterString(frontmatter, ['source_kind', 'sourceKind', 'source-kind']);
    const status = readFrontmatterString(frontmatter, ['status']) || 'pending';
    const requestPathRelative = data.path;
    return {
        path: requestPathRelative,
        type: readFrontmatterString(frontmatter, ['type']) || 'agent-request',
        source: readFrontmatterString(frontmatter, ['source']),
        sourceKind: sourceKind || 'unknown',
        purpose: readFrontmatterString(frontmatter, ['purpose']),
        relatedProject: readFrontmatterString(frontmatter, ['related_project', 'relatedProject']),
        analysisMode: readFrontmatterString(frontmatter, ['analysis_mode', 'analysisMode']) || 'default',
        status,
        taskId: readFrontmatterString(frontmatter, ['task_id', 'taskId']),
        created: readFrontmatterString(frontmatter, ['created']) || '',
        content: parsed.body,
        filename: requestPathRelative,
    };
}
function readSourceRequest(vaultRoot, requestPath, context) {
    return parseSourceRequest(safeReadNote(vaultRoot, requestPath, context));
}
async function readSourceRequestAsync(vaultRoot, requestPath, context) {
    if (!context.vaultRepository) {
        return readSourceRequest(vaultRoot, requestPath, context);
    }
    const normalized = (0, safety_1.normalizeNotePath)(requestPath, pathSafetyOptions(context));
    assertSourceRequestPath(normalized);
    const repositoryFile = await context.vaultRepository.readText(normalized);
    if (!repositoryFile) {
        throw new safety_1.ToolInputError(`Source request not found: ${normalized}`);
    }
    return parseSourceRequest({ path: repositoryFile.path, text: repositoryFile.content });
}
function stripYamlQuotes(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}
function assertReviewQueuePath(relativePath) {
    if (!relativePath.startsWith(`${REVIEW_QUEUE_PREFIX}/`)) {
        throw new safety_1.ToolInputError(`Memory proposal path must be under ${REVIEW_QUEUE_PREFIX}.`);
    }
}
function readProposalApprovalStatus(frontmatter) {
    return stripYamlQuotes(readFrontmatterString(frontmatter, ['approval_status', 'approvalStatus', 'status']) || 'pending')
        .toLowerCase()
        .replace(/\s+/g, '_');
}
function isMemoryProposalFrontmatter(frontmatter) {
    const type = stripYamlQuotes(readFrontmatterString(frontmatter, ['type'])).toLowerCase();
    if (!type) {
        return Boolean(readFrontmatterString(frontmatter, ['proposal_kind', 'proposalKind']));
    }
    return type.includes('memory-proposal') || type.includes('memory_proposal');
}
function memoryProposalDocumentFromText(vaultRoot, proposalPath, text, context) {
    const options = pathSafetyOptions(context);
    const normalized = (0, safety_1.normalizeNotePath)(proposalPath, options);
    const absolutePath = (0, safety_1.resolveSafeNotePath)(vaultRoot, normalized, options);
    const relative = (0, safety_1.relativeFromAbsolute)(vaultRoot, absolutePath);
    assertReviewQueuePath(relative);
    const parsed = (0, core_1.parseMarkdown)(text);
    const frontmatter = parsed.frontmatter.fields;
    if (!isMemoryProposalFrontmatter(frontmatter)) {
        throw new safety_1.ToolInputError(`Knowledge Change Review record is not a memory proposal: ${relative}`);
    }
    return {
        absolutePath,
        path: relative,
        proposalId: stripYamlQuotes(readFrontmatterString(frontmatter, ['proposal_id', 'proposalId'])) ||
            path.basename(relative, path.extname(relative)),
        proposalKind: stripYamlQuotes(readFrontmatterString(frontmatter, ['proposal_kind', 'proposalKind'])) || 'unknown',
        approvalStatus: readProposalApprovalStatus(frontmatter),
        targetNote: stripYamlQuotes(readFrontmatterString(frontmatter, ['target_note', 'targetNote'])),
        riskLevel: stripYamlQuotes(readFrontmatterString(frontmatter, ['risk_level', 'riskLevel'])) || 'unknown',
        taskId: stripYamlQuotes(readFrontmatterString(frontmatter, ['task_id', 'taskId'])),
        body: parsed.body,
        text,
        frontmatter,
    };
}
function readMemoryProposal(vaultRoot, proposalPath, context) {
    const options = pathSafetyOptions(context);
    const normalized = (0, safety_1.normalizeNotePath)(proposalPath, options);
    const absolutePath = (0, safety_1.resolveSafeNotePath)(vaultRoot, normalized, options);
    return memoryProposalDocumentFromText(vaultRoot, normalized, fs.readFileSync(absolutePath, 'utf8'), context);
}
function findMemoryProposalPathById(vaultRoot, proposalId, context) {
    const normalizedId = stripYamlQuotes(proposalId);
    if (!normalizedId) {
        throw new safety_1.ToolInputError('proposal_id is required.');
    }
    const scan = scanVaultForContext(vaultRoot, context);
    const records = scan.notes.flatMap((note) => {
        const location = (0, core_1.proposalHistoryLocation)(note.relativePath);
        const noteProposalId = explicitProposalId(note.frontmatter);
        if (!location || !noteProposalId || !isMemoryProposalFrontmatter(note.frontmatter)) {
            return [];
        }
        return [{
                path: note.relativePath,
                proposalId: noteProposalId,
                location,
                contentHash: note.contentHash,
            }];
    });
    const resolution = (0, core_1.resolveProposalHistoryById)(records, normalizedId);
    if (resolution.status === 'missing') {
        throw new safety_1.ToolInputError(`Approved writeback proposal not found: ${normalizedId}`);
    }
    if (resolution.status === 'ambiguous') {
        throw new safety_1.ToolInputError(`Approved writeback proposal id is ambiguous: ${normalizedId}`);
    }
    return resolution.record.path;
}
async function resolveMemoryProposalFromArgs(vaultRoot, rawArgs, context) {
    const explicitPath = coerceOptionalString(rawArgs.proposal_path) || coerceOptionalString(rawArgs.path);
    const proposalPath = explicitPath || (coerceOptionalString(rawArgs.proposal_id)
        ? findMemoryProposalPathById(vaultRoot, coerceOptionalString(rawArgs.proposal_id), context)
        : '');
    if (!proposalPath) {
        throw new safety_1.ToolInputError('proposal_id or proposal_path is required.');
    }
    if (context.vaultRepository) {
        const normalized = (0, safety_1.normalizeNotePath)(proposalPath, pathSafetyOptions(context));
        assertReviewQueuePath(normalized);
        const file = await context.vaultRepository.readText(normalized);
        if (!file) {
            throw new safety_1.ToolInputError(`Approved writeback proposal not found: ${normalized}`);
        }
        return memoryProposalDocumentFromText(vaultRoot, file.path, file.content, context);
    }
    return readMemoryProposal(vaultRoot, proposalPath, context);
}
function extractMarkdownSection(body, allowedHeadings) {
    const allowed = new Set(allowedHeadings.map((heading) => heading.toLowerCase()));
    const lines = body.replace(/\r\n/g, '\n').split('\n');
    const collected = [];
    let capturing = false;
    for (const line of lines) {
        const headingMatch = line.match(/^#{2,6}\s+(.+?)\s*$/);
        if (headingMatch) {
            const heading = (headingMatch[1] || '').trim().toLowerCase();
            if (capturing) {
                break;
            }
            if (allowed.has(heading)) {
                capturing = true;
            }
            continue;
        }
        if (capturing) {
            collected.push(line);
        }
    }
    return collected.join('\n').trim();
}
function buildWritebackPlan(proposal) {
    const frontmatterWriteback = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['writeback_content', 'writebackContent']));
    const writebackContent = frontmatterWriteback ||
        extractMarkdownSection(proposal.body, ['writeback', 'approved writeback', 'writeback content', '写回', '已批准写回', '写回内容']);
    if (!proposal.targetNote) {
        return {
            proposal,
            targetNote: proposal.targetNote,
            writebackContent,
            ready: false,
            reason: 'target_note is required',
        };
    }
    if (proposal.approvalStatus !== 'approved') {
        return {
            proposal,
            targetNote: proposal.targetNote,
            writebackContent,
            ready: false,
            reason: `proposal approval_status/status is ${proposal.approvalStatus}`,
        };
    }
    if (!writebackContent) {
        return {
            proposal,
            targetNote: proposal.targetNote,
            writebackContent,
            ready: false,
            reason: 'approved proposal must include ## Writeback content',
        };
    }
    return {
        proposal,
        targetNote: proposal.targetNote,
        writebackContent,
        ready: true,
    };
}
const WRITEBACK_CONFIRMATION_SCHEMA_VERSION = 1;
const DEFAULT_WRITEBACK_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const PROCESS_WRITEBACK_CONFIRMATION_SECRET = crypto.randomBytes(32);
const hashText = (value) => crypto.createHash('sha256').update(value).digest('hex');
const proposalScalarText = (value) => {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toString();
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    return '';
};
const proposalScalarField = (frontmatter, keys, label) => {
    const values = keys
        .map((key) => {
        const value = frontmatter[key];
        if (value !== undefined
            && value !== null
            && (typeof value === 'object' || typeof value === 'function')) {
            throw new core_1.ProposalTransitionValidationError(`${label} is invalid.`);
        }
        return proposalScalarText(value).trim();
    })
        .filter(Boolean);
    if (new Set(values).size > 1) {
        throw new core_1.ProposalTransitionValidationError(`${label} fields conflict.`);
    }
    return values[0] || '';
};
const proposalMultilineField = (frontmatter, keys, label) => {
    const values = keys
        .map((key) => {
        const value = frontmatter[key];
        if (Array.isArray(value)) {
            return value.map(proposalScalarText).join('\n').trim();
        }
        if (value !== undefined
            && value !== null
            && (typeof value === 'object' || typeof value === 'function')) {
            throw new core_1.ProposalTransitionValidationError(`${label} is invalid.`);
        }
        return proposalScalarText(value).replace(/\\n/g, '\n').trim();
    })
        .filter(Boolean);
    if (new Set(values).size > 1) {
        throw new core_1.ProposalTransitionValidationError(`${label} fields conflict.`);
    }
    return values[0] || '';
};
const proposalTransitionStatus = (frontmatter) => {
    const values = ['approval_status', 'approvalStatus', 'status']
        .map((key) => {
        const value = frontmatter[key];
        if (value !== undefined
            && value !== null
            && (typeof value === 'object' || typeof value === 'function')) {
            throw new core_1.ProposalTransitionValidationError('Proposal status is invalid.');
        }
        const normalized = proposalScalarText(value)
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '_');
        return normalized === 'pending_review' ? 'pending' : normalized;
    })
        .filter(Boolean);
    if (values.length === 0) {
        return 'pending';
    }
    if (values.some((value) => ![
        'pending',
        'approved',
        'rejected',
        'deferred',
        'revision_requested',
        'applied',
    ].includes(value))) {
        throw new core_1.ProposalTransitionValidationError('Proposal status is invalid.');
    }
    if (new Set(values).size > 1) {
        throw new core_1.ProposalTransitionValidationError('Proposal status fields conflict.');
    }
    return values[0];
};
function proposalTransitionSnapshot(proposal) {
    const parsed = (0, core_1.parseMarkdown)(proposal.text);
    if (parsed.frontmatter.errors.length > 0) {
        throw new core_1.ProposalTransitionValidationError('Proposal frontmatter is invalid.');
    }
    const frontmatter = parsed.frontmatter.fields;
    const proposalKind = proposalScalarField(frontmatter, ['proposal_kind', 'proposalKind'], 'Proposal kind');
    const rawType = proposalScalarField(frontmatter, ['type'], 'Proposal type');
    const normalizedType = rawType.toLowerCase().replace(/_/g, '-');
    const classification = normalizedType === 'memory-proposal'
        ? 'memory_proposal'
        : proposalKind && !rawType
            ? 'memory_proposal'
            : null;
    if (!classification) {
        throw new core_1.ProposalTransitionValidationError('Proposal is not a memory proposal.');
    }
    const frontmatterWriteback = proposalMultilineField(frontmatter, ['writeback_content', 'writebackContent'], 'Proposal writeback content');
    const bodyWriteback = extractMarkdownSection(parsed.body, ['writeback', 'approved writeback', 'writeback content', '写回', '已批准写回', '写回内容']);
    if (frontmatterWriteback
        && bodyWriteback
        && frontmatterWriteback.replace(/\r\n/g, '\n').trim()
            !== bodyWriteback.replace(/\r\n/g, '\n').trim()) {
        throw new core_1.ProposalTransitionConflictError('Proposal writeback sources conflict.');
    }
    const lastTransition = (0, core_1.proposalTransitionReceiptFromFrontmatter)(frontmatter);
    return {
        path: proposal.path,
        classification,
        proposalId: proposalScalarField(frontmatter, ['proposal_id', 'proposalId'], 'Proposal id') || path.basename(proposal.path, path.extname(proposal.path)),
        proposalKind: proposalKind || classification,
        taskId: proposalScalarField(frontmatter, ['task_id', 'taskId'], 'Task id'),
        status: proposalTransitionStatus(frontmatter),
        targetPath: proposalScalarField(frontmatter, ['target_note', 'targetNote', 'target_path', 'targetPath'], 'Proposal target'),
        writebackContent: frontmatterWriteback || bodyWriteback,
        revisionComment: proposalMultilineField(frontmatter, ['revision_comment', 'revisionComment'], 'Revision comment'),
        revisionRequestedAt: proposalScalarField(frontmatter, ['revision_requested_at', 'revisionRequestedAt'], 'Revision request time'),
        revisionRequestedBy: proposalScalarField(frontmatter, ['revision_requested_by', 'revisionRequestedBy'], 'Revision requester'),
        archived: false,
        appliedOperationId: proposalScalarField(frontmatter, ['writeback_operation_id', 'writebackOperationId'], 'Applied operation id') || (lastTransition?.kind === 'apply'
            ? lastTransition.operationId
            : undefined),
        lastTransition,
    };
}
async function readCurrentVaultTextState(vaultRoot, relativePath, context) {
    const normalized = (0, safety_1.normalizeNotePath)(relativePath, pathSafetyOptions(context));
    if (context.vaultRepository) {
        const file = await context.vaultRepository.readText(normalized);
        return file
            ? {
                path: file.path,
                content: file.content,
                contentHash: hashText(file.content),
                version: file.version,
            }
            : null;
    }
    let absolute;
    try {
        absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, normalized, pathSafetyOptions(context));
    }
    catch (error) {
        if (error instanceof core_1.VaultPathError && /not found/i.test(error.message)) {
            return null;
        }
        throw error;
    }
    (0, safety_1.assertNoSymlinkSegments)(vaultRoot, absolute);
    try {
        const content = fs.readFileSync(absolute, 'utf8');
        return {
            path: (0, safety_1.relativeFromAbsolute)(vaultRoot, absolute),
            content,
            contentHash: hashText(content),
        };
    }
    catch (error) {
        if (error instanceof Error && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
function writebackConfirmationNow(context) {
    const now = context.writebackConfirmationClock
        ? context.writebackConfirmationClock()
        : Date.now();
    if (!Number.isFinite(now) || now < 0) {
        throw new safety_1.ToolInputError('Writeback confirmation clock is invalid.');
    }
    return now;
}
function writebackConfirmationTtl(context) {
    const ttl = context.writebackConfirmationTtlMs ?? DEFAULT_WRITEBACK_CONFIRMATION_TTL_MS;
    if (!Number.isSafeInteger(ttl) || ttl <= 0) {
        throw new safety_1.ToolInputError('Writeback confirmation expiry is invalid.');
    }
    return ttl;
}
function writebackConfirmationSecret(context) {
    if (context.writebackConfirmationSecret === undefined) {
        return PROCESS_WRITEBACK_CONFIRMATION_SECRET;
    }
    const secret = typeof context.writebackConfirmationSecret === 'string'
        ? Buffer.from(context.writebackConfirmationSecret, 'utf8')
        : Buffer.from(context.writebackConfirmationSecret);
    if (secret.byteLength < 32) {
        throw new safety_1.ToolInputError('Writeback confirmation secret must contain at least 32 bytes.');
    }
    return secret;
}
function isWritebackConfirmationBinding(value) {
    if (!(0, protocol_1.isRecord)(value)) {
        return false;
    }
    const stringKeys = [
        'previewNonce',
        'operationId',
        'idempotencyKey',
        'proposalId',
        'proposalPath',
        'proposalRevision',
        'proposalContentHash',
        'proposalFileHash',
        'approvalOperationId',
        'targetPath',
        'targetContentHash',
        'proposalTaskId',
        'taskContentHash',
        'taskLinkedContentHash',
        'writebackContentHash',
        'writebackBlockHash',
        'writebackMarker',
        'auditAgentId',
        'auditSessionId',
        'auditClientName',
    ];
    const hasStableProposalReferenceFlags = typeof value.taskHadProposalIdReference === 'boolean'
        && typeof value.taskHadProposalPathEvidence === 'boolean';
    const hasPartialStableProposalReferenceFlags = value.taskHadProposalIdReference !== undefined
        || value.taskHadProposalPathEvidence !== undefined;
    return value.schemaVersion === WRITEBACK_CONFIRMATION_SCHEMA_VERSION
        && stringKeys.every((key) => typeof value[key] === 'string')
        && typeof value.previewNonce === 'string'
        && /^[a-f0-9]{32}$/.test(value.previewNonce)
        && typeof value.operationId === 'string'
        && /^writeback-[a-f0-9]{24}$/.test(value.operationId)
        && typeof value.idempotencyKey === 'string'
        && value.idempotencyKey.startsWith('apply-approved-writeback:')
        && value.idempotencyKey.length <= 2048
        && value.proposalId.length > 0
        && value.proposalRevision.length > 0
        && value.proposalContentHash.length > 0
        && value.proposalFileHash.length > 0
        && value.approvalOperationId.length > 0
        && value.targetPath.length > 0
        && value.targetContentHash.length > 0
        && value.writebackContentHash.length > 0
        && value.writebackBlockHash.length > 0
        && value.writebackMarker.length > 0
        && (value.taskId === null || typeof value.taskId === 'string')
        && (value.taskPath === null || typeof value.taskPath === 'string')
        && typeof value.taskHadTargetReference === 'boolean'
        && typeof value.taskHadProposalReference === 'boolean'
        && (!hasPartialStableProposalReferenceFlags || hasStableProposalReferenceFlags)
        && ((value.taskId === null
            && value.taskPath === null
            && value.taskContentHash === ''
            && value.taskLinkedContentHash === ''
            && value.taskHadTargetReference === false
            && value.taskHadProposalReference === false
            && value.taskHadProposalIdReference !== true
            && value.taskHadProposalPathEvidence !== true)
            || (typeof value.taskId === 'string'
                && value.taskId.length > 0
                && typeof value.taskPath === 'string'
                && value.taskPath.length > 0
                && value.taskContentHash.length > 0
                && value.taskLinkedContentHash.length > 0))
        && Array.isArray(value.touchedNotes)
        && value.touchedNotes.length >= 3
        && value.touchedNotes.length <= 4
        && value.touchedNotes.every((item) => typeof item === 'string')
        && new Set(value.touchedNotes).size === value.touchedNotes.length
        && stringKeys.every((key) => value[key].length <= 2048)
        && typeof value.issuedAt === 'number'
        && Number.isSafeInteger(value.issuedAt)
        && typeof value.expiresAt === 'number'
        && Number.isSafeInteger(value.expiresAt);
}
function createWritebackConfirmationToken(binding, context) {
    const payload = Buffer.from(JSON.stringify(binding), 'utf8').toString('base64url');
    const signature = crypto
        .createHmac('sha256', writebackConfirmationSecret(context))
        .update(payload)
        .digest('base64url');
    return `${payload}.${signature}`;
}
function parseWritebackConfirmationToken(token, context) {
    const parts = canonicalWritebackTokenParts(token);
    const expected = crypto
        .createHmac('sha256', writebackConfirmationSecret(context))
        .update(parts[0])
        .digest();
    const supplied = decodeCanonicalBase64Url(parts[1]);
    if (supplied.byteLength !== expected.byteLength || !crypto.timingSafeEqual(supplied, expected)) {
        throw new safety_1.ToolInputError('Writeback confirmation token is invalid or tampered.');
    }
    return decodeWritebackConfirmationToken(token);
}
function decodeCanonicalBase64Url(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new safety_1.ToolInputError('Writeback confirmation token is invalid.');
    }
    let decoded;
    try {
        decoded = Buffer.from(value, 'base64url');
    }
    catch {
        throw new safety_1.ToolInputError('Writeback confirmation token is invalid.');
    }
    if (decoded.toString('base64url') !== value) {
        throw new safety_1.ToolInputError('Writeback confirmation token is invalid.');
    }
    return decoded;
}
function canonicalWritebackTokenParts(token) {
    if (token.length > 16384) {
        throw new safety_1.ToolInputError('Writeback confirmation token is invalid.');
    }
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new safety_1.ToolInputError('Writeback confirmation token is invalid.');
    }
    decodeCanonicalBase64Url(parts[0]);
    const signature = decodeCanonicalBase64Url(parts[1]);
    if (signature.byteLength !== 32) {
        throw new safety_1.ToolInputError('Writeback confirmation token is invalid.');
    }
    return [parts[0], parts[1]];
}
function decodeWritebackConfirmationToken(token) {
    const parts = canonicalWritebackTokenParts(token);
    const payload = parts[0];
    let decoded;
    try {
        decoded = JSON.parse(decodeCanonicalBase64Url(payload).toString('utf8'));
    }
    catch {
        throw new safety_1.ToolInputError('Writeback confirmation token is invalid.');
    }
    if (!isWritebackConfirmationBinding(decoded)) {
        throw new safety_1.ToolInputError('Writeback confirmation token is invalid.');
    }
    return decoded;
}
function buildApprovedWritebackBlock(proposalId, writebackContent) {
    const marker = `^writeback-${proposalId.replace(/[^A-Za-z0-9._-]/g, '-')}`;
    return {
        block: [
            `## Approved Writeback: ${proposalId}`,
            '',
            writebackContent,
            '',
            marker,
        ].join('\n'),
        marker,
    };
}
function writebackTargetFrame(writebackBlock) {
    return `\n\n${writebackBlock}\n`;
}
function reversibleWritebackTargetPrefix(currentContent, payload) {
    const heading = `## Approved Writeback: ${payload.proposalId}`;
    const startMarker = `\n\n${heading}\n`;
    const start = currentContent.lastIndexOf(startMarker);
    if (start < 0 || !currentContent.endsWith(`\n${payload.writebackMarker}\n`)) {
        return null;
    }
    const block = currentContent.slice(start + 2, -1);
    const original = currentContent.slice(0, start);
    if (hashText(block) !== payload.writebackBlockHash
        || hashText(original) !== payload.targetContentHash) {
        return null;
    }
    return original;
}
function resolveWritebackTaskId(rawArgs, proposal) {
    const explicit = coerceOptionalString(rawArgs.task_id);
    if (explicit && proposal.taskId && explicit !== proposal.taskId) {
        throw new safety_1.ToolInputError('Writeback task identity changed from the approved proposal.');
    }
    return explicit || proposal.taskId || null;
}
function validateApprovedWritebackTransition(snapshot, operationId, targetPath, targetExists, context, now) {
    const approval = snapshot.lastTransition;
    if (!approval
        || approval.kind !== 'status'
        || approval.nextStatus !== 'approved'
        || !approval.operationId) {
        throw new core_1.ProposalTransitionValidationError('Approved proposal is missing its committed approval operation.');
    }
    (0, core_1.transitionProposal)(snapshot, {
        expectedRevision: (0, core_1.computeProposalRevision)(snapshot),
        expectedContentHash: (0, core_1.computeProposalContentHash)(snapshot),
        operationId,
        action: { kind: 'apply' },
    }, {
        now,
        actor: context.agentId || 'tracekeeper-runtime',
        targetAllowed: core_1.isAllowedProposalTargetPath,
        targetExists: (relativePath) => targetExists && relativePath === targetPath,
    });
}
async function prepareWritebackConfirmation(vaultRoot, proposal, plan, taskId, context, issuedAt, expiresAt, previewNonce = crypto.randomBytes(16).toString('hex')) {
    if (!plan.ready || !plan.targetNote || !plan.writebackContent) {
        throw new safety_1.ToolInputError(plan.reason || 'approved writeback is not ready to apply.');
    }
    const snapshot = proposalTransitionSnapshot(proposal);
    if (snapshot.status !== 'approved') {
        throw new safety_1.ToolInputError(`proposal approval_status/status is ${snapshot.status}`);
    }
    const targetPath = (0, safety_1.normalizeNotePath)(plan.targetNote, pathSafetyOptions(context));
    assertAllowedWritebackTarget(targetPath);
    const target = await readCurrentVaultTextState(vaultRoot, targetPath, context);
    if (!target) {
        throw new safety_1.ToolInputError(`Writeback target does not exist: ${targetPath}`);
    }
    const taskPath = taskId ? buildTaskNotePath(taskId) : null;
    const task = taskPath
        ? await readCurrentVaultTextState(vaultRoot, taskPath, context)
        : null;
    if (taskPath && !task) {
        throw new safety_1.ToolInputError(`Writeback confirmation is stale because the task does not exist: ${taskPath}`);
    }
    const taskFrontmatter = task
        ? (0, core_1.parseMarkdown)(task.content).frontmatter.fields
        : {};
    const taskHadTargetReference = task
        ? readFrontmatterStringList(taskFrontmatter, 'memory_writes').includes(targetPath)
        : false;
    const taskHadProposalIdReference = task
        ? readFrontmatterStringList(taskFrontmatter, 'proposal_ids').includes(proposal.proposalId)
        : false;
    const taskHadProposalPathEvidence = task
        ? readFrontmatterStringList(taskFrontmatter, 'proposal_paths').includes(proposal.path)
        : false;
    const taskHadProposalReference = taskHadProposalIdReference;
    const taskLinkedContent = task && (!taskHadTargetReference
        || !taskHadProposalIdReference
        || !taskHadProposalPathEvidence)
        ? updateFrontmatterFields(task.content, {
            memory_writes: mergeFrontmatterList(taskFrontmatter, 'memory_writes', [targetPath]),
            proposal_ids: mergeFrontmatterList(taskFrontmatter, 'proposal_ids', [proposal.proposalId]),
            proposal_paths: mergeFrontmatterList(taskFrontmatter, 'proposal_paths', [proposal.path]),
        })
        : task?.content || '';
    const proposalRevision = (0, core_1.computeProposalRevision)(snapshot);
    const identity = buildApprovedWritebackOperationIdentity(proposal, proposalRevision, previewNonce);
    validateApprovedWritebackTransition(snapshot, identity.operationId, targetPath, true, context, new Date(issuedAt).toISOString());
    const writeback = buildApprovedWritebackBlock(snapshot.proposalId, snapshot.writebackContent);
    const touchedNotes = [
        targetPath,
        proposal.path,
        ...(taskPath ? [taskPath] : []),
        AUDIT_LOG_PATH,
    ];
    return {
        binding: {
            schemaVersion: WRITEBACK_CONFIRMATION_SCHEMA_VERSION,
            previewNonce,
            operationId: identity.operationId,
            idempotencyKey: identity.idempotencyKey,
            proposalId: proposal.proposalId,
            proposalPath: proposal.path,
            proposalRevision,
            proposalContentHash: (0, core_1.computeProposalContentHash)(snapshot),
            proposalFileHash: (0, core_1.computePayloadHash)(proposal.text),
            approvalOperationId: snapshot.lastTransition?.operationId || '',
            targetPath,
            targetContentHash: target.contentHash,
            proposalTaskId: snapshot.taskId,
            taskId,
            taskPath,
            taskContentHash: task?.contentHash || '',
            taskLinkedContentHash: task ? hashText(taskLinkedContent) : '',
            taskHadTargetReference,
            taskHadProposalReference,
            taskHadProposalIdReference,
            taskHadProposalPathEvidence,
            writebackContentHash: hashText(snapshot.writebackContent),
            writebackBlockHash: hashText(writeback.block),
            writebackMarker: writeback.marker,
            touchedNotes,
            auditAgentId: context.agentId || 'unknown session id',
            auditSessionId: context.sessionId || '',
            auditClientName: context.clientName || '',
            issuedAt,
            expiresAt,
        },
        writebackBlock: writeback.block,
    };
}
function writebackBindingPayload(binding, confirmationToken) {
    return {
        schemaVersion: WRITEBACK_CONFIRMATION_SCHEMA_VERSION,
        proposalId: binding.proposalId,
        proposalPath: binding.proposalPath,
        proposalRevision: binding.proposalRevision,
        proposalContentHash: binding.proposalContentHash,
        proposalFileHash: binding.proposalFileHash,
        approvalOperationId: binding.approvalOperationId,
        targetPath: binding.targetPath,
        targetContentHash: binding.targetContentHash,
        proposalTaskId: binding.proposalTaskId,
        taskId: binding.taskId,
        taskPath: binding.taskPath,
        taskContentHash: binding.taskContentHash,
        taskLinkedContentHash: binding.taskLinkedContentHash,
        taskHadTargetReference: binding.taskHadTargetReference,
        taskHadProposalReference: binding.taskHadProposalReference,
        ...(typeof binding.taskHadProposalIdReference === 'boolean'
            && typeof binding.taskHadProposalPathEvidence === 'boolean'
            ? {
                taskHadProposalIdReference: binding.taskHadProposalIdReference,
                taskHadProposalPathEvidence: binding.taskHadProposalPathEvidence,
            }
            : {}),
        writebackContentHash: binding.writebackContentHash,
        writebackBlockHash: binding.writebackBlockHash,
        writebackMarker: binding.writebackMarker,
        touchedNotes: binding.touchedNotes.slice(),
        confirmationTokenHash: hashText(confirmationToken),
        confirmationExpiresAt: new Date(binding.expiresAt).toISOString(),
        auditPath: AUDIT_LOG_PATH,
        auditAgentId: binding.auditAgentId,
        auditSessionId: binding.auditSessionId,
        auditClientName: binding.auditClientName,
    };
}
function isApplyApprovedWritebackPayload(value) {
    if (!(0, protocol_1.isRecord)(value)) {
        return false;
    }
    const requiredStrings = [
        'proposalId',
        'proposalPath',
        'proposalRevision',
        'proposalContentHash',
        'proposalFileHash',
        'approvalOperationId',
        'targetPath',
        'targetContentHash',
        'proposalTaskId',
        'taskContentHash',
        'taskLinkedContentHash',
        'writebackContentHash',
        'writebackBlockHash',
        'writebackMarker',
        'confirmationTokenHash',
        'confirmationExpiresAt',
        'auditPath',
        'auditAgentId',
        'auditSessionId',
        'auditClientName',
    ];
    const hasStableProposalReferenceFlags = typeof value.taskHadProposalIdReference === 'boolean'
        && typeof value.taskHadProposalPathEvidence === 'boolean';
    const hasPartialStableProposalReferenceFlags = value.taskHadProposalIdReference !== undefined
        || value.taskHadProposalPathEvidence !== undefined;
    return value.schemaVersion === WRITEBACK_CONFIRMATION_SCHEMA_VERSION
        && requiredStrings.every((key) => typeof value[key] === 'string')
        && requiredStrings.every((key) => value[key].length <= 2048)
        && value.proposalId.length > 0
        && value.proposalId.length <= 512
        && value.proposalRevision.length > 0
        && value.proposalContentHash.length > 0
        && value.proposalFileHash.length > 0
        && value.approvalOperationId.length > 0
        && value.targetPath.length > 0
        && value.targetContentHash.length > 0
        && value.writebackContentHash.length > 0
        && value.writebackBlockHash.length > 0
        && value.writebackMarker.length > 0
        && value.confirmationTokenHash.length > 0
        && value.auditPath.length > 0
        && !Number.isNaN(Date.parse(value.confirmationExpiresAt))
        && (value.taskId === null || typeof value.taskId === 'string')
        && (value.taskId === null || value.taskId.length <= 512)
        && (value.taskPath === null || typeof value.taskPath === 'string')
        && (value.taskPath === null || value.taskPath.length <= 2048)
        && typeof value.taskHadTargetReference === 'boolean'
        && typeof value.taskHadProposalReference === 'boolean'
        && (!hasPartialStableProposalReferenceFlags || hasStableProposalReferenceFlags)
        && ((value.taskId === null
            && value.taskPath === null
            && value.taskContentHash === ''
            && value.taskLinkedContentHash === ''
            && value.taskHadTargetReference === false
            && value.taskHadProposalReference === false
            && value.taskHadProposalIdReference !== true
            && value.taskHadProposalPathEvidence !== true)
            || (typeof value.taskId === 'string'
                && value.taskId.length > 0
                && typeof value.taskPath === 'string'
                && value.taskPath.length > 0
                && value.taskContentHash.length > 0
                && value.taskLinkedContentHash.length > 0))
        && Array.isArray(value.touchedNotes)
        && value.touchedNotes.length >= 3
        && value.touchedNotes.length <= 4
        && value.touchedNotes.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 2048)
        && new Set(value.touchedNotes).size === value.touchedNotes.length;
}
function formatFrontmatterUpdateValue(value) {
    if (Array.isArray(value)) {
        return JSON.stringify(value);
    }
    if (/^[A-Za-z0-9._/-]+$/.test(value)) {
        return value;
    }
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}
function updateFrontmatterFields(content, fields) {
    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const renderedFields = Object.entries(fields)
        .filter((entry) => entry[1] !== null)
        .map(([key, value]) => `${key}: ${formatFrontmatterUpdateValue(value)}`);
    if (lines.length === 0 || lines[0].trim() !== '---') {
        return ['---', ...renderedFields, '---', normalized].join('\n');
    }
    let end = -1;
    for (let index = 1; index < lines.length; index += 1) {
        if (lines[index].trim() === '---') {
            end = index;
            break;
        }
    }
    if (end < 0) {
        return ['---', ...renderedFields, '---', normalized].join('\n');
    }
    const pending = new Map(Object.entries(fields));
    const frontmatterLines = lines.slice(1, end).flatMap((line) => {
        const pair = line.match(/^(\s*)([^:#]+):\s*(.*)$/);
        if (!pair) {
            return [line];
        }
        const key = pair[2]?.trim() || '';
        if (!pending.has(key)) {
            return [line];
        }
        const nextValue = pending.get(key);
        pending.delete(key);
        return nextValue === null || nextValue === undefined
            ? []
            : [`${pair[1] || ''}${key}: ${formatFrontmatterUpdateValue(nextValue)}`];
    });
    for (const [key, value] of pending) {
        if (value !== null) {
            frontmatterLines.push(`${key}: ${formatFrontmatterUpdateValue(value)}`);
        }
    }
    return ['---', ...frontmatterLines, '---', ...lines.slice(end + 1)].join('\n');
}
function replaceTextFileAtomically(absolutePath, content, expectedContent) {
    const tempPath = `${absolutePath}.${crypto.randomUUID()}.tmp`;
    const mode = fs.statSync(absolutePath).mode;
    try {
        fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode });
        if (expectedContent !== undefined && fs.readFileSync(absolutePath, 'utf8') !== expectedContent) {
            throw new core_1.OperationConflictError('File changed before atomic replace.');
        }
        fs.renameSync(tempPath, absolutePath);
    }
    catch (error) {
        try {
            fs.unlinkSync(tempPath);
        }
        catch {
        }
        throw error;
    }
}
function assertAllowedWritebackTarget(relativePath) {
    if (!(0, core_1.isAllowedProposalTargetPath)(relativePath)) {
        throw new safety_1.ToolInputError(`Approved writeback target is outside the allowed Memory or Wiki boundary: ${relativePath}`);
    }
    const forbiddenPrefixes = [
        '00_control/',
        '01_inbox/',
        '03_sources/',
        '06_outputs/',
        '00_tracekeeper/control/',
        '00_tracekeeper/inbox/',
        '00_tracekeeper/work/',
        '01_knowledge/sources/',
    ];
    for (const prefix of forbiddenPrefixes) {
        if (relativePath.startsWith(prefix)) {
            throw new safety_1.ToolInputError(`Approved writeback target is protected from direct apply: ${relativePath}`);
        }
    }
}
function extractSelectionText(sourceBody) {
    const marker = '## Selected Text';
    const markerIndex = sourceBody.indexOf(marker);
    if (markerIndex >= 0) {
        const selected = sourceBody.slice(markerIndex + marker.length).trim();
        return selected
            .split('\n')
            .map((line) => line.replace(/^>\s?/, ''))
            .join('\n')
            .trim();
    }
    const bodyLines = sourceBody.split('\n');
    const contentLines = [];
    let started = false;
    for (const line of bodyLines) {
        if (!started) {
            if (line.startsWith('- ')) {
                continue;
            }
            if (line.startsWith('#')) {
                continue;
            }
            if (line.trim() === '') {
                continue;
            }
            started = true;
        }
        contentLines.push(line);
    }
    return contentLines.join('\n').trim();
}
function resolveRequestStatusPath(vaultRoot, requestPath, context) {
    const options = pathSafetyOptions(context);
    const normalized = (0, safety_1.normalizeNotePath)(requestPath, options);
    const absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, normalized, options);
    const relative = (0, safety_1.relativeFromAbsolute)(vaultRoot, absolute);
    assertSourceRequestPath(relative);
    (0, safety_1.assertNoSymlinkSegments)(vaultRoot, absolute);
    return absolute;
}
function updateRequestStatus(vaultRoot, requestPath, nextStatus, context) {
    const absolutePath = resolveRequestStatusPath(vaultRoot, requestPath, context);
    const text = fs.readFileSync(absolutePath, 'utf8');
    const updated = buildRequestStatusUpdate(text, requestPath, nextStatus);
    fs.writeFileSync(absolutePath, updated, 'utf8');
    return {
        path: (0, safety_1.relativeFromAbsolute)(vaultRoot, absolutePath),
    };
}
function buildRequestStatusUpdate(text, requestPath, nextStatus) {
    const fmMatch = text.match(/^---\n[\s\S]*?\n---\n?/);
    if (!fmMatch) {
        throw new safety_1.ToolInputError(`Request note does not have frontmatter: ${requestPath}`);
    }
    const fmBlock = fmMatch[0];
    const fmStart = fmBlock.length;
    const body = text.slice(fmStart);
    const hasStatus = /^status:\s*/m.test(fmBlock);
    let updatedFrontmatter = fmBlock;
    if (hasStatus) {
        updatedFrontmatter = fmBlock.replace(/^status:\s*.*$/m, `status: ${nextStatus}`);
    }
    else {
        updatedFrontmatter = fmBlock.replace(/\n---\n?$/, `\nstatus: ${nextStatus}\n---\n`);
    }
    return `${updatedFrontmatter}${body}`;
}
async function updateRequestStatusAsync(vaultRoot, requestPath, nextStatus, context) {
    if (!context.vaultRepository) {
        return updateRequestStatus(vaultRoot, requestPath, nextStatus, context);
    }
    const normalized = (0, safety_1.normalizeNotePath)(requestPath, pathSafetyOptions(context));
    assertSourceRequestPath(normalized);
    const repositoryFile = await context.vaultRepository.readText(normalized);
    if (!repositoryFile) {
        throw new safety_1.ToolInputError(`Source request not found: ${normalized}`);
    }
    const updated = buildRequestStatusUpdate(repositoryFile.content, repositoryFile.path, nextStatus);
    await context.vaultRepository.replaceText(repositoryFile.path, repositoryFile.version, updated);
    return { path: repositoryFile.path };
}
function parseOptionalIntendedSourcePath(rawSource, sourceKind) {
    const source = rawSource.trim();
    if (!source) {
        return {};
    }
    if (isUrlSource(source)) {
        return {};
    }
    if (!isLikelyVaultPath(source, sourceKind)) {
        return {};
    }
    return { requestedPath: source };
}
function buildProjectCounts(scan) {
    const typeCount = {};
    for (const note of scan) {
        const type = note.type ?? 'note';
        typeCount[type] = (typeCount[type] ?? 0) + 1;
    }
    return Object.entries(typeCount)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([type, count]) => ({ type, count }));
}
function buildRecentSessions(notes) {
    return notes
        .filter((note) => note.relativePath.startsWith(`${SESSION_NOTE_DIR}/`))
        .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
        .slice(0, 5)
        .map((note) => ({
        path: note.relativePath,
        title: note.title,
        modifiedAt: note.modifiedAt,
    }));
}
function buildUserPreferences(scan) {
    const isPreferenceScalar = (value) => {
        if (typeof value === 'string') {
            return value.trim() !== '';
        }
        return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint';
    };
    const isPreferenceKey = (key) => key.includes('pref') || key.includes('preference') || key.includes('goal') || key.includes('style');
    const formatPreferenceValue = (value) => {
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'number') {
            return `${value}`;
        }
        if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        }
        return value.toString();
    };
    const preferenceNote = scan.notes.find((note) => note.relativePath === '01_ai_core/longterm_context.md' || note.relativePath === '01_ai_core/active_context.md');
    if (!preferenceNote) {
        return { source: null, keys: [] };
    }
    const keys = Object.entries(preferenceNote.frontmatter)
        .filter((entry) => isPreferenceScalar(entry[1]))
        .filter(([key]) => isPreferenceKey(key))
        .map(([key, value]) => `${key}: ${formatPreferenceValue(value)}`);
    return {
        source: preferenceNote.relativePath,
        keys,
    };
}
function auditSectionField(body, key) {
    const pattern = new RegExp(`^\\s*-?\\s*${key}:\\s*(.*)$`);
    for (const line of body) {
        const match = line.match(pattern);
        if (match) {
            return stripYamlQuotes(match[1]?.trim() || '');
        }
    }
    return '';
}
function parseAuditSections(content, sourcePath, sourceKind) {
    const lines = content.split('\n');
    const sections = [];
    let currentHeading = '';
    let currentBody = [];
    let currentLine = 0;
    let started = false;
    const appendCurrent = () => {
        const timestamp = auditSectionField(currentBody, 'timestamp')
            || currentHeading.match(/\d{4}-\d{2}-\d{2}T[^\s]+/)?.[0]
            || '';
        sections.push({
            heading: currentHeading,
            body: currentBody,
            atLine: currentLine,
            auditEventId: auditSectionField(currentBody, 'audit_event_id') || undefined,
            timestamp,
            sourcePath,
            sourceKind,
            action: auditSectionField(currentBody, 'action'),
        });
    };
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const match = line.match(/^#{2,6}\s+(.+)$/);
        if (match) {
            if (started) {
                appendCurrent();
            }
            started = true;
            currentHeading = match[1]?.trim() ?? 'section';
            currentBody = [];
            currentLine = index + 1;
            continue;
        }
        if (!started) {
            continue;
        }
        currentBody.push(line);
    }
    if (started) {
        appendCurrent();
    }
    return sections;
}
const isAuditShardRecordPath = (relativePath) => new RegExp(`^${AUDIT_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d{4}/\\d{4}-\\d{2}-\\d{2}\\.md$`).test(relativePath);
function directAuditShardPaths(vaultRoot) {
    const normalizedDirectory = (0, safety_1.normalizeNotePath)(AUDIT_DIR);
    const absoluteDirectory = path.resolve(vaultRoot, normalizedDirectory);
    (0, safety_1.relativeFromAbsolute)(vaultRoot, absoluteDirectory);
    (0, safety_1.assertNoSymlinkSegments)(vaultRoot, absoluteDirectory);
    if (!fs.existsSync(absoluteDirectory)) {
        return [];
    }
    const rootState = fs.lstatSync(absoluteDirectory);
    if (!rootState.isDirectory()) {
        throw new core_1.VaultPathError('Audit shard path is not a directory.');
    }
    const paths = [];
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                throw new core_1.VaultPathError('Audit shard path contains a symbolic link.');
            }
            if (entry.isDirectory()) {
                visit(absolute);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const relative = (0, safety_1.relativeFromAbsolute)(vaultRoot, absolute);
            if (isAuditShardRecordPath(relative)) {
                paths.push(relative);
            }
        }
    };
    visit(absoluteDirectory);
    return paths.sort();
}
async function readMergedAuditSections(vaultRoot, context) {
    const documents = [];
    if (context.vaultRepository) {
        const legacy = await context.vaultRepository.readText(AUDIT_LOG_PATH);
        if (legacy) {
            documents.push({
                path: legacy.path,
                content: legacy.content,
                sourceKind: 'legacy',
            });
        }
        const metadata = await context.vaultRepository.listMarkdown(AUDIT_DIR);
        for (const item of [...metadata].sort((left, right) => left.path.localeCompare(right.path))) {
            if (!isAuditShardRecordPath(item.path)) {
                continue;
            }
            const file = await context.vaultRepository.readText(item.path);
            if (file) {
                documents.push({
                    path: file.path,
                    content: file.content,
                    sourceKind: 'shard',
                });
            }
        }
    }
    else {
        try {
            const absoluteLegacy = (0, safety_1.resolveSafeNotePath)(vaultRoot, AUDIT_LOG_PATH, pathSafetyOptions(context));
            documents.push({
                path: (0, safety_1.relativeFromAbsolute)(vaultRoot, absoluteLegacy),
                content: fs.readFileSync(absoluteLegacy, 'utf8'),
                sourceKind: 'legacy',
            });
        }
        catch (error) {
            if (!(error instanceof safety_1.ToolInputError || error instanceof core_1.VaultPathError)) {
                throw error;
            }
        }
        for (const shardPath of directAuditShardPaths(vaultRoot)) {
            const absolute = path.resolve(vaultRoot, shardPath);
            (0, safety_1.assertNoSymlinkSegments)(vaultRoot, absolute);
            documents.push({
                path: shardPath,
                content: fs.readFileSync(absolute, 'utf8'),
                sourceKind: 'shard',
            });
        }
    }
    const merged = (0, core_1.mergeAuditEvents)(documents.flatMap((document) => parseAuditSections(document.content, document.path, document.sourceKind)));
    return merged.map((section) => ({
        heading: section.heading,
        body: section.body.filter((line) => !/^\s*-?\s*audit_event_id:\s*/.test(line)),
        at_line: section.atLine,
        audit_event_id: section.auditEventId || '',
        timestamp: section.timestamp,
        source_path: section.sourcePath,
        source_kind: section.sourceKind,
        action: section.action,
    }));
}
function isPendingProposal(note) {
    const status = readProposalApprovalStatus(note.frontmatter);
    if (!['pending', 'todo', 'open', 'review'].some((token) => status.includes(token))) {
        return false;
    }
    const proposalKind = readFrontmatterString(note.frontmatter, ['proposal_kind', 'proposalKind']);
    if (typeof proposalKind === 'string' && proposalKind.toLowerCase().trim() === 'memory') {
        return true;
    }
    if (typeof proposalKind === 'string' && proposalKind.toLowerCase().includes('proposal')) {
        return true;
    }
    return true;
}
function coerceCaptureMode(value) {
    const mode = coerceNonEmptyString(value, true, 'mode').toLowerCase();
    switch (mode) {
        case 'external_reference':
        case 'extracted_snapshot':
        case 'local_copy':
            return mode;
        default:
            throw new safety_1.ToolInputError('capture_source mode must be one of: external_reference | extracted_snapshot | local_copy');
    }
}
function buildSafeFilename(rawFilename, fallbackPrefix, context) {
    const candidate = coerceOptionalString(rawFilename);
    if (candidate) {
        return (0, safety_1.normalizeNotePath)(candidate, pathSafetyOptions(context));
    }
    const now = new Date().toISOString().replace(/[:.]/g, '-');
    const token = crypto.randomUUID().slice(0, 8);
    return `${fallbackPrefix}_${now}_${token}`;
}
function toErrorMessage(error) {
    if (error instanceof Error) {
        return error.message || 'Unknown error.';
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error === undefined || error === null) {
        return 'Unknown error.';
    }
    return typeof error === 'number' || typeof error === 'boolean'
        ? String(error)
        : (() => {
            try {
                const json = JSON.stringify(error);
                if (typeof json === 'string' && json.length > 0) {
                    return json;
                }
            }
            catch {
                // Intentionally fall through to generic message.
            }
            return 'Unknown error.';
        })();
}
function boundedWritebackErrorMessage(error, vaultRoot) {
    const isExpected = error instanceof safety_1.ToolInputError
        || error instanceof core_1.VaultPathError
        || error instanceof core_1.OperationConflictError
        || error instanceof core_1.ProposalTransitionValidationError
        || error instanceof core_1.ProposalTransitionStateError;
    if (!isExpected) {
        return 'Approved writeback failed at a protected Vault boundary.';
    }
    let message = toErrorMessage(error)
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (vaultRoot) {
        message = message.split(vaultRoot).join('<vault>');
    }
    message = message
        .replace(/(^|[\s("'`])\/(?:[^\s"'`<>|:]+\/?)+/g, (_match, prefix) => `${prefix}<absolute-path>`)
        .replace(/(^|[\s("'`])[A-Za-z]:\\(?:[^\s"'`<>|]+\\?)+/g, (_match, prefix) => `${prefix}<absolute-path>`);
    return truncateSummaryText(message || 'Approved writeback failed.', 512);
}
function buildAndWriteNote(vaultRoot, toolName, allowedDir, filename, frontmatter, body, taskId, context, metadata = {}, operationId = '') {
    const options = pathSafetyOptions(context);
    const safeLeaf = (0, safety_1.normalizeNotePath)(filename, options);
    const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
    const targetPath = `${allowedDir}/${normalized}`;
    const resolved = (0, safety_1.resolveSafeWritableNotePath)(vaultRoot, targetPath, allowedDir, options);
    fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });
    if (fs.existsSync(resolved.absolutePath)) {
        throw new safety_1.ToolInputError(`Target already exists: ${resolved.relativePath}`);
    }
    const markdown = buildMarkdownNote(frontmatter, body);
    fs.writeFileSync(resolved.absolutePath, markdown, 'utf8');
    const audit = appendAuditEvent(vaultRoot, {
        operationId,
        tool: toolName,
        targetPath: resolved.relativePath,
        status: 'written',
        taskId,
        metadata,
    });
    return {
        path: resolved.relativePath,
        audit_path: audit.path,
        status: 'written',
        warnings: [],
    };
}
async function buildAndWriteNoteAsync(vaultRoot, toolName, allowedDir, filename, frontmatter, body, taskId, context, metadata = {}, operationId = '') {
    const options = pathSafetyOptions(context);
    const safeLeaf = (0, safety_1.normalizeNotePath)(filename, options);
    const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
    const targetPath = `${allowedDir}/${normalized}`;
    const markdown = buildMarkdownNote(frontmatter, body);
    if (!context.vaultRepository) {
        return buildAndWriteNote(vaultRoot, toolName, allowedDir, filename, frontmatter, body, taskId, context, metadata, operationId);
    }
    try {
        await context.vaultRepository.createText(targetPath, markdown);
    }
    catch (error) {
        if (error instanceof Error && error.message.includes('Target already exists')) {
            throw new safety_1.ToolInputError(`Target already exists: ${targetPath}`);
        }
        throw error;
    }
    const audit = await appendAuditEventAsync(vaultRoot, {
        operationId,
        tool: toolName,
        targetPath,
        status: 'written',
        taskId,
        metadata,
    }, context);
    return {
        path: targetPath,
        audit_path: audit.path,
        status: 'written',
        warnings: [],
    };
}
function findOperationOwnedNote(vaultRoot, allowedDir, filename, operationField, operationId, context) {
    const safeLeaf = (0, safety_1.normalizeNotePath)(filename, pathSafetyOptions(context));
    const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
    const relativePath = `${allowedDir}/${normalized}`;
    const absolutePath = path.resolve(vaultRoot, relativePath);
    (0, safety_1.relativeFromAbsolute)(vaultRoot, absolutePath);
    (0, safety_1.assertNoSymlinkSegments)(vaultRoot, absolutePath);
    if (!fs.existsSync(absolutePath)) {
        return null;
    }
    const parsed = (0, core_1.parseMarkdown)(fs.readFileSync(absolutePath, 'utf8'));
    const existingOperationId = stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, [operationField]));
    if (existingOperationId !== operationId) {
        throw new core_1.OperationConflictError(`Note path is already owned by another operation: ${relativePath}`);
    }
    return { path: relativePath, audit_path: AUDIT_LOG_PATH, status: 'skipped', warnings: [] };
}
function resolveExistingOrNewAutoMemoryTarget(vaultRoot, targetNote, allowedDir, context) {
    const options = pathSafetyOptions(context);
    const normalizedTarget = (0, safety_1.normalizeNotePath)(targetNote, options);
    if (!normalizedTarget.startsWith(`${allowedDir}/`)) {
        throw new safety_1.ToolInputError(`Auto memory target must be under ${allowedDir}`);
    }
    try {
        const absolutePath = (0, safety_1.resolveSafeNotePath)(vaultRoot, normalizedTarget, options);
        const relativePath = (0, safety_1.relativeFromAbsolute)(vaultRoot, absolutePath);
        if (!relativePath.startsWith(`${allowedDir}/`) || !relativePath.endsWith('.md')) {
            throw new safety_1.ToolInputError(`Auto memory target must be a markdown note under ${allowedDir}`);
        }
        assertAllowedWritebackTarget(relativePath);
        return { absolutePath, relativePath, created: false };
    }
    catch (error) {
        if (!(error instanceof core_1.VaultPathError)) {
            throw error;
        }
        const resolved = (0, safety_1.resolveSafeWritableNotePath)(vaultRoot, normalizedTarget, allowedDir, options);
        assertAllowedWritebackTarget(resolved.relativePath);
        return { absolutePath: resolved.absolutePath, relativePath: resolved.relativePath, created: true };
    }
}
function ensureProjectMemoryIndex(vaultRoot, targetRelativePath, input) {
    if (!targetRelativePath.startsWith(`${core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
        return null;
    }
    const suffix = targetRelativePath.slice(`${core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`.length);
    const projectSlug = suffix.split('/', 1)[0] || '';
    if (!projectSlug) {
        return null;
    }
    const indexPath = `${core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/${projectSlug}/index.md`;
    const absolutePath = path.join(vaultRoot, indexPath);
    if (fs.existsSync(absolutePath)) {
        return indexPath;
    }
    const displayName = input.projectHint || projectSlug;
    const relatedWikiLinks = dedupeAndNormalizeList(input.relatedWiki || []).map((link) => `- [[${link.replace(/\.md$/i, '')}]]`);
    const title = contentText(input.context, `项目记忆：${displayName}`, `Project memory: ${displayName}`);
    const markdown = buildMarkdownNote({
        type: 'project_memory_index',
        title,
        project_hint: input.projectHint || projectSlug,
        related_wiki: input.relatedWiki || [],
        created_at: new Date().toISOString(),
    }, [
        `# ${title}`,
        '',
        contentText(input.context, '## 相关 Wiki', '## Related wiki'),
        ...(relatedWikiLinks.length > 0 ? relatedWikiLinks : [contentText(input.context, '- （无）', '- (none)')]),
    ].join('\n'));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, markdown, 'utf8');
    return indexPath;
}
async function ensureProjectMemoryIndexAsync(vaultRoot, targetRelativePath, input) {
    if (!input.context.vaultRepository) {
        return ensureProjectMemoryIndex(vaultRoot, targetRelativePath, input);
    }
    if (!targetRelativePath.startsWith(`${core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
        return null;
    }
    const suffix = targetRelativePath.slice(`${core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`.length);
    const projectSlug = suffix.split('/', 1)[0] || '';
    if (!projectSlug) {
        return null;
    }
    const indexPath = `${core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/${projectSlug}/index.md`;
    if (await input.context.vaultRepository.readText(indexPath)) {
        return indexPath;
    }
    const displayName = input.projectHint || projectSlug;
    const relatedWikiLinks = dedupeAndNormalizeList(input.relatedWiki || []).map((link) => `- [[${link.replace(/\.md$/i, '')}]]`);
    const title = contentText(input.context, `项目记忆：${displayName}`, `Project memory: ${displayName}`);
    const markdown = buildMarkdownNote({
        type: 'project_memory_index',
        title,
        project_hint: input.projectHint || projectSlug,
        related_wiki: input.relatedWiki || [],
        created_at: new Date().toISOString(),
    }, [
        `# ${title}`,
        '',
        contentText(input.context, '## 相关 Wiki', '## Related wiki'),
        ...(relatedWikiLinks.length > 0 ? relatedWikiLinks : [contentText(input.context, '- （无）', '- (none)')]),
    ].join('\n'));
    await input.context.vaultRepository.createText(indexPath, markdown);
    return indexPath;
}
function buildAutoMemoryWriteBlock(input, signature) {
    const blockId = `memory-${signature.slice(0, 16).replace(/[^A-Za-z0-9._-]/g, '-')}`;
    const graphLinks = dedupeAndNormalizeList([
        ...(input.relatedWiki || []).map((link) => `[[${link.replace(/\.md$/i, '')}]]`),
        ...(input.relatedSources || []).map((link) => `[[${link.replace(/\.md$/i, '')}]]`),
    ]);
    return [
        `## ${input.title}`,
        '',
        `- source: ${input.toolName}`,
        `- kind: ${input.proposalKind}`,
        `- memory_scope: ${input.memoryScope}`,
        input.operationId ? `- operation_id: ${input.operationId}` : '',
        input.taskId ? `- task_id: ${input.taskId}` : '',
        input.projectHint ? `- project_hint: ${input.projectHint}` : '',
        input.sourceNote ? `- source_note: ${input.sourceNote}` : '',
        input.evidence ? `- evidence: ${input.evidence}` : '',
        input.relatedWiki?.length ? `- related_wiki: ${JSON.stringify(input.relatedWiki)}` : '',
        input.relatedSources?.length ? `- related_sources: ${JSON.stringify(input.relatedSources)}` : '',
        `- architecture_status: ${input.architectureStatus.architecture_status}`,
        input.missingGraphBridges?.length ? `- missing_graph_bridges: ${JSON.stringify(input.missingGraphBridges)}` : '',
        input.missingWikiBridge ? '- missing_wiki_bridge: true' : '',
        input.missingRelatedWiki?.length ? `- missing_related_wiki: ${JSON.stringify(input.missingRelatedWiki)}` : '',
        input.missingRelatedSources?.length ? `- missing_related_sources: ${JSON.stringify(input.missingRelatedSources)}` : '',
        input.riskLevel ? `- risk_level: ${input.riskLevel}` : '',
        `- created_at: ${new Date().toISOString()}`,
        `- content_signature: ${signature}`,
        '',
        contentText(input.context, '### 图谱链接', '### Graph links'),
        ...(graphLinks.length > 0 ? graphLinks.map((link) => `- ${link}`) : [contentText(input.context, '- （无）', '- (none)')]),
        '',
        contentText(input.context, '### 记忆更新', '### Memory update'),
        input.content.trim(),
        '',
        `^${blockId}`,
    ].filter(Boolean).join('\n');
}
function appendAutoMemoryWrite(vaultRoot, input) {
    assertNoSensitiveText([
        { label: 'content', value: input.content },
        { label: 'target_note', value: input.targetNote },
        { label: 'project_hint', value: input.projectHint || '' },
        { label: 'evidence', value: input.evidence || '' },
    ]);
    const signature = input.signature || crypto
        .createHash('sha256')
        .update(JSON.stringify({
        toolName: input.toolName,
        proposalKind: input.proposalKind,
        targetNote: input.targetNote,
        taskId: input.taskId,
        content: input.content.trim(),
    }))
        .digest('hex');
    const target = resolveExistingOrNewAutoMemoryTarget(vaultRoot, input.targetNote, input.allowedDir, input.context);
    const projectIndexPath = ensureProjectMemoryIndex(vaultRoot, target.relativePath, input);
    const block = buildAutoMemoryWriteBlock(input, signature);
    if (!target.created) {
        const current = fs.readFileSync(target.absolutePath, 'utf8');
        if (current.includes(`content_signature: ${signature}`)) {
            const audit = appendAuditEvent(vaultRoot, {
                tool: input.toolName,
                targetPath: target.relativePath,
                status: 'skipped',
                operationId: input.operationId,
                taskId: input.taskId,
                metadata: {
                    action: 'memory.auto_write.duplicate',
                    proposal_kind: input.proposalKind,
                    memory_rule: 'auto_write',
                    content_signature: signature,
                },
            });
            return {
                path: target.relativePath,
                audit_path: audit.path,
                status: 'skipped',
                warnings: [],
                duplicate: true,
            };
        }
        fs.writeFileSync(target.absolutePath, `${current.replace(/\s*$/, '')}\n\n${block}\n`, 'utf8');
    }
    else {
        fs.mkdirSync(path.dirname(target.absolutePath), { recursive: true });
        const title = input.projectHint
            ? contentText(input.context, `项目记忆：${input.projectHint}`, `Project memory: ${input.projectHint}`)
            : contentText(input.context, 'Tracekeeper 记忆', 'Tracekeeper memory');
        const markdown = buildMarkdownNote({
            type: 'memory',
            title,
            project_hint: input.projectHint || null,
            memory_scope: input.memoryScope,
            related_wiki: input.relatedWiki || [],
            related_sources: input.relatedSources || [],
            created_at: new Date().toISOString(),
        }, [`# ${title}`, '', block].join('\n'));
        fs.writeFileSync(target.absolutePath, markdown, 'utf8');
    }
    const audit = appendAuditEvent(vaultRoot, {
        tool: input.toolName,
        targetPath: target.relativePath,
        status: 'written',
        operationId: input.operationId,
        taskId: input.taskId,
        metadata: {
            action: 'memory.auto_write',
            proposal_kind: input.proposalKind,
            memory_rule: 'auto_write',
            content_signature: signature,
            project_index: projectIndexPath || undefined,
        },
    });
    return {
        path: target.relativePath,
        audit_path: audit.path,
        status: 'written',
        warnings: [],
        duplicate: false,
    };
}
async function appendAutoMemoryWriteAsync(vaultRoot, input) {
    assertNoSensitiveText([
        { label: 'content', value: input.content },
        { label: 'target_note', value: input.targetNote },
        { label: 'project_hint', value: input.projectHint || '' },
        { label: 'evidence', value: input.evidence || '' },
    ]);
    const signature = input.signature || crypto
        .createHash('sha256')
        .update(JSON.stringify({
        toolName: input.toolName,
        proposalKind: input.proposalKind,
        targetNote: input.targetNote,
        taskId: input.taskId,
        content: input.content.trim(),
    }))
        .digest('hex');
    if (!input.context.vaultRepository) {
        return appendAutoMemoryWrite(vaultRoot, input);
    }
    const targetPath = (0, safety_1.normalizeNotePath)(input.targetNote, pathSafetyOptions(input.context));
    if (!targetPath.startsWith(`${input.allowedDir}/`) || !targetPath.endsWith('.md')) {
        throw new safety_1.ToolInputError(`Auto memory target must be a markdown note under ${input.allowedDir}`);
    }
    assertAllowedWritebackTarget(targetPath);
    const existing = await input.context.vaultRepository.readText(targetPath);
    const projectIndexPath = await ensureProjectMemoryIndexAsync(vaultRoot, targetPath, input);
    const block = buildAutoMemoryWriteBlock(input, signature);
    if (existing) {
        if (existing.content.includes(`content_signature: ${signature}`)) {
            const audit = await appendAuditEventAsync(vaultRoot, {
                tool: input.toolName,
                targetPath,
                status: 'skipped',
                operationId: input.operationId,
                taskId: input.taskId,
                metadata: {
                    action: 'memory.auto_write.duplicate',
                    proposal_kind: input.proposalKind,
                    memory_rule: 'auto_write',
                    content_signature: signature,
                },
            }, input.context);
            return {
                path: targetPath,
                audit_path: audit.path,
                status: 'skipped',
                warnings: [],
                duplicate: true,
            };
        }
        const next = `${existing.content.replace(/\s*$/, '')}\n\n${block}\n`;
        await input.context.vaultRepository.replaceText(targetPath, existing.version, next);
    }
    else {
        const title = input.projectHint
            ? contentText(input.context, `项目记忆：${input.projectHint}`, `Project memory: ${input.projectHint}`)
            : contentText(input.context, 'Tracekeeper 记忆', 'Tracekeeper memory');
        const markdown = buildMarkdownNote({
            type: 'memory',
            title,
            project_hint: input.projectHint || null,
            memory_scope: input.memoryScope,
            related_wiki: input.relatedWiki || [],
            related_sources: input.relatedSources || [],
            created_at: new Date().toISOString(),
        }, [`# ${title}`, '', block].join('\n'));
        await input.context.vaultRepository.createText(targetPath, markdown);
    }
    const audit = await appendAuditEventAsync(vaultRoot, {
        tool: input.toolName,
        targetPath,
        status: 'written',
        operationId: input.operationId,
        taskId: input.taskId,
        metadata: {
            action: 'memory.auto_write',
            proposal_kind: input.proposalKind,
            memory_rule: 'auto_write',
            content_signature: signature,
            project_index: projectIndexPath || undefined,
        },
    }, input.context);
    return {
        path: targetPath,
        audit_path: audit.path,
        status: 'written',
        warnings: [],
        duplicate: false,
    };
}
async function writeImmutableProjectMemory(vaultRoot, input) {
    const result = await projectMemoryApplication(vaultRoot, input.context).createImmutableEntry({
        projectId: input.projectId,
        projectHint: input.projectHint,
        repoPath: input.repoPath,
        agentType: input.agentType,
        taskId: input.taskId,
        operationId: input.operationId,
        operationKind: input.operationKind,
        memoryKinds: input.memoryKinds,
        body: input.body,
        relatedWikiPaths: input.relatedWiki,
        relatedSourcePaths: input.relatedSources,
        createdAt: input.createdAt,
    });
    if (result.status === 'review_required') {
        return result;
    }
    const duplicate = result.status === 'exact_retry';
    const audit = await appendAuditEventAsync(vaultRoot, {
        tool: input.toolName,
        targetPath: result.path,
        status: duplicate ? 'skipped' : 'written',
        operationId: input.operationId,
        taskId: input.taskId,
        metadata: {
            action: duplicate
                ? 'project_memory.immutable_write.exact_retry'
                : 'project_memory.immutable_write.created',
            project_id: result.project_id,
            project_hub: result.project_hub,
            agent_type: result.agent_type,
            operation_kind: result.operation_kind,
            memory_kinds: result.memory_kinds,
            operation_hash: result.operation_hash,
            hub_status: result.hub_status,
        },
    }, input.context);
    return {
        ...result,
        audit_path: audit.path,
        write_status: duplicate ? 'skipped' : 'written',
        duplicate,
    };
}
async function findOperationOwnedNoteAsync(vaultRoot, allowedDir, filename, operationField, operationId, context) {
    const safeLeaf = (0, safety_1.normalizeNotePath)(filename, pathSafetyOptions(context));
    const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
    const relativePath = `${allowedDir}/${normalized}`;
    const options = pathSafetyOptions(context);
    if (context.vaultRepository) {
        const repositoryFile = await context.vaultRepository.readText(relativePath);
        if (!repositoryFile) {
            return null;
        }
        const parsed = (0, core_1.parseMarkdown)(repositoryFile.content);
        const existingOperationId = stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, [operationField]));
        if (existingOperationId !== operationId) {
            throw new core_1.OperationConflictError(`Note path is already owned by another operation: ${relativePath}`);
        }
        return { path: relativePath, audit_path: AUDIT_LOG_PATH, status: 'skipped', warnings: [] };
    }
    const absolutePath = path.resolve(vaultRoot, relativePath);
    (0, safety_1.relativeFromAbsolute)(vaultRoot, absolutePath);
    (0, safety_1.assertNoSymlinkSegments)(vaultRoot, absolutePath);
    if (!fs.existsSync(absolutePath)) {
        return null;
    }
    const parsed = (0, core_1.parseMarkdown)(fs.readFileSync(absolutePath, 'utf8'));
    const existingOperationId = stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, [operationField]));
    if (existingOperationId !== operationId) {
        throw new core_1.OperationConflictError(`Note path is already owned by another operation: ${relativePath}`);
    }
    return { path: relativePath, audit_path: AUDIT_LOG_PATH, status: 'skipped', warnings: [] };
}
function buildTaskNotePath(taskId) {
    const safeId = taskId
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
    if (!safeId) {
        throw new safety_1.ToolInputError('task_id must contain at least one safe filename character.');
    }
    return `${AGENT_TASK_DIR}/${safeId}.md`;
}
function emptyAgentTaskMetadata() {
    return {
        projectHint: '',
        projectId: '',
        repoPath: '',
        source: 'unknown',
        confidence: 'uncertain',
        warnings: [],
        client: '',
    };
}
function agentTaskMetadataFromFrontmatter(frontmatter) {
    const source = readFrontmatterString(frontmatter, ['project_identity_source']);
    const confidence = readFrontmatterString(frontmatter, ['project_identity_confidence']);
    return {
        projectHint: readFrontmatterString(frontmatter, ['project_hint', 'related_project', 'project']),
        projectId: readFrontmatterString(frontmatter, ['project_id', 'projectId', 'project-id']),
        repoPath: readFrontmatterString(frontmatter, ['repo_path', 'repoPath', 'repository_path', 'repositoryPath']),
        source: [
            'explicit_project_id',
            'explicit_project_hint',
            'vault_match',
            'repo_leaf',
            'task_metadata',
            'unknown',
        ].includes(source)
            ? source
            : 'task_metadata',
        confidence: ['exact', 'derived', 'uncertain'].includes(confidence)
            ? confidence
            : 'derived',
        warnings: readFrontmatterStringList(frontmatter, 'project_identity_warnings'),
        client: readFrontmatterString(frontmatter, ['client']),
    };
}
function projectIdentityValueMatches(field, left, right) {
    if (!left || !right) {
        return true;
    }
    const normalize = field === 'repo_path'
        ? project_identity_1.normalizeRepositoryPath
        : (value) => value.trim();
    return normalize(left).toLowerCase() === normalize(right).toLowerCase();
}
function mergeTaskProjectIdentity(taskId, task, explicit) {
    for (const [field, taskValue, explicitValue] of [
        ['project_hint', task.projectHint, explicit.projectHint],
        ['project_id', task.projectId, explicit.projectId],
        ['repo_path', task.repoPath, explicit.repoPath],
    ]) {
        if (!projectIdentityValueMatches(field, taskValue, explicitValue)) {
            throw new safety_1.ToolInputError(`Project identity mismatch: task ${taskId} was created with ${field} "${taskValue}", ` +
                `but the current call received "${explicitValue}".`);
        }
    }
    if (!hasProjectScope(explicit)) {
        return {
            projectHint: task.projectHint,
            projectId: task.projectId,
            repoPath: task.repoPath,
            source: 'task_metadata',
            confidence: task.confidence,
            warnings: task.warnings,
        };
    }
    return {
        projectHint: explicit.projectHint || task.projectHint,
        projectId: explicit.projectId || task.projectId,
        repoPath: explicit.repoPath || task.repoPath,
        source: explicit.source,
        confidence: explicit.confidence,
        warnings: [...new Set([...task.warnings, ...explicit.warnings])],
    };
}
function readAgentTaskMetadata(vaultRoot, taskId, context) {
    try {
        const absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, buildTaskNotePath(taskId), pathSafetyOptions(context));
        const parsed = (0, core_1.parseMarkdown)(fs.readFileSync(absolute, 'utf8'));
        return agentTaskMetadataFromFrontmatter(parsed.frontmatter.fields);
    }
    catch (error) {
        if (error instanceof safety_1.ToolInputError || error instanceof core_1.VaultPathError || error instanceof Error) {
            return emptyAgentTaskMetadata();
        }
        return emptyAgentTaskMetadata();
    }
}
async function readAgentTaskMetadataAsync(vaultRoot, taskId, context) {
    try {
        const safePath = buildTaskNotePath(taskId);
        let text;
        if (context.vaultRepository) {
            const repositoryFile = await context.vaultRepository.readText(safePath);
            if (!repositoryFile) {
                return emptyAgentTaskMetadata();
            }
            text = repositoryFile.content;
        }
        else {
            const absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, safePath, pathSafetyOptions(context));
            const parsed = (0, core_1.parseMarkdown)(fs.readFileSync(absolute, 'utf8'));
            return agentTaskMetadataFromFrontmatter(parsed.frontmatter.fields);
        }
        const parsed = (0, core_1.parseMarkdown)(text);
        return agentTaskMetadataFromFrontmatter(parsed.frontmatter.fields);
    }
    catch (error) {
        if (error instanceof safety_1.ToolInputError || error instanceof core_1.VaultPathError || error instanceof Error) {
            return emptyAgentTaskMetadata();
        }
        return emptyAgentTaskMetadata();
    }
}
function readFrontmatterStringList(frontmatter, key) {
    const value = frontmatter[key];
    if (Array.isArray(value)) {
        return value
            .map((entry) => toText(entry))
            .flatMap((entry) => entry.split(/[\n,]/g))
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    return toText(value)
        .split(/[\n,]/g)
        .map((entry) => entry.trim())
        .filter(Boolean);
}
function mergeFrontmatterList(frontmatter, key, values) {
    const merged = new Set(readFrontmatterStringList(frontmatter, key));
    for (const value of values) {
        const trimmed = value.trim();
        if (trimmed) {
            merged.add(trimmed);
        }
    }
    return Array.from(merged).join(', ');
}
function proposalReferenceMarker(proposalId) {
    const safeId = proposalId
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return `^tracekeeper-proposal-${safeId || hashText(proposalId).slice(0, 24)}`;
}
async function updateManagedProposalReferences(vaultRoot, recordPath, proposals, context) {
    if (proposals.length === 0) {
        return;
    }
    const current = await readCurrentVaultTextState(vaultRoot, recordPath, context);
    if (!current) {
        throw new core_1.OperationConflictError(`Tracekeeper-managed proposal reference record is unavailable: ${recordPath}`);
    }
    const frontmatter = (0, core_1.parseMarkdown)(current.content).frontmatter.fields;
    const links = proposals
        .map((proposal) => ({
        ...proposal,
        link: generateProposalMarkdownLink(context, proposal.path, current.path)
            || proposal.link,
    }))
        .filter((proposal) => Boolean(proposal.link));
    const nextFields = {
        proposal_ids: mergeFrontmatterList(frontmatter, 'proposal_ids', proposals.map((proposal) => proposal.proposalId)),
        proposal_paths: mergeFrontmatterList(frontmatter, 'proposal_paths', proposals.map((proposal) => proposal.path)),
        proposal_link_targets: mergeFrontmatterList(frontmatter, 'proposal_link_targets', proposals.map((proposal) => proposal.linkTarget)),
    };
    if (links.length > 0) {
        nextFields.proposal_links = mergeFrontmatterList(frontmatter, 'proposal_links', links.map((proposal) => proposal.link));
    }
    let next = updateFrontmatterFields(current.content, nextFields);
    const missingBodyLinks = links.filter((proposal) => !current.content.includes(proposalReferenceMarker(proposal.proposalId)));
    if (missingBodyLinks.length > 0) {
        const section = [
            contentText(context, '## 知识变更审核', '## Knowledge Change Review'),
            ...missingBodyLinks.map((proposal) => `- ${proposal.link} ${proposalReferenceMarker(proposal.proposalId)}`),
        ].join('\n');
        next = `${next.replace(/\s*$/, '')}\n\n${section}\n`;
    }
    if (next === current.content) {
        return;
    }
    if (context.vaultRepository) {
        if (!current.version) {
            throw new core_1.OperationConflictError(`Tracekeeper-managed proposal reference version is unavailable: ${recordPath}`);
        }
        await context.vaultRepository.replaceText(current.path, current.version, next);
        return;
    }
    const absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, current.path, pathSafetyOptions(context));
    replaceTextFileAtomically(absolute, next, current.content);
}
function updateAgentTaskRecord(vaultRoot, taskId, fields, context, references = {}, appendBody = '', appendBodyMarker = '') {
    if (!taskId) {
        return null;
    }
    let absolute = '';
    try {
        absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, buildTaskNotePath(taskId), pathSafetyOptions(context));
    }
    catch (error) {
        if (error instanceof safety_1.ToolInputError || error instanceof core_1.VaultPathError) {
            return null;
        }
        throw error;
    }
    const current = fs.readFileSync(absolute, 'utf8');
    const frontmatter = (0, core_1.parseMarkdown)(current).frontmatter.fields;
    const nextFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ?? '']));
    for (const [key, values] of Object.entries(references)) {
        const merged = mergeFrontmatterList(frontmatter, key, values);
        if (merged) {
            nextFields[key] = merged;
        }
    }
    let next = updateFrontmatterFields(current, nextFields);
    if (appendBody.trim() && (!appendBodyMarker || !current.includes(appendBodyMarker))) {
        next = `${next.replace(/\s*$/, '')}\n\n${appendBody.trim()}\n`;
    }
    replaceTextFileAtomically(absolute, next, current);
    return (0, safety_1.relativeFromAbsolute)(vaultRoot, absolute);
}
async function updateAgentTaskRecordAsync(vaultRoot, taskId, fields, context, references = {}, appendBody = '', appendBodyMarker = '') {
    if (!taskId) {
        return null;
    }
    let absolute = '';
    try {
        absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, buildTaskNotePath(taskId), pathSafetyOptions(context));
    }
    catch (error) {
        if (error instanceof safety_1.ToolInputError || error instanceof core_1.VaultPathError) {
            return null;
        }
        throw error;
    }
    if (context.vaultRepository) {
        const existing = await context.vaultRepository.readText(buildTaskNotePath(taskId));
        if (!existing) {
            return null;
        }
        const frontmatter = (0, core_1.parseMarkdown)(existing.content).frontmatter.fields;
        const nextFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ?? '']));
        for (const [key, values] of Object.entries(references)) {
            const merged = mergeFrontmatterList(frontmatter, key, values);
            if (merged) {
                nextFields[key] = merged;
            }
        }
        let next = updateFrontmatterFields(existing.content, nextFields);
        if (appendBody.trim() && (!appendBodyMarker || !existing.content.includes(appendBodyMarker))) {
            next = `${next.replace(/\s*$/, '')}\n\n${appendBody.trim()}\n`;
        }
        await context.vaultRepository.replaceText(existing.path, existing.version, next);
        return existing.path;
    }
    const current = fs.readFileSync(absolute, 'utf8');
    const frontmatter = (0, core_1.parseMarkdown)(current).frontmatter.fields;
    const nextFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ?? '']));
    for (const [key, values] of Object.entries(references)) {
        const merged = mergeFrontmatterList(frontmatter, key, values);
        if (merged) {
            nextFields[key] = merged;
        }
    }
    let next = updateFrontmatterFields(current, nextFields);
    if (appendBody.trim() && (!appendBodyMarker || !current.includes(appendBodyMarker))) {
        next = `${next.replace(/\s*$/, '')}\n\n${appendBody.trim()}\n`;
    }
    replaceTextFileAtomically(absolute, next, current);
    return (0, safety_1.relativeFromAbsolute)(vaultRoot, absolute);
}
async function linkApprovedWritebackTask(vaultRoot, payload, context) {
    if (!payload.taskId) {
        if (payload.taskPath !== null
            || payload.taskContentHash !== ''
            || payload.taskHadTargetReference
            || payload.taskHadProposalReference
            || payload.taskHadProposalIdReference === true
            || payload.taskHadProposalPathEvidence === true) {
            throw new core_1.OperationConflictError('Writeback task binding is invalid.');
        }
        return {
            taskPath: null,
            targetReferenceAdded: false,
            proposalReferenceAdded: false,
        };
    }
    const expectedPath = buildTaskNotePath(payload.taskId);
    if (payload.taskPath !== expectedPath) {
        throw new core_1.OperationConflictError('Writeback task binding changed.');
    }
    const current = await readCurrentVaultTextState(vaultRoot, expectedPath, context);
    if (!current) {
        throw new core_1.OperationConflictError('Writeback task is unavailable for the journaled operation.');
    }
    const frontmatter = (0, core_1.parseMarkdown)(current.content).frontmatter.fields;
    const usesStableProposalReferences = typeof payload.taskHadProposalIdReference === 'boolean'
        && typeof payload.taskHadProposalPathEvidence === 'boolean';
    const memoryWrites = new Set(readFrontmatterStringList(frontmatter, 'memory_writes'));
    const proposalIds = new Set(readFrontmatterStringList(frontmatter, 'proposal_ids'));
    const proposalPaths = new Set(readFrontmatterStringList(frontmatter, 'proposal_paths'));
    const legacyProposals = new Set(readFrontmatterStringList(frontmatter, 'proposals'));
    const hasProposalReference = usesStableProposalReferences
        ? proposalIds.has(payload.proposalId)
        : legacyProposals.has(payload.proposalPath);
    const hasProposalPathEvidence = usesStableProposalReferences
        ? proposalPaths.has(payload.proposalPath)
        : true;
    const targetReferenceAdded = !payload.taskHadTargetReference;
    const proposalReferenceAdded = !payload.taskHadProposalReference;
    if (memoryWrites.has(payload.targetPath)
        && hasProposalReference
        && hasProposalPathEvidence) {
        if (current.contentHash !== payload.taskLinkedContentHash) {
            throw new core_1.OperationConflictError('Writeback task changed after its durable update.');
        }
        return {
            taskPath: current.path,
            targetReferenceAdded,
            proposalReferenceAdded,
        };
    }
    if (current.contentHash !== payload.taskContentHash) {
        throw new core_1.OperationConflictError('Writeback task changed after preview before its durable update.');
    }
    if (memoryWrites.has(payload.targetPath) !== payload.taskHadTargetReference
        || hasProposalReference !== payload.taskHadProposalReference
        || (usesStableProposalReferences
            && hasProposalPathEvidence !== payload.taskHadProposalPathEvidence)) {
        throw new core_1.OperationConflictError('Writeback task references changed after preview.');
    }
    const next = updateFrontmatterFields(current.content, usesStableProposalReferences
        ? {
            memory_writes: mergeFrontmatterList(frontmatter, 'memory_writes', [payload.targetPath]),
            proposal_ids: mergeFrontmatterList(frontmatter, 'proposal_ids', [payload.proposalId]),
            proposal_paths: mergeFrontmatterList(frontmatter, 'proposal_paths', [payload.proposalPath]),
        }
        : {
            memory_writes: mergeFrontmatterList(frontmatter, 'memory_writes', [payload.targetPath]),
            proposals: mergeFrontmatterList(frontmatter, 'proposals', [payload.proposalPath]),
        });
    if (hashText(next) !== payload.taskLinkedContentHash) {
        throw new core_1.OperationConflictError('Writeback task update no longer matches its preview.');
    }
    if (context.vaultRepository) {
        if (!current.version) {
            throw new core_1.OperationConflictError('Writeback task version is unavailable.');
        }
        await context.vaultRepository.replaceText(current.path, current.version, next);
        return {
            taskPath: current.path,
            targetReferenceAdded,
            proposalReferenceAdded,
        };
    }
    const absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, current.path, pathSafetyOptions(context));
    replaceTextFileAtomically(absolute, next, current.content);
    return {
        taskPath: current.path,
        targetReferenceAdded,
        proposalReferenceAdded,
    };
}
async function rollbackApprovedWritebackTask(vaultRoot, payload, receipt, context) {
    if (receipt.taskPath === null) {
        return;
    }
    if (!payload.taskId || receipt.taskPath !== payload.taskPath) {
        throw new core_1.OperationConflictError('Writeback task compensation binding changed.');
    }
    const usesStableProposalReferences = typeof payload.taskHadProposalIdReference === 'boolean'
        && typeof payload.taskHadProposalPathEvidence === 'boolean';
    const proposalPathEvidenceAdded = usesStableProposalReferences
        && payload.taskHadProposalPathEvidence === false;
    if (!receipt.targetReferenceAdded
        && !receipt.proposalReferenceAdded
        && !proposalPathEvidenceAdded) {
        return;
    }
    const current = await readCurrentVaultTextState(vaultRoot, receipt.taskPath, context);
    if (!current) {
        throw new core_1.OperationConflictError('Writeback task disappeared before its references could be compensated.');
    }
    if (current.contentHash === payload.taskContentHash) {
        return;
    }
    if (current.contentHash !== payload.taskLinkedContentHash) {
        throw new core_1.OperationConflictError('Writeback task changed after its durable effect and cannot be safely compensated.');
    }
    const frontmatter = (0, core_1.parseMarkdown)(current.content).frontmatter.fields;
    const memoryWrites = readFrontmatterStringList(frontmatter, 'memory_writes');
    const proposalIds = readFrontmatterStringList(frontmatter, 'proposal_ids');
    const proposalPaths = readFrontmatterStringList(frontmatter, 'proposal_paths');
    const legacyProposals = readFrontmatterStringList(frontmatter, 'proposals');
    const nextMemoryWrites = receipt.targetReferenceAdded
        ? memoryWrites.filter((value) => value !== payload.targetPath)
        : memoryWrites;
    const nextProposalIds = usesStableProposalReferences && receipt.proposalReferenceAdded
        ? proposalIds.filter((value) => value !== payload.proposalId)
        : proposalIds;
    const nextProposalPaths = proposalPathEvidenceAdded
        ? proposalPaths.filter((value) => value !== payload.proposalPath)
        : proposalPaths;
    const nextLegacyProposals = !usesStableProposalReferences && receipt.proposalReferenceAdded
        ? legacyProposals.filter((value) => value !== payload.proposalPath)
        : legacyProposals;
    if (nextMemoryWrites.length === memoryWrites.length
        && nextProposalIds.length === proposalIds.length
        && nextProposalPaths.length === proposalPaths.length
        && nextLegacyProposals.length === legacyProposals.length) {
        return;
    }
    const next = updateFrontmatterFields(current.content, usesStableProposalReferences
        ? {
            memory_writes: nextMemoryWrites.length > 0 ? nextMemoryWrites.join(', ') : null,
            proposal_ids: nextProposalIds.length > 0 ? nextProposalIds.join(', ') : null,
            proposal_paths: nextProposalPaths.length > 0 ? nextProposalPaths.join(', ') : null,
        }
        : {
            memory_writes: nextMemoryWrites.length > 0 ? nextMemoryWrites.join(', ') : null,
            proposals: nextLegacyProposals.length > 0
                ? nextLegacyProposals.join(', ')
                : null,
        });
    if (context.vaultRepository) {
        if (!current.version) {
            throw new core_1.OperationConflictError('Writeback task version is unavailable.');
        }
        await context.vaultRepository.replaceText(current.path, current.version, next);
        return;
    }
    const absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, current.path, pathSafetyOptions(context));
    replaceTextFileAtomically(absolute, next, current.content);
}
async function createAgentTaskRecord(vaultRoot, input) {
    const taskPath = buildTaskNotePath(input.taskId);
    const taskAuditMetadata = {
        target_type: 'agent_task',
        task_stage: 'start',
    };
    const returnExistingTask = async () => {
        const audit = await appendAuditEventAsync(vaultRoot, {
            operationId: input.operationId,
            tool: 'tracekeeper.start_task',
            targetPath: taskPath,
            status: 'written',
            taskId: input.taskId,
            metadata: taskAuditMetadata,
        }, input.context);
        return { path: taskPath, audit_path: audit.path, status: 'skipped', warnings: [] };
    };
    const existingTask = input.context.vaultRepository
        ? await input.context.vaultRepository.readText(taskPath)
        : null;
    if (!existingTask && !input.context.vaultRepository) {
        const taskAbsolute = path.resolve(vaultRoot, taskPath);
        (0, safety_1.relativeFromAbsolute)(vaultRoot, taskAbsolute);
        (0, safety_1.assertNoSymlinkSegments)(vaultRoot, taskAbsolute);
        if (fs.existsSync(taskAbsolute)) {
            const existing = (0, core_1.parseMarkdown)(fs.readFileSync(taskAbsolute, 'utf8'));
            const existingOperationId = stripYamlQuotes(readFrontmatterString(existing.frontmatter.fields, ['start_operation_id']));
            if (existingOperationId === input.operationId) {
                return returnExistingTask();
            }
            throw new core_1.OperationConflictError(`Task path already exists for another operation: ${taskPath}`);
        }
    }
    if (existingTask) {
        const existingOperationId = stripYamlQuotes(readFrontmatterString((0, core_1.parseMarkdown)(existingTask.content).frontmatter.fields, ['start_operation_id']));
        if (existingOperationId === input.operationId) {
            return returnExistingTask();
        }
        throw new core_1.OperationConflictError(`Task path already exists for another operation: ${taskPath}`);
    }
    const now = new Date().toISOString();
    const clientName = input.client || input.context.clientName || '';
    const body = [
        contentText(input.context, '# Agent 任务', '# Agent Task'),
        '',
        contentText(input.context, '## 目标', '## Objective'),
        input.goal,
        '',
        contentText(input.context, '## 上下文包摘要', '## Context Pack Summary'),
        `- query: ${input.contextPack.query}`,
        `- generated_at: ${input.contextPack.generatedAt}`,
        `- relevant_notes: ${input.contextPack.relevantNotes.length}`,
        `- source_candidates: ${input.contextPack.sourceCandidates.length}`,
        `- gaps: ${input.contextPack.gaps.length}`,
    ].join('\n');
    return buildAndWriteNoteAsync(vaultRoot, 'tracekeeper.start_task', AGENT_TASK_DIR, taskPath.slice(`${AGENT_TASK_DIR}/`.length), {
        tool: 'tracekeeper.start_task',
        type: 'agent-task',
        title: `Task ${input.taskId}`,
        task_id: input.taskId,
        status: 'active',
        agent: input.context.agentId || clientName || 'unknown',
        client: clientName || null,
        session_id: input.context.sessionId || null,
        objective: input.goal,
        project_hint: input.projectHint || null,
        related_project: input.projectHint || null,
        project_id: input.projectId || null,
        repo_path: input.repoPath || null,
        project_identity_source: input.projectIdentitySource,
        project_identity_confidence: input.projectIdentityConfidence,
        project_identity_warnings: input.projectIdentityWarnings,
        started_at: now,
        start_operation_id: input.operationId,
    }, body, input.taskId, input.context, taskAuditMetadata, input.operationId);
}
function auditShardFile(vaultRoot, timestamp) {
    const safeAuditPath = (0, safety_1.normalizeNotePath)((0, core_1.auditShardPath)(timestamp));
    const absolute = path.resolve(vaultRoot, safeAuditPath);
    const relative = path.relative(vaultRoot, absolute).replace(/\\/g, '/');
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new safety_1.ToolInputError('Audit shard path must be inside vault.');
    }
    (0, safety_1.assertNoSymlinkSegments)(vaultRoot, absolute);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    return { absolute, relative };
}
function auditHubFile(vaultRoot) {
    const relative = (0, safety_1.normalizeNotePath)(AUDIT_HUB_PATH);
    const absolute = path.resolve(vaultRoot, relative);
    (0, safety_1.relativeFromAbsolute)(vaultRoot, absolute);
    (0, safety_1.assertNoSymlinkSegments)(vaultRoot, absolute);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    return { absolute, relative };
}
function buildAuditEventId(input, targetPaths) {
    const operationId = input.operationId?.trim() || '';
    const invocationId = operationId ? '' : input.invocationId?.trim() || '';
    const requestId = operationId || invocationId
        ? ''
        : input.requestId?.trim() || `generated-${crypto.randomUUID()}`;
    const metadata = Object.fromEntries(Object.entries(input.metadata || {})
        .filter(([key]) => !/(?:^|_)(?:timestamp|created_at|updated_at|last_used_at|connected_at)$/.test(key))
        .sort(([left], [right]) => left.localeCompare(right)));
    return (0, core_1.buildStableAuditEventId)({
        operationId,
        requestId,
        ...(invocationId ? { invocationId } : {}),
        type: input.type || 'tool-call',
        event: input.event || input.type || 'tool-call',
        tool: input.tool || '',
        action: input.action || '',
        status: input.status || '',
        resultStatus: input.resultStatus || '',
        taskId: input.taskId || '',
        targetPaths,
        metadata,
    });
}
function boundedAuditValue(value, key, depth = 0) {
    if (isSensitiveKey(key)) {
        return '[redacted]';
    }
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'string') {
        const normalized = value.replace(/[\r\n]+/g, ' ').trim();
        if (!scanSensitiveText(normalized).ok
            || path.isAbsolute(normalized)
            || /(?:^|["'\s])\/(?:Users|home|private|tmp|var)\//.test(normalized)) {
            return '[redacted]';
        }
        return normalized.length <= MAX_AUDIT_SCALAR_LENGTH
            ? normalized
            : `${normalized.slice(0, MAX_AUDIT_SCALAR_LENGTH - 1)}…`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (Array.isArray(value)) {
        return value
            .slice(0, MAX_AUDIT_ARRAY_ITEMS)
            .map((item) => boundedAuditValue(item, key, depth + 1));
    }
    if ((0, protocol_1.isRecord)(value) && depth < 2) {
        const bounded = {};
        for (const [nestedKey, nestedValue] of Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .slice(0, MAX_AUDIT_METADATA_FIELDS)) {
            bounded[nestedKey] = boundedAuditValue(nestedValue, nestedKey, depth + 1);
        }
        return bounded;
    }
    return '[bounded]';
}
function auditYamlValue(key, value) {
    const bounded = boundedAuditValue(value, key);
    if (key === 'action'
        && typeof bounded === 'string'
        && /^[A-Za-z0-9._-]+$/.test(bounded)) {
        return bounded;
    }
    return sanitizeYamlValue(bounded);
}
function prepareAuditEvent(input) {
    const eventName = input.type || 'tool-call';
    const eventType = input.event || eventName;
    const toolName = input.tool || '';
    const timestamp = input.timestamp || new Date().toISOString();
    const targetPaths = normalizeAuditTargets(input.targetPath ? [input.targetPath] : input.targetPaths || []);
    const operationId = input.operationId?.trim() || '';
    const auditEventId = buildAuditEventId(input, targetPaths);
    const eventLines = [
        `## ${timestamp} ${eventName}`,
        `- type: ${auditYamlValue('type', eventName)}`,
        `- event: ${auditYamlValue('event', eventType)}`,
        `- timestamp: ${auditYamlValue('timestamp', timestamp)}`,
        `- audit_event_id: ${auditYamlValue('audit_event_id', auditEventId)}`,
    ];
    if (operationId) {
        eventLines.push(`- operation_id: ${auditYamlValue('operation_id', operationId)}`);
    }
    if (input.invocationId) {
        eventLines.push(`- invocation_id: ${auditYamlValue('invocation_id', input.invocationId)}`);
    }
    if (input.requestId) {
        eventLines.push(`- request_id: ${auditYamlValue('request_id', input.requestId)}`);
    }
    if (input.agentId) {
        eventLines.push(`- agent_id: ${auditYamlValue('agent_id', input.agentId)}`);
    }
    if (input.principalId) {
        eventLines.push(`- principal_id: ${auditYamlValue('principal_id', input.principalId)}`);
    }
    if (input.sessionId) {
        eventLines.push(`- session_id: ${auditYamlValue('session_id', input.sessionId)}`);
    }
    if (input.clientName !== undefined) {
        eventLines.push(`- client_name: ${auditYamlValue('client_name', input.clientName || null)}`);
    }
    if (input.actor) {
        eventLines.push(`- actor: ${auditYamlValue('actor', input.actor)}`);
    }
    if (input.action) {
        eventLines.push(`- action: ${auditYamlValue('action', input.action)}`);
    }
    if (toolName) {
        eventLines.push(`- tool_name: ${auditYamlValue('tool_name', toolName)}`);
    }
    if (input.resultStatus) {
        eventLines.push(`- result_status: ${auditYamlValue('result_status', input.resultStatus)}`);
    }
    if (input.status) {
        eventLines.push(`- status: ${auditYamlValue('status', input.status)}`);
    }
    if (input.taskId) {
        eventLines.push(`- task_id: ${auditYamlValue('task_id', input.taskId)}`);
    }
    if (targetPaths.length > 0) {
        eventLines.push(`- target_paths:`);
        for (const item of targetPaths) {
            eventLines.push(`  - ${auditYamlValue('target_path', item)}`);
        }
    }
    else {
        eventLines.push('- target_paths: []');
    }
    if (input.argsSummary !== undefined && input.argsSummary !== '') {
        eventLines.push(`- args_summary: ${auditYamlValue('args_summary', input.argsSummary)}`);
    }
    if (input.durationMs !== undefined) {
        eventLines.push(`- duration_ms: ${input.durationMs}`);
    }
    if (input.riskLevel) {
        eventLines.push(`- risk_level: ${auditYamlValue('risk_level', input.riskLevel)}`);
    }
    if (input.transport) {
        eventLines.push(`- transport: ${auditYamlValue('transport', input.transport)}`);
    }
    if (input.runtimeVersion) {
        eventLines.push(`- runtime_version: ${auditYamlValue('runtime_version', input.runtimeVersion)}`);
    }
    if (input.warnings && input.warnings.length > 0) {
        eventLines.push(`- warnings: ${auditYamlValue('warnings', input.warnings)}`);
    }
    if (input.metadata && Object.keys(input.metadata).length > 0) {
        const entries = Object.entries(input.metadata)
            .filter(([, value]) => value !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .slice(0, MAX_AUDIT_METADATA_FIELDS);
        for (const [key, value] of entries) {
            eventLines.push(`- ${key}: ${auditYamlValue(key, value)}`);
        }
    }
    return {
        timestamp,
        shardPath: (0, safety_1.normalizeNotePath)((0, core_1.auditShardPath)(timestamp)),
        auditEventId,
        entry: `${eventLines.join('\n')}\n`,
    };
}
function auditShardHeader(timestamp) {
    const day = new Date(timestamp).toISOString().slice(0, 10);
    return [
        '---',
        'type: tracekeeper_audit_shard',
        `audit_schema_version: ${AUDIT_SCHEMA_VERSION}`,
        `audit_date: ${day}`,
        `audit_date_utc: ${day}`,
        `created_at: ${timestamp}`,
        `updated_at: ${timestamp}`,
        `audit_hub: ${AUDIT_HUB_PATH}`,
        '---',
        `# Audit ${day}`,
        '',
        '[Audit hub](../index.md#audit)',
        '',
    ].join('\n');
}
function auditHubContent(timestamp) {
    return [
        '---',
        'type: tracekeeper_audit_hub',
        `audit_schema_version: ${AUDIT_SCHEMA_VERSION}`,
        `created_at: ${timestamp}`,
        '---',
        '# Audit',
        '',
        'Daily audit shards link back to this hub.',
        '',
    ].join('\n');
}
function ensureDirectAuditHub(vaultRoot, timestamp) {
    const hub = auditHubFile(vaultRoot);
    if (fs.existsSync(hub.absolute)) {
        if (!fs.lstatSync(hub.absolute).isFile()) {
            throw new core_1.VaultPathError('Audit hub path is not a file.');
        }
        return;
    }
    try {
        fs.writeFileSync(hub.absolute, auditHubContent(timestamp), {
            encoding: 'utf8',
            flag: 'wx',
        });
    }
    catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
            throw error;
        }
    }
}
async function ensureRepositoryAuditHub(repository, timestamp) {
    await withRepositoryAuditLock(repository, AUDIT_HUB_PATH, async () => {
        if (await repository.readText(AUDIT_HUB_PATH)) {
            return;
        }
        try {
            await repository.createText(AUDIT_HUB_PATH, auditHubContent(timestamp));
        }
        catch (error) {
            if (!(await repository.readText(AUDIT_HUB_PATH))) {
                throw error;
            }
        }
    });
}
function appendPreparedAuditEvent(current, event) {
    const marker = `- audit_event_id: ${auditYamlValue('audit_event_id', event.auditEventId)}`;
    if (current?.includes(marker)) {
        return { content: current, duplicate: true };
    }
    if (current
        && !/^---\n[\s\S]*?^type:\s*(?:tracekeeper_audit_shard|tracekeeper-audit-shard)\s*$/m.test(current)) {
        throw new core_1.OperationConflictError(`Audit shard has an invalid record type: ${event.shardPath}`);
    }
    const base = current
        ? current.replace(/^updated_at:\s*.*$/m, `updated_at: ${event.timestamp}`)
        : auditShardHeader(event.timestamp);
    return {
        content: `${base.trimEnd()}\n\n${event.entry.trimEnd()}\n`,
        duplicate: false,
    };
}
function appendAuditEvent(vaultRoot, input) {
    const event = prepareAuditEvent(input);
    ensureDirectAuditHub(vaultRoot, event.timestamp);
    const shard = auditShardFile(vaultRoot, event.timestamp);
    const current = fs.existsSync(shard.absolute)
        ? fs.readFileSync(shard.absolute, 'utf8')
        : null;
    const next = appendPreparedAuditEvent(current, event);
    if (!next.duplicate) {
        if (current === null) {
            fs.writeFileSync(shard.absolute, next.content, { encoding: 'utf8', flag: 'wx' });
        }
        else {
            fs.writeFileSync(shard.absolute, next.content, 'utf8');
        }
    }
    return { path: shard.relative };
}
async function appendAuditEventAsync(vaultRoot, input, context) {
    if (!context.vaultRepository) {
        return appendAuditEvent(vaultRoot, input);
    }
    const event = prepareAuditEvent(input);
    await ensureRepositoryAuditHub(context.vaultRepository, event.timestamp);
    await withRepositoryAuditLock(context.vaultRepository, event.shardPath, async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const existing = await context.vaultRepository.readText(event.shardPath);
            const next = appendPreparedAuditEvent(existing?.content || null, event);
            if (next.duplicate) {
                return;
            }
            try {
                if (existing) {
                    await context.vaultRepository.replaceText(event.shardPath, existing.version, next.content);
                }
                else {
                    await context.vaultRepository.createText(event.shardPath, next.content);
                }
                return;
            }
            catch (error) {
                if (!(error instanceof core_1.OperationConflictError) || attempt === 2) {
                    throw error;
                }
            }
        }
    });
    return { path: event.shardPath };
}
const repositoryAuditLocks = new WeakMap();
async function withRepositoryAuditLock(repository, shardPath, execute) {
    const locks = repositoryAuditLocks.get(repository) || new Map();
    repositoryAuditLocks.set(repository, locks);
    const previous = locks.get(shardPath) || Promise.resolve();
    let release = () => undefined;
    const next = new Promise((resolve) => {
        release = resolve;
    });
    const chain = previous.catch(() => undefined).then(() => next);
    locks.set(shardPath, chain);
    await previous.catch(() => undefined);
    try {
        return await execute();
    }
    finally {
        release();
        if (locks.get(shardPath) === chain) {
            locks.delete(shardPath);
        }
        if (locks.size === 0) {
            repositoryAuditLocks.delete(repository);
        }
    }
}
function normalizeAuditTargets(paths) {
    const result = [];
    for (const candidate of paths) {
        const bounded = boundedAuditValue(candidate, 'target_path');
        if (typeof bounded !== 'string' || !bounded) {
            continue;
        }
        if (!result.includes(bounded)) {
            result.push(bounded);
        }
        if (result.length >= MAX_AUDIT_ARRAY_ITEMS) {
            break;
        }
    }
    return result;
}
function isSensitiveKey(key) {
    return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}
function looksLikeSensitiveValue(value) {
    return !scanSensitiveText(value).ok;
}
const RECALL_FAMILY_AUDIT_TOOL_NAMES = new Set([
    'tracekeeper.recall',
    'tracekeeper.project_context',
    'tracekeeper.project_history',
]);
const RECALL_AUDIT_METADATA_KEYS = [
    'scope',
    'project_hint',
    'project_id',
    'repo_path',
    'repo',
    'project_path',
    'max_items',
];
const AUDIT_BODY_ARGUMENT_KEYS = new Set([
    'content',
    'decisions',
    'evidence',
    'goal',
    'lessons',
    'memory_candidates',
    'next_actions',
    'outcomes',
    'possible_preferences',
    'preferences',
    'query',
    'solution_changes',
    'summary',
    'text',
    'title',
]);
const AUDIT_LOCAL_PATH_ARGUMENT_KEYS = new Set([
    'project_path',
    'repo',
    'repo_path',
]);
function projectRecallAuditMetadataValue(key, value) {
    if (AUDIT_LOCAL_PATH_ARGUMENT_KEYS.has(key)) {
        return '[redacted]';
    }
    if (value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean') {
        return value;
    }
    return '[invalid]';
}
function projectArgumentsForAudit(toolName, args) {
    if (RECALL_FAMILY_AUDIT_TOOL_NAMES.has(toolName)) {
        const projected = {};
        if (Object.prototype.hasOwnProperty.call(args, 'query')) {
            projected.query = '[redacted]';
        }
        for (const key of RECALL_AUDIT_METADATA_KEYS) {
            if (Object.prototype.hasOwnProperty.call(args, key)) {
                projected[key] = projectRecallAuditMetadataValue(key, args[key]);
            }
        }
        return projected;
    }
    const projected = {};
    for (const [key, value] of Object.entries(args)) {
        if (AUDIT_BODY_ARGUMENT_KEYS.has(key) || key === 'idempotency_key') {
            projected[key] = '[redacted]';
            continue;
        }
        if (AUDIT_LOCAL_PATH_ARGUMENT_KEYS.has(key)) {
            projected[key] = '[redacted]';
            continue;
        }
        projected[key] = value;
    }
    return projected;
}
function summarizeForAudit(args, limit = MAX_ARGS_SUMMARY_LENGTH) {
    const summary = {};
    function summarize(value, keyHint = '', depth = 0) {
        if (depth > 2) {
            if (value === null || value === undefined) {
                return value;
            }
            if (typeof value === 'string') {
                return value.length > 80 ? `${value.slice(0, 77)}...` : value;
            }
            if (typeof value === 'number' || typeof value === 'boolean') {
                return value;
            }
            return '[object]';
        }
        if (isSensitiveKey(keyHint) || (typeof value === 'string' && looksLikeSensitiveValue(value))) {
            return '[redacted]';
        }
        if (Array.isArray(value)) {
            return value.slice(0, 10).map((entry, entryIndex) => summarize(entry, `${keyHint}[${entryIndex}]`, depth + 1));
        }
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value === 'string') {
            const text = value.trim();
            return text.length > 180 ? `${text.slice(0, 177)}...` : text;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        if ((0, protocol_1.isRecord)(value)) {
            const nested = {};
            for (const [nestedKey, nestedValue] of Object.entries(value)) {
                nested[nestedKey] = summarize(nestedValue, nestedKey, depth + 1);
            }
            return nested;
        }
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value === 'bigint') {
            return value.toString();
        }
        if (typeof value === 'symbol') {
            return value.toString();
        }
        if (typeof value === 'function') {
            return '[function]';
        }
        try {
            const json = JSON.stringify(value);
            return json ?? '[unserializable]';
        }
        catch {
            return '[unserializable]';
        }
    }
    for (const [key, value] of Object.entries(args)) {
        summary[key] = summarize(value, key, 0);
    }
    const text = JSON.stringify(summary);
    return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}
function collectAuditTargetsFromArgs(toolName, args) {
    const targets = new Set();
    const explicitPathKeys = ['path', 'request_path', 'proposal_path', 'target_note', 'source', 'source_path'];
    for (const key of explicitPathKeys) {
        addTrimmedTarget(targets, getRecordValue(args, key));
    }
    return Array.from(targets).filter(Boolean);
}
function collectAuditTargetsFromResult(toolName, args, resultPayload) {
    const targets = new Set(collectAuditTargetsFromArgs(toolName, args));
    const payload = (0, protocol_1.isRecord)(resultPayload) ? resultPayload : null;
    if (payload) {
        const candidateKeys = [
            'path',
            'target_note',
            'proposal_path',
            'request_path',
            'audit_path',
            'source_note',
            'report',
        ];
        for (const key of candidateKeys) {
            addTrimmedTarget(targets, getRecordValue(payload, key));
        }
        const sourceNote = getRecordValue(payload, 'source_note');
        if ((0, protocol_1.isRecord)(sourceNote)) {
            addTrimmedTarget(targets, getRecordValue(sourceNote, 'path'));
        }
        const report = getRecordValue(payload, 'report');
        if ((0, protocol_1.isRecord)(report)) {
            addTrimmedTarget(targets, getRecordValue(report, 'path'));
        }
        const touchedNotes = getRecordValue(payload, 'touched_notes');
        if (Array.isArray(touchedNotes)) {
            for (const entry of touchedNotes) {
                addTrimmedTarget(targets, entry);
            }
        }
        const proposals = getRecordValue(payload, 'proposals');
        if (Array.isArray(proposals)) {
            for (const proposal of proposals) {
                if ((0, protocol_1.isRecord)(proposal)) {
                    addTrimmedTarget(targets, getRecordValue(proposal, 'path'));
                }
            }
        }
        const steps = getRecordValue(payload, 'steps');
        if (Array.isArray(steps)) {
            for (const step of steps) {
                addTrimmedTarget(targets, step);
            }
        }
    }
    return normalizeAuditTargets(Array.from(targets).filter(Boolean));
}
function toSourceRequestRow(note) {
    return {
        noteType: readFrontmatterString(note.frontmatter, ['type']),
        source: readFrontmatterString(note.frontmatter, ['source']) || '',
        sourceKind: readFrontmatterString(note.frontmatter, ['source_kind', 'sourceKind', 'sourcekind', 'source-kind']) || '',
        purpose: readFrontmatterString(note.frontmatter, ['purpose']) || '',
        relatedProject: readFrontmatterString(note.frontmatter, ['related_project', 'relatedProject']) || '',
        analysisMode: readFrontmatterString(note.frontmatter, ['analysis_mode', 'analysisMode']) || 'default',
        status: readFrontmatterString(note.frontmatter, ['status']) || 'pending',
    };
}
const TOOL_HANDLERS = {
    'tracekeeper.status': (rawArgs, context) => handleStatus(rawArgs, context),
    'tracekeeper.graph_health': (rawArgs, context) => handleGraphHealth(rawArgs, context),
    'tracekeeper.start_task': (rawArgs, context) => handleStartTask(rawArgs, context),
    'tracekeeper.recall': (rawArgs, context) => handleRecall(rawArgs, context),
    'tracekeeper.project_memory': (rawArgs, context) => handleProjectMemory(rawArgs, context),
    'tracekeeper.read_note': (rawArgs, context) => handleReadNote(rawArgs, context),
    'tracekeeper.review_queue': (rawArgs, context) => handleReviewQueueUnified(rawArgs, context),
    'tracekeeper.project_context': (rawArgs, context) => handleProjectContext(rawArgs, context),
    'tracekeeper.project_history': (rawArgs, context) => handleProjectHistory(rawArgs, context),
    'tracekeeper.list_review_queue': (rawArgs, context) => handleReviewQueue(rawArgs, context),
    'tracekeeper.list_source_requests': (rawArgs, context) => handleListSourceRequests(rawArgs, context),
    'tracekeeper.list_approved_writebacks': (rawArgs, context) => handleListApprovedWritebacks(rawArgs, context),
    'tracekeeper.audit_recent': (rawArgs, context) => handleAuditRecent(rawArgs, context),
    'tracekeeper.source_request': (rawArgs, context) => handleSourceRequest(rawArgs, context),
    'tracekeeper.analyze_source_request': (rawArgs, context) => handleAnalyzeSourceRequest(rawArgs, context),
    'tracekeeper.apply_approved_writeback': (rawArgs, context) => handleApplyApprovedWriteback(rawArgs, context),
    'tracekeeper.build_context_pack': (rawArgs, context) => handleBuildContextPack(rawArgs, context),
    'tracekeeper.lint': (rawArgs, context) => handleLint(rawArgs, context),
    'tracekeeper.finish_task': (rawArgs, context) => handleFinishTask(rawArgs, context),
    'tracekeeper.distill_session': (rawArgs, context) => handleDistillSession(rawArgs, context),
    'tracekeeper.write_context_pack': (rawArgs, context) => handleWriteContextPack(rawArgs, context),
    'tracekeeper.write_session_note': (rawArgs, context) => handleWriteSessionNote(rawArgs, context),
    'tracekeeper.capture_source': (rawArgs, context) => handleCaptureSource(rawArgs, context),
    'tracekeeper.propose_memory': (rawArgs, context) => handleProposeMemory(rawArgs, context),
};
function getToolRiskLevel(toolName) {
    if (REVIEW_GATED_TOOL_NAMES.has(toolName)) {
        return 'review-gated apply';
    }
    if (READ_ONLY_TOOL_NAMES.has(toolName)) {
        return 'read-only';
    }
    if (LOW_RISK_TOOL_NAMES.has(toolName)) {
        return 'low-risk write';
    }
    return 'low-risk write';
}
function resolveAuditVaultRoot(args, context) {
    const explicit = coerceOptionalString(args.vaultRoot);
    if (explicit) {
        try {
            return (0, safety_1.toSafeVaultRoot)(explicit);
        }
        catch {
            return null;
        }
    }
    if (typeof context.defaultVaultRoot === 'string' && context.defaultVaultRoot.trim()) {
        return context.defaultVaultRoot;
    }
    return null;
}
function isToolResultFailure(result) {
    if (result.isError) {
        return true;
    }
    const payload = result.structuredContent;
    if ((0, protocol_1.isRecord)(payload) && typeof payload.isError === 'boolean') {
        return payload.isError;
    }
    if ((0, protocol_1.isRecord)(payload) && typeof payload.ok === 'boolean') {
        return payload.ok === false;
    }
    return false;
}
function appendConnectionAuditEvent(vaultRoot, input) {
    const now = new Date().toISOString();
    return appendAuditEvent(vaultRoot, {
        type: 'connection',
        event: 'connection',
        action: 'connection',
        actor: input.agentId,
        timestamp: now,
        principalId: input.principalId,
        agentId: input.agentId,
        sessionId: input.sessionId,
        clientName: input.clientName,
        resultStatus: 'success',
        transport: input.transport,
        runtimeVersion: input.runtimeVersion,
        metadata: {
            audit_schema_version: 2,
            observed_client_name_raw: input.clientName,
            observed_client_type: input.observedClientType,
            observed_client_version: input.clientVersion,
            connected_at: now,
        },
    });
}
function appendRuntimeDiagnosticAuditEvent(vaultRoot, reason) {
    return appendAuditEvent(vaultRoot, {
        type: 'runtime-diagnostic',
        event: 'runtime-diagnostic',
        action: 'mcp.request_rejected',
        actor: 'tracekeeper-runtime',
        resultStatus: 'failed',
        transport: 'streamable-http',
        metadata: {
            audit_schema_version: 2,
            diagnostic_reason: reason,
        },
    });
}
function recordToolCallAuditEvent(vaultRoot, input) {
    const now = new Date().toISOString();
    const invocationId = input.invocationId?.trim()
        || `invocation-${crypto.randomUUID()}`;
    return appendAuditEvent(vaultRoot, {
        type: 'tool-call',
        event: 'tool-call',
        action: 'tool-call',
        actor: input.agentId,
        timestamp: now,
        invocationId,
        requestId: input.requestId,
        tool: input.toolName,
        principalId: input.principalId,
        agentId: input.agentId,
        sessionId: input.sessionId,
        clientName: input.clientName,
        resultStatus: input.resultStatus,
        targetPaths: input.targetPaths,
        durationMs: input.durationMs,
        riskLevel: input.riskLevel,
        transport: input.transport,
        runtimeVersion: input.runtimeVersion,
        argsSummary: input.argsSummary,
        metadata: {
            audit_schema_version: 2,
            observed_client_name_raw: input.clientName,
            observed_client_type: input.observedClientType
                || (0, observed_client_1.normalizeObservedClientType)(input.clientName),
            observed_client_version: input.clientVersion,
            last_used_at: input.resultStatus === 'success' ? now : undefined,
            last_successful_tool: input.resultStatus === 'success' ? input.toolName : undefined,
            result_summary: input.resultSummary,
            ...input.workflowMetadata,
        },
    });
}
async function recordToolCallAuditEventAsync(vaultRoot, input, context) {
    if (!context.vaultRepository) {
        return recordToolCallAuditEvent(vaultRoot, input);
    }
    const now = new Date().toISOString();
    const invocationId = input.invocationId?.trim()
        || `invocation-${crypto.randomUUID()}`;
    return appendAuditEventAsync(vaultRoot, {
        type: 'tool-call',
        event: 'tool-call',
        action: 'tool-call',
        actor: input.agentId,
        timestamp: now,
        invocationId,
        requestId: input.requestId || context.requestId,
        tool: input.toolName,
        principalId: input.principalId,
        agentId: input.agentId,
        sessionId: input.sessionId,
        clientName: input.clientName,
        resultStatus: input.resultStatus,
        targetPaths: input.targetPaths,
        durationMs: input.durationMs,
        riskLevel: input.riskLevel,
        transport: input.transport,
        runtimeVersion: input.runtimeVersion,
        argsSummary: input.argsSummary,
        metadata: {
            audit_schema_version: 2,
            observed_client_name_raw: input.clientName,
            observed_client_type: input.observedClientType
                || (0, observed_client_1.normalizeObservedClientType)(input.clientName),
            observed_client_version: input.clientVersion,
            last_used_at: input.resultStatus === 'success' ? now : undefined,
            last_successful_tool: input.resultStatus === 'success' ? input.toolName : undefined,
            result_summary: input.resultSummary,
            ...input.workflowMetadata,
        },
    }, context);
}
async function recordRejectedToolCallAuditEvent(context, reason) {
    const vaultRoot = resolveAuditVaultRoot({}, context);
    if (!vaultRoot) {
        return;
    }
    try {
        await recordToolCallAuditEventAsync(vaultRoot, {
            invocationId: context.invocationId?.trim()
                || `invocation-${crypto.randomUUID()}`,
            requestId: context.requestId,
            toolName: 'unknown',
            resultStatus: 'failed',
            targetPaths: [],
            durationMs: 0,
            riskLevel: 'rejected',
            agentId: context.agentId || 'unknown session id',
            principalId: context.principalId,
            sessionId: context.sessionId,
            clientName: context.clientName ?? null,
            clientVersion: context.clientVersion,
            observedClientType: context.observedClientType,
            transport: context.transport,
            runtimeVersion: context.runtimeVersion,
            argsSummary: '',
            resultSummary: 'MCP tools/call was rejected before tool execution.',
            workflowMetadata: {
                diagnostic_reason: reason,
            },
        }, context);
    }
    catch {
        // Rejection diagnostics are best effort.
    }
}
function makeToolResultForWrite(tool, payload) {
    return {
        ok: true,
        tool,
        status: payload.status,
        path: payload.path,
        audit_path: payload.audit_path,
        warnings: payload.warnings,
    };
}
function buildFixPlanSummary(issues) {
    const issueKinds = issues.map((issue) => issue.kind);
    const summary = [];
    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
    summary.push(`${errorCount} error(s), ${warningCount} warning(s)`);
    if (issueKinds.includes('broken_wikilink')) {
        summary.push('Fix broken wikilinks by creating target notes, correcting link targets, or replacing with plain text.');
    }
    if (issueKinds.includes('claim_missing_source')) {
        summary.push('Add source:: references under [!claim] blocks that currently have no source refs.');
    }
    if (issueKinds.includes('architecture_legacy_directory')) {
        summary.push('Review legacy folders and migrate only after explicit user confirmation.');
    }
    if (issueKinds.includes('architecture_missing_required_path')) {
        summary.push('Create missing 01_knowledge entry notes before relying on graph-first recall.');
    }
    if (issueKinds.includes('graph_missing_memory_wiki_bridge')) {
        summary.push('Add body wikilinks between memory notes and related wiki topics.');
    }
    if (issueKinds.some((kind) => kind.startsWith('graph_'))) {
        summary.push('Review graph profile findings by adding explicit entry, hub, or wikilink structure; Tracekeeper does not auto-fix graph structure.');
    }
    if (summary.length === 1) {
        summary.push('No fix plan generated because no lint issues were found.');
    }
    return summary;
}
function toolDefinitions(capabilities) {
    const definitions = [];
    for (const toolName of contracts_1.PUBLIC_TOOL_NAME_ORDER) {
        const contract = TOOL_CONTRACT_BY_NAME.get(toolName);
        if (!contract || contract.visibility !== 'public') {
            throw new Error(`Missing public tool contract or visibility for ${toolName}`);
        }
        if (capabilities &&
            !capabilities.includes('*') &&
            !capabilities.includes(contract.capability)) {
            continue;
        }
        definitions.push({
            name: contract.name,
            title: contract.name,
            description: contract.description || '',
            inputSchema: {
                type: 'object',
                properties: { ...contract.inputSchema.properties },
                ...(contract.inputSchema.required ? { required: [...contract.inputSchema.required] } : {}),
                ...(contract.inputSchema.additionalProperties !== undefined
                    ? { additionalProperties: contract.inputSchema.additionalProperties }
                    : {}),
            },
            outputSchema: contract.outputSchema,
            annotations: {
                readOnlyHint: contract.effect === 'read',
                destructiveHint: false,
                idempotentHint: contract.idempotency !== 'none',
                openWorldHint: contract.world !== 'closed',
            },
        });
    }
    return definitions;
}
function toolPrompts() {
    return [
        {
            name: 'Tracekeeper Start Task',
            title: 'Tracekeeper Start Task',
            description: 'Start a task with a bounded context summary.',
            arguments: [
                {
                    name: 'goal',
                    description: 'One-sentence task goal.',
                    required: true,
                },
                {
                    name: 'project_hint',
                    description: 'Optional project hint for project-scoped recall.',
                },
            ],
        },
        {
            name: 'Tracekeeper Recall Memory',
            title: 'Tracekeeper Recall Memory',
            description: 'Generate matching notes for fast recall.',
            arguments: [
                {
                    name: 'query',
                    description: 'Primary recall query text.',
                    required: true,
                },
                {
                    name: 'scope',
                    description: 'Scope for recall: global, project, or project_history.',
                },
                {
                    name: 'project_hint',
                    description: 'Optional project hint when scope is project.',
                },
            ],
        },
        {
            name: 'Tracekeeper Task Closeout',
            title: 'Tracekeeper Task Closeout',
            description: 'Close a previously started tracked task exactly once.',
            arguments: [
                {
                    name: 'task_id',
                    description: 'The real task id returned by tracekeeper.start_task.',
                    required: true,
                },
                {
                    name: 'summary',
                    description: 'Concise task outcome summary.',
                    required: true,
                },
            ],
        },
        {
            name: 'Tracekeeper Review Pending Memory',
            title: 'Tracekeeper Review Pending Memory',
            description: 'Inspect pending memory proposals without approving or applying them.',
            arguments: [
                {
                    name: 'project_hint',
                    description: 'Optional project hint for explaining the review scope.',
                },
            ],
        },
    ];
}
async function callTool(name, rawParams, context = {}) {
    const requestName = typeof name === 'string' ? name.trim() : '';
    if (!requestName) {
        await recordRejectedToolCallAuditEvent(context, 'tool_call_invalid_name');
        return toolError('Tool name is required.');
    }
    if (!isToolName(requestName)) {
        await recordRejectedToolCallAuditEvent(context, 'tool_call_unknown');
        return toolError(`Unknown tool: ${requestName}`);
    }
    if (!(0, protocol_1.isRecord)(rawParams)) {
        await recordRejectedToolCallAuditEvent(context, 'tool_call_invalid_arguments');
        return validateToolResult(requestName, decorateToolResult(requestName, toolError('Tool arguments must be an object.'), context));
    }
    const args = rawParams;
    const invocationId = context.invocationId?.trim()
        || `invocation-${crypto.randomUUID()}`;
    const startTime = Date.now();
    const agentId = context.agentId || 'unknown session id';
    const sessionId = context.sessionId;
    const clientName = context.clientName ?? null;
    const auditVaultRoot = resolveAuditVaultRoot(args, context);
    let toolResult = toolError(`Unknown tool: ${requestName}`);
    let status = 'failed';
    const toolName = requestName || 'unknown';
    const argsSummary = summarizeForAudit(projectArgumentsForAudit(requestName, args));
    try {
        const contract = (0, contracts_1.getContractByName)(requestName);
        const capabilities = context.credentialCapabilities;
        if (contract &&
            (!capabilities ||
                (!capabilities.includes('*') && !capabilities.includes(contract.capability)))) {
            throw new safety_1.ToolInputError(`Runtime principal ${context.principalId || 'unknown'} lacks capability ${contract.capability} for ${requestName}.`);
        }
        const handler = TOOL_HANDLERS[requestName];
        const result = await handler(args, context);
        toolResult = toolResultWithError(result);
        toolResult = markDeprecatedToolResult(requestName, toolResult);
        toolResult = decorateToolResult(requestName, toolResult, context);
        status = isToolResultFailure(toolResult) ? 'failed' : 'success';
        toolResult = validateToolResult(requestName, toolResult);
    }
    catch (error) {
        if (requestName === 'tracekeeper.apply_approved_writeback') {
            toolResult = toolError(boundedWritebackErrorMessage(error, auditVaultRoot));
        }
        else if (error instanceof safety_1.ToolInputError || error instanceof core_1.VaultPathError) {
            toolResult = toolError(error.message);
        }
        else if (error instanceof Error) {
            toolResult = toolError(error.message);
        }
        else {
            toolResult = toolError(toErrorMessage(error));
        }
        toolResult = decorateToolResult(requestName, toolResult, context);
        toolResult = validateToolResult(requestName, toolResult);
        status = 'failed';
    }
    finally {
        if (auditVaultRoot) {
            try {
                await recordToolCallAuditEventAsync(auditVaultRoot, {
                    invocationId,
                    requestId: context.requestId,
                    toolName,
                    resultStatus: status,
                    targetPaths: collectAuditTargetsFromResult(requestName, args, toolResult.structuredContent),
                    durationMs: Date.now() - startTime,
                    riskLevel: getToolRiskLevel(requestName),
                    agentId,
                    principalId: context.principalId,
                    sessionId,
                    clientName,
                    clientVersion: context.clientVersion,
                    observedClientType: context.observedClientType,
                    transport: context.transport,
                    runtimeVersion: context.runtimeVersion,
                    argsSummary,
                    resultSummary: summarizeToolPayload(toolResult.structuredContent, isToolResultFailure(toolResult)),
                    workflowMetadata: buildWorkflowAuditMetadata(toolName, args, toolResult.structuredContent),
                }, context);
            }
            catch {
                // Tool-call audit writes are best effort.
            }
        }
    }
    return toolResult;
}
async function recoverPendingOperations(vaultRoot, context = {}) {
    const journal = operationJournalForVault(vaultRoot);
    const records = await journal.listRecoverable();
    const report = { recovered: [], failed: [], skipped: [] };
    for (const record of records) {
        if (record.operation_id.startsWith('writeback-')
            && !isApplyApprovedWritebackPayload(record.payload)) {
            const failedAt = new Date().toISOString();
            await journal.save({
                operation_id: record.operation_id,
                idempotency_key: record.idempotency_key,
                payload_hash: record.payload_hash,
                status: 'conflicted',
                created_at: record.created_at,
                updated_at: failedAt,
                failed_at: failedAt,
                error: 'Incompatible writeback recovery record requires a fresh preview.',
                completed_steps: record.completed_steps.map((step) => ({
                    name: step.name,
                    completed_at: step.completed_at,
                })),
            });
            report.failed.push({
                operation_id: record.operation_id,
                error: 'Incompatible writeback recovery record requires a fresh preview.',
            });
            continue;
        }
        const request = recoveryRequestForRecord(record);
        if (!request) {
            report.skipped.push(record.operation_id);
            continue;
        }
        const result = await callTool(request.tool, request.args, {
            ...context,
            defaultVaultRoot: vaultRoot,
            principalId: context.principalId || exports.LOCAL_TRUST_PRINCIPAL_ID,
            credentialCapabilities: context.credentialCapabilities || exports.LOCAL_TRUST_CAPABILITIES,
            agentId: context.agentId || 'tracekeeper-recovery',
            clientName: context.clientName || 'tracekeeper-runtime-recovery',
            transport: context.transport || 'runtime-recovery',
            writebackRecoveryOperationId: record.operation_id,
        });
        if (result.isError) {
            const structured = result.structuredContent;
            report.failed.push({
                operation_id: record.operation_id,
                error: (0, protocol_1.isRecord)(structured) && typeof structured.error === 'string'
                    ? structured.error
                    : 'Operation recovery failed.',
            });
            continue;
        }
        report.recovered.push(record.operation_id);
    }
    return report;
}
function recoveryRequestForRecord(record) {
    if (!(0, protocol_1.isRecord)(record.payload)) {
        return null;
    }
    const payload = record.payload;
    if (record.operation_id.startsWith('start-task-')) {
        return {
            tool: 'tracekeeper.start_task',
            args: {
                goal: payload.goal,
                client: payload.client,
                project_hint: payload.projectHint,
                project_id: payload.projectId,
                repo_path: payload.repoPath,
                idempotency_key: record.idempotency_key,
            },
        };
    }
    if (record.operation_id.startsWith('finish-task-')) {
        if ((0, protocol_1.isRecord)(payload.requestSnapshot)) {
            return {
                tool: 'tracekeeper.finish_task',
                args: {
                    ...payload.requestSnapshot,
                    idempotency_key: record.idempotency_key,
                },
            };
        }
        return {
            tool: 'tracekeeper.finish_task',
            args: {
                task_id: payload.taskId,
                summary: payload.summary,
                outcomes: payload.outcomes,
                decisions: payload.decisions,
                solution_changes: payload.solutionChanges,
                lessons: payload.lessons,
                preferences: payload.preferences,
                memory_candidates: payload.memoryCandidates,
                next_actions: payload.nextActions,
                review_proposal_mode: payload.reviewProposalMode,
                client: payload.client,
                project_hint: payload.projectHint,
                project_id: payload.projectId,
                repo_path: payload.repoPath,
                memory_scope: payload.memoryScope,
                related_wiki: payload.relatedWiki,
                related_sources: payload.relatedSources,
                filename: payload.filename,
                idempotency_key: record.idempotency_key,
            },
        };
    }
    if (record.operation_id.startsWith('propose-memory-')
        && isProposeMemoryOperationPayload(payload)) {
        return {
            tool: 'tracekeeper.propose_memory',
            args: {
                ...payload.requestSnapshot,
                idempotency_key: record.idempotency_key,
            },
        };
    }
    if (record.operation_id.startsWith('writeback-')) {
        return {
            tool: 'tracekeeper.apply_approved_writeback',
            args: {
                proposal_path: payload.proposalPath,
                task_id: payload.taskId,
            },
        };
    }
    return null;
}
function toolResultWithError(value) {
    return toolResult(value);
}
function markDeprecatedToolResult(toolName, result) {
    const replacement = DEPRECATED_TOOL_REPLACEMENTS[toolName];
    if (!replacement || result.isError || !(0, protocol_1.isRecord)(result.structuredContent)) {
        return result;
    }
    return toolResult({
        ...result.structuredContent,
        deprecated: true,
        replacement_tool: replacement,
    });
}
function buildRecommendedRecall(goal, identity, context) {
    const hasResolvedProject = hasProjectScope(identity) && identity.confidence !== 'uncertain';
    const scope = hasResolvedProject ? 'project' : 'global';
    const args = {
        query: goal,
        scope,
        max_items: 6,
    };
    if (hasResolvedProject) {
        if (identity.projectHint) {
            args.project_hint = identity.projectHint;
        }
        if (identity.projectId) {
            args.project_id = identity.projectId;
        }
        if (identity.repoPath) {
            args.repo_path = identity.repoPath;
        }
    }
    return {
        tool: 'tracekeeper.recall',
        arguments: args,
        reason: hasResolvedProject
            ? contentText(context, '读取单篇笔记前，先使用项目级召回。', 'Use project-scoped recall before reading individual notes.')
            : contentText(context, '先使用全局召回；已知项目后再用 project_hint 缩小范围。', 'Use global recall first, then narrow with project_hint when a project is known.'),
    };
}
function buildCloseoutContract(context) {
    return {
        required_tool: 'tracekeeper.finish_task',
        default_mode: defaultReviewProposalMode(context),
        content_language: contentLanguageFromContext(context),
        content_language_source: contentLanguageSourceFromContext(context),
        fields: [
            'summary',
            'outcomes',
            'decisions',
            'solution_changes',
            'lessons',
            'preferences',
            'next_actions',
            'memory_candidates',
            'related_wiki',
            'related_sources',
        ],
        project_hint_required_for_project_memory: true,
        note: 'At task closeout, include durable decisions, solution changes, lessons, user preferences, next actions, and memory candidates when present. ' +
            'Reuse verified wiki/source paths already gathered from recall/read_note, otherwise report review fallback.',
    };
}
function buildStartTaskNextActions(identity, context) {
    const actions = [
        contentText(context, '读取单篇笔记前，先调用 tracekeeper.recall。', 'Call tracekeeper.recall before reading individual notes.'),
        contentText(context, '只有召回摘要不够时，再使用 tracekeeper.read_note。', 'Use tracekeeper.read_note only when a recall excerpt is not enough.'),
        contentText(context, '任务结束时调用一次 tracekeeper.finish_task，提交决策、方案调整、经验、偏好、下一步和记忆候选。', 'Call tracekeeper.finish_task once at the end with decisions, solution changes, lessons, preferences, next actions, and memory candidates.'),
    ];
    if (hasProjectScope(identity) && identity.confidence !== 'uncertain') {
        actions.unshift(contentText(context, '使用相同 project_hint 和 scope="project" 做定向召回。', 'Use scope="project" with the same project_hint for targeted recall.'));
        actions.splice(2, 0, contentText(context, '需要承接历史任务时，使用 scope="project_history"。', 'Use scope="project_history" when continuity from earlier sessions is needed.'));
    }
    else if (identity.confidence === 'uncertain' && identity.warnings.length > 0) {
        actions.unshift(contentText(context, '项目身份尚未确认；先使用全局召回并让用户确认项目，不要静默选择。', 'Project identity is unresolved; use global recall and ask the user to confirm the project instead of choosing silently.'));
    }
    return actions;
}
function handleStatus(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const scan = scanVaultForContext(vaultRoot, context);
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        scanned_at: scan.scannedAt,
        ...scanProvenance(scan),
        content_language: contentLanguageFromContext(context),
        content_language_source: contentLanguageSourceFromContext(context),
        counts: {
            notes: scan.notes.length,
            errors: scan.errors.length,
            by_type: buildProjectCounts(scan.notes),
        },
        scan_errors: scan.errors.slice(0, 5),
    };
}
function handleGraphHealth(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const maxItems = coercePositiveInt(rawArgs.max_items, 20, 1, 2000);
    const profile = graphProfileFromArgs(rawArgs.graph_profile, context);
    if (profile === 'off') {
        return {
            ok: true,
            read_only: true,
            disabled: true,
            profile,
            profile_issues: [],
            vault_root: vaultRoot,
        };
    }
    const scan = scanVaultForContext(vaultRoot, context);
    const graphHealth = (0, core_1.analyzeGraphHealth)(scan.notes, {
        maxItems,
    });
    const profileEvaluation = (0, core_1.evaluateGraphProfile)(graphHealth, profile);
    return {
        ok: true,
        read_only: true,
        disabled: profileEvaluation.disabled,
        profile: profileEvaluation.profile,
        profile_issues: profileEvaluation.profile_issues,
        vault_root: vaultRoot,
        scanned_at: scan.scannedAt,
        ...scanProvenance(scan),
        ...graphHealth,
    };
}
function operationJournalForVault(vaultRoot) {
    const operationDirectory = path.resolve(vaultRoot, core_1.TRACEKEEPER_OPERATIONS_DIR);
    (0, safety_1.relativeFromAbsolute)(vaultRoot, operationDirectory);
    (0, safety_1.assertNoSymlinkSegments)(vaultRoot, operationDirectory);
    return new core_1.NodeFileOperationJournal({ directory: operationDirectory });
}
function buildToolOperationIdentity(tool, rawIdempotencyKey, payload, context) {
    const providedKey = coerceOptionalString(rawIdempotencyKey);
    if (providedKey.length > 512) {
        throw new safety_1.ToolInputError('idempotency_key must be at most 512 characters.');
    }
    const payloadHash = (0, core_1.computePayloadHash)(payload);
    const sessionScope = context.sessionId || context.agentId || 'legacy-client';
    const idempotencyKey = providedKey || `legacy:${tool}:${sessionScope}:${payloadHash}`;
    const identity = crypto
        .createHash('sha256')
        .update(`${tool}\0${idempotencyKey}`)
        .digest('hex')
        .slice(0, 24);
    return {
        operationId: `${tool}-${identity}`,
        idempotencyKey,
    };
}
async function handleStartTask(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const goal = coerceNonEmptyString(rawArgs.goal, true, 'goal');
    const client = coerceNonEmptyString(rawArgs.client);
    const scan = scanVaultForContext(vaultRoot, context);
    const projectIdentity = (0, project_identity_1.resolveProjectIdentity)(rawArgs, scan.notes);
    const projectHint = projectIdentity.projectHint;
    if (goal.length < 3) {
        throw new safety_1.ToolInputError('goal must have at least 3 characters.');
    }
    const operationPayload = {
        goal,
        client,
        projectHint,
        projectId: projectIdentity.projectId,
        repoPath: projectIdentity.repoPath,
        contentLanguage: contentLanguageFromContext(context),
    };
    const operationIdentity = buildToolOperationIdentity('start-task', rawArgs.idempotency_key, operationPayload, context);
    const taskId = `obs_task_${operationIdentity.operationId.slice('start-task-'.length)}`;
    const runner = new core_1.RecoverableOperationRunner({
        operationId: operationIdentity.operationId,
        idempotencyKey: operationIdentity.idempotencyKey,
        payload: operationPayload,
        journal: operationJournalForVault(vaultRoot),
        failureInjection: context.operationFailureInjection,
        steps: [],
        finalize: async () => {
            const scopedScan = hasProjectScope(projectIdentity) && projectIdentity.confidence !== 'uncertain'
                ? {
                    ...scan,
                    notes: filterNotesByProjectScopeWithSessions(scan.notes, projectIdentity),
                }
                : scan;
            const contextPack = buildContextPackForContext(vaultRoot, goal, context, { limit: 8 }, scopedScan);
            const relatedProjects = scan.notes
                .filter((note) => PROJECT_MEMORY_READ_DIRS.some((dir) => note.relativePath.startsWith(`${dir}/`)))
                .slice(0, 10)
                .map((note) => ({ path: note.relativePath, title: note.title }));
            const task = await createAgentTaskRecord(vaultRoot, {
                taskId,
                goal,
                client,
                projectHint,
                projectId: projectIdentity.projectId,
                repoPath: projectIdentity.repoPath,
                projectIdentitySource: projectIdentity.source,
                projectIdentityConfidence: projectIdentity.confidence,
                projectIdentityWarnings: projectIdentity.warnings,
                context,
                contextPack,
                operationId: operationIdentity.operationId,
            });
            return {
                ok: true,
                read_only: false,
                operation_id: operationIdentity.operationId,
                idempotency_key: operationIdentity.idempotencyKey,
                task_id: taskId,
                path: task.path,
                audit_path: task.audit_path,
                client: client || null,
                project_hint: projectHint || null,
                vault_root: vaultRoot,
                ...scanProvenance(scan),
                content_language: contentLanguageFromContext(context),
                content_language_source: contentLanguageSourceFromContext(context),
                context_pack_summary: {
                    query: contextPack.query,
                    generated_at: contextPack.generatedAt,
                    relevant_notes: contextPack.relevantNotes,
                    source_candidates: contextPack.sourceCandidates.slice(0, 10),
                    gaps: contextPack.gaps,
                    stale_warnings: contextPack.staleWarnings,
                },
                related_projects: relatedProjects,
                recent_sessions: buildRecentSessions(scan.notes),
                user_preferences: buildUserPreferences(scan),
                recommended_next_tool: 'tracekeeper.recall',
                recommended_recall: buildRecommendedRecall(goal, projectIdentity, context),
                closeout_contract: buildCloseoutContract(context),
                next_actions_for_agent: buildStartTaskNextActions(projectIdentity, context),
                project_id: projectIdentity.projectId || null,
                repo_path: projectIdentity.repoPath || null,
                project_identity: (0, project_identity_1.projectIdentityToResult)(projectIdentity),
            };
        },
    });
    return runner.run();
}
function executeRecallApplication(scope, rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const query = scope === 'project_history'
        ? coerceOptionalString(rawArgs.query)
        : coerceNonEmptyString(rawArgs.query, true, 'query');
    const maxItems = coercePositiveInt(rawArgs.max_items, scope === 'global' ? 6 : MAX_PROJECT_TOOL_ITEMS, 1, MAX_PROJECT_TOOL_ITEMS);
    const service = new recall_1.RecallApplicationService({
        loadScan: () => scanVaultForContext(vaultRoot, context),
        nowMs: () => Date.now(),
        resolveProjectIdentity: project_identity_1.resolveProjectIdentity,
        filterProjectNotes: filterNotesByProjectScopeWithSessions,
        buildRelationEvidence: buildRecallRelationEvidence,
        contentOrigin: recallContentOrigin,
    });
    return service.execute({
        scope,
        query,
        maxItems,
        vaultRoot,
        projectIdentityInput: rawArgs,
    });
}
function handleRecall(rawArgs, context) {
    const scope = coerceRecallScope(rawArgs.scope);
    if (scope === 'project') {
        const result = executeRecallApplication('project', rawArgs, context);
        return {
            ...result,
            scope: {
                ...result.scope,
                scope,
            },
            scope_mode: result.scope_mode ?? scope,
        };
    }
    if (scope === 'project_history') {
        const result = executeRecallApplication('project_history', rawArgs, context);
        return {
            ...result,
            scope: {
                ...result.scope,
                scope,
            },
            scope_mode: scope,
        };
    }
    return executeRecallApplication('global', rawArgs, context);
}
function handleProjectMemory(rawArgs, context) {
    const action = coerceNonEmptyString(rawArgs.action, true, 'action').toLowerCase();
    if (action !== 'list') {
        throw new safety_1.ToolInputError('project_memory action must be: list.');
    }
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const scan = scanVaultForContext(vaultRoot, context);
    const identity = (0, project_identity_1.resolveProjectIdentity)(rawArgs, scan.notes);
    if (identity.confidence === 'uncertain' || !identity.projectId) {
        throw new safety_1.ToolInputError('Project-memory catalog requires one exact project identity resolved from the active Vault.');
    }
    const cursor = coerceOptionalString(rawArgs.cursor);
    const pageSize = coercePositiveInt(rawArgs.page_size, 50, 1, 200);
    return {
        read_only: true,
        ...(0, project_memory_1.buildProjectMemoryCatalog)((0, project_memory_1.projectProjectMemorySnapshot)(scan), {
            projectId: identity.projectId,
            cursor: cursor || null,
            pageSize,
        }),
    };
}
async function handleReadNote(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const notePath = coerceNonEmptyString(rawArgs.path, true, 'path');
    const recallId = coerceOptionalString(rawArgs.recall_id);
    const safePath = (0, safety_1.relativeFromAbsolute)(vaultRoot, (0, safety_1.resolveSafeNotePath)(vaultRoot, notePath, pathSafetyOptions(context)));
    let data;
    if (context.vaultRepository) {
        const repositoryFile = await context.vaultRepository.readText(safePath);
        if (!repositoryFile) {
            throw new safety_1.ToolInputError(`Note does not exist: ${safePath}`);
        }
        data = { path: repositoryFile.path, text: repositoryFile.content };
    }
    else {
        data = safeReadNote(vaultRoot, safePath, context);
    }
    const parsed = (0, core_1.parseMarkdown)(data.text);
    const scan = scanVaultForContext(vaultRoot, context);
    const scannedNote = scan.notes.find((note) => note.relativePath === data.path);
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        path: data.path,
        title: parsed.title || path.basename(data.path),
        mime_type: data.path.endsWith('.txt') || data.path.endsWith('.text') ? 'text/plain' : 'text/markdown',
        recall_id: recallId || null,
        content_origin: recallContentOrigin(data.path, typeof parsed.frontmatter.fields.type === 'string' ? parsed.frontmatter.fields.type : undefined),
        instruction_trust: 'data_only',
        content: data.text,
        excerpt: parsed.body.slice(0, 1024),
        relation_evidence: scannedNote
            ? buildRecallRelationEvidence(scannedNote, scan.notes)
            : { related_wiki: [], related_sources: [] },
    };
}
function handleProjectContext(rawArgs, context) {
    return executeRecallApplication('project', rawArgs, context);
}
function handleProjectHistory(rawArgs, context) {
    return executeRecallApplication('project_history', rawArgs, context);
}
function handleListSourceRequests(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const maxItems = coercePositiveInt(rawArgs.max_items, MAX_LIST_QUEUE_ITEMS, 1, MAX_LIST_QUEUE_ITEMS);
    const statusFilter = coerceOptionalString(rawArgs.status) || 'pending';
    const sourceKindFilter = coerceOptionalString(rawArgs.source_kind).toLowerCase();
    const scan = scanVaultForContext(vaultRoot, context);
    const normalizedStatus = statusFilter.toLowerCase().trim();
    const requests = scan.notes
        .filter((note) => note.relativePath.startsWith(`${SOURCE_REQUESTS_DIR}/`))
        .filter((note) => {
        const noteType = toSourceRequestRow(note).noteType.toLowerCase();
        return noteType.includes('agent-request');
    })
        .map((note) => {
        const row = toSourceRequestRow(note);
        return {
            path: note.relativePath,
            source: row.source,
            sourceKind: row.sourceKind,
            purpose: row.purpose,
            relatedProject: row.relatedProject,
            analysisMode: row.analysisMode,
            status: row.status,
            modifiedAt: note.modifiedAt,
        };
    })
        .filter((request) => sourceKindFilter === '' || request.sourceKind.toLowerCase() === sourceKindFilter)
        .filter((request) => {
        if (!normalizedStatus || normalizedStatus === 'pending') {
            return isSourceRequestPending(request.status);
        }
        return request.status.toLowerCase() === normalizedStatus;
    })
        .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
        .slice(0, maxItems);
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        count: requests.length,
        filter: {
            status: statusFilter || 'pending',
            source_kind: sourceKindFilter || 'any',
        },
        entries: requests,
    };
}
function buildSourceRunToken(request) {
    const safeRequest = request.filename
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-z0-9._-]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return `${safeRequest}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}
async function resolveSourceInput(request, vaultRoot, context) {
    const source = request.source.trim();
    const sourceKind = request.sourceKind.trim().toLowerCase();
    if (!source) {
        return {
            sourceText: `No source identifier found in request ${request.path}.`,
            mode: 'extracted_snapshot',
            warnings: ['request has empty source field'],
        };
    }
    if (isUrlSource(source)) {
        return {
            sourceText: `External reference pending human/agent fetch. ` +
                `Source URL: ${source}. ` +
                'This request intentionally avoids network fetch.',
            mode: 'external_reference',
            warnings: ['external network fetch intentionally skipped'],
        };
    }
    const parsedPath = parseOptionalIntendedSourcePath(source, sourceKind);
    if (parsedPath.requestedPath) {
        try {
            const fileText = await safeReadTextFileAsync(vaultRoot, parsedPath.requestedPath, context);
            return {
                sourceText: fileText,
                mode: 'local_copy',
                resolvedSourcePath: parsedPath.requestedPath,
                warnings: [],
            };
        }
        catch (error) {
            if (error instanceof safety_1.ToolInputError || error instanceof core_1.VaultPathError) {
                return {
                    sourceText: request.content || source,
                    mode: 'extracted_snapshot',
                    warnings: ['source path is not readable, fallback to request body'],
                };
            }
            throw error;
        }
    }
    const bodyText = extractSelectionText(request.content);
    return {
        sourceText: bodyText || request.content || source,
        mode: 'extracted_snapshot',
        warnings: ['using request-provided text for analysis'],
    };
}
function buildSourceNoteContent(request, mode, sourceText, analysis, context, resolvedSourcePath) {
    void sourceText;
    const section = [contentText(context, '## 来源笔记', '## Source note'), `- request_path: ${request.path}`, `- mode: ${mode}`, `- source_kind: ${request.sourceKind || 'unknown'}`];
    section.push(`- analysis_mode: ${request.analysisMode || 'default'}`);
    if (resolvedSourcePath) {
        section.push(`- resolved_source_path: ${resolvedSourcePath}`);
    }
    section.push('');
    section.push(contentText(context, '## 来源摘要', '## Source summary'));
    section.push(analysis.summary);
    section.push('');
    section.push(contentText(context, '## 证据脚手架', '## Evidence scaffold'));
    for (const item of analysis.evidenceScaffolds) {
        section.push(`- ${item}`);
    }
    section.push('');
    section.push(contentText(context, '## 论断脚手架', '## Claim scaffold'));
    for (const item of analysis.claimScaffolds) {
        section.push(`- ${item}`);
    }
    section.push('');
    section.push(contentText(context, '## 来源摘录', '## Source excerpt'));
    section.push(analysis.excerpt);
    return section.join('\n');
}
function buildReportContent(request, mode, sourceText, analysis, sourceNotePath, warnings, context) {
    const sourceContent = `\n${contentText(context, '## 来源', '## Source')}\n\n${sourceText.slice(0, MAX_SOURCE_EXCERPT_LENGTH)}\n`;
    const section = [
        contentText(context, '## 来源分析报告', '## Source Analysis Report'),
        `- source: ${request.source}`,
        `- request_path: ${request.path}`,
        `- source_kind: ${request.sourceKind || 'unknown'}`,
        `- analysis_mode: ${request.analysisMode || 'default'}`,
        `- mode: ${mode}`,
        `- source_note: ${sourceNotePath}`,
        `- related_project: ${request.relatedProject || 'unset'}`,
        `- purpose: ${request.purpose || 'unset'}`,
    ];
    if (warnings.length > 0) {
        section.push(`- warnings: ${JSON.stringify(warnings)}`);
    }
    section.push('');
    section.push(contentText(context, '## 摘要', '## Summary'));
    section.push(analysis.summary);
    section.push('');
    section.push(contentText(context, '## 摘录', '## Excerpt'));
    section.push(`\n${analysis.excerpt}\n`);
    section.push('');
    section.push(contentText(context, '## 证据脚手架', '## Evidence scaffold'));
    section.push(...analysis.evidenceScaffolds.map((entry) => `- ${entry}`));
    section.push('');
    section.push(contentText(context, '## 论断脚手架', '## Claim scaffold'));
    section.push(...analysis.claimScaffolds.map((entry) => `- ${entry}`));
    section.push('');
    section.push(sourceContent);
    return section.join('\n');
}
async function handleAnalyzeSourceRequest(rawArgs, context, sourceToolName = 'tracekeeper.analyze_source_request') {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const requestPath = coerceOptionalString(rawArgs.request_path) || coerceOptionalString(rawArgs.path);
    if (!requestPath) {
        throw new safety_1.ToolInputError('Missing required argument: request_path or path.');
    }
    const requestPathAlias = requestPath;
    const updateStatus = coerceBoolean(rawArgs.update_request_status, 'update_request_status', true);
    const forceReprocess = coerceBoolean(rawArgs.force_reprocess, 'force_reprocess', false);
    const now = new Date().toISOString();
    let failureStatusAllowed = false;
    let failureRequestPath = requestPathAlias;
    let failureTaskId = coerceOptionalString(rawArgs.task_id) || null;
    try {
        const request = await readSourceRequestAsync(vaultRoot, requestPathAlias, context);
        const taskId = coerceOptionalString(rawArgs.task_id) || request.taskId || null;
        failureRequestPath = request.path;
        failureTaskId = taskId;
        if (!request.type.toLowerCase().includes('agent-request')) {
            throw new safety_1.ToolInputError('Request note is not an agent-request note.');
        }
        if (!forceReprocess && request.status && !isSourceRequestPending(request.status)) {
            throw new safety_1.ToolInputError(`Request status is ${request.status}; use force_reprocess=true to process anyway.`);
        }
        failureStatusAllowed = !request.status || isSourceRequestPending(request.status);
        const { sourceText, mode, resolvedSourcePath, warnings } = await resolveSourceInput(request, vaultRoot, context);
        const analysis = (0, core_1.analyzeSourceText)({
            source: request.source,
            sourceKind: request.sourceKind || 'unknown',
            analysisMode: request.analysisMode || 'default',
            purpose: request.purpose,
            content: sourceText,
            requestPath: request.path,
            contentLanguage: contentLanguageFromContext(context),
        });
        assertNoSensitiveText([
            { label: 'source', value: request.source },
            { label: 'purpose', value: request.purpose },
            { label: 'source content', value: sourceText },
            { label: 'summary', value: analysis.summary },
            { label: 'excerpt', value: analysis.excerpt },
        ]);
        const runToken = buildSourceRunToken(request);
        const sourceFilename = buildSafeFilename(`${runToken}-source`, 'source', context);
        const sourceNote = await buildAndWriteNoteAsync(vaultRoot, sourceToolName, SOURCES_DIR, sourceFilename, {
            tool: sourceToolName,
            type: 'source_analysis_source',
            title: `source_analysis_source_${runToken}`,
            source: request.source,
            source_kind: request.sourceKind || null,
            analysis_mode: request.analysisMode || 'default',
            request_path: request.path,
            mode,
            created_at: now,
            task_id: taskId,
        }, buildSourceNoteContent(request, mode, sourceText, analysis, context, resolvedSourcePath), taskId, context, { target_type: 'source', mode, request_path: request.path });
        const reportFilename = buildSafeFilename(`${runToken}-report`, 'source-report', context);
        const report = await buildAndWriteNoteAsync(vaultRoot, sourceToolName, SOURCE_ANALYSIS_REPORT_DIR, reportFilename, {
            tool: sourceToolName,
            type: 'source_analysis_report',
            title: `source_analysis_report_${runToken}`,
            source: request.source,
            source_kind: request.sourceKind || null,
            analysis_mode: request.analysisMode || 'default',
            request_path: request.path,
            source_note: sourceNote.path,
            created_at: now,
            task_id: taskId,
        }, buildReportContent(request, mode, sourceText, analysis, sourceNote.path, warnings, context), taskId, context, { target_type: 'source_analysis_report', request_path: request.path });
        const proposals = [];
        for (const [proposalIndex, entry] of analysis.proposalDrafts.entries()) {
            const proposalId = (0, core_1.buildStableProposalId)(`source-analysis\0${runToken}\0${proposalIndex}\0${entry.proposalKind}`);
            const proposalNote = await buildAndWriteNoteAsync(vaultRoot, sourceToolName, MEMORY_PROPOSAL_DIR, buildSafeFilename(`proposal-${runToken}-${entry.proposalKind}`, entry.proposalKind, context), {
                tool: sourceToolName,
                type: 'memory_proposal',
                proposal_id: proposalId,
                title: entry.title || `source_proposal_${runToken}`,
                proposal_kind: entry.proposalKind,
                status: 'pending',
                source: request.source,
                source_kind: request.sourceKind || null,
                target_note: report.path,
                risk_level: entry.riskLevel || null,
                created_at: now,
                task_id: taskId,
            }, `${contentText(context, '## 来源分析提案', '## Source analysis proposal')}\n\n- evidence: ${entry.evidence}\n\n${contentText(context, '## 写回内容', '## Writeback')}\n${entry.content}\n`, taskId, context, {
                target_type: 'memory_proposal',
                proposal_kind: entry.proposalKind,
                request_path: request.path,
                source_note: sourceNote.path,
            });
            proposals.push({
                proposalId,
                path: proposalNote.path,
                linkTarget: proposalNote.path,
            });
        }
        let auditPathForReturn = sourceNote.audit_path;
        if (updateStatus) {
            failureStatusAllowed = false;
            await updateRequestStatusAsync(vaultRoot, request.path, 'completed', context);
            auditPathForReturn = (await appendAuditEventAsync(vaultRoot, {
                tool: sourceToolName,
                targetPath: request.path,
                status: 'written',
                taskId,
                metadata: {
                    action: 'source.request.completed',
                    source_note: sourceNote.path,
                    source_report: report.path,
                    proposal_ids: proposals.map((proposal) => proposal.proposalId).join(','),
                    proposal_paths: proposals.map((proposal) => proposal.path).join(','),
                },
            }, context)).path;
        }
        const taskPath = await updateAgentTaskRecordAsync(vaultRoot, taskId, {}, context, {
            source_captures: [sourceNote.path, report.path],
            proposal_ids: proposals.map((proposal) => proposal.proposalId),
            proposal_paths: proposals.map((proposal) => proposal.path),
            proposal_link_targets: proposals.map((proposal) => proposal.linkTarget),
        });
        if (taskPath) {
            await updateManagedProposalReferences(vaultRoot, taskPath, proposals, context);
        }
        return {
            ok: true,
            read_only: false,
            tool: sourceToolName,
            status: 'completed',
            vault_root: vaultRoot,
            request_path: request.path,
            mode,
            source_note: {
                path: sourceNote.path,
                audit_path: sourceNote.audit_path,
            },
            report: {
                path: report.path,
                audit_path: report.audit_path,
            },
            proposals: proposals.map((proposal) => ({
                proposal_id: proposal.proposalId,
                path: proposal.path,
                proposal_link_target: proposal.linkTarget,
            })),
            audit_path: auditPathForReturn,
            summary: analysis.summary,
            warnings,
        };
    }
    catch (error) {
        if (updateStatus && failureStatusAllowed) {
            try {
                await updateRequestStatusAsync(vaultRoot, failureRequestPath, 'failed', context);
                await appendAuditEventAsync(vaultRoot, {
                    tool: sourceToolName,
                    targetPath: failureRequestPath,
                    status: 'failed',
                    taskId: failureTaskId,
                    metadata: {
                        action: 'source.request.failed',
                        error: toErrorMessage(error),
                    },
                }, context);
            }
            catch {
                // audit and state update are best-effort; keep original error handling path.
            }
        }
        throw error;
    }
}
function handleReviewQueueUnified(rawArgs, context) {
    const action = coerceReviewQueueAction(rawArgs.action);
    const result = action === 'list_approved'
        ? handleListApprovedWritebacks(rawArgs, context)
        : handleReviewQueue(rawArgs, context);
    return {
        ...result,
        tool: 'tracekeeper.review_queue',
        action,
    };
}
async function handleSourceRequest(rawArgs, context) {
    const action = coerceSourceRequestAction(rawArgs.action, rawArgs);
    const result = action === 'analyze'
        ? await handleAnalyzeSourceRequest(rawArgs, context, 'tracekeeper.source_request')
        : handleListSourceRequests(rawArgs, context);
    return {
        ...result,
        tool: 'tracekeeper.source_request',
        action,
    };
}
function handleReviewQueue(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const maxItems = coercePositiveInt(rawArgs.max_items, MAX_LIST_QUEUE_ITEMS, 1, MAX_LIST_QUEUE_ITEMS);
    const scan = scanVaultForContext(vaultRoot, context);
    const pending = scan.notes
        .filter((note) => note.relativePath.startsWith(REVIEW_QUEUE_PREFIX))
        .filter(isPendingProposal)
        .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
        .slice(0, maxItems)
        .map((note) => ({
        path: note.relativePath,
        title: note.title,
        modifiedAt: note.modifiedAt,
        status: readProposalApprovalStatus(note.frontmatter),
        proposal_kind: readFrontmatterString(note.frontmatter, ['proposal_kind', 'proposalKind']) || null,
        risk_level: readFrontmatterString(note.frontmatter, ['risk_level', 'riskLevel']) || null,
    }));
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        count: pending.length,
        entries: pending,
    };
}
function handleListApprovedWritebacks(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const rawLimit = rawArgs.max_items ?? rawArgs.limit;
    const maxItems = coercePositiveInt(rawLimit, MAX_APPROVED_WRITEBACKS, 1, MAX_APPROVED_WRITEBACKS);
    const scope = coerceOptionalString(rawArgs.scope);
    const scan = scanVaultForContext(vaultRoot, context);
    const candidates = [];
    for (const note of scan.notes) {
        if (!note.relativePath.startsWith(`${REVIEW_QUEUE_PREFIX}/`)) {
            continue;
        }
        if (readProposalApprovalStatus(note.frontmatter) !== 'approved') {
            continue;
        }
        if (scope) {
            const proposalKind = stripYamlQuotes(readFrontmatterString(note.frontmatter, ['proposal_kind', 'proposalKind']));
            const targetNote = stripYamlQuotes(readFrontmatterString(note.frontmatter, ['target_note', 'targetNote']));
            if (!proposalKind.includes(scope) && !targetNote.startsWith(scope)) {
                continue;
            }
        }
        const proposal = readMemoryProposal(vaultRoot, note.relativePath, context);
        candidates.push(buildWritebackPlan(proposal));
    }
    const entries = candidates
        .sort((a, b) => a.proposal.path.localeCompare(b.proposal.path))
        .slice(0, maxItems)
        .map((plan) => ({
        proposal_id: plan.proposal.proposalId,
        proposal_path: plan.proposal.path,
        proposal_kind: plan.proposal.proposalKind,
        target_note: plan.targetNote || null,
        risk_level: plan.proposal.riskLevel,
        task_id: plan.proposal.taskId || null,
        ready_to_apply: plan.ready,
        blocker: plan.ready ? null : plan.reason || 'not ready',
    }));
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        count: entries.length,
        entries,
    };
}
function buildApprovedWritebackOperationIdentity(proposal, proposalRevision, previewNonce) {
    const identity = crypto
        .createHash('sha256')
        .update(`${proposal.path}\0${proposal.proposalId}\0${proposalRevision}\0${previewNonce}`)
        .digest('hex')
        .slice(0, 24);
    return {
        operationId: `writeback-${identity}`,
        idempotencyKey: `apply-approved-writeback:${proposal.path}:${proposal.proposalId}:${proposalRevision}:${previewNonce}`,
    };
}
function assertMatchingWritebackBinding(expected, current) {
    if ((0, core_1.computePayloadHash)(expected) !== (0, core_1.computePayloadHash)(current)) {
        throw new core_1.OperationConflictError('Writeback confirmation is stale because the approved proposal, target, task, or touched-note plan changed.');
    }
}
async function currentWritebackEffect(vaultRoot, payload, operationId, context) {
    const proposal = await resolveMemoryProposalFromArgs(vaultRoot, {
        proposal_path: payload.proposalPath,
        task_id: payload.taskId,
    }, context);
    const snapshot = proposalTransitionSnapshot(proposal);
    const writeback = buildApprovedWritebackBlock(snapshot.proposalId, snapshot.writebackContent);
    const currentTaskPath = payload.taskId ? buildTaskNotePath(payload.taskId) : null;
    const currentTask = currentTaskPath
        ? await readCurrentVaultTextState(vaultRoot, currentTaskPath, context)
        : null;
    const target = await readCurrentVaultTextState(vaultRoot, payload.targetPath, context);
    if (snapshot.status !== 'approved'
        || proposal.proposalId !== payload.proposalId
        || proposal.path !== payload.proposalPath
        || (0, core_1.computeProposalRevision)(snapshot) !== payload.proposalRevision
        || (0, core_1.computeProposalContentHash)(snapshot) !== payload.proposalContentHash
        || (0, core_1.computePayloadHash)(proposal.text) !== payload.proposalFileHash
        || (snapshot.lastTransition?.operationId || '') !== payload.approvalOperationId
        || snapshot.targetPath !== payload.targetPath
        || snapshot.taskId !== payload.proposalTaskId
        || hashText(snapshot.writebackContent) !== payload.writebackContentHash
        || hashText(writeback.block) !== payload.writebackBlockHash
        || writeback.marker !== payload.writebackMarker
        || currentTaskPath !== payload.taskPath
        || (currentTask?.contentHash || '') !== payload.taskContentHash
        || !target) {
        throw new core_1.OperationConflictError('Writeback confirmation is stale because current proposal or task state changed.');
    }
    validateApprovedWritebackTransition(snapshot, operationId, payload.targetPath, Boolean(target), context, new Date(writebackConfirmationNow(context)).toISOString());
    const touchedNotes = [
        payload.targetPath,
        payload.proposalPath,
        ...(payload.taskPath ? [payload.taskPath] : []),
        payload.auditPath,
    ];
    if ((0, core_1.computePayloadHash)(touchedNotes) !== (0, core_1.computePayloadHash)(payload.touchedNotes)) {
        throw new core_1.OperationConflictError('Writeback confirmation touched-note plan changed.');
    }
    if (reversibleWritebackTargetPrefix(target.content, payload) !== null) {
        return {
            target,
            writebackBlock: writeback.block,
            alreadyApplied: true,
        };
    }
    if (target.contentHash !== payload.targetContentHash) {
        throw new core_1.OperationConflictError('Writeback confirmation is stale because the target note changed.');
    }
    if (target.content.includes(payload.writebackMarker)
        || target.content.includes(writeback.block)) {
        throw new core_1.OperationConflictError(`Writeback marker already exists with different content: ${payload.writebackMarker}`);
    }
    return {
        target,
        writebackBlock: writeback.block,
        alreadyApplied: false,
    };
}
async function rollbackRuntimeWritebackTarget(vaultRoot, payload, context) {
    const target = await readCurrentVaultTextState(vaultRoot, payload.targetPath, context);
    if (!target || target.contentHash === payload.targetContentHash) {
        return;
    }
    const original = reversibleWritebackTargetPrefix(target.content, payload);
    if (original === null) {
        throw new core_1.OperationConflictError('Writeback target changed after its durable effect and cannot be safely compensated.');
    }
    if (context.vaultRepository) {
        if (!target.version) {
            throw new core_1.OperationConflictError('Writeback target version is unavailable.');
        }
        await context.vaultRepository.replaceText(payload.targetPath, target.version, original);
        return;
    }
    const targetAbsolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, payload.targetPath, pathSafetyOptions(context));
    replaceTextFileAtomically(targetAbsolute, original, target.content);
}
async function commitRuntimeProposalApplyTransition(vaultRoot, payload, operationId, context) {
    const transition = {
        expectedRevision: payload.proposalRevision,
        expectedContentHash: payload.proposalContentHash,
        operationId,
        action: { kind: 'apply' },
    };
    if (context.proposalTransitionPort) {
        const decision = await context.proposalTransitionPort.transition({
            ...transition,
            proposalPath: payload.proposalPath,
            expectedFileHash: payload.proposalFileHash,
            now: new Date().toISOString(),
            actor: context.agentId || 'tracekeeper-runtime',
        });
        return decision.receipt;
    }
    const proposalState = await readCurrentVaultTextState(vaultRoot, payload.proposalPath, context);
    if (!proposalState) {
        throw new core_1.ProposalTransitionConflictError('Writeback proposal does not exist.');
    }
    const proposal = memoryProposalDocumentFromText(vaultRoot, payload.proposalPath, proposalState.content, context);
    const target = await readCurrentVaultTextState(vaultRoot, payload.targetPath, context);
    const decision = (0, core_1.transitionProposal)(proposalTransitionSnapshot(proposal), transition, {
        now: new Date().toISOString(),
        actor: context.agentId || 'tracekeeper-runtime',
        targetAllowed: core_1.isAllowedProposalTargetPath,
        targetExists: (relativePath) => relativePath === payload.targetPath && target !== null,
    });
    if (decision.replayed) {
        return decision.receipt;
    }
    if ((0, core_1.computePayloadHash)(proposalState.content) !== payload.proposalFileHash) {
        throw new core_1.ProposalTransitionConflictError('Proposal file changed before the writeback transition.');
    }
    const updated = updateFrontmatterFields(proposalState.content, decision.frontmatter);
    if (context.vaultRepository) {
        if (!proposalState.version) {
            throw new core_1.ProposalTransitionConflictError('Proposal repository version is unavailable.');
        }
        await context.vaultRepository.replaceText(payload.proposalPath, proposalState.version, updated);
    }
    else {
        replaceTextFileAtomically(proposal.absolutePath, updated, proposalState.content);
    }
    return decision.receipt;
}
function assertJournaledWritebackRequest(rawArgs, payload, context) {
    const explicitPath = coerceOptionalString(rawArgs.proposal_path)
        || coerceOptionalString(rawArgs.path);
    if (explicitPath) {
        const normalized = (0, safety_1.normalizeNotePath)(explicitPath, pathSafetyOptions(context));
        assertReviewQueuePath(normalized);
        if (normalized !== payload.proposalPath) {
            throw new core_1.OperationConflictError('Writeback request proposal changed from the journaled operation.');
        }
    }
    const proposalId = coerceOptionalString(rawArgs.proposal_id);
    if (proposalId && proposalId !== payload.proposalId) {
        throw new core_1.OperationConflictError('Writeback request proposal changed from the journaled operation.');
    }
    const taskId = coerceOptionalString(rawArgs.task_id);
    if (taskId && taskId !== payload.taskId) {
        throw new core_1.OperationConflictError('Writeback request task changed from the journaled operation.');
    }
}
async function handleApplyApprovedWriteback(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const dryRun = coerceBoolean(rawArgs.dry_run, 'dry_run', false);
    if (dryRun) {
        const proposal = await resolveMemoryProposalFromArgs(vaultRoot, rawArgs, context);
        const taskId = resolveWritebackTaskId(rawArgs, proposal);
        const plan = buildWritebackPlan(proposal);
        if (!plan.ready || !plan.targetNote || !plan.writebackContent) {
            throw new safety_1.ToolInputError(plan.reason || 'approved writeback is not ready to apply.');
        }
        assertNoSensitiveText([
            { label: 'proposal id', value: proposal.proposalId },
            { label: 'target note', value: plan.targetNote },
            { label: 'writeback content', value: plan.writebackContent },
        ]);
        const issuedAt = writebackConfirmationNow(context);
        const prepared = await prepareWritebackConfirmation(vaultRoot, proposal, plan, taskId, context, issuedAt, issuedAt + writebackConfirmationTtl(context));
        const confirmationToken = createWritebackConfirmationToken(prepared.binding, context);
        return {
            ok: true,
            read_only: true,
            dry_run: true,
            permission_level: 'review-gated apply',
            proposal_id: proposal.proposalId,
            proposal_path: proposal.path,
            target_note: prepared.binding.targetPath,
            touched_notes: prepared.binding.touchedNotes,
            writeback_preview: prepared.writebackBlock,
            confirmation_token: confirmationToken,
            confirmation_expires_at: new Date(prepared.binding.expiresAt).toISOString(),
        };
    }
    const operationDirectory = path.resolve(vaultRoot, core_1.TRACEKEEPER_OPERATIONS_DIR);
    (0, safety_1.relativeFromAbsolute)(vaultRoot, operationDirectory);
    (0, safety_1.assertNoSymlinkSegments)(vaultRoot, operationDirectory);
    const journal = new core_1.NodeFileOperationJournal({ directory: operationDirectory });
    const rawConfirmationToken = coerceOptionalString(rawArgs.confirmation_token);
    const recoveryOperationId = context.writebackRecoveryOperationId || '';
    let identity;
    let existing = null;
    let payload;
    let approvalStatus = 'journaled';
    if (recoveryOperationId) {
        existing = await journal.loadById(recoveryOperationId);
        if (!existing) {
            throw new core_1.OperationConflictError('Writeback recovery journal record is unavailable.');
        }
        identity = {
            operationId: existing.operation_id,
            idempotencyKey: existing.idempotency_key,
        };
    }
    else {
        if (!rawConfirmationToken) {
            throw new safety_1.ToolInputError('Writeback confirmation token is required after a dry-run preview.');
        }
        const decodedIdentity = decodeWritebackConfirmationToken(rawConfirmationToken);
        identity = {
            operationId: decodedIdentity.operationId,
            idempotencyKey: decodedIdentity.idempotencyKey,
        };
        const [byId, byKey] = await Promise.all([
            journal.loadById(identity.operationId),
            journal.loadByIdempotencyKey(identity.idempotencyKey),
        ]);
        if (byId
            && byKey
            && (byId.operation_id !== byKey.operation_id
                || byId.idempotency_key !== byKey.idempotency_key)) {
            throw new core_1.OperationConflictError('Writeback confirmation references conflicting journal records.');
        }
        existing = byId || byKey;
    }
    if (existing) {
        if (existing.operation_id !== identity.operationId
            || existing.idempotency_key !== identity.idempotencyKey
            || !isApplyApprovedWritebackPayload(existing.payload)) {
            throw new core_1.OperationConflictError('Writeback journal record does not match the requested operation.');
        }
        payload = existing.payload;
        assertJournaledWritebackRequest(rawArgs, payload, context);
        if (!recoveryOperationId) {
            if (!rawConfirmationToken) {
                throw new core_1.OperationConflictError('Writeback confirmation token changed from the journaled operation.');
            }
            const decoded = decodeWritebackConfirmationToken(rawConfirmationToken);
            const tokenPayload = writebackBindingPayload(decoded, rawConfirmationToken);
            if (hashText(rawConfirmationToken) !== payload.confirmationTokenHash
                || (0, core_1.computePayloadHash)(tokenPayload) !== (0, core_1.computePayloadHash)(payload)) {
                throw new core_1.OperationConflictError('Writeback confirmation token changed from the journaled operation.');
            }
        }
    }
    else {
        if (!rawConfirmationToken) {
            throw new safety_1.ToolInputError('Writeback confirmation token is required.');
        }
        const decoded = parseWritebackConfirmationToken(rawConfirmationToken, context);
        const now = writebackConfirmationNow(context);
        if (decoded.expiresAt <= now || decoded.expiresAt <= decoded.issuedAt) {
            throw new safety_1.ToolInputError('Writeback confirmation token has expired.');
        }
        const proposal = await resolveMemoryProposalFromArgs(vaultRoot, rawArgs, context);
        const taskId = resolveWritebackTaskId(rawArgs, proposal);
        const plan = buildWritebackPlan(proposal);
        if (!plan.ready || !plan.targetNote || !plan.writebackContent) {
            throw new safety_1.ToolInputError(plan.reason || 'approved writeback is not ready to apply.');
        }
        assertNoSensitiveText([
            { label: 'proposal id', value: proposal.proposalId },
            { label: 'target note', value: plan.targetNote },
            { label: 'writeback content', value: plan.writebackContent },
        ]);
        const current = await prepareWritebackConfirmation(vaultRoot, proposal, plan, taskId, context, decoded.issuedAt, decoded.expiresAt, decoded.previewNonce);
        assertMatchingWritebackBinding(decoded, current.binding);
        payload = writebackBindingPayload(decoded, rawConfirmationToken);
        approvalStatus = proposalTransitionSnapshot(proposal).status;
    }
    const service = new apply_approved_writeback_1.ApplyApprovedWritebackService({
        journal,
        failureInjection: context.operationFailureInjection,
        port: {
            async applyTarget(currentPayload) {
                const effect = await currentWritebackEffect(vaultRoot, currentPayload, identity.operationId, context);
                if (effect.alreadyApplied) {
                    return;
                }
                const targetWithWriteback = `${effect.target.content}${writebackTargetFrame(effect.writebackBlock)}`;
                if (context.vaultRepository) {
                    if (!effect.target.version) {
                        throw new core_1.OperationConflictError('Writeback target version is unavailable.');
                    }
                    await context.vaultRepository.replaceText(currentPayload.targetPath, effect.target.version, targetWithWriteback);
                    return;
                }
                const targetAbsolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, currentPayload.targetPath, pathSafetyOptions(context));
                replaceTextFileAtomically(targetAbsolute, targetWithWriteback, effect.target.content);
            },
            async rollbackTarget(currentPayload) {
                await rollbackRuntimeWritebackTarget(vaultRoot, currentPayload, context);
            },
            async markProposalApplied(currentPayload, operationId) {
                return commitRuntimeProposalApplyTransition(vaultRoot, currentPayload, operationId, context);
            },
            async linkTask(currentPayload) {
                return linkApprovedWritebackTask(vaultRoot, currentPayload, context);
            },
            async rollbackTask(currentPayload, _operationId, receipt) {
                await rollbackApprovedWritebackTask(vaultRoot, currentPayload, receipt, context);
            },
            async appendAudit(currentPayload, operationId, receipt) {
                await appendAuditEventAsync(vaultRoot, {
                    operationId,
                    tool: 'tracekeeper.apply_approved_writeback',
                    targetPath: currentPayload.targetPath,
                    status: 'written',
                    taskId: currentPayload.taskId,
                    timestamp: receipt.committedAt,
                    agentId: currentPayload.auditAgentId,
                    sessionId: currentPayload.auditSessionId || undefined,
                    clientName: currentPayload.auditClientName || undefined,
                    metadata: {
                        action: 'writeback.apply',
                        proposal_id: currentPayload.proposalId,
                        proposal_path: currentPayload.proposalPath,
                        permission_level: 'review-gated apply',
                        transition_kind: receipt.kind,
                        previous_status: receipt.previousStatus,
                        next_status: receipt.nextStatus,
                        previous_revision: receipt.previousRevision,
                        committed_revision: receipt.committedRevision,
                        previous_content_hash: receipt.previousContentHash,
                        committed_content_hash: receipt.committedContentHash,
                    },
                }, context);
            },
        },
    });
    return service.execute({
        operationId: identity.operationId,
        idempotencyKey: identity.idempotencyKey,
        approvalStatus,
        payload,
    });
}
async function handleAuditRecent(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const maxItems = coercePositiveInt(rawArgs.max_items, MAX_AUDIT_ITEMS, 1, 100);
    const sections = await readMergedAuditSections(vaultRoot, context);
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        audit_log: sections[0]?.source_path || AUDIT_LOG_PATH,
        total_sections: sections.length,
        sections: sections.slice(0, maxItems),
    };
}
async function handleWriteContextPack(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const content = coerceNonEmptyString(rawArgs.content, true, 'content');
    const title = coerceNonEmptyString(rawArgs.title);
    const filename = buildSafeFilename(rawArgs.filename, 'context_pack', context);
    const taskId = coerceOptionalString(rawArgs.task_id) || null;
    const now = new Date().toISOString();
    assertNoSensitiveText([
        { label: 'content', value: content },
        { label: 'title', value: title },
    ]);
    const note = await buildAndWriteNoteAsync(vaultRoot, 'tracekeeper.write_context_pack', CONTEXT_PACK_DIR, filename, {
        tool: 'tracekeeper.write_context_pack',
        type: 'context_pack',
        title: title || `context_pack_${now}`,
        created_at: now,
        task_id: taskId || null,
    }, content, taskId, context, { target_type: 'context_pack', tool: 'tracekeeper.write_context_pack' });
    await updateAgentTaskRecordAsync(vaultRoot, taskId, {
        context_pack: note.path,
    }, context, {
        context_packs: [note.path],
    });
    return makeToolResultForWrite('tracekeeper.write_context_pack', note);
}
async function handleWriteSessionNote(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const content = coerceNonEmptyString(rawArgs.content, true, 'content');
    const filename = buildSafeFilename(rawArgs.filename, 'session', context);
    const taskId = coerceOptionalString(rawArgs.task_id) || null;
    const now = new Date().toISOString();
    assertNoSensitiveText([
        { label: 'content', value: content },
    ]);
    const note = await buildAndWriteNoteAsync(vaultRoot, 'tracekeeper.write_session_note', SESSION_NOTE_DIR, filename, {
        tool: 'tracekeeper.write_session_note',
        type: 'session_note',
        created_at: now,
        task_id: taskId || null,
    }, content, taskId, context, { target_type: 'session_note', tool: 'tracekeeper.write_session_note' });
    await updateAgentTaskRecordAsync(vaultRoot, taskId, {}, context, {
        memory_writes: [note.path],
    });
    return makeToolResultForWrite('tracekeeper.write_session_note', note);
}
async function handleCaptureSource(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const requestHash = (0, core_1.computePayloadHash)({ ...rawArgs });
    const identity = buildToolOperationIdentity('capture-source', rawArgs.idempotency_key, { requestHash }, context);
    const runner = new core_1.RecoverableOperationRunner({
        operationId: identity.operationId,
        idempotencyKey: identity.idempotencyKey,
        payload: { request_hash: requestHash },
        journal: operationJournalForVault(vaultRoot),
        failureInjection: context.operationFailureInjection,
        steps: [],
        finalize: () => handleCaptureSourceWrite(rawArgs, context, identity),
    });
    return runner.run();
}
async function handleCaptureSourceWrite(rawArgs, context, identity) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const source = coerceNonEmptyString(rawArgs.source, true, 'source');
    const sourceKind = coerceOptionalString(rawArgs.source_kind);
    const mode = coerceCaptureMode(rawArgs.mode);
    const captureReason = coerceOptionalString(rawArgs.capture_reason);
    const relatedProject = coerceOptionalString(rawArgs.related_project);
    const filename = coerceOptionalString(rawArgs.filename)
        ? buildSafeFilename(rawArgs.filename, 'source', context)
        : buildSafeFilename(`source-${identity.operationId}`, 'source', context);
    const title = coerceOptionalString(rawArgs.title);
    const taskId = coerceOptionalString(rawArgs.task_id) || null;
    const now = new Date().toISOString();
    const warnings = [];
    const sourceText = coerceOptionalString(rawArgs.content) || coerceOptionalString(rawArgs.text);
    if (mode !== 'external_reference' && !sourceText) {
        throw new safety_1.ToolInputError(`content/text is required when mode is "${mode}".`);
    }
    if (mode === 'external_reference' && sourceText) {
        warnings.push('content/text is ignored for external_reference mode.');
    }
    assertNoSensitiveText([
        { label: 'source', value: source },
        { label: 'capture_reason', value: captureReason },
        { label: 'content', value: sourceText },
        { label: 'title', value: title },
    ]);
    let body = `${contentText(context, '## 来源捕获', '## Source capture')}\n\n`;
    if (mode === 'external_reference') {
        body += `- mode: external_reference\n- source: ${source}\n`;
        if (sourceKind) {
            body += `- source_kind: ${sourceKind}\n`;
        }
        if (captureReason) {
            body += `- capture_reason: ${captureReason}\n`;
        }
    }
    else {
        body += `- mode: ${mode}\n- source: ${source}\n`;
        if (sourceKind) {
            body += `- source_kind: ${sourceKind}\n`;
        }
        body += `\n${sourceText}\n`;
    }
    const existing = await findOperationOwnedNoteAsync(vaultRoot, SOURCES_DIR, filename, 'source_operation_id', identity.operationId, context);
    const note = existing || await buildAndWriteNoteAsync(vaultRoot, 'tracekeeper.capture_source', SOURCES_DIR, filename, {
        tool: 'tracekeeper.capture_source',
        type: 'source_capture',
        title: title || `source_${mode}`,
        source,
        source_kind: sourceKind || null,
        mode,
        capture_reason: captureReason || null,
        related_project: relatedProject || null,
        created_at: now,
        task_id: taskId || null,
        source_operation_id: identity.operationId,
    }, body, taskId, context, { target_type: 'source_capture', mode }, identity.operationId);
    await updateAgentTaskRecordAsync(vaultRoot, taskId, {}, context, {
        source_captures: [note.path],
    });
    return {
        ok: true,
        tool: 'tracekeeper.capture_source',
        operation_id: identity.operationId,
        idempotency_key: identity.idempotencyKey,
        status: note.status,
        path: note.path,
        audit_path: note.audit_path,
        warnings,
        metadata: {
            source,
            mode,
        },
    };
}
async function handleProposeMemory(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const requestSnapshot = buildProposeMemoryRequestSnapshot(rawArgs);
    const requestHash = (0, core_1.computePayloadHash)(requestSnapshot);
    const identity = buildToolOperationIdentity('propose-memory', rawArgs.idempotency_key, requestSnapshot, context);
    const journal = operationJournalForVault(vaultRoot);
    const existing = await journal.loadByIdempotencyKey(identity.idempotencyKey);
    let operationPayload;
    if (existing) {
        if (existing.operation_id !== identity.operationId) {
            throw new core_1.OperationConflictError(`Idempotency key conflict for "${identity.idempotencyKey}": associated with existing operation "${existing.operation_id}"`);
        }
        if (!isProposeMemoryOperationPayload(existing.payload)) {
            throw new core_1.OperationConflictError(`Idempotency key conflict for "${identity.idempotencyKey}" with an incompatible legacy propose_memory operation`);
        }
        if (existing.payload.requestHash !== requestHash) {
            throw new core_1.OperationConflictError(`Idempotency key conflict for "${identity.idempotencyKey}" with different propose_memory request hash`);
        }
        operationPayload = existing.payload;
    }
    else {
        const observed = context.observedClientType
            ?? (0, observed_client_1.normalizeObservedClientType)(context.clientName);
        operationPayload = {
            requestHash,
            requestSnapshot,
            projectMemoryCreatedAt: new Date().toISOString(),
            projectMemoryAgentType: observed === 'unknown' ? 'custom' : observed,
        };
    }
    const runner = new core_1.RecoverableOperationRunner({
        operationId: identity.operationId,
        idempotencyKey: identity.idempotencyKey,
        payload: operationPayload,
        journal,
        failureInjection: context.operationFailureInjection,
        steps: [],
        finalize: () => handleProposeMemoryWrite(operationPayload.requestSnapshot, context, identity, operationPayload.projectMemoryCreatedAt, operationPayload.projectMemoryAgentType),
    });
    return runner.run();
}
async function handleProposeMemoryWrite(rawArgs, context, identity, operationCreatedAt, projectMemoryAgentType) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const proposalKind = coerceNonEmptyString(rawArgs.proposal_kind, true, 'proposal_kind');
    const content = coerceNonEmptyString(rawArgs.content, true, 'content');
    const evidence = coerceOptionalString(rawArgs.evidence);
    const targetNote = coerceOptionalString(rawArgs.target_note);
    const riskLevel = coerceOptionalString(rawArgs.risk_level);
    const title = coerceOptionalString(rawArgs.title);
    const filename = coerceOptionalString(rawArgs.filename)
        ? buildSafeFilename(rawArgs.filename, 'proposal', context)
        : buildSafeFilename(`proposal-${identity.operationId}`, 'proposal', context);
    const taskId = coerceOptionalString(rawArgs.task_id) || null;
    const projectHint = coerceOptionalString(rawArgs.project_hint);
    const proposalId = proposalIdFromOperation(identity.operationId, proposalKind);
    const memoryScope = resolveMemoryScope(proposalKind, targetNote, projectHint, rawArgs.memory_scope);
    const relatedWiki = normalizeMultiValueList(rawArgs.related_wiki, 'related_wiki');
    const relatedSources = normalizeMultiValueList(rawArgs.related_sources, 'related_sources');
    const architectureStatus = buildArchitectureStatus(vaultRoot, context);
    const bridgeMetadata = resolveProjectMemoryBridgeMetadata(vaultRoot, memoryScope, projectHint, relatedWiki, relatedSources, context);
    const resolvedProjectIdentity = memoryScope === 'project'
        ? (0, project_identity_1.resolveProjectIdentity)(rawArgs, scanVaultForContext(vaultRoot, context).notes)
        : null;
    const now = new Date().toISOString();
    assertMemoryProposalAllowed(proposalKind, targetNote, projectHint, context, memoryScope);
    assertNoSensitiveText([
        { label: 'content', value: content },
        { label: 'evidence', value: evidence },
        { label: 'target_note', value: targetNote },
        { label: 'title', value: title },
        { label: 'project_hint', value: projectHint },
        { label: 'related_wiki', value: relatedWiki.join('\n') },
        { label: 'related_sources', value: relatedSources.join('\n') },
    ]);
    const memoryRule = memoryProposalRuleFor(proposalKind, targetNote, projectHint, context, memoryScope);
    let immutableReviewRequired = false;
    if (memoryRule === 'auto_write') {
        const canAutoWrite = !(memoryScope === 'project' && bridgeMetadata.missing_wiki_bridge);
        if (canAutoWrite && memoryScope === 'project') {
            const useResolvedIdentity = resolvedProjectIdentity
                && resolvedProjectIdentity.confidence !== 'uncertain';
            const immutable = await writeImmutableProjectMemory(vaultRoot, {
                toolName: 'tracekeeper.propose_memory',
                projectId: useResolvedIdentity
                    ? resolvedProjectIdentity.projectId
                    : rawArgs.project_id,
                projectHint: useResolvedIdentity
                    ? resolvedProjectIdentity.projectHint
                    : rawArgs.project_hint,
                repoPath: useResolvedIdentity
                    ? resolvedProjectIdentity.repoPath
                    : rawArgs.repo_path ?? rawArgs.repo ?? rawArgs.project_path,
                agentType: projectMemoryAgentType,
                taskId,
                operationId: identity.operationId,
                operationKind: 'propose_memory',
                memoryKinds: [proposalKind],
                body: content,
                relatedWiki: bridgeMetadata.related_wiki,
                relatedSources: bridgeMetadata.related_sources,
                createdAt: operationCreatedAt,
                context,
            });
            if (immutable.status !== 'review_required') {
                await updateAgentTaskRecordAsync(vaultRoot, taskId, {}, context, {
                    memory_writes: [immutable.path],
                });
                return {
                    ok: true,
                    tool: 'tracekeeper.propose_memory',
                    operation_id: identity.operationId,
                    idempotency_key: identity.idempotencyKey,
                    status: immutable.write_status,
                    path: immutable.path,
                    target_note: immutable.path,
                    audit_path: immutable.audit_path,
                    warnings: [],
                    auto_applied: true,
                    duplicate: immutable.duplicate,
                    memory_rule: 'auto_write',
                    memory_scope: memoryScope,
                    project_id: immutable.project_id,
                    project_hub: immutable.project_hub,
                    project_hint: projectHint || null,
                    agent_type: immutable.agent_type,
                    operation_hash: immutable.operation_hash,
                    related_wiki: bridgeMetadata.related_wiki,
                    related_sources: bridgeMetadata.related_sources,
                    missing_related_sources: bridgeMetadata.missing_related_sources,
                    architecture_status: architectureStatus.architecture_status,
                    missing_graph_bridges: architectureStatus.missing_graph_bridges,
                    missing_wiki_bridge: false,
                    proposal_id: null,
                    proposal_path: null,
                };
            }
            immutableReviewRequired = true;
        }
        const autoTarget = canAutoWrite
            && memoryScope === 'global'
            ? resolveAutoMemoryTarget(vaultRoot, proposalKind, targetNote, projectHint, context, memoryScope)
            : null;
        if (autoTarget) {
            const note = await appendAutoMemoryWriteAsync(vaultRoot, {
                toolName: 'tracekeeper.propose_memory',
                proposalKind,
                targetNote: autoTarget.targetNote,
                allowedDir: autoTarget.allowedDir,
                title: title || contentText(context, `记忆更新：${proposalKind}`, `Memory update: ${proposalKind}`),
                content,
                operationId: identity.operationId,
                taskId,
                context,
                projectHint,
                evidence,
                riskLevel,
                memoryScope,
                relatedWiki: bridgeMetadata.related_wiki,
                relatedSources: bridgeMetadata.related_sources,
                architectureStatus,
                missingGraphBridges: architectureStatus.missing_graph_bridges,
                missingWikiBridge: false,
                missingRelatedSources: bridgeMetadata.missing_related_sources,
            });
            await updateAgentTaskRecordAsync(vaultRoot, taskId, {}, context, {
                memory_writes: [note.path],
            });
            return {
                ok: true,
                tool: 'tracekeeper.propose_memory',
                operation_id: identity.operationId,
                idempotency_key: identity.idempotencyKey,
                status: note.status,
                path: note.path,
                target_note: note.path,
                audit_path: note.audit_path,
                warnings: note.warnings,
                auto_applied: true,
                duplicate: note.duplicate,
                memory_rule: 'auto_write',
                memory_scope: memoryScope,
                project_hint: projectHint || null,
                related_wiki: bridgeMetadata.related_wiki,
                related_sources: bridgeMetadata.related_sources,
                missing_related_sources: bridgeMetadata.missing_related_sources,
                architecture_status: architectureStatus.architecture_status,
                missing_graph_bridges: architectureStatus.missing_graph_bridges,
                missing_wiki_bridge: false,
                proposal_id: null,
                proposal_path: null,
            };
        }
    }
    const proposalTargetNote = immutableReviewRequired && memoryScope === 'project'
        ? ''
        : targetNote;
    const body = [
        contentText(context, '## 记忆提案', '## Proposal'),
        `- status: pending`,
        `- proposal_kind: ${proposalKind}`,
        evidence ? `- evidence: ${evidence}` : '',
        proposalTargetNote ? `- target_note: ${proposalTargetNote}` : '',
        `- memory_scope: ${memoryScope}`,
        projectHint ? `- project_hint: ${projectHint}` : '',
        bridgeMetadata.related_wiki.length ? `- related_wiki: ${JSON.stringify(bridgeMetadata.related_wiki)}` : '',
        bridgeMetadata.related_sources.length ? `- related_sources: ${JSON.stringify(bridgeMetadata.related_sources)}` : '',
        riskLevel ? `- risk_level: ${riskLevel}` : '',
        `- architecture_status: ${architectureStatus.architecture_status}`,
        `- missing_graph_bridges: ${JSON.stringify(architectureStatus.missing_graph_bridges)}`,
        bridgeMetadata.missing_wiki_bridge ? '- missing_wiki_bridge: true' : '',
        bridgeMetadata.missing_related_wiki.length ? `- missing_related_wiki: ${JSON.stringify(bridgeMetadata.missing_related_wiki)}` : '',
        bridgeMetadata.missing_related_sources.length ? `- missing_related_sources: ${JSON.stringify(bridgeMetadata.missing_related_sources)}` : '',
        '',
        contentText(context, '## 写回内容', '## Writeback'),
        content,
    ].filter(Boolean).join('\n');
    const existing = await findOperationOwnedNoteAsync(vaultRoot, MEMORY_PROPOSAL_DIR, filename, 'proposal_operation_id', identity.operationId, context);
    const note = existing || await buildAndWriteNoteAsync(vaultRoot, 'tracekeeper.propose_memory', MEMORY_PROPOSAL_DIR, filename, {
        tool: 'tracekeeper.propose_memory',
        type: 'memory_proposal',
        proposal_id: proposalId,
        title: title || contentText(context, `记忆提案：${proposalKind}`, `Memory proposal: ${proposalKind}`),
        proposal_kind: proposalKind,
        status: 'pending',
        target_note: proposalTargetNote || null,
        risk_level: riskLevel || null,
        project_hint: projectHint || null,
        memory_scope: memoryScope,
        related_wiki: bridgeMetadata.related_wiki,
        related_sources: bridgeMetadata.related_sources,
        architecture_status: architectureStatus.architecture_status,
        missing_graph_bridges: architectureStatus.missing_graph_bridges,
        missing_wiki_bridge: bridgeMetadata.missing_wiki_bridge,
        missing_related_wiki: bridgeMetadata.missing_related_wiki,
        missing_related_sources: bridgeMetadata.missing_related_sources,
        created_at: now,
        task_id: taskId || null,
        proposal_operation_id: identity.operationId,
    }, body, taskId, context, {
        action: 'memory.proposal.created',
        target_type: 'memory_proposal',
        proposal_kind: proposalKind,
        risk_level: riskLevel || null,
    }, identity.operationId);
    if (existing) {
        await ensureOperationOwnedProposalIdentity(vaultRoot, note.path, proposalId, 'proposal_operation_id', identity.operationId, context);
    }
    const proposalReference = {
        proposalId,
        path: note.path,
        linkTarget: note.path,
    };
    if (taskId) {
        await updateManagedProposalReferences(vaultRoot, buildTaskNotePath(taskId), [proposalReference], context);
    }
    const response = {
        ok: true,
        tool: 'tracekeeper.propose_memory',
        operation_id: identity.operationId,
        idempotency_key: identity.idempotencyKey,
        status: note.status,
        path: note.path,
        audit_path: note.audit_path,
        warnings: note.warnings,
        auto_applied: false,
        duplicate: false,
        proposal_id: proposalId,
        proposal_path: note.path,
        proposal_link_target: note.path,
        memory_rule: memoryRule,
        memory_scope: memoryScope,
        project_hint: projectHint || null,
        related_wiki: bridgeMetadata.related_wiki,
        related_sources: bridgeMetadata.related_sources,
        missing_related_sources: bridgeMetadata.missing_related_sources,
        architecture_status: architectureStatus.architecture_status,
        missing_graph_bridges: architectureStatus.missing_graph_bridges,
        missing_wiki_bridge: bridgeMetadata.missing_wiki_bridge,
    };
    if (memoryScope === 'project' && bridgeMetadata.missing_wiki_bridge && memoryRule === 'auto_write') {
        response.memory_rule = 'review_queue';
    }
    return response;
}
async function handleBuildContextPack(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const query = coerceNonEmptyString(rawArgs.query, true, 'query');
    const taskId = coerceOptionalString(rawArgs.task_id);
    const candidateLimit = coercePositiveInt(rawArgs.candidate_limit, 8, 1, 120);
    const staleAfterDays = coercePositiveInt(rawArgs.stale_after_days, 180, 1, 3650);
    const shouldWrite = coerceBoolean(rawArgs.write, 'write', false);
    const title = coerceOptionalString(rawArgs.title);
    const baseScan = scanVaultForContext(vaultRoot, context);
    const explicitScope = coerceProjectScope(rawArgs, baseScan.notes);
    let scopeForContextPack = explicitScope;
    if (taskId) {
        const taskMetadata = await readAgentTaskMetadataAsync(vaultRoot, taskId, context);
        scopeForContextPack = mergeTaskProjectIdentity(taskId, taskMetadata, explicitScope);
    }
    const scopedNotes = hasProjectScope(scopeForContextPack) && scopeForContextPack.confidence !== 'uncertain'
        ? filterNotesByProjectScopeWithSessions(baseScan.notes, scopeForContextPack)
        : baseScan.notes;
    const scan = {
        ...baseScan,
        notes: scopedNotes,
    };
    const contextPack = buildContextPackForContext(vaultRoot, query, context, {
        limit: candidateLimit,
        staleAfterDays,
    }, scan);
    if (!shouldWrite) {
        return {
            ok: true,
            read_only: true,
            vault_root: vaultRoot,
            task_id: taskId || null,
            project_hint: scopeForContextPack.projectHint || null,
            project_id: scopeForContextPack.projectId || null,
            repo_path: scopeForContextPack.repoPath || null,
            project_identity: (0, project_identity_1.projectIdentityToResult)(scopeForContextPack),
            query,
            ...scanProvenance(scan),
            context_pack: contextPack,
        };
    }
    const now = new Date().toISOString();
    const filename = buildSafeFilename(rawArgs.filename, 'context_pack', context);
    const contextMarkdown = [
        contentText(context, '# 上下文包', '# Context Pack'),
        `- query: ${contextPack.query}`,
        `- task_id: ${taskId || 'unset'}`,
        `- generated_at: ${contextPack.generatedAt}`,
        `- candidate_limit: ${candidateLimit}`,
        `- stale_after_days: ${staleAfterDays}`,
        '',
        contentText(context, '## 相关笔记', '## Relevant Notes'),
        ...contextPack.relevantNotes.map((entry) => `- ${entry.relativePath} | score: ${entry.score} | title: ${entry.title}`),
        '',
        contentText(context, '## 来源候选', '## Source Candidates'),
        ...contextPack.sourceCandidates.map((entry) => `- ${entry.note} (${entry.reason})`),
        '',
        contentText(context, '## 证据候选', '## Evidence Candidates'),
        ...contextPack.evidenceCandidates.map((entry) => {
            const marker = entry.blockId ? `#${entry.blockId}` : '';
            return `- ${entry.note} ${marker}`.trim();
        }),
        '',
        contentText(context, '## 缺口', '## Gaps'),
        ...contextPack.gaps.map((entry) => `- ${entry}`),
        '',
        contentText(context, '## 过期提醒', '## Stale Warnings'),
        ...contextPack.staleWarnings.map((entry) => `- ${entry}`),
        '',
        contentText(context, '## 扫描错误', '## Scan Errors'),
        ...contextPack.scanErrors.map((entry) => `- ${entry.path}: ${entry.error}`),
    ].join('\n');
    assertNoSensitiveText([
        { label: 'query', value: query },
        { label: 'title', value: title },
        { label: 'context pack', value: contextMarkdown },
    ]);
    const note = await buildAndWriteNoteAsync(vaultRoot, 'tracekeeper.build_context_pack', CONTEXT_PACK_DIR, filename, {
        tool: 'tracekeeper.build_context_pack',
        type: 'context_pack',
        title: title || `context_pack_${now}`,
        query,
        task_id: taskId || null,
        candidate_limit: candidateLimit,
        stale_after_days: staleAfterDays,
        created_at: now,
    }, contextMarkdown, taskId || null, context, {
        target_type: 'context_pack',
        output_format: 'markdown',
    });
    await updateAgentTaskRecordAsync(vaultRoot, taskId || null, {
        context_pack: note.path,
    }, context, {
        context_packs: [note.path],
    });
    return {
        ok: true,
        read_only: false,
        vault_root: vaultRoot,
        task_id: taskId || null,
        project_hint: scopeForContextPack.projectHint || null,
        project_id: scopeForContextPack.projectId || null,
        repo_path: scopeForContextPack.repoPath || null,
        project_identity: (0, project_identity_1.projectIdentityToResult)(scopeForContextPack),
        query,
        ...scanProvenance(scan),
        context_pack: contextPack,
        artifact: {
            path: note.path,
            audit_path: note.audit_path,
        },
    };
}
function handleLint(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const maxItems = coercePositiveInt(rawArgs.max_items, 40, 1, 2000);
    const profile = graphProfileFromArgs(rawArgs.graph_profile, context);
    const scan = scanVaultForContext(vaultRoot, context);
    const graphHealth = profile === 'off' ? undefined : (0, core_1.analyzeGraphHealth)(scan.notes, { maxItems });
    const profileEvaluation = graphHealth
        ? (0, core_1.evaluateGraphProfile)(graphHealth, profile)
        : { profile, disabled: true, profile_issues: [] };
    const lintGraphHealth = graphHealth
        ? {
            disabled: profileEvaluation.disabled,
            profile: profileEvaluation.profile,
            profile_issues: profileEvaluation.profile_issues,
            ...graphHealth,
        }
        : null;
    const { issues } = (0, core_1.lintNotes)(vaultRoot, scan.notes, {
        graphHealth,
        graphProfile: profile,
    });
    const limitedIssues = issues.slice(0, maxItems);
    return {
        ok: true,
        read_only: true,
        profile: profileEvaluation.profile,
        graph_profile_disabled: profileEvaluation.disabled,
        profile_issues: profileEvaluation.profile_issues,
        vault_root: vaultRoot,
        scanned_at: scan.scannedAt,
        ...scanProvenance(scan),
        issue_count: issues.length,
        issues: limitedIssues,
        graph_summary: graphHealth ? buildGraphSummary(graphHealth) : null,
        graph_health: lintGraphHealth,
        legacy_structure: buildLegacyStructureSummary(vaultRoot, scan.notes),
        fix_plan_summary: buildFixPlanSummary(issues),
    };
}
function buildLegacyStructureSummary(vaultRoot, notes) {
    const legacyRoots = core_1.LEGACY_TOP_LEVEL_DIRS.filter((root) => fs.existsSync(path.join(vaultRoot, root)));
    const legacyNoteCount = notes.filter((note) => legacyRoots.some((root) => note.relativePath === root || note.relativePath.startsWith(`${root}/`))).length;
    return {
        detected: legacyRoots.length > 0,
        legacy_roots: legacyRoots,
        legacy_note_count: legacyNoteCount,
        recommendation: legacyRoots.length > 0
            ? 'Use the Obsidian plugin structure check to preview, rebuild, validate, and trash legacy folders after explicit user confirmation. MCP lint is read-only and will not migrate or delete folders.'
            : 'No legacy Tracekeeper top-level folders detected.',
    };
}
function buildGraphSummary(graphHealth) {
    return {
        note_count: graphHealth.note_count,
        wikilink_edge_count: graphHealth.wikilink_edge_count,
        resolved_edge_count: graphHealth.resolved_edge_count,
        unresolved_edge_count: graphHealth.unresolved_edge_count,
        component_count: graphHealth.component_count,
        largest_component_node_count: graphHealth.largest_component_node_count,
        isolated_node_count: graphHealth.isolated_node_count,
        only_inbound_node_count: graphHealth.only_inbound_node_count,
        only_outbound_node_count: graphHealth.only_outbound_node_count,
        hub_candidate_count: graphHealth.hub_candidate_count,
        missing_recommended_entry: graphHealth.missing_recommended_entry,
        missing_recommended_hub_count: graphHealth.missing_recommended_hub_count,
        recommendation_count: graphHealth.recommendation_count,
        entry_issues: graphHealth.missing_recommended_entry ? [graphHealth.missing_recommended_entry] : [],
        hub_issues: graphHealth.missing_recommended_hubs,
        isolated_notes: graphHealth.isolated_nodes,
        unresolved_links: graphHealth.unresolved_edges,
        recommendations: graphHealth.recommendations,
    };
}
function buildSessionNoteBody(context, summary, outcomes, nextActions) {
    const lines = [
        contentText(context, '# 任务会话记录', '# Task Session Note'),
        `- created_at: ${new Date().toISOString()}`,
        '',
        contentText(context, '## 摘要', '## Summary'),
        summary,
        '',
        contentText(context, '## 结果', '## Outcomes'),
        ...formatListMarkdown(outcomes).split('\n'),
        '',
        contentText(context, '## 下一步', '## Next Actions'),
        ...formatListMarkdown(nextActions).split('\n'),
    ].join('\n');
    return lines.trim();
}
function buildSessionNoteBodyWithCloseout(context, summary, outcomes, nextActions, decisions, solutionChanges, lessons, preferences, memoryCandidates) {
    const lines = [
        contentText(context, '# 任务会话记录', '# Task Session Note'),
        `- created_at: ${new Date().toISOString()}`,
        '',
        contentText(context, '## 摘要', '## Summary'),
        summary,
        '',
        contentText(context, '## 结果', '## Outcomes'),
        ...formatListMarkdown(outcomes).split('\n'),
        '',
        contentText(context, '## 下一步', '## Next Actions'),
        ...formatListMarkdown(nextActions).split('\n'),
        '',
        contentText(context, '## 决策', '## Decisions'),
        ...formatListMarkdown(decisions).split('\n'),
        '',
        contentText(context, '## 方案调整', '## Solution Changes'),
        ...formatListMarkdown(solutionChanges).split('\n'),
        '',
        contentText(context, '## 经验教训', '## Lessons'),
        ...formatListMarkdown(lessons).split('\n'),
        '',
        contentText(context, '## 偏好', '## Preferences'),
        ...formatListMarkdown(preferences).split('\n'),
        '',
        contentText(context, '## 记忆候选', '## Memory Candidates'),
        ...formatListMarkdown(memoryCandidates).split('\n'),
    ].join('\n');
    return lines.trim();
}
function buildFinishTaskNextActions(context, reviewProposalMode, proposalResult, projectHint, hasCloseoutCandidates) {
    const actions = [];
    if (!hasCloseoutCandidates) {
        actions.push(contentText(context, '任务会话已记录；没有提交可长期沉淀的收尾记忆候选。如果之后发现遗漏的长期信息，请将其作为新的 tracekeeper.propose_memory 候选提交，不要再次调用 tracekeeper.finish_task。', 'Task session was recorded with no durable closeout memory candidates. If omitted durable information is discovered later, submit it as a new tracekeeper.propose_memory candidate; do not call tracekeeper.finish_task again.'));
    }
    if (reviewProposalMode === 'off') {
        actions.push(contentText(context, '任务会话已记录；当前模式不会创建记忆建议或知识变更审核提案。', 'Task session was recorded; no memory suggestions or Knowledge Change Review proposals were created.'));
    }
    if (reviewProposalMode === 'suggest') {
        actions.push(contentText(context, '请查看本次响应中的 suggested_memory_updates；没有写入知识变更审核。', 'Review suggested_memory_updates in this response; nothing was written to Knowledge Change Review.'));
    }
    if (reviewProposalMode === 'review_queue' || reviewProposalMode === 'auto_propose') {
        if (proposalResult.proposals.length > 0) {
            actions.push(contentText(context, '请在 Obsidian 的知识变更审核中确认提案后再写入长期记忆。', 'Review proposed changes in Obsidian Knowledge Change Review before durable memory writeback.'));
        }
        if (proposalResult.autoAppliedMemoryUpdates.length > 0) {
            actions.push(contentText(context, '项目记忆已按用户规则保存为独立的不可变操作条目。', 'Project memory was saved as a separate immutable operation entry according to the user rule.'));
        }
        if (proposalResult.hasMissingWikiBridge) {
            actions.push(contentText(context, '部分项目记忆候选缺少 related_wiki 桥接关系，因此需要先审核。', 'Some project memory candidates need a related_wiki bridge before automatic project memory save.'));
        }
        if (actions.length === 0) {
            actions.push(contentText(context, '任务会话已记录；没有产生收尾记忆候选。', 'Task session was recorded; no closeout memory candidates were produced.'));
        }
    }
    if (projectHint) {
        actions.push(contentText(context, '下一次相关任务开始时，请用相同 project_hint 调用 tracekeeper.recall，并设置 scope="project_history"。', 'For the next related session, call tracekeeper.recall with scope="project_history" and the same project_hint.'));
    }
    return actions;
}
function hasFinishTaskCloseoutCandidates(input) {
    return [
        input.decisions,
        input.solutionChanges,
        input.lessons,
        input.preferences,
        input.nextActions,
        input.memoryCandidates,
    ].some((values) => values.length > 0);
}
function resolveMemoryCloseoutStatus(reviewProposalMode, proposalResult, hasCloseoutCandidates) {
    if (!hasCloseoutCandidates) {
        return 'empty';
    }
    if (reviewProposalMode === 'off' || reviewProposalMode === 'suggest') {
        return 'ignored';
    }
    const queued = proposalResult.proposals.length;
    const autoSaved = proposalResult.autoAppliedMemoryUpdates.length;
    if (queued > 0 && autoSaved > 0) {
        return 'mixed';
    }
    if (autoSaved > 0) {
        return 'auto_saved';
    }
    if (queued > 0) {
        return 'queued';
    }
    return 'empty';
}
function buildMemoryCloseoutSummary(context, status, proposalResult) {
    const queued = proposalResult.proposals.length;
    const autoSaved = proposalResult.autoAppliedMemoryUpdates.length;
    switch (status) {
        case 'auto_saved':
            return contentText(context, `已自动保存 ${autoSaved} 条项目记忆更新。`, `${autoSaved} project memory update(s) were auto-saved.`);
        case 'queued':
            return contentText(context, `${queued} 条记忆候选已进入知识变更审核。`, `${queued} memory candidate(s) were sent to Knowledge Change Review.`);
        case 'mixed':
            return contentText(context, `已自动保存 ${autoSaved} 条项目记忆更新，另有 ${queued} 条候选进入知识变更审核。`, `${autoSaved} project memory update(s) were auto-saved and ${queued} candidate(s) were sent to Knowledge Change Review.`);
        case 'ignored':
            return contentText(context, '收尾记忆候选已记录在会话中，但当前模式没有入队或写入。', 'Closeout memory candidates were recorded in the session but not queued or written by the selected mode.');
        case 'empty':
        default:
            return contentText(context, '没有提交可长期沉淀的收尾记忆候选。', 'No durable closeout memory candidates were submitted.');
    }
}
function resolveCanonicalMemoryCloseoutStatus(reviewProposalMode, proposalResult, hasCloseoutCandidates, legacyStatus) {
    if (!hasCloseoutCandidates) {
        return 'no_candidates';
    }
    if (reviewProposalMode === 'off') {
        return 'disabled';
    }
    if (reviewProposalMode === 'suggest') {
        return 'suggested';
    }
    if (proposalResult.hasMissingWikiBridge && proposalResult.proposals.length > 0) {
        return 'requires_wiki_bridge';
    }
    switch (legacyStatus) {
        case 'auto_saved':
            return 'auto_saved';
        case 'mixed':
            return 'partially_auto_saved';
        case 'queued':
            return 'queued_for_review';
        case 'ignored':
            return 'disabled';
        case 'empty':
        default:
            return 'no_candidates';
    }
}
function buildSessionNoteBodyWithDistill(context, summary, outcomes, nextActions, decisions, possiblePreferences) {
    const lines = [
        contentText(context, '# 会话提炼记录', '# Distilled Session Note'),
        `- created_at: ${new Date().toISOString()}`,
        '',
        contentText(context, '## 摘要', '## Summary'),
        summary,
        '',
        contentText(context, '## 结果', '## Outcomes'),
        ...formatListMarkdown(outcomes).split('\n'),
        '',
        contentText(context, '## 下一步', '## Next Actions'),
        ...formatListMarkdown(nextActions).split('\n'),
        '',
        contentText(context, '## 决策', '## Decisions'),
        ...formatListMarkdown(decisions).split('\n'),
        '',
        contentText(context, '## 可能偏好', '## Possible Preferences'),
        ...formatListMarkdown(possiblePreferences).split('\n'),
    ].join('\n');
    return lines.trim();
}
async function createDistillProposal(vaultRoot, taskId, proposalKind, kindLabel, contentItems, projectHint, context) {
    const writebackContent = contentItems.map((item) => `- ${item}`).join('\n');
    const body = [
        contentText(context, `## 提炼内容：${kindLabel}`, `## Distilled ${kindLabel}`),
        writebackContent,
        '',
        `- task_id: ${taskId}`,
        '',
        contentText(context, '## 写回内容', '## Writeback'),
        writebackContent,
    ].join('\n');
    const now = new Date().toISOString();
    const creationNonce = crypto.randomUUID();
    const proposalId = (0, core_1.buildStableProposalId)(`distill-session\0${taskId}\0${proposalKind}\0${creationNonce}`);
    const filenameToken = `${proposalKind}-${taskId}-${now.replace(/[:.]/g, '-')}-${creationNonce.slice(0, 8)}`;
    const proposal = await buildAndWriteNoteAsync(vaultRoot, 'tracekeeper.distill_session', MEMORY_PROPOSAL_DIR, buildSafeFilename(filenameToken, proposalKind, context), {
        tool: 'tracekeeper.distill_session',
        type: 'memory_proposal',
        proposal_id: proposalId,
        title: `${kindLabel} ${taskId}`,
        proposal_kind: proposalKind,
        status: 'pending',
        risk_level: 'medium',
        created_at: now,
        task_id: taskId,
        project_hint: projectHint || null,
    }, body, taskId, context, {
        target_type: 'memory_proposal',
        proposal_kind: proposalKind,
    });
    return { path: proposal.path, proposalId };
}
function isFinishTaskOperationPayload(payload) {
    if (!(0, protocol_1.isRecord)(payload)) {
        return false;
    }
    if (typeof payload.taskId !== 'string' || !payload.taskId) {
        return false;
    }
    if (typeof payload.summary !== 'string') {
        return false;
    }
    if (!Array.isArray(payload.outcomes) || !payload.outcomes.every((item) => typeof item === 'string')) {
        return false;
    }
    if (!Array.isArray(payload.nextActions) || !payload.nextActions.every((item) => typeof item === 'string')) {
        return false;
    }
    if (!Array.isArray(payload.decisions) || !payload.decisions.every((item) => typeof item === 'string')) {
        return false;
    }
    if (!Array.isArray(payload.solutionChanges) || !payload.solutionChanges.every((item) => typeof item === 'string')) {
        return false;
    }
    if (!Array.isArray(payload.lessons) || !payload.lessons.every((item) => typeof item === 'string')) {
        return false;
    }
    if (!Array.isArray(payload.preferences) || !payload.preferences.every((item) => typeof item === 'string')) {
        return false;
    }
    if (!Array.isArray(payload.memoryCandidates) || !payload.memoryCandidates.every((item) => typeof item === 'string')) {
        return false;
    }
    if (typeof payload.requestHash !== 'string' || !payload.requestHash) {
        return false;
    }
    if (!(0, protocol_1.isRecord)(payload.requestSnapshot) || typeof payload.requestSnapshot.task_id !== 'string') {
        return false;
    }
    if (payload.projectMemoryEntryVersion !== undefined
        && payload.projectMemoryEntryVersion !== 1) {
        return false;
    }
    if (payload.projectMemoryEntryVersion === 1
        && (typeof payload.projectMemoryCreatedAt !== 'string'
            || Number.isNaN(Date.parse(payload.projectMemoryCreatedAt))
            || typeof payload.projectMemoryAgentType !== 'string'
            || !payload.projectMemoryAgentType)) {
        return false;
    }
    return true;
}
function projectIdentityFromFinishPayload(input) {
    return input.projectIdentity ?? {
        projectHint: input.projectHint,
        projectId: input.projectId || '',
        repoPath: input.repoPath || '',
        source: 'task_metadata',
        confidence: input.projectHint || input.projectId || input.repoPath ? 'derived' : 'uncertain',
        warnings: ['legacy_finish_payload_without_project_identity'],
    };
}
function buildFinishTaskRequestSnapshot(rawArgs) {
    const explicitIdentity = (0, project_identity_1.resolveProjectIdentity)(rawArgs);
    return {
        task_id: coerceNonEmptyString(rawArgs.task_id, true, 'task_id'),
        summary: coerceNonEmptyString(rawArgs.summary, true, 'summary'),
        outcomes: coerceStringOrStringArray(rawArgs.outcomes, 'outcomes'),
        next_actions: coerceStringOrStringArray(rawArgs.next_actions, 'next_actions'),
        decisions: coerceStringOrStringArray(rawArgs.decisions, 'decisions'),
        solution_changes: coerceStringOrStringArray(rawArgs.solution_changes, 'solution_changes'),
        lessons: coerceStringOrStringArray(rawArgs.lessons, 'lessons'),
        preferences: coerceStringOrStringArray(rawArgs.preferences, 'preferences'),
        memory_candidates: coerceStringOrStringArray(rawArgs.memory_candidates, 'memory_candidates'),
        review_proposal_mode: rawArgs.review_proposal_mode == null
            ? null
            : coerceReviewProposalMode(rawArgs.review_proposal_mode, 'auto_propose'),
        client: coerceOptionalString(rawArgs.client) || null,
        project_hint: explicitIdentity.projectHint || null,
        project_id: explicitIdentity.projectId || null,
        repo_path: explicitIdentity.repoPath || null,
        memory_scope: rawArgs.memory_scope ?? null,
        related_wiki: normalizeMultiValueList(rawArgs.related_wiki, 'related_wiki'),
        related_sources: normalizeMultiValueList(rawArgs.related_sources, 'related_sources'),
        filename: coerceOptionalString(rawArgs.filename) || null,
    };
}
async function buildFinishTaskOperationPayload(rawArgs, context, operationId, requestHash, requestSnapshot) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const taskId = coerceNonEmptyString(rawArgs.task_id, true, 'task_id');
    const summary = coerceNonEmptyString(rawArgs.summary, true, 'summary');
    const outcomes = coerceStringOrStringArray(rawArgs.outcomes, 'outcomes');
    const nextActions = coerceStringOrStringArray(rawArgs.next_actions, 'next_actions');
    const decisions = coerceStringOrStringArray(rawArgs.decisions, 'decisions');
    const solutionChanges = coerceStringOrStringArray(rawArgs.solution_changes, 'solution_changes');
    const lessons = coerceStringOrStringArray(rawArgs.lessons, 'lessons');
    const preferences = coerceStringOrStringArray(rawArgs.preferences, 'preferences');
    const memoryCandidates = coerceStringOrStringArray(rawArgs.memory_candidates, 'memory_candidates');
    const reviewProposalMode = coerceReviewProposalMode(rawArgs.review_proposal_mode, defaultReviewProposalMode(context));
    const taskMetadata = await readAgentTaskMetadataAsync(vaultRoot, taskId, context);
    const identityScan = scanVaultForContext(vaultRoot, context);
    const explicitIdentity = (0, project_identity_1.resolveProjectIdentity)(rawArgs, identityScan.notes);
    const projectIdentity = mergeTaskProjectIdentity(taskId, taskMetadata, explicitIdentity);
    const client = coerceOptionalString(rawArgs.client) || taskMetadata.client;
    const projectHint = projectIdentity.projectHint;
    const memoryScope = rawArgs.memory_scope === undefined ? '' : rawArgs.memory_scope;
    const relatedWiki = normalizeMultiValueList(rawArgs.related_wiki, 'related_wiki');
    const relatedSources = normalizeMultiValueList(rawArgs.related_sources, 'related_sources');
    const architectureStatus = buildArchitectureStatus(vaultRoot, context);
    const bridgeMetadata = resolveProjectMemoryBridgeMetadata(vaultRoot, resolveMemoryScope('session_finish', '', projectHint, memoryScope), projectHint, relatedWiki, relatedSources, context);
    const filename = buildSafeFilename(rawArgs.filename || `finish-${taskId}-${operationId}`, 'session', context);
    const closeoutGroups = buildFinishTaskCloseoutGroups({
        decisions,
        solution_changes: solutionChanges,
        lessons,
        preferences,
        next_actions: nextActions,
        memory_candidates: memoryCandidates,
    }, context);
    return {
        requestHash,
        requestSnapshot,
        projectMemoryEntryVersion: 1,
        projectMemoryCreatedAt: new Date().toISOString(),
        projectMemoryAgentType: (() => {
            const observed = context.observedClientType ?? (0, observed_client_1.normalizeObservedClientType)(client);
            return observed === 'unknown' ? 'custom' : observed;
        })(),
        taskId,
        summary,
        outcomes,
        nextActions,
        decisions,
        solutionChanges,
        lessons,
        preferences,
        memoryCandidates,
        projectIdentity,
        projectId: projectIdentity.projectId,
        repoPath: projectIdentity.repoPath,
        reviewProposalMode,
        client,
        projectHint,
        memoryScope,
        relatedWiki: bridgeMetadata.related_wiki,
        relatedSources: bridgeMetadata.related_sources,
        rawRelatedWiki: relatedWiki,
        rawRelatedSources: relatedSources,
        missingWikiBridge: bridgeMetadata.missing_wiki_bridge,
        missingRelatedSources: bridgeMetadata.missing_related_sources,
        vaultRoot,
        filename,
        architectureStatus,
        closeoutGroups,
        hasCloseoutCandidates: hasFinishTaskCloseoutCandidates({
            decisions,
            solutionChanges,
            lessons,
            preferences,
            nextActions,
            memoryCandidates,
        }),
        contentLanguage: contentLanguageFromContext(context),
    };
}
function resolveFinishTaskSessionNotePath(input, context) {
    const safeLeaf = (0, safety_1.normalizeNotePath)(input.filename, pathSafetyOptions(context));
    const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
    return `${SESSION_NOTE_DIR}/${normalized}`;
}
async function writeFinishTaskSessionNote(input, context, operationId) {
    const projectIdentity = projectIdentityFromFinishPayload(input);
    const body = buildSessionNoteBodyWithCloseout(context, input.summary, input.outcomes, input.nextActions, input.decisions, input.solutionChanges, input.lessons, input.preferences, input.memoryCandidates);
    assertNoSensitiveText([
        { label: 'summary', value: input.summary },
        { label: 'outcomes', value: input.outcomes.join('\n') },
        { label: 'next_actions', value: input.nextActions.join('\n') },
        { label: 'decisions', value: input.decisions.join('\n') },
        { label: 'solution_changes', value: input.solutionChanges.join('\n') },
        { label: 'lessons', value: input.lessons.join('\n') },
        { label: 'preferences', value: input.preferences.join('\n') },
        { label: 'memory_candidates', value: input.memoryCandidates.join('\n') },
        { label: 'client', value: input.client },
        { label: 'project_hint', value: input.projectHint },
        { label: 'related_wiki', value: input.relatedWiki.join('\n') },
        { label: 'related_sources', value: input.relatedSources.join('\n') },
    ]);
    const sessionAuditMetadata = {
        target_type: 'session_note',
        task_stage: 'finish',
    };
    const existing = await findOperationOwnedNoteAsync(input.vaultRoot, SESSION_NOTE_DIR, input.filename, 'finish_operation_id', operationId, context);
    if (existing) {
        await appendAuditEventAsync(input.vaultRoot, {
            operationId,
            tool: 'tracekeeper.finish_task',
            targetPath: existing.path,
            status: 'written',
            taskId: input.taskId,
            metadata: sessionAuditMetadata,
        }, context);
        return existing.path;
    }
    const note = await buildAndWriteNoteAsync(input.vaultRoot, 'tracekeeper.finish_task', SESSION_NOTE_DIR, input.filename, {
        tool: 'tracekeeper.finish_task',
        type: 'session_note',
        title: contentText(context, `任务 ${input.taskId} 收尾记录`, `Task ${input.taskId} finish note`),
        task_id: input.taskId,
        client: input.client || null,
        project_hint: input.projectHint || null,
        related_project: input.projectHint || null,
        project_id: input.projectId || null,
        repo_path: input.repoPath || null,
        project_identity_source: projectIdentity.source,
        project_identity_confidence: projectIdentity.confidence,
        project_identity_warnings: projectIdentity.warnings,
        memory_scope: resolveMemoryScope('session_finish', '', input.projectHint, input.memoryScope),
        related_wiki: input.relatedWiki,
        related_sources: input.relatedSources,
        architecture_status: input.architectureStatus.architecture_status,
        missing_graph_bridges: input.architectureStatus.missing_graph_bridges,
        created_at: new Date().toISOString(),
        review_proposal_mode: input.reviewProposalMode || null,
        finish_operation_id: operationId,
    }, body, input.taskId, context, sessionAuditMetadata, operationId);
    return note.path;
}
function finishTaskShouldWriteCloseoutGroup(group, input, context) {
    if (group.values.length === 0) {
        return false;
    }
    if (input.reviewProposalMode === 'off' || input.reviewProposalMode === 'suggest') {
        return false;
    }
    const memoryScope = resolveMemoryScope(group.kind, '', input.projectHint, input.memoryScope);
    const memoryRule = memoryProposalRuleFor(group.kind, '', input.projectHint, context, memoryScope);
    return memoryRule !== 'disabled';
}
function buildFinishTaskProjectMemoryPlan(input, context) {
    if (input.reviewProposalMode !== 'auto_propose') {
        return null;
    }
    const groups = input.closeoutGroups.filter((group) => {
        if (group.values.length === 0) {
            return false;
        }
        const memoryScope = resolveMemoryScope(group.kind, '', input.projectHint, input.memoryScope);
        return memoryScope === 'project'
            && memoryProposalRuleFor(group.kind, '', input.projectHint, context, memoryScope) === 'auto_write';
    });
    if (groups.length === 0) {
        return null;
    }
    const bridgeMetadata = resolveProjectMemoryBridgeMetadata(input.vaultRoot, 'project', input.projectHint, input.rawRelatedWiki ?? input.relatedWiki, input.rawRelatedSources ?? input.relatedSources, context);
    if (bridgeMetadata.missing_wiki_bridge) {
        return null;
    }
    return { groups, bridgeMetadata };
}
function buildFinishTaskProjectMemoryBody(groups) {
    return groups.flatMap((group, index) => [
        ...(index > 0 ? [''] : []),
        `## ${group.label}`,
        '',
        ...group.values.map((value) => `- ${value}`),
    ]).join('\n');
}
async function writeFinishTaskProjectMemoryArtifacts(input, context, operationId) {
    const plan = buildFinishTaskProjectMemoryPlan(input, context);
    if (!plan) {
        throw new safety_1.ToolInputError('The finish-task project-memory step has no eligible immutable closeout groups.');
    }
    const operationRecord = await operationJournalForVault(input.vaultRoot).loadById(operationId);
    const createdAt = input.projectMemoryCreatedAt
        ?? operationRecord?.created_at;
    if (!createdAt) {
        throw new core_1.OperationConflictError('Finish-task project-memory creation time is unavailable.');
    }
    const observed = input.projectMemoryAgentType
        ?? (0, observed_client_1.normalizeObservedClientType)(input.client);
    const projectIdentity = projectIdentityFromFinishPayload(input);
    const immutable = await writeImmutableProjectMemory(input.vaultRoot, {
        toolName: 'tracekeeper.finish_task',
        projectId: projectIdentity.projectId,
        projectHint: projectIdentity.projectHint,
        repoPath: projectIdentity.repoPath,
        agentType: observed === 'unknown' ? 'custom' : observed,
        taskId: input.taskId,
        operationId,
        operationKind: 'finish_task',
        memoryKinds: plan.groups.map((group) => group.kind),
        body: buildFinishTaskProjectMemoryBody(plan.groups),
        relatedWiki: plan.bridgeMetadata.related_wiki,
        relatedSources: plan.bridgeMetadata.related_sources,
        createdAt,
        context,
    });
    if (immutable.status !== 'review_required') {
        return {
            outcome: 'immutable',
            path: immutable.path,
            project_id: immutable.project_id,
            agent_type: immutable.agent_type,
            operation_id: immutable.operation_id,
            operation_hash: immutable.operation_hash,
            memory_kinds: [...immutable.memory_kinds],
            write_status: immutable.write_status,
        };
    }
    const sessionNotePath = resolveFinishTaskSessionNotePath(input, context);
    for (const group of plan.groups) {
        await createFinishTaskProposal(input.vaultRoot, input.taskId, sessionNotePath, operationId, group.kind, group.label, group.values, input.projectHint, input.reviewProposalMode, 'project', plan.bridgeMetadata.related_wiki, plan.bridgeMetadata.related_sources, input.architectureStatus, input.architectureStatus.missing_graph_bridges, false, plan.bridgeMetadata.missing_related_wiki, plan.bridgeMetadata.missing_related_sources, context, true);
    }
    return { outcome: 'review_fallback' };
}
async function writeFinishTaskCloseoutArtifacts(input, group, context, operationId) {
    const sessionNotePath = resolveFinishTaskSessionNotePath(input, context);
    const memoryScope = resolveMemoryScope(group.kind, '', input.projectHint, input.memoryScope);
    const bridgeMetadata = resolveProjectMemoryBridgeMetadata(input.vaultRoot, memoryScope, input.projectHint, input.rawRelatedWiki ?? input.relatedWiki, input.rawRelatedSources ?? input.relatedSources, context);
    const memoryRule = memoryProposalRuleFor(group.kind, '', input.projectHint, context, memoryScope);
    if (memoryRule === 'disabled' || input.reviewProposalMode === 'suggest') {
        return;
    }
    if (input.reviewProposalMode === 'auto_propose' && memoryRule === 'auto_write') {
        const canAutoWrite = !(memoryScope === 'project' &&
            bridgeMetadata.missing_wiki_bridge);
        if (canAutoWrite
            && memoryScope === 'project') {
            return writeFinishTaskProjectMemoryArtifacts(input, context, operationId);
        }
        if (canAutoWrite) {
            const autoTarget = resolveAutoMemoryTarget(input.vaultRoot, group.kind, '', input.projectHint, context, memoryScope);
            if (autoTarget) {
                await appendAutoMemoryWriteAsync(input.vaultRoot, {
                    toolName: 'tracekeeper.finish_task',
                    proposalKind: group.kind,
                    targetNote: autoTarget.targetNote,
                    allowedDir: autoTarget.allowedDir,
                    title: group.label,
                    content: group.values.map((item) => `- ${item}`).join('\n'),
                    taskId: input.taskId,
                    context,
                    operationId,
                    projectHint: input.projectHint,
                    sourceNote: sessionNotePath,
                    memoryScope,
                    relatedWiki: bridgeMetadata.related_wiki,
                    relatedSources: bridgeMetadata.related_sources,
                    architectureStatus: input.architectureStatus,
                    missingGraphBridges: input.architectureStatus.missing_graph_bridges,
                    missingWikiBridge: false,
                    missingRelatedWiki: bridgeMetadata.missing_related_wiki,
                    missingRelatedSources: bridgeMetadata.missing_related_sources,
                    signature: buildFinishTaskProposalSignature(input.taskId, group.kind, group.values),
                });
                return;
            }
        }
    }
    await createFinishTaskProposal(input.vaultRoot, input.taskId, sessionNotePath, operationId, group.kind, group.label, group.values, input.projectHint, input.reviewProposalMode, memoryScope, bridgeMetadata.related_wiki, bridgeMetadata.related_sources, input.architectureStatus, input.architectureStatus.missing_graph_bridges, bridgeMetadata.missing_wiki_bridge, bridgeMetadata.missing_related_wiki, bridgeMetadata.missing_related_sources, context);
}
async function updateFinishTaskRecord(input, context, operationId) {
    const projectIdentity = projectIdentityFromFinishPayload(input);
    const notePath = resolveFinishTaskSessionNotePath(input, context);
    const sessionNote = await findOperationOwnedNoteAsync(input.vaultRoot, SESSION_NOTE_DIR, input.filename, 'finish_operation_id', operationId, context);
    if (!sessionNote) {
        throw new safety_1.ToolInputError(`Session note is missing for finish-task operation: ${notePath}`);
    }
    const proposalResult = await collectFinishTaskArtifacts(input.vaultRoot, input.taskId, sessionNote.path, input.reviewProposalMode, input.projectHint, input.memoryScope, input.rawRelatedWiki ?? input.relatedWiki, input.rawRelatedSources ?? input.relatedSources, input.architectureStatus, {
        decisions: input.decisions,
        solution_changes: input.solutionChanges,
        lessons: input.lessons,
        preferences: input.preferences,
        next_actions: input.nextActions,
        memory_candidates: input.memoryCandidates,
    }, context, operationId, input.projectMemoryEntryVersion === 1
        && buildFinishTaskProjectMemoryPlan(input, context) !== null);
    const proposalPaths = proposalResult.proposals.map((proposal) => proposal.path);
    const proposalIds = proposalResult.proposals.map((proposal) => proposal.proposalId);
    const autoWritePaths = proposalResult.autoAppliedMemoryUpdates.map((update) => update.path);
    const taskPath = await updateAgentTaskRecordAsync(input.vaultRoot, input.taskId, {
        status: 'completed',
        finished_at: new Date().toISOString(),
        summary: input.summary,
        session_note: sessionNote.path,
        outcomes: input.outcomes.join(', '),
        next_actions: input.nextActions.join(', '),
        decisions: input.decisions.join(', '),
        solution_changes: input.solutionChanges.join(', '),
        lessons: input.lessons.join(', '),
        preferences: input.preferences.join(', '),
        memory_candidates: input.memoryCandidates.join(', '),
        review_proposal_mode: input.reviewProposalMode,
        project_id: input.projectId || null,
        repo_path: input.repoPath || null,
        project_hint: input.projectHint,
        related_project: input.projectHint,
        project_identity_source: projectIdentity.source,
        project_identity_confidence: projectIdentity.confidence,
        project_identity_warnings: projectIdentity.warnings.join(', '),
        finish_operation_id: operationId,
    }, context, {
        memory_writes: [sessionNote.path, ...autoWritePaths],
        proposal_ids: proposalIds,
        proposal_paths: proposalPaths,
        proposal_link_targets: proposalPaths,
    }, [
        contentText(context, '## 完成摘要', '## Completion Summary'),
        input.summary,
        '',
        contentText(context, '## 结果', '## Outcomes'),
        ...formatListMarkdown(input.outcomes).split('\n'),
        '',
        contentText(context, '## 下一步', '## Next Actions'),
        ...formatListMarkdown(input.nextActions).split('\n'),
        '',
        contentText(context, '## 决策', '## Decisions'),
        ...formatListMarkdown(input.decisions).split('\n'),
        '',
        contentText(context, '## 方案调整', '## Solution Changes'),
        ...formatListMarkdown(input.solutionChanges).split('\n'),
        '',
        contentText(context, '## 经验教训', '## Lessons'),
        ...formatListMarkdown(input.lessons).split('\n'),
        '',
        contentText(context, '## 偏好', '## Preferences'),
        ...formatListMarkdown(input.preferences).split('\n'),
        '',
        contentText(context, '## 记忆候选', '## Memory Candidates'),
        ...formatListMarkdown(input.memoryCandidates).split('\n'),
        `^finish-${operationId}`,
    ].join('\n'), `^finish-${operationId}`);
    await updateManagedProposalReferences(input.vaultRoot, sessionNote.path, proposalResult.proposals, context);
    if (taskPath) {
        await updateManagedProposalReferences(input.vaultRoot, taskPath, proposalResult.proposals, context);
    }
    return taskPath;
}
async function executeFinishTaskOperation(input, context, operationId, idempotencyKey) {
    const projectIdentity = projectIdentityFromFinishPayload(input);
    const sessionNote = await findOperationOwnedNoteAsync(input.vaultRoot, SESSION_NOTE_DIR, input.filename, 'finish_operation_id', operationId, context);
    if (!sessionNote) {
        throw new safety_1.ToolInputError(`Session note is missing for finish-task operation: ${resolveFinishTaskSessionNotePath(input, context)}`);
    }
    const proposalResult = await collectFinishTaskArtifacts(input.vaultRoot, input.taskId, sessionNote.path, input.reviewProposalMode, input.projectHint, input.memoryScope, input.rawRelatedWiki ?? input.relatedWiki, input.rawRelatedSources ?? input.relatedSources, input.architectureStatus, {
        decisions: input.decisions,
        solution_changes: input.solutionChanges,
        lessons: input.lessons,
        preferences: input.preferences,
        next_actions: input.nextActions,
        memory_candidates: input.memoryCandidates,
    }, context, operationId, input.projectMemoryEntryVersion === 1
        && buildFinishTaskProjectMemoryPlan(input, context) !== null);
    const memoryCloseoutStatus = resolveMemoryCloseoutStatus(input.reviewProposalMode, proposalResult, input.hasCloseoutCandidates);
    const memoryCloseoutState = resolveCanonicalMemoryCloseoutStatus(input.reviewProposalMode, proposalResult, input.hasCloseoutCandidates, memoryCloseoutStatus);
    const response = {
        ok: true,
        read_only: false,
        operation_id: operationId,
        idempotency_key: idempotencyKey,
        task_id: input.taskId,
        task_path: buildTaskNotePath(input.taskId),
        path: sessionNote.path,
        audit_path: sessionNote.audit_path,
        review_proposal_mode: input.reviewProposalMode,
        content_language: input.contentLanguage,
        content_language_source: contentLanguageSourceFromContext(context),
        outcome_count: input.outcomes.length,
        next_action_count: input.nextActions.length,
        memory_scope: resolveMemoryScope('session_finish', '', input.projectHint, input.memoryScope),
        project_id: input.projectId || null,
        repo_path: input.repoPath || null,
        project_hint: input.projectHint || null,
        project_identity: (0, project_identity_1.projectIdentityToResult)(projectIdentity),
        related_wiki: input.relatedWiki,
        related_sources: input.relatedSources,
        architecture_status: input.architectureStatus.architecture_status,
        missing_graph_bridges: input.architectureStatus.missing_graph_bridges,
        missing_wiki_bridge: proposalResult.hasMissingWikiBridge,
        memory_closeout_status: memoryCloseoutStatus,
        memory_closeout_state: memoryCloseoutState,
        memory_closeout_summary: buildMemoryCloseoutSummary(context, memoryCloseoutStatus, proposalResult),
        next_actions_for_agent: buildFinishTaskNextActions(context, input.reviewProposalMode, proposalResult, input.projectHint, input.hasCloseoutCandidates),
    };
    if (proposalResult.hasMissingRelatedSources) {
        response.missing_related_sources = input.missingRelatedSources ?? [];
    }
    if (input.reviewProposalMode === 'auto_propose' || input.reviewProposalMode === 'review_queue') {
        response.proposal_count = proposalResult.proposals.length;
        response.proposals = proposalResult.proposals.map((proposal) => ({
            kind: proposal.kind,
            proposal_id: proposal.proposalId,
            path: proposal.path,
            proposal_link_target: proposal.linkTarget,
            ...(proposal.link ? { proposal_link: proposal.link } : {}),
        }));
        response.auto_applied_count = proposalResult.autoAppliedMemoryUpdates.length;
        response.auto_applied_memory_updates = proposalResult.autoAppliedMemoryUpdates.map((update) => ({
            kind: update.kind,
            path: update.path,
            status: update.status,
            ...(update.operation_id ? { operation_id: update.operation_id } : {}),
            ...(update.operation_hash ? { operation_hash: update.operation_hash } : {}),
            ...(update.agent_type ? { agent_type: update.agent_type } : {}),
            ...(update.memory_kinds ? { memory_kinds: [...update.memory_kinds] } : {}),
        }));
    }
    if (input.reviewProposalMode === 'suggest') {
        response.suggestion_count = proposalResult.suggestedMemoryUpdates.length;
        response.suggested_memory_updates = proposalResult.suggestedMemoryUpdates.map((update) => ({
            kind: update.kind,
            label: update.label,
            values: update.values,
        }));
    }
    return response;
}
function readTaskLifecycleState(vaultRoot, taskId, context) {
    try {
        const absolutePath = (0, safety_1.resolveSafeNotePath)(vaultRoot, buildTaskNotePath(taskId), pathSafetyOptions(context));
        const parsed = (0, core_1.parseMarkdown)(fs.readFileSync(absolutePath, 'utf8'));
        return {
            status: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['status'])).toLowerCase(),
            finishOperationId: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['finish_operation_id'])),
        };
    }
    catch (error) {
        if (error instanceof safety_1.ToolInputError || error instanceof core_1.VaultPathError) {
            return null;
        }
        throw error;
    }
}
async function readTaskLifecycleStateAsync(vaultRoot, taskId, context) {
    try {
        if (context.vaultRepository) {
            const taskFile = await context.vaultRepository.readText(buildTaskNotePath(taskId));
            if (!taskFile) {
                return null;
            }
            const parsed = (0, core_1.parseMarkdown)(taskFile.content);
            return {
                status: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['status'])).toLowerCase(),
                finishOperationId: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['finish_operation_id'])),
            };
        }
        const absolutePath = (0, safety_1.resolveSafeNotePath)(vaultRoot, buildTaskNotePath(taskId), pathSafetyOptions(context));
        const parsed = (0, core_1.parseMarkdown)(fs.readFileSync(absolutePath, 'utf8'));
        return {
            status: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['status'])).toLowerCase(),
            finishOperationId: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['finish_operation_id'])),
        };
    }
    catch (error) {
        if (error instanceof safety_1.ToolInputError || error instanceof core_1.VaultPathError) {
            return null;
        }
        throw error;
    }
}
async function handleFinishTask(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const requestSnapshot = buildFinishTaskRequestSnapshot(rawArgs);
    const requestHash = (0, core_1.computePayloadHash)(requestSnapshot);
    const identity = buildToolOperationIdentity('finish-task', rawArgs.idempotency_key, requestSnapshot, context);
    const journal = operationJournalForVault(vaultRoot);
    const existing = await journal.loadByIdempotencyKey(identity.idempotencyKey);
    let operationPayload;
    if (existing) {
        if (existing.operation_id !== identity.operationId) {
            throw new core_1.OperationConflictError(`Idempotency key conflict for "${identity.idempotencyKey}": associated with existing operation "${existing.operation_id}"`);
        }
        if (!isFinishTaskOperationPayload(existing.payload)) {
            throw new core_1.OperationConflictError(`Idempotency key conflict for "${identity.idempotencyKey}" with incompatible finish_task request payload`);
        }
        const storedRequestHash = typeof existing.payload.requestHash === 'string'
            ? existing.payload.requestHash
            : '';
        if (storedRequestHash && storedRequestHash !== requestHash) {
            throw new core_1.OperationConflictError(`Idempotency key conflict for "${identity.idempotencyKey}" with different finish_task request hash`);
        }
        operationPayload = existing.payload;
    }
    else {
        operationPayload = await buildFinishTaskOperationPayload(rawArgs, context, identity.operationId, requestHash, requestSnapshot);
    }
    if (!existing) {
        const lifecycle = await readTaskLifecycleStateAsync(vaultRoot, operationPayload.taskId, context);
        if (lifecycle?.status === 'completed') {
            throw new core_1.OperationConflictError(`Task is already completed: ${operationPayload.taskId}`);
        }
        if (lifecycle?.status === 'closing' &&
            lifecycle.finishOperationId &&
            lifecycle.finishOperationId !== identity.operationId) {
            throw new core_1.OperationConflictError(`Task is closing under another operation: ${operationPayload.taskId}`);
        }
        await updateAgentTaskRecordAsync(vaultRoot, operationPayload.taskId, {
            status: 'closing',
            finish_operation_id: identity.operationId,
        }, context);
    }
    const closeoutGroups = operationPayload.closeoutGroups.filter((group) => finishTaskShouldWriteCloseoutGroup(group, operationPayload, context));
    const projectMemoryPlan = buildFinishTaskProjectMemoryPlan(operationPayload, context);
    const aggregateProjectMemoryPlan = operationPayload.projectMemoryEntryVersion === 1
        ? projectMemoryPlan
        : null;
    const aggregatedKinds = new Set(aggregateProjectMemoryPlan?.groups.map((group) => group.kind) ?? []);
    const closeoutSteps = closeoutGroups
        .filter((group) => !aggregatedKinds.has(group.kind))
        .map((group) => ({
        name: `finish-task:${group.kind}`,
        execute: () => writeFinishTaskCloseoutArtifacts(operationPayload, group, context, identity.operationId),
        persistResult: operationPayload.projectMemoryEntryVersion !== 1
            && Boolean(projectMemoryPlan?.groups.some((projectGroup) => projectGroup.kind === group.kind)),
    }));
    if (aggregateProjectMemoryPlan) {
        closeoutSteps.unshift({
            name: 'finish-task:project-memory',
            execute: () => writeFinishTaskProjectMemoryArtifacts(operationPayload, context, identity.operationId),
            persistResult: true,
        });
    }
    const runner = new core_1.RecoverableOperationRunner({
        operationId: identity.operationId,
        idempotencyKey: identity.idempotencyKey,
        payload: operationPayload,
        journal,
        failureInjection: context.operationFailureInjection,
        steps: [
            {
                name: 'finish-task:session-note',
                execute: () => writeFinishTaskSessionNote(operationPayload, context, identity.operationId),
            },
            ...closeoutSteps,
            {
                name: 'finish-task:update-task-record',
                execute: () => updateFinishTaskRecord(operationPayload, context, identity.operationId),
            },
        ],
        finalize: () => executeFinishTaskOperation(operationPayload, context, identity.operationId, identity.idempotencyKey),
    });
    return runner.run();
}
async function handleDistillSession(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const taskId = coerceNonEmptyString(rawArgs.task_id, true, 'task_id');
    const summary = coerceNonEmptyString(rawArgs.summary, true, 'summary');
    const decisions = coerceStringOrStringArray(rawArgs.decisions, 'decisions');
    const nextActions = coerceStringOrStringArray(rawArgs.next_actions, 'next_actions');
    const possiblePreferences = coerceStringOrStringArray(rawArgs.possible_preferences, 'possible_preferences');
    const outcomes = coerceStringOrStringArray(rawArgs.outcomes, 'outcomes');
    const projectHint = coerceOptionalString(rawArgs.project_hint) || (await readAgentTaskMetadataAsync(vaultRoot, taskId, context)).projectHint;
    const filename = buildSafeFilename(rawArgs.filename, 'session', context);
    const now = new Date().toISOString();
    assertNoSensitiveText([
        { label: 'summary', value: summary },
        { label: 'decisions', value: decisions.join('\n') },
        { label: 'next_actions', value: nextActions.join('\n') },
        { label: 'possible_preferences', value: possiblePreferences.join('\n') },
        { label: 'outcomes', value: outcomes.join('\n') },
        { label: 'project_hint', value: projectHint },
    ]);
    const body = buildSessionNoteBodyWithDistill(context, summary, outcomes, nextActions, decisions, possiblePreferences);
    const note = await buildAndWriteNoteAsync(vaultRoot, 'tracekeeper.distill_session', SESSION_NOTE_DIR, filename, {
        tool: 'tracekeeper.distill_session',
        type: 'session_note',
        title: contentText(context, `任务 ${taskId} 提炼记录`, `Task ${taskId} distill note`),
        task_id: taskId,
        project_hint: projectHint || null,
        related_project: projectHint || null,
        created_at: now,
    }, body, taskId, context, {
        target_type: 'session_note',
        task_stage: 'distill',
    });
    const proposals = [];
    if (decisions.length > 0) {
        if (isMemoryProposalAllowed('distill_decisions', '', projectHint, context)) {
            const proposal = await createDistillProposal(vaultRoot, taskId, 'distill_decisions', 'Decisions', decisions, projectHint, context);
            proposals.push({
                proposalId: proposal.proposalId,
                path: proposal.path,
                linkTarget: proposal.path,
            });
        }
    }
    if (possiblePreferences.length > 0) {
        if (isMemoryProposalAllowed('distill_preferences', '', projectHint, context)) {
            const proposal = await createDistillProposal(vaultRoot, taskId, 'distill_preferences', 'Possible Preferences', possiblePreferences, projectHint, context);
            proposals.push({
                proposalId: proposal.proposalId,
                path: proposal.path,
                linkTarget: proposal.path,
            });
        }
    }
    const taskPath = await updateAgentTaskRecordAsync(vaultRoot, taskId, {
        session_note: note.path,
    }, context, {
        memory_writes: [note.path],
        proposal_ids: proposals.map((proposal) => proposal.proposalId),
        proposal_paths: proposals.map((proposal) => proposal.path),
        proposal_link_targets: proposals.map((proposal) => proposal.linkTarget),
    });
    await updateManagedProposalReferences(vaultRoot, note.path, proposals, context);
    if (taskPath) {
        await updateManagedProposalReferences(vaultRoot, taskPath, proposals, context);
    }
    return {
        ok: true,
        read_only: false,
        task_id: taskId,
        path: note.path,
        audit_path: note.audit_path,
        proposals: proposals.map((proposal) => ({
            proposal_id: proposal.proposalId,
            path: proposal.path,
            proposal_link_target: proposal.linkTarget,
        })),
        proposal_count: proposals.length,
    };
}
