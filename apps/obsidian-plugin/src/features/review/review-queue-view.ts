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
	ReviewQueueArchiveModal,
	ReviewQueueConfirmModal,
	ReviewQueueEditProposalModal,
	ReviewQueueRequestRevisionModal,
} from './review-modals';
import type {
	ReviewProposalContext,
	ReviewSourceContext,
	ReviewTargetCandidate,
} from './review-context-model';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_REVIEW_QUEUE_VIEW } from '../../ui/view-types';
import { trimText } from '../shared/markdown-record-parser';

const REVIEW_PAGE_SIZE = 18;
const isProposalTransitionConflict = (error: unknown): boolean =>
	error instanceof Error && error.name === 'ProposalTransitionConflictError';

export class TracekeeperReviewQueueView extends ItemView {
	private activeFilter: ReviewInboxFilter = 'needs_completion';
	private activeSort: ReviewQueueSort = 'attention';
	private filterExplicitlySelected = false;
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
		const selected = this.resolveSelectedProposal(result.items);

		this.renderControls(contentEl, snapshot, result.counts);
		this.renderBatchActions(contentEl, snapshot.proposals);

		const inbox = contentEl.createDiv({ cls: 'tracekeeper-review-inbox' });
		const list = inbox.createDiv({ cls: 'tracekeeper-review-inbox__list' });
		this.renderList(list, result.items, selected, snapshot);
		this.renderPagination(list, snapshot, result.page);

		const detail = inbox.createDiv({ cls: 'tracekeeper-review-inbox__detail' });
		if (selected) {
			this.renderDetail(detail, selected, snapshot.contexts[selected.path]);
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
			this.renderAttentionBadge(title, proposal, snapshot.contexts[proposal.path]);
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

	private renderDetail(
		container: HTMLElement,
		proposal: MemoryProposalRecord,
		context?: ReviewProposalContext
	): void {
		container.addClass('tracekeeper-review-inbox__detail-panel');
		const header = container.createDiv({ cls: 'tracekeeper-review-inbox__detail-header' });
		const title = header.createDiv();
		title.createEl('span', { text: this.reviewQueueItemTypeLabel(proposal.classification), cls: 'tracekeeper-review-inbox__eyebrow' });
		title.createEl('h3', { text: this.proposalTitle(proposal) });
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

		this.renderDecisionContext(container, proposal, context);

		if (proposal.claimKey) {
			const lifecycle = container.createDiv({ cls: 'tracekeeper-review-inbox__decision-context' });
			lifecycle.createEl('strong', { text: ui('记忆生命周期影响', 'Memory lifecycle impact') });
			this.renderSourceLine(lifecycle, ui('Claim 键', 'Claim key'), proposal.claimKey);
			this.renderSourceLine(
				lifecycle,
				ui('提议权限与置信度', 'Proposed authority and confidence'),
				[proposal.proposedAuthority || 'agent', proposal.proposedConfidence || 'inferred'].join(' · ')
			);
			this.renderSourceLine(
				lifecycle,
				ui('提议状态', 'Proposed state'),
				proposal.declaredState || 'active'
			);
			this.renderSourceLine(
				lifecycle,
				ui('审核后预测状态', 'Predicted state after approval'),
				ui('由运行时重新计算；当前提案保持 review。', 'Recomputed by Runtime; this proposal remains in review.')
			);
			if (context?.priorMemory.length) {
				for (const prior of context.priorMemory) {
					this.renderSourceLine(
						lifecycle,
						ui('现有记录', 'Existing record'),
						[prior.memoryId || prior.path, prior.authority, prior.confidence, prior.effectiveState]
							.filter(Boolean)
							.join(' · ')
					);
				}
			} else {
				this.renderSourceLine(lifecycle, ui('现有记录', 'Existing record'), ui('无匹配记录', 'No matching record'));
			}
			if (proposal.supersedes.length > 0) {
				this.renderSourceLine(lifecycle, ui('取代', 'Supersedes'), proposal.supersedes.join('\n'));
			}
			if (proposal.contradicts.length > 0) {
				this.renderSourceLine(lifecycle, ui('矛盾', 'Contradicts'), proposal.contradicts.join('\n'));
			}
		}

		const target = container.createDiv({ cls: 'tracekeeper-review-inbox__target' });
		target.createEl('span', { text: ui('目标笔记', 'Target note') });
		target.createEl('code', { text: proposal.targetNote || ui('尚未指定，需要补全。', 'Not specified; needs completion.') });
		if (context?.target.exists) {
			const openTarget = target.createEl('button', { text: ui('打开目标', 'Open target') });
			openTarget.addEventListener('click', () => void this.openTargetNote(proposal));
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
		preview.createEl('strong', { text: ui('预计追加差异', 'Expected append diff') });
		preview.createEl('small', {
			text: ui(
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
			task.createEl('strong', { text: context.task.objective || context.task.taskId });
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
					`任务 ${proposal.taskId} 的摘要当前不可用，可在原始提案记录中核对引用。`,
					`A summary for task ${proposal.taskId} is unavailable. Check the reference in the original proposal record.`
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
					'此提案没有可关联的任务或资料摘要；请重点核对变更理由和目标差异。',
					'No task or source summary is linked. Review the rationale and target diff carefully.'
				),
				cls: 'tracekeeper-view__description',
			});
		}
		if (proposal.evidence.length > 0) {
			evidence.createEl('p', {
				text: `${ui('补充证据', 'Additional evidence')}: ${proposal.evidence.join(' · ')}`,
				cls: 'tracekeeper-view__description',
			});
		}
	}

	private renderSourceContext(container: HTMLElement, source: ReviewSourceContext): void {
		const card = container.createDiv({ cls: 'tracekeeper-review-context-card' });
		card.createEl('span', { text: ui('资料', 'Source'), cls: 'tracekeeper-review-inbox__eyebrow' });
		card.createEl('strong', { text: source.title || source.path });
		if (source.sourceKind || source.source) {
			card.createEl('small', {
				text: [source.sourceKind, source.source].filter(Boolean).join(' · '),
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
				'候选只来自当前 Vault 中已存在的 Memory/Wiki 笔记。选择候选只会补全提案，不会写入目标。',
				'Candidates come only from existing Memory/Wiki notes in this Vault. Selecting one only completes the proposal; it does not write to the target.'
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
					'当前没有安全候选。请退回修改，让 Agent 使用已验证的 Memory/Wiki 目标重新提交。',
					'No safe candidate is available. Return the proposal for revision so the Agent can resubmit with a verified Memory/Wiki target.'
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
		details.createEl('strong', { text: candidate.title || candidate.path });
		details.createEl('code', { text: candidate.path });
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
				() => this.refresh(),
				candidate.path
			).open();
		});
	}

	private targetCandidateReason(candidate: ReviewTargetCandidate): string {
		const kind = candidate.kind === 'project_memory'
			? ui('项目记忆', 'Project memory')
			: candidate.kind === 'global_memory'
				? ui('全局记忆', 'Global memory')
				: 'Wiki';
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
				this.addStatusAction(container, proposal, 'rejected', ui('不采纳', 'Do not accept'), 'mod-warning');
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
			this.addEditAction(container, proposal, context, ui('补全提案', 'Complete proposal'), true);
			this.addRevisionAction(container, proposal);
			this.addStatusAction(container, proposal, 'rejected', ui('不采纳', 'Do not accept'), 'mod-warning');
			return;
		}
		if (status === 'pending_review') {
			this.addEditAction(container, proposal, context, ui('编辑提案', 'Edit proposal'));
			this.addRevisionAction(container, proposal);
			this.addStatusAction(container, proposal, 'rejected', ui('不采纳', 'Do not accept'), 'mod-warning');
			this.addStatusAction(container, proposal, 'approved', ui('通过审核', 'Approve'), 'mod-cta', 'ready_to_apply');
			return;
		}
		if (status === 'awaiting_revision') {
			this.addEditAction(container, proposal, context, ui('编辑提案', 'Edit proposal'));
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
				() => this.refresh()
			).open();
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
					if (isProposalTransitionConflict(error)) {
						new Notice(ui(
							'提案已发生变化，正在重新加载审核状态。',
							'The proposal changed. Reloading the current review state.'
						));
						await this.refresh();
					} else {
						new Notice(ui('更新审核状态失败。', 'Failed to update review status.'));
					}
				}
			})();
		});
	}

	private async batchUpdate(proposals: MemoryProposalRecord[], status: MemoryProposalStatus): Promise<void> {
		const failedPaths: string[] = [];
		let updated = 0;
		for (const proposal of proposals) {
			try {
				await this.plugin.updateMemoryProposalStatus(proposal, status);
				updated += 1;
			} catch (error) {
				failedPaths.push(proposal.path);
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
				? ui(`已更新 ${updated} 条变更提案。`, `Updated ${updated} change proposals.`)
				: ui(
					`已更新 ${updated} 条变更提案；${failed} 条失败并保留选择。`,
					`Updated ${updated} change proposals; ${failed} failed and remain selected.`
				)
		);
		await this.refresh();
	}

	private async afterBatchArchive(moved: number): Promise<void> {
		new Notice(ui(`已归档 ${moved} 条处理记录。`, `Archived ${moved} processed records.`));
		this.selectedProposalPaths.clear();
		await this.refresh();
	}

	private resolveSelectedProposal(visible: MemoryProposalRecord[]): MemoryProposalRecord | null {
		const selected = visible.find((proposal) => proposal.path === this.selectedProposalPath) || visible[0] || null;
		this.selectedProposalPath = selected?.path || '';
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
				'此提案的目标不在受支持的本地知识区域。请选择现有 Memory/Wiki 候选，或退回修改。',
				'The target is outside the supported local knowledge area. Select an existing Memory/Wiki candidate or return the proposal for revision.'
			);
		}
		if (validity.missingTargetEvidence) {
			return ui(
				'目标路径已填写，但对应 Markdown 不存在。请选择现有 Memory/Wiki 候选后再审核。',
				'The target path is present, but its Markdown does not exist. Select an existing Memory/Wiki candidate before review.'
			);
		}
		if (validity.missingTargetNote && validity.missingWritebackContent) {
			return ui('此提案缺少目标笔记和拟写入内容。它不会进入正常审核，请先补全。', 'This proposal is missing both a target note and writeback content. It cannot enter normal review until completed.');
		}
		return validity.missingTargetNote
			? ui('此提案缺少目标笔记。请选择受限候选后再进入审核。', 'This proposal is missing a target note. Select a constrained candidate before review.')
			: ui('此提案缺少拟写入内容。请先补全内容，再进入审核。', 'This proposal is missing writeback content. Complete it before review.');
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
		await this.openMarkdownPath(
			proposal.path,
			ui('没有找到变更提案记录。', 'Change proposal record was not found.')
		);
	}

	private async openTargetNote(proposal: MemoryProposalRecord): Promise<void> {
		const target = this.app.vault.getAbstractFileByPath(proposal.targetNote);
		if (!(target instanceof TFile)) {
			new Notice(ui('目标笔记尚不存在或不可用。', 'The target note does not exist or is unavailable.'));
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(target);
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
