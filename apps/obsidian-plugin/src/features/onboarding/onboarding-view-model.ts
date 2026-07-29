import {
	OnboardingProgressContext,
	OnboardingSettingsState,
	hasOnboardingRecallResult,
} from './onboarding-state';

export interface OnboardingClientSelectionProfile {
	clientId: string;
	configState?: string;
	runtimeCapabilities?: readonly string[];
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
	sessionId: string;
	firstRecallQuery: string;
	firstRecallMatchedCount: number;
	firstRecallMatchedAt: string;
	skillBundleVersion: string;
	trackedWorkflowStatus: OnboardingTrackedWorkflowStatus;
	trackedWorkflowTaskId: string;
}

export interface BuildOnboardingObservedEvidenceInput {
	selectedClient: OnboardingClientSelectionProfile | null;
	onboarding: OnboardingSettingsState;
	skillBundleVersion: string;
}

export interface OnboardingRecallInstruction {
	instruction: string;
}

export interface BuildOnboardingRecallInstructionInput {
	keyword: string;
	workflowManageAvailable: boolean;
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
		state: {
			...clearOnboardingClientEvidence(state),
			selectedClientId: first.clientId,
			lastUpdatedAt: now,
		},
	};
};

export const buildOnboardingObservedEvidence = (input: BuildOnboardingObservedEvidenceInput): OnboardingObservedEvidence => {
	const observed = input.onboarding.trackedWorkflowObservedAt !== '';
	return {
		selectedClientId: input.selectedClient?.clientId || input.onboarding.selectedClientId,
		sessionId: input.onboarding.connectionVerifiedSessionId,
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
	const recallPayload = `{"query": ${query}, "scope": "project", "repo_path": "<absolute repository/workspace path>"}`;
	return {
		instruction: input.workflowManageAvailable
			? input.localize(
				`请使用刚完成 MCP Session 验证的 AI 工具完成一次端到端验证：\n\n`
				+ `1. 恰好调用一次 tracekeeper.start_task，并保留 Runtime 返回的真实 task_id。\n`
				+ `2. 严格复制该响应中的 next_actions 或 recommended_recall 参数执行 Recall，不要自行重建项目路由。\n`
				+ `3. 恰好调用一次 tracekeeper.finish_task，并使用同一个 task_id。\n\n`
				+ `已知项目的路径应作为 repo_path 传递；只有已知规范项目名时才传 project_hint，绝不能把路径写入 project_hint。项目 Recall 的参数形状如下：\n\n`
				+ `${recallPayload}\n\n`
				+ `按原样汇报每次调用的参数和结果，不要先宣称成功。`,
				`Use the AI tool from the verified MCP Session for one end-to-end verification:\n\n`
				+ `1. Call tracekeeper.start_task exactly once and keep the real task_id returned by the Runtime.\n`
				+ `2. Copy the next_actions or recommended_recall arguments from that response exactly; do not reconstruct project routing.\n`
				+ `3. Call tracekeeper.finish_task exactly once with that same task_id.\n\n`
				+ `Pass a known project path as repo_path. Pass project_hint only for a known canonical project name; never put a path in project_hint. The project Recall argument shape is:\n\n`
				+ `${recallPayload}\n\n`
				+ `Report each raw call argument and result as-is; do not claim success upfront.`,
			)
			: input.localize(
				`当前 AI 工具仅支持 Recall，不具备 workflow.manage，因此不要调用 tracekeeper.start_task 或 tracekeeper.finish_task。\n\n`
				+ `先识别当前仓库或工作区，然后执行一次 project-scoped 的 tracekeeper.recall：\n\n`
				+ `${recallPayload}\n\n`
				+ `只有已知规范项目名时才添加 project_hint，绝不能把路径写入 project_hint。按原样汇报调用参数和结果，不要先宣称成功。`,
				`The current AI tool supports Recall only and does not have workflow.manage, so do not call tracekeeper.start_task or tracekeeper.finish_task.\n\n`
				+ `Identify the current repository or workspace, then run one project-scoped tracekeeper.recall:\n\n`
				+ `${recallPayload}\n\n`
				+ `Add project_hint only for a known canonical project name; never put a path in project_hint. Report the raw call arguments and result as-is; do not claim success upfront.`,
			),
	};
};

export const hasWorkflowManageCapability = (capabilities: readonly string[] | undefined): boolean =>
	Boolean(capabilities?.includes('*') || capabilities?.includes('workflow.manage'));

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
	const connectionVerified = input.onboarding.connectionVerifiedAt !== ''
		&& input.onboarding.connectionVerifiedSessionId !== '';
	const recallObserved = connectionVerified && hasOnboardingRecallResult(input.onboarding);
	return {
		vaultReady: input.vaultReady,
		runtimeRunning: input.runtimeState === 'running' && input.runtimeEnabled,
		clientConfigured,
		skillSetupConfirmed: liveFileVerified || userConfirmed,
		memoryPolicyConfirmed: input.onboarding.memoryPolicyConfirmedAt !== '',
		agentRestartConfirmed: clientReloaded,
		connectionVerified,
		firstRecallCompleted: recallObserved,
		skillAvailable: Boolean(input.skillInstallState),
		skillCopied: input.onboarding.skillCopiedAt !== '',
		skillUserConfirmed: userConfirmed,
		skillFileVerified: liveFileVerified,
		skillUpdateAvailable: updateAvailable,
		clientReloaded,
		recallObserved,
		workflowManageAvailable: hasWorkflowManageCapability(input.selectedClient?.runtimeCapabilities),
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
	connectionVerifiedSessionId: '',
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
	connectionVerifiedSessionId: '',
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
	connectionVerifiedSessionId: '',
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

export const onboardingStepLabel = (
	step: string,
	localize: (zh: string, en: string) => string
): string => {
	switch (step) {
		case 'vault_check': return localize('检查知识库结构', 'Check vault structure');
		case 'runtime': return localize('启动 MCP 服务', 'Start MCP service');
		case 'client_configuration': return localize('配置客户端连接', 'Configure a client');
		case 'skill_setup': return localize('完成 Skill 设置', 'Configure Skill workflow');
		case 'memory_policy': return localize('确认记忆持久化策略', 'Confirm memory persistence policy');
		case 'agent_restart': return localize('重启客户端', 'Restart client');
		case 'connection_verification': return localize('验证 MCP 连接', 'Verify MCP connection');
		case 'first_recall': return localize('执行首个召回', 'Run first recall');
		case 'tracked_workflow': return localize('观察完整任务工作流', 'Observe complete task workflow');
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
		context.memoryPolicyConfirmed,
		context.agentRestartConfirmed,
		context.connectionVerified,
		context.firstRecallCompleted,
		...(context.workflowManageAvailable ? [context.trackedWorkflowObserved] : []),
	];
	if (required.every(Boolean)) {
		return context.workflowManageAvailable
			? localize('首次引导已完成，可直接开始有意义任务。', 'Onboarding is complete. You can start meaningful work.')
			: localize('Recall-only 引导已完成；当前 AI 工具不支持 tracked closeout。', 'Recall-only onboarding is complete; the current AI tool does not support tracked closeout.');
	}
	const pending = required.filter((value) => !value).length;
	return context.vaultReady && pending > 0
		? localize(`剩余 ${pending} 项，继续完成后可继续。`, `${pending} items remaining. Continue to complete onboarding.`)
		: localize('完成步骤后继续进行召回测试。', 'Complete steps to proceed with the first recall test.');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
