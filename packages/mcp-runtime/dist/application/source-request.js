"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourceRequestApplicationService = void 0;
const core_1 = require("@tracekeeper/core");
function isSourceRequestPending(status) {
    return ['pending', 'todo', 'open', 'queued', 'new'].includes(status.toLowerCase());
}
function isUrlSource(source) {
    return /^https?:\/\//i.test(source.trim());
}
function isLikelyVaultPath(value, sourceKind) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes('\n') || trimmed.includes('\r')) {
        return false;
    }
    if (/^https?:\/\//i.test(trimmed) || /^(mailto:|file:|ftp:)/i.test(trimmed)) {
        return false;
    }
    if (['url', 'selection', 'http', 'external'].includes(sourceKind.toLowerCase())) {
        return false;
    }
    if (trimmed.startsWith('.') && !trimmed.includes('/')) {
        return false;
    }
    return /\.(md|markdown|txt)$/i.test(trimmed)
        || trimmed.includes('/')
        || sourceKind === 'current_note'
        || sourceKind === 'local_file';
}
function extractSelectionText(sourceBody) {
    const marker = '## Selected Text';
    const markerIndex = sourceBody.indexOf(marker);
    if (markerIndex >= 0) {
        const selected = sourceBody.slice(markerIndex + marker.length).trim();
        return selected
            .split('\n')
            .map((line) => line.replace(/^>\s?/, ''))
            .join('\n')
            .trim();
    }
    const bodyLines = sourceBody.split('\n');
    const contentLines = [];
    let started = false;
    for (const line of bodyLines) {
        if (!started) {
            if (line.startsWith('- ') || line.startsWith('#') || line.trim() === '') {
                continue;
            }
            started = true;
        }
        contentLines.push(line);
    }
    return contentLines.join('\n').trim();
}
async function resolveSourceInput(request, dependencies) {
    const source = request.source.trim();
    const sourceKind = request.sourceKind.trim().toLowerCase();
    if (!source) {
        return {
            sourceText: `No source identifier found in request ${request.path}.`,
            mode: 'extracted_snapshot',
            warnings: ['request has empty source field'],
        };
    }
    if (isUrlSource(source)) {
        return {
            sourceText: `External reference pending human/agent fetch. `
                + `Source URL: ${source}. `
                + 'This request intentionally avoids network fetch.',
            mode: 'external_reference',
            warnings: ['external network fetch intentionally skipped'],
        };
    }
    if (isLikelyVaultPath(source, sourceKind)) {
        const fileText = await dependencies.readSourceText(source);
        if (fileText !== null) {
            return {
                sourceText: fileText,
                mode: 'local_copy',
                resolvedSourcePath: source,
                warnings: [],
            };
        }
        return {
            sourceText: request.content || source,
            mode: 'extracted_snapshot',
            warnings: ['source path is not readable, fallback to request body'],
        };
    }
    const bodyText = extractSelectionText(request.content);
    return {
        sourceText: bodyText || request.content || source,
        mode: 'extracted_snapshot',
        warnings: ['using request-provided text for analysis'],
    };
}
function buildSourceRunToken(request, now) {
    const safeRequest = request.filename
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-z0-9._-]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return `${safeRequest}-${now.replace(/[:.]/g, '-')}`;
}
function buildSourceNoteContent(request, mode, analysis, dependencies, resolvedSourcePath) {
    const section = [
        dependencies.renderText('## 来源笔记', '## Source note'),
        `- request_path: ${request.path}`,
        `- mode: ${mode}`,
        `- source_kind: ${request.sourceKind || 'unknown'}`,
        `- analysis_mode: ${request.analysisMode || 'default'}`,
    ];
    if (resolvedSourcePath) {
        section.push(`- resolved_source_path: ${resolvedSourcePath}`);
    }
    section.push('');
    section.push(dependencies.renderText('## 来源摘要', '## Source summary'));
    section.push(analysis.summary);
    section.push('');
    section.push(dependencies.renderText('## 证据脚手架', '## Evidence scaffold'));
    section.push(...analysis.evidenceScaffolds.map((item) => `- ${item}`));
    section.push('');
    section.push(dependencies.renderText('## 论断脚手架', '## Claim scaffold'));
    section.push(...analysis.claimScaffolds.map((item) => `- ${item}`));
    section.push('');
    section.push(dependencies.renderText('## 来源摘录', '## Source excerpt'));
    section.push(analysis.excerpt);
    return section.join('\n');
}
function buildReportContent(request, mode, sourceText, analysis, sourceNotePath, warnings, dependencies) {
    const sourceContent = `\n${dependencies.renderText('## 来源', '## Source')}\n\n${sourceText.slice(0, 1000)}\n`;
    const section = [
        dependencies.renderText('## 来源分析报告', '## Source Analysis Report'),
        `- source: ${request.source}`,
        `- request_path: ${request.path}`,
        `- source_kind: ${request.sourceKind || 'unknown'}`,
        `- analysis_mode: ${request.analysisMode || 'default'}`,
        `- mode: ${mode}`,
        `- source_note: ${sourceNotePath}`,
        `- related_project: ${request.relatedProject || 'unset'}`,
        `- purpose: ${request.purpose || 'unset'}`,
    ];
    if (warnings.length > 0) {
        section.push(`- warnings: ${JSON.stringify(warnings)}`);
    }
    section.push('');
    section.push(dependencies.renderText('## 摘要', '## Summary'));
    section.push(analysis.summary);
    section.push('');
    section.push(dependencies.renderText('## 摘录', '## Excerpt'));
    section.push(`\n${analysis.excerpt}\n`);
    section.push('');
    section.push(dependencies.renderText('## 证据脚手架', '## Evidence scaffold'));
    section.push(...analysis.evidenceScaffolds.map((entry) => `- ${entry}`));
    section.push('');
    section.push(dependencies.renderText('## 论断脚手架', '## Claim scaffold'));
    section.push(...analysis.claimScaffolds.map((entry) => `- ${entry}`));
    section.push('');
    section.push(sourceContent);
    return section.join('\n');
}
function proposalReference(entry) {
    return {
        proposalId: entry.proposalId,
        path: entry.path,
        linkTarget: entry.linkTarget,
    };
}
class SourceRequestApplicationService {
    constructor(dependencies) {
        this.dependencies = dependencies;
    }
    async execute(input) {
        const { dependencies } = this;
        const request = await dependencies.readRequest(input.requestPath);
        const taskId = input.taskId || request.taskId || null;
        let failureStatusAllowed = false;
        let failureRequestPath = request.path;
        try {
            if (!request.type.toLowerCase().includes('agent-request')) {
                throw new Error('Request note is not an agent-request note.');
            }
            failureRequestPath = request.path;
            if (!input.forceReprocess && request.status && !isSourceRequestPending(request.status)) {
                throw new Error(`Request status is ${request.status}; use force_reprocess=true to process anyway.`);
            }
            failureStatusAllowed = !request.status || isSourceRequestPending(request.status);
            const { sourceText, mode, resolvedSourcePath, warnings } = await resolveSourceInput(request, dependencies);
            const analysis = (0, core_1.analyzeSourceText)({
                source: request.source,
                sourceKind: request.sourceKind || 'unknown',
                analysisMode: request.analysisMode || 'default',
                purpose: request.purpose,
                content: sourceText,
                requestPath: request.path,
                contentLanguage: dependencies.contentLanguage,
            });
            dependencies.assertSafeText([
                { label: 'source', value: request.source },
                { label: 'purpose', value: request.purpose },
                { label: 'source content', value: sourceText },
                { label: 'summary', value: analysis.summary },
                { label: 'excerpt', value: analysis.excerpt },
            ]);
            const now = dependencies.now();
            const runToken = buildSourceRunToken(request, now);
            const sourceNote = await dependencies.writeNote({
                kind: 'source',
                toolName: input.toolName,
                filename: dependencies.buildFilename(`${runToken}-source`, 'source'),
                frontmatter: {
                    tool: input.toolName,
                    type: 'source_analysis_source',
                    title: `source_analysis_source_${runToken}`,
                    source: request.source,
                    source_kind: request.sourceKind || null,
                    analysis_mode: request.analysisMode || 'default',
                    request_path: request.path,
                    mode,
                    created_at: now,
                    task_id: taskId,
                },
                body: buildSourceNoteContent(request, mode, analysis, dependencies, resolvedSourcePath),
                taskId,
                metadata: { target_type: 'source', mode, request_path: request.path },
            });
            const report = await dependencies.writeNote({
                kind: 'report',
                toolName: input.toolName,
                filename: dependencies.buildFilename(`${runToken}-report`, 'source-report'),
                frontmatter: {
                    tool: input.toolName,
                    type: 'source_analysis_report',
                    title: `source_analysis_report_${runToken}`,
                    source: request.source,
                    source_kind: request.sourceKind || null,
                    analysis_mode: request.analysisMode || 'default',
                    request_path: request.path,
                    source_note: sourceNote.path,
                    created_at: now,
                    task_id: taskId,
                },
                body: buildReportContent(request, mode, sourceText, analysis, sourceNote.path, warnings, dependencies),
                taskId,
                metadata: { target_type: 'source_analysis_report', request_path: request.path },
            });
            const proposals = [];
            for (const [proposalIndex, entry] of analysis.proposalDrafts.entries()) {
                const proposalId = (0, core_1.buildStableProposalId)(`source-analysis\0${runToken}\0${proposalIndex}\0${entry.proposalKind}`);
                const proposalNote = await dependencies.writeNote({
                    kind: 'proposal',
                    toolName: input.toolName,
                    filename: dependencies.buildFilename(`proposal-${runToken}-${entry.proposalKind}`, entry.proposalKind),
                    frontmatter: {
                        tool: input.toolName,
                        type: 'memory_proposal',
                        proposal_id: proposalId,
                        title: entry.title || `source_proposal_${runToken}`,
                        proposal_kind: entry.proposalKind,
                        status: 'pending',
                        source: request.source,
                        source_kind: request.sourceKind || null,
                        target_note: report.path,
                        risk_level: entry.riskLevel || null,
                        created_at: now,
                        task_id: taskId,
                    },
                    body: `${dependencies.renderText('## 来源分析提案', '## Source analysis proposal')}\n\n- evidence: ${entry.evidence}\n\n${dependencies.renderText('## 写回内容', '## Writeback')}\n${entry.content}\n`,
                    taskId,
                    metadata: {
                        target_type: 'memory_proposal',
                        proposal_kind: entry.proposalKind,
                        request_path: request.path,
                        source_note: sourceNote.path,
                    },
                });
                proposals.push(proposalReference({
                    proposalId,
                    path: proposalNote.path,
                    linkTarget: proposalNote.path,
                }));
            }
            let auditPathForReturn = sourceNote.activity_path;
            if (input.updateRequestStatus) {
                failureStatusAllowed = false;
                await dependencies.updateRequestStatus(request.path, 'completed');
                auditPathForReturn = (await dependencies.appendAudit({
                    tool: input.toolName,
                    targetPath: request.path,
                    status: 'written',
                    taskId,
                    metadata: {
                        action: 'source.request.completed',
                        source_note: sourceNote.path,
                        source_report: report.path,
                        proposal_ids: proposals.map((proposal) => proposal.proposalId).join(','),
                        proposal_paths: proposals.map((proposal) => proposal.path).join(','),
                    },
                })).path;
            }
            const taskPath = await dependencies.updateTaskRecord(taskId, [sourceNote.path, report.path], proposals);
            if (taskPath) {
                await dependencies.updateManagedProposalReferences(taskPath, proposals);
            }
            return {
                ok: true,
                read_only: false,
                tool: input.toolName,
                status: 'completed',
                request_path: request.path,
                mode,
                source_note: { path: sourceNote.path, activity_path: sourceNote.activity_path },
                report: { path: report.path, activity_path: report.activity_path },
                proposals: proposals.map((proposal) => ({
                    proposal_id: proposal.proposalId,
                    path: proposal.path,
                    proposal_link_target: proposal.linkTarget,
                })),
                activity_path: auditPathForReturn,
                summary: analysis.summary,
                warnings,
            };
        }
        catch (error) {
            if (input.updateRequestStatus && failureStatusAllowed) {
                try {
                    await dependencies.updateRequestStatus(failureRequestPath, 'failed');
                    await dependencies.appendAudit({
                        tool: input.toolName,
                        targetPath: failureRequestPath,
                        status: 'failed',
                        taskId,
                        metadata: {
                            action: 'source.request.failed',
                            error: error instanceof Error ? error.message : String(error),
                        },
                    });
                }
                catch {
                    // Preserve the original failure when status/audit recovery cannot complete.
                }
            }
            throw error;
        }
    }
}
exports.SourceRequestApplicationService = SourceRequestApplicationService;
