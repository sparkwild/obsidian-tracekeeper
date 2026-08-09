import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { SourceRequestRecord } from '../activity/activity-model';
import {
	type SourceCaptureEvidenceIssue,
	type SourceStatusQuery,
	type SourceStatusRecord,
	type SourceStatusSnapshot,
} from '../observability/knowledge-observability-model';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_SOURCE_STATUS_VIEW } from '../../ui/view-types';
import { trimText } from '../shared/markdown-record-parser';

const sourceEvidenceIssueLabel = (issue: SourceCaptureEvidenceIssue): string => {
	switch (issue) {
		case 'type': return ui('记录类型（type）', 'Record type (type)');
		case 'source': return ui('原始来源（source）', 'Original source (source)');
		case 'source_kind': return ui('资料类型（source_kind）', 'Source type (source_kind)');
		case 'source_id': return ui('来源标识（source_id）', 'Source ID (source_id)');
		case 'content_hash': return ui('内容哈希（content_hash）', 'Content hash (content_hash)');
		case 'route': return ui('存储路由（route）', 'Storage route (route)');
		case 'mode': return ui('捕获模式（mode）', 'Capture mode (mode)');
		case 'part_count': return ui('分片数量（part_count）', 'Part count (part_count)');
		case 'part_manifest': return ui('分片清单（part_manifest）', 'Part manifest (part_manifest)');
		case 'source_part': return ui('分片文件（source_part）', 'Part file (source_part)');
		case 'source_part.parent_source': return ui('分片父记录（source_part.parent_source）', 'Part parent (source_part.parent_source)');
		case 'source_part.source_id': return ui('分片来源标识（source_part.source_id）', 'Part source ID (source_part.source_id)');
		case 'source_part.content_hash': return ui('分片内容哈希（source_part.content_hash）', 'Part content hash (source_part.content_hash)');
		case 'source_part.part_count': return ui('分片总数（source_part.part_count）', 'Child part count (source_part.part_count)');
		case 'source_part.part_number': return ui('分片序号（source_part.part_number）', 'Part number (source_part.part_number)');
	}
};

export class TracekeeperSourceStatusView extends ItemView {
	private query: SourceStatusQuery = { page: 1 };

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_SOURCE_STATUS_VIEW;
	}

	getDisplayText() {
		return ui('来源状态', 'Source status');
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

	async focus(query: Pick<SourceStatusQuery, 'focusPaths' | 'taskId'>): Promise<void> {
		this.query = {
			...this.query,
			page: 1,
			focusPaths: query.focusPaths,
			taskId: query.taskId,
		};
		await this.refresh();
	}

	private async render(snapshot: SourceStatusSnapshot): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		const heading = header.createDiv();
		heading.createEl('h2', { text: ui('来源状态', 'Source status'), cls: 'tracekeeper-view__title' });
		heading.createEl('p', {
			text: ui(
				'查看完整捕获、不完整或旧版资料记录，以及可用的任务、知识提案和收尾记录关系。',
				'Inspect complete captures, incomplete or legacy source records, and their available task, proposal, and final-note relationships.'
			),
			cls: 'tracekeeper-view__description',
		});
		const refreshButton = header.createEl('button', { text: ui('刷新', 'Refresh') });
		refreshButton.addEventListener('click', () => {
			void this.refreshWithNotice(refreshButton);
		});

		this.renderIndexStatus(contentEl, snapshot);

		if (snapshot.focused) {
			const focus = contentEl.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-focus' });
			const focusHeader = focus.createDiv({ cls: 'tracekeeper-card__header' });
			focusHeader.createEl('strong', {
				text: ui('仅显示所选任务关联的资料', 'Showing sources related to the selected task'),
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

		this.renderSourceRecords(contentEl, snapshot);
		this.renderRequests(contentEl, snapshot.requests, snapshot.missingRequestFolder);
	}

	private renderIndexStatus(container: HTMLElement, snapshot: SourceStatusSnapshot): void {
		const status = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-filters' });
		status.createEl('strong', {
			text: ui(`${snapshot.totalItems} 条资料记录`, `${snapshot.totalItems} source records`),
		});
		status.createEl('div', {
			text: `${ui('索引代次', 'Index generation')} ${snapshot.indexGeneration} · ${ui('最后刷新', 'Last refreshed')} ${this.plugin.formatDisplayTime(Date.parse(snapshot.updatedAt))}`,
			cls: 'tracekeeper-view__description',
		});
		if (snapshot.indexState !== 'ready') {
			const warning = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-warning' });
			warning.createEl('strong', {
				text: snapshot.indexState === 'rebuilding'
					? ui('知识索引正在重建', 'Knowledge index is rebuilding')
					: ui('知识索引正在初始化', 'Knowledge index is initializing'),
			});
			warning.createEl('p', {
				text: ui(
					'资料列表可能暂时不完整；索引就绪后刷新即可。',
					'The source list may be temporarily incomplete. Refresh after the index is ready.'
				),
			});
		}
		if (snapshot.readFailures.length > 0) {
			const warning = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-warning' });
			warning.createEl('strong', {
				text: ui(
					`${snapshot.readFailures.length} 个资料文件读取失败`,
					`${snapshot.readFailures.length} source files could not be read`
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
					`${snapshot.staleRecordCount} 条资料引用已经失效`,
					`${snapshot.staleRecordCount} source references are stale`
				),
			});
			warning.createEl('p', {
				text: ui(
					'任务或提案仍引用这些路径，但资料 Markdown 不存在。可打开引用证据核对；Tracekeeper 不会自动重建资料。',
					'Tasks or proposals still reference these paths, but the source Markdown is missing. Open the reference evidence to inspect it; Tracekeeper will not recreate the source automatically.'
				),
			});
		}
	}

	private renderSourceRecords(container: HTMLElement, snapshot: SourceStatusSnapshot): void {
		const section = container.createDiv({ cls: 'tracekeeper-card' });
		section.createEl('h3', { text: ui('资料记录', 'Source records') });

		if (snapshot.missingSourceFolder) {
			this.renderEmptyState(
				section,
				ui('资料目录尚未初始化', 'Source folder is not initialized'),
				ui(
					'请先校验 Tracekeeper 知识库结构，再由 Agent 使用 capture_source 保存资料。',
					'Check the Tracekeeper knowledge structure first, then let the Agent save material with capture_source.'
				)
			);
			return;
		}
		if (snapshot.records.length === 0) {
			this.renderEmptyState(
				section,
				snapshot.focused
					? ui('所选任务没有可显示的资料证据', 'No source evidence is available for the selected task')
					: ui('还没有资料记录', 'No source records yet'),
				snapshot.focused
					? ui('可返回全部资料，或打开任务记录检查原始引用。', 'Show all sources or open the task record to inspect its original references.')
					: ui(
						'Agent 完成资料获取后，应先调用 capture_source；完整捕获和可读取的不完整或旧版记录都会显示在这里并明确区分。',
						'After acquiring material, the Agent should call capture_source first. Complete captures and readable incomplete or legacy records appear here with distinct states.'
					)
			);
		} else {
			const list = section.createDiv({ cls: 'tracekeeper-observability-list' });
			for (const record of snapshot.records) {
				this.renderSourceRecord(list, record);
			}
		}
		this.renderPagination(section, snapshot);
	}

	private renderSourceRecord(container: HTMLElement, record: SourceStatusRecord): void {
		const item = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-record' });
		const header = item.createDiv({ cls: 'tracekeeper-card__header' });
		const title = header.createDiv();
		title.createEl('strong', { text: record.title || ui('未命名资料', 'Untitled source') });
		title.createEl('div', { text: record.path, cls: 'tracekeeper-observability-record__path' });
		header.createEl('span', {
			text: record.state === 'captured'
				? ui('已捕获', 'Captured')
				: record.state === 'incomplete'
					? ui('捕获证据不完整', 'Incomplete capture evidence')
					: ui('证据缺失', 'Missing evidence'),
			cls: `tracekeeper-badge ${
				record.state === 'captured'
					? 'tracekeeper-badge--success'
					: record.state === 'incomplete'
						? 'tracekeeper-badge--warning'
						: 'tracekeeper-badge--error'
			}`,
		});

		const details = item.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(details, ui('资料类型', 'Source type'), record.sourceKind || ui('未记录', 'Not recorded'));
		this.renderDetail(details, ui('捕获模式', 'Capture mode'), record.mode || ui('未记录', 'Not recorded'));
		this.renderDetail(details, ui('来源标识', 'Source ID'), record.sourceId || ui('未记录', 'Not recorded'));
		this.renderDetail(details, ui('内容哈希', 'Content hash'), record.contentHash || ui('未记录', 'Not recorded'));
		this.renderDetail(details, ui('存储路由', 'Storage route'), record.route || ui('旧版或未记录', 'Legacy or not recorded'));
		this.renderDetail(
			details,
			ui('内容分片', 'Content parts'),
			record.partCount > 0
				? ui(
					`${record.partCount} 个 · ${record.partManifest.length} 个清单项`,
					`${record.partCount} parts · ${record.partManifest.length} manifest entries`
				)
				: ui('未分片', 'Inline or not partitioned')
		);
		this.renderDetail(
			details,
			ui('关系', 'Relationships'),
			ui(
				`任务 ${record.taskPaths.length} · 提案 ${record.proposalPaths.length} · 收尾 ${record.finalNotePaths.length}`,
				`${record.taskPaths.length} tasks · ${record.proposalPaths.length} proposals · ${record.finalNotePaths.length} final notes`
			)
		);
		if (record.state === 'incomplete') {
			this.renderDetail(
				details,
				ui('缺失或无效字段', 'Missing or invalid fields'),
				record.evidenceIssues.map(sourceEvidenceIssueLabel).join(ui('、', ', '))
			);
			item.createEl('p', {
				text: ui(
					'此记录仍可读取，但不能证明捕获成功。请核对上方缺失或无效的回执字段。',
					'This record remains readable, but it cannot prove a successful capture. Check the missing or invalid receipt fields above.'
				),
				cls: 'tracekeeper-view__description',
			});
		}
		if (record.source && record.source !== record.path) {
			item.createEl('p', {
				text: `${ui('原始来源', 'Original source')}: ${trimText(record.source, 180)}`,
				cls: 'tracekeeper-view__description',
			});
		}
		if (record.partManifest.length > 0) {
			item.createEl('p', {
				text: `${ui('分片清单', 'Part manifest')}: ${trimText(record.partManifest.join(', '), 240)}`,
				cls: 'tracekeeper-view__description',
			});
		}

		const actions = item.createDiv({ cls: 'tracekeeper-action-row' });
		this.renderOpenButton(
			actions,
			record.state === 'missing'
				? ui('打开引用证据', 'Open reference evidence')
				: ui('打开资料', 'Open source'),
			record.evidencePath
		);
		this.renderRelationshipButtons(actions, ui('任务', 'Task'), record.taskPaths);
		this.renderRelationshipButtons(actions, ui('提案', 'Proposal'), record.proposalPaths);
		this.renderRelationshipButtons(actions, ui('收尾记录', 'Final note'), record.finalNotePaths);
	}

	private renderRelationshipButtons(
		container: HTMLElement,
		label: string,
		paths: readonly string[]
	): void {
		paths.slice(0, 3).forEach((path, index) => {
			this.renderOpenButton(
				container,
				paths.length > 1 ? `${label} ${index + 1}` : label,
				path
			);
		});
		if (paths.length > 3) {
			container.createEl('span', {
				text: ui(`另有 ${paths.length - 3} 条`, `${paths.length - 3} more`),
				cls: 'tracekeeper-view__description',
			});
		}
	}

	private renderOpenButton(container: HTMLElement, label: string, path: string): void {
		if (!path) {
			return;
		}
		const button = container.createEl('button', { text: label });
		button.addEventListener('click', () => {
			void this.openMarkdown(path);
		});
	}

	private renderRequests(
		container: HTMLElement,
		requests: readonly SourceRequestRecord[],
		missingRequestFolder: boolean
	): void {
		const section = container.createEl('details', { cls: 'tracekeeper-card tracekeeper-source-requests' });
		section.createEl('summary', {
			text: ui(`资料请求 (${requests.length})`, `Material requests (${requests.length})`),
		});
		const body = section.createDiv({ cls: 'tracekeeper-source-requests__body' });
		if (missingRequestFolder) {
			this.renderEmptyState(
				body,
				ui('资料请求目录尚未初始化', 'Material request folder is not initialized'),
				ui('校验知识库结构后，Agent 提交的资料请求会显示在这里。', 'Check the knowledge structure, then Agent material requests will appear here.')
			);
			return;
		}
		if (requests.length === 0) {
			this.renderEmptyState(
				body,
				ui('当前没有资料请求', 'No material requests'),
				ui('资料记录仍会独立显示在上方。', 'Source records remain visible above.')
			);
			return;
		}
		const list = body.createEl('ul', { cls: 'tracekeeper-view__list' });
		for (const request of requests) {
			this.renderRequest(list, request);
		}
	}

	private renderRequest(container: HTMLElement, request: SourceRequestRecord): void {
		const item = container.createEl('li', { cls: 'tracekeeper-view__item' });
		item.createEl('div', {
			text: `${this.plugin.formatDisplayTime(request.sortTimestamp)} • ${request.sourceKind} • ${request.status}`,
		});
		if (request.source) {
			item.createEl('div', { text: `${ui('来源', 'Source')}: ${trimText(request.source, 120)}` });
		}
		if (request.purpose) {
			item.createEl('div', { text: `${ui('用途', 'Purpose')}: ${request.purpose}` });
		}
		if (request.relatedProject) {
			item.createEl('div', { text: `${ui('关联项目', 'Related project')}: ${request.relatedProject}` });
		}
		item.createEl('small', { text: `${ui('文件', 'File')}: ${request.path}` });
		const actionRow = item.createDiv({ cls: 'tracekeeper-action-row' });
		this.renderOpenButton(actionRow, ui('打开请求', 'Open request'), request.path);
		if (this.isPendingRequest(request.status)) {
			const processButton = actionRow.createEl('button', {
				text: ui('处理资料请求', 'Process request'),
			});
			processButton.addEventListener('click', () => {
				void this.processRequest(request, processButton);
			});
		}
	}

	private async processRequest(
		request: SourceRequestRecord,
		button: HTMLButtonElement
	): Promise<void> {
		button.disabled = true;
		button.setText(ui('处理中...', 'Processing...'));
		try {
			await this.plugin.processSourceRequest(request);
			new Notice(ui('资料请求已处理。', 'Source request processed.'));
			await this.refresh();
		} catch (error) {
			console.error('tracekeeper failed to process source request', error);
			new Notice(ui('处理资料请求失败。', 'Failed to process source request.'));
		} finally {
			button.disabled = false;
			button.setText(ui('处理资料请求', 'Process request'));
		}
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value || ui('暂无', 'None') });
	}

	private renderPagination(container: HTMLElement, snapshot: SourceStatusSnapshot): void {
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

	private isPendingRequest(status: string): boolean {
		const normalized = status.toLowerCase().trim();
		return !normalized || normalized === 'pending' || normalized === 'queued' || normalized === 'todo';
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
			new Notice(ui('来源状态已刷新。', 'Source status refreshed.'));
		} catch (error) {
			console.error('tracekeeper failed to refresh source status view', error);
			button.disabled = false;
			button.setText(ui('刷新', 'Refresh'));
			new Notice(ui('刷新来源状态失败。', 'Failed to refresh source status.'));
		}
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadSourceStatusSnapshot(this.query);
		await this.render(snapshot);
	}
}
