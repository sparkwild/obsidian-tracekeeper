import { App, TFile, TFolder } from 'obsidian';
import {
	ARCHIVE_REVIEW_QUEUE_DIR,
	KNOWLEDGE_SOURCES_DIR,
	TRACEKEEPER_AGENT_REQUESTS_DIR,
	TRACEKEEPER_CONTEXT_PACKS_DIR,
	TRACEKEEPER_SESSIONS_DIR,
	TRACEKEEPER_TASKS_DIR,
	hashVaultContent,
	planProposalReferenceBackfill,
	proposalHistoryLocation,
	resolveProposalHistoryById,
	type ProposalHistoryRecord,
} from '@tracekeeper/core';
import { compareProposalRecords, parseMemoryProposalRecord, type MemoryProposalRecord } from '../review/review-view-model';
import { REVIEW_QUEUE_PATH } from '../review/review-queue-model';
import {
	AGENT_TASKS_PATH,
	type ActivityTimelineRecordWindow,
	type AgentTaskRecord,
	type ContextPackRecord,
	type SourceCaptureRecord,
	type SourceRequestRecord,
} from './activity-model';
import {
	firstString,
	parseTimestamp,
	readFrontmatter,
	readStringList,
	snippetFromText,
} from '../shared/markdown-record-parser';

const SOURCE_REQUESTS_PATH = TRACEKEEPER_AGENT_REQUESTS_DIR;
const CONTEXT_PACKS_PATH = TRACEKEEPER_CONTEXT_PACKS_DIR;
const SOURCES_PATH = KNOWLEDGE_SOURCES_DIR;

interface MemoryProposalFileSnapshot {
	record: MemoryProposalRecord;
	explicitProposalId: string;
}

interface RecentMarkdownSelection {
	timestampKeys: readonly string[];
	accepts?: (frontmatter: Readonly<Record<string, unknown>>) => boolean;
}

export type MemoryProposalHistoryResolution =
	| {
		status: 'resolved';
		proposalId: string;
		record: MemoryProposalRecord;
		matches: MemoryProposalRecord[];
	}
	| {
		status: 'missing';
		proposalId: string;
		matches: [];
	}
	| {
		status: 'ambiguous';
		proposalId: string;
		matches: MemoryProposalRecord[];
	};

export type ManagedProposalReferenceBackfillResult =
	| {
		status: 'updated' | 'unchanged';
		recordPath: string;
		proposalIds: string[];
		proposalPaths: string[];
	}
	| {
		status: 'missing' | 'ambiguous' | 'stale' | 'unmanaged';
		recordPath: string;
		unresolvedPaths: string[];
	};

const isManagedProposalReferencePath = (recordPath: string): boolean =>
	[
		TRACEKEEPER_TASKS_DIR,
		TRACEKEEPER_SESSIONS_DIR,
	].some((root) => recordPath.startsWith(`${root}/`));

const replaceManagedProposalReferenceFields = (
	content: string,
	proposalIds: readonly string[],
	proposalPaths: readonly string[]
): string | null => {
	const normalized = content.replace(/\r\n?/g, '\n');
	const lines = normalized.split('\n');
	if (lines[0]?.trim() !== '---') {
		return null;
	}
	const closingIndex = lines.findIndex(
		(line, index) =>
			index > 0 && (line.trim() === '---' || line.trim() === '...')
	);
	if (closingIndex < 0) {
		return null;
	}
	const removedKeys = new Set(['proposal_ids', 'proposal_paths', 'proposals']);
	const preserved: string[] = [];
	for (let index = 1; index < closingIndex; index += 1) {
		const line = lines[index];
		const key = line.match(/^([A-Za-z0-9_-]+)\s*:/)?.[1];
		if (!key || !removedKeys.has(key)) {
			preserved.push(line);
			continue;
		}
		while (
			index + 1 < closingIndex
			&& /^\s+-\s+/.test(lines[index + 1])
		) {
			index += 1;
		}
	}
	const next = [
		'---',
		...preserved,
		`proposal_ids: ${JSON.stringify(proposalIds)}`,
		`proposal_paths: ${JSON.stringify(proposalPaths)}`,
		lines[closingIndex],
		...lines.slice(closingIndex + 1),
	].join('\n');
	return normalized.endsWith('\n') && !next.endsWith('\n') ? `${next}\n` : next;
};

export class ActivityRecordRepository {
	constructor(private readonly app: App) {}

	async readRecentSourceRequests(limit: number): Promise<SourceRequestRecord[]> {
		return this.readSourceRequests(limit);
	}

	private async readRecentSourceRequestsForTimeline(
		limit: number
	): Promise<SourceRequestRecord[]> {
		return this.readSourceRequests(limit, {
			timestampKeys: ['created'],
			accepts: (frontmatter) => {
				const type = this.cachedFirstString(frontmatter, ['type']);
				return type.toLowerCase().includes('agent-request')
					&& Boolean(this.cachedFirstString(frontmatter, ['source']));
			},
		});
	}

	private async readSourceRequests(
		limit: number,
		selection?: RecentMarkdownSelection
	): Promise<SourceRequestRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(SOURCE_REQUESTS_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectRecentMarkdownFiles(folder, limit, selection);
		const records = await Promise.all(files.map((file) => this.readSourceRequestFile(file)));
		return records
			.filter((record): record is SourceRequestRecord => Boolean(record))
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, limit);
	}

	async readSourceRequestFile(file: TFile): Promise<SourceRequestRecord | null> {
		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
	} catch (error) {
			console.error(`tracekeeper failed to read source request: ${file.path}`, error);
			content = '';
		}

		const parsed = readFrontmatter(content);
		const data = parsed.fields;
		const type = firstString(data, ['type']);
		if (!type.toLowerCase().includes('agent-request')) {
			return null;
		}

		const source = firstString(data, ['source']);
		const status = firstString(data, ['status']);
		if (!source) {
			return null;
		}

		const created = firstString(data, ['created']);
		const sortTimestamp = parseTimestamp(created, file.stat?.mtime);

		return {
			path: file.path,
			type,
			source,
			sourceKind: firstString(data, ['source_kind', 'sourceKind']) || 'unknown',
			purpose: firstString(data, ['purpose']) || '',
			relatedProject: firstString(data, ['related_project', 'relatedProject']) || '',
			analysisMode: firstString(data, ['analysis_mode', 'analysisMode']) || 'default',
			status: status || 'pending',
			taskId: firstString(data, ['task_id', 'taskId']),
			created,
			summary: snippetFromText(parsed.body, source),
			sortTimestamp,
		};
	}

	async readRecentAgentTasks(limit: number): Promise<AgentTaskRecord[]> {
		return this.readAgentTasks(limit);
	}

	private async readRecentAgentTasksForTimeline(
		limit: number
	): Promise<AgentTaskRecord[]> {
		return this.readAgentTasks(limit, {
			timestampKeys: ['started_at', 'startedAt', 'finished_at', 'finishedAt'],
		});
	}

	private async readAgentTasks(
		limit: number,
		selection?: RecentMarkdownSelection
	): Promise<AgentTaskRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(AGENT_TASKS_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectRecentMarkdownFiles(folder, limit, selection);
		const records = await Promise.all(
			files.map((file) => this.readAgentTaskFile(file))
		);
		return records
			.filter((record): record is AgentTaskRecord => Boolean(record))
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, limit);
	}

	async readRecentContextPacks(limit: number): Promise<ContextPackRecord[]> {
		return this.readContextPacks(limit);
	}

	private async readRecentContextPacksForTimeline(
		limit: number
	): Promise<ContextPackRecord[]> {
		return this.readContextPacks(limit, {
			timestampKeys: ['created_at', 'createdAt', 'created'],
		});
	}

	private async readContextPacks(
		limit: number,
		selection?: RecentMarkdownSelection
	): Promise<ContextPackRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(CONTEXT_PACKS_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectRecentMarkdownFiles(folder, limit, selection);
		const records = await Promise.all(files.map((file) => this.readContextPackFile(file)));
		return records
			.filter((record): record is ContextPackRecord => Boolean(record))
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, limit);
	}

	async readContextPackFile(file: TFile): Promise<ContextPackRecord | null> {
		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`tracekeeper failed to read context pack: ${file.path}`, error);
			return null;
		}

		const parsed = readFrontmatter(content);
		const data = parsed.fields;
		const createdAt = firstString(data, ['created_at', 'createdAt', 'created']);
		const title = firstString(data, ['title']) || file.basename;

		return {
			path: file.path,
			title,
			taskId: firstString(data, ['task_id', 'taskId']),
			createdAt,
			snippet: snippetFromText(parsed.body, title),
			sortTimestamp: parseTimestamp(createdAt, file.stat?.mtime),
		};
	}

	async readRecentSourceCaptures(limit: number): Promise<SourceCaptureRecord[]> {
		return this.readSourceCaptures(limit);
	}

	private async readRecentSourceCapturesForTimeline(
		limit: number
	): Promise<SourceCaptureRecord[]> {
		return this.readSourceCaptures(limit, {
			timestampKeys: ['created_at', 'createdAt', 'created'],
			accepts: (frontmatter) => {
				const type = this.cachedFirstString(frontmatter, ['type']);
				const source = this.cachedFirstString(frontmatter, ['source']);
				return Boolean(source) || type.toLowerCase().includes('source');
			},
		});
	}

	private async readSourceCaptures(
		limit: number,
		selection?: RecentMarkdownSelection
	): Promise<SourceCaptureRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(SOURCES_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectRecentMarkdownFiles(folder, limit, selection);
		const records = await Promise.all(files.map((file) => this.readSourceCaptureFile(file)));
		return records
			.filter((record): record is SourceCaptureRecord => Boolean(record))
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, limit);
	}

	async readSourceCaptureFile(file: TFile): Promise<SourceCaptureRecord | null> {
		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`tracekeeper failed to read source capture: ${file.path}`, error);
			return null;
		}

		const parsed = readFrontmatter(content);
		const data = parsed.fields;
		if (Object.keys(data).length === 0) {
			return null;
		}

		const type = firstString(data, ['type']);
		const source = firstString(data, ['source']);
		if (!source && !type.toLowerCase().includes('source')) {
			return null;
		}
		const createdAt = firstString(data, ['created_at', 'createdAt', 'created']);
		const sourceLabel = source || file.basename;
		const title = firstString(data, ['title']) || sourceLabel;

		return {
			path: file.path,
			type: type || 'source_capture',
			title,
			source: sourceLabel,
			sourceKind: firstString(data, ['source_kind', 'sourceKind']),
			mode: firstString(data, ['mode']) || '',
			taskId: firstString(data, ['task_id', 'taskId']),
			createdAt,
			snippet: snippetFromText(parsed.body, sourceLabel),
			sortTimestamp: parseTimestamp(createdAt, file.stat?.mtime),
		};
	}

	async readRecentMemoryProposals(limit: number): Promise<MemoryProposalRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(REVIEW_QUEUE_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectRecentMarkdownFiles(folder, limit);
		const records = await Promise.all(files.map((file) => this.readMemoryProposalFile(file)));
		return records
			.filter((record): record is MemoryProposalRecord => Boolean(record))
			.sort((a, b) => compareProposalRecords(a, b))
			.slice(0, limit);
	}

	private async readRecentMemoryProposalsForTimeline(
		limit: number
	): Promise<MemoryProposalRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(REVIEW_QUEUE_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectRecentMarkdownFiles(folder, limit, {
			timestampKeys: ['created'],
			accepts: (frontmatter) => {
				const type = this.cachedFirstString(frontmatter, ['type'])
					.toLowerCase()
					.replace(/_/g, '-');
				return type.includes('memory-proposal')
					|| type.includes('legacy-migration-review')
					|| Boolean(this.cachedFirstString(frontmatter, ['proposal_kind', 'proposalKind']));
			},
		});
		const records = await Promise.all(files.map((file) => this.readMemoryProposalFile(file)));
		return records
			.filter((record): record is MemoryProposalRecord => Boolean(record))
			.sort((left, right) =>
				right.sortTimestamp - left.sortTimestamp
				|| left.path.localeCompare(right.path)
			)
			.slice(0, limit);
	}

	async readActivityTimelineRecords(limit: number): Promise<ActivityTimelineRecordWindow> {
		const [
			tasks,
			contextPacks,
			sourceCaptures,
			sourceRequests,
			proposals,
		] = await Promise.all([
			this.readRecentAgentTasksForTimeline(limit),
			this.readRecentContextPacksForTimeline(limit),
			this.readRecentSourceCapturesForTimeline(limit),
			this.readRecentSourceRequestsForTimeline(limit),
			this.readRecentMemoryProposalsForTimeline(limit),
		]);
		const representedCounts = [
			[AGENT_TASKS_PATH, tasks.length],
			[CONTEXT_PACKS_PATH, contextPacks.length],
			[SOURCES_PATH, sourceCaptures.length],
			[SOURCE_REQUESTS_PATH, sourceRequests.length],
			[REVIEW_QUEUE_PATH, proposals.length],
		] as const;
		const isTruncated = representedCounts.some(([folderPath, represented]) =>
			this.countMarkdownFiles(folderPath) > represented
		);
		return {
			tasks,
			contextPacks,
			sourceCaptures,
			sourceRequests,
			proposals,
			isTruncated,
		};
	}

async readRecentProposalHistory(limit: number): Promise<MemoryProposalRecord[]> {
	const snapshots = await this.readProposalHistorySnapshots();
	const records = snapshots
		.map((snapshot) => snapshot.record)
		.sort((left, right) => compareProposalRecords(left, right)
			|| left.path.localeCompare(right.path));
	if (!Number.isFinite(limit) || limit >= records.length) {
		return records;
	}
	return records.slice(0, Math.max(0, Math.floor(limit)));
}

async readProposalHistoryById(proposalId: string): Promise<MemoryProposalHistoryResolution> {
		const snapshots = await this.readProposalHistorySnapshots();
		const recordsByPath = new Map(
			snapshots.map((snapshot) => [snapshot.record.path, snapshot.record])
		);
		const historyRecords = snapshots
			.filter((snapshot) => Boolean(snapshot.explicitProposalId))
			.flatMap((snapshot): ProposalHistoryRecord[] => {
				const location = proposalHistoryLocation(snapshot.record.path);
				if (!location) {
					return [];
				}
				return [{
					path: snapshot.record.path,
					proposalId: snapshot.explicitProposalId,
					location,
					contentHash: snapshot.record.fileContentHash,
				}];
			});
		const resolution = resolveProposalHistoryById(historyRecords, proposalId);
		if (resolution.status === 'missing') {
			return resolution;
		}
		const matches = resolution.matches
			.map((match) => recordsByPath.get(match.path))
			.filter((record): record is MemoryProposalRecord => Boolean(record));
		if (resolution.status === 'ambiguous') {
			return {
				status: 'ambiguous',
				proposalId: resolution.proposalId,
				matches,
			};
		}
		const record = recordsByPath.get(resolution.record.path);
		if (!record) {
			return {
				status: 'missing',
				proposalId: resolution.proposalId,
				matches: [],
			};
		}
		return {
			status: 'resolved',
			proposalId: resolution.proposalId,
			record,
			matches,
		};
	}

async backfillManagedProposalReferences(
	recordPath: string,
	expectedContentHash: string
): Promise<ManagedProposalReferenceBackfillResult> {
		if (!isManagedProposalReferencePath(recordPath)) {
			return {
				status: 'unmanaged',
				recordPath,
				unresolvedPaths: [],
			};
		}
		const file = this.app.vault.getAbstractFileByPath(recordPath);
		if (!(file instanceof TFile)) {
			return {
				status: 'missing',
				recordPath,
				unresolvedPaths: [recordPath],
			};
		}
		const content = await this.app.vault.cachedRead(file);
		if (!expectedContentHash || hashVaultContent(content) !== expectedContentHash) {
			return {
				status: 'stale',
				recordPath,
				unresolvedPaths: [recordPath],
			};
		}
		const parsed = readFrontmatter(content);
		const normalizedType = firstString(parsed.fields, ['type'])
			.toLowerCase()
			.replace(/_/g, '-');
		if (normalizedType !== 'agent-task' && normalizedType !== 'session-note') {
			return {
				status: 'unmanaged',
				recordPath,
				unresolvedPaths: [],
			};
		}
		const legacyPaths = readStringList(parsed.fields, ['proposals']);
		const existingProposalIds = readStringList(parsed.fields, ['proposal_ids']);
		const existingProposalPaths = readStringList(parsed.fields, ['proposal_paths']);
		if (legacyPaths.length === 0) {
			return existingProposalIds.length > 0
				? {
					status: 'unchanged',
					recordPath,
					proposalIds: existingProposalIds,
					proposalPaths: existingProposalPaths,
				}
				: {
					status: 'missing',
					recordPath,
					unresolvedPaths: [],
				};
		}

		const snapshots = await this.readProposalHistorySnapshots();
		const snapshotsByPath = new Map(
			snapshots.map((snapshot) => [snapshot.record.path, snapshot])
		);
		const historyRecords = snapshots.flatMap((snapshot): ProposalHistoryRecord[] => {
			const location = proposalHistoryLocation(snapshot.record.path);
			if (!location || !snapshot.explicitProposalId) {
				return [];
			}
			return [{
				path: snapshot.record.path,
				proposalId: snapshot.explicitProposalId,
				location,
				contentHash: snapshot.record.fileContentHash,
			}];
		});
		const resolvedIds: string[] = [];
		for (const legacyPath of legacyPaths) {
			const plan = planProposalReferenceBackfill({
				referencePath: legacyPath,
				proposals: historyRecords,
				expectedReferenceHash: expectedContentHash,
				currentReferenceHash: hashVaultContent(content),
				managedRecord: true,
			});
			if (plan.status !== 'ready') {
				return {
					status: plan.status,
					recordPath,
					unresolvedPaths: [legacyPath],
				};
			}
			const idResolution = resolveProposalHistoryById(
				historyRecords,
				plan.proposalId
			);
			if (
				idResolution.status !== 'resolved'
				|| idResolution.record.path !== plan.proposalPath
			) {
				return {
					status: idResolution.status === 'missing' ? 'missing' : 'ambiguous',
					recordPath,
					unresolvedPaths: [legacyPath],
				};
			}
			const snapshot = snapshotsByPath.get(plan.proposalPath);
			const proposalFile = this.app.vault.getAbstractFileByPath(plan.proposalPath);
			if (!(proposalFile instanceof TFile) || !snapshot) {
				return {
					status: 'missing',
					recordPath,
					unresolvedPaths: [legacyPath],
				};
			}
			const currentProposalContent = await this.app.vault.read(proposalFile);
			if (hashVaultContent(currentProposalContent) !== snapshot.record.fileContentHash) {
				return {
					status: 'stale',
					recordPath,
					unresolvedPaths: [legacyPath],
				};
			}
			resolvedIds.push(plan.proposalId);
		}

		const proposalIds = [...new Set([...existingProposalIds, ...resolvedIds])];
		const proposalPaths = [...new Set([...existingProposalPaths, ...legacyPaths])];
		let outcome: ManagedProposalReferenceBackfillResult = {
			status: 'stale',
			recordPath,
			unresolvedPaths: [recordPath],
		};
		await this.app.vault.process(file, (current) => {
			if (hashVaultContent(current) !== expectedContentHash) {
				return current;
			}
			const next = replaceManagedProposalReferenceFields(
				current,
				proposalIds,
				proposalPaths
			);
			if (next === null) {
				outcome = {
					status: 'unmanaged',
					recordPath,
					unresolvedPaths: [],
				};
				return current;
			}
			outcome = {
				status: next === current ? 'unchanged' : 'updated',
				recordPath,
				proposalIds,
				proposalPaths,
			};
			return next;
		});
		return outcome;
	}

async readMemoryProposalFile(file: TFile): Promise<MemoryProposalRecord | null> {
		return (await this.readMemoryProposalFileSnapshot(file))?.record ?? null;
	}

private async readProposalHistorySnapshots(): Promise<MemoryProposalFileSnapshot[]> {
		const folders = [REVIEW_QUEUE_PATH, ARCHIVE_REVIEW_QUEUE_DIR]
			.map((folderPath) => this.app.vault.getAbstractFileByPath(folderPath))
			.filter((folder): folder is TFolder => folder instanceof TFolder);
		const files = folders.flatMap((folder) => this.collectMarkdownFiles(folder));
		const snapshots = await Promise.all(
			files.map((file) => this.readMemoryProposalFileSnapshot(file))
		);
		return snapshots
			.filter((snapshot): snapshot is MemoryProposalFileSnapshot => Boolean(snapshot))
			.sort((left, right) => left.record.path.localeCompare(right.record.path));
	}

private async readMemoryProposalFileSnapshot(
		file: TFile
	): Promise<MemoryProposalFileSnapshot | null> {
		let content = '';
		try {
			content = await this.app.vault.read(file);
		} catch (error) {
			console.error(`tracekeeper failed to read memory proposal: ${file.path}`, error);
			content = '';
		}

		const parsed = readFrontmatter(content);
		const record = parseMemoryProposalRecord({
			filePath: file.path,
			fields: parsed.fields,
			body: parsed.body,
			fileMtime: file.stat?.mtime,
			fileContentHash: hashVaultContent(content),
		});
		if (!record) {
			return null;
		}
		return {
			record,
			explicitProposalId: firstString(parsed.fields, ['proposal_id', 'proposalId']).trim(),
		};
	}

collectMarkdownFiles(folder: TFolder): TFile[] {
		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === 'md') {
				files.push(child);
			} else if (child instanceof TFolder) {
				files.push(...this.collectMarkdownFiles(child));
			}
		}
		return files;
	}

private countMarkdownFiles(folderPath: string): number {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		return folder instanceof TFolder ? this.collectMarkdownFiles(folder).length : 0;
	}

private cachedFirstString(
		frontmatter: Readonly<Record<string, unknown>>,
		keys: readonly string[]
	): string {
		for (const key of keys) {
			const value = frontmatter[key];
			if (typeof value === 'string' && value.trim()) {
				return value.trim();
			}
			if (typeof value === 'number' || typeof value === 'boolean') {
				return String(value);
			}
			if (Array.isArray(value)) {
				const first = value.find((entry) =>
					typeof entry === 'string' && entry.trim()
				);
				if (typeof first === 'string') {
					return first.trim();
				}
			}
		}
		return '';
	}

private cachedFrontmatter(file: TFile): Readonly<Record<string, unknown>> | null {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter)
			? frontmatter
			: null;
	}

collectRecentMarkdownFiles(
		folder: TFolder,
		limit: number,
		selection?: RecentMarkdownSelection
	): TFile[] {
		const files = this.collectMarkdownFiles(folder)
			.map((file) => {
				const frontmatter = selection ? this.cachedFrontmatter(file) : null;
				return {
					file,
					frontmatter,
					sortTimestamp: selection
						? parseTimestamp(
							frontmatter
								? this.cachedFirstString(frontmatter, selection.timestampKeys)
								: '',
							file.stat?.mtime
						)
						: file.stat?.mtime || 0,
				};
			})
			.filter(({ frontmatter }) =>
				!selection?.accepts
				|| frontmatter === null
				|| selection.accepts(frontmatter)
			)
			.sort((left, right) =>
				right.sortTimestamp - left.sortTimestamp
				|| left.file.path.localeCompare(right.file.path)
			)
			.map(({ file }) => file);
		if (!Number.isFinite(limit) || limit >= files.length) {
			return files;
		}
		return files.slice(0, Math.max(0, Math.floor(limit)));
	}

async readAgentTaskFile(file: TFile): Promise<AgentTaskRecord> {
		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`tracekeeper failed to read agent task: ${file.path}`, error);
			content = '';
		}
		const parsed = readFrontmatter(content);
		const data = parsed.fields;
		const objective = firstString(data, ['objective']);
		const path = file.path;

		const startedAt = firstString(data, ['started_at', 'startedAt']);
		const finishedAt = firstString(data, ['finished_at', 'finishedAt']);
		const sortTimestamp = parseTimestamp(
			startedAt || finishedAt,
			file.stat?.mtime
		);
		const proposalIds = readStringList(data, ['proposal_ids', 'proposalIds']);
		const proposalPaths = readStringList(data, ['proposal_paths', 'proposalPaths']);
		const legacyProposalPaths = readStringList(data, ['proposals']);

		return {
			path,
			type: firstString(data, ['type']) || 'agent-task',
			taskId: firstString(data, ['task_id', 'taskId']) || file.basename,
			agent: firstString(data, ['agent']) || 'unknown',
			objective: objective || snippetFromText(parsed.body, file.basename),
			status: firstString(data, ['status']) || 'unknown',
			startedAt,
			finishedAt,
			contextPack: firstString(data, ['context_pack', 'contextPack']),
			sessionNote: firstString(data, ['session_note', 'sessionNote']),
			relatedProject: firstString(data, ['related_project', 'relatedProject']),
			memoryReads: readStringList(data, ['memory_reads', 'memoryReads']),
			memoryWrites: readStringList(data, ['memory_writes', 'memoryWrites']),
			sourceCaptures: readStringList(data, ['source_captures', 'sourceCaptures']),
			proposalIds,
			proposalPaths,
			proposals: proposalPaths.length > 0 ? proposalPaths : legacyProposalPaths,
			memoryCandidates: readStringList(data, ['memory_candidates', 'memoryCandidates']),
			snippet: snippetFromText(parsed.body, objective || file.basename),
			sortTimestamp,
		};
	}
}
