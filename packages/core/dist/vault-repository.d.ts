import { type VaultPath } from './knowledge-index';
export type VaultFileVersion = string;
export interface VaultTextFile {
    path: VaultPath;
    content: string;
    version: VaultFileVersion;
    size: number;
    modifiedAt: string;
}
export interface VaultWriteReceipt {
    path: VaultPath;
    version: VaultFileVersion;
    size: number;
    modifiedAt: string;
}
export interface VaultTextMetadata {
    path: VaultPath;
    version: VaultFileVersion;
    size: number;
    modifiedAt: string;
}
export interface VaultRepository {
    readText(relativePath: VaultPath): Promise<VaultTextFile | null>;
    createText(relativePath: VaultPath, content: string): Promise<VaultWriteReceipt>;
    replaceText(relativePath: VaultPath, expectedVersion: VaultFileVersion, content: string): Promise<VaultWriteReceipt>;
    listMarkdown(scope?: VaultPath): Promise<readonly VaultTextMetadata[]>;
}
export interface NodeFsVaultRepositoryOptions {
    vaultRoot: string;
    allowHidden?: boolean;
    protectedDirectoryName?: string;
}
export declare class NodeFsVaultRepository implements VaultRepository {
    private readonly vaultRoot;
    private readonly allowHidden;
    private readonly protectedDirectoryName;
    constructor(options: NodeFsVaultRepositoryOptions);
    private normalizeRelativePath;
    private resolveRelativePath;
    private assertNoSymlinkSegments;
    private computeVersionFromStats;
    private sameFileIdentity;
    private readStats;
    private assertExpectedVersion;
    private writeAtomicText;
    private isMarkdownFile;
    private isSafeSegment;
    private walkMarkdownNotes;
    readText(relativePath: VaultPath): Promise<VaultTextFile | null>;
    createText(relativePath: VaultPath, content: string): Promise<VaultWriteReceipt>;
    replaceText(relativePath: VaultPath, expectedVersion: VaultFileVersion, content: string): Promise<VaultWriteReceipt>;
    listMarkdown(scope?: VaultPath): Promise<readonly VaultTextMetadata[]>;
}
