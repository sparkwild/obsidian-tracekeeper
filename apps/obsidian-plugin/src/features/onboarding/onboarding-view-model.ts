import {
	OnboardingProgressContext,
	OnboardingSettingsState,
	hasOnboardingRecallResult,
} from './onboarding-state';

export interface OnboardingClientSelectionProfile {
	clientId: string;
	configState?: string;
}

export interface OnboardingSkillInstallState {
	state: string;
	fileVerified: boolean;
	updateAvailable: boolean;
	restartRequired?: boolean;
}

export interface ResolvedOnboardingSelection {
	selectedClient: OnboardingClientSelectionProfile | null;
	selectedClientId: string;
	state: OnboardingSettingsState;
}

export interface BuildOnboardingContextInput {
	vaultReady: boolean;
	runtimeState: string;
	runtimeEnabled: boolean;
	selectedClient: OnboardingClientSelectionProfile | null;
	skillInstallState?: OnboardingSkillInstallState | null;
	onboarding: OnboardingSettingsState;
}

export type OnboardingTrackedWorkflowStatus = 'observed' | 'not_observed';

export interface OnboardingObservedEvidence {
	selectedClientId: string;
	principalId: string;
	firstRecallQuery: string;
	firstRecallMatchedCount: number;
	firstRecallMatchedAt: string;
	skillBundleVersion: string;
	trackedWorkflowStatus: OnboardingTrackedWorkflowStatus;
	trackedWorkflowTaskId: string;
}

export interface BuildOnboardingObservedEvidenceInput {
	selectedClient: OnboardingClientSelectionProfile | null;
	principalId: string;
	onboarding: OnboardingSettingsState;
	skillBundleVersion: string;
}

export interface OnboardingRecallInstruction {
	instruction: string;
}

export interface BuildOnboardingRecallInstructionInput {
	keyword: string;
	localize: (zh: string, en: string) => string;
}

export const resolveOnboardingSelectedClient = (
	state: OnboardingSettingsState,
	clientConfigs: readonly OnboardingClientSelectionProfile[],
	now = new Date().toISOString()
): ResolvedOnboardingSelection => {
	const byId = clientConfigs.find((item) => item.clientId === state.selectedClientId) || null;
	if (byId) return { selectedClient: byId, selectedClientId: state.selectedClientId, state };
	const first = clientConfigs[0] || null;
	if (!first || first.clientId === state.selectedClientId) {
		return { selectedClient: first, selectedClientId: state.selectedClientId, state };
	}
	return {
		selectedClient: first,
		selectedClientId: first.clientId,
		state: { ...state, selectedClientId: first.clientId, lastUpdatedAt: now },
	};
};

export const buildOnboardingObservedEvidence = (input: BuildOnboardingObservedEvidenceInput): OnboardingObservedEvidence => {
	const observed = input.onboarding.trackedWorkflowObservedAt !== '';
	return {
		selectedClientId: input.selectedClient?.clientId || input.onboarding.selectedClientId,
		principalId: input.principalId,
		firstRecallQuery: input.onboarding.firstRecallQuery,
		firstRecallMatchedCount: input.onboarding.firstRecallMatchedCount,
		firstRecallMatchedAt: input.onboarding.firstRecallCompletedAt,
		skillBundleVersion: asText(input.skillBundleVersion),
		trackedWorkflowStatus: observed ? 'observed' : 'not_observed',
		trackedWorkflowTaskId: observed ? input.onboarding.trackedWorkflowTaskId : '',
	};
};

export const buildOnboardingRecallInstruction = (input: BuildOnboardingRecallInstructionInput): OnboardingRecallInstruction => {
	const keyword = asText(input.keyword) || 'tracekeeper';
	const query = JSON.stringify(keyword);
	return {
		instruction: input.localize(
			`先识别当前仓库/工作区身份（例如项目名、仓库名或路径），再在该上下文范围执行一次 project-scoped 的 tracekeeper.recall。\n\n`
			+ `请使用以下窄查询参数，并按原样汇报调用参数，不要先宣称成功。\n\n`
			+ `{"query": ${query}, "scope": "project", "project_hint": "<推断出的仓库/工作区身份>"}`,
			`Infer the current repository/workspace identity (for example, project name, repository name, or path), then run one project-scoped tracekeeper.recall call in that context.\n\n`
			+ `Use the following narrow query payload and report the raw call arguments as-is; do not claim success upfront.\n\n`
			+ `{"query": ${query}, "scope": "project", "project_hint": "<inferred repo/workspace identity>"}`
		),
	};
};

export const buildOnboardingContext = (input: BuildOnboardingContextInput): OnboardingProgressContext => {
	const hasExplicitInvalidConfig = input.selectedClient?.configState === 'needs_update'
		|| input.selectedClient?.configState === 'not_configured';
	const clientConfigured = input.selectedClient
		? input.selectedClient.configState === 'configured'
			|| (!hasExplicitInvalidConfig
				&& input.onboarding.clientConfiguredAt !== ''
				&& input.selectedClient.clientId === input.onboarding.selectedClientId)
		: false;
	const liveFileVerified = input.skillInstallState?.fileVerified === true;
	const updateAvailable = input.skillInstallState?.updateAvailable === true;
	const userConfirmed = input.onboarding.skillUserConfirmedAt !== '';
	const clientReloaded = input.onboarding.agentRestartCompletedAt !== ''
		|| (liveFileVerified && input.skillInstallState?.restartRequired === false);
	const recallObserved = hasOnboardingRecallResult(input.onboarding);
	return {
		vaultReady: input.vaultReady,
		runtimeRunning: input.runtimeState === 'running' && input.runtimeEnabled,
		clientConfigured,
		skillSetupConfirmed: liveFileVerified || userConfirmed,
		agentRestartConfirmed: clientReloaded,
		connectionVerified: input.onboarding.connectionVerifiedAt !== '',
		firstRecallCompleted: recallObserved,
		skillAvailable: Boolean(input.skillInstallState),
		skillCopied: input.onboarding.skillCopiedAt !== '',
		skillUserConfirmed: userConfirmed,
		skillFileVerified: liveFileVerified,
		skillUpdateAvailable: updateAvailable,
		clientReloaded,
		recallObserved,
		trackedWorkflowObserved: input.onboarding.trackedWorkflowObservedAt !== '',
	};
};

export const clearOnboardingClientEvidence = (state: OnboardingSettingsState): OnboardingSettingsState => ({
	...state,
	clientConfiguredAt: '',
	skillSetupCompletedAt: '',
	skillCopiedAt: '',
	skillUserConfirmedAt: '',
	skillFileVerifiedAt: '',
	skillVerifiedBundleHash: '',
	skillUpdateAvailableAt: '',
	agentRestartCompletedAt: '',
	connectionVerifiedAt: '',
	firstRecallCompletedAt: '',
	firstRecallMatchedCount: 0,
	firstRecallQuery: '',
	trackedWorkflowObservedAt: '',
	trackedWorkflowTaskId: '',
});

export const clearOnboardingRuntimeEvidence = (
	state: OnboardingSettingsState,
	now = new Date().toISOString()
): OnboardingSettingsState => ({
	...state,
	clientConfiguredAt: '',
	agentRestartCompletedAt: '',
	connectionVerifiedAt: '',
	firstRecallCompletedAt: '',
	firstRecallMatchedCount: 0,
	firstRecallQuery: '',
	trackedWorkflowObservedAt: '',
	trackedWorkflowTaskId: '',
	lastUpdatedAt: now,
});

export const clearOnboardingAgentBehaviorEvidence = (
	state: OnboardingSettingsState,
	now = new Date().toISOString()
): OnboardingSettingsState => ({
	...state,
	agentRestartCompletedAt: '',
	connectionVerifiedAt: '',
	firstRecallCompletedAt: '',
	firstRecallMatchedCount: 0,
	firstRecallQuery: '',
	trackedWorkflowObservedAt: '',
	trackedWorkflowTaskId: '',
	lastUpdatedAt: now,
});

export const onboardingEvidenceNotBefore = (state: OnboardingSettingsState): number => Math.max(
	Date.parse(state.clientConfiguredAt) || 0,
	Date.parse(state.agentRestartCompletedAt) || 0
);

export const parseOnboardingRecallQuery = (argsSummary: string): string => {
	try {
		const parsed: unknown = JSON.parse(argsSummary);
		return isRecord(parsed) && typeof parsed.query === 'string' ? parsed.query.trim() : '';
	} catch {
		return '';
	}
};

export const findOnboardingRuntimePrincipal = (
	credentials: readonly { clientId: string; id: string }[],
	clientId: string
): string => credentials.find((credential) => credential.clientId === clientId)?.id || '';

export const onboardingStepLabel = (
	step: string,
	localize: (zh: string, en: string) => string
): string => {
	switch (step) {
		case 'vault_check': return localize('检查知识库结构', 'Check vault structure');
		case 'runtime': return localize('启动 MCP 服务', 'Start MCP service');
		case 'client_configuration': return localize('配置客户端连接', 'Configure a client');
		case 'skill_setup': return localize('完成 Skill 设置', 'Configure Skill workflow');
		case 'agent_restart': return localize('重启客户端', 'Restart client');
		case 'connection_verification': return localize('验证 MCP 连接', 'Verify MCP connection');
		case 'first_recall': return localize('执行首个召回', 'Run first recall');
		default: return localize('完成', 'Done');
	}
};

export const onboardingContextDescription = (
	context: OnboardingProgressContext,
	localize: (zh: string, en: string) => string
): string => {
	const required = [
		context.vaultReady,
		context.runtimeRunning,
		context.clientConfigured,
		context.skillSetupConfirmed,
		context.agentRestartConfirmed,
		context.connectionVerified,
		context.firstRecallCompleted,
	];
	if (required.every(Boolean)) {
		return localize('首次引导已完成，可直接开始有意义任务。', 'Onboarding is complete. You can start meaningful work.');
	}
	const pending = required.filter((value) => !value).length;
	return context.vaultReady && pending > 0
		? localize(`剩余 ${pending} 项，继续完成后可继续。`, `${pending} items remaining. Continue to complete onboarding.`)
		: localize('完成步骤后继续进行召回测试。', 'Complete steps to proceed with the first recall test.');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
