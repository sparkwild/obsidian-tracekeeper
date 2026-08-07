"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeOAuthUiLocale = normalizeOAuthUiLocale;
exports.oauthContentSecurityPolicy = oauthContentSecurityPolicy;
exports.renderOAuthWaitingPage = renderOAuthWaitingPage;
exports.renderOAuthErrorPage = renderOAuthErrorPage;
const node_crypto_1 = require("node:crypto");
const COPY = {
    'zh-CN': {
        localBadge: '本机安全连接',
        footer: '由 Tracekeeper 本机服务提供',
        waiting: {
            title: '等待 Obsidian 审批',
            lead: '请回到 Obsidian 核对请求并完成审批。此页面不会显示授权按钮或凭据。',
            clientLabel: '客户端自报名称（不可信）',
            expiresLabel: '请求有效期至',
            refreshLabel: '页面会自动刷新状态。',
        },
        errors: {
            invalid_request: { title: '连接请求有问题', message: '请返回客户端重新开始。' },
            invalid_client: { title: '客户端未注册或已失效', message: '请返回客户端重新发起 OAuth。' },
            access_denied: { title: '授权已拒绝', message: 'Obsidian 未批准本次客户端访问。' },
            temporarily_unavailable: { title: '授权请求暂时不可用', message: '本机授权队列已满，请稍后重试。' },
            server_error: { title: '授权服务发生错误', message: 'Tracekeeper 无法完成本次授权，请返回客户端重试。' },
            authorization_expired: { title: '授权请求已失效', message: '请返回客户端重新发起授权请求。' },
        },
    },
    en: {
        localBadge: 'Secure local connection',
        footer: 'Provided by the Tracekeeper service on this device',
        waiting: {
            title: 'Waiting for Obsidian approval',
            lead: 'Return to Obsidian to review this request and complete approval. This page never shows an approval button or credential.',
            clientLabel: 'Client-reported name (untrusted)',
            expiresLabel: 'Request expires',
            refreshLabel: 'This page refreshes automatically.',
        },
        errors: {
            invalid_request: { title: 'There is a problem with this request', message: 'Return to the client and start again.' },
            invalid_client: { title: 'The client is not registered or has expired', message: 'Return to the client and start OAuth again.' },
            access_denied: { title: 'Authorization denied', message: 'Obsidian did not approve this client request.' },
            temporarily_unavailable: { title: 'Authorization is temporarily unavailable', message: 'The local authorization queue is full. Try again shortly.' },
            server_error: { title: 'Authorization service error', message: 'Tracekeeper could not complete this authorization. Return to the client and retry.' },
            authorization_expired: { title: 'Authorization request expired', message: 'Return to the client and start a new authorization request.' },
        },
    },
};
const OAUTH_PAGE_CSS = `
:root { color-scheme: light dark; --bg:#f7f7fb; --card:#fff; --text:#202027; --muted:#686875; --border:rgba(39,39,52,.14); --soft:rgba(124,58,237,.08); --primary:#7c3aed; }
@media (prefers-color-scheme: dark) { :root { --bg:#121216; --card:#1c1c22; --text:#f4f3f7; --muted:#aaa8b5; --border:rgba(255,255,255,.14); --soft:rgba(167,139,250,.14); --primary:#a78bfa; } }
* { box-sizing:border-box; } html,body { min-width:320px; min-height:100%; margin:0; } body { min-height:100vh; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; font-size:16px; line-height:1.5; }
.oauth-page { display:grid; min-height:100vh; place-items:center; padding:32px 16px; } .oauth-page__inner { width:min(480px,100%); }
.oauth-brand { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:18px; font-size:18px; font-weight:650; } .oauth-brand-mark { width:32px; height:32px; color:var(--primary); }
.oauth-card { border:1px solid var(--border); border-radius:20px; background:var(--card); box-shadow:0 18px 48px rgba(33,28,52,.12); padding:32px; } .oauth-badge { display:inline-flex; margin-bottom:20px; border:1px solid var(--border); border-radius:999px; background:var(--soft); color:var(--primary); font-size:13px; font-weight:650; padding:9px 12px; }
.oauth-card h1 { margin:0; font-size:clamp(28px,6vw,36px); line-height:1.12; } .oauth-lead { margin:14px 0 24px; color:var(--muted); } .oauth-details { display:grid; gap:12px; margin:0 0 22px; } .oauth-detail { display:grid; gap:3px; border-bottom:1px solid var(--border); padding-bottom:12px; } .oauth-detail:last-child { border-bottom:0; } .oauth-detail dt { color:var(--muted); font-size:12px; font-weight:650; } .oauth-detail dd { margin:0; overflow-wrap:anywhere; font-weight:650; }
.oauth-note { margin:16px 0 0; border-top:1px solid var(--border); padding-top:18px; color:var(--muted); font-size:13px; } .oauth-state-icon { display:grid; width:44px; height:44px; margin-bottom:18px; place-items:center; border:1px solid #d14343; border-radius:50%; color:#d14343; font-size:23px; font-weight:700; } .oauth-footer { margin:16px 0 0; color:var(--muted); font-size:13px; text-align:center; }
@media (max-width:520px) { .oauth-page { padding:24px 12px; } .oauth-card { padding:24px; } } @media (max-width:360px) { .oauth-page { padding:16px 8px; } .oauth-card { padding:20px 16px; } }
`;
const OAUTH_PAGE_STYLE_HASH = (0, node_crypto_1.createHash)('sha256').update(OAUTH_PAGE_CSS, 'utf8').digest('base64');
function normalizeOAuthUiLocale(value) { return value === 'en' ? 'en' : 'zh-CN'; }
function oauthContentSecurityPolicy(callbackOrigin) {
    return ["default-src 'none'", "base-uri 'none'", `style-src 'sha256-${OAUTH_PAGE_STYLE_HASH}'`, `form-action 'self'${callbackOrigin ? ` ${callbackOrigin}` : ''}`, "frame-ancestors 'none'"].join('; ');
}
function renderOAuthWaitingPage(locale, model) {
    const copy = COPY[locale];
    return pageShell(locale, copy.waiting.title, `<meta http-equiv="refresh" content="2;url=${escapeHtml(model.refreshUrl)}" />
<section class="oauth-card" aria-labelledby="oauth-page-title" aria-live="polite"><div class="oauth-badge">${escapeHtml(copy.localBadge)}</div><h1 id="oauth-page-title">${escapeHtml(copy.waiting.title)}</h1><p class="oauth-lead">${escapeHtml(copy.waiting.lead)}</p><dl class="oauth-details"><div class="oauth-detail"><dt>${escapeHtml(copy.waiting.clientLabel)}</dt><dd>${escapeHtml(model.clientName)}</dd></div><div class="oauth-detail"><dt>${escapeHtml(copy.waiting.expiresLabel)}</dt><dd>${escapeHtml(model.expiresAt)}</dd></div></dl><p class="oauth-note">${escapeHtml(copy.waiting.refreshLabel)}</p></section>`);
}
function renderOAuthErrorPage(locale, kind) {
    const copy = COPY[locale];
    const state = copy.errors[kind];
    return pageShell(locale, state.title, `<section class="oauth-card" role="alert" aria-labelledby="oauth-page-title"><div class="oauth-state-icon" aria-hidden="true">!</div><h1 id="oauth-page-title">${escapeHtml(state.title)}</h1><p>${escapeHtml(state.message)}</p><p class="oauth-note">${escapeHtml(locale === 'en' ? 'Close this page and return to the client.' : '请关闭此页面并返回客户端。')}</p></section>`);
}
function pageShell(locale, title, card) {
    const copy = COPY[locale];
    return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light dark" /><title>${escapeHtml(title)}</title><style>${OAUTH_PAGE_CSS}</style></head><body><main class="oauth-page"><div class="oauth-page__inner"><header class="oauth-brand"><svg class="oauth-brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="2" /><circle cx="16" cy="16" r="4" fill="currentColor" /><path d="M5 16h5M22 16h5M16 5v5M16 22v5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" /></svg><span>Tracekeeper</span></header>${card}<p class="oauth-footer">${escapeHtml(copy.footer)}</p></div></main></body></html>`;
}
function escapeHtml(value) {
    return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
}
