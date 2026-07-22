import { App, Modal, Notice } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import { ui } from '../../ui/localization';

export class RuntimeTokenRegenerateConfirmModal extends Modal {
	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private onRegenerated: () => void
	) {
		super(app);
	}

	onOpen(): void {
		void super.onOpen();
		this.titleEl.setText(ui('重置全部凭据', 'Reset all credentials'));

		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', {
			text: ui('旧版共享令牌和所有 Agent 独立凭据都将失效，需要逐一更新连接配置。', 'The legacy token and every Agent credential will expire. Update each client connection afterward.'),
		});

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			text: ui('确认', 'Confirm'),
			cls: 'mod-warning',
		});
		confirm.addEventListener('click', () => {
			void (async () => {
				confirm.disabled = true;
				cancel.disabled = true;
				try {
					await this.plugin.regenerateRuntimeToken();
					this.onRegenerated();
					this.close();
				} catch (error) {
					console.error('tracekeeper failed to regenerate runtime token', error);
					new Notice(ui('重新生成令牌失败。', 'Failed to regenerate token.'));
					confirm.disabled = false;
					cancel.disabled = false;
				}
			})();
		});
	}
}
