export type OAuthUiLocale = 'zh-CN' | 'en';
export type OAuthPageErrorKind = 'invalid_request' | 'invalid_client' | 'invalid_pairing_code' | 'confirmation_expired' | 'pairing_expired';
export interface OAuthPairingPageModel {
    actionUrl: string;
    hiddenFields: ReadonlyArray<readonly [string, string]>;
    clientName: string;
}
export interface OAuthConfirmationPageModel {
    actionUrl: string;
    hiddenFields: ReadonlyArray<readonly [string, string]>;
    expectedClientId: string;
    clientName: string;
}
export declare function normalizeOAuthUiLocale(value: unknown): OAuthUiLocale;
export declare function oauthContentSecurityPolicy(callbackOrigin?: string): string;
export declare function renderOAuthPairingPage(locale: OAuthUiLocale, model: OAuthPairingPageModel): string;
export declare function renderOAuthConfirmationPage(locale: OAuthUiLocale, model: OAuthConfirmationPageModel): string;
export declare function renderOAuthErrorPage(locale: OAuthUiLocale, kind: OAuthPageErrorKind): string;
