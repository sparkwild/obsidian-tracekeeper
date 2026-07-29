import { App, Modal } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import {
	clientConfigStatusClass,
	type GeneratedClientConfig,
} from './client-config';
import type { ClientConfigChangePlan } from '../../adapters/client-config-adapter';
import { ui } from '../../ui/localization';
import { renderClientSkillPrompt } from '../skill-installation/client-skill-prompt';

export class ClientConfigCopyModal extends Modal {
	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private config: GeneratedClientConfig
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: ui('确认复制连接配置', 'Confirm config copy') });
		contentEl.createEl('p', {
			text: ui(
				'剪贴板将包含本机访问凭据。请只粘贴到所选 AI 工具的本机 MCP 配置中。',
				'The clipboard will contain a local access credential. Paste it only into the selected AI tool’s local MCP configuration.'
			),
			cls: 'tracekeeper-view__description',
		});
		contentEl.createEl('pre', {
			text: this.config.redactedConfigText,
			cls: 'tracekeeper-code-block',
		});
		const actions = contentEl.createDiv({ cls: 'tracekeeper-action-row' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			text: ui('复制完整配置', 'Copy full config'),
			cls: 'mod-cta',
		});
		const status = actions.createEl('span', { cls: 'tracekeeper-view__description' });
		confirm.addEventListener('click', () => {
			confirm.disabled = true;
			cancel.disabled = true;
			void this.plugin.copyToClipboard(
				this.config.completeConfigText,
				ui('已复制受保护的连接配置。', 'Protected connection config copied.')
			).then(() => this.close()).catch(() => {
				status.setText(ui('复制失败，剪贴板未更新。', 'Copy failed. The clipboard was not updated.'));
				confirm.disabled = false;
				cancel.disabled = false;
			});
		});
	}
}

export class ClientConfigPreviewModal extends Modal {
	private plan: ClientConfigChangePlan | null = null;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private config: GeneratedClientConfig,
		private mode: 'apply' | 'remove',
		private onChanged?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		try {
			this.plan = this.plugin.prepareClientConfigChange(this.config, this.mode);
		} catch (error) {
			console.error('tracekeeper failed to prepare client config preview', error);
			contentEl.createEl('h2', { text: ui('无法预览配置', 'Cannot preview config') });
			contentEl.createEl('p', {
				text: ui('无法读取目标配置，请检查文件权限后重试。', 'Cannot read the target config. Check file permissions and try again.'),
			});
			return;
		}
		contentEl.createEl('h2', {
			text: this.mode === 'apply'
				? ui('确认自动配置', 'Confirm auto setup')
				: ui('确认移除配置', 'Confirm config removal'),
		});
		contentEl.createEl('p', {
			text: this.mode === 'apply'
				? ui('将只写入知识库连接配置，不会修改其他 MCP server。写入前会创建备份。', 'Only the Tracekeeper connection will be written. Other MCP servers will not be changed. A backup will be created first.')
				: ui('将只移除知识库连接配置，不会删除其他 MCP server。移除前会创建备份。', 'Only the Tracekeeper connection will be removed. Other MCP servers will not be deleted. A backup will be created first.'),
			cls: 'tracekeeper-view__description',
		});
		const details = contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(details, ui('AI 工具', 'AI tool'), this.config.displayName);
		this.renderDetail(details, ui('配置文件', 'Config file'), this.config.targetPath || ui('不可用', 'Unavailable'));
		this.renderDetail(details, ui('连接方式', 'Connection'), this.transportLabel(this.config.transport));
		if (this.mode === 'apply') {
			contentEl.createEl('pre', { text: this.plan.previewText, cls: 'tracekeeper-code-block' });
		}
		const actions = contentEl.createDiv({ cls: 'tracekeeper-action-row' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const confirmText = this.mode === 'apply' ? ui('确认写入', 'Write config') : ui('移除配置', 'Remove config');
		const confirm = actions.createEl('button', {
			text: confirmText,
			cls: 'mod-cta',
		});
		const status = actions.createEl('span', { cls: 'tracekeeper-view__description' });
		confirm.addEventListener('click', () => {
			void (async () => {
				const plan = this.plan;
				if (!plan) {
					return;
				}
				confirm.disabled = true;
				cancel.disabled = true;
				confirm.setText(this.mode === 'apply' ? ui('写入中...', 'Writing...') : ui('移除中...', 'Removing...'));
				status.setText(this.mode === 'apply' ? ui('正在写入连接配置...', 'Writing connection config...') : ui('正在移除配置...', 'Removing config...'));
				try {
					if (this.mode === 'apply') {
						await this.plugin.applyClientConfig(this.config, plan.planId);
					} else {
						await this.plugin.removeClientConfig(this.config, plan.planId);
					}
					this.onChanged?.();
					this.close();
				} catch {
					this.plan = null;
					status.setText(ui('配置未修改。请关闭窗口并重新预览后再试。', 'Config was not changed. Close this dialog and preview again before retrying.'));
					confirm.disabled = true;
					cancel.disabled = false;
					confirm.setText(ui('需要重新预览', 'Preview again'));
				}
			})();
		});
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}

	private transportLabel(transport: GeneratedClientConfig['transport']): string {
		switch (transport) {
			case 'streamable-http':
				return ui('连接地址', 'Connection URL');
			default:
				return transport;
		}
	}
}

export class ConnectAiToolModal extends Modal {
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
					'使用受管写入或复制请求头配置。完成配置并成功使用 Tracekeeper 后，这个 Agent 才会出现在主列表。',
					'Use managed setup or copy the header configuration. This Agent appears in the main list only after setup and successful Tracekeeper use.'
				)
				: ui(
					'查看或更新这个 Agent 的连接配置。预览中的访问凭据始终隐藏。',
					'Review or update this Agent connection. The access credential is always hidden in previews.'
				),
			cls: 'tracekeeper-view__description',
		});
		const compatibility = contentEl.createEl('p', {
			cls: 'tracekeeper-connect-ai-tool-modal__compatibility',
		});
		compatibility.createSpan({
			text: ui(
				'仅支持可发送 Authorization Header 的 Streamable HTTP MCP 工具。无法发送请求头时：',
				'Only Streamable HTTP MCP tools that can send an Authorization Header are supported. If the client cannot send the header: '
			),
		});
		compatibility.createEl('strong', {
			text: ui(
				'不兼容当前安全连接',
				'Not compatible with the current secure connection'
			),
		});

		const panel = contentEl.createDiv({
			cls: 'tracekeeper-connect-ai-tool-modal__panel',
		});
		this.renderClientPanel(panel, this.config);
		contentEl.querySelector<HTMLButtonElement>('button')?.focus();
	}

	private renderClientPanel(container: HTMLElement, config: GeneratedClientConfig): void {
		container.empty();
		const header = container.createDiv({
			cls: 'tracekeeper-connect-ai-tool-modal__header',
			attr: {
				'aria-live': 'polite',
			},
		});
		header.createEl('h3', { text: config.displayName });
		header.createEl('span', {
			text: this.mode === 'manage'
				? ui('已正常使用', 'Successfully used')
				: config.configStatusLabel,
			cls: this.mode === 'manage'
				? 'tracekeeper-badge tracekeeper-badge--success'
				: `tracekeeper-badge ${clientConfigStatusClass(config.configState)}`,
		});
		container.createEl('p', {
			text: this.mode === 'manage' && !config.supportsAutoConfigure
				? ui(
					'已观察到这个 Agent 成功连接并调用 Tracekeeper；其手工配置文件仍由客户端自行管理。',
					'This Agent has connected and called Tracekeeper successfully; its manual configuration file remains managed by the client.'
				)
				: config.configStatusDetail || config.description,
			cls: 'tracekeeper-view__description',
		});

		const details = container.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(
			details,
			ui('配置方式', 'Setup mode'),
			config.supportsAutoConfigure && config.targetPath
				? ui('受管写入或手工复制', 'Managed setup or manual copy')
				: ui('手工复制', 'Manual copy')
		);
		this.renderDetail(
			details,
			'Authorization Header',
			ui('必需，预览已隐藏凭据', 'Required; credential hidden in preview')
		);
		if (config.supportsAutoConfigure && config.targetPath) {
			this.renderDetail(details, ui('配置文件', 'Config file'), config.targetPath);
		}

		container.createEl('p', {
			text: ui(
				'请求头配置片段（访问凭据已隐藏）',
				'Header configuration snippet (access credential hidden)'
			),
			cls: 'tracekeeper-connect-ai-tool-modal__preview-label',
		});
		container.createEl('pre', {
			text: config.redactedConfigText,
			cls: 'tracekeeper-code-block',
			attr: {
				'aria-label': ui('脱敏的连接配置预览', 'Redacted connection configuration preview'),
			},
		});

		if (!config.supportsAutoConfigure) {
			container.createEl('p', {
				text: this.mode === 'manage'
					? ui(
						'Tracekeeper 已验证真实使用，但不会声称已读取或写入这个客户端的手工配置文件。',
						'Tracekeeper has verified real use but does not claim to have read or written this client’s manual configuration file.'
					)
					: ui(
						'Tracekeeper 不会声称已写入或验证此客户端；成功 initialize 并成功调用 Tracekeeper 后才会出现在 Agent 列表。',
						'Tracekeeper does not claim to have written or verified this client. It appears in the Agent list only after successful initialize and successful Tracekeeper use.'
					),
				cls: 'tracekeeper-view__description',
			});
		}
		if (config.restartRequired) {
			container.createEl('p', {
				text: ui(
					'完成配置后需要重启或重新加载该 AI 工具。',
					'Restart or reload the AI tool after setup.'
				),
				cls: 'tracekeeper-view__description',
			});
		}

		const actions = container.createDiv({
			cls: 'modal-button-container tracekeeper-connect-ai-tool-modal__actions',
		});
		if (config.configState !== 'configured') {
			const copy = actions.createEl('button', {
				text: this.mode === 'manage'
					? ui('重新复制配置', 'Copy config again')
					: ui('复制配置', 'Copy config'),
			});
			copy.addEventListener('click', () => {
				this.close();
				new ClientConfigCopyModal(this.app, this.plugin, config).open();
			});
		}
		if (config.supportsAutoConfigure && config.targetPath && config.configState !== 'configured') {
			const autoConfigure = actions.createEl('button', {
				text: config.configState === 'needs_update'
					? ui('更新配置', 'Update config')
					: ui('自动配置', 'Auto setup'),
				cls: 'mod-cta',
			});
			autoConfigure.addEventListener('click', () => {
				this.close();
				new ClientConfigPreviewModal(
					this.app,
					this.plugin,
					config,
					'apply',
					this.onChanged
				).open();
			});
		}
		if (
			config.supportsAutoConfigure
			&& config.targetPath
			&& (config.configState === 'configured' || config.configState === 'needs_update')
		) {
			const openFile = actions.createEl('button', {
				text: ui('打开配置文件', 'Open config file'),
			});
			openFile.addEventListener('click', () => {
				this.close();
				void this.plugin.openClientConfigFile(config);
			});
			const remove = actions.createEl('button', {
				text: ui('移除配置', 'Remove config'),
			});
			remove.addEventListener('click', () => {
				this.close();
				new ClientConfigPreviewModal(
					this.app,
					this.plugin,
					config,
					'remove',
					this.onChanged
				).open();
			});
		}
		renderClientSkillPrompt({
			app: this.app,
			plugin: this.plugin,
			container,
			config,
			onChanged: () => {
				this.onChanged?.();
				this.renderClientPanel(container, config);
			},
		});
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}
}
