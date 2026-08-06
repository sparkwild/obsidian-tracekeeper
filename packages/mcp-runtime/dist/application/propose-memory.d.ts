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
    idempotency_key?: unknown;
}
export interface ProposeMemoryRequestSnapshot {
    proposal_kind: string;
    content: string;
    evidence: string | null;
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
    createdAt: string;
}
export type ProposeMemoryImmutableWriteResult = {
    status: 'review_required';
} | {
    status: 'created' | 'exact_retry';
    path: string;
    activity_path: string;
    project_id: string;
    project_hub: string;
    agent_type: string;
    operation_hash: string;
    hub_status: string;
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
    writeImmutableProjectMemory(input: ProposeMemoryImmutableWriteInput): Promise<ProposeMemoryImmutableWriteResult>;
    resolveAutoMemoryTarget(proposalKind: string, targetNote: string, projectHint: string, memoryScope: ProposeMemoryScope): {
        targetNote: string;
        allowedDir: string;
    } | null;
    appendAutoMemoryWrite(input: ProposeMemoryAutoWriteInput): Promise<ProposeMemoryNote>;
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
}
export interface ProposeMemoryApplicationRequest {
    rawArgs: ProposeMemoryRawRequest;
}
export declare class ProposeMemoryApplicationService {
    private readonly dependencies;
    constructor(dependencies: ProposeMemoryApplicationDependencies);
    execute(request: ProposeMemoryApplicationRequest): Promise<{
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
        memory_rule: ProposeMemoryRule;
        memory_scope: ProposeMemoryScope;
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
        memory_rule: string;
        memory_scope: "project";
        project_id: string;
        project_hub: string;
        project_hint: string | null;
        agent_type: string;
        operation_hash: string;
        related_wiki: string[];
        related_sources: string[];
        missing_related_sources: string[];
        architecture_status: "healthy" | "needs_attention";
        missing_graph_bridges: string[];
        missing_wiki_bridge: boolean;
        proposal_id: null;
        proposal_path: null;
    } | {
        ok: boolean;
        tool: string;
        operation_id: string;
        idempotency_key: string;
        status: string;
        path: string;
        target_note: string;
        activity_path: string;
        warnings: string[];
        auto_applied: boolean;
        duplicate: boolean;
        memory_rule: string;
        memory_scope: ProposeMemoryScope;
        project_hint: string | null;
        related_wiki: string[];
        related_sources: string[];
        missing_related_sources: string[];
        architecture_status: "healthy" | "needs_attention";
        missing_graph_bridges: string[];
        missing_wiki_bridge: boolean;
        proposal_id: null;
        proposal_path: null;
        project_id?: undefined;
        project_hub?: undefined;
        agent_type?: undefined;
        operation_hash?: undefined;
    }>;
    private finalize;
}
