import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import {
	KNOWLEDGE_WIKI_DIR,
	startsWithPathPrefix,
} from '@tracekeeper/core';
import {
	getReviewAppliedHistory,
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
	ReviewQueueArchiveModal,
	ReviewQueueConfirmModal,
	ReviewQueueEditProposalModal,
	ReviewQueueRequestRevisionModal,
} from './review-modals';
import type {
	ReviewProposalContext,
	ReviewSourceContext,
	ReviewTargetCandidate,
	ReviewTargetContext,
} from './review-context-model';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_REVIEW_QUEUE_VIEW } from '../../ui/view-types';
import { snippetFromText, trimText } from '../shared/markdown-record-parser';

const REVIEW_PAGE_SIZE = 5;
const isProposalTransitionConflict = (error: unknown): boolean =>
	error instanceof Error && error.name === 'ProposalTransitionConflictError';

export const reviewStatusFailureReason = (error: unknown): string => {
	if (!(error instanceof Error)) {
		return ui('发生未知错误。', 'An unknown error occurred.');
	}
	const message = error.message.trim();
	if (error.name === 'ProposalTransitionValidationError') {
		if (/target is required/i.test(message)) {
			return ui('这项变更缺少目标笔记。', 'This change has no target note.');
		}
		if (/target is outside .* boundary/i.test(message)) {
			return ui('目标笔记不在允许的记忆或知识笔记范围内。', 'The target is outside the allowed memory or knowledge-note area.');
		}
		if (/target does not exist/i.test(message)) {
			return ui('目标笔记不存在，请确认是否允许新建该目标。', 'The target note does not exist; confirm whether this change can create a new target.');
		}
		if (/target already exists/i.test(message)) {
			return ui('目标笔记已存在，但这项变更配置为新建写回，无法追加到现有目标。', 'The target note already exists, but this change is configured to create a new writeback target.');
		}
		if (/writeback content is required/i.test(message)) {
			return ui('这项变更缺少拟写入内容。', 'This change has no writeback content.');
		}
		if (/writeback effect/i.test(message)) {
			return ui('这项变更使用了不受支持的写入方式，请退回修改。', 'This change uses an unsupported writeback mode. Return it for revision.');
		}
		if (/frontmatter is required|frontmatter is invalid/i.test(message)) {
			return ui('这项变更的必要信息缺失或格式无效。', 'Required information for this change is missing or invalid.');
		}
		if (/content hash/i.test(message)) {
			return ui('无法确认当前变更内容，请刷新后重试。', 'The current change could not be verified. Refresh and try again.');
		}
		return ui('这项变更未通过审核校验。', 'This change did not pass review validation.');
	}
	if (error.name === 'ProposalTransitionStateError') {
		if (/archived proposals cannot be changed/i.test(message)) {
			return ui('这项变更已归档，不能再修改审核状态。', 'This change is archived and its review status cannot be changed.');
		}
		return ui('当前变更状态不允许执行此操作，请刷新后确认最新状态。', 'The current change state does not allow this action. Refresh to confirm its latest state.');
	}
	return ui('发生意外错误，请查看开发者控制台中的详细记录。', 'An unexpected error occurred. Check the developer console for details.');
};

export const reviewStatusFailureMessage = (error: unknown): string => {
	const reason = reviewStatusFailureReason(error);
	return ui(`更新审核状态失败：${reason}`, `Failed to update review status: ${reason}`);
};

export class TracekeeperReviewQueueView extends ItemView {
	private activeFilter: ReviewInboxFilter = 'needs_completion';
	private activeSort: ReviewQueueSort = 'attention';
	private filterExplicitlySelected = false;
	private searchQuery = '';
	private pageIndex = 0;
	private windowOffset = 0;
	private selectedProposalPath = '';
	private showingDetail = false;
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
		this.containerEl.addClass('tracekeeper-item-view');
		await this.refresh();
	}

	private async render(snapshot: MemoryReviewQueueSnapshot): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		const heading = header.createDiv();
		heading.createEl('p', {
			text: ui(
				'集中查看并决定哪些候选变更可以进入知识库。通过审核后，仍需预览并确认写入。',
				'Review proposed knowledge changes before they enter the vault. Approved changes still require a preview and explicit apply confirmation.'
			),
			cls: 'tracekeeper-view__description',
		});

		const headerActions = header.createDiv({ cls: 'tracekeeper-action-row' });
		this.renderRefreshButton(headerActions);
		if (!this.showingDetail && !snapshot.missingReviewQueueFolder && snapshot.proposals.length > 0) {
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
					'初始化知识库后，Agent 建议、图谱调整和结构迁移差异会显示在这里。',
					'After initializing the knowledge base, agent suggestions, graph changes, and structure-migration differences will appear here.'
				)
			);
			return;
		}

		if (snapshot.proposals.length === 0) {
			this.showingDetail = false;
			this.selectedProposalPath = '';
			this.selectionMode = false;
			this.selectedProposalPaths.clear();
			this.renderEmptyState(
				contentEl,
				ui('暂无需要审核的知识变更。', 'There are no knowledge changes to review yet.'),
				ui(
					'Agent 建议、图谱调整和结构迁移差异会显示在这里。',
					'Agent suggestions, graph changes, and structure-migration differences will appear here.'
				)
			);
			return;
		}

		if (snapshot.isTruncated) {
			const warning = contentEl.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-warning' });
			warning.createEl('strong', {
				text: ui('审核队列已启用有界读取', 'Review queue uses bounded reads'),
			});
			warning.createEl('p', {
				text: ui(
					`当前显示第 ${snapshot.windowOffset + 1}–${Math.min(snapshot.windowOffset + snapshot.windowLimit, snapshot.totalProposalCount)} 条，共 ${snapshot.totalProposalCount} 条；待处理项优先。只有切换批次时才读取下一批正文。`,
					`Showing ${snapshot.windowOffset + 1}–${Math.min(snapshot.windowOffset + snapshot.windowLimit, snapshot.totalProposalCount)} of ${snapshot.totalProposalCount}, with attention items first. The next body batch is read only when requested.`
				),
			});
			const actions = warning.createDiv({ cls: 'tracekeeper-action-row' });
			const previous = actions.createEl('button', { text: ui('上一批', 'Previous batch') });
			previous.disabled = snapshot.windowOffset === 0;
			previous.addEventListener('click', () => {
				this.windowOffset = Math.max(0, snapshot.windowOffset - snapshot.windowLimit);
				this.pageIndex = 0;
				void this.refresh();
			});
			const next = actions.createEl('button', { text: ui('下一批', 'Next batch') });
			next.disabled = snapshot.windowOffset + snapshot.windowLimit >= snapshot.totalProposalCount;
			next.addEventListener('click', () => {
				this.windowOffset = snapshot.windowOffset + snapshot.windowLimit;
				this.pageIndex = 0;
				void this.refresh();
			});
		}

		let result = filterReviewQueueItems(snapshot.proposals, {
			filter: this.activeFilter,
			search: this.searchQuery,
			sort: this.activeSort,
			pageIndex: this.pageIndex,
			pageSize: REVIEW_PAGE_SIZE,
		}, snapshot.contexts);
		if (result.totalItems === 0 && !this.searchQuery && !this.filterExplicitlySelected) {
			const fallback = ([
				'needs_completion',
				'needs_review',
				'ready_to_apply',
				'awaiting_revision',
				'history',
			] as ReviewInboxFilter[]).find((filter) => result.counts[filter] > 0);
			if (fallback && fallback !== this.activeFilter) {
				this.activeFilter = fallback;
				result = filterReviewQueueItems(snapshot.proposals, {
					filter: this.activeFilter,
					search: this.searchQuery,
					sort: this.activeSort,
					pageIndex: 0,
					pageSize: REVIEW_PAGE_SIZE,
				}, snapshot.contexts);
			}
		}
		this.pageIndex = result.page.pageIndex;
		const selected = this.resolveSelectedProposal(snapshot.proposals);

		if (this.showingDetail && selected) {
			const inbox = contentEl.createDiv({ cls: 'tracekeeper-review-inbox is-detail' });
			const detail = inbox.createDiv({ cls: 'tracekeeper-review-inbox__detail' });
			this.renderDetailNavigation(detail, snapshot, selected);
			this.renderDetail(detail, selected, snapshot.contexts[selected.path]);
			return;
		}

		this.showingDetail = false;
		this.renderControls(contentEl, snapshot, result.counts);
		this.renderBatchActions(contentEl, snapshot.proposals);

		const inbox = contentEl.createDiv({ cls: 'tracekeeper-review-inbox' });
		const list = inbox.createDiv({ cls: 'tracekeeper-review-inbox__list' });
		const selectedOnPage = result.items.find((proposal) => proposal.path === selected?.path) || null;
		this.renderList(list, result.items, selectedOnPage, snapshot, result.totalItems);
		this.renderPagination(list, snapshot, result.page);
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadMemoryReviewQueueSnapshot(this.windowOffset);
		this.windowOffset = snapshot.windowOffset;
		await this.render(snapshot);
	}

	private async refreshSelectedProposal(proposalPath: string): Promise<void> {
		const snapshot = await this.plugin.loadMemoryReviewQueueSnapshot(this.windowOffset);
		this.windowOffset = snapshot.windowOffset;
		const proposal = snapshot.proposals.find((candidate) => candidate.path === proposalPath);
		if (!proposal) {
			this.selectedProposalPath = '';
			this.showingDetail = false;
			await this.render(snapshot);
			return;
		}
		const context = snapshot.contexts[proposal.path];
		const state = getReviewProposalAttentionState(
			proposal,
			context ? { exists: context.target.exists } : {}
		);
		this.activeFilter = this.attentionFilter(state);
		this.pageIndex = 0;
		this.selectedProposalPath = proposal.path;
		this.showingDetail = true;
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
		for (const filter of ['needs_completion', 'needs_review', 'ready_to_apply', 'awaiting_revision', 'history', 'all'] as ReviewInboxFilter[]) {
			const button = filters.createEl('button', {
				text: `${reviewInboxFilterLabel(filter)} (${counts[filter]})`,
				cls: this.activeFilter === filter ? 'is-active' : '',
			});
			button.addEventListener('click', () => {
				this.activeFilter = filter;
				this.filterExplicitlySelected = true;
				this.pageIndex = 0;
				this.selectedProposalPath = '';
				this.showingDetail = false;
				void this.render(snapshot);
			});
		}

		const queryControls = controls.createDiv({ cls: 'tracekeeper-review-inbox__query' });
		const search = queryControls.createEl('input', {
			type: 'search',
			placeholder: ui('搜索知识变更、目标笔记或任务', 'Search knowledge changes, target notes, or tasks'),
			value: this.searchQuery,
		});
		search.setAttribute('aria-label', ui('搜索知识变更', 'Search knowledge changes'));
		const applySearch = (): void => {
			const nextQuery = search.value.trim();
			if (nextQuery === this.searchQuery) {
				return;
			}
			this.searchQuery = nextQuery;
			this.pageIndex = 0;
			this.selectedProposalPath = '';
			this.showingDetail = false;
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
		sort.setAttribute('aria-label', ui('排序知识变更', 'Sort knowledge changes'));
		this.appendSortOption(sort, 'attention', ui('按待处理优先', 'Attention first'));
		this.appendSortOption(sort, 'newest', ui('最新优先', 'Newest first'));
		this.appendSortOption(sort, 'oldest', ui('最早优先', 'Oldest first'));
		this.appendSortOption(sort, 'risk', ui('风险优先', 'Risk first'));
		sort.value = this.activeSort;
		sort.addEventListener('change', () => {
			this.activeSort = sort.value as ReviewQueueSort;
			this.pageIndex = 0;
			this.selectedProposalPath = '';
			this.showingDetail = false;
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
					ui('不采纳所选变更', 'Do not accept selected changes'),
					ui(`将把 ${pending.length} 项标记为未采纳。这不会删除原始记录。`, `This marks ${pending.length} item(s) as not accepted. It does not delete source records.`),
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
				new ReviewQueueArchiveModal(
					this.app,
					this.plugin,
					archiveCandidates,
					(receipt) => this.afterBatchArchive(receipt.moved.length)
				).open();
			});
		}
	}

	private renderList(
		container: HTMLElement,
		proposals: MemoryProposalRecord[],
		selected: MemoryProposalRecord | null,
		snapshot: MemoryReviewQueueSnapshot,
		totalItems: number
	): void {
		const listHeader = container.createDiv({ cls: 'tracekeeper-review-inbox__list-header' });
		const listHeading = listHeader.createDiv({ cls: 'tracekeeper-review-inbox__list-heading' });
		listHeading.createEl('strong', { text: ui('审核列表', 'Review list') });
		listHeading.createEl('span', {
			text: ui(`共 ${totalItems} 条`, `${totalItems} items`),
			cls: 'tracekeeper-badge tracekeeper-badge--muted',
		});
		listHeader.createEl('small', {
			text: ui('选择一项进入完整审核。', 'Select an item to open the full review.'),
		});
		if (proposals.length === 0) {
			this.renderEmptyState(
				container,
				ui('当前条件下没有知识变更。', 'No knowledge changes match the current conditions.'),
				ui('尝试切换筛选或清除搜索。', 'Try another filter or clear the search.')
			);
			return;
		}

		const rows = container.createDiv({ cls: 'tracekeeper-review-inbox__rows' });
		for (const proposal of proposals) {
			const isLastViewed = selected?.path === proposal.path;
			const isBatchSelected = this.selectionMode && this.selectedProposalPaths.has(proposal.path);
			const rowClass = [
				'tracekeeper-review-inbox__row',
				isLastViewed ? 'is-selected' : '',
				isBatchSelected ? 'is-checked' : '',
			].filter(Boolean).join(' ');
			const row = this.selectionMode
				? rows.createEl('label', { cls: rowClass })
				: rows.createEl('button', { cls: rowClass });
			if (!this.selectionMode) {
				(row as HTMLButtonElement).type = 'button';
				row.addEventListener('click', () => {
					this.selectedProposalPath = proposal.path;
					this.showingDetail = true;
					void this.render(snapshot);
				});
			}
			if (isLastViewed) {
				row.setAttribute('aria-current', 'true');
			}

			if (this.selectionMode) {
				const checkbox = row.createEl('input', { type: 'checkbox' });
				checkbox.checked = isBatchSelected;
				checkbox.setAttribute(
					'aria-label',
					ui(
						`选择知识变更：${this.proposalTitle(proposal)}`,
						`Select knowledge change: ${this.proposalTitle(proposal)}`
					)
				);
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
			const titleText = title.createDiv({ cls: 'tracekeeper-review-inbox__row-title-text' });
			titleText.createEl('strong', { text: this.proposalTitle(proposal) });
			if (isBatchSelected || isLastViewed) {
				titleText.createEl('span', {
					text: isBatchSelected
						? ui('已选择', 'Selected')
						: ui('刚刚查看', 'Last viewed'),
					cls: 'tracekeeper-review-inbox__current-marker',
				});
			}
			this.renderAttentionBadge(title, proposal, snapshot.contexts[proposal.path]);
			body.createEl('p', {
				text: this.proposalListSummary(proposal),
			});
			body.createEl('small', { text: this.rowMeta(proposal) });
		}
	}

	private renderPagination(
		container: HTMLElement,
		snapshot: MemoryReviewQueueSnapshot,
		page: { pageIndex: number; totalPages: number; totalItems: number; hasNext: boolean; hasPrevious: boolean }
	): void {
		if (page.totalItems === 0) {
			return;
		}
		const pagination = container.createDiv({ cls: 'tracekeeper-review-inbox__pagination' });
		const previous = pagination.createEl('button', { text: ui('上一页', 'Previous') });
		previous.disabled = !page.hasPrevious;
		previous.addEventListener('click', () => {
			this.pageIndex = Math.max(0, page.pageIndex - 1);
			this.selectedProposalPath = '';
			this.showingDetail = false;
			void this.render(snapshot);
		});
		const rangeStart = page.pageIndex * REVIEW_PAGE_SIZE + 1;
		const rangeEnd = Math.min(rangeStart + REVIEW_PAGE_SIZE - 1, page.totalItems);
		pagination.createEl('span', {
			text: ui(
				`第 ${page.pageIndex + 1} / ${page.totalPages} 页 · ${rangeStart}–${rangeEnd} / ${page.totalItems}`,
				`Page ${page.pageIndex + 1} of ${page.totalPages} · ${rangeStart}–${rangeEnd} of ${page.totalItems}`
			),
			cls: 'tracekeeper-review-inbox__pagination-status',
		});
		const next = pagination.createEl('button', { text: ui('下一页', 'Next') });
		next.disabled = !page.hasNext;
		next.addEventListener('click', () => {
			this.pageIndex = page.pageIndex + 1;
			this.selectedProposalPath = '';
			this.showingDetail = false;
			void this.render(snapshot);
		});
	}

	private renderDetailNavigation(
		container: HTMLElement,
		snapshot: MemoryReviewQueueSnapshot,
		proposal: MemoryProposalRecord
	): void {
		const navigation = container.createDiv({ cls: 'tracekeeper-review-inbox__detail-navigation' });
		const position = this.reviewPosition(snapshot, proposal.path);
		const back = navigation.createEl('button', { text: ui('← 返回审核列表', '← Back to review list') });
		back.addEventListener('click', () => {
			if (position.index >= 0) {
				this.pageIndex = Math.floor(position.index / REVIEW_PAGE_SIZE);
			}
			this.showingDetail = false;
			void this.render(snapshot);
		});

		navigation.createEl('span', {
			text: position.index >= 0
				? ui(`正在处理 · 第 ${position.index + 1} / ${position.total} 条`, `Reviewing ${position.index + 1} of ${position.total}`)
				: ui('正在查看当前变更', 'Viewing current change'),
			cls: 'tracekeeper-review-inbox__detail-progress',
			attr: { 'aria-live': 'polite' },
		});
	}

	private reviewPosition(
		snapshot: MemoryReviewQueueSnapshot,
		proposalPath: string
	): { index: number; total: number } {
		const result = filterReviewQueueItems(snapshot.proposals, {
			filter: this.activeFilter,
			search: this.searchQuery,
			sort: this.activeSort,
			pageIndex: 0,
			pageSize: Math.max(1, snapshot.proposals.length),
		}, snapshot.contexts);
		return {
			index: result.items.findIndex((item) => item.path === proposalPath),
			total: result.totalItems,
		};
	}

	private renderDetail(
		container: HTMLElement,
		proposal: MemoryProposalRecord,
		context?: ReviewProposalContext
	): void {
		container.addClass('tracekeeper-review-inbox__detail-panel');
		const header = container.createDiv({ cls: 'tracekeeper-review-inbox__detail-header' });
		const title = header.createDiv();
		title.createEl('span', { text: ui('变更详情', 'Change details'), cls: 'tracekeeper-review-inbox__eyebrow' });
		const detailHeading = title.createEl('h3', { text: this.proposalTitle(proposal) });
		detailHeading.tabIndex = -1;
		detailHeading.focus({ preventScroll: true });
		const badges = header.createDiv({ cls: 'tracekeeper-badge-row' });
		this.renderAttentionBadge(badges, proposal, context);
		if (proposal.riskLevel && proposal.riskLevel !== 'unknown') {
			badges.createEl('span', {
				text: this.plugin.formatRiskLabel(proposal.riskLevel),
				cls: `tracekeeper-badge tracekeeper-badge--risk-${proposal.riskLevel.toLowerCase()}`,
			});
		}

		const status = getReviewProposalAttentionState(
			proposal,
			context ? { exists: context.target.exists } : {}
		);
		const validity = context?.validity || getReviewProposalValidity(proposal);
		if (status === 'incomplete') {
			const notice = container.createDiv({ cls: 'tracekeeper-review-inbox__notice tracekeeper-review-inbox__notice--warning' });
			notice.setText(this.incompleteMessage(validity));
		}

		const summary = container.createDiv({ cls: 'tracekeeper-review-inbox__summary' });
		summary.createEl('strong', { text: ui('变更理由', 'Change rationale') });
		summary.createEl('p', { text: proposal.rationale || this.reviewReason(proposal) });
		const reviewRequirement = this.reviewRequirementMessage(proposal);
		if (reviewRequirement) {
			const requirement = container.createDiv({ cls: 'tracekeeper-review-inbox__notice tracekeeper-review-inbox__notice--warning' });
			requirement.createEl('strong', { text: ui('进入审核的原因', 'Why review is required') });
			requirement.createEl('p', { text: reviewRequirement });
		}

		this.renderDecisionContext(container, proposal, context);

		if (
			proposal.claimKey
			|| context?.priorMemory.length
			|| proposal.supersedes.length > 0
			|| proposal.contradicts.length > 0
		) {
			const lifecycle = container.createDiv({ cls: 'tracekeeper-review-inbox__decision-context' });
			lifecycle.createEl('strong', { text: ui('记忆影响', 'Memory impact') });
			lifecycle.createEl('p', {
				text: ui(
					`建议来源：${this.authorityLabel(proposal.proposedAuthority || 'agent')} · 可信度：${this.confidenceLabel(proposal.proposedConfidence || 'inferred')} · 生效状态：${this.lifecycleStateLabel(proposal.declaredState || 'active')}`,
					`Suggested by ${this.authorityLabel(proposal.proposedAuthority || 'agent')} · Confidence: ${this.confidenceLabel(proposal.proposedConfidence || 'inferred')} · State: ${this.lifecycleStateLabel(proposal.declaredState || 'active')}`
				),
			});
			lifecycle.createEl('p', {
				text: context?.priorMemory.length
					? ui(`找到 ${context.priorMemory.length} 条相关记忆记录。`, `${context.priorMemory.length} related memory record(s) found.`)
					: ui('没有找到相关的现有记忆记录。', 'No related existing memory records were found.'),
			});
			if (proposal.supersedes.length > 0) {
				lifecycle.createEl('p', {
					text: ui(`这项变更会取代 ${proposal.supersedes.length} 条现有记录。`, `This change supersedes ${proposal.supersedes.length} existing record(s).`),
				});
			}
			if (proposal.contradicts.length > 0) {
				lifecycle.createEl('p', {
					text: ui(`这项变更与 ${proposal.contradicts.length} 条现有记录存在冲突。`, `This change conflicts with ${proposal.contradicts.length} existing record(s).`),
					cls: 'tracekeeper-review-inbox__candidate-warning',
				});
			}
		}

		const target = container.createDiv({ cls: 'tracekeeper-review-inbox__target' });
		const isAppliedHistory = proposal.approvalStatus === 'applied';
		const displayTarget = this.reviewDisplayTargetPath(proposal);
		target.createEl('span', {
			text: isAppliedHistory
				? ui('已记录的写回目标', 'Recorded writeback target')
				: ui('目标笔记', 'Target note'),
		});
		target.createEl('strong', {
			text: this.reviewDisplayTargetLabel(proposal, context) || (
				isAppliedHistory
					? ui('未记录', 'Not recorded')
					: ui('尚未指定，需要补全。', 'Not specified; needs completion.')
			),
			cls: 'tracekeeper-review-inbox__target-name',
		});
		if (displayTarget && this.app.vault.getAbstractFileByPath(displayTarget) instanceof TFile) {
			const openTarget = target.createEl('button', { text: ui('打开目标', 'Open target') });
			openTarget.addEventListener('click', () => void this.openTargetNote(displayTarget));
		}

		if (context?.target.exists) {
			const targetContext = container.createDiv({ cls: 'tracekeeper-review-inbox__target-context' });
			targetContext.createEl('strong', { text: ui('当前目标上下文', 'Current target context') });
			targetContext.createEl('p', {
				text: context.target.excerpt || ui('索引中没有可显示的正文摘要。', 'No body excerpt is available in the index.'),
			});
		}

		if (status === 'incomplete' && context) {
			this.renderTargetCandidates(container, proposal, context);
		}

		const preview = container.createDiv({ cls: 'tracekeeper-review-inbox__writeback' });
		const appliedHistory = getReviewAppliedHistory(proposal);
		const previewLabel = this.expectedDiffModeLabel(proposal, context?.target);
		const previewTitle = preview.createEl('strong');
		previewTitle.setText(previewLabel.advanced);
		preview.createEl('small', {
			text: appliedHistory?.receiptVerified
				? ui(
					'这是已完成写回的历史记录；它使用持久化回执，不会根据目标的当前状态重新推断写回方式。',
					'This is historical applied writeback. It uses the persisted receipt and does not re-infer the effect from the target\'s current state.'
				)
				: appliedHistory
					? ui(
						'这项变更记录为已写入，但精确写回回执当前无法验证；仅显示已记录的写回目标，不从当前目标推断历史结果。',
						'This change is recorded as applied, but its exact apply receipt is not currently verified. Only the recorded writeback target is shown; current target state is not used to infer history.'
					)
				: ui(
					'这是审核前的差异视图；通过审核不会写入。最终写入仍会重新生成预览并要求确认。',
					'This is a pre-approval diff. Approval does not write. Apply will generate a fresh preview and require confirmation.'
				),
			cls: 'tracekeeper-view__description',
		});
		preview.createEl('pre', {
			text: context?.diffPreview
				|| proposal.writebackContent
				|| ui('尚未提供可写入内容。', 'No writable content has been provided.'),
			cls: proposal.writebackContent ? 'tracekeeper-review-inbox__diff' : 'is-empty',
		});

		if (proposal.revisionComment) {
			const revision = container.createDiv({ cls: 'tracekeeper-review-inbox__revision' });
			revision.createEl('strong', { text: ui('修订说明', 'Revision comment') });
			revision.createEl('p', { text: proposal.revisionComment });
		}

		const actions = container.createDiv({ cls: 'tracekeeper-action-row tracekeeper-review-inbox__actions' });
		this.renderDetailActions(actions, proposal, status, validity.isComplete, context);

		const source = container.createEl('details', { cls: 'tracekeeper-advanced-details tracekeeper-review-inbox__technical-details' });
		source.createEl('summary', { text: ui('技术信息', 'Technical details'), cls: 'tracekeeper-advanced-summary' });
		const sourceDetails = source.createDiv({ cls: 'tracekeeper-review-inbox__source' });
		this.renderSourceLine(sourceDetails, ui('原始记录', 'Source record'), proposal.path);
		this.renderSourceLine(sourceDetails, ui('记录 ID', 'Record ID'), proposal.proposalId || ui('未指定', 'Not specified'));
		this.renderSourceLine(sourceDetails, ui('审核状态', 'Review status'), memoryProposalStatusLabel(proposal.approvalStatus));
		if (displayTarget) {
			this.renderSourceLine(sourceDetails, ui('目标路径', 'Target path'), displayTarget);
		}
		if (proposal.claimKey) {
			this.renderSourceLine(sourceDetails, ui('Claim 键', 'Claim key'), proposal.claimKey);
			this.renderSourceLine(
				sourceDetails,
				ui('权限与可信度', 'Authority and confidence'),
				[proposal.proposedAuthority || 'agent', proposal.proposedConfidence || 'inferred'].join(' · ')
			);
			this.renderSourceLine(sourceDetails, ui('生命周期状态', 'Lifecycle state'), proposal.declaredState || 'active');
			if (context?.priorMemory.length) {
				for (const prior of context.priorMemory) {
					this.renderSourceLine(
						sourceDetails,
						ui('现有记录', 'Existing record'),
						[prior.memoryId || prior.path, prior.authority, prior.confidence, prior.effectiveState]
							.filter(Boolean)
							.join(' · ')
					);
				}
			}
			if (proposal.supersedes.length > 0) {
				this.renderSourceLine(sourceDetails, ui('取代记录', 'Supersedes'), proposal.supersedes.join('\n'));
			}
			if (proposal.contradicts.length > 0) {
				this.renderSourceLine(sourceDetails, ui('冲突记录', 'Conflicts with'), proposal.contradicts.join('\n'));
			}
		}
		if (appliedHistory) {
			this.renderSourceLine(
				sourceDetails,
				ui('历史写回方式', 'Historical writeback effect'),
				appliedHistory.writebackEffect || ui('未知（历史记录未验证或未保存）', 'Unknown (not verified or not recorded)')
			);
			this.renderSourceLine(
				sourceDetails,
				ui('已记录的写回目标', 'Recorded writeback target'),
				appliedHistory.targetNote || ui('未记录', 'Not recorded')
			);
			if (appliedHistory.receiptVerified) {
				this.renderSourceLine(sourceDetails, ui('写回操作', 'Writeback operation'), appliedHistory.operationId);
				this.renderSourceLine(sourceDetails, ui('写回时间', 'Applied at'), appliedHistory.appliedAt);
			}
		}
		this.renderSourceLine(sourceDetails, ui('创建时间', 'Created'), this.plugin.formatDisplayTime(proposal.sortTimestamp));
		if (proposal.relatedProject) {
			this.renderSourceLine(sourceDetails, ui('相关项目', 'Related project'), proposal.relatedProject);
		}
		if (proposal.taskId) {
			this.renderSourceLine(sourceDetails, ui('任务', 'Task'), proposal.taskId);
		}
		if (proposal.sourceSessionNote) {
			this.renderSourceLine(sourceDetails, ui('收尾记录', 'Final note'), proposal.sourceSessionNote);
		}
		if (proposal.evidence.length > 0) {
			this.renderSourceLine(sourceDetails, ui('证据', 'Evidence'), proposal.evidence.join('\n'));
		}
		if (proposal.relatedSources.length > 0) {
			this.renderSourceLine(sourceDetails, ui('相关资料', 'Related sources'), proposal.relatedSources.join('\n'));
		}
		const open = sourceDetails.createEl('button', { text: ui('查看原始记录', 'View original record') });
		open.addEventListener('click', () => void this.openReviewQueueItem(proposal));
	}

	private renderDecisionContext(
		container: HTMLElement,
		proposal: MemoryProposalRecord,
		context?: ReviewProposalContext
	): void {
		const evidence = container.createDiv({ cls: 'tracekeeper-review-inbox__decision-context' });
		evidence.createEl('strong', { text: ui('任务与资料依据', 'Task and source evidence') });
		if (context?.task) {
			const task = evidence.createDiv({ cls: 'tracekeeper-review-context-card' });
			task.createEl('span', { text: ui('任务', 'Task'), cls: 'tracekeeper-review-inbox__eyebrow' });
			task.createEl('strong', {
				text: context.task.objective || ui('已关联任务', 'Linked task'),
			});
			task.createEl('p', {
				text: [
					context.task.status,
					context.task.summary,
				].filter(Boolean).join(' · '),
			});
			const openTask = task.createEl('button', { text: ui('打开任务记录', 'Open task record') });
			openTask.addEventListener('click', () => {
				void this.openMarkdownPath(
					context.task?.path || '',
					ui('没有找到任务记录。', 'Task record was not found.')
				);
			});
		} else if (proposal.taskId) {
			evidence.createEl('p', {
				text: ui(
					'关联任务的摘要当前不可用，可在技术信息中核对原始引用。',
					'The linked task summary is unavailable. Check its original reference in Technical details.'
				),
				cls: 'tracekeeper-view__description',
			});
		}

		if (context?.sources.length) {
			const sources = evidence.createDiv({ cls: 'tracekeeper-review-context-list' });
			for (const source of context.sources.slice(0, 4)) {
				this.renderSourceContext(sources, source);
			}
		}
		if (!context?.task && !context?.sources.length && proposal.evidence.length === 0) {
			evidence.createEl('p', {
				text: ui(
					'这项变更没有可关联的任务或资料摘要；请重点核对变更理由和目标差异。',
					'No task or source summary is linked to this change. Review the rationale and target diff carefully.'
				),
				cls: 'tracekeeper-view__description',
			});
		}
		if (proposal.evidence.length > 0) {
			evidence.createEl('p', {
				text: ui(
					`已关联 ${proposal.evidence.length} 条补充证据；原始引用位于技术信息中。`,
					`${proposal.evidence.length} additional evidence reference(s) are linked; raw references are in Technical details.`
				),
				cls: 'tracekeeper-view__description',
			});
		}
	}

	private renderSourceContext(container: HTMLElement, source: ReviewSourceContext): void {
		const card = container.createDiv({ cls: 'tracekeeper-review-context-card' });
		card.createEl('span', { text: ui('资料', 'Source'), cls: 'tracekeeper-review-inbox__eyebrow' });
		card.createEl('strong', { text: source.title || ui('资料记录', 'Source record') });
		if (source.sourceKind) {
			card.createEl('small', {
				text: this.sourceKindLabel(source.sourceKind),
			});
		}
		if (source.summary) {
			card.createEl('p', { text: source.summary });
		}
		const openSource = card.createEl('button', { text: ui('打开资料', 'Open source') });
		openSource.addEventListener('click', () => {
			void this.openMarkdownPath(
				source.path,
				ui('没有找到资料记录。', 'Source record was not found.')
			);
		});
	}

	private renderTargetCandidates(
		container: HTMLElement,
		proposal: MemoryProposalRecord,
		context: ReviewProposalContext
	): void {
		const candidates = container.createDiv({ cls: 'tracekeeper-review-inbox__candidates' });
		candidates.createEl('strong', { text: ui('受限目标候选', 'Constrained target candidates') });
		candidates.createEl('p', {
			text: ui(
					'候选只来自当前 Vault 中已存在的记忆或知识笔记。选择候选只会补全当前变更，不会写入目标。',
					'Candidates come only from existing memory or knowledge notes in this Vault. Selecting one only completes the current change; it does not write to the target.'
			),
			cls: 'tracekeeper-view__description',
		});
		if (context.indexState !== 'ready') {
			candidates.createEl('p', {
				text: ui(
					'知识索引尚未就绪，候选列表可能不完整。请等待索引完成后刷新。',
					'The knowledge index is not ready, so candidates may be incomplete. Refresh after indexing finishes.'
				),
				cls: 'tracekeeper-review-inbox__candidate-warning',
			});
		}
		if (context.targetCandidates.length === 0) {
			candidates.createEl('p', {
				text: ui(
					'当前没有安全候选。请退回修改，让 Agent 使用已验证的记忆或知识笔记重新提交。',
					'No safe candidate is available. Return the change for revision so the Agent can resubmit with a verified memory or knowledge note.'
				),
				cls: 'tracekeeper-review-inbox__candidate-warning',
			});
			return;
		}
		const list = candidates.createDiv({ cls: 'tracekeeper-review-candidate-list' });
		for (const candidate of context.targetCandidates) {
			this.renderTargetCandidate(list, proposal, context, candidate);
		}
	}

	private renderTargetCandidate(
		container: HTMLElement,
		proposal: MemoryProposalRecord,
		context: ReviewProposalContext,
		candidate: ReviewTargetCandidate
	): void {
		const item = container.createDiv({ cls: 'tracekeeper-review-candidate' });
		const details = item.createDiv();
		details.createEl('strong', { text: candidate.title || this.noteNameFromPath(candidate.path) });
		details.createEl('small', { text: this.targetCandidateReason(candidate) });
		if (candidate.excerpt) {
			details.createEl('p', { text: trimText(candidate.excerpt, 180) });
		}
		const choose = item.createEl('button', { text: ui('选择并补全', 'Select and complete') });
		choose.addEventListener('click', () => {
			new ReviewQueueEditProposalModal(
				this.app,
				this.plugin,
				proposal,
				context,
				() => this.refreshSelectedProposal(proposal.path),
				candidate.path
			).open();
		});
	}

	private targetCandidateReason(candidate: ReviewTargetCandidate): string {
		const kind = candidate.kind === 'project_memory'
			? ui('项目记忆', 'Project memory')
			: candidate.kind === 'global_memory'
				? ui('全局记忆', 'Global memory')
				: ui('知识笔记', 'Knowledge note');
		const reason = candidate.reason === 'current'
			? ui('当前目标', 'Current target')
			: candidate.reason === 'project_match'
				? ui('项目匹配', 'Project match')
				: candidate.reason === 'scope_match'
					? ui('范围匹配', 'Scope match')
					: candidate.reason === 'related_match'
						? ui('内容相关', 'Related content')
						: ui('可用候选', 'Available candidate');
		return `${kind} · ${reason}`;
	}

	private renderDetailActions(
		container: HTMLElement,
		proposal: MemoryProposalRecord,
		status: ReviewProposalAttentionState,
		isComplete: boolean,
		context?: ReviewProposalContext
	): void {
		if (proposal.classification !== 'memory_proposal') {
			if (status === 'pending_review') {
				this.addStatusAction(container, proposal, 'applied', ui('确认完成', 'Confirm complete'), 'tracekeeper-confirm-button', 'history');
				this.addRevisionAction(container, proposal);
				this.addStatusAction(container, proposal, 'rejected', ui('不采纳', 'Do not accept'), 'mod-warning', 'history');
			}
			return;
		}

		if (status === 'incomplete') {
			if (proposal.approvalStatus === 'approved') {
				this.addStatusAction(
					container,
					proposal,
					'pending',
					ui('撤回通过并补全', 'Withdraw approval and complete'),
					'',
					'needs_completion'
				);
				return;
			}
			this.addEditAction(container, proposal, context, ui('补全内容', 'Complete details'), true);
			this.addRevisionAction(container, proposal);
			this.addStatusAction(container, proposal, 'rejected', ui('不采纳', 'Do not accept'), 'mod-warning', 'history');
			return;
		}
		if (status === 'pending_review') {
			this.addEditAction(container, proposal, context, ui('编辑变更', 'Edit change'));
			this.addRevisionAction(container, proposal);
			this.addStatusAction(container, proposal, 'rejected', ui('不采纳', 'Do not accept'), 'mod-warning', 'history');
			this.addStatusAction(container, proposal, 'approved', ui('通过审核', 'Approve'), 'mod-cta', 'ready_to_apply');
			return;
		}
		if (status === 'awaiting_revision') {
			this.addEditAction(container, proposal, context, ui('编辑变更', 'Edit change'));
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
					this.showingDetail = false;
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

	private addEditAction(
		container: HTMLElement,
		proposal: MemoryProposalRecord,
		context: ReviewProposalContext | undefined,
		label: string,
		primary = false
	): void {
		const edit = container.createEl('button', { text: label, cls: primary ? 'mod-cta' : '' });
		edit.addEventListener('click', () => {
			new ReviewQueueEditProposalModal(
				this.app,
				this.plugin,
				proposal,
				context,
				() => this.refreshSelectedProposal(proposal.path)
			).open();
		});
	}

	private addRevisionAction(container: HTMLElement, proposal: MemoryProposalRecord): void {
		const revision = container.createEl('button', { text: ui('退回修改', 'Return for revision'), cls: 'tracekeeper-revision-button' });
		revision.addEventListener('click', () => {
			new ReviewQueueRequestRevisionModal(
				this.app,
				this.plugin,
				proposal,
				() => this.refreshSelectedProposal(proposal.path)
			).open();
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
						this.pageIndex = 0;
					}
					this.selectedProposalPath = proposal.path;
					await this.refresh();
				} catch (error) {
					console.error('tracekeeper failed to update review proposal status', error);
					button.disabled = false;
					if (isProposalTransitionConflict(error)) {
						new Notice(ui(
							'知识变更已发生变化，正在重新加载审核状态。',
							'The knowledge change was updated. Reloading the current review state.'
						));
						await this.refresh();
					} else {
						new Notice(reviewStatusFailureMessage(error));
					}
				}
			})();
		});
	}

	private async batchUpdate(proposals: MemoryProposalRecord[], status: MemoryProposalStatus): Promise<void> {
		const failedPaths: string[] = [];
		const failedReasons: string[] = [];
		let updated = 0;
		for (const proposal of proposals) {
			try {
				await this.plugin.updateMemoryProposalStatus(proposal, status);
				updated += 1;
			} catch (error) {
				failedPaths.push(proposal.path);
				failedReasons.push(reviewStatusFailureReason(error));
				console.error('tracekeeper failed to update review proposal in batch', error);
			}
		}
		this.selectedProposalPaths.clear();
		for (const failedPath of failedPaths) {
			this.selectedProposalPaths.add(failedPath);
		}
		const failed = failedPaths.length;
		new Notice(
			failed === 0
				? ui(`已更新 ${updated} 条知识变更。`, `Updated ${updated} knowledge changes.`)
				: ui(
					`已更新 ${updated} 条知识变更；${failed} 条失败并保留选择。首个失败原因：${failedReasons[0]}`,
					`Updated ${updated} knowledge changes; ${failed} failed and remain selected. First failure: ${failedReasons[0]}`
				)
		);
		await this.refresh();
	}

	private async afterBatchArchive(moved: number): Promise<void> {
		new Notice(ui(`已归档 ${moved} 条处理记录。`, `Archived ${moved} processed records.`));
		this.selectedProposalPaths.clear();
		await this.refresh();
	}

	private resolveSelectedProposal(proposals: MemoryProposalRecord[]): MemoryProposalRecord | null {
		if (!this.selectedProposalPath) {
			return null;
		}
		const selected = proposals.find((proposal) => proposal.path === this.selectedProposalPath) || null;
		if (!selected) {
			this.selectedProposalPath = '';
			this.showingDetail = false;
		}
		return selected;
	}

	private renderAttentionBadge(
		container: HTMLElement,
		proposal: MemoryProposalRecord,
		context?: ReviewProposalContext
	): void {
		const state = getReviewProposalAttentionState(
			proposal,
			context ? { exists: context.target.exists } : {}
		);
		const className = state === 'incomplete'
			? 'tracekeeper-badge tracekeeper-badge--warning'
			: state === 'ready_to_apply'
				? 'tracekeeper-badge tracekeeper-badge--success'
				: state === 'awaiting_revision'
					? 'tracekeeper-badge tracekeeper-badge--warning'
					: 'tracekeeper-badge tracekeeper-badge--muted';
		container.createEl('span', { text: this.attentionStateLabel(state), cls: className });
	}

	private attentionFilter(state: ReviewProposalAttentionState): ReviewInboxFilter {
		switch (state) {
			case 'incomplete':
				return 'needs_completion';
			case 'pending_review':
				return 'needs_review';
			case 'ready_to_apply':
				return 'ready_to_apply';
			case 'awaiting_revision':
				return 'awaiting_revision';
			case 'completed':
			default:
				return 'history';
		}
	}

	private attentionStateLabel(state: ReviewProposalAttentionState): string {
		switch (state) {
		case 'incomplete':
				return ui('待补全，不能审核', 'Needs completion; not reviewable');
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
		if (validity.invalidTargetNote) {
			return ui(
				'这项变更的目标不在受支持的本地知识区域。请选择现有记忆或知识笔记，或退回修改。',
				'The target is outside the supported local knowledge area. Select an existing memory or knowledge note, or return the change for revision.'
			);
		}
		if (validity.invalidWritebackEffect) {
			return ui(
				'这项变更包含不受支持的写入方式，请退回修改。',
				'This change uses an unsupported writeback mode. Return it for revision.'
			);
		}
		if (validity.effectTargetMismatch) {
			return ui(
				'写入方式与目标笔记类型不匹配，请退回修改。',
				'The writeback mode is incompatible with the target note type. Return it for revision.'
			);
		}
		if (validity.missingTargetEvidence) {
			return ui(
				'已填写的目标笔记不存在。请选择当前 Vault 中已有的记忆或知识笔记后再审核。',
				'The selected target does not exist. Choose an existing memory or knowledge note from this Vault before review.'
			);
		}
		if (validity.missingTargetNote && validity.missingWritebackContent) {
			return ui('这项变更缺少目标笔记和拟写入内容。它不会进入正常审核，请先补全。', 'This change is missing both a target note and writeback content. It cannot enter normal review until completed.');
		}
		return validity.missingTargetNote
			? ui('这项变更缺少目标笔记。请选择受限候选后再进入审核。', 'This change is missing a target note. Select a constrained candidate before review.')
			: ui('这项变更缺少拟写入内容。请先补全内容，再进入审核。', 'This change is missing writeback content. Complete it before review.');
	}

	private proposalTitle(proposal: MemoryProposalRecord): string {
		if (proposal.classification !== 'memory_proposal') {
			return this.reviewQueueItemTypeLabel(proposal.classification);
		}
		return this.proposalKindLabel(proposal.proposalKind);
	}

	private proposalListSummary(proposal: MemoryProposalRecord): string {
		const fallback = this.reviewReason(proposal);
		const source = proposal.writebackContent || proposal.snippet || fallback;
		return trimText(snippetFromText(source, fallback) || fallback, 140);
	}

	private expectedDiffModeLabel(
		proposal: MemoryProposalRecord,
		target?: ReviewTargetContext
	): {
		advanced: string;
	} {
		const appliedHistory = getReviewAppliedHistory(proposal);
		if (appliedHistory?.writebackEffect === 'create_memory_record') {
			return { advanced: ui('已写入：新增记忆', 'Applied: memory added') };
		}
		if (appliedHistory?.writebackEffect === 'create_wiki_note') {
			return { advanced: ui('已写入：新建知识笔记', 'Applied: knowledge note created') };
		}
		if (appliedHistory?.writebackEffect === 'append') {
			return { advanced: ui('已写入：追加', 'Applied: content appended') };
		}
		if (appliedHistory) {
			return { advanced: ui('已写入：历史方式未知', 'Applied: historical effect unknown') };
		}
		const targetIsWiki = Boolean(
			target?.path
			&& startsWithPathPrefix(target.path, KNOWLEDGE_WIKI_DIR)
		);
		const targetMissing = !target?.exists;
		if (proposal.writebackEffect === 'create_memory_record') {
			return {
				advanced: ui('准备新增一条记忆', 'Memory to add'),
			};
		}
		if (
			proposal.writebackEffect === 'create_wiki_note'
			|| (
				proposal.writebackEffect === undefined
				&& targetMissing
				&& targetIsWiki
			)
		) {
			return {
				advanced: ui('准备新建知识笔记', 'Knowledge note to create'),
			};
		}
		return {
			advanced: ui('准备追加的内容', 'Content to append'),
		};
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
				return ui('保存为记忆', 'Save as memory');
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
				return ui('记忆更新', 'Memory update');
		}
	}

	private authorityLabel(value: string): string {
		switch (value.trim().toLowerCase()) {
			case 'user':
				return ui('用户确认', 'user confirmation');
			case 'source':
				return ui('资料来源', 'source evidence');
			case 'agent':
			default:
				return ui('Agent 建议', 'Agent suggestion');
		}
	}

	private confidenceLabel(value: string): string {
		switch (value.trim().toLowerCase()) {
			case 'verified':
				return ui('已验证', 'verified');
			case 'supported':
				return ui('有资料支持', 'supported by evidence');
			case 'uncertain':
				return ui('尚不确定', 'uncertain');
			case 'inferred':
			default:
				return ui('根据上下文推断', 'inferred from context');
		}
	}

	private lifecycleStateLabel(value: string): string {
		switch (value.trim().toLowerCase()) {
			case 'disputed':
				return ui('存在争议', 'disputed');
			case 'retracted':
				return ui('已撤回', 'retracted');
			case 'review':
				return ui('待审核', 'under review');
			case 'active':
			default:
				return ui('当前有效', 'active');
		}
	}

	private sourceKindLabel(value: string): string {
		switch (value.trim().toLowerCase()) {
			case 'web':
				return ui('网页资料', 'Web source');
			case 'file':
				return ui('本地文件', 'Local file');
			case 'transcript':
				return ui('对话记录', 'Transcript');
			default:
				return ui('资料', 'Source');
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

	private reviewRequirementMessage(proposal: MemoryProposalRecord): string {
		const reason = proposal.reviewReason;
		switch (reason) {
			case 'memory_rule_requires_human_review':
				return ui('当前记忆规则要求写入前由你确认。', 'The current memory rule requires your confirmation before writeback.');
			case 'missing_wiki_bridge':
				return ui('项目记忆缺少可验证的知识笔记关联，不能自动保存。', 'The project memory has no verified knowledge-note relation and cannot be saved automatically.');
			case 'user_authority_requires_human_review':
				return ui('这项变更申请用户权威，必须由你确认。', 'This change requests user authority and must be confirmed by you.');
			case 'lifecycle_transition_requires_human_review':
				return ui('这项变更会改变既有记忆的生命周期状态，必须由你确认。', 'This change updates an existing memory lifecycle state and must be confirmed by you.');
			case 'unresolved_claim_conflict':
				return ui('同一声明已有当前记录，且这项变更没有给出明确的取代或矛盾关系。', 'A current record already exists for this claim, without an explicit supersession or contradiction relation.');
			case 'missing_exact_project_identity':
			case 'invalid_repo_path':
			case 'explicit_project_id_not_found':
			case 'conflicting_project_identity':
			case 'project_hint_conflict':
			case 'derived_project_key_occupied':
			case 'project_snapshot_incomplete':
				return ui('运行时无法唯一确认项目身份或项目记忆目录，需要你核对目标。', 'Runtime could not uniquely confirm the project identity or memory location; verify the target.');
			default:
				if (proposal.reviewWarnings.length > 0) {
					return proposal.reviewWarnings.join(' ');
				}
				if (proposal.proposedAuthority === 'user') {
					return ui('这项变更申请用户权威，必须由你确认。', 'This change requests user authority and must be confirmed by you.');
				}
				if (proposal.declaredState && proposal.declaredState !== 'active') {
					return ui('这项变更会改变记忆的生命周期状态，必须由你确认。', 'This change updates a memory lifecycle state and must be confirmed by you.');
				}
				if (proposal.proposedConfidence === 'verified') {
					return ui('这项变更申请“已验证”可信度，因此创建时进入了人工审核。', 'This change requested verified confidence, so it entered human review when it was created.');
				}
				return '';
		}
	}

	private rowMeta(proposal: MemoryProposalRecord): string {
		const parts = [
			proposal.relatedProject,
			this.plugin.formatDisplayTime(proposal.sortTimestamp),
		].filter(Boolean);
		return parts.join(' · ');
	}

	private reviewDisplayTargetLabel(
		proposal: MemoryProposalRecord,
		context?: ReviewProposalContext
	): string {
		if (context?.target.title) {
			return context.target.title;
		}
		return this.noteNameFromPath(this.reviewDisplayTargetPath(proposal));
	}

	private noteNameFromPath(path: string): string {
		if (!path) {
			return '';
		}
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			return file.basename;
		}
		return path.split('/').pop()?.replace(/\.md$/i, '') || path;
	}

	private renderSourceLine(container: HTMLElement, label: string, value: string): void {
		const line = container.createDiv();
		line.createEl('span', { text: label });
		line.createEl('code', { text: value });
	}

	private async openReviewQueueItem(proposal: MemoryProposalRecord): Promise<void> {
		await this.openMarkdownPath(
			proposal.path,
			ui('没有找到知识变更的原始记录。', 'The source record for this knowledge change was not found.')
		);
	}

	private async openTargetNote(targetPath: string): Promise<void> {
		const target = this.app.vault.getAbstractFileByPath(targetPath);
		if (!(target instanceof TFile)) {
			new Notice(ui('目标笔记尚不存在或不可用。', 'The target note does not exist or is unavailable.'));
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(target);
	}

	private reviewDisplayTargetPath(proposal: MemoryProposalRecord): string {
		const appliedHistory = getReviewAppliedHistory(proposal);
		if (proposal.approvalStatus === 'applied') {
			return appliedHistory?.targetNote || '';
		}
		return appliedHistory?.targetNote || proposal.targetNote;
	}

	private async openMarkdownPath(path: string, missingMessage: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(missingMessage);
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	private renderEmptyState(container: HTMLElement, title: string, detail: string): void {
		const empty = container.createDiv({ cls: 'tracekeeper-empty-state' });
		empty.createEl('strong', { text: title });
		empty.createEl('p', { text: detail });
	}
}
