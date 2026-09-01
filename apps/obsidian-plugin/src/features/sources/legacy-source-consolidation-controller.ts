import path from 'node:path';

import {
	buildLegacySourceConsolidationPlan,
	hashVaultContent,
	type LegacySourceConsolidationPlan,
	type LegacySourceSegmentShardPlan,
	type NormalizedVaultNote,
} from '@tracekeeper/core';

const PREVIEW_VERSION = 1 as const;
const JOURNAL_VERSION = 1 as const;
const ARCHIVE_ROOT = '02_archive/source_migrations';
export const LEGACY_SOURCE_CONSOLIDATION_JOURNAL_ROOT = '00_tracekeeper/control/operations/source-consolidations';
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

type OutputState = 'planned' | 'verified' | 'conflict' | 'failed';

interface OutputItem {
	path: string;
	kind: 'source_capture' | 'source_part';
	expectedHash: string;
	legacyPath: string;
	state: OutputState;
	error: string;
}

interface ArchiveItem {
	oldPath: string;
	destinationPath: string;
	expectedHash: string;
	state: OutputState;
	error: string;
}

interface ConsolidationJournal {
	version: typeof JOURNAL_VERSION;
	migrationId: string;
	planHash: string;
	revision: number;
	status: 'in_progress' | 'completed' | 'partial' | 'conflicted';
	outputs: OutputItem[];
	archive: ArchiveItem[];
	updatedAt: string;
	bindingHash: string;
}

export interface LegacySourceConsolidationHost {
	loadSourceNotes(): Promise<readonly NormalizedVaultNote[]>;
	listMarkdownPaths(): Promise<readonly string[]>;
	readText(relativePath: string): Promise<string | null>;
	createText(relativePath: string, content: string): Promise<void>;
	writeText(relativePath: string, content: string): Promise<void>;
	ensureFolder(relativePath: string): Promise<void>;
	moveText(sourcePath: string, destinationPath: string): Promise<void>;
	now(): string;
	listJournalPaths?(): Promise<readonly string[]>;
}

export interface LegacySourceConsolidationPreview {
	version: typeof PREVIEW_VERSION;
	migrationId: string;
	plan: LegacySourceConsolidationPlan;
	previewHash: string;
	confirmationToken: string;
	expiresAt: string;
	canApply: boolean;
	journalPath: string;
}

export interface LegacySourceConsolidationResult {
	migrationId: string;
	status: 'completed' | 'partial' | 'conflicted';
	writtenCount: number;
	verifiedCount: number;
	conflictCount: number;
	failedCount: number;
	journalPath: string;
}

export interface LegacySourceArchivePreview {
	version: typeof PREVIEW_VERSION;
	migrationId: string;
	planHash: string;
	items: Array<Pick<ArchiveItem, 'oldPath' | 'destinationPath' | 'expectedHash'>>;
	previewHash: string;
	confirmationToken: string;
	expiresAt: string;
	canApply: boolean;
	archiveJournalPath: string;
}

export interface LegacySourceArchiveResult {
	migrationId: string;
	status: 'completed' | 'partial' | 'conflicted';
	movedCount: number;
	verifiedCount: number;
	conflictCount: number;
	failedCount: number;
	archiveJournalPath: string;
}

function boundedError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/[\r\n]+/g, ' ').slice(0, 512) || 'Unknown error.';
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, nested) => {
		if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
			return nested;
		}
		return Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)));
	});
}

function quoteYaml(value: string): string {
	return JSON.stringify(value);
}

function normalizeMigrationId(value: string): string {
	const normalized = value.trim();
	if (!/^[A-Za-z0-9._-]{1,160}$/u.test(normalized)) {
		throw new Error('Source consolidation migration id is invalid.');
	}
	return normalized;
}

function confirmationExpiry(now: string): string {
	const timestamp = Date.parse(now);
	if (!Number.isFinite(timestamp)) {
		throw new Error('Source consolidation clock is invalid.');
	}
	return new Date(timestamp + CONFIRMATION_TTL_MS).toISOString();
}

function assertUnexpired(expiresAt: string, now: string): void {
	const expiry = Date.parse(expiresAt);
	const current = Date.parse(now);
	if (!Number.isFinite(expiry) || !Number.isFinite(current) || expiry <= current) {
		throw new Error('Source consolidation confirmation has expired. Generate a new preview.');
	}
}

function journalPathFor(migrationId: string): string {
	return `${LEGACY_SOURCE_CONSOLIDATION_JOURNAL_ROOT}/${normalizeMigrationId(migrationId)}.json`;
}

function archiveJournalPathFor(migrationId: string): string {
	return `${LEGACY_SOURCE_CONSOLIDATION_JOURNAL_ROOT}/${normalizeMigrationId(migrationId)}.archive.json`;
}

function bindJournal(journal: Omit<ConsolidationJournal, 'bindingHash'>): ConsolidationJournal {
	return {
		...journal,
		bindingHash: hashVaultContent(canonicalJson(journal)),
	};
}

function parseJournal(raw: string): ConsolidationJournal {
	const parsed = JSON.parse(raw) as ConsolidationJournal;
	if (
		parsed.version !== JOURNAL_VERSION
		|| typeof parsed.migrationId !== 'string'
		|| typeof parsed.planHash !== 'string'
		|| !Array.isArray(parsed.outputs)
		|| !Array.isArray(parsed.archive)
		|| typeof parsed.bindingHash !== 'string'
		|| bindJournal({ ...parsed, bindingHash: undefined } as Omit<ConsolidationJournal, 'bindingHash'>).bindingHash !== parsed.bindingHash
	) {
		throw new Error('Source consolidation journal is invalid.');
	}
	return parsed;
}

function parentMarkdown(shard: LegacySourceSegmentShardPlan, migrationId: string): string {
	const lines = [
		'---',
		'tool: tracekeeper.legacy_source_consolidation',
		'type: source_capture',
		'source_kind: file',
		`source: ${quoteYaml(shard.parentSource)}`,
		`source_id: ${quoteYaml(shard.parentSourceId)}`,
		`content_hash: ${quoteYaml(shard.parentContentHash)}`,
		`route: 01_knowledge/sources/files`,
		`index_path: ${quoteYaml(shard.parentPath)}`,
		`mode: local_copy`,
		`capture_reason: ${quoteYaml('Consolidated from legacy segmented Source captures')}`,
		`migration_id: ${quoteYaml(migrationId)}`,
		`part_count: ${shard.parts.length}`,
		'part_manifest:',
		...shard.parts.map((part) => `  - ${quoteYaml(part.path)}`),
		'legacy_segment_paths:',
		...shard.segments.map((pathValue) => `  - ${quoteYaml(pathValue)}`),
		'---',
		'',
		`# Source shard ${shard.shardNumber}`,
		'',
		...shard.parts.map((part) => `- Part ${part.partNumber}: [[${part.path.replace(/\.md$/iu, '')}]]`),
		'',
	].filter((line) => line !== undefined);
	return `${lines.join('\n')}\n`;
}

function partMarkdown(
	shard: LegacySourceSegmentShardPlan,
	partNumber: number,
	migrationId: string,
): string {
	const part = shard.parts[partNumber - 1];
	if (!part) {
		throw new Error(`Missing Source part ${partNumber} in ${shard.parentPath}.`);
	}
	return [
		'---',
		'tool: tracekeeper.legacy_source_consolidation',
		'type: source_part',
		'source_kind: file',
		`source_id: ${quoteYaml(shard.parentSourceId)}`,
		`content_hash: ${quoteYaml(part.contentHash)}`,
		`part_number: ${part.partNumber}`,
		`part_count: ${shard.parts.length}`,
		`parent_source: ${quoteYaml(shard.parentPath)}`,
		`legacy_source_path: ${quoteYaml(part.legacyPath)}`,
		`migration_id: ${quoteYaml(migrationId)}`,
		'---',
		'',
		`# Source part ${part.partNumber}`,
		'',
		`- Parent source: [[${shard.parentPath.replace(/\.md$/iu, '')}]]`,
		'',
		part.content,
		'',
	].join('\n');
}

function outputItems(plan: LegacySourceConsolidationPlan, migrationId: string): OutputItem[] {
	const items: OutputItem[] = [];
	for (const family of plan.families) {
		for (const shard of family.shards) {
			const parent = parentMarkdown(shard, migrationId);
			items.push({
				path: shard.parentPath,
				kind: 'source_capture',
				expectedHash: hashVaultContent(parent),
				legacyPath: shard.segments[0] ?? shard.parentPath,
				state: 'planned',
				error: '',
			});
			for (const part of shard.parts) {
				const body = partMarkdown(shard, part.partNumber, migrationId);
				items.push({
					path: part.path,
					kind: 'source_part',
					expectedHash: hashVaultContent(body),
					legacyPath: part.legacyPath,
					state: 'planned',
					error: '',
				});
			}
		}
	}
	return items.sort((left, right) => left.path.localeCompare(right.path));
}

function archiveItems(plan: LegacySourceConsolidationPlan, migrationId: string): ArchiveItem[] {
	return plan.oldToNewParent.map(({ oldPath }) => {
		const segment = plan.families.flatMap((family) => family.segments).find((candidate) => candidate.path === oldPath);
		return {
			oldPath,
			destinationPath: `${ARCHIVE_ROOT}/${migrationId}/${oldPath}`,
			expectedHash: segment?.contentHash ?? '',
			state: 'planned' as const,
			error: '',
		};
	}).sort((left, right) => left.oldPath.localeCompare(right.oldPath));
}

export class LegacySourceConsolidationController {
	constructor(private readonly host: LegacySourceConsolidationHost) {}

	async preview(migrationId: string): Promise<LegacySourceConsolidationPreview> {
		return this.previewWithExpiry(migrationId, confirmationExpiry(this.host.now()));
	}

	private async previewWithExpiry(migrationId: string, expiresAt: string): Promise<LegacySourceConsolidationPreview> {
		const normalizedId = normalizeMigrationId(migrationId);
		const notes = await this.host.loadSourceNotes();
		const journalPath = journalPathFor(normalizedId);
		const existingJournal = await this.readJournal(journalPath);
		const ownedOutputPaths = new Set(existingJournal?.outputs.map((item) => item.path) ?? []);
		const occupiedPaths = (await this.host.listMarkdownPaths()).filter((candidate) => !ownedOutputPaths.has(candidate));
		const plan = buildLegacySourceConsolidationPlan(notes, {
			occupiedPaths,
			createdAt: this.host.now(),
		});
		const unsigned = {
			version: PREVIEW_VERSION,
			migrationId: normalizedId,
			planHash: plan.planHash,
			oldSegmentCount: plan.oldSegmentCount,
			newParentCount: plan.newParentCount,
			newPartCount: plan.newPartCount,
			journalPath,
			expiresAt,
		};
		const previewHash = hashVaultContent(canonicalJson(unsigned));
		return {
			version: PREVIEW_VERSION,
			migrationId: normalizedId,
			plan,
			previewHash,
			confirmationToken: hashVaultContent(`${previewHash}\0${plan.planHash}\0${expiresAt}`),
			expiresAt,
			canApply: plan.ready,
			journalPath,
		};
	}

	async apply(
		preview: LegacySourceConsolidationPreview,
		confirmationToken: string,
	): Promise<LegacySourceConsolidationResult> {
		if (preview.version !== PREVIEW_VERSION || confirmationToken !== preview.confirmationToken) {
			throw new Error('Source consolidation confirmation is invalid.');
		}
		assertUnexpired(preview.expiresAt, this.host.now());
		if (!preview.canApply) {
			throw new Error('Source consolidation is blocked by the current read-only plan.');
		}
		const fresh = await this.previewWithExpiry(preview.migrationId, preview.expiresAt);
		if (fresh.previewHash !== preview.previewHash || fresh.plan.planHash !== preview.plan.planHash) {
			throw new Error('Source consolidation preview is stale. No file was written.');
		}

		let journal = await this.readJournal(preview.journalPath);
		if (!journal) {
			journal = bindJournal({
				version: JOURNAL_VERSION,
				migrationId: preview.migrationId,
				planHash: preview.plan.planHash,
				revision: 1,
				status: 'in_progress',
				outputs: outputItems(preview.plan, preview.migrationId),
				archive: archiveItems(preview.plan, preview.migrationId),
				updatedAt: this.host.now(),
			});
			await this.writeJournal(preview.journalPath, journal, null);
		}
		if (journal.planHash !== preview.plan.planHash) {
			throw new Error('Source consolidation journal does not own this preview.');
		}

		for (const item of journal.outputs) {
			if (item.state === 'verified') continue;
			try {
				const existing = await this.host.readText(item.path);
				if (existing !== null) {
					if (hashVaultContent(existing) === item.expectedHash) {
						item.state = 'verified';
						item.error = '';
					} else {
						item.state = 'conflict';
						item.error = 'Target path is occupied by different content.';
					}
				} else {
					const rendered = this.renderOutput(preview.plan, item.path, preview.migrationId);
					await this.host.ensureFolder(path.posix.dirname(item.path));
					await this.host.createText(item.path, rendered);
					const committed = await this.host.readText(item.path);
					if (committed === null || hashVaultContent(committed) !== item.expectedHash) {
						item.state = 'failed';
						item.error = 'Written Source content did not match the planned hash.';
					} else {
						item.state = 'verified';
						item.error = '';
					}
				}
			} catch (error) {
				item.state = 'failed';
				item.error = boundedError(error);
			}
			const previousBindingHash = journal.bindingHash;
			journal.revision += 1;
			journal.updatedAt = this.host.now();
			journal = bindJournal({ ...journal, bindingHash: undefined } as Omit<ConsolidationJournal, 'bindingHash'>);
			await this.writeJournal(preview.journalPath, journal, previousBindingHash);
		}

		const conflictCount = journal.outputs.filter((item) => item.state === 'conflict').length;
		const failedCount = journal.outputs.filter((item) => item.state === 'failed').length;
		const status: LegacySourceConsolidationResult['status'] = conflictCount > 0
			? 'conflicted'
			: failedCount > 0
				? 'partial'
				: 'completed';
		journal.status = status;
		const previousBindingHash = journal.bindingHash;
		journal.revision += 1;
		journal.updatedAt = this.host.now();
		journal = bindJournal({ ...journal, bindingHash: undefined } as Omit<ConsolidationJournal, 'bindingHash'>);
		await this.writeJournal(preview.journalPath, journal, previousBindingHash);
		return {
			migrationId: preview.migrationId,
			status,
			writtenCount: journal.outputs.filter((item) => item.state === 'verified').length,
			verifiedCount: journal.outputs.filter((item) => item.state === 'verified').length,
			conflictCount,
			failedCount,
			journalPath: preview.journalPath,
		};
	}

	async previewArchive(migrationId: string): Promise<LegacySourceArchivePreview> {
		return this.previewArchiveWithExpiry(migrationId, confirmationExpiry(this.host.now()));
	}

	private async previewArchiveWithExpiry(migrationId: string, expiresAt: string): Promise<LegacySourceArchivePreview> {
		const normalizedId = normalizeMigrationId(migrationId);
		const journalPath = journalPathFor(normalizedId);
		const journal = await this.readJournal(journalPath);
		if (!journal || journal.status !== 'completed') {
			throw new Error('Source archive requires a completed and verified materialization journal.');
		}
		const items = journal.archive.map(({ oldPath, destinationPath, expectedHash }) => ({ oldPath, destinationPath, expectedHash }));
		const unsigned = { version: PREVIEW_VERSION, migrationId: normalizedId, planHash: journal.planHash, items, expiresAt };
		const previewHash = hashVaultContent(canonicalJson(unsigned));
		const blocked = items.some((item) => !item.expectedHash);
		return {
			version: PREVIEW_VERSION,
			migrationId: normalizedId,
			planHash: journal.planHash,
			items,
			previewHash,
			confirmationToken: hashVaultContent(`${previewHash}\0${journal.planHash}\0${expiresAt}`),
			expiresAt,
			canApply: !blocked,
			archiveJournalPath: archiveJournalPathFor(normalizedId),
		};
	}

	async latestCompletedMigrationId(): Promise<string | null> {
		const paths = (await this.host.listJournalPaths?.()) ?? [];
		const candidates: Array<{ id: string; updatedAt: string }> = [];
		for (const journalPath of paths.filter((candidate) => candidate.endsWith('.json') && !candidate.endsWith('.archive.json'))) {
			const fileName = journalPath.slice(journalPath.lastIndexOf('/') + 1).replace(/\.json$/iu, '');
			try {
				const journal = await this.readJournal(journalPath);
				if (journal?.status === 'completed') {
					candidates.push({ id: fileName, updatedAt: journal.updatedAt });
				}
			} catch {
				// 损坏的日志由常规治理/Doctor 视图统一报告。
			}
		}
		return candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))[0]?.id ?? null;
	}

	async archive(
		preview: LegacySourceArchivePreview,
		confirmationToken: string,
	): Promise<LegacySourceArchiveResult> {
		if (preview.version !== PREVIEW_VERSION || confirmationToken !== preview.confirmationToken) {
			throw new Error('Source archive confirmation is invalid.');
		}
		assertUnexpired(preview.expiresAt, this.host.now());
		const fresh = await this.previewArchiveWithExpiry(preview.migrationId, preview.expiresAt);
		if (fresh.previewHash !== preview.previewHash || !fresh.canApply) {
			throw new Error('Source archive preview is stale or blocked. No file was moved.');
		}
		let journal = await this.readArchiveJournal(preview.archiveJournalPath);
		if (!journal) {
			const owner = await this.readJournal(journalPathFor(preview.migrationId));
			if (!owner) throw new Error('Source consolidation journal disappeared.');
			journal = bindJournal({
				version: JOURNAL_VERSION,
				migrationId: preview.migrationId,
				planHash: owner.planHash,
				revision: 1,
				status: 'in_progress',
				outputs: [],
				archive: owner.archive,
				updatedAt: this.host.now(),
			});
			await this.writeJournal(preview.archiveJournalPath, journal, null);
		}
		for (const item of journal.archive) {
			if (item.state === 'verified') continue;
			try {
				const source = await this.host.readText(item.oldPath);
				if (source === null) {
					const destination = await this.host.readText(item.destinationPath);
					item.state = destination !== null && hashVaultContent(destination) === item.expectedHash ? 'verified' : 'conflict';
					item.error = item.state === 'verified' ? '' : 'Legacy Source is missing and archive target is not an exact match.';
				} else if (hashVaultContent(source) !== item.expectedHash) {
					item.state = 'conflict';
					item.error = 'Legacy Source changed after materialization.';
				} else if (await this.host.readText(item.destinationPath) !== null) {
					item.state = 'conflict';
					item.error = 'Archive target already exists.';
				} else {
					await this.host.ensureFolder(path.posix.dirname(item.destinationPath));
					await this.host.moveText(item.oldPath, item.destinationPath);
					const moved = await this.host.readText(item.destinationPath);
					item.state = moved !== null && hashVaultContent(moved) === item.expectedHash ? 'verified' : 'failed';
					item.error = item.state === 'verified' ? '' : 'Archived Source hash verification failed.';
				}
			} catch (error) {
				item.state = 'failed';
				item.error = boundedError(error);
			}
			const previousBindingHash = journal.bindingHash;
			journal.revision += 1;
			journal.updatedAt = this.host.now();
			journal = bindJournal({ ...journal, bindingHash: undefined } as Omit<ConsolidationJournal, 'bindingHash'>);
			await this.writeJournal(preview.archiveJournalPath, journal, previousBindingHash);
		}
		const conflictCount = journal.archive.filter((item) => item.state === 'conflict').length;
		const failedCount = journal.archive.filter((item) => item.state === 'failed').length;
		const status: LegacySourceArchiveResult['status'] = conflictCount > 0
			? 'conflicted'
			: failedCount > 0
				? 'partial'
				: 'completed';
		journal.status = status;
		const previousBindingHash = journal.bindingHash;
		journal.revision += 1;
		journal.updatedAt = this.host.now();
		journal = bindJournal({ ...journal, bindingHash: undefined } as Omit<ConsolidationJournal, 'bindingHash'>);
		await this.writeJournal(preview.archiveJournalPath, journal, previousBindingHash);
		return {
			migrationId: preview.migrationId,
			status,
			movedCount: journal.archive.filter((item) => item.state === 'verified').length,
			verifiedCount: journal.archive.filter((item) => item.state === 'verified').length,
			conflictCount,
			failedCount,
			archiveJournalPath: preview.archiveJournalPath,
		};
	}

	private renderOutput(plan: LegacySourceConsolidationPlan, outputPath: string, migrationId: string): string {
		for (const family of plan.families) {
			for (const shard of family.shards) {
				if (shard.parentPath === outputPath) return parentMarkdown(shard, migrationId);
				const part = shard.parts.find((candidate) => candidate.path === outputPath);
				if (part) return partMarkdown(shard, part.partNumber, migrationId);
			}
		}
		throw new Error(`Output path is not owned by the consolidation plan: ${outputPath}`);
	}

	private async readJournal(relativePath: string): Promise<ConsolidationJournal | null> {
		const raw = await this.host.readText(relativePath);
		return raw === null ? null : parseJournal(raw);
	}

	private async readArchiveJournal(relativePath: string): Promise<ConsolidationJournal | null> {
		return this.readJournal(relativePath);
	}

	private async writeJournal(relativePath: string, journal: ConsolidationJournal, expectedBindingHash: string | null): Promise<void> {
		await this.host.ensureFolder(path.posix.dirname(relativePath));
		const content = `${JSON.stringify(journal, null, 2)}\n`;
		const existing = await this.host.readText(relativePath);
		if (expectedBindingHash !== null) {
			if (existing === null || parseJournal(existing).bindingHash !== expectedBindingHash) {
				throw new Error('Source consolidation journal binding changed.');
			}
		}
		if (existing === null) {
			await this.host.createText(relativePath, content);
		} else {
			await this.host.writeText(relativePath, content);
		}
	}
}
