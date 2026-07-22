import {
	App,
	FileSystemAdapter,
	Notice,
	Platform,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
	getLanguage,
} from 'obsidian';
import { randomBytes } from 'node:crypto';
import {
	StreamableHttpMcpRuntime,
	type StreamableHttpRuntimeStatus,
	type RuntimeState,
	type RuntimeCredential,
} from '@tracekeeper/mcp-runtime';
import { LocalToolExecutor } from './composition/local-tool-executor';
import {
	ARCHIVE_ROOT,
	KNOWLEDGE_GLOBAL_MEMORY_DIR,
	KNOWLEDGE_INDEX_PATH,
	KNOWLEDGE_MEMORY_INDEX_PATH,
	KNOWLEDGE_PROJECTS_MEMORY_DIR,
	KNOWLEDGE_PROJECTS_INDEX_PATH,
	KNOWLEDGE_SOURCES_INDEX_PATH,
	KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
	KNOWLEDGE_WIKI_INDEX_PATH,
	TRACEKEEPER_AGENT_REQUESTS_DIR,
	TRACEKEEPER_AUDIT_DIR,
	TRACEKEEPER_AUDIT_LOG_PATH,
	TRACEKEEPER_CONTEXT_PACKS_DIR,
	TRACEKEEPER_CONTROL_DIR,
	TRACEKEEPER_MEMORY_POLICY_PATH,
	TRACEKEEPER_PERMISSIONS_PATH,
	TRACEKEEPER_REVIEW_QUEUE_DIR,
	TRACEKEEPER_SESSIONS_DIR,
	TRACEKEEPER_SYSTEM_PATH,
	TRACEKEEPER_TASKS_DIR,
	TRACEKEEPER_WORK_DIR,
} from '@tracekeeper/core';
import {
	type MemoryProposalRecord,
	type MemoryProposalStatus,
} from './features/review/review-view-model';
import {
	type MemoryRecallInput,
	type MemoryRecallResult,
	normalizeMemoryRecallScope,
	parseMemoryRecallResult,
	type TracekeeperRecallScope,
} from './features/recall/recall-view-model';
import { ObsidianKnowledgeIndexAdapter } from './knowledge-index-adapter';
import { ObsidianVaultRepository } from './adapters/obsidian-vault-repository';
import type { ToolCapability } from '@tracekeeper/contracts';
import {
	DEFAULT_ONBOARDING_SETTINGS,
	OnboardingSettingsState,
	findOnboardingRecallEvidence,
	hasOnboardingConnectionEvidence,
	markAgentRestartDone,
	markClientConfigured,
	markConnectionVerified,
	markFirstRecallDone,
	markSkillSetupDone,
	normalizeOnboardingSettingsState,
	OnboardingProgressContext,
	resetOnboardingState,
} from './features/onboarding/onboarding-state';
import {
	buildClientConfigText,
	buildClientProfiles,
	type ClientConfigState,
	type ClientProfile,
	type GeneratedClientConfig,
} from './features/client-config/client-config';
import {
	ClientConfigAdapter,
	ClientConfigPlanConflictError,
	type ClientConfigChangeAction,
	type ClientConfigChangePlan,
} from './adapters/client-config-adapter';
import { rotateClientRuntimeCredential } from './features/settings/runtime-credentials';
import {
	findOnboardingRuntimePrincipal,
	onboardingEvidenceNotBefore,
	parseOnboardingRecallQuery,
	clearOnboardingClientEvidence,
	clearOnboardingRuntimeEvidence,
	resolveOnboardingSelectedClient,
	buildOnboardingContext,
} from './features/onboarding/onboarding-view-model';
import {
	PLUGIN_DISPLAY_NAME_EN,
	PLUGIN_DISPLAY_NAME_ZH,
	isChineseLanguage,
	ui,
} from './ui/localization';
import {
	LEGACY_AGENT_CONNECTIONS_VIEW,
	TRACEKEEPER_ACTIVITY_VIEW,
	TRACEKEEPER_GRAPH_HEALTH_VIEW,
	TRACEKEEPER_MEMORY_INSPECTOR_VIEW,
	TRACEKEEPER_PERMISSION_POLICY_VIEW,
	TRACEKEEPER_REVIEW_QUEUE_VIEW,
	TRACEKEEPER_RUNTIME_LOG_VIEW,
	TRACEKEEPER_RUNTIME_STATUS_VIEW,
	TRACEKEEPER_SOURCE_STATUS_VIEW,
} from './ui/view-types';
import {
	DEFAULT_MCP_HOST,
	DEFAULT_MCP_HTTP_ENDPOINT,
	DEFAULT_MCP_MAX_STREAMS_PER_SESSION,
	DEFAULT_MCP_PATH,
	DEFAULT_MCP_PORT,
	DEFAULT_MCP_REQUEST_TIMEOUT_MS,
	LEGACY_DEFAULT_MCP_HTTP_ENDPOINTS,
} from './features/runtime/runtime-defaults';
import {
	MEMORY_RULES_VERSION,
	normalizeGraphProfileValue,
	normalizeMemoryProposalRule,
	normalizeNoteContentLanguage,
	normalizeTaskMemoryProposalMode,
	type GraphProfile,
	type MemoryProposalRule,
	type NoteContentLanguageSetting,
	type NoteContentLanguageSource,
	type ResolvedNoteContentLanguage,
	type TaskMemoryProposalMode,
} from './features/settings/settings-model';
import {
	REVIEW_QUEUE_PATH,
	type MemoryReviewQueueSnapshot,
} from './features/review/review-queue-model';
import {
	RUNTIME_LOG_PAGE_SIZE,
	type RuntimeLogCleanupResult,
	type RuntimeLogCleanupScope,
	type RuntimeLogFilter,
	type RuntimeLogSnapshot,
} from './features/runtime/runtime-log-model';
import { InitializeMemoryStructureModal } from './features/structure/initialize-memory-structure-modal';
import { TracekeeperSourceStatusView } from './features/sources/source-status-view';
import { TracekeeperActivityView } from './features/activity/activity-view';
import { TracekeeperReviewQueueView } from './features/review/review-queue-view';
import { TracekeeperGraphHealthView } from './features/graph/graph-health-view';
import { TracekeeperMemoryInspectorView } from './features/memory/memory-inspector-view';
import { TracekeeperRuntimeLogView } from './features/runtime/runtime-log-view';
import { TracekeeperRuntimeStatusView } from './features/runtime/runtime-status-view';
import { TracekeeperPermissionPolicyView } from './features/permissions/permission-policy-view';
import { TracekeeperSettingTab } from './features/settings/tracekeeper-setting-tab';
import {
	LegacyMigrationController,
	type LegacyCleanupResult,
	type LegacyMigrationResult,
	type MemoryInitializationPlan,
	type StructureState,
	type StructureOrganizerSnapshot,
	type TracekeeperStructureStatus,
} from './features/structure/legacy-migration-controller';
import {
	ACTIVITY_TIMELINE_PAGE_SIZE,
	MAX_AGENT_CONNECTION_ROWS,
	MAX_AGENT_TOOL_CALL_ROWS,
	type ActivityTimelineSnapshot,
	type ActivityTimelineItem,
	type AgentActivitySnapshot,
	type AgentConnectionsSnapshot,
	type SourceRequestRecord,
} from './features/activity/activity-model';
import { ActivityDataController } from './features/activity/activity-data-controller';
import {
	firstString,
	parseTimestamp,
	readFrontmatter,
	readKeyValueRows,
	readStringList,
	snippetFromText,
	timestampFromFilename,
	trimText,
} from './features/shared/markdown-record-parser';
import { ActivityRecordRepository, type SourceAnalysisSnapshot } from './features/activity/activity-record-repository';
import { GraphHealthController } from './features/graph/graph-health-controller';
import type { GraphHealthSnapshot } from './features/graph/graph-health-model';
import { ReviewQueueController, type ApprovedWritebackPreview } from './features/review/review-queue-controller';


const MANAGED_AGENT_CLIENT_IDS = ['codex', 'claude-code', 'claude-desktop', 'cursor', 'custom'] as const;
const CONTROL_FILE_PATHS = [
	TRACEKEEPER_SYSTEM_PATH,
	TRACEKEEPER_MEMORY_POLICY_PATH,
	TRACEKEEPER_PERMISSIONS_PATH,
] as const;
const KNOWLEDGE_ENTRY_FILE_PATHS = [
	KNOWLEDGE_INDEX_PATH,
	KNOWLEDGE_MEMORY_INDEX_PATH,
	KNOWLEDGE_PROJECTS_INDEX_PATH,
	KNOWLEDGE_WIKI_INDEX_PATH,
	KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
	KNOWLEDGE_SOURCES_INDEX_PATH,
] as const;
const CONTROL_PATHS = {
	root: TRACEKEEPER_CONTROL_DIR,
	auditLog: TRACEKEEPER_AUDIT_LOG_PATH,
	auditDir: TRACEKEEPER_AUDIT_DIR,
};


const vaultParentFolder = (path: string): string => path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
const BASE_STRUCTURE_FOLDERS: string[] = [
	CONTROL_PATHS.root,
	REVIEW_QUEUE_PATH,
	TRACEKEEPER_WORK_DIR,
	ARCHIVE_ROOT,
	...KNOWLEDGE_ENTRY_FILE_PATHS.map((path) => vaultParentFolder(path)).filter(Boolean),
];


const TRACE_RECALL_RESULT_LIMIT = 8;


const DEFAULT_AUTO_REFRESH_INTERVAL_SECONDS = 15;
const MIN_AUTO_REFRESH_INTERVAL_SECONDS = 5;
const MAX_AUTO_REFRESH_INTERVAL_SECONDS = 120;
const AUTO_REFRESH_DEBOUNCE_MS = 800;


interface BaseStructureFile {
	path: string;
	content: string;
}

interface ResolvedNoteContentLanguageSetting {
	language: ResolvedNoteContentLanguage;
	source: NoteContentLanguageSource;
}


const noteContentText = (language: ResolvedNoteContentLanguage, zh: string, en: string): string =>
	language === 'zh-CN' ? zh : en;


function buildControlFiles(language: ResolvedNoteContentLanguage): BaseStructureFile[] {
	return [
		{
			path: TRACEKEEPER_SYSTEM_PATH,
			content: noteContentText(
				language,
				'# 系统控制\n\nTracekeeper 的 Obsidian 原生记忆系统控制默认值。\n',
				'# System Control\n\nObsidian-native memory system control defaults for Tracekeeper.\n'
			),
		},
		{
			path: TRACEKEEPER_MEMORY_POLICY_PATH,
			content: noteContentText(
				language,
				'# 记忆规则\n\n- 写入需要权限控制。\n- 知识库范围：仅当前 vault 根目录。\n',
				'# Memory Policy\n\n- Writing is permissioned.\n- Vault scope: vault-root only.\n'
			),
		},
		{
			path: TRACEKEEPER_PERMISSIONS_PATH,
			content: noteContentText(
				language,
				'# 权限\n\n- 默认：自动化只读。\n- 写入记忆需要用户确认。\n',
				'# Permissions\n\n- Default: read-only for automation.\n- User confirmation required for memory writes.\n'
			),
		},
	];
}

function buildKnowledgeEntryFiles(language: ResolvedNoteContentLanguage): BaseStructureFile[] {
	return [
		{
			path: KNOWLEDGE_INDEX_PATH,
			content: noteContentText(
				language,
				'# 知识库入口\n\n- [[memory/index|记忆]]\n- [[wiki/index|Wiki]]\n- [[sources/index|来源]]\n',
				'# Knowledge Index\n\n- [[memory/index|Memory]]\n- [[wiki/index|Wiki]]\n- [[sources/index|Sources]]\n'
			),
		},
		{
			path: KNOWLEDGE_MEMORY_INDEX_PATH,
			content: noteContentText(
				language,
				'# 记忆入口\n\n- [[projects/index|项目记忆]]\n',
				'# Memory Index\n\n- [[projects/index|Project memory]]\n'
			),
		},
		{
			path: KNOWLEDGE_PROJECTS_INDEX_PATH,
			content: noteContentText(
				language,
				'# 项目记忆入口\n\n项目级记忆索引放在这里。\n',
				'# Project Memory Index\n\nProject-level memory indexes live here.\n'
			),
		},
		{
			path: KNOWLEDGE_WIKI_INDEX_PATH,
			content: noteContentText(
				language,
				'# Wiki 入口\n\n- [[hubs/index|主题中心]]\n',
				'# Wiki Index\n\n- [[hubs/index|Hubs]]\n'
			),
		},
		{
			path: KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
			content: noteContentText(
				language,
				'# 主题中心\n\n在这里创建主题 hub，并从每个 hub 链接相关记忆。\n',
				'# Wiki Hubs\n\nCreate topic hubs here and link related memory from each hub.\n'
			),
		},
		{
			path: KNOWLEDGE_SOURCES_INDEX_PATH,
			content: noteContentText(
				language,
				'# 来源入口\n\n来源笔记和捕获的参考资料放在这里。\n',
				'# Sources Index\n\nSource notes and captured references live here.\n'
			),
		},
	];
}


export interface RuntimeViewStatus {
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
	recovery: StreamableHttpRuntimeStatus['recovery'];
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


interface TracekeeperSettings {
	memoryRulesVersion: number;
	defaultAgentScope: string;
	mcpRuntimeEnabled: boolean;
	mcpPort: number;
	onboarding: OnboardingSettingsState;
	runtimeToken: string;
	runtimeTokenCreatedAt: string;
	runtimeCredentials: StoredRuntimeCredential[];
	graphProfile: GraphProfile;
	globalMemoryRule: MemoryProposalRule;
	projectMemoryRule: MemoryProposalRule;
	taskMemoryProposalMode: TaskMemoryProposalMode;
	noteContentLanguage: NoteContentLanguageSetting;
	autoRefreshEnabled: boolean;
	autoRefreshIntervalSeconds: number;
}

interface StoredRuntimeCredential extends RuntimeCredential {
	clientId: string;
	createdAt: string;
}

const DEFAULT_SETTINGS: TracekeeperSettings = {
	memoryRulesVersion: MEMORY_RULES_VERSION,
	defaultAgentScope: 'vault',
	mcpRuntimeEnabled: true,
	mcpPort: DEFAULT_MCP_PORT,
	onboarding: {
		...DEFAULT_ONBOARDING_SETTINGS,
		selectedClientId: 'codex',
	},
	runtimeToken: '',
	runtimeTokenCreatedAt: '',
	runtimeCredentials: [],
	graphProfile: 'advisory',
	globalMemoryRule: 'review_queue',
	projectMemoryRule: 'auto_write',
	taskMemoryProposalMode: 'auto_propose',
	noteContentLanguage: 'auto',
	autoRefreshEnabled: true,
	autoRefreshIntervalSeconds: DEFAULT_AUTO_REFRESH_INTERVAL_SECONDS,
};

export default class TracekeeperPlugin extends Plugin {
	settings: TracekeeperSettings = DEFAULT_SETTINGS;
	private mcpRuntime: StreamableHttpMcpRuntime | null = null;
	private localToolExecutor!: LocalToolExecutor;
	private vaultRepository!: ObsidianVaultRepository;
	private knowledgeIndex: ObsidianKnowledgeIndexAdapter | null = null;
	private clientConfigAdapter: ClientConfigAdapter | null = null;
	private legacyMigrationController!: LegacyMigrationController;
	private activityDataController!: ActivityDataController;
	private activityRecordRepository!: ActivityRecordRepository;
	private graphHealthController!: GraphHealthController;
	private reviewQueueController!: ReviewQueueController;
	private autoRefreshIntervalId: number | null = null;
	private autoRefreshDebounceId: number | null = null;
	private autoRefreshInFlight = false;
	private runtimeStatus: StreamableHttpRuntimeStatus = {
		state: 'stopped',
		host: DEFAULT_MCP_HOST,
		port: DEFAULT_MCP_PORT,
		path: DEFAULT_MCP_PATH,
		endpoint: DEFAULT_MCP_HTTP_ENDPOINT,
		startedAt: '',
		activeSessions: 0,
		lastError: '',
		maxSessions: 32,
		maxRequestBytes: 1024 * 1024,
		sessionIdleTtlMs: 30 * 60 * 1000,
		maxStreamsPerSession: DEFAULT_MCP_MAX_STREAMS_PER_SESSION,
		requestTimeoutMs: DEFAULT_MCP_REQUEST_TIMEOUT_MS,
		credentialCount: 0,
		recovery: null,
	};

	async onload() {
		this.settings = this.normalizeSettings(await this.loadData());
		this.legacyMigrationController = new LegacyMigrationController(this.app, {
			initializeMemoryStructure: (plan) => this.initializeMemoryStructure(plan),
			ensureFolderExists: (path) => this.ensureFolderExists(path),
			ensureFileDoesNotExist: (path, content) => this.ensureFileDoesNotExist(path, content),
			normalizeVaultPath: (path) => this.normalizeVaultPath(path),
			appendToAuditLog: (entry) => this.appendToAuditLog(entry),
			refreshGovernanceViews: () => this.refreshGovernanceViews(),
		});
		this.activityRecordRepository = new ActivityRecordRepository(this.app);
		this.graphHealthController = new GraphHealthController({
			executeLocalTool: (name, args) => this.executeLocalTool(name, args),
			refreshGovernanceViews: () => this.refreshGovernanceViews(),
			getVaultRoot: () => this.getVaultRoot(),
			getGraphProfile: () => this.settings.graphProfile,
		});
		this.reviewQueueController = new ReviewQueueController(this.app, this.activityRecordRepository, {
			executeLocalTool: (name, args) => this.executeLocalTool(name, args),
			refreshGovernanceViews: () => this.refreshGovernanceViews(),
			appendToAuditLog: (entry) => this.appendToAuditLog(entry),
			ensureFolderExists: (path) => this.ensureFolderExists(path),
			normalizeVaultPath: (path) => this.normalizeVaultPath(path),
		});
		this.activityDataController = new ActivityDataController(this.app, {
			readRecentAgentTasks: (limit) => this.activityRecordRepository.readRecentAgentTasks(limit),
			readRecentContextPacks: (limit) => this.activityRecordRepository.readRecentContextPacks(limit),
			readRecentSourceCaptures: (limit) => this.activityRecordRepository.readRecentSourceCaptures(limit),
			readRecentSourceRequests: (limit) => this.activityRecordRepository.readRecentSourceRequests(limit),
			readRecentMemoryProposals: (limit) => this.activityRecordRepository.readRecentMemoryProposals(limit),
			getStructureStatus: () => this.getStructureStatus(),
			getRuntimeViewStatus: () => this.getRuntimeViewStatus(),
			getVaultRoot: () => this.getVaultRoot(),
			refreshGovernanceViews: () => this.refreshGovernanceViews(),
			readFrontmatter: (content) => readFrontmatter(content),
			firstString: (values, keys) => firstString(values, keys),
			readStringList: (values, keys) => readStringList(values, keys),
			readKeyValueRows: (lines) => readKeyValueRows(lines),
			parseTimestamp: (timestamp, fallbackMs) => parseTimestamp(timestamp, fallbackMs),
			timestampFromFilename: (filename) => timestampFromFilename(filename),
			snippetFromText: (text, fallback) => snippetFromText(text, fallback),
			trimText: (value, maxLength) => trimText(value, maxLength),
			buildAuditLogHeader: () => this.buildAuditLogHeader(),
			formatAgentDisplayName: (clientName, agentId) => this.formatAgentDisplayName(clientName, agentId),
			formatToolDisplayName: (toolName) => this.formatToolDisplayName(toolName),
			formatResultLabel: (status) => this.formatResultLabel(status),
			formatRiskLabel: (risk) => this.formatRiskLabel(risk),
		});
		await this.saveSettings();
		const desktopApi = this.getDesktopNodeApi();
		this.clientConfigAdapter = desktopApi
			? new ClientConfigAdapter({
				fs: desktopApi.fs,
				path: desktopApi.path,
				getConnectionUrl: (clientId) => this.getMcpConnectionUrl(clientId),
			})
			: null;
		this.vaultRepository = new ObsidianVaultRepository(this.app.vault);
		this.knowledgeIndex = await ObsidianKnowledgeIndexAdapter.create(this.app, this.getVaultRoot());
		this.registerAutoRefreshEvents();
		void this.rebuildKnowledgeIndex(false);
		await this.startMcpRuntime();
		this.localToolExecutor = new LocalToolExecutor({
			getContext: () => this.buildLocalToolExecutionContext(),
		});

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
			id: 'rebuild-knowledge-index',
			name: ui('重建知识索引', 'Rebuild knowledge index'),
			callback: () => {
				void this.rebuildKnowledgeIndex(true);
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
		this.restartAutoRefresh();
	}

	onunload(): void {
		this.stopAutoRefresh();
		this.clientConfigAdapter = null;
		this.knowledgeIndex = null;
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
		next.runtimeCredentials = this.normalizeRuntimeCredentials(saved.runtimeCredentials, next.runtimeToken);
		next.graphProfile = normalizeGraphProfileValue(saved.graphProfile);
		next.onboarding = normalizeOnboardingSettingsState(saved.onboarding);
		const savedMemoryRulesVersion = typeof saved.memoryRulesVersion === 'number' ? saved.memoryRulesVersion : 0;
		next.memoryRulesVersion = MEMORY_RULES_VERSION;
		next.globalMemoryRule = normalizeMemoryProposalRule(saved.globalMemoryRule, DEFAULT_SETTINGS.globalMemoryRule);
		const savedProjectRule = normalizeMemoryProposalRule(saved.projectMemoryRule, DEFAULT_SETTINGS.projectMemoryRule);
		next.projectMemoryRule = savedMemoryRulesVersion < MEMORY_RULES_VERSION && savedProjectRule === 'review_queue'
			? DEFAULT_SETTINGS.projectMemoryRule
			: savedProjectRule;
		const savedTaskMemoryProposalMode = normalizeTaskMemoryProposalMode(saved.taskMemoryProposalMode);
		next.taskMemoryProposalMode = savedMemoryRulesVersion < MEMORY_RULES_VERSION && savedTaskMemoryProposalMode === 'off'
			? DEFAULT_SETTINGS.taskMemoryProposalMode
			: savedTaskMemoryProposalMode;
		next.noteContentLanguage = normalizeNoteContentLanguage(saved.noteContentLanguage);
		next.autoRefreshEnabled = typeof saved.autoRefreshEnabled === 'boolean'
			? saved.autoRefreshEnabled
			: DEFAULT_SETTINGS.autoRefreshEnabled;
		next.autoRefreshIntervalSeconds = this.normalizeAutoRefreshInterval(saved.autoRefreshIntervalSeconds);
		return next;
	}

	private normalizeRuntimeCredentials(raw: unknown, legacyToken: string): StoredRuntimeCredential[] {
		const credentials = new Map<string, StoredRuntimeCredential>();
		if (Array.isArray(raw)) {
			for (const entry of raw) {
				if (!this.isRecord(entry)) {
					continue;
				}
				const id = typeof entry.id === 'string' ? entry.id.trim() : '';
				const clientId = typeof entry.clientId === 'string' ? entry.clientId.trim() : '';
				const token = typeof entry.token === 'string' ? entry.token.trim() : '';
				if (!id || !clientId || !token || credentials.has(clientId)) {
					continue;
				}
				const allowedCapabilities = new Set<ToolCapability | '*'>([
					'*', 'vault.read', 'vault.write', 'memory.propose', 'memory.apply', 'memory.review', 'workflow.manage', 'review-gated.apply',
				]);
				const capabilities: Array<ToolCapability | '*'> = Array.isArray(entry.capabilities)
					? entry.capabilities.filter((value): value is ToolCapability | '*' =>
						typeof value === 'string' && allowedCapabilities.has(value as ToolCapability | '*'))
					: ['*'];
				credentials.set(clientId, {
					id,
					clientId,
					token,
					capabilities: capabilities.length > 0 ? capabilities : ['*'],
					createdAt: this.normalizeTimestamp(entry.createdAt),
				});
			}
		}

		const now = new Date().toISOString();
		credentials.set('legacy', {
			id: 'legacy-shared-token',
			clientId: 'legacy',
			token: legacyToken,
			capabilities: ['*'],
			createdAt: this.normalizeTimestamp(credentials.get('legacy')?.createdAt) || now,
		});
		for (const clientId of MANAGED_AGENT_CLIENT_IDS) {
			if (!credentials.has(clientId)) {
				credentials.set(clientId, {
					id: `client-${clientId}`,
					clientId,
					token: this.generateRuntimeToken(),
					capabilities: ['*'],
					createdAt: now,
				});
			}
		}
		return Array.from(credentials.values());
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

	private normalizeAutoRefreshInterval(value: unknown): number {
		const parsed = typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number.parseInt(value.trim(), 10)
				: Number.NaN;
		if (!Number.isFinite(parsed)) {
			return DEFAULT_AUTO_REFRESH_INTERVAL_SECONDS;
		}
		return Math.min(
			MAX_AUTO_REFRESH_INTERVAL_SECONDS,
			Math.max(MIN_AUTO_REFRESH_INTERVAL_SECONDS, Math.round(parsed))
		);
	}

	resolveNoteContentLanguage(): ResolvedNoteContentLanguageSetting {
		if (this.settings.noteContentLanguage === 'zh-CN' || this.settings.noteContentLanguage === 'en') {
			return {
				language: this.settings.noteContentLanguage,
				source: 'setting',
			};
		}

		const obsidianLanguage = getLanguage();
		if (obsidianLanguage) {
			return {
				language: isChineseLanguage(obsidianLanguage) ? 'zh-CN' : 'en',
				source: 'obsidian',
			};
		}

		const navigatorLanguage = typeof navigator !== 'undefined' && typeof navigator.language === 'string'
			? navigator.language
			: '';
		if (navigatorLanguage) {
			return {
				language: isChineseLanguage(navigatorLanguage) ? 'zh-CN' : 'en',
				source: 'navigator',
			};
		}

		return {
			language: 'en',
			source: 'fallback',
		};
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
		const createdAt = new Date().toISOString();
		this.settings.runtimeToken = this.generateRuntimeToken();
		this.settings.runtimeTokenCreatedAt = createdAt;
		this.settings.runtimeCredentials = this.settings.runtimeCredentials.map((credential) => ({
			...credential,
			token: credential.clientId === 'legacy' ? this.settings.runtimeToken : this.generateRuntimeToken(),
			createdAt,
		}));
		this.settings.onboarding = clearOnboardingRuntimeEvidence(this.settings.onboarding, createdAt);
		await this.saveSettings();
		new Notice(ui('本地连接令牌已重新生成，请更新已配置的 AI 工具。', 'Local connection token regenerated. Update configured AI tools.'));
		await this.restartMcpRuntime();
	}

	async rotateRuntimeCredential(clientId: string): Promise<void> {
		if (!MANAGED_AGENT_CLIENT_IDS.includes(clientId as typeof MANAGED_AGENT_CLIENT_IDS[number])) {
			throw new Error(`Unknown managed Agent client: ${clientId}`);
		}
		const createdAt = new Date().toISOString();
		this.settings.runtimeCredentials = rotateClientRuntimeCredential(
			this.settings.runtimeCredentials,
			clientId,
			this.generateRuntimeToken(),
			createdAt
		);
		if (this.settings.onboarding.selectedClientId === clientId) {
			this.settings.onboarding.clientConfiguredAt = '';
			this.settings.onboarding.agentRestartCompletedAt = '';
			this.settings.onboarding.connectionVerifiedAt = '';
			this.settings.onboarding.firstRecallCompletedAt = '';
			this.settings.onboarding.firstRecallMatchedCount = 0;
			this.settings.onboarding.firstRecallQuery = '';
			this.settings.onboarding.lastUpdatedAt = createdAt;
		}
		await this.saveSettings();
		new Notice(ui(
			'该 Agent 的旧凭据已撤销，请更新其连接配置；其他 Agent 不受影响。',
			'The previous credential for this Agent was revoked. Update its connection config; other Agents are unaffected.'
		));
		await this.restartMcpRuntime();
	}

	async setAutoRefreshEnabled(enabled: boolean): Promise<void> {
		if (this.settings.autoRefreshEnabled === enabled) {
			return;
		}
		this.settings.autoRefreshEnabled = enabled;
		await this.saveSettings();
		this.restartAutoRefresh();
		if (enabled) {
			await this.refreshAutoRefreshViews();
		}
	}

	async setAutoRefreshIntervalSeconds(value: number): Promise<void> {
		const nextInterval = this.normalizeAutoRefreshInterval(value);
		if (this.settings.autoRefreshIntervalSeconds === nextInterval) {
			return;
		}
		this.settings.autoRefreshIntervalSeconds = nextInterval;
		await this.saveSettings();
		this.restartAutoRefresh();
		if (this.settings.autoRefreshEnabled) {
			await this.refreshAutoRefreshViews();
		}
	}

	async setNoteContentLanguage(value: unknown): Promise<void> {
		const nextLanguage = normalizeNoteContentLanguage(value);
		if (this.settings.noteContentLanguage === nextLanguage) {
			return;
		}
		this.settings.noteContentLanguage = nextLanguage;
		await this.saveSettings();
		await this.restartMcpRuntime();
	}

	private registerAutoRefreshEvents(): void {
		this.registerEvent(this.app.vault.on('create', (file) => {
			void this.updateKnowledgeIndex(() => this.knowledgeIndex?.applyCreate(file));
			this.scheduleAutoRefreshForFile(file);
		}));
		this.registerEvent(this.app.vault.on('modify', (file) => {
			void this.updateKnowledgeIndex(() => this.knowledgeIndex?.applyModify(file));
			this.scheduleAutoRefreshForFile(file);
		}));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			void this.updateKnowledgeIndex(() => this.knowledgeIndex?.applyDelete(file));
			this.scheduleAutoRefreshForFile(file);
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			void this.updateKnowledgeIndex(() => this.knowledgeIndex?.applyRename(file, oldPath));
			this.scheduleAutoRefreshForFile(file);
			this.scheduleAutoRefreshForPath(oldPath);
		}));
	}

	private async updateKnowledgeIndex(update: () => Promise<void> | undefined): Promise<void> {
		try {
			await update();
		} catch (error) {
			console.error('tracekeeper failed to update the knowledge index', error);
		}
	}

	async rebuildKnowledgeIndex(showNotice: boolean): Promise<void> {
		const index = this.knowledgeIndex;
		if (!index) {
			return;
		}
		try {
			const report = await index.rebuild();
			if (showNotice) {
				new Notice(ui(
					`知识索引已重建，共 ${report.note_count} 篇笔记。`,
					`Knowledge index rebuilt with ${report.note_count} notes.`
				));
			}
		} catch (error) {
			console.error('tracekeeper failed to rebuild the knowledge index', error);
			if (showNotice) {
				const message = error instanceof Error ? error.message : String(error);
				new Notice(ui(`知识索引重建失败：${message}`, `Knowledge index rebuild failed: ${message}`));
			}
		}
	}

	private restartAutoRefresh(): void {
		this.stopAutoRefresh();
		if (!this.settings.autoRefreshEnabled) {
			return;
		}
		const intervalMs = this.normalizeAutoRefreshInterval(this.settings.autoRefreshIntervalSeconds) * 1000;
		this.autoRefreshIntervalId = window.setInterval(() => {
			void this.refreshAutoRefreshViews();
		}, intervalMs);
	}

	private stopAutoRefresh(): void {
		if (this.autoRefreshIntervalId !== null) {
			window.clearInterval(this.autoRefreshIntervalId);
			this.autoRefreshIntervalId = null;
		}
		if (this.autoRefreshDebounceId !== null) {
			window.clearTimeout(this.autoRefreshDebounceId);
			this.autoRefreshDebounceId = null;
		}
	}

	private scheduleAutoRefreshForFile(file: TAbstractFile): void {
		this.scheduleAutoRefreshForPath(file.path);
	}

	private scheduleAutoRefreshForPath(path: string): void {
		if (!this.settings.autoRefreshEnabled || !this.isAutoRefreshRelevantPath(path) || !this.hasAutoRefreshTargetViews()) {
			return;
		}
		if (this.autoRefreshDebounceId !== null) {
			window.clearTimeout(this.autoRefreshDebounceId);
		}
		this.autoRefreshDebounceId = window.setTimeout(() => {
			this.autoRefreshDebounceId = null;
			void this.refreshAutoRefreshViews();
		}, AUTO_REFRESH_DEBOUNCE_MS);
	}

	private hasAutoRefreshTargetViews(): boolean {
		return this.app.workspace.getLeavesOfType(TRACEKEEPER_ACTIVITY_VIEW).length > 0
			|| this.app.workspace.getLeavesOfType(TRACEKEEPER_REVIEW_QUEUE_VIEW).length > 0;
	}

	private isAutoRefreshRelevantPath(path: string): boolean {
		const normalized = path.replace(/\\/g, '/');
		const relevantDirs = [
			TRACEKEEPER_REVIEW_QUEUE_DIR,
			TRACEKEEPER_TASKS_DIR,
			TRACEKEEPER_SESSIONS_DIR,
			TRACEKEEPER_CONTEXT_PACKS_DIR,
			TRACEKEEPER_AGENT_REQUESTS_DIR,
			TRACEKEEPER_AUDIT_DIR,
			KNOWLEDGE_GLOBAL_MEMORY_DIR,
			KNOWLEDGE_PROJECTS_MEMORY_DIR,
		];
		return normalized === TRACEKEEPER_AUDIT_LOG_PATH
			|| relevantDirs.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
	}

	private async refreshAutoRefreshViews(): Promise<void> {
		if (!this.settings.autoRefreshEnabled || this.autoRefreshInFlight || !this.hasAutoRefreshTargetViews()) {
			return;
		}
		this.autoRefreshInFlight = true;
		try {
			const tasks: Array<Promise<void>> = [];
			if (this.app.workspace.getLeavesOfType(TRACEKEEPER_ACTIVITY_VIEW).length > 0) {
				tasks.push(this.refreshActivityViews());
			}
			if (this.app.workspace.getLeavesOfType(TRACEKEEPER_REVIEW_QUEUE_VIEW).length > 0) {
				tasks.push(this.refreshReviewQueueViews());
			}
			await Promise.all(tasks);
		} catch (error) {
			console.error('tracekeeper failed to auto-refresh views', error);
		} finally {
			this.autoRefreshInFlight = false;
		}
	}

	private async startMcpRuntime(): Promise<void> {
		if (!this.settings.mcpRuntimeEnabled) {
			this.runtimeStatus = this.createStoppedRuntimeStatus();
			return;
		}
		const vaultRoot = this.getVaultRoot();
		const noteContentLanguage = this.resolveNoteContentLanguage();
		const runtimeOptions: StreamableHttpRuntimeOptionsWithGraphProfile = {
			host: DEFAULT_MCP_HOST,
			port: this.settings.mcpPort,
			path: DEFAULT_MCP_PATH,
			credentials: this.settings.runtimeCredentials,
			maxStreamsPerSession: DEFAULT_MCP_MAX_STREAMS_PER_SESSION,
			requestTimeoutMs: DEFAULT_MCP_REQUEST_TIMEOUT_MS,
			defaultVaultRoot: vaultRoot,
			vaultConfigDir: this.app.vault.configDir,
			vaultRepository: this.vaultRepository,
			knowledgeSnapshotProvider: (requestedVaultRoot) => this.knowledgeIndex?.scanSnapshot(requestedVaultRoot) ?? null,
			contentLanguage: noteContentLanguage.language,
			contentLanguageSource: noteContentLanguage.source,
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
			maxSessions: 32,
			maxRequestBytes: 1024 * 1024,
			sessionIdleTtlMs: 30 * 60 * 1000,
			maxStreamsPerSession: DEFAULT_MCP_MAX_STREAMS_PER_SESSION,
			requestTimeoutMs: DEFAULT_MCP_REQUEST_TIMEOUT_MS,
			credentialCount: this.settings.runtimeCredentials.length,
			recovery: null,
		};
	}

	async openInitializeMemoryStructureModal(): Promise<void> {
		const snapshot = await this.buildStructureOrganizerSnapshot();
		new InitializeMemoryStructureModal(this.app, {
			plugin: this,
			snapshot,
		}).open();
	}

	async buildStructureOrganizerSnapshot(migrationId = this.legacyMigrationController.createStructureMigrationId()): Promise<StructureOrganizerSnapshot> {
		const basePlan = this.buildInitializationPlan();
		const legacyPlan = await this.legacyMigrationController.buildLegacyStructurePlan(migrationId);
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
		for (const filePath of [...CONTROL_FILE_PATHS, ...KNOWLEDGE_ENTRY_FILE_PATHS]) {
			if (!this.app.vault.getAbstractFileByPath(filePath)) {
				filesToCreate.push(filePath);
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


	getStructureStatus(): TracekeeperStructureStatus {
		const plan = this.buildInitializationPlan();
		const totalFolders = this.getNormalizedFolderPlan().length;
		const expectedFiles = new Set<string>([...CONTROL_FILE_PATHS, ...KNOWLEDGE_ENTRY_FILE_PATHS]);
		expectedFiles.add(CONTROL_PATHS.auditLog);
		const missingCount = plan.foldersToCreate.length + plan.filesToCreate.length;
		const totalCount = totalFolders + expectedFiles.size;
		const rootExists = this.app.vault.getAbstractFileByPath(CONTROL_PATHS.root) !== null;
		const legacyRoots = this.legacyMigrationController.getLegacyRootFolders();
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

			const contentLanguage = this.resolveNoteContentLanguage().language;
			const baseFiles = [
				...buildControlFiles(contentLanguage),
				...buildKnowledgeEntryFiles(contentLanguage),
			];
			for (const controlFile of baseFiles.filter((file) =>
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
		return this.legacyMigrationController.migrateLegacyStructure(snapshot);
	}

	async cleanupLegacyStructure(migrationId: string): Promise<LegacyCleanupResult> {
		return this.legacyMigrationController.cleanupLegacyStructure(migrationId);
	}


	private buildAuditLogHeader(): string {
		return noteContentText(this.resolveNoteContentLanguage().language, '# 审计日志\n\n', '# Audit Log\n\n');
	}

	private async appendAuditEvent(plan: MemoryInitializationPlan): Promise<void> {
		const now = new Date().toISOString();
		const event = this.renderAuditEvent(now, plan.foldersToCreate.length, plan.filesToCreate.length);
		await this.appendToAuditLog(event);
	}

	private renderAuditEvent(timestamp: string, folderCount: number, fileCount: number): string {
		return `## ${timestamp}\naction: structure.repair\nactor: user\nfolders_created: ${folderCount}\nfiles_created: ${fileCount}\nresult: success\n\n`;
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
		return this.activityRecordRepository.loadSourceStatusSnapshot();
	}





	async loadAgentActivitySnapshot(): Promise<AgentActivitySnapshot> {
		return this.activityDataController.loadAgentActivitySnapshot();
	}

	async loadActivityTimelineSnapshot(page = 1, pageSize = ACTIVITY_TIMELINE_PAGE_SIZE): Promise<ActivityTimelineSnapshot> {
		return this.activityDataController.loadActivityTimelineSnapshot(page, pageSize);
	}

	async loadRuntimeLogSnapshot(page = 1, filter: RuntimeLogFilter = 'all', pageSize = RUNTIME_LOG_PAGE_SIZE): Promise<RuntimeLogSnapshot> {
		return this.activityDataController.loadRuntimeLogSnapshot(page, filter, pageSize);
	}

	async cleanRuntimeLogs(scope: RuntimeLogCleanupScope): Promise<RuntimeLogCleanupResult> {
		return this.activityDataController.cleanRuntimeLogs(scope);
	}


	async loadAgentConnectionsSnapshot(): Promise<AgentConnectionsSnapshot> {
		const auditLogMissing =
			this.app.vault.getAbstractFileByPath(CONTROL_PATHS.auditLog) === null;
		const auditDirMissing =
			this.app.vault.getAbstractFileByPath(CONTROL_PATHS.auditDir) === null;
		const auditEvents = await this.activityDataController.readRecentAuditEvents(80);
		const toolCalls = auditEvents
			.filter((event) => this.activityDataController.isToolCallAuditEvent(event))
			.map((event) => this.activityDataController.toAgentToolCallRecord(event))
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, MAX_AGENT_TOOL_CALL_ROWS);
		const recentAgents = this.activityDataController.buildRecentAgentConnections(auditEvents, toolCalls)
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
		return this.graphHealthController.loadGraphHealthSnapshot();
	}

	async createGraphHealthReviewProposal(snapshot: GraphHealthSnapshot): Promise<string> {
		return this.graphHealthController.createGraphHealthReviewProposal(snapshot);
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
				configText: buildClientConfigText(profile, (clientId) => this.getMcpConnectionUrl(clientId)),
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

		const adapter = this.clientConfigAdapter;
		if (!adapter) {
			return {
				state: 'unavailable',
				label: ui('未配置', 'Not configured'),
				detail: ui('当前环境不支持自动读取配置文件。', 'This environment cannot read the config file automatically.'),
			};
		}

		try {
			return adapter.verifyInstalledConfig(profile, ui);
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
		return buildClientProfiles(
			homeDir,
			ui,
			desktopApi?.path.join.bind(desktopApi?.path)
		);
	}

	getMcpHttpEndpoint(): string {
		return `http://${DEFAULT_MCP_HOST}:${this.settings.mcpPort || DEFAULT_MCP_PORT}${DEFAULT_MCP_PATH}`;
	}

	getMcpConnectionUrl(clientId = 'legacy'): string {
		const token = this.settings.runtimeCredentials.find((credential) => credential.clientId === clientId)?.token
			|| this.settings.runtimeToken
			|| '';
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
			recovery: status.recovery,
		};
	}

	async getKnowledgeIndexViewStatus(): Promise<{
		state: 'initializing' | 'rebuilding' | 'ready';
		generation: number;
		noteCount: number;
		lastRebuild: string;
	}> {
		const snapshot = await this.knowledgeIndex?.knowledgeSnapshot();
		return {
			state: snapshot?.index_state ?? 'initializing',
			generation: snapshot?.generation ?? 0,
			noteCount: snapshot?.notes.size ?? 0,
			lastRebuild: snapshot?.last_rebuild ?? '',
		};
	}

	isVaultStructureReady(): boolean {
		const plan = this.buildInitializationPlan();
		return plan.foldersToCreate.length === 0 && plan.filesToCreate.length === 0;
	}

	getOnboardingContext(
		snapshot: AgentConnectionsSnapshot,
		vaultReady: boolean
	): OnboardingProgressContext {
		const selectedClient = this.getOnboardingSelectedClient(snapshot);
		return buildOnboardingContext({
			vaultReady,
			runtimeState: snapshot.runtimeStatus.state,
			runtimeEnabled: this.settings.mcpRuntimeEnabled,
			selectedClient: selectedClient ? {
				clientId: selectedClient.clientId,
				configState: selectedClient.configState,
			} : null,
			onboarding: this.settings.onboarding,
		});
	}

	getOnboardingSelectedClient(snapshot: AgentConnectionsSnapshot): GeneratedClientConfig | null {
		const resolved = resolveOnboardingSelectedClient(
			this.settings.onboarding,
			snapshot.clientConfigs.map((config) => ({
				clientId: config.clientId,
				configState: config.configState,
			})),
			new Date().toISOString()
		);
		this.settings.onboarding = resolved.state;
		if (this.settings.onboarding.selectedClientId !== resolved.selectedClientId) {
			this.settings.onboarding.selectedClientId = resolved.selectedClientId;
		}
		return snapshot.clientConfigs.find((config) => config.clientId === resolved.selectedClientId) || null;
	}

	private async persistOnboardingState(): Promise<void> {
		this.settings.onboarding.lastUpdatedAt = new Date().toISOString();
		await this.saveSettings();
	}

	async setOnboardingClientId(clientId: string): Promise<void> {
		if (this.settings.onboarding.selectedClientId === clientId) {
			return;
		}
		this.settings.onboarding.selectedClientId = clientId;
		this.settings.onboarding = clearOnboardingClientEvidence(this.settings.onboarding);
		await this.persistOnboardingState();
	}

	async markOnboardingClientConfigured(): Promise<void> {
		const selected = this.settings.onboarding.selectedClientId || '';
		if (!selected) {
			return;
		}
		this.settings.onboarding = markClientConfigured(this.settings.onboarding, selected);
		await this.persistOnboardingState();
	}

	async markOnboardingSkillSetup(): Promise<void> {
		if (this.settings.onboarding.skillSetupCompletedAt) {
			return;
		}
		this.settings.onboarding = markSkillSetupDone(this.settings.onboarding);
		await this.persistOnboardingState();
	}

	async markOnboardingAgentRestart(): Promise<void> {
		if (this.settings.onboarding.agentRestartCompletedAt) {
			return;
		}
		this.settings.onboarding = markAgentRestartDone(this.settings.onboarding);
		await this.persistOnboardingState();
	}

	async verifyOnboardingConnection(): Promise<void> {
		if (!this.settings.mcpRuntimeEnabled || this.getRuntimeViewStatus().state !== 'running') {
			throw new Error(ui('请先启动 MCP 服务，再进行连接验证。', 'Enable and start MCP service before connection verification.'));
		}
		const principalId = findOnboardingRuntimePrincipal(
			this.settings.runtimeCredentials,
			this.settings.onboarding.selectedClientId
		);
		const snapshot = await this.loadAgentConnectionsSnapshot();
		const notBefore = onboardingEvidenceNotBefore(this.settings.onboarding);
		if (!hasOnboardingConnectionEvidence(snapshot.recentAgents, principalId, notBefore)) {
			throw new Error(ui(
				'尚未发现所选 Agent 使用其独立凭据建立的 MCP 会话。请重启 Agent 并让它调用一次 Tracekeeper。',
				'No MCP session from the selected agent credential was found. Restart the agent and ask it to call Tracekeeper once.'
			));
		}
		if (!this.settings.onboarding.connectionVerifiedAt) {
			this.settings.onboarding = markConnectionVerified(this.settings.onboarding);
			await this.persistOnboardingState();
		}
	}

	async verifyOnboardingFirstRecall(): Promise<void> {
		const principalId = findOnboardingRuntimePrincipal(
			this.settings.runtimeCredentials,
			this.settings.onboarding.selectedClientId
		);
		const snapshot = await this.loadAgentConnectionsSnapshot();
		const notBefore = onboardingEvidenceNotBefore(this.settings.onboarding);
		const recall = findOnboardingRecallEvidence(snapshot.recentToolCalls, principalId, notBefore);
		if (!recall) {
			throw new Error(ui(
				'尚未发现所选 Agent 成功执行且有命中结果的 tracekeeper.recall。请先在 Agent 中发起一次窄范围召回。',
				'No successful tracekeeper.recall with matches was found for the selected agent. Ask the agent to run a narrow recall first.'
			));
		}
		await this.markOnboardingFirstRecall(parseOnboardingRecallQuery(recall.argsSummary), recall.matchedCount);
	}

	private async markOnboardingFirstRecall(query: string, resultCount: number): Promise<void> {
		const next = markFirstRecallDone(this.settings.onboarding, resultCount, query);
		if (next.firstRecallCompletedAt === this.settings.onboarding.firstRecallCompletedAt
			&& next.firstRecallMatchedCount === this.settings.onboarding.firstRecallMatchedCount
			&& next.firstRecallQuery === this.settings.onboarding.firstRecallQuery) {
			return;
		}
		this.settings.onboarding = next;
		await this.persistOnboardingState();
	}

	async resetOnboardingProgress(): Promise<void> {
		this.settings.onboarding = resetOnboardingState();
		await this.persistOnboardingState();
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

	async executeLocalTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
		return this.localToolExecutor.executeLocalTool(name, args);
	}

	private buildLocalToolExecutionContext(): import('./composition/local-tool-executor').LocalToolExecutorContext {
		const noteContentLanguage = this.resolveNoteContentLanguage();
		return {
			defaultVaultRoot: this.getVaultRoot(),
			vaultConfigDir: this.app.vault.configDir,
			vaultRepository: this.vaultRepository,
			knowledgeSnapshotProvider: (requestedVaultRoot) => this.knowledgeIndex?.scanSnapshot(requestedVaultRoot) ?? null,
			graphProfile: this.settings.graphProfile,
			memoryRules: {
				globalMemoryRule: this.settings.globalMemoryRule,
				projectMemoryRule: this.settings.projectMemoryRule,
				taskMemoryProposalMode: this.settings.taskMemoryProposalMode,
			},
			contentLanguage: noteContentLanguage.language,
			contentLanguageSource: noteContentLanguage.source,
		};
	}

	async processSourceRequest(request: SourceRequestRecord): Promise<void> {
		const args: Record<string, unknown> = { request_path: request.path };
		if (request.taskId) {
			args.task_id = request.taskId;
		}
		await this.executeLocalTool('tracekeeper.source_request', {
			...args,
			action: 'analyze',
		});
		await this.refreshGovernanceViews();
	}

	async previewApprovedWriteback(proposal: MemoryProposalRecord): Promise<ApprovedWritebackPreview> {
		return this.reviewQueueController.previewApprovedWriteback(proposal);
	}

	async applyApprovedWriteback(proposal: MemoryProposalRecord): Promise<void> {
		return this.reviewQueueController.applyApprovedWriteback(proposal);
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
		const result = await this.executeLocalTool('tracekeeper.recall', args);
		return parseMemoryRecallResult(
			result,
			{ query, scope, projectHint, sourceTool: 'tracekeeper.recall' },
			{
				unknownPathLabel: ui('未知路径', 'Unknown path'),
				unknownTitleLabel: ui('未知标题', 'Unknown title'),
				unknownTypeLabel: ui('笔记', 'Note'),
				noDisplayLabel: ui('缺少可展示字段', 'No display fields available'),
				noReasonLabel: ui('暂无说明', 'No reason provided'),
				scopeLabel: (labelScope) => this.memoryRecallScopeLabel(labelScope),
			}
		);
	}

	normalizeMemoryRecallScope(scope: string): TracekeeperRecallScope {
		return normalizeMemoryRecallScope(scope);
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

	prepareClientConfigChange(
		config: GeneratedClientConfig,
		action: ClientConfigChangeAction
	): ClientConfigChangePlan {
		return this.requireClientConfigAdapter(config).previewChange(config, action);
	}

	async applyClientConfig(config: GeneratedClientConfig, planId: string): Promise<void> {
		try {
			const result = this.requireClientConfigAdapter(config).applyConfirmedChange(planId);
			if (config.clientId) {
				this.settings.onboarding = markClientConfigured(this.settings.onboarding, config.clientId);
				this.settings.onboarding.agentRestartCompletedAt = '';
				this.settings.onboarding.connectionVerifiedAt = '';
				this.settings.onboarding.firstRecallCompletedAt = '';
				this.settings.onboarding.firstRecallMatchedCount = 0;
				this.settings.onboarding.firstRecallQuery = '';
				await this.persistOnboardingState();
			}
			this.queueClientConfigAuditEvent('client_config_applied', config, 'success', result.backupPath);
			new Notice(ui('已写入知识库连接配置，请重启对应 AI 工具。', 'Tracekeeper connection config written. Restart the AI tool.'));
			this.queueRuntimeLogRefresh();
		} catch (error) {
			console.error('tracekeeper failed to apply client config', error);
			this.queueClientConfigAuditEvent('client_config_failed', config, 'failed');
			new Notice(error instanceof ClientConfigPlanConflictError
				? ui('配置在预览后已变化，请重新预览再确认。', 'Config changed after preview. Preview it again before confirming.')
				: ui('写入连接配置失败。', 'Failed to write connection config.'));
			throw error;
		}
	}

	async removeClientConfig(config: GeneratedClientConfig, planId: string): Promise<void> {
		try {
			const result = this.requireClientConfigAdapter(config).removeConfirmedChange(planId);
			if (config.clientId === this.settings.onboarding.selectedClientId) {
				this.settings.onboarding = clearOnboardingClientEvidence(this.settings.onboarding);
				await this.persistOnboardingState();
			}
			this.queueClientConfigAuditEvent('client_config_removed', config, 'success', result.backupPath);
			new Notice(ui('已移除配置，请重启对应 AI 工具。', 'Config removed. Restart the AI tool.'));
			this.queueRuntimeLogRefresh();
		} catch (error) {
			console.error('tracekeeper failed to remove client config', error);
			this.queueClientConfigAuditEvent('client_config_failed', config, 'failed');
			new Notice(error instanceof ClientConfigPlanConflictError
				? ui('配置在预览后已变化，请重新预览再确认。', 'Config changed after preview. Preview it again before confirming.')
				: ui('移除配置失败。', 'Failed to remove config.'));
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

	private requireClientConfigAdapter(config: GeneratedClientConfig): ClientConfigAdapter {
		if (!this.clientConfigAdapter || !config.targetPath || !config.supportsAutoConfigure) {
			throw new Error(`Client auto-configuration is not supported for ${config.clientId}.`);
		}
		return this.clientConfigAdapter;
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


	async loadMemoryReviewQueueSnapshot(): Promise<MemoryReviewQueueSnapshot> {
		return this.reviewQueueController.loadMemoryReviewQueueSnapshot();
	}



	async updateMemoryProposalStatus(
		proposal: MemoryProposalRecord,
		nextStatus: MemoryProposalStatus,
		options: {
			clearRevision?: boolean;
			revisionComment?: string;
		} = {}
	): Promise<void> {
		return this.reviewQueueController.updateMemoryProposalStatus(proposal, nextStatus, options);
	}

	async archiveMemoryProposals(proposals: MemoryProposalRecord[]): Promise<number> {
		return this.reviewQueueController.archiveMemoryProposals(proposals);
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
			body.createEl('div', { text: trimText(item.body, 160) });
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
		return trimText(raw, 28);
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
				return status ? trimText(status, 40) : ui('未知', 'Unknown');
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
				return riskLevel ? trimText(riskLevel, 40) : ui('未标记', 'Unmarked');
		}
	}
}
