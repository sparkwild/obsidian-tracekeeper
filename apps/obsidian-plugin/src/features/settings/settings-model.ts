import { ui } from '../../ui/localization';

export const AUTO_REFRESH_INTERVAL_OPTIONS = [10, 15, 30, 60] as const;

export type NoteContentLanguageSetting = 'auto' | 'zh-CN' | 'en';

export type ResolvedNoteContentLanguage = 'zh-CN' | 'en';

export type NoteContentLanguageSource = 'setting' | 'obsidian' | 'navigator' | 'fallback';

export type GraphProfile = 'off' | 'advisory' | 'strict';

const GRAPH_PROFILES: GraphProfile[] = ['off', 'advisory', 'strict'];

export type MemoryProposalRule = 'review_queue' | 'auto_write' | 'disabled';

export type TaskMemoryProposalMode = 'off' | 'suggest' | 'review_queue' | 'auto_propose';

export const MEMORY_RULES_VERSION = 3;

export const MEMORY_PROPOSAL_RULES: MemoryProposalRule[] = ['auto_write', 'review_queue', 'disabled'];

export const TASK_MEMORY_PROPOSAL_MODES: TaskMemoryProposalMode[] = ['auto_propose', 'review_queue', 'off'];

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

export const normalizeTaskMemoryProposalMode = (value: unknown): TaskMemoryProposalMode => {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	if (normalized === 'suggest') {
		return 'review_queue';
	}
	return TASK_MEMORY_PROPOSAL_MODES.includes(normalized as TaskMemoryProposalMode)
		? normalized as TaskMemoryProposalMode
		: 'off';
};

export const taskMemoryProposalModeLabel = (mode: TaskMemoryProposalMode): string => {
	switch (mode) {
		case 'review_queue':
		case 'suggest':
			return ui('审核', 'Review');
		case 'auto_propose':
			return ui('自动', 'Auto');
		case 'off':
		default:
			return ui('忽略', 'Ignore');
	}
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
