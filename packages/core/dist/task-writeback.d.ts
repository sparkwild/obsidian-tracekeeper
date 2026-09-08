import { type TaskTargetKind } from './task-record';
export interface ApprovedWritebackTaskLinkPlanInput {
    taskContent: string;
    operationId?: string;
    targetIdentity?: {
        kind: TaskTargetKind;
        id: string | null;
    };
    targetPath: string;
    proposalId: string;
    proposalPath: string;
    usesStableProposalReferences: boolean;
    usesAppliedProposalEvidence: boolean;
}
export interface ApprovedWritebackTaskLinkPlan {
    content: string;
    contentHashBefore: string;
    contentHashAfter: string;
    hadTargetReference: boolean;
    hadProposalReference: boolean;
    hadProposalIdReference: boolean;
    hadProposalPathEvidence: boolean;
    hadAppliedProposalReference: boolean;
}
/**
 * 规划一次 approved writeback 对任务引用的确定性更新。
 *
 * @description 批次预览和 Runtime 写回必须复用此函数，确保逐项任务哈希链与实际持久化内容完全一致。
 */
export declare function planApprovedWritebackTaskLink(input: ApprovedWritebackTaskLinkPlanInput): ApprovedWritebackTaskLinkPlan;
