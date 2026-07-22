"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scannedNoteFromContent = scannedNoteFromContent;
exports.scanVault = scanVault;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const safety_1 = require("./safety");
const markdown_1 = require("./markdown");
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
    return {
        absolutePath: input.absolutePath,
        relativePath: input.relativePath.replace(/\\/g, '/'),
        title: parsed.title || input.fallbackTitle,
        size: input.size,
        modifiedAt: input.modifiedAt,
        tokens: parsed.searchText,
        frontmatter: parsed.frontmatter.fields,
        aliases,
        type: typeof parsed.frontmatter.fields.type === 'string' ? parsed.frontmatter.fields.type : undefined,
        tags: parsed.tags,
        headings: parsed.headings,
        blockIds: parsed.blockIds,
        wikilinks: parsed.wikilinks,
        claimBlocks: parsed.claimBlocks,
        evidenceBlocks: parsed.evidenceBlocks,
        content: parsed.body,
    };
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
    const entries = node_fs_1.default.readdirSync(directory, { withFileTypes: true });
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
            notes.push(scannedNoteFromContent({
                absolutePath: safePath,
                relativePath,
                fallbackTitle: node_path_1.default.basename(entry.name, ext),
                size: stats.size,
                modifiedAt: stats.mtime.toISOString(),
                content: fileContent,
            }));
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
    return {
        vaultRoot: resolvedRoot,
        scannedAt: new Date().toISOString(),
        notes,
        errors,
    };
}
