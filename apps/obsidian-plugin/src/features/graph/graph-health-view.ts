import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { GraphHealthSnapshot, GraphProfileIssue } from './graph-health-model';
import { graphProfileLabel } from '../settings/settings-model';
import { ui } from '../../ui/localization';
import { reportUiFailure } from '../../ui/user-facing-error';
import { TRACEKEEPER_GRAPH_HEALTH_VIEW } from '../../ui/view-types';

const OFFICIAL_GRAPH_KNOWLEDGE_FILTER = 'path:01_knowledge -path:.parts -path:02_archive';

interface GraphRecommendationDisplay {
	text: string;
	paths?: string[];
}

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
		this.containerEl.addClass('tracekeeper-item-view');
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
			text: ui('创建知识变更提案', 'Create knowledge change proposal'),
		});
		proposalButton.disabled = !this.hasActionableGraphWork(snapshot);
		proposalButton.addEventListener('click', () => {
			void this.handleCreateProposalClick(snapshot, proposalButton);
		});
		const copyFilter = actions.createEl('button', {
			text: ui('复制官方图谱筛选', 'Copy official Graph filter'),
		});
		copyFilter.addEventListener('click', () => {
			void navigator.clipboard.writeText(OFFICIAL_GRAPH_KNOWLEDGE_FILTER)
				.then(() => new Notice(ui(
					`已复制：${OFFICIAL_GRAPH_KNOWLEDGE_FILTER}`,
					`Copied: ${OFFICIAL_GRAPH_KNOWLEDGE_FILTER}`
				)))
				.catch((error) => {
					console.error('tracekeeper failed to copy official Graph filter', error);
					new Notice(ui(
						`复制失败，请手动输入 ${OFFICIAL_GRAPH_KNOWLEDGE_FILTER}。`,
						`Copy failed. Enter ${OFFICIAL_GRAPH_KNOWLEDGE_FILTER} manually.`
					));
				});
		});

		if (!snapshot.ok) {
			const recovery = ui(
				'请先刷新当前视图；若持续失败，请运行“重建知识索引”命令，然后检查 Obsidian 开发者控制台中的 Tracekeeper 扫描错误。',
				'First refresh this view. If the problem persists, run the Rebuild knowledge index command, then inspect Tracekeeper scan errors in the Obsidian developer console.'
			);
			this.renderEmptyState(
				contentEl,
				ui('无法读取图谱健康状态。', 'Graph health is unavailable.'),
				recovery
			);
			if (snapshot.errorMessage) {
				const technical = contentEl.createEl('details', { cls: 'tracekeeper-advanced-details' });
				technical.createEl('summary', {
					text: ui('技术信息', 'Technical details'),
					cls: 'tracekeeper-advanced-summary',
				});
				technical.createEl('p', {
					text: snapshot.errorMessage,
					cls: 'tracekeeper-view__description',
				});
			}
			return;
		}

		const statusBar = contentEl.createDiv({ cls: 'tracekeeper-status-bar' });
		this.renderStatusItem(statusBar, ui('检查策略', 'Profile'), graphProfileLabel(snapshot.profile));
		this.renderStatusItem(statusBar, ui('当前仓库', 'Current repository'), this.formatVaultLabel(snapshot.vaultRoot), snapshot.vaultRoot);
		this.renderStatusItem(statusBar, ui('问题数', 'Profile issues'), String(snapshot.profileIssues.length));
		this.renderStatusItem(statusBar, ui('建议数', 'Recommendations'), String(snapshot.recommendationCount));

		const metrics = contentEl.createDiv({ cls: 'tracekeeper-metric-grid' });
		this.renderMetricCard(metrics, ui('笔记', 'Notes'), String(snapshot.noteCount), ui('参与图谱扫描的 Markdown 文件', 'Markdown notes in the graph scan'));
		this.renderMetricCard(
			metrics,
			ui('语义关系', 'Semantic links'),
			String(snapshot.wikilinkEdgeCount),
			`${ui('已解析', 'Resolved')}: ${snapshot.resolvedEdgeCount} · ${ui('原始声明', 'Raw observations')}: ${snapshot.edgeObservationCount}`
		);
		this.renderMetricCard(
			metrics,
			ui('已忽略原始链接', 'Ignored raw links'),
			String(snapshot.ignoredEdgeObservationCount),
			ui(
				`其中未解析 ${snapshot.ignoredUnresolvedEdgeCount} 条；主要来自 Source 原文和操作记录。`,
				`${snapshot.ignoredUnresolvedEdgeCount} unresolved observations; mainly Source bodies and operational records.`
			),
			'warning'
		);
		this.renderMetricCard(metrics, ui('未解析链接', 'Unresolved links'), String(snapshot.unresolvedEdgeCount), ui('无法解析到目标笔记的 wikilink', 'Wikilinks that do not resolve to a note'), snapshot.unresolvedEdgeCount > 0 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('连通分量', 'Components'), String(snapshot.componentCount), `${ui('最大分量', 'Largest')}: ${snapshot.largestComponentNodeCount}`, snapshot.componentCount > 1 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('孤立节点', 'Isolated'), String(snapshot.isolatedNodeCount), ui('没有入链或出链的笔记', 'Notes with no inbound or outbound links'), snapshot.isolatedNodeCount > 0 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('只有入链', 'Only inbound'), String(snapshot.onlyInboundNodeCount), ui('可能成为信息终点', 'Potential knowledge sinks'), snapshot.onlyInboundNodeCount > 0 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('只有出链', 'Only outbound'), String(snapshot.onlyOutboundNodeCount), ui('可能成为来源入口', 'Potential source-only notes'), snapshot.onlyOutboundNodeCount > 0 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('中心节点候选', 'Hub candidates'), String(snapshot.hubCandidateCount), ui('度数大于等于 2 的候选中心节点', 'Candidate hubs with degree >= 2'));

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
			new Notice(reportUiFailure(error, {
				context: 'tracekeeper failed to refresh graph health view',
				fallback: { zh: '刷新图谱健康失败。', en: 'Failed to refresh graph health.' },
			}));
		}
	}

	private async handleCreateProposalClick(snapshot: GraphHealthSnapshot, button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		button.setText(ui('创建中...', 'Creating...'));
		let path: string;
		try {
			path = await this.plugin.createGraphHealthReviewProposal(snapshot);
		} catch (error) {
			new Notice(reportUiFailure(error, {
				context: 'tracekeeper failed to create graph health proposal',
				fallback: { zh: '创建知识变更提案失败。', en: 'Failed to create knowledge change proposal.' },
			}));
			button.disabled = false;
			button.setText(ui('创建知识变更提案', 'Create knowledge change proposal'));
			return;
		}
		new Notice(path
			? ui(`已创建知识变更提案：${path}`, `Knowledge change proposal created: ${path}`)
			: ui('已创建知识变更提案。', 'Knowledge change proposal created.')
		);
		try {
			await this.refresh();
		} catch (error) {
			button.setText(ui('提案已创建，请刷新', 'Proposal created; refresh view'));
			new Notice(reportUiFailure(error, {
				context: 'tracekeeper failed to refresh graph health view after creating proposal',
				fallback: {
					zh: '知识变更提案已创建，但图谱健康视图刷新失败。请手动刷新；无需重复创建提案。',
					en: 'The knowledge change proposal was created, but the Graph health view failed to refresh. Refresh it manually; do not create the proposal again.',
				},
			}));
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
		item.createSpan({ text: label });
		const strong = item.createEl('strong', { text: value || ui('未知', 'Unknown') });
		if (title) {
			strong.setAttr('title', title);
		}
	}

	private renderMetricCard(container: HTMLElement, label: string, value: string, detail: string, tone: 'ok' | 'warning' = 'ok'): void {
		const card = container.createDiv({ cls: `tracekeeper-metric-card tracekeeper-metric-card--${tone}` });
		card.createSpan({ text: label, cls: 'tracekeeper-metric-card__label' });
		card.createEl('strong', { text: value, cls: 'tracekeeper-metric-card__value' });
		card.createEl('small', { text: detail });
	}

	private renderProfileIssues(container: HTMLElement, snapshot: GraphHealthSnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card' });
		const header = card.createDiv({ cls: 'tracekeeper-card__header' });
		header.createEl('h3', { text: ui('图谱检查问题', 'Profile issues') });
		header.createSpan({ text: graphProfileLabel(snapshot.profile), cls: 'tracekeeper-badge' });
		if (snapshot.profile === 'off') {
			card.createEl('p', {
				text: ui(
					'当前已关闭图谱结构检查。指标仍可手动查看，但不会生成图谱检查问题。',
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
			const issueCount = this.graphIssueCount(issue, snapshot);
			const row = list.createDiv({ cls: `tracekeeper-issue-row tracekeeper-issue-row--${issue.severity}` });
			row.createSpan({ text: this.graphIssueSeverityLabel(issue.severity), cls: `tracekeeper-badge tracekeeper-badge--${issue.severity}` });
			const body = row.createDiv();
			body.createEl('strong', { text: `${this.graphIssueKindLabel(issue.kind)} (${issueCount})` });
			body.createDiv({ text: this.graphIssueMessage(issue, issueCount), cls: 'tracekeeper-view__description' });
			if (issue.paths.length > 0) {
				body.createEl('small', { text: issue.paths.slice(0, 6).join(', ') });
			}
			const technical = body.createEl('details', { cls: 'tracekeeper-advanced-details' });
			technical.createEl('summary', { text: ui('技术信息', 'Technical details'), cls: 'tracekeeper-advanced-summary' });
			technical.createEl('code', { text: issue.kind });
			if (issue.message) {
				technical.createEl('p', { text: issue.message, cls: 'tracekeeper-view__description' });
			}
		}
	}

	private renderRecommendations(container: HTMLElement, snapshot: GraphHealthSnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('建议', 'Recommendations') });
		const recommendations = this.graphRecommendationDisplays(snapshot);
		if (recommendations.length === 0) {
			this.renderEmptyState(
				card,
				ui('没有返回建议。', 'No recommendations returned.'),
				ui('可以继续使用刷新重新检查图谱。', 'Refresh to run the graph check again.')
			);
			return;
		}
		const list = card.createEl('ul', { cls: 'tracekeeper-view__list' });
		for (const item of recommendations) {
			const row = list.createEl('li');
			row.createDiv({ text: item.text });
			if (item.paths && item.paths.length > 0) {
				row.createEl('small', { text: item.paths.join(', ') });
			}
		}
		if (snapshot.recommendations.length > 0) {
			const technical = card.createEl('details', { cls: 'tracekeeper-advanced-details' });
			technical.createEl('summary', { text: ui('技术信息', 'Technical details'), cls: 'tracekeeper-advanced-summary' });
			const rawList = technical.createEl('ul');
			for (const item of snapshot.recommendations) {
				rawList.createEl('li', { text: item });
			}
		}
	}

	private renderHubCandidates(container: HTMLElement, snapshot: GraphHealthSnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('中心节点候选', 'Hub candidates') });
		if (snapshot.hubCandidates.length === 0) {
			this.renderEmptyState(
				card,
				ui('还没有明显的中心节点候选。', 'No strong hub candidates yet.'),
				ui('可以通过入口索引和主题中心节点增强图谱聚合能力。', 'Entry indexes and topic hubs can improve graph aggregation.')
			);
			return;
		}
		const list = card.createDiv({ cls: 'tracekeeper-graph-candidate-list' });
		for (const candidate of snapshot.hubCandidates) {
			const row = list.createDiv({ cls: 'tracekeeper-graph-candidate-row' });
			row.createEl('strong', { text: candidate.path });
			row.createSpan({ text: `${ui('度数', 'Degree')}: ${candidate.degree}` });
			row.createSpan({ text: `${ui('入链', 'Inbound')}: ${candidate.inbound}` });
			row.createSpan({ text: `${ui('出链', 'Outbound')}: ${candidate.outbound}` });
		}
	}

	private renderAttentionLists(container: HTMLElement, snapshot: GraphHealthSnapshot): void {
		const card = container.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('需要关注的节点', 'Nodes Needing Attention') });
		const details = card.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderNodeList(details, ui('缺失入口', 'Missing entry'), snapshot.missingRecommendedEntry ? [snapshot.missingRecommendedEntry] : []);
		this.renderNodeList(details, ui('缺失中心节点', 'Missing hubs'), snapshot.missingRecommendedHubs);
		this.renderNodeList(details, ui('孤立节点', 'Isolated nodes'), snapshot.isolatedNodes);
		this.renderNodeList(details, ui('只有入链', 'Only inbound'), snapshot.onlyInboundNodes);
		this.renderNodeList(details, ui('只有出链', 'Only outbound'), snapshot.onlyOutboundNodes);
	}

	private renderNodeList(container: HTMLElement, label: string, values: string[]): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail tracekeeper-detail--description' });
		item.createSpan({ text: label });
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

	private graphIssueSeverityLabel(severity: string): string {
		switch (severity) {
			case 'error': return ui('错误', 'Error');
			case 'warning': return ui('警告', 'Warning');
			default: return ui('问题', 'Issue');
		}
	}

	private graphIssueKindLabel(kind: string): string {
		switch (kind) {
			case 'graph_unresolved_wikilink':
			case 'unresolved_wikilinks':
				return ui('未解析链接', 'Unresolved wikilinks');
			case 'graph_missing_entry':
			case 'missing_graph_entry':
				return ui('缺失图谱入口', 'Missing graph entry');
			case 'graph_missing_hub':
			case 'missing_recommended_hubs':
				return ui('缺失推荐中心节点', 'Missing recommended hubs');
			case 'graph_isolated_node':
			case 'isolated_nodes':
				return ui('孤立节点', 'Isolated nodes');
			case 'graph_disconnected':
			case 'graph_components':
				return ui('图谱未连通', 'Disconnected graph');
			case 'graph_only_inbound':
			case 'only_inbound_nodes':
				return ui('只有入链的节点', 'Inbound-only nodes');
			case 'graph_only_outbound':
			case 'only_outbound_nodes':
				return ui('只有出链的节点', 'Outbound-only nodes');
			default:
				return ui('图谱问题', 'Graph issue');
		}
	}

	private graphIssueCount(issue: GraphProfileIssue, snapshot: GraphHealthSnapshot): number {
		switch (issue.kind) {
			case 'graph_unresolved_wikilink':
			case 'unresolved_wikilinks':
				return snapshot.unresolvedEdgeCount || issue.count;
			case 'graph_missing_entry':
			case 'missing_graph_entry':
				return snapshot.missingRecommendedEntry ? 1 : issue.count;
			case 'graph_missing_hub':
			case 'missing_recommended_hubs':
				return snapshot.missingRecommendedHubCount || issue.count;
			case 'graph_isolated_node':
			case 'isolated_nodes':
				return snapshot.isolatedNodeCount || issue.count;
			case 'graph_disconnected':
			case 'graph_components':
				return snapshot.componentCount > 1 ? snapshot.componentCount : issue.count;
			case 'graph_only_inbound':
			case 'only_inbound_nodes':
				return snapshot.onlyInboundNodeCount || issue.count;
			case 'graph_only_outbound':
			case 'only_outbound_nodes':
				return snapshot.onlyOutboundNodeCount || issue.count;
			default:
				return issue.count;
		}
	}

	private graphIssueMessage(issue: GraphProfileIssue, count = issue.count): string {
		switch (issue.kind) {
			case 'graph_unresolved_wikilink':
			case 'unresolved_wikilinks':
				return ui(`发现 ${count} 条无法解析的 wikilink。`, `${count} wikilink(s) could not be resolved.`);
			case 'graph_missing_entry':
			case 'missing_graph_entry':
				return ui('缺少推荐的图谱入口笔记。', 'The recommended graph entry note is missing.');
			case 'graph_missing_hub':
			case 'missing_recommended_hubs':
				return ui(`缺少 ${count} 个推荐的图谱中心节点。`, `${count} recommended graph hub note(s) are missing.`);
			case 'graph_isolated_node':
			case 'isolated_nodes':
				return ui(`有 ${count} 个笔记未连接到 wikilink 图谱。`, `${count} note(s) are isolated from the wikilink graph.`);
			case 'graph_disconnected':
			case 'graph_components':
				return ui(`图谱包含 ${count} 个彼此未连通的分量。`, `The graph has ${count} disconnected component(s).`);
			case 'graph_only_inbound':
			case 'only_inbound_nodes':
				return ui(`有 ${count} 个笔记只有入链。`, `${count} note(s) only have inbound links.`);
			case 'graph_only_outbound':
			case 'only_outbound_nodes':
				return ui(`有 ${count} 个笔记只有出链。`, `${count} note(s) only have outbound links.`);
			default:
				return ui(`图谱检查返回了 ${count} 个需要关注的问题。`, `The graph check returned ${count} issue(s) requiring attention.`);
		}
	}

	private graphRecommendationDisplays(snapshot: GraphHealthSnapshot): GraphRecommendationDisplay[] {
		const displays: GraphRecommendationDisplay[] = [];
		let knownRecommendationCount = 0;
		if (snapshot.unresolvedEdgeCount > 0) {
			displays.push({
				text: ui(
					`修复 ${snapshot.unresolvedEdgeCount} 条未解析链接，以改善图谱连通性。`,
					`Fix ${snapshot.unresolvedEdgeCount} unresolved wikilink(s) to improve graph connectivity.`
				),
			});
			knownRecommendationCount += 1;
		}
		if (snapshot.componentCount > 1) {
			displays.push({
				text: ui(
					`图谱包含 ${snapshot.componentCount} 个连通分量；可添加跨分量链接以提高可达性。`,
					`The graph has ${snapshot.componentCount} components; add cross-component links for better reachability.`
				),
			});
			knownRecommendationCount += 1;
		}
		if (snapshot.isolatedNodeCount > 0) {
			displays.push({
				text: ui(
					`为 ${snapshot.isolatedNodeCount} 个孤立笔记添加有意义的链接。`,
					`Add meaningful links for ${snapshot.isolatedNodeCount} isolated note(s).`
				),
			});
			knownRecommendationCount += 1;
		}
		if (snapshot.onlyInboundNodeCount > 0) {
			displays.push({
				text: ui(
					`检查 ${snapshot.onlyInboundNodeCount} 个只有入链的笔记，避免形成信息终点。`,
					`Review ${snapshot.onlyInboundNodeCount} inbound-only note(s) to avoid knowledge sinks.`
				),
			});
			knownRecommendationCount += 1;
		}
		if (snapshot.onlyOutboundNodeCount > 0) {
			displays.push({
				text: ui(
					`检查 ${snapshot.onlyOutboundNodeCount} 个只有出链的笔记，确认其能被其他笔记发现。`,
					`Review ${snapshot.onlyOutboundNodeCount} outbound-only note(s) and make sure other notes can discover them.`
				),
			});
			knownRecommendationCount += 1;
		}
		if (snapshot.missingRecommendedEntry) {
			displays.push({
				text: ui('创建缺失的推荐图谱入口。', 'Create the missing recommended graph entry.'),
				paths: [snapshot.missingRecommendedEntry],
			});
			knownRecommendationCount += 1;
		}
		if (snapshot.missingRecommendedHubCount > 0) {
			displays.push({
				text: ui(
					`创建 ${snapshot.missingRecommendedHubCount} 个缺失的推荐中心节点。`,
					`Create ${snapshot.missingRecommendedHubCount} missing recommended hub note(s).`
				),
				paths: snapshot.missingRecommendedHubs,
			});
			knownRecommendationCount += snapshot.missingRecommendedHubCount;
		}
		if (snapshot.componentCount === 1 && snapshot.unresolvedEdgeCount === 0 && knownRecommendationCount === 0) {
			displays.push({ text: ui('图谱已连通，链接基本都能正确解析。', 'The graph is connected and links are largely resolved.') });
			knownRecommendationCount += 1;
		}

		const otherRecommendationCount = Math.max(0, snapshot.recommendationCount - knownRecommendationCount);
		if (otherRecommendationCount > 0 || (displays.length === 0 && snapshot.recommendations.length > 0)) {
			const count = otherRecommendationCount || snapshot.recommendations.length;
			displays.push({
				text: ui(
					`图谱检查还返回了 ${count} 项其他建议，请展开技术信息查看。`,
					`The graph check returned ${count} additional recommendation(s); expand Technical details to review them.`
				),
			});
		}
		return displays;
	}

	private formatVaultLabel(vaultRoot: string): string {
		const segments = vaultRoot.split('/').filter(Boolean);
		return segments[segments.length - 1] || vaultRoot || ui('未知', 'Unknown');
	}
}
