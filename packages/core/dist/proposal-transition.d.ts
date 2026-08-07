import { OperationConflictError } from './operation-journal';
import { type VaultPath } from './knowledge-index';
import { type VaultRepository, type VaultWriteReceipt } from './vault-repository';
export declare const PROPOSAL_TRANSITION_SCHEMA_VERSION: 1;
export type ProposalTransitionStatus = 'pending' | 'approved' | 'rejected' | 'deferred' | 'revision_requested' | 'applied';
export type ProposalTransitionClassification = 'memory_proposal' | 'legacy_migration_review' | 'other_review_item';
export type ProposalTransitionKind = 'status' | 'draft' | 'apply';
export interface ProposalTransitionReceipt {
    schemaVersion: typeof PROPOSAL_TRANSITION_SCHEMA_VERSION;
    operationId: string;
    payloadHash: string;
    kind: ProposalTransitionKind;
    proposalPath: string;
    proposalId: string;
    taskId: string;
    previousStatus: ProposalTransitionStatus;
    nextStatus: ProposalTransitionStatus;
    expectedRevision: string;
    expectedContentHash: string;
    previousRevision: string;
    committedRevision: string;
    previousContentHash: string;
    committedContentHash: string;
    committedAt: string;
}
export interface ProposalTransitionSnapshot {
    path: string;
    classification: ProposalTransitionClassification;
    proposalId: string;
    proposalKind: string;
    taskId: string;
    status: ProposalTransitionStatus;
    targetPath: string;
    writebackContent: string;
    revisionComment: string;
    revisionRequestedAt: string;
    revisionRequestedBy: string;
    archived?: boolean;
    appliedOperationId?: string;
    lastTransition?: ProposalTransitionReceipt;
}
export interface ProposalStatusTransitionAction {
    kind: 'status';
    nextStatus: ProposalTransitionStatus;
    clearRevision?: boolean;
    revisionComment?: string;
}
export interface ProposalDraftTransitionAction {
    kind: 'draft';
    targetPath: string;
    writebackContent: string;
}
export interface ProposalApplyTransitionAction {
    kind: 'apply';
}
export type ProposalTransitionAction = ProposalStatusTransitionAction | ProposalDraftTransitionAction | ProposalApplyTransitionAction;
export interface ProposalTransitionCommand {
    expectedRevision: string;
    expectedContentHash?: string;
    operationId: string;
    action: ProposalTransitionAction;
}
export interface ProposalTransitionEnvironment {
    now: string;
    actor?: string;
    targetExists?: (relativePath: string) => boolean;
    targetAllowed?: (relativePath: string) => boolean;
    targetCreationAllowed?: (relativePath: string) => boolean;
}
export type ProposalFrontmatterMutationValue = string | string[] | null;
export interface ProposalTransitionDecision {
    state: ProposalTransitionSnapshot;
    receipt: ProposalTransitionReceipt;
    frontmatter: Readonly<Record<string, ProposalFrontmatterMutationValue>>;
    replayed: boolean;
}
export interface ProposalTransitionTextCodec {
    parse(relativePath: string, content: string): ProposalTransitionSnapshot;
    apply(content: string, decision: ProposalTransitionDecision): string;
}
export interface ProposalRepositoryTransitionCommand {
    proposalPath: VaultPath;
    expectedVersion?: string;
    transition: ProposalTransitionCommand;
    environment: ProposalTransitionEnvironment;
}
export interface ProposalRepositoryTransitionResult extends ProposalTransitionDecision {
    writeReceipt: VaultWriteReceipt | null;
}
export declare class ProposalTransitionValidationError extends Error {
    constructor(message: string);
}
export declare class ProposalTransitionStateError extends Error {
    constructor(message: string);
}
export declare class ProposalTransitionConflictError extends OperationConflictError {
    constructor(message: string);
}
export declare function normalizeProposalTargetPath(value: string): string;
export declare function isAllowedProposalTargetPath(value: string): boolean;
export declare function computeProposalContentHash(snapshot: ProposalTransitionSnapshot): string;
export declare function computeProposalRevision(snapshot: ProposalTransitionSnapshot): string;
export declare function computeProposalTransitionPayloadHash(action: ProposalTransitionAction): string;
export declare function proposalTransitionReceiptFromFrontmatter(frontmatter: Readonly<Record<string, unknown>>): ProposalTransitionReceipt | undefined;
export declare function transitionProposal(current: ProposalTransitionSnapshot, command: ProposalTransitionCommand, environment: ProposalTransitionEnvironment): ProposalTransitionDecision;
export declare function commitProposalTransitionWithRepository(repository: VaultRepository, codec: ProposalTransitionTextCodec, command: ProposalRepositoryTransitionCommand): Promise<ProposalRepositoryTransitionResult>;
