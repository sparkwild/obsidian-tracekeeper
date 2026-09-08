import { NodeFileOperationJournal } from './operation-journal';
export declare const LOG_STORAGE_ROOT = ".tracekeeper/logs";
export declare function logDirectory(vault: string): string;
export declare function isOperationalLogPath(relative: string): boolean;
export declare function createVaultOperationJournal(vault: string): NodeFileOperationJournal;
/** 历史逻辑引用保持稳定，只有该适配器负责解析物理存储位置。 */
export declare class OperationalLogRepository {
    readonly vault: string;
    constructor(vault: string);
    private name;
    readText(logical: string): Promise<string | null>;
    replaceText(logical: string, expectedHash: string | null, content: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
}
export interface VaultBackupManifest {
    version: 1;
    createdAt: string;
    files: Array<{
        name: string;
        bytes: number;
        hash: string;
    }>;
    directories?: string[];
}
export declare function backupVault(vault: string, destination: string): Promise<VaultBackupManifest>;
/** Read-only validation shared by migration continuation and full restore. */
export declare function verifyVaultBackup(backup: string): Promise<VaultBackupManifest>;
export declare function restoreVaultBackup(backup: string, destination: string): Promise<void>;
export interface LogMigrationPreview {
    version: 1;
    inventoryHash: string;
    files: number;
    bytes: number;
    canMigrate: boolean;
    issues: string[];
    resumable?: boolean;
    backupFiles?: number;
    backupBytes?: number;
}
export declare function previewLogMigration(vault: string): Promise<LogMigrationPreview>;
export declare function logStorageIsActive(vault: string): boolean;
/** 同一 Vault 的迁移与取消共用租约，避免两个窗口争用同一暂存目录。 */
export declare function migrateLogStorage(vault: string, destination: string, preview: LogMigrationPreview): Promise<void>;
export declare function cancelLogMigration(vault: string): Promise<void>;
/** 诊断导出只包含计数、状态和脱敏问题，不携带日志正文、密钥或本机 Vault 路径。 */
export declare function exportLogDiagnostics(vault: string, destination: string): Promise<void>;
export declare function logBackupSummary(vault: string): Promise<{
    count: number;
    bytes: number;
    available: boolean;
    directory?: string;
}>;
export declare function logMigrationPending(vault: string): boolean;
