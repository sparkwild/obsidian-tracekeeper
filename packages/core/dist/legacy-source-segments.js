"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLegacySourceConsolidationPlan = buildLegacySourceConsolidationPlan;
const node_crypto_1 = __importDefault(require("node:crypto"));
const knowledge_architecture_1 = require("./knowledge-architecture");
const knowledge_note_1 = require("./knowledge-note");
const source_record_1 = require("./source-record");
const LEGACY_SEGMENT_PATH = /^(.*)-segment-(\d+)\.md$/iu;
const CONTENT_SEGMENT_SUFFIX = /#content-segment-(\d+)$/iu;
const PLAN_VERSION = 1;
function normalizedType(note) {
    return (typeof note.type === 'string' ? note.type : '')
        .trim()
        .toLocaleLowerCase('en-US')
        .replace(/_/g, '-');
}
function stringField(note, key) {
    const value = note.frontmatter[key];
    return typeof value === 'string' ? value.trim() : '';
}
function segmentInfo(note) {
    const normalizedPath = (0, knowledge_architecture_1.normalizeKnowledgePath)(note.path);
    const match = normalizedPath.match(LEGACY_SEGMENT_PATH);
    if (!match) {
        return null;
    }
    const number = Number.parseInt(match[2] ?? '', 10);
    return Number.isSafeInteger(number) && number > 0
        ? { prefix: match[1] ?? '', number }
        : null;
}
function sourceFamilyKey(note, prefix) {
    const source = stringField(note, 'source').replace(CONTENT_SEGMENT_SUFFIX, '');
    return `${prefix}\0${source}`;
}
function sourceIdForShard(originalSource, shardNumber) {
    return `source-${node_crypto_1.default.createHash('sha256').update(`file\0${originalSource}\0legacy-shard-${shardNumber}`, 'utf8').digest('hex').slice(0, 32)}`;
}
function parentPathFor(prefix, shardNumber) {
    return `${prefix}-shard-${String(shardNumber).padStart(2, '0')}.md`;
}
function partPathFor(parentPath, partNumber) {
    const stem = parentPath.replace(/\.md$/iu, '');
    return `${stem}.parts/part-${String(partNumber).padStart(4, '0')}.md`;
}
function canonicalParentContent(segments) {
    return segments.map((segment) => segment.content).join('\n');
}
function issue(code, familyKey, paths, message) {
    return { code, familyKey, paths: [...paths].sort(), message };
}
/**
 * Build a deterministic, read-only plan for converting legacy `*-segment-NNN`
 * Source captures into bounded Source indexes and Source parts. The planner
 * never moves, deletes, or rewrites Vault files.
 */
function buildLegacySourceConsolidationPlan(notes, options = {}) {
    const occupied = new Set((options.occupiedPaths ?? notes.map((note) => note.path)).map((path) => (0, knowledge_architecture_1.normalizeKnowledgePath)(path)));
    const candidates = new Map();
    const issues = [];
    for (const note of notes) {
        const info = segmentInfo(note);
        if (!info) {
            continue;
        }
        const sourceKind = stringField(note, 'source_kind').toLocaleLowerCase('en-US');
        if (normalizedType(note) !== 'source-capture'
            || !(0, knowledge_architecture_1.normalizeKnowledgePath)(note.path).startsWith(`${knowledge_architecture_1.KNOWLEDGE_SOURCES_FILES_DIR}/`)
            || sourceKind !== 'file') {
            issues.push(issue('not_a_file_source', info.prefix, [note.path], 'Legacy segment does not describe a file Source capture.'));
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
    const families = [];
    const oldToNewParent = [];
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
                issues.push(issue('segment_number_mismatch', familyKey, [note.path], 'Path segment number and source metadata segment number do not match.'));
            }
            const byteLength = Buffer.byteLength(note.text, 'utf8');
            if (byteLength > source_record_1.SOURCE_PART_MAX_BYTES) {
                issues.push(issue('segment_too_large', familyKey, [note.path], `Legacy segment exceeds the ${source_record_1.SOURCE_PART_MAX_BYTES}-byte Source part limit.`));
            }
            return {
                path: (0, knowledge_architecture_1.normalizeKnowledgePath)(note.path),
                segmentNumber: number,
                source,
                sourceId: stringField(note, 'source_id'),
                contentHash: note.contentHash,
                byteLength,
                content: note.text,
            };
        });
        const seenNumbers = new Set();
        for (const segment of segments) {
            if (seenNumbers.has(segment.segmentNumber)) {
                issues.push(issue('duplicate_segment_number', familyKey, [segment.path], `Duplicate legacy segment number: ${segment.segmentNumber}.`));
            }
            seenNumbers.add(segment.segmentNumber);
        }
        const expectedNumbers = Array.from({ length: segments.length }, (_, index) => index + 1);
        if (segments.some((segment, index) => segment.segmentNumber !== expectedNumbers[index])) {
            issues.push(issue('segment_number_gap', familyKey, segments.map((segment) => segment.path), 'Legacy segment numbers must be contiguous and start at 1.'));
        }
        const shards = [];
        for (let offset = 0, shardNumber = 1; offset < segments.length; offset += source_record_1.SOURCE_PART_MAX_COUNT, shardNumber += 1) {
            const shardSegments = segments.slice(offset, offset + source_record_1.SOURCE_PART_MAX_COUNT);
            const parentPath = parentPathFor(candidate.prefix, shardNumber);
            const parentSource = `${candidate.originalSource}#content-shard-${String(shardNumber).padStart(2, '0')}`;
            const parentSourceId = sourceIdForShard(candidate.originalSource, shardNumber);
            const parts = shardSegments.map((segment, index) => ({
                partNumber: index + 1,
                path: partPathFor(parentPath, index + 1),
                legacyPath: segment.path,
                contentHash: `sha256:${(0, knowledge_note_1.hashVaultContent)(segment.content)}`,
                byteLength: segment.byteLength,
                content: segment.content,
            }));
            const shard = {
                shardNumber,
                parentPath,
                parentSource,
                parentSourceId,
                segments: shardSegments.map((segment) => segment.path),
                parts,
                parentContentHash: `sha256:${(0, knowledge_note_1.hashVaultContent)(canonicalParentContent(shardSegments))}`,
            };
            if (occupied.has(parentPath) || occupied.has((0, knowledge_architecture_1.normalizeKnowledgePath)(parentPath))) {
                issues.push(issue('target_path_occupied', familyKey, [parentPath], `Consolidation target already exists: ${parentPath}.`));
            }
            if (parts.some((part) => occupied.has(part.path))) {
                issues.push(issue('target_path_occupied', familyKey, parts.filter((part) => occupied.has(part.path)).map((part) => part.path), 'One or more Source part targets already exist.'));
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
    const newPartCount = families.reduce((total, family) => total + family.shards.reduce((shardTotal, shard) => shardTotal + shard.parts.length, 0), 0);
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
        planHash: `sha256:${(0, knowledge_note_1.hashVaultContent)(planFingerprint)}`,
    };
}
