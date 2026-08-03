import type { ClientPairingState } from './client-config';

export type ConnectionUiState =
	| 'idle'
	| 'preparing'
	| 'ready'
	| 'awaiting_confirmation'
	| 'authorized'
	| 'expired'
	| 'failed'
	| 'retry'
	| 'manual';

export type ConnectionClipboardState = 'idle' | 'copied' | 'failed';
export type ConnectionPrimaryAction = 'start' | 'reconnect' | 'copy_setup' | 'retry' | 'close' | null;
export type ConnectionSecondaryAction = 'copy_setup' | 'technical_details' | 'help';
export type ConnectionVisibleSection =
	| 'intro'
	| 'usage_summary'
	| 'instructions'
	| 'pairing_code'
	| 'manual_setup'
	| 'recovery'
	| 'skill'
	| 'technical_details';

export interface ConnectionPresentationInput {
	mode: 'add' | 'manage';
	supportsLocalOAuth: boolean;
	pairingLoading: boolean;
	pairingState: ClientPairingState | null;
	hasPairingTicket: boolean;
	clipboardState: ConnectionClipboardState;
}

export interface ConnectionPresentation {
	state: ConnectionUiState;
	primaryAction: ConnectionPrimaryAction;
	secondaryActions: readonly ConnectionSecondaryAction[];
	visibleSections: readonly ConnectionVisibleSection[];
	isBusy: boolean;
}

const technicalDetails: readonly ConnectionVisibleSection[] = ['technical_details'];

export function buildConnectionPresentation(
	input: ConnectionPresentationInput
): ConnectionPresentation {
	if (!input.supportsLocalOAuth) {
		return {
			state: 'manual',
			primaryAction: 'copy_setup',
			secondaryActions: ['technical_details'],
			visibleSections: ['manual_setup', ...technicalDetails],
			isBusy: false,
		};
	}

	if (input.pairingLoading) {
		return {
			state: 'preparing',
			primaryAction: null,
			secondaryActions: [],
			visibleSections: ['intro'],
			isBusy: true,
		};
	}

	switch (input.pairingState) {
		case 'ready':
			return {
				state: 'ready',
				primaryAction: input.clipboardState === 'failed' ? 'copy_setup' : null,
				secondaryActions: ['copy_setup', 'technical_details', 'help'],
				visibleSections: [
					'instructions',
					...(input.hasPairingTicket ? (['pairing_code'] as const) : []),
					...technicalDetails,
				],
				isBusy: false,
			};
		case 'awaiting_confirmation':
			return {
				state: 'awaiting_confirmation',
				primaryAction: null,
				secondaryActions: ['technical_details'],
				visibleSections: ['instructions', ...technicalDetails],
				isBusy: false,
			};
		case 'redeemed':
			return {
				state: 'authorized',
				primaryAction: 'close',
				secondaryActions: ['technical_details'],
				visibleSections: ['usage_summary', 'skill', ...technicalDetails],
				isBusy: false,
			};
		case 'expired':
			return recoveryPresentation('expired');
		case 'failed':
			return recoveryPresentation('failed');
		case 'retry':
			return recoveryPresentation('retry');
		case null:
		default:
			return input.mode === 'manage'
				? {
						state: 'idle',
						primaryAction: 'reconnect',
						secondaryActions: ['technical_details'],
						visibleSections: ['usage_summary', 'skill', ...technicalDetails],
						isBusy: false,
					}
				: {
						state: 'idle',
						primaryAction: 'start',
						secondaryActions: ['technical_details'],
						visibleSections: ['intro', ...technicalDetails],
						isBusy: false,
					};
	}
}

function recoveryPresentation(state: Extract<ConnectionUiState, 'expired' | 'failed' | 'retry'>): ConnectionPresentation {
	return {
		state,
		primaryAction: 'retry',
		secondaryActions: ['technical_details'],
		visibleSections: ['recovery', ...technicalDetails],
		isBusy: false,
	};
}
