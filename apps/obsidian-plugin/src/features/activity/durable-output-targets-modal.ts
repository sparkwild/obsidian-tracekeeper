import { App, Modal, TFile } from 'obsidian';
import { ui } from '../../ui/localization';

export class DurableOutputTargetsModal extends Modal {
	constructor(
		app: App,
		private targetPaths: readonly string[],
		private taskId: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(ui('持久化目标', 'Durable output targets'));
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			text: ui(
				'以下为任务报告的持久化目标证据。列表仅展示可验证路径，不代表目标已被成功写入。',
				'The following are durable output target evidences for the task. This list only shows reported paths, and is not proof of writeback success.'
			),
			cls: 'tracekeeper-view__description',
		});
		if (this.taskId) {
			this.contentEl.createEl('p', {
				text: ui(`任务 ID：${this.taskId}`, `Task ID: ${this.taskId}`),
				cls: 'tracekeeper-view__description',
			});
		}
		if (this.targetPaths.length === 0) {
			this.contentEl.createEl('p', {
				text: ui(
					'没有可导航的持久化目标路径（路径已被拒绝，或不在 Wiki/Memory 受管路径下）。',
					'No navigable durable output target paths remain after safe-path validation.'
				),
				cls: 'tracekeeper-view__description',
			});
			return;
		}
		const list = this.contentEl.createEl('ul');
		for (const path of this.targetPaths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			const row = list.createEl('li', { cls: 'tracekeeper-task-card__info' });
			row.createSpan({
				text: path,
				attr: { title: path },
			});
			if (file instanceof TFile) {
				const openButton = row.createEl('button', {
					text: ui('打开', 'Open'),
					cls: 'tracekeeper-task-card__change-chip',
				});
				openButton.addEventListener('click', () => {
					this.close();
					void this.app.workspace.getLeaf(false).openFile(file);
				});
			} else {
				row.createEl('small', {
					text: ui('目标不存在', 'Target missing'),
					cls: 'tracekeeper-view__description',
				});
			}
		}
		const actions = this.contentEl.createDiv({ cls: 'tracekeeper-action-row' });
		const closeButton = actions.createEl('button', { text: ui('关闭', 'Close') });
		closeButton.addEventListener('click', () => {
			this.close();
		});
	}
}
