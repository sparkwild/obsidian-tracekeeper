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

export class RpcError extends Error {
	readonly code: number;
	readonly data?: unknown;

	constructor({ code, message, data }: RpcErrorOptions) {
		super(message);
		this.name = 'RpcError';
		this.code = code;
		this.data = data;
	}
}

export interface McpToolSchema {
	type: 'object';
	properties: Record<string, unknown>;
	required?: string[];
	additionalProperties?: boolean;
}

export interface McpToolAnnotations {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
}

export interface McpToolDefinition {
	name: string;
	title: string;
	description: string;
	inputSchema: McpToolSchema;
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
}

export interface McpStructuredToolResult {
	content: {
		type: 'text';
		text: string;
	}[];
	structuredContent?: unknown;
	isError?: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
