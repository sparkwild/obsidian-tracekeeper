import { parseMarkdown } from './markdown';
import { type NormalizedVaultNote } from './knowledge-note';
export interface ScannedNote extends NormalizedVaultNote {
    absolutePath: string;
    relativePath: string;
    tokens: string;
    type?: string;
    wikilinks: ReturnType<typeof parseMarkdown>['wikilinks'];
    claimBlocks: ReturnType<typeof parseMarkdown>['claimBlocks'];
    evidenceBlocks: ReturnType<typeof parseMarkdown>['evidenceBlocks'];
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
        event_sequence?: number;
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
export declare function scannedNoteFromNormalized(note: NormalizedVaultNote, vaultRoot: string): ScannedNote;
export declare function resolveScannedNoteEdges(notes: readonly ScannedNote[]): ScannedNote[];
export declare function scanVault(vaultRoot: string, options?: ScanVaultOptions): ScanResult;
