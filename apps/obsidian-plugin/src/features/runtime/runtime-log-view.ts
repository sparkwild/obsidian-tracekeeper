import { App, ItemView, Modal, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import {
	RUNTIME_LOG_CLEANUP_OPTIONS,
	RUNTIME_LOG_FILTERS,
	RUNTIME_LOG_MAX_EVENTS,
	RUNTIME_LOG_PAGE_SIZE,
	runtimeLogCleanupScopeLabel,
	type RuntimeLogCategory,
	type RuntimeLogCleanupFile,
	type RuntimeLogCleanupPreview,
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
	private preview: RuntimeLogCleanupPreview | null = null;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private onCleaned: () => Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass('tracekeeper-runtime-log-cleanup-modal');
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(ui('清理 Agent 活动', 'Clear Agent activity'));

		if (this.preview) {
			this.renderPreview(this.preview);
			return;
		}

		contentEl.createEl('p', {
			text: ui(
				'先预览将按 Obsidian 当前“删除的文件”设置整体处理的 Agent 活动分片。任务、记忆、审核项和含有新旧混合事件的文件不会被改写。',
				'Preview the whole Agent activity shards that will be handled through Obsidian current deleted-files setting. Tasks, memories, review items, and files containing mixed old and new events are not rewritten.'
			),
			cls: 'tracekeeper-view__description',
		});

		new Setting(contentEl)
			.setName(ui('清理范围', 'Range'))
			.setDesc(ui('按活动时间清理旧分片。', 'Clear old activity shards by event time.'))
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
		const status = actions.createEl('span', {
			cls: 'tracekeeper-view__description',
			attr: {
				role: 'status',
				'aria-live': 'polite',
			},
		});
		const previewButton = actions.createEl('button', {
			text: ui('预览', 'Preview'),
			cls: 'mod-cta',
		});
		previewButton.addEventListener('click', () => {
			void (async () => {
				previewButton.disabled = true;
				cancel.disabled = true;
				status.setText(ui('正在生成最新预览...', 'Building a fresh preview...'));
				try {
					this.preview = await this.plugin.previewRuntimeLogCleanup(
						this.selectedScope
					);
					this.render();
				} catch (error) {
					console.error('tracekeeper failed to preview runtime log cleanup', error);
					status.setText(ui(
						'预览失败，未处理任何文件。请刷新后重试。',
						'Preview failed and no files were handled. Refresh and try again.'
					));
					previewButton.disabled = false;
					cancel.disabled = false;
					previewButton.focus();
				}
			})();
		});
		previewButton.focus();
	}

	private renderPreview(preview: RuntimeLogCleanupPreview): void {
		const { contentEl } = this;
		contentEl.createEl('p', {
			text: ui(
				`预览将按当前删除设置整体处理 ${preview.eligibleFiles.length} 个 Agent 活动分片；保留 ${preview.retainedFiles.length} 个文件。不会重写文件内的部分事件。`,
				`This preview handles ${preview.eligibleFiles.length} whole Agent activity shard(s) through the current deletion setting and retains ${preview.retainedFiles.length}. Individual events inside files are never rewritten.`
			),
			cls: 'tracekeeper-view__description',
		});
		contentEl.createEl('p', {
			text: preview.trashBehavior,
			cls: 'tracekeeper-view__description',
		});

		this.renderCleanupFileList(
			ui('将按当前删除设置处理', 'Will follow the current deletion setting'),
			preview.eligibleFiles
		);
		this.renderCleanupFileList(
			ui('将保留', 'Will retain'),
			preview.retainedFiles
		);

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const back = actions.createEl('button', { text: ui('返回', 'Back') });
		back.addEventListener('click', () => {
			this.preview = null;
			this.render();
		});
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const status = actions.createEl('span', {
			cls: 'tracekeeper-view__description',
			attr: {
				role: 'status',
				'aria-live': 'polite',
			},
		});
		const confirm = actions.createEl('button', {
			text: ui(
				'确认按 Obsidian 当前删除设置处理',
				'Confirm Obsidian file removal'
			),
			cls: 'mod-warning',
		});
		confirm.disabled = preview.eligibleFiles.length === 0;
		confirm.addEventListener('click', () => {
			void (async () => {
				confirm.disabled = true;
				back.disabled = true;
				cancel.disabled = true;
				status.setText(ui(
					'正在重新校验并按当前删除设置处理文件...',
					'Revalidating and applying the current deletion setting...'
				));
				try {
					const result = await this.plugin.commitRuntimeLogCleanup(
						preview,
						preview.confirmationToken
					);
					await this.onCleaned();
					if (result.status === 'partial') {
						status.setText(ui(
							`已确认处理 ${result.trashedPaths.length} 个文件，${result.failed.length} 个失败，${result.stale.length} 个已漂移或结果未知。未确认处理的文件不会自动重试；关闭后请重新预览。`,
							`Confirmed ${result.trashedPaths.length} file(s) handled; ${result.failed.length} failed and ${result.stale.length} changed, disappeared, or have an unknown outcome. Unconfirmed files are not retried automatically; close and build a new preview.`
						));
						new Notice(ui(
							'Agent 活动清理部分完成；请检查失败、漂移或结果未知的文件。',
							'Agent activity cleanup partially completed; review failed, stale, or outcome-unknown files.'
						));
						cancel.disabled = false;
						cancel.setText(ui('关闭', 'Close'));
						cancel.focus();
						return;
					}
					new Notice(ui(
						`已按 Obsidian 当前删除设置处理 ${result.trashedPaths.length} 个 Agent 活动分片。`,
						`Handled ${result.trashedPaths.length} Agent activity shard(s) through Obsidian current deleted-files setting.`
					));
					this.close();
				} catch (error) {
					console.error('tracekeeper failed to commit runtime log cleanup', error);
					status.setText(ui(
						'预览已失效或清理失败；未处理的文件仍保留。请返回并生成新预览。',
						'The preview became stale or cleanup failed. Unprocessed files remain; go back and build a new preview.'
					));
					back.disabled = false;
					cancel.disabled = false;
					confirm.disabled = preview.eligibleFiles.length === 0;
					back.focus();
				}
			})();
		});
		cancel.focus();
	}

	private renderCleanupFileList(
		title: string,
		files: RuntimeLogCleanupFile[]
	): void {
		const section = this.contentEl.createDiv({
			cls: 'tracekeeper-runtime-log-cleanup-modal__files',
		});
		section.createEl('h3', { text: `${title} (${files.length})` });
		if (files.length === 0) {
			section.createEl('p', {
				text: ui('无', 'None'),
				cls: 'tracekeeper-view__description',
			});
			return;
		}
		const list = section.createEl('ul', {
			cls: 'tracekeeper-runtime-log-cleanup-modal__file-list',
		});
		for (const file of files) {
			list.createEl('li', {
				text: `${file.path} · ${file.eventCount} · ${this.cleanupReasonLabel(file)}`,
			});
		}
	}

	private cleanupReasonLabel(file: RuntimeLogCleanupFile): string {
		switch (file.reason) {
			case 'clear-all':
				return ui('全部范围', 'clear-all selection');
			case 'wholly-eligible':
				return ui('全部事件早于截止时间', 'all events are older than the cutoff');
			case 'mixed-age':
				return ui('包含新旧混合事件', 'contains mixed old and new events');
			case 'too-new':
				return ui('事件未早于截止时间', 'events are not older than the cutoff');
			case 'empty-or-unparseable':
				return ui('空文件或时间不可解析', 'empty or unparseable timestamps');
		}
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
		return ui('Agent 活动详情', 'Agent activity details');
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
			text: ui('Agent 活动详情', 'Agent activity details'),
			cls: 'tracekeeper-view__title',
		});
		heading.createEl('p', {
			text: ui(
				'查看 MCP 连接、认证拒绝和工具调用活动；不记录用户界面操作。',
				'Review MCP connection, authentication-rejection, and tool-call activity; user interface operations are excluded.'
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
			snapshot.isTruncated
				? `显示最近 ${RUNTIME_LOG_MAX_EVENTS} 条中的 ${snapshot.totalItems} 条 · 第 ${snapshot.page} / ${snapshot.totalPages} 页`
				: `共 ${snapshot.totalItems} 条 · 第 ${snapshot.page} / ${snapshot.totalPages} 页`,
			snapshot.isTruncated
				? `${snapshot.totalItems} of the latest ${RUNTIME_LOG_MAX_EVENTS} · Page ${snapshot.page} of ${snapshot.totalPages}`
				: `${snapshot.totalItems} total · Page ${snapshot.page} of ${snapshot.totalPages}`
		));

		if (snapshot.items.length === 0) {
			this.renderEmptyState(
				contentEl,
				ui('还没有可展示的 Agent 活动。', 'No Agent activity yet.'),
				ui('AI 工具连接或使用 Tracekeeper 后，这里会显示活动。', 'Agent activity appears after an AI tool connects to or uses Tracekeeper.')
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
				text: `${item.title || ui('Agent 活动', 'Agent activity')} • ${this.plugin.formatDisplayTime(item.time)}`,
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
			case 'record':
			default:
				return ui('活动', 'Activity');
		}
	}

	private renderEmptyState(container: HTMLElement, title: string, detail: string): void {
		const state = container.createDiv({ cls: 'tracekeeper-empty-state' });
		state.createEl('strong', { text: title });
		state.createEl('p', { text: detail });
	}
}

/**
 * Detail view owned by the AI Assistant Activity surface. Keeping this in a
 * modal avoids exposing a second top-level log entry while preserving the
 * bounded pagination and explicit cleanup workflow for power users.
 */
export class AgentActivityDetailsModal extends Modal {
	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		this.titleEl.setText(ui('Agent 活动详情', 'Agent activity details'));
		this.contentEl.addClass('tracekeeper-view-root');
		try {
			const snapshot = await this.plugin.loadRuntimeLogSnapshot(1, 'all', RUNTIME_LOG_MAX_EVENTS);
			const header = this.contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
			header.createEl('p', {
				text: ui(
					'这里只展示 MCP 连接、认证拒绝和工具调用活动，不记录用户界面操作。',
					'Only MCP connection, authentication-rejection, and tool-call activity is shown here; user interface operations are excluded.'
				),
				cls: 'tracekeeper-view__description',
			});
			const actions = header.createDiv({ cls: 'tracekeeper-action-row' });
			const cleanupButton = actions.createEl('button', { text: ui('清理活动', 'Clear activity') });
			cleanupButton.addEventListener('click', () => {
				new RuntimeLogCleanupModal(this.app, this.plugin, async () => {
					this.close();
				}).open();
			});
			const list = this.contentEl.createDiv({ cls: 'tracekeeper-runtime-log-list' });
			if (snapshot.items.length === 0) {
				list.createEl('p', { text: ui('还没有 Agent 活动。', 'No Agent activity yet.'), cls: 'tracekeeper-view__description' });
				return;
			}
			for (const item of snapshot.items) {
				const row = list.createDiv({ cls: 'tracekeeper-runtime-log-row' });
				row.createEl('div', { text: this.categoryLabel(item.category), cls: 'tracekeeper-runtime-log-row__badge tracekeeper-badge' });
				const body = row.createDiv({ cls: 'tracekeeper-runtime-log-row__body' });
				body.createEl('strong', { text: `${item.title || ui('Agent 活动', 'Agent activity')} • ${this.plugin.formatDisplayTime(item.time)}` });
				if (item.meta) body.createEl('div', { text: item.meta, cls: 'tracekeeper-view__description' });
				if (item.body) body.createEl('div', { text: trimText(item.body, 240) });
				if (item.path) body.createEl('small', { text: item.path });
			}
		} catch (error) {
			this.contentEl.createEl('p', { text: ui('读取 Agent 活动失败。', 'Failed to read Agent activity.') });
			console.error('tracekeeper failed to render Agent activity details', error);
		}
	}

	private categoryLabel(category: RuntimeLogCategory): string {
		switch (category) {
			case 'connection':
				return ui('连接', 'Connection');
			case 'tool':
				return ui('工具调用', 'Tool call');
			default:
				return ui('活动', 'Activity');
		}
	}
}
