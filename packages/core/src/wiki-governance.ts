import crypto from 'node:crypto';
import {
	KNOWLEDGE_SOURCES_DIR,
	KNOWLEDGE_WIKI_DIR,
	isKnowledgeSourcePath,
	isKnowledgeWikiPath,
	normalizeKnowledgePath,
	startsWithPathPrefix,
} from './knowledge-architecture';

export const WIKI_PROPOSAL_SCHEMA_VERSION = 2 as const;
export const MANAGED_RELATIONS_SCHEMA_VERSION = 1 as const;
export const WIKI_REVIEW_BATCH_MAX_ITEMS = 100;
export const WIKI_REVIEW_BATCH_MAX_BYTES = 2 * 1024 * 1024;

export type WikiChangeRule =
	| 'review_each'
	| 'review_batch'
	| 'auto_managed'
	| 'disabled';

export type WikiRole = 'topic' | 'topic_map';
export type WikiEffectiveRisk = 'low' | 'medium' | 'high' | 'blocked';

export interface ManagedWikiRelations {
	parent?: string | null;
	sources?: readonly string[];
	related?: readonly string[];
}

export interface ParsedManagedRelationsBlock {
	status: 'missing' | 'valid' | 'invalid';
	content: string;
	payload: string;
	hash: string;
	start: number;
	end: number;
}

export interface WikiRiskInput {
	targetExists: boolean;
	writebackEffect: 'append' | 'create_wiki_note' | 'update_managed_relations';
	targetPathAllowed: boolean;
	relationsStatus?: ParsedManagedRelationsBlock['status'];
	hasUnresolvedRelations?: boolean;
	hasTargetConflict?: boolean;
}

export interface WikiBatchCandidate {
	proposalPath: string;
	proposalId: string;
	taskId?: string | null;
	createdAt?: string | null;
	writebackBytes: number;
	effectiveRisk: WikiEffectiveRisk;
}

export interface WikiReviewBatch {
	reviewBatchId: string;
	segment: number;
	items: WikiBatchCandidate[];
	totalBytes: number;
}

const START_PATTERN = /<!--\s*tracekeeper:relations:start\s+schema="1"\s+hash="(sha256:[a-f0-9]{64})"\s*-->/g;
const END_PATTERN = /<!--\s*tracekeeper:relations:end\s*-->/g;

const FORBIDDEN_RELATION_PATH_PATTERN = /[\u0000-\u001f\u007f\[\]|#^]/;

/**
 * 将关系目标收敛为一个不可注入 Markdown 的 Vault 相对笔记路径。
 */
export function normalizeManagedRelationPath(value: string): string {
	const normalized = normalizeKnowledgePath(value);
	if (
		!normalized
		|| !normalized.endsWith('.md')
		|| FORBIDDEN_RELATION_PATH_PATTERN.test(normalized)
		|| normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
	) throw new Error('Managed relation path must be one canonical Vault-relative Markdown path.');
	return normalized;
}

const normalizedUniquePaths = (values: readonly string[], predicate: (path: string) => boolean): string[] => {
	const normalized = values.map(normalizeManagedRelationPath);
	if (normalized.some((path) => !predicate(path))) {
		throw new Error('Managed relation path is outside its governed knowledge area.');
	}
	return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
};

const wikiLink = (path: string): string => `[[${normalizeKnowledgePath(path).replace(/\.md$/i, '')}]]`;
const managedPayloadHash = (payload: string): string =>
	`sha256:${crypto.createHash('sha256').update(payload, 'utf8').digest('hex')}`;

/**
 * 渲染由 Tracekeeper 独占维护的关系区块。
 *
 * @description 区块使用稳定排序、完整 Vault 相对 wikilink 与内容哈希，便于后续只替换该边界内的关系。
 */
export function renderManagedRelationsBlock(relations: ManagedWikiRelations): string {
	const parent = relations.parent ? normalizeManagedRelationPath(relations.parent) : '';
	if (parent && !isKnowledgeWikiPath(parent)) {
		throw new Error('Managed Wiki parent must be a Wiki path.');
	}
	const sources = normalizedUniquePaths(relations.sources ?? [], (path) =>
		isKnowledgeSourcePath(path) && !isSourcePartPath(path)
	);
	const related = normalizedUniquePaths(relations.related ?? [], isKnowledgeWikiPath);
	const lines = ['## Relations'];
	if (parent) lines.push(`- parent: ${wikiLink(parent)}`);
	for (const source of sources) lines.push(`- source: ${wikiLink(source)}`);
	for (const path of related) lines.push(`- related: ${wikiLink(path)}`);
	const payload = lines.join('\n');
	const hash = managedPayloadHash(payload);
	return [
		`<!-- tracekeeper:relations:start schema="${MANAGED_RELATIONS_SCHEMA_VERSION}" hash="${hash}" -->`,
		payload,
		'<!-- tracekeeper:relations:end -->',
	].join('\n');
}

/**
 * 校验并定位现有托管关系区块。
 */
export function parseManagedRelationsBlock(content: string): ParsedManagedRelationsBlock {
	const normalized = content.replace(/\r\n?/g, '\n');
	const starts = [...normalized.matchAll(START_PATTERN)];
	const ends = [...normalized.matchAll(END_PATTERN)];
	if (starts.length === 0 && ends.length === 0) {
		return { status: 'missing', content: normalized, payload: '', hash: '', start: -1, end: -1 };
	}
	if (starts.length !== 1 || ends.length !== 1) {
		return { status: 'invalid', content: normalized, payload: '', hash: '', start: -1, end: -1 };
	}
	const startMatch = starts[0];
	const endMatch = ends[0];
	const start = startMatch.index ?? -1;
	const payloadStart = start + startMatch[0].length;
	const endStart = endMatch.index ?? -1;
	if (start < 0 || endStart <= payloadStart) {
		return { status: 'invalid', content: normalized, payload: '', hash: '', start: -1, end: -1 };
	}
	const payload = normalized.slice(payloadStart, endStart).replace(/^\n/, '').replace(/\n$/, '');
	const hash = startMatch[1] || '';
	const end = endStart + endMatch[0].length;
	return {
		status: managedPayloadHash(payload) === hash ? 'valid' : 'invalid',
		content: normalized,
		payload,
		hash,
		start,
		end,
	};
}

/**
 * 在不触碰边界外正文的前提下插入或替换托管关系区块。
 */
export function upsertManagedRelationsBlock(content: string, relations: ManagedWikiRelations): string {
	const parsed = parseManagedRelationsBlock(content);
	if (parsed.status === 'invalid') {
		throw new Error('Managed relations block is invalid or was edited outside Tracekeeper.');
	}
	const block = renderManagedRelationsBlock(relations);
	if (parsed.status === 'missing') {
		const base = parsed.content.replace(/\s+$/g, '');
		return base ? `${base}\n\n${block}\n` : `${block}\n`;
	}
	return `${parsed.content.slice(0, parsed.start)}${block}${parsed.content.slice(parsed.end)}`;
}

export function applyManagedRelationsBlock(content: string, proposedBlock: string): string {
	const proposed = parseManagedRelationsBlock(proposedBlock.trim());
	if (
		proposed.status !== 'valid'
		|| proposed.start !== 0
		|| proposed.end !== proposed.content.length
	) throw new Error('Proposed managed relations writeback must contain exactly one valid relations block.');
	const current = parseManagedRelationsBlock(content);
	if (current.status === 'invalid') {
		throw new Error('Managed relations block is invalid or was edited outside Tracekeeper.');
	}
	if (current.status === 'missing') {
		const base = current.content.replace(/\s+$/g, '');
		return base ? `${base}\n\n${proposed.content}\n` : `${proposed.content}\n`;
	}
	return `${current.content.slice(0, current.start)}${proposed.content}${current.content.slice(current.end)}`;
}

export function computeWikiEffectiveRisk(input: WikiRiskInput): WikiEffectiveRisk {
	if (!input.targetPathAllowed || input.hasUnresolvedRelations || input.hasTargetConflict) return 'blocked';
	if (input.writebackEffect === 'create_wiki_note') return input.targetExists ? 'blocked' : 'low';
	if (input.writebackEffect === 'update_managed_relations') {
		if (!input.targetExists || input.relationsStatus === 'invalid') return 'blocked';
		return input.relationsStatus === 'valid' ? 'low' : 'medium';
	}
	return input.targetExists ? 'high' : 'blocked';
}

export function buildWikiReviewBatchId(taskId: string | null | undefined, proposalId: string): string {
	const normalizedTaskId = (taskId || '').trim();
	return normalizedTaskId ? `task:${normalizedTaskId}` : `proposal:${proposalId.trim()}`;
}

/**
 * 将 Wiki 提案按受信批次身份和固定容量稳定切分。
 */
export function buildWikiReviewBatches(candidates: readonly WikiBatchCandidate[]): WikiReviewBatch[] {
	const grouped = new Map<string, WikiBatchCandidate[]>();
	for (const candidate of candidates) {
		if (!Number.isSafeInteger(candidate.writebackBytes) || candidate.writebackBytes < 0) {
			throw new Error('Wiki batch candidate byte size is invalid.');
		}
		const id = buildWikiReviewBatchId(candidate.taskId, candidate.proposalId);
		const bucket = grouped.get(id) ?? [];
		bucket.push({ ...candidate, proposalPath: normalizeKnowledgePath(candidate.proposalPath) });
		grouped.set(id, bucket);
	}
	const batches: WikiReviewBatch[] = [];
	for (const [reviewBatchId, items] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
		const sorted = items.sort((left, right) =>
			(left.createdAt || '').localeCompare(right.createdAt || '')
			|| left.proposalPath.localeCompare(right.proposalPath)
		);
		let segment = 1;
		let current: WikiBatchCandidate[] = [];
		let totalBytes = 0;
		const flush = (): void => {
			if (current.length === 0) return;
			batches.push({ reviewBatchId, segment, items: current, totalBytes });
			segment += 1;
			current = [];
			totalBytes = 0;
		};
		for (const item of sorted) {
			if (item.writebackBytes > WIKI_REVIEW_BATCH_MAX_BYTES) {
				throw new Error(`Wiki proposal exceeds the ${WIKI_REVIEW_BATCH_MAX_BYTES}-byte batch limit.`);
			}
			if (
				current.length >= WIKI_REVIEW_BATCH_MAX_ITEMS
				|| totalBytes + item.writebackBytes > WIKI_REVIEW_BATCH_MAX_BYTES
			) flush();
			current.push(item);
			totalBytes += item.writebackBytes;
		}
		flush();
	}
	return batches;
}

export function isSourcePartPath(path: string): boolean {
	const normalized = normalizeKnowledgePath(path);
	return startsWithPathPrefix(normalized, KNOWLEDGE_SOURCES_DIR)
		&& normalized.split('/').some((segment) => segment === 'parts' || segment.endsWith('.parts'));
}

export function sourceIndexPathForPart(path: string): string | null {
	const normalized = normalizeKnowledgePath(path);
	if (!isSourcePartPath(normalized)) return null;
	const segments = normalized.split('/');
	const partDirectory = segments.findIndex((segment) => segment.endsWith('.parts'));
	if (partDirectory < 0) return null;
	const stem = segments[partDirectory].replace(/\.parts$/, '');
	return [...segments.slice(0, partDirectory), `${stem}.md`].join('/');
}

export function isWikiPath(path: string): boolean {
	return startsWithPathPrefix(normalizeKnowledgePath(path), KNOWLEDGE_WIKI_DIR);
}
