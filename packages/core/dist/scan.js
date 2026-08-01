"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scannedNoteFromContent = scannedNoteFromContent;
exports.scannedNoteFromNormalized = scannedNoteFromNormalized;
exports.resolveScannedNoteEdges = resolveScannedNoteEdges;
exports.scanVault = scanVault;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const safety_1 = require("./safety");
const markdown_1 = require("./markdown");
const knowledge_note_1 = require("./knowledge-note");
const NOTES_EXTENSIONS = new Set(['.md', '.markdown']);
function isCommaSeparatedAliases(value) {
    return typeof value === 'string';
}
function aliasEntries(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const aliases = [];
    for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
            aliases.push(item.trim());
        }
    }
    return aliases;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function getAliases(frontmatter) {
    const aliases = [];
    const aliasesFromFrontmatter = frontmatter.aliases;
    if (isCommaSeparatedAliases(aliasesFromFrontmatter)) {
        for (const alias of aliasesFromFrontmatter.split(',').map((item) => item.trim())) {
            if (alias) {
                aliases.push(alias);
            }
        }
    }
    else {
        for (const alias of aliasEntries(aliasesFromFrontmatter)) {
            aliases.push(alias);
        }
    }
    if (typeof frontmatter.title === 'string' && frontmatter.title.trim()) {
        aliases.push(frontmatter.title.trim());
    }
    return [...new Set(aliases)];
}
function scannedNoteFromContent(input) {
    const parsed = (0, markdown_1.parseMarkdown)(input.content);
    const aliases = getAliases(parsed.frontmatter.fields);
    const relativePath = (0, knowledge_note_1.normalizeVaultRelativePath)(input.relativePath);
    const edges = parsed.edges.map((edge) => ({
        ...edge,
        sourcePath: relativePath,
    }));
    return {
        schemaVersion: knowledge_note_1.NORMALIZED_VAULT_NOTE_VERSION,
        path: relativePath,
        exists: true,
        contentHash: (0, knowledge_note_1.hashVaultContent)(input.content),
        absolutePath: input.absolutePath,
        relativePath,
        title: parsed.title || input.fallbackTitle,
        size: input.size,
        modifiedAt: input.modifiedAt,
        tokens: parsed.searchText,
        frontmatter: (0, knowledge_note_1.cloneVaultFrontmatter)(parsed.frontmatter.fields),
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
function scannedNoteFromNormalized(note, vaultRoot) {
    if (note.schemaVersion !== knowledge_note_1.NORMALIZED_VAULT_NOTE_VERSION || !note.exists) {
        throw new Error('Normalized Vault note must use the current schema and exist.');
    }
    if ((0, knowledge_note_1.hashVaultContent)(note.text) !== note.contentHash) {
        throw new Error('Normalized Vault note content hash does not match its text.');
    }
    const relativePath = (0, knowledge_note_1.normalizeVaultRelativePath)(note.path);
    const absolutePath = (0, safety_1.ensureInsideVaultRoot)((0, safety_1.resolveVaultRoot)(vaultRoot), node_path_1.default.join((0, safety_1.resolveVaultRoot)(vaultRoot), relativePath));
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
        frontmatter: (0, knowledge_note_1.cloneVaultFrontmatter)(note.frontmatter),
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
function resolveScannedNoteEdges(notes) {
    const resolved = (0, knowledge_note_1.resolveNormalizedVaultEdges)(notes.map((note) => ({
        path: note.relativePath,
        title: note.title,
        aliases: note.aliases,
        edges: note.edges,
    })));
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
            frontmatter: (0, knowledge_note_1.cloneVaultFrontmatter)(note.frontmatter),
            edges,
            wikilinks: edges,
        };
    });
}
function normalizeProtectedDirectoryName(configDir) {
    const normalized = (configDir || '').replace(/\\/g, '/').trim().replace(/\/+$/g, '');
    if (!normalized || normalized.includes('/')) {
        return '';
    }
    return normalized;
}
function shouldSkipDirectory(entryName, options) {
    const protectedDirectoryName = normalizeProtectedDirectoryName(options.vaultConfigDir);
    return !(0, safety_1.isSafeDirectoryName)(entryName, { protectedDirectoryName });
}
function isSkippableEntry(entry) {
    if (entry.isSymbolicLink()) {
        return true;
    }
    return false;
}
function scanDirectory(vaultRoot, directory, notes, errors, options) {
    const entries = node_fs_1.default
        .readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        if (shouldSkipDirectory(entry.name, options)) {
            continue;
        }
        if (isSkippableEntry(entry)) {
            continue;
        }
        const resolved = node_path_1.default.join(directory, entry.name);
        const safePath = (0, safety_1.ensureInsideVaultRoot)(vaultRoot, resolved);
        if (entry.isDirectory()) {
            scanDirectory(vaultRoot, safePath, notes, errors, options);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        const ext = node_path_1.default.extname(entry.name).toLowerCase();
        if (!NOTES_EXTENSIONS.has(ext)) {
            continue;
        }
        try {
            const fileContent = node_fs_1.default.readFileSync(safePath, 'utf8');
            const stats = node_fs_1.default.statSync(safePath);
            const relativePath = node_path_1.default.relative(vaultRoot, safePath).replace(/\\/g, '/');
            const note = scannedNoteFromContent({
                absolutePath: safePath,
                relativePath,
                fallbackTitle: node_path_1.default.basename(entry.name, ext),
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
        }
        catch (error) {
            errors.push({
                path: safePath,
                error: errorMessage(error),
            });
        }
    }
}
function scanVault(vaultRoot, options = {}) {
    const resolvedRoot = (0, safety_1.resolveVaultRoot)(vaultRoot);
    const notes = [];
    const errors = [];
    scanDirectory(resolvedRoot, resolvedRoot, notes, errors, options);
    const resolvedNotes = resolveScannedNoteEdges(notes);
    return {
        vaultRoot: resolvedRoot,
        scannedAt: new Date().toISOString(),
        notes: resolvedNotes,
        errors: errors.sort((left, right) => left.path.localeCompare(right.path)),
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
