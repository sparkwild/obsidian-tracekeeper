export declare const WIKI_PROPOSAL_SCHEMA_VERSION: 2;
export declare const MANAGED_RELATIONS_SCHEMA_VERSION: 2;
export declare const WIKI_REVIEW_BATCH_MAX_ITEMS = 100;
export declare const WIKI_REVIEW_BATCH_MAX_BYTES: number;
export type WikiChangeRule = 'review_each' | 'review_batch' | 'auto_managed' | 'disabled';
export type WikiRole = 'topic' | 'topic_map';
export type WikiEffectiveRisk = 'low' | 'medium' | 'high' | 'blocked';
export interface ManagedWikiRelations {
    parent?: string | null;
    sources?: readonly string[];
    related?: readonly string[];
}
export interface ParsedManagedRelationsBlock {
    status: 'missing' | 'valid' | 'invalid';
    schemaVersion: 1 | 2 | null;
    role: WikiRole | 'unknown';
    content: string;
    payload: string;
    hash: string;
    start: number;
    end: number;
}
export interface WikiRiskInput {
    targetExists: boolean;
    writebackEffect: 'append' | 'create_wiki_note' | 'update_managed_relations';
    targetPathAllowed: boolean;
    relationsStatus?: ParsedManagedRelationsBlock['status'];
    hasUnresolvedRelations?: boolean;
    hasTargetConflict?: boolean;
}
export interface WikiBatchCandidate {
    proposalPath: string;
    proposalId: string;
    taskId?: string | null;
    createdAt?: string | null;
    writebackBytes: number;
    effectiveRisk: WikiEffectiveRisk;
}
export interface WikiReviewBatch {
    reviewBatchId: string;
    segment: number;
    items: WikiBatchCandidate[];
    totalBytes: number;
}
/**
 * 将关系目标收敛为一个不可注入 Markdown 的 Vault 相对笔记路径。
 */
export declare function normalizeManagedRelationPath(value: string): string;
/**
 * 渲染由 Tracekeeper 独占维护的关系区块。
 *
 * @description 区块使用稳定排序、完整 Vault 相对 wikilink 与内容哈希，便于后续只替换该边界内的关系。
 */
export declare function renderManagedRelationsBlock(relations: ManagedWikiRelations, role?: WikiRole): string;
/**
 * 校验并定位现有托管关系区块。
 */
export declare function parseManagedRelationsBlock(content: string): ParsedManagedRelationsBlock;
/**
 * 将一个完整托管关系区块解析为可合并的结构。
 *
 * @description 仅接受 Tracekeeper 生成的标准区块，未知行、重复 parent 或非法目标都会失败关闭。
 */
export declare function readManagedWikiRelations(block: string): ManagedWikiRelations;
/**
 * 合并现有区块和同一批次中的多个关系提案。
 *
 * @description 只合并 parent、Source index 和 Wiki 关系；正文及损坏区块不会被改写或绕过校验。
 */
export declare function mergeManagedWikiRelationsBlocks(currentContent: string, proposedBlocks: readonly string[]): string;
/**
 * 在不触碰边界外正文的前提下插入或替换托管关系区块。
 */
export declare function upsertManagedRelationsBlock(content: string, relations: ManagedWikiRelations, role?: WikiRole): string;
export declare function applyManagedRelationsBlock(content: string, proposedBlock: string): string;
export declare function computeWikiEffectiveRisk(input: WikiRiskInput): WikiEffectiveRisk;
export declare function buildWikiReviewBatchId(taskId: string | null | undefined, proposalId: string): string;
/**
 * 将 Wiki 提案按受信批次身份和固定容量稳定切分。
 */
export declare function buildWikiReviewBatches(candidates: readonly WikiBatchCandidate[]): WikiReviewBatch[];
export declare function isSourcePartPath(path: string): boolean;
export declare function sourceIndexPathForPart(path: string): string | null;
export declare function isWikiPath(path: string): boolean;
