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
exports.agentActivityPath = void 0;
exports.projectArgumentsForAudit = projectArgumentsForAudit;
exports.summarizeForAudit = summarizeForAudit;
exports.collectAuditTargetsFromArgs = collectAuditTargetsFromArgs;
exports.collectAuditTargetsFromResult = collectAuditTargetsFromResult;
exports.readMergedAuditSections = readMergedAuditSections;
exports.appendAuditEvent = appendAuditEvent;
exports.appendAuditEventAsync = appendAuditEventAsync;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const core_1 = require("@tracekeeper/core");
const safety_1 = require("../safety");
const protocol_1 = require("../protocol");
const AGENT_ACTIVITY_DIR = core_1.TRACEKEEPER_AGENT_ACTIVITY_DIR;
const AGENT_ACTIVITY_HUB_PATH = core_1.TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH;
const AGENT_ACTIVITY_SCHEMA_VERSION = 1;
const MAX_AUDIT_SCALAR_LENGTH = 240;
const MAX_AUDIT_ARRAY_ITEMS = 12;
const MAX_AUDIT_METADATA_FIELDS = 32;
const MAX_ARGS_SUMMARY_LENGTH = 512;
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
exports.agentActivityPath = AGENT_ACTIVITY_HUB_PATH;
function stripYamlQuotes(value) {
    if (value.length >= 2) {
        const first = value[0];
        const last = value[value.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return value.slice(1, -1);
        }
    }
    return value;
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
function isSensitiveKey(key) {
    return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
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
    'vaultRoot',
]);
function projectRecallAuditMetadataValue(key, value) {
    if (AUDIT_LOCAL_PATH_ARGUMENT_KEYS.has(key)) {
        return '[redacted]';
    }
    if (value === null
        || value === undefined
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean') {
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
function addTrimmedTarget(targets, value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
            targets.add(trimmed);
        }
    }
}
function getRecordValue(record, key) {
    return (0, protocol_1.isRecord)(record) ? record[key] : undefined;
}
function collectAuditTargetsFromArgs(_toolName, args) {
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
            'activity_path',
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
            auditEventId: auditSectionField(currentBody, 'activity_event_id') || undefined,
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
const isAgentActivityShardRecordPath = (relativePath) => new RegExp(`^${AGENT_ACTIVITY_DIR.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')}/\\d{4}/\\d{4}-\\d{2}-\\d{2}\\.md$`).test(relativePath);
function directAgentActivityShardPaths(vaultRoot) {
    const normalizedDirectory = (0, safety_1.normalizeNotePath)(AGENT_ACTIVITY_DIR);
    const absoluteDirectory = path.resolve(vaultRoot, normalizedDirectory);
    (0, safety_1.relativeFromAbsolute)(vaultRoot, absoluteDirectory);
    (0, safety_1.assertNoSymlinkSegments)(vaultRoot, absoluteDirectory);
    if (!fs.existsSync(absoluteDirectory)) {
        return [];
    }
    const rootState = fs.lstatSync(absoluteDirectory);
    if (!rootState.isDirectory()) {
        throw new core_1.VaultPathError('Agent activity shard path is not a directory.');
    }
    const paths = [];
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                throw new core_1.VaultPathError('Agent activity shard path contains a symbolic link.');
            }
            if (entry.isDirectory()) {
                visit(absolute);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const relative = (0, safety_1.relativeFromAbsolute)(vaultRoot, absolute);
            if (isAgentActivityShardRecordPath(relative)) {
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
        const metadata = await context.vaultRepository.listMarkdown(AGENT_ACTIVITY_DIR);
        for (const item of [...metadata].sort((left, right) => left.path.localeCompare(right.path))) {
            if (!isAgentActivityShardRecordPath(item.path)) {
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
        for (const shardPath of directAgentActivityShardPaths(vaultRoot)) {
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
        body: section.body.filter((line) => !/^\s*-?\s*activity_event_id:\s*/.test(line)),
        at_line: section.atLine,
        activity_event_id: section.auditEventId || '',
        timestamp: section.timestamp,
        source_path: section.sourcePath,
        source_kind: 'shard',
        action: section.action,
    }));
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
    const relative = (0, safety_1.normalizeNotePath)(AGENT_ACTIVITY_HUB_PATH);
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
        `- activity_event_id: ${auditYamlValue('activity_event_id', auditEventId)}`,
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
        eventLines.push('- target_paths:');
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
        'type: tracekeeper_agent_activity_shard',
        `agent_activity_schema_version: ${AGENT_ACTIVITY_SCHEMA_VERSION}`,
        `activity_date: ${day}`,
        `activity_date_utc: ${day}`,
        `created_at: ${timestamp}`,
        `updated_at: ${timestamp}`,
        `agent_activity_hub: ${AGENT_ACTIVITY_HUB_PATH}`,
        '---',
        `# Agent activity ${day}`,
        '',
        '[Agent activity hub](../index.md#agent-activity)',
        '',
    ].join('\n');
}
function auditHubContent(timestamp) {
    return [
        '---',
        'type: tracekeeper_agent_activity_hub',
        `agent_activity_schema_version: ${AGENT_ACTIVITY_SCHEMA_VERSION}`,
        `created_at: ${timestamp}`,
        '---',
        '# Agent activity',
        '',
        'Daily Agent activity shards link back to this hub.',
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
    await withRepositoryAuditLock(repository, AGENT_ACTIVITY_HUB_PATH, async () => {
        if (await repository.readText(AGENT_ACTIVITY_HUB_PATH)) {
            return;
        }
        try {
            await repository.createText(AGENT_ACTIVITY_HUB_PATH, auditHubContent(timestamp));
        }
        catch (error) {
            if (!(await repository.readText(AGENT_ACTIVITY_HUB_PATH))) {
                throw error;
            }
        }
    });
}
function appendPreparedAuditEvent(current, event) {
    const marker = `- activity_event_id: ${auditYamlValue('activity_event_id', event.auditEventId)}`;
    if (current?.includes(marker)) {
        return { content: current, duplicate: true };
    }
    if (current
        && !/^---\n[\s\S]*?^type:\s*(?:tracekeeper_agent_activity_shard|tracekeeper-agent-activity-shard)\s*$/m.test(current)) {
        throw new core_1.OperationConflictError(`Agent activity shard has an invalid record type: ${event.shardPath}`);
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
    if (!isAgentActivityEventInput(input)) {
        return { path: event.shardPath };
    }
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
    if (!isAgentActivityEventInput(input)) {
        return { path: event.shardPath };
    }
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
function isAgentActivityEventInput(input) {
    return typeof input.type === 'string' && input.type.startsWith('mcp.');
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
