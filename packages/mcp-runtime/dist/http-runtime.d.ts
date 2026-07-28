import type { ToolCapability } from '@tracekeeper/contracts';
import type { VaultRepository } from '@tracekeeper/core';
import { McpJsonRpcHandler } from './handler';
export type RuntimeState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' | 'port_conflict';
export interface RuntimeCredential {
    id: string;
    token: string;
    capabilities?: readonly (ToolCapability | '*')[];
}
export interface StreamableHttpRuntimeOptions {
    host?: string;
    port?: number;
    path?: string;
    token?: string;
    credentials?: readonly RuntimeCredential[];
    allowMissingTokenForDev?: boolean;
    maxRequestBytes?: number;
    maxSessions?: number;
    maxStreamsPerSession?: number;
    sessionIdleTtlMs?: number;
    requestTimeoutMs?: number;
    defaultVaultRoot?: string;
    vaultConfigDir?: string;
    vaultRepository?: VaultRepository;
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
    credentialCount: number;
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
    private credentials;
    private allowMissingTokenForDev;
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
    private state;
    private startedAt;
    private lastError;
    private recoveryStatus;
    constructor(options?: StreamableHttpRuntimeOptions);
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
    private authenticate;
    private pruneExpiredSessions;
    private firstHeaderValue;
    private writeJson;
    private writePlain;
    private writeCors;
    private errorResponse;
}
