export declare const SOURCE_HISTORY_RECEIPTS = "00_tracekeeper/control/operations/source-consolidations";
/** 所有界面与迁移复用同一证明：完整回执绑定、终态、分片及父索引当前哈希。 */
export declare function verifiedSourceReplacements(receipts: readonly {
    path: string;
    content: string;
}[], contentHashes: ReadonlyMap<string, string>): ReadonlyMap<string, string>;
export declare function readVerifiedSourceReplacements(vault: string, contentHashes: ReadonlyMap<string, string>): Promise<ReadonlyMap<string, string>>;
