import { ui } from '../../ui/localization';
import type { WikiChangeRule } from '@tracekeeper/core';

export const AUTO_REFRESH_INTERVAL_OPTIONS = [10, 15, 30, 60] as const;

export type NoteContentLanguageSetting = 'auto' | 'zh-CN' | 'en';

export type ResolvedNoteContentLanguage = 'zh-CN' | 'en';

export type NoteContentLanguageSource = 'setting' | 'obsidian' | 'navigator' | 'fallback';

export type GraphProfile = 'off' | 'advisory' | 'strict';

const GRAPH_PROFILES: GraphProfile[] = ['off', 'advisory', 'strict'];

export type MemoryProposalRule = 'review_queue' | 'auto_write' | 'disabled';

export const MEMORY_RULES_VERSION = 6;

export const MEMORY_PROPOSAL_RULES: MemoryProposalRule[] = ['review_queue', 'auto_write', 'disabled'];
export const WIKI_CHANGE_RULES: WikiChangeRule[] = ['review_each', 'review_batch', 'auto_managed', 'disabled'];

export const NOTE_CONTENT_LANGUAGES: NoteContentLanguageSetting[] = ['auto', 'zh-CN', 'en'];

export const normalizeGraphProfileValue = (value: unknown): GraphProfile => {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return GRAPH_PROFILES.includes(normalized as GraphProfile)
		? normalized as GraphProfile
		: 'advisory';
};

export const graphProfileLabel = (profile: GraphProfile): string => {
	switch (profile) {
		case 'off':
			return ui('关闭', 'Off');
		case 'strict':
			return ui('严格', 'Strict');
		case 'advisory':
		default:
			return ui('建议', 'Advisory');
	}
};

export const normalizeMemoryProposalRule = (value: unknown, fallback: MemoryProposalRule = 'review_queue'): MemoryProposalRule => {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return MEMORY_PROPOSAL_RULES.includes(normalized as MemoryProposalRule)
		? normalized as MemoryProposalRule
		: fallback;
};

export const memoryProposalRuleLabel = (rule: MemoryProposalRule): string => {
	switch (rule) {
		case 'auto_write':
			return ui('自动', 'Auto');
		case 'disabled':
			return ui('忽略', 'Ignore');
		case 'review_queue':
		default:
			return ui('审核', 'Review');
	}
};

export const normalizeWikiChangeRule = (value: unknown): WikiChangeRule => {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return WIKI_CHANGE_RULES.includes(normalized as WikiChangeRule)
		? normalized as WikiChangeRule
		: 'review_batch';
};

export const wikiChangeRuleLabel = (rule: WikiChangeRule): string => {
	switch (rule) {
		case 'review_each':
			return ui('逐项审核', 'Review each');
		case 'auto_managed':
			return ui('自动托管', 'Auto managed');
		case 'disabled':
			return ui('忽略', 'Ignore');
		case 'review_batch':
		default:
			return ui('批次审核', 'Batch review');
	}
};

export interface MemoryRuleSettings {
	memoryRulesVersion: number;
	globalMemoryRule: MemoryProposalRule;
	projectMemoryRule: MemoryProposalRule;
	wikiChangeRule: WikiChangeRule;
	taskTrackingEnabled: boolean;
}

export const normalizeMemoryRuleSettings = (
	raw: unknown,
	defaults: Pick<MemoryRuleSettings, 'globalMemoryRule' | 'projectMemoryRule' | 'taskTrackingEnabled'>
): MemoryRuleSettings => {
	const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
	return {
		memoryRulesVersion: MEMORY_RULES_VERSION,
		globalMemoryRule: normalizeMemoryProposalRule(source.globalMemoryRule, defaults.globalMemoryRule),
		projectMemoryRule: normalizeMemoryProposalRule(source.projectMemoryRule, defaults.projectMemoryRule),
		wikiChangeRule: normalizeWikiChangeRule(source.wikiChangeRule),
		taskTrackingEnabled: typeof source.taskTrackingEnabled === 'boolean'
			? source.taskTrackingEnabled
			: defaults.taskTrackingEnabled,
	};
};

export const normalizeNoteContentLanguage = (value: unknown): NoteContentLanguageSetting => {
	const normalized = typeof value === 'string' ? value.trim() : '';
	if (normalized === 'zh-CN' || normalized === 'en' || normalized === 'auto') {
		return normalized;
	}
	return 'auto';
};

export const noteContentLanguageLabel = (language: NoteContentLanguageSetting): string => {
	switch (language) {
		case 'zh-CN':
			return ui('中文', 'Chinese');
		case 'en':
			return ui('English', 'English');
		case 'auto':
		default:
			return ui('自动（跟随 Obsidian）', 'Auto (follow Obsidian)');
	}
};
