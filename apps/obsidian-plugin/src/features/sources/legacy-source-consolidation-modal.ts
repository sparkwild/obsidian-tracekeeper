import { Modal, Notice, type App } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import { ui } from '../../ui/localization';
import { reportUiFailure } from '../../ui/user-facing-error';
import type {
	LegacySourceArchivePreview,
	LegacySourceConsolidationPreview,
} from './legacy-source-consolidation-controller';
import {
	SourceArchivePurgeError,
	type SourceArchivePurgeErrorCode,
	type SourceArchivePurgePreview,
	type SourceArchivePurgeProgress,
} from './source-archive-purge-controller';

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

export class SourceArchivePurgeModal extends Modal {
	private running = false;
	private statusEl: HTMLElement | null = null;
	private progressEl: HTMLProgressElement | null = null;
	private waitTimer: number | null = null;
	private lastProgress: SourceArchivePurgeProgress | null = null;
	private recoveryOperationId = '';
	private regenerateOnNextAction = false;

	constructor(
		app: App,
		private readonly plugin: TracekeeperPlugin,
		private readonly preview: SourceArchivePurgePreview | null,
		recoveryOperationId = '',
	) {
		super(app);
		this.recoveryOperationId = recoveryOperationId;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-modal-content');
		this.titleEl.setText(this.recoveryOperationId
			? ui('恢复 Source Archive 清理', 'Resume Source Archive cleanup')
			: ui('清理冗余 Source Archive', 'Clean redundant Source Archive'));
		contentEl.createEl('p', {
			text: ui(
				'仅包含已由完整日志证明、且在当前 Source part 中逐字节保留的归档副本。此操作与关系修复分开确认。',
				'Only archive copies proven by completed journals and preserved byte-for-byte in current Source parts are included. Cleanup is confirmed separately from relation repair.'
			),
			cls: 'tracekeeper-view__description',
		});
		const details = contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.detail(details, ui('可清理文件', 'Eligible files'), this.preview ? String(this.preview.items.length) : ui('从日志恢复', 'From journal'));
		this.detail(details, ui('阻塞文件', 'Blocked files'), this.preview ? String(this.preview.blocked.length) : '—');
		this.detail(details, ui('归档体积', 'Archive bytes'), this.preview ? this.formatBytes(this.preview.totalBytes) : '—');
		this.detail(details, ui('Obsidian 删除行为', 'Obsidian deletion behavior'), this.preview?.deletionBehavior ?? ui('保持当前设置', 'Current setting'));
		contentEl.createEl('p', {
			text: ui(
				'实际恢复能力与磁盘释放时机取决于当前 Obsidian“删除的文件”设置；文件处理完成后，完全为空的迁移目录树也会移入同一删除目标。本界面不承诺一定可恢复。',
				'Recoverability and disk reclamation depend on the current Obsidian deleted-files setting. Completely empty migration directory trees are moved to the same destination after file cleanup. This dialog does not promise recovery.'
			),
			cls: 'tracekeeper-view__description',
		});
		if (this.preview) {
			const list = contentEl.createEl('details');
			list.createEl('summary', { text: ui('查看清理清单', 'Review cleanup manifest') });
			const items = list.createEl('ul');
			for (const item of this.preview.items) items.createEl('li', { text: `${item.archivePath} → ${item.replacementPartPath}` });
		}
		this.progressEl = contentEl.createEl('progress');
		this.progressEl.max = Math.max(1, this.preview?.items.length ?? 1);
		this.progressEl.value = 0;
		this.statusEl = contentEl.createEl('p', {
			text: this.recoveryOperationId
				? ui('检测到已认领但未完成的清理操作；只会从持久化进度继续。', 'A claimed cleanup operation is incomplete; recovery continues only from durable progress.')
				: this.preview?.canApply
				? ui('预览有效，等待单独确认清理。', 'Preview is valid and awaits separate cleanup confirmation.')
				: ui('当前没有可安全清理的归档文件。', 'No archive file is currently safe to clean.'),
			cls: 'tracekeeper-view__description',
		});
		this.statusEl.setAttr('role', 'status');
		this.statusEl.setAttr('aria-live', 'polite');
		const actions = contentEl.createDiv({ cls: 'tracekeeper-action-row' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => {
			if (!this.running) this.close();
		});
		const confirm = actions.createEl('button', {
			text: this.recoveryOperationId
				? ui('继续未完成项', 'Continue unfinished items')
				: ui(`确认清理 ${this.preview?.items.length ?? 0} 项`, `Clean ${this.preview?.items.length ?? 0} items`),
			cls: 'mod-warning',
		});
		confirm.disabled = !this.recoveryOperationId && !this.preview?.canApply;
		confirm.addEventListener('click', () => void this.apply(confirm, cancel));
		cancel.focus();
	}

	close(): void {
		if (this.running) return;
		this.clearWaitTimer();
		super.close();
	}

	private async apply(confirm: HTMLButtonElement, cancel: HTMLButtonElement): Promise<void> {
		if (this.running) return;
		if (this.regenerateOnNextAction) {
			this.regenerateOnNextAction = false;
			confirm.disabled = true;
			try {
				const next = await this.plugin.previewSourceArchivePurge();
				this.close();
				new SourceArchivePurgeModal(this.app, this.plugin, next).open();
			} catch (error) {
				confirm.disabled = false;
				this.statusEl?.setText(reportUiFailure(error, {
					context: 'tracekeeper failed to regenerate Source Archive purge preview',
					fallback: { zh: '无法重新生成清理预览。', en: 'Failed to regenerate cleanup preview.' },
				}));
			}
			return;
		}
		this.running = true;
		confirm.disabled = true;
		cancel.disabled = true;
		try {
			this.armWaitTimer();
			const result = this.recoveryOperationId
				? await this.plugin.resumeSourceArchivePurge(this.recoveryOperationId, (progress) => this.renderProgress(progress))
				: await this.plugin.confirmSourceArchivePurge(
					this.preview as SourceArchivePurgePreview,
					(this.preview as SourceArchivePurgePreview).confirmationToken,
					(progress) => this.renderProgress(progress),
				);
			this.running = false;
			this.clearWaitTimer();
			cancel.disabled = false;
			cancel.setText(ui('完成', 'Done'));
			this.statusEl?.setText(ui(
				`清理结果：${result.status}；完成 ${result.completedCount}/${result.totalCount}，可恢复 ${result.resumableCount}，冲突 ${result.conflictCount}，结果未知 ${result.outcomeUnknownCount}；迁移根已清理 ${result.cleanedMigrationRootCount}、保留 ${result.retainedMigrationRootCount}、失败 ${result.failedMigrationRootCount}。`,
				`Cleanup result: ${result.status}; completed ${result.completedCount}/${result.totalCount}, resumable ${result.resumableCount}, conflicts ${result.conflictCount}, unknown outcomes ${result.outcomeUnknownCount}; migration roots cleaned ${result.cleanedMigrationRootCount}, retained ${result.retainedMigrationRootCount}, failed ${result.failedMigrationRootCount}.`
			));
			if (result.resumableCount > 0 || result.failedMigrationRootCount > 0) {
				this.recoveryOperationId = result.operationId;
				confirm.setText(ui('继续未完成项', 'Continue unfinished items'));
				confirm.disabled = false;
			} else if (result.conflictCount > 0) {
				this.regenerateOnNextAction = true;
				confirm.setText(ui('关闭并重新生成预览', 'Close and regenerate preview'));
				confirm.disabled = false;
			} else {
				confirm.remove();
			}
		} catch (error) {
			this.running = false;
			this.clearWaitTimer();
			cancel.disabled = false;
			if (error instanceof SourceArchivePurgeError) {
				this.renderPurgeError(error.code, error.message, confirm, cancel);
			} else {
				confirm.disabled = true;
				this.statusEl?.setText(reportUiFailure(error, {
					context: 'tracekeeper failed to clean redundant Source Archive files',
					fallback: {
						zh: '清理失败，旧确认已停用。请关闭后检查 Source 状态，再生成新预览。',
						en: 'Cleanup failed and the old confirmation is disabled. Close, inspect Source status, then generate a new preview.',
					},
				}));
				cancel.focus();
			}
		}
	}

	private renderPurgeError(
		code: SourceArchivePurgeErrorCode,
		message: string,
		confirm: HTMLButtonElement,
		cancel: HTMLButtonElement,
	): void {
		const canRegenerate = code === 'PREVIEW_EXPIRED' || code === 'PREVIEW_STALE' || code === 'NO_ELIGIBLE_ITEMS';
		if (canRegenerate) {
			this.regenerateOnNextAction = true;
			confirm.setText(ui('重新生成预览', 'Regenerate preview'));
			confirm.disabled = false;
			this.statusEl?.setText(code === 'PREVIEW_EXPIRED'
				? ui('清理预览已过期，尚未移动任何文件。请重新生成预览。', 'The cleanup preview expired and no file was moved. Regenerate the preview.')
				: code === 'PREVIEW_STALE'
					? ui('Source 或索引在预览后发生变化，尚未移动任何文件。请重新生成预览。', 'Source content or the index changed after preview; no file was moved. Regenerate the preview.')
					: ui('当前预览已没有可安全清理的文件，请重新检查。', 'This preview no longer contains safely cleanable files. Recheck with a new preview.'));
			cancel.focus();
			return;
		}
		confirm.disabled = true;
		this.statusEl?.setText(ui(
			`清理完整性检查失败（${code}），旧确认已停用。请关闭并检查记录。`,
			`Cleanup integrity check failed (${code}); the old confirmation is disabled. Close and inspect the records.`
		));
		console.error('tracekeeper Source Archive purge integrity error', code, message);
		cancel.focus();
	}

	private renderProgress(progress: SourceArchivePurgeProgress): void {
		this.lastProgress = progress;
		this.armWaitTimer();
		if (this.progressEl) this.progressEl.value = progress.completed;
		const phase = {
			preflight: ui('预检', 'Preflight'),
			claim: ui('认领操作', 'Claiming operation'),
			trash: ui('移入 Obsidian 删除目标', 'Using Obsidian trash'),
			verify: ui('验证替代 Source', 'Verifying replacement Source'),
			reindex: ui('重建索引并复检', 'Rebuilding index and rechecking'),
			cleanup: ui('清理空迁移目录树', 'Cleaning empty migration tree'),
			complete: ui('完成', 'Complete'),
		}[progress.phase];
		this.statusEl?.setText(`${phase} · ${progress.completed}/${progress.total}${progress.currentPath ? ` · ${progress.currentPath}` : ''}`);
	}

	private armWaitTimer(): void {
		this.clearWaitTimer();
		if (!this.running) return;
		this.waitTimer = window.setTimeout(() => {
			const progress = this.lastProgress;
			this.statusEl?.setText(ui(
				`正在等待文件锁或恢复步骤${progress ? ` · 最后阶段 ${progress.phase} · ${progress.completed}/${progress.total}` : ''}。`,
				`Waiting for a file lock or recovery step${progress ? ` · last phase ${progress.phase} · ${progress.completed}/${progress.total}` : ''}.`
			));
		}, 10_000);
	}

	private clearWaitTimer(): void {
		if (this.waitTimer !== null) window.clearTimeout(this.waitTimer);
		this.waitTimer = null;
	}

	private detail(container: HTMLElement, label: string, value: string): void {
		const row = container.createDiv({ cls: 'tracekeeper-detail' });
		row.createSpan({ text: label });
		row.createEl('strong', { text: value });
	}

	private formatBytes(value: number): string {
		if (value < 1024) return `${value} B`;
		if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
		return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
	}
}
