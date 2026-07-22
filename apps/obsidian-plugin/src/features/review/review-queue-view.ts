import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { MemoryProposalRecord, MemoryProposalStatus, ReviewQueueItemType } from './review-view-model';
import {
	REVIEW_QUEUE_FILTERS,
	REVIEW_QUEUE_PATH,
	isReviewQueueArchiveCandidate,
	isReviewQueueFilterMatch,
	isReviewQueuePendingStatus,
	isReviewQueueRevisionRequestedStatus,
	memoryProposalStatusLabel,
	reviewQueueFilterLabel,
	type MemoryReviewQueueSnapshot,
	type ReviewQueueDisplaySummary,
	type ReviewQueueFilter,
} from './review-queue-model';
import { ReviewQueueRequestRevisionModal } from './review-modals';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_REVIEW_QUEUE_VIEW } from '../../ui/view-types';
import { trimText } from '../shared/markdown-record-parser';

export class TracekeeperReviewQueueView extends ItemView {
	private activeFilter: ReviewQueueFilter = 'pending';
	private isSelectionMode = false;
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
		return ui('审核队列', 'Review queue');
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
		heading.createEl('h2', { text: ui('审核队列', 'Review queue'), cls: 'tracekeeper-view__title' });
		heading.createEl('p', {
			text: `${ui('最后刷新', 'Last refreshed')}: ${this.plugin.formatDisplayTime(Date.parse(snapshot.updatedAt))}`,
			cls: 'tracekeeper-view__description',
		});

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
					new Notice(ui('审核队列已刷新。', 'Review queue refreshed.'));
				} catch (error) {
					console.error('tracekeeper failed to refresh review queue view', error);
					refreshButton.disabled = false;
					refreshButton.setText(ui('刷新', 'Refresh'));
					new Notice(ui('刷新审核队列失败。', 'Failed to refresh review queue.'));
				}
			})();
		});

		if (snapshot.missingReviewQueueFolder) {
			this.isSelectionMode = false;
			this.selectedProposalPaths.clear();
			contentEl.createEl('p', {
				text: ui(
					'还没有审核队列。请先初始化知识库文件结构，之后 AI 提交、任务收尾、图谱建议或结构迁移冲突会出现在这里。',
					'No review queue yet. Initialize the Tracekeeper file structure first; AI submissions, task closeouts, graph suggestions, or structure-migration conflicts will appear here afterward.'
				),
				cls: 'tracekeeper-view__description',
			});
			return;
		}

		if (snapshot.proposals.length === 0) {
			this.isSelectionMode = false;
			this.selectedProposalPaths.clear();
			this.renderEmptyState(
				contentEl,
				ui('还没有待审核项。', 'No review items waiting yet.'),
				ui(
					'AI 提交、任务收尾、图谱建议或结构迁移冲突产生需要确认的候选项后，会显示在这里。',
					'Items appear here after an AI submission, task closeout, graph suggestion, or structure-migration conflict needs confirmation.'
				)
			);
			return;
		}

		const selectionButton = actions.createEl('button', {
			text: this.isSelectionMode ? ui('退出选择', 'Exit select') : ui('批量选择', 'Select'),
			cls: this.isSelectionMode ? 'mod-warning' : '',
		});
		selectionButton.addEventListener('click', () => {
			this.isSelectionMode = !this.isSelectionMode;
			this.selectedProposalPaths.clear();
			void this.render(snapshot);
		});

		const counts = this.countByFilter(snapshot.proposals);
		const tabs = contentEl.createDiv({ cls: 'tracekeeper-filter-tabs' });
		for (const filter of REVIEW_QUEUE_FILTERS) {
			const label = reviewQueueFilterLabel(filter);
			const count = filter === 'all' ? counts.all : counts[filter];
			const button = tabs.createEl('button', {
				text: `${label} (${count})`,
				cls: this.activeFilter === filter ? 'is-active' : '',
			});
			button.addEventListener('click', () => {
				this.activeFilter = filter;
				this.selectedProposalPaths.clear();
				void this.render(snapshot);
			});
		}

		const visibleProposals = snapshot.proposals.filter((proposal) =>
			isReviewQueueFilterMatch(proposal.approvalStatus, this.activeFilter)
		);
		this.renderSelectionControls(contentEl, visibleProposals);
		const grid = contentEl.createDiv({ cls: 'tracekeeper-proposal-grid' });
		if (visibleProposals.length === 0) {
			this.renderEmptyState(
				grid,
				ui('当前筛选下没有内容。', 'No items match this filter.'),
				ui('切换筛选，或等待 AI 助手提出新的审核项。', 'Switch filters or wait for your AI assistant to propose a new review item.')
			);
			return;
		}

		for (const group of this.groupProposalWorkbenchItems(visibleProposals)) {
			const section = grid.createDiv({ cls: 'tracekeeper-proposal-group' });
			const groupHeader = section.createDiv({ cls: 'tracekeeper-proposal-group__header' });
			groupHeader.createEl('strong', { text: group.label });
			groupHeader.createEl('span', { text: ui(`${group.items.length} 条`, `${group.items.length} items`), cls: 'tracekeeper-badge tracekeeper-badge--muted' });
			for (const proposal of group.items) {
				this.renderProposalCard(section, proposal);
			}
		}
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadMemoryReviewQueueSnapshot();
		await this.render(snapshot);
	}

	private groupByStatus(proposals: MemoryProposalRecord[]): Record<string, MemoryProposalRecord[]> {
		const grouped: Record<string, MemoryProposalRecord[]> = {};
		for (const proposal of proposals) {
			const status = proposal.approvalStatus || 'pending';
			if (!grouped[status]) {
				grouped[status] = [];
			}
			grouped[status].push(proposal);
		}
		return grouped;
	}

	private countByFilter(proposals: MemoryProposalRecord[]): Record<ReviewQueueFilter, number> {
		const counts: Record<ReviewQueueFilter, number> = {
			pending: 0,
			revision_requested: 0,
			all: proposals.length,
		};
		for (const proposal of proposals) {
			if (isReviewQueuePendingStatus(proposal.approvalStatus)) {
				counts.pending += 1;
			}
			if (isReviewQueueRevisionRequestedStatus(proposal.approvalStatus)) {
				counts.revision_requested += 1;
			}
		}
		return counts;
	}

	private getSelectedVisibleProposals(visibleProposals: MemoryProposalRecord[]): MemoryProposalRecord[] {
		return visibleProposals.filter((proposal) => this.selectedProposalPaths.has(proposal.path));
	}

	private updateProposalSelection(proposalPath: string, isSelected: boolean): void {
		if (isSelected) {
			this.selectedProposalPaths.add(proposalPath);
			return;
		}
		this.selectedProposalPaths.delete(proposalPath);
	}

	private renderSelectionControls(container: HTMLElement, visibleProposals: MemoryProposalRecord[]): void {
		if (!this.isSelectionMode) {
			return;
		}

		const selected = this.getSelectedVisibleProposals(visibleProposals);
		const pending = selected.filter((proposal) => isReviewQueuePendingStatus(proposal.approvalStatus));
		const archiveCandidates = selected.filter((proposal) => isReviewQueueArchiveCandidate(proposal));

		const toolbar = container.createDiv({ cls: 'tracekeeper-batch-toolbar' });
		const countText = selected.length === 1 ? ui('已选择 1 项', 'Selected 1 item') : ui(`已选择 ${selected.length} 项`, `Selected ${selected.length} items`);
		toolbar.createEl('span', { text: countText, cls: 'tracekeeper-badge tracekeeper-badge--muted' });

		if (pending.length === 0 && archiveCandidates.length === 0) {
			return;
		}

		if (pending.length > 0) {
			const reject = toolbar.createEl('button', {
				text: ui(`批量拒绝 (${pending.length})`, `Reject selected (${pending.length})`),
				cls: 'mod-warning',
			});
			reject.addEventListener('click', () => {
				void this.batchUpdate(pending, 'rejected');
			});
		}

		if (archiveCandidates.length > 0) {
			const archive = toolbar.createEl('button', {
				text: ui(`归档 (${archiveCandidates.length})`, `Archive selected (${archiveCandidates.length})`),
			});
			archive.addEventListener('click', () => {
				void this.batchArchive(archiveCandidates);
			});
		}
	}

	private groupProposalWorkbenchItems(proposals: MemoryProposalRecord[]): Array<{ label: string; items: MemoryProposalRecord[] }> {
		const groups = new Map<string, MemoryProposalRecord[]>();
		for (const proposal of proposals) {
			const labelParts = [
				this.reviewQueueItemTypeLabel(proposal.classification),
				memoryProposalStatusLabel(proposal.approvalStatus),
			];
			if (this.isMeaningfulReviewQueueValue(proposal.relatedProject)) {
				labelParts.push(proposal.relatedProject);
			}
			const label = labelParts.join(' · ');
			const items = groups.get(label) || [];
			items.push(proposal);
			groups.set(label, items);
		}
		return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
	}

	private reviewQueueItemTypeLabel(classification: ReviewQueueItemType): string {
		switch (classification) {
			case 'memory_proposal':
				return ui('记忆提案', 'Memory proposal');
			case 'legacy_migration_review':
				return ui('结构迁移审核', 'Legacy migration review');
			case 'other_review_item':
			default:
				return ui('其他审核项', 'Other review item');
		}
	}

	private async batchUpdate(proposals: MemoryProposalRecord[], status: MemoryProposalStatus): Promise<void> {
		try {
			for (const proposal of proposals) {
				await this.plugin.updateMemoryProposalStatus(proposal, status);
			}
			new Notice(ui(
				`已更新 ${proposals.length} 条审核项。`,
				`Updated ${proposals.length} review items.`
			));
			this.selectedProposalPaths.clear();
			await this.refresh();
		} catch (error) {
			console.error('tracekeeper failed to batch update proposals', error);
			new Notice(ui('批量更新失败。', 'Batch update failed.'));
		}
	}

	private async batchArchive(proposals: MemoryProposalRecord[]): Promise<void> {
		try {
			const moved = await this.plugin.archiveMemoryProposals(proposals);
			new Notice(ui(`已归档 ${moved} 条审核项。`, `Archived ${moved} review items.`));
			this.selectedProposalPaths.clear();
			await this.refresh();
		} catch (error) {
			console.error('tracekeeper failed to archive proposals', error);
			new Notice(ui('归档审核项失败。', 'Failed to archive review items.'));
		}
	}

	private renderProposalCard(container: HTMLElement, proposal: MemoryProposalRecord): void {
		const display = this.buildReviewQueueDisplaySummary(proposal);
		const card = container.createDiv({ cls: 'tracekeeper-card tracekeeper-proposal-card' });
		const header = card.createDiv({ cls: 'tracekeeper-card__header tracekeeper-proposal-card__header' });
		const title = header.createDiv({ cls: 'tracekeeper-proposal-card__title' });

		if (this.isSelectionMode) {
			const checkboxContainer = title.createDiv({ cls: 'tracekeeper-proposal-select' });
			const checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.checked = this.selectedProposalPaths.has(proposal.path);
			checkbox.addEventListener('change', () => {
				this.updateProposalSelection(proposal.path, checkbox.checked);
				void this.refresh();
			});
			checkboxContainer.appendChild(checkbox);
		}

		const titleBody = title.createDiv({ cls: 'tracekeeper-proposal-card__title-body' });
		titleBody.createEl('span', {
			text: this.reviewQueueItemTypeLabel(proposal.classification),
			cls: 'tracekeeper-proposal-card__eyebrow',
		});
		titleBody.createEl('h4', { text: display.actionTitle });
		titleBody.createEl('small', {
			text: display.actionDetail,
			cls: 'tracekeeper-proposal-card__subject',
		});

		const badges = header.createDiv({ cls: 'tracekeeper-badge-row tracekeeper-proposal-card__badges' });
		badges.createEl('span', { text: memoryProposalStatusLabel(proposal.approvalStatus), cls: 'tracekeeper-badge' });
		if (this.isMeaningfulReviewQueueValue(proposal.riskLevel)) {
			badges.createEl('span', {
				text: this.plugin.formatRiskLabel(proposal.riskLevel),
				cls: `tracekeeper-badge tracekeeper-badge--risk-${proposal.riskLevel.toLowerCase()}`,
			});
		}

		const targetGrid = card.createDiv({ cls: 'tracekeeper-review-target-grid' });
		this.renderReviewQueueFocusItem(targetGrid, ui('目标文件', 'Target file'), display.targetFile);
		this.renderReviewQueueFocusItem(targetGrid, ui('修改位置', 'Position'), display.targetPosition);

		const changePanel = card.createDiv({ cls: 'tracekeeper-review-focus-panel tracekeeper-review-focus-panel--change' });
		changePanel.createEl('span', { text: ui('要修改什么', 'Proposed change') });
		changePanel.createEl('pre', {
			text: display.changePreview,
			cls: display.hasWritebackContent ? 'tracekeeper-review-change-preview' : 'tracekeeper-review-change-preview tracekeeper-review-change-preview--empty',
		});

		const reasonPanel = card.createDiv({ cls: 'tracekeeper-review-focus-panel tracekeeper-review-focus-panel--reason' });
		reasonPanel.createEl('span', { text: ui('为什么修改', 'Reason') });
		reasonPanel.createEl('strong', { text: display.reason });

		if (proposal.approvalStatus === 'revision_requested' && proposal.revisionComment) {
			const revisionPanel = card.createDiv({ cls: 'tracekeeper-revision-comment' });
			revisionPanel.createEl('strong', { text: ui('修订说明', 'Revision comment') });
			revisionPanel.createEl('pre', {
				text: proposal.revisionComment,
				cls: 'tracekeeper-revision-comment__content',
			});
			if (proposal.revisionRequestedAt || proposal.revisionRequestedBy) {
				const by = proposal.revisionRequestedBy || ui('用户', 'User');
				const at = proposal.revisionRequestedAt || ui('未知时间', 'Unknown time');
				revisionPanel.createEl('small', {
					text: `${ui('由', 'By')}: ${by} • ${ui('时间', 'Time')}: ${at}`,
					cls: 'tracekeeper-view__description',
				});
			}
		}

		const source = card.createDiv({ cls: 'tracekeeper-review-source-line' });
		source.createEl('small', { text: display.sourceLine });

		this.renderProposalActions(card, proposal);
	}

	private renderReviewQueueFocusItem(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-review-focus-item' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}

	private buildReviewQueueDisplaySummary(proposal: MemoryProposalRecord): ReviewQueueDisplaySummary {
		const targetFile = this.reviewQueueTargetFile(proposal);
		const targetPosition = this.reviewQueueTargetPosition(proposal);
		const reason = this.reviewQueueCardReason(proposal);
		const evidenceCount = proposal.evidence.length;
		const sourceParts = [
			this.isMeaningfulReviewQueueValue(proposal.relatedProject) ? `${ui('项目', 'Project')}: ${proposal.relatedProject}` : '',
			this.isMeaningfulReviewQueueValue(proposal.taskId) ? `${ui('任务', 'Task')}: ${proposal.taskId}` : '',
			evidenceCount > 0 ? ui(`证据 ${evidenceCount} 条`, `${evidenceCount} evidence refs`) : '',
			`${ui('审核文件', 'Queue file')}: ${this.compactReviewQueuePath(proposal.path)}`,
		].filter(Boolean);

		switch (proposal.classification) {
			case 'memory_proposal': {
				const hasWritebackContent = proposal.writebackContent.trim().length > 0;
				return {
					actionTitle: ui('写入一条记忆', 'Write one memory update'),
					actionDetail: hasWritebackContent
						? ui('Agent 建议把下面内容写入目标笔记。', 'The agent wants to write the content below into the target note.')
						: ui('这个提案缺少可写入内容，建议要求修订。', 'This proposal has no writable content; request a revision.'),
					targetFile,
					targetPosition,
					changePreview: hasWritebackContent
						? trimText(proposal.writebackContent, 700)
						: ui('没有可写入内容。请点击“修订”，让 Agent 补充要写入的具体内容。', 'No writable content. Click Revise and ask the agent to provide the exact content to write.'),
					reason,
					sourceLine: sourceParts.join(' · '),
					hasWritebackContent,
				};
			}
			case 'legacy_migration_review':
				return {
					actionTitle: ui('确认结构迁移差异', 'Confirm structure migration difference'),
					actionDetail: ui('Tracekeeper 发现旧目录迁移到目标笔记时存在内容差异。', 'Tracekeeper found a content difference while migrating legacy notes.'),
					targetFile,
					targetPosition,
					changePreview: this.reviewQueueMigrationPreview(proposal),
					reason,
					sourceLine: sourceParts.join(' · '),
					hasWritebackContent: true,
				};
			case 'other_review_item':
			default:
				return {
					actionTitle: ui('确认审核项', 'Confirm review item'),
					actionDetail: ui('该项需要你确认处理结果。', 'This item needs your confirmation.'),
					targetFile,
					targetPosition,
					changePreview: trimText(proposal.snippet, 700) || ui('没有摘要。', 'No summary.'),
					reason,
					sourceLine: sourceParts.join(' · '),
					hasWritebackContent: true,
				};
		}
	}

	private reviewQueueTargetFile(proposal: MemoryProposalRecord): string {
		if (this.isMeaningfulReviewQueueValue(proposal.targetNote)) {
			return proposal.targetNote;
		}
		if (proposal.classification === 'memory_proposal') {
			return ui('未指定目标笔记', 'No target note specified');
		}
		return this.compactReviewQueuePath(proposal.path);
	}

	private reviewQueueTargetPosition(proposal: MemoryProposalRecord): string {
		if (proposal.classification === 'memory_proposal') {
			return this.isMeaningfulReviewQueueValue(proposal.targetNote)
				? ui('追加到目标笔记末尾', 'Append to the end of the target note')
				: ui('无法写入：缺少目标笔记', 'Cannot write: target note is missing');
		}
		if (proposal.classification === 'legacy_migration_review') {
			return ui('目标笔记现有内容，需要人工确认差异', 'Existing target note content; confirm the difference manually');
		}
		return ui('审核文件中记录的位置', 'Position recorded in the review file');
	}

	private reviewQueueMigrationPreview(proposal: MemoryProposalRecord): string {
		const reason = this.reviewQueueCardReason(proposal);
		if (reason) {
			return ui(
				`检查目标笔记和迁移来源的差异。确认后只会标记该审核项已处理，不会自动覆盖目标笔记。\n\n${reason}`,
				`Check the difference between the target note and migrated source. Confirming only marks this item handled; it will not overwrite the target note.\n\n${reason}`
			);
		}
		return ui(
			'检查目标笔记和迁移来源的差异。确认后只会标记该审核项已处理，不会自动覆盖目标笔记。',
			'Check the difference between the target note and migrated source. Confirming only marks this item handled; it will not overwrite the target note.'
		);
	}

	private reviewQueueCardReason(proposal: MemoryProposalRecord): string {
		if (proposal.classification === 'memory_proposal') {
			const kindLabel = this.reviewQueueProposalKindLabel(proposal.proposalKind);
			return ui(
				`任务结束时，Agent 提取了${kindLabel}，认为这部分内容值得保存，方便后续任务召回。`,
				`At task closeout, the agent extracted ${kindLabel} and marked it worth saving for future recall.`
			);
		}

		const explicitReason = this.extractReviewQueueReason(proposal.snippet);
		if (explicitReason) {
			return this.localizeKnownReviewQueueReason(explicitReason);
		}

		switch (proposal.classification) {
			case 'legacy_migration_review':
				return ui('结构迁移发现需要人工确认的差异。', 'Structure migration found a difference that needs review.');
			case 'other_review_item':
			default:
				return ui('该项等待你确认处理结果。', 'This item is waiting for confirmation.');
		}
	}

	private reviewQueueProposalKindLabel(kind: string): string {
		const normalized = kind.trim().toLowerCase().replace(/-/g, '_');
		switch (normalized) {
			case 'task_decision':
				return ui('任务决策', 'a task decision');
			case 'solution_change':
				return ui('方案调整', 'a solution change');
			case 'lesson_learned':
				return ui('经验教训', 'a lesson learned');
			case 'user_preference':
				return ui('用户偏好', 'a user preference');
			case 'project_next_action':
				return ui('项目下一步', 'a project next action');
			case 'memory_candidate':
				return ui('记忆候选', 'a memory candidate');
			default:
				return ui('记忆候选', 'a memory candidate');
		}
	}

	private extractReviewQueueReason(snippet: string): string {
		const normalized = snippet.replace(/\r\n/g, '\n').trim();
		if (!normalized) {
			return '';
		}
		const reasonMatch = normalized.match(/(?:^|\n)\s*-\s*Reason:\s*(.+?)(?:\n|$)/i);
		if (reasonMatch?.[1]) {
			return reasonMatch[1].trim();
		}
		return normalized.replace(/^[-\s]+/, '').trim();
	}

	private localizeKnownReviewQueueReason(reason: string): string {
		const normalized = reason.trim().replace(/\.$/, '').toLowerCase();
		if (normalized === 'target already exists with different content') {
			return ui('目标笔记已存在不同内容。', 'Target already exists with different content.');
		}
		return reason;
	}

	private compactReviewQueuePath(path: string): string {
		const normalized = path.replace(/\\/g, '/');
		const prefix = `${REVIEW_QUEUE_PATH}/`;
		if (normalized.startsWith(prefix)) {
			return normalized.slice(prefix.length);
		}
		return normalized;
	}

	private isMeaningfulReviewQueueValue(value: string): boolean {
		const normalized = value.trim().toLowerCase();
		return Boolean(
			normalized &&
			!['unknown', 'none', 'not linked', 'not specified', '无', '未知', '未关联', '未指定'].includes(normalized)
		);
	}

	private renderProposalActions(card: HTMLElement, proposal: MemoryProposalRecord): void {
		const actionRow = card.createDiv({ cls: 'tracekeeper-action-row' });
		const open = actionRow.createEl('button', {
			text: ui('打开文件', 'Open file'),
		});
		open.addEventListener('click', () => {
			void this.openReviewQueueItem(proposal);
		});

		if (proposal.approvalStatus === 'pending') {
			const isMemoryProposal = proposal.classification === 'memory_proposal';
			const hasWritebackInputs = Boolean(
				proposal.targetNote.trim() && proposal.writebackContent.trim()
			);
			const approveLabel = isMemoryProposal
				? ui('批准并写入', 'Approve and write')
				: ui('确认', 'Confirm');
			const approve = actionRow.createEl('button', {
				text: approveLabel,
				cls: isMemoryProposal ? 'mod-cta' : 'tracekeeper-confirm-button',
			});
			if (isMemoryProposal && !hasWritebackInputs) {
				approve.disabled = true;
			}
			const reject = actionRow.createEl('button', {
				text: ui('拒绝', 'Reject'),
				cls: 'mod-warning',
			});
			const requestRevision = actionRow.createEl('button', {
				text: ui('修订', 'Revise'),
				cls: 'tracekeeper-revision-button',
			});

			const actionButtons = [approve, reject, requestRevision];
			const setActionButtonsDisabled = (disabled: boolean): void => {
				for (const button of actionButtons) {
					button.disabled = disabled;
				}
			};
			const updateStatus = async (status: MemoryProposalStatus) => {
				setActionButtonsDisabled(true);
				try {
					await this.plugin.updateMemoryProposalStatus(proposal, status);
					new Notice(ui(
						`已更新为：${memoryProposalStatusLabel(status)}。`,
						`Updated to ${memoryProposalStatusLabel(status)}.`
					));
					await this.refresh();
				} catch (error) {
					console.error('tracekeeper failed to update proposal status', error);
					new Notice(ui('更新审核状态失败。', 'Failed to update review status.'));
				} finally {
					for (const button of actionButtons) {
						if (!isMemoryProposal || button !== approve || hasWritebackInputs) {
							button.disabled = false;
						}
					}
				}
			};
			const approveAndWrite = async () => {
				setActionButtonsDisabled(true);
				try {
					await this.plugin.updateMemoryProposalStatus(proposal, 'approved');
					try {
						await this.plugin.applyApprovedWriteback(proposal);
						new Notice(ui('已批准并写入。', 'Approved and writeback applied.'));
					} catch (error) {
						console.error('tracekeeper failed to apply memory proposal writeback', error);
						new Notice(ui('写回失败，请稍后重试。', 'Writeback failed. Please retry.'));
					}
					await this.refresh();
				} catch (error) {
					console.error('tracekeeper failed to approve and writeback review item', error);
					new Notice(ui('批准失败。', 'Failed to approve proposal.'));
				} finally {
					setActionButtonsDisabled(false);
					if (isMemoryProposal && !hasWritebackInputs) {
						approve.disabled = true;
					}
				}
			};

			approve.addEventListener('click', () => void (isMemoryProposal ? approveAndWrite() : updateStatus('approved')));
			reject.addEventListener('click', () => void updateStatus('rejected'));
			requestRevision.addEventListener('click', () => {
				new ReviewQueueRequestRevisionModal(this.app, this.plugin, proposal, () => {
					void this.refresh();
				}).open();
			});
		} else if (proposal.approvalStatus === 'revision_requested') {
			const editRevision = actionRow.createEl('button', {
				text: proposal.revisionComment
					? ui('编辑修订说明', 'Edit revision comment')
					: ui('补充修订说明', 'Add revision comment'),
			});
			const cancelRevision = actionRow.createEl('button', {
				text: ui('取消修订', 'Cancel revision'),
			});
			editRevision.addEventListener('click', () => {
				new ReviewQueueRequestRevisionModal(this.app, this.plugin, proposal, () => {
					void this.refresh();
				}).open();
			});
			cancelRevision.addEventListener('click', () => {
				void (async () => {
					editRevision.disabled = true;
					cancelRevision.disabled = true;
					try {
						await this.plugin.updateMemoryProposalStatus(proposal, 'pending', {
							clearRevision: true,
						});
						new Notice(ui('已取消修订，回到待审核。', 'Revision canceled; moved back to pending.'));
						await this.refresh();
					} catch (error) {
						console.error('tracekeeper failed to cancel revision request', error);
						new Notice(ui('取消修订失败。', 'Failed to cancel revision.'));
						editRevision.disabled = false;
						cancelRevision.disabled = false;
					}
				})();
			});
		} else if (proposal.approvalStatus === 'approved' && proposal.classification === 'memory_proposal') {
			const apply = actionRow.createEl('button', {
				text: ui('继续写入', 'Continue writeback'),
				cls: 'mod-cta',
			});
			if (!proposal.targetNote || !proposal.writebackContent) {
				apply.disabled = true;
			}
			apply.addEventListener('click', () => {
				void (async () => {
					apply.disabled = true;
					try {
						await this.plugin.applyApprovedWriteback(proposal);
						new Notice(ui('已应用写回。', 'Approved writeback applied.'));
						await this.refresh();
					} catch (error) {
						console.error('tracekeeper failed to apply approved writeback', error);
						new Notice(ui('应用写回失败。', 'Failed to apply writeback.'));
						await this.refresh();
					}
				})();
			});
		}
	}

	private async openReviewQueueItem(proposal: MemoryProposalRecord): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(proposal.path);
		if (!(file instanceof TFile)) {
			new Notice(ui('没有找到审核项文件。', 'Review item file was not found.'));
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
