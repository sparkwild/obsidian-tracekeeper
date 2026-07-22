import { App, Modal, Notice } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { GeneratedClientConfig } from './client-config';
import type { ClientConfigChangePlan } from '../../adapters/client-config-adapter';
import { ui } from '../../ui/localization';

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

export class ClientCredentialRotateConfirmModal extends Modal {
	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private config: GeneratedClientConfig,
		private onRotated: () => void
	) {
		super(app);
	}

	onOpen(): void {
		void super.onOpen();
		this.titleEl.setText(ui(`轮换 ${this.config.displayName} 凭据`, `Rotate ${this.config.displayName} credential`));
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', {
			text: ui(
				'只会撤销这个 Agent 当前使用的凭据。它需要更新连接配置并重新连接，其他 Agent 保持可用。',
				'Only this Agent credential will be revoked. Update its connection and reconnect; other Agents remain available.'
			),
		});

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			text: ui('确认轮换', 'Rotate credential'),
			cls: 'mod-warning',
		});
		confirm.addEventListener('click', () => {
			void (async () => {
				confirm.disabled = true;
				cancel.disabled = true;
				try {
					await this.plugin.rotateRuntimeCredential(this.config.clientId);
					this.onRotated();
					this.close();
				} catch (error) {
					console.error('tracekeeper failed to rotate client credential', error);
					new Notice(ui('轮换客户端凭据失败。', 'Failed to rotate client credential.'));
					confirm.disabled = false;
					cancel.disabled = false;
				}
			})();
		});
	}
}
