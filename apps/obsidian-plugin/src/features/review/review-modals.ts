import { App, Modal, Notice } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { ApprovedWritebackPreview } from './review-queue-controller';
import type { MemoryProposalRecord } from './review-view-model';
import { ui } from '../../ui/localization';

export class ReviewQueueRequestRevisionModal extends Modal {
	private comment = '';
	private readonly editingExistingRevision: boolean;
	private submitting = false;
	private submitButton: HTMLButtonElement | null = null;
	private statusText: HTMLElement | null = null;

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
			? ui('编辑修订说明', 'Edit revision comment')
			: ui('要求修订', 'Request revision'));
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
					'请说明需要修改的内容或发现的问题。提交后该提案将标记为“需修订”。',
					'Describe what should be changed. Submitting will mark this proposal as Revision requested.'
				),
			cls: 'tracekeeper-view__description',
		});

		const help = contentEl.createDiv({ cls: 'tracekeeper-review-revision-modal__help' });
		help.createEl('strong', { text: ui('修订说明', 'Revision comment') });
		help.createEl('small', { text: ui('支持多行输入，至少填写一行内容。', 'Supports multiline input; at least one line is required.') });

		const textarea = contentEl.createEl('textarea', {
			text: this.comment,
			cls: 'tracekeeper-review-revision-modal__textarea',
		});
		textarea.value = this.comment;
		textarea.rows = 8;
		textarea.addEventListener('input', () => {
			this.comment = textarea.value;
			this.updateSubmitState();
		});

		this.statusText = contentEl.createEl('p', {
			text: ui('请先填写修订说明。', 'Please enter a revision comment.'),
			cls: 'tracekeeper-view__description',
		});

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
					: ui('请输入修订说明', 'Enter revision comment')
			);
		}
		if (this.statusText) {
			this.statusText.setText(
				hasComment
					? this.getReadyStatusText()
					: ui('请先填写修订说明。', 'Please enter a revision comment.')
			);
		}
	}

	private getSubmitLabel(): string {
		return this.editingExistingRevision
			? ui('保存修订说明', 'Save revision comment')
			: ui('提交修订说明', 'Submit revision');
	}

	private getReadyStatusText(): string {
		return this.editingExistingRevision
			? ui('保存后会更新该项的修订说明。', "Save to update this item's revision comment.")
			: ui('提交后会将该项标记为“需修订”。', 'Submit to mark this item as Revision requested.');
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
			new Notice(ui('已提交修订说明。', 'Revision comment submitted.'));
			await this.onUpdated();
			this.close();
		} catch (error) {
			console.error('tracekeeper failed to request revision', error);
			this.submitting = false;
			new Notice(ui('提交修订说明失败。', 'Failed to submit revision comment.'));
			this.updateSubmitState();
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
		this.titleEl.setText(ui('应用已批准写回', 'Apply approved writeback'));
		void this.renderPreview();
	}

	private async renderPreview(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', {
			text: ui('正在生成写回预览...', 'Generating writeback preview...'),
		});
		try {
			const preview = await this.plugin.previewApprovedWriteback(this.proposal);
			this.renderReady(preview);
		} catch (error) {
			console.error('tracekeeper failed to preview approved writeback', error);
			contentEl.empty();
			contentEl.createEl('p', {
				text: ui('生成写回预览失败，请检查该提案是否仍处于已批准状态。', 'Failed to generate writeback preview. Check whether this proposal is still approved.'),
			});
			const actions = contentEl.createDiv({ cls: 'modal-button-container' });
			actions.createEl('button', { text: ui('关闭', 'Close') }).addEventListener('click', () => this.close());
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

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel'), cls: 'mod-warning' });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', { text: ui('确认写回', 'Apply writeback'), cls: 'mod-cta' });
		confirm.addEventListener('click', () => {
			void (async () => {
				confirm.disabled = true;
				confirm.setText(ui('写回中...', 'Applying...'));
				try {
					await this.plugin.applyApprovedWriteback(this.proposal);
					new Notice(ui('已应用写回。', 'Approved writeback applied.'));
					this.onApplied();
					this.close();
				} catch (error) {
					console.error('tracekeeper failed to apply approved writeback', error);
					new Notice(ui('应用写回失败。', 'Failed to apply writeback.'));
					confirm.disabled = false;
					confirm.setText(ui('确认写回', 'Apply writeback'));
				}
			})();
		});
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value || ui('未指定', 'Not specified') });
	}
}
