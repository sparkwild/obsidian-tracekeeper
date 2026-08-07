import crypto from 'node:crypto';

import {
	KNOWLEDGE_SOURCES_FILES_DIR,
	KNOWLEDGE_SOURCES_TRANSCRIPTS_DIR,
	KNOWLEDGE_SOURCES_WEB_DIR,
} from './knowledge-architecture';

export type NormalizedSourceKind = 'web' | 'file' | 'transcript';

export const SOURCE_INLINE_CONTENT_LIMIT_BYTES = 128 * 1024;
export const SOURCE_PART_MAX_BYTES = 64 * 1024;
export const SOURCE_PART_MAX_COUNT = 16;

export interface SourcePartPlan {
	part_number: number;
	path: string;
	content_hash: string;
	byte_length: number;
	content: string;
}

export interface SourceCapturePlan {
	source_kind: NormalizedSourceKind;
	source_id: string;
	content_hash: string;
	route: string;
	index_path: string;
	inline_content: string;
	parts: SourcePartPlan[];
}

const SOURCE_KIND_ALIASES: Record<string, NormalizedSourceKind> = {
	web: 'web',
	url: 'web',
	article: 'web',
	file: 'file',
	files: 'file',
	local: 'file',
	document: 'file',
	transcript: 'transcript',
	transcripts: 'transcript',
	audio: 'transcript',
	video: 'transcript',
	meeting: 'transcript',
};

export function normalizeSourceKind(value: unknown): NormalizedSourceKind {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	const sourceKind = SOURCE_KIND_ALIASES[normalized];
	if (!sourceKind) {
		throw new Error('source_kind must resolve to one of: web | file | transcript.');
	}
	return sourceKind;
}

export function sourceRouteForKind(sourceKind: NormalizedSourceKind): string {
	switch (sourceKind) {
		case 'web': return KNOWLEDGE_SOURCES_WEB_DIR;
		case 'file': return KNOWLEDGE_SOURCES_FILES_DIR;
		case 'transcript': return KNOWLEDGE_SOURCES_TRANSCRIPTS_DIR;
	}
}

export function buildSourceCapturePlan(input: {
	source: string;
	sourceKind: unknown;
	filename: string;
	content: string;
}): SourceCapturePlan {
	const sourceKind = normalizeSourceKind(input.sourceKind);
	const route = sourceRouteForKind(sourceKind);
	const contentHash = sha256(input.content || input.source);
	const sourceId = `source-${sha256(`${sourceKind}\0${input.source}`).slice(0, 32)}`;
	const bytes = Buffer.byteLength(input.content, 'utf8');
	if (bytes <= SOURCE_INLINE_CONTENT_LIMIT_BYTES) {
		return {
			source_kind: sourceKind,
			source_id: sourceId,
			content_hash: `sha256:${contentHash}`,
			route,
			index_path: `${route}/${input.filename}.md`,
			inline_content: input.content,
			parts: [],
		};
	}
	const chunks = splitUtf8(input.content, SOURCE_PART_MAX_BYTES);
	if (chunks.length > SOURCE_PART_MAX_COUNT) {
		throw new Error(`source content exceeds the bounded ${SOURCE_PART_MAX_COUNT}-part limit.`);
	}
	return {
		source_kind: sourceKind,
		source_id: sourceId,
		content_hash: `sha256:${contentHash}`,
		route,
		index_path: `${route}/${input.filename}.md`,
		inline_content: '',
		parts: chunks.map((content, index) => ({
			part_number: index + 1,
			path: `${route}/${input.filename}.parts/part-${String(index + 1).padStart(4, '0')}.md`,
			content_hash: `sha256:${sha256(content)}`,
			byte_length: Buffer.byteLength(content, 'utf8'),
			content,
		})),
	};
}

function splitUtf8(content: string, maxBytes: number): string[] {
	const chunks: string[] = [];
	let current = '';
	let currentBytes = 0;
	for (const character of content) {
		const characterBytes = Buffer.byteLength(character, 'utf8');
		if (current && currentBytes + characterBytes > maxBytes) {
			chunks.push(current);
			current = '';
			currentBytes = 0;
		}
		current += character;
		currentBytes += characterBytes;
	}
	if (current) chunks.push(current);
	return chunks;
}

function sha256(value: string): string {
	return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
