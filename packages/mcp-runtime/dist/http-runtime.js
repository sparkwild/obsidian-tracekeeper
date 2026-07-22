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
exports.StreamableHttpMcpRuntime = void 0;
const node_buffer_1 = require("node:buffer");
const node_http_1 = require("node:http");
const crypto = __importStar(require("node:crypto"));
const node_url_1 = require("node:url");
const tools_1 = require("./tools");
const handler_1 = require("./handler");
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PATH = '/mcp';
const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 32;
const DEFAULT_MAX_STREAMS_PER_SESSION = 2;
const DEFAULT_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;
class StreamableHttpMcpRuntime {
    constructor(options = {}) {
        this.server = null;
        this.sessions = new Map();
        this.state = 'stopped';
        this.startedAt = '';
        this.lastError = '';
        this.recoveryStatus = null;
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
        this.runtimeVersion = options.runtimeVersion || handler_1.MCP_SERVER_VERSION;
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
        this.handler = new handler_1.McpJsonRpcHandler({
            defaultVaultRoot: options.defaultVaultRoot,
            vaultConfigDir: options.vaultConfigDir,
            vaultRepository: options.vaultRepository,
            knowledgeSnapshotProvider: options.knowledgeSnapshotProvider,
            graphProfile: options.graphProfile,
            memoryRules: options.memoryRules,
            contentLanguage: options.contentLanguage,
            contentLanguageSource: options.contentLanguageSource,
            runtimeVersion: this.runtimeVersion,
            transport: handler_1.STREAMABLE_HTTP_TRANSPORT,
        });
    }
    async start() {
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
    async stop() {
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
    async handleRequest(request, response) {
        this.pruneExpiredSessions();
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
    async handlePost(request, response, principal) {
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
    handleGet(request, response, principal) {
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
    handleDelete(request, response, principal) {
        const session = this.requireSession(request, response, principal);
        if (!session) {
            return;
        }
        this.closeSession(session);
        this.sessions.delete(session.sessionId);
        this.writeCors(response, 204, request);
        response.end();
    }
    createSession(principal) {
        const sessionId = crypto.randomUUID();
        const session = {
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
    requireSession(request, response, principal) {
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
            return new node_url_1.URL(request.url, `http://${this.host}:${this.port}`);
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
        const methodValue = message.method;
        return typeof methodValue === 'string' ? methodValue : '';
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
            return LOOPBACK_HOSTS.has(parsed.hostname) ? origin : null;
        }
        catch {
            return null;
        }
    }
    authenticate(request, url) {
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
        if (Array.isArray(value)) {
            return value[0] || '';
        }
        return value || '';
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
    if (error instanceof Error) {
        return error.message || fallback;
    }
    return fallback;
}
function isAddressInfo(address) {
    return (typeof address === 'object' &&
        address !== null &&
        'port' in address &&
        typeof address.port === 'number');
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
function normalizeCredentials(configured, legacyToken) {
    const credentials = [];
    const ids = new Set();
    const tokens = new Set();
    const addCredential = (credential) => {
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
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest();
}
function safeTokenEqualsHash(presentedToken, expectedHash) {
    return crypto.timingSafeEqual(hashToken(presentedToken), expectedHash);
}
