"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpJsonRpcHandler = exports.STREAMABLE_HTTP_TRANSPORT = exports.MCP_SERVER_VERSION = exports.MCP_PROTOCOL_VERSION = void 0;
const protocol_1 = require("./protocol");
const tools_1 = require("./tools");
exports.MCP_PROTOCOL_VERSION = '2025-06-18';
exports.MCP_SERVER_VERSION = '0.1.6';
exports.STREAMABLE_HTTP_TRANSPORT = 'streamable-http';
const RESOURCES = [
    {
        uri: 'tracekeeper://system',
        name: 'system',
        title: 'System note',
        description: 'Core system note path if present.',
        mimeType: 'text/markdown',
    },
    {
        uri: 'tracekeeper://active-context',
        name: 'active-context',
        title: 'Active context',
        description: 'Active-context note for current memory state.',
        mimeType: 'text/markdown',
    },
    {
        uri: 'tracekeeper://review-queue',
        name: 'review-queue',
        title: 'Review queue',
        description: 'Pending proposal queue snapshots.',
        mimeType: 'text/markdown',
    },
    {
        uri: 'tracekeeper://agent-activity',
        name: 'agent-activity',
        title: 'Agent activity',
        description: 'Recent agent-task and review traces.',
        mimeType: 'text/markdown',
    },
    {
        uri: 'tracekeeper://audit/recent',
        name: 'audit-recent',
        title: 'Recent audit',
        description: 'Recent audit log entries.',
        mimeType: 'text/markdown',
    },
];
class McpJsonRpcHandler {
    constructor(options = {}) {
        this.defaultVaultRoot = options.defaultVaultRoot;
        this.vaultConfigDir = options.vaultConfigDir;
        this.graphProfile = options.graphProfile;
        this.runtimeVersion = options.runtimeVersion || exports.MCP_SERVER_VERSION;
        this.transport = options.transport || exports.STREAMABLE_HTTP_TRANSPORT;
    }
    handleMessage(rawMessage, state) {
        if (!(0, protocol_1.isRecord)(rawMessage)) {
            return this.errorResponse(null, -32600, 'Invalid request.');
        }
        const requestId = this.readRequestId(rawMessage.id);
        const isNotification = rawMessage.id === undefined;
        const method = rawMessage.method;
        if (typeof method !== 'string' || method.trim() === '') {
            return isNotification ? null : this.errorResponse(requestId ?? null, -32600, 'Invalid request: missing method.');
        }
        const params = rawMessage.params ?? {};
        if (!(0, protocol_1.isRecord)(params)) {
            if (!isNotification) {
                return this.errorResponse(requestId ?? null, -32602, 'Invalid params.');
            }
            return null;
        }
        try {
            const result = this.dispatch(method, params, state);
            if (isNotification || method.startsWith('notifications/')) {
                return null;
            }
            return { jsonrpc: '2.0', id: requestId ?? null, result };
        }
        catch (error) {
            if (isNotification || method.startsWith('notifications/')) {
                return null;
            }
            if (error instanceof protocol_1.RpcError) {
                return this.errorResponse(requestId ?? null, error.code, error.message, error.data);
            }
            if (error instanceof Error) {
                return this.errorResponse(requestId ?? null, -32603, error.message);
            }
            return this.errorResponse(requestId ?? null, -32603, 'Internal error.');
        }
    }
    readRequestId(id) {
        return typeof id === 'string' || typeof id === 'number' || id === null ? id : undefined;
    }
    dispatch(method, params, state) {
        switch (method) {
            case 'initialize':
                this.captureConnection(params, state);
                return {
                    protocolVersion: exports.MCP_PROTOCOL_VERSION,
                    capabilities: {
                        tools: { listChanged: false },
                        resources: { listChanged: false },
                        prompts: { listChanged: false },
                    },
                    serverInfo: {
                        name: 'tracekeeper-mcp-server',
                        title: 'Tracekeeper MCP Server (read-only default + controlled write + review-gated apply)',
                        version: this.runtimeVersion,
                    },
                    instructions: 'This MCP server is read-only-by-default; controlled write tools are allowed for bounded working records, and review-gated apply requires approved proposals before protected writeback. All reads and writes are vault-local only, reject vault-outside and Obsidian configuration paths, and sensitive payloads are never persisted in audit events.',
                };
            case 'tools/list':
                return { tools: (0, tools_1.toolDefinitions)() };
            case 'tools/call':
                return this.handleToolsCall(params, state);
            case 'resources/list':
                return { resources: RESOURCES };
            case 'prompts/list':
                return { prompts: (0, tools_1.toolPrompts)() };
            case 'notifications/initialized':
                return {};
            case 'ping':
                return {};
            default:
                throw new protocol_1.RpcError({ code: -32601, message: `Method not found: ${method}` });
        }
    }
    handleToolsCall(params, state) {
        const name = params.name;
        const argumentsValue = params.arguments ?? {};
        if (typeof name !== 'string' || name.trim() === '') {
            throw new protocol_1.RpcError({ code: -32602, message: '`name` is required for tools/call.' });
        }
        if (!(0, protocol_1.isRecord)(argumentsValue)) {
            throw new protocol_1.RpcError({ code: -32602, message: '`arguments` must be an object.' });
        }
        const toolInvocationContext = {
            defaultVaultRoot: this.defaultVaultRoot,
            vaultConfigDir: this.vaultConfigDir,
            graphProfile: this.graphProfile,
            agentId: state.agentId,
            sessionId: state.sessionId,
            clientName: state.clientName,
            transport: this.transport,
            runtimeVersion: this.runtimeVersion,
        };
        return (0, tools_1.callTool)(name, argumentsValue, toolInvocationContext);
    }
    captureConnection(params, state) {
        state.agentId = this.extractAgentIdFromInitialize(params, state.sessionId);
        state.clientName = this.extractClientNameFromInitialize(params);
        state.initialized = true;
        if (!this.defaultVaultRoot) {
            return;
        }
        try {
            (0, tools_1.appendConnectionAuditEvent)(this.defaultVaultRoot, {
                agentId: state.agentId,
                sessionId: state.sessionId,
                clientName: state.clientName,
                transport: this.transport,
                runtimeVersion: this.runtimeVersion,
            });
        }
        catch {
            // Best-effort audit writes should never fail initialize.
        }
    }
    extractAgentIdFromInitialize(params, fallbackSessionId) {
        const clientInfo = (0, protocol_1.isRecord)(params.clientInfo) ? params.clientInfo : {};
        const meta = (0, protocol_1.isRecord)(params.meta) ? params.meta : {};
        const candidates = [
            params.agent_id,
            params.agentId,
            params.session_id,
            params.sessionId,
            params.client_name,
            params.clientName,
            clientInfo.agent_id,
            clientInfo.agentId,
            clientInfo.session_id,
            clientInfo.sessionId,
            clientInfo.client_name,
            clientInfo.clientName,
            meta.agent_id,
            meta.agentId,
            meta.session_id,
            meta.sessionId,
        ];
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim() !== '') {
                return candidate.trim();
            }
        }
        return fallbackSessionId || 'unknown session id';
    }
    extractClientNameFromInitialize(params) {
        const clientInfo = (0, protocol_1.isRecord)(params.clientInfo) ? params.clientInfo : {};
        const names = [
            params.name,
            params.client_name,
            params.clientName,
            clientInfo.name,
            clientInfo.client_name,
            clientInfo.clientName,
        ];
        for (const name of names) {
            if (typeof name === 'string' && name.trim() !== '') {
                return name.trim();
            }
        }
        return null;
    }
    errorResponse(id, code, message, data) {
        const error = { code, message };
        if (data !== undefined) {
            error.data = data;
        }
        return { jsonrpc: '2.0', id, error };
    }
}
exports.McpJsonRpcHandler = McpJsonRpcHandler;
