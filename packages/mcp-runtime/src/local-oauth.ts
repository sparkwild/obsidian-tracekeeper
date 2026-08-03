import { Buffer } from 'node:buffer';
import * as crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
	normalizeOAuthUiLocale,
	oauthContentSecurityPolicy,
	renderOAuthConfirmationPage,
	renderOAuthErrorPage,
	renderOAuthPairingPage,
	type OAuthPageErrorKind,
	type OAuthUiLocale,
} from './oauth-page';

export type PairingTicketState =
	| 'pending'
	| 'awaiting_confirmation'
	| 'authorized'
	| 'expired'
	| 'attempts_exhausted';

export interface PairingTicket {
	id: string;
	code: string;
	expectedClientId: string;
	issuedAt: string;
	expiresAt: string;
}

export interface PairingTicketStatus {
	id: string;
	expectedClientId: string;
	state: PairingTicketState;
	issuedAt: string;
	expiresAt: string;
	attemptsRemaining: number;
	authorizedAt?: string;
}

export interface LocalOAuthAuthorizationServerOptions {
	serviceTokenHash: Buffer;
	getSharedBearerToken: () => string | Promise<string>;
	getOrigin: () => string;
	getResource: () => string;
	maxRequestBytes: number;
	requestTimeoutMs: number;
	pairingTicketTtlMs: number;
	pairingTicketCapacity: number;
	pairingTicketMaxAttempts: number;
	authorizationCodeTtlMs: number;
	authorizationCodeCapacity: number;
	clientRegistrationTtlMs: number;
	clientRegistrationCapacity: number;
	getOAuthUiLocale?: () => OAuthUiLocale;
}

interface PairingTicketRecord {
	id: string;
	codeDigest: Buffer | null;
	codeLocatorDigest: Buffer | null;
	expectedClientId: string;
	state: PairingTicketState;
	issuedAtMs: number;
	expiresAtMs: number;
	attemptsRemaining: number;
	authorizedAtMs?: number;
	approvalDigest?: string;
}

interface RegisteredClient {
	clientId: string;
	clientName: string;
	redirectUris: string[];
	issuedAtMs: number;
	expiresAtMs: number;
}

interface AuthorizationRequest {
	responseType: 'code';
	clientId: string;
	redirectUri: string;
	state: string;
	codeChallenge: string;
	codeChallengeMethod: 'S256';
	resource: string;
	scope: string;
}

interface AuthorizationApproval {
	digest: string;
	ticketId: string;
	request: AuthorizationRequest;
	issuedAtMs: number;
	expiresAtMs: number;
}

interface AuthorizationCode {
	digest: string;
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	resource: string;
	scope: string;
	issuedAtMs: number;
	expiresAtMs: number;
}

interface ClientRegistrationRequest {
	client_name?: unknown;
	redirect_uris?: unknown;
	grant_types?: unknown;
	response_types?: unknown;
	token_endpoint_auth_method?: unknown;
	scope?: unknown;
}

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
	'Content-Security-Policy': oauthContentSecurityPolicy(),
};

/**
 * Hosts local OAuth authorization and one-time pairing on the existing loopback listener.
 */
export class LocalOAuthAuthorizationServer {
	private readonly serviceTokenHash: Buffer;
	private readonly getSharedBearerToken: () => string | Promise<string>;
	private readonly getOrigin: () => string;
	private readonly getResource: () => string;
	private readonly maxRequestBytes: number;
	private readonly requestTimeoutMs: number;
	private readonly pairingTicketTtlMs: number;
	private readonly pairingTicketCapacity: number;
	private readonly pairingTicketMaxAttempts: number;
	private readonly authorizationCodeTtlMs: number;
	private readonly authorizationCodeCapacity: number;
	private readonly clientRegistrationTtlMs: number;
	private readonly clientRegistrationCapacity: number;
	private readonly getOAuthUiLocale: () => OAuthUiLocale;
	private readonly pairingTickets = new Map<string, PairingTicketRecord>();
	private readonly registeredClients = new Map<string, RegisteredClient>();
	private readonly authorizationApprovals = new Map<string, AuthorizationApproval>();
	private readonly authorizationCodes = new Map<string, AuthorizationCode>();

	constructor(options: LocalOAuthAuthorizationServerOptions) {
		this.serviceTokenHash = Buffer.from(options.serviceTokenHash);
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
		this.getOAuthUiLocale = options.getOAuthUiLocale ?? (() => 'zh-CN');
	}

	issuePairingTicket(expectedClientId: string): PairingTicket {
		const normalizedClientId = normalizeExpectedClientId(expectedClientId);
		this.pruneExpiredState();
		const activeTickets = [...this.pairingTickets.values()].filter((ticket) => isActiveTicket(ticket));
		if (activeTickets.length >= this.pairingTicketCapacity) {
			throw new Error(`At most ${this.pairingTicketCapacity} active pairing tickets are allowed.`);
		}
		this.dropOldestTerminalTickets();
		const now = Date.now();
		let code: string;
		let codeLocatorDigest: Buffer;
		while (true) {
			code = createHumanPairingCode();
			codeLocatorDigest = digestPairingCodeLocator(code);
			if (
				!activeTickets.some((ticket) => (
					ticket.codeLocatorDigest
					&& crypto.timingSafeEqual(ticket.codeLocatorDigest, codeLocatorDigest)
				))
			) {
				break;
			}
		}
		const record: PairingTicketRecord = {
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

	getPairingTicketStatus(id: string): PairingTicketStatus | null {
		this.pruneExpiredState();
		const record = this.pairingTickets.get(id);
		return record ? toPairingTicketStatus(record) : null;
	}

	clear(): void {
		this.pairingTickets.clear();
		this.registeredClients.clear();
		this.authorizationApprovals.clear();
		this.authorizationCodes.clear();
	}

	handlesPath(pathname: string): boolean {
		return (
			pathname === AUTHORIZATION_SERVER_METADATA_PATH
			|| pathname === PROTECTED_RESOURCE_METADATA_ROOT_PATH
			|| pathname === this.protectedResourceMetadataPath()
			|| pathname === REGISTER_PATH
			|| pathname === AUTHORIZE_PATH
			|| pathname === TOKEN_PATH
		);
	}

	protectedResourceMetadataUrl(): string {
		return `${this.getOrigin()}${this.protectedResourceMetadataPath()}`;
	}

	async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
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
		if (
			url.pathname === AUTHORIZATION_SERVER_METADATA_PATH
			&& request.method === 'GET'
		) {
			this.writeOAuthJson(response, 200, this.authorizationServerMetadata(), request);
			return;
		}
		if (
			(url.pathname === PROTECTED_RESOURCE_METADATA_ROOT_PATH
				|| url.pathname === this.protectedResourceMetadataPath())
			&& request.method === 'GET'
		) {
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

	private async handleRegistration(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
		let payload: unknown;
		try {
			payload = JSON.parse(body || '{}');
		} catch {
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
		const parsed = this.validateRegistration(payload as ClientRegistrationRequest);
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
		const client: RegisteredClient = {
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

	private handleAuthorizationPage(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL
	): void {
		const parsed = this.parseAuthorizationRequest(url.searchParams);
		if (parsed instanceof Error) {
			this.writeOAuthHtml(
				response,
				400,
				this.errorPage('invalid_request'),
				request
			);
			return;
		}
		const client = this.registeredClients.get(parsed.clientId);
		if (!client || client.expiresAtMs <= Date.now()) {
			this.writeOAuthHtml(
				response,
				400,
				this.errorPage('invalid_client'),
				request
			);
			return;
		}
		const validationError = this.validateAuthorizationRequest(parsed, client);
		if (validationError) {
			this.writeOAuthHtml(response, 400, this.errorPage('invalid_request'), request);
			return;
		}
		this.writeOAuthHtml(response, 200, this.pairingEntryPage(parsed, client), request);
	}

	private async handleAuthorizationPost(
		request: IncomingMessage,
		response: ServerResponse
	): Promise<void> {
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
			this.writeOAuthHtml(response, 400, this.errorPage('invalid_request'), request);
			return;
		}
		const client = this.registeredClients.get(parsed.clientId);
		if (!client || client.expiresAtMs <= Date.now()) {
			this.writeOAuthHtml(
				response,
				400,
				this.errorPage('invalid_client'),
				request
			);
			return;
		}
		const validationError = this.validateAuthorizationRequest(parsed, client);
		if (validationError) {
			this.writeOAuthHtml(response, 400, this.errorPage('invalid_request'), request);
			return;
		}
		const ticket = this.verifyPairingCode(form.pairing_code || '');
		if (!ticket) {
			this.writeOAuthHtml(
				response,
				400,
				this.errorPage('invalid_pairing_code'),
				request
			);
			return;
		}
		const approvalSecret = randomOpaqueValue(24);
		const approvalDigest = digestSecretHex(approvalSecret);
		const now = Date.now();
		const approval: AuthorizationApproval = {
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
		this.writeOAuthHtml(
			response,
			200,
			this.confirmationPage(approvalSecret, ticket, client),
			request,
			new URL(parsed.redirectUri).origin
		);
	}

	private completeAuthorization(
		request: IncomingMessage,
		response: ServerResponse,
		approvalSecret: string
	): void {
		const digest = digestSecretHex(approvalSecret);
		const approval = this.authorizationApprovals.get(digest);
		this.authorizationApprovals.delete(digest);
		if (!approval || approval.expiresAtMs <= Date.now()) {
			this.writeOAuthHtml(
				response,
				400,
				this.errorPage('confirmation_expired'),
				request
			);
			return;
		}
		const ticket = this.pairingTickets.get(approval.ticketId);
		if (
			!ticket
			|| ticket.state !== 'awaiting_confirmation'
			|| ticket.approvalDigest !== digest
			|| ticket.expiresAtMs <= Date.now()
		) {
			this.writeOAuthHtml(
				response,
				400,
				this.errorPage('pairing_expired'),
				request
			);
			return;
		}
		const client = this.registeredClients.get(approval.request.clientId);
		if (!client || client.expiresAtMs <= Date.now()) {
			this.writeOAuthHtml(
				response,
				400,
				this.errorPage('invalid_client'),
				request
			);
			return;
		}
		const validationError = this.validateAuthorizationRequest(approval.request, client);
		if (validationError) {
			this.writeOAuthHtml(response, 400, this.errorPage('invalid_request'), request);
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
		const redirect = new URL(approval.request.redirectUri);
		redirect.searchParams.set('code', rawCode);
		redirect.searchParams.set('state', approval.request.state);
		redirect.searchParams.set('iss', this.getOrigin());
		this.applySecurityHeaders(response);
		response.setHeader(
			'Content-Security-Policy',
			oauthContentSecurityPolicy(redirect.origin)
		);
		response.statusCode = 303;
		response.setHeader('Location', redirect.toString());
		response.end();
	}

	private async handleTokenExchange(
		request: IncomingMessage,
		response: ServerResponse
	): Promise<void> {
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
		if (
			form.client_id !== authorizationCode.clientId
			|| form.redirect_uri !== authorizationCode.redirectUri
			|| form.resource !== authorizationCode.resource
			|| !CODE_VERIFIER_PATTERN.test(verifier)
		) {
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
		let sharedToken: string;
		try {
			sharedToken = await this.getSharedBearerToken();
		} catch {
			this.writeOAuthJson(response, 500, {
				error: 'server_error',
				error_description: 'Shared bearer token is unavailable.',
			});
			return;
		}
		if (
			typeof sharedToken !== 'string'
			|| /\s/u.test(sharedToken)
			|| !crypto.timingSafeEqual(digestSecret(sharedToken), this.serviceTokenHash)
		) {
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

	private validateRegistration(
		request: ClientRegistrationRequest
	): { clientName: string; redirectUris: string[] } | Error {
		if (
			request.token_endpoint_auth_method !== undefined
			&& request.token_endpoint_auth_method !== 'none'
		) {
			return new Error('Only public clients with token_endpoint_auth_method=none are supported.');
		}
		if (!matchesOptionalRegistrationGrantTypes(request.grant_types)) {
			return new Error('Only authorization_code client metadata, with optional refresh_token, is accepted.');
		}
		if (!matchesOptionalExactArray(request.response_types, ['code'])) {
			return new Error('Only the code response type is supported.');
		}
		if (
			request.scope !== undefined
			&& (typeof request.scope !== 'string' || request.scope.trim() !== OAUTH_SCOPE)
		) {
			return new Error(`Only scope=${OAUTH_SCOPE} is supported.`);
		}
		if (!Array.isArray(request.redirect_uris) || request.redirect_uris.length === 0) {
			return new Error('redirect_uris must be a non-empty array.');
		}
		if (request.redirect_uris.length > 8) {
			return new Error('At most eight redirect_uris are allowed.');
		}
		const redirectUris: string[] = [];
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

	private parseAuthorizationRequest(params: URLSearchParams): AuthorizationRequest | Error {
		for (const required of [
			'response_type',
			'client_id',
			'redirect_uri',
			'state',
			'code_challenge',
			'code_challenge_method',
		]) {
			const values = params.getAll(required);
			if (values.length !== 1 || !values[0]) {
				return new Error(`${required} must be provided exactly once.`);
			}
		}
		const resourceValues = params.getAll('resource');
		if (
			resourceValues.length < 1
			|| resourceValues.some((value) => !value)
			|| resourceValues.some((value) => value !== resourceValues[0])
		) {
			return new Error('resource must be provided at least once without conflicting values.');
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
			resource: resourceValues[0],
			scope,
		};
	}

	private validateAuthorizationRequest(
		request: AuthorizationRequest,
		client: RegisteredClient
	): string {
		const redirectUri = normalizeLoopbackRedirectUri(request.redirectUri);
		if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
			return 'redirect_uri 与已注册值不一致。';
		}
		if (request.resource !== this.getResource()) {
			return 'resource 与当前 Tracekeeper MCP 地址不一致。';
		}
		return '';
	}

	private verifyPairingCode(rawCode: string): PairingTicketRecord | null {
		const code = normalizePairingCode(rawCode);
		if (!PAIRING_CODE_PATTERN.test(code)) {
			return null;
		}
		const digest = digestSecret(code);
		const locatorDigest = digestPairingCodeLocator(code);
		let matched: PairingTicketRecord | null = null;
		let located: PairingTicketRecord | null = null;
		for (const ticket of this.pairingTickets.values()) {
			if (
				ticket.state === 'pending'
				&& ticket.expiresAtMs > Date.now()
				&& ticket.codeDigest
				&& ticket.codeLocatorDigest
			) {
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

	private pairingEntryPage(
		request: AuthorizationRequest,
		client: RegisteredClient
	): string {
		return renderOAuthPairingPage(this.resolveOAuthUiLocale(), {
			actionUrl: `${this.getOrigin()}${AUTHORIZE_PATH}`,
			hiddenFields: authorizationRequestInputs(request),
			clientName: client.clientName,
		});
	}

	private confirmationPage(
		approvalSecret: string,
		ticket: PairingTicketRecord,
		client: RegisteredClient
	): string {
		return renderOAuthConfirmationPage(this.resolveOAuthUiLocale(), {
			actionUrl: `${this.getOrigin()}${AUTHORIZE_PATH}`,
			hiddenFields: [
				['action', 'approve'],
				['approval_id', approvalSecret],
			],
			expectedClientId: ticket.expectedClientId,
			clientName: client.clientName,
		});
	}

	private errorPage(kind: OAuthPageErrorKind): string {
		return renderOAuthErrorPage(this.resolveOAuthUiLocale(), kind);
	}

	private resolveOAuthUiLocale(): OAuthUiLocale {
		try {
			return normalizeOAuthUiLocale(this.getOAuthUiLocale());
		} catch {
			return 'zh-CN';
		}
	}

	private protectedResourceMetadata(): Record<string, unknown> {
		return {
			resource: this.getResource(),
			authorization_servers: [this.getOrigin()],
			bearer_methods_supported: ['header'],
			scopes_supported: [OAUTH_SCOPE],
			resource_name: 'Tracekeeper MCP',
		};
	}

	private authorizationServerMetadata(): Record<string, unknown> {
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

	private protectedResourceMetadataPath(): string {
		const resource = new URL(this.getResource());
		const suffix = resource.pathname === '/' ? '' : resource.pathname;
		return `${PROTECTED_RESOURCE_METADATA_ROOT_PATH}${suffix}`;
	}

	private isAllowedOAuthOrigin(request: IncomingMessage): boolean {
		const origin = firstHeaderValue(request.headers.origin);
		if (!origin) {
			return true;
		}
		return origin === this.getOrigin();
	}

	private isSameOriginFormPost(request: IncomingMessage): boolean {
		return firstHeaderValue(request.headers.origin) === this.getOrigin();
	}

	private async readBodyOrRespond(
		request: IncomingMessage,
		response: ServerResponse
	): Promise<string | null> {
		try {
			return await readRequestBody(
				request,
				this.maxRequestBytes,
				this.requestTimeoutMs
			);
		} catch (error: unknown) {
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

	private writeOAuthHtml(
		response: ServerResponse,
		status: number,
		html: string,
		request?: IncomingMessage,
		callbackOrigin?: string
	): void {
		this.applySecurityHeaders(response);
		if (callbackOrigin) {
			response.setHeader(
				'Content-Security-Policy',
				oauthContentSecurityPolicy(callbackOrigin)
			);
		}
		response.setHeader('Referrer-Policy', 'same-origin');
		this.writeOAuthCors(response, request);
		response.statusCode = status;
		response.setHeader('Content-Type', 'text/html; charset=utf-8');
		response.end(html);
	}

	private writeOAuthJson(
		response: ServerResponse,
		status: number,
		payload: Record<string, unknown>,
		request?: IncomingMessage
	): void {
		this.applySecurityHeaders(response);
		this.writeOAuthCors(response, request);
		response.statusCode = status;
		response.setHeader('Content-Type', 'application/json; charset=utf-8');
		response.end(JSON.stringify(payload));
	}

	private writeOAuthCors(response: ServerResponse, request?: IncomingMessage): void {
		response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
		response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		response.setHeader('Access-Control-Expose-Headers', 'Location');
		const origin = request ? firstHeaderValue(request.headers.origin) : '';
		if (origin === this.getOrigin()) {
			response.setHeader('Access-Control-Allow-Origin', origin);
			response.setHeader('Vary', 'Origin');
		}
	}

	private applySecurityHeaders(response: ServerResponse): void {
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
			response.setHeader(name, value);
		}
	}

	private pruneExpiredState(): void {
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
			if (
				ticket
				&& ticket.state === 'awaiting_confirmation'
				&& ticket.approvalDigest === digest
				&& ticket.expiresAtMs > now
			) {
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

	private dropOldestTerminalTickets(): void {
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

	private enforceApprovalCapacity(): void {
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

	private enforceAuthorizationCodeCapacity(): void {
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

function normalizeExpectedClientId(value: string): string {
	const normalized = typeof value === 'string' ? value.trim() : '';
	if (
		normalized.length < 1
		|| normalized.length > 64
		|| !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(normalized)
	) {
		throw new Error('expectedClientId must be a 1-64 character Agent identifier.');
	}
	return normalized;
}

function toPairingTicketStatus(record: PairingTicketRecord): PairingTicketStatus {
	const status: PairingTicketStatus = {
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

function isActiveTicket(record: PairingTicketRecord): boolean {
	return record.state === 'pending' || record.state === 'awaiting_confirmation';
}

function createHumanPairingCode(): string {
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

function normalizePairingCode(value: string): string {
	const compact = typeof value === 'string'
		? value.toUpperCase().replace(/[\s-]/gu, '')
		: '';
	return compact.match(/.{1,4}/gu)?.join('-') || '';
}

function digestPairingCodeLocator(code: string): Buffer {
	return digestSecret(code.slice(0, 9));
}

function normalizeLoopbackRedirectUri(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > 2048) {
		return '';
	}
	try {
		const parsed = new URL(trimmed);
		if (
			(parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
			|| !isLoopbackHostname(parsed.hostname)
			|| parsed.username
			|| parsed.password
			|| parsed.hash
		) {
			return '';
		}
		return parsed.toString();
	} catch {
		return '';
	}
}

function isLoopbackHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '[::1]';
}

function matchesOptionalExactArray(value: unknown, expected: string[]): boolean {
	if (value === undefined) {
		return true;
	}
	return (
		Array.isArray(value)
		&& value.length === expected.length
		&& expected.every((entry, index) => value[index] === entry)
	);
}

function matchesOptionalRegistrationGrantTypes(value: unknown): boolean {
	if (value === undefined) {
		return true;
	}
	if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
		return false;
	}
	const grants = new Set(value);
	return (
		grants.size === value.length
		&& grants.has('authorization_code')
		&& [...grants].every((grant) => grant === 'authorization_code' || grant === 'refresh_token')
	);
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function authorizationRequestInputs(request: AuthorizationRequest): Array<[string, string]> {
	return [
		['response_type', request.responseType],
		['client_id', request.clientId],
		['redirect_uri', request.redirectUri],
		['state', request.state],
		['code_challenge', request.codeChallenge],
		['code_challenge_method', request.codeChallengeMethod],
		['resource', request.resource],
		['scope', request.scope],
	];
}

function parseUniqueForm(body: string): Record<string, string> | Error {
	const params = new URLSearchParams(body);
	const result = Object.create(null) as Record<string, string>;
	for (const key of new Set(params.keys())) {
		const values = params.getAll(key);
		if (values.length !== 1) {
			return new Error(`${key} must not be repeated.`);
		}
		result[key] = values[0];
	}
	return result;
}

function hasContentType(request: IncomingMessage, expected: string): boolean {
	const contentType = firstHeaderValue(request.headers['content-type']).toLowerCase();
	return contentType.split(';', 1)[0].trim() === expected;
}

function firstHeaderValue(value: string | string[] | undefined): string {
	return Array.isArray(value) ? value[0] || '' : value || '';
}

async function readRequestBody(
	request: IncomingMessage,
	maxBytes: number,
	timeoutMs: number
): Promise<string> {
	const declaredLength = Number.parseInt(firstHeaderValue(request.headers['content-length']), 10);
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		throw new OAuthBodyTooLargeError(maxBytes);
	}
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => reject(new OAuthBodyTimeoutError(timeoutMs)), timeoutMs);
	});
	try {
		return await Promise.race([consumeRequestBody(request, maxBytes), timeoutPromise]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

async function consumeRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
	const chunks: Buffer[] = [];
	let totalBytes = 0;
	for await (const chunk of request) {
		const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
		totalBytes += bytes.length;
		if (totalBytes > maxBytes) {
			throw new OAuthBodyTooLargeError(maxBytes);
		}
		chunks.push(bytes);
	}
	return Buffer.concat(chunks, totalBytes).toString('utf8');
}

function randomOpaqueValue(bytes: number): string {
	return crypto.randomBytes(bytes).toString('base64url');
}

function digestSecret(value: string): Buffer {
	return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function digestSecretHex(value: string): string {
	return digestSecret(value).toString('hex');
}

function timingSafeTextEqual(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left, 'utf8');
	const rightBuffer = Buffer.from(right, 'utf8');
	return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

class OAuthBodyTooLargeError extends Error {
	constructor(limit: number) {
		super(`OAuth request body exceeds the ${limit} byte limit.`);
		this.name = 'OAuthBodyTooLargeError';
	}
}

class OAuthBodyTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`OAuth request body was not received within ${timeoutMs} ms.`);
		this.name = 'OAuthBodyTimeoutError';
	}
}
