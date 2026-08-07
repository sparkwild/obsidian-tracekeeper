export interface SourceAnalysisInput {
	source: string;
	sourceKind: string;
	analysisMode: string;
	contentLanguage?: SourceAnalysisContentLanguage;
	purpose?: string;
	content?: string;
	requestPath?: string;
}

export type SourceAnalysisContentLanguage = 'zh-CN' | 'en';

export interface SourceProposalDraft {
	title: string;
	proposalKind: string;
	evidence: string;
	riskLevel: string;
	content: string;
}

export interface SourceAnalysisResult {
	summary: string;
	excerpt: string;
	evidenceScaffolds: string[];
	claimScaffolds: string[];
	proposalDrafts: SourceProposalDraft[];
}

const MAX_EXCERPT_LENGTH = 1000;
const MAX_SUMMARY_SENTENCES = 4;
const MAX_SCAFFOLDS = 8;
const MAX_PROPOSALS = 2;

const CLAIM_HINT_RE = /\b(is|are|was|were|means|implies|shows|indicates|suggests|argues|claims|requires|proves|finds|found)\b|是|表明|意味着|显示|指出|建议|认为|需要|证明|发现|得出/i;
const IMPORTANT_HINT_RE = /\b(study|report|document|source|evidence|result|analysis|claim|issue|risk|decision|policy|metric)\b|研究|报告|文档|来源|证据|结果|分析|主张|问题|风险|决策|政策|指标/i;

function isChineseContentLanguage(language: SourceAnalysisContentLanguage): boolean {
	return language === 'zh-CN';
}

function localizedText(language: SourceAnalysisContentLanguage, zh: string, en: string): string {
	return isChineseContentLanguage(language) ? zh : en;
}

function localizedLabel(language: SourceAnalysisContentLanguage, zh: string, en: string, value: string): string {
	return `${localizedText(language, zh, en)}${isChineseContentLanguage(language) ? '：' : ': '}${value}`;
}

function sanitizeText(rawText: string): string {
	return (rawText || '').replace(/\r\n/g, '\n').replace(/\u200b/g, '').trim();
}

function splitSentences(text: string): string[] {
	const normalized = sanitizeText(text);
	if (!normalized) {
		return [];
	}

	const rough = normalized
		.split(/(?<=[.!?。！？\n])\s+/)
		.map((chunk) => chunk.replace(/\s+/g, ' ').trim())
		.filter((item) => item.length > 0);

	return rough;
}

function uniqueOrdered<T>(items: T[]): T[] {
	const seen = new Set<string>();
	const unique: T[] = [];
	for (const item of items) {
		const key = String(item);
		if (key.trim() === '') {
			continue;
		}
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(item);
	}
	return unique;
}

function extractEvidenceCandidates(text: string, language: SourceAnalysisContentLanguage): string[] {
	const lines = sanitizeText(text).split('\n');
	const candidates: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}

		if (trimmed.startsWith('> ')) {
			candidates.push(localizedLabel(language, '引用', 'quote', trimmed.replace(/^>\s?/, '')));
		}

		const urls = trimmed.match(/https?:\/\/[^\s\]")]+/gi);
		if (urls) {
			for (const url of urls) {
				candidates.push(localizedLabel(language, '外部引用', 'external_reference', url));
			}
		}

		if (/^\s*[-*]\s+\[?(x| )\]?\s+/.test(trimmed) && trimmed.length > 8) {
			candidates.push(localizedLabel(language, '列表项', 'bullet_item', trimmed));
		}

		if (trimmed.startsWith('#')) {
			candidates.push(localizedLabel(language, '章节标题', 'section_title', trimmed));
		}
	}

	return uniqueOrdered(candidates).slice(0, MAX_SCAFFOLDS);
}

function extractClaimCandidates(text: string, language: SourceAnalysisContentLanguage): string[] {
	const sentences = splitSentences(text);
	const candidates = sentences
		.filter((sentence) => sentence.length >= 20 && CLAIM_HINT_RE.test(sentence))
		.map((sentence) => localizedLabel(language, '主张', 'claim', sentence));

	return uniqueOrdered(candidates).slice(0, 5);
}

function buildSummary(
	source: string,
	analysisMode: string,
	purpose: string,
	text: string,
	language: SourceAnalysisContentLanguage
): string {
	const cleanText = sanitizeText(text);
	const sentences = splitSentences(cleanText);
	const separator = isChineseContentLanguage(language) ? '：' : ': ';
	const purposeHint = purpose ? ` | ${localizedText(language, '目的', 'purpose')}${separator}${sanitizeText(purpose)}` : '';
	const sourceHint = source
		? `${localizedText(language, '来源', 'source')}${separator}${source}`
		: localizedText(language, '来源：未知', 'source: unknown');
	const modeHint = analysisMode
		? `${localizedText(language, '模式', 'mode')}${separator}${analysisMode}`
		: `${localizedText(language, '模式', 'mode')}${separator}local_text`;

	if (!cleanText) {
		return localizedText(
			language,
			`未捕获 ${sourceHint} 的内联正文。${purposeHint}。${modeHint}。`,
			`No inline text was captured for ${sourceHint}${purposeHint}. ${modeHint}.`
		);
	}

	const shortSentences = sentences.slice(0, MAX_SUMMARY_SENTENCES).join(' ');
	return `${shortSentences} ${purposeHint} (${modeHint})`.trim();
}

function excerptFromText(text: string): string {
	const trimmed = sanitizeText(text);
	return trimmed.length > MAX_EXCERPT_LENGTH ? `${trimmed.slice(0, MAX_EXCERPT_LENGTH)}...` : trimmed;
}

function buildProposalDrafts(
	source: string,
	sourceKind: string,
	analysisMode: string,
	summary: string,
	evidences: string[],
	claims: string[],
	requestPath: string | undefined,
	language: SourceAnalysisContentLanguage
): SourceProposalDraft[] {
	const drafts: SourceProposalDraft[] = [];
	const evidenceText = evidences.length > 0
		? evidences.join('\n')
		: localizedText(language, '未提取到明确的证据脚手架。', 'No explicit evidence scaffold extracted.');
	const claimText = claims.length > 0
		? claims.join('\n')
		: localizedText(language, '未提取到明确的主张脚手架。', 'No explicit claim scaffold extracted.');
	const sourceLabel = localizedText(language, '来源', 'source');
	const sourceKindLabel = localizedText(language, '来源类型', 'source_kind');
	const analysisModeLabel = localizedText(language, '分析模式', 'analysis_mode');
	const requestPathLabel = localizedText(language, '请求路径', 'request_path');
	const riskLevelLabel = localizedText(language, '风险等级', 'risk_level');
	const fieldSeparator = isChineseContentLanguage(language) ? '：' : ': ';

	drafts.push({
		title: localizedText(language, `来源分析：${source || '未解析来源'}`, `Source analysis: ${source || 'unresolved source'}`),
		proposalKind: sourceKind === 'url' || sourceKind === 'external_reference' ? 'external_source_follow_up' : 'source_insight_draft',
		riskLevel: sourceKind === 'url' || sourceKind === 'external_reference' ? 'medium' : 'low',
		evidence: evidenceText,
		content:
			`${localizedText(language, '## 提案草稿', '## Proposal draft')}\n\n` +
			`- ${sourceLabel}${fieldSeparator}${source || localizedText(language, '未知', 'unknown')}\n` +
			`- ${sourceKindLabel}${fieldSeparator}${sourceKind || localizedText(language, '未知', 'unknown')}\n` +
			`- ${analysisModeLabel}${fieldSeparator}${analysisMode || 'default'}\n` +
			(requestPath ? `- ${requestPathLabel}${fieldSeparator}${requestPath}\n` : '') +
			`- ${riskLevelLabel}${fieldSeparator}${sourceKind === 'url' || sourceKind === 'external_reference' ? 'medium' : 'low'}\n\n` +
			`${localizedText(language, '### 提案摘要', '### Proposal summary')}\n${summary}\n\n` +
			`${localizedText(language, '### 候选主张', '### Candidate claims')}\n${claimText}\n\n` +
			`${localizedText(language, '### 候选证据', '### Candidate evidence')}\n${evidenceText}\n`,
	});

	if (claims.length > 0) {
		drafts.push({
			title: localizedText(language, `来源证据跟进：${source || '未知'}`, `Source evidence follow-up: ${source || 'unknown'}`),
			proposalKind: 'source_evidence_check',
			riskLevel: 'low',
			evidence: evidences.slice(0, 2).join('\n') || localizedText(language, '未找到证据脚手架。', 'No evidence scaffold found.'),
			content:
				`${localizedText(language, '## 提案草稿', '## Proposal draft')}\n\n` +
				`- ${sourceLabel}${fieldSeparator}${source || localizedText(language, '未知', 'unknown')}\n` +
				`- ${sourceKindLabel}${fieldSeparator}${sourceKind || localizedText(language, '未知', 'unknown')}\n` +
				`- ${analysisModeLabel}${fieldSeparator}${analysisMode || 'default'}\n` +
				`- ${localizedText(language, '提案类型提示', 'proposal_kind_hint')}${fieldSeparator}evidence_followup\n\n` +
				`${localizedText(language, '### 待跟进验证的主张', '### Claim candidates for follow-up verification')}\n` +
				claims.map((claim) => `- ${claim}`).join('\n') +
				'\n\n' +
				`${localizedText(language, '### 后续动作', '### Follow-up action')}\n` +
				`- ${localizedText(language, '提交这些主张前，先补齐缺失的直接证据引用。', 'Resolve missing direct evidence references before committing these claims.')}\n`,
		});
	}

	return drafts.slice(0, MAX_PROPOSALS);
}

export function analyzeSourceText(input: SourceAnalysisInput): SourceAnalysisResult {
	const source = sanitizeText(input.source);
	const sourceKind = sanitizeText(input.sourceKind) || 'unknown';
	const analysisMode = sanitizeText(input.analysisMode) || 'default';
	const contentLanguage: SourceAnalysisContentLanguage = input.contentLanguage === 'zh-CN' ? 'zh-CN' : 'en';
	const purpose = sanitizeText(input.purpose || '');
	const content = sanitizeText(input.content || '');

	const summary = buildSummary(source, analysisMode, purpose, content, contentLanguage);
	const evidenceScaffolds = extractEvidenceCandidates(content, contentLanguage);
	const claimScaffolds = extractClaimCandidates(content, contentLanguage);
	const proposalDrafts = buildProposalDrafts(source, sourceKind, analysisMode, summary, evidenceScaffolds, claimScaffolds, input.requestPath, contentLanguage);

	let finalClaimScaffolds = claimScaffolds;
	if (finalClaimScaffolds.length === 0) {
		const fallback = isChineseContentLanguage(contentLanguage)
			? ['主张：重新检查来源正文中的明确事实断言。', '主张：确认来源意图是否与既定目的相符。']
			: ['claim: Re-check source text for explicit factual assertions.', 'claim: Confirm whether source intent aligns with the stated purpose.'];
		finalClaimScaffolds = fallback;
	}

	if (IMPORTANT_HINT_RE.test(content) && evidenceScaffolds.length === 0) {
		evidenceScaffolds.push(localizedText(
			contentLanguage,
			'证据：重新扫描来源中的具体引用或链接。',
			'evidence: Re-scan source for concrete references or links.'
		));
	}

	return {
		summary,
		excerpt: excerptFromText(content),
		evidenceScaffolds,
		claimScaffolds: finalClaimScaffolds,
		proposalDrafts,
	};
}
