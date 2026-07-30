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
import {
	LOCAL_TRUST_CAPABILITIES,
	StreamableHttpMcpRuntime,
	type StreamableHttpRuntimeStatus,
	type RuntimeState,
} from '@tracekeeper/mcp-runtime';
import { LocalToolExecutor } from './composition/local-tool-executor';
import {
	ARCHIVE_ROOT,
	KNOWLEDGE_GLOBAL_MEMORY_DIR,
	KNOWLEDGE_INDEX_PATH,
	KNOWLEDGE_MEMORY_DIR,
	KNOWLEDGE_MEMORY_INDEX_PATH,
	KNOWLEDGE_PROJECTS_MEMORY_DIR,
	KNOWLEDGE_PROJECTS_INDEX_PATH,
	KNOWLEDGE_SOURCES_DIR,
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
import {
	DEFAULT_ONBOARDING_SETTINGS,
	OnboardingSettingsState,
	findOnboardingConnectionEvidence,
	findOnboardingRecallEvidence,
	findOnboardingTrackedWorkflowEvidence,
	getNextOnboardingStep,
	markAgentRestartDone,
	markClientConfigured,
	markConnectionVerified,
	markFirstRecallDone,
	markMemoryPolicyConfirmed,
	markSkillCopied,
	markSkillFileVerified,
	markSkillUserConfirmed,
	markTrackedWorkflowObserved,
	markOnboardingEntryPromptDeferred,
	markOnboardingEntryPromptOpened,
	normalizeOnboardingSettingsState,
	OnboardingProgressContext,
	resetOnboardingState,
	shouldShowOnboardingEntryPrompt,
} from './features/onboarding/onboarding-state';
import {
	buildGeneratedClientSetup,
	buildClientProfiles,
	type ClientPairingTicket,
	type ClientPairingTicketStatus,
	type ClientProfile,
	type GeneratedClientConfig,
} from './features/client-config/client-config';
import {
	ClientConfigAdapter,
	ClientConfigPlanConflictError,
	type ClientConfigChangeAction,
	type ClientConfigChangePlan,
} from './adapters/client-config-adapter';
import {
	ClientSkillAdapter,
	ClientSkillPlanConflictError,
	buildClientSkillProfile,
	type ClientSkillProfile,
	type SkillInstallAction,
	type SkillInstallPlan,
	type SkillInstallResult,
	type SkillInstallState,
} from './adapters/client-skill-adapter';
import { TRACEKEEPER_SKILL_BUNDLE } from './features/skill-installation/skill-bundle';
import { buildSkillInstallAuditEntry } from './features/skill-installation/skill-install-audit';
import {
	normalizeSkillInstallReceipts,
	recordSkillInstallReceipt,
	type SkillInstallReceipts,
} from './features/skill-installation/skill-install-receipts';
import {
	isRuntimeAccessToken,
	normalizeLocalTrustSettings,
	stripLegacyConnectionSettings,
} from './features/settings/local-trust-settings';
import {
	onboardingEvidenceNotBefore,
	parseOnboardingRecallQuery,
	clearOnboardingAgentBehaviorEvidence,
	clearOnboardingClientEvidence,
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
	normalizeMemoryRuleSettings,
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
import { OnboardingEntryModal } from './features/onboarding/onboarding-entry-modal';
import { TracekeeperSourceStatusView } from './features/sources/source-status-view';
import { TracekeeperActivityView } from './features/activity/activity-view';
import { TracekeeperReviewQueueView } from './features/review/review-queue-view';
import { TracekeeperGraphHealthView } from './features/graph/graph-health-view';
import { TracekeeperMemoryInspectorView } from './features/memory/memory-inspector-view';
import { TracekeeperRuntimeLogView } from './features/runtime/runtime-log-view';
import { TracekeeperRuntimeStatusView } from './features/runtime/runtime-status-view';
import { McpRuntimeLifecycleController } from './features/runtime/runtime-lifecycle-controller';
import {
	RuntimeAccessResetController,
	type RuntimeAccessResetResult,
} from './features/runtime/runtime-access-reset-controller';
import { runtimeViewModel } from './features/runtime/runtime-view-model';
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
import { ActivityRecordRepository } from './features/activity/activity-record-repository';
import { GraphHealthController } from './features/graph/graph-health-controller';
import type { GraphHealthSnapshot } from './features/graph/graph-health-model';
import { ReviewQueueController, type ApprovedWritebackPreview } from './features/review/review-queue-controller';
import type { ReviewKnowledgeSnapshot } from './features/review/review-context-model';
import {
	KNOWLEDGE_RELATIONSHIP_READ_LIMIT,
	buildMemoryInspectorSnapshot,
	buildSourceStatusSnapshot,
	type KnowledgeIndexEvidence,
	type MemoryInspectorQuery,
	type MemoryInspectorSnapshot,
	type SourceStatusQuery,
	type SourceStatusSnapshot,
} from './features/observability/knowledge-observability-model';
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
	accessProtected: boolean;
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
		rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
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
	runtimeAccessToken: string;
	onboarding: OnboardingSettingsState;
	skillInstallReceipts: SkillInstallReceipts;
	graphProfile: GraphProfile;
	globalMemoryRule: MemoryProposalRule;
	projectMemoryRule: MemoryProposalRule;
	taskMemoryProposalMode: TaskMemoryProposalMode;
	noteContentLanguage: NoteContentLanguageSetting;
	autoRefreshEnabled: boolean;
	autoRefreshIntervalSeconds: number;
}

const DEFAULT_SETTINGS: TracekeeperSettings = {
	memoryRulesVersion: MEMORY_RULES_VERSION,
	defaultAgentScope: 'vault',
	mcpRuntimeEnabled: true,
	mcpPort: DEFAULT_MCP_PORT,
	runtimeAccessToken: '',
	onboarding: {
		...DEFAULT_ONBOARDING_SETTINGS,
		selectedClientId: 'codex',
	},
	skillInstallReceipts: {},
	graphProfile: 'advisory',
	globalMemoryRule: 'review_queue',
	projectMemoryRule: 'review_queue',
	taskMemoryProposalMode: 'auto_propose',
	noteContentLanguage: 'auto',
	autoRefreshEnabled: true,
	autoRefreshIntervalSeconds: DEFAULT_AUTO_REFRESH_INTERVAL_SECONDS,
};

export default class TracekeeperPlugin extends Plugin {
	settings: TracekeeperSettings = DEFAULT_SETTINGS;
	private readonly mcpRuntimeLifecycle = new McpRuntimeLifecycleController();
	private readonly runtimeAccessResetController = new RuntimeAccessResetController({
		getAccessToken: () => this.settings.runtimeAccessToken,
		setAccessToken: (value) => {
			this.settings.runtimeAccessToken = value;
		},
		isRuntimeEnabled: () => this.settings.mcpRuntimeEnabled,
		stopRuntime: () => this.stopMcpRuntimeForAccessReset(),
		persistSettings: () => this.saveSettings(),
		startRuntime: () => this.startMcpRuntimeForAccessReset(),
	});
	private localToolExecutor!: LocalToolExecutor;
	private vaultRepository!: ObsidianVaultRepository;
	private knowledgeIndex: ObsidianKnowledgeIndexAdapter | null = null;
	private clientConfigAdapter: ClientConfigAdapter | null = null;
	private clientSkillAdapter: ClientSkillAdapter | null = null;
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
			loadReviewKnowledgeSnapshot: () => this.loadReviewKnowledgeSnapshot(),
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
				getConnectionUrl: () => this.getMcpConnectionUrl(),
				getAccessToken: () => this.settings.runtimeAccessToken,
			})
			: null;
		this.clientSkillAdapter = desktopApi
			? new ClientSkillAdapter({
				fs: desktopApi.fs,
				path: desktopApi.path,
				bundle: TRACEKEEPER_SKILL_BUNDLE,
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
			(leaf) => new TracekeeperMemoryInspectorView(leaf, this)
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
			name: ui('打开知识变更审核', 'Open Knowledge Change Review'),
			callback: () => {
				void this.openPluginView(TRACEKEEPER_REVIEW_QUEUE_VIEW);
			},
		});

		this.addCommand({
			id: 'open-memory-inspector',
			name: ui('打开记忆查看', 'Open memory view'),
			callback: () => {
				void this.openMemoryInspector();
			},
		});

		this.addCommand({
			id: 'open-source-status',
			name: ui('打开来源状态', 'Open source status'),
			callback: () => {
				void this.openSourceStatus();
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

		this.addCommand({
			id: 'continue-agent-onboarding',
			name: ui('继续 Agent 接入', 'Continue agent onboarding'),
			callback: () => {
				this.openSettingsTab();
			},
		});

		this.addSettingTab(new TracekeeperSettingTab(this.app, this));
		this.restartAutoRefresh();
		this.app.workspace.onLayoutReady(() => {
			this.openOnboardingEntryIfNeeded();
		});
	}

	onunload(): void {
		this.stopAutoRefresh();
		this.clientConfigAdapter = null;
		this.clientSkillAdapter = null;
		void this.closeMcpRuntime();
	}

	private normalizeSettings(raw: unknown): TracekeeperSettings {
		const saved = normalizeLocalTrustSettings(raw) as Partial<TracekeeperSettings>
			& Record<string, unknown>
			& { runtimeAccessToken: string };
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
		next.runtimeAccessToken = saved.runtimeAccessToken;
		next.graphProfile = normalizeGraphProfileValue(saved.graphProfile);
		next.onboarding = normalizeOnboardingSettingsState(saved.onboarding);
		next.skillInstallReceipts = normalizeSkillInstallReceipts(saved.skillInstallReceipts);
		const memoryRules = normalizeMemoryRuleSettings(saved, DEFAULT_SETTINGS);
		next.memoryRulesVersion = memoryRules.memoryRulesVersion;
		next.globalMemoryRule = memoryRules.globalMemoryRule;
		next.projectMemoryRule = memoryRules.projectMemoryRule;
		next.taskMemoryProposalMode = memoryRules.taskMemoryProposalMode;
		next.noteContentLanguage = normalizeNoteContentLanguage(saved.noteContentLanguage);
		next.autoRefreshEnabled = typeof saved.autoRefreshEnabled === 'boolean'
			? saved.autoRefreshEnabled
			: DEFAULT_SETTINGS.autoRefreshEnabled;
		next.autoRefreshIntervalSeconds = this.normalizeAutoRefreshInterval(saved.autoRefreshIntervalSeconds);
		return next;
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

	async restartMcpRuntime(): Promise<void> {
		if (this.settings.mcpRuntimeEnabled) {
			await this.replaceMcpRuntime();
		} else {
			await this.stopMcpRuntime();
		}
		await this.refreshGovernanceViews();
	}

	async resetRuntimeAccessCredential(): Promise<RuntimeAccessResetResult> {
		try {
			return await this.runtimeAccessResetController.reset();
		} finally {
			try {
				await this.refreshGovernanceViews();
			} catch {
				console.error('tracekeeper failed to refresh views after access credential reset');
			}
		}
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

	async ensureMcpRuntimeRunning(): Promise<void> {
		const status = this.getRuntimeViewStatus();
		if (status.state === 'running' || status.state === 'starting' || status.state === 'stopping') {
			return;
		}
		if (!this.settings.mcpRuntimeEnabled) {
			this.settings.mcpRuntimeEnabled = true;
			await this.saveSettings();
			await this.startMcpRuntime();
		} else {
			await this.replaceMcpRuntime();
		}
		await this.refreshGovernanceViews();
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
			await this.stopMcpRuntime();
			return;
		}
		await this.runMcpRuntimeStart(() => this.mcpRuntimeLifecycle.start(
			() => this.createMcpRuntime()
		));
	}

	private async replaceMcpRuntime(): Promise<void> {
		await this.runMcpRuntimeStart(() => this.mcpRuntimeLifecycle.restart(
			() => this.createMcpRuntime()
		));
	}

	private async stopMcpRuntimeForAccessReset(): Promise<void> {
		await this.mcpRuntimeLifecycle.stop();
		this.runtimeStatus = this.createStoppedRuntimeStatus();
	}

	private async startMcpRuntimeForAccessReset(): Promise<void> {
		try {
			const status = await this.mcpRuntimeLifecycle.start(
				() => this.createMcpRuntime()
			);
			if (!status || status.state !== 'running') {
				throw new Error('MCP Runtime did not reach the running state.');
			}
			this.runtimeStatus = status;
		} catch (error) {
			this.runtimeStatus = this.mcpRuntimeLifecycle.getStatus()
				?? this.createStoppedRuntimeStatus();
			throw error;
		}
	}

	private createMcpRuntime(): StreamableHttpMcpRuntime {
		const vaultRoot = this.getVaultRoot();
		const noteContentLanguage = this.resolveNoteContentLanguage();
		const runtimeOptions: StreamableHttpRuntimeOptionsWithGraphProfile = {
			localTrust: true,
			serviceToken: this.settings.runtimeAccessToken,
			getSharedBearerToken: () => this.settings.runtimeAccessToken,
			host: DEFAULT_MCP_HOST,
			port: this.settings.mcpPort,
			path: DEFAULT_MCP_PATH,
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
		return new StreamableHttpMcpRuntime(runtimeOptions);
	}

	private async runMcpRuntimeStart(
		start: () => Promise<StreamableHttpRuntimeStatus | null>
	): Promise<void> {
		const pending = start();
		await Promise.resolve();
		this.runtimeStatus = this.mcpRuntimeLifecycle.getStatus() ?? this.runtimeStatus;
		await this.refreshRuntimeViews();
		try {
			this.runtimeStatus = await pending ?? this.createStoppedRuntimeStatus();
		} catch (error) {
			this.runtimeStatus = this.mcpRuntimeLifecycle.getStatus() ?? this.createStoppedRuntimeStatus();
			const message = error instanceof Error ? error.message : 'Unknown MCP Runtime error.';
			console.error('tracekeeper failed to start MCP Runtime', error);
			new Notice(ui(`MCP 服务启动失败：${message}`, `MCP service failed to start: ${message}`));
		} finally {
			await this.refreshRuntimeViews();
		}
	}

	private async stopMcpRuntime(): Promise<void> {
		const pending = this.mcpRuntimeLifecycle.stop();
		await Promise.resolve();
		this.runtimeStatus = this.mcpRuntimeLifecycle.getStatus() ?? this.runtimeStatus;
		await this.refreshRuntimeViews();
		await pending;
		this.runtimeStatus = this.createStoppedRuntimeStatus();
		await this.refreshRuntimeViews();
	}

	private async closeMcpRuntime(): Promise<void> {
		try {
			await this.mcpRuntimeLifecycle.close();
			this.runtimeStatus = this.createStoppedRuntimeStatus();
		} catch (error) {
			this.runtimeStatus = this.mcpRuntimeLifecycle.getStatus() ?? this.runtimeStatus;
			console.error('tracekeeper failed to stop MCP Runtime during plugin unload', error);
		} finally {
			this.knowledgeIndex = null;
		}
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

	private async refreshMemoryInspectorViews(): Promise<void> {
		const memoryLeaves = this.app.workspace.getLeavesOfType(TRACEKEEPER_MEMORY_INSPECTOR_VIEW);
		for (const leaf of memoryLeaves) {
			const view = leaf.view;
			if (view instanceof TracekeeperMemoryInspectorView) {
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

	private async refreshRuntimeStatusViews(): Promise<void> {
		const statusLeaves = this.app.workspace.getLeavesOfType(TRACEKEEPER_RUNTIME_STATUS_VIEW);
		for (const leaf of statusLeaves) {
			const view = leaf.view;
			if (view instanceof TracekeeperRuntimeStatusView) {
				await view.refresh();
			}
		}
	}

	private async refreshRuntimeViews(): Promise<void> {
		await this.refreshActivityViews();
		await this.refreshRuntimeStatusViews();
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
		await this.refreshMemoryInspectorViews();
		await this.refreshSourceStatusViews();
		await this.refreshRuntimeLogViews();
		await this.refreshRuntimeStatusViews();
		await this.refreshGraphHealthViews();
	}

	private async loadKnowledgeIndexEvidence(): Promise<KnowledgeIndexEvidence> {
		const snapshot = await this.knowledgeIndex?.knowledgeSnapshot();
		const scan = this.knowledgeIndex?.scanSnapshot(this.getVaultRoot());
		return {
			state: snapshot?.index_state ?? 'initializing',
			generation: snapshot?.generation ?? 0,
			lastRebuild: snapshot?.last_rebuild ?? '',
			notes: snapshot ? Array.from(snapshot.notes.values()) : [],
			errors: scan?.errors ?? [],
		};
	}

	private async loadReviewKnowledgeSnapshot(): Promise<ReviewKnowledgeSnapshot> {
		const evidence = await this.loadKnowledgeIndexEvidence();
		return {
			state: evidence.state,
			notes: evidence.notes.map((note) => ({
				path: note.path,
				title: note.title,
				excerpt: note.excerptSource,
				frontmatter: { ...note.frontmatter },
			})),
		};
	}

	async loadMemoryInspectorSnapshot(
		query: MemoryInspectorQuery = {}
	): Promise<MemoryInspectorSnapshot> {
		const [index, proposals, tasks] = await Promise.all([
			this.loadKnowledgeIndexEvidence(),
			this.activityRecordRepository.readRecentMemoryProposals(KNOWLEDGE_RELATIONSHIP_READ_LIMIT),
			this.activityRecordRepository.readRecentAgentTasks(KNOWLEDGE_RELATIONSHIP_READ_LIMIT),
		]);
		return buildMemoryInspectorSnapshot({
			index,
			proposals,
			tasks,
			missingMemoryFolder: !(this.app.vault.getAbstractFileByPath(KNOWLEDGE_MEMORY_DIR) instanceof TFolder),
			query,
		});
	}

	async loadSourceStatusSnapshot(
		query: SourceStatusQuery = {}
	): Promise<SourceStatusSnapshot> {
		const [index, proposals, tasks, requests] = await Promise.all([
			this.loadKnowledgeIndexEvidence(),
			this.activityRecordRepository.readRecentMemoryProposals(KNOWLEDGE_RELATIONSHIP_READ_LIMIT),
			this.activityRecordRepository.readRecentAgentTasks(KNOWLEDGE_RELATIONSHIP_READ_LIMIT),
			this.activityRecordRepository.readRecentSourceRequests(KNOWLEDGE_RELATIONSHIP_READ_LIMIT),
		]);
		return buildSourceStatusSnapshot({
			index,
			proposals,
			tasks,
			requests,
			missingSourceFolder: !(this.app.vault.getAbstractFileByPath(KNOWLEDGE_SOURCES_DIR) instanceof TFolder),
			missingRequestFolder: !(this.app.vault.getAbstractFileByPath(TRACEKEEPER_AGENT_REQUESTS_DIR) instanceof TFolder),
			query,
		});
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

	issueAgentPairingTicket(clientId: string): ClientPairingTicket {
		const runtime = this.mcpRuntimeLifecycle.getRuntime();
		if (!(runtime instanceof StreamableHttpMcpRuntime)) {
			throw new Error('Local OAuth pairing requires a running MCP Runtime.');
		}
		const ticket = runtime.issuePairingTicket(clientId);
		return {
			id: ticket.id,
			code: ticket.code,
			expectedClientId: ticket.expectedClientId,
			issuedAt: ticket.issuedAt,
			expiresAt: ticket.expiresAt,
		};
	}

	getAgentPairingTicketStatus(id: string): ClientPairingTicketStatus | null {
		const runtime = this.mcpRuntimeLifecycle.getRuntime();
		if (!(runtime instanceof StreamableHttpMcpRuntime)) {
			return null;
		}
		const status = runtime.getPairingTicketStatus(id);
		if (!status) {
			return null;
		}
		return {
			id: status.id,
			expectedClientId: status.expectedClientId,
			state: status.state,
			issuedAt: status.issuedAt,
			expiresAt: status.expiresAt,
			attemptsRemaining: status.attemptsRemaining,
			authorizedAt: status.authorizedAt,
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
			const setup = buildGeneratedClientSetup(profile, this.getMcpConnectionUrl());
			return {
				clientId: profile.id,
				displayName: profile.displayName,
				description: profile.description,
				transport: profile.preferredTransport,
				completeConfigText: '',
				redactedConfigText: '',
				supportsAutoConfigure: profile.supportsAutoConfigure,
				restartRequired: profile.restartRequired,
				configFormat: profile.configFormat,
				targetPath: profile.targetPath,
				configState: 'not_configured',
				configStatusLabel: ui('由客户端管理', 'Managed by client'),
				configStatusDetail: ui(
					'使用客户端原生入口完成连接；Tracekeeper 不读取或改写客户端配置。',
					'Complete setup through the client-native entry. Tracekeeper does not read or rewrite client configuration.'
				),
				...setup,
			};
		});
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

	getMcpConnectionUrl(): string {
		return this.getMcpHttpEndpoint();
	}

	getRuntimeViewStatus(): RuntimeViewStatus {
		const status = this.mcpRuntimeLifecycle.getStatus() || this.runtimeStatus;
		const enabled = this.settings.mcpRuntimeEnabled;
		const viewModel = runtimeViewModel({
			enabled,
			state: status.state,
			port: this.settings.mcpPort || DEFAULT_MCP_PORT,
			lastError: status.lastError,
		}, ui);
		return {
			enabled,
			accessProtected: isRuntimeAccessToken(this.settings.runtimeAccessToken),
			state: status.state,
			label: viewModel.label,
			detail: viewModel.detail,
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
				runtimeCapabilities: LOCAL_TRUST_CAPABILITIES,
			} : null,
			skillInstallState: this.getSkillInstallState(this.settings.onboarding.selectedClientId),
			onboarding: this.settings.onboarding,
		});
	}

	isOnboardingComplete(): boolean {
		const clientConfigs = this.buildClientConfigs();
		const resolved = resolveOnboardingSelectedClient(
			this.settings.onboarding,
			clientConfigs.map((config) => ({
				clientId: config.clientId,
				configState: config.configState,
			}))
		);
		const selectedClient = clientConfigs.find((client) =>
			client.clientId === resolved.selectedClientId
		) ?? null;
		const context = buildOnboardingContext({
			vaultReady: this.isVaultStructureReady(),
			runtimeState: this.getRuntimeViewStatus().state,
			runtimeEnabled: this.settings.mcpRuntimeEnabled,
			selectedClient: selectedClient ? {
				clientId: selectedClient.clientId,
				configState: selectedClient.configState,
				runtimeCapabilities: LOCAL_TRUST_CAPABILITIES,
			} : null,
			skillInstallState: this.getSkillInstallState(selectedClient?.clientId ?? ''),
			onboarding: resolved.state,
		});
		return getNextOnboardingStep(resolved.state, context) === 'complete';
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

	async confirmOnboardingMemoryPolicy(): Promise<void> {
		if (this.settings.onboarding.memoryPolicyConfirmedAt) {
			return;
		}
		this.settings.onboarding = markMemoryPolicyConfirmed(this.settings.onboarding);
		await this.persistOnboardingState();
	}

	async setGlobalMemoryRule(value: unknown): Promise<void> {
		this.settings.globalMemoryRule = normalizeMemoryProposalRule(value);
		await this.persistExplicitMemoryPolicySelection();
	}

	async setProjectMemoryRule(value: unknown): Promise<void> {
		this.settings.projectMemoryRule = normalizeMemoryProposalRule(value);
		await this.persistExplicitMemoryPolicySelection();
	}

	async setTaskMemoryProposalMode(value: unknown): Promise<void> {
		this.settings.taskMemoryProposalMode = normalizeTaskMemoryProposalMode(value);
		await this.persistExplicitMemoryPolicySelection();
	}

	private async persistExplicitMemoryPolicySelection(): Promise<void> {
		this.settings.onboarding = markMemoryPolicyConfirmed(this.settings.onboarding);
		await this.saveSettings();
		await this.restartMcpRuntime();
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
		if (this.settings.onboarding.skillUserConfirmedAt) {
			return;
		}
		this.settings.onboarding = markSkillUserConfirmed(this.settings.onboarding);
		await this.persistOnboardingState();
	}

	async markOnboardingSkillCopied(): Promise<void> {
		if (!this.settings.onboarding.skillCopiedAt) {
			this.settings.onboarding = markSkillCopied(this.settings.onboarding);
			await this.persistOnboardingState();
		}
	}

	async copyTracekeeperSkillFallback(): Promise<void> {
		await this.copyToClipboard(
			TRACEKEEPER_SKILL_BUNDLE.flattened,
			ui('Tracekeeper 单文件兼容 Skill 已复制。', 'Tracekeeper flattened compatibility Skill copied.')
		);
		await this.markOnboardingSkillCopied();
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
		const snapshot = await this.loadAgentConnectionsSnapshot();
		const notBefore = onboardingEvidenceNotBefore(this.settings.onboarding);
		const connection = findOnboardingConnectionEvidence(snapshot.recentAgents, notBefore);
		if (!connection) {
			throw new Error(ui(
				'尚未发现携带有效本机访问凭据且成功 initialize 的 MCP Session。请重启 AI 工具并让它调用一次 Tracekeeper。',
				'No successfully initialized MCP Session with valid local access was found. Restart the AI tool and ask it to call Tracekeeper once.'
			));
		}
		if (this.settings.onboarding.connectionVerifiedSessionId !== connection.sessionId
			|| this.settings.onboarding.connectionVerifiedAt !== connection.connectedAt) {
			this.settings.onboarding = markConnectionVerified(
				this.settings.onboarding,
				connection.sessionId,
				connection.connectedAt
			);
			await this.persistOnboardingState();
		}
	}

	async verifyOnboardingFirstRecall(): Promise<void> {
		const snapshot = await this.loadAgentConnectionsSnapshot();
		const notBefore = Math.max(
			onboardingEvidenceNotBefore(this.settings.onboarding),
			Date.parse(this.settings.onboarding.connectionVerifiedAt) || 0
		);
		const recall = findOnboardingRecallEvidence(
			snapshot.recentToolCalls,
			this.settings.onboarding.connectionVerifiedSessionId,
			notBefore
		);
		if (!recall) {
			throw new Error(ui(
				'尚未发现已验证 MCP Session 中成功且有命中结果的 project Recall。请让同一 AI 工具 Session 执行一次项目召回。',
				'No successful project Recall with matches was found in the verified MCP Session. Ask the same AI tool Session to run a project Recall.'
			));
		}
		await this.markOnboardingFirstRecall(parseOnboardingRecallQuery(recall.argsSummary), recall.matchedCount);
	}

	async verifyOnboardingTrackedWorkflow(): Promise<void> {
		const snapshot = await this.loadAgentConnectionsSnapshot();
		const evidence = findOnboardingTrackedWorkflowEvidence(
			snapshot.recentToolCalls,
			this.settings.onboarding.connectionVerifiedSessionId,
			Math.max(
				onboardingEvidenceNotBefore(this.settings.onboarding),
				Date.parse(this.settings.onboarding.connectionVerifiedAt) || 0
			)
		);
		if (!evidence) {
			throw new Error(ui(
				'尚未发现同一已验证 MCP Session 中 task id 一致的 start → recall → finish 成功序列。首次 Recall 不能证明 Skill 自动触发。',
				'No successful start → recall → finish sequence with one task id was found in the same verified MCP Session. A first Recall does not prove automatic Skill triggering.'
			));
		}
		this.settings.onboarding = markTrackedWorkflowObserved(this.settings.onboarding, evidence.taskId);
		await this.persistOnboardingState();
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

	private openOnboardingEntryIfNeeded(): void {
		if (this.isOnboardingComplete() || !shouldShowOnboardingEntryPrompt(this.settings.onboarding)) {
			return;
		}
		new OnboardingEntryModal(
			this.app,
			{
				onOpen: async () => {
					this.settings.onboarding = markOnboardingEntryPromptOpened(this.settings.onboarding);
					await this.persistOnboardingState();
				},
				onStartConnectingAgent: () => {
					this.openSettingsTab();
				},
				onSetupLater: async () => {
					this.settings.onboarding = markOnboardingEntryPromptDeferred(this.settings.onboarding);
					await this.persistOnboardingState();
				},
			},
			{ localize: ui }
		).open();
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

	getSkillInstallState(clientId: string): SkillInstallState {
		const profile = this.getClientSkillProfile(clientId);
		if (!this.clientSkillAdapter) {
			return {
				clientId,
				targetId: profile.targetId,
				targetDirectory: profile.targetDirectory,
				state: 'unavailable',
				legacyTargetDirectories: profile.legacyTargetDirectories ?? [],
				deliveryMode: profile.deliveryMode,
				activationMode: profile.activationMode,
				restartRequired: profile.restartRequired,
				fileVerified: false,
				updateAvailable: false,
				installedVersion: '',
				expectedVersion: TRACEKEEPER_SKILL_BUNDLE.manifest.skill_version,
				detail: ui('当前环境仅支持复制 Skill。', 'This environment supports copy-only Skill setup.'),
			};
		}
		try {
			return this.clientSkillAdapter.detect(profile);
		} catch (error) {
			console.error('tracekeeper failed to detect client Skill', error);
			return {
				clientId,
				targetId: profile.targetId,
				targetDirectory: profile.targetDirectory,
				state: 'unavailable',
				legacyTargetDirectories: profile.legacyTargetDirectories ?? [],
				deliveryMode: profile.deliveryMode,
				activationMode: profile.activationMode,
				restartRequired: profile.restartRequired,
				fileVerified: false,
				updateAvailable: false,
				installedVersion: '',
				expectedVersion: TRACEKEEPER_SKILL_BUNDLE.manifest.skill_version,
				detail: ui('无法读取 Skill 目录。', 'Cannot read the Skill directory.'),
			};
		}
	}

	prepareSkillInstall(clientId: string, action: Extract<SkillInstallAction, 'install' | 'update' | 'migrate'>): SkillInstallPlan {
		const adapter = this.requireClientSkillAdapter();
		const profile = this.getClientSkillProfile(clientId);
		if (action === 'install') return adapter.previewInstall(profile);
		if (action === 'update') return adapter.previewUpdate(profile);
		return adapter.previewMigrate(profile);
	}

	async confirmSkillInstall(
		planId: string,
		action: Extract<SkillInstallAction, 'install' | 'update' | 'migrate'>,
		clientId: string
	): Promise<SkillInstallResult> {
		try {
			const adapter = this.requireClientSkillAdapter();
			const result = action === 'install'
				? adapter.confirmInstall(planId)
				: action === 'update'
					? adapter.confirmUpdate(planId)
					: adapter.confirmMigrate(planId);
			const profile = this.getClientSkillProfile(result.clientId);
			this.settings.skillInstallReceipts = recordSkillInstallReceipt(this.settings.skillInstallReceipts, {
				targetId: profile.targetId,
				bundleHash: result.bundleHash,
				skillVersion: TRACEKEEPER_SKILL_BUNDLE.manifest.skill_version,
				installedAt: new Date().toISOString(),
			});
			this.settings.onboarding = markSkillFileVerified(this.settings.onboarding, result.bundleHash);
			this.settings.onboarding = clearOnboardingAgentBehaviorEvidence(this.settings.onboarding);
			await this.persistOnboardingState();
			await this.appendToAuditLog(buildSkillInstallAuditEntry({
				action,
				clientId: result.clientId,
				bundleHash: result.bundleHash,
				backupCreated: result.backupDirectory !== '',
				result: 'success',
			}));
			const actionLabel = action === 'install'
				? ui('Skill bundle 已安装。', 'Skill bundle installed.')
				: action === 'update'
					? ui('Skill bundle 已更新。', 'Skill bundle updated.')
					: ui('Skill 已复制到官方目录，旧目录保持不变。', 'Skill copied to the official directory. The legacy directory was kept unchanged.');
			new Notice(profile.restartRequired
				? `${actionLabel} ${ui('请重启客户端。', 'Restart the client.')}`
				: `${actionLabel} ${ui('客户端通常会自动识别；若未出现再重启。', 'The client normally detects it automatically; restart only if it does not appear.')}`);
			return result;
		} catch (error) {
			console.error('tracekeeper failed to install client Skill', error);
			try {
				await this.appendToAuditLog(buildSkillInstallAuditEntry({
					action,
					clientId,
					bundleHash: TRACEKEEPER_SKILL_BUNDLE.manifest.bundle_hash,
					backupCreated: false,
					result: 'failed',
				}));
			} catch (auditError) {
				console.error('tracekeeper failed to audit client Skill failure', auditError);
			}
			new Notice(error instanceof ClientSkillPlanConflictError
				? ui('Skill 在预览后已变化，或包含用户修改。请重新检测和预览。', 'Skill changed after preview or contains user modifications. Detect and preview again.')
				: ui('Skill 写入失败。', 'Failed to write Skill.'));
			throw error;
		}
	}

	async applyClientConfig(config: GeneratedClientConfig, planId: string): Promise<void> {
		try {
			const result = this.requireClientConfigAdapter(config).applyConfirmedChange(planId);
			if (config.clientId) {
				this.settings.onboarding = clearOnboardingAgentBehaviorEvidence(
					markClientConfigured(this.settings.onboarding, config.clientId)
				);
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

	private getClientSkillProfile(clientId: string): ClientSkillProfile {
		const desktopApi = this.getDesktopNodeApi();
		const client = this.getClientProfiles().find((profile) => profile.id === clientId);
		const profile = buildClientSkillProfile(
			clientId,
			client?.displayName || clientId,
			desktopApi?.os.homedir(),
			desktopApi?.path.join.bind(desktopApi.path) || ((...parts) => parts.join('/'))
		);
		const receipt = this.settings.skillInstallReceipts[profile.targetId];
		return {
			...profile,
			ownedBundleHash: receipt?.bundleHash,
			ownedSkillVersion: receipt?.skillVersion,
		};
	}

	private requireClientSkillAdapter(): ClientSkillAdapter {
		if (!this.clientSkillAdapter) {
			throw new Error('Managed Skill installation is unavailable in this environment.');
		}
		return this.clientSkillAdapter;
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

	async updateMemoryProposalDraft(
		proposal: MemoryProposalRecord,
		draft: { targetNote: string; writebackContent: string }
	): Promise<void> {
		return this.reviewQueueController.updateMemoryProposalDraft(proposal, draft);
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

	async openMemoryInspector(
		query: Pick<MemoryInspectorQuery, 'focusPaths' | 'taskId'> = {}
	): Promise<void> {
		await this.openPluginView(TRACEKEEPER_MEMORY_INSPECTOR_VIEW);
		const leaf = this.app.workspace.getLeavesOfType(TRACEKEEPER_MEMORY_INSPECTOR_VIEW)[0];
		if (leaf?.view instanceof TracekeeperMemoryInspectorView) {
			await leaf.view.focus(query);
		}
	}

	async openSourceStatus(
		query: Pick<SourceStatusQuery, 'focusPaths' | 'taskId'> = {}
	): Promise<void> {
		await this.openPluginView(TRACEKEEPER_SOURCE_STATUS_VIEW);
		const leaf = this.app.workspace.getLeavesOfType(TRACEKEEPER_SOURCE_STATUS_VIEW)[0];
		if (leaf?.view instanceof TracekeeperSourceStatusView) {
			await leaf.view.focus(query);
		}
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
		await this.saveData(stripLegacyConnectionSettings(this.settings));
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
			review_queue: ui('查看知识变更审核', 'Knowledge Change Review'),
			list_review_queue: ui('查看待审核的知识变更', 'List knowledge changes to review'),
			list_source_requests: ui('查看资料请求', 'Review material requests'),
			list_approved_writebacks: ui('查看待写入内容', 'Review ready-to-apply changes'),
			audit_recent: ui('查看最近记录', 'Review recent activity'),
			source_request: ui('处理资料请求', 'Handle source requests'),
			build_context_pack: ui('整理上下文材料', 'Prepare context material'),
			lint: ui('检查笔记结构', 'Check note structure'),
			finish_task: ui('记录任务结果', 'Record task results'),
			distill_session: ui('沉淀会话摘要', 'Summarize a session'),
			capture_source: ui('保存来源资料', 'Save source material'),
			propose_memory: ui('提出记忆更新', 'Propose memory updates'),
			analyze_source_request: ui('处理资料请求', 'Process material request'),
			apply_approved_writeback: ui('预览并写入', 'Preview and apply'),
		};
		return labels[normalized] || normalized.replace(/_/g, ' ') || ui('未知操作', 'Unknown action');
	}

	formatAgentDisplayName(clientName: string, agentId = ''): string {
		const raw = (clientName || agentId || '').trim();
		const normalized = raw.toLowerCase();
		const compact = raw.replace(/-/g, '');
		if (
			!normalized
			|| normalized === 'unknown'
			|| normalized === 'legacy-shared-token'
			|| (compact.length >= 24 && /^[a-f0-9]+$/i.test(compact))
		) {
			return ui('AI 工具', 'AI tool');
		}
		if (normalized.includes('codex')) {
			return 'Codex';
		}
		if (normalized.includes('gemini')) {
			return 'Gemini CLI';
		}
		if (normalized.includes('grok')) {
			return 'Grok Build';
		}
		if (normalized.includes('zcode')) {
			return 'ZCode';
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

	getSelectedAgentClientLabel(): string {
		const selectedClientId = this.settings.onboarding.selectedClientId;
		const selectedClient = this.getClientProfiles().find((profile) => profile.id === selectedClientId);
		return selectedClient?.displayName || this.formatAgentDisplayName(selectedClientId);
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
