export declare const AGENT_ACTIVITY_SCHEMA_VERSION = 1;
export declare const AGENT_ACTIVITY_HUB_TYPE = "tracekeeper_agent_activity_hub";
export type ProposalHistoryLocation = 'active' | 'archive';
export type AuditEventSourceKind = 'legacy' | 'shard';
export interface StableAuditEventIdentity {
    operationId?: string;
    requestId?: string;
    invocationId?: string;
    timestamp?: string;
    [key: string]: unknown;
}
export interface MergeableAuditEvent {
    auditEventId?: string;
    timestamp: string;
    sourcePath: string;
    sourceKind: AuditEventSourceKind;
    [key: string]: unknown;
}
export interface AuditCleanupFileInput {
    path: string;
    contentHash: string;
    version: string;
    eventTimes: readonly string[];
}
export interface AuditCleanupCurrentFile {
    path: string;
    contentHash: string;
    version: string;
}
export interface AuditCleanupPreviewFile {
    path: string;
    sourceKind: AuditEventSourceKind;
    contentHash: string;
    version: string;
    earliestEventTime: string | null;
    latestEventTime: string | null;
    eventCount: number;
}
export type AuditCleanupRetainedReason = 'non-audit' | 'mixed-age' | 'too-new' | 'empty-or-unparseable';
export interface AuditCleanupRetainedFile extends Omit<AuditCleanupPreviewFile, 'sourceKind'> {
    sourceKind: AuditEventSourceKind | null;
    reason: AuditCleanupRetainedReason;
}
export interface AuditCleanupPreview {
    schemaVersion: 1;
    cutoff: string | null;
    eligiblePaths: string[];
    eligible: AuditCleanupPreviewFile[];
    retained: AuditCleanupRetainedFile[];
    bindingHash: string;
}
export type AuditCleanupPreviewValidation = {
    status: 'ready';
    files: AuditCleanupPreviewFile[];
} | {
    status: 'stale';
    reason: 'cutoff' | 'file-set' | 'missing' | 'content-hash' | 'version';
    paths: string[];
} | {
    status: 'rejected';
    reason: 'invalid-preview' | 'non-audit-target';
    paths: string[];
};
export interface ProposalHistoryRecord {
    path: string;
    proposalId: string;
    location: ProposalHistoryLocation;
    contentHash: string;
}
export type ProposalHistoryResolution = {
    status: 'resolved';
    proposalId: string;
    record: ProposalHistoryRecord;
    matches: ProposalHistoryRecord[];
} | {
    status: 'missing';
    proposalId: string;
    matches: [];
} | {
    status: 'ambiguous';
    proposalId: string;
    matches: ProposalHistoryRecord[];
};
export interface ProposalReferenceBackfillInput {
    referencePath: string;
    proposals: readonly ProposalHistoryRecord[];
    expectedReferenceHash?: string;
    currentReferenceHash?: string;
    managedRecord?: boolean;
}
export type ProposalReferenceBackfillPlan = {
    status: 'ready';
    referencePath: string;
    proposalId: string;
    proposalPath: string;
    contentHash: string;
} | {
    status: 'missing' | 'ambiguous' | 'stale' | 'unmanaged';
    referencePath: string;
    matches: ProposalHistoryRecord[];
};
export declare function renderAgentActivityHub(timestamp: string): string;
export declare function validateAgentActivityHubMarkdown(content: string): boolean;
export declare function auditShardPath(timestamp: string): string;
export declare function buildStableAuditEventId(event: StableAuditEventIdentity): string;
export declare function mergeAuditEvents<T extends MergeableAuditEvent>(events: readonly T[]): T[];
export declare function buildAuditCleanupPreview(input: {
    cutoff: string | null;
    files: readonly AuditCleanupFileInput[];
}): AuditCleanupPreview;
export declare function validateAuditCleanupPreview(input: {
    preview: AuditCleanupPreview;
    cutoff: string | null;
    currentFiles: readonly AuditCleanupCurrentFile[];
}): AuditCleanupPreviewValidation;
export declare function buildStableProposalId(identity: string): string;
export declare function proposalHistoryLocation(path: string): ProposalHistoryLocation | null;
export declare function resolveProposalHistoryById(records: readonly ProposalHistoryRecord[], proposalId: string): ProposalHistoryResolution;
export declare function planProposalReferenceBackfill(input: ProposalReferenceBackfillInput): ProposalReferenceBackfillPlan;
