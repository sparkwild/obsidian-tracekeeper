import { type VaultRepository } from '@tracekeeper/core';
export interface AuditPersistenceContext {
    vaultConfigDir?: string;
    vaultRepository?: VaultRepository;
}
export interface AuditEventInput {
    operationId?: string;
    invocationId?: string;
    requestId?: string;
    type?: string;
    event?: string;
    tool?: string;
    action?: string;
    actor?: string;
    timestamp?: string;
    targetPath?: string;
    targetPaths?: string[];
    resultStatus?: 'written' | 'skipped' | 'failed' | 'success';
    status?: 'written' | 'skipped' | 'failed' | 'success';
    agentId?: string;
    principalId?: string;
    sessionId?: string;
    clientName?: string | null;
    taskId?: string | null;
    warnings?: string[];
    durationMs?: number;
    riskLevel?: string;
    transport?: string;
    runtimeVersion?: string;
    argsSummary?: string;
    metadata?: Record<string, unknown>;
}
export interface AuditEventOutput {
    path: string;
}
export interface AuditRecentSection {
    heading: string;
    body: string[];
    at_line: number;
    activity_event_id: string;
    timestamp: string;
    source_path: string;
    source_kind: 'shard';
    action: string;
}
export declare const agentActivityPath = "00_tracekeeper/control/agent_activity/index.md";
export declare function projectArgumentsForAudit(toolName: string, args: Record<string, unknown>): Record<string, unknown>;
export declare function summarizeForAudit(args: Record<string, unknown>, limit?: number): string;
export declare function collectAuditTargetsFromArgs(_toolName: string, args: Record<string, unknown>): string[];
export declare function collectAuditTargetsFromResult(toolName: string, args: Record<string, unknown>, resultPayload: unknown): string[];
export declare function readMergedAuditSections(vaultRoot: string, context: AuditPersistenceContext): Promise<AuditRecentSection[]>;
export declare function appendAuditEvent(vaultRoot: string, input: AuditEventInput): AuditEventOutput;
export declare function appendAuditEventAsync(vaultRoot: string, input: AuditEventInput, context: AuditPersistenceContext): Promise<AuditEventOutput>;
