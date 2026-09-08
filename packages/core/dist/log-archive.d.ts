interface Entry {
    segment: string;
    offset: number;
    length: number;
    hash: string;
    originalHash: string;
}
export interface LogArchiveItem {
    name: string;
    content: string;
    originalHash: string;
}
export interface LogArchiveSnapshot {
    generation: string;
    files: number;
    segments: number;
}
/** 冷分片不可变，按哈希分片索引；调用方必须持有共享写锁。 */
export declare class LogArchive {
    private readonly directory;
    private readonly root;
    constructor(directory: string);
    private key;
    private signature;
    private manifest;
    private bucket;
    private readEntry;
    read(name: string): Promise<string | null>;
    entries(): Promise<Map<string, Entry>>;
    maintenanceState(): Promise<'idle' | 'preparing' | 'publishing' | 'invalid'>;
    snapshot(): Promise<LogArchiveSnapshot>;
    verify(): Promise<LogArchiveSnapshot>;
    /** 只从已提交清单认证的分片重建索引，不能收养来源不明的文件。 */
    rebuildIndex(): Promise<void>;
    recoverPreparation(): Promise<void>;
    commit(items: LogArchiveItem[]): Promise<void>;
    /** 只回收已被认证冷存储覆盖、且内容未变的系统副本。 */
    retire(): Promise<void>;
}
export {};
