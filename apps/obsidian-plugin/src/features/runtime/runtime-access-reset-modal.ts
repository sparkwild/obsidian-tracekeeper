import { App, Modal, Notice } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import { ui } from '../../ui/localization';
import { RuntimeAccessResetError } from './runtime-access-reset-controller';

export class RuntimeAccessResetModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TracekeeperPlugin,
		private readonly onReset?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', {
			text: ui('重置访问凭据', 'Reset access credential'),
		});
		contentEl.createEl('p', {
			text: ui(
				'这是一项全局操作：全部现有 MCP Session 会立即终止，所有已连接的 AI 工具都需要重新授权。',
				'This is a global action: every existing MCP session ends immediately, and every connected AI tool must authorize again.'
			),
		});
		contentEl.createEl('p', {
			text: ui(
				'Tracekeeper 不会自动改写客户端配置。重置成功后，请从各客户端的原生 MCP 入口重新连接。',
				'Tracekeeper does not rewrite client configuration automatically. After reset succeeds, reconnect from each client-native MCP entry.'
			),
			cls: 'tracekeeper-view__description',
		});
		const actions = contentEl.createDiv({ cls: 'tracekeeper-action-row' });
		const cancel = actions.createEl('button', {
			text: ui('取消', 'Cancel'),
		});
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			text: ui('确认全局重置', 'Confirm global reset'),
			cls: 'mod-warning',
		});
		const status = contentEl.createEl('p', {
			cls: 'tracekeeper-view__description',
		});
		confirm.addEventListener('click', () => {
			confirm.disabled = true;
			cancel.disabled = true;
			status.setText(ui('正在安全重启 MCP 服务...', 'Safely restarting the MCP service...'));
			void this.plugin.resetRuntimeAccessCredential()
				.then((result) => {
					this.onReset?.();
					new Notice(result.runtimeRestarted
						? ui(
							'MCP 访问凭据已重置；现有客户端需要重新授权。',
							'MCP access credential reset. Existing clients must authorize again.'
						)
						: ui(
							'MCP 访问凭据已重置；服务保持关闭，现有客户端需要在服务恢复后重新授权。',
							'MCP access credential reset. The service remains off, and existing clients must authorize again after it resumes.'
						));
					this.close();
				})
				.catch((error: unknown) => {
					console.error('tracekeeper runtime access credential reset failed');
					const rollbackSucceeded = error instanceof RuntimeAccessResetError
						&& error.rollbackSucceeded;
					status.setText(rollbackSucceeded
						? ui(
							'重置失败；先前凭据和 MCP 服务状态已恢复。',
							'Reset failed. The previous credential and MCP service state were restored.'
						)
						: ui(
							'重置失败且自动恢复未完成。请重启 Obsidian 后再重新授权客户端。',
							'Reset failed and automatic recovery did not complete. Restart Obsidian before authorizing clients again.'
						));
					if (rollbackSucceeded) {
						confirm.disabled = false;
						cancel.disabled = false;
					}
				});
		});
	}
}
