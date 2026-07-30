import { App, Modal, Notice } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import { ui } from '../../ui/localization';
import { renderClientSkillPrompt } from '../skill-installation/client-skill-prompt';
import type {
	ClientPairingState,
	ClientPairingTicket,
	ClientPairingTicketStatus,
	ClientSetupCapability,
	GeneratedClientConfig,
} from './client-config';

export class ConnectAiToolModal extends Modal {
	private panelEl: HTMLElement | null = null;
	private pairingTicket: ClientPairingTicket | null = null;
	private pairingStatus: ClientPairingTicketStatus | null = null;
	private pairingState: ClientPairingState | null = null;
	private pairingLoading = false;
	private pairingPollInFlight = false;
	private pairingPollTimer: number | null = null;
	private closed = false;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private config: GeneratedClientConfig,
		private mode: 'add' | 'manage',
		private onChanged?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.closed = false;
		contentEl.empty();
		contentEl.addClass('tracekeeper-connect-ai-tool-modal');
		contentEl.createEl('h2', {
			text: this.mode === 'add'
				? ui(`添加 ${this.config.displayName}`, `Add ${this.config.displayName}`)
				: ui(`管理 ${this.config.displayName}`, `Manage ${this.config.displayName}`),
		});
		contentEl.createEl('p', {
			text: this.mode === 'add'
				? ui(
					'使用该 Agent 已验证的原生入口。只有同一个外部 Session 完成初始化并成功调用 Tracekeeper 后，Agent 才会出现在主列表。',
					'Use the verified native entry for this Agent. It appears in the main list only after the same external Session initializes and successfully calls Tracekeeper.'
				)
				: ui(
					'这里展示该 Agent 的连接入口和独立 Skill 状态；配对或 Skill 安装都不会替代真实使用验证。',
					'This shows the Agent connection entry and its independent Skill state. Pairing or Skill installation never replaces real-use verification.'
				),
			cls: 'tracekeeper-view__description',
		});
		this.panelEl = contentEl.createDiv({
			cls: 'tracekeeper-connect-ai-tool-modal__panel',
		});
		this.renderClientPanel();
		contentEl.querySelector<HTMLButtonElement>('button')?.focus();
	}

	onClose(): void {
		this.closed = true;
		this.stopPairingPolling();
		this.pairingTicket = null;
		this.pairingStatus = null;
		this.panelEl = null;
		this.contentEl.empty();
	}

	private renderClientPanel(): void {
		const container = this.panelEl;
		if (!container) {
			return;
		}
		container.empty();
		const header = container.createDiv({
			cls: 'tracekeeper-connect-ai-tool-modal__header',
			attr: {
				'aria-live': 'polite',
			},
		});
		header.createEl('h3', { text: this.config.displayName });
		header.createEl('span', {
			text: this.connectionStatusLabel(),
			cls: `tracekeeper-badge ${this.connectionStatusClass()}`,
		});
		container.createEl('p', {
			text: this.config.description,
			cls: 'tracekeeper-view__description',
		});

		const details = container.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(
			details,
			ui('连接入口', 'Connection entry'),
			this.setupCapabilityLabel(this.config.setupCapability)
		);
		this.renderDetail(
			details,
			ui('凭据交付', 'Credential delivery'),
			this.config.supportsLocalOAuth
				? ui('本机 OAuth + PKCE S256', 'Local OAuth + PKCE S256')
				: ui('不支持自动授权', 'Automatic authorization unavailable')
		);

		this.renderSetupGuidance(container);
		if (this.config.supportsLocalOAuth) {
			this.renderPairingSection(container);
		} else {
				container.createEl('p', {
					text: ui(
						'当前没有经过验证的自动授权路径。Tracekeeper 只提供公开的 127.0.0.1 端点，不会显示或复制长期访问凭据或客户端配置路径。',
						'No automatic authorization path is verified. Tracekeeper provides only the public 127.0.0.1 endpoint and never displays or copies long-lived access credentials or client configuration paths.'
					),
				cls: 'tracekeeper-view__description',
			});
		}

		const actions = container.createDiv({
			cls: 'modal-button-container tracekeeper-connect-ai-tool-modal__actions',
		});
		this.renderConnectionActions(actions);
		renderClientSkillPrompt({
			app: this.app,
			plugin: this.plugin,
			container,
			config: this.config,
			onChanged: () => {
				this.onChanged?.();
				this.renderClientPanel();
			},
		});
	}

	private renderSetupGuidance(container: HTMLElement): void {
		container.createEl('p', {
			text: this.config.supportsLocalOAuth
				? ui('官方连接命令', 'Official connection command')
				: ui('本机 MCP 端点', 'Local MCP endpoint'),
			cls: 'tracekeeper-connect-ai-tool-modal__preview-label',
		});
		container.createEl('pre', {
			text: this.config.setupInstruction,
			cls: 'tracekeeper-code-block',
			attr: {
				'aria-label': this.config.supportsLocalOAuth
					? ui('公开的官方连接命令', 'Public official connection command')
					: ui('公开的本机 MCP 端点', 'Public local MCP endpoint'),
			},
		});
		if (this.config.setupFollowup) {
			container.createEl('p', {
				text: this.config.setupFollowup,
				cls: 'tracekeeper-view__description',
			});
		}
	}

	private renderPairingSection(container: HTMLElement): void {
		const section = container.createDiv({
			cls: 'tracekeeper-settings-client-skill',
			attr: {
				'aria-live': 'polite',
			},
		});
		section.createEl('strong', {
			text: ui('本机配对', 'Local pairing'),
		});
		if (this.pairingLoading) {
			section.createEl('p', {
				text: ui('正在生成一次性配对码...', 'Generating a one-time pairing code...'),
				cls: 'tracekeeper-view__description',
			});
			return;
		}
		if (this.pairingState === 'ready' && this.pairingTicket) {
			section.createEl('p', {
				text: ui(
					'在客户端打开的本机授权页中手工输入此码。请勿复制给 AI、终端或聊天。',
					'Type this code by hand into the local authorization page opened by the client. Do not copy it to an AI, terminal, or chat.'
				),
				cls: 'tracekeeper-view__description',
			});
			section.createEl('code', {
				text: this.pairingTicket.code,
				cls: 'tracekeeper-code-block',
				attr: {
					'aria-label': ui('一次性配对码', 'One-time pairing code'),
				},
			});
			const remaining = this.pairingStatus?.attemptsRemaining;
			section.createEl('p', {
				text: typeof remaining === 'number'
					? ui(
						`有效至 ${this.formatTime(this.pairingTicket.expiresAt)}，剩余 ${remaining} 次尝试。`,
						`Valid until ${this.formatTime(this.pairingTicket.expiresAt)} with ${remaining} attempts remaining.`
					)
					: ui(
						`有效至 ${this.formatTime(this.pairingTicket.expiresAt)}。`,
						`Valid until ${this.formatTime(this.pairingTicket.expiresAt)}.`
					),
				cls: 'tracekeeper-view__description',
			});
			return;
		}
		section.createEl('p', {
			text: this.pairingStateDetail(),
			cls: 'tracekeeper-view__description',
		});
	}

	private renderConnectionActions(actions: HTMLElement): void {
		const copy = actions.createEl('button', {
			text: this.config.supportsLocalOAuth
				? ui('复制终端 / AI 指令', 'Copy terminal / AI instruction')
				: ui('复制本机端点', 'Copy local endpoint'),
			cls: this.config.supportsLocalOAuth ? 'mod-cta' : undefined,
		});
		copy.addEventListener('click', () => {
			copy.disabled = true;
			void this.plugin.copyToClipboard(
				this.config.setupInstruction,
				this.config.supportsLocalOAuth
					? ui('已复制公开的官方连接命令。', 'Public official connection command copied.')
					: ui('已复制公开的本机端点。', 'Public local endpoint copied.')
			).catch(() => {
				copy.disabled = false;
				new Notice(ui('复制失败。', 'Copy failed.'));
			});
		});

		if (
			this.config.supportsLocalOAuth
			&& (this.pairingState === null
				|| this.pairingState === 'expired'
				|| this.pairingState === 'failed'
				|| this.pairingState === 'retry')
			&& !this.pairingLoading
		) {
			const retry = actions.createEl('button', {
				text: this.mode === 'manage' && this.pairingState === null
					? ui('重新配对', 'Pair again')
					: ui('生成新配对码', 'Generate new pairing code'),
			});
			retry.addEventListener('click', () => {
				void this.beginPairing();
			});
		}
	}

	private async beginPairing(): Promise<void> {
		if (!this.config.supportsLocalOAuth || this.pairingLoading) {
			return;
		}
		this.stopPairingPolling();
		this.pairingTicket = null;
		this.pairingStatus = null;
		this.pairingState = null;
		this.pairingLoading = true;
		this.renderClientPanel();
		try {
			const ticket = await this.plugin.issueAgentPairingTicket(this.config.clientId);
			if (this.closed) {
				return;
			}
			if (
				ticket.expectedClientId !== undefined
				&& ticket.expectedClientId !== this.config.clientId
			) {
				this.pairingLoading = false;
				this.pairingState = 'retry';
				this.renderClientPanel();
				return;
			}
			this.pairingTicket = ticket;
			this.pairingState = 'ready';
			this.pairingLoading = false;
			this.renderClientPanel();
			this.startPairingPolling();
		} catch {
			if (this.closed) {
				return;
			}
			this.pairingLoading = false;
			this.pairingState = 'retry';
			this.renderClientPanel();
		}
	}

	private startPairingPolling(): void {
		this.stopPairingPolling();
		this.pairingPollTimer = window.setInterval(() => {
			void this.refreshPairingStatus();
		}, 1_000);
		void this.refreshPairingStatus();
	}

	private stopPairingPolling(): void {
		if (this.pairingPollTimer !== null) {
			window.clearInterval(this.pairingPollTimer);
			this.pairingPollTimer = null;
		}
	}

	private async refreshPairingStatus(): Promise<void> {
		const ticket = this.pairingTicket;
		if (!ticket || this.pairingPollInFlight || this.closed) {
			return;
		}
		this.pairingPollInFlight = true;
		try {
			const status = await this.plugin.getAgentPairingTicketStatus(ticket.id);
			if (this.closed || this.pairingTicket?.id !== ticket.id) {
				return;
			}
			if (!status) {
				this.finishPairingState('expired');
				return;
			}
			if (
				status.id !== ticket.id
				|| (status.expectedClientId !== undefined
					&& status.expectedClientId !== this.config.clientId)
			) {
				this.finishPairingState('retry');
				return;
			}
			const statusChanged = this.pairingStatus?.state !== status.state
				|| this.pairingStatus?.attemptsRemaining !== status.attemptsRemaining;
			this.pairingStatus = status;
			switch (status.state) {
				case 'pending':
					this.pairingState = 'ready';
					if (statusChanged) {
						this.renderClientPanel();
					}
					break;
				case 'awaiting_confirmation':
					this.pairingState = 'awaiting_confirmation';
					if (statusChanged) {
						this.renderClientPanel();
					}
					break;
				case 'authorized':
					this.finishPairingState('redeemed');
					break;
				case 'expired':
					this.finishPairingState('expired');
					break;
				case 'attempts_exhausted':
					this.finishPairingState('failed');
					break;
			}
		} catch {
			if (!this.closed && this.pairingTicket?.id === ticket.id) {
				this.finishPairingState('retry');
			}
		} finally {
			this.pairingPollInFlight = false;
		}
	}

	private finishPairingState(state: ClientPairingState): void {
		this.stopPairingPolling();
		this.pairingState = state;
		this.pairingTicket = null;
		this.renderClientPanel();
	}

	private connectionStatusLabel(): string {
		if (this.mode === 'manage' && this.pairingState === null) {
			return ui('已正常使用', 'Successfully used');
		}
		if (!this.config.supportsLocalOAuth) {
			return ui('手工设置', 'Manual setup');
		}
		if (this.pairingLoading) {
			return ui('准备配对', 'Preparing pairing');
		}
		if (this.pairingState === null) {
			return ui('待生成配对码', 'Pairing code not generated');
		}
		switch (this.pairingState) {
			case 'ready':
				return ui('配对码可用', 'Pairing code ready');
			case 'awaiting_confirmation':
				return ui('等待授权页确认', 'Awaiting authorization confirmation');
			case 'redeemed':
				return ui('OAuth 已完成', 'OAuth complete');
			case 'expired':
				return ui('配对码已过期', 'Pairing code expired');
			case 'failed':
				return ui('配对失败', 'Pairing failed');
			case 'retry':
				return ui('需要重试', 'Retry required');
		}
	}

	private connectionStatusClass(): string {
		if (this.mode === 'manage' && this.pairingState === null) {
			return 'tracekeeper-badge--success';
		}
		if (!this.config.supportsLocalOAuth) {
			return 'tracekeeper-badge--muted';
		}
		if (this.pairingState === 'redeemed') {
			return 'tracekeeper-badge--success';
		}
		if (this.pairingState === 'failed' || this.pairingState === 'expired') {
			return 'tracekeeper-badge--error';
		}
		return 'tracekeeper-badge--warning';
	}

	private pairingStateDetail(): string {
		switch (this.pairingState) {
			case 'redeemed':
				return ui(
					'OAuth 授权已完成。Agent 仍需在同一个 Session 中成功调用一次 Tracekeeper，才会进入主列表。',
					'OAuth authorization is complete. The Agent must still successfully call Tracekeeper in the same Session before it appears in the main list.'
				);
			case 'awaiting_confirmation':
				return ui(
					'授权页已经接受配对码。请在该页面完成确认，无需再次输入配对码。',
					'The authorization page accepted the pairing code. Complete confirmation on that page; do not enter the code again.'
				);
			case 'expired':
				return ui('配对码已过期，请生成新码。', 'The pairing code expired. Generate a new code.');
			case 'failed':
				return ui('尝试次数已用完，请生成新码。', 'All attempts were used. Generate a new code.');
			case 'retry':
				return ui('暂时无法读取配对状态，请重新生成配对码。', 'Pairing status is temporarily unavailable. Generate a new pairing code.');
			default:
				return this.mode === 'manage'
					? ui('需要重新授权时再生成一次性配对码。', 'Generate a one-time pairing code only when reauthorization is needed.')
					: ui(
						'先运行公开的官方连接命令。客户端打开本机授权页后，再生成一次性配对码并手工输入。',
						'Run the public official connection command first. After the client opens the local authorization page, generate a one-time pairing code and type it by hand.'
					);
		}
	}

	private setupCapabilityLabel(capability: ClientSetupCapability): string {
		switch (capability) {
			case 'oauth-cli':
				return ui('官方 OAuth CLI', 'Official OAuth CLI');
			case 'oauth-link':
				return ui('官方 OAuth 链接', 'Official OAuth link');
			case 'extension':
				return ui('原生扩展', 'Native extension');
			case 'native-gui':
				return ui('客户端设置', 'Client settings');
			case 'manual':
				return ui('手工连接', 'Manual connection');
		}
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}

	private formatTime(value: string): string {
		const time = new Date(value);
		return Number.isNaN(time.getTime()) ? value : time.toLocaleTimeString();
	}
}
