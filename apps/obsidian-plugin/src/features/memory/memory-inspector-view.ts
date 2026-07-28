import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import {
	type MemoryInspectorQuery,
	type MemoryInspectorRecord,
	type MemoryInspectorSnapshot,
	type MemoryPersistenceState,
	type MemoryRecordScope,
	type MemoryScopeFilter,
	type MemoryStateFilter,
} from '../observability/knowledge-observability-model';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_MEMORY_INSPECTOR_VIEW } from '../../ui/view-types';
import { trimText } from '../shared/markdown-record-parser';

export class TracekeeperMemoryInspectorView extends ItemView {
	private query: MemoryInspectorQuery = {
		page: 1,
		scope: 'all',
		state: 'all',
	};

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
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
		await this.refresh();
	}

	async focus(query: Pick<MemoryInspectorQuery, 'focusPaths' | 'taskId'>): Promise<void> {
		this.query = {
			...this.query,
			page: 1,
			focusPaths: query.focusPaths,
			taskId: query.taskId,
		};
		await this.refresh();
	}

	private async render(snapshot: MemoryInspectorSnapshot): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		const heading = header.createDiv();
		heading.createEl('h2', { text: ui('记忆查看', 'Memory view'), cls: 'tracekeeper-view__title' });
		heading.createEl('p', {
			text: ui(
				'查看全局与项目记忆的 Markdown 证据，以及仍在审核或已经失效的引用。',
				'Inspect Markdown evidence for global and project memory, including queued changes and stale references.'
			),
			cls: 'tracekeeper-view__description',
		});
		const refreshButton = header.createEl('button', { text: ui('刷新', 'Refresh') });
		refreshButton.addEventListener('click', () => {
			void this.refreshWithNotice(refreshButton);
		});

		this.renderIndexStatus(contentEl, snapshot);
		this.renderFilters(contentEl, snapshot);

		if (snapshot.focused) {
			const focus = contentEl.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-focus' });
			const focusHeader = focus.createDiv({ cls: 'tracekeeper-card__header' });
			focusHeader.createEl('strong', {
				text: ui('仅显示所选任务关联的记忆', 'Showing memory related to the selected task'),
			});
			const clearButton = focusHeader.createEl('button', { text: ui('显示全部', 'Show all') });
			clearButton.addEventListener('click', () => {
				this.query = {
					...this.query,
					page: 1,
					focusPaths: [],
					taskId: '',
				};
				void this.refresh();
			});
		}

		if (snapshot.missingMemoryFolder) {
			this.renderEmptyState(
				contentEl,
				ui('记忆目录尚未初始化', 'Memory folder is not initialized'),
				ui(
					'请先在 Tracekeeper 中校验知识库结构；该操作只补齐受控目录和入口文件。',
					'Check the knowledge structure in Tracekeeper first. This only creates controlled folders and entry notes.'
				)
			);
			return;
		}

		if (snapshot.records.length === 0) {
			this.renderEmptyState(
				contentEl,
				snapshot.focused
					? ui('所选任务没有可显示的记忆证据', 'No memory evidence is available for the selected task')
					: ui('没有符合筛选条件的记忆记录', 'No memory records match these filters'),
				snapshot.focused
					? ui('可返回全部记录，或打开任务 Markdown 检查原始引用。', 'Show all records or open the task Markdown to inspect its original references.')
					: ui('调整范围或持久化状态筛选；待审核提案不会被描述为已保存记忆。', 'Change the scope or persistence filter. Pending proposals are not described as saved memory.')
			);
		} else {
			const list = contentEl.createDiv({ cls: 'tracekeeper-observability-list' });
			for (const record of snapshot.records) {
				this.renderMemoryRecord(list, record);
			}
		}

		this.renderPagination(contentEl, snapshot);
	}

	private renderIndexStatus(container: HTMLElement, snapshot: MemoryInspectorSnapshot): void {
		if (snapshot.indexState !== 'ready') {
			const warning = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-warning' });
			warning.createEl('strong', {
				text: snapshot.indexState === 'rebuilding'
					? ui('知识索引正在重建', 'Knowledge index is rebuilding')
					: ui('知识索引正在初始化', 'Knowledge index is initializing'),
			});
			warning.createEl('p', {
				text: ui(
					'当前列表可能暂时不完整。等待索引就绪后刷新，不需要重新扫描整个仓库。',
					'The list may be temporarily incomplete. Refresh after the index is ready; no full-Vault rescan is needed here.'
				),
			});
		}
		if (snapshot.readFailures.length > 0) {
			const warning = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-warning' });
			warning.createEl('strong', {
				text: ui(
					`${snapshot.readFailures.length} 个记忆文件读取失败`,
					`${snapshot.readFailures.length} memory files could not be read`
				),
			});
			warning.createEl('p', {
				text: ui(
					'请检查文件权限或 Markdown 是否仍可访问，然后使用“重建知识索引”命令重试。',
					'Check file access, then retry with the Rebuild knowledge index command.'
				),
			});
		}
		if (snapshot.staleRecordCount > 0) {
			const warning = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-warning' });
			warning.createEl('strong', {
				text: ui(
					`${snapshot.staleRecordCount} 条引用缺少持久化证据`,
					`${snapshot.staleRecordCount} references lack persisted evidence`
				),
			});
			warning.createEl('p', {
				text: ui(
					'这些记录来自任务或已写入提案，但目标 Markdown 不存在。打开证据记录核对，不会自动补写。',
					'These references come from tasks or applied proposals whose target Markdown is missing. Open the evidence record to inspect it; Tracekeeper will not recreate it automatically.'
				),
			});
		}
	}

	private renderFilters(container: HTMLElement, snapshot: MemoryInspectorSnapshot): void {
		const filters = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-filters' });
		const summary = filters.createDiv();
		summary.createEl('strong', {
			text: ui(
				`${snapshot.totalItems} 条记录`,
				`${snapshot.totalItems} records`
			),
		});
		summary.createEl('div', {
			text: `${ui('索引代次', 'Index generation')} ${snapshot.indexGeneration} · ${ui('最后刷新', 'Last refreshed')} ${this.plugin.formatDisplayTime(Date.parse(snapshot.updatedAt))}`,
			cls: 'tracekeeper-view__description',
		});
		const controls = filters.createDiv({ cls: 'tracekeeper-action-row' });
		const scopeSelect = controls.createEl('select') as HTMLSelectElement;
		this.addOption(scopeSelect, 'all', ui('全部范围', 'All scopes'), snapshot.scope);
		this.addOption(scopeSelect, 'global', ui('全局记忆', 'Global memory'), snapshot.scope);
		this.addOption(scopeSelect, 'project', ui('项目记忆', 'Project memory'), snapshot.scope);
		scopeSelect.setAttr('aria-label', ui('按记忆范围筛选', 'Filter by memory scope'));
		scopeSelect.addEventListener('change', () => {
			this.query = { ...this.query, page: 1, scope: scopeSelect.value as MemoryScopeFilter };
			void this.refresh();
		});

		const stateSelect = controls.createEl('select') as HTMLSelectElement;
		this.addOption(stateSelect, 'all', ui('全部状态', 'All states'), snapshot.state);
		this.addOption(stateSelect, 'persisted', ui('已保存', 'Persisted'), snapshot.state);
		this.addOption(stateSelect, 'queued', ui('待确认', 'Queued'), snapshot.state);
		this.addOption(stateSelect, 'missing', ui('证据缺失', 'Missing evidence'), snapshot.state);
		stateSelect.setAttr('aria-label', ui('按持久化状态筛选', 'Filter by persistence state'));
		stateSelect.addEventListener('change', () => {
			this.query = { ...this.query, page: 1, state: stateSelect.value as MemoryStateFilter };
			void this.refresh();
		});
	}

	private addOption(
		select: HTMLSelectElement,
		value: string,
		label: string,
		selected: string
	): void {
		const option = select.createEl('option', { text: label, value });
		option.selected = value === selected;
	}

	private renderMemoryRecord(container: HTMLElement, record: MemoryInspectorRecord): void {
		const item = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-record' });
		const header = item.createDiv({ cls: 'tracekeeper-card__header' });
		const title = header.createDiv();
		title.createEl('strong', { text: record.title || record.path || ui('未命名记忆', 'Untitled memory') });
		title.createEl('div', {
			text: record.path || ui('目标路径尚未确定', 'Target path is not resolved'),
			cls: 'tracekeeper-observability-record__path',
		});
		header.createEl('span', {
			text: this.memoryStateLabel(record.state),
			cls: `tracekeeper-badge ${this.memoryStateClass(record.state)}`,
		});

		const details = item.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(details, ui('范围', 'Scope'), this.memoryScopeLabel(record.scope, record.project));
		this.renderDetail(details, ui('持久化', 'Persistence'), this.memoryStateDetail(record));
		this.renderDetail(details, ui('来源', 'Provenance'), record.provenance || ui('未记录', 'Not recorded'));
		if (record.taskId) {
			this.renderDetail(details, ui('任务', 'Task'), record.taskId);
		}
		if (record.summary) {
			item.createEl('p', {
				text: trimText(record.summary, 180),
				cls: 'tracekeeper-view__description',
			});
		}
		const actions = item.createDiv({ cls: 'tracekeeper-action-row' });
		const openButton = actions.createEl('button', {
			text: record.state === 'missing'
				? ui('打开引用证据', 'Open reference evidence')
				: ui('打开 Markdown', 'Open Markdown'),
		});
		openButton.addEventListener('click', () => {
			void this.openMarkdown(record.evidencePath);
		});
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value || ui('暂无', 'None') });
	}

	private memoryScopeLabel(scope: MemoryRecordScope, project: string): string {
		if (scope === 'project') {
			return project
				? ui(`项目 · ${project}`, `Project · ${project}`)
				: ui('项目记忆', 'Project memory');
		}
		return ui('全局记忆', 'Global memory');
	}

	private memoryStateLabel(state: MemoryPersistenceState): string {
		switch (state) {
			case 'persisted':
				return ui('已保存', 'Persisted');
			case 'queued':
				return ui('待确认', 'Queued');
			case 'missing':
				return ui('证据缺失', 'Missing evidence');
		}
	}

	private memoryStateDetail(record: MemoryInspectorRecord): string {
		switch (record.state) {
			case 'persisted':
				return ui('Markdown 已存在', 'Markdown exists');
			case 'queued':
				return ui(`提案 ${record.status}`, `Proposal ${record.status}`);
			case 'missing':
				return ui('目标 Markdown 不存在', 'Target Markdown is missing');
		}
	}

	private memoryStateClass(state: MemoryPersistenceState): string {
		switch (state) {
			case 'persisted':
				return 'tracekeeper-badge--success';
			case 'queued':
				return 'tracekeeper-badge--warning';
			case 'missing':
				return 'tracekeeper-badge--error';
		}
	}

	private renderPagination(container: HTMLElement, snapshot: MemoryInspectorSnapshot): void {
		if (snapshot.totalPages <= 1) {
			return;
		}
		const pagination = container.createDiv({ cls: 'tracekeeper-action-row tracekeeper-observability-pagination' });
		const previous = pagination.createEl('button', { text: ui('上一页', 'Previous') });
		previous.disabled = snapshot.page <= 1;
		previous.addEventListener('click', () => {
			this.query = { ...this.query, page: snapshot.page - 1 };
			void this.refresh();
		});
		pagination.createEl('span', {
			text: ui(
				`第 ${snapshot.page} / ${snapshot.totalPages} 页`,
				`Page ${snapshot.page} of ${snapshot.totalPages}`
			),
		});
		const next = pagination.createEl('button', { text: ui('下一页', 'Next') });
		next.disabled = snapshot.page >= snapshot.totalPages;
		next.addEventListener('click', () => {
			this.query = { ...this.query, page: snapshot.page + 1 };
			void this.refresh();
		});
	}

	private renderEmptyState(container: HTMLElement, title: string, detail: string): void {
		const empty = container.createDiv({ cls: 'tracekeeper-empty-state' });
		empty.createEl('strong', { text: title });
		empty.createEl('p', { text: detail });
	}

	private async openMarkdown(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(ui('没有找到对应的 Markdown 证据。', 'The related Markdown evidence was not found.'));
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	private async refreshWithNotice(button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		button.setText(ui('刷新中...', 'Refreshing...'));
		try {
			await this.refresh();
			new Notice(ui('记忆记录已刷新。', 'Memory records refreshed.'));
		} catch (error) {
			console.error('tracekeeper failed to refresh memory view', error);
			button.disabled = false;
			button.setText(ui('刷新', 'Refresh'));
			new Notice(ui('刷新记忆记录失败。', 'Failed to refresh memory records.'));
		}
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadMemoryInspectorSnapshot(this.query);
		await this.render(snapshot);
	}
}
