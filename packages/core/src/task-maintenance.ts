import crypto from 'node:crypto';
import { parseMarkdown } from './markdown';
import { computePayloadHash, type OperationRecord, OperationConflictError } from './operation-journal';
import { backupVault, verifyVaultBackup, createVaultOperationJournal, OperationalLogRepository } from './log-storage';
import type { VaultRepository, VaultTextFile } from './vault-repository';
import { normalizeProjectRepositoryPath } from './project-memory';
import { TRACEKEEPER_TASKS_DIR, TRACEKEEPER_OPERATIONS_DIR } from './knowledge-architecture';
import { isTaskRecordType, migrateTaskRecord, parseTaskRecord, patchTaskMetadata, resolveTaskRelations, renderTaskRelationProjection, TaskMigrationRequiredError, type TaskRelationTarget } from './task-record';

const digest = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');
const str = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
export const TASK_INDEX_ROOT = '00_tracekeeper/work/task_index';
export const TASK_INDEX_PATH = '00_tracekeeper/work/index.md';
const OWNER = 'tracekeeper_task_index';

/** 扫描只读文件快照；所有后续解析与预览绑定同一批内容。 */
export async function readTaskVaultSnapshot(repository: VaultRepository): Promise<VaultTextFile[]> {
	const listing = await repository.listMarkdown();
	const files: VaultTextFile[] = [];
	for (const row of listing) {
		const file = await repository.readText(row.path);
		if (!file || file.version !== row.version) throw new OperationConflictError('Vault changed during task snapshot.');
		files.push(file);
	}
	return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function taskTargets(files: readonly VaultTextFile[]): TaskRelationTarget[] {
	return files.map((file) => ({ path: file.path, frontmatter: parseMarkdown(file.content).frontmatter.fields, contentHash: digest(file.content), content: file.content }));
}

/** 全库查重，受控目录外的同身份任务不能被当作不存在。 */
export function resolveTaskIdentity(targets: readonly TaskRelationTarget[], taskId: string, writable = false): string | null {
	const matches = targets.filter((target) => isTaskRecordType(target.frontmatter.type) && target.frontmatter.task_id === taskId);
	if (matches.length > 1) throw new OperationConflictError('Duplicate task identity.');
	const found = matches[0]?.path ?? null;
	if (found && writable && !found.startsWith(`${TRACEKEEPER_TASKS_DIR}/`)) throw new OperationConflictError('Task moved outside its controlled write directory.');
	return found;
}
export async function findTaskById(repository: VaultRepository, taskId: string, writable = false): Promise<VaultTextFile | null> {
	const files = await readTaskVaultSnapshot(repository);
	const found = resolveTaskIdentity(taskTargets(files), taskId, writable);
	return files.find((file) => file.path === found) ?? null;
}
export async function requireWritableTaskV2(repository: VaultRepository, taskId: string): Promise<VaultTextFile | null> {
	const file = await findTaskById(repository, taskId, true);
	if (file && !parseTaskRecord(parseMarkdown(file.content).frontmatter.fields)) throw new TaskMigrationRequiredError(taskId);
	return file;
}

export interface TaskFileChange { path: string; before: string | null; after: string; kind: 'wiki_identity' | 'task' | 'navigation' }
export interface TaskMaintenancePreview {
	version: 1;
	id: string;
	inventory_hash: string;
	changes: TaskFileChange[];
	blocked: Array<{ path: string; reason: string }>;
	unresolved: Array<{ task: string; path: string; status: string }>;
	legacy_tasks: number;
}
const inventoryHash = (files: readonly VaultTextFile[]) => digest(JSON.stringify(files.map((file) => [file.path, digest(file.content)])));

function monthOf(fields: Record<string, unknown>): string {
	for (const key of ['started_at', 'recorded_at']) {
		const value = str(fields[key]);
		if (/^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value))) return new Date(value).toISOString().slice(0, 7);
	}
	return 'undated';
}
const normalizeRepo = (value: string): string => { try { return normalizeProjectRepositoryPath(value); } catch { return ''; } };
const navigationLabel = (value: string): string => JSON.stringify(value).replace(/[\\`*_\[\]<>]/g, '\\$&');
const linkDefault = (path: string): string => `[[${path.replace(/\.md$/, '')}]]`;

/** 导航只表达组织关系，不为无成果任务生成知识引用。 */
export function planTaskNavigation(files: readonly VaultTextFile[], link: (target: string, source: string) => string = linkDefault): TaskFileChange[] {
	const targets = taskTargets(files);
	const groups = new Map<string, { label: string; months: Map<string, Array<{ file: VaultTextFile; fields: Record<string, unknown> }>> }>();
	const projects = targets.filter((target) => str(target.frontmatter.project_id) && /\/index\.md$/.test(target.path) && target.path.startsWith('01_knowledge/memory/projects/'));
	for (const file of files) {
		const fields = parseMarkdown(file.content).frontmatter.fields;
		if (!isTaskRecordType(fields.type) || !parseTaskRecord(fields)) continue;
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
	const result: TaskFileChange[] = [];
	const emit = (path: string, body: string) => {
		const existing = files.find((file) => file.path === path);
		if (existing) {
			const parsed = parseMarkdown(existing.content);
			const storedBody = existing.content.slice(existing.content.indexOf('\n---\n') + 5);
			if (parsed.frontmatter.fields.type !== OWNER || parsed.frontmatter.fields.task_index_hash !== digest(storedBody) && storedBody !== body + '\n') throw new OperationConflictError(`Navigation path is occupied or edited: ${path}`);
		}
		const after = `---\ntype: ${OWNER}\ntask_index_version: 1\ntask_index_hash: ${digest(body + '\n')}\n---\n${body}\n`;
		if (existing?.content !== after) result.push({ path, before: existing?.content ?? null, after, kind: 'navigation' });
	};
	const rootRows: string[] = [];
	for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
		const groupPath = `${TASK_INDEX_ROOT}/${key}/index.md`;
		rootRows.push(`- ${link(groupPath, TASK_INDEX_PATH)}`);
		const monthRows: string[] = [];
		for (const [month, tasks] of [...group.months].sort(([a], [b]) => b.localeCompare(a))) {
			const monthPath = `${TASK_INDEX_ROOT}/${key}/${month}.md`;
			monthRows.push(`- ${link(monthPath, groupPath)}`);
			tasks.sort((a, b) => str(b.fields.started_at).localeCompare(str(a.fields.started_at)) || str(a.fields.task_id).localeCompare(str(b.fields.task_id)));
			emit(monthPath, `# ${month}\n\n${tasks.map(({ file, fields }) => `- ${link(file.path, monthPath)} · ${str(fields.status)} · ${str(fields.objective).replace(/[\r\n\[\]<>]/g, ' ').slice(0, 100)}`).join('\n')}`);
		}
		emit(groupPath, `# Task group\n\n${navigationLabel(group.label)}\n\n${monthRows.join('\n')}`);
	}
	emit(TASK_INDEX_PATH, `# Task history\n\n${rootRows.join('\n')}`);
	// 已不再使用的受管页保留为导航占位，避免误删或留下旧任务归属。
	const planned = new Set(result.map((row) => row.path));
	for (const file of files) {
		if (!file.path.startsWith(`${TASK_INDEX_ROOT}/`) || parseMarkdown(file.content).frontmatter.fields.type !== OWNER || planned.has(file.path)) continue;
		const groupKey = file.path.slice(TASK_INDEX_ROOT.length + 1).split('/')[0];
		const month = file.path.split('/').pop()!.replace(/\.md$/, '');
		if (!groups.has(groupKey) || month !== 'index' && !groups.get(groupKey)!.months.has(month)) emit(file.path, `# Task history\n\n${link(TASK_INDEX_PATH, file.path)}`);
	}
	return result;
}

export function previewTaskMigration(files: readonly VaultTextFile[], blockedPaths: readonly string[] = [], link: (target: string, source: string) => string = linkDefault, sourceReplacements: ReadonlyMap<string, string> = new Map()): TaskMaintenancePreview {
	const migrationOperationId = `task-relations-${inventoryHash(files).slice(0, 32)}`;
	const changes: TaskFileChange[] = [], blocked: TaskMaintenancePreview['blocked'] = [], unresolved: TaskMaintenancePreview['unresolved'] = [];
	const simulated = files.map((file) => ({ ...file }));
	const ids = new Map<string, string[]>();
	for (const file of simulated) {
		const f = parseMarkdown(file.content).frontmatter.fields;
		for (const key of ['task_id', 'wiki_id']) if (str(f[key]) && (key === 'wiki_id' || isTaskRecordType(f.type))) ids.set(`${key}:${str(f[key])}`, [...(ids.get(`${key}:${str(f[key])}`) || []), file.path]);
	}
	const duplicates = new Set([...ids.values()].filter((paths) => paths.length > 1).flat());
	for (const file of simulated) {
		if (!file.path.startsWith('01_knowledge/wiki/')) continue;
		const parsed = parseMarkdown(file.content);
		if (parsed.frontmatter.fields.wiki_id) continue;
		if (parsed.frontmatter.errors.length || blockedPaths.includes(file.path) || duplicates.has(file.path)) { blocked.push({ path: file.path, reason: 'Wiki identity is invalid or bound to an unfinished operation.' }); continue; }
		const before = file.content;
		const wikiId = `wiki-${digest(`${inventoryHash(files)}\0${file.path}`).slice(0, 32)}`;
		file.content = before.startsWith('---\n') || before.startsWith('---\r\n') ? patchTaskMetadata(before, { wiki_id: wikiId }) : `---\nwiki_id: ${wikiId}\n---\n${before}`;
		changes.push({ path: file.path, before, after: file.content, kind: 'wiki_identity' });
	}
	for (const path of duplicates) if (!blocked.some((row) => row.path === path)) blocked.push({ path, reason: 'Duplicate stable identity.' });
	const targets = taskTargets(simulated).map((target) => ({ ...target, historical_paths: [...sourceReplacements].filter(([, parent]) => parent === target.path).map(([old]) => old) }));
	let legacyTasks = 0;
	for (const file of simulated) {
		const f = parseMarkdown(file.content).frontmatter.fields;
		if (!isTaskRecordType(f.type)) continue;
		if (f.task_record_version === undefined) legacyTasks++;
		try {
			if (!file.path.startsWith(`${TRACEKEEPER_TASKS_DIR}/`) || blockedPaths.includes(file.path) || duplicates.has(file.path)) throw new OperationConflictError('Task identity is duplicated, outside the write directory or bound to an unfinished operation.');
			const imported = migrateTaskRecord(file.content, targets);
			const migrated = f.task_record_version === undefined ? patchTaskMetadata(imported, { task_relation_migration: migrationOperationId }) : imported;
			const record = parseTaskRecord(parseMarkdown(migrated).frontmatter.fields)!;
			const resolved = resolveTaskRelations(record, targets);
			for (const row of resolved) if (row.status !== 'resolved') unresolved.push({ task: file.path, path: row.fact.recorded_path, status: row.status });
			const after = renderTaskRelationProjection(migrated, resolved, (target) => link(target, file.path));
			if (after !== file.content) changes.push({ path: file.path, before: file.content, after, kind: 'task' });
			file.content = after;
		} catch (error) { blocked.push({ path: file.path, reason: error instanceof Error ? error.message : 'Invalid task record.' }); }
	}
	try { changes.push(...planTaskNavigation(simulated.filter((file) => !blocked.some((row) => row.path === file.path)), link)); }
	catch (error) { blocked.push({ path: TASK_INDEX_PATH, reason: error instanceof Error ? error.message : 'Navigation conflict.' }); }
	const inventory_hash = inventoryHash(files);
	return { version: 1, id: computePayloadHash([inventory_hash, changes, blocked]), inventory_hash, changes, blocked, unresolved, legacy_tasks: legacyTasks };
}

/** 旧捕获的安全校验先于 Source 写入；结合原回执与当前文件证据识别拒绝，保留失败状态。 */
export function isRejectedLegacyCapture(record: OperationRecord, files: readonly VaultTextFile[]): boolean {
	const payload = record.payload as Record<string, unknown> | undefined;
	return /^capture-source-[a-f0-9]{24}$/.test(record.operation_id)
		&& record.status === 'failed' && record.completed_steps.length === 0 && record.result === undefined
		&& Boolean(payload && Object.keys(payload).length === 1 && typeof payload.request_hash === 'string' && /^[a-f0-9]{64}$/.test(payload.request_hash))
		&& /^Refusing to write potential secret in (source|capture_reason|content|title): (private key block|credential assignment|secret-like URL query parameter|secret key token)\.$/.test(record.error ?? '')
		&& !files.some(file => file.content.includes(record.operation_id));
}

/** 只读迁移门禁：校验拒绝回执的认证结果，保留诊断，但不重放被拒绝的请求。 */
export async function inspectTaskMigrationReadiness(vault: string, files: readonly VaultTextFile[]): Promise<{ blocked: string[]; rejected: string[]; issues: string[] }> {
	const journal = createVaultOperationJournal(vault), health = await journal.inspect();
	const blocked: string[] = [], rejected: string[] = [], issues = [...health.issues];
	if (health.attention.length >= 100) issues.push('Operational attention list may be truncated; migration requires complete inspection.');
	for (const row of health.attention) {
		const id = row.id.replace(/\.json$/, '');
		try {
			const record = await journal.loadById(id);
			if (record && isRejectedLegacyCapture(record, files)) rejected.push(id);
			else blocked.push(id);
		} catch { issues.push('Operational receipt authentication failed.'); blocked.push(id); }
	}
	return { blocked, rejected, issues };
}

export interface TaskMigrationReceipt { version: 1; status: 'in_progress' | 'completed'; backup: string; preview: TaskMaintenancePreview; applied: string[] }
/** 人类确认入口调用；回执持久化后逐项 CAS，崩溃后只继续同一计划。 */
export async function applyTaskMigration(input: { vault: string; repository: VaultRepository; preview: TaskMaintenancePreview; backup: string; failure?: (phase: string, path: string) => void | Promise<void> }): Promise<TaskMigrationReceipt> {
	if (input.preview.version !== 1 || input.preview.id !== computePayloadHash([input.preview.inventory_hash, input.preview.changes, input.preview.blocked])) throw new OperationConflictError('Invalid task migration plan binding.');
	for (const change of input.preview.changes) {
		const allowed = change.kind === 'wiki_identity' ? change.path.startsWith('01_knowledge/wiki/') : change.kind === 'task' ? change.path.startsWith(`${TRACEKEEPER_TASKS_DIR}/`) : change.kind === 'navigation' && (change.path === TASK_INDEX_PATH || change.path.startsWith(`${TASK_INDEX_ROOT}/`));
		if (!allowed || change.path.split('/').includes('..') || change.path.includes('\\') || !change.path.endsWith('.md')) throw new OperationConflictError('Migration path is outside its declared owner.');
	}
	const journal = createVaultOperationJournal(input.vault), release = await journal.acquireLock('task-relations-migration');
	const operationId = `task-relations-${input.preview.inventory_hash.slice(0, 32)}`;
	try {
		let record = await journal.loadById(operationId);
		const payload = { kind: 'task-relations-migration-v1', backup: input.backup, preview: input.preview };
		let receipt: TaskMigrationReceipt;
		if (record) {
			if (record.payload_hash !== computePayloadHash(payload)) throw new OperationConflictError('Task migration receipt does not match the approved plan.');
			receipt = { version: 1, status: record.status === 'completed' ? 'completed' : 'in_progress', backup: input.backup, preview: input.preview, applied: record.completed_steps.map((step) => step.name.slice('file:'.length)) };
		} else {
			if (input.preview.blocked.length) throw new OperationConflictError('Resolve migration blockers before applying.');
			if (inventoryHash(await readTaskVaultSnapshot(input.repository)) !== input.preview.inventory_hash) throw new OperationConflictError('Task migration preview is stale.');
			const files = await readTaskVaultSnapshot(input.repository);
			const health = await inspectTaskMigrationReadiness(input.vault, files);
			if (health.blocked.length || health.issues.length) throw new OperationConflictError('Inspect unfinished or invalid operational receipts before migration.');
			const pending = await journal.listRecoverable();
			if (pending.some(record => !isRejectedLegacyCapture(record, files)) || journal.getRecoveryIssues().length) throw new OperationConflictError('Recover unfinished operations before task migration.');
			await backupVault(input.vault, input.backup);
			if (inventoryHash(await readTaskVaultSnapshot(input.repository)) !== input.preview.inventory_hash) throw new OperationConflictError('Vault changed after backup.');
			receipt = { version: 1, status: 'in_progress', backup: input.backup, preview: input.preview, applied: [] };
			const now = new Date().toISOString();
			record = { operation_id: operationId, idempotency_key: operationId, payload_hash: computePayloadHash(payload), payload, status: 'in_progress', created_at: now, updated_at: now, completed_steps: [] };
			await journal.save(record);
		}
		if (receipt.status === 'completed') return receipt;
		await verifyVaultBackup(receipt.backup);
		let batch = 0;
		for (const change of receipt.preview.changes) {
			const current = await input.repository.readText(change.path);
			if (current?.content !== change.after) {
				if (receipt.applied.includes(change.path) || (current?.content ?? null) !== change.before) throw new OperationConflictError(`Migration file changed: ${change.path}`);
				await input.failure?.('before_write', change.path);
				if (current) await input.repository.replaceText(change.path, current.version, change.after);
				else await input.repository.createText(change.path, change.after);
				await input.failure?.('after_write', change.path);
			}
			if (!receipt.applied.includes(change.path)) {
				receipt.applied.push(change.path);
				record.completed_steps.push({ name: `file:${change.path}`, completed_at: new Date().toISOString(), result: { hash: digest(change.after) } });
				record.updated_at = new Date().toISOString();
				await journal.save(record);
			}
			if (change.kind === 'task' && ++batch % 100 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
		}
		receipt.status = 'completed';
		record.status = 'completed'; record.updated_at = new Date().toISOString(); record.result = { status: 'completed', backup: receipt.backup, applied: receipt.applied };
		await journal.save(record);
		return receipt;
	} finally { await release(); }
}

/** 成功业务后的派生维护；只处理 V2，不隐式迁移 Wiki 或历史任务。 */
export async function maintainTaskNavigation(repository: VaultRepository, link: (target: string, source: string) => string = linkDefault, canWrite?: () => boolean): Promise<{ updated: number; issues: Array<{ path: string; reason: string }>; deferred?: boolean }> {
	const files = await readTaskVaultSnapshot(repository);
	if (!files.some((file) => parseMarkdown(file.content).frontmatter.fields.task_record_version === 2)) return { updated: 0, issues: [] };
	const targets = taskTargets(files);
	const changes: TaskFileChange[] = [], issues: Array<{ path: string; reason: string }> = [];
	for (const file of files) {
		try {
			const fields = parseMarkdown(file.content).frontmatter.fields;
			if (!isTaskRecordType(fields.type)) continue;
			const record = parseTaskRecord(fields);
			if (!record) continue;
			if (!file.path.startsWith(`${TRACEKEEPER_TASKS_DIR}/`)) throw new OperationConflictError('Task is outside its controlled directory.');
			const after = renderTaskRelationProjection(file.content, resolveTaskRelations(record, targets), (target) => link(target, file.path));
			if (after !== file.content) changes.push({ path: file.path, before: file.content, after, kind: 'task' });
		} catch (error) { issues.push({ path: file.path, reason: error instanceof Error ? error.message : 'Task navigation failed.' }); }
	}
	try { changes.push(...planTaskNavigation(files, link)); } catch (error) { issues.push({ path: TASK_INDEX_PATH, reason: error instanceof Error ? error.message : 'Navigation failed.' }); }
	let updated = 0;
	for (const change of changes) {
		if (canWrite && !canWrite()) return { updated, issues, deferred: true };
		try {
			const current = await repository.readText(change.path);
			if ((current?.content ?? null) !== change.before) throw new OperationConflictError('File changed before navigation commit.');
			if (canWrite && !canWrite()) return { updated, issues, deferred: true };
			if (current) await repository.replaceText(change.path, current.version, change.after);
			else await repository.createText(change.path, change.after);
			updated++;
		} catch (error) { issues.push({ path: change.path, reason: error instanceof Error ? error.message : 'Navigation commit failed.' }); }
	}
	return { updated, issues };
}

/** 未完成迁移仅回到原批准计划；普通诊断不触发恢复写入。 */
export async function pendingTaskMigrations(vault: string): Promise<TaskMigrationReceipt[]> {
	const logs = new OperationalLogRepository(vault), journal = createVaultOperationJournal(vault);
	const pending: TaskMigrationReceipt[] = [];
	for (const file of await logs.list()) {
		const id = file.slice(TRACEKEEPER_OPERATIONS_DIR.length + 1).replace(/\.json$/, '');
		if (!/^task-relations-[a-f0-9]{32}$/.test(id)) continue;
		const record = await journal.loadById(id);
		if (!record) throw new OperationConflictError('Task migration receipt is missing.');
		if (record.status === 'completed' || record.status === 'conflicted') continue;
		const payload = record.payload as { kind?: string; backup?: string; preview?: TaskMaintenancePreview } | undefined;
		if (payload?.kind !== 'task-relations-migration-v1' || typeof payload.backup !== 'string' || payload.preview?.version !== 1) throw new OperationConflictError('Invalid task migration receipt.');
		pending.push({ version: 1, status: 'in_progress', backup: payload.backup, preview: payload.preview, applied: record.completed_steps.map((step) => step.name.slice('file:'.length)) });
	}
	return pending;
}

/** 文件落盘与迁移终态之间的窗口仍受迁移所有权保护。 */
export async function assertTaskMigrationCommitted(journal: import('./operation-journal').OperationJournal, fields: Readonly<Record<string, unknown>>): Promise<void> {
	if (fields.task_relation_migration === undefined) return;
	const id = str(fields.task_relation_migration);
	if (!/^task-relations-[a-f0-9]{32}$/.test(id)) throw new TaskMigrationRequiredError(str(fields.task_id));
	const record = await journal.loadById(id);
	const payload = record?.payload as { kind?: string; preview?: TaskMaintenancePreview } | undefined;
	if (record?.status !== 'completed' || payload?.kind !== 'task-relations-migration-v1' || !payload.preview?.changes.some((change) => change.kind === 'task' && parseMarkdown(change.after).frontmatter.fields.task_id === fields.task_id)) throw new TaskMigrationRequiredError(str(fields.task_id));
}
