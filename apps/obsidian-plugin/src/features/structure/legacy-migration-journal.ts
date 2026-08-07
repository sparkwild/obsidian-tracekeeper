import { TFile, TFolder, type App } from 'obsidian';
import { hashVaultContent } from '@tracekeeper/core';
import { withObsidianVaultPathLock } from '../../adapters/obsidian-vault-path-lock';

export const LEGACY_MIGRATION_JOURNAL_VERSION = 1;
export const LEGACY_MIGRATION_JOURNAL_DIR =
	'00_tracekeeper/control/operations/legacy-migrations';

const MAX_JOURNAL_BYTES = 1024 * 1024;
const MAX_ITEMS = 4_096;
const MAX_PATH_LENGTH = 1_024;
const MAX_ERROR_LENGTH = 512;
const MAX_ID_LENGTH = 160;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MIGRATION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export type LegacyMigrationItemAction =
	| 'native_move'
	| 'already_moved'
	| 'conflict'
	| 'unmapped';

export type LegacyMigrationItemState =
	| 'planned'
	| 'preflight_passed'
	| 'moved'
	| 'enriched'
	| 'verified'
	| 'blocked'
	| 'failed';

export type LegacyMigrationCompletedItemState =
	| 'planned'
	| 'preflight_passed'
	| 'moved'
	| 'enriched'
	| 'verified';

export type LegacyMigrationJournalStatus =
	| 'in_progress'
	| 'blocked'
	| 'failed'
	| 'completed';

export interface LegacyMigrationJournalEdge {
	sourcePath: string;
	targetPath: string;
	shapeHash: string;
	count: number;
	subpath: string;
	subpathKind: '' | 'heading' | 'block';
}

export interface LegacyMigrationJournalItem {
	oldPath: string;
	newPath: string;
	kind: string;
	action: LegacyMigrationItemAction;
	isMarkdown: boolean;
	sourceSize: number;
	sourceHash: string;
	semanticContentHash: string;
	expectedEnrichedHash: string;
	initialTargetHash: string | null;
	inboundEdges: LegacyMigrationJournalEdge[];
	outgoingEdges: LegacyMigrationJournalEdge[];
	unresolvedBaseline: LegacyMigrationJournalEdge[];
	state: LegacyMigrationItemState;
	lastCompletedState: LegacyMigrationCompletedItemState;
	preMoveHash: string | null;
	postMoveHash: string | null;
	postEnrichmentHash: string | null;
	verifiedGeneration: number | null;
	error: string;
}

export interface LegacyMigrationCleanupFailure {
	path: string;
	error: string;
}

export interface LegacyMigrationCleanupJournal {
	previewHash: string;
	attemptingRoot: string;
	trashedRoots: string[];
	missingRoots: string[];
	failedRoots: LegacyMigrationCleanupFailure[];
	completedAt: string;
}

export interface LegacyMigrationJournal {
	version: typeof LEGACY_MIGRATION_JOURNAL_VERSION;
	migrationId: string;
	planHash: string;
	revision: number;
	status: LegacyMigrationJournalStatus;
	createdAt: string;
	updatedAt: string;
	completedAt: string;
	metadataGeneration: number;
	linkCapabilityStatus: 'not_required' | 'passed';
	items: LegacyMigrationJournalItem[];
	cleanup: LegacyMigrationCleanupJournal | null;
	reportMdPath: string;
	reportJsonPath: string;
	auditWritten: boolean;
	bindingHash: string;
}

type UnsignedLegacyMigrationJournal = Omit<LegacyMigrationJournal, 'bindingHash'>;

export function bindLegacyMigrationJournal(
	input: UnsignedLegacyMigrationJournal | LegacyMigrationJournal
): LegacyMigrationJournal {
	const { bindingHash: _bindingHash, ...unsigned } =
		input as LegacyMigrationJournal;
	const normalized = cloneUnsignedJournal(unsigned);
	return {
		...normalized,
		bindingHash: hashVaultContent(canonicalJson(normalized)),
	};
}

export function parseLegacyMigrationJournal(value: unknown): LegacyMigrationJournal {
	assertPlainObject(value, 'Migration journal must be an object.');
	const record = value as Record<string, unknown>;
	if (record.version !== LEGACY_MIGRATION_JOURNAL_VERSION) {
		throw new Error('Migration journal version is unsupported.');
	}
	assertMigrationId(record.migrationId);
	assertHash(record.planHash, 'Migration journal plan hash is invalid.');
	assertPositiveInteger(record.revision, 'Migration journal revision is invalid.');
	assertJournalStatus(record.status);
	assertTimestamp(record.createdAt, 'Migration journal createdAt is invalid.');
	assertTimestamp(record.updatedAt, 'Migration journal updatedAt is invalid.');
	assertOptionalTimestamp(record.completedAt, 'Migration journal completedAt is invalid.');
	assertNonNegativeInteger(
		record.metadataGeneration,
		'Migration journal metadata generation is invalid.'
	);
	if (
		record.linkCapabilityStatus !== 'not_required'
		&& record.linkCapabilityStatus !== 'passed'
	) {
		throw new Error('Migration journal link capability is invalid.');
	}
	if (!Array.isArray(record.items) || record.items.length > MAX_ITEMS) {
		throw new Error('Migration journal item count is invalid.');
	}
	const items = record.items.map(parseJournalItem);
	const cleanup = record.cleanup === null
		? null
		: parseCleanupJournal(record.cleanup);
	assertVaultPathOrEmpty(record.reportMdPath, 'Migration report Markdown path is invalid.');
	assertVaultPathOrEmpty(record.reportJsonPath, 'Migration report JSON path is invalid.');
	if (typeof record.auditWritten !== 'boolean') {
		throw new Error('Migration journal audit state is invalid.');
	}
	assertHash(record.bindingHash, 'Migration journal binding hash is invalid.');

	const parsed: LegacyMigrationJournal = {
		version: LEGACY_MIGRATION_JOURNAL_VERSION,
		migrationId: record.migrationId as string,
		planHash: record.planHash as string,
		revision: record.revision as number,
		status: record.status as LegacyMigrationJournalStatus,
		createdAt: record.createdAt as string,
		updatedAt: record.updatedAt as string,
		completedAt: record.completedAt as string,
		metadataGeneration: record.metadataGeneration as number,
		linkCapabilityStatus: record.linkCapabilityStatus as 'not_required' | 'passed',
		items,
		cleanup,
		reportMdPath: record.reportMdPath as string,
		reportJsonPath: record.reportJsonPath as string,
		auditWritten: record.auditWritten,
		bindingHash: record.bindingHash as string,
	};
	if (bindLegacyMigrationJournal(parsed).bindingHash !== parsed.bindingHash) {
		throw new Error('Migration journal integrity is invalid.');
	}
	assertJournalInvariants(parsed);
	return parsed;
}

export class LegacyMigrationJournalRepository {
	constructor(
		private readonly app: App,
		private readonly ensureFolderExists: (path: string) => Promise<void>
	) {}

	pathFor(migrationId: string): string {
		assertMigrationId(migrationId);
		return `${LEGACY_MIGRATION_JOURNAL_DIR}/${migrationId}.json`;
	}

	async read(migrationId: string): Promise<LegacyMigrationJournal | null> {
		const path = this.pathFor(migrationId);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file) {
			return null;
		}
		if (!(file instanceof TFile)) {
			throw new Error(`Migration journal path is not a file: ${path}.`);
		}
		const content = await this.app.vault.read(file);
		if (Buffer.byteLength(content, 'utf8') > MAX_JOURNAL_BYTES) {
			throw new Error('Migration journal exceeds the bounded record size.');
		}
		try {
			return parseLegacyMigrationJournal(JSON.parse(content) as unknown);
		} catch (error) {
			throw new Error(
				`Migration journal is invalid: ${path}: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}

	async list(): Promise<LegacyMigrationJournal[]> {
		const folder = this.app.vault.getAbstractFileByPath(
			LEGACY_MIGRATION_JOURNAL_DIR
		);
		if (!folder) {
			return [];
		}
		if (!(folder instanceof TFolder)) {
			throw new Error('Migration journal directory is not a folder.');
		}
		const journals: LegacyMigrationJournal[] = [];
		for (const child of [...folder.children].sort((left, right) =>
			left.path.localeCompare(right.path)
		)) {
			if (!(child instanceof TFile) || child.extension !== 'json') {
				continue;
			}
			const migrationId = child.basename;
			assertMigrationId(migrationId);
			const journal = await this.read(migrationId);
			if (journal) {
				journals.push(journal);
			}
		}
		return journals.sort((left, right) =>
			right.updatedAt.localeCompare(left.updatedAt)
		);
	}

	async write(
		input: UnsignedLegacyMigrationJournal | LegacyMigrationJournal,
		expectedBindingHash: string | null
	): Promise<LegacyMigrationJournal> {
		const journal = bindLegacyMigrationJournal(input);
		assertJournalInvariants(journal);
		const content = `${JSON.stringify(journal, null, 2)}\n`;
		if (Buffer.byteLength(content, 'utf8') > MAX_JOURNAL_BYTES) {
			throw new Error('Migration journal exceeds the bounded record size.');
		}
		const path = this.pathFor(journal.migrationId);
		await this.ensureFolderExists(LEGACY_MIGRATION_JOURNAL_DIR);
		await withObsidianVaultPathLock(this.app.vault, path, async () => {
			let existing = this.app.vault.getAbstractFileByPath(path);
			if (!existing) {
				if (expectedBindingHash !== null || journal.revision !== 1) {
					throw new Error(`Migration journal disappeared before update: ${path}.`);
				}
				try {
					await this.app.vault.create(path, content);
					return;
				} catch (error) {
					existing = this.app.vault.getAbstractFileByPath(path);
					if (!(existing instanceof TFile)) {
						throw error;
					}
					const raced = parseLegacyMigrationJournal(
						JSON.parse(await this.app.vault.read(existing)) as unknown
					);
					if (raced.bindingHash === journal.bindingHash) {
						return;
					}
					throw new Error(`Migration journal creation lost a race: ${path}.`);
				}
			}
			if (!(existing instanceof TFile)) {
				throw new Error(`Migration journal path is not a file: ${path}.`);
			}
			await this.app.vault.process(existing, (current) => {
				const previous = parseLegacyMigrationJournal(
					JSON.parse(current) as unknown
				);
				if (previous.bindingHash === journal.bindingHash) {
					return current;
				}
				if (
					expectedBindingHash === null
					|| previous.bindingHash !== expectedBindingHash
				) {
					throw new Error(`Migration journal changed outside the operation: ${path}.`);
				}
				assertJournalUpdate(previous, journal);
				return content;
			});
		});
		return journal;
	}
}

function parseJournalItem(value: unknown): LegacyMigrationJournalItem {
	assertPlainObject(value, 'Migration journal item must be an object.');
	const item = value as Record<string, unknown>;
	assertVaultPath(item.oldPath, 'Migration journal source path is invalid.');
	if (item.action === 'unmapped') {
		if (item.newPath !== '') {
			throw new Error('Unmapped migration item cannot have a target path.');
		}
	} else {
		assertVaultPath(item.newPath, 'Migration journal target path is invalid.');
	}
	if (
		item.action !== 'native_move'
		&& item.action !== 'already_moved'
		&& item.action !== 'conflict'
		&& item.action !== 'unmapped'
	) {
		throw new Error('Migration journal item action is invalid.');
	}
	if (typeof item.kind !== 'string' || item.kind.length === 0 || item.kind.length > 64) {
		throw new Error('Migration journal item kind is invalid.');
	}
	if (typeof item.isMarkdown !== 'boolean') {
		throw new Error('Migration journal item Markdown flag is invalid.');
	}
	assertNonNegativeInteger(item.sourceSize, 'Migration source size is invalid.');
	assertHash(item.sourceHash, 'Migration source hash is invalid.');
	assertHash(item.semanticContentHash, 'Migration semantic-content hash is invalid.');
	assertHash(item.expectedEnrichedHash, 'Expected enrichment hash is invalid.');
	if (item.initialTargetHash !== null) {
		assertHash(item.initialTargetHash, 'Initial target hash is invalid.');
	}
	assertItemState(item.state);
	assertCompletedItemState(item.lastCompletedState);
	if (item.postMoveHash !== null) {
		assertHash(item.postMoveHash, 'Post-move hash is invalid.');
	}
	if (item.preMoveHash !== null) {
		assertHash(item.preMoveHash, 'Pre-move hash is invalid.');
	}
	if (item.postEnrichmentHash !== null) {
		assertHash(item.postEnrichmentHash, 'Post-enrichment hash is invalid.');
	}
	if (item.verifiedGeneration !== null) {
		assertNonNegativeInteger(
			item.verifiedGeneration,
			'Verified metadata generation is invalid.'
		);
	}
	if (typeof item.error !== 'string' || item.error.length > MAX_ERROR_LENGTH) {
		throw new Error('Migration journal item error is invalid.');
	}
	if (!Array.isArray(item.inboundEdges) || item.inboundEdges.length > MAX_ITEMS) {
		throw new Error('Migration inbound-edge evidence is invalid.');
	}
	if (!Array.isArray(item.outgoingEdges) || item.outgoingEdges.length > MAX_ITEMS) {
		throw new Error('Migration outgoing-edge evidence is invalid.');
	}
	if (
		!Array.isArray(item.unresolvedBaseline)
		|| item.unresolvedBaseline.length > MAX_ITEMS
	) {
		throw new Error('Migration unresolved-edge evidence is invalid.');
	}
	return {
		oldPath: item.oldPath as string,
		newPath: item.newPath as string,
		kind: item.kind,
		action: item.action,
		isMarkdown: item.isMarkdown,
		sourceSize: item.sourceSize as number,
		sourceHash: item.sourceHash as string,
		semanticContentHash: item.semanticContentHash as string,
		expectedEnrichedHash: item.expectedEnrichedHash as string,
		initialTargetHash: item.initialTargetHash as string | null,
		inboundEdges: item.inboundEdges.map(parseJournalEdge),
		outgoingEdges: item.outgoingEdges.map(parseJournalEdge),
		unresolvedBaseline: item.unresolvedBaseline.map(parseJournalEdge),
		state: item.state,
		lastCompletedState: item.lastCompletedState,
		preMoveHash: item.preMoveHash as string | null,
		postMoveHash: item.postMoveHash as string | null,
		postEnrichmentHash: item.postEnrichmentHash as string | null,
		verifiedGeneration: item.verifiedGeneration as number | null,
		error: item.error,
	};
}

function parseJournalEdge(value: unknown): LegacyMigrationJournalEdge {
	assertPlainObject(value, 'Migration journal edge must be an object.');
	const edge = value as Record<string, unknown>;
	assertVaultPath(edge.sourcePath, 'Migration edge source path is invalid.');
	assertVaultPathOrEmpty(edge.targetPath, 'Migration edge target path is invalid.');
	assertHash(edge.shapeHash, 'Migration edge shape hash is invalid.');
	assertPositiveInteger(edge.count, 'Migration edge count is invalid.');
	if (typeof edge.subpath !== 'string' || edge.subpath.length > 512) {
		throw new Error('Migration edge subpath is invalid.');
	}
	if (
		edge.subpathKind !== ''
		&& edge.subpathKind !== 'heading'
		&& edge.subpathKind !== 'block'
	) {
		throw new Error('Migration edge subpath kind is invalid.');
	}
	return {
		sourcePath: edge.sourcePath as string,
		targetPath: edge.targetPath as string,
		shapeHash: edge.shapeHash as string,
		count: edge.count as number,
		subpath: edge.subpath,
		subpathKind: edge.subpathKind,
	};
}

function parseCleanupJournal(value: unknown): LegacyMigrationCleanupJournal {
	assertPlainObject(value, 'Migration cleanup journal must be an object.');
	const cleanup = value as Record<string, unknown>;
	assertHash(cleanup.previewHash, 'Migration cleanup preview hash is invalid.');
	assertVaultPathOrEmpty(cleanup.attemptingRoot, 'Cleanup attempting root is invalid.');
	assertOptionalTimestamp(cleanup.completedAt, 'Cleanup completion time is invalid.');
	const trashedRoots = parsePathArray(cleanup.trashedRoots, 'Cleanup trashed roots are invalid.');
	const missingRoots = parsePathArray(cleanup.missingRoots, 'Cleanup missing roots are invalid.');
	if (!Array.isArray(cleanup.failedRoots) || cleanup.failedRoots.length > MAX_ITEMS) {
		throw new Error('Cleanup failures are invalid.');
	}
	const failedRoots = cleanup.failedRoots.map((failure) => {
		assertPlainObject(failure, 'Cleanup failure must be an object.');
		const entry = failure as Record<string, unknown>;
		assertVaultPath(entry.path, 'Cleanup failure path is invalid.');
		if (typeof entry.error !== 'string' || entry.error.length > MAX_ERROR_LENGTH) {
			throw new Error('Cleanup failure error is invalid.');
		}
		return { path: entry.path as string, error: entry.error };
	});
	return {
		previewHash: cleanup.previewHash as string,
		attemptingRoot: cleanup.attemptingRoot as string,
		trashedRoots,
		missingRoots,
		failedRoots,
		completedAt: cleanup.completedAt as string,
	};
}

function assertJournalInvariants(journal: LegacyMigrationJournal): void {
	if (journal.items.length > MAX_ITEMS) {
		throw new Error('Migration journal item count exceeds the bound.');
	}
	const sources = new Set<string>();
	const targets = new Set<string>();
	for (const item of journal.items) {
		if (sources.has(item.oldPath)) {
			throw new Error(`Migration journal contains a duplicate source: ${item.oldPath}.`);
		}
		sources.add(item.oldPath);
		if (item.newPath) {
			if (targets.has(item.newPath)) {
				throw new Error(`Migration journal contains a duplicate target: ${item.newPath}.`);
			}
			targets.add(item.newPath);
		}
		if (stateRank(item.lastCompletedState) > effectiveStateRank(item)) {
			throw new Error(`Migration journal state regressed for ${item.oldPath}.`);
		}
		if (item.state === 'verified' && !item.postEnrichmentHash) {
			throw new Error(`Verified migration item is missing its content hash: ${item.oldPath}.`);
		}
	}
	if (journal.status === 'completed' && journal.items.some((item) =>
		item.action === 'native_move' || item.action === 'already_moved'
			? item.state !== 'verified'
			: false
	)) {
		throw new Error('Completed migration journal contains an unverified move.');
	}
}

function assertJournalUpdate(
	previous: LegacyMigrationJournal,
	next: LegacyMigrationJournal
): void {
	if (
		next.migrationId !== previous.migrationId
		|| next.planHash !== previous.planHash
		|| next.createdAt !== previous.createdAt
		|| next.metadataGeneration !== previous.metadataGeneration
		|| next.linkCapabilityStatus !== previous.linkCapabilityStatus
		|| next.revision !== previous.revision + 1
		|| next.items.length !== previous.items.length
	) {
		throw new Error('Migration journal immutable identity changed.');
	}
	for (let index = 0; index < previous.items.length; index += 1) {
		const before = previous.items[index];
		const after = next.items[index];
		if (
			before.oldPath !== after.oldPath
			|| before.newPath !== after.newPath
			|| before.sourceHash !== after.sourceHash
			|| before.semanticContentHash !== after.semanticContentHash
			|| before.expectedEnrichedHash !== after.expectedEnrichedHash
			|| canonicalJson(before.inboundEdges) !== canonicalJson(after.inboundEdges)
			|| canonicalJson(before.outgoingEdges) !== canonicalJson(after.outgoingEdges)
			|| canonicalJson(before.unresolvedBaseline) !== canonicalJson(after.unresolvedBaseline)
		) {
			throw new Error(`Migration journal item identity changed: ${before.oldPath}.`);
		}
		if (effectiveStateRank(after) < effectiveStateRank(before)) {
			throw new Error(`Migration journal item state regressed: ${before.oldPath}.`);
		}
	}
	if (previous.cleanup && !next.cleanup) {
		throw new Error('Migration cleanup journal cannot be removed.');
	}
	if (previous.cleanup && next.cleanup) {
		for (const root of previous.cleanup.trashedRoots) {
			if (!next.cleanup.trashedRoots.includes(root)) {
				throw new Error('Migration cleanup progress regressed.');
			}
		}
	}
}

function effectiveStateRank(item: LegacyMigrationJournalItem): number {
	return item.state === 'blocked' || item.state === 'failed'
		? stateRank(item.lastCompletedState)
		: stateRank(item.state);
}

function stateRank(state: LegacyMigrationCompletedItemState): number {
	switch (state) {
		case 'planned':
			return 0;
		case 'preflight_passed':
			return 1;
		case 'moved':
			return 2;
		case 'enriched':
			return 3;
		case 'verified':
			return 4;
	}
}

function cloneUnsignedJournal(
	journal: UnsignedLegacyMigrationJournal
): UnsignedLegacyMigrationJournal {
	return JSON.parse(JSON.stringify(journal)) as UnsignedLegacyMigrationJournal;
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalize);
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, canonicalize(entry)])
		);
	}
	return value;
}

function parsePathArray(value: unknown, message: string): string[] {
	if (!Array.isArray(value) || value.length > MAX_ITEMS) {
		throw new Error(message);
	}
	return value.map((path) => {
		assertVaultPath(path, message);
		return path as string;
	});
}

function assertMigrationId(value: unknown): asserts value is string {
	if (
		typeof value !== 'string'
		|| value.length === 0
		|| value.length > MAX_ID_LENGTH
		|| !MIGRATION_ID_PATTERN.test(value)
	) {
		throw new Error('Migration id is invalid.');
	}
}

function assertVaultPath(value: unknown, message: string): asserts value is string {
	if (
		typeof value !== 'string'
		|| value.length === 0
		|| value.length > MAX_PATH_LENGTH
		|| value.startsWith('/')
		|| value.includes('\\')
		|| value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
		|| /[\u0000-\u001f\u007f]/u.test(value)
	) {
		throw new Error(message);
	}
}

function assertVaultPathOrEmpty(
	value: unknown,
	message: string
): asserts value is string {
	if (value === '') {
		return;
	}
	assertVaultPath(value, message);
}

function assertHash(value: unknown, message: string): asserts value is string {
	if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
		throw new Error(message);
	}
}

function assertTimestamp(value: unknown, message: string): asserts value is string {
	if (
		typeof value !== 'string'
		|| value.length > 64
		|| !Number.isFinite(Date.parse(value))
	) {
		throw new Error(message);
	}
}

function assertOptionalTimestamp(
	value: unknown,
	message: string
): asserts value is string {
	if (value === '') {
		return;
	}
	assertTimestamp(value, message);
}

function assertPlainObject(
	value: unknown,
	message: string
): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(message);
	}
}

function assertPositiveInteger(value: unknown, message: string): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new Error(message);
	}
}

function assertNonNegativeInteger(
	value: unknown,
	message: string
): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new Error(message);
	}
}

function assertJournalStatus(
	value: unknown
): asserts value is LegacyMigrationJournalStatus {
	if (
		value !== 'in_progress'
		&& value !== 'blocked'
		&& value !== 'failed'
		&& value !== 'completed'
	) {
		throw new Error('Migration journal status is invalid.');
	}
}

function assertItemState(value: unknown): asserts value is LegacyMigrationItemState {
	if (
		value !== 'planned'
		&& value !== 'preflight_passed'
		&& value !== 'moved'
		&& value !== 'enriched'
		&& value !== 'verified'
		&& value !== 'blocked'
		&& value !== 'failed'
	) {
		throw new Error('Migration journal item state is invalid.');
	}
}

function assertCompletedItemState(
	value: unknown
): asserts value is LegacyMigrationCompletedItemState {
	if (
		value !== 'planned'
		&& value !== 'preflight_passed'
		&& value !== 'moved'
		&& value !== 'enriched'
		&& value !== 'verified'
	) {
		throw new Error('Migration journal completed state is invalid.');
	}
}
