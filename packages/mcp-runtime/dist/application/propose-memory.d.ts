import { type OperationFailureInjection, type OperationJournal } from '@tracekeeper/core';
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
export type ProposeMemoryImmutableWriteResult = {
    status: 'review_required';
    reason: string;
    warnings: readonly string[];
} | {
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
export interface ProposeMemoryApplicationDependencies {
    journal: OperationJournal;
    failureInjection?: OperationFailureInjection;
    createIdentity(requestHash: string, idempotencyKey: string): {
        operationId: string;
        idempotencyKey: string;
    };
    observedAgentType: ProposeMemoryAgentType;
    now(): string;
    buildFilename(rawFilename: string | null, fallbackPrefix: string): string;
    resolveMemoryScope(proposalKind: string, targetNote: string, projectHint: string, memoryScope: string | null): ProposeMemoryScope;
    buildArchitectureStatus(): ProposeMemoryArchitectureStatus;
    resolveBridgeMetadata(memoryScope: ProposeMemoryScope, projectHint: string, relatedWiki: string[], relatedSources: string[]): ProposeMemoryBridgeMetadata;
    resolveProjectIdentity(snapshot: ProposeMemoryRequestSnapshot): ProposeMemoryProjectIdentity | null;
    assertAllowed(proposalKind: string, targetNote: string, projectHint: string, memoryScope: ProposeMemoryScope): void;
    memoryRule(proposalKind: string, targetNote: string, projectHint: string, memoryScope: ProposeMemoryScope): ProposeMemoryRule;
    writeImmutableMemoryRecord(input: ProposeMemoryImmutableWriteInput): Promise<ProposeMemoryImmutableWriteResult>;
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
    ensureOwnedProposalIdentity(path: string, proposalId: string, operationId: string): Promise<void>;
    updateTaskMemoryWrite(taskId: string | null, path: string): Promise<void>;
    updateTaskProposalReference(taskId: string, proposal: {
        proposalId: string;
        path: string;
        linkTarget: string;
    }): Promise<void>;
    assertSafeText(values: Array<{
        label: string;
        value: string;
    }>): void;
    renderText(zh: string, en: string): string;
    isTargetNoteMissing?(targetNote: string): Promise<boolean>;
}
export interface ProposeMemoryApplicationRequest {
    rawArgs: ProposeMemoryRawRequest;
}
export declare class ProposeMemoryApplicationService {
    private readonly dependencies;
    constructor(dependencies: ProposeMemoryApplicationDependencies);
    execute(request: ProposeMemoryApplicationRequest): Promise<{
        ok: boolean;
        tool: "tracekeeper.propose_memory";
        operation_id: string;
        idempotency_key: string;
        status: "ignored";
        persisted: false;
        auto_applied: false;
        duplicate: boolean;
        proposal_destination: "memory";
        memory_rule: "disabled";
        memory_scope: ProposeMemoryScope;
        project_hint: string | null;
        warnings: string[];
        proposal_id: null;
        proposal_path: null;
        review_reason: null;
        review_warnings: never[];
    } | {
        proposal_transition_preview: {
            operation_id: string;
            kind: string;
            previous_status: string;
            next_status: string;
            expected_revision: string;
            committed_revision: string;
            proposal_id: string;
            proposal_path: string;
        };
        review_reason: string | null;
        review_warnings: string[];
        predicted_record?: {
            scope: ProposeMemoryScope;
            project_id: string | null;
            memory_id: null;
            memory_kind: string;
            claim_key: string | null;
            authority: string | null;
            confidence_level: string | null;
            declared_state: "active" | "disputed" | "retracted" | "review" | null;
            observed_at: string | null;
            valid_from: string | null;
            valid_to: string | null;
            last_verified_at: string | null;
            evidence: string[];
            supersedes: string[];
            contradicts: string[];
            related_wiki: string[];
            related_sources: string[];
            effective_state: null;
        } | undefined;
        predicted_state?: "review" | undefined;
        record_identity?: {
            scope: ProposeMemoryScope;
            project_id: string | null;
            claim_key: string | null;
            memory_id: null;
        } | undefined;
        ok: boolean;
        tool: string;
        operation_id: string;
        idempotency_key: string;
        status: string;
        path: string;
        activity_path: string;
        warnings: string[];
        auto_applied: boolean;
        duplicate: boolean;
        proposal_id: string;
        proposal_path: string;
        proposal_link_target: string;
        proposal_destination: "wiki" | "memory";
        memory_rule: ProposeMemoryRule | null;
        memory_scope: ProposeMemoryScope | null;
        project_hint: string | null;
        related_wiki: string[];
        related_sources: string[];
        missing_related_sources: string[];
        architecture_status: "healthy" | "needs_attention";
        missing_graph_bridges: string[];
        missing_wiki_bridge: boolean;
    } | {
        ok: boolean;
        tool: string;
        operation_id: string;
        idempotency_key: string;
        status: "written" | "skipped";
        path: string;
        target_note: string;
        activity_path: string;
        warnings: never[];
        auto_applied: boolean;
        duplicate: boolean;
        proposal_destination: "memory";
        memory_rule: string;
        memory_scope: ProposeMemoryScope;
        project_id: string | null;
        project_hub: string | null;
        global_hub: string | null;
        project_hint: string | null;
        agent_type: string;
        operation_hash: string;
        record_identity: {
            scope: ProposeMemoryScope;
            project_id: string | null;
            claim_key: string;
            memory_id: string;
        };
        predicted_record: {
            scope: ProposeMemoryScope;
            project_id: string | null;
            memory_id: string;
            memory_kind: string;
            claim_key: string;
            authority: "source" | "agent";
            confidence_level: "uncertain" | "supported" | "inferred";
            declared_state: "active" | "disputed" | "retracted" | "review" | null;
            observed_at: string | null;
            valid_from: string | null;
            valid_to: string | null;
            last_verified_at: string | null;
            evidence: string[];
            supersedes: string[];
            contradicts: string[];
            related_wiki: string[];
            related_sources: string[];
            effective_state: "current";
        };
        predicted_state: "current";
        proposal_transition_preview: {
            operation_id: string;
            kind: string;
            previous_status: string;
            next_status: "written" | "skipped";
            expected_revision: string;
            committed_revision: string;
            proposal_id: string;
            proposal_path: string;
        };
        related_wiki: string[];
        related_sources: string[];
        missing_related_sources: string[];
        architecture_status: "healthy" | "needs_attention";
        missing_graph_bridges: string[];
        missing_wiki_bridge: boolean;
        proposal_id: null;
        proposal_path: null;
    }>;
    private finalize;
}
