import { App, TFile, TFolder } from 'obsidian';
import { TRACEKEEPER_AUDIT_DIR, TRACEKEEPER_AUDIT_LOG_PATH } from '@tracekeeper/core';
import type { MemoryProposalRecord } from '../review/review-view-model';
import { memoryProposalStatusLabel } from '../review/review-queue-model';
import {
	RUNTIME_LOG_FILTERS,
	RUNTIME_LOG_PAGE_SIZE,
	type RuntimeLogCategory,
	type RuntimeLogCleanupResult,
	type RuntimeLogCleanupScope,
	type RuntimeLogFilter,
	type RuntimeLogItem,
	type RuntimeLogSnapshot,
} from '../runtime/runtime-log-model';
import type { RuntimeViewStatus } from '../../main';
import type { TracekeeperStructureStatus } from '../structure/legacy-migration-controller';
import {
	ACTIVITY_TIMELINE_PAGE_SIZE,
	ACTIVITY_TIMELINE_PREVIEW_ROWS,
	AGENT_TASKS_PATH,
	MAX_ACTIVITY_CONTEXT_PACK_ROWS,
	MAX_ACTIVITY_PROPOSAL_ROWS,
	MAX_ACTIVITY_SOURCE_CAPTURE_ROWS,
	MAX_AUDIT_ROWS,
	MAX_SOURCE_STATUS_ROWS,
	MAX_TASK_ROWS,
	type ActivityTimelineItem,
	type ActivityTimelineSnapshot,
	type AgentActivitySnapshot,
	type AgentConnectionRecord,
	type AgentTaskRecord,
	type AgentToolCallRecord,
	type AuditEventRecord,
	type ContextPackRecord,
	type SourceCaptureRecord,
	type SourceRequestRecord,
} from './activity-model';
import { ui } from '../../ui/localization';
import { buildAgentWorkflowDiagnostics } from './activity-workflow-diagnostics';

type ParsedRecordValue = string | string[];
type ParsedRecord = Record<string, ParsedRecordValue>;

export interface ActivityDataControllerHost {
	readRecentAgentTasks(limit: number): Promise<AgentTaskRecord[]>;
	readRecentContextPacks(limit: number): Promise<ContextPackRecord[]>;
	readRecentSourceCaptures(limit: number): Promise<SourceCaptureRecord[]>;
	readRecentSourceRequests(limit: number): Promise<SourceRequestRecord[]>;
	readRecentMemoryProposals(limit: number): Promise<MemoryProposalRecord[]>;
	getStructureStatus(): TracekeeperStructureStatus;
	getRuntimeViewStatus(): RuntimeViewStatus;
	getVaultRoot(): string;
	refreshGovernanceViews(): Promise<void>;
	readFrontmatter(content: string): { fields: ParsedRecord; body: string };
	firstString(values: ParsedRecord, keys: string[]): string;
	readStringList(values: ParsedRecord, keys: string[]): string[];
	readKeyValueRows(lines: string[]): ParsedRecord;
	parseTimestamp(timestamp: string | undefined, fallbackMs?: number): number;
	timestampFromFilename(filename: string): string;
	snippetFromText(text: string, fallback?: string): string;
	trimText(value: string, maxLength?: number): string;
	buildAuditLogHeader(): string;
	formatAgentDisplayName(clientName: string, agentId: string): string;
	formatToolDisplayName(toolName: string): string;
	formatResultLabel(status: string): string;
	formatRiskLabel(risk: string): string;
}

export class ActivityDataController {
	constructor(
		private readonly app: App,
		private readonly host: ActivityDataControllerHost
	) {}

async loadAgentActivitySnapshot(): Promise<AgentActivitySnapshot> {
		const [
			recentTasks,
			recentContextPacks,
			recentSourceCaptures,
			recentSourceRequests,
			reviewQueueItems,
			recentAuditEvents,
		] = await Promise.all([
			this.host.readRecentAgentTasks(MAX_TASK_ROWS),
			this.host.readRecentContextPacks(MAX_ACTIVITY_CONTEXT_PACK_ROWS),
			this.host.readRecentSourceCaptures(MAX_ACTIVITY_SOURCE_CAPTURE_ROWS),
			this.host.readRecentSourceRequests(MAX_SOURCE_STATUS_ROWS),
			this.host.readRecentMemoryProposals(Number.MAX_SAFE_INTEGER),
			this.readRecentAuditEvents(MAX_AUDIT_ROWS),
		]);
		const recentProposals = reviewQueueItems.slice(0, MAX_ACTIVITY_PROPOSAL_ROWS);
		const reviewQueueItemCount = reviewQueueItems.length;
		const pendingReviewQueueItemCount = reviewQueueItems.filter((proposal) => proposal.approvalStatus === 'pending').length;
		const revisionRequestedReviewQueueItemCount = reviewQueueItems.filter((proposal) => proposal.approvalStatus === 'revision_requested').length;
		const actionableReviewQueueItemCount = pendingReviewQueueItemCount + revisionRequestedReviewQueueItemCount;
		const latestTask = recentTasks[0] ?? null;
		const structureStatus = this.host.getStructureStatus();
		const taskFolderMissing =
			this.app.vault.getAbstractFileByPath(AGENT_TASKS_PATH) === null;
		const auditLogMissing =
			this.app.vault.getAbstractFileByPath(TRACEKEEPER_AUDIT_LOG_PATH) === null;
		const auditDirMissing =
			this.app.vault.getAbstractFileByPath(TRACEKEEPER_AUDIT_DIR) === null;
		const recentToolCallRecords = recentAuditEvents
			.filter((event) => this.isToolCallAuditEvent(event))
			.map((event) => this.toAgentToolCallRecord(event));
		const recentAgentCount = this.buildRecentAgentConnections(
			recentAuditEvents,
			recentToolCallRecords
		).length;
		const timelineItems = recentAuditEvents
			.filter((event) => !this.isConnectionAuditEvent(event))
			.map((event) => this.toActivityTimelineAuditItem(event))
			.slice(0, ACTIVITY_TIMELINE_PREVIEW_ROWS);
		const workflowDiagnostics = buildAgentWorkflowDiagnostics(recentAuditEvents);

		return {
			runtimeStatus: this.host.getRuntimeViewStatus(),
			structureStatus,
			vaultRoot: this.host.getVaultRoot(),
			latestTask,
			recentTasks,
			recentContextPacks,
			recentSourceCaptures,
			recentSourceRequests,
			recentProposals,
			reviewQueueItemCount,
			pendingReviewQueueItemCount,
			revisionRequestedReviewQueueItemCount,
			actionableReviewQueueItemCount,
			recentAuditEvents,
			workflowDiagnostics,
			timelineItems,
			recentAgentCount,
			recentToolCallCount: recentToolCallRecords.length,
			missingTaskFolder: taskFolderMissing,
			missingAuditSources: auditLogMissing && auditDirMissing,
			updatedAt: new Date().toISOString(),
		};
	}

async loadActivityTimelineSnapshot(
		page: number,
		pageSize = ACTIVITY_TIMELINE_PAGE_SIZE
	): Promise<ActivityTimelineSnapshot> {
		const safePageSize = Math.max(1, Math.floor(pageSize));
		const [
			tasks,
			contextPacks,
			sourceCaptures,
			sourceRequests,
			proposals,
			auditEvents,
		] = await Promise.all([
			this.host.readRecentAgentTasks(Number.MAX_SAFE_INTEGER),
			this.host.readRecentContextPacks(Number.MAX_SAFE_INTEGER),
			this.host.readRecentSourceCaptures(Number.MAX_SAFE_INTEGER),
			this.host.readRecentSourceRequests(Number.MAX_SAFE_INTEGER),
			this.host.readRecentMemoryProposals(Number.MAX_SAFE_INTEGER),
			this.readRecentAuditEvents(Number.MAX_SAFE_INTEGER),
		]);
		const timelineItems = this.buildActivityTimelineItems({
			tasks,
			contextPacks,
			sourceCaptures,
			sourceRequests,
			proposals,
			auditEvents,
		});
		const totalItems = timelineItems.length;
		const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
		const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
		const start = (safePage - 1) * safePageSize;

		return {
			items: timelineItems.slice(start, start + safePageSize),
			page: safePage,
			pageSize: safePageSize,
			totalItems,
			totalPages,
			updatedAt: new Date().toISOString(),
		};
	}

async loadRuntimeLogSnapshot(
		page: number,
		filter: RuntimeLogFilter = 'all',
		pageSize = RUNTIME_LOG_PAGE_SIZE
	): Promise<RuntimeLogSnapshot> {
		const safePageSize = Math.max(1, Math.floor(pageSize));
		const safeFilter = RUNTIME_LOG_FILTERS.includes(filter) ? filter : 'all';
		const auditEvents = await this.readRecentAuditEvents(Number.MAX_SAFE_INTEGER);
		const allItems = auditEvents.map((event) => this.toRuntimeLogItem(event));
		const counts = this.countRuntimeLogItems(allItems);
		const visibleItems = allItems.filter((item) => this.matchesRuntimeLogFilter(item, safeFilter));
		const totalItems = visibleItems.length;
		const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
		const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
		const start = (safePage - 1) * safePageSize;

		return {
			items: visibleItems.slice(start, start + safePageSize),
			filter: safeFilter,
			counts,
			page: safePage,
			pageSize: safePageSize,
			totalItems,
			totalPages,
			updatedAt: new Date().toISOString(),
		};
	}

async cleanRuntimeLogs(scope: RuntimeLogCleanupScope): Promise<RuntimeLogCleanupResult> {
		const cutoff = this.runtimeLogCleanupCutoff(scope);
		const removedSections = await this.cleanAuditLogSections(cutoff);
		const removedFiles = await this.cleanAuditFolderFiles(cutoff);
		await this.host.refreshGovernanceViews();
		return { removedSections, removedFiles };
	}

private runtimeLogCleanupCutoff(scope: RuntimeLogCleanupScope): number | null {
		const now = Date.now();
		const dayMs = 24 * 60 * 60 * 1000;
		switch (scope) {
			case 'older-than-week':
				return now - 7 * dayMs;
			case 'older-than-month':
				return now - 30 * dayMs;
			case 'older-than-three-months':
				return now - 90 * dayMs;
			case 'all':
			default:
				return null;
		}
	}

private async cleanAuditLogSections(cutoff: number | null): Promise<number> {
		const file = this.app.vault.getAbstractFileByPath(TRACEKEEPER_AUDIT_LOG_PATH);
		if (!(file instanceof TFile)) {
			return 0;
		}

		let removed = 0;
		await this.app.vault.process(file, (current) => {
			const parsed = this.splitAuditLogContent(current);
			const keptSections = parsed.sections.filter((section) => {
				const shouldRemove = cutoff === null || section.sortTimestamp < cutoff;
				if (shouldRemove) {
					removed += 1;
				}
				return !shouldRemove;
			});
			return this.renderAuditLogContent(parsed.header, keptSections.map((section) => section.content));
		});
		return removed;
	}

private splitAuditLogContent(content: string): { header: string; sections: Array<{ content: string; sortTimestamp: number }> } {
		const normalized = content.replace(/\r\n/g, '\n');
		const lines = normalized.split('\n');
		const firstSectionIndex = lines.findIndex((line) => line.trim().startsWith('## '));
		const headerLines = firstSectionIndex >= 0 ? lines.slice(0, firstSectionIndex) : lines;
		const sections: Array<{ content: string; sortTimestamp: number }> = [];
		let cursor = firstSectionIndex >= 0 ? firstSectionIndex : lines.length;

		while (cursor < lines.length) {
			const start = cursor;
			const header = lines[cursor].trim();
			cursor += 1;
			const bodyLines: string[] = [];
			while (cursor < lines.length && !lines[cursor].trim().startsWith('## ')) {
				bodyLines.push(lines[cursor]);
				cursor += 1;
			}
			const timestampHeader = header.replace(/^##\s+/, '').trim();
			const row = this.host.readKeyValueRows(bodyLines);
			const timestamp = this.host.firstString(row, ['timestamp']) || timestampHeader;
			sections.push({
				content: lines.slice(start, cursor).join('\n').replace(/\s+$/g, ''),
				sortTimestamp: this.host.parseTimestamp(timestamp, 0),
			});
		}

		return {
			header: headerLines.join('\n').trim(),
			sections,
		};
	}

private renderAuditLogContent(header: string, sections: string[]): string {
		const normalizedHeader = header.trim() || this.host.buildAuditLogHeader().trim();
		if (sections.length === 0) {
			return `${normalizedHeader}\n\n`;
		}
		return `${normalizedHeader}\n\n${sections.join('\n\n')}\n\n`;
	}

private async cleanAuditFolderFiles(cutoff: number | null): Promise<number> {
		const folder = this.app.vault.getAbstractFileByPath(TRACEKEEPER_AUDIT_DIR);
		if (!(folder instanceof TFolder)) {
			return 0;
		}

		let removed = 0;
		for (const file of this.collectMarkdownFiles(folder)) {
			const events = await this.readAuditMarkdownFile(file);
			const timestamps = events
				.map((event) => event.sortTimestamp)
				.filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
			const latestTimestamp = timestamps.length > 0
				? Math.max(...timestamps)
				: file.stat?.mtime || 0;
			const shouldRemove = cutoff === null || latestTimestamp < cutoff;
			if (!shouldRemove) {
				continue;
			}
			await this.app.vault.delete(file);
			removed += 1;
		}
		return removed;
	}

private countRuntimeLogItems(items: RuntimeLogItem[]): Record<RuntimeLogFilter, number> {
		const counts: Record<RuntimeLogFilter, number> = {
			all: 0,
			connection: 0,
			tool: 0,
			config: 0,
			error: 0,
		};
		for (const item of items) {
			counts.all += 1;
			if (item.category === 'connection' || item.category === 'tool' || item.category === 'config') {
				counts[item.category] += 1;
			}
			if (this.isRuntimeLogError(item)) {
				counts.error += 1;
			}
		}
		return counts;
	}

private matchesRuntimeLogFilter(item: RuntimeLogItem, filter: RuntimeLogFilter): boolean {
		if (filter === 'all') {
			return true;
		}
		if (filter === 'error') {
			return this.isRuntimeLogError(item);
		}
		return item.category === filter;
	}

private isRuntimeLogError(item: RuntimeLogItem): boolean {
		const normalized = item.status.toLowerCase().trim();
		return normalized === 'failed' || normalized === 'error' || normalized.includes('failed');
	}

private toRuntimeLogItem(event: AuditEventRecord): RuntimeLogItem {
		const category = this.runtimeLogCategory(event);
		const status = event.resultStatus || (category === 'connection' ? 'connected' : '');
		const metaParts = [
			this.host.formatAgentDisplayName(event.clientName, event.agentId),
			status ? this.host.formatResultLabel(status) : '',
			event.riskLevel ? this.host.formatRiskLabel(event.riskLevel) : '',
		].filter(Boolean);
		const body = event.reason
			|| event.argsSummary
			|| event.targetPaths.join(', ')
			|| event.target
			|| event.snippet;

		return {
			time: event.sortTimestamp,
			category,
			title: this.runtimeLogTitle(event, category),
			meta: metaParts.join(' • '),
			body,
			path: event.target || event.path,
			status,
		};
	}

private runtimeLogCategory(event: AuditEventRecord): RuntimeLogCategory {
		if (this.isConnectionAuditEvent(event)) {
			return 'connection';
		}
		if (event.action.startsWith('client_config_')) {
			return 'config';
		}
		if (this.isToolCallAuditEvent(event)) {
			return 'tool';
		}
		return 'record';
	}

private runtimeLogTitle(event: AuditEventRecord, category: RuntimeLogCategory): string {
		if (category === 'connection') {
			return ui('建立连接', 'Connected');
		}
		if (category === 'tool') {
			return this.host.formatToolDisplayName(event.toolName || event.action);
		}
		if (category === 'config') {
			switch (event.action) {
				case 'client_config_applied':
					return ui('写入连接配置', 'Connection config written');
				case 'client_config_removed':
					return ui('移除连接配置', 'Connection config removed');
				case 'client_config_failed':
					return ui('连接配置失败', 'Connection config failed');
				default:
					return ui('连接配置变更', 'Connection config change');
			}
		}
		if (event.action === 'structure.repair') {
			return ui('补齐基础结构', 'Repair base structure');
		}
		if (event.action === 'legacy_structure.migrate') {
			return ui('复制重建旧目录', 'Rebuild legacy structure');
		}
		if (event.action === 'legacy_structure.cleanup') {
			return ui('清理旧目录', 'Clean legacy folders');
		}
		return event.action || ui('运行记录', 'Runtime record');
	}

private buildActivityTimelineItems(input: {
		tasks: AgentTaskRecord[];
		contextPacks: ContextPackRecord[];
		sourceCaptures: SourceCaptureRecord[];
		sourceRequests: SourceRequestRecord[];
		proposals: MemoryProposalRecord[];
		auditEvents: AuditEventRecord[];
	}): ActivityTimelineItem[] {
		return [
			...input.tasks.map((task) => ({
				time: task.sortTimestamp,
				type: ui('任务', 'Task'),
				title: task.taskId,
				meta: `${task.agent} • ${task.status}`,
				body: task.objective || task.snippet,
				path: task.path,
			})),
			...input.contextPacks.map((contextPack) => ({
				time: contextPack.sortTimestamp,
				type: 'context',
				title: contextPack.title,
				meta: contextPack.taskId,
				body: contextPack.snippet,
				path: contextPack.path,
			})),
			...input.sourceCaptures.map((source) => ({
				time: source.sortTimestamp,
				type: ui('来源', 'Source'),
				title: source.title || source.source || ui('来源记录', 'Source capture'),
				meta: [source.sourceKind, source.mode || source.type].filter(Boolean).join(' • '),
				body: source.source || source.snippet,
				path: source.path,
			})),
			...input.sourceRequests.map((request) => ({
				time: request.sortTimestamp,
				type: ui('来源请求', 'Source request'),
				title: request.sourceKind,
				meta: request.status,
				body: request.source || request.summary,
				path: request.path,
			})),
			...input.proposals.map((proposal) => ({
				time: proposal.sortTimestamp,
				type: ui('提案', 'Proposal'),
				title: proposal.proposalId,
				meta: `${memoryProposalStatusLabel(proposal.approvalStatus)} • ${proposal.proposalKind}`,
				body: proposal.snippet,
				path: proposal.path,
			})),
			...input.auditEvents.map((event) => this.toActivityTimelineAuditItem(event)),
		].sort((a, b) => b.time - a.time);
	}

private toActivityTimelineAuditItem(event: AuditEventRecord): ActivityTimelineItem {
		const isConnection = this.isConnectionAuditEvent(event);
		const isStructureEvent = event.action === 'structure.repair' || event.action === 'legacy_structure.migrate' || event.action === 'legacy_structure.cleanup';
		const agentLabel = this.host.formatAgentDisplayName(event.clientName, event.agentId);
		return {
			time: event.sortTimestamp,
			type: event.toolName
				? agentLabel
				: isConnection
					? agentLabel
					: isStructureEvent
						? ui('结构', 'Structure')
						: ui('记录', 'Record'),
			title: event.toolName
				? this.host.formatToolDisplayName(event.toolName)
				: isConnection
					? ui('建立连接', 'Connected')
					: this.runtimeLogTitle(event, 'record'),
			meta: event.resultStatus ? this.host.formatResultLabel(event.resultStatus) : event.actor,
			body: event.reason || event.snippet,
			path: event.target || event.path,
		};
	}

isToolCallAuditEvent(event: AuditEventRecord): boolean {
		return event.eventType === 'tool-call'
			|| event.eventType === 'agent-tool-call'
			|| (Boolean(event.toolName) && !this.isConnectionAuditEvent(event));
	}

isConnectionAuditEvent(event: AuditEventRecord): boolean {
		return event.eventType === 'connection' || event.eventType === 'agent-connection-event' || event.action === 'connection' || event.action === 'mcp.initialize';
	}

private normalizeAuditToolName(eventType: string, action: string, toolName: string): string {
		const normalizedTool = toolName.trim();
		const isConnection =
			eventType === 'connection' ||
			eventType === 'agent-connection-event' ||
			action === 'connection' ||
			action === 'mcp.initialize';
		if (isConnection && normalizedTool.toLowerCase() === 'unknown') {
			return '';
		}
		return normalizedTool;
	}

	toAgentToolCallRecord(event: AuditEventRecord): AgentToolCallRecord {
		return {
			principalId: event.principalId,
			taskId: event.taskId,
			agentId: event.agentId || 'unknown',
			sessionId: event.sessionId || event.agentId || 'unknown',
			clientName: event.clientName || 'unknown',
			toolName: event.toolName || event.action || 'unknown',
			resultStatus: event.resultStatus || 'unknown',
			targetPaths: event.targetPaths,
			timestamp: event.timestamp,
			durationMs: event.durationMs,
			riskLevel: event.riskLevel || 'unknown',
			argsSummary: event.argsSummary,
			resultSummary: event.resultSummary,
			sortTimestamp: event.sortTimestamp,
		};
	}

buildRecentAgentConnections(
		auditEvents: AuditEventRecord[],
		toolCalls: AgentToolCallRecord[]
	): AgentConnectionRecord[] {
		const agents = new Map<string, AgentConnectionRecord>();
		const upsertAgent = (principalId: string, agentId: string, sessionId: string, clientName: string, timestamp: string, sortTimestamp: number) => {
			const key = `${clientName || 'unknown'}::${sessionId || agentId || 'unknown'}`;
			const existing = agents.get(key);
			if (existing && existing.sortTimestamp >= sortTimestamp) {
				return existing;
			}
			const next = existing || {
				principalId,
				agentId: agentId || 'unknown',
				sessionId: sessionId || agentId || 'unknown',
				clientName: clientName || 'unknown',
				transport: 'streamable-http',
				status: 'seen',
				lastSeen: timestamp,
				lastToolCall: '',
				runtimeVersion: '',
				permissionProfile: 'read-only default + controlled write',
				sortTimestamp,
			};
			next.lastSeen = timestamp || next.lastSeen;
			next.sortTimestamp = sortTimestamp || next.sortTimestamp;
			agents.set(key, next);
			return next;
		};

		for (const event of auditEvents.filter((item) => this.isConnectionAuditEvent(item))) {
			const agent = upsertAgent(event.principalId, event.agentId, event.sessionId, event.clientName, event.timestamp, event.sortTimestamp);
			agent.transport = event.transport || agent.transport;
			agent.runtimeVersion = event.runtimeVersion || agent.runtimeVersion;
			agent.status = event.resultStatus || 'connected';
		}

		for (const call of toolCalls) {
			const agent = upsertAgent(call.principalId, call.agentId, call.sessionId, call.clientName, call.timestamp, call.sortTimestamp);
			agent.lastToolCall = call.toolName;
			agent.status = call.resultStatus === 'failed' ? 'warning' : 'active';
		}

		return [...agents.values()].sort((a, b) => b.sortTimestamp - a.sortTimestamp);
	}

async readRecentAuditEvents(limit: number): Promise<AuditEventRecord[]> {
		const auditLogRecords = await this.readAuditLogFile();
		const folderRecords = await this.readAuditFolderEvents();

		return [...auditLogRecords, ...folderRecords]
			.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
			.slice(0, limit);
	}

private async readAuditLogFile(): Promise<AuditEventRecord[]> {
		const file = this.app.vault.getAbstractFileByPath(TRACEKEEPER_AUDIT_LOG_PATH);
		if (!(file instanceof TFile)) {
			return [];
		}

		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error('tracekeeper failed to read audit log', error);
			return [];
		}

		return this.parseAuditLogSections(content, file.path);
	}

private async readAuditFolderEvents(): Promise<AuditEventRecord[]> {
		const folder = this.app.vault.getAbstractFileByPath(TRACEKEEPER_AUDIT_DIR);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files = this.collectMarkdownFiles(folder);
		const events: AuditEventRecord[] = [];
		for (const file of files) {
			const fileEvents = await this.readAuditMarkdownFile(file);
			events.push(...fileEvents);
		}
		return events;
	}

private async readAuditMarkdownFile(file: TFile): Promise<AuditEventRecord[]> {
		let content = '';
		try {
			content = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`tracekeeper failed to read audit file: ${file.path}`, error);
			return [];
		}

		const parsed = this.host.readFrontmatter(content);
		const data = parsed.fields;
		const timestamp = this.host.firstString(data, ['timestamp']) || this.host.timestampFromFilename(file.basename);
		const fallbackTs =
			this.host.parseTimestamp(timestamp, file.stat?.mtime || Date.now()) || file.stat?.mtime || Date.now();

		if (Object.keys(data).length > 0) {
			const eventType = this.host.firstString(data, ['type']);
			const action = this.host.firstString(data, ['action']) || 'unknown';
			const toolName = this.normalizeAuditToolName(
				eventType,
				action,
				this.host.firstString(data, ['tool_name', 'toolName', 'tool'])
			);
			return [
				{
					path: file.path,
					auditId: this.host.firstString(data, ['audit_id', 'auditId', 'id']),
					actor: this.host.firstString(data, ['actor']) || 'unknown',
					action,
					target: this.host.firstString(data, ['target']) || '',
					reason: this.host.firstString(data, ['reason']) || '',
					taskId: this.host.firstString(data, ['task_id', 'taskId']),
					timestamp: timestamp || '',
					sortTimestamp: fallbackTs,
					snippet: this.host.snippetFromText(parsed.body, this.host.trimText(file.basename)),
					eventType,
					principalId: this.host.firstString(data, ['principal_id', 'principalId']),
					agentId: this.host.firstString(data, ['agent_id', 'agentId', 'session_id', 'sessionId']),
					sessionId: this.host.firstString(data, ['session_id', 'sessionId']),
					clientName: this.host.firstString(data, ['client_name', 'clientName', 'client']),
					toolName,
					resultStatus: this.host.firstString(data, ['result_status', 'resultStatus', 'result', 'status']),
					targetPaths: this.host.readStringList(data, ['target_paths', 'targetPaths', 'target_path', 'targetPath', 'target']),
					durationMs: this.host.firstString(data, ['duration_ms', 'durationMs']),
					riskLevel: this.host.firstString(data, ['risk_level', 'riskLevel']),
					argsSummary: this.host.firstString(data, ['args_summary', 'argsSummary']),
					resultSummary: this.host.firstString(data, ['result_summary', 'resultSummary']),
					workflowContractVersion: this.host.firstString(data, ['workflow_contract_version', 'workflowContractVersion']),
					resultSchemaVersion: this.host.firstString(data, ['result_schema_version', 'resultSchemaVersion']),
					workflowMode: this.host.firstString(data, ['workflow_mode', 'workflowMode']),
					workflowId: this.host.firstString(data, ['workflow_id', 'workflowId']),
					recallId: this.host.firstString(data, ['recall_id', 'recallId']),
					actionId: this.host.firstString(data, ['action_id', 'actionId']),
					actionReasonCode: this.host.firstString(data, ['action_reason_code', 'actionReasonCode']),
					snapshotGeneration: this.host.firstString(data, ['snapshot_generation', 'snapshotGeneration']),
					scopeMode: this.host.firstString(data, ['scope_mode', 'scopeMode']),
					scopeConfidence: this.host.firstString(data, ['scope_confidence', 'scopeConfidence']),
					matchedCount: this.host.firstString(data, ['matched_count', 'matchedCount']),
					memoryCloseoutStatus: this.host.firstString(data, ['memory_closeout_status', 'memoryCloseoutStatus']),
					transport: this.host.firstString(data, ['transport']),
					runtimeVersion: this.host.firstString(data, ['runtime_version', 'runtimeVersion']),
				},
			];
		}

		const sectionRecords = this.parseAuditLogSections(content, file.path);
		return sectionRecords.length > 0 ? sectionRecords : [];
	}

private parseAuditLogSections(content: string, sourcePath: string): AuditEventRecord[] {
		const lines = content.replace(/\r\n/g, '\n').split('\n');
		const events: AuditEventRecord[] = [];
		let cursor = 0;

		while (cursor < lines.length) {
			const header = lines[cursor].trim();
			if (!header.startsWith('## ')) {
				cursor += 1;
				continue;
			}

			const timestampHeader = header.replace(/^##\s+/, '').trim();
			cursor += 1;
			const bodyLines: string[] = [];
			while (
				cursor < lines.length &&
				!lines[cursor].trim().startsWith('## ')
			) {
				bodyLines.push(lines[cursor]);
				cursor += 1;
			}

			const row = this.host.readKeyValueRows(bodyLines);
			const fallbackTimestamp =
				this.host.firstString(row, ['timestamp']) || timestampHeader;
			const eventType = this.host.firstString(row, ['type']);
			const action = this.host.firstString(row, ['action']) || 'unknown';
			const toolName = this.normalizeAuditToolName(
				eventType,
				action,
				this.host.firstString(row, ['tool_name', 'toolName', 'tool'])
			);
			events.push({
				path: sourcePath,
				auditId: this.host.firstString(row, ['audit_id', 'auditId', 'id']),
				actor: this.host.firstString(row, ['actor']) || 'unknown',
				action,
				target: this.host.firstString(row, ['target']) || '',
				reason: this.host.firstString(row, ['reason']) || '',
				taskId: this.host.firstString(row, ['task_id', 'taskId']),
				timestamp: fallbackTimestamp,
				sortTimestamp: this.host.parseTimestamp(
					fallbackTimestamp,
					Date.now()
				),
				snippet: this.host.snippetFromText(bodyLines.join('\n')),
				eventType,
				principalId: this.host.firstString(row, ['principal_id', 'principalId']),
				agentId: this.host.firstString(row, ['agent_id', 'agentId', 'session_id', 'sessionId']),
				sessionId: this.host.firstString(row, ['session_id', 'sessionId']),
				clientName: this.host.firstString(row, ['client_name', 'clientName', 'client']),
				toolName,
				resultStatus: this.host.firstString(row, ['result_status', 'resultStatus', 'result', 'status']),
				targetPaths: this.host.readStringList(row, ['target_paths', 'targetPaths', 'target_path', 'targetPath', 'target']),
				durationMs: this.host.firstString(row, ['duration_ms', 'durationMs']),
				riskLevel: this.host.firstString(row, ['risk_level', 'riskLevel']),
				argsSummary: this.host.firstString(row, ['args_summary', 'argsSummary']),
				resultSummary: this.host.firstString(row, ['result_summary', 'resultSummary']),
				workflowContractVersion: this.host.firstString(row, ['workflow_contract_version', 'workflowContractVersion']),
				resultSchemaVersion: this.host.firstString(row, ['result_schema_version', 'resultSchemaVersion']),
				workflowMode: this.host.firstString(row, ['workflow_mode', 'workflowMode']),
				workflowId: this.host.firstString(row, ['workflow_id', 'workflowId']),
				recallId: this.host.firstString(row, ['recall_id', 'recallId']),
				actionId: this.host.firstString(row, ['action_id', 'actionId']),
				actionReasonCode: this.host.firstString(row, ['action_reason_code', 'actionReasonCode']),
				snapshotGeneration: this.host.firstString(row, ['snapshot_generation', 'snapshotGeneration']),
				scopeMode: this.host.firstString(row, ['scope_mode', 'scopeMode']),
				scopeConfidence: this.host.firstString(row, ['scope_confidence', 'scopeConfidence']),
				matchedCount: this.host.firstString(row, ['matched_count', 'matchedCount']),
				memoryCloseoutStatus: this.host.firstString(row, ['memory_closeout_status', 'memoryCloseoutStatus']),
				transport: this.host.firstString(row, ['transport']),
				runtimeVersion: this.host.firstString(row, ['runtime_version', 'runtimeVersion']),
			});
		}

		return events;
	}

private collectMarkdownFiles(folder: TFolder): TFile[] {
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
}
