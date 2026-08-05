import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import {
  LOCAL_TRUST_CAPABILITIES,
  StreamableHttpMcpRuntime,
} from '../dist/index.js';

const securitySecret = crypto.randomBytes(32).toString('base64url');
const accessTokens = new Map();
const pending = new Map();
const decisions = new Map();

function credentialContext(token) {
  const entry = accessTokens.get(token);
  return entry ? {
    integrationId: entry.integrationId,
    credentialId: entry.credentialId,
    authMode: 'oauth',
    principalId: 'local-user',
    capabilities: LOCAL_TRUST_CAPABILITIES,
  } : null;
}

function request(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: {
        Host: `127.0.0.1:${port}`,
        ...(payload === undefined ? {} : { 'Content-Length': Buffer.byteLength(payload) }),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

test('OAuth uses explicit approval, PKCE/resource binding, and per-integration credentials', async (t) => {
  const integrationId = 'integration-codex';
  const runtime = new StreamableHttpMcpRuntime({
    localTrust: true,
    port: 0,
    credentialVerifier: { verifyBearer: async (token) => credentialContext(token) },
    writebackConfirmationSecret: securitySecret,
    oauthIntegration: {
      publishPendingRequest: async (requestValue) => pending.set(requestValue.requestId, requestValue),
      readDecision: async (requestId) => decisions.get(requestId) ?? null,
      issueOAuthCredential: async (input) => {
        accessTokens.set(input.accessToken, { integrationId: input.integrationId, credentialId: input.credentialId });
        return { integrationId: input.integrationId, credentialId: input.credentialId, accessToken: input.accessToken };
      },
      revokeOAuthCredential: async ({ token }) => accessTokens.delete(token),
    },
  });
  t.after(() => runtime.stop());
  const status = await runtime.start();
  const port = status.port;
  const resource = `http://127.0.0.1:${port}/mcp`;
  const redirectUri = 'http://127.0.0.1:43127/callback';
  const refreshOnlyRegistration = await request(port, 'POST', '/oauth/register', {
    client_name: 'Unsupported refresh-only client',
    redirect_uris: [redirectUri],
    grant_types: ['refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'mcp',
  }, { 'Content-Type': 'application/json' });
  assert.equal(refreshOnlyRegistration.status, 400);
  const unsupportedGrantRegistration = await request(port, 'POST', '/oauth/register', {
    client_name: 'Unsupported client credentials client',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'client_credentials'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'mcp',
  }, { 'Content-Type': 'application/json' });
  assert.equal(unsupportedGrantRegistration.status, 400);
  const registration = await request(port, 'POST', '/oauth/register', {
    client_name: 'Untrusted Codex claim',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'mcp',
  }, { 'Content-Type': 'application/json' });
  assert.equal(registration.status, 201);
  const registrationBody = JSON.parse(registration.body);
  assert.deepEqual(registrationBody.grant_types, ['authorization_code']);
  const clientId = registrationBody.client_id;
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const authorization = await request(port, 'GET', `/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=opaque-state&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(resource)}&scope=mcp`);
  assert.equal(authorization.status, 303);
  const waitUrl = new URL(authorization.headers.location);
  const requestId = waitUrl.searchParams.get('request_id');
  assert.ok(requestId);
  const waiting = await request(port, 'GET', `${waitUrl.pathname}${waitUrl.search}`);
  assert.equal(waiting.status, 200);
  assert.match(waiting.body, /waiting|等待/u);
  assert.doesNotMatch(waiting.body, /pairing|配对码|access_token|Allow|Deny/u);
  decisions.set(requestId, { decision: 'allow', integrationId });
  const approved = await request(port, 'GET', `${waitUrl.pathname}${waitUrl.search}`);
  assert.equal(approved.status, 303);
  const callback = new URL(approved.headers.location);
  const code = callback.searchParams.get('code');
  assert.ok(code);
  const tokenResponse = await request(port, 'POST', '/oauth/token', new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    resource,
    code_verifier: verifier,
  }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(tokenResponse.status, 200);
  const token = JSON.parse(tokenResponse.body).access_token;
  assert.ok(token);
  const initialize = await request(port, 'POST', '/mcp', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'Codex', version: 'test' }, capabilities: {} } }), { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
  assert.equal(initialize.status, 200);
  const sessionId = initialize.headers['mcp-session-id'];
  assert.ok(sessionId);
  const secondToken = crypto.randomBytes(32).toString('base64url');
  accessTokens.set(secondToken, { integrationId, credentialId: 'another-credential' });
  const mismatch = await request(port, 'POST', '/mcp', JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} }), { 'Content-Type': 'application/json', Authorization: `Bearer ${secondToken}`, 'Mcp-Session-Id': sessionId, 'MCP-Protocol-Version': '2025-06-18' });
  assert.equal(mismatch.status, 401);
  await request(port, 'POST', '/oauth/revoke', new URLSearchParams({ token }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(accessTokens.has(token), false);
});
