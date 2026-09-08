import path from 'node:path';
import type { RuntimeLogItem } from './runtime-log-model';
import { App, Modal, Setting } from 'obsidian';
import { createVaultOperationJournal, logBackupSummary, logStorageIsActive, logMigrationPending, exportLogDiagnostics, cancelLogMigration, previewLogMigration, migrateLogStorage, restoreVaultBackup, type LogMigrationPreview } from '@tracekeeper/core';
import { ui } from '../../ui/localization';
export interface LogManagementHost {
	getVaultRoot(): string;
	pause(): Promise<void>;
	resume(): Promise<void>;
	automatic(): boolean;
	setAutomatic(enabled: boolean): Promise<void>;
	archive(): Promise<number>;
	pickFolder(): Promise<string | null>;
	activityStats(): {
		files: number;
		bytes: number;
	};
	history(query: {
		from?: string;
		until?: string;
		operation?: string;
		status?: string;
		cursor?: string;
	}): Promise<{
		items: RuntimeLogItem[];
		cursor: string | null;
		generation: string;
	}>;
}
export class LogManagementModal extends Modal {
	private busy = false;
	private preview: LogMigrationPreview | null = null;
	private backupPath = '';
	private restorePath = '';
	private message = '';
	private historyQuery = { from: '', until: '', operation: '', status: '' };
	private historyRows: RuntimeLogItem[] = [];
	private historyCursor: string | null = null;
	private historyOpen = false;
	constructor(app: App, private readonly host: LogManagementHost) { super(app); }
	onOpen(): void { void this.render(); }
	private async action(work: () => Promise<void>): Promise<void> {
		if (this.busy)
			return;
		this.busy = true;
		this.message = ui('正在处理…', 'Working…');
		await this.render();
		try {
			await work();
		}
		catch {
			this.message = ui('操作未完成。原始数据已保留，请检查备份、存储空间或完整性后重试。', 'Operation did not finish. Original data is retained; check the backup, free space or integrity before retrying.');
		}
		finally {
			this.busy = false;
			await this.render();
		}
	}
	private async render(): Promise<void> {
		const { contentEl } = this;
		const active = logStorageIsActive(this.host.getVaultRoot()), pending = logMigrationPending(this.host.getVaultRoot());
		contentEl.empty();
		this.titleEl.setText(ui('日志管理', 'Log management'));
		const status = contentEl.createEl('p', { text: this.message, attr: { role: 'status', 'aria-live': 'polite' } });
		try {
			const summary = await createVaultOperationJournal(this.host.getVaultRoot()).inspect();
			contentEl.createEl('p',{text:active?ui('隐藏日志存储已启用。','Hidden log storage is active.'):ui('当前使用旧版目录；迁移后启用无损归档。','Legacy storage is active; migrate before lossless archival.')});
			if(summary.maintenance!=='idle') contentEl.createEl('p',{text:ui('归档准备尚未完成，可重新打开插件或重建归档索引继续。','Archive preparation requires attention; reload the plugin or rebuild the archive index to continue.')});
			contentEl.createEl('p', { text: ui(`热记录 ${summary.hot} · 冷记录 ${summary.cold} · 归档分片 ${summary.segments}`, `Hot ${summary.hot} · Cold ${summary.cold} · Segments ${summary.segments}`) });
			if (summary.issues.length)
				contentEl.createEl('p', { text: ui('部分记录需要完整性检查。', 'Some records need an integrity check.') });
			const activity = this.host.activityStats(), backup = await logBackupSummary(this.host.getVaultRoot());
			if (!this.backupPath && backup.directory) this.backupPath = backup.directory;
			const kib = (bytes: number) => (bytes / 1024).toFixed(1);
			contentEl.createEl('p', { text: ui(`热层 ${summary.hot_files} 个文件 / ${kib(summary.hot_bytes)} KiB；冷层 ${summary.cold_files} 个文件 / ${kib(summary.cold_bytes)} KiB。活动 ${activity.files} 个文件 / ${kib(activity.bytes)} KiB；迁移备份 ${backup.count} 份 / ${kib(backup.bytes)} KiB。`, `Hot ${summary.hot_files} files / ${kib(summary.hot_bytes)} KiB; cold ${summary.cold_files} files / ${kib(summary.cold_bytes)} KiB. Activity ${activity.files} files / ${kib(activity.bytes)} KiB; migration backups ${backup.count} / ${kib(backup.bytes)} KiB.`) });
			if (summary.attention.length) {
				const list = contentEl.createEl('ul');
				for (const row of summary.attention.slice(0, 20))
					list.createEl('li', { text: `${row.id} · ${row.status} · ${ui('请在对应任务或维护界面检查并继续。', 'Inspect and continue in the owning task or maintenance view.')}` });
			}
		}
		catch {
			status.setText(ui('日志索引或密钥需要检查；不会自动覆盖。', 'The log index or key needs inspection; it will not be overwritten automatically.'));
		}
		new Setting(contentEl).setName(ui('自动无损归档', 'Automatic lossless archival')).setDesc(ui('迁移后，对完成满七天的记录归档；活动历史删除仍需确认。', 'After migration, archive completed records after seven days; activity deletion still requires confirmation.')).addToggle(toggle => toggle.setValue(this.host.automatic()).setDisabled(this.busy).onChange(value => this.host.setAutomatic(value)));
		new Setting(contentEl).setName(ui('维护', 'Maintenance'))
			.addButton(button => button.setButtonText(ui('立即归档', 'Archive now')).setDisabled(this.busy || !active).onClick(() => this.action(async () => { const count = await this.host.archive(); this.message = ui(`已归档 ${count} 条记录。`, `Archived ${count} records.`); })))
			.addButton(button => button.setButtonText(ui('完整性检查', 'Check integrity')).setDisabled(this.busy).onClick(() => this.action(async () => { await createVaultOperationJournal(this.host.getVaultRoot()).verifyStorage(); this.message = ui('完整性检查通过。', 'Integrity check passed.'); })))
			.addButton(button => button.setButtonText(ui('重建归档索引', 'Rebuild archive index')).setDisabled(this.busy || !active).onClick(() => this.action(async () => { await createVaultOperationJournal(this.host.getVaultRoot()).repairArchive(); this.message = ui('归档索引已校验并重建。', 'Archive index verified and rebuilt.'); })));
		const history = contentEl.createEl('details');
		history.open = this.historyOpen;
		history.addEventListener('toggle', () => { this.historyOpen = history.open; });
		history.createEl('summary', { text: ui('查询完整活动历史', 'Query complete activity history') });
		for (const key of ['from', 'until', 'operation', 'status'] as const)
			new Setting(history).setName(({ from: ui('开始日期 UTC', 'From date UTC'), until: ui('结束日期 UTC', 'Until date UTC'), operation: ui('操作 ID', 'Operation ID'), status: ui('状态', 'Status') })[key]).addText(text => text.setValue(this.historyQuery[key]).setDisabled(this.busy).onChange(value => { this.historyQuery[key] = value.trim(); this.historyCursor = null; }));
		const load = async (cursor?: string) => { const result = await this.host.history({ ...this.historyQuery, cursor }); this.historyRows = result.items; this.historyCursor = result.cursor; this.message = ui(`已加载 ${result.items.length} 条活动。`, `Loaded ${result.items.length} activity records.`); };
		new Setting(history).addButton(button => button.setButtonText(ui('查询', 'Search')).setDisabled(this.busy).onClick(() => this.action(() => load()))).addButton(button => button.setButtonText(ui('下一页', 'Next page')).setDisabled(this.busy || !this.historyCursor).onClick(() => this.action(() => load(this.historyCursor!))));
		for (const row of this.historyRows)
			history.createEl('p', { text: `${new Date(row.time).toISOString()} · ${row.title} · ${row.status}` });
		new Setting(contentEl).setName(ui('脱敏诊断', 'Redacted diagnostics')).setDesc(ui('导出计数、状态和问题摘要。', 'Export counts, status and issue summaries.')).addButton(button => button.setButtonText(ui('导出诊断', 'Export diagnostics')).setDisabled(this.busy).onClick(() => this.action(async () => {
			const parent = await this.host.pickFolder();
			if (!parent)
				return;
			await exportLogDiagnostics(this.host.getVaultRoot(), path.join(parent, `tracekeeper-log-diagnostics-${Date.now()}.json`));
			this.message = ui('诊断摘要已导出。', 'Diagnostic summary exported.');
		})));
		new Setting(contentEl).setName(active ? ui('恢复使用的备份目录', 'Backup directory for restore') : pending ? ui('继续迁移的原备份目录', 'Original backup for migration recovery') : ui('迁移备份位置', 'Migration backup location')).setDesc(active || pending ? ui('使用已验证的完整 Vault 备份。', 'Use the verified whole-Vault backup.') : ui('选择 Vault 外尚不存在的本地目录；备份包含完整 Vault。', 'Use a new local directory outside the Vault. The backup includes the entire Vault.')).addText(text => text.setValue(this.backupPath).setDisabled(this.busy).onChange(value => { this.backupPath = value.trim(); this.preview = null; })).addButton(button => button.setButtonText(ui('选择位置', 'Choose location')).setDisabled(this.busy).onClick(async () => {
			const parent = await this.host.pickFolder();
			if (parent) {
				this.backupPath = active || pending ? parent : path.join(parent, `tracekeeper-backup-${Date.now()}`);
				this.preview = null;
				await this.render();
			}
		}));
		new Setting(contentEl).setName(ui('迁入隐藏日志目录', 'Migrate to hidden log storage'))
			.addButton(button => button.setButtonText(ui('生成预览', 'Preview')).setDisabled(this.busy).onClick(() => this.action(async () => { this.preview = await previewLogMigration(this.host.getVaultRoot()); this.message = this.preview.resumable ? ui('检测到未完成迁移，使用原备份目录继续；不会重新创建备份。','An interrupted migration can resume using its original backup; no new backup will be created.') : this.preview.canMigrate ? ui(`将迁移 ${this.preview.files} 个日志文件；完整备份约 ${((this.preview.backupBytes ?? 0) / 1024 / 1024).toFixed(1)} MiB。原知识内容保持不变。`, `Migrate ${this.preview.files} log files; whole-Vault backup approximately ${((this.preview.backupBytes ?? 0) / 1024 / 1024).toFixed(1)} MiB. Knowledge contents stay unchanged.`) : ui('迁移暂不可用：可能已经迁移，或仍有未完成操作需要处理。', 'Migration is unavailable: storage may already be migrated or operations need attention.'); })))
			.addButton(button => button.setButtonText(ui('备份并确认迁移', 'Back up and migrate')).setDisabled(this.busy || !this.preview?.canMigrate || !this.backupPath).onClick(() => this.action(async () => {
			if (!this.preview?.canMigrate || !this.backupPath)
				throw new Error('A fresh migration preview is required.');
			await this.host.pause();
			try {
				await migrateLogStorage(this.host.getVaultRoot(), this.backupPath, this.preview!);
				this.preview = null;
				this.message = ui('备份和迁移已验证完成。', 'Backup and migration verified.');
			}
			finally {
				await this.host.resume();
			}
		})));
		new Setting(contentEl).addButton(button => button.setButtonText(ui('取消尚未切换的迁移', 'Cancel inactive migration')).setDisabled(this.busy || !pending || active).onClick(() => this.action(async () => { await cancelLogMigration(this.host.getVaultRoot()); this.preview = null; this.message = ui('暂存迁移已取消，原日志和备份保留。', 'Staged migration cancelled; original logs and backup retained.'); })));
		new Setting(contentEl).setName(ui('恢复目标目录', 'Restore destination')).setDesc(ui('从上方备份恢复到新的 Vault 目录，不覆盖当前 Vault。', 'Restore the backup above into a new Vault directory; the current Vault is not overwritten.')).addText(text => text.setValue(this.restorePath).setDisabled(this.busy).onChange(value => { this.restorePath = value.trim(); }));
		new Setting(contentEl).addButton(button => button.setButtonText(ui('校验并恢复副本', 'Verify and restore a copy')).setDisabled(this.busy).onClick(() => this.action(async () => { await restoreVaultBackup(this.backupPath, this.restorePath); this.message = ui('恢复副本已验证。停用当前 Vault 后，可打开恢复后的 Vault。', 'Restored copy verified. Stop the current Vault before opening the restored Vault.'); })));
	}
}
