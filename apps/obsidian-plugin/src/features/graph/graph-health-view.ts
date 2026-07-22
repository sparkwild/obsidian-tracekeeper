import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { GraphHealthSnapshot } from './graph-health-model';
import { graphProfileLabel } from '../settings/settings-model';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_GRAPH_HEALTH_VIEW } from '../../ui/view-types';

export class TracekeeperGraphHealthView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_GRAPH_HEALTH_VIEW;
	}

	getDisplayText() {
		return ui('知识图谱健康', 'Graph health');
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
		const snapshot = await this.plugin.loadGraphHealthSnapshot();
		await this.render(snapshot);
	}

	private async render(snapshot: GraphHealthSnapshot): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		const heading = header.createDiv();
		heading.createEl('h2', { text: ui('知识图谱健康', 'Graph Health'), cls: 'tracekeeper-view__title' });
		heading.createEl('p', {
			text: `${ui('检查策略', 'Profile')}: ${graphProfileLabel(snapshot.profile)} • ${ui('最后刷新', 'Last refreshed')}: ${this.plugin.formatDisplayTime(Date.parse(snapshot.updatedAt))}`,
			cls: 'tracekeeper-view__description',
		});

		const actions = header.createDiv({ cls: 'tracekeeper-action-row' });
		const refreshButton = actions.createEl('button', {
			text: ui('刷新', 'Refresh'),
			cls: 'mod-cta',
		});
		refreshButton.addEventListener('click', () => {
			void this.handleRefreshClick(refreshButton);
		});

		const proposalButton = actions.createEl('button', {
			text: ui('创建 Review Queue 建议', 'Create Review Queue proposal'),
		});
		proposalButton.disabled = !this.hasActionableGraphWork(snapshot);
		proposalButton.addEventListener('click', () => {
			void this.handleCreateProposalClick(snapshot, proposalButton);
		});

		if (!snapshot.ok) {
			this.renderEmptyState(
				contentEl,
				ui('无法读取图谱健康状态。', 'Graph health is unavailable.'),
				snapshot.errorMessage || ui('请确认 MCP 服务正在运行。', 'Check whether the MCP service is running.')
			);
			return;
		}

		const statusBar = contentEl.createDiv({ cls: 'tracekeeper-status-bar' });
		this.renderStatusItem(statusBar, ui('检查策略', 'Profile'), graphProfileLabel(snapshot.profile));
		this.renderStatusItem(statusBar, ui('当前仓库', 'Current repository'), this.formatVaultLabel(snapshot.vaultRoot), snapshot.vaultRoot);
		this.renderStatusItem(statusBar, ui('问题数', 'Profile issues'), String(snapshot.profileIssues.length));
		this.renderStatusItem(statusBar, ui('建议数', 'Recommendations'), String(snapshot.recommendationCount));

		const metrics = contentEl.createDiv({ cls: 'tracekeeper-metric-grid' });
		this.renderMetricCard(metrics, ui('笔记', 'Notes'), String(snapshot.noteCount), ui('参与图谱扫描的 Markdown 文件', 'Markdown notes in the graph scan'));
		this.renderMetricCard(metrics, ui('Wikilink', 'Wikilinks'), String(snapshot.wikilinkEdgeCount), `${ui('已解析', 'Resolved')}: ${snapshot.resolvedEdgeCount}`);
		this.renderMetricCard(metrics, ui('未解析链接', 'Unresolved links'), String(snapshot.unresolvedEdgeCount), ui('无法解析到目标笔记的 wikilink', 'Wikilinks that do not resolve to a note'), snapshot.unresolvedEdgeCount > 0 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('连通分量', 'Components'), String(snapshot.componentCount), `${ui('最大分量', 'Largest')}: ${snapshot.largestComponentNodeCount}`, snapshot.componentCount > 1 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('孤立节点', 'Isolated'), String(snapshot.isolatedNodeCount), ui('没有入链或出链的笔记', 'Notes with no inbound or outbound links'), snapshot.isolatedNodeCount > 0 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('只有入链', 'Only inbound'), String(snapshot.onlyInboundNodeCount), ui('可能成为信息终点', 'Potential knowledge sinks'), snapshot.onlyInboundNodeCount > 0 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('只有出链', 'Only outbound'), String(snapshot.onlyOutboundNodeCount), ui('可能成为来源入口', 'Potential source-only notes'), snapshot.onlyOutboundNodeCount > 0 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, 'Hub', String(snapshot.hubCandidateCount), ui('度数大于等于 2 的候选中心', 'Candidate hubs with degree >= 2'));

		this.renderProfileIssues(contentEl, snapshot);
		this.renderRecommendations(contentEl, snapshot);
		this.renderHubCandidates(contentEl, snapshot);
		this.renderAttentionLists(contentEl, snapshot);
	}

	private async handleRefreshClick(button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		button.setText(ui('刷新中...', 'Refreshing...'));
		try {
			await this.refresh();
			new Notice(ui('图谱健康已刷新。', 'Graph health refreshed.'));
		} catch (error) {
			console.error('tracekeeper failed to refresh graph health view', error);
			new Notice(ui('刷新图谱健康失败。', 'Failed to refresh graph health.'));
		}
	}

	private async handleCreateProposalClick(snapshot: GraphHealthSnapshot, button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		button.setText(ui('创建中...', 'Creating...'));
		try {
			const path = await this.plugin.createGraphHealthReviewProposal(snapshot);
			new Notice(path
				? ui(`已创建审核建议：${path}`, `Review proposal created: ${path}`)
				: ui('已创建审核建议。', 'Review proposal created.')
			);
			await this.refresh();
		} catch (error) {
			console.error('tracekeeper failed to create graph health proposal', error);
			new Notice(ui('创建审核建议失败。', 'Failed to create review proposal.'));
			button.disabled = false;
			button.setText(ui('创建 Review Queue 建议', 'Create Review Queue proposal'));
		}
	}

	private hasActionableGraphWork(snapshot: GraphHealthSnapshot): boolean {
		return snapshot.ok && (
			snapshot.profileIssues.length > 0 ||
			Boolean(snapshot.missingRecommendedEntry) ||
			snapshot.missingRecommendedHubCount > 0 ||
			snapshot.unresolvedEdgeCount > 0 ||
			snapshot.isolatedNodeCount > 0 ||
			snapshot.componentCount > 1
		);
	}

	private renderStatusItem(container: HTMLElement, label: string, value: string, title?: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-status-pill' });
		item.createEl('span', { text: label });
		const strong = item.createEl('strong', { text: value || ui('未知', 'Unknown') });
		if (title) {
			strong.setAttr('title', title);
		}
	}

	private renderMetricCard(container: HTMLElement, label: string, value: string, detail: string, tone: 'ok' | 'warning' = 'ok'): void {
		const card = container.createDiv({ cls: `tracekeeper-metric-card tracekeeper-metric-card--${tone}` });
		card.createEl('span', { text: label, cls: 'tracekeeper-metric-card__label' });
		card.createEl('strong', { text: value, cls: 'tracekeeper-metric-card__value' });
		card.createEl('small', { text: detail });
	}

	private renderProfileIssues(container: HTMLElement, snapshot: GraphHealthSnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card' });
		const header = card.createDiv({ cls: 'tracekeeper-card__header' });
		header.createEl('h3', { text: ui('Profile Issues', 'Profile Issues') });
		header.createEl('span', { text: graphProfileLabel(snapshot.profile), cls: 'tracekeeper-badge' });
		if (snapshot.profile === 'off') {
			card.createEl('p', {
				text: ui(
					'当前关闭图谱结构检查。指标仍可手动查看，但不会生成 profile issue。',
					'Graph structure checks are off. Metrics are still visible for manual review, but profile issues are suppressed.'
				),
				cls: 'tracekeeper-view__description',
			});
			return;
		}
		if (snapshot.profileIssues.length === 0) {
			this.renderEmptyState(
				card,
				ui('当前策略下没有图谱问题。', 'No graph issues for the current profile.'),
				ui('这只表示图谱结构检查通过，不代表内容事实已被验证。', 'This only means graph structure checks passed; it does not validate factual content.')
			);
			return;
		}
		const list = card.createDiv({ cls: 'tracekeeper-issue-list' });
		for (const issue of snapshot.profileIssues) {
			const row = list.createDiv({ cls: `tracekeeper-issue-row tracekeeper-issue-row--${issue.severity}` });
			row.createEl('span', { text: issue.severity, cls: `tracekeeper-badge tracekeeper-badge--${issue.severity}` });
			const body = row.createDiv();
			body.createEl('strong', { text: `${issue.kind} (${issue.count})` });
			body.createEl('div', { text: issue.message, cls: 'tracekeeper-view__description' });
			if (issue.paths.length > 0) {
				body.createEl('small', { text: issue.paths.slice(0, 6).join(', ') });
			}
		}
	}

	private renderRecommendations(container: HTMLElement, snapshot: GraphHealthSnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('建议', 'Recommendations') });
		if (snapshot.recommendations.length === 0) {
			this.renderEmptyState(
				card,
				ui('没有返回建议。', 'No recommendations returned.'),
				ui('可以继续使用刷新重新检查图谱。', 'Refresh to run the graph check again.')
			);
			return;
		}
		const list = card.createEl('ul', { cls: 'tracekeeper-view__list' });
		for (const item of snapshot.recommendations) {
			list.createEl('li', { text: item });
		}
	}

	private renderHubCandidates(container: HTMLElement, snapshot: GraphHealthSnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('Hub Candidates', 'Hub Candidates') });
		if (snapshot.hubCandidates.length === 0) {
			this.renderEmptyState(
				card,
				ui('还没有明显 hub 候选。', 'No strong hub candidates yet.'),
				ui('可以通过入口索引和主题 hub 增强图谱聚合能力。', 'Entry indexes and topic hubs can improve graph aggregation.')
			);
			return;
		}
		const list = card.createDiv({ cls: 'tracekeeper-graph-candidate-list' });
		for (const candidate of snapshot.hubCandidates) {
			const row = list.createDiv({ cls: 'tracekeeper-graph-candidate-row' });
			row.createEl('strong', { text: candidate.path });
			row.createEl('span', { text: `${ui('度数', 'Degree')}: ${candidate.degree}` });
			row.createEl('span', { text: `${ui('入链', 'Inbound')}: ${candidate.inbound}` });
			row.createEl('span', { text: `${ui('出链', 'Outbound')}: ${candidate.outbound}` });
		}
	}

	private renderAttentionLists(container: HTMLElement, snapshot: GraphHealthSnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('需要关注的节点', 'Nodes Needing Attention') });
		const details = card.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderNodeList(details, ui('缺失入口', 'Missing entry'), snapshot.missingRecommendedEntry ? [snapshot.missingRecommendedEntry] : []);
		this.renderNodeList(details, ui('缺失 hub', 'Missing hubs'), snapshot.missingRecommendedHubs);
		this.renderNodeList(details, ui('孤立节点', 'Isolated nodes'), snapshot.isolatedNodes);
		this.renderNodeList(details, ui('只有入链', 'Only inbound'), snapshot.onlyInboundNodes);
		this.renderNodeList(details, ui('只有出链', 'Only outbound'), snapshot.onlyOutboundNodes);
	}

	private renderNodeList(container: HTMLElement, label: string, values: string[]): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail tracekeeper-detail--description' });
		item.createEl('span', { text: label });
		if (values.length === 0) {
			item.createEl('strong', { text: ui('无', 'None') });
			return;
		}
		item.createEl('strong', { text: values.slice(0, 8).join(', ') });
		if (values.length > 8) {
			item.createEl('small', { text: ui(`另有 ${values.length - 8} 项`, `${values.length - 8} more`) });
		}
	}

	private renderEmptyState(container: HTMLElement, title: string, detail: string): void {
		const empty = container.createDiv({ cls: 'tracekeeper-empty-state' });
		empty.createEl('strong', { text: title });
		empty.createEl('p', { text: detail });
	}

	private formatVaultLabel(vaultRoot: string): string {
		const segments = vaultRoot.split('/').filter(Boolean);
		return segments[segments.length - 1] || vaultRoot || ui('未知', 'Unknown');
	}
}
