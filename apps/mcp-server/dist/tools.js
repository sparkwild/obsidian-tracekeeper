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
exports.appendConnectionAuditEvent = appendConnectionAuditEvent;
exports.recordToolCallAuditEvent = recordToolCallAuditEvent;
exports.toolDefinitions = toolDefinitions;
exports.toolPrompts = toolPrompts;
exports.callTool = callTool;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const crypto = __importStar(require("node:crypto"));
const index_1 = require("../../../packages/core/dist/index");
const protocol_1 = require("./protocol");
const safety_1 = require("./safety");
const REVIEW_QUEUE_PREFIX = index_1.TRACEKEEPER_REVIEW_QUEUE_DIR;
const AUDIT_LOG_PATH = index_1.TRACEKEEPER_AUDIT_LOG_PATH;
const MAX_LIST_QUEUE_ITEMS = 20;
const MAX_AUDIT_ITEMS = 20;
const MAX_APPROVED_WRITEBACKS = 20;
const MAX_PROJECT_TOOL_ITEMS = 20;
const MAX_PROJECT_SCOPE_CANDIDATES = 8;
const CONTEXT_PACK_DIR = index_1.TRACEKEEPER_CONTEXT_PACKS_DIR;
const SESSION_NOTE_DIR = index_1.TRACEKEEPER_SESSIONS_DIR;
const AGENT_TASK_DIR = index_1.TRACEKEEPER_TASKS_DIR;
const PROJECT_MEMORY_DIRS = [index_1.KNOWLEDGE_PROJECTS_MEMORY_DIR, '05_projects', '04_projects'];
const PROJECT_MEMORY_READ_DIRS = PROJECT_MEMORY_DIRS;
const GLOBAL_MEMORY_DIRS = [index_1.KNOWLEDGE_GLOBAL_MEMORY_DIR, '04_memory', '05_memory'];
const SOURCE_REQUESTS_DIR = index_1.TRACEKEEPER_AGENT_REQUESTS_DIR;
const SOURCES_DIR = index_1.KNOWLEDGE_SOURCES_DIR;
const SOURCE_ANALYSIS_REPORT_DIR = index_1.TRACEKEEPER_SOURCE_ANALYSIS_DIR;
const MEMORY_PROPOSAL_DIR = index_1.TRACEKEEPER_REVIEW_QUEUE_DIR;
const MAX_SOURCE_EXCERPT_LENGTH = 1000;
const DEFAULT_FINISH_TASK_REVIEW_MODE = 'off';
const READ_ONLY_TOOL_NAMES = new Set([
    'tracekeeper.status',
    'tracekeeper.graph_health',
    'tracekeeper.recall',
    'tracekeeper.project_context',
    'tracekeeper.project_history',
    'tracekeeper.read_note',
    'tracekeeper.review_queue',
    'tracekeeper.list_review_queue',
    'tracekeeper.list_source_requests',
    'tracekeeper.list_approved_writebacks',
    'tracekeeper.audit_recent',
    'tracekeeper.lint',
]);
const REVIEW_GATED_TOOL_NAMES = new Set(['tracekeeper.apply_approved_writeback']);
const LOW_RISK_TOOL_NAMES = new Set([
    'tracekeeper.start_task',
    'tracekeeper.source_request',
    'tracekeeper.analyze_source_request',
    'tracekeeper.write_context_pack',
    'tracekeeper.build_context_pack',
    'tracekeeper.finish_task',
    'tracekeeper.distill_session',
    'tracekeeper.write_session_note',
    'tracekeeper.capture_source',
    'tracekeeper.propose_memory',
]);
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
const TOOL_NAME_SET = new Set([
    'tracekeeper.status',
    'tracekeeper.graph_health',
    'tracekeeper.start_task',
    'tracekeeper.recall',
    'tracekeeper.project_context',
    'tracekeeper.project_history',
    'tracekeeper.read_note',
    'tracekeeper.review_queue',
    'tracekeeper.list_review_queue',
    'tracekeeper.list_source_requests',
    'tracekeeper.list_approved_writebacks',
    'tracekeeper.audit_recent',
    'tracekeeper.source_request',
    'tracekeeper.analyze_source_request',
    'tracekeeper.apply_approved_writeback',
    'tracekeeper.build_context_pack',
    'tracekeeper.lint',
    'tracekeeper.finish_task',
    'tracekeeper.distill_session',
    'tracekeeper.write_context_pack',
    'tracekeeper.write_session_note',
    'tracekeeper.capture_source',
    'tracekeeper.propose_memory',
]);
const PUBLIC_TOOL_NAME_ORDER = [
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
];
function isToolName(value) {
    return TOOL_NAME_SET.has(value);
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
function toolResult(payload, isError = false) {
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(payload, null, 2),
            },
        ],
        structuredContent: payload,
        isError,
    };
}
function toolError(message) {
    return toolResult({ ok: false, error: message }, true);
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
    return (0, index_1.normalizeGraphProfile)(value ?? context.graphProfile);
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
    return (0, index_1.scanVault)(vaultRoot, pathSafetyOptions(context));
}
function buildContextPackForContext(vaultRoot, query, context, options = {}) {
    return (0, index_1.buildContextPack)(vaultRoot, query, {
        ...options,
        ...pathSafetyOptions(context),
    });
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
    const graphHealth = (0, index_1.analyzeGraphHealth)(scan.notes, { maxItems: 20 });
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
function resolveProjectMemoryBridgeMetadata(vaultRoot, memoryScope, projectHint, relatedWikiRaw, context) {
    if (memoryScope !== 'project') {
        return {
            missing_wiki_bridge: false,
            related_wiki: relatedWikiRaw,
            missing_related_wiki: [],
        };
    }
    const options = pathSafetyOptions(context);
    const scan = scanVaultForContext(vaultRoot, context);
    const pathSet = new Set(scan.notes.map((note) => note.relativePath.toLowerCase()));
    if (projectHint && !projectHint.trim()) {
        projectHint = '';
    }
    const relatedWiki = dedupeAndNormalizeList(relatedWikiRaw.map(normalizeWikilinkOrSourceValue));
    if (relatedWiki.length === 0) {
        return {
            missing_wiki_bridge: true,
            related_wiki: [],
            missing_related_wiki: [],
        };
    }
    const missing_related_wiki = [];
    const resolved = [];
    const resolveReference = (rawReference) => {
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
            const noteTitle = note.title.toLowerCase();
            const basePath = note.relativePath.toLowerCase().split('/').pop()?.replace(/\.md$/i, '') || '';
            if (noteTitle === title || basePath === title) {
                return note.relativePath;
            }
        }
        return null;
    };
    for (const reference of relatedWiki) {
        const resolvedPath = resolveReference(reference);
        if (resolvedPath && (0, index_1.isKnowledgeWikiPath)(resolvedPath)) {
            resolved.push(resolvedPath);
        }
        else {
            missing_related_wiki.push(reference);
        }
    }
    if (missing_related_wiki.length > 0 || resolved.length === 0) {
        return {
            missing_wiki_bridge: true,
            related_wiki: dedupeAndNormalizeList(resolved),
            missing_related_wiki: dedupeAndNormalizeList(missing_related_wiki),
        };
    }
    return {
        missing_wiki_bridge: false,
        related_wiki: dedupeAndNormalizeList(resolved),
        missing_related_wiki: [],
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
function normalizeMemoryProposalRule(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'disabled') {
        return 'disabled';
    }
    if (normalized === 'auto_write' || normalized === 'auto' || normalized === 'automatic' || normalized === 'auto_save') {
        return 'auto_write';
    }
    return 'review_queue';
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
    return normalizeMemoryProposalRule(projectScoped
        ? context.memoryRules?.projectMemoryRule
        : context.memoryRules?.globalMemoryRule);
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
    return (0, index_1.projectMemoryPath)(projectHint || 'project');
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
function coerceProjectScope(rawArgs) {
    return {
        projectHint: coerceOptionalString(rawArgs.project_hint),
        projectId: coerceOptionalString(rawArgs.project_id),
        repoPath: coerceOptionalString(rawArgs.repo_path) ||
            coerceOptionalString(rawArgs.repo) ||
            coerceOptionalString(rawArgs.project_path),
    };
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
function filterNotesByProjectScope(notes, scope) {
    if (!hasProjectScope(scope)) {
        return notes.filter((note) => PROJECT_MEMORY_READ_DIRS.some((dir) => note.relativePath.startsWith(`${dir}/`)));
    }
    const hasRepoPath = Boolean(scope.repoPath);
    const normalizedRepo = hasRepoPath ? normalizeRepoPrefix(scope.repoPath).toLowerCase() : '';
    const projectHint = scope.projectHint.toLowerCase();
    const projectId = scope.projectId.toLowerCase();
    return notes.filter((note) => {
        if (hasRepoPath && !noteMatchesRepoPath(note, normalizedRepo)) {
            return false;
        }
        if (projectHint && !noteMatchesProjectHint(note, projectHint)) {
            return false;
        }
        if (projectId && !noteMatchesProjectId(note, projectId)) {
            return false;
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
function collectProjectCandidates(notes, scope, maxItems) {
    const candidates = [];
    const seen = new Set();
    for (const note of notes) {
        const pathParts = note.relativePath.split('/');
        const isProjectMemoryNote = PROJECT_MEMORY_READ_DIRS.some((dir) => note.relativePath.startsWith(`${dir}/`));
        if (pathParts.length >= 2 && isProjectMemoryNote) {
            const candidate = `${pathParts[0]}/${pathParts[1]}`;
            if (!seen.has(candidate)) {
                seen.add(candidate);
                candidates.push(candidate);
            }
        }
        const notePath = note.relativePath.toLowerCase();
        const hintTokens = projectTokens(scope.projectHint);
        if (scope.projectId &&
            (notePath.includes(scope.projectId.toLowerCase()) || valueContainsAnyToken(notePath, hintTokens))) {
            if (!seen.has(note.relativePath)) {
                seen.add(note.relativePath);
                candidates.push(note.relativePath);
            }
        }
        if (candidates.length >= maxItems) {
            break;
        }
    }
    return candidates.slice(0, maxItems);
}
function buildProjectHistoryEntries(matches) {
    return matches.map((note) => ({
        path: note.relativePath,
        title: note.title,
        type: note.type,
        modifiedAt: note.modifiedAt,
        task_id: readFrontmatterString(note.frontmatter, ['task_id', 'taskId']),
        project_hint: readFrontmatterString(note.frontmatter, ['project_hint', 'related_project', 'project']),
    }));
}
function matchesProjectQuery(note, query) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return true;
    }
    const haystack = [
        note.relativePath,
        note.title,
        note.type,
        note.tokens,
        JSON.stringify(note.frontmatter),
    ].join(' ').toLowerCase();
    return haystack.includes(normalizedQuery);
}
function buildProjectScopeMetadata(scope) {
    return {
        project_hint: scope.projectHint || null,
        project_id: scope.projectId || null,
        repo_path: scope.repoPath || null,
    };
}
function collectRecallScopeTokens(scope) {
    const tokens = new Set();
    if (scope.projectHint) {
        for (const token of projectTokens(scope.projectHint)) {
            tokens.add(token);
        }
    }
    if (scope.projectId) {
        tokens.add(scope.projectId.toLowerCase());
    }
    if (scope.repoPath) {
        const normalized = normalizeRepoPrefix(scope.repoPath).toLowerCase();
        if (normalized) {
            tokens.add(normalized);
            tokens.add(normalized.split('/').filter(Boolean).pop() || normalized);
        }
    }
    return Array.from(tokens).filter(Boolean);
}
function recallRecencyBoost(modifiedAt) {
    const modified = Date.parse(modifiedAt);
    if (!Number.isFinite(modified)) {
        return 0;
    }
    const ageHours = (Date.now() - modified) / (60 * 60 * 1000);
    if (ageHours < 24) {
        return 1;
    }
    if (ageHours < 72) {
        return 0.6;
    }
    if (ageHours < 168) {
        return 0.25;
    }
    return 0;
}
function rankRecallMatches(matches, query, scope) {
    const fullQuery = query.trim().toLowerCase();
    const scopeTokens = collectRecallScopeTokens(scope);
    const ranked = matches.map((match) => {
        let score = match.score;
        const reasons = [];
        const noteTitle = match.note.title.toLowerCase();
        const notePath = match.note.relativePath.toLowerCase();
        const noteFrontmatter = [
            readFrontmatterString(match.note.frontmatter, ['project', 'project_hint', 'related_project']),
            readFrontmatterString(match.note.frontmatter, ['project_id', 'projectId', 'pid']),
            readFrontmatterString(match.note.frontmatter, ['repo_path', 'repoPath', 'project_path']),
            readFrontmatterString(match.note.frontmatter, ['related_project', 'relatedProject', 'workspace']),
        ].join(' ').toLowerCase();
        if (match.matchedTokens.length >= 2) {
            score += 0.4;
            reasons.push('Multiple query token matches (+0.4)');
        }
        const recency = recallRecencyBoost(match.note.modifiedAt);
        if (recency > 0) {
            score += recency;
            reasons.push(`Recent edit (+${recency})`);
        }
        if (fullQuery && (noteTitle.includes(fullQuery) || notePath.includes(fullQuery))) {
            score += 1;
            reasons.push('Exact query phrase match in title/path (+1)');
        }
        if (scopeTokens.some((token) => valueContainsAnyToken(noteTitle, [token]) || valueContainsAnyToken(notePath, [token]) || valueContainsAnyToken(noteFrontmatter, [token]))) {
            score += 0.4;
            reasons.push('Project scope match (+0.4)');
        }
        return {
            note: match.note,
            raw_score: match.score,
            score: Number(score.toFixed(2)),
            matchedTokens: match.matchedTokens,
            score_reason: reasons.length ? reasons : ['Core recall score'],
        };
    });
    return ranked.sort((a, b) => b.score - a.score || a.note.relativePath.localeCompare(b.note.relativePath));
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
function createFinishTaskProposal(vaultRoot, taskId, sessionNotePath, proposalKind, label, values, projectHint, reviewProposalMode, memoryScope, relatedWiki, relatedSources, architectureStatus, missingGraphBridges, missingWikiBridge, missingRelatedWiki, context) {
    const normalizedValues = normalizeFinishTaskProposalValues(values);
    const proposalSignature = buildFinishTaskProposalSignature(taskId, proposalKind, normalizedValues);
    const existingProposal = findExistingFinishTaskProposal(vaultRoot, taskId, proposalKind, normalizedValues, context);
    if (existingProposal) {
        return { path: existingProposal };
    }
    const now = new Date().toISOString();
    const filename = buildSafeFilename(`finish-task-${proposalKind}-${taskId}-${crypto.randomUUID()}`, 'proposal', context);
    const evidence = buildFinishTaskProposalEvidence(taskId, sessionNotePath, projectHint, proposalKind, reviewProposalMode);
    const body = [
        '## Finish Task Proposal Source',
        `- tool_name: tracekeeper.finish_task`,
        `- task_id: ${taskId}`,
        `- session_note: ${sessionNotePath}`,
        `- memory_scope: ${memoryScope}`,
        projectHint ? `- project_hint: ${projectHint}` : '',
        relatedWiki.length ? `- related_wiki: ${JSON.stringify(relatedWiki)}` : '',
        relatedSources.length ? `- related_sources: ${JSON.stringify(relatedSources)}` : '',
        `- proposal_kind: ${proposalKind}`,
        `- architecture_status: ${architectureStatus.architecture_status}`,
        missingGraphBridges.length ? `- missing_graph_bridges: ${JSON.stringify(missingGraphBridges)}` : '',
        missingWikiBridge ? '- missing_wiki_bridge: true' : '',
        missingRelatedWiki.length ? `- missing_related_wiki: ${JSON.stringify(missingRelatedWiki)}` : '',
        `- evidence: ${evidence}`,
        '',
        `## ${label}`,
        ...values.map((item) => `- ${item}`),
    ].filter(Boolean).join('\n');
    return buildAndWriteNote(vaultRoot, 'tracekeeper.finish_task', MEMORY_PROPOSAL_DIR, filename, {
        tool: 'tracekeeper.finish_task',
        type: 'memory_proposal',
        title: `${label} ${taskId}`,
        proposal_kind: proposalKind,
        status: 'pending',
        target_note: null,
        risk_level: 'medium',
        proposal_source_tool: 'tracekeeper.finish_task',
        proposal_source_task_id: taskId,
        proposal_source_session_note: sessionNotePath,
        project_hint: projectHint || null,
        evidence,
        created_at: now,
        task_id: taskId,
        [FINISH_TASK_PROPOSAL_SIGNATURE_KEY]: proposalSignature,
    }, body, taskId, context, {
        target_type: 'memory_proposal',
        proposal_kind: proposalKind,
        source_note: sessionNotePath,
    });
}
function buildFinishTaskProposals(vaultRoot, taskId, sessionNotePath, proposalMode, projectHint, rawMemoryScope, relatedWiki, relatedSources, architectureStatus, closeout, context) {
    if (proposalMode === 'off') {
        return { proposals: [], suggestedMemoryUpdates: [], autoAppliedMemoryUpdates: [], hasMissingWikiBridge: false };
    }
    const groups = [
        { kind: 'task_decision', label: 'Task Decisions', values: closeout.decisions },
        { kind: 'solution_change', label: 'Solution Changes', values: closeout.solution_changes },
        { kind: 'lesson_learned', label: 'Lessons', values: closeout.lessons },
        { kind: 'user_preference', label: 'User Preferences', values: closeout.preferences },
        { kind: 'project_next_action', label: 'Project Next Actions', values: closeout.next_actions },
        { kind: 'memory_candidate', label: 'Memory Candidates', values: closeout.memory_candidates },
    ];
    const proposals = [];
    const suggestedMemoryUpdates = [];
    const autoAppliedMemoryUpdates = [];
    let hasMissingWikiBridge = false;
    for (const group of groups) {
        const values = normalizeFinishTaskProposalValues(group.values);
        if (values.length === 0) {
            continue;
        }
        const memoryScope = resolveMemoryScope(group.kind, '', projectHint, rawMemoryScope);
        const bridgeMetadata = resolveProjectMemoryBridgeMetadata(vaultRoot, memoryScope, projectHint, relatedWiki, context);
        const memoryRule = memoryProposalRuleFor(group.kind, '', projectHint, context, memoryScope);
        if (memoryRule === 'disabled') {
            continue;
        }
        if (proposalMode === 'suggest') {
            suggestedMemoryUpdates.push({
                kind: group.kind,
                label: group.label,
                values,
            });
            continue;
        }
        if (proposalMode === 'auto_propose' && memoryRule === 'auto_write') {
            const canAutoWrite = !(memoryScope === 'project' &&
                bridgeMetadata.missing_wiki_bridge);
            if (memoryScope === 'project' && bridgeMetadata.missing_wiki_bridge) {
                hasMissingWikiBridge = true;
            }
            if (canAutoWrite) {
                const autoTarget = resolveAutoMemoryTarget(vaultRoot, group.kind, '', projectHint, context, memoryScope);
                if (autoTarget) {
                    const note = appendAutoMemoryWrite(vaultRoot, {
                        toolName: 'tracekeeper.finish_task',
                        proposalKind: group.kind,
                        targetNote: autoTarget.targetNote,
                        allowedDir: autoTarget.allowedDir,
                        title: group.label,
                        content: values.map((item) => `- ${item}`).join('\n'),
                        taskId,
                        context,
                        projectHint,
                        sourceNote: sessionNotePath,
                        memoryScope,
                        relatedWiki,
                        relatedSources,
                        architectureStatus,
                        missingGraphBridges: architectureStatus.missing_graph_bridges,
                        missingWikiBridge: false,
                        missingRelatedWiki: bridgeMetadata.missing_related_wiki,
                        signature: buildFinishTaskProposalSignature(taskId, group.kind, values),
                    });
                    autoAppliedMemoryUpdates.push({
                        kind: group.kind,
                        path: note.path,
                        status: note.status,
                    });
                    continue;
                }
            }
        }
        const note = createFinishTaskProposal(vaultRoot, taskId, sessionNotePath, group.kind, group.label, values, projectHint, proposalMode, memoryScope, bridgeMetadata.related_wiki, relatedSources, architectureStatus, architectureStatus.missing_graph_bridges, bridgeMetadata.missing_wiki_bridge, bridgeMetadata.missing_related_wiki, context);
        proposals.push({
            kind: group.kind,
            path: note.path,
        });
    }
    return {
        proposals,
        suggestedMemoryUpdates,
        autoAppliedMemoryUpdates,
        hasMissingWikiBridge,
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
function assertSourceRequestPath(relativePath) {
    if (!relativePath.startsWith(`${SOURCE_REQUESTS_DIR}/`)) {
        throw new safety_1.ToolInputError(`Source request path must be under ${SOURCE_REQUESTS_DIR}.`);
    }
}
function readSourceRequest(vaultRoot, requestPath, context) {
    const data = safeReadNote(vaultRoot, requestPath, context);
    assertSourceRequestPath(data.path);
    const parsed = (0, index_1.parseMarkdown)(data.text);
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
function readMemoryProposal(vaultRoot, proposalPath, context) {
    const options = pathSafetyOptions(context);
    const normalized = (0, safety_1.normalizeNotePath)(proposalPath, options);
    const absolutePath = (0, safety_1.resolveSafeNotePath)(vaultRoot, normalized, options);
    const relative = (0, safety_1.relativeFromAbsolute)(vaultRoot, absolutePath);
    assertReviewQueuePath(relative);
    const text = fs.readFileSync(absolutePath, 'utf8');
    const parsed = (0, index_1.parseMarkdown)(text);
    const frontmatter = parsed.frontmatter.fields;
    if (!isMemoryProposalFrontmatter(frontmatter)) {
        throw new safety_1.ToolInputError(`Review Queue note is not a memory proposal: ${relative}`);
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
function findMemoryProposalPathById(vaultRoot, proposalId, context) {
    const normalizedId = stripYamlQuotes(proposalId);
    if (!normalizedId) {
        throw new safety_1.ToolInputError('proposal_id is required.');
    }
    const scan = scanVaultForContext(vaultRoot, context);
    const match = scan.notes.find((note) => {
        if (!note.relativePath.startsWith(`${REVIEW_QUEUE_PREFIX}/`)) {
            return false;
        }
        const noteProposalId = stripYamlQuotes(readFrontmatterString(note.frontmatter, ['proposal_id', 'proposalId'])) ||
            path.basename(note.relativePath, path.extname(note.relativePath));
        return noteProposalId === normalizedId || note.relativePath === normalizedId;
    });
    if (!match) {
        throw new safety_1.ToolInputError(`Approved writeback proposal not found: ${normalizedId}`);
    }
    return match.relativePath;
}
function resolveMemoryProposalFromArgs(vaultRoot, rawArgs, context) {
    const explicitPath = coerceOptionalString(rawArgs.proposal_path) || coerceOptionalString(rawArgs.path);
    if (explicitPath) {
        return readMemoryProposal(vaultRoot, explicitPath, context);
    }
    const proposalId = coerceOptionalString(rawArgs.proposal_id);
    if (!proposalId) {
        throw new safety_1.ToolInputError('proposal_id or proposal_path is required.');
    }
    return readMemoryProposal(vaultRoot, findMemoryProposalPathById(vaultRoot, proposalId, context), context);
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
        extractMarkdownSection(proposal.body, ['writeback', 'approved writeback', 'writeback content']);
    if (proposal.approvalStatus !== 'approved') {
        return {
            proposal,
            targetNote: proposal.targetNote,
            writebackContent,
            ready: false,
            reason: `proposal approval_status/status is ${proposal.approvalStatus}`,
        };
    }
    if (!proposal.targetNote) {
        return {
            proposal,
            targetNote: proposal.targetNote,
            writebackContent,
            ready: false,
            reason: 'target_note is required',
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
function formatFrontmatterUpdateValue(value) {
    if (/^[A-Za-z0-9._/-]+$/.test(value)) {
        return value;
    }
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}
function updateFrontmatterFields(content, fields) {
    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const renderedFields = Object.entries(fields).map(([key, value]) => `${key}: ${formatFrontmatterUpdateValue(value)}`);
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
    const frontmatterLines = lines.slice(1, end).map((line) => {
        const pair = line.match(/^(\s*)([^:#]+):\s*(.*)$/);
        if (!pair) {
            return line;
        }
        const key = pair[2]?.trim() || '';
        const nextValue = pending.get(key);
        if (nextValue === undefined) {
            return line;
        }
        pending.delete(key);
        return `${pair[1] || ''}${key}: ${formatFrontmatterUpdateValue(nextValue)}`;
    });
    for (const [key, value] of pending) {
        frontmatterLines.push(`${key}: ${formatFrontmatterUpdateValue(value)}`);
    }
    return ['---', ...frontmatterLines, '---', ...lines.slice(end + 1)].join('\n');
}
function assertAllowedWritebackTarget(relativePath) {
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
    let text = fs.readFileSync(absolutePath, 'utf8');
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
    text = `${updatedFrontmatter}${body}`;
    fs.writeFileSync(absolutePath, text, 'utf8');
    return {
        path: (0, safety_1.relativeFromAbsolute)(vaultRoot, absolutePath),
    };
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
function parseAuditSections(content) {
    const lines = content.split('\n');
    const sections = [];
    let currentHeading = '';
    let currentBody = [];
    let currentLine = 0;
    let started = false;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const match = line.match(/^#{2,6}\s+(.+)$/);
        if (match) {
            if (started) {
                sections.push({
                    heading: currentHeading,
                    body: currentBody,
                    atLine: currentLine,
                });
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
        sections.push({
            heading: currentHeading,
            body: currentBody,
            atLine: currentLine,
        });
    }
    return sections;
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
function buildAndWriteNote(vaultRoot, toolName, allowedDir, filename, frontmatter, body, taskId, context, metadata = {}) {
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
        if (!(error instanceof index_1.VaultPathError)) {
            throw error;
        }
        const resolved = (0, safety_1.resolveSafeWritableNotePath)(vaultRoot, normalizedTarget, allowedDir, options);
        assertAllowedWritebackTarget(resolved.relativePath);
        return { absolutePath: resolved.absolutePath, relativePath: resolved.relativePath, created: true };
    }
}
function ensureProjectMemoryIndex(vaultRoot, targetRelativePath, input) {
    if (!targetRelativePath.startsWith(`${index_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
        return null;
    }
    const suffix = targetRelativePath.slice(`${index_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`.length);
    const projectSlug = suffix.split('/', 1)[0] || '';
    if (!projectSlug) {
        return null;
    }
    const indexPath = `${index_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/${projectSlug}/index.md`;
    const absolutePath = path.join(vaultRoot, indexPath);
    if (fs.existsSync(absolutePath)) {
        return indexPath;
    }
    const displayName = input.projectHint || projectSlug;
    const relatedWikiLinks = dedupeAndNormalizeList(input.relatedWiki || []).map((link) => `- [[${link.replace(/\.md$/i, '')}]]`);
    const markdown = buildMarkdownNote({
        type: 'project_memory_index',
        title: `Project memory: ${displayName}`,
        project_hint: input.projectHint || projectSlug,
        related_wiki: input.relatedWiki || [],
        created_at: new Date().toISOString(),
    }, [
        `# Project memory: ${displayName}`,
        '',
        '## Related wiki',
        ...(relatedWikiLinks.length > 0 ? relatedWikiLinks : ['- (none)']),
    ].join('\n'));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, markdown, 'utf8');
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
        input.riskLevel ? `- risk_level: ${input.riskLevel}` : '',
        `- created_at: ${new Date().toISOString()}`,
        `- content_signature: ${signature}`,
        '',
        '### Graph links',
        ...(graphLinks.length > 0 ? graphLinks.map((link) => `- ${link}`) : ['- (none)']),
        '',
        '### Memory update',
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
        const markdown = buildMarkdownNote({
            type: 'memory',
            title: input.projectHint ? `Project memory: ${input.projectHint}` : 'Tracekeeper memory',
            project_hint: input.projectHint || null,
            memory_scope: input.memoryScope,
            related_wiki: input.relatedWiki || [],
            related_sources: input.relatedSources || [],
            created_at: new Date().toISOString(),
        }, [`# ${input.projectHint ? `Project memory: ${input.projectHint}` : 'Tracekeeper memory'}`, '', block].join('\n'));
        fs.writeFileSync(target.absolutePath, markdown, 'utf8');
    }
    const audit = appendAuditEvent(vaultRoot, {
        tool: input.toolName,
        targetPath: target.relativePath,
        status: 'written',
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
function readAgentTaskMetadata(vaultRoot, taskId, context) {
    try {
        const absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, buildTaskNotePath(taskId), pathSafetyOptions(context));
        const parsed = (0, index_1.parseMarkdown)(fs.readFileSync(absolute, 'utf8'));
        return {
            projectHint: readFrontmatterString(parsed.frontmatter.fields, ['project_hint', 'related_project', 'project']),
            client: readFrontmatterString(parsed.frontmatter.fields, ['client']),
        };
    }
    catch (error) {
        if (error instanceof safety_1.ToolInputError || error instanceof index_1.VaultPathError || error instanceof Error) {
            return { projectHint: '', client: '' };
        }
        return { projectHint: '', client: '' };
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
function updateAgentTaskRecord(vaultRoot, taskId, fields, context, references = {}, appendBody = '') {
    if (!taskId) {
        return null;
    }
    let absolute = '';
    try {
        absolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, buildTaskNotePath(taskId), pathSafetyOptions(context));
    }
    catch (error) {
        if (error instanceof safety_1.ToolInputError || error instanceof index_1.VaultPathError) {
            return null;
        }
        throw error;
    }
    const current = fs.readFileSync(absolute, 'utf8');
    const frontmatter = (0, index_1.parseMarkdown)(current).frontmatter.fields;
    const nextFields = { ...fields };
    for (const [key, values] of Object.entries(references)) {
        const merged = mergeFrontmatterList(frontmatter, key, values);
        if (merged) {
            nextFields[key] = merged;
        }
    }
    let next = updateFrontmatterFields(current, nextFields);
    if (appendBody.trim()) {
        next = `${next.replace(/\s*$/, '')}\n\n${appendBody.trim()}\n`;
    }
    fs.writeFileSync(absolute, next, 'utf8');
    return (0, safety_1.relativeFromAbsolute)(vaultRoot, absolute);
}
function createAgentTaskRecord(vaultRoot, input) {
    const now = new Date().toISOString();
    const clientName = input.client || input.context.clientName || '';
    const body = [
        '# Agent Task',
        '',
        '## Objective',
        input.goal,
        '',
        '## Context Pack Summary',
        `- query: ${input.contextPack.query}`,
        `- generated_at: ${input.contextPack.generatedAt}`,
        `- relevant_notes: ${input.contextPack.relevantNotes.length}`,
        `- source_candidates: ${input.contextPack.sourceCandidates.length}`,
        `- gaps: ${input.contextPack.gaps.length}`,
    ].join('\n');
    return buildAndWriteNote(vaultRoot, 'tracekeeper.start_task', AGENT_TASK_DIR, buildTaskNotePath(input.taskId).slice(`${AGENT_TASK_DIR}/`.length), {
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
        started_at: now,
    }, body, input.taskId, input.context, {
        target_type: 'agent_task',
        task_stage: 'start',
    });
}
function ensureAuditLog(vaultRoot) {
    const safeAuditPath = (0, safety_1.normalizeNotePath)(AUDIT_LOG_PATH);
    const absolute = path.resolve(vaultRoot, safeAuditPath);
    const relative = path.relative(vaultRoot, absolute).replace(/\\/g, '/');
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new safety_1.ToolInputError('Audit log path must be inside vault.');
    }
    (0, safety_1.assertNoSymlinkSegments)(vaultRoot, absolute);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (!fs.existsSync(absolute)) {
        fs.writeFileSync(absolute, '# Audit Log\n\n');
    }
    return { absolute, relative };
}
function appendAuditEvent(vaultRoot, input) {
    const audit = ensureAuditLog(vaultRoot);
    const eventName = input.type || 'tool-call';
    const eventType = input.event || eventName;
    const toolName = input.tool || '';
    const timestamp = input.timestamp || new Date().toISOString();
    const targetPaths = normalizeAuditTargets(input.targetPath ? [input.targetPath] : input.targetPaths || []);
    const eventLines = [
        `## ${new Date().toISOString()} ${eventName}`,
        `- type: ${eventName}`,
        `- event: ${eventType}`,
    ];
    if (timestamp) {
        eventLines.push(`- timestamp: ${sanitizeYamlValue(timestamp)}`);
    }
    if (input.agentId) {
        eventLines.push(`- agent_id: ${sanitizeYamlValue(input.agentId)}`);
    }
    if (input.sessionId) {
        eventLines.push(`- session_id: ${sanitizeYamlValue(input.sessionId)}`);
    }
    if (input.clientName !== undefined) {
        eventLines.push(`- client_name: ${sanitizeYamlValue(input.clientName || null)}`);
    }
    if (input.actor) {
        eventLines.push(`- actor: ${sanitizeYamlValue(input.actor)}`);
    }
    if (input.action) {
        eventLines.push(`- action: ${sanitizeYamlValue(input.action)}`);
    }
    if (toolName) {
        eventLines.push(`- tool_name: ${sanitizeYamlValue(toolName)}`);
    }
    if (input.resultStatus) {
        eventLines.push(`- result_status: ${sanitizeYamlValue(input.resultStatus)}`);
    }
    if (input.status) {
        eventLines.push(`- status: ${sanitizeYamlValue(input.status)}`);
    }
    if (input.taskId) {
        eventLines.push(`- task_id: ${sanitizeYamlValue(input.taskId)}`);
    }
    if (targetPaths.length > 0) {
        eventLines.push(`- target_paths:`);
        for (const item of targetPaths) {
            eventLines.push(`  - ${sanitizeYamlValue(item)}`);
        }
    }
    else {
        eventLines.push('- target_paths: []');
    }
    if (input.argsSummary !== undefined && input.argsSummary !== '') {
        eventLines.push(`- args_summary: ${sanitizeYamlValue(input.argsSummary)}`);
    }
    if (input.durationMs !== undefined) {
        eventLines.push(`- duration_ms: ${input.durationMs}`);
    }
    if (input.riskLevel) {
        eventLines.push(`- risk_level: ${sanitizeYamlValue(input.riskLevel)}`);
    }
    if (input.transport) {
        eventLines.push(`- transport: ${sanitizeYamlValue(input.transport)}`);
    }
    if (input.runtimeVersion) {
        eventLines.push(`- runtime_version: ${sanitizeYamlValue(input.runtimeVersion)}`);
    }
    if (input.warnings && input.warnings.length > 0) {
        eventLines.push(`- warnings: ${JSON.stringify(input.warnings)}`);
    }
    if (input.metadata && Object.keys(input.metadata).length > 0) {
        const entries = Object.entries(input.metadata).filter(([, value]) => value !== undefined);
        for (const [key, value] of entries) {
            eventLines.push(`- ${key}: ${sanitizeYamlValue(value)}`);
        }
    }
    fs.appendFileSync(audit.absolute, `${eventLines.join('\n')}\n\n`);
    return { path: audit.relative };
}
function normalizeAuditTargets(paths) {
    const result = [];
    for (const candidate of paths) {
        const trimmed = candidate.trim();
        if (!trimmed) {
            continue;
        }
        if (!result.includes(trimmed)) {
            result.push(trimmed);
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
function assertUnreachable(value) {
    throw new safety_1.ToolInputError(`Unhandled tool case: ${String(value)}`);
}
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
        agentId: input.agentId,
        sessionId: input.sessionId,
        clientName: input.clientName,
        transport: input.transport,
        runtimeVersion: input.runtimeVersion,
    });
}
function recordToolCallAuditEvent(vaultRoot, input) {
    const now = new Date().toISOString();
    return appendAuditEvent(vaultRoot, {
        type: 'tool-call',
        event: 'tool-call',
        action: 'tool-call',
        actor: input.agentId,
        timestamp: now,
        tool: input.toolName,
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
    });
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
function toolDefinitions() {
    const definitions = [
        {
            name: 'tracekeeper.status',
            title: 'tracekeeper.status',
            description: '[read-only] Scan vault and return summary counts.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                },
                additionalProperties: false,
            },
        },
        {
            name: 'tracekeeper.graph_health',
            title: 'tracekeeper.graph_health',
            description: '[read-only] Analyze wikilinks and return graph health metrics.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    max_items: {
                        type: 'integer',
                        description: 'Maximum number of array entries to return.',
                    },
                    graph_profile: {
                        type: 'string',
                        enum: ['off', 'advisory', 'strict'],
                        description: 'Graph checking mode. Defaults to the server graphProfile setting.',
                    },
                },
                additionalProperties: false,
            },
            annotations: {
                readOnlyHint: true,
            },
        },
        {
            name: 'tracekeeper.start_task',
            title: 'tracekeeper.start_task',
            description: '[low-risk write] Create an active task record and return a context summary.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    goal: {
                        type: 'string',
                        description: 'Task goal statement.',
                    },
                    client: { type: 'string', description: 'Optional client context.' },
                    project_hint: { type: 'string', description: 'Optional project hint.' },
                },
                required: ['goal'],
                additionalProperties: false,
            },
            annotations: {
                destructiveHint: true,
            },
        },
        {
            name: 'tracekeeper.recall',
            title: 'tracekeeper.recall',
            description: '[read-only] Scan vault and return matching notes for global, project, or project-history recall.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    query: {
                        type: 'string',
                        description: 'Recall query text. Required unless scope is project_history.',
                    },
                    scope: {
                        type: 'string',
                        enum: ['global', 'project', 'project_history'],
                        description: 'Recall scope. Defaults to global.',
                    },
                    project_hint: {
                        type: 'string',
                        description: 'Project hint for scoped matching.',
                    },
                    project_id: {
                        type: 'string',
                        description: 'Project id for scoped matching.',
                    },
                    repo_path: {
                        type: 'string',
                        description: 'Repository/path prefix for scoped matching.',
                    },
                    repo: {
                        type: 'string',
                        description: 'Alias of repo_path for repository-scoped matching.',
                    },
                    project_path: {
                        type: 'string',
                        description: 'Alias of repo_path for workspace/project path matching.',
                    },
                    max_items: {
                        type: 'integer',
                        description: 'Maximum number of matches to return.',
                    },
                },
                additionalProperties: false,
            },
            annotations: {
                readOnlyHint: true,
            },
        },
        {
            name: 'tracekeeper.project_context',
            title: 'tracekeeper.project_context',
            description: '[read-only] Project-scoped recall using project_hint/project_id/repo_path filters.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    query: {
                        type: 'string',
                        description: 'Project-scoped recall query.',
                    },
                    project_hint: {
                        type: 'string',
                        description: 'Project hint for scoped matching.',
                    },
                    project_id: {
                        type: 'string',
                        description: 'Project id for scoped matching.',
                    },
                    repo_path: {
                        type: 'string',
                        description: 'Repository/path prefix for scoped matching.',
                    },
                    repo: {
                        type: 'string',
                        description: 'Alias of repo_path for repository-scoped matching.',
                    },
                    project_path: {
                        type: 'string',
                        description: 'Alias of repo_path for workspace/project path matching.',
                    },
                    max_items: {
                        type: 'integer',
                        description: 'Maximum number of matches to return.',
                    },
                },
                required: ['query'],
                additionalProperties: false,
            },
            annotations: {
                readOnlyHint: true,
            },
        },
        {
            name: 'tracekeeper.project_history',
            title: 'tracekeeper.project_history',
            description: '[read-only] Project-scoped note history for continuity and context.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    project_hint: {
                        type: 'string',
                        description: 'Project hint for scoped matching.',
                    },
                    project_id: {
                        type: 'string',
                        description: 'Project id for scoped matching.',
                    },
                    repo_path: {
                        type: 'string',
                        description: 'Repository/path prefix for scoped matching.',
                    },
                    repo: {
                        type: 'string',
                        description: 'Alias of repo_path for repository-scoped matching.',
                    },
                    project_path: {
                        type: 'string',
                        description: 'Alias of repo_path for workspace/project path matching.',
                    },
                    query: {
                        type: 'string',
                        description: 'Optional query filter.',
                    },
                    max_items: {
                        type: 'integer',
                        description: 'Maximum number of entries to return.',
                    },
                },
                required: [],
                additionalProperties: false,
            },
            annotations: {
                readOnlyHint: true,
            },
        },
        {
            name: 'tracekeeper.read_note',
            title: 'tracekeeper.read_note',
            description: '[read-only] Read markdown/text content of one note in vault.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    path: {
                        type: 'string',
                        description: 'Vault-relative note path.',
                    },
                },
                required: ['path'],
                additionalProperties: false,
            },
            annotations: {
                readOnlyHint: true,
            },
        },
        {
            name: 'tracekeeper.review_queue',
            title: 'tracekeeper.review_queue',
            description: '[read-only] List pending or approved Review Queue proposals.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    action: {
                        type: 'string',
                        enum: ['list_pending', 'list_approved'],
                        description: 'Review Queue action. Defaults to list_pending.',
                    },
                    scope: {
                        type: 'string',
                        description: 'Optional proposal kind or target-note prefix filter for approved proposals.',
                    },
                    max_items: {
                        type: 'integer',
                        description: 'Maximum number of entries to return.',
                    },
                    limit: {
                        type: 'integer',
                        description: 'Alias of max_items.',
                    },
                },
                additionalProperties: false,
            },
            annotations: {
                readOnlyHint: true,
            },
        },
        {
            name: 'tracekeeper.list_review_queue',
            title: 'tracekeeper.list_review_queue',
            description: '[read-only] Read pending memory proposal notes under 00_tracekeeper/inbox/review_queue.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    max_items: {
                        type: 'integer',
                        description: 'Maximum number of pending entries.',
                    },
                },
                additionalProperties: false,
            },
        },
        {
            name: 'tracekeeper.list_source_requests',
            title: 'tracekeeper.list_source_requests',
            description: '[read-only] Read pending source-analysis agent requests under 00_tracekeeper/inbox/agent_requests.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    max_items: {
                        type: 'integer',
                        description: 'Maximum number of pending requests to return.',
                    },
                    status: {
                        type: 'string',
                        description: 'Optional status filter, defaults to pending.',
                    },
                    source_kind: {
                        type: 'string',
                        description: 'Optional source kind filter.',
                    },
                },
                additionalProperties: false,
            },
        },
        {
            name: 'tracekeeper.list_approved_writebacks',
            title: 'tracekeeper.list_approved_writebacks',
            description: '[read-only] Read approved Review Queue proposals that are candidates for runtime writeback.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    scope: {
                        type: 'string',
                        description: 'Optional proposal kind or target-note prefix filter.',
                    },
                    max_items: {
                        type: 'integer',
                        description: 'Maximum number of approved writebacks to return.',
                    },
                    limit: {
                        type: 'integer',
                        description: 'Alias of max_items.',
                    },
                },
                additionalProperties: false,
            },
            annotations: {
                readOnlyHint: true,
            },
        },
        {
            name: 'tracekeeper.audit_recent',
            title: 'tracekeeper.audit_recent',
            description: '[read-only] Read parsed sections from 00_tracekeeper/control/audit_log.md.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    max_items: {
                        type: 'integer',
                        description: 'Maximum number of parsed sections.',
                    },
                },
                additionalProperties: false,
            },
            annotations: {
                readOnlyHint: true,
            },
        },
        {
            name: 'tracekeeper.source_request',
            title: 'tracekeeper.source_request',
            description: '[read-only | low-risk write] List or analyze source-analysis requests.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    action: {
                        type: 'string',
                        enum: ['list', 'analyze'],
                        description: 'Source request action. Defaults to list unless request_path/path is provided.',
                    },
                    request_path: {
                        type: 'string',
                        description: 'Vault-relative path to an agent-request note when action is analyze.',
                    },
                    path: {
                        type: 'string',
                        description: 'Alias of request_path.',
                    },
                    task_id: {
                        type: 'string',
                        description: 'Optional task id to update with generated source/proposal paths.',
                    },
                    update_request_status: {
                        type: 'boolean',
                        description: 'Whether to update request status to completed/failed. Defaults to true.',
                    },
                    force_reprocess: {
                        type: 'boolean',
                        description: 'Process request even if status is not pending.',
                    },
                    max_items: {
                        type: 'integer',
                        description: 'Maximum number of pending requests to return when listing.',
                    },
                    status: {
                        type: 'string',
                        description: 'Optional status filter when listing, defaults to pending.',
                    },
                    source_kind: {
                        type: 'string',
                        description: 'Optional source kind filter when listing.',
                    },
                },
                additionalProperties: false,
            },
        },
        {
            name: 'tracekeeper.analyze_source_request',
            title: 'tracekeeper.analyze_source_request',
            description: '[low-risk write] Analyze one pending source request and write source note, report, review proposals, request status, and audit entry.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    request_path: {
                        type: 'string',
                        description: 'Vault-relative path to an agent-request note.',
                    },
                    path: {
                        type: 'string',
                        description: 'Alias of request_path.',
                    },
                    task_id: {
                        type: 'string',
                        description: 'Optional task id to update with generated source/proposal paths.',
                    },
                    update_request_status: {
                        type: 'boolean',
                        description: 'Whether to update request status to completed/failed. Defaults to true.',
                    },
                    force_reprocess: {
                        type: 'boolean',
                        description: 'Process request even if status is not pending.',
                    },
                },
                additionalProperties: false,
            },
            annotations: {
                destructiveHint: true,
            },
        },
        {
            name: 'tracekeeper.apply_approved_writeback',
            title: 'tracekeeper.apply_approved_writeback',
            description: '[review-gated apply] Apply an approved Review Queue proposal by appending explicit writeback content to its target note.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    proposal_id: {
                        type: 'string',
                        description: 'Proposal id to apply.',
                    },
                    proposal_path: {
                        type: 'string',
                        description: 'Vault-relative proposal note path.',
                    },
                    path: {
                        type: 'string',
                        description: 'Alias of proposal_path.',
                    },
                    task_id: {
                        type: 'string',
                        description: 'Optional task id to update with the applied writeback target.',
                    },
                    dry_run: {
                        type: 'boolean',
                        description: 'When true, return the writeback plan without modifying files.',
                    },
                },
                additionalProperties: false,
            },
            annotations: {
                destructiveHint: true,
            },
        },
        {
            name: 'tracekeeper.build_context_pack',
            title: 'tracekeeper.build_context_pack',
            description: '[read-only | optional write] Build context pack from vault and optionally write a markdown artifact.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    query: {
                        type: 'string',
                        description: 'Context pack query.',
                    },
                    task_id: {
                        type: 'string',
                        description: 'Optional task id for traceability.',
                    },
                    candidate_limit: {
                        type: 'integer',
                        description: 'How many matches to include.',
                    },
                    stale_after_days: {
                        type: 'integer',
                        description: 'Stale warning threshold in days.',
                    },
                    write: {
                        type: 'boolean',
                        description: 'Whether to write a markdown context-pack artifact.',
                    },
                    filename: {
                        type: 'string',
                        description: 'Optional file stem.',
                    },
                    title: {
                        type: 'string',
                        description: 'Optional note title when writing markdown artifact.',
                    },
                },
                required: ['query'],
                additionalProperties: false,
            },
        },
        {
            name: 'tracekeeper.lint',
            title: 'tracekeeper.lint',
            description: '[read-only] Run lint checks across vault notes.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    max_items: {
                        type: 'integer',
                        description: 'Maximum number of issues to return.',
                    },
                    graph_profile: {
                        type: 'string',
                        enum: ['off', 'advisory', 'strict'],
                        description: 'Graph checking mode. Defaults to the server graphProfile setting.',
                    },
                },
                additionalProperties: false,
            },
            annotations: {
                readOnlyHint: true,
            },
        },
        {
            name: 'tracekeeper.finish_task',
            title: 'tracekeeper.finish_task',
            description: '[low-risk write] Create a task session summary note under 00_tracekeeper/work/sessions.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    task_id: {
                        type: 'string',
                        description: 'Task id.',
                    },
                    summary: {
                        type: 'string',
                        description: 'Task summary.',
                    },
                    outcomes: {
                        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                        description: 'Optional outcomes.',
                    },
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
                    client: {
                        type: 'string',
                        description: 'Optional client context.',
                    },
                    project_hint: {
                        type: 'string',
                        description: 'Optional project hint.',
                    },
                    memory_scope: {
                        type: 'string',
                        enum: ['global', 'project'],
                        description: 'Optional memory scope override.',
                    },
                    related_wiki: {
                        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                        description: 'Optional related wiki note references.',
                    },
                    related_sources: {
                        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                        description: 'Optional related sources.',
                    },
                    filename: {
                        type: 'string',
                        description: 'Optional file stem.',
                    },
                },
                required: ['task_id', 'summary'],
                additionalProperties: false,
            },
            annotations: {
                destructiveHint: true,
            },
        },
        {
            name: 'tracekeeper.distill_session',
            title: 'tracekeeper.distill_session',
            description: '[low-risk write] Create a task session note and memory proposals from decisions/preferences.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: {
                        type: 'string',
                        description: 'Vault root path. If omitted, uses server configured --vault-root.',
                    },
                    task_id: {
                        type: 'string',
                        description: 'Task id.',
                    },
                    summary: {
                        type: 'string',
                        description: 'Session summary.',
                    },
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
                    project_hint: {
                        type: 'string',
                        description: 'Optional project hint.',
                    },
                    filename: {
                        type: 'string',
                        description: 'Optional file stem.',
                    },
                },
                required: ['task_id', 'summary'],
                additionalProperties: false,
            },
            annotations: {
                destructiveHint: true,
            },
        },
        {
            name: 'tracekeeper.write_context_pack',
            title: 'tracekeeper.write_context_pack',
            description: '[low-risk write] Create a new context-pack note under 00_tracekeeper/work/context_packs.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: { type: 'string', description: 'Vault root path. If omitted, uses server configured --vault-root.' },
                    filename: {
                        type: 'string',
                        description: 'Optional file stem. If omitted, auto-generates one.',
                    },
                    title: { type: 'string', description: 'Optional note title.' },
                    content: { type: 'string', description: 'Context pack markdown/text content.' },
                    task_id: { type: 'string', description: 'Optional task id for traceability.' },
                },
                required: ['content'],
                additionalProperties: false,
            },
            annotations: {
                destructiveHint: true,
            },
        },
        {
            name: 'tracekeeper.write_session_note',
            title: 'tracekeeper.write_session_note',
            description: '[low-risk write] Create a new session note under 00_tracekeeper/work/sessions.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: { type: 'string', description: 'Vault root path. If omitted, uses server configured --vault-root.' },
                    filename: {
                        type: 'string',
                        description: 'Optional file stem. If omitted, auto-generates one.',
                    },
                    content: { type: 'string', description: 'Session content.' },
                    task_id: { type: 'string', description: 'Optional task id for traceability.' },
                },
                required: ['content'],
                additionalProperties: false,
            },
            annotations: {
                destructiveHint: true,
            },
        },
        {
            name: 'tracekeeper.capture_source',
            title: 'tracekeeper.capture_source',
            description: '[low-risk write] Capture source metadata/content under 01_knowledge/sources with mode control.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: { type: 'string', description: 'Vault root path. If omitted, uses server configured --vault-root.' },
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
                    filename: {
                        type: 'string',
                        description: 'Optional file stem. If omitted, auto-generates one.',
                    },
                    title: { type: 'string', description: 'Optional source note title.' },
                    content: { type: 'string', description: 'Required when mode is extracted_snapshot or local_copy.' },
                    text: { type: 'string', description: 'Alias of content for compatibility.' },
                },
                required: ['source', 'mode'],
                additionalProperties: false,
            },
            annotations: {
                destructiveHint: true,
            },
        },
        {
            name: 'tracekeeper.propose_memory',
            title: 'tracekeeper.propose_memory',
            description: '[low-risk write] Create a memory update according to Tracekeeper memory rules.',
            inputSchema: {
                type: 'object',
                properties: {
                    vaultRoot: { type: 'string', description: 'Vault root path. If omitted, uses server configured --vault-root.' },
                    proposal_kind: { type: 'string', description: 'Proposal kind.' },
                    content: { type: 'string', description: 'Proposal markdown/text content.' },
                    evidence: { type: 'string', description: 'Optional evidence summary.' },
                    target_note: { type: 'string', description: 'Optional target note path.' },
                    risk_level: { type: 'string', description: 'Risk level label.' },
                    task_id: { type: 'string', description: 'Optional task id for traceability.' },
                    project_hint: { type: 'string', description: 'Optional project hint for project memory routing.' },
                    memory_scope: {
                        type: 'string',
                        enum: ['global', 'project'],
                        description: 'Optional memory scope override.',
                    },
                    related_wiki: {
                        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                        description: 'Optional related wiki note references.',
                    },
                    related_sources: {
                        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                        description: 'Optional related sources.',
                    },
                    filename: {
                        type: 'string',
                        description: 'Optional file stem. If omitted, auto-generates one.',
                    },
                    title: { type: 'string', description: 'Optional proposal title.' },
                },
                required: ['proposal_kind', 'content'],
                additionalProperties: false,
            },
            annotations: {
                destructiveHint: true,
            },
        },
    ];
    const definitionByName = new Map(definitions.map((definition) => [definition.name, definition]));
    return PUBLIC_TOOL_NAME_ORDER.map((toolName) => definitionByName.get(toolName)).filter((definition) => Boolean(definition));
}
function toolPrompts() {
    return [
        { name: 'Tracekeeper Start Task', title: 'Tracekeeper Start Task', description: 'Start a task with a read-only context summary.' },
        { name: 'Tracekeeper Recall Memory', title: 'Tracekeeper Recall Memory', description: 'Generate matching notes for fast recall.' },
    ];
}
function callTool(name, rawParams, context = {}) {
    if (!(0, protocol_1.isRecord)(rawParams)) {
        return toolError('Tool arguments must be an object.');
    }
    const requestName = typeof name === 'string' ? name.trim() : '';
    if (!requestName) {
        return toolError('Tool name is required.');
    }
    if (!isToolName(requestName)) {
        return toolError(`Unknown tool: ${requestName}`);
    }
    const args = rawParams;
    const startTime = Date.now();
    const agentId = context.agentId || 'unknown session id';
    const sessionId = context.sessionId;
    const clientName = context.clientName ?? null;
    const auditVaultRoot = resolveAuditVaultRoot(args, context);
    let toolResult = toolError(`Unknown tool: ${requestName}`);
    let status = 'failed';
    const toolName = requestName || 'unknown';
    const argsSummary = summarizeForAudit(args);
    try {
        switch (requestName) {
            case 'tracekeeper.status':
                toolResult = toolResultWithError(handleStatus(args, context));
                break;
            case 'tracekeeper.graph_health':
                toolResult = toolResultWithError(handleGraphHealth(args, context));
                break;
            case 'tracekeeper.start_task':
                toolResult = toolResultWithError(handleStartTask(args, context));
                break;
            case 'tracekeeper.recall':
                toolResult = toolResultWithError(handleRecall(args, context));
                break;
            case 'tracekeeper.read_note':
                toolResult = toolResultWithError(handleReadNote(args, context));
                break;
            case 'tracekeeper.review_queue':
                toolResult = toolResultWithError(handleReviewQueueUnified(args, context));
                break;
            case 'tracekeeper.project_context':
                toolResult = toolResultWithError(handleProjectContext(args, context));
                break;
            case 'tracekeeper.project_history':
                toolResult = toolResultWithError(handleProjectHistory(args, context));
                break;
            case 'tracekeeper.list_review_queue':
                toolResult = toolResultWithError(handleReviewQueue(args, context));
                break;
            case 'tracekeeper.list_source_requests':
                toolResult = toolResultWithError(handleListSourceRequests(args, context));
                break;
            case 'tracekeeper.list_approved_writebacks':
                toolResult = toolResultWithError(handleListApprovedWritebacks(args, context));
                break;
            case 'tracekeeper.audit_recent':
                toolResult = toolResultWithError(handleAuditRecent(args, context));
                break;
            case 'tracekeeper.source_request':
                toolResult = toolResultWithError(handleSourceRequest(args, context));
                break;
            case 'tracekeeper.analyze_source_request':
                toolResult = toolResultWithError(handleAnalyzeSourceRequest(args, context));
                break;
            case 'tracekeeper.apply_approved_writeback':
                toolResult = toolResultWithError(handleApplyApprovedWriteback(args, context));
                break;
            case 'tracekeeper.build_context_pack':
                toolResult = toolResultWithError(handleBuildContextPack(args, context));
                break;
            case 'tracekeeper.lint':
                toolResult = toolResultWithError(handleLint(args, context));
                break;
            case 'tracekeeper.finish_task':
                toolResult = toolResultWithError(handleFinishTask(args, context));
                break;
            case 'tracekeeper.distill_session':
                toolResult = toolResultWithError(handleDistillSession(args, context));
                break;
            case 'tracekeeper.write_context_pack':
                toolResult = toolResultWithError(handleWriteContextPack(args, context));
                break;
            case 'tracekeeper.write_session_note':
                toolResult = toolResultWithError(handleWriteSessionNote(args, context));
                break;
            case 'tracekeeper.capture_source':
                toolResult = toolResultWithError(handleCaptureSource(args, context));
                break;
            case 'tracekeeper.propose_memory':
                toolResult = toolResultWithError(handleProposeMemory(args, context));
                break;
            default:
                assertUnreachable(requestName);
        }
        status = isToolResultFailure(toolResult) ? 'failed' : 'success';
    }
    catch (error) {
        if (error instanceof safety_1.ToolInputError || error instanceof index_1.VaultPathError) {
            toolResult = toolError(error.message);
        }
        else if (error instanceof Error) {
            toolResult = toolError(error.message);
        }
        else {
            toolResult = toolError(toErrorMessage(error));
        }
        status = 'failed';
    }
    finally {
        if (auditVaultRoot) {
            try {
                recordToolCallAuditEvent(auditVaultRoot, {
                    toolName,
                    resultStatus: status,
                    targetPaths: collectAuditTargetsFromResult(requestName, args, toolResult.structuredContent),
                    durationMs: Date.now() - startTime,
                    riskLevel: getToolRiskLevel(requestName),
                    agentId,
                    sessionId,
                    clientName,
                    transport: context.transport,
                    runtimeVersion: context.runtimeVersion,
                    argsSummary,
                });
            }
            catch {
                // Tool-call audit writes are best effort.
            }
        }
    }
    return toolResult;
}
function toolResultWithError(value) {
    return toolResult(value);
}
function handleStatus(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const scan = scanVaultForContext(vaultRoot, context);
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        scanned_at: scan.scannedAt,
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
    const graphHealth = (0, index_1.analyzeGraphHealth)(scan.notes, {
        maxItems,
    });
    const profileEvaluation = (0, index_1.evaluateGraphProfile)(graphHealth, profile);
    return {
        ok: true,
        read_only: true,
        disabled: profileEvaluation.disabled,
        profile: profileEvaluation.profile,
        profile_issues: profileEvaluation.profile_issues,
        vault_root: vaultRoot,
        scanned_at: scan.scannedAt,
        ...graphHealth,
    };
}
function handleStartTask(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const goal = coerceNonEmptyString(rawArgs.goal, true, 'goal');
    const client = coerceNonEmptyString(rawArgs.client);
    const projectHint = coerceNonEmptyString(rawArgs.project_hint);
    if (goal.length < 3) {
        throw new safety_1.ToolInputError('goal must have at least 3 characters.');
    }
    const scan = scanVaultForContext(vaultRoot, context);
    const contextPack = buildContextPackForContext(vaultRoot, goal, context, { limit: 8 });
    const taskId = `obs_task_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const relatedProjects = scan.notes
        .filter((note) => PROJECT_MEMORY_READ_DIRS.some((dir) => note.relativePath.startsWith(`${dir}/`)))
        .slice(0, 10)
        .map((note) => ({ path: note.relativePath, title: note.title }));
    const task = createAgentTaskRecord(vaultRoot, {
        taskId,
        goal,
        client,
        projectHint,
        context,
        contextPack,
    });
    return {
        ok: true,
        read_only: false,
        task_id: taskId,
        path: task.path,
        audit_path: task.audit_path,
        client: client || null,
        project_hint: projectHint || null,
        vault_root: vaultRoot,
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
    };
}
function handleRecall(rawArgs, context) {
    const scope = coerceRecallScope(rawArgs.scope);
    if (scope === 'project') {
        const result = handleProjectContext(rawArgs, context);
        return {
            ...result,
            scope: {
                ...result.scope,
                scope,
            },
            scope_mode: scope,
        };
    }
    if (scope === 'project_history') {
        const result = handleProjectHistory(rawArgs, context);
        return {
            ...result,
            scope: {
                ...result.scope,
                scope,
            },
            scope_mode: scope,
        };
    }
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const query = coerceNonEmptyString(rawArgs.query, true, 'query');
    const maxItems = coercePositiveInt(rawArgs.max_items, 6, 1, 20);
    const scan = scanVaultForContext(vaultRoot, context);
    const rawMatches = (0, index_1.recallNotes)(scan.notes, query, { limit: maxItems });
    const matches = rankRecallMatches(rawMatches, query, {
        projectHint: '',
        projectId: '',
        repoPath: '',
    });
    return {
        ok: true,
        read_only: true,
        scope_mode: scope,
        query,
        vault_root: vaultRoot,
        max_items: maxItems,
        matched_count: matches.length,
        matches: matches.map((match) => ({
            path: match.note.relativePath,
            title: match.note.title,
            type: match.note.type,
            score: match.score,
            raw_score: match.raw_score,
            matched_tokens: match.matchedTokens,
            score_reason: match.score_reason,
        })),
    };
}
function handleReadNote(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const notePath = coerceNonEmptyString(rawArgs.path, true, 'path');
    const data = safeReadNote(vaultRoot, notePath, context);
    const parsed = (0, index_1.parseMarkdown)(data.text);
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        path: data.path,
        title: parsed.title || path.basename(data.path),
        mime_type: data.path.endsWith('.txt') || data.path.endsWith('.text') ? 'text/plain' : 'text/markdown',
        content: data.text,
        excerpt: parsed.body.slice(0, 1024),
    };
}
function handleProjectContext(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const query = coerceNonEmptyString(rawArgs.query, true, 'query');
    const scope = coerceProjectScope(rawArgs);
    const maxItems = coercePositiveInt(rawArgs.max_items, MAX_PROJECT_TOOL_ITEMS, 1, MAX_PROJECT_TOOL_ITEMS);
    const scan = scanVaultForContext(vaultRoot, context);
    const scopedNotes = filterNotesByProjectScopeWithSessions(scan.notes, scope);
    const uncertain = !hasProjectScope(scope);
    const rawMatches = (0, index_1.recallNotes)(scopedNotes, query, { limit: maxItems });
    const matches = rankRecallMatches(rawMatches, query, scope);
    const candidates = collectProjectCandidates(scan.notes, scope, MAX_PROJECT_SCOPE_CANDIDATES);
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        query,
        uncertain: uncertain,
        scope: buildProjectScopeMetadata(scope),
        max_items: maxItems,
        matched_count: matches.length,
        candidates: candidates,
        entries: matches.map((match) => ({
            path: match.note.relativePath,
            title: match.note.title,
            type: match.note.type,
            score: match.score,
            raw_score: match.raw_score,
            matched_tokens: match.matchedTokens,
            score_reason: match.score_reason,
        })),
    };
}
function handleProjectHistory(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const query = coerceOptionalString(rawArgs.query);
    const scope = coerceProjectScope(rawArgs);
    const maxItems = coercePositiveInt(rawArgs.max_items, MAX_PROJECT_TOOL_ITEMS, 1, MAX_PROJECT_TOOL_ITEMS);
    const scan = scanVaultForContext(vaultRoot, context);
    const scopedNotes = filterNotesByProjectScopeWithSessions(scan.notes, scope);
    const uncertain = !hasProjectScope(scope);
    const filteredByQuery = query ? scopedNotes.filter((note) => matchesProjectQuery(note, query)) : scopedNotes;
    const sortedMatches = filteredByQuery
        .filter((note) => note.relativePath !== '')
        .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
    const candidates = collectProjectCandidates(scan.notes, scope, MAX_PROJECT_SCOPE_CANDIDATES);
    const matches = sortedMatches.slice(0, maxItems);
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        query: query || null,
        uncertain: uncertain,
        scope: buildProjectScopeMetadata(scope),
        max_items: maxItems,
        matched_count: matches.length,
        total_matches: sortedMatches.length,
        candidates,
        entries: buildProjectHistoryEntries(matches),
    };
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
function resolveSourceInput(request, vaultRoot, context) {
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
            const fileText = safeReadTextFile(vaultRoot, parsedPath.requestedPath, context);
            return {
                sourceText: fileText,
                mode: 'local_copy',
                resolvedSourcePath: parsedPath.requestedPath,
                warnings: [],
            };
        }
        catch (error) {
            if (error instanceof safety_1.ToolInputError || error instanceof index_1.VaultPathError) {
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
function buildSourceNoteContent(request, mode, sourceText, analysis, resolvedSourcePath) {
    const section = ['## Source note', `- request_path: ${request.path}`, `- mode: ${mode}`, `- source_kind: ${request.sourceKind || 'unknown'}`];
    section.push(`- analysis_mode: ${request.analysisMode || 'default'}`);
    if (resolvedSourcePath) {
        section.push(`- resolved_source_path: ${resolvedSourcePath}`);
    }
    section.push('');
    section.push('## Source summary');
    section.push(analysis.summary);
    section.push('');
    section.push('## Evidence scaffold');
    for (const item of analysis.evidenceScaffolds) {
        section.push(`- ${item}`);
    }
    section.push('');
    section.push('## Claim scaffold');
    for (const item of analysis.claimScaffolds) {
        section.push(`- ${item}`);
    }
    section.push('');
    section.push('## Source excerpt');
    section.push(analysis.excerpt);
    return section.join('\n');
}
function buildReportContent(request, mode, sourceText, analysis, sourceNotePath, warnings) {
    const sourceContent = `\n## Source\n\n${sourceText.slice(0, MAX_SOURCE_EXCERPT_LENGTH)}\n`;
    const section = [
        '## Source Analysis Report',
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
    section.push('## Summary');
    section.push(analysis.summary);
    section.push('');
    section.push('## Excerpt');
    section.push(`\n${analysis.excerpt}\n`);
    section.push('');
    section.push('## Evidence scaffold');
    section.push(...analysis.evidenceScaffolds.map((entry) => `- ${entry}`));
    section.push('');
    section.push('## Claim scaffold');
    section.push(...analysis.claimScaffolds.map((entry) => `- ${entry}`));
    section.push('');
    section.push(sourceContent);
    return section.join('\n');
}
function handleAnalyzeSourceRequest(rawArgs, context, sourceToolName = 'tracekeeper.analyze_source_request') {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const requestPath = coerceOptionalString(rawArgs.request_path) || coerceOptionalString(rawArgs.path);
    if (!requestPath) {
        throw new safety_1.ToolInputError('Missing required argument: request_path or path.');
    }
    const requestPathAlias = requestPath;
    const updateStatus = coerceBoolean(rawArgs.update_request_status, 'update_request_status', true);
    const forceReprocess = coerceBoolean(rawArgs.force_reprocess, 'force_reprocess', false);
    const now = new Date().toISOString();
    try {
        const request = readSourceRequest(vaultRoot, requestPathAlias, context);
        const taskId = coerceOptionalString(rawArgs.task_id) || request.taskId || null;
        if (!request.type.toLowerCase().includes('agent-request')) {
            throw new safety_1.ToolInputError('Request note is not an agent-request note.');
        }
        if (!forceReprocess && request.status && !isSourceRequestPending(request.status)) {
            throw new safety_1.ToolInputError(`Request status is ${request.status}; use force_reprocess=true to process anyway.`);
        }
        const { sourceText, mode, resolvedSourcePath, warnings } = resolveSourceInput(request, vaultRoot, context);
        const analysis = (0, index_1.analyzeSourceText)({
            source: request.source,
            sourceKind: request.sourceKind || 'unknown',
            analysisMode: request.analysisMode || 'default',
            purpose: request.purpose,
            content: sourceText,
            requestPath: request.path,
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
        const sourceNote = buildAndWriteNote(vaultRoot, sourceToolName, SOURCES_DIR, sourceFilename, {
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
        }, buildSourceNoteContent(request, mode, sourceText, analysis, resolvedSourcePath), taskId, context, { target_type: 'source', mode, request_path: request.path });
        const reportFilename = buildSafeFilename(`${runToken}-report`, 'source-report', context);
        const report = buildAndWriteNote(vaultRoot, sourceToolName, SOURCE_ANALYSIS_REPORT_DIR, reportFilename, {
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
        }, buildReportContent(request, mode, sourceText, analysis, sourceNote.path, warnings), taskId, context, { target_type: 'source_analysis_report', request_path: request.path });
        const proposalPaths = analysis.proposalDrafts.map((entry) => {
            const proposalNote = buildAndWriteNote(vaultRoot, sourceToolName, MEMORY_PROPOSAL_DIR, buildSafeFilename(`proposal-${runToken}-${entry.proposalKind}`, entry.proposalKind, context), {
                tool: sourceToolName,
                type: 'memory_proposal',
                title: entry.title || `source_proposal_${runToken}`,
                proposal_kind: entry.proposalKind,
                status: 'pending',
                source: request.source,
                source_kind: request.sourceKind || null,
                target_note: report.path,
                risk_level: entry.riskLevel || null,
                created_at: now,
                task_id: taskId,
            }, `## Source analysis proposal\n\n- evidence: ${entry.evidence}\n\n${entry.content}\n`, taskId, context, {
                target_type: 'memory_proposal',
                proposal_kind: entry.proposalKind,
                request_path: request.path,
                source_note: sourceNote.path,
            });
            return proposalNote.path;
        });
        let auditPathForReturn = sourceNote.audit_path;
        if (updateStatus) {
            updateRequestStatus(vaultRoot, request.path, 'completed', context);
            auditPathForReturn = appendAuditEvent(vaultRoot, {
                tool: sourceToolName,
                targetPath: request.path,
                status: 'written',
                taskId,
                metadata: {
                    action: 'source.request.completed',
                    source_note: sourceNote.path,
                    source_report: report.path,
                    proposals: proposalPaths.join(','),
                },
            }).path;
        }
        updateAgentTaskRecord(vaultRoot, taskId, {}, context, {
            source_captures: [sourceNote.path, report.path],
            proposals: proposalPaths,
        });
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
            proposals: proposalPaths.map((proposalPath) => ({ path: proposalPath })),
            audit_path: auditPathForReturn,
            summary: analysis.summary,
            warnings,
        };
    }
    catch (error) {
        if (updateStatus) {
            try {
                updateRequestStatus(vaultRoot, requestPathAlias, 'failed', context);
                appendAuditEvent(vaultRoot, {
                    tool: sourceToolName,
                    targetPath: requestPathAlias,
                    status: 'failed',
                    taskId: coerceOptionalString(rawArgs.task_id) || null,
                    metadata: {
                        action: 'source.request.failed',
                        error: toErrorMessage(error),
                    },
                });
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
function handleSourceRequest(rawArgs, context) {
    const action = coerceSourceRequestAction(rawArgs.action, rawArgs);
    const result = action === 'analyze'
        ? handleAnalyzeSourceRequest(rawArgs, context, 'tracekeeper.source_request')
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
function handleApplyApprovedWriteback(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const dryRun = coerceBoolean(rawArgs.dry_run, 'dry_run', false);
    const proposal = resolveMemoryProposalFromArgs(vaultRoot, rawArgs, context);
    const taskId = coerceOptionalString(rawArgs.task_id) || proposal.taskId || null;
    const plan = buildWritebackPlan(proposal);
    const now = new Date().toISOString();
    if (!plan.ready) {
        throw new safety_1.ToolInputError(plan.reason || 'approved writeback is not ready to apply.');
    }
    assertNoSensitiveText([
        { label: 'proposal id', value: proposal.proposalId },
        { label: 'target note', value: plan.targetNote },
        { label: 'writeback content', value: plan.writebackContent },
    ]);
    const targetAbsolute = (0, safety_1.resolveSafeNotePath)(vaultRoot, plan.targetNote, pathSafetyOptions(context));
    const targetRelative = (0, safety_1.relativeFromAbsolute)(vaultRoot, targetAbsolute);
    assertAllowedWritebackTarget(targetRelative);
    const writebackBlock = [
        `## Approved Writeback: ${proposal.proposalId}`,
        '',
        plan.writebackContent,
        '',
        `^writeback-${proposal.proposalId.replace(/[^A-Za-z0-9._-]/g, '-')}`,
    ].join('\n');
    if (dryRun) {
        return {
            ok: true,
            read_only: true,
            dry_run: true,
            permission_level: 'review-gated apply',
            proposal_id: proposal.proposalId,
            proposal_path: proposal.path,
            target_note: targetRelative,
            touched_notes: [targetRelative, proposal.path, AUDIT_LOG_PATH],
            writeback_preview: writebackBlock,
        };
    }
    const currentTarget = fs.readFileSync(targetAbsolute, 'utf8');
    const targetWithWriteback = `${currentTarget.replace(/\s*$/, '')}\n\n${writebackBlock}\n`;
    fs.writeFileSync(targetAbsolute, targetWithWriteback, 'utf8');
    const updatedProposal = updateFrontmatterFields(proposal.text, {
        approval_status: 'applied',
        status: 'applied',
        writeback_applied_at: now,
        writeback_target: targetRelative,
    });
    fs.writeFileSync(proposal.absolutePath, updatedProposal, 'utf8');
    const audit = appendAuditEvent(vaultRoot, {
        tool: 'tracekeeper.apply_approved_writeback',
        targetPath: targetRelative,
        status: 'written',
        taskId,
        metadata: {
            action: 'writeback.apply',
            proposal_id: proposal.proposalId,
            proposal_path: proposal.path,
            permission_level: 'review-gated apply',
        },
    });
    updateAgentTaskRecord(vaultRoot, taskId, {}, context, {
        memory_writes: [targetRelative],
        proposals: [proposal.path],
    });
    return {
        ok: true,
        read_only: false,
        permission_level: 'review-gated apply',
        status: 'applied',
        proposal_id: proposal.proposalId,
        proposal_path: proposal.path,
        target_note: targetRelative,
        touched_notes: [targetRelative, proposal.path, audit.path],
        audit_path: audit.path,
    };
}
function handleAuditRecent(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const maxItems = coercePositiveInt(rawArgs.max_items, MAX_AUDIT_ITEMS, 1, 100);
    let auditPath = null;
    let text = '';
    try {
        auditPath = (0, safety_1.resolveSafeNotePath)(vaultRoot, AUDIT_LOG_PATH, pathSafetyOptions(context));
        text = fs.readFileSync(auditPath, 'utf8');
    }
    catch (error) {
        if (!(error instanceof safety_1.ToolInputError || error instanceof index_1.VaultPathError)) {
            throw error;
        }
    }
    const sections = text ? parseAuditSections(text) : [];
    const rel = auditPath ? (0, safety_1.relativeFromAbsolute)(vaultRoot, auditPath) : AUDIT_LOG_PATH;
    return {
        ok: true,
        read_only: true,
        vault_root: vaultRoot,
        audit_log: rel,
        total_sections: sections.length,
        sections: sections.slice(0, maxItems),
    };
}
function handleWriteContextPack(rawArgs, context) {
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
    const note = buildAndWriteNote(vaultRoot, 'tracekeeper.write_context_pack', CONTEXT_PACK_DIR, filename, {
        tool: 'tracekeeper.write_context_pack',
        type: 'context_pack',
        title: title || `context_pack_${now}`,
        created_at: now,
        task_id: taskId || null,
    }, content, taskId, context, { target_type: 'context_pack', tool: 'tracekeeper.write_context_pack' });
    updateAgentTaskRecord(vaultRoot, taskId, {
        context_pack: note.path,
    }, context, {
        context_packs: [note.path],
    });
    return makeToolResultForWrite('tracekeeper.write_context_pack', note);
}
function handleWriteSessionNote(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const content = coerceNonEmptyString(rawArgs.content, true, 'content');
    const filename = buildSafeFilename(rawArgs.filename, 'session', context);
    const taskId = coerceOptionalString(rawArgs.task_id) || null;
    const now = new Date().toISOString();
    assertNoSensitiveText([
        { label: 'content', value: content },
    ]);
    const note = buildAndWriteNote(vaultRoot, 'tracekeeper.write_session_note', SESSION_NOTE_DIR, filename, {
        tool: 'tracekeeper.write_session_note',
        type: 'session_note',
        created_at: now,
        task_id: taskId || null,
    }, content, taskId, context, { target_type: 'session_note', tool: 'tracekeeper.write_session_note' });
    updateAgentTaskRecord(vaultRoot, taskId, {}, context, {
        memory_writes: [note.path],
    });
    return makeToolResultForWrite('tracekeeper.write_session_note', note);
}
function handleCaptureSource(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const source = coerceNonEmptyString(rawArgs.source, true, 'source');
    const sourceKind = coerceOptionalString(rawArgs.source_kind);
    const mode = coerceCaptureMode(rawArgs.mode);
    const captureReason = coerceOptionalString(rawArgs.capture_reason);
    const relatedProject = coerceOptionalString(rawArgs.related_project);
    const filename = buildSafeFilename(rawArgs.filename, 'source', context);
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
    let body = `## Source capture\n\n`;
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
    const note = buildAndWriteNote(vaultRoot, 'tracekeeper.capture_source', SOURCES_DIR, filename, {
        tool: 'tracekeeper.capture_source',
        type: 'source_capture',
        title: title || `source_${mode}_${now}`,
        source,
        source_kind: sourceKind || null,
        mode,
        capture_reason: captureReason || null,
        related_project: relatedProject || null,
        created_at: now,
        task_id: taskId || null,
    }, body, taskId, context, { target_type: 'source_capture', mode });
    updateAgentTaskRecord(vaultRoot, taskId, {}, context, {
        source_captures: [note.path],
    });
    return {
        ok: true,
        tool: 'tracekeeper.capture_source',
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
function handleProposeMemory(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const proposalKind = coerceNonEmptyString(rawArgs.proposal_kind, true, 'proposal_kind');
    const content = coerceNonEmptyString(rawArgs.content, true, 'content');
    const evidence = coerceOptionalString(rawArgs.evidence);
    const targetNote = coerceOptionalString(rawArgs.target_note);
    const riskLevel = coerceOptionalString(rawArgs.risk_level);
    const title = coerceOptionalString(rawArgs.title);
    const filename = buildSafeFilename(rawArgs.filename, 'proposal', context);
    const taskId = coerceOptionalString(rawArgs.task_id) || null;
    const projectHint = coerceOptionalString(rawArgs.project_hint);
    const memoryScope = resolveMemoryScope(proposalKind, targetNote, projectHint, rawArgs.memory_scope);
    const relatedWiki = normalizeMultiValueList(rawArgs.related_wiki, 'related_wiki');
    const relatedSources = normalizeMultiValueList(rawArgs.related_sources, 'related_sources');
    const architectureStatus = buildArchitectureStatus(vaultRoot, context);
    const bridgeMetadata = resolveProjectMemoryBridgeMetadata(vaultRoot, memoryScope, projectHint, relatedWiki, context);
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
    if (memoryRule === 'auto_write') {
        const canAutoWrite = !(memoryScope === 'project' && bridgeMetadata.missing_wiki_bridge);
        const autoTarget = canAutoWrite
            ? resolveAutoMemoryTarget(vaultRoot, proposalKind, targetNote, projectHint, context, memoryScope)
            : null;
        if (autoTarget) {
            const note = appendAutoMemoryWrite(vaultRoot, {
                toolName: 'tracekeeper.propose_memory',
                proposalKind,
                targetNote: autoTarget.targetNote,
                allowedDir: autoTarget.allowedDir,
                title: title || `Memory update: ${proposalKind}`,
                content,
                taskId,
                context,
                projectHint,
                evidence,
                riskLevel,
                memoryScope,
                relatedWiki,
                relatedSources,
                architectureStatus,
                missingGraphBridges: architectureStatus.missing_graph_bridges,
                missingWikiBridge: false,
            });
            updateAgentTaskRecord(vaultRoot, taskId, {}, context, {
                memory_writes: [note.path],
            });
            return {
                ok: true,
                tool: 'tracekeeper.propose_memory',
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
                related_sources: relatedSources,
                architecture_status: architectureStatus.architecture_status,
                missing_graph_bridges: architectureStatus.missing_graph_bridges,
                missing_wiki_bridge: false,
                proposal_path: null,
            };
        }
    }
    const body = [
        '## Proposal',
        `- status: pending`,
        `- proposal_kind: ${proposalKind}`,
        evidence ? `- evidence: ${evidence}` : '',
        targetNote ? `- target_note: ${targetNote}` : '',
        `- memory_scope: ${memoryScope}`,
        projectHint ? `- project_hint: ${projectHint}` : '',
        bridgeMetadata.related_wiki.length ? `- related_wiki: ${JSON.stringify(bridgeMetadata.related_wiki)}` : '',
        relatedSources.length ? `- related_sources: ${JSON.stringify(relatedSources)}` : '',
        riskLevel ? `- risk_level: ${riskLevel}` : '',
        `- architecture_status: ${architectureStatus.architecture_status}`,
        `- missing_graph_bridges: ${JSON.stringify(architectureStatus.missing_graph_bridges)}`,
        bridgeMetadata.missing_wiki_bridge ? '- missing_wiki_bridge: true' : '',
        bridgeMetadata.missing_related_wiki.length ? `- missing_related_wiki: ${JSON.stringify(bridgeMetadata.missing_related_wiki)}` : '',
        '',
        content,
    ].filter(Boolean).join('\n');
    const note = buildAndWriteNote(vaultRoot, 'tracekeeper.propose_memory', MEMORY_PROPOSAL_DIR, filename, {
        tool: 'tracekeeper.propose_memory',
        type: 'memory_proposal',
        title: title || `proposal_${proposalKind}_${now}`,
        proposal_kind: proposalKind,
        status: 'pending',
        target_note: targetNote || null,
        risk_level: riskLevel || null,
        project_hint: projectHint || null,
        memory_scope: memoryScope,
        related_wiki: bridgeMetadata.related_wiki,
        related_sources: relatedSources,
        architecture_status: architectureStatus.architecture_status,
        missing_graph_bridges: architectureStatus.missing_graph_bridges,
        missing_wiki_bridge: bridgeMetadata.missing_wiki_bridge,
        missing_related_wiki: bridgeMetadata.missing_related_wiki,
        created_at: now,
        task_id: taskId || null,
    }, body, taskId, context, {
        target_type: 'memory_proposal',
        proposal_kind: proposalKind,
        risk_level: riskLevel || null,
    });
    updateAgentTaskRecord(vaultRoot, taskId, {}, context, {
        proposals: [note.path],
    });
    const response = {
        ok: true,
        tool: 'tracekeeper.propose_memory',
        status: note.status,
        path: note.path,
        audit_path: note.audit_path,
        warnings: note.warnings,
        auto_applied: false,
        duplicate: false,
        proposal_path: note.path,
        memory_rule: memoryRule,
        memory_scope: memoryScope,
        project_hint: projectHint || null,
        related_wiki: bridgeMetadata.related_wiki,
        related_sources: relatedSources,
        architecture_status: architectureStatus.architecture_status,
        missing_graph_bridges: architectureStatus.missing_graph_bridges,
        missing_wiki_bridge: bridgeMetadata.missing_wiki_bridge,
    };
    if (memoryScope === 'project' && bridgeMetadata.missing_wiki_bridge && memoryRule === 'auto_write') {
        response.memory_rule = 'review_queue';
    }
    return response;
}
function handleBuildContextPack(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const query = coerceNonEmptyString(rawArgs.query, true, 'query');
    const taskId = coerceOptionalString(rawArgs.task_id);
    const candidateLimit = coercePositiveInt(rawArgs.candidate_limit, 8, 1, 120);
    const staleAfterDays = coercePositiveInt(rawArgs.stale_after_days, 180, 1, 3650);
    const shouldWrite = coerceBoolean(rawArgs.write, 'write', false);
    const title = coerceOptionalString(rawArgs.title);
    const contextPack = buildContextPackForContext(vaultRoot, query, context, {
        limit: candidateLimit,
        staleAfterDays,
    });
    if (!shouldWrite) {
        return {
            ok: true,
            read_only: true,
            vault_root: vaultRoot,
            task_id: taskId || null,
            query,
            context_pack: contextPack,
        };
    }
    const now = new Date().toISOString();
    const filename = buildSafeFilename(rawArgs.filename, 'context_pack', context);
    const contextMarkdown = [
        '# Context Pack',
        `- query: ${contextPack.query}`,
        `- task_id: ${taskId || 'unset'}`,
        `- generated_at: ${contextPack.generatedAt}`,
        `- candidate_limit: ${candidateLimit}`,
        `- stale_after_days: ${staleAfterDays}`,
        '',
        '## Relevant Notes',
        ...contextPack.relevantNotes.map((entry) => `- ${entry.relativePath} | score: ${entry.score} | title: ${entry.title}`),
        '',
        '## Source Candidates',
        ...contextPack.sourceCandidates.map((entry) => `- ${entry.note} (${entry.reason})`),
        '',
        '## Evidence Candidates',
        ...contextPack.evidenceCandidates.map((entry) => {
            const marker = entry.blockId ? `#${entry.blockId}` : '';
            return `- ${entry.note} ${marker}`.trim();
        }),
        '',
        '## Gaps',
        ...contextPack.gaps.map((entry) => `- ${entry}`),
        '',
        '## Stale Warnings',
        ...contextPack.staleWarnings.map((entry) => `- ${entry}`),
        '',
        '## Scan Errors',
        ...contextPack.scanErrors.map((entry) => `- ${entry.path}: ${entry.error}`),
    ].join('\n');
    assertNoSensitiveText([
        { label: 'query', value: query },
        { label: 'title', value: title },
        { label: 'context pack', value: contextMarkdown },
    ]);
    const note = buildAndWriteNote(vaultRoot, 'tracekeeper.build_context_pack', CONTEXT_PACK_DIR, filename, {
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
    updateAgentTaskRecord(vaultRoot, taskId || null, {
        context_pack: note.path,
    }, context, {
        context_packs: [note.path],
    });
    return {
        ok: true,
        read_only: false,
        vault_root: vaultRoot,
        task_id: taskId || null,
        query,
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
    const graphHealth = profile === 'off' ? undefined : (0, index_1.analyzeGraphHealth)(scan.notes, { maxItems });
    const profileEvaluation = graphHealth
        ? (0, index_1.evaluateGraphProfile)(graphHealth, profile)
        : { profile, disabled: true, profile_issues: [] };
    const lintGraphHealth = graphHealth
        ? {
            disabled: profileEvaluation.disabled,
            profile: profileEvaluation.profile,
            profile_issues: profileEvaluation.profile_issues,
            ...graphHealth,
        }
        : null;
    const { issues } = (0, index_1.lintNotes)(vaultRoot, scan.notes, {
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
        issue_count: issues.length,
        issues: limitedIssues,
        graph_summary: graphHealth ? buildGraphSummary(graphHealth) : null,
        graph_health: lintGraphHealth,
        fix_plan_summary: buildFixPlanSummary(issues),
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
function buildSessionNoteBody(summary, outcomes, nextActions) {
    const lines = [
        '# Task Session Note',
        `- created_at: ${new Date().toISOString()}`,
        '',
        '## Summary',
        summary,
        '',
        '## Outcomes',
        ...formatListMarkdown(outcomes).split('\n'),
        '',
        '## Next Actions',
        ...formatListMarkdown(nextActions).split('\n'),
    ].join('\n');
    return lines.trim();
}
function buildSessionNoteBodyWithCloseout(summary, outcomes, nextActions, decisions, solutionChanges, lessons, preferences, memoryCandidates) {
    const lines = [
        '# Task Session Note',
        `- created_at: ${new Date().toISOString()}`,
        '',
        '## Summary',
        summary,
        '',
        '## Outcomes',
        ...formatListMarkdown(outcomes).split('\n'),
        '',
        '## Next Actions',
        ...formatListMarkdown(nextActions).split('\n'),
        '',
        '## Decisions',
        ...formatListMarkdown(decisions).split('\n'),
        '',
        '## Solution Changes',
        ...formatListMarkdown(solutionChanges).split('\n'),
        '',
        '## Lessons',
        ...formatListMarkdown(lessons).split('\n'),
        '',
        '## Preferences',
        ...formatListMarkdown(preferences).split('\n'),
        '',
        '## Memory Candidates',
        ...formatListMarkdown(memoryCandidates).split('\n'),
    ].join('\n');
    return lines.trim();
}
function buildSessionNoteBodyWithDistill(summary, outcomes, nextActions, decisions, possiblePreferences) {
    const lines = [
        '# Distilled Session Note',
        `- created_at: ${new Date().toISOString()}`,
        '',
        '## Summary',
        summary,
        '',
        '## Outcomes',
        ...formatListMarkdown(outcomes).split('\n'),
        '',
        '## Next Actions',
        ...formatListMarkdown(nextActions).split('\n'),
        '',
        '## Decisions',
        ...formatListMarkdown(decisions).split('\n'),
        '',
        '## Possible Preferences',
        ...formatListMarkdown(possiblePreferences).split('\n'),
    ].join('\n');
    return lines.trim();
}
function createDistillProposal(vaultRoot, taskId, proposalKind, kindLabel, contentItems, projectHint, context) {
    const body = [
        `## Distilled ${kindLabel}`,
        ...contentItems.map((item) => `- ${item}`),
        '',
        `- task_id: ${taskId}`,
    ].join('\n');
    const now = new Date().toISOString();
    const filenameToken = `${proposalKind}-${taskId}-${now.replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
    const proposal = buildAndWriteNote(vaultRoot, 'tracekeeper.distill_session', MEMORY_PROPOSAL_DIR, buildSafeFilename(filenameToken, proposalKind, context), {
        tool: 'tracekeeper.distill_session',
        type: 'memory_proposal',
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
    return { path: proposal.path };
}
function handleFinishTask(rawArgs, context) {
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
    const taskMetadata = readAgentTaskMetadata(vaultRoot, taskId, context);
    const client = coerceOptionalString(rawArgs.client) || taskMetadata.client;
    const projectHint = coerceOptionalString(rawArgs.project_hint) || taskMetadata.projectHint;
    const memoryScopeValue = rawArgs.memory_scope;
    const relatedWiki = normalizeMultiValueList(rawArgs.related_wiki, 'related_wiki');
    const relatedSources = normalizeMultiValueList(rawArgs.related_sources, 'related_sources');
    const architectureStatus = buildArchitectureStatus(vaultRoot, context);
    const filename = buildSafeFilename(rawArgs.filename, 'session', context);
    const now = new Date().toISOString();
    const body = buildSessionNoteBodyWithCloseout(summary, outcomes, nextActions, decisions, solutionChanges, lessons, preferences, memoryCandidates);
    assertNoSensitiveText([
        { label: 'summary', value: summary },
        { label: 'outcomes', value: outcomes.join('\n') },
        { label: 'next_actions', value: nextActions.join('\n') },
        { label: 'decisions', value: decisions.join('\n') },
        { label: 'solution_changes', value: solutionChanges.join('\n') },
        { label: 'lessons', value: lessons.join('\n') },
        { label: 'preferences', value: preferences.join('\n') },
        { label: 'memory_candidates', value: memoryCandidates.join('\n') },
        { label: 'client', value: client },
        { label: 'project_hint', value: projectHint },
        { label: 'related_wiki', value: relatedWiki.join('\n') },
        { label: 'related_sources', value: relatedSources.join('\n') },
    ]);
    const note = buildAndWriteNote(vaultRoot, 'tracekeeper.finish_task', SESSION_NOTE_DIR, filename, {
        tool: 'tracekeeper.finish_task',
        type: 'session_note',
        title: `Task ${taskId} finish note`,
        task_id: taskId,
        client: client || null,
        project_hint: projectHint || null,
        related_project: projectHint || null,
        memory_scope: resolveMemoryScope('session_finish', '', projectHint, memoryScopeValue),
        related_wiki: relatedWiki,
        related_sources: relatedSources,
        architecture_status: architectureStatus.architecture_status,
        missing_graph_bridges: architectureStatus.missing_graph_bridges,
        created_at: now,
        review_proposal_mode: reviewProposalMode || null,
    }, body, taskId, context, {
        target_type: 'session_note',
        task_stage: 'finish',
    });
    const proposalResult = buildFinishTaskProposals(vaultRoot, taskId, note.path, reviewProposalMode, projectHint, memoryScopeValue, relatedWiki, relatedSources, architectureStatus, {
        decisions,
        solution_changes: solutionChanges,
        lessons,
        preferences,
        next_actions: nextActions,
        memory_candidates: memoryCandidates,
    }, context);
    const proposalPaths = proposalResult.proposals.map((proposal) => proposal.path);
    const autoWritePaths = proposalResult.autoAppliedMemoryUpdates.map((update) => update.path);
    const taskPath = updateAgentTaskRecord(vaultRoot, taskId, {
        status: 'completed',
        finished_at: now,
        summary,
        session_note: note.path,
        outcomes: outcomes.join(', '),
        next_actions: nextActions.join(', '),
        decisions: decisions.join(', '),
        solution_changes: solutionChanges.join(', '),
        lessons: lessons.join(', '),
        preferences: preferences.join(', '),
        memory_candidates: memoryCandidates.join(', '),
        review_proposal_mode: reviewProposalMode,
        project_hint: projectHint,
        related_project: projectHint,
    }, context, {
        memory_writes: [note.path, ...autoWritePaths],
        proposals: proposalPaths,
    }, [
        '## Completion Summary',
        summary,
        '',
        '## Outcomes',
        ...formatListMarkdown(outcomes).split('\n'),
        '',
        '## Next Actions',
        ...formatListMarkdown(nextActions).split('\n'),
        '',
        '## Decisions',
        ...formatListMarkdown(decisions).split('\n'),
        '',
        '## Solution Changes',
        ...formatListMarkdown(solutionChanges).split('\n'),
        '',
        '## Lessons',
        ...formatListMarkdown(lessons).split('\n'),
        '',
        '## Preferences',
        ...formatListMarkdown(preferences).split('\n'),
        '',
        '## Memory Candidates',
        ...formatListMarkdown(memoryCandidates).split('\n'),
    ].join('\n'));
    const response = {
        ok: true,
        read_only: false,
        task_id: taskId,
        task_path: taskPath,
        path: note.path,
        audit_path: note.audit_path,
        review_proposal_mode: reviewProposalMode,
        outcome_count: outcomes.length,
        next_action_count: nextActions.length,
        memory_scope: resolveMemoryScope('session_finish', '', projectHint, memoryScopeValue),
        project_hint: projectHint || null,
        related_wiki: relatedWiki,
        related_sources: relatedSources,
        architecture_status: architectureStatus.architecture_status,
        missing_graph_bridges: architectureStatus.missing_graph_bridges,
        missing_wiki_bridge: proposalResult.hasMissingWikiBridge,
    };
    if (reviewProposalMode === 'auto_propose' || reviewProposalMode === 'review_queue') {
        response.proposal_count = proposalResult.proposals.length;
        response.proposals = proposalResult.proposals.map((proposal) => ({
            kind: proposal.kind,
            path: proposal.path,
        }));
        response.auto_applied_count = proposalResult.autoAppliedMemoryUpdates.length;
        response.auto_applied_memory_updates = proposalResult.autoAppliedMemoryUpdates.map((update) => ({
            kind: update.kind,
            path: update.path,
            status: update.status,
        }));
    }
    if (reviewProposalMode === 'suggest') {
        response.suggestion_count = proposalResult.suggestedMemoryUpdates.length;
        response.suggested_memory_updates = proposalResult.suggestedMemoryUpdates.map((update) => ({
            kind: update.kind,
            label: update.label,
            values: update.values,
        }));
    }
    return response;
}
function handleDistillSession(rawArgs, context) {
    const vaultRoot = vaultRootFromArgs(rawArgs, context);
    const taskId = coerceNonEmptyString(rawArgs.task_id, true, 'task_id');
    const summary = coerceNonEmptyString(rawArgs.summary, true, 'summary');
    const decisions = coerceStringOrStringArray(rawArgs.decisions, 'decisions');
    const nextActions = coerceStringOrStringArray(rawArgs.next_actions, 'next_actions');
    const possiblePreferences = coerceStringOrStringArray(rawArgs.possible_preferences, 'possible_preferences');
    const outcomes = coerceStringOrStringArray(rawArgs.outcomes, 'outcomes');
    const projectHint = coerceOptionalString(rawArgs.project_hint) || readAgentTaskMetadata(vaultRoot, taskId, context).projectHint;
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
    const body = buildSessionNoteBodyWithDistill(summary, outcomes, nextActions, decisions, possiblePreferences);
    const note = buildAndWriteNote(vaultRoot, 'tracekeeper.distill_session', SESSION_NOTE_DIR, filename, {
        tool: 'tracekeeper.distill_session',
        type: 'session_note',
        title: `Task ${taskId} distill note`,
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
            const proposal = createDistillProposal(vaultRoot, taskId, 'distill_decisions', 'Decisions', decisions, projectHint, context);
            proposals.push(proposal.path);
        }
    }
    if (possiblePreferences.length > 0) {
        if (isMemoryProposalAllowed('distill_preferences', '', projectHint, context)) {
            const proposal = createDistillProposal(vaultRoot, taskId, 'distill_preferences', 'Possible Preferences', possiblePreferences, projectHint, context);
            proposals.push(proposal.path);
        }
    }
    updateAgentTaskRecord(vaultRoot, taskId, {
        session_note: note.path,
    }, context, {
        memory_writes: [note.path],
        proposals,
    });
    return {
        ok: true,
        read_only: false,
        task_id: taskId,
        path: note.path,
        audit_path: note.audit_path,
        proposals: proposals.map((p) => ({ path: p })),
        proposal_count: proposals.length,
    };
}
