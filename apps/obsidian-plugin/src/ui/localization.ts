import { getLanguage } from 'obsidian';

export const PLUGIN_DISPLAY_NAME_ZH = 'Tracekeeper';

export const PLUGIN_DISPLAY_NAME_EN = 'Tracekeeper';

export interface LocalizedText {
	zh: string;
	en: string;
}

export const isChineseLanguage = (language: string): boolean => {
	const normalized = language.toLowerCase();
	return normalized === 'zh' || normalized.startsWith('zh-') || normalized.startsWith('zh_');
};

export const ui = (zh: string, en: string): string => (isChineseLanguage(getLanguage()) ? zh : en);

export const localizedText = (text: LocalizedText): string => ui(text.zh, text.en);

export const pluginDisplayName = (): string => ui(PLUGIN_DISPLAY_NAME_ZH, PLUGIN_DISPLAY_NAME_EN);
