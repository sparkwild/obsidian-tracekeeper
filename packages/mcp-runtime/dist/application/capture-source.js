"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaptureSourceApplicationService = void 0;
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
function captureMode(value) {
    const mode = requiredString(value, 'mode').toLowerCase();
    switch (mode) {
        case 'external_reference':
        case 'extracted_snapshot':
        case 'local_copy':
            return mode;
        default:
            throw new Error('capture_source mode must be one of: external_reference | extracted_snapshot | local_copy');
    }
}
class CaptureSourceApplicationService {
    constructor(dependencies) {
        this.dependencies = dependencies;
    }
    async execute(request) {
        const identity = this.dependencies.createIdentity(request.requestHash, request.idempotencyKey);
        const runner = new core_1.RecoverableOperationRunner({
            operationId: identity.operationId,
            idempotencyKey: identity.idempotencyKey,
            payload: { request_hash: request.requestHash },
            journal: this.dependencies.journal,
            failureInjection: this.dependencies.failureInjection,
            steps: [],
            finalize: () => this.finalize(request.rawArgs, identity),
        });
        return runner.run();
    }
    async finalize(rawArgs, identity) {
        const source = requiredString(rawArgs.source, 'source');
        const declaredSourceKind = optionalString(rawArgs.source_kind);
        const mode = captureMode(rawArgs.mode);
        const captureReason = optionalString(rawArgs.capture_reason);
        const relatedProject = optionalString(rawArgs.related_project);
        const filename = this.dependencies.buildFilename(rawArgs.filename, `source-${identity.operationId}`);
        const title = optionalString(rawArgs.title);
        const taskId = optionalString(rawArgs.task_id) || null;
        const now = this.dependencies.now();
        const warnings = [];
        const sourceText = optionalString(rawArgs.content) || optionalString(rawArgs.text);
        const sourceKind = declaredSourceKind || (/^https?:\/\//i.test(source)
            ? 'web'
            : mode === 'local_copy' ? 'file' : 'web');
        const plan = (0, core_1.buildSourceCapturePlan)({
            source,
            sourceKind,
            filename,
            content: mode === 'external_reference' ? '' : sourceText,
        });
        if (mode !== 'external_reference' && !sourceText) {
            throw new Error(`content/text is required when mode is "${mode}".`);
        }
        if (mode === 'external_reference' && sourceText) {
            warnings.push('content/text is ignored for external_reference mode.');
        }
        this.dependencies.assertSafeText([
            { label: 'source', value: source },
            { label: 'capture_reason', value: captureReason },
            { label: 'content', value: sourceText },
            { label: 'title', value: title },
        ]);
        let body = `${this.dependencies.renderText('## 来源捕获', '## Source capture')}\n\n`;
        if (mode === 'external_reference') {
            body += `- mode: external_reference\n- source: ${source}\n`;
            body += `- source_kind: ${plan.source_kind}\n`;
            if (captureReason) {
                body += `- capture_reason: ${captureReason}\n`;
            }
        }
        else {
            body += `- mode: ${mode}\n- source: ${source}\n`;
            body += `- source_kind: ${plan.source_kind}\n`;
            if (plan.parts.length === 0) {
                body += `\n${plan.inline_content}\n`;
            }
            else {
                body += '\n## Parts\n\n';
                body += plan.parts
                    .map((part) => `- Part ${part.part_number}: [[${part.path.replace(/\.md$/i, '')}]]`)
                    .join('\n');
                body += '\n';
            }
        }
        for (const part of plan.parts) {
            const partDirectory = part.path.slice(0, part.path.lastIndexOf('/'));
            const partFilename = part.path.slice(part.path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
            await this.dependencies.writeSourceNote({
                directory: partDirectory,
                filename: partFilename,
                frontmatter: {
                    tool: 'tracekeeper.capture_source',
                    type: 'source_part',
                    source_kind: plan.source_kind,
                    source_id: plan.source_id,
                    content_hash: part.content_hash,
                    part_number: part.part_number,
                    part_count: plan.parts.length,
                    parent_source: plan.index_path,
                    source_operation_id: identity.operationId,
                },
                body: [
                    `# Source part ${part.part_number}`,
                    '',
                    `- Parent source: [[${plan.index_path.replace(/\.md$/i, '')}]]`,
                    '',
                    part.content,
                ].join('\n'),
                taskId,
                metadata: { target_type: 'source_part', source_id: plan.source_id, part_number: part.part_number },
                operationId: identity.operationId,
            });
        }
        const existing = await this.dependencies.findOwnedSourceNote(plan.route, filename, identity.operationId);
        const note = existing || await this.dependencies.writeSourceNote({
            directory: plan.route,
            filename,
            frontmatter: {
                tool: 'tracekeeper.capture_source',
                type: 'source_capture',
                title: title || `source_${mode}`,
                source,
                source_kind: plan.source_kind,
                source_id: plan.source_id,
                content_hash: plan.content_hash,
                route: plan.route,
                index_path: plan.index_path,
                part_manifest: plan.parts.map((part) => part.path),
                part_count: plan.parts.length,
                mode,
                capture_reason: captureReason || null,
                related_project: relatedProject || null,
                created_at: now,
                task_id: taskId || null,
                source_operation_id: identity.operationId,
            },
            body,
            taskId,
            metadata: { target_type: 'source_capture', mode, source_kind: plan.source_kind, source_id: plan.source_id },
            operationId: identity.operationId,
        });
        await this.dependencies.updateTaskSourceCapture(taskId, note.path);
        return {
            ok: true,
            tool: 'tracekeeper.capture_source',
            operation_id: identity.operationId,
            idempotency_key: identity.idempotencyKey,
            status: note.status,
            path: note.path,
            activity_path: note.activity_path,
            warnings,
            metadata: {
                source,
                mode,
                source_kind: plan.source_kind,
                source_id: plan.source_id,
                content_hash: plan.content_hash,
                route: plan.route,
                index_path: plan.index_path,
                part_manifest: plan.parts.map((part) => part.path),
            },
        };
    }
}
exports.CaptureSourceApplicationService = CaptureSourceApplicationService;
