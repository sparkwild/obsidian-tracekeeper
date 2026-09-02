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
	type OperationFailureInjection,
	type OperationJournal,
	type OperationRecord,
	type ProposalTransitionDecision,
} from '@tracekeeper/core';
import {
	planApprovedWritebackTaskLink,
	type ObsidianWikiBatchWritebackPreview,
} from '@tracekeeper/mcp-runtime';
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
	expectedTaskContentHashBefore: string;
	expectedTaskContentHashAfter: string;
	previewNonce: string;
	activityPath: string;
	touchedNotes: string[];
	effectiveRisk: string;
	writebackPreview: string;
	writebackEffect?: MemoryProposalRecord['writebackEffect'];
	targetGroupId: string;
}

export interface WikiReviewBatchTaskPlan {
	taskPath: string;
	initialContentHash: string;
	finalContentHash: string;
	proposalPaths: string[];
}

export interface WikiReviewBatchPreviewV3 {
	schemaVersion: 3;
	operationId: string;
	idempotencyKey: string;
	reviewBatchId: string;
	issuedAt: string;
	expiresAt: string;
	manifestHash: string;
	items: WikiReviewBatchPreviewItem[];
	targets: WikiReviewBatchTargetPlan[];
	taskPlans: WikiReviewBatchTaskPlan[];
	executionOrder: string[];
	activityContext: {
		actor: 'user';
		activityPath: string;
		taskIds: string[];
	};
	confirmationToken: string;
}

export type WikiReviewBatchPreview = WikiReviewBatchPreviewV3;

export interface WikiReviewBatchReceiptV3 {
	schemaVersion: 3;
	operationId: string;
	reviewBatchId: string;
	status: 'completed' | 'partial' | 'conflict';
	approved: string[];
	applied: string[];
	pending: string[];
	conflicts: Array<{ proposalPath: string; targetPath?: string; message: string }>;
	dependencyBlocked: Array<{ proposalPath: string; targetPath?: string; message: string }>;
	targetWrites: string[];
	resumable: boolean;
	completedAt: string | null;
}

export type WikiReviewBatchReceipt = WikiReviewBatchReceiptV3;

type WikiReviewBatchOperationItem = Omit<WikiReviewBatchPreviewItem, 'writebackPreview'> & {
	writebackPreviewHash: string;
};

type WikiReviewBatchOperationTarget = Omit<WikiReviewBatchTargetPlan, 'writebackBlock'> & {
	writebackBlockHash: string;
};

interface WikiReviewBatchOperationPayload {
	schemaVersion: 3;
	operationId: string;
	idempotencyKey: string;
	reviewBatchId: string;
	issuedAt: string;
	expiresAt: string;
	previewManifestHash: string;
	manifestHash: string;
	items: WikiReviewBatchOperationItem[];
	targets: WikiReviewBatchOperationTarget[];
	taskPlans: WikiReviewBatchTaskPlan[];
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
	previewWikiBatchApprovedWriteback(
		args: Record<string, unknown>,
		override: NonNullable<LocalToolExecutionOptions['wikiBatchWritebackOverride']>
	): Promise<ObsidianWikiBatchWritebackPreview>;
	appendWikiBatchActivity(operationId: string, entry: string): Promise<void>;
	refreshGovernanceViews(): Promise<void>;
	getVaultRoot(): string;
}

interface WikiReviewBatchTransitionOwner {
	transition(request: ObsidianProposalTransitionRequest): Promise<ProposalTransitionDecision>;
}

type WikiBatchItemTerminalStatus = 'verified' | 'conflict' | 'dependency_blocked';

interface WikiBatchPreparedItem {
	status: 'prepared';
	proposalPath: string;
	targetPath: string;
	writebackOperationId: string;
	writebackIdempotencyKey: string;
	stableBindingHash: string;
	targetContentHashBefore: string;
	targetResultContentHash: string;
}

interface WikiBatchAppliedItem extends Omit<WikiBatchPreparedItem, 'status'> {
	status: 'applied_pending_verify';
}

interface WikiBatchTerminalItemResult {
	status: WikiBatchItemTerminalStatus;
	proposalPath: string;
	targetPath: string;
	message?: string;
	writebackOperationId?: string;
	targetWritten?: boolean;
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

const stepName = (kind: 'approve' | 'prepare' | 'apply' | 'verify', index: number): string =>
	`${kind}-${String(index).padStart(3, '0')}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string => typeof value === 'string' ? value : '';

const isPreparedItem = (value: unknown): value is WikiBatchPreparedItem =>
	isRecord(value)
	&& value.status === 'prepared'
	&& typeof value.proposalPath === 'string'
	&& typeof value.targetPath === 'string'
	&& typeof value.writebackOperationId === 'string'
	&& typeof value.writebackIdempotencyKey === 'string'
	&& typeof value.stableBindingHash === 'string'
	&& typeof value.targetContentHashBefore === 'string'
	&& typeof value.targetResultContentHash === 'string';

const isTerminalItemResult = (value: unknown): value is WikiBatchTerminalItemResult =>
	isRecord(value)
	&& (value.status === 'verified' || value.status === 'conflict' || value.status === 'dependency_blocked')
	&& typeof value.proposalPath === 'string'
	&& typeof value.targetPath === 'string'
	&& (value.message === undefined || typeof value.message === 'string')
	&& (value.writebackOperationId === undefined || typeof value.writebackOperationId === 'string')
	&& (value.targetWritten === undefined || typeof value.targetWritten === 'boolean');

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

const previewTaskContext = (value: unknown): value is WikiReviewBatchPreviewV3['activityContext'] =>
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
	&& typeof value.expectedTaskContentHashBefore === 'string'
	&& typeof value.expectedTaskContentHashAfter === 'string'
	&& typeof value.previewNonce === 'string'
	&& /^[a-f0-9]{32}$/.test(value.previewNonce)
	&& value.activityPath === TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH
	&& Array.isArray(value.touchedNotes)
	&& value.touchedNotes.every((item) => typeof item === 'string')
	&& typeof value.effectiveRisk === 'string'
	&& typeof value.writebackPreview === 'string'
	&& (value.writebackEffect === undefined || isWritebackEffect(value.writebackEffect))
	&& typeof value.targetGroupId === 'string';

const isBatchOperationItem = (value: unknown): value is WikiReviewBatchOperationItem => {
	if (!isRecord(value) || typeof value.writebackPreviewHash !== 'string') return false;
	return isBatchPreviewItem({ ...value, writebackPreview: '' });
};

const isBatchTaskPlan = (value: unknown): value is WikiReviewBatchTaskPlan =>
	isRecord(value)
	&& typeof value.taskPath === 'string'
	&& typeof value.initialContentHash === 'string'
	&& typeof value.finalContentHash === 'string'
	&& Array.isArray(value.proposalPaths)
	&& value.proposalPaths.every((item) => typeof item === 'string');

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

const isBatchOperationTarget = (value: unknown): value is WikiReviewBatchOperationTarget => {
	if (!isRecord(value) || typeof value.writebackBlockHash !== 'string') return false;
	return isBatchTargetPlan({ ...value, writebackBlock: '' });
};

/**
 * 负责 Wiki 批次预检、认领、逐步写回和中断恢复。
 *
 * @description 批次层只认领操作日志，不持有 Obsidian 文件锁；文件锁由下层原子适配器独占。
 */
export class WikiReviewBatchApplication {
	private readonly transientConfirmations = new Map<string, { confirmation_token: string }>();

	constructor(
		private readonly app: App,
		private readonly records: ActivityRecordRepository,
		private readonly host: WikiReviewBatchHost,
		private readonly transitions: WikiReviewBatchTransitionOwner,
		private readonly operationIdFactory: () => string,
		private readonly nowFactory: () => Date = () => new Date(),
		private readonly failureInjection?: OperationFailureInjection
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
			taskContent: string;
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
				taskContent,
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
		const issuedAt = this.nowFactory();
		const operationId = `${WIKI_BATCH_OPERATION_PREFIX}${this.operationIdFactory().replace(/^review-/, '')}`;
		const idempotencyKey = `wiki-review-batch:${operationId}`;
		const taskChains = new Map<string, {
			initialContentHash: string;
			content: string;
			proposalPaths: string[];
		}>();
		const itemTaskPlans = new Map<string, {
			expectedBefore: string;
			expectedAfter: string;
			previewNonce: string;
		}>();
		for (const current of orderedRecords) {
			const target = itemTarget.get(current.path);
			if (!target) throw new Error(`Wiki target plan is missing: ${current.path}.`);
			const entry = targetEntries.get(target.targetPath)?.find((candidate) =>
				candidate.proposal.path === current.path
			);
			if (!entry) throw new Error(`Wiki task plan input is missing: ${current.path}.`);
			const previewNonce = hashVaultContent(
				`wiki-review-batch\0${operationId}\0${current.path}`
			).slice(0, 32);
			if (!entry.taskPath) {
				itemTaskPlans.set(current.path, {
					expectedBefore: '',
					expectedAfter: '',
					previewNonce,
				});
				continue;
			}
			const chain = taskChains.get(entry.taskPath) ?? {
				initialContentHash: entry.taskContentHash,
				content: entry.taskContent,
				proposalPaths: [],
			};
			const taskPlan = planApprovedWritebackTaskLink({
				taskContent: chain.content,
				targetPath: target.targetPath,
				proposalId: current.proposalId,
				proposalPath: current.path,
				usesStableProposalReferences: true,
				usesAppliedProposalEvidence: true,
			});
			itemTaskPlans.set(current.path, {
				expectedBefore: taskPlan.contentHashBefore,
				expectedAfter: taskPlan.contentHashAfter,
				previewNonce,
			});
			chain.content = taskPlan.content;
			chain.proposalPaths.push(current.path);
			taskChains.set(entry.taskPath, chain);
		}
		const items = orderedRecords.map((current): WikiReviewBatchPreviewItem => {
			const target = itemTarget.get(current.path);
			if (!target) throw new Error(`Wiki target plan is missing: ${current.path}.`);
			const taskPlan = itemTaskPlans.get(current.path);
			if (!taskPlan) throw new Error(`Wiki item task hash chain is missing: ${current.path}.`);
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
				expectedTaskContentHashBefore: taskPlan.expectedBefore,
				expectedTaskContentHashAfter: taskPlan.expectedAfter,
				previewNonce: taskPlan.previewNonce,
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

		const taskPlans: WikiReviewBatchTaskPlan[] = [...taskChains.entries()]
			.map(([taskPath, chain]) => ({
				taskPath,
				initialContentHash: chain.initialContentHash,
				finalContentHash: hashVaultContent(chain.content),
				proposalPaths: chain.proposalPaths,
			}))
			.sort((left, right) => left.taskPath.localeCompare(right.taskPath));
		const base = {
			schemaVersion: 3 as const,
			operationId,
			idempotencyKey,
			reviewBatchId: [...reviewBatchIds][0] || '',
			issuedAt: issuedAt.toISOString(),
			expiresAt: new Date(issuedAt.getTime() + WIKI_BATCH_PREVIEW_TTL_MS).toISOString(),
			items,
			targets: orderedTargets,
			taskPlans,
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
			finalize: async () => {
				const record = await baseJournal.loadById(payload.operationId);
				if (!record) throw new Error('Wiki batch operation disappeared before finalization.');
				return this.receiptFromCompletedRecord(payload, record);
			},
			failureInjection: this.failureInjection,
			clock: () => this.nowFactory().toISOString(),
		});
		try {
			const receipt = await runner.run();
			notifyProgress(onProgress, {
				phase: receipt.status === 'completed' ? 'completed' : 'conflict',
				completed: receipt.applied.length,
				total: payload.items.length,
				message: receipt.status === 'completed' ? 'Wiki 批次已完成' : 'Wiki 批次已完成可执行项',
			});
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
				return { status: 'approved', proposalPath: current.path };
			},
		}));

		const itemSteps = payload.items.flatMap((item, index) => [
			{
				name: stepName('prepare', index),
				persistResult: true,
				failureStatus: 'failed' as const,
				execute: async (_operationPayload: WikiReviewBatchOperationPayload, context: { completedSteps: readonly { name: string; result?: unknown }[] }) => {
					notifyProgress(onProgress, {
						phase: 'writing',
						completed: this.verifiedCount(context.completedSteps),
						total: payload.items.length,
						currentProposalPath: item.proposalPath,
						currentTargetPath: item.targetPath,
						message: '正在准备写入',
					});
					const blocked = this.dependencyBlockFor(payload, item, context.completedSteps);
					if (blocked) return blocked;
					try {
						const current = await this.readCurrentProposal(item.proposalPath);
						if (current.approvalStatus !== 'approved') {
							return this.conflictResult(item, `Proposal is not approved by this batch: ${item.proposalPath}.`);
						}
						const targetFile = this.app.vault.getAbstractFileByPath(item.targetPath);
						const targetContent = targetFile instanceof TFile ? await this.app.vault.read(targetFile) : '';
						const targetHash = targetFile instanceof TFile
							? hashVaultContent(targetContent)
							: targetFile ? `occupied:${item.targetPath}` : 'absent';
						if (targetHash !== item.targetContentHash && targetHash !== item.targetResultContentHash) {
							return this.conflictResult(item, `Wiki batch target changed: ${item.targetPath}.`);
						}
						const taskHash = item.taskPath ? await this.currentFileHash(item.taskPath, '') : '';
						if (taskHash !== item.expectedTaskContentHashBefore) {
							return this.conflictResult(item, `Wiki batch task changed before ${item.proposalPath}.`);
						}
						const override = await this.batchOverride(payload, item);
						const preview = await this.previewApprovedWriteback(current, override);
						if (
							preview.batch_task_content_hash_before !== item.expectedTaskContentHashBefore
							|| preview.batch_task_content_hash_after !== item.expectedTaskContentHashAfter
							|| preview.target_note !== item.targetPath
							|| !new Set([item.targetContentHash, item.targetResultContentHash]).has(preview.target_content_hash)
						) {
							return this.conflictResult(item, `Wiki batch item binding changed: ${item.proposalPath}.`);
						}
						this.transientConfirmations.set(preview.batch_writeback_operation_id, {
							confirmation_token: preview.confirmation_token,
						});
						return {
							status: 'prepared',
							proposalPath: item.proposalPath,
							targetPath: item.targetPath,
							writebackOperationId: preview.batch_writeback_operation_id,
							writebackIdempotencyKey: preview.batch_writeback_idempotency_key,
							stableBindingHash: preview.batch_stable_binding_hash,
							targetContentHashBefore: preview.target_content_hash,
							targetResultContentHash: this.plannedTargetResultHash(
								item,
								targetContent,
								preview.writeback_preview
							),
						} satisfies WikiBatchPreparedItem;
					} catch (error) {
						if (this.isContentConflict(error)) {
							return this.conflictResult(item, error instanceof Error ? error.message : String(error));
						}
						throw error;
					}
				},
			},
			{
				name: stepName('apply', index),
				persistResult: true,
				failureStatus: 'failed' as const,
				execute: async (_operationPayload: WikiReviewBatchOperationPayload, context: { completedSteps: readonly { name: string; result?: unknown }[] }) => {
					const preparedResult = this.stepResult(context.completedSteps, stepName('prepare', index));
					if (isTerminalItemResult(preparedResult)) return preparedResult;
					if (!isPreparedItem(preparedResult)) throw new Error(`Wiki batch prepare result is missing: ${item.proposalPath}.`);
					notifyProgress(onProgress, {
						phase: 'writing',
						completed: this.verifiedCount(context.completedSteps),
						total: payload.items.length,
						currentProposalPath: item.proposalPath,
						currentTargetPath: item.targetPath,
						message: '正在应用写入',
					});
					try {
						const current = await this.readCurrentProposal(item.proposalPath);
						const nestedRecord = await this.createJournal().loadById(preparedResult.writebackOperationId);
						if (current.approvalStatus === 'applied' && this.appliedOperationId(current) !== preparedResult.writebackOperationId) {
							return this.conflictResult(item, `Applied proposal belongs to another operation: ${item.proposalPath}.`);
						}
						if (nestedRecord) {
							if (
								nestedRecord.operation_id !== preparedResult.writebackOperationId
								|| nestedRecord.idempotency_key !== preparedResult.writebackIdempotencyKey
							) {
								return this.conflictResult(item, `Wiki writeback journal identity changed: ${item.proposalPath}.`);
							}
							const override = await this.batchOverride(payload, item);
							await this.applyApprovedWriteback(current, null, override, preparedResult.writebackOperationId);
						} else {
							if (current.approvalStatus !== 'approved') {
								return this.conflictResult(item, `Proposal is not ready for batch apply: ${item.proposalPath}.`);
							}
							const override = await this.batchOverride(payload, item);
							const cachedPreview = this.transientConfirmations.get(preparedResult.writebackOperationId);
							const preview = cachedPreview
								? { ...preparedResult, ...cachedPreview,
									batch_writeback_operation_id: preparedResult.writebackOperationId,
									batch_writeback_idempotency_key: preparedResult.writebackIdempotencyKey,
									batch_stable_binding_hash: preparedResult.stableBindingHash }
								: await this.previewApprovedWriteback(current, override);
							if (
								preview.batch_writeback_operation_id !== preparedResult.writebackOperationId
								|| preview.batch_writeback_idempotency_key !== preparedResult.writebackIdempotencyKey
								|| preview.batch_stable_binding_hash !== preparedResult.stableBindingHash
							) {
								return this.conflictResult(item, `Wiki batch binding changed after prepare: ${item.proposalPath}.`);
							}
							await this.applyApprovedWriteback(current, preview, override);
							this.transientConfirmations.delete(preparedResult.writebackOperationId);
						}
						return { ...preparedResult, status: 'applied_pending_verify' } satisfies WikiBatchAppliedItem;
					} catch (error) {
						if (this.isContentConflict(error)) {
							return this.conflictResult(item, error instanceof Error ? error.message : String(error));
						}
						throw error;
					}
				},
			},
			{
				name: stepName('verify', index),
				persistResult: true,
				failureStatus: 'failed' as const,
				execute: async (_operationPayload: WikiReviewBatchOperationPayload, context: { completedSteps: readonly { name: string; result?: unknown }[] }) => {
					const applyResult = this.stepResult(context.completedSteps, stepName('apply', index));
					if (isTerminalItemResult(applyResult)) return applyResult;
					const preparedResult = this.stepResult(context.completedSteps, stepName('prepare', index));
					if (!isPreparedItem(preparedResult) || !isRecord(applyResult) || applyResult.status !== 'applied_pending_verify') {
						throw new Error(`Wiki batch apply result is missing: ${item.proposalPath}.`);
					}
					const current = await this.readCurrentProposal(item.proposalPath);
					const targetHash = await this.currentFileHash(item.targetPath, 'absent');
					const taskHash = item.taskPath ? await this.currentFileHash(item.taskPath, '') : '';
					const nestedRecord = await this.createJournal().loadById(preparedResult.writebackOperationId);
					if (
						current.approvalStatus !== 'applied'
						|| this.appliedOperationId(current) !== preparedResult.writebackOperationId
						|| nestedRecord?.status !== 'completed'
						|| targetHash !== preparedResult.targetResultContentHash
						|| taskHash !== item.expectedTaskContentHashAfter
					) {
						return this.conflictResult(item, `Wiki batch verification failed: ${item.proposalPath}.`);
					}
					return {
						status: 'verified',
						proposalPath: item.proposalPath,
						targetPath: item.targetPath,
						writebackOperationId: preparedResult.writebackOperationId,
						targetWritten: preparedResult.targetContentHashBefore !== preparedResult.targetResultContentHash,
					} satisfies WikiBatchTerminalItemResult;
				},
			},
		]);

		return [
			...approvalSteps,
			...itemSteps,
			{
				name: WIKI_BATCH_ACTIVITY_STEP,
				persistResult: true,
				failureStatus: 'activity_pending' as const,
					execute: async (_operationPayload: WikiReviewBatchOperationPayload, context: { completedSteps: readonly { name: string; result?: unknown }[] }) => {
						const outcomes = this.terminalResults(payload, context.completedSteps);
						const applied = outcomes.filter((result) => result.status === 'verified');
						const conflicts = outcomes.filter((result) => result.status === 'conflict');
						const blocked = outcomes.filter((result) => result.status === 'dependency_blocked');
						notifyProgress(onProgress, { phase: 'finalizing', completed: applied.length, total: payload.items.length, message: '正在记录批次结果' });
						await this.host.appendWikiBatchActivity(
							payload.operationId,
							`## ${this.nowFactory().toISOString()}\n` +
							`type: native-audit-event\n` +
							`event: wiki.review_batch\n` +
							`action: wiki.review_batch\n` +
							`actor: user\n` +
							`operation_id: ${payload.operationId}\n` +
							`approved_count: ${payload.items.length}\n` +
							`applied_count: ${applied.length}\n` +
							`target_paths: ${uniqueSorted(applied.map((result) => result.targetPath)).join(', ')}\n` +
							`result_summary: batch=${payload.reviewBatchId}; conflicts=${conflicts.length}; dependency_blocked=${blocked.length}\n` +
							`result: ${conflicts.length > 0 || blocked.length > 0 ? 'partial' : 'success'}\n\n`
						);
						return { status: 'recorded', applied: applied.length, conflicts: conflicts.length, dependencyBlocked: blocked.length };
					},
			},
		];
	}

	private progressFromRecord(
		payload: WikiReviewBatchOperationPayload,
		record: OperationRecord
	): WikiReviewBatchProgress {
		const completed = this.verifiedCount(record.completed_steps);
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
		const outcomes = this.terminalResults(payload, record.completed_steps);
		const applied = outcomes.filter((result) => result.status === 'verified').map((result) => result.proposalPath);
		const pending = payload.items
			.filter((_item, index) => !completed.has(stepName('verify', index)))
			.map((item) => item.proposalPath);
		const message = record.error || (error instanceof Error ? error.message : String(error));
		const failedIndex = payload.items.findIndex((_item, index) => completed.has(stepName('approve', index)) && !completed.has(stepName('verify', index)));
		const failedItem = failedIndex >= 0 ? payload.items[failedIndex] : payload.items[applied.length];
		return {
			schemaVersion: 3 as const,
			operationId: payload.operationId,
			reviewBatchId: payload.reviewBatchId,
			status: applied.length > 0 ? 'partial' : 'conflict',
			approved,
			applied,
			pending,
			conflicts: failedItem
				? [{ proposalPath: failedItem.proposalPath, targetPath: failedItem.targetPath, message }]
				: [],
			dependencyBlocked: [],
			targetWrites: payload.targets
			.filter((target) => target.proposalPaths.some((proposalPath) => applied.includes(proposalPath)))
			.map((target) => target.targetPath),
			resumable: record.status !== 'conflicted' && record.status !== 'completed',
			completedAt: record.status === 'completed' ? record.updated_at : null,
		};
	}

	private payloadFromPreview(preview: WikiReviewBatchPreview): WikiReviewBatchOperationPayload {
		const base = {
			schemaVersion: 3 as const,
			operationId: preview.operationId,
			idempotencyKey: preview.idempotencyKey,
			reviewBatchId: preview.reviewBatchId,
			issuedAt: preview.issuedAt,
			expiresAt: preview.expiresAt,
			previewManifestHash: preview.manifestHash,
			items: preview.items.map(({ writebackPreview, ...item }) => ({
				...item,
				writebackPreviewHash: hashVaultContent(writebackPreview),
			})),
			targets: preview.targets.map(({ writebackBlock, ...target }) => ({
				...target,
				writebackBlockHash: hashVaultContent(writebackBlock),
			})),
			taskPlans: preview.taskPlans,
			executionOrder: preview.executionOrder,
			activityContext: preview.activityContext,
		};
		return { ...base, manifestHash: computePayloadHash(base) };
	}

	private parsePayload(value: Record<string, unknown>): WikiReviewBatchOperationPayload {
		if (value.schemaVersion === 2) {
			throw new Error('Wiki batch v2 cannot be resumed safely; close it and generate a fresh v3 preview.');
		}
		if (
			value.schemaVersion !== 3
			|| !asString(value.operationId).startsWith(WIKI_BATCH_OPERATION_PREFIX)
			|| !asString(value.idempotencyKey)
			|| !asString(value.reviewBatchId)
			|| !asString(value.issuedAt)
			|| !asString(value.expiresAt)
			|| !asString(value.previewManifestHash)
			|| !asString(value.manifestHash)
			|| !Array.isArray(value.items)
			|| !Array.isArray(value.targets)
			|| !Array.isArray(value.taskPlans)
			|| !Array.isArray(value.executionOrder)
			|| !value.executionOrder.every((item) => typeof item === 'string')
			|| !previewTaskContext(value.activityContext)
			|| value.items.length === 0
			|| value.items.length > WIKI_REVIEW_BATCH_MAX_ITEMS
			|| value.targets.length === 0
			|| !value.items.every(isBatchOperationItem)
			|| !value.targets.every(isBatchOperationTarget)
			|| !value.taskPlans.every(isBatchTaskPlan)
		) {
			throw new Error('Wiki batch operation payload is invalid.');
		}
		const payload: WikiReviewBatchOperationPayload = {
			schemaVersion: 3,
			operationId: asString(value.operationId),
			idempotencyKey: asString(value.idempotencyKey),
			reviewBatchId: asString(value.reviewBatchId),
			issuedAt: asString(value.issuedAt),
			expiresAt: asString(value.expiresAt),
			previewManifestHash: asString(value.previewManifestHash),
			manifestHash: asString(value.manifestHash),
			items: value.items as WikiReviewBatchOperationItem[],
			targets: value.targets as WikiReviewBatchOperationTarget[],
			taskPlans: value.taskPlans as WikiReviewBatchTaskPlan[],
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
			|| !this.validTaskHashChains(payload)
			|| !/^[a-f0-9]{64}$/.test(payload.previewManifestHash)
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
		const validShape = preview.schemaVersion === 3
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
			&& Array.isArray(preview.taskPlans)
			&& preview.taskPlans.every(isBatchTaskPlan)
			&& new Set(preview.targets.map((target) => target.targetPath)).size === preview.targets.length
			&& Array.isArray(preview.executionOrder)
			&& preview.executionOrder.length === preview.targets.length
			&& new Set(preview.executionOrder).size === preview.executionOrder.length
			&& targetGroups.size === preview.targets.length
			&& preview.executionOrder.every((groupId) => targetGroups.has(groupId))
			&& preview.items.every((item) => targetGroups.has(item.targetGroupId))
			&& preview.items.every((item) => buildWikiReviewBatchId(item.taskId, item.proposalId) === preview.reviewBatchId)
			&& this.validTaskHashChains(this.payloadFromPreview(preview))
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
		for (const taskPlan of preview.taskPlans) {
			if (await this.currentFileHash(taskPlan.taskPath, '') !== taskPlan.initialContentHash) {
				throw new Error(`Wiki batch task changed before the first write: ${taskPlan.taskPath}.`);
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
		writeback_preview: string;
		writeback_effect: string;
		confirmation_token: string;
		batch_writeback_operation_id: string;
		batch_writeback_idempotency_key: string;
		batch_stable_binding_hash: string;
		batch_task_content_hash_before: string;
		batch_task_content_hash_after: string;
	}> {
		const result = await this.host.previewWikiBatchApprovedWriteback(
			{ proposal_path: proposal.path, dry_run: true, ...(proposal.taskId ? { task_id: proposal.taskId } : {}) },
			override as NonNullable<LocalToolExecutionOptions['wikiBatchWritebackOverride']>
		);
		if (
			!isRecord(result)
			|| typeof result.proposal_id !== 'string'
			|| typeof result.proposal_path !== 'string'
			|| typeof result.target_note !== 'string'
			|| typeof result.target_content_hash !== 'string'
			|| typeof result.writeback_preview !== 'string'
			|| typeof result.writeback_effect !== 'string'
			|| typeof result.confirmation_token !== 'string'
			|| typeof result.batch_writeback_operation_id !== 'string'
			|| typeof result.batch_writeback_idempotency_key !== 'string'
			|| typeof result.batch_stable_binding_hash !== 'string'
			|| typeof result.batch_task_content_hash_before !== 'string'
			|| typeof result.batch_task_content_hash_after !== 'string'
		) {
			throw new Error('Approved writeback confirmation preview returned an invalid result.');
		}
		return result as {
			proposal_id: string;
			proposal_path: string;
			target_note: string;
			target_content_hash: string;
			writeback_preview: string;
			writeback_effect: string;
			confirmation_token: string;
			batch_writeback_operation_id: string;
			batch_writeback_idempotency_key: string;
			batch_stable_binding_hash: string;
			batch_task_content_hash_before: string;
			batch_task_content_hash_after: string;
		};
	}

	private async applyApprovedWriteback(
		proposal: MemoryProposalRecord,
		preview: { confirmation_token: string } | null,
		override: NonNullable<LocalToolExecutionOptions['wikiBatchWritebackOverride']>,
		recoveryOperationId = ''
	): Promise<Record<string, unknown>> {
		return this.host.executeLocalTool(
			'tracekeeper.apply_approved_writeback',
			{
				proposal_path: proposal.path,
				...(preview ? { confirmation_token: preview.confirmation_token } : {}),
				...(proposal.taskId ? { task_id: proposal.taskId } : {}),
			},
			{
				wikiBatchWritebackOverride: override,
				...(recoveryOperationId ? { writebackRecoveryOperationId: recoveryOperationId } : {}),
			}
		);
	}

	private async batchOverride(
		payload: WikiReviewBatchOperationPayload,
		item: WikiReviewBatchOperationItem
	): Promise<NonNullable<LocalToolExecutionOptions['wikiBatchWritebackOverride']>> {
		const targetPlan = payload.targets.find((target) => target.targetGroupId === item.targetGroupId);
		if (!targetPlan) throw new WikiBatchTerminalConflictError(`Wiki target plan is missing: ${item.targetPath}.`);
		let writebackBlock = '';
		if (item.writebackEffect === 'update_managed_relations') {
			const targetFile = this.app.vault.getAbstractFileByPath(item.targetPath);
			if (!(targetFile instanceof TFile)) {
				throw new WikiBatchTerminalConflictError(`Managed relation target is unavailable: ${item.targetPath}.`);
			}
			const targetContent = await this.app.vault.read(targetFile);
			const proposalBlocks: string[] = [];
			for (const proposalPath of targetPlan.proposalPaths) {
				proposalBlocks.push((await this.readCurrentProposal(proposalPath)).writebackContent);
			}
			writebackBlock = mergeManagedWikiRelationsBlocks(targetContent, proposalBlocks);
		} else {
			writebackBlock = (await this.readCurrentProposal(item.proposalPath)).writebackContent;
		}
		if (
			hashVaultContent(writebackBlock) !== item.writebackPreviewHash
			|| hashVaultContent(writebackBlock) !== targetPlan.writebackBlockHash
		) {
			throw new WikiBatchTerminalConflictError(`Wiki batch writeback plan changed: ${item.proposalPath}.`);
		}
		return {
			proposalPath: item.proposalPath,
			targetPath: item.targetPath,
			writebackBlock,
			batchOperationId: payload.operationId,
			previewNonce: item.previewNonce,
			suppressAgentActivity: true,
		};
	}

	private async currentFileHash(relativePath: string, absentHash: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(relativePath);
		if (!file) return absentHash;
		if (!(file instanceof TFile)) return `occupied:${relativePath}`;
		return hashVaultContent(await this.app.vault.read(file));
	}

	private plannedTargetResultHash(
		item: Pick<WikiReviewBatchPreviewItem, 'writebackEffect'>,
		currentContent: string,
		preparedWritebackBlock: string
	): string {
		if (item.writebackEffect === 'create_wiki_note') {
			return hashVaultContent(preparedWritebackBlock);
		}
		if (item.writebackEffect === 'update_managed_relations') {
			return hashVaultContent(applyManagedRelationsBlock(currentContent, preparedWritebackBlock));
		}
		return hashVaultContent(`${currentContent}\n\n${preparedWritebackBlock}\n`);
	}

	private appliedOperationId(proposal: MemoryProposalRecord): string {
		return proposal.writebackOperationId || (
			proposal.lastTransition?.kind === 'apply' ? proposal.lastTransition.operationId : ''
		);
	}

	private stepResult(
		steps: readonly { name: string; result?: unknown }[],
		name: string
	): unknown {
		return steps.find((step) => step.name === name)?.result;
	}

	private verifiedCount(steps: readonly { name: string; result?: unknown }[]): number {
		return steps.filter((step) => step.name.startsWith('verify-') && isTerminalItemResult(step.result) && step.result.status === 'verified').length;
	}

	private terminalResults(
		payload: WikiReviewBatchOperationPayload,
		steps: readonly { name: string; result?: unknown }[]
	): WikiBatchTerminalItemResult[] {
		return payload.items.flatMap((_item, index) => {
			const result = this.stepResult(steps, stepName('verify', index));
			return isTerminalItemResult(result) ? [result] : [];
		});
	}

	private conflictResult(
		item: Pick<WikiReviewBatchPreviewItem, 'proposalPath' | 'targetPath'>,
		message: string
	): WikiBatchTerminalItemResult {
		return {
			status: 'conflict',
			proposalPath: item.proposalPath,
			targetPath: item.targetPath,
			message,
		};
	}

	private dependencyBlockFor(
		payload: WikiReviewBatchOperationPayload,
		item: WikiReviewBatchOperationItem,
		steps: readonly { name: string; result?: unknown }[]
	): WikiBatchTerminalItemResult | null {
		const outcomes = this.terminalResults(payload, steps);
		const target = payload.targets.find((candidate) => candidate.targetGroupId === item.targetGroupId);
		const failedTargets = new Set(
			outcomes
				.filter((result) => result.status !== 'verified')
				.map((result) => result.targetPath)
		);
		const earlierSameTaskFailed = payload.items.some((candidate, index) => {
			const currentIndex = payload.items.indexOf(item);
			if (index >= currentIndex || !item.taskPath || candidate.taskPath !== item.taskPath) return false;
			const result = this.stepResult(steps, stepName('verify', index));
			return isTerminalItemResult(result) && result.status !== 'verified';
		});
		if (
			failedTargets.has(item.targetPath)
			|| target?.dependencies.some((dependency) => failedTargets.has(dependency))
			|| earlierSameTaskFailed
		) {
			return {
				status: 'dependency_blocked',
				proposalPath: item.proposalPath,
				targetPath: item.targetPath,
				message: `Wiki batch dependency was not verified before ${item.proposalPath}.`,
			};
		}
		return null;
	}

	private isContentConflict(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error);
		return /\b(changed|stale|conflict|occupied|unavailable|not approved|not ready)\b/i.test(message);
	}

	private validTaskHashChains(payload: WikiReviewBatchOperationPayload): boolean {
		const plansByPath = new Map(payload.taskPlans.map((plan) => [plan.taskPath, plan]));
		if (plansByPath.size !== payload.taskPlans.length) return false;
		for (const item of payload.items) {
			if (!item.taskPath) {
				if (item.expectedTaskContentHashBefore || item.expectedTaskContentHashAfter) return false;
				continue;
			}
			if (!plansByPath.has(item.taskPath)) return false;
		}
		for (const plan of payload.taskPlans) {
			const items = payload.items.filter((item) => item.taskPath === plan.taskPath);
			if (
				items.length === 0
				|| computePayloadHash(items.map((item) => item.proposalPath)) !== computePayloadHash(plan.proposalPaths)
				|| items[0]?.expectedTaskContentHashBefore !== plan.initialContentHash
				|| items[items.length - 1]?.expectedTaskContentHashAfter !== plan.finalContentHash
			) return false;
			for (let index = 1; index < items.length; index += 1) {
				if (items[index - 1]?.expectedTaskContentHashAfter !== items[index]?.expectedTaskContentHashBefore) return false;
			}
		}
		return true;
	}

	private receiptFromCompletedRecord(
		payload: WikiReviewBatchOperationPayload,
		record: OperationRecord
	): WikiReviewBatchReceipt {
		const outcomes = this.terminalResults(payload, record.completed_steps);
		const approved = payload.items.map((item) => item.proposalPath);
		const applied = outcomes.filter((result) => result.status === 'verified').map((result) => result.proposalPath);
		const conflicts = outcomes
			.filter((result) => result.status === 'conflict')
			.map((result) => ({ proposalPath: result.proposalPath, targetPath: result.targetPath, message: result.message || 'Content conflict' }));
		const dependencyBlocked = outcomes
			.filter((result) => result.status === 'dependency_blocked')
			.map((result) => ({ proposalPath: result.proposalPath, targetPath: result.targetPath, message: result.message || 'Dependency blocked' }));
		return {
			schemaVersion: 3,
			operationId: payload.operationId,
			reviewBatchId: payload.reviewBatchId,
			status: conflicts.length === 0 && dependencyBlocked.length === 0
				? 'completed'
				: applied.length > 0 ? 'partial' : 'conflict',
			approved,
			applied,
			pending: [],
			conflicts,
			dependencyBlocked,
			targetWrites: uniqueSorted(outcomes.filter((result) => result.status === 'verified' && result.targetWritten).map((result) => result.targetPath)),
			resumable: false,
			completedAt: this.nowFactory().toISOString(),
		};
	}
}

const previewWithoutToken = (
	preview: WikiReviewBatchPreview
): Omit<WikiReviewBatchPreviewV3, 'confirmationToken'> => {
	const { confirmationToken: _token, ...unsigned } = preview;
	return unsigned;
};

const previewWithoutManifest = (
	preview: WikiReviewBatchPreview
): Omit<WikiReviewBatchPreviewV3, 'confirmationToken' | 'manifestHash'> => {
	const {
		confirmationToken: _token,
		manifestHash: _manifest,
		...base
	} = preview;
	return base;
};
