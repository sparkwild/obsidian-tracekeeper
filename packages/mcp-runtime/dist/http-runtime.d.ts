import type { VaultRepository } from '@tracekeeper/core';
import { type ProposalTransitionPort } from './tools';
import { McpJsonRpcHandler } from './handler';
import { type PairingTicket, type PairingTicketStatus } from './local-oauth';
export type { PairingTicket, PairingTicketState, PairingTicketStatus } from './local-oauth';
export type RuntimeState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' | 'port_conflict';
export interface StreamableHttpRuntimeOptions {
    localTrust?: boolean;
    serviceToken: string;
    getSharedBearerToken?: () => string | Promise<string>;
    host?: string;
    port?: number;
    path?: string;
    pairingTicketTtlMs?: number;
    pairingTicketCapacity?: number;
    pairingTicketMaxAttempts?: number;
    authorizationCodeTtlMs?: number;
    authorizationCodeCapacity?: number;
    clientRegistrationTtlMs?: number;
    clientRegistrationCapacity?: number;
    maxRequestBytes?: number;
    maxSessions?: number;
    maxStreamsPerSession?: number;
    sessionIdleTtlMs?: number;
    requestTimeoutMs?: number;
    defaultVaultRoot?: string;
    vaultConfigDir?: string;
    vaultRepository?: VaultRepository;
    proposalTransitionPort?: ProposalTransitionPort;
    knowledgeSnapshotProvider?: NonNullable<ConstructorParameters<typeof McpJsonRpcHandler>[0]>['knowledgeSnapshotProvider'];
    graphProfile?: unknown;
    memoryRules?: NonNullable<ConstructorParameters<typeof McpJsonRpcHandler>[0]>['memoryRules'];
    contentLanguage?: unknown;
    contentLanguageSource?: unknown;
    runtimeVersion?: string;
}
export interface StreamableHttpRuntimeStatus {
    state: RuntimeState;
    host: string;
    port: number;
    path: string;
    endpoint: string;
    startedAt: string;
    activeSessions: number;
    lastError: string;
    maxSessions: number;
    maxRequestBytes: number;
    sessionIdleTtlMs: number;
    maxStreamsPerSession: number;
    requestTimeoutMs: number;
    recovery: RuntimeRecoveryStatus | null;
}
export interface RuntimeRecoveryStatus {
    recovered: number;
    failed: number;
    skipped: number;
    completedAt: string;
}
export declare class StreamableHttpMcpRuntime {
    private host;
    private port;
    private path;
    private serviceTokenHash;
    private maxRequestBytes;
    private maxSessions;
    private maxStreamsPerSession;
    private sessionIdleTtlMs;
    private requestTimeoutMs;
    private runtimeVersion;
    private defaultVaultRoot?;
    private recoveryContext;
    private handler;
    private server;
    private stopPromise;
    private sessions;
    private oauthServer;
    private state;
    private startedAt;
    private lastError;
    private recoveryStatus;
    constructor(options: StreamableHttpRuntimeOptions);
    /**
     * Issues a one-time local pairing code for the Agent selected in Obsidian.
     */
    issuePairingTicket(expectedClientId: string): PairingTicket;
    getPairingTicketStatus(id: string): PairingTicketStatus | null;
    start(): Promise<StreamableHttpRuntimeStatus>;
    stop(): Promise<void>;
    private stopServer;
    getStatus(): StreamableHttpRuntimeStatus;
    private handleRequest;
    private handlePost;
    private handleGet;
    private handleDelete;
    private createSession;
    private requireSession;
    private closeSession;
    private parseRequestUrl;
    private hasJsonContentType;
    private readMethod;
    private readBody;
    private consumeRequestBody;
    private isAllowedOrigin;
    private isAllowedHost;
    private allowedCorsOrigin;
    private serviceBearerStatus;
    private recordRequestRejection;
    private pruneExpiredSessions;
    private firstHeaderValue;
    private writeJson;
    private writePlain;
    private writeCors;
    private runtimeOrigin;
    private errorResponse;
}
