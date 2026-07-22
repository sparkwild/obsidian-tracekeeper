import { parseMarkdown } from './markdown';
export interface ScannedNote {
    absolutePath: string;
    relativePath: string;
    title: string;
    size: number;
    modifiedAt: string;
    tokens: string;
    frontmatter: Record<string, unknown>;
    aliases: string[];
    type?: string;
    tags: string[];
    headings: string[];
    blockIds: string[];
    wikilinks: ReturnType<typeof parseMarkdown>['wikilinks'];
    claimBlocks: ReturnType<typeof parseMarkdown>['claimBlocks'];
    evidenceBlocks: ReturnType<typeof parseMarkdown>['evidenceBlocks'];
    content: string;
}
export interface ScanError {
    path: string;
    error: string;
}
export interface ScanResult {
    vaultRoot: string;
    scannedAt: string;
    notes: ScannedNote[];
    errors: ScanError[];
    index?: {
        index_state: 'initializing' | 'rebuilding' | 'ready';
        generation: number;
        last_rebuild: string | null;
    };
}
export interface ScanVaultOptions {
    vaultConfigDir?: string;
}
export interface ScannedNoteContentInput {
    absolutePath: string;
    relativePath: string;
    fallbackTitle: string;
    size: number;
    modifiedAt: string;
    content: string;
}
export declare function scannedNoteFromContent(input: ScannedNoteContentInput): ScannedNote;
export declare function scanVault(vaultRoot: string, options?: ScanVaultOptions): ScanResult;
