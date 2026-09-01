import path from 'node:path';
import { App, TFile } from 'obsidian';
import {
	KNOWLEDGE_WIKI_INDEX_PATH,
	TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH,
	TRACEKEEPER_OPERATIONS_DIR,
	TRACEKEEPER_REVIEW_QUEUE_DIR,
	TRACEKEEPER_TASKS_DIR,
	NodeFileOperationJournal,
	RecoverableOperationRunner,
	applyManagedRelationsBlock,
	buildWikiReviewBatchId,
	computePayloadHash,
	hashVaultContent,
	mergeManagedWikiRelationsBlocks,
	isKnowledgeWikiPath,
	computeWikiEffectiveRisk,
	normalizeKnowledgePath,
	parseManagedRelationsBlock,
	WIKI_REVIEW_BATCH_MAX_BYTES,
	WIKI_REVIEW_BATCH_MAX_ITEMS,
	readManagedWikiRelations,
	type OperationFailureStatus,
	type OperationJournal,
	type OperationRecord,
	type ProposalTransitionDecision,
} from '@tracekeeper/core';
import type { ActivityRecordRepository } from '../activity/activity-record-repository';
import type { LocalToolExecutionOptions } from '../../composition/local-tool-executor';
import type { MemoryProposalRecord } from './review-view-model';
import type { ObsidianProposalTransitionRequest } from './proposal-transition-adapter';

const WIKI_BATCH_PREVIEW_TTL_MS = 5 * 60 * 1000;
const WIKI_BATCH_OPERATION_PREFIX = 'wiki-review-batch-';
const WIKI_BATCH_ACTIVITY_STEP = 'batch-activity';

export interface WikiReviewBatchProgress {
	phase: 'preflight' | 'claiming' | 'approving' | 'writing' | 'finalizing' | 'completed' | 'conflict';
	completed: number;
	total: number;
	currentProposalPath?: string;
	currentTargetPath?: string;
	lastStep?: string;
	message?: string;
}

export interface WikiReviewBatchConfirmOptions {
	idempotencyKey?: string;
	onProgress?: (progress: WikiReviewBatchProgress) => void;
}

export interface WikiReviewBatchTargetPlan {
	targetGroupId: string;
	targetPath: string;
	targetExists: boolean;
	targetContentHash: string;
	targetVersion: string;
	targetResultContentHash: string;
	writebackEffect: MemoryProposalRecord['writebackEffect'];
	writebackBlock: string;
	proposalPaths: string[];
	dependencies: string[];
	priority: number;
}

export interface WikiReviewBatchPreviewItem {
	proposalId: string;
	proposalPath: string;
	proposalRevision: string;
	proposalContentHash: string;
	proposalFileHash: string;
	targetPath: string;
	targetExists: boolean;
	targetContentHash: string;
	targetVersion: string;
	targetResultContentHash: string;
	taskId: string;
	taskPath: string;
	taskContentHash: string;
	activityPath: string;
	touchedNotes: string[];
	effectiveRisk: string;
	writebackPreview: string;
	writebackEffect?: MemoryProposalRecord['writebackEffect'];
	targetGroupId: string;
}

export interface WikiReviewBatchPreviewV2 {
	schemaVersion: 2;
	operationId: string;
	idempotencyKey: string;
	reviewBatchId: string;
	issuedAt: string;
	expiresAt: string;
	manifestHash: string;
	items: WikiReviewBatchPreviewItem[];
	targets: WikiReviewBatchTargetPlan[];
	executionOrder: string[];
	activityContext: {
		actor: 'user';
		activityPath: string;
		taskIds: string[];
	};
	confirmationToken: string;
}

export type WikiReviewBatchPreview = WikiReviewBatchPreviewV2;

export interface WikiReviewBatchReceiptV2 {
	schemaVersion: 2;
	operationId: string;
	reviewBatchId: string;
	status: 'completed' | 'partial' | 'conflict';
	approved: string[];
	applied: string[];
	pending: string[];
	conflicts: Array<{ proposalPath: string; targetPath?: string; message: string }>;
	targetWrites: string[];
	resumable: boolean;
	completedAt: string | null;
}

export type WikiReviewBatchReceipt = WikiReviewBatchReceiptV2;

interface WikiReviewBatchOperationPayload {
	schemaVersion: 2;
	operationId: string;
	idempotencyKey: string;
	reviewBatchId: string;
	issuedAt: string;
	expiresAt: string;
	manifestHash: string;
	items: WikiReviewBatchPreviewItem[];
	targets: WikiReviewBatchTargetPlan[];
	executionOrder: string[];
	activityContext: {
		actor: 'user';
		activityPath: string;
		taskIds: string[];
	};
}

interface WikiReviewBatchHost {
	executeLocalTool(
		name: string,
		args: Record<string, unknown>,
		options?: LocalToolExecutionOptions
	): Promise<Record<string, unknown>>;
	appendToAuditLog(entry: string): Promise<void>;
	refreshGovernanceViews(): Promise<void>;
	getVaultRoot(): string;
}

interface WikiReviewBatchTransitionOwner {
	transition(request: ObsidianProposalTransitionRequest): Promise<ProposalTransitionDecision>;
}

class WikiBatchTerminalConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'WikiBatchTerminalConflictError';
	}
}

class ProgressReportingJournal implements OperationJournal {
	constructor(
		private readonly inner: OperationJournal,
		private readonly onSaved: (record: OperationRecord) => void
	) {}

	loadByIdempotencyKey<TResult = unknown>(idempotencyKey: string): Promise<OperationRecord<TResult> | null> {
		return this.inner.loadByIdempotencyKey(idempotencyKey);
	}

	loadById<TResult = unknown>(operationId: string): Promise<OperationRecord<TResult> | null> {
		return this.inner.loadById(operationId);
	}

	listRecoverable<TResult = unknown>(): Promise<OperationRecord<TResult>[]> {
		return this.inner.listRecoverable();
	}

	acquireLock(idempotencyKey: string): Promise<() => Promise<void>> {
		if (!this.inner.acquireLock) {
			return Promise.resolve(async () => undefined);
		}
		return this.inner.acquireLock(idempotencyKey);
	}

	claim<TResult = unknown>(record: OperationRecord<TResult>): Promise<boolean> {
		if (!this.inner.claim) {
			return Promise.resolve(true);
		}
		return this.inner.claim(record);
	}

	async save<TResult = unknown>(record: OperationRecord<TResult>): Promise<void> {
		await this.inner.save(record);
		this.onSaved(record);
	}
}

const stepName = (kind: 'approve' | 'apply', index: number): string =>
	`${kind}-${String(index).padStart(3, '0')}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string => typeof value === 'string' ? value : '';

const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort((left, right) => left.localeCompare(right));

const taskPathFor = (taskId: string): string => {
	if (!taskId) return '';
	if (!/^[A-Za-z0-9._:-]+$/.test(taskId)) {
		throw new WikiBatchTerminalConflictError(`Task id cannot be used as a Wiki batch context path: ${taskId}.`);
	}
	return `${TRACEKEEPER_TASKS_DIR}/${taskId}.md`;
};

const fileVersion = (file: TFile | null, content: string): string => {
	if (!file) return 'absent';
	const stat = file.stat;
	return `${stat?.mtime ?? 0}:${stat?.size ?? content.length}`;
};

const previewTaskContext = (value: unknown): value is WikiReviewBatchPreviewV2['activityContext'] =>
	isRecord(value)
	&& value.actor === 'user'
	&& value.activityPath === TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH
	&& Array.isArray(value.taskIds)
	&& value.taskIds.every((taskId) => typeof taskId === 'string');

const orderTargetPlans = (targets: readonly WikiReviewBatchTargetPlan[]): WikiReviewBatchTargetPlan[] => {
	const remaining = new Map(targets.map((target) => [target.targetPath, target]));
	const ordered: WikiReviewBatchTargetPlan[] = [];
	const compare = (left: WikiReviewBatchTargetPlan, right: WikiReviewBatchTargetPlan): number =>
		left.priority - right.priority || left.targetPath.localeCompare(right.targetPath) || left.targetGroupId.localeCompare(right.targetGroupId);
	while (remaining.size > 0) {
		const ready = [...remaining.values()]
			.filter((target) => target.dependencies.every((dependency) => !remaining.has(dependency)))
			.sort(compare);
		if (ready.length === 0) {
			throw new WikiBatchTerminalConflictError('Wiki batch relation dependencies contain a cycle.');
		}
		for (const target of ready) {
			remaining.delete(target.targetPath);
			ordered.push(target);
		}
	}
	return ordered;
};

const notifyProgress = (
	callback: ((progress: WikiReviewBatchProgress) => void) | undefined,
	progress: WikiReviewBatchProgress
): void => {
	try {
		callback?.(progress);
	} catch {
		// UI observers must never change the outcome of a durable write.
	}
};

const isWritebackEffect = (value: unknown): value is NonNullable<MemoryProposalRecord['writebackEffect']> =>
	value === 'append'
	|| value === 'create_wiki_note'
	|| value === 'create_memory_record'
	|| value === 'update_managed_relations';

const isBatchPreviewItem = (value: unknown): value is WikiReviewBatchPreviewItem =>
	isRecord(value)
	&& typeof value.proposalId === 'string'
	&& typeof value.proposalPath === 'string'
	&& value.proposalPath.startsWith(`${TRACEKEEPER_REVIEW_QUEUE_DIR}/`)
	&& typeof value.proposalRevision === 'string'
	&& typeof value.proposalContentHash === 'string'
	&& typeof value.proposalFileHash === 'string'
	&& typeof value.targetPath === 'string'
	&& isKnowledgeWikiPath(value.targetPath)
	&& typeof value.targetExists === 'boolean'
	&& typeof value.targetContentHash === 'string'
	&& typeof value.targetVersion === 'string'
	&& typeof value.targetResultContentHash === 'string'
	&& typeof value.taskId === 'string'
	&& typeof value.taskPath === 'string'
	&& typeof value.taskContentHash === 'string'
	&& value.activityPath === TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH
	&& Array.isArray(value.touchedNotes)
	&& value.touchedNotes.every((item) => typeof item === 'string')
	&& typeof value.effectiveRisk === 'string'
	&& typeof value.writebackPreview === 'string'
	&& (value.writebackEffect === undefined || isWritebackEffect(value.writebackEffect))
	&& typeof value.targetGroupId === 'string';

const isBatchTargetPlan = (value: unknown): value is WikiReviewBatchTargetPlan =>
	isRecord(value)
	&& typeof value.targetGroupId === 'string'
	&& typeof value.targetPath === 'string'
	&& isKnowledgeWikiPath(value.targetPath)
	&& typeof value.targetExists === 'boolean'
	&& typeof value.targetContentHash === 'string'
	&& typeof value.targetVersion === 'string'
	&& typeof value.targetResultContentHash === 'string'
	&& isWritebackEffect(value.writebackEffect)
	&& typeof value.writebackBlock === 'string'
	&& Array.isArray(value.proposalPaths)
	&& value.proposalPaths.length > 0
	&& value.proposalPaths.every((item) => typeof item === 'string' && item.startsWith(`${TRACEKEEPER_REVIEW_QUEUE_DIR}/`))
	&& Array.isArray(value.dependencies)
	&& value.dependencies.every((item) => typeof item === 'string' && isKnowledgeWikiPath(item))
	&& Number.isSafeInteger(value.priority);

/**
 * 负责 Wiki 批次预检、认领、逐步写回和中断恢复。
 *
 * @description 批次层只认领操作日志，不持有 Obsidian 文件锁；文件锁由下层原子适配器独占。
 */
export class WikiReviewBatchApplication {
	constructor(
		private readonly app: App,
		private readonly records: ActivityRecordRepository,
		private readonly host: WikiReviewBatchHost,
		private readonly transitions: WikiReviewBatchTransitionOwner,
		private readonly operationIdFactory: () => string,
		private readonly nowFactory: () => Date = () => new Date()
	) {}

	/**
	 * 生成绑定完整提案和目标快照的批次预览。
	 */
	async preview(proposals: readonly MemoryProposalRecord[]): Promise<WikiReviewBatchPreview> {
		if (proposals.length === 0 || proposals.length > WIKI_REVIEW_BATCH_MAX_ITEMS) {
			throw new Error('Wiki review batch count is outside the bounded range.');
		}
		const reviewBatchIds = new Set(
			proposals.map((proposal) => buildWikiReviewBatchId(proposal.taskId, proposal.proposalId))
		);
		if (reviewBatchIds.size !== 1) {
			throw new Error('Wiki review batch contains proposals from different trusted batches.');
		}
		if (new Set(proposals.map((proposal) => proposal.path)).size !== proposals.length) {
			throw new Error('Wiki review batch contains a duplicate proposal path.');
		}
		const currentRecords: MemoryProposalRecord[] = [];
		const computedRisks = new Map<string, string>();
		const targetEntries = new Map<string, {
			proposal: MemoryProposalRecord;
			targetContent: string;
			targetExists: boolean;
			targetVersion: string;
			taskPath: string;
			taskContentHash: string;
			effectiveRisk: string;
			effectiveWritebackEffect: NonNullable<MemoryProposalRecord['writebackEffect']>;
		}[]>();
		for (const proposal of proposals) {
			const current = await this.readCurrentProposal(proposal.path);
			if (
				current.proposalId !== proposal.proposalId
				|| current.revision !== proposal.revision
				|| current.contentHash !== proposal.contentHash
				|| current.fileContentHash !== proposal.fileContentHash
			) {
				throw new Error(`Wiki proposal changed before batch preview: ${proposal.path}.`);
			}
			const targetPath = normalizeKnowledgePath(current.targetNote);
			if (!targetPath || !isKnowledgeWikiPath(targetPath)) {
				throw new Error(`Batch review accepts only Wiki targets: ${current.targetNote}.`);
			}
			if (current.approvalStatus !== 'pending' && current.approvalStatus !== 'approved') {
				throw new Error(`Wiki proposal is not reviewable: ${current.path}.`);
			}
			if (current.writebackAmbiguous || current.invalidWritebackEffect || current.writebackError) {
				throw new WikiBatchTerminalConflictError(`Wiki proposal writeback boundaries are invalid: ${current.path}.`);
			}
			const target = this.app.vault.getAbstractFileByPath(targetPath);
			if (target && !(target instanceof TFile)) {
				throw new Error(`Wiki target path is occupied by a non-file entry: ${targetPath}.`);
			}
			const targetContent = target instanceof TFile ? await this.app.vault.read(target) : '';
			const effectiveWritebackEffect = current.writebackEffect
				|| (target instanceof TFile ? 'append' : 'create_wiki_note');
			const relationsStatus = effectiveWritebackEffect === 'update_managed_relations'
				? parseManagedRelationsBlock(targetContent).status
				: undefined;
			const effectiveRisk = effectiveWritebackEffect === 'create_memory_record'
				? 'blocked'
				: computeWikiEffectiveRisk({
					targetExists: target instanceof TFile,
					writebackEffect: effectiveWritebackEffect,
					targetPathAllowed: true,
					relationsStatus,
				});
			if (effectiveRisk === 'blocked') {
				throw new WikiBatchTerminalConflictError(`Wiki proposal is blocked by its current target and relation state: ${current.path}.`);
			}
			computedRisks.set(current.path, effectiveRisk);
			const taskPath = taskPathFor(current.taskId);
			const task = taskPath
				? this.app.vault.getAbstractFileByPath(taskPath)
				: null;
			if (taskPath && !(task instanceof TFile)) {
				throw new WikiBatchTerminalConflictError(`Wiki batch task context is unavailable: ${taskPath}.`);
			}
			const taskContent = task instanceof TFile ? await this.app.vault.read(task) : '';
			const bucket = targetEntries.get(targetPath) ?? [];
			bucket.push({
				proposal: current,
				targetContent,
				targetExists: target instanceof TFile,
				targetVersion: fileVersion(target instanceof TFile ? target : null, targetContent),
				taskPath,
				taskContentHash: task instanceof TFile ? hashVaultContent(taskContent) : '',
				effectiveRisk,
				effectiveWritebackEffect,
			});
			targetEntries.set(targetPath, bucket);
			currentRecords.push(current);
		}
		const highRiskCount = currentRecords.filter((proposal) => computedRisks.get(proposal.path) === 'high').length;
		if (highRiskCount > 0 && currentRecords.length !== 1) {
			throw new Error('High-risk Wiki changes must be reviewed individually.');
		}

		const targets: WikiReviewBatchTargetPlan[] = [];
		const itemTarget = new Map<string, WikiReviewBatchTargetPlan>();
		let totalBytes = 0;
		for (const [targetPath, entries] of [...targetEntries.entries()].sort(([left], [right]) => left.localeCompare(right))) {
			const relationOnly = entries.every((entry) => entry.effectiveWritebackEffect === 'update_managed_relations');
			if (entries.length > 1 && !relationOnly) {
				throw new WikiBatchTerminalConflictError(
					`Multiple non-relation Wiki writes target the same note: ${targetPath}.`
				);
			}
			const first = entries[0];
			if (!first) continue;
			if (relationOnly && !first.targetExists) {
				throw new WikiBatchTerminalConflictError(
					`Managed relation target does not exist: ${targetPath}.`
				);
			}
			const targetGroupId = `target:${targetPath}`;
			let writebackBlock = first.proposal.writebackContent;
			let targetResultContent = first.targetContent;
			if (relationOnly) {
				writebackBlock = mergeManagedWikiRelationsBlocks(
					first.targetContent,
					entries.map((entry) => entry.proposal.writebackContent)
				);
				targetResultContent = applyManagedRelationsBlock(first.targetContent, writebackBlock);
			}
			if (!writebackBlock.trim()) {
				throw new WikiBatchTerminalConflictError(`Wiki writeback content is empty: ${targetPath}.`);
			}
			totalBytes += new TextEncoder().encode(writebackBlock).byteLength;
			if (totalBytes > WIKI_REVIEW_BATCH_MAX_BYTES) {
				throw new Error('Wiki review batch exceeds the bounded content size.');
			}
			const targetPlan: WikiReviewBatchTargetPlan = {
				targetGroupId,
				targetPath,
				targetExists: first.targetExists,
				targetContentHash: first.targetExists ? hashVaultContent(first.targetContent) : 'absent',
				targetVersion: first.targetVersion,
				targetResultContentHash: first.targetExists ? hashVaultContent(targetResultContent) : hashVaultContent(writebackBlock),
				writebackEffect: relationOnly
					? 'update_managed_relations'
					: first.effectiveWritebackEffect,
				writebackBlock,
				proposalPaths: entries.map((entry) => entry.proposal.path).sort(),
				dependencies: [],
				priority: targetPath === KNOWLEDGE_WIKI_INDEX_PATH
					? 0
					: entries.some((entry) => entry.proposal.wikiRole === 'topic_map') ? 1 : 2,
			};
			targets.push(targetPlan);
			for (const entry of entries) itemTarget.set(entry.proposal.path, targetPlan);
		}

		const targetPaths = new Set(targets.map((target) => target.targetPath));
		for (const target of targets) {
			if (target.writebackEffect !== 'update_managed_relations') continue;
			const relations = readManagedWikiRelations(target.writebackBlock);
			const dependencies = uniqueSorted([
				...(relations.parent ? [relations.parent] : []),
				...(relations.related ?? []),
			].filter((relationPath) => targetPaths.has(relationPath)));
			if (dependencies.includes(target.targetPath)) {
				throw new WikiBatchTerminalConflictError(`Wiki batch relation dependency cycle includes ${target.targetPath}.`);
			}
			target.dependencies = dependencies;
		}
		const orderedTargets = orderTargetPlans(targets);
		const targetOrder = new Map(orderedTargets.map((target, index) => [target.targetGroupId, index]));
		const orderedRecords = [...currentRecords].sort((left, right) => {
			const leftTarget = itemTarget.get(left.path);
			const rightTarget = itemTarget.get(right.path);
			const leftOrder = leftTarget ? targetOrder.get(leftTarget.targetGroupId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
			const rightOrder = rightTarget ? targetOrder.get(rightTarget.targetGroupId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
			return leftOrder - rightOrder
				|| (left.created || '').localeCompare(right.created || '')
				|| left.path.localeCompare(right.path);
		});
		const items = orderedRecords.map((current): WikiReviewBatchPreviewItem => {
			const target = itemTarget.get(current.path);
			if (!target) throw new Error(`Wiki target plan is missing: ${current.path}.`);
			return {
				proposalId: current.proposalId,
				proposalPath: current.path,
				proposalRevision: current.revision,
				proposalContentHash: current.contentHash,
				proposalFileHash: current.fileContentHash,
				targetPath: target.targetPath,
				targetExists: target.targetExists,
				targetContentHash: target.targetContentHash,
				targetVersion: target.targetVersion,
				targetResultContentHash: target.targetResultContentHash,
				taskId: current.taskId,
				taskPath: taskPathFor(current.taskId),
				taskContentHash: targetEntries.get(target.targetPath)?.find((entry) => entry.proposal.path === current.path)?.taskContentHash || '',
				activityPath: TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH,
				touchedNotes: uniqueSorted([
					target.targetPath,
					current.path,
					taskPathFor(current.taskId),
					TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH,
				].filter(Boolean)),
				effectiveRisk: targetEntries.get(target.targetPath)?.find((entry) => entry.proposal.path === current.path)?.effectiveRisk || 'blocked',
				writebackPreview: target.writebackBlock,
				writebackEffect: target.writebackEffect || 'append',
				targetGroupId: target.targetGroupId,
			};
		});

		const issuedAt = this.nowFactory();
		const operationId = `${WIKI_BATCH_OPERATION_PREFIX}${this.operationIdFactory().replace(/^review-/, '')}`;
		const idempotencyKey = `wiki-review-batch:${operationId}`;
		const base = {
			schemaVersion: 2 as const,
			operationId,
			idempotencyKey,
			reviewBatchId: [...reviewBatchIds][0] || '',
			issuedAt: issuedAt.toISOString(),
			expiresAt: new Date(issuedAt.getTime() + WIKI_BATCH_PREVIEW_TTL_MS).toISOString(),
			items,
			targets: orderedTargets,
			executionOrder: orderedTargets.map((target) => target.targetGroupId),
			activityContext: {
				actor: 'user' as const,
				activityPath: TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH,
				taskIds: uniqueSorted(currentRecords.map((record) => record.taskId).filter(Boolean)),
			},
		};
		const manifestHash = computePayloadHash(base);
		const unsigned = { ...base, manifestHash };
		return {
			...unsigned,
			confirmationToken: hashVaultContent(JSON.stringify(unsigned)),
		};
	}

	/**
	 * 认领并执行已确认的批次；不会在批次层重复获取文件路径锁。
	 */
	async confirm(
		preview: WikiReviewBatchPreview,
		confirmationToken: string,
		options: WikiReviewBatchConfirmOptions | ((progress: WikiReviewBatchProgress) => void) = {}
	): Promise<WikiReviewBatchReceipt> {
		const onProgress = typeof options === 'function' ? options : options.onProgress;
		const idempotencyKey = typeof options === 'function'
			? preview.idempotencyKey
			: options.idempotencyKey || preview.idempotencyKey;
		this.assertPreview(preview, confirmationToken);
		if (idempotencyKey !== preview.idempotencyKey) {
			throw new Error('Wiki batch idempotency key does not match the displayed preview.');
		}
		if (this.nowFactory().getTime() > Date.parse(preview.expiresAt)) {
			throw new Error('Wiki batch preview expired; generate a fresh preview.');
		}
		notifyProgress(onProgress, { phase: 'preflight', completed: 0, total: preview.items.length, message: '预检批次目标和提案' });
		await this.validatePreviewState(preview);
		notifyProgress(onProgress, { phase: 'claiming', completed: 0, total: preview.items.length, message: '正在认领批次操作' });
		return this.runPayload(this.payloadFromPreview(preview), onProgress);
	}

	/**
	 * 从已持久化的批次操作继续执行。
	 */
	async resume(
		operationId: string,
		onProgress?: (progress: WikiReviewBatchProgress) => void
	): Promise<WikiReviewBatchReceipt> {
		const journal = this.createJournal();
		const record = await journal.loadById<WikiReviewBatchReceipt>(operationId);
		if (!record || !isRecord(record.payload)) {
			throw new Error(`Wiki batch operation is unavailable: ${operationId}.`);
		}
		const payload = this.parsePayload(record.payload);
		return this.runPayload(payload, onProgress);
	}

	/**
	 * 启动后恢复所有已认领但未完成的 Wiki 批次。
	 */
	async recoverPending(
		onProgress?: (progress: WikiReviewBatchProgress) => void
	): Promise<WikiReviewBatchReceipt[]> {
		const journal = this.createJournal();
		const records = await journal.listRecoverable<WikiReviewBatchReceipt>();
		const receipts: WikiReviewBatchReceipt[] = [];
		for (const record of records.filter((item) => item.operation_id.startsWith(WIKI_BATCH_OPERATION_PREFIX))) {
			if (!isRecord(record.payload)) continue;
			receipts.push(await this.runPayload(this.parsePayload(record.payload), onProgress));
		}
		return receipts;
	}

	/**
	 * 列出启动后需要恢复的批次身份，供 Obsidian 弹窗重新绑定进度。
	 */
	async listRecoverableOperationIds(): Promise<string[]> {
		const records = await this.createJournal().listRecoverable();
		return records
			.filter((record) => record.operation_id.startsWith(WIKI_BATCH_OPERATION_PREFIX))
			.map((record) => record.operation_id);
	}

	private async runPayload(
		payload: WikiReviewBatchOperationPayload,
		onProgress?: (progress: WikiReviewBatchProgress) => void
	): Promise<WikiReviewBatchReceipt> {
		const baseJournal = this.createJournal();
		const reportingJournal = new ProgressReportingJournal(baseJournal, (record) => {
			notifyProgress(onProgress, this.progressFromRecord(payload, record));
		});
		const runner = new RecoverableOperationRunner<WikiReviewBatchOperationPayload, WikiReviewBatchReceipt>({
			operationId: payload.operationId,
			idempotencyKey: payload.idempotencyKey,
			payload,
			journal: reportingJournal,
			steps: this.buildSteps(payload, onProgress),
			finalize: () => ({
				schemaVersion: 2,
				operationId: payload.operationId,
				reviewBatchId: payload.reviewBatchId,
				status: 'completed',
				approved: payload.items.map((item) => item.proposalPath),
				applied: payload.items.map((item) => item.proposalPath),
				pending: [],
				conflicts: [],
				targetWrites: payload.targets.map((target) => target.targetPath),
				resumable: false,
				completedAt: this.nowFactory().toISOString(),
			}),
			failureInjection: undefined,
			clock: () => this.nowFactory().toISOString(),
		});
		try {
			const receipt = await runner.run();
			notifyProgress(onProgress, { phase: 'completed', completed: payload.items.length, total: payload.items.length, message: 'Wiki 批次已完成' });
			await this.host.refreshGovernanceViews().catch((error) => {
				console.error('tracekeeper failed to refresh after Wiki review batch', error);
			});
			return receipt;
		} catch (error) {
			const record = await baseJournal.loadById<WikiReviewBatchReceipt>(payload.operationId);
			if (!record) throw error;
			if (record.status === 'completed' && record.result) {
				await this.host.refreshGovernanceViews().catch((refreshError) => {
					console.error('tracekeeper failed to refresh after completed Wiki review batch', refreshError);
				});
				return record.result;
			}
			const receipt = this.receiptFromRecord(payload, record, error);
			notifyProgress(onProgress, {
				phase: receipt.status === 'conflict' ? 'conflict' : 'writing',
				completed: receipt.applied.length,
				total: payload.items.length,
				message: receipt.conflicts[0]?.message || '批次尚未完成',
			});
			await this.host.refreshGovernanceViews().catch((refreshError) => {
				console.error('tracekeeper failed to refresh after partial Wiki review batch', refreshError);
			});
			return receipt;
		}
	}

	private buildSteps(
		payload: WikiReviewBatchOperationPayload,
		onProgress?: (progress: WikiReviewBatchProgress) => void
	) {
		const approvalSteps = payload.items.map((item, index) => ({
			name: stepName('approve', index),
			persistResult: true,
			failureStatus: (error: unknown): OperationFailureStatus =>
				error instanceof WikiBatchTerminalConflictError ? 'conflicted' : 'failed',
			execute: async () => {
				notifyProgress(onProgress, {
					phase: 'approving',
					completed: index,
					total: payload.items.length,
					currentProposalPath: item.proposalPath,
					currentTargetPath: item.targetPath,
				});
				const current = await this.readCurrentProposal(item.proposalPath);
				if (current.approvalStatus === 'approved' || current.approvalStatus === 'applied') {
					return { status: 'already_approved', proposalPath: item.proposalPath };
				}
				if (current.approvalStatus !== 'pending') {
					throw new WikiBatchTerminalConflictError(`Proposal is not pending: ${item.proposalPath}.`);
				}
				const decision = await this.transitions.transition({
					proposalPath: current.path,
					expectedRevision: current.revision,
					expectedContentHash: current.contentHash,
					operationId: `${payload.operationId}-approve-${index + 1}`,
					action: { kind: 'status', nextStatus: 'approved' },
					now: this.nowFactory().toISOString(),
					actor: 'user',
				});
				await this.appendProposalTransitionAuditEvent(decision, 'memory.proposal.approved');
				return { status: 'approved', proposalPath: current.path };
			},
		}));

		const applySteps = payload.items.map((item, index) => ({
			name: stepName('apply', index),
			persistResult: true,
			failureStatus: (error: unknown): OperationFailureStatus =>
				error instanceof WikiBatchTerminalConflictError ? 'conflicted' : 'failed',
			execute: async () => {
				notifyProgress(onProgress, {
					phase: 'writing',
					completed: index,
					total: payload.items.length,
					currentProposalPath: item.proposalPath,
					currentTargetPath: item.targetPath,
				});
				const current = await this.readCurrentProposal(item.proposalPath);
				if (current.approvalStatus === 'applied') {
					return { status: 'already_applied', proposalPath: item.proposalPath, targetPath: item.targetPath };
				}
				if (current.approvalStatus !== 'approved') {
					throw new WikiBatchTerminalConflictError(`Proposal is not approved: ${item.proposalPath}.`);
				}
				const target = this.app.vault.getAbstractFileByPath(item.targetPath);
				const targetContent = target instanceof TFile ? await this.app.vault.read(target) : '';
				const targetHash = target instanceof TFile ? hashVaultContent(targetContent) : 'absent';
				if (targetHash !== item.targetContentHash && targetHash !== item.targetResultContentHash) {
					throw new WikiBatchTerminalConflictError(`Wiki batch target changed: ${item.targetPath}.`);
				}
				const task = item.taskPath
					? this.app.vault.getAbstractFileByPath(item.taskPath)
					: null;
				if (item.taskPath && !(task instanceof TFile)) {
					throw new WikiBatchTerminalConflictError(`Wiki batch task context is unavailable: ${item.taskPath}.`);
				}
				const taskContent = task instanceof TFile ? await this.app.vault.read(task) : '';
				if ((task instanceof TFile ? hashVaultContent(taskContent) : '') !== item.taskContentHash) {
					throw new WikiBatchTerminalConflictError(`Wiki batch task changed: ${item.taskPath || item.proposalPath}.`);
				}
				const override = item.writebackEffect === 'update_managed_relations'
					? {
						proposalPath: item.proposalPath,
						targetPath: item.targetPath,
						writebackBlock: item.writebackPreview,
						batchOperationId: payload.operationId,
					}
					: undefined;
				const preview = await this.previewApprovedWriteback(current, override);
				const appliedTargetHash = preview.target_content_hash;
				const allowedTargetHashes = item.writebackEffect === 'update_managed_relations'
					? new Set([item.targetContentHash, item.targetResultContentHash])
					: new Set([item.targetContentHash]);
				if (!allowedTargetHashes.has(appliedTargetHash)) {
					throw new WikiBatchTerminalConflictError(`Wiki batch target changed before item apply: ${item.targetPath}.`);
				}
				await this.applyApprovedWriteback(current, preview, override);
				return { status: 'applied', proposalPath: item.proposalPath, targetPath: item.targetPath };
			},
		}));

		return [
			...approvalSteps,
			...applySteps,
			{
				name: WIKI_BATCH_ACTIVITY_STEP,
				persistResult: true,
				failureStatus: 'activity_pending' as const,
				execute: async () => {
					notifyProgress(onProgress, { phase: 'finalizing', completed: payload.items.length, total: payload.items.length, message: '正在记录批次结果' });
					await this.host.appendToAuditLog(
						`## ${this.nowFactory().toISOString()}\n` +
						`action: wiki.review_batch\n` +
						`actor: user\n` +
						`operation_id: ${payload.operationId}\n` +
						`review_batch_id: ${payload.reviewBatchId}\n` +
						`approved_count: ${payload.items.length}\n` +
						`applied_count: ${payload.items.length}\n` +
						`target_count: ${payload.targets.length}\n` +
						`result: success\n\n`
					);
					return { status: 'recorded' };
				},
			},
		];
	}

	private progressFromRecord(
		payload: WikiReviewBatchOperationPayload,
		record: OperationRecord
	): WikiReviewBatchProgress {
		const completed = record.completed_steps.filter((step) => step.name.startsWith('apply-')).length;
		const approved = record.completed_steps.filter((step) => step.name.startsWith('approve-')).length;
		const phase = completed >= payload.items.length
			? 'finalizing'
			: record.completed_steps.length === 0
				? 'claiming'
				: approved >= payload.items.length ? 'writing' : 'approving';
		const lastStep = record.completed_steps[record.completed_steps.length - 1]?.name;
		return {
			phase,
			completed,
			total: payload.items.length,
			lastStep,
			message: lastStep ? `已持久化步骤 ${lastStep}` : '正在认领批次操作',
		};
	}

	private receiptFromRecord(
		payload: WikiReviewBatchOperationPayload,
		record: OperationRecord,
		error: unknown
	): WikiReviewBatchReceipt {
		const completed = new Set(record.completed_steps.map((step) => step.name));
		const approved = payload.items
			.filter((_item, index) => completed.has(stepName('approve', index)))
			.map((item) => item.proposalPath);
		const applied = payload.items
			.filter((_item, index) => completed.has(stepName('apply', index)))
			.map((item) => item.proposalPath);
		const pending = payload.items
			.filter((_item, index) => !completed.has(stepName('apply', index)))
			.map((item) => item.proposalPath);
		const message = record.error || (error instanceof Error ? error.message : String(error));
		const failedIndex = payload.items.findIndex((_item, index) =>
			completed.has(stepName('approve', index)) && !completed.has(stepName('apply', index))
		);
		const failedItem = failedIndex >= 0 ? payload.items[failedIndex] : payload.items[applied.length];
		return {
			schemaVersion: 2,
			operationId: payload.operationId,
			reviewBatchId: payload.reviewBatchId,
			status: applied.length > 0 ? 'partial' : 'conflict',
			approved,
			applied,
			pending,
			conflicts: failedItem
				? [{ proposalPath: failedItem.proposalPath, targetPath: failedItem.targetPath, message }]
				: [],
			targetWrites: payload.targets
			.filter((target) => target.proposalPaths.some((proposalPath) => applied.includes(proposalPath)))
			.map((target) => target.targetPath),
			resumable: record.status !== 'conflicted' && record.status !== 'completed',
			completedAt: record.status === 'completed' ? record.updated_at : null,
		};
	}

	private payloadFromPreview(preview: WikiReviewBatchPreview): WikiReviewBatchOperationPayload {
		return {
			schemaVersion: 2,
			operationId: preview.operationId,
			idempotencyKey: preview.idempotencyKey,
			reviewBatchId: preview.reviewBatchId,
			issuedAt: preview.issuedAt,
			expiresAt: preview.expiresAt,
			manifestHash: preview.manifestHash,
			items: preview.items,
			targets: preview.targets,
			executionOrder: preview.executionOrder,
			activityContext: preview.activityContext,
		};
	}

	private parsePayload(value: Record<string, unknown>): WikiReviewBatchOperationPayload {
		if (
			value.schemaVersion !== 2
			|| !asString(value.operationId).startsWith(WIKI_BATCH_OPERATION_PREFIX)
			|| !asString(value.idempotencyKey)
			|| !asString(value.reviewBatchId)
			|| !asString(value.issuedAt)
			|| !asString(value.expiresAt)
			|| !asString(value.manifestHash)
			|| !Array.isArray(value.items)
			|| !Array.isArray(value.targets)
			|| !Array.isArray(value.executionOrder)
			|| !value.executionOrder.every((item) => typeof item === 'string')
			|| !previewTaskContext(value.activityContext)
			|| value.items.length === 0
			|| value.items.length > WIKI_REVIEW_BATCH_MAX_ITEMS
			|| value.targets.length === 0
			|| !value.items.every(isBatchPreviewItem)
			|| !value.targets.every(isBatchTargetPlan)
		) {
			throw new Error('Wiki batch operation payload is invalid.');
		}
		const payload: WikiReviewBatchOperationPayload = {
			schemaVersion: 2,
			operationId: asString(value.operationId),
			idempotencyKey: asString(value.idempotencyKey),
			reviewBatchId: asString(value.reviewBatchId),
			issuedAt: asString(value.issuedAt),
			expiresAt: asString(value.expiresAt),
			manifestHash: asString(value.manifestHash),
			items: value.items as WikiReviewBatchPreviewItem[],
			targets: value.targets as WikiReviewBatchTargetPlan[],
			executionOrder: value.executionOrder as string[],
			activityContext: value.activityContext,
		};
		const targetGroups = new Set(payload.targets.map((target) => target.targetGroupId));
		const { manifestHash, ...manifestPayload } = payload;
		const issuedAt = Date.parse(payload.issuedAt);
		const expiresAt = Date.parse(payload.expiresAt);
		if (
			!Number.isFinite(issuedAt)
			|| !Number.isFinite(expiresAt)
			|| expiresAt <= issuedAt
			|| payload.executionOrder.length !== payload.targets.length
			|| new Set(payload.executionOrder).size !== payload.executionOrder.length
			|| targetGroups.size !== payload.targets.length
			|| new Set(payload.items.map((item) => item.proposalPath)).size !== payload.items.length
			|| new Set(payload.targets.map((target) => target.targetPath)).size !== payload.targets.length
			|| !payload.executionOrder.every((groupId) => targetGroups.has(groupId))
			|| !payload.items.every((item) => targetGroups.has(item.targetGroupId))
			|| !payload.items.every((item) => buildWikiReviewBatchId(item.taskId, item.proposalId) === payload.reviewBatchId)
			|| manifestHash !== computePayloadHash(manifestPayload)
		) {
			throw new Error('Wiki batch operation manifest is invalid.');
		}
		return payload;
	}

	private assertPreview(preview: WikiReviewBatchPreview, confirmationToken: string): void {
		const { manifestHash } = preview;
		const issuedAt = Date.parse(preview.issuedAt);
		const expiresAt = Date.parse(preview.expiresAt);
		const targetGroups = new Set(
			Array.isArray(preview.targets)
				? preview.targets.filter(isBatchTargetPlan).map((target) => target.targetGroupId)
				: []
		);
		const validShape = preview.schemaVersion === 2
			&& asString(preview.operationId).startsWith(WIKI_BATCH_OPERATION_PREFIX)
			&& Boolean(preview.idempotencyKey)
			&& Boolean(preview.reviewBatchId)
			&& Boolean(preview.issuedAt)
			&& Boolean(preview.expiresAt)
			&& Number.isFinite(issuedAt)
			&& Number.isFinite(expiresAt)
			&& expiresAt > issuedAt
			&& Array.isArray(preview.items)
			&& preview.items.length > 0
			&& preview.items.length <= WIKI_REVIEW_BATCH_MAX_ITEMS
			&& preview.items.every(isBatchPreviewItem)
			&& new Set(preview.items.map((item) => item.proposalPath)).size === preview.items.length
			&& Array.isArray(preview.targets)
			&& preview.targets.length > 0
			&& preview.targets.every(isBatchTargetPlan)
			&& new Set(preview.targets.map((target) => target.targetPath)).size === preview.targets.length
			&& Array.isArray(preview.executionOrder)
			&& preview.executionOrder.length === preview.targets.length
			&& new Set(preview.executionOrder).size === preview.executionOrder.length
			&& targetGroups.size === preview.targets.length
			&& preview.executionOrder.every((groupId) => targetGroups.has(groupId))
			&& preview.items.every((item) => targetGroups.has(item.targetGroupId))
			&& preview.items.every((item) => buildWikiReviewBatchId(item.taskId, item.proposalId) === preview.reviewBatchId)
			&& previewTaskContext(preview.activityContext);
		if (
			!validShape
			|| !confirmationToken
			|| confirmationToken !== preview.confirmationToken
			|| confirmationToken !== hashVaultContent(JSON.stringify(previewWithoutToken(preview)))
			|| manifestHash !== computePayloadHash(previewWithoutManifest(preview))
			|| preview.manifestHash !== manifestHash
		) {
			throw new Error('Wiki batch confirmation does not match the displayed preview.');
		}
	}

	private async validatePreviewState(preview: WikiReviewBatchPreview): Promise<void> {
		for (const item of preview.items) {
			const current = await this.readCurrentProposal(item.proposalPath);
			if (
				current.proposalId !== item.proposalId
				|| current.revision !== item.proposalRevision
				|| current.contentHash !== item.proposalContentHash
				|| current.fileContentHash !== item.proposalFileHash
				|| (current.approvalStatus !== 'pending' && current.approvalStatus !== 'approved')
			) {
				throw new Error(`Wiki batch preview is stale: ${item.proposalPath}.`);
			}
			const target = this.app.vault.getAbstractFileByPath(item.targetPath);
			if ((target instanceof TFile) !== item.targetExists) {
				throw new Error(`Wiki batch target presence changed: ${item.targetPath}.`);
			}
			const targetContent = target instanceof TFile ? await this.app.vault.read(target) : '';
			const targetHash = target instanceof TFile ? hashVaultContent(targetContent) : 'absent';
			if (targetHash !== item.targetContentHash || fileVersion(target instanceof TFile ? target : null, targetContent) !== item.targetVersion) {
				throw new Error(`Wiki batch target changed before the first write: ${item.targetPath}.`);
			}
			const taskPath = taskPathFor(item.taskId);
			if (taskPath !== item.taskPath) {
				throw new Error(`Wiki batch task context changed: ${item.proposalPath}.`);
			}
			const task = taskPath ? this.app.vault.getAbstractFileByPath(taskPath) : null;
			if (taskPath && !(task instanceof TFile)) {
				throw new Error(`Wiki batch task context is unavailable: ${taskPath}.`);
			}
			const taskContent = task instanceof TFile ? await this.app.vault.read(task) : '';
			const taskHash = task instanceof TFile ? hashVaultContent(taskContent) : '';
			if (taskHash !== item.taskContentHash) {
				throw new Error(`Wiki batch task changed before the first write: ${taskPath || item.proposalPath}.`);
			}
			const expectedTouchedNotes = uniqueSorted([
				item.targetPath,
				item.proposalPath,
				item.taskPath,
				item.activityPath,
			].filter(Boolean));
			if (computePayloadHash(expectedTouchedNotes) !== computePayloadHash(item.touchedNotes)) {
				throw new Error(`Wiki batch touched-note plan changed: ${item.proposalPath}.`);
			}
		}
	}

	private createJournal(): NodeFileOperationJournal {
		return new NodeFileOperationJournal({
			directory: path.join(this.host.getVaultRoot(), TRACEKEEPER_OPERATIONS_DIR),
		});
	}

	private async readCurrentProposal(proposalPath: string): Promise<MemoryProposalRecord> {
		const file = this.app.vault.getAbstractFileByPath(proposalPath);
		if (!(file instanceof TFile)) throw new Error(`Review proposal is unavailable: ${proposalPath}.`);
		const record = await this.records.readMemoryProposalFile(file);
		if (!record) throw new Error(`Review proposal is invalid: ${proposalPath}.`);
		return record;
	}

	private async previewApprovedWriteback(
		proposal: MemoryProposalRecord,
		override?: NonNullable<LocalToolExecutionOptions['wikiBatchWritebackOverride']>
	): Promise<{
		proposal_id: string;
		proposal_path: string;
		target_note: string;
		target_content_hash: string;
		confirmation_token: string;
	}> {
		const result = await this.host.executeLocalTool(
			'tracekeeper.apply_approved_writeback',
			{ proposal_path: proposal.path, dry_run: true, ...(proposal.taskId ? { task_id: proposal.taskId } : {}) },
			override ? { wikiBatchWritebackOverride: override } : undefined
		);
		if (
			!isRecord(result)
			|| typeof result.proposal_id !== 'string'
			|| typeof result.proposal_path !== 'string'
			|| typeof result.target_note !== 'string'
			|| typeof result.target_content_hash !== 'string'
			|| typeof result.confirmation_token !== 'string'
		) {
			throw new Error('Approved writeback confirmation preview returned an invalid result.');
		}
		return result as {
			proposal_id: string;
			proposal_path: string;
			target_note: string;
			target_content_hash: string;
			confirmation_token: string;
		};
	}

	private async applyApprovedWriteback(
		proposal: MemoryProposalRecord,
		preview: { confirmation_token: string },
		override?: NonNullable<LocalToolExecutionOptions['wikiBatchWritebackOverride']>
	): Promise<void> {
		await this.host.executeLocalTool(
			'tracekeeper.apply_approved_writeback',
			{
				proposal_path: proposal.path,
				confirmation_token: preview.confirmation_token,
				...(proposal.taskId ? { task_id: proposal.taskId } : {}),
			},
			override ? { wikiBatchWritebackOverride: override } : undefined
		);
	}

	private async appendProposalTransitionAuditEvent(
		decision: ProposalTransitionDecision,
		action: string
	): Promise<void> {
		const receipt = decision.receipt;
		await this.host.appendToAuditLog(
			`## ${receipt.committedAt}\n` +
			`action: ${action}\n` +
			`actor: user\n` +
			`target: ${receipt.proposalPath}\n` +
			`reason: committed proposal transition ${receipt.proposalId}\n` +
			`operation_id: ${receipt.operationId}\n` +
			`transition_kind: ${receipt.kind}\n` +
			`previous_status: ${receipt.previousStatus}\n` +
			`next_status: ${receipt.nextStatus}\n` +
			`expected_revision: ${receipt.expectedRevision}\n` +
			`previous_revision: ${receipt.previousRevision}\n` +
			`committed_revision: ${receipt.committedRevision}\n` +
			`previous_content_hash: ${receipt.previousContentHash}\n` +
			`committed_content_hash: ${receipt.committedContentHash}\n` +
			`task_id: ${receipt.taskId}\n` +
			`timestamp: ${receipt.committedAt}\n\n`
		);
	}
}

const previewWithoutToken = (
	preview: WikiReviewBatchPreview
): Omit<WikiReviewBatchPreviewV2, 'confirmationToken'> => {
	const { confirmationToken: _token, ...unsigned } = preview;
	return unsigned;
};

const previewWithoutManifest = (
	preview: WikiReviewBatchPreview
): Omit<WikiReviewBatchPreviewV2, 'confirmationToken' | 'manifestHash'> => {
	const {
		confirmationToken: _token,
		manifestHash: _manifest,
		...base
	} = preview;
	return base;
};
