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
const handler_1 = require("./handler");
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PATH = '/mcp';
class StreamableHttpMcpRuntime {
    constructor(options = {}) {
        this.server = null;
        this.sessions = new Map();
        this.state = 'stopped';
        this.startedAt = '';
        this.lastError = '';
        this.host = options.host || DEFAULT_HOST;
        this.port = options.port ?? 58437;
        this.path = options.path || DEFAULT_PATH;
        this.token = (options.token || '').trim();
        this.allowMissingTokenForDev = options.allowMissingTokenForDev === true;
        if (!this.token && !this.allowMissingTokenForDev) {
            throw new Error('MCP Runtime token is required. Pass a generated token or explicitly enable allowMissingTokenForDev for local development only.');
        }
        this.runtimeVersion = options.runtimeVersion || handler_1.MCP_SERVER_VERSION;
        this.handler = new handler_1.McpJsonRpcHandler({
            defaultVaultRoot: options.defaultVaultRoot,
            vaultConfigDir: options.vaultConfigDir,
            graphProfile: options.graphProfile,
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
        this.server = (0, node_http_1.createServer)((request, response) => {
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
        };
    }
    async handleRequest(request, response) {
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
    async handlePost(request, response) {
        const body = await this.readBody(request);
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
    handleGet(request, response) {
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
    handleDelete(request, response) {
        const session = this.requireSession(request, response);
        if (!session) {
            return;
        }
        this.closeSession(session);
        this.sessions.delete(session.sessionId);
        this.writeCors(response, 204, request);
        response.end();
    }
    createSession() {
        const sessionId = crypto.randomUUID();
        const session = {
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
    requireSession(request, response) {
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
    readMethod(message) {
        if (!isRecordLike(message)) {
            return '';
        }
        const methodValue = message.method;
        return typeof methodValue === 'string' ? methodValue : '';
    }
    async readBody(request) {
        const chunks = [];
        for await (const chunk of request) {
            const text = toBodyChunkText(chunk);
            if (text) {
                chunks.push(text);
            }
        }
        return chunks.join('');
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
    hasValidToken(request, url) {
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
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id');
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
function toBodyChunkText(chunk) {
    if (typeof chunk === 'string') {
        return chunk;
    }
    if (ArrayBuffer.isView(chunk)) {
        return node_buffer_1.Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('utf8');
    }
    if (chunk instanceof ArrayBuffer) {
        return node_buffer_1.Buffer.from(chunk).toString('utf8');
    }
    return '';
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
