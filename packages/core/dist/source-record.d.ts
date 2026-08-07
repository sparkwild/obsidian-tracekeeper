export type NormalizedSourceKind = 'web' | 'file' | 'transcript';
export declare const SOURCE_INLINE_CONTENT_LIMIT_BYTES: number;
export declare const SOURCE_PART_MAX_BYTES: number;
export declare const SOURCE_PART_MAX_COUNT = 16;
export interface SourcePartPlan {
    part_number: number;
    path: string;
    content_hash: string;
    byte_length: number;
    content: string;
}
export interface SourceCapturePlan {
    source_kind: NormalizedSourceKind;
    source_id: string;
    content_hash: string;
    route: string;
    index_path: string;
    inline_content: string;
    parts: SourcePartPlan[];
}
export declare function normalizeSourceKind(value: unknown): NormalizedSourceKind;
export declare function sourceRouteForKind(sourceKind: NormalizedSourceKind): string;
export declare function buildSourceCapturePlan(input: {
    source: string;
    sourceKind: unknown;
    filename: string;
    content: string;
}): SourceCapturePlan;
