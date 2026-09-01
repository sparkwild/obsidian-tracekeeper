import crypto from 'node:crypto';

import {
	KNOWLEDGE_SOURCES_FILES_DIR,
	normalizeKnowledgePath,
} from './knowledge-architecture';
import { hashVaultContent, type NormalizedVaultNote } from './knowledge-note';
import {
	SOURCE_PART_MAX_BYTES,
	SOURCE_PART_MAX_COUNT,
} from './source-record';

const LEGACY_SEGMENT_PATH = /^(.*)-segment-(\d+)\.md$/iu;
const CONTENT_SEGMENT_SUFFIX = /#content-segment-(\d+)$/iu;
const PLAN_VERSION = 1 as const;

export interface LegacySourceSegment {
	path: string;
	segmentNumber: number;
	source: string;
	sourceId: string;
	contentHash: string;
	byteLength: number;
	content: string;
}
export interface LegacySourceSegmentIssue {
	code:
		| 'not_a_file_source'
		| 'segment_number_mismatch'
		| 'duplicate_segment_number'
		| 'segment_number_gap'
		| 'segment_too_large'
		| 'target_path_occupied';
	familyKey: string;
	paths: string[];
	message: string;
}

export interface LegacySourceSegmentPartPlan {
	partNumber: number;
	path: string;
	legacyPath: string;
	contentHash: string;
	byteLength: number;
	content: string;
}

export interface LegacySourceSegmentShardPlan {
	shardNumber: number;
	parentPath: string;
	parentSource: string;
	parentSourceId: string;
	segments: string[];
	parts: LegacySourceSegmentPartPlan[];
	parentContentHash: string;
}

export interface LegacySourceSegmentFamilyPlan {
	familyKey: string;
	originalSource: string;
	segments: LegacySourceSegment[];
	shards: LegacySourceSegmentShardPlan[];
}

export interface LegacySourceConsolidationPlan {
	version: typeof PLAN_VERSION;
	ready: boolean;
	createdAt: string;
	families: LegacySourceSegmentFamilyPlan[];
	issues: LegacySourceSegmentIssue[];
	oldSegmentCount: number;
	newParentCount: number;
	newPartCount: number;
	oldToNewParent: Array<{ oldPath: string; newParentPath: string }>;
	planHash: string;
}

export interface LegacySourceConsolidationOptions {
	occupiedPaths?: readonly string[];
	createdAt?: string;
}

type SourceNote = Pick<NormalizedVaultNote, 'path' | 'text' | 'contentHash' | 'frontmatter' | 'type' | 'size'>;

function normalizedType(note: SourceNote): string {
	return (typeof note.type === 'string' ? note.type : '')
		.trim()
		.toLocaleLowerCase('en-US')
		.replace(/_/g, '-');
}

function stringField(note: SourceNote, key: string): string {
	const value = note.frontmatter[key];
	return typeof value === 'string' ? value.trim() : '';
}

function segmentInfo(note: SourceNote): { prefix: string; number: number } | null {
	const normalizedPath = normalizeKnowledgePath(note.path);
	const match = normalizedPath.match(LEGACY_SEGMENT_PATH);
	if (!match) {
		return null;
	}
	const number = Number.parseInt(match[2] ?? '', 10);
	return Number.isSafeInteger(number) && number > 0
		? { prefix: match[1] ?? '', number }
		: null;
}

function sourceFamilyKey(note: SourceNote, prefix: string): string {
	const source = stringField(note, 'source').replace(CONTENT_SEGMENT_SUFFIX, '');
	return `${prefix}\0${source}`;
}

function sourceIdForShard(originalSource: string, shardNumber: number): string {
	return `source-${crypto.createHash('sha256').update(
		`file\0${originalSource}\0legacy-shard-${shardNumber}`,
		'utf8'
	).digest('hex').slice(0, 32)}`;
}

function parentPathFor(prefix: string, shardNumber: number): string {
	return `${prefix}-shard-${String(shardNumber).padStart(2, '0')}.md`;
}

function partPathFor(parentPath: string, partNumber: number): string {
	const stem = parentPath.replace(/\.md$/iu, '');
	return `${stem}.parts/part-${String(partNumber).padStart(4, '0')}.md`;
}

function canonicalParentContent(segments: readonly LegacySourceSegment[]): string {
	return segments.map((segment) => segment.content).join('\n');
}

function issue(
	code: LegacySourceSegmentIssue['code'],
	familyKey: string,
	paths: readonly string[],
	message: string,
): LegacySourceSegmentIssue {
	return { code, familyKey, paths: [...paths].sort(), message };
}

/**
 * Build a deterministic, read-only plan for converting legacy `*-segment-NNN`
 * Source captures into bounded Source indexes and Source parts. The planner
 * never moves, deletes, or rewrites Vault files.
 */
export function buildLegacySourceConsolidationPlan(
	notes: readonly SourceNote[],
	options: LegacySourceConsolidationOptions = {},
): LegacySourceConsolidationPlan {
	const occupied = new Set((options.occupiedPaths ?? notes.map((note) => note.path)).map((path) => normalizeKnowledgePath(path)));
	const candidates = new Map<string, { prefix: string; originalSource: string; notes: SourceNote[] }>();
	const issues: LegacySourceSegmentIssue[] = [];

	for (const note of notes) {
		const info = segmentInfo(note);
		if (!info) {
			continue;
		}
		const sourceKind = stringField(note, 'source_kind').toLocaleLowerCase('en-US');
		if (
			normalizedType(note) !== 'source-capture'
			|| !normalizeKnowledgePath(note.path).startsWith(`${KNOWLEDGE_SOURCES_FILES_DIR}/`)
			|| sourceKind !== 'file'
		) {
			issues.push(issue(
				'not_a_file_source',
				info.prefix,
				[note.path],
				'Legacy segment does not describe a file Source capture.',
			));
			continue;
		}
		const source = stringField(note, 'source');
		const familyKey = sourceFamilyKey(note, info.prefix);
		const family = candidates.get(familyKey) ?? {
			prefix: info.prefix,
			originalSource: source.replace(CONTENT_SEGMENT_SUFFIX, ''),
			notes: [],
		};
		family.notes.push(note);
		candidates.set(familyKey, family);
	}

	const families: LegacySourceSegmentFamilyPlan[] = [];
	const oldToNewParent: Array<{ oldPath: string; newParentPath: string }> = [];

	for (const [familyKey, candidate] of [...candidates.entries()].sort(([left], [right]) => left.localeCompare(right))) {
		const sortedNotes = [...candidate.notes].sort((left, right) => {
			const leftNumber = segmentInfo(left)?.number ?? 0;
			const rightNumber = segmentInfo(right)?.number ?? 0;
			return leftNumber - rightNumber || left.path.localeCompare(right.path);
		});
		if (sortedNotes.length < 2) {
			continue;
		}

		const segments = sortedNotes.map((note) => {
			const number = segmentInfo(note)?.number ?? 0;
			const source = stringField(note, 'source');
			const declaredNumber = source.match(CONTENT_SEGMENT_SUFFIX)?.[1];
			if (declaredNumber && Number.parseInt(declaredNumber, 10) !== number) {
				issues.push(issue(
					'segment_number_mismatch',
					familyKey,
					[note.path],
					'Path segment number and source metadata segment number do not match.',
				));
			}
			const byteLength = Buffer.byteLength(note.text, 'utf8');
			if (byteLength > SOURCE_PART_MAX_BYTES) {
				issues.push(issue(
					'segment_too_large',
					familyKey,
					[note.path],
					`Legacy segment exceeds the ${SOURCE_PART_MAX_BYTES}-byte Source part limit.`,
				));
			}
			return {
				path: normalizeKnowledgePath(note.path),
				segmentNumber: number,
				source,
				sourceId: stringField(note, 'source_id'),
				contentHash: note.contentHash,
				byteLength,
				content: note.text,
			};
		});

		const seenNumbers = new Set<number>();
		for (const segment of segments) {
			if (seenNumbers.has(segment.segmentNumber)) {
				issues.push(issue(
					'duplicate_segment_number',
					familyKey,
					[segment.path],
					`Duplicate legacy segment number: ${segment.segmentNumber}.`,
				));
			}
			seenNumbers.add(segment.segmentNumber);
		}
		const expectedNumbers = Array.from({ length: segments.length }, (_, index) => index + 1);
		if (segments.some((segment, index) => segment.segmentNumber !== expectedNumbers[index])) {
			issues.push(issue(
				'segment_number_gap',
				familyKey,
				segments.map((segment) => segment.path),
				'Legacy segment numbers must be contiguous and start at 1.',
			));
		}

		const shards: LegacySourceSegmentShardPlan[] = [];
		for (let offset = 0, shardNumber = 1; offset < segments.length; offset += SOURCE_PART_MAX_COUNT, shardNumber += 1) {
			const shardSegments = segments.slice(offset, offset + SOURCE_PART_MAX_COUNT);
			const parentPath = parentPathFor(candidate.prefix, shardNumber);
			const parentSource = `${candidate.originalSource}#content-shard-${String(shardNumber).padStart(2, '0')}`;
			const parentSourceId = sourceIdForShard(candidate.originalSource, shardNumber);
			const parts = shardSegments.map((segment, index) => ({
				partNumber: index + 1,
				path: partPathFor(parentPath, index + 1),
				legacyPath: segment.path,
				contentHash: `sha256:${hashVaultContent(segment.content)}`,
				byteLength: segment.byteLength,
				content: segment.content,
			}));
			const shard: LegacySourceSegmentShardPlan = {
				shardNumber,
				parentPath,
				parentSource,
				parentSourceId,
				segments: shardSegments.map((segment) => segment.path),
				parts,
				parentContentHash: `sha256:${hashVaultContent(canonicalParentContent(shardSegments))}`,
			};
			if (occupied.has(parentPath) || occupied.has(normalizeKnowledgePath(parentPath))) {
				issues.push(issue(
					'target_path_occupied',
					familyKey,
					[parentPath],
					`Consolidation target already exists: ${parentPath}.`,
				));
			}
			if (parts.some((part) => occupied.has(part.path))) {
				issues.push(issue(
					'target_path_occupied',
					familyKey,
					parts.filter((part) => occupied.has(part.path)).map((part) => part.path),
					'One or more Source part targets already exist.',
				));
			}
			for (const segment of shardSegments) {
				oldToNewParent.push({ oldPath: segment.path, newParentPath: parentPath });
			}
			shards.push(shard);
		}

		families.push({
			familyKey,
			originalSource: candidate.originalSource,
			segments,
			shards,
		});
	}

	const oldSegmentCount = families.reduce((total, family) => total + family.segments.length, 0);
	const newParentCount = families.reduce((total, family) => total + family.shards.length, 0);
	const newPartCount = families.reduce(
		(total, family) => total + family.shards.reduce((shardTotal, shard) => shardTotal + shard.parts.length, 0),
		0,
	);
	const planFingerprint = JSON.stringify({
		version: PLAN_VERSION,
		families: families.map((family) => ({
			familyKey: family.familyKey,
			originalSource: family.originalSource,
			segments: family.segments.map((segment) => ({
				path: segment.path,
				segmentNumber: segment.segmentNumber,
				contentHash: segment.contentHash,
			})),
			shards: family.shards.map((shard) => ({
				shardNumber: shard.shardNumber,
				parentPath: shard.parentPath,
				parts: shard.parts.map((part) => ({
					path: part.path,
					legacyPath: part.legacyPath,
					contentHash: part.contentHash,
				})),
			})),
		})),
		issues: issues.map((item) => ({ code: item.code, familyKey: item.familyKey, paths: item.paths })),
	});

	return {
		version: PLAN_VERSION,
		ready: issues.length === 0 && oldSegmentCount > 0,
		createdAt: options.createdAt ?? new Date().toISOString(),
		families,
		issues: issues.sort((left, right) => left.familyKey.localeCompare(right.familyKey) || left.code.localeCompare(right.code)),
		oldSegmentCount,
		newParentCount,
		newPartCount,
		oldToNewParent: oldToNewParent.sort((left, right) => left.oldPath.localeCompare(right.oldPath)),
		planHash: `sha256:${hashVaultContent(planFingerprint)}`,
	};
}
