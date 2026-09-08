import { App, TFile, TFolder } from 'obsidian';
import {
	AGENT_ACTIVITY_SCHEMA_VERSION,
	TRACEKEEPER_AGENT_ACTIVITY_DIR,
	TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH,
	auditShardPath,
	buildStableAuditEventId,
	renderAgentActivityHub,
} from '@tracekeeper/core';
import { withObsidianVaultPathLock } from '../../adapters/obsidian-vault-path-lock';

const AGENT_ACTIVITY_HUB_PATH = TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH;
const MAX_ACTIVITY_VALUE_LENGTH = 320;
const MAX_ACTIVITY_EVENT_LENGTH = 4096;

const OPTIONAL_AUDIT_FIELDS = [
	'operation_id',
	'request_id',
	'actor',
	'action',
	'status',
	'result',
	'result_status',
	'target',
	'target_paths',
	'reason',
	'task_id',
	'proposal_id',
	'proposal_path',
	'previous_path',
	'current_path',
	'transition_kind',
	'previous_status',
	'next_status',
	'expected_revision',
	'previous_revision',
	'committed_revision',
	'previous_content_hash',
	'committed_content_hash',
	'migration_id',
	'cleanup_id',
	'moved_count',
	'copied_count',
	'review_count',
	'approved_count',
	'applied_count',
	'trashed_roots',
	'failed_roots',
	'folders_created',
	'files_created',
	'principal_id',
	'agent_id',
	'session_id',
	'client_id',
	'client',
	'client_name',
	'tool_name',
	'duration_ms',
	'risk_level',
	'transport',
	'runtime_version',
	'warning',
	'warnings',
	'args_summary',
	'result_summary',
	'workflow_contract_version',
	'result_schema_version',
	'workflow_mode',
	'workflow_id',
	'recall_id',
	'action_id',
	'action_reason_code',
	'snapshot_generation',
	'scope_mode',
	'scope_confidence',
	'matched_count',
	'memory_closeout_status',
	'bundle_hash',
	'backup_created',
	'install_method',
] as const;

type OptionalAuditField = typeof OPTIONAL_AUDIT_FIELDS[number];
type RawAuditFields = Record<string, string>;

export interface NativeAuditAppendIdentity {
	operationId?: string;
	requestId?: string;
}

export interface NativeAuditAppendResult {
	eventIds: string[];
	shardPaths: string[];
}

export interface NativeAuditRepositoryHost {
	ensureFolderExists(path: string): Promise<void>;
	createOperationId?(): string;
}

interface PreparedAuditEvent {
	auditEventId: string;
	shardPath: string;
	timestamp: string;
	content: string;
}

interface RawAuditSection {
	timestampHeader: string;
	fields: RawAuditFields;
}

export class ObsidianAuditShardRepository {
	private readonly queues = new Map<string, Promise<void>>();

	constructor(
		private readonly app: App,
		private readonly host: NativeAuditRepositoryHost
	) {}

	async appendRawEvents(
		rawEvent: string,
		identity: NativeAuditAppendIdentity = {}
	): Promise<NativeAuditAppendResult> {
		const generatedOperationId = this.createOperationId();
		const events = this.parseSections(rawEvent).map((section) =>
			this.prepareEvent(section, identity, generatedOperationId)
		);
		const groups = new Map<string, PreparedAuditEvent[]>();
		for (const event of events) {
			const group = groups.get(event.shardPath) ?? [];
			group.push(event);
			groups.set(event.shardPath, group);
		}

		await Promise.all(
			[...groups].map(([shardPath, shardEvents]) =>
				withObsidianVaultPathLock(this.app.vault, shardPath, async () => {
					await this.appendToShard(shardPath, shardEvents);
				})
			)
		);

		return {
			eventIds: events.map((event) => event.auditEventId),
			shardPaths: [...new Set(events.map(event => event.shardPath))].sort(),
		};
	}

	async appendRuntimeEvent(entry: string): Promise<{
		path: string;
	}> {
		// Runtime 已完成字段投影与脱敏；共用原生分片写入器，保留列表型元数据。
		const id = entry.match(/^- activity_event_id:\s*"?(audit-[a-f0-9]+)"?\s*$/m)?.[1];
		const timestamp = entry.match(/^- timestamp:\s*"?([^"\n]+)"?\s*$/m)?.[1];
		if (!id || !timestamp || !/^- type:\s*"?mcp\.(tool-call|connection|authentication-rejected)"?\s*$/m.test(entry) || Buffer.byteLength(entry) > 64 * 1024)
			throw new Error('Invalid prepared activity event.');
		const event: PreparedAuditEvent = { auditEventId: id, timestamp, content: entry, shardPath: auditShardPath(timestamp) };
		await withObsidianVaultPathLock(this.app.vault, event.shardPath, () => this.appendToShard(event.shardPath, [event]));
		return { path: event.shardPath };
	}

	private createOperationId(): string {
		if (this.host.createOperationId) {
			return this.host.createOperationId();
		}
		if (typeof window.crypto?.randomUUID === 'function') {
			return `native-${window.crypto.randomUUID()}`;
		}
		return `native-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
	}

	private parseSections(rawEvent: string): RawAuditSection[] {
		const normalized = rawEvent.replace(/\r\n/g, '\n');
		const matches = [...normalized.matchAll(/^##[ \t]+(.+)$/gm)];
		if (matches.length === 0) {
			throw new Error('Audit event must contain a timestamp section.');
		}

		return matches.map((match, index) => {
			const sectionStart = (match.index ?? 0) + match[0].length;
			const sectionEnd = matches[index + 1]?.index ?? normalized.length;
			const fields: RawAuditFields = {};
			for (const line of normalized.slice(sectionStart, sectionEnd).split('\n')) {
				const row = line.match(/^\s*-?\s*([A-Za-z0-9_-]+):\s*(.*)$/);
				if (row) {
					fields[row[1].toLowerCase()] = row[2].trim();
				}
			}
			return {
				timestampHeader: match[1].trim(),
				fields,
			};
		});
	}

	private prepareEvent(
		section: RawAuditSection,
		identity: NativeAuditAppendIdentity,
		generatedOperationId: string
	): PreparedAuditEvent {
		const timestamp = this.normalizeTimestamp(
			section.fields.timestamp || section.timestampHeader
		);
		const action = this.normalizeValue(
			section.fields.action || section.fields.event || 'unknown',
			'action'
		);
		const eventType = this.normalizeValue(
			section.fields.type || 'native-audit-event',
			'type'
		);
		const eventName = this.normalizeValue(
			section.fields.event || action,
			'event'
		);
		const operationId = this.normalizeIdentity(
			identity.operationId
				|| section.fields.operation_id
				|| section.fields.migration_id
				|| section.fields.cleanup_id
		);
		const requestId = this.normalizeIdentity(
			identity.requestId || section.fields.request_id
		);
		const stableIdentity = operationId
			? { operationId }
			: requestId
				? { requestId }
				: { operationId: generatedOperationId };
		const optionalFields = this.normalizeOptionalFields(section.fields);
		if (operationId) {
			optionalFields.operation_id = operationId;
		} else if (requestId) {
			optionalFields.request_id = requestId;
		}
		const suppliedEventId = this.normalizeEventId(section.fields.activity_event_id);
		const auditEventId = suppliedEventId || buildStableAuditEventId({
			...stableIdentity,
			type: eventType,
			event: eventName,
			action,
			...optionalFields,
		});
		const content = this.renderEvent({
			auditEventId,
			timestamp,
			eventType,
			eventName,
			action,
			optionalFields,
		});

		return {
			auditEventId,
			shardPath: auditShardPath(timestamp),
			timestamp,
			content,
		};
	}

	private normalizeOptionalFields(fields: RawAuditFields): Partial<Record<OptionalAuditField, string>> {
		const normalized: Partial<Record<OptionalAuditField, string>> = {};
		for (const key of OPTIONAL_AUDIT_FIELDS) {
			const value = fields[key];
			if (value === undefined || key === 'action') {
				continue;
			}
			const safeValue = this.normalizeValue(value, key);
			if (safeValue) {
				normalized[key] = safeValue;
			}
		}
		return normalized;
	}

	private normalizeTimestamp(value: string): string {
		const parsed = new Date(value);
		if (!value.trim() || Number.isNaN(parsed.getTime())) {
			throw new Error('Audit event timestamp must be a valid date.');
		}
		return parsed.toISOString();
	}

	private normalizeIdentity(value: string | undefined): string {
		return (value ?? '')
			.trim()
			.replace(/[^A-Za-z0-9._:-]/g, '-')
			.slice(0, 160);
	}

	private normalizeEventId(value: string | undefined): string {
		const normalized = (value ?? '').trim();
		return /^[A-Za-z0-9._:-]{1,160}$/.test(normalized) ? normalized : '';
	}

	private normalizeValue(value: string, key: string): string {
		let normalized = value
			.trim()
			.replace(/^(['"])(.*)\1$/, '$2')
			.replace(/[\r\n\t]+/g, ' ')
			.replace(/\s+/g, ' ');
		normalized = normalized
			.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[redacted]')
			.replace(
				/\b(?:password|passwd|secret|token|authorization|api[_-]?key|credential|access[_-]?token|refresh[_-]?token|client[_-]?secret|cookie)\b\s*[:=]\s*\S+/gi,
				'[redacted]'
			)
			.replace(/\b(?:sk|ghp)_[A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
			.replace(/\bgithub_pat_[A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
			.replace(/file:\/\/\S+/gi, '[redacted]')
			.replace(/(?:^|[\s"'([])\/(?:Users|home|private|tmp|var|etc|opt|Volumes)\/[^\s"',)\]]+/g, (match) =>
				`${match.slice(0, match.search(/\//))}[redacted]`
			)
			.replace(/(?:^|[\s"'([])[A-Za-z]:\\[^\s"',)\]]+/g, (match) =>
				`${match.slice(0, match.search(/[A-Za-z]:\\/))}[redacted]`
			);
		if (
			['target', 'target_paths', 'proposal_path', 'previous_path', 'current_path'].includes(key)
			&& (/^[/~]/.test(normalized) || /^[A-Za-z]:\\/.test(normalized))
		) {
			normalized = '[redacted]';
		}
		return normalized.slice(0, MAX_ACTIVITY_VALUE_LENGTH);
	}

	private renderEvent(input: {
		auditEventId: string;
		timestamp: string;
		eventType: string;
		eventName: string;
		action: string;
		optionalFields: Partial<Record<OptionalAuditField, string>>;
	}): string {
		const lines = [
			`## ${input.timestamp}`,
			`type: ${input.eventType}`,
			`event: ${input.eventName}`,
			`agent_activity_schema_version: ${AGENT_ACTIVITY_SCHEMA_VERSION}`,
			`activity_event_id: ${input.auditEventId}`,
			`action: ${input.action}`,
		];
		for (const key of OPTIONAL_AUDIT_FIELDS) {
			const value = input.optionalFields[key];
			if (!value || key === 'action') {
				continue;
			}
			const candidate = `${key}: ${value}`;
			if ([...lines, candidate, `timestamp: ${input.timestamp}`, ''].join('\n').length >
				MAX_ACTIVITY_EVENT_LENGTH) {
				break;
			}
			lines.push(candidate);
		}
		lines.push(`timestamp: ${input.timestamp}`, '');
		const rendered = `${lines.join('\n')}\n`;
		if (rendered.length > MAX_ACTIVITY_EVENT_LENGTH) {
			throw new Error('Agent activity event exceeds the bounded record size.');
		}
		return rendered;
	}

	private async appendToShard(shardPath: string, events: PreparedAuditEvent[]): Promise<void> {
		const prefix = shardPath.slice(0, -3);
		const paths: string[] = [];
		let ordinal = 0;
		const ids = new Map<string, string>();
		// 同一天的写入共享基础路径锁；轮转前检查旧分片，保持跨分片重试幂等。
		for (;;) {
			const candidate = ordinal === 0 ? shardPath : `${prefix}-${String(ordinal).padStart(3, '0')}.md`;
			const file = this.app.vault.getAbstractFileByPath(candidate);
			if (!file)
				break;
			if (!(file instanceof TFile))
				throw new Error('Activity shard path is occupied.');
			const content = await this.app.vault.read(file);
			this.validateShard(content, candidate);
			for (const match of content.matchAll(/^\s*-?\s*activity_event_id:\s*["']?([A-Za-z0-9._:-]+)/gm))
				ids.set(match[1], candidate);
			paths.push(candidate);
			ordinal++;
		}
		if (ordinal > 999999)
			throw new Error('Activity rotation limit reached; maintenance is required.');
		ordinal = Math.max(1, ordinal);
		let target = paths.at(-1) ?? shardPath;
		for (const event of events) {
			if (ids.has(event.auditEventId)) {
				event.shardPath = ids.get(event.auditEventId)!;
				continue;
			}
			const file = this.app.vault.getAbstractFileByPath(target);
			if (file instanceof TFile && file.stat.size + Buffer.byteLength(event.content) + 512 > 1024 * 1024)
				target = `${prefix}-${String(ordinal++).padStart(3, '0')}.md`;
			await this.appendToShardPart(target, [event]);
			event.shardPath = target;
			ids.set(event.auditEventId, target);
		}
	}

	private async appendToShardPart(
		shardPath: string,
		events: PreparedAuditEvent[]
	): Promise<void> {
		const auditHub = await this.ensureAuditHub();
		const yearFolder = shardPath.slice(0, shardPath.lastIndexOf('/'));
		await this.serialize(`folder:${yearFolder}`, async () => {
			await this.host.ensureFolderExists(yearFolder);
		});
		let shard = this.app.vault.getAbstractFileByPath(shardPath);
		if (!shard) {
			const link = this.app.fileManager.generateMarkdownLink(
				auditHub,
				shardPath,
				undefined,
				'Audit hub'
			);
			const timestamp = events
				.map((event) => event.timestamp)
				.sort()[0];
			await this.app.vault.create(
				shardPath,
				this.renderShardHeader(shardPath, timestamp, link)
			);
			shard = this.app.vault.getAbstractFileByPath(shardPath);
		}
		if (!(shard instanceof TFile)) {
			throw new Error(`Audit shard path is not a file: ${shardPath}.`);
		}

		await this.app.vault.process(shard, (current) => {
			this.validateShard(current, shardPath);
			const existingIds = new Set(
				[...current.matchAll(/^\s*-?\s*activity_event_id:\s*["']?([A-Za-z0-9._:-]+)["']?\s*$/gm)]
					.map((match) => match[1])
			);
			const pending = events.filter((event) => !existingIds.has(event.auditEventId));
			if (pending.length === 0) {
				return current;
			}
			const newestTimestamp = pending
				.map((event) => event.timestamp)
				.concat(this.readUpdatedAt(current))
				.filter(Boolean)
				.sort()
				.at(-1) ?? pending[0].timestamp;
			const updated = current.replace(
				/^updated_at:\s*.*$/m,
				`updated_at: ${newestTimestamp}`
			);
			const prefix = updated.endsWith('\n') ? updated : `${updated}\n`;
			return `${prefix}\n${pending.map((event) => event.content).join('\n')}`;
		});
	}

	private async ensureAuditHub(): Promise<TFile> {
		return this.serialize('audit-hub', async () => {
			return withObsidianVaultPathLock(
				this.app.vault,
				AGENT_ACTIVITY_HUB_PATH,
				async () => {
					await this.host.ensureFolderExists(TRACEKEEPER_AGENT_ACTIVITY_DIR);
					let hub = this.app.vault.getAbstractFileByPath(AGENT_ACTIVITY_HUB_PATH);
					if (!hub) {
						const createdAt = new Date().toISOString();
						await this.app.vault.create(
							AGENT_ACTIVITY_HUB_PATH,
							renderAgentActivityHub(createdAt)
						);
						hub = this.app.vault.getAbstractFileByPath(AGENT_ACTIVITY_HUB_PATH);
					}
					if (hub instanceof TFolder) {
						throw new Error(`Agent activity hub path is a folder: ${AGENT_ACTIVITY_HUB_PATH}.`);
					}
					if (!(hub instanceof TFile)) {
						throw new Error(`Agent activity hub is unavailable: ${AGENT_ACTIVITY_HUB_PATH}.`);
					}
					return hub;
				}
			);
		});
	}

	private renderShardHeader(
		shardPath: string,
		timestamp: string,
		hubLink: string
	): string {
		const day = shardPath.slice(shardPath.lastIndexOf('/') + 1).slice(0, 10);
		return [
			'---',
			'type: tracekeeper_agent_activity_shard',
			`agent_activity_schema_version: ${AGENT_ACTIVITY_SCHEMA_VERSION}`,
			`activity_date_utc: ${day}`,
			`created_at: ${timestamp}`,
			`updated_at: ${timestamp}`,
			'---',
			`# Agent activity ${day}`,
			'',
			hubLink,
			'',
		].join('\n');
	}

	private validateShard(content: string, shardPath: string): void {
		const day = shardPath.slice(shardPath.lastIndexOf('/') + 1).slice(0, 10);
		if (
			!/^type:\s*tracekeeper_agent_activity_shard\s*$/m.test(content)
			|| !new RegExp(`^activity_date_utc:\\s*${day}\\s*$`, 'm').test(content)
			|| !/^updated_at:\s*\S+\s*$/m.test(content)
		) {
			throw new Error(`Agent activity shard metadata is invalid: ${shardPath}.`);
		}
	}

	private readUpdatedAt(content: string): string {
		const value = content.match(/^updated_at:\s*(\S+)\s*$/m)?.[1] ?? '';
		return Number.isNaN(Date.parse(value)) ? '' : new Date(value).toISOString();
	}

	private async serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
		const predecessor = this.queues.get(key) ?? Promise.resolve();
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = predecessor.catch(() => undefined).then(() => gate);
		this.queues.set(key, tail);
		await predecessor.catch(() => undefined);
		try {
			return await action();
		} finally {
			release();
			if (this.queues.get(key) === tail) {
				this.queues.delete(key);
			}
		}
	}
}
