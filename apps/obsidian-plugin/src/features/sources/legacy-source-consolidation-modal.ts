import { Modal, Notice, type App } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import { ui } from '../../ui/localization';
import { reportUiFailure } from '../../ui/user-facing-error';
import type {
	LegacySourceArchivePreview,
	LegacySourceConsolidationPreview,
} from './legacy-source-consolidation-controller';

export class LegacySourceConsolidationModal extends Modal {
	private statusEl: HTMLElement | null = null;
	private confirmed = false;

	constructor(
		app: App,
		private readonly plugin: TracekeeperPlugin,
		private readonly preview: LegacySourceConsolidationPreview,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-modal-content');
		this.titleEl.setText(ui('规范化旧版 Source 分段', 'Consolidate legacy Source segments'));
		contentEl.createEl('p', {
			text: ui(
				'这是一次只创建新文件的维护操作。旧分段会保留，归档必须在后续单独确认。',
				'This operation creates new files only. Legacy segments remain in place; archiving requires a separate confirmation.'
			),
			cls: 'tracekeeper-view__description',
		});
		const summary = contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.detail(summary, ui('旧分段', 'Legacy segments'), String(this.preview.plan.oldSegmentCount));
		this.detail(summary, ui('新 Source index', 'New Source indexes'), String(this.preview.plan.newParentCount));
		this.detail(summary, ui('新 Source part', 'New Source parts'), String(this.preview.plan.newPartCount));
		this.detail(summary, ui('计划哈希', 'Plan hash'), this.preview.plan.planHash);
		if (this.preview.plan.issues.length > 0) {
			const issues = contentEl.createEl('details');
			issues.createEl('summary', { text: ui('阻塞项', 'Blocking issues') });
			const list = issues.createEl('ul');
			for (const item of this.preview.plan.issues.slice(0, 20)) {
				list.createEl('li', { text: `${item.code}: ${item.message} (${item.paths.join(', ')})` });
			}
		}
		this.statusEl = contentEl.createEl('p', {
			text: this.preview.canApply
				? ui('预览有效，可以创建新 Source 文件。', 'Preview is valid; new Source files can be created.')
				: ui('预览被阻塞，未发现任何可执行写入。', 'Preview is blocked; no write can be executed.'),
			cls: 'tracekeeper-view__description',
		});
		this.statusEl.setAttr('role', 'status');
		this.statusEl.setAttr('aria-live', 'polite');
		const actions = contentEl.createDiv({ cls: 'tracekeeper-action-row' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			text: ui('确认创建新 Source', 'Create normalized Sources'),
			cls: 'mod-cta',
		});
		confirm.disabled = !this.preview.canApply;
		confirm.addEventListener('click', () => {
			void this.apply(confirm);
		});
		cancel.focus();
	}

	private async apply(button: HTMLButtonElement): Promise<void> {
		if (this.confirmed) return;
		this.confirmed = true;
		button.disabled = true;
		button.setText(ui('创建中...', 'Creating...'));
		try {
			const result = await this.plugin.applyLegacySourceConsolidation(
				this.preview,
				this.preview.confirmationToken
			);
			if (result.status === 'completed') {
				new Notice(ui(`已创建并验证 ${result.verifiedCount} 个 Source 文件。`, `Created and verified ${result.verifiedCount} Source files.`));
				try {
					const archivePreview = await this.plugin.previewLegacySourceArchive(result.migrationId);
					this.close();
					new LegacySourceArchiveModal(this.app, this.plugin, archivePreview).open();
				} catch (error) {
					this.setStatus(reportUiFailure(error, {
						context: 'tracekeeper failed to prepare legacy Source archive preview',
						fallback: { zh: '新 Source 已创建，但无法准备归档预览。', en: 'New Sources were created, but the archive preview could not be prepared.' },
					}));
					button.disabled = false;
				}
				return;
			}
			this.setStatus(ui(
				`操作处于${result.status === 'conflicted' ? '冲突' : '部分完成'}状态，请按日志恢复。`,
				`Operation is ${result.status}; use the journal to resume.`
			));
		} catch (error) {
			this.confirmed = false;
			this.setStatus(reportUiFailure(error, {
				context: 'tracekeeper failed to consolidate legacy Source segments',
				fallback: { zh: '规范化旧版 Source 失败。', en: 'Failed to consolidate legacy Sources.' },
			}));
			button.disabled = false;
			button.setText(ui('重试创建', 'Retry creation'));
		}
	}

	private setStatus(text: string): void {
		this.statusEl?.setText(text);
	}

	private detail(container: HTMLElement, label: string, value: string): void {
		const row = container.createDiv({ cls: 'tracekeeper-detail' });
		row.createSpan({ text: label });
		row.createEl('strong', { text: value });
	}
}

export class LegacySourceArchiveModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TracekeeperPlugin,
		private readonly preview: LegacySourceArchivePreview,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-modal-content');
		this.titleEl.setText(ui('归档旧版 Source 分段', 'Archive legacy Source segments'));
		contentEl.createEl('p', {
			text: ui(
				'归档会使用 Obsidian 原生移动，把已验证的旧分段移入 02_archive；不会永久删除。',
				'Archiving uses Obsidian-native moves into 02_archive; it never permanently deletes files.'
			),
			cls: 'tracekeeper-view__description',
		});
		contentEl.createEl('p', { text: ui(`${this.preview.items.length} 个旧分段待归档。`, `${this.preview.items.length} legacy segments to archive.`) });
		const list = contentEl.createEl('ul');
		for (const item of this.preview.items.slice(0, 20)) {
			list.createEl('li', { text: `${item.oldPath} → ${item.destinationPath}` });
		}
		if (this.preview.items.length > 20) {
			contentEl.createEl('p', { text: ui(`另有 ${this.preview.items.length - 20} 项。`, `${this.preview.items.length - 20} more items.`) });
		}
		const actions = contentEl.createDiv({ cls: 'tracekeeper-action-row' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			text: ui('确认移入 Archive', 'Move to Archive'),
			cls: 'mod-warning',
		});
		confirm.disabled = !this.preview.canApply;
		confirm.addEventListener('click', () => {
			void this.apply(confirm);
		});
		cancel.focus();
	}

	private async apply(button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		try {
			const result = await this.plugin.archiveLegacySources(this.preview, this.preview.confirmationToken);
			new Notice(ui(
				`已归档并验证 ${result.verifiedCount} 个旧 Source。`,
				`Archived and verified ${result.verifiedCount} legacy Sources.`
			));
			this.close();
		} catch (error) {
			new Notice(reportUiFailure(error, {
				context: 'tracekeeper failed to archive legacy Source segments',
				fallback: { zh: '归档旧版 Source 失败。', en: 'Failed to archive legacy Sources.' },
			}));
			button.disabled = false;
		}
	}
}
