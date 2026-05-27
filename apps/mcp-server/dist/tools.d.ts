import { type McpPrompt, type McpStructuredToolResult, type McpToolDefinition } from './protocol';
interface ToolContext {
    defaultVaultRoot?: string;
    vaultConfigDir?: string;
    graphProfile?: unknown;
}
export interface ToolInvocationContext extends ToolContext {
    agentId?: string;
    sessionId?: string;
    clientName?: string | null;
    transport?: string;
    runtimeVersion?: string;
}
interface ConnectionAuditEventInput {
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
    sessionId?: string;
    clientName: string | null;
    transport?: string;
    runtimeVersion?: string;
    argsSummary: string;
}
export declare function appendConnectionAuditEvent(vaultRoot: string, input: ConnectionAuditEventInput): {
    path: string;
};
export declare function recordToolCallAuditEvent(vaultRoot: string, input: ToolCallAuditEventInput): {
    path: string;
};
export declare function toolDefinitions(): McpToolDefinition[];
export declare function toolPrompts(): McpPrompt[];
export declare function callTool(name: string, rawParams: unknown, context?: ToolInvocationContext): McpStructuredToolResult;
export {};
