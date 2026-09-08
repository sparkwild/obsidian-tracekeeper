export type TaskRelationRole = 'captured_source' | 'written_output' | 'review_proposal' | 'context_reference';
export type TaskTargetKind = 'source' | 'memory' | 'wiki' | 'proposal' | 'unknown';
export interface TaskRelationFact {
    relation_id: string;
    role: TaskRelationRole;
    target_kind: TaskTargetKind;
    target_id: string | null;
    recorded_path: string;
    recorded_at: string | null;
    operation_id: string | null;
    content_hash: string | null;
    unverified_reason?: string;
}
export interface TaskRecordV2 {
    version: 2;
    task_id: string;
    status: string;
    objective: string;
    project_id: string | null;
    repo_path: string | null;
    started_at: string | null;
    recorded_at: string | null;
    relations: TaskRelationFact[];
}
export interface TaskRelationTarget {
    path: string;
    frontmatter: Readonly<Record<string, unknown>>;
    contentHash?: string;
    content?: string;
    historical_paths?: readonly string[];
}
export interface ResolvedTaskRelation {
    fact: TaskRelationFact;
    status: 'resolved' | 'missing' | 'ambiguous' | 'unverified';
    current_path: string | null;
    location: 'active' | 'archive' | null;
}
export declare class TaskMigrationRequiredError extends Error {
    readonly taskId: string;
    readonly code = "TASK_MIGRATION_REQUIRED";
    constructor(taskId: string);
}
export declare const isTaskRecordType: (value: unknown) => boolean;
export declare const TASK_REFERENCE_FIELDS: readonly ["source_captures", "memory_writes", "memory_reads", "proposal_ids", "proposal_paths", "proposals", "proposal_link_targets", "proposal_links", "related_wiki", "related_sources"];
export declare const TASK_RELATIONS_BEGIN = "<!-- tracekeeper:task-relations:start -->";
export declare const TASK_RELATIONS_END = "<!-- tracekeeper:task-relations:end -->";
/** 旧格式仅在此处拆分；V2 关系不按逗号拆分路径。 */
export declare function legacyTaskReferenceList(value: unknown): string[];
export declare function assertTaskRelationPath(value: string): void;
/** 解析权威关系；损坏的 V2 不降级为旧格式。 */
export declare function parseTaskRecord(fields: Readonly<Record<string, unknown>>): TaskRecordV2 | null;
/** 目标身份包含记录种类；Source ID 本身不能区分捕获批次。 */
export declare function taskTargetIdentity(target: TaskRelationTarget): {
    kind: TaskTargetKind;
    id: string | null;
};
export declare function makeTaskRelation(input: {
    taskId: string;
    role: TaskRelationRole;
    path: string;
    target?: TaskRelationTarget;
    operationId?: string | null;
    recordedAt?: string | null;
    proposalId?: string;
}): TaskRelationFact;
export declare function resolveTaskRelations(record: TaskRecordV2, targets: readonly TaskRelationTarget[]): ResolvedTaskRelation[];
/** 现有响应字段只作为内存投影，绝不重新写入任务文件。 */
export declare function taskReferenceFields(fields: Readonly<Record<string, unknown>>, targets?: readonly TaskRelationTarget[]): Record<string, unknown>;
/** 只替换指定的根属性，保留正文、换行和其他属性的原始字节。 */
export declare function patchTaskMetadata(content: string, values: Record<string, unknown>, remove?: readonly string[]): string;
export declare function updateTaskRelations(content: string, additions: readonly TaskRelationFact[]): string;
/** 显式迁移导入旧字段，无法证明的引用保持无身份状态。 */
export declare function migrateTaskRecord(content: string, targets: readonly TaskRelationTarget[]): string;
export declare function renderTaskRelationProjection(content: string, resolved: readonly ResolvedTaskRelation[], link: (path: string) => string): string;
/** 新建 Wiki 的身份也进入原写入计划，重试不能另行生成。 */
export declare function ensureWikiIdentity(content: string, seed: string): string;
/** 将规范解析结果适配到原生界面的标量字段，不使用界面的简化 YAML 解析器。 */
export declare function taskPresentationFields(content: string, targets?: readonly TaskRelationTarget[]): Record<string, string | string[]>;
export interface TaskRelationDiagnostic {
    path: string;
    kind: 'task_migration_required' | 'task_relation_invalid' | 'task_relation_unresolved' | 'task_identity_ambiguous' | 'wiki_identity_missing' | 'task_navigation_pending';
    message: string;
}
export declare function diagnoseTaskRelations(targets: readonly TaskRelationTarget[]): TaskRelationDiagnostic[];
