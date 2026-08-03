import { type SourceAnalysisContentLanguage } from '@tracekeeper/core';
export interface SourceRequestRecord {
    type: string;
    path: string;
    source: string;
    sourceKind: string;
    purpose: string;
    relatedProject: string;
    analysisMode: string;
    status: string;
    taskId: string;
    created: string;
    content: string;
    filename: string;
}
export interface SourceRequestManagedProposal {
    proposalId: string;
    path: string;
    linkTarget: string;
    link?: string;
}
export interface SourceRequestNote {
    path: string;
    audit_path: string;
    status: string;
    warnings: string[];
}
export type SourceRequestWriteKind = 'source' | 'report' | 'proposal';
export interface SourceRequestWriteInput {
    kind: SourceRequestWriteKind;
    toolName: string;
    filename: string;
    frontmatter: Record<string, unknown>;
    body: string;
    taskId: string | null;
    metadata: Record<string, unknown>;
}
export interface SourceRequestAuditInput {
    tool: string;
    targetPath: string;
    status: 'written' | 'failed';
    taskId: string | null;
    metadata: Record<string, unknown>;
}
export interface SourceRequestApplicationDependencies {
    readRequest(requestPath: string): Promise<SourceRequestRecord>;
    readSourceText(sourcePath: string): Promise<string | null>;
    writeNote(input: SourceRequestWriteInput): Promise<SourceRequestNote>;
    updateRequestStatus(requestPath: string, status: string): Promise<{
        path: string;
    }>;
    appendAudit(input: SourceRequestAuditInput): Promise<{
        path: string;
    }>;
    updateTaskRecord(taskId: string | null, notePaths: string[], proposals: readonly SourceRequestManagedProposal[]): Promise<string | null>;
    updateManagedProposalReferences(recordPath: string, proposals: readonly SourceRequestManagedProposal[]): Promise<void>;
    assertSafeText(values: Array<{
        label: string;
        value: string;
    }>): void;
    renderText(zh: string, en: string): string;
    contentLanguage: SourceAnalysisContentLanguage;
    now(): string;
    buildFilename(rawFilename: string, fallbackPrefix: string): string;
}
export interface SourceRequestApplicationRequest {
    requestPath: string;
    taskId: string | null;
    updateRequestStatus: boolean;
    forceReprocess: boolean;
    toolName: string;
}
export interface SourceRequestApplicationResult {
    ok: true;
    read_only: false;
    tool: string;
    status: 'completed';
    request_path: string;
    mode: 'external_reference' | 'local_copy' | 'extracted_snapshot';
    source_note: {
        path: string;
        audit_path: string;
    };
    report: {
        path: string;
        audit_path: string;
    };
    proposals: Array<{
        proposal_id: string;
        path: string;
        proposal_link_target: string;
    }>;
    audit_path: string;
    summary: string;
    warnings: string[];
}
export declare class SourceRequestApplicationService {
    private readonly dependencies;
    constructor(dependencies: SourceRequestApplicationDependencies);
    execute(input: SourceRequestApplicationRequest): Promise<SourceRequestApplicationResult>;
}
