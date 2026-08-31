import { type OperationFailureInjection, type ProposalTransitionCommand, type ProposalTransitionDecision, type ScanResult, type KnowledgeReadView, type VaultRepository } from '@tracekeeper/core';
import { type McpPrompt, type McpStructuredToolResult, type McpToolDefinition } from './protocol';
import { type OperationRecoveryReport } from './application/recovery';
import { type ObservedClientType } from './observed-client';
export { readMergedAuditSections } from './infrastructure/audit-persistence';
export type { AuditRecentSection } from './infrastructure/audit-persistence';
export declare const LOCAL_TRUST_PRINCIPAL_ID = "local-user";
export declare const LOCAL_TRUST_CAPABILITIES: readonly ["vault.read", "workflow.manage", "vault.write", "memory.propose"];
interface MemoryRulesContext {
    globalMemoryRule?: unknown;
    projectMemoryRule?: unknown;
    wikiChangeRule?: unknown;
    taskTrackingEnabled?: unknown;
}
interface ToolContext {
    defaultVaultRoot?: string;
    vaultConfigDir?: string;
    vaultRepository?: VaultRepository;
    knowledgeSnapshotProvider?: (vaultRoot: string) => ScanResult | null;
    knowledgeReadViewProvider?: (vaultRoot: string) => Promise<KnowledgeReadView | null>;
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
        ownedCreateTargetPath?: string | null;
        ownedCreateTargetContentHash?: string | null;
    }): Promise<ProposalTransitionDecision>;
}
export interface ToolInvocationContext extends ToolContext {
    knowledgeReadViewPromise?: Promise<KnowledgeReadView>;
    invocationId?: string;
    requestId?: string;
    principalId?: string;
    credentialCapabilities?: readonly string[];
    integrationId?: string;
    credentialId?: string;
    authMode?: 'oauth' | 'bearer';
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
    integrationId?: string;
    credentialId?: string;
    authMode?: 'oauth' | 'bearer';
    agentId: string;
    sessionId?: string;
    clientName: string | null;
    clientVersion: string | null;
    observedClientType: ObservedClientType;
    transport: string;
    runtimeVersion: string;
}
interface ToolCallAuditEventInput {
    invocationId?: string;
    requestId?: string;
    toolName: string;
    resultStatus: 'success' | 'failed';
    targetPaths: string[];
    durationMs: number;
    riskLevel: string;
    agentId: string;
    principalId?: string;
    integrationId?: string;
    credentialId?: string;
    authMode?: 'oauth' | 'bearer';
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
export declare function appendConnectionAuditEvent(vaultRoot: string, input: ConnectionAuditEventInput): {
    path: string;
};
export declare function appendRuntimeDiagnosticAuditEvent(vaultRoot: string, reason: 'auth_missing' | 'auth_invalid' | 'query_token_rejected'): {
    path: string;
};
export declare function recordToolCallAuditEvent(vaultRoot: string, input: ToolCallAuditEventInput): {
    path: string;
};
export declare function recordRejectedToolCallAuditEvent(context: ToolInvocationContext, reason: 'tool_call_invalid_params' | 'tool_call_invalid_name' | 'tool_call_invalid_arguments' | 'tool_call_unknown'): Promise<void>;
export declare function toolDefinitions(capabilities?: readonly string[]): McpToolDefinition[];
export declare function toolPrompts(): McpPrompt[];
export declare function callTool(name: string, rawParams: unknown, context?: ToolInvocationContext): Promise<McpStructuredToolResult>;
export type { OperationRecoveryReport };
export declare function recoverPendingOperations(vaultRoot: string, context?: ToolInvocationContext): Promise<OperationRecoveryReport>;
