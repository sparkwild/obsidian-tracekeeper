import { TFile, Vault, normalizePath, type FileManager } from 'obsidian';
import {
	OperationConflictError,
	OperationalLogRepository, isOperationalLogPath, logHash,
	VaultPathError,
	computeFileVersion,
	hashVaultContent,
	isSafeDirectoryName,
	type VaultPath,
	type VaultRepository,
	type VaultTextFile,
	type VaultTextMetadata,
	type VaultWriteReceipt,
} from '@tracekeeper/core';
import {
	ensureObsidianVaultFolderPath,
	withObsidianVaultPathLock,
} from './obsidian-vault-path-lock';

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);

export class ObsidianVaultRepository implements VaultRepository {
	constructor(
		private readonly vault: Vault,
		private readonly fileManager: FileManager,
		private readonly logs?: OperationalLogRepository,
		readonly appendActivityEvent?: (entry: string) => Promise<{ path: string }>
	) {}

	generateMarkdownLink(
		targetPath: VaultPath,
		sourcePath: VaultPath,
		subpath = '',
		alias = ''
	): string {
		const safeTargetPath = this.normalizeRelativePath(targetPath);
		const safeSourcePath = this.normalizeRelativePath(sourcePath);
		const target = this.vault.getAbstractFileByPath(safeTargetPath);
		if (!(target instanceof TFile)) {
			throw new VaultPathError(`Markdown link target is not a file: ${safeTargetPath}`);
		}
		return this.fileManager.generateMarkdownLink(
			target,
			safeSourcePath,
			subpath,
			alias
		);
	}

	async readText(relativePath: VaultPath): Promise<VaultTextFile | null> {
  if (this.logs && isOperationalLogPath(relativePath)) {
   const content = await this.logs.readText(relativePath);
   return content === null ? null : { path: relativePath, content, version: logHash(content), size: Buffer.byteLength(content), modifiedAt: '' };
  }
		const safePath = this.normalizeRelativePath(relativePath);
		const file = this.vault.getAbstractFileByPath(safePath);
		if (!file) {
			return null;
		}
		if (!(file instanceof TFile)) {
			throw new VaultPathError(`Vault path is not a file: ${safePath}`);
		}
		const content = await this.vault.read(file);
		return {
			path: safePath,
			content,
			version: this.fileVersion(file, content),
			size: file.stat.size,
			modifiedAt: new Date(file.stat.mtime).toISOString(),
		};
	}

	async createText(relativePath: VaultPath, content: string): Promise<VaultWriteReceipt> {
  if (this.logs && isOperationalLogPath(relativePath)) { await this.logs.replaceText(relativePath, null, content); return { path: relativePath, version: logHash(content), size: Buffer.byteLength(content), modifiedAt: new Date().toISOString() }; }
		const safePath = this.normalizeRelativePath(relativePath);
		return withObsidianVaultPathLock(this.vault, safePath, async () => {
			if (this.vault.getAbstractFileByPath(safePath)) {
				throw new OperationConflictError(`Target already exists: ${safePath}`);
			}
			await this.ensureFolder(safePath.split('/').slice(0, -1).join('/'));
			let file: TFile;
			try {
				file = await this.vault.create(safePath, content);
			} catch (error: unknown) {
				if (this.vault.getAbstractFileByPath(safePath)) {
					throw new OperationConflictError(`Target already exists: ${safePath}`);
				}
				throw error;
			}
			return this.receipt(file, content);
		});
	}

	async replaceText(
		relativePath: VaultPath,
		expectedVersion: string,
		content: string,
		canWrite?: () => boolean
	): Promise<VaultWriteReceipt> {
		if (this.logs && isOperationalLogPath(relativePath)) { await this.logs.replaceText(relativePath, expectedVersion, content); return { path: relativePath, version: logHash(content), size: Buffer.byteLength(content), modifiedAt: new Date().toISOString() }; }
		const safePath = this.normalizeRelativePath(relativePath);
		return withObsidianVaultPathLock(this.vault, safePath, async () => {
			const file = this.vault.getAbstractFileByPath(safePath);
			if (!(file instanceof TFile)) {
				throw new OperationConflictError(`Target does not exist: ${safePath}`);
			}
			const writtenContent = await this.vault.process(file, (currentContent) => {
				if (canWrite && !canWrite()) throw new OperationConflictError('Background maintenance deferred while a native edit decision is open.');
				if (this.fileVersion(file, currentContent) !== expectedVersion) {
					throw new OperationConflictError(`CAS check failed for ${safePath}`);
				}
				return content;
			});
			return this.receipt(file, writtenContent);
		});
	}

	async deleteText(relativePath: VaultPath, expectedVersion: string): Promise<void> {
		if (isOperationalLogPath(relativePath)) throw new Error('Operational logs require lossless maintenance.');
		const safePath = this.normalizeRelativePath(relativePath);
		await withObsidianVaultPathLock(this.vault, safePath, async () => {
			const file = this.vault.getAbstractFileByPath(safePath);
			if (!(file instanceof TFile)) {
				throw new OperationConflictError(`Target does not exist: ${safePath}`);
			}
			const content = await this.vault.read(file);
			if (this.fileVersion(file, content) !== expectedVersion) {
				throw new OperationConflictError(`CAS check failed for ${safePath}`);
			}
			await this.fileManager.trashFile(file);
		});
	}

	async listMarkdown(scope?: VaultPath): Promise<readonly VaultTextMetadata[]> {
		const safeScope = scope ? this.normalizeRelativePath(scope) : '';
		const files = (safeScope ? this.collectMarkdownFiles(safeScope) : this.vault.getFiles())
			.filter((file) => MARKDOWN_EXTENSIONS.has(file.extension.toLowerCase()))
			.filter((file) => this.isSafeExistingPath(file.path));
		const metadata = await Promise.all(files.map(async (file) => {
			const content = await this.vault.read(file);
			return {
				path: file.path,
				version: this.fileVersion(file, content),
				size: file.stat.size,
				modifiedAt: new Date(file.stat.mtime).toISOString(),
			};
		}));
		return metadata.sort((left, right) => left.path.localeCompare(right.path));
	}

	private collectMarkdownFiles(scope: VaultPath): TFile[] {
		const root = this.vault.getFolderByPath(scope);
		if (!root) return [];
		const files: TFile[] = [];
		Vault.recurseChildren(root, (child) => {
			if (child instanceof TFile) files.push(child);
		});
		return files;
	}

	private normalizeRelativePath(input: VaultPath): VaultPath {
		const trimmed = input.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
		if (!trimmed) {
			throw new VaultPathError('Vault path cannot be empty.');
		}
		const normalized = normalizePath(trimmed);
		if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
			throw new VaultPathError(`Unsafe vault path: ${input}`);
		}
		for (const segment of normalized.split('/')) {
			if (!isSafeDirectoryName(segment, {
				allowHidden: false,
				protectedDirectoryName: this.vault.configDir,
			})) {
				throw new VaultPathError(`Unsafe vault path segment: ${segment}`);
			}
		}
		return normalized;
	}

	private isSafeExistingPath(filePath: string): boolean {
		try {
			this.normalizeRelativePath(filePath);
			return true;
		} catch {
			return false;
		}
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		await ensureObsidianVaultFolderPath(
			this.vault,
			folderPath,
			(path) => new VaultPathError(
				`Vault folder path is occupied by a file: ${path}`
			)
		);
	}

	private fileVersion(file: TFile, content: string): string {
		return [
			computeFileVersion(file.stat.size, new Date(file.stat.mtime).toISOString()),
			hashVaultContent(content),
		].join('|');
	}

	private receipt(file: TFile, content: string): VaultWriteReceipt {
		return {
			path: file.path,
			version: this.fileVersion(file, content),
			size: file.stat.size,
			modifiedAt: new Date(file.stat.mtime).toISOString(),
		};
	}
}
