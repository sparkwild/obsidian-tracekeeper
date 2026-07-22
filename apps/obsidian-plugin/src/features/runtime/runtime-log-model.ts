import { ui } from '../../ui/localization';

export const RUNTIME_LOG_PAGE_SIZE = 20;

export type RuntimeLogFilter = 'all' | 'connection' | 'tool' | 'config' | 'error';

export type RuntimeLogCategory = 'connection' | 'tool' | 'config' | 'record';

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
	updatedAt: string;
}

export interface RuntimeLogCleanupResult {
	removedSections: number;
	removedFiles: number;
}

export const RUNTIME_LOG_FILTERS: RuntimeLogFilter[] = [
	'all',
	'connection',
	'tool',
	'config',
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
