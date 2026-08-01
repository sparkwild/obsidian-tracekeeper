export declare const NORMALIZED_VAULT_NOTE_VERSION = "1.0";
export type NormalizedVaultEdgeKind = 'link' | 'embed' | 'reference' | 'frontmatter';
export type NormalizedVaultEdgeSource = 'body' | 'frontmatter';
export type NormalizedVaultSubpathKind = 'heading' | 'block';
export type NormalizedVaultSectionType = 'frontmatter' | 'heading' | 'fenced-code' | 'inline-code' | 'html-comment' | 'url' | 'callout';
export interface VaultSourceLocation {
    line: number;
    column: number;
    offset: number;
}
export interface VaultSourceRange {
    start: VaultSourceLocation;
    end: VaultSourceLocation;
}
export interface NormalizedVaultSection {
    type: NormalizedVaultSectionType;
    position: VaultSourceRange;
}
export type NormalizedVaultEdgeResolution = {
    status: 'resolved';
    path: string;
    authority: 'fallback' | 'native';
} | {
    status: 'unresolved';
    reason: 'not_found' | 'ambiguous' | 'unsafe_path' | 'empty_target' | 'missing_reference_definition';
    authority: 'fallback' | 'native';
};
export interface NormalizedVaultEdge {
    kind: NormalizedVaultEdgeKind;
    source: NormalizedVaultEdgeSource;
    raw: string;
    target: string;
    linkPath: string;
    displayText?: string;
    alias?: string;
    heading?: string;
    subpath?: string;
    subpathKind?: NormalizedVaultSubpathKind;
    referenceLabel?: string;
    line: number;
    position: VaultSourceRange;
    sourcePath?: string;
    resolution: NormalizedVaultEdgeResolution;
}
export interface NormalizedVaultCallout {
    type: string;
    rawHeader: string;
    content: string;
    sourceRefs: string[];
    blockId?: string;
    line: number;
    endLine: number;
    position: VaultSourceRange;
}
export interface NormalizedVaultNote {
    schemaVersion: typeof NORMALIZED_VAULT_NOTE_VERSION;
    path: string;
    exists: boolean;
    contentHash: string;
    title: string;
    aliases: readonly string[];
    type?: string | null;
    frontmatter: Readonly<Record<string, unknown>>;
    semanticErrors: readonly string[];
    tags: readonly string[];
    headings: readonly string[];
    blockIds: readonly string[];
    sections: readonly NormalizedVaultSection[];
    callouts: readonly NormalizedVaultCallout[];
    edges: readonly NormalizedVaultEdge[];
    text: string;
    content: string;
    modifiedAt: string;
    size: number;
}
export interface VaultSemanticEvent {
    schemaVersion: typeof NORMALIZED_VAULT_NOTE_VERSION;
    sequence: number;
    kind: 'create' | 'modify' | 'delete' | 'rename';
    path: string;
    newPath?: string;
    exists: boolean;
    contentHash?: string;
    note?: NormalizedVaultNote;
}
export interface NormalizedVaultNoteReference {
    path: string;
    title: string;
    aliases: readonly string[];
    edges: readonly NormalizedVaultEdge[];
}
export declare class VaultSemanticPathError extends Error {
    constructor(message: string);
}
export declare function hashVaultContent(content: string): string;
export declare function cloneVaultFrontmatter(frontmatter: Readonly<Record<string, unknown>>): Record<string, unknown>;
export declare function normalizeVaultRelativePath(value: string): string;
export declare function resolveNormalizedVaultEdges(notes: readonly NormalizedVaultNoteReference[]): ReadonlyMap<string, readonly NormalizedVaultEdge[]>;
