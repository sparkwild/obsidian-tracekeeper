import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveVaultRoot, ensureInsideVaultRoot } from './safety';
import { scannedNoteFromContent, scanVault, type ScanResult, type ScannedNote } from './scan';

export const KNOWLEDGE_INDEX_VERSION = '1.0';

export type VaultPath = string;
export type FileVersion = string;

export type KnowledgeIndexState = 'initializing' | 'rebuilding' | 'ready';

export type VaultIndexEventKind = 'create' | 'modify' | 'delete' | 'rename';

export interface VaultIndexEventBase {
	path: VaultPath;
	fileVersion: FileVersion;
}

export interface CreateVaultIndexEvent extends VaultIndexEventBase {
	kind: 'create';
}

export interface ModifyVaultIndexEvent extends VaultIndexEventBase {
	kind: 'modify';
}

export interface DeleteVaultIndexEvent extends VaultIndexEventBase {
	kind: 'delete';
}

export interface RenameVaultIndexEvent {
	kind: 'rename';
		path: VaultPath;
	newPath: VaultPath;
	fileVersion: FileVersion;
}

export type VaultIndexEvent = CreateVaultIndexEvent | ModifyVaultIndexEvent | DeleteVaultIndexEvent | RenameVaultIndexEvent;

export interface IndexedWikilink {
	raw: string;
	target: string;
	alias?: string;
	heading?: string;
	line: number;
}

export interface IndexedKnowledgeNote {
	path: VaultPath;
	fileVersion: FileVersion;
	title: string;
	aliases: readonly string[];
	type: string | null;
	tags: readonly string[];
	frontmatter: Readonly<Record<string, unknown>>;
	headings: readonly string[];
	blockIds: readonly string[];
	wikilinks: readonly IndexedWikilink[];
	backlinks: readonly VaultPath[];
	searchTokens: readonly string[];
	excerptSource: string;
	contentHash: string;
	modifiedAt: string;
	size: number;
}

export interface KnowledgeGraphSnapshot {
	outgoing: ReadonlyMap<VaultPath, readonly VaultPath[]>;
	incoming: ReadonlyMap<VaultPath, readonly VaultPath[]>;
}

export interface KnowledgeScopeIndex {
	byType: ReadonlyMap<string, readonly VaultPath[]>;
	byTag: ReadonlyMap<string, readonly VaultPath[]>;
}

export interface KnowledgeSnapshot {
	version: string;
	createdAt: string;
	generation: number;
	index_state: KnowledgeIndexState;
	notes: ReadonlyMap<VaultPath, IndexedKnowledgeNote>;
	graph: KnowledgeGraphSnapshot;
	scopes: KnowledgeScopeIndex;
	last_event: VaultIndexEvent | null;
	last_rebuild: string | null;
}

export interface KnowledgeIndexReport {
	index_state: KnowledgeIndexState;
	generation: number;
	note_count: number;
	created_at: string;
	warnings: readonly string[];
}

export interface KnowledgeIndex {
	snapshot(): Promise<KnowledgeSnapshot>;
	scanSnapshot(): ScanResult;
	rebuild(scanResult?: ScanResult): Promise<KnowledgeIndexReport>;
	apply(event: VaultIndexEvent): Promise<void>;
	applyScanned(event: VaultIndexEvent, note?: ScannedNote | null): Promise<void>;
}

export interface KnowledgeIndexOptions {
	vaultRoot: string;
	vaultConfigDir?: string;
	initialScan?: ScanResult;
}

interface InternalKnowledgeState {
	notes: Map<VaultPath, IndexedKnowledgeNote>;
	graph: KnowledgeGraphSnapshot;
	scopes: KnowledgeScopeIndex;
	generation: number;
	indexState: KnowledgeIndexState;
	lastEvent: VaultIndexEvent | null;
	lastRebuild: string | null;
	createdAt: string;
}

const NOTES_EXTENSIONS = new Set(['.md', '.markdown']);
const SNIPPET_MAX_LENGTH = 160;

const DEFAULT_INITIAL_STATE: InternalKnowledgeState = {
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

export function computeFileVersion(size: number, modifiedAt: string): FileVersion {
	return `${modifiedAt}|${size}`;
}

export function toIndexedKnowledgeNote(note: ScannedNote): IndexedKnowledgeNote {
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
		contentHash: createHash('sha256').update(note.content, 'utf8').digest('hex'),
		modifiedAt: note.modifiedAt,
		size: note.size,
	};
}

function normalizeVaultPath(value: string): string {
	return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/g, '');
}

function cloneIndexMap<T>(input: ReadonlyMap<string, readonly T[]>): ReadonlyMap<string, readonly T[]> {
	const cloned = new Map<string, readonly T[]>();
	for (const [key, values] of input.entries()) {
		cloned.set(key, [...values]);
	}
	return cloned;
}

function cloneNote(note: IndexedKnowledgeNote): IndexedKnowledgeNote {
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

function cloneScannedNote(note: ScannedNote): ScannedNote {
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

function scanNotesByPath(notes: readonly ScannedNote[]): Map<VaultPath, ScannedNote> {
	return new Map(notes.map((note) => [normalizeVaultPath(note.relativePath), cloneScannedNote(note)]));
}

function snapshotToReadonly(state: InternalKnowledgeState): KnowledgeSnapshot {
	return {
		version: KNOWLEDGE_INDEX_VERSION,
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

function mergeAndSortUnique(items: readonly string[]): string[] {
	return [...new Set(items)].sort();
}

function buildKnowledgeGraph(notes: ReadonlyMap<VaultPath, IndexedKnowledgeNote>): KnowledgeGraphSnapshot {
	const outgoing = new Map<string, Set<string>>();
	const incoming = new Map<string, Set<string>>();

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
		outgoing: cloneIndexMap(
			new Map(
				Array.from(outgoing.entries()).map(([fromPath, toPaths]) => [fromPath, mergeAndSortUnique(Array.from(toPaths))])
			)
		),
		incoming: cloneIndexMap(
			new Map(
				Array.from(incoming.entries()).map(([toPath, fromPaths]) => [toPath, mergeAndSortUnique(Array.from(fromPaths))])
			)
		),
	};
}

function buildScopeIndex(notes: ReadonlyMap<VaultPath, IndexedKnowledgeNote>): KnowledgeScopeIndex {
	const byType = new Map<string, Set<string>>();
	const byTag = new Map<string, Set<string>>();

	for (const [notePath, note] of notes.entries()) {
		const typeKey = note.type ?? 'untyped';
		if (!byType.has(typeKey)) {
			byType.set(typeKey, new Set());
		}
		byType.get(typeKey)!.add(notePath);

		for (const tag of note.tags) {
			if (!byTag.has(tag)) {
				byTag.set(tag, new Set());
			}
			byTag.get(tag)!.add(notePath);
		}
	}

	const byTypeMap = new Map<string, readonly string[]>(
		Array.from(byType.entries()).map(([type, paths]) => [type, mergeAndSortUnique(Array.from(paths))])
	);
	const byTagMap = new Map<string, readonly string[]>(
		Array.from(byTag.entries()).map(([tag, paths]) => [tag, mergeAndSortUnique(Array.from(paths))])
	);

	return {
		byType: cloneIndexMap(byTypeMap),
		byTag: cloneIndexMap(byTagMap),
	};
}

function readNoteFromVault(vaultRoot: string, notePath: VaultPath): ScannedNote | null {
	const normalized = normalizeVaultPath(notePath);
	if (!normalized) {
		return null;
	}

	const candidate = ensureInsideVaultRoot(vaultRoot, path.join(vaultRoot, normalized));
	let lstat: fs.Stats;
	let stat: fs.Stats;
	try {
		lstat = fs.lstatSync(candidate);
		stat = fs.statSync(candidate);
	} catch (error) {
		if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
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

	const extension = path.extname(candidate).toLowerCase();
	if (!NOTES_EXTENSIONS.has(extension)) {
		return null;
	}

	const fileContent = fs.readFileSync(candidate, 'utf8');
	return scannedNoteFromContent({
		absolutePath: candidate,
		relativePath: normalized,
		fallbackTitle: path.basename(candidate, extension),
		size: stat.size,
		modifiedAt: stat.mtime.toISOString(),
		content: fileContent,
	});
}

export function buildKnowledgeSnapshot(scanResult: ScanResult, options: { indexState?: KnowledgeIndexState; generation?: number; lastEvent?: VaultIndexEvent | null; lastRebuild?: string | null } = {}): KnowledgeSnapshot {
	const notesByPath = new Map<string, IndexedKnowledgeNote>();
	for (const scannedNote of scanResult.notes) {
		notesByPath.set(scannedNote.relativePath, toIndexedKnowledgeNote(scannedNote));
	}

	const graph = buildKnowledgeGraph(notesByPath);
	const scopes = buildScopeIndex(notesByPath);
	const notes = new Map<string, IndexedKnowledgeNote>();
	for (const [notePath, note] of notesByPath.entries()) {
		const backlinks = graph.incoming.get(notePath) ?? [];
		notes.set(notePath, {
			...note,
			backlinks,
		});
	}

	return {
		version: KNOWLEDGE_INDEX_VERSION,
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

function rebuildFromState(
	vaultRoot: string,
	vaultConfigDir: string | undefined,
	existingScan: ScanResult | null
): { notes: Map<VaultPath, IndexedKnowledgeNote>; graph: KnowledgeGraphSnapshot; scopes: KnowledgeScopeIndex; lastRebuild: string } {
	const scanResult = existingScan ? existingScan : scanVault(vaultRoot, vaultConfigDir ? { vaultConfigDir } : {});
	const snapshot = buildKnowledgeSnapshot(scanResult, { indexState: 'ready', generation: 0, lastEvent: null, lastRebuild: scanResult.scannedAt });

	return {
		notes: new Map(snapshot.notes),
		graph: snapshot.graph,
		scopes: snapshot.scopes,
		lastRebuild: snapshot.createdAt,
	};
}

function enrichNoteBacklinks(
	notes: Map<VaultPath, IndexedKnowledgeNote>,
	graph: KnowledgeGraphSnapshot
): Map<VaultPath, IndexedKnowledgeNote> {
	const enriched = new Map<VaultPath, IndexedKnowledgeNote>();

	for (const [notePath, note] of notes.entries()) {
		enriched.set(notePath, {
			...note,
			backlinks: graph.incoming.get(notePath) ?? [],
		});
	}

	return enriched;
}

export class InMemoryKnowledgeIndex implements KnowledgeIndex {
	private readonly vaultRoot: string;
	private readonly vaultConfigDir?: string;
	private state: InternalKnowledgeState;
	private sourceNotes = new Map<VaultPath, ScannedNote>();
	private sourceErrors: ScanResult['errors'] = [];
	private writeChain: Promise<void> = Promise.resolve();

	constructor(options: KnowledgeIndexOptions) {
		this.vaultRoot = resolveVaultRoot(options.vaultRoot);
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

	async snapshot(): Promise<KnowledgeSnapshot> {
		return snapshotToReadonly(this.state);
	}

	scanSnapshot(): ScanResult {
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

	async rebuild(scanResult?: ScanResult): Promise<KnowledgeIndexReport> {
		return this.enqueueWrite(async () => {
			this.state = {
				...this.state,
				indexState: 'rebuilding',
				createdAt: new Date().toISOString(),
			};
			const sourceScan = scanResult ?? scanVault(this.vaultRoot, this.vaultConfigDir ? { vaultConfigDir: this.vaultConfigDir } : {});
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

	async apply(event: VaultIndexEvent): Promise<void> {
		const normalized = normalizeVaultEvent(event);
		const note = normalized.kind === 'create' || normalized.kind === 'modify'
			? readNoteFromVault(this.vaultRoot, normalized.path)
			: normalized.kind === 'rename'
				? readNoteFromVault(this.vaultRoot, normalized.newPath)
				: null;
		await this.applyScanned(normalized, note);
	}

	async applyScanned(event: VaultIndexEvent, note?: ScannedNote | null): Promise<void> {
		await this.enqueueWrite(async () => {
			const now = new Date().toISOString();
			const normalized = normalizeVaultEvent(event);

			let changed = false;
			if (normalized.kind === 'create' || normalized.kind === 'modify') {
				changed = await this.applyCreateOrModify(normalized, note ?? null);
			} else if (normalized.kind === 'delete') {
				changed = await this.applyDelete(normalized);
			} else {
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

	private async enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
		const next = this.writeChain.then(() => task());
		this.writeChain = next.then(
			() => {
				return undefined;
			},
			() => {
				return undefined;
			}
		);
		return next;
	}

	private applyCreateOrModify(event: CreateVaultIndexEvent | ModifyVaultIndexEvent, suppliedNote: ScannedNote | null): Promise<boolean> {
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

	private applyDelete(event: DeleteVaultIndexEvent): Promise<boolean> {
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

	private applyRename(event: RenameVaultIndexEvent, suppliedNote: ScannedNote | null): Promise<boolean> {
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

	private toMutableState(snapshot: KnowledgeSnapshot): InternalKnowledgeState {
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

function normalizeVaultEvent(event: VaultIndexEvent): VaultIndexEvent {
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
