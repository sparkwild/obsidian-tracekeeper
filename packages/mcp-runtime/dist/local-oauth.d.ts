import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { type OAuthUiLocale } from './oauth-page';
export type PairingTicketState = 'pending' | 'awaiting_confirmation' | 'authorized' | 'expired' | 'attempts_exhausted';
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
/**
 * Hosts local OAuth authorization and one-time pairing on the existing loopback listener.
 */
export declare class LocalOAuthAuthorizationServer {
    private readonly serviceTokenHash;
    private readonly getSharedBearerToken;
    private readonly getOrigin;
    private readonly getResource;
    private readonly maxRequestBytes;
    private readonly requestTimeoutMs;
    private readonly pairingTicketTtlMs;
    private readonly pairingTicketCapacity;
    private readonly pairingTicketMaxAttempts;
    private readonly authorizationCodeTtlMs;
    private readonly authorizationCodeCapacity;
    private readonly clientRegistrationTtlMs;
    private readonly clientRegistrationCapacity;
    private readonly getOAuthUiLocale;
    private readonly pairingTickets;
    private readonly registeredClients;
    private readonly authorizationApprovals;
    private readonly authorizationCodes;
    constructor(options: LocalOAuthAuthorizationServerOptions);
    issuePairingTicket(expectedClientId: string): PairingTicket;
    getPairingTicketStatus(id: string): PairingTicketStatus | null;
    clear(): void;
    handlesPath(pathname: string): boolean;
    protectedResourceMetadataUrl(): string;
    handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void>;
    private handleRegistration;
    private handleAuthorizationPage;
    private handleAuthorizationPost;
    private completeAuthorization;
    private handleTokenExchange;
    private validateRegistration;
    private parseAuthorizationRequest;
    private validateAuthorizationRequest;
    private verifyPairingCode;
    private pairingEntryPage;
    private confirmationPage;
    private errorPage;
    private resolveOAuthUiLocale;
    private protectedResourceMetadata;
    private authorizationServerMetadata;
    private protectedResourceMetadataPath;
    private isAllowedOAuthOrigin;
    private isSameOriginFormPost;
    private readBodyOrRespond;
    private writeOAuthHtml;
    private writeOAuthJson;
    private writeOAuthCors;
    private applySecurityHeaders;
    private pruneExpiredState;
    private dropOldestTerminalTickets;
    private enforceApprovalCapacity;
    private enforceAuthorizationCodeCapacity;
}
