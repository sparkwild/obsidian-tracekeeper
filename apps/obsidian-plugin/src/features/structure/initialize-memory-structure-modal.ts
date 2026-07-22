import { App, Modal, Notice } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type {
	LegacyCleanupResult,
	LegacyMigrationResult,
	LegacyStructurePlan,
	StructureOrganizerSnapshot,
} from './legacy-migration-controller';
import { ui } from '../../ui/localization';

export class InitializeMemoryStructureModal extends Modal {
	private snapshot: StructureOrganizerSnapshot;
	private migrationResult: LegacyMigrationResult | null = null;
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
		const summary = contentEl.createDiv({ cls: 'tracekeeper-structure-check-summary tracekeeper-detail-grid' });
		this.renderFact(summary, ui('基础结构', 'Base structure'), baseMissingCount === 0 ? ui('完整', 'Ready') : ui(`${baseMissingCount} 项缺失`, `${baseMissingCount} missing`));
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
			this.renderBaseRepair(contentEl, baseMissingCount);
			return;
		}

		this.renderLegacyDetected(contentEl, legacyPlan, baseMissingCount);
	}

	private renderBaseRepair(contentEl: HTMLElement, missingCount: number): void {
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

	private renderLegacyDetected(contentEl: HTMLElement, plan: LegacyStructurePlan, baseMissingCount: number): void {
		const readyForCleanup = plan.legacyRoots.length > 0 && plan.copyCount === 0 && plan.conflictCount === 0 && plan.uncoveredCount === 0;
		const detail = contentEl.createDiv({ cls: 'tracekeeper-card' });
		detail.createEl('h3', { text: ui('发现旧目录结构', 'Legacy structure found') });
		detail.createEl('p', {
			text: readyForCleanup
				? ui(
					'旧目录内容已能在新结构中找到，可直接确认清理旧目录。',
					'Legacy content is already covered by the current structure. You can confirm cleanup now.'
				)
				: ui(
					`将先复制重建 ${plan.copyCount} 个文件；${plan.conflictCount} 个冲突会进入审核队列；旧目录会保留到你再次确认清理。`,
					`${plan.copyCount} file(s) will be copied first; ${plan.conflictCount} conflict(s) will go to review; legacy folders remain until you confirm cleanup.`
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
		this.renderFact(facts, ui('已存在', 'Existing'), String(plan.skipCount));
		this.renderFact(facts, ui('基础缺失', 'Base missing'), String(baseMissingCount));

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: ui('取消', 'Cancel') }).addEventListener('click', () => this.close());
		if (readyForCleanup) {
			const cleanup = actions.createEl('button', { text: ui('确认清理旧目录', 'Confirm cleanup'), cls: 'mod-warning' });
			cleanup.disabled = this.busy;
			cleanup.addEventListener('click', () => {
				void (async () => {
					this.busy = true;
					this.render();
					try {
						this.cleanupResult = await this.options.plugin.cleanupLegacyStructure(plan.migrationId);
					} catch (error) {
						console.error('tracekeeper failed to cleanup legacy structure', error);
						new Notice(ui('旧目录清理失败，请查看控制台。', 'Legacy cleanup failed. Check the console.'));
					} finally {
						this.busy = false;
						this.render();
					}
				})();
			});
			return;
		}
		const migrate = actions.createEl('button', { text: ui('复制重建', 'Copy and rebuild'), cls: 'mod-cta' });
		migrate.disabled = this.busy || plan.fileCount === 0;
		migrate.addEventListener('click', () => {
			void (async () => {
				this.busy = true;
				this.render();
				try {
					this.migrationResult = await this.options.plugin.migrateLegacyStructure(this.snapshot);
				} catch (error) {
					console.error('tracekeeper failed to migrate legacy structure', error);
					new Notice(ui('旧目录复制重建失败。', 'Legacy copy and rebuild failed.'));
				} finally {
					this.busy = false;
					this.render();
				}
			})();
		});
	}

	private renderMigrationDone(contentEl: HTMLElement, result: LegacyMigrationResult): void {
		const card = contentEl.createDiv({ cls: 'tracekeeper-card' });
		card.createEl('h3', { text: ui('复制重建已完成', 'Copy and rebuild complete') });
		card.createEl('p', {
			text: ui(
				'旧目录还没有清理。确认清理后，旧目录会移入系统回收站。',
				'Legacy folders have not been cleaned yet. Confirm cleanup to move them to system trash.'
			),
		});
		const facts = card.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderFact(facts, ui('已复制', 'Copied'), String(result.copiedCount));
		this.renderFact(facts, ui('审核项', 'Review items'), String(result.reviewCount));
		this.renderFact(facts, ui('迁移报告', 'Migration report'), result.reportMdPath);

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: ui('稍后清理', 'Clean later') }).addEventListener('click', () => this.close());
		const cleanup = actions.createEl('button', { text: ui('确认清理旧目录', 'Confirm cleanup'), cls: 'mod-warning' });
		cleanup.disabled = this.busy;
		cleanup.addEventListener('click', () => {
			void (async () => {
				this.busy = true;
				this.render();
				try {
					this.cleanupResult = await this.options.plugin.cleanupLegacyStructure(result.migrationId);
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
		item.createEl('span', { text: label });
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
