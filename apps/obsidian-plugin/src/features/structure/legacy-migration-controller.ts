import { createHash } from 'node:crypto';
import { App, Notice, TFile, TFolder } from 'obsidian';
import {
	KNOWLEDGE_INDEX_PATH,
	KNOWLEDGE_MEMORY_INDEX_PATH,
	KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
	LEGACY_TOP_LEVEL_DIRS,
	TRACEKEEPER_REVIEW_QUEUE_DIR,
	TRACEKEEPER_TASKS_DIR,
	buildLegacyMigrationReviewPath,
	enrichLegacyMarkdownContent,
	getLegacyStructureTarget,
	hashVaultContent,
	normalizeVaultRelativePath,
	parseMarkdown,
	renderLegacyMigrationReview,
	type KnowledgeSnapshot,
	type LegacyStructureKind,
	type LegacyStructureTarget,
	type NormalizedVaultEdge,
} from '@tracekeeper/core';
import { withObsidianVaultPathLocks } from '../../adapters/obsidian-vault-path-lock';
import { ui } from '../../ui/localization';
import {
	LegacyMigrationJournalRepository,
	bindLegacyMigrationJournal,
	type LegacyMigrationCompletedItemState,
	type LegacyMigrationJournal,
	type LegacyMigrationJournalEdge,
	type LegacyMigrationJournalItem,
} from './legacy-migration-journal';
import {
	runLegacyLinkPreflight as executeLegacyLinkPreflight,
	type LegacyLinkPreflightResult,
} from './legacy-link-preflight';
import {
	isBaseStructurePlanReady,
	type MemoryInitializationPlan,
} from './base-structure-plan';

const LEGACY_MIGRATION_PLAN_VERSION = 1;
const METADATA_WAIT_TIMEOUT_MS = 5_000;
const METADATA_POLL_INTERVAL_MS = 25;
const MAX_PLAN_ITEMS = 4_096;
const MAX_ERROR_LENGTH = 512;
const legacyMigrationOperationQueues = new WeakMap<
	object,
	Map<string, Promise<void>>
>();

export type StructureState = 'initialized' | 'partial' | 'missing' | 'legacy_detected';
export type LegacyStructureAction =
	| 'native_move'
	| 'already_moved'
	| 'conflict'
	| 'unmapped';
export type LegacyTargetType = 'missing' | 'file' | 'folder';
export type LegacyLinkCapabilityStatus =
	| 'required'
	| 'not_required'
	| 'passed'
	| 'blocked';

export interface TracekeeperStructureStatus {
	state: StructureState;
	label: string;
	detail: string;
	missingFolders: string[];
	missingFiles: string[];
	invalidFolders: string[];
	invalidFiles: string[];
	invalidFileContents: string[];
	missingCount: number;
	totalCount: number;
}

export interface LegacyLinkCapability {
	status: LegacyLinkCapabilityStatus;
	reason: string;
	inboundLinkCount: number;
	probeId: string | null;
	beforeGeneration: number | null;
	afterGeneration: number | null;
	cleanupStatus: 'not_started' | 'complete' | 'partial';
}

export interface LegacyStructurePlanItem {
	oldPath: string;
	newPath: string;
	kind: LegacyStructureKind;
	action: LegacyStructureAction;
	reason: string;
	isMarkdown: boolean;
	sourceSize: number;
	sourceHash: string;
	semanticContentHash: string;
	expectedEnrichedHash: string;
	targetType: LegacyTargetType;
	targetHash: string | null;
	inboundEdges: LegacyMigrationJournalEdge[];
	outgoingEdges: LegacyMigrationJournalEdge[];
	unresolvedBaseline: LegacyMigrationJournalEdge[];
	requiredParents: string[];
	enrichmentExpected: boolean;
}

export interface LegacyStructurePlan {
	version: typeof LEGACY_MIGRATION_PLAN_VERSION;
	migrationId: string;
	createdAt: string;
	metadataGeneration: number;
	metadataState: KnowledgeSnapshot['index_state'];
	recovery: boolean;
	evidenceHash: string;
	planHash: string;
	confirmationHash: string;
	linkCapability: LegacyLinkCapability;
	legacyRoots: string[];
	items: LegacyStructurePlanItem[];
	fileCount: number;
	markdownCount: number;
	nonMarkdownCount: number;
	moveCount: number;
	alreadyMovedCount: number;
	conflictCount: number;
	reviewCount: number;
	uncoveredCount: number;
}

export interface StructureOrganizerSnapshot {
	basePlan: MemoryInitializationPlan;
	legacyPlan: LegacyStructurePlan;
	state: 'ready' | 'needs_repair' | 'legacy_detected';
}

export interface LegacyMigrationResult {
	migrationId: string;
	movedCount: number;
	verifiedCount: number;
	blockedCount: number;
	failedCount: number;
	reviewCount: number;
	cleanupAvailable: boolean;
	reportMdPath: string;
	reportJsonPath: string;
	journalPath: string;
}

export interface LegacyCleanupPreview {
	migrationId: string;
	journalBindingHash: string;
	previewHash: string;
	eligibleRoots: string[];
	missingRoots: string[];
	remainingFiles: string[];
	blockingItems: Array<{ path: string; state: string }>;
	canCleanup: boolean;
}

export interface LegacyCleanupResult {
	cleanupId: string;
	trashedRoots: string[];
	missingRoots: string[];
	failedRoots: Array<{ path: string; error: string }>;
	reportPath: string;
	taskPath: string;
}

export interface LegacyMigrationControllerHost {
	initializeMemoryStructure(plan: MemoryInitializationPlan): Promise<void>;
	buildInitializationPlan(): Promise<MemoryInitializationPlan>;
	ensureFolderExists(path: string): Promise<void>;
	ensureFileDoesNotExist(path: string, content: string): Promise<void>;
	normalizeVaultPath(path: string): string;
	appendToAuditLog(entry: string): Promise<void>;
	appendOperationAuditEvent?(operationId: string, entry: string): Promise<void>;
	refreshGovernanceViews(): Promise<void>;
	loadKnowledgeSnapshot(): Promise<KnowledgeSnapshot>;
	resolveLegacyTarget?(path: string): LegacyStructureTarget | null | undefined;
	metadataWaitTimeoutMs?: number;
}

interface FileEvidence {
	hash: string;
	size: number;
	text: string | null;
}

interface BuildPlanOptions {
	snapshot?: KnowledgeSnapshot;
	linkCapability?: LegacyLinkCapability;
	ignoreJournal?: boolean;
}

const vaultParentFolder = (path: string): string =>
	path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');

export class LegacyMigrationController {
	private readonly journalRepository: LegacyMigrationJournalRepository;

	constructor(
		private readonly app: App,
		private readonly host: LegacyMigrationControllerHost
	) {
		this.journalRepository = new LegacyMigrationJournalRepository(
			app,
			(path) => host.ensureFolderExists(path)
		);
	}

	getLegacyRootFolders(): string[] {
		return LEGACY_TOP_LEVEL_DIRS.filter(
			(root) => this.app.vault.getAbstractFileByPath(root) instanceof TFolder
		);
	}

	createStructureMigrationId(): string {
		return `legacy-move-${new Date().toISOString().replace(/[:.]/g, '-')}`;
	}

	async findRecoverableMigrationId(): Promise<string | null> {
		const journals = await this.journalRepository.list();
		const candidates = journals.filter((journal) =>
			journal.status !== 'completed'
			|| !journal.cleanup?.completedAt
		);
		const withVisibleRoots = candidates.filter((journal) =>
			journal.items.some((item) =>
				this.app.vault.getAbstractFileByPath(item.oldPath)
				|| (item.newPath && this.app.vault.getAbstractFileByPath(item.newPath))
			)
		);
		if (withVisibleRoots.length > 1) {
			throw new Error(
				'Multiple recoverable legacy migrations exist. Resolve them individually before starting another migration.'
			);
		}
		return withVisibleRoots[0]?.migrationId ?? null;
	}

	async buildLegacyStructurePlan(
		migrationId: string,
		options: BuildPlanOptions = {}
	): Promise<LegacyStructurePlan> {
		const existingJournal = options.ignoreJournal
			? null
			: await this.journalRepository.read(migrationId);
		const snapshot = options.snapshot ?? await this.host.loadKnowledgeSnapshot();
		if (existingJournal) {
			return this.buildRecoveryPlan(existingJournal, snapshot);
		}

		const legacyRoots = this.getLegacyRootFolders();
		const files = legacyRoots.flatMap((root) => {
			const folder = this.app.vault.getAbstractFileByPath(root);
			return folder instanceof TFolder ? this.collectFiles(folder) : [];
		});
		if (files.length > MAX_PLAN_ITEMS) {
			throw new Error(
				`Legacy migration exceeds the bounded item count: ${files.length}.`
			);
		}
		const items: LegacyStructurePlanItem[] = [];

		for (const file of files) {
			const oldPath = normalizeVaultRelativePath(file.path);
			const target = this.resolveLegacyTarget(oldPath);
			const sourceEvidence = await this.readFileEvidence(file);
			const isMarkdown = file.extension.toLowerCase() === 'md';
			if (!target) {
				items.push({
					oldPath,
					newPath: '',
					kind: 'archive',
					action: 'unmapped',
					reason: ui(
						'没有稳定的新结构映射。',
						'No stable current-architecture mapping exists.'
					),
					isMarkdown,
					sourceSize: sourceEvidence.size,
					sourceHash: sourceEvidence.hash,
					semanticContentHash: sourceEvidence.text === null
						? sourceEvidence.hash
						: this.semanticMarkdownHash(sourceEvidence.text),
					expectedEnrichedHash: sourceEvidence.hash,
					targetType: 'missing',
					targetHash: null,
					inboundEdges: this.inboundEdgeEvidence(snapshot, oldPath),
					outgoingEdges: this.outgoingEdgeEvidence(snapshot, oldPath),
					unresolvedBaseline: this.unresolvedEvidence(snapshot, [oldPath]),
					requiredParents: [],
					enrichmentExpected: false,
				});
				continue;
			}

			const newPath = normalizeVaultRelativePath(target.newPath);
			const targetEntry = this.app.vault.getAbstractFileByPath(newPath);
			const targetType: LegacyTargetType = targetEntry instanceof TFile
				? 'file'
				: targetEntry instanceof TFolder
					? 'folder'
					: 'missing';
			const targetHash = targetEntry instanceof TFile
				? (await this.readFileEvidence(targetEntry)).hash
				: null;
			const inboundEdges = this.inboundEdgeEvidence(snapshot, oldPath);
			const inboundSources = [...new Set([
				oldPath,
				...inboundEdges.map((edge) => edge.sourcePath),
			])];
			const expectedEnrichedHash = isMarkdown && sourceEvidence.text !== null
				? hashVaultContent(enrichLegacyMarkdownContent(sourceEvidence.text, {
						migrationId,
						oldPath,
						newPath,
						kind: target.kind,
				  }))
				: sourceEvidence.hash;
			const hasReview = await this.legacyMigrationReviewExists(oldPath, migrationId);

			items.push({
				oldPath,
				newPath,
				kind: target.kind,
				action: targetType === 'missing' ? 'native_move' : 'conflict',
				reason: targetType === 'missing'
					? ui(
							'可通过 Obsidian 原生移动迁移。',
							'Can be migrated with an Obsidian-native move.'
					  )
					: hasReview
						? ui(
								'目标已存在，且迁移审核项已创建。',
								'The target exists and a migration review item is already present.'
						  )
						: targetType === 'folder'
							? ui(
									'新版目标路径已被文件夹占用。',
									'The current-architecture target path is occupied by a folder.'
							  )
							: ui(
									'新版目标文件已存在；即使内容相同也不能冒认迁移所有权。',
									'The target file already exists; identical content does not prove migration ownership.'
							  ),
				isMarkdown,
				sourceSize: sourceEvidence.size,
				sourceHash: sourceEvidence.hash,
				semanticContentHash: sourceEvidence.text === null
					? sourceEvidence.hash
					: this.semanticMarkdownHash(sourceEvidence.text),
				expectedEnrichedHash,
				targetType,
				targetHash,
				inboundEdges,
				outgoingEdges: this.outgoingEdgeEvidence(snapshot, oldPath),
				unresolvedBaseline: this.unresolvedEvidence(snapshot, inboundSources),
				requiredParents: this.requiredParentFolders(newPath),
				enrichmentExpected: isMarkdown
					&& expectedEnrichedHash !== sourceEvidence.hash,
			});
		}

		items.sort((left, right) => left.oldPath.localeCompare(right.oldPath));
		const inboundLinkCount = items.reduce(
			(total, item) => total
				+ item.inboundEdges.reduce((count, edge) => count + edge.count, 0),
			0
		);
		const defaultCapability: LegacyLinkCapability = snapshot.index_state !== 'ready'
			? {
					status: 'blocked',
					reason: 'metadata_not_ready',
					inboundLinkCount,
					probeId: null,
					beforeGeneration: null,
					afterGeneration: null,
					cleanupStatus: 'not_started',
			  }
			: inboundLinkCount > 0
				? {
						status: 'required',
						reason: 'inbound_links_require_probe',
						inboundLinkCount,
						probeId: null,
						beforeGeneration: null,
						afterGeneration: null,
						cleanupStatus: 'not_started',
				  }
				: {
						status: 'not_required',
						reason: 'no_inbound_links',
						inboundLinkCount: 0,
						probeId: null,
						beforeGeneration: null,
						afterGeneration: null,
						cleanupStatus: 'not_started',
				  };
		const linkCapability = options.linkCapability ?? defaultCapability;
		if (linkCapability.inboundLinkCount !== inboundLinkCount) {
			throw new Error('Legacy link capability evidence does not match the current plan.');
		}
		if (snapshot.index_state !== 'ready' && linkCapability.status !== 'blocked') {
			throw new Error('Legacy migration metadata is not ready.');
		}

		const createdAt = new Date().toISOString();
		const legacyPlan = this.finishPlan({
			migrationId,
			createdAt,
			metadataGeneration: snapshot.generation,
			metadataState: snapshot.index_state,
			recovery: false,
			linkCapability,
			legacyRoots,
			items,
		});
		return legacyPlan;
	}

	async runLegacyLinkPreflight(
		plan: LegacyStructurePlan
	): Promise<LegacyStructurePlan> {
		this.assertPlanIntegrity(plan);
		if (plan.recovery) {
			throw new Error('A recoverable migration cannot run a new link preflight.');
		}
		const snapshot = await this.host.loadKnowledgeSnapshot();
		const current = await this.buildLegacyStructurePlan(plan.migrationId, {
			snapshot,
			ignoreJournal: true,
		});
		if (current.evidenceHash !== plan.evidenceHash) {
			throw new Error(
				'Legacy migration preview is stale. Refresh it before running the link preflight.'
			);
		}
		const result = await executeLegacyLinkPreflight(this.app, {
			ensureFolderExists: (path) => this.host.ensureFolderExists(path),
			loadKnowledgeSnapshot: () => this.host.loadKnowledgeSnapshot(),
		}, {
			migrationId: plan.migrationId,
			inboundLinkCount: plan.linkCapability.inboundLinkCount,
		});
		if (
			result.evidence.probeId
			&& result.evidence.cleanupStatus === 'complete'
			&& result.reason !== 'probe_path_exists'
		) {
			await this.waitForProbeCleanup(
				result.evidence.probeId,
				result.evidence.afterGeneration ?? snapshot.generation
			);
		}
		const refreshedSnapshot = await this.host.loadKnowledgeSnapshot();
		return this.buildLegacyStructurePlan(plan.migrationId, {
			snapshot: refreshedSnapshot,
			linkCapability: this.linkCapabilityFromPreflight(result),
			ignoreJournal: true,
		});
	}

	async migrateLegacyStructure(
		snapshot: StructureOrganizerSnapshot
	): Promise<LegacyMigrationResult> {
		return this.serializeLegacyMigrationOperation(
			snapshot.legacyPlan.migrationId,
			() => this.migrateLegacyStructureInternal(snapshot)
		);
	}

	private async migrateLegacyStructureInternal(
		snapshot: StructureOrganizerSnapshot
	): Promise<LegacyMigrationResult> {
		const currentBasePlan = await this.host.buildInitializationPlan();
		if (
			!isBaseStructurePlanReady(snapshot.basePlan)
			|| !isBaseStructurePlanReady(currentBasePlan)
		) {
			throw new Error(
				'Repair invalid or missing base structure entries and refresh the migration preview before confirming user-file moves.'
			);
		}
		const plan = snapshot.legacyPlan;
		this.assertPlanIntegrity(plan);

		let journal = await this.journalRepository.read(plan.migrationId);
		if (!journal) {
			if (
				plan.linkCapability.status !== 'not_required'
				&& plan.linkCapability.status !== 'passed'
			) {
				throw new Error(
					'Legacy migration requires a passing native link preflight before user-file moves.'
				);
			}
			const currentSnapshot = await this.host.loadKnowledgeSnapshot();
			const current = await this.buildLegacyStructurePlan(plan.migrationId, {
				snapshot: currentSnapshot,
				linkCapability: plan.linkCapability,
				ignoreJournal: true,
			});
			if (current.planHash !== plan.planHash) {
				throw new Error(
					'Legacy migration preview is stale. No user file was moved.'
				);
			}
			journal = await this.journalRepository.write(
				this.createJournal(plan),
				null
			);
		} else {
			if (journal.planHash !== plan.planHash) {
				throw new Error('Legacy migration journal does not own this preview.');
			}
			const currentRecoveryPlan = this.buildRecoveryPlan(
				journal,
				await this.host.loadKnowledgeSnapshot()
			);
			if (canonicalJson(currentRecoveryPlan) !== canonicalJson(plan)) {
				throw new Error(
					'Legacy migration recovery preview is stale or was modified.'
				);
			}
		}

		for (const journalItem of journal.items) {
			const planItem = this.planItemFromJournal(journalItem);
			if (journalItem.action === 'conflict' || journalItem.action === 'unmapped') {
				await this.writeLegacyMigrationReview(planItem, plan.migrationId);
				if (journalItem.state !== 'blocked') {
					journal = await this.updateJournal(journal, (next) => {
						const item = this.findJournalItem(next, journalItem.oldPath);
						item.state = 'blocked';
						item.error = this.boundError(planItem.reason);
						next.status = 'blocked';
					});
				}
				continue;
			}
			try {
				journal = await this.executeMoveItem(journal, planItem);
			} catch (error) {
				const observedError = this.boundError(error);
				journal = await this.journalRepository.read(plan.migrationId)
					?? journal;
				journal = await this.updateJournal(journal, (next) => {
					const item = this.findJournalItem(next, journalItem.oldPath);
					if (item.state !== 'verified') {
						item.state = 'failed';
						item.error = observedError;
					}
					next.status = 'failed';
				});
				throw error;
			}
		}

		const allMovesReachedVerification = journal.items.every((item) =>
			item.action === 'native_move' || item.action === 'already_moved'
				? item.state === 'verified'
				: true
		);
		if (allMovesReachedVerification) {
			for (const item of journal.items.filter(
				(candidate) => candidate.state === 'verified'
			)) {
				try {
					await this.assertVerifiedObservedState(journal, item);
				} catch (error) {
					journal = await this.updateJournal(journal, (next) => {
						const nextItem = this.findJournalItem(next, item.oldPath);
						nextItem.state = 'blocked';
						nextItem.lastCompletedState = 'verified';
						nextItem.error = this.boundError(error);
						next.status = 'blocked';
					});
				}
			}
		}

		const nextStatus = journal.items.some((item) => item.state === 'failed')
			? 'failed'
			: journal.items.some((item) =>
					(item.action === 'native_move' || item.action === 'already_moved')
						&& item.state !== 'verified'
			  )
				? 'blocked'
				: journal.items.some((item) =>
						item.action === 'conflict' || item.action === 'unmapped'
				  )
					? 'blocked'
					: 'completed';
		if (journal.status !== nextStatus || (nextStatus === 'completed' && !journal.completedAt)) {
			journal = await this.updateJournal(journal, (next) => {
				next.status = nextStatus;
				next.completedAt = nextStatus === 'completed'
					? next.completedAt || new Date().toISOString()
					: '';
			});
		}

		const reportPaths = this.migrationReportPaths(plan.migrationId);
		if (
			journal.reportMdPath !== reportPaths.markdown
			|| journal.reportJsonPath !== reportPaths.json
		) {
			journal = await this.updateJournal(journal, (next) => {
				next.reportMdPath = reportPaths.markdown;
				next.reportJsonPath = reportPaths.json;
			});
		}
		await this.writeLegacyMigrationReports(journal, plan.legacyRoots);
		if (!journal.auditWritten) {
			const audit = this.renderLegacyMigrationAuditEvent(journal);
			if (this.host.appendOperationAuditEvent) {
				await this.host.appendOperationAuditEvent(journal.migrationId, audit);
			} else {
				await this.host.appendToAuditLog(audit);
			}
			journal = await this.updateJournal(journal, (next) => {
				next.auditWritten = true;
			});
		}
		await this.host.refreshGovernanceViews();

		const result = this.migrationResult(journal);
		new Notice(
			result.failedCount > 0 || result.blockedCount > 0
				? ui(
						'旧目录迁移已停止在可恢复状态，请查看迁移报告。',
						'Legacy migration stopped in a recoverable state. Review the migration report.'
				  )
				: ui(
						'旧目录文件已通过 Obsidian 原生移动并完成验证。',
						'Legacy files were moved natively and verified.'
				  )
		);
		return result;
	}

	private async serializeLegacyMigrationOperation<T>(
		migrationId: string,
		action: () => Promise<T>
	): Promise<T> {
		const vaultKey = this.app.vault as object;
		let queues = legacyMigrationOperationQueues.get(vaultKey);
		if (!queues) {
			queues = new Map<string, Promise<void>>();
			legacyMigrationOperationQueues.set(vaultKey, queues);
		}
		const predecessor = queues.get(migrationId) ?? Promise.resolve();
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = predecessor.catch(() => undefined).then(() => gate);
		queues.set(migrationId, tail);
		await predecessor.catch(() => undefined);
		try {
			return await action();
		} finally {
			release();
			if (queues.get(migrationId) === tail) {
				queues.delete(migrationId);
				if (queues.size === 0) {
					legacyMigrationOperationQueues.delete(vaultKey);
				}
			}
		}
	}

	async previewLegacyStructureCleanup(
		migrationId: string
	): Promise<LegacyCleanupPreview> {
		const journal = await this.journalRepository.read(migrationId);
		if (!journal) {
			throw new Error(
				'Legacy cleanup requires a verified migration journal.'
			);
		}
		const blockingItems = journal.items
			.filter((item) =>
				item.action === 'native_move' || item.action === 'already_moved'
					? item.state !== 'verified'
					: true
			)
			.map((item) => ({ path: item.oldPath, state: item.state }));
		const legacyRoots = this.journalLegacyRoots(journal);
		const remainingFiles = legacyRoots.flatMap((root) => {
			const folder = this.app.vault.getAbstractFileByPath(root);
			return folder instanceof TFolder
				? this.collectFiles(folder).map((file) => file.path)
				: folder
					? [root]
					: [];
		}).sort();
		const alreadyResolved = new Set([
			...(journal.cleanup?.trashedRoots ?? []),
			...(journal.cleanup?.missingRoots ?? []),
		]);
		const eligibleRoots = legacyRoots.filter((root) =>
			!alreadyResolved.has(root)
			&& this.app.vault.getAbstractFileByPath(root) instanceof TFolder
		);
		const missingRoots = legacyRoots.filter((root) =>
			!alreadyResolved.has(root)
			&& !this.app.vault.getAbstractFileByPath(root)
		);
		const canCleanup = blockingItems.length === 0 && remainingFiles.length === 0;
		const previewPayload = {
			migrationId,
			journalBindingHash: journal.bindingHash,
			eligibleRoots,
			missingRoots,
			remainingFiles,
			blockingItems,
			canCleanup,
		};
		return {
			...previewPayload,
			previewHash: hashVaultContent(canonicalJson(previewPayload)),
		};
	}

	async cleanupLegacyStructure(
		preview: LegacyCleanupPreview
	): Promise<LegacyCleanupResult> {
		if (!preview.canCleanup) {
			throw new Error(
				'Legacy cleanup is blocked by unverified journal items or remaining files.'
			);
		}
		const currentPreview = await this.previewLegacyStructureCleanup(
			preview.migrationId
		);
		if (
			currentPreview.previewHash !== preview.previewHash
			|| currentPreview.journalBindingHash !== preview.journalBindingHash
		) {
			throw new Error('Legacy cleanup preview is stale.');
		}
		let journal = await this.journalRepository.read(preview.migrationId);
		if (!journal) {
			throw new Error('Legacy cleanup journal disappeared.');
		}
		journal = await this.recoverAttemptingCleanup(journal);
		if (!journal.cleanup || journal.cleanup.previewHash !== preview.previewHash) {
			journal = await this.updateJournal(journal, (next) => {
				const trashedRoots = [...(next.cleanup?.trashedRoots ?? [])];
				next.cleanup = {
					previewHash: preview.previewHash,
					attemptingRoot: '',
					trashedRoots,
					missingRoots: sortedUnique([
						...(next.cleanup?.missingRoots ?? []),
						...preview.missingRoots,
					]).filter((root) => !trashedRoots.includes(root)),
					failedRoots: [],
					completedAt: '',
				};
			});
		}
		for (const root of preview.eligibleRoots) {
			if (
				journal.cleanup?.trashedRoots.includes(root)
				|| journal.cleanup?.missingRoots.includes(root)
			) {
				continue;
			}
			const entry = this.app.vault.getAbstractFileByPath(root);
			if (!entry) {
				journal = await this.updateJournal(journal, (next) => {
					if (!next.cleanup) return;
					next.cleanup.missingRoots = sortedUnique([
						...next.cleanup.missingRoots,
						root,
					]);
				});
				continue;
			}
			if (!(entry instanceof TFolder) || this.collectFiles(entry).length > 0) {
				throw new Error(`Legacy root is no longer empty: ${root}.`);
			}
			journal = await this.updateJournal(journal, (next) => {
				if (!next.cleanup) return;
				next.cleanup.attemptingRoot = root;
				next.cleanup.failedRoots = next.cleanup.failedRoots.filter(
					(failure) => failure.path !== root
				);
			});
			try {
				const finalEntry = this.app.vault.getAbstractFileByPath(root);
				if (!finalEntry) {
					journal = await this.updateJournal(journal, (next) => {
						if (!next.cleanup) return;
						next.cleanup.missingRoots = sortedUnique([
							...next.cleanup.missingRoots,
							root,
						]);
						next.cleanup.attemptingRoot = '';
					});
					continue;
				}
				if (
					!(finalEntry instanceof TFolder)
					|| this.collectFiles(finalEntry).length > 0
				) {
					throw new Error(`Legacy root changed before trash: ${root}.`);
				}
				await this.app.fileManager.trashFile(finalEntry);
				journal = await this.updateJournal(journal, (next) => {
					if (!next.cleanup) return;
					next.cleanup.trashedRoots = sortedUnique([
						...next.cleanup.trashedRoots,
						root,
					]);
					next.cleanup.attemptingRoot = '';
				});
			} catch (error) {
				journal = await this.updateJournal(journal, (next) => {
					if (!next.cleanup) return;
					next.cleanup.failedRoots = [
						...next.cleanup.failedRoots.filter(
							(failure) => failure.path !== root
						),
						{ path: root, error: this.boundError(error) },
					].sort((left, right) => left.path.localeCompare(right.path));
					next.cleanup.attemptingRoot = '';
				});
			}
		}
		if (journal.cleanup && journal.cleanup.failedRoots.length === 0) {
			journal = await this.updateJournal(journal, (next) => {
				if (!next.cleanup) return;
				next.cleanup.completedAt = next.cleanup.completedAt
					|| new Date().toISOString();
			});
		}

		const cleanup = journal.cleanup;
		if (!cleanup) {
			throw new Error('Legacy cleanup journal is missing.');
		}
		const cleanupId = `legacy-cleanup-${journal.migrationId}`;
		const reportPath = await this.writeLegacyCleanupReport(
			cleanupId,
			cleanup
		);
		const taskPath = await this.writeLegacyCleanupTask(
			cleanupId,
			journal.migrationId,
			reportPath,
			cleanup
		);
		const result: LegacyCleanupResult = {
			cleanupId,
			trashedRoots: cleanup.trashedRoots,
			missingRoots: cleanup.missingRoots,
			failedRoots: cleanup.failedRoots,
			reportPath,
			taskPath,
		};
		const cleanupAudit = this.renderLegacyCleanupAuditEvent(result);
		if (this.host.appendOperationAuditEvent) {
			await this.host.appendOperationAuditEvent(result.cleanupId, cleanupAudit);
		} else {
			await this.host.appendToAuditLog(cleanupAudit);
		}
		await this.host.refreshGovernanceViews();
		new Notice(
			result.failedRoots.length > 0
				? ui(
						'旧目录清理部分失败，请查看清理报告。',
						'Legacy cleanup partially failed. Review the cleanup report.'
				  )
				: ui(
						'已验证的空旧目录已移入配置的回收站。',
						'Verified empty legacy folders were moved to the configured trash.'
				  )
		);
		return result;
	}

	private resolveLegacyTarget(path: string): LegacyStructureTarget | null {
		const override = this.host.resolveLegacyTarget?.(path);
		return override === undefined ? getLegacyStructureTarget(path) : override;
	}

	private collectFiles(folder: TFolder): TFile[] {
		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile) {
				files.push(child);
			} else if (child instanceof TFolder) {
				files.push(...this.collectFiles(child));
			}
		}
		return files.sort((left, right) => left.path.localeCompare(right.path));
	}

	private async readFileEvidence(file: TFile): Promise<FileEvidence> {
		if (file.extension.toLowerCase() === 'md') {
			const text = await this.app.vault.read(file);
			return {
				hash: hashVaultContent(text),
				size: Buffer.byteLength(text, 'utf8'),
				text,
			};
		}
		const bytes = new Uint8Array(await this.app.vault.readBinary(file));
		return {
			hash: createHash('sha256').update(bytes).digest('hex'),
			size: bytes.byteLength,
			text: null,
		};
	}

	private inboundEdgeEvidence(
		snapshot: KnowledgeSnapshot,
		targetPath: string
	): LegacyMigrationJournalEdge[] {
		return this.groupEdgeEvidence(
			snapshot.graph.edges.filter((edge) =>
				edge.resolution.status === 'resolved'
				&& edge.resolution.path === targetPath
			)
		);
	}

	private outgoingEdgeEvidence(
		snapshot: KnowledgeSnapshot,
		sourcePath: string
	): LegacyMigrationJournalEdge[] {
		const note = snapshot.notes.get(sourcePath);
		return this.groupEdgeEvidence(note?.edges ?? []);
	}

	private unresolvedEvidence(
		snapshot: KnowledgeSnapshot,
		sourcePaths: readonly string[]
	): LegacyMigrationJournalEdge[] {
		const sources = new Set(sourcePaths);
		return this.groupEdgeEvidence(
			snapshot.graph.unresolvedEdges.filter((edge) =>
				Boolean(edge.sourcePath && sources.has(edge.sourcePath))
			)
		);
	}

	private groupEdgeEvidence(
		edges: readonly NormalizedVaultEdge[]
	): LegacyMigrationJournalEdge[] {
		const grouped = new Map<string, LegacyMigrationJournalEdge>();
		for (const edge of edges) {
			if (!edge.sourcePath) {
				continue;
			}
			const shapeHash = this.edgeShapeHash(edge);
			const subpath = edge.subpath ?? '';
			const subpathKind = edge.subpathKind ?? '';
			const targetPath = edge.resolution.status === 'resolved'
				? edge.resolution.path
				: '';
			const key = [
				edge.sourcePath,
				targetPath,
				shapeHash,
				subpath,
				subpathKind,
			].join('\0');
			const existing = grouped.get(key);
			if (existing) {
				existing.count += 1;
			} else {
				grouped.set(key, {
					sourcePath: edge.sourcePath,
					targetPath,
					shapeHash,
					count: 1,
					subpath,
					subpathKind,
				});
			}
		}
		return [...grouped.values()].sort(compareJournalEdges);
	}

	private edgeShapeHash(edge: NormalizedVaultEdge): string {
		const hasPathDerivedEmbedDisplay = this.isUnaliasedWikiEmbed(edge);
		return hashVaultContent(canonicalJson({
			kind: edge.kind,
			source: edge.source,
			alias: hasPathDerivedEmbedDisplay ? '' : edge.alias ?? '',
			displayText: hasPathDerivedEmbedDisplay ? '' : edge.displayText ?? '',
			subpath: edge.subpath ?? '',
			subpathKind: edge.subpathKind ?? '',
			referenceLabel: edge.referenceLabel ?? '',
		}));
	}

	private legacyPathDerivedEmbedShapeHash(
		edge: NormalizedVaultEdge,
		legacyTargetPath: string
	): string | null {
		if (!this.isUnaliasedWikiEmbed(edge) || !legacyTargetPath) {
			return null;
		}
		const legacyTarget = legacyTargetPath.replace(/\.md$/iu, '');
		const displayText = edge.subpath
			? `${legacyTarget} > ${edge.subpath}`
			: legacyTarget;
		return hashVaultContent(canonicalJson({
			kind: edge.kind,
			source: edge.source,
			alias: displayText,
			displayText,
			subpath: edge.subpath ?? '',
			subpathKind: edge.subpathKind ?? '',
			referenceLabel: edge.referenceLabel ?? '',
		}));
	}

	private isUnaliasedWikiEmbed(edge: NormalizedVaultEdge): boolean {
		return edge.kind === 'embed'
			&& /^!\[\[[^|\n]+\]\]$/u.test(edge.raw.trim());
	}

	private edgeMatchesJournalShape(
		edge: NormalizedVaultEdge,
		expectedShapeHash: string,
		legacyTargetPath: string
	): boolean {
		return this.edgeShapeHash(edge) === expectedShapeHash
			|| this.legacyPathDerivedEmbedShapeHash(edge, legacyTargetPath)
				=== expectedShapeHash;
	}

	private semanticMarkdownHash(content: string): string {
		const parsed = parseMarkdown(content);
		let normalized = content;
		for (const edge of [...parsed.edges].sort(
			(left, right) => right.position.start.offset - left.position.start.offset
		)) {
			const start = edge.position.start.offset;
			const end = edge.position.end.offset;
			if (start < 0 || end < start || end > normalized.length) {
				throw new Error('Markdown edge position is outside the source content.');
			}
			normalized = `${normalized.slice(0, start)}[[tracekeeper-edge:${this.edgeShapeHash(edge)}]]${normalized.slice(end)}`;
		}
		return hashVaultContent(normalized);
	}

	private requiredParentFolders(path: string): string[] {
		const parent = vaultParentFolder(path);
		if (!parent) {
			return [];
		}
		const missing: string[] = [];
		let current = '';
		for (const segment of parent.split('/')) {
			current = current ? `${current}/${segment}` : segment;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				missing.push(current);
			}
		}
		return missing;
	}

	private finishPlan(input: {
		migrationId: string;
		createdAt: string;
		metadataGeneration: number;
		metadataState: KnowledgeSnapshot['index_state'];
		recovery: boolean;
		linkCapability: LegacyLinkCapability;
		legacyRoots: string[];
		items: LegacyStructurePlanItem[];
	}): LegacyStructurePlan {
		const evidencePayload = {
			version: LEGACY_MIGRATION_PLAN_VERSION,
			migrationId: input.migrationId,
			metadataGeneration: input.metadataGeneration,
			metadataState: input.metadataState,
			legacyRoots: [...input.legacyRoots].sort(),
			items: input.items,
		};
		const evidenceHash = hashVaultContent(canonicalJson(evidencePayload));
		const planHash = hashVaultContent(canonicalJson({
			evidenceHash,
			linkCapability: input.linkCapability,
		}));
		const items = input.items;
		return {
			version: LEGACY_MIGRATION_PLAN_VERSION,
			migrationId: input.migrationId,
			createdAt: input.createdAt,
			metadataGeneration: input.metadataGeneration,
			metadataState: input.metadataState,
			recovery: input.recovery,
			evidenceHash,
			planHash,
			confirmationHash: hashVaultContent(
				`tracekeeper-legacy-migration-confirmation-v1\0${planHash}`
			),
			linkCapability: input.linkCapability,
			legacyRoots: [...input.legacyRoots].sort(),
			items,
			fileCount: items.length,
			markdownCount: items.filter((item) => item.isMarkdown).length,
			nonMarkdownCount: items.filter((item) => !item.isMarkdown).length,
			moveCount: items.filter((item) => item.action === 'native_move').length,
			alreadyMovedCount: items.filter(
				(item) => item.action === 'already_moved'
			).length,
			conflictCount: items.filter((item) => item.action === 'conflict').length,
			reviewCount: items.filter(
				(item) => item.action === 'conflict' || item.action === 'unmapped'
			).length,
			uncoveredCount: items.filter((item) => item.action === 'unmapped').length,
		};
	}

	private buildRecoveryPlan(
		journal: LegacyMigrationJournal,
		snapshot: KnowledgeSnapshot
	): LegacyStructurePlan {
		const items = journal.items.map((item) => {
			const planItem = this.planItemFromJournal(item);
			if (
				(item.action === 'native_move' || item.action === 'already_moved')
				&& !this.app.vault.getAbstractFileByPath(item.oldPath)
				&& this.app.vault.getAbstractFileByPath(item.newPath) instanceof TFile
			) {
				planItem.action = 'already_moved';
			}
			return planItem;
		});
		const linkCapability: LegacyLinkCapability = {
			status: journal.linkCapabilityStatus,
			reason: journal.linkCapabilityStatus === 'passed'
				? 'resolved_after_rename'
				: 'no_inbound_links',
			inboundLinkCount: items.reduce(
				(total, item) => total
					+ item.inboundEdges.reduce((count, edge) => count + edge.count, 0),
				0
			),
			probeId: null,
			beforeGeneration: null,
			afterGeneration: null,
			cleanupStatus: journal.linkCapabilityStatus === 'passed'
				? 'complete'
				: 'not_started',
		};
		const derived = this.finishPlan({
			migrationId: journal.migrationId,
			createdAt: journal.createdAt,
			metadataGeneration: journal.metadataGeneration,
			metadataState: snapshot.index_state,
			recovery: true,
			linkCapability,
			legacyRoots: this.journalLegacyRoots(journal),
			items,
		});
		return {
			...derived,
			evidenceHash: journal.planHash,
			planHash: journal.planHash,
			confirmationHash: hashVaultContent(
				`tracekeeper-legacy-migration-confirmation-v1\0${journal.planHash}`
			),
		};
	}

	private planItemFromJournal(
		item: LegacyMigrationJournalItem
	): LegacyStructurePlanItem {
		const target = item.newPath
			? this.app.vault.getAbstractFileByPath(item.newPath)
			: null;
		return {
			oldPath: item.oldPath,
			newPath: item.newPath,
			kind: item.kind as LegacyStructureKind,
			action: item.action,
			reason: item.error || (
				item.action === 'unmapped'
					? ui('没有稳定的新结构映射。', 'No stable mapping exists.')
					: item.action === 'conflict'
						? ui('目标路径存在冲突。', 'The target path conflicts.')
						: ui('恢复已记录的原生迁移。', 'Resume the journaled native migration.')
			),
			isMarkdown: item.isMarkdown,
			sourceSize: item.sourceSize,
			sourceHash: item.sourceHash,
			semanticContentHash: item.semanticContentHash,
			expectedEnrichedHash: item.expectedEnrichedHash,
			targetType: target instanceof TFile
				? 'file'
				: target instanceof TFolder
					? 'folder'
					: 'missing',
			targetHash: item.postEnrichmentHash
				?? item.postMoveHash
				?? item.initialTargetHash,
			inboundEdges: item.inboundEdges,
			outgoingEdges: item.outgoingEdges,
			unresolvedBaseline: item.unresolvedBaseline,
			requiredParents: item.newPath
				? this.requiredParentFolders(item.newPath)
				: [],
			enrichmentExpected:
				item.isMarkdown && item.expectedEnrichedHash !== item.sourceHash,
		};
	}

	private assertPlanIntegrity(plan: LegacyStructurePlan): void {
		const expectedConfirmation = hashVaultContent(
			`tracekeeper-legacy-migration-confirmation-v1\0${plan.planHash}`
		);
		if (
			plan.version !== LEGACY_MIGRATION_PLAN_VERSION
			|| !/^[a-f0-9]{64}$/.test(plan.planHash)
			|| plan.confirmationHash !== expectedConfirmation
			|| plan.items.length > MAX_PLAN_ITEMS
		) {
			throw new Error('Legacy migration preview integrity is invalid.');
		}
		if (!plan.recovery) {
			const rebuilt = this.finishPlan({
				migrationId: plan.migrationId,
				createdAt: plan.createdAt,
				metadataGeneration: plan.metadataGeneration,
				metadataState: plan.metadataState,
				recovery: false,
				linkCapability: plan.linkCapability,
				legacyRoots: plan.legacyRoots,
				items: plan.items,
			});
			if (
				rebuilt.evidenceHash !== plan.evidenceHash
				|| rebuilt.planHash !== plan.planHash
			) {
				throw new Error('Legacy migration preview was modified after creation.');
			}
		}
	}

	private linkCapabilityFromPreflight(
		result: LegacyLinkPreflightResult
	): LegacyLinkCapability {
		return {
			status: result.status,
			reason: result.reason,
			inboundLinkCount: result.inboundLinkCount,
			probeId: result.evidence.probeId,
			beforeGeneration: result.evidence.beforeGeneration,
			afterGeneration: result.evidence.afterGeneration,
			cleanupStatus: result.evidence.cleanupStatus,
		};
	}

	private async waitForProbeCleanup(
		probeId: string,
		afterGeneration: number
	): Promise<void> {
		const folder = `00_tracekeeper/control/operations/legacy-link-probes/${probeId}`;
		const deadline = Date.now() + METADATA_WAIT_TIMEOUT_MS;
		do {
			const snapshot = await this.host.loadKnowledgeSnapshot();
			const hasProbeNote = [...snapshot.notes.keys()].some(
				(path) => path === folder || path.startsWith(`${folder}/`)
			);
			if (
				!this.app.vault.getAbstractFileByPath(folder)
				&& !hasProbeNote
				&& snapshot.generation >= afterGeneration
			) {
				return;
			}
			await sleep(METADATA_POLL_INTERVAL_MS);
		} while (Date.now() <= deadline);
		throw new Error('Legacy link probe cleanup did not converge.');
	}

	private createJournal(plan: LegacyStructurePlan): LegacyMigrationJournal {
		const createdAt = new Date().toISOString();
		return bindLegacyMigrationJournal({
			version: 1,
			migrationId: plan.migrationId,
			planHash: plan.planHash,
			revision: 1,
			status: 'in_progress',
			createdAt,
			updatedAt: createdAt,
			completedAt: '',
			metadataGeneration: plan.metadataGeneration,
			linkCapabilityStatus: plan.linkCapability.status as 'not_required' | 'passed',
			items: plan.items.map((item): LegacyMigrationJournalItem => ({
				oldPath: item.oldPath,
				newPath: item.newPath,
				kind: item.kind,
				action: item.action,
				isMarkdown: item.isMarkdown,
				sourceSize: item.sourceSize,
				sourceHash: item.sourceHash,
				semanticContentHash: item.semanticContentHash,
				expectedEnrichedHash: item.expectedEnrichedHash,
				initialTargetHash: item.targetHash,
				inboundEdges: item.inboundEdges,
				outgoingEdges: item.outgoingEdges,
				unresolvedBaseline: item.unresolvedBaseline,
				state: item.action === 'conflict' || item.action === 'unmapped'
					? 'blocked'
					: 'planned',
				lastCompletedState: 'planned',
				preMoveHash: null,
				postMoveHash: null,
				postEnrichmentHash: null,
				verifiedGeneration: null,
				error: item.action === 'conflict' || item.action === 'unmapped'
					? this.boundError(item.reason)
					: '',
			})),
			cleanup: null,
			reportMdPath: '',
			reportJsonPath: '',
			auditWritten: false,
		});
	}

	private async executeMoveItem(
		journal: LegacyMigrationJournal,
		planItem: LegacyStructurePlanItem
	): Promise<LegacyMigrationJournal> {
		return withObsidianVaultPathLocks(
			this.app.vault,
			[planItem.oldPath, planItem.newPath],
			async () => {
				let currentJournal = journal;
				let item = this.findJournalItem(currentJournal, planItem.oldPath);
				if (item.state === 'verified') {
					await this.assertVerifiedObservedState(currentJournal, item);
					return currentJournal;
				}

				let source = this.app.vault.getAbstractFileByPath(item.oldPath);
				let target = this.app.vault.getAbstractFileByPath(item.newPath);
				if (source && target) {
					return this.blockJournalItem(
						currentJournal,
						item.oldPath,
						'Both the legacy source and migration target are present.'
					);
				}
				if (!source && !target) {
					return this.failJournalItem(
						currentJournal,
						item.oldPath,
						'Both the legacy source and migration target are missing.'
					);
				}
				if (source && !(source instanceof TFile)) {
					return this.blockJournalItem(
						currentJournal,
						item.oldPath,
						'The legacy source path is not a file.'
					);
				}
				if (target && !(target instanceof TFile)) {
					return this.blockJournalItem(
						currentJournal,
						item.oldPath,
						'The migration target path is not a file.'
					);
				}

				if (source instanceof TFile) {
					const sourceEvidence = await this.readFileEvidence(source);
					if (
						sourceEvidence.hash !== item.sourceHash
						|| sourceEvidence.size !== item.sourceSize
					) {
						if (
							!item.isMarkdown
							|| sourceEvidence.text === null
							|| this.semanticMarkdownHash(sourceEvidence.text)
								!== item.semanticContentHash
						) {
							return this.blockJournalItem(
								currentJournal,
								item.oldPath,
								'The legacy source changed after preview.'
							);
						}
						try {
							const currentSnapshot =
								await this.host.loadKnowledgeSnapshot();
							this.assertOutgoingEdgesPreserved(
								currentSnapshot,
								currentJournal,
								item
							);
						} catch (error) {
							return this.blockJournalItem(
								currentJournal,
								item.oldPath,
								this.boundError(error)
							);
						}
					}
					if (effectiveJournalState(item) !== 'planned') {
						return this.blockJournalItem(
							currentJournal,
							item.oldPath,
							'The migration journal and observed source path disagree.'
						);
					}
					await this.host.ensureFolderExists(vaultParentFolder(item.newPath));
					if (this.app.vault.getAbstractFileByPath(item.newPath)) {
						return this.blockJournalItem(
							currentJournal,
							item.oldPath,
							'The migration target appeared after preview.'
						);
					}
					currentJournal = await this.updateJournal(currentJournal, (next) => {
						const nextItem = this.findJournalItem(next, item.oldPath);
						nextItem.state = 'preflight_passed';
						nextItem.lastCompletedState = 'preflight_passed';
						nextItem.preMoveHash = sourceEvidence.hash;
						nextItem.error = '';
					});
					item = this.findJournalItem(currentJournal, item.oldPath);
					const finalSource = this.app.vault.getAbstractFileByPath(item.oldPath);
					const finalTarget = this.app.vault.getAbstractFileByPath(item.newPath);
					if (!(finalSource instanceof TFile)) {
						return this.blockJournalItem(
							currentJournal,
							item.oldPath,
							'The legacy source changed before the native move.'
						);
					}
					if (finalTarget) {
						return this.blockJournalItem(
							currentJournal,
							item.oldPath,
							'The migration target appeared before the native move.'
						);
					}
					const finalSourceEvidence = await this.readFileEvidence(finalSource);
					if (
						finalSourceEvidence.hash !== sourceEvidence.hash
						|| finalSourceEvidence.size !== sourceEvidence.size
					) {
						return this.blockJournalItem(
							currentJournal,
							item.oldPath,
							'The legacy source changed before the native move.'
						);
					}
					await this.app.fileManager.renameFile(finalSource, item.newPath);
					source = this.app.vault.getAbstractFileByPath(item.oldPath);
					target = this.app.vault.getAbstractFileByPath(item.newPath);
				}

				if (source || !(target instanceof TFile)) {
					return this.blockJournalItem(
						currentJournal,
						item.oldPath,
						'The native move did not produce the expected source/target state.'
					);
				}
				item = this.findJournalItem(currentJournal, item.oldPath);
				if (
					stateRank(effectiveJournalState(item))
					< stateRank('preflight_passed')
				) {
					return this.blockJournalItem(
						currentJournal,
						item.oldPath,
						'The migration target exists without journaled move intent.'
					);
				}
				const movedEvidence = await this.readFileEvidence(target);
				const allowedRecoveryHashes = new Set([
					item.sourceHash,
					item.expectedEnrichedHash,
					...(item.preMoveHash ? [item.preMoveHash] : []),
					...(item.postMoveHash ? [item.postMoveHash] : []),
					...(item.postEnrichmentHash ? [item.postEnrichmentHash] : []),
				]);
				if (!allowedRecoveryHashes.has(movedEvidence.hash)) {
					return this.blockJournalItem(
						currentJournal,
						item.oldPath,
						'The migration target content does not match journal ownership.'
					);
				}
				if (stateRank(effectiveJournalState(item)) < stateRank('moved')) {
					currentJournal = await this.updateJournal(currentJournal, (next) => {
						const nextItem = this.findJournalItem(next, item.oldPath);
						nextItem.state = 'moved';
						nextItem.lastCompletedState = 'moved';
						nextItem.postMoveHash = movedEvidence.hash;
						nextItem.error = '';
					});
				}

				item = this.findJournalItem(currentJournal, item.oldPath);
				if (stateRank(effectiveJournalState(item)) < stateRank('enriched')) {
					let postEnrichmentHash = movedEvidence.hash;
					if (item.isMarkdown) {
						const freshTarget = this.app.vault.getAbstractFileByPath(item.newPath);
						if (!(freshTarget instanceof TFile)) {
							return this.failJournalItem(
								currentJournal,
								item.oldPath,
								'The moved Markdown target disappeared before enrichment.'
							);
						}
						const currentText = await this.app.vault.read(freshTarget);
						const enriched = enrichLegacyMarkdownContent(currentText, {
							migrationId: currentJournal.migrationId,
							oldPath: item.oldPath,
							newPath: item.newPath,
							kind: item.kind as LegacyStructureKind,
						});
						if (enriched !== currentText) {
							await this.app.vault.process(freshTarget, (latest) => {
								if (hashVaultContent(latest) !== hashVaultContent(currentText)) {
									throw new Error(
										'The moved Markdown target changed before enrichment.'
									);
								}
								return enrichLegacyMarkdownContent(latest, {
									migrationId: currentJournal.migrationId,
									oldPath: item.oldPath,
									newPath: item.newPath,
									kind: item.kind as LegacyStructureKind,
								});
							});
						}
						const enrichedTarget = this.app.vault.getAbstractFileByPath(item.newPath);
						if (!(enrichedTarget instanceof TFile)) {
							throw new Error('The enriched migration target disappeared.');
						}
						postEnrichmentHash = (
							await this.readFileEvidence(enrichedTarget)
						).hash;
					}
					currentJournal = await this.updateJournal(currentJournal, (next) => {
						const nextItem = this.findJournalItem(next, item.oldPath);
						nextItem.state = 'enriched';
						nextItem.lastCompletedState = 'enriched';
						nextItem.postEnrichmentHash = postEnrichmentHash;
						nextItem.error = '';
					});
				}

				item = this.findJournalItem(currentJournal, item.oldPath);
				let verifiedGeneration: number;
				try {
					verifiedGeneration = await this.waitForItemVerification(
						currentJournal,
						item
					);
				} catch (error) {
					return this.blockJournalItem(
						currentJournal,
						item.oldPath,
						this.boundError(error)
					);
				}
				return this.updateJournal(currentJournal, (next) => {
					const nextItem = this.findJournalItem(next, item.oldPath);
					nextItem.state = 'verified';
					nextItem.lastCompletedState = 'verified';
					nextItem.verifiedGeneration = verifiedGeneration;
					nextItem.error = '';
				});
			}
		);
	}

	private async waitForItemVerification(
		journal: LegacyMigrationJournal,
		item: LegacyMigrationJournalItem
	): Promise<number> {
		const deadline = Date.now()
			+ (this.host.metadataWaitTimeoutMs ?? METADATA_WAIT_TIMEOUT_MS);
		let lastReason = 'Metadata has not converged.';
		do {
			try {
				const target = this.app.vault.getAbstractFileByPath(item.newPath);
				if (
					this.app.vault.getAbstractFileByPath(item.oldPath)
					|| !(target instanceof TFile)
				) {
					throw new Error('Observed source/target paths are not converged.');
				}
				const currentEvidence = await this.readFileEvidence(target);
				if (
					!item.postEnrichmentHash
					|| currentEvidence.hash !== item.postEnrichmentHash
				) {
					throw new Error('The migration target changed before verification.');
				}
				const snapshot = await this.host.loadKnowledgeSnapshot();
				const needsMetadataAdvance =
					item.isMarkdown || item.inboundEdges.length > 0;
				const snapshotCreatedAt = Date.parse(snapshot.createdAt);
				const journalCreatedAt = Date.parse(journal.createdAt);
				const indexRestartedAfterJournal =
					Number.isFinite(snapshotCreatedAt)
					&& Number.isFinite(journalCreatedAt)
					&& snapshotCreatedAt > journalCreatedAt;
				if (
					snapshot.index_state !== 'ready'
					|| (
						needsMetadataAdvance
						&& !indexRestartedAfterJournal
						&& snapshot.generation <= journal.metadataGeneration
					)
				) {
					throw new Error('The native metadata generation has not advanced.');
				}
				this.assertInboundEdgesPreserved(snapshot, journal, item);
				this.assertOutgoingEdgesPreserved(snapshot, journal, item);
				this.assertNoNewUnresolvedEdges(snapshot, journal, item);
				this.assertSubpathsPreserved(snapshot, item);
				return snapshot.generation;
			} catch (error) {
				lastReason = error instanceof Error ? error.message : String(error);
			}
			await sleep(METADATA_POLL_INTERVAL_MS);
		} while (Date.now() <= deadline);
		throw new Error(`Legacy migration verification timed out: ${lastReason}`);
	}

	private assertInboundEdgesPreserved(
		snapshot: KnowledgeSnapshot,
		journal: LegacyMigrationJournal,
		item: LegacyMigrationJournalItem
	): void {
		const current = snapshot.graph.edges.filter((edge) =>
			edge.resolution.status === 'resolved'
				&& edge.resolution.path === item.newPath
		);
		for (const expected of item.inboundEdges) {
			const sourceItem = journal.items.find(
				(candidate) => candidate.oldPath === expected.sourcePath
			);
			if (sourceItem && sourceItem.state !== 'verified') {
				continue;
			}
			const expectedSource = this.currentJournalPath(
				journal,
				expected.sourcePath
			);
			const actualCount = current
				.filter((edge) =>
					edge.sourcePath === expectedSource
						&& (edge.subpath ?? '') === expected.subpath
						&& (edge.subpathKind ?? '') === expected.subpathKind
						&& this.edgeMatchesJournalShape(
							edge,
							expected.shapeHash,
							expected.targetPath
						)
				)
				.length;
			if (actualCount < expected.count) {
				throw new Error(
					`A resolved inbound relation did not converge: ${expected.sourcePath}.`
				);
			}
		}
	}

	private assertOutgoingEdgesPreserved(
		snapshot: KnowledgeSnapshot,
		journal: LegacyMigrationJournal,
		item: LegacyMigrationJournalItem
	): void {
		const sourcePath = this.currentJournalPath(journal, item.oldPath);
		const current = snapshot.notes.get(sourcePath)?.edges ?? [];
		for (const expected of item.outgoingEdges) {
			const targetItem = journal.items.find(
				(candidate) => candidate.oldPath === expected.targetPath
			);
			if (targetItem && targetItem.state !== 'verified') {
				continue;
			}
			const expectedTarget = expected.targetPath
				? this.currentJournalPath(journal, expected.targetPath)
				: '';
			const actualCount = current
				.filter((edge) =>
					edge.sourcePath === sourcePath
						&& (
							edge.resolution.status === 'resolved'
								? edge.resolution.path
								: ''
						) === expectedTarget
						&& (edge.subpath ?? '') === expected.subpath
						&& (edge.subpathKind ?? '') === expected.subpathKind
						&& this.edgeMatchesJournalShape(
							edge,
							expected.shapeHash,
							expected.targetPath
						)
				)
				.length;
			if (actualCount < expected.count) {
				throw new Error(
					`A source relation changed after preview: ${item.oldPath}.`
				);
			}
		}
	}

	private assertNoNewUnresolvedEdges(
		snapshot: KnowledgeSnapshot,
		journal: LegacyMigrationJournal,
		item: LegacyMigrationJournalItem
	): void {
		if (journal.items.some((candidate) =>
			(candidate.action === 'native_move' || candidate.action === 'already_moved')
				&& candidate.state !== 'verified'
		)) {
			return;
		}
		const relevantSources = new Set([
			item.oldPath,
			item.newPath,
			...item.inboundEdges.map((edge) =>
				this.currentJournalPath(journal, edge.sourcePath)
			),
		]);
		const current = this.groupEdgeEvidence(
			snapshot.graph.unresolvedEdges.filter((edge) =>
				Boolean(edge.sourcePath && relevantSources.has(edge.sourcePath))
			)
		);
		for (const edge of current) {
			const originalSource = this.originalJournalPath(journal, edge.sourcePath);
			const baselineCount = item.unresolvedBaseline
				.filter((baseline) =>
					baseline.sourcePath === originalSource
					&& baseline.shapeHash === edge.shapeHash
					&& baseline.subpath === edge.subpath
					&& baseline.subpathKind === edge.subpathKind
				)
				.reduce((total, baseline) => total + baseline.count, 0);
			if (edge.count > baselineCount) {
				throw new Error(
					`Migration introduced an unresolved relation from ${edge.sourcePath}.`
				);
			}
		}
	}

	private assertSubpathsPreserved(
		snapshot: KnowledgeSnapshot,
		item: LegacyMigrationJournalItem
	): void {
		if (!item.isMarkdown) {
			return;
		}
		const target = snapshot.notes.get(item.newPath);
		if (!target) {
			throw new Error('The moved Markdown target is absent from the native index.');
		}
		for (const edge of item.inboundEdges) {
			if (!edge.subpath) {
				continue;
			}
			if (
				edge.subpathKind === 'block'
				&& !target.blockIds.includes(edge.subpath.replace(/^\^/u, ''))
			) {
				throw new Error(`A block reference target was lost: ${edge.subpath}.`);
			}
			if (
				edge.subpathKind === 'heading'
				&& !target.headings.includes(edge.subpath)
			) {
				throw new Error(`A heading reference target was lost: ${edge.subpath}.`);
			}
		}
	}

	private async assertVerifiedObservedState(
		journal: LegacyMigrationJournal,
		item: LegacyMigrationJournalItem
	): Promise<void> {
		if (this.app.vault.getAbstractFileByPath(item.oldPath)) {
			throw new Error(`Verified migration source reappeared: ${item.oldPath}.`);
		}
		const target = this.app.vault.getAbstractFileByPath(item.newPath);
		if (!(target instanceof TFile)) {
			throw new Error(`Verified migration target is missing: ${item.newPath}.`);
		}
		const evidence = await this.readFileEvidence(target);
		if (
			!item.postEnrichmentHash
			|| evidence.hash !== item.postEnrichmentHash
		) {
			throw new Error(`Verified migration target changed: ${item.newPath}.`);
		}
		const snapshot = await this.host.loadKnowledgeSnapshot();
		this.assertInboundEdgesPreserved(snapshot, journal, item);
		this.assertOutgoingEdgesPreserved(snapshot, journal, item);
		this.assertNoNewUnresolvedEdges(snapshot, journal, item);
	}

	private currentJournalPath(
		journal: LegacyMigrationJournal,
		originalPath: string
	): string {
		const item = journal.items.find((candidate) =>
			candidate.oldPath === originalPath
		);
		if (
			item
			&& stateRank(effectiveJournalState(item)) >= stateRank('moved')
		) {
			return item.newPath;
		}
		return originalPath;
	}

	private originalJournalPath(
		journal: LegacyMigrationJournal,
		currentPath: string
	): string {
		const item = journal.items.find((candidate) =>
			candidate.newPath === currentPath
			&& stateRank(effectiveJournalState(candidate)) >= stateRank('moved')
		);
		return item?.oldPath ?? currentPath;
	}

	private async blockJournalItem(
		journal: LegacyMigrationJournal,
		oldPath: string,
		reason: string
	): Promise<LegacyMigrationJournal> {
		return this.updateJournal(journal, (next) => {
			const item = this.findJournalItem(next, oldPath);
			item.state = 'blocked';
			item.error = this.boundError(reason);
			next.status = 'blocked';
		});
	}

	private async failJournalItem(
		journal: LegacyMigrationJournal,
		oldPath: string,
		reason: string
	): Promise<LegacyMigrationJournal> {
		return this.updateJournal(journal, (next) => {
			const item = this.findJournalItem(next, oldPath);
			item.state = 'failed';
			item.error = this.boundError(reason);
			next.status = 'failed';
		});
	}

	private async updateJournal(
		journal: LegacyMigrationJournal,
		mutate: (next: LegacyMigrationJournal) => void
	): Promise<LegacyMigrationJournal> {
		const next = JSON.parse(JSON.stringify(journal)) as LegacyMigrationJournal;
		const previousAuditState = this.migrationAuditState(journal);
		mutate(next);
		if (
			journal.auditWritten
			&& next.auditWritten
			&& this.migrationAuditState(next) !== previousAuditState
		) {
			next.auditWritten = false;
		}
		next.revision = journal.revision + 1;
		next.updatedAt = new Date().toISOString();
		return this.journalRepository.write(next, journal.bindingHash);
	}

	private migrationAuditState(journal: LegacyMigrationJournal): string {
		return canonicalJson({
			status: journal.status,
			movedCount: journal.items.filter((item) => Boolean(item.postMoveHash)).length,
			reviewCount: journal.items.filter(
				(item) => item.action === 'conflict' || item.action === 'unmapped'
			).length,
			reportMdPath: journal.reportMdPath,
		});
	}

	private findJournalItem(
		journal: LegacyMigrationJournal,
		oldPath: string
	): LegacyMigrationJournalItem {
		const item = journal.items.find((candidate) => candidate.oldPath === oldPath);
		if (!item) {
			throw new Error(`Migration journal item is missing: ${oldPath}.`);
		}
		return item;
	}

	private async recoverAttemptingCleanup(
		journal: LegacyMigrationJournal
	): Promise<LegacyMigrationJournal> {
		const attemptingRoot = journal.cleanup?.attemptingRoot;
		if (!attemptingRoot) {
			return journal;
		}
		const entry = this.app.vault.getAbstractFileByPath(attemptingRoot);
		if (!entry) {
			return this.updateJournal(journal, (next) => {
				if (!next.cleanup) return;
				next.cleanup.trashedRoots = sortedUnique([
					...next.cleanup.trashedRoots,
					attemptingRoot,
				]);
				next.cleanup.attemptingRoot = '';
			});
		}
		if (!(entry instanceof TFolder) || this.collectFiles(entry).length > 0) {
			throw new Error(
				`Legacy cleanup recovery found a non-empty target: ${attemptingRoot}.`
			);
		}
		return this.updateJournal(journal, (next) => {
			if (!next.cleanup) return;
			next.cleanup.attemptingRoot = '';
		});
	}

	private async legacyMigrationReviewExists(
		oldPath: string,
		migrationId: string
	): Promise<boolean> {
		const directPath = buildLegacyMigrationReviewPath(migrationId, oldPath);
		if (this.app.vault.getAbstractFileByPath(directPath) instanceof TFile) {
			return true;
		}
		const folder = this.app.vault.getAbstractFileByPath(
			TRACEKEEPER_REVIEW_QUEUE_DIR
		);
		if (!(folder instanceof TFolder)) {
			return false;
		}
		for (const file of this.collectFiles(folder).filter(
			(item) => item.extension === 'md'
		)) {
			const content = await this.app.vault.read(file);
			if (content.includes(`source_path: ${JSON.stringify(oldPath)}`)) {
				return true;
			}
		}
		return false;
	}

	private async writeLegacyMigrationReview(
		item: LegacyStructurePlanItem,
		migrationId: string
	): Promise<void> {
		const reviewPath = buildLegacyMigrationReviewPath(migrationId, item.oldPath);
		if (this.app.vault.getAbstractFileByPath(reviewPath)) {
			return;
		}
		await this.host.ensureFolderExists(vaultParentFolder(reviewPath));
		const source = this.app.vault.getAbstractFileByPath(item.oldPath);
		const sourceContent = source instanceof TFile && item.isMarkdown
			? await this.app.vault.read(source)
			: `[binary or unavailable file: ${item.oldPath}]`;
		const content = renderLegacyMigrationReview({
			migrationId,
			oldPath: item.oldPath,
			newPath: item.newPath || 'unmapped',
			kind: item.kind,
			reason: item.reason,
			sourceContent,
			sourceHash: item.sourceHash,
			targetHash: item.targetHash,
		});
		await this.host.ensureFileDoesNotExist(reviewPath, content);
	}

	private migrationReportPaths(migrationId: string): {
		markdown: string;
		json: string;
	} {
		const reportDir = '00_tracekeeper/control/migrations';
		return {
			markdown: `${reportDir}/${migrationId}.md`,
			json: `${reportDir}/${migrationId}.json`,
		};
	}

	private async writeLegacyMigrationReports(
		journal: LegacyMigrationJournal,
		legacyRoots: readonly string[]
	): Promise<void> {
		const movedCount = journal.items.filter((item) =>
			Boolean(item.postMoveHash)
		).length;
		const verifiedCount = journal.items.filter(
			(item) => item.state === 'verified'
		).length;
		const blocked = journal.items.filter((item) => item.state === 'blocked');
		const failed = journal.items.filter((item) => item.state === 'failed');
		const json = `${JSON.stringify({
			schema_version: 1,
			migration_id: journal.migrationId,
			plan_hash: journal.planHash,
			journal_revision: journal.revision,
			status: journal.status,
			legacy_roots: legacyRoots,
			moved_count: movedCount,
			verified_count: verifiedCount,
			blocked_count: blocked.length,
			failed_count: failed.length,
			items: journal.items.map((item) => ({
				old_path: item.oldPath,
				new_path: item.newPath,
				action: item.action,
				state: item.state,
				source_hash: item.sourceHash,
				post_enrichment_hash: item.postEnrichmentHash,
				error: item.error,
			})),
		}, null, 2)}\n`;
		const markdown = [
			'# Legacy structure migration report',
			'',
			`- Migration id: \`${journal.migrationId}\``,
			`- Plan hash: \`${journal.planHash}\``,
			`- Status: \`${journal.status}\``,
			`- Native moves observed: ${movedCount}`,
			`- Verified: ${verifiedCount}`,
			`- Blocked: ${blocked.length}`,
			`- Failed: ${failed.length}`,
			'- Legacy roots cleaned: no',
			'',
			'## Blocked or failed items',
			'',
			...(
				blocked.length + failed.length > 0
					? [...blocked, ...failed].map(
							(item) =>
								`- \`${item.oldPath}\` -> \`${item.newPath || 'unmapped'}\`: ${item.error}`
					  )
					: ['None']
			),
			'',
		].join('\n');
		await this.writeOwnedFile(journal.reportMdPath, markdown, [
			`Migration id: \`${journal.migrationId}\``,
			`Plan hash: \`${journal.planHash}\``,
		]);
		await this.writeOwnedFile(journal.reportJsonPath, json, [
			`"migration_id": "${journal.migrationId}"`,
			`"plan_hash": "${journal.planHash}"`,
		]);
	}

	private async writeOwnedFile(
		path: string,
		content: string,
		ownershipMarkers: readonly string[]
	): Promise<void> {
		await this.host.ensureFolderExists(vaultParentFolder(path));
		await withObsidianVaultPathLocks(this.app.vault, [path], async () => {
			let existing = this.app.vault.getAbstractFileByPath(path);
			if (!existing) {
				try {
					await this.app.vault.create(path, content);
					return;
				} catch (error) {
					existing = this.app.vault.getAbstractFileByPath(path);
					if (!(existing instanceof TFile)) {
						throw error;
					}
				}
			}
			if (!(existing instanceof TFile)) {
				throw new Error(`Owned migration artifact path is a folder: ${path}.`);
			}
			const current = await this.app.vault.read(existing);
			if (current === content) {
				return;
			}
			if (!ownershipMarkers.every((marker) => current.includes(marker))) {
				throw new Error(`Owned migration artifact changed outside the operation: ${path}.`);
			}
			const expectedHash = hashVaultContent(current);
			await this.app.vault.process(existing, (latest) => {
				if (
					hashVaultContent(latest) !== expectedHash
					|| !ownershipMarkers.every((marker) => latest.includes(marker))
				) {
					throw new Error(
						`Owned migration artifact changed outside the operation: ${path}.`
					);
				}
				return content;
			});
		});
	}

	private migrationResult(
		journal: LegacyMigrationJournal
	): LegacyMigrationResult {
		const verifiedCount = journal.items.filter(
			(item) => item.state === 'verified'
		).length;
		const blockedCount = journal.items.filter(
			(item) => item.state === 'blocked'
		).length;
		const failedCount = journal.items.filter(
			(item) => item.state === 'failed'
		).length;
		return {
			migrationId: journal.migrationId,
			movedCount: journal.items.filter((item) => Boolean(item.postMoveHash)).length,
			verifiedCount,
			blockedCount,
			failedCount,
			reviewCount: journal.items.filter(
				(item) => item.action === 'conflict' || item.action === 'unmapped'
			).length,
			cleanupAvailable:
				verifiedCount === journal.items.length
				&& blockedCount === 0
				&& failedCount === 0,
			reportMdPath: journal.reportMdPath,
			reportJsonPath: journal.reportJsonPath,
			journalPath: this.journalRepository.pathFor(journal.migrationId),
		};
	}

	private journalLegacyRoots(journal: LegacyMigrationJournal): string[] {
		return sortedUnique(
			journal.items
				.map((item) => item.oldPath.split('/')[0])
				.filter((root) =>
					(LEGACY_TOP_LEVEL_DIRS as readonly string[]).includes(root)
				)
		);
	}

	private async writeLegacyCleanupReport(
		cleanupId: string,
		cleanup: NonNullable<LegacyMigrationJournal['cleanup']>
	): Promise<string> {
		const reportPath = `00_tracekeeper/control/migrations/${cleanupId}.md`;
		const content = [
			'# Legacy directory cleanup report',
			'',
			`- Cleanup id: \`${cleanupId}\``,
			'- Method: Obsidian configured trash through FileManager',
			`- Trashed legacy directories: ${cleanup.trashedRoots.length}`,
			`- Missing legacy directories: ${cleanup.missingRoots.length}`,
			`- Failed: ${cleanup.failedRoots.length}`,
			`- Completed: ${cleanup.completedAt ? 'yes' : 'no'}`,
			'',
			'## Trashed',
			'',
			...(cleanup.trashedRoots.length > 0
				? cleanup.trashedRoots.map((root) => `- \`${root}\``)
				: ['None']),
			'',
			'## Failed',
			'',
			...(cleanup.failedRoots.length > 0
				? cleanup.failedRoots.map(
						(item) => `- \`${item.path}\`: ${item.error}`
				  )
				: ['None']),
			'',
		].join('\n');
		await this.writeOwnedFile(reportPath, content, [
			`Cleanup id: \`${cleanupId}\``,
		]);
		return reportPath;
	}

	private async writeLegacyCleanupTask(
		cleanupId: string,
		migrationId: string,
		cleanupReportPath: string,
		cleanup: NonNullable<LegacyMigrationJournal['cleanup']>
	): Promise<string> {
		const now = new Date().toISOString();
		const taskId = `obs_task_${cleanupId.replace(/[^0-9A-Za-z]+/g, '_')}`;
		const taskPath = `${TRACEKEEPER_TASKS_DIR}/${taskId}.md`;
		const content = [
			'---',
			'agent: "tracekeeper"',
			'client: "obsidian"',
			'objective: "原生迁移旧 Tracekeeper 目录并清理已验证空目录"',
			'related_project: "tracekeeper_legacy_structure_migration"',
			`session_id: "${migrationId}"`,
			`started_at: "${now}"`,
			`finished_at: "${now}"`,
			cleanup.failedRoots.length > 0 ? 'status: "warning"' : 'status: "completed"',
			`task_id: "${taskId}"`,
			'title: "旧目录原生迁移与清理"',
			'tool: "tracekeeper.structure_organizer"',
			'type: "agent-task"',
			'memory_writes:',
			`  - "${cleanupReportPath}"`,
			`  - "00_tracekeeper/control/migrations/${migrationId}.md"`,
			'---',
			'',
			'# 旧目录原生迁移与清理',
			'',
			'## Summary',
			'',
			`- 已验证空目录进入配置回收站：${cleanup.trashedRoots.length} 个。`,
			`- 清理失败：${cleanup.failedRoots.length} 个。`,
			`- 迁移报告：[[00_tracekeeper/control/migrations/${migrationId}|${migrationId}]]`,
			`- 清理报告：[[${cleanupReportPath.replace(/\.md$/i, '')}|${cleanupId}]]`,
			'',
			'## Graph links',
			'',
			`- [[${KNOWLEDGE_INDEX_PATH.replace(/\.md$/i, '')}|Knowledge index]]`,
			`- [[${KNOWLEDGE_MEMORY_INDEX_PATH.replace(/\.md$/i, '')}|Memory index]]`,
			`- [[${KNOWLEDGE_WIKI_HUBS_INDEX_PATH.replace(/\.md$/i, '')}|Wiki hubs]]`,
			'',
		].join('\n');
		await this.writeOwnedFile(taskPath, content, [
			`task_id: "${taskId}"`,
			`session_id: "${migrationId}"`,
		]);
		return taskPath;
	}

	private renderLegacyMigrationAuditEvent(
		journal: LegacyMigrationJournal
	): string {
		const timestamp = journal.completedAt || journal.updatedAt;
		return (
			`## ${timestamp}\n`
			+ 'action: legacy_structure.migrate\n'
			+ 'actor: user\n'
			+ `result: ${journal.status}\n`
			+ `operation_id: ${journal.migrationId}\n`
			+ `migration_id: ${journal.migrationId}\n`
			+ `moved_count: ${journal.items.filter((item) => Boolean(item.postMoveHash)).length}\n`
			+ `review_count: ${journal.items.filter((item) => item.action === 'conflict' || item.action === 'unmapped').length}\n`
			+ `target: ${journal.reportMdPath}\n`
			+ `timestamp: ${timestamp}\n\n`
		);
	}

	private renderLegacyCleanupAuditEvent(result: LegacyCleanupResult): string {
		const now = new Date().toISOString();
		return (
			`## ${now}\n`
			+ 'action: legacy_structure.cleanup\n'
			+ 'actor: user\n'
			+ `result: ${result.failedRoots.length > 0 ? 'partial' : 'success'}\n`
			+ `cleanup_id: ${result.cleanupId}\n`
			+ `trashed_roots: ${result.trashedRoots.length}\n`
			+ `failed_roots: ${result.failedRoots.length}\n`
			+ `task_id: ${result.taskPath.replace(`${TRACEKEEPER_TASKS_DIR}/`, '').replace(/\.md$/i, '')}\n`
			+ `target: ${result.reportPath}\n`
			+ `timestamp: ${now}\n\n`
		);
	}

	private boundError(error: unknown): string {
		const text = error instanceof Error ? error.message : String(error);
		return Array.from(text, (character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f ? ' ' : character;
		}).join('').slice(0, MAX_ERROR_LENGTH);
	}
}

function effectiveJournalState(
	item: LegacyMigrationJournalItem
): LegacyMigrationCompletedItemState {
	return item.state === 'blocked' || item.state === 'failed'
		? item.lastCompletedState
		: item.state;
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

function compareJournalEdges(
	left: LegacyMigrationJournalEdge,
	right: LegacyMigrationJournalEdge
): number {
	return (
		left.sourcePath.localeCompare(right.sourcePath)
		|| left.targetPath.localeCompare(right.targetPath)
		|| left.shapeHash.localeCompare(right.shapeHash)
		|| left.subpath.localeCompare(right.subpath)
		|| left.subpathKind.localeCompare(right.subpathKind)
	);
}

function sortedUnique(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});
}
