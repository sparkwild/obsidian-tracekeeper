export const ONBOARDING_STEP_SEQUENCE = [
	'vault_check',
	'runtime',
	'client_configuration',
	'skill_setup',
	'agent_restart',
	'connection_verification',
	'first_recall',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEP_SEQUENCE)[number] | 'complete';

export interface OnboardingProgressContext {
	vaultReady: boolean;
	runtimeRunning: boolean;
	clientConfigured: boolean;
	skillSetupConfirmed: boolean;
	agentRestartConfirmed: boolean;
	connectionVerified: boolean;
	firstRecallCompleted: boolean;
}

export interface OnboardingSettingsState {
	selectedClientId: string;
	clientConfiguredAt: string;
	skillSetupCompletedAt: string;
	agentRestartCompletedAt: string;
	connectionVerifiedAt: string;
	firstRecallCompletedAt: string;
	firstRecallMatchedCount: number;
	firstRecallQuery: string;
	lastUpdatedAt: string;
}

export interface OnboardingConnectionEvidence {
	principalId: string;
	transport: string;
	sortTimestamp: number;
}

export interface OnboardingRecallEvidence {
	principalId: string;
	toolName: string;
	resultStatus: string;
	resultSummary: string;
	argsSummary: string;
	sortTimestamp: number;
}

export const DEFAULT_ONBOARDING_SETTINGS: OnboardingSettingsState = {
	selectedClientId: 'codex',
	clientConfiguredAt: '',
	skillSetupCompletedAt: '',
	agentRestartCompletedAt: '',
	connectionVerifiedAt: '',
	firstRecallCompletedAt: '',
	firstRecallMatchedCount: 0,
	firstRecallQuery: '',
	lastUpdatedAt: '',
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asTimestamp = (value: unknown): string => {
	const valueString = asString(value);
	if (!valueString) {
		return '';
	}
	return Number.isNaN(Date.parse(valueString)) ? '' : valueString;
};

const asNonNegativeInteger = (value: unknown, fallback = 0): number => {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.max(0, Math.floor(value));
	}
	if (typeof value !== 'string') {
		return fallback;
	}
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const normalizeOnboardingSettingsState = (
	raw: unknown
): OnboardingSettingsState => {
	const rawState = (raw && typeof raw === 'object' ? raw : {}) as Partial<OnboardingSettingsState>;
	const normalized: OnboardingSettingsState = {
		selectedClientId: asString(rawState.selectedClientId) || DEFAULT_ONBOARDING_SETTINGS.selectedClientId,
		clientConfiguredAt: asTimestamp(rawState.clientConfiguredAt),
		skillSetupCompletedAt: asTimestamp(rawState.skillSetupCompletedAt),
		agentRestartCompletedAt: asTimestamp(rawState.agentRestartCompletedAt),
		connectionVerifiedAt: asTimestamp(rawState.connectionVerifiedAt),
		firstRecallCompletedAt: asTimestamp(rawState.firstRecallCompletedAt),
		firstRecallMatchedCount: asNonNegativeInteger(rawState.firstRecallMatchedCount, 0),
		firstRecallQuery: asString(rawState.firstRecallQuery),
		lastUpdatedAt: asTimestamp(rawState.lastUpdatedAt) || new Date().toISOString(),
	};
	return normalized;
};

const stepIsCompleted = (
	state: OnboardingSettingsState,
	context: OnboardingProgressContext,
	step: OnboardingStep
): boolean => {
	switch (step) {
		case 'vault_check':
			return context.vaultReady;
		case 'runtime':
			return context.runtimeRunning;
		case 'client_configuration':
			return context.clientConfigured;
		case 'skill_setup':
			return context.skillSetupConfirmed;
		case 'agent_restart':
			return context.agentRestartConfirmed;
		case 'connection_verification':
			return context.connectionVerified;
		case 'first_recall':
			return context.firstRecallCompleted && asNonNegativeInteger(state.firstRecallMatchedCount, 0) > 0;
		case 'complete':
			return ONBOARDING_STEP_SEQUENCE.every((currentStep) => stepIsCompleted(state, context, currentStep));
		default:
			return false;
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
): OnboardingStep => {
	for (const step of ONBOARDING_STEP_SEQUENCE) {
		if (!isOnboardingStepCompleted(step, state, context)) {
			return step;
		}
	}
	return 'complete';
};

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
		if (
			entry.principalId === principalId
			&& entry.toolName === 'tracekeeper.recall'
			&& entry.resultStatus === 'success'
			&& entry.sortTimestamp >= notBefore
			&& matchedCount > 0
		) {
			return { ...entry, matchedCount };
		}
	}
	return null;
};

export const markClientConfigured = (state: OnboardingSettingsState, clientId: string): OnboardingSettingsState => {
	return {
		...state,
		selectedClientId: clientId,
		clientConfiguredAt: new Date().toISOString(),
		lastUpdatedAt: new Date().toISOString(),
	};
};

export const markSkillSetupDone = (state: OnboardingSettingsState): OnboardingSettingsState => ({
	...state,
	skillSetupCompletedAt: new Date().toISOString(),
	lastUpdatedAt: new Date().toISOString(),
});

export const markAgentRestartDone = (state: OnboardingSettingsState): OnboardingSettingsState => ({
	...state,
	agentRestartCompletedAt: new Date().toISOString(),
	lastUpdatedAt: new Date().toISOString(),
});

export const markConnectionVerified = (state: OnboardingSettingsState): OnboardingSettingsState => ({
	...state,
	connectionVerifiedAt: new Date().toISOString(),
	lastUpdatedAt: new Date().toISOString(),
});

export const markFirstRecallDone = (
	state: OnboardingSettingsState,
	matchedCount: number,
	query: string
): OnboardingSettingsState => {
	const nextMatchedCount = asNonNegativeInteger(matchedCount, 0);
	if (nextMatchedCount <= 0) {
		return state;
	}
	return {
		...state,
		firstRecallCompletedAt: new Date().toISOString(),
		firstRecallMatchedCount: nextMatchedCount,
		firstRecallQuery: asString(query),
		lastUpdatedAt: new Date().toISOString(),
	};
};

export const resetOnboardingState = (): OnboardingSettingsState => ({
	...DEFAULT_ONBOARDING_SETTINGS,
	selectedClientId: 'codex',
	lastUpdatedAt: new Date().toISOString(),
});
