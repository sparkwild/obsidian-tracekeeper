export interface VaultPathSafetyOptions {
    vaultConfigDir?: string;
}
export declare class ToolInputError extends Error {
    constructor(message: string);
}
export declare function toSafeVaultRoot(vaultRoot?: unknown): string;
export declare function normalizeNotePath(rawPath: string, options?: VaultPathSafetyOptions): string;
export declare function assertNoSymlinkSegments(vaultRoot: string, absolutePath: string): void;
export declare function resolveSafeNotePath(vaultRoot: string, rawPath: string, options?: VaultPathSafetyOptions): string;
export interface WritablePathResolution {
    absolutePath: string;
    relativePath: string;
}
export declare function resolveSafeWritableNotePath(vaultRoot: string, rawPath: string, allowedDirectory: string, options?: VaultPathSafetyOptions): WritablePathResolution;
export declare function relativeFromAbsolute(vaultRoot: string, absolutePath: string): string;
