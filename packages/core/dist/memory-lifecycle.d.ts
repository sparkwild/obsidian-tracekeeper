import type { MemoryAuthority, MemoryConfidenceLevel, MemoryRecord, MemoryRecordReadProjection } from './memory-record';
export interface MemoryGovernanceProposal {
    proposed_authority?: MemoryAuthority;
    proposed_confidence?: MemoryConfidenceLevel;
    evidence_count: number;
    human_approved?: boolean;
    source_backed?: boolean;
}
export interface MemoryGovernanceDecision {
    authority: MemoryAuthority;
    confidence_level: MemoryConfidenceLevel;
    downgraded: boolean;
}
export type MemoryEffectiveState = 'current' | 'superseded' | 'disputed' | 'retracted' | 'review' | 'legacy_unkeyed';
export type MemoryLifecycleIssueCode = 'duplicate_memory_id' | 'dangling_supersedes' | 'dangling_contradicts' | 'cross_claim_relation' | 'supersession_cycle' | 'duplicate_current' | 'stale_verification';
export interface MemoryLifecycleIssue {
    code: MemoryLifecycleIssueCode;
    memory_ids: readonly string[];
    reference?: string;
    message: string;
}
export interface ResolvedMemoryRecord {
    record: MemoryRecord;
    effective_state: MemoryEffectiveState;
    reasons: readonly string[];
}
export interface LegacyMemoryLifecycleRow {
    projection: Exclude<MemoryRecordReadProjection, {
        kind: 'v2';
    }>;
    effective_state: 'legacy_unkeyed';
    reasons: readonly ['missing_claim_key'];
}
export interface MemoryLifecycleProjection {
    generation: number;
    resolved_at: string;
    records: readonly ResolvedMemoryRecord[];
    legacy: readonly LegacyMemoryLifecycleRow[];
    current: readonly ResolvedMemoryRecord[];
    history: readonly ResolvedMemoryRecord[];
    conflicts: readonly ResolvedMemoryRecord[];
    issues: readonly MemoryLifecycleIssue[];
}
export interface ResolveMemoryLifecycleInput {
    generation: number;
    records: readonly MemoryRecord[];
    legacy?: readonly Exclude<MemoryRecordReadProjection, {
        kind: 'v2';
    }>[];
    now?: string;
    staleAfterDays?: number;
}
export declare function deriveMemoryGovernance(input: MemoryGovernanceProposal): MemoryGovernanceDecision;
export declare function resolveMemoryLifecycle(input: ResolveMemoryLifecycleInput): MemoryLifecycleProjection;
