import type {
	AgentConnectionRecord,
	AgentToolCallRecord,
	AuditEventRecord,
} from './activity-model';

export type ObservedClientType =
	| 'codex'
	| 'claude-code'
	| 'claude-desktop'
	| 'cursor'
	| 'gemini'
	| 'grok'
	| 'zcode'
	| 'custom'
	| 'unknown';

const OBSERVED_CLIENT_TYPES = new Set<ObservedClientType>([
	'codex',
	'claude-code',
	'claude-desktop',
	'cursor',
	'gemini',
	'grok',
	'zcode',
	'custom',
	'unknown',
]);

export function normalizeObservedClientType(
	rawName: string,
	declaredType: string
): ObservedClientType {
	const normalizedDeclared = declaredType.trim().toLowerCase() as ObservedClientType;
	if (OBSERVED_CLIENT_TYPES.has(normalizedDeclared)) {
		return normalizedDeclared;
	}

	const normalizedName = rawName.trim().toLowerCase();
	if (!normalizedName) {
		return 'unknown';
	}
	if (normalizedName.includes('codex')) {
		return 'codex';
	}
	if (
		normalizedName === 'gemini-cli-mcp-client'
		|| normalizedName.includes('gemini cli')
		|| normalizedName.includes('gemini-cli')
		|| normalizedName.includes('gemini_cli')
	) {
		return 'gemini';
	}
	if (
		normalizedName === 'grok'
		|| normalizedName.startsWith('grok-shell-')
		|| normalizedName.includes('grok build')
		|| normalizedName.includes('grok-build')
		|| normalizedName.includes('grok_build')
	) {
		return 'grok';
	}
	if (normalizedName === 'zcode' || normalizedName.includes('zcode')) {
		return 'zcode';
	}
	if (
		normalizedName.includes('claude desktop')
		|| normalizedName.includes('claude-desktop')
		|| normalizedName.includes('claude_desktop')
	) {
		return 'claude-desktop';
	}
	if (
		normalizedName === 'claude'
		|| normalizedName.includes('claude code')
		|| normalizedName.includes('claude-code')
		|| normalizedName.includes('claude_code')
	) {
		return 'claude-code';
	}
	if (normalizedName.includes('cursor')) {
		return 'cursor';
	}
	return 'custom';
}

export function observedClientTypeLabel(type: ObservedClientType): string {
	switch (type) {
		case 'codex':
			return 'Codex';
		case 'claude-code':
			return 'Claude Code';
		case 'claude-desktop':
			return 'Claude Desktop';
		case 'cursor':
			return 'Cursor';
		case 'gemini':
			return 'Gemini CLI';
		case 'grok':
			return 'Grok Build';
		case 'zcode':
			return 'ZCode';
		case 'custom':
			return 'Custom client';
		case 'unknown':
		default:
			return 'Unknown client';
	}
}

function connectionEvent(event: AuditEventRecord): boolean {
	const eventType = event.eventType.trim().toLowerCase().replace(/_/g, '-');
	const action = event.action.trim().toLowerCase().replace(/_/g, '-');
	return eventType === 'mcp.connection'
		|| eventType === 'connection'
		|| eventType === 'agent-connection-event'
		|| action === 'connection'
		|| action === 'mcp.connection'
		|| action === 'mcp.initialize';
}

function timestampValue(value: string, fallback: number): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function isExternalClientTransport(transport: string): boolean {
	return transport.trim().toLowerCase() !== 'obsidian-direct';
}

export function buildRecentObservedClientConnections(
	auditEvents: AuditEventRecord[],
	toolCalls: AgentToolCallRecord[]
): AgentConnectionRecord[] {
	const connections = new Map<string, AgentConnectionRecord>();

	for (const event of auditEvents.filter((item) =>
		connectionEvent(item)
		&& item.resultStatus === 'success'
		&& isExternalClientTransport(item.transport)
	)) {
		const rawName = event.observedClientNameRaw || event.clientName;
		const observedType = normalizeObservedClientType(rawName, event.observedClientType);
		const sessionId = event.sessionId.trim();
		const connectionKey = sessionId || event.agentId || 'unknown';
		const integrationKey = event.integrationId.trim();
		const connectedAt = event.connectedAt || event.timestamp;
		const connectedTimestamp = timestampValue(connectedAt, event.sortTimestamp);
		const key = integrationKey
			? `integration::${integrationKey}::${connectionKey}`
			: `${observedType}::${connectionKey}`;
		const existing = connections.get(key);
		if (existing && timestampValue(existing.connectedAt, existing.sortTimestamp) >= connectedTimestamp) {
			continue;
		}

		connections.set(key, {
			principalId: event.principalId,
			integrationId: event.integrationId,
			credentialId: event.credentialId,
			authMode: event.authMode,
			agentId: event.agentId || connectionKey,
			sessionId,
			clientName: event.clientName || rawName || 'unknown',
			observedClientNameRaw: rawName,
			observedClientType: observedType,
			observedClientVersion: event.observedClientVersion,
			displayName: observedClientTypeLabel(observedType),
			transport: event.transport || 'streamable-http',
			status: 'connected',
			lastSeen: connectedAt,
			lastToolCall: '',
			connectedAt,
			resultStatus: event.resultStatus,
			lastUsedAt: '',
			lastSuccessfulTool: '',
			runtimeVersion: event.runtimeVersion,
			permissionProfile: 'local trust fixed capability set',
			sortTimestamp: connectedTimestamp,
		});
	}

	for (const call of toolCalls) {
		if (call.resultStatus !== 'success' || !isExternalClientTransport(call.transport)) {
			continue;
		}
		const rawName = call.observedClientNameRaw || call.clientName;
		const observedType = normalizeObservedClientType(rawName, call.observedClientType);
		const sessionId = call.sessionId.trim();
		const connectionKey = sessionId || call.agentId || 'unknown';
		const integrationKey = call.integrationId.trim();
		const key = `${observedType}::${connectionKey}`;
		const scopedKey = integrationKey
			? `integration::${integrationKey}::${connectionKey}`
			: key;
		const lastUsedAt = call.lastUsedAt || call.timestamp;
		const usedTimestamp = timestampValue(lastUsedAt, call.sortTimestamp);
		const existing = connections.get(scopedKey);
		if (!existing) {
			connections.set(scopedKey, {
				principalId: call.principalId,
				integrationId: call.integrationId,
				credentialId: call.credentialId,
				authMode: call.authMode,
				agentId: call.agentId || connectionKey,
				sessionId,
				clientName: call.clientName || rawName || 'unknown',
				observedClientNameRaw: rawName,
				observedClientType: observedType,
				observedClientVersion: call.observedClientVersion,
				displayName: observedClientTypeLabel(observedType),
				transport: call.transport || 'streamable-http',
				status: 'active',
				lastSeen: lastUsedAt,
				lastToolCall: call.toolName,
				connectedAt: '',
				resultStatus: call.resultStatus,
				lastUsedAt,
				lastSuccessfulTool: call.lastSuccessfulTool || call.toolName,
				runtimeVersion: '',
				permissionProfile: 'local trust fixed capability set',
				sortTimestamp: usedTimestamp,
			});
			continue;
		}

		if (timestampValue(existing.lastUsedAt, 0) > usedTimestamp) {
			continue;
		}
		existing.principalId = call.principalId || existing.principalId;
		existing.integrationId = call.integrationId || existing.integrationId;
		existing.credentialId = call.credentialId || existing.credentialId;
		existing.authMode = call.authMode || existing.authMode;
		existing.agentId = call.agentId || existing.agentId;
		existing.clientName = call.clientName || existing.clientName;
		existing.observedClientNameRaw = rawName || existing.observedClientNameRaw;
		existing.observedClientVersion = call.observedClientVersion || existing.observedClientVersion;
		existing.status = 'active';
		existing.lastSeen = lastUsedAt;
		existing.lastToolCall = call.toolName;
		existing.lastUsedAt = lastUsedAt;
		existing.lastSuccessfulTool = call.lastSuccessfulTool || call.toolName;
		existing.sortTimestamp = Math.max(existing.sortTimestamp, usedTimestamp);
	}

	return [...connections.values()].sort((left, right) => right.sortTimestamp - left.sortTimestamp);
}
