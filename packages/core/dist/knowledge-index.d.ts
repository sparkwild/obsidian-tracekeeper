import { type ScanResult, type ScannedNote } from './scan';
export declare const KNOWLEDGE_INDEX_VERSION = "1.0";
export type VaultPath = string;
export type FileVersion = string;
export type KnowledgeIndexState = 'initializing' | 'rebuilding' | 'ready';
export type VaultIndexEventKind = 'create' | 'modify' | 'delete' | 'rename';
export interface VaultIndexEventBase {
    path: VaultPath;
    fileVersion: FileVersion;
}
export interface CreateVaultIndexEvent extends VaultIndexEventBase {
    kind: 'create';
}
export interface ModifyVaultIndexEvent extends VaultIndexEventBase {
    kind: 'modify';
}
export interface DeleteVaultIndexEvent extends VaultIndexEventBase {
    kind: 'delete';
}
export interface RenameVaultIndexEvent {
    kind: 'rename';
    path: VaultPath;
    newPath: VaultPath;
    fileVersion: FileVersion;
}
export type VaultIndexEvent = CreateVaultIndexEvent | ModifyVaultIndexEvent | DeleteVaultIndexEvent | RenameVaultIndexEvent;
export interface IndexedWikilink {
    raw: string;
    target: string;
    alias?: string;
    heading?: string;
    line: number;
}
export interface IndexedKnowledgeNote {
    path: VaultPath;
    fileVersion: FileVersion;
    title: string;
    aliases: readonly string[];
    type: string | null;
    tags: readonly string[];
    frontmatter: Readonly<Record<string, unknown>>;
    headings: readonly string[];
    blockIds: readonly string[];
    wikilinks: readonly IndexedWikilink[];
    backlinks: readonly VaultPath[];
    searchTokens: readonly string[];
    excerptSource: string;
    contentHash: string;
    modifiedAt: string;
    size: number;
}
export interface KnowledgeGraphSnapshot {
    outgoing: ReadonlyMap<VaultPath, readonly VaultPath[]>;
    incoming: ReadonlyMap<VaultPath, readonly VaultPath[]>;
}
export interface KnowledgeScopeIndex {
    byType: ReadonlyMap<string, readonly VaultPath[]>;
    byTag: ReadonlyMap<string, readonly VaultPath[]>;
}
export interface KnowledgeSnapshot {
    version: string;
    createdAt: string;
    generation: number;
    index_state: KnowledgeIndexState;
    notes: ReadonlyMap<VaultPath, IndexedKnowledgeNote>;
    graph: KnowledgeGraphSnapshot;
    scopes: KnowledgeScopeIndex;
    last_event: VaultIndexEvent | null;
    last_rebuild: string | null;
}
export interface KnowledgeIndexReport {
    index_state: KnowledgeIndexState;
    generation: number;
    note_count: number;
    created_at: string;
    warnings: readonly string[];
}
export interface KnowledgeIndex {
    snapshot(): Promise<KnowledgeSnapshot>;
    scanSnapshot(): ScanResult;
    rebuild(scanResult?: ScanResult): Promise<KnowledgeIndexReport>;
    apply(event: VaultIndexEvent): Promise<void>;
    applyScanned(event: VaultIndexEvent, note?: ScannedNote | null): Promise<void>;
}
export interface KnowledgeIndexOptions {
    vaultRoot: string;
    vaultConfigDir?: string;
    initialScan?: ScanResult;
}
export declare function computeFileVersion(size: number, modifiedAt: string): FileVersion;
export declare function toIndexedKnowledgeNote(note: ScannedNote): IndexedKnowledgeNote;
export declare function buildKnowledgeSnapshot(scanResult: ScanResult, options?: {
    indexState?: KnowledgeIndexState;
    generation?: number;
    lastEvent?: VaultIndexEvent | null;
    lastRebuild?: string | null;
}): KnowledgeSnapshot;
export declare class InMemoryKnowledgeIndex implements KnowledgeIndex {
    private readonly vaultRoot;
    private readonly vaultConfigDir?;
    private state;
    private sourceNotes;
    private sourceErrors;
    private writeChain;
    constructor(options: KnowledgeIndexOptions);
    snapshot(): Promise<KnowledgeSnapshot>;
    scanSnapshot(): ScanResult;
    rebuild(scanResult?: ScanResult): Promise<KnowledgeIndexReport>;
    apply(event: VaultIndexEvent): Promise<void>;
    applyScanned(event: VaultIndexEvent, note?: ScannedNote | null): Promise<void>;
    private enqueueWrite;
    private applyCreateOrModify;
    private applyDelete;
    private applyRename;
    private toMutableState;
}
