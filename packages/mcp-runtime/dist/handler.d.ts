import { type JsonRpcResponse } from './protocol';
import { type ToolInvocationContext } from './tools';
import type { VaultRepository } from '@tracekeeper/core';
export declare const MCP_PROTOCOL_VERSION = "2025-06-18";
export declare const MCP_SERVER_VERSION = "0.2.3";
export declare const STREAMABLE_HTTP_TRANSPORT = "streamable-http";
export interface McpConnectionState {
    sessionId: string;
    principalId: string;
    credentialCapabilities: readonly string[];
    agentId: string;
    clientName: string | null;
    initialized: boolean;
}
export interface McpJsonRpcHandlerOptions {
    defaultVaultRoot?: string;
    vaultConfigDir?: string;
    vaultRepository?: VaultRepository;
    knowledgeSnapshotProvider?: ToolInvocationContext['knowledgeSnapshotProvider'];
    graphProfile?: unknown;
    memoryRules?: ToolInvocationContext['memoryRules'];
    contentLanguage?: unknown;
    contentLanguageSource?: unknown;
    runtimeVersion?: string;
    transport?: string;
}
export declare class McpJsonRpcHandler {
    private defaultVaultRoot?;
    private vaultConfigDir?;
    private vaultRepository?;
    private knowledgeSnapshotProvider?;
    private graphProfile?;
    private memoryRules?;
    private contentLanguage?;
    private contentLanguageSource?;
    private runtimeVersion;
    private transport;
    constructor(options?: McpJsonRpcHandlerOptions);
    handleMessage(rawMessage: unknown, state: McpConnectionState): Promise<JsonRpcResponse | null>;
    private readRequestId;
    private dispatch;
    private handleToolsCall;
    private captureConnection;
    private extractAgentIdFromInitialize;
    private extractClientNameFromInitialize;
    private errorResponse;
}
