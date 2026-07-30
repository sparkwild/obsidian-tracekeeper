import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';

import { StreamableHttpMcpRuntime } from '../dist/index.js';

const SERVICE_TOKEN = 'tracekeeper-oauth-service-token-0123456789abcdef';
const WRONG_SERVICE_TOKEN = 'tracekeeper-oauth-wrong-token-0123456789abcdef';
const REDIRECT_URI = 'http://127.0.0.1:48765/callback';
const VERIFIER = 'tracekeeper-local-pkce-verifier-0123456789-ABCDEFGH';

function pkceChallenge(verifier = VERIFIER) {
	return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

async function startRuntime(options = {}) {
	const runtime = new StreamableHttpMcpRuntime({
		localTrust: true,
		serviceToken: SERVICE_TOKEN,
		getSharedBearerToken: () => SERVICE_TOKEN,
		host: '127.0.0.1',
		port: 0,
		...options,
	});
	const status = await runtime.start();
	return {
		runtime,
		endpoint: status.endpoint,
		origin: new URL(status.endpoint).origin,
	};
}

async function registerClient(origin, overrides = {}) {
	const response = await fetch(`${origin}/oauth/register`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json',
		},
		body: JSON.stringify({
			client_name: 'Codex <local>',
			redirect_uris: [REDIRECT_URI],
			grant_types: ['authorization_code'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
			...overrides,
		}),
	});
	const body = await response.json();
	return { response, body };
}

function authorizationParams(clientId, endpoint, overrides = {}) {
	return {
		response_type: 'code',
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		state: 'state-0123456789',
		code_challenge: pkceChallenge(),
		code_challenge_method: 'S256',
		resource: endpoint,
		scope: 'mcp',
		...overrides,
	};
}

function authorizationUrl(origin, params) {
	const url = new URL(`${origin}/oauth/authorize`);
	for (const [name, value] of Object.entries(params)) {
		if (value !== undefined) {
			url.searchParams.set(name, value);
		}
	}
	return url;
}

function formBody(values) {
	const body = new URLSearchParams();
	for (const [name, value] of Object.entries(values)) {
		if (value !== undefined) {
			body.set(name, value);
		}
	}
	return body;
}

function wrongPairingCodeFor(code) {
	const replacement = code.endsWith('0') ? '1' : '0';
	return `${code.slice(0, -1)}${replacement}`;
}

function pairingCodeWithUnrelatedLocator(...codes) {
	const locators = new Set(codes.map((code) => code.slice(0, 9)));
	const locator = ['0000-0000', '1111-1111', '2222-2222'].find(
		(candidate) => !locators.has(candidate)
	);
	assert.ok(locator, 'Expected an unrelated pairing-code locator.');
	return `${locator}-0000-0000`;
}

function extractHiddenInput(html, name) {
	const pattern = new RegExp(`name="${name}" value="([^"]+)"`, 'u');
	const match = pattern.exec(html);
	assert.ok(match, `Expected hidden input ${name}.`);
	return match[1];
}

async function verifyPairing({
	origin,
	params,
	code,
	originHeader = origin,
}) {
	const response = await fetch(`${origin}/oauth/authorize`, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			origin: originHeader,
		},
		body: formBody({
			...params,
			action: 'verify',
			pairing_code: code,
		}),
		redirect: 'manual',
	});
	return { response, html: await response.text() };
}

async function approvePairing(origin, approvalId) {
	return fetch(`${origin}/oauth/authorize`, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			origin,
		},
		body: formBody({
			action: 'approve',
			approval_id: approvalId,
		}),
		redirect: 'manual',
	});
}

async function completeAuthorization({
	runtime,
	endpoint,
	origin,
	clientId,
	expectedClientId = 'codex',
	authorizationOverrides = {},
}) {
	const ticket = runtime.issuePairingTicket(expectedClientId);
	const params = authorizationParams(clientId, endpoint, authorizationOverrides);
	const pageUrl = authorizationUrl(origin, params);
	assert.equal(pageUrl.searchParams.has('pairing_code'), false);
	const page = await fetch(pageUrl);
	assert.equal(page.status, 200);
	const pageHtml = await page.text();
	assert.match(pageHtml, /OAuth 客户端自报名称/u);
	assert.match(pageHtml, /Codex &lt;local&gt;/u);
	assert.equal(pageHtml.includes(ticket.code), false);
	const verified = await verifyPairing({
		origin,
		params,
		code: ticket.code,
	});
	assert.equal(verified.response.status, 200);
	assert.match(verified.html, new RegExp(`为 <strong>${expectedClientId}</strong> 生成`, 'u'));
	assert.match(verified.html, /客户端自报名称/u);
	const approvalId = extractHiddenInput(verified.html, 'approval_id');
	const awaiting = runtime.getPairingTicketStatus(ticket.id);
	assert.equal(awaiting?.state, 'awaiting_confirmation');
	assert.equal(JSON.stringify(awaiting).includes(ticket.code), false);
	const approved = await approvePairing(origin, approvalId);
	assert.equal(approved.status, 303);
	const redirect = new URL(approved.headers.get('location'));
	assert.equal(redirect.origin + redirect.pathname, REDIRECT_URI);
	assert.equal(redirect.searchParams.get('state'), params.state);
	assert.equal(redirect.searchParams.get('iss'), origin);
	assert.ok(redirect.searchParams.get('code'));
	assert.equal(redirect.toString().includes(ticket.code), false);
	assert.equal(runtime.getPairingTicketStatus(ticket.id)?.state, 'authorized');
	return {
		ticket,
		params,
		code: redirect.searchParams.get('code'),
	};
}

async function exchangeCode(origin, values) {
	const response = await fetch(`${origin}/oauth/token`, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			accept: 'application/json',
		},
		body: formBody(values),
	});
	return { response, body: await response.json() };
}

function rawRequest(url, options = {}) {
	return new Promise((resolve, reject) => {
		const target = new URL(url);
		const request = http.request({
			hostname: target.hostname,
			port: target.port,
			path: target.pathname + target.search,
			method: options.method || 'GET',
			headers: options.headers || {},
		}, (response) => {
			const chunks = [];
			response.on('data', (chunk) => chunks.push(chunk));
			response.on('end', () => {
				resolve({
					status: response.statusCode,
					headers: response.headers,
					body: Buffer.concat(chunks).toString('utf8'),
				});
			});
		});
		request.on('error', reject);
		if (options.body) {
			request.write(options.body);
		}
		request.end();
	});
}

test('OAuth discovery, pairing, PKCE exchange, and MCP bearer use form a complete local flow', async () => {
	const context = await startRuntime();
	const { runtime, endpoint, origin } = context;
	try {
		const unauthorized = await fetch(endpoint, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {},
			}),
		});
		assert.equal(unauthorized.status, 401);
		assert.equal(
			unauthorized.headers.get('www-authenticate'),
			`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="mcp"`
		);

		for (const metadataPath of [
			'/.well-known/oauth-protected-resource',
			'/.well-known/oauth-protected-resource/mcp',
		]) {
			const response = await fetch(`${origin}${metadataPath}`);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get('cache-control'), 'no-store');
			assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
			const metadata = await response.json();
			assert.equal(metadata.resource, endpoint);
			assert.deepEqual(metadata.authorization_servers, [origin]);
			assert.deepEqual(metadata.scopes_supported, ['mcp']);
		}
		const metadataResponse = await fetch(`${origin}/.well-known/oauth-authorization-server`);
		assert.equal(metadataResponse.status, 200);
		const metadata = await metadataResponse.json();
		assert.equal(metadata.issuer, origin);
		assert.equal(metadata.authorization_endpoint, `${origin}/oauth/authorize`);
		assert.equal(metadata.token_endpoint, `${origin}/oauth/token`);
		assert.equal(metadata.registration_endpoint, `${origin}/oauth/register`);
		assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
		assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none']);
		assert.equal(metadata.authorization_response_iss_parameter_supported, false);

		const registration = await registerClient(origin);
		assert.equal(registration.response.status, 201);
		assert.equal(registration.body.token_endpoint_auth_method, 'none');
		assert.deepEqual(registration.body.redirect_uris, [REDIRECT_URI]);
		assert.ok(registration.body.client_id);

		const flow = await completeAuthorization({
			runtime,
			endpoint,
			origin,
			clientId: registration.body.client_id,
		});
		const token = await exchangeCode(origin, {
			grant_type: 'authorization_code',
			code: flow.code,
			client_id: registration.body.client_id,
			redirect_uri: REDIRECT_URI,
			code_verifier: VERIFIER,
			resource: endpoint,
		});
		assert.equal(token.response.status, 200);
		assert.deepEqual(token.body, {
			access_token: SERVICE_TOKEN,
			token_type: 'Bearer',
			scope: 'mcp',
		});
		assert.equal('expires_in' in token.body, false);
		assert.equal('refresh_token' in token.body, false);

		const initialized = await fetch(endpoint, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${token.body.access_token}`,
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-06-18',
					capabilities: {},
					clientInfo: { name: 'Codex OAuth test', version: '1.0.0' },
				},
			}),
		});
		assert.equal(initialized.status, 200);
		assert.ok(initialized.headers.get('mcp-session-id'));

		const replayedCode = await exchangeCode(origin, {
			grant_type: 'authorization_code',
			code: flow.code,
			client_id: registration.body.client_id,
			redirect_uri: REDIRECT_URI,
			code_verifier: VERIFIER,
			resource: endpoint,
		});
		assert.equal(replayedCode.response.status, 400);
		assert.equal(replayedCode.body.error, 'invalid_grant');

		const replayedTicket = await verifyPairing({
			origin,
			params: flow.params,
			code: flow.ticket.code,
		});
		assert.equal(replayedTicket.response.status, 400);
		assert.equal(runtime.getPairingTicketStatus(flow.ticket.id)?.state, 'authorized');

		const serialized = JSON.stringify(runtime);
		assert.equal(serialized.includes(SERVICE_TOKEN), false);
		assert.equal(serialized.includes(flow.ticket.code), false);
	} finally {
		await runtime.stop();
	}
});

test('authorization rejects wrong Origin, redirect, resource, Host, and oversized bodies', async () => {
	const { runtime, endpoint, origin } = await startRuntime();
	try {
		const registration = await registerClient(origin);
		const ticket = runtime.issuePairingTicket('gemini');
		const params = authorizationParams(registration.body.client_id, endpoint);

		const wrongOrigin = await verifyPairing({
			origin,
			params,
			code: ticket.code,
			originHeader: 'http://127.0.0.1:9999',
		});
		assert.equal(wrongOrigin.response.status, 403);
		assert.equal(runtime.getPairingTicketStatus(ticket.id)?.state, 'pending');

		const missingOrigin = await fetch(`${origin}/oauth/authorize`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: formBody({
				...params,
				action: 'verify',
				pairing_code: ticket.code,
			}),
		});
		assert.equal(missingOrigin.status, 403);
		assert.equal(runtime.getPairingTicketStatus(ticket.id)?.state, 'pending');

		const wrongRedirect = await fetch(authorizationUrl(origin, {
			...params,
			redirect_uri: 'http://localhost:48765/callback',
		}));
		assert.equal(wrongRedirect.status, 400);
		const wrongResource = await fetch(authorizationUrl(origin, {
			...params,
			resource: `${origin}/not-mcp`,
		}));
		assert.equal(wrongResource.status, 400);
		const missingState = new URL(authorizationUrl(origin, params));
		missingState.searchParams.delete('state');
		assert.equal((await fetch(missingState)).status, 400);

		const forbiddenHost = await rawRequest(`${origin}/.well-known/oauth-authorization-server`, {
			headers: { host: 'attacker.example' },
		});
		assert.equal(forbiddenHost.status, 403);
		assert.match(forbiddenHost.body, /Forbidden host/u);

		const oversized = await rawRequest(`${origin}/oauth/register`, {
			method: 'POST',
			headers: {
				host: new URL(origin).host,
				'content-type': 'application/json',
				'content-length': String(20 * 1024),
			},
			body: 'x'.repeat(20 * 1024),
		});
		assert.equal(oversized.status, 413);
		assert.equal(JSON.parse(oversized.body).error, 'invalid_request');

		const evilOriginMetadata = await fetch(`${origin}/.well-known/oauth-authorization-server`, {
			headers: { origin: 'https://attacker.example' },
		});
		assert.equal(evilOriginMetadata.status, 403);
		assert.equal(evilOriginMetadata.headers.get('access-control-allow-origin'), null);

		for (const credentialQuery of [
			`${origin}/.well-known/oauth-authorization-server?token=secret`,
			`${authorizationUrl(origin, params)}&pairing_code=${encodeURIComponent(ticket.code)}`,
			`${authorizationUrl(origin, params)}&ticket=legacy-ticket`,
		]) {
			const rejected = await fetch(credentialQuery);
			assert.equal(rejected.status, 400);
			const body = await rejected.text();
			assert.match(body, /native MCP OAuth flow/u);
			assert.doesNotMatch(body, /Authorization Bearer header/u);
			assert.equal(body.includes(ticket.code), false);
		}
	} finally {
		await runtime.stop();
	}
});

test('DCR only accepts public clients with exact loopback redirects', async () => {
	const { runtime, origin } = await startRuntime();
	try {
		for (const overrides of [
			{ redirect_uris: ['https://example.com/callback'] },
			{ redirect_uris: ['http://127.0.0.1:48765/callback#fragment'] },
			{ redirect_uris: ['custom-agent://callback'] },
			{ token_endpoint_auth_method: 'client_secret_basic' },
			{ grant_types: ['client_credentials'] },
			{ grant_types: ['refresh_token'] },
			{ grant_types: ['authorization_code', 'authorization_code'] },
			{ grant_types: ['authorization_code', 'client_credentials'] },
			{ response_types: ['token'] },
		]) {
			const registration = await registerClient(origin, overrides);
			assert.equal(registration.response.status, 400);
			assert.equal(registration.body.error, 'invalid_client_metadata');
		}
		for (const redirectUri of [
			'http://localhost:48765/callback',
			'http://127.0.0.1:48765/callback',
			'http://[::1]:48765/callback',
		]) {
			const registration = await registerClient(origin, {
				redirect_uris: [redirectUri],
			});
			assert.equal(registration.response.status, 201);
			assert.equal(registration.body.redirect_uris[0], redirectUri);
		}
		const codexRegistration = await registerClient(origin, {
			grant_types: ['authorization_code', 'refresh_token'],
		});
		assert.equal(codexRegistration.response.status, 201);
		assert.deepEqual(codexRegistration.body.grant_types, ['authorization_code']);
	} finally {
		await runtime.stop();
	}
});

test('DCR registration capacity is bounded without evicting an active client', async () => {
	const { runtime, origin } = await startRuntime({
		clientRegistrationCapacity: 1,
	});
	try {
		const first = await registerClient(origin);
		assert.equal(first.response.status, 201);
		const second = await registerClient(origin, {
			client_name: 'Second local client',
		});
		assert.equal(second.response.status, 429);
		assert.equal(second.body.error, 'temporarily_unavailable');
		const params = authorizationParams(first.body.client_id, `${origin}/mcp`);
		assert.equal((await fetch(authorizationUrl(origin, params))).status, 200);
	} finally {
		await runtime.stop();
	}
});

test('wrong PKCE, binding mismatch, and callback mismatch fail closed and consume the code', async () => {
	const first = await startRuntime();
	try {
		const registration = await registerClient(first.origin);
		const flow = await completeAuthorization({
			...first,
			clientId: registration.body.client_id,
			expectedClientId: 'claude-code',
		});
		const wrongPkce = await exchangeCode(first.origin, {
			grant_type: 'authorization_code',
			code: flow.code,
			client_id: registration.body.client_id,
			redirect_uri: REDIRECT_URI,
			code_verifier: `${VERIFIER.slice(0, -1)}X`,
			resource: first.endpoint,
		});
		assert.equal(wrongPkce.response.status, 400);
		assert.equal(wrongPkce.body.error, 'invalid_grant');
		const retry = await exchangeCode(first.origin, {
			grant_type: 'authorization_code',
			code: flow.code,
			client_id: registration.body.client_id,
			redirect_uri: REDIRECT_URI,
			code_verifier: VERIFIER,
			resource: first.endpoint,
		});
		assert.equal(retry.response.status, 400);

		const secondFlow = await completeAuthorization({
			...first,
			clientId: registration.body.client_id,
			expectedClientId: 'cursor',
		});
		const wrongResource = await exchangeCode(first.origin, {
			grant_type: 'authorization_code',
			code: secondFlow.code,
			client_id: registration.body.client_id,
			redirect_uri: REDIRECT_URI,
			code_verifier: VERIFIER,
			resource: `${first.origin}/wrong-resource`,
		});
		assert.equal(wrongResource.response.status, 400);
		assert.equal(wrongResource.body.error, 'invalid_grant');
	} finally {
		await first.runtime.stop();
	}

	const mismatch = await startRuntime({
		getSharedBearerToken: () => WRONG_SERVICE_TOKEN,
	});
	try {
		const registration = await registerClient(mismatch.origin);
		const flow = await completeAuthorization({
			...mismatch,
			clientId: registration.body.client_id,
			expectedClientId: 'grok',
		});
		const exchange = await exchangeCode(mismatch.origin, {
			grant_type: 'authorization_code',
			code: flow.code,
			client_id: registration.body.client_id,
			redirect_uri: REDIRECT_URI,
			code_verifier: VERIFIER,
			resource: mismatch.endpoint,
		});
		assert.equal(exchange.response.status, 500);
		assert.equal(exchange.body.error, 'server_error');
		assert.equal(JSON.stringify(exchange.body).includes(WRONG_SERVICE_TOKEN), false);
	} finally {
		await mismatch.runtime.stop();
	}
});

test('pairing tickets are grouped 80-bit codes with bounded lifetime, attempts, capacity, and stop cleanup', async () => {
	const expiringContext = await startRuntime({
		pairingTicketTtlMs: 30,
	});
	try {
		const expiring = expiringContext.runtime.issuePairingTicket('zcode');
		assert.match(expiring.code, /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/u);
		assert.equal(expiring.code.replaceAll('-', '').length, 16);
		await new Promise((resolve) => setTimeout(resolve, 60));
		assert.equal(
			expiringContext.runtime.getPairingTicketStatus(expiring.id)?.state,
			'expired'
		);
	} finally {
		await expiringContext.runtime.stop();
	}

	const context = await startRuntime({
		pairingTicketCapacity: 3,
		pairingTicketMaxAttempts: 2,
	});
	const { runtime, endpoint, origin } = context;
	try {
		assert.throws(() => runtime.issuePairingTicket(''), /expectedClientId/u);
		assert.throws(() => runtime.issuePairingTicket('agent id'), /expectedClientId/u);

		const registration = await registerClient(origin);
		const attempted = runtime.issuePairingTicket('gemini');
		const params = authorizationParams(registration.body.client_id, endpoint);
		const wrongCode = wrongPairingCodeFor(attempted.code);
		for (const attemptsRemaining of [1, 0]) {
			const rejected = await verifyPairing({
				origin,
				params,
				code: wrongCode,
			});
			assert.equal(rejected.response.status, 400);
			assert.equal(
				runtime.getPairingTicketStatus(attempted.id)?.attemptsRemaining,
				attemptsRemaining
			);
		}
		assert.equal(
			runtime.getPairingTicketStatus(attempted.id)?.state,
			'attempts_exhausted'
		);

		const tickets = [
			runtime.issuePairingTicket('codex'),
			runtime.issuePairingTicket('cursor'),
			runtime.issuePairingTicket('grok'),
		];
		assert.throws(
			() => runtime.issuePairingTicket('claude-code'),
			/At most 3 active pairing tickets/u
		);
		const pendingId = tickets[0].id;
		await runtime.stop();
		assert.equal(runtime.getPairingTicketStatus(pendingId), null);
	} finally {
		await runtime.stop();
	}
});

test('a wrong pairing code only consumes attempts from its located ticket', async () => {
	const context = await startRuntime({
		pairingTicketCapacity: 3,
		pairingTicketMaxAttempts: 2,
	});
	const { runtime, endpoint, origin } = context;
	try {
		const registration = await registerClient(origin);
		const params = authorizationParams(registration.body.client_id, endpoint);
		const first = runtime.issuePairingTicket('codex');
		const second = runtime.issuePairingTicket('gemini');

		const unrelated = await verifyPairing({
			origin,
			params,
			code: pairingCodeWithUnrelatedLocator(first.code, second.code),
		});
		assert.equal(unrelated.response.status, 400);
		assert.equal(runtime.getPairingTicketStatus(first.id)?.attemptsRemaining, 2);
		assert.equal(runtime.getPairingTicketStatus(second.id)?.attemptsRemaining, 2);

		const located = await verifyPairing({
			origin,
			params,
			code: wrongPairingCodeFor(first.code),
		});
		assert.equal(located.response.status, 400);
		assert.equal(located.html, unrelated.html);
		assert.equal(runtime.getPairingTicketStatus(first.id)?.attemptsRemaining, 1);
		assert.equal(runtime.getPairingTicketStatus(second.id)?.attemptsRemaining, 2);

		const secondVerified = await verifyPairing({
			origin,
			params,
			code: second.code,
		});
		assert.equal(secondVerified.response.status, 200);
		assert.equal(runtime.getPairingTicketStatus(first.id)?.state, 'pending');
		assert.equal(
			runtime.getPairingTicketStatus(second.id)?.state,
			'awaiting_confirmation'
		);
	} finally {
		await runtime.stop();
	}
});

test('concurrent pairing verification and approval are single-winner and replay safe', async () => {
	const context = await startRuntime();
	const { runtime, endpoint, origin } = context;
	try {
		const registration = await registerClient(origin);
		const ticket = runtime.issuePairingTicket('codex');
		const params = authorizationParams(registration.body.client_id, endpoint);
		const verificationResults = await Promise.all([
			verifyPairing({ origin, params, code: ticket.code }),
			verifyPairing({ origin, params, code: ticket.code }),
		]);
		assert.deepEqual(
			verificationResults.map(({ response }) => response.status).sort(),
			[200, 400]
		);
		const winningVerification = verificationResults.find(
			({ response }) => response.status === 200
		);
		assert.ok(winningVerification);
		const approvalId = extractHiddenInput(winningVerification.html, 'approval_id');
		assert.equal(
			runtime.getPairingTicketStatus(ticket.id)?.state,
			'awaiting_confirmation'
		);

		const approvalResults = await Promise.all([
			approvePairing(origin, approvalId),
			approvePairing(origin, approvalId),
		]);
		assert.deepEqual(
			approvalResults.map((response) => response.status).sort(),
			[303, 400]
		);
		assert.equal(runtime.getPairingTicketStatus(ticket.id)?.state, 'authorized');

		const replayedPairing = await verifyPairing({
			origin,
			params,
			code: ticket.code,
		});
		assert.equal(replayedPairing.response.status, 400);
		assert.equal((await approvePairing(origin, approvalId)).status, 400);
	} finally {
		await runtime.stop();
	}
});

test('authorization codes expire and approval handles cannot be replayed', async () => {
	const context = await startRuntime({
		authorizationCodeTtlMs: 200,
	});
	const { runtime, endpoint, origin } = context;
	try {
		const registration = await registerClient(origin);
		const ticket = runtime.issuePairingTicket('codex');
		const params = authorizationParams(registration.body.client_id, endpoint);
		const verified = await verifyPairing({
			origin,
			params,
			code: ticket.code,
		});
		const approvalId = extractHiddenInput(verified.html, 'approval_id');
		const approved = await approvePairing(origin, approvalId);
		assert.equal(approved.status, 303);
		const replayedApproval = await approvePairing(origin, approvalId);
		assert.equal(replayedApproval.status, 400);
		const code = new URL(approved.headers.get('location')).searchParams.get('code');
		await new Promise((resolve) => setTimeout(resolve, 250));
		const expired = await exchangeCode(origin, {
			grant_type: 'authorization_code',
			code,
			client_id: registration.body.client_id,
			redirect_uri: REDIRECT_URI,
			code_verifier: VERIFIER,
			resource: endpoint,
		});
		assert.equal(expired.response.status, 400);
		assert.equal(expired.body.error, 'invalid_grant');
	} finally {
		await runtime.stop();
	}
});

test('authorization code capacity evicts the oldest unredeemed code', async () => {
	const context = await startRuntime({
		authorizationCodeCapacity: 1,
	});
	const { runtime, endpoint, origin } = context;
	try {
		const registration = await registerClient(origin);
		const oldest = await completeAuthorization({
			...context,
			clientId: registration.body.client_id,
			expectedClientId: 'codex',
		});
		const newest = await completeAuthorization({
			...context,
			clientId: registration.body.client_id,
			expectedClientId: 'gemini',
		});
		const evicted = await exchangeCode(origin, {
			grant_type: 'authorization_code',
			code: oldest.code,
			client_id: registration.body.client_id,
			redirect_uri: REDIRECT_URI,
			code_verifier: VERIFIER,
			resource: endpoint,
		});
		assert.equal(evicted.response.status, 400);
		assert.equal(evicted.body.error, 'invalid_grant');
		const accepted = await exchangeCode(origin, {
			grant_type: 'authorization_code',
			code: newest.code,
			client_id: registration.body.client_id,
			redirect_uri: REDIRECT_URI,
			code_verifier: VERIFIER,
			resource: endpoint,
		});
		assert.equal(accepted.response.status, 200);
		assert.equal(accepted.body.access_token, SERVICE_TOKEN);
	} finally {
		await runtime.stop();
	}
});
