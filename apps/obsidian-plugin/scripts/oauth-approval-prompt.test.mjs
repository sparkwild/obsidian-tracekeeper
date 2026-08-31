#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-oauth-prompt-'));
const output = path.join(tempDirectory, 'oauth-pending.mjs');

try {
	await build({
		entryPoints: [path.resolve('src/features/client-config/oauth-pending.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const { canRoutePendingOAuthRequestToIntegration } = await import(
		`${pathToFileURL(output).href}?t=${Date.now()}`
	);

	const now = Date.now();
	const integration = (integrationId, overrides = {}) => ({
		integrationId,
		authMode: 'oauth',
		credential: null,
		oauthClient: null,
		...overrides,
	});
	const request = {
		requestId: 'request-1',
		clientId: 'oauth-client-new',
		clientNameClaim: 'Codex',
		redirectUri: 'http://127.0.0.1/callback',
		resource: 'http://127.0.0.1:51601/mcp',
		scope: 'mcp',
		issuedAt: now,
		expiresAt: now + 5 * 60 * 1000,
	};
	const codex = integration('integration-codex');
	const claude = integration('integration-claude');

	assert.equal(
		canRoutePendingOAuthRequestToIntegration(codex.integrationId, [codex, claude], request, now),
		true
	);
	assert.equal(
		canRoutePendingOAuthRequestToIntegration(
			codex.integrationId,
			[codex, claude],
			{ ...request, clientNameClaim: 'Untrusted different label' },
			now
		),
		true
	);

	const boundCodex = integration('integration-codex', {
		credential: { credentialId: 'credential-codex' },
		oauthClient: { clientId: request.clientId },
	});
	assert.equal(
		canRoutePendingOAuthRequestToIntegration(
			boundCodex.integrationId,
			[boundCodex, claude],
			request,
			now
		),
		true
	);
	assert.equal(
		canRoutePendingOAuthRequestToIntegration(
			claude.integrationId,
			[boundCodex, claude],
			request,
			now
		),
		false
	);

	const duplicateOwner = integration('integration-duplicate', {
		oauthClient: { clientId: request.clientId },
	});
	assert.equal(
		canRoutePendingOAuthRequestToIntegration(
			boundCodex.integrationId,
			[boundCodex, duplicateOwner],
			request,
			now
		),
		false
	);
	assert.equal(canRoutePendingOAuthRequestToIntegration('', [codex], request, now), false);
	assert.equal(
		canRoutePendingOAuthRequestToIntegration(
			codex.integrationId,
			[codex],
			{ ...request, expiresAt: now },
			now
		),
		false
	);

	const mainSource = fs.readFileSync('src/main.ts', 'utf8');
	const modalSource = fs.readFileSync('src/features/client-config/client-config-modals.ts', 'utf8');
	const settingsSource = fs.readFileSync('src/features/settings/tracekeeper-setting-tab.ts', 'utf8');
	const runtimeSource = fs.readFileSync('../../packages/mcp-runtime/src/local-oauth.ts', 'utf8');
	assert.doesNotMatch(mainSource, /OAuthApprovalModal|OAuthApprovalPromptQueue|oauthApprovalPromptQueue/);
	assert.equal(fs.existsSync('src/features/client-config/oauth-approval-modal.ts'), false);
	assert.equal(fs.existsSync('src/features/client-config/oauth-approval-prompt-queue.ts'), false);
	assert.match(mainSource, /registerOAuthApprovalContext/);
	assert.match(mainSource, /private oauthApprovalContext:/);
	assert.doesNotMatch(mainSource, /oauthApprovalContexts/);
	assert.match(mainSource, /routePendingOAuthRequest\(request\)/);
	assert.match(mainSource, /hasAnotherRequest[\s\S]*return 'busy'/);
	assert.match(mainSource, /routeStatus !== 'routed'[\s\S]*pendingOAuthDecisions\.set\(request\.requestId, \{ decision: 'deny' \}\)/);
	assert.match(mainSource, /收到 MCP 授权请求，请在当前 Agent 配置顶部确认/);
	assert.match(mainSource, /已有授权请求正在处理，新的请求已拒绝/);
	assert.match(mainSource, /授权请求没有对应的当前 Agent 配置，已拒绝/);
	assert.match(modalSource, /this\.selectedUnboundRequestId = requestId/);
	assert.match(modalSource, /this\.plugin\.registerOAuthApprovalContext/);
	assert.match(modalSource, /pending\?\.querySelector<HTMLButtonElement>\('button\.mod-cta'\)\?\.focus\(\)/);
	assert.doesNotMatch(settingsSource, /选择 Agent|Select Agent/);
	assert.match(settingsSource, /未匹配的 OAuth 请求/);
	assert.match(settingsSource, /不会绑定到任何 Agent/);
	const modalDecision = modalSource.slice(
		modalSource.indexOf('private async decide'),
		modalSource.indexOf('private async refreshSettings')
	);
	assert.match(modalDecision, /new Notice\(reportUiFailure\(error/);
	assert.match(modalDecision, /zh: '无法更新 OAuth 审批。'/);
	assert.match(modalDecision, /en: 'Unable to update OAuth approval.'/);
	const settingsDecision = settingsSource.slice(
		settingsSource.indexOf('private async denyPendingOAuthRequest'),
		settingsSource.indexOf('private renderConnectionInfoSection')
	);
	assert.match(settingsDecision, /new Notice\(reportUiFailure\(error/);
	assert.match(settingsDecision, /zh: '无法拒绝 OAuth 请求。'/);
	assert.match(settingsDecision, /en: 'Unable to deny the OAuth request.'/);
	assert.doesNotMatch(`${modalDecision}\n${settingsDecision}`, /error\.message/);
	const renderPanel = modalSource.slice(
		modalSource.indexOf('private renderPanel'),
		modalSource.indexOf('private syncOAuthApprovalContext')
	);
	assert.ok(renderPanel.indexOf('this.renderAuthorization(container)') < renderPanel.indexOf('this.renderSetup(container)'));
	assert.match(runtimeSource, /const DEFAULT_PENDING_TTL_MS = 5 \* 60 \* 1000;/);
} finally {
	fs.rmSync(tempDirectory, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 34 })}\n`);
