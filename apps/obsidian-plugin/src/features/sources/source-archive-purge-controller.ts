import path from 'node:path';

import {
	SOURCE_ARCHIVE_PURGE_MAX_BYTES,
	SOURCE_ARCHIVE_PURGE_MAX_ITEMS,
	buildMaintenanceSnapshot,
	hashVaultContent,
	parseMarkdown,
	type KnowledgeReadView,
	type MaintenanceCandidateV1,
	type SourceArchiveEligibilityEvidenceV1,
} from '@tracekeeper/core';

import { LEGACY_SOURCE_CONSOLIDATION_JOURNAL_ROOT } from './legacy-source-consolidation-controller';

const PURGE_JOURNAL_ROOT = '00_tracekeeper/control/operations/source-archive-purges';
const SOURCE_MIGRATION_ARCHIVE_ROOT = '02_archive/source_migrations';
const PURGE_VERSION = 1 as const;
const PREVIEW_TTL_MS = 5 * 60 * 1000;

export type SourceArchivePurgeErrorCode =
	| 'PREVIEW_EXPIRED'
	| 'PREVIEW_STALE'
	| 'INVALID_CONFIRMATION'
	| 'NO_ELIGIBLE_ITEMS'
	| 'OPERATION_BINDING_CONFLICT';

export class SourceArchivePurgeError extends Error {
	constructor(readonly code: SourceArchivePurgeErrorCode, message: string) {
		super(message);
		this.name = 'SourceArchivePurgeError';
	}
}

type PurgeItemState = 'planned' | 'trashing' | 'verified' | 'failed' | 'conflict' | 'outcome_unknown';
type MigrationRootState = 'planned' | 'cleaning' | 'cleaned' | 'retained' | 'failed';

interface ConsolidationJournalItem {
	path?: string;
	oldPath?: string;
	destinationPath?: string;
	expectedHash: string;
	state: string;
}

interface ConsolidationJournalRecord {
	version: number;
	migrationId: string;
	planHash: string;
	revision: number;
	status: string;
	outputs: ConsolidationJournalItem[];
	archive: ConsolidationJournalItem[];
	bindingHash: string;
}

export interface SourceArchivePurgePreviewItem {
	candidateId: string;
	migrationId: string;
	archivePath: string;
	archiveHash: string;
	archiveBytes: number;
	replacementPartPath: string;
	replacementPartHash: string;
	replacementIndexPath: string;
	replacementIndexHash: string;
	materializationRevision: number;
	archiveRevision: number;
}

export interface SourceArchivePurgePreview {
	version: typeof PURGE_VERSION;
	operationId: string;
	snapshotGeneration: number;
	items: SourceArchivePurgePreviewItem[];
	blocked: MaintenanceCandidateV1[];
	totalBytes: number;
	deletionBehavior: string;
	manifestHash: string;
	confirmationToken: string;
	expiresAt: string;
	canApply: boolean;
}

export interface SourceArchivePurgeProgress {
	phase: 'preflight' | 'claim' | 'trash' | 'verify' | 'reindex' | 'cleanup' | 'complete';
	currentPath: string;
	completed: number;
	total: number;
}

export interface SourceArchivePurgeReceipt {
	version: typeof PURGE_VERSION;
	operationId: string;
	status: 'completed' | 'partial' | 'conflict' | 'outcome_unknown';
	completedCount: number;
	conflictCount: number;
	outcomeUnknownCount: number;
	resumableCount: number;
	totalCount: number;
	reclaimedBytes: number;
	cleanedMigrationRootCount: number;
	retainedMigrationRootCount: number;
	failedMigrationRootCount: number;
	journalPath: string;
	receiptPath: string;
}

interface PurgeJournalItem extends SourceArchivePurgePreviewItem {
	state: PurgeItemState;
	error: string;
}

interface PurgeMigrationRoot {
	path: string;
	state: MigrationRootState;
	error: string;
}

interface PurgeJournal {
	version: typeof PURGE_VERSION;
	operationId: string;
	manifestHash: string;
	snapshotGeneration: number;
	status: 'running' | SourceArchivePurgeReceipt['status'];
	items: PurgeJournalItem[];
	migrationRoots: PurgeMigrationRoot[];
	reindexVerified: boolean;
	createdAt: string;
	updatedAt: string;
	bindingHash: string;
}

export interface SourceArchivePurgeHost {
	readText(relativePath: string): Promise<string | null>;
	createText(relativePath: string, content: string): Promise<void>;
	writeText(relativePath: string, content: string): Promise<void>;
	listPaths(prefix: string): Promise<readonly string[]>;
	trashFile(relativePath: string): Promise<void>;
	trashEmptyMigrationTree(relativePath: string): Promise<'cleaned' | 'retained'>;
	knowledgeReadView(): Promise<KnowledgeReadView>;
	rebuildKnowledgeIndex(): Promise<void>;
	getDeletionBehavior(): string;
	now(): string;
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, nested) => {
		if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return nested;
		return Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)));
	});
}

function bindJournal(input: Omit<PurgeJournal, 'bindingHash'>): PurgeJournal {
	return { ...input, bindingHash: hashVaultContent(canonicalJson(input)) };
}

function parseJournal(raw: string): PurgeJournal {
	const value = JSON.parse(raw) as PurgeJournal;
	const unsigned = { ...value, bindingHash: undefined } as Omit<PurgeJournal, 'bindingHash'>;
	if (
		value.version !== PURGE_VERSION
		|| !value.operationId
		|| !value.manifestHash
		|| !Array.isArray(value.items)
		|| !Array.isArray(value.migrationRoots)
		|| typeof value.reindexVerified !== 'boolean'
		|| bindJournal(unsigned).bindingHash !== value.bindingHash
	) throw new Error('Source Archive purge journal is invalid.');
	return value;
}

function parseConsolidationJournal(raw: string): ConsolidationJournalRecord {
	const value = JSON.parse(raw) as ConsolidationJournalRecord;
	const unsigned = { ...value, bindingHash: undefined };
	if (
		!value.migrationId
		|| !value.planHash
		|| !Array.isArray(value.outputs)
		|| !Array.isArray(value.archive)
		|| typeof value.bindingHash !== 'string'
		|| hashVaultContent(canonicalJson(unsigned)) !== value.bindingHash
	) {
		throw new Error('Source consolidation journal is invalid.');
	}
	return value;
}

function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let offset = 0;
	while ((offset = haystack.indexOf(needle, offset)) >= 0) {
		count += 1;
		offset += Math.max(1, needle.length);
	}
	return count;
}

function stringField(frontmatter: Readonly<Record<string, unknown>>, key: string): string {
	const value = frontmatter[key];
	return typeof value === 'string' ? value.trim() : '';
}

function normalizeDeclaredHash(value: string): string {
	return value.replace(/^sha256:/iu, '').toLowerCase();
}

function stringList(frontmatter: Readonly<Record<string, unknown>>, key: string): string[] {
	const value = frontmatter[key];
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeOperationId(operationId: string): string {
	const normalized = operationId.trim();
	if (!/^source-archive-purge-[a-f0-9]{24}$/u.test(normalized)) throw new Error('Source Archive purge operation id is invalid.');
	return normalized;
}

function journalPath(operationId: string): string {
	return `${PURGE_JOURNAL_ROOT}/${normalizeOperationId(operationId)}.json`;
}

function receiptPath(operationId: string): string {
	return `${PURGE_JOURNAL_ROOT}/${normalizeOperationId(operationId)}.receipt.json`;
}

function expiry(now: string): string {
	const timestamp = Date.parse(now);
	if (!Number.isFinite(timestamp)) throw new Error('Source Archive purge clock is invalid.');
	return new Date(timestamp + PREVIEW_TTL_MS).toISOString();
}

function boundedError(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 512);
}

export class SourceArchivePurgeController {
	constructor(private readonly host: SourceArchivePurgeHost) {}

	async preview(): Promise<SourceArchivePurgePreview> {
		const view = await this.host.knowledgeReadView();
		const evidence = await this.collectEvidence(view);
		const maintenance = buildMaintenanceSnapshot(view, { sourceArchiveEvidence: evidence });
		const all = maintenance.candidates.filter((item) => item.category === 'source_archive_purge');
		const itemByPath = new Map(evidence.map((item) => [item.archive_path, item]));
		const items: SourceArchivePurgePreviewItem[] = [];
		const capacityBlocked: MaintenanceCandidateV1[] = [];
		let totalBytes = 0;
		for (const candidate of all.filter((item) => item.state === 'actionable')) {
			const archivePath = candidate.paths.find((item) => item.startsWith(`${SOURCE_MIGRATION_ARCHIVE_ROOT}/`));
			const item = archivePath ? itemByPath.get(archivePath) : undefined;
			if (!item) continue;
			if (item.archive_bytes > SOURCE_ARCHIVE_PURGE_MAX_BYTES) {
				capacityBlocked.push({ ...candidate, state: 'blocked', requestable: false, reclaimable_bytes: 0, reasons: [...candidate.reasons, 'archive_exceeds_batch_capacity'] });
				continue;
			}
			if (items.length >= SOURCE_ARCHIVE_PURGE_MAX_ITEMS || totalBytes + item.archive_bytes > SOURCE_ARCHIVE_PURGE_MAX_BYTES) break;
			const materialization = await this.readConsolidation(item.migration_id, false);
			const archived = await this.readConsolidation(item.migration_id, true);
			const replacementIndex = view.catalog.get(item.replacement_index_path);
			items.push({
				candidateId: candidate.candidate_id,
				migrationId: item.migration_id,
				archivePath: item.archive_path,
				archiveHash: item.archive_content_hash,
				archiveBytes: item.archive_bytes,
				replacementPartPath: item.replacement_part_path,
				replacementPartHash: item.replacement_part_hash,
				replacementIndexPath: item.replacement_index_path,
				replacementIndexHash: replacementIndex?.contentHash ?? '',
				materializationRevision: materialization?.revision ?? 0,
				archiveRevision: archived?.revision ?? 0,
			});
			totalBytes += item.archive_bytes;
		}
		const manifestHash = hashVaultContent(canonicalJson({
			version: PURGE_VERSION,
			generation: view.generation,
			items,
			deletionBehavior: this.host.getDeletionBehavior(),
		}));
		const operationId = `source-archive-purge-${manifestHash.slice(0, 24)}`;
		const expiresAt = expiry(this.host.now());
		return {
			version: PURGE_VERSION,
			operationId,
			snapshotGeneration: view.generation,
			items,
			blocked: [...all.filter((item) => item.state === 'blocked'), ...capacityBlocked],
			totalBytes,
			deletionBehavior: this.host.getDeletionBehavior(),
			manifestHash,
			confirmationToken: hashVaultContent(`${operationId}\0${manifestHash}\0${expiresAt}`),
			expiresAt,
			canApply: items.length > 0,
		};
	}

	async confirm(
		preview: SourceArchivePurgePreview,
		confirmationToken: string,
		onProgress?: (progress: SourceArchivePurgeProgress) => void,
	): Promise<SourceArchivePurgeReceipt> {
		if (preview.version !== PURGE_VERSION || confirmationToken !== preview.confirmationToken) {
			throw new SourceArchivePurgeError('INVALID_CONFIRMATION', 'Source Archive purge confirmation is invalid.');
		}
		if (Date.parse(preview.expiresAt) <= Date.parse(this.host.now())) {
			throw new SourceArchivePurgeError('PREVIEW_EXPIRED', 'Source Archive purge confirmation expired. Generate a new preview.');
		}
		if (!preview.canApply) throw new SourceArchivePurgeError('NO_ELIGIBLE_ITEMS', 'Source Archive purge preview has no eligible items.');
		onProgress?.({ phase: 'preflight', currentPath: '', completed: 0, total: preview.items.length });
		const fresh = await this.preview();
		if (fresh.manifestHash !== preview.manifestHash || fresh.snapshotGeneration !== preview.snapshotGeneration) {
			throw new SourceArchivePurgeError('PREVIEW_STALE', 'Source Archive purge preview is stale. No file was trashed.');
		}
		let journal = await this.readPurgeJournal(preview.operationId);
		if (!journal) {
			onProgress?.({ phase: 'claim', currentPath: '', completed: 0, total: preview.items.length });
			journal = bindJournal({
				version: PURGE_VERSION,
				operationId: preview.operationId,
				manifestHash: preview.manifestHash,
				snapshotGeneration: preview.snapshotGeneration,
				status: 'running',
				items: preview.items.map((item) => ({ ...item, state: 'planned', error: '' })),
				migrationRoots: [...new Set(preview.items.map((item) => item.migrationId))]
					.sort()
					.map((migrationId) => ({
						path: `${SOURCE_MIGRATION_ARCHIVE_ROOT}/${migrationId}`,
						state: 'planned' as const,
						error: '',
					})),
				reindexVerified: false,
				createdAt: this.host.now(),
				updatedAt: this.host.now(),
			});
			await this.writePurgeJournal(journal, null);
		}
		if (journal.manifestHash !== preview.manifestHash || journal.snapshotGeneration !== preview.snapshotGeneration) {
			throw new SourceArchivePurgeError('OPERATION_BINDING_CONFLICT', 'Source Archive purge operation is bound to another preview.');
		}
		return this.run(journal, onProgress);
	}

	async resume(
		operationId: string,
		onProgress?: (progress: SourceArchivePurgeProgress) => void,
	): Promise<SourceArchivePurgeReceipt> {
		const journal = await this.readPurgeJournal(operationId);
		if (!journal) throw new Error(`Source Archive purge operation not found: ${operationId}.`);
		return this.run(journal, onProgress);
	}

	async listRecoverableOperationIds(): Promise<string[]> {
		const result: string[] = [];
		for (const candidate of (await this.host.listPaths(PURGE_JOURNAL_ROOT)).filter((item) => item.endsWith('.json') && !item.endsWith('.receipt.json')).sort()) {
			try {
				const raw = await this.host.readText(candidate);
				const journal = raw === null ? null : parseJournal(raw);
				if (journal?.status === 'running' || journal?.status === 'partial') result.push(journal.operationId);
			} catch {
				// Invalid journals require manual inspection and are never auto-resumed.
			}
		}
		return result;
	}

	private async run(
		initial: PurgeJournal,
		onProgress?: (progress: SourceArchivePurgeProgress) => void,
	): Promise<SourceArchivePurgeReceipt> {
		let journal = initial;
		if (
			journal.status !== 'running'
			&& journal.status !== 'partial'
			&& !journal.migrationRoots.some((root) => root.state === 'failed' || root.state === 'cleaning')
		) return this.toReceipt(journal);
		for (const item of journal.items) {
			if (item.state === 'verified' || item.state === 'outcome_unknown') continue;
			if (item.state === 'trashing') {
				item.state = 'outcome_unknown';
				item.error = 'Trash outcome was not durably recorded; automatic retry is forbidden.';
				journal = await this.persist(journal);
				continue;
			}
			const completed = journal.items.filter((candidate) => candidate.state === 'verified').length;
			onProgress?.({ phase: 'trash', currentPath: item.archivePath, completed, total: journal.items.length });
			try {
				await this.assertCurrent(item);
				item.state = 'trashing';
				item.error = '';
				journal = await this.persist(journal);
				await this.host.trashFile(item.archivePath);
				if (await this.host.readText(item.archivePath) !== null) {
					item.state = 'outcome_unknown';
					item.error = 'Obsidian trash returned but the source path still exists.';
				} else {
					onProgress?.({ phase: 'verify', currentPath: item.archivePath, completed, total: journal.items.length });
					await this.assertReplacementCurrent(item);
					item.state = 'verified';
				}
			} catch (error) {
				if (item.state === 'trashing') {
					item.state = 'outcome_unknown';
				} else {
					const message = boundedError(error);
					item.state = /changed|drifted|disappeared|unavailable/i.test(message) ? 'conflict' : 'failed';
				}
				item.error = boundedError(error);
			}
			journal = await this.persist(journal);
		}
		let completed = journal.items.filter((item) => item.state === 'verified').length;
		if (completed > 0 && !journal.reindexVerified) {
			onProgress?.({ phase: 'reindex', currentPath: '', completed, total: journal.items.length });
			await this.host.rebuildKnowledgeIndex();
			for (const item of journal.items.filter((candidate) => candidate.state === 'verified')) {
				try {
					if (await this.host.readText(item.archivePath) !== null) throw new Error('Archive source reappeared after index rebuild.');
					await this.assertReplacementCurrent(item);
				} catch (error) {
					item.state = 'conflict';
					item.error = boundedError(error);
				}
			}
			if (journal.items.some((item) => item.state === 'conflict')) {
				journal = await this.persist(journal);
			}
			journal.reindexVerified = true;
			journal = await this.persist(journal);
		}
		completed = journal.items.filter((item) => item.state === 'verified').length;
		if (completed === journal.items.length) {
			journal = await this.cleanupMigrationTrees(journal, onProgress);
		}
		const conflicts = journal.items.filter((item) => item.state === 'conflict').length;
		const unknown = journal.items.filter((item) => item.state === 'outcome_unknown').length;
		const resumable = journal.items.filter((item) => item.state === 'failed' || item.state === 'planned').length;
		const rootFailures = journal.migrationRoots.filter((root) => root.state === 'failed' || root.state === 'cleaning').length;
		journal.status = unknown > 0
			? 'outcome_unknown'
			: conflicts > 0
				? 'conflict'
				: resumable > 0 || rootFailures > 0
					? 'partial'
					: completed === journal.items.length
						? 'completed'
						: 'partial';
		journal = await this.persist(journal);
		const receipt = this.toReceipt(journal);
		await this.writeReceipt(receipt);
		onProgress?.({ phase: 'complete', currentPath: '', completed, total: journal.items.length });
		return receipt;
	}

	private async collectEvidence(view: KnowledgeReadView): Promise<SourceArchiveEligibilityEvidenceV1[]> {
		const journalPaths = (await this.host.listPaths(LEGACY_SOURCE_CONSOLIDATION_JOURNAL_ROOT))
			.filter((item) => item.endsWith('.archive.json'))
			.sort();
		const wikiEntries = [...view.catalog.values()].filter((entry) => entry.path.startsWith('01_knowledge/wiki/'));
		const managedSourceRefs = new Set(wikiEntries.flatMap((entry) => [...entry.managedSources]));
		const evidence: SourceArchiveEligibilityEvidenceV1[] = [];
		const knownArchivePaths = new Set<string>();
		const activePurgePaths = new Set<string>();
		let invalidPurgeJournal = false;
		for (const candidate of (await this.host.listPaths(PURGE_JOURNAL_ROOT)).filter((item) => item.endsWith('.json') && !item.endsWith('.receipt.json'))) {
			try {
				const raw = await this.host.readText(candidate);
				const purge = raw === null ? null : parseJournal(raw);
				if (purge?.status === 'running' || purge?.status === 'partial') {
					for (const item of purge.items) if (item.state !== 'verified') activePurgePaths.add(item.archivePath);
				}
			} catch {
				invalidPurgeJournal = true;
			}
		}
		for (const archiveJournalPath of journalPaths) {
			const migrationId = path.posix.basename(archiveJournalPath).replace(/\.archive\.json$/u, '');
			const materialization = await this.readConsolidation(migrationId, false);
			const archive = await this.readConsolidation(migrationId, true);
			if (
				!materialization
				|| !archive
				|| materialization.migrationId !== migrationId
				|| archive.migrationId !== migrationId
				|| materialization.planHash !== archive.planHash
			) continue;
			const partsByLegacyPath = new Map<string, Array<{ path: string; content: string; frontmatter: Record<string, unknown> }>>();
			for (const output of materialization?.outputs ?? []) {
				if (!output.path || !output.path.includes('.parts/')) continue;
				const content = await this.host.readText(output.path);
				if (content === null) continue;
				const frontmatter = parseMarkdown(content).frontmatter.fields;
				const legacyPath = stringField(frontmatter, 'legacy_source_path');
				if (!legacyPath) continue;
				const rows = partsByLegacyPath.get(legacyPath) ?? [];
				rows.push({ path: output.path, content, frontmatter });
				partsByLegacyPath.set(legacyPath, rows);
			}
			const parentFrontmatterByPath = new Map<string, Record<string, unknown> | null>();
			const outputHashesValid = (materialization?.outputs ?? []).every((output) => {
				const entry = output.path ? view.catalog.get(output.path) : undefined;
				return output.state === 'verified' && Boolean(entry) && entry?.contentHash === output.expectedHash;
			});
			for (const archiveItem of archive.archive) {
				const archivePath = archiveItem.destinationPath ?? '';
				if (archivePath) knownArchivePaths.add(archivePath);
				const oldPath = archiveItem.oldPath ?? '';
				const archiveContent = archivePath ? await this.host.readText(archivePath) : null;
				const matchingParts = partsByLegacyPath.get(oldPath) ?? [];
				const part = matchingParts[0];
				const parentPath = part ? stringField(part.frontmatter, 'parent_source') : '';
				if (parentPath && !parentFrontmatterByPath.has(parentPath)) {
					const parentContent = await this.host.readText(parentPath);
					parentFrontmatterByPath.set(parentPath, parentContent === null ? null : parseMarkdown(parentContent).frontmatter.fields);
				}
				const parentFrontmatter = parentFrontmatterByPath.get(parentPath) ?? null;
				const managedUsesIndex = !managedSourceRefs.has(oldPath)
					&& !managedSourceRefs.has(archivePath)
					&& (!part || !managedSourceRefs.has(part.path));
				const hasArchiveReference = managedSourceRefs.has(archivePath);
				evidence.push({
					migration_id: migrationId,
					archive_path: archivePath,
					archive_content_hash: archiveContent === null ? '' : hashVaultContent(archiveContent),
					archive_bytes: archiveContent === null ? 0 : new TextEncoder().encode(archiveContent).byteLength,
					replacement_part_path: part?.path ?? '',
					replacement_part_hash: part ? hashVaultContent(part.content) : '',
					replacement_index_path: parentPath,
					materialization_journal_completed: materialization?.status === 'completed',
					archive_journal_completed: archive.status === 'completed' && archiveItem.state === 'verified',
					archive_hash_matches_journal: archiveContent !== null && hashVaultContent(archiveContent) === archiveItem.expectedHash,
					unique_replacement: matchingParts.length === 1,
					archive_body_occurrence_count: archiveContent !== null && part ? countOccurrences(part.content, archiveContent) : 0,
					part_content_hash_matches: Boolean(part && archiveContent !== null && normalizeDeclaredHash(stringField(part.frontmatter, 'content_hash')) === hashVaultContent(archiveContent)),
					part_manifest_valid: Boolean(part && parentFrontmatter && stringList(parentFrontmatter, 'part_manifest').includes(part.path)),
					output_hashes_valid: outputHashesValid,
					managed_relations_use_source_index: managedUsesIndex && Boolean(parentPath),
					active_operation: invalidPurgeJournal || activePurgePaths.has(archivePath),
					unknown_target_occupancy: archiveContent === null || !part || parentFrontmatter === null,
					active_managed_archive_reference: hasArchiveReference,
				});
			}
		}
		for (const archivePath of (await this.host.listPaths(SOURCE_MIGRATION_ARCHIVE_ROOT)).filter((item) => item.endsWith('.md')).sort()) {
			if (knownArchivePaths.has(archivePath)) continue;
			const content = await this.host.readText(archivePath);
			evidence.push({
				migration_id: path.posix.relative(SOURCE_MIGRATION_ARCHIVE_ROOT, archivePath).split('/')[0] || 'unknown',
				archive_path: archivePath,
				archive_content_hash: content === null ? '' : hashVaultContent(content),
				archive_bytes: content === null ? 0 : new TextEncoder().encode(content).byteLength,
				replacement_part_path: '', replacement_part_hash: '', replacement_index_path: '',
				materialization_journal_completed: false, archive_journal_completed: false,
				archive_hash_matches_journal: false, unique_replacement: false,
				archive_body_occurrence_count: 0, part_content_hash_matches: false,
				part_manifest_valid: false, output_hashes_valid: false,
				managed_relations_use_source_index: false,
				active_operation: invalidPurgeJournal || activePurgePaths.has(archivePath),
				unknown_target_occupancy: true,
				active_managed_archive_reference: managedSourceRefs.has(archivePath),
			});
		}
		return evidence;
	}

	private async assertCurrent(item: SourceArchivePurgePreviewItem): Promise<void> {
		const current = await this.host.readText(item.archivePath);
		if (current === null || hashVaultContent(current) !== item.archiveHash) {
			throw new Error('Archive source changed or disappeared after preview.');
		}
		await this.assertReplacementCurrent(item);
	}

	private async assertReplacementCurrent(item: SourceArchivePurgePreviewItem): Promise<void> {
		const part = await this.host.readText(item.replacementPartPath);
		const index = await this.host.readText(item.replacementIndexPath);
		if (part === null || hashVaultContent(part) !== item.replacementPartHash) throw new Error('Replacement Source part drifted.');
		if (index === null || hashVaultContent(index) !== item.replacementIndexHash) throw new Error('Replacement Source index drifted.');
	}

	private async readConsolidation(migrationId: string, archive: boolean): Promise<ConsolidationJournalRecord | null> {
		const suffix = archive ? '.archive.json' : '.json';
		const raw = await this.host.readText(`${LEGACY_SOURCE_CONSOLIDATION_JOURNAL_ROOT}/${migrationId}${suffix}`);
		return raw === null ? null : parseConsolidationJournal(raw);
	}

	private async readPurgeJournal(operationId: string): Promise<PurgeJournal | null> {
		const raw = await this.host.readText(journalPath(operationId));
		return raw === null ? null : parseJournal(raw);
	}

	private async persist(journal: PurgeJournal): Promise<PurgeJournal> {
		const previous = journal.bindingHash;
		const next = bindJournal({ ...journal, updatedAt: this.host.now(), bindingHash: undefined } as Omit<PurgeJournal, 'bindingHash'>);
		const raw = await this.host.readText(journalPath(journal.operationId));
		if (raw === null || parseJournal(raw).bindingHash !== previous) {
			throw new SourceArchivePurgeError('OPERATION_BINDING_CONFLICT', 'Source Archive purge journal binding changed.');
		}
		await this.host.writeText(journalPath(journal.operationId), `${JSON.stringify(next, null, 2)}\n`);
		return next;
	}

	private async writePurgeJournal(journal: PurgeJournal, expected: string | null): Promise<void> {
		const target = journalPath(journal.operationId);
		const current = await this.host.readText(target);
		if (expected === null && current !== null) {
			throw new SourceArchivePurgeError('OPERATION_BINDING_CONFLICT', 'Source Archive purge claim already exists.');
		}
		await this.host.createText(target, `${JSON.stringify(journal, null, 2)}\n`);
	}

	private toReceipt(journal: PurgeJournal): SourceArchivePurgeReceipt {
		const completed = journal.items.filter((item) => item.state === 'verified');
		return {
			version: PURGE_VERSION,
			operationId: journal.operationId,
			status: journal.status === 'running' ? 'partial' : journal.status,
			completedCount: completed.length,
			conflictCount: journal.items.filter((item) => item.state === 'conflict').length,
			outcomeUnknownCount: journal.items.filter((item) => item.state === 'outcome_unknown').length,
			resumableCount: journal.items.filter((item) => item.state === 'failed' || item.state === 'planned').length,
			totalCount: journal.items.length,
			reclaimedBytes: completed.reduce((total, item) => total + item.archiveBytes, 0),
			cleanedMigrationRootCount: journal.migrationRoots.filter((root) => root.state === 'cleaned').length,
			retainedMigrationRootCount: journal.migrationRoots.filter((root) => root.state === 'retained').length,
			failedMigrationRootCount: journal.migrationRoots.filter((root) => root.state === 'failed' || root.state === 'cleaning').length,
			journalPath: journalPath(journal.operationId),
			receiptPath: receiptPath(journal.operationId),
		};
	}

	private async writeReceipt(receipt: SourceArchivePurgeReceipt): Promise<void> {
		const target = receipt.receiptPath;
		const content = `${JSON.stringify(receipt, null, 2)}\n`;
		const current = await this.host.readText(target);
		if (current === null) await this.host.createText(target, content);
		else if (current !== content) await this.host.writeText(target, content);
	}

	private async cleanupMigrationTrees(
		initial: PurgeJournal,
		onProgress?: (progress: SourceArchivePurgeProgress) => void,
	): Promise<PurgeJournal> {
		let journal = initial;
		for (const root of journal.migrationRoots) {
			if (root.state === 'cleaned' || root.state === 'retained') continue;
			onProgress?.({
				phase: 'cleanup',
				currentPath: root.path,
				completed: journal.items.filter((item) => item.state === 'verified').length,
				total: journal.items.length,
			});
			root.state = 'cleaning';
			root.error = '';
			journal = await this.persist(journal);
			try {
				root.state = await this.host.trashEmptyMigrationTree(root.path);
			} catch (error) {
				root.state = 'failed';
				root.error = boundedError(error);
			}
			journal = await this.persist(journal);
		}
		return journal;
	}
}

export { PURGE_JOURNAL_ROOT as SOURCE_ARCHIVE_PURGE_JOURNAL_ROOT };
