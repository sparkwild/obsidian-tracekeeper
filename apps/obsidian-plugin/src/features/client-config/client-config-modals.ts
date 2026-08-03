import { App, Modal, Notice } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import { ui } from '../../ui/localization';
import { renderClientSkillPrompt } from '../skill-installation/client-skill-prompt';
import {
	buildConnectionPresentation,
	type ConnectionClipboardState,
	type ConnectionPresentation,
	type ConnectionUiState,
} from './agent-connection-view-model';
import type {
	ClientPairingState,
	ClientPairingTicket,
	ClientPairingTicketStatus,
	ClientSetupCapability,
	GeneratedClientConfig,
} from './client-config';

export class ConnectAiToolModal extends Modal {
	private panelEl: HTMLElement | null = null;
	private technicalDetailsEl: HTMLDetailsElement | null = null;
	private pairingTicket: ClientPairingTicket | null = null;
	private pairingStatus: ClientPairingTicketStatus | null = null;
	private pairingMetaEl: HTMLElement | null = null;
	private pairingState: ClientPairingState | null = null;
	private clipboardState: ConnectionClipboardState = 'idle';
	private pairingLoading = false;
	private pairingPollInFlight = false;
	private pairingPollTimer: number | null = null;
	private closed = false;
	private lastRenderedState: ConnectionUiState | null = null;
	private modalKeydownHandler: ((event: KeyboardEvent) => void) | null = null;

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
		this.modalEl.setAttribute('role', 'dialog');
		this.modalEl.setAttribute('aria-modal', 'true');
		this.modalKeydownHandler = (event) => {
			if (event.key !== 'Tab') {
				return;
			}
			const focusable = this.getFocusableModalElements();
			if (focusable.length === 0) {
				return;
			}
			const current = event.target instanceof HTMLElement
				? event.target
				: document.activeElement as HTMLElement | null;
			const currentIndex = current ? focusable.indexOf(current) : -1;
			const nextIndex = event.shiftKey
				? currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
				: currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;
			if (
				currentIndex < 0
				|| (event.shiftKey && currentIndex === 0)
				|| (!event.shiftKey && currentIndex === focusable.length - 1)
			) {
				event.preventDefault();
				focusable[nextIndex]?.focus();
			}
		};
		this.modalEl.addEventListener('keydown', this.modalKeydownHandler, true);
		this.pairingTicket = null;
		this.pairingStatus = null;
		this.pairingMetaEl = null;
		this.pairingState = null;
		this.clipboardState = 'idle';
		this.pairingLoading = false;
		this.lastRenderedState = null;
		contentEl.empty();
		contentEl.addClass('tracekeeper-connect-ai-tool-modal');
		contentEl.createEl('h2', {
			text: this.mode === 'add'
				? ui(`连接 ${this.config.displayName}`, `Connect ${this.config.displayName}`)
				: ui(`管理 ${this.config.displayName}`, `Manage ${this.config.displayName}`),
		});
		contentEl.createEl('p', {
			text: this.mode === 'add'
				? ui(
					`完成一次本机授权后，${this.config.displayName} 才能使用 Tracekeeper。`,
					`Complete local authorization before ${this.config.displayName} can use Tracekeeper.`
				)
				: ui(
					`查看 ${this.config.displayName} 的使用状态和可选使用指南。需要重新授权时，再开始连接。`,
					`Review ${this.config.displayName}'s use status and optional guide. Start a new connection only when reauthorization is needed.`
				),
			cls: 'tracekeeper-view__description',
		});
		this.panelEl = contentEl.createDiv({
			cls: 'tracekeeper-connect-ai-tool-modal__panel',
		});
		this.renderClientPanel();
		contentEl.querySelector<HTMLButtonElement>('button')?.focus();
	}

	private getFocusableModalElements(): HTMLElement[] {
		return Array.from(
			this.modalEl.querySelectorAll<HTMLElement>(
				'button, [href], input, select, textarea, summary, [tabindex]'
			)
		).filter((element) => {
			return !element.hasAttribute('disabled')
				&& element.getAttribute('aria-hidden') !== 'true'
				&& (element.tagName.toLowerCase() === 'summary' || element.tabIndex >= 0);
		});
	}

	onClose(): void {
		this.closed = true;
		if (this.modalKeydownHandler) {
			this.modalEl.removeEventListener('keydown', this.modalKeydownHandler, true);
			this.modalKeydownHandler = null;
		}
		this.stopPairingPolling();
		this.pairingTicket = null;
		this.pairingStatus = null;
		this.pairingState = null;
		this.pairingLoading = false;
		this.technicalDetailsEl = null;
		this.pairingMetaEl = null;
		this.lastRenderedState = null;
		this.panelEl = null;
		this.contentEl.empty();
	}

	private renderClientPanel(): void {
		const container = this.panelEl;
		if (!container) {
			return;
		}
		this.technicalDetailsEl = null;
		this.pairingMetaEl = null;
		container.empty();
		const presentation = this.connectionPresentation();
		const previousState = this.lastRenderedState;
		const header = container.createDiv({
			cls: 'tracekeeper-connect-ai-tool-modal__header',
			attr: {
				'aria-live': 'polite',
				'aria-atomic': 'true',
			},
		});
		header.createEl('h3', { text: this.stateHeadline(presentation.state) });
		header.createEl('span', {
			text: this.connectionStatusLabel(presentation.state),
			cls: `tracekeeper-badge ${this.connectionStatusClass(presentation.state)}`,
		});

		this.renderStateContent(container, presentation);
		this.renderConnectionActions(container, presentation);
		if (presentation.visibleSections.includes('technical_details')) {
			this.renderTechnicalDetails(container);
		}
		if (presentation.visibleSections.includes('skill')) {
			renderClientSkillPrompt({
				app: this.app,
				plugin: this.plugin,
				container,
				config: this.config,
				presentation: this.mode === 'manage' ? 'compact' : 'optional',
				onChanged: () => {
					this.onChanged?.();
					this.renderClientPanel();
				},
			});
		}
		this.lastRenderedState = presentation.state;
		if (previousState !== null && previousState !== presentation.state) {
			const heading = header.querySelector<HTMLElement>('h3');
			if (heading) {
				heading.tabIndex = -1;
				heading.focus();
			}
		}
	}

	private renderStateContent(container: HTMLElement, presentation: ConnectionPresentation): void {
		switch (presentation.state) {
			case 'idle':
				container.createEl('p', {
					text: this.mode === 'manage'
						? ui(
							'该 Agent 已有成功使用记录。需要重新授权时，再开始连接。',
							'This Agent has a successful use record. Start a new connection only when reauthorization is needed.'
						)
						: ui(
							'开始后，Tracekeeper 会准备一次性配对码并复制公开连接命令。配对码只在本机授权页中手工输入。',
							'When you start, Tracekeeper prepares a one-time pairing code and copies the public connection command. Type the code only in the local authorization page.'
						),
					cls: 'tracekeeper-view__description',
				});
				break;
			case 'preparing':
				container.createEl('p', {
					text: ui('正在准备连接，请稍候。', 'Preparing the connection. Please wait.'),
					cls: 'tracekeeper-view__description tracekeeper-connect-ai-tool-modal__loading',
				});
				break;
			case 'manual':
				container.createEl('p', {
					text: ui(
						'请在客户端的 MCP 设置中添加本机地址。Tracekeeper 不会替你修改客户端设置。',
						'Add the local address in the client MCP settings. Tracekeeper does not change client settings for you.'
					),
					cls: 'tracekeeper-view__description',
				});
				container.createEl('pre', {
					text: this.config.setupInstruction,
					cls: 'tracekeeper-code-block tracekeeper-connect-ai-tool-modal__manual-endpoint',
					attr: {
						'aria-label': ui('本机连接地址', 'Local connection address'),
					},
				});
				if (this.config.setupFollowup) {
					container.createEl('p', {
						text: this.config.setupFollowup,
						cls: 'tracekeeper-view__description',
					});
				}
				break;
			case 'ready':
				container.createEl('p', {
					text: this.clipboardState === 'failed'
						? ui(
							'配对码已准备好，但命令没有自动复制。请再次复制后继续。',
							'The pairing code is ready, but the command was not copied. Copy it again to continue.'
						)
						: ui(
							'连接命令已复制。先在终端运行命令，再在本机授权页手工输入配对码。',
							'The connection command was copied. Run it in a terminal, then type the pairing code in the local authorization page.'
						),
					cls: `tracekeeper-view__description${this.clipboardState === 'failed' ? ' tracekeeper-connect-ai-tool-modal__error-copy' : ''}`,
				});
				this.renderSteps(container);
				this.renderPairingCode(container);
				break;
			case 'awaiting_confirmation':
				container.createEl('p', {
					text: ui(
						'配对码已验证。请返回本机授权页完成确认。',
						'The pairing code was accepted. Return to the local authorization page to confirm.'
					),
					cls: 'tracekeeper-view__description',
				});
				break;
			case 'authorized':
				container.createEl('p', {
					text: ui(
						'授权完成。返回 Agent 使用一次 Tracekeeper，完成首次连接。',
						'Authorization is complete. Return to the Agent and use Tracekeeper once to finish the first connection.'
					),
					cls: 'tracekeeper-view__description',
				});
				break;
			case 'expired':
				container.createEl('p', {
					text: ui('配对码已过期，请重新开始连接。', 'The pairing code expired. Start the connection again.'),
					cls: 'tracekeeper-view__description',
				});
				break;
			case 'failed':
				container.createEl('p', {
					text: ui('尝试次数已用完，请重新开始连接。', 'All attempts were used. Start the connection again.'),
					cls: 'tracekeeper-view__description',
				});
				break;
			case 'retry':
				container.createEl('p', {
					text: ui('暂时无法读取连接状态，请重试。', 'The connection status is temporarily unavailable. Try again.'),
					cls: 'tracekeeper-view__description',
				});
				break;
		}
	}

	private renderSteps(container: HTMLElement): void {
		const steps = container.createEl('ol', {
			cls: 'tracekeeper-connect-ai-tool-modal__steps',
		});
		steps.createEl('li', {
			text: ui('将已复制的命令粘贴到终端运行。', 'Paste the copied command into a terminal and run it.'),
		});
		steps.createEl('li', {
			text: ui('在打开的本机授权页中手工输入配对码。', 'Type the pairing code by hand in the local authorization page that opens.'),
		});
	}

	private renderPairingCode(container: HTMLElement): void {
		if (!this.pairingTicket) {
			return;
		}
		const section = container.createDiv({
			cls: 'tracekeeper-connect-ai-tool-modal__pairing',
		});
		section.createEl('strong', {
			text: ui('一次性配对码', 'One-time pairing code'),
		});
		section.createEl('code', {
			text: this.pairingTicket.code,
			cls: 'tracekeeper-code-block tracekeeper-connect-ai-tool-modal__pairing-code',
			attr: {
				'aria-label': ui('一次性配对码，请手工输入', 'One-time pairing code, type by hand'),
			},
		});
		const remaining = this.pairingStatus?.attemptsRemaining;
		this.pairingMetaEl = section.createEl('p', {
			text: typeof remaining === 'number'
				? ui(
					`有效至 ${this.formatTime(this.pairingTicket.expiresAt)}，剩余 ${remaining} 次尝试。`,
					`Valid until ${this.formatTime(this.pairingTicket.expiresAt)} with ${remaining} attempts remaining.`
				)
				: ui(
					`有效至 ${this.formatTime(this.pairingTicket.expiresAt)}。`,
					`Valid until ${this.formatTime(this.pairingTicket.expiresAt)}.`
				),
			cls: 'tracekeeper-view__description tracekeeper-connect-ai-tool-modal__expiry',
		});
	}

	private updatePairingMetadata(): void {
		if (!this.pairingMetaEl || !this.pairingTicket) {
			return;
		}
		const remaining = this.pairingStatus?.attemptsRemaining;
		this.pairingMetaEl.setText(
			typeof remaining === 'number'
				? ui(
					`有效至 ${this.formatTime(this.pairingTicket.expiresAt)}，剩余 ${remaining} 次尝试。`,
					`Valid until ${this.formatTime(this.pairingTicket.expiresAt)} with ${remaining} attempts remaining.`
				)
				: ui(
					`有效至 ${this.formatTime(this.pairingTicket.expiresAt)}。`,
					`Valid until ${this.formatTime(this.pairingTicket.expiresAt)}.`
				)
		);
	}

	private renderConnectionActions(container: HTMLElement, presentation: ConnectionPresentation): void {
		const actions = container.createDiv({
			cls: 'modal-button-container tracekeeper-connect-ai-tool-modal__actions',
		});
		switch (presentation.primaryAction) {
			case 'start':
			case 'reconnect':
			case 'retry': {
				const button = actions.createEl('button', {
					text: presentation.primaryAction === 'start'
						? ui('开始连接', 'Start connection')
						: presentation.primaryAction === 'reconnect'
							? ui('重新连接', 'Reconnect')
							: ui('重新开始连接', 'Start again'),
					cls: 'mod-cta',
				});
				button.addEventListener('click', () => {
					void this.beginConnection();
				});
				break;
			}
			case 'copy_setup': {
				const button = actions.createEl('button', {
					text: this.config.supportsLocalOAuth
						? ui('再次复制连接命令', 'Copy connection command again')
						: ui('复制本机连接地址', 'Copy local connection address'),
					cls: 'mod-cta',
				});
				button.addEventListener('click', () => {
					void this.copySetupInstruction(button);
				});
				break;
			}
			case 'close': {
				const button = actions.createEl('button', {
					text: ui('完成', 'Done'),
					cls: 'mod-cta',
				});
				button.addEventListener('click', () => this.close());
				break;
			}
			case null:
				break;
		}

		if (presentation.secondaryActions.includes('copy_setup') && presentation.primaryAction !== 'copy_setup') {
			const copy = actions.createEl('button', {
				text: this.config.supportsLocalOAuth
					? ui('再次复制连接命令', 'Copy connection command again')
					: ui('复制本机连接地址', 'Copy local connection address'),
			});
			copy.addEventListener('click', () => {
				void this.copySetupInstruction(copy);
			});
		}
		if (presentation.secondaryActions.includes('help')) {
			const help = actions.createEl('button', {
				text: ui('遇到问题？', 'Having trouble?'),
			});
			help.addEventListener('click', () => this.openTechnicalDetails());
		}
	}

	private renderTechnicalDetails(container: HTMLElement): void {
		const details = container.createEl('details', {
			cls: 'tracekeeper-connect-ai-tool-modal__technical-details',
		});
		this.technicalDetailsEl = details;
		const summary = details.createEl('summary', {
			text: ui('技术详情', 'Technical details'),
		});
		summary.tabIndex = 0;
		const grid = details.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(
			grid,
			ui('连接入口', 'Connection entry'),
			this.setupCapabilityLabel(this.config.setupCapability)
		);
		this.renderDetail(
			grid,
			ui('授权方式', 'Authorization'),
			this.config.supportsLocalOAuth
				? ui('本机 OAuth + PKCE S256', 'Local OAuth + PKCE S256')
				: ui('手工设置', 'Manual setup')
		);
		details.createEl('p', {
			text: this.config.supportsLocalOAuth
				? ui('公开连接命令', 'Public connection command')
				: ui('本机连接地址', 'Local connection address'),
			cls: 'tracekeeper-connect-ai-tool-modal__preview-label',
		});
		details.createEl('pre', {
			text: this.config.setupInstruction,
			cls: 'tracekeeper-code-block',
			attr: {
				'aria-label': this.config.supportsLocalOAuth
					? ui('公开连接命令', 'Public connection command')
					: ui('本机连接地址', 'Local connection address'),
			},
		});
		if (this.config.setupFollowup) {
			details.createEl('p', {
			text: this.config.setupFollowup,
			cls: 'tracekeeper-view__description',
		});
		}
		details.createEl('p', {
			text: ui(
				'配对码只在本机授权页手工输入，不会进入命令、剪贴板、日志或客户端配置。',
				'The pairing code is typed only in the local authorization page and never enters commands, the clipboard, logs, or client configuration.'
			),
			cls: 'tracekeeper-view__description',
		});
	}

	private openTechnicalDetails(): void {
		if (!this.technicalDetailsEl) {
			return;
		}
		this.technicalDetailsEl.open = true;
		this.technicalDetailsEl.querySelector<HTMLElement>('summary')?.focus();
	}

	private async beginConnection(): Promise<void> {
		if (!this.config.supportsLocalOAuth || this.pairingLoading) {
			return;
		}
		this.stopPairingPolling();
		this.pairingTicket = null;
		this.pairingStatus = null;
		this.pairingState = null;
		this.clipboardState = 'idle';
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
			try {
				await this.plugin.copyToClipboard(
					this.config.setupInstruction,
					ui('已复制公开的连接命令。', 'Public connection command copied.')
				);
				this.clipboardState = 'copied';
			} catch {
				this.clipboardState = 'failed';
				new Notice(ui('命令未能自动复制，请再次复制。', 'The command could not be copied. Copy it again.'));
			}
			if (this.closed) {
				return;
			}
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

	private async copySetupInstruction(button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		try {
			await this.plugin.copyToClipboard(
				this.config.setupInstruction,
				this.config.supportsLocalOAuth
					? ui('已复制公开的连接命令。', 'Public connection command copied.')
					: ui('已复制公开的本机连接地址。', 'Public local connection address copied.')
			);
			this.clipboardState = 'copied';
		} catch {
			this.clipboardState = 'failed';
			new Notice(ui('复制失败，请重试。', 'Copy failed. Try again.'));
		}
		if (!this.closed) {
			this.renderClientPanel();
			this.panelEl?.querySelector<HTMLButtonElement>('button')?.focus();
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
			const stateChanged = this.pairingStatus?.state !== status.state;
			const attemptsChanged = this.pairingStatus?.attemptsRemaining !== status.attemptsRemaining;
			this.pairingStatus = status;
			switch (status.state) {
				case 'pending':
					this.pairingState = 'ready';
					if (stateChanged) {
						this.renderClientPanel();
					} else if (attemptsChanged) {
						this.updatePairingMetadata();
					}
					break;
				case 'awaiting_confirmation':
					this.pairingState = 'awaiting_confirmation';
					if (stateChanged) {
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

	private connectionPresentation(): ConnectionPresentation {
		return buildConnectionPresentation({
			mode: this.mode,
			supportsLocalOAuth: this.config.supportsLocalOAuth,
			pairingLoading: this.pairingLoading,
			pairingState: this.pairingState,
			hasPairingTicket: this.pairingTicket !== null,
			clipboardState: this.clipboardState,
		});
	}

	private stateHeadline(state: ConnectionUiState): string {
		switch (state) {
			case 'idle':
				return this.mode === 'manage'
					? ui('连接管理', 'Connection management')
					: ui('准备连接', 'Ready to connect');
			case 'preparing':
				return ui('正在准备连接', 'Preparing connection');
			case 'ready':
				return this.clipboardState === 'failed'
					? ui('需要复制命令', 'Command needs copying')
					: ui('连接命令已复制', 'Connection command copied');
			case 'awaiting_confirmation':
				return ui('等待本机确认', 'Waiting for local confirmation');
			case 'authorized':
				return ui('授权完成', 'Authorization complete');
			case 'manual':
				return ui('手工设置', 'Manual setup');
			case 'expired':
				return ui('配对码已过期', 'Pairing code expired');
			case 'failed':
				return ui('连接未完成', 'Connection not completed');
			case 'retry':
				return ui('需要重试', 'Retry required');
		}
	}

	private connectionStatusLabel(state: ConnectionUiState): string {
		switch (state) {
			case 'idle':
				return this.mode === 'manage'
					? ui('已正常使用', 'Successfully used')
					: ui('尚未开始', 'Not started');
			case 'preparing':
				return ui('请稍候', 'Please wait');
			case 'ready':
				return ui('等待授权', 'Awaiting authorization');
			case 'awaiting_confirmation':
				return ui('等待确认', 'Awaiting confirmation');
			case 'authorized':
				return ui('已授权', 'Authorized');
			case 'manual':
				return ui('需要手工设置', 'Manual setup required');
			case 'expired':
				return ui('需要重新开始', 'Start again');
			case 'failed':
				return ui('需要重新开始', 'Start again');
			case 'retry':
				return ui('可以重试', 'Ready to retry');
		}
	}

	private connectionStatusClass(state: ConnectionUiState): string {
		if (state === 'authorized' || (state === 'idle' && this.mode === 'manage')) {
			return 'tracekeeper-badge--success';
		}
		if (state === 'manual') {
			return 'tracekeeper-badge--muted';
		}
		if (state === 'expired' || state === 'failed' || state === 'retry') {
			return 'tracekeeper-badge--error';
		}
		return 'tracekeeper-badge--muted';
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
