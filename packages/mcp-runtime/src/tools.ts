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
	type GraphHealthReport,
	type GraphProfile,
	normalizeGraphProfile,
	type SourceAnalysisResult,
	type SourceProposalDraft,
	buildContextPack,
	buildContextPackFromScan,
	TRACEKEEPER_ROOT,
	TRACEKEEPER_AUDIT_LOG_PATH,
	TRACEKEEPER_AGENT_REQUESTS_DIR,
	TRACEKEEPER_CONTEXT_PACKS_DIR,
	TRACEKEEPER_OPERATIONS_DIR,
	TRACEKEEPER_REVIEW_QUEUE_DIR,
	TRACEKEEPER_SESSIONS_DIR,
	TRACEKEEPER_SOURCE_ANALYSIS_DIR,
	TRACEKEEPER_TASKS_DIR,
	KNOWLEDGE_GLOBAL_MEMORY_DIR,
	KNOWLEDGE_PROJECTS_MEMORY_DIR,
	KNOWLEDGE_SOURCES_DIR,
	LEGACY_TOP_LEVEL_DIRS,
	isKnowledgeWikiPath,
	isKnowledgeSourcePath,
	projectMemoryPath,
	NodeFileOperationJournal,
	OperationConflictError,
	RecoverableOperationRunner,
	computePayloadHash,
	type OperationFailureInjection,
	type OperationRecord,
	lintNotes,
	parseMarkdown,
	recallNotes,
	type ScanResult,
	type ScannedNote,
	type VaultRepository,
	scanVault,
} from '@tracekeeper/core';
import {
	PUBLIC_TOOL_NAME_ORDER,
	SCHEMA_VERSION,
	getContractByName,
	toolContracts,
	type AgentAction,
	type ToolCapability,
	type ToolContract,
	type TracekeeperToolName,
} from '@tracekeeper/contracts';
import {
	isRecord,
	type McpPrompt,
	type McpStructuredToolResult,
	type McpToolDefinition,
} from './protocol';
import { validateStructuredContent } from './result-validation';
import {
	ToolInputError,
	normalizeNotePath,
	relativeFromAbsolute,
	resolveSafeNotePath,
	resolveSafeWritableNotePath,
	assertNoSymlinkSegments,
	toSafeVaultRoot,
} from './safety';
import {
	ApplyApprovedWritebackService,
	type ApplyApprovedWritebackPayload,
} from './application/apply-approved-writeback';
import {
	normalizeRepositoryPath,
	projectIdentityToResult,
	resolveProjectIdentity,
	type ResolvedProjectIdentity,
} from './application/project-identity';

const REVIEW_QUEUE_PREFIX = TRACEKEEPER_REVIEW_QUEUE_DIR;
const AUDIT_LOG_PATH = TRACEKEEPER_AUDIT_LOG_PATH;
const MAX_LIST_QUEUE_ITEMS = 20;
const MAX_AUDIT_ITEMS = 20;
const MAX_APPROVED_WRITEBACKS = 20;
const MAX_PROJECT_TOOL_ITEMS = 20;
const MAX_PROJECT_SCOPE_CANDIDATES = 8;
const CONTEXT_PACK_DIR = TRACEKEEPER_CONTEXT_PACKS_DIR;
const SESSION_NOTE_DIR = TRACEKEEPER_SESSIONS_DIR;
const AGENT_TASK_DIR = TRACEKEEPER_TASKS_DIR;
const PROJECT_MEMORY_DIRS = [KNOWLEDGE_PROJECTS_MEMORY_DIR, '05_projects', '04_projects'];
const PROJECT_MEMORY_READ_DIRS = PROJECT_MEMORY_DIRS;
const GLOBAL_MEMORY_DIRS = [KNOWLEDGE_GLOBAL_MEMORY_DIR, '04_memory', '05_memory'];
const SOURCE_REQUESTS_DIR = TRACEKEEPER_AGENT_REQUESTS_DIR;
const SOURCES_DIR = KNOWLEDGE_SOURCES_DIR;
const SOURCE_ANALYSIS_REPORT_DIR = TRACEKEEPER_SOURCE_ANALYSIS_DIR;
const MEMORY_PROPOSAL_DIR = TRACEKEEPER_REVIEW_QUEUE_DIR;
const MAX_SOURCE_EXCERPT_LENGTH = 1000;
const MAX_RECALL_EXCERPT_LENGTH = 480;
const MAX_RECALL_GRAPH_LINKS = 8;
const MAX_RECALL_RELATIONS = 8;
const MAX_RECALL_CANDIDATES = 50;
const DEFAULT_FINISH_TASK_REVIEW_MODE = 'auto_propose';
const PROJECT_MEMORY_RECALL_BOOST = 4;
const KNOWLEDGE_WIKI_RECALL_BOOST = 0.75;
const WORK_RECORD_RECALL_PENALTY = 5;
const PROJECT_MEMORY_RECALL_REASON = 'Project-memory location boost (+4)';
const KNOWLEDGE_WIKI_RECALL_REASON = 'Wiki location boost (+0.75)';

type CaptureSourceMode = 'external_reference' | 'extracted_snapshot' | 'local_copy';
type ReviewProposalMode = 'off' | 'suggest' | 'review_queue' | 'auto_propose';
type MemoryProposalRule = 'review_queue' | 'auto_write' | 'disabled';
type MemoryScope = 'global' | 'project';
type ArchitectureStatus = 'healthy' | 'needs_attention';
type SensitiveTextScan = { ok: true } | { ok: false; reason: string };
type ContentLanguage = 'zh-CN' | 'en';
type ContentLanguageSource = 'setting' | 'obsidian' | 'navigator' | 'fallback';

interface MemoryRulesContext {
	globalMemoryRule?: unknown;
	projectMemoryRule?: unknown;
	taskMemoryProposalMode?: unknown;
}

interface ToolContext {
	defaultVaultRoot?: string;
	vaultConfigDir?: string;
	vaultRepository?: VaultRepository;
	knowledgeSnapshotProvider?: (vaultRoot: string) => ScanResult | null;
	graphProfile?: unknown;
	memoryRules?: MemoryRulesContext;
	contentLanguage?: unknown;
	contentLanguageSource?: unknown;
}

export interface ToolInvocationContext extends ToolContext {
	principalId?: string;
	credentialCapabilities?: readonly string[];
	agentId?: string;
	sessionId?: string;
	clientName?: string | null;
	transport?: string;
	runtimeVersion?: string;
	operationFailureInjection?: OperationFailureInjection;
}

function normalizeContentLanguage(value: unknown): ContentLanguage {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return normalized === 'zh' || normalized.startsWith('zh-') || normalized.startsWith('zh_') ? 'zh-CN' : 'en';
}

function normalizeContentLanguageSource(value: unknown): ContentLanguageSource {
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

function contentLanguageFromContext(context: ToolContext): ContentLanguage {
	return normalizeContentLanguage(context.contentLanguage);
}

function contentLanguageSourceFromContext(context: ToolContext): ContentLanguageSource {
	return normalizeContentLanguageSource(context.contentLanguageSource);
}

function contentText(context: ToolContext, zh: string, en: string): string {
	return contentLanguageFromContext(context) === 'zh-CN' ? zh : en;
}

interface ConnectionAuditEventInput {
	principalId?: string;
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
	principalId?: string;
	sessionId?: string;
	clientName: string | null;
	transport?: string;
	runtimeVersion?: string;
	argsSummary: string;
	resultSummary: string;
	workflowMetadata?: Record<string, unknown>;
}

const TRACEKEEPER_TOOL_CONTRACTS: readonly ToolContract<TracekeeperToolName>[] = toolContracts;

const READ_ONLY_TOOL_NAMES = new Set<string>(
	TRACEKEEPER_TOOL_CONTRACTS.filter((contract) => contract.risk === 'read-only').map((contract) => contract.name)
);

const REVIEW_GATED_TOOL_NAMES = new Set<string>(
	TRACEKEEPER_TOOL_CONTRACTS.filter((contract) => contract.risk === 'review-gated-write').map((contract) => contract.name)
);

const LOW_RISK_TOOL_NAMES = new Set<string>(
	TRACEKEEPER_TOOL_CONTRACTS.filter((contract) => contract.risk === 'low-risk-write').map((contract) => contract.name)
);

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

type ToolName = TracekeeperToolName;

const TOOL_NAME_SET = new Set<string>(TRACEKEEPER_TOOL_CONTRACTS.map((contract) => contract.name));

const DEPRECATED_TOOL_REPLACEMENTS: Record<string, string> = Object.fromEntries(
	TRACEKEEPER_TOOL_CONTRACTS
		.filter((contract) => Boolean(contract.deprecated))
		.map((contract) => [contract.name, contract.deprecated?.replacement || ''])
);

const TOOL_CONTRACT_BY_NAME = new Map<string, ToolContract<TracekeeperToolName>>(
	TRACEKEEPER_TOOL_CONTRACTS.map((contract) => [contract.name, contract])
);

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

interface StartTaskArgs extends ToolArgs, ProjectScopeArgs {
	goal?: unknown;
	client?: unknown;
	idempotency_key?: unknown;
}

interface ProjectScopeArgs extends ToolArgs {
	project_hint?: unknown;
	project_id?: unknown;
	repo_path?: unknown;
	repo?: unknown;
	project_path?: unknown;
}

interface ProjectContextArgs extends ProjectScopeArgs {
	query?: unknown;
	max_items?: unknown;
}

interface ProjectHistoryArgs extends ProjectScopeArgs {
	query?: unknown;
	max_items?: unknown;
}

interface BuildContextPackArgs extends ProjectScopeArgs {
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

interface FinishTaskArgs extends ProjectScopeArgs {
	task_id?: unknown;
	summary?: unknown;
	outcomes?: unknown;
	decisions?: unknown;
	solution_changes?: unknown;
	lessons?: unknown;
	preferences?: unknown;
	memory_candidates?: unknown;
	review_proposal_mode?: unknown;
	next_actions?: unknown;
	client?: unknown;
	memory_scope?: unknown;
	related_wiki?: unknown;
	related_sources?: unknown;
	filename?: unknown;
	idempotency_key?: unknown;
}

interface RecallArgs extends ToolArgs {
	query?: unknown;
	max_items?: unknown;
	scope?: unknown;
	project_hint?: unknown;
	project_id?: unknown;
	repo_path?: unknown;
	repo?: unknown;
	project_path?: unknown;
}

interface RankedRecallMatch {
	note: ScannedNote;
	score: number;
	raw_score: number;
	matchedTokens: string[];
	score_reason: string[];
}

interface RecallRelationEvidenceItem {
	path: string;
	declared_by: string;
	declared_via: Array<'frontmatter' | 'body_wikilink'>;
	verified_by: 'active_vault_snapshot';
}

interface RecallRelationEvidence {
	related_wiki: RecallRelationEvidenceItem[];
	related_sources: RecallRelationEvidenceItem[];
}

interface ArchitectureStatusReport {
	architecture_status: ArchitectureStatus;
	missing_graph_bridges: string[];
}

interface MemoryBridgeReport {
	missing_wiki_bridge: boolean;
	related_wiki: string[];
	missing_related_wiki: string[];
	related_sources: string[];
	missing_related_sources: string[];
}

interface MemoryRoutingContext {
	memoryScope: MemoryScope;
	projectHint: string;
	relatedWiki: string[];
	relatedSources: string[];
	architecture: ArchitectureStatusReport;
	missingWikiBridge: boolean;
	missingRelatedWiki: string[];
	missingRelatedSources: string[];
}

interface FinishTaskSuggestion {
	kind: string;
	label: string;
	values: string[];
}

interface FinishTaskCloseoutGroup {
	kind: string;
	label: string;
	values: string[];
}

interface FinishTaskProposalResult {
	proposals: Array<{ kind: string; path: string }>;
	suggestedMemoryUpdates: FinishTaskSuggestion[];
	autoAppliedMemoryUpdates: Array<{ kind: string; path: string; status: string }>;
	hasMissingWikiBridge: boolean;
	hasMissingRelatedSources: boolean;
}

function buildFinishTaskCloseoutGroups(
	closeout: {
		decisions: string[];
		solution_changes: string[];
		lessons: string[];
		preferences: string[];
		next_actions: string[];
		memory_candidates: string[];
	},
	context: ToolContext
): FinishTaskCloseoutGroup[] {
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

type LegacyMemoryCloseoutStatus = 'auto_saved' | 'queued' | 'mixed' | 'empty' | 'ignored';
type MemoryCloseoutStatus =
	| 'no_candidates'
	| 'disabled'
	| 'suggested'
	| 'queued_for_review'
	| 'partially_auto_saved'
	| 'auto_saved'
	| 'requires_wiki_bridge'
	| 'conflict';

interface ReadNoteArgs extends ToolArgs {
	path?: unknown;
	recall_id?: unknown;
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
	idempotency_key?: unknown;
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
	project_hint?: unknown;
	memory_scope?: unknown;
	related_wiki?: unknown;
	related_sources?: unknown;
	idempotency_key?: unknown;
}

interface ListApprovedWritebacksArgs extends ToolArgs {
	scope?: unknown;
	max_items?: unknown;
	limit?: unknown;
}

interface ReviewQueueArgs extends ListApprovedWritebacksArgs {
	action?: unknown;
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

interface SourceRequestArgs extends ListSourceRequestsArgs, AnalyzeSourceRequestArgs {
	action?: unknown;
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
	operationId?: string;
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
	principalId?: string;
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

function truncateSummaryText(value: string, maxLength = 900): string {
	const normalized = value.replace(/\s+/g, ' ').trim();
	if (normalized.length <= maxLength) {
		return normalized;
	}
	return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function summarizeToolPayload(payload: unknown, isError: boolean): string {
	if (isError) {
		return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
	}
	if (!isRecord(payload)) {
		return truncateSummaryText(typeof payload === 'string' ? payload : 'Tracekeeper MCP tool completed.');
	}

	const summaryParts: string[] = [];
	const keys = [
		'ok',
		'read_only',
		'tool',
		'action',
		'scope_mode',
		'review_proposal_mode',
		'task_id',
		'path',
		'matched_count',
		'total_matches',
		'count',
		'issue_count',
		'proposal_count',
		'suggestion_count',
		'auto_applied_count',
	];
	for (const key of keys) {
		const value = payload[key];
		if (value === undefined || value === null || Array.isArray(value) || isRecord(value)) {
			continue;
		}
		summaryParts.push(`${key}=${String(value)}`);
	}

	const nextActions = Array.isArray(payload.next_actions_for_agent)
		? payload.next_actions_for_agent
			.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
			.slice(0, 2)
		: [];
	const base = summaryParts.length > 0 ? summaryParts.join(' | ') : 'Tracekeeper MCP tool completed.';
	return truncateSummaryText([base, ...nextActions].join('\n'));
}

function buildWorkflowAuditMetadata(
	toolName: string,
	args: Record<string, unknown>,
	payload: unknown
): Record<string, unknown> {
	if (!isRecord(payload)) {
		return {};
	}
	const workflow = isRecord(payload.workflow) ? payload.workflow : {};
	const recall = isRecord(payload.recall) ? payload.recall : {};
	const nextAction = Array.isArray(payload.next_actions) && isRecord(payload.next_actions[0])
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
		workflow_contract_version: SCHEMA_VERSION,
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

function toolResult(payload: unknown, isError = false): McpStructuredToolResult {
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

function toolError(message: string): McpStructuredToolResult {
	return toolResult({ ok: false, error: message }, true);
}

function hasCredentialCapability(context: ToolInvocationContext, capability: ToolCapability): boolean {
	const capabilities = context.credentialCapabilities;
	return Boolean(capabilities?.includes('*') || capabilities?.includes(capability));
}

function actionBaseId(payload: Record<string, unknown>, fallback: string): string {
	for (const key of ['operation_id', 'recall_id', 'task_id']) {
		const value = payload[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return fallback;
}

function buildStartTaskActions(
	payload: Record<string, unknown>,
	context: ToolInvocationContext
): AgentAction[] {
	const actions: AgentAction[] = [];
	const baseId = actionBaseId(payload, 'start-task');
	const recommendedRecall = isRecord(payload.recommended_recall) ? payload.recommended_recall : null;
	const recallArguments = recommendedRecall && isRecord(recommendedRecall.arguments)
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
	} else if (!hasCredentialCapability(context, 'vault.read')) {
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

function firstRecallMatchPath(matches: unknown[]): string {
	for (const match of matches) {
		if (!isRecord(match)) {
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

function buildRecallActions(
	payload: Record<string, unknown>,
	context: ToolInvocationContext,
	recallId: string,
	scope: RecallScope,
	matches: unknown[]
): AgentAction[] {
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
		if (
			scope === 'project' &&
			payload.uncertain !== true &&
			candidatePath &&
			hasCredentialCapability(context, 'vault.read')
		) {
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

function canonicalMemoryCloseoutStatus(payload: Record<string, unknown>): MemoryCloseoutStatus {
	const state = payload.memory_closeout_state;
	if (
		state === 'no_candidates' ||
		state === 'disabled' ||
		state === 'suggested' ||
		state === 'queued_for_review' ||
		state === 'partially_auto_saved' ||
		state === 'auto_saved' ||
		state === 'requires_wiki_bridge' ||
		state === 'conflict'
	) {
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

function buildFinishTaskActions(payload: Record<string, unknown>): AgentAction[] {
	const baseId = actionBaseId(payload, 'finish-task');
	const memoryStatus = canonicalMemoryCloseoutStatus(payload);
	if (
		memoryStatus === 'queued_for_review' ||
		memoryStatus === 'partially_auto_saved' ||
		memoryStatus === 'requires_wiki_bridge'
	) {
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

function classifyToolError(message: string): { code: string; retryable: boolean; reasonCode?: AgentAction['reason_code'] } {
	if (/lacks capability|permission denied/i.test(message)) {
		return { code: 'PERMISSION_DENIED', retryable: false, reasonCode: 'PERMISSION_DENIED' };
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

function safeToolErrorDescription(code: string): string {
	switch (code) {
		case 'PERMISSION_DENIED':
			return 'The current principal is not allowed to perform this action.';
		case 'FINISH_ALREADY_COMPLETED':
			return 'The tracked task is already closed and must not be finished again.';
		case 'IDEMPOTENCY_CONFLICT':
			return 'Idempotency key conflict: the retry key conflicts with an existing operation; preserve the original result.';
		case 'TOOL_UNAVAILABLE':
			return 'The requested Tracekeeper tool is not available in this connection.';
		default:
			return 'The Tracekeeper request was rejected; inspect the legacy error field for local diagnostics.';
	}
}

function decorateToolResult(
	toolName: ToolName,
	result: McpStructuredToolResult,
	context: ToolInvocationContext
): McpStructuredToolResult {
	const payload = isRecord(result.structuredContent) ? result.structuredContent : {};
	if (isToolResultFailure(result)) {
		const message = typeof payload.error === 'string' ? payload.error : 'Tracekeeper tool call failed.';
		const classified = classifyToolError(message);
		const safeMessage = safeToolErrorDescription(classified.code);
		const recoveryActions: AgentAction[] = classified.reasonCode
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
			schema_version: SCHEMA_VERSION,
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

	const decorated: Record<string, unknown> = {
		...payload,
		schema_version: SCHEMA_VERSION,
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
			paths: matches.map((entry) => isRecord(entry) ? entry.path ?? entry.note_path ?? '' : ''),
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
			action_required:
				memoryStatus === 'queued_for_review' ||
				memoryStatus === 'partially_auto_saved' ||
				memoryStatus === 'requires_wiki_bridge',
		};
		decorated.next_actions = buildFinishTaskActions(decorated);
	}
	return toolResult(decorated);
}

function validateToolResult(
	toolName: ToolName,
	result: McpStructuredToolResult
): McpStructuredToolResult {
	const contract = TOOL_CONTRACT_BY_NAME.get(toolName);
	if (!contract) {
		return result;
	}
	const validation = validateStructuredContent(result.structuredContent, contract.outputSchema);
	if (validation.valid) {
		return result;
	}
	const payload = isRecord(result.structuredContent) ? result.structuredContent : {};
	const recoveryMetadata: Record<string, unknown> = {};
	for (const key of ['operation_id', 'idempotency_key', 'task_id', 'path', 'task_path', 'audit_path', 'proposal_path']) {
		const value = payload[key];
		if (typeof value === 'string' && value.trim()) {
			recoveryMetadata[key] = value;
		}
	}
	const message = `Tracekeeper produced a result that does not match the ${toolName} output contract.`;
	return toolResult({
		...recoveryMetadata,
		schema_version: SCHEMA_VERSION,
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

type RecallScope = 'global' | 'project' | 'project_history';

function coerceRecallScope(value: unknown): RecallScope {
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
	throw new ToolInputError('scope must be one of: global, project, project_history.');
}

type ReviewQueueAction = 'list_pending' | 'list_approved';

function coerceReviewQueueAction(value: unknown): ReviewQueueAction {
	const normalized = coerceOptionalString(value).toLowerCase();
	if (!normalized || normalized === 'list_pending' || normalized === 'pending') {
		return 'list_pending';
	}
	if (normalized === 'list_approved' || normalized === 'approved') {
		return 'list_approved';
	}
	throw new ToolInputError('review_queue action must be one of: list_pending, list_approved.');
}

type SourceRequestAction = 'list' | 'analyze';

function coerceSourceRequestAction(value: unknown, rawArgs: SourceRequestArgs): SourceRequestAction {
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
	throw new ToolInputError('source_request action must be one of: list, analyze.');
}

function scanVaultForContext(vaultRoot: string, context: ToolContext): ScanResult {
	const snapshot = context.knowledgeSnapshotProvider?.(vaultRoot);
	if (snapshot) {
		return snapshot;
	}
	return scanVault(vaultRoot, pathSafetyOptions(context));
}

function scanProvenance(scan: ScanResult): {
	index_state: string;
	snapshot_generation: number | null;
	snapshot_warning: string | null;
} {
	const indexState = scan.index?.index_state ?? 'filesystem_scan';
	return {
		index_state: indexState,
		snapshot_generation: scan.index?.generation ?? null,
		snapshot_warning: indexState === 'rebuilding'
			? 'Knowledge index is rebuilding; this result may come from the previous snapshot generation.'
			: null,
	};
}

function buildContextPackForContext(
	vaultRoot: string,
	query: string,
	context: ToolContext,
	options: Parameters<typeof buildContextPack>[2] = {},
	scan?: ScanResult
): ContextPack {
	return buildContextPackFromScan(scan ?? scanVaultForContext(vaultRoot, context), query, options);
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

function coerceMemoryScope(value: unknown): MemoryScope | undefined {
	const normalized = coerceOptionalString(value).toLowerCase();
	if (!normalized) {
		return undefined;
	}
	if (normalized === 'global' || normalized === 'project') {
		return normalized;
	}
	throw new ToolInputError('memory_scope must be one of: global, project.');
}

function resolveMemoryScope(
	proposalKind: string,
	targetNote: string,
	projectHint: string,
	memoryScopeValue: unknown
): MemoryScope {
	return coerceMemoryScope(memoryScopeValue) || normalizeMemoryScope(proposalKind, targetNote, projectHint, '');
}

function dedupeAndNormalizeList(values: string[]): string[] {
	const normalized = values
		.map((value) => value.trim())
		.filter(Boolean)
		.map((value) => value.replace(/\s+/g, ' '))
		.sort((a, b) => a.localeCompare(b));
	return Array.from(new Set(normalized));
}

function normalizeMultiValueList(value: unknown, field: string, required = false): string[] {
	const source = coerceStringOrStringArray(value, field, required);
	const normalized: string[] = [];
	for (const entry of source) {
		const chunks = entry
			.split(/[\n,]/g)
			.map((item) => item.trim())
			.filter(Boolean);
		normalized.push(...chunks);
	}
	return dedupeAndNormalizeList(normalized);
}

function normalizeWikilinkOrSourceValue(value: string): string {
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

function normalizeMemoryScope(
	proposalKind: string,
	targetNote: string,
	projectHint: string,
	memoryScopeValue: unknown
): MemoryScope {
	const normalized = coerceOptionalString(memoryScopeValue).toLowerCase();
	if (normalized === 'project' || normalized === 'global') {
		return normalized;
	}
	return isProjectMemoryProposal(proposalKind, targetNote, projectHint) ? 'project' : 'global';
}

function buildArchitectureStatus(vaultRoot: string, context: ToolContext): ArchitectureStatusReport {
	const scan = scanVaultForContext(vaultRoot, context);
	const graphHealth = analyzeGraphHealth(scan.notes, { maxItems: 20 });
	const missingGraphBridges = [
		...graphHealth.missing_recommended_hubs,
		graphHealth.missing_recommended_entry,
	].filter((value): value is string => Boolean(value));
	const isHealthy =
		graphHealth.unresolved_edge_count === 0 &&
		graphHealth.component_count <= 1 &&
		missingGraphBridges.length === 0;
	return {
		architecture_status: isHealthy ? 'healthy' : 'needs_attention',
		missing_graph_bridges: dedupeAndNormalizeList(missingGraphBridges),
	};
}

function resolveProjectMemoryBridgeMetadata(
	vaultRoot: string,
	memoryScope: MemoryScope,
	projectHint: string,
	relatedWikiRaw: string[],
	relatedSourcesRaw: string[],
	context: ToolContext
): MemoryBridgeReport {
	const options = pathSafetyOptions(context);
	const scan = scanVaultForContext(vaultRoot, context);
	const pathSet = new Set(scan.notes.map((note) => note.relativePath.toLowerCase()));

	if (projectHint && !projectHint.trim()) {
		projectHint = '';
	}

	const relatedWiki = dedupeAndNormalizeList(relatedWikiRaw.map(normalizeWikilinkOrSourceValue));
	const relatedSources = dedupeAndNormalizeList(relatedSourcesRaw.map(normalizeWikilinkOrSourceValue));
	const missing_related_wiki: string[] = [];
	const resolved: string[] = [];
	const missing_related_sources: string[] = [];
	const resolvedSources: string[] = [];

	const resolveReference = (
		rawReference: string,
		isValid: (notePath: string) => boolean
	): string | null => {
		const candidates = new Set<string>();
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
			let notePath: string;
			try {
				notePath = normalizeNotePath(normalizedCandidate, options);
			} catch {
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
		const resolvedPath = resolveReference(reference, isKnowledgeWikiPath);
		if (resolvedPath && isKnowledgeWikiPath(resolvedPath)) {
			resolved.push(resolvedPath);
		} else {
			missing_related_wiki.push(reference);
		}
	}
	for (const reference of relatedSources) {
		const resolvedPath = resolveReference(reference, isKnowledgeSourcePath);
		if (resolvedPath && isKnowledgeSourcePath(resolvedPath)) {
			resolvedSources.push(resolvedPath);
		} else {
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

	const relatedWikiMissing =
		relatedWiki.length === 0 || missing_related_wiki.length > 0 || dedupeAndNormalizeList(resolved).length === 0;

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

function coerceReviewProposalMode(value: unknown, fallback: ReviewProposalMode = DEFAULT_FINISH_TASK_REVIEW_MODE): ReviewProposalMode {
	const normalized = coerceOptionalString(value).toLowerCase();
	if (!normalized) {
		return fallback;
	}
	if (normalized === 'off' || normalized === 'suggest' || normalized === 'review_queue' || normalized === 'auto_propose') {
		return normalized;
	}
	throw new ToolInputError('review_proposal_mode must be one of: off, suggest, review_queue, auto_propose.');
}

const FINISH_TASK_PROPOSAL_SIGNATURE_KEY = 'content_signature';

function normalizeFinishTaskProposalValues(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort((a, b) =>
		a.localeCompare(b)
	);
}

function buildFinishTaskProposalSignature(taskId: string, proposalKind: string, values: string[]): string {
	const payload = {
		taskId,
		proposalKind,
		values: normalizeFinishTaskProposalValues(values),
	};
	return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function finishTaskProposalLabel(proposalKind: string): string {
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

function extractFinishTaskSectionValues(body: string, label: string): string[] {
	const needle = `## ${label.toLowerCase()}`;
	const lines = body.split('\n');
	let inSection = false;
	const values: string[] = [];

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

function findExistingFinishTaskProposal(
	vaultRoot: string,
	taskId: string,
	proposalKind: string,
	proposalValues: string[],
	context: ToolContext
): string | null {
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
		if (
			sourceTool !== 'tracekeeper.finish_task' ||
			noteTaskId !== taskId ||
			noteProposalKind !== proposalKind
		) {
			continue;
		}

		const noteSignature = stripYamlQuotes(
			readFrontmatterString(note.frontmatter, [FINISH_TASK_PROPOSAL_SIGNATURE_KEY, 'proposal_signature'])
		);
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

function normalizeReviewProposalMode(value: unknown, fallback: ReviewProposalMode = DEFAULT_FINISH_TASK_REVIEW_MODE): ReviewProposalMode {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return normalized === 'off' || normalized === 'suggest' || normalized === 'review_queue' || normalized === 'auto_propose'
		? normalized
		: fallback;
}

function defaultReviewProposalMode(context: ToolContext): ReviewProposalMode {
	return normalizeReviewProposalMode(context.memoryRules?.taskMemoryProposalMode, DEFAULT_FINISH_TASK_REVIEW_MODE);
}

function normalizeMemoryProposalRule(value: unknown, fallback: MemoryProposalRule = 'review_queue'): MemoryProposalRule {
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

function isProjectMemoryProposal(proposalKind: string, targetNote: string, projectHint: string): boolean {
	const normalizedKind = proposalKind.trim().toLowerCase();
	const normalizedTarget = targetNote.trim().toLowerCase();
	return Boolean(
		projectHint.trim()
		|| normalizedKind.includes('project')
		|| normalizedKind.includes('workspace')
		|| normalizedKind.includes('repo')
		|| PROJECT_MEMORY_READ_DIRS.some((projectDir) => normalizedTarget.startsWith(`${projectDir}/`))
	);
}

function isProjectMemoryProposalForScope(
	proposalKind: string,
	targetNote: string,
	projectHint: string,
	memoryScope?: MemoryScope
): boolean {
	if (memoryScope === 'global') {
		return false;
	}
	if (memoryScope === 'project') {
		return true;
	}
	return isProjectMemoryProposal(proposalKind, targetNote, projectHint);
}

function memoryProposalRuleFor(
	proposalKind: string,
	targetNote: string,
	projectHint: string,
	context: ToolContext,
	memoryScope?: MemoryScope
): MemoryProposalRule {
	const projectScoped = isProjectMemoryProposalForScope(proposalKind, targetNote, projectHint, memoryScope);
	return normalizeMemoryProposalRule(
		projectScoped ? context.memoryRules?.projectMemoryRule : context.memoryRules?.globalMemoryRule,
		projectScoped ? 'auto_write' : 'review_queue'
	);
}

function isMemoryProposalAllowed(
	proposalKind: string,
	targetNote: string,
	projectHint: string,
	context: ToolContext,
	memoryScope?: MemoryScope
): boolean {
	return memoryProposalRuleFor(proposalKind, targetNote, projectHint, context, memoryScope) !== 'disabled';
}

function assertMemoryProposalAllowed(
	proposalKind: string,
	targetNote: string,
	projectHint: string,
	context: ToolContext,
	memoryScope?: MemoryScope
): void {
	if (isMemoryProposalAllowed(proposalKind, targetNote, projectHint, context, memoryScope)) {
		return;
	}
	const scope = isProjectMemoryProposalForScope(proposalKind, targetNote, projectHint, memoryScope) ? 'project' : 'global';
	throw new ToolInputError(`${scope} memory proposals are disabled by Tracekeeper memory rules.`);
}

function buildSafePathSegment(raw: string, fallback: string): string {
	const segment = raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	return segment || fallback;
}

function buildDefaultProjectMemoryTarget(vaultRoot: string, projectHint: string): string {
	void vaultRoot;
	return projectMemoryPath(projectHint || 'project');
}

function inferAutoMemoryAllowedDir(targetNote: string, projectScoped: boolean, context: ToolContext): string {
	const normalized = normalizeNotePath(targetNote, pathSafetyOptions(context));
	const allowedDirs = projectScoped ? PROJECT_MEMORY_READ_DIRS : GLOBAL_MEMORY_DIRS;
	return allowedDirs.find((dir) => normalized.startsWith(`${dir}/`)) || '';
}

function resolveAutoMemoryTarget(
	vaultRoot: string,
	proposalKind: string,
	targetNote: string,
	projectHint: string,
	context: ToolContext,
	memoryScope?: MemoryScope
): { targetNote: string; allowedDir: string } | null {
	const projectScoped = isProjectMemoryProposalForScope(proposalKind, targetNote, projectHint, memoryScope);
	if (targetNote) {
		const normalized = normalizeNotePath(targetNote, pathSafetyOptions(context));
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

type ProjectScopeFilter = ResolvedProjectIdentity;

function coerceProjectScope(rawArgs: ProjectScopeArgs, notes: ScannedNote[] = []): ProjectScopeFilter {
	return resolveProjectIdentity(rawArgs, notes);
}

function hasProjectScope(scope: ProjectScopeFilter): boolean {
	return Boolean(scope.projectHint || scope.projectId || scope.repoPath);
}

function normalizeRepoPrefix(value: string): string {
	return value
		.replace(/^\/+/, '')
		.replace(/\/+$/, '')
		.replace(/\\/g, '/');
}

function valueContainsAnyToken(value: string, tokens: string[]): boolean {
	const normalized = value.toLowerCase();
	return tokens.some((token) => token.length > 0 && normalized.includes(token));
}

function projectTokens(value: string): string[] {
	const normalized = value.toLowerCase().trim();
	if (!normalized) {
		return [];
	}
	const variants = new Set<string>([
		normalized,
		normalized.replace(/\s+/g, '-'),
		normalized.replace(/\s+/g, '_'),
		normalized.replace(/[-_]+/g, ' '),
	]);
	return Array.from(variants).filter(Boolean);
}

function noteMatchesRepoPath(note: ScannedNote, repoPath: string): boolean {
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

function noteMatchesProjectId(note: ScannedNote, projectId: string): boolean {
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

function hasExplicitProjectIdMetadata(note: ScannedNote): boolean {
	return Boolean(
		readFrontmatterString(note.frontmatter, ['project_id', 'projectId', 'project-id', 'pid'])
	);
}

function noteMatchesProjectHint(note: ScannedNote, projectHint: string): boolean {
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

function noteRepoMetadataValues(note: ScannedNote): string[] {
	return [
		readFrontmatterString(note.frontmatter, ['repo_path', 'repoPath', 'repository_path', 'repositoryPath']),
		readFrontmatterString(note.frontmatter, ['repo', 'repository']),
		readFrontmatterString(note.frontmatter, ['project_path', 'projectPath', 'project_paths', 'projectPaths']),
		readFrontmatterString(note.frontmatter, ['workspace', 'cwd']),
	]
		.map((value) => value.toLowerCase().trim())
		.filter(Boolean);
}

function hasExplicitRepoMetadata(note: ScannedNote): boolean {
	return noteRepoMetadataValues(note).length > 0;
}

function noteMatchesExplicitRepoMetadata(note: ScannedNote, normalizedRepoPath: string): boolean {
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

function filterNotesByProjectScope(notes: ScannedNote[], scope: ProjectScopeFilter): ScannedNote[] {
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
		} else if (hasRepoPath && !noteMatchesRepoPath(note, normalizedRepo)) {
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

function scopedTaskIdsFromNotes(notes: ScannedNote[], scope: ProjectScopeFilter): Set<string> {
	const taskIds = new Set<string>();
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

function filterNotesByProjectScopeWithSessions(notes: ScannedNote[], scope: ProjectScopeFilter): ScannedNote[] {
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

function collectProjectCandidates(
	notes: ScannedNote[],
	scope: ProjectScopeFilter,
	maxItems: number
): Array<{ path: string; title: string; type: string | null }> {
	const candidates: Array<{ path: string; title: string; type: string | null }> = [];
	const seen = new Set<string>();
	for (const note of notes) {
		const candidate = projectMemoryCandidatePath(note.relativePath);
		if (candidate) {
			if (!seen.has(note.relativePath)) {
				seen.add(note.relativePath);
				candidates.push({
					path: note.relativePath,
					title: note.title,
					type: note.type ?? null,
				});
			}
		}
		const notePath = note.relativePath.toLowerCase();
		const hintTokens = projectTokens(scope.projectHint);
		if (
			scope.projectId &&
			(notePath.includes(scope.projectId.toLowerCase()) || valueContainsAnyToken(notePath, hintTokens))
		) {
			if (!seen.has(note.relativePath)) {
				seen.add(note.relativePath);
				candidates.push({
					path: note.relativePath,
					title: note.title,
					type: note.type ?? null,
				});
			}
		}
		if (candidates.length >= maxItems) {
			break;
		}
	}
	return candidates.slice(0, maxItems);
}

function projectMemoryCandidatePath(notePath: string): string {
	for (const dir of PROJECT_MEMORY_READ_DIRS) {
		const prefix = `${dir}/`;
		if (!notePath.startsWith(prefix)) {
			continue;
		}
		const [projectSegment] = notePath.slice(prefix.length).split('/').filter(Boolean);
		return projectSegment ? `${dir}/${projectSegment}` : dir;
	}
	return '';
}

function buildProjectHistoryEntries(matches: ScannedNote[], query = '', allNotes: ScannedNote[] = []) {
	return matches.map((note) => ({
		path: note.relativePath,
		title: note.title,
		type: note.type,
		note_type: note.type ?? null,
		scope: 'project_history',
		modifiedAt: note.modifiedAt,
		content_origin: recallContentOrigin(note.relativePath, note.type),
		instruction_trust: 'data_only',
		task_id: readFrontmatterString(note.frontmatter, ['task_id', 'taskId']),
		project_hint: readFrontmatterString(note.frontmatter, ['project_hint', 'related_project', 'project']),
		why_matched: buildProjectHistoryWhy(note, query),
		excerpt: compactNoteText(note.content),
		graph_links: buildRecallGraphLinks(note),
		relation_evidence: buildRecallRelationEvidence(note, allNotes),
	}));
}

function buildProjectRecallRelationEvidence(scope: ProjectScopeFilter, fallbackToGlobal: boolean): Array<Record<string, unknown>> {
	const evidence: Array<Record<string, unknown>> = [];
	if (scope.projectHint) {
		evidence.push({
			type: 'project_hint',
			value: scope.projectHint,
			confidence: scope.confidence,
		});
	}
	if (scope.projectId) {
		evidence.push({
			type: 'project_id',
			value: scope.projectId,
			confidence: scope.confidence,
		});
	}
	if (scope.repoPath) {
		evidence.push({
			type: 'repo_path',
			value: scope.repoPath,
			confidence: scope.confidence,
		});
	}
	if (fallbackToGlobal) {
		evidence.push({
			type: 'fallback',
			value: 'project_scope_uncertain_no_matches',
			target_scope: 'global',
		});
	}
	if (evidence.length === 0) {
		evidence.push({
			type: 'fallback',
			value: 'global_default',
			target_scope: 'global',
		});
	}
	return evidence;
}

function matchesProjectQuery(note: ScannedNote, query: string): boolean {
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
	if (haystack.includes(normalizedQuery)) {
		return true;
	}
	const queryTokens = Array.from(new Set(normalizedQuery.split(/[^a-z0-9\u4e00-\u9fff]+/u).filter((token) => token.length > 1)));
	if (queryTokens.length === 0) {
		return false;
	}
	const matchedCount = queryTokens.filter((token) => haystack.includes(token)).length;
	const requiredMatches = queryTokens.length <= 2
		? queryTokens.length
		: Math.max(2, Math.ceil(queryTokens.length * 0.6));
	return matchedCount >= requiredMatches;
}

function buildProjectScopeMetadata(scope: ProjectScopeFilter) {
	return {
		project_hint: scope.projectHint || null,
		project_id: scope.projectId || null,
		repo_path: scope.repoPath || null,
		source: scope.source,
		confidence: scope.confidence,
		warnings: scope.warnings,
	};
}

function collectRecallScopeTokens(scope: ProjectScopeFilter): string[] {
	const tokens = new Set<string>();
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

function recallRecencyBoost(modifiedAt: string): number {
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

function recallCandidateLimit(maxItems: number): number {
	return Math.min(Math.max(maxItems * 4, 24), MAX_RECALL_CANDIDATES);
}

function isGeneratedWorkRecord(note: ScannedNote): boolean {
	const notePath = note.relativePath.replace(/\\/g, '/');
	return notePath.startsWith(`${TRACEKEEPER_TASKS_DIR}/`) ||
		notePath.startsWith(`${TRACEKEEPER_SESSIONS_DIR}/`) ||
		notePath.startsWith('02_timeline/agent_tasks/') ||
		notePath.startsWith('02_timeline/sessions/');
}

function buildProjectMemoryAnchors(
	notes: ScannedNote[],
	existingPaths: Set<string>,
	maxItems = 2
): Array<{ note: ScannedNote; score: number; matchedTokens: string[] }> {
	return notes
		.filter((note) =>
			note.relativePath.startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`) &&
			!existingPaths.has(note.relativePath)
		)
		.sort((a, b) => {
			const aCanonical = a.relativePath.toLowerCase().endsWith('/memory.md') ? 1 : 0;
			const bCanonical = b.relativePath.toLowerCase().endsWith('/memory.md') ? 1 : 0;
			return bCanonical - aCanonical ||
				Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt) ||
				a.relativePath.localeCompare(b.relativePath);
		})
		.slice(0, maxItems)
		.map((note) => ({ note, score: 0, matchedTokens: [] }));
}

function selectRecallMatches(matches: RankedRecallMatch[], maxItems: number): RankedRecallMatch[] {
	const hasDurableKnowledge = matches.some((match) =>
		!isGeneratedWorkRecord(match.note) && match.raw_score > 0
	);
	if (!hasDurableKnowledge) {
		return matches.slice(0, maxItems);
	}
	const selected: RankedRecallMatch[] = [];
	let workRecordCount = 0;
	for (const match of matches) {
		if (isGeneratedWorkRecord(match.note)) {
			if (workRecordCount >= 1) {
				continue;
			}
			workRecordCount += 1;
		}
		selected.push(match);
		if (selected.length >= maxItems) {
			break;
		}
	}
	if (
		maxItems > 1 &&
		workRecordCount === 0 &&
		selected.length === maxItems
	) {
		const bestWorkRecord = matches.find((match) =>
			isGeneratedWorkRecord(match.note) && match.raw_score > 0
		);
		if (bestWorkRecord) {
			selected[selected.length - 1] = bestWorkRecord;
		}
	}
	return selected;
}

function rankRecallMatches(
	matches: Array<{ note: ScannedNote; score: number; matchedTokens: string[] }>,
	query: string,
	scope: ProjectScopeFilter
): RankedRecallMatch[] {
	const fullQuery = query.trim().toLowerCase();
	const scopeTokens = collectRecallScopeTokens(scope);

	const ranked = matches.map((match) => {
		let score = match.score;
		const reasons: string[] = [];
		const noteTitle = match.note.title.toLowerCase();
		const notePath = match.note.relativePath.toLowerCase();
		const noteFrontmatter = [
			readFrontmatterString(match.note.frontmatter, ['project', 'project_hint', 'related_project']),
			readFrontmatterString(match.note.frontmatter, ['project_id', 'projectId', 'pid']),
			readFrontmatterString(match.note.frontmatter, ['repo_path', 'repoPath', 'project_path']),
			readFrontmatterString(match.note.frontmatter, ['related_project', 'relatedProject', 'workspace']),
		].join(' ').toLowerCase();

		if (notePath.startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
			score += PROJECT_MEMORY_RECALL_BOOST;
			reasons.push(PROJECT_MEMORY_RECALL_REASON);
		} else if (isKnowledgeWikiPath(notePath)) {
			score += KNOWLEDGE_WIKI_RECALL_BOOST;
			reasons.push(KNOWLEDGE_WIKI_RECALL_REASON);
		} else if (
			notePath.startsWith(`${TRACEKEEPER_TASKS_DIR}/`) ||
			notePath.startsWith(`${TRACEKEEPER_SESSIONS_DIR}/`)
		) {
			const echoPenalty = Math.max(
				WORK_RECORD_RECALL_PENALTY + Math.max(0, match.matchedTokens.length - 1),
				Math.max(0, match.score - 2)
			);
			score = Math.max(0.01, score - echoPenalty);
			reasons.push(`Work-record query-echo penalty (-${echoPenalty})`);
		}
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

function compactNoteText(text: string, maxLength = MAX_RECALL_EXCERPT_LENGTH): string {
	const compact = text
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (compact.length <= maxLength) {
		return compact;
	}
	return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildRecallGraphLinks(note: ScannedNote): string[] {
	const links = new Set<string>();
	for (const link of note.wikilinks) {
		const target = link.heading ? `${link.target}#${link.heading}` : link.target;
		if (target.trim()) {
			links.add(target.trim());
		}
		if (links.size >= MAX_RECALL_GRAPH_LINKS) {
			break;
		}
	}
	return Array.from(links);
}

function relationValues(value: unknown): string[] {
	const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
	return values
		.filter((entry): entry is string => typeof entry === 'string')
		.flatMap((entry) => entry.split(/[\n,]/g))
		.map(normalizeWikilinkOrSourceValue)
		.filter(Boolean);
}

function resolveSnapshotRelation(reference: string, notes: ScannedNote[]): ScannedNote | null {
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

function buildRecallRelationEvidence(note: ScannedNote, allNotes: ScannedNote[]): RecallRelationEvidence {
	const relationMap = new Map<string, RecallRelationEvidenceItem>();
	const addRelation = (
		reference: string,
		declaredVia: 'frontmatter' | 'body_wikilink'
	) => {
		const resolved = resolveSnapshotRelation(reference, allNotes);
		if (!resolved) {
			return;
		}
		const relationKind = isKnowledgeWikiPath(resolved.relativePath)
			? 'related_wiki'
			: isKnowledgeSourcePath(resolved.relativePath)
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

	for (const key of ['related_wiki', 'relatedWiki', 'wiki']) {
		for (const value of relationValues(note.frontmatter[key])) {
			addRelation(value, 'frontmatter');
		}
	}
	for (const key of ['related_sources', 'relatedSources', 'sources', 'source']) {
		for (const value of relationValues(note.frontmatter[key])) {
			addRelation(value, 'frontmatter');
		}
	}
	for (const link of note.wikilinks) {
		addRelation(link.target, 'body_wikilink');
	}

	const evidence: RecallRelationEvidence = {
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

function buildRecallWhyMatched(match: RankedRecallMatch, scope: RecallScope): string {
	const scopeLabel = scope === 'project_history'
		? 'Project-history recall'
		: scope === 'project'
			? 'Project recall'
			: 'Global recall';
	const tokenText = match.matchedTokens.slice(0, 6).join(', ');
	const reasonText = match.score_reason.slice(0, 2).join('; ');
	return [scopeLabel, tokenText ? `matched tokens: ${tokenText}` : '', reasonText].filter(Boolean).join(' - ');
}

function recallContentOrigin(relativePath: string, noteType?: string): 'captured_source' | 'tracekeeper_generated' | 'vault_note' {
	const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
	const normalizedType = (noteType ?? '').trim().toLowerCase();
	if (
		normalizedPath === KNOWLEDGE_SOURCES_DIR ||
		normalizedPath.startsWith(`${KNOWLEDGE_SOURCES_DIR}/`) ||
		normalizedType.includes('source')
	) {
		return 'captured_source';
	}
	if (normalizedPath === TRACEKEEPER_ROOT || normalizedPath.startsWith(`${TRACEKEEPER_ROOT}/`)) {
		return 'tracekeeper_generated';
	}
	return 'vault_note';
}

function buildRecallEntry(
	match: RankedRecallMatch,
	scope: RecallScope,
	allNotes: ScannedNote[]
) {
	return {
		path: match.note.relativePath,
		title: match.note.title,
		type: match.note.type,
		note_type: match.note.type ?? null,
		scope,
		score: match.score,
		raw_score: match.raw_score,
		matched_tokens: match.matchedTokens,
		score_reason: match.score_reason,
		why_matched: buildRecallWhyMatched(match, scope),
		excerpt: compactNoteText(match.note.content),
		content_origin: recallContentOrigin(match.note.relativePath, match.note.type),
		instruction_trust: 'data_only',
		graph_links: buildRecallGraphLinks(match.note),
		relation_evidence: buildRecallRelationEvidence(match.note, allNotes),
	};
}

function buildProjectHistoryWhy(note: ScannedNote, query: string): string {
	const parts = ['Project-history recall'];
	const taskId = readFrontmatterString(note.frontmatter, ['task_id', 'taskId']);
	if (taskId) {
		parts.push(`linked task: ${taskId}`);
	}
	if (query) {
		parts.push(`matched query: ${query}`);
	}
	return parts.join(' - ');
}

function buildFinishTaskProposalEvidence(
	taskId: string,
	sessionNotePath: string,
	projectHint: string,
	proposalKind: string,
	mode: ReviewProposalMode
): string {
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

async function readVaultNoteContent(
	vaultRoot: string,
	notePath: string,
	context: ToolContext
): Promise<string | null> {
	if (context.vaultRepository) {
		const note = await context.vaultRepository.readText(notePath);
		return note?.content ?? null;
	}
	const absolutePath = resolveSafeNotePath(vaultRoot, notePath, pathSafetyOptions(context));
	return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : null;
}

async function readOperationOwnerFromNote(
	vaultRoot: string,
	notePath: string,
	operationField: string,
	context: ToolContext
): Promise<string> {
	const content = await readVaultNoteContent(vaultRoot, notePath, context);
	if (content === null) {
		return '';
	}
	return stripYamlQuotes(
		readFrontmatterString(parseMarkdown(content).frontmatter.fields, [operationField])
	);
}

async function createFinishTaskProposal(
	vaultRoot: string,
	taskId: string,
	sessionNotePath: string,
	operationId: string,
	proposalKind: string,
	label: string,
	values: string[],
	projectHint: string,
	reviewProposalMode: ReviewProposalMode,
	memoryScope: MemoryScope,
	relatedWiki: string[],
	relatedSources: string[],
	architectureStatus: ArchitectureStatusReport,
	missingGraphBridges: string[],
	missingWikiBridge: boolean,
	missingRelatedWiki: string[],
	missingRelatedSources: string[],
	context: ToolContext
): Promise<{ path: string }> {
	const normalizedValues = normalizeFinishTaskProposalValues(values);
	const proposalSignature = buildFinishTaskProposalSignature(taskId, proposalKind, normalizedValues);
	const proposalAuditMetadata = {
		target_type: 'memory_proposal',
		proposal_kind: proposalKind,
		source_note: sessionNotePath,
	};
	const existingProposal = findExistingFinishTaskProposal(vaultRoot, taskId, proposalKind, normalizedValues, context);
	if (existingProposal) {
		const existingOperationId = await readOperationOwnerFromNote(
			vaultRoot,
			existingProposal,
			'finish_operation_id',
			context
		);
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
		return { path: existingProposal };
	}
	const existingForOperation = await findOperationOwnedNoteAsync(
		vaultRoot,
		MEMORY_PROPOSAL_DIR,
		`finish-task-${proposalKind}-${taskId}-${operationId}`,
		'finish_operation_id',
		operationId,
		context
	);
	if (existingForOperation) {
		await appendAuditEventAsync(vaultRoot, {
			operationId,
			tool: 'tracekeeper.finish_task',
			targetPath: existingForOperation.path,
			status: 'written',
			taskId,
			metadata: proposalAuditMetadata,
		}, context);
		return { path: existingForOperation.path };
	}

	const now = new Date().toISOString();
	const filename = buildSafeFilename(
		`finish-task-${proposalKind}-${taskId}-${operationId}`,
		'proposal',
		context
	);
	const evidence = buildFinishTaskProposalEvidence(taskId, sessionNotePath, projectHint, proposalKind, reviewProposalMode);
	const writebackContent = normalizedValues.map((item) => `- ${item}`).join('\n');
	const writebackTarget = resolveAutoMemoryTarget(vaultRoot, proposalKind, '', projectHint, context, memoryScope);
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

	return buildAndWriteNoteAsync(
		vaultRoot,
		'tracekeeper.finish_task',
		MEMORY_PROPOSAL_DIR,
		filename,
		{
			tool: 'tracekeeper.finish_task',
			type: 'memory_proposal',
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
		},
		body,
		taskId,
		context,
		proposalAuditMetadata,
		operationId
	);
}

async function collectFinishTaskArtifacts(
	vaultRoot: string,
	taskId: string,
	sessionNotePath: string,
	proposalMode: ReviewProposalMode,
	projectHint: string,
	rawMemoryScope: unknown,
	relatedWiki: string[],
	relatedSources: string[],
	architectureStatus: ArchitectureStatusReport,
	closeout: {
		decisions: string[];
		solution_changes: string[];
		lessons: string[];
		preferences: string[];
		next_actions: string[];
		memory_candidates: string[];
	},
	context: ToolContext,
	operationId: string
): Promise<FinishTaskProposalResult> {
	if (proposalMode === 'off') {
		return {
			proposals: [],
			suggestedMemoryUpdates: [],
			autoAppliedMemoryUpdates: [],
			hasMissingWikiBridge: false,
			hasMissingRelatedSources: false,
		};
	}

	const groups: FinishTaskCloseoutGroup[] = buildFinishTaskCloseoutGroups(closeout, context);

	const proposals: Array<{ kind: string; path: string }> = [];
	const suggestedMemoryUpdates: FinishTaskSuggestion[] = [];
	const autoAppliedMemoryUpdates: Array<{ kind: string; path: string; status: string }> = [];
	let hasMissingWikiBridge = false;
	let hasMissingRelatedSources = false;
	for (const group of groups) {
		if (group.values.length === 0) {
			continue;
		}
		const memoryScope = resolveMemoryScope(group.kind, '', projectHint, rawMemoryScope);
		const bridgeMetadata = resolveProjectMemoryBridgeMetadata(
			vaultRoot,
			memoryScope,
			projectHint,
			relatedWiki,
			relatedSources,
			context
		);
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
			const canAutoWrite = !(
				memoryScope === 'project' &&
				bridgeMetadata.missing_wiki_bridge
			);
			if (memoryScope === 'project' && bridgeMetadata.missing_wiki_bridge) {
				hasMissingWikiBridge = true;
			}
			if (memoryScope === 'project' && bridgeMetadata.missing_related_sources.length > 0) {
				hasMissingRelatedSources = true;
			}
			if (canAutoWrite) {
				const autoTarget = resolveAutoMemoryTarget(
					vaultRoot,
					group.kind,
					'',
					projectHint,
					context,
					memoryScope
				);
				if (autoTarget) {
					const signature = buildFinishTaskProposalSignature(taskId, group.kind, group.values);
					const targetContent = await readVaultNoteContent(vaultRoot, autoTarget.targetNote, context);
					if (!targetContent?.includes(`content_signature: ${signature}`)) {
						throw new ToolInputError(`Auto memory closeout artifact is missing: ${autoTarget.targetNote}`);
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
		const operationProposal = await findOperationOwnedNoteAsync(
			vaultRoot,
			MEMORY_PROPOSAL_DIR,
			`finish-task-${group.kind}-${taskId}-${operationId}`,
			'finish_operation_id',
			operationId,
			context
		);
		const proposalPath = operationProposal?.path || findExistingFinishTaskProposal(
			vaultRoot,
			taskId,
			group.kind,
			group.values,
			context
		);
		if (!proposalPath) {
			throw new ToolInputError(`Finish-task proposal artifact is missing for ${group.kind}.`);
		}
		proposals.push({
			kind: group.kind,
			path: proposalPath,
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

async function safeReadTextFileAsync(vaultRoot: string, notePath: string, context: ToolContext): Promise<string> {
	if (!context.vaultRepository) {
		return safeReadTextFile(vaultRoot, notePath, context);
	}

	const normalized = normalizeNotePath(notePath, pathSafetyOptions(context));
	const repositoryFile = await context.vaultRepository.readText(normalized);
	if (!repositoryFile) {
		throw new ToolInputError(`Source path is not readable: ${normalized}`);
	}
	return repositoryFile.content;
}

function assertSourceRequestPath(relativePath: string): void {
	if (!relativePath.startsWith(`${SOURCE_REQUESTS_DIR}/`)) {
		throw new ToolInputError(`Source request path must be under ${SOURCE_REQUESTS_DIR}.`);
	}
}

function parseSourceRequest(data: { path: string; text: string }): SourceRequestRecord {
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

function readSourceRequest(vaultRoot: string, requestPath: string, context: ToolContext): SourceRequestRecord {
	return parseSourceRequest(safeReadNote(vaultRoot, requestPath, context));
}

async function readSourceRequestAsync(
	vaultRoot: string,
	requestPath: string,
	context: ToolContext
): Promise<SourceRequestRecord> {
	if (!context.vaultRepository) {
		return readSourceRequest(vaultRoot, requestPath, context);
	}

	const normalized = normalizeNotePath(requestPath, pathSafetyOptions(context));
	assertSourceRequestPath(normalized);
	const repositoryFile = await context.vaultRepository.readText(normalized);
	if (!repositoryFile) {
		throw new ToolInputError(`Source request not found: ${normalized}`);
	}
	return parseSourceRequest({ path: repositoryFile.path, text: repositoryFile.content });
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
	throw new ToolInputError(`Knowledge Change Review record is not a memory proposal: ${relative}`);
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

function replaceTextFileAtomically(absolutePath: string, content: string, expectedContent?: string): void {
	const tempPath = `${absolutePath}.${crypto.randomUUID()}.tmp`;
	const mode = fs.statSync(absolutePath).mode;
	try {
		fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode });
		if (expectedContent !== undefined && fs.readFileSync(absolutePath, 'utf8') !== expectedContent) {
			throw new OperationConflictError(`File changed before atomic replace: ${absolutePath}`);
		}
		fs.renameSync(tempPath, absolutePath);
	} catch (error: unknown) {
		try {
			fs.unlinkSync(tempPath);
		} catch {
		}
		throw error;
	}
}

function assertAllowedWritebackTarget(relativePath: string): void {
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
	const text = fs.readFileSync(absolutePath, 'utf8');
	const updated = buildRequestStatusUpdate(text, requestPath, nextStatus);
	fs.writeFileSync(absolutePath, updated, 'utf8');

	return {
		path: relativeFromAbsolute(vaultRoot, absolutePath),
	};
}

function buildRequestStatusUpdate(text: string, requestPath: string, nextStatus: string): string {
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

	return `${updatedFrontmatter}${body}`;
}

async function updateRequestStatusAsync(
	vaultRoot: string,
	requestPath: string,
	nextStatus: string,
	context: ToolContext
): Promise<{ path: string }> {
	if (!context.vaultRepository) {
		return updateRequestStatus(vaultRoot, requestPath, nextStatus, context);
	}

	const normalized = normalizeNotePath(requestPath, pathSafetyOptions(context));
	assertSourceRequestPath(normalized);
	const repositoryFile = await context.vaultRepository.readText(normalized);
	if (!repositoryFile) {
		throw new ToolInputError(`Source request not found: ${normalized}`);
	}
	const updated = buildRequestStatusUpdate(repositoryFile.content, repositoryFile.path, nextStatus);
	await context.vaultRepository.replaceText(repositoryFile.path, repositoryFile.version, updated);
	return { path: repositoryFile.path };
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
		.filter((note) => note.relativePath.startsWith(`${SESSION_NOTE_DIR}/`))
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

async function buildAndWriteNoteAsync(
	vaultRoot: string,
	toolName: string,
	allowedDir: string,
	filename: string,
	frontmatter: Record<string, unknown>,
	body: string,
	taskId: string | null,
	context: ToolContext,
	metadata: Record<string, unknown> = {},
	operationId = ''
): Promise<{ path: string; audit_path: string; status: string; warnings: string[] }> {
	const options = pathSafetyOptions(context);
	const safeLeaf = normalizeNotePath(filename, options);
	const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
	const targetPath = `${allowedDir}/${normalized}`;
	const markdown = buildMarkdownNote(frontmatter, body);

	if (!context.vaultRepository) {
		return buildAndWriteNote(vaultRoot, toolName, allowedDir, filename, frontmatter, body, taskId, context, metadata);
	}

	try {
		await context.vaultRepository.createText(targetPath, markdown);
	} catch (error) {
		if (error instanceof Error && error.message.includes('Target already exists')) {
			throw new ToolInputError(`Target already exists: ${targetPath}`);
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

function findOperationOwnedNote(
	vaultRoot: string,
	allowedDir: string,
	filename: string,
	operationField: string,
	operationId: string,
	context: ToolContext
): { path: string; audit_path: string; status: string; warnings: string[] } | null {
	const safeLeaf = normalizeNotePath(filename, pathSafetyOptions(context));
	const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
	const relativePath = `${allowedDir}/${normalized}`;
	const absolutePath = path.resolve(vaultRoot, relativePath);
	relativeFromAbsolute(vaultRoot, absolutePath);
	assertNoSymlinkSegments(vaultRoot, absolutePath);
	if (!fs.existsSync(absolutePath)) {
		return null;
	}
	const parsed = parseMarkdown(fs.readFileSync(absolutePath, 'utf8'));
	const existingOperationId = stripYamlQuotes(
		readFrontmatterString(parsed.frontmatter.fields, [operationField])
	);
	if (existingOperationId !== operationId) {
		throw new OperationConflictError(`Note path is already owned by another operation: ${relativePath}`);
	}
	return { path: relativePath, audit_path: AUDIT_LOG_PATH, status: 'skipped', warnings: [] };
}

interface AutoMemoryWriteInput {
	toolName: string;
	proposalKind: string;
	targetNote: string;
	allowedDir: string;
	title: string;
	content: string;
	operationId?: string;
	taskId: string | null;
	context: ToolContext;
	memoryScope: MemoryScope;
	projectHint?: string;
	relatedWiki?: string[];
	relatedSources?: string[];
	architectureStatus: ArchitectureStatusReport;
	missingGraphBridges: string[];
	missingWikiBridge: boolean;
	missingRelatedWiki?: string[];
	missingRelatedSources?: string[];
	sourceNote?: string;
	evidence?: string;
	riskLevel?: string;
	signature?: string;
}

function resolveExistingOrNewAutoMemoryTarget(
	vaultRoot: string,
	targetNote: string,
	allowedDir: string,
	context: ToolContext
): { absolutePath: string; relativePath: string; created: boolean } {
	const options = pathSafetyOptions(context);
	const normalizedTarget = normalizeNotePath(targetNote, options);
	if (!normalizedTarget.startsWith(`${allowedDir}/`)) {
		throw new ToolInputError(`Auto memory target must be under ${allowedDir}`);
	}

	try {
		const absolutePath = resolveSafeNotePath(vaultRoot, normalizedTarget, options);
		const relativePath = relativeFromAbsolute(vaultRoot, absolutePath);
		if (!relativePath.startsWith(`${allowedDir}/`) || !relativePath.endsWith('.md')) {
			throw new ToolInputError(`Auto memory target must be a markdown note under ${allowedDir}`);
		}
		assertAllowedWritebackTarget(relativePath);
		return { absolutePath, relativePath, created: false };
	} catch (error) {
		if (!(error instanceof VaultPathError)) {
			throw error;
		}
		const resolved = resolveSafeWritableNotePath(vaultRoot, normalizedTarget, allowedDir, options);
		assertAllowedWritebackTarget(resolved.relativePath);
		return { absolutePath: resolved.absolutePath, relativePath: resolved.relativePath, created: true };
	}
}

function ensureProjectMemoryIndex(
	vaultRoot: string,
	targetRelativePath: string,
	input: AutoMemoryWriteInput
): string | null {
	if (!targetRelativePath.startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
		return null;
	}
	const suffix = targetRelativePath.slice(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`.length);
	const projectSlug = suffix.split('/', 1)[0] || '';
	if (!projectSlug) {
		return null;
	}
	const indexPath = `${KNOWLEDGE_PROJECTS_MEMORY_DIR}/${projectSlug}/index.md`;
	const absolutePath = path.join(vaultRoot, indexPath);
	if (fs.existsSync(absolutePath)) {
		return indexPath;
	}
	const displayName = input.projectHint || projectSlug;
	const relatedWikiLinks = dedupeAndNormalizeList(input.relatedWiki || []).map((link) => `- [[${link.replace(/\.md$/i, '')}]]`);
	const title = contentText(input.context, `项目记忆：${displayName}`, `Project memory: ${displayName}`);
	const markdown = buildMarkdownNote(
		{
			type: 'project_memory_index',
			title,
			project_hint: input.projectHint || projectSlug,
			related_wiki: input.relatedWiki || [],
			created_at: new Date().toISOString(),
		},
		[
			`# ${title}`,
			'',
			contentText(input.context, '## 相关 Wiki', '## Related wiki'),
			...(relatedWikiLinks.length > 0 ? relatedWikiLinks : [contentText(input.context, '- （无）', '- (none)')]),
		].join('\n')
	);
	fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
	fs.writeFileSync(absolutePath, markdown, 'utf8');
	return indexPath;
}

async function ensureProjectMemoryIndexAsync(
	vaultRoot: string,
	targetRelativePath: string,
	input: AutoMemoryWriteInput
): Promise<string | null> {
	if (!input.context.vaultRepository) {
		return ensureProjectMemoryIndex(vaultRoot, targetRelativePath, input);
	}
	if (!targetRelativePath.startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
		return null;
	}
	const suffix = targetRelativePath.slice(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`.length);
	const projectSlug = suffix.split('/', 1)[0] || '';
	if (!projectSlug) {
		return null;
	}
	const indexPath = `${KNOWLEDGE_PROJECTS_MEMORY_DIR}/${projectSlug}/index.md`;
	if (await input.context.vaultRepository.readText(indexPath)) {
		return indexPath;
	}
	const displayName = input.projectHint || projectSlug;
	const relatedWikiLinks = dedupeAndNormalizeList(input.relatedWiki || []).map((link) => `- [[${link.replace(/\.md$/i, '')}]]`);
	const title = contentText(input.context, `项目记忆：${displayName}`, `Project memory: ${displayName}`);
	const markdown = buildMarkdownNote(
		{
			type: 'project_memory_index',
			title,
			project_hint: input.projectHint || projectSlug,
			related_wiki: input.relatedWiki || [],
			created_at: new Date().toISOString(),
		},
		[
			`# ${title}`,
			'',
			contentText(input.context, '## 相关 Wiki', '## Related wiki'),
			...(relatedWikiLinks.length > 0 ? relatedWikiLinks : [contentText(input.context, '- （无）', '- (none)')]),
		].join('\n')
	);
	await input.context.vaultRepository.createText(indexPath, markdown);
	return indexPath;
}

function buildAutoMemoryWriteBlock(input: AutoMemoryWriteInput, signature: string): string {
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

function appendAutoMemoryWrite(
	vaultRoot: string,
	input: AutoMemoryWriteInput
): { path: string; audit_path: string; status: 'written' | 'skipped'; warnings: string[]; duplicate: boolean } {
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
	} else {
		fs.mkdirSync(path.dirname(target.absolutePath), { recursive: true });
		const title = input.projectHint
			? contentText(input.context, `项目记忆：${input.projectHint}`, `Project memory: ${input.projectHint}`)
			: contentText(input.context, 'Tracekeeper 记忆', 'Tracekeeper memory');
		const markdown = buildMarkdownNote(
			{
				type: 'memory',
				title,
				project_hint: input.projectHint || null,
				memory_scope: input.memoryScope,
				related_wiki: input.relatedWiki || [],
				related_sources: input.relatedSources || [],
				created_at: new Date().toISOString(),
			},
			[`# ${title}`, '', block].join('\n')
		);
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

async function appendAutoMemoryWriteAsync(
	vaultRoot: string,
	input: AutoMemoryWriteInput
): Promise<{ path: string; audit_path: string; status: 'written' | 'skipped'; warnings: string[]; duplicate: boolean }> {
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

	const targetPath = normalizeNotePath(input.targetNote, pathSafetyOptions(input.context));
	if (!targetPath.startsWith(`${input.allowedDir}/`) || !targetPath.endsWith('.md')) {
		throw new ToolInputError(`Auto memory target must be a markdown note under ${input.allowedDir}`);
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
	} else {
		const title = input.projectHint
			? contentText(input.context, `项目记忆：${input.projectHint}`, `Project memory: ${input.projectHint}`)
			: contentText(input.context, 'Tracekeeper 记忆', 'Tracekeeper memory');
		const markdown = buildMarkdownNote(
			{
				type: 'memory',
				title,
				project_hint: input.projectHint || null,
				memory_scope: input.memoryScope,
				related_wiki: input.relatedWiki || [],
				related_sources: input.relatedSources || [],
				created_at: new Date().toISOString(),
			},
			[`# ${title}`, '', block].join('\n')
		);
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

async function findOperationOwnedNoteAsync(
	vaultRoot: string,
	allowedDir: string,
	filename: string,
	operationField: string,
	operationId: string,
	context: ToolContext
): Promise<{ path: string; audit_path: string; status: string; warnings: string[] } | null> {
	const safeLeaf = normalizeNotePath(filename, pathSafetyOptions(context));
	const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
	const relativePath = `${allowedDir}/${normalized}`;
	const options = pathSafetyOptions(context);

	if (context.vaultRepository) {
		const repositoryFile = await context.vaultRepository.readText(relativePath);
		if (!repositoryFile) {
			return null;
		}
		const parsed = parseMarkdown(repositoryFile.content);
		const existingOperationId = stripYamlQuotes(
			readFrontmatterString(parsed.frontmatter.fields, [operationField])
		);
		if (existingOperationId !== operationId) {
			throw new OperationConflictError(`Note path is already owned by another operation: ${relativePath}`);
		}
		return { path: relativePath, audit_path: AUDIT_LOG_PATH, status: 'skipped', warnings: [] };
	}

	const absolutePath = path.resolve(vaultRoot, relativePath);
	relativeFromAbsolute(vaultRoot, absolutePath);
	assertNoSymlinkSegments(vaultRoot, absolutePath);
	if (!fs.existsSync(absolutePath)) {
		return null;
	}
	const parsed = parseMarkdown(fs.readFileSync(absolutePath, 'utf8'));
	const existingOperationId = stripYamlQuotes(
		readFrontmatterString(parsed.frontmatter.fields, [operationField])
	);
	if (existingOperationId !== operationId) {
		throw new OperationConflictError(`Note path is already owned by another operation: ${relativePath}`);
	}
	return { path: relativePath, audit_path: AUDIT_LOG_PATH, status: 'skipped', warnings: [] };
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

interface AgentTaskMetadata extends ResolvedProjectIdentity {
	client: string;
}

function emptyAgentTaskMetadata(): AgentTaskMetadata {
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

function agentTaskMetadataFromFrontmatter(frontmatter: Record<string, unknown>): AgentTaskMetadata {
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
			? source as ResolvedProjectIdentity['source']
			: 'task_metadata',
		confidence: ['exact', 'derived', 'uncertain'].includes(confidence)
			? confidence as ResolvedProjectIdentity['confidence']
			: 'derived',
		warnings: readFrontmatterStringList(frontmatter, 'project_identity_warnings'),
		client: readFrontmatterString(frontmatter, ['client']),
	};
}

function projectIdentityValueMatches(field: 'project_hint' | 'project_id' | 'repo_path', left: string, right: string): boolean {
	if (!left || !right) {
		return true;
	}
	const normalize = field === 'repo_path'
		? normalizeRepositoryPath
		: (value: string) => value.trim();
	return normalize(left).toLowerCase() === normalize(right).toLowerCase();
}

function mergeTaskProjectIdentity(
	taskId: string,
	task: AgentTaskMetadata,
	explicit: ResolvedProjectIdentity
): ResolvedProjectIdentity {
	for (const [field, taskValue, explicitValue] of [
		['project_hint', task.projectHint, explicit.projectHint],
		['project_id', task.projectId, explicit.projectId],
		['repo_path', task.repoPath, explicit.repoPath],
	] as const) {
		if (!projectIdentityValueMatches(field, taskValue, explicitValue)) {
			throw new ToolInputError(
				`Project identity mismatch: task ${taskId} was created with ${field} "${taskValue}", ` +
				`but the current call received "${explicitValue}".`
			);
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

function readAgentTaskMetadata(
	vaultRoot: string,
	taskId: string,
	context: ToolContext
): AgentTaskMetadata {
	try {
		const absolute = resolveSafeNotePath(vaultRoot, buildTaskNotePath(taskId), pathSafetyOptions(context));
		const parsed = parseMarkdown(fs.readFileSync(absolute, 'utf8'));
		return agentTaskMetadataFromFrontmatter(parsed.frontmatter.fields);
	} catch (error) {
		if (error instanceof ToolInputError || error instanceof VaultPathError || error instanceof Error) {
			return emptyAgentTaskMetadata();
		}
		return emptyAgentTaskMetadata();
	}
}

async function readAgentTaskMetadataAsync(
	vaultRoot: string,
	taskId: string,
	context: ToolContext
): Promise<AgentTaskMetadata> {
	try {
		const safePath = buildTaskNotePath(taskId);
		let text: string;
		if (context.vaultRepository) {
			const repositoryFile = await context.vaultRepository.readText(safePath);
			if (!repositoryFile) {
				return emptyAgentTaskMetadata();
			}
			text = repositoryFile.content;
		} else {
			const absolute = resolveSafeNotePath(vaultRoot, safePath, pathSafetyOptions(context));
			const parsed = parseMarkdown(fs.readFileSync(absolute, 'utf8'));
			return agentTaskMetadataFromFrontmatter(parsed.frontmatter.fields);
		}
		const parsed = parseMarkdown(text);
		return agentTaskMetadataFromFrontmatter(parsed.frontmatter.fields);
	} catch (error) {
		if (error instanceof ToolInputError || error instanceof VaultPathError || error instanceof Error) {
			return emptyAgentTaskMetadata();
		}
		return emptyAgentTaskMetadata();
	}
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
	fields: Record<string, string | null>,
	context: ToolContext,
	references: Record<string, string[]> = {},
	appendBody = '',
	appendBodyMarker = ''
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
	const nextFields: Record<string, string> = Object.fromEntries(
		Object.entries(fields).map(([key, value]) => [key, value ?? ''])
	);
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
	return relativeFromAbsolute(vaultRoot, absolute);
}

async function updateAgentTaskRecordAsync(
	vaultRoot: string,
	taskId: string | null,
	fields: Record<string, string | null>,
	context: ToolContext,
	references: Record<string, string[]> = {},
	appendBody = '',
	appendBodyMarker = ''
): Promise<string | null> {
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

	if (context.vaultRepository) {
		const existing = await context.vaultRepository.readText(buildTaskNotePath(taskId));
		if (!existing) {
			return null;
		}
		const frontmatter = parseMarkdown(existing.content).frontmatter.fields;
		const nextFields: Record<string, string> = Object.fromEntries(
			Object.entries(fields).map(([key, value]) => [key, value ?? ''])
		);
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
	const frontmatter = parseMarkdown(current).frontmatter.fields;
	const nextFields: Record<string, string> = Object.fromEntries(
		Object.entries(fields).map(([key, value]) => [key, value ?? ''])
	);
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
	return relativeFromAbsolute(vaultRoot, absolute);
}

async function createAgentTaskRecord(
	vaultRoot: string,
	input: {
		taskId: string;
		goal: string;
		client: string;
		projectHint: string;
		projectId: string;
		repoPath: string;
		projectIdentitySource: ResolvedProjectIdentity['source'];
		projectIdentityConfidence: ResolvedProjectIdentity['confidence'];
		projectIdentityWarnings: string[];
		context: ToolInvocationContext;
		contextPack: ContextPack;
		operationId: string;
	}
): Promise<{ path: string; audit_path: string; status: string; warnings: string[] }> {
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
		relativeFromAbsolute(vaultRoot, taskAbsolute);
		assertNoSymlinkSegments(vaultRoot, taskAbsolute);
		if (fs.existsSync(taskAbsolute)) {
			const existing = parseMarkdown(fs.readFileSync(taskAbsolute, 'utf8'));
			const existingOperationId = stripYamlQuotes(
				readFrontmatterString(existing.frontmatter.fields, ['start_operation_id'])
			);
			if (existingOperationId === input.operationId) {
				return returnExistingTask();
			}
			throw new OperationConflictError(`Task path already exists for another operation: ${taskPath}`);
		}
	}

	if (existingTask) {
		const existingOperationId = stripYamlQuotes(
			readFrontmatterString(parseMarkdown(existingTask.content).frontmatter.fields, ['start_operation_id'])
		);
		if (existingOperationId === input.operationId) {
			return returnExistingTask();
		}
		throw new OperationConflictError(`Task path already exists for another operation: ${taskPath}`);
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

	return buildAndWriteNoteAsync(
		vaultRoot,
		'tracekeeper.start_task',
		AGENT_TASK_DIR,
		taskPath.slice(`${AGENT_TASK_DIR}/`.length),
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
			project_hint: input.projectHint || null,
			related_project: input.projectHint || null,
			project_id: input.projectId || null,
			repo_path: input.repoPath || null,
			project_identity_source: input.projectIdentitySource,
			project_identity_confidence: input.projectIdentityConfidence,
			project_identity_warnings: input.projectIdentityWarnings,
			started_at: now,
			start_operation_id: input.operationId,
		},
		body,
		input.taskId,
		input.context,
		taskAuditMetadata,
		input.operationId
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

function buildAuditEventId(input: AuditEventInput, targetPaths: string[]): string {
	const operationId = input.operationId?.trim() || '';
	if (!operationId) {
		return '';
	}
	return `audit-${computePayloadHash({
		operationId,
		type: input.type || 'tool-call',
		event: input.event || input.type || 'tool-call',
		tool: input.tool || '',
		action: input.action || '',
		status: input.status || '',
		resultStatus: input.resultStatus || '',
		taskId: input.taskId || '',
		targetPaths,
		metadata: input.metadata || {},
	}).slice(0, 24)}`;
}

function appendAuditEvent(vaultRoot: string, input: AuditEventInput): AuditEventOutput {
	const audit = ensureAuditLog(vaultRoot);
	const eventName = input.type || 'tool-call';
	const eventType = input.event || eventName;
	const toolName = input.tool || '';
	const timestamp = input.timestamp || new Date().toISOString();
	const targetPaths = normalizeAuditTargets(input.targetPath ? [input.targetPath] : input.targetPaths || []);
	const operationId = input.operationId?.trim() || '';
	const auditEventId = buildAuditEventId(input, targetPaths);
	if (auditEventId) {
		const existing = fs.readFileSync(audit.absolute, 'utf8');
		const eventMarker = `- audit_event_id: ${sanitizeYamlValue(auditEventId)}`;
		if (existing.includes(eventMarker)) {
			return { path: audit.relative };
		}
	}

	const eventLines = [
		`## ${new Date().toISOString()} ${eventName}`,
		`- type: ${eventName}`,
		`- event: ${eventType}`,
	];

	if (timestamp) {
		eventLines.push(`- timestamp: ${sanitizeYamlValue(timestamp)}`);
	}
	if (operationId) {
		eventLines.push(`- operation_id: ${sanitizeYamlValue(operationId)}`);
	}
	if (auditEventId) {
		eventLines.push(`- audit_event_id: ${sanitizeYamlValue(auditEventId)}`);
	}
	if (input.agentId) {
		eventLines.push(`- agent_id: ${sanitizeYamlValue(input.agentId)}`);
	}
	if (input.principalId) {
		eventLines.push(`- principal_id: ${sanitizeYamlValue(input.principalId)}`);
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

async function appendAuditEventAsync(
	vaultRoot: string,
	input: AuditEventInput,
	context: ToolContext
): Promise<AuditEventOutput> {
	const eventName = input.type || 'tool-call';
	const eventType = input.event || eventName;
	const toolName = input.tool || '';
	const timestamp = input.timestamp || new Date().toISOString();
	const targetPaths = normalizeAuditTargets(input.targetPath ? [input.targetPath] : input.targetPaths || []);
	const operationId = input.operationId?.trim() || '';
	const auditEventId = buildAuditEventId(input, targetPaths);
	const safeAuditPath = normalizeNotePath(AUDIT_LOG_PATH);

	const eventLines = [
		`## ${new Date().toISOString()} ${eventName}`,
		`- type: ${eventName}`,
		`- event: ${eventType}`,
	];

	if (timestamp) {
		eventLines.push(`- timestamp: ${sanitizeYamlValue(timestamp)}`);
	}
	if (operationId) {
		eventLines.push(`- operation_id: ${sanitizeYamlValue(operationId)}`);
	}
	if (auditEventId) {
		eventLines.push(`- audit_event_id: ${sanitizeYamlValue(auditEventId)}`);
	}
	if (input.agentId) {
		eventLines.push(`- agent_id: ${sanitizeYamlValue(input.agentId)}`);
	}
	if (input.principalId) {
		eventLines.push(`- principal_id: ${sanitizeYamlValue(input.principalId)}`);
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

	const newEntry = `${eventLines.join('\n')}\n\n`;
	if (context.vaultRepository) {
		await withRepositoryAuditLock(context.vaultRepository, async () => {
			const eventMarker = auditEventId
				? `- audit_event_id: ${sanitizeYamlValue(auditEventId)}`
				: '';
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const existing = await context.vaultRepository!.readText(safeAuditPath);
				if (eventMarker && existing?.content.includes(eventMarker)) {
					return;
				}
				const current = existing ? existing.content : '# Audit Log\n\n';
				try {
					if (existing) {
						await context.vaultRepository!.replaceText(safeAuditPath, existing.version, `${current}${newEntry}`);
					} else {
						await context.vaultRepository!.createText(safeAuditPath, `${current}${newEntry}`);
					}
					return;
				} catch (error) {
					if (!(error instanceof OperationConflictError) || attempt === 2) {
						throw error;
					}
				}
			}
		});
		return { path: safeAuditPath };
	}

	const audit = ensureAuditLog(vaultRoot);
	if (auditEventId) {
		const existing = fs.readFileSync(audit.absolute, 'utf8');
		const eventMarker = `- audit_event_id: ${sanitizeYamlValue(auditEventId)}`;
		if (existing.includes(eventMarker)) {
			return { path: audit.relative };
		}
	}
	fs.appendFileSync(audit.absolute, `${eventLines.join('\n')}\n\n`);
	return { path: audit.relative };
}

const repositoryAuditLocks = new WeakMap<VaultRepository, Promise<void>>();

async function withRepositoryAuditLock<T>(repository: VaultRepository, execute: () => Promise<T>): Promise<T> {
	const previous = repositoryAuditLocks.get(repository) || Promise.resolve();
	let release: () => void = () => undefined;
	const next = new Promise<void>((resolve) => {
		release = resolve;
	});
	const chain = previous.catch(() => undefined).then(() => next);
	repositoryAuditLocks.set(repository, chain);

	await previous.catch(() => undefined);
	try {
		return await execute();
	} finally {
		release();
		if (repositoryAuditLocks.get(repository) === chain) {
			repositoryAuditLocks.delete(repository);
		}
	}
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

type ToolInvocationHandler = (
	(rawArgs: Record<string, unknown>, context: ToolInvocationContext) => unknown | Promise<unknown>
);

const TOOL_HANDLERS: Record<ToolName, ToolInvocationHandler> = {
	'tracekeeper.status': (rawArgs, context) => handleStatus(rawArgs as StatusArgs, context),
	'tracekeeper.graph_health': (rawArgs, context) => handleGraphHealth(rawArgs as GraphHealthArgs, context),
	'tracekeeper.start_task': (rawArgs, context) => handleStartTask(rawArgs as StartTaskArgs, context),
	'tracekeeper.recall': (rawArgs, context) => handleRecall(rawArgs as RecallArgs, context),
	'tracekeeper.read_note': (rawArgs, context) => handleReadNote(rawArgs as ReadNoteArgs, context),
	'tracekeeper.review_queue': (rawArgs, context) => handleReviewQueueUnified(rawArgs as ReviewQueueArgs, context),
	'tracekeeper.project_context': (rawArgs, context) => handleProjectContext(rawArgs as ProjectContextArgs, context),
	'tracekeeper.project_history': (rawArgs, context) => handleProjectHistory(rawArgs as ProjectHistoryArgs, context),
	'tracekeeper.list_review_queue': (rawArgs, context) => handleReviewQueue(rawArgs as ListReviewQueueArgs, context),
	'tracekeeper.list_source_requests': (rawArgs, context) => handleListSourceRequests(rawArgs as ListSourceRequestsArgs, context),
	'tracekeeper.list_approved_writebacks': (rawArgs, context) =>
		handleListApprovedWritebacks(rawArgs as ListApprovedWritebacksArgs, context),
	'tracekeeper.audit_recent': (rawArgs, context) => handleAuditRecent(rawArgs as AuditRecentArgs, context),
	'tracekeeper.source_request': (rawArgs, context) => handleSourceRequest(rawArgs as SourceRequestArgs, context),
	'tracekeeper.analyze_source_request': (rawArgs, context) =>
		handleAnalyzeSourceRequest(rawArgs as AnalyzeSourceRequestArgs, context),
	'tracekeeper.apply_approved_writeback': (rawArgs, context) =>
		handleApplyApprovedWriteback(rawArgs as ApplyApprovedWritebackArgs, context),
	'tracekeeper.build_context_pack': (rawArgs, context) =>
		handleBuildContextPack(rawArgs as BuildContextPackArgs, context),
	'tracekeeper.lint': (rawArgs, context) => handleLint(rawArgs as LintArgs, context),
	'tracekeeper.finish_task': (rawArgs, context) => handleFinishTask(rawArgs as FinishTaskArgs, context),
	'tracekeeper.distill_session': (rawArgs, context) => handleDistillSession(rawArgs as DistillSessionArgs, context),
	'tracekeeper.write_context_pack': (rawArgs, context) =>
		handleWriteContextPack(rawArgs as WriteContextPackArgs, context),
	'tracekeeper.write_session_note': (rawArgs, context) =>
		handleWriteSessionNote(rawArgs as WriteSessionNoteArgs, context),
	'tracekeeper.capture_source': (rawArgs, context) => handleCaptureSource(rawArgs as CaptureSourceArgs, context),
	'tracekeeper.propose_memory': (rawArgs, context) => handleProposeMemory(rawArgs as ProposeMemoryArgs, context),
} satisfies Record<ToolName, ToolInvocationHandler>;

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
		principalId: input.principalId,
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
			result_summary: input.resultSummary,
			...input.workflowMetadata,
		},
	});
}

async function recordToolCallAuditEventAsync(
	vaultRoot: string,
	input: ToolCallAuditEventInput,
	context: ToolContext
): Promise<{ path: string }> {
	if (!context.vaultRepository) {
		return recordToolCallAuditEvent(vaultRoot, input);
	}

	const now = new Date().toISOString();
	return appendAuditEventAsync(vaultRoot, {
		type: 'tool-call',
		event: 'tool-call',
		action: 'tool-call',
		actor: input.agentId,
		timestamp: now,
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
			result_summary: input.resultSummary,
			...input.workflowMetadata,
		},
	}, context);
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

export function toolDefinitions(capabilities?: readonly string[]): McpToolDefinition[] {
	const definitions: McpToolDefinition[] = [];
	for (const toolName of PUBLIC_TOOL_NAME_ORDER) {
		const contract = TOOL_CONTRACT_BY_NAME.get(toolName);
		if (!contract || contract.visibility !== 'public') {
			throw new Error(`Missing public tool contract or visibility for ${toolName}`);
		}
		if (
			capabilities &&
			!capabilities.includes('*') &&
			!capabilities.includes(contract.capability)
		) {
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

export function toolPrompts(): McpPrompt[] {
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

export async function callTool(
	name: string,
	rawParams: unknown,
	context: ToolInvocationContext = {}
): Promise<McpStructuredToolResult> {
	const requestName = typeof name === 'string' ? name.trim() : '';
	if (!requestName) {
		return toolError('Tool name is required.');
	}
	if (!isToolName(requestName)) {
		return toolError(`Unknown tool: ${requestName}`);
	}
	if (!isRecord(rawParams)) {
		return validateToolResult(
			requestName,
			decorateToolResult(requestName, toolError('Tool arguments must be an object.'), context)
		);
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
		const contract = getContractByName(requestName);
		const capabilities = context.credentialCapabilities;
		if (
			contract &&
			(
				!capabilities ||
				(!capabilities.includes('*') && !capabilities.includes(contract.capability))
			)
		) {
			throw new ToolInputError(
				`Credential principal ${context.principalId || 'unknown'} lacks capability ${contract.capability} for ${requestName}.`
			);
		}
		const handler = TOOL_HANDLERS[requestName];
		const result = await handler(args, context);
		toolResult = toolResultWithError(result);
		toolResult = markDeprecatedToolResult(requestName, toolResult);
		toolResult = decorateToolResult(requestName, toolResult, context);
		status = isToolResultFailure(toolResult) ? 'failed' : 'success';
		toolResult = validateToolResult(requestName, toolResult);
	} catch (error) {
		if (error instanceof ToolInputError || error instanceof VaultPathError) {
			toolResult = toolError(error.message);
		} else if (error instanceof Error) {
			toolResult = toolError(error.message);
		} else {
			toolResult = toolError(toErrorMessage(error));
		}
		toolResult = decorateToolResult(requestName, toolResult, context);
		toolResult = validateToolResult(requestName, toolResult);
		status = 'failed';
	} finally {
		if (auditVaultRoot) {
			try {
				await recordToolCallAuditEventAsync(auditVaultRoot, {
					toolName,
					resultStatus: status,
					targetPaths: collectAuditTargetsFromResult(requestName, args, toolResult.structuredContent),
					durationMs: Date.now() - startTime,
					riskLevel: getToolRiskLevel(requestName),
					agentId,
					principalId: context.principalId,
					sessionId,
					clientName,
					transport: context.transport,
					runtimeVersion: context.runtimeVersion,
					argsSummary,
					resultSummary: summarizeToolPayload(
						toolResult.structuredContent,
						isToolResultFailure(toolResult)
					),
					workflowMetadata: buildWorkflowAuditMetadata(
						toolName,
						args,
						toolResult.structuredContent
					),
				}, context);
			} catch {
				// Tool-call audit writes are best effort.
			}
		}
	}

	return toolResult;
}

export interface OperationRecoveryReport {
	recovered: string[];
	failed: Array<{ operation_id: string; error: string }>;
	skipped: string[];
}

export async function recoverPendingOperations(
	vaultRoot: string,
	context: ToolInvocationContext = {}
): Promise<OperationRecoveryReport> {
	const journal = operationJournalForVault(vaultRoot);
	const records = await journal.listRecoverable();
	const report: OperationRecoveryReport = { recovered: [], failed: [], skipped: [] };

	for (const record of records) {
		const request = recoveryRequestForRecord(record);
		if (!request) {
			report.skipped.push(record.operation_id);
			continue;
		}
		const result = await callTool(request.tool, request.args, {
			...context,
			defaultVaultRoot: vaultRoot,
			principalId: context.principalId || 'runtime-recovery',
			credentialCapabilities: context.credentialCapabilities || ['*'],
			agentId: context.agentId || 'tracekeeper-recovery',
			clientName: context.clientName || 'tracekeeper-runtime-recovery',
			transport: context.transport || 'runtime-recovery',
		});
		if (result.isError) {
			const structured = result.structuredContent;
			report.failed.push({
				operation_id: record.operation_id,
				error: isRecord(structured) && typeof structured.error === 'string'
					? structured.error
					: 'Operation recovery failed.',
			});
			continue;
		}
		report.recovered.push(record.operation_id);
	}

	return report;
}

function recoveryRequestForRecord(
	record: OperationRecord
): { tool: TracekeeperToolName; args: Record<string, unknown> } | null {
	if (!isRecord(record.payload)) {
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
		if (isRecord(payload.requestSnapshot)) {
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

function toolResultWithError<T>(value: T): McpStructuredToolResult {
	return toolResult(value);
}

function markDeprecatedToolResult(toolName: string, result: McpStructuredToolResult): McpStructuredToolResult {
	const replacement = DEPRECATED_TOOL_REPLACEMENTS[toolName];
	if (!replacement || result.isError || !isRecord(result.structuredContent)) {
		return result;
	}
	return toolResult({
		...result.structuredContent,
		deprecated: true,
		replacement_tool: replacement,
	});
}

function buildRecommendedRecall(
	goal: string,
	identity: ResolvedProjectIdentity,
	context: ToolContext
): Record<string, unknown> {
	const hasResolvedProject = hasProjectScope(identity) && identity.confidence !== 'uncertain';
	const scope: RecallScope = hasResolvedProject ? 'project' : 'global';
	const args: Record<string, unknown> = {
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

function buildCloseoutContract(context: ToolContext): Record<string, unknown> {
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

function buildStartTaskNextActions(identity: ResolvedProjectIdentity, context: ToolContext): string[] {
	const actions = [
		contentText(context, '读取单篇笔记前，先调用 tracekeeper.recall。', 'Call tracekeeper.recall before reading individual notes.'),
		contentText(context, '只有召回摘要不够时，再使用 tracekeeper.read_note。', 'Use tracekeeper.read_note only when a recall excerpt is not enough.'),
		contentText(context, '任务结束时调用一次 tracekeeper.finish_task，提交决策、方案调整、经验、偏好、下一步和记忆候选。', 'Call tracekeeper.finish_task once at the end with decisions, solution changes, lessons, preferences, next actions, and memory candidates.'),
	];
	if (hasProjectScope(identity) && identity.confidence !== 'uncertain') {
		actions.unshift(contentText(context, '使用相同 project_hint 和 scope="project" 做定向召回。', 'Use scope="project" with the same project_hint for targeted recall.'));
		actions.splice(2, 0, contentText(context, '需要承接历史任务时，使用 scope="project_history"。', 'Use scope="project_history" when continuity from earlier sessions is needed.'));
	} else if (identity.confidence === 'uncertain' && identity.warnings.length > 0) {
		actions.unshift(contentText(context, '项目身份尚未确认；先使用全局召回并让用户确认项目，不要静默选择。', 'Project identity is unresolved; use global recall and ask the user to confirm the project instead of choosing silently.'));
	}
	return actions;
}

function handleStatus(rawArgs: StatusArgs, context: ToolContext) {
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
		...scanProvenance(scan),
		...graphHealth,
	};
}

function operationJournalForVault(vaultRoot: string): NodeFileOperationJournal {
	const operationDirectory = path.resolve(vaultRoot, TRACEKEEPER_OPERATIONS_DIR);
	relativeFromAbsolute(vaultRoot, operationDirectory);
	assertNoSymlinkSegments(vaultRoot, operationDirectory);
	return new NodeFileOperationJournal({ directory: operationDirectory });
}

function buildToolOperationIdentity(
	tool: 'start-task' | 'finish-task' | 'capture-source' | 'propose-memory',
	rawIdempotencyKey: unknown,
	payload: Record<string, unknown>,
	context: ToolInvocationContext
): { operationId: string; idempotencyKey: string } {
	const providedKey = coerceOptionalString(rawIdempotencyKey);
	if (providedKey.length > 512) {
		throw new ToolInputError('idempotency_key must be at most 512 characters.');
	}
	const payloadHash = computePayloadHash(payload);
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

async function handleStartTask(rawArgs: StartTaskArgs, context: ToolInvocationContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const goal = coerceNonEmptyString(rawArgs.goal, true, 'goal');
	const client = coerceNonEmptyString(rawArgs.client);
	const scan = scanVaultForContext(vaultRoot, context);
	const projectIdentity = resolveProjectIdentity(rawArgs, scan.notes);
	const projectHint = projectIdentity.projectHint;
	if (goal.length < 3) {
		throw new ToolInputError('goal must have at least 3 characters.');
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
	const runner = new RecoverableOperationRunner({
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
				ok: true as const,
				read_only: false as const,
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
				project_identity: projectIdentityToResult(projectIdentity),
			};
		},
	});

	return runner.run();
}

function handleRecall(rawArgs: RecallArgs, context: ToolContext) {
	const scope = coerceRecallScope(rawArgs.scope);
	if (scope === 'project') {
		const result = handleProjectContext(rawArgs, context);
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
	const rawMatches = recallNotes(scan.notes, query, { limit: recallCandidateLimit(maxItems) });
	const matches = selectRecallMatches(
		rankRecallMatches(rawMatches, query, {
			projectHint: '',
			projectId: '',
			repoPath: '',
			source: 'unknown',
			confidence: 'uncertain',
			warnings: [],
		}),
		maxItems
	);

	return {
		ok: true,
		read_only: true,
		scope_mode: scope,
		query,
		vault_root: vaultRoot,
		max_items: maxItems,
		matched_count: matches.length,
		...scanProvenance(scan),
		matches: matches.map((match) => buildRecallEntry(match, scope, scan.notes)),
	};
}

async function handleReadNote(rawArgs: ReadNoteArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const notePath = coerceNonEmptyString(rawArgs.path, true, 'path');
	const recallId = coerceOptionalString(rawArgs.recall_id);
	const safePath = relativeFromAbsolute(
		vaultRoot,
		resolveSafeNotePath(vaultRoot, notePath, pathSafetyOptions(context))
	);
	let data: { path: string; text: string };
	if (context.vaultRepository) {
		const repositoryFile = await context.vaultRepository.readText(safePath);
		if (!repositoryFile) {
			throw new ToolInputError(`Note does not exist: ${safePath}`);
		}
		data = { path: repositoryFile.path, text: repositoryFile.content };
	} else {
		data = safeReadNote(vaultRoot, safePath, context);
	}
	const parsed = parseMarkdown(data.text);
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
		content_origin: recallContentOrigin(
			data.path,
			typeof parsed.frontmatter.fields.type === 'string' ? parsed.frontmatter.fields.type : undefined
		),
		instruction_trust: 'data_only',
		content: data.text,
		excerpt: parsed.body.slice(0, 1024),
		relation_evidence: scannedNote
			? buildRecallRelationEvidence(scannedNote, scan.notes)
			: { related_wiki: [], related_sources: [] },
	};
}

function handleProjectContext(rawArgs: ProjectContextArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const query = coerceNonEmptyString(rawArgs.query, true, 'query');
	const maxItems = coercePositiveInt(rawArgs.max_items, MAX_PROJECT_TOOL_ITEMS, 1, MAX_PROJECT_TOOL_ITEMS);
	const scan = scanVaultForContext(vaultRoot, context);
	const scope = coerceProjectScope(rawArgs, scan.notes);
	const unresolved = scope.confidence === 'uncertain';
	const scopedNotes = unresolved
		? scan.notes
		: filterNotesByProjectScopeWithSessions(scan.notes, scope);
	const candidateLimit = recallCandidateLimit(maxItems);
	const initialMatches = recallNotes(scopedNotes, query, { limit: candidateLimit });
	const anchoredMatches = unresolved
		? initialMatches
		: [
			...initialMatches,
			...buildProjectMemoryAnchors(
				scopedNotes,
				new Set(initialMatches.map((match) => match.note.relativePath))
			),
		];
	const fallbackToGlobal = unresolved && anchoredMatches.length === 0;
	const finalScope = fallbackToGlobal ? resolveProjectIdentity({}, scan.notes) : scope;
	const finalScopeMode = fallbackToGlobal ? 'global' : 'project';
	const finalRawMatches = fallbackToGlobal
		? recallNotes(scan.notes, query, { limit: candidateLimit })
		: anchoredMatches;
	const matches = selectRecallMatches(
		rankRecallMatches(finalRawMatches, query, finalScope),
		maxItems
	);
	const uncertain = !hasProjectScope(scope) || scope.confidence === 'uncertain' || fallbackToGlobal;
	const candidateNotes = collectProjectCandidates(scopedNotes, scope, MAX_PROJECT_SCOPE_CANDIDATES);
	const scopeEvidence = buildProjectRecallRelationEvidence(scope, fallbackToGlobal);
	const scopeMetadata = fallbackToGlobal
		? buildProjectScopeMetadata(resolveProjectIdentity({}, scan.notes))
		: buildProjectScopeMetadata(scope);

	return {
		ok: true,
		read_only: true,
		vault_root: vaultRoot,
		query,
		uncertain: uncertain,
		scope: scopeMetadata,
		project_identity: projectIdentityToResult(scope),
		max_items: maxItems,
		matched_count: matches.length,
		...scanProvenance(scan),
		candidates: candidateNotes.map((candidate) => candidate.path),
		candidate_notes: candidateNotes,
		scope_evidence: scopeEvidence,
		scope_mode: finalScopeMode,
		entries: matches.map((match) => buildRecallEntry(match, finalScopeMode, scan.notes)),
	};
}

function handleProjectHistory(rawArgs: ProjectHistoryArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const query = coerceOptionalString(rawArgs.query);
	const maxItems = coercePositiveInt(rawArgs.max_items, MAX_PROJECT_TOOL_ITEMS, 1, MAX_PROJECT_TOOL_ITEMS);
	const scan = scanVaultForContext(vaultRoot, context);
	const scope = coerceProjectScope(rawArgs, scan.notes);
	const unresolved = scope.confidence === 'uncertain';
	const scopedNotes = unresolved
		? scan.notes
		: filterNotesByProjectScopeWithSessions(scan.notes, scope);
	const uncertain = !hasProjectScope(scope) || scope.confidence === 'uncertain';
	const filteredByQuery = query ? scopedNotes.filter((note) => matchesProjectQuery(note, query)) : scopedNotes;
	const sortedMatches = filteredByQuery
		.filter((note) => note.relativePath !== '')
		.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
	const candidateNotes = collectProjectCandidates(scopedNotes, scope, MAX_PROJECT_SCOPE_CANDIDATES);
	const matches = sortedMatches.slice(0, maxItems);

	return {
		ok: true,
		read_only: true,
		vault_root: vaultRoot,
		query: query || null,
		uncertain: uncertain,
		scope: buildProjectScopeMetadata(scope),
		project_identity: projectIdentityToResult(scope),
		max_items: maxItems,
		matched_count: matches.length,
		total_matches: sortedMatches.length,
		...scanProvenance(scan),
		candidates: candidateNotes.map((candidate) => candidate.path),
		candidate_notes: candidateNotes,
		entries: buildProjectHistoryEntries(matches, query, scan.notes),
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

async function resolveSourceInput(
	request: SourceRequestRecord,
	vaultRoot: string,
	context: ToolContext
): Promise<{ sourceText: string; mode: 'external_reference' | 'local_copy' | 'extracted_snapshot'; resolvedSourcePath?: string; warnings: string[] }> {
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
			const fileText = await safeReadTextFileAsync(vaultRoot, parsedPath.requestedPath, context);
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
	context: ToolContext,
	resolvedSourcePath?: string,
): string {
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

function buildReportContent(
	request: SourceRequestRecord,
	mode: 'external_reference' | 'local_copy' | 'extracted_snapshot',
	sourceText: string,
	analysis: SourceAnalysisResult,
	sourceNotePath: string,
	warnings: string[],
	context: ToolContext,
): string {
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

async function handleAnalyzeSourceRequest(
	rawArgs: AnalyzeSourceRequestArgs,
	context: ToolContext,
	sourceToolName = 'tracekeeper.analyze_source_request'
) {
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
		const request = await readSourceRequestAsync(vaultRoot, requestPathAlias, context);
		const taskId = coerceOptionalString(rawArgs.task_id) || request.taskId || null;
		if (!request.type.toLowerCase().includes('agent-request')) {
			throw new ToolInputError('Request note is not an agent-request note.');
		}
		if (!forceReprocess && request.status && !isSourceRequestPending(request.status)) {
			throw new ToolInputError(`Request status is ${request.status}; use force_reprocess=true to process anyway.`);
		}

		const { sourceText, mode, resolvedSourcePath, warnings } = await resolveSourceInput(request, vaultRoot, context);
		const analysis = analyzeSourceText({
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
		const sourceNote = await buildAndWriteNoteAsync(
			vaultRoot,
			sourceToolName,
			SOURCES_DIR,
			sourceFilename,
			{
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
			},
			buildSourceNoteContent(request, mode, sourceText, analysis, context, resolvedSourcePath),
			taskId,
			context,
			{ target_type: 'source', mode, request_path: request.path }
		);

		const reportFilename = buildSafeFilename(`${runToken}-report`, 'source-report', context);
		const report = await buildAndWriteNoteAsync(
			vaultRoot,
			sourceToolName,
			SOURCE_ANALYSIS_REPORT_DIR,
			reportFilename,
			{
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
			},
			buildReportContent(request, mode, sourceText, analysis, sourceNote.path, warnings, context),
			taskId,
			context,
			{ target_type: 'source_analysis_report', request_path: request.path }
		);

		const proposalPaths: string[] = [];
		for (const entry of analysis.proposalDrafts) {
			const proposalNote = await buildAndWriteNoteAsync(
				vaultRoot,
				sourceToolName,
				MEMORY_PROPOSAL_DIR,
				buildSafeFilename(`proposal-${runToken}-${entry.proposalKind}`, entry.proposalKind, context),
				{
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
				},
				`${contentText(context, '## 来源分析提案', '## Source analysis proposal')}\n\n- evidence: ${entry.evidence}\n\n${contentText(context, '## 写回内容', '## Writeback')}\n${entry.content}\n`,
				taskId,
				context,
				{
					target_type: 'memory_proposal',
					proposal_kind: entry.proposalKind,
					request_path: request.path,
					source_note: sourceNote.path,
				}
			);
			proposalPaths.push(proposalNote.path);
		}
		let auditPathForReturn = sourceNote.audit_path;

		if (updateStatus) {
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
					proposals: proposalPaths.join(','),
				},
			}, context)).path;
		}
		await updateAgentTaskRecordAsync(vaultRoot, taskId, {}, context, {
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
			proposals: proposalPaths.map((proposalPath: string) => ({ path: proposalPath })),
			audit_path: auditPathForReturn,
			summary: analysis.summary,
			warnings,
		};
	} catch (error) {
		if (updateStatus) {
			try {
				await updateRequestStatusAsync(vaultRoot, requestPathAlias, 'failed', context);
				await appendAuditEventAsync(vaultRoot, {
					tool: sourceToolName,
					targetPath: requestPathAlias,
					status: 'failed',
					taskId: coerceOptionalString(rawArgs.task_id) || null,
					metadata: {
						action: 'source.request.failed',
						error: toErrorMessage(error),
					},
				}, context);
			} catch {
				// audit and state update are best-effort; keep original error handling path.
			}
		}
		throw error;
	}
}

function handleReviewQueueUnified(rawArgs: ReviewQueueArgs, context: ToolContext) {
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

async function handleSourceRequest(rawArgs: SourceRequestArgs, context: ToolContext) {
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

function buildApprovedWritebackOperationIdentity(proposal: MemoryProposalDocument): {
	operationId: string;
	idempotencyKey: string;
} {
	const identity = crypto
		.createHash('sha256')
		.update(`${proposal.path}\0${proposal.proposalId}`)
		.digest('hex')
		.slice(0, 24);
	return {
		operationId: `writeback-${identity}`,
		idempotencyKey: `apply-approved-writeback:${proposal.path}:${proposal.proposalId}`,
	};
}

async function handleApplyApprovedWriteback(rawArgs: ApplyApprovedWritebackArgs, context: ToolInvocationContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const dryRun = coerceBoolean(rawArgs.dry_run, 'dry_run', false);
	const proposal = resolveMemoryProposalFromArgs(vaultRoot, rawArgs, context);
	const taskId = coerceOptionalString(rawArgs.task_id) || proposal.taskId || null;
	const plan = buildWritebackPlan(proposal);

	if (!plan.targetNote || !plan.writebackContent) {
		throw new ToolInputError(plan.reason || 'approved writeback is not ready to apply.');
	}
	if (dryRun && !plan.ready) {
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
	const writebackMarker = `^writeback-${proposal.proposalId.replace(/[^A-Za-z0-9._-]/g, '-')}`;

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

	const identity = buildApprovedWritebackOperationIdentity(proposal);
	const operationDirectory = path.resolve(vaultRoot, TRACEKEEPER_OPERATIONS_DIR);
	relativeFromAbsolute(vaultRoot, operationDirectory);
	assertNoSymlinkSegments(vaultRoot, operationDirectory);
	const payload: ApplyApprovedWritebackPayload = {
		proposalId: proposal.proposalId,
		proposalPath: proposal.path,
		targetPath: targetRelative,
		taskId,
		writebackBlock,
		writebackMarker,
		auditPath: AUDIT_LOG_PATH,
	};
	const service = new ApplyApprovedWritebackService({
		journal: new NodeFileOperationJournal({ directory: operationDirectory }),
		failureInjection: context.operationFailureInjection,
		port: {
			async applyTarget(currentPayload) {
				if (context.vaultRepository) {
					const currentTarget = await context.vaultRepository.readText(currentPayload.targetPath);
					if (!currentTarget) {
						throw new ToolInputError(`Writeback target does not exist: ${currentPayload.targetPath}`);
					}
					if (currentTarget.content.includes(currentPayload.writebackBlock)) {
						return;
					}
					if (currentTarget.content.includes(currentPayload.writebackMarker)) {
						throw new OperationConflictError(
							`Writeback marker already exists with different content: ${currentPayload.writebackMarker}`
						);
					}
					const targetWithWriteback = `${currentTarget.content.replace(/\s*$/, '')}\n\n${currentPayload.writebackBlock}\n`;
					await context.vaultRepository.replaceText(
						currentPayload.targetPath,
						currentTarget.version,
						targetWithWriteback
					);
					return;
				}
				const currentTarget = fs.readFileSync(targetAbsolute, 'utf8');
				if (currentTarget.includes(currentPayload.writebackBlock)) {
					return;
				}
				if (currentTarget.includes(currentPayload.writebackMarker)) {
					throw new OperationConflictError(
						`Writeback marker already exists with different content: ${currentPayload.writebackMarker}`
					);
				}
				const targetWithWriteback = `${currentTarget.replace(/\s*$/, '')}\n\n${currentPayload.writebackBlock}\n`;
				replaceTextFileAtomically(targetAbsolute, targetWithWriteback, currentTarget);
			},
			async markProposalApplied(currentPayload, operationId) {
				if (context.vaultRepository) {
					const proposalFile = await context.vaultRepository.readText(currentPayload.proposalPath);
					if (!proposalFile) {
						throw new ToolInputError(`Writeback proposal does not exist: ${currentPayload.proposalPath}`);
					}
					const parsed = parseMarkdown(proposalFile.content);
					const currentOperationId = stripYamlQuotes(
						readFrontmatterString(parsed.frontmatter.fields, ['writeback_operation_id'])
					);
					if (currentOperationId && currentOperationId !== operationId) {
						throw new OperationConflictError(
							`Proposal is already associated with writeback operation ${currentOperationId}`
						);
					}
					const approvalStatus = readProposalApprovalStatus(parsed.frontmatter.fields);
					if (approvalStatus === 'applied') {
						if (currentOperationId === operationId) {
							return;
						}
						throw new OperationConflictError('Applied proposal is missing its matching writeback operation id.');
					}
					if (approvalStatus !== 'approved') {
						throw new ToolInputError(`proposal approval_status/status is ${approvalStatus}`);
					}
					const updatedProposal = updateFrontmatterFields(proposalFile.content, {
						approval_status: 'applied',
						status: 'applied',
						writeback_applied_at: new Date().toISOString(),
						writeback_target: currentPayload.targetPath,
						writeback_operation_id: operationId,
					});
					await context.vaultRepository.replaceText(
						currentPayload.proposalPath,
						proposalFile.version,
						updatedProposal
					);
					return;
				}
				const currentProposal = readMemoryProposal(vaultRoot, currentPayload.proposalPath, context);
				const currentOperationId = stripYamlQuotes(
					readFrontmatterString(currentProposal.frontmatter, ['writeback_operation_id'])
				);
				if (currentOperationId && currentOperationId !== operationId) {
					throw new OperationConflictError(
						`Proposal is already associated with writeback operation ${currentOperationId}`
					);
				}
				if (currentProposal.approvalStatus === 'applied') {
					if (currentOperationId === operationId) {
						return;
					}
					throw new OperationConflictError('Applied proposal is missing its matching writeback operation id.');
				}
				if (currentProposal.approvalStatus !== 'approved') {
					throw new ToolInputError(
						`proposal approval_status/status is ${currentProposal.approvalStatus}`
					);
				}
				const updatedProposal = updateFrontmatterFields(currentProposal.text, {
					approval_status: 'applied',
					status: 'applied',
					writeback_applied_at: new Date().toISOString(),
					writeback_target: currentPayload.targetPath,
					writeback_operation_id: operationId,
				});
				replaceTextFileAtomically(currentProposal.absolutePath, updatedProposal, currentProposal.text);
			},
			async linkTask(currentPayload) {
				await updateAgentTaskRecordAsync(vaultRoot, currentPayload.taskId, {}, context, {
					memory_writes: [currentPayload.targetPath],
					proposals: [currentPayload.proposalPath],
				});
			},
			async appendAudit(currentPayload, operationId) {
				await appendAuditEventAsync(vaultRoot, {
					operationId,
					tool: 'tracekeeper.apply_approved_writeback',
					targetPath: currentPayload.targetPath,
					status: 'written',
					taskId: currentPayload.taskId,
					agentId: context.agentId,
					sessionId: context.sessionId,
					clientName: context.clientName,
					metadata: {
						action: 'writeback.apply',
						proposal_id: currentPayload.proposalId,
						proposal_path: currentPayload.proposalPath,
						permission_level: 'review-gated apply',
					},
				}, context);
			},
		},
	});

	return service.execute({
		operationId: identity.operationId,
		idempotencyKey: identity.idempotencyKey,
		approvalStatus: proposal.approvalStatus,
		payload,
	});
}

async function handleAuditRecent(rawArgs: AuditRecentArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const maxItems = coercePositiveInt(rawArgs.max_items, MAX_AUDIT_ITEMS, 1, 100);
	let auditPath: string | null = AUDIT_LOG_PATH;
	let text = '';

	if (context.vaultRepository) {
		const repositoryFile = await context.vaultRepository.readText(AUDIT_LOG_PATH);
		if (repositoryFile) {
			auditPath = repositoryFile.path;
			text = repositoryFile.content;
		}
	} else {
		try {
			auditPath = resolveSafeNotePath(vaultRoot, AUDIT_LOG_PATH, pathSafetyOptions(context));
			text = fs.readFileSync(auditPath, 'utf8');
		} catch (error) {
			if (!(error instanceof ToolInputError || error instanceof VaultPathError)) {
				throw error;
			}
		}
	}

	const sections = text ? parseAuditSections(text) : [];
	const rel = context.vaultRepository
		? auditPath || AUDIT_LOG_PATH
		: auditPath ? relativeFromAbsolute(vaultRoot, auditPath) : AUDIT_LOG_PATH;

	return {
		ok: true,
		read_only: true,
		vault_root: vaultRoot,
		audit_log: rel,
		total_sections: sections.length,
		sections: sections.slice(0, maxItems),
	};
}

async function handleWriteContextPack(rawArgs: WriteContextPackArgs, context: ToolContext) {
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

	const note = await buildAndWriteNoteAsync(
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
	await updateAgentTaskRecordAsync(vaultRoot, taskId, {
		context_pack: note.path,
	}, context, {
		context_packs: [note.path],
	});

	return makeToolResultForWrite('tracekeeper.write_context_pack', note);
}

async function handleWriteSessionNote(rawArgs: WriteSessionNoteArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const content = coerceNonEmptyString(rawArgs.content, true, 'content');
	const filename = buildSafeFilename(rawArgs.filename, 'session', context);
	const taskId = coerceOptionalString(rawArgs.task_id) || null;
	const now = new Date().toISOString();
	assertNoSensitiveText([
		{ label: 'content', value: content },
	]);

	const note = await buildAndWriteNoteAsync(
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
	await updateAgentTaskRecordAsync(vaultRoot, taskId, {}, context, {
		memory_writes: [note.path],
	});

	return makeToolResultForWrite('tracekeeper.write_session_note', note);
}

async function handleCaptureSource(rawArgs: CaptureSourceArgs, context: ToolInvocationContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const requestHash = computePayloadHash({ ...rawArgs });
	const identity = buildToolOperationIdentity(
		'capture-source',
		rawArgs.idempotency_key,
		{ requestHash },
		context
	);
	const runner = new RecoverableOperationRunner({
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

async function handleCaptureSourceWrite(
	rawArgs: CaptureSourceArgs,
	context: ToolContext,
	identity: { operationId: string; idempotencyKey: string }
) {
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

	let body = `${contentText(context, '## 来源捕获', '## Source capture')}\n\n`;
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

	const existing = await findOperationOwnedNoteAsync(
		vaultRoot,
		SOURCES_DIR,
		filename,
		'source_operation_id',
		identity.operationId,
		context
	);
	const note = existing || await buildAndWriteNoteAsync(
		vaultRoot,
		'tracekeeper.capture_source',
		SOURCES_DIR,
		filename,
		{
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
		},
		body,
		taskId,
		context,
		{ target_type: 'source_capture', mode },
		identity.operationId
	);
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

async function handleProposeMemory(rawArgs: ProposeMemoryArgs, context: ToolInvocationContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const requestHash = computePayloadHash({ ...rawArgs });
	const identity = buildToolOperationIdentity(
		'propose-memory',
		rawArgs.idempotency_key,
		{ requestHash },
		context
	);
	const runner = new RecoverableOperationRunner({
		operationId: identity.operationId,
		idempotencyKey: identity.idempotencyKey,
		payload: { request_hash: requestHash },
		journal: operationJournalForVault(vaultRoot),
		failureInjection: context.operationFailureInjection,
		steps: [],
		finalize: () => handleProposeMemoryWrite(rawArgs, context, identity),
	});
	return runner.run();
}

async function handleProposeMemoryWrite(
	rawArgs: ProposeMemoryArgs,
	context: ToolContext,
	identity: { operationId: string; idempotencyKey: string }
) {
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
	const memoryScope = resolveMemoryScope(proposalKind, targetNote, projectHint, rawArgs.memory_scope);
	const relatedWiki = normalizeMultiValueList(rawArgs.related_wiki, 'related_wiki');
	const relatedSources = normalizeMultiValueList(rawArgs.related_sources, 'related_sources');
	const architectureStatus = buildArchitectureStatus(vaultRoot, context);
	const bridgeMetadata = resolveProjectMemoryBridgeMetadata(
		vaultRoot,
		memoryScope,
		projectHint,
		relatedWiki,
		relatedSources,
		context
	);
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
			? resolveAutoMemoryTarget(
				vaultRoot,
				proposalKind,
				targetNote,
				projectHint,
				context,
				memoryScope
			)
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
				proposal_path: null,
			};
		}
	}

	const body = [
		contentText(context, '## 记忆提案', '## Proposal'),
		`- status: pending`,
		`- proposal_kind: ${proposalKind}`,
		evidence ? `- evidence: ${evidence}` : '',
		targetNote ? `- target_note: ${targetNote}` : '',
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

	const existing = await findOperationOwnedNoteAsync(
		vaultRoot,
		MEMORY_PROPOSAL_DIR,
		filename,
		'proposal_operation_id',
		identity.operationId,
		context
	);
	const note = existing || await buildAndWriteNoteAsync(
		vaultRoot,
		'tracekeeper.propose_memory',
		MEMORY_PROPOSAL_DIR,
		filename,
		{
			tool: 'tracekeeper.propose_memory',
			type: 'memory_proposal',
			title: title || contentText(context, `记忆提案：${proposalKind}`, `Memory proposal: ${proposalKind}`),
			proposal_kind: proposalKind,
			status: 'pending',
			target_note: targetNote || null,
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
		},
		body,
		taskId,
		context,
		{
			target_type: 'memory_proposal',
			proposal_kind: proposalKind,
			risk_level: riskLevel || null,
		},
		identity.operationId
	);
	await updateAgentTaskRecordAsync(vaultRoot, taskId, {}, context, {
		proposals: [note.path],
	});
	const response: {
		ok: true;
		tool: string;
		operation_id: string;
		idempotency_key: string;
		status: string;
		path: string;
		audit_path: string;
		warnings: string[];
		auto_applied: boolean;
		duplicate: boolean;
		proposal_path: string;
		memory_rule: MemoryProposalRule;
		memory_scope: MemoryScope;
		project_hint: string | null;
		related_wiki: string[];
		related_sources: string[];
		architecture_status: ArchitectureStatus;
		missing_graph_bridges: string[];
		missing_wiki_bridge: boolean;
		missing_related_sources: string[];
	} = {
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
		proposal_path: note.path,
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

async function handleBuildContextPack(rawArgs: BuildContextPackArgs, context: ToolContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const query = coerceNonEmptyString(rawArgs.query, true, 'query');
	const taskId = coerceOptionalString(rawArgs.task_id);
	const candidateLimit = coercePositiveInt(rawArgs.candidate_limit, 8, 1, 120);
	const staleAfterDays = coercePositiveInt(rawArgs.stale_after_days, 180, 1, 3650);
	const shouldWrite = coerceBoolean(rawArgs.write, 'write', false);
	const title = coerceOptionalString(rawArgs.title);
	const baseScan = scanVaultForContext(vaultRoot, context);
	const explicitScope = coerceProjectScope(rawArgs, baseScan.notes);
	let scopeForContextPack: ProjectScopeFilter = explicitScope;
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
			project_identity: projectIdentityToResult(scopeForContextPack),
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
		...contextPack.relevantNotes.map(
			(entry) =>
				`- ${entry.relativePath} | score: ${entry.score} | title: ${entry.title}`
		),
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

	const note = await buildAndWriteNoteAsync(
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
		project_identity: projectIdentityToResult(scopeForContextPack),
		query,
		...scanProvenance(scan),
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
	const lintGraphHealth = graphHealth
		? {
			disabled: profileEvaluation.disabled,
			profile: profileEvaluation.profile,
			profile_issues: profileEvaluation.profile_issues,
			...graphHealth,
		}
		: null;
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
		...scanProvenance(scan),
		issue_count: issues.length,
		issues: limitedIssues,
		graph_summary: graphHealth ? buildGraphSummary(graphHealth) : null,
		graph_health: lintGraphHealth,
		legacy_structure: buildLegacyStructureSummary(vaultRoot, scan.notes),
		fix_plan_summary: buildFixPlanSummary(issues),
	};
}

function buildLegacyStructureSummary(vaultRoot: string, notes: ScannedNote[]): Record<string, unknown> {
	const legacyRoots = LEGACY_TOP_LEVEL_DIRS.filter((root) => fs.existsSync(path.join(vaultRoot, root)));
	const legacyNoteCount = notes.filter((note) =>
		legacyRoots.some((root) => note.relativePath === root || note.relativePath.startsWith(`${root}/`))
	).length;
	return {
		detected: legacyRoots.length > 0,
		legacy_roots: legacyRoots,
		legacy_note_count: legacyNoteCount,
		recommendation: legacyRoots.length > 0
			? 'Use the Obsidian plugin structure check to preview, rebuild, validate, and trash legacy folders after explicit user confirmation. MCP lint is read-only and will not migrate or delete folders.'
			: 'No legacy Tracekeeper top-level folders detected.',
	};
}

function buildGraphSummary(graphHealth: GraphHealthReport): Record<string, unknown> {
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

function buildSessionNoteBody(context: ToolContext, summary: string, outcomes: string[], nextActions: string[]): string {
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

function buildSessionNoteBodyWithCloseout(
	context: ToolContext,
	summary: string,
	outcomes: string[],
	nextActions: string[],
	decisions: string[],
	solutionChanges: string[],
	lessons: string[],
	preferences: string[],
	memoryCandidates: string[],
): string {
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

function buildFinishTaskNextActions(
	context: ToolContext,
	reviewProposalMode: ReviewProposalMode,
	proposalResult: FinishTaskProposalResult,
	projectHint: string,
	hasCloseoutCandidates: boolean
): string[] {
	const actions: string[] = [];
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
			actions.push(contentText(context, '项目记忆已按用户规则追加保存。', 'Project memory was auto-saved as append-only project memory according to the user rule.'));
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

function hasFinishTaskCloseoutCandidates(input: {
	decisions: string[];
	solutionChanges: string[];
	lessons: string[];
	preferences: string[];
	nextActions: string[];
	memoryCandidates: string[];
}): boolean {
	return [
		input.decisions,
		input.solutionChanges,
		input.lessons,
		input.preferences,
		input.nextActions,
		input.memoryCandidates,
	].some((values) => values.length > 0);
}

function resolveMemoryCloseoutStatus(
	reviewProposalMode: ReviewProposalMode,
	proposalResult: FinishTaskProposalResult,
	hasCloseoutCandidates: boolean
): LegacyMemoryCloseoutStatus {
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

function buildMemoryCloseoutSummary(
	context: ToolContext,
	status: LegacyMemoryCloseoutStatus,
	proposalResult: FinishTaskProposalResult
): string {
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

function resolveCanonicalMemoryCloseoutStatus(
	reviewProposalMode: ReviewProposalMode,
	proposalResult: FinishTaskProposalResult,
	hasCloseoutCandidates: boolean,
	legacyStatus: LegacyMemoryCloseoutStatus
): MemoryCloseoutStatus {
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

function buildSessionNoteBodyWithDistill(
	context: ToolContext,
	summary: string,
	outcomes: string[],
	nextActions: string[],
	decisions: string[],
	possiblePreferences: string[],
): string {
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

async function createDistillProposal(
	vaultRoot: string,
	taskId: string,
	proposalKind: string,
	kindLabel: string,
	contentItems: string[],
	projectHint: string,
	context: ToolContext
): Promise<{ path: string }> {
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
	const filenameToken = `${proposalKind}-${taskId}-${now.replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
	const proposal = await buildAndWriteNoteAsync(
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
			project_hint: projectHint || null,
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

interface FinishTaskOperationPayload {
	requestHash?: string;
	requestSnapshot?: ReturnType<typeof buildFinishTaskRequestSnapshot>;
	taskId: string;
	summary: string;
	outcomes: string[];
	nextActions: string[];
	decisions: string[];
	solutionChanges: string[];
	lessons: string[];
	preferences: string[];
	memoryCandidates: string[];
	projectIdentity?: ResolvedProjectIdentity;
	projectId: string;
	repoPath: string;
	reviewProposalMode: ReviewProposalMode;
	client: string;
	projectHint: string;
	memoryScope: unknown;
	relatedWiki: string[];
	relatedSources: string[];
	rawRelatedWiki?: string[];
	rawRelatedSources?: string[];
	missingWikiBridge?: boolean;
	missingRelatedSources?: string[];
	filename: string;
	vaultRoot: string;
	architectureStatus: ArchitectureStatusReport;
	closeoutGroups: FinishTaskCloseoutGroup[];
	hasCloseoutCandidates: boolean;
	contentLanguage: ContentLanguage;
}

function isFinishTaskOperationPayload(payload: unknown): payload is FinishTaskOperationPayload {
	if (!isRecord(payload)) {
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
	if (!isRecord(payload.requestSnapshot) || typeof payload.requestSnapshot.task_id !== 'string') {
		return false;
	}
	return true;
}

function projectIdentityFromFinishPayload(input: FinishTaskOperationPayload): ResolvedProjectIdentity {
	return input.projectIdentity ?? {
		projectHint: input.projectHint,
		projectId: input.projectId || '',
		repoPath: input.repoPath || '',
		source: 'task_metadata',
		confidence: input.projectHint || input.projectId || input.repoPath ? 'derived' : 'uncertain',
		warnings: ['legacy_finish_payload_without_project_identity'],
	};
}

function buildFinishTaskRequestSnapshot(rawArgs: FinishTaskArgs) {
	const explicitIdentity = resolveProjectIdentity(rawArgs);
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

async function buildFinishTaskOperationPayload(
	rawArgs: FinishTaskArgs,
	context: ToolInvocationContext,
	operationId: string,
	requestHash: string,
	requestSnapshot: ReturnType<typeof buildFinishTaskRequestSnapshot>
): Promise<FinishTaskOperationPayload> {
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
	const reviewProposalMode = coerceReviewProposalMode(
		rawArgs.review_proposal_mode,
		defaultReviewProposalMode(context)
	);
	const taskMetadata = await readAgentTaskMetadataAsync(vaultRoot, taskId, context);
	const identityScan = scanVaultForContext(vaultRoot, context);
	const explicitIdentity = resolveProjectIdentity(rawArgs, identityScan.notes);
	const projectIdentity = mergeTaskProjectIdentity(taskId, taskMetadata, explicitIdentity);
	const client = coerceOptionalString(rawArgs.client) || taskMetadata.client;
	const projectHint = projectIdentity.projectHint;
	const memoryScope = rawArgs.memory_scope === undefined ? '' : rawArgs.memory_scope;
	const relatedWiki = normalizeMultiValueList(rawArgs.related_wiki, 'related_wiki');
	const relatedSources = normalizeMultiValueList(rawArgs.related_sources, 'related_sources');
	const architectureStatus = buildArchitectureStatus(vaultRoot, context);
	const bridgeMetadata = resolveProjectMemoryBridgeMetadata(
		vaultRoot,
		resolveMemoryScope('session_finish', '', projectHint, memoryScope),
		projectHint,
		relatedWiki,
		relatedSources,
		context
	);

	const filename = buildSafeFilename(
		rawArgs.filename || `finish-${taskId}-${operationId}`,
		'session',
		context
	);
	const closeoutGroups = buildFinishTaskCloseoutGroups(
		{
			decisions,
			solution_changes: solutionChanges,
			lessons,
			preferences,
			next_actions: nextActions,
			memory_candidates: memoryCandidates,
		},
		context
	);

	return {
		requestHash,
		requestSnapshot,
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

function resolveFinishTaskSessionNotePath(
	input: FinishTaskOperationPayload,
	context: ToolContext
): string {
	const safeLeaf = normalizeNotePath(input.filename, pathSafetyOptions(context));
	const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
	return `${SESSION_NOTE_DIR}/${normalized}`;
}

async function writeFinishTaskSessionNote(input: FinishTaskOperationPayload, context: ToolContext, operationId: string): Promise<string> {
	const projectIdentity = projectIdentityFromFinishPayload(input);
	const body = buildSessionNoteBodyWithCloseout(
		context,
		input.summary,
		input.outcomes,
		input.nextActions,
		input.decisions,
		input.solutionChanges,
		input.lessons,
		input.preferences,
		input.memoryCandidates
	);
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
	const existing = await findOperationOwnedNoteAsync(
		input.vaultRoot,
		SESSION_NOTE_DIR,
		input.filename,
		'finish_operation_id',
		operationId,
		context
	);
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
	const note = await buildAndWriteNoteAsync(
		input.vaultRoot,
		'tracekeeper.finish_task',
		SESSION_NOTE_DIR,
		input.filename,
		{
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
		},
		body,
		input.taskId,
		context,
		sessionAuditMetadata,
		operationId
	);
	return note.path;
}

function finishTaskShouldWriteCloseoutGroup(group: FinishTaskCloseoutGroup, input: FinishTaskOperationPayload, context: ToolContext): boolean {
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

async function writeFinishTaskCloseoutArtifacts(
	input: FinishTaskOperationPayload,
	group: FinishTaskCloseoutGroup,
	context: ToolContext,
	operationId: string
) {
	const sessionNotePath = resolveFinishTaskSessionNotePath(input, context);
	const memoryScope = resolveMemoryScope(group.kind, '', input.projectHint, input.memoryScope);
	const bridgeMetadata = resolveProjectMemoryBridgeMetadata(
		input.vaultRoot,
		memoryScope,
		input.projectHint,
		input.rawRelatedWiki ?? input.relatedWiki,
		input.rawRelatedSources ?? input.relatedSources,
		context
	);
	const memoryRule = memoryProposalRuleFor(group.kind, '', input.projectHint, context, memoryScope);
	if (memoryRule === 'disabled' || input.reviewProposalMode === 'suggest') {
		return;
	}
	if (input.reviewProposalMode === 'auto_propose' && memoryRule === 'auto_write') {
		const canAutoWrite = !(
			memoryScope === 'project' &&
			bridgeMetadata.missing_wiki_bridge
		);
		if (canAutoWrite) {
			const autoTarget = resolveAutoMemoryTarget(
				input.vaultRoot,
				group.kind,
				'',
				input.projectHint,
				context,
				memoryScope
			);
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
	await createFinishTaskProposal(
		input.vaultRoot,
		input.taskId,
		sessionNotePath,
		operationId,
		group.kind,
		group.label,
		group.values,
		input.projectHint,
		input.reviewProposalMode,
		memoryScope,
		bridgeMetadata.related_wiki,
		bridgeMetadata.related_sources,
		input.architectureStatus,
		input.architectureStatus.missing_graph_bridges,
		bridgeMetadata.missing_wiki_bridge,
		bridgeMetadata.missing_related_wiki,
		bridgeMetadata.missing_related_sources,
		context
	);
}

async function updateFinishTaskRecord(input: FinishTaskOperationPayload, context: ToolContext, operationId: string): Promise<string | null> {
	const projectIdentity = projectIdentityFromFinishPayload(input);
	const notePath = resolveFinishTaskSessionNotePath(input, context);
	const sessionNote = await findOperationOwnedNoteAsync(
		input.vaultRoot,
		SESSION_NOTE_DIR,
		input.filename,
		'finish_operation_id',
		operationId,
		context
	);
	if (!sessionNote) {
		throw new ToolInputError(`Session note is missing for finish-task operation: ${notePath}`);
	}
	const proposalResult = await collectFinishTaskArtifacts(
		input.vaultRoot,
		input.taskId,
		sessionNote.path,
		input.reviewProposalMode,
		input.projectHint,
		input.memoryScope,
		input.rawRelatedWiki ?? input.relatedWiki,
		input.rawRelatedSources ?? input.relatedSources,
		input.architectureStatus,
		{
			decisions: input.decisions,
			solution_changes: input.solutionChanges,
			lessons: input.lessons,
			preferences: input.preferences,
			next_actions: input.nextActions,
			memory_candidates: input.memoryCandidates,
		},
		context,
		operationId
	);
	const proposalPaths = proposalResult.proposals.map((proposal) => proposal.path);
	const autoWritePaths = proposalResult.autoAppliedMemoryUpdates.map((update) => update.path);

	return updateAgentTaskRecordAsync(
		input.vaultRoot,
		input.taskId,
		{
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
		},
		context,
		{
			memory_writes: [sessionNote.path, ...autoWritePaths],
			proposals: proposalPaths,
		},
		[
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
		].join('\n'),
		`^finish-${operationId}`
	);
}

async function executeFinishTaskOperation(
	input: FinishTaskOperationPayload,
	context: ToolInvocationContext,
	operationId: string,
	idempotencyKey: string
) {
	const projectIdentity = projectIdentityFromFinishPayload(input);
	const sessionNote = await findOperationOwnedNoteAsync(
		input.vaultRoot,
		SESSION_NOTE_DIR,
		input.filename,
		'finish_operation_id',
		operationId,
		context
	);
	if (!sessionNote) {
		throw new ToolInputError(
			`Session note is missing for finish-task operation: ${resolveFinishTaskSessionNotePath(input, context)}`
		);
	}
	const proposalResult = await collectFinishTaskArtifacts(
		input.vaultRoot,
		input.taskId,
		sessionNote.path,
		input.reviewProposalMode,
		input.projectHint,
		input.memoryScope,
		input.rawRelatedWiki ?? input.relatedWiki,
		input.rawRelatedSources ?? input.relatedSources,
		input.architectureStatus,
		{
			decisions: input.decisions,
			solution_changes: input.solutionChanges,
			lessons: input.lessons,
			preferences: input.preferences,
			next_actions: input.nextActions,
			memory_candidates: input.memoryCandidates,
		},
		context,
		operationId
	);
	const memoryCloseoutStatus = resolveMemoryCloseoutStatus(
		input.reviewProposalMode,
		proposalResult,
		input.hasCloseoutCandidates
	);
	const memoryCloseoutState = resolveCanonicalMemoryCloseoutStatus(
		input.reviewProposalMode,
		proposalResult,
		input.hasCloseoutCandidates,
		memoryCloseoutStatus
	);

	const response: {
		ok: true;
		read_only: false;
		operation_id: string;
		idempotency_key: string;
		task_id: string;
		task_path: string | null;
		path: string;
		audit_path: string;
		review_proposal_mode: ReviewProposalMode;
		content_language: ContentLanguage;
		content_language_source: ContentLanguageSource;
		outcome_count: number;
		next_action_count: number;
		proposal_count?: number;
		proposals?: Array<{ kind: string; path: string }>;
		suggestion_count?: number;
		suggested_memory_updates?: FinishTaskSuggestion[];
		auto_applied_count?: number;
		auto_applied_memory_updates?: Array<{ kind: string; path: string; status: string }>;
		memory_closeout_status: LegacyMemoryCloseoutStatus;
		memory_closeout_state: MemoryCloseoutStatus;
		memory_closeout_summary: string;
		memory_scope?: MemoryScope;
		project_id?: string | null;
		repo_path?: string | null;
		project_hint?: string | null;
		project_identity?: ReturnType<typeof projectIdentityToResult>;
		related_wiki?: string[];
		related_sources?: string[];
		architecture_status?: ArchitectureStatus;
		missing_graph_bridges?: string[];
		missing_wiki_bridge?: boolean;
		missing_related_sources?: string[];
		next_actions_for_agent: string[];
	} = {
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
		project_identity: projectIdentityToResult(projectIdentity),
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
			path: proposal.path,
		}));
		response.auto_applied_count = proposalResult.autoAppliedMemoryUpdates.length;
		response.auto_applied_memory_updates = proposalResult.autoAppliedMemoryUpdates.map((update) => ({
			kind: update.kind,
			path: update.path,
			status: update.status,
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

function readTaskLifecycleState(
	vaultRoot: string,
	taskId: string,
	context: ToolContext
): { status: string; finishOperationId: string } | null {
	try {
		const absolutePath = resolveSafeNotePath(vaultRoot, buildTaskNotePath(taskId), pathSafetyOptions(context));
		const parsed = parseMarkdown(fs.readFileSync(absolutePath, 'utf8'));
		return {
			status: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['status'])).toLowerCase(),
			finishOperationId: stripYamlQuotes(
				readFrontmatterString(parsed.frontmatter.fields, ['finish_operation_id'])
			),
		};
	} catch (error: unknown) {
		if (error instanceof ToolInputError || error instanceof VaultPathError) {
			return null;
		}
		throw error;
	}
}

async function readTaskLifecycleStateAsync(
	vaultRoot: string,
	taskId: string,
	context: ToolContext
): Promise<{ status: string; finishOperationId: string } | null> {
	try {
		if (context.vaultRepository) {
			const taskFile = await context.vaultRepository.readText(buildTaskNotePath(taskId));
			if (!taskFile) {
				return null;
			}
			const parsed = parseMarkdown(taskFile.content);
			return {
				status: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['status'])).toLowerCase(),
				finishOperationId: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['finish_operation_id'])),
			};
		}
		const absolutePath = resolveSafeNotePath(vaultRoot, buildTaskNotePath(taskId), pathSafetyOptions(context));
		const parsed = parseMarkdown(fs.readFileSync(absolutePath, 'utf8'));
		return {
			status: stripYamlQuotes(readFrontmatterString(parsed.frontmatter.fields, ['status'])).toLowerCase(),
			finishOperationId: stripYamlQuotes(
				readFrontmatterString(parsed.frontmatter.fields, ['finish_operation_id'])
			),
		};
	} catch (error: unknown) {
		if (error instanceof ToolInputError || error instanceof VaultPathError) {
			return null;
		}
		throw error;
	}
}

async function handleFinishTask(rawArgs: FinishTaskArgs, context: ToolInvocationContext) {
	const vaultRoot = vaultRootFromArgs(rawArgs, context);
	const requestSnapshot = buildFinishTaskRequestSnapshot(rawArgs);
	const requestHash = computePayloadHash(requestSnapshot);
	const identity = buildToolOperationIdentity('finish-task', rawArgs.idempotency_key, requestSnapshot, context);
	const journal = operationJournalForVault(vaultRoot);
	const existing = await journal.loadByIdempotencyKey(identity.idempotencyKey);
	let operationPayload: FinishTaskOperationPayload;
	if (existing) {
		if (existing.operation_id !== identity.operationId) {
			throw new OperationConflictError(
				`Idempotency key conflict for "${identity.idempotencyKey}": associated with existing operation "${existing.operation_id}"`
			);
		}
		if (!isFinishTaskOperationPayload(existing.payload)) {
			throw new OperationConflictError(
				`Idempotency key conflict for "${identity.idempotencyKey}" with incompatible finish_task request payload`
			);
		}
		const storedRequestHash = typeof existing.payload.requestHash === 'string'
			? existing.payload.requestHash
			: '';
		if (storedRequestHash && storedRequestHash !== requestHash) {
			throw new OperationConflictError(
				`Idempotency key conflict for "${identity.idempotencyKey}" with different finish_task request hash`
			);
		}
		operationPayload = existing.payload as unknown as FinishTaskOperationPayload;
	} else {
		operationPayload = await buildFinishTaskOperationPayload(
			rawArgs,
			context,
			identity.operationId,
			requestHash,
			requestSnapshot
		);
	}
	if (!existing) {
		const lifecycle = await readTaskLifecycleStateAsync(vaultRoot, operationPayload.taskId, context);
		if (lifecycle?.status === 'completed') {
			throw new OperationConflictError(`Task is already completed: ${operationPayload.taskId}`);
		}
		if (
			lifecycle?.status === 'closing' &&
			lifecycle.finishOperationId &&
			lifecycle.finishOperationId !== identity.operationId
		) {
			throw new OperationConflictError(`Task is closing under another operation: ${operationPayload.taskId}`);
		}
		await updateAgentTaskRecordAsync(vaultRoot, operationPayload.taskId, {
			status: 'closing',
			finish_operation_id: identity.operationId,
		}, context);
	}

	const closeoutGroups = operationPayload.closeoutGroups.filter((group) =>
		finishTaskShouldWriteCloseoutGroup(group, operationPayload, context)
	);
	const closeoutSteps = closeoutGroups.map((group) => ({
		name: `finish-task:${group.kind}`,
		execute: () => writeFinishTaskCloseoutArtifacts(operationPayload, group, context, identity.operationId),
	}));

	const runner = new RecoverableOperationRunner({
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
		finalize: () => executeFinishTaskOperation(
			operationPayload,
			context,
			identity.operationId,
			identity.idempotencyKey
		),
	});

	return runner.run();
}

async function handleDistillSession(rawArgs: DistillSessionArgs, context: ToolContext) {
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
	const note = await buildAndWriteNoteAsync(
		vaultRoot,
		'tracekeeper.distill_session',
		SESSION_NOTE_DIR,
		filename,
		{
			tool: 'tracekeeper.distill_session',
			type: 'session_note',
			title: contentText(context, `任务 ${taskId} 提炼记录`, `Task ${taskId} distill note`),
			task_id: taskId,
			project_hint: projectHint || null,
			related_project: projectHint || null,
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
		if (isMemoryProposalAllowed('distill_decisions', '', projectHint, context)) {
			const proposal = await createDistillProposal(
				vaultRoot,
				taskId,
				'distill_decisions',
				'Decisions',
				decisions,
				projectHint,
				context
			);
			proposals.push(proposal.path);
		}
	}
	if (possiblePreferences.length > 0) {
		if (isMemoryProposalAllowed('distill_preferences', '', projectHint, context)) {
			const proposal = await createDistillProposal(
				vaultRoot,
				taskId,
				'distill_preferences',
				'Possible Preferences',
				possiblePreferences,
				projectHint,
				context
			);
			proposals.push(proposal.path);
		}
	}
	await updateAgentTaskRecordAsync(vaultRoot, taskId, {
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
