import fs from 'node:fs';
import path from 'node:path';
import { isSafeDirectoryName, resolveVaultRoot, ensureInsideVaultRoot } from './safety';
import { parseMarkdown } from './markdown';
import {
	cloneVaultFrontmatter,
	hashVaultContent,
	NORMALIZED_VAULT_NOTE_VERSION,
	normalizeVaultRelativePath,
	resolveNormalizedVaultEdges,
	type NormalizedVaultNote,
} from './knowledge-note';

export interface ScannedNote extends NormalizedVaultNote {
	absolutePath: string;
	relativePath: string;
	tokens: string;
	type?: string;
	wikilinks: ReturnType<typeof parseMarkdown>['wikilinks'];
	claimBlocks: ReturnType<typeof parseMarkdown>['claimBlocks'];
	evidenceBlocks: ReturnType<typeof parseMarkdown>['evidenceBlocks'];
}

export interface ScanError {
	path: string;
	error: string;
}

export interface ScanResult {
	vaultRoot: string;
	scannedAt: string;
	notes: ScannedNote[];
	errors: ScanError[];
	index?: {
		index_state: 'initializing' | 'rebuilding' | 'ready';
		generation: number;
		event_sequence?: number;
		last_rebuild: string | null;
	};
}

export interface ScanVaultOptions {
	vaultConfigDir?: string;
}

export interface ScannedNoteContentInput {
	absolutePath: string;
	relativePath: string;
	fallbackTitle: string;
	size: number;
	modifiedAt: string;
	content: string;
}

const NOTES_EXTENSIONS = new Set(['.md', '.markdown']);

function isCommaSeparatedAliases(value: unknown): value is string {
	return typeof value === 'string';
}

function aliasEntries(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const aliases: string[] = [];
	for (const item of value) {
		if (typeof item === 'string' && item.trim()) {
			aliases.push(item.trim());
		}
	}
	return aliases;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function getAliases(frontmatter: Record<string, unknown>): string[] {
	const aliases: string[] = [];
	const aliasesFromFrontmatter = frontmatter.aliases;

	if (isCommaSeparatedAliases(aliasesFromFrontmatter)) {
		for (const alias of aliasesFromFrontmatter.split(',').map((item) => item.trim())) {
			if (alias) {
				aliases.push(alias);
			}
		}
	} else {
		for (const alias of aliasEntries(aliasesFromFrontmatter)) {
			aliases.push(alias);
		}
	}

	if (typeof frontmatter.title === 'string' && frontmatter.title.trim()) {
		aliases.push(frontmatter.title.trim());
	}
	return [...new Set(aliases)];
}

export function scannedNoteFromContent(input: ScannedNoteContentInput): ScannedNote {
	const parsed = parseMarkdown(input.content);
	const aliases = getAliases(parsed.frontmatter.fields);
	const relativePath = normalizeVaultRelativePath(input.relativePath);
	const edges = parsed.edges.map((edge) => ({
		...edge,
		sourcePath: relativePath,
	}));

	return {
		schemaVersion: NORMALIZED_VAULT_NOTE_VERSION,
		path: relativePath,
		exists: true,
		contentHash: hashVaultContent(input.content),
		absolutePath: input.absolutePath,
		relativePath,
		title: parsed.title || input.fallbackTitle,
		size: input.size,
		modifiedAt: input.modifiedAt,
		tokens: parsed.searchText,
		frontmatter: cloneVaultFrontmatter(parsed.frontmatter.fields),
		semanticErrors: [...parsed.frontmatter.errors],
		aliases,
		type: typeof parsed.frontmatter.fields.type === 'string' ? parsed.frontmatter.fields.type : undefined,
		tags: parsed.tags,
		headings: parsed.headings,
		blockIds: parsed.blockIds,
		sections: parsed.sections.map((section) => ({
			...section,
			position: {
				start: { ...section.position.start },
				end: { ...section.position.end },
			},
		})),
		callouts: parsed.callouts.map(cloneCallout),
		edges,
		wikilinks: edges,
		claimBlocks: parsed.claimBlocks,
		evidenceBlocks: parsed.evidenceBlocks,
		text: input.content,
		content: parsed.body,
	};
}

export function scannedNoteFromNormalized(note: NormalizedVaultNote, vaultRoot: string): ScannedNote {
	if (note.schemaVersion !== NORMALIZED_VAULT_NOTE_VERSION || !note.exists) {
		throw new Error('Normalized Vault note must use the current schema and exist.');
	}
	if (hashVaultContent(note.text) !== note.contentHash) {
		throw new Error('Normalized Vault note content hash does not match its text.');
	}

	const relativePath = normalizeVaultRelativePath(note.path);
	const absolutePath = ensureInsideVaultRoot(
		resolveVaultRoot(vaultRoot),
		path.join(resolveVaultRoot(vaultRoot), relativePath)
	);
	const edges = note.edges.map((edge) => ({
		...edge,
		sourcePath: relativePath,
		position: {
			start: { ...edge.position.start },
			end: { ...edge.position.end },
		},
		resolution: { ...edge.resolution },
	}));
	const callouts = note.callouts.map(cloneCallout);

	return {
		...note,
		path: relativePath,
		absolutePath,
		relativePath,
		frontmatter: cloneVaultFrontmatter(note.frontmatter),
		semanticErrors: [...note.semanticErrors],
		aliases: [...note.aliases],
		type: typeof note.type === 'string' ? note.type : undefined,
		tags: [...note.tags],
		headings: [...note.headings],
		blockIds: [...note.blockIds],
		sections: note.sections.map((section) => ({
			...section,
			position: {
				start: { ...section.position.start },
				end: { ...section.position.end },
			},
		})),
		callouts,
		edges,
		tokens: [note.title, ...note.aliases, ...note.tags, ...note.headings, note.content]
			.filter(Boolean)
			.join('\n'),
		wikilinks: edges,
		claimBlocks: callouts.filter((callout) => callout.type.toLowerCase() === 'claim'),
		evidenceBlocks: callouts.filter((callout) => callout.type.toLowerCase() === 'evidence'),
	};
}

export function resolveScannedNoteEdges(notes: readonly ScannedNote[]): ScannedNote[] {
	const resolved = resolveNormalizedVaultEdges(
		notes.map((note) => ({
			path: note.relativePath,
			title: note.title,
			aliases: note.aliases,
			edges: note.edges,
		}))
	);

	return [...notes]
		.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
		.map((note) => {
			const edges = (resolved.get(note.relativePath) ?? note.edges).map((edge) => ({
				...edge,
				position: {
					start: { ...edge.position.start },
					end: { ...edge.position.end },
				},
			}));
			return {
				...note,
				frontmatter: cloneVaultFrontmatter(note.frontmatter),
				edges,
				wikilinks: edges,
			};
		});
}

function normalizeProtectedDirectoryName(configDir?: string): string {
	const normalized = (configDir || '').replace(/\\/g, '/').trim().replace(/\/+$/g, '');
	if (!normalized || normalized.includes('/')) {
		return '';
	}
	return normalized;
}

function shouldSkipDirectory(entryName: string, options: ScanVaultOptions): boolean {
	const protectedDirectoryName = normalizeProtectedDirectoryName(options.vaultConfigDir);
	return !isSafeDirectoryName(entryName, { protectedDirectoryName });
}

function isSkippableEntry(entry: fs.Dirent): boolean {
	if (entry.isSymbolicLink()) {
		return true;
	}
	return false;
}

function scanDirectory(
	vaultRoot: string,
	directory: string,
	notes: ScannedNote[],
	errors: ScanError[],
	options: ScanVaultOptions
): void {
	const entries = fs
		.readdirSync(directory, { withFileTypes: true })
		.sort((left, right) => left.name.localeCompare(right.name));
	for (const entry of entries) {
		if (shouldSkipDirectory(entry.name, options)) {
			continue;
		}
		if (isSkippableEntry(entry)) {
			continue;
		}

		const resolved = path.join(directory, entry.name);
		const safePath = ensureInsideVaultRoot(vaultRoot, resolved);

		if (entry.isDirectory()) {
			scanDirectory(vaultRoot, safePath, notes, errors, options);
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		const ext = path.extname(entry.name).toLowerCase();
		if (!NOTES_EXTENSIONS.has(ext)) {
			continue;
		}

		try {
			const fileContent = fs.readFileSync(safePath, 'utf8');
			const stats = fs.statSync(safePath);
			const relativePath = path.relative(vaultRoot, safePath).replace(/\\/g, '/');

			const note = scannedNoteFromContent({
				absolutePath: safePath,
				relativePath,
				fallbackTitle: path.basename(entry.name, ext),
				size: stats.size,
				modifiedAt: stats.mtime.toISOString(),
				content: fileContent,
			});
			notes.push(note);
			for (const semanticError of note.semanticErrors) {
				errors.push({
					path: safePath,
					error: `Markdown semantics: ${semanticError}`,
				});
			}
		} catch (error: unknown) {
			errors.push({
				path: safePath,
				error: errorMessage(error),
			});
		}
	}
}

export function scanVault(vaultRoot: string, options: ScanVaultOptions = {}): ScanResult {
	const resolvedRoot = resolveVaultRoot(vaultRoot);
	const notes: ScannedNote[] = [];
	const errors: ScanError[] = [];

	scanDirectory(resolvedRoot, resolvedRoot, notes, errors, options);
	const resolvedNotes = resolveScannedNoteEdges(notes);

	return {
		vaultRoot: resolvedRoot,
		scannedAt: new Date().toISOString(),
		notes: resolvedNotes,
		errors: errors.sort((left, right) => left.path.localeCompare(right.path)),
	};
}

function cloneCallout<T extends ReturnType<typeof parseMarkdown>['callouts'][number]>(callout: T): T {
	return {
		...callout,
		sourceRefs: [...callout.sourceRefs],
		position: {
			start: { ...callout.position.start },
			end: { ...callout.position.end },
		},
	};
}
