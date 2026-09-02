const SUPPORTED_WRITEBACK_HEADINGS = new Set([
	'writeback',
	'approved writeback',
	'writeback content',
	'写回',
	'已批准写回',
	'写回内容',
]);

const PROPOSAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const START_MARKER_PATTERN = /^\s*<!--\s*tracekeeper:writeback:start\s+proposal_id="([^"]+)"\s*-->\s*$/gm;
const END_MARKER_PATTERN = /^\s*<!--\s*tracekeeper:writeback:end\s+proposal_id="([^"]+)"\s*-->\s*$/gm;

export type ProposalWritebackFormat =
	| 'bounded_v2'
	| 'legacy_heading'
	| 'frontmatter_v1'
	| 'missing'
	| 'invalid';

export type ProposalWritebackError =
	| 'invalid_proposal_id'
	| 'invalid_boundary'
	| 'boundary_id_mismatch'
	| 'legacy_boundary_ambiguous'
	| 'conflicting_sources'
	| null;

export interface ProposalWritebackResult {
	content: string;
	format: ProposalWritebackFormat;
	source: 'body' | 'frontmatter' | 'none';
	ambiguous: boolean;
	error: ProposalWritebackError;
}

interface MarkerMatch {
	id: string;
	start: number;
	end: number;
}

interface BodyWritebackResult extends ProposalWritebackResult {
	contentStart?: number;
	contentEnd?: number;
	headingStart?: number;
}

export interface ResolveProposalWritebackInput {
	body: string;
	proposalId: string;
	frontmatterContent?: string;
}

export class ProposalWritebackFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProposalWritebackFormatError';
	}
}

const normalizeMarkdown = (value: string): string =>
	value.replace(/\r\n?/g, '\n');

const normalizePayload = (value: string): string =>
	normalizeMarkdown(value).trim();

const assertProposalId = (proposalId: string): void => {
	if (!PROPOSAL_ID_PATTERN.test(proposalId)) {
		throw new ProposalWritebackFormatError('Proposal id cannot be used as a writeback boundary.');
	}
};

const markerMatches = (body: string, pattern: RegExp): MarkerMatch[] => {
	const matches: MarkerMatch[] = [];
	pattern.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(body)) !== null) {
		matches.push({
			id: match[1] || '',
			start: match.index,
			end: match.index + match[0].length,
		});
	}
	return matches;
};

const invalidBodyResult = (error: Exclude<ProposalWritebackError, null>): BodyWritebackResult => ({
	content: '',
	format: 'invalid',
	source: 'body',
	ambiguous: true,
	error,
});

const parseBoundedWriteback = (
	body: string,
	proposalId: string
): BodyWritebackResult | null => {
	const starts = markerMatches(body, START_MARKER_PATTERN);
	const ends = markerMatches(body, END_MARKER_PATTERN);
	if (starts.length === 0 && ends.length === 0) {
		return null;
	}
	if (!PROPOSAL_ID_PATTERN.test(proposalId)) {
		return invalidBodyResult('invalid_proposal_id');
	}
	if (starts.length !== 1 || ends.length !== 1) {
		return invalidBodyResult('invalid_boundary');
	}
	const start = starts[0];
	const end = ends[0];
	if (start.id !== proposalId || end.id !== proposalId) {
		return invalidBodyResult('boundary_id_mismatch');
	}
	if (start.end >= end.start) {
		return invalidBodyResult('invalid_boundary');
	}
	let contentStart = start.end;
	if (body[contentStart] === '\n') {
		contentStart += 1;
	}
	return {
		content: normalizePayload(body.slice(contentStart, end.start)),
		format: 'bounded_v2',
		source: 'body',
		ambiguous: false,
		error: null,
		contentStart,
		contentEnd: end.start,
	};
};

const parseLegacyWriteback = (body: string): BodyWritebackResult => {
	const normalized = normalizeMarkdown(body);
	const lines = normalized.split('\n');
	let offset = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const lineStart = offset;
		offset += line.length + (index < lines.length - 1 ? 1 : 0);
		const match = line.match(/^\s*#{2,}\s*(.+?)\s*$/);
		const heading = match?.[1]?.trim().replace(/\s+/g, ' ').toLowerCase() || '';
		if (!heading || !SUPPORTED_WRITEBACK_HEADINGS.has(heading)) {
			continue;
		}
		const managedCandidate = lines.slice(index + 1).join('\n').trim();
		const managedStarts = managedCandidate.match(/<!--\s*tracekeeper:relations:start\s+schema="(?:1"|2"\s+role="(?:topic|topic_map)")\s+hash="sha256:[a-f0-9]{64}"\s*-->/g) ?? [];
		const managedEnds = managedCandidate.match(/<!--\s*tracekeeper:relations:end\s*-->/g) ?? [];
		if (
			managedStarts.length === 1
			&& managedEnds.length === 1
			&& managedCandidate.startsWith(managedStarts[0])
			&& managedCandidate.endsWith(managedEnds[0])
		) {
			return {
				content: managedCandidate,
				format: 'legacy_heading',
				source: 'body',
				ambiguous: false,
				error: null,
				contentStart: offset,
				contentEnd: normalized.length,
				headingStart: lineStart,
			};
		}
		const content: string[] = [];
		let contentEnd = normalized.length;
		let ambiguous = false;
		for (let next = index + 1; next < lines.length; next += 1) {
			if (/^\s*#{2,}\s*(.+?)\s*$/.test(lines[next])) {
				contentEnd = lines.slice(0, next).join('\n').length;
				ambiguous = true;
				break;
			}
			content.push(lines[next]);
		}
		return {
			content: normalizePayload(content.join('\n')),
			format: 'legacy_heading',
			source: 'body',
			ambiguous,
			error: ambiguous ? 'legacy_boundary_ambiguous' : null,
			contentStart: offset,
			contentEnd,
			headingStart: lineStart,
		};
	}
	return {
		content: '',
		format: 'missing',
		source: 'none',
		ambiguous: false,
		error: null,
	};
};

export function renderProposalWritebackSection(
	heading: string,
	proposalId: string,
	content: string
): string {
	assertProposalId(proposalId);
	const normalizedHeading = heading.trim();
	if (!normalizedHeading) {
		throw new ProposalWritebackFormatError('Proposal writeback heading is required.');
	}
	const payload = normalizePayload(content);
	if (
		markerMatches(payload, START_MARKER_PATTERN).length > 0
		|| markerMatches(payload, END_MARKER_PATTERN).length > 0
	) {
		throw new ProposalWritebackFormatError('Proposal writeback content contains a reserved boundary marker.');
	}
	return [
		normalizedHeading,
		'',
		`<!-- tracekeeper:writeback:start proposal_id="${proposalId}" -->`,
		payload,
		`<!-- tracekeeper:writeback:end proposal_id="${proposalId}" -->`,
	].join('\n');
}

export function parseProposalWritebackBody(
	body: string,
	proposalId: string
): ProposalWritebackResult {
	const normalized = normalizeMarkdown(body);
	return parseBoundedWriteback(normalized, proposalId)
		?? parseLegacyWriteback(normalized);
}

export function resolveProposalWriteback(
	input: ResolveProposalWritebackInput
): ProposalWritebackResult {
	const bodyResult = parseProposalWritebackBody(input.body, input.proposalId);
	const frontmatterContent = normalizePayload(input.frontmatterContent || '');
	if (bodyResult.format === 'invalid' || bodyResult.ambiguous) {
		return bodyResult;
	}
	if (frontmatterContent && bodyResult.content && frontmatterContent !== bodyResult.content) {
		return {
			content: '',
			format: 'invalid',
			source: 'none',
			ambiguous: true,
			error: 'conflicting_sources',
		};
	}
	if (frontmatterContent) {
		return {
			content: frontmatterContent,
			format: bodyResult.format === 'bounded_v2' ? 'bounded_v2' : 'frontmatter_v1',
			source: bodyResult.content ? 'body' : 'frontmatter',
			ambiguous: false,
			error: null,
		};
	}
	return bodyResult;
}

export function replaceProposalWriteback(
	body: string,
	proposalId: string,
	content: string
): string {
	const normalized = normalizeMarkdown(body);
	const parsed = parseBoundedWriteback(normalized, proposalId)
		?? parseLegacyWriteback(normalized);
	if (parsed.format === 'invalid' || parsed.ambiguous) {
		throw new ProposalWritebackFormatError('Proposal writeback boundary is ambiguous or invalid.');
	}
	if (parsed.format === 'missing') {
		throw new ProposalWritebackFormatError('Proposal writeback section is missing.');
	}
	const payload = normalizePayload(content);
	const hadTrailingNewline = normalized.endsWith('\n');
	let replaced: string;
	if (parsed.format === 'bounded_v2') {
		replaced = `${normalized.slice(0, parsed.contentStart)}${payload}\n${normalized.slice(parsed.contentEnd ?? 0)}`;
	} else {
		const headingLineEnd = normalized.indexOf('\n', parsed.headingStart ?? 0);
		const prefixEnd = headingLineEnd >= 0 ? headingLineEnd : normalized.length;
		const heading = normalized.slice(parsed.headingStart ?? 0, prefixEnd);
		replaced = `${normalized.slice(0, parsed.headingStart)}${renderProposalWritebackSection(
			heading,
			proposalId,
			payload
		)}`;
	}
	return hadTrailingNewline && !replaced.endsWith('\n') ? `${replaced}\n` : replaced;
}
