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
const node_url_1 = require("node:url");
const PROTECTED_RESOURCE_METADATA_ROOT_PATH = '/.well-known/oauth-protected-resource';
const AUTHORIZATION_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server';
const REGISTER_PATH = '/oauth/register';
const AUTHORIZE_PATH = '/oauth/authorize';
const TOKEN_PATH = '/oauth/token';
const OAUTH_SCOPE = 'mcp';
const OAUTH_BODY_LIMIT_BYTES = 16 * 1024;
const APPROVAL_TTL_MS = 2 * 60 * 1000;
const APPROVAL_CAPACITY = 16;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/u;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PAIRING_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/u;
const HUMAN_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECURITY_HEADERS = {
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
/**
 * Hosts local OAuth authorization and one-time pairing on the existing loopback listener.
 */
class LocalOAuthAuthorizationServer {
    constructor(options) {
        this.pairingTickets = new Map();
        this.registeredClients = new Map();
        this.authorizationApprovals = new Map();
        this.authorizationCodes = new Map();
        this.serviceTokenHash = node_buffer_1.Buffer.from(options.serviceTokenHash);
        this.getSharedBearerToken = options.getSharedBearerToken;
        this.getOrigin = options.getOrigin;
        this.getResource = options.getResource;
        this.maxRequestBytes = Math.min(options.maxRequestBytes, OAUTH_BODY_LIMIT_BYTES);
        this.requestTimeoutMs = options.requestTimeoutMs;
        this.pairingTicketTtlMs = options.pairingTicketTtlMs;
        this.pairingTicketCapacity = options.pairingTicketCapacity;
        this.pairingTicketMaxAttempts = options.pairingTicketMaxAttempts;
        this.authorizationCodeTtlMs = options.authorizationCodeTtlMs;
        this.authorizationCodeCapacity = options.authorizationCodeCapacity;
        this.clientRegistrationTtlMs = options.clientRegistrationTtlMs;
        this.clientRegistrationCapacity = options.clientRegistrationCapacity;
    }
    issuePairingTicket(expectedClientId) {
        const normalizedClientId = normalizeExpectedClientId(expectedClientId);
        this.pruneExpiredState();
        const activeTickets = [...this.pairingTickets.values()].filter((ticket) => isActiveTicket(ticket));
        if (activeTickets.length >= this.pairingTicketCapacity) {
            throw new Error(`At most ${this.pairingTicketCapacity} active pairing tickets are allowed.`);
        }
        this.dropOldestTerminalTickets();
        const now = Date.now();
        let code;
        let codeLocatorDigest;
        while (true) {
            code = createHumanPairingCode();
            codeLocatorDigest = digestPairingCodeLocator(code);
            if (!activeTickets.some((ticket) => (ticket.codeLocatorDigest
                && crypto.timingSafeEqual(ticket.codeLocatorDigest, codeLocatorDigest)))) {
                break;
            }
        }
        const record = {
            id: randomOpaqueValue(16),
            codeDigest: digestSecret(normalizePairingCode(code)),
            codeLocatorDigest,
            expectedClientId: normalizedClientId,
            state: 'pending',
            issuedAtMs: now,
            expiresAtMs: now + this.pairingTicketTtlMs,
            attemptsRemaining: this.pairingTicketMaxAttempts,
        };
        this.pairingTickets.set(record.id, record);
        return {
            id: record.id,
            code,
            expectedClientId: record.expectedClientId,
            issuedAt: new Date(record.issuedAtMs).toISOString(),
            expiresAt: new Date(record.expiresAtMs).toISOString(),
        };
    }
    getPairingTicketStatus(id) {
        this.pruneExpiredState();
        const record = this.pairingTickets.get(id);
        return record ? toPairingTicketStatus(record) : null;
    }
    clear() {
        this.pairingTickets.clear();
        this.registeredClients.clear();
        this.authorizationApprovals.clear();
        this.authorizationCodes.clear();
    }
    handlesPath(pathname) {
        return (pathname === AUTHORIZATION_SERVER_METADATA_PATH
            || pathname === PROTECTED_RESOURCE_METADATA_ROOT_PATH
            || pathname === this.protectedResourceMetadataPath()
            || pathname === REGISTER_PATH
            || pathname === AUTHORIZE_PATH
            || pathname === TOKEN_PATH);
    }
    protectedResourceMetadataUrl() {
        return `${this.getOrigin()}${this.protectedResourceMetadataPath()}`;
    }
    async handle(request, response, url) {
        this.pruneExpiredState();
        if (request.method === 'OPTIONS') {
            if (!this.isAllowedOAuthOrigin(request)) {
                this.writeOAuthJson(response, 403, {
                    error: 'invalid_request',
                    error_description: 'Forbidden origin.',
                });
                return;
            }
            this.writeOAuthCors(response, request);
            response.statusCode = 204;
            response.end();
            return;
        }
        if (!this.isAllowedOAuthOrigin(request)) {
            this.writeOAuthJson(response, 403, {
                error: 'invalid_request',
                error_description: 'Forbidden origin.',
            });
            return;
        }
        if (url.pathname === AUTHORIZATION_SERVER_METADATA_PATH
            && request.method === 'GET') {
            this.writeOAuthJson(response, 200, this.authorizationServerMetadata(), request);
            return;
        }
        if ((url.pathname === PROTECTED_RESOURCE_METADATA_ROOT_PATH
            || url.pathname === this.protectedResourceMetadataPath())
            && request.method === 'GET') {
            this.writeOAuthJson(response, 200, this.protectedResourceMetadata(), request);
            return;
        }
        if (url.pathname === REGISTER_PATH && request.method === 'POST') {
            await this.handleRegistration(request, response);
            return;
        }
        if (url.pathname === AUTHORIZE_PATH && request.method === 'GET') {
            this.handleAuthorizationPage(request, response, url);
            return;
        }
        if (url.pathname === AUTHORIZE_PATH && request.method === 'POST') {
            await this.handleAuthorizationPost(request, response);
            return;
        }
        if (url.pathname === TOKEN_PATH && request.method === 'POST') {
            await this.handleTokenExchange(request, response);
            return;
        }
        this.writeOAuthJson(response, 405, {
            error: 'invalid_request',
            error_description: 'Method not allowed.',
        });
    }
    async handleRegistration(request, response) {
        if (!hasContentType(request, 'application/json')) {
            this.writeOAuthJson(response, 415, {
                error: 'invalid_client_metadata',
                error_description: 'Content-Type must be application/json.',
            });
            return;
        }
        const body = await this.readBodyOrRespond(request, response);
        if (body === null) {
            return;
        }
        let payload;
        try {
            payload = JSON.parse(body || '{}');
        }
        catch {
            this.writeOAuthJson(response, 400, {
                error: 'invalid_client_metadata',
                error_description: 'Invalid JSON body.',
            });
            return;
        }
        if (!isRecordLike(payload)) {
            this.writeOAuthJson(response, 400, {
                error: 'invalid_client_metadata',
                error_description: 'Registration body must be an object.',
            });
            return;
        }
        const parsed = this.validateRegistration(payload);
        if (parsed instanceof Error) {
            this.writeOAuthJson(response, 400, {
                error: 'invalid_client_metadata',
                error_description: parsed.message,
            });
            return;
        }
        if (this.registeredClients.size >= this.clientRegistrationCapacity) {
            this.writeOAuthJson(response, 429, {
                error: 'temporarily_unavailable',
                error_description: 'Client registration capacity reached.',
            });
            return;
        }
        const now = Date.now();
        const client = {
            clientId: randomOpaqueValue(18),
            clientName: parsed.clientName,
            redirectUris: parsed.redirectUris,
            issuedAtMs: now,
            expiresAtMs: now + this.clientRegistrationTtlMs,
        };
        this.registeredClients.set(client.clientId, client);
        this.writeOAuthJson(response, 201, {
            client_id: client.clientId,
            client_id_issued_at: Math.floor(client.issuedAtMs / 1000),
            client_id_expires_at: Math.floor(client.expiresAtMs / 1000),
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code'],
            response_types: ['code'],
            redirect_uris: client.redirectUris,
            client_name: client.clientName,
            scope: OAUTH_SCOPE,
        }, request);
    }
    handleAuthorizationPage(request, response, url) {
        const parsed = this.parseAuthorizationRequest(url.searchParams);
        if (parsed instanceof Error) {
            this.writeOAuthHtml(response, 400, errorPage('授权请求无效', parsed.message), request);
            return;
        }
        const client = this.registeredClients.get(parsed.clientId);
        if (!client || client.expiresAtMs <= Date.now()) {
            this.writeOAuthHtml(response, 400, errorPage('客户端注册无效', '请返回 Agent 重新发起连接。'), request);
            return;
        }
        const validationError = this.validateAuthorizationRequest(parsed, client);
        if (validationError) {
            this.writeOAuthHtml(response, 400, errorPage('授权请求无效', validationError), request);
            return;
        }
        this.writeOAuthHtml(response, 200, this.pairingEntryPage(parsed, client), request);
    }
    async handleAuthorizationPost(request, response) {
        if (!this.isSameOriginFormPost(request)) {
            this.writeOAuthJson(response, 403, {
                error: 'invalid_request',
                error_description: 'Authorization form must be submitted from the runtime origin.',
            });
            return;
        }
        if (!hasContentType(request, 'application/x-www-form-urlencoded')) {
            this.writeOAuthJson(response, 415, {
                error: 'invalid_request',
                error_description: 'Content-Type must be application/x-www-form-urlencoded.',
            });
            return;
        }
        const body = await this.readBodyOrRespond(request, response);
        if (body === null) {
            return;
        }
        const form = parseUniqueForm(body);
        if (form instanceof Error) {
            this.writeOAuthJson(response, 400, {
                error: 'invalid_request',
                error_description: form.message,
            });
            return;
        }
        if (form.action === 'approve') {
            this.completeAuthorization(request, response, form.approval_id || '');
            return;
        }
        if (form.action !== 'verify') {
            this.writeOAuthJson(response, 400, {
                error: 'invalid_request',
                error_description: 'Unknown authorization action.',
            });
            return;
        }
        const parsed = this.parseAuthorizationRequest(new URLSearchParams(form));
        if (parsed instanceof Error) {
            this.writeOAuthHtml(response, 400, errorPage('授权请求无效', parsed.message), request);
            return;
        }
        const client = this.registeredClients.get(parsed.clientId);
        if (!client || client.expiresAtMs <= Date.now()) {
            this.writeOAuthHtml(response, 400, errorPage('客户端注册无效', '请返回 Agent 重新发起连接。'), request);
            return;
        }
        const validationError = this.validateAuthorizationRequest(parsed, client);
        if (validationError) {
            this.writeOAuthHtml(response, 400, errorPage('授权请求无效', validationError), request);
            return;
        }
        const ticket = this.verifyPairingCode(form.pairing_code || '');
        if (!ticket) {
            this.writeOAuthHtml(response, 400, errorPage('配对码无效', '请回到 Obsidian 重新核对，或生成新的配对码。'), request);
            return;
        }
        const approvalSecret = randomOpaqueValue(24);
        const approvalDigest = digestSecretHex(approvalSecret);
        const now = Date.now();
        const approval = {
            digest: approvalDigest,
            ticketId: ticket.id,
            request: parsed,
            issuedAtMs: now,
            expiresAtMs: Math.min(now + APPROVAL_TTL_MS, ticket.expiresAtMs),
        };
        this.enforceApprovalCapacity();
        this.authorizationApprovals.set(approvalDigest, approval);
        ticket.state = 'awaiting_confirmation';
        ticket.approvalDigest = approvalDigest;
        this.writeOAuthHtml(response, 200, this.confirmationPage(approvalSecret, ticket, client), request);
    }
    completeAuthorization(request, response, approvalSecret) {
        const digest = digestSecretHex(approvalSecret);
        const approval = this.authorizationApprovals.get(digest);
        this.authorizationApprovals.delete(digest);
        if (!approval || approval.expiresAtMs <= Date.now()) {
            this.writeOAuthHtml(response, 400, errorPage('确认已失效', '请返回 Agent 重新发起连接。'), request);
            return;
        }
        const ticket = this.pairingTickets.get(approval.ticketId);
        if (!ticket
            || ticket.state !== 'awaiting_confirmation'
            || ticket.approvalDigest !== digest
            || ticket.expiresAtMs <= Date.now()) {
            this.writeOAuthHtml(response, 400, errorPage('配对已失效', '请在 Obsidian 中生成新的配对码。'), request);
            return;
        }
        const client = this.registeredClients.get(approval.request.clientId);
        if (!client || client.expiresAtMs <= Date.now()) {
            this.writeOAuthHtml(response, 400, errorPage('客户端注册无效', '请返回 Agent 重新发起连接。'), request);
            return;
        }
        const validationError = this.validateAuthorizationRequest(approval.request, client);
        if (validationError) {
            this.writeOAuthHtml(response, 400, errorPage('授权请求无效', validationError), request);
            return;
        }
        const now = Date.now();
        ticket.state = 'authorized';
        ticket.authorizedAtMs = now;
        ticket.codeDigest = null;
        ticket.codeLocatorDigest = null;
        delete ticket.approvalDigest;
        const rawCode = randomOpaqueValue(32);
        const codeDigest = digestSecretHex(rawCode);
        this.enforceAuthorizationCodeCapacity();
        this.authorizationCodes.set(codeDigest, {
            digest: codeDigest,
            clientId: approval.request.clientId,
            redirectUri: approval.request.redirectUri,
            codeChallenge: approval.request.codeChallenge,
            resource: approval.request.resource,
            scope: approval.request.scope,
            issuedAtMs: now,
            expiresAtMs: now + this.authorizationCodeTtlMs,
        });
        const redirect = new node_url_1.URL(approval.request.redirectUri);
        redirect.searchParams.set('code', rawCode);
        redirect.searchParams.set('state', approval.request.state);
        redirect.searchParams.set('iss', this.getOrigin());
        this.applySecurityHeaders(response);
        response.statusCode = 303;
        response.setHeader('Location', redirect.toString());
        response.end();
    }
    async handleTokenExchange(request, response) {
        if (!hasContentType(request, 'application/x-www-form-urlencoded')) {
            this.writeOAuthJson(response, 415, {
                error: 'invalid_request',
                error_description: 'Content-Type must be application/x-www-form-urlencoded.',
            });
            return;
        }
        const body = await this.readBodyOrRespond(request, response);
        if (body === null) {
            return;
        }
        const form = parseUniqueForm(body);
        if (form instanceof Error) {
            this.writeOAuthJson(response, 400, {
                error: 'invalid_request',
                error_description: form.message,
            });
            return;
        }
        if (form.grant_type !== 'authorization_code') {
            this.writeOAuthJson(response, 400, {
                error: 'unsupported_grant_type',
                error_description: 'grant_type must be authorization_code.',
            });
            return;
        }
        const rawCode = form.code || '';
        const authorizationCode = this.authorizationCodes.get(digestSecretHex(rawCode));
        this.authorizationCodes.delete(digestSecretHex(rawCode));
        if (!authorizationCode || authorizationCode.expiresAtMs <= Date.now()) {
            this.writeOAuthJson(response, 400, {
                error: 'invalid_grant',
                error_description: 'Authorization code is invalid, expired, or already used.',
            });
            return;
        }
        const verifier = form.code_verifier || '';
        if (form.client_id !== authorizationCode.clientId
            || form.redirect_uri !== authorizationCode.redirectUri
            || form.resource !== authorizationCode.resource
            || !CODE_VERIFIER_PATTERN.test(verifier)) {
            this.writeOAuthJson(response, 400, {
                error: 'invalid_grant',
                error_description: 'Authorization code binding is invalid.',
            });
            return;
        }
        const computedChallenge = crypto
            .createHash('sha256')
            .update(verifier, 'utf8')
            .digest('base64url');
        if (!timingSafeTextEqual(computedChallenge, authorizationCode.codeChallenge)) {
            this.writeOAuthJson(response, 400, {
                error: 'invalid_grant',
                error_description: 'PKCE verification failed.',
            });
            return;
        }
        let sharedToken;
        try {
            sharedToken = await this.getSharedBearerToken();
        }
        catch {
            this.writeOAuthJson(response, 500, {
                error: 'server_error',
                error_description: 'Shared bearer token is unavailable.',
            });
            return;
        }
        if (typeof sharedToken !== 'string'
            || /\s/u.test(sharedToken)
            || !crypto.timingSafeEqual(digestSecret(sharedToken), this.serviceTokenHash)) {
            this.writeOAuthJson(response, 500, {
                error: 'server_error',
                error_description: 'Shared bearer token does not match the active runtime.',
            });
            return;
        }
        this.writeOAuthJson(response, 200, {
            access_token: sharedToken,
            token_type: 'Bearer',
            scope: authorizationCode.scope,
        }, request);
    }
    validateRegistration(request) {
        if (request.token_endpoint_auth_method !== undefined
            && request.token_endpoint_auth_method !== 'none') {
            return new Error('Only public clients with token_endpoint_auth_method=none are supported.');
        }
        if (!matchesOptionalRegistrationGrantTypes(request.grant_types)) {
            return new Error('Only authorization_code client metadata, with optional refresh_token, is accepted.');
        }
        if (!matchesOptionalExactArray(request.response_types, ['code'])) {
            return new Error('Only the code response type is supported.');
        }
        if (request.scope !== undefined
            && (typeof request.scope !== 'string' || request.scope.trim() !== OAUTH_SCOPE)) {
            return new Error(`Only scope=${OAUTH_SCOPE} is supported.`);
        }
        if (!Array.isArray(request.redirect_uris) || request.redirect_uris.length === 0) {
            return new Error('redirect_uris must be a non-empty array.');
        }
        if (request.redirect_uris.length > 8) {
            return new Error('At most eight redirect_uris are allowed.');
        }
        const redirectUris = [];
        for (const value of request.redirect_uris) {
            if (typeof value !== 'string') {
                return new Error('Each redirect_uri must be a string.');
            }
            const normalized = normalizeLoopbackRedirectUri(value);
            if (!normalized) {
                return new Error('Every redirect_uri must be an HTTP(S) loopback URL without credentials or a fragment.');
            }
            if (!redirectUris.includes(normalized)) {
                redirectUris.push(normalized);
            }
        }
        const rawName = typeof request.client_name === 'string'
            ? request.client_name.trim()
            : 'Local MCP client';
        const clientName = rawName.slice(0, 128) || 'Local MCP client';
        if (/[\u0000-\u001f\u007f]/u.test(clientName)) {
            return new Error('client_name contains control characters.');
        }
        return { clientName, redirectUris };
    }
    parseAuthorizationRequest(params) {
        for (const required of [
            'response_type',
            'client_id',
            'redirect_uri',
            'state',
            'code_challenge',
            'code_challenge_method',
            'resource',
        ]) {
            const values = params.getAll(required);
            if (values.length !== 1 || !values[0]) {
                return new Error(`${required} must be provided exactly once.`);
            }
        }
        const scopeValues = params.getAll('scope');
        if (scopeValues.length > 1) {
            return new Error('scope must not be repeated.');
        }
        if (params.get('response_type') !== 'code') {
            return new Error('Only response_type=code is supported.');
        }
        if (params.get('code_challenge_method') !== 'S256') {
            return new Error('Only code_challenge_method=S256 is supported.');
        }
        const codeChallenge = params.get('code_challenge') || '';
        if (!CODE_CHALLENGE_PATTERN.test(codeChallenge)) {
            return new Error('code_challenge must be an unpadded SHA-256 base64url value.');
        }
        const scope = scopeValues[0] || OAUTH_SCOPE;
        if (scope !== OAUTH_SCOPE) {
            return new Error(`Only scope=${OAUTH_SCOPE} is supported.`);
        }
        const state = params.get('state') || '';
        if (state.length > 512) {
            return new Error('state is too long.');
        }
        return {
            responseType: 'code',
            clientId: params.get('client_id') || '',
            redirectUri: params.get('redirect_uri') || '',
            state,
            codeChallenge,
            codeChallengeMethod: 'S256',
            resource: params.get('resource') || '',
            scope,
        };
    }
    validateAuthorizationRequest(request, client) {
        const redirectUri = normalizeLoopbackRedirectUri(request.redirectUri);
        if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
            return 'redirect_uri 与已注册值不一致。';
        }
        if (request.resource !== this.getResource()) {
            return 'resource 与当前 Tracekeeper MCP 地址不一致。';
        }
        return '';
    }
    verifyPairingCode(rawCode) {
        const code = normalizePairingCode(rawCode);
        if (!PAIRING_CODE_PATTERN.test(code)) {
            return null;
        }
        const digest = digestSecret(code);
        const locatorDigest = digestPairingCodeLocator(code);
        let matched = null;
        let located = null;
        for (const ticket of this.pairingTickets.values()) {
            if (ticket.state === 'pending'
                && ticket.expiresAtMs > Date.now()
                && ticket.codeDigest
                && ticket.codeLocatorDigest) {
                if (crypto.timingSafeEqual(ticket.codeLocatorDigest, locatorDigest)) {
                    located = ticket;
                }
                if (crypto.timingSafeEqual(ticket.codeDigest, digest)) {
                    matched = ticket;
                }
            }
        }
        if (matched) {
            return matched;
        }
        if (!located) {
            return null;
        }
        located.attemptsRemaining = Math.max(0, located.attemptsRemaining - 1);
        if (located.attemptsRemaining === 0) {
            located.state = 'attempts_exhausted';
            located.codeDigest = null;
            located.codeLocatorDigest = null;
        }
        return null;
    }
    pairingEntryPage(request, client) {
        return htmlPage('连接 Tracekeeper', `<h1>连接 Tracekeeper</h1>
<p>OAuth 客户端自报名称：<strong>${escapeHtml(client.clientName)}</strong></p>
<p>请输入在 Obsidian 为这个 Agent 生成的配对码。客户端名称仅供核对，不代表身份认证。</p>
<form method="post" action="${escapeHtml(`${this.getOrigin()}${AUTHORIZE_PATH}`)}">
${authorizationRequestInputs(request)}
<input type="hidden" name="action" value="verify" />
<label>配对码 <input name="pairing_code" inputmode="text" autocomplete="one-time-code" required /></label>
<button type="submit">核对连接</button>
</form>`);
    }
    confirmationPage(approvalSecret, ticket, client) {
        return htmlPage('确认 Tracekeeper 连接', `<h1>确认连接</h1>
<p>此配对码是在 Obsidian 为 <strong>${escapeHtml(ticket.expectedClientId)}</strong> 生成的。</p>
<p>发起请求的 OAuth 客户端自报名称为 <strong>${escapeHtml(client.clientName)}</strong>。</p>
<p>请确认两者符合你的预期。客户端自报名称不是认证凭据。</p>
<form method="post" action="${escapeHtml(`${this.getOrigin()}${AUTHORIZE_PATH}`)}">
<input type="hidden" name="action" value="approve" />
<input type="hidden" name="approval_id" value="${escapeHtml(approvalSecret)}" />
<button type="submit">确认并连接</button>
</form>`);
    }
    protectedResourceMetadata() {
        return {
            resource: this.getResource(),
            authorization_servers: [this.getOrigin()],
            bearer_methods_supported: ['header'],
            scopes_supported: [OAUTH_SCOPE],
            resource_name: 'Tracekeeper MCP',
        };
    }
    authorizationServerMetadata() {
        const origin = this.getOrigin();
        return {
            issuer: origin,
            authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
            token_endpoint: `${origin}${TOKEN_PATH}`,
            registration_endpoint: `${origin}${REGISTER_PATH}`,
            response_types_supported: ['code'],
            response_modes_supported: ['query'],
            grant_types_supported: ['authorization_code'],
            token_endpoint_auth_methods_supported: ['none'],
            code_challenge_methods_supported: ['S256'],
            scopes_supported: [OAUTH_SCOPE],
            authorization_response_iss_parameter_supported: false,
        };
    }
    protectedResourceMetadataPath() {
        const resource = new node_url_1.URL(this.getResource());
        const suffix = resource.pathname === '/' ? '' : resource.pathname;
        return `${PROTECTED_RESOURCE_METADATA_ROOT_PATH}${suffix}`;
    }
    isAllowedOAuthOrigin(request) {
        const origin = firstHeaderValue(request.headers.origin);
        if (!origin) {
            return true;
        }
        return origin === this.getOrigin();
    }
    isSameOriginFormPost(request) {
        return firstHeaderValue(request.headers.origin) === this.getOrigin();
    }
    async readBodyOrRespond(request, response) {
        try {
            return await readRequestBody(request, this.maxRequestBytes, this.requestTimeoutMs);
        }
        catch (error) {
            if (error instanceof OAuthBodyTooLargeError) {
                this.writeOAuthJson(response, 413, {
                    error: 'invalid_request',
                    error_description: error.message,
                });
                return null;
            }
            if (error instanceof OAuthBodyTimeoutError) {
                this.writeOAuthJson(response, 408, {
                    error: 'invalid_request',
                    error_description: error.message,
                });
                return null;
            }
            this.writeOAuthJson(response, 400, {
                error: 'invalid_request',
                error_description: 'Malformed request body.',
            });
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
        for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
            response.setHeader(name, value);
        }
    }
    pruneExpiredState() {
        const now = Date.now();
        for (const ticket of this.pairingTickets.values()) {
            if (isActiveTicket(ticket) && ticket.expiresAtMs <= now) {
                ticket.state = 'expired';
                ticket.codeDigest = null;
                ticket.codeLocatorDigest = null;
                delete ticket.approvalDigest;
            }
        }
        for (const [clientId, client] of this.registeredClients.entries()) {
            if (client.expiresAtMs <= now) {
                this.registeredClients.delete(clientId);
            }
        }
        for (const [digest, approval] of this.authorizationApprovals.entries()) {
            if (approval.expiresAtMs > now) {
                continue;
            }
            this.authorizationApprovals.delete(digest);
            const ticket = this.pairingTickets.get(approval.ticketId);
            if (ticket
                && ticket.state === 'awaiting_confirmation'
                && ticket.approvalDigest === digest
                && ticket.expiresAtMs > now) {
                ticket.state = 'pending';
                delete ticket.approvalDigest;
            }
        }
        for (const [digest, code] of this.authorizationCodes.entries()) {
            if (code.expiresAtMs <= now) {
                this.authorizationCodes.delete(digest);
            }
        }
    }
    dropOldestTerminalTickets() {
        while (this.pairingTickets.size >= this.pairingTicketCapacity) {
            const terminal = [...this.pairingTickets.values()]
                .filter((ticket) => !isActiveTicket(ticket))
                .sort((left, right) => left.issuedAtMs - right.issuedAtMs)[0];
            if (!terminal) {
                return;
            }
            this.pairingTickets.delete(terminal.id);
        }
    }
    enforceApprovalCapacity() {
        while (this.authorizationApprovals.size >= APPROVAL_CAPACITY) {
            const oldest = [...this.authorizationApprovals.values()]
                .sort((left, right) => left.issuedAtMs - right.issuedAtMs)[0];
            if (!oldest) {
                return;
            }
            this.authorizationApprovals.delete(oldest.digest);
            const ticket = this.pairingTickets.get(oldest.ticketId);
            if (ticket?.approvalDigest === oldest.digest) {
                ticket.state = 'pending';
                delete ticket.approvalDigest;
            }
        }
    }
    enforceAuthorizationCodeCapacity() {
        while (this.authorizationCodes.size >= this.authorizationCodeCapacity) {
            const oldest = [...this.authorizationCodes.values()]
                .sort((left, right) => left.issuedAtMs - right.issuedAtMs)[0];
            if (!oldest) {
                return;
            }
            this.authorizationCodes.delete(oldest.digest);
        }
    }
}
exports.LocalOAuthAuthorizationServer = LocalOAuthAuthorizationServer;
function normalizeExpectedClientId(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length < 1
        || normalized.length > 64
        || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(normalized)) {
        throw new Error('expectedClientId must be a 1-64 character Agent identifier.');
    }
    return normalized;
}
function toPairingTicketStatus(record) {
    const status = {
        id: record.id,
        expectedClientId: record.expectedClientId,
        state: record.state,
        issuedAt: new Date(record.issuedAtMs).toISOString(),
        expiresAt: new Date(record.expiresAtMs).toISOString(),
        attemptsRemaining: record.attemptsRemaining,
    };
    if (record.authorizedAtMs !== undefined) {
        status.authorizedAt = new Date(record.authorizedAtMs).toISOString();
    }
    return status;
}
function isActiveTicket(record) {
    return record.state === 'pending' || record.state === 'awaiting_confirmation';
}
function createHumanPairingCode() {
    const bytes = crypto.randomBytes(10);
    let accumulator = 0;
    let bitCount = 0;
    let encoded = '';
    for (const byte of bytes) {
        accumulator = (accumulator << 8) | byte;
        bitCount += 8;
        while (bitCount >= 5) {
            bitCount -= 5;
            encoded += HUMAN_CODE_ALPHABET[(accumulator >>> bitCount) & 31];
            accumulator &= (1 << bitCount) - 1;
        }
    }
    return encoded.match(/.{4}/gu)?.join('-') || encoded;
}
function normalizePairingCode(value) {
    const compact = typeof value === 'string'
        ? value.toUpperCase().replace(/[\s-]/gu, '')
        : '';
    return compact.match(/.{1,4}/gu)?.join('-') || '';
}
function digestPairingCodeLocator(code) {
    return digestSecret(code.slice(0, 9));
}
function normalizeLoopbackRedirectUri(value) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 2048) {
        return '';
    }
    try {
        const parsed = new node_url_1.URL(trimmed);
        if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            || !isLoopbackHostname(parsed.hostname)
            || parsed.username
            || parsed.password
            || parsed.hash) {
            return '';
        }
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
    if (value === undefined) {
        return true;
    }
    return (Array.isArray(value)
        && value.length === expected.length
        && expected.every((entry, index) => value[index] === entry));
}
function matchesOptionalRegistrationGrantTypes(value) {
    if (value === undefined) {
        return true;
    }
    if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
        return false;
    }
    const grants = new Set(value);
    return (grants.size === value.length
        && grants.has('authorization_code')
        && [...grants].every((grant) => grant === 'authorization_code' || grant === 'refresh_token'));
}
function isRecordLike(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function authorizationRequestInputs(request) {
    const values = [
        ['response_type', request.responseType],
        ['client_id', request.clientId],
        ['redirect_uri', request.redirectUri],
        ['state', request.state],
        ['code_challenge', request.codeChallenge],
        ['code_challenge_method', request.codeChallengeMethod],
        ['resource', request.resource],
        ['scope', request.scope],
    ];
    return values
        .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}" />`)
        .join('\n');
}
function htmlPage(title, body) {
    return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title></head>
<body><main>${body}</main></body>
</html>`;
}
function errorPage(title, message) {
    return htmlPage(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
}
function escapeHtml(value) {
    return value
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&#39;');
}
function parseUniqueForm(body) {
    const params = new URLSearchParams(body);
    const result = Object.create(null);
    for (const key of new Set(params.keys())) {
        const values = params.getAll(key);
        if (values.length !== 1) {
            return new Error(`${key} must not be repeated.`);
        }
        result[key] = values[0];
    }
    return result;
}
function hasContentType(request, expected) {
    const contentType = firstHeaderValue(request.headers['content-type']).toLowerCase();
    return contentType.split(';', 1)[0].trim() === expected;
}
function firstHeaderValue(value) {
    return Array.isArray(value) ? value[0] || '' : value || '';
}
async function readRequestBody(request, maxBytes, timeoutMs) {
    const declaredLength = Number.parseInt(firstHeaderValue(request.headers['content-length']), 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new OAuthBodyTooLargeError(maxBytes);
    }
    let timeout;
    const timeoutPromise = new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new OAuthBodyTimeoutError(timeoutMs)), timeoutMs);
    });
    try {
        return await Promise.race([consumeRequestBody(request, maxBytes), timeoutPromise]);
    }
    finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}
async function consumeRequestBody(request, maxBytes) {
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of request) {
        const bytes = typeof chunk === 'string' ? node_buffer_1.Buffer.from(chunk, 'utf8') : node_buffer_1.Buffer.from(chunk);
        totalBytes += bytes.length;
        if (totalBytes > maxBytes) {
            throw new OAuthBodyTooLargeError(maxBytes);
        }
        chunks.push(bytes);
    }
    return node_buffer_1.Buffer.concat(chunks, totalBytes).toString('utf8');
}
function randomOpaqueValue(bytes) {
    return crypto.randomBytes(bytes).toString('base64url');
}
function digestSecret(value) {
    return crypto.createHash('sha256').update(value, 'utf8').digest();
}
function digestSecretHex(value) {
    return digestSecret(value).toString('hex');
}
function timingSafeTextEqual(left, right) {
    const leftBuffer = node_buffer_1.Buffer.from(left, 'utf8');
    const rightBuffer = node_buffer_1.Buffer.from(right, 'utf8');
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
class OAuthBodyTooLargeError extends Error {
    constructor(limit) {
        super(`OAuth request body exceeds the ${limit} byte limit.`);
        this.name = 'OAuthBodyTooLargeError';
    }
}
class OAuthBodyTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`OAuth request body was not received within ${timeoutMs} ms.`);
        this.name = 'OAuthBodyTimeoutError';
    }
}
