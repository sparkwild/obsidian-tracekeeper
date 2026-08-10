import { App, Modal, Notice } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type {
	LegacyCleanupPreview,
	LegacyCleanupResult,
	LegacyMigrationResult,
	LegacyStructurePlan,
	StructureOrganizerSnapshot,
} from './legacy-migration-controller';
import { ui } from '../../ui/localization';

export class InitializeMemoryStructureModal extends Modal {
	private snapshot: StructureOrganizerSnapshot;
	private migrationResult: LegacyMigrationResult | null = null;
	private cleanupPreview: LegacyCleanupPreview | null = null;
	private cleanupResult: LegacyCleanupResult | null = null;
	private busy = false;

	constructor(
		app: App,
		private options: {
			plugin: TracekeeperPlugin;
			snapshot: StructureOrganizerSnapshot;
		}
	) {
		super(app);
		this.snapshot = options.snapshot;
	}

	onOpen(): void {
		void super.onOpen();
		this.render();
	}

	private render(): void {
		this.titleEl.setText(ui('知识库结构校验', 'Knowledge structure check'));

		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('p', {
			text: ui(
				'Tracekeeper 会先检查基础入口；发现旧目录时，可在这里预览并整理到统一知识体系。',
				'Tracekeeper checks base entries first. When legacy folders are found, you can preview and organize them here.'
			),
		});

		const basePlan = this.snapshot.basePlan;
		const legacyPlan = this.snapshot.legacyPlan;
		const baseMissingCount = basePlan.foldersToCreate.length + basePlan.filesToCreate.length;
		const invalidFiles = basePlan.invalidFiles ?? [];
		const summary = contentEl.createDiv({ cls: 'tracekeeper-structure-check-summary tracekeeper-detail-grid' });
		this.renderFact(
			summary,
			ui('基础结构', 'Base structure'),
			invalidFiles.length > 0
				? ui(`${invalidFiles.length} 个路径无效`, `${invalidFiles.length} invalid path(s)`)
				: baseMissingCount === 0
					? ui('完整', 'Ready')
					: ui(`${baseMissingCount} 项缺失`, `${baseMissingCount} missing`)
		);
		this.renderFact(summary, ui('旧目录', 'Legacy folders'), legacyPlan.legacyRoots.length === 0 ? ui('未发现', 'None') : ui(`${legacyPlan.legacyRoots.length} 个`, `${legacyPlan.legacyRoots.length}`));
		this.renderFact(summary, ui('旧文件', 'Legacy files'), String(legacyPlan.fileCount));
		this.renderFact(summary, ui('冲突', 'Conflicts'), String(legacyPlan.conflictCount));

		if (this.cleanupResult) {
			this.renderCleanupDone(contentEl, this.cleanupResult);
			return;
		}

		if (this.migrationResult) {
			this.renderMigrationDone(contentEl, this.migrationResult);
			return;
		}

		if (this.snapshot.state === 'ready') {
			this.renderEmptyMessage(contentEl, {
				title: ui('结构清晰，无需整理。', 'Structure is clean.'),
				text: ui(
					'当前知识库只有新版 Tracekeeper 顶层结构，没有需要处理的旧目录。',
					'The vault only has the current Tracekeeper top-level structure. No legacy folders need attention.'
				),
			});
			this.renderCloseAction(contentEl);
			return;
		}

		if (this.snapshot.state === 'needs_repair') {
			this.renderBaseRepair(contentEl, baseMissingCount, invalidFiles);
			return;
		}

		this.renderLegacyDetected(contentEl, legacyPlan, baseMissingCount, invalidFiles);
	}

	private renderBaseRepair(contentEl: HTMLElement, missingCount: number, invalidFiles: string[]): void {
		if (invalidFiles.length > 0) {
			this.renderInvalidBasePaths(contentEl, invalidFiles);
			this.renderCloseAction(contentEl);
			return;
		}
		this.renderEmptyMessage(contentEl, {
			title: ui('需要补齐基础结构。', 'Base structure needs repair.'),
			text: ui(
				`将创建 ${missingCount} 个必要入口；不会移动、删除或重写已有笔记。`,
				`${missingCount} required item(s) will be created. Existing notes will not be moved, deleted, or rewritten.`
			),
		});
		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: ui('取消', 'Cancel') });
		cancel.addEventListener('click', () => this.close());

		const confirm = actions.createEl('button', { text: ui('补齐基础结构', 'Repair base structure'), cls: 'mod-cta' });
		confirm.disabled = this.busy;
		confirm.addEventListener('click', () => {
			void (async () => {
				this.busy = true;
				this.render();
				try {
					await this.options.plugin.initializeMemoryStructure(this.snapshot.basePlan);
					this.snapshot = await this.options.plugin.buildStructureOrganizerSnapshot(this.snapshot.legacyPlan.migrationId);
				} catch (error) {
					console.error('tracekeeper failed to repair structure from modal', error);
					new Notice(ui('基础结构补齐失败。', 'Base structure repair failed.'));
				} finally {
					this.busy = false;
					this.render();
				}
			})();
		});
	}

	private renderLegacyDetected(
		contentEl: HTMLElement,
		plan: LegacyStructurePlan,
		baseMissingCount: number,
		invalidFiles: string[]
	): void {
		const detail = contentEl.createDiv({ cls: 'tracekeeper-card' });
		detail.createEl('h3', { text: ui('发现旧目录结构', 'Legacy structure found') });
		detail.createEl('p', {
			text: plan.recovery
				? ui(
					'发现可恢复的迁移日志。Tracekeeper 会按已记录状态继续，不会冒认或覆盖目标。',
					'A recoverable migration journal was found. Tracekeeper will resume from recorded state without adopting or overwriting targets.'
				)
				: ui(
					`将通过 Obsidian 原生移动 ${plan.moveCount} 个文件；${plan.conflictCount} 个冲突会进入知识变更审核。迁移与清理分别确认。`,
					`${plan.moveCount} file(s) will be moved through Obsidian; ${plan.conflictCount} conflict(s) will enter Knowledge Change Review. Migration and cleanup require separate confirmations.`
				),
		});
		if (plan.uncoveredCount > 0) {
			detail.createEl('p', {
				text: ui(
					`有 ${plan.uncoveredCount} 个文件没有稳定映射，会阻止清理。`,
					`${plan.uncoveredCount} file(s) have no stable mapping and will block cleanup.`
				),
				cls: 'tracekeeper-view__description',
			});
		}
		const facts = detail.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderFact(facts, ui('Markdown', 'Markdown'), String(plan.markdownCount));
		this.renderFact(facts, ui('其他文件', 'Other files'), String(plan.nonMarkdownCount));
		this.renderFact(facts, ui('原生移动', 'Native moves'), String(plan.moveCount));
		this.renderFact(facts, ui('已移动/恢复', 'Moved/recovery'), String(plan.alreadyMovedCount));
		this.renderFact(facts, ui('基础缺失', 'Base missing'), String(baseMissingCount));
		this.renderFact(facts, ui('计划哈希', 'Plan hash'), plan.planHash);
		this.renderFact(
			facts,
			ui('链接预检', 'Link preflight'),
			plan.linkCapability.status
		);

		const mapping = detail.createDiv({ cls: 'tracekeeper-structure-migration-preview' });
		mapping.createEl('h4', { text: ui('精确迁移预览', 'Exact migration preview') });
		const list = mapping.createEl('ul');
		for (const item of plan.items) {
			list.createEl('li', {
				text: `${item.oldPath} → ${item.newPath || ui('未映射', 'unmapped')} [${item.action}]`,
			});
		}

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: ui('取消', 'Cancel') }).addEventListener('click', () => this.close());
		if (invalidFiles.length > 0) {
			this.renderInvalidBasePaths(detail, invalidFiles);
			return;
		}
		if (baseMissingCount > 0) {
			const repair = actions.createEl('button', {
				text: ui('先补齐基础结构', 'Repair base structure first'),
				cls: 'mod-cta',
			});
			repair.disabled = this.busy;
			repair.addEventListener('click', () => {
				void (async () => {
					this.busy = true;
					this.render();
					try {
						await this.options.plugin.initializeMemoryStructure(this.snapshot.basePlan);
						this.snapshot = await this.options.plugin.buildStructureOrganizerSnapshot(
							plan.migrationId
						);
					} catch (error) {
						console.error('tracekeeper failed to repair structure before migration', error);
						new Notice(ui('基础结构补齐失败。', 'Base structure repair failed.'));
					} finally {
						this.busy = false;
						this.render();
					}
				})();
			});
			return;
		}

		if (
			plan.linkCapability.status === 'required'
			|| plan.linkCapability.status === 'blocked'
		) {
			detail.createEl('p', {
				text: ui(
					'Obsidian 可能会询问是否更新链接；预检会等待你的选择。选择“不做更新”可验证关闭自动更新时的阻断行为。此探针不会授权移动任何旧目录文件。',
					'Obsidian may ask whether to update links, and the preflight waits for that choice. Choose “Do not update” to verify the blocked behavior when automatic updates are disabled. The probe does not authorize moving any legacy file.'
				),
				cls: 'tracekeeper-view__description',
			});
			const preflight = actions.createEl('button', {
				text: ui('运行链接安全预检', 'Run link safety preflight'),
				cls: 'mod-cta',
			});
			preflight.disabled =
				this.busy
				|| plan.metadataState !== 'ready'
				|| plan.linkCapability.inboundLinkCount === 0;
			preflight.addEventListener('click', () => {
				void (async () => {
					this.busy = true;
					this.render();
					try {
						const refreshed = await this.options.plugin.runLegacyLinkPreflight(plan);
						this.snapshot = {
							...this.snapshot,
							legacyPlan: refreshed,
						};
					} catch (error) {
						console.error('tracekeeper failed to run legacy link preflight', error);
						new Notice(ui('链接安全预检失败。', 'Link safety preflight failed.'));
					} finally {
						this.busy = false;
						this.render();
					}
				})();
			});
			return;
		}

		const migrate = actions.createEl('button', {
			text: plan.recovery
				? ui('继续已记录迁移', 'Resume journaled migration')
				: ui('确认原生迁移', 'Confirm native migration'),
			cls: 'mod-cta',
		});
		migrate.disabled = this.busy || plan.fileCount === 0;
		migrate.addEventListener('click', () => {
			void (async () => {
				this.busy = true;
				this.render();
				try {
					this.migrationResult = await this.options.plugin.migrateLegacyStructure(this.snapshot);
				} catch (error) {
					console.error('tracekeeper failed to migrate legacy structure', error);
					new Notice(ui('旧目录原生迁移失败，可从日志恢复。', 'Native legacy migration failed and can be resumed from its journal.'));
				} finally {
					this.busy = false;
					this.render();
				}
			})();
		});
	}

	private renderInvalidBasePaths(contentEl: HTMLElement, invalidFiles: string[]): void {
		const blocked = contentEl.createDiv({ cls: 'tracekeeper-card' });
		blocked.createEl('h3', { text: ui('基础结构修复已阻断', 'Base structure repair blocked') });
		blocked.createEl('p', {
			text: ui(
				'以下必要文件路径被文件夹或其他非文件对象占用。Tracekeeper 不会删除或覆盖它们；请在 Obsidian 中处理路径冲突后重新运行结构检查。',
				'The required file paths below are occupied by folders or other non-file entries. Tracekeeper will not delete or overwrite them. Resolve the path conflicts in Obsidian, then run structure check again.'
			),
		});
		const list = blocked.createEl('ul');
		for (const path of invalidFiles) list.createEl('li', { text: path });
	}

	private renderMigrationDone(contentEl: HTMLElement, result: LegacyMigrationResult): void {
		const card = contentEl.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('原生迁移已写入日志', 'Native migration journal updated') });
		card.createEl('p', {
			text: ui(
				'旧目录尚未清理。只有全部文件验证通过且旧根目录无剩余文件时，才能另行预览并确认清理。',
				'Legacy folders are not cleaned yet. Cleanup requires a separate preview and confirmation after every file is verified and no files remain.'
			),
		});
		const facts = card.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderFact(facts, ui('已移动', 'Moved'), String(result.movedCount));
		this.renderFact(facts, ui('已验证', 'Verified'), String(result.verifiedCount));
		this.renderFact(facts, ui('阻塞', 'Blocked'), String(result.blockedCount));
		this.renderFact(facts, ui('失败', 'Failed'), String(result.failedCount));
		this.renderFact(facts, ui('变更提案', 'Change proposals'), String(result.reviewCount));
		this.renderFact(facts, ui('迁移报告', 'Migration report'), result.reportMdPath);
		this.renderFact(facts, ui('操作日志', 'Operation journal'), result.journalPath);

		if (this.cleanupPreview) {
			const preview = card.createDiv({ cls: 'tracekeeper-card' });
			preview.createEl('h4', { text: ui('清理预览', 'Cleanup preview') });
			this.renderFact(
				preview,
				ui('可清理目录', 'Eligible roots'),
				String(this.cleanupPreview.eligibleRoots.length)
			);
			this.renderFact(
				preview,
				ui('剩余文件', 'Remaining files'),
				String(this.cleanupPreview.remainingFiles.length)
			);
			this.renderFact(
				preview,
				ui('已缺失目录', 'Missing roots'),
				String(this.cleanupPreview.missingRoots.length)
			);
			this.renderFact(
				preview,
				ui('阻塞项', 'Blocking items'),
				String(this.cleanupPreview.blockingItems.length)
			);
		}

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: ui('稍后清理', 'Clean later') }).addEventListener('click', () => this.close());
		const cleanup = actions.createEl('button', {
			text: this.cleanupPreview
				? ui('确认清理已验证空目录', 'Confirm cleanup of verified empty roots')
				: ui('预览清理', 'Preview cleanup'),
			cls: this.cleanupPreview ? 'mod-warning' : 'mod-cta',
		});
		cleanup.disabled =
			this.busy
				|| !result.cleanupAvailable
				|| Boolean(this.cleanupPreview && !this.cleanupPreview.canCleanup);
		cleanup.addEventListener('click', () => {
			void (async () => {
				this.busy = true;
				this.render();
				try {
					if (!this.cleanupPreview) {
						this.cleanupPreview =
							await this.options.plugin.previewLegacyStructureCleanup(
								result.migrationId
							);
					} else {
						this.cleanupResult = await this.options.plugin.cleanupLegacyStructure(
							this.cleanupPreview
						);
					}
				} catch (error) {
					console.error('tracekeeper failed to cleanup legacy structure', error);
					new Notice(ui('旧目录清理失败，请查看控制台。', 'Legacy cleanup failed. Check the console.'));
				} finally {
					this.busy = false;
					this.render();
				}
			})();
		});
	}

	private renderCleanupDone(contentEl: HTMLElement, result: LegacyCleanupResult): void {
		const card = contentEl.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('整理完成', 'Cleanup complete') });
		card.createEl('p', {
			text: ui(
				`已清理 ${result.trashedRoots.length} 个旧目录，任务记录和清理报告已写入。`,
				`${result.trashedRoots.length} legacy folder(s) cleaned. Task record and cleanup report were written.`
			),
		});
		const facts = card.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderFact(facts, ui('清理报告', 'Cleanup report'), result.reportPath);
		this.renderFact(facts, ui('任务记录', 'Task record'), result.taskPath);
		this.renderFact(facts, ui('失败', 'Failed'), String(result.failedRoots.length));
		this.renderCloseAction(contentEl);
	}

	private renderEmptyMessage(contentEl: HTMLElement, input: { title: string; text: string }): void {
		const card = contentEl.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: input.title });
		card.createEl('p', { text: input.text });
	}

	private renderFact(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createSpan({ text: label });
		item.createEl('strong', { text: value || ui('无', 'None') });
	}

	private renderCloseAction(contentEl: HTMLElement): void {
		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: ui('关闭', 'Close'), cls: 'mod-cta' }).addEventListener('click', () => this.close());
	}

	onClose(): void {
		super.onClose();
	}
}
