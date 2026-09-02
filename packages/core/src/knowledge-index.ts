import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { resolveVaultRoot, ensureInsideVaultRoot } from './safety';
import {
	resolveScannedNoteEdges,
	scannedNoteFromNormalized,
	scannedNoteFromContent,
	scanVault,
	type ScanResult,
	type ScannedNote,
} from './scan';
import {
	cloneVaultFrontmatter,
	NORMALIZED_VAULT_NOTE_VERSION,
	normalizeVaultRelativePath,
	resolveNormalizedVaultEdges,
	type NormalizedVaultCallout,
	type NormalizedVaultEdge,
	type NormalizedVaultNote,
	type NormalizedVaultSection,
	type VaultSemanticEvent,
} from './knowledge-note';
import {
	legacyMemoryToReadProjection,
	parseMemoryRecord,
	projectMemoryEntryToReadProjection,
	type MemoryRecord,
	type MemoryRecordReadProjection,
} from './memory-record';
import { resolveMemoryLifecycle, type MemoryLifecycleProjection } from './memory-lifecycle';
import { classifyProjectMemoryNote } from './project-memory';
import {
	KNOWLEDGE_GLOBAL_MEMORY_DIR,
	LEGACY_MEMORY_DIRS,
} from './knowledge-architecture';
import {
	parseManagedRelationsBlock,
	readManagedWikiRelations,
	type WikiRole,
} from './wiki-governance';

export const KNOWLEDGE_INDEX_VERSION = '1.0';

export type VaultPath = string;
export type FileVersion = string;

export type KnowledgeIndexState = 'initializing' | 'rebuilding' | 'ready';

export type VaultIndexEventKind = 'create' | 'modify' | 'delete' | 'rename';

export interface VaultIndexEventBase {
	path: VaultPath;
	fileVersion: FileVersion;
	sequence?: number;
	exists?: boolean;
	contentHash?: string;
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
	sequence?: number;
	exists?: boolean;
	contentHash?: string;
}

export type VaultIndexEvent = CreateVaultIndexEvent | ModifyVaultIndexEvent | DeleteVaultIndexEvent | RenameVaultIndexEvent;

export type IndexedWikilink = NormalizedVaultEdge;

export interface IndexedKnowledgeNote extends NormalizedVaultNote {
	path: VaultPath;
	fileVersion: FileVersion;
	type: string | null;
	wikilinks: readonly IndexedWikilink[];
	backlinks: readonly VaultPath[];
	searchTokens: readonly string[];
	excerptSource: string;
}

export interface KnowledgeGraphSnapshot {
	outgoing: ReadonlyMap<VaultPath, readonly VaultPath[]>;
	incoming: ReadonlyMap<VaultPath, readonly VaultPath[]>;
	edges: readonly NormalizedVaultEdge[];
	unresolvedEdges: readonly NormalizedVaultEdge[];
}

export interface KnowledgeScopeIndex {
	byType: ReadonlyMap<string, readonly VaultPath[]>;
	byTag: ReadonlyMap<string, readonly VaultPath[]>;
}

export interface KnowledgeCatalogEntry {
	path: VaultPath;
	fileVersion: FileVersion;
	contentHash: string;
	frontmatterHash: string;
	frontmatter: Readonly<Record<string, unknown>>;
	title: string;
	aliases: readonly string[];
	type: string | null;
	tags: readonly string[];
	searchTokens: readonly string[];
	excerpt: string;
	modifiedAt: string;
	size: number;
	managedRelationsStatus: 'missing' | 'valid' | 'invalid';
	managedRelationsSchemaVersion: 1 | 2 | null;
	wikiRole: WikiRole | 'unknown';
	managedParent: string | null;
	managedSources: readonly string[];
	managedRelated: readonly string[];
}

export interface KnowledgeLexicalIndex {
	postings: ReadonlyMap<string, readonly VaultPath[]>;
}

export interface KnowledgeMemoryIndex {
	byId: ReadonlyMap<string, MemoryRecord>;
	byClaimKey: ReadonlyMap<string, readonly string[]>;
	lifecycle: MemoryLifecycleProjection;
	invalidPaths: readonly VaultPath[];
}

export interface KnowledgeIndexUpdate {
	mode: 'rebuild' | 'incremental' | 'rename_rebuild_fallback';
	affectedPaths: readonly VaultPath[];
	reason: string | null;
}

export interface KnowledgeContentRead {
	generation: number;
	path: VaultPath;
	contentHash: string;
	content: string;
	modifiedAt: string;
	staleAgainstView: boolean;
}

export interface KnowledgeContentReader {
	readonly generation: number;
	read(notePath: VaultPath): Promise<KnowledgeContentRead | null>;
}

export interface KnowledgeReadView {
	version: string;
	source: 'index' | 'filesystem_scan';
	createdAt: string;
	generation: number;
	event_sequence: number;
	index_state: KnowledgeIndexState;
	catalog: ReadonlyMap<VaultPath, KnowledgeCatalogEntry>;
	graph: KnowledgeGraphSnapshot;
	scopes: KnowledgeScopeIndex;
	lexical: KnowledgeLexicalIndex;
	memory: KnowledgeMemoryIndex;
	last_update: KnowledgeIndexUpdate;
	warnings: readonly string[];
	errors: ReadonlyArray<ScanResult['errors'][number]>;
	contentReader: KnowledgeContentReader;
}

export interface KnowledgeSnapshot {
	version: string;
	createdAt: string;
	generation: number;
	event_sequence: number;
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
	event_sequence: number;
	note_count: number;
	created_at: string;
	warnings: readonly string[];
}

export interface KnowledgeIndex {
	snapshot(): Promise<KnowledgeSnapshot>;
	readView(): Promise<KnowledgeReadView>;
	scanSnapshot(): ScanResult;
	rebuild(scanResult?: ScanResult): Promise<KnowledgeIndexReport>;
	apply(event: VaultIndexEvent): Promise<void>;
	applyScanned(event: VaultIndexEvent, note?: ScannedNote | null): Promise<void>;
	applySemantic(event: VaultSemanticEvent): Promise<void>;
}

export interface KnowledgeIndexOptions {
	vaultRoot: string;
	vaultConfigDir?: string;
	initialScan?: ScanResult;
	maxIncrementalRenameImpact?: number;
}

interface InternalKnowledgeState {
	notes: Map<VaultPath, IndexedKnowledgeNote>;
	graph: KnowledgeGraphSnapshot;
	scopes: KnowledgeScopeIndex;
	generation: number;
	eventSequence: number;
	indexState: KnowledgeIndexState;
	lastEvent: VaultIndexEvent | null;
	lastRebuild: string | null;
	createdAt: string;
	catalog: Map<VaultPath, KnowledgeCatalogEntry>;
	lexicalPostings: Map<string, readonly VaultPath[]>;
	memory: KnowledgeMemoryIndex;
	lastUpdate: KnowledgeIndexUpdate;
	warnings: string[];
}

const NOTES_EXTENSIONS = new Set(['.md', '.markdown']);
const SNIPPET_MAX_LENGTH = 160;
const MAX_LEXICAL_TERMS_PER_NOTE = 512;
const DEFAULT_MAX_INCREMENTAL_RENAME_IMPACT = 256;

export function computeFileVersion(size: number, modifiedAt: string): FileVersion {
	return `${modifiedAt}|${size}`;
}

export function toIndexedKnowledgeNote(note: ScannedNote): IndexedKnowledgeNote {
	return {
		schemaVersion: NORMALIZED_VAULT_NOTE_VERSION,
		path: note.relativePath,
		exists: note.exists,
		fileVersion: computeFileVersion(note.size, note.modifiedAt),
		title: note.title,
		aliases: [...note.aliases],
		type: note.type ?? null,
		tags: [...note.tags],
		frontmatter: cloneVaultFrontmatter(note.frontmatter),
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

function normalizeVaultPath(value: string): string {
	return normalizeVaultRelativePath(value);
}

function cloneIndexMap<T>(input: ReadonlyMap<string, readonly T[]>): ReadonlyMap<string, readonly T[]> {
	const cloned = new Map<string, readonly T[]>();
	for (const [key, values] of [...input.entries()].sort(([left], [right]) => left.localeCompare(right))) {
		cloned.set(key, [...values]);
	}
	return cloned;
}

function cloneNote(note: IndexedKnowledgeNote): IndexedKnowledgeNote {
	return {
		...note,
		aliases: [...note.aliases],
		tags: [...note.tags],
		frontmatter: cloneVaultFrontmatter(note.frontmatter),
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

function hasSameSemanticState(left: IndexedKnowledgeNote, right: IndexedKnowledgeNote): boolean {
	return isDeepStrictEqual(
		{
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
		},
		{
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
		}
	);
}

function cloneScannedNote(note: ScannedNote): ScannedNote {
	return {
		...note,
		frontmatter: cloneVaultFrontmatter(note.frontmatter),
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

function scanNotesByPath(notes: readonly ScannedNote[]): Map<VaultPath, ScannedNote> {
	return new Map(
		resolveScannedNoteEdges(notes).map((note) => [
			normalizeVaultPath(note.relativePath),
			cloneScannedNote(note),
		])
	);
}

function cloneEdge<T extends NormalizedVaultEdge>(edge: T): T {
	return {
		...edge,
		position: {
			start: { ...edge.position.start },
			end: { ...edge.position.end },
		},
		resolution: { ...edge.resolution },
	};
}

function cloneSection<T extends NormalizedVaultSection>(section: T): T {
	return {
		...section,
		position: {
			start: { ...section.position.start },
			end: { ...section.position.end },
		},
	};
}

function cloneCallout<T extends NormalizedVaultCallout>(callout: T): T {
	return {
		...callout,
		sourceRefs: [...callout.sourceRefs],
		position: {
			start: { ...callout.position.start },
			end: { ...callout.position.end },
		},
	};
}

function snapshotToReadonly(state: InternalKnowledgeState): KnowledgeSnapshot {
	return {
		version: KNOWLEDGE_INDEX_VERSION,
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

function cloneGraph(graph: KnowledgeGraphSnapshot): KnowledgeGraphSnapshot {
	return {
		outgoing: cloneIndexMap(graph.outgoing),
		incoming: cloneIndexMap(graph.incoming),
		edges: graph.edges.map(cloneEdge),
		unresolvedEdges: graph.unresolvedEdges.map(cloneEdge),
	};
}

function mergeAndSortUnique(items: readonly string[]): string[] {
	return [...new Set(items)].sort();
}

function buildKnowledgeGraph(notes: ReadonlyMap<VaultPath, IndexedKnowledgeNote>): KnowledgeGraphSnapshot {
	const outgoing = new Map<string, Set<string>>();
	const incoming = new Map<string, Set<string>>();
	const edges: NormalizedVaultEdge[] = [];
	const unresolvedEdges: NormalizedVaultEdge[] = [];

	for (const notePath of notes.keys()) {
		outgoing.set(notePath, new Set());
		incoming.set(notePath, new Set());
	}

	for (const [notePath, note] of notes.entries()) {
		for (const link of note.edges) {
			const sourcedLink = { ...cloneEdge(link), sourcePath: link.sourcePath ?? notePath };
			if (
				link.resolution.status !== 'resolved'
				|| (
					!notes.has(link.resolution.path)
					&& link.resolution.authority !== 'native'
				)
			) {
				unresolvedEdges.push(
					link.resolution.status === 'resolved'
						? {
								...sourcedLink,
								resolution: {
									status: 'unresolved',
									reason: 'not_found',
									authority: link.resolution.authority,
								},
						  }
						: sourcedLink
				);
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
			} else {
				incoming.set(target, new Set([notePath]));
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
		edges: edges.sort(compareGraphEdges),
		unresolvedEdges: unresolvedEdges.sort(compareGraphEdges),
	};
}

function compareGraphEdges(left: NormalizedVaultEdge, right: NormalizedVaultEdge): number {
	return (
		(left.sourcePath ?? '').localeCompare(right.sourcePath ?? '') ||
		left.position.start.offset - right.position.start.offset ||
		left.raw.localeCompare(right.raw)
	);
}

function resolveIndexedNoteEdges(
	notes: ReadonlyMap<VaultPath, IndexedKnowledgeNote>
): Map<VaultPath, IndexedKnowledgeNote> {
	const resolved = resolveNormalizedVaultEdges(
		Array.from(notes.values()).map((note) => ({
			path: note.path,
			title: note.title,
			aliases: note.aliases,
			edges: note.edges,
		}))
	);
	const result = new Map<VaultPath, IndexedKnowledgeNote>();
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

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

function frontmatterHash(frontmatter: Readonly<Record<string, unknown>>): string {
	return createHash('sha256').update(stableJson(frontmatter), 'utf8').digest('hex');
}

function lexicalTerms(note: IndexedKnowledgeNote): string[] {
	const terms = new Set<string>();
	const add = (value: string): void => {
		const normalized = value.normalize('NFC').trim().toLocaleLowerCase('en-US');
		if (normalized && terms.size < MAX_LEXICAL_TERMS_PER_NOTE) terms.add(normalized);
	};
	for (const value of [...note.searchTokens, note.title, ...note.aliases, ...note.tags]) {
		for (const token of value.split(/[^\p{L}\p{N}_-]+/u)) add(token);
		for (const run of value.match(/\p{Script=Han}{2,}/gu) ?? []) {
			const characters = [...run];
			for (const width of [2, 3]) {
				for (let offset = 0; offset + width <= characters.length; offset += 1) {
					add(characters.slice(offset, offset + width).join(''));
					if (terms.size >= MAX_LEXICAL_TERMS_PER_NOTE) break;
				}
			}
		}
	}
	return [...terms].sort();
}

function toCatalogEntry(note: IndexedKnowledgeNote): KnowledgeCatalogEntry {
	const managed = parseManagedRelationsBlock(note.text);
	let managedParent: string | null = null;
	let managedSources: readonly string[] = [];
	let managedRelated: readonly string[] = [];
	if (managed.status === 'valid') {
		try {
			const relations = readManagedWikiRelations(managed.content.slice(managed.start, managed.end));
			managedParent = relations.parent ?? null;
			managedSources = [...(relations.sources ?? [])];
			managedRelated = [...(relations.related ?? [])];
		} catch {
			// A hash-valid block with an unsupported payload remains invalid for maintenance.
			managed.status = 'invalid';
		}
	}
	return {
		path: note.path,
		fileVersion: note.fileVersion,
		contentHash: note.contentHash,
		frontmatterHash: frontmatterHash(note.frontmatter),
		frontmatter: cloneVaultFrontmatter(note.frontmatter),
		title: note.title,
		aliases: [...note.aliases],
		type: note.type,
		tags: [...note.tags],
		searchTokens: lexicalTerms(note),
		excerpt: note.excerptSource,
		modifiedAt: note.modifiedAt,
		size: note.size,
		managedRelationsStatus: managed.status,
		managedRelationsSchemaVersion: managed.schemaVersion,
		wikiRole: managed.role,
		managedParent,
		managedSources,
		managedRelated,
	};
}

function cloneCatalogEntry(entry: KnowledgeCatalogEntry): KnowledgeCatalogEntry {
	return {
		...entry,
		aliases: [...entry.aliases],
		tags: [...entry.tags],
		searchTokens: [...entry.searchTokens],
		frontmatter: cloneVaultFrontmatter(entry.frontmatter),
		managedSources: [...entry.managedSources],
		managedRelated: [...entry.managedRelated],
	};
}

function addPosting(postings: Map<string, readonly string[]>, term: string, notePath: string): void {
	postings.set(term, mergeAndSortUnique([...(postings.get(term) ?? []), notePath]));
}

function removePosting(postings: Map<string, readonly string[]>, term: string, notePath: string): void {
	const next = (postings.get(term) ?? []).filter((candidate) => candidate !== notePath);
	if (next.length === 0) postings.delete(term);
	else postings.set(term, next);
}

function buildLexicalPostings(catalog: ReadonlyMap<VaultPath, KnowledgeCatalogEntry>): Map<string, readonly VaultPath[]> {
	const postings = new Map<string, readonly VaultPath[]>();
	for (const [notePath, entry] of catalog) {
		for (const term of entry.searchTokens) addPosting(postings, term, notePath);
	}
	return new Map([...postings.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function cloneMemoryRecord(record: MemoryRecord): MemoryRecord {
	return {
		...record,
		evidence: [...record.evidence],
		supersedes: [...record.supersedes],
		contradicts: [...record.contradicts],
		related_wiki: [...record.related_wiki],
		related_sources: [...record.related_sources],
	};
}

function buildMemoryIndex(
	notes: ReadonlyMap<VaultPath, IndexedKnowledgeNote>,
	generation: number,
	resolvedAt: string
): KnowledgeMemoryIndex {
	const records: MemoryRecord[] = [];
	const legacy: Exclude<MemoryRecordReadProjection, { kind: 'v2' }>[] = [];
	const invalidPaths: string[] = [];
	for (const note of notes.values()) {
		if (note.frontmatter.type === 'memory_record') {
			try {
				records.push(parseMemoryRecord({ path: note.path, frontmatter: note.frontmatter }));
			} catch {
				invalidPaths.push(note.path);
			}
			continue;
		}
		try {
			const projectNote = classifyProjectMemoryNote({ path: note.path, frontmatter: note.frontmatter });
			if (projectNote.kind === 'entry') {
				const projection = projectMemoryEntryToReadProjection(projectNote.entry);
				if (projection.kind !== 'v2') legacy.push(projection);
				continue;
			}
			if (projectNote.kind === 'legacy' && projectNote.project_id) {
				const projection = legacyMemoryToReadProjection({
					path: projectNote.path,
					scope: 'project',
					project_id: projectNote.project_id,
				});
				if (projection.kind !== 'v2') legacy.push(projection);
				continue;
			}
		} catch {
			invalidPaths.push(note.path);
			continue;
		}
		if (isGlobalLegacyMemoryPath(note.path)) {
			const projection = legacyMemoryToReadProjection({ path: note.path, scope: 'global' });
			if (projection.kind !== 'v2') legacy.push(projection);
		}
	}
	const lifecycle = resolveMemoryLifecycle({ generation, records, legacy, now: resolvedAt });
	const byId = new Map<string, MemoryRecord>();
	const byClaimKey = new Map<string, readonly string[]>();
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

function isGlobalLegacyMemoryPath(notePath: string): boolean {
	if (path.posix.basename(notePath).toLowerCase() === 'index.md') return false;
	return notePath.startsWith(`${KNOWLEDGE_GLOBAL_MEMORY_DIR}/`)
		|| LEGACY_MEMORY_DIRS.some((directory) => notePath.startsWith(`${directory}/`));
}

function emptyMemoryIndex(generation: number, resolvedAt: string): KnowledgeMemoryIndex {
	return buildMemoryIndex(new Map(), generation, resolvedAt);
}

function cloneMemoryIndex(index: KnowledgeMemoryIndex): KnowledgeMemoryIndex {
	return {
		byId: new Map([...index.byId].map(([key, record]) => [key, cloneMemoryRecord(record)])),
		byClaimKey: cloneIndexMap(index.byClaimKey),
		lifecycle: {
			...index.lifecycle,
			records: index.lifecycle.records.map((row) => ({ ...row, record: cloneMemoryRecord(row.record), reasons: [...row.reasons] })),
			legacy: index.lifecycle.legacy.map((row) => ({ ...row, projection: { ...row.projection }, reasons: [...row.reasons] as ['missing_claim_key'] })),
			current: index.lifecycle.current.map((row) => ({ ...row, record: cloneMemoryRecord(row.record), reasons: [...row.reasons] })),
			history: index.lifecycle.history.map((row) => ({ ...row, record: cloneMemoryRecord(row.record), reasons: [...row.reasons] })),
			conflicts: index.lifecycle.conflicts.map((row) => ({ ...row, record: cloneMemoryRecord(row.record), reasons: [...row.reasons] })),
			issues: index.lifecycle.issues.map((issue) => ({ ...issue, memory_ids: [...issue.memory_ids] })),
		},
		invalidPaths: [...index.invalidPaths],
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

export function buildKnowledgeSnapshot(
	scanResult: ScanResult,
	options: {
		indexState?: KnowledgeIndexState;
		generation?: number;
		eventSequence?: number;
		lastEvent?: VaultIndexEvent | null;
		lastRebuild?: string | null;
	} = {}
): KnowledgeSnapshot {
	const notesByPath = new Map<string, IndexedKnowledgeNote>();
	for (const scannedNote of [...scanResult.notes].sort((left, right) =>
		left.relativePath.localeCompare(right.relativePath)
	)) {
		const normalizedPath = normalizeVaultPath(scannedNote.relativePath);
		notesByPath.set(normalizedPath, toIndexedKnowledgeNote(scannedNote));
	}

	const resolvedNotes = resolveIndexedNoteEdges(notesByPath);
	const graph = buildKnowledgeGraph(resolvedNotes);
	const notes = enrichNoteBacklinks(resolvedNotes, graph);
	const scopes = buildScopeIndex(notes);

	return {
		version: KNOWLEDGE_INDEX_VERSION,
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

function normalizeLookupIdentity(value: string): string {
	return value.normalize('NFC').trim().toLocaleLowerCase('en-US');
}

function noteLookupIdentities(note: IndexedKnowledgeNote | null): Set<string> {
	if (!note) return new Set();
	const withoutExtension = note.path.replace(/\.(?:md|markdown)$/i, '');
	return new Set(
		[
			note.path,
			withoutExtension,
			path.posix.basename(withoutExtension),
			note.title,
			...note.aliases,
		].map(normalizeLookupIdentity)
	);
}

function edgeTouchesIdentity(edge: NormalizedVaultEdge, identities: ReadonlySet<string>, paths: ReadonlySet<string>): boolean {
	if (edge.resolution.status === 'resolved' && paths.has(edge.resolution.path)) return true;
	const target = normalizeLookupIdentity((edge.linkPath || edge.target).replace(/\.(?:md|markdown)$/i, ''));
	return identities.has(target) || identities.has(normalizeLookupIdentity(path.posix.basename(target)));
}

function collectAffectedSources(
	previous: ReadonlyMap<VaultPath, IndexedKnowledgeNote>,
	next: ReadonlyMap<VaultPath, IndexedKnowledgeNote>,
	oldNote: IndexedKnowledgeNote | null,
	newNote: IndexedKnowledgeNote | null,
	changedPaths: readonly string[]
): Set<string> {
	const affected = new Set(changedPaths);
	const identities = new Set([...noteLookupIdentities(oldNote), ...noteLookupIdentities(newNote)]);
	const paths = new Set(changedPaths);
	for (const [notePath, note] of new Map([...previous, ...next])) {
		if (note.edges.some((edge) => edgeTouchesIdentity(edge, identities, paths))) affected.add(notePath);
	}
	return affected;
}

function resolveAffectedNoteEdges(
	notes: ReadonlyMap<VaultPath, IndexedKnowledgeNote>,
	affected: ReadonlySet<string>
): Map<VaultPath, IndexedKnowledgeNote> {
	const resolved = resolveNormalizedVaultEdges(
		[...notes.values()].map((note) => ({
			path: note.path,
			title: note.title,
			aliases: note.aliases,
			edges: affected.has(note.path) ? note.edges : [],
		}))
	);
	const result = new Map(notes);
	for (const notePath of affected) {
		const note = notes.get(notePath);
		if (!note) continue;
		const edges = (resolved.get(notePath) ?? note.edges).map(cloneEdge);
		result.set(notePath, { ...note, edges, wikilinks: edges });
	}
	return result;
}

function updateKnowledgeGraphIncrementally(
	graph: KnowledgeGraphSnapshot,
	previousNotes: ReadonlyMap<VaultPath, IndexedKnowledgeNote>,
	nextNotes: ReadonlyMap<VaultPath, IndexedKnowledgeNote>,
	affectedSources: ReadonlySet<string>
): { graph: KnowledgeGraphSnapshot; affectedTargets: Set<string> } {
	const outgoing = new Map([...graph.outgoing].map(([key, values]) => [key, new Set(values)]));
	const incoming = new Map([...graph.incoming].map(([key, values]) => [key, new Set(values)]));
	const affectedTargets = new Set<string>();
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
		if (!incoming.has(sourcePath)) incoming.set(sourcePath, new Set());
		for (const link of note.edges) {
			const sourcedLink = { ...cloneEdge(link), sourcePath: link.sourcePath ?? sourcePath };
			if (
				link.resolution.status !== 'resolved'
				|| (!nextNotes.has(link.resolution.path) && link.resolution.authority !== 'native')
			) {
				unresolvedEdges.push(
					link.resolution.status === 'resolved'
						? {
							...sourcedLink,
							resolution: {
								status: 'unresolved',
								reason: 'not_found',
								authority: link.resolution.authority,
							},
						}
						: sourcedLink
				);
				continue;
			}
			const targetPath = link.resolution.path;
			edges.push(sourcedLink);
			outgoing.get(sourcePath)!.add(targetPath);
			const backlinks = incoming.get(targetPath) ?? new Set<string>();
			backlinks.add(sourcePath);
			incoming.set(targetPath, backlinks);
			affectedTargets.add(targetPath);
		}
	}
	for (const notePath of previousNotes.keys()) {
		if (!nextNotes.has(notePath) && (incoming.get(notePath)?.size ?? 0) === 0) incoming.delete(notePath);
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

function addScopePath(index: Map<string, readonly string[]>, key: string, notePath: string): void {
	index.set(key, mergeAndSortUnique([...(index.get(key) ?? []), notePath]));
}

function removeScopePath(index: Map<string, readonly string[]>, key: string, notePath: string): void {
	const next = (index.get(key) ?? []).filter((candidate) => candidate !== notePath);
	if (next.length === 0) index.delete(key);
	else index.set(key, next);
}

export class InMemoryKnowledgeIndex implements KnowledgeIndex {
	private readonly vaultRoot: string;
	private readonly vaultConfigDir?: string;
	private readonly maxIncrementalRenameImpact: number;
	private state: InternalKnowledgeState;
	private sourceNotes = new Map<VaultPath, ScannedNote>();
	private sourceErrors: ScanResult['errors'] = [];
	private writeChain: Promise<void> = Promise.resolve();

	constructor(options: KnowledgeIndexOptions) {
		this.vaultRoot = resolveVaultRoot(options.vaultRoot);
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

	async snapshot(): Promise<KnowledgeSnapshot> {
		return snapshotToReadonly(this.state);
	}

	async readView(): Promise<KnowledgeReadView> {
		const generation = this.state.generation;
		const catalog = new Map(
			[...this.state.catalog].map(([notePath, entry]) => [notePath, cloneCatalogEntry(entry)])
		);
		return {
			version: KNOWLEDGE_INDEX_VERSION,
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
				read: async (notePath: VaultPath) => this.readContentForView(generation, catalog, notePath),
			},
		};
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
				event_sequence: this.state.eventSequence,
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
			const graph = cloneGraph(built.graph);
			const generation = this.state.generation + 1;
			const createdAt = new Date().toISOString();
			const catalog = new Map(
				[...withBacklinks].map(([notePath, note]) => [notePath, toCatalogEntry(note)])
			);

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

	async apply(event: VaultIndexEvent): Promise<void> {
		const normalized = normalizeVaultEvent(event);
		const note = normalized.kind === 'create' || normalized.kind === 'modify'
			? readNoteFromVault(this.vaultRoot, normalized.path)
			: normalized.kind === 'rename'
				? readNoteFromVault(this.vaultRoot, normalized.newPath)
				: null;
		await this.applyScanned(normalized, note);
	}

	async applySemantic(event: VaultSemanticEvent): Promise<void> {
		if (
			event.schemaVersion !== NORMALIZED_VAULT_NOTE_VERSION ||
			!Number.isSafeInteger(event.sequence) ||
			event.sequence <= 0
		) {
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
		if (
			event.kind === 'rename' &&
			event.exists &&
			isMarkdownPath(event.newPath!) &&
			!event.note
		) {
			throw new Error('Markdown rename semantic events must include the current target note.');
		}
		if (event.note && event.contentHash !== event.note.contentHash) {
			throw new Error('Vault semantic event content hash must match its note.');
		}

		const note = event.note ? scannedNoteFromNormalized(event.note, this.vaultRoot) : null;
		const fileVersion = note ? computeFileVersion(note.size, note.modifiedAt) : '';
		const compatibilityEvent: VaultIndexEvent = event.kind === 'rename'
			? {
					kind: 'rename',
					path: event.path,
					newPath: event.newPath!,
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

	async advanceEventSequenceAfterRebuild(sequence: number): Promise<void> {
		if (!Number.isSafeInteger(sequence) || sequence <= 0) {
			throw new Error('Rebuild event sequence must be a positive safe integer.');
		}
		await this.enqueueWrite(async () => {
			if (sequence > this.state.eventSequence) {
				this.state.eventSequence = sequence;
			}
		});
	}

	async applyScanned(event: VaultIndexEvent, note?: ScannedNote | null): Promise<void> {
		await this.enqueueWrite(async () => {
			const now = new Date().toISOString();
			const normalized = normalizeVaultEvent(event);
			if (
				normalized.sequence !== undefined &&
				(!Number.isSafeInteger(normalized.sequence) ||
					normalized.sequence <= 0 ||
					normalized.sequence <= this.state.eventSequence)
			) {
				return;
			}

			let changed = false;
			if (normalized.kind === 'create' || normalized.kind === 'modify') {
				changed = await this.applyCreateOrModify(normalized, note ?? null);
			} else if (normalized.kind === 'delete') {
				changed = await this.applyDelete(normalized);
			} else {
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
			} else if (normalized.sequence !== undefined) {
				this.state.lastEvent = {
					...normalized,
					path: normalizeVaultPath(normalized.path),
				};
				this.state.eventSequence = normalized.sequence;
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

	private async readContentForView(
		generation: number,
		catalog: ReadonlyMap<VaultPath, KnowledgeCatalogEntry>,
		notePath: VaultPath
	): Promise<KnowledgeContentRead | null> {
		const normalizedPath = normalizeVaultPath(notePath);
		const note = readNoteFromVault(this.vaultRoot, normalizedPath);
		if (!note) return null;
		return {
			generation,
			path: normalizedPath,
			contentHash: note.contentHash,
			content: note.content,
			modifiedAt: note.modifiedAt,
			staleAgainstView: catalog.get(normalizedPath)?.contentHash !== note.contentHash,
		};
	}

	private clearRecoveredSourceErrors(event: VaultIndexEvent, note: ScannedNote | null): void {
		const recoveredPaths = new Set<string>();
		const eventPath = normalizeVaultPath(event.path);
		if (event.kind === 'delete') {
			recoveredPaths.add(eventPath);
		} else if (event.kind === 'create' || event.kind === 'modify') {
			if (
				note &&
				event.exists !== false &&
				normalizeVaultPath(note.relativePath) === eventPath &&
				(!event.contentHash || event.contentHash === note.contentHash)
			) {
				recoveredPaths.add(eventPath);
			}
		} else {
			const targetPath = normalizeVaultPath(event.newPath);
			if (!note && (event.exists === false || !isMarkdownPath(targetPath))) {
				recoveredPaths.add(eventPath);
			} else if (
				note &&
				normalizeVaultPath(note.relativePath) === targetPath &&
				(!event.contentHash || event.contentHash === note.contentHash)
			) {
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

	private applyCreateOrModify(event: CreateVaultIndexEvent | ModifyVaultIndexEvent, suppliedNote: ScannedNote | null): Promise<boolean> {
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
			if (
				event.sequence === undefined &&
				existing &&
				Date.parse(indexed.modifiedAt) < Date.parse(existing.modifiedAt)
			) {
				return false;
			}

			const nextNotes = new Map(this.state.notes);
			nextNotes.set(normalizedPath, indexed);
			this.sourceNotes.set(normalizedPath, cloneScannedNote(scanned));
			this.updateIncrementally(nextNotes, existing ?? null, indexed, [normalizedPath]);
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

			const nextNotes = new Map(this.state.notes);
			nextNotes.delete(normalizedPath);
			this.sourceNotes.delete(normalizedPath);
			this.updateIncrementally(nextNotes, existing, null, [normalizedPath]);
			return true;
		});
	}

	private applyRename(event: RenameVaultIndexEvent, suppliedNote: ScannedNote | null): Promise<boolean> {
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
				if (
					existingTarget &&
					resolvedCandidate &&
					hasSameSemanticState(existingTarget, resolvedCandidate)
				) {
					return false;
				}
				if (
					event.sequence === undefined &&
					existingTarget &&
					Date.parse(indexedTarget.modifiedAt) < Date.parse(existingTarget.modifiedAt)
				) {
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

			this.updateRenameDerivedState(
				nextNotes,
				existingSource ?? existingTarget ?? null,
				indexedTarget,
				fromPath,
				toPath
			);
			return true;
		});
	}

	private updateRenameDerivedState(
		notes: Map<VaultPath, IndexedKnowledgeNote>,
		oldNote: IndexedKnowledgeNote | null,
		newNote: IndexedKnowledgeNote | null,
		fromPath: string,
		toPath: string
	): void {
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

	private updateIncrementally(
		notes: Map<VaultPath, IndexedKnowledgeNote>,
		oldNote: IndexedKnowledgeNote | null,
		newNote: IndexedKnowledgeNote | null,
		changedPaths: readonly string[],
		knownAffected?: ReadonlySet<string>
	): void {
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

	private updateCatalogScopesAndPostings(
		oldNote: IndexedKnowledgeNote | null,
		newNote: IndexedKnowledgeNote | null,
		changedPaths: readonly string[]
	): void {
		const catalog = new Map(this.state.catalog);
		const postings = new Map(this.state.lexicalPostings);
		const byType = new Map(this.state.scopes.byType);
		const byTag = new Map(this.state.scopes.byTag);
		if (oldNote) {
			const oldEntry = catalog.get(oldNote.path) ?? toCatalogEntry(oldNote);
			for (const term of oldEntry.searchTokens) removePosting(postings, term, oldNote.path);
			removeScopePath(byType, oldNote.type ?? 'untyped', oldNote.path);
			for (const tag of oldNote.tags) removeScopePath(byTag, tag, oldNote.path);
			catalog.delete(oldNote.path);
		}
		for (const changedPath of changedPaths) {
			if (!newNote || changedPath !== newNote.path) catalog.delete(changedPath);
		}
		if (newNote) {
			const entry = toCatalogEntry(newNote);
			catalog.set(newNote.path, entry);
			for (const term of entry.searchTokens) addPosting(postings, term, newNote.path);
			addScopePath(byType, newNote.type ?? 'untyped', newNote.path);
			for (const tag of newNote.tags) addScopePath(byTag, tag, newNote.path);
		}
		this.state.catalog = new Map([...catalog].sort(([left], [right]) => left.localeCompare(right)));
		this.state.lexicalPostings = new Map([...postings].sort(([left], [right]) => left.localeCompare(right)));
		this.state.scopes = {
			byType: cloneIndexMap(byType),
			byTag: cloneIndexMap(byTag),
		};
	}

	private rebuildDerivedState(notes: Map<VaultPath, IndexedKnowledgeNote>, update: KnowledgeIndexUpdate): void {
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

	private toMutableState(snapshot: KnowledgeSnapshot): InternalKnowledgeState {
		const catalog = new Map(
			[...snapshot.notes].map(([notePath, note]) => [notePath, toCatalogEntry(note)])
		);
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

function normalizeRenameImpactLimit(value: number | undefined): number {
	if (value === undefined) return DEFAULT_MAX_INCREMENTAL_RENAME_IMPACT;
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error('maxIncrementalRenameImpact must be a positive safe integer.');
	}
	return value;
}

function normalizeVaultEvent(event: VaultIndexEvent): VaultIndexEvent {
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

function isMarkdownPath(notePath: string): boolean {
	return NOTES_EXTENSIONS.has(path.posix.extname(notePath).toLowerCase());
}

function normalizeScanErrorPath(vaultRoot: string, errorPath: string): string | null {
	try {
		const candidate = path.isAbsolute(errorPath)
			? path.relative(vaultRoot, errorPath).replace(/\\/g, '/')
			: errorPath;
		return normalizeVaultPath(candidate);
	} catch {
		return null;
	}
}
