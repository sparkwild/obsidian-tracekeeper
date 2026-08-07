import { type VaultRepository } from '@tracekeeper/core';
import { type AuditEventInput } from './audit-persistence';
export interface VaultRecordAdapterContext {
    vaultConfigDir?: string;
    vaultRepository?: VaultRepository;
}
export interface VaultRecordWriteResult {
    path: string;
    activity_path: string;
    status: string;
    warnings: string[];
}
export interface VaultRecordAdapterDependencies {
    agentActivityPath: string;
    buildMarkdownNote(frontmatter: Record<string, unknown>, body: string): string;
}
export declare class VaultRecordAdapter {
    private readonly dependencies;
    constructor(dependencies: VaultRecordAdapterDependencies);
    buildAndWriteNote(vaultRoot: string, toolName: string, allowedDir: string, filename: string, frontmatter: Record<string, unknown>, body: string, taskId: string | null, context: VaultRecordAdapterContext, metadata?: Record<string, unknown>, operationId?: string): VaultRecordWriteResult;
    buildAndWriteNoteAsync(vaultRoot: string, toolName: string, allowedDir: string, filename: string, frontmatter: Record<string, unknown>, body: string, taskId: string | null, context: VaultRecordAdapterContext, metadata?: Record<string, unknown>, operationId?: string): Promise<VaultRecordWriteResult>;
    findOperationOwnedNote(vaultRoot: string, allowedDir: string, filename: string, operationField: string, operationId: string, context: VaultRecordAdapterContext): VaultRecordWriteResult | null;
    findOperationOwnedNoteAsync(vaultRoot: string, allowedDir: string, filename: string, operationField: string, operationId: string, context: VaultRecordAdapterContext): Promise<VaultRecordWriteResult | null>;
}
export type { AuditEventInput };
