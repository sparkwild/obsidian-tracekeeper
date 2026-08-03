import {
	computePayloadHash,
	RecoverableOperationRunner,
	type OperationFailureInjection,
	type OperationJournal,
} from '@tracekeeper/core';

export interface FinishTaskRunnerStep {
	name: string;
	execute(): Promise<unknown>;
	persistResult?: boolean;
}

export interface FinishTaskLifecycleState {
	status: string;
	finishOperationId: string;
}

export interface FinishTaskApplicationDependencies<TRawArgs extends object, TPayload, TResult> {
	journal: OperationJournal;
	failureInjection?: OperationFailureInjection;
	requestSnapshot(rawArgs: TRawArgs): unknown;
	requestIdempotencyKey(rawArgs: TRawArgs): string;
	createIdentity(requestHash: string, idempotencyKey: string, requestSnapshot: unknown): {
		operationId: string;
		idempotencyKey: string;
	};
	loadExistingPayload(payload: unknown): boolean;
	storedRequestHash(payload: unknown): string;
	buildPayload(
		rawArgs: TRawArgs,
		operationId: string,
		requestHash: string,
		requestSnapshot: unknown
	): Promise<TPayload>;
	getTaskId(payload: TPayload): string;
	readLifecycle(taskId: string): Promise<FinishTaskLifecycleState | null>;
	markClosing(payload: TPayload, operationId: string): Promise<void>;
	buildSteps(payload: TPayload, operationId: string): FinishTaskRunnerStep[];
	finalize(payload: TPayload, operationId: string, idempotencyKey: string): Promise<TResult>;
}

export class FinishTaskApplicationService<TRawArgs extends object, TPayload, TResult> {
	private readonly dependencies: FinishTaskApplicationDependencies<TRawArgs, TPayload, TResult>;

	constructor(dependencies: FinishTaskApplicationDependencies<TRawArgs, TPayload, TResult>) {
		this.dependencies = dependencies;
	}

	async execute(rawArgs: TRawArgs): Promise<TResult> {
		const { dependencies } = this;
		const requestSnapshot = dependencies.requestSnapshot(rawArgs);
		const requestHash = computePayloadHash(requestSnapshot);
		const identity = dependencies.createIdentity(
			requestHash,
			dependencies.requestIdempotencyKey(rawArgs),
			requestSnapshot
		);
		const existing = await dependencies.journal.loadByIdempotencyKey(identity.idempotencyKey);
		let operationPayload: TPayload;

		if (existing) {
			if (existing.operation_id !== identity.operationId) {
				throw new Error(
					`Idempotency key conflict for "${identity.idempotencyKey}": associated with existing operation "${existing.operation_id}"`
				);
			}
			if (!dependencies.loadExistingPayload(existing.payload)) {
				throw new Error(
					`Idempotency key conflict for "${identity.idempotencyKey}" with incompatible finish_task request payload`
				);
			}
			const storedRequestHash = dependencies.storedRequestHash(existing.payload);
			if (storedRequestHash && storedRequestHash !== requestHash) {
				throw new Error(
					`Idempotency key conflict for "${identity.idempotencyKey}" with different finish_task request hash`
				);
			}
			operationPayload = existing.payload as TPayload;
		} else {
			operationPayload = await dependencies.buildPayload(
				rawArgs,
				identity.operationId,
				requestHash,
				requestSnapshot
			);
			const lifecycle = await dependencies.readLifecycle(dependencies.getTaskId(operationPayload));
			if (lifecycle?.status === 'completed') {
				throw new Error(`Task is already completed: ${dependencies.getTaskId(operationPayload)}`);
			}
			if (
				lifecycle?.status === 'closing'
				&& lifecycle.finishOperationId
				&& lifecycle.finishOperationId !== identity.operationId
			) {
				throw new Error(
					`Task is closing under another operation: ${dependencies.getTaskId(operationPayload)}`
				);
			}
			await dependencies.markClosing(operationPayload, identity.operationId);
		}

		const runner = new RecoverableOperationRunner<TPayload, TResult>({
			operationId: identity.operationId,
			idempotencyKey: identity.idempotencyKey,
			payload: operationPayload,
			journal: dependencies.journal,
			failureInjection: dependencies.failureInjection,
			steps: dependencies.buildSteps(operationPayload, identity.operationId).map((step) => ({
				name: step.name,
				execute: () => step.execute(),
				persistResult: step.persistResult,
			})),
			finalize: () => dependencies.finalize(
				operationPayload,
				identity.operationId,
				identity.idempotencyKey
			),
		});
		return runner.run();
	}
}

export interface DistillSessionRawRequest {
	task_id?: unknown;
	summary?: unknown;
	decisions?: unknown;
	next_actions?: unknown;
	possible_preferences?: unknown;
	outcomes?: unknown;
	project_hint?: unknown;
	filename?: unknown;
}

export interface DistillSessionProposal {
	proposalId: string;
	path: string;
	linkTarget: string;
}

export interface DistillSessionNote {
	path: string;
	audit_path: string;
}

export interface DistillSessionApplicationDependencies {
	resolveProjectHint(taskId: string, explicitProjectHint: string): Promise<string>;
	assertSafeText(values: Array<{ label: string; value: string }>): void;
	buildFilename(rawFilename: unknown, fallbackPrefix: string): string;
	now(): string;
	renderText(zh: string, en: string): string;
	buildBody(
		summary: string,
		outcomes: string[],
		nextActions: string[],
		decisions: string[],
		possiblePreferences: string[]
	): string;
	writeSessionNote(input: {
		filename: string;
		frontmatter: Record<string, unknown>;
		body: string;
		taskId: string;
		metadata: Record<string, unknown>;
	}): Promise<DistillSessionNote>;
	memoryProposalAllowed(proposalKind: string, projectHint: string): boolean;
	createProposal(input: {
		taskId: string;
		proposalKind: string;
		kindLabel: string;
		values: string[];
		projectHint: string;
	}): Promise<DistillSessionProposal>;
	updateTask(
		taskId: string,
		notePath: string,
		proposals: readonly DistillSessionProposal[]
	): Promise<string | null>;
	updateManagedProposalReferences(
		recordPath: string,
		proposals: readonly DistillSessionProposal[]
	): Promise<void>;
}

export class DistillSessionApplicationService {
	private readonly dependencies: DistillSessionApplicationDependencies;

	constructor(dependencies: DistillSessionApplicationDependencies) {
		this.dependencies = dependencies;
	}

	private requiredString(value: unknown, field: string): string {
		if (typeof value !== 'string' || value.trim() === '') {
			throw new Error(`Missing required string argument: ${field}.`);
		}
		return value.trim();
	}

	private stringArray(value: unknown, field: string): string[] {
		if (value === undefined || value === null) {
			return [];
		}
		if (typeof value === 'string') {
			return value.trim() ? [value.trim()] : [];
		}
		if (Array.isArray(value)) {
			if (value.some((entry) => typeof entry !== 'string')) {
				throw new Error(`${field} array must contain only strings.`);
			}
			return value.map((entry) => (entry as string).trim()).filter(Boolean);
		}
		throw new Error(`${field} must be a string or string array.`);
	}

	async execute(rawArgs: DistillSessionRawRequest) {
		const { dependencies } = this;
		const taskId = this.requiredString(rawArgs.task_id, 'task_id');
		const summary = this.requiredString(rawArgs.summary, 'summary');
		const decisions = this.stringArray(rawArgs.decisions, 'decisions');
		const nextActions = this.stringArray(rawArgs.next_actions, 'next_actions');
		const possiblePreferences = this.stringArray(rawArgs.possible_preferences, 'possible_preferences');
		const outcomes = this.stringArray(rawArgs.outcomes, 'outcomes');
		const explicitProjectHint = typeof rawArgs.project_hint === 'string'
			? rawArgs.project_hint.trim()
			: '';
		const projectHint = await dependencies.resolveProjectHint(taskId, explicitProjectHint);
		dependencies.assertSafeText([
			{ label: 'summary', value: summary },
			{ label: 'decisions', value: decisions.join('\n') },
			{ label: 'next_actions', value: nextActions.join('\n') },
			{ label: 'possible_preferences', value: possiblePreferences.join('\n') },
			{ label: 'outcomes', value: outcomes.join('\n') },
			{ label: 'project_hint', value: projectHint },
		]);

		const now = dependencies.now();
		const filename = dependencies.buildFilename(rawArgs.filename, 'session');
		const body = dependencies.buildBody(summary, outcomes, nextActions, decisions, possiblePreferences);
		const note = await dependencies.writeSessionNote({
			filename,
			frontmatter: {
				tool: 'tracekeeper.distill_session',
				type: 'session_note',
				title: dependencies.renderText(`任务 ${taskId} 提炼记录`, `Task ${taskId} distill note`),
				task_id: taskId,
				project_hint: projectHint || null,
				related_project: projectHint || null,
				created_at: now,
			},
			body,
			taskId,
			metadata: { target_type: 'session_note', task_stage: 'distill' },
		});

		const proposals: DistillSessionProposal[] = [];
		if (decisions.length > 0 && dependencies.memoryProposalAllowed('distill_decisions', projectHint)) {
			proposals.push(await dependencies.createProposal({
				taskId,
				proposalKind: 'distill_decisions',
				kindLabel: 'Decisions',
				values: decisions,
				projectHint,
			}));
		}
		if (possiblePreferences.length > 0 && dependencies.memoryProposalAllowed('distill_preferences', projectHint)) {
			proposals.push(await dependencies.createProposal({
				taskId,
				proposalKind: 'distill_preferences',
				kindLabel: 'Possible Preferences',
				values: possiblePreferences,
				projectHint,
			}));
		}

		const taskPath = await dependencies.updateTask(taskId, note.path, proposals);
		await dependencies.updateManagedProposalReferences(note.path, proposals);
		if (taskPath) {
			await dependencies.updateManagedProposalReferences(taskPath, proposals);
		}

		return {
			ok: true,
			read_only: false,
			task_id: taskId,
			path: note.path,
			audit_path: note.audit_path,
			proposals: proposals.map((proposal) => ({
				proposal_id: proposal.proposalId,
				path: proposal.path,
				proposal_link_target: proposal.linkTarget,
			})),
			proposal_count: proposals.length,
		};
	}
}
