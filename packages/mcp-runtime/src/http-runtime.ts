import { Buffer } from 'node:buffer';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as crypto from 'node:crypto';
import { URL } from 'node:url';
import type { VaultRepository } from '@tracekeeper/core';
import type { JsonRpcResponse } from './protocol';
import {
	LOCAL_TRUST_CAPABILITIES,
	LOCAL_TRUST_PRINCIPAL_ID,
	appendRuntimeDiagnosticAuditEvent,
	recoverPendingOperations,
	type ToolInvocationContext,
} from './tools';
import {
	McpConnectionState,
	McpJsonRpcHandler,
	MCP_SERVER_VERSION,
	STREAMABLE_HTTP_TRANSPORT,
} from './handler';
import {
	LocalOAuthAuthorizationServer,
	type PairingTicket,
	type PairingTicketStatus,
} from './local-oauth';

export type { PairingTicket, PairingTicketState, PairingTicketStatus } from './local-oauth';

export type RuntimeState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' | 'port_conflict';

export interface StreamableHttpRuntimeOptions {
	localTrust?: boolean;
	serviceToken: string;
	getSharedBearerToken?: () => string | Promise<string>;
	host?: string;
	port?: number;
	path?: string;
	pairingTicketTtlMs?: number;
	pairingTicketCapacity?: number;
	pairingTicketMaxAttempts?: number;
	authorizationCodeTtlMs?: number;
	authorizationCodeCapacity?: number;
	clientRegistrationTtlMs?: number;
	clientRegistrationCapacity?: number;
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

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PATH = '/mcp';
const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 32;
const DEFAULT_MAX_STREAMS_PER_SESSION = 2;
const DEFAULT_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;
const DEFAULT_PAIRING_TICKET_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PAIRING_TICKET_CAPACITY = 3;
const DEFAULT_PAIRING_TICKET_MAX_ATTEMPTS = 5;
const DEFAULT_AUTHORIZATION_CODE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_AUTHORIZATION_CODE_CAPACITY = 32;
const DEFAULT_CLIENT_REGISTRATION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CLIENT_REGISTRATION_CAPACITY = 32;
const MIN_SERVICE_TOKEN_BYTES = 32;

export class StreamableHttpMcpRuntime {
	private host: string;
	private port: number;
	private path: string;
	private serviceTokenHash: Buffer;
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
	private oauthServer: LocalOAuthAuthorizationServer | null;
	private state: RuntimeState = 'stopped';
	private startedAt = '';
	private lastError = '';
	private recoveryStatus: RuntimeRecoveryStatus | null = null;

	constructor(options: StreamableHttpRuntimeOptions) {
		if (options.localTrust !== true) {
			throw new Error('MCP Runtime requires explicit localTrust: true.');
		}
		this.host = options.host || DEFAULT_HOST;
		if (this.host !== DEFAULT_HOST) {
			throw new Error(`MCP Runtime local trust requires host ${DEFAULT_HOST}.`);
		}
		this.port = options.port ?? 58437;
		this.path = options.path || DEFAULT_PATH;
		this.serviceTokenHash = hashServiceToken(options.serviceToken);
		this.maxRequestBytes = normalizePositiveLimit(
			options.maxRequestBytes,
			DEFAULT_MAX_REQUEST_BYTES,
			'maxRequestBytes'
		);
		this.maxSessions = normalizePositiveLimit(
			options.maxSessions,
			DEFAULT_MAX_SESSIONS,
			'maxSessions'
		);
		this.maxStreamsPerSession = normalizePositiveLimit(
			options.maxStreamsPerSession,
			DEFAULT_MAX_STREAMS_PER_SESSION,
			'maxStreamsPerSession'
		);
		this.sessionIdleTtlMs = normalizePositiveLimit(
			options.sessionIdleTtlMs,
			DEFAULT_SESSION_IDLE_TTL_MS,
			'sessionIdleTtlMs'
		);
		this.requestTimeoutMs = normalizePositiveLimit(
			options.requestTimeoutMs,
			DEFAULT_REQUEST_TIMEOUT_MS,
			'requestTimeoutMs'
		);
		this.oauthServer = options.getSharedBearerToken
			? new LocalOAuthAuthorizationServer({
				serviceTokenHash: this.serviceTokenHash,
				getSharedBearerToken: options.getSharedBearerToken,
				getOrigin: () => this.runtimeOrigin(),
				getResource: () => `${this.runtimeOrigin()}${this.path}`,
				maxRequestBytes: this.maxRequestBytes,
				requestTimeoutMs: this.requestTimeoutMs,
				pairingTicketTtlMs: normalizePositiveLimit(
					options.pairingTicketTtlMs,
					DEFAULT_PAIRING_TICKET_TTL_MS,
					'pairingTicketTtlMs'
				),
				pairingTicketCapacity: normalizePositiveLimit(
					options.pairingTicketCapacity,
					DEFAULT_PAIRING_TICKET_CAPACITY,
					'pairingTicketCapacity'
				),
				pairingTicketMaxAttempts: normalizePositiveLimit(
					options.pairingTicketMaxAttempts,
					DEFAULT_PAIRING_TICKET_MAX_ATTEMPTS,
					'pairingTicketMaxAttempts'
				),
				authorizationCodeTtlMs: normalizePositiveLimit(
					options.authorizationCodeTtlMs,
					DEFAULT_AUTHORIZATION_CODE_TTL_MS,
					'authorizationCodeTtlMs'
				),
				authorizationCodeCapacity: normalizePositiveLimit(
					options.authorizationCodeCapacity,
					DEFAULT_AUTHORIZATION_CODE_CAPACITY,
					'authorizationCodeCapacity'
				),
				clientRegistrationTtlMs: normalizePositiveLimit(
					options.clientRegistrationTtlMs,
					DEFAULT_CLIENT_REGISTRATION_TTL_MS,
					'clientRegistrationTtlMs'
				),
				clientRegistrationCapacity: normalizePositiveLimit(
					options.clientRegistrationCapacity,
					DEFAULT_CLIENT_REGISTRATION_CAPACITY,
					'clientRegistrationCapacity'
				),
			})
			: null;
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
			principalId: LOCAL_TRUST_PRINCIPAL_ID,
			credentialCapabilities: LOCAL_TRUST_CAPABILITIES,
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

	/**
	 * Issues a one-time local pairing code for the Agent selected in Obsidian.
	 */
	issuePairingTicket(expectedClientId: string): PairingTicket {
		if (this.state !== 'running' || !this.oauthServer) {
			throw new Error('OAuth pairing is unavailable until the runtime is running with a token callback.');
		}
		return this.oauthServer.issuePairingTicket(expectedClientId);
	}

	getPairingTicketStatus(id: string): PairingTicketStatus | null {
		return this.oauthServer?.getPairingTicketStatus(id) || null;
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
				const recovery = await recoverPendingOperations(
					this.defaultVaultRoot,
					this.recoveryContext
				);
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
					this.writeJson(
						response,
						500,
						this.errorResponse(null, -32603, 'Internal MCP runtime error.'),
						request
					);
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
			this.sessions.clear();
			this.oauthServer?.clear();
			this.startedAt = '';
			return;
		}
		this.state = 'stopping';
		for (const session of this.sessions.values()) {
			this.closeSession(session);
		}
		this.sessions.clear();
		this.oauthServer?.clear();
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
			endpoint: `${this.runtimeOrigin()}${this.path}`,
			startedAt: this.startedAt,
			activeSessions: this.sessions.size,
			lastError: this.lastError,
			maxSessions: this.maxSessions,
			maxRequestBytes: this.maxRequestBytes,
			sessionIdleTtlMs: this.sessionIdleTtlMs,
			maxStreamsPerSession: this.maxStreamsPerSession,
			requestTimeoutMs: this.requestTimeoutMs,
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
		if (!url) {
			this.writePlain(response, 400, 'Invalid request URL.', request);
			return;
		}
		if (
			url.searchParams.has('token')
			|| url.searchParams.has('ticket')
			|| url.searchParams.has('pairing_code')
		) {
			if (url.searchParams.has('token')) {
				this.recordRequestRejection('query_token_rejected');
			}
			this.writeJson(
				response,
				400,
				this.errorResponse(
					null,
					-32000,
					'Legacy MCP credentials are not supported. Credentials are not accepted in URLs. Reconnect through the client native MCP OAuth flow.'
				),
				request
			);
			return;
		}
		if (this.oauthServer?.handlesPath(url.pathname)) {
			await this.oauthServer.handle(request, response, url);
			return;
		}
		if (url.pathname !== this.path) {
			this.writePlain(response, 404, 'Not found.', request);
			return;
		}
		if (!this.isAllowedOrigin(request)) {
			this.writeJson(response, 403, this.errorResponse(null, -32003, 'Forbidden origin.'), request);
			return;
		}
		if (request.method === 'OPTIONS') {
			this.writeCors(response, 204, request);
			response.end();
			return;
		}
		const bearerStatus = this.serviceBearerStatus(request);
		if (bearerStatus !== 'valid') {
			this.recordRequestRejection(bearerStatus === 'missing' ? 'auth_missing' : 'auth_invalid');
			if (this.oauthServer) {
				response.setHeader(
					'WWW-Authenticate',
					`Bearer resource_metadata="${this.oauthServer.protectedResourceMetadataUrl()}", scope="mcp"`
				);
			}
			this.writeJson(
				response,
				401,
				this.errorResponse(null, -32001, 'Unauthorized MCP request.'),
				request
			);
			return;
		}
		if (request.method === 'POST') {
			if (!this.hasJsonContentType(request)) {
				this.writeJson(
					response,
					415,
					this.errorResponse(null, -32015, 'Content-Type must be application/json.'),
					request
				);
				return;
			}
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
		this.writeJson(
			response,
			405,
			this.errorResponse(null, -32005, 'Method not allowed.'),
			request
		);
	}

	private async handlePost(
		request: IncomingMessage,
		response: ServerResponse
	): Promise<void> {
		let body = '';
		try {
			body = await this.readBody(request);
		} catch (error: unknown) {
			if (error instanceof RequestBodyTooLargeError) {
				this.writeJson(
					response,
					413,
					this.errorResponse(null, -32013, error.message),
					request
				);
				return;
			}
			if (error instanceof RequestBodyTimeoutError) {
				this.writeJson(
					response,
					408,
					this.errorResponse(null, -32008, error.message),
					request
				);
				return;
			}
			throw error;
		}
		let message: unknown;
		try {
			message = JSON.parse(body || '{}');
		} catch (error) {
			this.writeJson(
				response,
				400,
				this.errorResponse(null, -32700, toErrorMessage(error, 'Invalid JSON.')),
				request
			);
			return;
		}
		if (Array.isArray(message)) {
			this.writeJson(
				response,
				400,
				this.errorResponse(null, -32600, 'Batch requests are not supported by this Runtime.'),
				request
			);
			return;
		}
		const method = this.readMethod(message);
		const isInitialize = method === 'initialize';
		if (isInitialize && this.sessions.size >= this.maxSessions) {
			this.writeJson(
				response,
				429,
				this.errorResponse(null, -32029, 'MCP session limit reached.'),
				request
			);
			return;
		}
		const session = isInitialize
			? this.createSession()
			: this.requireSession(request, response);
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

	private handleGet(request: IncomingMessage, response: ServerResponse): void {
		const session = this.requireSession(request, response);
		if (!session) {
			return;
		}
		if (session.streams.size >= this.maxStreamsPerSession) {
			this.writeJson(
				response,
				429,
				this.errorResponse(null, -32029, 'MCP stream limit reached for this session.'),
				request
			);
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
			principalId: LOCAL_TRUST_PRINCIPAL_ID,
			credentialCapabilities: LOCAL_TRUST_CAPABILITIES,
			agentId: sessionId,
			clientName: null,
			clientVersion: null,
			observedClientType: 'unknown',
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
		response: ServerResponse
	): RuntimeSession | null {
		const sessionId = this.firstHeaderValue(request.headers['mcp-session-id']);
		if (!sessionId) {
			this.writeJson(
				response,
				400,
				this.errorResponse(null, -32000, 'Missing Mcp-Session-Id header.'),
				request
			);
			return null;
		}
		const session = this.sessions.get(sessionId);
		if (!session) {
			this.writeJson(
				response,
				404,
				this.errorResponse(null, -32004, 'Unknown MCP session.'),
				request
			);
			return null;
		}
		const requestedProtocolVersion = this.firstHeaderValue(
			request.headers['mcp-protocol-version']
		);
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
				this.errorResponse(
					null,
					-32000,
					'Mcp-Protocol-Version does not match the initialized session.'
				),
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
			return new URL(request.url, this.runtimeOrigin());
		} catch {
			return null;
		}
	}

	private hasJsonContentType(request: IncomingMessage): boolean {
		const contentType = this.firstHeaderValue(
			request.headers['content-type']
		).toLowerCase();
		return contentType.split(';', 1)[0].trim() === 'application/json';
	}

	private readMethod(message: unknown): string {
		if (!isRecordLike(message)) {
			return '';
		}
		return typeof message.method === 'string' ? message.method : '';
	}

	private async readBody(request: IncomingMessage): Promise<string> {
		const declaredLength = Number.parseInt(
			this.firstHeaderValue(request.headers['content-length']),
			10
		);
		if (Number.isFinite(declaredLength) && declaredLength > this.maxRequestBytes) {
			throw new RequestBodyTooLargeError(this.maxRequestBytes);
		}
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(
				() => reject(new RequestBodyTimeoutError(this.requestTimeoutMs)),
				this.requestTimeoutMs
			);
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
		return this.firstHeaderValue(request.headers.host) === `${this.host}:${this.port}`;
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
			if (
				parsed.origin !== origin
				|| (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
				|| !isLoopbackHostname(parsed.hostname)
			) {
				return null;
			}
			return origin;
		} catch {
			return null;
		}
	}

	private serviceBearerStatus(request: IncomingMessage): 'valid' | 'missing' | 'invalid' {
		const authorization = this.firstHeaderValue(request.headers.authorization);
		if (!authorization) {
			return 'missing';
		}
		const match = /^Bearer ([^\s]+)$/iu.exec(authorization);
		if (!match) {
			return 'invalid';
		}
		const presentedHash = crypto.createHash('sha256').update(match[1], 'utf8').digest();
		return crypto.timingSafeEqual(presentedHash, this.serviceTokenHash)
			? 'valid'
			: 'invalid';
	}

	private recordRequestRejection(
		reason: 'auth_missing' | 'auth_invalid' | 'query_token_rejected'
	): void {
		if (!this.defaultVaultRoot) {
			return;
		}
		try {
			appendRuntimeDiagnosticAuditEvent(this.defaultVaultRoot, reason);
		} catch {
			// Best-effort diagnostics must not change HTTP rejection behavior.
		}
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
		return Array.isArray(value) ? value[0] || '' : value || '';
	}

	private writeJson(
		response: ServerResponse,
		status: number,
		payload: JsonRpcResponse,
		request?: IncomingMessage
	): void {
		this.writeCors(response, status, request);
		response.setHeader('Content-Type', 'application/json');
		response.end(JSON.stringify(payload));
	}

	private writePlain(
		response: ServerResponse,
		status: number,
		text: string,
		request?: IncomingMessage
	): void {
		this.writeCors(response, status, request);
		response.setHeader('Content-Type', 'text/plain; charset=utf-8');
		response.end(text);
	}

	private writeCors(
		response: ServerResponse,
		status: number,
		request?: IncomingMessage
	): void {
		response.statusCode = status;
		const origin = request ? this.allowedCorsOrigin(request) : null;
		if (origin) {
			response.setHeader('Access-Control-Allow-Origin', origin);
			response.setHeader('Vary', 'Origin');
		}
		response.setHeader(
			'Access-Control-Allow-Headers',
			'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version'
		);
		response.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
		response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
	}

	private runtimeOrigin(): string {
		return `http://${this.host}:${this.port}`;
	}

	private errorResponse(
		id: number | string | null,
		code: number,
		message: string,
		data?: unknown
	): JsonRpcResponse {
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
	return error instanceof Error ? error.message || fallback : fallback;
}

function isLoopbackHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '[::1]';
}

function isAddressInfo(address: ReturnType<HttpServer['address']>): address is AddressInfo {
	return (
		typeof address === 'object'
		&& address !== null
		&& 'port' in address
		&& typeof address.port === 'number'
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

function normalizePositiveLimit(
	value: number | undefined,
	fallback: number,
	name: string
): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved <= 0) {
		throw new Error(`${name} must be a positive safe integer.`);
	}
	return resolved;
}

function hashServiceToken(serviceToken: string): Buffer {
	if (
		typeof serviceToken !== 'string'
		|| Buffer.byteLength(serviceToken, 'utf8') < MIN_SERVICE_TOKEN_BYTES
		|| /\s/u.test(serviceToken)
	) {
		throw new Error(
			`serviceToken must contain at least ${MIN_SERVICE_TOKEN_BYTES} non-whitespace UTF-8 bytes.`
		);
	}
	return crypto.createHash('sha256').update(serviceToken, 'utf8').digest();
}
