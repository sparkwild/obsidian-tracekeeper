import { App, Modal, Notice } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type {
	ApprovedWritebackPreview,
	ArchiveMemoryProposalPreview,
	ArchiveMemoryProposalReceipt,
} from './review-queue-controller';
import type { MemoryProposalRecord } from './review-view-model';
import type { ReviewProposalContext, ReviewTargetCandidate } from './review-context-model';
import { ui } from '../../ui/localization';

const isProposalTransitionConflict = (error: unknown): boolean =>
	error instanceof Error && error.name === 'ProposalTransitionConflictError';

const configureLiveStatus = (element: HTMLElement): void => {
	element.setAttr('role', 'status');
	element.setAttr('aria-live', 'polite');
	element.setAttr('aria-atomic', 'true');
};

export class ReviewQueueRequestRevisionModal extends Modal {
	private comment = '';
	private readonly editingExistingRevision: boolean;
	private submitting = false;
	private submitButton: HTMLButtonElement | null = null;
	private statusText: HTMLElement | null = null;
	private commentInput: HTMLTextAreaElement | null = null;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private proposal: MemoryProposalRecord,
		private onUpdated: () => Promise<void> | void
	) {
		super(app);
		this.comment = proposal.revisionComment;
		this.editingExistingRevision = proposal.approvalStatus === 'revision_requested';
	}

	onOpen(): void {
		void super.onOpen();
		this.titleEl.setText(this.editingExistingRevision
			? ui('编辑修改说明', 'Edit revision note')
			: ui('退回修改', 'Return for revision'));
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-review-revision-modal');

		contentEl.createEl('p', {
			text: this.editingExistingRevision
				? ui(
					'补充或修改需要调整的内容，供后续 Agent 理解问题并重新生成提案。',
					'Add or edit what should change so the next Agent can understand the issue and revise the proposal.'
				)
				: ui(
					'请说明需要修改的内容或发现的问题。提交后该提案将标记为“已退回修改”。',
					'Describe what should be changed. Submitting will mark this proposal as returned for revision.'
				),
			cls: 'tracekeeper-view__description',
		});

		const help = contentEl.createDiv({ cls: 'tracekeeper-review-revision-modal__help' });
		help.createEl('strong', { text: ui('修改说明', 'Revision note') });
		help.createEl('small', { text: ui('支持多行输入，至少填写一行内容。', 'Supports multiline input; at least one line is required.') });

		const textarea = contentEl.createEl('textarea', {
			text: this.comment,
			cls: 'tracekeeper-review-revision-modal__textarea',
		});
		textarea.value = this.comment;
		textarea.rows = 8;
		this.commentInput = textarea;
		textarea.addEventListener('input', () => {
			this.comment = textarea.value;
			this.updateSubmitState();
		});

		this.statusText = contentEl.createEl('p', {
			text: ui('请先填写修改说明。', 'Please enter a revision note.'),
			cls: 'tracekeeper-view__description',
		});
		configureLiveStatus(this.statusText);

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const submit = actions.createEl('button', {
			text: this.getSubmitLabel(),
			cls: 'mod-cta',
		});
		this.submitButton = submit;
		this.updateSubmitState();
		submit.addEventListener('click', () => {
			void (async () => {
				await this.submit();
			})();
		});
	}

	private updateSubmitState(): void {
		const hasComment = this.comment.trim().length > 0;
		if (this.submitButton) {
			this.submitButton.disabled = this.submitting || !hasComment;
			this.submitButton.setText(
				hasComment
					? this.getSubmitLabel()
					: ui('请输入修改说明', 'Enter revision note')
			);
		}
		if (this.statusText) {
			this.statusText.setText(
				hasComment
					? this.getReadyStatusText()
					: ui('请先填写修改说明。', 'Please enter a revision note.')
			);
		}
	}

	private getSubmitLabel(): string {
		return this.editingExistingRevision
			? ui('保存修改说明', 'Save revision note')
			: ui('确认退回修改', 'Return for revision');
	}

	private getReadyStatusText(): string {
		return this.editingExistingRevision
			? ui('保存后会更新该提案的修改说明。', "Save to update this proposal's revision note.")
			: ui('确认后会将该提案标记为“已退回修改”。', 'Confirm to mark this proposal as returned for revision.');
	}

	private async submit(): Promise<void> {
		const normalizedComment = this.comment.trim();
		if (!normalizedComment) {
			this.updateSubmitState();
			return;
		}
		if (!this.submitButton) {
			return;
		}

		this.submitting = true;
		this.submitButton.disabled = true;
		this.submitButton.setText(ui('提交中...', 'Submitting...'));

		try {
			await this.plugin.updateMemoryProposalStatus(this.proposal, 'revision_requested', {
				revisionComment: normalizedComment,
			});
			new Notice(ui('已退回修改。', 'Proposal returned for revision.'));
			await this.onUpdated();
			this.close();
		} catch (error) {
			console.error('tracekeeper failed to request revision', error);
			this.submitting = false;
			const conflict = isProposalTransitionConflict(error);
			const failureMessage = conflict
				? ui(
					'提案已发生变化；修改说明仍保留。请重新加载后再审核。',
					'The proposal changed; your revision note is preserved. Reload before reviewing again.'
				)
				: ui('退回修改失败。', 'Failed to return proposal for revision.');
			new Notice(failureMessage);
			if (conflict) {
				try {
					await this.onUpdated();
				} catch (refreshError) {
					console.error('tracekeeper failed to refresh conflicted review proposal', refreshError);
				}
			}
			this.updateSubmitState();
			this.statusText?.setText(failureMessage);
			this.commentInput?.focus();
		}
	}
}

export class ReviewQueueEditProposalModal extends Modal {
	private targetNote: string;
	private writebackContent: string;
	private saving = false;
	private saveButton: HTMLButtonElement | null = null;
	private targetContextEl: HTMLElement | null = null;
	private writebackInput: HTMLTextAreaElement | null = null;
	private statusText: HTMLElement | null = null;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private proposal: MemoryProposalRecord,
		private context: ReviewProposalContext | undefined,
		private onUpdated: () => Promise<void> | void,
		preferredTarget = ''
	) {
		super(app);
		this.targetNote = preferredTarget || proposal.targetNote;
		this.writebackContent = proposal.writebackContent;
	}

	onOpen(): void {
		void super.onOpen();
		this.titleEl.setText(ui('编辑变更提案', 'Edit change proposal'));
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-review-edit-modal');
		contentEl.createEl('p', {
			text: ui(
				'编辑只会更新变更提案，不会写入目标笔记。保存后仍需通过审核、预览并再次确认写入。',
				'Editing only updates the change proposal. Saving does not write to the target note; approval, preview, and a second confirmation are still required.'
			),
			cls: 'tracekeeper-view__description',
		});

		this.renderTargetPicker(contentEl);

		const writebackLabel = contentEl.createDiv({ cls: 'tracekeeper-review-edit-modal__label' });
		writebackLabel.createEl('strong', { text: ui('拟写入内容', 'Proposed writeback') });
		writebackLabel.createEl('small', {
			text: ui('可直接编辑 Markdown。留空保存后，该提案会显示为“信息不完整”。', 'Edit Markdown directly. Saving an empty value marks this proposal as incomplete.'),
		});
		const textarea = contentEl.createEl('textarea', {
			text: this.writebackContent,
			cls: 'tracekeeper-review-edit-modal__textarea',
		});
		textarea.value = this.writebackContent;
		textarea.rows = 12;
		this.writebackInput = textarea;
		textarea.addEventListener('input', () => {
			this.writebackContent = textarea.value;
		});

		this.statusText = contentEl.createEl('p', {
			cls: 'tracekeeper-view__description',
		});
		configureLiveStatus(this.statusText);

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: ui('取消', 'Cancel') }).addEventListener('click', () => this.close());
		this.saveButton = actions.createEl('button', {
			text: ui('保存提案草稿', 'Save proposal draft'),
			cls: 'mod-cta',
		});
		this.saveButton.addEventListener('click', () => {
			void this.save();
		});
	}

	private renderTargetPicker(container: HTMLElement): void {
		const section = container.createDiv({ cls: 'tracekeeper-review-edit-modal__target-section' });
		section.createEl('strong', { text: ui('目标笔记', 'Target note') });
		section.createEl('small', {
			text: ui(
				'只能选择当前 Vault 中已存在的 Memory/Wiki 候选，不接受手写任意路径。',
				'Choose only an existing Memory/Wiki candidate from this Vault. Arbitrary paths are not accepted.'
			),
		});

		const candidates = this.availableCandidates();
		if (candidates.length === 0) {
			section.createEl('p', {
				text: ui(
					'没有可用的受限目标候选。你仍可补全拟写入内容，然后退回修改，让 Agent 提供已验证目标。',
					'No constrained target candidate is available. You may complete the writeback content, then return the proposal for revision so the Agent can provide a verified target.'
				),
				cls: 'tracekeeper-review-inbox__candidate-warning',
			});
			if (this.targetNote) {
				section.createEl('code', { text: this.targetNote });
			}
			return;
		}

		const select = section.createEl('select', {
			cls: 'tracekeeper-review-edit-modal__target',
		}) as HTMLSelectElement;
		select.setAttr('aria-label', ui('选择受限目标笔记', 'Select constrained target note'));
		const empty = select.createEl('option', {
			text: ui('请选择 Memory/Wiki 目标', 'Select a Memory/Wiki target'),
			value: '',
		});
		empty.value = '';
		for (const candidate of candidates) {
			const option = select.createEl('option', {
				text: `${candidate.title || candidate.path} — ${candidate.path}`,
				value: candidate.path,
			});
			option.value = candidate.path;
		}
		select.value = candidates.some((candidate) => candidate.path === this.targetNote)
			? this.targetNote
			: '';
		this.targetNote = select.value;
		select.addEventListener('change', () => {
			this.targetNote = select.value;
			this.renderSelectedTargetContext();
		});

		this.targetContextEl = section.createDiv({ cls: 'tracekeeper-review-edit-modal__target-context' });
		this.renderSelectedTargetContext();
	}

	private availableCandidates(): ReviewTargetCandidate[] {
		const candidates = [...(this.context?.targetCandidates || [])];
		if (
			this.context?.target.exists
			&& this.context.target.path
			&& !candidates.some((candidate) => candidate.path === this.context?.target.path)
		) {
			candidates.unshift({
				path: this.context.target.path,
				title: this.context.target.title || this.context.target.path,
				kind: this.context.target.path.includes('/wiki/')
					? 'wiki'
					: this.context.target.path.includes('/memory/projects/')
						? 'project_memory'
						: 'global_memory',
				reason: 'current',
				excerpt: this.context.target.excerpt,
			});
		}
		return candidates;
	}

	private renderSelectedTargetContext(): void {
		if (!this.targetContextEl) {
			return;
		}
		this.targetContextEl.empty();
		const selected = this.availableCandidates().find((candidate) => candidate.path === this.targetNote);
		if (!selected) {
			this.targetContextEl.createEl('p', {
				text: ui('尚未选择目标。保存后提案仍会保持“待补全”。', 'No target selected. The proposal will remain in Needs completion after saving.'),
				cls: 'tracekeeper-view__description',
			});
			return;
		}
		this.targetContextEl.createEl('code', { text: selected.path });
		if (selected.excerpt) {
			this.targetContextEl.createEl('p', { text: selected.excerpt });
		}
	}

	private async save(): Promise<void> {
		if (!this.saveButton || this.saving) {
			return;
		}
		this.saving = true;
		this.saveButton.disabled = true;
		this.saveButton.setText(ui('保存中...', 'Saving...'));
		this.statusText?.setText(ui('正在保存提案草稿。', 'Saving proposal draft.'));
		try {
			await this.plugin.updateMemoryProposalDraft(this.proposal, {
				targetNote: this.targetNote,
				writebackContent: this.writebackContent,
			});
			new Notice(ui('提案草稿已保存；尚未写入目标笔记。', 'Proposal draft saved; the target note was not written.'));
			await this.onUpdated();
			this.close();
		} catch (error) {
			console.error('tracekeeper failed to update review proposal draft', error);
			this.saving = false;
			this.saveButton.disabled = false;
			this.saveButton.setText(ui('保存提案草稿', 'Save proposal draft'));
			const conflict = isProposalTransitionConflict(error);
			const failureMessage = conflict
				? ui(
					'提案已发生变化；你的草稿仍保留。请重新加载后再审核。',
					'The proposal changed; your draft is preserved. Reload before reviewing again.'
				)
				: ui('保存提案草稿失败。', 'Failed to save proposal draft.');
			new Notice(failureMessage);
			if (conflict) {
				try {
					await this.onUpdated();
				} catch (refreshError) {
					console.error('tracekeeper failed to refresh conflicted review proposal', refreshError);
				}
			}
			this.statusText?.setText(failureMessage);
			this.writebackInput?.focus();
		}
	}
}

export class ReviewQueueConfirmModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private message: string,
		private confirmLabel: string,
		private onConfirmed: () => Promise<void> | void
	) {
		super(app);
	}

	onOpen(): void {
		void super.onOpen();
		this.titleEl.setText(this.title);
		this.contentEl.empty();
		this.contentEl.createEl('p', { text: this.message });
		const status = this.contentEl.createEl('p', {
			cls: 'tracekeeper-view__description',
		});
		configureLiveStatus(status);
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', { text: this.confirmLabel, cls: 'mod-warning' });
		confirm.addEventListener('click', () => {
			void (async () => {
				confirm.disabled = true;
				try {
					await this.onConfirmed();
					this.close();
				} catch (error) {
					console.error('tracekeeper failed to confirm review queue action', error);
					confirm.disabled = false;
					const failureMessage = ui('操作失败，请重试。', 'Action failed. Try again.');
					status.setText(failureMessage);
					confirm.focus();
					new Notice(failureMessage);
				}
			})();
		});
		cancel.focus();
	}
}

export class ReviewQueueArchiveModal extends Modal {
	private preview: ArchiveMemoryProposalPreview | null = null;
	private committing = false;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private proposals: MemoryProposalRecord[],
		private onArchived: (receipt: ArchiveMemoryProposalReceipt) => Promise<void> | void
	) {
		super(app);
	}

	onOpen(): void {
		void super.onOpen();
		this.titleEl.setText(ui('预览并归档处理记录', 'Preview and archive processed records'));
		void this.renderPreview();
	}

	private async renderPreview(): Promise<void> {
		this.preview = null;
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-review-archive-modal');
		const status = contentEl.createEl('p', {
			text: ui(
				'正在读取最新记录并生成归档预览…',
				'Reading current records and preparing the archive preview…'
			),
			cls: 'tracekeeper-view__description',
		});
		configureLiveStatus(status);
		try {
			const preview = await this.plugin.previewArchiveMemoryProposals(this.proposals);
			this.renderReady(preview);
		} catch (error) {
			console.error('tracekeeper failed to prepare archive preview', error);
			status.setText(
				ui(
					'无法生成归档预览。记录可能已变化、标识不唯一或目标已存在；请关闭后刷新审核视图再试。',
					'Could not prepare the archive preview. A record may have changed, an identity may be ambiguous, or a destination may already exist. Close this dialog, refresh review, and try again.'
				)
			);
			const actions = contentEl.createDiv({ cls: 'modal-button-container' });
			const close = actions.createEl('button', { text: ui('关闭', 'Close') });
			close.addEventListener('click', () => this.close());
			close.focus();
		}
	}

	renderReady(preview: ArchiveMemoryProposalPreview): void {
		this.preview = preview;
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-review-archive-modal');
		contentEl.createEl('p', {
			text: ui(
				'仅移动下列当前记录到 Tracekeeper 归档目录。确认时会重新校验记录、目标和受管引用；任何漂移都会在移动前拒绝。',
				'Only the current records listed below will move to the Tracekeeper archive folder. Confirmation revalidates the records, destinations, and managed references; any drift is rejected before a new move.'
			),
			cls: 'tracekeeper-view__description',
		});
		const list = contentEl.createEl('ul', {
			cls: 'tracekeeper-review-archive-modal__items',
		});
		for (const item of preview.items) {
			const row = list.createEl('li');
			row.createEl('code', {
				text: `${item.sourcePath} → ${item.destinationPath}`,
			});
			row.createEl('small', {
				text: ui(
					`提案 ${item.proposalId}；${item.managedReferences.length} 个受管引用`,
					`Proposal ${item.proposalId}; ${item.managedReferences.length} managed reference(s)`
				),
			});
			if (item.managedReferences.length > 0) {
				const references = row.createEl('ul');
				for (const path of item.managedReferences) {
					references.createEl('li').createEl('code', { text: path });
				}
			}
		}
		if (preview.conflicts.length > 0) {
			const conflicts = contentEl.createDiv({
				cls: 'tracekeeper-review-archive-modal__conflicts',
			});
			conflicts.createEl('strong', {
				text: ui('必须先解决的冲突', 'Conflicts to resolve first'),
			});
			const conflictList = conflicts.createEl('ul');
			for (const conflict of preview.conflicts) {
				conflictList.createEl('li', {
					text: `${conflict.kind}: ${conflict.path}`,
				});
			}
		}
		const status = contentEl.createEl('p', {
			text: preview.conflicts.length > 0
				? ui(
					'存在冲突，归档未启用。关闭对话框并解决冲突后重新生成预览。',
					'Archive is disabled while conflicts remain. Close this dialog, resolve them, and prepare a new preview.'
				)
				: ui(
					'预览已就绪。归档会保留稳定提案标识和历史关联；用户归档操作不写入 Agent 活动。',
					'Preview ready. Archive preserves stable proposal identity and history associations; human archive actions do not create Agent activity.'
				),
			cls: 'tracekeeper-view__description',
		});
		configureLiveStatus(status);
		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			text: ui('确认归档', 'Archive items'),
			cls: 'mod-warning',
		});
		confirm.disabled = preview.conflicts.length > 0;
		confirm.addEventListener('click', () => {
			void this.commit(preview, confirm, status);
		});
		cancel.focus();
	}

	private async commit(
		preview: ArchiveMemoryProposalPreview,
		confirm: HTMLButtonElement,
		status: HTMLElement
	): Promise<void> {
		if (this.committing || this.preview !== preview) {
			return;
		}
		this.committing = true;
		confirm.disabled = true;
		status.setText(ui('正在重新校验并归档…', 'Revalidating and archiving…'));
		try {
			const receipt = await this.plugin.commitArchiveMemoryProposals(preview);
			await this.onArchived(receipt);
			this.close();
		} catch (error) {
			console.error('tracekeeper failed to archive reviewed records', error);
			this.committing = false;
			confirm.disabled = preview.conflicts.length > 0;
			status.setText(
				ui(
					'归档未完成，且不会覆盖目标。如果记录发生变化，请关闭后刷新并生成新预览；如果移动后发生中断，可在本对话框中重试同一确认以安全续接。',
					'Archive did not complete and no destination is overwritten. If records changed, close, refresh, and prepare a new preview. If an interruption happened after a move, retry this same confirmation to resume safely.'
				)
			);
			confirm.focus();
			new Notice(
				ui(
					'归档未完成，请查看恢复说明。',
					'Archive did not complete. Review the recovery guidance.'
				)
			);
		}
	}
}

export class ApprovedWritebackApplyModal extends Modal {
	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private proposal: MemoryProposalRecord,
		private onApplied: () => void
	) {
		super(app);
	}

	onOpen(): void {
		void super.onOpen();
		this.titleEl.setText(ui('预览并写入', 'Preview and apply'));
		void this.renderPreview();
	}

	private async renderPreview(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		const loading = contentEl.createEl('p', {
			text: ui('正在生成写回预览...', 'Generating writeback preview...'),
		});
		configureLiveStatus(loading);
		try {
			const preview = await this.plugin.previewApprovedWriteback(this.proposal);
			this.renderReady(preview);
		} catch (error) {
			console.error('tracekeeper failed to preview approved writeback', error);
			contentEl.empty();
			const failure = contentEl.createEl('p', {
				text: ui('生成写入预览失败，请检查该提案是否仍处于审核通过状态。', 'Failed to generate writeback preview. Check whether this proposal is still approved.'),
			});
			configureLiveStatus(failure);
			const actions = contentEl.createDiv({ cls: 'modal-button-container' });
			const close = actions.createEl('button', { text: ui('关闭', 'Close') });
			close.addEventListener('click', () => this.close());
			close.focus();
		}
	}

	private renderReady(preview: ApprovedWritebackPreview): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', {
			text: ui('请确认以下内容将写入目标笔记。', 'Confirm the content that will be written to the target note.'),
		});
		const facts = contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(facts, ui('提案', 'Proposal'), preview.proposal_id || this.proposal.proposalId);
		this.renderDetail(facts, ui('目标笔记', 'Target note'), preview.target_note || this.proposal.targetNote);
		this.renderDetail(facts, ui('涉及文件', 'Touched notes'), (preview.touched_notes || []).join(', '));
		const previewBox = contentEl.createEl('pre');
		previewBox.setText(preview.writeback_preview || '');

		const status = contentEl.createEl('p', {
			cls: 'tracekeeper-view__description',
		});
		configureLiveStatus(status);

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel'), cls: 'mod-warning' });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', { text: ui('确认写入', 'Confirm apply'), cls: 'mod-cta' });
		confirm.addEventListener('click', () => {
			void (async () => {
				confirm.disabled = true;
				confirm.setText(ui('写回中...', 'Applying...'));
				status.setText(ui('正在写入目标笔记。', 'Applying change to the target note.'));
				try {
					await this.plugin.applyApprovedWriteback(this.proposal, preview);
					new Notice(ui('已写入目标笔记。', 'Change applied to the target note.'));
					this.onApplied();
					this.close();
				} catch (error) {
					console.error('tracekeeper failed to apply approved writeback', error);
					const failureMessage = ui(
						'写入失败。若操作曾中断可重试；若内容已变化，请关闭并重新生成预览。',
						'Apply failed. Retry after an interruption, or close and generate a fresh preview if content changed.'
					);
					new Notice(failureMessage);
					confirm.disabled = false;
					confirm.setText(ui('确认写入', 'Confirm apply'));
					status.setText(failureMessage);
					confirm.focus();
				}
			})();
		});
		cancel.focus();
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value || ui('未指定', 'Not specified') });
	}
}
