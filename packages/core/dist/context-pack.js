"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildContextPack = buildContextPack;
exports.buildContextPackFromScan = buildContextPackFromScan;
const node_path_1 = __importDefault(require("node:path"));
const scan_1 = require("./scan");
const recall_1 = require("./recall");
const knowledge_architecture_1 = require("./knowledge-architecture");
function isStringArrayValue(value) {
    return Array.isArray(value);
}
function normalizeStringList(value) {
    if (!isStringArrayValue(value)) {
        return [];
    }
    const normalized = [];
    for (const item of value) {
        if (typeof item === 'string') {
            normalized.push(item);
        }
    }
    return normalized;
}
function gatherSourceCandidates(notes) {
    const candidates = [];
    for (const note of notes) {
        const type = note.type ?? '';
        const frontmatterSourceKind = typeof note.frontmatter.source_kind === 'string' ? note.frontmatter.source_kind : '';
        if (type === 'source' ||
            type === 'source-note' ||
            type === 'agent-request' ||
            frontmatterSourceKind) {
            candidates.push({
                note,
                reason: frontmatterSourceKind
                    ? `type=${type || 'source'} source_kind=${frontmatterSourceKind}`
                    : `type=${type || 'source'}`,
            });
        }
    }
    return candidates;
}
function gatherEvidenceCandidates(notes) {
    const candidates = [];
    for (const note of notes) {
        for (const block of note.evidenceBlocks) {
            candidates.push({
                note,
                blockId: block.blockId,
                excerpt: block.content.slice(0, 150),
            });
        }
    }
    return candidates;
}
function calculateGapHints(note) {
    const hints = [];
    if (note.claimBlocks.some((block) => block.sourceRefs.length === 0)) {
        hints.push(`Claim without source refs in ${note.relativePath}`);
    }
    return hints;
}
function isStaleNote(note, staleAfterDays) {
    const modified = Date.parse(note.modifiedAt);
    if (Number.isNaN(modified)) {
        return false;
    }
    const cutoff = Date.now() - staleAfterDays * 24 * 60 * 60 * 1000;
    return modified < cutoff;
}
function buildContextPack(vaultRoot, query, options = {}) {
    const scan = (0, scan_1.scanVault)(vaultRoot, { vaultConfigDir: options.vaultConfigDir });
    return buildContextPackFromScan(scan, query, options);
}
function buildContextPackFromScan(scan, query, options = {}) {
    const recall = (0, recall_1.recallNotes)(scan.notes, query, { limit: options.limit });
    const topNotes = recall.map((item) => item.note);
    const staleAfterDays = options.staleAfterDays ?? 180;
    const sourceCandidates = gatherSourceCandidates(topNotes)
        .filter((candidate, index, list) => list.findIndex((item) => item.note.relativePath === candidate.note.relativePath) === index)
        .map((candidate) => ({
        note: candidate.note.relativePath,
        reason: candidate.reason,
    }));
    const evidenceCandidates = gatherEvidenceCandidates(topNotes).map((entry) => ({
        note: entry.note.relativePath,
        blockId: entry.blockId,
        excerpt: entry.excerpt,
    }));
    const gaps = topNotes.flatMap((note) => calculateGapHints(note));
    if (gaps.length === 0) {
        gaps.push('No explicit claim/evidence gaps detected in top matches.');
    }
    const staleWarnings = topNotes
        .filter((note) => isStaleNote(note, staleAfterDays))
        .map((note) => `${note.relativePath} has not changed in ${staleAfterDays}+ days.`);
    if (staleWarnings.length === 0) {
        staleWarnings.push('No stale notes found in top matches.');
    }
    const suggestedWritebackTargets = [
        knowledge_architecture_1.TRACEKEEPER_CONTEXT_PACKS_DIR,
        knowledge_architecture_1.TRACEKEEPER_REVIEW_QUEUE_DIR,
        knowledge_architecture_1.KNOWLEDGE_SOURCES_DIR,
        knowledge_architecture_1.TRACEKEEPER_SESSIONS_DIR,
    ].map((entry) => node_path_1.default.join(scan.vaultRoot, entry));
    return {
        query,
        generatedAt: new Date().toISOString(),
        relevantNotes: recall.map((match) => ({
            relativePath: match.note.relativePath,
            score: match.score,
            matchedTokens: normalizeStringList(match.matchedTokens),
            type: match.note.type,
            title: match.note.title,
        })),
        sourceCandidates,
        evidenceCandidates,
        gaps,
        staleWarnings,
        suggestedWritebackTargets,
        scanErrors: scan.errors,
    };
}
