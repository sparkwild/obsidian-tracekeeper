import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
	VaultPathError,
	analyzeSourceText,
	type ContextPack,
	type ParsedMarkdown,
	analyzeGraphHealth,
	evaluateGraphProfile,
	type GraphProfile,
	normalizeGraphProfile,
	type SourceAnalysisResult,
	type SourceProposalDraft,
	buildContextPack,
	lintNotes,
	parseMarkdown,
	recallNotes,
	type ScanResult,
	type ScannedNote,
	scanVault,
} from '../../../packages/core/dist/index';
import {
	isRecord,
	type McpPrompt,
	type McpStructuredToolResult,
	type McpToolDefinition,
} from './protocol';
import {
	ToolInputError,
	normalizeNotePath,
	relativeFromAbsolute,
	resolveSafeNotePath,
	resolveSafeWritableNotePath,
	assertNoSymlinkSegments,
	toSafeVaultRoot,
} from './safety';

const REVIEW_QUEUE_PREFIX = '01_inbox/review_queue';
const AUDIT_LOG_PATH = '00_control/audit_log.md';
const MAX_LIST_QUEUE_ITEMS = 20;
const MAX_AUDIT_ITEMS = 20;
const MAX_APPROVED_WRITEBACKS = 20;
const CONTEXT_PACK_DIR = '06_outputs/context_packs';
const SESSION_NOTE_DIR = '02_timeline/sessions';
const AGENT_TASK_DIR = '02_timeline/agent_tasks';
const SOURCE_REQUESTS_DIR = '01_inbox/agent_requests';
const SOURCES_DIR = '03_sources';
const SOURCE_ANALYSIS_REPORT_DIR = '06_outputs/source_analysis';
const MEMORY_PROPOSAL_DIR = '01_inbox/review_queue';
const MAX_SOURCE_EXCERPT_LENGTH = 1000;

type CaptureSourceMode = 'external_reference' | 'extracted_snapshot' | 'local_copy';
type SensitiveTextScan = { ok: true } | { ok: false; reason: string };

interface ToolContext {
	defaultVaultRoot?: string;
	vaultConfigDir?: string;
	graphProfile?: unknown;
}

export interface ToolInvocationContext extends ToolContext {
	agentId?: string;
	sessionId?: string;
	clientName?: string | null;
	transport?: string;
	runtimeVersion?: string;
}

interface ConnectionAuditEventInput {
	agentId: string;
	sessionId?: string;
	clientName: string | null;
	transport: string;
	runtimeVersion: string;
}

interface ToolCallAuditEventInput {
	toolName: string;
	resultStatus: 'success' | 'failed';
	targetPaths: string[];
	durationMs: number;
	riskLevel: string;
	agentId: string;
	sessionId?: string;
	clientName: string | null;
	transport?: string;
	runtimeVersion?: string;
	argsSummary: string;
}

const READ_ONLY_TOOL_NAMES = new Set([
	'tracekeeper.status',
	'tracekeeper.graph_health',
	'tracekeeper.recall',
	'tracekeeper.read_note',
	'tracekeeper.list_review_queue',
	'tracekeeper.list_source_requests',
	'tracekeeper.list_approved_writebacks',
	'tracekeeper.audit_recent',
	'tracekeeper.lint',
]);

const REVIEW_GATED_TOOL_NAMES = new Set(['tracekeeper.apply_approved_writeback']);

const LOW_RISK_TOOL_NAMES = new Set([
	'tracekeeper.start_task',
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

type ToolName =
	| 'tracekeeper.status'
	| 'tracekeeper.graph_health'
	| 'tracekeeper.start_task'
	| 'tracekeeper.recall'
	| 'tracekeeper.read_note'
	| 'tracekeeper.list_review_queue'
	| 'tracekeeper.list_source_requests'
	| 'tracekeeper.list_approved_writebacks'
	| 'tracekeeper.audit_recent'
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

const TOOL_NAME_SET = new Set<string>([
	'tracekeeper.status',
	'tracekeeper.graph_health',
	'tracekeeper.start_task',
	'tracekeeper.recall',
	'tracekeeper.read_note',
	'tracekeeper.list_review_queue',
	'tracekeeper.list_source_requests',
	'tracekeeper.list_approved_writebacks',
	'tracekeeper.audit_recent',
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

function isToolName(value: string): value is ToolName {
	return TOOL_NAME_SET.has(value);
}

interface ToolArgs {
	vaultRoot?: unknown;
}

type StatusArgs = ToolArgs;

interface GraphHealthArgs extends ToolArgs {
	max_items?: unknown;
	graph_profile?: unknown;
}

interface StartTaskArgs extends ToolArgs {
	goal?: unknown;
	client?: unknown;
	project_hint?: unknown;
}

interface BuildContextPackArgs extends ToolArgs {
	query?: unknown;
	task_id?: unknown;
	candidate_limit?: unknown;
	stale_after_days?: unknown;
	write?: unknown;
	filename?: unknown;
	title?: unknown;
}

interface LintArgs extends ToolArgs {
	max_items?: unknown;
	graph_profile?: unknown;
}

interface FinishTaskArgs extends ToolArgs {
	task_id?: unknown;
	summary?: unknown;
	outcomes?: unknown;
	next_actions?: unknown;
	client?: unknown;
	project_hint?: unknown;
	filename?: unknown;
}

interface RecallArgs extends ToolArgs {
	query?: unknown;
	max_items?: unknown;
}

interface ReadNoteArgs extends ToolArgs {
	path?: unknown;
}

interface ListReviewQueueArgs extends ToolArgs {
	max_items?: unknown;
}

interface AuditRecentArgs extends ToolArgs {
	max_items?: unknown;
}

interface WriteContextPackArgs extends ToolArgs {
	filename?: unknown;
	content?: unknown;
	title?: unknown;
	task_id?: unknown;
}

interface WriteSessionNoteArgs extends ToolArgs {
	filename?: unknown;
	content?: unknown;
	task_id?: unknown;
}

interface DistillSessionArgs extends ToolArgs {
	task_id?: unknown;
	summary?: unknown;
	decisions?: unknown;
	next_actions?: unknown;
	possible_preferences?: unknown;
	outcomes?: unknown;
	project_hint?: unknown;
	filename?: unknown;
}

interface CaptureSourceArgs extends ToolArgs {
	source?: unknown;
	source_kind?: unknown;
	capture_reason?: unknown;
	task_id?: unknown;
	related_project?: unknown;
	mode?: unknown;
	filename?: unknown;
	title?: unknown;
	content?: unknown;
	text?: unknown;
}

interface ProposeMemoryArgs extends ToolArgs {
	proposal_kind?: unknown;
	content?: unknown;
	evidence?: unknown;
	target_note?: unknown;
	risk_level?: unknown;
	task_id?: unknown;
	filename?: unknown;
	title?: unknown;
}

interface ListApprovedWritebacksArgs extends ToolArgs {
	scope?: unknown;
	max_items?: unknown;
	limit?: unknown;
}

interface ApplyApprovedWritebackArgs extends ToolArgs {
	proposal_id?: unknown;
	proposal_path?: unknown;
	path?: unknown;
	task_id?: unknown;
	dry_run?: unknown;
}

interface ListSourceRequestsArgs extends ToolArgs {
	max_items?: unknown;
	status?: unknown;
	source_kind?: unknown;
}

interface AnalyzeSourceRequestArgs extends ToolArgs {
	request_path?: unknown;
	path?: unknown;
	task_id?: unknown;
	update_request_status?: unknown;
	force_reprocess?: unknown;
}

interface SourceRequestRecord {
	type: string;
	path: string;
	source: string;
	sourceKind: string;
	purpose: string;
	relatedProject: string;
	analysisMode: string;
	status: string;
	taskId: string;
	created: string;
	content: string;
	filename: string;
}

interface AuditEventInput {
	type?: string;
	event?: string;
	tool?: string;
	action?: string;
	actor?: string;
	timestamp?: string;
	targetPath?: string;
	targetPaths?: string[];
	resultStatus?: 'written' | 'skipped' | 'failed' | 'success';
	status?: 'written' | 'skipped' | 'failed' | 'success';
	agentId?: string;
	sessionId?: string;
	clientName?: string | null;
	taskId?: string | null;
	warnings?: string[];
	durationMs?: number;
	riskLevel?: string;
	transport?: string;
	runtimeVersion?: string;
	argsSummary?: string;
	metadata?: Record<string, unknown>;
}

interface AuditEventOutput {
	path: string;
}

type ToolResultPayload = Record<string, unknown>;

function getRecordValue(record: unknown, key: string): unknown {
	return isRecord(record) ? record[key] : undefined;
}

function addTrimmedTarget(targets: Set<string>, value: unknown): void {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed) {
			targets.add(trimmed);
		}
	}
}

interface MemoryProposalDocument {
	absolutePath: string;
	path: string;
	proposalId: string;
	proposalKind: string;
	approvalStatus: string;
	targetNote: string;
	riskLevel: string;
	taskId: string;
	body: string;
	text: string;
	frontmatter: Record<string, unknown>;
}

interface WritebackPlan {
	proposal: MemoryProposalDocument;
	targetNote: string;
	writebackContent: string;
	ready: boolean;
	reason?: string;
}

function toolResult(payload: unknown, isError = false): McpStructuredToolResult {
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

function toolError(message: string): McpStructuredToolResult {
	return toolResult({ ok: false, error: message }, true);
}

function vaultRootFromArgs(args: ToolArgs, context: ToolContext): string {
	if (args.vaultRoot !== undefined) {
		return toSafeVaultRoot(args.vaultRoot);
	}
	if (!context.defaultVaultRoot) {
		throw new ToolInputError('vaultRoot is required unless --vault-root is configured.');
	}
	return toSafeVaultRoot(context.defaultVaultRoot);
}

function pathSafetyOptions(context: ToolContext): { vaultConfigDir?: string } {
	return {
		vaultConfigDir: context.vaultConfigDir,
	};
}

function graphProfileFromArgs(value: unknown, context: ToolContext): GraphProfile {
	return normalizeGraphProfile(value ?? context.graphProfile);
}

function scanVaultForContext(vaultRoot: string, context: ToolContext): ScanResult {
	return scanVault(vaultRoot, pathSafetyOptions(context));
}

function buildContextPackForContext(
	vaultRoot: string,
	query: string,
	context: ToolContext,
	options: Parameters<typeof buildContextPack>[2] = {}
): ContextPack {
	return buildContextPack(vaultRoot, query, {
		...options,
		...pathSafetyOptions(context),
	});
}

function coerceNonEmptyString(value: unknown, required = false, field = 'value'): string {
	if (typeof value !== 'string' || value.trim() === '') {
		if (required) {
			throw new ToolInputError(`Missing required string argument: ${field}.`);
		}
		return '';
	}
	return value.trim();
}

function coerceOptionalString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function coerceStringOrStringArray(value: unknown, field: string, required = false): string[] {
	if (value === undefined || value === null) {
		if (required) {
			throw new ToolInputError(`Missing required argument: ${field}.`);
		}
		return [];
	}

	if (typeof value === 'string') {
		const normalized = value.trim();
		if (!normalized) {
			if (required) {
				throw new ToolInputError(`Missing required argument: ${field}.`);
			}
			return [];
		}
		return [normalized];
	}

	if (Array.isArray(value)) {
		const normalized = value
			.filter((entry): entry is string => typeof entry === 'string')
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
		if (required && normalized.length === 0) {
			throw new ToolInputError(`Missing required argument: ${field}.`);
		}
		if (normalized.length !== value.length) {
			throw new ToolInputError(`${field} array must contain only strings.`);
		}
		return normalized;
	}

	throw new ToolInputError(`${field} must be a string or string array.`);
}

function formatListMarkdown(values: string[]): string {
	if (values.length === 0) {
		return '- (none)';
	}
	return values.map((item) => `- ${item}`).join('\n');
}

function coercePositiveInt(value: unknown, fallback: number, min = 1, max = 100): number {
	if (value === undefined || value === null) {
		return fallback;
	}
	if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
		throw new ToolInputError('Expected integer within allowed bounds.');
	}
	return value;
}

function coerceBoolean(value: unknown, field: string, fallback = false): boolean {
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
	throw new ToolInputError(`Invalid boolean argument: ${field}.`);
}

function sanitizeYamlValue(value: unknown): string {
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

function buildYamlFrontMatter(frontmatter: Record<string, unknown>): string {
	const entries = Object.entries(frontmatter)
		.filter(([, value]) => value !== undefined)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => `${key}: ${sanitizeYamlValue(value)}`);
	const body = entries.length === 0 ? '' : `${entries.join('\n')}`;
	return `---\n${body}\n---`;
}

function buildMarkdownNote(frontmatter: Record<string, unknown>, body: string): string {
	const front = buildYamlFrontMatter(frontmatter);
	return `${front}\n\n${body.trim()}\n`;
}

function scanSensitiveText(value: string): SensitiveTextScan {
	const patterns: Array<{ pattern: RegExp; reason: string }> = [
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

function assertNoSensitiveText(values: Array<{ label: string; value: string }>): void {
	for (const item of values) {
		if (!item.value) {
			continue;
		}
		const scan = scanSensitiveText(item.value);
		if (!scan.ok) {
			throw new ToolInputError(`Refusing to write potential secret in ${item.label}: ${scan.reason}.`);
		}
	}
}

function toText(value: unknown): string {
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

function readFrontmatterString(frontmatter: Record<string, unknown>, keys: string[]): string {
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

function isLikelyVaultPath(value: string, sourceKind: string): boolean {
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

function isSourceRequestPending(status: string): boolean {
	const normalized = status.toLowerCase();
	return ['pending', 'todo', 'open', 'queued', 'new'].includes(normalized);
}

function isUrlSource(source: string): boolean {
	return /^https?:\/\//i.test(source.trim());
}

function safeReadNote(vaultRoot: string, notePath: string, context: ToolContext): { path: string; text: string } {
	const options = pathSafetyOptions(context);
	const normalized = normalizeNotePath(notePath, options);
	const absolute = resolveSafeNotePath(vaultRoot, normalized, options);
	return {
		path: relativeFromAbsolute(vaultRoot, absolute),
		text: fs.readFileSync(absolute, 'utf8'),
	};
}

function safeReadTextFile(vaultRoot: string, notePath: string, context: ToolContext): string {
	const options = pathSafetyOptions(context);
	const normalized = normalizeNotePath(notePath, options);
	const absolute = resolveSafeNotePath(vaultRoot, normalized, options);
	assertNoSymlinkSegments(vaultRoot, absolute);
	return fs.readFileSync(absolute, 'utf8');
}

function assertSourceRequestPath(relativePath: string): void {
	if (!relativePath.startsWith(`${SOURCE_REQUESTS_DIR}/`)) {
		throw new ToolInputError(`Source request path must be under ${SOURCE_REQUESTS_DIR}.`);
	}
}

function readSourceRequest(vaultRoot: string, requestPath: string, context: ToolContext): SourceRequestRecord {
	const data = safeReadNote(vaultRoot, requestPath, context);
	assertSourceRequestPath(data.path);
	const parsed: ParsedMarkdown = parseMarkdown(data.text);
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

function stripYamlQuotes(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function assertReviewQueuePath(relativePath: string): void {
	if (!relativePath.startsWith(`${REVIEW_QUEUE_PREFIX}/`)) {
		throw new ToolInputError(`Memory proposal path must be under ${REVIEW_QUEUE_PREFIX}.`);
	}
}

function readProposalApprovalStatus(frontmatter: Record<string, unknown>): string {
	return stripYamlQuotes(
		readFrontmatterString(frontmatter, ['approval_status', 'approvalStatus', 'status']) || 'pending'
	)
		.toLowerCase()
		.replace(/\s+/g, '_');
}

function isMemoryProposalFrontmatter(frontmatter: Record<string, unknown>): boolean {
	const type = stripYamlQuotes(readFrontmatterString(frontmatter, ['type'])).toLowerCase();
	if (!type) {
		return Boolean(readFrontmatterString(frontmatter, ['proposal_kind', 'proposalKind']));
	}
	return type.includes('memory-proposal') || type.includes('memory_proposal');
}

function readMemoryProposal(vaultRoot: string, proposalPath: string, context: ToolContext): MemoryProposalDocument {
	const options = pathSafetyOptions(context);
	const normalized = normalizeNotePath(proposalPath, options);
	const absolutePath = resolveSafeNotePath(vaultRoot, normalized, options);
	const relative = relativeFromAbsolute(vaultRoot, absolutePath);
	assertReviewQueuePath(relative);

	const text = fs.readFileSync(absolutePath, 'utf8');
	const parsed: ParsedMarkdown = parseMarkdown(text);
	const frontmatter = parsed.frontmatter.fields;
	if (!isMemoryProposalFrontmatter(frontmatter)) {
		throw new ToolInputError(`Review Queue note is not a memory proposal: ${relative}`);
	}

	return {
		absolutePath,
		path: relative,
		proposalId:
			stripYamlQuotes(readFrontmatterString(frontmatter, ['proposal_id', 'proposalId'])) ||
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

function findMemoryProposalPathById(vaultRoot: string, proposalId: string, context: ToolContext): string {
	const normalizedId = stripYamlQuotes(proposalId);
	if (!normalizedId) {
		throw new ToolInputError('proposal_id is required.');
	}

	const scan = scanVaultForContext(vaultRoot, context);
	const match = scan.notes.find((note) => {
		if (!note.relativePath.startsWith(`${REVIEW_QUEUE_PREFIX}/`)) {
			return false;
		}
		const noteProposalId =
			stripYamlQuotes(readFrontmatterString(note.frontmatter, ['proposal_id', 'proposalId'])) ||
			path.basename(note.relativePath, path.extname(note.relativePath));
		return noteProposalId === normalizedId || note.relativePath === normalizedId;
	});

	if (!match) {
		throw new ToolInputError(`Approved writeback proposal not found: ${normalizedId}`);
	}
	return match.relativePath;
}

function resolveMemoryProposalFromArgs(
	vaultRoot: string,
	rawArgs: ApplyApprovedWritebackArgs,
	context: ToolContext
): MemoryProposalDocument {
	const explicitPath = coerceOptionalString(rawArgs.proposal_path) || coerceOptionalString(rawArgs.path);
	if (explicitPath) {
		return readMemoryProposal(vaultRoot, explicitPath, context);
	}

	const proposalId = coerceOptionalString(rawArgs.proposal_id);
	if (!proposalId) {
		throw new ToolInputError('proposal_id or proposal_path is required.');
	}
	return readMemoryProposal(vaultRoot, findMemoryProposalPathById(vaultRoot, proposalId, context), context);
}

function extractMarkdownSection(body: string, allowedHeadings: string[]): string {
	const allowed = new Set(allowedHeadings.map((heading) => heading.toLowerCase()));
	const lines = body.replace(/\r\n/g, '\n').split('\n');
	const collected: string[] = [];
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

function buildWritebackPlan(proposal: MemoryProposalDocument): WritebackPlan {
	const frontmatterWriteback = stripYamlQuotes(
		readFrontmatterString(proposal.frontmatter, ['writeback_content', 'writebackContent'])
	);
	const writebackContent =
		frontmatterWriteback ||
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

function formatFrontmatterUpdateValue(value: string): string {
	if (/^[A-Za-z0-9._/-]+$/.test(value)) {
		return value;
	}
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function updateFrontmatterFields(content: string, fields: Record<string, string>): string {
	const normalized = content.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const renderedFields = Object.entries(fields).map(
		([key, value]) => `${key}: ${formatFrontmatterUpdateValue(value)}`
	);

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

function assertAllowedWritebackTarget(relativePath: string): void {
	const forbiddenPrefixes = [
		'00_control/',
		'01_inbox/',
		'03_sources/',
		'06_outputs/',
	];
	for (const prefix of forbiddenPrefixes) {
		if (relativePath.startsWith(prefix)) {
			throw new ToolInputError(`Approved writeback target is protected from direct apply: ${relativePath}`);
		}
	}
}

function extractSelectionText(sourceBody: string): string {
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
	const contentLines: string[] = [];
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

function resolveRequestStatusPath(vaultRoot: string, requestPath: string, context: ToolContext): string {
	const options = pathSafetyOptions(context);
	const normalized = normalizeNotePath(requestPath, options);
	const absolute = resolveSafeNotePath(vaultRoot, normalized, options);
	const relative = relativeFromAbsolute(vaultRoot, absolute);
	assertSourceRequestPath(relative);
	assertNoSymlinkSegments(vaultRoot, absolute);
	return absolute;
}

function updateRequestStatus(vaultRoot: string, requestPath: string, nextStatus: string, context: ToolContext): { path: string } {
	const absolutePath = resolveRequestStatusPath(vaultRoot, requestPath, context);
	let text = fs.readFileSync(absolutePath, 'utf8');
	const fmMatch = text.match(/^---\n[\s\S]*?\n---\n?/);
	if (!fmMatch) {
		throw new ToolInputError(`Request note does not have frontmatter: ${requestPath}`);
	}

	const fmBlock = fmMatch[0];
	const fmStart = fmBlock.length;
	const body = text.slice(fmStart);
	const hasStatus = /^status:\s*/m.test(fmBlock);

	let updatedFrontmatter = fmBlock;
	if (hasStatus) {
		updatedFrontmatter = fmBlock.replace(/^status:\s*.*$/m, `status: ${nextStatus}`);
	} else {
		updatedFrontmatter = fmBlock.replace(/\n---\n?$/, `\nstatus: ${nextStatus}\n---\n`);
	}

	text = `${updatedFrontmatter}${body}`;
	fs.writeFileSync(absolutePath, text, 'utf8');

	return {
		path: relativeFromAbsolute(vaultRoot, absolutePath),
	};
}

function parseOptionalIntendedSourcePath(rawSource: string, sourceKind: string): { requestedPath?: string; inferredText?: string } {
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

function buildProjectCounts(scan: ScannedNote[]) {
	const typeCount: Record<string, number> = {};
	for (const note of scan) {
		const type = note.type ?? 'note';
		typeCount[type] = (typeCount[type] ?? 0) + 1;
	}
	return Object.entries(typeCount)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([type, count]) => ({ type, count }));
}

function buildRecentSessions(notes: ScannedNote[]) {
	return notes
		.filter((note) => note.relativePath.startsWith('02_timeline/sessions/'))
		.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
		.slice(0, 5)
		.map((note) => ({
			path: note.relativePath,
			title: note.title,
			modifiedAt: note.modifiedAt,
		}));
}

function buildUserPreferences(scan: ScanResult) {
	type PreferenceScalar = string | number | boolean | bigint;

	const isPreferenceScalar = (value: unknown): value is PreferenceScalar => {
		if (typeof value === 'string') {
			return value.trim() !== '';
		}
		return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint';
	};

	const isPreferenceKey = (key: string): boolean =>
		key.includes('pref') || key.includes('preference') || key.includes('goal') || key.includes('style');

	const formatPreferenceValue = (value: PreferenceScalar): string => {
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

	const preferenceNote =
		scan.notes.find((note) => note.relativePath === '01_ai_core/longterm_context.md' || note.relativePath === '01_ai_core/active_context.md');

	if (!preferenceNote) {
		return { source: null, keys: [] };
	}

	const keys = Object.entries(preferenceNote.frontmatter)
		.filter((entry): entry is [string, PreferenceScalar] => isPreferenceScalar(entry[1]))
		.filter(([key]) => isPreferenceKey(key))
		.map(([key, value]) => `${key}: ${formatPreferenceValue(value)}`);

	return {
		source: preferenceNote.relativePath,
		keys,
	};
}

function parseAuditSections(content: string) {
	const lines = content.split('\n');
	const sections: Array<{ heading: string; body: string[]; atLine: number }> = [];
	let currentHeading = '';
	let currentBody: string[] = [];
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

function isPendingProposal(note: ScannedNote) {
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

function coerceCaptureMode(value: unknown): CaptureSourceMode {
	const mode = coerceNonEmptyString(value, true, 'mode').toLowerCase();
	switch (mode) {
		case 'external_reference':
		case 'extracted_snapshot':
		case 'local_copy':
			return mode;
		default:
			throw new ToolInputError('capture_source mode must be one of: external_reference | extracted_snapshot | local_copy');
	}
}

function buildSafeFilename(rawFilename: unknown, fallbackPrefix: string, context: ToolContext): string {
	const candidate = coerceOptionalString(rawFilename);
	if (candidate) {
		return normalizeNotePath(candidate, pathSafetyOptions(context));
	}
	const now = new Date().toISOString().replace(/[:.]/g, '-');
	const token = crypto.randomUUID().slice(0, 8);
	return `${fallbackPrefix}_${now}_${token}`;
}

function toErrorMessage(error: unknown): string {
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
			} catch {
				// Intentionally fall through to generic message.
			}
			return 'Unknown error.';
		})();
}

function buildAndWriteNote(
	vaultRoot: string,
	toolName: string,
	allowedDir: string,
	filename: string,
	frontmatter: Record<string, unknown>,
	body: string,
	taskId: string | null,
	context: ToolContext,
	metadata: Record<string, unknown> = {}
): { path: string; audit_path: string; status: string; warnings: string[] } {
	const options = pathSafetyOptions(context);
	const safeLeaf = normalizeNotePath(filename, options);
	const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
	const targetPath = `${allowedDir}/${normalized}`;
	const resolved = resolveSafeWritableNotePath(vaultRoot, targetPath, allowedDir, options);
	fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });
	if (fs.existsSync(resolved.absolutePath)) {
		throw new ToolInputError(`Target already exists: ${resolved.relativePath}`);
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

function buildTaskNotePath(taskId: string): string {
	const safeId = taskId
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 120);
	if (!safeId) {
		throw new ToolInputError('task_id must contain at least one safe filename character.');
	}
	return `${AGENT_TASK_DIR}/${safeId}.md`;
}

function readFrontmatterStringList(frontmatter: Record<string, unknown>, key: string): string[] {
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

function mergeFrontmatterList(frontmatter: Record<string, unknown>, key: string, values: string[]): string {
	const merged = new Set(readFrontmatterStringList(frontmatter, key));
	for (const value of values) {
		const trimmed = value.trim();
		if (trimmed) {
			merged.add(trimmed);
		}
	}
	return Array.from(merged).join(', ');
}

function updateAgentTaskRecord(
	vaultRoot: string,
	taskId: string | null,
	fields: Record<string, string>,
	context: ToolContext,
	references: Record<string, string[]> = {},
	appendBody = ''
): string | null {
	if (!taskId) {
		return null;
	}

	let absolute = '';
	try {
		absolute = resolveSafeNotePath(vaultRoot, buildTaskNotePath(taskId), pathSafetyOptions(context));
	} catch (error) {
		if (error instanceof ToolInputError || error instanceof VaultPathError) {
			return null;
		}
		throw error;
	}

	const current = fs.readFileSync(absolute, 'utf8');
	const frontmatter = parseMarkdown(current).frontmatter.fields;
	const nextFields: Record<string, string> = { ...fields };
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
	return relativeFromAbsolute(vaultRoot, absolute);
}

function createAgentTaskRecord(
	vaultRoot: string,
	input: {
		taskId: string;
		goal: string;
		client: string;
		projectHint: string;
		context: ToolInvocationContext;
		contextPack: ContextPack;
	}
): { path: string; audit_path: string; status: string; warnings: string[] } {
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

	return buildAndWriteNote(
		vaultRoot,
		'tracekeeper.start_task',
		AGENT_TASK_DIR,
		buildTaskNotePath(input.taskId).slice(`${AGENT_TASK_DIR}/`.length),
		{
			tool: 'tracekeeper.start_task',
			type: 'agent-task',
			title: `Task ${input.taskId}`,
			task_id: input.taskId,
			status: 'active',
			agent: input.context.agentId || clientName || 'unknown',
			client: clientName || null,
			session_id: input.context.sessionId || null,
			objective: input.goal,
			related_project: input.projectHint || null,
			started_at: now,
		},
		body,
		input.taskId,
		input.context,
		{
			target_type: 'agent_task',
			task_stage: 'start',
		}
	);
}

function ensureAuditLog(vaultRoot: string): { absolute: string; relative: string } {
	const safeAuditPath = normalizeNotePath(AUDIT_LOG_PATH);
	const absolute = path.resolve(vaultRoot, safeAuditPath);
	const relative = path.relative(vaultRoot, absolute).replace(/\\/g, '/');
	if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new ToolInputError('Audit log path must be inside vault.');
	}
	assertNoSymlinkSegments(vaultRoot, absolute);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	if (!fs.existsSync(absolute)) {
		fs.writeFileSync(absolute, '# Audit Log\n\n');
	}
	return { absolute, relative };
}

function appendAuditEvent(vaultRoot: string, input: AuditEventInput): AuditEventOutput {
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
	} else {
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

function normalizeAuditTargets(paths: string[]): string[] {
	const result: string[] = [];
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

function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function looksLikeSensitiveValue(value: string): boolean {
	return !scanSensitiveText(value).ok;
}

function summarizeForAudit(args: Record<string, unknown>, limit = MAX_ARGS_SUMMARY_LENGTH): string {
	const summary: Record<string, unknown> = {};

	function summarize(value: unknown, keyHint = '', depth = 0): unknown {
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
		if (isRecord(value)) {
			const nested: Record<string, unknown> = {};
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
		} catch {
			return '[unserializable]';
		}
	}

	for (const [key, value] of Object.entries(args)) {
		summary[key] = summarize(value, key, 0);
	}

	const text = JSON.stringify(summary);
	return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

function collectAuditTargetsFromArgs(toolName: string, args: Record<string, unknown>): string[] {
	const targets = new Set<string>();
	const explicitPathKeys = ['path', 'request_path', 'proposal_path', 'target_note', 'source', 'source_path'];
	for (const key of explicitPathKeys) {
		addTrimmedTarget(targets, getRecordValue(args, key));
	}
	return Array.from(targets).filter(Boolean);
}

function collectAuditTargetsFromResult(toolName: string, args: Record<string, unknown>, resultPayload: unknown): string[] {
	const targets = new Set<string>(collectAuditTargetsFromArgs(toolName, args));
	const payload: ToolResultPayload | null = isRecord(resultPayload) ? resultPayload : null;
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
		if (isRecord(sourceNote)) {
			addTrimmedTarget(targets, getRecordValue(sourceNote, 'path'));
		}
		const report = getRecordValue(payload, 'report');
		if (isRecord(report)) {
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
				if (isRecord(proposal)) {
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

function toSourceRequestRow(note: ScannedNote) {
	return {
		noteType: readFrontmatterString(note.frontmatter, ['type']),
		source: readFrontmatterString(note.frontmatter, ['source']) || '',
		sourceKind:
			readFrontmatterString(note.frontmatter, ['source_kind', 'sourceKind', 'sourcekind', 'source-kind']) || '',
		purpose: readFrontmatterString(note.frontmatter, ['purpose']) || '',
		relatedProject:
			readFrontmatterString(note.frontmatter, ['related_project', 'relatedProject']) || '',
		analysisMode:
			readFrontmatterString(note.frontmatter, ['analysis_mode', 'analysisMode']) || 'default',
		status: readFrontmatterString(note.frontmatter, ['status']) || 'pending',
	};
}

function assertUnreachable(value: never): never {
	throw new ToolInputError(`Unhandled tool case: ${String(value)}`);
}

function getToolRiskLevel(toolName: string): string {
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

function resolveAuditVaultRoot(args: Record<string, unknown>, context: ToolInvocationContext): string | null {
	const explicit = coerceOptionalString(args.vaultRoot);
	if (explicit) {
		try {
			return toSafeVaultRoot(explicit);
		} catch {
			return null;
		}
	}
	if (typeof context.defaultVaultRoot === 'string' && context.defaultVaultRoot.trim()) {
		return context.defaultVaultRoot;
	}
	return null;
}

function isToolResultFailure(result: McpStructuredToolResult): boolean {
	if (result.isError) {
		return true;
	}
	const payload = result.structuredContent;
	if (isRecord(payload) && typeof payload.isError === 'boolean') {
		return payload.isError;
	}
	if (isRecord(payload) && typeof payload.ok === 'boolean') {
		return payload.ok === false;
	}
	return false;
}

export function appendConnectionAuditEvent(vaultRoot: string, input: ConnectionAuditEventInput): { path: string } {
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

export function recordToolCallAuditEvent(vaultRoot: string, input: ToolCallAuditEventInput): { path: string } {
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

function makeToolResultForWrite(tool: string, payload: ReturnType<typeof buildAndWriteNote>) {
	return {
		ok: true,
		tool,
		status: payload.status,
		path: payload.path,
		audit_path: payload.audit_path,
		warnings: payload.warnings,
	};
}

function buildFixPlanSummary(issues: Array<{ kind: string; severity: string }>): string[] {
	const issueKinds = issues.map((issue) => issue.kind);
	const summary: string[] = [];

	const errorCount = issues.filter((issue) => issue.severity === 'error').length;
	const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
	summary.push(`${errorCount} error(s), ${warningCount} warning(s)`);

	if (issueKinds.includes('broken_wikilink')) {
		summary.push('Fix broken wikilinks by creating target notes, correcting link targets, or replacing with plain text.');
	}
	if (issueKinds.includes('claim_missing_source')) {
		summary.push('Add source:: references under [!claim] blocks that currently have no source refs.');
	}
	if (issueKinds.some((kind) => kind.startsWith('graph_'))) {
		summary.push('Review graph profile findings by adding explicit entry, hub, or wikilink structure; Tracekeeper does not auto-fix graph structure.');
	}

	if (summary.length === 1) {
		summary.push('No fix plan generated because no lint issues were found.');
	}

	return summary;
}

export function toolDefinitions(): McpToolDefinition[] {
	return [
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
			description: '[read-only] Scan vault and return matching notes for a recall query.',
			inputSchema: {
				type: 'object',
				properties: {
					vaultRoot: {
						type: 'string',
						description: 'Vault root path. If omitted, uses server configured --vault-root.',
					},
					query: {
						type: 'string',
						description: 'Recall query text.',
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
			name: 'tracekeeper.list_review_queue',
			title: 'tracekeeper.list_review_queue',
			description: '[read-only] Read pending memory proposal notes under 01_inbox/review_queue.',
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
			description: '[read-only] Read pending source-analysis agent requests under 01_inbox/agent_requests.',
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
			description: '[read-only] Read parsed sections from 00_control/audit_log.md.',
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
			name: 'tracekeeper.analyze_source_request',
			title: 'tracekeeper.analyze_source_request',
			description:
				'[low-risk write] Analyze one pending source request and write source note, report, review proposals, request status, and audit entry.',
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
			description:
				'[review-gated apply] Apply an approved Review Queue proposal by appending explicit writeback content to its target note.',
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
			description:
				'[read-only | optional write] Build context pack from vault and optionally write a markdown artifact.',
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
			description: '[low-risk write] Create a task session summary note under 02_timeline/sessions.',
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
					next_actions: {
						oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
						description: 'Optional next actions.',
					},
					client: {
						type: 'string',
						description: 'Optional client context.',
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
			description: '[low-risk write] Create a new context-pack note under 06_outputs/context_packs.',
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
			description: '[low-risk write] Create a new session note under 02_timeline/sessions.',
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
			description: '[low-risk write] Capture source metadata/content under 03_sources with mode control.',
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
			description: '[low-risk write] Create a memory proposal note under 01_inbox/review_queue.',
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
}

export function toolPrompts(): McpPrompt[] {
	return [
		{ name: 'Tracekeeper Start Task', title: 'Tracekeeper Start Task', description: 'Start a task with a read-only context summary.' },
		{ name: 'Tracekeeper Recall Memory', title: 'Tracekeeper Recall Memory', description: 'Generate matching notes for fast recall.' },
	];
}

export function callTool(
	name: string,
	rawParams: unknown,
	context: ToolInvocationContext = {}
): McpStructuredToolResult {
	if (!isRecord(rawParams)) {
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
	let toolResult: McpStructuredToolResult = toolError(`Unknown tool: ${requestName}`);
	let status: 'success' | 'failed' = 'failed';
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
	} catch (error) {
		if (error instanceof ToolInputError || error instanceof VaultPathError) {
			toolResult = toolError(error.message);
		} else if (error instanceof Error) {
			toolResult = toolError(error.message);
		} else {
			toolResult = toolError(toErrorMessage(error));
		}
		status = 'failed';
	} finally {
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
			} catch {
				// Tool-call audit writes are best effort.
			}
		}
	}

	return toolResult;
}

function toolResultWithError<T>(value: T): McpStructuredToolResult {
	return toolResult(value);
}

function handleStatus(rawArgs: StatusArgs, context: ToolContext) {
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

function handleGraphHealth(rawArgs: GraphHealthArgs, context: ToolContext) {
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
	const graphHealth = analyzeGraphHealth(scan.notes, {
		maxItems,
	});
	const profileEvaluation = evaluateGraphProfile(graphHealth, profile);

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

function handleStartTask(rawArgs: StartTaskArgs, context: ToolInvocationContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const goal = coerceNonEmptyString(rawArgs.goal, true, 'goal');
	const client = coerceNonEmptyString(rawArgs.client);
	const projectHint = coerceNonEmptyString(rawArgs.project_hint);
	if (goal.length < 3) {
		throw new ToolInputError('goal must have at least 3 characters.');
	}

	const scan = scanVaultForContext(vaultRoot, context);
	const contextPack = buildContextPackForContext(vaultRoot, goal, context, { limit: 8 });
	const taskId = `obs_task_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
	const relatedProjects = scan.notes
		.filter((note) => note.relativePath.startsWith('05_projects/'))
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

function handleRecall(rawArgs: RecallArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const query = coerceNonEmptyString(rawArgs.query, true, 'query');
	const maxItems = coercePositiveInt(rawArgs.max_items, 6, 1, 20);
	const scan = scanVaultForContext(vaultRoot, context);
	const matches = recallNotes(scan.notes, query, { limit: maxItems });

	return {
		ok: true,
		query,
		vault_root: vaultRoot,
		max_items: maxItems,
		matched_count: matches.length,
		matches: matches.map((match) => ({
			path: match.note.relativePath,
			title: match.note.title,
			type: match.note.type,
			score: match.score,
			matched_tokens: match.matchedTokens,
		})),
	};
}

function handleReadNote(rawArgs: ReadNoteArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const notePath = coerceNonEmptyString(rawArgs.path, true, 'path');
	const data = safeReadNote(vaultRoot, notePath, context);
	const parsed = parseMarkdown(data.text);

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

function handleListSourceRequests(rawArgs: ListSourceRequestsArgs, context: ToolContext) {
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

function buildSourceRunToken(request: SourceRequestRecord): string {
	const safeRequest = request.filename
		.replace(/\.[^/.]+$/, '')
		.replace(/[^a-z0-9._-]+/gi, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	return `${safeRequest}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function resolveSourceInput(
	request: SourceRequestRecord,
	vaultRoot: string,
	context: ToolContext
): { sourceText: string; mode: 'external_reference' | 'local_copy' | 'extracted_snapshot'; resolvedSourcePath?: string; warnings: string[] } {
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
			sourceText:
				`External reference pending human/agent fetch. ` +
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
		} catch (error) {
			if (error instanceof ToolInputError || error instanceof VaultPathError) {
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

function buildSourceNoteContent(
	request: SourceRequestRecord,
	mode: 'external_reference' | 'local_copy' | 'extracted_snapshot',
	sourceText: string,
	analysis: SourceAnalysisResult,
	resolvedSourcePath?: string,
): string {
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

function buildReportContent(
	request: SourceRequestRecord,
	mode: 'external_reference' | 'local_copy' | 'extracted_snapshot',
	sourceText: string,
	analysis: SourceAnalysisResult,
	sourceNotePath: string,
	warnings: string[],
): string {
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

function handleAnalyzeSourceRequest(rawArgs: AnalyzeSourceRequestArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const requestPath = coerceOptionalString(rawArgs.request_path) || coerceOptionalString(rawArgs.path);
	if (!requestPath) {
		throw new ToolInputError('Missing required argument: request_path or path.');
	}
	const requestPathAlias = requestPath;
	const updateStatus = coerceBoolean(rawArgs.update_request_status, 'update_request_status', true);
	const forceReprocess = coerceBoolean(rawArgs.force_reprocess, 'force_reprocess', false);
	const now = new Date().toISOString();

	try {
		const request = readSourceRequest(vaultRoot, requestPathAlias, context);
		const taskId = coerceOptionalString(rawArgs.task_id) || request.taskId || null;
		if (!request.type.toLowerCase().includes('agent-request')) {
			throw new ToolInputError('Request note is not an agent-request note.');
		}
		if (!forceReprocess && request.status && !isSourceRequestPending(request.status)) {
			throw new ToolInputError(`Request status is ${request.status}; use force_reprocess=true to process anyway.`);
		}

		const { sourceText, mode, resolvedSourcePath, warnings } = resolveSourceInput(request, vaultRoot, context);
		const analysis = analyzeSourceText({
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
		const sourceNote = buildAndWriteNote(
			vaultRoot,
			'tracekeeper.analyze_source_request',
			SOURCES_DIR,
			sourceFilename,
			{
				tool: 'tracekeeper.analyze_source_request',
				type: 'source_analysis_source',
				title: `source_analysis_source_${runToken}`,
				source: request.source,
				source_kind: request.sourceKind || null,
				analysis_mode: request.analysisMode || 'default',
				request_path: request.path,
				mode,
				created_at: now,
				task_id: taskId,
			},
			buildSourceNoteContent(request, mode, sourceText, analysis, resolvedSourcePath),
			taskId,
			context,
			{ target_type: 'source', mode, request_path: request.path }
		);

		const reportFilename = buildSafeFilename(`${runToken}-report`, 'source-report', context);
		const report = buildAndWriteNote(
			vaultRoot,
			'tracekeeper.analyze_source_request',
			SOURCE_ANALYSIS_REPORT_DIR,
			reportFilename,
			{
				tool: 'tracekeeper.analyze_source_request',
				type: 'source_analysis_report',
				title: `source_analysis_report_${runToken}`,
				source: request.source,
				source_kind: request.sourceKind || null,
				analysis_mode: request.analysisMode || 'default',
				request_path: request.path,
				source_note: sourceNote.path,
				created_at: now,
				task_id: taskId,
			},
			buildReportContent(request, mode, sourceText, analysis, sourceNote.path, warnings),
			taskId,
			context,
			{ target_type: 'source_analysis_report', request_path: request.path }
		);

	const proposalPaths = analysis.proposalDrafts.map((entry: SourceProposalDraft) => {
		const proposalNote = buildAndWriteNote(
				vaultRoot,
				'tracekeeper.analyze_source_request',
				MEMORY_PROPOSAL_DIR,
				buildSafeFilename(`proposal-${runToken}-${entry.proposalKind}`, entry.proposalKind, context),
				{
					tool: 'tracekeeper.analyze_source_request',
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
				},
				`## Source analysis proposal\n\n- evidence: ${entry.evidence}\n\n${entry.content}\n`,
				taskId,
				context,
				{
					target_type: 'memory_proposal',
					proposal_kind: entry.proposalKind,
					request_path: request.path,
					source_note: sourceNote.path,
				}
			);
			return proposalNote.path;
		});
		let auditPathForReturn = sourceNote.audit_path;

		if (updateStatus) {
			updateRequestStatus(vaultRoot, request.path, 'completed', context);
			auditPathForReturn = appendAuditEvent(vaultRoot, {
				tool: 'tracekeeper.analyze_source_request',
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
			tool: 'tracekeeper.analyze_source_request',
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
			proposals: proposalPaths.map((proposalPath: string) => ({ path: proposalPath })),
			audit_path: auditPathForReturn,
			summary: analysis.summary,
			warnings,
		};
	} catch (error) {
		if (updateStatus) {
			try {
				updateRequestStatus(vaultRoot, requestPathAlias, 'failed', context);
				appendAuditEvent(vaultRoot, {
					tool: 'tracekeeper.analyze_source_request',
					targetPath: requestPathAlias,
					status: 'failed',
					taskId: coerceOptionalString(rawArgs.task_id) || null,
					metadata: {
						action: 'source.request.failed',
						error: toErrorMessage(error),
					},
				});
			} catch {
				// audit and state update are best-effort; keep original error handling path.
			}
		}
		throw error;
	}
}

function handleReviewQueue(rawArgs: ListReviewQueueArgs, context: ToolContext) {
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

function handleListApprovedWritebacks(rawArgs: ListApprovedWritebacksArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const rawLimit = rawArgs.max_items ?? rawArgs.limit;
	const maxItems = coercePositiveInt(rawLimit, MAX_APPROVED_WRITEBACKS, 1, MAX_APPROVED_WRITEBACKS);
	const scope = coerceOptionalString(rawArgs.scope);
	const scan = scanVaultForContext(vaultRoot, context);
	const candidates: ReturnType<typeof buildWritebackPlan>[] = [];

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

function handleApplyApprovedWriteback(rawArgs: ApplyApprovedWritebackArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const dryRun = coerceBoolean(rawArgs.dry_run, 'dry_run', false);
	const proposal = resolveMemoryProposalFromArgs(vaultRoot, rawArgs, context);
	const taskId = coerceOptionalString(rawArgs.task_id) || proposal.taskId || null;
	const plan = buildWritebackPlan(proposal);
	const now = new Date().toISOString();

	if (!plan.ready) {
		throw new ToolInputError(plan.reason || 'approved writeback is not ready to apply.');
	}
	assertNoSensitiveText([
		{ label: 'proposal id', value: proposal.proposalId },
		{ label: 'target note', value: plan.targetNote },
		{ label: 'writeback content', value: plan.writebackContent },
	]);

	const targetAbsolute = resolveSafeNotePath(vaultRoot, plan.targetNote, pathSafetyOptions(context));
	const targetRelative = relativeFromAbsolute(vaultRoot, targetAbsolute);
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

function handleAuditRecent(rawArgs: AuditRecentArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const maxItems = coercePositiveInt(rawArgs.max_items, MAX_AUDIT_ITEMS, 1, 100);
	let auditPath: string | null = null;
	let text = '';

	try {
		auditPath = resolveSafeNotePath(vaultRoot, AUDIT_LOG_PATH, pathSafetyOptions(context));
		text = fs.readFileSync(auditPath, 'utf8');
	} catch (error) {
		if (!(error instanceof ToolInputError || error instanceof VaultPathError)) {
			throw error;
		}
	}

	const sections = text ? parseAuditSections(text) : [];
	const rel = auditPath ? relativeFromAbsolute(vaultRoot, auditPath) : AUDIT_LOG_PATH;

	return {
		ok: true,
		read_only: true,
		vault_root: vaultRoot,
		audit_log: rel,
		total_sections: sections.length,
		sections: sections.slice(0, maxItems),
	};
}

function handleWriteContextPack(rawArgs: WriteContextPackArgs, context: ToolContext) {
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

	const note = buildAndWriteNote(
		vaultRoot,
		'tracekeeper.write_context_pack',
		CONTEXT_PACK_DIR,
		filename,
		{
			tool: 'tracekeeper.write_context_pack',
			type: 'context_pack',
			title: title || `context_pack_${now}`,
			created_at: now,
			task_id: taskId || null,
		},
		content,
		taskId,
		context,
		{ target_type: 'context_pack', tool: 'tracekeeper.write_context_pack' }
	);
	updateAgentTaskRecord(vaultRoot, taskId, {
		context_pack: note.path,
	}, context, {
		context_packs: [note.path],
	});

	return makeToolResultForWrite('tracekeeper.write_context_pack', note);
}

function handleWriteSessionNote(rawArgs: WriteSessionNoteArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const content = coerceNonEmptyString(rawArgs.content, true, 'content');
	const filename = buildSafeFilename(rawArgs.filename, 'session', context);
	const taskId = coerceOptionalString(rawArgs.task_id) || null;
	const now = new Date().toISOString();
	assertNoSensitiveText([
		{ label: 'content', value: content },
	]);

	const note = buildAndWriteNote(
		vaultRoot,
		'tracekeeper.write_session_note',
		SESSION_NOTE_DIR,
		filename,
		{
			tool: 'tracekeeper.write_session_note',
			type: 'session_note',
			created_at: now,
			task_id: taskId || null,
		},
		content,
		taskId,
		context,
		{ target_type: 'session_note', tool: 'tracekeeper.write_session_note' }
	);
	updateAgentTaskRecord(vaultRoot, taskId, {}, context, {
		memory_writes: [note.path],
	});

	return makeToolResultForWrite('tracekeeper.write_session_note', note);
}

function handleCaptureSource(rawArgs: CaptureSourceArgs, context: ToolContext) {
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
	const warnings: string[] = [];

	const sourceText = coerceOptionalString(rawArgs.content) || coerceOptionalString(rawArgs.text);
	if (mode !== 'external_reference' && !sourceText) {
		throw new ToolInputError(`content/text is required when mode is "${mode}".`);
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
	} else {
		body += `- mode: ${mode}\n- source: ${source}\n`;
		if (sourceKind) {
			body += `- source_kind: ${sourceKind}\n`;
		}
		body += `\n${sourceText}\n`;
	}

	const note = buildAndWriteNote(
		vaultRoot,
		'tracekeeper.capture_source',
		SOURCES_DIR,
		filename,
		{
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
		},
		body,
		taskId,
		context,
		{ target_type: 'source_capture', mode }
	);
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

function handleProposeMemory(rawArgs: ProposeMemoryArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const proposalKind = coerceNonEmptyString(rawArgs.proposal_kind, true, 'proposal_kind');
	const content = coerceNonEmptyString(rawArgs.content, true, 'content');
	const evidence = coerceOptionalString(rawArgs.evidence);
	const targetNote = coerceOptionalString(rawArgs.target_note);
	const riskLevel = coerceOptionalString(rawArgs.risk_level);
	const title = coerceOptionalString(rawArgs.title);
	const filename = buildSafeFilename(rawArgs.filename, 'proposal', context);
	const taskId = coerceOptionalString(rawArgs.task_id) || null;
	const now = new Date().toISOString();
	assertNoSensitiveText([
		{ label: 'content', value: content },
		{ label: 'evidence', value: evidence },
		{ label: 'target_note', value: targetNote },
		{ label: 'title', value: title },
	]);

	const body = [
		'## Proposal',
		`- status: pending`,
		`- proposal_kind: ${proposalKind}`,
		evidence ? `- evidence: ${evidence}` : '',
		targetNote ? `- target_note: ${targetNote}` : '',
		riskLevel ? `- risk_level: ${riskLevel}` : '',
		'',
		content,
	].filter(Boolean).join('\n');

	const note = buildAndWriteNote(
		vaultRoot,
		'tracekeeper.propose_memory',
		MEMORY_PROPOSAL_DIR,
		filename,
		{
			tool: 'tracekeeper.propose_memory',
			type: 'memory_proposal',
			title: title || `proposal_${proposalKind}_${now}`,
			proposal_kind: proposalKind,
			status: 'pending',
			target_note: targetNote || null,
			risk_level: riskLevel || null,
			created_at: now,
			task_id: taskId || null,
		},
		body,
		taskId,
		context,
		{
			target_type: 'memory_proposal',
			proposal_kind: proposalKind,
			risk_level: riskLevel || null,
		}
	);
	updateAgentTaskRecord(vaultRoot, taskId, {}, context, {
		proposals: [note.path],
	});

	return makeToolResultForWrite('tracekeeper.propose_memory', note);
}

function handleBuildContextPack(rawArgs: BuildContextPackArgs, context: ToolContext) {
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
		...contextPack.relevantNotes.map(
			(entry) =>
				`- ${entry.relativePath} | score: ${entry.score} | title: ${entry.title}`
		),
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

	const note = buildAndWriteNote(
		vaultRoot,
		'tracekeeper.build_context_pack',
		CONTEXT_PACK_DIR,
		filename,
		{
			tool: 'tracekeeper.build_context_pack',
			type: 'context_pack',
			title: title || `context_pack_${now}`,
			query,
			task_id: taskId || null,
			candidate_limit: candidateLimit,
			stale_after_days: staleAfterDays,
			created_at: now,
		},
		contextMarkdown,
		taskId || null,
		context,
		{
			target_type: 'context_pack',
			output_format: 'markdown',
		}
	);
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

function handleLint(rawArgs: LintArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const maxItems = coercePositiveInt(rawArgs.max_items, 40, 1, 2000);
	const profile = graphProfileFromArgs(rawArgs.graph_profile, context);
	const scan = scanVaultForContext(vaultRoot, context);
	const graphHealth = profile === 'off' ? undefined : analyzeGraphHealth(scan.notes, { maxItems });
	const profileEvaluation = graphHealth
		? evaluateGraphProfile(graphHealth, profile)
		: { profile, disabled: true, profile_issues: [] };
	const { issues } = lintNotes(vaultRoot, scan.notes, {
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
		fix_plan_summary: buildFixPlanSummary(issues),
	};
}

function buildSessionNoteBody(summary: string, outcomes: string[], nextActions: string[]): string {
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

function buildSessionNoteBodyWithDistill(
	summary: string,
	outcomes: string[],
	nextActions: string[],
	decisions: string[],
	possiblePreferences: string[],
): string {
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

function createDistillProposal(
	vaultRoot: string,
	taskId: string,
	proposalKind: string,
	kindLabel: string,
	contentItems: string[],
	context: ToolContext
): { path: string } {
	const body = [
		`## Distilled ${kindLabel}`,
		...contentItems.map((item) => `- ${item}`),
		'',
		`- task_id: ${taskId}`,
	].join('\n');
	const now = new Date().toISOString();
	const filenameToken = `${proposalKind}-${taskId}-${now.replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
	const proposal = buildAndWriteNote(
		vaultRoot,
		'tracekeeper.distill_session',
		MEMORY_PROPOSAL_DIR,
		buildSafeFilename(filenameToken, proposalKind, context),
		{
			tool: 'tracekeeper.distill_session',
			type: 'memory_proposal',
			title: `${kindLabel} ${taskId}`,
			proposal_kind: proposalKind,
			status: 'pending',
			risk_level: 'medium',
			created_at: now,
			task_id: taskId,
		},
		body,
		taskId,
		context,
		{
			target_type: 'memory_proposal',
			proposal_kind: proposalKind,
		}
	);
	return { path: proposal.path };
}

function handleFinishTask(rawArgs: FinishTaskArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const taskId = coerceNonEmptyString(rawArgs.task_id, true, 'task_id');
	const summary = coerceNonEmptyString(rawArgs.summary, true, 'summary');
	const outcomes = coerceStringOrStringArray(rawArgs.outcomes, 'outcomes');
	const nextActions = coerceStringOrStringArray(rawArgs.next_actions, 'next_actions');
	const client = coerceOptionalString(rawArgs.client);
	const projectHint = coerceOptionalString(rawArgs.project_hint);
	const filename = buildSafeFilename(rawArgs.filename, 'session', context);
	const now = new Date().toISOString();

	const body = buildSessionNoteBody(summary, outcomes, nextActions);
	assertNoSensitiveText([
		{ label: 'summary', value: summary },
		{ label: 'outcomes', value: outcomes.join('\n') },
		{ label: 'next_actions', value: nextActions.join('\n') },
		{ label: 'client', value: client },
		{ label: 'project_hint', value: projectHint },
	]);

	const note = buildAndWriteNote(
		vaultRoot,
		'tracekeeper.finish_task',
		SESSION_NOTE_DIR,
		filename,
		{
			tool: 'tracekeeper.finish_task',
			type: 'session_note',
			title: `Task ${taskId} finish note`,
			task_id: taskId,
			client: client || null,
			project_hint: projectHint || null,
			created_at: now,
		},
		body,
		taskId,
		context,
		{
			target_type: 'session_note',
			task_stage: 'finish',
		}
	);
	const taskPath = updateAgentTaskRecord(
		vaultRoot,
		taskId,
		{
			status: 'completed',
			finished_at: now,
			summary,
			session_note: note.path,
			outcomes: outcomes.join(', '),
			next_actions: nextActions.join(', '),
		},
		context,
		{
			memory_writes: [note.path],
		},
		[
			'## Completion Summary',
			summary,
			'',
			'## Outcomes',
			...formatListMarkdown(outcomes).split('\n'),
			'',
			'## Next Actions',
			...formatListMarkdown(nextActions).split('\n'),
		].join('\n')
	);

	return {
		ok: true,
		read_only: false,
		task_id: taskId,
		task_path: taskPath,
		path: note.path,
		audit_path: note.audit_path,
		outcome_count: outcomes.length,
		next_action_count: nextActions.length,
	};
}

function handleDistillSession(rawArgs: DistillSessionArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const taskId = coerceNonEmptyString(rawArgs.task_id, true, 'task_id');
	const summary = coerceNonEmptyString(rawArgs.summary, true, 'summary');
	const decisions = coerceStringOrStringArray(rawArgs.decisions, 'decisions');
	const nextActions = coerceStringOrStringArray(rawArgs.next_actions, 'next_actions');
	const possiblePreferences = coerceStringOrStringArray(rawArgs.possible_preferences, 'possible_preferences');
	const outcomes = coerceStringOrStringArray(rawArgs.outcomes, 'outcomes');
	const projectHint = coerceOptionalString(rawArgs.project_hint);
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
	const note = buildAndWriteNote(
		vaultRoot,
		'tracekeeper.distill_session',
		SESSION_NOTE_DIR,
		filename,
		{
			tool: 'tracekeeper.distill_session',
			type: 'session_note',
			title: `Task ${taskId} distill note`,
			task_id: taskId,
			project_hint: projectHint || null,
			created_at: now,
		},
		body,
		taskId,
		context,
		{
			target_type: 'session_note',
			task_stage: 'distill',
		}
	);

	const proposals: string[] = [];
	if (decisions.length > 0) {
		const proposal = createDistillProposal(
			vaultRoot,
			taskId,
			'distill_decisions',
			'Decisions',
			decisions,
			context
		);
		proposals.push(proposal.path);
	}
	if (possiblePreferences.length > 0) {
		const proposal = createDistillProposal(
			vaultRoot,
			taskId,
			'distill_preferences',
			'Possible Preferences',
			possiblePreferences,
			context
		);
		proposals.push(proposal.path);
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
