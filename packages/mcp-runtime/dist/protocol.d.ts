export type JsonRpcId = string | number | null;
export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: JsonRpcId;
    method: string;
    params?: unknown;
}
export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: JsonRpcId;
    result?: unknown;
    error?: JsonRpcErrorObject;
}
export interface JsonRpcErrorObject {
    code: number;
    message: string;
    data?: unknown;
}
export interface RpcErrorOptions {
    code: number;
    message: string;
    data?: unknown;
}
export declare class RpcError extends Error {
    readonly code: number;
    readonly data?: unknown;
    constructor({ code, message, data }: RpcErrorOptions);
}
export interface McpJsonSchema {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
    readonly [key: string]: unknown;
}
export type McpToolSchema = McpJsonSchema;
export interface McpToolAnnotations {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
}
export interface McpToolDefinition {
    name: string;
    title: string;
    description: string;
    inputSchema: McpToolSchema;
    outputSchema?: McpJsonSchema;
    annotations?: McpToolAnnotations;
}
export interface McpResource {
    uri: string;
    name: string;
    title: string;
    description: string;
    mimeType?: string;
}
export interface McpPrompt {
    name: string;
    title: string;
    description: string;
    arguments?: McpPromptArgument[];
}
export interface McpPromptArgument {
    name: string;
    description?: string;
    required?: boolean;
}
export interface McpPromptMessage {
    role: 'user' | 'assistant';
    content: {
        type: 'text';
        text: string;
    };
}
export interface McpGetPromptResult {
    name: string;
    description: string;
    messages: McpPromptMessage[];
}
export interface McpStructuredToolResult {
    content: {
        type: 'text';
        text: string;
    }[];
    structuredContent?: unknown;
    isError?: boolean;
}
export declare function isRecord(value: unknown): value is Record<string, unknown>;
