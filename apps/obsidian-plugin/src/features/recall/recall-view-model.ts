export const MEMORY_RECALL_SCOPES = ['global', 'project', 'project_history'] as const;

export type TracekeeperRecallScope = typeof MEMORY_RECALL_SCOPES[number];

type ParsedRecordValue = string | string[];
type ParsedRecord = Record<string, ParsedRecordValue>;

export interface MemoryRecallInput {
	query: string;
	scope: TracekeeperRecallScope;
	projectHint?: string;
}

export interface MemoryRecallResult {
	query: string;
	scope: string;
	projectHint: string;
	items: MemoryRecallResultEntry[];
	sourceTool: string;
}

export interface MemoryRecallResultEntry {
	path: string;
	title: string;
	scope: string;
	type: string;
	score: number;
	matchedTokens: string[];
	reason: string;
}

interface MemoryRecallNormalization {
	unknownPathLabel: string;
	unknownTitleLabel: string;
	unknownTypeLabel: string;
	noDisplayLabel: string;
	noReasonLabel: string;
	scopeLabel: (scope: TracekeeperRecallScope) => string;
}

const isRecord = (value: unknown): value is ParsedRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const trimText = (value: string, maxLength = 280): string => {
	const trimmed = value.trim();
	if (trimmed.length <= maxLength) {
		return trimmed;
	}
	return `${trimmed.slice(0, maxLength - 1)}…`;
};

const firstString = (values: ParsedRecord, keys: string[]): string => {
	for (const key of keys) {
		const value = values[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
		if (Array.isArray(value)) {
			const first = value.find((entry) => Boolean(entry && entry.trim()));
			if (first) {
				return first;
			}
		}
	}
	return '';
};

const readStringList = (values: ParsedRecord, keys: string[]): string[] => {
	const items: string[] = [];
	for (const key of keys) {
		const value = values[key];
		if (!value) continue;
		if (Array.isArray(value)) {
			items.push(...value.filter(Boolean));
			continue;
		}
		items.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
	}
	return [...new Set(items)];
};

export const normalizeMemoryRecallScope = (scope: string): TracekeeperRecallScope => {
	return (scope && (MEMORY_RECALL_SCOPES as readonly string[]).includes(scope))
		? scope as TracekeeperRecallScope
		: 'global';
};

export const extractRecallMatches = (result: Record<string, unknown>): unknown[] => {
	const matches = result.matches;
	if (Array.isArray(matches)) {
		return matches;
	}
	const entries = result.entries;
	if (Array.isArray(entries)) {
		return entries;
	}
	const legacyResults = result.results;
	if (Array.isArray(legacyResults)) {
		return legacyResults as unknown[];
	}
	return [];
};

const normalizeMatch = (match: unknown, fallbackScope: TracekeeperRecallScope): Omit<MemoryRecallResultEntry, 'scope'> & { scope: TracekeeperRecallScope } => {
	if (!isRecord(match)) {
		return {
			path: '',
			title: '',
			scope: fallbackScope,
			type: '',
			score: 0,
			matchedTokens: [],
			reason: '',
		};
	}
	const recallMatch = match as ParsedRecord;
	const scope = normalizeMemoryRecallScope(firstString(recallMatch, ['scope']) || fallbackScope);
	const scoreRaw = recallMatch.score;
	const score = typeof scoreRaw === 'number'
		? scoreRaw
		: typeof scoreRaw === 'string'
			? Number.parseFloat(scoreRaw)
			: 0;
	return {
		path: trimText(firstString(recallMatch, ['path']), 280),
		title: firstString(recallMatch, ['title']),
		scope,
		type: firstString(recallMatch, ['type']),
		score: Number.isFinite(score) ? score : 0,
		matchedTokens: readStringList(recallMatch, ['matched_tokens', 'matchedTokens', 'tokens', 'keywords']).slice(0, 8),
		reason: readStringList(recallMatch, ['score_reason', 'scoreReason']).join('；')
			|| firstString(recallMatch, ['reason'])
			|| firstString(recallMatch, ['summary']),
	};
};

export const parseMemoryRecallResult = (
	result: Record<string, unknown>,
	input: MemoryRecallInput & { sourceTool: string },
	localization: MemoryRecallNormalization
): MemoryRecallResult => {
	const normalizedScope = normalizeMemoryRecallScope(input.scope);
	const rawMatches = extractRecallMatches(result);
	const rawEntries = rawMatches.map((match) => normalizeMatch(match, normalizedScope));
	return {
		query: input.query,
		scope: localization.scopeLabel(normalizedScope),
		projectHint: input.projectHint || '',
		sourceTool: input.sourceTool,
		items: rawEntries.map((entry) => ({
			path: entry.path || localization.unknownPathLabel,
			title: entry.title || localization.unknownTitleLabel,
			scope: localization.scopeLabel(entry.scope),
			type: entry.type || localization.unknownTypeLabel,
			score: entry.score,
			matchedTokens: entry.matchedTokens,
			reason: entry.reason || localization.noDisplayLabel || localization.noReasonLabel,
		})),
	};
};
