export type OAuthUiLocale = 'zh-CN' | 'en';
export type OAuthPageErrorKind = 'invalid_request' | 'invalid_client' | 'access_denied' | 'temporarily_unavailable' | 'server_error' | 'authorization_expired';
export interface OAuthWaitingPageModel {
    clientName: string;
    expiresAt: string;
    refreshUrl: string;
}
export declare function normalizeOAuthUiLocale(value: unknown): OAuthUiLocale;
export declare function oauthContentSecurityPolicy(callbackOrigin?: string): string;
export declare function renderOAuthWaitingPage(locale: OAuthUiLocale, model: OAuthWaitingPageModel): string;
export declare function renderOAuthErrorPage(locale: OAuthUiLocale, kind: OAuthPageErrorKind): string;
