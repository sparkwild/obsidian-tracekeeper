import { App, Notice, TFile, TFolder } from 'obsidian';
import {
	KNOWLEDGE_INDEX_PATH,
	KNOWLEDGE_MEMORY_INDEX_PATH,
	KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
	LEGACY_TOP_LEVEL_DIRS,
	TRACEKEEPER_REVIEW_QUEUE_DIR,
	TRACEKEEPER_TASKS_DIR,
	buildLegacyMigrationReviewPath,
	enrichLegacyMarkdownContent,
	getLegacyStructureTarget,
	renderLegacyMigrationReview,
	type LegacyStructureKind,
} from '@tracekeeper/core';
import { ui } from '../../ui/localization';

export interface MemoryInitializationPlan {
	foldersToCreate: string[];
	filesToCreate: string[];
	missingAuditLog: boolean;
}

export type StructureState = 'initialized' | 'partial' | 'missing' | 'legacy_detected';

export type LegacyStructureAction = 'copy_rebuild' | 'review_conflict' | 'review_existing' | 'skip_existing' | 'unmapped';

export interface TracekeeperStructureStatus {
	state: StructureState;
	label: string;
	detail: string;
	missingFolders: string[];
	missingFiles: string[];
	missingCount: number;
	totalCount: number;
}

export interface LegacyStructurePlanItem {
	oldPath: string;
	newPath: string;
	kind: LegacyStructureKind;
	action: LegacyStructureAction;
	reason: string;
	isMarkdown: boolean;
}

export interface LegacyStructurePlan {
	migrationId: string;
	legacyRoots: string[];
	items: LegacyStructurePlanItem[];
	fileCount: number;
	markdownCount: number;
	nonMarkdownCount: number;
	copyCount: number;
	conflictCount: number;
	reviewCount: number;
	skipCount: number;
	uncoveredCount: number;
}

export interface StructureOrganizerSnapshot {
	basePlan: MemoryInitializationPlan;
	legacyPlan: LegacyStructurePlan;
	state: 'ready' | 'needs_repair' | 'legacy_detected';
}

export interface LegacyMigrationResult {
	migrationId: string;
	copiedCount: number;
	conflictCount: number;
	reviewCount: number;
	reportMdPath: string;
	reportJsonPath: string;
}

export interface LegacyCleanupResult {
	cleanupId: string;
	trashedRoots: string[];
	missingRoots: string[];
	failedRoots: Array<{ path: string; error: string }>;
	reportPath: string;
	taskPath: string;
}

export interface LegacyMigrationControllerHost {
	initializeMemoryStructure(plan: MemoryInitializationPlan): Promise<void>;
	ensureFolderExists(path: string): Promise<void>;
	ensureFileDoesNotExist(path: string, content: string): Promise<void>;
	normalizeVaultPath(path: string): string;
	appendToAuditLog(entry: string): Promise<void>;
	refreshGovernanceViews(): Promise<void>;
}

const vaultParentFolder = (path: string): string => path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');

export class LegacyMigrationController {
	constructor(
		private readonly app: App,
		private readonly host: LegacyMigrationControllerHost
	) {}

getLegacyRootFolders(): string[] {
		return LEGACY_TOP_LEVEL_DIRS.filter((root) => this.app.vault.getAbstractFileByPath(root) instanceof TFolder);
	}

createStructureMigrationId(): string {
		return `legacy-rebuild-${new Date().toISOString().replace(/[:.]/g, '-')}`;
	}

private createStructureCleanupId(): string {
		return `legacy-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
	}

async buildLegacyStructurePlan(migrationId: string): Promise<LegacyStructurePlan> {
		const legacyRoots = this.getLegacyRootFolders();
		const files = legacyRoots.flatMap((root) => {
			const folder = this.app.vault.getAbstractFileByPath(root);
			return folder instanceof TFolder ? this.collectFiles(folder) : [];
		});
		const items: LegacyStructurePlanItem[] = [];

		for (const file of files) {
			const target = getLegacyStructureTarget(file.path);
			const isMarkdown = file.extension === 'md';
			if (!target) {
				if (await this.legacyMigrationReviewExists(file.path, migrationId)) {
					items.push({
						oldPath: file.path,
						newPath: 'unmapped',
						kind: 'archive',
						action: 'review_existing',
						reason: ui('已存在迁移变更提案。', 'A migration change proposal already exists.'),
						isMarkdown,
					});
					continue;
				}
				items.push({
					oldPath: file.path,
					newPath: '',
					kind: 'archive',
					action: 'unmapped',
					reason: ui('没有稳定的新结构映射。', 'No stable current-architecture mapping exists.'),
					isMarkdown: file.extension === 'md',
				});
				continue;
			}

			const targetFile = this.app.vault.getAbstractFileByPath(target.newPath);
			if (await this.legacyMigrationReviewExists(file.path, migrationId)) {
				items.push({
					oldPath: file.path,
					newPath: target.newPath,
					kind: target.kind,
					action: 'review_existing',
					reason: ui('已存在迁移变更提案。', 'A migration change proposal already exists.'),
					isMarkdown,
				});
				continue;
			}

			if (targetFile && !(targetFile instanceof TFile)) {
				items.push({
					oldPath: file.path,
					newPath: target.newPath,
					kind: target.kind,
					action: 'review_conflict',
					reason: ui('新版目标路径已被文件夹占用。', 'The current-architecture target path is occupied by a folder.'),
					isMarkdown,
				});
				continue;
			}

			if (targetFile instanceof TFile) {
				const sameContent = await this.legacyTargetMatches(file, targetFile, {
					migrationId,
					oldPath: file.path,
					newPath: target.newPath,
					kind: target.kind,
				});
				items.push({
					oldPath: file.path,
					newPath: target.newPath,
					kind: target.kind,
					action: sameContent ? 'skip_existing' : 'review_conflict',
					reason: sameContent
						? ui('新版目标已存在。', 'The current-architecture target already exists.')
						: ui('新版目标已存在且内容不同。', 'The current-architecture target exists with different content.'),
					isMarkdown,
				});
				continue;
			}

			items.push({
				oldPath: file.path,
				newPath: target.newPath,
				kind: target.kind,
				action: 'copy_rebuild',
				reason: ui('可复制重建到新结构。', 'Can be copied into the current architecture.'),
				isMarkdown,
			});
		}

		return {
			migrationId,
			legacyRoots,
			items,
			fileCount: files.length,
			markdownCount: files.filter((file) => file.extension === 'md').length,
			nonMarkdownCount: files.filter((file) => file.extension !== 'md').length,
			copyCount: items.filter((item) => item.action === 'copy_rebuild').length,
			conflictCount: items.filter((item) => item.action === 'review_conflict').length,
			reviewCount: items.filter((item) => item.action === 'review_conflict' || item.action === 'review_existing').length,
			skipCount: items.filter((item) => item.action === 'skip_existing').length,
			uncoveredCount: items.filter((item) => item.action === 'unmapped').length,
		};
	}

private collectFiles(folder: TFolder): TFile[] {
		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile) {
				files.push(child);
			} else if (child instanceof TFolder) {
				files.push(...this.collectFiles(child));
			}
		}
		return files.sort((a, b) => a.path.localeCompare(b.path));
	}

private async legacyMigrationReviewExists(oldPath: string, migrationId: string): Promise<boolean> {
		const directPath = buildLegacyMigrationReviewPath(migrationId, oldPath);
		if (this.app.vault.getAbstractFileByPath(directPath) instanceof TFile) {
			return true;
		}
		const folder = this.app.vault.getAbstractFileByPath(TRACEKEEPER_REVIEW_QUEUE_DIR);
		if (!(folder instanceof TFolder)) {
			return false;
		}
		for (const file of this.collectFiles(folder).filter((item) => item.extension === 'md')) {
			const content = await this.app.vault.cachedRead(file);
			if (content.includes(`source_path: ${JSON.stringify(oldPath)}`)) {
				return true;
			}
		}
		return false;
	}

private async legacyTargetMatches(
		source: TFile,
		target: TFile,
		input: {
			migrationId: string;
			oldPath: string;
			newPath: string;
			kind: LegacyStructureKind;
		}
	): Promise<boolean> {
		if (source.extension === 'md') {
			const sourceText = await this.app.vault.cachedRead(source);
			const targetText = await this.app.vault.cachedRead(target);
			const enriched = enrichLegacyMarkdownContent(sourceText, input);
			return targetText === sourceText || targetText === enriched || targetText.includes(`Migrated from: \`${source.path}\``);
		}
		const sourceBytes = new Uint8Array(await this.app.vault.readBinary(source));
		const targetBytes = new Uint8Array(await this.app.vault.readBinary(target));
		if (sourceBytes.length !== targetBytes.length) {
			return false;
		}
		return sourceBytes.every((value, index) => value === targetBytes[index]);
	}

async migrateLegacyStructure(snapshot: StructureOrganizerSnapshot): Promise<LegacyMigrationResult> {
		if (snapshot.basePlan.foldersToCreate.length > 0 || snapshot.basePlan.filesToCreate.length > 0) {
			await this.host.initializeMemoryStructure(snapshot.basePlan);
		}

		const plan = snapshot.legacyPlan;
		let copiedCount = 0;
		let reviewCount = 0;

		for (const item of plan.items) {
			if (item.action === 'copy_rebuild') {
				await this.copyLegacyStructureItem(item, plan.migrationId);
				copiedCount += 1;
			} else if (item.action === 'review_conflict' || item.action === 'unmapped') {
				await this.writeLegacyMigrationReview(item, plan.migrationId);
				reviewCount += 1;
			}
		}

		const result = await this.writeLegacyMigrationReports(plan, {
			migrationId: plan.migrationId,
			copiedCount,
			conflictCount: plan.conflictCount,
			reviewCount,
			reportMdPath: '',
			reportJsonPath: '',
		});
		await this.host.appendToAuditLog(this.renderLegacyMigrationAuditEvent(result));
		await this.host.refreshGovernanceViews();
		new Notice(ui('旧目录内容已复制重建，旧目录尚未清理。', 'Legacy content rebuilt. Legacy folders are not cleaned yet.'));
		return result;
	}

async cleanupLegacyStructure(migrationId: string): Promise<LegacyCleanupResult> {
		const plan = await this.buildLegacyStructurePlan(migrationId);
		const blocking = plan.items.filter((item) =>
			item.action === 'copy_rebuild' || item.action === 'review_conflict' || item.action === 'unmapped'
		);
		if (blocking.length > 0) {
			throw new Error(`Cannot clean legacy folders: ${blocking.length} file(s) are not covered by migration targets or review items.`);
		}

		const cleanupId = this.createStructureCleanupId();
		const trashedRoots: string[] = [];
		const missingRoots: string[] = [];
		const failedRoots: Array<{ path: string; error: string }> = [];

		for (const root of LEGACY_TOP_LEVEL_DIRS) {
			const folder = this.app.vault.getAbstractFileByPath(root);
			if (!folder) {
				missingRoots.push(root);
				continue;
			}
			try {
				await this.app.vault.trash(folder, true);
				trashedRoots.push(root);
			} catch (error) {
				failedRoots.push({
					path: root,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		const reportPath = await this.writeLegacyCleanupReport({
			cleanupId,
			trashedRoots,
			missingRoots,
			failedRoots,
			reportPath: '',
			taskPath: '',
		});
		const taskPath = await this.writeLegacyCleanupTask(cleanupId, migrationId, reportPath, trashedRoots, failedRoots);
		const result: LegacyCleanupResult = {
			cleanupId,
			trashedRoots,
			missingRoots,
			failedRoots,
			reportPath,
			taskPath,
		};
		await this.host.appendToAuditLog(this.renderLegacyCleanupAuditEvent(result));
		await this.host.refreshGovernanceViews();
		if (failedRoots.length > 0) {
			new Notice(ui('旧目录清理部分失败，请查看清理报告。', 'Legacy cleanup partially failed. Review the cleanup report.'));
		} else {
			new Notice(ui('旧目录已移入系统回收站。', 'Legacy folders moved to system trash.'));
		}
		return result;
	}

private async copyLegacyStructureItem(item: LegacyStructurePlanItem, migrationId: string): Promise<void> {
		if (!item.newPath) {
			return;
		}
		const source = this.app.vault.getAbstractFileByPath(item.oldPath);
		if (!(source instanceof TFile)) {
			throw new Error(`Legacy source is not a file: ${item.oldPath}`);
		}
		await this.host.ensureFolderExists(vaultParentFolder(item.newPath));
		if (item.isMarkdown) {
			const content = await this.app.vault.cachedRead(source);
			const next = enrichLegacyMarkdownContent(content, {
				migrationId,
				oldPath: item.oldPath,
				newPath: item.newPath,
				kind: item.kind,
			});
			await this.host.ensureFileDoesNotExist(item.newPath, next);
			return;
		}
		const bytes = await this.app.vault.readBinary(source);
		await this.app.vault.createBinary(this.host.normalizeVaultPath(item.newPath), bytes);
	}

private async writeLegacyMigrationReview(item: LegacyStructurePlanItem, migrationId: string): Promise<void> {
		const reviewPath = buildLegacyMigrationReviewPath(migrationId, item.oldPath);
		if (this.app.vault.getAbstractFileByPath(reviewPath)) {
			return;
		}
		await this.host.ensureFolderExists(vaultParentFolder(reviewPath));
		const sourceContent = await this.readLegacyEvidenceText(item.oldPath);
		const content = renderLegacyMigrationReview({
			migrationId,
			oldPath: item.oldPath,
			newPath: item.newPath || 'unmapped',
			kind: item.kind,
			reason: item.reason,
			sourceContent,
		});
		await this.host.ensureFileDoesNotExist(reviewPath, content);
	}

private async readLegacyEvidenceText(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return '';
		}
		try {
			return await this.app.vault.cachedRead(file);
		} catch {
			return `[binary file: ${path}]`;
		}
	}

private async writeLegacyMigrationReports(
		plan: LegacyStructurePlan,
		result: LegacyMigrationResult
	): Promise<LegacyMigrationResult> {
		const reportDir = '00_tracekeeper/control/migrations';
		await this.host.ensureFolderExists(reportDir);
		const reportMdPath = `${reportDir}/${plan.migrationId}.md`;
		const reportJsonPath = `${reportDir}/${plan.migrationId}.json`;
		const summary = {
			migration_id: plan.migrationId,
			legacy_roots: plan.legacyRoots,
			copied_count: result.copiedCount,
			conflict_count: plan.conflictCount,
			review_count: result.reviewCount,
			trashed_roots: [],
			report_paths: {
				migration_markdown: reportMdPath,
				migration_json: reportJsonPath,
			},
			old_directories_untouched: true,
			old_directories_cleaned: false,
		};
		const json = JSON.stringify({
			summary,
			items: plan.items,
		}, null, 2);
		const conflictLines = plan.items
			.filter((item) => item.action === 'review_conflict')
			.map((item) => `- \`${item.oldPath}\` -> \`${item.newPath}\`: ${item.reason}`);
		const md = [
			'# Legacy structure migration report',
			'',
			`- Migration id: \`${plan.migrationId}\``,
			`- Legacy roots: ${plan.legacyRoots.length}`,
			`- Files scanned: ${plan.fileCount}`,
			`- Copied: ${result.copiedCount}`,
			`- Conflicts queued: ${result.reviewCount}`,
			`- Uncovered: ${plan.uncoveredCount}`,
			'- Old directories untouched: yes',
			'',
			'## Legacy roots',
			'',
			...(plan.legacyRoots.length > 0 ? plan.legacyRoots.map((root) => `- \`${root}\``) : ['None']),
			'',
			'## Conflicts',
			'',
			...(conflictLines.length > 0 ? conflictLines : ['None']),
			'',
		].join('\n');
		await this.host.ensureFileDoesNotExist(reportMdPath, md);
		await this.host.ensureFileDoesNotExist(reportJsonPath, json);
		return {
			...result,
			reportMdPath,
			reportJsonPath,
		};
	}

private async writeLegacyCleanupReport(input: LegacyCleanupResult): Promise<string> {
		const reportDir = '00_tracekeeper/control/migrations';
		await this.host.ensureFolderExists(reportDir);
		const reportPath = `${reportDir}/${input.cleanupId}.md`;
		const content = [
			'# Legacy directory cleanup report',
			'',
			`- Cleanup id: \`${input.cleanupId}\``,
			'- Method: Obsidian system trash',
			`- Trashed legacy directories: ${input.trashedRoots.length}`,
			`- Missing legacy directories: ${input.missingRoots.length}`,
			`- Failed: ${input.failedRoots.length}`,
			'- Old directories cleaned: yes',
			'',
			'## Trashed',
			'',
			...(input.trashedRoots.length > 0 ? input.trashedRoots.map((root) => `- \`${root}\``) : ['None']),
			'',
			'## Failed',
			'',
			...(input.failedRoots.length > 0 ? input.failedRoots.map((item) => `- \`${item.path}\`: ${item.error}`) : ['None']),
			'',
		].join('\n');
		await this.host.ensureFileDoesNotExist(reportPath, content);
		return reportPath;
	}

private async writeLegacyCleanupTask(
		cleanupId: string,
		migrationId: string,
		cleanupReportPath: string,
		trashedRoots: string[],
		failedRoots: Array<{ path: string; error: string }>
	): Promise<string> {
		const now = new Date().toISOString();
		const taskId = `obs_task_${cleanupId.replace(/^legacy-cleanup-/, '').replace(/[^0-9A-Za-z]+/g, '_')}`;
		const taskPath = `${TRACEKEEPER_TASKS_DIR}/${taskId}.md`;
		await this.host.ensureFolderExists(TRACEKEEPER_TASKS_DIR);
		const content = [
			'---',
			'agent: "tracekeeper"',
			'client: "obsidian"',
			'objective: "整理旧 Tracekeeper 目录结构到统一知识体系"',
			'related_project: "tracekeeper_legacy_structure_migration"',
			`session_id: "${migrationId}"`,
			`started_at: "${now}"`,
			`finished_at: "${now}"`,
			failedRoots.length > 0 ? 'status: "warning"' : 'status: "completed"',
			`task_id: "${taskId}"`,
			'title: "旧目录迁移与结构清理"',
			'tool: "tracekeeper.structure_organizer"',
			'type: "agent-task"',
			'memory_writes:',
			`  - "${cleanupReportPath}"`,
			`  - "00_tracekeeper/control/migrations/${migrationId}.md"`,
			'---',
			'',
			'# 旧目录迁移与结构清理',
			'',
			'## Summary',
			'',
			`- 旧目录清理：${trashedRoots.length} 个目录已移入系统回收站。`,
			`- 清理失败：${failedRoots.length} 个。`,
			`- 迁移报告：[[00_tracekeeper/control/migrations/${migrationId}|${migrationId}]]`,
			`- 清理报告：[[${cleanupReportPath.replace(/\.md$/i, '')}|${cleanupId}]]`,
			'',
			'## Graph links',
			'',
			`- [[${KNOWLEDGE_INDEX_PATH.replace(/\.md$/i, '')}|Knowledge index]]`,
			`- [[${KNOWLEDGE_MEMORY_INDEX_PATH.replace(/\.md$/i, '')}|Memory index]]`,
			`- [[${KNOWLEDGE_WIKI_HUBS_INDEX_PATH.replace(/\.md$/i, '')}|Wiki hubs]]`,
			'',
		].join('\n');
		await this.host.ensureFileDoesNotExist(taskPath, content);
		return taskPath;
	}

private renderLegacyMigrationAuditEvent(result: LegacyMigrationResult): string {
		const now = new Date().toISOString();
		return (
			`## ${now}\n` +
			`action: legacy_structure.migrate\n` +
			`actor: user\n` +
			`result: success\n` +
			`migration_id: ${result.migrationId}\n` +
			`copied_count: ${result.copiedCount}\n` +
			`review_count: ${result.reviewCount}\n` +
			`target: ${result.reportMdPath}\n` +
			`timestamp: ${now}\n\n`
		);
	}

private renderLegacyCleanupAuditEvent(result: LegacyCleanupResult): string {
		const now = new Date().toISOString();
		return (
			`## ${now}\n` +
			`action: legacy_structure.cleanup\n` +
			`actor: user\n` +
			`result: ${result.failedRoots.length > 0 ? 'partial' : 'success'}\n` +
			`cleanup_id: ${result.cleanupId}\n` +
			`trashed_roots: ${result.trashedRoots.length}\n` +
			`failed_roots: ${result.failedRoots.length}\n` +
			`task_id: ${result.taskPath.replace(`${TRACEKEEPER_TASKS_DIR}/`, '').replace(/\.md$/i, '')}\n` +
			`target: ${result.reportPath}\n` +
			`timestamp: ${now}\n\n`
		);
	}
}
