export declare const logHash: (value: string | Buffer) => string;
export declare const isMissingLogFile: (error: unknown) => boolean;
/** 操作 I/O 前检查受管根路径及其下的现存节点，拒绝符号链接。 */
export declare function assertLogPath(root: string, target?: string): Promise<void>;
export declare function readLogFile(root: string, file: string, limit?: number): Promise<string | null>;
/** 原子替换在文件及目录元数据同步后才确认完成。 */
export declare function writeLogFile(root: string, file: string, bytes: string | Buffer): Promise<void>;
export declare function syncLogDirectory(directory: string): Promise<void>;
