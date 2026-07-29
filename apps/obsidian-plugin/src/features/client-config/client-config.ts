export type ClientConfigState = 'configured' | 'needs_update' | 'not_configured' | 'unavailable';

export type ClientConnectionTransport = 'streamable-http';
export type ClientConfigFormat =
	| 'codex-toml'
	| 'grok-toml'
	| 'gemini-json'
	| 'mcp-json'
	| 'zcode-json'
	| 'copy-only';

export interface ClientProfile {
	id: string;
	displayName: string;
	description: string;
	preferredTransport: ClientConnectionTransport;
	supportsAutoConfigure: boolean;
	restartRequired: boolean;
	configFormat: ClientConfigFormat;
	targetPath?: string;
}

export interface GeneratedClientConfig {
	clientId: string;
	displayName: string;
	description: string;
	transport: ClientConnectionTransport;
	completeConfigText: string;
	redactedConfigText: string;
	supportsAutoConfigure: boolean;
	restartRequired: boolean;
	configFormat: ClientConfigFormat;
	targetPath?: string;
	configState: ClientConfigState;
	configStatusLabel: string;
	configStatusDetail: string;
}

export interface ClientConfigStatus {
	state: ClientConfigState;
	label: string;
	detail: string;
}

export interface ClientConfigTexts {
	completeConfigText: string;
	redactedConfigText: string;
}

export const buildClientProfiles = (
	homeDir: string | undefined,
	localize: (zh: string, en: string) => string,
	joinPath: (...parts: string[]) => string = (...parts) => parts.join('/')
): ClientProfile[] => {
	return [
		{
			id: 'codex',
			displayName: 'Codex',
			description: localize('将下面内容加入 Codex 配置文件，然后重启 Codex。', 'Add this to your Codex config file, then restart Codex.'),
			preferredTransport: 'streamable-http',
			supportsAutoConfigure: Boolean(homeDir),
			restartRequired: true,
			configFormat: 'codex-toml',
			targetPath: homeDir ? joinPath(homeDir, '.codex', 'config.toml') : undefined,
		},
		{
			id: 'claude-code',
			displayName: 'Claude Code',
			description: localize('将下面内容加入 Claude Code 的 MCP 配置。', 'Add this to Claude Code MCP configuration.'),
			preferredTransport: 'streamable-http',
			supportsAutoConfigure: false,
			restartRequired: false,
			configFormat: 'mcp-json',
		},
		{
			id: 'claude-desktop',
			displayName: 'Claude Desktop',
			description: localize('将下面内容加入 Claude Desktop 连接配置，然后重启 Claude Desktop。', 'Add this to Claude Desktop connection settings, then restart Claude Desktop.'),
			preferredTransport: 'streamable-http',
			supportsAutoConfigure: Boolean(homeDir),
			restartRequired: true,
			configFormat: 'mcp-json',
			targetPath: homeDir ? joinPath(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') : undefined,
		},
		{
			id: 'cursor',
			displayName: 'Cursor',
			description: localize('将下面内容加入 Cursor 的连接配置，然后重启 Cursor。', 'Add this to Cursor connection settings, then restart Cursor.'),
			preferredTransport: 'streamable-http',
			supportsAutoConfigure: false,
			restartRequired: true,
			configFormat: 'copy-only',
		},
		{
			id: 'gemini',
			displayName: 'Gemini CLI',
			description: localize('将下面内容加入 Gemini CLI 的 MCP 配置，然后重启 Gemini CLI。', 'Add this to Gemini CLI MCP configuration, then restart Gemini CLI.'),
			preferredTransport: 'streamable-http',
			supportsAutoConfigure: Boolean(homeDir),
			restartRequired: true,
			configFormat: 'gemini-json',
			targetPath: homeDir ? joinPath(homeDir, '.gemini', 'settings.json') : undefined,
		},
		{
			id: 'grok',
			displayName: 'Grok Build',
			description: localize('将下面内容加入 Grok Build 的 MCP 配置，然后重启 Grok Build。', 'Add this to Grok Build MCP configuration, then restart Grok Build.'),
			preferredTransport: 'streamable-http',
			supportsAutoConfigure: Boolean(homeDir),
			restartRequired: true,
			configFormat: 'grok-toml',
			targetPath: homeDir ? joinPath(homeDir, '.grok', 'config.toml') : undefined,
		},
		{
			id: 'zcode',
			displayName: 'ZCode',
			description: localize('将下面内容加入 ZCode 的 MCP 配置，或在设置中直接粘贴完整配置。', 'Add this to ZCode MCP configuration, or paste the full config into Settings.'),
			preferredTransport: 'streamable-http',
			supportsAutoConfigure: Boolean(homeDir),
			restartRequired: true,
			configFormat: 'zcode-json',
			targetPath: homeDir ? joinPath(homeDir, '.zcode', 'cli', 'config.json') : undefined,
		},
		{
			id: 'custom',
			displayName: localize('自定义 MCP 工具', 'Custom MCP tool'),
			description: localize('当你的 AI 工具不在上方列表，但支持 Streamable HTTP MCP 和自定义请求头时使用。', 'Use this when your AI tool is not listed above but supports Streamable HTTP MCP with custom request headers.'),
			preferredTransport: 'streamable-http',
			supportsAutoConfigure: false,
			restartRequired: true,
			configFormat: 'copy-only',
		},
	];
};

export const buildClientConfigTexts = (
	profile: Pick<ClientProfile, 'configFormat'>,
	connectionUrl: string,
	accessToken: string
): ClientConfigTexts => {
	if (!connectionUrl.trim() || !accessToken.trim()) {
		throw new Error('Client connection configuration requires an endpoint and access credential.');
	}
	return {
		completeConfigText: buildClientConfigText(
			profile,
			connectionUrl,
			authorizationHeader(accessToken)
		),
		redactedConfigText: buildClientConfigText(
			profile,
			connectionUrl,
			'Bearer <redacted>'
		),
	};
};

export const detectClientConfigStatus = (
	profile: ClientProfile,
	content: string,
	connectionUrl: string,
	accessToken: string,
	localize: (zh: string, en: string) => string
): ClientConfigStatus => {
	const expectedAuthorization = authorizationHeader(accessToken);
	if (profile.configFormat === 'codex-toml' || profile.configFormat === 'grok-toml') {
		const block = extractCodexTomlTracekeeperBlock(content);
		if (block.length === 0) {
			return {
				state: 'not_configured',
				label: localize('未配置', 'Not configured'),
				detail: localize('配置文件中还没有 Tracekeeper 连接。', 'The config file does not include the Tracekeeper connection yet.'),
			};
		}
		const blockText = block.join('\n');
		const configuredUrl = readTomlStringValue(blockText, 'url');
		const configuredCommand = readTomlStringValue(blockText, 'command');
		if (configuredCommand) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('检测到旧版命令启动配置，需要更新为本机 MCP 地址。', 'Old command startup config detected. Update it to the local MCP URL.'),
			};
		}
		if (!configuredUrl) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('已存在 Tracekeeper 配置，但缺少连接地址。', 'Tracekeeper config exists but has no connection URL.'),
			};
		}
		if (hasQueryToken(configuredUrl)) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('连接地址仍包含已停用的查询凭据，请更新为受保护的本机连接。', 'The connection URL contains a retired query credential. Update it to the protected local connection.'),
			};
		}
		if (configuredUrl !== connectionUrl) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('已配置，但连接地址与当前设置不同。', 'Configured, but the URL differs from the current setting.'),
			};
		}
		if (
			profile.configFormat === 'grok-toml'
			&& (readTomlBooleanValue(blockText, 'enabled') === false
				|| readTomlBooleanValue(blockText, 'enable') === false)
		) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('Tracekeeper 连接已被停用。', 'The Tracekeeper connection is disabled.'),
			};
		}
		if (hasRetiredCodexCredential(blockText)) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('连接配置仍使用旧版凭据格式，请更新为受保护的本机连接。', 'The connection still uses a retired credential format. Update it to the protected local connection.'),
			};
		}
		const configuredAuthorization = profile.configFormat === 'grok-toml'
			? readGrokAuthorization(blockText)
			: readCodexAuthorization(blockText);
		if (!configuredAuthorization) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('连接配置缺少必需的访问请求头。', 'The connection is missing the required access header.'),
			};
		}
		if (configuredAuthorization !== expectedAuthorization) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('访问凭据与当前 Tracekeeper 安装不再匹配。', 'The access credential no longer matches this Tracekeeper installation.'),
			};
		}
		return {
			state: 'configured',
			label: localize('已配置', 'Configured'),
			detail: localize('受保护的连接配置已写入，保持 Obsidian 开启后即可使用。', 'Protected connection config is written. Keep Obsidian open to use it.'),
		};
	}

	if (profile.configFormat === 'gemini-json') {
		const parsed = parseMcpJsonConfig(content);
		return detectProtectedJsonServerStatus({
			server: parsed.mcpServers['tracekeeper'],
			urlKey: 'httpUrl',
			connectionUrl,
			expectedAuthorization,
			localize,
		});
	}

	if (profile.configFormat === 'zcode-json') {
		const parsed = parseZcodeJsonConfig(content);
		const imported = parseMcpJsonConfig(content);
		return detectProtectedJsonServerStatus({
			server: parsed.mcp.servers['tracekeeper'] ?? imported.mcpServers['tracekeeper'],
			urlKey: 'url',
			connectionUrl,
			expectedAuthorization,
			localize,
			requiredType: 'http',
		});
	}

	if (profile.configFormat === 'mcp-json') {
		const parsed = parseMcpJsonConfig(content);
		const server = parsed.mcpServers['tracekeeper'];
		if (!isRecord(server)) {
			return {
				state: 'not_configured',
				label: localize('未配置', 'Not configured'),
				detail: localize('配置文件中还没有 Tracekeeper 连接。', 'The config file does not include the Tracekeeper connection yet.'),
			};
		}
		const url = (server as { url?: unknown }).url;
		const command = (server as { command?: unknown }).command;
		if (typeof command === 'string' && command.trim()) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('检测到旧版命令启动配置，需要更新为本机 MCP 地址。', 'Old command startup config detected. Update it to the local MCP URL.'),
			};
		}
		if (typeof url !== 'string' || !url.trim()) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('已存在 Tracekeeper 配置，但缺少连接地址。', 'Tracekeeper config exists but has no connection URL.'),
			};
		}
		if (hasQueryToken(url)) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('连接地址仍包含已停用的查询凭据，请更新为受保护的本机连接。', 'The connection URL contains a retired query credential. Update it to the protected local connection.'),
			};
		}
		if (url.trim() !== connectionUrl) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('已配置，但连接地址与当前设置不同。', 'Configured, but the URL differs from the current setting.'),
			};
		}
		if (hasRetiredJsonCredential(server)) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('连接配置仍使用旧版凭据格式，请更新为受保护的本机连接。', 'The connection still uses a retired credential format. Update it to the protected local connection.'),
			};
		}
		const configuredAuthorization = readJsonAuthorization(server);
		if (!configuredAuthorization) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('连接配置缺少必需的访问请求头。', 'The connection is missing the required access header.'),
			};
		}
		if (configuredAuthorization !== expectedAuthorization) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('访问凭据与当前 Tracekeeper 安装不再匹配。', 'The access credential no longer matches this Tracekeeper installation.'),
			};
		}
		return {
			state: 'configured',
			label: localize('已配置', 'Configured'),
			detail: localize('受保护的连接配置已写入，保持 Obsidian 开启后即可使用。', 'Protected connection config is written. Keep Obsidian open to use it.'),
		};
	}

	return {
		state: 'not_configured',
		label: localize('未配置', 'Not configured'),
		detail: localize('需要复制配置到对应 AI 工具。', 'Copy this config into the AI tool.'),
	};
};

export const parseMcpJsonConfig = (content: string): { mcpServers: Record<string, unknown>; [key: string]: unknown } => {
	const trimmed = content.trim();
	let parsed: unknown;
	try {
		parsed = trimmed ? JSON.parse(trimmed) : {};
	} catch {
		throw new Error('Client config must be a JSON object.');
	}
	if (!isRecord(parsed)) {
		throw new Error('Client config must be a JSON object.');
	}
	const serverMap = isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
	return {
		...parsed,
		mcpServers: serverMap,
	};
};

export const parseZcodeJsonConfig = (
	content: string
): {
	mcp: {
		servers: Record<string, unknown>;
		[key: string]: unknown;
	};
	[key: string]: unknown;
} => {
	const parsed = parseJsonObject(content);
	const mcp = isRecord(parsed.mcp) ? parsed.mcp : {};
	const servers = isRecord(mcp.servers) ? mcp.servers : {};
	return {
		...parsed,
		mcp: {
			...mcp,
			servers,
		},
	};
};

export const mergeClientConfigContent = (
	config: GeneratedClientConfig,
	original: string,
	connectionUrl: string,
	accessToken: string
): string => {
	const completeConfigText = buildClientConfigTexts(config, connectionUrl, accessToken).completeConfigText;
	if (config.configFormat === 'codex-toml' || config.configFormat === 'grok-toml') {
		return trimLeadingWhitespace(`${trimTrailingWhitespace(removeCodexTomlTracekeeperBlock(original))}\n\n${completeConfigText}\n`);
	}
	if (config.configFormat === 'mcp-json' || config.configFormat === 'gemini-json') {
		const parsed = parseMcpJsonConfig(original);
		parsed.mcpServers['tracekeeper'] = config.configFormat === 'gemini-json'
			? {
				httpUrl: connectionUrl,
				headers: {
					Authorization: authorizationHeader(accessToken),
				},
			}
			: {
				url: connectionUrl,
				headers: {
					Authorization: authorizationHeader(accessToken),
				},
			};
		return `${JSON.stringify(parsed, null, 2)}\n`;
	}
	if (config.configFormat === 'zcode-json') {
		const parsed = parseZcodeJsonConfig(original);
		parsed.mcp.servers['tracekeeper'] = {
			type: 'http',
			url: connectionUrl,
			headers: {
				Authorization: authorizationHeader(accessToken),
			},
		};
		return `${JSON.stringify(parsed, null, 2)}\n`;
	}
	throw new Error(`Unsupported config format: ${config.configFormat}`);
};

export const removeClientConfigContent = (config: GeneratedClientConfig, original: string): string => {
	if (config.configFormat === 'codex-toml' || config.configFormat === 'grok-toml') {
		return `${trimTrailingWhitespace(removeCodexTomlTracekeeperBlock(original))}\n`;
	}
	if (config.configFormat === 'mcp-json' || config.configFormat === 'gemini-json') {
		const parsed = parseMcpJsonConfig(original);
		delete parsed.mcpServers['tracekeeper'];
		return `${JSON.stringify(parsed, null, 2)}\n`;
	}
	if (config.configFormat === 'zcode-json') {
		const parsed = parseZcodeJsonConfig(original);
		delete parsed.mcp.servers['tracekeeper'];
		return `${JSON.stringify(parsed, null, 2)}\n`;
	}
	throw new Error(`Unsupported config format: ${config.configFormat}`);
};

export const clientConfigStatusClass = (state: ClientConfigState): string => {
	switch (state) {
		case 'configured':
			return 'tracekeeper-badge--success';
		case 'needs_update':
			return 'tracekeeper-badge--warning';
		default:
			return 'tracekeeper-badge--muted';
	}
};

const buildClientConfigText = (
	profile: Pick<ClientProfile, 'configFormat'>,
	connectionUrl: string,
	authorization: string
): string => {
	if (profile.configFormat === 'codex-toml') {
		return [
			'[mcp_servers.tracekeeper]',
			`url = ${JSON.stringify(connectionUrl)}`,
			`http_headers.Authorization = ${JSON.stringify(authorization)}`,
		].join('\n');
	}
	if (profile.configFormat === 'grok-toml') {
		return [
			'[mcp_servers.tracekeeper]',
			`url = ${JSON.stringify(connectionUrl)}`,
			`headers = { "Authorization" = ${JSON.stringify(authorization)} }`,
		].join('\n');
	}
	if (profile.configFormat === 'gemini-json') {
		return JSON.stringify({
			mcpServers: {
				tracekeeper: {
					httpUrl: connectionUrl,
					headers: {
						Authorization: authorization,
					},
				},
			},
		}, null, 2);
	}
	if (profile.configFormat === 'zcode-json') {
		return JSON.stringify({
			mcpServers: {
				tracekeeper: {
					type: 'http',
					url: connectionUrl,
					headers: {
						Authorization: authorization,
					},
				},
			},
		}, null, 2);
	}
	const config = {
		mcpServers: {
			tracekeeper: {
				url: connectionUrl,
				headers: {
					Authorization: authorization,
				},
			},
		},
	};
	return JSON.stringify(config, null, 2);
};

const authorizationHeader = (accessToken: string): string => `Bearer ${accessToken}`;

const removeCodexTomlTracekeeperBlock = (content: string): string => {
	const lines = content.split(/\r?\n/);
	const nextLines: string[] = [];
	let skipping = false;
	for (const line of lines) {
		if (isTracekeeperCodexTomlHeader(line)) {
			skipping = true;
			continue;
		}
		if (skipping && isTomlHeader(line)) {
			skipping = false;
		}
		if (!skipping) {
			nextLines.push(line);
		}
	}
	return nextLines.join('\n');
};

const extractCodexTomlTracekeeperBlock = (content: string): string[] => {
	const lines = content.split(/\r?\n/);
	const block: string[] = [];
	let collecting = false;
	for (const line of lines) {
		if (isTracekeeperCodexTomlHeader(line)) {
			collecting = true;
			block.push(line);
			continue;
		}
		if (collecting && isTomlHeader(line)) {
			break;
		}
		if (collecting) {
			block.push(line);
		}
	}
	return block;
};

const readCodexAuthorization = (content: string): string | null =>
	readTomlAuthorization(content, 'http_headers');

const readGrokAuthorization = (content: string): string | null =>
	readTomlAuthorization(content, 'headers');

const readTomlAuthorization = (content: string, headersKey: string): string | null => {
	const escapedHeadersKey = headersKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const dottedMatch = content.match(new RegExp(
		`^\\s*${escapedHeadersKey}\\.(?:"authorization"|'authorization'|authorization)\\s*=\\s*(.+?)\\s*$`,
		'im'
	));
	if (dottedMatch) {
		return parseTomlStringValue(dottedMatch[1]);
	}
	const inlineMatch = content.match(new RegExp(
		`^\\s*${escapedHeadersKey}\\s*=\\s*\\{(.+)\\}\\s*$`,
		'im'
	));
	if (inlineMatch) {
		const authorizationMatch = inlineMatch[1].match(
			/(?:^|,)\s*(?:"authorization"|'authorization'|authorization)\s*=\s*("(?:\\.|[^"])*"|'[^']*'|[^,}]+)\s*(?:,|$)/i
		);
		if (authorizationMatch) {
			return parseTomlStringValue(authorizationMatch[1]);
		}
	}
	const lines = content.split(/\r?\n/);
	let inHeaderTable = false;
	for (const line of lines) {
		if (isTracekeeperHeadersTomlHeader(line, headersKey)) {
			inHeaderTable = true;
			continue;
		}
		if (inHeaderTable && isTomlHeader(line)) {
			inHeaderTable = false;
		}
		if (inHeaderTable) {
			const match = line.match(/^\s*(?:"authorization"|'authorization'|authorization)\s*=\s*(.+?)\s*$/i);
			if (match) {
				return parseTomlStringValue(match[1]);
			}
		}
	}
	return null;
};

const readTomlStringValue = (content: string, key: string): string | null => {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = content.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.+?)\\s*$`, 'im'));
	if (!match) {
		return null;
	}
	return parseTomlStringValue(match[1]);
};

const readTomlBooleanValue = (content: string, key: string): boolean | null => {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = content.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*(true|false)\\s*$`, 'im'));
	return match ? match[1].toLowerCase() === 'true' : null;
};

const parseTomlStringValue = (value: string): string | null => {
	const rawValue = value.trim();
	if (rawValue.startsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(rawValue);
			return typeof parsed === 'string' ? parsed : null;
		} catch {
			return rawValue.replace(/^"|"$/g, '');
		}
	}
	return rawValue.replace(/^['"]|['"]$/g, '');
};

const isTracekeeperCodexTomlHeader = (line: string): boolean => {
	return /^\s*\[mcp_servers\.(?:"tracekeeper"|'tracekeeper'|tracekeeper)(?:\.[^\]]+)?\]\s*$/.test(line);
};

const isTracekeeperHeadersTomlHeader = (line: string, headersKey: string): boolean => {
	const escapedHeadersKey = headersKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(
		`^\\s*\\[mcp_servers\\.(?:"tracekeeper"|'tracekeeper'|tracekeeper)\\.${escapedHeadersKey}\\]\\s*$`,
		'i'
	).test(line);
};

const isTomlHeader = (line: string): boolean => {
	return /^\s*\[[^\]]+\]\s*$/.test(line);
};

const trimTrailingWhitespace = (value: string): string => value.replace(/\s+$/, '');
const trimLeadingWhitespace = (value: string): string => value.replace(/^\s+/, '');

const hasQueryToken = (url: string): boolean => {
	try {
		return Array.from(new URL(url).searchParams.keys()).some((key) => key.toLowerCase() === 'token');
	} catch {
		return /[?&]token=/i.test(url);
	}
};

const hasRetiredCodexCredential = (content: string): boolean =>
	/^\s*(?:token|bearer_token|bearer_token_env_var)\s*=/im.test(content);

const readJsonAuthorization = (server: Record<string, unknown>): string | null => {
	if (!isRecord(server.headers)) {
		return null;
	}
	for (const [key, value] of Object.entries(server.headers)) {
		if (key.trim().toLowerCase() === 'authorization') {
			return typeof value === 'string' && value.trim() ? value.trim() : null;
		}
	}
	return null;
};

const hasRetiredJsonCredential = (server: Record<string, unknown>): boolean => {
	for (const [key, value] of Object.entries(server)) {
		const normalizedKey = key.trim().toLowerCase();
		if (
			normalizedKey === 'token'
			|| normalizedKey === 'authorization'
			|| normalizedKey === 'bearer_token'
			|| normalizedKey === 'bearertoken'
		) {
			return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null;
		}
	}
	if (!isRecord(server.headers)) {
		return false;
	}
	return Object.entries(server.headers).some(([key, value]) => {
		const normalizedKey = key.trim().toLowerCase();
		if (normalizedKey === 'token' || normalizedKey === 'bearer_token' || normalizedKey === 'bearertoken') {
			return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null;
		}
		return false;
	});
};

const detectProtectedJsonServerStatus = ({
	server,
	urlKey,
	connectionUrl,
	expectedAuthorization,
	localize,
	requiredType,
}: {
	server: unknown;
	urlKey: string;
	connectionUrl: string;
	expectedAuthorization: string;
	localize: (zh: string, en: string) => string;
	requiredType?: string;
}): ClientConfigStatus => {
	if (!isRecord(server)) {
		return {
			state: 'not_configured',
			label: localize('未配置', 'Not configured'),
			detail: localize('配置文件中还没有 Tracekeeper 连接。', 'The config file does not include the Tracekeeper connection yet.'),
		};
	}
	const command = server.command;
	if (typeof command === 'string' && command.trim()) {
		return {
			state: 'needs_update',
			label: localize('需更新', 'Needs update'),
			detail: localize('检测到旧版命令启动配置，需要更新为本机 MCP 地址。', 'Old command startup config detected. Update it to the local MCP URL.'),
		};
	}
	if (server.enabled === false || server.enable === false) {
		return {
			state: 'needs_update',
			label: localize('需更新', 'Needs update'),
			detail: localize('Tracekeeper 连接已被停用。', 'The Tracekeeper connection is disabled.'),
		};
	}
	if (
		requiredType
		&& (typeof server.type !== 'string' || server.type.trim().toLowerCase() !== requiredType)
	) {
		return {
			state: 'needs_update',
			label: localize('需更新', 'Needs update'),
			detail: localize('连接类型不是受支持的 Streamable HTTP 配置。', 'The connection type is not the supported Streamable HTTP configuration.'),
		};
	}
	const configuredUrl = server[urlKey];
	if (typeof configuredUrl !== 'string' || !configuredUrl.trim()) {
		return {
			state: 'needs_update',
			label: localize('需更新', 'Needs update'),
			detail: localize('已存在 Tracekeeper 配置，但缺少连接地址。', 'Tracekeeper config exists but has no connection URL.'),
		};
	}
	if (hasQueryToken(configuredUrl)) {
		return {
			state: 'needs_update',
			label: localize('需更新', 'Needs update'),
			detail: localize('连接地址仍包含已停用的查询凭据，请更新为受保护的本机连接。', 'The connection URL contains a retired query credential. Update it to the protected local connection.'),
		};
	}
	if (configuredUrl.trim() !== connectionUrl) {
		return {
			state: 'needs_update',
			label: localize('需更新', 'Needs update'),
			detail: localize('已配置，但连接地址与当前设置不同。', 'Configured, but the URL differs from the current setting.'),
		};
	}
	if (hasRetiredJsonCredential(server)) {
		return {
			state: 'needs_update',
			label: localize('需更新', 'Needs update'),
			detail: localize('连接配置仍使用旧版凭据格式，请更新为受保护的本机连接。', 'The connection still uses a retired credential format. Update it to the protected local connection.'),
		};
	}
	const configuredAuthorization = readJsonAuthorization(server);
	if (!configuredAuthorization) {
		return {
			state: 'needs_update',
			label: localize('需更新', 'Needs update'),
			detail: localize('连接配置缺少必需的访问请求头。', 'The connection is missing the required access header.'),
		};
	}
	if (configuredAuthorization !== expectedAuthorization) {
		return {
			state: 'needs_update',
			label: localize('需更新', 'Needs update'),
			detail: localize('访问凭据与当前 Tracekeeper 安装不再匹配。', 'The access credential no longer matches this Tracekeeper installation.'),
		};
	}
	return {
		state: 'configured',
		label: localize('已配置', 'Configured'),
		detail: localize('受保护的连接配置已写入，保持 Obsidian 开启后即可使用。', 'Protected connection config is written. Keep Obsidian open to use it.'),
	};
};

const parseJsonObject = (content: string): Record<string, unknown> => {
	const trimmed = content.trim();
	let parsed: unknown;
	try {
		parsed = trimmed ? JSON.parse(trimmed) : {};
	} catch {
		throw new Error('Client config must be a JSON object.');
	}
	if (!isRecord(parsed)) {
		throw new Error('Client config must be a JSON object.');
	}
	return parsed;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
