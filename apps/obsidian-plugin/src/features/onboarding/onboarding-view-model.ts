import {
	OnboardingProgressContext,
	OnboardingSettingsState,
	hasOnboardingRecallResult,
} from './onboarding-state';

export interface OnboardingClientSelectionProfile {
	clientId: string;
	configState?: string;
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
	onboarding: OnboardingSettingsState;
}

export const resolveOnboardingSelectedClient = (
	state: OnboardingSettingsState,
	clientConfigs: readonly OnboardingClientSelectionProfile[],
	now = new Date().toISOString()
): ResolvedOnboardingSelection => {
	const byId = clientConfigs.find((item) => item.clientId === state.selectedClientId) || null;
	if (byId) {
		return {
			selectedClient: byId,
			selectedClientId: state.selectedClientId,
			state,
		};
	}

	const first = clientConfigs[0] || null;
	if (!first || first.clientId === state.selectedClientId) {
		return {
			selectedClient: first,
			selectedClientId: state.selectedClientId,
			state,
		};
	}

	return {
		selectedClient: first,
		selectedClientId: first.clientId,
		state: {
			...state,
			selectedClientId: first.clientId,
			lastUpdatedAt: now,
		},
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
	return {
		vaultReady: input.vaultReady,
		runtimeRunning: input.runtimeState === 'running' && input.runtimeEnabled,
		clientConfigured,
		skillSetupConfirmed: input.onboarding.skillSetupCompletedAt !== '',
		agentRestartConfirmed: input.onboarding.agentRestartCompletedAt !== '',
		connectionVerified: input.onboarding.connectionVerifiedAt !== '',
		firstRecallCompleted: hasOnboardingRecallResult(input.onboarding),
	};
};

export const clearOnboardingClientEvidence = (state: OnboardingSettingsState): OnboardingSettingsState => ({
	...state,
	clientConfiguredAt: '',
	skillSetupCompletedAt: '',
	agentRestartCompletedAt: '',
	connectionVerifiedAt: '',
	firstRecallCompletedAt: '',
	firstRecallMatchedCount: 0,
	firstRecallQuery: '',
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
		case 'vault_check':
			return localize('检查知识库结构', 'Check vault structure');
		case 'runtime':
			return localize('启动 MCP 服务', 'Start MCP service');
		case 'client_configuration':
			return localize('配置客户端连接', 'Configure a client');
		case 'skill_setup':
			return localize('完成 Skill 设置', 'Configure Skill workflow');
		case 'agent_restart':
			return localize('重启客户端', 'Restart client');
		case 'connection_verification':
			return localize('验证 MCP 连接', 'Verify MCP connection');
		case 'first_recall':
			return localize('执行首个召回', 'Run first recall');
		default:
			return localize('完成', 'Done');
	}
};

export const onboardingContextDescription = (
	context: OnboardingProgressContext,
	localize: (zh: string, en: string) => string
): string => {
	if (
		context.vaultReady
		&& context.runtimeRunning
		&& context.clientConfigured
		&& context.skillSetupConfirmed
		&& context.agentRestartConfirmed
		&& context.connectionVerified
		&& context.firstRecallCompleted
	) {
		return localize('首次引导已完成，可直接开始有意义任务。', 'Onboarding is complete. You can start meaningful work.');
	}
	const pending = Object.entries(context).filter(([, value]) => !value).length;
	if (context.vaultReady && pending > 0) {
		return localize(`剩余 ${pending} 项，继续完成后可继续。`, `${pending} items remaining. Continue to complete onboarding.`);
	}
	return localize('完成步骤后继续进行召回测试。', 'Complete steps to proceed with the first recall test.');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
