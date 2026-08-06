"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOURCE_PART_MAX_COUNT = exports.SOURCE_PART_MAX_BYTES = exports.SOURCE_INLINE_CONTENT_LIMIT_BYTES = void 0;
exports.normalizeSourceKind = normalizeSourceKind;
exports.sourceRouteForKind = sourceRouteForKind;
exports.buildSourceCapturePlan = buildSourceCapturePlan;
const node_crypto_1 = __importDefault(require("node:crypto"));
const knowledge_architecture_1 = require("./knowledge-architecture");
exports.SOURCE_INLINE_CONTENT_LIMIT_BYTES = 128 * 1024;
exports.SOURCE_PART_MAX_BYTES = 64 * 1024;
exports.SOURCE_PART_MAX_COUNT = 16;
const SOURCE_KIND_ALIASES = {
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
function normalizeSourceKind(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    const sourceKind = SOURCE_KIND_ALIASES[normalized];
    if (!sourceKind) {
        throw new Error('source_kind must resolve to one of: web | file | transcript.');
    }
    return sourceKind;
}
function sourceRouteForKind(sourceKind) {
    switch (sourceKind) {
        case 'web': return knowledge_architecture_1.KNOWLEDGE_SOURCES_WEB_DIR;
        case 'file': return knowledge_architecture_1.KNOWLEDGE_SOURCES_FILES_DIR;
        case 'transcript': return knowledge_architecture_1.KNOWLEDGE_SOURCES_TRANSCRIPTS_DIR;
    }
}
function buildSourceCapturePlan(input) {
    const sourceKind = normalizeSourceKind(input.sourceKind);
    const route = sourceRouteForKind(sourceKind);
    const contentHash = sha256(input.content || input.source);
    const sourceId = `source-${sha256(`${sourceKind}\0${input.source}`).slice(0, 32)}`;
    const bytes = Buffer.byteLength(input.content, 'utf8');
    if (bytes <= exports.SOURCE_INLINE_CONTENT_LIMIT_BYTES) {
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
    const chunks = splitUtf8(input.content, exports.SOURCE_PART_MAX_BYTES);
    if (chunks.length > exports.SOURCE_PART_MAX_COUNT) {
        throw new Error(`source content exceeds the bounded ${exports.SOURCE_PART_MAX_COUNT}-part limit.`);
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
function splitUtf8(content, maxBytes) {
    const chunks = [];
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
    if (current)
        chunks.push(current);
    return chunks;
}
function sha256(value) {
    return node_crypto_1.default.createHash('sha256').update(value, 'utf8').digest('hex');
}
