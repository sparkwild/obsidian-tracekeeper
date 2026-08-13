"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecallApplicationService = exports.MAX_READ_VIEW_RERANKED_ROWS = exports.MAX_READ_VIEW_GRAPH_EXPANSIONS = exports.MAX_READ_VIEW_LEXICAL_CANDIDATES = void 0;
exports.buildKnowledgeRelationEvidenceFromReadView = buildKnowledgeRelationEvidenceFromReadView;
exports.buildKnowledgeGraphLinksFromReadView = buildKnowledgeGraphLinksFromReadView;
const core_1 = require("@tracekeeper/core");
const PROJECT_MEMORY_READ_DIRS = [core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR, '05_projects', '04_projects'];
const MAX_PROJECT_SCOPE_CANDIDATES = 8;
const MAX_RECALL_EXCERPT_LENGTH = 480;
const MAX_RECALL_GRAPH_LINKS = 8;
const MAX_RECALL_CANDIDATES = 50;
exports.MAX_READ_VIEW_LEXICAL_CANDIDATES = 256;
exports.MAX_READ_VIEW_GRAPH_EXPANSIONS = 64;
exports.MAX_READ_VIEW_RERANKED_ROWS = 32;
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
function projectIdentityResult(identity) {
    return {
        project_hint: identity.projectHint || null,
        project_id: identity.projectId || null,
        repo_path: identity.repoPath || null,
        source: identity.source,
        confidence: identity.confidence,
        warnings: identity.warnings,
    };
}
function scanProvenance(scan) {
    const indexState = scan.index?.index_state ?? 'filesystem_scan';
    return {
        index_state: indexState,
        snapshot_generation: scan.index?.generation ?? null,
        snapshot_warning: indexState === 'rebuilding'
            ? 'Knowledge index is rebuilding; this result may come from the previous snapshot generation.'
            : indexState === 'initializing'
                ? 'Knowledge index metadata is still initializing; this result may be incomplete.'
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
function buildProjectRecallRelationEvidence(scope) {
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
    if (scope.confidence === 'uncertain') {
        evidence.push({
            type: 'scope_status',
            value: 'project_scope_uncertain',
            target_scope: 'project',
        });
    }
    if (evidence.length === 0) {
        evidence.push({
            type: 'scope_status',
            value: 'project_scope_unresolved',
            target_scope: 'project',
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
function buildRecallGraphLinks(note, relationEvidence) {
    if ((0, core_1.isKnowledgeSourcePath)(note.relativePath) || (note.type ?? '').toLocaleLowerCase('en-US').includes('source')) {
        return [...new Set([
                ...relationEvidence.related_wiki.map((relation) => relation.path),
                ...relationEvidence.related_sources.map((relation) => relation.path),
            ])].sort((left, right) => left.localeCompare(right)).slice(0, MAX_RECALL_GRAPH_LINKS);
    }
    const links = new Set();
    for (const link of note.edges) {
        if (link.resolution.status !== 'resolved') {
            continue;
        }
        const target = link.subpath
            ? `${link.resolution.path}#${link.subpath}`
            : link.resolution.path;
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
    const relationEvidence = dependencies.buildRelationEvidence(match.note, allNotes);
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
        graph_links: buildRecallGraphLinks(match.note, relationEvidence),
        relation_evidence: relationEvidence,
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
    return matches.map((note) => {
        const relationEvidence = dependencies.buildRelationEvidence(note, allNotes);
        return {
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
            graph_links: buildRecallGraphLinks(note, relationEvidence),
            relation_evidence: relationEvidence,
        };
    });
}
function taskProjectMatches(note, identity) {
    const haystack = [
        readFrontmatterString(note.frontmatter, ['project_hint', 'related_project', 'project']),
        readFrontmatterString(note.frontmatter, ['project_id']),
        readFrontmatterString(note.frontmatter, ['repo_path', 'repo', 'project_path']),
        note.relativePath,
    ].join(' ').toLowerCase();
    const tokens = collectRecallScopeTokens(identity);
    return tokens.length > 0 && tokens.some((token) => haystack.includes(token));
}
function collectTaskHistoryGroups(notes, request, dependencies) {
    const taskNotes = notes.filter((note) => note.relativePath.startsWith(`${core_1.TRACEKEEPER_TASKS_DIR}/`));
    const sessionNotes = notes.filter((note) => note.relativePath.startsWith(`${core_1.TRACEKEEPER_SESSIONS_DIR}/`));
    const identityInput = request.projectIdentityInput;
    const hasProjectFilter = [
        identityInput.project_hint,
        identityInput.project_id,
        identityInput.repo_path,
        identityInput.repo,
        identityInput.project_path,
    ].some((value) => typeof value === 'string' && value.trim());
    const identity = hasProjectFilter
        ? dependencies.resolveProjectIdentity(identityInput, notes)
        : null;
    const filteredTasks = taskNotes.filter((note) => {
        const taskId = readFrontmatterString(note.frontmatter, ['task_id', 'taskId']);
        if (request.taskId && taskId !== request.taskId)
            return false;
        if (identity && !taskProjectMatches(note, identity))
            return false;
        if (request.query && !matchesProjectQuery(note, request.query))
            return false;
        return Boolean(taskId);
    });
    const groups = [];
    for (const task of filteredTasks) {
        const taskId = readFrontmatterString(task.frontmatter, ['task_id', 'taskId']);
        const sessions = sessionNotes
            .filter((note) => readFrontmatterString(note.frontmatter, ['task_id', 'taskId']) === taskId)
            .filter((note) => !request.query || matchesProjectQuery(note, request.query))
            .sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt));
        groups.push({ task, session: sessions[0] ?? null });
    }
    return groups.sort((left, right) => {
        const leftTime = Date.parse(left.session?.modifiedAt || left.task.modifiedAt);
        const rightTime = Date.parse(right.session?.modifiedAt || right.task.modifiedAt);
        return rightTime - leftTime || left.task.relativePath.localeCompare(right.task.relativePath);
    });
}
function buildTaskHistoryEntries(groups, query, allNotes, dependencies) {
    return groups.map(({ task, session }) => {
        const taskId = readFrontmatterString(task.frontmatter, ['task_id', 'taskId']);
        const source = session ?? task;
        const summary = readFrontmatterString(session?.frontmatter ?? task.frontmatter, ['summary']);
        const objective = readFrontmatterString(task.frontmatter, ['goal', 'objective', 'title']) || task.title;
        const status = readFrontmatterString(task.frontmatter, ['status']) || null;
        const relationEvidence = dependencies.buildRelationEvidence(source, allNotes);
        return {
            path: task.relativePath,
            task_path: task.relativePath,
            session_path: session?.relativePath ?? null,
            title: task.title,
            note_type: task.type ?? null,
            scope: 'task_history',
            modifiedAt: source.modifiedAt,
            task_id: taskId,
            status,
            objective,
            summary,
            project_hint: readFrontmatterString(task.frontmatter, ['project_hint', 'related_project', 'project']) || null,
            project_id: readFrontmatterString(task.frontmatter, ['project_id']) || null,
            repo_path: readFrontmatterString(task.frontmatter, ['repo_path', 'repo', 'project_path']) || null,
            why_matched: ['Task-history recall', taskId, query ? `matched query: ${query}` : 'recent task'].filter(Boolean).join(' - '),
            excerpt: compactNoteText([task.content, session?.content, summary].filter(Boolean).join(' ')),
            content_origin: dependencies.contentOrigin(source.relativePath, source.type),
            instruction_trust: 'data_only',
            graph_links: buildRecallGraphLinks(source, relationEvidence),
            relation_evidence: relationEvidence,
        };
    });
}
function readViewProvenance(view) {
    return {
        index_state: view.source === 'filesystem_scan' ? 'filesystem_scan' : view.index_state,
        snapshot_generation: view.source === 'filesystem_scan' ? null : view.generation,
        snapshot_warning: view.index_state === 'rebuilding'
            ? 'Knowledge index is rebuilding; this result may come from the previous snapshot generation.'
            : view.index_state === 'initializing'
                ? 'Knowledge index metadata is still initializing; this result may be incomplete.'
                : null,
    };
}
function tokenizeReadViewQuery(input) {
    const terms = new Set();
    const add = (value) => {
        const normalized = value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
        if (normalized.length >= 2 && terms.size < 64)
            terms.add(normalized);
    };
    for (const segment of input.normalize('NFKC').toLocaleLowerCase('en-US').match(/[a-z0-9_-]+|\p{Script=Han}+/gu) ?? []) {
        add(segment);
        if (!/\p{Script=Han}/u.test(segment))
            continue;
        const characters = [...segment];
        for (const width of [2, 3]) {
            for (let offset = 0; offset + width <= characters.length; offset += 1) {
                add(characters.slice(offset, offset + width).join(''));
                if (terms.size >= 64)
                    return [...terms];
            }
        }
    }
    return [...terms];
}
function catalogMetadataProjection(entry) {
    return {
        schemaVersion: '1.0',
        path: entry.path,
        exists: true,
        contentHash: entry.contentHash,
        title: entry.title,
        aliases: entry.aliases,
        type: entry.type ?? undefined,
        frontmatter: entry.frontmatter,
        semanticErrors: [],
        tags: entry.tags,
        headings: [],
        blockIds: [],
        sections: [],
        callouts: [],
        edges: [],
        text: entry.excerpt,
        content: '',
        modifiedAt: entry.modifiedAt,
        size: entry.size,
        absolutePath: '',
        relativePath: entry.path,
        tokens: entry.searchTokens.join(' '),
        wikilinks: [],
        claimBlocks: [],
        evidenceBlocks: [],
    };
}
function isCurrentReadViewEntry(entry, view) {
    const normalizedPath = entry.path.replace(/\\/g, '/');
    if (!(0, core_1.isOrdinaryRecallPathEligible)(normalizedPath))
        return false;
    if (normalizedPath === core_1.ARCHIVE_ROOT || normalizedPath.startsWith(`${core_1.ARCHIVE_ROOT}/`))
        return false;
    if (entry.type !== 'memory_record')
        return true;
    return view.memory.lifecycle.current.some((row) => row.record.path === entry.path);
}
function normalizeCatalogRelationReference(value) {
    return value.trim()
        .replace(/^\[\[/, '')
        .replace(/\]\]$/, '')
        .split('|', 1)[0]
        .replace(/#.*$/, '')
        .replace(/^\.\//, '')
        .replace(/\\/g, '/')
        .toLocaleLowerCase('en-US');
}
function resolveCatalogRelationReference(value, view) {
    const normalized = normalizeCatalogRelationReference(value);
    if (!normalized)
        return null;
    for (const candidate of view.catalog.values()) {
        const candidatePath = candidate.path.toLocaleLowerCase('en-US');
        if (candidatePath === normalized || candidatePath.replace(/\.md$/i, '') === normalized.replace(/\.md$/i, '')) {
            return candidate.path;
        }
        if (candidate.title.toLocaleLowerCase('en-US') === normalized)
            return candidate.path;
        if (candidate.aliases.some((alias) => alias.toLocaleLowerCase('en-US') === normalized))
            return candidate.path;
    }
    return null;
}
function explicitRelationReferences(entry) {
    const references = [];
    for (const key of [
        'related_wiki', 'relatedWiki', 'wiki',
        'related_sources', 'relatedSources', 'sources',
    ]) {
        const value = entry.frontmatter[key];
        const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
        references.push(...values
            .filter((item) => typeof item === 'string')
            .flatMap((item) => item.split(/[\n,]/g))
            .map((item) => item.trim())
            .filter(Boolean));
    }
    return references;
}
function explicitSourceRelationTargets(entry, view) {
    if (!(0, core_1.isKnowledgeSourcePath)(entry.path) && !(entry.type ?? '').toLocaleLowerCase('en-US').includes('source')) {
        return new Set();
    }
    return new Set(explicitRelationReferences(entry)
        .map((reference) => resolveCatalogRelationReference(reference, view))
        .filter((path) => Boolean(path)));
}
function buildKnowledgeRelationEvidenceFromReadView(entry, view) {
    const rows = new Map();
    const addRelation = (targetPath, declaredVia) => {
        if (!view.catalog.has(targetPath))
            return;
        const relationKind = (0, core_1.isKnowledgeWikiPath)(targetPath)
            ? 'related_wiki'
            : (0, core_1.isKnowledgeSourcePath)(targetPath)
                ? 'related_sources'
                : null;
        if (!relationKind)
            return;
        const key = `${relationKind}:${targetPath.toLocaleLowerCase('en-US')}`;
        const existing = rows.get(key);
        if (existing) {
            if (!existing.declared_via.includes(declaredVia))
                existing.declared_via.push(declaredVia);
            return;
        }
        rows.set(key, {
            path: targetPath,
            declared_by: entry.path,
            declared_via: [declaredVia],
            verified_by: 'active_vault_snapshot',
        });
    };
    for (const reference of explicitRelationReferences(entry)) {
        const normalizedReference = normalizeCatalogRelationReference(reference);
        const declaredEdge = [...view.graph.edges, ...view.graph.unresolvedEdges].find((edge) => edge.source === 'frontmatter'
            && (!edge.sourcePath || edge.sourcePath === entry.path)
            && normalizeCatalogRelationReference(edge.linkPath || edge.target || edge.raw) === normalizedReference);
        if (declaredEdge) {
            if (declaredEdge.resolution.status === 'resolved') {
                addRelation(declaredEdge.resolution.path, 'frontmatter');
            }
            continue;
        }
        const targetPath = resolveCatalogRelationReference(reference, view);
        if (targetPath)
            addRelation(targetPath, 'frontmatter');
    }
    const sourceRelationTargets = explicitSourceRelationTargets(entry, view);
    for (const edge of view.graph.edges) {
        if (edge.resolution.status !== 'resolved')
            continue;
        if (edge.sourcePath !== entry.path || edge.source !== 'body')
            continue;
        const targetPath = edge.resolution.path;
        if ((0, core_1.isKnowledgeSourcePath)(entry.path) || (entry.type ?? '').toLocaleLowerCase('en-US').includes('source')) {
            if (!sourceRelationTargets.has(targetPath))
                continue;
        }
        addRelation(targetPath, 'body_wikilink');
    }
    const ordered = [...rows.entries()].sort(([left], [right]) => left.localeCompare(right));
    return {
        related_wiki: ordered.filter(([key]) => key.startsWith('related_wiki:')).slice(0, MAX_RECALL_GRAPH_LINKS).map(([, row]) => row),
        related_sources: ordered.filter(([key]) => key.startsWith('related_sources:')).slice(0, MAX_RECALL_GRAPH_LINKS).map(([, row]) => row),
    };
}
function buildKnowledgeGraphLinksFromReadView(entry, view) {
    if ((0, core_1.isKnowledgeSourcePath)(entry.path) || (entry.type ?? '').toLocaleLowerCase('en-US').includes('source')) {
        const evidence = buildKnowledgeRelationEvidenceFromReadView(entry, view);
        return [...new Set([
                ...evidence.related_wiki.map((relation) => relation.path),
                ...evidence.related_sources.map((relation) => relation.path),
            ])].sort((left, right) => left.localeCompare(right)).slice(0, MAX_RECALL_GRAPH_LINKS);
    }
    const outgoing = new Set(view.graph.outgoing.get(entry.path) ?? []);
    const links = new Set();
    const edgeTargets = new Set();
    for (const edge of view.graph.edges) {
        if (edge.resolution.status !== 'resolved')
            continue;
        if (edge.sourcePath !== entry.path && (edge.sourcePath || !outgoing.has(edge.resolution.path)))
            continue;
        edgeTargets.add(edge.resolution.path);
        links.add(edge.subpath ? `${edge.resolution.path}#${edge.subpath}` : edge.resolution.path);
    }
    for (const targetPath of outgoing) {
        if (!edgeTargets.has(targetPath))
            links.add(targetPath);
    }
    return [...links].sort((left, right) => left.localeCompare(right)).slice(0, MAX_RECALL_GRAPH_LINKS);
}
function knowledgeGraphNeighbors(entryPath, view) {
    const entry = view.catalog.get(entryPath);
    const outgoing = new Set(view.graph.outgoing.get(entryPath) ?? []);
    if (entry && ((0, core_1.isKnowledgeSourcePath)(entry.path) || (entry.type ?? '').toLocaleLowerCase('en-US').includes('source'))) {
        const allowed = explicitSourceRelationTargets(entry, view);
        for (const target of outgoing) {
            if (!allowed.has(target))
                outgoing.delete(target);
        }
    }
    const incoming = new Set(view.graph.incoming.get(entryPath) ?? []);
    for (const sourcePath of incoming) {
        const source = view.catalog.get(sourcePath);
        if (!source || (!(0, core_1.isKnowledgeSourcePath)(source.path) && !(source.type ?? '').toLocaleLowerCase('en-US').includes('source'))) {
            continue;
        }
        if (!explicitSourceRelationTargets(source, view).has(entryPath))
            incoming.delete(sourcePath);
    }
    return new Set([...outgoing, ...incoming]);
}
function rankCatalogMatches(rows, query, scope, nowMs) {
    const fullQuery = query.trim().toLocaleLowerCase('en-US');
    const scopeTokens = collectRecallScopeTokens(scope);
    return rows.map((row) => {
        let score = row.rawScore;
        const reasons = [];
        const notePath = row.entry.path.toLocaleLowerCase('en-US');
        const noteTitle = row.entry.title.toLocaleLowerCase('en-US');
        const frontmatter = JSON.stringify(row.entry.frontmatter).toLocaleLowerCase('en-US');
        if (notePath.startsWith(`${core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
            score += PROJECT_MEMORY_RECALL_BOOST;
            reasons.push(PROJECT_MEMORY_RECALL_REASON);
        }
        else if ((0, core_1.isKnowledgeWikiPath)(notePath)) {
            score += KNOWLEDGE_WIKI_RECALL_BOOST;
            reasons.push(KNOWLEDGE_WIKI_RECALL_REASON);
        }
        else if (isGeneratedWorkRecord(catalogMetadataProjection(row.entry))) {
            const penalty = Math.max(WORK_RECORD_RECALL_PENALTY + Math.max(0, row.matchedTokens.length - 1), Math.max(0, row.rawScore - 2));
            score = Math.max(0.01, score - penalty);
            reasons.push(`Work-record query-echo penalty (-${Number(penalty.toFixed(2))})`);
        }
        if (row.matchedTokens.length >= 2) {
            score += 0.4;
            reasons.push('Multiple query token matches (+0.4)');
        }
        const recency = recallRecencyBoost(row.entry.modifiedAt, nowMs);
        if (recency > 0) {
            score += recency;
            reasons.push(`Recent edit (+${recency})`);
        }
        if (fullQuery && (notePath.includes(fullQuery) || noteTitle.includes(fullQuery))) {
            score += 1;
            reasons.push('Exact query phrase match in title/path (+1)');
        }
        if (scopeTokens.some((token) => notePath.includes(token) || noteTitle.includes(token) || frontmatter.includes(token))) {
            score += 0.4;
            reasons.push('Project scope match (+0.4)');
        }
        return {
            entry: row.entry,
            raw_score: Number(row.rawScore.toFixed(2)),
            score: Number(Math.max(0.01, score).toFixed(2)),
            matchedTokens: row.matchedTokens,
            score_reason: reasons.length > 0 ? reasons : ['Catalog lexical match'],
        };
    }).sort((left, right) => right.score - left.score || left.entry.path.localeCompare(right.entry.path));
}
function buildReadViewEntry(match, scope, view, dependencies) {
    const whyMatch = {
        note: catalogMetadataProjection(match.entry),
        score: match.score,
        raw_score: match.raw_score,
        matchedTokens: match.matchedTokens,
        score_reason: match.score_reason,
    };
    return {
        path: match.entry.path,
        title: match.entry.title,
        type: match.entry.type ?? undefined,
        note_type: match.entry.type,
        scope,
        score: match.score,
        raw_score: match.raw_score,
        matched_tokens: match.matchedTokens,
        score_reason: match.score_reason,
        why_matched: buildRecallWhyMatched(whyMatch, scope),
        excerpt: compactNoteText(match.entry.excerpt),
        content_origin: dependencies.contentOrigin(match.entry.path, match.entry.type ?? undefined),
        instruction_trust: 'data_only',
        graph_links: buildKnowledgeGraphLinksFromReadView(match.entry, view),
        relation_evidence: buildKnowledgeRelationEvidenceFromReadView(match.entry, view),
    };
}
function selectCatalogRecallMatches(matches, maxItems) {
    const hasDurableKnowledge = matches.some((match) => !isGeneratedWorkRecord(catalogMetadataProjection(match.entry)) && match.raw_score > 0);
    if (!hasDurableKnowledge)
        return matches.slice(0, maxItems);
    const selected = [];
    let workRecordCount = 0;
    for (const match of matches) {
        if (isGeneratedWorkRecord(catalogMetadataProjection(match.entry))) {
            if (workRecordCount >= 1)
                continue;
            workRecordCount += 1;
        }
        selected.push(match);
        if (selected.length >= maxItems)
            break;
    }
    if (maxItems > 1 && workRecordCount === 0 && selected.length === maxItems) {
        const bestWorkRecord = matches.find((match) => isGeneratedWorkRecord(catalogMetadataProjection(match.entry)) && match.raw_score > 0);
        if (bestWorkRecord)
            selected[selected.length - 1] = bestWorkRecord;
    }
    return selected;
}
function boundedReadViewMatches(view, entries, query, scope, nowMs) {
    const allowed = new Map(entries.map((entry) => [entry.path, entry]));
    const matchedByPath = new Map();
    const queryTerms = tokenizeReadViewQuery(query);
    for (const term of queryTerms) {
        for (const notePath of view.lexical.postings.get(term) ?? []) {
            if (!allowed.has(notePath))
                continue;
            const matched = matchedByPath.get(notePath) ?? new Set();
            matched.add(term);
            matchedByPath.set(notePath, matched);
        }
    }
    const lexical = [...matchedByPath.entries()]
        .sort(([leftPath, left], [rightPath, right]) => right.size - left.size || leftPath.localeCompare(rightPath))
        .slice(0, exports.MAX_READ_VIEW_LEXICAL_CANDIDATES);
    const candidateScores = new Map();
    for (const [notePath, matched] of lexical) {
        candidateScores.set(notePath, { rawScore: matched.size, tokens: new Set(matched) });
    }
    let graphExpansions = 0;
    for (const [seedPath] of lexical) {
        const neighbors = knowledgeGraphNeighbors(seedPath, view);
        for (const neighbor of [...neighbors].sort((left, right) => left.localeCompare(right))) {
            if (graphExpansions >= exports.MAX_READ_VIEW_GRAPH_EXPANSIONS)
                break;
            if (!allowed.has(neighbor) || candidateScores.has(neighbor))
                continue;
            candidateScores.set(neighbor, { rawScore: 0.25, tokens: new Set() });
            graphExpansions += 1;
        }
        if (graphExpansions >= exports.MAX_READ_VIEW_GRAPH_EXPANSIONS)
            break;
    }
    if (scope.projectHint || scope.projectId || scope.repoPath) {
        for (const entry of entries
            .filter((candidate) => candidate.path.startsWith(`${core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`))
            .sort((left, right) => left.path.localeCompare(right.path))
            .slice(0, 2)) {
            if (!candidateScores.has(entry.path))
                candidateScores.set(entry.path, { rawScore: 0, tokens: new Set() });
        }
    }
    const rows = [...candidateScores.entries()]
        .map(([notePath, candidate]) => ({
        entry: allowed.get(notePath),
        rawScore: candidate.rawScore,
        matchedTokens: [...candidate.tokens].sort(),
    }))
        .sort((left, right) => right.rawScore - left.rawScore || left.entry.path.localeCompare(right.entry.path))
        .slice(0, exports.MAX_READ_VIEW_RERANKED_ROWS);
    return {
        matches: rankCatalogMatches(rows, query, scope, nowMs),
        diagnostics: {
            lexical_candidates: lexical.length,
            graph_expansions: graphExpansions,
            reranked_rows: rows.length,
        },
    };
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
        if (request.scope === 'task_history') {
            return this.executeTaskHistory(request, scan);
        }
        return this.executeProjectHistory(request, scan);
    }
    executeReadView(request, view) {
        const allEntries = [...view.catalog.values()];
        const metadataNotes = allEntries.map(catalogMetadataProjection);
        if (request.scope === 'task_history') {
            const groups = collectTaskHistoryGroups(metadataNotes, request, this.dependencies);
            const entries = buildTaskHistoryEntries(groups.slice(0, request.maxItems), request.query, metadataNotes, this.dependencies);
            return {
                ok: true,
                read_only: true,
                vault_root: request.vaultRoot,
                query: request.query || null,
                task_id: request.taskId || null,
                max_items: request.maxItems,
                matched_count: entries.length,
                total_matches: groups.length,
                scope_mode: 'task_history',
                ...readViewProvenance(view),
                entries,
            };
        }
        if (request.scope === 'global') {
            const entries = allEntries.filter((entry) => isCurrentReadViewEntry(entry, view));
            const ranked = boundedReadViewMatches(view, entries, request.query, {
                projectHint: '', projectId: '', repoPath: '', source: 'unknown', confidence: 'uncertain', warnings: [],
            }, this.dependencies.nowMs());
            this.dependencies.onReadViewDiagnostics?.(ranked.diagnostics);
            const matches = selectCatalogRecallMatches(ranked.matches, request.maxItems);
            return {
                ok: true,
                read_only: true,
                scope_mode: 'global',
                query: request.query,
                vault_root: request.vaultRoot,
                max_items: request.maxItems,
                matched_count: matches.length,
                ...readViewProvenance(view),
                matches: matches.map((match) => buildReadViewEntry(match, 'global', view, this.dependencies)),
            };
        }
        const identity = this.dependencies.resolveProjectIdentity(request.projectIdentityInput, metadataNotes);
        const unresolved = identity.confidence === 'uncertain';
        const scopedMetadata = unresolved
            ? []
            : this.dependencies.filterProjectNotes(metadataNotes, identity);
        const scopedPaths = new Set(scopedMetadata.map((note) => note.relativePath));
        const scopedEntries = allEntries.filter((entry) => scopedPaths.has(entry.path));
        const candidateEntries = unresolved ? allEntries : scopedEntries;
        const candidateNotes = collectProjectCandidates(candidateEntries.map(catalogMetadataProjection), identity, MAX_PROJECT_SCOPE_CANDIDATES);
        const uncertain = !hasProjectScope(identity) || identity.confidence === 'uncertain';
        if (request.scope === 'project') {
            const currentEntries = scopedEntries.filter((entry) => isCurrentReadViewEntry(entry, view));
            const ranked = boundedReadViewMatches(view, currentEntries, request.query, identity, this.dependencies.nowMs());
            this.dependencies.onReadViewDiagnostics?.(ranked.diagnostics);
            const matches = selectCatalogRecallMatches(ranked.matches, request.maxItems);
            return {
                ok: true,
                read_only: true,
                vault_root: request.vaultRoot,
                query: request.query,
                uncertain,
                scope: projectIdentityResult(identity),
                project_identity: projectIdentityResult(identity),
                max_items: request.maxItems,
                matched_count: matches.length,
                ...readViewProvenance(view),
                candidates: candidateNotes.map((candidate) => candidate.path),
                candidate_notes: candidateNotes,
                scope_evidence: buildProjectRecallRelationEvidence(identity),
                scope_mode: 'project',
                entries: matches.map((match) => buildReadViewEntry(match, 'project', view, this.dependencies)),
            };
        }
        const queryTerms = tokenizeReadViewQuery(request.query);
        const historyEntries = scopedEntries
            .filter((entry) => entry.path !== '')
            .filter((entry) => queryTerms.length === 0 || queryTerms.every((term) => entry.searchTokens.includes(term)))
            .sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt) || left.path.localeCompare(right.path));
        const matches = historyEntries.slice(0, request.maxItems);
        this.dependencies.onReadViewDiagnostics?.({ lexical_candidates: 0, graph_expansions: 0, reranked_rows: 0 });
        return {
            ok: true,
            read_only: true,
            vault_root: request.vaultRoot,
            query: request.query || null,
            uncertain,
            scope: projectIdentityResult(identity),
            project_identity: projectIdentityResult(identity),
            max_items: request.maxItems,
            matched_count: matches.length,
            total_matches: historyEntries.length,
            scope_mode: 'project_history',
            ...readViewProvenance(view),
            candidates: candidateNotes.map((candidate) => candidate.path),
            candidate_notes: candidateNotes,
            entries: matches.map((entry) => ({
                path: entry.path,
                title: entry.title,
                type: entry.type ?? undefined,
                note_type: entry.type,
                scope: 'project_history',
                modifiedAt: entry.modifiedAt,
                content_origin: this.dependencies.contentOrigin(entry.path, entry.type ?? undefined),
                instruction_trust: 'data_only',
                task_id: readFrontmatterString(entry.frontmatter, ['task_id', 'taskId']),
                project_hint: readFrontmatterString(entry.frontmatter, ['project_hint', 'related_project', 'project']),
                why_matched: buildProjectHistoryWhy(catalogMetadataProjection(entry), request.query),
                excerpt: compactNoteText(entry.excerpt),
                graph_links: buildKnowledgeGraphLinksFromReadView(entry, view),
                relation_evidence: buildKnowledgeRelationEvidenceFromReadView(entry, view),
            })),
        };
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
            ? []
            : this.dependencies.filterProjectNotes(scan.notes, scope);
        const candidateLimit = recallCandidateLimit(request.maxItems);
        const initialMatches = (0, core_1.recallNotes)(scopedNotes, request.query, { limit: candidateLimit });
        const anchoredMatches = [
            ...initialMatches,
            ...buildProjectMemoryAnchors(scopedNotes, new Set(initialMatches.map((match) => match.note.relativePath))),
        ];
        const matches = selectRecallMatches(rankRecallMatches(anchoredMatches, request.query, scope, this.dependencies.nowMs()), request.maxItems);
        const uncertain = !hasProjectScope(scope) ||
            scope.confidence === 'uncertain';
        const candidateNotes = collectProjectCandidates(unresolved ? scan.notes : scopedNotes, scope, MAX_PROJECT_SCOPE_CANDIDATES);
        return {
            ok: true,
            read_only: true,
            vault_root: request.vaultRoot,
            query: request.query,
            uncertain,
            scope: projectIdentityResult(scope),
            project_identity: projectIdentityResult(scope),
            max_items: request.maxItems,
            matched_count: matches.length,
            ...scanProvenance(scan),
            candidates: candidateNotes.map((candidate) => candidate.path),
            candidate_notes: candidateNotes,
            scope_evidence: buildProjectRecallRelationEvidence(scope),
            scope_mode: 'project',
            entries: matches.map((match) => buildRecallEntry(match, 'project', scan.notes, this.dependencies)),
        };
    }
    executeProjectHistory(request, scan) {
        const scope = this.dependencies.resolveProjectIdentity(request.projectIdentityInput, scan.notes);
        const unresolved = scope.confidence === 'uncertain';
        const scopedNotes = unresolved
            ? []
            : this.dependencies.filterProjectNotes(scan.notes, scope);
        const uncertain = !hasProjectScope(scope) || scope.confidence === 'uncertain';
        const filteredByQuery = request.query
            ? scopedNotes.filter((note) => matchesProjectQuery(note, request.query))
            : scopedNotes;
        const sortedMatches = filteredByQuery
            .filter((note) => note.relativePath !== '')
            .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
        const candidateNotes = collectProjectCandidates(unresolved ? scan.notes : scopedNotes, scope, MAX_PROJECT_SCOPE_CANDIDATES);
        const matches = sortedMatches.slice(0, request.maxItems);
        return {
            ok: true,
            read_only: true,
            vault_root: request.vaultRoot,
            query: request.query || null,
            uncertain,
            scope: projectIdentityResult(scope),
            project_identity: projectIdentityResult(scope),
            max_items: request.maxItems,
            matched_count: matches.length,
            total_matches: sortedMatches.length,
            scope_mode: 'project_history',
            ...scanProvenance(scan),
            candidates: candidateNotes.map((candidate) => candidate.path),
            candidate_notes: candidateNotes,
            entries: buildProjectHistoryEntries(matches, request.query, scan.notes, this.dependencies),
        };
    }
    executeTaskHistory(request, scan) {
        const groups = collectTaskHistoryGroups(scan.notes, request, this.dependencies);
        const entries = buildTaskHistoryEntries(groups.slice(0, request.maxItems), request.query, scan.notes, this.dependencies);
        return {
            ok: true,
            read_only: true,
            vault_root: request.vaultRoot,
            query: request.query || null,
            task_id: request.taskId || null,
            max_items: request.maxItems,
            matched_count: entries.length,
            total_matches: groups.length,
            scope_mode: 'task_history',
            ...scanProvenance(scan),
            entries,
        };
    }
}
exports.RecallApplicationService = RecallApplicationService;
