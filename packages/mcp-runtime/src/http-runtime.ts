import { Buffer } from 'node:buffer';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as crypto from 'node:crypto';
import { URL } from 'node:url';
import type { ToolCapability } from '@tracekeeper/contracts';
import type { VaultRepository } from '@tracekeeper/core';
import type { JsonRpcResponse } from './protocol';
import { recoverPendingOperations, type ToolInvocationContext } from './tools';
import {
	McpConnectionState,
	McpJsonRpcHandler,
	MCP_SERVER_VERSION,
	STREAMABLE_HTTP_TRANSPORT,
} from './handler';

export type RuntimeState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' | 'port_conflict';

export interface RuntimeCredential {
	id: string;
	token: string;
	capabilities?: readonly (ToolCapability | '*')[];
}

export interface StreamableHttpRuntimeOptions {
	host?: string;
	port?: number;
	path?: string;
	token?: string;
	credentials?: readonly RuntimeCredential[];
	allowMissingTokenForDev?: boolean;
	maxRequestBytes?: number;
	maxSessions?: number;
	maxStreamsPerSession?: number;
	sessionIdleTtlMs?: number;
	requestTimeoutMs?: number;
	defaultVaultRoot?: string;
	vaultConfigDir?: string;
	vaultRepository?: VaultRepository;
	knowledgeSnapshotProvider?: NonNullable<ConstructorParameters<typeof McpJsonRpcHandler>[0]>['knowledgeSnapshotProvider'];
	graphProfile?: unknown;
	memoryRules?: NonNullable<ConstructorParameters<typeof McpJsonRpcHandler>[0]>['memoryRules'];
	contentLanguage?: unknown;
	contentLanguageSource?: unknown;
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
	maxSessions: number;
	maxRequestBytes: number;
	sessionIdleTtlMs: number;
	maxStreamsPerSession: number;
	requestTimeoutMs: number;
	credentialCount: number;
	recovery: RuntimeRecoveryStatus | null;
}

export interface RuntimeRecoveryStatus {
	recovered: number;
	failed: number;
	skipped: number;
	completedAt: string;
}

interface RuntimeSession extends McpConnectionState {
	createdAt: number;
	lastSeenAt: number;
	streams: Set<ServerResponse>;
}

interface AuthenticatedPrincipal {
	id: string;
	capabilities: readonly string[];
}

interface StoredCredential extends AuthenticatedPrincipal {
	tokenHash: Buffer;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PATH = '/mcp';
const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 32;
const DEFAULT_MAX_STREAMS_PER_SESSION = 2;
const DEFAULT_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;

export class StreamableHttpMcpRuntime {
	private host: string;
	private port: number;
	private path: string;
	private credentials: StoredCredential[];
	private allowMissingTokenForDev: boolean;
	private maxRequestBytes: number;
	private maxSessions: number;
	private maxStreamsPerSession: number;
	private sessionIdleTtlMs: number;
	private requestTimeoutMs: number;
	private runtimeVersion: string;
	private defaultVaultRoot?: string;
	private recoveryContext: ToolInvocationContext;
	private handler: McpJsonRpcHandler;
	private server: HttpServer | null = null;
	private stopPromise: Promise<void> | null = null;
	private sessions = new Map<string, RuntimeSession>();
	private state: RuntimeState = 'stopped';
	private startedAt = '';
	private lastError = '';
	private recoveryStatus: RuntimeRecoveryStatus | null = null;

	constructor(options: StreamableHttpRuntimeOptions = {}) {
		this.host = options.host || DEFAULT_HOST;
		this.port = options.port ?? 58437;
		this.path = options.path || DEFAULT_PATH;
		this.allowMissingTokenForDev = options.allowMissingTokenForDev === true;
		this.credentials = normalizeCredentials(options.credentials, options.token);
		if (this.credentials.length === 0 && !this.allowMissingTokenForDev) {
			throw new Error('MCP Runtime token is required. Pass a generated token or explicitly enable allowMissingTokenForDev for local development only.');
		}
		this.maxRequestBytes = normalizePositiveLimit(options.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES, 'maxRequestBytes');
		this.maxSessions = normalizePositiveLimit(options.maxSessions, DEFAULT_MAX_SESSIONS, 'maxSessions');
		this.maxStreamsPerSession = normalizePositiveLimit(options.maxStreamsPerSession, DEFAULT_MAX_STREAMS_PER_SESSION, 'maxStreamsPerSession');
		this.sessionIdleTtlMs = normalizePositiveLimit(options.sessionIdleTtlMs, DEFAULT_SESSION_IDLE_TTL_MS, 'sessionIdleTtlMs');
		this.requestTimeoutMs = normalizePositiveLimit(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs');
		this.runtimeVersion = options.runtimeVersion || MCP_SERVER_VERSION;
		this.defaultVaultRoot = options.defaultVaultRoot;
		this.recoveryContext = {
			vaultConfigDir: options.vaultConfigDir,
			vaultRepository: options.vaultRepository,
			knowledgeSnapshotProvider: options.knowledgeSnapshotProvider,
			graphProfile: options.graphProfile,
			memoryRules: options.memoryRules,
			contentLanguage: options.contentLanguage,
			contentLanguageSource: options.contentLanguageSource,
			runtimeVersion: this.runtimeVersion,
		};
		this.handler = new McpJsonRpcHandler({
			defaultVaultRoot: options.defaultVaultRoot,
			vaultConfigDir: options.vaultConfigDir,
			vaultRepository: options.vaultRepository,
			knowledgeSnapshotProvider: options.knowledgeSnapshotProvider,
			graphProfile: options.graphProfile,
			memoryRules: options.memoryRules,
			contentLanguage: options.contentLanguage,
			contentLanguageSource: options.contentLanguageSource,
			runtimeVersion: this.runtimeVersion,
			transport: STREAMABLE_HTTP_TRANSPORT,
		});
	}

	async start(): Promise<StreamableHttpRuntimeStatus> {
		if (this.stopPromise) {
			await this.stopPromise;
		}
		if (this.server && this.state === 'running') {
			return this.getStatus();
		}
		this.state = 'starting';
		this.lastError = '';
		this.recoveryStatus = null;
		if (this.defaultVaultRoot) {
			try {
				const recovery = await recoverPendingOperations(this.defaultVaultRoot, this.recoveryContext);
				this.recoveryStatus = {
					recovered: recovery.recovered.length,
					failed: recovery.failed.length,
					skipped: recovery.skipped.length,
					completedAt: new Date().toISOString(),
				};
				if (recovery.failed.length > 0 || recovery.skipped.length > 0) {
					this.lastError = `Operation recovery requires attention: ${recovery.failed.length} failed, ${recovery.skipped.length} skipped.`;
				}
			} catch (error) {
				this.lastError = `Operation recovery failed: ${error instanceof Error ? error.message : String(error)}`;
			}
		}
		this.server = createServer((request, response) => {
			void this.handleRequest(request, response).catch((error: unknown) => {
				this.lastError = toErrorMessage(error, 'Unhandled MCP HTTP request failure.');
				if (!response.writableEnded && !response.destroyed) {
					this.writeJson(response, 500, this.errorResponse(null, -32603, 'Internal MCP runtime error.'), request);
				}
			});
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

	stop(): Promise<void> {
		if (this.stopPromise) {
			return this.stopPromise;
		}
		const stopPromise = this.stopServer();
		this.stopPromise = stopPromise;
		return stopPromise.finally(() => {
			if (this.stopPromise === stopPromise) {
				this.stopPromise = null;
			}
		});
	}

	private async stopServer(): Promise<void> {
		const server = this.server;
		if (!server) {
			this.state = 'stopped';
			this.startedAt = '';
			return;
		}
		this.state = 'stopping';
		for (const session of this.sessions.values()) {
			this.closeSession(session);
		}
		this.sessions.clear();
		this.server = null;

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
			maxSessions: this.maxSessions,
			maxRequestBytes: this.maxRequestBytes,
			sessionIdleTtlMs: this.sessionIdleTtlMs,
			maxStreamsPerSession: this.maxStreamsPerSession,
			requestTimeoutMs: this.requestTimeoutMs,
			credentialCount: this.credentials.length,
			recovery: this.recoveryStatus ? { ...this.recoveryStatus } : null,
		};
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		this.pruneExpiredSessions();
		if (!this.isAllowedHost(request)) {
			this.writeJson(response, 403, this.errorResponse(null, -32003, 'Forbidden host.'), request);
			return;
		}
		const url = this.parseRequestUrl(request);
		if (!url || url.pathname !== this.path) {
			this.writePlain(response, 404, 'Not found.', request);
			return;
		}

		if (!this.isAllowedOrigin(request)) {
			this.writeJson(response, 403, this.errorResponse(null, -32003, 'Forbidden origin.'), request);
			return;
		}

		const principal = this.authenticate(request, url);
		if (!principal) {
			this.writeJson(response, 401, this.errorResponse(null, -32001, 'Invalid MCP runtime token.'), request);
			return;
		}

		if (request.method === 'OPTIONS') {
			this.writeCors(response, 204, request);
			response.end();
			return;
		}
		if (request.method === 'POST') {
			if (!this.hasJsonContentType(request)) {
				this.writeJson(response, 415, this.errorResponse(null, -32015, 'Content-Type must be application/json.'), request);
				return;
			}
			await this.handlePost(request, response, principal);
			return;
		}
		if (request.method === 'GET') {
			this.handleGet(request, response, principal);
			return;
		}
		if (request.method === 'DELETE') {
			this.handleDelete(request, response, principal);
			return;
		}

		this.writeJson(response, 405, this.errorResponse(null, -32005, 'Method not allowed.'), request);
	}

	private async handlePost(
		request: IncomingMessage,
		response: ServerResponse,
		principal: AuthenticatedPrincipal
	): Promise<void> {
		let body = '';
		try {
			body = await this.readBody(request);
		} catch (error: unknown) {
			if (error instanceof RequestBodyTooLargeError) {
				this.writeJson(response, 413, this.errorResponse(null, -32013, error.message), request);
				return;
			}
			if (error instanceof RequestBodyTimeoutError) {
				this.writeJson(response, 408, this.errorResponse(null, -32008, error.message), request);
				return;
			}
			throw error;
		}
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
		if (isInitialize && this.sessions.size >= this.maxSessions) {
			this.writeJson(response, 429, this.errorResponse(null, -32029, 'MCP session limit reached.'), request);
			return;
		}
		const session = isInitialize
			? this.createSession(principal)
			: this.requireSession(request, response, principal);
		if (!session) {
			return;
		}

		session.lastSeenAt = Date.now();
		const result = await this.handler.handleMessage(message, session);
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

	private handleGet(request: IncomingMessage, response: ServerResponse, principal: AuthenticatedPrincipal): void {
		const session = this.requireSession(request, response, principal);
		if (!session) {
			return;
		}
		if (session.streams.size >= this.maxStreamsPerSession) {
			this.writeJson(response, 429, this.errorResponse(null, -32029, 'MCP stream limit reached for this session.'), request);
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

	private handleDelete(request: IncomingMessage, response: ServerResponse, principal: AuthenticatedPrincipal): void {
		const session = this.requireSession(request, response, principal);
		if (!session) {
			return;
		}
		this.closeSession(session);
		this.sessions.delete(session.sessionId);
		this.writeCors(response, 204, request);
		response.end();
	}

	private createSession(principal: AuthenticatedPrincipal): RuntimeSession {
		const sessionId = crypto.randomUUID();
		const session: RuntimeSession = {
			sessionId,
			principalId: principal.id,
			credentialCapabilities: principal.capabilities,
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

	private requireSession(
		request: IncomingMessage,
		response: ServerResponse,
		principal: AuthenticatedPrincipal
	): RuntimeSession | null {
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
		if (session.principalId !== principal.id) {
			this.writeJson(response, 403, this.errorResponse(null, -32003, 'MCP session belongs to another credential principal.'), request);
			return null;
		}
		const requestedProtocolVersion = this.firstHeaderValue(request.headers['mcp-protocol-version']);
		if (session.protocolVersion && !requestedProtocolVersion) {
			this.writeJson(
				response,
				400,
				this.errorResponse(null, -32000, 'Missing Mcp-Protocol-Version header.'),
				request
			);
			return null;
		}
		if (
			requestedProtocolVersion
			&& session.protocolVersion
			&& requestedProtocolVersion !== session.protocolVersion
		) {
			this.writeJson(
				response,
				400,
				this.errorResponse(null, -32000, 'Mcp-Protocol-Version does not match the initialized session.'),
				request
			);
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

	private hasJsonContentType(request: IncomingMessage): boolean {
		const contentType = this.firstHeaderValue(request.headers['content-type']).toLowerCase();
		return contentType.split(';', 1)[0].trim() === 'application/json';
	}

	private readMethod(message: unknown): string {
		if (!isRecordLike(message)) {
			return '';
		}
		const methodValue = message.method;
		return typeof methodValue === 'string' ? methodValue : '';
	}

	private async readBody(request: IncomingMessage): Promise<string> {
		const declaredLength = Number.parseInt(this.firstHeaderValue(request.headers['content-length']), 10);
		if (Number.isFinite(declaredLength) && declaredLength > this.maxRequestBytes) {
			throw new RequestBodyTooLargeError(this.maxRequestBytes);
		}
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(() => reject(new RequestBodyTimeoutError(this.requestTimeoutMs)), this.requestTimeoutMs);
		});
		try {
			return await Promise.race([this.consumeRequestBody(request), timeoutPromise]);
		} catch (error: unknown) {
			if (error instanceof RequestBodyTimeoutError) {
				request.resume();
			}
			throw error;
		} finally {
			if (timeout) {
				clearTimeout(timeout);
			}
		}
	}

	private async consumeRequestBody(request: IncomingMessage): Promise<string> {
		const chunks: Buffer[] = [];
		let totalBytes = 0;
		for await (const chunk of request) {
			const bytes = toBodyChunkBuffer(chunk);
			if (bytes.length === 0) {
				continue;
			}
			totalBytes += bytes.length;
			if (totalBytes > this.maxRequestBytes) {
				throw new RequestBodyTooLargeError(this.maxRequestBytes);
			}
			chunks.push(bytes);
		}
		return Buffer.concat(chunks, totalBytes).toString('utf8');
	}

	private isAllowedOrigin(request: IncomingMessage): boolean {
		const origin = this.firstHeaderValue(request.headers.origin);
		return !origin || this.allowedCorsOrigin(request) !== null;
	}

	private isAllowedHost(request: IncomingMessage): boolean {
		const requestHost = requestHostname(this.firstHeaderValue(request.headers.host));
		const boundHost = normalizeHostname(this.host);
		if (!requestHost || !boundHost) {
			return false;
		}
		if (isLoopbackHostname(boundHost)) {
			return isLoopbackHostname(requestHost);
		}
		return requestHost === boundHost;
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

	private authenticate(request: IncomingMessage, url: URL): AuthenticatedPrincipal | null {
		const queryToken = url.searchParams.get('token') || '';
		const authorization = this.firstHeaderValue(request.headers.authorization);
		const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
		const presentedToken = queryToken || bearerToken;
		for (const credential of this.credentials) {
			if (safeTokenEqualsHash(presentedToken, credential.tokenHash)) {
				return { id: credential.id, capabilities: credential.capabilities };
			}
		}
		if (this.credentials.length === 0 && this.allowMissingTokenForDev) {
			return { id: 'development-no-token', capabilities: ['*'] };
		}
		return null;
	}

	private pruneExpiredSessions(): void {
		const expiredBefore = Date.now() - this.sessionIdleTtlMs;
		for (const [sessionId, session] of this.sessions.entries()) {
			if (session.streams.size === 0 && session.lastSeenAt < expiredBefore) {
				this.closeSession(session);
				this.sessions.delete(sessionId);
			}
		}
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
		response.setHeader(
			'Access-Control-Allow-Headers',
			'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
		);
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

function toBodyChunkBuffer(chunk: unknown): Buffer {
	if (typeof chunk === 'string') {
		return Buffer.from(chunk, 'utf8');
	}
	if (ArrayBuffer.isView(chunk)) {
		return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
	}
	if (chunk instanceof ArrayBuffer) {
		return Buffer.from(chunk);
	}
	return Buffer.alloc(0);
}

function toErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error) {
		return error.message || fallback;
	}
	return fallback;
}

function requestHostname(authority: string): string {
	if (!authority || /[,\s/\\]/u.test(authority)) {
		return '';
	}
	try {
		const parsed = new URL(`http://${authority}`);
		if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
			return '';
		}
		return normalizeHostname(parsed.hostname);
	} catch {
		return '';
	}
}

function normalizeHostname(hostname: string): string {
	const normalized = hostname.trim().toLowerCase();
	if (normalized.startsWith('[') && normalized.endsWith(']')) {
		return normalized.slice(1, -1);
	}
	return normalized;
}

function isLoopbackHostname(hostname: string): boolean {
	return LOOPBACK_HOSTS.has(hostname) || LOOPBACK_HOSTS.has(`[${hostname}]`);
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

class RequestBodyTooLargeError extends Error {
	constructor(limit: number) {
		super(`MCP request body exceeds the ${limit} byte limit.`);
		this.name = 'RequestBodyTooLargeError';
	}
}

class RequestBodyTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`MCP request body was not received within ${timeoutMs} ms.`);
		this.name = 'RequestBodyTimeoutError';
	}
}

function normalizePositiveLimit(value: number | undefined, fallback: number, name: string): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved <= 0) {
		throw new Error(`${name} must be a positive safe integer.`);
	}
	return resolved;
}

function normalizeCredentials(
	configured: readonly RuntimeCredential[] | undefined,
	legacyToken: string | undefined
): StoredCredential[] {
	const credentials: StoredCredential[] = [];
	const ids = new Set<string>();
	const tokens = new Set<string>();
	const addCredential = (credential: RuntimeCredential): void => {
		const id = credential.id.trim();
		const token = credential.token.trim();
		if (!id || !token) {
			throw new Error('Runtime credentials require non-empty id and token values.');
		}
		if (ids.has(id)) {
			throw new Error(`Duplicate runtime credential id: ${id}`);
		}
		if (tokens.has(token)) {
			throw new Error(`Duplicate runtime credential token for principal: ${id}`);
		}
		ids.add(id);
		tokens.add(token);
		credentials.push({
			id,
			tokenHash: hashToken(token),
			capabilities: [...new Set(credential.capabilities?.length ? credential.capabilities : ['*'])],
		});
	};

	for (const credential of configured || []) {
		addCredential(credential);
	}
	const normalizedLegacyToken = (legacyToken || '').trim();
	if (normalizedLegacyToken && !tokens.has(normalizedLegacyToken)) {
		addCredential({ id: 'legacy-shared-token', token: normalizedLegacyToken, capabilities: ['*'] });
	}
	return credentials;
}

function hashToken(token: string): Buffer {
	return crypto.createHash('sha256').update(token).digest();
}

function safeTokenEqualsHash(presentedToken: string, expectedHash: Buffer): boolean {
	return crypto.timingSafeEqual(hashToken(presentedToken), expectedHash);
}
