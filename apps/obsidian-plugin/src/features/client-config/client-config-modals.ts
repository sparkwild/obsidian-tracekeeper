import { App, Modal, Notice } from 'obsidian';
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
	}

	private async ensureIntegration(): Promise<void> {
		const existing = this.plugin.getAgentIntegrationsSnapshot().find((entry) => entry.clientProfileId === this.config.clientId);
		if (existing) {
			this.integration = existing;
			this.selectedAuthMode = existing.authMode;
			this.renderPanel();
			return;
		}
		if (this.mode === 'add') {
			try {
				this.integration = await this.plugin.createAgentIntegration(this.config.clientId, this.selectedAuthMode);
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
		this.renderSetup(container);
		this.renderAuthorization(container);
		this.renderMaintenance(container);
		this.renderSkill(container);
	}

	private renderAuthMode(container: HTMLElement): void {
		const section = container.createDiv({ cls: 'tracekeeper-connect-ai-tool-modal__section' });
		section.createEl('h4', { text: ui('MCP 配置与授权', 'MCP setup and authorization') });
		const group = section.createDiv({ cls: 'tracekeeper-connect-ai-tool-modal__auth-modes', attr: { role: 'group', 'aria-label': ui('授权方式', 'Authorization mode') } });
		for (const mode of this.config.supportedAuthModes) {
			const button = group.createEl('button', { text: mode === 'oauth' ? ui('OAuth（推荐）', 'OAuth (recommended)') : ui('手工 Bearer', 'Manual Bearer'), cls: mode === this.selectedAuthMode ? 'mod-cta' : '' });
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
		section.createEl('p', { text: ui('只复制客户端原生配置命令或本机端点；复制不会证明客户端已连接。', 'Copy the client-native setup command or local endpoint. Copying does not prove the client connected.'), cls: 'tracekeeper-view__description' });
		section.createEl('pre', { text: this.config.setupInstruction, cls: 'tracekeeper-code-block', attr: { 'aria-label': ui('客户端配置命令', 'Client setup command') } });
		const copy = section.createEl('button', { text: ui('复制配置命令', 'Copy setup command') });
		copy.addEventListener('click', () => {
			copy.disabled = true;
			void this.plugin.copyToClipboard(this.config.setupInstruction, ui('配置命令已复制。', 'Setup command copied.')).then(async () => {
				if (this.integration) this.integration = await this.plugin.markAgentSetupCommandCopied(this.integration.integrationId);
			}).catch(() => new Notice(ui('复制失败，请重试。', 'Copy failed. Try again.'))).finally(() => { if (!this.closed) { copy.disabled = false; this.renderPanel(); } });
		});
		if (this.config.setupFollowup) section.createEl('p', { text: this.config.setupFollowup, cls: 'tracekeeper-view__description' });
	}

	private renderAuthorization(container: HTMLElement): void {
		const section = container.createDiv({ cls: 'tracekeeper-connect-ai-tool-modal__section' });
		if (this.selectedAuthMode === 'oauth') {
			section.createEl('p', { text: this.integration?.credential ? ui('OAuth 已授权。客户端完成 initialize 后才会显示已连接。', 'OAuth is authorized. Connected appears only after the client completes initialize.') : ui('OAuth 请求到达后，Obsidian 会显示 Allow/Deny。浏览器页面只等待审批。', 'When OAuth reaches Tracekeeper, Obsidian shows Allow/Deny. The browser only waits for approval.'), cls: 'tracekeeper-view__description' });
			for (const pending of this.plugin.getPendingOAuthRequests()) {
				const row = section.createDiv({ cls: 'tracekeeper-connect-ai-tool-modal__pending' });
				row.createEl('div', { text: ui(`当前卡片：${this.config.displayName}（Allow 时显式绑定）`, `Current card: ${this.config.displayName} (Allow binds explicitly)`) });
				row.createEl('div', { text: ui(`客户端自报名称（不可信）：${pending.clientNameClaim}`, `Client-reported name (untrusted): ${pending.clientNameClaim}`) });
				row.createEl('div', { text: ui(`redirect：${pending.redirectUri}\nresource：${pending.resource}\n有效至：${new Date(pending.expiresAt).toLocaleString()}`, `redirect: ${pending.redirectUri}\nresource: ${pending.resource}\nExpires: ${new Date(pending.expiresAt).toLocaleString()}`), cls: 'tracekeeper-view__description' });
				const allow = row.createEl('button', { text: ui('Allow', 'Allow'), cls: 'mod-cta' });
				allow.addEventListener('click', () => void this.decide(pending.requestId, { decision: 'allow', integrationId: this.integration?.integrationId ?? '' }));
				const deny = row.createEl('button', { text: ui('Deny', 'Deny') });
				deny.addEventListener('click', () => void this.decide(pending.requestId, { decision: 'deny' }));
			}
			return;
		}
		section.createEl('p', { text: ui('手工 Bearer 面向能安全设置 Authorization: Bearer 的客户端。Tracekeeper 不会宣称已验证未知客户端的配置格式。', 'Manual Bearer is for clients that can safely set Authorization: Bearer. Tracekeeper does not claim to verify unknown client configuration formats.'), cls: 'tracekeeper-view__description' });
		const generate = section.createEl('button', { text: this.integration?.credential ? ui('替换访问凭据', 'Replace access credential') : ui('生成访问凭据', 'Generate access credential'), cls: 'mod-cta' });
		generate.addEventListener('click', () => {
			if (!this.integration) return;
			generate.disabled = true;
			void this.plugin.issueManualBearerCredential(this.integration.integrationId).then((token) => { this.bearerToken = token; this.integration = this.plugin.getAgentIntegrationsSnapshot().find((entry) => entry.integrationId === this.integration?.integrationId) ?? this.integration; this.renderPanel(); }).catch((error) => new Notice(error instanceof Error ? error.message : ui('无法生成凭据。', 'Unable to generate credential.'))).finally(() => { generate.disabled = false; });
		});
		if (this.bearerToken) {
			section.createEl('p', { text: ui('明文凭据只在当前弹窗内存中显示；关闭后不可恢复。', 'The plaintext credential is shown only in this modal memory and cannot be recovered after closing.'), cls: 'tracekeeper-view__description' });
			section.createEl('pre', { text: this.bearerToken, cls: 'tracekeeper-code-block', attr: { 'aria-label': ui('访问凭据', 'Access credential') } });
			const copyToken = section.createEl('button', { text: ui('复制访问凭据', 'Copy access credential') });
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
			const forget = actions.createEl('button', { text: ui('忘记 Agent 卡片', 'Forget Agent card') });
			forget.addEventListener('click', () => void this.plugin.forgetAgentIntegration(this.integration?.integrationId ?? '').then(() => { this.integration = null; this.onChanged?.(); this.renderPanel(); }).catch((error) => new Notice(error instanceof Error ? error.message : ui('无法忘记 Agent 卡片。', 'Unable to forget Agent card.'))));
		}
		const close = actions.createEl('button', { text: ui('完成', 'Done'), cls: 'mod-cta' });
		close.addEventListener('click', () => this.close());
	}

	private renderSkill(container: HTMLElement): void {
		renderClientSkillPrompt({ app: this.app, plugin: this.plugin, container, config: this.config, presentation: this.mode === 'manage' ? 'compact' : 'optional', onChanged: () => { this.onChanged?.(); this.renderPanel(); } });
	}

	private async decide(requestId: string, decision: OAuthDecision): Promise<void> {
		try {
			await this.plugin.decideOAuthRequest(requestId, decision);
			this.renderPanel();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : ui('无法更新 OAuth 审批。', 'Unable to update OAuth approval.'));
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
