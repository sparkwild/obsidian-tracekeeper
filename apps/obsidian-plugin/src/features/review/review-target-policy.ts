import {
	KNOWLEDGE_INDEX_PATH,
	KNOWLEDGE_MEMORY_DIR,
	KNOWLEDGE_WIKI_DIR,
	normalizeKnowledgePath,
	startsWithPathPrefix,
} from '@tracekeeper/core';

const normalizeMarkdownTarget = (value: string): string => {
	const normalized = normalizeKnowledgePath(value);
	const segments = normalized.split('/');
	if (
		!normalized
		|| !normalized.toLowerCase().endsWith('.md')
		|| segments.some((segment) => segment === '.' || segment === '..')
	) {
		return '';
	}
	return normalized;
};

export const normalizeReviewTargetPath = (value: string): string =>
	normalizeMarkdownTarget(value);

export const isReviewApprovalTargetPath = (value: string): boolean => {
	const normalized = normalizeMarkdownTarget(value);
	if (!normalized) {
		return false;
	}
	return normalized === KNOWLEDGE_INDEX_PATH
		|| startsWithPathPrefix(normalized, KNOWLEDGE_MEMORY_DIR)
		|| startsWithPathPrefix(normalized, KNOWLEDGE_WIKI_DIR);
};

export const isReviewRemediationTargetPath = (value: string): boolean => {
	const normalized = normalizeMarkdownTarget(value);
	if (!normalized) {
		return false;
	}
	return startsWithPathPrefix(normalized, KNOWLEDGE_MEMORY_DIR)
		|| startsWithPathPrefix(normalized, KNOWLEDGE_WIKI_DIR);
};
