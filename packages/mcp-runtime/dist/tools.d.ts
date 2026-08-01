import { type OperationFailureInjection, type ProposalTransitionCommand, type ProposalTransitionDecision, type ScanResult, type VaultRepository } from '@tracekeeper/core';
import { type McpPrompt, type McpStructuredToolResult, type McpToolDefinition } from './protocol';
import { type ObservedClientType } from './observed-client';
export declare const LOCAL_TRUST_PRINCIPAL_ID = "local-user";
export declare const LOCAL_TRUST_CAPABILITIES: readonly ["vault.read", "workflow.manage", "vault.write", "memory.propose"];
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
    proposalTransitionPort?: ProposalTransitionPort;
}
export interface ProposalTransitionPort {
    transition(request: ProposalTransitionCommand & {
        proposalPath: string;
        expectedFileHash?: string;
        now?: string;
        actor?: string;
    }): Promise<ProposalTransitionDecision>;
}
export interface ToolInvocationContext extends ToolContext {
    requestId?: string;
    principalId?: string;
    credentialCapabilities?: readonly string[];
    agentId?: string;
    sessionId?: string;
    clientName?: string | null;
    clientVersion?: string | null;
    observedClientType?: ObservedClientType;
    transport?: string;
    runtimeVersion?: string;
    operationFailureInjection?: OperationFailureInjection;
    writebackConfirmationClock?: () => number;
    writebackConfirmationTtlMs?: number;
    writebackConfirmationSecret?: string | Uint8Array;
    writebackRecoveryOperationId?: string;
}
interface ConnectionAuditEventInput {
    principalId?: string;
    agentId: string;
    sessionId?: string;
    clientName: string | null;
    clientVersion: string | null;
    observedClientType: ObservedClientType;
    transport: string;
    runtimeVersion: string;
}
interface ToolCallAuditEventInput {
    requestId?: string;
    toolName: string;
    resultStatus: 'success' | 'failed';
    targetPaths: string[];
    durationMs: number;
    riskLevel: string;
    agentId: string;
    principalId?: string;
    sessionId?: string;
    clientName: string | null;
    clientVersion?: string | null;
    observedClientType?: ObservedClientType;
    transport?: string;
    runtimeVersion?: string;
    argsSummary: string;
    resultSummary: string;
    workflowMetadata?: Record<string, unknown>;
}
export interface AuditRecentSection {
    heading: string;
    body: string[];
    at_line: number;
    audit_event_id: string;
    timestamp: string;
    source_path: string;
    source_kind: 'legacy' | 'shard';
    action: string;
}
export declare function readMergedAuditSections(vaultRoot: string, context: Pick<ToolContext, 'vaultConfigDir' | 'vaultRepository'>): Promise<AuditRecentSection[]>;
export declare function appendConnectionAuditEvent(vaultRoot: string, input: ConnectionAuditEventInput): {
    path: string;
};
export declare function appendRuntimeDiagnosticAuditEvent(vaultRoot: string, reason: 'auth_missing' | 'auth_invalid' | 'query_token_rejected'): {
    path: string;
};
export declare function recordToolCallAuditEvent(vaultRoot: string, input: ToolCallAuditEventInput): {
    path: string;
};
export declare function recordRejectedToolCallAuditEvent(context: ToolInvocationContext, reason: 'tool_call_invalid_name' | 'tool_call_invalid_arguments' | 'tool_call_unknown'): Promise<void>;
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
