import { App, getLanguage, Modal, Setting } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import {
	MEMORY_RECALL_SCOPES,
	localizeMemoryRecallScoreReasons,
	type MemoryRecallResult,
	type MemoryRecallResultEntry,
	type TracekeeperRecallScope,
} from './recall-view-model';
import { isChineseLanguage, ui } from '../../ui/localization';

export class MemoryRecallPreviewModal extends Modal {
	private query = '';
	private projectHint = '';
	private recallScope: TracekeeperRecallScope = 'project';
	private resultsContainer: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		initial?: {
			query?: string;
			projectHint?: string;
			scope?: TracekeeperRecallScope;
		}
	) {
		super(app);
		this.query = initial?.query?.trim() ?? '';
		this.projectHint = initial?.projectHint?.trim() ?? '';
		this.recallScope = initial?.scope ?? 'project';
	}

	onOpen(): void {
		void super.onOpen();
		this.titleEl.setText(ui('测试召回', 'Test recall'));
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-recall-modal');
		contentEl.createEl('p', {
			text: ui(
				'输入当前任务关键词，查看 Agent 可能读取到哪些记忆。',
				'Enter task keywords to see which memories an agent may read.'
			),
			cls: 'tracekeeper-view__description',
		});

		new Setting(contentEl)
			.setName(ui('召回范围', 'Recall scope'))
			.setDesc(ui('项目历史可不填关键词，用于查看最近连续性记录。', 'Project history can run without a query to show recent continuity records.'))
			.addDropdown((dropdown) => {
				for (const scope of MEMORY_RECALL_SCOPES) {
					dropdown.addOption(scope, this.plugin.memoryRecallScopeLabel(scope));
				}
				dropdown.setValue(this.recallScope).onChange((value) => {
					this.recallScope = this.plugin.normalizeMemoryRecallScope(value);
				});
			});

		new Setting(contentEl)
			.setName(ui('关键词', 'Query'))
			.setDesc(ui('例如项目名、功能名、决策或问题。', 'For example a project, feature, decision, or issue.'))
			.addText((text) => {
				text.setPlaceholder(ui('输入检索文本', 'Enter query'));
				text.setValue(this.query);
				text.onChange((value) => {
					this.query = value;
				});
			});

		new Setting(contentEl)
			.setName(ui('项目或仓库', 'Project or repository'))
			.setDesc(ui('可选。用于限定项目记忆和项目历史。', 'Optional. Narrows project memory and project history.'))
			.addText((text) => {
				text.setPlaceholder(ui('例如 obsidian-tracekeeper', 'For example obsidian-tracekeeper'));
				text.setValue(this.projectHint);
				text.onChange((value) => {
					this.projectHint = value;
				});
			});

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const runButton = actions.createEl('button', { text: ui('查看召回结果', 'Preview recall'), cls: 'mod-cta' });
		runButton.addEventListener('click', () => {
			void this.run(runButton);
		});
		const closeButton = actions.createEl('button', { text: ui('关闭', 'Close') });
		closeButton.addEventListener('click', () => this.close());
		this.statusEl = contentEl.createDiv({ cls: 'tracekeeper-view__description' });
		this.resultsContainer = contentEl.createDiv({ cls: 'tracekeeper-recall-results' });
	}

	private async run(button: HTMLButtonElement): Promise<void> {
		if (!this.resultsContainer || !this.statusEl) {
			return;
		}
		if (
			!this.query.trim()
			&& this.recallScope !== 'project_history'
			&& this.recallScope !== 'task_history'
		) {
			this.statusEl.setText(ui('请输入检索文本。', 'Please enter a query.'));
			this.resultsContainer.empty();
			return;
		}
		button.disabled = true;
		button.setText(ui('检索中...', 'Searching...'));
		this.statusEl.setText('');
		this.resultsContainer.empty();
		try {
			const result = await this.plugin.runMemoryRecall({
				query: this.query,
				scope: this.recallScope,
				projectHint: this.projectHint,
			});
			this.renderResults(result);
		} catch (error) {
			console.error('tracekeeper recall preview failed', error);
			this.statusEl.setText(ui(
				'召回失败。请确认 Tracekeeper Runtime 正常运行后重试。',
				'Recall failed. Confirm that the Tracekeeper Runtime is running, then try again.'
			));
		} finally {
			button.disabled = false;
			button.setText(ui('查看召回结果', 'Preview recall'));
		}
	}

	private renderResults(result: MemoryRecallResult): void {
		if (!this.resultsContainer || !this.statusEl) {
			return;
		}
		this.resultsContainer.empty();
		this.statusEl.setText(ui(
			`共 ${result.items.length} 条结果 · ${result.scope}`,
			`${result.items.length} results · ${result.scope}`
		));
		this.renderProjectIdentityWarning(result);
		if (result.items.length === 0) {
			const empty = this.resultsContainer.createDiv({ cls: 'tracekeeper-empty-state' });
			empty.createEl('strong', { text: ui('没有匹配结果', 'No matches') });
			empty.createEl('p', { text: ui('可以换一个关键词，或补充项目/仓库信息后再试。', 'Try another query, or add project/repository context.') });
			return;
		}
		for (const item of result.items) {
			const card = this.resultsContainer.createDiv({ cls: 'tracekeeper-card tracekeeper-recall-result-card' });
			const header = card.createDiv({ cls: 'tracekeeper-card__header' });
			header.createEl('strong', { text: item.title || item.path });
			const badges = header.createDiv({ cls: 'tracekeeper-badge-row' });
			badges.createSpan({ text: item.scope, cls: 'tracekeeper-badge' });
			badges.createSpan({ text: `${ui('分数', 'Score')} ${item.score}`, cls: 'tracekeeper-badge tracekeeper-badge--muted' });
			const details = card.createDiv({ cls: 'tracekeeper-detail-grid' });
			this.renderDetail(details, ui('路径', 'Path'), item.path || ui('未知', 'Unknown'));
			this.renderDetail(details, ui('类型', 'Type'), item.type || ui('笔记', 'Note'));
			this.renderDetail(details, ui('命中词', 'Matched tokens'), item.matchedTokens.length ? item.matchedTokens.join(', ') : ui('无', 'None'));
			this.renderDetail(details, ui('原因', 'Reason'), this.recallReasonLabel(item));
		}
	}

	private recallReasonLabel(item: MemoryRecallResultEntry): string {
		if (item.scoreReasons.length === 0) {
			return item.reason;
		}
		const locale = isChineseLanguage(getLanguage()) ? 'zh' : 'en';
		return localizeMemoryRecallScoreReasons(item.scoreReasons, locale);
	}

	private renderProjectIdentityWarning(result: MemoryRecallResult): void {
		if (
			!this.resultsContainer
			|| (!result.uncertain && result.projectIdentity.warnings.length === 0)
		) {
			return;
		}
		const identity = result.projectIdentity;
		const warning = this.resultsContainer.createDiv({
			cls: 'tracekeeper-card tracekeeper-observability-warning',
		});
		warning.createEl('strong', {
			text: result.uncertain
				? ui('项目身份存在不确定性', 'Project identity is uncertain')
				: ui('项目身份提示', 'Project identity notice'),
		});
		warning.createEl('p', {
			text: ui(
				'以下结果使用了 Runtime 返回的项目身份。请先核对身份和警告，不要把候选结果视为已准确归属当前项目。',
				'These results use the project identity returned by the Runtime. Verify the identity and warnings before treating candidates as belonging to the current project.'
			),
		});
		const details = warning.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(details, ui('项目', 'Project'), identity.projectHint || ui('未确定', 'Unresolved'));
		this.renderDetail(details, ui('项目 ID', 'Project ID'), identity.projectId || ui('未确定', 'Unresolved'));
		this.renderDetail(details, ui('仓库路径', 'Repository path'), identity.repoPath || ui('未确定', 'Unresolved'));
		this.renderDetail(details, ui('识别来源', 'Identity source'), this.projectIdentitySourceLabel(identity.source));
		this.renderDetail(details, ui('置信度', 'Confidence'), this.projectIdentityConfidenceLabel(identity.confidence));
		if (identity.warnings.length > 0) {
			const list = warning.createEl('ul');
			for (const code of identity.warnings) {
				list.createEl('li', { text: this.projectIdentityWarningLabel(code) });
			}
		}
	}

	private projectIdentitySourceLabel(source: string): string {
		switch (source) {
			case 'explicit_project_id': return ui('显式项目 ID', 'Explicit project ID');
			case 'explicit_project_hint': return ui('显式项目名称', 'Explicit project hint');
			case 'vault_match': return ui('知识库匹配', 'Vault match');
			case 'repo_leaf': return ui('仓库目录名', 'Repository directory name');
			case 'task_metadata': return ui('任务元数据', 'Task metadata');
			case 'unknown': return ui('未知', 'Unknown');
			default: return source
				? ui('其他识别来源', 'Other identity source')
				: ui('未确定', 'Unresolved');
		}
	}

	private projectIdentityConfidenceLabel(confidence: string): string {
		switch (confidence) {
			case 'exact': return ui('精确', 'Exact');
			case 'derived': return ui('推导', 'Derived');
			case 'uncertain': return ui('不确定', 'Uncertain');
			default: return confidence
				? ui('其他置信度', 'Other confidence level')
				: ui('未确定', 'Unresolved');
		}
	}

	private projectIdentityWarningLabel(code: string): string {
		switch (code) {
			case 'ambiguous_vault_project_identity': return ui('知识库中存在多个可能的项目身份。', 'Multiple project identities in the vault may match.');
			case 'path_project_hint_treated_as_repo_path': return ui('输入的项目名称看起来是路径，已按仓库路径处理。', 'The project hint looked like a path and was treated as a repository path.');
			case 'project_hint_conflicts_with_project_id': return ui('项目名称与项目 ID 对应的身份冲突。', 'The project hint conflicts with the identity selected by project ID.');
			case 'repo_path_conflicts_with_project_id': return ui('仓库路径与项目 ID 对应的身份冲突。', 'The repository path conflicts with the identity selected by project ID.');
			case 'project_hint_conflicts_with_repo_path': return ui('项目名称与仓库路径对应的身份冲突。', 'The project hint conflicts with the identity selected by repository path.');
			case 'project_hint_canonicalized_from_repo_match': return ui('项目名称已根据仓库匹配规范化。', 'The project hint was canonicalized from a repository match.');
			case 'project_hint_derived_from_repo_leaf': return ui('项目名称由仓库目录名推导，尚未得到稳定身份确认。', 'The project hint was derived from the repository directory name and is not yet a stable identity.');
			default: return ui('存在未识别的项目身份警告。', 'An unrecognized project identity warning was reported.');
		}
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail tracekeeper-detail--description' });
		item.createSpan({ text: label });
		item.createEl('strong', { text: value || ui('未知', 'Unknown') });
	}
}
