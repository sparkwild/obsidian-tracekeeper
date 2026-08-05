import { App, Modal, Notice, setIcon } from 'obsidian';
import type { OAuthDecision } from '@tracekeeper/mcp-runtime';
import type TracekeeperPlugin from '../../main';
import { ui } from '../../ui/localization';
import { renderClientSkillPrompt } from '../skill-installation/client-skill-prompt';
import type { AgentIntegrationSnapshot } from '../settings/agent-integrations';
import type { ClientAuthMode, GeneratedClientConfig } from './client-config';

/** Single-panel Agent integration management. Copying configuration is always explicit. */
export class ConnectAiToolModal extends Modal {
	private panelEl: HTMLElement | null = null;
	private integration: AgentIntegrationSnapshot | null = null;
	private bearerToken: string | null = null;
	private selectedAuthMode: ClientAuthMode;
	private closed = false;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private config: GeneratedClientConfig,
		private mode: 'add' | 'manage',
		private onChanged?: () => void
	) {
		super(app);
		this.selectedAuthMode = config.supportedAuthModes[0] ?? 'bearer';
	}

	onOpen(): void {
		this.closed = false;
		this.modalEl.setAttribute('role', 'dialog');
		this.modalEl.setAttribute('aria-modal', 'true');
		this.contentEl.empty();
		this.contentEl.addClass('tracekeeper-connect-ai-tool-modal');
		this.contentEl.createEl('h2', { text: this.mode === 'add' ? ui(`添加 ${this.config.displayName}`, `Add ${this.config.displayName}`) : ui(`管理 ${this.config.displayName}`, `Manage ${this.config.displayName}`) });
		this.contentEl.createEl('p', {
			text: ui('MCP 配置、授权、连接、使用和 Skill 状态彼此独立。Tracekeeper 不会自动修改客户端配置。', 'MCP setup, authorization, connection, usage, and Skill state are independent. Tracekeeper never edits client configuration automatically.'),
			cls: 'tracekeeper-view__description',
		});
		this.panelEl = this.contentEl.createDiv({ cls: 'tracekeeper-connect-ai-tool-modal__panel' });
		this.renderPanel();
		void this.ensureIntegration();
	}

	onClose(): void {
		this.closed = true;
		this.integration = null;
		this.bearerToken = null;
		this.panelEl = null;
		this.contentEl.empty();
		this.onChanged?.();
	}

	private async ensureIntegration(): Promise<void> {
		let existing = this.plugin.getAgentIntegrationsSnapshot().find((entry) => entry.clientProfileId === this.config.clientId);
		if (existing) {
			const defaultMode = this.config.supportedAuthModes[0] ?? 'bearer';
			if (!this.config.supportedAuthModes.includes(existing.authMode) && !existing.credential) {
				try {
					existing = await this.plugin.setAgentAuthMode(existing.integrationId, defaultMode);
					this.onChanged?.();
				} catch (error) {
					new Notice(error instanceof Error ? error.message : ui('无法修正 Agent 配置方式。', 'Unable to correct the Agent setup mode.'));
				}
			}
			this.integration = existing;
			this.selectedAuthMode = this.config.supportedAuthModes.includes(existing.authMode) ? existing.authMode : defaultMode;
			this.renderPanel();
			return;
		}
		if (this.mode === 'add') {
			try {
				this.integration = await this.plugin.createAgentIntegration(this.config.clientId, this.selectedAuthMode);
				this.onChanged?.();
			} catch (error) {
				new Notice(error instanceof Error ? error.message : ui('无法创建 Agent 集成。', 'Unable to create the Agent integration.'));
			}
		}
		this.renderPanel();
	}

	private renderPanel(): void {
		const container = this.panelEl;
		if (!container || this.closed) return;
		container.empty();
		if (!this.integration) {
			container.createEl('p', { text: ui('点击“配置 MCP”后才会创建持久 Agent 卡片。', 'Click “Configure MCP” to create a persistent Agent card.'), cls: 'tracekeeper-view__description' });
			const configure = container.createEl('button', { text: ui('配置 MCP', 'Configure MCP'), cls: 'mod-cta' });
			configure.addEventListener('click', () => {
				configure.disabled = true;
				void this.plugin.createAgentIntegration(this.config.clientId, this.selectedAuthMode).then((entry) => {
					this.integration = entry;
					this.renderPanel();
				}).catch((error) => {
					configure.disabled = false;
					new Notice(error instanceof Error ? error.message : ui('无法创建 Agent 集成。', 'Unable to create the Agent integration.'));
				});
			});
			this.renderSkill(container);
			return;
		}

		const header = container.createDiv({ cls: 'tracekeeper-connect-ai-tool-modal__header', attr: { 'aria-live': 'polite', 'aria-atomic': 'true' } });
		header.createEl('h3', { text: this.config.displayName });
		header.createEl('span', { text: this.statusLabel(), cls: `tracekeeper-badge ${this.statusTone()}` });

		this.renderAuthMode(container);
		const prioritizeAuthorization = this.selectedAuthMode === 'oauth'
			&& !this.integration.credential
			&& this.plugin.getPendingOAuthRequests().length > 0;
		if (prioritizeAuthorization) this.renderAuthorization(container);
		this.renderSetup(container);
		if (!prioritizeAuthorization) this.renderAuthorization(container);
		this.renderSkill(container);
		this.renderMaintenance(container);
	}

	private renderAuthMode(container: HTMLElement): void {
		const section = container.createDiv({ cls: 'tracekeeper-connect-ai-tool-modal__section' });
		section.createEl('h4', { text: ui('MCP 配置与授权', 'MCP setup and authorization') });
		const group = section.createDiv({ cls: 'tracekeeper-connect-ai-tool-modal__auth-modes', attr: { role: 'group', 'aria-label': ui('配置方式', 'Setup mode') } });
		for (const mode of this.config.supportedAuthModes) {
			const button = group.createEl('button', { text: mode === 'oauth' ? ui('自动', 'Automatic') : ui('手动', 'Manual'), cls: mode === this.selectedAuthMode ? 'mod-cta' : '' });
			button.setAttribute('aria-pressed', String(mode === this.selectedAuthMode));
			button.addEventListener('click', () => {
				if (this.integration?.credential && this.integration.authMode !== mode) {
					new Notice(ui('请先撤销当前凭据，再切换授权方式。', 'Revoke the active credential before switching authorization mode.'));
					return;
				}
				this.selectedAuthMode = mode;
				if (this.integration && this.integration.authMode !== mode) {
					void this.plugin.setAgentAuthMode(this.integration.integrationId, mode).then((entry) => { this.integration = entry; this.renderPanel(); }).catch((error) => new Notice(error instanceof Error ? error.message : ui('无法切换授权方式。', 'Unable to switch authorization mode.')));
				} else this.renderPanel();
			});
		}
	}

	private renderSetup(container: HTMLElement): void {
		const section = container.createDiv({ cls: 'tracekeeper-connect-ai-tool-modal__section' });
		const markCopied = async (): Promise<void> => {
			if (this.integration) this.integration = await this.plugin.markAgentSetupCommandCopied(this.integration.integrationId);
		};
		if (this.selectedAuthMode === 'bearer') {
			section.createEl('p', {
				text: ui('在客户端的 MCP 设置中手动填写以下端点，并单独配置访问令牌。', 'Enter this endpoint manually in the client MCP settings, then configure the access token separately.'),
				cls: 'tracekeeper-view__description',
			});
			this.renderCopyableCommand(
				section,
				this.plugin.getMcpHttpEndpoint(),
				ui('复制 MCP 端点', 'Copy MCP endpoint'),
				ui('MCP 端点已复制。', 'MCP endpoint copied.'),
				markCopied,
			);
			return;
		}
		section.createEl('p', { text: ui('只复制客户端原生配置命令或本机端点；复制不会证明客户端已连接。', 'Copy the client-native setup command or local endpoint. Copying does not prove the client connected.'), cls: 'tracekeeper-view__description' });
		this.renderCopyableCommand(
			section,
			this.config.setupInstruction,
			ui('复制配置命令', 'Copy setup command'),
			ui('配置命令已复制。', 'Setup command copied.'),
			markCopied,
		);
		if (this.config.setupFollowup) section.createEl('p', { text: this.config.setupFollowup, cls: 'tracekeeper-view__description' });
		if (this.mode === 'manage' && this.config.reauthorizationInstruction) {
			section.createEl('p', {
				text: ui('已有配置需要重新授权时，运行以下命令。', 'Run the following command when an existing configuration needs reauthorization.'),
				cls: 'tracekeeper-view__description',
			});
			this.renderCopyableCommand(
				section,
				this.config.reauthorizationInstruction,
				ui('复制重新授权命令', 'Copy reauthorization command'),
				ui('重新授权命令已复制。', 'Reauthorization command copied.'),
			);
		}
	}

	private renderCopyableCommand(
		section: HTMLElement,
		command: string,
		copyLabel: string,
		successMessage: string,
		onCopied?: () => Promise<void> | void,
	): void {
		const row = section.createDiv({ cls: 'tracekeeper-copyable-command' });
		row.createEl('pre', {
			text: command,
			cls: 'tracekeeper-code-block',
			attr: { 'aria-label': copyLabel, tabindex: '0' },
		});
		const copy = row.createEl('button', {
			cls: 'clickable-icon tracekeeper-copy-button',
			attr: { 'aria-label': copyLabel, title: copyLabel },
		});
		setIcon(copy, 'copy');
		copy.addEventListener('click', () => {
			copy.disabled = true;
			void this.plugin.copyToClipboard(command, successMessage)
				.then(() => onCopied?.())
				.catch(() => new Notice(ui('复制失败，请重试。', 'Copy failed. Try again.')))
				.finally(() => {
					if (!this.closed) {
						copy.disabled = false;
						this.renderPanel();
					}
				});
		});
	}

	private renderAuthorization(container: HTMLElement): void {
		const section = container.createDiv({ cls: 'tracekeeper-connect-ai-tool-modal__section' });
		if (this.selectedAuthMode === 'oauth') {
			const pendingRequests = this.plugin.getPendingOAuthRequests();
			if (pendingRequests.length === 0) {
				section.createEl('p', { text: this.integration?.credential ? ui('OAuth 已授权。客户端完成 initialize 后才会显示已连接。', 'OAuth is authorized. Connected appears only after the client completes initialize.') : ui('客户端发起连接后，Tracekeeper 会在这里显示授权确认。', 'Tracekeeper shows an authorization confirmation here when the client connects.'), cls: 'tracekeeper-view__description' });
			}
			for (const pending of pendingRequests) {
				const row = section.createDiv({
					cls: 'tracekeeper-connect-ai-tool-modal__pending',
					attr: { role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true' },
				});
				const heading = row.createDiv({ cls: 'tracekeeper-connect-ai-tool-modal__pending-heading' });
				const icon = heading.createSpan({ cls: 'tracekeeper-connect-ai-tool-modal__pending-icon' });
				setIcon(icon, 'shield-alert');
				heading.createEl('strong', { text: ui('需要授权确认', 'Authorization required') });
				row.createEl('p', {
					text: ui(`${this.config.displayName} 正在请求连接 Tracekeeper。请核对信息后选择授权或拒绝。`, `${this.config.displayName} is requesting access to Tracekeeper. Review the details, then allow or deny.`),
					cls: 'tracekeeper-connect-ai-tool-modal__pending-summary',
				});
				const details = row.createDiv({ cls: 'tracekeeper-connect-ai-tool-modal__pending-details' });
				this.renderApprovalDetail(details, ui('Agent', 'Agent'), this.config.displayName);
				this.renderApprovalDetail(details, ui('客户端', 'Client'), pending.clientNameClaim);
				this.renderApprovalDetail(details, ui('回调来源', 'Redirect origin'), urlOrigin(pending.redirectUri));
				this.renderApprovalDetail(details, ui('访问范围', 'Scope'), pending.scope);
				this.renderApprovalDetail(details, ui('MCP 资源', 'MCP resource'), pending.resource);
				this.renderApprovalDetail(details, ui('有效至', 'Expires'), new Date(pending.expiresAt).toLocaleString());
				const actions = row.createDiv({ cls: 'tracekeeper-connect-ai-tool-modal__pending-actions' });
				const allow = actions.createEl('button', { text: ui('授权', 'Allow'), cls: 'mod-cta' });
				const deny = actions.createEl('button', { text: ui('拒绝', 'Deny') });
				allow.addEventListener('click', () => {
					allow.disabled = true;
					deny.disabled = true;
					void this.decide(pending.requestId, { decision: 'allow', integrationId: this.integration?.integrationId ?? '' });
				});
				deny.addEventListener('click', () => {
					allow.disabled = true;
					deny.disabled = true;
					void this.decide(pending.requestId, { decision: 'deny' });
				});
			}
			return;
		}
		section.createEl('p', { text: ui('手动访问令牌适用于能够安全保存并配置访问令牌的客户端。Tracekeeper 不会宣称已验证未知客户端的配置格式。', 'Manual access tokens are for clients that can securely store and configure an access token. Tracekeeper does not claim to verify unknown client configuration formats.'), cls: 'tracekeeper-view__description' });
		const generate = section.createEl('button', { text: this.integration?.credential ? ui('替换访问凭据', 'Replace access credential') : ui('生成访问凭据', 'Generate access credential'), cls: 'mod-cta' });
		generate.addEventListener('click', () => {
			if (!this.integration) return;
			generate.disabled = true;
			void this.plugin.issueManualBearerCredential(this.integration.integrationId).then((token) => { this.bearerToken = token; this.integration = this.plugin.getAgentIntegrationsSnapshot().find((entry) => entry.integrationId === this.integration?.integrationId) ?? this.integration; this.renderPanel(); }).catch((error) => new Notice(error instanceof Error ? error.message : ui('无法生成凭据。', 'Unable to generate credential.'))).finally(() => { generate.disabled = false; });
		});
		if (this.bearerToken) {
			section.createEl('p', { text: ui('明文凭据只在当前弹窗内存中显示；关闭后不可恢复。', 'The plaintext credential is shown only in this modal memory and cannot be recovered after closing.'), cls: 'tracekeeper-view__description' });
			section.createEl('pre', { text: this.bearerToken, cls: 'tracekeeper-code-block', attr: { 'aria-label': ui('访问凭据', 'Access credential') } });
			const copyTokenLabel = ui('复制访问凭据', 'Copy access credential');
			const copyToken = section.createEl('button', {
				cls: 'clickable-icon tracekeeper-copy-button',
				attr: { 'aria-label': copyTokenLabel, title: copyTokenLabel },
			});
			setIcon(copyToken, 'copy');
			copyToken.addEventListener('click', () => void this.plugin.copyToClipboard(this.bearerToken ?? '', ui('访问凭据已复制。', 'Access credential copied.')).catch(() => new Notice(ui('复制失败；凭据仍可在当前弹窗查看。', 'Copy failed; the credential remains visible in this modal.'))));
		}
	}

	private renderMaintenance(container: HTMLElement): void {
		const actions = container.createDiv({ cls: 'modal-button-container tracekeeper-connect-ai-tool-modal__actions' });
		if (this.integration?.credential) {
			const revoke = actions.createEl('button', { text: ui('撤销此 Agent 访问', 'Revoke this Agent access') });
			revoke.addEventListener('click', () => void this.plugin.revokeAgentIntegration(this.integration?.integrationId ?? '').then(() => { this.bearerToken = null; this.integration = this.plugin.getAgentIntegrationsSnapshot().find((entry) => entry.clientProfileId === this.config.clientId) ?? null; this.onChanged?.(); this.renderPanel(); }));
		}
		if (this.integration && !this.integration.credential) {
			const remove = actions.createEl('button', { text: ui('移除配置', 'Remove configuration') });
			remove.addEventListener('click', () => {
				remove.disabled = true;
				void this.plugin.forgetAgentIntegration(this.integration?.integrationId ?? '').then(() => {
					this.integration = null;
					this.close();
				}).catch((error) => {
					remove.disabled = false;
					new Notice(error instanceof Error ? error.message : ui('无法移除 Agent 配置。', 'Unable to remove Agent configuration.'));
				});
			});
		}
		const close = actions.createEl('button', { text: ui('完成', 'Done'), cls: 'mod-cta' });
		close.addEventListener('click', () => this.close());
	}

	private renderApprovalDetail(container: HTMLElement, label: string, value: string): void {
		container.createEl('span', { text: label, cls: 'tracekeeper-connect-ai-tool-modal__pending-label' });
		container.createEl('span', { text: value });
	}

	private renderSkill(container: HTMLElement): void {
		renderClientSkillPrompt({ app: this.app, plugin: this.plugin, container, config: this.config, presentation: this.mode === 'manage' ? 'compact' : 'optional', onChanged: () => { this.onChanged?.(); this.renderPanel(); } });
	}

	private async decide(requestId: string, decision: NonNullable<OAuthDecision>): Promise<void> {
		try {
			await this.plugin.decideOAuthRequest(requestId, decision);
			this.onChanged?.();
			this.renderPanel();
			new Notice(decision.decision === 'allow'
				? ui('授权确认已提交，正在等待客户端完成连接。', 'Authorization submitted. Waiting for the client to finish connecting.')
				: ui('已拒绝此连接请求。', 'Connection request denied.'));
		} catch (error) {
			new Notice(error instanceof Error ? error.message : ui('无法更新 OAuth 审批。', 'Unable to update OAuth approval.'));
			this.renderPanel();
		}
	}

	private statusLabel(): string {
		if (!this.integration) return ui('未配置', 'Not configured');
		if (this.integration.lastPreparedEndpoint && this.integration.lastPreparedEndpoint !== this.plugin.getMcpHttpEndpoint()) return ui('需要更新配置', 'Needs setup update');
		if (this.selectedAuthMode === 'oauth' && this.plugin.getPendingOAuthRequests().length > 0 && !this.integration.credential) return ui('待审批', 'Approval pending');
		if (!this.integration.credential) return this.integration.setupCommandCopiedAt ? ui('配置未验证', 'Setup unverified') : ui('未授权', 'Not authorized');
		return ui('已授权', 'Authorized');
	}

	private statusTone(): string {
		return this.integration?.credential ? 'tracekeeper-badge--success' : 'tracekeeper-badge--muted';
	}
}

function urlOrigin(value: string): string {
	try { return new URL(value).origin; } catch { return value; }
}
