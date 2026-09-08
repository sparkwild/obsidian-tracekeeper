import { createHash } from 'node:crypto';
import { sourceIndexPathForPart } from './wiki-governance';
import { OperationalLogRepository } from './log-storage';
import { TRACEKEEPER_OPERATIONS_DIR, KNOWLEDGE_SOURCES_DIR } from './knowledge-architecture';

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
export const SOURCE_HISTORY_RECEIPTS = `${TRACEKEEPER_OPERATIONS_DIR}/source-consolidations`;

/** 所有界面与迁移复用同一证明：完整回执绑定、终态、分片及父索引当前哈希。 */
export function verifiedSourceReplacements(receipts: readonly { path: string; content: string }[], contentHashes: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
	const replacements = new Map<string, string>(), ambiguous = new Set<string>();
	for (const receipt of receipts) {
		if (!receipt.path.startsWith(`${SOURCE_HISTORY_RECEIPTS}/`) || !receipt.path.endsWith('.json') || receipt.path.endsWith('.archive.json') || Buffer.byteLength(receipt.content) > 2 * 1024 * 1024) continue;
		try {
			const journal = JSON.parse(receipt.content);
			const { bindingHash, ...unsigned } = journal;
			if (journal.version !== 1 || journal.status !== 'completed' || !Array.isArray(journal.outputs) || digest(canonical(unsigned)) !== bindingHash) continue;
			const valid = new Map<string, { kind: string; legacyPath: string }>();
			for (const item of journal.outputs) {
				if (item && item.state === 'verified' && typeof item.path === 'string' && typeof item.legacyPath === 'string' && contentHashes.get(item.path) === item.expectedHash) valid.set(item.path, item);
			}
			for (const [partPath, item] of valid) {
				if (item.kind !== 'source_part' || !item.legacyPath.startsWith(`${KNOWLEDGE_SOURCES_DIR}/`)) continue;
				const parent = sourceIndexPathForPart(partPath);
				if (!parent || valid.get(parent)?.kind !== 'source_capture' || ambiguous.has(item.legacyPath)) continue;
				if (replacements.has(item.legacyPath) && replacements.get(item.legacyPath) !== parent) { replacements.delete(item.legacyPath); ambiguous.add(item.legacyPath); }
				else replacements.set(item.legacyPath, parent);
			}
		} catch { /* 损坏回执不能产生替代关系；原引用仍显示为缺失或未验证。 */ }
	}
	return replacements;
}

export async function readVerifiedSourceReplacements(vault: string, contentHashes: ReadonlyMap<string, string>): Promise<ReadonlyMap<string, string>> {
	const logs = new OperationalLogRepository(vault);
	const receipts = [];
	for (const path of await logs.list(SOURCE_HISTORY_RECEIPTS)) {
		if (!path.endsWith('.json') || path.endsWith('.archive.json')) continue;
		const content = await logs.readText(path);
		if (content !== null) receipts.push({ path, content });
	}
	return verifiedSourceReplacements(receipts, contentHashes);
}
