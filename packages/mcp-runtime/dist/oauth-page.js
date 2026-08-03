"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeOAuthUiLocale = normalizeOAuthUiLocale;
exports.oauthContentSecurityPolicy = oauthContentSecurityPolicy;
exports.renderOAuthPairingPage = renderOAuthPairingPage;
exports.renderOAuthConfirmationPage = renderOAuthConfirmationPage;
exports.renderOAuthErrorPage = renderOAuthErrorPage;
const node_crypto_1 = require("node:crypto");
const COPY = {
    'zh-CN': {
        localBadge: '本机安全连接',
        footer: '由 Tracekeeper 本机服务提供',
        clientLabel: '正在请求连接',
        requestingClientLabel: '正在请求连接的客户端',
        pairing: {
            title: '连接 Tracekeeper',
            lead: '输入 Obsidian 中显示的配对码，继续核对本次连接。',
            codeLabel: '配对码',
            codeHint: '在 Obsidian 的 Tracekeeper 设置中查看',
            codeDescription: '配对码仅在本机核对，不会写入连接命令或网址。',
            cta: '继续核对',
        },
        confirmation: {
            title: '确认连接',
            lead: '核对以下信息后，再允许此 Agent 使用 Tracekeeper。',
            expectedAgentLabel: '你在 Obsidian 中选择的 Agent',
            requestingClientLabel: '正在请求连接的客户端',
            warning: '客户端名称由对方自行报告。仅在两项信息符合预期时继续。',
            cta: '确认并连接',
            footer: '确认后将返回 Agent 完成连接。',
        },
        error: {
            footer: '请关闭此页面，然后返回 Agent 重新开始连接。',
            states: {
                invalid_request: {
                    title: '连接请求有问题',
                    message: '请返回 Agent，重新开始连接。',
                },
                invalid_client: {
                    title: '连接请求已失效',
                    message: '请返回 Agent，重新发起连接。',
                },
                invalid_pairing_code: {
                    title: '配对码无效',
                    message: '请回到 Obsidian 核对配对码，或生成新的配对码后重试。',
                },
                confirmation_expired: {
                    title: '确认已超时',
                    message: '请返回 Agent，重新开始连接。',
                },
                pairing_expired: {
                    title: '配对码已失效',
                    message: '请在 Obsidian 中生成新的配对码，再从 Agent 重新开始。',
                },
            },
        },
    },
    en: {
        localBadge: 'Secure local connection',
        footer: 'Provided by the Tracekeeper service on this device',
        clientLabel: 'Requesting client',
        requestingClientLabel: 'Client requesting access',
        pairing: {
            title: 'Connect Tracekeeper',
            lead: 'Enter the pairing code shown in Obsidian to verify this connection.',
            codeLabel: 'Pairing code',
            codeHint: 'Find it in Tracekeeper settings in Obsidian',
            codeDescription: 'The pairing code is checked only on this device and is never added to commands or URLs.',
            cta: 'Continue',
        },
        confirmation: {
            title: 'Confirm connection',
            lead: 'Check the details below before allowing this agent to use Tracekeeper.',
            expectedAgentLabel: 'Agent selected in Obsidian',
            requestingClientLabel: 'Client requesting access',
            warning: 'The client name is self-reported. Continue only when both details match what you expect.',
            cta: 'Confirm and connect',
            footer: 'After confirmation, you will return to the agent to finish connecting.',
        },
        error: {
            footer: 'Close this page, then return to your agent and start again.',
            states: {
                invalid_request: {
                    title: 'There is a problem with this request',
                    message: 'Return to your agent and start the connection again.',
                },
                invalid_client: {
                    title: 'This connection request is no longer valid',
                    message: 'Return to your agent and start a new connection.',
                },
                invalid_pairing_code: {
                    title: 'The pairing code is invalid',
                    message: 'Return to Obsidian to check the code, or generate a new one and try again.',
                },
                confirmation_expired: {
                    title: 'Confirmation timed out',
                    message: 'Return to your agent and start the connection again.',
                },
                pairing_expired: {
                    title: 'The pairing code has expired',
                    message: 'Generate a new pairing code in Obsidian, then start again from your agent.',
                },
            },
        },
    },
};
const OAUTH_PAGE_CSS = `
:root {
	color-scheme: light dark;
	--oauth-bg: #f7f7fb;
	--oauth-card: #ffffff;
	--oauth-text: #202027;
	--oauth-muted: #686875;
	--oauth-border: rgba(39, 39, 52, 0.14);
	--oauth-soft: rgba(124, 58, 237, 0.08);
	--oauth-primary: #7c3aed;
	--oauth-primary-hover: #6d28d9;
	--oauth-warning-bg: #fff7e6;
	--oauth-warning-border: #e6a52f;
	--oauth-warning-text: #72500b;
	--oauth-error-bg: #fff1f2;
	--oauth-error-border: #d14343;
	--oauth-error-text: #8d2020;
}

@media (prefers-color-scheme: dark) {
	:root {
		--oauth-bg: #121216;
		--oauth-card: #1c1c22;
		--oauth-text: #f4f3f7;
		--oauth-muted: #aaa8b5;
		--oauth-border: rgba(255, 255, 255, 0.14);
		--oauth-soft: rgba(167, 139, 250, 0.14);
		--oauth-primary: #a78bfa;
		--oauth-primary-hover: #c4b5fd;
		--oauth-warning-bg: #322914;
		--oauth-warning-border: #e6a52f;
		--oauth-warning-text: #f5d991;
		--oauth-error-bg: #351b20;
		--oauth-error-border: #f07878;
		--oauth-error-text: #ffb4b4;
	}
}

* {
	box-sizing: border-box;
}

html,
body {
	min-width: 320px;
	min-height: 100%;
	margin: 0;
}

body {
	min-height: 100vh;
	background: var(--oauth-bg);
	color: var(--oauth-text);
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	font-size: 16px;
	line-height: 1.5;
}

button,
input {
	font: inherit;
}

button {
	cursor: pointer;
}

.oauth-page {
	display: grid;
	min-height: 100vh;
	place-items: center;
	padding: 32px 16px;
}

.oauth-page__inner {
	width: min(480px, 100%);
}

.oauth-brand {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 10px;
	margin-bottom: 18px;
	font-size: 18px;
	font-weight: 650;
	letter-spacing: -0.01em;
}

.oauth-brand-mark {
	width: 32px;
	height: 32px;
	color: var(--oauth-primary);
}

.oauth-card {
	border: 1px solid var(--oauth-border);
	border-radius: 20px;
	background: var(--oauth-card);
	box-shadow: 0 18px 48px rgba(33, 28, 52, 0.12);
	padding: 32px;
}

.oauth-badge {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	margin-bottom: 20px;
	border: 1px solid var(--oauth-border);
	border-radius: 999px;
	background: var(--oauth-soft);
	color: var(--oauth-primary);
	font-size: 13px;
	font-weight: 650;
	line-height: 1;
	padding: 9px 12px;
}

.oauth-badge::before {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: currentColor;
	content: "";
}

.oauth-card h1 {
	margin: 0;
	font-size: clamp(28px, 6vw, 36px);
	letter-spacing: -0.035em;
	line-height: 1.12;
}

.oauth-lead {
	margin: 14px 0 24px;
	color: var(--oauth-muted);
}

.oauth-client-summary {
	display: grid;
	gap: 3px;
	margin-bottom: 24px;
	border: 1px solid var(--oauth-border);
	border-radius: 12px;
	background: var(--oauth-soft);
	padding: 13px 14px;
}

.oauth-client-summary__label,
.oauth-detail dt {
	color: var(--oauth-muted);
	font-size: 12px;
	font-weight: 650;
	letter-spacing: 0.02em;
}

.oauth-client-summary strong,
.oauth-detail dd {
	overflow-wrap: anywhere;
	font-weight: 650;
}

.oauth-form {
	display: grid;
	gap: 18px;
}

.oauth-field {
	display: grid;
	gap: 8px;
}

.oauth-field label {
	font-size: 14px;
	font-weight: 650;
}

.oauth-field input {
	width: 100%;
	min-height: 48px;
	border: 1px solid var(--oauth-border);
	border-radius: 10px;
	background: transparent;
	color: var(--oauth-text);
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 17px;
	letter-spacing: 0.08em;
	padding: 11px 13px;
}

.oauth-field input::placeholder {
	color: var(--oauth-muted);
}

.oauth-field input:focus-visible,
.oauth-form button:focus-visible {
	outline: 3px solid rgba(124, 58, 237, 0.35);
	outline-offset: 2px;
}

.oauth-field__hint,
.oauth-note,
.oauth-footer {
	color: var(--oauth-muted);
	font-size: 13px;
}

.oauth-field__hint,
.oauth-note {
	margin: 0;
}

.oauth-form button {
	min-height: 46px;
	border: 0;
	border-radius: 10px;
	background: var(--oauth-primary);
	color: #ffffff;
	font-weight: 700;
	padding: 10px 18px;
}

.oauth-form button:hover {
	background: var(--oauth-primary-hover);
}

.oauth-note {
	display: flex;
	gap: 8px;
	margin-top: 22px;
	border-top: 1px solid var(--oauth-border);
	padding-top: 18px;
}

.oauth-note::before {
	flex: 0 0 auto;
	width: 16px;
	height: 16px;
	margin-top: 2px;
	border: 1px solid currentColor;
	border-radius: 50%;
	content: "i";
	font-size: 11px;
	font-weight: 700;
	line-height: 14px;
	text-align: center;
}

.oauth-details {
	display: grid;
	gap: 12px;
	margin: 0 0 22px;
}

.oauth-detail {
	display: grid;
	gap: 3px;
	border-bottom: 1px solid var(--oauth-border);
	padding-bottom: 12px;
}

.oauth-detail:last-child {
	border-bottom: 0;
	padding-bottom: 0;
}

.oauth-detail dt,
.oauth-detail dd {
	margin: 0;
}

.oauth-warning,
.oauth-error {
	margin: 0 0 22px;
	border: 1px solid;
	border-radius: 12px;
	padding: 13px 14px;
}

.oauth-warning {
	border-color: var(--oauth-warning-border);
	background: var(--oauth-warning-bg);
	color: var(--oauth-warning-text);
	font-size: 14px;
}

.oauth-error {
	border-color: var(--oauth-error-border);
	background: var(--oauth-error-bg);
	color: var(--oauth-error-text);
}

.oauth-error h1 {
	color: var(--oauth-text);
}

.oauth-error p {
	margin: 14px 0 0;
}

.oauth-state-icon {
	display: grid;
	width: 44px;
	height: 44px;
	margin-bottom: 18px;
	place-items: center;
	border: 1px solid var(--oauth-error-border);
	border-radius: 50%;
	color: var(--oauth-error-text);
	font-size: 23px;
	font-weight: 700;
}

.oauth-footer {
	margin: 16px 0 0;
	text-align: center;
}

@media (max-width: 520px) {
	.oauth-page {
		padding: 24px 12px;
	}

	.oauth-card {
		padding: 24px;
	}
}

@media (max-width: 360px) {
	.oauth-page {
		padding: 16px 8px;
	}

	.oauth-card {
		padding: 20px 16px;
	}
}
`;
const OAUTH_PAGE_STYLE_HASH = (0, node_crypto_1.createHash)('sha256')
    .update(OAUTH_PAGE_CSS, 'utf8')
    .digest('base64');
function normalizeOAuthUiLocale(value) {
    return value === 'en' ? 'en' : 'zh-CN';
}
function oauthContentSecurityPolicy(callbackOrigin) {
    return [
        "default-src 'none'",
        "base-uri 'none'",
        `style-src 'sha256-${OAUTH_PAGE_STYLE_HASH}'`,
        `form-action 'self'${callbackOrigin ? ` ${callbackOrigin}` : ''}`,
        "frame-ancestors 'none'",
    ].join('; ');
}
function renderOAuthPairingPage(locale, model) {
    const copy = COPY[locale];
    return pageShell(locale, copy.pairing.title, `<section class="oauth-card" aria-labelledby="oauth-page-title">
<div class="oauth-badge">${escapeHtml(copy.localBadge)}</div>
<h1 id="oauth-page-title">${escapeHtml(copy.pairing.title)}</h1>
<p class="oauth-lead">${escapeHtml(copy.pairing.lead)}</p>
<div class="oauth-client-summary">
<span class="oauth-client-summary__label">${escapeHtml(copy.clientLabel)}</span>
<strong>${escapeHtml(model.clientName)}</strong>
</div>
<form class="oauth-form" method="post" action="${escapeHtml(model.actionUrl)}">
${renderHiddenInputs(model.hiddenFields)}
<input type="hidden" name="action" value="verify" />
<div class="oauth-field">
<label for="pairing-code">${escapeHtml(copy.pairing.codeLabel)}</label>
<input id="pairing-code" name="pairing_code" inputmode="text" autocomplete="one-time-code" spellcheck="false" required aria-describedby="pairing-code-hint" />
<p id="pairing-code-hint" class="oauth-field__hint">${escapeHtml(copy.pairing.codeHint)}</p>
</div>
<button type="submit">${escapeHtml(copy.pairing.cta)}</button>
</form>
<p class="oauth-note">${escapeHtml(copy.pairing.codeDescription)}</p>
</section>`);
}
function renderOAuthConfirmationPage(locale, model) {
    const copy = COPY[locale];
    return pageShell(locale, copy.confirmation.title, `<section class="oauth-card" aria-labelledby="oauth-page-title">
<div class="oauth-badge">${escapeHtml(copy.localBadge)}</div>
<h1 id="oauth-page-title">${escapeHtml(copy.confirmation.title)}</h1>
<p class="oauth-lead">${escapeHtml(copy.confirmation.lead)}</p>
<dl class="oauth-details">
<div class="oauth-detail">
<dt>${escapeHtml(copy.confirmation.expectedAgentLabel)}</dt>
<dd>${escapeHtml(model.expectedClientId)}</dd>
</div>
<div class="oauth-detail">
<dt>${escapeHtml(copy.confirmation.requestingClientLabel)}</dt>
<dd>${escapeHtml(model.clientName)}</dd>
</div>
</dl>
<p class="oauth-warning" role="note">${escapeHtml(copy.confirmation.warning)}</p>
<form class="oauth-form" method="post" action="${escapeHtml(model.actionUrl)}">
${renderHiddenInputs(model.hiddenFields)}
<button type="submit">${escapeHtml(copy.confirmation.cta)}</button>
</form>
<p class="oauth-note">${escapeHtml(copy.confirmation.footer)}</p>
</section>`);
}
function renderOAuthErrorPage(locale, kind) {
    const copy = COPY[locale];
    const state = copy.error.states[kind];
    return pageShell(locale, state.title, `<section class="oauth-card oauth-error" role="alert" aria-labelledby="oauth-page-title">
<div class="oauth-state-icon" aria-hidden="true">!</div>
<h1 id="oauth-page-title">${escapeHtml(state.title)}</h1>
<p>${escapeHtml(state.message)}</p>
<p class="oauth-note">${escapeHtml(copy.error.footer)}</p>
</section>`);
}
function pageShell(locale, title, card) {
    const copy = COPY[locale];
    return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${escapeHtml(title)}</title>
<style>${OAUTH_PAGE_CSS}</style>
</head>
<body>
<main class="oauth-page">
<div class="oauth-page__inner">
<header class="oauth-brand">
<svg class="oauth-brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
<circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="2" />
<circle cx="16" cy="16" r="4" fill="currentColor" />
<path d="M5 16h5M22 16h5M16 5v5M16 22v5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
</svg>
<span>Tracekeeper</span>
</header>
${card}
<p class="oauth-footer">${escapeHtml(copy.footer)}</p>
</div>
</main>
</body>
</html>`;
}
function renderHiddenInputs(fields) {
    return fields
        .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`)
        .join('\n');
}
function escapeHtml(value) {
    return value
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&#39;');
}
