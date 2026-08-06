import {
	computePayloadHash,
	buildStableProposalId,
	buildProjectMemoryEntryPath,
	deriveProjectMemoryHubBindingFromRepoPath,
	KNOWLEDGE_GLOBAL_MEMORY_DIR,
	normalizeProjectAgentType,
	OperationConflictError,
	RecoverableOperationRunner,
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
	projectMemoryCreatedAt: string;
	projectMemoryAgentType: ProposeMemoryAgentType;
}

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
	}
	| {
		status: 'created' | 'exact_retry';
		path: string;
		activity_path: string;
		project_id: string;
		project_hub: string;
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
		relatedSources: string[]
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
	writeImmutableProjectMemory(
		input: ProposeMemoryImmutableWriteInput
	): Promise<ProposeMemoryImmutableWriteResult>;
	resolveAutoMemoryTarget(
		proposalKind: string,
		targetNote: string,
		projectHint: string,
		memoryScope: ProposeMemoryScope
	): { targetNote: string; allowedDir: string } | null;
	appendAutoMemoryWrite(input: ProposeMemoryAutoWriteInput): Promise<ProposeMemoryNote>;
	findOwnedProposalNote(filename: string, operationId: string): Promise<ProposeMemoryNote | null>;
	writeProposalNote(input: ProposeMemoryWriteInput): Promise<ProposeMemoryNote>;
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
		&& typeof request.proposal_kind === 'string'
		&& request.proposal_kind.length > 0
		&& typeof request.content === 'string'
		&& request.content.length > 0
		&& Array.isArray(request.related_wiki)
		&& request.related_wiki.every((entry) => typeof entry === 'string')
		&& Array.isArray(request.related_sources)
		&& request.related_sources.every((entry) => typeof entry === 'string')
		&& typeof value.projectMemoryCreatedAt === 'string'
		&& !Number.isNaN(Date.parse(value.projectMemoryCreatedAt))
		&& typeof value.projectMemoryAgentType === 'string'
		&& value.projectMemoryAgentType.length > 0;
}

export class ProposeMemoryApplicationService {
	private readonly dependencies: ProposeMemoryApplicationDependencies;

	constructor(dependencies: ProposeMemoryApplicationDependencies) {
		this.dependencies = dependencies;
	}

	async execute(request: ProposeMemoryApplicationRequest) {
		const snapshot = requestSnapshot(request.rawArgs);
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
		} else {
			operationPayload = {
				requestHash,
				requestSnapshot: snapshot,
				projectMemoryCreatedAt: this.dependencies.now(),
				projectMemoryAgentType: this.dependencies.observedAgentType,
			};
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
				identity,
				operationPayload.projectMemoryCreatedAt,
				operationPayload.projectMemoryAgentType
			),
		});
		return runner.run();
	}

	private async finalize(
		snapshot: ProposeMemoryRequestSnapshot,
		identity: { operationId: string; idempotencyKey: string },
		operationCreatedAt: string,
		projectMemoryAgentType: ProposeMemoryAgentType
	) {
		const { dependencies } = this;
		const proposalKind = snapshot.proposal_kind;
		const content = snapshot.content;
		const evidence = snapshot.evidence;
		const evidenceText = evidence.join('; ');
		const targetNote = snapshot.target_note || '';
		const riskLevel = snapshot.risk_level || '';
		const title = snapshot.title || '';
		const taskId = snapshot.task_id || null;
		const projectHint = snapshot.project_hint || '';
		const proposalId = buildStableProposalId(`${identity.operationId}\0${proposalKind}`);
		const claimKey = snapshot.claim_key
			|| `${proposalKind}:${computePayloadHash(content).replace(/^sha256:/, '').slice(0, 32)}`;
		const lifecycleClaimKey = /(^|\/)wiki(\/|$)/i.test(targetNote) ? null : claimKey;
		const memoryScope = dependencies.resolveMemoryScope(
			proposalKind,
			targetNote,
			projectHint,
			snapshot.memory_scope
		);
		const architectureStatus = dependencies.buildArchitectureStatus();
		const bridgeMetadata = dependencies.resolveBridgeMetadata(
			memoryScope,
			projectHint,
			snapshot.related_wiki,
			snapshot.related_sources
		);
		const resolvedProjectIdentity = memoryScope === 'project'
			? dependencies.resolveProjectIdentity(snapshot)
			: null;
		const now = dependencies.now();
		dependencies.assertAllowed(proposalKind, targetNote, projectHint, memoryScope);
		dependencies.assertSafeText([
			{ label: 'content', value: content },
			{ label: 'evidence', value: evidence.join('\n') },
			{ label: 'target_note', value: targetNote },
			{ label: 'title', value: title },
			{ label: 'project_hint', value: projectHint },
			{ label: 'related_wiki', value: snapshot.related_wiki.join('\n') },
			{ label: 'related_sources', value: snapshot.related_sources.join('\n') },
			{ label: 'claim_key', value: snapshot.claim_key || '' },
			{ label: 'supersedes', value: snapshot.supersedes.join('\n') },
			{ label: 'contradicts', value: snapshot.contradicts.join('\n') },
		]);

		const memoryRule = dependencies.memoryRule(proposalKind, targetNote, projectHint, memoryScope);
		let immutableReviewRequired = false;
		if (memoryRule === 'auto_write') {
			const canAutoWrite = !(memoryScope === 'project' && bridgeMetadata.missing_wiki_bridge);
			if (canAutoWrite && memoryScope === 'project') {
				const useResolvedIdentity = resolvedProjectIdentity && resolvedProjectIdentity.confidence !== 'uncertain';
				const immutable = await dependencies.writeImmutableProjectMemory({
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
						evidence,
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
						memory_rule: 'auto_write',
						memory_scope: memoryScope,
						project_id: immutable.project_id,
						project_hub: immutable.project_hub,
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
				immutableReviewRequired = true;
			}
			const autoTarget = canAutoWrite && memoryScope === 'global'
				? dependencies.resolveAutoMemoryTarget(proposalKind, targetNote, projectHint, memoryScope)
				: null;
			if (autoTarget) {
				const note = await dependencies.appendAutoMemoryWrite({
					proposalKind,
					targetNote: autoTarget.targetNote,
					allowedDir: autoTarget.allowedDir,
					title: title || dependencies.renderText(`记忆更新：${proposalKind}`, `Memory update: ${proposalKind}`),
					content,
					operationId: identity.operationId,
					taskId,
					memoryScope,
					projectHint,
					relatedWiki: bridgeMetadata.related_wiki,
					relatedSources: bridgeMetadata.related_sources,
					architectureStatus,
					missingGraphBridges: architectureStatus.missing_graph_bridges,
					missingWikiBridge: false,
					missingRelatedWiki: bridgeMetadata.missing_related_wiki,
					missingRelatedSources: bridgeMetadata.missing_related_sources,
					evidence: evidenceText,
					riskLevel,
				});
				await dependencies.updateTaskMemoryWrite(taskId, note.path);
				const predictedRecord = {
					scope: memoryScope,
					project_id: null,
					memory_id: null,
					memory_kind: proposalKind,
					claim_key: snapshot.claim_key,
					authority: snapshot.proposed_authority,
					confidence_level: snapshot.proposed_confidence as 'uncertain' | 'inferred' | 'supported' | 'verified' | null,
					declared_state: snapshot.declared_state as 'active' | 'disputed' | 'retracted' | 'review' | null,
					observed_at: snapshot.observed_at,
					valid_from: snapshot.valid_from,
					valid_to: snapshot.valid_to,
					last_verified_at: snapshot.last_verified_at,
					evidence,
					supersedes: snapshot.supersedes,
					contradicts: snapshot.contradicts,
					related_wiki: bridgeMetadata.related_wiki,
					related_sources: bridgeMetadata.related_sources,
					effective_state: null,
				};
				const proposalTransitionPreview = {
					operation_id: identity.operationId,
					kind: proposalKind,
					previous_status: 'pending',
					next_status: note.status,
					expected_revision: identity.operationId,
					committed_revision: identity.operationId,
					proposal_id: identity.operationId,
					proposal_path: note.path,
				};
				return {
					ok: true,
					tool: 'tracekeeper.propose_memory',
					operation_id: identity.operationId,
					idempotency_key: identity.idempotencyKey,
					status: note.status,
					path: note.path,
					target_note: note.path,
					activity_path: note.activity_path,
					warnings: note.warnings,
					auto_applied: true,
					duplicate: note.duplicate ?? false,
					memory_rule: 'auto_write',
					memory_scope: memoryScope,
					project_hint: projectHint || null,
					record_identity: {
						scope: memoryScope,
						project_id: null,
						claim_key: snapshot.claim_key,
						memory_id: null,
					},
					predicted_record: predictedRecord,
					predicted_state: 'legacy_unkeyed',
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
		}

		let governedRecordTarget = '';
		if (lifecycleClaimKey && !targetNote) {
			const agentType = normalizeProjectAgentType(projectMemoryAgentType);
			if (memoryScope === 'global') {
				governedRecordTarget = `${KNOWLEDGE_GLOBAL_MEMORY_DIR}/agents/${agentType}/approved-${proposalId}.md`;
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
		const proposalTargetNote = immutableReviewRequired && memoryScope === 'project'
			? governedRecordTarget
			: targetNote || governedRecordTarget;
		const body = [
			dependencies.renderText('## 记忆提案', '## Proposal'),
			'- status: pending',
			`- proposal_kind: ${proposalKind}`,
			evidence.length ? `- evidence: ${JSON.stringify(evidence)}` : '',
			proposalTargetNote ? `- target_note: ${proposalTargetNote}` : '',
			`- memory_scope: ${memoryScope}`,
			projectHint ? `- project_hint: ${projectHint}` : '',
			bridgeMetadata.related_wiki.length ? `- related_wiki: ${JSON.stringify(bridgeMetadata.related_wiki)}` : '',
			bridgeMetadata.related_sources.length ? `- related_sources: ${JSON.stringify(bridgeMetadata.related_sources)}` : '',
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
			riskLevel ? `- risk_level: ${riskLevel}` : '',
			`- architecture_status: ${architectureStatus.architecture_status}`,
			`- missing_graph_bridges: ${JSON.stringify(architectureStatus.missing_graph_bridges)}`,
			bridgeMetadata.missing_wiki_bridge ? '- missing_wiki_bridge: true' : '',
			bridgeMetadata.missing_related_wiki.length ? `- missing_related_wiki: ${JSON.stringify(bridgeMetadata.missing_related_wiki)}` : '',
			bridgeMetadata.missing_related_sources.length ? `- missing_related_sources: ${JSON.stringify(bridgeMetadata.missing_related_sources)}` : '',
			'',
			dependencies.renderText('## 写回内容', '## Writeback'),
			content,
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
				status: 'pending',
				target_note: proposalTargetNote || null,
				risk_level: riskLevel || null,
				project_hint: projectHint || null,
				memory_scope: memoryScope,
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
				created_at: now,
				task_id: taskId || null,
				project_id: resolvedProjectIdentity?.projectId || snapshot.project_id || null,
				proposal_operation_id: identity.operationId,
			},
			body,
			taskId,
			metadata: {
				action: 'memory.proposal.created',
				target_type: 'memory_proposal',
				proposal_kind: proposalKind,
				risk_level: riskLevel || null,
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
		const recordIdentity = {
			scope: memoryScope,
			project_id: (resolvedProjectIdentity?.projectId || snapshot.project_id || null),
			claim_key: snapshot.claim_key,
			memory_id: null,
		};
		const predictedRecord = {
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
			evidence,
			supersedes: snapshot.supersedes,
			contradicts: snapshot.contradicts,
			related_wiki: bridgeMetadata.related_wiki,
			related_sources: bridgeMetadata.related_sources,
			effective_state: null,
		};
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
			warnings: note.warnings,
			auto_applied: false,
			duplicate: false,
			proposal_id: proposalId,
			proposal_path: note.path,
			proposal_link_target: note.path,
			memory_rule: memoryRule,
			memory_scope: memoryScope,
			project_hint: projectHint || null,
			related_wiki: bridgeMetadata.related_wiki,
			related_sources: bridgeMetadata.related_sources,
			missing_related_sources: bridgeMetadata.missing_related_sources,
			architecture_status: architectureStatus.architecture_status,
			missing_graph_bridges: architectureStatus.missing_graph_bridges,
			missing_wiki_bridge: bridgeMetadata.missing_wiki_bridge,
			record_identity: recordIdentity,
			predicted_record: predictedRecord,
			predicted_state: 'review',
			proposal_transition_preview: proposalTransitionPreview,
		};
		if (memoryScope === 'project' && bridgeMetadata.missing_wiki_bridge && memoryRule === 'auto_write') {
			response.memory_rule = 'review_queue';
			response.predicted_state = 'review';
			response.proposal_transition_preview = {
				operation_id: identity.operationId,
				kind: proposalKind,
				previous_status: 'pending',
				next_status: 'queued',
				expected_revision: proposalId,
				committed_revision: proposalId,
				proposal_id: proposalId,
				proposal_path: note.path,
			};
		}
		return response;
	}
}
