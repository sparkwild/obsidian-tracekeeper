import type { RuntimeState } from '@tracekeeper/mcp-runtime';

type Localize = (zh: string, en: string) => string;

const defaultLocalize: Localize = (_zh, en) => en;

export type RuntimeUiState = 'disabled' | 'stopped-enabled' | 'starting' | 'running' | 'stopping' | 'port_conflict' | 'failed';
export type RuntimeUiTone = 'default' | 'success' | 'warning' | 'danger' | 'disabled';
export type RuntimePrimaryAction = 'enable' | 'retry' | 'none';

export interface RuntimeViewModelInput {
	enabled: boolean;
	state: RuntimeState;
	port: number;
	lastError?: string;
}

export interface RuntimeViewModel {
	state: RuntimeUiState;
	label: string;
	detail: string;
	tone: RuntimeUiTone;
	busy: boolean;
	primaryAction: RuntimePrimaryAction;
	canEditPort: boolean;
	canOpenLogs: boolean;
}

export const runtimeToneBadgeClass = (tone: RuntimeUiTone): string => {
	switch (tone) {
		case 'success':
			return 'tracekeeper-badge--success';
		case 'warning':
			return 'tracekeeper-badge--warning';
		case 'danger':
			return 'tracekeeper-badge--error';
		case 'disabled':
		case 'default':
		default:
			return 'tracekeeper-badge--muted';
	}
};

const safePort = (port: number): number => (Number.isFinite(port) ? port : 0);

const deriveUiState = (input: RuntimeViewModelInput): RuntimeUiState => {
	if (!input.enabled) {
		return 'disabled';
	}
	return input.state === 'stopped' ? 'stopped-enabled' : input.state;
};

const labelFor = (state: RuntimeUiState, localize: Localize): string => {
	switch (state) {
		case 'disabled':
			return localize('已关闭', 'Off');
		case 'stopped-enabled':
			return localize('未运行', 'Not running');
		case 'starting':
			return localize('启动中', 'Starting');
		case 'running':
			return localize('运行中', 'Running');
		case 'stopping':
			return localize('正在关闭', 'Stopping');
		case 'port_conflict':
			return localize('端口被占用', 'Port in use');
		case 'failed':
			return localize('启动失败', 'Failed');
		default:
			return localize('未知', 'Unknown');
	}
};

const detailFor = (state: RuntimeUiState, input: RuntimeViewModelInput, localize: Localize): string => {
	const port = safePort(input.port);
	switch (state) {
		case 'disabled':
			return localize(
				'MCP 服务已关闭。需要 AI 工具连接时可在插件设置中重新开启。',
				'MCP service is off. Turn it back on in plugin settings when AI tools need to connect.'
			);
		case 'stopped-enabled':
			return localize(
				'MCP 服务未运行。插件启用且 Obsidian 打开后会自动启动。',
				'The MCP service is not running. It starts automatically when the plugin is enabled and Obsidian is open.'
			);
		case 'starting':
			return localize('MCP 服务正在启动。', 'The MCP service is starting.');
		case 'running':
			return localize(
				'Obsidian 已托管本机 MCP 服务，AI 工具可在 Obsidian 开启时连接。',
				'Obsidian is hosting the local MCP service. AI tools can connect while Obsidian is open.'
			);
		case 'stopping':
			return localize(
				'MCP 服务正在停止接受新连接并关闭现有会话。',
				'MCP service is stopping new connections and closing existing sessions.'
			);
		case 'port_conflict':
			return localize(
				`端口 ${port} 已被占用，可能由另一个 Obsidian Vault 或本机程序使用。请为当前 Vault 选择其他端口，或关闭占用方。`,
				`Port ${port} is already used, possibly by another Obsidian Vault or local process. Choose another port for this Vault or stop the owner.`
			);
		case 'failed':
			return localize(
				'MCP 服务启动失败。请重试；如果问题持续存在，请查看技术信息或 Obsidian 控制台。',
				'MCP service failed to start. Retry, then check Technical details or the Obsidian console if the problem persists.'
			);
		default:
			return localize('MCP 状态未知。', 'MCP status is unknown.');
	}
};

const toneFor = (state: RuntimeUiState): RuntimeUiTone => {
	switch (state) {
		case 'disabled':
			return 'disabled';
		case 'running':
			return 'success';
		case 'starting':
		case 'stopping':
			return 'warning';
		case 'port_conflict':
		case 'failed':
			return 'danger';
		case 'stopped-enabled':
		default:
			return 'default';
	}
};

const busyFor = (state: RuntimeUiState): boolean => state === 'starting' || state === 'stopping';

const primaryActionFor = (state: RuntimeUiState): RuntimePrimaryAction => {
	switch (state) {
		case 'disabled':
			return 'enable';
		case 'stopped-enabled':
		case 'failed':
		case 'port_conflict':
			return 'retry';
		default:
			return 'none';
	}
};

const canEditPortFor = (state: RuntimeUiState): boolean => state === 'port_conflict';
const canOpenLogsFor = (state: RuntimeUiState): boolean => state === 'failed' || state === 'port_conflict';

export function runtimeViewModel(
	input: RuntimeViewModelInput,
	localize: Localize = defaultLocalize
): RuntimeViewModel {
	const state = deriveUiState(input);
	return {
		state,
		label: labelFor(state, localize),
		detail: detailFor(state, input, localize),
		tone: toneFor(state),
		busy: busyFor(state),
		primaryAction: primaryActionFor(state),
		canEditPort: canEditPortFor(state),
		canOpenLogs: canOpenLogsFor(state),
	};
}
