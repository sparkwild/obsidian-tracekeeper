import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_ACTIVITY_VIEW, TRACEKEEPER_RUNTIME_STATUS_VIEW } from '../../ui/view-types';
import type { AgentConnectionRecord } from '../activity/activity-model';
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
		const [connections, indexStatus] = await Promise.all([
			this.plugin.loadAgentConnectionsSnapshot(),
			this.plugin.getKnowledgeIndexViewStatus(),
		]);
		const status = connections.runtimeStatus;
		const runtime = runtimeViewModel(status, ui);

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
		this.renderAgentAuthentication(contentEl, connections.recentAgents);

		const detailGrid = contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(detailGrid, ui('MCP 服务', 'MCP service'), runtime.label);
		this.renderDetail(detailGrid, ui('连接端点', 'Connection endpoint'), status.endpoint);
		this.renderDetail(detailGrid, ui('绑定范围', 'Binding'), ui('仅本机 127.0.0.1', 'Localhost only, 127.0.0.1'));
		this.renderDetail(detailGrid, ui('生命周期', 'Lifecycle'), status.enabled
			? ui('开启后随 Obsidian 运行', 'Runs while Obsidian is open')
			: ui('由用户手动关闭', 'Turned off by user'));
		this.renderDetail(detailGrid, ui('Runtime 会话', 'Runtime sessions'), String(status.activeSessions));
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
			const logs = actions.createEl('button', { text: ui('查看 Agent 活动', 'Open Agent activity') });
			logs.addEventListener('click', () => {
				void this.plugin.openPluginView(TRACEKEEPER_ACTIVITY_VIEW);
			});
		}
		const settings = actions.createEl('button', { text: ui('打开设置', 'Open settings') });
		settings.addEventListener('click', () => {
			this.plugin.openSettingsTab();
		});
	}

	private renderAgentAuthentication(
		container: HTMLElement,
		recentAgents: AgentConnectionRecord[]
	): void {
		const latestAgent = recentAgents[0] ?? null;
		const card = container.createDiv({ cls: 'tracekeeper-card tracekeeper-agent-connection-card' });
		const header = card.createDiv({ cls: 'tracekeeper-card__header' });
		header.createEl('h3', { text: ui('Agent 认证', 'Agent authentication') });
		header.createEl('span', {
			text: latestAgent
				? ui('已观察到认证活动', 'Authenticated activity observed')
				: ui('未观察到认证活动', 'No authenticated activity observed'),
			cls: `tracekeeper-badge ${
				latestAgent
					? 'tracekeeper-badge--success'
					: 'tracekeeper-badge--muted'
			}`,
		});
		card.createEl('p', {
			text: latestAgent
				? ui(
					'本地 Agent 活动记录了通过凭据认证的调用。此处显示最近观察时间，不推断客户端当前仍在线。',
					'Local Agent activity contains credential-authenticated calls. This shows the last observed time without inferring that the client is still online.'
				)
				: ui(
					'MCP 服务状态只表示本机端点是否可用。尚无认证调用证据，因此 Tracekeeper 不会把所选或已配置的 Agent 标记为已连接。',
					'MCP service status only shows whether the local endpoint is available. Without authenticated-call evidence, Tracekeeper does not label a selected or configured Agent as connected.'
				),
			cls: 'tracekeeper-view__description',
		});

		const details = card.createDiv({ cls: 'tracekeeper-detail-grid tracekeeper-connection-detail-grid' });
		this.renderDetail(details, ui('所选 Agent', 'Selected Agent'), this.plugin.getSelectedAgentClientLabel());
		if (!latestAgent) {
			this.renderDetail(details, ui('认证状态', 'Authentication state'), ui('等待 Agent 验证', 'Waiting for Agent verification'));
			return;
		}
		this.renderDetail(details, ui('最近认证客户端', 'Latest authenticated client'), latestAgent.displayName);
		this.renderDetail(
			details,
			ui('最近观察时间', 'Last observed'),
			this.plugin.formatDisplayTime(latestAgent.sortTimestamp)
		);
		this.renderDetail(
			details,
			ui('最近操作', 'Latest action'),
			latestAgent.lastToolCall
				? this.plugin.formatToolDisplayName(latestAgent.lastToolCall)
				: ui('建立认证连接', 'Authenticated connection')
		);
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}
}
