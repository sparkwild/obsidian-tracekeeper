export type RuntimeState = 'stopped' | 'starting' | 'running' | 'failed' | 'port_conflict';
export interface StreamableHttpRuntimeOptions {
    host?: string;
    port?: number;
    path?: string;
    token?: string;
    allowMissingTokenForDev?: boolean;
    defaultVaultRoot?: string;
    vaultConfigDir?: string;
    graphProfile?: unknown;
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
}
export declare class StreamableHttpMcpRuntime {
    private host;
    private port;
    private path;
    private token;
    private allowMissingTokenForDev;
    private runtimeVersion;
    private handler;
    private server;
    private sessions;
    private state;
    private startedAt;
    private lastError;
    constructor(options?: StreamableHttpRuntimeOptions);
    start(): Promise<StreamableHttpRuntimeStatus>;
    stop(): Promise<void>;
    getStatus(): StreamableHttpRuntimeStatus;
    private handleRequest;
    private handlePost;
    private handleGet;
    private handleDelete;
    private createSession;
    private requireSession;
    private closeSession;
    private parseRequestUrl;
    private readMethod;
    private readBody;
    private isAllowedOrigin;
    private allowedCorsOrigin;
    private hasValidToken;
    private firstHeaderValue;
    private writeJson;
    private writePlain;
    private writeCors;
    private errorResponse;
}
