import { ItemView, WorkspaceLeaf } from 'obsidian';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_MEMORY_INSPECTOR_VIEW } from '../../ui/view-types';

export class TracekeeperMemoryInspectorView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_MEMORY_INSPECTOR_VIEW;
	}

	getDisplayText() {
		return ui('记忆查看', 'Memory view');
	}

	getViewData() {
		return '';
	}

	setViewData(_data: string, _clear: boolean): void {
		return;
	}

	clear(): void {
		this.contentEl.empty();
	}

	async onOpen() {
		await super.onOpen();
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		contentEl.createEl('h2', { text: ui('记忆查看', 'Memory view'), cls: 'tracekeeper-view__title' });
		contentEl.createEl('p', {
			text: ui(
				'这里用于查看已保存的记忆、来源证据和最近使用情况。完成一次审核或记录后，相关内容会逐步出现在这里。',
				'Use this page to review saved memories, source evidence, and recent usage. Related details appear here after review or recording activity.'
			),
			cls: 'tracekeeper-view__description',
		});
	}
}
