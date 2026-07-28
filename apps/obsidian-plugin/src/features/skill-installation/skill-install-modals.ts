import { App, Modal, Notice } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { SkillInstallPlan } from '../../adapters/client-skill-adapter';
import { ui } from '../../ui/localization';

export class SkillInstallPreviewModal extends Modal {
	private plan: SkillInstallPlan | null = null;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private clientId: string,
		private action: 'install' | 'update' | 'migrate',
		private onChanged?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		try {
			this.plan = this.plugin.prepareSkillInstall(this.clientId, this.action);
		} catch (error) {
			contentEl.createEl('h2', { text: ui('无法预览 Skill', 'Cannot preview Skill change') });
			contentEl.createEl('p', { text: error instanceof Error ? error.message : String(error) });
			return;
		}

		contentEl.createEl('h2', {
			text: this.action === 'install'
				? ui('确认安装 Skill', 'Confirm Skill install')
				: this.action === 'update'
					? ui('确认更新 Skill', 'Confirm Skill update')
					: ui('确认迁移 Skill', 'Confirm Skill migration'),
		});
		contentEl.createEl('p', {
			text: ui(
				this.action === 'migrate'
					? '只会将下列 Tracekeeper bundle 文件复制到官方目录；旧目录不会删除或改写。确认时会重新检查目标目录 hash。'
					: '只会写入下列 Tracekeeper bundle 文件；其他文件保持不变。更新前会备份已有受管文件，确认时会重新检查原始 hash。',
				this.action === 'migrate'
					? 'Only the listed Tracekeeper bundle files are copied to the official directory. The legacy directory is never removed or changed. Target hashes are rechecked at confirmation.'
					: 'Only the listed Tracekeeper bundle files will be written. Other files stay unchanged. Existing managed files are backed up, and original hashes are rechecked at confirmation.'
			),
			cls: 'tracekeeper-view__description',
		});
		const details = contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(details, ui('目标目录', 'Target directory'), this.plan.targetDirectory || ui('不可用', 'Unavailable'));
		this.renderDetail(details, ui('操作', 'Action'), this.plan.action);
		this.renderDetail(details, ui('有效期', 'Expires'), this.plan.expiresAt || ui('不可确认', 'Cannot confirm'));
		const list = contentEl.createEl('ul');
		for (const file of this.plan.files) {
			list.createEl('li', { text: `${file.change}: ${file.path}` });
		}

		if (!this.plan.canConfirm) {
			contentEl.createEl('p', { text: this.plan.detail, cls: 'tracekeeper-badge tracekeeper-badge--warning' });
			return;
		}

		const actions = contentEl.createDiv({ cls: 'tracekeeper-action-row' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', { text: ui('确认写入', 'Confirm write'), cls: 'mod-cta' });
		confirm.addEventListener('click', () => {
			void (async () => {
				const plan = this.plan;
				if (!plan) return;
				confirm.disabled = true;
				cancel.disabled = true;
				try {
					await this.plugin.confirmSkillInstall(plan.planId, this.action, this.clientId);
					this.onChanged?.();
					this.close();
				} catch (error) {
					console.error('tracekeeper failed to confirm Skill change', error);
					new Notice(ui('Skill 未修改，请重新预览。', 'Skill was not changed. Preview again.'));
					cancel.disabled = false;
				}
			})();
		});
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}
}
