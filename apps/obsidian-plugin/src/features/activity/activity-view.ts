import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { AgentActivitySnapshot, AgentConnectionsSnapshot, AgentTaskRecord } from './activity-model';
import {
	buildSuccessfullyUsedAgentSummary,
	projectDurableOutputTargetPaths,
	countTaskDurableMemoryWrites,
	countTaskProposalReferences,
	countTaskSourceCaptureEvidence,
	selectActivityPrimaryAction,
	selectLatestTaskPlacement,
	selectTaskDurableOutputPresentationStatus,
	selectTaskExecutionPresentationStatus,
	taskProposalNavigationPaths,
	type ActivityPrimaryAction,
} from './activity-view-model';
import { MemoryRecallPreviewModal } from '../recall/memory-recall-preview-modal';
import { DurableOutputTargetsModal } from './durable-output-targets-modal';
import { AgentActivityDetailsModal, RuntimeLogCleanupModal } from '../runtime/runtime-log-view';
import { pluginDisplayName, ui } from '../../ui/localization';
import { trimText } from '../shared/markdown-record-parser';
import { TRACEKEEPER_SKILL_BUNDLE } from '../skill-installation/skill-bundle';
import {
	TRACEKEEPER_ACTIVITY_VIEW,
	TRACEKEEPER_REVIEW_QUEUE_VIEW,
	TRACEKEEPER_RUNTIME_STATUS_VIEW,
} from '../../ui/view-types';

type TaskChangeKind =
	| 'memory_reads'
	| 'memory_writes'
	| 'source_captures'
	| 'memory_proposals'
	| 'durable_targets';

export class TracekeeperActivityView extends ItemView {
	private advancedDiagnosticsEl: HTMLDetailsElement | null = null;

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
		this.containerEl.addClass('tracekeeper-activity-view');
		await this.refresh();
	}

	private async render(snapshot: AgentActivitySnapshot, connections: AgentConnectionsSnapshot): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');
		this.advancedDiagnosticsEl = null;

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		const heading = header.createDiv();
		heading.createEl('h2', { text: ui('AI 助手活动', 'AI assistant activity'), cls: 'tracekeeper-view__title' });
		const actions = header.createDiv({ cls: 'tracekeeper-action-row' });
		const memoryButton = actions.createEl('button', {
			text: ui('记忆', 'Memory'),
		});
		memoryButton.addEventListener('click', () => {
			void this.plugin.openMemoryInspector();
		});
		const sourceButton = actions.createEl('button', {
			text: ui('资料', 'Sources'),
		});
		sourceButton.addEventListener('click', () => {
			void this.plugin.openSourceStatus();
		});
		const refreshButton = actions.createEl('button', {
			text: ui('刷新', 'Refresh'),
		});
		const cleanupButton = actions.createEl('button', {
			text: ui('清理活动', 'Clear activity'),
		});
		cleanupButton.addEventListener('click', () => {
			new RuntimeLogCleanupModal(this.app, this.plugin, async () => {
				await this.refresh();
			}).open();
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
		this.renderAgentActivitySection(contentEl, connections);

		const primaryAction = selectActivityPrimaryAction({
			structureState: snapshot.structureStatus.state,
			runtimeStatus: snapshot.runtimeStatus,
			actionableReviewQueueItemCount: snapshot.actionableReviewQueueItemCount,
			agedWorkflowCount: snapshot.workflowDiagnostics.agedWorkflowCount,
			permissionDeniedCount: snapshot.workflowDiagnostics.permissionDeniedCount,
		});
		this.renderPrimaryAction(contentEl, snapshot, primaryAction);
		this.renderLatestTaskSection(contentEl, snapshot);
		this.renderMemoryLoopSection(contentEl, snapshot);
		this.renderSourceActivitySection(contentEl, snapshot);
		this.renderRecentEventsSection(contentEl, snapshot);
		this.renderWorkflowDiagnosticsSection(contentEl, snapshot.workflowDiagnostics);
	}

	private renderLatestTaskSection(container: HTMLElement, snapshot: AgentActivitySnapshot): void {
		const latestTask = snapshot.latestTask;
		if (!latestTask || selectLatestTaskPlacement(latestTask) !== 'standalone') {
			return;
		}
		const currentSection = container.createDiv({ cls: 'tracekeeper-card' });
		currentSection.createEl('h3', { text: ui('最近一次跟踪任务', 'Latest tracked task') });
		this.renderTaskEntry(currentSection, latestTask, true);
	}

	private renderRecentEventsSection(container: HTMLElement, snapshot: AgentActivitySnapshot): void {
		const timeline = container.createDiv({ cls: 'tracekeeper-card' });
		const timelineHeader = timeline.createDiv({ cls: 'tracekeeper-card__header' });
		timelineHeader.createEl('h3', { text: ui('最近事件', 'Recent events') });
		const viewAllButton = timelineHeader.createEl('button', {
			text: ui('查看全部', 'View all'),
		});
		viewAllButton.setText(ui('查看全部 Agent 活动', 'View all Agent activity'));
		viewAllButton.addEventListener('click', () => {
			new AgentActivityDetailsModal(this.app, this.plugin).open();
		});
		const timelineItems = snapshot.timelineItems;
		if (timelineItems.length === 0) {
			this.renderEmptyState(
				timeline,
				ui('还没有最近事件。', 'No recent events yet.'),
				ui('最近的 MCP 连接、认证拒绝和工具调用会显示在这里。', 'Recent MCP connections, authentication rejections, and tool calls appear here.')
			);
		} else {
			const list = timeline.createDiv({ cls: 'tracekeeper-timeline' });
			for (const item of timelineItems) {
				this.plugin.renderTimelineItem(list, item);
			}
		}
	}

	private renderAgentActivitySection(
		container: HTMLElement,
		connections: AgentConnectionsSnapshot
	): void {
		const summary = buildSuccessfullyUsedAgentSummary(connections.recentAgents);
		const card = container.createDiv({ cls: 'tracekeeper-card tracekeeper-agent-activity-card' });
		const header = card.createDiv({ cls: 'tracekeeper-card__header' });
		header.createEl('h3', { text: ui('最近 Agent 使用', 'Recent Agent usage') });
		const headerActions = header.createDiv({ cls: 'tracekeeper-action-row' });
		headerActions.createEl('span', {
			text: summary.observedAgentCount > 0
				? ui(`最近使用 ${summary.observedAgentCount} 个 Agent`, `${summary.observedAgentCount} recently used Agent${summary.observedAgentCount === 1 ? '' : 's'}`)
				: ui('暂无使用记录', 'No usage observed'),
			cls: 'tracekeeper-badge tracekeeper-badge--muted',
		});
		const manageButton = headerActions.createEl('button', {
			text: ui('管理 Agent 配置', 'Manage Agent configuration'),
		});
		manageButton.addEventListener('click', () => {
			this.plugin.openSettingsTab('agent-configuration');
		});
		card.createEl('p', {
			text: ui(
				'这里只显示成功调用过 Tracekeeper 工具的 Agent 及其最近活动，不展示配置或授权状态。',
				'Only Agents that successfully used a Tracekeeper tool appear here, with recent activity rather than configuration or authorization status.'
			),
			cls: 'tracekeeper-view__description',
		});
		if (summary.state === 'not_observed') {
			this.renderEmptyState(
				card,
				ui('还没有 Agent 使用记录。', 'No Agent usage records yet.'),
				ui('Agent 成功调用 Tracekeeper 工具后会显示在这里。', 'Agents appear here after successfully using a Tracekeeper tool.')
			);
			return;
		}

		const list = card.createDiv({ cls: 'tracekeeper-agent-activity-list' });
		for (const agent of summary.agentGroups) {
			const row = list.createDiv({ cls: 'tracekeeper-agent-activity-row' });
			const identity = row.createDiv({ cls: 'tracekeeper-agent-activity-row__identity' });
			identity.createEl('strong', { text: agent.displayName });
			identity.createEl('span', {
				text: ui(
					`最近活动时间：${this.plugin.formatDisplayTime(agent.sortTimestamp)}`,
					`Latest activity: ${this.plugin.formatDisplayTime(agent.sortTimestamp)}`
				),
			});
			identity.createEl('span', {
				text: ui(
					`记录到 ${agent.sessionCount} 个会话`,
					`${agent.sessionCount} recorded session${agent.sessionCount === 1 ? '' : 's'}`
				),
			});
		}
	}

	private renderPrimaryAction(
		container: HTMLElement,
		snapshot: AgentActivitySnapshot,
		action: ActivityPrimaryAction
	): void {
		if (action === 'none') {
			return;
		}

		const card = container.createDiv({ cls: 'tracekeeper-card tracekeeper-primary-action-card' });
		card.createEl('span', { text: ui('下一步', 'Next action'), cls: 'tracekeeper-primary-action-card__eyebrow' });
		const title = this.primaryActionTitle(action, snapshot);
		card.createEl('h3', { text: title });
		card.createEl('p', {
			text: this.primaryActionDetail(action, snapshot),
			cls: 'tracekeeper-view__description',
		});
		const button = card.createEl('button', { text: title, cls: 'mod-cta' });
		button.addEventListener('click', () => {
			void this.runPrimaryAction(action, snapshot, button);
		});
	}

	private primaryActionTitle(action: ActivityPrimaryAction, snapshot: AgentActivitySnapshot): string {
		switch (action) {
			case 'repair_structure':
				return ui('修复知识库结构', 'Repair knowledge structure');
			case 'recover_runtime':
				return snapshot.runtimeStatus.state === 'port_conflict'
					? ui('解决端口冲突', 'Resolve port conflict')
					: ui('恢复 MCP 服务', 'Recover MCP service');
			case 'review_changes':
				const actionableCount = this.reviewQueueCountLabel(
					snapshot.actionableReviewQueueItemCount,
					snapshot.reviewQueueCountsTruncated
				);
				return ui(
					`处理知识变更 (${actionableCount})`,
					`Review knowledge changes (${actionableCount})`
				);
			case 'inspect_diagnostics':
				return ui('检查工作流异常', 'Inspect workflow issues');
			case 'none':
			default:
				return '';
		}
	}

	private primaryActionDetail(action: ActivityPrimaryAction, snapshot: AgentActivitySnapshot): string {
		switch (action) {
			case 'repair_structure':
				return snapshot.structureStatus.detail;
			case 'recover_runtime':
				return snapshot.runtimeStatus.detail;
			case 'review_changes':
				return ui(
					'知识变更正在等待补全、审核或明确写入，请先处理最早的待办项。',
					'Knowledge changes are waiting for completion, review, or explicit writeback. Handle the oldest actionable item first.'
				);
			case 'inspect_diagnostics':
				return ui(
					'Agent 活动发现超时工作流或权限拒绝；展开高级诊断查看观察到的证据。',
					'Agent activity shows an aged workflow or permission denial. Open advanced diagnostics to inspect the observed evidence.'
				);
			case 'none':
			default:
				return '';
		}
	}

	private async runPrimaryAction(
		action: ActivityPrimaryAction,
		snapshot: AgentActivitySnapshot,
		button: HTMLButtonElement
	): Promise<void> {
		switch (action) {
			case 'repair_structure':
				this.plugin.openInitializeMemoryStructureModal();
				return;
			case 'recover_runtime':
				if (snapshot.runtimeStatus.state === 'port_conflict') {
					await this.plugin.openPluginView(TRACEKEEPER_RUNTIME_STATUS_VIEW);
					return;
				}
				button.disabled = true;
				try {
					await this.plugin.ensureMcpRuntimeRunning();
					await this.refresh();
				} catch (error) {
					console.error('tracekeeper failed to recover MCP Runtime from Activity', error);
					new Notice(error instanceof Error ? error.message : ui('MCP 服务启动失败。', 'Failed to start MCP service.'));
					button.disabled = false;
				}
				return;
			case 'review_changes':
				await this.plugin.openPluginView(TRACEKEEPER_REVIEW_QUEUE_VIEW);
				return;
			case 'inspect_diagnostics':
				if (this.advancedDiagnosticsEl) {
					this.advancedDiagnosticsEl.open = true;
					this.advancedDiagnosticsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
				}
				return;
			case 'none':
			default:
				return;
		}
	}

	private renderSourceActivitySection(container: HTMLElement, snapshot: AgentActivitySnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card' });
		const header = card.createDiv({ cls: 'tracekeeper-card__header' });
		header.createEl('h3', { text: ui('资料活动', 'Source activity') });
		const viewAllButton = header.createEl('button', { text: ui('查看资料', 'Open sources') });
		viewAllButton.addEventListener('click', () => {
			void this.plugin.openSourceStatus();
		});
		const pendingRequests = snapshot.recentSourceRequests.filter((request) =>
			this.isSourceRequestPending(request.status)
		);
		const latestCapture = snapshot.recentSourceCaptures[0] ?? null;
		if (!latestCapture && pendingRequests.length === 0) {
			this.renderEmptyState(
				card,
				ui('还没有资料活动。', 'No source activity yet.'),
				ui('Agent 保存资料或提出资料请求后会显示在这里。', 'Captured sources and material requests appear here after Agent activity.')
			);
			return;
		}
		const details = card.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderMemoryLoopDetail(
			details,
			ui('近期保存资料', 'Recent captured sources'),
			String(snapshot.recentSourceCaptures.length)
		);
		this.renderMemoryLoopDetail(
			details,
			ui('待处理资料请求', 'Pending material requests'),
			String(pendingRequests.length)
		);
		this.renderMemoryLoopDetail(
			details,
			ui('最近资料', 'Latest source'),
			latestCapture
				? `${latestCapture.title || latestCapture.source || ui('未命名资料', 'Untitled source')} · ${this.plugin.formatDisplayTime(latestCapture.sortTimestamp)}`
				: ui('暂无已保存资料', 'No captured source')
		);
	}

	private renderMemoryLoopSection(container: HTMLElement, snapshot: AgentActivitySnapshot): void {
		const actionableCount = this.reviewQueueCountLabel(
			snapshot.actionableReviewQueueItemCount,
			snapshot.reviewQueueCountsTruncated
		);
		const completedTask = snapshot.latestTask
			&& selectLatestTaskPlacement(snapshot.latestTask) === 'memory_loop'
			? snapshot.latestTask
			: null;
		const card = container.createDiv({ cls: 'tracekeeper-card tracekeeper-memory-loop-card' });
		const header = card.createDiv({ cls: 'tracekeeper-card__header' });
		header.createEl('h3', { text: ui('记忆闭环', 'Memory loop') });
		const actions = header.createDiv({ cls: 'tracekeeper-action-row' });
		const reviewButton = actions.createEl('button', {
			text: snapshot.actionableReviewQueueItemCount > 0
				? ui(`处理知识变更 (${actionableCount})`, `Review knowledge changes (${actionableCount})`)
				: ui(`查看知识变更 (${snapshot.reviewQueueItemCount})`, `Open knowledge changes (${snapshot.reviewQueueItemCount})`),
			cls: [
				'tracekeeper-review-queue-button',
				snapshot.reviewQueueItemCount > 0
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
		const memoryButton = actions.createEl('button', { text: ui('查看记忆', 'Open memory') });
		memoryButton.addEventListener('click', () => {
			void this.plugin.openMemoryInspector();
		});

		const latestProposal = snapshot.recentProposals[0] ?? null;
		const summary = card.createDiv({ cls: 'tracekeeper-memory-loop-summary' });
		summary.createEl('span', { text: ui('待处理的知识变更', 'Knowledge changes requiring action') });
		summary.createEl('strong', { text: actionableCount });
		summary.createEl('p', {
			text: snapshot.actionableReviewQueueItemCount > 0
				? ui(
					`信息不完整 ${snapshot.incompleteReviewQueueItemCount} · 待审核 ${snapshot.pendingReviewQueueItemCount} · 待写入 ${snapshot.readyToApplyReviewQueueItemCount} · 已退回修改 ${snapshot.revisionRequestedReviewQueueItemCount} · 全部 ${snapshot.reviewQueueItemCount}${snapshot.reviewQueueCountsTruncated ? ' · 子状态为有界统计' : ''}`,
					`${snapshot.incompleteReviewQueueItemCount} incomplete · ${snapshot.pendingReviewQueueItemCount} pending review · ${snapshot.readyToApplyReviewQueueItemCount} ready to apply · ${snapshot.revisionRequestedReviewQueueItemCount} returned for revision · ${snapshot.reviewQueueItemCount} total${snapshot.reviewQueueCountsTruncated ? ' · bounded subtype counts' : ''}`
				)
				: snapshot.reviewQueueItemCount > 0
					? ui(`暂无待处理项 · 已退回修改 ${snapshot.revisionRequestedReviewQueueItemCount} · 全部 ${snapshot.reviewQueueItemCount}`, `No action needed · ${snapshot.revisionRequestedReviewQueueItemCount} returned for revision · ${snapshot.reviewQueueItemCount} total`)
					: ui('暂无知识变更。', 'No knowledge changes.'),
		});
		const details = card.createDiv({ cls: 'tracekeeper-detail-grid tracekeeper-memory-loop-grid' });
		this.renderMemoryLoopDetail(
			details,
			ui('最近变更提案', 'Latest change proposal'),
			latestProposal
				? `${latestProposal.proposalKind} • ${this.plugin.formatDisplayTime(latestProposal.sortTimestamp)}`
				: ui('暂无', 'None')
		);
		if (completedTask) {
			this.renderMemoryLoopDetail(
				details,
				ui('任务结束记录', 'Task completion record'),
				this.formatLatestCloseoutStatus(completedTask)
			);
			this.renderMemoryLoopDetail(
				details,
				ui('任务执行', 'Task execution'),
				this.taskExecutionStatusLabel(completedTask)
			);
			this.renderMemoryLoopDetail(
				details,
				ui('知识持久化', 'Knowledge durable output'),
				this.taskPersistenceStatusLabel(completedTask)
			);
			card.createEl('h4', { text: ui('最近一次跟踪任务', 'Latest tracked task') });
			this.renderTaskEntry(card, completedTask, false);
		}
	}

	private reviewQueueCountLabel(count: number, truncated: boolean): string {
		return truncated && count > 0 ? `≥${count}` : String(count);
	}

	private renderWorkflowDiagnosticsSection(container: HTMLElement, diagnostics: AgentActivitySnapshot['workflowDiagnostics']): void {
		const card = container.createEl('details', {
			cls: 'tracekeeper-card tracekeeper-activity-diagnostics',
		});
		this.advancedDiagnosticsEl = card;
		card.createEl('summary', {
			text: ui('高级诊断', 'Advanced diagnostics'),
			cls: 'tracekeeper-activity-diagnostics__summary',
		});
		const body = card.createDiv({ cls: 'tracekeeper-activity-diagnostics__body' });
		body.createEl('p', {
			text: ui(
				'用于排查 Agent 工作流、权限和本地 Runtime；日常使用无需展开。',
				'Use this to investigate Agent workflows, permissions, and the local Runtime. It is not required for daily use.'
			),
			cls: 'tracekeeper-view__description',
		});

		const metrics = body.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderMetricCard(
			metrics,
			ui('活跃工作流', 'Active workflows'),
			String(diagnostics.activeWorkflowCount),
			diagnostics.agedWorkflowCount > 0
				? ui(
					`${diagnostics.agedWorkflowCount} 条工作流已超过 24 小时未结束`,
					`${diagnostics.agedWorkflowCount} workflows have remained unfinished for 24h+`
				)
				: ui('无超时工作流', 'No aged workflows (24h+)')
		);
		this.renderMetricCard(
			metrics,
			ui('Start→Recall 成功率', 'Start→Recall'),
			this.formatWorkflowRatio(diagnostics.startToRecallCount, diagnostics.successfulStartCount),
			ui('成功 Start 中到达 Recall 的比例', 'Share of successful starts that reached recall')
		);
		this.renderMetricCard(
			metrics,
			ui('Recall→Read 成功率', 'Recall→Read'),
			this.formatWorkflowRatio(diagnostics.recallToReadCount, diagnostics.successfulRecallCount),
			ui('成功 Recall 中继续读取完整笔记的比例', 'Share of successful recalls followed by read note')
		);
		this.renderMetricCard(
			metrics,
			ui('Start→Finish 成功率', 'Start→Finish'),
			this.formatWorkflowRatio(diagnostics.startToFinishCount, diagnostics.successfulStartCount),
			ui('成功 Start 中完成 tracked closeout 的比例', 'Share of successful starts with tracked closeout')
		);
		this.renderMetricCard(
			metrics,
			ui('零命中 Recall', 'Zero-match recall'),
			String(diagnostics.zeroMatchRecallCount),
			diagnostics.zeroMatchRecallCount > 0
				? ui('有些召回未命中结果', 'Some recalls returned no matches')
				: ui('无零命中召回', 'No zero-match recalls')
		);
		this.renderMetricCard(
			metrics,
			ui('权限拒绝', 'Permission denied'),
			String(diagnostics.permissionDeniedCount),
			ui('来自工具调用的失败次数', 'Tool-call failures from permission checks')
		);

		const detailSection = body.createDiv({ cls: 'tracekeeper-detail-grid tracekeeper-memory-loop-grid' });
		this.renderWorkflowDiagnosticsDetail(detailSection, diagnostics);
		this.renderMetricCard(
			detailSection,
			ui('内置 Skill', 'Bundled Skill'),
			`v${TRACEKEEPER_SKILL_BUNDLE.manifest.skill_version}`,
			ui('安装、更新与行为证据请在设置页查看', 'See Settings for install, update, and behavior evidence')
		);
		this.renderMetricCard(
			detailSection,
			ui('持续时间 P50/P95', 'Duration P50/P95'),
			diagnostics.durationP50Ms === null || diagnostics.durationP95Ms === null
				? ui('暂无', 'No data')
				: `${diagnostics.durationP50Ms}ms / ${diagnostics.durationP95Ms}ms`,
			diagnostics.durationP50Ms === null || diagnostics.durationP95Ms === null
				? ui('无可用耗时样本', 'No duration samples')
				: ui('基于最近 Agent 活动', 'From recent Agent activity')
		);

		const evalRow = body.createDiv({ cls: 'tracekeeper-action-row' });
		const evalDescription = evalRow.createDiv();
		evalDescription.createEl('strong', { text: ui('本地主动性 Eval', 'Local initiative Eval') });
		evalDescription.createEl('div', {
			text: ui(
				'仓库检出环境可运行 npm run eval:agent-initiative:test；评测不会读取真实 Vault。',
				'In a repository checkout, run npm run eval:agent-initiative:test; it does not read the real Vault.'
			),
			cls: 'tracekeeper-view__description',
		});
		const copyEval = evalRow.createEl('button', { text: ui('复制命令', 'Copy command') });
		copyEval.addEventListener('click', () => {
			void this.plugin.copyToClipboard(
				'npm run eval:agent-initiative:test',
				ui('本地 Eval 命令已复制。', 'Local Eval command copied.')
			).catch((error) => {
				console.error('tracekeeper failed to copy local Eval command', error);
				new Notice(ui('复制本地 Eval 命令失败。', 'Failed to copy the local Eval command.'));
			});
		});

		body.createEl('p', {
			text: ui(
				'仅统计真实调用 Tracekeeper 的本地 Agent 活动，不能代表漏调用率；清理活动会缩短历史。数据不会上传，这些指标只用于诊断，不用于用户绩效评分。',
				'Only locally recorded Tracekeeper Agent activity is counted, so this is not a missed-call rate. Activity cleanup shortens history. Nothing is uploaded, and these diagnostics are not user performance scoring.'
			),
			cls: 'tracekeeper-view__description',
		});
	}

	private formatWorkflowRatio(completed: number, eligible: number): string {
		if (eligible === 0) return ui('暂无', 'No data');
		return `${Math.round((completed / eligible) * 100)}% (${completed}/${eligible})`;
	}

	private renderWorkflowDiagnosticsDetail(container: HTMLElement, diagnostics: AgentActivitySnapshot['workflowDiagnostics']): void {
		const closeout = diagnostics.closeoutStatusDistribution;
		const entries = Object.entries(closeout)
			.filter(([, count]) => count > 0)
			.sort(([left], [right]) => left.localeCompare(right));
		if (entries.length > 0) {
			const detail = container.createDiv({ cls: 'tracekeeper-memory-loop-summary' });
			detail.createEl('span', { text: ui('Finish 关闭状态', 'Finish closeout status') });
			if (entries.length > 0) {
				detail.createEl('p', {
					text: entries.map(([status, count]) => `${status}: ${count}`).join(' · '),
					cls: 'tracekeeper-view__description',
				});
			}
		}

		this.renderMetricCard(
			container,
			ui('近期 principal', 'Recent principals'),
			String(diagnostics.recentPrincipals.length),
			diagnostics.recentPrincipals.length > 0
				? diagnostics.recentPrincipals.join(' · ')
				: ui('暂无', 'None')
		);
	}

	private renderMemoryLoopDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value || ui('暂无', 'None') });
	}

	private formatLatestCloseoutStatus(task: AgentTaskRecord): string {
		const executionStatus = this.taskExecutionStatusLabel(task);
		const persistenceStatus = this.taskPersistenceStatusLabel(task);
		return ui(
			`任务执行：${executionStatus} · 知识持久化：${persistenceStatus}`,
			`Task execution: ${executionStatus} · Knowledge durable output: ${persistenceStatus}`
		);
	}

	private taskDurableMemoryWriteCount(task: AgentTaskRecord): number {
		return countTaskDurableMemoryWrites(task);
	}

	private renderMetricCard(container: HTMLElement, label: string, value: string, detail: string): void {
		const card = container.createDiv({ cls: 'tracekeeper-metric-card' });
		card.createEl('div', { text: label, cls: 'tracekeeper-metric-card__label' });
		card.createEl('strong', { text: value, cls: 'tracekeeper-metric-card__value' });
		card.createEl('div', { text: detail, cls: 'tracekeeper-view__description' });
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
		const executionStatus = this.taskExecutionStatusLabel(task);
		badges.createEl('span', {
			text: ui(`任务执行：${executionStatus}`, `Task execution: ${executionStatus}`),
			cls: 'tracekeeper-badge tracekeeper-badge--muted',
		});
		const persistenceStatus = this.taskPersistenceStatusLabel(task);
		badges.createEl('span', {
			text: ui(`知识持久化：${persistenceStatus}`, `Knowledge durable output: ${persistenceStatus}`),
			cls: 'tracekeeper-badge tracekeeper-badge--muted',
		});
		const agentLabel = this.readableAgentLabel(task.agent);
		if (agentLabel) {
			badges.createEl('span', { text: agentLabel, cls: 'tracekeeper-badge tracekeeper-badge--muted' });
		}

		const focus = item.createDiv({ cls: 'tracekeeper-task-card__focus' });
		this.renderTaskInfoItem(focus, this.taskTimeLabel(task), this.formatTaskPrimaryTime(task));
		this.renderTaskInfoItem(focus, ui('项目', 'Project'), task.relatedProject || ui('未关联', 'Not linked'));
		this.renderTaskInfoItem(focus, ui('任务记录', 'Task record'), task.taskId || ui('未知', 'Unknown'));
		this.renderTaskInfoItem(
			focus,
			ui('来源证据', 'Source evidence'),
			this.formatSourceCaptureEvidenceCount(task)
		);
		const summaryDurableOutputTargetPaths = this.taskDurableOutputTargetPaths(task);
		if (summaryDurableOutputTargetPaths.length > 0) {
			this.renderTaskInfoItem(
				focus,
				ui('持久化目标', 'Durable output targets'),
				ui(
					`${summaryDurableOutputTargetPaths.length} 条 · 目标证据，不代表已写入`,
					`${summaryDurableOutputTargetPaths.length} items · target evidence, not proof of writeback`
				)
			);
		}
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
					const chip = chips.createEl('button', { cls: 'tracekeeper-task-card__change-chip' });
					chip.createEl('strong', { text: String(change.value) });
					chip.createEl('span', { text: change.label });
					chip.addEventListener('click', () => {
						void this.openTaskChange(task, change.kind);
					});
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
		if (countTaskProposalReferences(task) > 0) {
			const exactProposalFiles = this.taskProposalFiles(task);
			const proposalButton = footer.createEl('button', {
				text: exactProposalFiles.length === 1
					? ui('打开提案记录', 'Open proposal record')
					: ui('查看提案状态', 'View proposal status'),
			});
			proposalButton.addEventListener('click', () => {
				void this.openTaskChange(task, 'memory_proposals');
			});
		}
		const durableOutputTargetPaths = this.taskDurableOutputTargetPaths(task);
		if (durableOutputTargetPaths.length > 0) {
			const targetButton = footer.createEl('button', {
				text: ui('查看持久化目标', 'View durable output targets'),
			});
			targetButton.addEventListener('click', () => {
				void this.openTaskChange(task, 'durable_targets');
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

	private taskChangeItems(task: AgentTaskRecord): Array<{ kind: TaskChangeKind; label: string; value: number }> {
		const items: Array<{ kind: TaskChangeKind; label: string; value: number }> = [
			{ kind: 'memory_reads', label: ui('读取记忆', 'Memory reads'), value: task.memoryReads.length },
			{ kind: 'memory_writes', label: ui('写入记忆', 'Memory writes'), value: this.taskDurableMemoryWriteCount(task) },
			{ kind: 'source_captures', label: ui('来源证据', 'Source captures'), value: this.sourceCaptureEvidenceCount(task) },
			{ kind: 'memory_proposals', label: ui('记忆提案', 'Memory proposals'), value: countTaskProposalReferences(task) },
			{ kind: 'durable_targets', label: ui('持久化目标', 'Durable output targets'), value: this.taskDurableOutputTargetPaths(task).length },
		];
		return items.filter((item) => item.value > 0);
	}

	private taskExecutionStatusLabel(task: AgentTaskRecord): string {
		switch (selectTaskExecutionPresentationStatus(task)) {
			case 'completed':
				return ui('已完成', 'Completed');
			case 'partially_complete':
				return ui('部分完成', 'Partially complete');
			case 'blocked':
				return ui('受阻', 'Blocked');
			case 'running':
				return ui('执行中', 'Running');
			case 'in_progress':
			default:
				return ui('进行中', 'In progress');
		}
	}

	private taskPersistenceStatusLabel(task: AgentTaskRecord): string {
		const status = selectTaskDurableOutputPresentationStatus(task);
		if (status === 'applied') {
			return ui('已写入', 'Applied');
		}
		if (status === 'legacy_proposals') {
			return ui('有提案，查看当前状态', 'Proposals exist, check current state');
		}
		if (!task.durableOutputStatusAtFinish) {
			return ui('无持久化输出', 'No durable output');
		}

		switch (status) {
			case 'none':
				return ui('收尾时无持久化输出', 'No durable output at finish');
			case 'pending_review':
				return ui('收尾时待审核', 'Pending review at finish');
			case 'ready_to_apply':
				return ui('收尾时待写入', 'Ready to apply at finish');
			case 'revision_requested':
				return ui('收尾时待修订', 'Revision requested at finish');
			case 'rejected':
				return ui('收尾时已拒绝', 'Rejected at finish');
			case 'unresolved':
				return ui('收尾时状态异常', 'Status unresolved at finish');
			case 'mixed':
				return ui('收尾时混合状态', 'Mixed state at finish');
		}
	}

	private formatSourceCaptureEvidenceCount(task: AgentTaskRecord): string {
		return ui(
			`${this.sourceCaptureEvidenceCount(task)} 条 · 仅作为证据，不代表知识已写入`,
			`${this.sourceCaptureEvidenceCount(task)} items · evidence only, not applied knowledge`
		);
	}

	private sourceCaptureEvidenceCount(task: AgentTaskRecord): number {
		return countTaskSourceCaptureEvidence(task);
	}

	private async openTaskChange(task: AgentTaskRecord, kind: TaskChangeKind): Promise<void> {
		switch (kind) {
			case 'memory_reads':
				await this.plugin.openMemoryInspector({
					focusPaths: task.memoryReads,
					taskId: task.taskId,
				});
				return;
			case 'memory_writes':
				await this.plugin.openMemoryInspector({
					focusPaths: task.memoryWrites.filter((path) => path && path !== task.sessionNote),
					taskId: task.taskId,
				});
				return;
			case 'source_captures':
				await this.plugin.openSourceStatus({
					focusPaths: task.sourceCaptures,
					taskId: task.taskId,
				});
				return;
			case 'memory_proposals':
				const exactProposalFiles = this.taskProposalFiles(task);
				if (exactProposalFiles.length === 1) {
					await this.app.workspace.getLeaf(false).openFile(exactProposalFiles[0]);
					return;
				}
				await this.plugin.openPluginView(TRACEKEEPER_REVIEW_QUEUE_VIEW);
				return;
			case 'durable_targets':
				const durableOutputTargetPaths = this.taskDurableOutputTargetPaths(task);
				if (durableOutputTargetPaths.length === 1) {
					const exactFile = this.app.vault.getAbstractFileByPath(durableOutputTargetPaths[0]);
					if (exactFile instanceof TFile) {
						await this.app.workspace.getLeaf(false).openFile(exactFile);
						return;
					}
				}
				new DurableOutputTargetsModal(
					this.app,
					durableOutputTargetPaths,
					task.taskId
				).open();
				return;
		}
	}

	private taskDurableOutputTargetPaths(task: Pick<AgentTaskRecord, 'durableOutputTargetPaths'>): string[] {
		return projectDurableOutputTargetPaths(task);
	}

	private taskProposalFiles(task: AgentTaskRecord): TFile[] {
		const paths = taskProposalNavigationPaths(task);
		if (paths.length !== 1) {
			return [];
		}
		const file = this.app.vault.getAbstractFileByPath(paths[0]);
		return file instanceof TFile ? [file] : [];
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
		const [snapshot, connections] = await Promise.all([
			this.plugin.loadAgentActivitySnapshot(),
			this.plugin.loadAgentConnectionsSnapshot(),
		]);
		await this.render(snapshot, connections);
	}
}
