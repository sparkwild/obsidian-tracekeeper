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
const node_util_1 = require("node:util");
const safety_1 = require("./safety");
const scan_1 = require("./scan");
const knowledge_note_1 = require("./knowledge-note");
exports.KNOWLEDGE_INDEX_VERSION = '1.0';
const NOTES_EXTENSIONS = new Set(['.md', '.markdown']);
const SNIPPET_MAX_LENGTH = 160;
const DEFAULT_INITIAL_STATE = {
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
    createdAt: new Date().toISOString(),
};
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
    for (const [key, values] of input.entries()) {
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
            if (link.resolution.status !== 'resolved'
                || (!notes.has(link.resolution.path)
                    && link.resolution.authority !== 'native')) {
                unresolvedEdges.push(link.resolution.status === 'resolved'
                    ? {
                        ...cloneEdge(link),
                        resolution: {
                            status: 'unresolved',
                            reason: 'not_found',
                            authority: link.resolution.authority,
                        },
                    }
                    : cloneEdge(link));
                continue;
            }
            const target = link.resolution.path;
            const outgoingTargets = outgoing.get(notePath);
            if (!outgoingTargets) {
                continue;
            }
            edges.push(cloneEdge(link));
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
class InMemoryKnowledgeIndex {
    constructor(options) {
        this.sourceNotes = new Map();
        this.sourceErrors = [];
        this.writeChain = Promise.resolve();
        this.vaultRoot = (0, safety_1.resolveVaultRoot)(options.vaultRoot);
        this.vaultConfigDir = options.vaultConfigDir;
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
            createdAt: new Date().toISOString(),
        };
        if (options.initialScan) {
            const snapshot = buildKnowledgeSnapshot(options.initialScan, {
                indexState: 'ready',
                generation: 1,
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
            this.state = {
                notes: withBacklinks,
                graph,
                scopes,
                generation,
                eventSequence: this.state.eventSequence,
                indexState: 'ready',
                lastEvent: this.state.lastEvent,
                lastRebuild: built.lastRebuild,
                createdAt: new Date().toISOString(),
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
            this.updateDerivedState(nextNotes);
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
            this.updateDerivedState(nextNotes);
            return true;
        });
    }
    applyRename(event, suppliedNote) {
        return Promise.resolve().then(() => {
            const fromPath = normalizeVaultPath(event.path);
            const toPath = normalizeVaultPath(event.newPath);
            const existingSource = this.state.notes.get(fromPath);
            const scannedTarget = suppliedNote;
            if (!scannedTarget) {
                if (existingSource && (!isMarkdownPath(toPath) || event.exists === false)) {
                    const nextNotes = new Map(this.state.notes);
                    nextNotes.delete(fromPath);
                    this.sourceNotes.delete(fromPath);
                    this.updateDerivedState(nextNotes);
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
                const existingTarget = this.state.notes.get(toPath);
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
            this.updateDerivedState(nextNotes);
            return true;
        });
    }
    updateDerivedState(notes) {
        const resolvedNotes = resolveIndexedNoteEdges(notes);
        const graph = buildKnowledgeGraph(resolvedNotes);
        const withBacklinks = enrichNoteBacklinks(resolvedNotes, graph);
        this.state.notes = withBacklinks;
        this.state.graph = graph;
        this.state.scopes = buildScopeIndex(withBacklinks);
        this.sourceNotes = scanNotesByPath([...this.sourceNotes.values()]);
    }
    toMutableState(snapshot) {
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
        };
    }
}
exports.InMemoryKnowledgeIndex = InMemoryKnowledgeIndex;
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
