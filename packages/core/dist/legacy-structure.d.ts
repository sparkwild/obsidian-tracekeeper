export type LegacyStructureKind = 'control' | 'dashboard' | 'review_queue' | 'agent_request' | 'task' | 'session' | 'source' | 'memory_global' | 'memory_project' | 'wiki_concept' | 'wiki_claim' | 'wiki_guide' | 'context_pack' | 'source_analysis' | 'archive' | 'archive_report' | 'archive_summary' | 'archive_output';
export interface LegacyStructureTarget {
    oldPath: string;
    newPath: string;
    kind: LegacyStructureKind;
}
export interface LegacyStructureReviewInput {
    migrationId: string;
    oldPath: string;
    newPath: string;
    kind: LegacyStructureKind;
    reason: string;
    sourceContent: string;
}
export declare function isLegacyStructurePath(relativePath: string): boolean;
export declare function getLegacyStructureTarget(relativePath: string): LegacyStructureTarget | null;
export declare function enrichLegacyMarkdownContent(content: string, input: {
    migrationId: string;
    oldPath: string;
    newPath: string;
    kind: LegacyStructureKind;
}): string;
export declare function buildLegacyMigrationReviewPath(migrationId: string, oldPath: string): string;
export declare function renderLegacyMigrationReview(input: LegacyStructureReviewInput): string;
export declare function safeReviewName(value: string): string;
