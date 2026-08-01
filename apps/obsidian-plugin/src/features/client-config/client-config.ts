export type ClientConfigState = 'configured' | 'needs_update' | 'not_configured' | 'unavailable';
export type ClientSetupCapability = 'oauth-cli' | 'oauth-link' | 'extension' | 'native-gui' | 'manual';
export type ClientPairingState =
	| 'ready'
	| 'awaiting_confirmation'
	| 'redeemed'
	| 'expired'
	| 'failed'
	| 'retry';
export type ClientPairingRuntimeState =
	| 'pending'
	| 'awaiting_confirmation'
	| 'authorized'
	| 'expired'
	| 'attempts_exhausted';

export interface ClientProfile {
	id: string;
	displayName: string;
	description: string;
	setupCapability: ClientSetupCapability;
	supportsLocalOAuth: boolean;
	setupUrl?: string;
	buildSetupInstruction?: (connectionUrl: string) => string;
	setupFollowup?: string;
}

export interface GeneratedClientConfig {
	clientId: string;
	displayName: string;
	description: string;
	configState: ClientConfigState;
	setupCapability: ClientSetupCapability;
	supportsLocalOAuth: boolean;
	setupInstruction: string;
	setupUrl?: string;
	setupFollowup?: string;
}

export interface GeneratedClientSetup {
	setupCapability: ClientSetupCapability;
	supportsLocalOAuth: boolean;
	setupInstruction: string;
	setupUrl?: string;
	setupFollowup?: string;
}

export interface ClientPairingTicket {
	id: string;
	code: string;
	expectedClientId?: string;
	issuedAt: string;
	expiresAt: string;
}

export interface ClientPairingTicketStatus {
	id: string;
	expectedClientId?: string;
	state: ClientPairingRuntimeState;
	issuedAt: string;
	expiresAt: string;
	attemptsRemaining: number;
	authorizedAt?: string;
}

export const buildClientProfiles = (
	_homeDir: string | undefined,
	localize: (zh: string, en: string) => string,
	_joinPath: (...parts: string[]) => string = (...parts) => parts.join('/')
): ClientProfile[] => [
	{
		id: 'codex',
		displayName: 'Codex',
		description: localize(
			'复制 Codex 官方 MCP 命令，然后在打开的本机页面中完成 OAuth 授权。',
			'Copy the official Codex MCP command, then complete OAuth authorization in the local page it opens.'
		),
		setupCapability: 'oauth-cli',
		supportsLocalOAuth: true,
		buildSetupInstruction: (connectionUrl) =>
			`codex mcp add tracekeeper --url ${connectionUrl}`,
		setupFollowup: localize(
			'如果已有 Tracekeeper 配置需要重新授权，请运行 codex mcp login tracekeeper --scopes mcp。',
			'If an existing Tracekeeper configuration needs reauthorization, run codex mcp login tracekeeper --scopes mcp.'
		),
	},
	{
		id: 'claude-code',
		displayName: 'Claude Code',
		description: localize(
			'复制官方 CLI 命令，然后在 Claude Code 中完成本机 OAuth 授权。',
			'Copy the official CLI command, then complete local OAuth authorization in Claude Code.'
		),
		setupCapability: 'oauth-cli',
		supportsLocalOAuth: true,
		buildSetupInstruction: (connectionUrl) =>
			`claude mcp add --transport http --scope user tracekeeper ${connectionUrl}`,
		setupFollowup: localize(
			'随后在 Claude Code 中运行 /mcp，并选择 Tracekeeper 完成授权。',
			'Then run /mcp in Claude Code and choose Tracekeeper to authorize.'
		),
	},
	{
		id: 'claude-desktop',
		displayName: 'Claude Desktop',
		description: localize(
			'Claude Desktop 需要兼容的 MCPB 扩展；目前没有经过验证的 Tracekeeper 本机 OAuth 扩展，因此不会宣称可自动连接。',
			'Claude Desktop requires a compatible MCPB extension. No Tracekeeper local OAuth extension is verified yet, so automatic connection is not claimed.'
		),
		setupCapability: 'extension',
		supportsLocalOAuth: false,
	},
	{
		id: 'cursor',
		displayName: 'Cursor',
		description: localize(
			'请在 Cursor 的 MCP 设置中使用本机端点；当前 loopback OAuth 兼容性尚未完成现场验证。',
			'Use the local endpoint in Cursor MCP settings. Loopback OAuth compatibility has not completed live verification.'
		),
		setupCapability: 'native-gui',
		supportsLocalOAuth: false,
	},
	{
		id: 'gemini',
		displayName: 'Gemini CLI',
		description: localize(
			'复制官方 CLI 命令，然后在 Gemini CLI 中完成本机 OAuth 授权。',
			'Copy the official CLI command, then complete local OAuth authorization in Gemini CLI.'
		),
		setupCapability: 'oauth-cli',
		supportsLocalOAuth: true,
		buildSetupInstruction: (connectionUrl) =>
			`gemini mcp add --transport http --scope user tracekeeper ${connectionUrl}`,
		setupFollowup: localize(
			'随后在 Gemini CLI 中运行 /mcp auth tracekeeper 完成授权。',
			'Then run /mcp auth tracekeeper in Gemini CLI to authorize.'
		),
	},
	{
		id: 'grok',
		displayName: 'Grok Build',
		description: localize(
			'Grok Build 的本机 OAuth 兼容性仍需现场验证。请使用其原生 MCP 管理入口，不要粘贴长期访问凭据。',
			'Grok Build local OAuth compatibility still requires live verification. Use its native MCP management and do not paste a long-lived access credential.'
		),
		setupCapability: 'manual',
		supportsLocalOAuth: false,
	},
	{
		id: 'zcode',
		displayName: 'ZCode',
		description: localize(
			'请在 ZCode 设置中的 MCP 页面使用本机端点；当前没有经过验证的本机 OAuth 流程。',
			'Use the local endpoint on the MCP page in ZCode settings. No local OAuth flow is verified yet.'
		),
		setupCapability: 'native-gui',
		supportsLocalOAuth: false,
	},
	{
		id: 'custom',
		displayName: localize('自定义 MCP 工具', 'Custom MCP tool'),
		description: localize(
			'仅当客户端支持 Streamable HTTP、MCP OAuth 发现、PKCE S256 和安全凭据存储时，才可手工使用本机端点。',
			'Use the local endpoint manually only when the client supports Streamable HTTP, MCP OAuth discovery, PKCE S256, and secure credential storage.'
		),
		setupCapability: 'manual',
		supportsLocalOAuth: false,
	},
];

export const buildGeneratedClientSetup = (
	profile: ClientProfile,
	connectionUrl: string
): GeneratedClientSetup => {
	const endpoint = requirePublicLoopbackEndpoint(connectionUrl);
	return {
		setupCapability: profile.setupCapability,
		supportsLocalOAuth: profile.supportsLocalOAuth,
		setupInstruction: profile.buildSetupInstruction?.(endpoint) ?? endpoint,
		setupUrl: profile.setupUrl,
		setupFollowup: profile.setupFollowup,
	};
};

const requirePublicLoopbackEndpoint = (connectionUrl: string): string => {
	let endpoint: URL;
	try {
		endpoint = new URL(connectionUrl);
	} catch {
		throw new Error('Client setup requires a valid local MCP endpoint.');
	}
	if (
		endpoint.protocol !== 'http:'
		|| endpoint.hostname !== '127.0.0.1'
		|| !endpoint.port
		|| endpoint.pathname !== '/mcp'
		|| endpoint.username
		|| endpoint.password
		|| endpoint.search
		|| endpoint.hash
	) {
		throw new Error('Client setup is restricted to the exact local MCP endpoint.');
	}
	return endpoint.toString().replace(/\/$/, '');
};
