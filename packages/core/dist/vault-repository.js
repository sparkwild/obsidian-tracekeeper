"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeFsVaultRepository = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = require("node:fs");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const knowledge_index_1 = require("./knowledge-index");
const safety_1 = require("./safety");
const operation_journal_1 = require("./operation-journal");
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
function defaultAllowedHidden(options) {
    return options.allowHidden === true;
}
function vaultToAbsolutePath(vaultRoot, normalizedPath) {
    return node_path_1.default.resolve(vaultRoot, normalizedPath);
}
function vaultRelativeFromAbsolute(vaultRoot, absolutePath) {
    return node_path_1.default.relative(vaultRoot, absolutePath).replace(/\\/g, '/');
}
function formatTempPath(targetPath) {
    return `${targetPath}.${node_crypto_1.default.randomBytes(4).toString('hex')}.tmp`;
}
class NodeFsVaultRepository {
    constructor(options) {
        this.vaultRoot = (0, safety_1.resolveVaultRoot)(options.vaultRoot);
        this.allowHidden = defaultAllowedHidden(options);
        this.protectedDirectoryName = options.protectedDirectoryName;
    }
    normalizeRelativePath(input) {
        const normalized = input
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .replace(/\/+$/, '')
            .replace(/\/+/g, '/');
        if (!normalized) {
            throw new safety_1.VaultPathError('Vault path cannot be empty.');
        }
        const normalizedPath = node_path_1.default.posix.normalize(normalized);
        if (normalizedPath === '.' || normalizedPath === '..' || normalizedPath.startsWith('../')) {
            throw new safety_1.VaultPathError(`Unsafe vault path: ${input}`);
        }
        const segments = normalizedPath.split('/').filter(Boolean);
        for (const segment of segments) {
            if (!(0, safety_1.isSafeDirectoryName)(segment, {
                allowHidden: this.allowHidden,
                protectedDirectoryName: this.protectedDirectoryName,
            })) {
                throw new safety_1.VaultPathError(`Unsafe vault path segment: ${segment}`);
            }
        }
        return normalizedPath;
    }
    resolveRelativePath(relativePath) {
        const normalized = this.normalizeRelativePath(relativePath);
        const absolutePath = vaultToAbsolutePath(this.vaultRoot, normalized);
        return (0, safety_1.ensureInsideVaultRoot)(this.vaultRoot, absolutePath);
    }
    async assertNoSymlinkSegments(targetPath) {
        const relative = node_path_1.default.relative(this.vaultRoot, targetPath);
        if (!relative || relative === '.') {
            return;
        }
        const parts = node_path_1.default.normalize(relative).split(node_path_1.default.sep).filter(Boolean);
        let cursor = this.vaultRoot;
        for (const part of parts) {
            cursor = node_path_1.default.join(cursor, part);
            let state;
            try {
                state = await promises_1.default.lstat(cursor);
            }
            catch (error) {
                if (error instanceof Error && error.code === 'ENOENT') {
                    break;
                }
                throw error;
            }
            if (state.isSymbolicLink()) {
                throw new safety_1.VaultPathError(`Vault path contains symbolic link segment: ${vaultRelativeFromAbsolute(this.vaultRoot, cursor)}`);
            }
        }
    }
    async ensureParentDirectories(targetPath) {
        const parentPath = node_path_1.default.dirname(targetPath);
        const relative = node_path_1.default.relative(this.vaultRoot, parentPath);
        if (!relative || relative === '.') {
            return;
        }
        const parts = node_path_1.default.normalize(relative).split(node_path_1.default.sep).filter(Boolean);
        let cursor = this.vaultRoot;
        for (const part of parts) {
            const existingParent = cursor;
            cursor = node_path_1.default.join(cursor, part);
            await this.assertNoSymlinkSegments(existingParent);
            let state;
            try {
                state = await promises_1.default.lstat(cursor);
            }
            catch (error) {
                if (!(error instanceof Error) || error.code !== 'ENOENT') {
                    throw error;
                }
                try {
                    await promises_1.default.mkdir(cursor);
                }
                catch (mkdirError) {
                    if (!(mkdirError instanceof Error) || mkdirError.code !== 'EEXIST') {
                        throw mkdirError;
                    }
                }
                state = await promises_1.default.lstat(cursor);
            }
            if (state.isSymbolicLink()) {
                throw new safety_1.VaultPathError(`Vault path contains symbolic link segment: ${vaultRelativeFromAbsolute(this.vaultRoot, cursor)}`);
            }
            if (!state.isDirectory()) {
                throw new safety_1.VaultPathError(`Vault path segment is not a directory: ${vaultRelativeFromAbsolute(this.vaultRoot, cursor)}`);
            }
            await this.assertNoSymlinkSegments(cursor);
        }
    }
    computeVersionFromStats(stats) {
        return (0, knowledge_index_1.computeFileVersion)(stats.size, stats.mtime.toISOString());
    }
    sameFileIdentity(left, right) {
        return left.dev === right.dev && left.ino === right.ino;
    }
    async readStats(targetPath) {
        await this.assertNoSymlinkSegments(targetPath);
        let state;
        try {
            state = await promises_1.default.lstat(targetPath);
        }
        catch (error) {
            if (error instanceof Error && error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
        if (state.isSymbolicLink()) {
            throw new safety_1.VaultPathError(`Vault path points to a symbolic link: ${vaultRelativeFromAbsolute(this.vaultRoot, targetPath)}`);
        }
        if (!state.isFile()) {
            throw new safety_1.VaultPathError(`Vault path is not a file: ${vaultRelativeFromAbsolute(this.vaultRoot, targetPath)}`);
        }
        return state;
    }
    async assertExpectedVersion(targetPath, expectation) {
        const state = await this.readStats(targetPath);
        if (expectation.type === 'mustBeAbsent') {
            if (state !== null) {
                throw new operation_journal_1.OperationConflictError(`Target already exists: ${vaultRelativeFromAbsolute(this.vaultRoot, targetPath)}`);
            }
            return;
        }
        if (state === null) {
            throw new operation_journal_1.OperationConflictError(`Target does not exist: ${vaultRelativeFromAbsolute(this.vaultRoot, targetPath)}`);
        }
        if (expectation.type !== 'mustExist' || expectation.version === undefined) {
            return;
        }
        const currentVersion = this.computeVersionFromStats(state);
        if (currentVersion !== expectation.version) {
            throw new operation_journal_1.OperationConflictError(`CAS check failed for ${vaultRelativeFromAbsolute(this.vaultRoot, targetPath)}`);
        }
    }
    async writeAtomicText(targetPath, content, expectation) {
        await this.assertExpectedVersion(targetPath, expectation);
        let state = null;
        if (expectation.type === 'mustExist' || expectation.type === 'mustBeAbsent') {
            state = await this.readStats(targetPath);
        }
        const previousMode = state?.mode;
        const tempPath = formatTempPath(targetPath);
        try {
            await promises_1.default.writeFile(tempPath, content, {
                encoding: 'utf8',
                mode: previousMode,
            });
            await this.assertExpectedVersion(targetPath, expectation);
            if (expectation.type === 'mustBeAbsent') {
                try {
                    await promises_1.default.link(tempPath, targetPath);
                }
                catch (error) {
                    if (error instanceof Error && error.code === 'EEXIST') {
                        throw new operation_journal_1.OperationConflictError(`Target already exists: ${vaultRelativeFromAbsolute(this.vaultRoot, targetPath)}`);
                    }
                    throw error;
                }
                await promises_1.default.unlink(tempPath);
            }
            else {
                await promises_1.default.rename(tempPath, targetPath);
            }
            const updated = await this.readStats(targetPath);
            if (updated === null) {
                throw new Error(`Failed to read written file after commit: ${vaultRelativeFromAbsolute(this.vaultRoot, targetPath)}`);
            }
            const normalizedRelativePath = vaultRelativeFromAbsolute(this.vaultRoot, targetPath);
            return {
                path: normalizedRelativePath,
                version: this.computeVersionFromStats(updated),
                size: updated.size,
                modifiedAt: updated.mtime.toISOString(),
            };
        }
        catch (error) {
            try {
                await promises_1.default.unlink(tempPath);
            }
            catch {
                // Best effort cleanup for temporary artifacts.
            }
            throw error;
        }
    }
    isMarkdownFile(relativePath) {
        return MARKDOWN_EXTENSIONS.has(node_path_1.default.extname(relativePath).toLowerCase());
    }
    isSafeSegment(segment) {
        return (0, safety_1.isSafeDirectoryName)(segment, {
            allowHidden: this.allowHidden,
            protectedDirectoryName: this.protectedDirectoryName,
        });
    }
    async walkMarkdownNotes(absoluteDir, relativePrefix, result) {
        let entries;
        try {
            entries = await promises_1.default.readdir(absoluteDir, { withFileTypes: true });
        }
        catch (error) {
            if (error instanceof Error && error.code === 'ENOENT') {
                return;
            }
            throw error;
        }
        for (const entry of entries) {
            if (!this.isSafeSegment(entry.name)) {
                continue;
            }
            if (entry.isSymbolicLink()) {
                continue;
            }
            const absoluteChild = node_path_1.default.join(absoluteDir, entry.name);
            const relativeChild = (relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name).replace(/\\/g, '/');
            if (entry.isDirectory()) {
                await this.walkMarkdownNotes(absoluteChild, relativeChild, result);
                continue;
            }
            if (!entry.isFile() || !this.isMarkdownFile(relativeChild)) {
                continue;
            }
            const state = await this.readStats(absoluteChild);
            if (state === null) {
                continue;
            }
            result.push({
                path: relativeChild,
                version: this.computeVersionFromStats(state),
                size: state.size,
                modifiedAt: state.mtime.toISOString(),
            });
        }
    }
    async readText(relativePath) {
        const absolutePath = this.resolveRelativePath(relativePath);
        await this.assertNoSymlinkSegments(absolutePath);
        const readFlags = process.platform === 'win32'
            ? node_fs_1.constants.O_RDONLY
            : node_fs_1.constants.O_RDONLY | node_fs_1.constants.O_NOFOLLOW;
        let handle;
        try {
            handle = await promises_1.default.open(absolutePath, readFlags);
        }
        catch (error) {
            if (error instanceof Error && error.code === 'ENOENT') {
                return null;
            }
            if (error instanceof Error && error.code === 'ELOOP') {
                throw new safety_1.VaultPathError(`Vault path points to a symbolic link: ${vaultRelativeFromAbsolute(this.vaultRoot, absolutePath)}`);
            }
            throw error;
        }
        try {
            const openedState = await handle.stat();
            if (!openedState.isFile()) {
                throw new safety_1.VaultPathError(`Vault path is not a file: ${vaultRelativeFromAbsolute(this.vaultRoot, absolutePath)}`);
            }
            const content = await handle.readFile({ encoding: 'utf8' });
            const completedState = await handle.stat();
            const pathState = await this.readStats(absolutePath);
            if (pathState === null
                || !this.sameFileIdentity(openedState, completedState)
                || !this.sameFileIdentity(completedState, pathState)
                || this.computeVersionFromStats(openedState) !== this.computeVersionFromStats(completedState)
                || this.computeVersionFromStats(completedState) !== this.computeVersionFromStats(pathState)) {
                throw new operation_journal_1.OperationConflictError(`Vault file changed during read: ${vaultRelativeFromAbsolute(this.vaultRoot, absolutePath)}`);
            }
            return {
                path: this.normalizeRelativePath(relativePath),
                content,
                version: this.computeVersionFromStats(completedState),
                size: completedState.size,
                modifiedAt: completedState.mtime.toISOString(),
            };
        }
        finally {
            await handle.close();
        }
    }
    async createText(relativePath, content) {
        const absolutePath = this.resolveRelativePath(relativePath);
        await this.ensureParentDirectories(absolutePath);
        await this.writeAtomicText(absolutePath, content, { type: 'mustBeAbsent' });
        const state = await this.readStats(absolutePath);
        if (state === null) {
            throw new Error(`Failed to verify written file: ${vaultRelativeFromAbsolute(this.vaultRoot, absolutePath)}`);
        }
        return {
            path: this.normalizeRelativePath(relativePath),
            version: this.computeVersionFromStats(state),
            size: state.size,
            modifiedAt: state.mtime.toISOString(),
        };
    }
    async replaceText(relativePath, expectedVersion, content) {
        const absolutePath = this.resolveRelativePath(relativePath);
        return this.writeAtomicText(absolutePath, content, {
            type: 'mustExist',
            version: expectedVersion,
        });
    }
    async deleteText(relativePath, expectedVersion) {
        const absolutePath = this.resolveRelativePath(relativePath);
        const state = await this.readStats(absolutePath);
        if (state === null) {
            throw new operation_journal_1.OperationConflictError(`Target does not exist: ${vaultRelativeFromAbsolute(this.vaultRoot, absolutePath)}`);
        }
        if (this.computeVersionFromStats(state) !== expectedVersion) {
            throw new operation_journal_1.OperationConflictError(`CAS check failed for ${vaultRelativeFromAbsolute(this.vaultRoot, absolutePath)}`);
        }
        try {
            await promises_1.default.unlink(absolutePath);
        }
        catch (error) {
            if (error instanceof Error && error.code === 'ENOENT') {
                throw new operation_journal_1.OperationConflictError(`Target does not exist: ${vaultRelativeFromAbsolute(this.vaultRoot, absolutePath)}`);
            }
            throw error;
        }
    }
    async listMarkdown(scope) {
        const normalizedScope = scope ? this.normalizeRelativePath(scope) : '';
        const startPath = normalizedScope ? this.resolveRelativePath(normalizedScope) : this.vaultRoot;
        const result = [];
        await this.walkMarkdownNotes(startPath, normalizedScope, result);
        return result.sort((left, right) => left.path.localeCompare(right.path));
    }
}
exports.NodeFsVaultRepository = NodeFsVaultRepository;
