"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecallApplicationService = void 0;
const core_1 = require("@tracekeeper/core");
const project_identity_1 = require("./project-identity");
const PROJECT_MEMORY_READ_DIRS = [core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR, '05_projects', '04_projects'];
const MAX_PROJECT_SCOPE_CANDIDATES = 8;
const MAX_RECALL_EXCERPT_LENGTH = 480;
const MAX_RECALL_GRAPH_LINKS = 8;
const MAX_RECALL_CANDIDATES = 50;
const PROJECT_MEMORY_RECALL_BOOST = 4;
const KNOWLEDGE_WIKI_RECALL_BOOST = 0.75;
const WORK_RECORD_RECALL_PENALTY = 5;
const PROJECT_MEMORY_RECALL_REASON = 'Project-memory location boost (+4)';
const KNOWLEDGE_WIKI_RECALL_REASON = 'Wiki location boost (+0.75)';
function toText(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value
            .map((entry) => toText(entry))
            .filter((entry) => entry.length > 0)
            .join('\n');
    }
    return '';
}
function readFrontmatterString(frontmatter, keys) {
    for (const key of keys) {
        const value = frontmatter[key];
        if (value === undefined) {
            continue;
        }
        const text = toText(value);
        if (text) {
            return text;
        }
    }
    return '';
}
function normalizeRepoPrefix(value) {
    return value
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/\\/g, '/');
}
function valueContainsAnyToken(value, tokens) {
    const normalized = value.toLowerCase();
    return tokens.some((token) => token.length > 0 && normalized.includes(token));
}
function projectTokens(value) {
    const normalized = value.toLowerCase().trim();
    if (!normalized) {
        return [];
    }
    const variants = new Set([
        normalized,
        normalized.replace(/\s+/g, '-'),
        normalized.replace(/\s+/g, '_'),
        normalized.replace(/[-_]+/g, ' '),
    ]);
    return Array.from(variants).filter(Boolean);
}
function hasProjectScope(scope) {
    return Boolean(scope.projectHint || scope.projectId || scope.repoPath);
}
function scanProvenance(scan) {
    const indexState = scan.index?.index_state ?? 'filesystem_scan';
    return {
        index_state: indexState,
        snapshot_generation: scan.index?.generation ?? null,
        snapshot_warning: indexState === 'rebuilding'
            ? 'Knowledge index is rebuilding; this result may come from the previous snapshot generation.'
            : null,
    };
}
function projectMemoryCandidatePath(notePath) {
    for (const dir of PROJECT_MEMORY_READ_DIRS) {
        const prefix = `${dir}/`;
        if (!notePath.startsWith(prefix)) {
            continue;
        }
        const [projectSegment] = notePath.slice(prefix.length).split('/').filter(Boolean);
        return projectSegment ? `${dir}/${projectSegment}` : dir;
    }
    return '';
}
function collectProjectCandidates(notes, scope, maxItems) {
    const candidates = [];
    const seen = new Set();
    for (const note of notes) {
        const candidate = projectMemoryCandidatePath(note.relativePath);
        if (candidate && !seen.has(note.relativePath)) {
            seen.add(note.relativePath);
            candidates.push({
                path: note.relativePath,
                title: note.title,
                type: note.type ?? null,
            });
        }
        const notePath = note.relativePath.toLowerCase();
        const hintTokens = projectTokens(scope.projectHint);
        if (scope.projectId &&
            (notePath.includes(scope.projectId.toLowerCase()) || valueContainsAnyToken(notePath, hintTokens)) &&
            !seen.has(note.relativePath)) {
            seen.add(note.relativePath);
            candidates.push({
                path: note.relativePath,
                title: note.title,
                type: note.type ?? null,
            });
        }
        if (candidates.length >= maxItems) {
            break;
        }
    }
    return candidates.slice(0, maxItems);
}
function buildProjectRecallRelationEvidence(scope, fallbackToGlobal) {
    const evidence = [];
    if (scope.projectHint) {
        evidence.push({
            type: 'project_hint',
            value: scope.projectHint,
            confidence: scope.confidence,
        });
    }
    if (scope.projectId) {
        evidence.push({
            type: 'project_id',
            value: scope.projectId,
            confidence: scope.confidence,
        });
    }
    if (scope.repoPath) {
        evidence.push({
            type: 'repo_path',
            value: scope.repoPath,
            confidence: scope.confidence,
        });
    }
    if (fallbackToGlobal) {
        evidence.push({
            type: 'fallback',
            value: 'project_scope_uncertain_no_matches',
            target_scope: 'global',
        });
    }
    if (evidence.length === 0) {
        evidence.push({
            type: 'fallback',
            value: 'global_default',
            target_scope: 'global',
        });
    }
    return evidence;
}
function matchesProjectQuery(note, query) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return true;
    }
    const haystack = [
        note.relativePath,
        note.title,
        note.type,
        note.tokens,
        JSON.stringify(note.frontmatter),
    ].join(' ').toLowerCase();
    if (haystack.includes(normalizedQuery)) {
        return true;
    }
    const queryTokens = Array.from(new Set(normalizedQuery.split(/[^a-z0-9\u4e00-\u9fff]+/u).filter((token) => token.length > 1)));
    if (queryTokens.length === 0) {
        return false;
    }
    const matchedCount = queryTokens.filter((token) => haystack.includes(token)).length;
    const requiredMatches = queryTokens.length <= 2
        ? queryTokens.length
        : Math.max(2, Math.ceil(queryTokens.length * 0.6));
    return matchedCount >= requiredMatches;
}
function collectRecallScopeTokens(scope) {
    const tokens = new Set();
    if (scope.projectHint) {
        for (const token of projectTokens(scope.projectHint)) {
            tokens.add(token);
        }
    }
    if (scope.projectId) {
        tokens.add(scope.projectId.toLowerCase());
    }
    if (scope.repoPath) {
        const normalized = normalizeRepoPrefix(scope.repoPath).toLowerCase();
        if (normalized) {
            tokens.add(normalized);
            tokens.add(normalized.split('/').filter(Boolean).pop() || normalized);
        }
    }
    return Array.from(tokens).filter(Boolean);
}
function recallRecencyBoost(modifiedAt, nowMs) {
    const modified = Date.parse(modifiedAt);
    if (!Number.isFinite(modified)) {
        return 0;
    }
    const ageHours = (nowMs - modified) / (60 * 60 * 1000);
    if (ageHours < 24) {
        return 1;
    }
    if (ageHours < 72) {
        return 0.6;
    }
    if (ageHours < 168) {
        return 0.25;
    }
    return 0;
}
function recallCandidateLimit(maxItems) {
    return Math.min(Math.max(maxItems * 4, 24), MAX_RECALL_CANDIDATES);
}
function isGeneratedWorkRecord(note) {
    const notePath = note.relativePath.replace(/\\/g, '/');
    return notePath.startsWith(`${core_1.TRACEKEEPER_TASKS_DIR}/`) ||
        notePath.startsWith(`${core_1.TRACEKEEPER_SESSIONS_DIR}/`) ||
        notePath.startsWith('02_timeline/agent_tasks/') ||
        notePath.startsWith('02_timeline/sessions/');
}
function buildProjectMemoryAnchors(notes, existingPaths, maxItems = 2) {
    return notes
        .filter((note) => note.relativePath.startsWith(`${core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`) &&
        !existingPaths.has(note.relativePath))
        .sort((a, b) => {
        const aCanonical = a.relativePath.toLowerCase().endsWith('/memory.md') ? 1 : 0;
        const bCanonical = b.relativePath.toLowerCase().endsWith('/memory.md') ? 1 : 0;
        return bCanonical - aCanonical ||
            Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt) ||
            a.relativePath.localeCompare(b.relativePath);
    })
        .slice(0, maxItems)
        .map((note) => ({ note, score: 0, matchedTokens: [] }));
}
function selectRecallMatches(matches, maxItems) {
    const hasDurableKnowledge = matches.some((match) => !isGeneratedWorkRecord(match.note) && match.raw_score > 0);
    if (!hasDurableKnowledge) {
        return matches.slice(0, maxItems);
    }
    const selected = [];
    let workRecordCount = 0;
    for (const match of matches) {
        if (isGeneratedWorkRecord(match.note)) {
            if (workRecordCount >= 1) {
                continue;
            }
            workRecordCount += 1;
        }
        selected.push(match);
        if (selected.length >= maxItems) {
            break;
        }
    }
    if (maxItems > 1 &&
        workRecordCount === 0 &&
        selected.length === maxItems) {
        const bestWorkRecord = matches.find((match) => isGeneratedWorkRecord(match.note) && match.raw_score > 0);
        if (bestWorkRecord) {
            selected[selected.length - 1] = bestWorkRecord;
        }
    }
    return selected;
}
function rankRecallMatches(matches, query, scope, nowMs) {
    const fullQuery = query.trim().toLowerCase();
    const scopeTokens = collectRecallScopeTokens(scope);
    const ranked = matches.map((match) => {
        let score = match.score;
        const reasons = [];
        const noteTitle = match.note.title.toLowerCase();
        const notePath = match.note.relativePath.toLowerCase();
        const noteFrontmatter = [
            readFrontmatterString(match.note.frontmatter, ['project', 'project_hint', 'related_project']),
            readFrontmatterString(match.note.frontmatter, ['project_id', 'projectId', 'pid']),
            readFrontmatterString(match.note.frontmatter, ['repo_path', 'repoPath', 'project_path']),
            readFrontmatterString(match.note.frontmatter, ['related_project', 'relatedProject', 'workspace']),
        ].join(' ').toLowerCase();
        if (notePath.startsWith(`${core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
            score += PROJECT_MEMORY_RECALL_BOOST;
            reasons.push(PROJECT_MEMORY_RECALL_REASON);
        }
        else if ((0, core_1.isKnowledgeWikiPath)(notePath)) {
            score += KNOWLEDGE_WIKI_RECALL_BOOST;
            reasons.push(KNOWLEDGE_WIKI_RECALL_REASON);
        }
        else if (notePath.startsWith(`${core_1.TRACEKEEPER_TASKS_DIR}/`) ||
            notePath.startsWith(`${core_1.TRACEKEEPER_SESSIONS_DIR}/`)) {
            const echoPenalty = Math.max(WORK_RECORD_RECALL_PENALTY + Math.max(0, match.matchedTokens.length - 1), Math.max(0, match.score - 2));
            score = Math.max(0.01, score - echoPenalty);
            reasons.push(`Work-record query-echo penalty (-${echoPenalty})`);
        }
        if (match.matchedTokens.length >= 2) {
            score += 0.4;
            reasons.push('Multiple query token matches (+0.4)');
        }
        const recency = recallRecencyBoost(match.note.modifiedAt, nowMs);
        if (recency > 0) {
            score += recency;
            reasons.push(`Recent edit (+${recency})`);
        }
        if (fullQuery && (noteTitle.includes(fullQuery) || notePath.includes(fullQuery))) {
            score += 1;
            reasons.push('Exact query phrase match in title/path (+1)');
        }
        if (scopeTokens.some((token) => valueContainsAnyToken(noteTitle, [token]) ||
            valueContainsAnyToken(notePath, [token]) ||
            valueContainsAnyToken(noteFrontmatter, [token]))) {
            score += 0.4;
            reasons.push('Project scope match (+0.4)');
        }
        return {
            note: match.note,
            raw_score: match.score,
            score: Number(score.toFixed(2)),
            matchedTokens: match.matchedTokens,
            score_reason: reasons.length ? reasons : ['Core recall score'],
        };
    });
    return ranked.sort((a, b) => b.score - a.score || a.note.relativePath.localeCompare(b.note.relativePath));
}
function compactNoteText(text, maxLength = MAX_RECALL_EXCERPT_LENGTH) {
    const compact = text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (compact.length <= maxLength) {
        return compact;
    }
    return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}
function buildRecallGraphLinks(note) {
    const links = new Set();
    for (const link of note.wikilinks) {
        const target = link.heading ? `${link.target}#${link.heading}` : link.target;
        if (target.trim()) {
            links.add(target.trim());
        }
        if (links.size >= MAX_RECALL_GRAPH_LINKS) {
            break;
        }
    }
    return Array.from(links);
}
function buildRecallWhyMatched(match, scope) {
    const scopeLabel = scope === 'project_history'
        ? 'Project-history recall'
        : scope === 'project'
            ? 'Project recall'
            : 'Global recall';
    const tokenText = match.matchedTokens.slice(0, 6).join(', ');
    const reasonText = match.score_reason.slice(0, 2).join('; ');
    return [scopeLabel, tokenText ? `matched tokens: ${tokenText}` : '', reasonText].filter(Boolean).join(' - ');
}
function buildRecallEntry(match, scope, allNotes, dependencies) {
    return {
        path: match.note.relativePath,
        title: match.note.title,
        type: match.note.type,
        note_type: match.note.type ?? null,
        scope,
        score: match.score,
        raw_score: match.raw_score,
        matched_tokens: match.matchedTokens,
        score_reason: match.score_reason,
        why_matched: buildRecallWhyMatched(match, scope),
        excerpt: compactNoteText(match.note.content),
        content_origin: dependencies.contentOrigin(match.note.relativePath, match.note.type),
        instruction_trust: 'data_only',
        graph_links: buildRecallGraphLinks(match.note),
        relation_evidence: dependencies.buildRelationEvidence(match.note, allNotes),
    };
}
function buildProjectHistoryWhy(note, query) {
    const parts = ['Project-history recall'];
    const taskId = readFrontmatterString(note.frontmatter, ['task_id', 'taskId']);
    if (taskId) {
        parts.push(`linked task: ${taskId}`);
    }
    if (query) {
        parts.push(`matched query: ${query}`);
    }
    return parts.join(' - ');
}
function buildProjectHistoryEntries(matches, query, allNotes, dependencies) {
    return matches.map((note) => ({
        path: note.relativePath,
        title: note.title,
        type: note.type,
        note_type: note.type ?? null,
        scope: 'project_history',
        modifiedAt: note.modifiedAt,
        content_origin: dependencies.contentOrigin(note.relativePath, note.type),
        instruction_trust: 'data_only',
        task_id: readFrontmatterString(note.frontmatter, ['task_id', 'taskId']),
        project_hint: readFrontmatterString(note.frontmatter, ['project_hint', 'related_project', 'project']),
        why_matched: buildProjectHistoryWhy(note, query),
        excerpt: compactNoteText(note.content),
        graph_links: buildRecallGraphLinks(note),
        relation_evidence: dependencies.buildRelationEvidence(note, allNotes),
    }));
}
class RecallApplicationService {
    constructor(dependencies) {
        this.dependencies = dependencies;
    }
    execute(request) {
        const scan = this.dependencies.loadScan();
        if (request.scope === 'global') {
            return this.executeGlobal(request, scan);
        }
        if (request.scope === 'project') {
            return this.executeProject(request, scan);
        }
        return this.executeProjectHistory(request, scan);
    }
    executeGlobal(request, scan) {
        const rawMatches = (0, core_1.recallNotes)(scan.notes, request.query, {
            limit: recallCandidateLimit(request.maxItems),
        });
        const matches = selectRecallMatches(rankRecallMatches(rawMatches, request.query, {
            projectHint: '',
            projectId: '',
            repoPath: '',
            source: 'unknown',
            confidence: 'uncertain',
            warnings: [],
        }, this.dependencies.nowMs()), request.maxItems);
        return {
            ok: true,
            read_only: true,
            scope_mode: 'global',
            query: request.query,
            vault_root: request.vaultRoot,
            max_items: request.maxItems,
            matched_count: matches.length,
            ...scanProvenance(scan),
            matches: matches.map((match) => buildRecallEntry(match, 'global', scan.notes, this.dependencies)),
        };
    }
    executeProject(request, scan) {
        const scope = this.dependencies.resolveProjectIdentity(request.projectIdentityInput, scan.notes);
        const unresolved = scope.confidence === 'uncertain';
        const scopedNotes = unresolved
            ? scan.notes
            : this.dependencies.filterProjectNotes(scan.notes, scope);
        const candidateLimit = recallCandidateLimit(request.maxItems);
        const initialMatches = (0, core_1.recallNotes)(scopedNotes, request.query, { limit: candidateLimit });
        const anchoredMatches = unresolved
            ? initialMatches
            : [
                ...initialMatches,
                ...buildProjectMemoryAnchors(scopedNotes, new Set(initialMatches.map((match) => match.note.relativePath))),
            ];
        const fallbackToGlobal = unresolved && anchoredMatches.length === 0;
        const finalScope = fallbackToGlobal
            ? this.dependencies.resolveProjectIdentity({}, scan.notes)
            : scope;
        const finalScopeMode = fallbackToGlobal ? 'global' : 'project';
        const finalRawMatches = fallbackToGlobal
            ? (0, core_1.recallNotes)(scan.notes, request.query, { limit: candidateLimit })
            : anchoredMatches;
        const matches = selectRecallMatches(rankRecallMatches(finalRawMatches, request.query, finalScope, this.dependencies.nowMs()), request.maxItems);
        const uncertain = !hasProjectScope(scope) ||
            scope.confidence === 'uncertain' ||
            fallbackToGlobal;
        const candidateNotes = collectProjectCandidates(scopedNotes, scope, MAX_PROJECT_SCOPE_CANDIDATES);
        const scopeMetadata = fallbackToGlobal
            ? (0, project_identity_1.projectIdentityToResult)(this.dependencies.resolveProjectIdentity({}, scan.notes))
            : (0, project_identity_1.projectIdentityToResult)(scope);
        return {
            ok: true,
            read_only: true,
            vault_root: request.vaultRoot,
            query: request.query,
            uncertain,
            scope: scopeMetadata,
            project_identity: (0, project_identity_1.projectIdentityToResult)(scope),
            max_items: request.maxItems,
            matched_count: matches.length,
            ...scanProvenance(scan),
            candidates: candidateNotes.map((candidate) => candidate.path),
            candidate_notes: candidateNotes,
            scope_evidence: buildProjectRecallRelationEvidence(scope, fallbackToGlobal),
            scope_mode: finalScopeMode,
            entries: matches.map((match) => buildRecallEntry(match, finalScopeMode, scan.notes, this.dependencies)),
        };
    }
    executeProjectHistory(request, scan) {
        const scope = this.dependencies.resolveProjectIdentity(request.projectIdentityInput, scan.notes);
        const unresolved = scope.confidence === 'uncertain';
        const scopedNotes = unresolved
            ? scan.notes
            : this.dependencies.filterProjectNotes(scan.notes, scope);
        const uncertain = !hasProjectScope(scope) || scope.confidence === 'uncertain';
        const filteredByQuery = request.query
            ? scopedNotes.filter((note) => matchesProjectQuery(note, request.query))
            : scopedNotes;
        const sortedMatches = filteredByQuery
            .filter((note) => note.relativePath !== '')
            .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
        const candidateNotes = collectProjectCandidates(scopedNotes, scope, MAX_PROJECT_SCOPE_CANDIDATES);
        const matches = sortedMatches.slice(0, request.maxItems);
        return {
            ok: true,
            read_only: true,
            vault_root: request.vaultRoot,
            query: request.query || null,
            uncertain,
            scope: (0, project_identity_1.projectIdentityToResult)(scope),
            project_identity: (0, project_identity_1.projectIdentityToResult)(scope),
            max_items: request.maxItems,
            matched_count: matches.length,
            total_matches: sortedMatches.length,
            ...scanProvenance(scan),
            candidates: candidateNotes.map((candidate) => candidate.path),
            candidate_notes: candidateNotes,
            entries: buildProjectHistoryEntries(matches, request.query, scan.notes, this.dependencies),
        };
    }
}
exports.RecallApplicationService = RecallApplicationService;
