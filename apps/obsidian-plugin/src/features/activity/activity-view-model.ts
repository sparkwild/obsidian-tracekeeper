import type { RuntimeViewModelInput } from '../runtime/runtime-view-model';
import { runtimeViewModel } from '../runtime/runtime-view-model';
import type { StructureState } from '../structure/legacy-migration-controller';
import type { AgentConnectionRecord } from './activity-model';

export type ActivityPrimaryAction =
	| 'repair_structure'
	| 'recover_runtime'
	| 'continue_onboarding'
	| 'review_changes'
	| 'inspect_diagnostics'
	| 'none';

export interface ActivityPrimaryActionInput {
	structureState: StructureState;
	runtimeStatus: RuntimeViewModelInput;
	onboardingComplete: boolean;
	actionableReviewQueueItemCount: number;
	agedWorkflowCount: number;
	permissionDeniedCount: number;
}

export interface ActivityAgentSummary {
	state: 'observed' | 'not_observed';
	latestAgent: AgentConnectionRecord | null;
}

export function selectActivityPrimaryAction(input: ActivityPrimaryActionInput): ActivityPrimaryAction {
	if (input.structureState !== 'initialized') {
		return 'repair_structure';
	}

	const runtime = runtimeViewModel(input.runtimeStatus);
	if (runtime.primaryAction !== 'none') {
		return 'recover_runtime';
	}
	if (runtime.state !== 'running') {
		return 'none';
	}
	if (!input.onboardingComplete) {
		return 'continue_onboarding';
	}
	if (input.actionableReviewQueueItemCount > 0) {
		return 'review_changes';
	}
	if (input.agedWorkflowCount > 0 || input.permissionDeniedCount > 0) {
		return 'inspect_diagnostics';
	}
	return 'none';
}

export function buildActivityAgentSummary(recentAgents: AgentConnectionRecord[]): ActivityAgentSummary {
	const latestAgent = recentAgents[0] ?? null;
	return {
		state: latestAgent ? 'observed' : 'not_observed',
		latestAgent,
	};
}
