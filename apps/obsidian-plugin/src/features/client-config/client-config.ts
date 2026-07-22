export type ClientConfigState = 'configured' | 'needs_update' | 'not_configured' | 'unavailable';

export type ClientConnectionTransport = 'streamable-http';
export type ClientConfigFormat = 'codex-toml' | 'mcp-json' | 'copy-only';

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
	configText: string;
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
			id: 'custom',
			displayName: localize('自定义 MCP 工具', 'Custom MCP tool'),
			description: localize('当你的 AI 工具不在上方列表，但支持填写 MCP 地址时使用。', 'Use this when your AI tool is not listed above but supports an MCP URL.'),
			preferredTransport: 'streamable-http',
			supportsAutoConfigure: false,
			restartRequired: true,
			configFormat: 'copy-only',
		},
	];
};

export const buildClientConfigText = (
	profile: ClientProfile,
	getConnectionUrl: (clientId: string) => string
): string => {
	const connectionUrl = getConnectionUrl(profile.id);
	if (profile.configFormat === 'codex-toml') {
		return [
			'[mcp_servers.tracekeeper]',
			`url = ${JSON.stringify(connectionUrl)}`,
		].join('\n');
	}

	const config = {
		mcpServers: {
			tracekeeper: {
				url: connectionUrl,
			},
		},
		client: profile.id,
	};
	return JSON.stringify(config, null, 2);
};

export const detectClientConfigStatus = (
	profile: ClientProfile,
	content: string,
	connectionUrl: string,
	localize: (zh: string, en: string) => string
): ClientConfigStatus => {
	if (profile.configFormat === 'codex-toml') {
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
		if (configuredUrl !== connectionUrl) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('已配置，但连接地址或本地令牌与当前设置不同。', 'Configured, but the URL or local token differs from the current setting.'),
			};
		}
		return {
			state: 'configured',
			label: localize('已配置', 'Configured'),
			detail: localize('连接配置已写入，保持 Obsidian 开启后即可使用。', 'Connection config is written. Keep Obsidian open to use it.'),
		};
	}

	if (profile.configFormat === 'mcp-json') {
		const parsed = parseMcpJsonConfig(content);
		const server = parsed.mcpServers['tracekeeper'];
		if (!server || typeof server !== 'object' || Array.isArray(server)) {
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
		if (url.trim() !== connectionUrl) {
			return {
				state: 'needs_update',
				label: localize('需更新', 'Needs update'),
				detail: localize('已配置，但连接地址或本地令牌与当前设置不同。', 'Configured, but the URL or local token differs from the current setting.'),
			};
		}
		return {
			state: 'configured',
			label: localize('已配置', 'Configured'),
			detail: localize('连接配置已写入，保持 Obsidian 开启后即可使用。', 'Connection config is written. Keep Obsidian open to use it.'),
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

export const mergeClientConfigContent = (
	config: GeneratedClientConfig,
	original: string,
	getConnectionUrl: (clientId: string) => string
): string => {
	if (config.configFormat === 'codex-toml') {
		return trimLeadingWhitespace(`${trimTrailingWhitespace(removeCodexTomlTracekeeperBlock(original))}\n\n${config.configText}\n`);
	}
	if (config.configFormat === 'mcp-json') {
		const parsed = parseMcpJsonConfig(original);
		parsed.mcpServers['tracekeeper'] = {
			url: getConnectionUrl(config.clientId),
		};
		return `${JSON.stringify(parsed, null, 2)}\n`;
	}
	throw new Error(`Unsupported config format: ${config.configFormat}`);
};

export const removeClientConfigContent = (config: GeneratedClientConfig, original: string): string => {
	if (config.configFormat === 'codex-toml') {
		return `${trimTrailingWhitespace(removeCodexTomlTracekeeperBlock(original))}\n`;
	}
	if (config.configFormat === 'mcp-json') {
		const parsed = parseMcpJsonConfig(original);
		delete parsed.mcpServers['tracekeeper'];
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

const readTomlStringValue = (content: string, key: string): string | null => {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = content.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.+?)\\s*$`, 'm'));
	if (!match) {
		return null;
	}
	const rawValue = match[1].trim();
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
	return /^\s*\[mcp_servers\.(?:"tracekeeper"|'tracekeeper'|tracekeeper)\]\s*$/.test(line);
};

const isTomlHeader = (line: string): boolean => {
	return /^\s*\[[^\]]+\]\s*$/.test(line);
};

const trimTrailingWhitespace = (value: string): string => value.replace(/\s+$/, '');
const trimLeadingWhitespace = (value: string): string => value.replace(/^\s+/, '');

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
