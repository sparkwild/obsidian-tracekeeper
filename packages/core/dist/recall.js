"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOrdinaryRecallPathEligible = isOrdinaryRecallPathEligible;
exports.scoreNote = scoreNote;
exports.recallNotes = recallNotes;
const knowledge_architecture_1 = require("./knowledge-architecture");
const MIN_TOKEN_LENGTH = 2;
const DEFAULT_LIMIT = 6;
const RECENT_NOTE_WINDOW_DAYS = 14;
const MAX_QUERY_TOKENS = 64;
const MAX_NOTE_TOKENS = 4096;
const EXCLUDED_RECALL_PREFIXES = [knowledge_architecture_1.TRACEKEEPER_CONTROL_DIR, knowledge_architecture_1.TRACEKEEPER_INBOX_DIR];
function isOrdinaryRecallPathEligible(relativePath) {
    const normalizedPath = relativePath.replace(/\\/g, '/').toLowerCase();
    return !EXCLUDED_RECALL_PREFIXES.some((prefix) => {
        const normalizedPrefix = prefix.toLowerCase();
        return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
    });
}
function lexicalSegments(input) {
    const text = input.toLowerCase().normalize('NFKC');
    return text.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? [];
}
function tokenize(input, maxTokens = MAX_NOTE_TOKENS) {
    const tokens = [];
    const seen = new Set();
    const addToken = (token) => {
        if (token.length < MIN_TOKEN_LENGTH || seen.has(token) || tokens.length >= maxTokens) {
            return;
        }
        seen.add(token);
        tokens.push(token);
    };
    for (const token of lexicalSegments(input)) {
        if (/[\u4e00-\u9fff]/.test(token)) {
            addToken(token);
            for (const size of [2, 3]) {
                for (let index = 0; index <= token.length - size; index += 1) {
                    addToken(token.slice(index, index + size));
                    if (tokens.length >= maxTokens) {
                        return tokens;
                    }
                }
            }
            continue;
        }
        addToken(token);
        if (tokens.length >= maxTokens) {
            return tokens;
        }
    }
    return tokens;
}
function strongQueryTokens(input) {
    return new Set(lexicalSegments(input).filter((token) => token.length >= MIN_TOKEN_LENGTH));
}
function frontmatterString(note, key) {
    const value = note.frontmatter[key];
    return typeof value === 'string' ? value : '';
}
function frontmatterTokens(note) {
    const values = [];
    for (const key of ['project_hint', 'related_project', 'project_id', 'repo', 'repo_path', 'source', 'target_note']) {
        const value = note.frontmatter[key];
        if (typeof value === 'string') {
            values.push(value);
        }
    }
    return values.flatMap((value) => tokenize(value));
}
function weightedTokensFromNote(note) {
    const tokens = new Set([
        ...tokenize(note.title),
        ...tokenize(frontmatterString(note, 'title')),
        ...tokenize(note.relativePath),
        ...tokenize(frontmatterString(note, 'type')),
        ...frontmatterTokens(note),
        ...note.tags.flatMap((tag) => tokenize(tag)),
        ...note.aliases.flatMap((alias) => tokenize(alias)),
        ...note.headings.flatMap((heading) => tokenize(heading)),
        ...tokenize(note.tokens),
    ]);
    const weighted = {};
    for (const token of tokens) {
        let weight = 1;
        if (tokenize(note.title).includes(token)) {
            weight += 3;
        }
        if (tokenize(note.relativePath).includes(token) && note.relativePath.startsWith(`${knowledge_architecture_1.KNOWLEDGE_ARCHITECTURE_DIR}/`)) {
            weight += 4;
        }
        if (note.relativePath.startsWith(`${knowledge_architecture_1.TRACEKEEPER_ARCHITECTURE_DIR}/`) && !note.relativePath.startsWith(`${knowledge_architecture_1.KNOWLEDGE_ARCHITECTURE_DIR}/`)) {
            weight += 1;
        }
        if (note.relativePath.startsWith(`${knowledge_architecture_1.ARCHIVE_ARCHITECTURE_DIR}/`)) {
            weight += 1;
        }
        if (note.tags.some((tag) => tokenize(tag).includes(token))) {
            weight += 2;
        }
        if (note.aliases.some((alias) => tokenize(alias).includes(token))) {
            weight += 2;
        }
        if (frontmatterTokens(note).includes(token)) {
            weight += 3;
        }
        if (tokenize(note.relativePath).includes(token)) {
            weight += 2;
        }
        if (tokenize(frontmatterString(note, 'type')).includes(token)) {
            weight += 1;
        }
        weighted[token] = weight;
    }
    return weighted;
}
function noteTypeBonus(note) {
    if (note.relativePath.startsWith(`${knowledge_architecture_1.TRACEKEEPER_TASKS_DIR}/`) || note.relativePath.startsWith('02_timeline/agent_tasks/')) {
        return 2;
    }
    if (note.relativePath.startsWith(`${knowledge_architecture_1.TRACEKEEPER_SESSIONS_DIR}/`) || note.relativePath.startsWith('02_timeline/sessions/')) {
        return 2;
    }
    if (note.relativePath.startsWith(`${knowledge_architecture_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
        return 4;
    }
    if (note.relativePath.startsWith('05_projects/') || note.relativePath.startsWith('04_projects/')) {
        return 2;
    }
    if (note.relativePath.startsWith(`${knowledge_architecture_1.KNOWLEDGE_ARCHITECTURE_DIR}/`)) {
        return 3;
    }
    if (note.relativePath.startsWith('04_memory/') || note.relativePath.startsWith('03_sources/')) {
        return 1;
    }
    return 0;
}
function recencyBonus(note) {
    const modified = Date.parse(note.modifiedAt);
    if (!Number.isFinite(modified)) {
        return 0;
    }
    const ageDays = (Date.now() - modified) / (24 * 60 * 60 * 1000);
    if (ageDays < 0 || ageDays > RECENT_NOTE_WINDOW_DAYS) {
        return 0;
    }
    return 1;
}
function scoreNote(note, queryTokens) {
    if (queryTokens.length === 0) {
        return 0;
    }
    const weights = weightedTokensFromNote(note);
    let score = 0;
    for (const token of queryTokens) {
        if (weights[token]) {
            score += weights[token];
        }
    }
    if (score <= 0) {
        return 0;
    }
    return score + noteTypeBonus(note) + recencyBonus(note);
}
function recallNotes(notes, query, options = {}) {
    const tokens = tokenize(query, MAX_QUERY_TOKENS);
    const strongTokens = strongQueryTokens(query);
    const limit = options.limit ?? DEFAULT_LIMIT;
    const matches = [];
    for (const note of notes) {
        if (!isOrdinaryRecallPathEligible(note.relativePath)) {
            continue;
        }
        const score = scoreNote(note, tokens);
        if (score <= 0) {
            continue;
        }
        const matchedTokens = tokens.filter((token) => weightForNoteToken(note, token) > 0);
        const hasStrongMatch = matchedTokens.some((token) => strongTokens.has(token));
        if (!hasStrongMatch && matchedTokens.length < 2) {
            continue;
        }
        matches.push({
            note,
            score,
            matchedTokens,
        });
    }
    return matches.sort((a, b) => b.score - a.score || a.note.relativePath.localeCompare(b.note.relativePath)).slice(0, limit);
}
function weightForNoteToken(note, token) {
    if (tokenize(note.title).includes(token)) {
        return 4;
    }
    if (tokenize(frontmatterString(note, 'type')).includes(token)) {
        return 3;
    }
    if (note.tags.some((tag) => tokenize(tag).includes(token))) {
        return 2;
    }
    if (note.aliases.some((alias) => tokenize(alias).includes(token))) {
        return 2;
    }
    if (frontmatterTokens(note).includes(token)) {
        return 3;
    }
    if (tokenize(note.relativePath).includes(token)) {
        return 2;
    }
    if (note.headings.some((heading) => tokenize(heading).includes(token))) {
        return 1;
    }
    if (tokenize(note.tokens).includes(token)) {
        return 1;
    }
    return 0;
}
