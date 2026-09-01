import { type NormalizedVaultNote } from './knowledge-note';
declare const PLAN_VERSION: 1;
export interface LegacySourceSegment {
    path: string;
    segmentNumber: number;
    source: string;
    sourceId: string;
    contentHash: string;
    byteLength: number;
    content: string;
}
export interface LegacySourceSegmentIssue {
    code: 'not_a_file_source' | 'segment_number_mismatch' | 'duplicate_segment_number' | 'segment_number_gap' | 'segment_too_large' | 'target_path_occupied';
    familyKey: string;
    paths: string[];
    message: string;
}
export interface LegacySourceSegmentPartPlan {
    partNumber: number;
    path: string;
    legacyPath: string;
    contentHash: string;
    byteLength: number;
    content: string;
}
export interface LegacySourceSegmentShardPlan {
    shardNumber: number;
    parentPath: string;
    parentSource: string;
    parentSourceId: string;
    segments: string[];
    parts: LegacySourceSegmentPartPlan[];
    parentContentHash: string;
}
export interface LegacySourceSegmentFamilyPlan {
    familyKey: string;
    originalSource: string;
    segments: LegacySourceSegment[];
    shards: LegacySourceSegmentShardPlan[];
}
export interface LegacySourceConsolidationPlan {
    version: typeof PLAN_VERSION;
    ready: boolean;
    createdAt: string;
    families: LegacySourceSegmentFamilyPlan[];
    issues: LegacySourceSegmentIssue[];
    oldSegmentCount: number;
    newParentCount: number;
    newPartCount: number;
    oldToNewParent: Array<{
        oldPath: string;
        newParentPath: string;
    }>;
    planHash: string;
}
export interface LegacySourceConsolidationOptions {
    occupiedPaths?: readonly string[];
    createdAt?: string;
}
type SourceNote = Pick<NormalizedVaultNote, 'path' | 'text' | 'contentHash' | 'frontmatter' | 'type' | 'size'>;
/**
 * Build a deterministic, read-only plan for converting legacy `*-segment-NNN`
 * Source captures into bounded Source indexes and Source parts. The planner
 * never moves, deletes, or rewrites Vault files.
 */
export declare function buildLegacySourceConsolidationPlan(notes: readonly SourceNote[], options?: LegacySourceConsolidationOptions): LegacySourceConsolidationPlan;
export {};
