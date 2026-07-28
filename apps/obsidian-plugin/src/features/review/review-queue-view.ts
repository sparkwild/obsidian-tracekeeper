import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import {
	getReviewProposalAttentionState,
	getReviewProposalValidity,
	type MemoryProposalRecord,
	type MemoryProposalStatus,
	type ReviewProposalAttentionState,
	type ReviewQueueItemType,
} from './review-view-model';
import {
	filterReviewQueueItems,
	isReviewQueueArchiveCandidate,
	memoryProposalStatusLabel,
	reviewInboxFilterLabel,
	type MemoryReviewQueueSnapshot,
	type ReviewInboxFilter,
	type ReviewQueueSort,
} from './review-queue-model';
import {
	ApprovedWritebackApplyModal,
	ReviewQueueConfirmModal,
	ReviewQueueEditProposalModal,
	ReviewQueueRequestRevisionModal,
} from './review-modals';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_REVIEW_QUEUE_VIEW } from '../../ui/view-types';
import { trimText } from '../shared/markdown-record-parser';

const REVIEW_PAGE_SIZE = 18;

export class TracekeeperReviewQueueView extends ItemView {
	private activeFilter: ReviewInboxFilter = 'needs_review';
	private activeSort: ReviewQueueSort = 'attention';
	private searchQuery = '';
	private pageIndex = 0;
	private selectedProposalPath = '';
	private selectionMode = false;
	private selectedProposalPaths = new Set<string>();

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_REVIEW_QUEUE_VIEW;
	}

	getDisplayText() {
		return ui('知识变更审核', 'Knowledge Change Review');
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

	private async render(snapshot: MemoryReviewQueueSnapshot): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		const heading = header.createDiv();
		heading.createEl('h2', { text: ui('知识变更审核', 'Knowledge Change Review'), cls: 'tracekeeper-view__title' });
		heading.createEl('p', {
			text: ui(
				'集中查看并决定哪些候选变更可以进入知识库。通过审核后，仍需预览并确认写入。',
				'Review proposed knowledge changes before they enter the vault. Approved changes still require a preview and explicit apply confirmation.'
			),
			cls: 'tracekeeper-view__description',
		});

		const headerActions = header.createDiv({ cls: 'tracekeeper-action-row' });
		this.renderRefreshButton(headerActions);
		if (!snapshot.missingReviewQueueFolder && snapshot.proposals.length > 0) {
			const selectionButton = headerActions.createEl('button', {
				text: this.selectionMode ? ui('退出批量操作', 'Exit batch actions') : ui('批量操作', 'Batch actions'),
				cls: this.selectionMode ? 'mod-warning' : '',
			});
			selectionButton.addEventListener('click', () => {
				this.selectionMode = !this.selectionMode;
				this.selectedProposalPaths.clear();
				void this.render(snapshot);
			});
		}

		if (snapshot.missingReviewQueueFolder) {
			this.renderEmptyState(
				contentEl,
				ui('知识变更审核尚未初始化。', 'Knowledge Change Review is not initialized yet.'),
				ui(
					'初始化知识库后，Agent 提案、图谱调整建议和结构迁移差异会显示在这里。',
					'After initializing the knowledge base, agent proposals, graph-change suggestions, and structure-migration differences will appear here.'
				)
			);
			return;
		}

		if (snapshot.proposals.length === 0) {
			this.selectionMode = false;
			this.selectedProposalPaths.clear();
			this.renderEmptyState(
				contentEl,
				ui('暂无需要审核的知识变更。', 'There are no knowledge changes to review yet.'),
				ui(
					'Agent 提案、图谱调整建议和结构迁移差异会显示在这里。',
					'Agent proposals, graph-change suggestions, and structure-migration differences will appear here.'
				)
			);
			return;
		}

		const result = filterReviewQueueItems(snapshot.proposals, {
			filter: this.activeFilter,
			search: this.searchQuery,
			sort: this.activeSort,
			pageIndex: this.pageIndex,
			pageSize: REVIEW_PAGE_SIZE,
		});
		this.pageIndex = result.page.pageIndex;
		const selected = this.resolveSelectedProposal(result.items);

		this.renderControls(contentEl, snapshot, result.counts);
		this.renderBatchActions(contentEl, snapshot.proposals);

		const inbox = contentEl.createDiv({ cls: 'tracekeeper-review-inbox' });
		const list = inbox.createDiv({ cls: 'tracekeeper-review-inbox__list' });
		this.renderList(list, result.items, selected, snapshot);
		this.renderPagination(list, snapshot, result.page);

		const detail = inbox.createDiv({ cls: 'tracekeeper-review-inbox__detail' });
		if (selected) {
			this.renderDetail(detail, selected);
		} else {
			this.renderEmptyState(
				detail,
				ui('选择一项查看详情。', 'Select an item to view details.'),
				ui('列表保持精简；完整的写回内容和操作会显示在这里。', 'The list stays compact; full writeback content and actions appear here.')
			);
		}
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadMemoryReviewQueueSnapshot();
		await this.render(snapshot);
	}

	private renderRefreshButton(container: HTMLElement): void {
		const button = container.createEl('button', { text: ui('刷新', 'Refresh') });
		button.addEventListener('click', () => {
			void (async () => {
				button.disabled = true;
				button.setText(ui('刷新中...', 'Refreshing...'));
				try {
					await this.refresh();
					new Notice(ui('知识变更审核已刷新。', 'Knowledge Change Review refreshed.'));
				} catch (error) {
					console.error('tracekeeper failed to refresh review inbox', error);
					button.disabled = false;
					button.setText(ui('刷新', 'Refresh'));
					new Notice(ui('刷新知识变更审核失败。', 'Failed to refresh Knowledge Change Review.'));
				}
			})();
		});
	}

	private renderControls(
		container: HTMLElement,
		snapshot: MemoryReviewQueueSnapshot,
		counts: Record<ReviewInboxFilter, number>
	): void {
		const controls = container.createDiv({ cls: 'tracekeeper-review-inbox__controls' });
		const filters = controls.createDiv({ cls: 'tracekeeper-review-inbox__filters' });
		for (const filter of ['needs_review', 'ready_to_apply', 'awaiting_revision', 'history', 'all'] as ReviewInboxFilter[]) {
			const button = filters.createEl('button', {
				text: `${reviewInboxFilterLabel(filter)} (${counts[filter]})`,
				cls: this.activeFilter === filter ? 'is-active' : '',
			});
			button.addEventListener('click', () => {
				this.activeFilter = filter;
				this.pageIndex = 0;
				this.selectedProposalPath = '';
				void this.render(snapshot);
			});
		}

		const queryControls = controls.createDiv({ cls: 'tracekeeper-review-inbox__query' });
		const search = queryControls.createEl('input', {
			type: 'search',
			placeholder: ui('搜索提案、目标笔记或任务', 'Search proposal, target note, or task'),
			value: this.searchQuery,
		});
		search.setAttribute('aria-label', ui('搜索变更提案', 'Search change proposals'));
		const applySearch = (): void => {
			const nextQuery = search.value.trim();
			if (nextQuery === this.searchQuery) {
				return;
			}
			this.searchQuery = nextQuery;
			this.pageIndex = 0;
			this.selectedProposalPath = '';
			void this.render(snapshot);
		};
		search.addEventListener('change', applySearch);
		search.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				applySearch();
			}
		});
		const searchButton = queryControls.createEl('button', { text: ui('搜索', 'Search') });
		searchButton.addEventListener('click', applySearch);

		const sort = queryControls.createEl('select');
		sort.setAttribute('aria-label', ui('排序变更提案', 'Sort change proposals'));
		this.appendSortOption(sort, 'attention', ui('按待处理优先', 'Attention first'));
		this.appendSortOption(sort, 'newest', ui('最新优先', 'Newest first'));
		this.appendSortOption(sort, 'oldest', ui('最早优先', 'Oldest first'));
		this.appendSortOption(sort, 'risk', ui('风险优先', 'Risk first'));
		sort.value = this.activeSort;
		sort.addEventListener('change', () => {
			this.activeSort = sort.value as ReviewQueueSort;
			this.pageIndex = 0;
			this.selectedProposalPath = '';
			void this.render(snapshot);
		});
	}

	private appendSortOption(select: HTMLSelectElement, value: ReviewQueueSort, label: string): void {
		const option = select.createEl('option', { text: label, value });
		option.value = value;
	}

	private renderBatchActions(container: HTMLElement, proposals: MemoryProposalRecord[]): void {
		if (!this.selectionMode) {
			return;
		}
		const selected = proposals.filter((proposal) => this.selectedProposalPaths.has(proposal.path));
		const pending = selected.filter((proposal) => getReviewProposalAttentionState(proposal) === 'pending_review' || getReviewProposalAttentionState(proposal) === 'incomplete');
		const archiveCandidates = selected.filter((proposal) => isReviewQueueArchiveCandidate(proposal));
		const toolbar = container.createDiv({ cls: 'tracekeeper-batch-toolbar' });
		toolbar.createEl('span', {
			text: ui(`已选择 ${selected.length} 项`, `${selected.length} items selected`),
			cls: 'tracekeeper-badge tracekeeper-badge--muted',
		});
		if (pending.length > 0) {
			const reject = toolbar.createEl('button', {
				text: ui(`不采纳所选 (${pending.length})`, `Do not accept selected (${pending.length})`),
				cls: 'mod-warning',
			});
			reject.addEventListener('click', () => {
				new ReviewQueueConfirmModal(
					this.app,
					ui('不采纳所选提案', 'Do not accept selected proposals'),
					ui(`将把 ${pending.length} 项标记为未采纳。这不会删除提案记录。`, `This marks ${pending.length} item(s) as not accepted. It does not delete proposal records.`),
					ui('确认不采纳', 'Do not accept items'),
					() => this.batchUpdate(pending, 'rejected')
				).open();
			});
		}
		if (archiveCandidates.length > 0) {
			const archive = toolbar.createEl('button', {
				text: ui(`归档处理记录 (${archiveCandidates.length})`, `Archive processed records (${archiveCandidates.length})`),
			});
			archive.addEventListener('click', () => {
				new ReviewQueueConfirmModal(
					this.app,
					ui('归档已处理提案', 'Archive processed proposals'),
					ui(`将移动 ${archiveCandidates.length} 项到 Tracekeeper 归档目录。`, `This moves ${archiveCandidates.length} item(s) to the Tracekeeper archive folder.`),
					ui('确认归档', 'Archive items'),
					() => this.batchArchive(archiveCandidates)
				).open();
			});
		}
	}

	private renderList(
		container: HTMLElement,
		proposals: MemoryProposalRecord[],
		selected: MemoryProposalRecord | null,
		snapshot: MemoryReviewQueueSnapshot
	): void {
		const listHeader = container.createDiv({ cls: 'tracekeeper-review-inbox__list-header' });
		listHeader.createEl('strong', { text: ui('变更提案', 'Change proposals') });
		listHeader.createEl('small', {
			text: ui('选择一项后查看完整内容和操作。', 'Select an item to view full content and actions.'),
		});
		if (proposals.length === 0) {
			this.renderEmptyState(
				container,
				ui('当前条件下没有变更提案。', 'No change proposals match the current conditions.'),
				ui('尝试切换筛选或清除搜索。', 'Try another filter or clear the search.')
			);
			return;
		}

		const rows = container.createDiv({ cls: 'tracekeeper-review-inbox__rows' });
		for (const proposal of proposals) {
			const row = rows.createEl('button', {
				cls: `tracekeeper-review-inbox__row${selected?.path === proposal.path ? ' is-selected' : ''}`,
			});
			row.type = 'button';
			row.addEventListener('click', () => {
				this.selectedProposalPath = proposal.path;
				void this.render(snapshot);
			});

			if (this.selectionMode) {
				const checkbox = row.createEl('input', { type: 'checkbox' });
				checkbox.checked = this.selectedProposalPaths.has(proposal.path);
				checkbox.setAttribute('aria-label', ui('选择变更提案', 'Select change proposal'));
				checkbox.addEventListener('click', (event) => event.stopPropagation());
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) {
						this.selectedProposalPaths.add(proposal.path);
					} else {
						this.selectedProposalPaths.delete(proposal.path);
					}
					void this.render(snapshot);
				});
			}

			const body = row.createDiv({ cls: 'tracekeeper-review-inbox__row-body' });
			const title = body.createDiv({ cls: 'tracekeeper-review-inbox__row-title' });
			title.createEl('strong', { text: this.proposalTitle(proposal) });
			this.renderAttentionBadge(title, proposal);
			body.createEl('p', {
				text: trimText(proposal.writebackContent || proposal.snippet || this.reviewReason(proposal), 140),
			});
			body.createEl('small', { text: this.rowMeta(proposal) });
		}
	}

	private renderPagination(
		container: HTMLElement,
		snapshot: MemoryReviewQueueSnapshot,
		page: { pageIndex: number; totalPages: number; totalItems: number; hasNext: boolean; hasPrevious: boolean }
	): void {
		if (page.totalItems <= REVIEW_PAGE_SIZE) {
			return;
		}
		const pagination = container.createDiv({ cls: 'tracekeeper-review-inbox__pagination' });
		const previous = pagination.createEl('button', { text: ui('上一页', 'Previous') });
		previous.disabled = !page.hasPrevious;
		previous.addEventListener('click', () => {
			this.pageIndex = Math.max(0, page.pageIndex - 1);
			this.selectedProposalPath = '';
			void this.render(snapshot);
		});
		pagination.createEl('span', {
			text: ui(`第 ${page.pageIndex + 1} / ${page.totalPages} 页 · ${page.totalItems} 项`, `Page ${page.pageIndex + 1} of ${page.totalPages} · ${page.totalItems} items`),
		});
		const next = pagination.createEl('button', { text: ui('下一页', 'Next') });
		next.disabled = !page.hasNext;
		next.addEventListener('click', () => {
			this.pageIndex = page.pageIndex + 1;
			this.selectedProposalPath = '';
			void this.render(snapshot);
		});
	}

	private renderDetail(container: HTMLElement, proposal: MemoryProposalRecord): void {
		container.addClass('tracekeeper-review-inbox__detail-panel');
		const header = container.createDiv({ cls: 'tracekeeper-review-inbox__detail-header' });
		const title = header.createDiv();
		title.createEl('span', { text: this.reviewQueueItemTypeLabel(proposal.classification), cls: 'tracekeeper-review-inbox__eyebrow' });
		title.createEl('h3', { text: this.proposalTitle(proposal) });
		const badges = header.createDiv({ cls: 'tracekeeper-badge-row' });
		this.renderAttentionBadge(badges, proposal);
		if (proposal.riskLevel && proposal.riskLevel !== 'unknown') {
			badges.createEl('span', {
				text: this.plugin.formatRiskLabel(proposal.riskLevel),
				cls: `tracekeeper-badge tracekeeper-badge--risk-${proposal.riskLevel.toLowerCase()}`,
			});
		}

		const status = getReviewProposalAttentionState(proposal);
		const validity = getReviewProposalValidity(proposal);
		if (status === 'incomplete') {
			const notice = container.createDiv({ cls: 'tracekeeper-review-inbox__notice tracekeeper-review-inbox__notice--warning' });
			notice.setText(this.incompleteMessage(validity));
		}

		const summary = container.createDiv({ cls: 'tracekeeper-review-inbox__summary' });
		summary.createEl('strong', { text: ui('变更理由', 'Change rationale') });
		summary.createEl('p', { text: this.reviewReason(proposal) });

		const target = container.createDiv({ cls: 'tracekeeper-review-inbox__target' });
		target.createEl('span', { text: ui('目标笔记', 'Target note') });
		target.createEl('code', { text: proposal.targetNote || ui('尚未指定，需要补全。', 'Not specified; needs completion.') });
		if (proposal.targetNote) {
			const openTarget = target.createEl('button', { text: ui('打开目标', 'Open target') });
			openTarget.addEventListener('click', () => void this.openTargetNote(proposal));
		}

		const writeback = container.createDiv({ cls: 'tracekeeper-review-inbox__writeback' });
		writeback.createEl('strong', { text: ui('拟写入内容', 'Proposed writeback') });
		writeback.createEl('pre', {
			text: proposal.writebackContent || ui('尚未提供可写入内容。', 'No writable content has been provided.'),
			cls: proposal.writebackContent ? '' : 'is-empty',
		});

		if (proposal.revisionComment) {
			const revision = container.createDiv({ cls: 'tracekeeper-review-inbox__revision' });
			revision.createEl('strong', { text: ui('修订说明', 'Revision comment') });
			revision.createEl('p', { text: proposal.revisionComment });
		}

		const actions = container.createDiv({ cls: 'tracekeeper-action-row tracekeeper-review-inbox__actions' });
		this.renderDetailActions(actions, proposal, status, validity.isComplete);

		const source = container.createEl('details', { cls: 'tracekeeper-advanced-details' });
		source.createEl('summary', { text: ui('提案来源与记录', 'Proposal source and record'), cls: 'tracekeeper-advanced-summary' });
		const sourceDetails = source.createDiv({ cls: 'tracekeeper-review-inbox__source' });
		this.renderSourceLine(sourceDetails, ui('提案记录', 'Proposal record'), proposal.path);
		this.renderSourceLine(sourceDetails, ui('提案 ID', 'Proposal ID'), proposal.proposalId || ui('未指定', 'Not specified'));
		this.renderSourceLine(sourceDetails, ui('审核状态', 'Review status'), memoryProposalStatusLabel(proposal.approvalStatus));
		this.renderSourceLine(sourceDetails, ui('创建时间', 'Created'), this.plugin.formatDisplayTime(proposal.sortTimestamp));
		if (proposal.relatedProject) {
			this.renderSourceLine(sourceDetails, ui('相关项目', 'Related project'), proposal.relatedProject);
		}
		if (proposal.taskId) {
			this.renderSourceLine(sourceDetails, ui('任务', 'Task'), proposal.taskId);
		}
		if (proposal.evidence.length > 0) {
			this.renderSourceLine(sourceDetails, ui('证据', 'Evidence'), proposal.evidence.join('\n'));
		}
		const open = sourceDetails.createEl('button', { text: ui('查看原始记录', 'View original record') });
		open.addEventListener('click', () => void this.openReviewQueueItem(proposal));
	}

	private renderDetailActions(
		container: HTMLElement,
		proposal: MemoryProposalRecord,
		status: ReviewProposalAttentionState,
		isComplete: boolean
	): void {
		if (proposal.classification !== 'memory_proposal') {
			if (status === 'pending_review') {
				this.addStatusAction(container, proposal, 'applied', ui('确认完成', 'Confirm complete'), 'tracekeeper-confirm-button', 'history');
				this.addRevisionAction(container, proposal);
				this.addStatusAction(container, proposal, 'rejected', ui('不采纳', 'Do not accept'), 'mod-warning');
			}
			return;
		}

		if (status === 'incomplete') {
			this.addEditAction(container, proposal, ui('补全信息', 'Complete information'), true);
			this.addRevisionAction(container, proposal);
			this.addStatusAction(container, proposal, 'rejected', ui('不采纳', 'Do not accept'), 'mod-warning');
			return;
		}
		if (status === 'pending_review') {
			this.addEditAction(container, proposal, ui('编辑提案', 'Edit proposal'));
			this.addRevisionAction(container, proposal);
			this.addStatusAction(container, proposal, 'rejected', ui('不采纳', 'Do not accept'), 'mod-warning');
			this.addStatusAction(container, proposal, 'approved', ui('通过审核', 'Approve'), 'mod-cta', 'ready_to_apply');
			return;
		}
		if (status === 'awaiting_revision') {
			this.addEditAction(container, proposal, ui('编辑提案', 'Edit proposal'));
			this.addRevisionAction(container, proposal);
			this.addStatusAction(container, proposal, 'pending', ui('重新审核', 'Review again'), '', 'needs_review', { clearRevision: true });
			return;
		}
		if (status === 'ready_to_apply') {
			if (!isComplete) {
				this.addStatusAction(container, proposal, 'pending', ui('重新审核并补全', 'Review again and complete'), '', 'needs_review');
				return;
			}
			const apply = container.createEl('button', { text: ui('预览并写入', 'Preview and apply'), cls: 'mod-cta' });
			apply.addEventListener('click', () => {
				new ApprovedWritebackApplyModal(this.app, this.plugin, proposal, () => {
					this.activeFilter = 'history';
					this.selectedProposalPath = '';
					void this.refresh();
				}).open();
			});
			this.addStatusAction(container, proposal, 'pending', ui('撤回通过', 'Withdraw approval'), '', 'needs_review');
			return;
		}
		if (proposal.approvalStatus === 'rejected' || proposal.approvalStatus === 'deferred') {
			this.addStatusAction(container, proposal, 'pending', ui('重新审核', 'Review again'), '', 'needs_review', { clearRevision: true });
		}
	}

	private addEditAction(container: HTMLElement, proposal: MemoryProposalRecord, label: string, primary = false): void {
		const edit = container.createEl('button', { text: label, cls: primary ? 'mod-cta' : '' });
		edit.addEventListener('click', () => {
			new ReviewQueueEditProposalModal(this.app, this.plugin, proposal, () => this.refresh()).open();
		});
	}

	private addRevisionAction(container: HTMLElement, proposal: MemoryProposalRecord): void {
		const revision = container.createEl('button', { text: ui('退回修改', 'Return for revision'), cls: 'tracekeeper-revision-button' });
		revision.addEventListener('click', () => {
			new ReviewQueueRequestRevisionModal(this.app, this.plugin, proposal, () => this.refresh()).open();
		});
	}

	private addStatusAction(
		container: HTMLElement,
		proposal: MemoryProposalRecord,
		status: MemoryProposalStatus,
		label: string,
		className = '',
		nextFilter?: ReviewInboxFilter,
		options: { clearRevision?: boolean } = {}
	): void {
		const button = container.createEl('button', { text: label, cls: className });
		button.addEventListener('click', () => {
			void (async () => {
				button.disabled = true;
				try {
					await this.plugin.updateMemoryProposalStatus(proposal, status, options);
					new Notice(ui(`已更新为：${memoryProposalStatusLabel(status)}。`, `Updated to ${memoryProposalStatusLabel(status)}.`));
					if (nextFilter) {
						this.activeFilter = nextFilter;
					}
					this.selectedProposalPath = proposal.path;
					await this.refresh();
				} catch (error) {
					console.error('tracekeeper failed to update review proposal status', error);
					button.disabled = false;
					new Notice(ui('更新审核状态失败。', 'Failed to update review status.'));
				}
			})();
		});
	}

	private async batchUpdate(proposals: MemoryProposalRecord[], status: MemoryProposalStatus): Promise<void> {
		for (const proposal of proposals) {
			await this.plugin.updateMemoryProposalStatus(proposal, status);
		}
		new Notice(ui(`已更新 ${proposals.length} 条变更提案。`, `Updated ${proposals.length} change proposals.`));
		this.selectedProposalPaths.clear();
		await this.refresh();
	}

	private async batchArchive(proposals: MemoryProposalRecord[]): Promise<void> {
		const moved = await this.plugin.archiveMemoryProposals(proposals);
		new Notice(ui(`已归档 ${moved} 条处理记录。`, `Archived ${moved} processed records.`));
		this.selectedProposalPaths.clear();
		await this.refresh();
	}

	private resolveSelectedProposal(visible: MemoryProposalRecord[]): MemoryProposalRecord | null {
		const selected = visible.find((proposal) => proposal.path === this.selectedProposalPath) || visible[0] || null;
		this.selectedProposalPath = selected?.path || '';
		return selected;
	}

	private renderAttentionBadge(container: HTMLElement, proposal: MemoryProposalRecord): void {
		const state = getReviewProposalAttentionState(proposal);
		const className = state === 'incomplete'
			? 'tracekeeper-badge tracekeeper-badge--warning'
			: state === 'ready_to_apply'
				? 'tracekeeper-badge tracekeeper-badge--success'
				: state === 'awaiting_revision'
					? 'tracekeeper-badge tracekeeper-badge--warning'
					: 'tracekeeper-badge tracekeeper-badge--muted';
		container.createEl('span', { text: this.attentionStateLabel(state), cls: className });
	}

	private attentionStateLabel(state: ReviewProposalAttentionState): string {
		switch (state) {
		case 'incomplete':
				return ui('信息不完整', 'Information incomplete');
			case 'pending_review':
				return ui('待审核', 'Needs review');
		case 'ready_to_apply':
				return ui('审核通过，待写入', 'Approved, ready to apply');
		case 'awaiting_revision':
				return ui('已退回修改', 'Returned for revision');
			case 'completed':
			default:
				return ui('已处理', 'Completed');
		}
	}

	private incompleteMessage(validity: ReturnType<typeof getReviewProposalValidity>): string {
		if (validity.missingTargetNote && validity.missingWritebackContent) {
			return ui('此提案缺少目标笔记和拟写入内容。请先补全信息，再决定是否通过审核。', 'This proposal is missing both a target note and writeback content. Complete the information before deciding whether to approve.');
		}
		return validity.missingTargetNote
			? ui('此提案缺少目标笔记。请先补全信息，再决定是否通过审核。', 'This proposal is missing a target note. Complete the information before deciding whether to approve.')
			: ui('此提案缺少拟写入内容。请先补全信息，再决定是否通过审核。', 'This proposal is missing writeback content. Complete the information before deciding whether to approve.');
	}

	private proposalTitle(proposal: MemoryProposalRecord): string {
		if (proposal.classification !== 'memory_proposal') {
			return this.reviewQueueItemTypeLabel(proposal.classification);
		}
		return this.proposalKindLabel(proposal.proposalKind);
	}

	private proposalKindLabel(kind: string): string {
		switch (kind.trim().toLowerCase().replace(/-/g, '_')) {
			case 'task_decision':
				return ui('保存任务决策', 'Save task decision');
			case 'solution_change':
				return ui('保存方案调整', 'Save solution change');
			case 'lesson_learned':
				return ui('保存经验教训', 'Save lesson learned');
			case 'user_preference':
				return ui('保存用户偏好', 'Save user preference');
			case 'project_next_action':
				return ui('保存项目下一步', 'Save project next action');
			default:
				return ui('保存记忆候选', 'Save memory candidate');
		}
	}

	private reviewQueueItemTypeLabel(classification: ReviewQueueItemType): string {
		switch (classification) {
			case 'legacy_migration_review':
				return ui('确认结构迁移差异', 'Confirm structure migration difference');
			case 'other_review_item':
				return ui('确认知识变更', 'Confirm knowledge change');
			case 'memory_proposal':
			default:
				return ui('记忆提案', 'Memory proposal');
		}
	}

	private reviewReason(proposal: MemoryProposalRecord): string {
		if (proposal.classification === 'memory_proposal') {
			return ui(
				'Agent 认为这部分任务上下文值得沉淀为本地知识，供之后在相关任务中召回。',
				'The agent marked this task context as worth preserving in local knowledge for future related work.'
			);
		}
		return trimText(proposal.snippet, 360) || ui('该变更需要你确认处理结果。', 'This change needs your confirmation.');
	}

	private rowMeta(proposal: MemoryProposalRecord): string {
		const parts = [
			proposal.targetNote || ui('未指定目标', 'No target'),
			proposal.relatedProject,
			this.plugin.formatDisplayTime(proposal.sortTimestamp),
		].filter(Boolean);
		return parts.join(' · ');
	}

	private renderSourceLine(container: HTMLElement, label: string, value: string): void {
		const line = container.createDiv();
		line.createEl('span', { text: label });
		line.createEl('code', { text: value });
	}

	private async openReviewQueueItem(proposal: MemoryProposalRecord): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(proposal.path);
		if (!(file instanceof TFile)) {
			new Notice(ui('没有找到变更提案记录。', 'Change proposal record was not found.'));
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	private async openTargetNote(proposal: MemoryProposalRecord): Promise<void> {
		const target = this.app.vault.getAbstractFileByPath(proposal.targetNote);
		if (!(target instanceof TFile)) {
			new Notice(ui('目标笔记尚不存在或不可用。', 'The target note does not exist or is unavailable.'));
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(target);
	}

	private renderEmptyState(container: HTMLElement, title: string, detail: string): void {
		const empty = container.createDiv({ cls: 'tracekeeper-empty-state' });
		empty.createEl('strong', { text: title });
		empty.createEl('p', { text: detail });
	}
}
