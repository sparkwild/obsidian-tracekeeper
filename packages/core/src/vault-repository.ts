import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
	computeFileVersion,
	type VaultPath,
} from './knowledge-index';
import {
	ensureInsideVaultRoot,
	isSafeDirectoryName,
	resolveVaultRoot,
	VaultPathError,
} from './safety';
import {
	OperationConflictError,
} from './operation-journal';

export type VaultFileVersion = string;

export interface VaultTextFile {
	path: VaultPath;
	content: string;
	version: VaultFileVersion;
	size: number;
	modifiedAt: string;
}

export interface VaultWriteReceipt {
	path: VaultPath;
	version: VaultFileVersion;
	size: number;
	modifiedAt: string;
}

export interface VaultTextMetadata {
	path: VaultPath;
	version: VaultFileVersion;
	size: number;
	modifiedAt: string;
}

export interface VaultRepository {
	readText(relativePath: VaultPath): Promise<VaultTextFile | null>;
	createText(relativePath: VaultPath, content: string): Promise<VaultWriteReceipt>;
	replaceText(relativePath: VaultPath, expectedVersion: VaultFileVersion, content: string): Promise<VaultWriteReceipt>;
	listMarkdown(scope?: VaultPath): Promise<readonly VaultTextMetadata[]>;
}

export interface NodeFsVaultRepositoryOptions {
	vaultRoot: string;
	allowHidden?: boolean;
	protectedDirectoryName?: string;
}

interface FileVersionExpectation {
	type: 'mustExist' | 'mustBeAbsent' | 'none';
	version?: VaultFileVersion;
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

function defaultAllowedHidden(options: { allowHidden?: boolean }): boolean {
	return options.allowHidden === true;
}

function vaultToAbsolutePath(vaultRoot: string, normalizedPath: VaultPath): string {
	return path.resolve(vaultRoot, normalizedPath);
}

function vaultRelativeFromAbsolute(vaultRoot: string, absolutePath: string): VaultPath {
	return path.relative(vaultRoot, absolutePath).replace(/\\/g, '/');
}

function formatTempPath(targetPath: string): string {
	return `${targetPath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
}

export class NodeFsVaultRepository implements VaultRepository {
	private readonly vaultRoot: string;
	private readonly allowHidden: boolean;
	private readonly protectedDirectoryName: string | undefined;

	constructor(options: NodeFsVaultRepositoryOptions) {
		this.vaultRoot = resolveVaultRoot(options.vaultRoot);
		this.allowHidden = defaultAllowedHidden(options);
		this.protectedDirectoryName = options.protectedDirectoryName;
	}

	private normalizeRelativePath(input: VaultPath): VaultPath {
		const normalized = input
			.replace(/\\/g, '/')
			.replace(/^\/+/, '')
			.replace(/\/+$/, '')
			.replace(/\/+/g, '/');

		if (!normalized) {
			throw new VaultPathError('Vault path cannot be empty.');
		}

		const normalizedPath = path.posix.normalize(normalized);
		if (normalizedPath === '.' || normalizedPath === '..' || normalizedPath.startsWith('../')) {
			throw new VaultPathError(`Unsafe vault path: ${input}`);
		}

		const segments = normalizedPath.split('/').filter(Boolean);
		for (const segment of segments) {
			if (!isSafeDirectoryName(segment, {
				allowHidden: this.allowHidden,
				protectedDirectoryName: this.protectedDirectoryName,
			})) {
				throw new VaultPathError(`Unsafe vault path segment: ${segment}`);
			}
		}

		return normalizedPath as VaultPath;
	}

	private resolveRelativePath(relativePath: VaultPath): string {
		const normalized = this.normalizeRelativePath(relativePath);
		const absolutePath = vaultToAbsolutePath(this.vaultRoot, normalized);
		return ensureInsideVaultRoot(this.vaultRoot, absolutePath);
	}

	private async assertNoSymlinkSegments(targetPath: string): Promise<void> {
		const relative = path.relative(this.vaultRoot, targetPath);
		if (!relative || relative === '.') {
			return;
		}

		const parts = path.normalize(relative).split(path.sep).filter(Boolean);
		let cursor = this.vaultRoot;
		for (const part of parts) {
			cursor = path.join(cursor, part);
			let state;
			try {
				state = await fs.lstat(cursor);
			} catch (error: unknown) {
				if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
					break;
				}
				throw error;
			}

			if (state.isSymbolicLink()) {
				throw new VaultPathError(`Vault path contains symbolic link segment: ${vaultRelativeFromAbsolute(this.vaultRoot, cursor)}`);
			}
		}
	}

	private async ensureParentDirectories(targetPath: string): Promise<void> {
		const parentPath = path.dirname(targetPath);
		const relative = path.relative(this.vaultRoot, parentPath);
		if (!relative || relative === '.') {
			return;
		}

		const parts = path.normalize(relative).split(path.sep).filter(Boolean);
		let cursor = this.vaultRoot;
		for (const part of parts) {
			const existingParent = cursor;
			cursor = path.join(cursor, part);
			await this.assertNoSymlinkSegments(existingParent);

			let state: import('node:fs').Stats;
			try {
				state = await fs.lstat(cursor);
			} catch (error: unknown) {
				if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}

				try {
					await fs.mkdir(cursor);
				} catch (mkdirError: unknown) {
					if (!(mkdirError instanceof Error) || (mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') {
						throw mkdirError;
					}
				}
				state = await fs.lstat(cursor);
			}

			if (state.isSymbolicLink()) {
				throw new VaultPathError(
					`Vault path contains symbolic link segment: ${vaultRelativeFromAbsolute(this.vaultRoot, cursor)}`
				);
			}
			if (!state.isDirectory()) {
				throw new VaultPathError(
					`Vault path segment is not a directory: ${vaultRelativeFromAbsolute(this.vaultRoot, cursor)}`
				);
			}

			await this.assertNoSymlinkSegments(cursor);
		}
	}

	private computeVersionFromStats(stats: import('node:fs').Stats): VaultFileVersion {
		return computeFileVersion(stats.size, stats.mtime.toISOString());
	}

	private sameFileIdentity(
		left: import('node:fs').Stats,
		right: import('node:fs').Stats
	): boolean {
		return left.dev === right.dev && left.ino === right.ino;
	}

	private async readStats(targetPath: string): Promise<import('node:fs').Stats | null> {
		await this.assertNoSymlinkSegments(targetPath);
		let state;
		try {
			state = await fs.lstat(targetPath);
		} catch (error: unknown) {
			if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			throw error;
		}

		if (state.isSymbolicLink()) {
			throw new VaultPathError(`Vault path points to a symbolic link: ${vaultRelativeFromAbsolute(this.vaultRoot, targetPath)}`);
		}
		if (!state.isFile()) {
			throw new VaultPathError(`Vault path is not a file: ${vaultRelativeFromAbsolute(this.vaultRoot, targetPath)}`);
		}

		return state;
	}

	private async assertExpectedVersion(targetPath: string, expectation: FileVersionExpectation): Promise<void> {
		const state = await this.readStats(targetPath);
		if (expectation.type === 'mustBeAbsent') {
			if (state !== null) {
				throw new OperationConflictError(`Target already exists: ${vaultRelativeFromAbsolute(this.vaultRoot, targetPath)}`);
			}
			return;
		}

		if (state === null) {
			throw new OperationConflictError(`Target does not exist: ${vaultRelativeFromAbsolute(this.vaultRoot, targetPath)}`);
		}

		if (expectation.type !== 'mustExist' || expectation.version === undefined) {
			return;
		}

		const currentVersion = this.computeVersionFromStats(state);
		if (currentVersion !== expectation.version) {
			throw new OperationConflictError(`CAS check failed for ${vaultRelativeFromAbsolute(this.vaultRoot, targetPath)}`);
		}
	}

	private async writeAtomicText(targetPath: string, content: string, expectation: FileVersionExpectation): Promise<VaultWriteReceipt> {
		await this.assertExpectedVersion(targetPath, expectation);

		let state: import('node:fs').Stats | null = null;
		if (expectation.type === 'mustExist' || expectation.type === 'mustBeAbsent') {
			state = await this.readStats(targetPath);
		}
		const previousMode = state?.mode;
		const tempPath = formatTempPath(targetPath);

		try {
			await fs.writeFile(tempPath, content, {
				encoding: 'utf8',
				mode: previousMode,
			});

			await this.assertExpectedVersion(targetPath, expectation);
			if (expectation.type === 'mustBeAbsent') {
				try {
					await fs.link(tempPath, targetPath);
				} catch (error: unknown) {
					if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST') {
						throw new OperationConflictError(
							`Target already exists: ${vaultRelativeFromAbsolute(this.vaultRoot, targetPath)}`
						);
					}
					throw error;
				}
				await fs.unlink(tempPath);
			} else {
				await fs.rename(tempPath, targetPath);
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
		} catch (error: unknown) {
			try {
				await fs.unlink(tempPath);
			} catch {
				// Best effort cleanup for temporary artifacts.
			}
			throw error;
		}
	}

	private isMarkdownFile(relativePath: VaultPath): boolean {
		return MARKDOWN_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
	}

	private isSafeSegment(segment: string): boolean {
		return isSafeDirectoryName(segment, {
			allowHidden: this.allowHidden,
			protectedDirectoryName: this.protectedDirectoryName,
		});
	}

	private async walkMarkdownNotes(
		absoluteDir: string,
		relativePrefix: VaultPath,
		result: VaultTextMetadata[]
	): Promise<void> {
		let entries;
		try {
			entries = await fs.readdir(absoluteDir, { withFileTypes: true });
		} catch (error: unknown) {
			if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
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

			const absoluteChild = path.join(absoluteDir, entry.name);
			const relativeChild = (relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name).replace(/\\/g, '/') as VaultPath;

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

	async readText(relativePath: VaultPath): Promise<VaultTextFile | null> {
		const absolutePath = this.resolveRelativePath(relativePath);
		await this.assertNoSymlinkSegments(absolutePath);
		const readFlags = process.platform === 'win32'
			? fsConstants.O_RDONLY
			: fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
		let handle: import('node:fs/promises').FileHandle;
		try {
			handle = await fs.open(absolutePath, readFlags);
		} catch (error: unknown) {
			if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ELOOP') {
				throw new VaultPathError(
					`Vault path points to a symbolic link: ${vaultRelativeFromAbsolute(this.vaultRoot, absolutePath)}`
				);
			}
			throw error;
		}

		try {
			const openedState = await handle.stat();
			if (!openedState.isFile()) {
				throw new VaultPathError(
					`Vault path is not a file: ${vaultRelativeFromAbsolute(this.vaultRoot, absolutePath)}`
				);
			}
			const content = await handle.readFile({ encoding: 'utf8' });
			const completedState = await handle.stat();
			const pathState = await this.readStats(absolutePath);
			if (
				pathState === null
				|| !this.sameFileIdentity(openedState, completedState)
				|| !this.sameFileIdentity(completedState, pathState)
				|| this.computeVersionFromStats(openedState) !== this.computeVersionFromStats(completedState)
				|| this.computeVersionFromStats(completedState) !== this.computeVersionFromStats(pathState)
			) {
				throw new OperationConflictError(
					`Vault file changed during read: ${vaultRelativeFromAbsolute(this.vaultRoot, absolutePath)}`
				);
			}
			return {
				path: this.normalizeRelativePath(relativePath),
				content,
				version: this.computeVersionFromStats(completedState),
				size: completedState.size,
				modifiedAt: completedState.mtime.toISOString(),
			};
		} finally {
			await handle.close();
		}
	}

	async createText(relativePath: VaultPath, content: string): Promise<VaultWriteReceipt> {
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

	async replaceText(relativePath: VaultPath, expectedVersion: VaultFileVersion, content: string): Promise<VaultWriteReceipt> {
		const absolutePath = this.resolveRelativePath(relativePath);
		return this.writeAtomicText(absolutePath, content, {
			type: 'mustExist',
			version: expectedVersion,
		});
	}

	async listMarkdown(scope?: VaultPath): Promise<readonly VaultTextMetadata[]> {
		const normalizedScope = scope ? this.normalizeRelativePath(scope) : '' as VaultPath;
		const startPath = normalizedScope ? this.resolveRelativePath(normalizedScope) : this.vaultRoot;
		const result: VaultTextMetadata[] = [];

		await this.walkMarkdownNotes(startPath, normalizedScope, result);

		return result.sort((left, right) => left.path.localeCompare(right.path));
	}
}
