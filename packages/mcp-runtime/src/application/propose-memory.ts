import {
	computePayloadHash,
	buildStableProposalId,
	buildGlobalMemoryEntryPath,
	buildProjectMemoryEntryPath,
	deriveProjectMemoryHubBindingFromRepoPath,
	isKnowledgeWikiPath,
	isSourcePartPath,
	normalizeProjectAgentType,
	OperationConflictError,
	RecoverableOperationRunner,
	WIKI_PROPOSAL_SCHEMA_VERSION,
	buildWikiReviewBatchId,
	computeWikiEffectiveRisk,
	parseManagedRelationsBlock,
	renderManagedRelationsBlock,
	renderProposalWritebackSection,
	type WikiChangeRule,
	type WikiEffectiveRisk,
	type WikiRole,
	type OperationFailureInjection,
	type OperationJournal,
} from '@tracekeeper/core';

export type ProposeMemoryScope = 'global' | 'project';
export type ProposeMemoryRule = 'review_queue' | 'auto_write' | 'disabled';
export type ProposeMemoryAgentType = string;

export interface ProposeMemoryRawRequest {
	proposal_kind?: unknown;
	content?: unknown;
	evidence?: unknown;
	target_note?: unknown;
	risk_level?: unknown;
	task_id?: unknown;
	filename?: unknown;
	title?: unknown;
	project_hint?: unknown;
	project_id?: unknown;
	repo_path?: unknown;
	repo?: unknown;
	project_path?: unknown;
	memory_scope?: unknown;
	related_wiki?: unknown;
	related_sources?: unknown;
	wiki_role?: unknown;
	parent_wiki?: unknown;
	claim_key?: unknown;
	proposed_authority?: unknown;
	proposed_confidence?: unknown;
	declared_state?: unknown;
	observed_at?: unknown;
	valid_from?: unknown;
	valid_to?: unknown;
	last_verified_at?: unknown;
	supersedes?: unknown;
	contradicts?: unknown;
	idempotency_key?: unknown;
}

export interface ProposeMemoryRequestSnapshot {
	proposal_kind: string;
	content: string;
	evidence: string[];
	target_note: string | null;
	risk_level: string | null;
	task_id: string | null;
	filename: string | null;
	title: string | null;
	project_hint: string | null;
	project_id: string | null;
	repo_path: string | null;
	repo: string | null;
	project_path: string | null;
	memory_scope: string | null;
	related_wiki: string[];
	related_sources: string[];
	wiki_role: WikiRole | null;
	parent_wiki: string | null;
	claim_key: string | null;
	proposed_authority: string | null;
	proposed_confidence: string | null;
	declared_state: string | null;
	observed_at: string | null;
	valid_from: string | null;
	valid_to: string | null;
	last_verified_at: string | null;
	supersedes: string[];
	contradicts: string[];
}

interface ProposeMemoryOperationPayload {
	requestHash: string;
	requestSnapshot: ProposeMemoryRequestSnapshot;
	writebackEffect?: 'append' | 'create_wiki_note' | 'create_memory_record' | 'update_managed_relations';
	memoryRecordWriteVersion?: 2;
	memoryRule?: ProposeMemoryRule;
	wikiRule?: WikiChangeRule;
	effectiveRisk?: WikiEffectiveRisk;
	expectedManagedRelationsHash?: string;
	resolvedWikiParent?: string | null;
	resolvedWikiRelated?: string[];
	resolvedWikiSources?: string[];
	unresolvedWikiRelations?: string[];
	missingWikiRelations?: string[];
	missingSourceRelations?: string[];
	policyOutcome?: 'disabled';
	projectMemoryCreatedAt: string;
	projectMemoryAgentType: ProposeMemoryAgentType;
}

type ProposeMemoryWritebackEffect = 'append' | 'create_wiki_note' | 'create_memory_record' | 'update_managed_relations';

export interface ProposeMemoryArchitectureStatus {
	architecture_status: 'healthy' | 'needs_attention';
	missing_graph_bridges: string[];
}

export interface ProposeMemoryBridgeMetadata {
	missing_wiki_bridge: boolean;
	related_wiki: string[];
	missing_related_wiki: string[];
	related_sources: string[];
	missing_related_sources: string[];
}

export interface ProposeMemoryProjectIdentity {
	projectHint: string;
	projectId: string;
	repoPath: string;
	confidence: string;
}

export interface ProposeMemoryNote {
	path: string;
	activity_path: string;
	status: string;
	warnings: string[];
	duplicate?: boolean;
}

export interface ProposeMemoryImmutableWriteInput {
	scope: ProposeMemoryScope;
	projectId?: unknown;
	projectHint?: unknown;
	repoPath?: unknown;
	agentType?: unknown;
	taskId: string | null;
	operationId: string;
	operationKind: 'propose_memory';
	memoryKinds: string[];
	body: string;
	relatedWiki: string[];
	relatedSources: string[];
	claimKey?: string;
	proposedAuthority?: 'agent' | 'source' | 'user';
	proposedConfidence?: 'uncertain' | 'inferred' | 'supported' | 'verified';
	declaredState?: 'active' | 'disputed' | 'retracted' | 'review';
	observedAt?: string;
	validFrom?: string | null;
	validTo?: string | null;
	lastVerifiedAt?: string | null;
	evidence?: string[];
	supersedes?: string[];
	contradicts?: string[];
	createdAt: string;
}

export type ProposeMemoryImmutableWriteResult =
	| {
		status: 'review_required';
		reason: string;
		warnings: readonly string[];
	}
	| {
		status: 'created' | 'exact_retry';
		path: string;
		activity_path: string;
		project_id: string | null;
		project_hub: string | null;
		global_hub: string | null;
		agent_type: string;
		operation_hash: string;
		hub_status: string;
		memory_id: string;
		claim_key: string;
		authority: 'agent' | 'source';
		confidence_level: 'uncertain' | 'inferred' | 'supported';
		effective_state: 'current';
		write_status: 'written' | 'skipped';
		duplicate: boolean;
	};

export interface ProposeMemoryAutoWriteInput {
	proposalKind: string;
	targetNote: string;
	allowedDir: string;
	title: string;
	content: string;
	operationId: string;
	taskId: string | null;
	memoryScope: ProposeMemoryScope;
	projectHint: string;
	relatedWiki: string[];
	relatedSources: string[];
	architectureStatus: ProposeMemoryArchitectureStatus;
	missingGraphBridges: string[];
	missingWikiBridge: boolean;
	missingRelatedWiki: string[];
	missingRelatedSources: string[];
	evidence: string;
	riskLevel: string;
}

export interface ProposeMemoryWriteInput {
	filename: string;
	frontmatter: Record<string, unknown>;
	body: string;
	taskId: string | null;
	metadata: Record<string, unknown>;
	operationId: string;
}

export interface ProposeMemoryAutoWikiWriteInput {
	targetNote: string;
	content: string;
	taskId: string | null;
	operationId: string;
	proposalKind: string;
	reviewBatchId: string;
	effect: 'create_wiki_note' | 'update_managed_relations';
	expectedManagedRelationsHash?: string;
}

export interface ProposeMemoryApplicationDependencies {
	journal: OperationJournal;
	failureInjection?: OperationFailureInjection;
	createIdentity(
		requestHash: string,
		idempotencyKey: string
	): { operationId: string; idempotencyKey: string };
	observedAgentType: ProposeMemoryAgentType;
	now(): string;
	buildFilename(rawFilename: string | null, fallbackPrefix: string): string;
	resolveMemoryScope(
		proposalKind: string,
		targetNote: string,
		projectHint: string,
		memoryScope: string | null
	): ProposeMemoryScope;
	buildArchitectureStatus(): ProposeMemoryArchitectureStatus;
	resolveBridgeMetadata(
		memoryScope: ProposeMemoryScope,
		projectHint: string,
		relatedWiki: string[],
		relatedSources: string[],
		taskId?: string | null
	): ProposeMemoryBridgeMetadata;
	resolveProjectIdentity(snapshot: ProposeMemoryRequestSnapshot): ProposeMemoryProjectIdentity | null;
	assertAllowed(
		proposalKind: string,
		targetNote: string,
		projectHint: string,
		memoryScope: ProposeMemoryScope
	): void;
	memoryRule(
		proposalKind: string,
		targetNote: string,
		projectHint: string,
		memoryScope: ProposeMemoryScope
	): ProposeMemoryRule;
	wikiRule?(): WikiChangeRule;
	writeImmutableMemoryRecord(
		input: ProposeMemoryImmutableWriteInput
	): Promise<ProposeMemoryImmutableWriteResult>;
	resolveMemoryRecordTarget?(input: {
		scope: ProposeMemoryScope;
		projectId?: unknown;
		projectHint?: unknown;
		repoPath?: unknown;
		agentType: ProposeMemoryAgentType;
		operationId: string;
	}): Promise<string | null>;
	findOwnedProposalNote(filename: string, operationId: string): Promise<ProposeMemoryNote | null>;
	writeProposalNote(input: ProposeMemoryWriteInput): Promise<ProposeMemoryNote>;
	writeAutoWiki?(input: ProposeMemoryAutoWikiWriteInput): Promise<ProposeMemoryNote>;
	ensureOwnedProposalIdentity(
		path: string,
		proposalId: string,
		operationId: string
	): Promise<void>;
	updateTaskMemoryWrite(taskId: string | null, path: string): Promise<void>;
	updateTaskProposalReference(
		taskId: string,
		proposal: { proposalId: string; path: string; linkTarget: string }
	): Promise<void>;
	assertSafeText(values: Array<{ label: string; value: string }>): void;
	renderText(zh: string, en: string): string;
	isTargetNoteMissing?(targetNote: string): Promise<boolean>;
	readTargetNote?(targetNote: string): Promise<string | null>;
}

export interface ProposeMemoryApplicationRequest {
	rawArgs: ProposeMemoryRawRequest;
}

function optionalString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function requiredString(value: unknown, field: string): string {
	const normalized = optionalString(value);
	if (!normalized) {
		throw new Error(`Missing required string argument: ${field}.`);
	}
	return normalized;
}

function optionalEnum<T extends string>(
	value: unknown,
	field: string,
	allowed: readonly T[]
): T | null {
	const normalized = optionalString(value).toLowerCase();
	if (!normalized) return null;
	if (!allowed.includes(normalized as T)) {
		throw new Error(`${field} must be one of: ${allowed.join(', ')}.`);
	}
	return normalized as T;
}

function optionalTimestamp(value: unknown, field: string): string | null {
	const normalized = optionalString(value);
	if (!normalized) return null;
	if (Number.isNaN(Date.parse(normalized))) {
		throw new Error(`${field} must be a valid timestamp.`);
	}
	return new Date(normalized).toISOString();
}

function stringArray(value: unknown, field: string): string[] {
	if (value === undefined || value === null) {
		return [];
	}
	if (typeof value === 'string') {
		const normalized = value.trim();
		return normalized ? [normalized] : [];
	}
	if (Array.isArray(value)) {
		if (value.some((entry) => typeof entry !== 'string')) {
			throw new Error(`${field} array must contain only strings.`);
		}
		return value.map((entry) => (entry as string).trim()).filter(Boolean);
	}
	throw new Error(`${field} must be a string or string array.`);
}

function dedupeList(values: string[]): string[] {
	return [...new Set(
		values
			.map((value) => value.trim())
			.filter(Boolean)
			.map((value) => value.replace(/\s+/g, ' '))
			.sort((left, right) => left.localeCompare(right))
	)];
}

function normalizeMultiValueList(value: unknown, field: string): string[] {
	const normalized: string[] = [];
	for (const entry of stringArray(value, field)) {
		normalized.push(...entry.split(/[\n,]/g).map((item) => item.trim()).filter(Boolean));
	}
	return dedupeList(normalized);
}

function normalizeEvidence(value: unknown): string[] {
	return dedupeList(stringArray(value, 'evidence'));
}

function requestSnapshot(rawArgs: ProposeMemoryRawRequest): ProposeMemoryRequestSnapshot {
	return {
		proposal_kind: requiredString(rawArgs.proposal_kind, 'proposal_kind'),
		content: requiredString(rawArgs.content, 'content'),
		evidence: normalizeEvidence(rawArgs.evidence),
		target_note: optionalString(rawArgs.target_note) || null,
		risk_level: optionalString(rawArgs.risk_level) || null,
		task_id: optionalString(rawArgs.task_id) || null,
		filename: optionalString(rawArgs.filename) || null,
		title: optionalString(rawArgs.title) || null,
		project_hint: optionalString(rawArgs.project_hint) || null,
		project_id: optionalString(rawArgs.project_id) || null,
		repo_path: optionalString(rawArgs.repo_path) || null,
		repo: optionalString(rawArgs.repo) || null,
		project_path: optionalString(rawArgs.project_path) || null,
		memory_scope: optionalString(rawArgs.memory_scope) || null,
		related_wiki: normalizeMultiValueList(rawArgs.related_wiki, 'related_wiki'),
		related_sources: normalizeMultiValueList(rawArgs.related_sources, 'related_sources'),
		wiki_role: optionalEnum(rawArgs.wiki_role, 'wiki_role', ['topic', 'topic_map']),
		parent_wiki: optionalString(rawArgs.parent_wiki) || null,
		claim_key: optionalString(rawArgs.claim_key) || null,
		proposed_authority: optionalEnum(rawArgs.proposed_authority, 'proposed_authority', ['agent', 'source', 'user']),
		proposed_confidence: optionalEnum(rawArgs.proposed_confidence, 'proposed_confidence', ['uncertain', 'inferred', 'supported', 'verified']),
		declared_state: optionalEnum(rawArgs.declared_state, 'declared_state', ['active', 'disputed', 'retracted', 'review']),
		observed_at: optionalTimestamp(rawArgs.observed_at, 'observed_at'),
		valid_from: optionalTimestamp(rawArgs.valid_from, 'valid_from'),
		valid_to: optionalTimestamp(rawArgs.valid_to, 'valid_to'),
		last_verified_at: optionalTimestamp(rawArgs.last_verified_at, 'last_verified_at'),
		supersedes: normalizeMultiValueList(rawArgs.supersedes, 'supersedes'),
		contradicts: normalizeMultiValueList(rawArgs.contradicts, 'contradicts'),
	};
}

function validOperationPayload(payload: unknown): payload is ProposeMemoryOperationPayload {
	if (!payload || typeof payload !== 'object') {
		return false;
	}
	const value = payload as Record<string, unknown>;
	const snapshot = value.requestSnapshot;
	if (!snapshot || typeof snapshot !== 'object') {
		return false;
	}
	const request = snapshot as Record<string, unknown>;
	return typeof value.requestHash === 'string'
		&& value.requestHash.length > 0
		&& (value.memoryRecordWriteVersion === undefined || value.memoryRecordWriteVersion === 2)
		&& (value.memoryRule === undefined
			|| value.memoryRule === 'review_queue'
			|| value.memoryRule === 'auto_write'
			|| value.memoryRule === 'disabled')
		&& (value.policyOutcome === undefined || value.policyOutcome === 'disabled')
		&& (value.writebackEffect === undefined
			|| value.writebackEffect === 'append'
			|| value.writebackEffect === 'create_wiki_note'
			|| value.writebackEffect === 'create_memory_record'
			|| value.writebackEffect === 'update_managed_relations')
		&& typeof request.proposal_kind === 'string'
		&& request.proposal_kind.length > 0
		&& typeof request.content === 'string'
		&& request.content.length > 0
		&& Array.isArray(request.related_wiki)
		&& request.related_wiki.every((entry) => typeof entry === 'string')
		&& Array.isArray(request.related_sources)
		&& request.related_sources.every((entry) => typeof entry === 'string')
		&& (request.wiki_role === null || request.wiki_role === 'topic' || request.wiki_role === 'topic_map')
		&& (request.parent_wiki === null || typeof request.parent_wiki === 'string')
		&& (value.wikiRule === undefined
			|| value.wikiRule === 'review_each'
			|| value.wikiRule === 'review_batch'
			|| value.wikiRule === 'auto_managed'
			|| value.wikiRule === 'disabled')
			&& (value.effectiveRisk === undefined
			|| value.effectiveRisk === 'low'
			|| value.effectiveRisk === 'medium'
			|| value.effectiveRisk === 'high'
				|| value.effectiveRisk === 'blocked')
			&& (value.expectedManagedRelationsHash === undefined
				|| /^sha256:[a-f0-9]{64}$/.test(String(value.expectedManagedRelationsHash)))
			&& (value.resolvedWikiParent === undefined
				|| value.resolvedWikiParent === null
				|| typeof value.resolvedWikiParent === 'string')
			&& (value.resolvedWikiRelated === undefined
				|| (Array.isArray(value.resolvedWikiRelated) && value.resolvedWikiRelated.every((entry) => typeof entry === 'string')))
			&& (value.resolvedWikiSources === undefined
				|| (Array.isArray(value.resolvedWikiSources) && value.resolvedWikiSources.every((entry) => typeof entry === 'string')))
			&& (value.unresolvedWikiRelations === undefined
				|| (Array.isArray(value.unresolvedWikiRelations) && value.unresolvedWikiRelations.every((entry) => typeof entry === 'string')))
			&& (value.missingWikiRelations === undefined
				|| (Array.isArray(value.missingWikiRelations) && value.missingWikiRelations.every((entry) => typeof entry === 'string')))
			&& (value.missingSourceRelations === undefined
				|| (Array.isArray(value.missingSourceRelations) && value.missingSourceRelations.every((entry) => typeof entry === 'string')))
		&& typeof value.projectMemoryCreatedAt === 'string'
		&& !Number.isNaN(Date.parse(value.projectMemoryCreatedAt))
		&& typeof value.projectMemoryAgentType === 'string'
		&& value.projectMemoryAgentType.length > 0;
}

function buildWritebackEffect(
	targetNote: string,
	claimKey: string,
	targetMissing: boolean,
	managedRelationsOnly = false
): ProposeMemoryWritebackEffect {
	if (targetNote) {
		if (managedRelationsOnly && !targetMissing && isKnowledgeWikiPath(targetNote)) {
			return 'update_managed_relations';
		}
		if (!targetMissing) {
			return 'append';
		}
		if (isKnowledgeWikiPath(targetNote)) {
			return 'create_wiki_note';
		}
	}
	if (claimKey) {
		return 'create_memory_record';
	}
	return 'append';
}

function deriveReviewQueueClaimKey(
	proposalKind: string,
	content: string
): string {
	return `${proposalKind}:${computePayloadHash(content).replace(/^sha256:/, '').slice(0, 32)}`;
}

function disabledMemoryResult(
	snapshot: ProposeMemoryRequestSnapshot,
	identity: { operationId: string; idempotencyKey: string },
	memoryScope: ProposeMemoryScope
) {
	return {
		ok: true,
		tool: 'tracekeeper.propose_memory' as const,
		operation_id: identity.operationId,
		idempotency_key: identity.idempotencyKey,
		status: 'ignored' as const,
		persisted: false as const,
		auto_applied: false as const,
		duplicate: false,
		proposal_destination: 'memory' as const,
		memory_rule: 'disabled' as const,
		memory_scope: memoryScope,
		project_hint: snapshot.project_hint,
		warnings: ['Memory proposal is disabled for this scope; the candidate was ignored and not persisted.'],
		proposal_id: null,
		proposal_path: null,
		review_reason: null,
		review_warnings: [],
	};
}

function disabledWikiResult(
	snapshot: ProposeMemoryRequestSnapshot,
	identity: { operationId: string; idempotencyKey: string }
) {
	return {
		ok: true,
		tool: 'tracekeeper.propose_memory' as const,
		operation_id: identity.operationId,
		idempotency_key: identity.idempotencyKey,
		status: 'ignored' as const,
		persisted: false as const,
		auto_applied: false as const,
		duplicate: false,
		proposal_destination: 'wiki' as const,
		memory_rule: null,
		memory_scope: null,
		project_hint: snapshot.project_hint,
		target_note: snapshot.target_note,
		warnings: ['Wiki changes are disabled; the candidate was ignored and no review proposal was created.'],
		proposal_id: null,
		proposal_path: null,
		review_reason: null,
		review_warnings: [],
		review_batch_id: null,
		wiki_role: snapshot.wiki_role,
		parent_wiki: snapshot.parent_wiki,
		effective_wiki_rule: 'disabled' as const,
		effective_risk: null,
	};
}

function wikiReviewRequirement(
	rule: WikiChangeRule,
	risk: WikiEffectiveRisk | null
): { reason: string; warnings: readonly string[] } {
	if (rule === 'review_each') {
		return {
			reason: 'wiki_change_requires_individual_review',
			warnings: ['This Wiki change requires individual human review.'],
		};
	}
	if (risk === 'high') {
		return {
			reason: 'wiki_high_risk_change_requires_individual_review',
			warnings: ['This Wiki body change requires individual human review.'],
		};
	}
	return {
		reason: 'wiki_batch_review_required',
		warnings: ['This Wiki change is grouped for one human batch review.'],
	};
}

export class ProposeMemoryApplicationService {
	private readonly dependencies: ProposeMemoryApplicationDependencies;

	constructor(dependencies: ProposeMemoryApplicationDependencies) {
		this.dependencies = dependencies;
	}

	async execute(request: ProposeMemoryApplicationRequest) {
		const snapshot = requestSnapshot(request.rawArgs);
		const requestedWikiTarget = isKnowledgeWikiPath(snapshot.target_note || '');
		if ((snapshot.wiki_role || snapshot.parent_wiki) && !requestedWikiTarget) {
			throw new Error('wiki_role and parent_wiki are valid only for an explicit Wiki target.');
		}
		if (snapshot.parent_wiki && !isKnowledgeWikiPath(snapshot.parent_wiki)) {
			throw new Error('parent_wiki must be a Vault-relative Wiki path.');
		}
		if (requestedWikiTarget && snapshot.related_wiki.some((path) => !isKnowledgeWikiPath(path))) {
			throw new Error('Wiki related_wiki values must remain inside the Wiki root.');
		}
		const requestHash = computePayloadHash(snapshot);
		const idempotencyKey = optionalString(request.rawArgs.idempotency_key);
		const identity = this.dependencies.createIdentity(requestHash, idempotencyKey);
		const existing = await this.dependencies.journal.loadByIdempotencyKey(identity.idempotencyKey);
		let operationPayload: ProposeMemoryOperationPayload;
		if (existing) {
			if (existing.operation_id !== identity.operationId) {
				throw new OperationConflictError(
					`Idempotency key conflict for "${identity.idempotencyKey}": associated with existing operation "${existing.operation_id}"`
				);
			}
			if (!validOperationPayload(existing.payload)) {
				throw new OperationConflictError(
					`Idempotency key conflict for "${identity.idempotencyKey}" with an incompatible legacy propose_memory operation`
				);
			}
			if (existing.payload.requestHash !== requestHash) {
				throw new OperationConflictError(
					`Idempotency key conflict for "${identity.idempotencyKey}" with different propose_memory request hash`
				);
			}
			operationPayload = existing.payload;
			const isWikiWrite = isKnowledgeWikiPath(operationPayload.requestSnapshot.target_note || '');
			if (existing.status !== 'completed' && !isWikiWrite && operationPayload.memoryRecordWriteVersion !== 2) {
				throw new OperationConflictError(
					`Cannot recover unfinished legacy propose_memory operation "${identity.operationId}" without MemoryRecord v2 write semantics`
				);
			}
		} else {
			const proposalKind = snapshot.proposal_kind;
			const targetNote = snapshot.target_note || '';
			const projectHint = snapshot.project_hint || '';
			const claimKey = snapshot.claim_key || deriveReviewQueueClaimKey(proposalKind, snapshot.content);
			const wikiTarget = isKnowledgeWikiPath(targetNote);
			let memoryRule: ProposeMemoryRule = 'review_queue';
			if (!wikiTarget) {
				if (!snapshot.memory_scope) {
					throw new Error('memory_scope is required for a MemoryRecord candidate.');
				}
				const memoryScope = this.dependencies.resolveMemoryScope(
					proposalKind,
					targetNote,
					projectHint,
					snapshot.memory_scope
				);
				memoryRule = this.dependencies.memoryRule(
					proposalKind,
					targetNote,
					projectHint,
					memoryScope
				);
				if (memoryRule !== 'disabled') {
					this.dependencies.assertAllowed(
						proposalKind,
						targetNote,
						projectHint,
						memoryScope
					);
				}
			}
			operationPayload = {
				requestHash,
				requestSnapshot: snapshot,
				...(!wikiTarget ? { memoryRecordWriteVersion: 2 as const } : {}),
				memoryRule,
				...(memoryRule === 'disabled' ? { policyOutcome: 'disabled' as const } : {}),
				projectMemoryCreatedAt: this.dependencies.now(),
				projectMemoryAgentType: this.dependencies.observedAgentType,
			};
			const targetMissing = targetNote && this.dependencies.isTargetNoteMissing
				? await this.dependencies.isTargetNoteMissing(targetNote)
				: false;
			const managedRelationsOnly = wikiTarget && [
				'wiki_relations',
				'wiki_relation_update',
			].includes(proposalKind.trim().toLowerCase());
			if (managedRelationsOnly && targetMissing) {
				throw new Error('Managed Wiki relation updates require an existing target note.');
			}
			operationPayload.writebackEffect = buildWritebackEffect(
				targetNote,
				claimKey,
				targetMissing,
				managedRelationsOnly
			);
				if (wikiTarget) {
					const targetContent = !targetMissing && this.dependencies.readTargetNote
						? await this.dependencies.readTargetNote(targetNote)
						: null;
					const parentMetadata = this.dependencies.resolveBridgeMetadata(
						'global',
						projectHint,
						snapshot.parent_wiki ? [snapshot.parent_wiki] : [],
						[],
						snapshot.task_id
					);
					const relationMetadata = this.dependencies.resolveBridgeMetadata(
						'global',
						projectHint,
						snapshot.related_wiki,
						snapshot.related_sources,
						snapshot.task_id
					);
					const unresolvedRelations = [
						...parentMetadata.missing_related_wiki,
						...relationMetadata.missing_related_wiki,
						...relationMetadata.missing_related_sources,
						...relationMetadata.related_sources.filter(isSourcePartPath),
					];
					const parsedRelations = parseManagedRelationsBlock(targetContent || '');
					operationPayload.wikiRule = this.dependencies.wikiRule?.() ?? 'review_batch';
					operationPayload.resolvedWikiParent = parentMetadata.related_wiki[0] ?? null;
					operationPayload.resolvedWikiRelated = relationMetadata.related_wiki;
					operationPayload.resolvedWikiSources = relationMetadata.related_sources.filter((path) => !isSourcePartPath(path));
					operationPayload.unresolvedWikiRelations = unresolvedRelations;
					operationPayload.missingWikiRelations = [
						...parentMetadata.missing_related_wiki,
						...relationMetadata.missing_related_wiki,
					];
					operationPayload.missingSourceRelations = [
						...relationMetadata.missing_related_sources,
						...relationMetadata.related_sources.filter(isSourcePartPath),
					];
					if (parsedRelations.status === 'valid') {
						operationPayload.expectedManagedRelationsHash = parsedRelations.hash;
					}
					operationPayload.effectiveRisk = computeWikiEffectiveRisk({
					targetExists: !targetMissing,
					writebackEffect: managedRelationsOnly
						? 'update_managed_relations'
						: targetMissing ? 'create_wiki_note' : 'append',
					targetPathAllowed: true,
					...(managedRelationsOnly
							? { relationsStatus: parsedRelations.status }
							: {}),
						hasUnresolvedRelations: unresolvedRelations.length > 0,
					});
			}
		}

		const runner = new RecoverableOperationRunner({
			operationId: identity.operationId,
			idempotencyKey: identity.idempotencyKey,
			payload: operationPayload,
			journal: this.dependencies.journal,
			failureInjection: this.dependencies.failureInjection,
			steps: [],
			finalize: () => this.finalize(
				operationPayload.requestSnapshot,
				operationPayload,
				identity,
				operationPayload.projectMemoryCreatedAt,
				operationPayload.projectMemoryAgentType
			),
		});
		return runner.run();
	}

	private async finalize(
		snapshot: ProposeMemoryRequestSnapshot,
		operationPayload: ProposeMemoryOperationPayload,
		identity: { operationId: string; idempotencyKey: string },
		operationCreatedAt: string,
		projectMemoryAgentType: ProposeMemoryAgentType
	) {
		const { dependencies } = this;
		const proposalKind = snapshot.proposal_kind;
		const content = snapshot.content;
		const evidence = snapshot.evidence;
		const targetNote = snapshot.target_note || '';
		const riskLevel = snapshot.risk_level || '';
		const title = snapshot.title || '';
		const taskId = snapshot.task_id || null;
		const projectHint = snapshot.project_hint || '';
		const proposalId = buildStableProposalId(`${identity.operationId}\0${proposalKind}`);
		const claimKey = snapshot.claim_key || deriveReviewQueueClaimKey(proposalKind, content);
		const wikiTarget = isKnowledgeWikiPath(targetNote);
		const writebackEffect = operationPayload.writebackEffect;
		const wikiRule = wikiTarget ? operationPayload.wikiRule ?? dependencies.wikiRule?.() ?? 'review_batch' : null;
		const effectiveRisk = wikiTarget
			? operationPayload.effectiveRisk ?? (
				writebackEffect === 'create_wiki_note' ? 'low'
					: writebackEffect === 'update_managed_relations' ? 'medium'
						: 'high'
			)
			: null;
		const reviewBatchId = wikiTarget ? buildWikiReviewBatchId(taskId, proposalId) : null;
		const displayRiskLevel = wikiTarget ? effectiveRisk || 'blocked' : riskLevel;
		if (wikiTarget && wikiRule === 'disabled') {
			return disabledWikiResult(snapshot, identity);
		}
		if (!wikiTarget && !snapshot.memory_scope) {
			throw new Error('memory_scope is required for a MemoryRecord candidate.');
		}
		const lifecycleClaimKey = wikiTarget ? null : claimKey;
		const memoryScope = wikiTarget
			? 'global' as const
			: dependencies.resolveMemoryScope(
				proposalKind,
				targetNote,
				projectHint,
				snapshot.memory_scope
			);
		const memoryRule = wikiTarget
			? 'review_queue' as const
			: operationPayload.memoryRule
				?? dependencies.memoryRule(proposalKind, targetNote, projectHint, memoryScope);
		if (!wikiTarget && (operationPayload.policyOutcome === 'disabled' || memoryRule === 'disabled')) {
			return disabledMemoryResult(snapshot, identity, memoryScope);
		}
		const architectureStatus = dependencies.buildArchitectureStatus();
		const bridgeMetadata = wikiTarget ? {
			missing_wiki_bridge: false,
			related_wiki: operationPayload.resolvedWikiRelated ?? [],
			missing_related_wiki: operationPayload.missingWikiRelations ?? [],
			related_sources: operationPayload.resolvedWikiSources ?? [],
			missing_related_sources: operationPayload.missingSourceRelations ?? [],
		} : dependencies.resolveBridgeMetadata(
			memoryScope,
			projectHint,
			snapshot.related_wiki,
			snapshot.related_sources,
			taskId
		);
		const verifiedRecordEvidence = [
			...new Set([
				...bridgeMetadata.related_sources,
				...bridgeMetadata.related_wiki,
			]),
		];
		const managedRelationsBlock = wikiTarget ? renderManagedRelationsBlock({
			parent: operationPayload.resolvedWikiParent,
			related: operationPayload.resolvedWikiRelated ?? [],
			sources: bridgeMetadata.related_sources.filter((path) => !isSourcePartPath(path)),
		}) : '';
		const proposedWritebackContent = writebackEffect === 'update_managed_relations'
			? managedRelationsBlock
			: wikiTarget && (
			snapshot.parent_wiki
			|| snapshot.related_wiki.length > 0
			|| bridgeMetadata.related_sources.length > 0
		)
			? [
				content.trimEnd(),
				managedRelationsBlock,
			].filter(Boolean).join('\n\n')
			: content;
		const resolvedProjectIdentity = !wikiTarget && memoryScope === 'project'
			? dependencies.resolveProjectIdentity(snapshot)
			: null;
		const now = dependencies.now();
		dependencies.assertSafeText([
			{ label: 'content', value: content },
			{ label: 'evidence', value: evidence.join('\n') },
			{ label: 'target_note', value: targetNote },
			{ label: 'title', value: title },
			{ label: 'project_hint', value: projectHint },
				{ label: 'related_wiki', value: snapshot.related_wiki.join('\n') },
				{ label: 'parent_wiki', value: snapshot.parent_wiki || '' },
			{ label: 'related_sources', value: snapshot.related_sources.join('\n') },
			{ label: 'claim_key', value: snapshot.claim_key || '' },
			{ label: 'supersedes', value: snapshot.supersedes.join('\n') },
			{ label: 'contradicts', value: snapshot.contradicts.join('\n') },
		]);

		if (!wikiTarget && memoryRule !== 'disabled') {
			dependencies.assertAllowed(proposalKind, targetNote, projectHint, memoryScope);
		}
		let reviewRequirement: { reason: string; warnings: readonly string[] } | null = wikiTarget
			? wikiReviewRequirement(wikiRule || 'review_batch', effectiveRisk)
			: memoryRule === 'review_queue'
				? {
					reason: 'memory_rule_requires_human_review',
					warnings: ['The active memory rule requires human review before writeback.'],
				}
				: null;
		if (!wikiTarget && memoryRule === 'auto_write') {
			if (targetNote) {
				reviewRequirement = {
					reason: 'explicit_memory_target_requires_human_review',
					warnings: ['Explicit MemoryRecord target paths require human review.'],
				};
			}
			if (
				!reviewRequirement
				&& (bridgeMetadata.missing_related_wiki.length > 0 || bridgeMetadata.missing_related_sources.length > 0)
			) {
				reviewRequirement = {
					reason: 'unresolved_relation_evidence',
					warnings: ['One or more explicitly declared Wiki or Source relations could not be verified in the active Vault.'],
				};
			}
			if (!reviewRequirement) {
				const useResolvedIdentity = resolvedProjectIdentity && resolvedProjectIdentity.confidence !== 'uncertain';
				const immutable = await dependencies.writeImmutableMemoryRecord({
					scope: memoryScope,
					projectId: useResolvedIdentity ? resolvedProjectIdentity?.projectId : snapshot.project_id || undefined,
					projectHint: useResolvedIdentity ? resolvedProjectIdentity?.projectHint : snapshot.project_hint || undefined,
					repoPath: useResolvedIdentity
						? resolvedProjectIdentity?.repoPath
						: snapshot.repo_path || snapshot.repo || snapshot.project_path || undefined,
					agentType: projectMemoryAgentType,
					taskId,
					operationId: identity.operationId,
					operationKind: 'propose_memory',
					memoryKinds: [proposalKind],
					body: content,
					relatedWiki: bridgeMetadata.related_wiki,
					relatedSources: bridgeMetadata.related_sources,
					claimKey,
					proposedAuthority: snapshot.proposed_authority as 'agent' | 'source' | 'user' | null || undefined,
					proposedConfidence: snapshot.proposed_confidence as 'uncertain' | 'inferred' | 'supported' | 'verified' | null || undefined,
					declaredState: snapshot.declared_state as 'active' | 'disputed' | 'retracted' | 'review' | null || undefined,
					observedAt: snapshot.observed_at || undefined,
					validFrom: snapshot.valid_from,
					validTo: snapshot.valid_to,
					lastVerifiedAt: snapshot.last_verified_at,
					evidence,
					supersedes: snapshot.supersedes,
					contradicts: snapshot.contradicts,
					createdAt: operationCreatedAt,
				});
				if (immutable.status !== 'review_required') {
					const predictedRecord = {
						scope: memoryScope,
						project_id: immutable.project_id,
						memory_id: immutable.memory_id,
						memory_kind: proposalKind,
						claim_key: immutable.claim_key,
						authority: immutable.authority,
						confidence_level: immutable.confidence_level,
						declared_state: snapshot.declared_state as 'active' | 'disputed' | 'retracted' | 'review' | null,
						observed_at: snapshot.observed_at,
						valid_from: snapshot.valid_from,
						valid_to: snapshot.valid_to,
						last_verified_at: snapshot.last_verified_at,
						evidence: verifiedRecordEvidence,
						supersedes: snapshot.supersedes,
						contradicts: snapshot.contradicts,
						related_wiki: bridgeMetadata.related_wiki,
						related_sources: bridgeMetadata.related_sources,
						effective_state: immutable.effective_state,
					};
					const proposalTransitionPreview = {
						operation_id: identity.operationId,
						kind: proposalKind,
						previous_status: 'pending',
						next_status: immutable.write_status,
						expected_revision: immutable.operation_hash,
						committed_revision: immutable.operation_hash,
						proposal_id: immutable.memory_id,
						proposal_path: immutable.path,
					};
					await dependencies.updateTaskMemoryWrite(taskId, immutable.path);
					return {
						ok: true,
						tool: 'tracekeeper.propose_memory',
						operation_id: identity.operationId,
						idempotency_key: identity.idempotencyKey,
						status: immutable.write_status,
						path: immutable.path,
						target_note: immutable.path,
						activity_path: immutable.activity_path,
						warnings: [],
						auto_applied: true,
						duplicate: immutable.duplicate,
						proposal_destination: 'memory' as const,
						memory_rule: 'auto_write',
						memory_scope: memoryScope,
						project_id: immutable.project_id,
						project_hub: immutable.project_hub,
						global_hub: immutable.global_hub,
						project_hint: projectHint || null,
						agent_type: immutable.agent_type,
						operation_hash: immutable.operation_hash,
						record_identity: {
							scope: memoryScope,
							project_id: immutable.project_id,
							claim_key: immutable.claim_key,
							memory_id: immutable.memory_id,
						},
						predicted_record: predictedRecord,
						predicted_state: immutable.effective_state,
						proposal_transition_preview: proposalTransitionPreview,
						related_wiki: bridgeMetadata.related_wiki,
						related_sources: bridgeMetadata.related_sources,
						missing_related_sources: bridgeMetadata.missing_related_sources,
						architecture_status: architectureStatus.architecture_status,
						missing_graph_bridges: architectureStatus.missing_graph_bridges,
						missing_wiki_bridge: false,
						proposal_id: null,
						proposal_path: null,
					};
				}
				reviewRequirement = immutable;
			}
		}
		if (
			wikiTarget
			&& wikiRule === 'auto_managed'
			&& effectiveRisk === 'low'
			&& (writebackEffect === 'create_wiki_note' || writebackEffect === 'update_managed_relations')
			&& dependencies.writeAutoWiki
		) {
			const written = await dependencies.writeAutoWiki({
				targetNote,
				content: proposedWritebackContent,
				taskId,
				operationId: identity.operationId,
				proposalKind,
				reviewBatchId: reviewBatchId || buildWikiReviewBatchId(taskId, proposalId),
					effect: writebackEffect,
					expectedManagedRelationsHash: operationPayload.expectedManagedRelationsHash,
				});
			await dependencies.updateTaskMemoryWrite(taskId, written.path);
			return {
				ok: true,
				tool: 'tracekeeper.propose_memory' as const,
				operation_id: identity.operationId,
				idempotency_key: identity.idempotencyKey,
				status: written.status,
				path: written.path,
				target_note: written.path,
				activity_path: written.activity_path,
				warnings: written.warnings,
				persisted: true,
				auto_applied: true,
				duplicate: written.duplicate ?? false,
				proposal_destination: 'wiki' as const,
				memory_rule: null,
				memory_scope: null,
				project_hint: projectHint || null,
				related_wiki: snapshot.related_wiki,
				related_sources: bridgeMetadata.related_sources,
				missing_related_sources: bridgeMetadata.missing_related_sources,
				architecture_status: architectureStatus.architecture_status,
				missing_graph_bridges: architectureStatus.missing_graph_bridges,
				missing_wiki_bridge: bridgeMetadata.missing_wiki_bridge,
				proposal_id: null,
				proposal_path: null,
				review_reason: null,
				review_warnings: [],
				review_batch_id: reviewBatchId,
				wiki_role: snapshot.wiki_role,
				parent_wiki: snapshot.parent_wiki,
				effective_wiki_rule: wikiRule,
				effective_risk: effectiveRisk,
			};
		}

		let governedRecordTarget = '';
		if (lifecycleClaimKey && !targetNote) {
			const agentType = normalizeProjectAgentType(projectMemoryAgentType);
			const resolvedTarget = await dependencies.resolveMemoryRecordTarget?.({
				scope: memoryScope,
				projectId: resolvedProjectIdentity?.projectId || snapshot.project_id || undefined,
				projectHint: resolvedProjectIdentity?.projectHint || snapshot.project_hint || undefined,
				repoPath: resolvedProjectIdentity?.repoPath
					|| snapshot.repo_path
					|| snapshot.repo
					|| snapshot.project_path
					|| undefined,
				agentType: projectMemoryAgentType,
				operationId: identity.operationId,
			});
			if (resolvedTarget !== undefined) {
				governedRecordTarget = resolvedTarget || '';
			} else if (memoryScope === 'global') {
				governedRecordTarget = buildGlobalMemoryEntryPath({
					agentType,
					operationKind: 'propose_memory',
					operationId: identity.operationId,
				});
			} else if (resolvedProjectIdentity?.repoPath) {
				const binding = deriveProjectMemoryHubBindingFromRepoPath(resolvedProjectIdentity.repoPath);
				governedRecordTarget = buildProjectMemoryEntryPath({
					projectKey: binding.project_key,
					agentType,
					operationKind: 'propose_memory',
					operationId: identity.operationId,
				});
			}
		}
		const proposalTargetNote = targetNote || governedRecordTarget;
		const body = [
			dependencies.renderText('## 记忆提案', '## Proposal'),
			'- status: pending',
			`- proposal_kind: ${proposalKind}`,
			evidence.length ? `- evidence: ${JSON.stringify(evidence)}` : '',
			proposalTargetNote ? `- target_note: ${proposalTargetNote}` : '',
			reviewBatchId ? `- review_batch_id: ${reviewBatchId}` : '',
			snapshot.wiki_role ? `- wiki_role: ${snapshot.wiki_role}` : '',
			snapshot.parent_wiki ? `- parent_wiki: ${snapshot.parent_wiki}` : '',
			effectiveRisk ? `- effective_risk: ${effectiveRisk}` : '',
			!wikiTarget ? `- memory_scope: ${memoryScope}` : '',
			projectHint ? `- project_hint: ${projectHint}` : '',
			bridgeMetadata.related_wiki.length ? `- related_wiki: ${JSON.stringify(bridgeMetadata.related_wiki)}` : '',
			bridgeMetadata.related_sources.length ? `- related_sources: ${JSON.stringify(bridgeMetadata.related_sources)}` : '',
			writebackEffect ? `- writeback_effect: ${writebackEffect}` : '',
			lifecycleClaimKey ? `- claim_key: ${lifecycleClaimKey}` : '',
			snapshot.proposed_authority ? `- proposed_authority: ${snapshot.proposed_authority}` : '',
			snapshot.proposed_confidence ? `- proposed_confidence: ${snapshot.proposed_confidence}` : '',
			snapshot.declared_state ? `- declared_state: ${snapshot.declared_state}` : '',
			snapshot.observed_at ? `- observed_at: ${snapshot.observed_at}` : '',
			snapshot.valid_from ? `- valid_from: ${snapshot.valid_from}` : '',
			snapshot.valid_to ? `- valid_to: ${snapshot.valid_to}` : '',
			snapshot.last_verified_at ? `- last_verified_at: ${snapshot.last_verified_at}` : '',
			snapshot.supersedes.length ? `- supersedes: ${JSON.stringify(snapshot.supersedes)}` : '',
			snapshot.contradicts.length ? `- contradicts: ${JSON.stringify(snapshot.contradicts)}` : '',
			displayRiskLevel ? `- risk_level: ${displayRiskLevel}` : '',
			`- architecture_status: ${architectureStatus.architecture_status}`,
			`- missing_graph_bridges: ${JSON.stringify(architectureStatus.missing_graph_bridges)}`,
			bridgeMetadata.missing_wiki_bridge ? '- missing_wiki_bridge: true' : '',
			bridgeMetadata.missing_related_wiki.length ? `- missing_related_wiki: ${JSON.stringify(bridgeMetadata.missing_related_wiki)}` : '',
			bridgeMetadata.missing_related_sources.length ? `- missing_related_sources: ${JSON.stringify(bridgeMetadata.missing_related_sources)}` : '',
			reviewRequirement ? `- review_reason: ${reviewRequirement.reason}` : '',
			reviewRequirement?.warnings.length ? `- review_warnings: ${JSON.stringify(reviewRequirement.warnings)}` : '',
			'',
				renderProposalWritebackSection(
				dependencies.renderText('## 写回内容', '## Writeback'),
				proposalId,
				proposedWritebackContent
			),
		].filter(Boolean).join('\n');

		const filename = dependencies.buildFilename(
			snapshot.filename,
			`proposal-${identity.operationId}`
		);
		const existing = await dependencies.findOwnedProposalNote(filename, identity.operationId);
		const note = existing || await dependencies.writeProposalNote({
			filename,
			frontmatter: {
				tool: 'tracekeeper.propose_memory',
				type: 'memory_proposal',
				proposal_id: proposalId,
				title: title || dependencies.renderText(`记忆提案：${proposalKind}`, `Memory proposal: ${proposalKind}`),
				proposal_kind: proposalKind,
				proposal_schema_version: wikiTarget ? WIKI_PROPOSAL_SCHEMA_VERSION : null,
				status: 'pending',
				target_note: proposalTargetNote || null,
				risk_level: displayRiskLevel || null,
				review_batch_id: reviewBatchId,
				wiki_role: snapshot.wiki_role,
				parent_wiki: snapshot.parent_wiki,
				effective_risk: effectiveRisk,
				effective_wiki_rule: wikiRule,
				project_hint: projectHint || null,
				memory_scope: wikiTarget ? null : memoryScope,
				related_wiki: bridgeMetadata.related_wiki,
				related_sources: bridgeMetadata.related_sources,
				claim_key: lifecycleClaimKey,
				proposed_authority: snapshot.proposed_authority || 'agent',
				proposed_confidence: snapshot.proposed_confidence || (bridgeMetadata.related_sources.length > 0 ? 'supported' : 'inferred'),
				declared_state: snapshot.declared_state || 'active',
				observed_at: snapshot.observed_at || operationCreatedAt,
				valid_from: snapshot.valid_from,
				valid_to: snapshot.valid_to,
				last_verified_at: snapshot.last_verified_at,
				supersedes: snapshot.supersedes,
				contradicts: snapshot.contradicts,
				architecture_status: architectureStatus.architecture_status,
				missing_graph_bridges: architectureStatus.missing_graph_bridges,
				missing_wiki_bridge: bridgeMetadata.missing_wiki_bridge,
				missing_related_wiki: bridgeMetadata.missing_related_wiki,
				missing_related_sources: bridgeMetadata.missing_related_sources,
				review_reason: reviewRequirement?.reason || null,
				review_warnings: reviewRequirement ? [...reviewRequirement.warnings] : [],
				created_at: now,
				task_id: taskId || null,
				project_id: wikiTarget ? null : resolvedProjectIdentity?.projectId || snapshot.project_id || null,
				proposal_operation_id: identity.operationId,
				...(writebackEffect ? { writeback_effect: writebackEffect } : {}),
			},
			body,
			taskId,
			metadata: {
				action: 'memory.proposal.created',
				target_type: 'memory_proposal',
				proposal_kind: proposalKind,
				risk_level: displayRiskLevel || null,
			},
			operationId: identity.operationId,
		});
		if (existing) {
			await dependencies.ensureOwnedProposalIdentity(note.path, proposalId, identity.operationId);
		}
		if (taskId) {
			await dependencies.updateTaskProposalReference(taskId, {
				proposalId,
				path: note.path,
				linkTarget: note.path,
			});
		}
		const recordIdentity = !wikiTarget ? {
			scope: memoryScope,
			project_id: (resolvedProjectIdentity?.projectId || snapshot.project_id || null),
			claim_key: snapshot.claim_key,
			memory_id: null,
		} : null;
		const predictedRecord = !wikiTarget ? {
			scope: memoryScope,
			project_id: (resolvedProjectIdentity?.projectId || snapshot.project_id || null),
			memory_id: null,
			memory_kind: proposalKind,
			claim_key: snapshot.claim_key,
			authority: snapshot.proposed_authority,
			confidence_level: snapshot.proposed_confidence,
			declared_state: snapshot.declared_state as 'active' | 'disputed' | 'retracted' | 'review' | null,
			observed_at: snapshot.observed_at,
			valid_from: snapshot.valid_from,
			valid_to: snapshot.valid_to,
			last_verified_at: snapshot.last_verified_at,
			evidence: verifiedRecordEvidence,
			supersedes: snapshot.supersedes,
			contradicts: snapshot.contradicts,
			related_wiki: bridgeMetadata.related_wiki,
			related_sources: bridgeMetadata.related_sources,
			effective_state: null,
		} : null;
		const proposalTransitionPreview = {
			operation_id: identity.operationId,
			kind: proposalKind,
			previous_status: 'pending',
			next_status: 'queued',
			expected_revision: proposalId,
			committed_revision: proposalId,
			proposal_id: proposalId,
			proposal_path: note.path,
		};

		const response = {
			ok: true,
			tool: 'tracekeeper.propose_memory',
			operation_id: identity.operationId,
			idempotency_key: identity.idempotencyKey,
			status: note.status,
			path: note.path,
			activity_path: note.activity_path,
			warnings: [...note.warnings, ...(reviewRequirement?.warnings ?? [])],
			auto_applied: false,
			duplicate: false,
			proposal_id: proposalId,
			proposal_path: note.path,
			proposal_link_target: note.path,
			proposal_destination: wikiTarget ? 'wiki' as const : 'memory' as const,
			memory_rule: wikiTarget ? null : memoryRule,
			memory_scope: wikiTarget ? null : memoryScope,
			project_hint: projectHint || null,
			related_wiki: bridgeMetadata.related_wiki,
			related_sources: bridgeMetadata.related_sources,
			missing_related_sources: bridgeMetadata.missing_related_sources,
			architecture_status: architectureStatus.architecture_status,
			missing_graph_bridges: architectureStatus.missing_graph_bridges,
			missing_wiki_bridge: bridgeMetadata.missing_wiki_bridge,
			...(recordIdentity ? { record_identity: recordIdentity } : {}),
			...(predictedRecord ? { predicted_record: predictedRecord, predicted_state: 'review' as const } : {}),
			proposal_transition_preview: proposalTransitionPreview,
			review_reason: reviewRequirement?.reason || null,
			review_warnings: reviewRequirement ? [...reviewRequirement.warnings] : [],
			review_batch_id: reviewBatchId,
			wiki_role: snapshot.wiki_role,
			parent_wiki: snapshot.parent_wiki,
			effective_wiki_rule: wikiRule,
			effective_risk: effectiveRisk,
		};
		return response;
	}
}
