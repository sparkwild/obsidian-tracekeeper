import { App, TFile, TFolder } from 'obsidian';
import {
	TRACEKEEPER_AUDIT_DIR,
	TRACEKEEPER_AUDIT_LOG_PATH,
	TRACEKEEPER_OPERATIONS_DIR,
	buildAuditCleanupPreview,
	computePayloadHash,
	hashVaultContent,
	mergeAuditEvents,
	validateAuditCleanupPreview,
	type AuditEventSourceKind,
} from '@tracekeeper/core';
import {
	getReviewProposalAttentionState,
	type MemoryProposalRecord,
} from '../review/review-view-model';
import { memoryProposalStatusLabel } from '../review/review-queue-model';
import {
	RUNTIME_LOG_FILTERS,
	RUNTIME_LOG_CLEANUP_OPTIONS,
	RUNTIME_LOG_MAX_EVENTS,
	RUNTIME_LOG_PAGE_SIZE,
	type RuntimeLogCategory,
	type RuntimeLogCleanupFailure,
	type RuntimeLogCleanupFile,
	type RuntimeLogCleanupPreview,
	type RuntimeLogCleanupResult,
	type RuntimeLogCleanupScope,
	type RuntimeLogCleanupStale,
	type RuntimeLogFilter,
	type RuntimeLogItem,
	type RuntimeLogSnapshot,
} from '../runtime/runtime-log-model';
import type { RuntimeViewStatus } from '../../main';
import type { TracekeeperStructureStatus } from '../structure/legacy-migration-controller';
import {
	ACTIVITY_TIMELINE_PAGE_SIZE,
	ACTIVITY_TIMELINE_PREVIEW_ROWS,
	AGENT_TASKS_PATH,
	MAX_ACTIVITY_CONTEXT_PACK_ROWS,
	MAX_ACTIVITY_PROPOSAL_ROWS,
	MAX_ACTIVITY_SOURCE_CAPTURE_ROWS,
	MAX_AUDIT_ROWS,
	MAX_SOURCE_STATUS_ROWS,
	MAX_TASK_ROWS,
	type ActivityTimelineItem,
	type ActivityTimelineSnapshot,
	type AgentActivitySnapshot,
	type AgentConnectionRecord,
	type AgentTaskRecord,
	type AgentToolCallRecord,
	type AuditEventRecord,
	type ContextPackRecord,
	type SourceCaptureRecord,
	type SourceRequestRecord,
} from './activity-model';
import { ui } from '../../ui/localization';
import { buildAgentWorkflowDiagnostics } from './activity-workflow-diagnostics';
import { buildRecentObservedClientConnections } from './activity-observed-client';
import { withObsidianVaultPathLock } from '../../adapters/obsidian-vault-path-lock';

type ParsedRecordValue = string | string[];
type ParsedRecord = Record<string, ParsedRecordValue>;

export interface ActivityDataControllerHost {
	readRecentAgentTasks(limit: number): Promise<AgentTaskRecord[]>;
	readRecentContextPacks(limit: number): Promise<ContextPackRecord[]>;
	readRecentSourceCaptures(limit: number): Promise<SourceCaptureRecord[]>;
	readRecentSourceRequests(limit: number): Promise<SourceRequestRecord[]>;
	readRecentMemoryProposals(limit: number): Promise<MemoryProposalRecord[]>;
	getStructureStatus(): TracekeeperStructureStatus;
	getRuntimeViewStatus(): RuntimeViewStatus;
	getVaultRoot(): string;
	refreshGovernanceViews(): Promise<void>;
	readFrontmatter(content: string): { fields: ParsedRecord; body: string };
	firstString(values: ParsedRecord, keys: string[]): string;
	readStringList(values: ParsedRecord, keys: string[]): string[];
	readKeyValueRows(lines: string[]): ParsedRecord;
	parseTimestamp(timestamp: string | undefined, fallbackMs?: number): number;
	timestampFromFilename(filename: string): string;
	snippetFromText(text: string, fallback?: string): string;
	trimText(value: string, maxLength?: number): string;
	buildAuditLogHeader(): string;
	ensureFolderExists(path: string): Promise<void>;
	getConfiguredTrashDescription(): string;
	formatAgentDisplayName(clientName: string, agentId: string): string;
	formatToolDisplayName(toolName: string): string;
	formatResultLabel(status: string): string;
	formatRiskLabel(risk: string): string;
}

interface RuntimeLogCleanupReceiptState {
	schemaVersion: 1;
	revision: number;
	bindingHash: string;
	operationId: string;
	previewHash: string;
	status: 'in-progress' | 'completed' | 'partial';
	scope: RuntimeLogCleanupScope;
	cutoff: string | null;
	attemptingPath: string;
	trashedPaths: string[];
	failed: RuntimeLogCleanupFailure[];
	stale: RuntimeLogCleanupStale[];
	retainedPaths: string[];
	completedAt: string;
}

const RUNTIME_LOG_CLEANUP_PREVIEW_TTL_MS = 5 * 60 * 1000;
const RUNTIME_LOG_CLEANUP_RECEIPT_MAX_LENGTH = 64 * 1024;
const runtimeLogCleanupQueues = new WeakMap<
	object,
	Map<string, Promise<void>>
>();

export class ActivityDataController {
	constructor(
		private readonly app: App,
		private readonly host: ActivityDataControllerHost
	) {}

async loadAgentActivitySnapshot(): Promise<AgentActivitySnapshot> {
		const [
			recentTasks,
			recentContextPacks,
			recentSourceCaptures,
			recentSourceRequests,
			reviewQueueItems,
			recentAuditEvents,
		] = await Promise.all([
			this.host.readRecentAgentTasks(MAX_TASK_ROWS),
			this.host.readRecentContextPacks(MAX_ACTIVITY_CONTEXT_PACK_ROWS),
			this.host.readRecentSourceCaptures(MAX_ACTIVITY_SOURCE_CAPTURE_ROWS),
			this.host.readRecentSourceRequests(MAX_SOURCE_STATUS_ROWS),
			this.host.readRecentMemoryProposals(Number.MAX_SAFE_INTEGER),
			this.readRecentAuditEvents(MAX_AUDIT_ROWS),
		]);
		const recentProposals = reviewQueueItems.slice(0, MAX_ACTIVITY_PROPOSAL_ROWS);
		const reviewQueueItemCount = reviewQueueItems.length;
		const incompleteReviewQueueItemCount = reviewQueueItems.filter(
			(proposal) => getReviewProposalAttentionState(proposal) === 'incomplete'
		).length;
		const pendingReviewQueueItemCount = reviewQueueItems.filter(
			(proposal) => getReviewProposalAttentionState(proposal) === 'pending_review'
		).length;
		const readyToApplyReviewQueueItemCount = reviewQueueItems.filter(
			(proposal) => getReviewProposalAttentionState(proposal) === 'ready_to_apply'
		).length;
		const revisionRequestedReviewQueueItemCount = reviewQueueItems.filter(
			(proposal) => getReviewProposalAttentionState(proposal) === 'awaiting_revision'
		).length;
		const actionableReviewQueueItemCount =
			incompleteReviewQueueItemCount + pendingReviewQueueItemCount + readyToApplyReviewQueueItemCount;
		const latestTask = recentTasks[0] ?? null;
		const structureStatus = this.host.getStructureStatus();
		const taskFolderMissing =
			this.app.vault.getAbstractFileByPath(AGENT_TASKS_PATH) === null;
		const auditLogMissing =
			this.app.vault.getAbstractFileByPath(TRACEKEEPER_AUDIT_LOG_PATH) === null;
		const auditDirMissing =
			this.app.vault.getAbstractFileByPath(TRACEKEEPER_AUDIT_DIR) === null;
		const recentToolCallRecords = recentAuditEvents
			.filter((event) => this.isToolCallAuditEvent(event))
			.map((event) => this.toAgentToolCallRecord(event));
		const recentAgents = this.buildRecentAgentConnections(
			recentAuditEvents,
			recentToolCallRecords
		);
		const timelineItems = recentAuditEvents
			.filter((event) => !this.isConnectionAuditEvent(event))
			.map((event) => this.toActivityTimelineAuditItem(event))
			.slice(0, ACTIVITY_TIMELINE_PREVIEW_ROWS);
		const workflowDiagnostics = buildAgentWorkflowDiagnostics(recentAuditEvents);

		return {
			runtimeStatus: this.host.getRuntimeViewStatus(),
			structureStatus,
			vaultRoot: this.host.getVaultRoot(),
			latestTask,
			recentTasks,
			recentContextPacks,
			recentSourceCaptures,
			recentSourceRequests,
			recentProposals,
			reviewQueueItemCount,
			incompleteReviewQueueItemCount,
			pendingReviewQueueItemCount,
			readyToApplyReviewQueueItemCount,
			revisionRequestedReviewQueueItemCount,
			actionableReviewQueueItemCount,
			recentAuditEvents,
			workflowDiagnostics,
			timelineItems,
			recentAgents,
			recentAgentCount: recentAgents.length,
			recentToolCallCount: recentToolCallRecords.length,
			missingTaskFolder: taskFolderMissing,
			missingAuditSources: auditLogMissing && auditDirMissing,
			updatedAt: new Date().toISOString(),
		};
	}

async loadActivityTimelineSnapshot(
		page: number,
		pageSize = ACTIVITY_TIMELINE_PAGE_SIZE
	): Promise<ActivityTimelineSnapshot> {
		const safePageSize = Math.max(1, Math.floor(pageSize));
		const [
			tasks,
			contextPacks,
			sourceCaptures,
			sourceRequests,
			proposals,
			auditEvents,
		] = await Promise.all([
			this.host.readRecentAgentTasks(Number.MAX_SAFE_INTEGER),
			this.host.readRecentContextPacks(Number.MAX_SAFE_INTEGER),
			this.host.readRecentSourceCaptures(Number.MAX_SAFE_INTEGER),
			this.host.readRecentSourceRequests(Number.MAX_SAFE_INTEGER),
			this.host.readRecentMemoryProposals(Number.MAX_SAFE_INTEGER),
			this.readRecentAuditEvents(Number.MAX_SAFE_INTEGER),
		]);
		const timelineItems = this.buildActivityTimelineItems({
			tasks,
			contextPacks,
			sourceCaptures,
			sourceRequests,
			proposals,
			auditEvents,
		});
		const totalItems = timelineItems.length;
		const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
		const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
		const start = (safePage - 1) * safePageSize;

		return {
			items: timelineItems.slice(start, start + safePageSize),
			page: safePage,
			pageSize: safePageSize,
			totalItems,
			totalPages,
			updatedAt: new Date().toISOString(),
		};
	}

async loadRuntimeLogSnapshot(
		page: number,
		filter: RuntimeLogFilter = 'all',
		pageSize = RUNTIME_LOG_PAGE_SIZE
	): Promise<RuntimeLogSnapshot> {
		const safePageSize = Math.max(1, Math.floor(pageSize));
		const safeFilter = RUNTIME_LOG_FILTERS.includes(filter) ? filter : 'all';
		const recentEvents = await this.readRecentAuditEvents(RUNTIME_LOG_MAX_EVENTS + 1);
		const isTruncated = recentEvents.length > RUNTIME_LOG_MAX_EVENTS;
		const auditEvents = recentEvents.slice(0, RUNTIME_LOG_MAX_EVENTS);
		const allItems = auditEvents.map((event) => this.toRuntimeLogItem(event));
		const counts = this.countRuntimeLogItems(allItems);
		const visibleItems = allItems.filter((item) => this.matchesRuntimeLogFilter(item, safeFilter));
		const totalItems = visibleItems.length;
		const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
		const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
		const start = (safePage - 1) * safePageSize;

		return {
			items: visibleItems.slice(start, start + safePageSize),
			filter: safeFilter,
			counts,
			page: safePage,
			pageSize: safePageSize,
			totalItems,
			totalPages,
			isTruncated,
			updatedAt: new Date().toISOString(),
		};
	}

async previewRuntimeLogCleanup(
		scope: RuntimeLogCleanupScope
	): Promise<RuntimeLogCleanupPreview> {
		const issuedAt = new Date().toISOString();
		const cutoff = this.runtimeLogCleanupCutoff(
			scope,
			Date.parse(issuedAt)
		);
		const { eligibleFiles, retainedFiles } =
			await this.readRuntimeLogCleanupRows(cutoff);
		const previewPayload: Omit<RuntimeLogCleanupPreview, 'confirmationToken'> = {
			schemaVersion: 1,
			operationId: this.createRuntimeLogCleanupOperationId(),
			previewNonce: this.createRuntimeLogCleanupNonce(),
			issuedAt,
			expiresAt: new Date(
				Date.parse(issuedAt) + RUNTIME_LOG_CLEANUP_PREVIEW_TTL_MS
			).toISOString(),
			scope,
			cutoff,
			eligibleFiles,
			retainedFiles,
			eligibleEventCount: eligibleFiles.reduce(
				(total, file) => total + file.eventCount,
				0
			),
			retainedEventCount: retainedFiles.reduce(
				(total, file) => total + file.eventCount,
				0
			),
			trashBehavior: this.host.getConfiguredTrashDescription(),
		};
		return {
			...previewPayload,
			confirmationToken: this.runtimeLogCleanupConfirmationToken(
				previewPayload
			),
		};
	}

async commitRuntimeLogCleanup(
		preview: RuntimeLogCleanupPreview,
		confirmationToken: string
	): Promise<RuntimeLogCleanupResult> {
		return this.serializeRuntimeLogCleanup(
			preview.operationId,
			() => this.commitRuntimeLogCleanupInternal(
				preview,
				confirmationToken
			)
		);
	}

	private async commitRuntimeLogCleanupInternal(
		preview: RuntimeLogCleanupPreview,
		confirmationToken: string
	): Promise<RuntimeLogCleanupResult> {
		this.assertRuntimeLogCleanupPreview(preview, confirmationToken);
		const previewHash = this.runtimeLogCleanupPreviewHash(preview);
		const existingReceipt = await this.readRuntimeLogCleanupReceipt(
			preview.operationId
		);
		if (existingReceipt) {
			this.assertRuntimeLogCleanupReceipt(
				existingReceipt,
				preview,
				previewHash
			);
			if (existingReceipt.status !== 'in-progress') {
				await this.host.refreshGovernanceViews();
				return this.runtimeLogCleanupResultFromReceipt(existingReceipt);
			}
		} else if (Date.now() > Date.parse(preview.expiresAt)) {
			throw new Error('Runtime log cleanup preview has expired.');
		}
		if (
			this.host.getConfiguredTrashDescription()
			!== preview.trashBehavior
		) {
			throw new Error(
				'Runtime log cleanup deletion behavior changed after preview.'
			);
		}

		const receipt: RuntimeLogCleanupReceiptState = existingReceipt ?? {
			schemaVersion: 1,
			revision: 0,
			bindingHash: '',
			operationId: preview.operationId,
			previewHash,
			status: 'in-progress',
			scope: preview.scope,
			cutoff: preview.cutoff,
			attemptingPath: '',
			trashedPaths: [],
			failed: [],
			stale: [],
			retainedPaths: preview.retainedFiles.map((file) => file.path),
			completedAt: '',
		};
		if (receipt.attemptingPath) {
			await this.recoverRuntimeLogCleanupAttempt(
				receipt,
				preview,
				previewHash
			);
		}
		if (
			existingReceipt
			&& this.hasRuntimeLogCleanupProgress(receipt)
		) {
			await this.reconcileRuntimeLogCleanupPendingTargets(
				receipt,
				preview,
				previewHash
			);
		}
		await this.validateRuntimeLogCleanupState(preview, receipt);
		if (!existingReceipt) {
			await this.writeRuntimeLogCleanupReceipt(
				receipt,
				preview,
				previewHash
			);
		}

		for (const expected of preview.eligibleFiles) {
			if (this.isRuntimeLogCleanupPathResolved(receipt, expected.path)) {
				continue;
			}
			const file = this.app.vault.getAbstractFileByPath(expected.path);
			if (!(file instanceof TFile)) {
				this.addRuntimeLogCleanupStale(
					receipt,
					expected.path,
					file
						? 'changed-before-trash'
						: 'missing-before-trash'
				);
				await this.writeRuntimeLogCleanupReceipt(
					receipt,
					preview,
					previewHash
				);
				continue;
			}
			if (!(await this.isRuntimeLogCleanupTargetCurrent(file, expected))) {
				this.addRuntimeLogCleanupStale(
					receipt,
					expected.path,
					'changed-before-trash'
				);
				await this.writeRuntimeLogCleanupReceipt(
					receipt,
					preview,
					previewHash
				);
				continue;
			}

			receipt.attemptingPath = expected.path;
			await this.writeRuntimeLogCleanupReceipt(
				receipt,
				preview,
				previewHash
			);
			await withObsidianVaultPathLock(
				this.app.vault,
				expected.path,
				async () => {
					const current = this.app.vault.getAbstractFileByPath(
						expected.path
					);
					if (!(current instanceof TFile)) {
						receipt.attemptingPath = '';
						this.addRuntimeLogCleanupStale(
							receipt,
							expected.path,
							current
								? 'changed-before-trash'
								: 'missing-before-trash'
						);
						await this.writeRuntimeLogCleanupReceipt(
							receipt,
							preview,
							previewHash
						);
						return;
					}
					if (!(await this.isRuntimeLogCleanupTargetCurrent(
						current,
						expected
					))) {
						receipt.attemptingPath = '';
						this.addRuntimeLogCleanupStale(
							receipt,
							expected.path,
							'changed-before-trash'
						);
						await this.writeRuntimeLogCleanupReceipt(
							receipt,
							preview,
							previewHash
						);
						return;
					}

					let trashError: unknown = null;
					try {
						await this.app.fileManager.trashFile(current);
					} catch (error) {
						trashError = error;
					}
					const observed = this.app.vault.getAbstractFileByPath(
						expected.path
					);
					receipt.attemptingPath = '';
					if (!observed) {
						if (trashError) {
							this.addRuntimeLogCleanupStale(
								receipt,
								expected.path,
								'outcome-unknown-after-trash-intent'
							);
						} else {
							receipt.trashedPaths.push(expected.path);
							receipt.trashedPaths.sort();
						}
					} else if (trashError) {
						receipt.failed.push({
							path: expected.path,
							error: this.runtimeLogCleanupFailureMessage(trashError),
						});
						receipt.failed.sort((left, right) =>
							left.path.localeCompare(right.path)
						);
					} else {
						receipt.failed.push({
							path: expected.path,
							error: 'Configured deletion returned without removing the target.',
						});
					}
					await this.writeRuntimeLogCleanupReceipt(
						receipt,
						preview,
						previewHash
					);
				}
			);
		}

		receipt.status =
			receipt.failed.length > 0 || receipt.stale.length > 0
				? 'partial'
				: 'completed';
		receipt.completedAt = new Date().toISOString();
		await this.writeRuntimeLogCleanupReceipt(
			receipt,
			preview,
			previewHash
		);
		await this.host.refreshGovernanceViews();
		return this.runtimeLogCleanupResultFromReceipt(receipt);
	}

	private async recoverRuntimeLogCleanupAttempt(
		receipt: RuntimeLogCleanupReceiptState,
		preview: RuntimeLogCleanupPreview,
		previewHash: string
	): Promise<void> {
		const attemptedPath = receipt.attemptingPath;
		const expected = preview.eligibleFiles.find(
			(file) => file.path === attemptedPath
		);
		if (!expected) {
			throw new Error(
				'Runtime log cleanup receipt contains an invalid pending target.'
			);
		}
		receipt.attemptingPath = '';
		this.addRuntimeLogCleanupStale(
			receipt,
			attemptedPath,
			'outcome-unknown-after-trash-intent'
		);
		await this.writeRuntimeLogCleanupReceipt(
			receipt,
			preview,
			previewHash
		);
	}

	private isRuntimeLogCleanupPathResolved(
		receipt: RuntimeLogCleanupReceiptState,
		path: string
	): boolean {
		return receipt.trashedPaths.includes(path)
			|| receipt.failed.some((failure) => failure.path === path)
			|| receipt.stale.some((stale) => stale.path === path);
	}

	private hasRuntimeLogCleanupProgress(
		receipt: RuntimeLogCleanupReceiptState
	): boolean {
		return receipt.trashedPaths.length > 0
			|| receipt.failed.length > 0
			|| receipt.stale.length > 0;
	}

	private async reconcileRuntimeLogCleanupPendingTargets(
		receipt: RuntimeLogCleanupReceiptState,
		preview: RuntimeLogCleanupPreview,
		previewHash: string
	): Promise<void> {
		let changed = false;
		for (const expected of preview.eligibleFiles) {
			if (this.isRuntimeLogCleanupPathResolved(receipt, expected.path)) {
				continue;
			}
			const observed = this.app.vault.getAbstractFileByPath(expected.path);
			if (!(observed instanceof TFile)) {
				this.addRuntimeLogCleanupStale(
					receipt,
					expected.path,
					observed
						? 'changed-before-trash'
						: 'missing-before-trash'
				);
				changed = true;
				continue;
			}
			if (!(await this.isRuntimeLogCleanupTargetCurrent(
				observed,
				expected
			))) {
				this.addRuntimeLogCleanupStale(
					receipt,
					expected.path,
					'changed-before-trash'
				);
				changed = true;
			}
		}
		if (changed) {
			await this.writeRuntimeLogCleanupReceipt(
				receipt,
				preview,
				previewHash
			);
		}
	}

	private addRuntimeLogCleanupStale(
		receipt: RuntimeLogCleanupReceiptState,
		path: string,
		reason: RuntimeLogCleanupStale['reason']
	): void {
		receipt.stale = receipt.stale.filter((row) => row.path !== path);
		receipt.stale.push({ path, reason });
		receipt.stale.sort((left, right) => left.path.localeCompare(right.path));
	}

	private async serializeRuntimeLogCleanup<T>(
		key: string,
		action: () => Promise<T>
	): Promise<T> {
		const vaultKey = this.app.vault as object;
		let queues = runtimeLogCleanupQueues.get(vaultKey);
		if (!queues) {
			queues = new Map<string, Promise<void>>();
			runtimeLogCleanupQueues.set(vaultKey, queues);
		}
		const predecessor = queues.get(key) ?? Promise.resolve();
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = predecessor.catch(() => undefined).then(() => gate);
		queues.set(key, tail);
		await predecessor.catch(() => undefined);
		try {
			return await action();
		} finally {
			release();
			if (queues.get(key) === tail) {
				queues.delete(key);
				if (queues.size === 0) {
					runtimeLogCleanupQueues.delete(vaultKey);
				}
			}
		}
	}

private runtimeLogCleanupCutoff(
		scope: RuntimeLogCleanupScope,
		now = Date.now()
	): string | null {
		const dayMs = 24 * 60 * 60 * 1000;
		switch (scope) {
			case 'older-than-week':
				return new Date(now - 7 * dayMs).toISOString();
			case 'older-than-month':
				return new Date(now - 30 * dayMs).toISOString();
			case 'older-than-three-months':
				return new Date(now - 90 * dayMs).toISOString();
			case 'all':
				return null;
			default:
				throw new Error('Runtime log cleanup scope is invalid.');
		}
	}

private async readRuntimeLogCleanupRows(
		cutoff: string | null
	): Promise<{
		eligibleFiles: RuntimeLogCleanupFile[];
		retainedFiles: RuntimeLogCleanupFile[];
	}> {
		const files = await this.readRuntimeLogCleanupInputs();
		const corePreview = buildAuditCleanupPreview({
			cutoff,
			files: files.map((file) => ({
				path: file.path,
				contentHash: file.contentHash,
				version: file.version,
				eventTimes: file.eventTimes,
			})),
		});
		const eligibleFiles = corePreview.eligible.map((file) => ({
			path: file.path,
			sourceKind: file.sourceKind,
			contentHash: file.contentHash,
			version: file.version,
			earliestEventTime: file.earliestEventTime ?? '',
			latestEventTime: file.latestEventTime ?? '',
			eventCount: file.eventCount,
			reason: cutoff === null ? 'clear-all' as const : 'wholly-eligible' as const,
		}));
		const retainedFiles = corePreview.retained.map((file) => {
			if (!file.sourceKind || file.reason === 'non-audit') {
				throw new Error(`Runtime log cleanup found a non-audit path: ${file.path}.`);
			}
			return {
				path: file.path,
				sourceKind: file.sourceKind,
				contentHash: file.contentHash,
				version: file.version,
				earliestEventTime: file.earliestEventTime ?? '',
				latestEventTime: file.latestEventTime ?? '',
				eventCount: file.eventCount,
				reason: file.reason,
			};
		});
		return { eligibleFiles, retainedFiles };
	}

private async readRuntimeLogCleanupInputs(): Promise<Array<{
		path: string;
		contentHash: string;
		version: string;
		eventTimes: string[];
	}>> {
		const files = new Map<string, TFile>();
		const legacy = this.app.vault.getAbstractFileByPath(
			TRACEKEEPER_AUDIT_LOG_PATH
		);
		if (legacy instanceof TFile) {
			files.set(legacy.path, legacy);
		} else if (legacy) {
			throw new Error(
				`Runtime log cleanup audit path is not a file: ${TRACEKEEPER_AUDIT_LOG_PATH}.`
			);
		}
		const auditFolder = this.app.vault.getAbstractFileByPath(
			TRACEKEEPER_AUDIT_DIR
		);
		if (auditFolder instanceof TFolder) {
			for (const file of this.collectMarkdownFiles(auditFolder)) {
				if (this.isRuntimeLogCleanupPath(file.path)) {
					files.set(file.path, file);
				}
			}
		} else if (auditFolder) {
			throw new Error(
				`Runtime log cleanup audit directory is not a folder: ${TRACEKEEPER_AUDIT_DIR}.`
			);
		}

		const inputs: Array<{
			path: string;
			contentHash: string;
			version: string;
			eventTimes: string[];
		}> = [];
		for (const file of [...files.values()].sort((left, right) =>
			left.path.localeCompare(right.path)
		)) {
			const versionBeforeRead = this.runtimeLogCleanupFileVersion(file);
			const content = await this.app.vault.read(file);
			const versionAfterRead = this.runtimeLogCleanupFileVersion(file);
			if (versionBeforeRead !== versionAfterRead) {
				throw new Error(
					`Runtime log cleanup file changed during preview: ${file.path}.`
				);
			}
			inputs.push({
				path: file.path,
				contentHash: hashVaultContent(content),
				version: versionAfterRead,
				eventTimes: this.runtimeLogCleanupEventTimes(content),
			});
		}
		return inputs;
	}

	private async isRuntimeLogCleanupTargetCurrent(
		file: TFile,
		expected: RuntimeLogCleanupFile
	): Promise<boolean> {
		const versionBeforeRead = this.runtimeLogCleanupFileVersion(file);
		const content = await this.app.vault.read(file);
		const versionAfterRead = this.runtimeLogCleanupFileVersion(file);
		return !(
			file.path !== expected.path
			|| versionBeforeRead !== versionAfterRead
			|| versionAfterRead !== expected.version
			|| hashVaultContent(content) !== expected.contentHash
		);
	}

private runtimeLogCleanupEventTimes(content: string): string[] {
		const normalized = content.replace(/\r\n/g, '\n');
		const lines = normalized.split('\n');
		const eventTimes: string[] = [];
		let cursor = lines.findIndex((line) => line.trim().startsWith('## '));
		if (cursor < 0) {
			return eventTimes;
		}
		while (cursor < lines.length) {
			const header = lines[cursor].trim();
			cursor += 1;
			const bodyLines: string[] = [];
			while (
				cursor < lines.length
				&& !lines[cursor].trim().startsWith('## ')
			) {
				bodyLines.push(lines[cursor]);
				cursor += 1;
			}
			const row = this.host.readKeyValueRows(bodyLines);
			const timestamp = this.host.firstString(row, ['timestamp'])
				|| header.replace(/^##\s+/, '').trim().split(/\s+/)[0]
				|| '';
			const parsed = new Date(timestamp);
			eventTimes.push(
				timestamp && !Number.isNaN(parsed.getTime())
					? parsed.toISOString()
					: ''
			);
		}
		return eventTimes;
	}

private runtimeLogCleanupFileVersion(file: TFile): string {
		return `${file.stat?.mtime ?? 0}:${file.stat?.size ?? 0}`;
	}

	private isRuntimeLogCleanupPath(path: string): boolean {
		if (path === TRACEKEEPER_AUDIT_LOG_PATH) {
			return true;
		}
		const escapedDirectory = TRACEKEEPER_AUDIT_DIR.replace(
			/[.*+?^${}()|[\]\\]/g,
			'\\$&'
		);
		const match = path.match(
			new RegExp(
				`^${escapedDirectory}/(\\d{4})/(\\d{4}-\\d{2}-\\d{2})\\.md$`
			)
		);
		if (!match || match[1] !== match[2]?.slice(0, 4)) {
			return false;
		}
		const parsed = new Date(`${match[2]}T00:00:00.000Z`);
		return !Number.isNaN(parsed.getTime())
			&& parsed.toISOString().slice(0, 10) === match[2];
	}

private runtimeLogCleanupSourceKind(
		path: string
	): AuditEventSourceKind | null {
		if (!this.isRuntimeLogCleanupPath(path)) {
			return null;
		}
		return path === TRACEKEEPER_AUDIT_LOG_PATH ? 'legacy' : 'shard';
	}

	private async validateRuntimeLogCleanupState(
		preview: RuntimeLogCleanupPreview,
		receipt: RuntimeLogCleanupReceiptState
	): Promise<void> {
		if (receipt.attemptingPath) {
			throw new Error(
				'Runtime log cleanup pending target must be recovered before validation.'
			);
		}
		const currentRows = await this.readRuntimeLogCleanupRows(preview.cutoff);
		const currentFiles = [
			...currentRows.eligibleFiles,
			...currentRows.retainedFiles,
		];
		const expectedFiles = [
			...preview.eligibleFiles,
			...preview.retainedFiles,
		];
		const expectedByPath = new Map(
			expectedFiles.map((file) => [file.path, file])
		);
		const currentByPath = new Map(
			currentFiles.map((file) => [file.path, file])
		);
		const definitelyMissingPaths = new Set([
			...receipt.trashedPaths,
			...receipt.stale
				.filter((row) => row.reason === 'missing-before-trash')
				.map((row) => row.path),
		]);
		const outcomeUnknownPaths = new Set(
			receipt.stale
				.filter((row) =>
					row.reason === 'outcome-unknown-after-trash-intent'
				)
				.map((row) => row.path),
		);
		const toleratedExistingPaths = new Set([
			...receipt.failed.map((failure) => failure.path),
			...receipt.stale
				.filter((row) => row.reason === 'changed-before-trash')
				.map((row) => row.path),
		]);
		const observedPaths = new Set([
			...currentByPath.keys(),
			...definitelyMissingPaths,
			...outcomeUnknownPaths,
		]);
		if (
			observedPaths.size !== expectedByPath.size
			|| [...observedPaths].some((path) => !expectedByPath.has(path))
		) {
			throw new Error('Runtime log cleanup preview is stale: audit file set changed.');
		}
		for (const path of definitelyMissingPaths) {
			if (currentByPath.has(path)) {
				throw new Error(
					`Runtime log cleanup receipt conflicts with current file: ${path}.`
				);
			}
		}
		for (const path of toleratedExistingPaths) {
			if (!currentByPath.has(path)) {
				throw new Error(
					`Runtime log cleanup receipt lost an unresolved file: ${path}.`
				);
			}
		}
		for (const [path, expected] of expectedByPath) {
			if (
				definitelyMissingPaths.has(path)
				|| outcomeUnknownPaths.has(path)
				|| toleratedExistingPaths.has(path)
			) {
				continue;
			}
			const current = currentByPath.get(path);
			if (
				!current
				|| current.contentHash !== expected.contentHash
				|| current.version !== expected.version
				|| current.eventCount !== expected.eventCount
				|| current.earliestEventTime !== expected.earliestEventTime
				|| current.latestEventTime !== expected.latestEventTime
				|| current.reason !== expected.reason
				|| current.sourceKind !== expected.sourceKind
			) {
				throw new Error(
					`Runtime log cleanup preview is stale: ${path}.`
				);
			}
		}
		if (
			receipt.trashedPaths.length === 0
			&& receipt.failed.length === 0
			&& receipt.stale.length === 0
		) {
			const retained = preview.retainedFiles.map((file) => {
				if (
					file.reason !== 'mixed-age'
					&& file.reason !== 'too-new'
					&& file.reason !== 'empty-or-unparseable'
				) {
					throw new Error(
						`Runtime log cleanup retained reason is invalid: ${file.path}.`
					);
				}
				return {
					path: file.path,
					sourceKind: file.sourceKind,
					contentHash: file.contentHash,
					version: file.version,
					earliestEventTime: file.earliestEventTime || null,
					latestEventTime: file.latestEventTime || null,
					eventCount: file.eventCount,
					reason: file.reason,
				};
			});
			const corePreviewPayload = {
				schemaVersion: 1 as const,
				cutoff: preview.cutoff,
				eligiblePaths: preview.eligibleFiles.map((file) => file.path),
				eligible: preview.eligibleFiles.map((file) => ({
					path: file.path,
					sourceKind: file.sourceKind,
					contentHash: file.contentHash,
					version: file.version,
					earliestEventTime: file.earliestEventTime || null,
					latestEventTime: file.latestEventTime || null,
					eventCount: file.eventCount,
				})),
				retained,
			};
			const validation = validateAuditCleanupPreview({
				preview: {
					...corePreviewPayload,
					bindingHash: computePayloadHash(corePreviewPayload),
				},
				cutoff: preview.cutoff,
				currentFiles: currentFiles.map((file) => ({
					path: file.path,
					contentHash: file.contentHash,
					version: file.version,
				})),
			});
			if (validation.status !== 'ready') {
				throw new Error(
					`Runtime log cleanup preview is ${validation.status}: ${validation.reason}.`
				);
			}
		}
	}

private assertRuntimeLogCleanupPreview(
		preview: RuntimeLogCleanupPreview,
		confirmationToken: string
	): void {
		if (
			preview.schemaVersion !== 1
			|| !/^cleanup-[A-Za-z0-9_-]{1,160}$/.test(preview.operationId)
			|| !preview.previewNonce
			|| !Number.isFinite(Date.parse(preview.issuedAt))
			|| !Number.isFinite(Date.parse(preview.expiresAt))
			|| Date.parse(preview.expiresAt) - Date.parse(preview.issuedAt)
				!== RUNTIME_LOG_CLEANUP_PREVIEW_TTL_MS
			|| !RUNTIME_LOG_CLEANUP_OPTIONS.includes(preview.scope)
			|| !Array.isArray(preview.eligibleFiles)
			|| !Array.isArray(preview.retainedFiles)
			|| !preview.trashBehavior
		) {
			throw new Error('Runtime log cleanup preview is invalid.');
		}
		const expectedCutoff = this.runtimeLogCleanupCutoff(
			preview.scope,
			Date.parse(preview.issuedAt)
		);
		if (preview.cutoff !== expectedCutoff) {
			throw new Error('Runtime log cleanup preview cutoff is stale.');
		}
		const paths = [
			...preview.eligibleFiles.map((file) => file.path),
			...preview.retainedFiles.map((file) => file.path),
		];
		if (
			new Set(paths).size !== paths.length
			|| paths.some((path) => !this.isRuntimeLogCleanupPath(path))
			|| preview.eligibleFiles.some((file) =>
				file.sourceKind !== this.runtimeLogCleanupSourceKind(file.path)
				|| file.reason !== (preview.scope === 'all'
					? 'clear-all'
					: 'wholly-eligible')
				|| !file.contentHash
				|| !file.version
				|| !Number.isSafeInteger(file.eventCount)
				|| file.eventCount < 0
			)
			|| preview.retainedFiles.some((file) =>
				file.sourceKind !== this.runtimeLogCleanupSourceKind(file.path)
				|| !['mixed-age', 'too-new', 'empty-or-unparseable'].includes(
					file.reason
				)
				|| !file.contentHash
				|| !file.version
				|| !Number.isSafeInteger(file.eventCount)
				|| file.eventCount < 0
			)
			|| preview.eligibleEventCount !== preview.eligibleFiles.reduce(
				(total, file) => total + file.eventCount,
				0
			)
			|| preview.retainedEventCount !== preview.retainedFiles.reduce(
				(total, file) => total + file.eventCount,
				0
			)
		) {
			throw new Error('Runtime log cleanup preview contains an invalid target.');
		}
		const expectedToken = this.runtimeLogCleanupConfirmationToken(preview);
		if (
			!confirmationToken
			|| confirmationToken !== preview.confirmationToken
			|| confirmationToken !== expectedToken
		) {
			throw new Error('Runtime log cleanup confirmation is invalid.');
		}
	}

	private runtimeLogCleanupConfirmationToken(
		preview: Omit<RuntimeLogCleanupPreview, 'confirmationToken'>
			| RuntimeLogCleanupPreview
	): string {
		const {
			confirmationToken: _confirmationToken,
			...payload
		} = preview as RuntimeLogCleanupPreview;
		return `cleanup-confirm-${computePayloadHash(payload)}`;
	}

private runtimeLogCleanupPreviewHash(
		preview: RuntimeLogCleanupPreview
	): string {
		const {
			confirmationToken: _confirmationToken,
			...payload
		} = preview;
		return computePayloadHash(payload);
	}

private createRuntimeLogCleanupOperationId(): string {
		return `cleanup-${this.createRuntimeLogCleanupNonce()}`;
	}

private createRuntimeLogCleanupNonce(): string {
		if (typeof globalThis.crypto?.randomUUID === 'function') {
			return globalThis.crypto.randomUUID();
		}
		return `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
	}

private runtimeLogCleanupReceiptPath(operationId: string): string {
		if (!/^cleanup-[A-Za-z0-9_-]{1,160}$/.test(operationId)) {
			throw new Error('Runtime log cleanup operation id is invalid.');
		}
		return `${TRACEKEEPER_OPERATIONS_DIR}/${operationId}.json`;
	}

	private async readRuntimeLogCleanupReceipt(
		operationId: string
	): Promise<RuntimeLogCleanupReceiptState | null> {
		const path = this.runtimeLogCleanupReceiptPath(operationId);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file) {
			return null;
		}
		if (!(file instanceof TFile)) {
			throw new Error(`Runtime log cleanup receipt is not a file: ${path}.`);
		}
		try {
			const content = await this.app.vault.read(file);
			if (content.length > RUNTIME_LOG_CLEANUP_RECEIPT_MAX_LENGTH) {
				throw new Error('receipt exceeds bounded size');
			}
			const parsed = JSON.parse(content) as unknown;
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('receipt root is invalid');
			}
			return parsed as RuntimeLogCleanupReceiptState;
		} catch {
			throw new Error(`Runtime log cleanup receipt is invalid: ${path}.`);
		}
	}

	private async writeRuntimeLogCleanupReceipt(
		receipt: RuntimeLogCleanupReceiptState,
		preview: RuntimeLogCleanupPreview,
		previewHash: string
	): Promise<void> {
		const path = this.runtimeLogCleanupReceiptPath(receipt.operationId);
		if (
			!Number.isSafeInteger(receipt.revision)
			|| receipt.revision < 0
			|| receipt.revision >= Number.MAX_SAFE_INTEGER
		) {
			throw new Error('Runtime log cleanup receipt revision is invalid.');
		}
		const nextReceipt: RuntimeLogCleanupReceiptState = {
			...receipt,
			revision: receipt.revision + 1,
			bindingHash: '',
			trashedPaths: [...receipt.trashedPaths],
			failed: receipt.failed.map((failure) => ({ ...failure })),
			stale: receipt.stale.map((row) => ({ ...row })),
			retainedPaths: [...receipt.retainedPaths],
		};
		nextReceipt.bindingHash =
			this.runtimeLogCleanupReceiptBindingHash(nextReceipt);
		const content = `${JSON.stringify(nextReceipt, null, 2)}\n`;
		if (content.length > RUNTIME_LOG_CLEANUP_RECEIPT_MAX_LENGTH) {
			throw new Error('Runtime log cleanup receipt exceeds the bounded size.');
		}
		await this.host.ensureFolderExists(TRACEKEEPER_OPERATIONS_DIR);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (receipt.revision === 0) {
			if (existing) {
				throw new Error(
					'Runtime log cleanup receipt creation lost a concurrent race.'
				);
			}
			await this.app.vault.create(path, content);
			Object.assign(receipt, nextReceipt);
			return;
		}
		if (!(existing instanceof TFile)) {
			throw new Error(`Runtime log cleanup receipt is not a file: ${path}.`);
		}
		await this.app.vault.process(existing, (currentContent) => {
			let current: RuntimeLogCleanupReceiptState;
			try {
				const parsed = JSON.parse(currentContent) as unknown;
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
					throw new Error('receipt root is invalid');
				}
				current = parsed as RuntimeLogCleanupReceiptState;
			} catch {
				throw new Error(
					'Runtime log cleanup receipt changed outside the operation.'
				);
			}
			this.assertRuntimeLogCleanupReceipt(
				current,
				preview,
				previewHash
			);
			if (
				current.revision !== receipt.revision
				|| current.bindingHash !== receipt.bindingHash
			) {
				throw new Error(
					'Runtime log cleanup receipt changed concurrently.'
				);
			}
			return content;
		});
		Object.assign(receipt, nextReceipt);
	}

	private assertRuntimeLogCleanupReceipt(
		receipt: RuntimeLogCleanupReceiptState,
		preview: RuntimeLogCleanupPreview,
		previewHash: string
	): void {
		if (
			receipt.schemaVersion !== 1
			|| !Number.isSafeInteger(receipt.revision)
			|| receipt.revision < 1
			|| !/^[a-f0-9]{64}$/.test(receipt.bindingHash)
			|| receipt.bindingHash
				!== this.runtimeLogCleanupReceiptBindingHash(receipt)
			|| receipt.operationId !== preview.operationId
			|| receipt.previewHash !== previewHash
			|| receipt.scope !== preview.scope
			|| receipt.cutoff !== preview.cutoff
			|| !['in-progress', 'completed', 'partial'].includes(receipt.status)
			|| typeof receipt.attemptingPath !== 'string'
			|| typeof receipt.completedAt !== 'string'
			|| !Array.isArray(receipt.trashedPaths)
			|| !Array.isArray(receipt.failed)
			|| receipt.failed.some((failure) =>
				!failure || typeof failure !== 'object'
			)
			|| !Array.isArray(receipt.stale)
			|| receipt.stale.some((row) => !row || typeof row !== 'object')
			|| !Array.isArray(receipt.retainedPaths)
		) {
			throw new Error('Runtime log cleanup receipt conflicts with the preview.');
		}
		const eligiblePaths = preview.eligibleFiles.map((file) => file.path);
		const eligibleSet = new Set(eligiblePaths);
		const retainedPaths = preview.retainedFiles.map((file) => file.path);
		const failedPaths = receipt.failed.map((failure) => failure.path);
		const stalePaths = receipt.stale.map((row) => row.path);
		const resolvedPaths = [
			...receipt.trashedPaths,
			...failedPaths,
			...stalePaths,
		];
		if (
			JSON.stringify(receipt.retainedPaths) !== JSON.stringify(retainedPaths)
			|| receipt.trashedPaths.some((path) => typeof path !== 'string')
			|| receipt.retainedPaths.some((path) => typeof path !== 'string')
			|| new Set(resolvedPaths).size !== resolvedPaths.length
			|| resolvedPaths.some((path) => !eligibleSet.has(path))
			|| receipt.failed.some((failure) =>
				!failure
				|| typeof failure.path !== 'string'
				|| typeof failure.error !== 'string'
				|| !failure.error
				|| failure.error.length > 240
			)
			|| receipt.stale.some((row) =>
				!row
				|| typeof row.path !== 'string'
				|| ![
					'changed-before-trash',
					'missing-before-trash',
					'outcome-unknown-after-trash-intent',
				].includes(row.reason)
			)
			|| (
				receipt.attemptingPath
				&& (
					!eligibleSet.has(receipt.attemptingPath)
					|| resolvedPaths.includes(receipt.attemptingPath)
				)
			)
		) {
			throw new Error('Runtime log cleanup receipt conflicts with the preview.');
		}
		if (
			receipt.status === 'in-progress'
			&& receipt.completedAt
		) {
			throw new Error('Runtime log cleanup receipt has invalid progress state.');
		}
		if (receipt.status !== 'in-progress') {
			if (
				receipt.attemptingPath
				|| !Number.isFinite(Date.parse(receipt.completedAt))
				|| new Set(resolvedPaths).size !== eligibleSet.size
				|| eligiblePaths.some((path) => !resolvedPaths.includes(path))
				|| (
					receipt.status === 'completed'
					&& (receipt.failed.length > 0 || receipt.stale.length > 0)
				)
				|| (
					receipt.status === 'partial'
					&& receipt.failed.length === 0
					&& receipt.stale.length === 0
				)
			) {
				throw new Error('Runtime log cleanup receipt has invalid completion state.');
			}
		}
	}

	private runtimeLogCleanupReceiptBindingHash(
		receipt: RuntimeLogCleanupReceiptState
	): string {
		const {
			bindingHash: _bindingHash,
			...payload
		} = receipt;
		return computePayloadHash(payload);
	}

private runtimeLogCleanupResultFromReceipt(
		receipt: RuntimeLogCleanupReceiptState
	): RuntimeLogCleanupResult {
		if (receipt.status === 'in-progress' || !receipt.completedAt) {
			throw new Error('Runtime log cleanup receipt is incomplete.');
		}
		return {
			schemaVersion: 1,
			operationId: receipt.operationId,
			status: receipt.status,
			scope: receipt.scope,
			cutoff: receipt.cutoff,
			trashedPaths: [...receipt.trashedPaths],
			failed: receipt.failed.map((failure) => ({ ...failure })),
			stale: receipt.stale.map((row) => ({ ...row })),
			retainedPaths: [...receipt.retainedPaths],
			completedAt: receipt.completedAt,
		};
	}

private runtimeLogCleanupFailureMessage(error: unknown): string {
		const message = error instanceof Error ? error.message : String(error);
		return message
			.replace(/(?:^|\s)\/(?:Users|home|private|tmp|var)\/\S+/g, ' [redacted]')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 240)
			|| 'Configured trash operation failed.';
	}

private countRuntimeLogItems(items: RuntimeLogItem[]): Record<RuntimeLogFilter, number> {
		const counts: Record<RuntimeLogFilter, number> = {
			all: 0,
			connection: 0,
			tool: 0,
			config: 0,
			error: 0,
		};
		for (const item of items) {
			counts.all += 1;
			if (item.category === 'connection' || item.category === 'tool' || item.category === 'config') {
				counts[item.category] += 1;
			}
			if (this.isRuntimeLogError(item)) {
				counts.error += 1;
			}
		}
		return counts;
	}

private matchesRuntimeLogFilter(item: RuntimeLogItem, filter: RuntimeLogFilter): boolean {
		if (filter === 'all') {
			return true;
		}
		if (filter === 'error') {
			return this.isRuntimeLogError(item);
		}
		return item.category === filter;
	}

private isRuntimeLogError(item: RuntimeLogItem): boolean {
		const normalized = item.status.toLowerCase().trim();
		return normalized === 'failed' || normalized === 'error' || normalized.includes('failed');
	}

private toRuntimeLogItem(event: AuditEventRecord): RuntimeLogItem {
		const category = this.runtimeLogCategory(event);
		const status = event.resultStatus || (category === 'connection' ? 'connected' : '');
		const metaParts = [
			this.host.formatAgentDisplayName(event.clientName, event.agentId),
			status ? this.host.formatResultLabel(status) : '',
			event.riskLevel ? this.host.formatRiskLabel(event.riskLevel) : '',
		].filter(Boolean);
		const body = event.reason
			|| event.diagnosticReason
			|| event.argsSummary
			|| event.targetPaths.join(', ')
			|| event.target
			|| event.snippet;

		return {
			time: event.sortTimestamp,
			category,
			title: this.runtimeLogTitle(event, category),
			meta: metaParts.join(' • '),
			body,
			path: event.target || event.path,
			status,
		};
	}

private runtimeLogCategory(event: AuditEventRecord): RuntimeLogCategory {
		if (this.isConnectionAuditEvent(event)) {
			return 'connection';
		}
		if (event.action.startsWith('client_config_')) {
			return 'config';
		}
		if (this.isToolCallAuditEvent(event)) {
			return 'tool';
		}
		return 'record';
	}

private runtimeLogTitle(event: AuditEventRecord, category: RuntimeLogCategory): string {
		if (category === 'connection') {
			return ui('建立连接', 'Connected');
		}
		if (category === 'tool') {
			return this.host.formatToolDisplayName(event.toolName || event.action);
		}
		if (category === 'config') {
			switch (event.action) {
				case 'client_config_applied':
					return ui('写入连接配置', 'Connection config written');
				case 'client_config_removed':
					return ui('移除连接配置', 'Connection config removed');
				case 'client_config_failed':
					return ui('连接配置失败', 'Connection config failed');
				default:
					return ui('连接配置变更', 'Connection config change');
			}
		}
		if (event.action === 'structure.repair') {
			return ui('补齐基础结构', 'Repair base structure');
		}
		if (event.action === 'legacy_structure.migrate') {
			return ui('原生迁移旧目录', 'Move legacy structure');
		}
		if (event.action === 'legacy_structure.cleanup') {
			return ui('清理旧目录', 'Clean legacy folders');
		}
		return event.action || ui('运行记录', 'Runtime record');
	}

private buildActivityTimelineItems(input: {
		tasks: AgentTaskRecord[];
		contextPacks: ContextPackRecord[];
		sourceCaptures: SourceCaptureRecord[];
		sourceRequests: SourceRequestRecord[];
		proposals: MemoryProposalRecord[];
		auditEvents: AuditEventRecord[];
	}): ActivityTimelineItem[] {
		return [
			...input.tasks.map((task) => ({
				time: task.sortTimestamp,
				type: ui('任务', 'Task'),
				title: task.taskId,
				meta: `${task.agent} • ${task.status}`,
				body: task.objective || task.snippet,
				path: task.path,
			})),
			...input.contextPacks.map((contextPack) => ({
				time: contextPack.sortTimestamp,
				type: 'context',
				title: contextPack.title,
				meta: contextPack.taskId,
				body: contextPack.snippet,
				path: contextPack.path,
			})),
			...input.sourceCaptures.map((source) => ({
				time: source.sortTimestamp,
				type: ui('来源', 'Source'),
				title: source.title || source.source || ui('来源记录', 'Source capture'),
				meta: [source.sourceKind, source.mode || source.type].filter(Boolean).join(' • '),
				body: source.source || source.snippet,
				path: source.path,
			})),
			...input.sourceRequests.map((request) => ({
				time: request.sortTimestamp,
				type: ui('来源请求', 'Source request'),
				title: request.sourceKind,
				meta: request.status,
				body: request.source || request.summary,
				path: request.path,
			})),
			...input.proposals.map((proposal) => ({
				time: proposal.sortTimestamp,
				type: ui('提案', 'Proposal'),
				title: proposal.proposalId,
				meta: `${memoryProposalStatusLabel(proposal.approvalStatus)} • ${proposal.proposalKind}`,
				body: proposal.snippet,
				path: proposal.path,
			})),
			...input.auditEvents.map((event) => this.toActivityTimelineAuditItem(event)),
		].sort((a, b) => b.time - a.time);
	}

private toActivityTimelineAuditItem(event: AuditEventRecord): ActivityTimelineItem {
		const isConnection = this.isConnectionAuditEvent(event);
		const isStructureEvent = event.action === 'structure.repair' || event.action === 'legacy_structure.migrate' || event.action === 'legacy_structure.cleanup';
		const agentLabel = this.host.formatAgentDisplayName(event.clientName, event.agentId);
		return {
			time: event.sortTimestamp,
			type: event.toolName
				? agentLabel
				: isConnection
					? agentLabel
					: isStructureEvent
						? ui('结构', 'Structure')
						: ui('记录', 'Record'),
			title: event.toolName
				? this.host.formatToolDisplayName(event.toolName)
				: isConnection
					? ui('建立连接', 'Connected')
					: this.runtimeLogTitle(event, 'record'),
			meta: event.resultStatus ? this.host.formatResultLabel(event.resultStatus) : event.actor,
			body: event.reason || event.diagnosticReason || event.snippet,
			path: event.target || event.path,
		};
	}

isToolCallAuditEvent(event: AuditEventRecord): boolean {
		return event.eventType === 'tool-call'
			|| event.eventType === 'agent-tool-call'
			|| (Boolean(event.toolName) && !this.isConnectionAuditEvent(event));
	}

isConnectionAuditEvent(event: AuditEventRecord): boolean {
		return event.eventType === 'connection' || event.eventType === 'agent-connection-event' || event.action === 'connection' || event.action === 'mcp.initialize';
	}

private normalizeAuditToolName(eventType: string, action: string, toolName: string): string {
		const normalizedTool = toolName.trim();
		const isConnection =
			eventType === 'connection' ||
			eventType === 'agent-connection-event' ||
			action === 'connection' ||
			action === 'mcp.initialize';
		if (isConnection && normalizedTool.toLowerCase() === 'unknown') {
			return '';
		}
		return normalizedTool;
	}

	toAgentToolCallRecord(event: AuditEventRecord): AgentToolCallRecord {
		return {
			principalId: event.principalId,
			taskId: event.taskId,
			agentId: event.agentId || 'unknown',
			sessionId: event.sessionId,
			clientName: event.clientName || 'unknown',
			observedClientNameRaw: event.observedClientNameRaw || event.clientName,
			observedClientType: event.observedClientType,
			observedClientVersion: event.observedClientVersion,
			toolName: event.toolName || event.action || 'unknown',
			resultStatus: event.resultStatus || 'unknown',
			targetPaths: event.targetPaths,
			timestamp: event.timestamp,
			lastUsedAt: event.lastUsedAt,
			lastSuccessfulTool: event.lastSuccessfulTool,
			transport: event.transport,
			durationMs: event.durationMs,
			riskLevel: event.riskLevel || 'unknown',
			argsSummary: event.argsSummary,
			resultSummary: event.resultSummary,
			scopeMode: event.scopeMode,
			matchedCount: event.matchedCount,
			sortTimestamp: event.sortTimestamp,
		};
	}

buildRecentAgentConnections(
		auditEvents: AuditEventRecord[],
		toolCalls: AgentToolCallRecord[]
	): AgentConnectionRecord[] {
		return buildRecentObservedClientConnections(auditEvents, toolCalls);
	}

async readRecentAuditEvents(limit: number): Promise<AuditEventRecord[]> {
		const safeLimit = Math.max(0, Math.floor(limit));
		if (safeLimit === 0) {
			return [];
		}
		const [auditLogRecords, folderRecords] = await Promise.all([
			this.readAuditLogFile(safeLimit),
			this.readAuditFolderEvents(safeLimit),
		]);
		const merged = mergeAuditEvents(
			[...auditLogRecords, ...folderRecords].map(({ path, auditId, ...event }) => ({
				...event,
				auditEventId: auditId,
				sourcePath: path,
				sourceKind: this.auditSourceKind(path),
			}))
		).map(({ sourcePath, auditEventId, sourceKind: _sourceKind, ...event }) => ({
			...event,
			path: sourcePath,
			auditId: auditEventId || '',
		}));
		return merged
			.slice(0, safeLimit);
	}

private async readAuditLogFile(limit: number): Promise<AuditEventRecord[]> {
		const file = this.app.vault.getAbstractFileByPath(TRACEKEEPER_AUDIT_LOG_PATH);
		if (!(file instanceof TFile)) {
			return [];
		}

		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error('tracekeeper failed to read audit log', error);
			return [];
		}

		return this.parseAuditLogSections(content, file.path, limit);
	}

private async readAuditFolderEvents(limit: number): Promise<AuditEventRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(TRACEKEEPER_AUDIT_DIR);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectMarkdownFiles(folder)
			.sort((left, right) => right.path.localeCompare(left.path));
		const events: AuditEventRecord[] = [];
		for (const file of files) {
			const remaining = limit - events.length;
			if (remaining <= 0) {
				break;
			}
			const fileEvents = await this.readAuditMarkdownFile(file, remaining);
			events.push(...fileEvents);
		}
		return events;
	}

private async readAuditMarkdownFile(file: TFile, limit: number): Promise<AuditEventRecord[]> {
		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`tracekeeper failed to read audit file: ${file.path}`, error);
			return [];
		}

		const parsed = this.host.readFrontmatter(content);
		const data = parsed.fields;
		const recordType = this.host.firstString(data, ['type'])
			.toLowerCase()
			.replace(/_/g, '-');
		if (recordType === 'tracekeeper-audit-hub') {
			return [];
		}
		if (
			recordType === 'tracekeeper-audit-shard'
		) {
			return this.parseAuditLogSections(parsed.body, file.path, limit);
		}
		const timestamp = this.host.firstString(data, ['timestamp']) || this.host.timestampFromFilename(file.basename);
		const fallbackTs =
			this.host.parseTimestamp(timestamp, file.stat?.mtime || Date.now()) || file.stat?.mtime || Date.now();

		if (Object.keys(data).length > 0) {
			const eventType = this.host.firstString(data, ['type']);
			const action = this.host.firstString(data, ['action']) || 'unknown';
			const toolName = this.normalizeAuditToolName(
				eventType,
				action,
				this.host.firstString(data, ['tool_name', 'toolName', 'tool'])
			);
			return [
				{
					path: file.path,
					auditId: this.host.firstString(data, [
						'audit_event_id',
						'auditEventId',
						'audit_id',
						'auditId',
						'id',
					]),
					actor: this.host.firstString(data, ['actor']) || 'unknown',
					action,
					target: this.host.firstString(data, ['target']) || '',
					reason: this.host.firstString(data, ['reason']) || '',
					taskId: this.host.firstString(data, ['task_id', 'taskId']),
					timestamp: timestamp || '',
					sortTimestamp: fallbackTs,
					snippet: this.host.snippetFromText(parsed.body, this.host.trimText(file.basename)),
					eventType,
					principalId: this.host.firstString(data, ['principal_id', 'principalId']),
					agentId: this.host.firstString(data, ['agent_id', 'agentId', 'session_id', 'sessionId']),
					sessionId: this.host.firstString(data, ['session_id', 'sessionId']),
					clientName: this.host.firstString(data, ['client_name', 'clientName', 'client']),
					auditSchemaVersion: this.host.firstString(data, ['audit_schema_version', 'auditSchemaVersion']),
					observedClientNameRaw: this.host.firstString(data, ['observed_client_name_raw', 'observedClientNameRaw']),
					observedClientType: this.host.firstString(data, ['observed_client_type', 'observedClientType']),
					observedClientVersion: this.host.firstString(data, ['observed_client_version', 'observedClientVersion']),
					connectedAt: this.host.firstString(data, ['connected_at', 'connectedAt']),
					lastUsedAt: this.host.firstString(data, ['last_used_at', 'lastUsedAt']),
					lastSuccessfulTool: this.host.firstString(data, ['last_successful_tool', 'lastSuccessfulTool']),
					diagnosticReason: this.host.firstString(data, ['diagnostic_reason', 'diagnosticReason']),
					toolName,
					resultStatus: this.host.firstString(data, ['result_status', 'resultStatus', 'result', 'status']),
					targetPaths: this.host.readStringList(data, ['target_paths', 'targetPaths', 'target_path', 'targetPath', 'target']),
					durationMs: this.host.firstString(data, ['duration_ms', 'durationMs']),
					riskLevel: this.host.firstString(data, ['risk_level', 'riskLevel']),
					argsSummary: this.host.firstString(data, ['args_summary', 'argsSummary']),
					resultSummary: this.host.firstString(data, ['result_summary', 'resultSummary']),
					workflowContractVersion: this.host.firstString(data, ['workflow_contract_version', 'workflowContractVersion']),
					resultSchemaVersion: this.host.firstString(data, ['result_schema_version', 'resultSchemaVersion']),
					workflowMode: this.host.firstString(data, ['workflow_mode', 'workflowMode']),
					workflowId: this.host.firstString(data, ['workflow_id', 'workflowId']),
					recallId: this.host.firstString(data, ['recall_id', 'recallId']),
					actionId: this.host.firstString(data, ['action_id', 'actionId']),
					actionReasonCode: this.host.firstString(data, ['action_reason_code', 'actionReasonCode']),
					snapshotGeneration: this.host.firstString(data, ['snapshot_generation', 'snapshotGeneration']),
					scopeMode: this.host.firstString(data, ['scope_mode', 'scopeMode']),
					scopeConfidence: this.host.firstString(data, ['scope_confidence', 'scopeConfidence']),
					matchedCount: this.host.firstString(data, ['matched_count', 'matchedCount']),
					memoryCloseoutStatus: this.host.firstString(data, ['memory_closeout_status', 'memoryCloseoutStatus']),
					transport: this.host.firstString(data, ['transport']),
					runtimeVersion: this.host.firstString(data, ['runtime_version', 'runtimeVersion']),
				},
			];
		}

		const sectionRecords = this.parseAuditLogSections(content, file.path, limit);
		return sectionRecords.length > 0 ? sectionRecords : [];
	}

private parseAuditLogSections(
		content: string,
		sourcePath: string,
		limit = Number.MAX_SAFE_INTEGER
	): AuditEventRecord[] {
		const safeLimit = Math.max(0, Math.floor(limit));
		if (safeLimit === 0) {
			return [];
		}
		const lines = content.replace(/\r\n/g, '\n').split('\n');
		const events: AuditEventRecord[] = [];
		let cursor = 0;

		while (cursor < lines.length) {
			const header = lines[cursor].trim();
			if (!header.startsWith('## ')) {
				cursor += 1;
				continue;
			}

			const timestampHeader = header.replace(/^##\s+/, '').trim();
			cursor += 1;
			const bodyLines: string[] = [];
			while (
				cursor < lines.length &&
				!lines[cursor].trim().startsWith('## ')
			) {
				bodyLines.push(lines[cursor]);
				cursor += 1;
			}

			const row = this.host.readKeyValueRows(bodyLines);
			const fallbackTimestamp =
				this.host.firstString(row, ['timestamp']) || timestampHeader;
			const eventType = this.host.firstString(row, ['type']);
			const action = this.host.firstString(row, ['action']) || 'unknown';
			const toolName = this.normalizeAuditToolName(
				eventType,
				action,
				this.host.firstString(row, ['tool_name', 'toolName', 'tool'])
			);
			events.push({
				path: sourcePath,
				auditId: this.host.firstString(row, [
					'audit_event_id',
					'auditEventId',
					'audit_id',
					'auditId',
					'id',
				]),
				actor: this.host.firstString(row, ['actor']) || 'unknown',
				action,
				target: this.host.firstString(row, ['target']) || '',
				reason: this.host.firstString(row, ['reason']) || '',
				taskId: this.host.firstString(row, ['task_id', 'taskId']),
				timestamp: fallbackTimestamp,
				sortTimestamp: this.host.parseTimestamp(
					fallbackTimestamp,
					Date.now()
				),
				snippet: this.host.snippetFromText(bodyLines.join('\n')),
				eventType,
				principalId: this.host.firstString(row, ['principal_id', 'principalId']),
				agentId: this.host.firstString(row, ['agent_id', 'agentId', 'session_id', 'sessionId']),
				sessionId: this.host.firstString(row, ['session_id', 'sessionId']),
				clientName: this.host.firstString(row, ['client_name', 'clientName', 'client']),
				auditSchemaVersion: this.host.firstString(row, ['audit_schema_version', 'auditSchemaVersion']),
				observedClientNameRaw: this.host.firstString(row, ['observed_client_name_raw', 'observedClientNameRaw']),
				observedClientType: this.host.firstString(row, ['observed_client_type', 'observedClientType']),
				observedClientVersion: this.host.firstString(row, ['observed_client_version', 'observedClientVersion']),
				connectedAt: this.host.firstString(row, ['connected_at', 'connectedAt']),
				lastUsedAt: this.host.firstString(row, ['last_used_at', 'lastUsedAt']),
				lastSuccessfulTool: this.host.firstString(row, ['last_successful_tool', 'lastSuccessfulTool']),
				diagnosticReason: this.host.firstString(row, ['diagnostic_reason', 'diagnosticReason']),
				toolName,
				resultStatus: this.host.firstString(row, ['result_status', 'resultStatus', 'result', 'status']),
				targetPaths: this.host.readStringList(row, ['target_paths', 'targetPaths', 'target_path', 'targetPath', 'target']),
				durationMs: this.host.firstString(row, ['duration_ms', 'durationMs']),
				riskLevel: this.host.firstString(row, ['risk_level', 'riskLevel']),
				argsSummary: this.host.firstString(row, ['args_summary', 'argsSummary']),
				resultSummary: this.host.firstString(row, ['result_summary', 'resultSummary']),
				workflowContractVersion: this.host.firstString(row, ['workflow_contract_version', 'workflowContractVersion']),
				resultSchemaVersion: this.host.firstString(row, ['result_schema_version', 'resultSchemaVersion']),
				workflowMode: this.host.firstString(row, ['workflow_mode', 'workflowMode']),
				workflowId: this.host.firstString(row, ['workflow_id', 'workflowId']),
				recallId: this.host.firstString(row, ['recall_id', 'recallId']),
				actionId: this.host.firstString(row, ['action_id', 'actionId']),
				actionReasonCode: this.host.firstString(row, ['action_reason_code', 'actionReasonCode']),
				snapshotGeneration: this.host.firstString(row, ['snapshot_generation', 'snapshotGeneration']),
				scopeMode: this.host.firstString(row, ['scope_mode', 'scopeMode']),
				scopeConfidence: this.host.firstString(row, ['scope_confidence', 'scopeConfidence']),
				matchedCount: this.host.firstString(row, ['matched_count', 'matchedCount']),
				memoryCloseoutStatus: this.host.firstString(row, ['memory_closeout_status', 'memoryCloseoutStatus']),
				transport: this.host.firstString(row, ['transport']),
				runtimeVersion: this.host.firstString(row, ['runtime_version', 'runtimeVersion']),
			});
			if (events.length > safeLimit) {
				events.shift();
			}
		}

		return events;
	}

	private auditSourceKind(path: string): AuditEventSourceKind {
		return path === TRACEKEEPER_AUDIT_LOG_PATH ? 'legacy' : 'shard';
	}

private collectMarkdownFiles(folder: TFolder): TFile[] {
		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === 'md') {
				files.push(child);
			} else if (child instanceof TFolder) {
				files.push(...this.collectMarkdownFiles(child));
			}
		}
		return files;
	}
}
