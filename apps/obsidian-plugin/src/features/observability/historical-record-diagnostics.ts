import type { OperationRecord } from '@tracekeeper/core';

export interface HistoricalRecordDiagnostic {
	kind: 'legacy_links' | 'missing_source' | 'unverified_auto_receipt' | 'missing_auto_target';
	ownerPath: string;
	contentHash: string;
	targetPaths: string[];
	evidence: string[];
}

export interface HistoricalDiagnostics {
	entries: HistoricalRecordDiagnostic[];
	inspectedRecords: number;
	totalRecords: number;
	truncated: boolean;
}

export interface HistoricalDisclosureState {
	openKeys: ReadonlySet<string>;
	focusedKey: string | null;
}

/** 在容器重绘前捕获展开和焦点；记录键包含证据版本，避免沿用已变化的预览。 */
export function captureHistoricalDisclosureState(container: HTMLElement): HistoricalDisclosureState {
	const openKeys = new Set<string>();
	let focusedKey: string | null = null;
	for (const details of Array.from(container.querySelectorAll<HTMLDetailsElement>('details[data-tracekeeper-history-key]'))) {
		const key = details.dataset.tracekeeperHistoryKey!;
		if (details.open) openKeys.add(key);
		if (details.querySelector('summary') === container.ownerDocument.activeElement) focusedKey = key;
	}
	return { openKeys, focusedKey };
}

interface DiagnosticNote {
	path: string;
	contentHash: string;
	frontmatter: Record<string, unknown>;
	modifiedAt?: string;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
	.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 有界检查历史记录的引用与回执；只返回证据和建议，不产生修复操作。 */
export async function inspectHistoricalRecords(
	notes: readonly DiagnosticNote[],
	replacements: ReadonlyMap<string, string>,
	readReceipt: (operationId: string) => Promise<OperationRecord | null>,
	limit = 50
): Promise<HistoricalDiagnostics> {
	const paths = new Set(notes.map((note) => note.path));
	const candidates = notes.filter((note) => typeof note.frontmatter.proposal_links === 'string'
		|| strings(note.frontmatter.source_captures).length > 0
		|| strings(note.frontmatter.auto_write_operation_ids).length > 0
		|| strings(note.frontmatter.memory_writes).length > 0)
		.sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? '') || a.path.localeCompare(b.path));
	const selected = candidates.slice(0, Math.max(1, Math.min(50, limit)));
	const entries: HistoricalRecordDiagnostic[] = [];
	let receiptReads = 0;
	let limited = false;
	for (const note of selected) {
		const add = (kind: HistoricalRecordDiagnostic['kind'], targetPaths: string[], evidence: string[]) => entries.push({
			kind, ownerPath: note.path, contentHash: note.contentHash, targetPaths, evidence,
		});
		const links = note.frontmatter.proposal_links;
		if (typeof links === 'string' && [...links.matchAll(/\[\[[^\]\n]+\]\]/g)].length > 1) {
			add('legacy_links', strings(note.frontmatter.proposal_paths), ['proposal_links']);
		}
		const missingSources = strings(note.frontmatter.source_captures).filter((source) => source.startsWith('01_knowledge/sources/') && !paths.has(source) && !replacements.has(source));
		if (missingSources.length > 0) add('missing_source', missingSources.slice(0, 20), ['source_captures']);
		if (missingSources.length > 20) limited = true;
		const writes = strings(note.frontmatter.memory_writes);
		const ids = new Set(strings(note.frontmatter.auto_write_operation_ids));
		for (const target of writes) {
			if (!target.startsWith('01_knowledge/memory/')) continue;
			const id = target.match(/\/propose_memory-(propose-memory-[a-f0-9]{24})\.md$/)?.[1];
			if (id) ids.add(id);
		}
		for (const operationId of ids) {
			if (receiptReads >= 20) { limited = true; break; }
			receiptReads++;
			let receipt: OperationRecord | null = null;
			try { if (/^propose-memory-[a-f0-9]{24}$/.test(operationId)) receipt = await readReceipt(operationId); } catch { /* 诊断继续保留未验证状态。 */ }
			const payload = receipt?.payload;
			const result = receipt?.result;
			if (receipt?.status !== 'completed' || !object(payload) || !object(payload.requestSnapshot)
				|| payload.requestSnapshot.task_id !== note.frontmatter.task_id || !object(result) || result.auto_applied !== true
				|| typeof result.path !== 'string' || !writes.includes(result.path)
				|| !/^01_knowledge\/(memory|wiki)\//.test(result.path)) {
				add('unverified_auto_receipt', writes.slice(0, 20), [operationId]);
			} else if (!paths.has(result.path)) add('missing_auto_target', [result.path], [operationId]);
		}
	}
	return { entries, inspectedRecords: selected.length, totalRecords: candidates.length, truncated: limited || selected.length < candidates.length };
}

export function renderHistoricalDiagnostics(
	container: HTMLElement,
	diagnostics: HistoricalDiagnostics | undefined,
	ui: (chinese: string, english: string) => string,
	state?: HistoricalDisclosureState
): void {
	if (!diagnostics || (diagnostics.entries.length === 0 && !diagnostics.truncated)) {
		if (state?.focusedKey) container.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
		return;
	}
	const panel = container.createEl('details', { cls: 'tracekeeper-card' });
	panel.dataset.tracekeeperHistoryKey = 'panel';
	panel.open = state?.openKeys.has('panel') ?? false;
	const panelSummary = panel.createEl('summary', { text: ui(`历史记录检查：${diagnostics.entries.length} 项提示`, `Historical records: ${diagnostics.entries.length} observations`) });
	let focusTarget: HTMLElement = panelSummary;
	panel.createEl('p', { text: ui(`已检查 ${diagnostics.inspectedRecords}/${diagnostics.totalRecords} 条记录。此处仅提供检查结果与修复建议。`,
		`Inspected ${diagnostics.inspectedRecords}/${diagnostics.totalRecords} records. This preview provides evidence and suggested next steps.`) });
	if (diagnostics.truncated) panel.createEl('p', { text: ui('本次有界预览尚未覆盖全部记录或回执。', 'This bounded preview does not cover every record or receipt.') });
	for (const entry of diagnostics.entries) {
		const row = panel.createEl('details');
		const key = JSON.stringify([entry.kind, entry.ownerPath, entry.contentHash, entry.targetPaths, entry.evidence]);
		row.dataset.tracekeeperHistoryKey = key;
		row.open = state?.openKeys.has(key) ?? false;
		const summary = row.createEl('summary', { text: entry.ownerPath });
		if (state?.focusedKey === key) focusTarget = summary;
		const reasons = {
			legacy_links: ui('链接使用旧逗号格式，目前仍可读取。以后编辑时可转换为 YAML 数组。', 'Links use the readable legacy comma format. Convert to a YAML array during a later edit.'),
			missing_source: ui('原资料引用不存在，也没有与当前内容匹配的迁移证据。请检查资料位置及迁移回执。', 'The source is absent and has no verified replacement. Check its location and migration receipt.'),
			unverified_auto_receipt: ui('无法验证 Auto 写入回执，暂不能确认持久化结果。请核对任务与操作记录，不要直接重复提交。', 'The Auto write receipt cannot be verified. Inspect the task and operation before resubmitting.'),
			missing_auto_target: ui('写入回执有效，但目标笔记当前不存在。请检查移动记录或备份后再决定修复。', 'The receipt is valid, but its target is absent. Inspect move history or backups before repair.'),
		};
		row.createEl('p', { text: reasons[entry.kind] });
		row.createEl('p', { text: ui('当前内容哈希：', 'Current content hash: ') + entry.contentHash });
		for (const evidence of [...entry.targetPaths, ...entry.evidence]) row.createEl('p', { text: evidence });
	}
	if (state?.focusedKey) focusTarget.focus({ preventScroll: true });
}
