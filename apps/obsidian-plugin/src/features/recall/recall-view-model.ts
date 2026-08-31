export const MEMORY_RECALL_SCOPES = ['global', 'project', 'project_history', 'task_history'] as const;

export type TracekeeperRecallScope = typeof MEMORY_RECALL_SCOPES[number];

type ParsedRecord = Record<string, unknown>;

export interface MemoryRecallInput {
	query: string;
	scope: TracekeeperRecallScope;
	projectHint?: string;
}

export interface MemoryRecallResult {
	query: string;
	scope: string;
	projectHint: string;
	uncertain: boolean;
	projectIdentity: MemoryRecallProjectIdentity;
	items: MemoryRecallResultEntry[];
	sourceTool: string;
}

export interface MemoryRecallProjectIdentity {
	projectHint: string;
	projectId: string;
	repoPath: string;
	source: string;
	confidence: string;
	warnings: string[];
}

export interface MemoryRecallResultEntry {
	path: string;
	title: string;
	scope: string;
	type: string;
	score: number;
	matchedTokens: string[];
	scoreReasons: string[];
	reason: string;
}

export type MemoryRecallReasonLocale = 'zh' | 'en';

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

const recallScoreAdjustment = (reason: string, prefix: string): string => {
	const match = reason.match(new RegExp(`^${prefix} \\(([+-]\\d+(?:\\.\\d+)?)\\)$`));
	return match?.[1] ?? '';
};

export const localizeMemoryRecallScoreReason = (
	reason: string,
	locale: MemoryRecallReasonLocale
): string => {
	const normalized = reason.trim();
	const projectMemoryAdjustment = recallScoreAdjustment(normalized, 'Project-memory location boost');
	if (projectMemoryAdjustment) {
		return locale === 'zh'
			? `项目记忆位置加权（${projectMemoryAdjustment}）`
			: `Project-memory location boost (${projectMemoryAdjustment})`;
	}
	const wikiAdjustment = recallScoreAdjustment(normalized, 'Wiki location boost');
	if (wikiAdjustment) {
		return locale === 'zh'
			? `Wiki 位置加权（${wikiAdjustment}）`
			: `Wiki location boost (${wikiAdjustment})`;
	}
	const workRecordAdjustment = recallScoreAdjustment(normalized, 'Work-record query-echo penalty');
	if (workRecordAdjustment) {
		return locale === 'zh'
			? `工作记录查询回显降权（${workRecordAdjustment}）`
			: `Work-record query-echo penalty (${workRecordAdjustment})`;
	}
	const multipleTokenAdjustment = recallScoreAdjustment(normalized, 'Multiple query token matches');
	if (multipleTokenAdjustment) {
		return locale === 'zh'
			? `多个查询词命中（${multipleTokenAdjustment}）`
			: `Multiple query token matches (${multipleTokenAdjustment})`;
	}
	const recentEditAdjustment = recallScoreAdjustment(normalized, 'Recent edit');
	if (recentEditAdjustment) {
		return locale === 'zh'
			? `近期编辑加权（${recentEditAdjustment}）`
			: `Recent edit (${recentEditAdjustment})`;
	}
	const exactPhraseAdjustment = recallScoreAdjustment(normalized, 'Exact query phrase match in title/path');
	if (exactPhraseAdjustment) {
		return locale === 'zh'
			? `标题或路径精确匹配查询短语（${exactPhraseAdjustment}）`
			: `Exact query phrase match in title/path (${exactPhraseAdjustment})`;
	}
	const projectScopeAdjustment = recallScoreAdjustment(normalized, 'Project scope match');
	if (projectScopeAdjustment) {
		return locale === 'zh'
			? `项目范围匹配（${projectScopeAdjustment}）`
			: `Project scope match (${projectScopeAdjustment})`;
	}
	if (normalized === 'Core recall score') {
		return locale === 'zh' ? '核心召回分数' : 'Core recall score';
	}
	if (normalized === 'Catalog lexical match') {
		return locale === 'zh' ? '目录词法匹配' : 'Catalog lexical match';
	}
	return locale === 'zh' ? '其他召回排序依据' : 'Other recall ranking signal';
};

export const localizeMemoryRecallScoreReasons = (
	reasons: string[],
	locale: MemoryRecallReasonLocale
): string => {
	const localized = reasons
		.map((reason) => localizeMemoryRecallScoreReason(reason, locale))
		.filter(Boolean);
	return [...new Set(localized)].join(locale === 'zh' ? '；' : '; ');
};

const firstString = (values: ParsedRecord, keys: string[]): string => {
	for (const key of keys) {
		const value = values[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
		if (Array.isArray(value)) {
			const first = value.find(
				(entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())
			);
			if (first) {
				return first.trim();
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
			items.push(...value
				.filter((entry): entry is string => typeof entry === 'string')
				.map((entry) => entry.trim())
				.filter(Boolean));
			continue;
		}
		if (typeof value === 'string') {
			items.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
		}
	}
	return [...new Set(items)];
};

const parseProjectIdentity = (result: Record<string, unknown>): MemoryRecallProjectIdentity => {
	const rawIdentity = isRecord(result.project_identity)
		? result.project_identity
		: isRecord(result.scope)
			? result.scope
			: {};
	return {
		projectHint: firstString(rawIdentity, ['project_hint', 'projectHint']),
		projectId: firstString(rawIdentity, ['project_id', 'projectId']),
		repoPath: firstString(rawIdentity, ['repo_path', 'repoPath']),
		source: firstString(rawIdentity, ['source']),
		confidence: firstString(rawIdentity, ['confidence']),
		warnings: readStringList(rawIdentity, ['warnings']),
	};
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
			scoreReasons: [],
			reason: '',
		};
	}
	const recallMatch = match;
	const scope = normalizeMemoryRecallScope(firstString(recallMatch, ['scope']) || fallbackScope);
	const scoreRaw = recallMatch.score;
	const score = typeof scoreRaw === 'number'
		? scoreRaw
		: typeof scoreRaw === 'string'
			? Number.parseFloat(scoreRaw)
			: 0;
	const scoreReasons = readStringList(recallMatch, ['score_reason', 'scoreReason']);
	return {
		path: trimText(firstString(recallMatch, ['path']), 280),
		title: firstString(recallMatch, ['title']),
		scope,
		type: firstString(recallMatch, ['type']),
		score: Number.isFinite(score) ? score : 0,
		matchedTokens: readStringList(recallMatch, ['matched_tokens', 'matchedTokens', 'tokens', 'keywords']).slice(0, 8),
		scoreReasons,
		reason: scoreReasons.join('；')
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
	const projectIdentity = parseProjectIdentity(result);
	return {
		query: input.query,
		scope: localization.scopeLabel(normalizedScope),
		projectHint: input.projectHint || '',
		uncertain: result.uncertain === true || projectIdentity.confidence === 'uncertain',
		projectIdentity,
		sourceTool: input.sourceTool,
		items: rawEntries.map((entry) => ({
			path: entry.path || localization.unknownPathLabel,
			title: entry.title || localization.unknownTitleLabel,
			scope: localization.scopeLabel(entry.scope),
			type: entry.type || localization.unknownTypeLabel,
			score: entry.score,
			matchedTokens: entry.matchedTokens,
			scoreReasons: entry.scoreReasons,
			reason: entry.reason || localization.noDisplayLabel || localization.noReasonLabel,
		})),
	};
};
