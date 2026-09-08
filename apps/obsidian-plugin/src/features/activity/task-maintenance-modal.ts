import path from 'node:path';
import { App, Modal, Setting } from 'obsidian';
import { applyTaskMigration, readVerifiedSourceReplacements, createVaultOperationJournal, diagnoseTaskRelations, maintainTaskNavigation, pendingTaskMigrations, previewTaskMigration, readTaskVaultSnapshot, taskTargets, type TaskMaintenancePreview, type VaultRepository } from '@tracekeeper/core';
import { ui } from '../../ui/localization';

export interface TaskMaintenanceHost {
	vaultRoot: string;
	repository: VaultRepository;
	pause(): Promise<void>;
	resume(): Promise<void>;
	pickFolder(): Promise<string | null>;
	link(target: string, source: string): string;
}

/** 原生人类入口；预览只读，确认后才暂停 Runtime、备份并提交。 */
export class TaskMaintenanceModal extends Modal {
	private preview: TaskMaintenancePreview | null = null;
	private backup = '';
	private busy = false;
	private message = '';
	constructor(app: App, private readonly host: TaskMaintenanceHost) { super(app); }
	onOpen(): void { this.render(); }
	private async action(work: () => Promise<void>): Promise<void> {
		if (this.busy) return;
		this.busy = true; this.render();
		try { await work(); }
		catch (error) {
			const message = error instanceof Error ? error.message : '';
			this.message = /preview is stale|Vault changed/.test(message) ? ui('文件已变化，迁移预览已失效。请重新生成预览。', 'Files changed and the migration preview is stale. Generate a new preview.')
				: /Backup verification|verified backup/.test(message) ? ui('完整备份校验未通过。请检查原备份，修复后再继续迁移。', 'Whole-Vault backup verification failed. Inspect the original backup before continuing.')
				: /Migration file changed/.test(message) ? ui('迁移中的文件已被修改，已停止覆盖。请核对文件后继续原迁移。', 'A migration file was edited. Inspect it before continuing the original migration.')
				: /unfinished|Recover|in-flight|未完成|在途/.test(message) ? ui('存在待恢复操作。请先在对应业务入口处理，再生成迁移预览。', 'Operations need recovery. Resolve them in their owning workflow before previewing migration.')
				: ui('操作未完成，数据与恢复回执已保留。请先检查中断迁移和备份。', 'Operation did not finish; data and recovery receipts are retained. Inspect interrupted migration and backup first.');
		}
		finally { this.busy = false; this.render(); }
	}
	private render(): void {
		this.titleEl.setText(ui('任务关系维护', 'Task relation maintenance'));
		const el = this.contentEl; el.empty();
		el.createEl('p', { text: ui('统一维护任务关系与项目／月份导航。历史迁移包含完整 Vault 备份；不会删除任务或修改知识正文。', 'Maintain authoritative task relations and project/month navigation. Historical migration includes a whole-Vault backup, retaining tasks and knowledge bodies.') });
		el.createEl('p', { text: this.message, attr: { role: 'status', 'aria-live': 'polite' } });
		new Setting(el).setName(ui('完整备份目录', 'Whole-Vault backup directory')).addText(text => text.setValue(this.backup).setDisabled(this.busy).onChange(value => { this.backup = value.trim(); })).addButton(button => button.setButtonText(ui('选择位置', 'Choose location')).setDisabled(this.busy).onClick(() => this.action(async () => {
			const folder = await this.host.pickFolder();
			if (folder) this.backup = path.join(folder, `tracekeeper-task-backup-${Date.now()}`);
		})));
		new Setting(el).setName(ui('检查与迁移', 'Inspect and migrate'))
			.addButton(button => button.setButtonText(ui('只读预览', 'Read-only preview')).setDisabled(this.busy).onClick(() => this.action(async () => {
				const files = await readTaskVaultSnapshot(this.host.repository);
				this.preview = previewTaskMigration(files, [], this.host.link, await readVerifiedSourceReplacements(this.host.vaultRoot, new Map(taskTargets(files).map((target) => [target.path, target.contentHash!]))));
				const journal = createVaultOperationJournal(this.host.vaultRoot);
				const health = await journal.inspect();
				if (health.attention.length || health.issues.length) {
					this.preview = null;
					throw new Error(ui('先在对应业务入口恢复未完成操作或检查损坏记录，再生成迁移预览。', 'Recover unfinished operations or inspect corrupt records in their owning workflow before migration.'));
				}
				const issues = diagnoseTaskRelations(taskTargets(files));
				this.message = ui(`诊断 ${issues.length} 项；旧任务 ${this.preview.legacy_tasks} 个，预计修改 ${this.preview.changes.length} 个文件。`, `${issues.length} diagnostics; ${this.preview.legacy_tasks} historical tasks; ${this.preview.changes.length} planned file changes.`);
			})))
			.addButton(button => button.setButtonText(ui('检查中断迁移', 'Inspect interrupted migration')).setDisabled(this.busy).onClick(() => this.action(async () => {
				const pending = await pendingTaskMigrations(this.host.vaultRoot);
				if (pending.length > 1) throw new Error(ui('存在多个未完成迁移，需要检查回执。', 'Multiple unfinished migrations require receipt inspection.'));
				this.preview = pending[0]?.preview ?? null;
				if (pending[0]) this.backup = pending[0].backup;
				this.message = pending.length ? ui('已加载原计划及备份。核对明细后确认继续。', 'Original plan and backup loaded. Review the changes before continuing.') : ui('没有未完成迁移。', 'No interrupted migration.');
			})))
			.addButton(button => button.setButtonText(ui('确认备份并迁移／继续', 'Confirm backup and migrate / resume')).setDisabled(this.busy || !this.preview || Boolean(this.preview.blocked.length)).onClick(() => this.action(async () => {
				if (!this.preview) return;
				if (!this.backup) throw new Error(ui('请选择 Vault 外的完整备份目录。', 'Choose a whole-Vault backup directory outside the Vault.'));
				await this.host.pause();
				try {
					await applyTaskMigration({ vault: this.host.vaultRoot, repository: this.host.repository, preview: this.preview, backup: this.backup });
					this.preview = null;
					this.message = ui('迁移已验证完成。备份保留；需要回退时，请在日志管理中恢复到新 Vault。', 'Migration verified. Backup retained; use Log management to restore into a new Vault if needed.');
				} finally { await this.host.resume(); }
			})));
		new Setting(el).setName(ui('任务导航', 'Task navigation')).addButton(button => button.setButtonText(ui('重建导航', 'Rebuild navigation')).setDisabled(this.busy).onClick(() => this.action(async () => {
			await this.host.pause();
			try {
				const journal = createVaultOperationJournal(this.host.vaultRoot);
				if ((await journal.listRecoverable()).length) throw new Error(ui('先完成在途操作。', 'Finish pending operations first.'));
				const result = await maintainTaskNavigation(this.host.repository, this.host.link);
				this.message = ui(`更新 ${result.updated} 个文件；待处理 ${result.issues.length} 项。`, `Updated ${result.updated} files; ${result.issues.length} items need attention.`);
				if (result.issues.length) this.message += '\n' + result.issues.map((row) => `${row.path}: ${row.reason}`).join('\n');
			} finally { await this.host.resume(); }
		})));
		if (this.preview) {
			const list = el.createEl('ul');
			for (const row of this.preview.blocked) list.createEl('li', { text: `${ui('阻塞', 'Blocked')}: ${row.path} — ${row.reason}` });
			for (const row of this.preview.unresolved) list.createEl('li', { text: `${row.status}: ${row.task} → ${row.path}` });
			for (const row of this.preview.changes) {
				const details = el.createEl('details');
				details.createEl('summary', { text: `${row.kind === 'wiki_identity' ? ui('Wiki 身份元数据', 'Wiki identity metadata') : row.kind === 'task' ? ui('任务关系', 'Task relations') : ui('项目与月份导航', 'Project and month navigation')}: ${row.path}` });
				details.createEl('pre', { text: row.after });
			}
		}
	}
}
