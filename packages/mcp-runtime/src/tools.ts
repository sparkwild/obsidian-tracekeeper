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
	TRACEKEEPER_ROOT,
	TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH,
	TRACEKEEPER_AGENT_REQUESTS_DIR,
	TRACEKEEPER_CONTEXT_PACKS_DIR,
	TRACEKEEPER_OPERATIONS_DIR,
	TRACEKEEPER_REVIEW_QUEUE_DIR,
	TRACEKEEPER_SESSIONS_DIR,
	TRACEKEEPER_SOURCE_ANALYSIS_DIR,
	TRACEKEEPER_TASKS_DIR,
	KNOWLEDGE_GLOBAL_MEMORY_DIR,
	KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH,
	KNOWLEDGE_PROJECTS_MEMORY_DIR,
	KNOWLEDGE_SOURCES_DIR,
	LEGACY_TOP_LEVEL_DIRS,
	isKnowledgeWikiPath,
	isKnowledgeSourcePath,
	projectMemoryPath,
	buildMemoryRecord,
	buildProjectMemoryEntryPath,
	normalizeProjectAgentType,
	NodeFsVaultRepository,
	NodeFileOperationJournal,
	OperationConflictError,
	ProposalTransitionConflictError,
	ProposalTransitionStateError,
	ProposalTransitionValidationError,
	RecoverableOperationRunner,
	computeProposalContentHash,
	computeProposalRevision,
	computePayloadHash,
	buildStableProposalId,
	isAllowedProposalTargetPath,
	proposalHistoryLocation,
	proposalTransitionReceiptFromFrontmatter,
	resolveProposalHistoryById,
	transitionProposal,
	type OperationFailureInjection,
	type OperationRecord,
	type ProposalFrontmatterMutationValue,
	type ProposalTransitionCommand,
	type ProposalTransitionDecision,
	type ProposalTransitionReceipt,
	type ProposalTransitionSnapshot,
	type ProposalTransitionStatus,
	lintNotes,
	parseMarkdown,
	type ScanResult,
	type ScannedNote,
	type KnowledgeReadView,
	type KnowledgeCatalogEntry,
	type ResolvedMemoryRecord,
	InMemoryKnowledgeIndex,
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
	type ApplyApprovedWritebackTaskLinkReceipt,
} from './application/apply-approved-writeback';
import {
	normalizeRepositoryPath,
	projectIdentityToResult,
	resolveProjectIdentity,
	type ResolvedProjectIdentity,
} from './application/project-identity';
import {
	ProjectMemoryApplicationService,
	type ProjectMemoryVaultRepository,
} from './application/project-memory';
import {
	RecallApplicationService,
	type GlobalRecallApplicationResult,
	type ProjectHistoryRecallApplicationResult,
	type ProjectRecallApplicationResult,
	type TaskHistoryRecallApplicationResult,
	type RecallApplicationScope,
	type RecallContentOrigin,
	type RecallRelationEvidence,
	type RecallRelationEvidenceItem,
} from './application/recall';
import {
	CaptureSourceApplicationService,
	type CaptureSourceNote,
	type CaptureSourceRawRequest,
	type CaptureSourceWriteInput,
} from './application/capture-source';
import {
	SourceRequestApplicationService,
	type SourceRequestRecord,
	type SourceRequestWriteInput,
} from './application/source-request';
import {
	ProposeMemoryApplicationService,
	type ProposeMemoryImmutableWriteInput,
	type ProposeMemoryProjectIdentity,
	type ProposeMemoryRawRequest,
	type ProposeMemoryWriteInput,
} from './application/propose-memory';
import {
	DistillSessionApplicationService,
	FinishTaskApplicationService,
	type DistillSessionRawRequest,
	type FinishTaskRunnerStep,
} from './application/finish-task';
import {
	AgentActivityRecentApplicationService,
} from './application/audit';
import {
	appendAuditEvent,
	appendAuditEventAsync,
	collectAuditTargetsFromResult,
	projectArgumentsForAudit,
	readMergedAuditSections,
	summarizeForAudit,
	type AuditEventInput,
} from './infrastructure/audit-persistence';
import { VaultRecordAdapter } from './infrastructure/vault-record-adapter';
import {
	RuntimeRecoveryController,
	type OperationRecoveryReport,
} from './application/recovery';
import {
	normalizeObservedClientType,
	type ObservedClientType,
} from './observed-client';

export { readMergedAuditSections } from './infrastructure/audit-persistence';
export type { AuditRecentSection } from './infrastructure/audit-persistence';

export const LOCAL_TRUST_PRINCIPAL_ID = 'local-user';
export const LOCAL_TRUST_CAPABILITIES = [
	'vault.read',
	'workflow.manage',
	'vault.write',
	'memory.propose',
] as const satisfies readonly ToolCapability[];

const REVIEW_QUEUE_PREFIX = TRACEKEEPER_REVIEW_QUEUE_DIR;
const AGENT_ACTIVITY_PATH = TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH;
const MAX_LIST_QUEUE_ITEMS = 20;
const MAX_AUDIT_ITEMS = 20;
const MAX_APPROVED_WRITEBACKS = 20;
const MAX_PROJECT_TOOL_ITEMS = 20;
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
const MAX_RECALL_RELATIONS = 8;
const DEFAULT_FINISH_TASK_REVIEW_MODE = 'auto_propose';

type CaptureSourceMode = 'external_reference' | 'extracted_snapshot' | 'local_copy';
type ReviewProposalMode = 'off' | 'suggest' | 'review_queue' | 'auto_propose';
type MemoryProposalRule = 'review_queue' | 'auto_write' | 'disabled';
type MemoryScope = 'global' | 'project';
type FinishTaskStatus = 'completed' | 'partial' | 'blocked';
type ArchitectureStatus = 'healthy' | 'needs_attention';
type SensitiveTextScan = { ok: true } | { ok: false; reason: string };
type ContentLanguage = 'zh-CN' | 'en';
type ContentLanguageSource = 'setting' | 'obsidian' | 'navigator' | 'fallback';

interface MemoryRulesContext {
	globalMemoryRule?: unknown;
	projectMemoryRule?: unknown;
	taskTrackingEnabled?: unknown;
}

interface ToolContext {
	defaultVaultRoot?: string;
	vaultConfigDir?: string;
	vaultRepository?: VaultRepository;
	knowledgeSnapshotProvider?: (vaultRoot: string) => ScanResult | null;
	knowledgeReadViewProvider?: (vaultRoot: string) => Promise<KnowledgeReadView | null>;
	graphProfile?: unknown;
	memoryRules?: MemoryRulesContext;
	contentLanguage?: unknown;
	contentLanguageSource?: unknown;
	proposalTransitionPort?: ProposalTransitionPort;
}

export interface ProposalTransitionPort {
	transition(
		request: ProposalTransitionCommand & {
			proposalPath: string;
			expectedFileHash?: string;
			now?: string;
			actor?: string;
		}
	): Promise<ProposalTransitionDecision>;
}

export interface ToolInvocationContext extends ToolContext {
	knowledgeReadViewPromise?: Promise<KnowledgeReadView>;
	invocationId?: string;
	requestId?: string;
	principalId?: string;
	credentialCapabilities?: readonly string[];
	integrationId?: string;
	credentialId?: string;
	authMode?: 'oauth' | 'bearer';
	agentId?: string;
	sessionId?: string;
	clientName?: string | null;
	clientVersion?: string | null;
	observedClientType?: ObservedClientType;
	transport?: string;
	runtimeVersion?: string;
	operationFailureInjection?: OperationFailureInjection;
	writebackConfirmationClock?: () => number;
	writebackConfirmationTtlMs?: number;
	writebackConfirmationSecret?: string | Uint8Array;
	writebackRecoveryOperationId?: string;
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
	integrationId?: string;
	credentialId?: string;
	authMode?: 'oauth' | 'bearer';
	agentId: string;
	sessionId?: string;
	clientName: string | null;
	clientVersion: string | null;
	observedClientType: ObservedClientType;
	transport: string;
	runtimeVersion: string;
}

interface ToolCallAuditEventInput {
	invocationId?: string;
	requestId?: string;
	toolName: string;
	resultStatus: 'success' | 'failed';
	targetPaths: string[];
	durationMs: number;
	riskLevel: string;
	agentId: string;
	principalId?: string;
	integrationId?: string;
	credentialId?: string;
	authMode?: 'oauth' | 'bearer';
	sessionId?: string;
	clientName: string | null;
	clientVersion?: string | null;
	observedClientType?: ObservedClientType;
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
	[key: string]: unknown;
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
	stale_after_days?: unknown;
}

interface FinishTaskArgs extends ProjectScopeArgs {
	task_id?: unknown;
	summary?: unknown;
	status?: unknown;
	outcomes?: unknown;
	decisions?: unknown;
	solution_changes?: unknown;
	lessons?: unknown;
	preferences?: unknown;
	memory_candidate_records?: unknown;
	next_actions?: unknown;
	client?: unknown;
	related_wiki?: unknown;
	related_sources?: unknown;
	filename?: unknown;
	idempotency_key?: unknown;
}

interface RecallArgs extends ToolArgs {
	query?: unknown;
	task_id?: unknown;
	max_items?: unknown;
	scope?: unknown;
	project_hint?: unknown;
	project_id?: unknown;
	repo_path?: unknown;
	repo?: unknown;
	project_path?: unknown;
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

interface ManagedProposalReference {
	proposalId: string;
	path: string;
	linkTarget: string;
	link?: string;
}

interface FinishTaskProposalResult {
	proposals: Array<ManagedProposalReference & { kind: string }>;
	suggestedMemoryUpdates: FinishTaskSuggestion[];
	autoAppliedMemoryUpdates: Array<{
		kind: string;
		path: string;
		status: string;
		operation_id?: string;
		operation_hash?: string;
		agent_type?: string;
		memory_kinds?: string[];
	}>;
	hasMissingWikiBridge: boolean;
	hasMissingRelatedSources: boolean;
	memoryCandidateRecords: FinishTaskMemoryCandidateRecordResult[];
	memoryChanges: FinishTaskMemoryChange[];
}

interface FinishTaskMemoryCandidateRecord {
	proposal_kind: string;
	content: string;
	scope: MemoryScope;
	project_hint?: string | null;
	project_id?: string | null;
	repo_path?: string | null;
	related_wiki?: string[];
	related_sources?: string[];
	evidence: string[];
	target_note: string | null;
	claim_key: string | null;
	proposed_authority: string | null;
	proposed_confidence: string | null;
	declared_state: string | null;
	observed_at: string | null;
	valid_from: string | null;
	valid_to: string | null;
	last_verified_at: string | null;
	supersedes: string[];
	contradicts: string[];
}

interface FinishTaskMemoryCandidateRecordResult extends FinishTaskMemoryCandidateRecord {
	authority: string | null;
	confidence_level: string | null;
	effective_state: string | null;
}

interface FinishTaskMemoryChange {
	source: string;
	change_kind: string;
	candidate_index?: number;
	scope?: MemoryScope;
	reason?: string;
	proposal_id?: string | null;
	record_identity?: Record<string, unknown>;
	previous_effective_state?: string | null;
	next_effective_state?: string | null;
	proposal_transition?: Record<string, unknown>;
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

interface AgentActivityRecentArgs extends ToolArgs {
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

interface ProposeMemoryArgs extends ProjectScopeArgs {
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
	claim_key?: unknown;
	proposed_authority?: unknown;
	proposed_confidence?: unknown;
	declared_state?: unknown;
	observed_at?: unknown;
	valid_from?: unknown;
	valid_to?: unknown;
	last_verified_at?: unknown;
	supersedes?: unknown;
	contradicts?: unknown;
	idempotency_key?: unknown;
}

function buildProposeMemoryRequestSnapshot(rawArgs: ProposeMemoryArgs) {
	return {
		proposal_kind: coerceNonEmptyString(
			rawArgs.proposal_kind,
			true,
			'proposal_kind'
		),
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
		related_wiki: normalizeMultiValueList(
			rawArgs.related_wiki,
			'related_wiki'
		),
		related_sources: normalizeMultiValueList(
			rawArgs.related_sources,
			'related_sources'
		),
		claim_key: coerceOptionalString(rawArgs.claim_key) || null,
		proposed_authority: coerceOptionalString(rawArgs.proposed_authority) || null,
		proposed_confidence: coerceOptionalString(rawArgs.proposed_confidence) || null,
		declared_state: coerceOptionalString(rawArgs.declared_state) || null,
		observed_at: coerceOptionalString(rawArgs.observed_at) || null,
		valid_from: coerceOptionalString(rawArgs.valid_from) || null,
		valid_to: coerceOptionalString(rawArgs.valid_to) || null,
		last_verified_at: coerceOptionalString(rawArgs.last_verified_at) || null,
		supersedes: normalizeMultiValueList(rawArgs.supersedes, 'supersedes'),
		contradicts: normalizeMultiValueList(rawArgs.contradicts, 'contradicts'),
	};
}

interface ProposeMemoryOperationPayload {
	requestHash: string;
	requestSnapshot: ReturnType<typeof buildProposeMemoryRequestSnapshot>;
	projectMemoryCreatedAt: string;
	projectMemoryAgentType: ObservedClientType | 'custom';
}

function isProposeMemoryOperationPayload(
	payload: unknown
): payload is ProposeMemoryOperationPayload {
	if (!isRecord(payload) || !isRecord(payload.requestSnapshot)) {
		return false;
	}
	return typeof payload.requestHash === 'string'
		&& payload.requestHash.length > 0
		&& typeof payload.requestSnapshot.proposal_kind === 'string'
		&& payload.requestSnapshot.proposal_kind.length > 0
		&& typeof payload.requestSnapshot.content === 'string'
		&& payload.requestSnapshot.content.length > 0
		&& Array.isArray(payload.requestSnapshot.related_wiki)
		&& payload.requestSnapshot.related_wiki.every(
			(value) => typeof value === 'string'
		)
		&& Array.isArray(payload.requestSnapshot.related_sources)
		&& payload.requestSnapshot.related_sources.every(
			(value) => typeof value === 'string'
		)
		&& typeof payload.projectMemoryCreatedAt === 'string'
		&& !Number.isNaN(Date.parse(payload.projectMemoryCreatedAt))
		&& typeof payload.projectMemoryAgentType === 'string'
		&& payload.projectMemoryAgentType.length > 0;
}

interface MemoryArgs extends ProjectScopeArgs {
	scope?: unknown;
	view?: unknown;
	cursor?: unknown;
	page_size?: unknown;
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
	confirmation_token?: unknown;
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
	effectKind?: 'append' | 'create_memory_record';
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
		if (value === undefined || value === null || Array.isArray(value) || isRecord(value)) {
			continue;
		}
		summaryParts.push(`${key}=${String(value)}`);
	}
	if (
		payload.tool === 'tracekeeper.memory'
		&& isRecord(payload.page)
	) {
		const pageSize = payload.page.page_size;
		const hasNextPage =
			typeof payload.page.next_cursor === 'string'
			&& payload.page.next_cursor.length > 0;
		if (
			typeof pageSize === 'number'
			&& Number.isFinite(pageSize)
		) {
			summaryParts.push(`page_size=${pageSize}`);
		}
		summaryParts.push(`has_next_page=${String(hasNextPage)}`);
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
		memory_status: typeof payload.memory_status === 'string'
			? payload.memory_status
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
	const state = payload.memory_status ?? payload.memory_closeout_state;
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
		decorated.memory_status = memoryStatus;
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

function configuredVaultRoot(context: ToolContext): string {
	if (!context.defaultVaultRoot) {
		throw new ToolInputError('vaultRoot is required unless --vault-root is configured.');
	}
	return toSafeVaultRoot(context.defaultVaultRoot);
}

function assertCallerDoesNotSelectVaultRoot(args: Record<string, unknown>): void {
	if (Object.prototype.hasOwnProperty.call(args, 'vaultRoot')) {
		throw new ToolInputError('vaultRoot is managed by the Tracekeeper server and must not be supplied in tool arguments.');
	}
}

function pathSafetyOptions(context: ToolContext): { vaultConfigDir?: string } {
	return {
		vaultConfigDir: context.vaultConfigDir,
	};
}

function graphProfileFromArgs(value: unknown, context: ToolContext): GraphProfile {
	return normalizeGraphProfile(value ?? context.graphProfile);
}

type RecallScope = RecallApplicationScope;

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
	if (normalized === 'task_history' || normalized === 'tasks' || normalized === 'task') {
		return 'task_history';
	}
	throw new ToolInputError('scope must be one of: global, project, project_history, task_history.');
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

async function knowledgeReadViewForContext(
	vaultRoot: string,
	context: ToolInvocationContext
): Promise<KnowledgeReadView> {
	if (!context.knowledgeReadViewPromise) {
		context.knowledgeReadViewPromise = (async () => {
			const provided = await context.knowledgeReadViewProvider?.(vaultRoot);
			if (provided) return provided;
			const scan = scanVaultForContext(vaultRoot, context);
			const index = new InMemoryKnowledgeIndex({ vaultRoot, initialScan: scan });
			const view = await index.readView();
			return scan.index
				? view
				: { ...view, source: 'filesystem_scan' as const };
		})();
	}
	return context.knowledgeReadViewPromise;
}

function projectMemoryRepository(
	vaultRoot: string,
	context: ToolContext
): ProjectMemoryVaultRepository {
	if (context.vaultRepository) {
		return context.vaultRepository as ProjectMemoryVaultRepository;
	}
	return new NodeFsVaultRepository({
		vaultRoot,
		protectedDirectoryName: context.vaultConfigDir,
	});
}

function projectMemoryApplication(
	vaultRoot: string,
	context: ToolContext
): ProjectMemoryApplicationService {
	return new ProjectMemoryApplicationService({
		repository: projectMemoryRepository(vaultRoot, context),
		loadScan: () => scanVaultForContext(vaultRoot, context),
	});
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
			: indexState === 'initializing'
				? 'Knowledge index metadata is still initializing; this result may be incomplete.'
			: null,
	};
}

function readViewProvenance(view: KnowledgeReadView): {
	index_state: string;
	snapshot_generation: number | null;
	snapshot_warning: string | null;
} {
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

function coerceFinishTaskStatus(value: unknown): FinishTaskStatus {
	if (value === undefined || value === null || value === '') {
		return 'completed';
	}
	const normalized = coerceOptionalString(value).toLowerCase();
	if (normalized === 'completed' || normalized === 'partial' || normalized === 'blocked') {
		return normalized;
	}
	throw new ToolInputError('status must be one of: completed, partial, blocked.');
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

function normalizeFinishTaskMemoryCandidateRecords(value: unknown): FinishTaskMemoryCandidateRecord[] {
	if (value === undefined || value === null) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new ToolInputError('memory_candidate_records must be an array.');
	}
	if (value.length > 64) {
		throw new ToolInputError('memory_candidate_records exceeds the maximum of 64 entries.');
	}
	const allowed = new Set([
		'proposal_kind', 'content', 'scope', 'project_hint', 'project_id', 'repo_path', 'related_wiki', 'related_sources',
		'evidence', 'target_note', 'claim_key',
		'proposed_authority', 'proposed_confidence', 'declared_state',
		'observed_at', 'valid_from', 'valid_to', 'last_verified_at',
		'supersedes', 'contradicts',
	]);
	return value.map((entry, index) => {
		if (!isRecord(entry)) {
			throw new ToolInputError(`memory_candidate_records[${index}] must be an object.`);
		}
		for (const key of Object.keys(entry)) {
			if (!allowed.has(key)) {
				throw new ToolInputError(`Unknown memory_candidate_records field: ${key}.`);
			}
		}
		const optional = (field: string) => coerceOptionalString(entry[field]) || null;
		const scope = coerceMemoryScope(entry.scope);
		if (!scope) {
			throw new ToolInputError(`memory_candidate_records[${index}].scope must be global or project.`);
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
	return DEFAULT_FINISH_TASK_REVIEW_MODE;
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

function normalizeRelationEdgeTarget(value: string): string {
	return normalizeWikilinkOrSourceValue(value)
		.replace(/#.*$/, '')
		.replace(/\\/g, '/')
		.replace(/^\.\//, '')
		.toLowerCase();
}

function findSnapshotNoteByPath(notePath: string, notes: ScannedNote[]): ScannedNote | null {
	const normalizedPath = notePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
	return notes.find(
		(note) => note.relativePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase() === normalizedPath
	) ?? null;
}

function resolveFrontmatterRelationEdge(
	note: ScannedNote,
	reference: string,
	allNotes: ScannedNote[]
): { matched: boolean; note: ScannedNote | null } {
	const normalizedReference = normalizeRelationEdgeTarget(reference);
	if (!normalizedReference) {
		return { matched: false, note: null };
	}
	for (const edge of note.edges) {
		if (
			edge.source !== 'frontmatter' ||
			normalizeRelationEdgeTarget(edge.linkPath || edge.target) !== normalizedReference
		) {
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

function buildRecallRelationEvidence(note: ScannedNote, allNotes: ScannedNote[]): RecallRelationEvidence {
	const relationMap = new Map<string, RecallRelationEvidenceItem>();
	const addResolvedRelation = (
		resolved: ScannedNote | null,
		declaredVia: 'frontmatter' | 'body_wikilink'
	) => {
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
	const addFrontmatterRelation = (reference: string) => {
		const sharedEdge = resolveFrontmatterRelationEdge(note, reference, allNotes);
		addResolvedRelation(
			sharedEdge.matched
				? sharedEdge.note
				: resolveSnapshotRelation(reference, allNotes),
			'frontmatter'
		);
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
		addResolvedRelation(
			edge.resolution.status === 'resolved'
				? findSnapshotNoteByPath(edge.resolution.path, allNotes)
				: null,
			'body_wikilink'
		);
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

function buildReadViewRelationEvidence(
	notePath: string,
	view: KnowledgeReadView
): RecallRelationEvidence {
	const rows = new Map<string, RecallRelationEvidenceItem>();
	for (const edge of view.graph.edges) {
		if (edge.sourcePath !== notePath || edge.resolution.status !== 'resolved') continue;
		const targetPath = edge.resolution.path;
		if (!view.catalog.has(targetPath)) continue;
		const relationKind = isKnowledgeWikiPath(targetPath)
			? 'related_wiki'
			: isKnowledgeSourcePath(targetPath)
				? 'related_sources'
				: null;
		if (!relationKind) continue;
		const key = `${relationKind}:${targetPath.toLowerCase()}`;
		const declaredVia = edge.source === 'frontmatter' ? 'frontmatter' : 'body_wikilink';
		const existing = rows.get(key);
		if (existing) {
			if (!existing.declared_via.includes(declaredVia)) existing.declared_via.push(declaredVia);
			continue;
		}
		rows.set(key, {
			path: targetPath,
			declared_by: notePath,
			declared_via: [declaredVia],
			verified_by: 'active_vault_snapshot',
		});
	}
	const ordered = [...rows.entries()].sort(([left], [right]) => left.localeCompare(right));
	return {
		related_wiki: ordered.filter(([key]) => key.startsWith('related_wiki:')).map(([, row]) => row),
		related_sources: ordered.filter(([key]) => key.startsWith('related_sources:')).map(([, row]) => row),
	};
}

function recallContentOrigin(relativePath: string, noteType?: string): RecallContentOrigin {
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

function proposalIdFromOperation(operationId: string, discriminator: string): string {
	return buildStableProposalId(`${operationId}\0${discriminator}`);
}

function generateProposalMarkdownLink(
	context: ToolContext,
	proposalPath: string,
	sourcePath: string
): string | null {
	const repository = context.vaultRepository as (
		| (VaultRepository & {
			generateMarkdownLink(
				targetPath: string,
				sourcePath: string,
				subpath?: string,
				alias?: string
			): string;
		})
		| undefined
	);
	if (!repository || typeof repository.generateMarkdownLink !== 'function') {
		return null;
	}
	return repository.generateMarkdownLink(proposalPath, sourcePath);
}

function explicitProposalId(frontmatter: Record<string, unknown>): string {
	return stripYamlQuotes(
		readFrontmatterString(frontmatter, ['proposal_id', 'proposalId'])
	);
}

async function ensureOperationOwnedProposalIdentity(
	vaultRoot: string,
	proposalPath: string,
	proposalId: string,
	operationField: string,
	operationId: string,
	context: ToolContext
): Promise<void> {
	const current = await readCurrentVaultTextState(vaultRoot, proposalPath, context);
	if (!current) {
		throw new OperationConflictError(`Proposal is unavailable: ${proposalPath}`);
	}
	const frontmatter = parseMarkdown(current.content).frontmatter.fields;
	if (
		stripYamlQuotes(readFrontmatterString(frontmatter, [operationField]))
		!== operationId
	) {
		throw new OperationConflictError(
			`Proposal is not owned by the current operation: ${proposalPath}`
		);
	}
	const currentProposalId = explicitProposalId(frontmatter);
	if (currentProposalId) {
		if (currentProposalId !== proposalId) {
			throw new OperationConflictError(
				`Proposal identity changed for operation-owned note: ${proposalPath}`
			);
		}
		return;
	}
	const next = updateFrontmatterFields(current.content, {
		proposal_id: proposalId,
	});
	if (context.vaultRepository) {
		if (!current.version) {
			throw new OperationConflictError('Proposal version is unavailable.');
		}
		await context.vaultRepository.replaceText(current.path, current.version, next);
		return;
	}
	const absolute = resolveSafeNotePath(vaultRoot, current.path, pathSafetyOptions(context));
	replaceTextFileAtomically(absolute, next, current.content);
}

async function readRequiredProposalId(
	vaultRoot: string,
	proposalPath: string,
	context: ToolContext
): Promise<string> {
	const content = await readVaultNoteContent(vaultRoot, proposalPath, context);
	if (content === null) {
		throw new ToolInputError(`Proposal artifact is missing: ${proposalPath}`);
	}
	const proposalId = explicitProposalId(parseMarkdown(content).frontmatter.fields);
	if (!proposalId) {
		throw new ToolInputError(
			`Proposal artifact has no stable proposal_id: ${proposalPath}`
		);
	}
	return proposalId;
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
	context: ToolContext,
	suppressAutoTarget = false
): Promise<{ path: string; proposalId: string }> {
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
		if (ownedByCurrentOperation) {
			await ensureOperationOwnedProposalIdentity(
				vaultRoot,
				existingProposal,
				proposalId,
				'finish_operation_id',
				operationId,
				context
			);
		}
		return {
			path: existingProposal,
			proposalId: await readRequiredProposalId(vaultRoot, existingProposal, context),
		};
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
		await ensureOperationOwnedProposalIdentity(
			vaultRoot,
			existingForOperation.path,
			proposalId,
			'finish_operation_id',
			operationId,
			context
		);
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
	const filename = buildSafeFilename(
		`finish-task-${proposalKind}-${taskId}-${operationId}`,
		'proposal',
		context
	);
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

	return buildAndWriteNoteAsync(
		vaultRoot,
		'tracekeeper.finish_task',
		MEMORY_PROPOSAL_DIR,
		filename,
		{
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
		},
		body,
		taskId,
		context,
		proposalAuditMetadata,
		operationId
	).then((note) => ({
		path: note.path,
		proposalId,
	}));
}

async function readFinishTaskProjectMemoryStepReceipt(
	vaultRoot: string,
	operationId: string
): Promise<
	FinishTaskProjectMemoryStepReceipt
	| { outcome: 'review_fallback' }
	| null
> {
	const record = await operationJournalForVault(vaultRoot).loadById(operationId);
	const result = record?.completed_steps.find(
		(step) => step.name === 'finish-task:project-memory'
			|| (
				step.name.startsWith('finish-task:')
				&& isRecord(step.result)
				&& (
					step.result.outcome === 'immutable'
					|| step.result.outcome === 'review_fallback'
				)
			)
	)?.result;
	if (!isRecord(result)) {
		return null;
	}
	if (result.outcome === 'review_fallback') {
		return { outcome: 'review_fallback' };
	}
	if (
		result.outcome !== 'immutable'
		|| typeof result.path !== 'string'
		|| typeof result.project_id !== 'string'
		|| typeof result.agent_type !== 'string'
		|| typeof result.operation_id !== 'string'
		|| typeof result.operation_hash !== 'string'
		|| !Array.isArray(result.memory_kinds)
		|| !result.memory_kinds.every((value) => typeof value === 'string')
		|| (result.write_status !== 'written' && result.write_status !== 'skipped')
	) {
		throw new OperationConflictError(
			'Finish-task project-memory step receipt is invalid.'
		);
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

async function verifyFinishTaskProjectMemoryStepReceipt(
	vaultRoot: string,
	operationId: string,
	receipt: FinishTaskProjectMemoryStepReceipt,
	context: ToolContext
): Promise<void> {
	const safePath = normalizeNotePath(receipt.path, pathSafetyOptions(context));
	const content = await readVaultNoteContent(vaultRoot, safePath, context);
	if (!content) {
		throw new ToolInputError(
			`Finish-task project-memory artifact is missing: ${safePath}`
		);
	}
	const frontmatter = parseMarkdown(content).frontmatter.fields;
	const recordType = readFrontmatterString(frontmatter, ['type']);
	const commonMismatch =
		readFrontmatterString(frontmatter, ['project_id']) !== receipt.project_id
		|| readFrontmatterString(frontmatter, ['agent_type']) !== receipt.agent_type
		|| readFrontmatterString(frontmatter, ['operation_id']) !== operationId;
	const legacyMismatch = recordType === 'project_memory_entry' && (
		readFrontmatterString(frontmatter, ['operation_hash']) !== receipt.operation_hash
		|| JSON.stringify(readFrontmatterStringList(frontmatter, 'memory_kinds').sort())
			!== JSON.stringify([...receipt.memory_kinds].sort())
	);
	const v2Mismatch = recordType === 'memory_record' && (
		!receipt.memory_id
		|| !receipt.claim_key
		|| readFrontmatterString(frontmatter, ['memory_id']) !== receipt.memory_id
		|| readFrontmatterString(frontmatter, ['claim_key']) !== receipt.claim_key
		|| `sha256:${crypto.createHash('sha256').update(content, 'utf8').digest('hex')}` !== receipt.operation_hash
	);
	if (
		commonMismatch
		|| (recordType !== 'project_memory_entry' && recordType !== 'memory_record')
		|| legacyMismatch
		|| v2Mismatch
	) {
		throw new OperationConflictError(
			'Finish-task project-memory artifact no longer matches its operation receipt.'
		);
	}
}

async function collectFinishTaskArtifacts(
	vaultRoot: string,
	taskId: string,
	sessionNotePath: string,
	proposalMode: ReviewProposalMode,
	projectHint: string,
	projectId: string,
	repoPath: string,
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
	memoryCandidateRecords: FinishTaskMemoryCandidateRecord[],
	context: ToolInvocationContext,
	operationId: string,
	expectImmutableProjectMemory = false
): Promise<FinishTaskProposalResult> {
	const candidateResults: FinishTaskMemoryCandidateRecordResult[] = memoryCandidateRecords.map((candidate) => ({
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

	const groups: FinishTaskCloseoutGroup[] = [];

	const proposals: Array<ManagedProposalReference & { kind: string }> = [];
	const suggestedMemoryUpdates: FinishTaskSuggestion[] = [];
	const autoAppliedMemoryUpdates: FinishTaskProposalResult['autoAppliedMemoryUpdates'] = [];
	const projectMemoryReceipt = await readFinishTaskProjectMemoryStepReceipt(
		vaultRoot,
		operationId
	);
	if (expectImmutableProjectMemory && !projectMemoryReceipt) {
		throw new OperationConflictError(
			'Finish-task project-memory step receipt is missing.'
		);
	}
	if (projectMemoryReceipt?.outcome === 'immutable') {
		await verifyFinishTaskProjectMemoryStepReceipt(
			vaultRoot,
			operationId,
			projectMemoryReceipt,
			context
		);
	}
	let projectMemoryReceiptCollected = false;
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
			if (
				canAutoWrite
				&& memoryScope === 'project'
				&& projectMemoryReceipt !== null
			) {
				if (
					projectMemoryReceipt?.outcome === 'immutable'
					&& !projectMemoryReceipt.memory_kinds.includes(group.kind)
				) {
					throw new OperationConflictError(
						'Finish-task project-memory receipt is missing an eligible memory kind.'
					);
				}
				if (
					projectMemoryReceipt?.outcome === 'immutable'
					&& !projectMemoryReceiptCollected
				) {
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
			if (
				canAutoWrite
				&& !(memoryScope === 'project' && projectMemoryReceipt !== null)
			) {
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

	const memoryChanges: FinishTaskMemoryChange[] = [];
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
		const proposalContext: ToolInvocationContext = context;
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
		const rawCandidate: ProposeMemoryArgs = {
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
		if (!isRecord(result)) {
			throw new OperationConflictError(`Structured finish-task memory result is invalid for candidate ${index}.`);
		}
		const resultRecord: Record<string, unknown> = result;
		const predictedRecord: Record<string, unknown> = isRecord(resultRecord.predicted_record)
			? resultRecord.predicted_record
			: {};
		candidateResults[index] = {
			...candidate,
			authority: typeof predictedRecord.authority === 'string' ? predictedRecord.authority : null,
			confidence_level: typeof predictedRecord.confidence_level === 'string' ? predictedRecord.confidence_level : null,
			effective_state: typeof resultRecord.predicted_state === 'string' ? resultRecord.predicted_state : null,
		};
		const recordIdentity = isRecord(resultRecord.record_identity) ? resultRecord.record_identity : undefined;
		const transition = isRecord(resultRecord.proposal_transition_preview)
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
				throw new OperationConflictError(`Structured finish-task auto-write receipt is invalid for candidate ${index}.`);
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
		if (
			typeof resultRecord.proposal_id !== 'string'
			|| typeof resultRecord.proposal_path !== 'string'
		) {
			throw new OperationConflictError(`Structured finish-task proposal receipt is invalid for candidate ${index}.`);
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

const vaultRecordAdapter = new VaultRecordAdapter({
	agentActivityPath: AGENT_ACTIVITY_PATH,
	buildMarkdownNote,
});

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

function readFrontmatterString(frontmatter: Readonly<Record<string, unknown>>, keys: string[]): string {
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

function readProposalApprovalStatus(frontmatter: Readonly<Record<string, unknown>>): string {
	return stripYamlQuotes(
		readFrontmatterString(frontmatter, ['approval_status', 'approvalStatus', 'status']) || 'pending'
	)
		.toLowerCase()
		.replace(/\s+/g, '_');
}

function isMemoryProposalFrontmatter(frontmatter: Readonly<Record<string, unknown>>): boolean {
	const type = stripYamlQuotes(readFrontmatterString(frontmatter, ['type'])).toLowerCase();
	if (!type) {
		return Boolean(readFrontmatterString(frontmatter, ['proposal_kind', 'proposalKind']));
	}
	return type.includes('memory-proposal') || type.includes('memory_proposal');
}

function memoryProposalDocumentFromText(
	vaultRoot: string,
	proposalPath: string,
	text: string,
	context: ToolContext
): MemoryProposalDocument {
	const options = pathSafetyOptions(context);
	const normalized = normalizeNotePath(proposalPath, options);
	const absolutePath = resolveSafeNotePath(vaultRoot, normalized, options);
	const relative = relativeFromAbsolute(vaultRoot, absolutePath);
	assertReviewQueuePath(relative);

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

function readMemoryProposal(vaultRoot: string, proposalPath: string, context: ToolContext): MemoryProposalDocument {
	const options = pathSafetyOptions(context);
	const normalized = normalizeNotePath(proposalPath, options);
	const absolutePath = resolveSafeNotePath(vaultRoot, normalized, options);
	return memoryProposalDocumentFromText(
		vaultRoot,
		normalized,
		fs.readFileSync(absolutePath, 'utf8'),
		context
	);
}

async function findMemoryProposalPathById(
	vaultRoot: string,
	proposalId: string,
	context: ToolInvocationContext
): Promise<string> {
	const normalizedId = stripYamlQuotes(proposalId);
	if (!normalizedId) {
		throw new ToolInputError('proposal_id is required.');
	}

	const view = await knowledgeReadViewForContext(vaultRoot, context);
	const records = [...view.catalog.values()].flatMap((note) => {
		const location = proposalHistoryLocation(note.path);
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
	const resolution = resolveProposalHistoryById(records, normalizedId);
	if (resolution.status === 'missing') {
		throw new ToolInputError(`Approved writeback proposal not found: ${normalizedId}`);
	}
	if (resolution.status === 'ambiguous') {
		throw new ToolInputError(
			`Approved writeback proposal id is ambiguous: ${normalizedId}`
		);
	}
	return resolution.record.path;
}

async function resolveMemoryProposalFromArgs(
	vaultRoot: string,
	rawArgs: ApplyApprovedWritebackArgs,
	context: ToolInvocationContext
): Promise<MemoryProposalDocument> {
	const explicitPath = coerceOptionalString(rawArgs.proposal_path) || coerceOptionalString(rawArgs.path);
	const proposalPath = explicitPath || (
		coerceOptionalString(rawArgs.proposal_id)
			? await findMemoryProposalPathById(
				vaultRoot,
				coerceOptionalString(rawArgs.proposal_id),
				context
			)
			: ''
	);
	if (!proposalPath) {
		throw new ToolInputError('proposal_id or proposal_path is required.');
	}

	if (context.vaultRepository) {
		const normalized = normalizeNotePath(proposalPath, pathSafetyOptions(context));
		assertReviewQueuePath(normalized);
		const file = await context.vaultRepository.readText(normalized);
		if (!file) {
			throw new ToolInputError(`Approved writeback proposal not found: ${normalized}`);
		}
		return memoryProposalDocumentFromText(vaultRoot, file.path, file.content, context);
	}
	return readMemoryProposal(vaultRoot, proposalPath, context);
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
	const createsMemoryRecord = Boolean(
		stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['claim_key']))
	);

	if (!proposal.targetNote && !createsMemoryRecord) {
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
		effectKind: createsMemoryRecord ? 'create_memory_record' : 'append',
	};
}

const WRITEBACK_CONFIRMATION_SCHEMA_VERSION = 1 as const;
const DEFAULT_WRITEBACK_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const PROCESS_WRITEBACK_CONFIRMATION_SECRET = crypto.randomBytes(32);

interface CurrentVaultTextState {
	path: string;
	content: string;
	contentHash: string;
	version?: string;
}

interface WritebackConfirmationBinding {
	schemaVersion: typeof WRITEBACK_CONFIRMATION_SCHEMA_VERSION;
	previewNonce: string;
	operationId: string;
	idempotencyKey: string;
	proposalId: string;
	proposalPath: string;
	proposalRevision: string;
	proposalContentHash: string;
	proposalFileHash: string;
	approvalOperationId: string;
	targetPath: string;
	targetContentHash: string;
	proposalTaskId: string;
	taskId: string | null;
	taskPath: string | null;
	taskContentHash: string;
	taskLinkedContentHash: string;
	taskHadTargetReference: boolean;
	taskHadProposalReference: boolean;
	taskHadProposalIdReference?: boolean;
	taskHadProposalPathEvidence?: boolean;
	writebackContentHash: string;
	writebackBlockHash: string;
	writebackMarker: string;
	touchedNotes: string[];
	activityAgentId: string;
	activitySessionId: string;
	activityClientName: string;
	effectKind?: 'append' | 'create_memory_record';
	issuedAt: number;
	expiresAt: number;
}

interface PreparedWritebackConfirmation {
	binding: WritebackConfirmationBinding;
	writebackBlock: string;
}

const hashText = (value: string): string =>
	crypto.createHash('sha256').update(value).digest('hex');

const proposalScalarText = (value: unknown): string => {
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

const proposalScalarField = (
	frontmatter: Readonly<Record<string, unknown>>,
	keys: readonly string[],
	label: string
): string => {
	const values = keys
		.map((key) => {
			const value = frontmatter[key];
			if (
				value !== undefined
				&& value !== null
				&& (typeof value === 'object' || typeof value === 'function')
			) {
				throw new ProposalTransitionValidationError(`${label} is invalid.`);
			}
			return proposalScalarText(value).trim();
		})
		.filter(Boolean);
	if (new Set(values).size > 1) {
		throw new ProposalTransitionValidationError(`${label} fields conflict.`);
	}
	return values[0] || '';
};

const proposalMultilineField = (
	frontmatter: Readonly<Record<string, unknown>>,
	keys: readonly string[],
	label: string
): string => {
	const values = keys
		.map((key) => {
			const value = frontmatter[key];
			if (Array.isArray(value)) {
				return value.map(proposalScalarText).join('\n').trim();
			}
			if (
				value !== undefined
				&& value !== null
				&& (typeof value === 'object' || typeof value === 'function')
			) {
				throw new ProposalTransitionValidationError(`${label} is invalid.`);
			}
			return proposalScalarText(value).replace(/\\n/g, '\n').trim();
		})
		.filter(Boolean);
	if (new Set(values).size > 1) {
		throw new ProposalTransitionValidationError(`${label} fields conflict.`);
	}
	return values[0] || '';
};

const proposalTransitionStatus = (
	frontmatter: Readonly<Record<string, unknown>>
): ProposalTransitionStatus => {
	const values = ['approval_status', 'approvalStatus', 'status']
		.map((key) => {
			const value = frontmatter[key];
			if (
				value !== undefined
				&& value !== null
				&& (typeof value === 'object' || typeof value === 'function')
			) {
				throw new ProposalTransitionValidationError('Proposal status is invalid.');
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
	if (
		values.some((value) =>
			![
				'pending',
				'approved',
				'rejected',
				'deferred',
				'revision_requested',
				'applied',
			].includes(value)
		)
	) {
		throw new ProposalTransitionValidationError('Proposal status is invalid.');
	}
	if (new Set(values).size > 1) {
		throw new ProposalTransitionValidationError('Proposal status fields conflict.');
	}
	return values[0] as ProposalTransitionStatus;
};

function proposalTransitionSnapshot(
	proposal: MemoryProposalDocument
): ProposalTransitionSnapshot {
	const parsed = parseMarkdown(proposal.text);
	if (parsed.frontmatter.errors.length > 0) {
		throw new ProposalTransitionValidationError('Proposal frontmatter is invalid.');
	}
	const frontmatter = parsed.frontmatter.fields;
	const proposalKind = proposalScalarField(
		frontmatter,
		['proposal_kind', 'proposalKind'],
		'Proposal kind'
	);
	const rawType = proposalScalarField(frontmatter, ['type'], 'Proposal type');
	const normalizedType = rawType.toLowerCase().replace(/_/g, '-');
	const classification = normalizedType === 'memory-proposal'
		? 'memory_proposal'
		: proposalKind && !rawType
			? 'memory_proposal'
			: null;
	if (!classification) {
		throw new ProposalTransitionValidationError('Proposal is not a memory proposal.');
	}
	const frontmatterWriteback = proposalMultilineField(
		frontmatter,
		['writeback_content', 'writebackContent'],
		'Proposal writeback content'
	);
	const bodyWriteback = extractMarkdownSection(
		parsed.body,
		['writeback', 'approved writeback', 'writeback content', '写回', '已批准写回', '写回内容']
	);
	if (
		frontmatterWriteback
		&& bodyWriteback
		&& frontmatterWriteback.replace(/\r\n/g, '\n').trim()
			!== bodyWriteback.replace(/\r\n/g, '\n').trim()
	) {
		throw new ProposalTransitionConflictError('Proposal writeback sources conflict.');
	}
	const lastTransition = proposalTransitionReceiptFromFrontmatter(frontmatter);
	return {
		path: proposal.path,
		classification,
		proposalId: proposalScalarField(
			frontmatter,
			['proposal_id', 'proposalId'],
			'Proposal id'
		) || path.basename(proposal.path, path.extname(proposal.path)),
		proposalKind: proposalKind || classification,
		taskId: proposalScalarField(frontmatter, ['task_id', 'taskId'], 'Task id'),
		status: proposalTransitionStatus(frontmatter),
		targetPath: proposalScalarField(
			frontmatter,
			['target_note', 'targetNote', 'target_path', 'targetPath'],
			'Proposal target'
		),
		writebackContent: frontmatterWriteback || bodyWriteback,
		revisionComment: proposalMultilineField(
			frontmatter,
			['revision_comment', 'revisionComment'],
			'Revision comment'
		),
		revisionRequestedAt: proposalScalarField(
			frontmatter,
			['revision_requested_at', 'revisionRequestedAt'],
			'Revision request time'
		),
		revisionRequestedBy: proposalScalarField(
			frontmatter,
			['revision_requested_by', 'revisionRequestedBy'],
			'Revision requester'
		),
		archived: false,
		appliedOperationId: proposalScalarField(
			frontmatter,
			['writeback_operation_id', 'writebackOperationId'],
			'Applied operation id'
		) || (
			lastTransition?.kind === 'apply'
				? lastTransition.operationId
				: undefined
		),
		lastTransition,
	};
}

async function readCurrentVaultTextState(
	vaultRoot: string,
	relativePath: string,
	context: ToolContext
): Promise<CurrentVaultTextState | null> {
	const normalized = normalizeNotePath(relativePath, pathSafetyOptions(context));
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
	let absolute: string;
	try {
		absolute = resolveSafeNotePath(vaultRoot, normalized, pathSafetyOptions(context));
	} catch (error: unknown) {
		if (error instanceof VaultPathError && /not found/i.test(error.message)) {
			return null;
		}
		throw error;
	}
	assertNoSymlinkSegments(vaultRoot, absolute);
	try {
		const content = fs.readFileSync(absolute, 'utf8');
		return {
			path: relativeFromAbsolute(vaultRoot, absolute),
			content,
			contentHash: hashText(content),
		};
	} catch (error: unknown) {
		if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

function writebackConfirmationNow(context: ToolInvocationContext): number {
	const now = context.writebackConfirmationClock
		? context.writebackConfirmationClock()
		: Date.now();
	if (!Number.isFinite(now) || now < 0) {
		throw new ToolInputError('Writeback confirmation clock is invalid.');
	}
	return now;
}

function writebackConfirmationTtl(context: ToolInvocationContext): number {
	const ttl = context.writebackConfirmationTtlMs ?? DEFAULT_WRITEBACK_CONFIRMATION_TTL_MS;
	if (!Number.isSafeInteger(ttl) || ttl <= 0) {
		throw new ToolInputError('Writeback confirmation expiry is invalid.');
	}
	return ttl;
}

function writebackConfirmationSecret(context: ToolInvocationContext): Buffer {
	if (context.writebackConfirmationSecret === undefined) {
		return PROCESS_WRITEBACK_CONFIRMATION_SECRET;
	}
	const secret = typeof context.writebackConfirmationSecret === 'string'
		? Buffer.from(context.writebackConfirmationSecret, 'utf8')
		: Buffer.from(context.writebackConfirmationSecret);
	if (secret.byteLength < 32) {
		throw new ToolInputError('Writeback confirmation secret must contain at least 32 bytes.');
	}
	return secret;
}

function isWritebackConfirmationBinding(value: unknown): value is WritebackConfirmationBinding {
	if (!isRecord(value)) {
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
	] as const;
	const hasStableProposalReferenceFlags =
		typeof value.taskHadProposalIdReference === 'boolean'
		&& typeof value.taskHadProposalPathEvidence === 'boolean';
	const hasPartialStableProposalReferenceFlags =
		value.taskHadProposalIdReference !== undefined
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
		&& (value.proposalId as string).length > 0
		&& (value.proposalRevision as string).length > 0
		&& (value.proposalContentHash as string).length > 0
		&& (value.proposalFileHash as string).length > 0
		&& (value.approvalOperationId as string).length > 0
		&& (value.targetPath as string).length > 0
		&& (value.targetContentHash as string).length > 0
		&& (value.writebackContentHash as string).length > 0
		&& (value.writebackBlockHash as string).length > 0
		&& (value.writebackMarker as string).length > 0
		&& (value.taskId === null || typeof value.taskId === 'string')
		&& (value.taskPath === null || typeof value.taskPath === 'string')
		&& typeof value.taskHadTargetReference === 'boolean'
		&& typeof value.taskHadProposalReference === 'boolean'
		&& (!hasPartialStableProposalReferenceFlags || hasStableProposalReferenceFlags)
		&& (
			(
				value.taskId === null
				&& value.taskPath === null
				&& value.taskContentHash === ''
				&& value.taskLinkedContentHash === ''
				&& value.taskHadTargetReference === false
				&& value.taskHadProposalReference === false
				&& value.taskHadProposalIdReference !== true
				&& value.taskHadProposalPathEvidence !== true
			)
			|| (
				typeof value.taskId === 'string'
				&& value.taskId.length > 0
				&& typeof value.taskPath === 'string'
				&& value.taskPath.length > 0
				&& (value.taskContentHash as string).length > 0
				&& (value.taskLinkedContentHash as string).length > 0
			)
		)
		&& Array.isArray(value.touchedNotes)
		&& value.touchedNotes.length >= 3
		&& value.touchedNotes.length <= 4
		&& value.touchedNotes.every((item) => typeof item === 'string')
		&& new Set(value.touchedNotes).size === value.touchedNotes.length
		&& stringKeys.every((key) => (value[key] as string).length <= 2048)
		&& typeof value.issuedAt === 'number'
		&& Number.isSafeInteger(value.issuedAt)
		&& typeof value.expiresAt === 'number'
		&& Number.isSafeInteger(value.expiresAt)
		&& (value.effectKind === undefined
			|| value.effectKind === 'append'
			|| value.effectKind === 'create_memory_record');
}

function createWritebackConfirmationToken(
	binding: WritebackConfirmationBinding,
	context: ToolInvocationContext
): string {
	const payload = Buffer.from(JSON.stringify(binding), 'utf8').toString('base64url');
	const signature = crypto
		.createHmac('sha256', writebackConfirmationSecret(context))
		.update(payload)
		.digest('base64url');
	return `${payload}.${signature}`;
}

function parseWritebackConfirmationToken(
	token: string,
	context: ToolInvocationContext
): WritebackConfirmationBinding {
	const parts = canonicalWritebackTokenParts(token);
	const expected = crypto
		.createHmac('sha256', writebackConfirmationSecret(context))
		.update(parts[0])
		.digest();
	const supplied = decodeCanonicalBase64Url(parts[1]);
	if (supplied.byteLength !== expected.byteLength || !crypto.timingSafeEqual(supplied, expected)) {
		throw new ToolInputError('Writeback confirmation token is invalid or tampered.');
	}
	return decodeWritebackConfirmationToken(token);
}

function decodeCanonicalBase64Url(value: string): Buffer {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) {
		throw new ToolInputError('Writeback confirmation token is invalid.');
	}
	let decoded: Buffer;
	try {
		decoded = Buffer.from(value, 'base64url');
	} catch {
		throw new ToolInputError('Writeback confirmation token is invalid.');
	}
	if (decoded.toString('base64url') !== value) {
		throw new ToolInputError('Writeback confirmation token is invalid.');
	}
	return decoded;
}

function canonicalWritebackTokenParts(token: string): [string, string] {
	if (token.length > 16_384) {
		throw new ToolInputError('Writeback confirmation token is invalid.');
	}
	const parts = token.split('.');
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		throw new ToolInputError('Writeback confirmation token is invalid.');
	}
	decodeCanonicalBase64Url(parts[0]);
	const signature = decodeCanonicalBase64Url(parts[1]);
	if (signature.byteLength !== 32) {
		throw new ToolInputError('Writeback confirmation token is invalid.');
	}
	return [parts[0], parts[1]];
}

function decodeWritebackConfirmationToken(
	token: string
): WritebackConfirmationBinding {
	const parts = canonicalWritebackTokenParts(token);
	const payload = parts[0];
	let decoded: unknown;
	try {
		decoded = JSON.parse(decodeCanonicalBase64Url(payload).toString('utf8'));
	} catch {
		throw new ToolInputError('Writeback confirmation token is invalid.');
	}
	if (!isWritebackConfirmationBinding(decoded)) {
		throw new ToolInputError('Writeback confirmation token is invalid.');
	}
	return decoded;
}

function buildApprovedWritebackBlock(
	proposalId: string,
	writebackContent: string
): { block: string; marker: string } {
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

function writebackTargetFrame(writebackBlock: string): string {
	return `\n\n${writebackBlock}\n`;
}

function reversibleWritebackTargetPrefix(
	currentContent: string,
	payload: ApplyApprovedWritebackPayload
): string | null {
	const heading = `## Approved Writeback: ${payload.proposalId}`;
	const startMarker = `\n\n${heading}\n`;
	const start = currentContent.lastIndexOf(startMarker);
	if (start < 0 || !currentContent.endsWith(`\n${payload.writebackMarker}\n`)) {
		return null;
	}
	const block = currentContent.slice(start + 2, -1);
	const original = currentContent.slice(0, start);
	if (
		hashText(block) !== payload.writebackBlockHash
		|| hashText(original) !== payload.targetContentHash
	) {
		return null;
	}
	return original;
}

function resolveWritebackTaskId(
	rawArgs: ApplyApprovedWritebackArgs,
	proposal: MemoryProposalDocument
): string | null {
	const explicit = coerceOptionalString(rawArgs.task_id);
	if (explicit && proposal.taskId && explicit !== proposal.taskId) {
		throw new ToolInputError('Writeback task identity changed from the approved proposal.');
	}
	return explicit || proposal.taskId || null;
}

function validateApprovedWritebackTransition(
	snapshot: ProposalTransitionSnapshot,
	operationId: string,
	targetPath: string,
	targetExists: boolean,
	context: ToolInvocationContext,
	now: string
): void {
	const approval = snapshot.lastTransition;
	if (
		!approval
		|| approval.kind !== 'status'
		|| approval.nextStatus !== 'approved'
		|| !approval.operationId
	) {
		throw new ProposalTransitionValidationError(
			'Approved proposal is missing its committed approval operation.'
		);
	}
	transitionProposal(
		snapshot,
		{
			expectedRevision: computeProposalRevision(snapshot),
			expectedContentHash: computeProposalContentHash(snapshot),
			operationId,
			action: { kind: 'apply' },
		},
		{
			now,
			actor: context.agentId || 'tracekeeper-runtime',
			targetAllowed: isAllowedProposalTargetPath,
			targetExists: (relativePath) =>
				targetExists && relativePath === targetPath,
		}
	);
}

async function resolveApprovedMemoryRecordTargetPath(
	vaultRoot: string,
	proposal: MemoryProposalDocument,
	context: ToolInvocationContext
): Promise<string> {
	if (proposal.targetNote) {
		const explicit = normalizeNotePath(proposal.targetNote, pathSafetyOptions(context));
		if (
			explicit.startsWith(`${KNOWLEDGE_GLOBAL_MEMORY_DIR}/`)
			|| explicit.startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)
		) {
			return explicit;
		}
		throw new ToolInputError('Governed memory record target must stay inside a memory root.');
	}
	const scope = stripYamlQuotes(
		readFrontmatterString(proposal.frontmatter, ['memory_scope'])
	).toLowerCase() || 'global';
	const agentType = normalizeProjectAgentType(
		context.observedClientType ?? context.clientName ?? 'custom'
	);
	const safeProposalId = proposal.proposalId
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 120);
	if (!safeProposalId) {
		throw new ToolInputError('Approved memory proposal id cannot form a record path.');
	}
	if (scope === 'global') {
		return `${KNOWLEDGE_GLOBAL_MEMORY_DIR}/agents/${agentType}/approved-${safeProposalId}.md`;
	}
	if (scope !== 'project') {
		throw new ToolInputError('Approved memory proposal scope must be global or project.');
	}
	const projectId = stripYamlQuotes(
		readFrontmatterString(proposal.frontmatter, ['project_id'])
	);
	if (!projectId) {
		throw new ToolInputError('Approved project memory proposal requires project_id.');
	}
	const view = await knowledgeReadViewForContext(vaultRoot, context);
	const hub = [...view.catalog.values()].find((entry) =>
		entry.frontmatter.type === 'project_memory_index'
		&& entry.frontmatter.project_id === projectId
	);
	if (!hub) {
		throw new ToolInputError('Approved project memory proposal has no exact project Hub.');
	}
	return `${path.posix.dirname(hub.path)}/agents/${agentType}/approved-${safeProposalId}.md`;
}

function buildApprovedMemoryRecordMarkdown(
	vaultRoot: string,
	proposal: MemoryProposalDocument,
	targetPath: string,
	operationId: string,
	context: ToolInvocationContext
): string {
	const scopeValue = stripYamlQuotes(
		readFrontmatterString(proposal.frontmatter, ['memory_scope'])
	).toLowerCase() || 'global';
	if (scopeValue !== 'global' && scopeValue !== 'project') {
		throw new ToolInputError('Approved memory proposal scope is invalid.');
	}
	const scope = scopeValue as 'global' | 'project';
	const projectId = scope === 'project'
		? stripYamlQuotes(readFrontmatterString(proposal.frontmatter, ['project_id']))
		: '';
	const claimKey = stripYamlQuotes(
		readFrontmatterString(proposal.frontmatter, ['claim_key'])
	);
	if (!claimKey || (scope === 'project' && !projectId)) {
		throw new ToolInputError('Approved memory proposal is missing its governed identity.');
	}
	const relatedWiki = readFrontmatterStringList(proposal.frontmatter, 'related_wiki');
	const relatedSources = readFrontmatterStringList(proposal.frontmatter, 'related_sources');
	const proposedEvidence = Array.isArray(proposal.frontmatter.evidence)
		? proposal.frontmatter.evidence.filter((value): value is string => typeof value === 'string')
		: [];
	const evidence = [...new Set([...proposedEvidence, ...relatedSources, ...relatedWiki])];
	const proposedAuthority = stripYamlQuotes(
		readFrontmatterString(proposal.frontmatter, ['proposed_authority'])
	).toLowerCase();
	const authority = proposedAuthority === 'user'
		? 'user'
		: proposedAuthority === 'source' && evidence.length > 0
			? 'source'
			: 'agent';
	const proposedConfidence = stripYamlQuotes(
		readFrontmatterString(proposal.frontmatter, ['proposed_confidence'])
	).toLowerCase();
	const confidence = proposedConfidence === 'verified' && evidence.length > 0
		? 'verified'
		: proposedConfidence === 'supported' && evidence.length > 0
			? 'supported'
			: proposedConfidence === 'uncertain'
				? 'uncertain'
				: evidence.length > 0 ? 'inferred' : 'uncertain';
	const declaredValue = stripYamlQuotes(
		readFrontmatterString(proposal.frontmatter, ['declared_state'])
	).toLowerCase();
	const declaredState = ['active', 'disputed', 'retracted', 'review'].includes(declaredValue)
		? declaredValue as 'active' | 'disputed' | 'retracted' | 'review'
		: 'active';
	const projectHub = scope === 'project'
		? `${path.posix.dirname(path.posix.dirname(path.posix.dirname(targetPath)))}/index.md`
		: null;
	const memoryId = `memory-${crypto.createHash('sha256')
		.update(`${proposal.proposalId}\0${claimKey}`, 'utf8')
		.digest('hex')
		.slice(0, 32)}`;
	const repository = projectMemoryRepository(vaultRoot, context);
	const memoryLink = (target: string) => repository.generateMarkdownLink
		? repository.generateMarkdownLink(target, targetPath)
		: `[[${target.replace(/\.md$/i, '')}]]`;
	const relations = [
		...(projectHub ? [`- Project hub: ${memoryLink(projectHub)}`] : []),
		...(scope === 'global' ? [`- Global hub: ${memoryLink(KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH)}`] : []),
		...relatedWiki.map((target) => `- Wiki: ${memoryLink(target)}`),
		...relatedSources.map((target) => `- Source: ${memoryLink(target)}`),
	];
	return buildMemoryRecord({
		path: targetPath,
		memory_id: memoryId,
		scope,
		project_id: scope === 'project' ? projectId : null,
		agent_type: normalizeProjectAgentType(context.observedClientType ?? context.clientName ?? 'custom'),
		operation_id: operationId,
		memory_kind: proposal.proposalKind.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase().slice(0, 64),
		claim_key: claimKey,
		authority,
		confidence_level: confidence,
		declared_state: declaredState,
		observed_at: readFrontmatterString(proposal.frontmatter, ['observed_at']) || new Date().toISOString(),
		valid_from: readFrontmatterString(proposal.frontmatter, ['valid_from']) || null,
		valid_to: readFrontmatterString(proposal.frontmatter, ['valid_to']) || null,
		last_verified_at: readFrontmatterString(proposal.frontmatter, ['last_verified_at']) || null,
		evidence,
		supersedes: readFrontmatterStringList(proposal.frontmatter, 'supersedes'),
		contradicts: readFrontmatterStringList(proposal.frontmatter, 'contradicts'),
		project_hub: projectHub,
		global_hub: scope === 'global' ? KNOWLEDGE_GLOBAL_MEMORY_INDEX_PATH : null,
		related_wiki: relatedWiki,
		related_sources: relatedSources,
		body: ['# Approved memory record', '', '## Relations', '', ...relations, '', '## Memory', '', proposalTransitionSnapshot(proposal).writebackContent].join('\n'),
	}).markdown;
}

async function prepareWritebackConfirmation(
	vaultRoot: string,
	proposal: MemoryProposalDocument,
	plan: WritebackPlan,
	taskId: string | null,
	context: ToolInvocationContext,
	issuedAt: number,
	expiresAt: number,
	previewNonce = crypto.randomBytes(16).toString('hex')
): Promise<PreparedWritebackConfirmation> {
	if (!plan.ready || !plan.writebackContent) {
		throw new ToolInputError(plan.reason || 'approved writeback is not ready to apply.');
	}
	const snapshot = proposalTransitionSnapshot(proposal);
	if (snapshot.status !== 'approved') {
		throw new ToolInputError(`proposal approval_status/status is ${snapshot.status}`);
	}
	const targetPath = normalizeNotePath(
		plan.effectKind === 'create_memory_record'
			? await resolveApprovedMemoryRecordTargetPath(vaultRoot, proposal, context)
			: plan.targetNote,
		pathSafetyOptions(context)
	);
	assertAllowedWritebackTarget(targetPath);
	const target = await readCurrentVaultTextState(vaultRoot, targetPath, context);
	if (!target && plan.effectKind !== 'create_memory_record') {
		throw new ToolInputError(`Writeback target does not exist: ${targetPath}`);
	}
	const taskPath = taskId ? buildTaskNotePath(taskId) : null;
	const task = taskPath
		? await readCurrentVaultTextState(vaultRoot, taskPath, context)
		: null;
	if (taskPath && !task) {
		throw new ToolInputError(
			`Writeback confirmation is stale because the task does not exist: ${taskPath}`
		);
	}
	const taskFrontmatter = task
		? parseMarkdown(task.content).frontmatter.fields
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
	const taskLinkedContent = task && (
		!taskHadTargetReference
		|| !taskHadProposalIdReference
		|| !taskHadProposalPathEvidence
	)
		? updateFrontmatterFields(task.content, {
			memory_writes: mergeFrontmatterList(taskFrontmatter, 'memory_writes', [targetPath]),
			proposal_ids: mergeFrontmatterList(
				taskFrontmatter,
				'proposal_ids',
				[proposal.proposalId]
			),
			proposal_paths: mergeFrontmatterList(
				taskFrontmatter,
				'proposal_paths',
				[proposal.path]
			),
		})
		: task?.content || '';
	const proposalRevision = computeProposalRevision(snapshot);
	const identity = buildApprovedWritebackOperationIdentity(
		proposal,
		proposalRevision,
		previewNonce
	);
	validateApprovedWritebackTransition(
		snapshot,
		identity.operationId,
		targetPath,
		plan.effectKind === 'create_memory_record' || Boolean(target),
		context,
		new Date(issuedAt).toISOString()
	);
	const writeback = plan.effectKind === 'create_memory_record'
		? {
			block: buildApprovedMemoryRecordMarkdown(vaultRoot, proposal, targetPath, identity.operationId, context),
			marker: `memory-record:${snapshot.proposalId}`,
		}
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
			proposalContentHash: computeProposalContentHash(snapshot),
			proposalFileHash: computePayloadHash(proposal.text),
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

function writebackBindingPayload(
	binding: WritebackConfirmationBinding,
	confirmationToken: string
): ApplyApprovedWritebackPayload {
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
		activityPath: AGENT_ACTIVITY_PATH,
		activityAgentId: binding.activityAgentId,
		activitySessionId: binding.activitySessionId,
		activityClientName: binding.activityClientName,
		...(binding.effectKind ? { effectKind: binding.effectKind } : {}),
	};
}

function isApplyApprovedWritebackPayload(
	value: unknown
): value is ApplyApprovedWritebackPayload {
	if (!isRecord(value)) {
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
	] as const;
	const hasStableProposalReferenceFlags =
		typeof value.taskHadProposalIdReference === 'boolean'
		&& typeof value.taskHadProposalPathEvidence === 'boolean';
	const hasPartialStableProposalReferenceFlags =
		value.taskHadProposalIdReference !== undefined
		|| value.taskHadProposalPathEvidence !== undefined;
	return value.schemaVersion === WRITEBACK_CONFIRMATION_SCHEMA_VERSION
		&& requiredStrings.every((key) => typeof value[key] === 'string')
		&& requiredStrings.every((key) => (value[key] as string).length <= 2048)
		&& (value.proposalId as string).length > 0
		&& (value.proposalId as string).length <= 512
		&& (value.proposalRevision as string).length > 0
		&& (value.proposalContentHash as string).length > 0
		&& (value.proposalFileHash as string).length > 0
		&& (value.approvalOperationId as string).length > 0
		&& (value.targetPath as string).length > 0
		&& (value.targetContentHash as string).length > 0
		&& (value.writebackContentHash as string).length > 0
		&& (value.writebackBlockHash as string).length > 0
		&& (value.writebackMarker as string).length > 0
		&& (value.confirmationTokenHash as string).length > 0
		&& (value.activityPath as string).length > 0
		&& !Number.isNaN(Date.parse(value.confirmationExpiresAt as string))
		&& (value.taskId === null || typeof value.taskId === 'string')
		&& (value.taskId === null || value.taskId.length <= 512)
		&& (value.taskPath === null || typeof value.taskPath === 'string')
		&& (value.taskPath === null || value.taskPath.length <= 2048)
		&& typeof value.taskHadTargetReference === 'boolean'
		&& typeof value.taskHadProposalReference === 'boolean'
		&& (!hasPartialStableProposalReferenceFlags || hasStableProposalReferenceFlags)
		&& (
			(
				value.taskId === null
				&& value.taskPath === null
				&& value.taskContentHash === ''
				&& value.taskLinkedContentHash === ''
				&& value.taskHadTargetReference === false
				&& value.taskHadProposalReference === false
				&& value.taskHadProposalIdReference !== true
				&& value.taskHadProposalPathEvidence !== true
			)
			|| (
				typeof value.taskId === 'string'
				&& value.taskId.length > 0
				&& typeof value.taskPath === 'string'
				&& value.taskPath.length > 0
				&& (value.taskContentHash as string).length > 0
				&& (value.taskLinkedContentHash as string).length > 0
			)
		)
		&& Array.isArray(value.touchedNotes)
		&& value.touchedNotes.length >= 3
		&& value.touchedNotes.length <= 4
		&& value.touchedNotes.every(
			(item) => typeof item === 'string' && item.length > 0 && item.length <= 2048
		)
		&& new Set(value.touchedNotes).size === value.touchedNotes.length
		&& (value.effectKind === undefined
			|| value.effectKind === 'append'
			|| value.effectKind === 'create_memory_record');
}

function formatFrontmatterUpdateValue(value: string | string[]): string {
	if (Array.isArray(value)) {
		return JSON.stringify(value);
	}
	if (/^[A-Za-z0-9._/-]+$/.test(value)) {
		return value;
	}
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function updateFrontmatterFields(
	content: string,
	fields: Readonly<Record<string, ProposalFrontmatterMutationValue>>
): string {
	const normalized = content.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const renderedFields = Object.entries(fields)
		.filter((entry): entry is [string, string | string[]] => entry[1] !== null)
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

function replaceTextFileAtomically(absolutePath: string, content: string, expectedContent?: string): void {
	const tempPath = `${absolutePath}.${crypto.randomUUID()}.tmp`;
	const mode = fs.statSync(absolutePath).mode;
	try {
		fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode });
		if (expectedContent !== undefined && fs.readFileSync(absolutePath, 'utf8') !== expectedContent) {
			throw new OperationConflictError('File changed before atomic replace.');
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
	if (!isAllowedProposalTargetPath(relativePath)) {
		throw new ToolInputError(
			`Approved writeback target is outside the allowed Memory or Wiki boundary: ${relativePath}`
		);
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
			throw new ToolInputError(`Approved writeback target is protected from direct apply: ${relativePath}`);
		}
	}
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

function buildCatalogCounts(entries: Iterable<KnowledgeCatalogEntry>) {
	const typeCount: Record<string, number> = {};
	for (const entry of entries) {
		const type = entry.type ?? 'note';
		typeCount[type] = (typeCount[type] ?? 0) + 1;
	}
	return Object.entries(typeCount)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([type, count]) => ({ type, count }));
}

function materializeLightweightNotes(view: KnowledgeReadView): ScannedNote[] {
	const edgesBySource = new Map<string, typeof view.graph.edges>();
	for (const edge of [...view.graph.edges, ...view.graph.unresolvedEdges]) {
		const sourcePath = edge.sourcePath ?? '';
		if (!sourcePath) continue;
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

function lightweightScanFromReadView(vaultRoot: string, view: KnowledgeReadView): ScanResult {
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

function contextPackFromReadViewRecall(
	vaultRoot: string,
	query: string,
	result: GlobalRecallApplicationResult | ProjectRecallApplicationResult,
	view: KnowledgeReadView,
	staleAfterDays: number
): ContextPack {
	const matches = 'matches' in result ? result.matches : result.entries;
	const staleCutoff = Date.now() - staleAfterDays * 86_400_000;
	const sourceCandidates = matches
		.filter((match) => isKnowledgeSourcePath(match.path) || match.note_type?.includes('source'))
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
			TRACEKEEPER_CONTEXT_PACKS_DIR,
			TRACEKEEPER_REVIEW_QUEUE_DIR,
			KNOWLEDGE_SOURCES_DIR,
			TRACEKEEPER_SESSIONS_DIR,
		].map((entry) => path.join(vaultRoot, entry)),
		scanErrors: view.errors.map((error) => ({ ...error })),
	};
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

function isPendingProposal(note: { frontmatter: Readonly<Record<string, unknown>> }) {
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

function boundedWritebackErrorMessage(
	error: unknown,
	vaultRoot: string | null
): string {
	const isExpected = error instanceof ToolInputError
		|| error instanceof VaultPathError
		|| error instanceof OperationConflictError
		|| error instanceof ProposalTransitionValidationError
		|| error instanceof ProposalTransitionStateError;
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
		.replace(
			/(^|[\s("'`])\/(?:[^\s"'`<>|:]+\/?)+/g,
			(_match, prefix: string) => `${prefix}<absolute-path>`
		)
		.replace(
			/(^|[\s("'`])[A-Za-z]:\\(?:[^\s"'`<>|]+\\?)+/g,
			(_match, prefix: string) => `${prefix}<absolute-path>`
		);
	return truncateSummaryText(message || 'Approved writeback failed.', 512);
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
	metadata: Record<string, unknown> = {},
	operationId = ''
): ReturnType<VaultRecordAdapter['buildAndWriteNote']> {
	return vaultRecordAdapter.buildAndWriteNote(
		vaultRoot,
		toolName,
		allowedDir,
		filename,
		frontmatter,
		body,
		taskId,
		context,
		metadata,
		operationId
	);
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
): Promise<ReturnType<VaultRecordAdapter['buildAndWriteNote']>> {
	return vaultRecordAdapter.buildAndWriteNoteAsync(
		vaultRoot,
		toolName,
		allowedDir,
		filename,
		frontmatter,
		body,
		taskId,
		context,
		metadata,
		operationId
	);
}

function findOperationOwnedNote(
	vaultRoot: string,
	allowedDir: string,
	filename: string,
	operationField: string,
	operationId: string,
	context: ToolContext
): ReturnType<VaultRecordAdapter['findOperationOwnedNote']> {
	return vaultRecordAdapter.findOperationOwnedNote(
		vaultRoot,
		allowedDir,
		filename,
		operationField,
		operationId,
		context
	);
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
): { path: string; activity_path: string; status: 'written' | 'skipped'; warnings: string[]; duplicate: boolean } {
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
				activity_path: audit.path,
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
		activity_path: audit.path,
		status: 'written',
		warnings: [],
		duplicate: false,
	};
}

async function appendAutoMemoryWriteAsync(
	vaultRoot: string,
	input: AutoMemoryWriteInput
): Promise<{ path: string; activity_path: string; status: 'written' | 'skipped'; warnings: string[]; duplicate: boolean }> {
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
				activity_path: audit.path,
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
		activity_path: audit.path,
		status: 'written',
		warnings: [],
		duplicate: false,
	};
}

interface ImmutableProjectMemoryWriteInput {
	toolName: 'tracekeeper.propose_memory' | 'tracekeeper.finish_task';
	projectId?: unknown;
	projectHint?: unknown;
	repoPath?: unknown;
	agentType?: unknown;
	taskId: string | null;
	operationId: string;
	operationKind: 'propose_memory' | 'finish_task';
	memoryKinds: string[];
	body: string;
	relatedWiki: string[];
	relatedSources: string[];
	createdAt: string;
	claimKey?: string;
	proposedAuthority?: 'agent' | 'source' | 'user';
	proposedConfidence?: 'uncertain' | 'inferred' | 'supported' | 'verified';
	declaredState?: 'active' | 'disputed' | 'retracted' | 'review';
	observedAt?: string;
	validFrom?: string | null;
	validTo?: string | null;
	lastVerifiedAt?: string | null;
	evidence?: string[];
	supersedes?: string[];
	contradicts?: string[];
	context: ToolContext;
}

type ImmutableProjectMemoryWriteReceipt = {
	status: 'created' | 'exact_retry';
	path: string;
	project_id: string;
	project_hub: string;
	agent_type: string;
	operation_id: string;
	operation_kind: 'propose_memory' | 'finish_task';
	memory_kinds: readonly string[];
	operation_hash: string;
	hub_status: 'existing' | 'created' | 'exact_retry';
	memory_id: string;
	claim_key: string;
	authority: 'agent' | 'source';
	confidence_level: 'uncertain' | 'inferred' | 'supported';
	effective_state: 'current';
	activity_path: string;
	write_status: 'written' | 'skipped';
	duplicate: boolean;
};

type ImmutableProjectMemoryReviewRequired = {
	status: 'review_required';
	reason: string;
	warnings: readonly string[];
};

async function writeImmutableProjectMemory(
	vaultRoot: string,
	input: ImmutableProjectMemoryWriteInput
): Promise<
	ImmutableProjectMemoryReviewRequired
	| ImmutableProjectMemoryWriteReceipt
> {
	const project = await projectMemoryApplication(
		vaultRoot,
		input.context
	).ensureWritableProject({
		projectId: input.projectId,
		projectHint: input.projectHint,
		repoPath: input.repoPath,
	});
	if (project.status === 'review_required') {
		return project;
	}
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
	const agentType = normalizeProjectAgentType(input.agentType);
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
	const evidence = [...new Set([
		...(input.evidence ?? []),
		...input.relatedSources,
		...input.relatedWiki,
	])];
	const authority: 'agent' | 'source' =
		input.proposedAuthority === 'source' && evidence.length > 0 ? 'source' : 'agent';
	const confidenceLevel: 'uncertain' | 'inferred' | 'supported' =
		(input.proposedConfidence === 'supported' || input.proposedConfidence === 'verified')
			&& evidence.length > 0
			? 'supported'
			: input.proposedConfidence === 'uncertain'
				? 'uncertain'
				: evidence.length > 0 ? 'inferred' : 'uncertain';
	const currentView = await knowledgeReadViewForContext(vaultRoot, input.context as ToolInvocationContext);
	const currentClaimRecords = currentView.memory.lifecycle.current.filter((row) =>
		row.record.scope === 'project'
		&& row.record.project_id === project.binding.project_id
		&& row.record.claim_key === claimKey
		&& row.record.memory_id !== memoryId
	);
	const declaredRelations = new Set([...(input.supersedes ?? []), ...(input.contradicts ?? [])]);
	if (
		currentClaimRecords.length > 0
		&& currentClaimRecords.some((row) => !declaredRelations.has(row.record.memory_id))
	) {
		return {
			status: 'review_required',
			reason: 'unresolved_claim_conflict',
			warnings: ['An accepted current record already exists for this claim; declare a reviewed lifecycle relation.'],
		};
	}
	const entryPath = buildProjectMemoryEntryPath({
		projectKey: project.binding.project_key,
		agentType,
		operationKind: input.operationKind,
		operationId: input.operationId,
	});
	const repository = projectMemoryRepository(vaultRoot, input.context);
	const memoryLink = (target: string) => repository.generateMarkdownLink
		? repository.generateMarkdownLink(target, entryPath)
		: `[[${target.replace(/\.md$/i, '')}]]`;
	const relationLines = [
		`- Project hub: ${memoryLink(project.binding.project_hub)}`,
		...input.relatedWiki.map((target) => `- Wiki: ${memoryLink(target)}`),
		...input.relatedSources.map((target) => `- Source: ${memoryLink(target)}`),
	];
	const built = buildMemoryRecord({
		path: entryPath,
		memory_id: memoryId,
		scope: 'project',
		project_id: project.binding.project_id,
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
		supersedes: input.supersedes ?? [],
		contradicts: input.contradicts ?? [],
		project_hub: project.binding.project_hub,
		global_hub: null,
		related_wiki: input.relatedWiki,
		related_sources: input.relatedSources,
		body: ['# Project memory record', '', '## Relations', '', ...relationLines, '', '## Memory', '', input.body].join('\n'),
	});
	let status: 'created' | 'exact_retry' = 'created';
	try {
		await repository.createText(entryPath, built.markdown);
	} catch (error) {
		if (!(error instanceof OperationConflictError)) throw error;
		const existing = await repository.readText(entryPath);
		if (existing?.content !== built.markdown) throw error;
		status = 'exact_retry';
	}
	const duplicate = status === 'exact_retry';
	const operationHash = `sha256:${crypto.createHash('sha256').update(built.markdown, 'utf8').digest('hex')}`;
	const audit = await appendAuditEventAsync(vaultRoot, {
		tool: input.toolName,
		targetPath: entryPath,
		status: duplicate ? 'skipped' : 'written',
		operationId: input.operationId,
		taskId: input.taskId,
		metadata: {
			action: duplicate
				? 'project_memory.immutable_write.exact_retry'
				: 'project_memory.immutable_write.created',
			project_id: project.binding.project_id,
			project_hub: project.binding.project_hub,
			agent_type: agentType,
			operation_kind: input.operationKind,
			memory_kinds: input.memoryKinds,
			memory_id: memoryId,
			claim_key: claimKey,
			operation_hash: operationHash,
			hub_status: project.hub_status,
		},
	}, input.context);
	return {
		status,
		path: entryPath,
		project_id: project.binding.project_id,
		project_hub: project.binding.project_hub,
		agent_type: agentType,
		operation_id: input.operationId,
		operation_kind: input.operationKind,
		memory_kinds: input.memoryKinds,
		operation_hash: operationHash,
		hub_status: project.hub_status,
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

async function findOperationOwnedNoteAsync(
	vaultRoot: string,
	allowedDir: string,
	filename: string,
	operationField: string,
	operationId: string,
	context: ToolContext
): ReturnType<VaultRecordAdapter['findOperationOwnedNoteAsync']> {
	return vaultRecordAdapter.findOperationOwnedNoteAsync(
		vaultRoot,
		allowedDir,
		filename,
		operationField,
		operationId,
		context
	);
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

function proposalReferenceMarker(proposalId: string): string {
	const safeId = proposalId
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	return `^tracekeeper-proposal-${safeId || hashText(proposalId).slice(0, 24)}`;
}

async function updateManagedProposalReferences(
	vaultRoot: string,
	recordPath: string,
	proposals: readonly ManagedProposalReference[],
	context: ToolContext
): Promise<void> {
	if (proposals.length === 0) {
		return;
	}
	const current = await readCurrentVaultTextState(vaultRoot, recordPath, context);
	if (!current) {
		throw new OperationConflictError(
			`Tracekeeper-managed proposal reference record is unavailable: ${recordPath}`
		);
	}
	const frontmatter = parseMarkdown(current.content).frontmatter.fields;
	const links = proposals
		.map((proposal) => ({
			...proposal,
			link: generateProposalMarkdownLink(context, proposal.path, current.path)
				|| proposal.link,
		}))
		.filter((proposal): proposal is ManagedProposalReference & { link: string } =>
			Boolean(proposal.link)
		);
	const nextFields: Record<string, string> = {
		proposal_ids: mergeFrontmatterList(
			frontmatter,
			'proposal_ids',
			proposals.map((proposal) => proposal.proposalId)
		),
		proposal_paths: mergeFrontmatterList(
			frontmatter,
			'proposal_paths',
			proposals.map((proposal) => proposal.path)
		),
		proposal_link_targets: mergeFrontmatterList(
			frontmatter,
			'proposal_link_targets',
			proposals.map((proposal) => proposal.linkTarget)
		),
	};
	if (links.length > 0) {
		nextFields.proposal_links = mergeFrontmatterList(
			frontmatter,
			'proposal_links',
			links.map((proposal) => proposal.link)
		);
	}
	let next = updateFrontmatterFields(current.content, nextFields);
	const missingBodyLinks = links.filter(
		(proposal) => !current.content.includes(proposalReferenceMarker(proposal.proposalId))
	);
	if (missingBodyLinks.length > 0) {
		const section = [
			contentText(context, '## 知识变更审核', '## Knowledge Change Review'),
			...missingBodyLinks.map(
				(proposal) =>
					`- ${proposal.link} ${proposalReferenceMarker(proposal.proposalId)}`
			),
		].join('\n');
		next = `${next.replace(/\s*$/, '')}\n\n${section}\n`;
	}
	if (next === current.content) {
		return;
	}
	if (context.vaultRepository) {
		if (!current.version) {
			throw new OperationConflictError(
				`Tracekeeper-managed proposal reference version is unavailable: ${recordPath}`
			);
		}
		await context.vaultRepository.replaceText(current.path, current.version, next);
		return;
	}
	const absolute = resolveSafeNotePath(vaultRoot, current.path, pathSafetyOptions(context));
	replaceTextFileAtomically(absolute, next, current.content);
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

async function linkApprovedWritebackTask(
	vaultRoot: string,
	payload: ApplyApprovedWritebackPayload,
	context: ToolInvocationContext
): Promise<ApplyApprovedWritebackTaskLinkReceipt> {
	if (!payload.taskId) {
		if (
			payload.taskPath !== null
			|| payload.taskContentHash !== ''
			|| payload.taskHadTargetReference
			|| payload.taskHadProposalReference
			|| payload.taskHadProposalIdReference === true
			|| payload.taskHadProposalPathEvidence === true
		) {
			throw new OperationConflictError('Writeback task binding is invalid.');
		}
		return {
			taskPath: null,
			targetReferenceAdded: false,
			proposalReferenceAdded: false,
		};
	}
	const expectedPath = buildTaskNotePath(payload.taskId);
	if (payload.taskPath !== expectedPath) {
		throw new OperationConflictError('Writeback task binding changed.');
	}
	const current = await readCurrentVaultTextState(vaultRoot, expectedPath, context);
	if (!current) {
		throw new OperationConflictError('Writeback task is unavailable for the journaled operation.');
	}
	const frontmatter = parseMarkdown(current.content).frontmatter.fields;
	const usesStableProposalReferences =
		typeof payload.taskHadProposalIdReference === 'boolean'
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
	if (
		memoryWrites.has(payload.targetPath)
		&& hasProposalReference
		&& hasProposalPathEvidence
	) {
		if (current.contentHash !== payload.taskLinkedContentHash) {
			throw new OperationConflictError(
				'Writeback task changed after its durable update.'
			);
		}
		return {
			taskPath: current.path,
			targetReferenceAdded,
			proposalReferenceAdded,
		};
	}
	if (current.contentHash !== payload.taskContentHash) {
		throw new OperationConflictError(
			'Writeback task changed after preview before its durable update.'
		);
	}
	if (
		memoryWrites.has(payload.targetPath) !== payload.taskHadTargetReference
		|| hasProposalReference !== payload.taskHadProposalReference
		|| (
			usesStableProposalReferences
			&& hasProposalPathEvidence !== payload.taskHadProposalPathEvidence
		)
	) {
		throw new OperationConflictError('Writeback task references changed after preview.');
	}
	const next = updateFrontmatterFields(
		current.content,
		usesStableProposalReferences
			? {
				memory_writes: mergeFrontmatterList(
					frontmatter,
					'memory_writes',
					[payload.targetPath]
				),
				proposal_ids: mergeFrontmatterList(
					frontmatter,
					'proposal_ids',
					[payload.proposalId]
				),
				proposal_paths: mergeFrontmatterList(
					frontmatter,
					'proposal_paths',
					[payload.proposalPath]
				),
			}
			: {
				memory_writes: mergeFrontmatterList(
					frontmatter,
					'memory_writes',
					[payload.targetPath]
				),
				proposals: mergeFrontmatterList(
					frontmatter,
					'proposals',
					[payload.proposalPath]
				),
			}
	);
	if (hashText(next) !== payload.taskLinkedContentHash) {
		throw new OperationConflictError('Writeback task update no longer matches its preview.');
	}
	if (context.vaultRepository) {
		if (!current.version) {
			throw new OperationConflictError('Writeback task version is unavailable.');
		}
		await context.vaultRepository.replaceText(current.path, current.version, next);
		return {
			taskPath: current.path,
			targetReferenceAdded,
			proposalReferenceAdded,
		};
	}
	const absolute = resolveSafeNotePath(vaultRoot, current.path, pathSafetyOptions(context));
	replaceTextFileAtomically(absolute, next, current.content);
	return {
		taskPath: current.path,
		targetReferenceAdded,
		proposalReferenceAdded,
	};
}

async function rollbackApprovedWritebackTask(
	vaultRoot: string,
	payload: ApplyApprovedWritebackPayload,
	receipt: ApplyApprovedWritebackTaskLinkReceipt,
	context: ToolInvocationContext
): Promise<void> {
	if (receipt.taskPath === null) {
		return;
	}
	if (!payload.taskId || receipt.taskPath !== payload.taskPath) {
		throw new OperationConflictError('Writeback task compensation binding changed.');
	}
	const usesStableProposalReferences =
		typeof payload.taskHadProposalIdReference === 'boolean'
		&& typeof payload.taskHadProposalPathEvidence === 'boolean';
	const proposalPathEvidenceAdded =
		usesStableProposalReferences
		&& payload.taskHadProposalPathEvidence === false;
	if (
		!receipt.targetReferenceAdded
		&& !receipt.proposalReferenceAdded
		&& !proposalPathEvidenceAdded
	) {
		return;
	}
	const current = await readCurrentVaultTextState(vaultRoot, receipt.taskPath, context);
	if (!current) {
		throw new OperationConflictError(
			'Writeback task disappeared before its references could be compensated.'
		);
	}
	if (current.contentHash === payload.taskContentHash) {
		return;
	}
	if (current.contentHash !== payload.taskLinkedContentHash) {
		throw new OperationConflictError(
			'Writeback task changed after its durable effect and cannot be safely compensated.'
		);
	}
	const frontmatter = parseMarkdown(current.content).frontmatter.fields;
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
	if (
		nextMemoryWrites.length === memoryWrites.length
		&& nextProposalIds.length === proposalIds.length
		&& nextProposalPaths.length === proposalPaths.length
		&& nextLegacyProposals.length === legacyProposals.length
	) {
		return;
	}
	const next = updateFrontmatterFields(
		current.content,
		usesStableProposalReferences
			? {
				memory_writes:
					nextMemoryWrites.length > 0 ? nextMemoryWrites.join(', ') : null,
				proposal_ids:
					nextProposalIds.length > 0 ? nextProposalIds.join(', ') : null,
				proposal_paths:
					nextProposalPaths.length > 0 ? nextProposalPaths.join(', ') : null,
			}
			: {
				memory_writes:
					nextMemoryWrites.length > 0 ? nextMemoryWrites.join(', ') : null,
				proposals:
					nextLegacyProposals.length > 0
						? nextLegacyProposals.join(', ')
						: null,
			}
	);
	if (context.vaultRepository) {
		if (!current.version) {
			throw new OperationConflictError('Writeback task version is unavailable.');
		}
		await context.vaultRepository.replaceText(current.path, current.version, next);
		return;
	}
	const absolute = resolveSafeNotePath(vaultRoot, current.path, pathSafetyOptions(context));
	replaceTextFileAtomically(absolute, next, current.content);
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
): Promise<{ path: string; activity_path: string; status: string; warnings: string[] }> {
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
		return { path: taskPath, activity_path: audit.path, status: 'skipped', warnings: [] };
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

function toSourceRequestRow(note: { frontmatter: Readonly<Record<string, unknown>> }) {
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
	'tracekeeper.memory': (rawArgs, context) =>
		handleMemory(rawArgs as MemoryArgs, context),
	'tracekeeper.read_note': (rawArgs, context) => handleReadNote(rawArgs as ReadNoteArgs, context),
	'tracekeeper.review_queue': (rawArgs, context) => handleReviewQueueUnified(rawArgs as ReviewQueueArgs, context),
	'tracekeeper.project_context': (rawArgs, context) => handleProjectContext(rawArgs as ProjectContextArgs, context),
	'tracekeeper.project_history': (rawArgs, context) => handleProjectHistory(rawArgs as ProjectHistoryArgs, context),
	'tracekeeper.list_review_queue': (rawArgs, context) => handleReviewQueue(rawArgs as ListReviewQueueArgs, context),
	'tracekeeper.list_source_requests': (rawArgs, context) => handleListSourceRequests(rawArgs as ListSourceRequestsArgs, context),
	'tracekeeper.list_approved_writebacks': (rawArgs, context) =>
		handleListApprovedWritebacks(rawArgs as ListApprovedWritebacksArgs, context),
	'tracekeeper.agent_activity_recent': (rawArgs, context) => handleAgentActivityRecent(rawArgs as AgentActivityRecentArgs, context),
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

function resolveAuditVaultRoot(context: ToolInvocationContext): string | null {
	if (typeof context.defaultVaultRoot === 'string' && context.defaultVaultRoot.trim()) {
		try {
			return toSafeVaultRoot(context.defaultVaultRoot);
		} catch {
			return null;
		}
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

export function appendRuntimeDiagnosticAuditEvent(
	vaultRoot: string,
	reason: 'auth_missing' | 'auth_invalid' | 'query_token_rejected'
): { path: string } {
	return appendAuditEvent(vaultRoot, {
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

export function recordToolCallAuditEvent(vaultRoot: string, input: ToolCallAuditEventInput): { path: string } {
	const now = new Date().toISOString();
	const invocationId = input.invocationId?.trim()
		|| `invocation-${crypto.randomUUID()}`;
	return appendAuditEvent(vaultRoot, {
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
				|| normalizeObservedClientType(input.clientName),
			observed_client_version: input.clientVersion,
			last_used_at: input.resultStatus === 'success' ? now : undefined,
			last_successful_tool: input.resultStatus === 'success' ? input.toolName : undefined,
			result_summary: input.resultSummary,
			...input.workflowMetadata,
		},
	});
}

async function recordToolCallAuditEventAsync(
	vaultRoot: string,
	input: ToolCallAuditEventInput,
	context: ToolInvocationContext
): Promise<{ path: string }> {
	if (!context.vaultRepository) {
		return recordToolCallAuditEvent(vaultRoot, input);
	}

	const now = new Date().toISOString();
	const invocationId = input.invocationId?.trim()
		|| `invocation-${crypto.randomUUID()}`;
	return appendAuditEventAsync(vaultRoot, {
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
				|| normalizeObservedClientType(input.clientName),
			observed_client_version: input.clientVersion,
			last_used_at: input.resultStatus === 'success' ? now : undefined,
			last_successful_tool: input.resultStatus === 'success' ? input.toolName : undefined,
			result_summary: input.resultSummary,
			...input.workflowMetadata,
		},
	}, context);
}

export async function recordRejectedToolCallAuditEvent(
	context: ToolInvocationContext,
	reason:
		| 'tool_call_invalid_params'
		| 'tool_call_invalid_name'
		| 'tool_call_invalid_arguments'
		| 'tool_call_unknown'
): Promise<void> {
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
	} catch {
		// Rejection diagnostics are best effort.
	}
}

function makeToolResultForWrite(tool: string, payload: ReturnType<typeof buildAndWriteNote>) {
	return {
		ok: true,
		tool,
		status: payload.status,
		path: payload.path,
		activity_path: payload.activity_path,
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
		await recordRejectedToolCallAuditEvent(context, 'tool_call_invalid_name');
		return toolError('Tool name is required.');
	}
	if (!isToolName(requestName)) {
		await recordRejectedToolCallAuditEvent(context, 'tool_call_unknown');
		return toolError(`Unknown tool: ${requestName}`);
	}
	if (!isRecord(rawParams)) {
		await recordRejectedToolCallAuditEvent(context, 'tool_call_invalid_arguments');
		return validateToolResult(
			requestName,
			decorateToolResult(requestName, toolError('Tool arguments must be an object.'), context)
		);
	}
	const args = rawParams;
	const invocationId = context.invocationId?.trim()
		|| `invocation-${crypto.randomUUID()}`;
	const startTime = Date.now();
	const agentId = context.agentId || 'unknown session id';
	const sessionId = context.sessionId;
	const clientName = context.clientName ?? null;
	const auditVaultRoot = resolveAuditVaultRoot(context);
	let toolResult: McpStructuredToolResult = toolError(`Unknown tool: ${requestName}`);
	let status: 'success' | 'failed' = 'failed';
	const toolName = requestName || 'unknown';

	const argsSummary = summarizeForAudit(projectArgumentsForAudit(requestName, args));

	try {
		assertCallerDoesNotSelectVaultRoot(args);
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
				`Runtime principal ${context.principalId || 'unknown'} lacks capability ${contract.capability} for ${requestName}.`
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
		if (requestName === 'tracekeeper.apply_approved_writeback') {
			toolResult = toolError(boundedWritebackErrorMessage(error, auditVaultRoot));
		} else if (error instanceof ToolInputError || error instanceof VaultPathError) {
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
		if (auditVaultRoot && isAgentActivityTransport(context)) {
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

function isAgentActivityTransport(context: Pick<ToolInvocationContext, 'transport'>): boolean {
	return context.transport !== 'obsidian-direct';
}

export type { OperationRecoveryReport };

export async function recoverPendingOperations(
	vaultRoot: string,
	context: ToolInvocationContext = {}
): Promise<OperationRecoveryReport> {
	const controller = new RuntimeRecoveryController(operationJournalForVault(vaultRoot), {
		isApplyApprovedWritebackPayload,
		isProposeMemoryOperationPayload,
		invoke: async (request, record, requestedVaultRoot) => {
			const result = await callTool(request.tool as TracekeeperToolName, request.args, {
				...context,
				defaultVaultRoot: requestedVaultRoot,
				principalId: context.principalId || LOCAL_TRUST_PRINCIPAL_ID,
				credentialCapabilities: context.credentialCapabilities || LOCAL_TRUST_CAPABILITIES,
				agentId: context.agentId || 'tracekeeper-recovery',
				clientName: context.clientName || 'tracekeeper-runtime-recovery',
				transport: context.transport || 'runtime-recovery',
				writebackRecoveryOperationId: record.operation_id,
			});
			const structured = result.structuredContent;
			return {
				isError: Boolean(result.isError),
				error: isRecord(structured) && typeof structured.error === 'string'
					? structured.error
					: undefined,
			};
		},
	});
	return controller.recover(vaultRoot);
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

function buildStartTaskNextActions(identity: ResolvedProjectIdentity, context: ToolContext): string[] {
	const actions = [
		contentText(context, '读取单篇笔记前，先调用 tracekeeper.recall。', 'Call tracekeeper.recall before reading individual notes.'),
		contentText(context, '只有召回摘要不够时，再使用 tracekeeper.read_note。', 'Use tracekeeper.read_note only when a recall excerpt is not enough.'),
		contentText(context, '任务结束时调用一次 tracekeeper.finish_task，记录任务状态和执行细节；只有明确的长期记忆候选才提交为 memory_candidate_records。', 'Call tracekeeper.finish_task once at the end with task status and execution details; submit only explicit durable candidates as memory_candidate_records.'),
	];
	if (hasProjectScope(identity) && identity.confidence !== 'uncertain') {
		actions.unshift(contentText(context, '使用相同 project_hint 和 scope="project" 做定向召回。', 'Use scope="project" with the same project_hint for targeted recall.'));
		actions.splice(2, 0, contentText(context, '需要承接历史任务时，使用 scope="project_history"。', 'Use scope="project_history" when continuity from earlier sessions is needed.'));
	} else if (identity.confidence === 'uncertain' && identity.warnings.length > 0) {
		actions.unshift(contentText(context, '项目身份尚未确认；先使用全局召回并让用户确认项目，不要静默选择。', 'Project identity is unresolved; use global recall and ask the user to confirm the project instead of choosing silently.'));
	}
	return actions;
}

async function handleStatus(rawArgs: StatusArgs, context: ToolInvocationContext) {
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

async function handleGraphHealth(rawArgs: GraphHealthArgs, context: ToolInvocationContext) {
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
	const graphHealth = analyzeGraphHealth(materializeLightweightNotes(view), {
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
		scanned_at: view.createdAt,
		...readViewProvenance(view),
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
	const vaultRoot = configuredVaultRoot(context);
	if (context.memoryRules?.taskTrackingEnabled === false) {
		throw new ToolInputError('task_tracking_disabled: task tracking is disabled in Tracekeeper settings.');
	}
	const goal = coerceNonEmptyString(rawArgs.goal, true, 'goal');
	const client = coerceNonEmptyString(rawArgs.client);
	const view = await knowledgeReadViewForContext(vaultRoot, context);
	const scan = lightweightScanFromReadView(vaultRoot, view);
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
			const recallScope: 'global' | 'project' = hasProjectScope(projectIdentity) && projectIdentity.confidence !== 'uncertain'
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
				activity_path: task.activity_path,
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

function executeRecallApplication(
	scope: 'global',
	rawArgs: RecallArgs,
	context: ToolInvocationContext
): Promise<GlobalRecallApplicationResult>;
function executeRecallApplication(
	scope: 'project',
	rawArgs: RecallArgs,
	context: ToolInvocationContext
): Promise<ProjectRecallApplicationResult>;
function executeRecallApplication(
	scope: 'project_history',
	rawArgs: RecallArgs,
	context: ToolInvocationContext
): Promise<ProjectHistoryRecallApplicationResult>;
function executeRecallApplication(
	scope: 'task_history',
	rawArgs: RecallArgs,
	context: ToolInvocationContext
): Promise<TaskHistoryRecallApplicationResult>;
function executeRecallApplication(
	scope: 'global' | 'project',
	rawArgs: RecallArgs,
	context: ToolInvocationContext
): Promise<GlobalRecallApplicationResult | ProjectRecallApplicationResult>;
function executeRecallApplication(
	scope: RecallScope,
	rawArgs: RecallArgs,
	context: ToolInvocationContext
): Promise<GlobalRecallApplicationResult | ProjectRecallApplicationResult | ProjectHistoryRecallApplicationResult | TaskHistoryRecallApplicationResult>;
async function executeRecallApplication(
	scope: RecallScope,
	rawArgs: RecallArgs,
	context: ToolInvocationContext
) {
	const vaultRoot = configuredVaultRoot(context);
	const query = scope === 'project_history' || scope === 'task_history'
		? coerceOptionalString(rawArgs.query)
		: coerceNonEmptyString(rawArgs.query, true, 'query');
	const maxItems = coercePositiveInt(
		rawArgs.max_items,
		scope === 'global' ? 6 : MAX_PROJECT_TOOL_ITEMS,
		1,
		MAX_PROJECT_TOOL_ITEMS
	);
	const service = new RecallApplicationService({
		loadScan: () => {
			throw new Error('Bounded Recall must not request the legacy full-scan dependency.');
		},
		nowMs: () => Date.now(),
		resolveProjectIdentity,
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
	} as const;
	return service.executeReadView(request, await knowledgeReadViewForContext(vaultRoot, context));
}

async function handleRecall(rawArgs: RecallArgs, context: ToolInvocationContext) {
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

async function handleMemory(rawArgs: MemoryArgs, context: ToolInvocationContext) {
	const vaultRoot = configuredVaultRoot(context);
	const scope = coerceOptionalString(rawArgs.scope).toLowerCase() || 'global';
	if (scope !== 'global' && scope !== 'project') {
		throw new ToolInputError('memory scope must be one of: global, project.');
	}
	const requestedView = coerceOptionalString(rawArgs.view).toLowerCase() || 'current';
	if (!['current', 'history', 'conflicts', 'all'].includes(requestedView)) {
		throw new ToolInputError('memory view must be one of: current, history, conflicts, all.');
	}
	const projectId = scope === 'project' ? coerceOptionalString(rawArgs.project_id) : '';
	if (scope === 'project' && !projectId) {
		throw new ToolInputError('memory project scope requires project_id.');
	}
	const readView = await knowledgeReadViewForContext(vaultRoot, context);
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
	const catalogRows: MemoryCatalogRow[] = records.map(toMemoryCatalogRow);
	if (requestedView === 'history' || requestedView === 'all') {
		catalogRows.push(
			...lifecycle.legacy
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
				}))
		);
	}
	catalogRows.sort((left, right) =>
		String(right.observed_at ?? '').localeCompare(String(left.observed_at ?? ''))
		|| String(left.memory_id ?? '').localeCompare(String(right.memory_id ?? ''))
		|| left.path.localeCompare(right.path)
	);
	const pageSize = coercePositiveInt(
		rawArgs.page_size,
		50,
		1,
		200
	);
	const offset = decodeMemoryCursor(
		coerceOptionalString(rawArgs.cursor),
		readView.generation,
		scope,
		requestedView,
		projectId || null
	);
	const entries = catalogRows.slice(offset, offset + pageSize);
	const nextOffset = offset + entries.length;
	return {
		read_only: true as const,
		scope,
		view: requestedView,
		project_id: projectId || null,
		generation: readView.generation,
		total: catalogRows.length,
		complete: true as const,
		sort: 'observed_at_desc_memory_id_path_asc' as const,
		page: {
			page_size: pageSize,
			next_cursor: nextOffset < catalogRows.length
				? encodeMemoryCursor(readView.generation, scope, requestedView, projectId || null, nextOffset)
				: null,
		},
		entries,
	};
}

function compareMemoryCatalogRows(left: ResolvedMemoryRecord, right: ResolvedMemoryRecord): number {
	return right.record.observed_at.localeCompare(left.record.observed_at)
		|| left.record.memory_id.localeCompare(right.record.memory_id)
		|| left.record.path.localeCompare(right.record.path);
}

interface MemoryCatalogRow {
	path: string;
	legacy: boolean;
	memory_id: string | null;
	scope: 'global' | 'project';
	project_id: string | null;
	claim_key: string | null;
	memory_kind: string | null;
	authority: 'agent' | 'source' | 'user' | null;
	confidence_level: 'uncertain' | 'inferred' | 'supported' | 'verified' | null;
	declared_state: 'active' | 'disputed' | 'retracted' | 'review' | null;
	effective_state: 'current' | 'superseded' | 'disputed' | 'retracted' | 'review' | 'legacy_unkeyed';
	observed_at: string | null;
	valid_from: string | null;
	valid_to: string | null;
	last_verified_at: string | null;
	evidence: string[];
	supersedes: string[];
	contradicts: string[];
	related_wiki: string[];
	related_sources: string[];
	reasons: string[];
}

function toMemoryCatalogRow(row: ResolvedMemoryRecord): MemoryCatalogRow {
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

function encodeMemoryCursor(
	generation: number,
	scope: string,
	view: string,
	projectId: string | null,
	offset: number
): string {
	const payload = Buffer.from(
		JSON.stringify({ generation, scope, view, projectId, offset }),
		'utf8'
	).toString('base64url');
	return `${payload}.${memoryCursorChecksum(payload)}`;
}

function decodeMemoryCursor(
	cursor: string,
	generation: number,
	scope: string,
	view: string,
	projectId: string | null
): number {
	if (!cursor) return 0;
	try {
		const [encodedPayload, suppliedChecksum, ...extraParts] = cursor.split('.');
		if (!encodedPayload || !suppliedChecksum || extraParts.length > 0) {
			throw new ToolInputError('Memory cursor is invalid.');
		}
		const expectedChecksum = memoryCursorChecksum(encodedPayload);
		const suppliedBytes = Buffer.from(suppliedChecksum, 'utf8');
		const expectedBytes = Buffer.from(expectedChecksum, 'utf8');
		if (
			suppliedBytes.length !== expectedBytes.length
			|| !crypto.timingSafeEqual(suppliedBytes, expectedBytes)
		) {
			throw new ToolInputError('Memory cursor checksum is invalid.');
		}
		const payload = JSON.parse(
			Buffer.from(encodedPayload, 'base64url').toString('utf8')
		) as Record<string, unknown>;
		if (payload.generation !== generation) throw new ToolInputError('Memory cursor is stale for the current generation.');
		if (payload.scope !== scope || payload.view !== view || payload.projectId !== projectId) {
			throw new ToolInputError('Memory cursor does not match the requested catalog.');
		}
		if (!Number.isSafeInteger(payload.offset) || Number(payload.offset) < 0) {
			throw new ToolInputError('Memory cursor is invalid.');
		}
		return Number(payload.offset);
	} catch (error) {
		if (error instanceof ToolInputError) throw error;
		throw new ToolInputError('Memory cursor is invalid.');
	}
}

function memoryCursorChecksum(encodedPayload: string): string {
	return crypto
		.createHash('sha256')
		.update(`tracekeeper.memory.cursor.v1:${encodedPayload}`, 'utf8')
		.digest('base64url')
		.slice(0, 22);
}

async function handleReadNote(rawArgs: ReadNoteArgs, context: ToolInvocationContext) {
	const vaultRoot = configuredVaultRoot(context);
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
	const view = await knowledgeReadViewForContext(vaultRoot, context);

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
		relation_evidence: buildReadViewRelationEvidence(data.path, view),
	};
}

function handleProjectContext(rawArgs: ProjectContextArgs, context: ToolInvocationContext) {
	return executeRecallApplication('project', rawArgs, context);
}

function handleProjectHistory(rawArgs: ProjectHistoryArgs, context: ToolInvocationContext) {
	return executeRecallApplication('project_history', rawArgs, context);
}

async function handleListSourceRequests(rawArgs: ListSourceRequestsArgs, context: ToolInvocationContext) {
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

async function handleAnalyzeSourceRequest(
	rawArgs: AnalyzeSourceRequestArgs,
	context: ToolContext,
	sourceToolName = 'tracekeeper.analyze_source_request'
) {
	const vaultRoot = configuredVaultRoot(context);
	const requestPath = coerceOptionalString(rawArgs.request_path) || coerceOptionalString(rawArgs.path);
	if (!requestPath) {
		throw new ToolInputError('Missing required argument: request_path or path.');
	}
	const updateStatus = coerceBoolean(rawArgs.update_request_status, 'update_request_status', true);
	const forceReprocess = coerceBoolean(rawArgs.force_reprocess, 'force_reprocess', false);
	const taskId = coerceOptionalString(rawArgs.task_id) || null;
	const application = new SourceRequestApplicationService({
		readRequest: async (requestPathValue) => readSourceRequestAsync(vaultRoot, requestPathValue, context),
		readSourceText: async (sourcePath) => {
			try {
				return await safeReadTextFileAsync(vaultRoot, sourcePath, context);
			} catch (error) {
				if (error instanceof ToolInputError || error instanceof VaultPathError) {
					return null;
				}
				throw error;
			}
		},
		writeNote: (input: SourceRequestWriteInput) => {
			const allowedDir = input.kind === 'source' || input.kind === 'source_part'
				? input.directory || SOURCES_DIR
				: input.kind === 'report'
					? SOURCE_ANALYSIS_REPORT_DIR
					: MEMORY_PROPOSAL_DIR;
			return buildAndWriteNoteAsync(
				vaultRoot,
				input.toolName,
				allowedDir,
				input.filename,
				input.frontmatter,
				input.body,
				input.taskId,
				context,
				input.metadata
			);
		},
		updateRequestStatus: (requestPathValue, status) =>
			updateRequestStatusAsync(vaultRoot, requestPathValue, status, context),
		appendAudit: (input) => appendAuditEventAsync(vaultRoot, input, context),
		updateTaskRecord: (taskIdValue, notePaths, proposals) => updateAgentTaskRecordAsync(
			vaultRoot,
			taskIdValue,
			{},
			context,
			{
				source_captures: notePaths,
				proposal_ids: proposals.map((proposal) => proposal.proposalId),
				proposal_paths: proposals.map((proposal) => proposal.path),
				proposal_link_targets: proposals.map((proposal) => proposal.linkTarget),
			}
		),
		updateManagedProposalReferences: (recordPath, proposals) =>
			updateManagedProposalReferences(vaultRoot, recordPath, proposals, context),
		assertSafeText: assertNoSensitiveText,
		renderText: (zh, en) => contentText(context, zh, en),
		contentLanguage: contentLanguageFromContext(context),
		now: () => new Date().toISOString(),
		buildFilename: (rawFilename, fallbackPrefix) => buildSafeFilename(rawFilename, fallbackPrefix, context),
		proposalDirectory: MEMORY_PROPOSAL_DIR,
		renderMarkdownLink: (targetPath, sourcePath) =>
			projectMemoryRepository(vaultRoot, context).generateMarkdownLink?.(targetPath, sourcePath)
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


async function handleReviewQueueUnified(rawArgs: ReviewQueueArgs, context: ToolInvocationContext) {
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

async function handleSourceRequest(rawArgs: SourceRequestArgs, context: ToolContext) {
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

async function handleReviewQueue(rawArgs: ListReviewQueueArgs, context: ToolInvocationContext) {
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

async function handleListApprovedWritebacks(rawArgs: ListApprovedWritebacksArgs, context: ToolInvocationContext) {
	const vaultRoot = configuredVaultRoot(context);
	const rawLimit = rawArgs.max_items ?? rawArgs.limit;
	const maxItems = coercePositiveInt(rawLimit, MAX_APPROVED_WRITEBACKS, 1, MAX_APPROVED_WRITEBACKS);
	const scope = coerceOptionalString(rawArgs.scope);
	const view = await knowledgeReadViewForContext(vaultRoot, context);
	const candidates: ReturnType<typeof buildWritebackPlan>[] = [];
	const approved = [...view.catalog.values()]
		.filter((note) => note.path.startsWith(`${REVIEW_QUEUE_PREFIX}/`))
		.filter((note) => readProposalApprovalStatus(note.frontmatter) === 'approved')
		.filter((note) => {
			if (!scope) return true;
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
		candidates.push(buildWritebackPlan(proposal));
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

function proposalGovernanceProjection(
	frontmatter: Readonly<Record<string, unknown>>,
	view: KnowledgeReadView
) {
	const scopeValue = stripYamlQuotes(readFrontmatterString(frontmatter, ['memory_scope'])).toLowerCase();
	const scope: 'global' | 'project' = scopeValue === 'project' ? 'project' : 'global';
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
				? frontmatter.evidence.filter((value): value is string => typeof value === 'string')
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

function buildApprovedWritebackOperationIdentity(
	proposal: MemoryProposalDocument,
	proposalRevision: string,
	previewNonce: string
): {
	operationId: string;
	idempotencyKey: string;
} {
	const identity = crypto
		.createHash('sha256')
		.update(
			`${proposal.path}\0${proposal.proposalId}\0${proposalRevision}\0${previewNonce}`
		)
		.digest('hex')
		.slice(0, 24);
	return {
		operationId: `writeback-${identity}`,
		idempotencyKey:
			`apply-approved-writeback:${proposal.path}:${proposal.proposalId}:${proposalRevision}:${previewNonce}`,
	};
}

function assertMatchingWritebackBinding(
	expected: WritebackConfirmationBinding,
	current: WritebackConfirmationBinding
): void {
	if (computePayloadHash(expected) !== computePayloadHash(current)) {
		throw new OperationConflictError(
			'Writeback confirmation is stale because the approved proposal, target, task, or touched-note plan changed.'
		);
	}
}

async function currentWritebackEffect(
	vaultRoot: string,
	payload: ApplyApprovedWritebackPayload,
	operationId: string,
	context: ToolInvocationContext
): Promise<{
	target: CurrentVaultTextState | null;
	writebackBlock: string;
	alreadyApplied: boolean;
}> {
	const proposal = await resolveMemoryProposalFromArgs(
		vaultRoot,
		{
			proposal_path: payload.proposalPath,
			task_id: payload.taskId,
		},
		context
	);
	const snapshot = proposalTransitionSnapshot(proposal);
	const createsMemoryRecord = payload.effectKind === 'create_memory_record';
	const writeback = createsMemoryRecord
		? {
			block: buildApprovedMemoryRecordMarkdown(vaultRoot, proposal, payload.targetPath, operationId, context),
			marker: `memory-record:${snapshot.proposalId}`,
		}
		: buildApprovedWritebackBlock(snapshot.proposalId, snapshot.writebackContent);
	const currentTaskPath = payload.taskId ? buildTaskNotePath(payload.taskId) : null;
	const currentTask = currentTaskPath
		? await readCurrentVaultTextState(vaultRoot, currentTaskPath, context)
		: null;
	const target = await readCurrentVaultTextState(vaultRoot, payload.targetPath, context);

	if (
		snapshot.status !== 'approved'
		|| proposal.proposalId !== payload.proposalId
		|| proposal.path !== payload.proposalPath
		|| computeProposalRevision(snapshot) !== payload.proposalRevision
		|| computeProposalContentHash(snapshot) !== payload.proposalContentHash
		|| computePayloadHash(proposal.text) !== payload.proposalFileHash
		|| (
			snapshot.lastTransition?.operationId || ''
		) !== payload.approvalOperationId
		|| (!createsMemoryRecord && snapshot.targetPath !== payload.targetPath)
		|| snapshot.taskId !== payload.proposalTaskId
		|| hashText(snapshot.writebackContent) !== payload.writebackContentHash
		|| hashText(writeback.block) !== payload.writebackBlockHash
		|| writeback.marker !== payload.writebackMarker
		|| currentTaskPath !== payload.taskPath
		|| (currentTask?.contentHash || '') !== payload.taskContentHash
		|| (!createsMemoryRecord && !target)
	) {
		throw new OperationConflictError(
			'Writeback confirmation is stale because current proposal or task state changed.'
		);
	}
	validateApprovedWritebackTransition(
		snapshot,
		operationId,
		payload.targetPath,
		createsMemoryRecord || Boolean(target),
		context,
		new Date(writebackConfirmationNow(context)).toISOString()
	);
	const touchedNotes = [
		payload.targetPath,
		payload.proposalPath,
		...(payload.taskPath ? [payload.taskPath] : []),
		payload.activityPath,
	];
	if (computePayloadHash(touchedNotes) !== computePayloadHash(payload.touchedNotes)) {
		throw new OperationConflictError('Writeback confirmation touched-note plan changed.');
	}
	if (createsMemoryRecord) {
		if (!target) {
			return { target: null, writebackBlock: writeback.block, alreadyApplied: false };
		}
		if (target.contentHash === hashText(writeback.block)) {
			return { target, writebackBlock: writeback.block, alreadyApplied: true };
		}
		throw new OperationConflictError(
			'Approved memory record path already exists with different content.'
		);
	}
	if (!target) {
		throw new OperationConflictError('Writeback target is unavailable.');
	}
	if (reversibleWritebackTargetPrefix(target.content, payload) !== null) {
		return {
			target,
			writebackBlock: writeback.block,
			alreadyApplied: true,
		};
	}
	if (target.contentHash !== payload.targetContentHash) {
		throw new OperationConflictError(
			'Writeback confirmation is stale because the target note changed.'
		);
	}
	if (
		target.content.includes(payload.writebackMarker)
		|| target.content.includes(writeback.block)
	) {
		throw new OperationConflictError(
			`Writeback marker already exists with different content: ${payload.writebackMarker}`
		);
	}
	return {
		target,
		writebackBlock: writeback.block,
		alreadyApplied: false,
	};
}

async function rollbackRuntimeWritebackTarget(
	vaultRoot: string,
	payload: ApplyApprovedWritebackPayload,
	context: ToolInvocationContext
): Promise<void> {
	if (payload.effectKind === 'create_memory_record') {
		const repository = projectMemoryRepository(vaultRoot, context);
		const target = await repository.readText(payload.targetPath);
		if (!target) {
			return;
		}
		if (hashText(target.content) !== payload.writebackBlockHash) {
			throw new OperationConflictError(
				'Approved memory record changed after creation and cannot be safely compensated.'
			);
		}
		await repository.deleteText(payload.targetPath, target.version);
		return;
	}
	const target = await readCurrentVaultTextState(
		vaultRoot,
		payload.targetPath,
		context
	);
	if (!target || target.contentHash === payload.targetContentHash) {
		return;
	}
	const original = reversibleWritebackTargetPrefix(target.content, payload);
	if (original === null) {
		throw new OperationConflictError(
			'Writeback target changed after its durable effect and cannot be safely compensated.'
		);
	}
	if (context.vaultRepository) {
		if (!target.version) {
			throw new OperationConflictError('Writeback target version is unavailable.');
		}
		await context.vaultRepository.replaceText(
			payload.targetPath,
			target.version,
			original
		);
		return;
	}
	const targetAbsolute = resolveSafeNotePath(
		vaultRoot,
		payload.targetPath,
		pathSafetyOptions(context)
	);
	replaceTextFileAtomically(targetAbsolute, original, target.content);
}

async function commitRuntimeProposalApplyTransition(
	vaultRoot: string,
	payload: ApplyApprovedWritebackPayload,
	operationId: string,
	context: ToolInvocationContext
): Promise<ProposalTransitionReceipt> {
	const transition = {
		expectedRevision: payload.proposalRevision,
		expectedContentHash: payload.proposalContentHash,
		operationId,
		action: { kind: 'apply' as const },
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
	const proposalState = await readCurrentVaultTextState(
		vaultRoot,
		payload.proposalPath,
		context
	);
	if (!proposalState) {
		throw new ProposalTransitionConflictError('Writeback proposal does not exist.');
	}
	const proposal = memoryProposalDocumentFromText(
		vaultRoot,
		payload.proposalPath,
		proposalState.content,
		context
	);
	const target = await readCurrentVaultTextState(vaultRoot, payload.targetPath, context);
	const decision = transitionProposal(
		proposalTransitionSnapshot(proposal),
		transition,
		{
			now: new Date().toISOString(),
			actor: context.agentId || 'tracekeeper-runtime',
			targetAllowed: isAllowedProposalTargetPath,
			targetExists: (relativePath) =>
				relativePath === payload.targetPath
				&& (payload.effectKind === 'create_memory_record' || target !== null),
		}
	);
	if (decision.replayed) {
		return decision.receipt;
	}
	if (computePayloadHash(proposalState.content) !== payload.proposalFileHash) {
		throw new ProposalTransitionConflictError(
			'Proposal file changed before the writeback transition.'
		);
	}
	const updated = updateFrontmatterFields(
		proposalState.content,
		decision.frontmatter
	);
	if (context.vaultRepository) {
		if (!proposalState.version) {
			throw new ProposalTransitionConflictError('Proposal repository version is unavailable.');
		}
		await context.vaultRepository.replaceText(
			payload.proposalPath,
			proposalState.version,
			updated
		);
	} else {
		replaceTextFileAtomically(proposal.absolutePath, updated, proposalState.content);
	}
	return decision.receipt;
}

function assertJournaledWritebackRequest(
	rawArgs: ApplyApprovedWritebackArgs,
	payload: ApplyApprovedWritebackPayload,
	context: ToolInvocationContext
): void {
	const explicitPath = coerceOptionalString(rawArgs.proposal_path)
		|| coerceOptionalString(rawArgs.path);
	if (explicitPath) {
		const normalized = normalizeNotePath(explicitPath, pathSafetyOptions(context));
		assertReviewQueuePath(normalized);
		if (normalized !== payload.proposalPath) {
			throw new OperationConflictError(
				'Writeback request proposal changed from the journaled operation.'
			);
		}
	}
	const proposalId = coerceOptionalString(rawArgs.proposal_id);
	if (proposalId && proposalId !== payload.proposalId) {
		throw new OperationConflictError(
			'Writeback request proposal changed from the journaled operation.'
		);
	}
	const taskId = coerceOptionalString(rawArgs.task_id);
	if (taskId && taskId !== payload.taskId) {
		throw new OperationConflictError(
			'Writeback request task changed from the journaled operation.'
		);
	}
}

async function handleApplyApprovedWriteback(rawArgs: ApplyApprovedWritebackArgs, context: ToolInvocationContext) {
	const vaultRoot = configuredVaultRoot(context);
	const dryRun = coerceBoolean(rawArgs.dry_run, 'dry_run', false);

	if (dryRun) {
		const proposal = await resolveMemoryProposalFromArgs(vaultRoot, rawArgs, context);
		const taskId = resolveWritebackTaskId(rawArgs, proposal);
		const plan = buildWritebackPlan(proposal);
		if (!plan.ready || !plan.writebackContent) {
			throw new ToolInputError(plan.reason || 'approved writeback is not ready to apply.');
		}
		assertNoSensitiveText([
			{ label: 'proposal id', value: proposal.proposalId },
			{ label: 'target note', value: plan.targetNote || 'new memory record' },
			{ label: 'writeback content', value: plan.writebackContent },
		]);
		const issuedAt = writebackConfirmationNow(context);
		const prepared = await prepareWritebackConfirmation(
			vaultRoot,
			proposal,
			plan,
			taskId,
			context,
			issuedAt,
			issuedAt + writebackConfirmationTtl(context)
		);
		const confirmationToken = createWritebackConfirmationToken(
			prepared.binding,
			context
		);
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

	const operationDirectory = path.resolve(vaultRoot, TRACEKEEPER_OPERATIONS_DIR);
	relativeFromAbsolute(vaultRoot, operationDirectory);
	assertNoSymlinkSegments(vaultRoot, operationDirectory);
	const journal = new NodeFileOperationJournal({ directory: operationDirectory });
	const rawConfirmationToken = coerceOptionalString(rawArgs.confirmation_token);
	const recoveryOperationId = context.writebackRecoveryOperationId || '';
	let identity: { operationId: string; idempotencyKey: string };
	let existing: OperationRecord | null = null;
	let payload: ApplyApprovedWritebackPayload;
	let approvalStatus = 'journaled';

	if (recoveryOperationId) {
		existing = await journal.loadById(recoveryOperationId);
		if (!existing) {
			throw new OperationConflictError('Writeback recovery journal record is unavailable.');
		}
		identity = {
			operationId: existing.operation_id,
			idempotencyKey: existing.idempotency_key,
		};
	} else {
		if (!rawConfirmationToken) {
			throw new ToolInputError(
				'Writeback confirmation token is required after a dry-run preview.'
			);
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
		if (
			byId
			&& byKey
			&& (
				byId.operation_id !== byKey.operation_id
				|| byId.idempotency_key !== byKey.idempotency_key
			)
		) {
			throw new OperationConflictError(
				'Writeback confirmation references conflicting journal records.'
			);
		}
		existing = byId || byKey;
	}

	if (existing) {
		if (
			existing.operation_id !== identity.operationId
			|| existing.idempotency_key !== identity.idempotencyKey
			|| !isApplyApprovedWritebackPayload(existing.payload)
		) {
			throw new OperationConflictError('Writeback journal record does not match the requested operation.');
		}
		payload = existing.payload;
		assertJournaledWritebackRequest(rawArgs, payload, context);
		if (!recoveryOperationId) {
			if (!rawConfirmationToken) {
				throw new OperationConflictError(
					'Writeback confirmation token changed from the journaled operation.'
				);
			}
			const decoded = decodeWritebackConfirmationToken(rawConfirmationToken);
			const tokenPayload = writebackBindingPayload(decoded, rawConfirmationToken);
			if (
				hashText(rawConfirmationToken) !== payload.confirmationTokenHash
				|| computePayloadHash(tokenPayload) !== computePayloadHash(payload)
			) {
				throw new OperationConflictError(
					'Writeback confirmation token changed from the journaled operation.'
				);
			}
		}
	} else {
		if (!rawConfirmationToken) {
			throw new ToolInputError('Writeback confirmation token is required.');
		}
		const decoded = parseWritebackConfirmationToken(rawConfirmationToken, context);
		const now = writebackConfirmationNow(context);
		if (decoded.expiresAt <= now || decoded.expiresAt <= decoded.issuedAt) {
			throw new ToolInputError('Writeback confirmation token has expired.');
		}
		const proposal = await resolveMemoryProposalFromArgs(vaultRoot, rawArgs, context);
		const taskId = resolveWritebackTaskId(rawArgs, proposal);
		const plan = buildWritebackPlan(proposal);
		if (!plan.ready || !plan.writebackContent) {
			throw new ToolInputError(plan.reason || 'approved writeback is not ready to apply.');
		}
		assertNoSensitiveText([
			{ label: 'proposal id', value: proposal.proposalId },
			{ label: 'target note', value: plan.targetNote || 'new memory record' },
			{ label: 'writeback content', value: plan.writebackContent },
		]);
		const current = await prepareWritebackConfirmation(
			vaultRoot,
			proposal,
			plan,
			taskId,
			context,
			decoded.issuedAt,
			decoded.expiresAt,
			decoded.previewNonce
		);
		assertMatchingWritebackBinding(decoded, current.binding);
		payload = writebackBindingPayload(decoded, rawConfirmationToken);
		approvalStatus = proposalTransitionSnapshot(proposal).status;
	}

	const service = new ApplyApprovedWritebackService({
		journal,
		failureInjection: context.operationFailureInjection,
		port: {
			async applyTarget(currentPayload) {
				const effect = await currentWritebackEffect(
					vaultRoot,
					currentPayload,
					identity.operationId,
					context
				);
				if (effect.alreadyApplied) {
					return;
				}
				if (currentPayload.effectKind === 'create_memory_record') {
					const repository = projectMemoryRepository(vaultRoot, context);
					try {
						await repository.createText(
							currentPayload.targetPath,
							effect.writebackBlock
						);
					} catch (error) {
						if (!(error instanceof OperationConflictError)) throw error;
						const existingTarget = await repository.readText(currentPayload.targetPath);
						if (existingTarget?.content !== effect.writebackBlock) throw error;
					}
					return;
				}
				if (!effect.target) {
					throw new OperationConflictError('Writeback target is unavailable.');
				}
				const targetWithWriteback =
					`${effect.target.content}${writebackTargetFrame(effect.writebackBlock)}`;
				if (context.vaultRepository) {
					if (!effect.target.version) {
						throw new OperationConflictError('Writeback target version is unavailable.');
					}
					await context.vaultRepository.replaceText(
						currentPayload.targetPath,
						effect.target.version,
						targetWithWriteback
					);
					return;
				}
				const targetAbsolute = resolveSafeNotePath(
					vaultRoot,
					currentPayload.targetPath,
					pathSafetyOptions(context)
				);
				replaceTextFileAtomically(
					targetAbsolute,
					targetWithWriteback,
					effect.target.content
				);
			},
			async rollbackTarget(currentPayload) {
				await rollbackRuntimeWritebackTarget(
					vaultRoot,
					currentPayload,
					context
				);
			},
			async markProposalApplied(currentPayload, operationId) {
				return commitRuntimeProposalApplyTransition(
					vaultRoot,
					currentPayload,
					operationId,
					context
				);
			},
			async linkTask(currentPayload) {
				return linkApprovedWritebackTask(
					vaultRoot,
					currentPayload,
					context
				);
			},
			async rollbackTask(currentPayload, _operationId, receipt) {
				await rollbackApprovedWritebackTask(
					vaultRoot,
					currentPayload,
					receipt,
					context
				);
			},
			async appendAgentActivity(currentPayload, operationId, receipt) {
				await appendAuditEventAsync(vaultRoot, {
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
						action: currentPayload.effectKind === 'create_memory_record'
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

async function handleAgentActivityRecent(rawArgs: AgentActivityRecentArgs, context: ToolContext) {
	const vaultRoot = configuredVaultRoot(context);
	const maxItems = coercePositiveInt(rawArgs.max_items, MAX_AUDIT_ITEMS, 1, 100);
	const application = new AgentActivityRecentApplicationService({
		agentActivityPath: AGENT_ACTIVITY_PATH,
		readSections: () => readMergedAuditSections(vaultRoot, context),
	});
	return {
		vault_root: vaultRoot,
		...(await application.execute(maxItems)),
	};
}

async function handleWriteContextPack(rawArgs: WriteContextPackArgs, context: ToolContext) {
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
	const vaultRoot = configuredVaultRoot(context);
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
	const vaultRoot = configuredVaultRoot(context);
	const requestHash = computePayloadHash({ ...rawArgs });
	const normalizedIdempotencyKey = coerceOptionalString(rawArgs.idempotency_key);
	const application = new CaptureSourceApplicationService({
		journal: operationJournalForVault(vaultRoot),
		failureInjection: context.operationFailureInjection,
		createIdentity: (hash, idempotencyKey) => buildToolOperationIdentity(
			'capture-source',
			idempotencyKey,
			{ requestHash: hash },
			context
		),
		now: () => new Date().toISOString(),
		buildFilename: (rawFilename, fallbackPrefix) =>
			coerceOptionalString(rawFilename)
				? buildSafeFilename(rawFilename, 'source', context)
				: buildSafeFilename(fallbackPrefix, 'source', context),
		renderText: (zh, en) => contentText(context, zh, en),
		assertSafeText: assertNoSensitiveText,
		findOwnedSourceNote: async (directory, filename, operationId) => {
			const note = await findOperationOwnedNoteAsync(
				vaultRoot,
				directory,
				filename,
				'source_operation_id',
				operationId,
				context
			);
			return note
				? {
					path: note.path,
					activity_path: note.activity_path,
					status: note.status,
					warnings: note.warnings,
				}
				: null;
		},
		writeSourceNote: (input: CaptureSourceWriteInput) => buildAndWriteNoteAsync(
			vaultRoot,
			'tracekeeper.capture_source',
			input.directory,
			input.filename,
			input.frontmatter,
			input.body,
			input.taskId,
			context,
			input.metadata,
			input.operationId
		),
		updateTaskSourceCapture: async (taskId, sourcePath) => {
			await updateAgentTaskRecordAsync(vaultRoot, taskId, {}, context, {
				source_captures: [sourcePath],
			});
		},
	});

	return application.execute({
		rawArgs: rawArgs as CaptureSourceRawRequest,
		requestHash,
		idempotencyKey: normalizedIdempotencyKey,
	});
}

async function handleProposeMemory(rawArgs: ProposeMemoryArgs, context: ToolInvocationContext) {
	const vaultRoot = configuredVaultRoot(context);
	const invocationContext = { ...context };
	const readView = await knowledgeReadViewForContext(vaultRoot, invocationContext);
	const preflightScan = lightweightScanFromReadView(vaultRoot, readView);
	context = {
		...invocationContext,
		knowledgeReadViewPromise: Promise.resolve(readView),
		knowledgeSnapshotProvider: () => preflightScan,
	};
	const observed = context.observedClientType ?? normalizeObservedClientType(context.clientName);
	const application = new ProposeMemoryApplicationService({
		journal: operationJournalForVault(vaultRoot),
		failureInjection: context.operationFailureInjection,
		createIdentity: (requestHash, idempotencyKey) => buildToolOperationIdentity(
			'propose-memory',
			idempotencyKey,
			{ requestHash },
			context
		),
		observedAgentType: observed === 'unknown' ? 'custom' : observed,
		now: () => new Date().toISOString(),
		buildFilename: (rawFilename, fallbackPrefix) => rawFilename
			? buildSafeFilename(rawFilename, 'proposal', context)
			: buildSafeFilename(fallbackPrefix, 'proposal', context),
		resolveMemoryScope: (proposalKind, targetNote, projectHint, memoryScope) =>
			resolveMemoryScope(proposalKind, targetNote, projectHint, memoryScope),
		buildArchitectureStatus: () => buildArchitectureStatus(vaultRoot, context),
		resolveBridgeMetadata: (memoryScope, projectHint, relatedWiki, relatedSources) =>
			resolveProjectMemoryBridgeMetadata(
				vaultRoot,
				memoryScope,
				projectHint,
				relatedWiki,
				relatedSources,
				context
			),
		resolveProjectIdentity: (snapshot) => {
			const resolved = resolveProjectIdentity({
				project_hint: snapshot.project_hint,
				project_id: snapshot.project_id,
				repo_path: snapshot.repo_path,
				repo: snapshot.repo,
				project_path: snapshot.project_path,
			}, scanVaultForContext(vaultRoot, context).notes);
			return resolved as ProposeMemoryProjectIdentity;
		},
		assertAllowed: (proposalKind, targetNote, projectHint, memoryScope) =>
			assertMemoryProposalAllowed(proposalKind, targetNote, projectHint, context, memoryScope),
		memoryRule: (proposalKind, targetNote, projectHint, memoryScope) =>
			memoryProposalRuleFor(proposalKind, targetNote, projectHint, context, memoryScope),
		writeImmutableProjectMemory: (input: ProposeMemoryImmutableWriteInput) =>
			writeImmutableProjectMemory(vaultRoot, {
				...input,
				toolName: 'tracekeeper.propose_memory',
				context,
			}),
		resolveAutoMemoryTarget: (proposalKind, targetNote, projectHint, memoryScope) =>
			resolveAutoMemoryTarget(vaultRoot, proposalKind, targetNote, projectHint, context, memoryScope),
		appendAutoMemoryWrite: (input) => appendAutoMemoryWriteAsync(vaultRoot, {
			...input,
			toolName: 'tracekeeper.propose_memory',
			context,
		}),
		findOwnedProposalNote: async (filename, operationId) => findOperationOwnedNoteAsync(
			vaultRoot,
			MEMORY_PROPOSAL_DIR,
			filename,
			'proposal_operation_id',
			operationId,
			context
		),
		writeProposalNote: (input: ProposeMemoryWriteInput) => buildAndWriteNoteAsync(
			vaultRoot,
			'tracekeeper.propose_memory',
			MEMORY_PROPOSAL_DIR,
			input.filename,
			input.frontmatter,
			input.body,
			input.taskId,
			context,
			input.metadata,
			input.operationId
		),
		ensureOwnedProposalIdentity: (proposalPath, proposalId, operationId) =>
			ensureOperationOwnedProposalIdentity(
				vaultRoot,
				proposalPath,
				proposalId,
				'proposal_operation_id',
				operationId,
				context
			),
		updateTaskMemoryWrite: async (taskId, memoryPath) => {
			await updateAgentTaskRecordAsync(vaultRoot, taskId, {}, context, {
				memory_writes: [memoryPath],
			});
		},
		updateTaskProposalReference: async (taskId, proposal) => {
			await updateManagedProposalReferences(
				vaultRoot,
				buildTaskNotePath(taskId),
				[proposal],
				context
			);
		},
		assertSafeText: assertNoSensitiveText,
		renderText: (zh, en) => contentText(context, zh, en),
	});
	return application.execute({ rawArgs: rawArgs as ProposeMemoryRawRequest });
}

async function handleBuildContextPack(rawArgs: BuildContextPackArgs, context: ToolInvocationContext) {
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
	let scopeForContextPack: ProjectScopeFilter = explicitScope;
	if (taskId) {
		const taskMetadata = await readAgentTaskMetadataAsync(vaultRoot, taskId, context);
		scopeForContextPack = mergeTaskProjectIdentity(taskId, taskMetadata, explicitScope);
	}
	const recallScope: 'global' | 'project' = hasProjectScope(scopeForContextPack) && scopeForContextPack.confidence !== 'uncertain'
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
			project_identity: projectIdentityToResult(scopeForContextPack),
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
		...readViewProvenance(view),
		context_pack: contextPack,
		artifact: {
			path: note.path,
			activity_path: note.activity_path,
		},
	};
}

async function handleLint(rawArgs: LintArgs, context: ToolInvocationContext) {
	const vaultRoot = configuredVaultRoot(context);
	const maxItems = coercePositiveInt(rawArgs.max_items, 40, 1, 2000);
	const profile = graphProfileFromArgs(rawArgs.graph_profile, context);
	const view = await knowledgeReadViewForContext(vaultRoot, context);
	const notes = materializeLightweightNotes(view);
	const graphHealth = profile === 'off' ? undefined : analyzeGraphHealth(notes, { maxItems });
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
	const staleAfterDays = coercePositiveInt(rawArgs.stale_after_days, 365, 1, 36_500);
	const { issues, doctor } = lintNotes(vaultRoot, notes, {
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
	memoryCandidateRecords: FinishTaskMemoryCandidateRecord[],
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
		contentText(context, '## 长期记忆候选', '## Durable Memory Candidates'),
		...(memoryCandidateRecords.length > 0
			? memoryCandidateRecords.map((candidate) => `- [${candidate.scope}] ${candidate.content}`)
			: ['- (none; task facts remain task history only)']),
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
		actions.push(contentText(context, '任务追踪已记录；没有提交长期记忆候选。如果之后发现遗漏的长期信息，请将其作为新的 tracekeeper.propose_memory 候选提交，不要再次调用 tracekeeper.finish_task。', 'Task tracking was recorded with no durable memory candidates. If omitted durable information is discovered later, submit it as a new tracekeeper.propose_memory candidate; do not call tracekeeper.finish_task again.'));
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
			actions.push(contentText(
				context,
				'项目记忆已按用户规则保存为独立的不可变操作条目。',
				'Project memory was saved as a separate immutable operation entry according to the user rule.'
			));
		}
		if (proposalResult.hasMissingWikiBridge) {
			actions.push(contentText(context, '部分项目记忆候选缺少 related_wiki 桥接关系，因此需要先审核。', 'Some project memory candidates need a related_wiki bridge before automatic project memory save.'));
		}
		if (actions.length === 0) {
			actions.push(contentText(context, '任务追踪已记录；没有产生长期记忆候选。', 'Task tracking was recorded; no durable memory candidates were produced.'));
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
): Promise<{ path: string; proposalId: string }> {
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
	const proposalId = buildStableProposalId(
		`distill-session\0${taskId}\0${proposalKind}\0${creationNonce}`
	);
	const filenameToken = `${proposalKind}-${taskId}-${now.replace(/[:.]/g, '-')}-${creationNonce.slice(0, 8)}`;
	const proposal = await buildAndWriteNoteAsync(
		vaultRoot,
		'tracekeeper.distill_session',
		MEMORY_PROPOSAL_DIR,
		buildSafeFilename(filenameToken, proposalKind, context),
		{
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
		},
		body,
		taskId,
		context,
		{
			target_type: 'memory_proposal',
			proposal_kind: proposalKind,
		}
	);
	return { path: proposal.path, proposalId };
}

interface FinishTaskOperationPayload {
	requestHash?: string;
	requestSnapshot?: ReturnType<typeof buildFinishTaskRequestSnapshot>;
	projectMemoryEntryVersion?: 1;
	projectMemoryCreatedAt?: string;
	projectMemoryAgentType?: ObservedClientType | 'custom';
	taskId: string;
	summary: string;
	status: FinishTaskStatus;
	outcomes: string[];
	nextActions: string[];
	decisions: string[];
	solutionChanges: string[];
	lessons: string[];
	preferences: string[];
	memoryCandidates: string[];
	memoryCandidateRecords?: FinishTaskMemoryCandidateRecord[];
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
	if (payload.memoryCandidateRecords !== undefined && (!Array.isArray(payload.memoryCandidateRecords) || !payload.memoryCandidateRecords.every((item) => {
		return isRecord(item)
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
	if (!isRecord(payload.requestSnapshot) || typeof payload.requestSnapshot.task_id !== 'string') {
		return false;
	}
	if (
		payload.projectMemoryEntryVersion !== undefined
		&& payload.projectMemoryEntryVersion !== 1
	) {
		return false;
	}
	if (
		payload.projectMemoryEntryVersion === 1
		&& (
			typeof payload.projectMemoryCreatedAt !== 'string'
			|| Number.isNaN(Date.parse(payload.projectMemoryCreatedAt))
			|| typeof payload.projectMemoryAgentType !== 'string'
			|| !payload.projectMemoryAgentType
		)
	) {
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

async function buildFinishTaskOperationPayload(
	rawArgs: FinishTaskArgs,
	context: ToolInvocationContext,
	operationId: string,
	requestHash: string,
	requestSnapshot: ReturnType<typeof buildFinishTaskRequestSnapshot>
): Promise<FinishTaskOperationPayload> {
	const vaultRoot = configuredVaultRoot(context);
	const taskId = coerceNonEmptyString(rawArgs.task_id, true, 'task_id');
	const summary = coerceNonEmptyString(rawArgs.summary, true, 'summary');
	const status = coerceFinishTaskStatus(rawArgs.status);
	const outcomes = coerceStringOrStringArray(rawArgs.outcomes, 'outcomes');
	const nextActions = coerceStringOrStringArray(rawArgs.next_actions, 'next_actions');
	const decisions = coerceStringOrStringArray(rawArgs.decisions, 'decisions');
	const solutionChanges = coerceStringOrStringArray(rawArgs.solution_changes, 'solution_changes');
	const lessons = coerceStringOrStringArray(rawArgs.lessons, 'lessons');
	const preferences = coerceStringOrStringArray(rawArgs.preferences, 'preferences');
	const memoryCandidates: string[] = [];
	const memoryCandidateRecords = normalizeFinishTaskMemoryCandidateRecords(rawArgs.memory_candidate_records);
	const reviewProposalMode: ReviewProposalMode = DEFAULT_FINISH_TASK_REVIEW_MODE;
	const taskMetadata = await readAgentTaskMetadataAsync(vaultRoot, taskId, context);
	const identityScan = scanVaultForContext(vaultRoot, context);
	const explicitIdentity = resolveProjectIdentity(rawArgs, identityScan.notes);
	const projectIdentity = mergeTaskProjectIdentity(taskId, taskMetadata, explicitIdentity);
	const client = coerceOptionalString(rawArgs.client) || taskMetadata.client;
	const projectHint = projectIdentity.projectHint;
	const memoryScope = '';
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
	const closeoutGroups: FinishTaskCloseoutGroup[] = [];

	return {
		requestHash,
		requestSnapshot,
		projectMemoryEntryVersion: 1,
		projectMemoryCreatedAt: new Date().toISOString(),
		projectMemoryAgentType: (() => {
			const observed = context.observedClientType ?? normalizeObservedClientType(client);
			return observed === 'unknown' ? 'custom' : observed;
		})(),
		taskId,
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
		input.memoryCandidateRecords ?? []
	);
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
			summary: input.summary,
			related_wiki: input.relatedWiki,
			related_sources: input.relatedSources,
			architecture_status: input.architectureStatus.architecture_status,
			missing_graph_bridges: input.architectureStatus.missing_graph_bridges,
			created_at: new Date().toISOString(),
			status: input.status,
			memory_candidate_count: String((input.memoryCandidateRecords ?? []).length),
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

interface FinishTaskProjectMemoryPlan {
	groups: FinishTaskCloseoutGroup[];
	bridgeMetadata: MemoryBridgeReport;
}

interface FinishTaskProjectMemoryStepReceipt {
	outcome: 'immutable';
	path: string;
	project_id: string;
	agent_type: string;
	operation_id: string;
	operation_hash: string;
	memory_kinds: string[];
	memory_id?: string;
	claim_key?: string;
	write_status: 'written' | 'skipped';
}

function buildFinishTaskProjectMemoryPlan(
	input: FinishTaskOperationPayload,
	context: ToolContext
): FinishTaskProjectMemoryPlan | null {
	if (input.reviewProposalMode !== 'auto_propose') {
		return null;
	}
	const groups = input.closeoutGroups.filter((group) => {
		if (group.values.length === 0) {
			return false;
		}
		const memoryScope = resolveMemoryScope(
			group.kind,
			'',
			input.projectHint,
			input.memoryScope
		);
		return memoryScope === 'project'
			&& memoryProposalRuleFor(
				group.kind,
				'',
				input.projectHint,
				context,
				memoryScope
			) === 'auto_write';
	});
	if (groups.length === 0) {
		return null;
	}
	const bridgeMetadata = resolveProjectMemoryBridgeMetadata(
		input.vaultRoot,
		'project',
		input.projectHint,
		input.rawRelatedWiki ?? input.relatedWiki,
		input.rawRelatedSources ?? input.relatedSources,
		context
	);
	if (bridgeMetadata.missing_wiki_bridge) {
		return null;
	}
	return { groups, bridgeMetadata };
}

function buildFinishTaskProjectMemoryBody(
	groups: FinishTaskCloseoutGroup[]
): string {
	return groups.flatMap((group, index) => [
		...(index > 0 ? [''] : []),
		`## ${group.label}`,
		'',
		...group.values.map((value) => `- ${value}`),
	]).join('\n');
}

async function writeFinishTaskProjectMemoryArtifacts(
	input: FinishTaskOperationPayload,
	context: ToolContext,
	operationId: string
): Promise<FinishTaskProjectMemoryStepReceipt | { outcome: 'review_fallback' }> {
	const plan = buildFinishTaskProjectMemoryPlan(input, context);
	if (!plan) {
		throw new ToolInputError(
			'The finish-task project-memory step has no eligible immutable closeout groups.'
		);
	}
	const operationRecord = await operationJournalForVault(
		input.vaultRoot
	).loadById(operationId);
	const createdAt = input.projectMemoryCreatedAt
		?? operationRecord?.created_at;
	if (!createdAt) {
		throw new OperationConflictError(
			'Finish-task project-memory creation time is unavailable.'
		);
	}
	const observed = input.projectMemoryAgentType
		?? normalizeObservedClientType(input.client);
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

	const sessionNotePath = resolveFinishTaskSessionNotePath(input, context);
	for (const group of plan.groups) {
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
			'project',
			plan.bridgeMetadata.related_wiki,
			plan.bridgeMetadata.related_sources,
			input.architectureStatus,
			input.architectureStatus.missing_graph_bridges,
			false,
			plan.bridgeMetadata.missing_related_wiki,
			plan.bridgeMetadata.missing_related_sources,
			context,
			true
		);
	}
	return { outcome: 'review_fallback' };
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
		if (
			canAutoWrite
			&& memoryScope === 'project'
		) {
			return writeFinishTaskProjectMemoryArtifacts(
				input,
				context,
				operationId
			);
		}
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
		input.projectId,
		input.repoPath,
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
		input.memoryCandidateRecords ?? [],
		context,
		operationId,
		input.projectMemoryEntryVersion === 1
			&& buildFinishTaskProjectMemoryPlan(input, context) !== null
	);
	const proposalPaths = proposalResult.proposals.map((proposal) => proposal.path);
	const proposalIds = proposalResult.proposals.map((proposal) => proposal.proposalId);
	const autoWritePaths = proposalResult.autoAppliedMemoryUpdates.map((update) => update.path);

	const taskPath = await updateAgentTaskRecordAsync(
		input.vaultRoot,
		input.taskId,
		{
			status: input.status,
			finished_at: new Date().toISOString(),
			summary: input.summary,
			session_note: sessionNote.path,
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
		},
		context,
		{
			memory_writes: [sessionNote.path, ...autoWritePaths],
			proposal_ids: proposalIds,
			proposal_paths: proposalPaths,
			proposal_link_targets: proposalPaths,
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
			contentText(context, '## 长期记忆处理', '## Durable Memory Processing'),
			...(input.memoryCandidateRecords && input.memoryCandidateRecords.length > 0
				? input.memoryCandidateRecords.map((candidate) => `- [${candidate.scope}] ${candidate.content}`)
				: ['- (none; task facts remain task history only)']),
			`^finish-${operationId}`,
		].join('\n'),
		`^finish-${operationId}`
	);
	await updateManagedProposalReferences(
		input.vaultRoot,
		sessionNote.path,
		proposalResult.proposals,
		context
	);
	if (taskPath) {
		await updateManagedProposalReferences(
			input.vaultRoot,
			taskPath,
			proposalResult.proposals,
			context
		);
	}
	return taskPath;
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
		input.projectId,
		input.repoPath,
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
		input.memoryCandidateRecords ?? [],
		context,
		operationId,
		input.projectMemoryEntryVersion === 1
			&& buildFinishTaskProjectMemoryPlan(input, context) !== null
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
		activity_path: string;
		status: FinishTaskStatus;
		session_path: string;
		content_language: ContentLanguage;
		content_language_source: ContentLanguageSource;
		outcome_count: number;
		next_action_count: number;
		proposal_count?: number;
		proposals?: Array<{
			kind: string;
			proposal_id: string;
			path: string;
			proposal_link_target: string;
			proposal_link?: string;
		}>;
		suggestion_count?: number;
		suggested_memory_updates?: FinishTaskSuggestion[];
		auto_applied_count?: number;
		auto_applied_memory_updates?: FinishTaskProposalResult['autoAppliedMemoryUpdates'];
		memory_candidate_records: FinishTaskMemoryCandidateRecordResult[];
		memory_changes: FinishTaskMemoryChange[];
		memory_status: MemoryCloseoutStatus;
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
		session_path: sessionNote.path,
		activity_path: sessionNote.activity_path,
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
		project_identity: projectIdentityToResult(projectIdentity),
		related_wiki: input.relatedWiki,
		related_sources: input.relatedSources,
			architecture_status: input.architectureStatus.architecture_status,
			missing_graph_bridges: input.architectureStatus.missing_graph_bridges,
			missing_wiki_bridge: proposalResult.hasMissingWikiBridge,
		memory_status: memoryCloseoutState,
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
	const vaultRoot = configuredVaultRoot(context);
	const invocationContext = { ...context };
	const readView = await knowledgeReadViewForContext(vaultRoot, invocationContext);
	const preflightScan = lightweightScanFromReadView(vaultRoot, readView);
	context = {
		...invocationContext,
		knowledgeReadViewPromise: Promise.resolve(readView),
		knowledgeSnapshotProvider: () => preflightScan,
	};
	const application = new FinishTaskApplicationService({
		journal: operationJournalForVault(vaultRoot),
		failureInjection: context.operationFailureInjection,
		requestSnapshot: buildFinishTaskRequestSnapshot,
		requestIdempotencyKey: (args) => coerceOptionalString(args.idempotency_key),
		createIdentity: (requestHash, idempotencyKey, requestSnapshot) => buildToolOperationIdentity(
			'finish-task',
			idempotencyKey,
			requestSnapshot as Record<string, unknown>,
			context
		),
		loadExistingPayload: isFinishTaskOperationPayload,
		storedRequestHash: (payload) =>
			isRecord(payload) && typeof payload.requestHash === 'string'
				? payload.requestHash
				: '',
		buildPayload: (args, operationId, requestHash, requestSnapshot) =>
			buildFinishTaskOperationPayload(
				args,
				context,
				operationId,
				requestHash,
				requestSnapshot as ReturnType<typeof buildFinishTaskRequestSnapshot>
			),
		getTaskId: (payload) => payload.taskId,
		readLifecycle: (taskId) => readTaskLifecycleStateAsync(vaultRoot, taskId, context),
		markClosing: async (payload, operationId) => {
			await updateAgentTaskRecordAsync(vaultRoot, payload.taskId, {
				status: 'closing',
				finish_operation_id: operationId,
			}, context);
		},
		buildSteps: (operationPayload, operationId): FinishTaskRunnerStep[] => {
			const closeoutGroups = operationPayload.closeoutGroups.filter((group) =>
				finishTaskShouldWriteCloseoutGroup(group, operationPayload, context)
			);
			const projectMemoryPlan = buildFinishTaskProjectMemoryPlan(operationPayload, context);
			const aggregateProjectMemoryPlan = operationPayload.projectMemoryEntryVersion === 1
				? projectMemoryPlan
				: null;
			const aggregatedKinds = new Set(
				aggregateProjectMemoryPlan?.groups.map((group) => group.kind) ?? []
			);
			const closeoutSteps: FinishTaskRunnerStep[] = closeoutGroups
				.filter((group) => !aggregatedKinds.has(group.kind))
				.map((group) => ({
					name: `finish-task:${group.kind}`,
					execute: () => writeFinishTaskCloseoutArtifacts(
						operationPayload,
						group,
						context,
						operationId
					),
					persistResult: operationPayload.projectMemoryEntryVersion !== 1
						&& Boolean(
							projectMemoryPlan?.groups.some(
								(projectGroup) => projectGroup.kind === group.kind
							)
						),
				}));
			if (aggregateProjectMemoryPlan) {
				closeoutSteps.unshift({
					name: 'finish-task:project-memory',
					execute: () => writeFinishTaskProjectMemoryArtifacts(
						operationPayload,
						context,
						operationId
					),
					persistResult: true,
				});
			}
			return [
				{
					name: 'finish-task:session-note',
					execute: () => writeFinishTaskSessionNote(operationPayload, context, operationId),
				},
				...closeoutSteps,
				{
					name: 'finish-task:update-task-record',
					execute: () => updateFinishTaskRecord(operationPayload, context, operationId),
				},
			];
		},
		finalize: (operationPayload, operationId, idempotencyKey) => executeFinishTaskOperation(
			operationPayload,
			context,
			operationId,
			idempotencyKey
		),
	});
	return application.execute(rawArgs);
}


async function handleDistillSession(rawArgs: DistillSessionArgs, context: ToolContext) {
	const vaultRoot = configuredVaultRoot(context);
	const application = new DistillSessionApplicationService({
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
		buildBody: (summary, outcomes, nextActions, decisions, possiblePreferences) =>
			buildSessionNoteBodyWithDistill(
				context,
				summary,
				outcomes,
				nextActions,
				decisions,
				possiblePreferences
			),
		writeSessionNote: (input) => buildAndWriteNoteAsync(
			vaultRoot,
			'tracekeeper.distill_session',
			SESSION_NOTE_DIR,
			input.filename,
			input.frontmatter,
			input.body,
			input.taskId,
			context,
			input.metadata
		),
		memoryProposalAllowed: (proposalKind, projectHint) =>
			isMemoryProposalAllowed(proposalKind, '', projectHint, context),
		createProposal: async (input) => {
			const proposal = await createDistillProposal(
				vaultRoot,
				input.taskId,
				input.proposalKind,
				input.kindLabel,
				input.values,
				input.projectHint,
				context
			);
			return {
				proposalId: proposal.proposalId,
				path: proposal.path,
				linkTarget: proposal.path,
			};
		},
		updateTask: async (taskId, notePath, proposals) => updateAgentTaskRecordAsync(
			vaultRoot,
			taskId,
			{ session_note: notePath },
			context,
			{
				memory_writes: [notePath],
				proposal_ids: proposals.map((proposal) => proposal.proposalId),
				proposal_paths: proposals.map((proposal) => proposal.path),
				proposal_link_targets: proposals.map((proposal) => proposal.linkTarget),
			}
		),
		updateManagedProposalReferences: (recordPath, proposals) =>
			updateManagedProposalReferences(vaultRoot, recordPath, proposals, context),
	});
	return application.execute(rawArgs as DistillSessionRawRequest);
}
