import { App, Modal, Notice } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type {
	ApprovedWritebackPreview,
	ArchiveMemoryProposalPreview,
	ArchiveMemoryProposalReceipt,
	WikiReviewBatchPreview,
	WikiReviewBatchProgress,
	WikiReviewBatchReceipt,
} from './review-queue-controller';
import type { MemoryProposalRecord } from './review-view-model';
import type { ReviewProposalContext, ReviewTargetCandidate } from './review-context-model';
import { ui } from '../../ui/localization';
import { trimText } from '../shared/markdown-record-parser';

const isProposalTransitionConflict = (error: unknown): boolean =>
	error instanceof Error && error.name === 'ProposalTransitionConflictError';

const configureLiveStatus = (element: HTMLElement): void => {
	element.setAttr('role', 'status');
	element.setAttr('aria-live', 'polite');
	element.setAttr('aria-atomic', 'true');
};

const noteNameFromPath = (path: string): string =>
	path.split('/').pop()?.replace(/\.md$/i, '') || path;

const targetKindLabel = (candidate: ReviewTargetCandidate): string => {
	switch (candidate.kind) {
		case 'project_memory':
			return ui('项目记忆', 'Project memory');
		case 'global_memory':
			return ui('全局记忆', 'Global memory');
		case 'wiki':
		default:
			return ui('知识笔记', 'Knowledge note');
	}
};

const targetReasonLabel = (candidate: ReviewTargetCandidate): string => {
	switch (candidate.reason) {
		case 'current':
			return ui('当前目标', 'Current target');
		case 'project_match':
			return ui('项目匹配', 'Project match');
		case 'scope_match':
			return ui('范围匹配', 'Scope match');
		case 'related_match':
			return ui('内容相关', 'Related content');
		default:
			return ui('可用目标', 'Available target');
	}
};

const targetDisplayName = (candidate: ReviewTargetCandidate): string =>
	candidate.title || noteNameFromPath(candidate.path);

type ProposalWritebackEffect = 'append' | 'create_memory_record' | 'create_wiki_note' | 'update_managed_relations';

const normalizeWritebackEffect = (value: unknown): ProposalWritebackEffect | undefined => {
	if (typeof value !== 'string') {
		return undefined;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === 'append') {
		return 'append';
	}
	if (normalized === 'create_memory_record') {
		return 'create_memory_record';
	}
	if (normalized === 'create_wiki_note') {
		return 'create_wiki_note';
	}
	if (normalized === 'update_managed_relations') {
		return 'update_managed_relations';
	}
	return undefined;
};

const writebackEffectLabel = (effect: ProposalWritebackEffect): string => ({
	append: ui('追加写入', 'Append'),
	create_memory_record: ui('新增记忆', 'Add memory'),
	create_wiki_note: ui('新建知识笔记', 'Create knowledge note'),
	update_managed_relations: ui('更新托管关系', 'Update managed relations'),
}[effect]);

const writebackActionLabel = (effect: ProposalWritebackEffect): string => ({
	append: ui('确认追加写入', 'Confirm append'),
	create_memory_record: ui('确认新增记忆', 'Confirm memory addition'),
	create_wiki_note: ui('确认新建知识笔记', 'Confirm knowledge note creation'),
	update_managed_relations: ui('确认更新关系', 'Confirm relation update'),
}[effect]);

const writebackIntroLabel = (effect: ProposalWritebackEffect): string => ({
	append: ui('请确认以下内容将写入目标笔记。', 'Confirm the content that will be written to the target note.'),
	create_memory_record: ui('请确认以下内容将新增为记忆。', 'Confirm the content that will be added as memory.'),
	create_wiki_note: ui('请确认以下内容将新建为知识笔记。', 'Confirm the knowledge note content to be created.'),
	update_managed_relations: ui('请确认以下托管关系将被更新，用户正文不会改动。', 'Confirm the managed relation update. User-authored content is not changed.'),
}[effect]);

const writebackProgressLabel = (effect: ProposalWritebackEffect): string => ({
	append: ui('正在写入目标笔记。', 'Applying change to the target note.'),
	create_memory_record: ui('正在新增记忆。', 'Adding memory.'),
	create_wiki_note: ui('正在新建知识笔记。', 'Creating a knowledge note.'),
	update_managed_relations: ui('正在更新托管关系。', 'Updating managed relations.'),
}[effect]);

const writebackSuccessLabel = (effect: ProposalWritebackEffect): string => ({
	append: ui('已写入目标笔记。', 'Change applied to the target note.'),
	create_memory_record: ui('记忆已新增。', 'Memory added.'),
	create_wiki_note: ui('知识笔记已新建。', 'Knowledge note created.'),
	update_managed_relations: ui('托管关系已更新。', 'Managed relations updated.'),
}[effect]);

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
					'补充或修改需要调整的内容，供后续 Agent 理解问题并重新生成变更。',
					'Add or edit what should change so the next Agent can understand the issue and revise the change.'
				)
				: ui(
					'请说明需要修改的内容或发现的问题。提交后当前变更将标记为“已退回修改”。',
					'Describe what should be changed. Submitting will mark this change as returned for revision.'
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
				? ui('保存后会更新当前变更的修改说明。', "Save to update this change's revision note.")
				: ui('确认后会将当前变更标记为“已退回修改”。', 'Confirm to mark this change as returned for revision.');
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
			new Notice(ui('已退回修改。', 'Change returned for revision.'));
			await this.onUpdated();
			this.close();
		} catch (error) {
			console.error('tracekeeper failed to request revision', error);
			this.submitting = false;
			const conflict = isProposalTransitionConflict(error);
			const failureMessage = conflict
				? ui(
					'知识变更已发生变化；修改说明仍保留。请重新加载后再审核。',
					'The knowledge change was updated; your revision note is preserved. Reload before reviewing again.'
				)
				: ui('退回修改失败。', 'Failed to return change for revision.');
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
		this.titleEl.setText(ui('编辑知识变更', 'Edit knowledge change'));
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-review-edit-modal');
		contentEl.createEl('p', {
			text: ui(
				'编辑只会更新当前审核记录，不会写入目标笔记。保存后仍需通过审核、预览并再次确认写入。',
				'Editing updates only the current review record. Saving does not write to the target note; approval, preview, and a second confirmation are still required.'
			),
			cls: 'tracekeeper-view__description',
		});

		this.renderTargetPicker(contentEl);

		const writebackLabel = contentEl.createDiv({ cls: 'tracekeeper-review-edit-modal__label' });
		writebackLabel.createEl('strong', { text: ui('拟写入内容', 'Proposed writeback') });
		writebackLabel.createEl('small', {
			text: ui('可直接编辑 Markdown。留空保存后，当前变更会显示为“信息不完整”。', 'Edit Markdown directly. Saving an empty value marks this change as incomplete.'),
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
			text: ui('保存修改', 'Save changes'),
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
				'只能选择当前 Vault 中已存在的记忆或知识笔记，不接受手写任意路径。',
				'Choose only an existing memory or knowledge note from this Vault. Arbitrary paths are not accepted.'
			),
		});

		const candidates = this.availableCandidates();
		if (candidates.length === 0) {
			section.createEl('p', {
				text: ui(
					'没有可用的受限目标候选。你仍可补全拟写入内容，然后退回修改，让 Agent 提供已验证目标。',
					'No constrained target candidate is available. You may complete the writeback content, then return the change for revision so the Agent can provide a verified target.'
				),
				cls: 'tracekeeper-review-inbox__candidate-warning',
			});
			if (this.targetNote) {
				section.createEl('small', {
					text: ui(
						'当前目标不在可验证候选中，因此不显示其内部位置。',
						'The current target is not a verified candidate, so its internal location is hidden.'
					),
				});
			}
			return;
		}

		const select = section.createEl('select', {
			cls: 'tracekeeper-review-edit-modal__target',
		});
		select.setAttr('aria-label', ui('选择受限目标笔记', 'Select constrained target note'));
		const empty = select.createEl('option', {
			text: ui('请选择记忆或知识笔记', 'Select a memory or knowledge note'),
			value: '',
		});
		empty.value = '';
		for (const candidate of candidates) {
			const option = select.createEl('option', {
				text: `${targetDisplayName(candidate)} · ${targetKindLabel(candidate)} · ${targetReasonLabel(candidate)}`,
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
				title: this.context.target.title || noteNameFromPath(this.context.target.path),
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
				text: ui('尚未选择目标。保存后当前变更仍会保持“待补全”。', 'No target selected. The change will remain in Needs completion after saving.'),
				cls: 'tracekeeper-view__description',
			});
			return;
		}
		this.targetContextEl.createEl('strong', { text: targetDisplayName(selected) });
		this.targetContextEl.createEl('small', {
			text: `${targetKindLabel(selected)} · ${targetReasonLabel(selected)}`,
		});
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
		this.statusText?.setText(ui('正在保存修改。', 'Saving changes.'));
		try {
			await this.plugin.updateMemoryProposalDraft(this.proposal, {
				targetNote: this.targetNote,
				writebackContent: this.writebackContent,
			});
			new Notice(ui('修改已保存；尚未写入目标笔记。', 'Changes saved; the target note was not written.'));
			await this.onUpdated();
			this.close();
		} catch (error) {
			console.error('tracekeeper failed to update review proposal draft', error);
			this.saving = false;
			this.saveButton.disabled = false;
			this.saveButton.setText(ui('保存修改', 'Save changes'));
			const conflict = isProposalTransitionConflict(error);
			const failureMessage = conflict
				? ui(
					'知识变更已发生变化；你的修改仍保留。请重新加载后再审核。',
					'The knowledge change was updated; your changes are preserved. Reload before reviewing again.'
				)
				: ui('保存修改失败。', 'Failed to save changes.');
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
			row.createEl('strong', {
				text: this.archiveItemLabel(item),
			});
			row.createEl('small', {
				text: ui(
					`将保留 ${item.managedReferences.length} 个关联引用`,
					`${item.managedReferences.length} linked reference(s) will be preserved`
				),
			});
		}
		if (preview.conflicts.length > 0) {
			const conflicts = contentEl.createDiv({
				cls: 'tracekeeper-review-archive-modal__conflicts',
			});
			conflicts.createEl('strong', {
				text: ui('必须先解决的冲突', 'Conflicts to resolve first'),
			});
			conflicts.createEl('p', {
				text: ui(
					`发现 ${preview.conflicts.length} 个冲突。展开技术信息可查看精确位置。`,
					`${preview.conflicts.length} conflict(s) found. Expand Technical details for exact locations.`
				),
			});
		}

		const technical = contentEl.createEl('details', {
			cls: 'tracekeeper-advanced-details tracekeeper-review-archive-modal__technical-details',
		});
		technical.createEl('summary', {
			text: ui('技术信息', 'Technical details'),
			cls: 'tracekeeper-advanced-summary',
		});
		const technicalList = technical.createEl('ul');
		for (const item of preview.items) {
			const row = technicalList.createEl('li');
			row.createEl('code', {
				text: `${item.sourcePath} → ${item.destinationPath}`,
			});
			row.createEl('small', {
				text: ui(`记录 ${item.proposalId}`, `Record ${item.proposalId}`),
			});
			if (item.managedReferences.length > 0) {
				const references = row.createEl('ul');
				for (const path of item.managedReferences) {
					references.createEl('li').createEl('code', { text: path });
				}
			}
		}
		if (preview.conflicts.length > 0) {
			const conflictList = technical.createEl('ul');
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
					'预览已就绪。归档会保留稳定记录标识和历史关联；用户归档操作不写入 Agent 活动。',
					'Preview ready. Archive preserves stable record identity and history associations; human archive actions do not create Agent activity.'
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

	private archiveItemLabel(item: ArchiveMemoryProposalPreview['items'][number]): string {
		const proposal = this.proposals.find((candidate) =>
			candidate.proposalId === item.proposalId || candidate.path === item.sourcePath
		);
		const rationale = trimText(proposal?.rationale || '', 90);
		if (rationale) {
			return rationale;
		}
		switch (proposal?.proposalKind) {
			case 'task_decision':
				return ui('任务决策', 'Task decision');
			case 'task_conclusion':
				return ui('任务结论', 'Task conclusion');
			case 'knowledge_change':
				return ui('知识变更', 'Knowledge change');
			case 'project_next_action':
				return ui('项目下一步', 'Project next action');
			default:
				return ui('已处理的知识变更', 'Processed knowledge change');
		}
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

export class WikiReviewBatchApplyModal extends Modal {
	private readonly selectedPaths: Set<string>;
	private applying = false;
	private escapeHandler: import('obsidian').KeymapEventHandler | null = null;
	private progressWatchdogId: number | null = null;
	private lastProgressAt = 0;
	private lastProgress: WikiReviewBatchProgress | null = null;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private proposals: readonly MemoryProposalRecord[],
		private onApplied: () => void,
		private recoveryOperationId = ''
	) {
		super(app);
		this.selectedPaths = new Set(proposals.map((proposal) => proposal.path));
	}

	onOpen(): void {
		void super.onOpen();
		if (this.scope) {
			this.escapeHandler = this.scope.register(null, 'Escape', () => {
				if (this.applying) {
					new Notice(ui('批次正在写入，请等待完成。', 'The batch is still writing; please wait for it to finish.'));
					return false;
				}
				return undefined;
			});
		}
		this.titleEl.setText(ui('审查并写入 Wiki 批次', 'Review and apply Wiki batch'));
		if (this.recoveryOperationId) {
			void this.renderRecovery();
		} else {
			void this.renderPreview();
		}
	}

	onClose(): void {
		this.stopProgressWatchdog();
		this.applying = false;
		if (this.escapeHandler) {
			this.scope.unregister(this.escapeHandler);
			this.escapeHandler = null;
		}
	}

	private async renderRecovery(): Promise<void> {
		this.contentEl.empty();
		this.titleEl.setText(ui('恢复 Wiki 批次', 'Resume Wiki batch'));
		const status = this.contentEl.createEl('p', {
			text: ui('正在从本地操作日志恢复 Wiki 批次...', 'Resuming the Wiki batch from the local operation journal...'),
		});
		configureLiveStatus(status);
		const progress = this.contentEl.createEl('progress');
		progress.max = 1;
		progress.value = 0;
		progress.setAttribute('aria-label', ui('批次恢复进度', 'Batch recovery progress'));
		const confirm = this.contentEl.createEl('button', {
			text: ui('正在恢复...', 'Resuming...'),
			cls: 'mod-cta',
		});
		confirm.disabled = true;
		this.applying = true;
		this.lastProgressAt = Date.now();
		this.setModalBusy(true);
		this.startProgressWatchdog(status, progress, confirm, 1);
		try {
			const receipt = await this.plugin.resumeWikiReviewBatch(
				this.recoveryOperationId,
				(next) => this.renderProgress(status, progress, confirm, next)
			);
			this.stopProgressWatchdog();
			this.applying = false;
			this.setModalBusy(false);
			this.renderReceipt(null, receipt);
		} catch (error) {
			this.stopProgressWatchdog();
			this.applying = false;
			this.setModalBusy(false);
			console.error('tracekeeper failed to recover Wiki review batch', error);
			this.renderFailure(ui('批次恢复失败，请重新生成预览。', 'Batch recovery failed. Generate a fresh preview.'));
		}
	}

	private async renderPreview(): Promise<void> {
		this.contentEl.empty();
		const selected = this.proposals.filter((proposal) => this.selectedPaths.has(proposal.path));
		if (selected.length === 0) {
			this.contentEl.createEl('p', { text: ui('至少选择一项 Wiki 变更。', 'Select at least one Wiki change.') });
			const close = this.contentEl.createEl('button', { text: ui('关闭', 'Close') });
			close.addEventListener('click', () => this.close());
			close.focus();
			return;
		}
		const loading = this.contentEl.createEl('p', {
			text: ui('正在生成批次预览...', 'Generating batch preview...'),
		});
		configureLiveStatus(loading);
		try {
			this.renderReady(await this.plugin.previewWikiReviewBatch(selected));
		} catch (error) {
			console.error('tracekeeper failed to preview Wiki review batch', error);
			this.contentEl.empty();
			const failure = this.contentEl.createEl('p', {
				text: ui('无法生成批次预览；提案或目标可能已经变化。', 'Unable to generate the batch preview; a proposal or target may have changed.'),
			});
			configureLiveStatus(failure);
			const close = this.contentEl.createEl('button', { text: ui('关闭', 'Close') });
			close.addEventListener('click', () => this.close());
			close.focus();
		}
	}

	private renderReady(preview: WikiReviewBatchPreview): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			text: ui(
				`本次确认将批准并写入 ${preview.items.length} 项 Wiki 变更。`,
				`This confirmation approves and applies ${preview.items.length} Wiki change(s).`
			),
		});
		const summary = this.contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(summary, ui('批次', 'Batch'), preview.reviewBatchId);
		this.renderDetail(summary, ui('变更数量', 'Changes'), String(preview.items.length));
		this.renderDetail(summary, ui('有效至', 'Expires'), new Date(preview.expiresAt).toLocaleString());

		for (const item of preview.items) {
			const details = this.contentEl.createEl('details', {
				cls: 'tracekeeper-advanced-details tracekeeper-review-batch-modal__item',
			});
			const summaryRow = details.createEl('summary', { cls: 'tracekeeper-advanced-summary' });
			const checkbox = summaryRow.createEl('input', { type: 'checkbox' });
			checkbox.checked = this.selectedPaths.has(item.proposalPath);
			checkbox.setAttribute('aria-label', ui(`包含 ${noteNameFromPath(item.targetPath)}`, `Include ${noteNameFromPath(item.targetPath)}`));
			checkbox.addEventListener('click', (event) => event.stopPropagation());
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) this.selectedPaths.add(item.proposalPath);
				else this.selectedPaths.delete(item.proposalPath);
				void this.renderPreview();
			});
			summaryRow.createSpan({ text: `${noteNameFromPath(item.targetPath)} · ${item.effectiveRisk}` });
			const facts = details.createDiv({ cls: 'tracekeeper-detail-grid' });
			this.renderDetail(facts, ui('目标路径', 'Target path'), item.targetPath);
			this.renderDetail(facts, ui('记录 ID', 'Record ID'), item.proposalId);
			details.createEl('pre').setText(item.writebackPreview);
		}

		const status = this.contentEl.createEl('p', { cls: 'tracekeeper-view__description' });
		configureLiveStatus(status);
		const progress = this.contentEl.createEl('progress');
		progress.max = preview.items.length;
		progress.value = 0;
		progress.setAttribute('aria-label', ui('批次写入进度', 'Batch write progress'));
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel'), cls: 'mod-warning' });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			text: ui(`确认并写入 ${preview.items.length} 项`, `Confirm and apply ${preview.items.length}`),
			cls: 'mod-cta',
		});
		confirm.addEventListener('click', () => {
			void this.applyBatch(preview, status, progress, confirm, cancel);
		});
		cancel.focus();
	}

	private async applyBatch(
		preview: WikiReviewBatchPreview,
		status: HTMLElement,
		progress: HTMLProgressElement,
		confirm: HTMLButtonElement,
		cancel: HTMLButtonElement
	): Promise<void> {
		this.applying = true;
		this.lastProgressAt = Date.now();
		this.lastProgress = { phase: 'preflight', completed: 0, total: preview.items.length };
		confirm.disabled = true;
		cancel.disabled = true;
		this.setModalBusy(true);
		this.startProgressWatchdog(status, progress, confirm, preview.items.length);
		this.renderProgress(status, progress, confirm, this.lastProgress);
		try {
			const receipt = await this.plugin.confirmWikiReviewBatch(
				preview,
				preview.confirmationToken,
				{
					idempotencyKey: preview.idempotencyKey,
					onProgress: (next) => this.renderProgress(status, progress, confirm, next),
				}
			);
			this.stopProgressWatchdog();
			this.applying = false;
			this.setModalBusy(false);
			this.renderReceipt(preview, receipt);
		} catch (error) {
			this.stopProgressWatchdog();
			this.applying = false;
			this.setModalBusy(false);
			console.error('tracekeeper failed to apply Wiki review batch', error);
			this.renderFailure(
				ui('批次写入失败，请刷新后重新预览。', 'Batch apply failed. Refresh and generate a new preview.')
			);
		}
	}

	private renderReceipt(preview: WikiReviewBatchPreview | null, receipt: WikiReviewBatchReceipt): void {
		this.contentEl.empty();
		const completed = receipt.status === 'completed';
		this.titleEl.setText(
			completed
				? ui('Wiki 批次已完成', 'Wiki batch completed')
				: ui('Wiki 批次需要处理', 'Wiki batch needs attention')
		);
		const status = this.contentEl.createEl('p', {
			text: completed
				? ui('Wiki 批次已经完成。', 'The Wiki batch is complete.')
				: ui(
					`批次部分完成：已写入 ${receipt.applied.length} 项，剩余 ${receipt.pending.length} 项。`,
					`Batch partially completed: ${receipt.applied.length} applied, ${receipt.pending.length} remaining.`
				),
		});
		configureLiveStatus(status);
		const summary = this.contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(summary, ui('已批准', 'Approved'), String(receipt.approved.length));
		this.renderDetail(summary, ui('已应用', 'Applied'), String(receipt.applied.length));
		this.renderDetail(summary, ui('目标写入', 'Target writes'), String(receipt.targetWrites.length));
		this.renderDetail(summary, ui('冲突', 'Conflicts'), String(receipt.conflicts.length));
		this.renderDetail(summary, ui('依赖阻塞', 'Dependency blocked'), String(receipt.dependencyBlocked.length));
		if (receipt.conflicts.length > 0) {
			const conflictList = this.contentEl.createEl('ul');
			for (const conflict of receipt.conflicts) {
				conflictList.createEl('li', {
					text: `${noteNameFromPath(conflict.targetPath || conflict.proposalPath)}: ${conflict.message}`,
				});
			}
		}
		if (receipt.dependencyBlocked.length > 0) {
			const blockedList = this.contentEl.createEl('ul');
			for (const blocked of receipt.dependencyBlocked) {
				blockedList.createEl('li', {
					text: `${noteNameFromPath(blocked.targetPath || blocked.proposalPath)}: ${blocked.message}`,
				});
			}
		}
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		if (!completed && receipt.resumable) {
			const resume = actions.createEl('button', {
				text: ui('继续未完成项', 'Resume remaining items'),
				cls: 'mod-cta',
			});
			resume.addEventListener('click', () => void this.resumeBatch(
				preview?.operationId || this.recoveryOperationId || receipt.operationId
			));
		}
		const close = actions.createEl('button', {
			text: completed ? ui('完成', 'Done') : ui('关闭并重新预览', 'Close and prepare a fresh preview'),
		});
		close.addEventListener('click', () => {
			this.onApplied();
			this.close();
		});
		close.focus();
		if (completed) {
			new Notice(ui('Wiki 批次已写入。', 'Wiki batch applied.'));
		}
	}

	private async resumeBatch(operationId: string): Promise<void> {
		this.contentEl.empty();
		const status = this.contentEl.createEl('p', {
			text: ui('正在恢复 Wiki 批次...', 'Resuming Wiki batch...'),
		});
		configureLiveStatus(status);
		const progress = this.contentEl.createEl('progress');
		progress.max = Math.max(1, this.lastProgress?.total || 1);
		progress.value = 0;
		progress.setAttribute('aria-label', ui('批次恢复进度', 'Batch recovery progress'));
		const confirm = this.contentEl.createEl('button', {
			text: ui('正在恢复...', 'Resuming...'),
			cls: 'mod-cta',
		});
		confirm.disabled = true;
		this.applying = true;
		this.setModalBusy(true);
		this.startProgressWatchdog(status, progress, confirm, progress.max);
		try {
			const receipt = await this.plugin.resumeWikiReviewBatch(
				operationId,
				(next) => this.renderProgress(status, progress, confirm, next)
			);
			this.stopProgressWatchdog();
			this.applying = false;
			this.setModalBusy(false);
			this.renderReceipt(null, receipt);
		} catch (error) {
			this.stopProgressWatchdog();
			this.applying = false;
			this.setModalBusy(false);
			console.error('tracekeeper failed to resume Wiki review batch', error);
			this.renderFailure(ui('批次恢复失败，请重新生成预览。', 'Batch recovery failed. Generate a fresh preview.'));
		}
	}

	private renderFailure(message: string): void {
		this.contentEl.empty();
		const failure = this.contentEl.createEl('p', { text: message });
		configureLiveStatus(failure);
		const close = this.contentEl.createEl('button', { text: ui('关闭', 'Close') });
		close.addEventListener('click', () => this.close());
		close.focus();
	}

	private renderProgress(
		status: HTMLElement,
		progress: HTMLProgressElement,
		confirm: HTMLButtonElement,
		value: WikiReviewBatchProgress
	): void {
		this.lastProgress = value;
		this.lastProgressAt = Date.now();
		progress.max = Math.max(1, value.total);
		progress.value = Math.min(value.total, Math.max(0, value.completed));
		progress.setAttribute('aria-valuemin', '0');
		progress.setAttribute('aria-valuemax', String(value.total));
		progress.setAttribute('aria-valuenow', String(progress.value));
		const phase = {
			preflight: ui('正在预检', 'Preflighting'),
			claiming: ui('正在认领批次', 'Claiming batch'),
			approving: ui('正在提交批准回执', 'Recording approvals'),
			writing: ui('正在写入 Wiki', 'Writing Wiki'),
			finalizing: ui('正在收尾', 'Finalizing'),
			completed: ui('已完成', 'Completed'),
			conflict: ui('需要处理冲突', 'Conflict needs attention'),
		}[value.phase];
		const current = value.currentTargetPath ? ` · ${noteNameFromPath(value.currentTargetPath)}` : '';
		status.setText(`${phase} · ${value.completed}/${value.total}${current}${value.message ? ` · ${value.message}` : ''}`);
		if (this.applying) {
			confirm.setText(ui(`${phase} ${value.completed}/${value.total}`, `${phase} ${value.completed}/${value.total}`));
		}
	}

	private startProgressWatchdog(
		status: HTMLElement,
		progress: HTMLProgressElement,
		confirm: HTMLButtonElement,
		total: number
	): void {
		this.stopProgressWatchdog();
		this.progressWatchdogId = window.setInterval(() => {
			if (!this.applying || Date.now() - this.lastProgressAt < 10_000) return;
			const completed = this.lastProgress?.completed ?? progress.value;
			status.setText(ui(
				`仍在等待文件锁或恢复步骤 · ${completed}/${total}`,
				`Still waiting for a file lock or recovery step · ${completed}/${total}`
			));
			confirm.setText(ui(`仍在处理 ${completed}/${total}`, `Still processing ${completed}/${total}`));
		}, 1000);
	}

	private stopProgressWatchdog(): void {
		if (this.progressWatchdogId !== null) {
			window.clearInterval(this.progressWatchdogId);
			this.progressWatchdogId = null;
		}
	}

	private setModalBusy(busy: boolean): void {
		if (!this.modalEl) return;
		this.modalEl.toggleClass('tracekeeper-review-batch-modal--running', busy);
		const close = this.modalEl.querySelector('.modal-close-button') as HTMLButtonElement | null;
		if (close) {
			close.disabled = busy;
			close.setAttribute('aria-disabled', String(busy));
		}
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createSpan({ text: label });
		item.createEl('strong', { text: value || ui('未指定', 'Not specified') });
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
					text: ui('生成写入预览失败，请检查当前变更是否仍处于审核通过状态。', 'Failed to generate writeback preview. Check whether this change is still approved.'),
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
		const writebackEffect = normalizeWritebackEffect(preview.writeback_effect);
		const actionLabel = writebackEffect
			? writebackActionLabel(writebackEffect)
			: ui('确认写入', 'Confirm apply');
		contentEl.empty();
		contentEl.createEl('p', {
			text: writebackEffect
				? writebackIntroLabel(writebackEffect)
				: ui('该写回模式不受支持，无法继续。', 'This writeback mode is not supported and cannot continue.'),
		});
		const facts = contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		if (writebackEffect) {
			this.renderDetail(facts, ui('写回方式', 'Writeback mode'), writebackEffectLabel(writebackEffect));
		}
		const targetPath = preview.target_note || this.proposal.targetNote;
		this.renderDetail(facts, ui('目标笔记', 'Target note'), noteNameFromPath(targetPath));
		this.renderDetail(
			facts,
			ui('涉及笔记', 'Affected notes'),
			ui(`${preview.touched_notes?.length || 0} 条`, `${preview.touched_notes?.length || 0} note(s)`)
		);
		const previewBox = contentEl.createEl('pre');
		previewBox.setText(preview.writeback_preview || '');

		const technical = contentEl.createEl('details', {
			cls: 'tracekeeper-advanced-details tracekeeper-review-apply-modal__technical-details',
		});
		technical.createEl('summary', {
			text: ui('技术信息', 'Technical details'),
			cls: 'tracekeeper-advanced-summary',
		});
		const technicalFacts = technical.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(technicalFacts, ui('记录 ID', 'Record ID'), preview.proposal_id || this.proposal.proposalId);
		this.renderDetail(technicalFacts, ui('目标路径', 'Target path'), targetPath);
		this.renderDetail(technicalFacts, ui('涉及文件', 'Touched notes'), (preview.touched_notes || []).join(', '));

		const status = contentEl.createEl('p', {
			cls: 'tracekeeper-view__description',
		});
		configureLiveStatus(status);

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel'), cls: 'mod-warning' });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', { text: actionLabel, cls: 'mod-cta' });
		if (!writebackEffect) {
			confirm.disabled = true;
			status.setText(ui(
				'写回预览包含不支持的写回模式，不能继续写入。',
				'The writeback preview has an unsupported writeback mode and cannot be applied.'
			));
			return;
		}
		confirm.addEventListener('click', () => {
			void (async () => {
				confirm.disabled = true;
				confirm.setText(ui('写回中...', 'Applying...'));
				status.setText(writebackProgressLabel(writebackEffect));
				try {
					await this.plugin.applyApprovedWriteback(this.proposal, preview);
					new Notice(writebackSuccessLabel(writebackEffect));
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
					confirm.setText(actionLabel);
					status.setText(failureMessage);
					confirm.focus();
				}
			})();
		});
		cancel.focus();
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createSpan({ text: label });
		item.createEl('strong', { text: value || ui('未指定', 'Not specified') });
	}
}
