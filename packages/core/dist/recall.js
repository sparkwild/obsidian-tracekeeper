"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreNote = scoreNote;
exports.recallNotes = recallNotes;
const knowledge_architecture_1 = require("./knowledge-architecture");
const MIN_TOKEN_LENGTH = 2;
const DEFAULT_LIMIT = 6;
const RECENT_NOTE_WINDOW_DAYS = 14;
function tokenize(input) {
    const text = input.toLowerCase().normalize('NFKC');
    return [...new Set((text.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? []))]
        .filter((token) => token.length >= MIN_TOKEN_LENGTH);
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
    const tokens = tokenize(query);
    const limit = options.limit ?? DEFAULT_LIMIT;
    const matches = [];
    for (const note of notes) {
        const score = scoreNote(note, tokens);
        if (score <= 0) {
            continue;
        }
        const matchedTokens = tokens.filter((token) => weightForNoteToken(note, token) > 0);
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
