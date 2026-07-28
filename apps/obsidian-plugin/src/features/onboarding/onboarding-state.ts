export const ONBOARDING_STEP_SEQUENCE = [
	'vault_check',
	'runtime',
	'client_configuration',
	'skill_setup',
	'agent_restart',
	'connection_verification',
	'first_recall',
] as const;

export const CURRENT_ONBOARDING_ENTRY_PROMPT_VERSION = 1;

export type OnboardingStep = (typeof ONBOARDING_STEP_SEQUENCE)[number] | 'complete';

export interface OnboardingProgressContext {
	vaultReady: boolean;
	runtimeRunning: boolean;
	clientConfigured: boolean;
	skillSetupConfirmed: boolean;
	agentRestartConfirmed: boolean;
	connectionVerified: boolean;
	firstRecallCompleted: boolean;
	skillAvailable: boolean;
	skillCopied: boolean;
	skillUserConfirmed: boolean;
	skillFileVerified: boolean;
	skillUpdateAvailable: boolean;
	clientReloaded: boolean;
	recallObserved: boolean;
	trackedWorkflowObserved: boolean;
}

export interface OnboardingSettingsState {
	selectedClientId: string;
	entryPromptVersion: number;
	entryDeferredAt: string;
	clientConfiguredAt: string;
	skillSetupCompletedAt: string;
	skillCopiedAt: string;
	skillUserConfirmedAt: string;
	skillFileVerifiedAt: string;
	skillVerifiedBundleHash: string;
	skillUpdateAvailableAt: string;
	agentRestartCompletedAt: string;
	connectionVerifiedAt: string;
	firstRecallCompletedAt: string;
	firstRecallMatchedCount: number;
	firstRecallQuery: string;
	trackedWorkflowObservedAt: string;
	trackedWorkflowTaskId: string;
	lastUpdatedAt: string;
}

export interface OnboardingConnectionEvidence {
	principalId: string;
	transport: string;
	sortTimestamp: number;
}

export interface OnboardingToolEvidence {
	principalId: string;
	taskId?: string;
	toolName: string;
	resultStatus: string;
	resultSummary: string;
	argsSummary: string;
	sortTimestamp: number;
}

export type OnboardingRecallEvidence = OnboardingToolEvidence;

export interface OnboardingTrackedWorkflowEvidence {
	taskId: string;
	startTimestamp: number;
	recallTimestamp: number;
	finishTimestamp: number;
}

export const DEFAULT_ONBOARDING_SETTINGS: OnboardingSettingsState = {
	selectedClientId: 'codex',
	entryPromptVersion: 0,
	entryDeferredAt: '',
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
	lastUpdatedAt: '',
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asTimestamp = (value: unknown): string => {
	const valueString = asString(value);
	return valueString && !Number.isNaN(Date.parse(valueString)) ? valueString : '';
};

const asNonNegativeInteger = (value: unknown, fallback = 0): number => {
	if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
	if (typeof value !== 'string') return fallback;
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const normalizeOnboardingSettingsState = (raw: unknown): OnboardingSettingsState => {
	const rawState = (raw && typeof raw === 'object' ? raw : {}) as Partial<OnboardingSettingsState>;
	const legacySkillConfirmation = asTimestamp(rawState.skillSetupCompletedAt);
	const userConfirmation = asTimestamp(rawState.skillUserConfirmedAt) || legacySkillConfirmation;
	return {
		selectedClientId: asString(rawState.selectedClientId) || DEFAULT_ONBOARDING_SETTINGS.selectedClientId,
		entryPromptVersion: asNonNegativeInteger(rawState.entryPromptVersion, DEFAULT_ONBOARDING_SETTINGS.entryPromptVersion),
		entryDeferredAt: asTimestamp(rawState.entryDeferredAt),
		clientConfiguredAt: asTimestamp(rawState.clientConfiguredAt),
		skillSetupCompletedAt: legacySkillConfirmation || userConfirmation,
		skillCopiedAt: asTimestamp(rawState.skillCopiedAt),
		skillUserConfirmedAt: userConfirmation,
		skillFileVerifiedAt: asTimestamp(rawState.skillFileVerifiedAt),
		skillVerifiedBundleHash: asString(rawState.skillVerifiedBundleHash),
		skillUpdateAvailableAt: asTimestamp(rawState.skillUpdateAvailableAt),
		agentRestartCompletedAt: asTimestamp(rawState.agentRestartCompletedAt),
		connectionVerifiedAt: asTimestamp(rawState.connectionVerifiedAt),
		firstRecallCompletedAt: asTimestamp(rawState.firstRecallCompletedAt),
		firstRecallMatchedCount: asNonNegativeInteger(rawState.firstRecallMatchedCount, 0),
		firstRecallQuery: asString(rawState.firstRecallQuery),
		trackedWorkflowObservedAt: asTimestamp(rawState.trackedWorkflowObservedAt),
		trackedWorkflowTaskId: asString(rawState.trackedWorkflowTaskId),
		lastUpdatedAt: asTimestamp(rawState.lastUpdatedAt) || new Date().toISOString(),
	};
};

export const shouldShowOnboardingEntryPrompt = (state: OnboardingSettingsState): boolean =>
	state.entryPromptVersion < CURRENT_ONBOARDING_ENTRY_PROMPT_VERSION
	&& asTimestamp(state.entryDeferredAt) === '';

export const markOnboardingEntryPromptDeferred = (state: OnboardingSettingsState): OnboardingSettingsState =>
	timestamped(state, {
		entryPromptVersion: CURRENT_ONBOARDING_ENTRY_PROMPT_VERSION,
		entryDeferredAt: new Date().toISOString(),
	});

export const markOnboardingEntryPromptOpened = (state: OnboardingSettingsState): OnboardingSettingsState =>
	timestamped(state, {
		entryPromptVersion: CURRENT_ONBOARDING_ENTRY_PROMPT_VERSION,
		entryDeferredAt: '',
	});

const stepIsCompleted = (
	state: OnboardingSettingsState,
	context: OnboardingProgressContext,
	step: OnboardingStep
): boolean => {
	switch (step) {
		case 'vault_check': return context.vaultReady;
		case 'runtime': return context.runtimeRunning;
		case 'client_configuration': return context.clientConfigured;
		case 'skill_setup': return context.skillSetupConfirmed;
		case 'agent_restart': return context.agentRestartConfirmed;
		case 'connection_verification': return context.connectionVerified;
		case 'first_recall': return context.firstRecallCompleted && asNonNegativeInteger(state.firstRecallMatchedCount, 0) > 0;
		case 'complete': return ONBOARDING_STEP_SEQUENCE.every((currentStep) => stepIsCompleted(state, context, currentStep));
		default: return false;
	}
};

export const isOnboardingStepCompleted = (
	step: OnboardingStep,
	state: OnboardingSettingsState,
	context: OnboardingProgressContext
): boolean => stepIsCompleted(state, context, step);

export const getNextOnboardingStep = (
	state: OnboardingSettingsState,
	context: OnboardingProgressContext
): OnboardingStep => ONBOARDING_STEP_SEQUENCE.find((step) => !stepIsCompleted(state, context, step)) || 'complete';

export const hasOnboardingRecallResult = (state: OnboardingSettingsState): boolean =>
	state.firstRecallCompletedAt !== '' && asNonNegativeInteger(state.firstRecallMatchedCount, 0) > 0;

export const hasOnboardingConnectionEvidence = (
	evidence: readonly OnboardingConnectionEvidence[],
	principalId: string,
	notBefore: number
): boolean => evidence.some((entry) =>
	entry.principalId === principalId
	&& entry.transport === 'streamable-http'
	&& entry.sortTimestamp >= notBefore
);

export const findOnboardingRecallEvidence = (
	evidence: readonly OnboardingRecallEvidence[],
	principalId: string,
	notBefore: number
): (OnboardingRecallEvidence & { matchedCount: number }) | null => {
	for (const entry of evidence) {
		const match = entry.resultSummary.match(/(?:^|\|)\s*matched_count=(\d+)/);
		const matchedCount = match ? Number.parseInt(match[1], 10) : 0;
		if (entry.principalId === principalId
			&& entry.toolName === 'tracekeeper.recall'
			&& entry.resultStatus === 'success'
			&& entry.sortTimestamp >= notBefore
			&& matchedCount > 0) return { ...entry, matchedCount };
	}
	return null;
};

export const findOnboardingTrackedWorkflowEvidence = (
	evidence: readonly OnboardingToolEvidence[],
	principalId: string,
	notBefore: number
): OnboardingTrackedWorkflowEvidence | null => {
	const entries = evidence
		.filter((entry) => entry.principalId === principalId && entry.resultStatus === 'success' && entry.sortTimestamp >= notBefore)
		.sort((left, right) => left.sortTimestamp - right.sortTimestamp);
	for (const start of entries.filter((entry) => entry.toolName === 'tracekeeper.start_task')) {
		const taskId = asString(start.taskId) || extractTaskId(start.resultSummary);
		if (!taskId) continue;
		const recall = entries.find((entry) => entry.toolName === 'tracekeeper.recall' && entry.sortTimestamp >= start.sortTimestamp);
		if (!recall) continue;
		const finish = entries.find((entry) =>
			entry.toolName === 'tracekeeper.finish_task'
			&& entry.sortTimestamp >= recall.sortTimestamp
			&& (asString(entry.taskId) || extractTaskId(`${entry.argsSummary}|${entry.resultSummary}`)) === taskId
		);
		if (finish) {
			return {
				taskId,
				startTimestamp: start.sortTimestamp,
				recallTimestamp: recall.sortTimestamp,
				finishTimestamp: finish.sortTimestamp,
			};
		}
	}
	return null;
};

export const markClientConfigured = (state: OnboardingSettingsState, clientId: string): OnboardingSettingsState => ({
	...state,
	selectedClientId: clientId,
	clientConfiguredAt: new Date().toISOString(),
	lastUpdatedAt: new Date().toISOString(),
});

export const markSkillCopied = (state: OnboardingSettingsState): OnboardingSettingsState => timestamped(state, { skillCopiedAt: new Date().toISOString() });

export const markSkillUserConfirmed = (state: OnboardingSettingsState): OnboardingSettingsState => {
	const timestamp = new Date().toISOString();
	return timestamped(state, { skillSetupCompletedAt: timestamp, skillUserConfirmedAt: timestamp });
};

export const markSkillSetupDone = markSkillUserConfirmed;

export const markSkillFileVerified = (
	state: OnboardingSettingsState,
	bundleHash: string
): OnboardingSettingsState => timestamped(state, {
	skillFileVerifiedAt: new Date().toISOString(),
	skillVerifiedBundleHash: asString(bundleHash),
	skillUpdateAvailableAt: '',
});

export const markSkillUpdateAvailable = (
	state: OnboardingSettingsState,
	available: boolean
): OnboardingSettingsState => timestamped(state, {
	skillUpdateAvailableAt: available ? new Date().toISOString() : '',
	skillFileVerifiedAt: available ? '' : state.skillFileVerifiedAt,
	skillVerifiedBundleHash: available ? '' : state.skillVerifiedBundleHash,
});

export const markAgentRestartDone = (state: OnboardingSettingsState): OnboardingSettingsState =>
	timestamped(state, { agentRestartCompletedAt: new Date().toISOString() });

export const markConnectionVerified = (state: OnboardingSettingsState): OnboardingSettingsState =>
	timestamped(state, { connectionVerifiedAt: new Date().toISOString() });

export const markFirstRecallDone = (
	state: OnboardingSettingsState,
	matchedCount: number,
	query: string
): OnboardingSettingsState => {
	const nextMatchedCount = asNonNegativeInteger(matchedCount, 0);
	if (nextMatchedCount <= 0) return state;
	return timestamped(state, {
		firstRecallCompletedAt: new Date().toISOString(),
		firstRecallMatchedCount: nextMatchedCount,
		firstRecallQuery: asString(query),
	});
};

export const markTrackedWorkflowObserved = (
	state: OnboardingSettingsState,
	taskId: string
): OnboardingSettingsState => timestamped(state, {
	trackedWorkflowObservedAt: new Date().toISOString(),
	trackedWorkflowTaskId: asString(taskId),
});

export const resetOnboardingState = (): OnboardingSettingsState => ({
	...DEFAULT_ONBOARDING_SETTINGS,
	selectedClientId: 'codex',
	lastUpdatedAt: new Date().toISOString(),
});

function timestamped(
	state: OnboardingSettingsState,
	change: Partial<OnboardingSettingsState>
): OnboardingSettingsState {
	return { ...state, ...change, lastUpdatedAt: new Date().toISOString() };
}

function extractTaskId(value: string): string {
	const match = value.match(/task_id(?:["']?\s*[:=]\s*["']?)([A-Za-z0-9._-]+)/i);
	return match?.[1] || '';
}
