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
exports.LOCAL_TRUST_CAPABILITIES = exports.LOCAL_TRUST_PRINCIPAL_ID = exports.readMergedAuditSections = void 0;
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
const capture_source_1 = require("./application/capture-source");
const source_request_1 = require("./application/source-request");
const propose_memory_1 = require("./application/propose-memory");
const finish_task_1 = require("./application/finish-task");
const audit_1 = require("./application/audit");
const audit_persistence_1 = require("./infrastructure/audit-persistence");
const vault_record_adapter_1 = require("./infrastructure/vault-record-adapter");
const recovery_1 = require("./application/recovery");
const observed_client_1 = require("./observed-client");
var audit_persistence_2 = require("./infrastructure/audit-persistence");
Object.defineProperty(exports, "readMergedAuditSections", { enumerable: true, get: function () { return audit_persistence_2.readMergedAuditSections; } });
exports.LOCAL_TRUST_PRINCIPAL_ID = 'local-user';
exports.LOCAL_TRUST_CAPABILITIES = [
    'vault.read',
    'workflow.manage',
    'vault.write',
    'memory.propose',
];
const REVIEW_QUEUE_PREFIX = core_1.TRACEKEEPER_REVIEW_QUEUE_DIR;
const AGENT_ACTIVITY_PATH = core_1.TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH;
const MAX_LIST_QUEUE_ITEMS = 20;
const MAX_AUDIT_ITEMS = 20;
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
const TOOL_NAME_SET = new Set(TRACEKEEPER_TOOL_CONTRACTS.map((contract) => contract.name));
const DEPRECATED_TOOL_REPLACEMENTS = Object.fromEntries(TRACEKEEPER_TOOL_CONTRACTS
    .filter((contract) => Boolean(contract.deprecated))
    .map((contract) => [contract.name, contract.deprecated?.replacement || '']));
const TOOL_CONTRACT_BY_NAME = new Map(TRACEKEEPER_TOOL_CONTRACTS.map((contract) => [contract.name, contract]));
function isToolName(value) {
    return TOOL_NAME_SET.has(value);
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
const CREATE_WIKI_NOTE_EFFECT = 'create_wiki_note';
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
        'status',
        'memory_status',
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
        if (typeof value !== 'string'
            && typeof value !== 'number'
            && typeof value !== 'boolean') {
            continue;
        }
        summaryParts.push(`${key}=${value}`);
    }
    if (payload.tool === 'tracekeeper.memory'
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
        memory_status: typeof payload.memory_status === 'string'
            ? payload.memory_status
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
    const state = payload.memory_status ?? payload.memory_closeout_state;
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
function nonNegativeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : 0;
}
function normalizedStringList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value
            .filter((entry) => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter(Boolean))];
}
function isDurableOutputStatus(value) {
    return value === 'none'
        || value === 'pending_review'
        || value === 'ready_to_apply'
        || value === 'revision_requested'
        || value === 'applied'
        || value === 'rejected'
        || value === 'unresolved'
        || value === 'mixed';
}
function legacyDurableOutputSummary(payload) {
    const memoryStatus = canonicalMemoryCloseoutStatus(payload);
    const proposals = Array.isArray(payload.proposals)
        ? payload.proposals.filter(protocol_1.isRecord)
        : [];
    const autoApplied = Array.isArray(payload.auto_applied_memory_updates)
        ? payload.auto_applied_memory_updates.filter(protocol_1.isRecord)
        : [];
    const proposalPaths = normalizedStringList(proposals.map((proposal) => proposal.path ?? proposal.proposal_path));
    const targetPaths = normalizedStringList([
        ...proposals.map((proposal) => proposal.target_note),
        ...autoApplied.map((update) => update.path),
    ]);
    let proposalCount = nonNegativeInteger(payload.proposal_count);
    let pendingReviewCount = 0;
    let appliedCount = nonNegativeInteger(payload.auto_applied_count);
    let unresolvedCount = 0;
    if (memoryStatus === 'queued_for_review' || memoryStatus === 'requires_wiki_bridge') {
        pendingReviewCount = Math.max(proposalCount, proposalPaths.length, 1);
        proposalCount = Math.max(proposalCount, pendingReviewCount);
    }
    else if (memoryStatus === 'partially_auto_saved') {
        pendingReviewCount = Math.max(proposalCount, proposalPaths.length, 1);
        proposalCount = Math.max(proposalCount, pendingReviewCount);
        appliedCount = Math.max(appliedCount, targetPaths.length > 0 ? 1 : 0, 1);
    }
    else if (memoryStatus === 'auto_saved') {
        appliedCount = Math.max(appliedCount, targetPaths.length > 0 ? 1 : 0, 1);
    }
    else if (memoryStatus === 'conflict') {
        unresolvedCount = Math.max(proposalCount, proposalPaths.length, 1);
        proposalCount = Math.max(proposalCount, unresolvedCount);
    }
    const activeStates = [pendingReviewCount, appliedCount, unresolvedCount]
        .filter((count) => count > 0)
        .length;
    const status = activeStates > 1
        ? 'mixed'
        : pendingReviewCount > 0
            ? 'pending_review'
            : appliedCount > 0
                ? 'applied'
                : unresolvedCount > 0
                    ? 'unresolved'
                    : 'none';
    return {
        status,
        source_capture_count: 0,
        proposal_count: proposalCount,
        pending_review_count: pendingReviewCount,
        ready_to_apply_count: 0,
        revision_requested_count: 0,
        applied_count: appliedCount,
        rejected_count: 0,
        unresolved_count: unresolvedCount,
        proposal_paths: proposalPaths,
        target_paths: targetPaths,
    };
}
function durableOutputSummaryFromPayload(payload) {
    if (!(0, protocol_1.isRecord)(payload.durable_output)) {
        return legacyDurableOutputSummary(payload);
    }
    const raw = payload.durable_output;
    const fallback = legacyDurableOutputSummary(payload);
    return {
        status: isDurableOutputStatus(raw.status) ? raw.status : fallback.status,
        source_capture_count: nonNegativeInteger(raw.source_capture_count),
        proposal_count: nonNegativeInteger(raw.proposal_count),
        pending_review_count: nonNegativeInteger(raw.pending_review_count),
        ready_to_apply_count: nonNegativeInteger(raw.ready_to_apply_count),
        revision_requested_count: nonNegativeInteger(raw.revision_requested_count),
        applied_count: nonNegativeInteger(raw.applied_count),
        rejected_count: nonNegativeInteger(raw.rejected_count),
        unresolved_count: nonNegativeInteger(raw.unresolved_count),
        proposal_paths: normalizedStringList(raw.proposal_paths),
        target_paths: normalizedStringList(raw.target_paths),
    };
}
function compatibleMemoryCloseoutStatus(durableOutput, fallback) {
    if (durableOutput.rejected_count > 0 || durableOutput.unresolved_count > 0) {
        return 'conflict';
    }
    if (fallback === 'requires_wiki_bridge' && durableOutputNeedsReview(durableOutput)) {
        return 'requires_wiki_bridge';
    }
    if (durableOutput.pending_review_count > 0
        || durableOutput.ready_to_apply_count > 0
        || durableOutput.revision_requested_count > 0) {
        return durableOutput.applied_count > 0
            ? 'partially_auto_saved'
            : 'queued_for_review';
    }
    if (durableOutput.applied_count > 0) {
        return 'auto_saved';
    }
    return fallback;
}
function durableOutputNeedsReview(durableOutput) {
    return durableOutput.pending_review_count > 0
        || durableOutput.ready_to_apply_count > 0
        || durableOutput.revision_requested_count > 0;
}
function buildFinishTaskActions(payload) {
    const baseId = actionBaseId(payload, 'finish-task');
    const durableOutput = durableOutputSummaryFromPayload(payload);
    const actions = [];
    const hasMissingMemoryHub = Array.isArray(payload.memory_changes)
        && payload.memory_changes.some((change) => (0, protocol_1.isRecord)(change) && change.reason === 'missing_memory_hub');
    if (hasMissingMemoryHub) {
        return [{
                action_id: `${baseId}:structure_repair_required`,
                kind: 'user_review',
                priority: 100,
                required: true,
                timing: 'immediate',
                reason_code: 'MEMORY_NOT_PERSISTED',
                reason: 'Report that one or more MemoryRecords were not persisted because a canonical Hub needs Tracekeeper structure check/repair in Obsidian. Do not call finish_task again; after repair, handle the queued proposal or submit a new proposal according to the review contract.',
            }];
    }
    if (durableOutputNeedsReview(durableOutput)) {
        actions.push({
            action_id: `${baseId}:report-review`,
            kind: 'user_review',
            priority: 100,
            required: true,
            timing: 'immediate',
            reason_code: 'MEMORY_REVIEW_REQUIRED',
            reason: `Report that durable Wiki/Memory output is ${durableOutput.status} and requires human review in Obsidian. Captured Source or Recall evidence does not prove that a Wiki/Memory target was applied; do not call finish_task again.`,
        });
    }
    if (durableOutput.rejected_count > 0 || durableOutput.unresolved_count > 0) {
        actions.push({
            action_id: `${baseId}:report-not-persisted`,
            kind: 'report_status',
            priority: 100,
            required: true,
            timing: 'immediate',
            reason_code: 'MEMORY_NOT_PERSISTED',
            reason: `Report that durable Wiki/Memory output is ${durableOutput.status} and was not persisted. Captured Source or Recall evidence remains provenance only; do not call finish_task again.`,
        });
    }
    if (actions.length > 0) {
        return actions;
    }
    const reason = durableOutput.status === 'applied'
        ? 'Report that the durable Wiki/Memory output was applied and do not call finish_task again.'
        : durableOutput.source_capture_count > 0
            ? 'Report that captured Source is readable provenance only and that no Wiki/Memory output was applied; do not call finish_task again.'
            : 'Report that no durable Wiki/Memory output was linked at finish and do not call finish_task again.';
    return [{
            action_id: `${baseId}:report`,
            kind: 'report_status',
            priority: 100,
            required: true,
            timing: 'immediate',
            reason_code: durableOutput.status === 'applied'
                ? 'MEMORY_RECORDED'
                : 'MEMORY_NOT_PERSISTED',
            reason,
        }];
}
function buildProposeMemoryActions(payload) {
    const baseId = actionBaseId(payload, 'propose-memory');
    if (payload.review_reason === 'missing_memory_hub') {
        return [{
                action_id: `${baseId}:structure_repair_required`,
                kind: 'user_review',
                priority: 100,
                required: true,
                timing: 'immediate',
                reason_code: 'MEMORY_NOT_PERSISTED',
                reason: 'The MemoryRecord was not persisted because its canonical Hub is missing or invalid. Ask the human to run Tracekeeper\'s explicit structure check/repair in Obsidian, then continue with the returned queued proposal under the human review/apply contract; submit a new candidate only if the result has no proposal_id or proposal_path.',
            }];
    }
    if (payload.auto_applied === true) {
        return [{
                action_id: `${baseId}:report-recorded`,
                kind: 'report_status',
                priority: 100,
                required: true,
                timing: 'immediate',
                reason_code: 'MEMORY_RECORDED',
                reason: 'Report that the governed MemoryRecord was persisted at the returned path.',
            }];
    }
    if (payload.memory_rule === 'disabled' || payload.persisted === false) {
        return [{
                action_id: `${baseId}:report-not-persisted`,
                kind: 'report_status',
                priority: 100,
                required: true,
                timing: 'immediate',
                reason_code: 'MEMORY_NOT_PERSISTED',
                reason: 'Report that the Memory candidate was ignored by the active scope policy and was not persisted or queued.',
            }];
    }
    return [{
            action_id: `${baseId}:report-review`,
            kind: 'user_review',
            priority: 100,
            required: true,
            timing: 'immediate',
            reason_code: 'MEMORY_REVIEW_REQUIRED',
            reason: 'Report that the Wiki or Memory proposal was queued and requires human review in Obsidian before it becomes persisted knowledge.',
        }];
}
function classifyToolError(message) {
    if (/lacks capability|permission denied/i.test(message)) {
        return { code: 'PERMISSION_DENIED', retryable: false, reasonCode: 'PERMISSION_DENIED' };
    }
    if (/cursor generation .* stale|stale .*cursor|cursor .* stale/i.test(message)) {
        return { code: 'STALE_CURSOR', retryable: true };
    }
    if (/memory cursor|catalog cursor|cursor checksum|cursor .*invalid|invalid .*cursor/i.test(message)) {
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
    if (/project_scope_uncertain|project_identity_not_found/i.test(message)) {
        return { code: 'INVALID_REQUEST', retryable: false, reasonCode: 'PROJECT_SCOPE_UNCERTAIN' };
    }
    return { code: 'INVALID_REQUEST', retryable: false };
}
function safeToolErrorDescription(code, reasonCode) {
    if (reasonCode === 'PROJECT_SCOPE_UNCERTAIN') {
        return 'The supplied project identity is not an exact current Vault identity; use Runtime-resolved identity evidence instead of guessing.';
    }
    switch (code) {
        case 'PERMISSION_DENIED':
            return 'The current principal is not allowed to perform this action.';
        case 'FINISH_ALREADY_COMPLETED':
            return 'The tracked task is already closed and must not be finished again.';
        case 'IDEMPOTENCY_CONFLICT':
            return 'Idempotency key conflict: the retry key conflicts with an existing operation; preserve the original result.';
        case 'STALE_CURSOR':
            return 'The memory catalog snapshot changed; restart enumeration from the first page.';
        case 'INVALID_CURSOR':
            return 'The memory catalog cursor is invalid for this request.';
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
        const safeMessage = safeToolErrorDescription(classified.code, classified.reasonCode);
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
        const scope = payload.scope_mode === 'project' || payload.scope_mode === 'project_history' || payload.scope_mode === 'task_history'
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
        const durableOutput = durableOutputSummaryFromPayload(payload);
        const memoryStatus = compatibleMemoryCloseoutStatus(durableOutput, canonicalMemoryCloseoutStatus(payload));
        decorated.memory_status = memoryStatus;
        decorated.durable_output = durableOutput;
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
            proposal_count: durableOutput.proposal_count,
            auto_applied_count: typeof payload.auto_applied_count === 'number' ? payload.auto_applied_count : 0,
            action_required: durableOutputNeedsReview(durableOutput),
        };
        decorated.next_actions = buildFinishTaskActions(decorated);
    }
    if (toolName === 'tracekeeper.propose_memory') {
        decorated.next_actions = buildProposeMemoryActions(decorated);
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
    for (const key of [
        'operation_id',
        'idempotency_key',
        'task_id',
        'task_path',
        'path',
        'activity_path',
        'proposal_id',
        'proposal_path',
        'target_note',
        'request_path',
    ]) {
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
function configuredVaultRoot(context) {
    if (!context.defaultVaultRoot) {
        throw new safety_1.ToolInputError('vaultRoot is required unless --vault-root is configured.');
    }
    return (0, safety_1.toSafeVaultRoot)(context.defaultVaultRoot);
}
function assertCallerDoesNotSelectVaultRoot(args) {
    if (Object.prototype.hasOwnProperty.call(args, 'vaultRoot')) {
        throw new safety_1.ToolInputError('vaultRoot is managed by the Tracekeeper server and must not be supplied in tool arguments.');
    }
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
    if (normalized === 'task_history' || normalized === 'tasks' || normalized === 'task') {
        return 'task_history';
    }
    throw new safety_1.ToolInputError('scope must be one of: global, project, project_history, task_history.');
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
async function knowledgeReadViewForContext(vaultRoot, context) {
    if (!context.knowledgeReadViewPromise) {
        context.knowledgeReadViewPromise = (async () => {
            const provided = await context.knowledgeReadViewProvider?.(vaultRoot);
            if (provided)
                return provided;
            const scan = scanVaultForContext(vaultRoot, context);
            const index = new core_1.InMemoryKnowledgeIndex({ vaultRoot, initialScan: scan });
            const view = await index.readView();
            return scan.index
                ? view
                : { ...view, source: 'filesystem_scan' };
        })();
    }
    return context.knowledgeReadViewPromise;
}
async function freshKnowledgeReadViewForContext(vaultRoot, context) {
    const { knowledgeReadViewPromise: _cachedReadView, ...freshContext } = context;
    return knowledgeReadViewForContext(vaultRoot, freshContext);
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
function readViewProvenance(view) {
    return {
        index_state: view.source === 'filesystem_scan' ? 'filesystem_scan' : view.index_state,
        snapshot_generation: view.source === 'filesystem_scan' ? null : view.generation,
        snapshot_warning: view.index_state === 'rebuilding'
            ? 'Knowledge index is rebuilding; this result may come from the previous snapshot generation.'
            : view.index_state === 'initializing'
                ? 'Knowledge index metadata is still initializing; this result may be incomplete.'
                : null,
    };
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
function coerceIsoTimestamp(value, required, field) {
    const timestamp = coerceNonEmptyString(value, required, field);
    if (!timestamp) {
        return '';
    }
    const parsed = Date.parse(timestamp);
    if (Number.isNaN(parsed)) {
        throw new safety_1.ToolInputError(`${field} must be a valid ISO timestamp.`);
    }
    return new Date(parsed).toISOString();
}
function coerceRecordingReason(value) {
    const normalized = coerceOptionalString(value) || 'ordinary_closeout';
    if (normalized === 'ordinary_closeout' || normalized === 'start_unavailable') {
        return normalized;
    }
    throw new safety_1.ToolInputError('recording_reason must be one of: ordinary_closeout, start_unavailable.');
}
function coerceFinishTaskStatus(value) {
    if (value === undefined || value === null || value === '') {
        return 'completed';
    }
    const normalized = coerceOptionalString(value).toLowerCase();
    if (normalized === 'completed' || normalized === 'partial' || normalized === 'blocked') {
        return normalized;
    }
    throw new safety_1.ToolInputError('status must be one of: completed, partial, blocked.');
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
function normalizeFinishTaskMemoryCandidateRecords(value) {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new safety_1.ToolInputError('memory_candidate_records must be an array.');
    }
    if (value.length > 64) {
        throw new safety_1.ToolInputError('memory_candidate_records exceeds the maximum of 64 entries.');
    }
    const allowed = new Set([
        'proposal_kind', 'content', 'scope', 'project_hint', 'project_id', 'repo_path', 'related_wiki', 'related_sources',
        'evidence', 'target_note', 'claim_key',
        'proposed_authority', 'proposed_confidence', 'declared_state',
        'observed_at', 'valid_from', 'valid_to', 'last_verified_at',
        'supersedes', 'contradicts',
    ]);
    return value.map((entry, index) => {
        if (!(0, protocol_1.isRecord)(entry)) {
            throw new safety_1.ToolInputError(`memory_candidate_records[${index}] must be an object.`);
        }
        for (const key of Object.keys(entry)) {
            if (!allowed.has(key)) {
                throw new safety_1.ToolInputError(`Unknown memory_candidate_records field: ${key}.`);
            }
        }
        const optional = (field) => coerceOptionalString(entry[field]) || null;
        const scope = coerceMemoryScope(entry.scope);
        if (!scope) {
            throw new safety_1.ToolInputError(`memory_candidate_records[${index}].scope must be global or project.`);
        }
        return {
            proposal_kind: coerceNonEmptyString(entry.proposal_kind, true, `memory_candidate_records[${index}].proposal_kind`),
            content: coerceNonEmptyString(entry.content, true, `memory_candidate_records[${index}].content`),
            scope,
            project_hint: optional('project_hint'),
            project_id: optional('project_id'),
            repo_path: optional('repo_path'),
            related_wiki: normalizeMultiValueList(entry.related_wiki, `memory_candidate_records[${index}].related_wiki`),
            related_sources: normalizeMultiValueList(entry.related_sources, `memory_candidate_records[${index}].related_sources`),
            evidence: normalizeMultiValueList(entry.evidence, `memory_candidate_records[${index}].evidence`),
            target_note: optional('target_note'),
            claim_key: optional('claim_key'),
            proposed_authority: optional('proposed_authority'),
            proposed_confidence: optional('proposed_confidence'),
            declared_state: optional('declared_state'),
            observed_at: optional('observed_at'),
            valid_from: optional('valid_from'),
            valid_to: optional('valid_to'),
            last_verified_at: optional('last_verified_at'),
            supersedes: normalizeMultiValueList(entry.supersedes, `memory_candidate_records[${index}].supersedes`),
            contradicts: normalizeMultiValueList(entry.contradicts, `memory_candidate_records[${index}].contradicts`),
        };
    });
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
        .replace(/^\s*!\[\[(.*?)\]\]\s*$/, (_match, body) => body)
        .replace(/^\s*\[\[(.*?)\]\]\s*$/, (_match, body) => body);
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
    const scannedPathByLowercase = new Map(scan.notes.map((note) => [note.relativePath.toLowerCase(), note.relativePath]));
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
            const scannedPath = scannedPathByLowercase.get(lowerPath);
            if (scannedPath && isValid(scannedPath)) {
                return scannedPath;
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
    void memoryScope;
    return {
        missing_wiki_bridge: false,
        related_wiki: dedupeAndNormalizeList(resolved),
        missing_related_wiki: dedupeAndNormalizeList(missing_related_wiki),
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
    const explicitSourceTargets = new Set();
    const sourceNote = (0, core_1.isKnowledgeSourcePath)(note.relativePath) || (note.type ?? '').toLowerCase().includes('source');
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
        const resolved = sharedEdge.matched
            ? sharedEdge.note
            : resolveSnapshotRelation(reference, allNotes);
        if (resolved)
            explicitSourceTargets.add(resolved.relativePath.toLowerCase());
        addResolvedRelation(resolved, 'frontmatter');
    };
    for (const key of ['related_wiki', 'relatedWiki', 'wiki']) {
        for (const value of relationValues(note.frontmatter[key])) {
            addFrontmatterRelation(value);
        }
    }
    for (const key of ['related_sources', 'relatedSources', 'sources']) {
        for (const value of relationValues(note.frontmatter[key])) {
            addFrontmatterRelation(value);
        }
    }
    for (const edge of note.edges) {
        if (edge.source !== 'body') {
            continue;
        }
        const resolved = edge.resolution.status === 'resolved'
            ? findSnapshotNoteByPath(edge.resolution.path, allNotes)
            : null;
        if (sourceNote && (!resolved || !explicitSourceTargets.has(resolved.relativePath.toLowerCase()))) {
            continue;
        }
        addResolvedRelation(resolved, 'body_wikilink');
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
        await (0, audit_persistence_1.appendAuditEventAsync)(vaultRoot, {
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
        await (0, audit_persistence_1.appendAuditEventAsync)(vaultRoot, {
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
        (0, core_1.renderProposalWritebackSection)(contentText(context, '## 写回内容', '## Writeback'), proposalId, writebackContent),
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
        memory_id: typeof result.memory_id === 'string' ? result.memory_id : undefined,
        claim_key: typeof result.claim_key === 'string' ? result.claim_key : undefined,
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
    const recordType = readFrontmatterString(frontmatter, ['type']);
    const commonMismatch = readFrontmatterString(frontmatter, ['project_id']) !== receipt.project_id
        || readFrontmatterString(frontmatter, ['agent_type']) !== receipt.agent_type
        || readFrontmatterString(frontmatter, ['operation_id']) !== operationId;
    const legacyMismatch = recordType === 'project_memory_entry' && (readFrontmatterString(frontmatter, ['operation_hash']) !== receipt.operation_hash
        || JSON.stringify(readFrontmatterStringList(frontmatter, 'memory_kinds').sort())
            !== JSON.stringify([...receipt.memory_kinds].sort()));
    const v2Mismatch = recordType === 'memory_record' && (!receipt.memory_id
        || !receipt.claim_key
        || readFrontmatterString(frontmatter, ['memory_id']) !== receipt.memory_id
        || readFrontmatterString(frontmatter, ['claim_key']) !== receipt.claim_key
        || `sha256:${crypto.createHash('sha256').update(content, 'utf8').digest('hex')}` !== receipt.operation_hash);
    if (commonMismatch
        || (recordType !== 'project_memory_entry' && recordType !== 'memory_record')
        || legacyMismatch
        || v2Mismatch) {
        throw new core_1.OperationConflictError('Finish-task project-memory artifact no longer matches its operation receipt.');
    }
}
async function collectFinishTaskArtifacts(vaultRoot, taskId, sessionNotePath, proposalMode, projectHint, projectId, repoPath, rawMemoryScope, relatedWiki, relatedSources, architectureStatus, closeout, memoryCandidateRecords, context, operationId, expectImmutableProjectMemory = false) {
    const candidateResults = memoryCandidateRecords.map((candidate) => ({
        ...candidate,
        authority: null,
        confidence_level: null,
        effective_state: null,
    }));
    if (proposalMode === 'off') {
        return {
            proposals: [],
            suggestedMemoryUpdates: [],
            autoAppliedMemoryUpdates: [],
            hasMissingWikiBridge: false,
            hasMissingRelatedSources: false,
            memoryCandidateRecords: candidateResults,
            memoryChanges: memoryCandidateRecords.map((_candidate, index) => ({
                source: `memory_candidate_records[${index}]`,
                change_kind: 'disabled',
            })),
        };
    }
    const groups = [];
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
            if (memoryScope === 'project' && bridgeMetadata.missing_related_sources.length > 0) {
                hasMissingRelatedSources = true;
            }
            if (memoryScope === 'project'
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
            if (!(memoryScope === 'project' && projectMemoryReceipt !== null)) {
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
    const memoryChanges = [];
    for (const [index, candidate] of memoryCandidateRecords.entries()) {
        const source = `memory_candidate_records[${index}]`;
        if (proposalMode === 'suggest') {
            suggestedMemoryUpdates.push({
                kind: candidate.proposal_kind,
                label: candidate.claim_key || candidate.proposal_kind,
                values: [candidate.content],
            });
            memoryChanges.push({ source, change_kind: 'suggested' });
            continue;
        }
        const proposalContext = context;
        const candidateProjectScope = candidate.scope === 'project'
            ? {
                project_hint: candidate.project_hint || projectHint || undefined,
                project_id: candidate.project_id || projectId || undefined,
                repo_path: candidate.repo_path || repoPath || undefined,
            }
            : {
                project_hint: undefined,
                project_id: undefined,
                repo_path: undefined,
            };
        const rawCandidate = {
            proposal_kind: candidate.proposal_kind,
            content: candidate.content,
            evidence: candidate.evidence,
            target_note: candidate.target_note || undefined,
            claim_key: candidate.claim_key || undefined,
            proposed_authority: candidate.proposed_authority || undefined,
            proposed_confidence: candidate.proposed_confidence || undefined,
            declared_state: candidate.declared_state || undefined,
            observed_at: candidate.observed_at || undefined,
            valid_from: candidate.valid_from || undefined,
            valid_to: candidate.valid_to || undefined,
            last_verified_at: candidate.last_verified_at || undefined,
            supersedes: candidate.supersedes,
            contradicts: candidate.contradicts,
            task_id: taskId,
            ...candidateProjectScope,
            memory_scope: candidate.scope,
            related_wiki: candidate.related_wiki?.length ? candidate.related_wiki : relatedWiki,
            related_sources: candidate.related_sources?.length ? candidate.related_sources : relatedSources,
            idempotency_key: `finish-task:${operationId}:memory-candidate:${index}`,
        };
        const result = await handleProposeMemory(rawCandidate, proposalContext);
        if (!(0, protocol_1.isRecord)(result)) {
            throw new core_1.OperationConflictError(`Structured finish-task memory result is invalid for candidate ${index}.`);
        }
        const resultRecord = result;
        const predictedRecord = (0, protocol_1.isRecord)(resultRecord.predicted_record)
            ? resultRecord.predicted_record
            : {};
        candidateResults[index] = {
            ...candidate,
            authority: typeof predictedRecord.authority === 'string' ? predictedRecord.authority : null,
            confidence_level: typeof predictedRecord.confidence_level === 'string' ? predictedRecord.confidence_level : null,
            effective_state: typeof resultRecord.predicted_state === 'string' ? resultRecord.predicted_state : null,
        };
        if (resultRecord.memory_rule === 'disabled' && resultRecord.persisted === false) {
            memoryChanges.push({
                source,
                change_kind: 'disabled',
                candidate_index: index,
                scope: candidate.scope,
                reason: 'memory_rule_disabled',
                previous_effective_state: null,
                next_effective_state: null,
            });
            continue;
        }
        const recordIdentity = (0, protocol_1.isRecord)(resultRecord.record_identity) ? resultRecord.record_identity : undefined;
        const transition = (0, protocol_1.isRecord)(resultRecord.proposal_transition_preview)
            ? resultRecord.proposal_transition_preview
            : undefined;
        const autoApplied = resultRecord.auto_applied === true;
        memoryChanges.push({
            source,
            change_kind: autoApplied ? 'record_written' : 'proposal_queued',
            candidate_index: index,
            scope: candidate.scope,
            ...(typeof resultRecord.review_reason === 'string'
                ? { reason: resultRecord.review_reason }
                : {}),
            ...(typeof resultRecord.proposal_id === 'string' ? { proposal_id: resultRecord.proposal_id } : {}),
            ...(recordIdentity ? { record_identity: recordIdentity } : {}),
            previous_effective_state: null,
            next_effective_state: typeof resultRecord.predicted_state === 'string' ? resultRecord.predicted_state : null,
            ...(transition ? { proposal_transition: transition } : {}),
        });
        if (resultRecord.missing_wiki_bridge === true) {
            hasMissingWikiBridge = true;
        }
        if (Array.isArray(resultRecord.missing_related_sources) && resultRecord.missing_related_sources.length > 0) {
            hasMissingRelatedSources = true;
        }
        if (autoApplied) {
            if (typeof resultRecord.path !== 'string' || typeof resultRecord.status !== 'string') {
                throw new core_1.OperationConflictError(`Structured finish-task auto-write receipt is invalid for candidate ${index}.`);
            }
            autoAppliedMemoryUpdates.push({
                kind: candidate.proposal_kind,
                path: resultRecord.path,
                status: resultRecord.status,
                ...(typeof resultRecord.operation_id === 'string' ? { operation_id: resultRecord.operation_id } : {}),
                ...(typeof resultRecord.operation_hash === 'string' ? { operation_hash: resultRecord.operation_hash } : {}),
                ...(typeof resultRecord.agent_type === 'string' ? { agent_type: resultRecord.agent_type } : {}),
                memory_kinds: [candidate.proposal_kind],
            });
            continue;
        }
        if (typeof resultRecord.proposal_id !== 'string'
            || typeof resultRecord.proposal_path !== 'string') {
            throw new core_1.OperationConflictError(`Structured finish-task proposal receipt is invalid for candidate ${index}.`);
        }
        const link = generateProposalMarkdownLink(context, resultRecord.proposal_path, sessionNotePath);
        proposals.push({
            kind: candidate.proposal_kind,
            proposalId: resultRecord.proposal_id,
            path: resultRecord.proposal_path,
            linkTarget: typeof resultRecord.proposal_link_target === 'string'
                ? resultRecord.proposal_link_target
                : resultRecord.proposal_path,
            ...(link ? { link } : {}),
        });
    }
    return {
        proposals,
        suggestedMemoryUpdates,
        autoAppliedMemoryUpdates,
        hasMissingWikiBridge,
        hasMissingRelatedSources,
        memoryCandidateRecords: candidateResults,
        memoryChanges,
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
const vaultRecordAdapter = new vault_record_adapter_1.VaultRecordAdapter({
    agentActivityPath: AGENT_ACTIVITY_PATH,
    buildMarkdownNote,
});
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
function isSourceRequestPending(status) {
    const normalized = status.toLowerCase();
    return ['pending', 'todo', 'open', 'queued', 'new'].includes(normalized);
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
async function findMemoryProposalPathById(vaultRoot, proposalId, context) {
    const normalizedId = stripYamlQuotes(proposalId);
    if (!normalizedId) {
        throw new safety_1.ToolInputError('proposal_id is required.');
    }
    const view = await knowledgeReadViewForContext(vaultRoot, context);
    const records = [...view.catalog.values()].flatMap((note) => {
        const location = (0, core_1.proposalHistoryLocation)(note.path);
        const noteProposalId = explicitProposalId(note.frontmatter);
        if (!location || !noteProposalId || !isMemoryProposalFrontmatter(note.frontmatter)) {
            return [];
        }
        return [{
                path: note.path,
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
        ? await findMemoryProposalPathById(vaultRoot, coerceOptionalString(rawArgs.proposal_id), context)
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
function readWritebackPlanEffectValue(frontmatter) {
    const keys = ['writeback_effect', 'writebackEffect'];
    const values = [];
    for (const key of keys) {
        const value = frontmatter[key];
        if (value === undefined || value === null) {
            continue;
        }
        if (typeof value !== 'string') {
            throw new safety_1.ToolInputError(`writeback_effect must be a string: ${key}`);
        }
        const normalized = stripYamlQuotes(value.trim().toLowerCase());
        if (normalized.length > 0) {
            values.push(normalized);
        }
    }
    const uniqueValues = [...new Set(values)];
    if (!values.length) {
        return null;
    }
    if (uniqueValues.length > 1) {
        throw new safety_1.ToolInputError('Proposal writeback effect fields conflict.');
    }
    return uniqueValues[0] || null;
}
function normalizeWritebackPlanEffect(effectValue) {
    const normalized = effectValue;
    if (!normalized) {
        return null;
    }
    switch (normalized) {
        case 'append':
            return 'append';
        case 'create_memory_record':
            return 'create_memory_record';
        case 'create_wiki_note':
            return CREATE_WIKI_NOTE_EFFECT;
        default:
            return null;
    }
}
function isWritebackCreationConflict(error) {
    if (error instanceof core_1.OperationConflictError) {
        return true;
    }
    if (error instanceof Error) {
        const errno = error;
        if (errno.code === 'EEXIST' || errno.code === '409') {
            return true;
        }
        const status = typeof error.statusCode === 'number'
            ? error.statusCode
            : typeof error.status === 'number'
                ? error.status
                : undefined;
        if (status === 409 || status === 412) {
            return true;
        }
        const name = error.name;
        if (typeof name === 'string' && /conflict/i.test(name)) {
            return true;
        }
    }
    return false;
}
function resolveWritebackPlanEffect(proposal, targetState) {
    const effectValue = readWritebackPlanEffectValue(proposal.frontmatter);
    const declared = normalizeWritebackPlanEffect(effectValue);
    if (declared === null && effectValue !== null) {
        throw new safety_1.ToolInputError(`Unknown writeback_effect value: ${effectValue}`);
    }
    if (declared) {
        return declared;
    }
    if (proposal.targetNote && (0, core_1.isKnowledgeWikiPath)(proposal.targetNote) && targetState === null) {
        return 'create_wiki_note';
    }
    const claimKey = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['claim_key', 'claimKey']));
    if (claimKey && (!proposal.targetNote || !(0, core_1.isKnowledgeWikiPath)(proposal.targetNote))) {
        return 'create_memory_record';
    }
    return 'append';
}
function buildWritebackPlanForTarget(proposal, targetState) {
    const writeback = (0, core_1.resolveProposalWriteback)({
        body: proposal.body,
        proposalId: proposal.proposalId,
        frontmatterContent: stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['writeback_content', 'writebackContent'])),
    });
    if (writeback.error || writeback.ambiguous) {
        return {
            proposal,
            targetNote: proposal.targetNote,
            writebackContent: writeback.content,
            ready: false,
            reason: `proposal writeback boundary is ${writeback.error || 'ambiguous'}`,
            effectKind: undefined,
        };
    }
    let writebackEffect;
    try {
        writebackEffect = resolveWritebackPlanEffect(proposal, targetState);
    }
    catch (error) {
        if (error instanceof safety_1.ToolInputError) {
            return {
                proposal,
                targetNote: proposal.targetNote,
                writebackContent: writeback.content,
                ready: false,
                reason: error.message,
                effectKind: undefined,
            };
        }
        throw error;
    }
    const writebackContent = writeback.content;
    const createsMemoryRecord = writebackEffect === 'create_memory_record';
    const createsWikiNote = writebackEffect === 'create_wiki_note';
    if (!proposal.targetNote && !createsMemoryRecord && !createsWikiNote) {
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
    if (createsWikiNote && targetState) {
        return {
            proposal,
            targetNote: proposal.targetNote,
            writebackContent,
            ready: false,
            reason: 'create_wiki_note target already exists',
            effectKind: writebackEffect,
        };
    }
    return {
        proposal,
        targetNote: proposal.targetNote,
        writebackContent,
        ready: true,
        effectKind: writebackEffect,
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
    const proposalId = proposalScalarField(frontmatter, ['proposal_id', 'proposalId'], 'Proposal id') || path.basename(proposal.path, path.extname(proposal.path));
    const frontmatterWriteback = proposalMultilineField(frontmatter, ['writeback_content', 'writebackContent'], 'Proposal writeback content');
    const rawWritebackEffect = readWritebackPlanEffectValue(frontmatter);
    const writebackEffect = normalizeWritebackPlanEffect(rawWritebackEffect);
    if (rawWritebackEffect !== null && writebackEffect === null) {
        throw new core_1.ProposalTransitionValidationError(`Unknown writeback_effect value: ${rawWritebackEffect}`);
    }
    const writeback = (0, core_1.resolveProposalWriteback)({
        body: parsed.body,
        proposalId,
        frontmatterContent: frontmatterWriteback,
    });
    if (writeback.error === 'conflicting_sources') {
        throw new core_1.ProposalTransitionConflictError('Proposal writeback sources conflict.');
    }
    if (writeback.error || writeback.ambiguous) {
        throw new core_1.ProposalTransitionValidationError(`Proposal writeback boundary is ${writeback.error || 'ambiguous'}.`);
    }
    const lastTransition = (0, core_1.proposalTransitionReceiptFromFrontmatter)(frontmatter);
    return {
        path: proposal.path,
        classification,
        proposalId,
        proposalKind: proposalKind || classification,
        taskId: proposalScalarField(frontmatter, ['task_id', 'taskId'], 'Task id'),
        status: proposalTransitionStatus(frontmatter),
        targetPath: proposalScalarField(frontmatter, ['target_note', 'targetNote', 'target_path', 'targetPath'], 'Proposal target'),
        writebackContent: writeback.content,
        writebackEffect: writebackEffect || undefined,
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
        'activityAgentId',
        'activitySessionId',
        'activityClientName',
    ];
    const hasStableProposalReferenceFlags = typeof value.taskHadProposalIdReference === 'boolean'
        && typeof value.taskHadProposalPathEvidence === 'boolean';
    const hasPartialStableProposalReferenceFlags = value.taskHadProposalIdReference !== undefined
        || value.taskHadProposalPathEvidence !== undefined;
    const hasAppliedProposalReferenceFlag = typeof value.taskHadAppliedProposalReference === 'boolean';
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
        && (value.taskHadAppliedProposalReference === undefined
            || hasAppliedProposalReferenceFlag)
        && (!hasAppliedProposalReferenceFlag || hasStableProposalReferenceFlags)
        && ((value.taskId === null
            && value.taskPath === null
            && value.taskContentHash === ''
            && value.taskLinkedContentHash === ''
            && value.taskHadTargetReference === false
            && value.taskHadProposalReference === false
            && value.taskHadProposalIdReference !== true
            && value.taskHadProposalPathEvidence !== true
            && value.taskHadAppliedProposalReference !== true)
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
        && Number.isSafeInteger(value.expiresAt)
        && (value.effectKind === undefined
            || value.effectKind === 'append'
            || value.effectKind === 'create_memory_record'
            || value.effectKind === 'create_wiki_note');
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
function buildApprovedWikiNoteWritebackBlock(proposalId, writebackContent, operationId) {
    const marker = `^writeback-${proposalId.replace(/[^A-Za-z0-9._-]/g, '-')}`;
    return {
        block: `${writebackContent.trim()}\n\n<!-- writeback operation: ${operationId} -->\n${marker}`,
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
function validateApprovedWritebackTransition(snapshot, operationId, targetPath, context, now, targetExists, targetCreationAllowed) {
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
        targetExists: (relativePath) => relativePath === targetPath && targetExists(relativePath),
        targetCreationAllowed: (relativePath) => relativePath === targetPath && targetCreationAllowed(relativePath),
    });
}
async function resolveApprovedMemoryRecordTargetPath(vaultRoot, proposal, context) {
    const scope = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['memory_scope'])).toLowerCase();
    if (!scope) {
        throw new safety_1.ToolInputError('Approved memory proposal requires an explicit memory_scope.');
    }
    const agentType = (0, core_1.normalizeProjectAgentType)(context.observedClientType ?? context.clientName ?? 'custom');
    const safeProposalId = proposal.proposalId
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
    if (!safeProposalId) {
        throw new safety_1.ToolInputError('Approved memory proposal id cannot form a record path.');
    }
    if (scope === 'global') {
        if (proposal.targetNote) {
            const explicit = (0, safety_1.normalizeNotePath)(proposal.targetNote, pathSafetyOptions(context));
            if (!isCanonicalMemoryAgentTarget(explicit, `${core_1.KNOWLEDGE_GLOBAL_MEMORY_DIR}/agents/`)) {
                throw new safety_1.ToolInputError('Approved Global MemoryRecord target must use the canonical Global agent namespace.');
            }
            return explicit;
        }
        return `${core_1.KNOWLEDGE_GLOBAL_MEMORY_DIR}/agents/${agentType}/approved-${safeProposalId}.md`;
    }
    if (scope !== 'project') {
        throw new safety_1.ToolInputError('Approved memory proposal scope must be global or project.');
    }
    const projectId = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['project_id']));
    if (!projectId) {
        if (readFrontmatterString(proposal.frontmatter, ['repo_path'])) {
            throw new safety_1.ToolInputError('Approved project memory proposal is not writeback-ready because its canonical Project Hub does not exist; resubmit under Project Auto with the exact repo_path or wait for a confirmed structure-write flow.');
        }
        throw new safety_1.ToolInputError('Approved project memory proposal requires project_id.');
    }
    const snapshot = await projectMemoryApplication(vaultRoot, context).snapshot();
    const route = (0, project_memory_1.resolveProjectMemoryWritableRoute)(snapshot, { projectId });
    if (route.status !== 'existing') {
        if (route.status === 'review_required'
            && route.reason === 'explicit_project_id_not_found') {
            throw new safety_1.ToolInputError('Legacy approved project memory proposal has no exact Project Hub; resubmit under Project Auto with the exact repo_path.');
        }
        throw new safety_1.ToolInputError('Approved project memory proposal has no exact project Hub.');
    }
    const projectAgentsRoot = `${path.posix.dirname(route.binding.project_hub)}/agents/`;
    if (proposal.targetNote) {
        const explicit = (0, safety_1.normalizeNotePath)(proposal.targetNote, pathSafetyOptions(context));
        if (!isCanonicalMemoryAgentTarget(explicit, projectAgentsRoot)) {
            throw new safety_1.ToolInputError('Approved Project MemoryRecord target must use the exact project Hub agent namespace.');
        }
        return explicit;
    }
    return `${projectAgentsRoot}${agentType}/approved-${safeProposalId}.md`;
}
function isCanonicalMemoryAgentTarget(targetPath, agentsRoot) {
    if (!targetPath.startsWith(agentsRoot))
        return false;
    const segments = targetPath.slice(agentsRoot.length).split('/');
    if (segments.length !== 2)
        return false;
    const [agentType, filename] = segments;
    return Boolean(agentType)
        && agentType === (0, core_1.normalizeProjectAgentType)(agentType)
        && /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(filename);
}
function memoryAgentTypeFromTarget(targetPath) {
    const segments = targetPath.split('/');
    const agentsIndex = segments.lastIndexOf('agents');
    const agentType = agentsIndex >= 0 ? segments[agentsIndex + 1] : '';
    if (!agentType || agentType !== (0, core_1.normalizeProjectAgentType)(agentType)) {
        throw new safety_1.ToolInputError('Approved MemoryRecord target has an invalid Agent namespace.');
    }
    return agentType;
}
function memoryRecordReferencePath(reference) {
    if (!reference)
        return null;
    const candidate = normalizeWikilinkOrSourceValue(reference).replace(/#.*$/, '');
    return candidate.toLowerCase().endsWith('.md') ? candidate : `${candidate}.md`;
}
function buildApprovedMemoryRecordMarkdown(vaultRoot, proposal, targetPath, operationId, context) {
    const scopeValue = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['memory_scope'])).toLowerCase();
    if (!scopeValue) {
        throw new safety_1.ToolInputError('Approved memory proposal requires an explicit memory_scope.');
    }
    if (scopeValue !== 'global' && scopeValue !== 'project') {
        throw new safety_1.ToolInputError('Approved memory proposal scope is invalid.');
    }
    const scope = scopeValue;
    const projectId = scope === 'project'
        ? stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['project_id']))
        : '';
    const claimKey = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['claim_key']));
    if (!claimKey || (scope === 'project' && !projectId)) {
        throw new safety_1.ToolInputError('Approved memory proposal is missing its governed identity.');
    }
    const relatedWiki = readFrontmatterStringList(proposal.frontmatter, 'related_wiki');
    const relatedSources = readFrontmatterStringList(proposal.frontmatter, 'related_sources');
    const evidence = [...new Set([...relatedSources, ...relatedWiki])];
    const proposedAuthority = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['proposed_authority'])).toLowerCase();
    const proposedConfidence = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['proposed_confidence'])).toLowerCase();
    const governance = (0, core_1.deriveMemoryGovernance)({
        proposed_authority: proposedAuthority === 'user' || proposedAuthority === 'source'
            ? proposedAuthority
            : 'agent',
        proposed_confidence: (proposedConfidence === 'verified'
            || proposedConfidence === 'supported'
            || proposedConfidence === 'inferred'
            || proposedConfidence === 'uncertain') ? proposedConfidence : 'uncertain',
        evidence_count: evidence.length,
        human_approved: proposedAuthority === 'user',
        source_backed: relatedSources.length > 0,
    });
    const declaredValue = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['declared_state'])).toLowerCase();
    const declaredState = ['active', 'disputed', 'retracted', 'review'].includes(declaredValue)
        ? declaredValue
        : 'active';
    const projectHub = scope === 'project'
        ? `${path.posix.dirname(path.posix.dirname(path.posix.dirname(targetPath)))}/index.md`
        : null;
    const memoryId = `memory-${crypto.createHash('sha256')
        .update(`${proposal.proposalId}\0${claimKey}`, 'utf8')
        .digest('hex')
        .slice(0, 32)}`;
    const repository = projectMemoryRepository(vaultRoot, context);
    const memoryLink = (target) => repository.generateMarkdownLink
        ? repository.generateMarkdownLink(target, targetPath)
        : `[[${target.replace(/\.md$/i, '')}]]`;
    const relations = [
        ...(projectHub ? [`- Project hub: ${memoryLink(projectHub)}`] : []),
        ...(scope === 'global' ? [`- Global hub: ${memoryLink(core_1.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH)}`] : []),
        ...relatedWiki.map((target) => `- Wiki: ${memoryLink(target)}`),
        ...relatedSources.map((target) => `- Source: ${memoryLink(target)}`),
    ];
    return (0, core_1.buildMemoryRecord)({
        path: targetPath,
        memory_id: memoryId,
        scope,
        project_id: scope === 'project' ? projectId : null,
        agent_type: memoryAgentTypeFromTarget(targetPath),
        operation_id: operationId,
        memory_kind: proposal.proposalKind.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase().slice(0, 64),
        claim_key: claimKey,
        authority: governance.authority,
        confidence_level: governance.confidence_level,
        declared_state: declaredState,
        observed_at: readFrontmatterString(proposal.frontmatter, ['observed_at']) || new Date().toISOString(),
        valid_from: readFrontmatterString(proposal.frontmatter, ['valid_from']) || null,
        valid_to: readFrontmatterString(proposal.frontmatter, ['valid_to']) || null,
        last_verified_at: readFrontmatterString(proposal.frontmatter, ['last_verified_at']) || null,
        evidence,
        supersedes: readFrontmatterStringList(proposal.frontmatter, 'supersedes'),
        contradicts: readFrontmatterStringList(proposal.frontmatter, 'contradicts'),
        project_hub: projectHub,
        global_hub: scope === 'global' ? core_1.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH : null,
        related_wiki: relatedWiki,
        related_sources: relatedSources,
        body: ['# Approved memory record', '', '## Relations', '', ...relations, '', '## Memory', '', proposalTransitionSnapshot(proposal).writebackContent].join('\n'),
    }).markdown;
}
async function prepareWritebackConfirmation(vaultRoot, proposal, plan, taskId, context, issuedAt, expiresAt, previewNonce = crypto.randomBytes(16).toString('hex')) {
    if (!plan.ready || !plan.writebackContent) {
        throw new safety_1.ToolInputError(plan.reason || 'approved writeback is not ready to apply.');
    }
    const snapshot = proposalTransitionSnapshot(proposal);
    if (snapshot.status !== 'approved') {
        throw new safety_1.ToolInputError(`proposal approval_status/status is ${snapshot.status}`);
    }
    const targetPath = (0, safety_1.normalizeNotePath)(plan.effectKind === 'create_memory_record'
        ? await resolveApprovedMemoryRecordTargetPath(vaultRoot, proposal, context)
        : plan.targetNote, pathSafetyOptions(context));
    assertAllowedWritebackTarget(targetPath);
    const target = await readCurrentVaultTextState(vaultRoot, targetPath, context);
    if (!target && !plan.effectKind) {
        throw new safety_1.ToolInputError('Writeback effect is missing from proposal plan.');
    }
    if (plan.effectKind === CREATE_WIKI_NOTE_EFFECT) {
        if (target) {
            throw new safety_1.ToolInputError('Create wiki note writeback requires a missing target.');
        }
        if (!(0, core_1.isKnowledgeWikiPath)(targetPath)) {
            throw new safety_1.ToolInputError(`Create wiki note writeback requires a wiki target: ${targetPath}`);
        }
    }
    else if (!target && plan.effectKind !== 'create_memory_record') {
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
    const taskHadAppliedProposalReference = task
        ? readFrontmatterStringList(taskFrontmatter, 'durable_output_applied_proposal_ids').includes(proposal.proposalId)
        : false;
    const taskHadProposalReference = taskHadProposalIdReference;
    const taskLinkedContent = task && (!taskHadTargetReference
        || !taskHadProposalIdReference
        || !taskHadProposalPathEvidence
        || !taskHadAppliedProposalReference)
        ? updateFrontmatterFields(task.content, {
            memory_writes: mergeFrontmatterList(taskFrontmatter, 'memory_writes', [targetPath]),
            proposal_ids: mergeFrontmatterList(taskFrontmatter, 'proposal_ids', [proposal.proposalId]),
            proposal_paths: mergeFrontmatterList(taskFrontmatter, 'proposal_paths', [proposal.path]),
            durable_output_applied_proposal_ids: mergeFrontmatterList(taskFrontmatter, 'durable_output_applied_proposal_ids', [proposal.proposalId]),
        })
        : task?.content || '';
    const proposalRevision = (0, core_1.computeProposalRevision)(snapshot);
    const identity = buildApprovedWritebackOperationIdentity(proposal, proposalRevision, previewNonce);
    const createsMemoryRecord = plan.effectKind === 'create_memory_record';
    const createsWikiNote = plan.effectKind === CREATE_WIKI_NOTE_EFFECT;
    const claimKey = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['claim_key', 'claimKey']));
    validateApprovedWritebackTransition(snapshot, identity.operationId, targetPath, context, new Date(issuedAt).toISOString(), (relativePath) => {
        if (relativePath !== targetPath) {
            return false;
        }
        if (plan.effectKind === 'create_memory_record'
            || plan.effectKind === CREATE_WIKI_NOTE_EFFECT) {
            return false;
        }
        return Boolean(target);
    }, (relativePath) => relativePath === targetPath
        && (createsWikiNote || (createsMemoryRecord && Boolean(claimKey))));
    const writeback = plan.effectKind === 'create_memory_record'
        ? {
            block: buildApprovedMemoryRecordMarkdown(vaultRoot, proposal, targetPath, identity.operationId, context),
            marker: `memory-record:${snapshot.proposalId}`,
        }
        : plan.effectKind === CREATE_WIKI_NOTE_EFFECT
            ? buildApprovedWikiNoteWritebackBlock(snapshot.proposalId, snapshot.writebackContent, identity.operationId)
            : buildApprovedWritebackBlock(snapshot.proposalId, snapshot.writebackContent);
    const touchedNotes = [
        targetPath,
        proposal.path,
        ...(taskPath ? [taskPath] : []),
        AGENT_ACTIVITY_PATH,
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
            targetContentHash: target?.contentHash || 'absent',
            proposalTaskId: snapshot.taskId,
            taskId,
            taskPath,
            taskContentHash: task?.contentHash || '',
            taskLinkedContentHash: task ? hashText(taskLinkedContent) : '',
            taskHadTargetReference,
            taskHadProposalReference,
            taskHadProposalIdReference,
            taskHadProposalPathEvidence,
            taskHadAppliedProposalReference,
            writebackContentHash: hashText(snapshot.writebackContent),
            writebackBlockHash: hashText(writeback.block),
            writebackMarker: writeback.marker,
            touchedNotes,
            activityAgentId: context.agentId || 'unknown session id',
            activitySessionId: context.sessionId || '',
            activityClientName: context.clientName || '',
            effectKind: plan.effectKind ?? 'append',
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
                ...(typeof binding.taskHadAppliedProposalReference === 'boolean'
                    ? {
                        taskHadAppliedProposalReference: binding.taskHadAppliedProposalReference,
                    }
                    : {}),
            }
            : {}),
        writebackContentHash: binding.writebackContentHash,
        writebackBlockHash: binding.writebackBlockHash,
        writebackMarker: binding.writebackMarker,
        touchedNotes: binding.touchedNotes.slice(),
        confirmationTokenHash: hashText(confirmationToken),
        confirmationExpiresAt: new Date(binding.expiresAt).toISOString(),
        activityPath: AGENT_ACTIVITY_PATH,
        activityAgentId: binding.activityAgentId,
        activitySessionId: binding.activitySessionId,
        activityClientName: binding.activityClientName,
        ...(binding.effectKind ? { effectKind: binding.effectKind } : {}),
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
        'activityPath',
        'activityAgentId',
        'activitySessionId',
        'activityClientName',
    ];
    const hasStableProposalReferenceFlags = typeof value.taskHadProposalIdReference === 'boolean'
        && typeof value.taskHadProposalPathEvidence === 'boolean';
    const hasPartialStableProposalReferenceFlags = value.taskHadProposalIdReference !== undefined
        || value.taskHadProposalPathEvidence !== undefined;
    const hasAppliedProposalReferenceFlag = typeof value.taskHadAppliedProposalReference === 'boolean';
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
        && value.activityPath.length > 0
        && !Number.isNaN(Date.parse(value.confirmationExpiresAt))
        && (value.taskId === null || typeof value.taskId === 'string')
        && (value.taskId === null || value.taskId.length <= 512)
        && (value.taskPath === null || typeof value.taskPath === 'string')
        && (value.taskPath === null || value.taskPath.length <= 2048)
        && typeof value.taskHadTargetReference === 'boolean'
        && typeof value.taskHadProposalReference === 'boolean'
        && (!hasPartialStableProposalReferenceFlags || hasStableProposalReferenceFlags)
        && (value.taskHadAppliedProposalReference === undefined
            || hasAppliedProposalReferenceFlag)
        && (!hasAppliedProposalReferenceFlag || hasStableProposalReferenceFlags)
        && ((value.taskId === null
            && value.taskPath === null
            && value.taskContentHash === ''
            && value.taskLinkedContentHash === ''
            && value.taskHadTargetReference === false
            && value.taskHadProposalReference === false
            && value.taskHadProposalIdReference !== true
            && value.taskHadProposalPathEvidence !== true
            && value.taskHadAppliedProposalReference !== true)
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
        && new Set(value.touchedNotes).size === value.touchedNotes.length
        && (value.effectKind === undefined
            || value.effectKind === 'append'
            || value.effectKind === 'create_memory_record'
            || value.effectKind === 'create_wiki_note');
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
            // Best-effort cleanup must preserve the original write failure.
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
function buildCatalogCounts(entries) {
    const typeCount = {};
    for (const entry of entries) {
        const type = entry.type ?? 'note';
        typeCount[type] = (typeCount[type] ?? 0) + 1;
    }
    return Object.entries(typeCount)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([type, count]) => ({ type, count }));
}
function materializeLightweightNotes(view) {
    const edgesBySource = new Map();
    for (const edge of [...view.graph.edges, ...view.graph.unresolvedEdges]) {
        const sourcePath = edge.sourcePath ?? '';
        if (!sourcePath)
            continue;
        const current = edgesBySource.get(sourcePath) ?? [];
        edgesBySource.set(sourcePath, [...current, edge]);
    }
    return [...view.catalog.values()].map((entry) => {
        const edges = [...(edgesBySource.get(entry.path) ?? [])];
        return {
            schemaVersion: '1.0',
            path: entry.path,
            absolutePath: entry.path,
            relativePath: entry.path,
            exists: true,
            title: entry.title,
            aliases: [...entry.aliases],
            type: entry.type ?? undefined,
            tags: [...entry.tags],
            frontmatter: { ...entry.frontmatter },
            semanticErrors: [],
            headings: [],
            blockIds: [],
            sections: [],
            callouts: [],
            edges,
            wikilinks: edges,
            claimBlocks: [],
            evidenceBlocks: [],
            tokens: entry.searchTokens.join(' '),
            text: '',
            content: '',
            contentHash: entry.contentHash,
            modifiedAt: entry.modifiedAt,
            size: entry.size,
        };
    });
}
function lightweightScanFromReadView(vaultRoot, view) {
    return {
        vaultRoot,
        scannedAt: view.createdAt,
        notes: materializeLightweightNotes(view),
        errors: view.errors.map((error) => ({ ...error })),
        index: {
            index_state: view.index_state,
            generation: view.generation,
            event_sequence: view.event_sequence,
            last_rebuild: null,
        },
    };
}
function contextPackFromReadViewRecall(vaultRoot, query, result, view, staleAfterDays) {
    const matches = 'matches' in result ? result.matches : result.entries;
    const staleCutoff = Date.now() - staleAfterDays * 86400000;
    const sourceCandidates = matches
        .filter((match) => (0, core_1.isKnowledgeSourcePath)(match.path) || match.note_type?.includes('source'))
        .map((match) => ({ note: match.path, reason: `type=${match.note_type ?? 'source'}` }));
    const staleWarnings = matches
        .filter((match) => Date.parse(view.catalog.get(match.path)?.modifiedAt ?? '') < staleCutoff)
        .map((match) => `${match.path} has not changed in ${staleAfterDays}+ days.`);
    return {
        query,
        generatedAt: new Date().toISOString(),
        relevantNotes: matches.map((match) => ({
            relativePath: match.path,
            score: match.score,
            matchedTokens: [...match.matched_tokens],
            type: match.note_type ?? undefined,
            title: match.title,
        })),
        sourceCandidates,
        evidenceCandidates: [],
        gaps: ['Evidence blocks require an explicit targeted note read.'],
        staleWarnings: staleWarnings.length > 0 ? staleWarnings : ['No stale notes found in top matches.'],
        suggestedWritebackTargets: [
            core_1.TRACEKEEPER_CONTEXT_PACKS_DIR,
            core_1.TRACEKEEPER_REVIEW_QUEUE_DIR,
            core_1.KNOWLEDGE_SOURCES_DIR,
            core_1.TRACEKEEPER_SESSIONS_DIR,
        ].map((entry) => path.join(vaultRoot, entry)),
        scanErrors: view.errors.map((error) => ({ ...error })),
    };
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
async function buildAndWriteNoteAsync(vaultRoot, toolName, allowedDir, filename, frontmatter, body, taskId, context, metadata = {}, operationId = '') {
    return vaultRecordAdapter.buildAndWriteNoteAsync(vaultRoot, toolName, allowedDir, filename, frontmatter, body, taskId, context, metadata, operationId);
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
            const audit = (0, audit_persistence_1.appendAuditEvent)(vaultRoot, {
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
                activity_path: audit.path,
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
    const audit = (0, audit_persistence_1.appendAuditEvent)(vaultRoot, {
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
        activity_path: audit.path,
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
            const audit = await (0, audit_persistence_1.appendAuditEventAsync)(vaultRoot, {
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
                activity_path: audit.path,
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
    const audit = await (0, audit_persistence_1.appendAuditEventAsync)(vaultRoot, {
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
        activity_path: audit.path,
        status: 'written',
        warnings: [],
        duplicate: false,
    };
}
async function writeImmutableMemoryRecord(vaultRoot, input) {
    if (input.proposedAuthority === 'user') {
        return {
            status: 'review_required',
            reason: 'user_authority_requires_human_review',
            warnings: ['Agent-originated memory cannot self-assign user authority.'],
        };
    }
    if (input.declaredState && input.declaredState !== 'active') {
        return {
            status: 'review_required',
            reason: 'lifecycle_transition_requires_human_review',
            warnings: ['Dispute, retraction, and review-state transitions require human review.'],
        };
    }
    if ((input.supersedes?.length ?? 0) > 0 || (input.contradicts?.length ?? 0) > 0) {
        return {
            status: 'review_required',
            reason: 'lifecycle_transition_requires_human_review',
            warnings: ['Supersession and contradiction transitions require human review.'],
        };
    }
    const agentType = (0, core_1.normalizeProjectAgentType)(input.agentType);
    const memoryKind = input.memoryKinds.length === 1 ? input.memoryKinds[0] : 'task_closeout';
    const contentIdentity = crypto.createHash('sha256')
        .update(input.body.replace(/\s+/g, ' ').trim(), 'utf8')
        .digest('hex');
    const claimKey = input.claimKey?.trim()
        || `${memoryKind}:${contentIdentity.slice(0, 32)}`;
    const memoryId = `memory-${crypto.createHash('sha256')
        .update(`${input.operationId}\0${claimKey}\0${memoryKind}`, 'utf8')
        .digest('hex')
        .slice(0, 32)}`;
    const evidence = [...new Set([...input.relatedSources, ...input.relatedWiki])];
    const hasVerifiedSourceEvidence = input.relatedSources.length > 0;
    const governance = (0, core_1.deriveMemoryGovernance)({
        proposed_authority: input.proposedAuthority,
        proposed_confidence: input.proposedConfidence,
        evidence_count: new Set([...input.relatedSources, ...input.relatedWiki]).size,
        source_backed: hasVerifiedSourceEvidence,
    });
    if (governance.authority === 'user' || governance.confidence_level === 'verified') {
        throw new Error('Automatic MemoryRecord governance returned a human-only elevation.');
    }
    const authority = governance.authority;
    const confidenceLevel = governance.confidence_level;
    const repository = projectMemoryRepository(vaultRoot, input.context);
    let canonicalProjectId = null;
    if (input.scope === 'project') {
        const preLockSnapshot = await projectMemoryApplication(vaultRoot, input.context).snapshot();
        const preLockRoute = (0, project_memory_1.resolveProjectMemoryWritableRoute)(preLockSnapshot, {
            projectId: input.projectId,
            projectHint: input.projectHint,
            repoPath: input.repoPath,
        });
        if (preLockRoute.status === 'review_required')
            return preLockRoute;
        canonicalProjectId = preLockRoute.binding.project_id;
    }
    const claimLockKey = memoryClaimLockKey(input.scope, canonicalProjectId, claimKey);
    const release = await operationJournalForVault(vaultRoot).acquireLock(claimLockKey);
    try {
        let projectId = null;
        let projectHub = null;
        let globalHub = null;
        let projectKey = '';
        let hubStatus = 'existing';
        if (input.scope === 'global') {
            const hub = await readCanonicalMemoryHub(repository, core_1.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH);
            if (!hub) {
                return missingMemoryHubReview(core_1.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH);
            }
            globalHub = core_1.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH;
        }
        else {
            const resolution = await projectMemoryApplication(vaultRoot, input.context).ensureWritableProject({
                projectId: input.projectId,
                projectHint: input.projectHint,
                repoPath: input.repoPath,
            });
            if (resolution.status === 'review_required')
                return resolution;
            if (resolution.binding.project_id !== canonicalProjectId) {
                return {
                    status: 'review_required',
                    reason: 'conflicting_project_identity',
                    warnings: ['Project identity changed while acquiring the MemoryRecord claim lock.'],
                };
            }
            projectId = resolution.binding.project_id;
            projectHub = resolution.binding.project_hub;
            projectKey = resolution.binding.project_key;
            hubStatus = resolution.hub_status;
        }
        const entryPath = input.scope === 'global'
            ? (0, core_1.buildGlobalMemoryEntryPath)({
                agentType,
                operationKind: input.operationKind,
                operationId: input.operationId,
            })
            : (0, core_1.buildProjectMemoryEntryPath)({
                projectKey,
                agentType,
                operationKind: input.operationKind,
                operationId: input.operationId,
            });
        const currentView = await freshKnowledgeReadViewForContext(vaultRoot, input.context);
        const relevantInvalidRecord = currentView.memory.invalidPaths.some((invalidPath) => {
            if (invalidPath === entryPath)
                return true;
            const frontmatter = currentView.catalog.get(invalidPath)?.frontmatter;
            if (!frontmatter)
                return false;
            return frontmatter.type === 'memory_record'
                && frontmatter.scope === input.scope
                && (frontmatter.project_id ?? null) === projectId
                && frontmatter.claim_key === claimKey;
        });
        if (relevantInvalidRecord) {
            return {
                status: 'review_required',
                reason: 'memory_snapshot_incomplete',
                warnings: ['MemoryRecord lifecycle data is invalid or incomplete; repair the structure before automatic writeback.'],
            };
        }
        const sameClaim = (row) => row.record.scope === input.scope
            && row.record.project_id === projectId
            && row.record.claim_key === claimKey
            && row.record.memory_id !== memoryId;
        if (currentView.memory.lifecycle.current.some(sameClaim)
            || currentView.memory.lifecycle.conflicts.some(sameClaim)) {
            return {
                status: 'review_required',
                reason: 'unresolved_claim_conflict',
                warnings: ['A current or conflicted MemoryRecord already exists for this claim; a reviewed lifecycle transition is required.'],
            };
        }
        const memoryLink = (target) => repository.generateMarkdownLink
            ? repository.generateMarkdownLink(target, entryPath)
            : `[[${target.replace(/\.md$/i, '')}]]`;
        const relationLines = [
            ...(projectHub ? [`- Project hub: ${memoryLink(projectHub)}`] : []),
            ...(globalHub ? [`- Global hub: ${memoryLink(globalHub)}`] : []),
            ...input.relatedWiki.map((target) => `- Wiki: ${memoryLink(target)}`),
            ...input.relatedSources.map((target) => `- Source: ${memoryLink(target)}`),
        ];
        const built = (0, core_1.buildMemoryRecord)({
            path: entryPath,
            memory_id: memoryId,
            scope: input.scope,
            project_id: projectId,
            agent_type: agentType,
            operation_id: input.operationId,
            memory_kind: memoryKind,
            claim_key: claimKey,
            authority,
            confidence_level: confidenceLevel,
            declared_state: 'active',
            observed_at: input.observedAt ?? input.createdAt,
            valid_from: input.validFrom ?? null,
            valid_to: input.validTo ?? null,
            last_verified_at: input.lastVerifiedAt ?? null,
            evidence,
            supersedes: [],
            contradicts: [],
            project_hub: projectHub,
            global_hub: globalHub,
            related_wiki: input.relatedWiki,
            related_sources: input.relatedSources,
            body: [
                `# ${input.scope === 'global' ? 'Global' : 'Project'} memory record`,
                '',
                '## Relations',
                '',
                ...relationLines,
                '',
                '## Memory',
                '',
                input.body,
            ].join('\n'),
        });
        let status = 'created';
        try {
            await repository.createText(entryPath, built.markdown);
        }
        catch (error) {
            if (!(error instanceof core_1.OperationConflictError))
                throw error;
            const existing = await repository.readText(entryPath);
            if (existing?.content !== built.markdown)
                throw error;
            status = 'exact_retry';
        }
        const duplicate = status === 'exact_retry';
        const operationHash = `sha256:${crypto.createHash('sha256').update(built.markdown, 'utf8').digest('hex')}`;
        const audit = await (0, audit_persistence_1.appendAuditEventAsync)(vaultRoot, {
            tool: input.toolName,
            targetPath: entryPath,
            status: duplicate ? 'skipped' : 'written',
            operationId: input.operationId,
            taskId: input.taskId,
            metadata: {
                action: duplicate
                    ? 'memory_record.immutable_write.exact_retry'
                    : 'memory_record.immutable_write.created',
                memory_scope: input.scope,
                project_id: projectId,
                project_hub: projectHub,
                global_hub: globalHub,
                agent_type: agentType,
                operation_kind: input.operationKind,
                memory_kinds: input.memoryKinds,
                memory_id: memoryId,
                claim_key: claimKey,
                operation_hash: operationHash,
                hub_status: hubStatus,
            },
        }, input.context);
        return {
            status,
            path: entryPath,
            project_id: projectId,
            project_hub: projectHub,
            global_hub: globalHub,
            agent_type: agentType,
            operation_id: input.operationId,
            operation_kind: input.operationKind,
            memory_kinds: input.memoryKinds,
            operation_hash: operationHash,
            hub_status: hubStatus,
            memory_id: memoryId,
            claim_key: claimKey,
            authority,
            confidence_level: confidenceLevel,
            effective_state: 'current',
            activity_path: audit.path,
            write_status: duplicate ? 'skipped' : 'written',
            duplicate,
        };
    }
    finally {
        await release();
    }
}
function missingMemoryHubReview(hubPath) {
    return {
        status: 'review_required',
        reason: 'missing_memory_hub',
        warnings: [
            `structure_repair_required: canonical Memory Hub is missing or invalid at ${hubPath}.`,
        ],
    };
}
async function readCanonicalMemoryHub(repository, hubPath) {
    try {
        return await repository.readText(hubPath);
    }
    catch (error) {
        if (error instanceof core_1.VaultPathError
            && error.message.startsWith('Vault path is not a file:')) {
            return null;
        }
        throw error;
    }
}
function memoryClaimLockKey(scope, projectId, claimKey) {
    return `memory-claim-v2:${scope}:${crypto.createHash('sha256')
        .update(`${projectId ?? ''}\0${claimKey}`, 'utf8')
        .digest('hex')}`;
}
async function writeImmutableProjectMemory(vaultRoot, input) {
    const result = await writeImmutableMemoryRecord(vaultRoot, { ...input, scope: 'project' });
    if (result.status === 'review_required')
        return result;
    if (!result.project_id || !result.project_hub || result.global_hub !== null) {
        throw new Error('Project MemoryRecord writer returned an invalid scope binding.');
    }
    return {
        ...result,
        project_id: result.project_id,
        project_hub: result.project_hub,
        global_hub: null,
    };
}
async function findOperationOwnedNoteAsync(vaultRoot, allowedDir, filename, operationField, operationId, context) {
    return vaultRecordAdapter.findOperationOwnedNoteAsync(vaultRoot, allowedDir, filename, operationField, operationId, context);
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
        objective: '',
        startOperationId: '',
        trackingMode: '',
        taskRecordOrigin: '',
        startedAt: '',
        startedAtSource: 'unknown',
        trackingStartedAt: '',
        recordedAt: '',
        proposalIds: [],
        proposalPaths: [],
        sourceCaptures: [],
    };
}
function agentTaskMetadataFromFrontmatter(frontmatter) {
    const source = readFrontmatterString(frontmatter, ['project_identity_source']);
    const confidence = readFrontmatterString(frontmatter, ['project_identity_confidence']);
    const trackingMode = stripYamlQuotes(readFrontmatterString(frontmatter, ['tracking_mode']));
    const taskRecordOrigin = stripYamlQuotes(readFrontmatterString(frontmatter, ['task_record_origin']));
    const startedAtSource = stripYamlQuotes(readFrontmatterString(frontmatter, ['started_at_source']));
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
        objective: readFrontmatterString(frontmatter, ['objective']),
        startOperationId: stripYamlQuotes(readFrontmatterString(frontmatter, ['start_operation_id'])),
        trackingMode: trackingMode === 'live' || trackingMode === 'closeout_only' ? trackingMode : '',
        taskRecordOrigin: [
            'start_task',
            'finish_task_closeout_only',
            'finish_task_reconstruction',
        ].includes(taskRecordOrigin) ? taskRecordOrigin : '',
        startedAt: stripYamlQuotes(readFrontmatterString(frontmatter, ['started_at'])),
        startedAtSource: ['server_observed', 'client_claim'].includes(startedAtSource)
            ? startedAtSource
            : 'unknown',
        trackingStartedAt: stripYamlQuotes(readFrontmatterString(frontmatter, ['tracking_started_at'])),
        recordedAt: stripYamlQuotes(readFrontmatterString(frontmatter, ['recorded_at'])),
        proposalIds: readFrontmatterStringList(frontmatter, 'proposal_ids'),
        proposalPaths: readFrontmatterStringList(frontmatter, 'proposal_paths'),
        sourceCaptures: readFrontmatterStringList(frontmatter, 'source_captures'),
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
function durableProposalStatusFromApproval(status) {
    switch (status.trim().toLowerCase().replace(/[\s-]+/g, '_')) {
        case 'pending':
        case 'pending_review':
            return 'pending_review';
        case 'approved':
        case 'ready_to_apply':
            return 'ready_to_apply';
        case 'revision_requested':
            return 'revision_requested';
        case 'applied':
            return 'applied';
        case 'rejected':
            return 'rejected';
        default:
            return 'unresolved';
    }
}
function normalizedTaskSourceCaptures(values, context) {
    const captures = new Set();
    for (const value of values) {
        try {
            const normalized = (0, safety_1.normalizeNotePath)(value, pathSafetyOptions(context));
            if ((0, core_1.isKnowledgeSourcePath)(normalized)) {
                captures.add(normalized);
            }
        }
        catch {
            // Invalid source metadata is omitted from the normalized capture list.
        }
    }
    return [...captures];
}
function unresolvedDurableProposalSnapshot(proposalId, proposalPath) {
    return {
        proposalId,
        path: proposalPath,
        proposalKind: '',
        targetPath: '',
        status: 'unresolved',
        exact: false,
    };
}
async function snapshotExactTaskProposal(vaultRoot, taskId, proposalId, rawPath, context, expectedStatus) {
    let proposalPath = '';
    try {
        const normalized = (0, safety_1.normalizeNotePath)(rawPath, pathSafetyOptions(context));
        if (normalized.startsWith(`${REVIEW_QUEUE_PREFIX}/`)) {
            proposalPath = normalized;
        }
    }
    catch {
        // Invalid proposal paths remain unresolved for safe degradation.
    }
    if (!proposalId || !proposalPath) {
        return unresolvedDurableProposalSnapshot(proposalId, proposalPath);
    }
    try {
        const text = await readVaultNoteContent(vaultRoot, proposalPath, context);
        if (text === null) {
            return unresolvedDurableProposalSnapshot(proposalId, proposalPath);
        }
        const document = memoryProposalDocumentFromText(vaultRoot, proposalPath, text, context);
        const explicitProposalId = stripYamlQuotes(readFrontmatterString(document.frontmatter, ['proposal_id', 'proposalId']));
        if (!explicitProposalId
            || explicitProposalId !== proposalId
            || document.taskId !== taskId) {
            return unresolvedDurableProposalSnapshot(proposalId, proposalPath);
        }
        const rawTargetPath = document.targetNote.trim();
        let targetPath = '';
        if (rawTargetPath && (0, core_1.isAllowedProposalTargetPath)(rawTargetPath)) {
            try {
                targetPath = (0, safety_1.normalizeNotePath)(rawTargetPath, pathSafetyOptions(context));
            }
            catch {
                targetPath = '';
            }
        }
        const approvalStatus = stripYamlQuotes(readFrontmatterString(document.frontmatter, ['approval_status', 'approvalStatus', 'status']));
        const durableStatus = expectedStatus ?? (approvalStatus
            ? durableProposalStatusFromApproval(approvalStatus)
            : 'unresolved');
        return {
            proposalId,
            path: proposalPath,
            proposalKind: document.proposalKind,
            targetPath,
            status: targetPath
                ? durableStatus
                : !rawTargetPath && durableStatus === 'pending_review'
                    ? 'pending_review'
                    : 'unresolved',
            exact: true,
        };
    }
    catch {
        return unresolvedDurableProposalSnapshot(proposalId, proposalPath);
    }
}
async function snapshotTaskDurableOutput(vaultRoot, taskId, metadata, context) {
    const proposals = [];
    const seenPairs = new Set();
    const pairCount = Math.max(metadata.proposalIds.length, metadata.proposalPaths.length);
    for (let index = 0; index < pairCount; index += 1) {
        const proposalId = metadata.proposalIds[index]?.trim() || '';
        const rawPath = metadata.proposalPaths[index]?.trim() || '';
        const pairKey = `${proposalId}\0${rawPath}`;
        if (seenPairs.has(pairKey)) {
            continue;
        }
        seenPairs.add(pairKey);
        proposals.push(await snapshotExactTaskProposal(vaultRoot, taskId, proposalId, rawPath, context));
    }
    return {
        sourceCapturePaths: normalizedTaskSourceCaptures(metadata.sourceCaptures, context),
        proposals,
    };
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
            || payload.taskHadProposalPathEvidence === true
            || payload.taskHadAppliedProposalReference === true) {
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
    const usesAppliedProposalEvidence = typeof payload.taskHadAppliedProposalReference === 'boolean';
    const memoryWrites = new Set(readFrontmatterStringList(frontmatter, 'memory_writes'));
    const proposalIds = new Set(readFrontmatterStringList(frontmatter, 'proposal_ids'));
    const proposalPaths = new Set(readFrontmatterStringList(frontmatter, 'proposal_paths'));
    const appliedProposalIds = new Set(readFrontmatterStringList(frontmatter, 'durable_output_applied_proposal_ids'));
    const legacyProposals = new Set(readFrontmatterStringList(frontmatter, 'proposals'));
    const hasProposalReference = usesStableProposalReferences
        ? proposalIds.has(payload.proposalId)
        : legacyProposals.has(payload.proposalPath);
    const hasProposalPathEvidence = usesStableProposalReferences
        ? proposalPaths.has(payload.proposalPath)
        : true;
    const hasAppliedProposalReference = usesAppliedProposalEvidence
        ? appliedProposalIds.has(payload.proposalId)
        : true;
    const targetReferenceAdded = !payload.taskHadTargetReference;
    const proposalReferenceAdded = !payload.taskHadProposalReference;
    if (memoryWrites.has(payload.targetPath)
        && hasProposalReference
        && hasProposalPathEvidence
        && hasAppliedProposalReference) {
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
            && hasProposalPathEvidence !== payload.taskHadProposalPathEvidence)
        || (usesAppliedProposalEvidence
            && hasAppliedProposalReference !== payload.taskHadAppliedProposalReference)) {
        throw new core_1.OperationConflictError('Writeback task references changed after preview.');
    }
    const next = updateFrontmatterFields(current.content, usesStableProposalReferences
        ? {
            memory_writes: mergeFrontmatterList(frontmatter, 'memory_writes', [payload.targetPath]),
            proposal_ids: mergeFrontmatterList(frontmatter, 'proposal_ids', [payload.proposalId]),
            proposal_paths: mergeFrontmatterList(frontmatter, 'proposal_paths', [payload.proposalPath]),
            ...(usesAppliedProposalEvidence
                ? {
                    durable_output_applied_proposal_ids: mergeFrontmatterList(frontmatter, 'durable_output_applied_proposal_ids', [payload.proposalId]),
                }
                : {}),
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
    const appliedProposalEvidenceAdded = typeof payload.taskHadAppliedProposalReference === 'boolean'
        && payload.taskHadAppliedProposalReference === false;
    if (!receipt.targetReferenceAdded
        && !receipt.proposalReferenceAdded
        && !proposalPathEvidenceAdded
        && !appliedProposalEvidenceAdded) {
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
    const appliedProposalIds = readFrontmatterStringList(frontmatter, 'durable_output_applied_proposal_ids');
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
    const nextAppliedProposalIds = appliedProposalEvidenceAdded
        ? appliedProposalIds.filter((value) => value !== payload.proposalId)
        : appliedProposalIds;
    const nextLegacyProposals = !usesStableProposalReferences && receipt.proposalReferenceAdded
        ? legacyProposals.filter((value) => value !== payload.proposalPath)
        : legacyProposals;
    if (nextMemoryWrites.length === memoryWrites.length
        && nextProposalIds.length === proposalIds.length
        && nextProposalPaths.length === proposalPaths.length
        && nextAppliedProposalIds.length === appliedProposalIds.length
        && nextLegacyProposals.length === legacyProposals.length) {
        return;
    }
    const next = updateFrontmatterFields(current.content, usesStableProposalReferences
        ? {
            memory_writes: nextMemoryWrites.length > 0 ? nextMemoryWrites.join(', ') : null,
            proposal_ids: nextProposalIds.length > 0 ? nextProposalIds.join(', ') : null,
            proposal_paths: nextProposalPaths.length > 0 ? nextProposalPaths.join(', ') : null,
            ...(typeof payload.taskHadAppliedProposalReference === 'boolean'
                ? {
                    durable_output_applied_proposal_ids: nextAppliedProposalIds.length > 0
                        ? nextAppliedProposalIds.join(', ')
                        : null,
                }
                : {}),
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
    const trackingMetadataFromContent = (content) => {
        const fields = (0, core_1.parseMarkdown)(content).frontmatter.fields;
        const startedAt = stripYamlQuotes(readFrontmatterString(fields, ['started_at']));
        const trackingStartedAt = stripYamlQuotes(readFrontmatterString(fields, ['tracking_started_at'])) || startedAt;
        const recordedAt = stripYamlQuotes(readFrontmatterString(fields, ['recorded_at']))
            || trackingStartedAt;
        const startedAtSource = stripYamlQuotes(readFrontmatterString(fields, ['started_at_source'])) === 'client_claim' ? 'client_claim' : 'server_observed';
        return {
            tracking_mode: 'live',
            task_record_origin: 'start_task',
            started_at: startedAt,
            started_at_source: startedAtSource,
            tracking_started_at: trackingStartedAt,
            recorded_at: recordedAt,
            start_recovery: 'not_requested',
        };
    };
    const returnExistingTask = async (content) => {
        const audit = await (0, audit_persistence_1.appendAuditEventAsync)(vaultRoot, {
            operationId: input.operationId,
            tool: 'tracekeeper.start_task',
            targetPath: taskPath,
            status: 'written',
            taskId: input.taskId,
            metadata: taskAuditMetadata,
        }, input.context);
        return {
            path: taskPath,
            activity_path: audit.path,
            status: 'skipped',
            warnings: [],
            ...trackingMetadataFromContent(content),
        };
    };
    const existingTask = input.context.vaultRepository
        ? await input.context.vaultRepository.readText(taskPath)
        : null;
    if (!existingTask && !input.context.vaultRepository) {
        const taskAbsolute = path.resolve(vaultRoot, taskPath);
        (0, safety_1.relativeFromAbsolute)(vaultRoot, taskAbsolute);
        (0, safety_1.assertNoSymlinkSegments)(vaultRoot, taskAbsolute);
        if (fs.existsSync(taskAbsolute)) {
            const existingContent = fs.readFileSync(taskAbsolute, 'utf8');
            const existing = (0, core_1.parseMarkdown)(existingContent);
            const existingOperationId = stripYamlQuotes(readFrontmatterString(existing.frontmatter.fields, ['start_operation_id']));
            if (existingOperationId === input.operationId) {
                return returnExistingTask(existingContent);
            }
            throw new core_1.OperationConflictError(`Task path already exists for another operation: ${taskPath}`);
        }
    }
    if (existingTask) {
        const existingOperationId = stripYamlQuotes(readFrontmatterString((0, core_1.parseMarkdown)(existingTask.content).frontmatter.fields, ['start_operation_id']));
        if (existingOperationId === input.operationId) {
            return returnExistingTask(existingTask.content);
        }
        throw new core_1.OperationConflictError(`Task path already exists for another operation: ${taskPath}`);
    }
    const now = new Date().toISOString();
    const startedAt = input.clientStartedAt || now;
    const startedAtSource = input.clientStartedAt ? 'client_claim' : 'server_observed';
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
    const note = await buildAndWriteNoteAsync(vaultRoot, 'tracekeeper.start_task', AGENT_TASK_DIR, taskPath.slice(`${AGENT_TASK_DIR}/`.length), {
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
        tracking_mode: 'live',
        task_record_origin: 'start_task',
        started_at: startedAt,
        started_at_source: startedAtSource,
        tracking_started_at: now,
        recorded_at: now,
        start_recovery: 'not_requested',
        start_operation_id: input.operationId,
    }, body, input.taskId, input.context, taskAuditMetadata, input.operationId);
    return {
        ...note,
        tracking_mode: 'live',
        task_record_origin: 'start_task',
        started_at: startedAt,
        started_at_source: startedAtSource,
        tracking_started_at: now,
        recorded_at: now,
        start_recovery: 'not_requested',
    };
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
    'tracekeeper.memory': (rawArgs, context) => handleMemory(rawArgs, context),
    'tracekeeper.read_note': (rawArgs, context) => handleReadNote(rawArgs, context),
    'tracekeeper.review_queue': (rawArgs, context) => handleReviewQueueUnified(rawArgs, context),
    'tracekeeper.project_context': (rawArgs, context) => handleProjectContext(rawArgs, context),
    'tracekeeper.project_history': (rawArgs, context) => handleProjectHistory(rawArgs, context),
    'tracekeeper.list_review_queue': (rawArgs, context) => handleReviewQueue(rawArgs, context),
    'tracekeeper.list_source_requests': (rawArgs, context) => handleListSourceRequests(rawArgs, context),
    'tracekeeper.list_approved_writebacks': (rawArgs, context) => handleListApprovedWritebacks(rawArgs, context),
    'tracekeeper.agent_activity_recent': (rawArgs, context) => handleAgentActivityRecent(rawArgs, context),
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
function resolveAuditVaultRoot(context) {
    if (typeof context.defaultVaultRoot === 'string' && context.defaultVaultRoot.trim()) {
        try {
            return (0, safety_1.toSafeVaultRoot)(context.defaultVaultRoot);
        }
        catch {
            return null;
        }
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
    return (0, audit_persistence_1.appendAuditEvent)(vaultRoot, {
        type: 'mcp.connection',
        event: 'mcp.connection',
        action: 'mcp.connection',
        timestamp: now,
        principalId: input.principalId,
        agentId: input.agentId,
        sessionId: input.sessionId,
        clientName: input.clientName,
        resultStatus: 'success',
        transport: input.transport,
        runtimeVersion: input.runtimeVersion,
        metadata: {
            agent_activity_schema_version: 1,
            integration_id: input.integrationId,
            credential_id: input.credentialId,
            auth_mode: input.authMode,
            observed_client_name_raw: input.clientName,
            observed_client_type: input.observedClientType,
            observed_client_version: input.clientVersion,
            connected_at: now,
        },
    });
}
function appendRuntimeDiagnosticAuditEvent(vaultRoot, reason) {
    return (0, audit_persistence_1.appendAuditEvent)(vaultRoot, {
        type: 'mcp.authentication_rejected',
        event: 'mcp.authentication_rejected',
        action: 'mcp.authentication_rejected',
        resultStatus: 'failed',
        transport: 'streamable-http',
        metadata: {
            agent_activity_schema_version: 1,
            diagnostic_reason: reason,
        },
    });
}
function recordToolCallAuditEvent(vaultRoot, input) {
    const now = new Date().toISOString();
    const invocationId = input.invocationId?.trim()
        || `invocation-${crypto.randomUUID()}`;
    return (0, audit_persistence_1.appendAuditEvent)(vaultRoot, {
        type: 'mcp.tool_call',
        event: 'mcp.tool_call',
        action: input.toolName,
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
            agent_activity_schema_version: 1,
            integration_id: input.integrationId,
            credential_id: input.credentialId,
            auth_mode: input.authMode,
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
    return (0, audit_persistence_1.appendAuditEventAsync)(vaultRoot, {
        type: 'mcp.tool_call',
        event: 'mcp.tool_call',
        action: input.toolName,
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
            agent_activity_schema_version: 1,
            integration_id: input.integrationId,
            credential_id: input.credentialId,
            auth_mode: input.authMode,
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
    const vaultRoot = resolveAuditVaultRoot(context);
    if (!vaultRoot || !isAgentActivityTransport(context)) {
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
        activity_path: payload.activity_path,
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
        const { required: inputRequired, ...inputSchemaKeywords } = contract.inputSchema;
        definitions.push({
            name: contract.name,
            title: contract.name,
            description: contract.description || '',
            inputSchema: {
                ...inputSchemaKeywords,
                properties: { ...contract.inputSchema.properties },
                ...(inputRequired ? { required: [...inputRequired] } : {}),
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
            description: 'Start live tracking for a task that needs intermediate identity or recovery.',
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
                    description: 'Scope for recall: global, project, project_history, or task_history.',
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
            description: 'Close a live task or create an ordinary closeout-only task exactly once.',
            arguments: [
                {
                    name: 'task_id',
                    description: 'The real task id returned by tracekeeper.start_task for live tracking.',
                },
                {
                    name: 'goal',
                    description: 'Original goal when creating a closeout-only task.',
                },
                {
                    name: 'started_at',
                    description: 'Original client-held ISO start time for closeout-only recording.',
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
    const auditVaultRoot = resolveAuditVaultRoot(context);
    let toolResult = toolError(`Unknown tool: ${requestName}`);
    let status = 'failed';
    const toolName = requestName || 'unknown';
    const argsSummary = (0, audit_persistence_1.summarizeForAudit)((0, audit_persistence_1.projectArgumentsForAudit)(requestName, args));
    try {
        assertCallerDoesNotSelectVaultRoot(args);
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
        if (auditVaultRoot && isAgentActivityTransport(context)) {
            try {
                await recordToolCallAuditEventAsync(auditVaultRoot, {
                    invocationId,
                    requestId: context.requestId,
                    toolName,
                    resultStatus: status,
                    targetPaths: (0, audit_persistence_1.collectAuditTargetsFromResult)(requestName, args, toolResult.structuredContent),
                    durationMs: Date.now() - startTime,
                    riskLevel: getToolRiskLevel(requestName),
                    agentId,
                    principalId: context.principalId,
                    integrationId: context.integrationId,
                    credentialId: context.credentialId,
                    authMode: context.authMode,
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
function isAgentActivityTransport(context) {
    return context.transport !== 'obsidian-direct';
}
async function recoverPendingOperations(vaultRoot, context = {}) {
    const controller = new recovery_1.RuntimeRecoveryController(operationJournalForVault(vaultRoot), {
        isApplyApprovedWritebackPayload,
        isProposeMemoryOperationPayload,
        isFinishTaskV2Payload: (payload) => isFinishTaskOperationPayload(payload)
            && payload.memoryRecordWriteVersion === 2,
        releaseIncompatibleFinishTaskBinding: (record) => releaseIncompatibleFinishTaskBinding(vaultRoot, record, context),
        invoke: async (request, record, requestedVaultRoot) => {
            const result = await callTool(request.tool, request.args, {
                ...context,
                defaultVaultRoot: requestedVaultRoot,
                principalId: context.principalId || exports.LOCAL_TRUST_PRINCIPAL_ID,
                credentialCapabilities: context.credentialCapabilities || exports.LOCAL_TRUST_CAPABILITIES,
                agentId: context.agentId || 'tracekeeper-recovery',
                clientName: context.clientName || 'tracekeeper-runtime-recovery',
                transport: context.transport || 'runtime-recovery',
                writebackRecoveryOperationId: record.operation_id,
            });
            const structured = result.structuredContent;
            return {
                isError: Boolean(result.isError),
                error: (0, protocol_1.isRecord)(structured) && typeof structured.error === 'string'
                    ? structured.error
                    : undefined,
            };
        },
    });
    return controller.recover(vaultRoot);
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
        default_mode: 'explicit_candidates',
        content_language: contentLanguageFromContext(context),
        content_language_source: contentLanguageSourceFromContext(context),
        fields: [
            'summary',
            'status',
            'outcomes',
            'decisions',
            'solution_changes',
            'lessons',
            'preferences',
            'next_actions',
            'memory_candidate_records',
            'related_wiki',
            'related_sources',
        ],
        project_hint_required_for_project_memory: true,
        note: 'Task fields describe execution and remain in task history. Submit a structured memory_candidate_records entry only when information should become durable global or project memory. ' +
            'Reuse verified wiki/source paths already gathered from recall/read_note, otherwise report review fallback.',
    };
}
function buildStartTaskNextActions(identity, context) {
    const actions = [
        contentText(context, '读取单篇笔记前，先调用 tracekeeper.recall。', 'Call tracekeeper.recall before reading individual notes.'),
        contentText(context, '只有召回摘要不够时，再使用 tracekeeper.read_note。', 'Use tracekeeper.read_note only when a recall excerpt is not enough.'),
        contentText(context, '任务结束时调用一次 tracekeeper.finish_task，记录任务状态和执行细节；只有明确的长期记忆候选才提交为 memory_candidate_records。', 'Call tracekeeper.finish_task once at the end with task status and execution details; submit only explicit durable candidates as memory_candidate_records.'),
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
async function handleStatus(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    const view = await knowledgeReadViewForContext(vaultRoot, context);
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        scanned_at: view.createdAt,
        ...readViewProvenance(view),
        content_language: contentLanguageFromContext(context),
        content_language_source: contentLanguageSourceFromContext(context),
        counts: {
            notes: view.catalog.size,
            errors: view.errors.length,
            by_type: buildCatalogCounts(view.catalog.values()),
        },
        scan_errors: view.errors.slice(0, 5),
    };
}
async function handleGraphHealth(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
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
    const view = await knowledgeReadViewForContext(vaultRoot, context);
    const graphHealth = (0, core_1.analyzeGraphHealth)(materializeLightweightNotes(view), {
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
        scanned_at: view.createdAt,
        ...readViewProvenance(view),
        ...graphHealth,
    };
}
function operationJournalForVault(vaultRoot) {
    const operationDirectory = path.resolve(vaultRoot, core_1.TRACEKEEPER_OPERATIONS_DIR);
    (0, safety_1.relativeFromAbsolute)(vaultRoot, operationDirectory);
    (0, safety_1.assertNoSymlinkSegments)(vaultRoot, operationDirectory);
    return new core_1.NodeFileOperationJournal({ directory: operationDirectory });
}
function buildOperationIdFromIdempotencyKey(tool, idempotencyKey) {
    const identity = crypto
        .createHash('sha256')
        .update(`${tool}\0${idempotencyKey}`)
        .digest('hex')
        .slice(0, 24);
    return `${tool}-${identity}`;
}
function buildToolOperationIdentity(tool, rawIdempotencyKey, payload, context) {
    const providedKey = coerceOptionalString(rawIdempotencyKey);
    if (providedKey.length > 512) {
        throw new safety_1.ToolInputError('idempotency_key must be at most 512 characters.');
    }
    const payloadHash = (0, core_1.computePayloadHash)(payload);
    const sessionScope = context.sessionId || context.agentId || 'legacy-client';
    const idempotencyKey = providedKey || `legacy:${tool}:${sessionScope}:${payloadHash}`;
    return {
        operationId: buildOperationIdFromIdempotencyKey(tool, idempotencyKey),
        idempotencyKey,
    };
}
async function handleStartTask(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    if (context.memoryRules?.taskTrackingEnabled === false) {
        throw new safety_1.ToolInputError('task_tracking_disabled: task tracking is disabled in Tracekeeper settings.');
    }
    const goal = coerceNonEmptyString(rawArgs.goal, true, 'goal');
    const client = coerceNonEmptyString(rawArgs.client);
    const clientStartedAt = coerceIsoTimestamp(rawArgs.started_at, false, 'started_at');
    const view = await knowledgeReadViewForContext(vaultRoot, context);
    const scan = lightweightScanFromReadView(vaultRoot, view);
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
        clientStartedAt: clientStartedAt || null,
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
            const recallScope = hasProjectScope(projectIdentity) && projectIdentity.confidence !== 'uncertain'
                ? 'project'
                : 'global';
            const recallResult = await executeRecallApplication(recallScope, {
                query: goal,
                max_items: 8,
                project_hint: projectIdentity.projectHint,
                project_id: projectIdentity.projectId,
                repo_path: projectIdentity.repoPath,
            }, context);
            const contextPack = contextPackFromReadViewRecall(vaultRoot, goal, recallResult, view, 180);
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
                clientStartedAt,
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
                activity_path: task.activity_path,
                tracking_mode: task.tracking_mode,
                task_record_origin: task.task_record_origin,
                started_at: task.started_at,
                started_at_source: task.started_at_source,
                tracking_started_at: task.tracking_started_at,
                recorded_at: task.recorded_at,
                start_recovery: task.start_recovery,
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
async function executeRecallApplication(scope, rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    const query = scope === 'project_history' || scope === 'task_history'
        ? coerceOptionalString(rawArgs.query)
        : coerceNonEmptyString(rawArgs.query, true, 'query');
    const maxItems = coercePositiveInt(rawArgs.max_items, scope === 'global' ? 6 : MAX_PROJECT_TOOL_ITEMS, 1, MAX_PROJECT_TOOL_ITEMS);
    const service = new recall_1.RecallApplicationService({
        loadScan: () => {
            throw new Error('Bounded Recall must not request the legacy full-scan dependency.');
        },
        nowMs: () => Date.now(),
        resolveProjectIdentity: project_identity_1.resolveProjectIdentity,
        filterProjectNotes: filterNotesByProjectScopeWithSessions,
        buildRelationEvidence: buildRecallRelationEvidence,
        contentOrigin: recallContentOrigin,
    });
    const request = {
        scope,
        query,
        maxItems,
        vaultRoot,
        taskId: coerceOptionalString(rawArgs.task_id) || undefined,
        projectIdentityInput: rawArgs,
    };
    return service.executeReadView(request, await knowledgeReadViewForContext(vaultRoot, context));
}
async function handleRecall(rawArgs, context) {
    const scope = coerceRecallScope(rawArgs.scope);
    if (scope === 'project') {
        const result = await executeRecallApplication('project', rawArgs, context);
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
        const result = await executeRecallApplication('project_history', rawArgs, context);
        return {
            ...result,
            scope: {
                ...result.scope,
                scope,
            },
            scope_mode: scope,
        };
    }
    if (scope === 'task_history') {
        const result = await executeRecallApplication('task_history', rawArgs, context);
        return {
            ...result,
            scope: { scope },
            scope_mode: scope,
        };
    }
    return executeRecallApplication('global', rawArgs, context);
}
async function handleMemory(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    const scope = coerceOptionalString(rawArgs.scope).toLowerCase() || 'global';
    if (scope !== 'global' && scope !== 'project') {
        throw new safety_1.ToolInputError('memory scope must be one of: global, project.');
    }
    const requestedView = coerceOptionalString(rawArgs.view).toLowerCase() || 'current';
    if (!['current', 'history', 'conflicts', 'all'].includes(requestedView)) {
        throw new safety_1.ToolInputError('memory view must be one of: current, history, conflicts, all.');
    }
    const projectId = scope === 'project' ? coerceOptionalString(rawArgs.project_id) : '';
    if (scope === 'project' && !projectId) {
        throw new safety_1.ToolInputError('memory project scope requires project_id.');
    }
    const readView = await knowledgeReadViewForContext(vaultRoot, context);
    if (scope === 'project') {
        const matchingHubs = [...readView.catalog.values()].filter((entry) => {
            const normalizedType = (entry.type || '').toLowerCase().replace(/-/g, '_');
            return entry.path.startsWith(`${core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)
                && normalizedType === 'project_memory_index'
                && readFrontmatterString(entry.frontmatter, ['project_id', 'projectId']) === projectId;
        });
        if (matchingHubs.length !== 1) {
            throw new safety_1.ToolInputError(`project_identity_not_found: project_id is not bound to exactly one current Project Memory Hub: ${projectId}`);
        }
    }
    const lifecycle = readView.memory.lifecycle;
    const selected = requestedView === 'current'
        ? lifecycle.current
        : requestedView === 'history'
            ? lifecycle.history
            : requestedView === 'conflicts'
                ? lifecycle.conflicts
                : lifecycle.records;
    const records = selected
        .filter((row) => row.record.scope === scope)
        .filter((row) => scope === 'global' || row.record.project_id === projectId)
        .sort(compareMemoryCatalogRows);
    const catalogRows = records.map(toMemoryCatalogRow);
    if (requestedView === 'history' || requestedView === 'all') {
        catalogRows.push(...lifecycle.legacy
            .filter((row) => row.projection.scope === scope)
            .filter((row) => scope === 'global' || row.projection.project_id === projectId)
            .map((row) => ({
            path: row.projection.path,
            legacy: true,
            memory_id: null,
            scope: row.projection.scope,
            project_id: row.projection.project_id,
            claim_key: null,
            memory_kind: null,
            authority: null,
            confidence_level: null,
            declared_state: null,
            effective_state: row.effective_state,
            observed_at: row.projection.kind === 'project_v1' ? row.projection.observed_at : null,
            valid_from: null,
            valid_to: null,
            last_verified_at: null,
            evidence: [],
            supersedes: [],
            contradicts: [],
            related_wiki: [],
            related_sources: [],
            reasons: [...row.reasons],
        })));
    }
    catalogRows.sort((left, right) => String(right.observed_at ?? '').localeCompare(String(left.observed_at ?? ''))
        || String(left.memory_id ?? '').localeCompare(String(right.memory_id ?? ''))
        || left.path.localeCompare(right.path));
    const pageSize = coercePositiveInt(rawArgs.page_size, 50, 1, 200);
    const offset = decodeMemoryCursor(coerceOptionalString(rawArgs.cursor), readView.generation, scope, requestedView, projectId || null);
    const entries = catalogRows.slice(offset, offset + pageSize);
    const nextOffset = offset + entries.length;
    return {
        read_only: true,
        scope,
        view: requestedView,
        project_id: projectId || null,
        generation: readView.generation,
        total: catalogRows.length,
        complete: true,
        sort: 'observed_at_desc_memory_id_path_asc',
        page: {
            page_size: pageSize,
            next_cursor: nextOffset < catalogRows.length
                ? encodeMemoryCursor(readView.generation, scope, requestedView, projectId || null, nextOffset)
                : null,
        },
        entries,
    };
}
function compareMemoryCatalogRows(left, right) {
    return right.record.observed_at.localeCompare(left.record.observed_at)
        || left.record.memory_id.localeCompare(right.record.memory_id)
        || left.record.path.localeCompare(right.record.path);
}
function toMemoryCatalogRow(row) {
    const record = row.record;
    return {
        path: record.path,
        legacy: false,
        memory_id: record.memory_id,
        scope: record.scope,
        project_id: record.project_id,
        claim_key: record.claim_key,
        memory_kind: record.memory_kind,
        authority: record.authority,
        confidence_level: record.confidence_level,
        declared_state: record.declared_state,
        effective_state: row.effective_state,
        observed_at: record.observed_at,
        valid_from: record.valid_from,
        valid_to: record.valid_to,
        last_verified_at: record.last_verified_at,
        evidence: [...record.evidence],
        supersedes: [...record.supersedes],
        contradicts: [...record.contradicts],
        related_wiki: [...record.related_wiki],
        related_sources: [...record.related_sources],
        reasons: [...row.reasons],
    };
}
function encodeMemoryCursor(generation, scope, view, projectId, offset) {
    const payload = Buffer.from(JSON.stringify({ generation, scope, view, projectId, offset }), 'utf8').toString('base64url');
    return `${payload}.${memoryCursorChecksum(payload)}`;
}
function decodeMemoryCursor(cursor, generation, scope, view, projectId) {
    if (!cursor)
        return 0;
    try {
        const [encodedPayload, suppliedChecksum, ...extraParts] = cursor.split('.');
        if (!encodedPayload || !suppliedChecksum || extraParts.length > 0) {
            throw new safety_1.ToolInputError('Memory cursor is invalid.');
        }
        const expectedChecksum = memoryCursorChecksum(encodedPayload);
        const suppliedBytes = Buffer.from(suppliedChecksum, 'utf8');
        const expectedBytes = Buffer.from(expectedChecksum, 'utf8');
        if (suppliedBytes.length !== expectedBytes.length
            || !crypto.timingSafeEqual(suppliedBytes, expectedBytes)) {
            throw new safety_1.ToolInputError('Memory cursor checksum is invalid.');
        }
        const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
        if (payload.generation !== generation)
            throw new safety_1.ToolInputError('Memory cursor is stale for the current generation.');
        if (payload.scope !== scope || payload.view !== view || payload.projectId !== projectId) {
            throw new safety_1.ToolInputError('Memory cursor does not match the requested catalog.');
        }
        if (!Number.isSafeInteger(payload.offset) || Number(payload.offset) < 0) {
            throw new safety_1.ToolInputError('Memory cursor is invalid.');
        }
        return Number(payload.offset);
    }
    catch (error) {
        if (error instanceof safety_1.ToolInputError)
            throw error;
        throw new safety_1.ToolInputError('Memory cursor is invalid.');
    }
}
function memoryCursorChecksum(encodedPayload) {
    return crypto
        .createHash('sha256')
        .update(`tracekeeper.memory.cursor.v1:${encodedPayload}`, 'utf8')
        .digest('base64url')
        .slice(0, 22);
}
async function handleReadNote(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
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
    const view = await knowledgeReadViewForContext(vaultRoot, context);
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
        relation_evidence: view.catalog.has(data.path)
            ? (0, recall_1.buildKnowledgeRelationEvidenceFromReadView)(view.catalog.get(data.path), view)
            : { related_wiki: [], related_sources: [] },
    };
}
function handleProjectContext(rawArgs, context) {
    return executeRecallApplication('project', rawArgs, context);
}
function handleProjectHistory(rawArgs, context) {
    return executeRecallApplication('project_history', rawArgs, context);
}
async function handleListSourceRequests(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    const maxItems = coercePositiveInt(rawArgs.max_items, MAX_LIST_QUEUE_ITEMS, 1, MAX_LIST_QUEUE_ITEMS);
    const statusFilter = coerceOptionalString(rawArgs.status) || 'pending';
    const sourceKindFilter = coerceOptionalString(rawArgs.source_kind).toLowerCase();
    const view = await knowledgeReadViewForContext(vaultRoot, context);
    const normalizedStatus = statusFilter.toLowerCase().trim();
    const requests = [...view.catalog.values()]
        .filter((note) => note.path.startsWith(`${SOURCE_REQUESTS_DIR}/`))
        .filter((note) => {
        const noteType = toSourceRequestRow(note).noteType.toLowerCase();
        return noteType.includes('agent-request');
    })
        .map((note) => {
        const row = toSourceRequestRow(note);
        return {
            path: note.path,
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
async function handleAnalyzeSourceRequest(rawArgs, context, sourceToolName = 'tracekeeper.analyze_source_request') {
    const vaultRoot = configuredVaultRoot(context);
    const requestPath = coerceOptionalString(rawArgs.request_path) || coerceOptionalString(rawArgs.path);
    if (!requestPath) {
        throw new safety_1.ToolInputError('Missing required argument: request_path or path.');
    }
    const updateStatus = coerceBoolean(rawArgs.update_request_status, 'update_request_status', true);
    const forceReprocess = coerceBoolean(rawArgs.force_reprocess, 'force_reprocess', false);
    const taskId = coerceOptionalString(rawArgs.task_id) || null;
    const application = new source_request_1.SourceRequestApplicationService({
        readRequest: async (requestPathValue) => readSourceRequestAsync(vaultRoot, requestPathValue, context),
        readSourceText: async (sourcePath) => {
            try {
                return await safeReadTextFileAsync(vaultRoot, sourcePath, context);
            }
            catch (error) {
                if (error instanceof safety_1.ToolInputError || error instanceof core_1.VaultPathError) {
                    return null;
                }
                throw error;
            }
        },
        writeNote: (input) => {
            const allowedDir = input.kind === 'source' || input.kind === 'source_part'
                ? input.directory || SOURCES_DIR
                : input.kind === 'report'
                    ? SOURCE_ANALYSIS_REPORT_DIR
                    : MEMORY_PROPOSAL_DIR;
            return buildAndWriteNoteAsync(vaultRoot, input.toolName, allowedDir, input.filename, input.frontmatter, input.body, input.taskId, context, input.metadata);
        },
        updateRequestStatus: (requestPathValue, status) => updateRequestStatusAsync(vaultRoot, requestPathValue, status, context),
        appendAudit: (input) => (0, audit_persistence_1.appendAuditEventAsync)(vaultRoot, input, context),
        updateTaskRecord: (taskIdValue, notePaths, proposals) => updateAgentTaskRecordAsync(vaultRoot, taskIdValue, {}, context, {
            source_captures: notePaths,
            proposal_ids: proposals.map((proposal) => proposal.proposalId),
            proposal_paths: proposals.map((proposal) => proposal.path),
            proposal_link_targets: proposals.map((proposal) => proposal.linkTarget),
        }),
        updateManagedProposalReferences: (recordPath, proposals) => updateManagedProposalReferences(vaultRoot, recordPath, proposals, context),
        assertSafeText: assertNoSensitiveText,
        renderText: (zh, en) => contentText(context, zh, en),
        contentLanguage: contentLanguageFromContext(context),
        now: () => new Date().toISOString(),
        buildFilename: (rawFilename, fallbackPrefix) => buildSafeFilename(rawFilename, fallbackPrefix, context),
        proposalDirectory: MEMORY_PROPOSAL_DIR,
        renderMarkdownLink: (targetPath, sourcePath) => projectMemoryRepository(vaultRoot, context).generateMarkdownLink?.(targetPath, sourcePath)
            ?? `[[${targetPath.replace(/\.md$/i, '')}]]`,
    });
    const result = await application.execute({
        requestPath,
        taskId,
        updateRequestStatus: updateStatus,
        forceReprocess,
        toolName: sourceToolName,
    });
    return { vault_root: vaultRoot, ...result };
}
async function handleReviewQueueUnified(rawArgs, context) {
    const action = coerceReviewQueueAction(rawArgs.action);
    const result = action === 'list_approved'
        ? await handleListApprovedWritebacks(rawArgs, context)
        : await handleReviewQueue(rawArgs, context);
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
        : await handleListSourceRequests(rawArgs, context);
    return {
        ...result,
        tool: 'tracekeeper.source_request',
        action,
    };
}
async function handleReviewQueue(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    const maxItems = coercePositiveInt(rawArgs.max_items, MAX_LIST_QUEUE_ITEMS, 1, MAX_LIST_QUEUE_ITEMS);
    const view = await knowledgeReadViewForContext(vaultRoot, context);
    const pending = [...view.catalog.values()]
        .filter((note) => note.path.startsWith(REVIEW_QUEUE_PREFIX))
        .filter(isPendingProposal)
        .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
        .slice(0, maxItems)
        .map((note) => ({
        path: note.path,
        title: note.title,
        modifiedAt: note.modifiedAt,
        status: readProposalApprovalStatus(note.frontmatter),
        proposal_kind: readFrontmatterString(note.frontmatter, ['proposal_kind', 'proposalKind']) || null,
        risk_level: readFrontmatterString(note.frontmatter, ['risk_level', 'riskLevel']) || null,
        ...proposalGovernanceProjection(note.frontmatter, view),
    }));
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        count: pending.length,
        entries: pending,
    };
}
async function handleListApprovedWritebacks(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    const rawLimit = rawArgs.max_items ?? rawArgs.limit;
    const maxItems = coercePositiveInt(rawLimit, MAX_APPROVED_WRITEBACKS, 1, MAX_APPROVED_WRITEBACKS);
    const scope = coerceOptionalString(rawArgs.scope);
    const view = await knowledgeReadViewForContext(vaultRoot, context);
    const candidates = [];
    const approved = [...view.catalog.values()]
        .filter((note) => note.path.startsWith(`${REVIEW_QUEUE_PREFIX}/`))
        .filter((note) => readProposalApprovalStatus(note.frontmatter) === 'approved')
        .filter((note) => {
        if (!scope)
            return true;
        const proposalKind = stripYamlQuotes(readFrontmatterString(note.frontmatter, ['proposal_kind', 'proposalKind']));
        const targetNote = stripYamlQuotes(readFrontmatterString(note.frontmatter, ['target_note', 'targetNote']));
        return proposalKind.includes(scope) || targetNote.startsWith(scope);
    })
        .sort((left, right) => left.path.localeCompare(right.path))
        .slice(0, maxItems);
    for (const note of approved) {
        const content = await readVaultNoteContent(vaultRoot, note.path, context);
        if (content === null) {
            continue;
        }
        const proposal = memoryProposalDocumentFromText(vaultRoot, note.path, content, context);
        candidates.push(await resolveApplyWritebackPlan(vaultRoot, proposal, context));
    }
    const entries = candidates
        .sort((a, b) => a.proposal.path.localeCompare(b.proposal.path))
        .map((plan) => ({
        proposal_id: plan.proposal.proposalId,
        proposal_path: plan.proposal.path,
        proposal_kind: plan.proposal.proposalKind,
        target_note: plan.targetNote || null,
        risk_level: plan.proposal.riskLevel,
        task_id: plan.proposal.taskId || null,
        ready_to_apply: plan.ready,
        blocker: plan.ready ? null : plan.reason || 'not ready',
        ...proposalGovernanceProjection(plan.proposal.frontmatter, view),
    }));
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        count: entries.length,
        entries,
    };
}
function proposalGovernanceProjection(frontmatter, view) {
    const scopeValue = stripYamlQuotes(readFrontmatterString(frontmatter, ['memory_scope'])).toLowerCase();
    const scope = scopeValue === 'project' ? 'project' : 'global';
    const projectId = scope === 'project'
        ? stripYamlQuotes(readFrontmatterString(frontmatter, ['project_id'])) || null
        : null;
    const claimKey = stripYamlQuotes(readFrontmatterString(frontmatter, ['claim_key'])) || null;
    const authorityValue = stripYamlQuotes(readFrontmatterString(frontmatter, ['proposed_authority'])).toLowerCase();
    const confidenceValue = stripYamlQuotes(readFrontmatterString(frontmatter, ['proposed_confidence'])).toLowerCase();
    const declaredValue = stripYamlQuotes(readFrontmatterString(frontmatter, ['declared_state'])).toLowerCase();
    const priorMemoryIds = claimKey
        ? view.memory.lifecycle.current
            .filter((row) => row.record.scope === scope)
            .filter((row) => scope === 'global' || row.record.project_id === projectId)
            .filter((row) => row.record.claim_key === claimKey)
            .map((row) => row.record.memory_id)
            .sort()
        : [];
    return {
        record_identity: {
            scope,
            project_id: projectId,
            claim_key: claimKey,
            memory_id: null,
        },
        proposed_record: {
            scope,
            project_id: projectId,
            memory_id: null,
            memory_kind: readFrontmatterString(frontmatter, ['proposal_kind']) || null,
            claim_key: claimKey,
            authority: ['agent', 'source', 'user'].includes(authorityValue) ? authorityValue : null,
            confidence_level: ['uncertain', 'inferred', 'supported', 'verified'].includes(confidenceValue) ? confidenceValue : null,
            declared_state: ['active', 'disputed', 'retracted', 'review'].includes(declaredValue) ? declaredValue : null,
            observed_at: readFrontmatterString(frontmatter, ['observed_at']) || null,
            valid_from: readFrontmatterString(frontmatter, ['valid_from']) || null,
            valid_to: readFrontmatterString(frontmatter, ['valid_to']) || null,
            last_verified_at: readFrontmatterString(frontmatter, ['last_verified_at']) || null,
            evidence: Array.isArray(frontmatter.evidence)
                ? frontmatter.evidence.filter((value) => typeof value === 'string')
                : [],
            supersedes: readFrontmatterStringList(frontmatter, 'supersedes'),
            contradicts: readFrontmatterStringList(frontmatter, 'contradicts'),
            related_wiki: readFrontmatterStringList(frontmatter, 'related_wiki'),
            related_sources: readFrontmatterStringList(frontmatter, 'related_sources'),
            effective_state: claimKey ? 'review' : 'legacy_unkeyed',
        },
        prior_memory_ids: priorMemoryIds,
        predicted_state: claimKey ? 'review' : 'legacy_unkeyed',
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
async function resolveApprovedMemoryClaimIdentity(vaultRoot, payload, context) {
    const proposal = await resolveMemoryProposalFromArgs(vaultRoot, { proposal_path: payload.proposalPath, task_id: payload.taskId }, context);
    const explicitScope = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['memory_scope'])).toLowerCase();
    const explicitClaimKey = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['claim_key', 'claimKey']));
    if (payload.effectKind !== 'create_memory_record'
        && (!explicitScope || !explicitClaimKey)) {
        return null;
    }
    if (!explicitScope) {
        throw new core_1.OperationConflictError('Approved MemoryRecord is missing memory_scope.');
    }
    const scopeValue = explicitScope;
    if (scopeValue !== 'global' && scopeValue !== 'project') {
        throw new core_1.OperationConflictError('Approved MemoryRecord has an invalid memory_scope.');
    }
    const claimKey = explicitClaimKey;
    if (!claimKey) {
        throw new core_1.OperationConflictError('Approved MemoryRecord is missing claim_key.');
    }
    if (scopeValue === 'global') {
        return { scope: 'global', projectId: null, claimKey, projectHub: null };
    }
    const requestedProjectId = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['project_id']));
    if (!requestedProjectId) {
        throw new core_1.OperationConflictError('Approved project MemoryRecord is missing project_id.');
    }
    const snapshot = await projectMemoryApplication(vaultRoot, context).snapshot();
    const route = (0, project_memory_1.resolveProjectMemoryWritableRoute)(snapshot, { projectId: requestedProjectId });
    if (route.status !== 'existing') {
        throw new core_1.OperationConflictError(`missing_memory_hub: structure_repair_required for approved project MemoryRecord (${requestedProjectId}).`);
    }
    return {
        scope: 'project',
        projectId: route.binding.project_id,
        claimKey,
        projectHub: route.binding.project_hub,
    };
}
async function validateApprovedMemoryHub(vaultRoot, identity, context) {
    const repository = projectMemoryRepository(vaultRoot, context);
    if (identity.scope === 'global') {
        if (!await readCanonicalMemoryHub(repository, core_1.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH)) {
            throw new core_1.OperationConflictError('missing_memory_hub: structure_repair_required for approved global MemoryRecord.');
        }
        return;
    }
    const snapshot = await projectMemoryApplication(vaultRoot, context).snapshot();
    const route = (0, project_memory_1.resolveProjectMemoryWritableRoute)(snapshot, { projectId: identity.projectId });
    if (route.status !== 'existing'
        || route.binding.project_id !== identity.projectId
        || route.binding.project_hub !== identity.projectHub) {
        throw new core_1.OperationConflictError('missing_memory_hub: structure_repair_required for approved project MemoryRecord.');
    }
}
async function validateApprovedMemoryLifecycle(vaultRoot, identity, targetPath, markdown, context) {
    const parsed = (0, core_1.parseMarkdown)(markdown);
    const proposed = (0, core_1.parseMemoryRecord)({
        path: targetPath,
        frontmatter: parsed.frontmatter.fields,
        body: parsed.body,
    });
    if (proposed.scope !== identity.scope
        || proposed.project_id !== identity.projectId
        || proposed.claim_key !== identity.claimKey
        || memoryRecordReferencePath(proposed.project_hub) !== identity.projectHub
        || memoryRecordReferencePath(proposed.global_hub) !== (identity.scope === 'global' ? core_1.KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH : null)) {
        throw new core_1.OperationConflictError('Approved MemoryRecord identity changed outside its claim lock.');
    }
    const view = await freshKnowledgeReadViewForContext(vaultRoot, context);
    const invalidRelations = [
        ...proposed.related_wiki.map(memoryRecordReferencePath).filter((relationPath) => !relationPath || !(0, core_1.isKnowledgeWikiPath)(relationPath) || !view.catalog.has(relationPath)),
        ...proposed.related_sources.map(memoryRecordReferencePath).filter((relationPath) => !relationPath || !(0, core_1.isKnowledgeSourcePath)(relationPath) || !view.catalog.has(relationPath)),
    ];
    if (invalidRelations.length > 0) {
        throw new core_1.OperationConflictError(`Approved MemoryRecord relation evidence is stale or invalid: ${invalidRelations.join(', ')}.`);
    }
    const relevantInvalidRecord = view.memory.invalidPaths.some((invalidPath) => {
        if (invalidPath === targetPath)
            return true;
        const frontmatter = view.catalog.get(invalidPath)?.frontmatter;
        return Boolean(frontmatter)
            && frontmatter?.type === 'memory_record'
            && frontmatter?.scope === identity.scope
            && (frontmatter?.project_id ?? null) === identity.projectId
            && frontmatter?.claim_key === identity.claimKey;
    });
    if (relevantInvalidRecord) {
        throw new core_1.OperationConflictError('Approved MemoryRecord lifecycle cannot be validated because the relevant claim is invalid.');
    }
    const records = [...view.memory.byId.values()]
        .filter((record) => record.memory_id !== proposed.memory_id);
    const lifecycle = (0, core_1.resolveMemoryLifecycle)({
        generation: view.generation,
        records: [...records, proposed],
        now: new Date().toISOString(),
    });
    const proposedIssues = lifecycle.issues.filter((issue) => issue.memory_ids.includes(proposed.memory_id) || issue.reference === proposed.memory_id);
    if (proposedIssues.length > 0) {
        throw new core_1.OperationConflictError(`Approved MemoryRecord prospective lifecycle is invalid: ${proposedIssues.map((issue) => issue.code).join(', ')}.`);
    }
}
async function currentWritebackEffect(vaultRoot, payload, operationId, context) {
    const proposal = await resolveMemoryProposalFromArgs(vaultRoot, {
        proposal_path: payload.proposalPath,
        task_id: payload.taskId,
    }, context);
    const snapshot = proposalTransitionSnapshot(proposal);
    const createsMemoryRecord = payload.effectKind === 'create_memory_record';
    const createsWikiNote = payload.effectKind === CREATE_WIKI_NOTE_EFFECT;
    const claimKey = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['claim_key', 'claimKey']));
    const writeback = createsMemoryRecord
        ? {
            block: buildApprovedMemoryRecordMarkdown(vaultRoot, proposal, payload.targetPath, operationId, context),
            marker: `memory-record:${snapshot.proposalId}`,
        }
        : createsWikiNote
            ? buildApprovedWikiNoteWritebackBlock(snapshot.proposalId, snapshot.writebackContent, operationId)
            : buildApprovedWritebackBlock(snapshot.proposalId, snapshot.writebackContent);
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
        || (!createsMemoryRecord && snapshot.targetPath !== payload.targetPath)
        || snapshot.taskId !== payload.proposalTaskId
        || hashText(snapshot.writebackContent) !== payload.writebackContentHash
        || hashText(writeback.block) !== payload.writebackBlockHash
        || writeback.marker !== payload.writebackMarker
        || currentTaskPath !== payload.taskPath
        || (currentTask?.contentHash || '') !== payload.taskContentHash
        || (!createsMemoryRecord && !createsWikiNote && !target)) {
        throw new core_1.OperationConflictError('Writeback confirmation is stale because current proposal or task state changed.');
    }
    validateApprovedWritebackTransition(snapshot, operationId, payload.targetPath, context, new Date(writebackConfirmationNow(context)).toISOString(), (relativePath) => {
        if (relativePath !== payload.targetPath) {
            return false;
        }
        if (payload.effectKind === 'create_memory_record'
            || payload.effectKind === CREATE_WIKI_NOTE_EFFECT) {
            return false;
        }
        return Boolean(target);
    }, (relativePath) => relativePath === payload.targetPath
        && (createsWikiNote || (createsMemoryRecord && Boolean(claimKey))));
    const touchedNotes = [
        payload.targetPath,
        payload.proposalPath,
        ...(payload.taskPath ? [payload.taskPath] : []),
        payload.activityPath,
    ];
    if ((0, core_1.computePayloadHash)(touchedNotes) !== (0, core_1.computePayloadHash)(payload.touchedNotes)) {
        throw new core_1.OperationConflictError('Writeback confirmation touched-note plan changed.');
    }
    if (createsMemoryRecord || createsWikiNote) {
        if (!target) {
            return { target: null, writebackBlock: writeback.block, alreadyApplied: false };
        }
        if (target.contentHash === hashText(writeback.block)) {
            return { target, writebackBlock: writeback.block, alreadyApplied: true };
        }
        throw new core_1.OperationConflictError('Approved writeback target already exists with different content.');
    }
    if (!target) {
        throw new core_1.OperationConflictError(`Writeback target does not exist: ${payload.targetPath}`);
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
    const createsWikiNote = payload.effectKind === CREATE_WIKI_NOTE_EFFECT;
    if (payload.effectKind === 'create_memory_record') {
        const repository = projectMemoryRepository(vaultRoot, context);
        const target = await repository.readText(payload.targetPath);
        if (!target) {
            return;
        }
        if (hashText(target.content) !== payload.writebackBlockHash) {
            throw new core_1.OperationConflictError('Approved memory record changed after creation and cannot be safely compensated.');
        }
        await repository.deleteText(payload.targetPath, target.version);
        return;
    }
    if (createsWikiNote) {
        const repository = context.vaultRepository;
        const target = repository
            ? await repository.readText(payload.targetPath)
            : await readCurrentVaultTextState(vaultRoot, payload.targetPath, context);
        if (!target) {
            return;
        }
        if (hashText(target.content) !== payload.writebackBlockHash) {
            throw new core_1.OperationConflictError('Approved wiki note was changed after creation and cannot be safely compensated.');
        }
        if (repository) {
            if (!target.version) {
                throw new core_1.OperationConflictError('Approved wiki note version is unavailable for compensation.');
            }
            await repository.deleteText(payload.targetPath, target.version);
            return;
        }
        const targetAbsolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, payload.targetPath, pathSafetyOptions(context));
        (0, safety_1.assertNoSymlinkSegments)(vaultRoot, targetAbsolute);
        try {
            fs.unlinkSync(targetAbsolute);
        }
        catch (error) {
            if (error instanceof Error && error.code === 'ENOENT') {
                return;
            }
            throw error;
        }
        return;
    }
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
    const createsMemoryRecord = payload.effectKind === 'create_memory_record';
    const createsWikiNote = payload.effectKind === CREATE_WIKI_NOTE_EFFECT;
    const isCreate = createsMemoryRecord || createsWikiNote;
    const targetForTransition = await readCurrentVaultTextState(vaultRoot, payload.targetPath, context);
    if (isCreate) {
        if (!targetForTransition) {
            throw new core_1.ProposalTransitionValidationError('Writeback target was not created for approved writeback.');
        }
        if (targetForTransition.contentHash !== payload.writebackBlockHash) {
            throw new core_1.ProposalTransitionValidationError('Writeback target changed after create draft was prepared.');
        }
    }
    const ownedCreateTargetPath = isCreate ? payload.targetPath : null;
    const ownedCreateTargetContentHash = isCreate ? payload.writebackBlockHash : null;
    if (context.proposalTransitionPort) {
        const decision = await context.proposalTransitionPort.transition({
            ...transition,
            proposalPath: payload.proposalPath,
            expectedFileHash: payload.proposalFileHash,
            now: new Date().toISOString(),
            actor: context.agentId || 'tracekeeper-runtime',
            ownedCreateTargetPath: isCreate ? ownedCreateTargetPath : null,
            ownedCreateTargetContentHash: isCreate ? ownedCreateTargetContentHash : null,
        });
        return decision.receipt;
    }
    const proposalState = await readCurrentVaultTextState(vaultRoot, payload.proposalPath, context);
    if (!proposalState) {
        throw new core_1.ProposalTransitionConflictError('Writeback proposal does not exist.');
    }
    const proposal = memoryProposalDocumentFromText(vaultRoot, payload.proposalPath, proposalState.content, context);
    const claimKey = stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['claim_key', 'claimKey']));
    const decision = (0, core_1.transitionProposal)(proposalTransitionSnapshot(proposal), transition, {
        now: new Date().toISOString(),
        actor: context.agentId || 'tracekeeper-runtime',
        targetAllowed: core_1.isAllowedProposalTargetPath,
        targetExists: (relativePath) => relativePath === payload.targetPath && (!isCreate ? Boolean(targetForTransition) : false),
        targetCreationAllowed: (relativePath) => relativePath === payload.targetPath
            && (createsWikiNote || (createsMemoryRecord && Boolean(claimKey))),
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
async function resolveApplyWritebackPlan(vaultRoot, proposal, context) {
    const normalizedTarget = proposal.targetNote
        ? (0, safety_1.normalizeNotePath)(proposal.targetNote, pathSafetyOptions(context))
        : '';
    if (proposal.targetNote) {
        assertAllowedWritebackTarget(normalizedTarget);
    }
    const targetState = proposal.targetNote
        ? await readCurrentVaultTextState(vaultRoot, normalizedTarget, context)
        : null;
    const normalizedProposal = proposal.targetNote
        ? { ...proposal, targetNote: normalizedTarget }
        : proposal;
    return buildWritebackPlanForTarget(normalizedProposal, targetState);
}
async function handleApplyApprovedWriteback(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    const dryRun = coerceBoolean(rawArgs.dry_run, 'dry_run', false);
    if (dryRun) {
        const proposal = await resolveMemoryProposalFromArgs(vaultRoot, rawArgs, context);
        const taskId = resolveWritebackTaskId(rawArgs, proposal);
        const plan = await resolveApplyWritebackPlan(vaultRoot, proposal, context);
        if (!plan.ready || !plan.writebackContent) {
            throw new safety_1.ToolInputError(plan.reason || 'approved writeback is not ready to apply.');
        }
        assertNoSensitiveText([
            { label: 'proposal id', value: proposal.proposalId },
            { label: 'target note', value: plan.targetNote || 'new memory record' },
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
            writeback_effect: prepared.binding.effectKind || 'append',
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
        const plan = await resolveApplyWritebackPlan(vaultRoot, proposal, context);
        if (!plan.ready || !plan.writebackContent) {
            throw new safety_1.ToolInputError(plan.reason || 'approved writeback is not ready to apply.');
        }
        assertNoSensitiveText([
            { label: 'proposal id', value: proposal.proposalId },
            { label: 'target note', value: plan.targetNote || 'new memory record' },
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
                const claimIdentity = await resolveApprovedMemoryClaimIdentity(vaultRoot, currentPayload, context);
                const apply = async () => {
                    if (claimIdentity) {
                        await validateApprovedMemoryHub(vaultRoot, claimIdentity, context);
                    }
                    const effect = await currentWritebackEffect(vaultRoot, currentPayload, identity.operationId, context);
                    if (effect.alreadyApplied) {
                        return;
                    }
                    if (currentPayload.effectKind === 'create_memory_record') {
                        if (!claimIdentity) {
                            throw new core_1.OperationConflictError('Approved MemoryRecord claim identity is unavailable.');
                        }
                        await validateApprovedMemoryLifecycle(vaultRoot, claimIdentity, currentPayload.targetPath, effect.writebackBlock, context);
                        const repository = projectMemoryRepository(vaultRoot, context);
                        try {
                            await repository.createText(currentPayload.targetPath, effect.writebackBlock);
                        }
                        catch (error) {
                            if (!isWritebackCreationConflict(error))
                                throw error;
                            const existingTarget = await repository.readText(currentPayload.targetPath);
                            if (existingTarget?.content !== effect.writebackBlock)
                                throw error;
                        }
                        return;
                    }
                    if (currentPayload.effectKind === CREATE_WIKI_NOTE_EFFECT) {
                        if (context.vaultRepository) {
                            try {
                                await context.vaultRepository.createText(currentPayload.targetPath, effect.writebackBlock);
                                return;
                            }
                            catch (error) {
                                if (!isWritebackCreationConflict(error))
                                    throw error;
                                const existing = await context.vaultRepository.readText(currentPayload.targetPath);
                                if (existing?.content !== effect.writebackBlock) {
                                    throw error;
                                }
                            }
                            return;
                        }
                        const writable = (0, safety_1.resolveSafeWritableNotePath)(vaultRoot, currentPayload.targetPath, core_1.KNOWLEDGE_WIKI_DIR, pathSafetyOptions(context));
                        try {
                            (0, safety_1.assertNoSymlinkSegments)(vaultRoot, writable.absolutePath);
                            fs.mkdirSync(path.dirname(writable.absolutePath), { recursive: true });
                            fs.writeFileSync(writable.absolutePath, effect.writebackBlock, { encoding: 'utf8', flag: 'wx' });
                            return;
                        }
                        catch (error) {
                            if (!(error instanceof Error) || error.code !== 'EEXIST') {
                                throw error;
                            }
                            const existing = await readCurrentVaultTextState(vaultRoot, currentPayload.targetPath, context);
                            if (!existing || existing.content !== effect.writebackBlock) {
                                throw new core_1.OperationConflictError('Approved wiki note was not created exactly.');
                            }
                        }
                        return;
                    }
                    if (!effect.target) {
                        throw new core_1.OperationConflictError('Writeback target is unavailable.');
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
                };
                if (!claimIdentity) {
                    await apply();
                    return;
                }
                const releaseClaimLock = await journal.acquireLock(memoryClaimLockKey(claimIdentity.scope, claimIdentity.projectId, claimIdentity.claimKey));
                try {
                    await apply();
                }
                finally {
                    await releaseClaimLock();
                }
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
            async appendAgentActivity(currentPayload, operationId, receipt) {
                await (0, audit_persistence_1.appendAuditEventAsync)(vaultRoot, {
                    operationId,
                    tool: 'tracekeeper.apply_approved_writeback',
                    type: 'mcp.tool_call',
                    event: 'mcp.tool_call',
                    action: 'tracekeeper.apply_approved_writeback',
                    targetPath: currentPayload.targetPath,
                    status: 'written',
                    taskId: currentPayload.taskId,
                    timestamp: receipt.committedAt,
                    agentId: currentPayload.activityAgentId,
                    sessionId: currentPayload.activitySessionId || undefined,
                    clientName: currentPayload.activityClientName || undefined,
                    metadata: {
                        action: currentPayload.effectKind === CREATE_WIKI_NOTE_EFFECT
                            ? 'wiki_note.create'
                            : currentPayload.effectKind === 'create_memory_record'
                                ? 'memory_record.apply'
                                : 'writeback.apply',
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
async function handleAgentActivityRecent(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    const maxItems = coercePositiveInt(rawArgs.max_items, MAX_AUDIT_ITEMS, 1, 100);
    const application = new audit_1.AgentActivityRecentApplicationService({
        agentActivityPath: AGENT_ACTIVITY_PATH,
        readSections: () => (0, audit_persistence_1.readMergedAuditSections)(vaultRoot, context),
    });
    return {
        vault_root: vaultRoot,
        ...(await application.execute(maxItems)),
    };
}
async function handleWriteContextPack(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
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
    const vaultRoot = configuredVaultRoot(context);
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
    const vaultRoot = configuredVaultRoot(context);
    const requestHash = (0, core_1.computePayloadHash)({ ...rawArgs });
    const normalizedIdempotencyKey = coerceOptionalString(rawArgs.idempotency_key);
    const application = new capture_source_1.CaptureSourceApplicationService({
        journal: operationJournalForVault(vaultRoot),
        failureInjection: context.operationFailureInjection,
        createIdentity: (hash, idempotencyKey) => buildToolOperationIdentity('capture-source', idempotencyKey, { requestHash: hash }, context),
        now: () => new Date().toISOString(),
        buildFilename: (rawFilename, fallbackPrefix) => coerceOptionalString(rawFilename)
            ? buildSafeFilename(rawFilename, 'source', context)
            : buildSafeFilename(fallbackPrefix, 'source', context),
        renderText: (zh, en) => contentText(context, zh, en),
        assertSafeText: assertNoSensitiveText,
        findOwnedSourceNote: async (directory, filename, operationId) => {
            const note = await findOperationOwnedNoteAsync(vaultRoot, directory, filename, 'source_operation_id', operationId, context);
            return note
                ? {
                    path: note.path,
                    activity_path: note.activity_path,
                    status: note.status,
                    warnings: note.warnings,
                }
                : null;
        },
        writeSourceNote: (input) => buildAndWriteNoteAsync(vaultRoot, 'tracekeeper.capture_source', input.directory, input.filename, input.frontmatter, input.body, input.taskId, context, input.metadata, input.operationId),
        updateTaskSourceCapture: async (taskId, sourcePath) => {
            await updateAgentTaskRecordAsync(vaultRoot, taskId, {}, context, {
                source_captures: [sourcePath],
            });
        },
    });
    return application.execute({
        rawArgs,
        requestHash,
        idempotencyKey: normalizedIdempotencyKey,
    });
}
async function handleProposeMemory(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    const invocationContext = { ...context };
    const readView = await knowledgeReadViewForContext(vaultRoot, invocationContext);
    const { knowledgeReadViewPromise: _cachedReadView, ...memoryWriteContext } = invocationContext;
    const preflightScan = lightweightScanFromReadView(vaultRoot, readView);
    const explicitProjectId = coerceOptionalString(rawArgs.project_id);
    const identityScan = explicitProjectId
        ? (0, core_1.scanVault)(vaultRoot, pathSafetyOptions(invocationContext))
        : preflightScan;
    const proposalProjectIdentity = (0, project_identity_1.resolveProjectIdentity)(rawArgs, identityScan.notes);
    if (explicitProjectId && proposalProjectIdentity.confidence === 'uncertain') {
        throw new safety_1.ToolInputError(`project_scope_uncertain: explicit project_id is not a unique current Vault identity: ${explicitProjectId}`);
    }
    const proposalRepoPath = proposalProjectIdentity.confidence === 'uncertain'
        ? ''
        : proposalProjectIdentity.repoPath;
    context = {
        ...invocationContext,
        knowledgeReadViewPromise: Promise.resolve(readView),
        knowledgeSnapshotProvider: () => identityScan,
    };
    const observed = context.observedClientType ?? (0, observed_client_1.normalizeObservedClientType)(context.clientName);
    const application = new propose_memory_1.ProposeMemoryApplicationService({
        journal: operationJournalForVault(vaultRoot),
        failureInjection: context.operationFailureInjection,
        createIdentity: (requestHash, idempotencyKey) => buildToolOperationIdentity('propose-memory', idempotencyKey, { requestHash }, context),
        observedAgentType: observed === 'unknown' ? 'custom' : observed,
        now: () => new Date().toISOString(),
        buildFilename: (rawFilename, fallbackPrefix) => rawFilename
            ? buildSafeFilename(rawFilename, 'proposal', context)
            : buildSafeFilename(fallbackPrefix, 'proposal', context),
        resolveMemoryScope: (proposalKind, targetNote, projectHint, memoryScope) => resolveMemoryScope(proposalKind, targetNote, projectHint, memoryScope),
        buildArchitectureStatus: () => buildArchitectureStatus(vaultRoot, context),
        resolveBridgeMetadata: (memoryScope, projectHint, relatedWiki, relatedSources) => resolveProjectMemoryBridgeMetadata(vaultRoot, memoryScope, projectHint, relatedWiki, relatedSources, context),
        resolveProjectIdentity: (snapshot) => {
            const resolved = (0, project_identity_1.resolveProjectIdentity)({
                project_hint: snapshot.project_hint,
                project_id: snapshot.project_id,
                repo_path: snapshot.repo_path,
                repo: snapshot.repo,
                project_path: snapshot.project_path,
            }, scanVaultForContext(vaultRoot, context).notes);
            return resolved;
        },
        assertAllowed: (proposalKind, targetNote, projectHint, memoryScope) => assertMemoryProposalAllowed(proposalKind, targetNote, projectHint, context, memoryScope),
        memoryRule: (proposalKind, targetNote, projectHint, memoryScope) => memoryProposalRuleFor(proposalKind, targetNote, projectHint, context, memoryScope),
        writeImmutableMemoryRecord: (input) => writeImmutableMemoryRecord(vaultRoot, {
            ...input,
            toolName: 'tracekeeper.propose_memory',
            context: memoryWriteContext,
        }),
        resolveMemoryRecordTarget: async (input) => {
            const agentType = (0, core_1.normalizeProjectAgentType)(input.agentType);
            if (input.scope === 'global') {
                return (0, core_1.buildGlobalMemoryEntryPath)({
                    agentType,
                    operationKind: 'propose_memory',
                    operationId: input.operationId,
                });
            }
            const snapshot = await projectMemoryApplication(vaultRoot, context).snapshot();
            const route = (0, project_memory_1.resolveProjectMemoryWritableRoute)(snapshot, {
                projectId: input.projectId,
                projectHint: input.projectHint,
                repoPath: input.repoPath,
            });
            if (route.status === 'review_required')
                return null;
            return (0, core_1.buildProjectMemoryEntryPath)({
                projectKey: route.binding.project_key,
                agentType,
                operationKind: 'propose_memory',
                operationId: input.operationId,
            });
        },
        findOwnedProposalNote: async (filename, operationId) => findOperationOwnedNoteAsync(vaultRoot, MEMORY_PROPOSAL_DIR, filename, 'proposal_operation_id', operationId, context),
        isTargetNoteMissing: async (targetNote) => {
            const state = await readCurrentVaultTextState(vaultRoot, targetNote, context);
            return !state;
        },
        writeProposalNote: (input) => buildAndWriteNoteAsync(vaultRoot, 'tracekeeper.propose_memory', MEMORY_PROPOSAL_DIR, input.filename, {
            ...input.frontmatter,
            ...(input.frontmatter.memory_scope === 'project' && proposalRepoPath
                ? { repo_path: proposalRepoPath }
                : {}),
        }, input.body, input.taskId, context, input.metadata, input.operationId),
        ensureOwnedProposalIdentity: (proposalPath, proposalId, operationId) => ensureOperationOwnedProposalIdentity(vaultRoot, proposalPath, proposalId, 'proposal_operation_id', operationId, context),
        updateTaskMemoryWrite: async (taskId, memoryPath) => {
            await updateAgentTaskRecordAsync(vaultRoot, taskId, {}, context, {
                memory_writes: [memoryPath],
            });
        },
        updateTaskProposalReference: async (taskId, proposal) => {
            await updateManagedProposalReferences(vaultRoot, buildTaskNotePath(taskId), [proposal], context);
        },
        assertSafeText: assertNoSensitiveText,
        renderText: (zh, en) => contentText(context, zh, en),
    });
    return application.execute({ rawArgs });
}
async function handleBuildContextPack(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    const query = coerceNonEmptyString(rawArgs.query, true, 'query');
    const taskId = coerceOptionalString(rawArgs.task_id);
    const candidateLimit = coercePositiveInt(rawArgs.candidate_limit, 8, 1, 120);
    const staleAfterDays = coercePositiveInt(rawArgs.stale_after_days, 180, 1, 3650);
    const shouldWrite = coerceBoolean(rawArgs.write, 'write', false);
    const title = coerceOptionalString(rawArgs.title);
    const view = await knowledgeReadViewForContext(vaultRoot, context);
    const baseScan = lightweightScanFromReadView(vaultRoot, view);
    const explicitScope = coerceProjectScope(rawArgs, baseScan.notes);
    let scopeForContextPack = explicitScope;
    if (taskId) {
        const taskMetadata = await readAgentTaskMetadataAsync(vaultRoot, taskId, context);
        scopeForContextPack = mergeTaskProjectIdentity(taskId, taskMetadata, explicitScope);
    }
    const recallScope = hasProjectScope(scopeForContextPack) && scopeForContextPack.confidence !== 'uncertain'
        ? 'project'
        : 'global';
    const recallResult = await executeRecallApplication(recallScope, {
        query,
        max_items: candidateLimit,
        project_hint: scopeForContextPack.projectHint,
        project_id: scopeForContextPack.projectId,
        repo_path: scopeForContextPack.repoPath,
    }, context);
    const contextPack = contextPackFromReadViewRecall(vaultRoot, query, recallResult, view, staleAfterDays);
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
            ...readViewProvenance(view),
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
        ...readViewProvenance(view),
        context_pack: contextPack,
        artifact: {
            path: note.path,
            activity_path: note.activity_path,
        },
    };
}
async function handleLint(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    const maxItems = coercePositiveInt(rawArgs.max_items, 40, 1, 2000);
    const profile = graphProfileFromArgs(rawArgs.graph_profile, context);
    const view = await knowledgeReadViewForContext(vaultRoot, context);
    const notes = materializeLightweightNotes(view);
    const graphHealth = profile === 'off' ? undefined : (0, core_1.analyzeGraphHealth)(notes, { maxItems });
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
    const staleAfterDays = coercePositiveInt(rawArgs.stale_after_days, 365, 1, 36500);
    const { issues, doctor } = (0, core_1.lintNotes)(vaultRoot, notes, {
        graphHealth,
        graphProfile: profile,
        staleAfterDays,
    });
    const limitedIssues = issues.slice(0, maxItems);
    return {
        ok: true,
        read_only: true,
        profile: profileEvaluation.profile,
        graph_profile_disabled: profileEvaluation.disabled,
        profile_issues: profileEvaluation.profile_issues,
        vault_root: vaultRoot,
        scanned_at: view.createdAt,
        ...readViewProvenance(view),
        issue_count: issues.length,
        issues: limitedIssues,
        graph_summary: graphHealth ? buildGraphSummary(graphHealth) : null,
        graph_health: lintGraphHealth,
        legacy_structure: buildLegacyStructureSummary(vaultRoot, notes),
        lifecycle_doctor: {
            directory_counts: doctor.directory_counts,
            legacy_candidates: doctor.legacy_candidates.map((candidate) => ({
                path: candidate.path,
                content_hash: candidate.contentHash,
                scope: candidate.scope,
                project_id: candidate.projectId,
                suggestions: candidate.suggestions,
            })),
        },
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
        edge_observation_count: graphHealth.edge_observation_count,
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
function buildSessionNoteBodyWithCloseout(context, summary, outcomes, nextActions, decisions, solutionChanges, lessons, preferences, memoryCandidateRecords) {
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
        contentText(context, '## 长期记忆候选', '## Durable Memory Candidates'),
        ...(memoryCandidateRecords.length > 0
            ? memoryCandidateRecords.map((candidate) => `- [${candidate.scope}] ${candidate.content}`)
            : ['- (none; task facts remain task history only)']),
    ].join('\n');
    return lines.trim();
}
function buildFinishTaskNextActions(context, durableOutput, projectHint) {
    const actions = [];
    if (durableOutputNeedsReview(durableOutput)) {
        actions.push(contentText(context, `知识持久化状态为 ${durableOutput.status}；请在 Obsidian 的知识变更审核中处理。已捕获的 Source 或 Recall 结果不证明 Wiki/Memory 目标已写入。`, `Durable output is ${durableOutput.status}; handle it in Obsidian Knowledge Change Review. Captured Source or Recall results do not prove that the Wiki/Memory target was applied.`));
    }
    if (durableOutput.rejected_count > 0 || durableOutput.unresolved_count > 0) {
        actions.push(contentText(context, `知识持久化状态为 ${durableOutput.status}，请求的 Wiki/Memory 输出未持久化；Source 仍只作为来源证据。`, `Durable output is ${durableOutput.status}; the requested Wiki/Memory output was not persisted, while Source remains provenance evidence only.`));
    }
    if (actions.length === 0 && durableOutput.status === 'applied') {
        actions.push(contentText(context, '知识持久化状态为 applied；已应用的目标路径列在 durable_output.target_paths。', 'Durable output is applied; the applied target paths are listed in durable_output.target_paths.'));
    }
    else if (actions.length === 0 && durableOutput.source_capture_count > 0) {
        actions.push(contentText(context, '已捕获的 Source 可作为来源证据读取，但没有 Wiki/Memory 输出被应用。不要将 Source 或 Recall 可读性描述为知识写入成功。', 'Captured Source is readable provenance, but no Wiki/Memory output was applied. Do not describe Source or Recall readability as successful knowledge writeback.'));
    }
    else if (actions.length === 0) {
        actions.push(contentText(context, '任务追踪已记录；结束时没有关联 Wiki/Memory 持久化输出。', 'Task tracking was recorded; no Wiki/Memory durable output was linked at finish.'));
    }
    if (projectHint) {
        actions.push(contentText(context, '下一次相关任务开始时，请用相同 project_hint 调用 tracekeeper.recall，并设置 scope="project_history"。', 'For the next related session, call tracekeeper.recall with scope="project_history" and the same project_hint.'));
    }
    return actions;
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
    if (proposalResult.memoryChanges.length > 0
        && proposalResult.memoryChanges.every((change) => change.change_kind === 'disabled')) {
        return 'disabled';
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
    const now = new Date().toISOString();
    const creationNonce = crypto.randomUUID();
    const proposalId = (0, core_1.buildStableProposalId)(`distill-session\0${taskId}\0${proposalKind}\0${creationNonce}`);
    const body = [
        contentText(context, `## 提炼内容：${kindLabel}`, `## Distilled ${kindLabel}`),
        writebackContent,
        '',
        `- task_id: ${taskId}`,
        '',
        (0, core_1.renderProposalWritebackSection)(contentText(context, '## 写回内容', '## Writeback'), proposalId, writebackContent),
    ].join('\n');
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
function isFinishTaskDurableOutputSnapshot(value) {
    if (!(0, protocol_1.isRecord)(value)) {
        return false;
    }
    return Array.isArray(value.sourceCapturePaths)
        && value.sourceCapturePaths.every((entry) => typeof entry === 'string')
        && Array.isArray(value.proposals)
        && value.proposals.every((proposal) => {
            return (0, protocol_1.isRecord)(proposal)
                && typeof proposal.proposalId === 'string'
                && typeof proposal.path === 'string'
                && typeof proposal.proposalKind === 'string'
                && typeof proposal.targetPath === 'string'
                && durableProposalStatusFromApproval(String(proposal.status)) === proposal.status
                && typeof proposal.exact === 'boolean';
        });
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
    if (payload.status !== 'completed' && payload.status !== 'partial' && payload.status !== 'blocked') {
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
    if (!Array.isArray(payload.closeoutGroups)) {
        return false;
    }
    if (payload.memoryCandidateRecords !== undefined && (!Array.isArray(payload.memoryCandidateRecords) || !payload.memoryCandidateRecords.every((item) => {
        return (0, protocol_1.isRecord)(item)
            && typeof item.proposal_kind === 'string'
            && typeof item.content === 'string'
            && (item.scope === 'global' || item.scope === 'project')
            && Array.isArray(item.evidence)
            && item.evidence.every((entry) => typeof entry === 'string')
            && Array.isArray(item.supersedes)
            && item.supersedes.every((entry) => typeof entry === 'string')
            && Array.isArray(item.contradicts)
            && item.contradicts.every((entry) => typeof entry === 'string');
    }))) {
        return false;
    }
    if (typeof payload.requestHash !== 'string' || !payload.requestHash) {
        return false;
    }
    if (!(0, protocol_1.isRecord)(payload.requestSnapshot)
        || (typeof payload.requestSnapshot.task_id !== 'string'
            && payload.requestSnapshot.task_id !== null)) {
        return false;
    }
    if (payload.trackingMode !== undefined && payload.trackingMode !== 'live' && payload.trackingMode !== 'closeout_only') {
        return false;
    }
    if (payload.taskRecordOrigin !== undefined
        && payload.taskRecordOrigin !== 'start_task'
        && payload.taskRecordOrigin !== 'finish_task_closeout_only'
        && payload.taskRecordOrigin !== 'finish_task_reconstruction') {
        return false;
    }
    if (payload.startRecovery !== undefined
        && payload.startRecovery !== 'not_requested'
        && payload.startRecovery !== 'matched'
        && payload.startRecovery !== 'not_found') {
        return false;
    }
    if (payload.memoryRecordWriteVersion !== undefined
        && payload.memoryRecordWriteVersion !== 2) {
        return false;
    }
    if (payload.taskRecordCloseoutVersion !== undefined
        && payload.taskRecordCloseoutVersion !== 1) {
        return false;
    }
    if (payload.taskRecordCloseoutVersion === 1
        && (typeof payload.taskFinishedAt !== 'string'
            || Number.isNaN(Date.parse(payload.taskFinishedAt)))) {
        return false;
    }
    if (payload.projectMemoryEntryVersion !== undefined
        && payload.projectMemoryEntryVersion !== 1) {
        return false;
    }
    if (payload.memoryRecordWriteVersion === 2 && payload.closeoutGroups.length > 0) {
        return false;
    }
    if (payload.projectMemoryEntryVersion === 1
        && (typeof payload.projectMemoryCreatedAt !== 'string'
            || Number.isNaN(Date.parse(payload.projectMemoryCreatedAt))
            || typeof payload.projectMemoryAgentType !== 'string'
            || !payload.projectMemoryAgentType)) {
        return false;
    }
    if (payload.durableOutputSnapshot !== undefined
        && !isFinishTaskDurableOutputSnapshot(payload.durableOutputSnapshot)) {
        return false;
    }
    return true;
}
function finishTaskUsesSingleTaskRecord(input) {
    return input.taskRecordCloseoutVersion === 1;
}
function finishTaskTrackingMode(input) {
    return input.trackingMode === 'closeout_only' ? 'closeout_only' : 'live';
}
function finishTaskRecordOrigin(input) {
    if (input.taskRecordOrigin === 'start_task'
        || input.taskRecordOrigin === 'finish_task_closeout_only'
        || input.taskRecordOrigin === 'finish_task_reconstruction') {
        return input.taskRecordOrigin;
    }
    return 'finish_task_reconstruction';
}
function buildFinishTaskCompletionBody(input, context, operationId) {
    return [
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
        contentText(context, '## 长期记忆处理', '## Durable Memory Processing'),
        ...(input.memoryCandidateRecords && input.memoryCandidateRecords.length > 0
            ? input.memoryCandidateRecords.map((candidate) => `- [${candidate.scope}] ${candidate.content}`)
            : ['- (none; task facts remain task history only)']),
        `^finish-${operationId}`,
    ].join('\n');
}
function assertFinishTaskRecordBinding(taskPath, content, taskId, operationId, expectedRequestHash, requireOperationBinding = false, requireRequestBinding = false) {
    const frontmatter = (0, core_1.parseMarkdown)(content).frontmatter.fields;
    const storedTaskId = stripYamlQuotes(readFrontmatterString(frontmatter, ['task_id']));
    const recordType = stripYamlQuotes(readFrontmatterString(frontmatter, ['type']));
    const finishOperationId = stripYamlQuotes(readFrontmatterString(frontmatter, ['finish_operation_id']));
    const finishRequestHash = stripYamlQuotes(readFrontmatterString(frontmatter, ['finish_request_hash']));
    if (storedTaskId !== taskId || (recordType && recordType !== 'agent-task')) {
        throw new core_1.OperationConflictError(`Task path is not the canonical record for task ${taskId}: ${taskPath}`);
    }
    if (finishOperationId && finishOperationId !== operationId) {
        throw new core_1.OperationConflictError(`Task record is bound to another finish-task operation: ${taskPath}`);
    }
    if (requireOperationBinding && finishOperationId !== operationId) {
        throw new core_1.OperationConflictError(`Task record is not bound to the current finish-task operation: ${taskPath}`);
    }
    if (finishRequestHash && finishRequestHash !== expectedRequestHash) {
        throw new core_1.OperationConflictError(`Idempotency conflict: task record has a different finish_task request hash: ${taskPath}`);
    }
    if (requireRequestBinding && finishRequestHash !== expectedRequestHash) {
        throw new core_1.OperationConflictError(`Idempotency conflict: task record is not bound to the current finish_task request hash: ${taskPath}`);
    }
}
async function ensureFinishTaskRecordExists(input, context, operationId) {
    const taskPath = buildTaskNotePath(input.taskId);
    const current = await readCurrentVaultTextState(input.vaultRoot, taskPath, context);
    if (current) {
        assertFinishTaskRecordBinding(taskPath, current.content, input.taskId, operationId, input.requestHash || '', false, finishTaskTrackingMode(input) === 'closeout_only');
        return taskPath;
    }
    const projectIdentity = projectIdentityFromFinishPayload(input);
    const reconstructedAt = input.taskFinishedAt ?? new Date().toISOString();
    const clientName = input.client;
    const trackingMode = finishTaskTrackingMode(input);
    const taskRecordOrigin = finishTaskRecordOrigin(input);
    const isCloseoutOnly = trackingMode === 'closeout_only';
    const objective = input.goal || input.summary;
    const body = isCloseoutOnly
        ? [
            contentText(context, '# Agent 任务', '# Agent Task'),
            '',
            contentText(context, '## 目标', '## Objective'),
            objective,
            '',
            buildFinishTaskCompletionBody(input, context, operationId),
        ].join('\n')
        : [
            contentText(context, '# Agent 任务', '# Agent Task'),
            '',
            contentText(context, '## 目标', '## Objective'),
            objective,
            '',
            contentText(context, '## 重建说明', '## Reconstruction'),
            '- start_record: missing',
            '- reconstructed_by: tracekeeper.finish_task',
            `- reconstructed_at: ${reconstructedAt}`,
            `- objective_source: ${input.goal ? 'recovered_start_payload' : 'finish_summary'}`,
            '',
            buildFinishTaskCompletionBody(input, context, operationId),
        ].join('\n');
    const markdown = buildMarkdownNote({
        tool: 'tracekeeper.finish_task',
        type: 'agent-task',
        title: `Task ${input.taskId}`,
        task_id: input.taskId,
        status: 'closing',
        agent: clientName || 'unknown',
        client: clientName || null,
        session_id: null,
        objective,
        objective_source: isCloseoutOnly ? 'finish_task_goal' : input.goal ? 'recovered_start_payload' : 'finish_summary',
        project_hint: input.projectHint || null,
        related_project: input.projectHint || null,
        project_id: input.projectId || null,
        repo_path: input.repoPath || null,
        project_identity_source: projectIdentity.source,
        project_identity_confidence: projectIdentity.confidence,
        project_identity_warnings: projectIdentity.warnings,
        tracking_mode: trackingMode,
        task_record_origin: taskRecordOrigin,
        started_at: input.startedAt || null,
        started_at_source: input.startedAtSource || 'unknown',
        tracking_started_at: input.trackingStartedAt || null,
        recorded_at: input.recordedAt || reconstructedAt,
        start_recovery: input.startRecovery || 'not_requested',
        ...(input.recordingReason ? { recording_reason: input.recordingReason } : {}),
        ...(input.startOperationId ? { start_operation_id: input.startOperationId } : {}),
        ...(isCloseoutOnly ? {} : {
            start_record_missing: true,
            reconstructed_at: reconstructedAt,
        }),
        finish_recorded_at: reconstructedAt,
        finish_operation_id: operationId,
        finish_request_hash: input.requestHash || null,
    }, body);
    try {
        if (context.vaultRepository) {
            await context.vaultRepository.createText(taskPath, markdown);
        }
        else {
            const resolved = (0, safety_1.resolveSafeWritableNotePath)(input.vaultRoot, taskPath, AGENT_TASK_DIR, pathSafetyOptions(context));
            fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });
            fs.writeFileSync(resolved.absolutePath, markdown, { encoding: 'utf8', flag: 'wx' });
        }
    }
    catch (error) {
        const racedRecord = await readCurrentVaultTextState(input.vaultRoot, taskPath, context);
        if (!racedRecord) {
            throw error;
        }
        assertFinishTaskRecordBinding(taskPath, racedRecord.content, input.taskId, operationId, input.requestHash || '', false, isCloseoutOnly);
        return taskPath;
    }
    await (0, audit_persistence_1.appendAuditEventAsync)(input.vaultRoot, {
        operationId,
        tool: 'tracekeeper.finish_task',
        targetPath: taskPath,
        status: 'written',
        taskId: input.taskId,
        timestamp: reconstructedAt,
        metadata: {
            target_type: 'agent_task',
            task_stage: isCloseoutOnly ? 'closeout' : 'finish',
        },
    }, context);
    return taskPath;
}
function assertFinishTaskLifecycleRequestBinding(input, lifecycle, operationId) {
    if (lifecycle?.finishOperationId === operationId
        && (lifecycle.status === 'closing' || lifecycle.status === 'completed')
        && lifecycle.finishRequestHash !== input.requestHash) {
        throw new core_1.OperationConflictError(`Idempotency conflict: task lifecycle has a different finish_task request hash: ${input.taskId}`);
    }
}
async function synchronizeFinishTaskTimestampFromRecord(input, context) {
    const current = await readCurrentVaultTextState(input.vaultRoot, buildTaskNotePath(input.taskId), context);
    if (!current) {
        return;
    }
    const fields = (0, core_1.parseMarkdown)(current.content).frontmatter.fields;
    const recordedAt = stripYamlQuotes(readFrontmatterString(fields, ['finish_recorded_at'])) || (finishTaskTrackingMode(input) === 'closeout_only'
        ? stripYamlQuotes(readFrontmatterString(fields, ['recorded_at']))
        : '');
    if (!recordedAt || Number.isNaN(Date.parse(recordedAt))) {
        return;
    }
    const normalized = new Date(Date.parse(recordedAt)).toISOString();
    input.taskFinishedAt = normalized;
    input.projectMemoryCreatedAt = normalized;
    if (finishTaskTrackingMode(input) === 'closeout_only') {
        input.recordedAt = normalized;
    }
}
async function markFinishTaskRecordClosing(input, context, operationId) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        await ensureFinishTaskRecordExists(input, context, operationId);
        const currentLifecycle = await readTaskLifecycleStateAsync(input.vaultRoot, input.taskId, context);
        assertFinishTaskLifecycleRequestBinding(input, currentLifecycle, operationId);
        if (currentLifecycle?.finishOperationId === operationId
            && (currentLifecycle.status === 'closing' || currentLifecycle.status === 'completed')) {
            await synchronizeFinishTaskTimestampFromRecord(input, context);
            return;
        }
        try {
            const taskPath = await updateAgentTaskRecordAsync(input.vaultRoot, input.taskId, {
                status: 'closing',
                finish_operation_id: operationId,
                finish_request_hash: input.requestHash || null,
                ...(finishTaskTrackingMode(input) === 'live'
                    ? { finish_recorded_at: input.taskFinishedAt ?? new Date().toISOString() }
                    : {}),
            }, context);
            if (taskPath) {
                await synchronizeFinishTaskTimestampFromRecord(input, context);
                return;
            }
        }
        catch (error) {
            const lifecycle = await readTaskLifecycleStateAsync(input.vaultRoot, input.taskId, context);
            assertFinishTaskLifecycleRequestBinding(input, lifecycle, operationId);
            if (lifecycle?.finishOperationId === operationId
                && (lifecycle.status === 'closing' || lifecycle.status === 'completed')) {
                await synchronizeFinishTaskTimestampFromRecord(input, context);
                return;
            }
            if (attempt === 1) {
                throw error;
            }
        }
    }
    throw new core_1.OperationConflictError(`Task record could not be reconstructed for finish-task operation: ${buildTaskNotePath(input.taskId)}`);
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
function durableOutputSnapshotFromFinishPayload(input) {
    return input.durableOutputSnapshot ?? {
        sourceCapturePaths: [],
        proposals: [],
    };
}
async function buildFinishTaskDurableOutput(input, proposalResult, context) {
    const snapshot = durableOutputSnapshotFromFinishPayload(input);
    const proposals = [...snapshot.proposals];
    const seenIds = new Set(proposals.map((proposal) => proposal.proposalId).filter(Boolean));
    const seenPaths = new Set(proposals.map((proposal) => proposal.path).filter(Boolean));
    for (const proposal of proposalResult.proposals) {
        if (seenIds.has(proposal.proposalId) || seenPaths.has(proposal.path)) {
            continue;
        }
        const generated = await snapshotExactTaskProposal(input.vaultRoot, input.taskId, proposal.proposalId, proposal.path, context, 'pending_review');
        proposals.push(generated);
        if (generated.proposalId) {
            seenIds.add(generated.proposalId);
        }
        if (generated.path) {
            seenPaths.add(generated.path);
        }
    }
    const counts = {
        pending_review: 0,
        ready_to_apply: 0,
        revision_requested: 0,
        applied: 0,
        rejected: 0,
        unresolved: 0,
    };
    for (const proposal of proposals) {
        counts[proposal.status] += 1;
    }
    const targetPaths = new Set(proposals
        .map((proposal) => proposal.targetPath)
        .filter(Boolean));
    const autoAppliedKeys = new Set();
    for (const update of proposalResult.autoAppliedMemoryUpdates) {
        const key = update.operation_id || `${update.kind}\0${update.path}`;
        if (autoAppliedKeys.has(key)) {
            continue;
        }
        autoAppliedKeys.add(key);
        counts.applied += 1;
        try {
            const normalized = (0, safety_1.normalizeNotePath)(update.path, pathSafetyOptions(context));
            if ((0, core_1.isAllowedProposalTargetPath)(normalized)) {
                targetPaths.add(normalized);
            }
        }
        catch {
            // Invalid auto-write targets are omitted from the target summary.
        }
    }
    const activeStatuses = Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([status]) => status);
    const status = activeStatuses.length === 0
        ? 'none'
        : activeStatuses.length === 1
            ? activeStatuses[0]
            : 'mixed';
    return {
        summary: {
            status,
            source_capture_count: snapshot.sourceCapturePaths.length,
            proposal_count: proposals.length,
            pending_review_count: counts.pending_review,
            ready_to_apply_count: counts.ready_to_apply,
            revision_requested_count: counts.revision_requested,
            applied_count: counts.applied,
            rejected_count: counts.rejected,
            unresolved_count: counts.unresolved,
            proposal_paths: [...new Set(proposals.map((proposal) => proposal.path).filter(Boolean))],
            target_paths: [...targetPaths],
        },
        proposalIdsAtFinish: [
            ...new Set(proposals
                .filter((proposal) => proposal.exact)
                .map((proposal) => proposal.proposalId)
                .filter(Boolean)),
        ],
    };
}
function aggregateFinishTaskProposalReferences(input, proposalResult, sessionNotePath, context) {
    const aggregated = [];
    const seenIds = new Set();
    const seenPaths = new Set();
    const add = (proposal) => {
        if (seenIds.has(proposal.proposalId)
            || seenPaths.has(proposal.path)) {
            return;
        }
        seenIds.add(proposal.proposalId);
        seenPaths.add(proposal.path);
        aggregated.push(proposal);
    };
    for (const proposal of durableOutputSnapshotFromFinishPayload(input).proposals) {
        if (!proposal.exact || !proposal.proposalId || !proposal.path) {
            continue;
        }
        const link = generateProposalMarkdownLink(context, proposal.path, sessionNotePath);
        add({
            kind: proposal.proposalKind || 'unknown',
            proposalId: proposal.proposalId,
            path: proposal.path,
            linkTarget: proposal.path,
            ...(link ? { link } : {}),
        });
    }
    for (const proposal of proposalResult.proposals) {
        add(proposal);
    }
    return aggregated;
}
function durableOutputFrontmatterFields(evidence) {
    const durableOutput = evidence.summary;
    return {
        durable_output_status_at_finish: durableOutput.status,
        durable_output_source_capture_count: String(durableOutput.source_capture_count),
        durable_output_proposal_count: String(durableOutput.proposal_count),
        durable_output_pending_review_count: String(durableOutput.pending_review_count),
        durable_output_ready_to_apply_count: String(durableOutput.ready_to_apply_count),
        durable_output_revision_requested_count: String(durableOutput.revision_requested_count),
        durable_output_applied_count: String(durableOutput.applied_count),
        durable_output_rejected_count: String(durableOutput.rejected_count),
        durable_output_unresolved_count: String(durableOutput.unresolved_count),
        durable_output_proposal_ids_at_finish: evidence.proposalIdsAtFinish.join(', '),
        durable_output_proposal_paths: durableOutput.proposal_paths.join(', '),
        durable_output_target_paths: durableOutput.target_paths.join(', '),
    };
}
function isFinishTaskDurableOutputEvidenceConsistent(evidence, context) {
    const summary = evidence.summary;
    const stateCounts = [
        ['pending_review', summary.pending_review_count],
        ['ready_to_apply', summary.ready_to_apply_count],
        ['revision_requested', summary.revision_requested_count],
        ['applied', summary.applied_count],
        ['rejected', summary.rejected_count],
        ['unresolved', summary.unresolved_count],
    ];
    const activeStates = stateCounts.filter(([, count]) => count > 0);
    const expectedStatus = activeStates.length === 0
        ? 'none'
        : activeStates.length === 1
            ? activeStates[0][0]
            : 'mixed';
    if (summary.status !== expectedStatus) {
        return false;
    }
    const nonAppliedProposalCount = summary.pending_review_count
        + summary.ready_to_apply_count
        + summary.revision_requested_count
        + summary.rejected_count
        + summary.unresolved_count;
    const maximumProposalCount = nonAppliedProposalCount + summary.applied_count;
    if (!Number.isSafeInteger(nonAppliedProposalCount)
        || !Number.isSafeInteger(maximumProposalCount)
        || summary.proposal_count < nonAppliedProposalCount
        || summary.proposal_count > maximumProposalCount) {
        return false;
    }
    const uniqueList = (values) => new Set(values).size === values.length;
    if (!uniqueList(evidence.proposalIdsAtFinish)
        || !uniqueList(summary.proposal_paths)
        || !uniqueList(summary.target_paths)
        || evidence.proposalIdsAtFinish.length > summary.proposal_count
        || summary.proposal_paths.length > summary.proposal_count
        || summary.target_paths.length > summary.proposal_count + summary.applied_count) {
        return false;
    }
    const exactNonAppliedCount = summary.pending_review_count
        + summary.ready_to_apply_count
        + summary.revision_requested_count
        + summary.rejected_count;
    if (evidence.proposalIdsAtFinish.length < exactNonAppliedCount
        || summary.proposal_paths.length < exactNonAppliedCount
        || (summary.ready_to_apply_count
            + summary.revision_requested_count
            + summary.applied_count
            + summary.rejected_count > 0
            && summary.target_paths.length === 0)) {
        return false;
    }
    if (evidence.proposalIdsAtFinish.some((proposalId) => proposalId.length === 0 || proposalId.length > 512)) {
        return false;
    }
    const exactNormalizedPath = (value) => {
        try {
            const normalized = (0, safety_1.normalizeNotePath)(value, pathSafetyOptions(context));
            return normalized === value ? normalized : null;
        }
        catch {
            return null;
        }
    };
    if (summary.proposal_paths.some((proposalPath) => {
        const normalized = exactNormalizedPath(proposalPath);
        return !normalized || !normalized.startsWith(`${REVIEW_QUEUE_PREFIX}/`);
    })) {
        return false;
    }
    return summary.target_paths.every((targetPath) => {
        const normalized = exactNormalizedPath(targetPath);
        return Boolean(normalized && (0, core_1.isAllowedProposalTargetPath)(normalized));
    });
}
function durableOutputFromFrontmatter(frontmatter, context) {
    const requiredKeys = [
        'durable_output_status_at_finish',
        'durable_output_source_capture_count',
        'durable_output_proposal_count',
        'durable_output_pending_review_count',
        'durable_output_ready_to_apply_count',
        'durable_output_revision_requested_count',
        'durable_output_applied_count',
        'durable_output_rejected_count',
        'durable_output_unresolved_count',
        'durable_output_proposal_ids_at_finish',
        'durable_output_proposal_paths',
        'durable_output_target_paths',
    ];
    if (!requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(frontmatter, key))) {
        return null;
    }
    const status = readFrontmatterString(frontmatter, ['durable_output_status_at_finish']);
    if (!isDurableOutputStatus(status)) {
        return null;
    }
    const count = (key) => {
        const value = readFrontmatterString(frontmatter, [key]);
        if (!/^\d+$/.test(value)) {
            return null;
        }
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) ? parsed : null;
    };
    const counts = {
        source_capture_count: count('durable_output_source_capture_count'),
        proposal_count: count('durable_output_proposal_count'),
        pending_review_count: count('durable_output_pending_review_count'),
        ready_to_apply_count: count('durable_output_ready_to_apply_count'),
        revision_requested_count: count('durable_output_revision_requested_count'),
        applied_count: count('durable_output_applied_count'),
        rejected_count: count('durable_output_rejected_count'),
        unresolved_count: count('durable_output_unresolved_count'),
    };
    if (Object.values(counts).some((value) => value === null)) {
        return null;
    }
    const evidence = {
        summary: {
            status,
            source_capture_count: counts.source_capture_count,
            proposal_count: counts.proposal_count,
            pending_review_count: counts.pending_review_count,
            ready_to_apply_count: counts.ready_to_apply_count,
            revision_requested_count: counts.revision_requested_count,
            applied_count: counts.applied_count,
            rejected_count: counts.rejected_count,
            unresolved_count: counts.unresolved_count,
            proposal_paths: readFrontmatterStringList(frontmatter, 'durable_output_proposal_paths'),
            target_paths: readFrontmatterStringList(frontmatter, 'durable_output_target_paths'),
        },
        proposalIdsAtFinish: readFrontmatterStringList(frontmatter, 'durable_output_proposal_ids_at_finish'),
    };
    return isFinishTaskDurableOutputEvidenceConsistent(evidence, context)
        ? evidence
        : null;
}
async function readFinishTaskDurableOutputEvidence(input, finishRecordPath, context, mode) {
    const finishRecord = await readCurrentVaultTextState(input.vaultRoot, finishRecordPath, context);
    const task = await readCurrentVaultTextState(input.vaultRoot, buildTaskNotePath(input.taskId), context);
    const finishRecordFrontmatter = finishRecord
        ? (0, core_1.parseMarkdown)(finishRecord.content).frontmatter.fields
        : {};
    const taskFrontmatter = task
        ? (0, core_1.parseMarkdown)(task.content).frontmatter.fields
        : {};
    const finishRecordEvidence = finishRecord
        ? durableOutputFromFrontmatter(finishRecordFrontmatter, context)
        : null;
    const taskEvidence = task
        ? durableOutputFromFrontmatter(taskFrontmatter, context)
        : null;
    const finishRecordHasEvidenceFields = Object.keys(finishRecordFrontmatter)
        .some((key) => key.startsWith('durable_output_'));
    const taskHasEvidenceFields = Object.keys(taskFrontmatter)
        .some((key) => key.startsWith('durable_output_'));
    if (finishTaskUsesSingleTaskRecord(input)) {
        if (mode === 'finalize' && !taskEvidence) {
            throw new core_1.OperationConflictError('Finish-task durable-output evidence is not complete in the task record.');
        }
        if (taskEvidence) {
            return taskEvidence;
        }
        if (finishRecordHasEvidenceFields || taskHasEvidenceFields) {
            throw new core_1.OperationConflictError('Finish-task durable-output evidence is incomplete, invalid, or internally inconsistent.');
        }
        return null;
    }
    if (finishRecordEvidence
        && taskEvidence
        && JSON.stringify(finishRecordEvidence) !== JSON.stringify(taskEvidence)) {
        throw new core_1.OperationConflictError('Finish-task durable-output evidence differs between the task and session records.');
    }
    if (mode === 'finalize') {
        if (!finishRecordEvidence || !taskEvidence) {
            throw new core_1.OperationConflictError('Finish-task durable-output evidence is not complete in both the task and session records.');
        }
        return finishRecordEvidence;
    }
    const trustedEvidence = finishRecordEvidence ?? taskEvidence;
    if (trustedEvidence) {
        return trustedEvidence;
    }
    if (finishRecordHasEvidenceFields || taskHasEvidenceFields) {
        throw new core_1.OperationConflictError('Finish-task durable-output evidence is incomplete, invalid, or internally inconsistent.');
    }
    return null;
}
async function updateManagedRecordFields(vaultRoot, recordPath, fields, context) {
    const current = await readCurrentVaultTextState(vaultRoot, recordPath, context);
    if (!current) {
        throw new core_1.OperationConflictError(`Tracekeeper-managed record is unavailable: ${recordPath}`);
    }
    const next = updateFrontmatterFields(current.content, fields);
    if (next === current.content) {
        return;
    }
    if (context.vaultRepository) {
        if (!current.version) {
            throw new core_1.OperationConflictError(`Tracekeeper-managed record version is unavailable: ${recordPath}`);
        }
        await context.vaultRepository.replaceText(current.path, current.version, next);
        return;
    }
    const absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, current.path, pathSafetyOptions(context));
    replaceTextFileAtomically(absolute, next, current.content);
}
function buildFinishTaskRequestSnapshot(rawArgs) {
    const explicitIdentity = (0, project_identity_1.resolveProjectIdentity)(rawArgs);
    const taskId = coerceOptionalString(rawArgs.task_id);
    const hasCloseoutOnlyField = [
        rawArgs.goal,
        rawArgs.started_at,
        rawArgs.recording_reason,
        rawArgs.start_idempotency_key,
    ].some((value) => value !== undefined && value !== null && value !== '');
    if (taskId && hasCloseoutOnlyField) {
        throw new safety_1.ToolInputError('goal, started_at, recording_reason, and start_idempotency_key must be omitted when task_id is provided.');
    }
    const goal = taskId ? '' : coerceNonEmptyString(rawArgs.goal, true, 'goal');
    if (!taskId && goal.length < 3) {
        throw new safety_1.ToolInputError('goal must have at least 3 characters.');
    }
    const startedAt = taskId ? '' : coerceIsoTimestamp(rawArgs.started_at, true, 'started_at');
    const recordingReason = taskId ? null : coerceRecordingReason(rawArgs.recording_reason);
    const startIdempotencyKey = taskId ? '' : coerceOptionalString(rawArgs.start_idempotency_key);
    if (recordingReason === 'start_unavailable' && !startIdempotencyKey) {
        throw new safety_1.ToolInputError('start_idempotency_key is required when recording_reason is start_unavailable.');
    }
    if (recordingReason === 'ordinary_closeout' && startIdempotencyKey) {
        throw new safety_1.ToolInputError('start_idempotency_key is allowed only when recording_reason is start_unavailable.');
    }
    if (startIdempotencyKey.length > 512) {
        throw new safety_1.ToolInputError('start_idempotency_key must be at most 512 characters.');
    }
    if (!taskId && !coerceOptionalString(rawArgs.idempotency_key)) {
        throw new safety_1.ToolInputError('idempotency_key is required when task_id is omitted.');
    }
    if (!taskId && (rawArgs.status === undefined || rawArgs.status === null || rawArgs.status === '')) {
        throw new safety_1.ToolInputError('status is required when task_id is omitted.');
    }
    return {
        task_id: taskId || null,
        goal: goal || null,
        started_at: startedAt || null,
        recording_reason: recordingReason,
        start_idempotency_key: startIdempotencyKey || null,
        summary: coerceNonEmptyString(rawArgs.summary, true, 'summary'),
        status: coerceFinishTaskStatus(rawArgs.status),
        outcomes: coerceStringOrStringArray(rawArgs.outcomes, 'outcomes'),
        next_actions: coerceStringOrStringArray(rawArgs.next_actions, 'next_actions'),
        decisions: coerceStringOrStringArray(rawArgs.decisions, 'decisions'),
        solution_changes: coerceStringOrStringArray(rawArgs.solution_changes, 'solution_changes'),
        lessons: coerceStringOrStringArray(rawArgs.lessons, 'lessons'),
        preferences: coerceStringOrStringArray(rawArgs.preferences, 'preferences'),
        memory_candidate_records: normalizeFinishTaskMemoryCandidateRecords(rawArgs.memory_candidate_records),
        client: coerceOptionalString(rawArgs.client) || null,
        project_hint: explicitIdentity.projectHint || null,
        project_id: explicitIdentity.projectId || null,
        repo_path: explicitIdentity.repoPath || null,
        related_wiki: normalizeMultiValueList(rawArgs.related_wiki, 'related_wiki'),
        related_sources: normalizeMultiValueList(rawArgs.related_sources, 'related_sources'),
        filename: coerceOptionalString(rawArgs.filename) || null,
    };
}
function assertRecoveredStartPayloadMatches(payload, goal, startedAt, client, explicitIdentity) {
    if (coerceOptionalString(payload.goal) !== goal) {
        throw new core_1.OperationConflictError('Original start_task goal does not match the closeout goal.');
    }
    const startClient = coerceOptionalString(payload.client);
    if (startClient && client && startClient !== client) {
        throw new core_1.OperationConflictError('Original start_task client does not match the closeout client.');
    }
    const originalStartedAt = coerceOptionalString(payload.clientStartedAt);
    if (originalStartedAt && coerceIsoTimestamp(originalStartedAt, true, 'started_at') !== startedAt) {
        throw new core_1.OperationConflictError('Original start_task started_at does not match the closeout started_at.');
    }
    for (const [field, startValue, finishValue] of [
        ['project_hint', coerceOptionalString(payload.projectHint), explicitIdentity.projectHint],
        ['project_id', coerceOptionalString(payload.projectId), explicitIdentity.projectId],
        ['repo_path', coerceOptionalString(payload.repoPath), explicitIdentity.repoPath],
    ]) {
        if (!projectIdentityValueMatches(field, startValue, finishValue)) {
            throw new core_1.OperationConflictError(`Original start_task ${field} does not match the closeout request.`);
        }
    }
}
function finishRecordingFromTaskMetadata(taskId, metadata, projectIdentity, client, startRecovery, fallback) {
    const hasStartRecord = metadata.startOperationId.length > 0;
    return {
        taskId,
        goal: metadata.objective || fallback.goal,
        taskMetadata: metadata,
        projectIdentity,
        client: client || metadata.client,
        trackingMode: 'live',
        taskRecordOrigin: hasStartRecord ? 'start_task' : 'finish_task_reconstruction',
        startedAt: metadata.startedAt || fallback.startedAt,
        startedAtSource: metadata.startedAtSource !== 'unknown'
            ? metadata.startedAtSource
            : fallback.startedAtSource,
        trackingStartedAt: metadata.trackingStartedAt || fallback.trackingStartedAt,
        recordedAt: metadata.recordedAt || fallback.recordedAt,
        startRecovery,
        recordingReason: startRecovery === 'matched' ? 'start_unavailable' : null,
        startOperationId: metadata.startOperationId || fallback.startOperationId,
    };
}
async function resolveFinishTaskRecording(rawArgs, context, operationId, explicitIdentity, finishedAt) {
    const vaultRoot = configuredVaultRoot(context);
    const explicitTaskId = coerceOptionalString(rawArgs.task_id);
    const requestedClient = coerceOptionalString(rawArgs.client);
    if (explicitTaskId) {
        const metadata = await readAgentTaskMetadataAsync(vaultRoot, explicitTaskId, context);
        const projectIdentity = mergeTaskProjectIdentity(explicitTaskId, metadata, explicitIdentity);
        return finishRecordingFromTaskMetadata(explicitTaskId, metadata, projectIdentity, requestedClient, 'not_requested', {
            goal: '',
            startedAt: '',
            startedAtSource: 'unknown',
            trackingStartedAt: '',
            recordedAt: finishedAt,
            startOperationId: '',
        });
    }
    const goal = coerceNonEmptyString(rawArgs.goal, true, 'goal');
    const startedAt = coerceIsoTimestamp(rawArgs.started_at, true, 'started_at');
    const recordingReason = coerceRecordingReason(rawArgs.recording_reason);
    if (recordingReason === 'start_unavailable') {
        const startIdempotencyKey = coerceNonEmptyString(rawArgs.start_idempotency_key, true, 'start_idempotency_key');
        const startOperationId = buildOperationIdFromIdempotencyKey('start-task', startIdempotencyKey);
        const expectedTaskId = `obs_task_${startOperationId.slice('start-task-'.length)}`;
        let taskState = await readCurrentVaultTextState(vaultRoot, buildTaskNotePath(expectedTaskId), context);
        let startRecord = await operationJournalForVault(vaultRoot).loadById(startOperationId);
        if (taskState) {
            const metadata = agentTaskMetadataFromFrontmatter((0, core_1.parseMarkdown)(taskState.content).frontmatter.fields);
            if (metadata.startOperationId !== startOperationId) {
                throw new core_1.OperationConflictError('Recovered task is not bound to the supplied start_idempotency_key.');
            }
            if (metadata.objective && metadata.objective !== goal) {
                throw new core_1.OperationConflictError('Recovered task goal does not match the closeout goal.');
            }
            if (metadata.client && requestedClient && metadata.client !== requestedClient) {
                throw new core_1.OperationConflictError('Recovered task client does not match the closeout client.');
            }
            if (metadata.startedAt
                && metadata.startedAtSource === 'client_claim'
                && coerceIsoTimestamp(metadata.startedAt, true, 'started_at') !== startedAt) {
                throw new core_1.OperationConflictError('Recovered task started_at does not match the closeout started_at.');
            }
            const projectIdentity = mergeTaskProjectIdentity(expectedTaskId, metadata, explicitIdentity);
            return finishRecordingFromTaskMetadata(expectedTaskId, metadata, projectIdentity, requestedClient, 'matched', {
                goal,
                startedAt,
                startedAtSource: 'client_claim',
                trackingStartedAt: metadata.trackingStartedAt,
                recordedAt: metadata.recordedAt || finishedAt,
                startOperationId,
            });
        }
        if (startRecord) {
            if (startRecord.idempotency_key !== startIdempotencyKey || !(0, protocol_1.isRecord)(startRecord.payload)) {
                throw new core_1.OperationConflictError('Original start_task journal binding is incompatible.');
            }
            assertRecoveredStartPayloadMatches(startRecord.payload, goal, startedAt, requestedClient, explicitIdentity);
            await handleStartTask({
                goal: startRecord.payload.goal,
                client: startRecord.payload.client,
                started_at: startRecord.payload.clientStartedAt,
                project_hint: startRecord.payload.projectHint,
                project_id: startRecord.payload.projectId,
                repo_path: startRecord.payload.repoPath,
                idempotency_key: startIdempotencyKey,
            }, context);
            taskState = await readCurrentVaultTextState(vaultRoot, buildTaskNotePath(expectedTaskId), context);
            startRecord = await operationJournalForVault(vaultRoot).loadById(startOperationId);
            const metadata = taskState
                ? agentTaskMetadataFromFrontmatter((0, core_1.parseMarkdown)(taskState.content).frontmatter.fields)
                : emptyAgentTaskMetadata();
            const startPayload = (0, protocol_1.isRecord)(startRecord?.payload) ? startRecord.payload : {};
            const originalClientStartedAt = coerceOptionalString(startPayload.clientStartedAt);
            const projectIdentity = taskState
                ? mergeTaskProjectIdentity(expectedTaskId, metadata, explicitIdentity)
                : explicitIdentity;
            return finishRecordingFromTaskMetadata(expectedTaskId, metadata, projectIdentity, requestedClient || coerceOptionalString(startPayload.client), 'matched', {
                goal,
                startedAt: originalClientStartedAt
                    ? coerceIsoTimestamp(originalClientStartedAt, true, 'started_at')
                    : startRecord?.created_at || startedAt,
                startedAtSource: originalClientStartedAt ? 'client_claim' : 'server_observed',
                trackingStartedAt: startRecord?.created_at || finishedAt,
                recordedAt: startRecord?.created_at || finishedAt,
                startOperationId,
            });
        }
    }
    const taskId = `obs_task_${operationId.slice('finish-task-'.length)}`;
    return {
        taskId,
        goal,
        taskMetadata: emptyAgentTaskMetadata(),
        projectIdentity: explicitIdentity,
        client: requestedClient,
        trackingMode: 'closeout_only',
        taskRecordOrigin: 'finish_task_closeout_only',
        startedAt,
        startedAtSource: 'client_claim',
        trackingStartedAt: '',
        recordedAt: finishedAt,
        startRecovery: recordingReason === 'start_unavailable' ? 'not_found' : 'not_requested',
        recordingReason,
        startOperationId: '',
    };
}
async function buildFinishTaskOperationPayload(rawArgs, context, operationId, requestHash, requestSnapshot) {
    const vaultRoot = configuredVaultRoot(context);
    const summary = coerceNonEmptyString(rawArgs.summary, true, 'summary');
    const status = coerceFinishTaskStatus(rawArgs.status);
    const outcomes = coerceStringOrStringArray(rawArgs.outcomes, 'outcomes');
    const nextActions = coerceStringOrStringArray(rawArgs.next_actions, 'next_actions');
    const decisions = coerceStringOrStringArray(rawArgs.decisions, 'decisions');
    const solutionChanges = coerceStringOrStringArray(rawArgs.solution_changes, 'solution_changes');
    const lessons = coerceStringOrStringArray(rawArgs.lessons, 'lessons');
    const preferences = coerceStringOrStringArray(rawArgs.preferences, 'preferences');
    const memoryCandidates = [];
    const memoryCandidateRecords = normalizeFinishTaskMemoryCandidateRecords(rawArgs.memory_candidate_records);
    const reviewProposalMode = DEFAULT_FINISH_TASK_REVIEW_MODE;
    const taskFinishedAt = new Date().toISOString();
    const identityScan = scanVaultForContext(vaultRoot, context);
    const explicitIdentity = (0, project_identity_1.resolveProjectIdentity)(rawArgs, identityScan.notes);
    const recording = await resolveFinishTaskRecording(rawArgs, context, operationId, explicitIdentity, taskFinishedAt);
    const taskId = recording.taskId;
    const taskMetadata = recording.taskMetadata;
    const durableOutputSnapshot = await snapshotTaskDurableOutput(vaultRoot, taskId, taskMetadata, context);
    const projectIdentity = recording.projectIdentity;
    const client = recording.client;
    const projectHint = projectIdentity.projectHint;
    const memoryScope = '';
    const relatedWiki = normalizeMultiValueList(rawArgs.related_wiki, 'related_wiki');
    const relatedSources = normalizeMultiValueList(rawArgs.related_sources, 'related_sources');
    const architectureStatus = buildArchitectureStatus(vaultRoot, context);
    const bridgeMetadata = resolveProjectMemoryBridgeMetadata(vaultRoot, resolveMemoryScope('session_finish', '', projectHint, memoryScope), projectHint, relatedWiki, relatedSources, context);
    const filename = buildSafeFilename(rawArgs.filename || `finish-${taskId}-${operationId}`, 'session', context);
    const closeoutGroups = [];
    return {
        requestHash,
        requestSnapshot,
        memoryRecordWriteVersion: 2,
        taskRecordCloseoutVersion: 1,
        taskFinishedAt,
        projectMemoryCreatedAt: taskFinishedAt,
        projectMemoryAgentType: (() => {
            const observed = context.observedClientType ?? (0, observed_client_1.normalizeObservedClientType)(client);
            return observed === 'unknown' ? 'custom' : observed;
        })(),
        taskId,
        goal: recording.goal,
        trackingMode: recording.trackingMode,
        taskRecordOrigin: recording.taskRecordOrigin,
        startedAt: recording.startedAt,
        startedAtSource: recording.startedAtSource,
        trackingStartedAt: recording.trackingStartedAt,
        recordedAt: recording.recordedAt,
        startRecovery: recording.startRecovery,
        recordingReason: recording.recordingReason,
        startOperationId: recording.startOperationId,
        summary,
        status,
        outcomes,
        nextActions,
        decisions,
        solutionChanges,
        lessons,
        preferences,
        memoryCandidates,
        memoryCandidateRecords,
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
        hasCloseoutCandidates: memoryCandidateRecords.length > 0,
        contentLanguage: contentLanguageFromContext(context),
        durableOutputSnapshot,
    };
}
function resolveFinishTaskSessionNotePath(input, context) {
    const safeLeaf = (0, safety_1.normalizeNotePath)(input.filename, pathSafetyOptions(context));
    const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
    return `${SESSION_NOTE_DIR}/${normalized}`;
}
function resolveFinishTaskRecordPath(input, context) {
    return finishTaskUsesSingleTaskRecord(input)
        ? buildTaskNotePath(input.taskId)
        : resolveFinishTaskSessionNotePath(input, context);
}
async function findFinishTaskRecord(input, context, operationId) {
    if (!finishTaskUsesSingleTaskRecord(input)) {
        const sessionNote = await findOperationOwnedNoteAsync(input.vaultRoot, SESSION_NOTE_DIR, input.filename, 'finish_operation_id', operationId, context);
        if (!sessionNote) {
            throw new safety_1.ToolInputError(`Session note is missing for finish-task operation: ${resolveFinishTaskSessionNotePath(input, context)}`);
        }
        return sessionNote;
    }
    const taskPath = buildTaskNotePath(input.taskId);
    let task = await readCurrentVaultTextState(input.vaultRoot, taskPath, context);
    if (!task) {
        await ensureFinishTaskRecordExists(input, context, operationId);
        task = await readCurrentVaultTextState(input.vaultRoot, taskPath, context);
    }
    if (!task) {
        throw new core_1.OperationConflictError(`Task record could not be reconstructed for finish-task operation: ${taskPath}`);
    }
    assertFinishTaskRecordBinding(taskPath, task.content, input.taskId, operationId, input.requestHash || '', true, finishTaskTrackingMode(input) === 'closeout_only');
    const audit = await (0, audit_persistence_1.appendAuditEventAsync)(input.vaultRoot, {
        operationId,
        tool: 'tracekeeper.finish_task',
        targetPath: taskPath,
        status: 'written',
        taskId: input.taskId,
        timestamp: input.taskFinishedAt,
        metadata: {
            target_type: 'agent_task',
            task_stage: 'finish',
        },
    }, context);
    return { path: taskPath, activity_path: audit.path };
}
async function writeFinishTaskSessionNote(input, context, operationId) {
    const projectIdentity = projectIdentityFromFinishPayload(input);
    const body = buildSessionNoteBodyWithCloseout(context, input.summary, input.outcomes, input.nextActions, input.decisions, input.solutionChanges, input.lessons, input.preferences, input.memoryCandidateRecords ?? []);
    assertNoSensitiveText([
        { label: 'summary', value: input.summary },
        { label: 'outcomes', value: input.outcomes.join('\n') },
        { label: 'next_actions', value: input.nextActions.join('\n') },
        { label: 'decisions', value: input.decisions.join('\n') },
        { label: 'solution_changes', value: input.solutionChanges.join('\n') },
        { label: 'lessons', value: input.lessons.join('\n') },
        { label: 'preferences', value: input.preferences.join('\n') },
        { label: 'memory_candidate_records', value: (input.memoryCandidateRecords ?? []).map((candidate) => candidate.content).join('\n') },
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
        await (0, audit_persistence_1.appendAuditEventAsync)(input.vaultRoot, {
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
        summary: input.summary,
        related_wiki: input.relatedWiki,
        related_sources: input.relatedSources,
        architecture_status: input.architectureStatus.architecture_status,
        missing_graph_bridges: input.architectureStatus.missing_graph_bridges,
        created_at: new Date().toISOString(),
        status: input.status,
        memory_candidate_count: String((input.memoryCandidateRecords ?? []).length),
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
            memory_id: immutable.memory_id,
            claim_key: immutable.claim_key,
            write_status: immutable.write_status,
        };
    }
    const sourceNotePath = resolveFinishTaskRecordPath(input, context);
    for (const group of plan.groups) {
        await createFinishTaskProposal(input.vaultRoot, input.taskId, sourceNotePath, operationId, group.kind, group.label, group.values, input.projectHint, input.reviewProposalMode, 'project', plan.bridgeMetadata.related_wiki, plan.bridgeMetadata.related_sources, input.architectureStatus, input.architectureStatus.missing_graph_bridges, false, plan.bridgeMetadata.missing_related_wiki, plan.bridgeMetadata.missing_related_sources, context, true);
    }
    return { outcome: 'review_fallback' };
}
async function writeFinishTaskCloseoutArtifacts(input, group, context, operationId) {
    const sourceNotePath = resolveFinishTaskRecordPath(input, context);
    const memoryScope = resolveMemoryScope(group.kind, '', input.projectHint, input.memoryScope);
    const bridgeMetadata = resolveProjectMemoryBridgeMetadata(input.vaultRoot, memoryScope, input.projectHint, input.rawRelatedWiki ?? input.relatedWiki, input.rawRelatedSources ?? input.relatedSources, context);
    const memoryRule = memoryProposalRuleFor(group.kind, '', input.projectHint, context, memoryScope);
    if (memoryRule === 'disabled' || input.reviewProposalMode === 'suggest') {
        return;
    }
    if (input.reviewProposalMode === 'auto_propose' && memoryRule === 'auto_write') {
        if (memoryScope === 'project') {
            return writeFinishTaskProjectMemoryArtifacts(input, context, operationId);
        }
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
                sourceNote: sourceNotePath,
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
    await createFinishTaskProposal(input.vaultRoot, input.taskId, sourceNotePath, operationId, group.kind, group.label, group.values, input.projectHint, input.reviewProposalMode, memoryScope, bridgeMetadata.related_wiki, bridgeMetadata.related_sources, input.architectureStatus, input.architectureStatus.missing_graph_bridges, false, bridgeMetadata.missing_related_wiki, bridgeMetadata.missing_related_sources, context);
}
async function updateFinishTaskRecord(input, context, operationId) {
    const projectIdentity = projectIdentityFromFinishPayload(input);
    const finishRecord = await findFinishTaskRecord(input, context, operationId);
    const proposalResult = await collectFinishTaskArtifacts(input.vaultRoot, input.taskId, finishRecord.path, input.reviewProposalMode, input.projectHint, input.projectId, input.repoPath, input.memoryScope, input.rawRelatedWiki ?? input.relatedWiki, input.rawRelatedSources ?? input.relatedSources, input.architectureStatus, {
        decisions: input.decisions,
        solution_changes: input.solutionChanges,
        lessons: input.lessons,
        preferences: input.preferences,
        next_actions: input.nextActions,
        memory_candidates: input.memoryCandidates,
    }, input.memoryCandidateRecords ?? [], context, operationId, input.projectMemoryEntryVersion === 1
        && buildFinishTaskProjectMemoryPlan(input, context) !== null);
    const durableOutputEvidence = await readFinishTaskDurableOutputEvidence(input, finishRecord.path, context, 'repair') ?? await buildFinishTaskDurableOutput(input, proposalResult, context);
    const aggregatedProposals = aggregateFinishTaskProposalReferences(input, proposalResult, finishRecord.path, context);
    const proposalPaths = aggregatedProposals.map((proposal) => proposal.path);
    const proposalIds = aggregatedProposals.map((proposal) => proposal.proposalId);
    const autoWritePaths = proposalResult.autoAppliedMemoryUpdates.map((update) => update.path);
    if (!finishTaskUsesSingleTaskRecord(input)) {
        await updateManagedRecordFields(input.vaultRoot, finishRecord.path, durableOutputFrontmatterFields(durableOutputEvidence), context);
    }
    const taskFields = {
        status: input.status,
        finished_at: input.taskFinishedAt ?? new Date().toISOString(),
        finish_request_hash: input.requestHash || null,
        ...(input.startRecovery === 'matched' ? { start_recovery: input.startRecovery } : {}),
        ...(input.startRecovery === 'matched' && input.recordingReason
            ? { recording_reason: input.recordingReason }
            : {}),
        summary: input.summary,
        ...(finishTaskUsesSingleTaskRecord(input)
            ? {}
            : { session_note: finishRecord.path }),
        outcomes: input.outcomes.join(', '),
        next_actions: input.nextActions.join(', '),
        decisions: input.decisions.join(', '),
        solution_changes: input.solutionChanges.join(', '),
        lessons: input.lessons.join(', '),
        preferences: input.preferences.join(', '),
        memory_candidate_count: String((input.memoryCandidateRecords ?? []).length),
        project_id: input.projectId || null,
        repo_path: input.repoPath || null,
        project_hint: input.projectHint,
        related_project: input.projectHint,
        project_identity_source: projectIdentity.source,
        project_identity_confidence: projectIdentity.confidence,
        project_identity_warnings: projectIdentity.warnings.join(', '),
        finish_operation_id: operationId,
        ...durableOutputFrontmatterFields(durableOutputEvidence),
    };
    const taskReferences = {
        memory_writes: finishTaskUsesSingleTaskRecord(input)
            ? autoWritePaths
            : [finishRecord.path, ...autoWritePaths],
        proposal_ids: proposalIds,
        proposal_paths: proposalPaths,
        proposal_link_targets: proposalPaths,
    };
    const completionBody = buildFinishTaskCompletionBody(input, context, operationId);
    const updateTaskRecord = () => updateAgentTaskRecordAsync(input.vaultRoot, input.taskId, taskFields, context, taskReferences, completionBody, `^finish-${operationId}`);
    let taskPath = await updateTaskRecord();
    if (!taskPath && finishTaskUsesSingleTaskRecord(input)) {
        await ensureFinishTaskRecordExists(input, context, operationId);
        taskPath = await updateTaskRecord();
    }
    if (!taskPath) {
        throw new safety_1.ToolInputError(`Task record is missing for finish-task operation: ${buildTaskNotePath(input.taskId)}`);
    }
    if (!finishTaskUsesSingleTaskRecord(input)) {
        await updateManagedProposalReferences(input.vaultRoot, finishRecord.path, aggregatedProposals, context);
    }
    await updateManagedProposalReferences(input.vaultRoot, taskPath, aggregatedProposals, context);
    return taskPath;
}
async function executeFinishTaskOperation(input, context, operationId, idempotencyKey) {
    const projectIdentity = projectIdentityFromFinishPayload(input);
    const finishRecord = await findFinishTaskRecord(input, context, operationId);
    const proposalResult = await collectFinishTaskArtifacts(input.vaultRoot, input.taskId, finishRecord.path, input.reviewProposalMode, input.projectHint, input.projectId, input.repoPath, input.memoryScope, input.rawRelatedWiki ?? input.relatedWiki, input.rawRelatedSources ?? input.relatedSources, input.architectureStatus, {
        decisions: input.decisions,
        solution_changes: input.solutionChanges,
        lessons: input.lessons,
        preferences: input.preferences,
        next_actions: input.nextActions,
        memory_candidates: input.memoryCandidates,
    }, input.memoryCandidateRecords ?? [], context, operationId, input.projectMemoryEntryVersion === 1
        && buildFinishTaskProjectMemoryPlan(input, context) !== null);
    const durableOutputEvidence = await readFinishTaskDurableOutputEvidence(input, finishRecord.path, context, 'finalize');
    if (!durableOutputEvidence) {
        throw new core_1.OperationConflictError('Finish-task durable-output evidence is unavailable at finalization.');
    }
    const durableOutput = durableOutputEvidence.summary;
    const aggregatedProposals = aggregateFinishTaskProposalReferences(input, proposalResult, finishRecord.path, context);
    const memoryCloseoutState = compatibleMemoryCloseoutStatus(durableOutput, resolveCanonicalMemoryCloseoutStatus(input.reviewProposalMode, proposalResult, input.hasCloseoutCandidates, resolveMemoryCloseoutStatus(input.reviewProposalMode, proposalResult, input.hasCloseoutCandidates)));
    const response = {
        ok: true,
        read_only: false,
        operation_id: operationId,
        idempotency_key: idempotencyKey,
        task_id: input.taskId,
        task_path: buildTaskNotePath(input.taskId),
        path: finishRecord.path,
        session_path: finishRecord.path,
        activity_path: finishRecord.activity_path,
        tracking_mode: finishTaskTrackingMode(input),
        task_record_origin: finishTaskRecordOrigin(input),
        started_at: input.startedAt || null,
        started_at_source: input.startedAtSource || 'unknown',
        tracking_started_at: input.trackingStartedAt || null,
        recorded_at: input.recordedAt || input.taskFinishedAt || new Date().toISOString(),
        start_recovery: input.startRecovery || 'not_requested',
        status: input.status,
        content_language: input.contentLanguage,
        content_language_source: contentLanguageSourceFromContext(context),
        outcome_count: input.outcomes.length,
        next_action_count: input.nextActions.length,
        memory_candidate_records: proposalResult.memoryCandidateRecords,
        memory_changes: proposalResult.memoryChanges,
        project_id: input.projectId || null,
        repo_path: input.repoPath || null,
        project_hint: input.projectHint || null,
        project_identity: (0, project_identity_1.projectIdentityToResult)(projectIdentity),
        related_wiki: input.relatedWiki,
        related_sources: input.relatedSources,
        architecture_status: input.architectureStatus.architecture_status,
        missing_graph_bridges: input.architectureStatus.missing_graph_bridges,
        missing_wiki_bridge: proposalResult.hasMissingWikiBridge,
        memory_status: memoryCloseoutState,
        durable_output: durableOutput,
        next_actions_for_agent: buildFinishTaskNextActions(context, durableOutput, input.projectHint),
    };
    if (proposalResult.hasMissingRelatedSources) {
        response.missing_related_sources = input.missingRelatedSources ?? [];
    }
    if (input.reviewProposalMode === 'auto_propose' || input.reviewProposalMode === 'review_queue') {
        response.proposal_count = durableOutput.proposal_count;
        response.proposals = aggregatedProposals.map((proposal) => ({
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
                finishRequestHash: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['finish_request_hash'])),
            };
        }
        const absolutePath = (0, safety_1.resolveSafeNotePath)(vaultRoot, buildTaskNotePath(taskId), pathSafetyOptions(context));
        const parsed = (0, core_1.parseMarkdown)(fs.readFileSync(absolutePath, 'utf8'));
        return {
            status: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['status'])).toLowerCase(),
            finishOperationId: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['finish_operation_id'])),
            finishRequestHash: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['finish_request_hash'])),
        };
    }
    catch (error) {
        if (error instanceof safety_1.ToolInputError || error instanceof core_1.VaultPathError) {
            return null;
        }
        throw error;
    }
}
async function releaseIncompatibleFinishTaskBinding(vaultRoot, record, context) {
    const payload = (0, protocol_1.isRecord)(record.payload) ? record.payload : null;
    const requestSnapshot = payload && (0, protocol_1.isRecord)(payload.requestSnapshot)
        ? payload.requestSnapshot
        : null;
    const taskId = payload && typeof payload.taskId === 'string'
        ? payload.taskId
        : requestSnapshot && typeof requestSnapshot.task_id === 'string'
            ? requestSnapshot.task_id
            : '';
    if (!taskId)
        return;
    const taskPath = buildTaskNotePath(taskId);
    const current = await readCurrentVaultTextState(vaultRoot, taskPath, context);
    if (!current)
        return;
    const frontmatter = (0, core_1.parseMarkdown)(current.content).frontmatter.fields;
    const status = stripYamlQuotes(readFrontmatterString(frontmatter, ['status'])).toLowerCase();
    const finishOperationId = stripYamlQuotes(readFrontmatterString(frontmatter, ['finish_operation_id']));
    if (status !== 'closing' || finishOperationId !== record.operation_id)
        return;
    const next = updateFrontmatterFields(current.content, {
        status: 'active',
        finish_operation_id: null,
        finish_request_hash: null,
    });
    if (context.vaultRepository) {
        if (!current.version) {
            throw new core_1.OperationConflictError('Cannot release the unfinished finish_task binding without a task version.');
        }
        await context.vaultRepository.replaceText(current.path, current.version, next);
        return;
    }
    const absolutePath = (0, safety_1.resolveSafeNotePath)(vaultRoot, current.path, pathSafetyOptions(context));
    replaceTextFileAtomically(absolutePath, next, current.content);
}
async function handleFinishTask(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    const invocationContext = { ...context };
    const readView = await knowledgeReadViewForContext(vaultRoot, invocationContext);
    const preflightScan = lightweightScanFromReadView(vaultRoot, readView);
    context = {
        ...invocationContext,
        knowledgeReadViewPromise: Promise.resolve(readView),
        knowledgeSnapshotProvider: () => preflightScan,
    };
    const application = new finish_task_1.FinishTaskApplicationService({
        journal: operationJournalForVault(vaultRoot),
        failureInjection: context.operationFailureInjection,
        requestSnapshot: buildFinishTaskRequestSnapshot,
        requestIdempotencyKey: (args) => coerceOptionalString(args.idempotency_key),
        createIdentity: (requestHash, idempotencyKey, requestSnapshot) => buildToolOperationIdentity('finish-task', idempotencyKey, requestSnapshot, context),
        loadExistingPayload: isFinishTaskOperationPayload,
        storedRequestHash: (payload) => (0, protocol_1.isRecord)(payload) && typeof payload.requestHash === 'string'
            ? payload.requestHash
            : '',
        validateExistingOperation: (record, payload) => {
            if (record.status !== 'completed'
                && payload.memoryRecordWriteVersion !== 2) {
                throw new core_1.OperationConflictError(`Cannot recover unfinished legacy finish_task operation "${record.operation_id}" without MemoryRecord v2 write semantics.`);
            }
        },
        buildPayload: (args, operationId, requestHash, requestSnapshot) => buildFinishTaskOperationPayload(args, context, operationId, requestHash, requestSnapshot),
        getTaskId: (payload) => payload.taskId,
        readLifecycle: (taskId) => readTaskLifecycleStateAsync(vaultRoot, taskId, context),
        markClosing: (payload, operationId) => markFinishTaskRecordClosing(payload, context, operationId),
        buildSteps: (operationPayload, operationId) => {
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
                execute: () => writeFinishTaskCloseoutArtifacts(operationPayload, group, context, operationId),
                persistResult: operationPayload.projectMemoryEntryVersion !== 1
                    && Boolean(projectMemoryPlan?.groups.some((projectGroup) => projectGroup.kind === group.kind)),
            }));
            if (aggregateProjectMemoryPlan) {
                closeoutSteps.unshift({
                    name: 'finish-task:project-memory',
                    execute: () => writeFinishTaskProjectMemoryArtifacts(operationPayload, context, operationId),
                    persistResult: true,
                });
            }
            return [
                ...(finishTaskUsesSingleTaskRecord(operationPayload)
                    ? []
                    : [{
                            name: 'finish-task:session-note',
                            execute: () => writeFinishTaskSessionNote(operationPayload, context, operationId),
                        }]),
                ...closeoutSteps,
                {
                    name: 'finish-task:update-task-record',
                    execute: () => updateFinishTaskRecord(operationPayload, context, operationId),
                },
            ];
        },
        finalize: (operationPayload, operationId, idempotencyKey) => executeFinishTaskOperation(operationPayload, context, operationId, idempotencyKey),
    });
    const result = await application.execute(rawArgs);
    const resultRecord = result;
    if (typeof resultRecord.tracking_mode === 'string') {
        return result;
    }
    const taskId = coerceOptionalString(resultRecord.task_id) || coerceOptionalString(rawArgs.task_id);
    const metadata = taskId
        ? await readAgentTaskMetadataAsync(vaultRoot, taskId, context)
        : emptyAgentTaskMetadata();
    const fallbackStartedAt = metadata.startedAt || null;
    return {
        ...result,
        tracking_mode: metadata.trackingMode || 'live',
        task_record_origin: metadata.taskRecordOrigin
            || (metadata.startOperationId ? 'start_task' : 'finish_task_reconstruction'),
        started_at: fallbackStartedAt,
        started_at_source: metadata.startedAtSource !== 'unknown'
            ? metadata.startedAtSource
            : fallbackStartedAt ? 'server_observed' : 'unknown',
        tracking_started_at: metadata.trackingStartedAt || fallbackStartedAt,
        recorded_at: metadata.recordedAt || fallbackStartedAt || new Date().toISOString(),
        start_recovery: 'not_requested',
    };
}
async function handleDistillSession(rawArgs, context) {
    const vaultRoot = configuredVaultRoot(context);
    const application = new finish_task_1.DistillSessionApplicationService({
        resolveProjectHint: async (taskId, explicitProjectHint) => {
            if (explicitProjectHint) {
                return explicitProjectHint;
            }
            return (await readAgentTaskMetadataAsync(vaultRoot, taskId, context)).projectHint;
        },
        assertSafeText: assertNoSensitiveText,
        buildFilename: (rawFilename, fallbackPrefix) => buildSafeFilename(rawFilename, fallbackPrefix, context),
        now: () => new Date().toISOString(),
        renderText: (zh, en) => contentText(context, zh, en),
        buildBody: (summary, outcomes, nextActions, decisions, possiblePreferences) => buildSessionNoteBodyWithDistill(context, summary, outcomes, nextActions, decisions, possiblePreferences),
        writeSessionNote: (input) => buildAndWriteNoteAsync(vaultRoot, 'tracekeeper.distill_session', SESSION_NOTE_DIR, input.filename, input.frontmatter, input.body, input.taskId, context, input.metadata),
        memoryProposalAllowed: (proposalKind, projectHint) => isMemoryProposalAllowed(proposalKind, '', projectHint, context),
        createProposal: async (input) => {
            const proposal = await createDistillProposal(vaultRoot, input.taskId, input.proposalKind, input.kindLabel, input.values, input.projectHint, context);
            return {
                proposalId: proposal.proposalId,
                path: proposal.path,
                linkTarget: proposal.path,
            };
        },
        updateTask: async (taskId, notePath, proposals) => updateAgentTaskRecordAsync(vaultRoot, taskId, { session_note: notePath }, context, {
            memory_writes: [notePath],
            proposal_ids: proposals.map((proposal) => proposal.proposalId),
            proposal_paths: proposals.map((proposal) => proposal.path),
            proposal_link_targets: proposals.map((proposal) => proposal.linkTarget),
        }),
        updateManagedProposalReferences: (recordPath, proposals) => updateManagedProposalReferences(vaultRoot, recordPath, proposals, context),
    });
    return application.execute(rawArgs);
}
