import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { RuntimeViewStatus } from '../../main';
import type { AgentActivitySnapshot, AgentTaskRecord } from './activity-model';
import { MemoryRecallPreviewModal } from '../recall/memory-recall-preview-modal';
import { pluginDisplayName, ui } from '../../ui/localization';
import { trimText } from '../shared/markdown-record-parser';
import {
	TRACEKEEPER_ACTIVITY_VIEW,
	TRACEKEEPER_REVIEW_QUEUE_VIEW,
	TRACEKEEPER_RUNTIME_LOG_VIEW,
} from '../../ui/view-types';

export class TracekeeperActivityView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_ACTIVITY_VIEW;
	}

	getDisplayText() {
		return pluginDisplayName();
	}

	getViewData() {
		return '';
	}

	setViewData(data: string, _clear: boolean): void {
		return;
	}

	clear(): void {
		this.contentEl.empty();
	}

	async onOpen() {
		await super.onOpen();
		await this.refresh();
	}

	private async render(snapshot: AgentActivitySnapshot): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		const heading = header.createDiv();
		heading.createEl('h2', { text: ui('AI 助手活动', 'AI assistant activity'), cls: 'tracekeeper-view__title' });
		const actions = header.createDiv({ cls: 'tracekeeper-action-row' });
		const refreshButton = actions.createEl('button', {
			text: ui('刷新', 'Refresh'),
			cls: 'mod-cta',
		});
		refreshButton.addEventListener('click', () => {
			void (async () => {
				refreshButton.disabled = true;
				refreshButton.setText(ui('刷新中...', 'Refreshing...'));
				try {
					await this.refresh();
					new Notice(ui('活动记录已刷新。', 'Activity refreshed.'));
				} catch (error) {
					console.error('tracekeeper failed to refresh activity view', error);
					refreshButton.disabled = false;
					refreshButton.setText(ui('刷新', 'Refresh'));
					new Notice(ui('刷新活动记录失败。', 'Failed to refresh activity.'));
				}
			})();
		});
		if (snapshot.structureStatus.state !== 'initialized') {
			const initializeButton = actions.createEl('button', {
				text: ui('校验知识库结构', 'Check structure'),
			});
			initializeButton.addEventListener('click', () => {
				void this.plugin.openInitializeMemoryStructureModal();
			});
		}
		const statusBar = contentEl.createDiv({ cls: 'tracekeeper-status-bar' });
		this.renderStatusItem(
			statusBar,
			ui('MCP 服务', 'MCP service'),
			snapshot.runtimeStatus.label,
			this.runtimeStatusClass(snapshot.runtimeStatus)
		);
		this.renderStatusItem(statusBar, ui('当前仓库', 'Current repository'), this.formatVaultLabel(snapshot.vaultRoot));
		this.renderStatusItem(statusBar, ui('刷新时间', 'Last refreshed'), this.plugin.formatDisplayTime(Date.parse(snapshot.updatedAt)));

		this.renderMemoryLoopSection(contentEl, snapshot);

		const currentSection = contentEl.createDiv({ cls: 'tracekeeper-card' });
		currentSection.createEl('h3', { text: ui('最后一次执行的任务', 'Last task') });
		if (!snapshot.latestTask) {
			this.renderEmptyState(
				currentSection,
				ui('还没有任务记录。', 'No task records yet.'),
				ui('AI 助手执行任务后会显示在这里。', 'Tasks appear here after your AI assistant runs.')
			);
		} else {
			this.renderTaskEntry(currentSection, snapshot.latestTask, true);
		}

		const timeline = contentEl.createDiv({ cls: 'tracekeeper-card' });
		const timelineHeader = timeline.createDiv({ cls: 'tracekeeper-card__header' });
		timelineHeader.createEl('h3', { text: ui('运行日志', 'Runtime log') });
		const viewAllButton = timelineHeader.createEl('button', {
			text: ui('更多', 'More'),
		});
		viewAllButton.addEventListener('click', () => {
			void this.plugin.openPluginView(TRACEKEEPER_RUNTIME_LOG_VIEW);
		});
		const timelineItems = snapshot.timelineItems;
		if (timelineItems.length === 0) {
			this.renderEmptyState(
				timeline,
				ui('还没有运行日志。', 'No runtime logs yet.'),
				ui('AI 工具调用、配置和错误记录会显示在这里。', 'AI tool calls, config, and error records appear here.')
			);
		} else {
			const list = timeline.createDiv({ cls: 'tracekeeper-timeline' });
			for (const item of timelineItems) {
				this.plugin.renderTimelineItem(list, item);
			}
		}
	}

	private renderMemoryLoopSection(container: HTMLElement, snapshot: AgentActivitySnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card tracekeeper-memory-loop-card' });
		const header = card.createDiv({ cls: 'tracekeeper-card__header' });
		header.createEl('h3', { text: ui('记忆闭环', 'Memory loop') });
		const actions = header.createDiv({ cls: 'tracekeeper-action-row' });
		const reviewButton = actions.createEl('button', {
			text: snapshot.actionableReviewQueueItemCount > 0
				? ui(`处理审核 (${snapshot.actionableReviewQueueItemCount})`, `Review items (${snapshot.actionableReviewQueueItemCount})`)
				: ui(`查看审核列表 (${snapshot.reviewQueueItemCount})`, `Open review list (${snapshot.reviewQueueItemCount})`),
			cls: [
				'tracekeeper-review-queue-button',
				snapshot.actionableReviewQueueItemCount > 0
					? 'tracekeeper-review-queue-button--action'
					: '',
				snapshot.reviewQueueItemCount > 0 && snapshot.actionableReviewQueueItemCount === 0
					? 'tracekeeper-review-queue-button--has-items'
					: '',
			].filter(Boolean).join(' '),
		});
		reviewButton.addEventListener('click', () => {
			void this.plugin.openPluginView(TRACEKEEPER_REVIEW_QUEUE_VIEW);
		});
		const recallButton = actions.createEl('button', { text: ui('测试召回', 'Test recall') });
		recallButton.addEventListener('click', () => {
			new MemoryRecallPreviewModal(this.app, this.plugin).open();
		});

		const latestProposal = snapshot.recentProposals[0] ?? null;
		const summary = card.createDiv({ cls: 'tracekeeper-memory-loop-summary' });
		summary.createEl('span', { text: ui('待处理审核项', 'Action required') });
		summary.createEl('strong', { text: String(snapshot.actionableReviewQueueItemCount) });
		summary.createEl('p', {
			text: snapshot.actionableReviewQueueItemCount > 0
				? ui(
					`待审核 ${snapshot.pendingReviewQueueItemCount} · 需修订 ${snapshot.revisionRequestedReviewQueueItemCount} · 全部 ${snapshot.reviewQueueItemCount}`,
					`${snapshot.pendingReviewQueueItemCount} pending · ${snapshot.revisionRequestedReviewQueueItemCount} revision requested · ${snapshot.reviewQueueItemCount} total`
				)
				: snapshot.reviewQueueItemCount > 0
					? ui(`暂无待处理项 · 全部 ${snapshot.reviewQueueItemCount}`, `No action needed · ${snapshot.reviewQueueItemCount} total`)
					: ui('暂无审核项。', 'No review items.'),
		});
		const details = card.createDiv({ cls: 'tracekeeper-detail-grid tracekeeper-memory-loop-grid' });
		this.renderMemoryLoopDetail(
			details,
			ui('最近审核项', 'Latest review item'),
			latestProposal
				? `${latestProposal.proposalKind} • ${this.plugin.formatDisplayTime(latestProposal.sortTimestamp)}`
				: ui('暂无', 'None')
		);
		this.renderMemoryLoopDetail(
			details,
			ui('任务结束记录', 'Task completion record'),
			snapshot.latestTask
				? this.formatLatestCloseoutStatus(snapshot.latestTask)
				: ui('暂无任务记录', 'No task records')
		);
	}

	private renderMemoryLoopDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value || ui('暂无', 'None') });
	}

	private formatLatestCloseoutStatus(task: AgentTaskRecord): string {
		const sessionRecorded = Boolean(task.sessionNote);
		const memoryWriteCount = this.taskDurableMemoryWriteCount(task);
		const proposalCount = task.proposals.length;
		if (!sessionRecorded && memoryWriteCount === 0 && proposalCount === 0) {
			return ui('未保存结束记录', 'No completion record saved');
		}
		const parts: string[] = [];
		if (sessionRecorded) {
			parts.push(ui('已保存会话记录', 'Session saved'));
		}
		if (memoryWriteCount > 0) {
			parts.push(ui(`已保存项目记忆 ${memoryWriteCount}`, `${memoryWriteCount} project memory saved`));
		}
		if (proposalCount > 0) {
			parts.push(ui(`待确认记忆 ${proposalCount}`, `${proposalCount} memory updates pending`));
		}
		if (parts.length === 1 && sessionRecorded) {
			return ui('已保存会话记录，暂无记忆更新', 'Session saved, no memory update');
		}
		return parts.join(' · ');
	}

	private taskDurableMemoryWriteCount(task: AgentTaskRecord): number {
		return task.memoryWrites.filter((path) => path && path !== task.sessionNote).length;
	}

	private renderStatusItem(container: HTMLElement, label: string, value: string, className = ''): void {
		const item = container.createDiv({
			cls: ['tracekeeper-status-pill', className].filter(Boolean).join(' '),
		});
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}

	private runtimeStatusClass(status: RuntimeViewStatus): string {
		if (!status.enabled) {
			return 'tracekeeper-status-pill--runtime tracekeeper-status-pill--disabled';
		}
		switch (status.state) {
			case 'running':
				return 'tracekeeper-status-pill--runtime tracekeeper-status-pill--success';
			case 'starting':
				return 'tracekeeper-status-pill--runtime tracekeeper-status-pill--warning';
			case 'port_conflict':
			case 'failed':
				return 'tracekeeper-status-pill--runtime tracekeeper-status-pill--danger';
			case 'stopped':
			default:
				return 'tracekeeper-status-pill--runtime';
		}
	}

	private renderMetricCard(container: HTMLElement, label: string, value: string, detail: string): void {
		const card = container.createDiv({ cls: 'tracekeeper-metric-card' });
		card.createEl('div', { text: label, cls: 'tracekeeper-metric-card__label' });
		card.createEl('strong', { text: value, cls: 'tracekeeper-metric-card__value' });
		card.createEl('div', { text: detail, cls: 'tracekeeper-view__description' });
	}

	private formatVaultLabel(vaultRoot: string): string {
		const normalized = vaultRoot.replace(/\\/g, '/').replace(/\/+$/g, '');
		return normalized.split('/').pop() || vaultRoot || ui('未知', 'Unknown');
	}

	private renderEmptyState(container: HTMLElement, title: string, detail: string): void {
		const empty = container.createDiv({ cls: 'tracekeeper-empty-state' });
		empty.createEl('strong', { text: title });
		empty.createEl('p', { text: detail });
	}

	private renderTaskEntry(container: HTMLElement, task: AgentTaskRecord, expanded: boolean): void {
		const item = container.createDiv({ cls: 'tracekeeper-task-card tracekeeper-task-card--latest' });
		const header = item.createDiv({ cls: 'tracekeeper-task-card__header' });
		const title = header.createDiv({ cls: 'tracekeeper-task-card__title' });
		title.createEl('h4', { text: task.objective || task.taskId || ui('未命名任务', 'Untitled task') });
		const badges = header.createDiv({ cls: 'tracekeeper-badge-row tracekeeper-task-card__badges' });
		badges.createEl('span', { text: task.status || ui('未知', 'Unknown'), cls: `tracekeeper-badge ${this.taskStatusClass(task.status)}` });
		const agentLabel = this.readableAgentLabel(task.agent);
		if (agentLabel) {
			badges.createEl('span', { text: agentLabel, cls: 'tracekeeper-badge tracekeeper-badge--muted' });
		}

		const focus = item.createDiv({ cls: 'tracekeeper-task-card__focus' });
		this.renderTaskInfoItem(focus, this.taskTimeLabel(task), this.formatTaskPrimaryTime(task));
		this.renderTaskInfoItem(focus, ui('项目', 'Project'), task.relatedProject || ui('未关联', 'Not linked'));
		this.renderTaskInfoItem(focus, ui('任务记录', 'Task record'), task.taskId || ui('未知', 'Unknown'));
		if (task.contextPack) {
			this.renderTaskInfoItem(focus, ui('召回上下文', 'Recall context'), this.formatPathBasename(task.contextPack));
		}
		if (expanded) {
			const changes = item.createDiv({ cls: 'tracekeeper-task-card__changes' });
			changes.createEl('span', { text: ui('本次变化', 'Changes') });
			const chips = changes.createDiv({ cls: 'tracekeeper-task-card__chips' });
			const changeItems = this.taskChangeItems(task);
			if (changeItems.length === 0) {
				chips.createEl('span', {
					text: ui('没有产生记忆或资料变化', 'No memory or source changes'),
					cls: 'tracekeeper-task-card__change-note',
				});
			} else {
				for (const change of changeItems) {
					const chip = chips.createEl('span', { cls: 'tracekeeper-task-card__change-chip' });
					chip.createEl('strong', { text: String(change.value) });
					chip.createEl('span', { text: change.label });
				}
			}
		}

		const footer = item.createDiv({ cls: 'tracekeeper-task-card__footer' });
		const path = footer.createDiv({ cls: 'tracekeeper-task-card__path' });
		path.createEl('span', { text: ui('保存位置', 'Saved in') });
		path.createEl('code', { text: task.path || ui('未知', 'Unknown') });
		if (task.path) {
			const openButton = footer.createEl('button', { text: ui('打开记录', 'Open record') });
			openButton.addEventListener('click', () => {
				void this.openTaskRecord(task.path);
			});
		}

		const normalizedSnippet = task.snippet.trim();
		if (normalizedSnippet && normalizedSnippet !== task.objective.trim()) {
			const summary = item.createDiv({ cls: 'tracekeeper-task-card__summary' });
			summary.createEl('span', { text: ui('摘要', 'Summary') });
			summary.createEl('p', { text: trimText(normalizedSnippet, 180) });
		}
	}

	private renderTaskInfoItem(container: HTMLElement, label: string, value: string): void {
		const field = container.createDiv({ cls: 'tracekeeper-task-card__info' });
		field.createEl('span', { text: label });
		field.createEl('strong', { text: value || ui('未知', 'Unknown') });
	}

	private taskChangeItems(task: AgentTaskRecord): Array<{ label: string; value: number }> {
		return [
			{ label: ui('读取记忆', 'Memory reads'), value: task.memoryReads.length },
			{ label: ui('写入记忆', 'Memory writes'), value: this.taskDurableMemoryWriteCount(task) },
			{ label: ui('捕获资料', 'Source captures'), value: task.sourceCaptures.length },
			{ label: ui('记忆提案', 'Memory proposals'), value: task.proposals.length },
		].filter((item) => item.value > 0);
	}

	private taskTimeLabel(task: AgentTaskRecord): string {
		const normalized = task.status.toLowerCase().trim();
		if ((normalized === 'completed' || normalized === 'done' || normalized === 'success') && task.finishedAt) {
			return ui('完成时间', 'Finished');
		}
		if ((normalized === 'active' || normalized === 'running') && task.startedAt) {
			return ui('开始时间', 'Started');
		}
		return ui('执行时间', 'Run time');
	}

	private formatTaskPrimaryTime(task: AgentTaskRecord): string {
		const normalized = task.status.toLowerCase().trim();
		if ((normalized === 'completed' || normalized === 'done' || normalized === 'success') && task.finishedAt) {
			return this.formatTaskTime(task.finishedAt);
		}
		if ((normalized === 'active' || normalized === 'running') && task.startedAt) {
			return this.formatTaskTime(task.startedAt);
		}
		return this.plugin.formatDisplayTime(task.sortTimestamp);
	}

	private formatPathBasename(path: string): string {
		const normalized = path.replace(/\\/g, '/');
		return normalized.split('/').pop()?.replace(/\.md$/i, '') || path;
	}

	private readableAgentLabel(agent: string): string {
		const normalized = agent.trim();
		if (!normalized || normalized.toLowerCase() === 'unknown' || this.isOpaqueIdentifier(normalized)) {
			return '';
		}
		return trimText(normalized, 36);
	}

	private isOpaqueIdentifier(value: string): boolean {
		const compact = value.replace(/-/g, '');
		return compact.length >= 24 && /^[a-f0-9]+$/i.test(compact);
	}

	private async openTaskRecord(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(ui('没有找到任务记录文件。', 'Task record file was not found.'));
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	private formatTaskTime(value: string): string {
		if (!value) {
			return ui('未记录', 'Not recorded');
		}
		const timestamp = Date.parse(value);
		return Number.isFinite(timestamp) ? this.plugin.formatDisplayTime(timestamp) : value;
	}

	private taskStatusClass(status: string): string {
		const normalized = status.toLowerCase().trim();
		if (normalized === 'active' || normalized === 'running') {
			return 'tracekeeper-badge--warning';
		}
		if (normalized === 'completed' || normalized === 'done' || normalized === 'success') {
			return 'tracekeeper-badge--success';
		}
		if (normalized === 'failed' || normalized === 'error') {
			return 'tracekeeper-badge--error';
		}
		return 'tracekeeper-badge--muted';
	}

	private isSourceRequestPending(status: string): boolean {
		const normalized = status.toLowerCase().trim();
		return !normalized || normalized === 'pending' || normalized === 'queued' || normalized === 'todo';
	}

	private renderTaskSummary(container: HTMLElement, task: AgentTaskRecord): void {
		const compact = container.createEl('div', {
			text: `${task.taskId} • ${this.plugin.formatDisplayTime(task.sortTimestamp)} • ${task.status}`,
			cls: 'tracekeeper-view__item',
		});
		if (task.objective) {
			compact.createEl('div', { text: task.objective });
		}
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadAgentActivitySnapshot();
		await this.render(snapshot);
	}
}
