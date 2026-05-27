import { type JsonRpcResponse } from './protocol';
export declare const MCP_PROTOCOL_VERSION = "2025-06-18";
export declare const MCP_SERVER_VERSION = "0.1.6";
export declare const STREAMABLE_HTTP_TRANSPORT = "streamable-http";
export interface McpConnectionState {
    sessionId: string;
    agentId: string;
    clientName: string | null;
    initialized: boolean;
}
export interface McpJsonRpcHandlerOptions {
    defaultVaultRoot?: string;
    vaultConfigDir?: string;
    graphProfile?: unknown;
    runtimeVersion?: string;
    transport?: string;
}
export declare class McpJsonRpcHandler {
    private defaultVaultRoot?;
    private vaultConfigDir?;
    private graphProfile?;
    private runtimeVersion;
    private transport;
    constructor(options?: McpJsonRpcHandlerOptions);
    handleMessage(rawMessage: unknown, state: McpConnectionState): JsonRpcResponse | null;
    private readRequestId;
    private dispatch;
    private handleToolsCall;
    private captureConnection;
    private extractAgentIdFromInitialize;
    private extractClientNameFromInitialize;
    private errorResponse;
}
