import path from 'node:path';
import type {
	App,
	CachedMetadata,
	FrontmatterLinkCache,
	Pos,
	ReferenceCache,
	ReferenceLinkCache,
	TAbstractFile,
	TFile,
} from 'obsidian';
import {
	InMemoryKnowledgeIndex,
	cloneVaultFrontmatter,
	hashVaultContent,
	NORMALIZED_VAULT_NOTE_VERSION,
	normalizeVaultRelativePath,
	scannedNoteFromNormalized,
	type KnowledgeSnapshot,
	type KnowledgeReadView,
	type KnowledgeIndexReport,
	type NormalizedVaultCallout,
	type NormalizedVaultEdge,
	type NormalizedVaultEdgeKind,
	type NormalizedVaultNote,
	type NormalizedVaultSection,
	type VaultSourceRange,
	type ScanError,
	type ScanResult,
	type ScannedNote,
	type VaultSemanticEvent,
} from '@tracekeeper/core';

type IndexEventKind = 'create' | 'modify';
type PendingIndexEvent =
	| { kind: 'upsert'; eventKind: IndexEventKind; path: string; sequence: number }
	| { kind: 'delete'; path: string; sequence: number }
	| { kind: 'rename'; path: string; newPath: string; sequence: number };
type NativeReference = Pick<ReferenceCache, 'link' | 'original' | 'displayText' | 'position'>
	| (FrontmatterLinkCache & { position?: Pos })
	| ReferenceLinkCache;

class MetadataUnavailableError extends Error {
	constructor(readonly notePath: string) {
		super(`Obsidian metadata is not ready for ${notePath}.`);
		this.name = 'MetadataUnavailableError';
	}
}

export class ObsidianKnowledgeIndexAdapter {
	static readonly MAX_PENDING_INDEX_EVENTS = 256;
	private rebuildPromise: Promise<KnowledgeIndexReport> | null = null;
	private rebuilding = false;
	private pendingEvents = new Map<string, PendingIndexEvent>();
	private pendingRescanEvent: PendingIndexEvent | null = null;
	private metadataInitialized = false;
	private recoveryRequired = false;
	private unavailablePaths = new Set<string>();
	private nextEventSequence = 0;
	private eventChain: Promise<void> = Promise.resolve();

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
		try {
			const initialScan = await this.readCurrentVault();
			this.metadataInitialized = true;
			this.unavailablePaths = new Set(initialScan.errors.map((error) => error.path));
			const report = await this.index.rebuild(initialScan);
			const replayWarnings = await this.replayPendingEvents();
			return this.currentReport([...report.warnings, ...replayWarnings]);
		} catch (error) {
			this.recoveryRequired = true;
			throw error;
		} finally {
			this.rebuilding = false;
		}
	}

	private async replayPendingEvents(): Promise<string[]> {
		const warnings: string[] = [];

		while (this.pendingRescanEvent || this.pendingEvents.size > 0) {
			const rescanEvent = this.pendingRescanEvent;
			if (rescanEvent) {
				this.pendingRescanEvent = null;
				try {
					const recoveryReport = await this.rebuildThroughEvent(rescanEvent);
					warnings.push(...recoveryReport.warnings);
					warnings.push('Recovered the current Vault snapshot after the queued-event bound was reached.');
				} catch (error) {
					this.pendingRescanEvent = laterPendingEvent(this.pendingRescanEvent, rescanEvent);
					this.recoveryRequired = true;
					throw error;
				}
				continue;
			}

			const queued = [...this.pendingEvents.values()].sort(
				(left, right) => left.sequence - right.sequence
			);
			this.pendingEvents.clear();
			let failureCount = 0;
			for (const event of queued) {
				try {
					await this.applyPendingEvent(event);
				} catch {
					failureCount += 1;
				}
			}
			if (failureCount === 0) {
				continue;
			}

			const latestEvent = queued.at(-1);
			if (!latestEvent) {
				continue;
			}
			try {
				const recoveryReport = await this.rebuildThroughEvent(latestEvent);
				warnings.push(...recoveryReport.warnings);
				warnings.push(
					`Recovered the current Vault snapshot after ${failureCount} queued replay event failure(s).`
				);
			} catch (error) {
				this.pendingRescanEvent = laterPendingEvent(this.pendingRescanEvent, latestEvent);
				this.recoveryRequired = true;
				throw error;
			}
		}

		this.recoveryRequired = false;
		this.rebuilding = false;
		return warnings;
	}

	private async readCurrentVault(): Promise<ScanResult> {
		const notes: ScannedNote[] = [];
		const errors: ScanError[] = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!isMarkdownFile(file)) {
				continue;
			}
			try {
				notes.push(await readNativeScannedNote(this.app, this.vaultRoot, file));
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
		return initialScan;
	}

	scanSnapshot(requestedVaultRoot: string): ScanResult | null {
		if (path.resolve(requestedVaultRoot) !== this.vaultRoot) {
			return null;
		}
		const snapshot = this.index.scanSnapshot();
		const indexState = this.rebuilding
			? 'rebuilding'
			: this.recoveryRequired || !this.metadataInitialized || this.unavailablePaths.size > 0
				? 'initializing'
				: snapshot.index?.index_state ?? 'initializing';
		return indexState !== snapshot.index?.index_state
			? {
					...snapshot,
					index: {
						index_state: indexState,
						generation: snapshot.index?.generation ?? 0,
						event_sequence: snapshot.index?.event_sequence ?? 0,
						last_rebuild: snapshot.index?.last_rebuild ?? null,
					},
			  }
			: snapshot;
	}

	async knowledgeSnapshot(): Promise<KnowledgeSnapshot> {
		const snapshot = await this.index.snapshot();
		if (this.rebuilding) {
			return { ...snapshot, index_state: 'rebuilding' };
		}
		if (this.recoveryRequired || !this.metadataInitialized || this.unavailablePaths.size > 0) {
			return { ...snapshot, index_state: 'initializing' };
		}
		return snapshot;
	}

	async knowledgeReadView(requestedVaultRoot: string): Promise<KnowledgeReadView | null> {
		if (path.resolve(requestedVaultRoot) !== this.vaultRoot) {
			return null;
		}
		const view = await this.index.readView();
		if (this.rebuilding) {
			return { ...view, index_state: 'rebuilding' };
		}
		if (this.recoveryRequired || !this.metadataInitialized || this.unavailablePaths.size > 0) {
			return { ...view, index_state: 'initializing' };
		}
		return view;
	}

	async applyCreate(file: TAbstractFile): Promise<void> {
		if (!isMarkdownFile(file)) {
			return;
		}
		const sequence = this.allocateSequence();
		await this.enqueueEvent(async () => {
			if (this.shouldQueueEvents()) {
				this.queuePendingEvent({ kind: 'upsert', eventKind: 'create', path: file.path, sequence });
				return;
			}
			await this.applyCreateOrModify('create', file, sequence);
		});
	}

	async applyModify(
		file: TAbstractFile,
		currentContent?: string,
		currentCache?: CachedMetadata
	): Promise<void> {
		if (!isMarkdownFile(file)) {
			return;
		}
		const sequence = this.allocateSequence();
		await this.enqueueEvent(async () => {
			if (this.shouldQueueEvents()) {
				this.queuePendingEvent({ kind: 'upsert', eventKind: 'modify', path: file.path, sequence });
				return;
			}
			await this.applyCreateOrModify('modify', file, sequence, currentContent, currentCache);
		});
	}

	async applyDelete(file: TAbstractFile): Promise<void> {
		if (!isMarkdownFile(file)) {
			return;
		}
		const sequence = this.allocateSequence();
		await this.enqueueEvent(async () => {
			this.unavailablePaths.delete(file.path);
			if (this.shouldQueueEvents()) {
				this.queuePendingEvent({ kind: 'delete', path: file.path, sequence });
				return;
			}
			await this.index.applySemantic({
				schemaVersion: NORMALIZED_VAULT_NOTE_VERSION,
				sequence,
				kind: 'delete',
				path: file.path,
				exists: false,
			});
		});
	}

	async applyRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (!isMarkdownPath(oldPath)) {
			if (isMarkdownFile(file)) {
				await this.applyCreate(file);
			}
			return;
		}
		const sequence = this.allocateSequence();
		await this.enqueueEvent(async () => {
			if (this.shouldQueueEvents()) {
				this.queuePendingEvent({ kind: 'rename', path: oldPath, newPath: file.path, sequence });
				return;
			}
			if (isMarkdownPath(oldPath) && !isMarkdownFile(file)) {
				this.unavailablePaths.delete(oldPath);
				await this.refreshNativeGraph();
				await this.index.applySemantic({
					schemaVersion: NORMALIZED_VAULT_NOTE_VERSION,
					sequence,
					kind: 'rename',
					path: oldPath,
					newPath: file.path,
					exists: false,
				});
				return;
			}
			if (!isMarkdownFile(file)) {
				return;
			}
			try {
				const note = await readNativeScannedNote(this.app, this.vaultRoot, file);
				this.unavailablePaths.delete(oldPath);
				this.unavailablePaths.delete(file.path);
				await this.refreshNativeGraph();
				await this.index.applySemantic({
					schemaVersion: NORMALIZED_VAULT_NOTE_VERSION,
					sequence,
					kind: 'rename',
					path: oldPath,
					newPath: file.path,
					exists: true,
					contentHash: note.contentHash,
					note,
				});
			} catch (error) {
				if (!(error instanceof MetadataUnavailableError)) {
					throw error;
				}
				this.unavailablePaths.delete(oldPath);
				this.unavailablePaths.add(file.path);
				await this.index.applySemantic({
					schemaVersion: NORMALIZED_VAULT_NOTE_VERSION,
					sequence,
					kind: 'delete',
					path: oldPath,
					exists: false,
				});
			}
		});
	}

	generateMarkdownLink(target: TFile, sourcePath: string, subpath = '', alias = ''): string {
		return this.app.fileManager.generateMarkdownLink(target, sourcePath, subpath, alias);
	}

	async waitForRename(
		oldPath: string,
		newPath: string,
		timeoutMs = 5_000
	): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		do {
			const file = this.app.vault.getAbstractFileByPath(newPath);
			if (file && isMarkdownFile(file) && this.app.metadataCache.getFileCache(file)) {
				const current = await this.knowledgeSnapshot();
				if (current.notes.has(newPath) && !current.notes.has(oldPath)) {
					return;
				}
				await this.applyRename(file, oldPath);
				const updated = await this.knowledgeSnapshot();
				if (updated.notes.has(newPath) && !updated.notes.has(oldPath)) {
					return;
				}
			}
			await new Promise<void>((resolve) => {
				window.setTimeout(resolve, 25);
			});
		} while (Date.now() <= deadline);
		throw new MetadataUnavailableError(newPath);
	}

	private async applyCreateOrModify(
		kind: IndexEventKind,
		file: TFile,
		sequence: number,
		currentContent?: string,
		currentCache?: CachedMetadata,
	): Promise<void> {
		try {
			const note = await readNativeScannedNote(
				this.app,
				this.vaultRoot,
				file,
				currentContent,
				currentCache
			);
			this.unavailablePaths.delete(file.path);
			const event: VaultSemanticEvent = {
				schemaVersion: NORMALIZED_VAULT_NOTE_VERSION,
				sequence,
				kind,
				path: file.path,
				exists: true,
				contentHash: note.contentHash,
				note,
			};
			await this.index.applySemantic(event);
		} catch (error) {
			if (!(error instanceof MetadataUnavailableError)) {
				throw error;
			}
			this.unavailablePaths.add(file.path);
		}
	}

	private shouldQueueEvents(): boolean {
		return this.rebuilding || this.recoveryRequired;
	}

	private queuePendingEvent(event: PendingIndexEvent): void {
		if (this.pendingRescanEvent) {
			this.pendingRescanEvent = laterPendingEvent(this.pendingRescanEvent, event);
			return;
		}
		if (event.kind === 'rename') {
			this.pendingEvents.clear();
			this.pendingRescanEvent = event;
			return;
		}
		const existing = this.pendingEvents.get(event.path);
		if (existing) {
			this.pendingEvents.set(event.path, laterPendingEvent(existing, event));
			return;
		}
		if (this.pendingEvents.size >= ObsidianKnowledgeIndexAdapter.MAX_PENDING_INDEX_EVENTS) {
			const latestQueued = [...this.pendingEvents.values()].reduce(laterPendingEvent, event);
			this.pendingEvents.clear();
			this.pendingRescanEvent = latestQueued;
			return;
		}
		this.pendingEvents.set(event.path, event);
	}

	private async applyPendingEvent(event: PendingIndexEvent): Promise<void> {
		if (event.kind === 'rename') {
			throw new Error('Queued rename events require a current-Vault rebuild.');
		}
		const file = this.findMarkdownFile(event.path);
		if (!file) {
			this.unavailablePaths.delete(event.path);
			await this.index.applySemantic({
				schemaVersion: NORMALIZED_VAULT_NOTE_VERSION,
				sequence: event.sequence,
				kind: 'delete',
				path: event.path,
				exists: false,
			});
			return;
		}
		await this.applyCreateOrModify(
			event.kind === 'upsert' ? event.eventKind : 'modify',
			file,
			event.sequence
		);
	}

	private async rebuildThroughEvent(event: PendingIndexEvent): Promise<KnowledgeIndexReport> {
		const recoveryScan = await this.readCurrentVault();
		this.metadataInitialized = true;
		this.unavailablePaths = new Set(recoveryScan.errors.map((error) => error.path));
		const report = await this.index.rebuild(recoveryScan);
		await this.index.advanceEventSequenceAfterRebuild(event.sequence);
		return report;
	}

	private findMarkdownFile(filePath: string): TFile | null {
		const direct = this.app.vault.getAbstractFileByPath?.(filePath);
		if (direct && isMarkdownFile(direct)) {
			return direct;
		}
		return this.app.vault.getMarkdownFiles().find((file) => file.path === filePath) ?? null;
	}

	private async enqueueEvent(apply: () => Promise<void>): Promise<void> {
		const next = this.eventChain.then(apply);
		this.eventChain = next.then(
			() => undefined,
			() => undefined
		);
		await next;
	}

	private async refreshNativeGraph(): Promise<void> {
		const scan = await this.readCurrentVault();
		this.metadataInitialized = true;
		this.unavailablePaths = new Set(scan.errors.map((error) => error.path));
		await this.index.rebuild(scan);
	}

	private allocateSequence(): number {
		this.nextEventSequence += 1;
		return this.nextEventSequence;
	}

	private async currentReport(warnings: readonly string[] = []): Promise<KnowledgeIndexReport> {
		const snapshot = await this.index.snapshot();
		return {
			index_state: this.recoveryRequired || this.unavailablePaths.size > 0
				? 'initializing'
				: snapshot.index_state,
			generation: snapshot.generation,
			event_sequence: snapshot.event_sequence,
			note_count: snapshot.notes.size,
			created_at: snapshot.createdAt,
			warnings: [...warnings],
		};
	}
}

function laterPendingEvent<T extends PendingIndexEvent>(left: T | null, right: T): T;
function laterPendingEvent(left: PendingIndexEvent | null, right: PendingIndexEvent): PendingIndexEvent;
function laterPendingEvent(left: PendingIndexEvent | null, right: PendingIndexEvent): PendingIndexEvent {
	return !left || right.sequence >= left.sequence ? right : left;
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
	return 'extension' in file && (file.extension === 'md' || file.extension === 'markdown');
}

function isMarkdownPath(filePath: string): boolean {
	const extension = path.extname(filePath).toLowerCase();
	return extension === '.md' || extension === '.markdown';
}

async function readNativeScannedNote(
	app: App,
	vaultRoot: string,
	file: TFile,
	currentContent?: string,
	currentCache?: CachedMetadata
): Promise<ScannedNote> {
	const cache = currentCache ?? app.metadataCache.getFileCache(file);
	if (!cache) {
		throw new MetadataUnavailableError(file.path);
	}
	const content = currentContent ?? await app.vault.read(file);
	return scannedNoteFromNormalized(
		normalizeNativeNote(app, file, content, cache),
		vaultRoot
	);
}

function normalizeNativeNote(
	app: App,
	file: TFile,
	content: string,
	cache: CachedMetadata
): NormalizedVaultNote {
	const notePath = normalizeVaultRelativePath(file.path);
	const frontmatter = normalizeFrontmatter(cache);
	const title = firstNativeString(frontmatter.title) || file.basename;
	const aliases = normalizeAliases(frontmatter.aliases, title);
	const edges = normalizeNativeEdges(app, notePath, content, cache);
	const sections = normalizeNativeSections(cache);
	const callouts = normalizeNativeCallouts(content, cache, sections, edges);
	const bodyStart = clampOffset(cache.frontmatterPosition?.end.offset ?? 0, content.length);
	const body = content.slice(bodyStart).replace(/^\r?\n/, '');

	return {
		schemaVersion: NORMALIZED_VAULT_NOTE_VERSION,
		path: notePath,
		exists: true,
		contentHash: hashVaultContent(content),
		title,
		aliases,
		type: firstNativeString(frontmatter.type) || undefined,
		frontmatter,
		semanticErrors: [],
		tags: normalizeNativeTags(cache, frontmatter.tags),
		headings: uniqueStrings((cache.headings ?? []).map((heading) => heading.heading)),
		blockIds: uniqueStrings(Object.values(cache.blocks ?? {}).map((block) => block.id)),
		sections,
		callouts,
		edges,
		text: content,
		content: body,
		modifiedAt: new Date(file.stat.mtime).toISOString(),
		size: Buffer.byteLength(content, 'utf8'),
	};
}

function normalizeFrontmatter(cache: CachedMetadata): Record<string, unknown> {
	const frontmatter = cloneVaultFrontmatter(cache.frontmatter ?? {});
	delete frontmatter.position;
	return frontmatter;
}

function normalizeAliases(value: unknown, title: string): string[] {
	const aliases = typeof value === 'string'
		? value.split(',').map((entry) => entry.trim())
		: Array.isArray(value)
			? value.filter((entry): entry is string => typeof entry === 'string')
			: [];
	return uniqueStrings([...aliases, title]);
}

function normalizeNativeTags(cache: CachedMetadata, frontmatterTags: unknown): string[] {
	const tags = (cache.tags ?? []).map((entry) => entry.tag);
	if (typeof frontmatterTags === 'string') {
		tags.push(...frontmatterTags.split(/[,\s]+/));
	} else if (Array.isArray(frontmatterTags)) {
		tags.push(...frontmatterTags.filter((entry): entry is string => typeof entry === 'string'));
	}
	return uniqueStrings(tags.map((tag) => tag.trim().replace(/^#+/, '')).filter(Boolean));
}

function normalizeNativeSections(cache: CachedMetadata): NormalizedVaultSection[] {
	const sections: NormalizedVaultSection[] = [];
	if (cache.frontmatterPosition) {
		sections.push({
			type: 'frontmatter',
			position: normalizePosition(cache.frontmatterPosition),
		});
	}
	for (const section of cache.sections ?? []) {
		const type = normalizeNativeSectionType(section.type);
		if (!type) {
			continue;
		}
		sections.push({
			type,
			position: normalizePosition(section.position),
		});
	}
	return deduplicateSections(sections);
}

function normalizeNativeSectionType(type: string): NormalizedVaultSection['type'] | null {
	switch (type.toLowerCase()) {
		case 'yaml':
			return 'frontmatter';
		case 'heading':
			return 'heading';
		case 'code':
			return 'fenced-code';
		case 'html':
			return 'html-comment';
		case 'callout':
			return 'callout';
		default:
			return null;
	}
}

function normalizeNativeEdges(
	app: App,
	sourcePath: string,
	content: string,
	cache: CachedMetadata
): NormalizedVaultEdge[] {
	const edges: NormalizedVaultEdge[] = [];
	for (const reference of cache.links ?? []) {
		edges.push(normalizeNativeReference(app, sourcePath, content, reference, 'link', 'body'));
	}
	for (const reference of cache.embeds ?? []) {
		edges.push(normalizeNativeReference(app, sourcePath, content, reference, 'embed', 'body'));
	}
	for (const reference of cache.frontmatterLinks ?? []) {
		edges.push(normalizeNativeReference(
			app,
			sourcePath,
			content,
			{ ...reference, position: cache.frontmatterPosition },
			'frontmatter',
			'frontmatter'
		));
	}
	for (const reference of cache.referenceLinks ?? []) {
		edges.push(normalizeNativeReference(app, sourcePath, content, reference, 'reference', 'body'));
	}
	return edges.sort(compareNativeEdges);
}

function normalizeNativeReference(
	app: App,
	sourcePath: string,
	content: string,
	reference: NativeReference,
	kind: NormalizedVaultEdgeKind,
	source: 'body' | 'frontmatter'
): NormalizedVaultEdge {
	const rawTarget = reference.link.trim();
	const parsed = splitNativeLink(rawTarget);
	const position = normalizePosition('position' in reference ? reference.position : undefined);
	const displayText = 'displayText' in reference ? reference.displayText : undefined;
	const resolution = resolveNativeTarget(app, sourcePath, parsed.linkPath, parsed.subpath);
	const raw = 'original' in reference && reference.original
		? reference.original
		: slicePosition(content, position) || rawTarget;

	return {
		kind,
		source,
		raw,
		target: parsed.linkPath,
		linkPath: parsed.linkPath,
		displayText,
		alias: displayText,
		heading: parsed.subpath,
		subpath: parsed.subpath,
		subpathKind: parsed.subpath
			? parsed.subpath.startsWith('^') ? 'block' : 'heading'
			: undefined,
		referenceLabel: 'id' in reference ? reference.id : undefined,
		line: position.start.line,
		position,
		sourcePath,
		resolution,
	};
}

function resolveNativeTarget(
	app: App,
	sourcePath: string,
	linkPath: string,
	subpath?: string
): NormalizedVaultEdge['resolution'] {
	if (!linkPath) {
		return subpath
			? { status: 'resolved', path: sourcePath, authority: 'native' }
			: { status: 'unresolved', reason: 'empty_target', authority: 'native' };
	}
	const target = app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
	if (!target) {
		return { status: 'unresolved', reason: 'not_found', authority: 'native' };
	}
	try {
		return {
			status: 'resolved',
			path: normalizeVaultRelativePath(target.path),
			authority: 'native',
		};
	} catch {
		return { status: 'unresolved', reason: 'unsafe_path', authority: 'native' };
	}
}

function normalizeNativeCallouts(
	content: string,
	cache: CachedMetadata,
	sections: readonly NormalizedVaultSection[],
	edges: readonly NormalizedVaultEdge[]
): NormalizedVaultCallout[] {
	const blocks = Object.values(cache.blocks ?? {});
	const callouts: NormalizedVaultCallout[] = [];
	for (const section of sections.filter((entry) => entry.type === 'callout')) {
		const sectionText = slicePosition(content, section.position);
		const rawHeader = sectionText.split(/\r?\n/, 1)[0]?.trim() ?? '';
		const match = rawHeader.match(/^\s*>\s*\[!([^\]]+)\][+-]?(?:\s+.*)?$/i);
		if (!match?.[1]) {
			continue;
		}
		const sourceRefs = edges
			.filter((edge) =>
				edge.position.start.offset >= section.position.start.offset &&
				edge.position.end.offset <= section.position.end.offset &&
				/source::/i.test(lineAt(content, edge.position.start.line))
			)
			.map((edge) => edge.target)
			.filter(Boolean);
		const blockId = blocks.find((block) =>
			block.position.start.offset >= section.position.start.offset &&
			block.position.end.offset <= section.position.end.offset
		)?.id;
		callouts.push({
			type: match[1].toLowerCase(),
			rawHeader,
			content: sectionText
				.split(/\r?\n/)
				.map((line) => line.replace(/^\s*>\s?/, ''))
				.join('\n')
				.trim(),
			sourceRefs: uniqueStrings(sourceRefs),
			blockId,
			line: section.position.start.line + 1,
			endLine: section.position.end.line + 1,
			position: section.position,
		});
	}
	return callouts;
}

function splitNativeLink(value: string): { linkPath: string; subpath?: string } {
	const hashIndex = value.indexOf('#');
	const linkPath = (hashIndex >= 0 ? value.slice(0, hashIndex) : value).trim();
	const subpath = hashIndex >= 0 ? value.slice(hashIndex + 1).trim() : '';
	return {
		linkPath,
		subpath: subpath || undefined,
	};
}

function normalizePosition(position?: Pos): VaultSourceRange {
	const start = position?.start;
	const end = position?.end;
	return {
		start: {
			line: nonNegativeInteger(start?.line),
			column: nonNegativeInteger(start?.col),
			offset: nonNegativeInteger(start?.offset),
		},
		end: {
			line: nonNegativeInteger(end?.line),
			column: nonNegativeInteger(end?.col),
			offset: nonNegativeInteger(end?.offset),
		},
	};
}

function deduplicateSections(sections: readonly NormalizedVaultSection[]): NormalizedVaultSection[] {
	const seen = new Set<string>();
	return [...sections]
		.sort((left, right) =>
			left.position.start.offset - right.position.start.offset ||
			left.position.end.offset - right.position.end.offset ||
			left.type.localeCompare(right.type)
		)
		.filter((section) => {
			const key = `${section.type}:${section.position.start.offset}:${section.position.end.offset}`;
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		});
}

function compareNativeEdges(left: NormalizedVaultEdge, right: NormalizedVaultEdge): number {
	return left.position.start.offset - right.position.start.offset
		|| left.position.end.offset - right.position.end.offset
		|| left.kind.localeCompare(right.kind)
		|| left.linkPath.localeCompare(right.linkPath);
}

function firstNativeString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function nonNegativeInteger(value: number | undefined): number {
	return Number.isSafeInteger(value) && (value ?? 0) >= 0 ? value! : 0;
}

function clampOffset(value: number, length: number): number {
	return Math.min(Math.max(nonNegativeInteger(value), 0), length);
}

function slicePosition(content: string, position: VaultSourceRange): string {
	const start = clampOffset(position.start.offset, content.length);
	const end = Math.max(start, clampOffset(position.end.offset, content.length));
	return content.slice(start, end);
}

function lineAt(content: string, line: number): string {
	return content.split(/\r?\n/)[line] ?? '';
}
