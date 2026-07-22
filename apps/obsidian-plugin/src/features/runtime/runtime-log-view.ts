import { App, ItemView, Modal, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import {
	RUNTIME_LOG_CLEANUP_OPTIONS,
	RUNTIME_LOG_FILTERS,
	RUNTIME_LOG_PAGE_SIZE,
	runtimeLogCleanupScopeLabel,
	type RuntimeLogCategory,
	type RuntimeLogCleanupScope,
	type RuntimeLogFilter,
	type RuntimeLogItem,
	type RuntimeLogSnapshot,
} from './runtime-log-model';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_RUNTIME_LOG_VIEW } from '../../ui/view-types';
import { trimText } from '../shared/markdown-record-parser';

export class RuntimeLogCleanupModal extends Modal {
	private selectedScope: RuntimeLogCleanupScope = 'older-than-week';

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private onCleaned: () => Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(ui('清理运行日志', 'Clear runtime log'));

		contentEl.createEl('p', {
			text: ui(
				'选择要清理的日志范围。该操作只会清理运行日志，不会删除任务、记忆或审核内容。',
				'Choose which runtime log entries to clear. This only clears runtime logs; tasks, memories, and review items are not deleted.'
			),
			cls: 'tracekeeper-view__description',
		});

		new Setting(contentEl)
			.setName(ui('清理范围', 'Range'))
			.setDesc(ui('按日志时间清理旧记录。', 'Clear old records by log time.'))
			.addDropdown((dropdown) => {
				for (const scope of RUNTIME_LOG_CLEANUP_OPTIONS) {
					dropdown.addOption(scope, runtimeLogCleanupScopeLabel(scope));
				}
				dropdown
					.setValue(this.selectedScope)
					.onChange((value: string) => {
						this.selectedScope = this.normalizeScope(value);
					});
			});

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const status = actions.createEl('span', { cls: 'tracekeeper-view__description' });
		const confirm = actions.createEl('button', {
			text: ui('清理', 'Clear'),
			cls: 'mod-warning',
		});
		confirm.addEventListener('click', () => {
			void (async () => {
				confirm.disabled = true;
				cancel.disabled = true;
				status.setText(ui('正在清理...', 'Clearing...'));
				try {
					const result = await this.plugin.cleanRuntimeLogs(this.selectedScope);
					new Notice(ui(
						`已清理 ${result.removedSections + result.removedFiles} 条日志记录。`,
						`Cleared ${result.removedSections + result.removedFiles} runtime log record(s).`
					));
					await this.onCleaned();
					this.close();
				} catch (error) {
					console.error('tracekeeper failed to clear runtime logs', error);
					status.setText(ui('清理失败，请稍后重试。', 'Clear failed. Try again later.'));
					confirm.disabled = false;
					cancel.disabled = false;
				}
			})();
		});
	}

	private normalizeScope(value: string): RuntimeLogCleanupScope {
		return RUNTIME_LOG_CLEANUP_OPTIONS.includes(value as RuntimeLogCleanupScope)
			? value as RuntimeLogCleanupScope
			: 'older-than-week';
	}
}

export class TracekeeperRuntimeLogView extends ItemView {
	private page = 1;
	private activeFilter: RuntimeLogFilter = 'all';

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_RUNTIME_LOG_VIEW;
	}

	getDisplayText() {
		return ui('运行日志', 'Runtime log');
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
		await this.refresh();
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadRuntimeLogSnapshot(
			this.page,
			this.activeFilter,
			RUNTIME_LOG_PAGE_SIZE
		);
		this.page = snapshot.page;
		this.render(snapshot);
	}

	private render(snapshot: RuntimeLogSnapshot): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		const heading = header.createDiv();
		heading.createEl('h2', {
			text: ui('运行日志', 'Runtime log'),
			cls: 'tracekeeper-view__title',
		});
		heading.createEl('p', {
			text: ui(
				'查看连接、工具调用、配置写入和错误记录。',
				'Review connection, tool call, config, and error records.'
			),
			cls: 'tracekeeper-view__description',
		});
		const actions = header.createDiv({ cls: 'tracekeeper-action-row' });
		const cleanupButton = actions.createEl('button', {
			text: ui('清理', 'Clear'),
		});
		cleanupButton.addEventListener('click', () => {
			new RuntimeLogCleanupModal(this.app, this.plugin, async () => {
				this.page = 1;
				await this.refresh();
			}).open();
		});
		const refreshButton = actions.createEl('button', {
			text: ui('刷新', 'Refresh'),
			cls: 'mod-cta',
		});
		refreshButton.addEventListener('click', () => {
			void this.refresh();
		});

		this.renderFilterToolbar(contentEl, snapshot);

		const summary = contentEl.createDiv({ cls: 'tracekeeper-view__description' });
		summary.setText(ui(
			`共 ${snapshot.totalItems} 条 · 第 ${snapshot.page} / ${snapshot.totalPages} 页`,
			`${snapshot.totalItems} total · Page ${snapshot.page} of ${snapshot.totalPages}`
		));

		if (snapshot.items.length === 0) {
			this.renderEmptyState(
				contentEl,
				ui('还没有可展示的运行记录。', 'No runtime records yet.'),
				ui('AI 工具连接或使用 Tracekeeper 后，这里会显示记录。', 'Runtime records appear after an AI tool connects to or uses Tracekeeper.')
			);
			return;
		}

		const list = contentEl.createDiv({ cls: 'tracekeeper-runtime-log-list' });
		for (const item of snapshot.items) {
			this.renderLogItem(list, item);
		}
		this.renderPagination(contentEl, snapshot);
	}

	private renderFilterToolbar(container: HTMLElement, snapshot: RuntimeLogSnapshot): void {
		const toolbar = container.createDiv({ cls: 'tracekeeper-runtime-log-toolbar' });
		for (const filter of RUNTIME_LOG_FILTERS) {
			const count = snapshot.counts[filter] || 0;
			const button = toolbar.createEl('button', {
				text: `${this.filterLabel(filter)} (${count})`,
				cls: snapshot.filter === filter ? 'is-active' : '',
			});
			button.addEventListener('click', () => {
				this.activeFilter = filter;
				this.page = 1;
				void this.refresh();
			});
		}
	}

	private renderLogItem(container: HTMLElement, item: RuntimeLogItem): void {
		const row = container.createDiv({ cls: 'tracekeeper-runtime-log-row' });
		row.createEl('div', {
			text: this.categoryLabel(item.category),
			cls: 'tracekeeper-runtime-log-row__badge tracekeeper-badge',
		});
		const body = row.createDiv({ cls: 'tracekeeper-runtime-log-row__body' });
		body.createEl('strong', {
			text: `${item.title || ui('运行记录', 'Runtime record')} • ${this.plugin.formatDisplayTime(item.time)}`,
		});
		if (item.meta) {
			body.createEl('div', { text: item.meta, cls: 'tracekeeper-view__description' });
		}
		if (item.body) {
			body.createEl('div', { text: trimText(item.body, 180) });
		}
		if (item.path) {
			body.createEl('small', { text: item.path });
		}
	}

	private renderPagination(container: HTMLElement, snapshot: RuntimeLogSnapshot): void {
		const pager = container.createDiv({ cls: 'tracekeeper-pagination' });
		const previous = pager.createEl('button', { text: ui('上一页', 'Previous') });
		previous.disabled = snapshot.page <= 1;
		previous.addEventListener('click', () => {
			this.page = Math.max(1, snapshot.page - 1);
			void this.refresh();
		});
		pager.createEl('span', {
			text: ui(
				`第 ${snapshot.page} / ${snapshot.totalPages} 页`,
				`Page ${snapshot.page} of ${snapshot.totalPages}`
			),
			cls: 'tracekeeper-view__description',
		});
		const next = pager.createEl('button', { text: ui('下一页', 'Next') });
		next.disabled = snapshot.page >= snapshot.totalPages;
		next.addEventListener('click', () => {
			this.page = Math.min(snapshot.totalPages, snapshot.page + 1);
			void this.refresh();
		});
	}

	private filterLabel(filter: RuntimeLogFilter): string {
		switch (filter) {
			case 'connection':
				return ui('连接', 'Connections');
			case 'tool':
				return ui('工具调用', 'Tool calls');
			case 'config':
				return ui('配置', 'Config');
			case 'error':
				return ui('错误', 'Errors');
			case 'all':
			default:
				return ui('全部', 'All');
		}
	}

	private categoryLabel(category: RuntimeLogCategory): string {
		switch (category) {
			case 'connection':
				return ui('连接', 'Connection');
			case 'tool':
				return ui('工具调用', 'Tool call');
			case 'config':
				return ui('配置', 'Config');
			case 'record':
			default:
				return ui('记录', 'Record');
		}
	}

	private renderEmptyState(container: HTMLElement, title: string, detail: string): void {
		const state = container.createDiv({ cls: 'tracekeeper-empty-state' });
		state.createEl('strong', { text: title });
		state.createEl('p', { text: detail });
	}
}
