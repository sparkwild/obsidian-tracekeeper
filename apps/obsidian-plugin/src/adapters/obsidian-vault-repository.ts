import { TFile, TFolder, Vault, normalizePath } from 'obsidian';
import {
	OperationConflictError,
	VaultPathError,
	computeFileVersion,
	isSafeDirectoryName,
	type VaultPath,
	type VaultRepository,
	type VaultTextFile,
	type VaultTextMetadata,
	type VaultWriteReceipt,
} from '@tracekeeper/core';

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);

export class ObsidianVaultRepository implements VaultRepository {
	constructor(private readonly vault: Vault) {}

	async readText(relativePath: VaultPath): Promise<VaultTextFile | null> {
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
			version: this.fileVersion(file),
			size: file.stat.size,
			modifiedAt: new Date(file.stat.mtime).toISOString(),
		};
	}

	async createText(relativePath: VaultPath, content: string): Promise<VaultWriteReceipt> {
		const safePath = this.normalizeRelativePath(relativePath);
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
		return this.receipt(file);
	}

	async replaceText(
		relativePath: VaultPath,
		expectedVersion: string,
		content: string
	): Promise<VaultWriteReceipt> {
		const safePath = this.normalizeRelativePath(relativePath);
		const file = this.vault.getAbstractFileByPath(safePath);
		if (!(file instanceof TFile)) {
			throw new OperationConflictError(`Target does not exist: ${safePath}`);
		}
		if (this.fileVersion(file) !== expectedVersion) {
			throw new OperationConflictError(`CAS check failed for ${safePath}`);
		}
		await this.vault.modify(file, content);
		return this.receipt(file);
	}

	async listMarkdown(scope?: VaultPath): Promise<readonly VaultTextMetadata[]> {
		const safeScope = scope ? this.normalizeRelativePath(scope) : '';
		const prefix = safeScope ? `${safeScope}/` : '';
		return this.vault.getFiles()
			.filter((file) => MARKDOWN_EXTENSIONS.has(file.extension.toLowerCase()))
			.filter((file) => !safeScope || file.path === safeScope || file.path.startsWith(prefix))
			.filter((file) => this.isSafeExistingPath(file.path))
			.map((file) => ({
				path: file.path,
				version: this.fileVersion(file),
				size: file.stat.size,
				modifiedAt: new Date(file.stat.mtime).toISOString(),
			}))
			.sort((left, right) => left.path.localeCompare(right.path));
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
		if (!folderPath) {
			return;
		}
		let current = '';
		for (const segment of folderPath.split('/')) {
			current = current ? `${current}/${segment}` : segment;
			const existing = this.vault.getAbstractFileByPath(current);
			if (!existing) {
				await this.vault.createFolder(current);
				continue;
			}
			if (!(existing instanceof TFolder)) {
				throw new VaultPathError(`Vault folder path is occupied by a file: ${current}`);
			}
		}
	}

	private fileVersion(file: TFile): string {
		return computeFileVersion(file.stat.size, new Date(file.stat.mtime).toISOString());
	}

	private receipt(file: TFile): VaultWriteReceipt {
		return {
			path: file.path,
			version: this.fileVersion(file),
			size: file.stat.size,
			modifiedAt: new Date(file.stat.mtime).toISOString(),
		};
	}
}
