"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_INDEX_PATH = exports.TASK_INDEX_ROOT = void 0;
exports.readTaskVaultSnapshot = readTaskVaultSnapshot;
exports.taskTargets = taskTargets;
exports.resolveTaskIdentity = resolveTaskIdentity;
exports.findTaskById = findTaskById;
exports.requireWritableTaskV2 = requireWritableTaskV2;
exports.planTaskNavigation = planTaskNavigation;
exports.previewTaskMigration = previewTaskMigration;
exports.isRejectedLegacyCapture = isRejectedLegacyCapture;
exports.inspectTaskMigrationReadiness = inspectTaskMigrationReadiness;
exports.applyTaskMigration = applyTaskMigration;
exports.maintainTaskNavigation = maintainTaskNavigation;
exports.pendingTaskMigrations = pendingTaskMigrations;
exports.assertTaskMigrationCommitted = assertTaskMigrationCommitted;
const node_crypto_1 = __importDefault(require("node:crypto"));
const markdown_1 = require("./markdown");
const operation_journal_1 = require("./operation-journal");
const log_storage_1 = require("./log-storage");
const project_memory_1 = require("./project-memory");
const knowledge_architecture_1 = require("./knowledge-architecture");
const task_record_1 = require("./task-record");
const digest = (text) => node_crypto_1.default.createHash('sha256').update(text).digest('hex');
const str = (value) => typeof value === 'string' ? value.trim() : '';
exports.TASK_INDEX_ROOT = '00_tracekeeper/work/task_index';
exports.TASK_INDEX_PATH = '00_tracekeeper/work/index.md';
const OWNER = 'tracekeeper_task_index';
/** 扫描只读文件快照；所有后续解析与预览绑定同一批内容。 */
async function readTaskVaultSnapshot(repository) {
    const listing = await repository.listMarkdown();
    const files = [];
    for (const row of listing) {
        const file = await repository.readText(row.path);
        if (!file || file.version !== row.version)
            throw new operation_journal_1.OperationConflictError('Vault changed during task snapshot.');
        files.push(file);
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
}
function taskTargets(files) {
    return files.map((file) => ({ path: file.path, frontmatter: (0, markdown_1.parseMarkdown)(file.content).frontmatter.fields, contentHash: digest(file.content), content: file.content }));
}
/** 全库查重，受控目录外的同身份任务不能被当作不存在。 */
function resolveTaskIdentity(targets, taskId, writable = false) {
    const matches = targets.filter((target) => (0, task_record_1.isTaskRecordType)(target.frontmatter.type) && target.frontmatter.task_id === taskId);
    if (matches.length > 1)
        throw new operation_journal_1.OperationConflictError('Duplicate task identity.');
    const found = matches[0]?.path ?? null;
    if (found && writable && !found.startsWith(`${knowledge_architecture_1.TRACEKEEPER_TASKS_DIR}/`))
        throw new operation_journal_1.OperationConflictError('Task moved outside its controlled write directory.');
    return found;
}
async function findTaskById(repository, taskId, writable = false) {
    const files = await readTaskVaultSnapshot(repository);
    const found = resolveTaskIdentity(taskTargets(files), taskId, writable);
    return files.find((file) => file.path === found) ?? null;
}
async function requireWritableTaskV2(repository, taskId) {
    const file = await findTaskById(repository, taskId, true);
    if (file && !(0, task_record_1.parseTaskRecord)((0, markdown_1.parseMarkdown)(file.content).frontmatter.fields))
        throw new task_record_1.TaskMigrationRequiredError(taskId);
    return file;
}
const inventoryHash = (files) => digest(JSON.stringify(files.map((file) => [file.path, digest(file.content)])));
function monthOf(fields) {
    for (const key of ['started_at', 'recorded_at']) {
        const value = str(fields[key]);
        if (/^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)))
            return new Date(value).toISOString().slice(0, 7);
    }
    return 'undated';
}
const normalizeRepo = (value) => { try {
    return (0, project_memory_1.normalizeProjectRepositoryPath)(value);
}
catch {
    return '';
} };
const navigationLabel = (value) => JSON.stringify(value).replace(/[\\`*_\[\]<>]/g, '\\$&');
const linkDefault = (path) => `[[${path.replace(/\.md$/, '')}]]`;
/** 导航只表达组织关系，不为无成果任务生成知识引用。 */
function planTaskNavigation(files, link = linkDefault) {
    const targets = taskTargets(files);
    const groups = new Map();
    const projects = targets.filter((target) => str(target.frontmatter.project_id) && /\/index\.md$/.test(target.path) && target.path.startsWith('01_knowledge/memory/projects/'));
    for (const file of files) {
        const fields = (0, markdown_1.parseMarkdown)(file.content).frontmatter.fields;
        if (!(0, task_record_1.isTaskRecordType)(fields.type) || !(0, task_record_1.parseTaskRecord)(fields))
            continue;
        const projectId = str(fields.project_id), repo = normalizeRepo(str(fields.repo_path));
        const candidates = projectId ? projects.filter((p) => p.frontmatter.project_id === projectId) : repo ? projects.filter((p) => normalizeRepo(str(p.frontmatter.repo_path)) === repo) : [];
        const conflict = Boolean(str(fields.repo_path) && !repo) || projectId && candidates.length !== 1 || candidates.length > 1 || candidates.length === 1 && repo && normalizeRepo(str(candidates[0].frontmatter.repo_path)) !== repo;
        const identity = conflict ? 'needs-verification' : candidates.length === 1 ? `project:${str(candidates[0].frontmatter.project_id)}` : repo ? `repo:${repo}` : 'unassigned';
        const key = identity === 'needs-verification' || identity === 'unassigned' ? identity : digest(identity).slice(0, 24);
        const group = groups.get(key) || { label: identity, months: new Map() };
        const month = monthOf(fields);
        group.months.set(month, [...(group.months.get(month) || []), { file, fields }]);
        groups.set(key, group);
    }
    const result = [];
    const emit = (path, body) => {
        const existing = files.find((file) => file.path === path);
        if (existing) {
            const parsed = (0, markdown_1.parseMarkdown)(existing.content);
            const storedBody = existing.content.slice(existing.content.indexOf('\n---\n') + 5);
            if (parsed.frontmatter.fields.type !== OWNER || parsed.frontmatter.fields.task_index_hash !== digest(storedBody) && storedBody !== body + '\n')
                throw new operation_journal_1.OperationConflictError(`Navigation path is occupied or edited: ${path}`);
        }
        const after = `---\ntype: ${OWNER}\ntask_index_version: 1\ntask_index_hash: ${digest(body + '\n')}\n---\n${body}\n`;
        if (existing?.content !== after)
            result.push({ path, before: existing?.content ?? null, after, kind: 'navigation' });
    };
    const rootRows = [];
    for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        const groupPath = `${exports.TASK_INDEX_ROOT}/${key}/index.md`;
        rootRows.push(`- ${link(groupPath, exports.TASK_INDEX_PATH)}`);
        const monthRows = [];
        for (const [month, tasks] of [...group.months].sort(([a], [b]) => b.localeCompare(a))) {
            const monthPath = `${exports.TASK_INDEX_ROOT}/${key}/${month}.md`;
            monthRows.push(`- ${link(monthPath, groupPath)}`);
            tasks.sort((a, b) => str(b.fields.started_at).localeCompare(str(a.fields.started_at)) || str(a.fields.task_id).localeCompare(str(b.fields.task_id)));
            emit(monthPath, `# ${month}\n\n${tasks.map(({ file, fields }) => `- ${link(file.path, monthPath)} · ${str(fields.status)} · ${str(fields.objective).replace(/[\r\n\[\]<>]/g, ' ').slice(0, 100)}`).join('\n')}`);
        }
        emit(groupPath, `# Task group\n\n${navigationLabel(group.label)}\n\n${monthRows.join('\n')}`);
    }
    emit(exports.TASK_INDEX_PATH, `# Task history\n\n${rootRows.join('\n')}`);
    // 已不再使用的受管页保留为导航占位，避免误删或留下旧任务归属。
    const planned = new Set(result.map((row) => row.path));
    for (const file of files) {
        if (!file.path.startsWith(`${exports.TASK_INDEX_ROOT}/`) || (0, markdown_1.parseMarkdown)(file.content).frontmatter.fields.type !== OWNER || planned.has(file.path))
            continue;
        const groupKey = file.path.slice(exports.TASK_INDEX_ROOT.length + 1).split('/')[0];
        const month = file.path.split('/').pop().replace(/\.md$/, '');
        if (!groups.has(groupKey) || month !== 'index' && !groups.get(groupKey).months.has(month))
            emit(file.path, `# Task history\n\n${link(exports.TASK_INDEX_PATH, file.path)}`);
    }
    return result;
}
function previewTaskMigration(files, blockedPaths = [], link = linkDefault, sourceReplacements = new Map()) {
    const migrationOperationId = `task-relations-${inventoryHash(files).slice(0, 32)}`;
    const changes = [], blocked = [], unresolved = [];
    const simulated = files.map((file) => ({ ...file }));
    const ids = new Map();
    for (const file of simulated) {
        const f = (0, markdown_1.parseMarkdown)(file.content).frontmatter.fields;
        for (const key of ['task_id', 'wiki_id'])
            if (str(f[key]) && (key === 'wiki_id' || (0, task_record_1.isTaskRecordType)(f.type)))
                ids.set(`${key}:${str(f[key])}`, [...(ids.get(`${key}:${str(f[key])}`) || []), file.path]);
    }
    const duplicates = new Set([...ids.values()].filter((paths) => paths.length > 1).flat());
    for (const file of simulated) {
        if (!file.path.startsWith('01_knowledge/wiki/'))
            continue;
        const parsed = (0, markdown_1.parseMarkdown)(file.content);
        if (parsed.frontmatter.fields.wiki_id)
            continue;
        if (parsed.frontmatter.errors.length || blockedPaths.includes(file.path) || duplicates.has(file.path)) {
            blocked.push({ path: file.path, reason: 'Wiki identity is invalid or bound to an unfinished operation.' });
            continue;
        }
        const before = file.content;
        const wikiId = `wiki-${digest(`${inventoryHash(files)}\0${file.path}`).slice(0, 32)}`;
        file.content = before.startsWith('---\n') || before.startsWith('---\r\n') ? (0, task_record_1.patchTaskMetadata)(before, { wiki_id: wikiId }) : `---\nwiki_id: ${wikiId}\n---\n${before}`;
        changes.push({ path: file.path, before, after: file.content, kind: 'wiki_identity' });
    }
    for (const path of duplicates)
        if (!blocked.some((row) => row.path === path))
            blocked.push({ path, reason: 'Duplicate stable identity.' });
    const targets = taskTargets(simulated).map((target) => ({ ...target, historical_paths: [...sourceReplacements].filter(([, parent]) => parent === target.path).map(([old]) => old) }));
    let legacyTasks = 0;
    for (const file of simulated) {
        const f = (0, markdown_1.parseMarkdown)(file.content).frontmatter.fields;
        if (!(0, task_record_1.isTaskRecordType)(f.type))
            continue;
        if (f.task_record_version === undefined)
            legacyTasks++;
        try {
            if (!file.path.startsWith(`${knowledge_architecture_1.TRACEKEEPER_TASKS_DIR}/`) || blockedPaths.includes(file.path) || duplicates.has(file.path))
                throw new operation_journal_1.OperationConflictError('Task identity is duplicated, outside the write directory or bound to an unfinished operation.');
            const imported = (0, task_record_1.migrateTaskRecord)(file.content, targets);
            const migrated = f.task_record_version === undefined ? (0, task_record_1.patchTaskMetadata)(imported, { task_relation_migration: migrationOperationId }) : imported;
            const record = (0, task_record_1.parseTaskRecord)((0, markdown_1.parseMarkdown)(migrated).frontmatter.fields);
            const resolved = (0, task_record_1.resolveTaskRelations)(record, targets);
            for (const row of resolved)
                if (row.status !== 'resolved')
                    unresolved.push({ task: file.path, path: row.fact.recorded_path, status: row.status });
            const after = (0, task_record_1.renderTaskRelationProjection)(migrated, resolved, (target) => link(target, file.path));
            if (after !== file.content)
                changes.push({ path: file.path, before: file.content, after, kind: 'task' });
            file.content = after;
        }
        catch (error) {
            blocked.push({ path: file.path, reason: error instanceof Error ? error.message : 'Invalid task record.' });
        }
    }
    try {
        changes.push(...planTaskNavigation(simulated.filter((file) => !blocked.some((row) => row.path === file.path)), link));
    }
    catch (error) {
        blocked.push({ path: exports.TASK_INDEX_PATH, reason: error instanceof Error ? error.message : 'Navigation conflict.' });
    }
    const inventory_hash = inventoryHash(files);
    return { version: 1, id: (0, operation_journal_1.computePayloadHash)([inventory_hash, changes, blocked]), inventory_hash, changes, blocked, unresolved, legacy_tasks: legacyTasks };
}
/** 旧捕获的安全校验先于 Source 写入；结合原回执与当前文件证据识别拒绝，保留失败状态。 */
function isRejectedLegacyCapture(record, files) {
    const payload = record.payload;
    return /^capture-source-[a-f0-9]{24}$/.test(record.operation_id)
        && record.status === 'failed' && record.completed_steps.length === 0 && record.result === undefined
        && Boolean(payload && Object.keys(payload).length === 1 && typeof payload.request_hash === 'string' && /^[a-f0-9]{64}$/.test(payload.request_hash))
        && /^Refusing to write potential secret in (source|capture_reason|content|title): (private key block|credential assignment|secret-like URL query parameter|secret key token)\.$/.test(record.error ?? '')
        && !files.some(file => file.content.includes(record.operation_id));
}
/** 只读迁移门禁：校验拒绝回执的认证结果，保留诊断，但不重放被拒绝的请求。 */
async function inspectTaskMigrationReadiness(vault, files) {
    const journal = (0, log_storage_1.createVaultOperationJournal)(vault), health = await journal.inspect();
    const blocked = [], rejected = [], issues = [...health.issues];
    if (health.attention.length >= 100)
        issues.push('Operational attention list may be truncated; migration requires complete inspection.');
    for (const row of health.attention) {
        const id = row.id.replace(/\.json$/, '');
        try {
            const record = await journal.loadById(id);
            if (record && isRejectedLegacyCapture(record, files))
                rejected.push(id);
            else
                blocked.push(id);
        }
        catch {
            issues.push('Operational receipt authentication failed.');
            blocked.push(id);
        }
    }
    return { blocked, rejected, issues };
}
/** 人类确认入口调用；回执持久化后逐项 CAS，崩溃后只继续同一计划。 */
async function applyTaskMigration(input) {
    if (input.preview.version !== 1 || input.preview.id !== (0, operation_journal_1.computePayloadHash)([input.preview.inventory_hash, input.preview.changes, input.preview.blocked]))
        throw new operation_journal_1.OperationConflictError('Invalid task migration plan binding.');
    for (const change of input.preview.changes) {
        const allowed = change.kind === 'wiki_identity' ? change.path.startsWith('01_knowledge/wiki/') : change.kind === 'task' ? change.path.startsWith(`${knowledge_architecture_1.TRACEKEEPER_TASKS_DIR}/`) : change.kind === 'navigation' && (change.path === exports.TASK_INDEX_PATH || change.path.startsWith(`${exports.TASK_INDEX_ROOT}/`));
        if (!allowed || change.path.split('/').includes('..') || change.path.includes('\\') || !change.path.endsWith('.md'))
            throw new operation_journal_1.OperationConflictError('Migration path is outside its declared owner.');
    }
    const journal = (0, log_storage_1.createVaultOperationJournal)(input.vault), release = await journal.acquireLock('task-relations-migration');
    const operationId = `task-relations-${input.preview.inventory_hash.slice(0, 32)}`;
    try {
        let record = await journal.loadById(operationId);
        const payload = { kind: 'task-relations-migration-v1', backup: input.backup, preview: input.preview };
        let receipt;
        if (record) {
            if (record.payload_hash !== (0, operation_journal_1.computePayloadHash)(payload))
                throw new operation_journal_1.OperationConflictError('Task migration receipt does not match the approved plan.');
            receipt = { version: 1, status: record.status === 'completed' ? 'completed' : 'in_progress', backup: input.backup, preview: input.preview, applied: record.completed_steps.map((step) => step.name.slice('file:'.length)) };
        }
        else {
            if (input.preview.blocked.length)
                throw new operation_journal_1.OperationConflictError('Resolve migration blockers before applying.');
            if (inventoryHash(await readTaskVaultSnapshot(input.repository)) !== input.preview.inventory_hash)
                throw new operation_journal_1.OperationConflictError('Task migration preview is stale.');
            const files = await readTaskVaultSnapshot(input.repository);
            const health = await inspectTaskMigrationReadiness(input.vault, files);
            if (health.blocked.length || health.issues.length)
                throw new operation_journal_1.OperationConflictError('Inspect unfinished or invalid operational receipts before migration.');
            const pending = await journal.listRecoverable();
            if (pending.some(record => !isRejectedLegacyCapture(record, files)) || journal.getRecoveryIssues().length)
                throw new operation_journal_1.OperationConflictError('Recover unfinished operations before task migration.');
            await (0, log_storage_1.backupVault)(input.vault, input.backup);
            if (inventoryHash(await readTaskVaultSnapshot(input.repository)) !== input.preview.inventory_hash)
                throw new operation_journal_1.OperationConflictError('Vault changed after backup.');
            receipt = { version: 1, status: 'in_progress', backup: input.backup, preview: input.preview, applied: [] };
            const now = new Date().toISOString();
            record = { operation_id: operationId, idempotency_key: operationId, payload_hash: (0, operation_journal_1.computePayloadHash)(payload), payload, status: 'in_progress', created_at: now, updated_at: now, completed_steps: [] };
            await journal.save(record);
        }
        if (receipt.status === 'completed')
            return receipt;
        await (0, log_storage_1.verifyVaultBackup)(receipt.backup);
        let batch = 0;
        for (const change of receipt.preview.changes) {
            const current = await input.repository.readText(change.path);
            if (current?.content !== change.after) {
                if (receipt.applied.includes(change.path) || (current?.content ?? null) !== change.before)
                    throw new operation_journal_1.OperationConflictError(`Migration file changed: ${change.path}`);
                await input.failure?.('before_write', change.path);
                if (current)
                    await input.repository.replaceText(change.path, current.version, change.after);
                else
                    await input.repository.createText(change.path, change.after);
                await input.failure?.('after_write', change.path);
            }
            if (!receipt.applied.includes(change.path)) {
                receipt.applied.push(change.path);
                record.completed_steps.push({ name: `file:${change.path}`, completed_at: new Date().toISOString(), result: { hash: digest(change.after) } });
                record.updated_at = new Date().toISOString();
                await journal.save(record);
            }
            if (change.kind === 'task' && ++batch % 100 === 0)
                await new Promise((resolve) => setTimeout(resolve, 0));
        }
        receipt.status = 'completed';
        record.status = 'completed';
        record.updated_at = new Date().toISOString();
        record.result = { status: 'completed', backup: receipt.backup, applied: receipt.applied };
        await journal.save(record);
        return receipt;
    }
    finally {
        await release();
    }
}
/** 成功业务后的派生维护；只处理 V2，不隐式迁移 Wiki 或历史任务。 */
async function maintainTaskNavigation(repository, link = linkDefault, canWrite) {
    const files = await readTaskVaultSnapshot(repository);
    if (!files.some((file) => (0, markdown_1.parseMarkdown)(file.content).frontmatter.fields.task_record_version === 2))
        return { updated: 0, issues: [] };
    const targets = taskTargets(files);
    const changes = [], issues = [];
    for (const file of files) {
        try {
            const fields = (0, markdown_1.parseMarkdown)(file.content).frontmatter.fields;
            if (!(0, task_record_1.isTaskRecordType)(fields.type))
                continue;
            const record = (0, task_record_1.parseTaskRecord)(fields);
            if (!record)
                continue;
            if (!file.path.startsWith(`${knowledge_architecture_1.TRACEKEEPER_TASKS_DIR}/`))
                throw new operation_journal_1.OperationConflictError('Task is outside its controlled directory.');
            const after = (0, task_record_1.renderTaskRelationProjection)(file.content, (0, task_record_1.resolveTaskRelations)(record, targets), (target) => link(target, file.path));
            if (after !== file.content)
                changes.push({ path: file.path, before: file.content, after, kind: 'task' });
        }
        catch (error) {
            issues.push({ path: file.path, reason: error instanceof Error ? error.message : 'Task navigation failed.' });
        }
    }
    try {
        changes.push(...planTaskNavigation(files, link));
    }
    catch (error) {
        issues.push({ path: exports.TASK_INDEX_PATH, reason: error instanceof Error ? error.message : 'Navigation failed.' });
    }
    let updated = 0;
    for (const change of changes) {
        if (canWrite && !canWrite())
            return { updated, issues, deferred: true };
        try {
            const current = await repository.readText(change.path);
            if ((current?.content ?? null) !== change.before)
                throw new operation_journal_1.OperationConflictError('File changed before navigation commit.');
            if (canWrite && !canWrite())
                return { updated, issues, deferred: true };
            if (current)
                await repository.replaceText(change.path, current.version, change.after);
            else
                await repository.createText(change.path, change.after);
            updated++;
        }
        catch (error) {
            issues.push({ path: change.path, reason: error instanceof Error ? error.message : 'Navigation commit failed.' });
        }
    }
    return { updated, issues };
}
/** 未完成迁移仅回到原批准计划；普通诊断不触发恢复写入。 */
async function pendingTaskMigrations(vault) {
    const logs = new log_storage_1.OperationalLogRepository(vault), journal = (0, log_storage_1.createVaultOperationJournal)(vault);
    const pending = [];
    for (const file of await logs.list()) {
        const id = file.slice(knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR.length + 1).replace(/\.json$/, '');
        if (!/^task-relations-[a-f0-9]{32}$/.test(id))
            continue;
        const record = await journal.loadById(id);
        if (!record)
            throw new operation_journal_1.OperationConflictError('Task migration receipt is missing.');
        if (record.status === 'completed' || record.status === 'conflicted')
            continue;
        const payload = record.payload;
        if (payload?.kind !== 'task-relations-migration-v1' || typeof payload.backup !== 'string' || payload.preview?.version !== 1)
            throw new operation_journal_1.OperationConflictError('Invalid task migration receipt.');
        pending.push({ version: 1, status: 'in_progress', backup: payload.backup, preview: payload.preview, applied: record.completed_steps.map((step) => step.name.slice('file:'.length)) });
    }
    return pending;
}
/** 文件落盘与迁移终态之间的窗口仍受迁移所有权保护。 */
async function assertTaskMigrationCommitted(journal, fields) {
    if (fields.task_relation_migration === undefined)
        return;
    const id = str(fields.task_relation_migration);
    if (!/^task-relations-[a-f0-9]{32}$/.test(id))
        throw new task_record_1.TaskMigrationRequiredError(str(fields.task_id));
    const record = await journal.loadById(id);
    const payload = record?.payload;
    if (record?.status !== 'completed' || payload?.kind !== 'task-relations-migration-v1' || !payload.preview?.changes.some((change) => change.kind === 'task' && (0, markdown_1.parseMarkdown)(change.after).frontmatter.fields.task_id === fields.task_id))
        throw new task_record_1.TaskMigrationRequiredError(str(fields.task_id));
}
