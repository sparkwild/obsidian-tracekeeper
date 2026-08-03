import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { OAuthIntegrationPort } from './agent-auth';
import { type OAuthUiLocale } from './oauth-page';
export interface BoundOAuthClient {
    clientId: string;
    clientNameClaim: string;
    redirectUris: string[];
    integrationId: string;
    clientProfileId?: string;
}
export interface LocalOAuthAuthorizationServerOptions {
    oauthIntegration: OAuthIntegrationPort;
    getBoundOAuthClients?: () => readonly BoundOAuthClient[];
    getOrigin: () => string;
    getResource: () => string;
    maxRequestBytes: number;
    requestTimeoutMs: number;
    authorizationCodeTtlMs: number;
    authorizationCodeCapacity: number;
    clientRegistrationTtlMs: number;
    clientRegistrationCapacity: number;
    pendingRequestTtlMs?: number;
    pendingRequestCapacity?: number;
    getOAuthUiLocale?: () => OAuthUiLocale;
}
/**
 * Local OAuth authorization server. Approval is an Obsidian-owned decision;
 * the browser only renders a waiting state and receives a one-time redirect.
 */
export declare class LocalOAuthAuthorizationServer {
    private readonly oauthIntegration;
    private readonly getBoundOAuthClients;
    private readonly getOrigin;
    private readonly getResource;
    private readonly maxRequestBytes;
    private readonly requestTimeoutMs;
    private readonly authorizationCodeTtlMs;
    private readonly authorizationCodeCapacity;
    private readonly clientRegistrationTtlMs;
    private readonly clientRegistrationCapacity;
    private readonly pendingRequestTtlMs;
    private readonly pendingRequestCapacity;
    private readonly getOAuthUiLocale;
    private readonly registeredClients;
    private readonly pendingRequests;
    private readonly authorizationCodes;
    constructor(options: LocalOAuthAuthorizationServerOptions);
    clear(): void;
    handlesPath(pathname: string): boolean;
    protectedResourceMetadataUrl(): string;
    handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void>;
    private handleRegistration;
    private handleAuthorization;
    private handleWaitingPage;
    private handleTokenExchange;
    private handleRevocation;
    private resolveClient;
    private validateRegistration;
    private parseAuthorizationRequest;
    private validateAuthorizationRequest;
    private redirectOrError;
    private errorPage;
    private resolveOAuthUiLocale;
    private protectedResourceMetadata;
    private authorizationServerMetadata;
    private protectedResourceMetadataPath;
    private isAllowedOAuthOrigin;
    private readBodyOrRespond;
    private writeOAuthHtml;
    private writeOAuthJson;
    private writeOAuthCors;
    private applySecurityHeaders;
    private pruneExpiredState;
    private enforceAuthorizationCodeCapacity;
}
