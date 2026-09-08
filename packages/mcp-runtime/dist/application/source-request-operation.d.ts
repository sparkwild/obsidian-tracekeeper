import { type OperationFailureInjection, type OperationJournal, type OperationRecord } from '@tracekeeper/core';
interface SourceRequestExecutionPayload<TRequest> {
    kind: 'source-request-v2';
    request: TRequest;
    requestSnapshot: Record<string, unknown>;
    tool: string;
    now: string;
    step_values?: Record<string, {
        value: unknown;
        undefined: boolean;
    }>;
}
/** 旧 Source 分析入口的执行身份与步骤结果；输出已落盘时只续作关系提交。 */
export declare class SourceRequestExecution<TRequest extends {
    path: string;
    status: string;
}> {
    private readonly journal;
    readonly record: OperationRecord;
    readonly payload: SourceRequestExecutionPayload<TRequest>;
    private readonly release;
    private readonly failure?;
    private constructor();
    static begin<TRequest extends {
        path: string;
        status: string;
    }>(input: {
        journal: OperationJournal;
        request: TRequest;
        args: Record<string, unknown>;
        tool: string;
        force: boolean;
        beforeNew: () => Promise<void>;
        recoveryId?: string;
        failure?: OperationFailureInjection;
    }): Promise<SourceRequestExecution<TRequest>>;
    step<T>(name: string, action: () => Promise<T>): Promise<T>;
    run<T>(action: () => Promise<T>): Promise<T>;
}
export {};
