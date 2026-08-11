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
exports.LocalOAuthAuthorizationServer = void 0;
const node_buffer_1 = require("node:buffer");
const crypto = __importStar(require("node:crypto"));
const node_timers_1 = require("node:timers");
const node_url_1 = require("node:url");
const oauth_page_1 = require("./oauth-page");
const PROTECTED_RESOURCE_METADATA_ROOT_PATH = '/.well-known/oauth-protected-resource';
const AUTHORIZATION_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server';
const REGISTER_PATH = '/oauth/register';
const AUTHORIZE_PATH = '/oauth/authorize';
const WAIT_PATH = '/oauth/wait';
const TOKEN_PATH = '/oauth/token';
const REVOKE_PATH = '/oauth/revoke';
const OAUTH_SCOPE = 'mcp';
const OAUTH_BODY_LIMIT_BYTES = 16 * 1024;
const DEFAULT_PENDING_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PENDING_CAPACITY = 16;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/u;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SECURITY_HEADERS = {
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': (0, oauth_page_1.oauthContentSecurityPolicy)(),
};
/**
 * Local OAuth authorization server. Approval is an Obsidian-owned decision;
 * the browser only renders a waiting state and receives a one-time redirect.
 */
class LocalOAuthAuthorizationServer {
    constructor(options) {
        this.registeredClients = new Map();
        this.pendingRequests = new Map();
        this.authorizationCodes = new Map();
        this.oauthIntegration = options.oauthIntegration;
        this.getBoundOAuthClients = options.getBoundOAuthClients ?? (() => []);
        this.getOrigin = options.getOrigin;
        this.getResource = options.getResource;
        this.maxRequestBytes = Math.min(options.maxRequestBytes, OAUTH_BODY_LIMIT_BYTES);
        this.requestTimeoutMs = options.requestTimeoutMs;
        this.authorizationCodeTtlMs = options.authorizationCodeTtlMs;
        this.authorizationCodeCapacity = options.authorizationCodeCapacity;
        this.clientRegistrationTtlMs = options.clientRegistrationTtlMs;
        this.clientRegistrationCapacity = options.clientRegistrationCapacity;
        this.pendingRequestTtlMs = options.pendingRequestTtlMs ?? DEFAULT_PENDING_TTL_MS;
        this.pendingRequestCapacity = options.pendingRequestCapacity ?? DEFAULT_PENDING_CAPACITY;
        this.getOAuthUiLocale = options.getOAuthUiLocale ?? (() => 'zh-CN');
    }
    clear() {
        this.registeredClients.clear();
        this.pendingRequests.clear();
        this.authorizationCodes.clear();
    }
    handlesPath(pathname) {
        return pathname === AUTHORIZATION_SERVER_METADATA_PATH
            || pathname === PROTECTED_RESOURCE_METADATA_ROOT_PATH
            || pathname === this.protectedResourceMetadataPath()
            || pathname === REGISTER_PATH
            || pathname === AUTHORIZE_PATH
            || pathname === WAIT_PATH
            || pathname === TOKEN_PATH
            || pathname === REVOKE_PATH;
    }
    protectedResourceMetadataUrl() {
        return `${this.getOrigin()}${this.protectedResourceMetadataPath()}`;
    }
    async handle(request, response, url) {
        this.pruneExpiredState();
        if (request.method === 'OPTIONS') {
            if (!this.isAllowedOAuthOrigin(request)) {
                this.writeOAuthJson(response, 403, { error: 'invalid_request', error_description: 'Forbidden origin.' });
                return;
            }
            this.writeOAuthCors(response, request);
            response.statusCode = 204;
            response.end();
            return;
        }
        if (!this.isAllowedOAuthOrigin(request)) {
            this.writeOAuthJson(response, 403, { error: 'invalid_request', error_description: 'Forbidden origin.' });
            return;
        }
        if (url.pathname === AUTHORIZATION_SERVER_METADATA_PATH && request.method === 'GET') {
            this.writeOAuthJson(response, 200, this.authorizationServerMetadata(), request);
            return;
        }
        if ((url.pathname === PROTECTED_RESOURCE_METADATA_ROOT_PATH || url.pathname === this.protectedResourceMetadataPath()) && request.method === 'GET') {
            this.writeOAuthJson(response, 200, this.protectedResourceMetadata(), request);
            return;
        }
        if (url.pathname === REGISTER_PATH && request.method === 'POST') {
            await this.handleRegistration(request, response);
            return;
        }
        if (url.pathname === AUTHORIZE_PATH && request.method === 'GET') {
            await this.handleAuthorization(request, response, url);
            return;
        }
        if (url.pathname === WAIT_PATH && request.method === 'GET') {
            await this.handleWaitingPage(request, response, url);
            return;
        }
        if (url.pathname === TOKEN_PATH && request.method === 'POST') {
            await this.handleTokenExchange(request, response);
            return;
        }
        if (url.pathname === REVOKE_PATH && request.method === 'POST') {
            await this.handleRevocation(request, response);
            return;
        }
        this.writeOAuthJson(response, 405, { error: 'invalid_request', error_description: 'Method not allowed.' });
    }
    async handleRegistration(request, response) {
        if (!hasContentType(request, 'application/json')) {
            this.writeOAuthJson(response, 415, { error: 'invalid_client_metadata', error_description: 'Content-Type must be application/json.' });
            return;
        }
        const body = await this.readBodyOrRespond(request, response);
        if (body === null)
            return;
        let payload;
        try {
            payload = JSON.parse(body || '{}');
        }
        catch {
            this.writeOAuthJson(response, 400, { error: 'invalid_client_metadata', error_description: 'Invalid JSON body.' });
            return;
        }
        if (!isRecordLike(payload)) {
            this.writeOAuthJson(response, 400, { error: 'invalid_client_metadata', error_description: 'Registration body must be an object.' });
            return;
        }
        const parsed = this.validateRegistration(payload);
        if (parsed instanceof Error) {
            this.writeOAuthJson(response, 400, { error: 'invalid_client_metadata', error_description: parsed.message });
            return;
        }
        this.pruneExpiredState();
        if (this.registeredClients.size >= this.clientRegistrationCapacity) {
            this.writeOAuthJson(response, 429, { error: 'temporarily_unavailable', error_description: 'Client registration capacity reached.' });
            return;
        }
        const now = Date.now();
        const client = {
            clientId: randomOpaqueValue(18),
            clientNameClaim: parsed.clientName,
            redirectUris: parsed.redirectUris,
            integrationId: '',
            issuedAtMs: now,
            expiresAtMs: now + this.clientRegistrationTtlMs,
            bound: false,
        };
        this.registeredClients.set(client.clientId, client);
        this.writeOAuthJson(response, 201, {
            client_id: client.clientId,
            client_id_issued_at: Math.floor(now / 1000),
            client_id_expires_at: Math.floor(client.expiresAtMs / 1000),
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code'],
            response_types: ['code'],
            redirect_uris: client.redirectUris,
            client_name: client.clientNameClaim,
            scope: OAUTH_SCOPE,
        }, request);
    }
    async handleAuthorization(request, response, url) {
        const parsed = this.parseAuthorizationRequest(url.searchParams);
        if (parsed instanceof Error) {
            this.writeOAuthHtml(response, 400, this.errorPage('invalid_request'), request);
            return;
        }
        const client = this.resolveClient(parsed.clientId);
        if (!client || client.expiresAtMs <= Date.now()) {
            this.writeOAuthHtml(response, 400, this.errorPage('invalid_client'), request);
            return;
        }
        const validationError = this.validateAuthorizationRequest(parsed, client);
        if (validationError) {
            this.redirectOrError(response, request, parsed, 'invalid_request');
            return;
        }
        if (this.pendingRequests.size >= this.pendingRequestCapacity) {
            this.redirectOrError(response, request, parsed, 'temporarily_unavailable');
            return;
        }
        const now = Date.now();
        const pending = {
            requestId: randomOpaqueValue(18),
            clientId: client.clientId,
            clientNameClaim: client.clientNameClaim,
            redirectUri: parsed.redirectUri,
            resource: parsed.resource,
            scope: OAUTH_SCOPE,
            codeChallenge: parsed.codeChallenge,
            state: parsed.state,
            issuedAt: now,
            expiresAt: now + this.pendingRequestTtlMs,
        };
        this.pendingRequests.set(pending.requestId, { pending, request: parsed, client });
        try {
            await this.oauthIntegration.publishPendingRequest(pending);
        }
        catch {
            this.pendingRequests.delete(pending.requestId);
            this.redirectOrError(response, request, parsed, 'server_error');
            return;
        }
        this.applySecurityHeaders(response);
        response.statusCode = 303;
        response.setHeader('Location', `${this.getOrigin()}${WAIT_PATH}?request_id=${encodeURIComponent(pending.requestId)}`);
        response.end();
    }
    async handleWaitingPage(request, response, url) {
        const requestId = url.searchParams.get('request_id') || '';
        if (!/^[A-Za-z0-9_-]{24}$/u.test(requestId)) {
            this.writeOAuthHtml(response, 400, this.errorPage('invalid_request'), request);
            return;
        }
        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
            this.writeOAuthHtml(response, 400, this.errorPage('authorization_expired'), request);
            return;
        }
        if (pending.pending.expiresAt <= Date.now()) {
            this.pendingRequests.delete(requestId);
            this.redirectOrError(response, request, pending.request, 'access_denied');
            return;
        }
        let decision;
        try {
            decision = await this.oauthIntegration.readDecision(requestId);
        }
        catch {
            this.redirectOrError(response, request, pending.request, 'server_error');
            return;
        }
        if (!decision) {
            this.writeOAuthHtml(response, 200, (0, oauth_page_1.renderOAuthWaitingPage)(this.resolveOAuthUiLocale(), {
                clientName: pending.client.clientNameClaim,
                expiresAt: new Date(pending.pending.expiresAt).toISOString(),
                refreshUrl: `${this.getOrigin()}${WAIT_PATH}?request_id=${encodeURIComponent(requestId)}`,
            }), request);
            return;
        }
        this.pendingRequests.delete(requestId);
        if (decision.decision === 'deny') {
            this.redirectOrError(response, request, pending.request, 'access_denied');
            return;
        }
        if (!decision.integrationId || (pending.client.bound && pending.client.integrationId !== decision.integrationId)) {
            this.redirectOrError(response, request, pending.request, 'invalid_request');
            return;
        }
        const now = Date.now();
        const rawCode = randomOpaqueValue(32);
        const digest = digestSecretHex(rawCode);
        const authorizationCode = {
            digest,
            integrationId: decision.integrationId,
            credentialId: crypto.randomUUID(),
            clientId: pending.request.clientId,
            clientNameClaim: pending.client.clientNameClaim,
            redirectUris: [...pending.client.redirectUris],
            redirectUri: pending.request.redirectUri,
            codeChallenge: pending.request.codeChallenge,
            resource: pending.request.resource,
            scope: OAUTH_SCOPE,
            issuedAtMs: now,
            expiresAtMs: now + this.authorizationCodeTtlMs,
        };
        this.enforceAuthorizationCodeCapacity();
        this.authorizationCodes.set(digest, authorizationCode);
        const redirect = new node_url_1.URL(pending.request.redirectUri);
        redirect.searchParams.set('code', rawCode);
        redirect.searchParams.set('state', pending.request.state);
        redirect.searchParams.set('iss', this.getOrigin());
        this.applySecurityHeaders(response);
        response.setHeader('Content-Security-Policy', (0, oauth_page_1.oauthContentSecurityPolicy)(redirect.origin));
        response.statusCode = 303;
        response.setHeader('Location', redirect.toString());
        response.end();
    }
    async handleTokenExchange(request, response) {
        if (!hasContentType(request, 'application/x-www-form-urlencoded')) {
            this.writeOAuthJson(response, 415, { error: 'invalid_request', error_description: 'Content-Type must be application/x-www-form-urlencoded.' });
            return;
        }
        const body = await this.readBodyOrRespond(request, response);
        if (body === null)
            return;
        const form = parseUniqueForm(body);
        if (form instanceof Error || form.grant_type !== 'authorization_code') {
            this.writeOAuthJson(response, 400, { error: form instanceof Error ? 'invalid_request' : 'unsupported_grant_type', error_description: form instanceof Error ? form.message : 'grant_type must be authorization_code.' });
            return;
        }
        const rawCode = form.code || '';
        const digest = digestSecretHex(rawCode);
        const authorizationCode = this.authorizationCodes.get(digest);
        this.authorizationCodes.delete(digest);
        if (!authorizationCode || authorizationCode.expiresAtMs <= Date.now()) {
            this.writeOAuthJson(response, 400, { error: 'invalid_grant', error_description: 'Authorization code is invalid, expired, or already used.' });
            return;
        }
        const verifier = form.code_verifier || '';
        if (form.client_id !== authorizationCode.clientId || form.redirect_uri !== authorizationCode.redirectUri || form.resource !== authorizationCode.resource || !CODE_VERIFIER_PATTERN.test(verifier)) {
            this.writeOAuthJson(response, 400, { error: 'invalid_grant', error_description: 'Authorization code binding is invalid.' });
            return;
        }
        const computedChallenge = crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
        if (!timingSafeTextEqual(computedChallenge, authorizationCode.codeChallenge)) {
            this.writeOAuthJson(response, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed.' });
            return;
        }
        const accessToken = randomOpaqueValue(32);
        const exchange = {
            integrationId: authorizationCode.integrationId,
            clientId: authorizationCode.clientId,
            clientNameClaim: authorizationCode.clientNameClaim,
            redirectUris: authorizationCode.redirectUris,
            credentialId: authorizationCode.credentialId,
            accessToken,
        };
        try {
            const issued = await this.oauthIntegration.issueOAuthCredential(exchange);
            if (issued.accessToken !== accessToken || issued.integrationId !== exchange.integrationId || issued.credentialId !== exchange.credentialId) {
                throw new Error('OAuth credential binding mismatch.');
            }
            const registered = this.registeredClients.get(exchange.clientId);
            if (registered) {
                registered.integrationId = exchange.integrationId;
                registered.bound = true;
            }
            this.writeOAuthJson(response, 200, { access_token: issued.accessToken, token_type: 'Bearer', scope: OAUTH_SCOPE }, request);
        }
        catch {
            this.writeOAuthJson(response, 500, { error: 'server_error', error_description: 'OAuth credential could not be persisted.' });
        }
    }
    async handleRevocation(request, response) {
        if (!hasContentType(request, 'application/x-www-form-urlencoded')) {
            this.writeOAuthJson(response, 415, { error: 'invalid_request', error_description: 'Content-Type must be application/x-www-form-urlencoded.' });
            return;
        }
        const body = await this.readBodyOrRespond(request, response);
        if (body === null)
            return;
        const form = parseUniqueForm(body);
        if (form instanceof Error || !form.token) {
            this.writeOAuthJson(response, 400, { error: 'invalid_request', error_description: form instanceof Error ? form.message : 'token must be provided.' });
            return;
        }
        try {
            await this.oauthIntegration.revokeOAuthCredential({ token: form.token });
        }
        catch { /* RFC 7009 does not reveal token existence. */ }
        this.writeOAuthJson(response, 200, {}, request);
    }
    resolveClient(clientId) {
        const existing = this.registeredClients.get(clientId);
        if (existing && existing.expiresAtMs > Date.now())
            return existing;
        const bound = this.getBoundOAuthClients().find((candidate) => candidate.clientId === clientId);
        if (!bound)
            return null;
        const now = Date.now();
        const client = {
            ...bound,
            redirectUris: [...bound.redirectUris],
            issuedAtMs: now,
            expiresAtMs: now + this.clientRegistrationTtlMs,
            bound: true,
        };
        this.registeredClients.set(client.clientId, client);
        return client;
    }
    validateRegistration(request) {
        if (request.token_endpoint_auth_method !== undefined && request.token_endpoint_auth_method !== 'none')
            return new Error('Only public clients with token_endpoint_auth_method=none are supported.');
        if (!matchesRegistrationGrantTypes(request.grant_types))
            return new Error('grant_types must include authorization_code and may also declare refresh_token.');
        if (!matchesOptionalExactArray(request.response_types, ['code']))
            return new Error('Only the code response type is supported.');
        if (request.scope !== undefined && (typeof request.scope !== 'string' || request.scope.trim() !== OAUTH_SCOPE))
            return new Error(`Only scope=${OAUTH_SCOPE} is supported.`);
        if (!Array.isArray(request.redirect_uris) || request.redirect_uris.length === 0 || request.redirect_uris.length > 8)
            return new Error('redirect_uris must contain 1-8 loopback URLs.');
        const redirectUris = [];
        for (const value of request.redirect_uris) {
            if (typeof value !== 'string')
                return new Error('Each redirect_uri must be a string.');
            const normalized = normalizeLoopbackRedirectUri(value);
            if (!normalized)
                return new Error('Every redirect_uri must be an HTTP(S) loopback URL without credentials or a fragment.');
            if (!redirectUris.includes(normalized))
                redirectUris.push(normalized);
        }
        const rawName = typeof request.client_name === 'string' ? request.client_name.trim() : 'Local MCP client';
        const clientName = rawName.slice(0, 128) || 'Local MCP client';
        if (containsAsciiControlCharacter(clientName))
            return new Error('client_name contains control characters.');
        return { clientName, redirectUris };
    }
    parseAuthorizationRequest(params) {
        for (const required of ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource']) {
            const values = params.getAll(required);
            if (values.length !== 1 || !values[0])
                return new Error(`${required} must be provided exactly once.`);
        }
        if (params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256')
            return new Error('Only response_type=code and PKCE S256 are supported.');
        const codeChallenge = params.get('code_challenge') || '';
        if (!CODE_CHALLENGE_PATTERN.test(codeChallenge))
            return new Error('code_challenge must be an unpadded SHA-256 base64url value.');
        const scopeValues = params.getAll('scope');
        if (scopeValues.length > 1 || (scopeValues[0] && scopeValues[0] !== OAUTH_SCOPE))
            return new Error(`Only scope=${OAUTH_SCOPE} is supported.`);
        const state = params.get('state') || '';
        if (state.length > 512)
            return new Error('state is too long.');
        return { clientId: params.get('client_id') || '', redirectUri: params.get('redirect_uri') || '', state, codeChallenge, resource: params.get('resource') || '', scope: OAUTH_SCOPE };
    }
    validateAuthorizationRequest(request, client) {
        const redirectUri = normalizeLoopbackRedirectUri(request.redirectUri);
        if (!redirectUri || !client.redirectUris.includes(redirectUri))
            return 'redirect_uri is not registered.';
        if (request.resource !== this.getResource())
            return 'resource does not match the MCP endpoint.';
        return '';
    }
    redirectOrError(response, request, auth, kind) {
        const client = this.resolveClient(auth.clientId);
        const redirect = client && client.redirectUris.includes(normalizeLoopbackRedirectUri(auth.redirectUri)) ? new node_url_1.URL(auth.redirectUri) : null;
        if (!redirect) {
            this.writeOAuthHtml(response, 400, this.errorPage(kind === 'access_denied' ? 'access_denied' : kind === 'temporarily_unavailable' ? 'temporarily_unavailable' : kind === 'server_error' ? 'server_error' : 'invalid_request'), request);
            return;
        }
        redirect.searchParams.set('error', kind === 'server_error' ? 'server_error' : kind);
        if (auth.state)
            redirect.searchParams.set('state', auth.state);
        this.applySecurityHeaders(response);
        response.setHeader('Content-Security-Policy', (0, oauth_page_1.oauthContentSecurityPolicy)(redirect.origin));
        response.statusCode = 303;
        response.setHeader('Location', redirect.toString());
        response.end();
    }
    errorPage(kind) {
        return (0, oauth_page_1.renderOAuthErrorPage)(this.resolveOAuthUiLocale(), kind);
    }
    resolveOAuthUiLocale() {
        try {
            return (0, oauth_page_1.normalizeOAuthUiLocale)(this.getOAuthUiLocale());
        }
        catch {
            return 'zh-CN';
        }
    }
    protectedResourceMetadata() {
        return { resource: this.getResource(), authorization_servers: [this.getOrigin()], bearer_methods_supported: ['header'], scopes_supported: [OAUTH_SCOPE], resource_name: 'Tracekeeper MCP' };
    }
    authorizationServerMetadata() {
        const origin = this.getOrigin();
        return { issuer: origin, authorization_endpoint: `${origin}${AUTHORIZE_PATH}`, token_endpoint: `${origin}${TOKEN_PATH}`, registration_endpoint: `${origin}${REGISTER_PATH}`, revocation_endpoint: `${origin}${REVOKE_PATH}`, response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: [OAUTH_SCOPE], authorization_response_iss_parameter_supported: true };
    }
    protectedResourceMetadataPath() {
        const resource = new node_url_1.URL(this.getResource());
        const suffix = resource.pathname === '/' ? '' : resource.pathname;
        return `${PROTECTED_RESOURCE_METADATA_ROOT_PATH}${suffix}`;
    }
    isAllowedOAuthOrigin(request) {
        const origin = firstHeaderValue(request.headers.origin);
        return !origin || origin === this.getOrigin();
    }
    async readBodyOrRespond(request, response) {
        try {
            return await readRequestBody(request, this.maxRequestBytes, this.requestTimeoutMs);
        }
        catch (error) {
            const status = error instanceof OAuthBodyTooLargeError ? 413 : error instanceof OAuthBodyTimeoutError ? 408 : 400;
            this.writeOAuthJson(response, status, { error: 'invalid_request', error_description: error instanceof Error ? error.message : 'Malformed request body.' });
            return null;
        }
    }
    writeOAuthHtml(response, status, html, request) {
        this.applySecurityHeaders(response);
        this.writeOAuthCors(response, request);
        response.statusCode = status;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(html);
    }
    writeOAuthJson(response, status, payload, request) {
        this.applySecurityHeaders(response);
        this.writeOAuthCors(response, request);
        response.statusCode = status;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(payload));
    }
    writeOAuthCors(response, request) {
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.setHeader('Access-Control-Expose-Headers', 'Location');
        const origin = request ? firstHeaderValue(request.headers.origin) : '';
        if (origin === this.getOrigin()) {
            response.setHeader('Access-Control-Allow-Origin', origin);
            response.setHeader('Vary', 'Origin');
        }
    }
    applySecurityHeaders(response) {
        for (const [name, value] of Object.entries(SECURITY_HEADERS))
            response.setHeader(name, value);
    }
    pruneExpiredState() {
        const now = Date.now();
        for (const [id, client] of this.registeredClients.entries())
            if (!client.bound && client.expiresAtMs <= now)
                this.registeredClients.delete(id);
        for (const [id, pending] of this.pendingRequests.entries())
            if (pending.pending.expiresAt <= now)
                this.pendingRequests.delete(id);
        for (const [digest, code] of this.authorizationCodes.entries())
            if (code.expiresAtMs <= now)
                this.authorizationCodes.delete(digest);
    }
    enforceAuthorizationCodeCapacity() {
        while (this.authorizationCodes.size >= this.authorizationCodeCapacity) {
            const oldest = [...this.authorizationCodes.values()].sort((a, b) => a.issuedAtMs - b.issuedAtMs)[0];
            if (!oldest)
                return;
            this.authorizationCodes.delete(oldest.digest);
        }
    }
}
exports.LocalOAuthAuthorizationServer = LocalOAuthAuthorizationServer;
function normalizeLoopbackRedirectUri(value) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 2048)
        return '';
    try {
        const parsed = new node_url_1.URL(trimmed);
        if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !isLoopbackHostname(parsed.hostname) || parsed.username || parsed.password || parsed.hash)
            return '';
        return parsed.toString();
    }
    catch {
        return '';
    }
}
function isLoopbackHostname(hostname) {
    const normalized = hostname.toLowerCase();
    return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '[::1]';
}
function matchesOptionalExactArray(value, expected) {
    if (value === undefined)
        return true;
    return Array.isArray(value) && value.length === expected.length && expected.every((entry, index) => value[index] === entry);
}
function matchesRegistrationGrantTypes(value) {
    if (value === undefined)
        return true;
    if (!Array.isArray(value) || value.length === 0 || value.length > 2 || !value.every((entry) => typeof entry === 'string'))
        return false;
    const grantTypes = new Set(value);
    return grantTypes.size === value.length
        && grantTypes.has('authorization_code')
        && [...grantTypes].every((entry) => entry === 'authorization_code' || entry === 'refresh_token');
}
function isRecordLike(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function parseUniqueForm(body) {
    const params = new URLSearchParams(body);
    const result = Object.create(null);
    for (const key of new Set(params.keys())) {
        const values = params.getAll(key);
        if (values.length !== 1)
            return new Error(`${key} must not be repeated.`);
        result[key] = values[0];
    }
    return result;
}
function hasContentType(request, expected) {
    return firstHeaderValue(request.headers['content-type']).toLowerCase().split(';', 1)[0].trim() === expected;
}
function firstHeaderValue(value) {
    return Array.isArray(value) ? value[0] || '' : value || '';
}
function randomOpaqueValue(bytes) {
    return crypto.randomBytes(bytes).toString('base64url');
}
function digestSecretHex(value) {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
function timingSafeTextEqual(left, right) {
    const leftBuffer = node_buffer_1.Buffer.from(left, 'utf8');
    const rightBuffer = node_buffer_1.Buffer.from(right, 'utf8');
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
function containsAsciiControlCharacter(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x1f || code === 0x7f) {
            return true;
        }
    }
    return false;
}
async function readRequestBody(request, maxBytes, timeoutMs) {
    const declaredLength = Number.parseInt(firstHeaderValue(request.headers['content-length']), 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes)
        throw new OAuthBodyTooLargeError(maxBytes);
    let timeout;
    const timeoutPromise = new Promise((_resolve, reject) => { timeout = (0, node_timers_1.setTimeout)(() => reject(new OAuthBodyTimeoutError(timeoutMs)), timeoutMs); });
    try {
        const bodyPromise = (async () => {
            const chunks = [];
            let total = 0;
            for await (const chunk of request) {
                const bytes = typeof chunk === 'string' ? node_buffer_1.Buffer.from(chunk, 'utf8') : node_buffer_1.Buffer.from(chunk);
                total += bytes.length;
                if (total > maxBytes)
                    throw new OAuthBodyTooLargeError(maxBytes);
                chunks.push(bytes);
            }
            return node_buffer_1.Buffer.concat(chunks, total).toString('utf8');
        })();
        return await Promise.race([bodyPromise, timeoutPromise]);
    }
    finally {
        if (timeout)
            (0, node_timers_1.clearTimeout)(timeout);
    }
}
class OAuthBodyTooLargeError extends Error {
    constructor(limit) {
        super(`OAuth request body exceeds the ${limit} byte limit.`);
    }
}
class OAuthBodyTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`OAuth request body was not received within ${timeoutMs} ms.`);
    }
}
