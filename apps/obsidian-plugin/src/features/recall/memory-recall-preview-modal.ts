import { App, Modal, Setting } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import {
	MEMORY_RECALL_SCOPES,
	normalizeMemoryRecallScope,
	type MemoryRecallResult,
	type TracekeeperRecallScope,
} from './recall-view-model';
import { ui } from '../../ui/localization';

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
			this.statusEl.setText(error instanceof Error ? error.message : String(error));
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
			badges.createEl('span', { text: item.scope, cls: 'tracekeeper-badge' });
			badges.createEl('span', { text: `${ui('分数', 'Score')} ${item.score}`, cls: 'tracekeeper-badge tracekeeper-badge--muted' });
			const details = card.createDiv({ cls: 'tracekeeper-detail-grid' });
			this.renderDetail(details, ui('路径', 'Path'), item.path || ui('未知', 'Unknown'));
			this.renderDetail(details, ui('类型', 'Type'), item.type || ui('笔记', 'Note'));
			this.renderDetail(details, ui('命中词', 'Matched tokens'), item.matchedTokens.length ? item.matchedTokens.join(', ') : ui('无', 'None'));
			this.renderDetail(details, ui('原因', 'Reason'), item.reason);
		}
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail tracekeeper-detail--description' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value || ui('未知', 'Unknown') });
	}
}
