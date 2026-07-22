import { type OperationFailureInjection, type ScanResult, type VaultRepository } from '@tracekeeper/core';
import { type McpPrompt, type McpStructuredToolResult, type McpToolDefinition } from './protocol';
interface MemoryRulesContext {
    globalMemoryRule?: unknown;
    projectMemoryRule?: unknown;
    taskMemoryProposalMode?: unknown;
}
interface ToolContext {
    defaultVaultRoot?: string;
    vaultConfigDir?: string;
    vaultRepository?: VaultRepository;
    knowledgeSnapshotProvider?: (vaultRoot: string) => ScanResult | null;
    graphProfile?: unknown;
    memoryRules?: MemoryRulesContext;
    contentLanguage?: unknown;
    contentLanguageSource?: unknown;
}
export interface ToolInvocationContext extends ToolContext {
    principalId?: string;
    credentialCapabilities?: readonly string[];
    agentId?: string;
    sessionId?: string;
    clientName?: string | null;
    transport?: string;
    runtimeVersion?: string;
    operationFailureInjection?: OperationFailureInjection;
}
interface ConnectionAuditEventInput {
    principalId?: string;
    agentId: string;
    sessionId?: string;
    clientName: string | null;
    transport: string;
    runtimeVersion: string;
}
interface ToolCallAuditEventInput {
    toolName: string;
    resultStatus: 'success' | 'failed';
    targetPaths: string[];
    durationMs: number;
    riskLevel: string;
    agentId: string;
    principalId?: string;
    sessionId?: string;
    clientName: string | null;
    transport?: string;
    runtimeVersion?: string;
    argsSummary: string;
    resultSummary: string;
    workflowMetadata?: Record<string, unknown>;
}
export declare function appendConnectionAuditEvent(vaultRoot: string, input: ConnectionAuditEventInput): {
    path: string;
};
export declare function recordToolCallAuditEvent(vaultRoot: string, input: ToolCallAuditEventInput): {
    path: string;
};
export declare function toolDefinitions(capabilities?: readonly string[]): McpToolDefinition[];
export declare function toolPrompts(): McpPrompt[];
export declare function callTool(name: string, rawParams: unknown, context?: ToolInvocationContext): Promise<McpStructuredToolResult>;
export interface OperationRecoveryReport {
    recovered: string[];
    failed: Array<{
        operation_id: string;
        error: string;
    }>;
    skipped: string[];
}
export declare function recoverPendingOperations(vaultRoot: string, context?: ToolInvocationContext): Promise<OperationRecoveryReport>;
export {};
