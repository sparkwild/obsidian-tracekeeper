import { App, Modal, Notice } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import { ui } from '../../ui/localization';

export class RuntimeAccessResetModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TracekeeperPlugin,
		private readonly onReset?: () => void | Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(ui('撤销全部 Agent 访问', 'Revoke all Agent access'));
		contentEl.createEl('p', {
			text: ui(
				'这是一项全局操作：所有 Agent 配置、凭据、Skill 状态记录和活动 Session 会立即清除。客户端目录中的实际 Skill 文件不会被删除。',
				'This is a global action: every Agent configuration, credential, Skill state record, and active Session is removed immediately. Actual Skill files in client directories are not deleted.'
			),
		});
		contentEl.createEl('p', {
			text: ui(
				'Tracekeeper 不会自动改写客户端配置。撤销后，需要重新添加 Agent 并从客户端原生 MCP 入口授权。',
				'Tracekeeper does not rewrite client configuration automatically. After revocation, add each Agent again and authorize it from the client-native MCP entry.'
			),
			cls: 'tracekeeper-view__description',
		});
		const actions = contentEl.createDiv({ cls: 'tracekeeper-action-row' });
		const cancel = actions.createEl('button', {
			text: ui('取消', 'Cancel'),
		});
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			text: ui('确认全部撤销', 'Confirm global revocation'),
			cls: 'mod-warning',
		});
		const status = contentEl.createEl('p', {
			cls: 'tracekeeper-view__description',
		});
		confirm.addEventListener('click', () => {
			confirm.disabled = true;
			cancel.disabled = true;
			status.setText(ui('正在撤销全部 Agent 访问...', 'Revoking all Agent access...'));
			void this.plugin.revokeAllAgentAccess()
				.then(async () => {
					await this.onReset?.();
					new Notice(ui(
						'全部 Agent 访问已撤销；现有客户端需要重新添加并授权。',
						'All Agent access was revoked. Existing clients must be added and authorized again.'
					));
					this.close();
				})
				.catch((error: unknown) => {
					console.error('tracekeeper Agent access revocation failed', error);
					status.setText(ui('撤销失败，请检查设置后重试。', 'Revocation failed. Check settings and try again.'));
					confirm.disabled = false;
					cancel.disabled = false;
				});
		});
	}
}
