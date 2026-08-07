import { ui } from '../../ui/localization';

export const RUNTIME_LOG_PAGE_SIZE = 20;
export const RUNTIME_LOG_MAX_EVENTS = 2000;

export type RuntimeLogFilter = 'all' | 'connection' | 'tool' | 'error';

export type RuntimeLogCategory = 'connection' | 'tool' | 'record';

export type RuntimeLogCleanupScope = 'older-than-week' | 'older-than-month' | 'older-than-three-months' | 'all';

export interface RuntimeLogItem {
	time: number;
	category: RuntimeLogCategory;
	title: string;
	meta: string;
	body: string;
	path: string;
	status: string;
}

export interface RuntimeLogSnapshot {
	items: RuntimeLogItem[];
	filter: RuntimeLogFilter;
	counts: Record<RuntimeLogFilter, number>;
	page: number;
	pageSize: number;
	totalItems: number;
	totalPages: number;
	isTruncated: boolean;
	updatedAt: string;
}

export type RuntimeLogCleanupFileReason =
	| 'wholly-eligible'
	| 'clear-all'
	| 'mixed-age'
	| 'too-new'
	| 'empty-or-unparseable';

export interface RuntimeLogCleanupFile {
	path: string;
	sourceKind: 'legacy' | 'shard';
	contentHash: string;
	version: string;
	earliestEventTime: string;
	latestEventTime: string;
	eventCount: number;
	reason: RuntimeLogCleanupFileReason;
}

export interface RuntimeLogCleanupPreview {
	schemaVersion: 1;
	operationId: string;
	previewNonce: string;
	issuedAt: string;
	expiresAt: string;
	scope: RuntimeLogCleanupScope;
	cutoff: string | null;
	eligibleFiles: RuntimeLogCleanupFile[];
	retainedFiles: RuntimeLogCleanupFile[];
	eligibleEventCount: number;
	retainedEventCount: number;
	trashBehavior: string;
	confirmationToken: string;
}

export interface RuntimeLogCleanupFailure {
	path: string;
	error: string;
}

export interface RuntimeLogCleanupStale {
	path: string;
	reason:
		| 'changed-before-trash'
		| 'missing-before-trash'
		| 'outcome-unknown-after-trash-intent';
}

export interface RuntimeLogCleanupResult {
	schemaVersion: 1;
	operationId: string;
	status: 'completed' | 'partial';
	scope: RuntimeLogCleanupScope;
	cutoff: string | null;
	trashedPaths: string[];
	failed: RuntimeLogCleanupFailure[];
	stale: RuntimeLogCleanupStale[];
	retainedPaths: string[];
	completedAt: string;
}

export const RUNTIME_LOG_FILTERS: RuntimeLogFilter[] = [
	'all',
	'connection',
	'tool',
	'error',
];

export const RUNTIME_LOG_CLEANUP_OPTIONS: RuntimeLogCleanupScope[] = [
	'all',
	'older-than-week',
	'older-than-month',
	'older-than-three-months',
];

export const runtimeLogCleanupScopeLabel = (scope: RuntimeLogCleanupScope): string => {
	switch (scope) {
		case 'all':
			return ui('全部', 'All');
		case 'older-than-month':
			return ui('一个月前', 'Older than one month');
		case 'older-than-three-months':
			return ui('三个月前', 'Older than three months');
		case 'older-than-week':
		default:
			return ui('一周前', 'Older than one week');
	}
};

export const runtimeLogTrashBehaviorDescription = (): string => ui(
	'提交时将调用 Obsidian 的公开 FileManager.trashFile API，并遵循当时的“删除的文件”设置：系统废纸篓、Vault .trash 或永久删除。永久删除可能无法恢复；确认前请在 Obsidian 设置中核对该选项。',
	'At commit, Tracekeeper calls Obsidian public FileManager.trashFile API and follows the current deleted-files setting: system trash, Vault .trash, or permanent deletion. Permanent deletion may not be recoverable; verify that Obsidian setting before confirming.'
);
