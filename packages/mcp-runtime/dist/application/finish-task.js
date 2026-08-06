"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DistillSessionApplicationService = exports.FinishTaskApplicationService = void 0;
const core_1 = require("@tracekeeper/core");
class FinishTaskApplicationService {
    constructor(dependencies) {
        this.dependencies = dependencies;
    }
    async execute(rawArgs) {
        const { dependencies } = this;
        const requestSnapshot = dependencies.requestSnapshot(rawArgs);
        const requestHash = (0, core_1.computePayloadHash)(requestSnapshot);
        const identity = dependencies.createIdentity(requestHash, dependencies.requestIdempotencyKey(rawArgs), requestSnapshot);
        const existing = await dependencies.journal.loadByIdempotencyKey(identity.idempotencyKey);
        let operationPayload;
        if (existing) {
            if (existing.operation_id !== identity.operationId) {
                throw new Error(`Idempotency key conflict for "${identity.idempotencyKey}": associated with existing operation "${existing.operation_id}"`);
            }
            if (!dependencies.loadExistingPayload(existing.payload)) {
                throw new Error(`Idempotency key conflict for "${identity.idempotencyKey}" with incompatible finish_task request payload`);
            }
            const storedRequestHash = dependencies.storedRequestHash(existing.payload);
            if (storedRequestHash && storedRequestHash !== requestHash) {
                throw new Error(`Idempotency key conflict for "${identity.idempotencyKey}" with different finish_task request hash`);
            }
            operationPayload = existing.payload;
        }
        else {
            operationPayload = await dependencies.buildPayload(rawArgs, identity.operationId, requestHash, requestSnapshot);
            const lifecycle = await dependencies.readLifecycle(dependencies.getTaskId(operationPayload));
            if (lifecycle?.status === 'completed') {
                throw new Error(`Task is already completed: ${dependencies.getTaskId(operationPayload)}`);
            }
            if (lifecycle?.status === 'closing'
                && lifecycle.finishOperationId
                && lifecycle.finishOperationId !== identity.operationId) {
                throw new Error(`Task is closing under another operation: ${dependencies.getTaskId(operationPayload)}`);
            }
            await dependencies.markClosing(operationPayload, identity.operationId);
        }
        const runner = new core_1.RecoverableOperationRunner({
            operationId: identity.operationId,
            idempotencyKey: identity.idempotencyKey,
            payload: operationPayload,
            journal: dependencies.journal,
            failureInjection: dependencies.failureInjection,
            steps: dependencies.buildSteps(operationPayload, identity.operationId).map((step) => ({
                name: step.name,
                execute: () => step.execute(),
                persistResult: step.persistResult,
            })),
            finalize: () => dependencies.finalize(operationPayload, identity.operationId, identity.idempotencyKey),
        });
        return runner.run();
    }
}
exports.FinishTaskApplicationService = FinishTaskApplicationService;
class DistillSessionApplicationService {
    constructor(dependencies) {
        this.dependencies = dependencies;
    }
    requiredString(value, field) {
        if (typeof value !== 'string' || value.trim() === '') {
            throw new Error(`Missing required string argument: ${field}.`);
        }
        return value.trim();
    }
    stringArray(value, field) {
        if (value === undefined || value === null) {
            return [];
        }
        if (typeof value === 'string') {
            return value.trim() ? [value.trim()] : [];
        }
        if (Array.isArray(value)) {
            if (value.some((entry) => typeof entry !== 'string')) {
                throw new Error(`${field} array must contain only strings.`);
            }
            return value.map((entry) => entry.trim()).filter(Boolean);
        }
        throw new Error(`${field} must be a string or string array.`);
    }
    async execute(rawArgs) {
        const { dependencies } = this;
        const taskId = this.requiredString(rawArgs.task_id, 'task_id');
        const summary = this.requiredString(rawArgs.summary, 'summary');
        const decisions = this.stringArray(rawArgs.decisions, 'decisions');
        const nextActions = this.stringArray(rawArgs.next_actions, 'next_actions');
        const possiblePreferences = this.stringArray(rawArgs.possible_preferences, 'possible_preferences');
        const outcomes = this.stringArray(rawArgs.outcomes, 'outcomes');
        const explicitProjectHint = typeof rawArgs.project_hint === 'string'
            ? rawArgs.project_hint.trim()
            : '';
        const projectHint = await dependencies.resolveProjectHint(taskId, explicitProjectHint);
        dependencies.assertSafeText([
            { label: 'summary', value: summary },
            { label: 'decisions', value: decisions.join('\n') },
            { label: 'next_actions', value: nextActions.join('\n') },
            { label: 'possible_preferences', value: possiblePreferences.join('\n') },
            { label: 'outcomes', value: outcomes.join('\n') },
            { label: 'project_hint', value: projectHint },
        ]);
        const now = dependencies.now();
        const filename = dependencies.buildFilename(rawArgs.filename, 'session');
        const body = dependencies.buildBody(summary, outcomes, nextActions, decisions, possiblePreferences);
        const note = await dependencies.writeSessionNote({
            filename,
            frontmatter: {
                tool: 'tracekeeper.distill_session',
                type: 'session_note',
                title: dependencies.renderText(`任务 ${taskId} 提炼记录`, `Task ${taskId} distill note`),
                task_id: taskId,
                project_hint: projectHint || null,
                related_project: projectHint || null,
                created_at: now,
            },
            body,
            taskId,
            metadata: { target_type: 'session_note', task_stage: 'distill' },
        });
        const proposals = [];
        if (decisions.length > 0 && dependencies.memoryProposalAllowed('distill_decisions', projectHint)) {
            proposals.push(await dependencies.createProposal({
                taskId,
                proposalKind: 'distill_decisions',
                kindLabel: 'Decisions',
                values: decisions,
                projectHint,
            }));
        }
        if (possiblePreferences.length > 0 && dependencies.memoryProposalAllowed('distill_preferences', projectHint)) {
            proposals.push(await dependencies.createProposal({
                taskId,
                proposalKind: 'distill_preferences',
                kindLabel: 'Possible Preferences',
                values: possiblePreferences,
                projectHint,
            }));
        }
        const taskPath = await dependencies.updateTask(taskId, note.path, proposals);
        await dependencies.updateManagedProposalReferences(note.path, proposals);
        if (taskPath) {
            await dependencies.updateManagedProposalReferences(taskPath, proposals);
        }
        return {
            ok: true,
            read_only: false,
            task_id: taskId,
            path: note.path,
            activity_path: note.activity_path,
            proposals: proposals.map((proposal) => ({
                proposal_id: proposal.proposalId,
                path: proposal.path,
                proposal_link_target: proposal.linkTarget,
            })),
            proposal_count: proposals.length,
        };
    }
}
exports.DistillSessionApplicationService = DistillSessionApplicationService;
