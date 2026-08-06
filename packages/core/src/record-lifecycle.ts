import {
	ARCHIVE_REVIEW_QUEUE_DIR,
	TRACEKEEPER_AGENT_ACTIVITY_DIR,
	LEGACY_TRACEKEEPER_AUDIT_LOG_PATH,
	TRACEKEEPER_REVIEW_QUEUE_DIR,
	normalizeKnowledgePath,
	startsWithPathPrefix,
} from './knowledge-architecture';
import { computePayloadHash } from './operation-journal';

export type ProposalHistoryLocation = 'active' | 'archive';

export type AuditEventSourceKind = 'legacy' | 'shard';

export interface StableAuditEventIdentity {
	operationId?: string;
	requestId?: string;
	invocationId?: string;
	timestamp?: string;
	[key: string]: unknown;
}

export interface MergeableAuditEvent {
	auditEventId?: string;
	timestamp: string;
	sourcePath: string;
	sourceKind: AuditEventSourceKind;
	[key: string]: unknown;
}

export interface AuditCleanupFileInput {
	path: string;
	contentHash: string;
	version: string;
	eventTimes: readonly string[];
}

export interface AuditCleanupCurrentFile {
	path: string;
	contentHash: string;
	version: string;
}

export interface AuditCleanupPreviewFile {
	path: string;
	sourceKind: AuditEventSourceKind;
	contentHash: string;
	version: string;
	earliestEventTime: string | null;
	latestEventTime: string | null;
	eventCount: number;
}

export type AuditCleanupRetainedReason =
	| 'non-audit'
	| 'mixed-age'
	| 'too-new'
	| 'empty-or-unparseable';

export interface AuditCleanupRetainedFile extends Omit<
	AuditCleanupPreviewFile,
	'sourceKind'
> {
	sourceKind: AuditEventSourceKind | null;
	reason: AuditCleanupRetainedReason;
}

export interface AuditCleanupPreview {
	schemaVersion: 1;
	cutoff: string | null;
	eligiblePaths: string[];
	eligible: AuditCleanupPreviewFile[];
	retained: AuditCleanupRetainedFile[];
	bindingHash: string;
}

export type AuditCleanupPreviewValidation =
	| {
		status: 'ready';
		files: AuditCleanupPreviewFile[];
	}
	| {
		status: 'stale';
		reason: 'cutoff' | 'file-set' | 'missing' | 'content-hash' | 'version';
		paths: string[];
	}
	| {
		status: 'rejected';
		reason: 'invalid-preview' | 'non-audit-target';
		paths: string[];
	};

export interface ProposalHistoryRecord {
	path: string;
	proposalId: string;
	location: ProposalHistoryLocation;
	contentHash: string;
}

export type ProposalHistoryResolution =
	| {
		status: 'resolved';
		proposalId: string;
		record: ProposalHistoryRecord;
		matches: ProposalHistoryRecord[];
	}
	| {
		status: 'missing';
		proposalId: string;
		matches: [];
	}
	| {
		status: 'ambiguous';
		proposalId: string;
		matches: ProposalHistoryRecord[];
	};

export interface ProposalReferenceBackfillInput {
	referencePath: string;
	proposals: readonly ProposalHistoryRecord[];
	expectedReferenceHash?: string;
	currentReferenceHash?: string;
	managedRecord?: boolean;
}

export type ProposalReferenceBackfillPlan =
	| {
		status: 'ready';
		referencePath: string;
		proposalId: string;
		proposalPath: string;
		contentHash: string;
	}
	| {
		status: 'missing' | 'ambiguous' | 'stale' | 'unmanaged';
		referencePath: string;
		matches: ProposalHistoryRecord[];
	};

const normalizeProposalId = (value: string): string => value.trim();

export function auditShardPath(timestamp: string): string {
	const parsed = new Date(timestamp);
	if (!timestamp.trim() || Number.isNaN(parsed.getTime())) {
		throw new Error('Audit event timestamp must be a valid date.');
	}
	const day = parsed.toISOString().slice(0, 10);
	return `${TRACEKEEPER_AGENT_ACTIVITY_DIR}/${day.slice(0, 4)}/${day}.md`;
}

export function buildStableAuditEventId(
	event: StableAuditEventIdentity
): string {
	const {
		timestamp: _timestamp,
		auditEventId: _auditEventId,
		audit_event_id: _auditEventIdSnake,
		createdAt: _createdAt,
		created_at: _createdAtSnake,
		updatedAt: _updatedAt,
		updated_at: _updatedAtSnake,
		...identity
	} = event;
	if (
		typeof identity.operationId !== 'string'
		&& typeof identity.requestId !== 'string'
		&& typeof identity.invocationId !== 'string'
	) {
		throw new Error('Audit event identity requires an operation, request, or invocation id.');
	}
	return `audit-${computePayloadHash({
		schemaVersion: 1,
		identity,
	}).slice(0, 32)}`;
}

export function mergeAuditEvents<T extends MergeableAuditEvent>(
	events: readonly T[]
): T[] {
	const selected = new Map<string, T>();
	for (const event of events) {
		const auditEventId = event.auditEventId?.trim() || '';
		const key = auditEventId
			? `id:${auditEventId}`
			: `legacy:${computePayloadHash(auditMergeIdentity(event))}`;
		const existing = selected.get(key);
		if (!existing || compareAuditSourcePreference(event, existing) < 0) {
			selected.set(key, event);
		}
	}
	return [...selected.values()].sort(compareMergedAuditEvents);
}

export function buildAuditCleanupPreview(input: {
	cutoff: string | null;
	files: readonly AuditCleanupFileInput[];
}): AuditCleanupPreview {
	const cutoff = normalizeAuditCleanupCutoff(input.cutoff);
	const eligible: AuditCleanupPreviewFile[] = [];
	const retained: AuditCleanupRetainedFile[] = [];
	const seenPaths = new Set<string>();

	for (const file of input.files) {
		if (seenPaths.has(file.path)) {
			throw new Error(`Audit cleanup file path is duplicated: ${file.path}`);
		}
		seenPaths.add(file.path);
		const sourceKind = auditCleanupSourceKind(file.path);
		const eventTimes = normalizeAuditCleanupEventTimes(file.eventTimes);
		const row = {
			path: file.path,
			sourceKind,
			contentHash: file.contentHash,
			version: file.version,
			earliestEventTime: eventTimes?.[0] || null,
			latestEventTime: eventTimes?.[eventTimes.length - 1] || null,
			eventCount: file.eventTimes.length,
		};

		if (!sourceKind) {
			retained.push({ ...row, reason: 'non-audit' });
			continue;
		}
		if (cutoff === null) {
			eligible.push({ ...row, sourceKind });
			continue;
		}
		if (!eventTimes) {
			retained.push({
				...row,
				sourceKind,
				reason: 'empty-or-unparseable',
			});
			continue;
		}
		const cutoffTime = Date.parse(cutoff);
		const hasEligibleEvent = eventTimes.some(
			(timestamp) => Date.parse(timestamp) < cutoffTime
		);
		const hasRetainedEvent = eventTimes.some(
			(timestamp) => Date.parse(timestamp) >= cutoffTime
		);
		if (hasEligibleEvent && hasRetainedEvent) {
			retained.push({ ...row, sourceKind, reason: 'mixed-age' });
		} else if (hasRetainedEvent) {
			retained.push({ ...row, sourceKind, reason: 'too-new' });
		} else {
			eligible.push({ ...row, sourceKind });
		}
	}

	const preview = {
		schemaVersion: 1 as const,
		cutoff,
		eligiblePaths: eligible.map((file) => file.path),
		eligible,
		retained,
	};
	return {
		...preview,
		bindingHash: computePayloadHash(preview),
	};
}

export function validateAuditCleanupPreview(input: {
	preview: AuditCleanupPreview;
	cutoff: string | null;
	currentFiles: readonly AuditCleanupCurrentFile[];
}): AuditCleanupPreviewValidation {
	const {
		bindingHash,
		...previewPayload
	} = input.preview;
	if (
		!bindingHash
		|| bindingHash !== computePayloadHash(previewPayload)
	) {
		return {
			status: 'rejected',
			reason: 'invalid-preview',
			paths: input.preview.eligiblePaths,
		};
	}

	const previewPaths = input.preview.eligible.map((file) => file.path);
	const selectedPaths = input.preview.eligiblePaths;
	const retainedPaths = input.preview.retained.map((file) => file.path);
	const allPreviewPaths = [...previewPaths, ...retainedPaths];
	if (
		input.preview.schemaVersion !== 1
		|| selectedPaths.length !== previewPaths.length
		|| selectedPaths.some((path, index) => path !== previewPaths[index])
		|| new Set(allPreviewPaths).size !== allPreviewPaths.length
	) {
		return {
			status: 'rejected',
			reason: 'invalid-preview',
			paths: selectedPaths,
		};
	}

	const nonAuditPaths = input.preview.eligible
		.filter((file) =>
			auditCleanupSourceKind(file.path) !== file.sourceKind
		)
		.map((file) => file.path);
	if (nonAuditPaths.length > 0) {
		return {
			status: 'rejected',
			reason: 'non-audit-target',
			paths: nonAuditPaths,
		};
	}
	const invalidRetainedPaths = input.preview.retained
		.filter((file) => {
			const sourceKind = auditCleanupSourceKind(file.path);
			if (file.reason === 'non-audit') {
				return sourceKind !== null || file.sourceKind !== null;
			}
			return sourceKind === null || sourceKind !== file.sourceKind;
		})
		.map((file) => file.path);
	if (invalidRetainedPaths.length > 0) {
		return {
			status: 'rejected',
			reason: 'invalid-preview',
			paths: invalidRetainedPaths,
		};
	}

	let cutoff: string | null;
	try {
		cutoff = normalizeAuditCleanupCutoff(input.cutoff);
	} catch {
		return {
			status: 'stale',
			reason: 'cutoff',
			paths: [],
		};
	}
	if (cutoff !== input.preview.cutoff) {
		return {
			status: 'stale',
			reason: 'cutoff',
			paths: [],
		};
	}

	const currentByPath = new Map<string, AuditCleanupCurrentFile>();
	for (const file of input.currentFiles) {
		if (currentByPath.has(file.path)) {
			return {
				status: 'stale',
				reason: 'file-set',
				paths: [file.path],
			};
		}
		currentByPath.set(file.path, file);
	}
	const previewPathSet = new Set(allPreviewPaths);
	const addedPaths = input.currentFiles
		.filter((file) => !previewPathSet.has(file.path))
		.map((file) => file.path);
	if (addedPaths.length > 0) {
		return {
			status: 'stale',
			reason: 'file-set',
			paths: addedPaths,
		};
	}
	const previewFiles = [
		...input.preview.eligible,
		...input.preview.retained,
	];
	for (const file of previewFiles) {
		const current = currentByPath.get(file.path);
		if (!current) {
			return {
				status: 'stale',
				reason: 'missing',
				paths: [file.path],
			};
		}
		if (current.contentHash !== file.contentHash) {
			return {
				status: 'stale',
				reason: 'content-hash',
				paths: [file.path],
			};
		}
		if (current.version !== file.version) {
			return {
				status: 'stale',
				reason: 'version',
				paths: [file.path],
			};
		}
	}

	return {
		status: 'ready',
		files: input.preview.eligible.map((file) => ({ ...file })),
	};
}

const normalizeAuditCleanupCutoff = (
	cutoff: string | null
): string | null => {
	if (cutoff === null) {
		return null;
	}
	const parsed = new Date(cutoff);
	if (!cutoff.trim() || Number.isNaN(parsed.getTime())) {
		throw new Error('Audit cleanup cutoff must be a valid date or null.');
	}
	return parsed.toISOString();
};

const normalizeAuditCleanupEventTimes = (
	eventTimes: readonly string[]
): string[] | null => {
	if (eventTimes.length === 0) {
		return null;
	}
	const normalized: string[] = [];
	for (const timestamp of eventTimes) {
		const parsed = new Date(timestamp);
		if (!timestamp.trim() || Number.isNaN(parsed.getTime())) {
			return null;
		}
		normalized.push(parsed.toISOString());
	}
	return normalized.sort();
};

const auditCleanupSourceKind = (
	filePath: string
): AuditEventSourceKind | null => {
	if (filePath === LEGACY_TRACEKEEPER_AUDIT_LOG_PATH) {
		return 'legacy';
	}
	const escapedDirectory = TRACEKEEPER_AGENT_ACTIVITY_DIR.replace(
		/[.*+?^${}()|[\]\\]/g,
		'\\$&'
	);
	const match = filePath.match(
		new RegExp(
			`^${escapedDirectory}/(\\d{4})/(\\d{4}-\\d{2}-\\d{2})\\.md$`
		)
	);
	if (!match || match[1] !== match[2]?.slice(0, 4)) {
		return null;
	}
	try {
		return auditShardPath(`${match[2]}T00:00:00.000Z`) === filePath
			? 'shard'
			: null;
	} catch {
		return null;
	}
};

const auditMergeIdentity = (
	event: MergeableAuditEvent
): Record<string, unknown> => {
	const {
		sourcePath: _sourcePath,
		sourceKind: _sourceKind,
		auditEventId: _auditEventId,
		...identity
	} = event;
	return identity;
};

const compareAuditSourcePreference = (
	left: MergeableAuditEvent,
	right: MergeableAuditEvent
): number => {
	const leftRank = left.sourceKind === 'shard' ? 0 : 1;
	const rightRank = right.sourceKind === 'shard' ? 0 : 1;
	return leftRank - rightRank
		|| left.sourcePath.localeCompare(right.sourcePath)
		|| computePayloadHash(left).localeCompare(computePayloadHash(right));
};

const compareMergedAuditEvents = (
	left: MergeableAuditEvent,
	right: MergeableAuditEvent
): number => {
	const timestampOrder = (Date.parse(right.timestamp) || 0)
		- (Date.parse(left.timestamp) || 0);
	if (timestampOrder !== 0) {
		return timestampOrder;
	}
	const leftIdentity = left.auditEventId?.trim()
		|| computePayloadHash(auditMergeIdentity(left));
	const rightIdentity = right.auditEventId?.trim()
		|| computePayloadHash(auditMergeIdentity(right));
	return leftIdentity.localeCompare(rightIdentity)
		|| compareAuditSourcePreference(left, right);
};

export function buildStableProposalId(identity: string): string {
	const normalizedIdentity = identity.trim();
	if (!normalizedIdentity) {
		throw new Error('Proposal identity seed must not be empty.');
	}
	return `proposal-${computePayloadHash({
		schemaVersion: 1,
		identity: normalizedIdentity,
	}).slice(0, 24)}`;
}

const compareProposalHistoryRecords = (
	left: ProposalHistoryRecord,
	right: ProposalHistoryRecord
): number => left.path.localeCompare(right.path)
	|| left.proposalId.localeCompare(right.proposalId)
	|| left.contentHash.localeCompare(right.contentHash);

const normalizeProposalHistoryRecord = (
	record: ProposalHistoryRecord
): ProposalHistoryRecord => ({
	path: normalizeKnowledgePath(record.path),
	proposalId: normalizeProposalId(record.proposalId),
	location: record.location,
	contentHash: record.contentHash.trim(),
});

export function proposalHistoryLocation(path: string): ProposalHistoryLocation | null {
	const normalized = normalizeKnowledgePath(path);
	if (startsWithPathPrefix(normalized, TRACEKEEPER_REVIEW_QUEUE_DIR)) {
		return 'active';
	}
	if (startsWithPathPrefix(normalized, ARCHIVE_REVIEW_QUEUE_DIR)) {
		return 'archive';
	}
	return null;
}

export function resolveProposalHistoryById(
	records: readonly ProposalHistoryRecord[],
	proposalId: string
): ProposalHistoryResolution {
	const normalizedId = normalizeProposalId(proposalId);
	const matches = records
		.map(normalizeProposalHistoryRecord)
		.filter((record) => Boolean(normalizedId) && record.proposalId === normalizedId)
		.sort(compareProposalHistoryRecords);
	if (matches.length === 0) {
		return {
			status: 'missing',
			proposalId: normalizedId,
			matches: [],
		};
	}
	if (matches.length > 1) {
		return {
			status: 'ambiguous',
			proposalId: normalizedId,
			matches,
		};
	}
	return {
		status: 'resolved',
		proposalId: normalizedId,
		record: matches[0],
		matches,
	};
}

export function planProposalReferenceBackfill(
	input: ProposalReferenceBackfillInput
): ProposalReferenceBackfillPlan {
	const referencePath = normalizeKnowledgePath(input.referencePath);
	if (input.managedRecord === false) {
		return {
			status: 'unmanaged',
			referencePath,
			matches: [],
		};
	}
	if (
		input.expectedReferenceHash !== undefined
		&& input.currentReferenceHash !== undefined
		&& input.expectedReferenceHash !== input.currentReferenceHash
	) {
		return {
			status: 'stale',
			referencePath,
			matches: [],
		};
	}
	const matches = input.proposals
		.map(normalizeProposalHistoryRecord)
		.filter((record) => record.path === referencePath)
		.sort(compareProposalHistoryRecords);
	if (matches.length === 0 || matches.every((record) => !record.proposalId)) {
		return {
			status: 'missing',
			referencePath,
			matches,
		};
	}
	const distinctIds = new Set(matches.map((record) => record.proposalId).filter(Boolean));
	if (matches.length !== 1 || distinctIds.size !== 1) {
		return {
			status: 'ambiguous',
			referencePath,
			matches,
		};
	}
	const match = matches[0];
	return {
		status: 'ready',
		referencePath,
		proposalId: match.proposalId,
		proposalPath: match.path,
		contentHash: match.contentHash,
	};
}
