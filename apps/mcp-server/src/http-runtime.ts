import { Buffer } from 'node:buffer';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as crypto from 'node:crypto';
import { URL } from 'node:url';
import type { JsonRpcResponse } from './protocol';
import {
	McpConnectionState,
	McpJsonRpcHandler,
	MCP_SERVER_VERSION,
	STREAMABLE_HTTP_TRANSPORT,
} from './handler';

export type RuntimeState = 'stopped' | 'starting' | 'running' | 'failed' | 'port_conflict';

export interface StreamableHttpRuntimeOptions {
	host?: string;
	port?: number;
	path?: string;
	token?: string;
	allowMissingTokenForDev?: boolean;
	defaultVaultRoot?: string;
	vaultConfigDir?: string;
	graphProfile?: unknown;
	runtimeVersion?: string;
}

export interface StreamableHttpRuntimeStatus {
	state: RuntimeState;
	host: string;
	port: number;
	path: string;
	endpoint: string;
	startedAt: string;
	activeSessions: number;
	lastError: string;
}

interface RuntimeSession extends McpConnectionState {
	createdAt: number;
	lastSeenAt: number;
	streams: Set<ServerResponse>;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PATH = '/mcp';

export class StreamableHttpMcpRuntime {
	private host: string;
	private port: number;
	private path: string;
	private token: string;
	private allowMissingTokenForDev: boolean;
	private runtimeVersion: string;
	private handler: McpJsonRpcHandler;
	private server: HttpServer | null = null;
	private sessions = new Map<string, RuntimeSession>();
	private state: RuntimeState = 'stopped';
	private startedAt = '';
	private lastError = '';

	constructor(options: StreamableHttpRuntimeOptions = {}) {
		this.host = options.host || DEFAULT_HOST;
		this.port = options.port ?? 58437;
		this.path = options.path || DEFAULT_PATH;
		this.token = (options.token || '').trim();
		this.allowMissingTokenForDev = options.allowMissingTokenForDev === true;
		if (!this.token && !this.allowMissingTokenForDev) {
			throw new Error('MCP Runtime token is required. Pass a generated token or explicitly enable allowMissingTokenForDev for local development only.');
		}
		this.runtimeVersion = options.runtimeVersion || MCP_SERVER_VERSION;
		this.handler = new McpJsonRpcHandler({
			defaultVaultRoot: options.defaultVaultRoot,
			vaultConfigDir: options.vaultConfigDir,
			graphProfile: options.graphProfile,
			runtimeVersion: this.runtimeVersion,
			transport: STREAMABLE_HTTP_TRANSPORT,
		});
	}

	async start(): Promise<StreamableHttpRuntimeStatus> {
		if (this.server && this.state === 'running') {
			return this.getStatus();
		}
		this.state = 'starting';
		this.lastError = '';
		this.server = createServer((request, response) => {
			void this.handleRequest(request, response);
		});

		return new Promise((resolve, reject) => {
			const server = this.server;
			if (!server) {
				const error = new Error('Runtime server was not created.');
				this.state = 'failed';
				this.lastError = error.message;
				reject(error);
				return;
			}
			server.once('error', (error: NodeJS.ErrnoException) => {
				this.state = error.code === 'EADDRINUSE' ? 'port_conflict' : 'failed';
				this.lastError = error.message;
				this.server = null;
				reject(error);
			});
			server.listen(this.port, this.host, () => {
				const address = server.address();
				if (isAddressInfo(address)) {
					this.port = address.port;
				}
				this.state = 'running';
				this.startedAt = new Date().toISOString();
				resolve(this.getStatus());
			});
		});
	}

	async stop(): Promise<void> {
		for (const session of this.sessions.values()) {
			this.closeSession(session);
		}
		this.sessions.clear();
		const server = this.server;
		this.server = null;
		if (!server) {
			this.state = 'stopped';
			this.startedAt = '';
			return;
		}

		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});
		this.state = 'stopped';
		this.startedAt = '';
	}

	getStatus(): StreamableHttpRuntimeStatus {
		return {
			state: this.state,
			host: this.host,
			port: this.port,
			path: this.path,
			endpoint: `http://${this.host}:${this.port}${this.path}`,
			startedAt: this.startedAt,
			activeSessions: this.sessions.size,
			lastError: this.lastError,
		};
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const url = this.parseRequestUrl(request);
		if (!url || url.pathname !== this.path) {
			this.writePlain(response, 404, 'Not found.', request);
			return;
		}

		if (!this.isAllowedOrigin(request)) {
			this.writeJson(response, 403, this.errorResponse(null, -32003, 'Forbidden origin.'), request);
			return;
		}

		if (!this.hasValidToken(request, url)) {
			this.writeJson(response, 401, this.errorResponse(null, -32001, 'Invalid MCP runtime token.'), request);
			return;
		}

		if (request.method === 'OPTIONS') {
			this.writeCors(response, 204, request);
			response.end();
			return;
		}
		if (request.method === 'POST') {
			await this.handlePost(request, response);
			return;
		}
		if (request.method === 'GET') {
			this.handleGet(request, response);
			return;
		}
		if (request.method === 'DELETE') {
			this.handleDelete(request, response);
			return;
		}

		this.writeJson(response, 405, this.errorResponse(null, -32005, 'Method not allowed.'), request);
	}

	private async handlePost(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const body = await this.readBody(request);
		let message: unknown;
		try {
			message = JSON.parse(body || '{}');
		} catch (error) {
			const messageText = toErrorMessage(error, 'Invalid JSON.');
			this.writeJson(response, 400, this.errorResponse(null, -32700, messageText), request);
			return;
		}

		if (Array.isArray(message)) {
			this.writeJson(response, 400, this.errorResponse(null, -32600, 'Batch requests are not supported by this Runtime.'), request);
			return;
		}

		const method = this.readMethod(message);
		const isInitialize = method === 'initialize';
		const session = isInitialize
			? this.createSession()
			: this.requireSession(request, response);
		if (!session) {
			return;
		}

		session.lastSeenAt = Date.now();
		const result = this.handler.handleMessage(message, session);
		if (isInitialize) {
			response.setHeader('Mcp-Session-Id', session.sessionId);
		}
		if (!result) {
			this.writeCors(response, 202, request);
			response.end();
			return;
		}
		this.writeJson(response, 200, result, request);
	}

	private handleGet(request: IncomingMessage, response: ServerResponse): void {
		const session = this.requireSession(request, response);
		if (!session) {
			return;
		}
		session.lastSeenAt = Date.now();
		this.writeCors(response, 200, request);
		response.setHeader('Content-Type', 'text/event-stream');
		response.setHeader('Cache-Control', 'no-cache, no-transform');
		response.setHeader('Connection', 'keep-alive');
		response.write(': connected\n\n');
		session.streams.add(response);
		request.on('close', () => {
			session.streams.delete(response);
		});
	}

	private handleDelete(request: IncomingMessage, response: ServerResponse): void {
		const session = this.requireSession(request, response);
		if (!session) {
			return;
		}
		this.closeSession(session);
		this.sessions.delete(session.sessionId);
		this.writeCors(response, 204, request);
		response.end();
	}

	private createSession(): RuntimeSession {
		const sessionId = crypto.randomUUID();
		const session: RuntimeSession = {
			sessionId,
			agentId: sessionId,
			clientName: null,
			initialized: false,
			createdAt: Date.now(),
			lastSeenAt: Date.now(),
			streams: new Set(),
		};
		this.sessions.set(sessionId, session);
		return session;
	}

	private requireSession(request: IncomingMessage, response: ServerResponse): RuntimeSession | null {
		const sessionId = this.firstHeaderValue(request.headers['mcp-session-id']);
		if (!sessionId) {
			this.writeJson(response, 400, this.errorResponse(null, -32000, 'Missing Mcp-Session-Id header.'), request);
			return null;
		}
		const session = this.sessions.get(sessionId);
		if (!session) {
			this.writeJson(response, 404, this.errorResponse(null, -32004, 'Unknown MCP session.'), request);
			return null;
		}
		return session;
	}

	private closeSession(session: RuntimeSession): void {
		for (const stream of session.streams) {
			stream.end();
		}
		session.streams.clear();
	}

	private parseRequestUrl(request: IncomingMessage): URL | null {
		if (!request.url) {
			return null;
		}
		try {
			return new URL(request.url, `http://${this.host}:${this.port}`);
		} catch {
			return null;
		}
	}

	private readMethod(message: unknown): string {
		if (!isRecordLike(message)) {
			return '';
		}
		const methodValue = message.method;
		return typeof methodValue === 'string' ? methodValue : '';
	}

	private async readBody(request: IncomingMessage): Promise<string> {
		const chunks: string[] = [];
		for await (const chunk of request) {
			const text = toBodyChunkText(chunk);
			if (text) {
				chunks.push(text);
			}
		}
		return chunks.join('');
	}

	private isAllowedOrigin(request: IncomingMessage): boolean {
		const origin = this.firstHeaderValue(request.headers.origin);
		return !origin || this.allowedCorsOrigin(request) !== null;
	}

	private allowedCorsOrigin(request: IncomingMessage): string | null {
		const origin = this.firstHeaderValue(request.headers.origin);
		if (!origin) {
			return null;
		}
		if (origin === 'app://obsidian.md') {
			return origin;
		}
		try {
			const parsed = new URL(origin);
			return LOOPBACK_HOSTS.has(parsed.hostname) ? origin : null;
		} catch {
			return null;
		}
	}

	private hasValidToken(request: IncomingMessage, url: URL): boolean {
		if (!this.token) {
			return this.allowMissingTokenForDev;
		}
		const queryToken = url.searchParams.get('token');
		if (queryToken === this.token) {
			return true;
		}
		const authorization = this.firstHeaderValue(request.headers.authorization);
		return authorization === `Bearer ${this.token}`;
	}

	private firstHeaderValue(value: string | string[] | undefined): string {
		if (Array.isArray(value)) {
			return value[0] || '';
		}
		return value || '';
	}

	private writeJson(response: ServerResponse, status: number, payload: JsonRpcResponse, request?: IncomingMessage): void {
		this.writeCors(response, status, request);
		response.setHeader('Content-Type', 'application/json');
		response.end(JSON.stringify(payload));
	}

	private writePlain(response: ServerResponse, status: number, text: string, request?: IncomingMessage): void {
		this.writeCors(response, status, request);
		response.setHeader('Content-Type', 'text/plain; charset=utf-8');
		response.end(text);
	}

	private writeCors(response: ServerResponse, status: number, request?: IncomingMessage): void {
		response.statusCode = status;
		const origin = request ? this.allowedCorsOrigin(request) : null;
		if (origin) {
			response.setHeader('Access-Control-Allow-Origin', origin);
			response.setHeader('Vary', 'Origin');
		}
		response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id');
		response.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
		response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
	}

	private errorResponse(id: number | string | null, code: number, message: string, data?: unknown): JsonRpcResponse {
		const error: JsonRpcResponse['error'] = { code, message };
		if (data !== undefined) {
			error.data = data;
		}
		return { jsonrpc: '2.0', id, error };
	}
}

function toBodyChunkText(chunk: unknown): string {
	if (typeof chunk === 'string') {
		return chunk;
	}
	if (ArrayBuffer.isView(chunk)) {
		return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('utf8');
	}
	if (chunk instanceof ArrayBuffer) {
		return Buffer.from(chunk).toString('utf8');
	}
	return '';
}

function toErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error) {
		return error.message || fallback;
	}
	return fallback;
}

function isAddressInfo(address: ReturnType<HttpServer['address']>): address is AddressInfo {
	return (
		typeof address === 'object' &&
		address !== null &&
		'port' in address &&
		typeof address.port === 'number'
	);
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
