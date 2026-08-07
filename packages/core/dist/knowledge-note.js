"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VaultSemanticPathError = exports.NORMALIZED_VAULT_NOTE_VERSION = void 0;
exports.hashVaultContent = hashVaultContent;
exports.cloneVaultFrontmatter = cloneVaultFrontmatter;
exports.normalizeVaultRelativePath = normalizeVaultRelativePath;
exports.resolveNormalizedVaultEdges = resolveNormalizedVaultEdges;
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
exports.NORMALIZED_VAULT_NOTE_VERSION = '1.0';
class VaultSemanticPathError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VaultSemanticPathError';
    }
}
exports.VaultSemanticPathError = VaultSemanticPathError;
function hashVaultContent(content) {
    return (0, node_crypto_1.createHash)('sha256').update(content, 'utf8').digest('hex');
}
function cloneVaultFrontmatter(frontmatter) {
    const result = {};
    const seen = new WeakSet();
    for (const [key, value] of Object.entries(frontmatter)) {
        if (isUnsafeMetadataKey(key)) {
            continue;
        }
        result[key] = cloneVaultMetadataValue(value, 0, seen);
    }
    return result;
}
function normalizeVaultRelativePath(value) {
    const replaced = value.replace(/\\/g, '/').trim();
    if (!replaced ||
        replaced.includes('\0') ||
        replaced.startsWith('/') ||
        /^[A-Za-z]:\//.test(replaced)) {
        throw new VaultSemanticPathError(`Unsafe Vault-relative path: ${value}`);
    }
    const normalized = node_path_1.default.posix.normalize(replaced.replace(/^\.\//, ''));
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
        throw new VaultSemanticPathError(`Unsafe Vault-relative path: ${value}`);
    }
    return normalized;
}
function cloneVaultMetadataValue(value, depth, seen) {
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
        const result = {};
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
function isUnsafeMetadataKey(key) {
    return key === '__proto__' || key === 'prototype' || key === 'constructor';
}
function resolveNormalizedVaultEdges(notes) {
    const sortedNotes = [...notes].sort((left, right) => left.path.localeCompare(right.path));
    const index = buildEdgeResolutionIndex(sortedNotes);
    const resolved = new Map();
    for (const note of sortedNotes) {
        const sourcePath = normalizeVaultRelativePath(note.path);
        const edges = note.edges.map((edge) => resolveNormalizedVaultEdge(edge, sourcePath, index));
        resolved.set(sourcePath, edges);
    }
    return resolved;
}
function buildEdgeResolutionIndex(notes) {
    const paths = new Map();
    const pathsWithoutExtensions = new Map();
    const basenames = new Map();
    const titles = new Map();
    const aliases = new Map();
    for (const note of notes) {
        const normalizedPath = normalizeVaultRelativePath(note.path);
        const normalizedKey = normalizeLookupToken(normalizedPath);
        const withoutExtension = stripKnownExtension(normalizedPath);
        paths.set(normalizedKey, normalizedPath);
        pathsWithoutExtensions.set(normalizeLookupToken(withoutExtension), normalizedPath);
        addLookupValue(basenames, node_path_1.default.posix.basename(withoutExtension), normalizedPath);
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
function resolveNormalizedVaultEdge(edge, sourcePath, index) {
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
        }
        catch {
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
    if (edge.resolution.status === 'unresolved' &&
        edge.resolution.reason === 'missing_reference_definition') {
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
function resolvePathTarget(target, sourcePath, index) {
    let candidate = target.replace(/\\/g, '/').trim();
    if (/^[A-Za-z]:\//.test(candidate)) {
        return { status: 'unsafe' };
    }
    if (candidate.startsWith('/')) {
        candidate = candidate.replace(/^\/+/, '');
    }
    else if (candidate.startsWith('./') || candidate.startsWith('../')) {
        candidate = node_path_1.default.posix.join(node_path_1.default.posix.dirname(sourcePath), candidate);
    }
    const normalized = node_path_1.default.posix.normalize(candidate);
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
function resolveUniqueLookupTarget(target, index) {
    const key = normalizeLookupToken(stripKnownExtension(target));
    if (!key) {
        return { status: 'missing' };
    }
    const groups = [index.titles.get(key), index.aliases.get(key), index.basenames.get(key)];
    const matches = new Set();
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
function withResolvedPath(edge, sourcePath, targetPath) {
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
function withUnresolvedReason(edge, sourcePath, reason, authority = 'fallback') {
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
function addLookupValue(index, rawKey, value) {
    const key = normalizeLookupToken(rawKey);
    if (!key) {
        return;
    }
    const values = index.get(key) ?? new Set();
    values.add(value);
    index.set(key, values);
}
function normalizeLookupToken(value) {
    return value.trim().toLocaleLowerCase('en-US');
}
function stripKnownExtension(value) {
    const extension = node_path_1.default.posix.extname(value).toLowerCase();
    if (extension === '.md' || extension === '.markdown') {
        return value.slice(0, -extension.length);
    }
    return value;
}
function isPathLikeTarget(target) {
    return (target.startsWith('.') ||
        target.startsWith('/') ||
        target.includes('/') ||
        target.includes('\\') ||
        node_path_1.default.posix.extname(target) !== '');
}
