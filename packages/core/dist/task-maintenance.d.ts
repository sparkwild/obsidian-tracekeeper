import type { VaultRepository, VaultTextFile } from './vault-repository';
import { type TaskRelationTarget } from './task-record';
export declare const TASK_INDEX_ROOT = "00_tracekeeper/work/task_index";
export declare const TASK_INDEX_PATH = "00_tracekeeper/work/index.md";
/** 扫描只读文件快照；所有后续解析与预览绑定同一批内容。 */
export declare function readTaskVaultSnapshot(repository: VaultRepository): Promise<VaultTextFile[]>;
export declare function taskTargets(files: readonly VaultTextFile[]): TaskRelationTarget[];
/** 全库查重，受控目录外的同身份任务不能被当作不存在。 */
export declare function resolveTaskIdentity(targets: readonly TaskRelationTarget[], taskId: string, writable?: boolean): string | null;
export declare function findTaskById(repository: VaultRepository, taskId: string, writable?: boolean): Promise<VaultTextFile | null>;
export declare function requireWritableTaskV2(repository: VaultRepository, taskId: string): Promise<VaultTextFile | null>;
export interface TaskFileChange {
    path: string;
    before: string | null;
    after: string;
    kind: 'wiki_identity' | 'task' | 'navigation';
}
export interface TaskMaintenancePreview {
    version: 1;
    id: string;
    inventory_hash: string;
    changes: TaskFileChange[];
    blocked: Array<{
        path: string;
        reason: string;
    }>;
    unresolved: Array<{
        task: string;
        path: string;
        status: string;
    }>;
    legacy_tasks: number;
}
/** 导航只表达组织关系，不为无成果任务生成知识引用。 */
export declare function planTaskNavigation(files: readonly VaultTextFile[], link?: (target: string, source: string) => string): TaskFileChange[];
export declare function previewTaskMigration(files: readonly VaultTextFile[], blockedPaths?: readonly string[], link?: (target: string, source: string) => string, sourceReplacements?: ReadonlyMap<string, string>): TaskMaintenancePreview;
export interface TaskMigrationReceipt {
    version: 1;
    status: 'in_progress' | 'completed';
    backup: string;
    preview: TaskMaintenancePreview;
    applied: string[];
}
/** 人类确认入口调用；回执持久化后逐项 CAS，崩溃后只继续同一计划。 */
export declare function applyTaskMigration(input: {
    vault: string;
    repository: VaultRepository;
    preview: TaskMaintenancePreview;
    backup: string;
    failure?: (phase: string, path: string) => void | Promise<void>;
}): Promise<TaskMigrationReceipt>;
/** 成功业务后的派生维护；只处理 V2，不隐式迁移 Wiki 或历史任务。 */
export declare function maintainTaskNavigation(repository: VaultRepository, link?: (target: string, source: string) => string, canWrite?: () => boolean): Promise<{
    updated: number;
    issues: Array<{
        path: string;
        reason: string;
    }>;
    deferred?: boolean;
}>;
/** 未完成迁移仅回到原批准计划；普通诊断不触发恢复写入。 */
export declare function pendingTaskMigrations(vault: string): Promise<TaskMigrationReceipt[]>;
/** 文件落盘与迁移终态之间的窗口仍受迁移所有权保护。 */
export declare function assertTaskMigrationCommitted(journal: import('./operation-journal').OperationJournal, fields: Readonly<Record<string, unknown>>): Promise<void>;
