import {
	generateRuntimeAccessToken,
	isRuntimeAccessToken,
} from '../settings/local-trust-settings';

export interface RuntimeAccessResetControllerOptions {
	getAccessToken(): string;
	setAccessToken(value: string): void;
	isRuntimeEnabled(): boolean;
	stopRuntime(): Promise<void>;
	persistSettings(): Promise<void>;
	startRuntime(): Promise<void>;
	createToken?: () => string;
}

export interface RuntimeAccessResetResult {
	runtimeRestarted: boolean;
}

export class RuntimeAccessResetError extends Error {
	constructor(
		message: string,
		readonly rollbackSucceeded: boolean
	) {
		super(message);
		this.name = 'RuntimeAccessResetError';
	}
}

export class RuntimeAccessResetController {
	private resetInFlight: Promise<RuntimeAccessResetResult> | null = null;

	constructor(private readonly options: RuntimeAccessResetControllerOptions) {}

	reset(): Promise<RuntimeAccessResetResult> {
		if (this.resetInFlight) {
			return this.resetInFlight;
		}
		const operation = this.performReset();
		this.resetInFlight = operation;
		void operation.then(
			() => {
				if (this.resetInFlight === operation) {
					this.resetInFlight = null;
				}
			},
			() => {
				if (this.resetInFlight === operation) {
					this.resetInFlight = null;
				}
			}
		);
		return operation;
	}

	private async performReset(): Promise<RuntimeAccessResetResult> {
		let previousToken: string;
		let replacementToken: string;
		let runtimeEnabled: boolean;
		try {
			previousToken = this.options.getAccessToken();
			replacementToken = (this.options.createToken ?? generateRuntimeAccessToken)();
			runtimeEnabled = this.options.isRuntimeEnabled();
		} catch {
			throw new RuntimeAccessResetError(
				'Access credential reset could not start.',
				true
			);
		}
		if (
			!isRuntimeAccessToken(previousToken)
			|| !isRuntimeAccessToken(replacementToken)
			|| replacementToken === previousToken
		) {
			throw new RuntimeAccessResetError(
				'Access credential reset could not start.',
				true
			);
		}
		try {
			await this.options.stopRuntime();
			this.options.setAccessToken(replacementToken);
			await this.options.persistSettings();
			if (runtimeEnabled) {
				await this.options.startRuntime();
			}
			return {
				runtimeRestarted: runtimeEnabled,
			};
		} catch {
			const rollbackSucceeded = await this.rollback(previousToken, runtimeEnabled);
			throw new RuntimeAccessResetError(
				rollbackSucceeded
					? 'Access credential reset failed. The previous credential and Runtime state were restored.'
					: 'Access credential reset failed and automatic recovery could not be completed.',
				rollbackSucceeded
			);
		}
	}

	private async rollback(previousToken: string, runtimeEnabled: boolean): Promise<boolean> {
		let rollbackSucceeded = true;
		try {
			await this.options.stopRuntime();
		} catch {
			rollbackSucceeded = false;
		}
		try {
			this.options.setAccessToken(previousToken);
		} catch {
			rollbackSucceeded = false;
		}
		try {
			await this.options.persistSettings();
		} catch {
			rollbackSucceeded = false;
		}
		if (runtimeEnabled) {
			try {
				await this.options.startRuntime();
			} catch {
				rollbackSucceeded = false;
			}
		}
		return rollbackSucceeded;
	}
}
