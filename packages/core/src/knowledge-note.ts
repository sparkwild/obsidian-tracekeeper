import { createHash } from 'node:crypto';
import path from 'node:path';

export const NORMALIZED_VAULT_NOTE_VERSION = '1.0';

export type NormalizedVaultEdgeKind = 'link' | 'embed' | 'reference' | 'frontmatter';
export type NormalizedVaultEdgeSource = 'body' | 'frontmatter';
export type NormalizedVaultSubpathKind = 'heading' | 'block';
export type NormalizedVaultSectionType =
	| 'frontmatter'
	| 'heading'
	| 'fenced-code'
	| 'inline-code'
	| 'html-comment'
	| 'url'
	| 'callout';

export interface VaultSourceLocation {
	line: number;
	column: number;
	offset: number;
}

export interface VaultSourceRange {
	start: VaultSourceLocation;
	end: VaultSourceLocation;
}

export interface NormalizedVaultSection {
	type: NormalizedVaultSectionType;
	position: VaultSourceRange;
}

export type NormalizedVaultEdgeResolution =
	| {
			status: 'resolved';
			path: string;
			authority: 'fallback' | 'native';
	  }
	| {
			status: 'unresolved';
			reason:
				| 'not_found'
				| 'ambiguous'
				| 'unsafe_path'
				| 'empty_target'
				| 'missing_reference_definition';
			authority: 'fallback' | 'native';
	  };

export interface NormalizedVaultEdge {
	kind: NormalizedVaultEdgeKind;
	source: NormalizedVaultEdgeSource;
	raw: string;
	target: string;
	linkPath: string;
	displayText?: string;
	alias?: string;
	heading?: string;
	subpath?: string;
	subpathKind?: NormalizedVaultSubpathKind;
	referenceLabel?: string;
	line: number;
	position: VaultSourceRange;
	sourcePath?: string;
	resolution: NormalizedVaultEdgeResolution;
}

export interface NormalizedVaultCallout {
	type: string;
	rawHeader: string;
	content: string;
	sourceRefs: string[];
	blockId?: string;
	line: number;
	endLine: number;
	position: VaultSourceRange;
}

export interface NormalizedVaultNote {
	schemaVersion: typeof NORMALIZED_VAULT_NOTE_VERSION;
	path: string;
	exists: boolean;
	contentHash: string;
	title: string;
	aliases: readonly string[];
	type?: string | null;
	frontmatter: Readonly<Record<string, unknown>>;
	semanticErrors: readonly string[];
	tags: readonly string[];
	headings: readonly string[];
	blockIds: readonly string[];
	sections: readonly NormalizedVaultSection[];
	callouts: readonly NormalizedVaultCallout[];
	edges: readonly NormalizedVaultEdge[];
	text: string;
	content: string;
	modifiedAt: string;
	size: number;
}

export interface VaultSemanticEvent {
	schemaVersion: typeof NORMALIZED_VAULT_NOTE_VERSION;
	sequence: number;
	kind: 'create' | 'modify' | 'delete' | 'rename';
	path: string;
	newPath?: string;
	exists: boolean;
	contentHash?: string;
	note?: NormalizedVaultNote;
}

export interface NormalizedVaultNoteReference {
	path: string;
	title: string;
	aliases: readonly string[];
	edges: readonly NormalizedVaultEdge[];
}

export class VaultSemanticPathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VaultSemanticPathError';
	}
}

type LookupIndex = Map<string, Set<string>>;

interface EdgeResolutionIndex {
	paths: Map<string, string>;
	pathsWithoutExtensions: Map<string, string>;
	basenames: LookupIndex;
	titles: LookupIndex;
	aliases: LookupIndex;
}

export function hashVaultContent(content: string): string {
	return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function cloneVaultFrontmatter(
	frontmatter: Readonly<Record<string, unknown>>
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const seen = new WeakSet<object>();
	for (const [key, value] of Object.entries(frontmatter)) {
		if (isUnsafeMetadataKey(key)) {
			continue;
		}
		result[key] = cloneVaultMetadataValue(value, 0, seen);
	}
	return result;
}

export function normalizeVaultRelativePath(value: string): string {
	const replaced = value.replace(/\\/g, '/').trim();
	if (
		!replaced ||
		replaced.includes('\0') ||
		replaced.startsWith('/') ||
		/^[A-Za-z]:\//.test(replaced)
	) {
		throw new VaultSemanticPathError(`Unsafe Vault-relative path: ${value}`);
	}

	const normalized = path.posix.normalize(replaced.replace(/^\.\//, ''));
	if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
		throw new VaultSemanticPathError(`Unsafe Vault-relative path: ${value}`);
	}
	return normalized;
}

function cloneVaultMetadataValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
	if (depth >= 32) {
		return null;
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) {
			return null;
		}
		seen.add(value);
		return value.map((item) => cloneVaultMetadataValue(item, depth + 1, seen));
	}
	if (value && typeof value === 'object') {
		if (seen.has(value)) {
			return null;
		}
		seen.add(value);
		const result: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			if (isUnsafeMetadataKey(key)) {
				continue;
			}
			result[key] = cloneVaultMetadataValue(item, depth + 1, seen);
		}
		return result;
	}
	return value;
}

function isUnsafeMetadataKey(key: string): boolean {
	return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

export function resolveNormalizedVaultEdges(
	notes: readonly NormalizedVaultNoteReference[]
): ReadonlyMap<string, readonly NormalizedVaultEdge[]> {
	const sortedNotes = [...notes].sort((left, right) => left.path.localeCompare(right.path));
	const index = buildEdgeResolutionIndex(sortedNotes);
	const resolved = new Map<string, readonly NormalizedVaultEdge[]>();

	for (const note of sortedNotes) {
		const sourcePath = normalizeVaultRelativePath(note.path);
		const edges = note.edges.map((edge) => resolveNormalizedVaultEdge(edge, sourcePath, index));
		resolved.set(sourcePath, edges);
	}

	return resolved;
}

function buildEdgeResolutionIndex(notes: readonly NormalizedVaultNoteReference[]): EdgeResolutionIndex {
	const paths = new Map<string, string>();
	const pathsWithoutExtensions = new Map<string, string>();
	const basenames: LookupIndex = new Map();
	const titles: LookupIndex = new Map();
	const aliases: LookupIndex = new Map();

	for (const note of notes) {
		const normalizedPath = normalizeVaultRelativePath(note.path);
		const normalizedKey = normalizeLookupToken(normalizedPath);
		const withoutExtension = stripKnownExtension(normalizedPath);
		paths.set(normalizedKey, normalizedPath);
		pathsWithoutExtensions.set(normalizeLookupToken(withoutExtension), normalizedPath);
		addLookupValue(basenames, path.posix.basename(withoutExtension), normalizedPath);
		addLookupValue(titles, note.title, normalizedPath);
		for (const alias of note.aliases) {
			addLookupValue(aliases, alias, normalizedPath);
		}
	}

	return {
		paths,
		pathsWithoutExtensions,
		basenames,
		titles,
		aliases,
	};
}

function resolveNormalizedVaultEdge(
	edge: NormalizedVaultEdge,
	sourcePath: string,
	index: EdgeResolutionIndex
): NormalizedVaultEdge {
	if (edge.resolution.authority === 'native' && edge.resolution.status === 'resolved') {
		try {
			const normalizedTarget = normalizeVaultRelativePath(edge.resolution.path);
			const canonicalTarget = index.paths.get(normalizeLookupToken(normalizedTarget));
			if (canonicalTarget) {
				return {
					...edge,
					sourcePath,
					resolution: {
						...edge.resolution,
						path: canonicalTarget,
					},
				};
			}
			return {
				...edge,
				sourcePath,
				resolution: {
					...edge.resolution,
					path: normalizedTarget,
				},
			};
		} catch {
			return withUnresolvedReason(edge, sourcePath, 'unsafe_path', 'native');
		}
	}
	if (edge.resolution.authority === 'native') {
		return {
			...edge,
			sourcePath,
			resolution: { ...edge.resolution },
		};
	}
	if (
		edge.resolution.status === 'unresolved' &&
		edge.resolution.reason === 'missing_reference_definition'
	) {
		return {
			...edge,
			sourcePath,
		};
	}

	const target = (edge.linkPath || edge.target).trim();
	if (!target) {
		if (edge.subpath) {
			return withResolvedPath(edge, sourcePath, sourcePath);
		}
		return withUnresolvedReason(edge, sourcePath, 'empty_target');
	}

	const pathResult = resolvePathTarget(target, sourcePath, index);
	if (pathResult.status === 'resolved') {
		return withResolvedPath(edge, sourcePath, pathResult.path);
	}
	if (pathResult.status === 'unsafe') {
		return withUnresolvedReason(edge, sourcePath, 'unsafe_path');
	}

	if (!isPathLikeTarget(target)) {
		const lookupResult = resolveUniqueLookupTarget(target, index);
		if (lookupResult.status === 'resolved') {
			return withResolvedPath(edge, sourcePath, lookupResult.path);
		}
		if (lookupResult.status === 'ambiguous') {
			return withUnresolvedReason(edge, sourcePath, 'ambiguous');
		}
	}

	return withUnresolvedReason(edge, sourcePath, 'not_found');
}

function resolvePathTarget(
	target: string,
	sourcePath: string,
	index: EdgeResolutionIndex
): { status: 'resolved'; path: string } | { status: 'missing' } | { status: 'unsafe' } {
	let candidate = target.replace(/\\/g, '/').trim();
	if (/^[A-Za-z]:\//.test(candidate)) {
		return { status: 'unsafe' };
	}

	if (candidate.startsWith('/')) {
		candidate = candidate.replace(/^\/+/, '');
	} else if (candidate.startsWith('./') || candidate.startsWith('../')) {
		candidate = path.posix.join(path.posix.dirname(sourcePath), candidate);
	}

	const normalized = path.posix.normalize(candidate);
	if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
		return { status: 'unsafe' };
	}

	const exact = index.paths.get(normalizeLookupToken(normalized));
	if (exact) {
		return { status: 'resolved', path: exact };
	}

	const withoutExtension = stripKnownExtension(normalized);
	const extensionless = index.pathsWithoutExtensions.get(normalizeLookupToken(withoutExtension));
	if (extensionless) {
		return { status: 'resolved', path: extensionless };
	}

	return { status: 'missing' };
}

function resolveUniqueLookupTarget(
	target: string,
	index: EdgeResolutionIndex
): { status: 'resolved'; path: string } | { status: 'missing' } | { status: 'ambiguous' } {
	const key = normalizeLookupToken(stripKnownExtension(target));
	if (!key) {
		return { status: 'missing' };
	}

	const groups = [index.titles.get(key), index.aliases.get(key), index.basenames.get(key)];
	const matches = new Set<string>();
	for (const group of groups) {
		for (const candidate of group ?? []) {
			matches.add(candidate);
		}
	}
	if (matches.size === 1) {
		return { status: 'resolved', path: [...matches][0] };
	}
	return matches.size > 1 ? { status: 'ambiguous' } : { status: 'missing' };
}

function withResolvedPath(edge: NormalizedVaultEdge, sourcePath: string, targetPath: string): NormalizedVaultEdge {
	return {
		...edge,
		sourcePath,
		resolution: {
			status: 'resolved',
			path: targetPath,
			authority: 'fallback',
		},
	};
}

function withUnresolvedReason(
	edge: NormalizedVaultEdge,
	sourcePath: string,
	reason: Extract<NormalizedVaultEdgeResolution, { status: 'unresolved' }>['reason'],
	authority: 'fallback' | 'native' = 'fallback'
): NormalizedVaultEdge {
	return {
		...edge,
		sourcePath,
		resolution: {
			status: 'unresolved',
			reason,
			authority,
		},
	};
}

function addLookupValue(index: LookupIndex, rawKey: string, value: string): void {
	const key = normalizeLookupToken(rawKey);
	if (!key) {
		return;
	}
	const values = index.get(key) ?? new Set<string>();
	values.add(value);
	index.set(key, values);
}

function normalizeLookupToken(value: string): string {
	return value.trim().toLocaleLowerCase('en-US');
}

function stripKnownExtension(value: string): string {
	const extension = path.posix.extname(value).toLowerCase();
	if (extension === '.md' || extension === '.markdown') {
		return value.slice(0, -extension.length);
	}
	return value;
}

function isPathLikeTarget(target: string): boolean {
	return (
		target.startsWith('.') ||
		target.startsWith('/') ||
		target.includes('/') ||
		target.includes('\\') ||
		path.posix.extname(target) !== ''
	);
}
