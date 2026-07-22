import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { SourceAnalysisSnapshot } from '../activity/activity-record-repository';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_SOURCE_STATUS_VIEW } from '../../ui/view-types';
import { trimText } from '../shared/markdown-record-parser';

export class TracekeeperSourceStatusView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_SOURCE_STATUS_VIEW;
	}

	getDisplayText() {
		return ui('来源状态', 'Source status');
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

	private async render(snapshot: SourceAnalysisSnapshot): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		contentEl.createEl('h2', { text: ui('来源状态', 'Source status'), cls: 'tracekeeper-view__title' });

		const header = contentEl.createDiv({ cls: 'tracekeeper-view__section' });
		header.createEl('div', {
			text: `${ui('最后刷新', 'Last refreshed')}: ${this.plugin.formatDisplayTime(
				Date.parse(snapshot.updatedAt)
			)}`,
			cls: 'tracekeeper-view__description',
		});
		const actions = header.createDiv();
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
					new Notice(ui('来源状态已刷新。', 'Source status refreshed.'));
				} catch (error) {
					console.error('tracekeeper failed to refresh source status view', error);
					refreshButton.disabled = false;
					refreshButton.setText(ui('刷新', 'Refresh'));
					new Notice(ui('刷新来源状态失败。', 'Failed to refresh source status.'));
				}
			})();
		});

		if (snapshot.missingRequestFolder) {
			contentEl.createEl('p', {
				text: ui(
					'还没有来源请求记录。初始化知识库后，AI 助手提交的资料处理请求会显示在这里。',
					'No source request records yet. After Tracekeeper is initialized, material processing requests from your AI assistant will appear here.'
				),
				cls: 'tracekeeper-view__description',
			});
			return;
		}

		if (snapshot.requests.length === 0) {
			contentEl.createEl('p', {
				text: ui(
					'当前没有资料请求。',
					'No material requests yet.'
				),
				cls: 'tracekeeper-view__description',
			});
			return;
		}

		const list = contentEl.createEl('ul', { cls: 'tracekeeper-view__list' });
		for (const request of snapshot.requests) {
			const item = list.createEl('li', { cls: 'tracekeeper-view__item' });
			item.createEl('div', {
				text: `${this.plugin.formatDisplayTime(request.sortTimestamp)} • ${request.sourceKind} • ${request.status}`,
			});
			if (request.source) {
				item.createEl('div', { text: `${ui('来源', 'Source')}: ${trimText(request.source, 120)}` });
			}
			if (request.purpose) {
				item.createEl('div', { text: `${ui('用途', 'Purpose')}: ${request.purpose}` });
			}
			if (request.analysisMode) {
				item.createEl('div', { text: `${ui('分析模式', 'Analysis mode')}: ${request.analysisMode}` });
			}
			if (request.relatedProject) {
				item.createEl('div', { text: `${ui('关联项目', 'Related project')}: ${request.relatedProject}` });
			}
			if (request.summary) {
				item.createEl('div', { text: trimText(request.summary, 140) });
			}
			item.createEl('small', { text: `${ui('文件', 'File')}: ${request.path}` });
			if (this.isPendingRequest(request.status)) {
				const actionRow = item.createDiv({ cls: 'tracekeeper-action-row' });
				const processButton = actionRow.createEl('button', {
					text: ui('处理资料请求', 'Process request'),
					cls: 'mod-cta',
				});
				processButton.addEventListener('click', () => {
					void (async () => {
						processButton.disabled = true;
						processButton.setText(ui('处理中...', 'Processing...'));
						try {
							await this.plugin.processSourceRequest(request);
							new Notice(ui('资料请求已处理。', 'Source request processed.'));
							await this.refresh();
						} catch (error) {
							console.error('tracekeeper failed to process source request', error);
							new Notice(ui('处理资料请求失败。', 'Failed to process source request.'));
						} finally {
							processButton.disabled = false;
							processButton.setText(ui('处理资料请求', 'Process request'));
						}
					})();
				});
			}
		}
	}

	private isPendingRequest(status: string): boolean {
		const normalized = status.toLowerCase().trim();
		return !normalized || normalized === 'pending' || normalized === 'queued' || normalized === 'todo';
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadSourceStatusSnapshot();
		await this.render(snapshot);
	}
}
