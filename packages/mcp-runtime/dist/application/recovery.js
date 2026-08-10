"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RuntimeRecoveryController = void 0;
exports.recoveryRequestForRecord = recoveryRequestForRecord;
function recoveryRequestForRecord(record, dependencies) {
    if (!record.payload || typeof record.payload !== 'object') {
        return null;
    }
    const payload = record.payload;
    if (record.operation_id.startsWith('start-task-')) {
        return {
            tool: 'tracekeeper.start_task',
            args: {
                goal: payload.goal,
                client: payload.client,
                project_hint: payload.projectHint,
                project_id: payload.projectId,
                repo_path: payload.repoPath,
                idempotency_key: record.idempotency_key,
            },
        };
    }
    if (record.operation_id.startsWith('finish-task-')) {
        if (payload.requestSnapshot && typeof payload.requestSnapshot === 'object') {
            return {
                tool: 'tracekeeper.finish_task',
                args: {
                    ...payload.requestSnapshot,
                    idempotency_key: record.idempotency_key,
                },
            };
        }
        return {
            tool: 'tracekeeper.finish_task',
            args: {
                task_id: payload.taskId,
                summary: payload.summary,
                status: payload.status,
                outcomes: payload.outcomes,
                decisions: payload.decisions,
                solution_changes: payload.solutionChanges,
                lessons: payload.lessons,
                preferences: payload.preferences,
                memory_candidate_records: payload.memoryCandidateRecords,
                next_actions: payload.nextActions,
                client: payload.client,
                project_hint: payload.projectHint,
                project_id: payload.projectId,
                repo_path: payload.repoPath,
                related_wiki: payload.relatedWiki,
                related_sources: payload.relatedSources,
                filename: payload.filename,
                idempotency_key: record.idempotency_key,
            },
        };
    }
    if (record.operation_id.startsWith('propose-memory-')
        && dependencies.isProposeMemoryOperationPayload(payload)
        && payload.requestSnapshot
        && typeof payload.requestSnapshot === 'object') {
        return {
            tool: 'tracekeeper.propose_memory',
            args: {
                ...payload.requestSnapshot,
                idempotency_key: record.idempotency_key,
            },
        };
    }
    if (record.operation_id.startsWith('writeback-')) {
        return {
            tool: 'tracekeeper.apply_approved_writeback',
            args: {
                proposal_path: payload.proposalPath,
                task_id: payload.taskId,
            },
        };
    }
    return null;
}
class RuntimeRecoveryController {
    constructor(journal, dependencies) {
        this.journal = journal;
        this.dependencies = dependencies;
    }
    async recover(vaultRoot) {
        const records = await this.journal.listRecoverable();
        const report = { recovered: [], failed: [], skipped: [] };
        for (const record of records) {
            const incompatibleWriteback = record.operation_id.startsWith('writeback-')
                && !this.dependencies.isApplyApprovedWritebackPayload(record.payload);
            const incompatibleFinishTask = record.operation_id.startsWith('finish-task-')
                && this.dependencies.isFinishTaskV2Payload !== undefined
                && !this.dependencies.isFinishTaskV2Payload(record.payload);
            if (incompatibleWriteback || incompatibleFinishTask) {
                if (incompatibleFinishTask && this.dependencies.releaseIncompatibleFinishTaskBinding) {
                    try {
                        await this.dependencies.releaseIncompatibleFinishTaskBinding(record, vaultRoot);
                    }
                    catch (error) {
                        report.failed.push({
                            operation_id: record.operation_id,
                            error: error instanceof Error ? error.message : String(error),
                        });
                        continue;
                    }
                }
                const recoveryError = incompatibleFinishTask
                    ? 'Unfinished legacy finish_task recovery requires a fresh MemoryRecord v2 closeout.'
                    : 'Incompatible writeback recovery record requires a fresh preview.';
                const failedAt = new Date().toISOString();
                await this.journal.save({
                    operation_id: record.operation_id,
                    idempotency_key: record.idempotency_key,
                    payload_hash: record.payload_hash,
                    status: 'conflicted',
                    created_at: record.created_at,
                    updated_at: failedAt,
                    failed_at: failedAt,
                    error: recoveryError,
                    completed_steps: record.completed_steps.map((step) => ({
                        name: step.name,
                        completed_at: step.completed_at,
                    })),
                });
                report.failed.push({
                    operation_id: record.operation_id,
                    error: recoveryError,
                });
                continue;
            }
            const request = recoveryRequestForRecord(record, this.dependencies);
            if (!request) {
                report.skipped.push(record.operation_id);
                continue;
            }
            const result = await this.dependencies.invoke(request, record, vaultRoot);
            if (result.isError) {
                report.failed.push({
                    operation_id: record.operation_id,
                    error: result.error || 'Operation recovery failed.',
                });
                continue;
            }
            report.recovered.push(record.operation_id);
        }
        return report;
    }
}
exports.RuntimeRecoveryController = RuntimeRecoveryController;
