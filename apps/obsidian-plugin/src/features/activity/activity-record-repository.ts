import { App, TFile, TFolder } from 'obsidian';
import {
	KNOWLEDGE_SOURCES_DIR,
	TRACEKEEPER_AGENT_REQUESTS_DIR,
	TRACEKEEPER_CONTEXT_PACKS_DIR,
} from '@tracekeeper/core';
import { compareProposalRecords, parseMemoryProposalRecord, type MemoryProposalRecord } from '../review/review-view-model';
import { REVIEW_QUEUE_PATH } from '../review/review-queue-model';
import {
	AGENT_TASKS_PATH,
	MAX_SOURCE_STATUS_ROWS,
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

export interface SourceAnalysisSnapshot {
	requests: SourceRequestRecord[];
	missingRequestFolder: boolean;
	updatedAt: string;
}

export class ActivityRecordRepository {
	constructor(private readonly app: App) {}

async loadSourceStatusSnapshot(): Promise<SourceAnalysisSnapshot> {
		const folder = this.app.vault.getAbstractFileByPath(SOURCE_REQUESTS_PATH);
		if (!(folder instanceof TFolder)) {
			return {
				requests: [],
				missingRequestFolder: true,
				updatedAt: new Date().toISOString(),
			};
		}

		return {
			requests: await this.readRecentSourceRequests(MAX_SOURCE_STATUS_ROWS),
			missingRequestFolder: false,
			updatedAt: new Date().toISOString(),
		};
	}

async readRecentSourceRequests(limit: number): Promise<SourceRequestRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(SOURCE_REQUESTS_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectMarkdownFiles(folder);
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
		const folder = this.app.vault.getAbstractFileByPath(AGENT_TASKS_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectMarkdownFiles(folder);
		const records = await Promise.all(
			files.map((file) => this.readAgentTaskFile(file))
		);
		return records
			.filter((record): record is AgentTaskRecord => Boolean(record))
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, limit);
	}

async readRecentContextPacks(limit: number): Promise<ContextPackRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(CONTEXT_PACKS_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectMarkdownFiles(folder);
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
		const folder = this.app.vault.getAbstractFileByPath(SOURCES_PATH);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectMarkdownFiles(folder);
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

		const files = this.collectMarkdownFiles(folder);
		const records = await Promise.all(files.map((file) => this.readMemoryProposalFile(file)));
		return records
			.filter((record): record is MemoryProposalRecord => Boolean(record))
			.sort((a, b) => compareProposalRecords(a, b))
			.slice(0, limit);
	}

async readMemoryProposalFile(file: TFile): Promise<MemoryProposalRecord | null> {
		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`tracekeeper failed to read memory proposal: ${file.path}`, error);
			content = '';
		}

		const parsed = readFrontmatter(content);
		return parseMemoryProposalRecord({
			filePath: file.path,
			fields: parsed.fields,
			body: parsed.body,
			fileMtime: file.stat?.mtime,
		});
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
			proposals: readStringList(data, ['proposals']),
			memoryCandidates: readStringList(data, ['memory_candidates', 'memoryCandidates']),
			snippet: snippetFromText(parsed.body, objective || file.basename),
			sortTimestamp,
		};
	}
}
