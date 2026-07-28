import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_RUNTIME_LOG_VIEW, TRACEKEEPER_RUNTIME_STATUS_VIEW } from '../../ui/view-types';
import { runtimeViewModel } from './runtime-view-model';

export class TracekeeperRuntimeStatusView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_RUNTIME_STATUS_VIEW;
	}

	getDisplayText() {
		return ui('连接状态', 'Connection status');
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
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');
		const status = this.plugin.getRuntimeViewStatus();
		const runtime = runtimeViewModel(status, ui);
		const indexStatus = await this.plugin.getKnowledgeIndexViewStatus();

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		header.createEl('h2', { text: ui('连接状态', 'Connection status'), cls: 'tracekeeper-view__title' });
		const headerActions = header.createDiv({ cls: 'tracekeeper-action-row' });
		const refresh = headerActions.createEl('button', { text: ui('刷新', 'Refresh') });
		refresh.addEventListener('click', () => {
			void this.refresh();
		});
		contentEl.createEl('p', {
			text: runtime.detail,
			cls: 'tracekeeper-view__description',
		});

		const detailGrid = contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(detailGrid, ui('MCP 服务', 'MCP service'), runtime.label);
		this.renderDetail(detailGrid, ui('连接端点', 'Connection endpoint'), status.endpoint);
		this.renderDetail(detailGrid, ui('绑定范围', 'Binding'), ui('仅本机 127.0.0.1', 'Localhost only, 127.0.0.1'));
		this.renderDetail(detailGrid, ui('生命周期', 'Lifecycle'), status.enabled
			? ui('开启后随 Obsidian 运行', 'Runs while Obsidian is open')
			: ui('由用户手动关闭', 'Turned off by user'));
		this.renderDetail(detailGrid, ui('活跃会话', 'Active sessions'), String(status.activeSessions));
		this.renderDetail(detailGrid, ui('知识索引', 'Knowledge index'), ui(
			indexStatus.state === 'ready' ? '就绪' : indexStatus.state === 'rebuilding' ? '重建中' : '初始化中',
			indexStatus.state === 'ready' ? 'Ready' : indexStatus.state === 'rebuilding' ? 'Rebuilding' : 'Initializing'
		));
		this.renderDetail(detailGrid, ui('已索引笔记', 'Indexed notes'), String(indexStatus.noteCount));
		this.renderDetail(detailGrid, ui('索引代次', 'Index generation'), String(indexStatus.generation));
		if (indexStatus.lastRebuild) {
			this.renderDetail(detailGrid, ui('上次索引重建', 'Last index rebuild'), this.plugin.formatDisplayTime(Date.parse(indexStatus.lastRebuild)));
		}
		if (status.startedAt) {
			this.renderDetail(detailGrid, ui('启动时间', 'Started at'), this.plugin.formatDisplayTime(Date.parse(status.startedAt)));
		}
		if (status.recovery) {
			this.renderDetail(
				detailGrid,
				ui('启动恢复', 'Startup recovery'),
				ui(
					`已恢复 ${status.recovery.recovered}，失败 ${status.recovery.failed}，跳过 ${status.recovery.skipped}`,
					`${status.recovery.recovered} recovered, ${status.recovery.failed} failed, ${status.recovery.skipped} skipped`
				)
			);
		}
		if (status.lastError) {
			this.renderDetail(detailGrid, ui('最近错误', 'Last error'), status.lastError);
		}

		const actions = contentEl.createDiv({ cls: 'tracekeeper-action-row' });
		if (runtime.primaryAction !== 'none') {
			const action = actions.createEl('button', {
				text: runtime.primaryAction === 'enable'
					? ui('开启 MCP 服务', 'Enable MCP service')
					: ui('重新启动', 'Retry start'),
				cls: 'mod-cta',
			});
			action.disabled = runtime.busy;
			action.addEventListener('click', () => {
				void (async () => {
					action.disabled = true;
					try {
						await this.plugin.ensureMcpRuntimeRunning();
						await this.refresh();
					} catch (error) {
						console.error('tracekeeper failed to recover MCP Runtime from status view', error);
						new Notice(error instanceof Error ? error.message : ui('MCP 服务启动失败。', 'Failed to start MCP service.'));
						action.disabled = false;
					}
				})();
			});
		}
		if (runtime.canOpenLogs) {
			const logs = actions.createEl('button', { text: ui('查看运行日志', 'Open runtime log') });
			logs.addEventListener('click', () => {
				void this.plugin.openPluginView(TRACEKEEPER_RUNTIME_LOG_VIEW);
			});
		}
		const settings = actions.createEl('button', { text: ui('打开设置', 'Open settings') });
		settings.addEventListener('click', () => {
			this.plugin.openSettingsTab();
		});
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}
}
