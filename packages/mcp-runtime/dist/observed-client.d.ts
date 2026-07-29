export type ObservedClientType = 'codex' | 'claude-code' | 'claude-desktop' | 'cursor' | 'gemini' | 'grok' | 'zcode' | 'custom' | 'unknown';
export declare function normalizeObservedClientType(clientName: string | null | undefined): ObservedClientType;
