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
const safety_1 = require("./safety");
const scan_1 = require("./scan");
exports.KNOWLEDGE_INDEX_VERSION = '1.0';
const NOTES_EXTENSIONS = new Set(['.md', '.markdown']);
const SNIPPET_MAX_LENGTH = 160;
const DEFAULT_INITIAL_STATE = {
    notes: new Map(),
    graph: {
        outgoing: new Map(),
        incoming: new Map(),
    },
    scopes: {
        byType: new Map(),
        byTag: new Map(),
    },
    generation: 0,
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
        path: note.relativePath,
        fileVersion: computeFileVersion(note.size, note.modifiedAt),
        title: note.title,
        aliases: note.aliases,
        type: note.type ?? null,
        tags: note.tags,
        frontmatter: { ...note.frontmatter },
        headings: [...note.headings],
        blockIds: [...note.blockIds],
        wikilinks: note.wikilinks.map((item) => ({ ...item })),
        backlinks: [],
        searchTokens: note.tokens.split(/\s+/).filter(Boolean),
        excerptSource: note.content.slice(0, SNIPPET_MAX_LENGTH).trim(),
        contentHash: (0, node_crypto_1.createHash)('sha256').update(note.content, 'utf8').digest('hex'),
        modifiedAt: note.modifiedAt,
        size: note.size,
    };
}
function normalizeVaultPath(value) {
    return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/g, '');
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
        frontmatter: { ...note.frontmatter },
        headings: [...note.headings],
        blockIds: [...note.blockIds],
        wikilinks: note.wikilinks.map((item) => ({ ...item })),
        backlinks: [...note.backlinks],
        searchTokens: [...note.searchTokens],
    };
}
function cloneScannedNote(note) {
    return {
        ...note,
        frontmatter: { ...note.frontmatter },
        aliases: [...note.aliases],
        tags: [...note.tags],
        headings: [...note.headings],
        blockIds: [...note.blockIds],
        wikilinks: note.wikilinks.map((item) => ({ ...item })),
        claimBlocks: note.claimBlocks.map((item) => ({ ...item })),
        evidenceBlocks: note.evidenceBlocks.map((item) => ({ ...item })),
    };
}
function scanNotesByPath(notes) {
    return new Map(notes.map((note) => [normalizeVaultPath(note.relativePath), cloneScannedNote(note)]));
}
function snapshotToReadonly(state) {
    return {
        version: exports.KNOWLEDGE_INDEX_VERSION,
        createdAt: state.createdAt,
        generation: state.generation,
        index_state: state.indexState,
        notes: new Map(Array.from(state.notes.entries()).map(([notePath, note]) => [notePath, cloneNote(note)])),
        graph: {
            outgoing: cloneIndexMap(state.graph.outgoing),
            incoming: cloneIndexMap(state.graph.incoming),
        },
        scopes: {
            byType: cloneIndexMap(state.scopes.byType),
            byTag: cloneIndexMap(state.scopes.byTag),
        },
        last_event: state.lastEvent ? { ...state.lastEvent } : null,
        last_rebuild: state.lastRebuild,
    };
}
function mergeAndSortUnique(items) {
    return [...new Set(items)].sort();
}
function buildKnowledgeGraph(notes) {
    const outgoing = new Map();
    const incoming = new Map();
    for (const notePath of notes.keys()) {
        outgoing.set(notePath, new Set());
        incoming.set(notePath, new Set());
    }
    for (const [notePath, note] of notes.entries()) {
        for (const link of note.wikilinks) {
            const target = normalizeVaultPath(link.target);
            if (!target) {
                continue;
            }
            const outgoingTargets = outgoing.get(notePath);
            if (!outgoingTargets) {
                continue;
            }
            outgoingTargets.add(target);
            let backlinksForTarget = incoming.get(target);
            if (!backlinksForTarget) {
                backlinksForTarget = new Set();
                incoming.set(target, backlinksForTarget);
            }
            backlinksForTarget.add(notePath);
            if (!notes.has(target)) {
                outgoingTargets.delete(target);
            }
        }
    }
    return {
        outgoing: cloneIndexMap(new Map(Array.from(outgoing.entries()).map(([fromPath, toPaths]) => [fromPath, mergeAndSortUnique(Array.from(toPaths))]))),
        incoming: cloneIndexMap(new Map(Array.from(incoming.entries()).map(([toPath, fromPaths]) => [toPath, mergeAndSortUnique(Array.from(fromPaths))]))),
    };
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
    for (const scannedNote of scanResult.notes) {
        notesByPath.set(scannedNote.relativePath, toIndexedKnowledgeNote(scannedNote));
    }
    const graph = buildKnowledgeGraph(notesByPath);
    const scopes = buildScopeIndex(notesByPath);
    const notes = new Map();
    for (const [notePath, note] of notesByPath.entries()) {
        const backlinks = graph.incoming.get(notePath) ?? [];
        notes.set(notePath, {
            ...note,
            backlinks,
        });
    }
    return {
        version: exports.KNOWLEDGE_INDEX_VERSION,
        createdAt: scanResult.scannedAt,
        generation: options.generation ?? 0,
        index_state: options.indexState ?? 'ready',
        notes,
        graph: {
            outgoing: cloneIndexMap(graph.outgoing),
            incoming: cloneIndexMap(graph.incoming),
        },
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
            },
            scopes: {
                byType: new Map(),
                byTag: new Map(),
            },
            generation: 0,
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
            const graph = {
                outgoing: cloneIndexMap(built.graph.outgoing),
                incoming: cloneIndexMap(built.graph.incoming),
            };
            const generation = this.state.generation + 1;
            this.state = {
                notes: withBacklinks,
                graph: graph,
                scopes,
                generation,
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
    async applyScanned(event, note) {
        await this.enqueueWrite(async () => {
            const now = new Date().toISOString();
            const normalized = normalizeVaultEvent(event);
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
            if (changed) {
                this.state.lastEvent = {
                    ...normalized,
                    path: normalizeVaultPath(normalized.path),
                };
                this.state.createdAt = now;
                this.state.generation += 1;
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
    applyCreateOrModify(event, suppliedNote) {
        return Promise.resolve().then(() => {
            const normalizedPath = normalizeVaultPath(event.path);
            const existing = this.state.notes.get(normalizedPath);
            if (existing && event.fileVersion && existing.fileVersion === event.fileVersion) {
                return false;
            }
            const scanned = suppliedNote;
            if (!scanned) {
                return false;
            }
            const indexed = toIndexedKnowledgeNote(scanned);
            if (event.fileVersion && indexed.fileVersion !== event.fileVersion) {
                if (existing && existing.fileVersion === indexed.fileVersion) {
                    return false;
                }
                return false;
            }
            if (existing && existing.fileVersion === indexed.fileVersion) {
                return false;
            }
            if (existing && Date.parse(indexed.modifiedAt) < Date.parse(existing.modifiedAt)) {
                return false;
            }
            const nextNotes = new Map(this.state.notes);
            nextNotes.set(normalizedPath, indexed);
            this.sourceNotes.set(normalizedPath, cloneScannedNote(scanned));
            const graph = buildKnowledgeGraph(nextNotes);
            const nextWithBacklinks = enrichNoteBacklinks(nextNotes, graph);
            this.state.notes = nextWithBacklinks;
            this.state.graph = graph;
            this.state.scopes = buildScopeIndex(nextWithBacklinks);
            this.state.lastEvent = {
                kind: event.kind,
                path: normalizedPath,
                fileVersion: indexed.fileVersion,
            };
            this.state.createdAt = new Date().toISOString();
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
            if (event.fileVersion && existing.fileVersion !== event.fileVersion) {
                return false;
            }
            const nextNotes = new Map(this.state.notes);
            nextNotes.delete(normalizedPath);
            this.sourceNotes.delete(normalizedPath);
            const graph = buildKnowledgeGraph(nextNotes);
            const nextWithBacklinks = enrichNoteBacklinks(nextNotes, graph);
            this.state.notes = nextWithBacklinks;
            this.state.graph = graph;
            this.state.scopes = buildScopeIndex(nextWithBacklinks);
            this.state.lastEvent = {
                kind: 'delete',
                path: normalizedPath,
                fileVersion: existing.fileVersion,
            };
            this.state.createdAt = new Date().toISOString();
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
                return false;
            }
            const indexedTarget = toIndexedKnowledgeNote(scannedTarget);
            if (event.fileVersion && indexedTarget.fileVersion !== event.fileVersion) {
                if (this.state.notes.get(toPath)?.fileVersion === event.fileVersion) {
                    return false;
                }
                return false;
            }
            if (!existingSource) {
                const existingTarget = this.state.notes.get(toPath);
                if (existingTarget && existingTarget.fileVersion === indexedTarget.fileVersion) {
                    return false;
                }
                if (existingTarget && Date.parse(indexedTarget.modifiedAt) < Date.parse(existingTarget.modifiedAt)) {
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
            const graph = buildKnowledgeGraph(nextNotes);
            const nextWithBacklinks = enrichNoteBacklinks(nextNotes, graph);
            this.state.notes = nextWithBacklinks;
            this.state.graph = graph;
            this.state.scopes = buildScopeIndex(nextWithBacklinks);
            this.state.lastEvent = {
                kind: 'rename',
                path: fromPath,
                newPath: toPath,
                fileVersion: indexedTarget.fileVersion,
            };
            this.state.createdAt = new Date().toISOString();
            return true;
        });
    }
    toMutableState(snapshot) {
        return {
            notes: new Map(snapshot.notes),
            graph: {
                outgoing: new Map(snapshot.graph.outgoing),
                incoming: new Map(snapshot.graph.incoming),
            },
            scopes: {
                byType: new Map(snapshot.scopes.byType),
                byTag: new Map(snapshot.scopes.byTag),
            },
            generation: snapshot.generation,
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
            kind: 'rename',
            path: normalizeVaultPath(event.path),
            newPath: normalizeVaultPath(event.newPath),
            fileVersion: event.fileVersion,
        };
    }
    return {
        ...event,
        path: normalizeVaultPath(event.path),
    };
}
