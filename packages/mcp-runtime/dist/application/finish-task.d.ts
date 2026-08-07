import { type OperationFailureInjection, type OperationJournal } from '@tracekeeper/core';
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
    buildPayload(rawArgs: TRawArgs, operationId: string, requestHash: string, requestSnapshot: unknown): Promise<TPayload>;
    getTaskId(payload: TPayload): string;
    readLifecycle(taskId: string): Promise<FinishTaskLifecycleState | null>;
    markClosing(payload: TPayload, operationId: string): Promise<void>;
    buildSteps(payload: TPayload, operationId: string): FinishTaskRunnerStep[];
    finalize(payload: TPayload, operationId: string, idempotencyKey: string): Promise<TResult>;
}
export declare class FinishTaskApplicationService<TRawArgs extends object, TPayload, TResult> {
    private readonly dependencies;
    constructor(dependencies: FinishTaskApplicationDependencies<TRawArgs, TPayload, TResult>);
    execute(rawArgs: TRawArgs): Promise<TResult>;
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
    activity_path: string;
}
export interface DistillSessionApplicationDependencies {
    resolveProjectHint(taskId: string, explicitProjectHint: string): Promise<string>;
    assertSafeText(values: Array<{
        label: string;
        value: string;
    }>): void;
    buildFilename(rawFilename: unknown, fallbackPrefix: string): string;
    now(): string;
    renderText(zh: string, en: string): string;
    buildBody(summary: string, outcomes: string[], nextActions: string[], decisions: string[], possiblePreferences: string[]): string;
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
    updateTask(taskId: string, notePath: string, proposals: readonly DistillSessionProposal[]): Promise<string | null>;
    updateManagedProposalReferences(recordPath: string, proposals: readonly DistillSessionProposal[]): Promise<void>;
}
export declare class DistillSessionApplicationService {
    private readonly dependencies;
    constructor(dependencies: DistillSessionApplicationDependencies);
    private requiredString;
    private stringArray;
    execute(rawArgs: DistillSessionRawRequest): Promise<{
        ok: boolean;
        read_only: boolean;
        task_id: string;
        path: string;
        activity_path: string;
        proposals: {
            proposal_id: string;
            path: string;
            proposal_link_target: string;
        }[];
        proposal_count: number;
    }>;
}
