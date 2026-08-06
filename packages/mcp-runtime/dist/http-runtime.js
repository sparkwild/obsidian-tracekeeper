"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamableHttpMcpRuntime = exports.DEFAULT_MCP_PORT = void 0;
const node_buffer_1 = require("node:buffer");
const node_http_1 = require("node:http");
const crypto = __importStar(require("node:crypto"));
const node_url_1 = require("node:url");
const tools_1 = require("./tools");
const handler_1 = require("./handler");
const local_oauth_1 = require("./local-oauth");
const DEFAULT_HOST = '127.0.0.1';
/** MCP 服务的共享默认监听端口。 */
exports.DEFAULT_MCP_PORT = 51601;
const DEFAULT_PATH = '/mcp';
const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 32;
const DEFAULT_MAX_STREAMS_PER_SESSION = 2;
const DEFAULT_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;
const DEFAULT_AUTHORIZATION_CODE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_AUTHORIZATION_CODE_CAPACITY = 32;
const DEFAULT_CLIENT_REGISTRATION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CLIENT_REGISTRATION_CAPACITY = 32;
class StreamableHttpMcpRuntime {
    constructor(options) {
        this.server = null;
        this.stopPromise = null;
        this.sessions = new Map();
        this.state = 'stopped';
        this.startedAt = '';
        this.lastError = '';
        this.recoveryStatus = null;
        if (options.localTrust !== true) {
            throw new Error('MCP Runtime requires explicit localTrust: true.');
        }
        if (!options.credentialVerifier || typeof options.credentialVerifier.verifyBearer !== 'function') {
            throw new Error('MCP Runtime requires an explicit per-Agent credentialVerifier.');
        }
        if (!options.writebackConfirmationSecret || (typeof options.writebackConfirmationSecret !== 'string' && !(options.writebackConfirmationSecret instanceof Uint8Array))) {
            throw new Error('MCP Runtime requires an explicit writebackConfirmationSecret.');
        }
        this.host = options.host || DEFAULT_HOST;
        if (this.host !== DEFAULT_HOST) {
            throw new Error(`MCP Runtime local trust requires host ${DEFAULT_HOST}.`);
        }
        this.port = options.port ?? exports.DEFAULT_MCP_PORT;
        this.path = options.path || DEFAULT_PATH;
        this.credentialVerifier = options.credentialVerifier;
        this.maxRequestBytes = normalizePositiveLimit(options.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES, 'maxRequestBytes');
        this.maxSessions = normalizePositiveLimit(options.maxSessions, DEFAULT_MAX_SESSIONS, 'maxSessions');
        this.maxStreamsPerSession = normalizePositiveLimit(options.maxStreamsPerSession, DEFAULT_MAX_STREAMS_PER_SESSION, 'maxStreamsPerSession');
        this.sessionIdleTtlMs = normalizePositiveLimit(options.sessionIdleTtlMs, DEFAULT_SESSION_IDLE_TTL_MS, 'sessionIdleTtlMs');
        this.requestTimeoutMs = normalizePositiveLimit(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs');
        this.oauthServer = options.oauthIntegration
            ? new local_oauth_1.LocalOAuthAuthorizationServer({
                oauthIntegration: options.oauthIntegration,
                getBoundOAuthClients: options.getBoundOAuthClients,
                getOAuthUiLocale: options.getOAuthUiLocale,
                getOrigin: () => this.runtimeOrigin(),
                getResource: () => `${this.runtimeOrigin()}${this.path}`,
                maxRequestBytes: this.maxRequestBytes,
                requestTimeoutMs: this.requestTimeoutMs,
                authorizationCodeTtlMs: normalizePositiveLimit(options.authorizationCodeTtlMs, DEFAULT_AUTHORIZATION_CODE_TTL_MS, 'authorizationCodeTtlMs'),
                authorizationCodeCapacity: normalizePositiveLimit(options.authorizationCodeCapacity, DEFAULT_AUTHORIZATION_CODE_CAPACITY, 'authorizationCodeCapacity'),
                clientRegistrationTtlMs: normalizePositiveLimit(options.clientRegistrationTtlMs, DEFAULT_CLIENT_REGISTRATION_TTL_MS, 'clientRegistrationTtlMs'),
                clientRegistrationCapacity: normalizePositiveLimit(options.clientRegistrationCapacity, DEFAULT_CLIENT_REGISTRATION_CAPACITY, 'clientRegistrationCapacity'),
            })
            : null;
        this.runtimeVersion = options.runtimeVersion || handler_1.MCP_SERVER_VERSION;
        this.defaultVaultRoot = options.defaultVaultRoot;
        this.recoveryContext = {
            vaultConfigDir: options.vaultConfigDir,
            vaultRepository: options.vaultRepository,
            proposalTransitionPort: options.proposalTransitionPort,
            knowledgeSnapshotProvider: options.knowledgeSnapshotProvider,
            graphProfile: options.graphProfile,
            memoryRules: options.memoryRules,
            contentLanguage: options.contentLanguage,
            contentLanguageSource: options.contentLanguageSource,
            writebackConfirmationSecret: options.writebackConfirmationSecret,
            runtimeVersion: this.runtimeVersion,
            principalId: tools_1.LOCAL_TRUST_PRINCIPAL_ID,
            credentialCapabilities: tools_1.LOCAL_TRUST_CAPABILITIES,
        };
        this.handler = new handler_1.McpJsonRpcHandler({
            defaultVaultRoot: options.defaultVaultRoot,
            vaultConfigDir: options.vaultConfigDir,
            vaultRepository: options.vaultRepository,
            proposalTransitionPort: options.proposalTransitionPort,
            knowledgeSnapshotProvider: options.knowledgeSnapshotProvider,
            graphProfile: options.graphProfile,
            memoryRules: options.memoryRules,
            contentLanguage: options.contentLanguage,
            contentLanguageSource: options.contentLanguageSource,
            writebackConfirmationSecret: options.writebackConfirmationSecret,
            runtimeVersion: this.runtimeVersion,
            transport: handler_1.STREAMABLE_HTTP_TRANSPORT,
        });
    }
    closeSessionsForIntegration(integrationId) {
        let closed = 0;
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.integrationId !== integrationId)
                continue;
            this.closeSession(session);
            this.sessions.delete(sessionId);
            closed += 1;
        }
        return closed;
    }
    getSessionSnapshot() {
        return [...this.sessions.values()].map((session) => ({
            sessionId: session.sessionId,
            integrationId: session.integrationId,
            credentialId: session.credentialId,
            authMode: session.authMode,
            createdAt: session.createdAt,
            lastSeenAt: session.lastSeenAt,
        }));
    }
    async start() {
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
                const recovery = await (0, tools_1.recoverPendingOperations)(this.defaultVaultRoot, this.recoveryContext);
                this.recoveryStatus = {
                    recovered: recovery.recovered.length,
                    failed: recovery.failed.length,
                    skipped: recovery.skipped.length,
                    completedAt: new Date().toISOString(),
                };
                if (recovery.failed.length > 0 || recovery.skipped.length > 0) {
                    this.lastError = `Operation recovery requires attention: ${recovery.failed.length} failed, ${recovery.skipped.length} skipped.`;
                }
            }
            catch (error) {
                this.lastError = `Operation recovery failed: ${error instanceof Error ? error.message : String(error)}`;
            }
        }
        this.server = (0, node_http_1.createServer)((request, response) => {
            void this.handleRequest(request, response).catch((error) => {
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
            server.once('error', (error) => {
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
    stop() {
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
    async stopServer() {
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
        await new Promise((resolve) => {
            server.close(() => resolve());
        });
        this.state = 'stopped';
        this.startedAt = '';
    }
    getStatus() {
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
    async handleRequest(request, response) {
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
        if (url.searchParams.has('token')
            || url.searchParams.has('ticket')
            || url.searchParams.has('pairing_code')) {
            if (url.searchParams.has('token')) {
                this.recordRequestRejection('query_token_rejected');
            }
            this.writeJson(response, 400, this.errorResponse(null, -32000, 'Legacy MCP credentials are not supported. Credentials are not accepted in URLs. Reconnect through the client native MCP OAuth flow.'), request);
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
        const credentialResult = await this.authenticateRequest(request);
        if (credentialResult === 'missing' || credentialResult === 'invalid') {
            this.recordRequestRejection(credentialResult === 'missing' ? 'auth_missing' : 'auth_invalid');
            if (this.oauthServer) {
                response.setHeader('WWW-Authenticate', `Bearer resource_metadata="${this.oauthServer.protectedResourceMetadataUrl()}", scope="mcp"`);
            }
            this.writeJson(response, 401, this.errorResponse(null, -32001, 'Unauthorized MCP request.'), request);
            return;
        }
        if (request.method === 'POST') {
            if (!this.hasJsonContentType(request)) {
                this.writeJson(response, 415, this.errorResponse(null, -32015, 'Content-Type must be application/json.'), request);
                return;
            }
            await this.handlePost(request, response, credentialResult);
            return;
        }
        if (request.method === 'GET') {
            this.handleGet(request, response, credentialResult);
            return;
        }
        if (request.method === 'DELETE') {
            this.handleDelete(request, response, credentialResult);
            return;
        }
        this.writeJson(response, 405, this.errorResponse(null, -32005, 'Method not allowed.'), request);
    }
    async handlePost(request, response, credential) {
        let body = '';
        try {
            body = await this.readBody(request);
        }
        catch (error) {
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
        let message;
        try {
            message = JSON.parse(body || '{}');
        }
        catch (error) {
            this.writeJson(response, 400, this.errorResponse(null, -32700, toErrorMessage(error, 'Invalid JSON.')), request);
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
            ? this.createSession(credential)
            : this.requireSession(request, response, credential);
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
    handleGet(request, response, credential) {
        const session = this.requireSession(request, response, credential);
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
    handleDelete(request, response, credential) {
        const session = this.requireSession(request, response, credential);
        if (!session) {
            return;
        }
        this.closeSession(session);
        this.sessions.delete(session.sessionId);
        this.writeCors(response, 204, request);
        response.end();
    }
    createSession(credential) {
        const sessionId = crypto.randomUUID();
        const session = {
            sessionId,
            principalId: tools_1.LOCAL_TRUST_PRINCIPAL_ID,
            credentialCapabilities: credential.capabilities,
            integrationId: credential.integrationId,
            credentialId: credential.credentialId,
            authMode: credential.authMode,
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
    requireSession(request, response, credential) {
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
        if (session.integrationId !== credential.integrationId
            || session.credentialId !== credential.credentialId
            || session.authMode !== credential.authMode) {
            this.writeJson(response, 401, this.errorResponse(null, -32001, 'MCP credential does not match the Session.'), request);
            return null;
        }
        const requestedProtocolVersion = this.firstHeaderValue(request.headers['mcp-protocol-version']);
        if (session.protocolVersion && !requestedProtocolVersion) {
            this.writeJson(response, 400, this.errorResponse(null, -32000, 'Missing Mcp-Protocol-Version header.'), request);
            return null;
        }
        if (requestedProtocolVersion
            && session.protocolVersion
            && requestedProtocolVersion !== session.protocolVersion) {
            this.writeJson(response, 400, this.errorResponse(null, -32000, 'Mcp-Protocol-Version does not match the initialized session.'), request);
            return null;
        }
        return session;
    }
    closeSession(session) {
        for (const stream of session.streams) {
            stream.end();
        }
        session.streams.clear();
    }
    parseRequestUrl(request) {
        if (!request.url) {
            return null;
        }
        try {
            return new node_url_1.URL(request.url, this.runtimeOrigin());
        }
        catch {
            return null;
        }
    }
    hasJsonContentType(request) {
        const contentType = this.firstHeaderValue(request.headers['content-type']).toLowerCase();
        return contentType.split(';', 1)[0].trim() === 'application/json';
    }
    readMethod(message) {
        if (!isRecordLike(message)) {
            return '';
        }
        return typeof message.method === 'string' ? message.method : '';
    }
    async readBody(request) {
        const declaredLength = Number.parseInt(this.firstHeaderValue(request.headers['content-length']), 10);
        if (Number.isFinite(declaredLength) && declaredLength > this.maxRequestBytes) {
            throw new RequestBodyTooLargeError(this.maxRequestBytes);
        }
        let timeout;
        const timeoutPromise = new Promise((_resolve, reject) => {
            timeout = setTimeout(() => reject(new RequestBodyTimeoutError(this.requestTimeoutMs)), this.requestTimeoutMs);
        });
        try {
            return await Promise.race([this.consumeRequestBody(request), timeoutPromise]);
        }
        catch (error) {
            if (error instanceof RequestBodyTimeoutError) {
                request.resume();
            }
            throw error;
        }
        finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }
    async consumeRequestBody(request) {
        const chunks = [];
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
        return node_buffer_1.Buffer.concat(chunks, totalBytes).toString('utf8');
    }
    isAllowedOrigin(request) {
        const origin = this.firstHeaderValue(request.headers.origin);
        return !origin || this.allowedCorsOrigin(request) !== null;
    }
    isAllowedHost(request) {
        return this.firstHeaderValue(request.headers.host) === `${this.host}:${this.port}`;
    }
    allowedCorsOrigin(request) {
        const origin = this.firstHeaderValue(request.headers.origin);
        if (!origin) {
            return null;
        }
        if (origin === 'app://obsidian.md') {
            return origin;
        }
        try {
            const parsed = new node_url_1.URL(origin);
            if (parsed.origin !== origin
                || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
                || !isLoopbackHostname(parsed.hostname)) {
                return null;
            }
            return origin;
        }
        catch {
            return null;
        }
    }
    async authenticateRequest(request) {
        const authorization = this.firstHeaderValue(request.headers.authorization);
        if (!authorization) {
            return 'missing';
        }
        const match = /^Bearer ([^\s]+)$/iu.exec(authorization);
        if (!match) {
            return 'invalid';
        }
        try {
            const context = await this.credentialVerifier.verifyBearer(match[1]);
            return context || 'invalid';
        }
        catch {
            return 'invalid';
        }
    }
    recordRequestRejection(reason) {
        if (!this.defaultVaultRoot) {
            return;
        }
        try {
            (0, tools_1.appendRuntimeDiagnosticAuditEvent)(this.defaultVaultRoot, reason);
        }
        catch {
            // Best-effort diagnostics must not change HTTP rejection behavior.
        }
    }
    pruneExpiredSessions() {
        const expiredBefore = Date.now() - this.sessionIdleTtlMs;
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.streams.size === 0 && session.lastSeenAt < expiredBefore) {
                this.closeSession(session);
                this.sessions.delete(sessionId);
            }
        }
    }
    firstHeaderValue(value) {
        return Array.isArray(value) ? value[0] || '' : value || '';
    }
    writeJson(response, status, payload, request) {
        this.writeCors(response, status, request);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(payload));
    }
    writePlain(response, status, text, request) {
        this.writeCors(response, status, request);
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end(text);
    }
    writeCors(response, status, request) {
        response.statusCode = status;
        const origin = request ? this.allowedCorsOrigin(request) : null;
        if (origin) {
            response.setHeader('Access-Control-Allow-Origin', origin);
            response.setHeader('Vary', 'Origin');
        }
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version');
        response.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    }
    runtimeOrigin() {
        return `http://${this.host}:${this.port}`;
    }
    errorResponse(id, code, message, data) {
        const error = { code, message };
        if (data !== undefined) {
            error.data = data;
        }
        return { jsonrpc: '2.0', id, error };
    }
}
exports.StreamableHttpMcpRuntime = StreamableHttpMcpRuntime;
function toBodyChunkBuffer(chunk) {
    if (typeof chunk === 'string') {
        return node_buffer_1.Buffer.from(chunk, 'utf8');
    }
    if (ArrayBuffer.isView(chunk)) {
        return node_buffer_1.Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }
    if (chunk instanceof ArrayBuffer) {
        return node_buffer_1.Buffer.from(chunk);
    }
    return node_buffer_1.Buffer.alloc(0);
}
function toErrorMessage(error, fallback) {
    return error instanceof Error ? error.message || fallback : fallback;
}
function isLoopbackHostname(hostname) {
    const normalized = hostname.toLowerCase();
    return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '[::1]';
}
function isAddressInfo(address) {
    return (typeof address === 'object'
        && address !== null
        && 'port' in address
        && typeof address.port === 'number');
}
function isRecordLike(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
class RequestBodyTooLargeError extends Error {
    constructor(limit) {
        super(`MCP request body exceeds the ${limit} byte limit.`);
        this.name = 'RequestBodyTooLargeError';
    }
}
class RequestBodyTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`MCP request body was not received within ${timeoutMs} ms.`);
        this.name = 'RequestBodyTimeoutError';
    }
}
function normalizePositiveLimit(value, fallback, name) {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved <= 0) {
        throw new Error(`${name} must be a positive safe integer.`);
    }
    return resolved;
}
