"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryKnowledgeIndex = exports.KNOWLEDGE_INDEX_VERSION = void 0;
exports.computeFileVersion = computeFileVersion;
exports.toIndexedKnowledgeNote = toIndexedKnowledgeNote;
exports.buildKnowledgeSnapshot = buildKnowledgeSnapshot;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const node_util_1 = require("node:util");
const safety_1 = require("./safety");
const scan_1 = require("./scan");
const knowledge_note_1 = require("./knowledge-note");
const memory_record_1 = require("./memory-record");
const memory_lifecycle_1 = require("./memory-lifecycle");
const project_memory_1 = require("./project-memory");
const knowledge_architecture_1 = require("./knowledge-architecture");
exports.KNOWLEDGE_INDEX_VERSION = '1.0';
const NOTES_EXTENSIONS = new Set(['.md', '.markdown']);
const SNIPPET_MAX_LENGTH = 160;
const MAX_LEXICAL_TERMS_PER_NOTE = 512;
const DEFAULT_MAX_INCREMENTAL_RENAME_IMPACT = 256;
function computeFileVersion(size, modifiedAt) {
    return `${modifiedAt}|${size}`;
}
function toIndexedKnowledgeNote(note) {
    return {
        schemaVersion: knowledge_note_1.NORMALIZED_VAULT_NOTE_VERSION,
        path: note.relativePath,
        exists: note.exists,
        fileVersion: computeFileVersion(note.size, note.modifiedAt),
        title: note.title,
        aliases: [...note.aliases],
        type: note.type ?? null,
        tags: [...note.tags],
        frontmatter: (0, knowledge_note_1.cloneVaultFrontmatter)(note.frontmatter),
        semanticErrors: [...note.semanticErrors],
        headings: [...note.headings],
        blockIds: [...note.blockIds],
        sections: note.sections.map(cloneSection),
        callouts: note.callouts.map(cloneCallout),
        edges: note.edges.map(cloneEdge),
        wikilinks: note.wikilinks.map((item) => ({ ...item })),
        backlinks: [],
        searchTokens: note.tokens.split(/\s+/).filter(Boolean),
        excerptSource: note.content.slice(0, SNIPPET_MAX_LENGTH).trim(),
        contentHash: note.contentHash,
        text: note.text,
        content: note.content,
        modifiedAt: note.modifiedAt,
        size: note.size,
    };
}
function normalizeVaultPath(value) {
    return (0, knowledge_note_1.normalizeVaultRelativePath)(value);
}
function cloneIndexMap(input) {
    const cloned = new Map();
    for (const [key, values] of [...input.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        cloned.set(key, [...values]);
    }
    return cloned;
}
function cloneNote(note) {
    return {
        ...note,
        aliases: [...note.aliases],
        tags: [...note.tags],
        frontmatter: (0, knowledge_note_1.cloneVaultFrontmatter)(note.frontmatter),
        semanticErrors: [...note.semanticErrors],
        headings: [...note.headings],
        blockIds: [...note.blockIds],
        sections: note.sections.map(cloneSection),
        callouts: note.callouts.map(cloneCallout),
        edges: note.edges.map(cloneEdge),
        wikilinks: note.wikilinks.map(cloneEdge),
        backlinks: [...note.backlinks],
        searchTokens: [...note.searchTokens],
    };
}
function hasSameSemanticState(left, right) {
    return (0, node_util_1.isDeepStrictEqual)({
        schemaVersion: left.schemaVersion,
        path: left.path,
        exists: left.exists,
        contentHash: left.contentHash,
        title: left.title,
        aliases: left.aliases,
        type: left.type,
        frontmatter: left.frontmatter,
        semanticErrors: left.semanticErrors,
        tags: left.tags,
        headings: left.headings,
        blockIds: left.blockIds,
        sections: left.sections,
        callouts: left.callouts,
        edges: left.edges,
        text: left.text,
        content: left.content,
    }, {
        schemaVersion: right.schemaVersion,
        path: right.path,
        exists: right.exists,
        contentHash: right.contentHash,
        title: right.title,
        aliases: right.aliases,
        type: right.type,
        frontmatter: right.frontmatter,
        semanticErrors: right.semanticErrors,
        tags: right.tags,
        headings: right.headings,
        blockIds: right.blockIds,
        sections: right.sections,
        callouts: right.callouts,
        edges: right.edges,
        text: right.text,
        content: right.content,
    });
}
function cloneScannedNote(note) {
    return {
        ...note,
        frontmatter: (0, knowledge_note_1.cloneVaultFrontmatter)(note.frontmatter),
        semanticErrors: [...note.semanticErrors],
        aliases: [...note.aliases],
        tags: [...note.tags],
        headings: [...note.headings],
        blockIds: [...note.blockIds],
        sections: note.sections.map(cloneSection),
        callouts: note.callouts.map(cloneCallout),
        edges: note.edges.map(cloneEdge),
        wikilinks: note.wikilinks.map(cloneEdge),
        claimBlocks: note.claimBlocks.map(cloneCallout),
        evidenceBlocks: note.evidenceBlocks.map(cloneCallout),
    };
}
function scanNotesByPath(notes) {
    return new Map((0, scan_1.resolveScannedNoteEdges)(notes).map((note) => [
        normalizeVaultPath(note.relativePath),
        cloneScannedNote(note),
    ]));
}
function cloneEdge(edge) {
    return {
        ...edge,
        position: {
            start: { ...edge.position.start },
            end: { ...edge.position.end },
        },
        resolution: { ...edge.resolution },
    };
}
function cloneSection(section) {
    return {
        ...section,
        position: {
            start: { ...section.position.start },
            end: { ...section.position.end },
        },
    };
}
function cloneCallout(callout) {
    return {
        ...callout,
        sourceRefs: [...callout.sourceRefs],
        position: {
            start: { ...callout.position.start },
            end: { ...callout.position.end },
        },
    };
}
function snapshotToReadonly(state) {
    return {
        version: exports.KNOWLEDGE_INDEX_VERSION,
        createdAt: state.createdAt,
        generation: state.generation,
        event_sequence: state.eventSequence,
        index_state: state.indexState,
        notes: new Map(Array.from(state.notes.entries()).map(([notePath, note]) => [notePath, cloneNote(note)])),
        graph: cloneGraph(state.graph),
        scopes: {
            byType: cloneIndexMap(state.scopes.byType),
            byTag: cloneIndexMap(state.scopes.byTag),
        },
        last_event: state.lastEvent ? { ...state.lastEvent } : null,
        last_rebuild: state.lastRebuild,
    };
}
function cloneGraph(graph) {
    return {
        outgoing: cloneIndexMap(graph.outgoing),
        incoming: cloneIndexMap(graph.incoming),
        edges: graph.edges.map(cloneEdge),
        unresolvedEdges: graph.unresolvedEdges.map(cloneEdge),
    };
}
function mergeAndSortUnique(items) {
    return [...new Set(items)].sort();
}
function buildKnowledgeGraph(notes) {
    const outgoing = new Map();
    const incoming = new Map();
    const edges = [];
    const unresolvedEdges = [];
    for (const notePath of notes.keys()) {
        outgoing.set(notePath, new Set());
        incoming.set(notePath, new Set());
    }
    for (const [notePath, note] of notes.entries()) {
        for (const link of note.edges) {
            const sourcedLink = { ...cloneEdge(link), sourcePath: link.sourcePath ?? notePath };
            if (link.resolution.status !== 'resolved'
                || (!notes.has(link.resolution.path)
                    && link.resolution.authority !== 'native')) {
                unresolvedEdges.push(link.resolution.status === 'resolved'
                    ? {
                        ...sourcedLink,
                        resolution: {
                            status: 'unresolved',
                            reason: 'not_found',
                            authority: link.resolution.authority,
                        },
                    }
                    : sourcedLink);
                continue;
            }
            const target = link.resolution.path;
            const outgoingTargets = outgoing.get(notePath);
            if (!outgoingTargets) {
                continue;
            }
            edges.push(sourcedLink);
            outgoingTargets.add(target);
            const backlinksForTarget = incoming.get(target);
            if (backlinksForTarget) {
                backlinksForTarget.add(notePath);
            }
            else {
                incoming.set(target, new Set([notePath]));
            }
        }
    }
    return {
        outgoing: cloneIndexMap(new Map(Array.from(outgoing.entries()).map(([fromPath, toPaths]) => [fromPath, mergeAndSortUnique(Array.from(toPaths))]))),
        incoming: cloneIndexMap(new Map(Array.from(incoming.entries()).map(([toPath, fromPaths]) => [toPath, mergeAndSortUnique(Array.from(fromPaths))]))),
        edges: edges.sort(compareGraphEdges),
        unresolvedEdges: unresolvedEdges.sort(compareGraphEdges),
    };
}
function compareGraphEdges(left, right) {
    return ((left.sourcePath ?? '').localeCompare(right.sourcePath ?? '') ||
        left.position.start.offset - right.position.start.offset ||
        left.raw.localeCompare(right.raw));
}
function resolveIndexedNoteEdges(notes) {
    const resolved = (0, knowledge_note_1.resolveNormalizedVaultEdges)(Array.from(notes.values()).map((note) => ({
        path: note.path,
        title: note.title,
        aliases: note.aliases,
        edges: note.edges,
    })));
    const result = new Map();
    for (const notePath of [...notes.keys()].sort()) {
        const note = notes.get(notePath);
        if (!note) {
            continue;
        }
        const edges = (resolved.get(notePath) ?? note.edges).map(cloneEdge);
        result.set(notePath, {
            ...cloneNote(note),
            edges,
            wikilinks: edges,
        });
    }
    return result;
}
function buildScopeIndex(notes) {
    const byType = new Map();
    const byTag = new Map();
    for (const [notePath, note] of notes.entries()) {
        const typeKey = note.type ?? 'untyped';
        if (!byType.has(typeKey)) {
            byType.set(typeKey, new Set());
        }
        byType.get(typeKey).add(notePath);
        for (const tag of note.tags) {
            if (!byTag.has(tag)) {
                byTag.set(tag, new Set());
            }
            byTag.get(tag).add(notePath);
        }
    }
    const byTypeMap = new Map(Array.from(byType.entries()).map(([type, paths]) => [type, mergeAndSortUnique(Array.from(paths))]));
    const byTagMap = new Map(Array.from(byTag.entries()).map(([tag, paths]) => [tag, mergeAndSortUnique(Array.from(paths))]));
    return {
        byType: cloneIndexMap(byTypeMap),
        byTag: cloneIndexMap(byTagMap),
    };
}
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}
function frontmatterHash(frontmatter) {
    return (0, node_crypto_1.createHash)('sha256').update(stableJson(frontmatter), 'utf8').digest('hex');
}
function lexicalTerms(note) {
    const terms = new Set();
    const add = (value) => {
        const normalized = value.normalize('NFC').trim().toLocaleLowerCase('en-US');
        if (normalized && terms.size < MAX_LEXICAL_TERMS_PER_NOTE)
            terms.add(normalized);
    };
    for (const value of [...note.searchTokens, note.title, ...note.aliases, ...note.tags]) {
        for (const token of value.split(/[^\p{L}\p{N}_-]+/u))
            add(token);
        for (const run of value.match(/\p{Script=Han}{2,}/gu) ?? []) {
            const characters = [...run];
            for (const width of [2, 3]) {
                for (let offset = 0; offset + width <= characters.length; offset += 1) {
                    add(characters.slice(offset, offset + width).join(''));
                    if (terms.size >= MAX_LEXICAL_TERMS_PER_NOTE)
                        break;
                }
            }
        }
    }
    return [...terms].sort();
}
function toCatalogEntry(note) {
    return {
        path: note.path,
        fileVersion: note.fileVersion,
        contentHash: note.contentHash,
        frontmatterHash: frontmatterHash(note.frontmatter),
        frontmatter: (0, knowledge_note_1.cloneVaultFrontmatter)(note.frontmatter),
        title: note.title,
        aliases: [...note.aliases],
        type: note.type,
        tags: [...note.tags],
        searchTokens: lexicalTerms(note),
        excerpt: note.excerptSource,
        modifiedAt: note.modifiedAt,
        size: note.size,
    };
}
function cloneCatalogEntry(entry) {
    return {
        ...entry,
        aliases: [...entry.aliases],
        tags: [...entry.tags],
        searchTokens: [...entry.searchTokens],
        frontmatter: (0, knowledge_note_1.cloneVaultFrontmatter)(entry.frontmatter),
    };
}
function addPosting(postings, term, notePath) {
    postings.set(term, mergeAndSortUnique([...(postings.get(term) ?? []), notePath]));
}
function removePosting(postings, term, notePath) {
    const next = (postings.get(term) ?? []).filter((candidate) => candidate !== notePath);
    if (next.length === 0)
        postings.delete(term);
    else
        postings.set(term, next);
}
function buildLexicalPostings(catalog) {
    const postings = new Map();
    for (const [notePath, entry] of catalog) {
        for (const term of entry.searchTokens)
            addPosting(postings, term, notePath);
    }
    return new Map([...postings.entries()].sort(([left], [right]) => left.localeCompare(right)));
}
function cloneMemoryRecord(record) {
    return {
        ...record,
        evidence: [...record.evidence],
        supersedes: [...record.supersedes],
        contradicts: [...record.contradicts],
        related_wiki: [...record.related_wiki],
        related_sources: [...record.related_sources],
    };
}
function buildMemoryIndex(notes, generation, resolvedAt) {
    const records = [];
    const legacy = [];
    const invalidPaths = [];
    for (const note of notes.values()) {
        if (note.frontmatter.type === 'memory_record') {
            try {
                records.push((0, memory_record_1.parseMemoryRecord)({ path: note.path, frontmatter: note.frontmatter }));
            }
            catch {
                invalidPaths.push(note.path);
            }
            continue;
        }
        try {
            const projectNote = (0, project_memory_1.classifyProjectMemoryNote)({ path: note.path, frontmatter: note.frontmatter });
            if (projectNote.kind === 'entry') {
                const projection = (0, memory_record_1.projectMemoryEntryToReadProjection)(projectNote.entry);
                if (projection.kind !== 'v2')
                    legacy.push(projection);
                continue;
            }
            if (projectNote.kind === 'legacy' && projectNote.project_id) {
                const projection = (0, memory_record_1.legacyMemoryToReadProjection)({
                    path: projectNote.path,
                    scope: 'project',
                    project_id: projectNote.project_id,
                });
                if (projection.kind !== 'v2')
                    legacy.push(projection);
                continue;
            }
        }
        catch {
            invalidPaths.push(note.path);
            continue;
        }
        if (isGlobalLegacyMemoryPath(note.path)) {
            const projection = (0, memory_record_1.legacyMemoryToReadProjection)({ path: note.path, scope: 'global' });
            if (projection.kind !== 'v2')
                legacy.push(projection);
        }
    }
    const lifecycle = (0, memory_lifecycle_1.resolveMemoryLifecycle)({ generation, records, legacy, now: resolvedAt });
    const byId = new Map();
    const byClaimKey = new Map();
    for (const row of lifecycle.records) {
        byId.set(row.record.memory_id, cloneMemoryRecord(row.record));
        const key = `${row.record.scope}\u0000${row.record.project_id ?? ''}\u0000${row.record.claim_key}`;
        byClaimKey.set(key, mergeAndSortUnique([...(byClaimKey.get(key) ?? []), row.record.memory_id]));
    }
    return {
        byId,
        byClaimKey,
        lifecycle,
        invalidPaths: mergeAndSortUnique(invalidPaths),
    };
}
function isGlobalLegacyMemoryPath(notePath) {
    if (node_path_1.default.posix.basename(notePath).toLowerCase() === 'index.md')
        return false;
    return notePath.startsWith(`${knowledge_architecture_1.KNOWLEDGE_GLOBAL_MEMORY_DIR}/`)
        || knowledge_architecture_1.LEGACY_MEMORY_DIRS.some((directory) => notePath.startsWith(`${directory}/`));
}
function emptyMemoryIndex(generation, resolvedAt) {
    return buildMemoryIndex(new Map(), generation, resolvedAt);
}
function cloneMemoryIndex(index) {
    return {
        byId: new Map([...index.byId].map(([key, record]) => [key, cloneMemoryRecord(record)])),
        byClaimKey: cloneIndexMap(index.byClaimKey),
        lifecycle: {
            ...index.lifecycle,
            records: index.lifecycle.records.map((row) => ({ ...row, record: cloneMemoryRecord(row.record), reasons: [...row.reasons] })),
            legacy: index.lifecycle.legacy.map((row) => ({ ...row, projection: { ...row.projection }, reasons: [...row.reasons] })),
            current: index.lifecycle.current.map((row) => ({ ...row, record: cloneMemoryRecord(row.record), reasons: [...row.reasons] })),
            history: index.lifecycle.history.map((row) => ({ ...row, record: cloneMemoryRecord(row.record), reasons: [...row.reasons] })),
            conflicts: index.lifecycle.conflicts.map((row) => ({ ...row, record: cloneMemoryRecord(row.record), reasons: [...row.reasons] })),
            issues: index.lifecycle.issues.map((issue) => ({ ...issue, memory_ids: [...issue.memory_ids] })),
        },
        invalidPaths: [...index.invalidPaths],
    };
}
function readNoteFromVault(vaultRoot, notePath) {
    const normalized = normalizeVaultPath(notePath);
    if (!normalized) {
        return null;
    }
    const candidate = (0, safety_1.ensureInsideVaultRoot)(vaultRoot, node_path_1.default.join(vaultRoot, normalized));
    let lstat;
    let stat;
    try {
        lstat = node_fs_1.default.lstatSync(candidate);
        stat = node_fs_1.default.statSync(candidate);
    }
    catch (error) {
        if (error instanceof Error && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
    if (lstat.isSymbolicLink()) {
        return null;
    }
    if (!stat.isFile()) {
        return null;
    }
    const extension = node_path_1.default.extname(candidate).toLowerCase();
    if (!NOTES_EXTENSIONS.has(extension)) {
        return null;
    }
    const fileContent = node_fs_1.default.readFileSync(candidate, 'utf8');
    return (0, scan_1.scannedNoteFromContent)({
        absolutePath: candidate,
        relativePath: normalized,
        fallbackTitle: node_path_1.default.basename(candidate, extension),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        content: fileContent,
    });
}
function buildKnowledgeSnapshot(scanResult, options = {}) {
    const notesByPath = new Map();
    for (const scannedNote of [...scanResult.notes].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
        const normalizedPath = normalizeVaultPath(scannedNote.relativePath);
        notesByPath.set(normalizedPath, toIndexedKnowledgeNote(scannedNote));
    }
    const resolvedNotes = resolveIndexedNoteEdges(notesByPath);
    const graph = buildKnowledgeGraph(resolvedNotes);
    const notes = enrichNoteBacklinks(resolvedNotes, graph);
    const scopes = buildScopeIndex(notes);
    return {
        version: exports.KNOWLEDGE_INDEX_VERSION,
        createdAt: scanResult.scannedAt,
        generation: options.generation ?? 0,
        event_sequence: options.eventSequence ?? scanResult.index?.event_sequence ?? 0,
        index_state: options.indexState ?? 'ready',
        notes,
        graph: cloneGraph(graph),
        scopes,
        last_event: options.lastEvent ? { ...options.lastEvent } : null,
        last_rebuild: options.lastRebuild ?? null,
    };
}
function rebuildFromState(vaultRoot, vaultConfigDir, existingScan) {
    const scanResult = existingScan ? existingScan : (0, scan_1.scanVault)(vaultRoot, vaultConfigDir ? { vaultConfigDir } : {});
    const snapshot = buildKnowledgeSnapshot(scanResult, { indexState: 'ready', generation: 0, lastEvent: null, lastRebuild: scanResult.scannedAt });
    return {
        notes: new Map(snapshot.notes),
        graph: snapshot.graph,
        scopes: snapshot.scopes,
        lastRebuild: snapshot.createdAt,
    };
}
function enrichNoteBacklinks(notes, graph) {
    const enriched = new Map();
    for (const [notePath, note] of notes.entries()) {
        enriched.set(notePath, {
            ...note,
            backlinks: graph.incoming.get(notePath) ?? [],
        });
    }
    return enriched;
}
function normalizeLookupIdentity(value) {
    return value.normalize('NFC').trim().toLocaleLowerCase('en-US');
}
function noteLookupIdentities(note) {
    if (!note)
        return new Set();
    const withoutExtension = note.path.replace(/\.(?:md|markdown)$/i, '');
    return new Set([
        note.path,
        withoutExtension,
        node_path_1.default.posix.basename(withoutExtension),
        note.title,
        ...note.aliases,
    ].map(normalizeLookupIdentity));
}
function edgeTouchesIdentity(edge, identities, paths) {
    if (edge.resolution.status === 'resolved' && paths.has(edge.resolution.path))
        return true;
    const target = normalizeLookupIdentity((edge.linkPath || edge.target).replace(/\.(?:md|markdown)$/i, ''));
    return identities.has(target) || identities.has(normalizeLookupIdentity(node_path_1.default.posix.basename(target)));
}
function collectAffectedSources(previous, next, oldNote, newNote, changedPaths) {
    const affected = new Set(changedPaths);
    const identities = new Set([...noteLookupIdentities(oldNote), ...noteLookupIdentities(newNote)]);
    const paths = new Set(changedPaths);
    for (const [notePath, note] of new Map([...previous, ...next])) {
        if (note.edges.some((edge) => edgeTouchesIdentity(edge, identities, paths)))
            affected.add(notePath);
    }
    return affected;
}
function resolveAffectedNoteEdges(notes, affected) {
    const resolved = (0, knowledge_note_1.resolveNormalizedVaultEdges)([...notes.values()].map((note) => ({
        path: note.path,
        title: note.title,
        aliases: note.aliases,
        edges: affected.has(note.path) ? note.edges : [],
    })));
    const result = new Map(notes);
    for (const notePath of affected) {
        const note = notes.get(notePath);
        if (!note)
            continue;
        const edges = (resolved.get(notePath) ?? note.edges).map(cloneEdge);
        result.set(notePath, { ...note, edges, wikilinks: edges });
    }
    return result;
}
function updateKnowledgeGraphIncrementally(graph, previousNotes, nextNotes, affectedSources) {
    const outgoing = new Map([...graph.outgoing].map(([key, values]) => [key, new Set(values)]));
    const incoming = new Map([...graph.incoming].map(([key, values]) => [key, new Set(values)]));
    const affectedTargets = new Set();
    for (const sourcePath of affectedSources) {
        for (const targetPath of outgoing.get(sourcePath) ?? []) {
            affectedTargets.add(targetPath);
            incoming.get(targetPath)?.delete(sourcePath);
        }
        outgoing.set(sourcePath, new Set());
    }
    let edges = graph.edges.filter((edge) => !affectedSources.has(edge.sourcePath ?? ''));
    let unresolvedEdges = graph.unresolvedEdges.filter((edge) => !affectedSources.has(edge.sourcePath ?? ''));
    for (const sourcePath of affectedSources) {
        const note = nextNotes.get(sourcePath);
        if (!note) {
            outgoing.delete(sourcePath);
            continue;
        }
        if (!incoming.has(sourcePath))
            incoming.set(sourcePath, new Set());
        for (const link of note.edges) {
            const sourcedLink = { ...cloneEdge(link), sourcePath: link.sourcePath ?? sourcePath };
            if (link.resolution.status !== 'resolved'
                || (!nextNotes.has(link.resolution.path) && link.resolution.authority !== 'native')) {
                unresolvedEdges.push(link.resolution.status === 'resolved'
                    ? {
                        ...sourcedLink,
                        resolution: {
                            status: 'unresolved',
                            reason: 'not_found',
                            authority: link.resolution.authority,
                        },
                    }
                    : sourcedLink);
                continue;
            }
            const targetPath = link.resolution.path;
            edges.push(sourcedLink);
            outgoing.get(sourcePath).add(targetPath);
            const backlinks = incoming.get(targetPath) ?? new Set();
            backlinks.add(sourcePath);
            incoming.set(targetPath, backlinks);
            affectedTargets.add(targetPath);
        }
    }
    for (const notePath of previousNotes.keys()) {
        if (!nextNotes.has(notePath) && (incoming.get(notePath)?.size ?? 0) === 0)
            incoming.delete(notePath);
    }
    return {
        graph: {
            outgoing: new Map([...outgoing]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, values]) => [key, mergeAndSortUnique([...values])])),
            incoming: new Map([...incoming]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, values]) => [key, mergeAndSortUnique([...values])])),
            edges: edges.sort(compareGraphEdges),
            unresolvedEdges: unresolvedEdges.sort(compareGraphEdges),
        },
        affectedTargets,
    };
}
function addScopePath(index, key, notePath) {
    index.set(key, mergeAndSortUnique([...(index.get(key) ?? []), notePath]));
}
function removeScopePath(index, key, notePath) {
    const next = (index.get(key) ?? []).filter((candidate) => candidate !== notePath);
    if (next.length === 0)
        index.delete(key);
    else
        index.set(key, next);
}
class InMemoryKnowledgeIndex {
    constructor(options) {
        this.sourceNotes = new Map();
        this.sourceErrors = [];
        this.writeChain = Promise.resolve();
        this.vaultRoot = (0, safety_1.resolveVaultRoot)(options.vaultRoot);
        this.vaultConfigDir = options.vaultConfigDir;
        this.maxIncrementalRenameImpact = normalizeRenameImpactLimit(options.maxIncrementalRenameImpact);
        const initializedAt = new Date().toISOString();
        this.state = {
            notes: new Map(),
            graph: {
                outgoing: new Map(),
                incoming: new Map(),
                edges: [],
                unresolvedEdges: [],
            },
            scopes: {
                byType: new Map(),
                byTag: new Map(),
            },
            generation: 0,
            eventSequence: 0,
            indexState: 'initializing',
            lastEvent: null,
            lastRebuild: null,
            createdAt: initializedAt,
            catalog: new Map(),
            lexicalPostings: new Map(),
            memory: emptyMemoryIndex(0, initializedAt),
            lastUpdate: { mode: 'rebuild', affectedPaths: [], reason: null },
            warnings: [],
        };
        if (options.initialScan) {
            const snapshot = buildKnowledgeSnapshot(options.initialScan, {
                indexState: options.initialScan.index?.index_state ?? 'ready',
                generation: options.initialScan.index?.generation ?? 1,
                lastRebuild: options.initialScan.scannedAt,
            });
            this.state = this.toMutableState(snapshot);
            this.sourceNotes = scanNotesByPath(options.initialScan.notes);
            this.sourceErrors = options.initialScan.errors.map((error) => ({ ...error }));
        }
    }
    async snapshot() {
        return snapshotToReadonly(this.state);
    }
    async readView() {
        const generation = this.state.generation;
        const catalog = new Map([...this.state.catalog].map(([notePath, entry]) => [notePath, cloneCatalogEntry(entry)]));
        return {
            version: exports.KNOWLEDGE_INDEX_VERSION,
            source: 'index',
            createdAt: this.state.createdAt,
            generation,
            event_sequence: this.state.eventSequence,
            index_state: this.state.indexState,
            catalog,
            graph: cloneGraph(this.state.graph),
            scopes: {
                byType: cloneIndexMap(this.state.scopes.byType),
                byTag: cloneIndexMap(this.state.scopes.byTag),
            },
            lexical: { postings: cloneIndexMap(this.state.lexicalPostings) },
            memory: cloneMemoryIndex(this.state.memory),
            last_update: {
                ...this.state.lastUpdate,
                affectedPaths: [...this.state.lastUpdate.affectedPaths],
            },
            warnings: [...this.state.warnings],
            errors: this.sourceErrors.map((error) => ({ ...error })),
            contentReader: {
                generation,
                read: async (notePath) => this.readContentForView(generation, catalog, notePath),
            },
        };
    }
    scanSnapshot() {
        return {
            vaultRoot: this.vaultRoot,
            scannedAt: this.state.createdAt,
            notes: Array.from(this.sourceNotes.values(), cloneScannedNote),
            errors: this.sourceErrors.map((error) => ({ ...error })),
            index: {
                index_state: this.state.indexState,
                generation: this.state.generation,
                event_sequence: this.state.eventSequence,
                last_rebuild: this.state.lastRebuild,
            },
        };
    }
    async rebuild(scanResult) {
        return this.enqueueWrite(async () => {
            this.state = {
                ...this.state,
                indexState: 'rebuilding',
                createdAt: new Date().toISOString(),
            };
            const sourceScan = scanResult ?? (0, scan_1.scanVault)(this.vaultRoot, this.vaultConfigDir ? { vaultConfigDir: this.vaultConfigDir } : {});
            const built = rebuildFromState(this.vaultRoot, this.vaultConfigDir, sourceScan);
            const withBacklinks = enrichNoteBacklinks(built.notes, built.graph);
            const scopes = buildScopeIndex(withBacklinks);
            const graph = cloneGraph(built.graph);
            const generation = this.state.generation + 1;
            const createdAt = new Date().toISOString();
            const catalog = new Map([...withBacklinks].map(([notePath, note]) => [notePath, toCatalogEntry(note)]));
            this.state = {
                notes: withBacklinks,
                graph,
                scopes,
                generation,
                eventSequence: this.state.eventSequence,
                indexState: 'ready',
                lastEvent: this.state.lastEvent,
                lastRebuild: built.lastRebuild,
                createdAt,
                catalog,
                lexicalPostings: buildLexicalPostings(catalog),
                memory: buildMemoryIndex(withBacklinks, generation, createdAt),
                lastUpdate: {
                    mode: 'rebuild',
                    affectedPaths: [...withBacklinks.keys()].sort(),
                    reason: null,
                },
                warnings: [],
            };
            this.sourceNotes = scanNotesByPath(sourceScan.notes);
            this.sourceErrors = sourceScan.errors.map((error) => ({ ...error }));
            return {
                index_state: this.state.indexState,
                generation,
                event_sequence: this.state.eventSequence,
                note_count: this.state.notes.size,
                created_at: this.state.createdAt,
                warnings: [],
            };
        });
    }
    async apply(event) {
        const normalized = normalizeVaultEvent(event);
        const note = normalized.kind === 'create' || normalized.kind === 'modify'
            ? readNoteFromVault(this.vaultRoot, normalized.path)
            : normalized.kind === 'rename'
                ? readNoteFromVault(this.vaultRoot, normalized.newPath)
                : null;
        await this.applyScanned(normalized, note);
    }
    async applySemantic(event) {
        if (event.schemaVersion !== knowledge_note_1.NORMALIZED_VAULT_NOTE_VERSION ||
            !Number.isSafeInteger(event.sequence) ||
            event.sequence <= 0) {
            throw new Error('Vault semantic event must use the current schema and a positive sequence.');
        }
        if (event.kind === 'delete' && event.exists) {
            throw new Error('Delete semantic events must report a missing note.');
        }
        if ((event.kind === 'create' || event.kind === 'modify') && (!event.exists || !event.note)) {
            throw new Error(`${event.kind} semantic events must include the current note.`);
        }
        if (event.kind === 'rename' && !event.newPath) {
            throw new Error('Rename semantic events must include a new path.');
        }
        if (event.kind === 'rename' &&
            event.exists &&
            isMarkdownPath(event.newPath) &&
            !event.note) {
            throw new Error('Markdown rename semantic events must include the current target note.');
        }
        if (event.note && event.contentHash !== event.note.contentHash) {
            throw new Error('Vault semantic event content hash must match its note.');
        }
        const note = event.note ? (0, scan_1.scannedNoteFromNormalized)(event.note, this.vaultRoot) : null;
        const fileVersion = note ? computeFileVersion(note.size, note.modifiedAt) : '';
        const compatibilityEvent = event.kind === 'rename'
            ? {
                kind: 'rename',
                path: event.path,
                newPath: event.newPath,
                fileVersion,
                sequence: event.sequence,
                exists: event.exists,
                contentHash: event.contentHash,
            }
            : {
                kind: event.kind,
                path: event.path,
                fileVersion,
                sequence: event.sequence,
                exists: event.exists,
                contentHash: event.contentHash,
            };
        await this.applyScanned(compatibilityEvent, note);
    }
    async advanceEventSequenceAfterRebuild(sequence) {
        if (!Number.isSafeInteger(sequence) || sequence <= 0) {
            throw new Error('Rebuild event sequence must be a positive safe integer.');
        }
        await this.enqueueWrite(async () => {
            if (sequence > this.state.eventSequence) {
                this.state.eventSequence = sequence;
            }
        });
    }
    async applyScanned(event, note) {
        await this.enqueueWrite(async () => {
            const now = new Date().toISOString();
            const normalized = normalizeVaultEvent(event);
            if (normalized.sequence !== undefined &&
                (!Number.isSafeInteger(normalized.sequence) ||
                    normalized.sequence <= 0 ||
                    normalized.sequence <= this.state.eventSequence)) {
                return;
            }
            let changed = false;
            if (normalized.kind === 'create' || normalized.kind === 'modify') {
                changed = await this.applyCreateOrModify(normalized, note ?? null);
            }
            else if (normalized.kind === 'delete') {
                changed = await this.applyDelete(normalized);
            }
            else {
                changed = await this.applyRename(normalized, note ?? null);
            }
            this.clearRecoveredSourceErrors(normalized, note ?? null);
            if (changed) {
                this.state.lastEvent = {
                    ...normalized,
                    path: normalizeVaultPath(normalized.path),
                };
                this.state.createdAt = now;
                this.state.generation += 1;
                this.state.eventSequence = normalized.sequence ?? this.state.eventSequence + 1;
                this.state.memory = buildMemoryIndex(this.state.notes, this.state.generation, now);
            }
            else if (normalized.sequence !== undefined) {
                this.state.lastEvent = {
                    ...normalized,
                    path: normalizeVaultPath(normalized.path),
                };
                this.state.eventSequence = normalized.sequence;
            }
        });
    }
    async enqueueWrite(task) {
        const next = this.writeChain.then(() => task());
        this.writeChain = next.then(() => {
            return undefined;
        }, () => {
            return undefined;
        });
        return next;
    }
    async readContentForView(generation, catalog, notePath) {
        const normalizedPath = normalizeVaultPath(notePath);
        const note = readNoteFromVault(this.vaultRoot, normalizedPath);
        if (!note)
            return null;
        return {
            generation,
            path: normalizedPath,
            contentHash: note.contentHash,
            content: note.content,
            modifiedAt: note.modifiedAt,
            staleAgainstView: catalog.get(normalizedPath)?.contentHash !== note.contentHash,
        };
    }
    clearRecoveredSourceErrors(event, note) {
        const recoveredPaths = new Set();
        const eventPath = normalizeVaultPath(event.path);
        if (event.kind === 'delete') {
            recoveredPaths.add(eventPath);
        }
        else if (event.kind === 'create' || event.kind === 'modify') {
            if (note &&
                event.exists !== false &&
                normalizeVaultPath(note.relativePath) === eventPath &&
                (!event.contentHash || event.contentHash === note.contentHash)) {
                recoveredPaths.add(eventPath);
            }
        }
        else {
            const targetPath = normalizeVaultPath(event.newPath);
            if (!note && (event.exists === false || !isMarkdownPath(targetPath))) {
                recoveredPaths.add(eventPath);
            }
            else if (note &&
                normalizeVaultPath(note.relativePath) === targetPath &&
                (!event.contentHash || event.contentHash === note.contentHash)) {
                recoveredPaths.add(eventPath);
                recoveredPaths.add(targetPath);
            }
        }
        if (recoveredPaths.size > 0) {
            this.sourceErrors = this.sourceErrors.filter((error) => {
                const errorPath = normalizeScanErrorPath(this.vaultRoot, error.path);
                return !errorPath || !recoveredPaths.has(errorPath);
            });
        }
    }
    applyCreateOrModify(event, suppliedNote) {
        return Promise.resolve().then(() => {
            const normalizedPath = normalizeVaultPath(event.path);
            const existing = this.state.notes.get(normalizedPath);
            const scanned = suppliedNote;
            if (!scanned || event.exists === false) {
                return false;
            }
            if (normalizeVaultPath(scanned.relativePath) !== normalizedPath) {
                return false;
            }
            const indexed = toIndexedKnowledgeNote(scanned);
            if (event.contentHash && indexed.contentHash !== event.contentHash) {
                return false;
            }
            const candidateNotes = new Map(this.state.notes);
            candidateNotes.set(normalizedPath, indexed);
            const resolvedCandidate = resolveIndexedNoteEdges(candidateNotes).get(normalizedPath);
            if (existing && resolvedCandidate && hasSameSemanticState(existing, resolvedCandidate)) {
                return false;
            }
            if (event.sequence === undefined &&
                existing &&
                Date.parse(indexed.modifiedAt) < Date.parse(existing.modifiedAt)) {
                return false;
            }
            const nextNotes = new Map(this.state.notes);
            nextNotes.set(normalizedPath, indexed);
            this.sourceNotes.set(normalizedPath, cloneScannedNote(scanned));
            this.updateIncrementally(nextNotes, existing ?? null, indexed, [normalizedPath]);
            return true;
        });
    }
    applyDelete(event) {
        return Promise.resolve().then(() => {
            const normalizedPath = normalizeVaultPath(event.path);
            const existing = this.state.notes.get(normalizedPath);
            if (!existing) {
                return false;
            }
            const nextNotes = new Map(this.state.notes);
            nextNotes.delete(normalizedPath);
            this.sourceNotes.delete(normalizedPath);
            this.updateIncrementally(nextNotes, existing, null, [normalizedPath]);
            return true;
        });
    }
    applyRename(event, suppliedNote) {
        return Promise.resolve().then(() => {
            const fromPath = normalizeVaultPath(event.path);
            const toPath = normalizeVaultPath(event.newPath);
            const existingSource = this.state.notes.get(fromPath);
            const existingTarget = this.state.notes.get(toPath);
            const scannedTarget = suppliedNote;
            if (!scannedTarget) {
                if (existingSource && (!isMarkdownPath(toPath) || event.exists === false)) {
                    const nextNotes = new Map(this.state.notes);
                    nextNotes.delete(fromPath);
                    this.sourceNotes.delete(fromPath);
                    this.updateRenameDerivedState(nextNotes, existingSource, null, fromPath, toPath);
                    return true;
                }
                return false;
            }
            if (normalizeVaultPath(scannedTarget.relativePath) !== toPath) {
                return false;
            }
            const indexedTarget = toIndexedKnowledgeNote(scannedTarget);
            if (event.contentHash && indexedTarget.contentHash !== event.contentHash) {
                return false;
            }
            if (!existingSource) {
                const candidateNotes = new Map(this.state.notes);
                candidateNotes.set(toPath, indexedTarget);
                const resolvedCandidate = resolveIndexedNoteEdges(candidateNotes).get(toPath);
                if (existingTarget &&
                    resolvedCandidate &&
                    hasSameSemanticState(existingTarget, resolvedCandidate)) {
                    return false;
                }
                if (event.sequence === undefined &&
                    existingTarget &&
                    Date.parse(indexedTarget.modifiedAt) < Date.parse(existingTarget.modifiedAt)) {
                    return false;
                }
            }
            const nextNotes = new Map(this.state.notes);
            if (nextNotes.has(fromPath) && fromPath !== toPath) {
                nextNotes.delete(fromPath);
                this.sourceNotes.delete(fromPath);
            }
            nextNotes.set(toPath, indexedTarget);
            this.sourceNotes.set(toPath, cloneScannedNote(scannedTarget));
            this.updateRenameDerivedState(nextNotes, existingSource ?? existingTarget ?? null, indexedTarget, fromPath, toPath);
            return true;
        });
    }
    updateRenameDerivedState(notes, oldNote, newNote, fromPath, toPath) {
        const affected = collectAffectedSources(this.state.notes, notes, oldNote, newNote, [fromPath, toPath]);
        if (affected.size > this.maxIncrementalRenameImpact) {
            const reason = `rename impact ${affected.size} exceeds limit ${this.maxIncrementalRenameImpact}`;
            this.rebuildDerivedState(notes, {
                mode: 'rename_rebuild_fallback',
                affectedPaths: [...affected].sort(),
                reason,
            });
            this.state.warnings = [`rename_rebuild_fallback:${reason}`];
            return;
        }
        this.updateIncrementally(notes, oldNote, newNote, [fromPath, toPath], affected);
    }
    updateIncrementally(notes, oldNote, newNote, changedPaths, knownAffected) {
        const affected = knownAffected ?? collectAffectedSources(this.state.notes, notes, oldNote, newNote, changedPaths);
        const resolvedNotes = resolveAffectedNoteEdges(notes, affected);
        const graphUpdate = updateKnowledgeGraphIncrementally(this.state.graph, this.state.notes, resolvedNotes, affected);
        const backlinksAffected = new Set([...graphUpdate.affectedTargets, ...changedPaths]);
        for (const notePath of backlinksAffected) {
            const note = resolvedNotes.get(notePath);
            if (note) {
                resolvedNotes.set(notePath, {
                    ...note,
                    backlinks: graphUpdate.graph.incoming.get(notePath) ?? [],
                });
            }
        }
        this.updateCatalogScopesAndPostings(oldNote, newNote, changedPaths);
        this.state.notes = resolvedNotes;
        this.state.graph = graphUpdate.graph;
        this.state.lastUpdate = {
            mode: 'incremental',
            affectedPaths: [...affected].sort(),
            reason: null,
        };
        this.state.warnings = [];
    }
    updateCatalogScopesAndPostings(oldNote, newNote, changedPaths) {
        const catalog = new Map(this.state.catalog);
        const postings = new Map(this.state.lexicalPostings);
        const byType = new Map(this.state.scopes.byType);
        const byTag = new Map(this.state.scopes.byTag);
        if (oldNote) {
            const oldEntry = catalog.get(oldNote.path) ?? toCatalogEntry(oldNote);
            for (const term of oldEntry.searchTokens)
                removePosting(postings, term, oldNote.path);
            removeScopePath(byType, oldNote.type ?? 'untyped', oldNote.path);
            for (const tag of oldNote.tags)
                removeScopePath(byTag, tag, oldNote.path);
            catalog.delete(oldNote.path);
        }
        for (const changedPath of changedPaths) {
            if (!newNote || changedPath !== newNote.path)
                catalog.delete(changedPath);
        }
        if (newNote) {
            const entry = toCatalogEntry(newNote);
            catalog.set(newNote.path, entry);
            for (const term of entry.searchTokens)
                addPosting(postings, term, newNote.path);
            addScopePath(byType, newNote.type ?? 'untyped', newNote.path);
            for (const tag of newNote.tags)
                addScopePath(byTag, tag, newNote.path);
        }
        this.state.catalog = new Map([...catalog].sort(([left], [right]) => left.localeCompare(right)));
        this.state.lexicalPostings = new Map([...postings].sort(([left], [right]) => left.localeCompare(right)));
        this.state.scopes = {
            byType: cloneIndexMap(byType),
            byTag: cloneIndexMap(byTag),
        };
    }
    rebuildDerivedState(notes, update) {
        const resolvedNotes = resolveIndexedNoteEdges(notes);
        const graph = buildKnowledgeGraph(resolvedNotes);
        const withBacklinks = enrichNoteBacklinks(resolvedNotes, graph);
        this.state.notes = withBacklinks;
        this.state.graph = graph;
        this.state.scopes = buildScopeIndex(withBacklinks);
        this.state.catalog = new Map([...withBacklinks].map(([notePath, note]) => [notePath, toCatalogEntry(note)]));
        this.state.lexicalPostings = buildLexicalPostings(this.state.catalog);
        this.state.lastUpdate = update;
        this.sourceNotes = scanNotesByPath([...this.sourceNotes.values()]);
    }
    toMutableState(snapshot) {
        const catalog = new Map([...snapshot.notes].map(([notePath, note]) => [notePath, toCatalogEntry(note)]));
        return {
            notes: new Map(snapshot.notes),
            graph: {
                outgoing: new Map(snapshot.graph.outgoing),
                incoming: new Map(snapshot.graph.incoming),
                edges: snapshot.graph.edges.map(cloneEdge),
                unresolvedEdges: snapshot.graph.unresolvedEdges.map(cloneEdge),
            },
            scopes: {
                byType: new Map(snapshot.scopes.byType),
                byTag: new Map(snapshot.scopes.byTag),
            },
            generation: snapshot.generation,
            eventSequence: snapshot.event_sequence,
            indexState: snapshot.index_state,
            lastEvent: snapshot.last_event,
            lastRebuild: snapshot.last_rebuild,
            createdAt: snapshot.createdAt,
            catalog,
            lexicalPostings: buildLexicalPostings(catalog),
            memory: buildMemoryIndex(snapshot.notes, snapshot.generation, snapshot.createdAt),
            lastUpdate: {
                mode: 'rebuild',
                affectedPaths: [...snapshot.notes.keys()].sort(),
                reason: null,
            },
            warnings: [],
        };
    }
}
exports.InMemoryKnowledgeIndex = InMemoryKnowledgeIndex;
function normalizeRenameImpactLimit(value) {
    if (value === undefined)
        return DEFAULT_MAX_INCREMENTAL_RENAME_IMPACT;
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error('maxIncrementalRenameImpact must be a positive safe integer.');
    }
    return value;
}
function normalizeVaultEvent(event) {
    if (event.kind === 'rename') {
        return {
            ...event,
            path: normalizeVaultPath(event.path),
            newPath: normalizeVaultPath(event.newPath),
        };
    }
    return {
        ...event,
        path: normalizeVaultPath(event.path),
    };
}
function isMarkdownPath(notePath) {
    return NOTES_EXTENSIONS.has(node_path_1.default.posix.extname(notePath).toLowerCase());
}
function normalizeScanErrorPath(vaultRoot, errorPath) {
    try {
        const candidate = node_path_1.default.isAbsolute(errorPath)
            ? node_path_1.default.relative(vaultRoot, errorPath).replace(/\\/g, '/')
            : errorPath;
        return normalizeVaultPath(candidate);
    }
    catch {
        return null;
    }
}
