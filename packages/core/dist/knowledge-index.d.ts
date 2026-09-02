import { type ScanResult, type ScannedNote } from './scan';
import { type NormalizedVaultEdge, type NormalizedVaultNote, type VaultSemanticEvent } from './knowledge-note';
import { type MemoryRecord } from './memory-record';
import { type MemoryLifecycleProjection } from './memory-lifecycle';
import { type WikiRole } from './wiki-governance';
export declare const KNOWLEDGE_INDEX_VERSION = "1.0";
export type VaultPath = string;
export type FileVersion = string;
export type KnowledgeIndexState = 'initializing' | 'rebuilding' | 'ready';
export type VaultIndexEventKind = 'create' | 'modify' | 'delete' | 'rename';
export interface VaultIndexEventBase {
    path: VaultPath;
    fileVersion: FileVersion;
    sequence?: number;
    exists?: boolean;
    contentHash?: string;
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
    sequence?: number;
    exists?: boolean;
    contentHash?: string;
}
export type VaultIndexEvent = CreateVaultIndexEvent | ModifyVaultIndexEvent | DeleteVaultIndexEvent | RenameVaultIndexEvent;
export type IndexedWikilink = NormalizedVaultEdge;
export interface IndexedKnowledgeNote extends NormalizedVaultNote {
    path: VaultPath;
    fileVersion: FileVersion;
    type: string | null;
    wikilinks: readonly IndexedWikilink[];
    backlinks: readonly VaultPath[];
    searchTokens: readonly string[];
    excerptSource: string;
}
export interface KnowledgeGraphSnapshot {
    outgoing: ReadonlyMap<VaultPath, readonly VaultPath[]>;
    incoming: ReadonlyMap<VaultPath, readonly VaultPath[]>;
    edges: readonly NormalizedVaultEdge[];
    unresolvedEdges: readonly NormalizedVaultEdge[];
}
export interface KnowledgeScopeIndex {
    byType: ReadonlyMap<string, readonly VaultPath[]>;
    byTag: ReadonlyMap<string, readonly VaultPath[]>;
}
export interface KnowledgeCatalogEntry {
    path: VaultPath;
    fileVersion: FileVersion;
    contentHash: string;
    frontmatterHash: string;
    frontmatter: Readonly<Record<string, unknown>>;
    title: string;
    aliases: readonly string[];
    type: string | null;
    tags: readonly string[];
    searchTokens: readonly string[];
    excerpt: string;
    modifiedAt: string;
    size: number;
    managedRelationsStatus: 'missing' | 'valid' | 'invalid';
    managedRelationsSchemaVersion: 1 | 2 | null;
    wikiRole: WikiRole | 'unknown';
    managedParent: string | null;
    managedSources: readonly string[];
    managedRelated: readonly string[];
}
export interface KnowledgeLexicalIndex {
    postings: ReadonlyMap<string, readonly VaultPath[]>;
}
export interface KnowledgeMemoryIndex {
    byId: ReadonlyMap<string, MemoryRecord>;
    byClaimKey: ReadonlyMap<string, readonly string[]>;
    lifecycle: MemoryLifecycleProjection;
    invalidPaths: readonly VaultPath[];
}
export interface KnowledgeIndexUpdate {
    mode: 'rebuild' | 'incremental' | 'rename_rebuild_fallback';
    affectedPaths: readonly VaultPath[];
    reason: string | null;
}
export interface KnowledgeContentRead {
    generation: number;
    path: VaultPath;
    contentHash: string;
    content: string;
    modifiedAt: string;
    staleAgainstView: boolean;
}
export interface KnowledgeContentReader {
    readonly generation: number;
    read(notePath: VaultPath): Promise<KnowledgeContentRead | null>;
}
export interface KnowledgeReadView {
    version: string;
    source: 'index' | 'filesystem_scan';
    createdAt: string;
    generation: number;
    event_sequence: number;
    index_state: KnowledgeIndexState;
    catalog: ReadonlyMap<VaultPath, KnowledgeCatalogEntry>;
    graph: KnowledgeGraphSnapshot;
    scopes: KnowledgeScopeIndex;
    lexical: KnowledgeLexicalIndex;
    memory: KnowledgeMemoryIndex;
    last_update: KnowledgeIndexUpdate;
    warnings: readonly string[];
    errors: ReadonlyArray<ScanResult['errors'][number]>;
    contentReader: KnowledgeContentReader;
}
export interface KnowledgeSnapshot {
    version: string;
    createdAt: string;
    generation: number;
    event_sequence: number;
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
    event_sequence: number;
    note_count: number;
    created_at: string;
    warnings: readonly string[];
}
export interface KnowledgeIndex {
    snapshot(): Promise<KnowledgeSnapshot>;
    readView(): Promise<KnowledgeReadView>;
    scanSnapshot(): ScanResult;
    rebuild(scanResult?: ScanResult): Promise<KnowledgeIndexReport>;
    apply(event: VaultIndexEvent): Promise<void>;
    applyScanned(event: VaultIndexEvent, note?: ScannedNote | null): Promise<void>;
    applySemantic(event: VaultSemanticEvent): Promise<void>;
}
export interface KnowledgeIndexOptions {
    vaultRoot: string;
    vaultConfigDir?: string;
    initialScan?: ScanResult;
    maxIncrementalRenameImpact?: number;
}
export declare function computeFileVersion(size: number, modifiedAt: string): FileVersion;
export declare function toIndexedKnowledgeNote(note: ScannedNote): IndexedKnowledgeNote;
export declare function buildKnowledgeSnapshot(scanResult: ScanResult, options?: {
    indexState?: KnowledgeIndexState;
    generation?: number;
    eventSequence?: number;
    lastEvent?: VaultIndexEvent | null;
    lastRebuild?: string | null;
}): KnowledgeSnapshot;
export declare class InMemoryKnowledgeIndex implements KnowledgeIndex {
    private readonly vaultRoot;
    private readonly vaultConfigDir?;
    private readonly maxIncrementalRenameImpact;
    private state;
    private sourceNotes;
    private sourceErrors;
    private writeChain;
    constructor(options: KnowledgeIndexOptions);
    snapshot(): Promise<KnowledgeSnapshot>;
    readView(): Promise<KnowledgeReadView>;
    scanSnapshot(): ScanResult;
    rebuild(scanResult?: ScanResult): Promise<KnowledgeIndexReport>;
    apply(event: VaultIndexEvent): Promise<void>;
    applySemantic(event: VaultSemanticEvent): Promise<void>;
    advanceEventSequenceAfterRebuild(sequence: number): Promise<void>;
    applyScanned(event: VaultIndexEvent, note?: ScannedNote | null): Promise<void>;
    private enqueueWrite;
    private readContentForView;
    private clearRecoveredSourceErrors;
    private applyCreateOrModify;
    private applyDelete;
    private applyRename;
    private updateRenameDerivedState;
    private updateIncrementally;
    private updateCatalogScopesAndPostings;
    private rebuildDerivedState;
    private toMutableState;
}
