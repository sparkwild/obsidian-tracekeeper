import {
	App,
	FileSystemAdapter,
	ItemView,
	Modal,
	Notice,
	Platform,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	requestUrl,
	WorkspaceLeaf,
	getLanguage,
} from 'obsidian';
import { randomBytes } from 'node:crypto';
import {
	StreamableHttpMcpRuntime,
	type StreamableHttpRuntimeStatus,
	type RuntimeState,
} from '../../mcp-server/src/http-runtime';
import { toolDefinitions } from '../../mcp-server/src/tools';
import {
	ARCHIVE_ROOT,
	ARCHIVE_REVIEW_QUEUE_DIR,
	KNOWLEDGE_INDEX_PATH,
	KNOWLEDGE_MEMORY_INDEX_PATH,
	KNOWLEDGE_PROJECTS_INDEX_PATH,
	KNOWLEDGE_SOURCES_DIR,
	KNOWLEDGE_SOURCES_INDEX_PATH,
	KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
	KNOWLEDGE_WIKI_INDEX_PATH,
	LEGACY_TOP_LEVEL_DIRS,
	TRACEKEEPER_AGENT_REQUESTS_DIR,
	TRACEKEEPER_AUDIT_DIR,
	TRACEKEEPER_AUDIT_LOG_PATH,
	TRACEKEEPER_CONTEXT_PACKS_DIR,
	TRACEKEEPER_CONTROL_DIR,
	TRACEKEEPER_MEMORY_POLICY_PATH,
	TRACEKEEPER_PERMISSIONS_PATH,
	TRACEKEEPER_REVIEW_QUEUE_DIR,
	TRACEKEEPER_SYSTEM_PATH,
	TRACEKEEPER_TASKS_DIR,
	TRACEKEEPER_WORK_DIR,
	buildLegacyMigrationReviewPath,
	enrichLegacyMarkdownContent,
	getLegacyStructureTarget,
	renderLegacyMigrationReview,
	type LegacyStructureKind,
} from '../../../packages/core/dist/index';

const TRACEKEEPER_ACTIVITY_VIEW = 'tracekeeper-activity';
const TRACEKEEPER_SOURCE_STATUS_VIEW = 'tracekeeper-source-status';
const TRACEKEEPER_REVIEW_QUEUE_VIEW = 'tracekeeper-review-queue';
const TRACEKEEPER_MEMORY_INSPECTOR_VIEW = 'tracekeeper-memory-inspector';
const TRACEKEEPER_RUNTIME_LOG_VIEW = 'tracekeeper-runtime-log';
const TRACEKEEPER_RUNTIME_STATUS_VIEW = 'tracekeeper-runtime-status';
const TRACEKEEPER_PERMISSION_POLICY_VIEW = 'tracekeeper-permission-policy';
const TRACEKEEPER_GRAPH_HEALTH_VIEW = 'tracekeeper-graph-health';
const LEGACY_AGENT_CONNECTIONS_VIEW = 'tracekeeper-agent-connections';
const CONTROL_FILES: Array<{ path: string; content: string }> = [
	{
		path: TRACEKEEPER_SYSTEM_PATH,
		content: '# System Control\n\nObsidian-native memory system control defaults for Tracekeeper.\n',
	},
	{
		path: TRACEKEEPER_MEMORY_POLICY_PATH,
		content: '# Memory Policy\n\n- Writing is permissioned.\n- Vault scope: vault-root only.\n',
	},
	{
		path: TRACEKEEPER_PERMISSIONS_PATH,
		content: '# Permissions\n\n- Default: read-only for automation.\n- User confirmation required for memory writes.\n',
	},
];
const KNOWLEDGE_ENTRY_FILES: Array<{ path: string; content: string }> = [
	{
		path: KNOWLEDGE_INDEX_PATH,
		content: '# Knowledge Index\n\n- [[memory/index|Memory]]\n- [[wiki/index|Wiki]]\n- [[sources/index|Sources]]\n',
	},
	{
		path: KNOWLEDGE_MEMORY_INDEX_PATH,
		content: '# Memory Index\n\n- [[projects/index|Project memory]]\n',
	},
	{
		path: KNOWLEDGE_PROJECTS_INDEX_PATH,
		content: '# Project Memory Index\n\nProject-level memory indexes live here.\n',
	},
	{
		path: KNOWLEDGE_WIKI_INDEX_PATH,
		content: '# Wiki Index\n\n- [[hubs/index|Hubs]]\n',
	},
	{
		path: KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
		content: '# Wiki Hubs\n\nCreate topic hubs here and link related memory from each hub.\n',
	},
	{
		path: KNOWLEDGE_SOURCES_INDEX_PATH,
		content: '# Sources Index\n\nSource notes and captured references live here.\n',
	},
];
const CONTROL_PATHS = {
	root: TRACEKEEPER_CONTROL_DIR,
	auditLog: TRACEKEEPER_AUDIT_LOG_PATH,
	auditDir: TRACEKEEPER_AUDIT_DIR,
};
const SOURCE_REQUESTS_PATH = TRACEKEEPER_AGENT_REQUESTS_DIR;
const REVIEW_QUEUE_PATH = TRACEKEEPER_REVIEW_QUEUE_DIR;
const AGENT_TASKS_PATH = TRACEKEEPER_TASKS_DIR;
const CONTEXT_PACKS_PATH = TRACEKEEPER_CONTEXT_PACKS_DIR;
const SOURCES_PATH = KNOWLEDGE_SOURCES_DIR;
const vaultParentFolder = (path: string): string => path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
const BASE_STRUCTURE_FOLDERS: string[] = [
	CONTROL_PATHS.root,
	REVIEW_QUEUE_PATH,
	TRACEKEEPER_WORK_DIR,
	ARCHIVE_ROOT,
	...KNOWLEDGE_ENTRY_FILES.map((file) => vaultParentFolder(file.path)).filter(Boolean),
];
const MAX_TASK_SNIPPET_LENGTH = 160;
const MAX_TASK_ROWS = 6;
const MAX_AUDIT_ROWS = 12;
const MAX_SOURCE_STATUS_ROWS = 20;
const MAX_REVIEW_QUEUE_ROWS = 20;
const ACTIVITY_TIMELINE_PREVIEW_ROWS = 5;
const ACTIVITY_TIMELINE_PAGE_SIZE = 10;
const RUNTIME_LOG_PAGE_SIZE = 20;
const TRACE_RECALL_RESULT_LIMIT = 8;
const MAX_ACTIVITY_CONTEXT_PACK_ROWS = 5;
const MAX_ACTIVITY_SOURCE_CAPTURE_ROWS = 5;
const MAX_ACTIVITY_PROPOSAL_ROWS = 5;
const MAX_AGENT_CONNECTION_ROWS = 8;
const MAX_AGENT_TOOL_CALL_ROWS = 12;
const MAX_GRAPH_HEALTH_ITEMS = 20;
const PLUGIN_DISPLAY_NAME_ZH = '知识库';
const PLUGIN_DISPLAY_NAME_EN = 'Tracekeeper';
const DEFAULT_MCP_PORT = 58437;
const DEFAULT_MCP_HOST = '127.0.0.1';
const DEFAULT_MCP_PATH = '/mcp';
const DEFAULT_MCP_HTTP_ENDPOINT = `http://${DEFAULT_MCP_HOST}:${DEFAULT_MCP_PORT}${DEFAULT_MCP_PATH}`;
const LEGACY_DEFAULT_MCP_HTTP_ENDPOINTS = ['http://127.0.0.1:37241/mcp'];
const MEMORY_RECALL_SCOPES = ['global', 'project', 'project_history'] as const;

type TracekeeperRecallScope = typeof MEMORY_RECALL_SCOPES[number];
const isChineseLanguage = (language: string): boolean => {
	const normalized = language.toLowerCase();
	return normalized === 'zh' || normalized.startsWith('zh-') || normalized.startsWith('zh_');
};
const ui = (zh: string, en: string): string => (isChineseLanguage(getLanguage()) ? zh : en);
const localizedText = (text: LocalizedText): string => ui(text.zh, text.en);
const pluginDisplayName = (): string => ui(PLUGIN_DISPLAY_NAME_ZH, PLUGIN_DISPLAY_NAME_EN);

interface LocalizedText {
	zh: string;
	en: string;
}

type McpCapabilityRisk = 'read-only' | 'low-risk-write' | 'review-gated-write' | 'optional-write';

interface McpCapabilityLocalization {
	title: LocalizedText;
	description: LocalizedText;
	category: LocalizedText;
	risk: McpCapabilityRisk;
}

const MCP_CAPABILITY_LOCALIZATIONS: Record<string, McpCapabilityLocalization> = {
	'tracekeeper.status': {
		title: { zh: '查看状态', en: 'Check status' },
		description: {
			zh: '扫描当前知识库，返回基础文件数量、待审核项目、任务和最近活动概览。',
			en: 'Scans the current vault and returns counts for notes, review items, tasks, and recent activity.',
		},
		category: { zh: '概览', en: 'Overview' },
		risk: 'read-only',
	},
	'tracekeeper.graph_health': {
		title: { zh: '检查知识图谱', en: 'Check graph health' },
		description: {
			zh: '分析 wikilink、入口页、hub、孤立节点和未解析链接，帮助判断 Obsidian 图谱结构是否健康。',
			en: 'Analyzes wikilinks, entry notes, hubs, isolated notes, and unresolved links to assess graph health.',
		},
		category: { zh: '维护', en: 'Maintenance' },
		risk: 'read-only',
	},
	'tracekeeper.start_task': {
		title: { zh: '开始任务', en: 'Start task' },
		description: {
			zh: '开始一次 Agent 工作，记录任务并返回下一步建议召回方式。',
			en: 'Starts an agent task, records it, and returns the recommended recall step.',
		},
		category: { zh: '任务', en: 'Task' },
		risk: 'low-risk-write',
	},
	'tracekeeper.recall': {
		title: { zh: '召回记忆', en: 'Recall memory' },
		description: {
			zh: '优先用它查找相关记忆、Wiki 和来源；结果包含摘要、命中原因和图谱链接。',
			en: 'Use first to find related memory, wiki, and sources; results include excerpts, match reasons, and graph links.',
		},
		category: { zh: '检索', en: 'Recall' },
		risk: 'read-only',
	},
	'tracekeeper.project_context': {
		title: { zh: '项目上下文', en: 'Project context' },
		description: {
			zh: '按项目、仓库路径或项目 ID 定向检索，避免无差别加载所有项目记忆。',
			en: 'Retrieves context scoped by project, repository path, or project id instead of loading every project memory.',
		},
		category: { zh: '检索', en: 'Recall' },
		risk: 'read-only',
	},
	'tracekeeper.project_history': {
		title: { zh: '项目历史', en: 'Project history' },
		description: {
			zh: '读取指定项目的历史任务、会话和连续性记录，帮助 Agent 接上之前的工作。',
			en: 'Reads project-scoped task, session, and continuity records so agents can resume prior work.',
		},
		category: { zh: '检索', en: 'Recall' },
		risk: 'read-only',
	},
	'tracekeeper.read_note': {
		title: { zh: '读取笔记', en: 'Read note' },
		description: {
			zh: '在召回摘要不够时，按知识库相对路径读取单篇完整笔记。',
			en: 'Reads one full note by vault-relative path when recall excerpts are not enough.',
		},
		category: { zh: '检索', en: 'Recall' },
		risk: 'read-only',
	},
	'tracekeeper.review_queue': {
		title: { zh: '查看审核队列', en: 'Review queue' },
		description: {
			zh: '查看待审核或已批准的记忆提案；真正写回仍需要单独的审核后写入动作。',
			en: 'Lists pending or approved memory proposals; durable writeback still requires the separate review-gated apply action.',
		},
		category: { zh: '审核', en: 'Review' },
		risk: 'read-only',
	},
	'tracekeeper.list_review_queue': {
		title: { zh: '查看审核队列', en: 'List review queue' },
		description: {
			zh: '读取等待用户确认的记忆提案；全局记忆默认需要审核，项目记忆可按规则自动保存。',
			en: 'Reads memory proposals waiting for review; global memory defaults to review, while project memory can auto-save by rule.',
		},
		category: { zh: '审核', en: 'Review' },
		risk: 'read-only',
	},
	'tracekeeper.list_source_requests': {
		title: { zh: '查看资料请求', en: 'List source requests' },
		description: {
			zh: '读取等待 Agent 处理的资料分析请求，用于后续生成来源笔记、分析报告或记忆提案。',
			en: 'Reads pending source-analysis requests that can later produce source notes, reports, or memory proposals.',
		},
		category: { zh: '资料', en: 'Source' },
		risk: 'read-only',
	},
	'tracekeeper.list_approved_writebacks': {
		title: { zh: '查看已批准写回', en: 'List approved writebacks' },
		description: {
			zh: '读取已经通过审核、可以由运行时执行写回的候选提案。',
			en: 'Reads proposals that have already been approved and are candidates for runtime writeback.',
		},
		category: { zh: '审核', en: 'Review' },
		risk: 'read-only',
	},
	'tracekeeper.audit_recent': {
		title: { zh: '查看审计记录', en: 'Read audit log' },
		description: {
			zh: '读取最近的连接、工具调用、配置写入和错误记录，便于排查 Agent 使用情况。',
			en: 'Reads recent connection, tool-call, config-write, and error records for troubleshooting agent activity.',
		},
		category: { zh: '日志', en: 'Log' },
		risk: 'read-only',
	},
	'tracekeeper.analyze_source_request': {
		title: { zh: '分析资料请求', en: 'Analyze source request' },
		description: {
			zh: '处理一条资料请求，生成来源笔记、分析输出、审核提案和审计记录。',
			en: 'Processes one source request and writes source notes, analysis output, review proposals, and audit entries.',
		},
		category: { zh: '资料', en: 'Source' },
		risk: 'low-risk-write',
	},
	'tracekeeper.source_request': {
		title: { zh: '处理资料请求', en: 'Source requests' },
		description: {
			zh: '查看资料请求，或处理一条已有请求；不会主动抓取外部网络内容。',
			en: 'Lists source requests or analyzes one existing request; it does not fetch external network content.',
		},
		category: { zh: '资料', en: 'Source' },
		risk: 'optional-write',
	},
	'tracekeeper.apply_approved_writeback': {
		title: { zh: '应用已批准写回', en: 'Apply approved writeback' },
		description: {
			zh: '只对已经批准的审核提案执行写回，把明确批准的内容追加到目标笔记。',
			en: 'Applies only approved review proposals by appending explicitly approved content to the target note.',
		},
		category: { zh: '写回', en: 'Writeback' },
		risk: 'review-gated-write',
	},
	'tracekeeper.build_context_pack': {
		title: { zh: '生成上下文包', en: 'Build context pack' },
		description: {
			zh: '根据查询生成精简上下文；默认只返回结果，只有指定写入时才创建笔记。',
			en: 'Builds compact context from a query; returns results by default and writes only when requested.',
		},
		category: { zh: '上下文', en: 'Context' },
		risk: 'optional-write',
	},
	'tracekeeper.lint': {
		title: { zh: '检查知识库规范', en: 'Run vault checks' },
		description: {
			zh: '统一检查目录结构、链接、来源引用、声明来源和知识图谱问题。',
			en: 'Checks structure, links, source references, claim sources, and graph health in one entry.',
		},
		category: { zh: '维护', en: 'Maintenance' },
		risk: 'read-only',
	},
	'tracekeeper.finish_task': {
		title: { zh: '结束任务', en: 'Finish task' },
		description: {
			zh: '任务结束时记录总结，并按记忆规则忽略、建议、加入审核或保存项目记忆。',
			en: 'Records task closeout and handles memory candidates by rule: ignore, suggest, review, or project save.',
		},
		category: { zh: '任务', en: 'Task' },
		risk: 'low-risk-write',
	},
	'tracekeeper.distill_session': {
		title: { zh: '提炼会话', en: 'Distill session' },
		description: {
			zh: '把一次会话中的决策、偏好和后续动作整理成会话记录与待审核记忆提案。',
			en: 'Distills decisions, preferences, and next actions from a session into a session note and reviewable memory proposals.',
		},
		category: { zh: '记忆', en: 'Memory' },
		risk: 'low-risk-write',
	},
	'tracekeeper.write_context_pack': {
		title: { zh: '写入上下文包', en: 'Write context pack' },
		description: {
			zh: '把已生成的上下文内容写入 Tracekeeper 工作区，便于后续复用和审计。',
			en: 'Writes generated context content under the Tracekeeper workspace for reuse and auditability.',
		},
		category: { zh: '上下文', en: 'Context' },
		risk: 'low-risk-write',
	},
	'tracekeeper.write_session_note': {
		title: { zh: '写入会话记录', en: 'Write session note' },
		description: {
			zh: '把会话内容写入 Tracekeeper 工作区，作为任务过程的本地记录。',
			en: 'Writes session content under the Tracekeeper workspace as a local record of the work.',
		},
		category: { zh: '记录', en: 'Record' },
		risk: 'low-risk-write',
	},
	'tracekeeper.capture_source': {
		title: { zh: '捕获资料来源', en: 'Capture source' },
		description: {
			zh: '记录网页、文件或文本来源的元数据和内容快照，保持知识来源可追溯。',
			en: 'Records metadata and optional content snapshots for web, file, or text sources so knowledge remains traceable.',
		},
		category: { zh: '资料', en: 'Source' },
		risk: 'low-risk-write',
	},
	'tracekeeper.propose_memory': {
		title: { zh: '提交记忆提案', en: 'Propose memory' },
		description: {
			zh: '按记忆规则处理 Agent 认为值得长期保存的内容；全局默认审核，项目可自动保存。',
			en: 'Handles agent-suggested durable memory by memory rules; global defaults to review, project memory can auto-save.',
		},
		category: { zh: '记忆', en: 'Memory' },
		risk: 'low-risk-write',
	},
};

type ParsedRecordValue = string | string[];

interface ParsedRecord {
	[key: string]: ParsedRecordValue;
}

interface ParsedFrontmatter {
	fields: ParsedRecord;
	body: string;
}

interface MemoryInitializationPlan {
	foldersToCreate: string[];
	filesToCreate: string[];
	missingAuditLog: boolean;
}

type StructureState = 'initialized' | 'partial' | 'missing' | 'legacy_detected';
type LegacyStructureAction = 'copy_rebuild' | 'review_conflict' | 'review_existing' | 'skip_existing' | 'unmapped';

interface TracekeeperStructureStatus {
	state: StructureState;
	label: string;
	detail: string;
	missingFolders: string[];
	missingFiles: string[];
	missingCount: number;
	totalCount: number;
}

interface LegacyStructurePlanItem {
	oldPath: string;
	newPath: string;
	kind: LegacyStructureKind;
	action: LegacyStructureAction;
	reason: string;
	isMarkdown: boolean;
}

interface LegacyStructurePlan {
	migrationId: string;
	legacyRoots: string[];
	items: LegacyStructurePlanItem[];
	fileCount: number;
	markdownCount: number;
	nonMarkdownCount: number;
	copyCount: number;
	conflictCount: number;
	reviewCount: number;
	skipCount: number;
	uncoveredCount: number;
}

interface StructureOrganizerSnapshot {
	basePlan: MemoryInitializationPlan;
	legacyPlan: LegacyStructurePlan;
	state: 'ready' | 'needs_repair' | 'legacy_detected';
}

interface LegacyMigrationResult {
	migrationId: string;
	copiedCount: number;
	conflictCount: number;
	reviewCount: number;
	reportMdPath: string;
	reportJsonPath: string;
}

interface LegacyCleanupResult {
	cleanupId: string;
	trashedRoots: string[];
	missingRoots: string[];
	failedRoots: Array<{ path: string; error: string }>;
	reportPath: string;
	taskPath: string;
}

interface AgentTaskRecord {
	path: string;
	type: string;
	taskId: string;
	agent: string;
	objective: string;
	status: string;
	startedAt: string;
	finishedAt: string;
	contextPack: string;
	relatedProject: string;
	memoryReads: string[];
	memoryWrites: string[];
	sourceCaptures: string[];
	proposals: string[];
	snippet: string;
	sortTimestamp: number;
}

interface ContextPackRecord {
	path: string;
	title: string;
	taskId: string;
	createdAt: string;
	snippet: string;
	sortTimestamp: number;
}

interface SourceCaptureRecord {
	path: string;
	type: string;
	title: string;
	source: string;
	sourceKind: string;
	mode: string;
	taskId: string;
	createdAt: string;
	snippet: string;
	sortTimestamp: number;
}

interface SourceRequestRecord {
	path: string;
	type: string;
	source: string;
	sourceKind: string;
	purpose: string;
	relatedProject: string;
	analysisMode: string;
	status: string;
	taskId: string;
	created: string;
	summary: string;
	sortTimestamp: number;
}

interface SourceAnalysisSnapshot {
	requests: SourceRequestRecord[];
	missingRequestFolder: boolean;
	updatedAt: string;
}

type MemoryProposalStatus =
	| 'pending'
	| 'approved'
	| 'rejected'
	| 'deferred'
	| 'revision_requested'
	| 'applied';

const REVIEW_QUEUE_FILTERS: Array<MemoryProposalStatus | 'all'> = [
	'pending',
	'approved',
	'rejected',
	'deferred',
	'revision_requested',
	'applied',
	'all',
];

const memoryProposalStatusLabel = (status: MemoryProposalStatus): string => {
	switch (status) {
		case 'approved':
			return ui('已批准', 'Approved');
		case 'rejected':
			return ui('已拒绝', 'Rejected');
		case 'deferred':
			return ui('已暂缓', 'Deferred');
		case 'revision_requested':
			return ui('需修订', 'Revision requested');
		case 'applied':
			return ui('已写回', 'Applied');
		case 'pending':
		default:
			return ui('待审核', 'Pending');
	}
};

type GraphProfile = 'off' | 'advisory' | 'strict';
type GraphProfileIssueSeverity = 'warning' | 'error';
type MemoryProposalRule = 'review_queue' | 'auto_write' | 'disabled';
type TaskMemoryProposalMode = 'off' | 'suggest' | 'review_queue' | 'auto_propose';

const GRAPH_PROFILES: GraphProfile[] = ['off', 'advisory', 'strict'];
const MEMORY_PROPOSAL_RULES: MemoryProposalRule[] = ['auto_write', 'review_queue', 'disabled'];
const TASK_MEMORY_PROPOSAL_MODES: TaskMemoryProposalMode[] = ['auto_propose', 'review_queue', 'off'];
const MEMORY_RULES_VERSION = 2;

const normalizeGraphProfileValue = (value: unknown): GraphProfile => {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return GRAPH_PROFILES.includes(normalized as GraphProfile)
		? normalized as GraphProfile
		: 'advisory';
};

const graphProfileLabel = (profile: GraphProfile): string => {
	switch (profile) {
		case 'off':
			return ui('关闭', 'Off');
		case 'strict':
			return ui('严格', 'Strict');
		case 'advisory':
		default:
			return ui('建议', 'Advisory');
	}
};

const normalizeMemoryProposalRule = (value: unknown, fallback: MemoryProposalRule = 'review_queue'): MemoryProposalRule => {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return MEMORY_PROPOSAL_RULES.includes(normalized as MemoryProposalRule)
		? normalized as MemoryProposalRule
		: fallback;
};

const memoryProposalRuleLabel = (rule: MemoryProposalRule): string => {
	switch (rule) {
		case 'auto_write':
			return ui('自动', 'Auto');
		case 'disabled':
			return ui('忽略', 'Ignore');
		case 'review_queue':
		default:
			return ui('审核', 'Review');
	}
};

const normalizeTaskMemoryProposalMode = (value: unknown): TaskMemoryProposalMode => {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	if (normalized === 'suggest') {
		return 'review_queue';
	}
	return TASK_MEMORY_PROPOSAL_MODES.includes(normalized as TaskMemoryProposalMode)
		? normalized as TaskMemoryProposalMode
		: 'off';
};

const taskMemoryProposalModeLabel = (mode: TaskMemoryProposalMode): string => {
	switch (mode) {
		case 'review_queue':
		case 'suggest':
			return ui('审核', 'Review');
		case 'auto_propose':
			return ui('自动', 'Auto');
		case 'off':
		default:
			return ui('忽略', 'Ignore');
	}
};

const mcpCapabilityRiskLabel = (risk: McpCapabilityRisk): string => {
	switch (risk) {
		case 'low-risk-write':
			return ui('低风险写入', 'Low-risk write');
		case 'review-gated-write':
			return ui('审核后写入', 'Review-gated write');
		case 'optional-write':
			return ui('可选写入', 'Optional write');
		case 'read-only':
		default:
			return ui('只读', 'Read-only');
	}
};

const runtimeLogCleanupScopeLabel = (scope: RuntimeLogCleanupScope): string => {
	switch (scope) {
		case 'all':
			return ui('全部', 'All');
		case 'older-than-month':
			return ui('一个月前', 'Older than one month');
		case 'older-than-three-months':
			return ui('三个月前', 'Older than three months');
		case 'older-than-week':
		default:
			return ui('一周前', 'Older than one week');
	}
};

interface AuditEventRecord {
	path: string;
	auditId: string;
	actor: string;
	action: string;
	target: string;
	reason: string;
	taskId: string;
	timestamp: string;
	sortTimestamp: number;
	snippet: string;
	eventType: string;
	agentId: string;
	sessionId: string;
	clientName: string;
	toolName: string;
	resultStatus: string;
	targetPaths: string[];
	durationMs: string;
	riskLevel: string;
	argsSummary: string;
	transport: string;
	runtimeVersion: string;
}

interface MemoryProposalRecord {
	path: string;
	proposalId: string;
	proposalKind: string;
	proposedBy: string;
	relatedProject: string;
	taskId: string;
	targetNote: string;
	evidence: string[];
	riskLevel: string;
	approvalStatus: MemoryProposalStatus;
	created: string;
	snippet: string;
	sortTimestamp: number;
}

interface MemoryRecallInput {
	query: string;
	scope: TracekeeperRecallScope;
	projectHint?: string;
}

interface MemoryRecallResultEntry {
	path: string;
	title: string;
	scope: string;
	type: string;
	score: number;
	matchedTokens: string[];
	reason: string;
}

interface MemoryRecallResult {
	query: string;
	scope: TracekeeperRecallScope;
	projectHint: string;
	items: MemoryRecallResultEntry[];
	sourceTool: string;
}

interface MemoryReviewQueueSnapshot {
	proposals: MemoryProposalRecord[];
	missingReviewQueueFolder: boolean;
	updatedAt: string;
}

interface ActivityTimelineItem {
	time: number;
	type: string;
	title: string;
	meta: string;
	body: string;
	path: string;
}

interface ActivityTimelineSnapshot {
	items: ActivityTimelineItem[];
	page: number;
	pageSize: number;
	totalItems: number;
	totalPages: number;
	updatedAt: string;
}

type RuntimeLogFilter = 'all' | 'connection' | 'tool' | 'config' | 'error';
type RuntimeLogCategory = 'connection' | 'tool' | 'config' | 'record';
type RuntimeLogCleanupScope = 'older-than-week' | 'older-than-month' | 'older-than-three-months' | 'all';

const RUNTIME_LOG_FILTERS: RuntimeLogFilter[] = [
	'all',
	'connection',
	'tool',
	'config',
	'error',
];

const RUNTIME_LOG_CLEANUP_OPTIONS: RuntimeLogCleanupScope[] = [
	'older-than-week',
	'older-than-month',
	'older-than-three-months',
	'all',
];

interface RuntimeLogItem {
	time: number;
	category: RuntimeLogCategory;
	title: string;
	meta: string;
	body: string;
	path: string;
	status: string;
}

interface RuntimeLogSnapshot {
	items: RuntimeLogItem[];
	filter: RuntimeLogFilter;
	counts: Record<RuntimeLogFilter, number>;
	page: number;
	pageSize: number;
	totalItems: number;
	totalPages: number;
	updatedAt: string;
}

interface RuntimeLogCleanupResult {
	removedSections: number;
	removedFiles: number;
}

interface GraphHealthHubCandidate {
	path: string;
	degree: number;
	inbound: number;
	outbound: number;
}

interface GraphProfileIssue {
	kind: string;
	severity: GraphProfileIssueSeverity;
	message: string;
	count: number;
	paths: string[];
}

interface GraphHealthSnapshot {
	ok: boolean;
	readOnly: boolean;
	profile: GraphProfile;
	disabled: boolean;
	vaultRoot: string;
	scannedAt: string;
	updatedAt: string;
	errorMessage: string;
	noteCount: number;
	wikilinkEdgeCount: number;
	resolvedEdgeCount: number;
	unresolvedEdgeCount: number;
	largestComponentNodeCount: number;
	componentCount: number;
	isolatedNodes: string[];
	isolatedNodeCount: number;
	onlyInboundNodes: string[];
	onlyInboundNodeCount: number;
	onlyOutboundNodes: string[];
	onlyOutboundNodeCount: number;
	hubCandidates: GraphHealthHubCandidate[];
	hubCandidateCount: number;
	missingRecommendedEntry: string;
	missingRecommendedHubs: string[];
	missingRecommendedHubCount: number;
	recommendations: string[];
	recommendationCount: number;
	profileIssues: GraphProfileIssue[];
}

interface AgentActivitySnapshot {
	runtimeStatus: RuntimeViewStatus;
	structureStatus: TracekeeperStructureStatus;
	vaultRoot: string;
	latestTask: AgentTaskRecord | null;
	recentTasks: AgentTaskRecord[];
	recentContextPacks: ContextPackRecord[];
	recentSourceCaptures: SourceCaptureRecord[];
	recentSourceRequests: SourceRequestRecord[];
	recentProposals: MemoryProposalRecord[];
	recentAuditEvents: AuditEventRecord[];
	timelineItems: ActivityTimelineItem[];
	recentAgentCount: number;
	recentToolCallCount: number;
	missingTaskFolder: boolean;
	missingAuditSources: boolean;
	updatedAt: string;
}

interface AgentConnectionRecord {
	agentId: string;
	sessionId: string;
	clientName: string;
	transport: string;
	status: string;
	lastSeen: string;
	lastToolCall: string;
	runtimeVersion: string;
	permissionProfile: string;
	sortTimestamp: number;
}

interface AgentToolCallRecord {
	agentId: string;
	sessionId: string;
	clientName: string;
	toolName: string;
	resultStatus: string;
	targetPaths: string[];
	timestamp: string;
	durationMs: string;
	riskLevel: string;
	argsSummary: string;
	sortTimestamp: number;
}

type ConnectionTransport = 'streamable-http';
type ClientConfigState = 'configured' | 'needs_update' | 'not_configured' | 'unavailable';

interface RuntimeViewStatus {
	enabled: boolean;
	state: RuntimeState;
	label: string;
	detail: string;
	endpoint: string;
	host: string;
	port: number;
	startedAt: string;
	activeSessions: number;
	lastError: string;
}

interface ClientProfile {
	id: string;
	displayName: string;
	description: string;
	preferredTransport: ConnectionTransport;
	supportsAutoConfigure: boolean;
	restartRequired: boolean;
	configFormat: 'codex-toml' | 'mcp-json' | 'copy-only';
	targetPath?: string;
}

interface GeneratedClientConfig {
	clientId: string;
	displayName: string;
	description: string;
	transport: ConnectionTransport;
	configText: string;
	supportsAutoConfigure: boolean;
	restartRequired: boolean;
	configFormat: ClientProfile['configFormat'];
	targetPath?: string;
	configState: ClientConfigState;
	configStatusLabel: string;
	configStatusDetail: string;
}

interface ApprovedWritebackPreview {
	proposal_id: string;
	proposal_path: string;
	target_note: string;
	writeback_preview: string;
	touched_notes: string[];
}

interface DesktopNodeApi {
	fs: {
		existsSync(path: string): boolean;
		readFileSync(path: string, encoding: 'utf8'): string;
		writeFileSync(path: string, content: string, encoding: 'utf8'): void;
		mkdirSync(path: string, options: { recursive: boolean }): void;
		renameSync(oldPath: string, newPath: string): void;
	};
	path: {
		dirname(path: string): string;
		join(...parts: string[]): string;
	};
	os: {
		homedir(): string;
	};
	shell?: {
		openPath(path: string): Promise<string>;
	};
}

type StreamableHttpRuntimeOptionsWithGraphProfile = ConstructorParameters<typeof StreamableHttpMcpRuntime>[0] & {
	graphProfile?: GraphProfile;
	memoryRules?: {
		globalMemoryRule: MemoryProposalRule;
		projectMemoryRule: MemoryProposalRule;
		taskMemoryProposalMode: TaskMemoryProposalMode;
	};
};

interface AgentConnectionsSnapshot {
	vaultRoot: string;
	httpEndpoint: string;
	connectionUrl: string;
	runtimeStatus: RuntimeViewStatus;
	clientConfigs: GeneratedClientConfig[];
	recentAgents: AgentConnectionRecord[];
	recentToolCalls: AgentToolCallRecord[];
	missingAuditSources: boolean;
	updatedAt: string;
}

interface TracekeeperSettings {
	memoryRulesVersion: number;
	defaultAgentScope: string;
	mcpRuntimeEnabled: boolean;
	mcpPort: number;
	runtimeToken: string;
	runtimeTokenCreatedAt: string;
	graphProfile: GraphProfile;
	globalMemoryRule: MemoryProposalRule;
	projectMemoryRule: MemoryProposalRule;
	taskMemoryProposalMode: TaskMemoryProposalMode;
}

const DEFAULT_SETTINGS: TracekeeperSettings = {
	memoryRulesVersion: MEMORY_RULES_VERSION,
	defaultAgentScope: 'vault',
	mcpRuntimeEnabled: true,
	mcpPort: DEFAULT_MCP_PORT,
	runtimeToken: '',
	runtimeTokenCreatedAt: '',
	graphProfile: 'advisory',
	globalMemoryRule: 'review_queue',
	projectMemoryRule: 'auto_write',
	taskMemoryProposalMode: 'off',
};

export default class TracekeeperPlugin extends Plugin {
	settings: TracekeeperSettings = DEFAULT_SETTINGS;
	private mcpRuntime: StreamableHttpMcpRuntime | null = null;
	private uiMcpSessionId = '';
	private uiMcpRequestId = 1;
	private runtimeStatus: StreamableHttpRuntimeStatus = {
		state: 'stopped',
		host: DEFAULT_MCP_HOST,
		port: DEFAULT_MCP_PORT,
		path: DEFAULT_MCP_PATH,
		endpoint: DEFAULT_MCP_HTTP_ENDPOINT,
		startedAt: '',
		activeSessions: 0,
		lastError: '',
	};

	async onload() {
		this.settings = this.normalizeSettings(await this.loadData());
		await this.saveSettings();
		await this.startMcpRuntime();

		this.registerView(
			TRACEKEEPER_SOURCE_STATUS_VIEW,
			(leaf) => new TracekeeperSourceStatusView(leaf, this)
		);
		this.registerView(
			TRACEKEEPER_ACTIVITY_VIEW,
			(leaf) => new TracekeeperActivityView(leaf, this)
		);
		this.registerView(
			TRACEKEEPER_REVIEW_QUEUE_VIEW,
			(leaf) => new TracekeeperReviewQueueView(leaf, this)
		);
		this.registerView(
			TRACEKEEPER_MEMORY_INSPECTOR_VIEW,
			(leaf) => new TracekeeperMemoryInspectorView(leaf)
		);
		this.registerView(
			TRACEKEEPER_RUNTIME_LOG_VIEW,
			(leaf) => new TracekeeperRuntimeLogView(leaf, this)
		);
		this.registerView(
			TRACEKEEPER_RUNTIME_STATUS_VIEW,
			(leaf) => new TracekeeperRuntimeStatusView(leaf, this)
		);
		this.registerView(
			TRACEKEEPER_PERMISSION_POLICY_VIEW,
			(leaf) => new TracekeeperPermissionPolicyView(leaf)
		);
		this.registerView(
			TRACEKEEPER_GRAPH_HEALTH_VIEW,
			(leaf) => new TracekeeperGraphHealthView(leaf, this)
		);
		await this.replaceLegacyAgentConnectionLeaves();

		this.addRibbonIcon('brain-circuit', ui(`打开${PLUGIN_DISPLAY_NAME_ZH}面板`, `Open ${PLUGIN_DISPLAY_NAME_EN} panel`), () => {
			void this.openPluginView(TRACEKEEPER_ACTIVITY_VIEW);
		});

		this.addCommand({
			id: 'open-agent-activity',
			name: ui('打开 AI 助手活动', 'Open AI assistant activity'),
			callback: () => {
				void this.openPluginView(TRACEKEEPER_ACTIVITY_VIEW);
			},
		});

		this.addCommand({
			id: 'open-review-queue',
			name: ui('打开审核队列', 'Open review queue'),
			callback: () => {
				void this.openPluginView(TRACEKEEPER_REVIEW_QUEUE_VIEW);
			},
		});

		this.addCommand({
			id: 'open-memory-inspector',
			name: ui('打开记忆查看', 'Open memory view'),
			callback: () => {
				void this.openPluginView(TRACEKEEPER_MEMORY_INSPECTOR_VIEW);
			},
		});

		this.addCommand({
			id: 'open-runtime-log',
			name: ui('打开运行日志', 'Open runtime log'),
			callback: () => {
				void this.openPluginView(TRACEKEEPER_RUNTIME_LOG_VIEW);
			},
		});

		this.addCommand({
			id: 'open-runtime-status',
			name: ui('打开连接状态', 'Open connection status'),
			callback: () => {
				void this.openPluginView(TRACEKEEPER_RUNTIME_STATUS_VIEW);
			},
		});

		this.addCommand({
			id: 'open-permission-policy',
			name: ui('打开权限说明', 'Open permission guide'),
			callback: () => {
				void this.openPluginView(TRACEKEEPER_PERMISSION_POLICY_VIEW);
			},
		});

		this.addCommand({
			id: 'open-graph-health',
			name: ui('打开知识图谱健康', 'Open graph health'),
			callback: () => {
				void this.openPluginView(TRACEKEEPER_GRAPH_HEALTH_VIEW);
			},
		});

		this.addCommand({
			id: 'refresh-views',
			name: ui('刷新视图', 'Refresh views'),
			callback: () => {
				void this.refreshGovernanceViews();
			},
		});

		this.addCommand({
			id: 'initialize-memory-structure',
			name: ui('校验知识库结构', 'Check knowledge structure'),
			callback: () => {
				void this.openInitializeMemoryStructureModal();
			},
		});

		this.addSettingTab(new TracekeeperSettingTab(this.app, this));
	}

	onunload(): void {
		void this.stopMcpRuntime();
	}

	private normalizeSettings(raw: unknown): TracekeeperSettings {
		const saved = raw && typeof raw === 'object' ? raw as Partial<TracekeeperSettings> & Record<string, unknown> : {};
		const next: TracekeeperSettings = { ...DEFAULT_SETTINGS };
		const legacyEndpoint = typeof saved.mcpHttpEndpoint === 'string' ? saved.mcpHttpEndpoint.trim() : '';
		if (legacyEndpoint && !LEGACY_DEFAULT_MCP_HTTP_ENDPOINTS.includes(legacyEndpoint)) {
			const legacyPort = this.portFromEndpoint(legacyEndpoint);
			if (legacyPort) {
				next.mcpPort = legacyPort;
			}
		}
		next.defaultAgentScope = typeof saved.defaultAgentScope === 'string' && saved.defaultAgentScope.trim()
			? saved.defaultAgentScope.trim()
			: DEFAULT_SETTINGS.defaultAgentScope;
		next.mcpRuntimeEnabled = typeof saved.mcpRuntimeEnabled === 'boolean'
			? saved.mcpRuntimeEnabled
			: DEFAULT_SETTINGS.mcpRuntimeEnabled;
		next.mcpPort = this.normalizePort(saved.mcpPort ?? next.mcpPort);
		const savedRuntimeToken = typeof saved.runtimeToken === 'string' ? saved.runtimeToken.trim() : '';
		next.runtimeToken = savedRuntimeToken || this.generateRuntimeToken();
		next.runtimeTokenCreatedAt = savedRuntimeToken
			? this.normalizeTimestamp(saved.runtimeTokenCreatedAt)
			: new Date().toISOString();
		next.graphProfile = normalizeGraphProfileValue(saved.graphProfile);
		const savedMemoryRulesVersion = typeof saved.memoryRulesVersion === 'number' ? saved.memoryRulesVersion : 0;
		next.memoryRulesVersion = MEMORY_RULES_VERSION;
		next.globalMemoryRule = normalizeMemoryProposalRule(saved.globalMemoryRule, DEFAULT_SETTINGS.globalMemoryRule);
		const savedProjectRule = normalizeMemoryProposalRule(saved.projectMemoryRule, DEFAULT_SETTINGS.projectMemoryRule);
		next.projectMemoryRule = savedMemoryRulesVersion < MEMORY_RULES_VERSION && savedProjectRule === 'review_queue'
			? DEFAULT_SETTINGS.projectMemoryRule
			: savedProjectRule;
		next.taskMemoryProposalMode = normalizeTaskMemoryProposalMode(saved.taskMemoryProposalMode);
		return next;
	}

	private normalizeTimestamp(value: unknown): string {
		const trimmed = typeof value === 'string' ? value.trim() : '';
		if (trimmed && Number.isFinite(Date.parse(trimmed))) {
			return trimmed;
		}
		return new Date().toISOString();
	}

	private normalizePort(value: unknown): number {
		const parsed = typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number.parseInt(value.trim(), 10)
				: Number.NaN;
		if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
			return DEFAULT_MCP_PORT;
		}
		return parsed;
	}

	private portFromEndpoint(endpoint: string): number | null {
		try {
			const parsed = new URL(endpoint);
			const port = Number.parseInt(parsed.port || String(DEFAULT_MCP_PORT), 10);
			return this.normalizePort(port);
		} catch {
			return null;
		}
	}

	private generateRuntimeToken(): string {
		return randomBytes(24).toString('hex');
	}

	formatRuntimeToken(value: string): string {
		const trimmed = value.trim();
		if (!trimmed) {
			return ui('未生成', 'Not generated');
		}
		if (trimmed.length <= 12) {
			return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
		}
		return `${trimmed.slice(0, 6)}••••${trimmed.slice(-6)}`;
	}

	async restartMcpRuntime(): Promise<void> {
		await this.stopMcpRuntime();
		if (this.settings.mcpRuntimeEnabled) {
			await this.startMcpRuntime();
		}
		await this.refreshGovernanceViews();
	}

	async setMcpRuntimeEnabled(enabled: boolean): Promise<void> {
		if (this.settings.mcpRuntimeEnabled === enabled) {
			return;
		}
		this.settings.mcpRuntimeEnabled = enabled;
		await this.saveSettings();
		if (enabled) {
			await this.startMcpRuntime();
			if (this.getRuntimeViewStatus().state === 'running') {
				new Notice(ui('MCP 服务已开启。', 'MCP service is on.'));
			}
		} else {
			await this.stopMcpRuntime();
			new Notice(ui('MCP 服务已关闭。', 'MCP service is off.'));
		}
		await this.refreshGovernanceViews();
	}

	async regenerateRuntimeToken(): Promise<void> {
		this.settings.runtimeToken = this.generateRuntimeToken();
		this.settings.runtimeTokenCreatedAt = new Date().toISOString();
		await this.saveSettings();
		new Notice(ui('本地连接令牌已重新生成，请更新已配置的 AI 工具。', 'Local connection token regenerated. Update configured AI tools.'));
		await this.restartMcpRuntime();
	}

	private async startMcpRuntime(): Promise<void> {
		this.uiMcpSessionId = '';
		if (!this.settings.mcpRuntimeEnabled) {
			this.runtimeStatus = this.createStoppedRuntimeStatus();
			return;
		}
		const vaultRoot = this.getVaultRoot();
		const runtimeOptions: StreamableHttpRuntimeOptionsWithGraphProfile = {
			host: DEFAULT_MCP_HOST,
			port: this.settings.mcpPort,
			path: DEFAULT_MCP_PATH,
			token: this.settings.runtimeToken,
			defaultVaultRoot: vaultRoot,
			vaultConfigDir: this.app.vault.configDir,
			graphProfile: this.settings.graphProfile,
			memoryRules: {
				globalMemoryRule: this.settings.globalMemoryRule,
				projectMemoryRule: this.settings.projectMemoryRule,
				taskMemoryProposalMode: this.settings.taskMemoryProposalMode,
			},
		};
		const runtime = new StreamableHttpMcpRuntime(runtimeOptions);
		this.mcpRuntime = runtime;
		try {
			this.runtimeStatus = await runtime.start();
		} catch (error) {
			this.runtimeStatus = runtime.getStatus();
			const message = error instanceof Error ? error.message : 'Unknown MCP Runtime error.';
			console.error('tracekeeper failed to start MCP Runtime', error);
			new Notice(ui(`MCP 服务启动失败：${message}`, `MCP service failed to start: ${message}`));
		}
	}

	private async stopMcpRuntime(): Promise<void> {
		this.uiMcpSessionId = '';
		const runtime = this.mcpRuntime;
		this.mcpRuntime = null;
		if (runtime) {
			await runtime.stop();
		}
		this.runtimeStatus = this.createStoppedRuntimeStatus();
	}

	private createStoppedRuntimeStatus(): StreamableHttpRuntimeStatus {
		return {
			state: 'stopped',
			host: DEFAULT_MCP_HOST,
			port: this.settings.mcpPort,
			path: DEFAULT_MCP_PATH,
			endpoint: this.getMcpHttpEndpoint(),
			startedAt: '',
			activeSessions: 0,
			lastError: '',
		};
	}

	async openInitializeMemoryStructureModal(): Promise<void> {
		const snapshot = await this.buildStructureOrganizerSnapshot();
		new InitializeMemoryStructureModal(this.app, {
			plugin: this,
			snapshot,
		}).open();
	}

	async buildStructureOrganizerSnapshot(migrationId = this.createStructureMigrationId()): Promise<StructureOrganizerSnapshot> {
		const basePlan = this.buildInitializationPlan();
		const legacyPlan = await this.buildLegacyStructurePlan(migrationId);
		const hasMissingBase = basePlan.foldersToCreate.length > 0 || basePlan.filesToCreate.length > 0;
		const state = legacyPlan.legacyRoots.length > 0
			? 'legacy_detected'
			: hasMissingBase
				? 'needs_repair'
				: 'ready';
		return { basePlan, legacyPlan, state };
	}

	private buildInitializationPlan(): MemoryInitializationPlan {
		const foldersToCreate = this.getNormalizedFolderPlan();
		const missingFolders = foldersToCreate.filter(
			(path) => this.app.vault.getAbstractFileByPath(path) === null
		);

		const missingAuditLog =
			this.app.vault.getAbstractFileByPath(CONTROL_PATHS.auditLog) === null;

		const filesToCreate: string[] = [];
		for (const controlFile of [...CONTROL_FILES, ...KNOWLEDGE_ENTRY_FILES]) {
			if (!this.app.vault.getAbstractFileByPath(controlFile.path)) {
				filesToCreate.push(controlFile.path);
			}
		}
		if (missingAuditLog && !filesToCreate.includes(CONTROL_PATHS.auditLog)) {
			filesToCreate.push(CONTROL_PATHS.auditLog);
		}

		return {
			foldersToCreate: missingFolders,
			filesToCreate,
			missingAuditLog,
		};
	}

	private getLegacyRootFolders(): string[] {
		return LEGACY_TOP_LEVEL_DIRS.filter((root) => this.app.vault.getAbstractFileByPath(root) instanceof TFolder);
	}

	private createStructureMigrationId(): string {
		return `legacy-rebuild-${new Date().toISOString().replace(/[:.]/g, '-')}`;
	}

	private createStructureCleanupId(): string {
		return `legacy-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
	}

	private async buildLegacyStructurePlan(migrationId: string): Promise<LegacyStructurePlan> {
		const legacyRoots = this.getLegacyRootFolders();
		const files = legacyRoots.flatMap((root) => {
			const folder = this.app.vault.getAbstractFileByPath(root);
			return folder instanceof TFolder ? this.collectFiles(folder) : [];
		});
		const items: LegacyStructurePlanItem[] = [];

		for (const file of files) {
			const target = getLegacyStructureTarget(file.path);
			const isMarkdown = file.extension === 'md';
			if (!target) {
				if (await this.legacyMigrationReviewExists(file.path, migrationId)) {
					items.push({
						oldPath: file.path,
						newPath: 'unmapped',
						kind: 'archive',
						action: 'review_existing',
						reason: ui('已存在迁移审核项。', 'A migration review item already exists.'),
						isMarkdown,
					});
					continue;
				}
				items.push({
					oldPath: file.path,
					newPath: '',
					kind: 'archive',
					action: 'unmapped',
					reason: ui('没有稳定的新结构映射。', 'No stable current-architecture mapping exists.'),
					isMarkdown: file.extension === 'md',
				});
				continue;
			}

			const targetFile = this.app.vault.getAbstractFileByPath(target.newPath);
			if (await this.legacyMigrationReviewExists(file.path, migrationId)) {
				items.push({
					oldPath: file.path,
					newPath: target.newPath,
					kind: target.kind,
					action: 'review_existing',
					reason: ui('已存在迁移审核项。', 'A migration review item already exists.'),
					isMarkdown,
				});
				continue;
			}

			if (targetFile && !(targetFile instanceof TFile)) {
				items.push({
					oldPath: file.path,
					newPath: target.newPath,
					kind: target.kind,
					action: 'review_conflict',
					reason: ui('新版目标路径已被文件夹占用。', 'The current-architecture target path is occupied by a folder.'),
					isMarkdown,
				});
				continue;
			}

			if (targetFile instanceof TFile) {
				const sameContent = await this.legacyTargetMatches(file, targetFile, {
					migrationId,
					oldPath: file.path,
					newPath: target.newPath,
					kind: target.kind,
				});
				items.push({
					oldPath: file.path,
					newPath: target.newPath,
					kind: target.kind,
					action: sameContent ? 'skip_existing' : 'review_conflict',
					reason: sameContent
						? ui('新版目标已存在。', 'The current-architecture target already exists.')
						: ui('新版目标已存在且内容不同。', 'The current-architecture target exists with different content.'),
					isMarkdown,
				});
				continue;
			}

			items.push({
				oldPath: file.path,
				newPath: target.newPath,
				kind: target.kind,
				action: 'copy_rebuild',
				reason: ui('可复制重建到新结构。', 'Can be copied into the current architecture.'),
				isMarkdown,
			});
		}

		return {
			migrationId,
			legacyRoots,
			items,
			fileCount: files.length,
			markdownCount: files.filter((file) => file.extension === 'md').length,
			nonMarkdownCount: files.filter((file) => file.extension !== 'md').length,
			copyCount: items.filter((item) => item.action === 'copy_rebuild').length,
			conflictCount: items.filter((item) => item.action === 'review_conflict').length,
			reviewCount: items.filter((item) => item.action === 'review_conflict' || item.action === 'review_existing').length,
			skipCount: items.filter((item) => item.action === 'skip_existing').length,
			uncoveredCount: items.filter((item) => item.action === 'unmapped').length,
		};
	}

	private collectFiles(folder: TFolder): TFile[] {
		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile) {
				files.push(child);
			} else if (child instanceof TFolder) {
				files.push(...this.collectFiles(child));
			}
		}
		return files.sort((a, b) => a.path.localeCompare(b.path));
	}

	private async legacyMigrationReviewExists(oldPath: string, migrationId: string): Promise<boolean> {
		const directPath = buildLegacyMigrationReviewPath(migrationId, oldPath);
		if (this.app.vault.getAbstractFileByPath(directPath) instanceof TFile) {
			return true;
		}
		const folder = this.app.vault.getAbstractFileByPath(TRACEKEEPER_REVIEW_QUEUE_DIR);
		if (!(folder instanceof TFolder)) {
			return false;
		}
		for (const file of this.collectFiles(folder).filter((item) => item.extension === 'md')) {
			const content = await this.app.vault.cachedRead(file);
			if (content.includes(`source_path: ${JSON.stringify(oldPath)}`)) {
				return true;
			}
		}
		return false;
	}

	private async legacyTargetMatches(
		source: TFile,
		target: TFile,
		input: {
			migrationId: string;
			oldPath: string;
			newPath: string;
			kind: LegacyStructureKind;
		}
	): Promise<boolean> {
		if (source.extension === 'md') {
			const sourceText = await this.app.vault.cachedRead(source);
			const targetText = await this.app.vault.cachedRead(target);
			const enriched = enrichLegacyMarkdownContent(sourceText, input);
			return targetText === sourceText || targetText === enriched || targetText.includes(`Migrated from: \`${source.path}\``);
		}
		const sourceBytes = new Uint8Array(await this.app.vault.readBinary(source));
		const targetBytes = new Uint8Array(await this.app.vault.readBinary(target));
		if (sourceBytes.length !== targetBytes.length) {
			return false;
		}
		return sourceBytes.every((value, index) => value === targetBytes[index]);
	}

	getStructureStatus(): TracekeeperStructureStatus {
		const plan = this.buildInitializationPlan();
		const totalFolders = this.getNormalizedFolderPlan().length;
		const expectedFiles = new Set([...CONTROL_FILES, ...KNOWLEDGE_ENTRY_FILES].map((file) => file.path));
		expectedFiles.add(CONTROL_PATHS.auditLog);
		const missingCount = plan.foldersToCreate.length + plan.filesToCreate.length;
		const totalCount = totalFolders + expectedFiles.size;
		const rootExists = this.app.vault.getAbstractFileByPath(CONTROL_PATHS.root) !== null;
		const legacyRoots = this.getLegacyRootFolders();
		const state: StructureState = missingCount === 0
			? legacyRoots.length > 0
				? 'legacy_detected'
				: 'initialized'
			: rootExists
				? 'partial'
				: 'missing';

		if (state === 'legacy_detected') {
			return {
				state,
				label: ui('需要整理', 'Needs cleanup'),
				detail: ui(
					`发现 ${legacyRoots.length} 个旧 Tracekeeper 目录。可在结构检查中预览并整理。`,
					`${legacyRoots.length} legacy Tracekeeper folder(s) were found. Review and clean them from structure check.`
				),
				missingFolders: [],
				missingFiles: [],
				missingCount,
				totalCount,
			};
		}

		if (state === 'initialized') {
			return {
				state,
				label: ui('基础结构完整', 'Base structure ready'),
				detail: ui(
					'Tracekeeper 基础入口完整；项目、来源和 Wiki 子目录会在使用时按需创建。',
					'Tracekeeper base entries are ready; project, source, and Wiki subfolders are created as needed.'
				),
				missingFolders: [],
				missingFiles: [],
				missingCount,
				totalCount,
			};
		}

		return {
			state,
			label: state === 'partial' ? ui('需要补齐', 'Needs repair') : ui('需要校验', 'Needs check'),
			detail: ui(
				`缺少 ${missingCount} 个基础结构项。可补齐必要入口，不会移动或删除已有内容。`,
				`${missingCount} base structure items are missing. Repair creates required entries only and will not move or delete existing content.`
			),
			missingFolders: plan.foldersToCreate,
			missingFiles: plan.filesToCreate,
			missingCount,
			totalCount,
		};
	}

	private getNormalizedFolderPlan(): string[] {
		const foldersToCreate: string[] = [];
		const seen = new Set<string>();

		for (const path of BASE_STRUCTURE_FOLDERS) {
			for (const folder of this.expandFolderHierarchy(path)) {
				if (!seen.has(folder)) {
					seen.add(folder);
					foldersToCreate.push(folder);
				}
			}
		}

		return foldersToCreate;
	}

	private expandFolderHierarchy(path: string): string[] {
		const normalized = this.normalizeVaultPath(path);
		if (!normalized) {
			return [];
		}

		const parts = normalized.split('/').filter(Boolean);
		const folders: string[] = [];
		let current = '';

		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			folders.push(current);
		}

		return folders;
	}

	private normalizeVaultPath(path: string): string {
		return path
			.trim()
			.replace(/\\+/g, '/')
			.replace(/\/+$/g, '');
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		const normalized = this.normalizeVaultPath(folderPath);
		if (!normalized) return;

		let current = '';
		for (const segment of normalized.split('/').filter(Boolean)) {
			current = current ? `${current}/${segment}` : segment;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (!existing) {
				await this.app.vault.createFolder(current);
				continue;
			}
			if (!(existing instanceof TFolder)) {
				throw new Error(`Cannot create folder: ${current} already exists as a file.`);
			}
		}
	}

	private async ensureFileDoesNotExist(path: string, content: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(this.normalizeVaultPath(path));
		if (existing) {
			if (!(existing instanceof TFile)) {
				throw new Error(`Cannot create file: ${path} already exists as a folder.`);
			}
			return;
		}
		await this.app.vault.create(this.normalizeVaultPath(path), content);
	}

	private buildAuditLogPath(): string {
		return this.normalizeVaultPath(CONTROL_PATHS.auditLog);
	}

	async initializeMemoryStructure(plan: MemoryInitializationPlan): Promise<void> {
		try {
			for (const folder of plan.foldersToCreate) {
				await this.ensureFolderExists(folder);
			}

			for (const controlFile of [...CONTROL_FILES, ...KNOWLEDGE_ENTRY_FILES].filter((file) =>
				plan.filesToCreate.includes(file.path)
			)) {
				await this.ensureFileDoesNotExist(controlFile.path, controlFile.content);
			}

			if (plan.missingAuditLog) {
				await this.ensureFileDoesNotExist(
					CONTROL_PATHS.auditLog,
					this.buildAuditLogHeader()
				);
			}

			await this.appendAuditEvent(plan);
			new Notice(ui('知识库基础结构已补齐。', 'Tracekeeper base structure repaired.'));
			await this.refreshGovernanceViews();
		} catch (error) {
			console.error('tracekeeper failed to initialize memory structure', error);
			new Notice(ui('知识库基础结构补齐失败。', 'Tracekeeper failed to repair the base structure.'));
		}
	}

	async migrateLegacyStructure(snapshot: StructureOrganizerSnapshot): Promise<LegacyMigrationResult> {
		if (snapshot.basePlan.foldersToCreate.length > 0 || snapshot.basePlan.filesToCreate.length > 0) {
			await this.initializeMemoryStructure(snapshot.basePlan);
		}

		const plan = snapshot.legacyPlan;
		let copiedCount = 0;
		let reviewCount = 0;

		for (const item of plan.items) {
			if (item.action === 'copy_rebuild') {
				await this.copyLegacyStructureItem(item, plan.migrationId);
				copiedCount += 1;
			} else if (item.action === 'review_conflict' || item.action === 'unmapped') {
				await this.writeLegacyMigrationReview(item, plan.migrationId);
				reviewCount += 1;
			}
		}

		const result = await this.writeLegacyMigrationReports(plan, {
			migrationId: plan.migrationId,
			copiedCount,
			conflictCount: plan.conflictCount,
			reviewCount,
			reportMdPath: '',
			reportJsonPath: '',
		});
		await this.appendToAuditLog(this.renderLegacyMigrationAuditEvent(result));
		await this.refreshGovernanceViews();
		new Notice(ui('旧目录内容已复制重建，旧目录尚未清理。', 'Legacy content rebuilt. Legacy folders are not cleaned yet.'));
		return result;
	}

	async cleanupLegacyStructure(migrationId: string): Promise<LegacyCleanupResult> {
		const plan = await this.buildLegacyStructurePlan(migrationId);
		const blocking = plan.items.filter((item) =>
			item.action === 'copy_rebuild' || item.action === 'review_conflict' || item.action === 'unmapped'
		);
		if (blocking.length > 0) {
			throw new Error(`Cannot clean legacy folders: ${blocking.length} file(s) are not covered by migration targets or review items.`);
		}

		const cleanupId = this.createStructureCleanupId();
		const trashedRoots: string[] = [];
		const missingRoots: string[] = [];
		const failedRoots: Array<{ path: string; error: string }> = [];

		for (const root of LEGACY_TOP_LEVEL_DIRS) {
			const folder = this.app.vault.getAbstractFileByPath(root);
			if (!folder) {
				missingRoots.push(root);
				continue;
			}
			try {
				await this.app.vault.trash(folder, true);
				trashedRoots.push(root);
			} catch (error) {
				failedRoots.push({
					path: root,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		const reportPath = await this.writeLegacyCleanupReport({
			cleanupId,
			trashedRoots,
			missingRoots,
			failedRoots,
			reportPath: '',
			taskPath: '',
		});
		const taskPath = await this.writeLegacyCleanupTask(cleanupId, migrationId, reportPath, trashedRoots, failedRoots);
		const result: LegacyCleanupResult = {
			cleanupId,
			trashedRoots,
			missingRoots,
			failedRoots,
			reportPath,
			taskPath,
		};
		await this.appendToAuditLog(this.renderLegacyCleanupAuditEvent(result));
		await this.refreshGovernanceViews();
		if (failedRoots.length > 0) {
			new Notice(ui('旧目录清理部分失败，请查看清理报告。', 'Legacy cleanup partially failed. Review the cleanup report.'));
		} else {
			new Notice(ui('旧目录已移入系统回收站。', 'Legacy folders moved to system trash.'));
		}
		return result;
	}

	private async copyLegacyStructureItem(item: LegacyStructurePlanItem, migrationId: string): Promise<void> {
		if (!item.newPath) {
			return;
		}
		const source = this.app.vault.getAbstractFileByPath(item.oldPath);
		if (!(source instanceof TFile)) {
			throw new Error(`Legacy source is not a file: ${item.oldPath}`);
		}
		await this.ensureFolderExists(vaultParentFolder(item.newPath));
		if (item.isMarkdown) {
			const content = await this.app.vault.cachedRead(source);
			const next = enrichLegacyMarkdownContent(content, {
				migrationId,
				oldPath: item.oldPath,
				newPath: item.newPath,
				kind: item.kind,
			});
			await this.ensureFileDoesNotExist(item.newPath, next);
			return;
		}
		const bytes = await this.app.vault.readBinary(source);
		await this.app.vault.createBinary(this.normalizeVaultPath(item.newPath), bytes);
	}

	private async writeLegacyMigrationReview(item: LegacyStructurePlanItem, migrationId: string): Promise<void> {
		const reviewPath = buildLegacyMigrationReviewPath(migrationId, item.oldPath);
		if (this.app.vault.getAbstractFileByPath(reviewPath)) {
			return;
		}
		await this.ensureFolderExists(vaultParentFolder(reviewPath));
		const sourceContent = await this.readLegacyEvidenceText(item.oldPath);
		const content = renderLegacyMigrationReview({
			migrationId,
			oldPath: item.oldPath,
			newPath: item.newPath || 'unmapped',
			kind: item.kind,
			reason: item.reason,
			sourceContent,
		});
		await this.ensureFileDoesNotExist(reviewPath, content);
	}

	private async readLegacyEvidenceText(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return '';
		}
		try {
			return await this.app.vault.cachedRead(file);
		} catch {
			return `[binary file: ${path}]`;
		}
	}

	private async writeLegacyMigrationReports(
		plan: LegacyStructurePlan,
		result: LegacyMigrationResult
	): Promise<LegacyMigrationResult> {
		const reportDir = '00_tracekeeper/control/migrations';
		await this.ensureFolderExists(reportDir);
		const reportMdPath = `${reportDir}/${plan.migrationId}.md`;
		const reportJsonPath = `${reportDir}/${plan.migrationId}.json`;
		const summary = {
			migration_id: plan.migrationId,
			legacy_roots: plan.legacyRoots,
			copied_count: result.copiedCount,
			conflict_count: plan.conflictCount,
			review_count: result.reviewCount,
			trashed_roots: [],
			report_paths: {
				migration_markdown: reportMdPath,
				migration_json: reportJsonPath,
			},
			old_directories_untouched: true,
			old_directories_cleaned: false,
		};
		const json = JSON.stringify({
			summary,
			items: plan.items,
		}, null, 2);
		const conflictLines = plan.items
			.filter((item) => item.action === 'review_conflict')
			.map((item) => `- \`${item.oldPath}\` -> \`${item.newPath}\`: ${item.reason}`);
		const md = [
			'# Legacy structure migration report',
			'',
			`- Migration id: \`${plan.migrationId}\``,
			`- Legacy roots: ${plan.legacyRoots.length}`,
			`- Files scanned: ${plan.fileCount}`,
			`- Copied: ${result.copiedCount}`,
			`- Conflicts queued: ${result.reviewCount}`,
			`- Uncovered: ${plan.uncoveredCount}`,
			'- Old directories untouched: yes',
			'',
			'## Legacy roots',
			'',
			...(plan.legacyRoots.length > 0 ? plan.legacyRoots.map((root) => `- \`${root}\``) : ['None']),
			'',
			'## Conflicts',
			'',
			...(conflictLines.length > 0 ? conflictLines : ['None']),
			'',
		].join('\n');
		await this.ensureFileDoesNotExist(reportMdPath, md);
		await this.ensureFileDoesNotExist(reportJsonPath, json);
		return {
			...result,
			reportMdPath,
			reportJsonPath,
		};
	}

	private async writeLegacyCleanupReport(input: LegacyCleanupResult): Promise<string> {
		const reportDir = '00_tracekeeper/control/migrations';
		await this.ensureFolderExists(reportDir);
		const reportPath = `${reportDir}/${input.cleanupId}.md`;
		const content = [
			'# Legacy directory cleanup report',
			'',
			`- Cleanup id: \`${input.cleanupId}\``,
			'- Method: Obsidian system trash',
			`- Trashed legacy directories: ${input.trashedRoots.length}`,
			`- Missing legacy directories: ${input.missingRoots.length}`,
			`- Failed: ${input.failedRoots.length}`,
			'- Old directories cleaned: yes',
			'',
			'## Trashed',
			'',
			...(input.trashedRoots.length > 0 ? input.trashedRoots.map((root) => `- \`${root}\``) : ['None']),
			'',
			'## Failed',
			'',
			...(input.failedRoots.length > 0 ? input.failedRoots.map((item) => `- \`${item.path}\`: ${item.error}`) : ['None']),
			'',
		].join('\n');
		await this.ensureFileDoesNotExist(reportPath, content);
		return reportPath;
	}

	private async writeLegacyCleanupTask(
		cleanupId: string,
		migrationId: string,
		cleanupReportPath: string,
		trashedRoots: string[],
		failedRoots: Array<{ path: string; error: string }>
	): Promise<string> {
		const now = new Date().toISOString();
		const taskId = `obs_task_${cleanupId.replace(/^legacy-cleanup-/, '').replace(/[^0-9A-Za-z]+/g, '_')}`;
		const taskPath = `${TRACEKEEPER_TASKS_DIR}/${taskId}.md`;
		await this.ensureFolderExists(TRACEKEEPER_TASKS_DIR);
		const content = [
			'---',
			'agent: "tracekeeper"',
			'client: "obsidian"',
			'objective: "整理旧 Tracekeeper 目录结构到统一知识体系"',
			'related_project: "tracekeeper_legacy_structure_migration"',
			`session_id: "${migrationId}"`,
			`started_at: "${now}"`,
			`finished_at: "${now}"`,
			failedRoots.length > 0 ? 'status: "warning"' : 'status: "completed"',
			`task_id: "${taskId}"`,
			'title: "旧目录迁移与结构清理"',
			'tool: "tracekeeper.structure_organizer"',
			'type: "agent-task"',
			'memory_writes:',
			`  - "${cleanupReportPath}"`,
			`  - "00_tracekeeper/control/migrations/${migrationId}.md"`,
			'---',
			'',
			'# 旧目录迁移与结构清理',
			'',
			'## Summary',
			'',
			`- 旧目录清理：${trashedRoots.length} 个目录已移入系统回收站。`,
			`- 清理失败：${failedRoots.length} 个。`,
			`- 迁移报告：[[00_tracekeeper/control/migrations/${migrationId}|${migrationId}]]`,
			`- 清理报告：[[${cleanupReportPath.replace(/\.md$/i, '')}|${cleanupId}]]`,
			'',
			'## Graph links',
			'',
			`- [[${KNOWLEDGE_INDEX_PATH.replace(/\.md$/i, '')}|Knowledge index]]`,
			`- [[${KNOWLEDGE_MEMORY_INDEX_PATH.replace(/\.md$/i, '')}|Memory index]]`,
			`- [[${KNOWLEDGE_WIKI_HUBS_INDEX_PATH.replace(/\.md$/i, '')}|Wiki hubs]]`,
			'',
		].join('\n');
		await this.ensureFileDoesNotExist(taskPath, content);
		return taskPath;
	}

	private renderLegacyMigrationAuditEvent(result: LegacyMigrationResult): string {
		const now = new Date().toISOString();
		return (
			`## ${now}\n` +
			`action: legacy_structure.migrate\n` +
			`actor: user\n` +
			`result: success\n` +
			`migration_id: ${result.migrationId}\n` +
			`copied_count: ${result.copiedCount}\n` +
			`review_count: ${result.reviewCount}\n` +
			`target: ${result.reportMdPath}\n` +
			`timestamp: ${now}\n\n`
		);
	}

	private renderLegacyCleanupAuditEvent(result: LegacyCleanupResult): string {
		const now = new Date().toISOString();
		return (
			`## ${now}\n` +
			`action: legacy_structure.cleanup\n` +
			`actor: user\n` +
			`result: ${result.failedRoots.length > 0 ? 'partial' : 'success'}\n` +
			`cleanup_id: ${result.cleanupId}\n` +
			`trashed_roots: ${result.trashedRoots.length}\n` +
			`failed_roots: ${result.failedRoots.length}\n` +
			`task_id: ${result.taskPath.replace(`${TRACEKEEPER_TASKS_DIR}/`, '').replace(/\.md$/i, '')}\n` +
			`target: ${result.reportPath}\n` +
			`timestamp: ${now}\n\n`
		);
	}

	private buildAuditLogHeader(): string {
		return '# Audit Log\n\n';
	}

	private async appendAuditEvent(plan: MemoryInitializationPlan): Promise<void> {
		const now = new Date().toISOString();
		const event = this.renderAuditEvent(now, plan.foldersToCreate.length, plan.filesToCreate.length);
		await this.appendToAuditLog(event);
	}

	private renderAuditEvent(timestamp: string, folderCount: number, fileCount: number): string {
		return `## ${timestamp}\naction: structure.repair\nactor: user\nfolders_created: ${folderCount}\nfiles_created: ${fileCount}\nresult: success\n\n`;
	}

	private async appendProposalStatusAuditEvent(
		proposal: MemoryProposalRecord,
		nextStatus: MemoryProposalStatus
	): Promise<void> {
		const now = new Date().toISOString();
		const event = this.renderProposalStatusAuditEvent(
			now,
			proposal.path,
			proposal.proposalId,
			nextStatus,
			proposal.taskId
		);
		await this.appendToAuditLog(event);
	}

	private renderProposalStatusAuditEvent(
		timestamp: string,
		target: string,
		proposalId: string,
		nextStatus: MemoryProposalStatus,
		taskId?: string
	): string {
		return (
			`## ${timestamp}\n` +
			`action: memory.proposal.${nextStatus}\n` +
			`actor: user\n` +
			`target: ${target}\n` +
			`reason: proposal ${proposalId} marked ${nextStatus}\n` +
			`task_id: ${taskId || ''}\n` +
			`timestamp: ${timestamp}\n\n`
		);
	}

	private async appendToAuditLog(rawEvent: string): Promise<void> {
		const auditPath = this.buildAuditLogPath();
		const auditFile = this.app.vault.getAbstractFileByPath(auditPath);
		if (!auditFile) {
			await this.ensureFileDoesNotExist(auditPath, this.buildAuditLogHeader());
		}

		const finalAuditFile = this.app.vault.getAbstractFileByPath(auditPath);
		if (!(finalAuditFile instanceof TFile)) {
			throw new Error(`Cannot append audit log: ${auditPath} is not a file.`);
		}

		await this.app.vault.process(finalAuditFile, (current) => {
			const normalizedCurrent = current.endsWith('\n') ? current : `${current}\n`;
			const separator = normalizedCurrent.length > 0 ? '\n' : '';
			return `${normalizedCurrent}${separator}${rawEvent}`;
		});
	}

	private async refreshActivityViews(): Promise<void> {
		const activityLeaves = this.app.workspace.getLeavesOfType(TRACEKEEPER_ACTIVITY_VIEW);
		for (const leaf of activityLeaves) {
			const view = leaf.view;
			if (view instanceof TracekeeperActivityView) {
				await view.refresh();
			}
		}
	}

	private async refreshReviewQueueViews(): Promise<void> {
		const reviewQueueLeaves = this.app.workspace.getLeavesOfType(TRACEKEEPER_REVIEW_QUEUE_VIEW);
		for (const leaf of reviewQueueLeaves) {
			const view = leaf.view;
			if (view instanceof TracekeeperReviewQueueView) {
				await view.refresh();
			}
		}
	}

	private async refreshSourceStatusViews(): Promise<void> {
		const sourceStatusLeaves = this.app.workspace.getLeavesOfType(TRACEKEEPER_SOURCE_STATUS_VIEW);
		for (const leaf of sourceStatusLeaves) {
			const view = leaf.view;
			if (view instanceof TracekeeperSourceStatusView) {
				await view.refresh();
			}
		}
	}

	private async refreshGraphHealthViews(): Promise<void> {
		const graphHealthLeaves = this.app.workspace.getLeavesOfType(TRACEKEEPER_GRAPH_HEALTH_VIEW);
		for (const leaf of graphHealthLeaves) {
			const view = leaf.view;
			if (view instanceof TracekeeperGraphHealthView) {
				await view.refresh();
			}
		}
	}

	private async refreshRuntimeLogViews(): Promise<void> {
		const logLeaves = this.app.workspace.getLeavesOfType(TRACEKEEPER_RUNTIME_LOG_VIEW);
		for (const leaf of logLeaves) {
			const view = leaf.view;
			if (view instanceof TracekeeperRuntimeLogView) {
				await view.refresh();
			}
		}
	}

	private async replaceLegacyAgentConnectionLeaves(): Promise<void> {
		const legacyLeaves = this.app.workspace.getLeavesOfType(LEGACY_AGENT_CONNECTIONS_VIEW);
		for (const leaf of legacyLeaves) {
			await leaf.setViewState({
				type: TRACEKEEPER_RUNTIME_LOG_VIEW,
				state: {},
				active: false,
			});
		}
	}

	private quoteYamlString(value: string): string {
		const trimmed = (value || '').trim().replace(/\r/g, '');
		if (!trimmed) {
			return '""';
		}
		const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		return `"${escaped}"`;
	}

	async refreshGovernanceViews(): Promise<void> {
		await this.refreshActivityViews();
		await this.refreshReviewQueueViews();
		await this.refreshSourceStatusViews();
		await this.refreshRuntimeLogViews();
		await this.refreshGraphHealthViews();
	}

	async loadSourceStatusSnapshot(): Promise<SourceAnalysisSnapshot> {
		const folder = this.app.vault.getAbstractFileByPath(SOURCE_REQUESTS_PATH);
		if (!(folder instanceof TFolder)) {
			return {
				requests: [],
				missingRequestFolder: true,
				updatedAt: new Date().toISOString(),
			};
		}

		return {
			requests: await this.readRecentSourceRequests(MAX_SOURCE_STATUS_ROWS),
			missingRequestFolder: false,
			updatedAt: new Date().toISOString(),
		};
	}

	private async readRecentSourceRequests(limit: number): Promise<SourceRequestRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(SOURCE_REQUESTS_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectMarkdownFiles(folder);
		const records = await Promise.all(files.map((file) => this.readSourceRequestFile(file)));
		return records
			.filter((record): record is SourceRequestRecord => Boolean(record))
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, limit);
	}

	private async readSourceRequestFile(file: TFile): Promise<SourceRequestRecord | null> {
		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`tracekeeper failed to read source request: ${file.path}`, error);
			content = '';
		}

		const parsed = this.readFrontmatter(content);
		const data = parsed.fields;
		const type = this.firstString(data, ['type']);
		if (!type.toLowerCase().includes('agent-request')) {
			return null;
		}

		const source = this.firstString(data, ['source']);
		const status = this.firstString(data, ['status']);
		if (!source) {
			return null;
		}

		const created = this.firstString(data, ['created']);
		const sortTimestamp = this.parseTimestamp(created, file.stat?.mtime);

		return {
			path: file.path,
			type,
			source,
			sourceKind: this.firstString(data, ['source_kind', 'sourceKind']) || 'unknown',
			purpose: this.firstString(data, ['purpose']) || '',
			relatedProject: this.firstString(data, ['related_project', 'relatedProject']) || '',
			analysisMode: this.firstString(data, ['analysis_mode', 'analysisMode']) || 'default',
			status: status || 'pending',
			taskId: this.firstString(data, ['task_id', 'taskId']),
			created,
			summary: this.snippetFromText(parsed.body, source),
			sortTimestamp,
		};
	}

	async loadAgentActivitySnapshot(): Promise<AgentActivitySnapshot> {
		const [
			recentTasks,
			recentContextPacks,
			recentSourceCaptures,
			recentSourceRequests,
			recentProposals,
			recentAuditEvents,
		] = await Promise.all([
			this.readRecentAgentTasks(MAX_TASK_ROWS),
			this.readRecentContextPacks(MAX_ACTIVITY_CONTEXT_PACK_ROWS),
			this.readRecentSourceCaptures(MAX_ACTIVITY_SOURCE_CAPTURE_ROWS),
			this.readRecentSourceRequests(MAX_SOURCE_STATUS_ROWS),
			this.readRecentMemoryProposals(MAX_ACTIVITY_PROPOSAL_ROWS),
			this.readRecentAuditEvents(MAX_AUDIT_ROWS),
		]);
		const latestTask = recentTasks[0] ?? null;
		const structureStatus = this.getStructureStatus();
		const taskFolderMissing =
			this.app.vault.getAbstractFileByPath(AGENT_TASKS_PATH) === null;
		const auditLogMissing =
			this.app.vault.getAbstractFileByPath(CONTROL_PATHS.auditLog) === null;
		const auditDirMissing =
			this.app.vault.getAbstractFileByPath(CONTROL_PATHS.auditDir) === null;
		const recentToolCallRecords = recentAuditEvents
			.filter((event) => this.isToolCallAuditEvent(event))
			.map((event) => this.toAgentToolCallRecord(event));
		const recentAgentCount = this.buildRecentAgentConnections(
			recentAuditEvents,
			recentToolCallRecords
		).length;
		const timelineItems = this.buildActivityTimelineItems({
			tasks: recentTasks,
			contextPacks: recentContextPacks,
			sourceCaptures: recentSourceCaptures,
			sourceRequests: recentSourceRequests,
			proposals: recentProposals,
			auditEvents: recentAuditEvents,
		}).slice(0, ACTIVITY_TIMELINE_PREVIEW_ROWS);

		return {
			runtimeStatus: this.getRuntimeViewStatus(),
			structureStatus,
			vaultRoot: this.getVaultRoot(),
			latestTask,
			recentTasks,
			recentContextPacks,
			recentSourceCaptures,
			recentSourceRequests,
			recentProposals,
			recentAuditEvents,
			timelineItems,
			recentAgentCount,
			recentToolCallCount: recentToolCallRecords.length,
			missingTaskFolder: taskFolderMissing,
			missingAuditSources: auditLogMissing && auditDirMissing,
			updatedAt: new Date().toISOString(),
		};
	}

	async loadActivityTimelineSnapshot(
		page: number,
		pageSize = ACTIVITY_TIMELINE_PAGE_SIZE
	): Promise<ActivityTimelineSnapshot> {
		const safePageSize = Math.max(1, Math.floor(pageSize));
		const [
			tasks,
			contextPacks,
			sourceCaptures,
			sourceRequests,
			proposals,
			auditEvents,
		] = await Promise.all([
			this.readRecentAgentTasks(Number.MAX_SAFE_INTEGER),
			this.readRecentContextPacks(Number.MAX_SAFE_INTEGER),
			this.readRecentSourceCaptures(Number.MAX_SAFE_INTEGER),
			this.readRecentSourceRequests(Number.MAX_SAFE_INTEGER),
			this.readRecentMemoryProposals(Number.MAX_SAFE_INTEGER),
			this.readRecentAuditEvents(Number.MAX_SAFE_INTEGER),
		]);
		const timelineItems = this.buildActivityTimelineItems({
			tasks,
			contextPacks,
			sourceCaptures,
			sourceRequests,
			proposals,
			auditEvents,
		});
		const totalItems = timelineItems.length;
		const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
		const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
		const start = (safePage - 1) * safePageSize;

		return {
			items: timelineItems.slice(start, start + safePageSize),
			page: safePage,
			pageSize: safePageSize,
			totalItems,
			totalPages,
			updatedAt: new Date().toISOString(),
		};
	}

	async loadRuntimeLogSnapshot(
		page: number,
		filter: RuntimeLogFilter = 'all',
		pageSize = RUNTIME_LOG_PAGE_SIZE
	): Promise<RuntimeLogSnapshot> {
		const safePageSize = Math.max(1, Math.floor(pageSize));
		const safeFilter = RUNTIME_LOG_FILTERS.includes(filter) ? filter : 'all';
		const auditEvents = await this.readRecentAuditEvents(Number.MAX_SAFE_INTEGER);
		const allItems = auditEvents.map((event) => this.toRuntimeLogItem(event));
		const counts = this.countRuntimeLogItems(allItems);
		const visibleItems = allItems.filter((item) => this.matchesRuntimeLogFilter(item, safeFilter));
		const totalItems = visibleItems.length;
		const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
		const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
		const start = (safePage - 1) * safePageSize;

		return {
			items: visibleItems.slice(start, start + safePageSize),
			filter: safeFilter,
			counts,
			page: safePage,
			pageSize: safePageSize,
			totalItems,
			totalPages,
			updatedAt: new Date().toISOString(),
		};
	}

	async cleanRuntimeLogs(scope: RuntimeLogCleanupScope): Promise<RuntimeLogCleanupResult> {
		const cutoff = this.runtimeLogCleanupCutoff(scope);
		const removedSections = await this.cleanAuditLogSections(cutoff);
		const removedFiles = await this.cleanAuditFolderFiles(cutoff);
		await this.refreshGovernanceViews();
		return { removedSections, removedFiles };
	}

	private runtimeLogCleanupCutoff(scope: RuntimeLogCleanupScope): number | null {
		const now = Date.now();
		const dayMs = 24 * 60 * 60 * 1000;
		switch (scope) {
			case 'older-than-week':
				return now - 7 * dayMs;
			case 'older-than-month':
				return now - 30 * dayMs;
			case 'older-than-three-months':
				return now - 90 * dayMs;
			case 'all':
			default:
				return null;
		}
	}

	private async cleanAuditLogSections(cutoff: number | null): Promise<number> {
		const file = this.app.vault.getAbstractFileByPath(CONTROL_PATHS.auditLog);
		if (!(file instanceof TFile)) {
			return 0;
		}

		let removed = 0;
		await this.app.vault.process(file, (current) => {
			const parsed = this.splitAuditLogContent(current);
			const keptSections = parsed.sections.filter((section) => {
				const shouldRemove = cutoff === null || section.sortTimestamp < cutoff;
				if (shouldRemove) {
					removed += 1;
				}
				return !shouldRemove;
			});
			return this.renderAuditLogContent(parsed.header, keptSections.map((section) => section.content));
		});
		return removed;
	}

	private splitAuditLogContent(content: string): { header: string; sections: Array<{ content: string; sortTimestamp: number }> } {
		const normalized = content.replace(/\r\n/g, '\n');
		const lines = normalized.split('\n');
		const firstSectionIndex = lines.findIndex((line) => line.trim().startsWith('## '));
		const headerLines = firstSectionIndex >= 0 ? lines.slice(0, firstSectionIndex) : lines;
		const sections: Array<{ content: string; sortTimestamp: number }> = [];
		let cursor = firstSectionIndex >= 0 ? firstSectionIndex : lines.length;

		while (cursor < lines.length) {
			const start = cursor;
			const header = lines[cursor].trim();
			cursor += 1;
			const bodyLines: string[] = [];
			while (cursor < lines.length && !lines[cursor].trim().startsWith('## ')) {
				bodyLines.push(lines[cursor]);
				cursor += 1;
			}
			const timestampHeader = header.replace(/^##\s+/, '').trim();
			const row = this.readKeyValueRows(bodyLines);
			const timestamp = this.firstString(row, ['timestamp']) || timestampHeader;
			sections.push({
				content: lines.slice(start, cursor).join('\n').replace(/\s+$/g, ''),
				sortTimestamp: this.parseTimestamp(timestamp, 0),
			});
		}

		return {
			header: headerLines.join('\n').trim(),
			sections,
		};
	}

	private renderAuditLogContent(header: string, sections: string[]): string {
		const normalizedHeader = header.trim() || this.buildAuditLogHeader().trim();
		if (sections.length === 0) {
			return `${normalizedHeader}\n\n`;
		}
		return `${normalizedHeader}\n\n${sections.join('\n\n')}\n\n`;
	}

	private async cleanAuditFolderFiles(cutoff: number | null): Promise<number> {
		const folder = this.app.vault.getAbstractFileByPath(CONTROL_PATHS.auditDir);
		if (!(folder instanceof TFolder)) {
			return 0;
		}

		let removed = 0;
		for (const file of this.collectMarkdownFiles(folder)) {
			const events = await this.readAuditMarkdownFile(file);
			const timestamps = events
				.map((event) => event.sortTimestamp)
				.filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
			const latestTimestamp = timestamps.length > 0
				? Math.max(...timestamps)
				: file.stat?.mtime || 0;
			const shouldRemove = cutoff === null || latestTimestamp < cutoff;
			if (!shouldRemove) {
				continue;
			}
			await this.app.vault.delete(file);
			removed += 1;
		}
		return removed;
	}

	private countRuntimeLogItems(items: RuntimeLogItem[]): Record<RuntimeLogFilter, number> {
		const counts: Record<RuntimeLogFilter, number> = {
			all: 0,
			connection: 0,
			tool: 0,
			config: 0,
			error: 0,
		};
		for (const item of items) {
			counts.all += 1;
			if (item.category === 'connection' || item.category === 'tool' || item.category === 'config') {
				counts[item.category] += 1;
			}
			if (this.isRuntimeLogError(item)) {
				counts.error += 1;
			}
		}
		return counts;
	}

	private matchesRuntimeLogFilter(item: RuntimeLogItem, filter: RuntimeLogFilter): boolean {
		if (filter === 'all') {
			return true;
		}
		if (filter === 'error') {
			return this.isRuntimeLogError(item);
		}
		return item.category === filter;
	}

	private isRuntimeLogError(item: RuntimeLogItem): boolean {
		const normalized = item.status.toLowerCase().trim();
		return normalized === 'failed' || normalized === 'error' || normalized.includes('failed');
	}

	private toRuntimeLogItem(event: AuditEventRecord): RuntimeLogItem {
		const category = this.runtimeLogCategory(event);
		const status = event.resultStatus || (category === 'connection' ? 'connected' : '');
		const metaParts = [
			this.formatAgentDisplayName(event.clientName, event.agentId),
			status ? this.formatResultLabel(status) : '',
			event.riskLevel ? this.formatRiskLabel(event.riskLevel) : '',
		].filter(Boolean);
		const body = event.reason
			|| event.argsSummary
			|| event.targetPaths.join(', ')
			|| event.target
			|| event.snippet;

		return {
			time: event.sortTimestamp,
			category,
			title: this.runtimeLogTitle(event, category),
			meta: metaParts.join(' • '),
			body,
			path: event.target || event.path,
			status,
		};
	}

	private runtimeLogCategory(event: AuditEventRecord): RuntimeLogCategory {
		if (this.isConnectionAuditEvent(event)) {
			return 'connection';
		}
		if (event.action.startsWith('client_config_')) {
			return 'config';
		}
		if (this.isToolCallAuditEvent(event)) {
			return 'tool';
		}
		return 'record';
	}

	private runtimeLogTitle(event: AuditEventRecord, category: RuntimeLogCategory): string {
		if (category === 'connection') {
			return ui('建立连接', 'Connected');
		}
		if (category === 'tool') {
			return this.formatToolDisplayName(event.toolName || event.action);
		}
		if (category === 'config') {
			switch (event.action) {
				case 'client_config_applied':
					return ui('写入连接配置', 'Connection config written');
				case 'client_config_removed':
					return ui('移除连接配置', 'Connection config removed');
				case 'client_config_failed':
					return ui('连接配置失败', 'Connection config failed');
				default:
					return ui('连接配置变更', 'Connection config change');
			}
		}
		if (event.action === 'structure.repair') {
			return ui('补齐基础结构', 'Repair base structure');
		}
		if (event.action === 'legacy_structure.migrate') {
			return ui('复制重建旧目录', 'Rebuild legacy structure');
		}
		if (event.action === 'legacy_structure.cleanup') {
			return ui('清理旧目录', 'Clean legacy folders');
		}
		return event.action || ui('运行记录', 'Runtime record');
	}

	private buildActivityTimelineItems(input: {
		tasks: AgentTaskRecord[];
		contextPacks: ContextPackRecord[];
		sourceCaptures: SourceCaptureRecord[];
		sourceRequests: SourceRequestRecord[];
		proposals: MemoryProposalRecord[];
		auditEvents: AuditEventRecord[];
	}): ActivityTimelineItem[] {
		return [
			...input.tasks.map((task) => ({
				time: task.sortTimestamp,
				type: ui('任务', 'Task'),
				title: task.taskId,
				meta: `${task.agent} • ${task.status}`,
				body: task.objective || task.snippet,
				path: task.path,
			})),
			...input.contextPacks.map((contextPack) => ({
				time: contextPack.sortTimestamp,
				type: 'context',
				title: contextPack.title,
				meta: contextPack.taskId,
				body: contextPack.snippet,
				path: contextPack.path,
			})),
			...input.sourceCaptures.map((source) => ({
				time: source.sortTimestamp,
				type: ui('来源', 'Source'),
				title: source.title || source.source || ui('来源记录', 'Source capture'),
				meta: [source.sourceKind, source.mode || source.type].filter(Boolean).join(' • '),
				body: source.source || source.snippet,
				path: source.path,
			})),
			...input.sourceRequests.map((request) => ({
				time: request.sortTimestamp,
				type: ui('来源请求', 'Source request'),
				title: request.sourceKind,
				meta: request.status,
				body: request.source || request.summary,
				path: request.path,
			})),
			...input.proposals.map((proposal) => ({
				time: proposal.sortTimestamp,
				type: ui('提案', 'Proposal'),
				title: proposal.proposalId,
				meta: `${memoryProposalStatusLabel(proposal.approvalStatus)} • ${proposal.proposalKind}`,
				body: proposal.snippet,
				path: proposal.path,
			})),
			...input.auditEvents.map((event) => this.toActivityTimelineAuditItem(event)),
		].sort((a, b) => b.time - a.time);
	}

	private toActivityTimelineAuditItem(event: AuditEventRecord): ActivityTimelineItem {
		const isConnection =
			event.eventType === 'connection' ||
			event.eventType === 'agent-connection-event' ||
			event.action === 'connection' ||
			event.action === 'mcp.initialize';
		const isStructureEvent = event.action === 'structure.repair' || event.action === 'legacy_structure.migrate' || event.action === 'legacy_structure.cleanup';
		const agentLabel = this.formatAgentDisplayName(event.clientName, event.agentId);
		return {
			time: event.sortTimestamp,
			type: event.toolName
				? agentLabel
				: isConnection
					? agentLabel
					: isStructureEvent
						? ui('结构', 'Structure')
						: ui('记录', 'Record'),
			title: event.toolName
				? this.formatToolDisplayName(event.toolName)
				: isConnection
					? ui('建立连接', 'Connected')
					: this.runtimeLogTitle(event, 'record'),
			meta: event.resultStatus ? this.formatResultLabel(event.resultStatus) : event.actor,
			body: event.reason || event.snippet,
			path: event.target || event.path,
		};
	}

	async loadAgentConnectionsSnapshot(): Promise<AgentConnectionsSnapshot> {
		const auditLogMissing =
			this.app.vault.getAbstractFileByPath(CONTROL_PATHS.auditLog) === null;
		const auditDirMissing =
			this.app.vault.getAbstractFileByPath(CONTROL_PATHS.auditDir) === null;
		const auditEvents = await this.readRecentAuditEvents(80);
		const toolCalls = auditEvents
			.filter((event) => this.isToolCallAuditEvent(event))
			.map((event) => this.toAgentToolCallRecord(event))
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, MAX_AGENT_TOOL_CALL_ROWS);
		const recentAgents = this.buildRecentAgentConnections(auditEvents, toolCalls)
			.slice(0, MAX_AGENT_CONNECTION_ROWS);
		const vaultRoot = this.getVaultRoot();
		const httpEndpoint = this.getMcpHttpEndpoint();
		const connectionUrl = this.getMcpConnectionUrl();
		const runtimeStatus = this.getRuntimeViewStatus();

		return {
			vaultRoot,
			httpEndpoint,
			connectionUrl,
			runtimeStatus,
			clientConfigs: this.buildClientConfigs(),
			recentAgents,
			recentToolCalls: toolCalls,
			missingAuditSources: auditLogMissing && auditDirMissing,
			updatedAt: new Date().toISOString(),
		};
	}

	async loadGraphHealthSnapshot(): Promise<GraphHealthSnapshot> {
		const profile = this.settings.graphProfile;
		try {
			const result = await this.callLocalMcpTool('tracekeeper.graph_health', {
				max_items: MAX_GRAPH_HEALTH_ITEMS,
				graph_profile: profile,
			});
			return this.toGraphHealthSnapshot(result, profile);
		} catch (error) {
			console.error('tracekeeper failed to load graph health', error);
			return this.emptyGraphHealthSnapshot(
				profile,
				error instanceof Error ? error.message : String(error || 'Unknown graph health error.')
			);
		}
	}

	async createGraphHealthReviewProposal(snapshot: GraphHealthSnapshot): Promise<string> {
		if (!snapshot.ok) {
			throw new Error(snapshot.errorMessage || 'Graph health is not available.');
		}
		const content = this.buildGraphHealthProposalContent(snapshot);
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const result = await this.callLocalMcpTool('tracekeeper.propose_memory', {
			proposal_kind: 'graph_health_improvement',
			title: ui('知识图谱修复建议', 'Graph health improvement proposal'),
			filename: `graph_health_improvement_${timestamp}`,
			target_note: snapshot.missingRecommendedEntry || KNOWLEDGE_INDEX_PATH,
			risk_level: snapshot.profile === 'strict' ? 'medium' : 'low',
			evidence: `tracekeeper.graph_health ${snapshot.scannedAt || snapshot.updatedAt}`,
			content,
		});
		await this.refreshGovernanceViews();
		return typeof result.path === 'string' ? result.path : '';
	}

	private emptyGraphHealthSnapshot(profile: GraphProfile, errorMessage = ''): GraphHealthSnapshot {
		const updatedAt = new Date().toISOString();
		return {
			ok: errorMessage.length === 0,
			readOnly: true,
			profile,
			disabled: profile === 'off',
			vaultRoot: this.getVaultRoot(),
			scannedAt: '',
			updatedAt,
			errorMessage,
			noteCount: 0,
			wikilinkEdgeCount: 0,
			resolvedEdgeCount: 0,
			unresolvedEdgeCount: 0,
			largestComponentNodeCount: 0,
			componentCount: 0,
			isolatedNodes: [],
			isolatedNodeCount: 0,
			onlyInboundNodes: [],
			onlyInboundNodeCount: 0,
			onlyOutboundNodes: [],
			onlyOutboundNodeCount: 0,
			hubCandidates: [],
			hubCandidateCount: 0,
			missingRecommendedEntry: '',
			missingRecommendedHubs: [],
			missingRecommendedHubCount: 0,
			recommendations: [],
			recommendationCount: 0,
			profileIssues: [],
		};
	}

	private toGraphHealthSnapshot(result: Record<string, unknown>, profile: GraphProfile): GraphHealthSnapshot {
		const resultProfile = normalizeGraphProfileValue(this.stringFromRecord(result, 'profile') || profile);
		const snapshot: GraphHealthSnapshot = {
			ok: result.ok !== false,
			readOnly: result.read_only !== false,
			profile: resultProfile,
			disabled: result.disabled === true || resultProfile === 'off',
			vaultRoot: this.stringFromRecord(result, 'vault_root') || this.getVaultRoot(),
			scannedAt: this.stringFromRecord(result, 'scanned_at'),
			updatedAt: new Date().toISOString(),
			errorMessage: '',
			noteCount: this.numberFromRecord(result, 'note_count'),
			wikilinkEdgeCount: this.numberFromRecord(result, 'wikilink_edge_count'),
			resolvedEdgeCount: this.numberFromRecord(result, 'resolved_edge_count'),
			unresolvedEdgeCount: this.numberFromRecord(result, 'unresolved_edge_count'),
			largestComponentNodeCount: this.numberFromRecord(result, 'largest_component_node_count'),
			componentCount: this.numberFromRecord(result, 'component_count'),
			isolatedNodes: this.stringArrayFromRecord(result, 'isolated_nodes'),
			isolatedNodeCount: this.numberFromRecord(result, 'isolated_node_count'),
			onlyInboundNodes: this.stringArrayFromRecord(result, 'only_inbound_nodes'),
			onlyInboundNodeCount: this.numberFromRecord(result, 'only_inbound_node_count'),
			onlyOutboundNodes: this.stringArrayFromRecord(result, 'only_outbound_nodes'),
			onlyOutboundNodeCount: this.numberFromRecord(result, 'only_outbound_node_count'),
			hubCandidates: this.graphHubCandidatesFromRecord(result, 'hub_candidates'),
			hubCandidateCount: this.numberFromRecord(result, 'hub_candidate_count'),
			missingRecommendedEntry: this.stringFromRecord(result, 'missing_recommended_entry'),
			missingRecommendedHubs: this.stringArrayFromRecord(result, 'missing_recommended_hubs'),
			missingRecommendedHubCount: this.numberFromRecord(result, 'missing_recommended_hub_count'),
			recommendations: this.stringArrayFromRecord(result, 'recommendations'),
			recommendationCount: this.numberFromRecord(result, 'recommendation_count'),
			profileIssues: this.graphProfileIssuesFromRecord(result, 'profile_issues'),
		};
		if (snapshot.profileIssues.length === 0 && !snapshot.disabled) {
			snapshot.profileIssues = this.evaluateGraphProfile(snapshot);
		}
		return snapshot;
	}

	private evaluateGraphProfile(snapshot: GraphHealthSnapshot): GraphProfileIssue[] {
		if (snapshot.profile === 'off') {
			return [];
		}
		const severityForCore = snapshot.profile === 'strict' ? 'error' : 'warning';
		const issues: GraphProfileIssue[] = [];
		const pushIssue = (kind: string, severity: GraphProfileIssueSeverity, message: string) => {
			issues.push({ kind, severity, message, count: 1, paths: [] });
		};

		if (snapshot.unresolvedEdgeCount > 0) {
			pushIssue(
				'unresolved_wikilinks',
				severityForCore,
				ui(
					`${snapshot.unresolvedEdgeCount} 条 wikilink 未解析。`,
					`${snapshot.unresolvedEdgeCount} wikilinks are unresolved.`
				)
			);
		}
		if (snapshot.missingRecommendedEntry) {
			pushIssue(
				'missing_graph_entry',
				severityForCore,
				ui(
					`缺少图谱入口：${snapshot.missingRecommendedEntry}`,
					`Missing graph entry: ${snapshot.missingRecommendedEntry}`
				)
			);
		}
		if (snapshot.missingRecommendedHubCount > 0) {
			pushIssue(
				'missing_recommended_hubs',
				severityForCore,
				ui(
					`缺少 ${snapshot.missingRecommendedHubCount} 个推荐 hub。`,
					`${snapshot.missingRecommendedHubCount} recommended hubs are missing.`
				)
			);
		}
		if (snapshot.isolatedNodeCount > 0) {
			pushIssue(
				'isolated_nodes',
				severityForCore,
				ui(
					`${snapshot.isolatedNodeCount} 个笔记没有图谱连接。`,
					`${snapshot.isolatedNodeCount} notes have no graph links.`
				)
			);
		}
		if (snapshot.componentCount > 1) {
			pushIssue(
				'graph_components',
				'warning',
				ui(
					`图谱分成 ${snapshot.componentCount} 个连通分量。`,
					`Graph is split into ${snapshot.componentCount} components.`
				)
			);
		}
		if (snapshot.onlyInboundNodeCount > 0) {
			pushIssue(
				'only_inbound_nodes',
				'warning',
				ui(
					`${snapshot.onlyInboundNodeCount} 个笔记只有入链。`,
					`${snapshot.onlyInboundNodeCount} notes only have inbound links.`
				)
			);
		}
		if (snapshot.onlyOutboundNodeCount > 0) {
			pushIssue(
				'only_outbound_nodes',
				'warning',
				ui(
					`${snapshot.onlyOutboundNodeCount} 个笔记只有出链。`,
					`${snapshot.onlyOutboundNodeCount} notes only have outbound links.`
				)
			);
		}
		return issues;
	}

	private buildGraphHealthProposalContent(snapshot: GraphHealthSnapshot): string {
		const profileIssues = snapshot.profileIssues.length > 0
			? snapshot.profileIssues.map((issue) => `- ${issue.severity}: ${issue.kind} - ${issue.message}`)
			: ['- No profile issues detected.'];
		const recommendations = snapshot.recommendations.length > 0
			? snapshot.recommendations.map((item) => `- ${item}`)
			: ['- No recommendations returned by graph health.'];
		const hubCandidates = snapshot.hubCandidates.length > 0
			? snapshot.hubCandidates.map((candidate) =>
				`- ${candidate.path} (degree ${candidate.degree}, inbound ${candidate.inbound}, outbound ${candidate.outbound})`
			)
			: ['- No hub candidates returned.'];
		const missingHubs = snapshot.missingRecommendedHubs.length > 0
			? snapshot.missingRecommendedHubs.map((item) => `- ${item}`)
			: ['- None'];

		return [
			'## Graph health review proposal',
			'',
			`- graph_profile: ${snapshot.profile}`,
			`- scanned_at: ${snapshot.scannedAt || snapshot.updatedAt}`,
			`- vault_root: ${snapshot.vaultRoot}`,
			`- note_count: ${snapshot.noteCount}`,
			`- wikilink_edge_count: ${snapshot.wikilinkEdgeCount}`,
			`- resolved_edge_count: ${snapshot.resolvedEdgeCount}`,
			`- unresolved_edge_count: ${snapshot.unresolvedEdgeCount}`,
			`- component_count: ${snapshot.componentCount}`,
			`- largest_component_node_count: ${snapshot.largestComponentNodeCount}`,
			`- isolated_node_count: ${snapshot.isolatedNodeCount}`,
			`- only_inbound_node_count: ${snapshot.onlyInboundNodeCount}`,
			`- only_outbound_node_count: ${snapshot.onlyOutboundNodeCount}`,
			`- missing_recommended_entry: ${snapshot.missingRecommendedEntry || 'none'}`,
			'',
			'## Profile issues',
			...profileIssues,
			'',
			'## Recommendations',
			...recommendations,
			'',
			'## Missing recommended hubs',
			...missingHubs,
			'',
			'## Hub candidates',
			...hubCandidates,
			'',
			'## Review boundary',
			'- This proposal only creates a Review Queue item.',
			'- Do not modify notes, create hubs, or write long-term memory until the user approves the specific writeback.',
		].join('\n');
	}

	private stringFromRecord(record: Record<string, unknown>, key: string): string {
		const value = record[key];
		return typeof value === 'string' ? value.trim() : '';
	}

	private numberFromRecord(record: Record<string, unknown>, key: string): number {
		const value = record[key];
		return typeof value === 'number' && Number.isFinite(value) ? value : 0;
	}

	private stringArrayFromRecord(record: Record<string, unknown>, key: string): string[] {
		const value = record[key];
		if (!Array.isArray(value)) {
			return [];
		}
		return value
			.filter((item): item is string => typeof item === 'string')
			.map((item) => item.trim())
			.filter(Boolean);
	}

	private graphHubCandidatesFromRecord(record: Record<string, unknown>, key: string): GraphHealthHubCandidate[] {
		const value = record[key];
		if (!Array.isArray(value)) {
			return [];
		}
		const candidates: GraphHealthHubCandidate[] = [];
		for (const item of value) {
			if (!this.isRecord(item) || typeof item.path !== 'string') {
				continue;
			}
			candidates.push({
				path: item.path.trim(),
				degree: typeof item.degree === 'number' ? item.degree : 0,
				inbound: typeof item.inbound === 'number' ? item.inbound : 0,
				outbound: typeof item.outbound === 'number' ? item.outbound : 0,
			});
		}
		return candidates;
	}

	private graphProfileIssuesFromRecord(record: Record<string, unknown>, key: string): GraphProfileIssue[] {
		const value = record[key];
		if (!Array.isArray(value)) {
			return [];
		}
		const issues: GraphProfileIssue[] = [];
		for (const item of value) {
			if (!this.isRecord(item) || typeof item.kind !== 'string' || typeof item.message !== 'string') {
				continue;
			}
			const severity = item.severity === 'error' ? 'error' : 'warning';
			issues.push({
				kind: item.kind.trim(),
				severity,
				message: item.message.trim(),
				count: typeof item.count === 'number' && Number.isFinite(item.count) ? item.count : 1,
				paths: Array.isArray(item.paths)
					? item.paths.filter((path): path is string => typeof path === 'string').map((path) => path.trim()).filter(Boolean)
					: [],
			});
		}
		return issues;
	}

	private getVaultRoot(): string {
		const { adapter } = this.app.vault;
		if (!(adapter instanceof FileSystemAdapter)) {
			return ui('当前知识库路径不可用', 'Current knowledge base path unavailable');
		}
		const basePath = adapter.getBasePath();
		return basePath || ui('当前知识库路径不可用', 'Current knowledge base path unavailable');
	}

	private buildClientConfigs(): GeneratedClientConfig[] {
		return this.getClientProfiles().map((profile) => {
			const status = this.readClientConfigStatus(profile);
			return {
				clientId: profile.id,
				displayName: profile.displayName,
				description: profile.description,
				transport: profile.preferredTransport,
				configText: this.buildClientConfigText(profile),
				supportsAutoConfigure: profile.supportsAutoConfigure,
				restartRequired: profile.restartRequired,
				configFormat: profile.configFormat,
				targetPath: profile.targetPath,
				configState: status.state,
				configStatusLabel: status.label,
				configStatusDetail: status.detail,
			};
		});
	}

	private readClientConfigStatus(profile: ClientProfile): { state: ClientConfigState; label: string; detail: string } {
		if (!profile.supportsAutoConfigure || !profile.targetPath) {
			return {
				state: 'not_configured',
				label: ui('未配置', 'Not configured'),
				detail: ui('需要复制配置到对应 AI 工具。', 'Copy this config into the AI tool.'),
			};
		}

		const api = this.getDesktopNodeApi();
		if (!api) {
			return {
				state: 'unavailable',
				label: ui('未配置', 'Not configured'),
				detail: ui('当前环境不支持自动读取配置文件。', 'This environment cannot read the config file automatically.'),
			};
		}

		if (!api.fs.existsSync(profile.targetPath)) {
			return {
				state: 'not_configured',
				label: ui('未配置', 'Not configured'),
				detail: ui('尚未写入 Tracekeeper 连接。', 'The Tracekeeper connection has not been written yet.'),
			};
		}

		try {
			const content = api.fs.readFileSync(profile.targetPath, 'utf8');
			return this.detectClientConfigStatus(profile, content);
		} catch (error) {
			console.error('tracekeeper failed to read client config status', error);
			return {
				state: 'unavailable',
				label: ui('未配置', 'Not configured'),
				detail: ui('无法读取配置文件，请检查文件权限。', 'Cannot read the config file. Check file permissions.'),
			};
		}
	}

	private getClientProfiles(): ClientProfile[] {
		const desktopApi = this.getDesktopNodeApi();
		const homeDir = desktopApi?.os.homedir();
		return [
			{
				id: 'codex',
				displayName: 'Codex',
				description: ui('将下面内容加入 Codex 配置文件，然后重启 Codex。', 'Add this to your Codex config file, then restart Codex.'),
				preferredTransport: 'streamable-http',
				supportsAutoConfigure: Boolean(homeDir),
				restartRequired: true,
				configFormat: 'codex-toml',
				targetPath: homeDir ? desktopApi?.path.join(homeDir, '.codex', 'config.toml') : undefined,
			},
			{
				id: 'claude-code',
				displayName: 'Claude Code',
				description: ui('将下面内容加入 Claude Code 的 MCP 配置。', 'Add this to your Claude Code MCP configuration.'),
				preferredTransport: 'streamable-http',
				supportsAutoConfigure: false,
				restartRequired: false,
				configFormat: 'mcp-json',
			},
			{
				id: 'claude-desktop',
				displayName: 'Claude Desktop',
				description: ui('将下面内容加入 Claude Desktop 连接配置，然后重启 Claude Desktop。', 'Add this to Claude Desktop connection settings, then restart Claude Desktop.'),
				preferredTransport: 'streamable-http',
				supportsAutoConfigure: Boolean(homeDir),
				restartRequired: true,
				configFormat: 'mcp-json',
				targetPath: homeDir ? desktopApi?.path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') : undefined,
			},
			{
				id: 'cursor',
				displayName: 'Cursor',
				description: ui('将下面内容加入 Cursor 的连接配置，然后重启 Cursor。', 'Add this to Cursor connection settings, then restart Cursor.'),
				preferredTransport: 'streamable-http',
				supportsAutoConfigure: false,
				restartRequired: true,
				configFormat: 'copy-only',
			},
			{
				id: 'custom',
				displayName: ui('自定义 MCP 工具', 'Custom MCP tool'),
				description: ui('当你的 AI 工具不在上方列表，但支持填写 MCP 地址时使用。', 'Use this when your AI tool is not listed above but supports an MCP URL.'),
				preferredTransport: 'streamable-http',
				supportsAutoConfigure: false,
				restartRequired: true,
				configFormat: 'copy-only',
			},
		];
	}

	private buildClientConfigText(profile: ClientProfile): string {
		const connectionUrl = this.getMcpConnectionUrl();
		if (profile.id === 'codex') {
			return [
				'[mcp_servers.tracekeeper]',
				`url = ${JSON.stringify(connectionUrl)}`,
			].join('\n');
		}

		const config = {
			mcpServers: {
				'tracekeeper': {
					url: connectionUrl,
				},
			},
			client: profile.id,
		};
		return JSON.stringify(config, null, 2);
	}

	private detectClientConfigStatus(profile: ClientProfile, content: string): { state: ClientConfigState; label: string; detail: string } {
		if (profile.configFormat === 'codex-toml') {
			const block = this.extractCodexTomlTracekeeperBlock(content);
			if (block.length === 0) {
				return {
					state: 'not_configured',
					label: ui('未配置', 'Not configured'),
					detail: ui('配置文件中还没有 Tracekeeper 连接。', 'The config file does not include the Tracekeeper connection yet.'),
				};
			}
			const configuredUrl = this.readTomlStringValue(block.join('\n'), 'url');
			const configuredCommand = this.readTomlStringValue(block.join('\n'), 'command');
			if (configuredCommand) {
				return {
					state: 'needs_update',
					label: ui('需更新', 'Needs update'),
					detail: ui('检测到旧版命令启动配置，需要更新为本机 MCP 地址。', 'Old command startup config detected. Update it to the local MCP URL.'),
				};
			}
			if (!configuredUrl) {
				return {
					state: 'needs_update',
					label: ui('需更新', 'Needs update'),
					detail: ui('已存在 Tracekeeper 配置，但缺少连接地址。', 'Tracekeeper config exists but has no connection URL.'),
				};
			}
			if (configuredUrl !== this.getMcpConnectionUrl()) {
				return {
					state: 'needs_update',
					label: ui('需更新', 'Needs update'),
					detail: ui('已配置，但连接地址或本地令牌与当前设置不同。', 'Configured, but the URL or local token differs from the current setting.'),
				};
			}
			return {
				state: 'configured',
				label: ui('已配置', 'Configured'),
				detail: ui('连接配置已写入，保持 Obsidian 开启后即可使用。', 'Connection config is written. Keep Obsidian open to use it.'),
			};
		}

		if (profile.configFormat === 'mcp-json') {
			try {
				const parsed = this.parseMcpJsonConfig(content);
				const server = parsed.mcpServers['tracekeeper'];
				if (!server || typeof server !== 'object' || Array.isArray(server)) {
					return {
						state: 'not_configured',
						label: ui('未配置', 'Not configured'),
						detail: ui('配置文件中还没有 Tracekeeper 连接。', 'The config file does not include the Tracekeeper connection yet.'),
					};
				}
				const url = (server as { url?: unknown }).url;
				const command = (server as { command?: unknown }).command;
				if (typeof command === 'string' && command.trim()) {
					return {
						state: 'needs_update',
						label: ui('需更新', 'Needs update'),
						detail: ui('检测到旧版命令启动配置，需要更新为本机 MCP 地址。', 'Old command startup config detected. Update it to the local MCP URL.'),
					};
				}
				if (typeof url !== 'string' || !url.trim()) {
					return {
						state: 'needs_update',
						label: ui('需更新', 'Needs update'),
						detail: ui('已存在 Tracekeeper 配置，但缺少连接地址。', 'Tracekeeper config exists but has no connection URL.'),
					};
				}
				if (url.trim() !== this.getMcpConnectionUrl()) {
					return {
						state: 'needs_update',
						label: ui('需更新', 'Needs update'),
						detail: ui('已配置，但连接地址或本地令牌与当前设置不同。', 'Configured, but the URL or local token differs from the current setting.'),
					};
				}
				return {
					state: 'configured',
					label: ui('已配置', 'Configured'),
					detail: ui('连接配置已写入，保持 Obsidian 开启后即可使用。', 'Connection config is written. Keep Obsidian open to use it.'),
				};
			} catch (error) {
				console.error('tracekeeper failed to parse client config status', error);
				return {
					state: 'not_configured',
					label: ui('未配置', 'Not configured'),
					detail: ui('配置文件无法解析，可以自动配置覆盖 Tracekeeper 连接。', 'The config file could not be parsed. Auto setup can rewrite the Tracekeeper connection.'),
				};
			}
		}

		return {
			state: 'not_configured',
			label: ui('未配置', 'Not configured'),
			detail: ui('需要复制配置到对应 AI 工具。', 'Copy this config into the AI tool.'),
		};
	}

	private extractCodexTomlTracekeeperBlock(content: string): string[] {
		const lines = content.split(/\r?\n/);
		const block: string[] = [];
		let collecting = false;
		for (const line of lines) {
			if (this.isTracekeeperCodexTomlHeader(line)) {
				collecting = true;
				block.push(line);
				continue;
			}
			if (collecting && this.isTomlHeader(line)) {
				break;
			}
			if (collecting) {
				block.push(line);
			}
		}
		return block;
	}

	private readTomlStringValue(content: string, key: string): string | null {
		const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const match = content.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.+?)\\s*$`, 'm'));
		if (!match) {
			return null;
		}
		const rawValue = match[1].trim();
		if (rawValue.startsWith('"')) {
			try {
				const parsed: unknown = JSON.parse(rawValue);
				return typeof parsed === 'string' ? parsed : null;
			} catch {
				return rawValue.replace(/^"|"$/g, '');
			}
		}
		return rawValue.replace(/^['"]|['"]$/g, '');
	}

	getMcpHttpEndpoint(): string {
		return `http://${DEFAULT_MCP_HOST}:${this.settings.mcpPort || DEFAULT_MCP_PORT}${DEFAULT_MCP_PATH}`;
	}

	getMcpConnectionUrl(): string {
		const token = this.settings.runtimeToken || '';
		const endpoint = this.getMcpHttpEndpoint();
		return token ? `${endpoint}?token=${encodeURIComponent(token)}` : endpoint;
	}

	getRuntimeViewStatus(): RuntimeViewStatus {
		const status = this.mcpRuntime?.getStatus() || this.runtimeStatus;
		const enabled = this.settings.mcpRuntimeEnabled;
		const label = enabled ? this.runtimeStateLabel(status.state) : ui('已关闭', 'Off');
		return {
			enabled,
			state: status.state,
			label,
			detail: enabled
				? this.runtimeStateDetail(status)
				: ui('MCP 服务已关闭。需要 AI 工具连接时，可在插件设置中重新开启。', 'MCP service is off. Turn it back on in plugin settings when AI tools need to connect.'),
			endpoint: this.getMcpHttpEndpoint(),
			host: DEFAULT_MCP_HOST,
			port: this.settings.mcpPort || DEFAULT_MCP_PORT,
			startedAt: status.startedAt,
			activeSessions: status.activeSessions,
			lastError: status.lastError,
		};
	}

	private runtimeStateLabel(state: RuntimeState): string {
		switch (state) {
			case 'running':
				return ui('运行中', 'Running');
			case 'starting':
				return ui('启动中', 'Starting');
			case 'port_conflict':
				return ui('端口被占用', 'Port in use');
			case 'failed':
				return ui('启动失败', 'Failed');
			case 'stopped':
			default:
				return ui('未运行', 'Not running');
		}
	}

	private runtimeStateDetail(status: StreamableHttpRuntimeStatus): string {
		switch (status.state) {
			case 'running':
				return ui('Obsidian 已托管本机 MCP 服务，AI 工具可在 Obsidian 开启时连接。', 'Obsidian is hosting the local MCP service. AI tools can connect while Obsidian is open.');
			case 'starting':
				return ui('MCP 服务正在启动。', 'The MCP service is starting.');
			case 'port_conflict':
				return ui(`端口 ${this.settings.mcpPort} 已被占用，请修改端口或关闭占用程序。`, `Port ${this.settings.mcpPort} is already in use. Change the port or close the process using it.`);
			case 'failed':
				return status.lastError
					? ui(`MCP 服务启动失败：${status.lastError}`, `MCP service failed to start: ${status.lastError}`)
					: ui('MCP 服务启动失败，请检查 Obsidian 控制台。', 'MCP service failed to start. Check the Obsidian console.');
			case 'stopped':
			default:
				return ui('MCP 服务未运行。插件启用且 Obsidian 打开后会自动启动。', 'The MCP service is not running. It starts automatically when the plugin is enabled and Obsidian is open.');
		}
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}

	private isApprovedWritebackPreview(value: unknown): value is ApprovedWritebackPreview {
		if (!this.isRecord(value)) {
			return false;
		}
		return typeof value.proposal_id === 'string'
			&& typeof value.proposal_path === 'string'
			&& typeof value.target_note === 'string'
			&& typeof value.writeback_preview === 'string'
			&& Array.isArray(value.touched_notes)
			&& value.touched_notes.every((item) => typeof item === 'string');
	}

	private isDesktopFsModule(value: unknown): value is DesktopNodeApi['fs'] {
		return this.isRecord(value)
			&& typeof value.existsSync === 'function'
			&& typeof value.readFileSync === 'function'
			&& typeof value.writeFileSync === 'function'
			&& typeof value.mkdirSync === 'function'
			&& typeof value.renameSync === 'function';
	}

	private isDesktopPathModule(value: unknown): value is DesktopNodeApi['path'] {
		return this.isRecord(value)
			&& typeof value.dirname === 'function'
			&& typeof value.join === 'function';
	}

	private isDesktopOsModule(value: unknown): value is DesktopNodeApi['os'] {
		return this.isRecord(value) && typeof value.homedir === 'function';
	}

	private isDesktopShell(value: unknown): value is NonNullable<DesktopNodeApi['shell']> {
		return this.isRecord(value) && typeof value.openPath === 'function';
	}

	private errorToString(value: unknown, fallback = 'Unknown error'): string {
		if (typeof value === 'string') {
			return value.trim();
		}
		if (value instanceof Error) {
			return value.message.trim();
		}
		if (typeof value === 'number' || typeof value === 'boolean') {
			return String(value);
		}
		if (value === null || value === undefined) {
			return '';
		}
		if (this.isRecord(value)) {
			if (typeof value.message === 'string' && value.message.trim()) {
				return value.message.trim();
			}
			if (typeof value.error === 'string' && value.error.trim()) {
				return value.error.trim();
			}
		}
		try {
			return JSON.stringify(value) ?? fallback;
		} catch {
			return fallback;
		}
	}

	private getHeaderValue(headers: Record<string, string>, name: string): string | undefined {
		const exact = headers[name];
		if (exact) {
			return exact;
		}
		const lowered = headers[name.toLowerCase()];
		if (lowered) {
			return lowered;
		}
		const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
		return key ? headers[key] : undefined;
	}

	private parseJsonPayload(text: string): Record<string, unknown> | null {
		try {
			const parsed: unknown = text ? JSON.parse(text) : null;
			return parsed && this.isRecord(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}

	private async ensureUiMcpSession(): Promise<void> {
		if (this.uiMcpSessionId) {
			return;
		}
		const result = await this.postLocalMcp('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: {
				name: 'tracekeeper-plugin-ui',
				version: '0.1.7',
			},
		}, false);
		if (!this.isRecord(result)) {
			throw new Error('MCP initialize returned an invalid response.');
		}
	}

	private async postLocalMcp(method: string, params: Record<string, unknown>, includeSession = true): Promise<unknown> {
		const headers: Record<string, string> = {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		};
		if (includeSession) {
			headers['mcp-session-id'] = this.uiMcpSessionId;
		}
		const response = await requestUrl({
			url: this.getMcpConnectionUrl(),
			method: 'POST',
			headers,
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: this.uiMcpRequestId++,
				method,
				params,
			}),
		});
		const payload = this.parseJsonPayload(response.text);
		if (method === 'initialize') {
			const sessionHeader = this.getHeaderValue(response.headers, 'mcp-session-id');
			if (sessionHeader) {
				this.uiMcpSessionId = sessionHeader;
			}
		}
		const errorMessage = this.isRecord(payload) && 'error' in payload
			? this.errorToString(payload.error)
			: '';
		if (response.status < 200 || response.status >= 300) {
			throw new Error(errorMessage || `MCP request failed with HTTP ${response.status}.`);
		}
		if (errorMessage) {
			throw new Error(errorMessage);
		}
		if (!this.isRecord(payload)) {
			throw new Error('MCP request returned an invalid JSON-RPC response.');
		}
		return payload.result;
	}

	async callLocalMcpTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
		if (!this.settings.mcpRuntimeEnabled) {
			throw new Error(ui('MCP 服务已关闭，请先在 Tracekeeper 设置中开启。', 'MCP service is off. Turn it on in Tracekeeper settings first.'));
		}
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				await this.ensureUiMcpSession();
				const result = await this.postLocalMcp('tools/call', {
					name,
					arguments: args,
				});
				const structured = this.isRecord(result) && this.isRecord(result.structuredContent)
					? result.structuredContent
					: result;
				if (this.isRecord(result) && result.isError) {
					const message = this.isRecord(structured)
						? this.errorToString(structured.error)
						: this.errorToString(result.error);
					throw new Error(message || `${name} failed.`);
				}
				if (!this.isRecord(structured)) {
					throw new Error(`${name} returned an invalid result.`);
				}
				if (structured.ok === false) {
					throw new Error(this.errorToString(structured.error, `${name} failed.`));
				}
				return structured;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (attempt === 0 && /session|Mcp-Session-Id/i.test(message)) {
					this.uiMcpSessionId = '';
					continue;
				}
				throw error;
			}
		}
		throw new Error(`${name} failed.`);
	}

	async processSourceRequest(request: SourceRequestRecord): Promise<void> {
		const args: Record<string, unknown> = { request_path: request.path };
		if (request.taskId) {
			args.task_id = request.taskId;
		}
		await this.callLocalMcpTool('tracekeeper.source_request', {
			...args,
			action: 'analyze',
		});
		await this.refreshGovernanceViews();
	}

	async previewApprovedWriteback(proposal: MemoryProposalRecord): Promise<ApprovedWritebackPreview> {
		const args: Record<string, unknown> = {
			proposal_path: proposal.path,
			dry_run: true,
		};
		if (proposal.taskId) {
			args.task_id = proposal.taskId;
		}
		const result = await this.callLocalMcpTool('tracekeeper.apply_approved_writeback', args);
		if (!this.isApprovedWritebackPreview(result)) {
			throw new Error('Approved writeback preview returned an invalid result.');
		}
		return result;
	}

	async applyApprovedWriteback(proposal: MemoryProposalRecord): Promise<void> {
		const args: Record<string, unknown> = { proposal_path: proposal.path };
		if (proposal.taskId) {
			args.task_id = proposal.taskId;
		}
		await this.callLocalMcpTool('tracekeeper.apply_approved_writeback', args);
		await this.refreshGovernanceViews();
	}

	async runMemoryRecall(input: MemoryRecallInput): Promise<MemoryRecallResult> {
		const query = input.query.trim();
		const scope = this.normalizeMemoryRecallScope(input.scope);
		if (!query && scope !== 'project_history') {
			throw new Error(ui('请输入检索文本。', 'Please enter a query.'));
		}

		const projectHint = input.projectHint?.trim() || '';
		const args: Record<string, unknown> = {
			scope,
			max_items: TRACE_RECALL_RESULT_LIMIT,
		};
		if (query) {
			args.query = query;
		}
		if (projectHint) {
			args.project_hint = projectHint;
		}
		const result = await this.callLocalMcpTool('tracekeeper.recall', args);

		return this.parseMemoryRecallResult(result, scope, {
			query,
			scope,
			projectHint,
			sourceTool: 'tracekeeper.recall',
		});
	}

	private parseMemoryRecallResult(
		result: Record<string, unknown>,
		scope: TracekeeperRecallScope,
		options: MemoryRecallInput & { sourceTool: string }
	): MemoryRecallResult {
		const rawMatches = this.extractRecallMatches(result);
		const entries = rawMatches.map((match) => this.normalizeMemoryRecallEntry(match, scope));
		return {
			query: options.query,
			scope,
			projectHint: options.projectHint || '',
			items: entries,
			sourceTool: options.sourceTool,
		};
	}

	private extractRecallMatches(result: Record<string, unknown>): unknown[] {
		const matches = result.matches;
		if (Array.isArray(matches)) {
			return matches;
		}
		const entries = result.entries;
		if (Array.isArray(entries)) {
			return entries;
		}
		if (Array.isArray(result.results)) {
			return result.results as unknown[];
		}
		return [];
	}

	private normalizeMemoryRecallEntry(match: unknown, scope: TracekeeperRecallScope): MemoryRecallResultEntry {
		if (!this.isRecord(match)) {
			return {
				path: ui('未知路径', 'Unknown path'),
				title: ui('未知标题', 'Unknown title'),
				scope: this.memoryRecallScopeLabel(scope),
				type: ui('笔记', 'Note'),
				score: 0,
				matchedTokens: [],
				reason: ui('缺少可展示字段', 'No display fields available'),
			};
		}
		const recallMatch = match as ParsedRecord;
		const path = this.trimText(this.firstString(recallMatch, ['path']), 280);
		const title = this.firstString(recallMatch, ['title']) || path;
		const scoreRaw = recallMatch.score;
		const score = typeof scoreRaw === 'number'
			? scoreRaw
			: typeof scoreRaw === 'string'
				? Number.parseFloat(scoreRaw)
				: 0;

		return {
			path,
			title,
			scope: this.memoryRecallScopeLabel(
				this.normalizeMemoryRecallScope(this.firstString(recallMatch, ['scope']) || scope)
			),
			type: this.firstString(recallMatch, ['type']) || ui('笔记', 'Note'),
			score: Number.isFinite(score) ? score : 0,
			matchedTokens: this.readStringList(recallMatch, ['matched_tokens', 'matchedTokens', 'tokens', 'keywords']).slice(0, 8),
			reason: this.readStringList(recallMatch, ['score_reason', 'scoreReason']).join('；')
				|| this.firstString(recallMatch, ['reason'])
				|| this.firstString(recallMatch, ['summary'])
				|| ui('暂无说明', 'No reason provided'),
		};
	}

	normalizeMemoryRecallScope(scope: string): TracekeeperRecallScope {
		return (scope && (MEMORY_RECALL_SCOPES as readonly string[]).includes(scope))
			? scope as TracekeeperRecallScope
			: 'global';
	}

	memoryRecallScopeLabel(scope: TracekeeperRecallScope): string {
		switch (scope) {
			case 'project':
				return ui('项目', 'Project');
			case 'project_history':
				return ui('项目历史', 'Project history');
			case 'global':
			default:
				return ui('全局', 'Global');
		}
	}

	async applyClientConfig(config: GeneratedClientConfig): Promise<void> {
		try {
			const result = this.writeClientConfig(config);
			this.queueClientConfigAuditEvent('client_config_applied', config, 'success', result.backupPath);
			new Notice(ui('已写入知识库连接配置，请重启对应 AI 工具。', 'Tracekeeper connection config written. Restart the AI tool.'));
			this.queueRuntimeLogRefresh();
		} catch (error) {
			console.error('tracekeeper failed to apply client config', error);
			this.queueClientConfigAuditEvent('client_config_failed', config, 'failed');
			new Notice(ui('写入连接配置失败。', 'Failed to write connection config.'));
			throw error;
		}
	}

	async removeClientConfig(config: GeneratedClientConfig): Promise<void> {
		try {
			const result = this.deleteClientConfig(config);
			this.queueClientConfigAuditEvent('client_config_removed', config, 'success', result.backupPath);
			new Notice(ui('已移除配置，请重启对应 AI 工具。', 'Config removed. Restart the AI tool.'));
			this.queueRuntimeLogRefresh();
		} catch (error) {
			console.error('tracekeeper failed to remove client config', error);
			this.queueClientConfigAuditEvent('client_config_failed', config, 'failed');
			new Notice(ui('移除配置失败。', 'Failed to remove config.'));
			throw error;
		}
	}

	async openClientConfigFile(config: GeneratedClientConfig): Promise<void> {
		const api = this.getDesktopNodeApi();
		if (!api?.shell || !config.targetPath) {
			new Notice(ui('当前环境无法打开配置文件。', 'Cannot open the config file in this environment.'));
			return;
		}
		if (!api.fs.existsSync(config.targetPath)) {
			new Notice(ui('配置文件尚未创建，请先完成自动配置。', 'The config file does not exist yet. Run auto setup first.'));
			return;
		}
		const result = await api.shell.openPath(config.targetPath);
		if (result) {
			new Notice(ui('打开配置文件失败。', 'Failed to open config file.'));
			return;
		}
		new Notice(ui('已打开配置文件。', 'Config file opened.'));
	}

	private writeClientConfig(config: GeneratedClientConfig): { backupPath: string } {
		const { api, targetPath } = this.requireAutoConfigApi(config);
		const original = api.fs.existsSync(targetPath) ? api.fs.readFileSync(targetPath, 'utf8') : '';
		const nextContent = this.mergeClientConfigContent(config, original);
		return this.writeConfigFile(api, targetPath, original, nextContent);
	}

	private deleteClientConfig(config: GeneratedClientConfig): { backupPath: string } {
		const { api, targetPath } = this.requireAutoConfigApi(config);
		const original = api.fs.existsSync(targetPath) ? api.fs.readFileSync(targetPath, 'utf8') : '';
		const nextContent = this.removeClientConfigContent(config, original);
		return this.writeConfigFile(api, targetPath, original, nextContent);
	}

	private requireAutoConfigApi(config: GeneratedClientConfig): { api: DesktopNodeApi; targetPath: string } {
		const api = this.getDesktopNodeApi();
		if (!api || !config.targetPath || !config.supportsAutoConfigure) {
			throw new Error(`Client auto-configuration is not supported for ${config.clientId}.`);
		}
		return { api, targetPath: config.targetPath };
	}

	private writeConfigFile(api: DesktopNodeApi, targetPath: string, original: string, nextContent: string): { backupPath: string } {
		const directory = api.path.dirname(targetPath);
		api.fs.mkdirSync(directory, { recursive: true });
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const backupPath = `${targetPath}.tracekeeper-backup-${stamp}`;
		const tmpPath = `${targetPath}.tracekeeper-tmp-${stamp}`;
		api.fs.writeFileSync(backupPath, original, 'utf8');
		api.fs.writeFileSync(tmpPath, nextContent, 'utf8');
		api.fs.renameSync(tmpPath, targetPath);
		return { backupPath };
	}

	private mergeClientConfigContent(config: GeneratedClientConfig, original: string): string {
		if (config.configFormat === 'codex-toml') {
			return this.trimLeadingWhitespace(`${this.trimTrailingWhitespace(this.removeCodexTomlTracekeeperBlock(original))}\n\n${config.configText}\n`);
		}
		if (config.configFormat === 'mcp-json') {
			const parsed = this.parseMcpJsonConfig(original);
			parsed.mcpServers['tracekeeper'] = {
				url: this.getMcpConnectionUrl(),
			};
			return `${JSON.stringify(parsed, null, 2)}\n`;
		}
		throw new Error(`Unsupported config format: ${config.configFormat}`);
	}

	private removeClientConfigContent(config: GeneratedClientConfig, original: string): string {
		if (config.configFormat === 'codex-toml') {
			return `${this.trimTrailingWhitespace(this.removeCodexTomlTracekeeperBlock(original))}\n`;
		}
		if (config.configFormat === 'mcp-json') {
			const parsed = this.parseMcpJsonConfig(original);
			delete parsed.mcpServers['tracekeeper'];
			return `${JSON.stringify(parsed, null, 2)}\n`;
		}
		throw new Error(`Unsupported config format: ${config.configFormat}`);
	}

	private trimTrailingWhitespace(value: string): string {
		return value.replace(/\s+$/, '');
	}

	private trimLeadingWhitespace(value: string): string {
		return value.replace(/^\s+/, '');
	}

	private parseMcpJsonConfig(content: string): { mcpServers: Record<string, unknown>; [key: string]: unknown } {
		const trimmed = content.trim();
		const parsed: unknown = trimmed ? JSON.parse(trimmed) : {};
		if (!this.isRecord(parsed)) {
			throw new Error('Client config must be a JSON object.');
		}

		const serverMap = this.isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
		return {
			...parsed,
			mcpServers: serverMap,
		};
	}

	private removeCodexTomlTracekeeperBlock(content: string): string {
		const lines = content.split(/\r?\n/);
		const nextLines: string[] = [];
		let skipping = false;
		for (const line of lines) {
			if (this.isTracekeeperCodexTomlHeader(line)) {
				skipping = true;
				continue;
			}
			if (skipping && this.isTomlHeader(line)) {
				skipping = false;
			}
			if (!skipping) {
				nextLines.push(line);
			}
		}
		return nextLines.join('\n');
	}

	private isTracekeeperCodexTomlHeader(line: string): boolean {
		return /^\s*\[mcp_servers\.(?:"tracekeeper"|'tracekeeper'|tracekeeper)\]\s*$/.test(line);
	}

	private isTomlHeader(line: string): boolean {
		return /^\s*\[[^\]]+\]\s*$/.test(line);
	}

	private async appendClientConfigAuditEvent(
		action: string,
		config: GeneratedClientConfig,
		result: string,
		backupPath?: string
	): Promise<void> {
		const now = new Date().toISOString();
		const event = (
			`## ${now}\n` +
			`action: ${action}\n` +
			'actor: user\n' +
			`client: ${config.clientId}\n` +
			`transport: ${config.transport}\n` +
			`target: ${config.targetPath || ''}\n` +
			`backup_path: ${backupPath || ''}\n` +
			`result: ${result}\n` +
			`timestamp: ${now}\n\n`
		);
		await this.appendToAuditLog(event);
	}

	private queueClientConfigAuditEvent(
		action: string,
		config: GeneratedClientConfig,
		result: string,
		backupPath?: string
	): void {
		void this.appendClientConfigAuditEvent(action, config, result, backupPath).catch((error) => {
			console.error('tracekeeper failed to record client config audit event', error);
		});
	}

	private queueRuntimeLogRefresh(): void {
		void Promise.all([
			this.refreshActivityViews(),
			this.refreshRuntimeLogViews(),
		]).catch((error) => {
			console.error('tracekeeper failed to refresh runtime log views', error);
		});
	}

	private getDesktopNodeApi(): DesktopNodeApi | null {
		if (!Platform.isDesktopApp) {
			return null;
		}
		const maybeWindow = window as Window & { require?: (moduleName: string) => unknown };
		if (typeof maybeWindow.require !== 'function') {
			return null;
		}
		const fs = maybeWindow.require('fs');
		const pathModule = maybeWindow.require('path');
		const os = maybeWindow.require('os');
		const electron = maybeWindow.require('electron');
		if (!this.isDesktopFsModule(fs) || !this.isDesktopPathModule(pathModule) || !this.isDesktopOsModule(os)) {
			return null;
		}
		const shell = this.isRecord(electron) && this.isDesktopShell(electron.shell) ? electron.shell : undefined;
		return {
			fs,
			path: pathModule,
			os,
			shell,
		};
	}

	private isToolCallAuditEvent(event: AuditEventRecord): boolean {
		return event.eventType === 'tool-call'
			|| event.eventType === 'agent-tool-call'
			|| (Boolean(event.toolName) && !this.isConnectionAuditEvent(event));
	}

	private isConnectionAuditEvent(event: AuditEventRecord): boolean {
		return event.eventType === 'connection' || event.eventType === 'agent-connection-event' || event.action === 'connection' || event.action === 'mcp.initialize';
	}

	private normalizeAuditToolName(eventType: string, action: string, toolName: string): string {
		const normalizedTool = toolName.trim();
		const isConnection =
			eventType === 'connection' ||
			eventType === 'agent-connection-event' ||
			action === 'connection' ||
			action === 'mcp.initialize';
		if (isConnection && normalizedTool.toLowerCase() === 'unknown') {
			return '';
		}
		return normalizedTool;
	}

	private toAgentToolCallRecord(event: AuditEventRecord): AgentToolCallRecord {
		return {
			agentId: event.agentId || 'unknown',
			sessionId: event.sessionId || event.agentId || 'unknown',
			clientName: event.clientName || 'unknown',
			toolName: event.toolName || event.action || 'unknown',
			resultStatus: event.resultStatus || 'unknown',
			targetPaths: event.targetPaths,
			timestamp: event.timestamp,
			durationMs: event.durationMs,
			riskLevel: event.riskLevel || 'unknown',
			argsSummary: event.argsSummary,
			sortTimestamp: event.sortTimestamp,
		};
	}

	private buildRecentAgentConnections(
		auditEvents: AuditEventRecord[],
		toolCalls: AgentToolCallRecord[]
	): AgentConnectionRecord[] {
		const agents = new Map<string, AgentConnectionRecord>();
		const upsertAgent = (agentId: string, sessionId: string, clientName: string, timestamp: string, sortTimestamp: number) => {
			const key = `${clientName || 'unknown'}::${sessionId || agentId || 'unknown'}`;
			const existing = agents.get(key);
			if (existing && existing.sortTimestamp >= sortTimestamp) {
				return existing;
			}
			const next = existing || {
				agentId: agentId || 'unknown',
				sessionId: sessionId || agentId || 'unknown',
				clientName: clientName || 'unknown',
				transport: 'streamable-http',
				status: 'seen',
				lastSeen: timestamp,
				lastToolCall: '',
				runtimeVersion: '',
				permissionProfile: 'read-only default + controlled write',
				sortTimestamp,
			};
			next.lastSeen = timestamp || next.lastSeen;
			next.sortTimestamp = sortTimestamp || next.sortTimestamp;
			agents.set(key, next);
			return next;
		};

		for (const event of auditEvents.filter((item) => this.isConnectionAuditEvent(item))) {
			const agent = upsertAgent(event.agentId, event.sessionId, event.clientName, event.timestamp, event.sortTimestamp);
			agent.transport = event.transport || agent.transport;
			agent.runtimeVersion = event.runtimeVersion || agent.runtimeVersion;
			agent.status = event.resultStatus || 'connected';
		}

		for (const call of toolCalls) {
			const agent = upsertAgent(call.agentId, call.sessionId, call.clientName, call.timestamp, call.sortTimestamp);
			agent.lastToolCall = call.toolName;
			agent.status = call.resultStatus === 'failed' ? 'warning' : 'active';
		}

		return [...agents.values()].sort((a, b) => b.sortTimestamp - a.sortTimestamp);
	}

	async loadMemoryReviewQueueSnapshot(): Promise<MemoryReviewQueueSnapshot> {
		const folder = this.app.vault.getAbstractFileByPath(REVIEW_QUEUE_PATH);
		if (!(folder instanceof TFolder)) {
			return {
				proposals: [],
				missingReviewQueueFolder: true,
				updatedAt: new Date().toISOString(),
			};
		}

		const files = this.collectMarkdownFiles(folder);
		const records = await Promise.all(files.map((file) => this.readMemoryProposalFile(file)));
		const proposals = records
			.filter((record): record is MemoryProposalRecord => Boolean(record))
			.sort((a, b) => this.compareProposalRecords(a, b))
			.slice(0, MAX_REVIEW_QUEUE_ROWS);

		return {
			proposals,
			missingReviewQueueFolder: false,
			updatedAt: new Date().toISOString(),
		};
	}

	private async readMemoryProposalFile(file: TFile): Promise<MemoryProposalRecord | null> {
		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`tracekeeper failed to read memory proposal: ${file.path}`, error);
			content = '';
		}

		const parsed = this.readFrontmatter(content);
		const data = parsed.fields;
		const proposalType = this.firstString(data, ['type']);
		const normalizedProposalType = proposalType.toLowerCase().replace(/_/g, '-');
		if (
			proposalType &&
			!normalizedProposalType.includes('memory-proposal')
		) {
			return null;
		}

		const created = this.firstString(data, ['created']);
		const proposalId = this.firstString(data, ['proposal_id', 'proposalId']) || file.basename;
		const approvalStatus = this.normalizeProposalStatus(
			this.firstString(data, ['approval_status', 'approvalStatus'])
		);
		const sortTimestamp = this.parseTimestamp(
			created,
			file.stat?.mtime
		);

			return {
				path: file.path,
				proposalId,
				proposalKind: this.firstString(data, ['proposal_kind', 'proposalKind']) || 'unknown',
				proposedBy: this.firstString(data, ['proposed_by', 'proposedBy']) || 'unknown',
				relatedProject: this.firstString(data, ['related_project', 'relatedProject', 'project_hint', 'projectHint']) || '',
				taskId: this.firstString(data, ['task_id', 'taskId']) || '',
				targetNote: this.firstString(data, ['target_note', 'targetNote']) || '',
			evidence: this.readStringList(data, ['evidence']),
			riskLevel: this.firstString(data, ['risk_level', 'riskLevel']) || 'unknown',
			approvalStatus,
			created,
			snippet: this.snippetFromText(parsed.body, proposalId),
			sortTimestamp,
		};
	}

	async updateMemoryProposalStatus(
		proposal: MemoryProposalRecord,
		nextStatus: MemoryProposalStatus
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(proposal.path);
		if (!(file instanceof TFile)) {
			throw new Error(`Cannot update proposal status: ${proposal.path} is not available.`);
		}

		const normalizedStatus = this.normalizeProposalStatus(nextStatus);
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			(frontmatter as Record<string, unknown>).approval_status = normalizedStatus;
		});
		await this.appendProposalStatusAuditEvent(
			{
				...proposal,
				approvalStatus: normalizedStatus,
			},
			normalizedStatus
		);
	}

	async archiveMemoryProposals(proposals: MemoryProposalRecord[]): Promise<number> {
		const archiveFolder = ARCHIVE_REVIEW_QUEUE_DIR;
		await this.ensureFolderExists(archiveFolder);
		let moved = 0;
		for (const proposal of proposals) {
			const file = this.app.vault.getAbstractFileByPath(proposal.path);
			if (!(file instanceof TFile)) {
				continue;
			}
			const fileName = proposal.path.split('/').pop() || `${proposal.proposalId || 'proposal'}.md`;
			const targetPath = await this.availableArchivePath(archiveFolder, fileName);
			await this.app.vault.rename(file, targetPath);
			moved += 1;
		}
		if (moved > 0) {
			const now = new Date().toISOString();
			await this.appendToAuditLog(
				`## ${now}\n` +
				'action: memory.proposal.archive\n' +
				'actor: user\n' +
				`target: ${archiveFolder}\n` +
				`reason: archived ${moved} processed review queue item(s)\n` +
				`timestamp: ${now}\n\n`
			);
			await this.refreshGovernanceViews();
		}
		return moved;
	}

	private async availableArchivePath(folder: string, fileName: string): Promise<string> {
		const normalizedName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
		const base = normalizedName.replace(/\.md$/i, '');
		let candidate = this.normalizeVaultPath(`${folder}/${normalizedName}`);
		if (!this.app.vault.getAbstractFileByPath(candidate)) {
			return candidate;
		}
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		let suffix = 1;
		do {
			candidate = this.normalizeVaultPath(`${folder}/${base}-${stamp}-${suffix}.md`);
			suffix += 1;
		} while (this.app.vault.getAbstractFileByPath(candidate));
		return candidate;
	}

	private normalizeProposalStatus(rawStatus?: string): MemoryProposalStatus {
		const status = (rawStatus || 'pending').toLowerCase().trim();
		if (
			status === 'approved' ||
			status === 'rejected' ||
			status === 'deferred' ||
			status === 'revision_requested' ||
			status === 'applied'
		) {
			return status;
		}
		if (status === 'pending_review') {
			return 'pending';
		}
		return 'pending';
	}

	private compareProposalRecords(a: MemoryProposalRecord, b: MemoryProposalRecord): number {
		const statusRank: Record<MemoryProposalStatus, number> = {
			pending: 0,
			revision_requested: 1,
			approved: 2,
			applied: 3,
			deferred: 4,
			rejected: 5,
		};
		const rankA = statusRank[a.approvalStatus] ?? 1;
		const rankB = statusRank[b.approvalStatus] ?? 1;
		if (rankA !== rankB) {
			return rankA - rankB;
		}
		return b.sortTimestamp - a.sortTimestamp;
	}

	private async readRecentAgentTasks(limit: number): Promise<AgentTaskRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(AGENT_TASKS_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectMarkdownFiles(folder);
		const records = await Promise.all(
			files.map((file) => this.readAgentTaskFile(file))
		);
		return records
			.filter((record): record is AgentTaskRecord => Boolean(record))
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, limit);
	}

	private async readRecentContextPacks(limit: number): Promise<ContextPackRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(CONTEXT_PACKS_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectMarkdownFiles(folder);
		const records = await Promise.all(files.map((file) => this.readContextPackFile(file)));
		return records
			.filter((record): record is ContextPackRecord => Boolean(record))
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, limit);
	}

	private async readContextPackFile(file: TFile): Promise<ContextPackRecord | null> {
		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`tracekeeper failed to read context pack: ${file.path}`, error);
			return null;
		}

		const parsed = this.readFrontmatter(content);
		const data = parsed.fields;
		const createdAt = this.firstString(data, ['created_at', 'createdAt', 'created']);
		const title = this.firstString(data, ['title']) || file.basename;

		return {
			path: file.path,
			title,
			taskId: this.firstString(data, ['task_id', 'taskId']),
			createdAt,
			snippet: this.snippetFromText(parsed.body, title),
			sortTimestamp: this.parseTimestamp(createdAt, file.stat?.mtime),
		};
	}

	private async readRecentSourceCaptures(limit: number): Promise<SourceCaptureRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(SOURCES_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectMarkdownFiles(folder);
		const records = await Promise.all(files.map((file) => this.readSourceCaptureFile(file)));
		return records
			.filter((record): record is SourceCaptureRecord => Boolean(record))
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, limit);
	}

	private async readSourceCaptureFile(file: TFile): Promise<SourceCaptureRecord | null> {
		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`tracekeeper failed to read source capture: ${file.path}`, error);
			return null;
		}

		const parsed = this.readFrontmatter(content);
		const data = parsed.fields;
		if (Object.keys(data).length === 0) {
			return null;
		}

		const type = this.firstString(data, ['type']);
		const source = this.firstString(data, ['source']);
		if (!source && !type.toLowerCase().includes('source')) {
			return null;
		}
		const createdAt = this.firstString(data, ['created_at', 'createdAt', 'created']);
		const sourceLabel = source || file.basename;
		const title = this.firstString(data, ['title']) || sourceLabel;

		return {
			path: file.path,
			type: type || 'source_capture',
			title,
			source: sourceLabel,
			sourceKind: this.firstString(data, ['source_kind', 'sourceKind']),
			mode: this.firstString(data, ['mode']) || '',
			taskId: this.firstString(data, ['task_id', 'taskId']),
			createdAt,
			snippet: this.snippetFromText(parsed.body, sourceLabel),
			sortTimestamp: this.parseTimestamp(createdAt, file.stat?.mtime),
		};
	}

	private async readRecentMemoryProposals(limit: number): Promise<MemoryProposalRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(REVIEW_QUEUE_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectMarkdownFiles(folder);
		const records = await Promise.all(files.map((file) => this.readMemoryProposalFile(file)));
		return records
			.filter((record): record is MemoryProposalRecord => Boolean(record))
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, limit);
	}

	private async readRecentAuditEvents(limit: number): Promise<AuditEventRecord[]> {
		const auditLogRecords = await this.readAuditLogFile();
		const folderRecords = await this.readAuditFolderEvents();

		return [...auditLogRecords, ...folderRecords]
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, limit);
	}

	private collectMarkdownFiles(folder: TFolder): TFile[] {
		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === 'md') {
				files.push(child);
			} else if (child instanceof TFolder) {
				files.push(...this.collectMarkdownFiles(child));
			}
		}
		return files;
	}

	private async readAgentTaskFile(file: TFile): Promise<AgentTaskRecord> {
		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`tracekeeper failed to read agent task: ${file.path}`, error);
			content = '';
		}
		const parsed = this.readFrontmatter(content);
		const data = parsed.fields;
		const objective = this.firstString(data, ['objective']);
		const path = file.path;

		const startedAt = this.firstString(data, ['started_at', 'startedAt']);
		const finishedAt = this.firstString(data, ['finished_at', 'finishedAt']);
		const sortTimestamp = this.parseTimestamp(
			startedAt || finishedAt,
			file.stat?.mtime
		);

		return {
			path,
			type: this.firstString(data, ['type']) || 'agent-task',
			taskId: this.firstString(data, ['task_id', 'taskId']) || file.basename,
			agent: this.firstString(data, ['agent']) || 'unknown',
			objective: objective || this.snippetFromText(parsed.body, file.basename),
			status: this.firstString(data, ['status']) || 'unknown',
			startedAt,
			finishedAt,
			contextPack: this.firstString(data, ['context_pack', 'contextPack']),
			relatedProject: this.firstString(data, ['related_project', 'relatedProject']),
			memoryReads: this.readStringList(data, ['memory_reads', 'memoryReads']),
			memoryWrites: this.readStringList(data, ['memory_writes', 'memoryWrites']),
			sourceCaptures: this.readStringList(data, ['source_captures', 'sourceCaptures']),
			proposals: this.readStringList(data, ['proposals']),
			snippet: this.snippetFromText(parsed.body, objective || file.basename),
			sortTimestamp,
		};
	}

	private async readAuditLogFile(): Promise<AuditEventRecord[]> {
		const file = this.app.vault.getAbstractFileByPath(CONTROL_PATHS.auditLog);
		if (!(file instanceof TFile)) {
			return [];
		}

		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error('tracekeeper failed to read audit log', error);
			return [];
		}

		return this.parseAuditLogSections(content, file.path);
	}

	private async readAuditFolderEvents(): Promise<AuditEventRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(CONTROL_PATHS.auditDir);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectMarkdownFiles(folder);
		const events: AuditEventRecord[] = [];
		for (const file of files) {
			const fileEvents = await this.readAuditMarkdownFile(file);
			events.push(...fileEvents);
		}
		return events;
	}

	private async readAuditMarkdownFile(file: TFile): Promise<AuditEventRecord[]> {
		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`tracekeeper failed to read audit file: ${file.path}`, error);
			return [];
		}

		const parsed = this.readFrontmatter(content);
		const data = parsed.fields;
		const timestamp = this.firstString(data, ['timestamp']) || this.timestampFromFilename(file.basename);
		const fallbackTs =
			this.parseTimestamp(timestamp, file.stat?.mtime || Date.now()) || file.stat?.mtime || Date.now();

		if (Object.keys(data).length > 0) {
			const eventType = this.firstString(data, ['type']);
			const action = this.firstString(data, ['action']) || 'unknown';
			const toolName = this.normalizeAuditToolName(
				eventType,
				action,
				this.firstString(data, ['tool_name', 'toolName', 'tool'])
			);
			return [
				{
					path: file.path,
					auditId: this.firstString(data, ['audit_id', 'auditId', 'id']),
					actor: this.firstString(data, ['actor']) || 'unknown',
					action,
					target: this.firstString(data, ['target']) || '',
					reason: this.firstString(data, ['reason']) || '',
					taskId: this.firstString(data, ['task_id', 'taskId']),
					timestamp: timestamp || '',
					sortTimestamp: fallbackTs,
					snippet: this.snippetFromText(parsed.body, this.trimText(file.basename)),
					eventType,
					agentId: this.firstString(data, ['agent_id', 'agentId', 'session_id', 'sessionId']),
					sessionId: this.firstString(data, ['session_id', 'sessionId']),
					clientName: this.firstString(data, ['client_name', 'clientName', 'client']),
					toolName,
					resultStatus: this.firstString(data, ['result_status', 'resultStatus', 'result', 'status']),
					targetPaths: this.readStringList(data, ['target_paths', 'targetPaths', 'target_path', 'targetPath', 'target']),
					durationMs: this.firstString(data, ['duration_ms', 'durationMs']),
					riskLevel: this.firstString(data, ['risk_level', 'riskLevel']),
					argsSummary: this.firstString(data, ['args_summary', 'argsSummary']),
					transport: this.firstString(data, ['transport']),
					runtimeVersion: this.firstString(data, ['runtime_version', 'runtimeVersion']),
				},
			];
		}

		const sectionRecords = this.parseAuditLogSections(content, file.path);
		return sectionRecords.length > 0 ? sectionRecords : [];
	}

	private parseAuditLogSections(content: string, sourcePath: string): AuditEventRecord[] {
		const lines = content.replace(/\r\n/g, '\n').split('\n');
		const events: AuditEventRecord[] = [];
		let cursor = 0;

		while (cursor < lines.length) {
			const header = lines[cursor].trim();
			if (!header.startsWith('## ')) {
				cursor += 1;
				continue;
			}

			const timestampHeader = header.replace(/^##\s+/, '').trim();
			cursor += 1;
			const bodyLines: string[] = [];
			while (
				cursor < lines.length &&
				!lines[cursor].trim().startsWith('## ')
			) {
				bodyLines.push(lines[cursor]);
				cursor += 1;
			}

			const row = this.readKeyValueRows(bodyLines);
			const fallbackTimestamp =
				this.firstString(row, ['timestamp']) || timestampHeader;
			const eventType = this.firstString(row, ['type']);
			const action = this.firstString(row, ['action']) || 'unknown';
			const toolName = this.normalizeAuditToolName(
				eventType,
				action,
				this.firstString(row, ['tool_name', 'toolName', 'tool'])
			);
			events.push({
				path: sourcePath,
				auditId: this.firstString(row, ['audit_id', 'auditId', 'id']),
				actor: this.firstString(row, ['actor']) || 'unknown',
				action,
				target: this.firstString(row, ['target']) || '',
				reason: this.firstString(row, ['reason']) || '',
				taskId: this.firstString(row, ['task_id', 'taskId']),
				timestamp: fallbackTimestamp,
				sortTimestamp: this.parseTimestamp(
					fallbackTimestamp,
					Date.now()
				),
				snippet: this.snippetFromText(bodyLines.join('\n')),
				eventType,
				agentId: this.firstString(row, ['agent_id', 'agentId', 'session_id', 'sessionId']),
				sessionId: this.firstString(row, ['session_id', 'sessionId']),
				clientName: this.firstString(row, ['client_name', 'clientName', 'client']),
				toolName,
				resultStatus: this.firstString(row, ['result_status', 'resultStatus', 'result', 'status']),
				targetPaths: this.readStringList(row, ['target_paths', 'targetPaths', 'target_path', 'targetPath', 'target']),
				durationMs: this.firstString(row, ['duration_ms', 'durationMs']),
				riskLevel: this.firstString(row, ['risk_level', 'riskLevel']),
				argsSummary: this.firstString(row, ['args_summary', 'argsSummary']),
				transport: this.firstString(row, ['transport']),
				runtimeVersion: this.firstString(row, ['runtime_version', 'runtimeVersion']),
			});
		}

		return events;
	}

	private readFrontmatter(content: string): ParsedFrontmatter {
		const normalized = content.replace(/\r\n/g, '\n');
		const lines = normalized.split('\n');
		if (lines.length === 0 || lines[0].trim() !== '---') {
			return { fields: {}, body: normalized };
		}

		const fields: ParsedRecord = {};
		let cursor = 1;
		for (; cursor < lines.length; cursor++) {
			const line = lines[cursor];
			if (line.trim() === '---') {
				cursor += 1;
				break;
			}

			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) {
				continue;
			}

			const pair = trimmed.match(/^([^:]+):\s*(.*)$/);
			if (!pair) {
				continue;
			}

			const key = pair[1].trim();
			const rawValue = pair[2].trim();
			if (rawValue === '') {
				const values: string[] = [];
				let next = cursor + 1;
				while (next < lines.length) {
					const match = lines[next].match(/^\s*-\s+(.*)$/);
					if (!match) {
						break;
					}
					values.push(match[1].trim());
					next += 1;
				}
				if (values.length > 0) {
					fields[key] = values;
					cursor = next - 1;
				}
				continue;
			}

			fields[key] = this.parseScalarOrArray(rawValue);
		}

		return { fields, body: lines.slice(cursor).join('\n') };
	}

	private parseScalarOrArray(value: string): ParsedRecordValue {
		const trimmed = value.trim();
		if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
			const inner = trimmed.slice(1, -1).trim();
			if (!inner) {
				return [];
			}
			return inner
				.split(',')
				.map((item) => this.trimText(item.replace(/^['"]|['"]$/g, '')))
				.filter(Boolean);
		}

		if (
			(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
			(trimmed.startsWith("'") && trimmed.endsWith("'"))
		) {
			return trimmed.slice(1, -1);
		}

		return trimmed;
	}

	private readKeyValueRows(lines: string[]): ParsedRecord {
		const rows: ParsedRecord = {};
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const normalized = trimmed.replace(/^-\s+/, '');
			const match = normalized.match(/^([^:]+):\s*(.*)$/);
			if (!match) {
				continue;
			}
			const key = match[1].trim();
			const rawValue = match[2].trim();
			if (rawValue) {
				rows[key] = this.parseScalarOrArray(rawValue);
				continue;
			}

			const listValues: string[] = [];
			for (let listIndex = index + 1; listIndex < lines.length; listIndex += 1) {
				const listMatch = lines[listIndex].match(/^\s+-\s+(.*)$/);
				if (!listMatch) {
					break;
				}
				const value = this.parseScalarOrArray(listMatch[1].trim());
				if (typeof value === 'string' && value) {
					listValues.push(value);
				} else if (Array.isArray(value)) {
					listValues.push(...value);
				}
				index = listIndex;
			}
			rows[key] = listValues;
		}
		return rows;
	}

	private firstString(values: ParsedRecord, keys: string[]): string {
		for (const key of keys) {
			const value = values[key];
			if (typeof value === 'string' && value.trim()) {
				return value.trim();
			}
			if (Array.isArray(value)) {
				const first = value.find((entry) => Boolean(entry && entry.trim()));
				if (first) {
					return first;
				}
			}
		}
		return '';
	}

	private readStringList(values: ParsedRecord, keys: string[]): string[] {
		const items: string[] = [];
		for (const key of keys) {
			const value = values[key];
			if (!value) continue;
			if (Array.isArray(value)) {
				items.push(...value.filter(Boolean));
				continue;
			}
			items.push(
				...value
					.split(',')
					.map((entry) => entry.trim())
					.filter(Boolean)
			);
		}
		return [...new Set(items)];
	}

	private parseTimestamp(timestamp: string | undefined, fallbackMs?: number): number {
		if (timestamp) {
			const parsed = Date.parse(timestamp);
			if (!Number.isNaN(parsed)) {
				return parsed;
			}
		}
		if (fallbackMs) {
			return fallbackMs;
		}
		return 0;
	}

	private timestampFromFilename(name: string): string {
		const match = name.match(/\d{4}[-_]?\d{2}[-_]?\d{2}([T_]\d{2}[-_]?\d{2}[-_]?\d{2})?/);
		if (!match) return '';
		return match[0].replace(/_/g, 'T').replace(/-/g, '-');
	}

	private snippetFromText(text: string, fallback: string = ''): string {
		const lines = text
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.filter((line) => !line.startsWith('#'))
			.filter((line) => !line.startsWith('---'));

		const raw =
			lines.length > 0 ? lines[0] : this.trimText(fallback, MAX_TASK_SNIPPET_LENGTH);
		return this.trimText(raw, MAX_TASK_SNIPPET_LENGTH);
	}

	trimText(value: string, maxLength = MAX_TASK_SNIPPET_LENGTH): string {
		const trimmed = value.trim();
		if (trimmed.length <= maxLength) {
			return trimmed;
		}
		return `${trimmed.slice(0, maxLength - 1)}…`;
	}

	formatDisplayTime(value: number): string {
		const date = new Date(value);
		if (!Number.isFinite(value) || Number.isNaN(date.getTime())) {
			return ui('未知时间', 'Unknown time');
		}
		const pad = (input: number) => String(input).padStart(2, '0');
		return [
			`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
			`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
		].join(' ');
	}

	async openPluginView(viewType: string) {
		const existingLeaves = this.app.workspace.getLeavesOfType(viewType);
		if (existingLeaves.length > 0) {
			this.app.workspace.setActiveLeaf(existingLeaves[0]);
			return;
		}

		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({
			type: viewType,
			state: {},
			active: true,
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	openSettingsTab(): void {
		const appWithSettings = this.app as App & {
			setting?: {
				open(): void;
				openTabById(id: string): void;
			};
		};
		if (!appWithSettings.setting) {
			new Notice(ui('请在 Obsidian 设置中打开 Tracekeeper。', 'Open Tracekeeper from Obsidian settings.'));
			return;
		}
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(this.manifest.id);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async copyToClipboard(value: string, successMessage: string): Promise<void> {
		await navigator.clipboard.writeText(value);
		new Notice(successMessage);
	}

	renderTimelineItem(container: HTMLElement, item: ActivityTimelineItem): void {
		const row = container.createDiv({ cls: 'tracekeeper-timeline__item' });
		row.createEl('div', { text: item.type, cls: 'tracekeeper-badge' });
		const body = row.createDiv({ cls: 'tracekeeper-timeline__body' });
		body.createEl('strong', {
			text: `${item.title || ui('未命名', 'Untitled')} • ${this.formatDisplayTime(item.time)}`,
		});
		if (item.meta) {
			body.createEl('div', { text: item.meta, cls: 'tracekeeper-view__description' });
		}
		if (item.body) {
			body.createEl('div', { text: this.trimText(item.body, 160) });
		}
		if (item.path) {
			body.createEl('small', { text: item.path });
		}
	}

	formatToolDisplayName(toolName: string): string {
		const normalized = toolName.replace(/^tracekeeper[._]/, '').trim();
		const labels: Record<string, string> = {
			status: ui('查看状态', 'Check status'),
			graph_health: ui('查看图谱健康', 'Check graph health'),
			start_task: ui('开始任务记录', 'Start task record'),
			recall: ui('查找相关笔记', 'Find related notes'),
			read_note: ui('读取笔记', 'Read note'),
			review_queue: ui('查看审核队列', 'Review queue'),
			list_review_queue: ui('查看待审核内容', 'Review pending items'),
			list_source_requests: ui('查看资料请求', 'Review material requests'),
			list_approved_writebacks: ui('查看已批准写回', 'Review approved writebacks'),
			audit_recent: ui('查看最近记录', 'Review recent activity'),
			source_request: ui('处理资料请求', 'Handle source requests'),
			build_context_pack: ui('整理上下文材料', 'Prepare context material'),
			lint: ui('检查笔记结构', 'Check note structure'),
			finish_task: ui('记录任务结果', 'Record task results'),
			distill_session: ui('沉淀会话摘要', 'Summarize a session'),
			capture_source: ui('保存来源资料', 'Save source material'),
			propose_memory: ui('提出记忆更新', 'Propose memory updates'),
			analyze_source_request: ui('处理资料请求', 'Process material request'),
			apply_approved_writeback: ui('应用已批准写回', 'Apply approved writeback'),
		};
		return labels[normalized] || normalized.replace(/_/g, ' ') || ui('未知操作', 'Unknown action');
	}

	formatAgentDisplayName(clientName: string, agentId = ''): string {
		const raw = (clientName || agentId || '').trim();
		const normalized = raw.toLowerCase();
		if (!normalized) {
			return ui('AI 工具', 'AI tool');
		}
		if (normalized.includes('codex')) {
			return 'Codex';
		}
		if (normalized.includes('claude')) {
			return 'Claude';
		}
		if (normalized.includes('cursor')) {
			return 'Cursor';
		}
		if (normalized.includes('tracekeeper')) {
			return 'Tracekeeper';
		}
		if (raw.length <= 28) {
			return raw;
		}
		return this.trimText(raw, 28);
	}

	formatResultLabel(status: string): string {
		switch (status) {
			case 'success':
			case 'written':
			case 'applied':
				return ui('成功', 'Succeeded');
			case 'failed':
			case 'error':
				return ui('失败', 'Failed');
			case 'skipped':
				return ui('已跳过', 'Skipped');
			case 'connected':
			case 'active':
				return ui('已连接', 'Connected');
			case 'warning':
				return ui('需检查', 'Needs attention');
			default:
				return status ? this.trimText(status, 40) : ui('未知', 'Unknown');
		}
	}

	formatRiskLabel(riskLevel: string): string {
		switch (riskLevel) {
			case 'read-only':
				return ui('只读', 'Read-only');
			case 'low-risk write':
				return ui('保存工作记录', 'Saves work records');
			case 'review-gated apply':
				return ui('先审核再写入', 'Review before writing');
			default:
				return riskLevel ? this.trimText(riskLevel, 40) : ui('未标记', 'Unmarked');
		}
	}
}

class InitializeMemoryStructureModal extends Modal {
	private snapshot: StructureOrganizerSnapshot;
	private migrationResult: LegacyMigrationResult | null = null;
	private cleanupResult: LegacyCleanupResult | null = null;
	private busy = false;

	constructor(
		app: App,
		private options: {
			plugin: TracekeeperPlugin;
			snapshot: StructureOrganizerSnapshot;
		}
	) {
		super(app);
		this.snapshot = options.snapshot;
	}

	onOpen(): void {
		void super.onOpen();
		this.render();
	}

	private render(): void {
		this.titleEl.setText(ui('知识库结构校验', 'Knowledge structure check'));

		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('p', {
			text: ui(
				'Tracekeeper 会先检查基础入口；发现旧目录时，可在这里预览并整理到统一知识体系。',
				'Tracekeeper checks base entries first. When legacy folders are found, you can preview and organize them here.'
			),
		});

		const basePlan = this.snapshot.basePlan;
		const legacyPlan = this.snapshot.legacyPlan;
		const baseMissingCount = basePlan.foldersToCreate.length + basePlan.filesToCreate.length;
		const summary = contentEl.createDiv({ cls: 'tracekeeper-structure-check-summary tracekeeper-detail-grid' });
		this.renderFact(summary, ui('基础结构', 'Base structure'), baseMissingCount === 0 ? ui('完整', 'Ready') : ui(`${baseMissingCount} 项缺失`, `${baseMissingCount} missing`));
		this.renderFact(summary, ui('旧目录', 'Legacy folders'), legacyPlan.legacyRoots.length === 0 ? ui('未发现', 'None') : ui(`${legacyPlan.legacyRoots.length} 个`, `${legacyPlan.legacyRoots.length}`));
		this.renderFact(summary, ui('旧文件', 'Legacy files'), String(legacyPlan.fileCount));
		this.renderFact(summary, ui('冲突', 'Conflicts'), String(legacyPlan.conflictCount));

		if (this.cleanupResult) {
			this.renderCleanupDone(contentEl, this.cleanupResult);
			return;
		}

		if (this.migrationResult) {
			this.renderMigrationDone(contentEl, this.migrationResult);
			return;
		}

		if (this.snapshot.state === 'ready') {
			this.renderEmptyMessage(contentEl, {
				title: ui('结构清晰，无需整理。', 'Structure is clean.'),
				text: ui(
					'当前知识库只有新版 Tracekeeper 顶层结构，没有需要处理的旧目录。',
					'The vault only has the current Tracekeeper top-level structure. No legacy folders need attention.'
				),
			});
			this.renderCloseAction(contentEl);
			return;
		}

		if (this.snapshot.state === 'needs_repair') {
			this.renderBaseRepair(contentEl, baseMissingCount);
			return;
		}

		this.renderLegacyDetected(contentEl, legacyPlan, baseMissingCount);
	}

	private renderBaseRepair(contentEl: HTMLElement, missingCount: number): void {
		this.renderEmptyMessage(contentEl, {
			title: ui('需要补齐基础结构。', 'Base structure needs repair.'),
			text: ui(
				`将创建 ${missingCount} 个必要入口；不会移动、删除或重写已有笔记。`,
				`${missingCount} required item(s) will be created. Existing notes will not be moved, deleted, or rewritten.`
			),
		});
		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());

		const confirm = actions.createEl('button', { text: ui('补齐基础结构', 'Repair base structure'), cls: 'mod-cta' });
		confirm.disabled = this.busy;
		confirm.addEventListener('click', () => {
			void (async () => {
				this.busy = true;
				this.render();
				try {
					await this.options.plugin.initializeMemoryStructure(this.snapshot.basePlan);
					this.snapshot = await this.options.plugin.buildStructureOrganizerSnapshot(this.snapshot.legacyPlan.migrationId);
				} catch (error) {
					console.error('tracekeeper failed to repair structure from modal', error);
					new Notice(ui('基础结构补齐失败。', 'Base structure repair failed.'));
				} finally {
					this.busy = false;
					this.render();
				}
			})();
		});
	}

	private renderLegacyDetected(contentEl: HTMLElement, plan: LegacyStructurePlan, baseMissingCount: number): void {
		const readyForCleanup = plan.legacyRoots.length > 0 && plan.copyCount === 0 && plan.conflictCount === 0 && plan.uncoveredCount === 0;
		const detail = contentEl.createDiv({ cls: 'tracekeeper-card' });
		detail.createEl('h3', { text: ui('发现旧目录结构', 'Legacy structure found') });
		detail.createEl('p', {
			text: readyForCleanup
				? ui(
					'旧目录内容已能在新结构中找到，可直接确认清理旧目录。',
					'Legacy content is already covered by the current structure. You can confirm cleanup now.'
				)
				: ui(
					`将先复制重建 ${plan.copyCount} 个文件；${plan.conflictCount} 个冲突会进入审核队列；旧目录会保留到你再次确认清理。`,
					`${plan.copyCount} file(s) will be copied first; ${plan.conflictCount} conflict(s) will go to review; legacy folders remain until you confirm cleanup.`
				),
		});
		if (plan.uncoveredCount > 0) {
			detail.createEl('p', {
				text: ui(
					`有 ${plan.uncoveredCount} 个文件没有稳定映射，会阻止清理。`,
					`${plan.uncoveredCount} file(s) have no stable mapping and will block cleanup.`
				),
				cls: 'tracekeeper-view__description',
			});
		}
		const facts = detail.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderFact(facts, ui('Markdown', 'Markdown'), String(plan.markdownCount));
		this.renderFact(facts, ui('其他文件', 'Other files'), String(plan.nonMarkdownCount));
		this.renderFact(facts, ui('已存在', 'Existing'), String(plan.skipCount));
		this.renderFact(facts, ui('基础缺失', 'Base missing'), String(baseMissingCount));

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: ui('取消', 'Cancel') }).addEventListener('click', () => this.close());
		if (readyForCleanup) {
			const cleanup = actions.createEl('button', { text: ui('确认清理旧目录', 'Confirm cleanup'), cls: 'mod-warning' });
			cleanup.disabled = this.busy;
			cleanup.addEventListener('click', () => {
				void (async () => {
					this.busy = true;
					this.render();
					try {
						this.cleanupResult = await this.options.plugin.cleanupLegacyStructure(plan.migrationId);
					} catch (error) {
						console.error('tracekeeper failed to cleanup legacy structure', error);
						new Notice(ui('旧目录清理失败，请查看控制台。', 'Legacy cleanup failed. Check the console.'));
					} finally {
						this.busy = false;
						this.render();
					}
				})();
			});
			return;
		}
		const migrate = actions.createEl('button', { text: ui('复制重建', 'Copy and rebuild'), cls: 'mod-cta' });
		migrate.disabled = this.busy || plan.fileCount === 0;
		migrate.addEventListener('click', () => {
			void (async () => {
				this.busy = true;
				this.render();
				try {
					this.migrationResult = await this.options.plugin.migrateLegacyStructure(this.snapshot);
				} catch (error) {
					console.error('tracekeeper failed to migrate legacy structure', error);
					new Notice(ui('旧目录复制重建失败。', 'Legacy copy and rebuild failed.'));
				} finally {
					this.busy = false;
					this.render();
				}
			})();
		});
	}

	private renderMigrationDone(contentEl: HTMLElement, result: LegacyMigrationResult): void {
		const card = contentEl.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('复制重建已完成', 'Copy and rebuild complete') });
		card.createEl('p', {
			text: ui(
				'旧目录还没有清理。确认清理后，旧目录会移入系统回收站。',
				'Legacy folders have not been cleaned yet. Confirm cleanup to move them to system trash.'
			),
		});
		const facts = card.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderFact(facts, ui('已复制', 'Copied'), String(result.copiedCount));
		this.renderFact(facts, ui('审核项', 'Review items'), String(result.reviewCount));
		this.renderFact(facts, ui('迁移报告', 'Migration report'), result.reportMdPath);

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: ui('稍后清理', 'Clean later') }).addEventListener('click', () => this.close());
		const cleanup = actions.createEl('button', { text: ui('确认清理旧目录', 'Confirm cleanup'), cls: 'mod-warning' });
		cleanup.disabled = this.busy;
		cleanup.addEventListener('click', () => {
			void (async () => {
				this.busy = true;
				this.render();
				try {
					this.cleanupResult = await this.options.plugin.cleanupLegacyStructure(result.migrationId);
				} catch (error) {
					console.error('tracekeeper failed to cleanup legacy structure', error);
					new Notice(ui('旧目录清理失败，请查看控制台。', 'Legacy cleanup failed. Check the console.'));
				} finally {
					this.busy = false;
					this.render();
				}
			})();
		});
	}

	private renderCleanupDone(contentEl: HTMLElement, result: LegacyCleanupResult): void {
		const card = contentEl.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('整理完成', 'Cleanup complete') });
		card.createEl('p', {
			text: ui(
				`已清理 ${result.trashedRoots.length} 个旧目录，任务记录和清理报告已写入。`,
				`${result.trashedRoots.length} legacy folder(s) cleaned. Task record and cleanup report were written.`
			),
		});
		const facts = card.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderFact(facts, ui('清理报告', 'Cleanup report'), result.reportPath);
		this.renderFact(facts, ui('任务记录', 'Task record'), result.taskPath);
		this.renderFact(facts, ui('失败', 'Failed'), String(result.failedRoots.length));
		this.renderCloseAction(contentEl);
	}

	private renderEmptyMessage(contentEl: HTMLElement, input: { title: string; text: string }): void {
		const card = contentEl.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: input.title });
		card.createEl('p', { text: input.text });
	}

	private renderFact(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value || ui('无', 'None') });
	}

	private renderCloseAction(contentEl: HTMLElement): void {
		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: ui('关闭', 'Close'), cls: 'mod-cta' }).addEventListener('click', () => this.close());
	}

	onClose(): void {
		super.onClose();
	}
}

class TracekeeperSourceStatusView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_SOURCE_STATUS_VIEW;
	}

	getDisplayText() {
		return ui('来源状态', 'Source status');
	}

	getViewData() {
		return '';
	}

	setViewData(_data: string, _clear: boolean): void {
		return;
	}

	clear(): void {
		this.contentEl.empty();
	}

	async onOpen() {
		await super.onOpen();
		await this.refresh();
	}

	private async render(snapshot: SourceAnalysisSnapshot): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		contentEl.createEl('h2', { text: ui('来源状态', 'Source status'), cls: 'tracekeeper-view__title' });

		const header = contentEl.createDiv({ cls: 'tracekeeper-view__section' });
		header.createEl('div', {
			text: `${ui('最后刷新', 'Last refreshed')}: ${this.plugin.formatDisplayTime(
				Date.parse(snapshot.updatedAt)
			)}`,
			cls: 'tracekeeper-view__description',
		});
		const actions = header.createDiv();
		const refreshButton = actions.createEl('button', {
			text: ui('刷新', 'Refresh'),
			cls: 'mod-cta',
		});
		refreshButton.addEventListener('click', () => {
			void (async () => {
				refreshButton.disabled = true;
				refreshButton.setText(ui('刷新中...', 'Refreshing...'));
				try {
					await this.refresh();
					new Notice(ui('来源状态已刷新。', 'Source status refreshed.'));
				} catch (error) {
					console.error('tracekeeper failed to refresh source status view', error);
					refreshButton.disabled = false;
					refreshButton.setText(ui('刷新', 'Refresh'));
					new Notice(ui('刷新来源状态失败。', 'Failed to refresh source status.'));
				}
			})();
		});

		if (snapshot.missingRequestFolder) {
			contentEl.createEl('p', {
				text: ui(
					'还没有来源请求记录。初始化知识库后，AI 助手提交的资料处理请求会显示在这里。',
					'No source request records yet. After Tracekeeper is initialized, material processing requests from your AI assistant will appear here.'
				),
				cls: 'tracekeeper-view__description',
			});
			return;
		}

		if (snapshot.requests.length === 0) {
			contentEl.createEl('p', {
				text: ui(
					'当前没有资料请求。',
					'No material requests yet.'
				),
				cls: 'tracekeeper-view__description',
			});
			return;
		}

		const list = contentEl.createEl('ul', { cls: 'tracekeeper-view__list' });
		for (const request of snapshot.requests) {
			const item = list.createEl('li', { cls: 'tracekeeper-view__item' });
			item.createEl('div', {
				text: `${this.plugin.formatDisplayTime(request.sortTimestamp)} • ${request.sourceKind} • ${request.status}`,
			});
			if (request.source) {
				item.createEl('div', { text: `${ui('来源', 'Source')}: ${this.plugin.trimText(request.source, 120)}` });
			}
			if (request.purpose) {
				item.createEl('div', { text: `${ui('用途', 'Purpose')}: ${request.purpose}` });
			}
			if (request.analysisMode) {
				item.createEl('div', { text: `${ui('分析模式', 'Analysis mode')}: ${request.analysisMode}` });
			}
			if (request.relatedProject) {
				item.createEl('div', { text: `${ui('关联项目', 'Related project')}: ${request.relatedProject}` });
			}
			if (request.summary) {
				item.createEl('div', { text: this.plugin.trimText(request.summary, 140) });
			}
			item.createEl('small', { text: `${ui('文件', 'File')}: ${request.path}` });
			if (this.isPendingRequest(request.status)) {
				const actionRow = item.createDiv({ cls: 'tracekeeper-action-row' });
				const processButton = actionRow.createEl('button', {
					text: ui('处理资料请求', 'Process request'),
					cls: 'mod-cta',
				});
				processButton.addEventListener('click', () => {
					void (async () => {
						processButton.disabled = true;
						processButton.setText(ui('处理中...', 'Processing...'));
						try {
							await this.plugin.processSourceRequest(request);
							new Notice(ui('资料请求已处理。', 'Source request processed.'));
							await this.refresh();
						} catch (error) {
							console.error('tracekeeper failed to process source request', error);
							new Notice(ui('处理资料请求失败。', 'Failed to process source request.'));
						} finally {
							processButton.disabled = false;
							processButton.setText(ui('处理资料请求', 'Process request'));
						}
					})();
				});
			}
		}
	}

	private isPendingRequest(status: string): boolean {
		const normalized = status.toLowerCase().trim();
		return !normalized || normalized === 'pending' || normalized === 'queued' || normalized === 'todo';
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadSourceStatusSnapshot();
		await this.render(snapshot);
	}
}

class TracekeeperActivityView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_ACTIVITY_VIEW;
	}

	getDisplayText() {
		return pluginDisplayName();
	}

	getViewData() {
		return '';
	}

	setViewData(data: string, _clear: boolean): void {
		return;
	}

	clear(): void {
		this.contentEl.empty();
	}

	async onOpen() {
		await super.onOpen();
		await this.refresh();
	}

	private async render(snapshot: AgentActivitySnapshot): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		const heading = header.createDiv();
		heading.createEl('h2', { text: ui('AI 助手活动', 'AI assistant activity'), cls: 'tracekeeper-view__title' });
		const actions = header.createDiv({ cls: 'tracekeeper-action-row' });
		const refreshButton = actions.createEl('button', {
			text: ui('刷新', 'Refresh'),
			cls: 'mod-cta',
		});
		refreshButton.addEventListener('click', () => {
			void (async () => {
				refreshButton.disabled = true;
				refreshButton.setText(ui('刷新中...', 'Refreshing...'));
				try {
					await this.refresh();
					new Notice(ui('活动记录已刷新。', 'Activity refreshed.'));
				} catch (error) {
					console.error('tracekeeper failed to refresh activity view', error);
					refreshButton.disabled = false;
					refreshButton.setText(ui('刷新', 'Refresh'));
					new Notice(ui('刷新活动记录失败。', 'Failed to refresh activity.'));
				}
			})();
		});
		if (snapshot.structureStatus.state !== 'initialized') {
			const initializeButton = actions.createEl('button', {
				text: ui('校验知识库结构', 'Check structure'),
			});
			initializeButton.addEventListener('click', () => {
				void this.plugin.openInitializeMemoryStructureModal();
			});
		}
		const reviewButton = actions.createEl('button', {
			text: ui('打开审核列表', 'Open review list'),
		});
		reviewButton.addEventListener('click', () => {
			void this.plugin.openPluginView(TRACEKEEPER_REVIEW_QUEUE_VIEW);
		});
		const statusBar = contentEl.createDiv({ cls: 'tracekeeper-status-bar' });
		this.renderStatusItem(
			statusBar,
			ui('MCP 服务', 'MCP service'),
			snapshot.runtimeStatus.label,
			this.runtimeStatusClass(snapshot.runtimeStatus)
		);
		this.renderStatusItem(statusBar, ui('当前仓库', 'Current repository'), this.formatVaultLabel(snapshot.vaultRoot));
		this.renderStatusItem(statusBar, ui('刷新时间', 'Last refreshed'), this.plugin.formatDisplayTime(Date.parse(snapshot.updatedAt)));

		const metrics = contentEl.createDiv({ cls: 'tracekeeper-metric-grid' });
		this.renderMetricCard(metrics, ui('待审核', 'Pending review'), String(snapshot.recentProposals.filter((proposal) => proposal.approvalStatus === 'pending').length), ui('需要你确认的记忆更新', 'Memory updates waiting for your review'));
		this.renderMetricCard(metrics, ui('最近连接', 'Recent connections'), String(snapshot.recentAgentCount), ui('最近出现的 AI 工具', 'Recently seen AI tools'));
		this.renderMetricCard(metrics, ui('工具使用', 'Tool usage'), String(snapshot.recentToolCallCount), ui('最近连接操作记录', 'Recent connection activity'));

		this.renderMemoryLoopSection(contentEl, snapshot);

		const currentSection = contentEl.createDiv({ cls: 'tracekeeper-card' });
		currentSection.createEl('h3', { text: ui('最后一次执行的任务', 'Last task') });
		if (!snapshot.latestTask) {
			this.renderEmptyState(
				currentSection,
				ui('还没有任务记录。', 'No task records yet.'),
				ui('AI 助手执行任务后会显示在这里。', 'Tasks appear here after your AI assistant runs.')
			);
		} else {
			this.renderTaskEntry(currentSection, snapshot.latestTask, true);
		}

		const timeline = contentEl.createDiv({ cls: 'tracekeeper-card' });
		const timelineHeader = timeline.createDiv({ cls: 'tracekeeper-card__header' });
		timelineHeader.createEl('h3', { text: ui('运行日志', 'Runtime log') });
		const viewAllButton = timelineHeader.createEl('button', {
			text: ui('更多', 'More'),
		});
		viewAllButton.addEventListener('click', () => {
			void this.plugin.openPluginView(TRACEKEEPER_RUNTIME_LOG_VIEW);
		});
		const timelineItems = snapshot.timelineItems;
		if (timelineItems.length === 0) {
			this.renderEmptyState(
				timeline,
				ui('还没有可展示的活动。', 'No activity to display yet.'),
				ui('从 AI 助手开始一次任务后，这里会按时间显示任务、来源、审核和写回记录。', 'Start a task from your AI assistant to show task, source, review, and writeback records here over time.')
			);
		} else {
			const list = timeline.createDiv({ cls: 'tracekeeper-timeline' });
			for (const item of timelineItems) {
				this.plugin.renderTimelineItem(list, item);
			}
		}
	}

	private renderMemoryLoopSection(container: HTMLElement, snapshot: AgentActivitySnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card tracekeeper-memory-loop-card' });
		const header = card.createDiv({ cls: 'tracekeeper-card__header' });
		header.createEl('h3', { text: ui('记忆闭环', 'Memory loop') });
		const actions = header.createDiv({ cls: 'tracekeeper-action-row' });
		const recallButton = actions.createEl('button', { text: ui('测试召回', 'Test recall') });
		recallButton.addEventListener('click', () => {
			new MemoryRecallPreviewModal(this.app, this.plugin).open();
		});
		const reviewButton = actions.createEl('button', { text: ui('处理审核', 'Review items') });
		reviewButton.addEventListener('click', () => {
			void this.plugin.openPluginView(TRACEKEEPER_REVIEW_QUEUE_VIEW);
		});

		const pendingCount = snapshot.recentProposals.filter((proposal) => proposal.approvalStatus === 'pending').length;
		const latestProposal = snapshot.recentProposals[0] ?? null;
		const latestRecall = this.latestRecallEvent(snapshot.recentAuditEvents);
		const details = card.createDiv({ cls: 'tracekeeper-detail-grid tracekeeper-memory-loop-grid' });
		this.renderMemoryLoopDetail(details, ui('待审核记忆', 'Pending memories'), String(pendingCount));
		this.renderMemoryLoopDetail(
			details,
			ui('最近记忆提案', 'Latest proposal'),
			latestProposal
				? `${latestProposal.proposalKind} • ${this.plugin.formatDisplayTime(latestProposal.sortTimestamp)}`
				: ui('暂无', 'None')
		);
		this.renderMemoryLoopDetail(
			details,
			ui('最后一次任务', 'Last task'),
			snapshot.latestTask
				? this.plugin.trimText(snapshot.latestTask.objective || snapshot.latestTask.taskId, 80)
				: ui('暂无', 'None')
		);
		this.renderMemoryLoopDetail(
			details,
			ui('最近召回', 'Latest recall'),
			latestRecall
				? `${this.plugin.formatToolDisplayName(latestRecall.toolName)} • ${this.plugin.formatDisplayTime(latestRecall.sortTimestamp)}`
				: ui('暂无', 'None')
		);
	}

	private renderMemoryLoopDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value || ui('暂无', 'None') });
	}

	private latestRecallEvent(events: AuditEventRecord[]): AuditEventRecord | null {
		return events.find((event) => {
			const tool = event.toolName || event.action;
			return tool === 'tracekeeper.recall' || tool === 'tracekeeper.project_context' || tool === 'tracekeeper.project_history';
		}) ?? null;
	}

	private renderStatusItem(container: HTMLElement, label: string, value: string, className = ''): void {
		const item = container.createDiv({
			cls: ['tracekeeper-status-pill', className].filter(Boolean).join(' '),
		});
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}

	private runtimeStatusClass(status: RuntimeViewStatus): string {
		if (!status.enabled) {
			return 'tracekeeper-status-pill--runtime tracekeeper-status-pill--disabled';
		}
		switch (status.state) {
			case 'running':
				return 'tracekeeper-status-pill--runtime tracekeeper-status-pill--success';
			case 'starting':
				return 'tracekeeper-status-pill--runtime tracekeeper-status-pill--warning';
			case 'port_conflict':
			case 'failed':
				return 'tracekeeper-status-pill--runtime tracekeeper-status-pill--danger';
			case 'stopped':
			default:
				return 'tracekeeper-status-pill--runtime';
		}
	}

	private renderMetricCard(container: HTMLElement, label: string, value: string, detail: string): void {
		const card = container.createDiv({ cls: 'tracekeeper-metric-card' });
		card.createEl('div', { text: label, cls: 'tracekeeper-metric-card__label' });
		card.createEl('strong', { text: value, cls: 'tracekeeper-metric-card__value' });
		card.createEl('div', { text: detail, cls: 'tracekeeper-view__description' });
	}

	private formatVaultLabel(vaultRoot: string): string {
		const normalized = vaultRoot.replace(/\\/g, '/').replace(/\/+$/g, '');
		return normalized.split('/').pop() || vaultRoot || ui('未知', 'Unknown');
	}

	private renderEmptyState(container: HTMLElement, title: string, detail: string): void {
		const empty = container.createDiv({ cls: 'tracekeeper-empty-state' });
		empty.createEl('strong', { text: title });
		empty.createEl('p', { text: detail });
	}

	private renderTaskEntry(container: HTMLElement, task: AgentTaskRecord, expanded: boolean): void {
		const item = container.createDiv({ cls: 'tracekeeper-task-card tracekeeper-task-card--latest' });
		const header = item.createDiv({ cls: 'tracekeeper-task-card__header' });
		const title = header.createDiv({ cls: 'tracekeeper-task-card__title' });
		title.createEl('h4', { text: task.objective || task.taskId || ui('未命名任务', 'Untitled task') });
		const badges = header.createDiv({ cls: 'tracekeeper-badge-row tracekeeper-task-card__badges' });
		badges.createEl('span', { text: task.status || ui('未知', 'Unknown'), cls: `tracekeeper-badge ${this.taskStatusClass(task.status)}` });
		const agentLabel = this.readableAgentLabel(task.agent);
		if (agentLabel) {
			badges.createEl('span', { text: agentLabel, cls: 'tracekeeper-badge tracekeeper-badge--muted' });
		}

		const focus = item.createDiv({ cls: 'tracekeeper-task-card__focus' });
		this.renderTaskInfoItem(focus, this.taskTimeLabel(task), this.formatTaskPrimaryTime(task));
		this.renderTaskInfoItem(focus, ui('项目', 'Project'), task.relatedProject || ui('未关联', 'Not linked'));
		this.renderTaskInfoItem(focus, ui('任务记录', 'Task record'), task.taskId || ui('未知', 'Unknown'));
		if (task.contextPack) {
			this.renderTaskInfoItem(focus, ui('召回上下文', 'Recall context'), this.formatPathBasename(task.contextPack));
		}
		if (expanded) {
			const changes = item.createDiv({ cls: 'tracekeeper-task-card__changes' });
			changes.createEl('span', { text: ui('本次变化', 'Changes') });
			const chips = changes.createDiv({ cls: 'tracekeeper-task-card__chips' });
			const changeItems = this.taskChangeItems(task);
			if (changeItems.length === 0) {
				chips.createEl('span', {
					text: ui('没有产生记忆或资料变化', 'No memory or source changes'),
					cls: 'tracekeeper-task-card__change-note',
				});
			} else {
				for (const change of changeItems) {
					const chip = chips.createEl('span', { cls: 'tracekeeper-task-card__change-chip' });
					chip.createEl('strong', { text: String(change.value) });
					chip.createEl('span', { text: change.label });
				}
			}
		}

		const footer = item.createDiv({ cls: 'tracekeeper-task-card__footer' });
		const path = footer.createDiv({ cls: 'tracekeeper-task-card__path' });
		path.createEl('span', { text: ui('保存位置', 'Saved in') });
		path.createEl('code', { text: task.path || ui('未知', 'Unknown') });
		if (task.path) {
			const openButton = footer.createEl('button', { text: ui('打开记录', 'Open record') });
			openButton.addEventListener('click', () => {
				void this.openTaskRecord(task.path);
			});
		}

		const normalizedSnippet = task.snippet.trim();
		if (normalizedSnippet && normalizedSnippet !== task.objective.trim()) {
			const summary = item.createDiv({ cls: 'tracekeeper-task-card__summary' });
			summary.createEl('span', { text: ui('摘要', 'Summary') });
			summary.createEl('p', { text: this.plugin.trimText(normalizedSnippet, 180) });
		}
	}

	private renderTaskInfoItem(container: HTMLElement, label: string, value: string): void {
		const field = container.createDiv({ cls: 'tracekeeper-task-card__info' });
		field.createEl('span', { text: label });
		field.createEl('strong', { text: value || ui('未知', 'Unknown') });
	}

	private taskChangeItems(task: AgentTaskRecord): Array<{ label: string; value: number }> {
		return [
			{ label: ui('读取记忆', 'Memory reads'), value: task.memoryReads.length },
			{ label: ui('写入记录', 'Writes'), value: task.memoryWrites.length },
			{ label: ui('捕获资料', 'Source captures'), value: task.sourceCaptures.length },
			{ label: ui('记忆提案', 'Memory proposals'), value: task.proposals.length },
		].filter((item) => item.value > 0);
	}

	private taskTimeLabel(task: AgentTaskRecord): string {
		const normalized = task.status.toLowerCase().trim();
		if ((normalized === 'completed' || normalized === 'done' || normalized === 'success') && task.finishedAt) {
			return ui('完成时间', 'Finished');
		}
		if ((normalized === 'active' || normalized === 'running') && task.startedAt) {
			return ui('开始时间', 'Started');
		}
		return ui('执行时间', 'Run time');
	}

	private formatTaskPrimaryTime(task: AgentTaskRecord): string {
		const normalized = task.status.toLowerCase().trim();
		if ((normalized === 'completed' || normalized === 'done' || normalized === 'success') && task.finishedAt) {
			return this.formatTaskTime(task.finishedAt);
		}
		if ((normalized === 'active' || normalized === 'running') && task.startedAt) {
			return this.formatTaskTime(task.startedAt);
		}
		return this.plugin.formatDisplayTime(task.sortTimestamp);
	}

	private formatPathBasename(path: string): string {
		const normalized = path.replace(/\\/g, '/');
		return normalized.split('/').pop()?.replace(/\.md$/i, '') || path;
	}

	private readableAgentLabel(agent: string): string {
		const normalized = agent.trim();
		if (!normalized || normalized.toLowerCase() === 'unknown' || this.isOpaqueIdentifier(normalized)) {
			return '';
		}
		return this.plugin.trimText(normalized, 36);
	}

	private isOpaqueIdentifier(value: string): boolean {
		const compact = value.replace(/-/g, '');
		return compact.length >= 24 && /^[a-f0-9]+$/i.test(compact);
	}

	private async openTaskRecord(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(ui('没有找到任务记录文件。', 'Task record file was not found.'));
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	private formatTaskTime(value: string): string {
		if (!value) {
			return ui('未记录', 'Not recorded');
		}
		const timestamp = Date.parse(value);
		return Number.isFinite(timestamp) ? this.plugin.formatDisplayTime(timestamp) : value;
	}

	private taskStatusClass(status: string): string {
		const normalized = status.toLowerCase().trim();
		if (normalized === 'active' || normalized === 'running') {
			return 'tracekeeper-badge--warning';
		}
		if (normalized === 'completed' || normalized === 'done' || normalized === 'success') {
			return 'tracekeeper-badge--success';
		}
		if (normalized === 'failed' || normalized === 'error') {
			return 'tracekeeper-badge--error';
		}
		return 'tracekeeper-badge--muted';
	}

	private isSourceRequestPending(status: string): boolean {
		const normalized = status.toLowerCase().trim();
		return !normalized || normalized === 'pending' || normalized === 'queued' || normalized === 'todo';
	}

	private renderTaskSummary(container: HTMLElement, task: AgentTaskRecord): void {
		const compact = container.createEl('div', {
			text: `${task.taskId} • ${this.plugin.formatDisplayTime(task.sortTimestamp)} • ${task.status}`,
			cls: 'tracekeeper-view__item',
		});
		if (task.objective) {
			compact.createEl('div', { text: task.objective });
		}
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadAgentActivitySnapshot();
		await this.render(snapshot);
	}
}

class TracekeeperReviewQueueView extends ItemView {
	private activeFilter: MemoryProposalStatus | 'all' = 'pending';

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_REVIEW_QUEUE_VIEW;
	}

	getDisplayText() {
		return ui('审核队列', 'Review queue');
	}

	getViewData() {
		return '';
	}

	setViewData(_data: string, _clear: boolean): void {
		return;
	}

	clear(): void {
		this.contentEl.empty();
	}

	async onOpen() {
		await super.onOpen();
		await this.refresh();
	}

	private async render(snapshot: MemoryReviewQueueSnapshot): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		const heading = header.createDiv();
		heading.createEl('h2', { text: ui('审核队列', 'Review queue'), cls: 'tracekeeper-view__title' });
		heading.createEl('p', {
			text: `${ui('最后刷新', 'Last refreshed')}: ${this.plugin.formatDisplayTime(Date.parse(snapshot.updatedAt))}`,
			cls: 'tracekeeper-view__description',
		});

		const actions = header.createDiv({ cls: 'tracekeeper-action-row' });
		const refreshButton = actions.createEl('button', {
			text: ui('刷新', 'Refresh'),
			cls: 'mod-cta',
		});
		refreshButton.addEventListener('click', () => {
			void (async () => {
				refreshButton.disabled = true;
				refreshButton.setText(ui('刷新中...', 'Refreshing...'));
				try {
					await this.refresh();
					new Notice(ui('审核队列已刷新。', 'Review queue refreshed.'));
				} catch (error) {
					console.error('tracekeeper failed to refresh review queue view', error);
					refreshButton.disabled = false;
					refreshButton.setText(ui('刷新', 'Refresh'));
					new Notice(ui('刷新审核队列失败。', 'Failed to refresh review queue.'));
				}
			})();
		});

		if (snapshot.missingReviewQueueFolder) {
			contentEl.createEl('p', {
				text: ui(
					'还没有审核队列。请先初始化知识库文件结构，之后 AI 助手提出的记忆更新会出现在这里。',
					'No review queue yet. Initialize the Tracekeeper file structure first; proposed memory updates will appear here afterward.'
				),
				cls: 'tracekeeper-view__description',
			});
			return;
		}

		if (snapshot.proposals.length === 0) {
			this.renderEmptyState(
				contentEl,
				ui('还没有待审核的记忆更新。', 'No memory updates waiting for review yet.'),
				ui(
					'审核队列只显示需要你确认的提案。建议模式只返回候选内容，不会写入队列；项目记忆如果设置为自动保存，也不会出现在这里。',
					'The review queue only shows proposals that need your confirmation. Suggest mode only returns candidates and does not write queue files; project memory set to auto-save will not appear here.'
				)
			);
			return;
		}

		const counts = this.countByStatus(snapshot.proposals);
		const tabs = contentEl.createDiv({ cls: 'tracekeeper-filter-tabs' });
		for (const filter of REVIEW_QUEUE_FILTERS) {
			const label = filter === 'all' ? ui('全部', 'All') : memoryProposalStatusLabel(filter);
			const count = filter === 'all' ? snapshot.proposals.length : counts[filter] || 0;
			const button = tabs.createEl('button', {
				text: `${label} (${count})`,
				cls: this.activeFilter === filter ? 'is-active' : '',
			});
			button.addEventListener('click', () => {
				this.activeFilter = filter;
				void this.render(snapshot);
			});
		}

		const visibleProposals = snapshot.proposals.filter((proposal) =>
			this.activeFilter === 'all' ? true : proposal.approvalStatus === this.activeFilter
		);
		this.renderBatchActions(contentEl, visibleProposals, snapshot.proposals);
		const grid = contentEl.createDiv({ cls: 'tracekeeper-proposal-grid' });
		if (visibleProposals.length === 0) {
			this.renderEmptyState(
				grid,
				ui('当前筛选下没有内容。', 'No items match this filter.'),
				ui('切换筛选，或等待 AI 助手提出新的记忆更新。', 'Switch filters or wait for your AI assistant to propose a new memory update.')
			);
			return;
		}

		for (const group of this.groupProposalWorkbenchItems(visibleProposals)) {
			const section = grid.createDiv({ cls: 'tracekeeper-proposal-group' });
			const groupHeader = section.createDiv({ cls: 'tracekeeper-proposal-group__header' });
			groupHeader.createEl('strong', { text: group.label });
			groupHeader.createEl('span', { text: ui(`${group.items.length} 条`, `${group.items.length} items`), cls: 'tracekeeper-badge tracekeeper-badge--muted' });
			for (const proposal of group.items) {
				this.renderProposalCard(section, proposal);
			}
		}
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadMemoryReviewQueueSnapshot();
		await this.render(snapshot);
	}

	private groupByStatus(proposals: MemoryProposalRecord[]): Record<string, MemoryProposalRecord[]> {
		const grouped: Record<string, MemoryProposalRecord[]> = {};
		for (const proposal of proposals) {
			const status = proposal.approvalStatus || 'pending';
			if (!grouped[status]) {
				grouped[status] = [];
			}
			grouped[status].push(proposal);
		}
		return grouped;
	}

	private countByStatus(proposals: MemoryProposalRecord[]): Record<MemoryProposalStatus, number> {
		const counts: Record<MemoryProposalStatus, number> = {
			pending: 0,
			approved: 0,
			rejected: 0,
			deferred: 0,
			revision_requested: 0,
			applied: 0,
		};
		for (const proposal of proposals) {
			counts[proposal.approvalStatus] += 1;
		}
		return counts;
	}

	private renderBatchActions(container: HTMLElement, visibleProposals: MemoryProposalRecord[], allProposals: MemoryProposalRecord[]): void {
		const pending = visibleProposals.filter((proposal) => proposal.approvalStatus === 'pending');
		const processed = allProposals.filter((proposal) =>
			proposal.approvalStatus !== 'pending' && proposal.approvalStatus !== 'approved'
		);
		if (pending.length === 0 && processed.length === 0) {
			return;
		}
		const toolbar = container.createDiv({ cls: 'tracekeeper-batch-toolbar' });
		if (pending.length > 0) {
			const reject = toolbar.createEl('button', {
				text: ui(`批量拒绝 (${pending.length})`, `Reject visible (${pending.length})`),
				cls: 'mod-warning',
			});
			reject.addEventListener('click', () => {
				void this.batchUpdate(pending, 'rejected');
			});
			const defer = toolbar.createEl('button', {
				text: ui(`批量暂缓 (${pending.length})`, `Defer visible (${pending.length})`),
			});
			defer.addEventListener('click', () => {
				void this.batchUpdate(pending, 'deferred');
			});
		}
		if (processed.length > 0) {
			const archive = toolbar.createEl('button', {
				text: ui(`归档已处理 (${processed.length})`, `Archive processed (${processed.length})`),
			});
			archive.addEventListener('click', () => {
				void this.batchArchive(processed);
			});
		}
	}

	private groupProposalWorkbenchItems(proposals: MemoryProposalRecord[]): Array<{ label: string; items: MemoryProposalRecord[] }> {
		const groups = new Map<string, MemoryProposalRecord[]>();
		for (const proposal of proposals) {
			const label = [
				memoryProposalStatusLabel(proposal.approvalStatus),
				proposal.relatedProject || ui('未关联项目', 'No project'),
				proposal.taskId ? `${ui('任务', 'Task')} ${proposal.taskId}` : ui('无任务', 'No task'),
				proposal.proposalKind || ui('未分类', 'Uncategorized'),
			].join(' · ');
			const items = groups.get(label) || [];
			items.push(proposal);
			groups.set(label, items);
		}
		return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
	}

	private async batchUpdate(proposals: MemoryProposalRecord[], status: MemoryProposalStatus): Promise<void> {
		try {
			for (const proposal of proposals) {
				await this.plugin.updateMemoryProposalStatus(proposal, status);
			}
			new Notice(ui(
				`已更新 ${proposals.length} 条审核项。`,
				`Updated ${proposals.length} review items.`
			));
			await this.refresh();
		} catch (error) {
			console.error('tracekeeper failed to batch update proposals', error);
			new Notice(ui('批量更新失败。', 'Batch update failed.'));
		}
	}

	private async batchArchive(proposals: MemoryProposalRecord[]): Promise<void> {
		try {
			const moved = await this.plugin.archiveMemoryProposals(proposals);
			new Notice(ui(`已归档 ${moved} 条审核项。`, `Archived ${moved} review items.`));
			await this.refresh();
		} catch (error) {
			console.error('tracekeeper failed to archive proposals', error);
			new Notice(ui('归档审核项失败。', 'Failed to archive review items.'));
		}
	}

	private renderProposalCard(container: HTMLElement, proposal: MemoryProposalRecord): void {
		const card = container.createDiv({ cls: 'tracekeeper-card tracekeeper-proposal-card' });
		const header = card.createDiv({ cls: 'tracekeeper-card__header' });
		header.createEl('strong', { text: proposal.proposalId || ui('未命名记忆更新', 'Untitled memory update') });
		const badges = header.createDiv({ cls: 'tracekeeper-badge-row' });
		badges.createEl('span', { text: proposal.proposalKind, cls: 'tracekeeper-badge' });
		badges.createEl('span', { text: this.plugin.formatRiskLabel(proposal.riskLevel), cls: `tracekeeper-badge tracekeeper-badge--risk-${proposal.riskLevel.toLowerCase()}` });
		badges.createEl('span', { text: memoryProposalStatusLabel(proposal.approvalStatus), cls: 'tracekeeper-badge' });

		const facts = card.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(facts, ui('项目', 'Project'), proposal.relatedProject || ui('未关联', 'Not linked'));
		this.renderDetail(facts, ui('目标笔记', 'Target note'), proposal.targetNote || ui('未指定', 'Not specified'));
		this.renderDetail(facts, ui('任务', 'Task'), proposal.taskId || ui('无', 'None'));
		this.renderDetail(facts, ui('证据摘要', 'Evidence'), proposal.evidence.length ? this.plugin.trimText(proposal.evidence.join(', '), 120) : ui('无', 'None'));
		this.renderDetail(facts, ui('创建时间', 'Created'), proposal.created || ui('未知', 'Unknown'));
		this.renderDetail(facts, ui('提出来源', 'Proposed by'), proposal.proposedBy || 'unknown');
		if (proposal.snippet) {
			card.createEl('p', { text: this.plugin.trimText(proposal.snippet, 180), cls: 'tracekeeper-view__description' });
		}
		card.createEl('small', { text: `${ui('文件', 'File')}: ${proposal.path}` });

		if (proposal.evidence.length > 0) {
			const detailPanel = card.createDiv({ cls: 'tracekeeper-detail-panel' });
			detailPanel.createEl('strong', { text: ui('证据引用', 'Evidence refs') });
			detailPanel.createEl('div', { text: proposal.evidence.join(', ') });
		}

		this.renderProposalActions(card, proposal);
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}

	private renderProposalActions(card: HTMLElement, proposal: MemoryProposalRecord): void {
		if (proposal.approvalStatus === 'pending') {
			const actionRow = card.createDiv({ cls: 'tracekeeper-action-row' });
			const approve = actionRow.createEl('button', {
				text: ui('批准', 'Approve'),
				cls: 'mod-cta',
			});
			const reject = actionRow.createEl('button', {
				text: ui('拒绝', 'Reject'),
				cls: 'mod-warning',
			});
			const defer = actionRow.createEl('button', {
				text: ui('暂缓', 'Defer'),
			});
			const requestRevision = actionRow.createEl('button', {
				text: ui('要求修订', 'Request revision'),
			});

			const actionButtons = [approve, reject, defer, requestRevision];
			const updateStatus = async (status: MemoryProposalStatus) => {
				for (const button of actionButtons) {
					button.setAttribute('disabled', 'true');
				}
				try {
					await this.plugin.updateMemoryProposalStatus(proposal, status);
					new Notice(ui(
						`已更新为：${memoryProposalStatusLabel(status)}。`,
						`Updated to ${memoryProposalStatusLabel(status)}.`
					));
					await this.refresh();
				} catch (error) {
					console.error('tracekeeper failed to update proposal status', error);
					new Notice(ui('更新审核状态失败。', 'Failed to update review status.'));
				} finally {
					for (const button of actionButtons) {
						button.removeAttribute('disabled');
					}
				}
			};

			approve.addEventListener('click', () => void updateStatus('approved'));
			reject.addEventListener('click', () => void updateStatus('rejected'));
			defer.addEventListener('click', () => void updateStatus('deferred'));
			requestRevision.addEventListener('click', () => void updateStatus('revision_requested'));
		} else if (proposal.approvalStatus === 'approved') {
			const actionRow = card.createDiv({ cls: 'tracekeeper-action-row' });
			const apply = actionRow.createEl('button', {
				text: ui('应用已批准写回', 'Apply approved writeback'),
				cls: 'mod-cta',
			});
			apply.addEventListener('click', () => {
				new ApprovedWritebackApplyModal(this.app, this.plugin, proposal, () => {
					void this.refresh();
				}).open();
			});
		}
	}

	private renderEmptyState(container: HTMLElement, title: string, detail: string): void {
		const empty = container.createDiv({ cls: 'tracekeeper-empty-state' });
		empty.createEl('strong', { text: title });
		empty.createEl('p', { text: detail });
	}
}

class MemoryRecallPreviewModal extends Modal {
	private query = '';
	private projectHint = '';
	private recallScope: TracekeeperRecallScope = 'project';
	private resultsContainer: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin
	) {
		super(app);
	}

	onOpen(): void {
		void super.onOpen();
		this.titleEl.setText(ui('测试召回', 'Test recall'));
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-recall-modal');
		contentEl.createEl('p', {
			text: ui(
				'输入当前任务关键词，查看 Agent 可能读取到哪些记忆。',
				'Enter task keywords to see which memories an agent may read.'
			),
			cls: 'tracekeeper-view__description',
		});

		new Setting(contentEl)
			.setName(ui('召回范围', 'Recall scope'))
			.setDesc(ui('项目历史可不填关键词，用于查看最近连续性记录。', 'Project history can run without a query to show recent continuity records.'))
			.addDropdown((dropdown) => {
				for (const scope of MEMORY_RECALL_SCOPES) {
					dropdown.addOption(scope, this.plugin.memoryRecallScopeLabel(scope));
				}
				dropdown.setValue(this.recallScope).onChange((value) => {
					this.recallScope = this.plugin.normalizeMemoryRecallScope(value);
				});
			});

		new Setting(contentEl)
			.setName(ui('关键词', 'Query'))
			.setDesc(ui('例如项目名、功能名、决策或问题。', 'For example a project, feature, decision, or issue.'))
			.addText((text) => {
				text.setPlaceholder(ui('输入检索文本', 'Enter query'));
				text.setValue(this.query);
				text.onChange((value) => {
					this.query = value;
				});
			});

		new Setting(contentEl)
			.setName(ui('项目或仓库', 'Project or repository'))
			.setDesc(ui('可选。用于限定项目记忆和项目历史。', 'Optional. Narrows project memory and project history.'))
			.addText((text) => {
				text.setPlaceholder(ui('例如 obsidian-tracekeeper', 'For example obsidian-tracekeeper'));
				text.setValue(this.projectHint);
				text.onChange((value) => {
					this.projectHint = value;
				});
			});

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const runButton = actions.createEl('button', { text: ui('查看召回结果', 'Preview recall'), cls: 'mod-cta' });
		runButton.addEventListener('click', () => {
			void this.run(runButton);
		});
		const closeButton = actions.createEl('button', { text: ui('关闭', 'Close') });
		closeButton.addEventListener('click', () => this.close());
		this.statusEl = contentEl.createDiv({ cls: 'tracekeeper-view__description' });
		this.resultsContainer = contentEl.createDiv({ cls: 'tracekeeper-recall-results' });
	}

	private async run(button: HTMLButtonElement): Promise<void> {
		if (!this.resultsContainer || !this.statusEl) {
			return;
		}
		button.disabled = true;
		button.setText(ui('检索中...', 'Searching...'));
		this.statusEl.setText('');
		this.resultsContainer.empty();
		try {
			const result = await this.plugin.runMemoryRecall({
				query: this.query,
				scope: this.recallScope,
				projectHint: this.projectHint,
			});
			this.renderResults(result);
		} catch (error) {
			console.error('tracekeeper recall preview failed', error);
			this.statusEl.setText(error instanceof Error ? error.message : String(error));
		} finally {
			button.disabled = false;
			button.setText(ui('查看召回结果', 'Preview recall'));
		}
	}

	private renderResults(result: MemoryRecallResult): void {
		if (!this.resultsContainer || !this.statusEl) {
			return;
		}
		this.resultsContainer.empty();
		this.statusEl.setText(ui(
			`共 ${result.items.length} 条结果 · ${this.plugin.memoryRecallScopeLabel(result.scope)}`,
			`${result.items.length} results · ${this.plugin.memoryRecallScopeLabel(result.scope)}`
		));
		if (result.items.length === 0) {
			const empty = this.resultsContainer.createDiv({ cls: 'tracekeeper-empty-state' });
			empty.createEl('strong', { text: ui('没有匹配结果', 'No matches') });
			empty.createEl('p', { text: ui('可以换一个关键词，或补充项目/仓库信息后再试。', 'Try another query, or add project/repository context.') });
			return;
		}
		for (const item of result.items) {
			const card = this.resultsContainer.createDiv({ cls: 'tracekeeper-card tracekeeper-recall-result-card' });
			const header = card.createDiv({ cls: 'tracekeeper-card__header' });
			header.createEl('strong', { text: item.title || item.path });
			const badges = header.createDiv({ cls: 'tracekeeper-badge-row' });
			badges.createEl('span', { text: item.scope, cls: 'tracekeeper-badge' });
			badges.createEl('span', { text: `${ui('分数', 'Score')} ${item.score}`, cls: 'tracekeeper-badge tracekeeper-badge--muted' });
			const details = card.createDiv({ cls: 'tracekeeper-detail-grid' });
			this.renderDetail(details, ui('路径', 'Path'), item.path || ui('未知', 'Unknown'));
			this.renderDetail(details, ui('类型', 'Type'), item.type || ui('笔记', 'Note'));
			this.renderDetail(details, ui('命中词', 'Matched tokens'), item.matchedTokens.length ? item.matchedTokens.join(', ') : ui('无', 'None'));
			this.renderDetail(details, ui('原因', 'Reason'), item.reason);
		}
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail tracekeeper-detail--description' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value || ui('未知', 'Unknown') });
	}
}

class ApprovedWritebackApplyModal extends Modal {
	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private proposal: MemoryProposalRecord,
		private onApplied: () => void
	) {
		super(app);
	}

	onOpen(): void {
		void super.onOpen();
		this.titleEl.setText(ui('应用已批准写回', 'Apply approved writeback'));
		void this.renderPreview();
	}

	private async renderPreview(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', {
			text: ui('正在生成写回预览...', 'Generating writeback preview...'),
		});
		try {
			const preview = await this.plugin.previewApprovedWriteback(this.proposal);
			this.renderReady(preview);
		} catch (error) {
			console.error('tracekeeper failed to preview approved writeback', error);
			contentEl.empty();
			contentEl.createEl('p', {
				text: ui('生成写回预览失败，请检查该提案是否仍处于已批准状态。', 'Failed to generate writeback preview. Check whether this proposal is still approved.'),
			});
			const actions = contentEl.createDiv({ cls: 'modal-button-container' });
			actions.createEl('button', { text: ui('关闭', 'Close') }).addEventListener('click', () => this.close());
		}
	}

	private renderReady(preview: ApprovedWritebackPreview): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', {
			text: ui('请确认以下内容将写入目标笔记。', 'Confirm the content that will be written to the target note.'),
		});
		const facts = contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(facts, ui('提案', 'Proposal'), preview.proposal_id || this.proposal.proposalId);
		this.renderDetail(facts, ui('目标笔记', 'Target note'), preview.target_note || this.proposal.targetNote);
		this.renderDetail(facts, ui('涉及文件', 'Touched notes'), (preview.touched_notes || []).join(', '));
		const previewBox = contentEl.createEl('pre');
		previewBox.setText(preview.writeback_preview || '');

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel'), cls: 'mod-warning' });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', { text: ui('确认写回', 'Apply writeback'), cls: 'mod-cta' });
		confirm.addEventListener('click', () => {
			void (async () => {
				confirm.disabled = true;
				confirm.setText(ui('写回中...', 'Applying...'));
				try {
					await this.plugin.applyApprovedWriteback(this.proposal);
					new Notice(ui('已应用写回。', 'Approved writeback applied.'));
					this.onApplied();
					this.close();
				} catch (error) {
					console.error('tracekeeper failed to apply approved writeback', error);
					new Notice(ui('应用写回失败。', 'Failed to apply writeback.'));
					confirm.disabled = false;
					confirm.setText(ui('确认写回', 'Apply writeback'));
				}
			})();
		});
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value || ui('未指定', 'Not specified') });
	}
}

class TracekeeperGraphHealthView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_GRAPH_HEALTH_VIEW;
	}

	getDisplayText() {
		return ui('知识图谱健康', 'Graph health');
	}

	getViewData() {
		return '';
	}

	setViewData(_data: string, _clear: boolean): void {
		return;
	}

	clear(): void {
		this.contentEl.empty();
	}

	async onOpen() {
		await super.onOpen();
		await this.refresh();
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadGraphHealthSnapshot();
		await this.render(snapshot);
	}

	private async render(snapshot: GraphHealthSnapshot): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		const heading = header.createDiv();
		heading.createEl('h2', { text: ui('知识图谱健康', 'Graph Health'), cls: 'tracekeeper-view__title' });
		heading.createEl('p', {
			text: `${ui('检查策略', 'Profile')}: ${graphProfileLabel(snapshot.profile)} • ${ui('最后刷新', 'Last refreshed')}: ${this.plugin.formatDisplayTime(Date.parse(snapshot.updatedAt))}`,
			cls: 'tracekeeper-view__description',
		});

		const actions = header.createDiv({ cls: 'tracekeeper-action-row' });
		const refreshButton = actions.createEl('button', {
			text: ui('刷新', 'Refresh'),
			cls: 'mod-cta',
		});
		refreshButton.addEventListener('click', () => {
			void this.handleRefreshClick(refreshButton);
		});

		const proposalButton = actions.createEl('button', {
			text: ui('创建 Review Queue 建议', 'Create Review Queue proposal'),
		});
		proposalButton.disabled = !this.hasActionableGraphWork(snapshot);
		proposalButton.addEventListener('click', () => {
			void this.handleCreateProposalClick(snapshot, proposalButton);
		});

		if (!snapshot.ok) {
			this.renderEmptyState(
				contentEl,
				ui('无法读取图谱健康状态。', 'Graph health is unavailable.'),
				snapshot.errorMessage || ui('请确认 MCP 服务正在运行。', 'Check whether the MCP service is running.')
			);
			return;
		}

		const statusBar = contentEl.createDiv({ cls: 'tracekeeper-status-bar' });
		this.renderStatusItem(statusBar, ui('检查策略', 'Profile'), graphProfileLabel(snapshot.profile));
		this.renderStatusItem(statusBar, ui('当前仓库', 'Current repository'), this.formatVaultLabel(snapshot.vaultRoot), snapshot.vaultRoot);
		this.renderStatusItem(statusBar, ui('问题数', 'Profile issues'), String(snapshot.profileIssues.length));
		this.renderStatusItem(statusBar, ui('建议数', 'Recommendations'), String(snapshot.recommendationCount));

		const metrics = contentEl.createDiv({ cls: 'tracekeeper-metric-grid' });
		this.renderMetricCard(metrics, ui('笔记', 'Notes'), String(snapshot.noteCount), ui('参与图谱扫描的 Markdown 文件', 'Markdown notes in the graph scan'));
		this.renderMetricCard(metrics, ui('Wikilink', 'Wikilinks'), String(snapshot.wikilinkEdgeCount), `${ui('已解析', 'Resolved')}: ${snapshot.resolvedEdgeCount}`);
		this.renderMetricCard(metrics, ui('未解析链接', 'Unresolved links'), String(snapshot.unresolvedEdgeCount), ui('无法解析到目标笔记的 wikilink', 'Wikilinks that do not resolve to a note'), snapshot.unresolvedEdgeCount > 0 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('连通分量', 'Components'), String(snapshot.componentCount), `${ui('最大分量', 'Largest')}: ${snapshot.largestComponentNodeCount}`, snapshot.componentCount > 1 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('孤立节点', 'Isolated'), String(snapshot.isolatedNodeCount), ui('没有入链或出链的笔记', 'Notes with no inbound or outbound links'), snapshot.isolatedNodeCount > 0 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('只有入链', 'Only inbound'), String(snapshot.onlyInboundNodeCount), ui('可能成为信息终点', 'Potential knowledge sinks'), snapshot.onlyInboundNodeCount > 0 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('只有出链', 'Only outbound'), String(snapshot.onlyOutboundNodeCount), ui('可能成为来源入口', 'Potential source-only notes'), snapshot.onlyOutboundNodeCount > 0 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, 'Hub', String(snapshot.hubCandidateCount), ui('度数大于等于 2 的候选中心', 'Candidate hubs with degree >= 2'));

		this.renderProfileIssues(contentEl, snapshot);
		this.renderRecommendations(contentEl, snapshot);
		this.renderHubCandidates(contentEl, snapshot);
		this.renderAttentionLists(contentEl, snapshot);
	}

	private async handleRefreshClick(button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		button.setText(ui('刷新中...', 'Refreshing...'));
		try {
			await this.refresh();
			new Notice(ui('图谱健康已刷新。', 'Graph health refreshed.'));
		} catch (error) {
			console.error('tracekeeper failed to refresh graph health view', error);
			new Notice(ui('刷新图谱健康失败。', 'Failed to refresh graph health.'));
		}
	}

	private async handleCreateProposalClick(snapshot: GraphHealthSnapshot, button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		button.setText(ui('创建中...', 'Creating...'));
		try {
			const path = await this.plugin.createGraphHealthReviewProposal(snapshot);
			new Notice(path
				? ui(`已创建审核建议：${path}`, `Review proposal created: ${path}`)
				: ui('已创建审核建议。', 'Review proposal created.')
			);
			await this.refresh();
		} catch (error) {
			console.error('tracekeeper failed to create graph health proposal', error);
			new Notice(ui('创建审核建议失败。', 'Failed to create review proposal.'));
			button.disabled = false;
			button.setText(ui('创建 Review Queue 建议', 'Create Review Queue proposal'));
		}
	}

	private hasActionableGraphWork(snapshot: GraphHealthSnapshot): boolean {
		return snapshot.ok && (
			snapshot.profileIssues.length > 0 ||
			Boolean(snapshot.missingRecommendedEntry) ||
			snapshot.missingRecommendedHubCount > 0 ||
			snapshot.unresolvedEdgeCount > 0 ||
			snapshot.isolatedNodeCount > 0 ||
			snapshot.componentCount > 1
		);
	}

	private renderStatusItem(container: HTMLElement, label: string, value: string, title?: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-status-pill' });
		item.createEl('span', { text: label });
		const strong = item.createEl('strong', { text: value || ui('未知', 'Unknown') });
		if (title) {
			strong.setAttr('title', title);
		}
	}

	private renderMetricCard(container: HTMLElement, label: string, value: string, detail: string, tone: 'ok' | 'warning' = 'ok'): void {
		const card = container.createDiv({ cls: `tracekeeper-metric-card tracekeeper-metric-card--${tone}` });
		card.createEl('span', { text: label, cls: 'tracekeeper-metric-card__label' });
		card.createEl('strong', { text: value, cls: 'tracekeeper-metric-card__value' });
		card.createEl('small', { text: detail });
	}

	private renderProfileIssues(container: HTMLElement, snapshot: GraphHealthSnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card' });
		const header = card.createDiv({ cls: 'tracekeeper-card__header' });
		header.createEl('h3', { text: ui('Profile Issues', 'Profile Issues') });
		header.createEl('span', { text: graphProfileLabel(snapshot.profile), cls: 'tracekeeper-badge' });
		if (snapshot.profile === 'off') {
			card.createEl('p', {
				text: ui(
					'当前关闭图谱结构检查。指标仍可手动查看，但不会生成 profile issue。',
					'Graph structure checks are off. Metrics are still visible for manual review, but profile issues are suppressed.'
				),
				cls: 'tracekeeper-view__description',
			});
			return;
		}
		if (snapshot.profileIssues.length === 0) {
			this.renderEmptyState(
				card,
				ui('当前策略下没有图谱问题。', 'No graph issues for the current profile.'),
				ui('这只表示图谱结构检查通过，不代表内容事实已被验证。', 'This only means graph structure checks passed; it does not validate factual content.')
			);
			return;
		}
		const list = card.createDiv({ cls: 'tracekeeper-issue-list' });
		for (const issue of snapshot.profileIssues) {
			const row = list.createDiv({ cls: `tracekeeper-issue-row tracekeeper-issue-row--${issue.severity}` });
			row.createEl('span', { text: issue.severity, cls: `tracekeeper-badge tracekeeper-badge--${issue.severity}` });
			const body = row.createDiv();
			body.createEl('strong', { text: `${issue.kind} (${issue.count})` });
			body.createEl('div', { text: issue.message, cls: 'tracekeeper-view__description' });
			if (issue.paths.length > 0) {
				body.createEl('small', { text: issue.paths.slice(0, 6).join(', ') });
			}
		}
	}

	private renderRecommendations(container: HTMLElement, snapshot: GraphHealthSnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('建议', 'Recommendations') });
		if (snapshot.recommendations.length === 0) {
			this.renderEmptyState(
				card,
				ui('没有返回建议。', 'No recommendations returned.'),
				ui('可以继续使用刷新重新检查图谱。', 'Refresh to run the graph check again.')
			);
			return;
		}
		const list = card.createEl('ul', { cls: 'tracekeeper-view__list' });
		for (const item of snapshot.recommendations) {
			list.createEl('li', { text: item });
		}
	}

	private renderHubCandidates(container: HTMLElement, snapshot: GraphHealthSnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('Hub Candidates', 'Hub Candidates') });
		if (snapshot.hubCandidates.length === 0) {
			this.renderEmptyState(
				card,
				ui('还没有明显 hub 候选。', 'No strong hub candidates yet.'),
				ui('可以通过入口索引和主题 hub 增强图谱聚合能力。', 'Entry indexes and topic hubs can improve graph aggregation.')
			);
			return;
		}
		const list = card.createDiv({ cls: 'tracekeeper-graph-candidate-list' });
		for (const candidate of snapshot.hubCandidates) {
			const row = list.createDiv({ cls: 'tracekeeper-graph-candidate-row' });
			row.createEl('strong', { text: candidate.path });
			row.createEl('span', { text: `${ui('度数', 'Degree')}: ${candidate.degree}` });
			row.createEl('span', { text: `${ui('入链', 'Inbound')}: ${candidate.inbound}` });
			row.createEl('span', { text: `${ui('出链', 'Outbound')}: ${candidate.outbound}` });
		}
	}

	private renderAttentionLists(container: HTMLElement, snapshot: GraphHealthSnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('需要关注的节点', 'Nodes Needing Attention') });
		const details = card.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderNodeList(details, ui('缺失入口', 'Missing entry'), snapshot.missingRecommendedEntry ? [snapshot.missingRecommendedEntry] : []);
		this.renderNodeList(details, ui('缺失 hub', 'Missing hubs'), snapshot.missingRecommendedHubs);
		this.renderNodeList(details, ui('孤立节点', 'Isolated nodes'), snapshot.isolatedNodes);
		this.renderNodeList(details, ui('只有入链', 'Only inbound'), snapshot.onlyInboundNodes);
		this.renderNodeList(details, ui('只有出链', 'Only outbound'), snapshot.onlyOutboundNodes);
	}

	private renderNodeList(container: HTMLElement, label: string, values: string[]): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail tracekeeper-detail--description' });
		item.createEl('span', { text: label });
		if (values.length === 0) {
			item.createEl('strong', { text: ui('无', 'None') });
			return;
		}
		item.createEl('strong', { text: values.slice(0, 8).join(', ') });
		if (values.length > 8) {
			item.createEl('small', { text: ui(`另有 ${values.length - 8} 项`, `${values.length - 8} more`) });
		}
	}

	private renderEmptyState(container: HTMLElement, title: string, detail: string): void {
		const empty = container.createDiv({ cls: 'tracekeeper-empty-state' });
		empty.createEl('strong', { text: title });
		empty.createEl('p', { text: detail });
	}

	private formatVaultLabel(vaultRoot: string): string {
		const segments = vaultRoot.split('/').filter(Boolean);
		return segments[segments.length - 1] || vaultRoot || ui('未知', 'Unknown');
	}
}

class ClientConfigPreviewModal extends Modal {
	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private config: GeneratedClientConfig,
		private mode: 'apply' | 'remove',
		private onChanged?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', {
			text: this.mode === 'apply'
				? ui('确认自动配置', 'Confirm auto setup')
				: ui('确认移除配置', 'Confirm config removal'),
		});
		contentEl.createEl('p', {
			text: this.mode === 'apply'
				? ui('将只写入知识库连接配置，不会修改其他 MCP server。写入前会创建备份。', 'Only the Tracekeeper connection will be written. Other MCP servers will not be changed. A backup will be created first.')
				: ui('将只移除知识库连接配置，不会删除其他 MCP server。移除前会创建备份。', 'Only the Tracekeeper connection will be removed. Other MCP servers will not be deleted. A backup will be created first.'),
			cls: 'tracekeeper-view__description',
		});
		const details = contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(details, ui('AI 工具', 'AI tool'), this.config.displayName);
		this.renderDetail(details, ui('配置文件', 'Config file'), this.config.targetPath || ui('不可用', 'Unavailable'));
		this.renderDetail(details, ui('连接方式', 'Connection'), this.transportLabel(this.config.transport));
		if (this.mode === 'apply') {
			contentEl.createEl('pre', { text: this.config.configText, cls: 'tracekeeper-code-block' });
		}
		const actions = contentEl.createDiv({ cls: 'tracekeeper-action-row' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const confirmText = this.mode === 'apply' ? ui('确认写入', 'Write config') : ui('移除配置', 'Remove config');
		const confirm = actions.createEl('button', {
			text: confirmText,
			cls: 'mod-cta',
		});
		const status = actions.createEl('span', { cls: 'tracekeeper-view__description' });
		confirm.addEventListener('click', () => {
			void (async () => {
				confirm.disabled = true;
				cancel.disabled = true;
				confirm.setText(this.mode === 'apply' ? ui('写入中...', 'Writing...') : ui('移除中...', 'Removing...'));
				status.setText(this.mode === 'apply' ? ui('正在写入连接配置...', 'Writing connection config...') : ui('正在移除配置...', 'Removing config...'));
				try {
					if (this.mode === 'apply') {
						await this.plugin.applyClientConfig(this.config);
					} else {
						await this.plugin.removeClientConfig(this.config);
					}
					this.onChanged?.();
					this.close();
				} catch {
					status.setText(this.mode === 'apply' ? ui('写入失败，请检查配置文件权限后重试。', 'Write failed. Check config file permissions and try again.') : ui('移除失败，请检查配置文件权限后重试。', 'Removal failed. Check config file permissions and try again.'));
					confirm.disabled = false;
					cancel.disabled = false;
					confirm.setText(confirmText);
				}
			})();
		});
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}

	private transportLabel(transport: ConnectionTransport): string {
		switch (transport) {
			case 'streamable-http':
				return ui('连接地址', 'Connection URL');
			default:
				return transport;
		}
	}
}

class McpCapabilitiesModal extends Modal {
	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-capabilities-modal');
		this.titleEl.setText(ui('MCP 服务功能', 'MCP service capabilities'));

		contentEl.createEl('p', {
			text: ui(
				'AI 工具连接后可以调用以下功能。移动到功能项上可查看说明。',
				'Connected agents can call the capabilities below. Hover a capability to see its explanation.'
			),
			cls: 'tracekeeper-view__description',
		});

		const list = contentEl.createDiv({ cls: 'tracekeeper-capability-list' });
		for (const definition of toolDefinitions()) {
			const localization = MCP_CAPABILITY_LOCALIZATIONS[definition.name];
			const title = localization ? localizedText(localization.title) : definition.title;
			const description = localization ? localizedText(localization.description) : definition.description;
			const category = localization ? localizedText(localization.category) : ui('功能', 'Capability');
			const riskLabel = localization ? mcpCapabilityRiskLabel(localization.risk) : ui('功能说明', 'Capability');
			const tooltip = `${definition.name}\n${description}`;
			const row = list.createDiv({ cls: 'tracekeeper-capability-row' });
			row.tabIndex = 0;
			row.setAttr('aria-label', tooltip);
			row.setAttr('data-tooltip-position', 'top');
			row.setAttr('title', tooltip);
			row.createEl('span', {
				text: category,
				cls: 'tracekeeper-badge tracekeeper-capability-row__badge',
			});
			const body = row.createDiv({ cls: 'tracekeeper-capability-row__body' });
			const heading = body.createDiv({ cls: 'tracekeeper-capability-row__heading' });
			heading.createEl('strong', { text: title });
			heading.createEl('code', { text: definition.name });
			body.createEl('small', { text: riskLabel });
		}

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const close = actions.createEl('button', { text: ui('关闭', 'Close') });
		close.addEventListener('click', () => this.close());
	}
}

class RuntimeTokenRegenerateConfirmModal extends Modal {
	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private onRegenerated: () => void
	) {
		super(app);
	}

	onOpen(): void {
		void super.onOpen();
		this.titleEl.setText(ui('重新生成令牌', 'Regenerate token'));

		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', {
			text: ui('当前令牌将失效。', 'The current token will expire.'),
		});

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			text: ui('确认', 'Confirm'),
			cls: 'mod-warning',
		});
		confirm.addEventListener('click', () => {
			void (async () => {
				confirm.disabled = true;
				cancel.disabled = true;
				try {
					await this.plugin.regenerateRuntimeToken();
					this.onRegenerated();
					this.close();
				} catch (error) {
					console.error('tracekeeper failed to regenerate runtime token', error);
					new Notice(ui('重新生成令牌失败。', 'Failed to regenerate token.'));
					confirm.disabled = false;
					cancel.disabled = false;
				}
			})();
		});
	}
}

class TracekeeperMemoryInspectorView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_MEMORY_INSPECTOR_VIEW;
	}

	getDisplayText() {
		return ui('记忆查看', 'Memory view');
	}

	getViewData() {
		return '';
	}

	setViewData(_data: string, _clear: boolean): void {
		return;
	}

	clear(): void {
		this.contentEl.empty();
	}

	async onOpen() {
		await super.onOpen();
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		contentEl.createEl('h2', { text: ui('记忆查看', 'Memory view'), cls: 'tracekeeper-view__title' });
		contentEl.createEl('p', {
			text: ui(
				'这里用于查看已保存的记忆、来源证据和最近使用情况。完成一次审核或记录后，相关内容会逐步出现在这里。',
				'Use this page to review saved memories, source evidence, and recent usage. Related details appear here after review or recording activity.'
			),
			cls: 'tracekeeper-view__description',
		});
	}
}

class RuntimeLogCleanupModal extends Modal {
	private selectedScope: RuntimeLogCleanupScope = 'older-than-week';

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private onCleaned: () => Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(ui('清理运行日志', 'Clear runtime log'));

		contentEl.createEl('p', {
			text: ui(
				'选择要清理的日志范围。该操作只会清理运行日志，不会删除任务、记忆或审核内容。',
				'Choose which runtime log entries to clear. This only clears runtime logs; tasks, memories, and review items are not deleted.'
			),
			cls: 'tracekeeper-view__description',
		});

		new Setting(contentEl)
			.setName(ui('清理范围', 'Range'))
			.setDesc(ui('按日志时间清理旧记录。', 'Clear old records by log time.'))
			.addDropdown((dropdown) => {
				for (const scope of RUNTIME_LOG_CLEANUP_OPTIONS) {
					dropdown.addOption(scope, runtimeLogCleanupScopeLabel(scope));
				}
				dropdown
					.setValue(this.selectedScope)
					.onChange((value: string) => {
						this.selectedScope = this.normalizeScope(value);
					});
			});

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const status = actions.createEl('span', { cls: 'tracekeeper-view__description' });
		const confirm = actions.createEl('button', {
			text: ui('清理', 'Clear'),
			cls: 'mod-warning',
		});
		confirm.addEventListener('click', () => {
			void (async () => {
				confirm.disabled = true;
				cancel.disabled = true;
				status.setText(ui('正在清理...', 'Clearing...'));
				try {
					const result = await this.plugin.cleanRuntimeLogs(this.selectedScope);
					new Notice(ui(
						`已清理 ${result.removedSections + result.removedFiles} 条日志记录。`,
						`Cleared ${result.removedSections + result.removedFiles} runtime log record(s).`
					));
					await this.onCleaned();
					this.close();
				} catch (error) {
					console.error('tracekeeper failed to clear runtime logs', error);
					status.setText(ui('清理失败，请稍后重试。', 'Clear failed. Try again later.'));
					confirm.disabled = false;
					cancel.disabled = false;
				}
			})();
		});
	}

	private normalizeScope(value: string): RuntimeLogCleanupScope {
		return RUNTIME_LOG_CLEANUP_OPTIONS.includes(value as RuntimeLogCleanupScope)
			? value as RuntimeLogCleanupScope
			: 'older-than-week';
	}
}

class TracekeeperRuntimeLogView extends ItemView {
	private page = 1;
	private activeFilter: RuntimeLogFilter = 'all';

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_RUNTIME_LOG_VIEW;
	}

	getDisplayText() {
		return ui('运行日志', 'Runtime log');
	}

	getViewData() {
		return '';
	}

	setViewData(_data: string, _clear: boolean): void {
		return;
	}

	clear(): void {
		this.contentEl.empty();
	}

	async onOpen() {
		await super.onOpen();
		await this.refresh();
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadRuntimeLogSnapshot(
			this.page,
			this.activeFilter,
			RUNTIME_LOG_PAGE_SIZE
		);
		this.page = snapshot.page;
		this.render(snapshot);
	}

	private render(snapshot: RuntimeLogSnapshot): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		const heading = header.createDiv();
		heading.createEl('h2', {
			text: ui('运行日志', 'Runtime log'),
			cls: 'tracekeeper-view__title',
		});
		heading.createEl('p', {
			text: ui(
				'查看连接、工具调用、配置写入和错误记录。',
				'Review connection, tool call, config, and error records.'
			),
			cls: 'tracekeeper-view__description',
		});
		const actions = header.createDiv({ cls: 'tracekeeper-action-row' });
		const cleanupButton = actions.createEl('button', {
			text: ui('清理', 'Clear'),
		});
		cleanupButton.addEventListener('click', () => {
			new RuntimeLogCleanupModal(this.app, this.plugin, async () => {
				this.page = 1;
				await this.refresh();
			}).open();
		});
		const refreshButton = actions.createEl('button', {
			text: ui('刷新', 'Refresh'),
			cls: 'mod-cta',
		});
		refreshButton.addEventListener('click', () => {
			void this.refresh();
		});

		this.renderFilterToolbar(contentEl, snapshot);

		const summary = contentEl.createDiv({ cls: 'tracekeeper-view__description' });
		summary.setText(ui(
			`共 ${snapshot.totalItems} 条 · 第 ${snapshot.page} / ${snapshot.totalPages} 页`,
			`${snapshot.totalItems} total · Page ${snapshot.page} of ${snapshot.totalPages}`
		));

		if (snapshot.items.length === 0) {
			this.renderEmptyState(
				contentEl,
				ui('还没有可展示的运行记录。', 'No runtime records yet.'),
				ui('AI 工具连接或使用 Tracekeeper 后，这里会显示记录。', 'Runtime records appear after an AI tool connects to or uses Tracekeeper.')
			);
			return;
		}

		const list = contentEl.createDiv({ cls: 'tracekeeper-runtime-log-list' });
		for (const item of snapshot.items) {
			this.renderLogItem(list, item);
		}
		this.renderPagination(contentEl, snapshot);
	}

	private renderFilterToolbar(container: HTMLElement, snapshot: RuntimeLogSnapshot): void {
		const toolbar = container.createDiv({ cls: 'tracekeeper-runtime-log-toolbar' });
		for (const filter of RUNTIME_LOG_FILTERS) {
			const count = snapshot.counts[filter] || 0;
			const button = toolbar.createEl('button', {
				text: `${this.filterLabel(filter)} (${count})`,
				cls: snapshot.filter === filter ? 'is-active' : '',
			});
			button.addEventListener('click', () => {
				this.activeFilter = filter;
				this.page = 1;
				void this.refresh();
			});
		}
	}

	private renderLogItem(container: HTMLElement, item: RuntimeLogItem): void {
		const row = container.createDiv({ cls: 'tracekeeper-runtime-log-row' });
		row.createEl('div', {
			text: this.categoryLabel(item.category),
			cls: 'tracekeeper-runtime-log-row__badge tracekeeper-badge',
		});
		const body = row.createDiv({ cls: 'tracekeeper-runtime-log-row__body' });
		body.createEl('strong', {
			text: `${item.title || ui('运行记录', 'Runtime record')} • ${this.plugin.formatDisplayTime(item.time)}`,
		});
		if (item.meta) {
			body.createEl('div', { text: item.meta, cls: 'tracekeeper-view__description' });
		}
		if (item.body) {
			body.createEl('div', { text: this.plugin.trimText(item.body, 180) });
		}
		if (item.path) {
			body.createEl('small', { text: item.path });
		}
	}

	private renderPagination(container: HTMLElement, snapshot: RuntimeLogSnapshot): void {
		const pager = container.createDiv({ cls: 'tracekeeper-pagination' });
		const previous = pager.createEl('button', { text: ui('上一页', 'Previous') });
		previous.disabled = snapshot.page <= 1;
		previous.addEventListener('click', () => {
			this.page = Math.max(1, snapshot.page - 1);
			void this.refresh();
		});
		pager.createEl('span', {
			text: ui(
				`第 ${snapshot.page} / ${snapshot.totalPages} 页`,
				`Page ${snapshot.page} of ${snapshot.totalPages}`
			),
			cls: 'tracekeeper-view__description',
		});
		const next = pager.createEl('button', { text: ui('下一页', 'Next') });
		next.disabled = snapshot.page >= snapshot.totalPages;
		next.addEventListener('click', () => {
			this.page = Math.min(snapshot.totalPages, snapshot.page + 1);
			void this.refresh();
		});
	}

	private filterLabel(filter: RuntimeLogFilter): string {
		switch (filter) {
			case 'connection':
				return ui('连接', 'Connections');
			case 'tool':
				return ui('工具调用', 'Tool calls');
			case 'config':
				return ui('配置', 'Config');
			case 'error':
				return ui('错误', 'Errors');
			case 'all':
			default:
				return ui('全部', 'All');
		}
	}

	private categoryLabel(category: RuntimeLogCategory): string {
		switch (category) {
			case 'connection':
				return ui('连接', 'Connection');
			case 'tool':
				return ui('工具调用', 'Tool call');
			case 'config':
				return ui('配置', 'Config');
			case 'record':
			default:
				return ui('记录', 'Record');
		}
	}

	private renderEmptyState(container: HTMLElement, title: string, detail: string): void {
		const state = container.createDiv({ cls: 'tracekeeper-empty-state' });
		state.createEl('strong', { text: title });
		state.createEl('p', { text: detail });
	}
}

class TracekeeperRuntimeStatusView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_RUNTIME_STATUS_VIEW;
	}

	getDisplayText() {
		return ui('连接状态', 'Connection status');
	}

	getViewData() {
		return '';
	}

	setViewData(_data: string, _clear: boolean): void {
		return;
	}

	clear(): void {
		this.contentEl.empty();
	}

	async onOpen() {
		await super.onOpen();
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');
		const status = this.plugin.getRuntimeViewStatus();

		contentEl.createEl('h2', { text: ui('连接状态', 'Connection status'), cls: 'tracekeeper-view__title' });
		contentEl.createEl('p', {
			text: status.enabled
				? ui(
					'MCP 服务由 Obsidian 桌面端托管，开启后随 Obsidian 运行。',
					'The MCP service is hosted by desktop Obsidian and runs while Obsidian is open.'
				)
				: ui(
					'MCP 服务已在设置中关闭，需要连接 AI 工具时可重新开启。',
					'MCP service is off in settings. Turn it back on when AI tools need to connect.'
				),
			cls: 'tracekeeper-view__description',
		});

		const detailGrid = contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(detailGrid, ui('MCP 服务', 'MCP service'), status.label);
		this.renderDetail(detailGrid, ui('连接地址', 'Connection URL'), this.plugin.getMcpConnectionUrl());
		this.renderDetail(detailGrid, ui('绑定范围', 'Binding'), ui('仅本机 127.0.0.1', 'Localhost only, 127.0.0.1'));
		this.renderDetail(detailGrid, ui('生命周期', 'Lifecycle'), status.enabled
			? ui('开启后随 Obsidian 运行', 'Runs while Obsidian is open')
			: ui('由用户手动关闭', 'Turned off by user'));
		this.renderDetail(detailGrid, ui('活跃会话', 'Active sessions'), String(status.activeSessions));
		if (status.startedAt) {
			this.renderDetail(detailGrid, ui('启动时间', 'Started at'), this.plugin.formatDisplayTime(Date.parse(status.startedAt)));
		}
		if (status.lastError) {
			this.renderDetail(detailGrid, ui('最近错误', 'Last error'), status.lastError);
		}
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}
}

class TracekeeperPermissionPolicyView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_PERMISSION_POLICY_VIEW;
	}

	getDisplayText() {
		return ui('权限说明', 'Permission guide');
	}

	getViewData() {
		return '';
	}

	setViewData(_data: string, _clear: boolean): void {
		return;
	}

	clear(): void {
		this.contentEl.empty();
	}

	async onOpen() {
		await super.onOpen();
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		contentEl.createEl('h2', { text: ui('权限说明', 'Permission guide'), cls: 'tracekeeper-view__title' });
		contentEl.createEl('p', {
			text: ui(
				'知识库默认先读取和整理资料；任何会影响长期记忆的重要写入，都必须先经过你审核。',
				'Tracekeeper reads and organizes material by default; important writes that affect long-term memory must be reviewed by you first.'
			),
			cls: 'tracekeeper-view__description',
		});

		const sections = [
			{
				title: ui('可直接读取', 'Read directly'),
				items: [
					ui('查看连接和资料状态', 'Check connection and knowledge base status'),
					ui('查找相关笔记', 'Find related notes'),
					ui('读取指定笔记', 'Read a selected note'),
					ui('查看审核队列和最近记录', 'Review queue and recent activity'),
					ui('检查笔记结构', 'Check note structure'),
				],
			},
			{
				title: ui('可保存工作记录', 'Save work records'),
				items: [
					ui('保存来源资料和分析结果', 'Save source material and analysis results'),
					ui('整理上下文材料', 'Prepare context material'),
					ui('记录任务结果和会话摘要', 'Record task results and session summaries'),
					ui('按记忆规则提交长期记忆更新', 'Submit long-term memory updates by memory rules'),
				],
			},
			{
				title: ui('必须先审核', 'Needs review first'),
				items: [
					ui('全局记忆默认先进入审核队列', 'Global memory enters the review queue by default'),
					ui('项目记忆可按规则自动保存', 'Project memory can auto-save by rule'),
					ui('批准后的写入会留下记录，方便追溯', 'Approved writes leave records for traceability'),
				],
			},
			{
				title: ui('不会执行', 'Never allowed'),
				items: [
					ui(
						'不会替你运行系统命令或安装软件',
						'Will not run system commands or install software for you'
					),
					ui(
						'不会访问当前知识库之外的文件',
						'Will not access files outside the current knowledge base'
					),
					ui(
						'不会修改 Obsidian 配置目录',
						'Will not modify Obsidian settings folders'
					),
					ui(
						'不会删除、移动或批量重写你的笔记',
						'Will not delete, move, or bulk rewrite your notes'
					),
					ui(
						'未经审核不会直接写入受保护记忆',
						'Will not write protected memory without review'
					),
				],
			},
		];

		for (const policySection of sections) {
			const section = contentEl.createDiv({ cls: 'tracekeeper-view__section' });
			section.createEl('h3', { text: policySection.title });
			const list = section.createEl('ul', { cls: 'tracekeeper-view__list' });
			for (const item of policySection.items) {
				list.createEl('li', { text: item, cls: 'tracekeeper-view__item' });
			}
		}

		const source = contentEl.createDiv({ cls: 'tracekeeper-view__section' });
		source.createEl('h3', { text: ui('使用提示', 'Tip') });
		source.createEl('p', {
			text: ui(
				'如果不确定某条记忆是否应该保存，请选择“要求修订”或“暂缓”，不要直接批准。',
				'If you are unsure whether a memory should be saved, choose request revision or defer instead of approving it.'
			),
			cls: 'tracekeeper-view__description',
		});
	}
}

class TracekeeperSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: TracekeeperPlugin
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('tracekeeper-settings-root');
		const loading = containerEl.createDiv({ cls: 'tracekeeper-view__description' });
		loading.setText(ui('正在读取连接配置...', 'Reading connection settings...'));
		void this.renderSettings();
	}

	private async renderSettings(): Promise<void> {
		const snapshot = await this.plugin.loadAgentConnectionsSnapshot();
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('tracekeeper-settings-root');
		this.renderConnectionInfoSection(containerEl, snapshot);
		this.renderTokenSection(containerEl);
		this.renderAgentClientConfigSection(containerEl, snapshot);
		this.renderMemoryRulesSection(containerEl);
		this.renderAdvancedMaintenanceSection(containerEl);
	}

	private renderAgentClientConfigSection(container: HTMLElement, snapshot: AgentConnectionsSnapshot): void {
		const section = this.createSection(
			container,
			ui('Agent 配置', 'Agent configuration'),
			ui('为常用 Agent 配置 Tracekeeper 连接，保持 Obsidian 开启后即可使用。', 'Configure Tracekeeper for your agents. Keep Obsidian open to use it.')
		);
		const grid = section.createDiv({ cls: 'tracekeeper-settings-grid' });
		for (const config of snapshot.clientConfigs) {
			this.renderClientConfigRow(grid, config);
		}
	}

	private renderConnectionInfoSection(container: HTMLElement, snapshot: AgentConnectionsSnapshot): void {
		const section = this.createSection(
			container,
			ui('MCP 服务', 'MCP service'),
			ui('控制本机服务开关、设置端口，并复制 Agent 连接地址。', 'Control the local service, set the port, and copy the agent connection URL.')
		);
		this.renderRuntimeEnabledSetting(section);
		this.renderCapabilitiesSetting(section);
		this.renderPortSetting(section, snapshot.connectionUrl);
	}

	private renderRuntimeEnabledSetting(container: HTMLElement): void {
		const enabled = this.plugin.settings.mcpRuntimeEnabled;
		new Setting(container)
			.setName(ui('服务开关', 'Service'))
			.setDesc(enabled
				? ui('已开启，AI 工具可以通过本机地址连接。', 'On. AI tools can connect through the local address.')
				: ui('已关闭，AI 工具暂时无法连接。', 'Off. AI tools cannot connect right now.'))
			.addToggle((toggle) =>
				toggle
					.setValue(enabled)
					.onChange((value: boolean) => {
						void this.plugin.setMcpRuntimeEnabled(value)
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to toggle MCP service', error);
							});
					})
			);
	}

	private renderCapabilitiesSetting(container: HTMLElement): void {
		new Setting(container)
			.setName(ui('服务功能', 'Capabilities'))
			.setDesc(ui('查看 AI 工具可以调用的 MCP 服务功能。', 'View the MCP service capabilities available to agents.'))
			.addButton((button) =>
				button
					.setButtonText(ui('查看功能', 'View capabilities'))
					.onClick(() => {
						new McpCapabilitiesModal(this.app).open();
					})
			);
	}

	private renderTokenSection(container: HTMLElement): void {
		const section = this.createSection(
			container,
			ui('令牌管理', 'Token management'),
			ui('令牌只脱敏展示，复制时会复制完整值。', 'The token is masked here; copying uses the full value.')
		);
		const runtimeToken = this.plugin.settings.runtimeToken;
		const runtimeTokenCreatedAt = this.plugin.formatDisplayTime(Date.parse(this.plugin.settings.runtimeTokenCreatedAt));
		const row = section.createDiv({ cls: 'tracekeeper-settings-token-row' });
		const info = row.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(info, ui('令牌', 'Token'), this.plugin.formatRuntimeToken(runtimeToken));
		this.renderDetail(info, ui('创建时间', 'Created'), runtimeTokenCreatedAt);
		const actions = row.createDiv({ cls: 'tracekeeper-action-row' });
		const copy = actions.createEl('button', { text: ui('复制令牌', 'Copy token') });
		copy.disabled = !runtimeToken;
		copy.addEventListener('click', () => {
			void this.plugin.copyToClipboard(
				runtimeToken,
				ui('已复制本地连接令牌。', 'Local connection token copied.')
			);
		});
		const regenerate = actions.createEl('button', { text: ui('重置令牌', 'Reset token') });
		regenerate.addEventListener('click', () => {
			new RuntimeTokenRegenerateConfirmModal(
				this.app,
				this.plugin,
				() => this.display()
			).open();
		});
	}

	private renderMemoryRulesSection(container: HTMLElement): void {
		const section = this.createSection(
			container,
			ui('记忆规则', 'Memory rules'),
			ui('设置 Agent 提交记忆更新时的默认规则。', 'Set default rules for agent-submitted memory updates.')
		);
		new Setting(section)
			.setName(ui('全局记忆', 'Global memory'))
			.setDesc(ui(
				'通用偏好、长期决策等默认进入审核队列；也可以改为自动保存或不接收。',
				'General preferences and long-term decisions go to review by default; you can also auto-save or ignore them.'
			))
			.addDropdown((dropdown) => {
				for (const rule of MEMORY_PROPOSAL_RULES) {
					dropdown.addOption(rule, memoryProposalRuleLabel(rule));
				}
				dropdown
					.setValue(this.plugin.settings.globalMemoryRule)
					.onChange((value: string) => {
						this.plugin.settings.globalMemoryRule = normalizeMemoryProposalRule(value);
						void this.plugin.saveSettings()
							.then(() => this.plugin.restartMcpRuntime())
							.catch((error) => {
								console.error('tracekeeper failed to update global memory rule', error);
							});
					});
			});
		new Setting(section)
			.setName(ui('项目记忆', 'Project memory'))
			.setDesc(ui(
				'项目、仓库或工作区相关记忆默认自动保存，减少重复审核。',
				'Project, repository, or workspace memory auto-saves by default to reduce repeated review.'
			))
			.addDropdown((dropdown) => {
				for (const rule of MEMORY_PROPOSAL_RULES) {
					dropdown.addOption(rule, memoryProposalRuleLabel(rule));
				}
				dropdown
					.setValue(this.plugin.settings.projectMemoryRule)
					.onChange((value: string) => {
						this.plugin.settings.projectMemoryRule = normalizeMemoryProposalRule(value);
						void this.plugin.saveSettings()
							.then(() => this.plugin.restartMcpRuntime())
							.catch((error) => {
								console.error('tracekeeper failed to update project memory rule', error);
							});
					});
			});
		new Setting(section)
			.setName(ui('任务结束记忆提案', 'Task closeout memory proposals'))
			.setDesc(ui(
				'自动按上面的记忆规则保存或进入审核队列；审核会统一进入审核队列；忽略不生成提案。',
				'Auto follows the memory rules above to save or queue updates; Review sends updates to the review queue; Ignore creates no proposals.'
			))
			.addDropdown((dropdown) => {
				for (const mode of TASK_MEMORY_PROPOSAL_MODES) {
					dropdown.addOption(mode, taskMemoryProposalModeLabel(mode));
				}
				dropdown
					.setValue(this.plugin.settings.taskMemoryProposalMode)
					.onChange((value: string) => {
						this.plugin.settings.taskMemoryProposalMode = normalizeTaskMemoryProposalMode(value);
						void this.plugin.saveSettings()
							.then(() => this.plugin.restartMcpRuntime())
							.catch((error) => {
								console.error('tracekeeper failed to update task memory proposal mode', error);
							});
					});
			});
	}

	private renderAdvancedMaintenanceSection(container: HTMLElement): void {
		const section = this.createSection(
			container,
			ui('高级维护', 'Advanced maintenance'),
			ui('查看运行记录，清理日志，并调整图谱检查策略。', 'Review runtime records, clear logs, and adjust graph checks.')
		);
		new Setting(section)
			.setName(ui('运行日志', 'Runtime log'))
			.setDesc(ui('查看 Agent 连接、工具调用、配置写入和错误记录。', 'Review agent connections, tool calls, config writes, and errors.'))
			.addButton((button) =>
				button
					.setButtonText(ui('打开日志', 'Open log'))
					.onClick(() => {
						void this.plugin.openPluginView(TRACEKEEPER_RUNTIME_LOG_VIEW);
					})
			)
			.addButton((button) =>
				button
					.setButtonText(ui('清理日志', 'Clear logs'))
					.onClick(() => {
						new RuntimeLogCleanupModal(this.app, this.plugin, async () => undefined).open();
					})
			);
		new Setting(section)
			.setName(ui('召回预览', 'Recall preview'))
			.setDesc(ui('输入关键词，查看 Agent 可能读取到的记忆。', 'Enter keywords to see which memories an agent may read.'))
			.addButton((button) =>
				button
					.setButtonText(ui('测试召回', 'Test recall'))
					.onClick(() => {
						new MemoryRecallPreviewModal(this.app, this.plugin).open();
					})
			);
		new Setting(section)
			.setName(ui('知识图谱检查', 'Graph health profile'))
			.setDesc(ui(
				'关闭：仅保留手动查看；建议：只给出优化建议；严格：会把入口、中心节点、孤立节点和未解析链接标为阻塞问题。',
				'Off: manual inspection only; Advisory: reports suggestions; Strict: marks missing entries, hubs, isolated nodes, and unresolved links as blocking issues.'
			))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('off', ui('关闭', 'Off'))
					.addOption('advisory', ui('建议', 'Advisory'))
					.addOption('strict', ui('严格', 'Strict'))
					.setValue(this.plugin.settings.graphProfile)
					.onChange((value: string) => {
						this.plugin.settings.graphProfile = normalizeGraphProfileValue(value);
						void this.plugin.saveSettings()
							.then(() => this.plugin.restartMcpRuntime())
							.catch((error) => {
								console.error('tracekeeper failed to update graph profile', error);
							});
					})
			);
	}

	private renderPortSetting(container: HTMLElement, connectionUrl: string): void {
		new Setting(container)
			.setName(ui('连接地址', 'Connection URL'))
			.setDesc(ui(
				`http://${DEFAULT_MCP_HOST}:${this.plugin.settings.mcpPort || DEFAULT_MCP_PORT}`,
				`http://${DEFAULT_MCP_HOST}:${this.plugin.settings.mcpPort || DEFAULT_MCP_PORT}`
			))
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_MCP_PORT))
					.setValue(String(this.plugin.settings.mcpPort))
					.onChange((value: string) => {
						const parsed = Number.parseInt(value.trim(), 10);
						if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
							return;
						}
						this.plugin.settings.mcpPort = parsed;
						void this.plugin.saveSettings()
							.then(() => this.plugin.restartMcpRuntime())
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to update MCP port', error);
							});
					})
			)
			.addExtraButton((button) =>
				button
					.setIcon('rotate-ccw')
					.setTooltip(ui('恢复默认', 'Restore default'))
					.onClick(() => {
						this.plugin.settings.mcpPort = DEFAULT_MCP_PORT;
						void this.plugin.saveSettings()
							.then(() => this.plugin.restartMcpRuntime())
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to restore default MCP port', error);
							});
					})
			)
			.addExtraButton((button) =>
				button
					.setIcon('copy')
					.setTooltip(ui('复制连接地址', 'Copy connection URL'))
					.onClick(() => {
						void this.plugin.copyToClipboard(
							connectionUrl,
							ui('已复制连接地址。', 'Connection URL copied.')
						);
					})
			);
	}

	private renderClientConfigRow(container: HTMLElement, config: GeneratedClientConfig): void {
		const row = container.createDiv({ cls: 'tracekeeper-settings-client-row' });
		const info = row.createDiv({ cls: 'tracekeeper-settings-client-row__info' });
		const title = info.createDiv({ cls: 'tracekeeper-config-row__title' });
		title.createEl('strong', { text: config.displayName });
		title.createEl('span', {
			text: config.configStatusLabel,
			cls: `tracekeeper-badge ${this.configStatusClass(config.configState)}`,
		});
		info.createEl('small', { text: config.configStatusDetail || config.description });
		const actions = row.createDiv({ cls: 'tracekeeper-settings-client-row__actions tracekeeper-action-row' });

		if (config.configState !== 'configured') {
			const copy = actions.createEl('button', { text: ui('复制配置', 'Copy config') });
			copy.addEventListener('click', () => {
				void this.plugin.copyToClipboard(config.configText, ui('已复制连接配置。', 'Connection config copied.'));
			});
		}

		if (config.supportsAutoConfigure && config.targetPath && config.configState !== 'configured') {
			const autoConfigure = actions.createEl('button', {
				text: config.configState === 'needs_update' ? ui('更新配置', 'Update config') : ui('自动配置', 'Auto setup'),
				cls: 'mod-cta',
			});
			autoConfigure.addEventListener('click', () => {
				new ClientConfigPreviewModal(this.app, this.plugin, config, 'apply', () => this.display()).open();
			});
		}

		if (
			config.supportsAutoConfigure
			&& config.targetPath
			&& (config.configState === 'configured' || config.configState === 'needs_update')
		) {
			const openFile = actions.createEl('button', { text: ui('打开配置文件', 'Open config file') });
			openFile.addEventListener('click', () => {
				void this.plugin.openClientConfigFile(config);
			});
		}

		if (
			config.supportsAutoConfigure
			&& config.targetPath
			&& (config.configState === 'configured' || config.configState === 'needs_update')
		) {
			const remove = actions.createEl('button', { text: ui('移除配置', 'Remove config') });
			remove.addEventListener('click', () => {
				new ClientConfigPreviewModal(this.app, this.plugin, config, 'remove', () => this.display()).open();
			});
		}
	}

	private createSection(container: HTMLElement, title: string, description: string): HTMLElement {
		const section = container.createDiv({ cls: 'tracekeeper-settings-section' });
		const header = section.createDiv({ cls: 'tracekeeper-settings-section__header' });
		header.createEl('h3', { text: title, cls: 'tracekeeper-settings-section__title' });
		header.createEl('p', { text: description, cls: 'tracekeeper-settings-section__description' });
		return section;
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value || ui('未知', 'Unknown') });
	}

	private configStatusClass(state: ClientConfigState): string {
		switch (state) {
			case 'configured':
				return 'tracekeeper-badge--success';
			case 'needs_update':
				return 'tracekeeper-badge--warning';
			case 'not_configured':
			case 'unavailable':
			default:
				return 'tracekeeper-badge--muted';
		}
	}

}
