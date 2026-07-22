"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolInputError = void 0;
exports.toSafeVaultRoot = toSafeVaultRoot;
exports.normalizeNotePath = normalizeNotePath;
exports.assertNoSymlinkSegments = assertNoSymlinkSegments;
exports.resolveSafeNotePath = resolveSafeNotePath;
exports.resolveSafeWritableNotePath = resolveSafeWritableNotePath;
exports.relativeFromAbsolute = relativeFromAbsolute;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const core_1 = require("@tracekeeper/core");
const TEXT_LIKE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text']);
const MARKDOWN_EXTENSIONS = new Set(['.md']);
class ToolInputError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolInputError';
    }
}
exports.ToolInputError = ToolInputError;
function toSafeText(value, field) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
        throw new ToolInputError(`${field} is required and must be a non-empty string.`);
    }
    return text;
}
function toPosix(value) {
    return value.replace(/\\/g, '/').trim();
}
function relativePosixFromVaultRoot(vaultRoot, absolutePath) {
    const rawRelative = path.relative(vaultRoot, absolutePath);
    if (rawRelative === '..' ||
        rawRelative.startsWith(`..${path.sep}`) ||
        rawRelative.startsWith('../') ||
        path.isAbsolute(rawRelative)) {
        throw new core_1.VaultPathError('Path is outside vault root.');
    }
    return toPosix(rawRelative);
}
function toSafeVaultRoot(vaultRoot) {
    const safeVaultRoot = toSafeText(vaultRoot, 'vaultRoot');
    return (0, core_1.resolveVaultRoot)(safeVaultRoot);
}
function normalizeConfigDir(configDir) {
    const normalizedInput = toPosix(configDir || '');
    if (!normalizedInput || path.posix.isAbsolute(normalizedInput)) {
        return '';
    }
    const normalized = path.posix.normalize(normalizedInput).replace(/\/+$/g, '');
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
        return '';
    }
    return normalized;
}
function isVaultConfigPath(relativePath, options = {}) {
    const configDir = normalizeConfigDir(options.vaultConfigDir);
    return Boolean(configDir && (relativePath === configDir || relativePath.startsWith(`${configDir}/`)));
}
function assertNotVaultConfigPath(relativePath, action, options = {}) {
    if (isVaultConfigPath(relativePath.replace(/\\/g, '/'), options)) {
        throw new core_1.VaultPathError(`${action} Obsidian configuration paths are not allowed.`);
    }
}
function normalizeNotePath(rawPath, options = {}) {
    const safeRawPath = toSafeText(rawPath, 'path');
    const normalizedInput = toPosix(safeRawPath);
    if (path.posix.isAbsolute(normalizedInput)) {
        throw new ToolInputError('Absolute paths are not allowed. Use vault-relative paths.');
    }
    if (normalizedInput === '' || normalizedInput === '.' || normalizedInput === '..' || normalizedInput.startsWith('..' + '/')) {
        throw new ToolInputError('Path traversal is not allowed.');
    }
    const normalized = path.posix.normalize(normalizedInput);
    if (normalized === '' || normalized.startsWith('..') || normalized.includes('/../')) {
        throw new ToolInputError('Path traversal is not allowed.');
    }
    assertNotVaultConfigPath(normalized, 'Reading', options);
    const segments = normalized.split('/');
    for (const segment of segments) {
        if (segment === '') {
            continue;
        }
        if (!(0, core_1.isSafeDirectoryName)(segment, { allowHidden: true })) {
            throw new ToolInputError(`Path contains unsafe segment: ${segment}`);
        }
    }
    return normalized;
}
function hasTextLikeExtension(candidate) {
    const ext = path.extname(candidate).toLowerCase();
    return TEXT_LIKE_EXTENSIONS.has(ext);
}
function hasMarkdownExtension(candidate) {
    const ext = path.extname(candidate).toLowerCase();
    return MARKDOWN_EXTENSIONS.has(ext);
}
function resolveCandidatePath(vaultRoot, candidate) {
    const absoluteCandidate = path.resolve(vaultRoot, candidate);
    return (0, core_1.ensureInsideVaultRoot)(vaultRoot, absoluteCandidate);
}
function assertNoSymlinkSegments(vaultRoot, absolutePath) {
    const relative = relativePosixFromVaultRoot(vaultRoot, absolutePath);
    const segments = relative.split('/').filter(Boolean);
    let cursor = vaultRoot;
    for (const segment of segments) {
        cursor = path.join(cursor, segment);
        if (!fs.existsSync(cursor)) {
            continue;
        }
        const stat = fs.lstatSync(cursor);
        if (stat.isSymbolicLink()) {
            throw new core_1.VaultPathError('Symlink paths are not allowed for note reads.');
        }
    }
}
function resolveSafeNotePath(vaultRoot, rawPath, options = {}) {
    const candidate = normalizeNotePath(rawPath, options);
    const candidatePaths = hasTextLikeExtension(candidate)
        ? [candidate]
        : [candidate, `${candidate}.md`, `${candidate}.markdown`, `${candidate}.txt`, `${candidate}.text`];
    for (const candidatePath of candidatePaths) {
        const absolute = resolveCandidatePath(vaultRoot, candidatePath);
        assertNotVaultConfigPath(relativeFromAbsolute(vaultRoot, absolute), 'Reading', options);
        if (!hasTextLikeExtension(absolute)) {
            continue;
        }
        if (!fs.existsSync(absolute)) {
            continue;
        }
        assertNoSymlinkSegments(vaultRoot, absolute);
        const stat = fs.lstatSync(absolute);
        if (!stat.isFile()) {
            throw new ToolInputError(`Path is not a file: ${candidatePath}`);
        }
        return absolute;
    }
    throw new core_1.VaultPathError('Note not found or not a markdown/text-like file inside vault.');
}
function resolveSafeWritableNotePath(vaultRoot, rawPath, allowedDirectory, options = {}) {
    const candidate = normalizeNotePath(rawPath, options);
    const withMarkdown = hasMarkdownExtension(candidate) ? candidate : `${candidate}.md`;
    const absolute = path.resolve(vaultRoot, withMarkdown);
    const resolved = (0, core_1.ensureInsideVaultRoot)(vaultRoot, absolute);
    const relative = relativePosixFromVaultRoot(vaultRoot, resolved);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new core_1.VaultPathError('Path is outside vault root.');
    }
    const normalizedAllowed = path.posix.normalize(allowedDirectory.replace(/\\/g, '/')).replace(/\/+$/g, '');
    if (!normalizedAllowed || normalizedAllowed.includes('..')) {
        throw new ToolInputError('Allowed directory prefix is invalid.');
    }
    const allowedPrefix = `${normalizedAllowed}/`;
    if (!relative.startsWith(allowedPrefix)) {
        throw new ToolInputError(`Path must be under ${normalizedAllowed}`);
    }
    if (!hasMarkdownExtension(relative)) {
        throw new ToolInputError('Only markdown (.md) files can be written.');
    }
    assertNotVaultConfigPath(relative, 'Writing', options);
    assertNoSymlinkSegments(vaultRoot, resolved);
    if (fs.existsSync(resolved)) {
        throw new ToolInputError('Target file already exists and cannot be overwritten.');
    }
    return {
        absolutePath: resolved,
        relativePath: relative,
    };
}
function relativeFromAbsolute(vaultRoot, absolutePath) {
    return relativePosixFromVaultRoot(vaultRoot, absolutePath);
}
