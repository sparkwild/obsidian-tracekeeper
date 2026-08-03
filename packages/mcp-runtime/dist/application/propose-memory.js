"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProposeMemoryApplicationService = void 0;
const core_1 = require("@tracekeeper/core");
function optionalString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function requiredString(value, field) {
    const normalized = optionalString(value);
    if (!normalized) {
        throw new Error(`Missing required string argument: ${field}.`);
    }
    return normalized;
}
function stringArray(value, field) {
    if (value === undefined || value === null) {
        return [];
    }
    if (typeof value === 'string') {
        const normalized = value.trim();
        return normalized ? [normalized] : [];
    }
    if (Array.isArray(value)) {
        if (value.some((entry) => typeof entry !== 'string')) {
            throw new Error(`${field} array must contain only strings.`);
        }
        return value.map((entry) => entry.trim()).filter(Boolean);
    }
    throw new Error(`${field} must be a string or string array.`);
}
function dedupeList(values) {
    return [...new Set(values
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => value.replace(/\s+/g, ' '))
            .sort((left, right) => left.localeCompare(right)))];
}
function normalizeMultiValueList(value, field) {
    const normalized = [];
    for (const entry of stringArray(value, field)) {
        normalized.push(...entry.split(/[\n,]/g).map((item) => item.trim()).filter(Boolean));
    }
    return dedupeList(normalized);
}
function requestSnapshot(rawArgs) {
    return {
        proposal_kind: requiredString(rawArgs.proposal_kind, 'proposal_kind'),
        content: requiredString(rawArgs.content, 'content'),
        evidence: optionalString(rawArgs.evidence) || null,
        target_note: optionalString(rawArgs.target_note) || null,
        risk_level: optionalString(rawArgs.risk_level) || null,
        task_id: optionalString(rawArgs.task_id) || null,
        filename: optionalString(rawArgs.filename) || null,
        title: optionalString(rawArgs.title) || null,
        project_hint: optionalString(rawArgs.project_hint) || null,
        project_id: optionalString(rawArgs.project_id) || null,
        repo_path: optionalString(rawArgs.repo_path) || null,
        repo: optionalString(rawArgs.repo) || null,
        project_path: optionalString(rawArgs.project_path) || null,
        memory_scope: optionalString(rawArgs.memory_scope) || null,
        related_wiki: normalizeMultiValueList(rawArgs.related_wiki, 'related_wiki'),
        related_sources: normalizeMultiValueList(rawArgs.related_sources, 'related_sources'),
    };
}
function validOperationPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return false;
    }
    const value = payload;
    const snapshot = value.requestSnapshot;
    if (!snapshot || typeof snapshot !== 'object') {
        return false;
    }
    const request = snapshot;
    return typeof value.requestHash === 'string'
        && value.requestHash.length > 0
        && typeof request.proposal_kind === 'string'
        && request.proposal_kind.length > 0
        && typeof request.content === 'string'
        && request.content.length > 0
        && Array.isArray(request.related_wiki)
        && request.related_wiki.every((entry) => typeof entry === 'string')
        && Array.isArray(request.related_sources)
        && request.related_sources.every((entry) => typeof entry === 'string')
        && typeof value.projectMemoryCreatedAt === 'string'
        && !Number.isNaN(Date.parse(value.projectMemoryCreatedAt))
        && typeof value.projectMemoryAgentType === 'string'
        && value.projectMemoryAgentType.length > 0;
}
class ProposeMemoryApplicationService {
    constructor(dependencies) {
        this.dependencies = dependencies;
    }
    async execute(request) {
        const snapshot = requestSnapshot(request.rawArgs);
        const requestHash = (0, core_1.computePayloadHash)(snapshot);
        const idempotencyKey = optionalString(request.rawArgs.idempotency_key);
        const identity = this.dependencies.createIdentity(requestHash, idempotencyKey);
        const existing = await this.dependencies.journal.loadByIdempotencyKey(identity.idempotencyKey);
        let operationPayload;
        if (existing) {
            if (existing.operation_id !== identity.operationId) {
                throw new core_1.OperationConflictError(`Idempotency key conflict for "${identity.idempotencyKey}": associated with existing operation "${existing.operation_id}"`);
            }
            if (!validOperationPayload(existing.payload)) {
                throw new core_1.OperationConflictError(`Idempotency key conflict for "${identity.idempotencyKey}" with an incompatible legacy propose_memory operation`);
            }
            if (existing.payload.requestHash !== requestHash) {
                throw new core_1.OperationConflictError(`Idempotency key conflict for "${identity.idempotencyKey}" with different propose_memory request hash`);
            }
            operationPayload = existing.payload;
        }
        else {
            operationPayload = {
                requestHash,
                requestSnapshot: snapshot,
                projectMemoryCreatedAt: this.dependencies.now(),
                projectMemoryAgentType: this.dependencies.observedAgentType,
            };
        }
        const runner = new core_1.RecoverableOperationRunner({
            operationId: identity.operationId,
            idempotencyKey: identity.idempotencyKey,
            payload: operationPayload,
            journal: this.dependencies.journal,
            failureInjection: this.dependencies.failureInjection,
            steps: [],
            finalize: () => this.finalize(operationPayload.requestSnapshot, identity, operationPayload.projectMemoryCreatedAt, operationPayload.projectMemoryAgentType),
        });
        return runner.run();
    }
    async finalize(snapshot, identity, operationCreatedAt, projectMemoryAgentType) {
        const { dependencies } = this;
        const proposalKind = snapshot.proposal_kind;
        const content = snapshot.content;
        const evidence = snapshot.evidence || '';
        const targetNote = snapshot.target_note || '';
        const riskLevel = snapshot.risk_level || '';
        const title = snapshot.title || '';
        const taskId = snapshot.task_id || null;
        const projectHint = snapshot.project_hint || '';
        const proposalId = (0, core_1.buildStableProposalId)(`${identity.operationId}\0${proposalKind}`);
        const memoryScope = dependencies.resolveMemoryScope(proposalKind, targetNote, projectHint, snapshot.memory_scope);
        const architectureStatus = dependencies.buildArchitectureStatus();
        const bridgeMetadata = dependencies.resolveBridgeMetadata(memoryScope, projectHint, snapshot.related_wiki, snapshot.related_sources);
        const resolvedProjectIdentity = memoryScope === 'project'
            ? dependencies.resolveProjectIdentity(snapshot)
            : null;
        const now = dependencies.now();
        dependencies.assertAllowed(proposalKind, targetNote, projectHint, memoryScope);
        dependencies.assertSafeText([
            { label: 'content', value: content },
            { label: 'evidence', value: evidence },
            { label: 'target_note', value: targetNote },
            { label: 'title', value: title },
            { label: 'project_hint', value: projectHint },
            { label: 'related_wiki', value: snapshot.related_wiki.join('\n') },
            { label: 'related_sources', value: snapshot.related_sources.join('\n') },
        ]);
        const memoryRule = dependencies.memoryRule(proposalKind, targetNote, projectHint, memoryScope);
        let immutableReviewRequired = false;
        if (memoryRule === 'auto_write') {
            const canAutoWrite = !(memoryScope === 'project' && bridgeMetadata.missing_wiki_bridge);
            if (canAutoWrite && memoryScope === 'project') {
                const useResolvedIdentity = resolvedProjectIdentity && resolvedProjectIdentity.confidence !== 'uncertain';
                const immutable = await dependencies.writeImmutableProjectMemory({
                    projectId: useResolvedIdentity ? resolvedProjectIdentity?.projectId : snapshot.project_id || undefined,
                    projectHint: useResolvedIdentity ? resolvedProjectIdentity?.projectHint : snapshot.project_hint || undefined,
                    repoPath: useResolvedIdentity
                        ? resolvedProjectIdentity?.repoPath
                        : snapshot.repo_path || snapshot.repo || snapshot.project_path || undefined,
                    agentType: projectMemoryAgentType,
                    taskId,
                    operationId: identity.operationId,
                    operationKind: 'propose_memory',
                    memoryKinds: [proposalKind],
                    body: content,
                    relatedWiki: bridgeMetadata.related_wiki,
                    relatedSources: bridgeMetadata.related_sources,
                    createdAt: operationCreatedAt,
                });
                if (immutable.status !== 'review_required') {
                    await dependencies.updateTaskMemoryWrite(taskId, immutable.path);
                    return {
                        ok: true,
                        tool: 'tracekeeper.propose_memory',
                        operation_id: identity.operationId,
                        idempotency_key: identity.idempotencyKey,
                        status: immutable.write_status,
                        path: immutable.path,
                        target_note: immutable.path,
                        audit_path: immutable.audit_path,
                        warnings: [],
                        auto_applied: true,
                        duplicate: immutable.duplicate,
                        memory_rule: 'auto_write',
                        memory_scope: memoryScope,
                        project_id: immutable.project_id,
                        project_hub: immutable.project_hub,
                        project_hint: projectHint || null,
                        agent_type: immutable.agent_type,
                        operation_hash: immutable.operation_hash,
                        related_wiki: bridgeMetadata.related_wiki,
                        related_sources: bridgeMetadata.related_sources,
                        missing_related_sources: bridgeMetadata.missing_related_sources,
                        architecture_status: architectureStatus.architecture_status,
                        missing_graph_bridges: architectureStatus.missing_graph_bridges,
                        missing_wiki_bridge: false,
                        proposal_id: null,
                        proposal_path: null,
                    };
                }
                immutableReviewRequired = true;
            }
            const autoTarget = canAutoWrite && memoryScope === 'global'
                ? dependencies.resolveAutoMemoryTarget(proposalKind, targetNote, projectHint, memoryScope)
                : null;
            if (autoTarget) {
                const note = await dependencies.appendAutoMemoryWrite({
                    proposalKind,
                    targetNote: autoTarget.targetNote,
                    allowedDir: autoTarget.allowedDir,
                    title: title || dependencies.renderText(`记忆更新：${proposalKind}`, `Memory update: ${proposalKind}`),
                    content,
                    operationId: identity.operationId,
                    taskId,
                    memoryScope,
                    projectHint,
                    relatedWiki: bridgeMetadata.related_wiki,
                    relatedSources: bridgeMetadata.related_sources,
                    architectureStatus,
                    missingGraphBridges: architectureStatus.missing_graph_bridges,
                    missingWikiBridge: false,
                    missingRelatedWiki: bridgeMetadata.missing_related_wiki,
                    missingRelatedSources: bridgeMetadata.missing_related_sources,
                    evidence,
                    riskLevel,
                });
                await dependencies.updateTaskMemoryWrite(taskId, note.path);
                return {
                    ok: true,
                    tool: 'tracekeeper.propose_memory',
                    operation_id: identity.operationId,
                    idempotency_key: identity.idempotencyKey,
                    status: note.status,
                    path: note.path,
                    target_note: note.path,
                    audit_path: note.audit_path,
                    warnings: note.warnings,
                    auto_applied: true,
                    duplicate: note.duplicate ?? false,
                    memory_rule: 'auto_write',
                    memory_scope: memoryScope,
                    project_hint: projectHint || null,
                    related_wiki: bridgeMetadata.related_wiki,
                    related_sources: bridgeMetadata.related_sources,
                    missing_related_sources: bridgeMetadata.missing_related_sources,
                    architecture_status: architectureStatus.architecture_status,
                    missing_graph_bridges: architectureStatus.missing_graph_bridges,
                    missing_wiki_bridge: false,
                    proposal_id: null,
                    proposal_path: null,
                };
            }
        }
        const proposalTargetNote = immutableReviewRequired && memoryScope === 'project' ? '' : targetNote;
        const body = [
            dependencies.renderText('## 记忆提案', '## Proposal'),
            '- status: pending',
            `- proposal_kind: ${proposalKind}`,
            evidence ? `- evidence: ${evidence}` : '',
            proposalTargetNote ? `- target_note: ${proposalTargetNote}` : '',
            `- memory_scope: ${memoryScope}`,
            projectHint ? `- project_hint: ${projectHint}` : '',
            bridgeMetadata.related_wiki.length ? `- related_wiki: ${JSON.stringify(bridgeMetadata.related_wiki)}` : '',
            bridgeMetadata.related_sources.length ? `- related_sources: ${JSON.stringify(bridgeMetadata.related_sources)}` : '',
            riskLevel ? `- risk_level: ${riskLevel}` : '',
            `- architecture_status: ${architectureStatus.architecture_status}`,
            `- missing_graph_bridges: ${JSON.stringify(architectureStatus.missing_graph_bridges)}`,
            bridgeMetadata.missing_wiki_bridge ? '- missing_wiki_bridge: true' : '',
            bridgeMetadata.missing_related_wiki.length ? `- missing_related_wiki: ${JSON.stringify(bridgeMetadata.missing_related_wiki)}` : '',
            bridgeMetadata.missing_related_sources.length ? `- missing_related_sources: ${JSON.stringify(bridgeMetadata.missing_related_sources)}` : '',
            '',
            dependencies.renderText('## 写回内容', '## Writeback'),
            content,
        ].filter(Boolean).join('\n');
        const filename = dependencies.buildFilename(snapshot.filename, `proposal-${identity.operationId}`);
        const existing = await dependencies.findOwnedProposalNote(filename, identity.operationId);
        const note = existing || await dependencies.writeProposalNote({
            filename,
            frontmatter: {
                tool: 'tracekeeper.propose_memory',
                type: 'memory_proposal',
                proposal_id: proposalId,
                title: title || dependencies.renderText(`记忆提案：${proposalKind}`, `Memory proposal: ${proposalKind}`),
                proposal_kind: proposalKind,
                status: 'pending',
                target_note: proposalTargetNote || null,
                risk_level: riskLevel || null,
                project_hint: projectHint || null,
                memory_scope: memoryScope,
                related_wiki: bridgeMetadata.related_wiki,
                related_sources: bridgeMetadata.related_sources,
                architecture_status: architectureStatus.architecture_status,
                missing_graph_bridges: architectureStatus.missing_graph_bridges,
                missing_wiki_bridge: bridgeMetadata.missing_wiki_bridge,
                missing_related_wiki: bridgeMetadata.missing_related_wiki,
                missing_related_sources: bridgeMetadata.missing_related_sources,
                created_at: now,
                task_id: taskId || null,
                proposal_operation_id: identity.operationId,
            },
            body,
            taskId,
            metadata: {
                action: 'memory.proposal.created',
                target_type: 'memory_proposal',
                proposal_kind: proposalKind,
                risk_level: riskLevel || null,
            },
            operationId: identity.operationId,
        });
        if (existing) {
            await dependencies.ensureOwnedProposalIdentity(note.path, proposalId, identity.operationId);
        }
        if (taskId) {
            await dependencies.updateTaskProposalReference(taskId, {
                proposalId,
                path: note.path,
                linkTarget: note.path,
            });
        }
        const response = {
            ok: true,
            tool: 'tracekeeper.propose_memory',
            operation_id: identity.operationId,
            idempotency_key: identity.idempotencyKey,
            status: note.status,
            path: note.path,
            audit_path: note.audit_path,
            warnings: note.warnings,
            auto_applied: false,
            duplicate: false,
            proposal_id: proposalId,
            proposal_path: note.path,
            proposal_link_target: note.path,
            memory_rule: memoryRule,
            memory_scope: memoryScope,
            project_hint: projectHint || null,
            related_wiki: bridgeMetadata.related_wiki,
            related_sources: bridgeMetadata.related_sources,
            missing_related_sources: bridgeMetadata.missing_related_sources,
            architecture_status: architectureStatus.architecture_status,
            missing_graph_bridges: architectureStatus.missing_graph_bridges,
            missing_wiki_bridge: bridgeMetadata.missing_wiki_bridge,
        };
        if (memoryScope === 'project' && bridgeMetadata.missing_wiki_bridge && memoryRule === 'auto_write') {
            response.memory_rule = 'review_queue';
        }
        return response;
    }
}
exports.ProposeMemoryApplicationService = ProposeMemoryApplicationService;
