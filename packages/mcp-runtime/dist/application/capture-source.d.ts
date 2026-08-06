import { type OperationFailureInjection, type OperationJournal } from '@tracekeeper/core';
export interface CaptureSourceRawRequest {
    source?: unknown;
    source_kind?: unknown;
    capture_reason?: unknown;
    task_id?: unknown;
    related_project?: unknown;
    mode?: unknown;
    filename?: unknown;
    title?: unknown;
    content?: unknown;
    text?: unknown;
}
export interface CaptureSourceOperationIdentity {
    operationId: string;
    idempotencyKey: string;
}
export interface CaptureSourceNote {
    path: string;
    activity_path: string;
    status: string;
    warnings: string[];
}
export interface CaptureSourceWriteInput {
    filename: string;
    frontmatter: Record<string, unknown>;
    body: string;
    taskId: string | null;
    metadata: Record<string, unknown>;
    operationId: string;
}
export interface CaptureSourceApplicationDependencies {
    journal: OperationJournal;
    failureInjection?: OperationFailureInjection;
    createIdentity(requestHash: string, idempotencyKey: string): CaptureSourceOperationIdentity;
    now(): string;
    buildFilename(rawFilename: unknown, fallbackPrefix: string): string;
    renderText(zh: string, en: string): string;
    assertSafeText(values: Array<{
        label: string;
        value: string;
    }>): void;
    findOwnedSourceNote(filename: string, operationId: string): Promise<CaptureSourceNote | null>;
    writeSourceNote(input: CaptureSourceWriteInput): Promise<CaptureSourceNote>;
    updateTaskSourceCapture(taskId: string | null, sourcePath: string): Promise<void>;
}
export interface CaptureSourceApplicationRequest {
    rawArgs: CaptureSourceRawRequest;
    requestHash: string;
    idempotencyKey: string;
}
export interface CaptureSourceApplicationResult {
    ok: true;
    tool: 'tracekeeper.capture_source';
    operation_id: string;
    idempotency_key: string;
    status: string;
    path: string;
    activity_path: string;
    warnings: string[];
    metadata: {
        source: string;
        mode: CaptureSourceMode;
    };
}
type CaptureSourceMode = 'external_reference' | 'extracted_snapshot' | 'local_copy';
export declare class CaptureSourceApplicationService {
    private readonly dependencies;
    constructor(dependencies: CaptureSourceApplicationDependencies);
    execute(request: CaptureSourceApplicationRequest): Promise<CaptureSourceApplicationResult>;
    private finalize;
}
export {};
