import path from 'node:path';
import type { App, TAbstractFile, TFile } from 'obsidian';
import {
	InMemoryKnowledgeIndex,
	computeFileVersion,
	scannedNoteFromContent,
	type KnowledgeSnapshot,
	type KnowledgeIndexReport,
	type ScanError,
	type ScanResult,
	type ScannedNote,
} from '@tracekeeper/core';

type IndexEventKind = 'create' | 'modify';

export class ObsidianKnowledgeIndexAdapter {
	private rebuildPromise: Promise<KnowledgeIndexReport> | null = null;
	private rebuilding = false;
	private pendingEvents: Array<() => Promise<void>> = [];

	private constructor(
		private readonly app: App,
		private readonly vaultRoot: string,
		private readonly index: InMemoryKnowledgeIndex
	) {}

	static create(app: App, vaultRoot: string): ObsidianKnowledgeIndexAdapter {
		const resolvedVaultRoot = path.resolve(vaultRoot);
		return new ObsidianKnowledgeIndexAdapter(
			app,
			resolvedVaultRoot,
			new InMemoryKnowledgeIndex({ vaultRoot: resolvedVaultRoot })
		);
	}

	async rebuild(): Promise<KnowledgeIndexReport> {
		if (this.rebuildPromise) {
			return this.rebuildPromise;
		}
		this.rebuildPromise = this.performRebuild().finally(() => {
			this.rebuildPromise = null;
		});
		return this.rebuildPromise;
	}

	private async performRebuild(): Promise<KnowledgeIndexReport> {
		this.rebuilding = true;
		const notes: ScannedNote[] = [];
		const errors: ScanError[] = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			try {
				notes.push(await readScannedNote(this.app, this.vaultRoot, file));
			} catch (error) {
				errors.push({
					path: file.path,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		const initialScan: ScanResult = {
			vaultRoot: this.vaultRoot,
			scannedAt: new Date().toISOString(),
			notes,
			errors,
		};
		try {
			const report = await this.index.rebuild(initialScan);
			while (this.pendingEvents.length > 0) {
				const pending = this.pendingEvents.splice(0);
				for (const apply of pending) {
					await apply();
				}
			}
			return report;
		} finally {
			this.rebuilding = false;
		}
	}

	scanSnapshot(requestedVaultRoot: string): ScanResult | null {
		if (path.resolve(requestedVaultRoot) !== this.vaultRoot) {
			return null;
		}
		const snapshot = this.index.scanSnapshot();
		return this.rebuilding
			? {
				...snapshot,
				index: {
					index_state: 'rebuilding',
					generation: snapshot.index?.generation ?? 0,
					last_rebuild: snapshot.index?.last_rebuild ?? null,
				},
			}
			: snapshot;
	}

	async knowledgeSnapshot(): Promise<KnowledgeSnapshot> {
		const snapshot = await this.index.snapshot();
		return this.rebuilding ? { ...snapshot, index_state: 'rebuilding' } : snapshot;
	}

	async applyCreate(file: TAbstractFile): Promise<void> {
		await this.applyCreateOrModify('create', file);
	}

	async applyModify(file: TAbstractFile): Promise<void> {
		await this.applyCreateOrModify('modify', file);
	}

	async applyDelete(file: TAbstractFile): Promise<void> {
		if (!isMarkdownFile(file)) {
			return;
		}
		await this.applyOrQueue(() => this.index.applyScanned({
			kind: 'delete',
			path: file.path,
			fileVersion: fileVersion(file),
		}));
	}

	async applyRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (isMarkdownPath(oldPath) && !isMarkdownFile(file)) {
			await this.applyOrQueue(() => this.index.applyScanned({
				kind: 'delete',
				path: oldPath,
				fileVersion: fileVersionFromAbstractFile(file),
			}));
			return;
		}
		if (!isMarkdownFile(file)) {
			return;
		}
		const note = await readScannedNote(this.app, this.vaultRoot, file);
		await this.applyOrQueue(() => this.index.applyScanned({
			kind: 'rename',
			path: oldPath,
			newPath: file.path,
			fileVersion: fileVersion(file),
		}, note));
	}

	private async applyCreateOrModify(kind: IndexEventKind, file: TAbstractFile): Promise<void> {
		if (!isMarkdownFile(file)) {
			return;
		}
		const note = await readScannedNote(this.app, this.vaultRoot, file);
		await this.applyOrQueue(() => this.index.applyScanned({
			kind,
			path: file.path,
			fileVersion: fileVersion(file),
		}, note));
	}

	private async applyOrQueue(apply: () => Promise<void>): Promise<void> {
		if (this.rebuilding) {
			this.pendingEvents.push(apply);
			return;
		}
		await apply();
	}
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
	return 'extension' in file && (file.extension === 'md' || file.extension === 'markdown');
}

function isMarkdownPath(filePath: string): boolean {
	const extension = path.extname(filePath).toLowerCase();
	return extension === '.md' || extension === '.markdown';
}

function fileVersionFromAbstractFile(file: TAbstractFile): string {
	if (!('stat' in file)) {
		return '';
	}
	const vaultFile = file as TFile;
	return computeFileVersion(vaultFile.stat.size, new Date(vaultFile.stat.mtime).toISOString());
}

function fileVersion(file: TFile): string {
	return computeFileVersion(file.stat.size, new Date(file.stat.mtime).toISOString());
}

async function readScannedNote(app: App, vaultRoot: string, file: TFile): Promise<ScannedNote> {
	const content = await app.vault.cachedRead(file);
	return scannedNoteFromContent({
		absolutePath: path.resolve(vaultRoot, file.path),
		relativePath: file.path,
		fallbackTitle: file.basename,
		size: file.stat.size,
		modifiedAt: new Date(file.stat.mtime).toISOString(),
		content,
	});
}
