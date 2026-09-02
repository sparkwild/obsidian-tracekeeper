import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { GraphHealthSnapshot, GraphProfileIssue } from './graph-health-model';
import { graphProfileLabel } from '../settings/settings-model';
import { ui } from '../../ui/localization';
import { reportUiFailure } from '../../ui/user-facing-error';
import { TRACEKEEPER_GRAPH_HEALTH_VIEW } from '../../ui/view-types';

const OFFICIAL_GRAPH_KNOWLEDGE_FILTER = 'path:01_knowledge -path:.parts -path:02_archive';

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
		this.renderMetricCard(metrics, ui('结构连通分量', 'Structural components'), String(snapshot.maintenanceComponentCount), `${ui('原始分量', 'Raw components')}: ${snapshot.componentCount} · ${ui('最大分量', 'Largest')}: ${snapshot.largestComponentNodeCount}`, snapshot.maintenanceComponentCount > 1 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('孤立节点', 'Isolated'), String(snapshot.isolatedNodeCount), `${ui('需要关系修复', 'Actionable')}: ${snapshot.actionableIsolatedNodeCount}`, snapshot.actionableIsolatedNodeCount > 0 ? 'warning' : 'ok');
		this.renderMetricCard(metrics, ui('只有入链', 'Only inbound'), String(snapshot.onlyInboundNodeCount), ui('保留统计；Source 叶子节点属于正常结构', 'Metric only; Source leaves are normal'), 'ok');
		this.renderMetricCard(metrics, ui('只有出链', 'Only outbound'), String(snapshot.onlyOutboundNodeCount), ui('保留统计；根入口只有出链属于正常结构', 'Metric only; root entry nodes may have only outbound links'), 'ok');
		this.renderMetricCard(metrics, ui('中心节点候选', 'Hub candidates'), String(snapshot.hubCandidateCount), ui('度数大于等于 2 的候选中心节点', 'Candidate hubs with degree >= 2'));

		this.renderProfileIssues(contentEl, snapshot);
		this.renderMaintenanceCandidates(contentEl, snapshot);
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

	private renderMaintenanceCandidates(container: HTMLElement, snapshot: GraphHealthSnapshot): void {
		const section = container.createDiv({ cls: 'tracekeeper-section' });
		section.createEl('h3', { text: ui('角色与关系维护候选', 'Role and relation maintenance candidates') });
		section.createEl('p', {
			text: ui(
				'这里只展示具体候选，不再把统计报告写成知识变更提案。角色或关系变更必须由 Agent 提交明确目标，或由用户在审核界面确认。',
				'Only concrete candidates are shown. Statistical reports are no longer written as knowledge-change proposals. Role or relation changes require an explicit Agent target or human review.'
			),
			cls: 'tracekeeper-view__description',
		});
		if (snapshot.maintenanceCandidates.length === 0) {
			section.createEl('p', { text: ui('当前没有 Wiki 角色或关系候选。', 'No Wiki role or relation candidates.'), cls: 'tracekeeper-view__description' });
			return;
		}
		const list = section.createEl('ul');
		for (const candidate of snapshot.maintenanceCandidates) {
			list.createEl('li', {
				text: `${candidate.category} · ${candidate.state} · ${candidate.paths.join(', ')} · ${candidate.reasons.join(', ')}`,
			});
		}
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
		const recommendations = snapshot.recommendations.map((text) => ({ text: this.graphRecommendationText(text) }));
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
			list.createEl('li', { text: item.text });
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
		this.renderNodeList(details, ui('可操作孤立节点', 'Actionable isolated nodes'), snapshot.actionableIsolatedNodes);
		this.renderNodeList(
			details,
			ui('未解析链接来源', 'Unresolved link sources'),
			[...new Set(snapshot.profileIssues
				.filter((issue) => issue.kind === 'graph_unresolved_wikilink' || issue.kind === 'unresolved_wikilinks')
				.flatMap((issue) => issue.paths))]
		);
		this.renderNodeList(
			details,
			ui('角色或关系候选', 'Role or relation candidates'),
			[...new Set(snapshot.maintenanceCandidates.flatMap((candidate) => candidate.paths))]
		);
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
			case 'graph_wiki_role':
				return ui('Wiki 角色待确认', 'Wiki role needs review');
			case 'graph_wiki_relation':
				return ui('Wiki 关系待修复', 'Wiki relation needs repair');
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
				return snapshot.actionableIsolatedNodeCount || issue.count;
			case 'graph_disconnected':
			case 'graph_components':
				return snapshot.maintenanceComponentCount > 1 ? snapshot.maintenanceComponentCount : issue.count;
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
			case 'graph_wiki_role':
				return ui('Wiki 角色声明需要确认后才能采用角色专属检查。', 'The Wiki role declaration needs review before role-specific checks apply.');
			case 'graph_wiki_relation':
				return ui('Wiki 的 parent 或托管关系需要修复。', 'The Wiki parent or managed relation needs repair.');
			default:
				return ui(`图谱检查返回了 ${count} 个需要关注的问题。`, `The graph check returned ${count} issue(s) requiring attention.`);
		}
	}

	private graphRecommendationText(value: string): string {
		let match = value.match(/^Fix (\d+) unresolved wikilinks/u);
		if (match) return ui(`修复 ${match[1]} 条未解析 wikilink。`, value);
		match = value.match(/^Knowledge graph has (\d+) structural components/u);
		if (match) return ui(`知识图谱包含 ${match[1]} 个需要维护的结构分量，请检查角色关系。`, value);
		match = value.match(/^(\d+) structural notes are isolated/u);
		if (match) return ui(`${match[1]} 个结构笔记没有有效关系。`, value);
		match = value.match(/^Review the declared Wiki role for (.+)\.$/u);
		if (match) return ui(`检查 Wiki 角色：${match[1]}。`, value);
		match = value.match(/^Review the managed Wiki relation for (.+)\.$/u);
		if (match) return ui(`检查 Wiki 托管关系：${match[1]}。`, value);
		return value;
	}

	private formatVaultLabel(vaultRoot: string): string {
		const segments = vaultRoot.split('/').filter(Boolean);
		return segments[segments.length - 1] || vaultRoot || ui('未知', 'Unknown');
	}
}
