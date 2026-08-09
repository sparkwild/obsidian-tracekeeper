import type { ScannedNote } from './scan';
export interface RecallOptions {
    limit?: number;
}
export interface RecallMatch {
    note: ScannedNote;
    score: number;
    matchedTokens: string[];
}
export declare function isOrdinaryRecallPathEligible(relativePath: string): boolean;
export declare function scoreNote(note: ScannedNote, queryTokens: string[]): number;
export declare function recallNotes(notes: ScannedNote[], query: string, options?: RecallOptions): RecallMatch[];
