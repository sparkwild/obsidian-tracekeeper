"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_RELATIONS_END = exports.TASK_RELATIONS_BEGIN = exports.TASK_REFERENCE_FIELDS = exports.isTaskRecordType = exports.TaskMigrationRequiredError = void 0;
exports.legacyTaskReferenceList = legacyTaskReferenceList;
exports.assertTaskRelationPath = assertTaskRelationPath;
exports.parseTaskRecord = parseTaskRecord;
exports.taskTargetIdentity = taskTargetIdentity;
exports.makeTaskRelation = makeTaskRelation;
exports.resolveTaskRelations = resolveTaskRelations;
exports.taskReferenceFields = taskReferenceFields;
exports.patchTaskMetadata = patchTaskMetadata;
exports.updateTaskRelations = updateTaskRelations;
exports.migrateTaskRecord = migrateTaskRecord;
exports.renderTaskRelationProjection = renderTaskRelationProjection;
exports.ensureWikiIdentity = ensureWikiIdentity;
exports.taskPresentationFields = taskPresentationFields;
exports.diagnoseTaskRelations = diagnoseTaskRelations;
const node_crypto_1 = __importDefault(require("node:crypto"));
const yaml_1 = require("yaml");
const markdown_1 = require("./markdown");
const operation_journal_1 = require("./operation-journal");
class TaskMigrationRequiredError extends Error {
    constructor(taskId) {
        super(`Task ${taskId} requires preview, backup and migration in Obsidian before new writes.`);
        this.taskId = taskId;
        this.code = 'TASK_MIGRATION_REQUIRED';
    }
}
exports.TaskMigrationRequiredError = TaskMigrationRequiredError;
const isTaskRecordType = (value) => typeof value === 'string' && value.toLowerCase().replace(/_/g, '-') === 'agent-task';
exports.isTaskRecordType = isTaskRecordType;
const ROLES = new Set(['captured_source', 'written_output', 'review_proposal', 'context_reference']);
const KINDS = new Set(['source', 'memory', 'wiki', 'proposal', 'unknown']);
exports.TASK_REFERENCE_FIELDS = ['source_captures', 'memory_writes', 'memory_reads', 'proposal_ids', 'proposal_paths', 'proposals', 'proposal_link_targets', 'proposal_links', 'related_wiki', 'related_sources'];
const TASK_REFERENCE_ALIASES = {
    source_captures: ['source_captures', 'sourceCaptures'], memory_writes: ['memory_writes', 'memoryWrites'], memory_reads: ['memory_reads', 'memoryReads'],
    proposal_ids: ['proposal_ids', 'proposalIds'], proposal_paths: ['proposal_paths', 'proposalPaths'], proposals: ['proposals'],
    proposal_link_targets: ['proposal_link_targets', 'proposalLinkTargets'], proposal_links: ['proposal_links', 'proposalLinks'],
    related_wiki: ['related_wiki', 'relatedWiki'], related_sources: ['related_sources', 'relatedSources'],
};
function normalizeLegacyTaskReferences(fields) {
    const result = { ...fields };
    for (const [key, aliases] of Object.entries(TASK_REFERENCE_ALIASES)) {
        const provided = aliases.filter((alias) => fields[alias] !== undefined).map((alias) => legacyTaskReferenceList(fields[alias]));
        if (provided.some((value) => JSON.stringify(value) !== JSON.stringify(provided[0])))
            throw new operation_journal_1.OperationConflictError(`Conflicting historical task aliases: ${key}.`);
        if (provided.length)
            result[key] = provided[0];
    }
    return result;
}
exports.TASK_RELATIONS_BEGIN = '<!-- tracekeeper:task-relations:start -->';
exports.TASK_RELATIONS_END = '<!-- tracekeeper:task-relations:end -->';
const text = (value) => typeof value === 'string' ? value.trim() : '';
const hash = (value) => node_crypto_1.default.createHash('sha256').update(value).digest('hex');
/** 旧格式仅在此处拆分；V2 关系不按逗号拆分路径。 */
function legacyTaskReferenceList(value) {
    return (Array.isArray(value) ? value : [value]).flatMap((entry) => text(entry).split(/[\n,]/)).map((entry) => entry.trim()).filter(Boolean);
}
function assertTaskRelationPath(value) {
    if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..') || /[\r\n\[\]#|\x00]/.test(value) || !/\.md$/i.test(value)) {
        throw new operation_journal_1.OperationConflictError('Invalid task relation path.');
    }
}
/** 解析权威关系；损坏的 V2 不降级为旧格式。 */
function parseTaskRecord(fields) {
    if (fields.task_record_version === undefined)
        return null;
    if (fields.task_record_version !== 2 || !text(fields.task_id) || !Array.isArray(fields.task_relations))
        throw new operation_journal_1.OperationConflictError('Invalid TaskRecordV2.');
    const seen = new Set();
    const relations = fields.task_relations.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new operation_journal_1.OperationConflictError('Invalid task relation.');
        const row = value;
        if (!text(row.relation_id) || seen.has(text(row.relation_id)) || !ROLES.has(text(row.role)) || !KINDS.has(text(row.target_kind)) || typeof row.recorded_path !== 'string')
            throw new operation_journal_1.OperationConflictError('Invalid or duplicate task relation.');
        assertTaskRelationPath(row.recorded_path);
        for (const key of ['target_id', 'recorded_at', 'operation_id', 'content_hash'])
            if (row[key] !== null && typeof row[key] !== 'string')
                throw new operation_journal_1.OperationConflictError(`Invalid task relation ${key}.`);
        seen.add(text(row.relation_id));
        return { relation_id: text(row.relation_id), role: row.role, target_kind: row.target_kind, target_id: row.target_id, recorded_path: row.recorded_path, recorded_at: row.recorded_at, operation_id: row.operation_id, content_hash: row.content_hash, ...(typeof row.unverified_reason === 'string' ? { unverified_reason: row.unverified_reason } : {}) };
    });
    return { version: 2, task_id: text(fields.task_id), status: text(fields.status), objective: text(fields.objective), project_id: text(fields.project_id) || null, repo_path: text(fields.repo_path) || null, started_at: text(fields.started_at) || null, recorded_at: text(fields.recorded_at) || null, relations };
}
/** 目标身份包含记录种类；Source ID 本身不能区分捕获批次。 */
function taskTargetIdentity(target) {
    const f = target.frontmatter;
    if (text(f.memory_id))
        return { kind: 'memory', id: text(f.memory_id) };
    if (text(f.proposal_id))
        return { kind: 'proposal', id: text(f.proposal_id) };
    if (text(f.wiki_id))
        return { kind: 'wiki', id: text(f.wiki_id) };
    if (f.type === 'source_capture' || f.type === 'source_part') {
        const part = f.type === 'source_part' ? `:part:${String(f.part_number)}` : ':index';
        return { kind: 'source', id: text(f.source_operation_id) ? `capture:${text(f.source_operation_id)}${part}` : text(f.migration_id) && text(f.source_id) ? `migration:${text(f.migration_id)}:${text(f.source_id)}${part}` : null };
    }
    if (f.type === 'source_analysis_report' && text(f.operation_id))
        return { kind: 'unknown', id: `source-report:${text(f.operation_id)}` };
    return { kind: target.path.startsWith('01_knowledge/wiki/') ? 'wiki' : target.path.startsWith('01_knowledge/memory/') ? 'memory' : 'unknown', id: null };
}
function makeTaskRelation(input) {
    assertTaskRelationPath(input.path);
    const identity = input.target ? taskTargetIdentity(input.target) : { kind: 'unknown', id: null };
    if (input.proposalId) {
        identity.kind = 'proposal';
        identity.id = input.proposalId;
    }
    const operationId = input.operationId || null;
    return { relation_id: `relation-${hash(JSON.stringify([input.taskId, input.role, operationId, identity.kind, identity.id, operationId && identity.id ? null : input.path])).slice(0, 32)}`, role: input.role, target_kind: identity.kind, target_id: identity.id, recorded_path: input.path, recorded_at: input.recordedAt || null, operation_id: operationId, content_hash: input.target?.contentHash || null };
}
function resolveTaskRelations(record, targets) {
    const identities = new Map();
    for (const target of targets) {
        const identity = taskTargetIdentity(target);
        if (!identity.id)
            continue;
        const key = `${identity.kind}\0${identity.id}`;
        identities.set(key, [...(identities.get(key) || []), target]);
    }
    return record.relations.map((fact) => {
        const matches = fact.target_id ? identities.get(`${fact.target_kind}\0${fact.target_id}`) || [] : [];
        const status = !fact.target_id || fact.unverified_reason ? 'unverified' : matches.length > 1 ? 'ambiguous' : matches.length === 0 ? 'missing' : 'resolved';
        const current = status === 'resolved' ? matches[0].path : null;
        return { fact: { ...fact }, status, current_path: current, location: current ? current.startsWith('02_archive/') ? 'archive' : 'active' : null };
    });
}
/** 现有响应字段只作为内存投影，绝不重新写入任务文件。 */
function taskReferenceFields(fields, targets) {
    const task = parseTaskRecord(fields);
    if (!task)
        return normalizeLegacyTaskReferences(fields);
    const resolved = targets ? new Map(resolveTaskRelations(task, targets).map((row) => [row.fact.relation_id, row.current_path])) : new Map();
    const pathOf = (row) => resolved.get(row.relation_id) || row.recorded_path;
    const paths = (role) => [...new Set(task.relations.filter((row) => row.role === role).map(pathOf))];
    const proposals = task.relations.filter((row) => row.role === 'review_proposal');
    return { ...fields, source_captures: paths('captured_source'), memory_writes: paths('written_output'), memory_reads: task.relations.filter((row) => row.role === 'context_reference' && row.target_kind === 'memory').map(pathOf), proposal_ids: proposals.map((row) => row.target_id || ''), proposal_paths: proposals.map(pathOf), proposals: proposals.map(pathOf), proposal_link_targets: proposals.map(pathOf), related_wiki: task.relations.filter((r) => r.role === 'context_reference' && r.target_kind === 'wiki').map((r) => r.recorded_path), related_sources: task.relations.filter((r) => r.role === 'context_reference' && r.target_kind === 'source').map((r) => r.recorded_path) };
}
/** 只替换指定的根属性，保留正文、换行和其他属性的原始字节。 */
function patchTaskMetadata(content, values, remove = []) {
    const match = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(content);
    if (!match)
        throw new operation_journal_1.OperationConflictError('Task metadata is missing or unterminated.');
    const document = (0, yaml_1.parseDocument)(match[2], { uniqueKeys: true });
    if (document.errors.length || !document.contents || !('items' in document.contents))
        throw new operation_journal_1.OperationConflictError('Invalid task YAML.');
    const edits = [];
    const keys = new Set([...Object.keys(values), ...remove]);
    for (const pair of document.contents.items) {
        if (!keys.has(String(pair.key)))
            continue;
        const key = pair.key;
        const value = pair.value;
        if (!key.range)
            throw new operation_journal_1.OperationConflictError('Cannot locate YAML field.');
        const start = match[2].lastIndexOf('\n', key.range[0] - 1) + 1;
        const rawEnd = value?.range?.[2] ?? key.range[2];
        const newline = match[2].indexOf('\n', rawEnd > 0 && match[2][rawEnd - 1] === '\n' ? rawEnd - 1 : rawEnd);
        edits.push({ start, end: newline < 0 ? match[2].length : newline + 1 });
    }
    let yaml = match[2];
    for (const edit of edits.sort((a, b) => b.start - a.start))
        yaml = yaml.slice(0, edit.start) + yaml.slice(edit.end);
    const eol = match[1].includes('\r') ? '\r\n' : '\n';
    const additions = Object.keys(values).length ? (0, yaml_1.stringify)(values, { lineWidth: 0 }).trimEnd().replace(/\n/g, eol) : '';
    return match[1] + yaml.replace(/[\r\n]+$/, '') + (yaml.trim() && additions ? eol : '') + additions + match[3] + content.slice(match[0].length);
}
function updateTaskRelations(content, additions) {
    const parsed = (0, markdown_1.parseMarkdown)(content);
    if (parsed.frontmatter.errors.length)
        throw new operation_journal_1.OperationConflictError('Invalid task YAML.');
    const task = parseTaskRecord(parsed.frontmatter.fields);
    if (!task)
        throw new TaskMigrationRequiredError(text(parsed.frontmatter.fields.task_id));
    const relations = new Map(task.relations.map((row) => [row.relation_id, row]));
    for (const row of additions) {
        // 提案是同一个业务对象，创建与收尾补写不能产生第二条提案关系。
        if (row.role === 'review_proposal' && row.target_id && [...relations.values()].some((known) => known.role === row.role && known.target_id === row.target_id && !known.unverified_reason))
            continue;
        const existing = relations.get(row.relation_id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(row)) {
            if (existing.role !== row.role || existing.target_id !== row.target_id || existing.operation_id !== row.operation_id)
                throw new operation_journal_1.OperationConflictError('Task relation identity conflict.');
            continue;
        }
        relations.set(row.relation_id, row);
    }
    if (relations.size === task.relations.length)
        return content;
    return patchTaskMetadata(content, { task_relations: [...relations.values()], task_projection_pending: true });
}
/** 显式迁移导入旧字段，无法证明的引用保持无身份状态。 */
function migrateTaskRecord(content, targets) {
    const parsed = (0, markdown_1.parseMarkdown)(content);
    if (parsed.frontmatter.errors.length)
        throw new operation_journal_1.OperationConflictError('Invalid task YAML.');
    if (parseTaskRecord(parsed.frontmatter.fields))
        return content;
    const f = normalizeLegacyTaskReferences(parsed.frontmatter.fields);
    const taskId = text(f.task_id);
    if (!taskId)
        throw new operation_journal_1.OperationConflictError('Task identity is missing.');
    const facts = [];
    const add = (role, paths, ids = []) => paths.forEach((path, i) => {
        const direct = targets.filter((target) => target.path === path);
        const matching = direct.length ? direct : targets.filter((target) => target.historical_paths?.includes(path));
        const fact = makeTaskRelation({ taskId, role, path, target: matching.length === 1 ? matching[0] : undefined, proposalId: ids[i], recordedAt: text(f.recorded_at) || text(f.started_at) || null });
        if (ids[i] && (matching.length !== 1 || matching[0].frontmatter.proposal_id !== ids[i] || matching[0].frontmatter.task_id && matching[0].frontmatter.task_id !== taskId))
            fact.unverified_reason = 'Historical proposal identity or owner cannot be verified.';
        facts.push(fact);
    });
    add('captured_source', legacyTaskReferenceList(f.source_captures));
    add('written_output', legacyTaskReferenceList(f.memory_writes));
    const proposalPaths = legacyTaskReferenceList(f.proposal_paths).length ? legacyTaskReferenceList(f.proposal_paths) : legacyTaskReferenceList(f.proposals);
    const proposalIds = legacyTaskReferenceList(f.proposal_ids);
    for (const key of ['proposal_links', 'proposal_link_targets']) {
        const values = legacyTaskReferenceList(f[key]);
        if (values.length && values.length !== proposalPaths.length)
            throw new operation_journal_1.OperationConflictError('Historical proposal mirrors are not aligned.');
    }
    if (proposalIds.length > proposalPaths.length)
        throw new operation_journal_1.OperationConflictError('Proposal IDs have no matching historical paths.');
    add('review_proposal', proposalPaths, proposalIds);
    add('review_proposal', legacyTaskReferenceList(f.proposals).filter((path) => !proposalPaths.includes(path)));
    add('context_reference', [...legacyTaskReferenceList(f.related_wiki), ...legacyTaskReferenceList(f.related_sources), ...legacyTaskReferenceList(f.memory_reads)]);
    const relations = [...new Map(facts.map((row) => [row.relation_id, row])).values()];
    return patchTaskMetadata(content, { task_record_version: 2, task_relations: relations }, Object.values(TASK_REFERENCE_ALIASES).flat());
}
function renderTaskRelationProjection(content, resolved, link) {
    const starts = content.split(exports.TASK_RELATIONS_BEGIN).length - 1;
    const ends = content.split(exports.TASK_RELATIONS_END).length - 1;
    if (starts !== ends || starts > 1 || starts === 1 && content.indexOf(exports.TASK_RELATIONS_END) < content.indexOf(exports.TASK_RELATIONS_BEGIN))
        throw new operation_journal_1.OperationConflictError('Task relation projection has conflicting markers.');
    const rows = resolved.map((row) => `- ${row.fact.role}: ${row.status === 'resolved' && row.current_path ? `${link(row.current_path)}${row.current_path !== row.fact.recorded_path ? ` (recorded: ${JSON.stringify(row.fact.recorded_path)})` : ''}` : `${row.status} (${JSON.stringify(row.fact.recorded_path)})`}`);
    const nativeRows = resolved.map((row) => `- ${row.fact.role}: ${row.status === 'resolved' && row.current_path ? link(row.current_path) : `${row.status} (${JSON.stringify(row.fact.recorded_path)})`}`);
    const block = [exports.TASK_RELATIONS_BEGIN, '## Task relations', '', ...rows, exports.TASK_RELATIONS_END].join('\n');
    const storedHash = (0, markdown_1.parseMarkdown)(content).frontmatter.fields.task_projection_hash;
    if (starts) {
        const previous = content.slice(content.indexOf(exports.TASK_RELATIONS_BEGIN), content.indexOf(exports.TASK_RELATIONS_END) + exports.TASK_RELATIONS_END.length);
        const lines = previous.split('\n');
        // Obsidian 原生改链可使摘要过期；只接受逐行与权威关系相同的生成内容。
        const nativeUpdate = lines.length === rows.length + 4 && lines[0] === exports.TASK_RELATIONS_BEGIN && lines[1] === '## Task relations' && lines[2] === '' && lines[lines.length - 1] === exports.TASK_RELATIONS_END
            && rows.every((row, index) => lines[index + 3] === row || lines[index + 3] === nativeRows[index]);
        if (storedHash !== hash(previous) && !nativeUpdate)
            throw new operation_journal_1.OperationConflictError('Task projection was edited; preview a manual repair.');
    }
    const next = starts ? content.slice(0, content.indexOf(exports.TASK_RELATIONS_BEGIN)) + block + content.slice(content.indexOf(exports.TASK_RELATIONS_END) + exports.TASK_RELATIONS_END.length) : `${content}${content.endsWith('\n') ? '' : '\n'}\n${block}\n`;
    if (next === content && storedHash === hash(block) && (0, markdown_1.parseMarkdown)(content).frontmatter.fields.task_projection_pending !== true)
        return content;
    return patchTaskMetadata(next, { task_projection_hash: hash(block), task_projection_pending: false });
}
/** 新建 Wiki 的身份也进入原写入计划，重试不能另行生成。 */
function ensureWikiIdentity(content, seed) {
    const parsed = (0, markdown_1.parseMarkdown)(content);
    if (parsed.frontmatter.errors.length)
        throw new operation_journal_1.OperationConflictError('Invalid Wiki metadata.');
    if (typeof parsed.frontmatter.fields.wiki_id === 'string' && parsed.frontmatter.fields.wiki_id.trim())
        return content;
    const wiki_id = `wiki-${hash(seed).slice(0, 32)}`;
    return /^---\r?\n/.test(content) ? patchTaskMetadata(content, { wiki_id }) : `---\nwiki_id: ${wiki_id}\n---\n${content}`;
}
/** 将规范解析结果适配到原生界面的标量字段，不使用界面的简化 YAML 解析器。 */
function taskPresentationFields(content, targets) {
    const parsed = (0, markdown_1.parseMarkdown)(content);
    if (parsed.frontmatter.errors.length)
        throw new operation_journal_1.OperationConflictError('Invalid task metadata.');
    const fields = taskReferenceFields(parsed.frontmatter.fields, targets);
    const result = {};
    for (const [key, value] of Object.entries(fields)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
            result[key] = String(value);
        else if (Array.isArray(value) && value.every((item) => typeof item === 'string'))
            result[key] = value;
    }
    return result;
}
function diagnoseTaskRelations(targets) {
    const issues = [];
    const identities = new Map();
    for (const target of targets) {
        const fields = target.frontmatter;
        if ((0, exports.isTaskRecordType)(fields.type)) {
            const id = text(fields.task_id);
            if (id)
                identities.set(`task:${id}`, [...(identities.get(`task:${id}`) || []), target.path]);
            try {
                const record = parseTaskRecord(fields);
                if (!record)
                    issues.push({ path: target.path, kind: 'task_migration_required', message: 'Preview, back up and migrate this historical task before new writes.' });
                else
                    for (const relation of resolveTaskRelations(record, targets))
                        if (relation.status !== 'resolved')
                            issues.push({ path: target.path, kind: 'task_relation_unresolved', message: `Task relation ${relation.fact.relation_id}: ${relation.status}.` });
                if (record && target.content !== undefined) {
                    const start = target.content.indexOf(exports.TASK_RELATIONS_BEGIN), end = target.content.indexOf(exports.TASK_RELATIONS_END);
                    if (fields.task_projection_pending === true || start < 0 || end < start || fields.task_projection_hash !== hash(target.content.slice(start, end + exports.TASK_RELATIONS_END.length)))
                        issues.push({ path: target.path, kind: 'task_navigation_pending', message: 'Task navigation is missing, outdated or edited; inspect Task relation maintenance.' });
                }
            }
            catch {
                issues.push({ path: target.path, kind: 'task_relation_invalid', message: 'Task metadata is invalid; inspect the record before writing.' });
            }
        }
        if (target.path.startsWith('01_knowledge/wiki/')) {
            const id = text(fields.wiki_id);
            if (!id)
                issues.push({ path: target.path, kind: 'wiki_identity_missing', message: 'Wiki identity is missing; use the human metadata migration preview.' });
            else
                identities.set(`wiki:${id}`, [...(identities.get(`wiki:${id}`) || []), target.path]);
        }
    }
    for (const paths of identities.values())
        if (paths.length > 1)
            for (const path of paths)
                issues.push({ path, kind: 'task_identity_ambiguous', message: 'Multiple files share the same stable identity; no target was selected.' });
    return issues.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind) || a.message.localeCompare(b.message));
}
