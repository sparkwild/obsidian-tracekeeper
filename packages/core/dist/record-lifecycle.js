"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditShardPath = auditShardPath;
exports.buildStableAuditEventId = buildStableAuditEventId;
exports.mergeAuditEvents = mergeAuditEvents;
exports.buildAuditCleanupPreview = buildAuditCleanupPreview;
exports.validateAuditCleanupPreview = validateAuditCleanupPreview;
exports.buildStableProposalId = buildStableProposalId;
exports.proposalHistoryLocation = proposalHistoryLocation;
exports.resolveProposalHistoryById = resolveProposalHistoryById;
exports.planProposalReferenceBackfill = planProposalReferenceBackfill;
const knowledge_architecture_1 = require("./knowledge-architecture");
const operation_journal_1 = require("./operation-journal");
const normalizeProposalId = (value) => value.trim();
function auditShardPath(timestamp) {
    const parsed = new Date(timestamp);
    if (!timestamp.trim() || Number.isNaN(parsed.getTime())) {
        throw new Error('Audit event timestamp must be a valid date.');
    }
    const day = parsed.toISOString().slice(0, 10);
    return `${knowledge_architecture_1.TRACEKEEPER_AGENT_ACTIVITY_DIR}/${day.slice(0, 4)}/${day}.md`;
}
function buildStableAuditEventId(event) {
    const { timestamp: _timestamp, auditEventId: _auditEventId, audit_event_id: _auditEventIdSnake, createdAt: _createdAt, created_at: _createdAtSnake, updatedAt: _updatedAt, updated_at: _updatedAtSnake, ...identity } = event;
    if (typeof identity.operationId !== 'string'
        && typeof identity.requestId !== 'string'
        && typeof identity.invocationId !== 'string') {
        throw new Error('Audit event identity requires an operation, request, or invocation id.');
    }
    return `audit-${(0, operation_journal_1.computePayloadHash)({
        schemaVersion: 1,
        identity,
    }).slice(0, 32)}`;
}
function mergeAuditEvents(events) {
    const selected = new Map();
    for (const event of events) {
        const auditEventId = event.auditEventId?.trim() || '';
        const key = auditEventId
            ? `id:${auditEventId}`
            : `legacy:${(0, operation_journal_1.computePayloadHash)(auditMergeIdentity(event))}`;
        const existing = selected.get(key);
        if (!existing || compareAuditSourcePreference(event, existing) < 0) {
            selected.set(key, event);
        }
    }
    return [...selected.values()].sort(compareMergedAuditEvents);
}
function buildAuditCleanupPreview(input) {
    const cutoff = normalizeAuditCleanupCutoff(input.cutoff);
    const eligible = [];
    const retained = [];
    const seenPaths = new Set();
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
        const hasEligibleEvent = eventTimes.some((timestamp) => Date.parse(timestamp) < cutoffTime);
        const hasRetainedEvent = eventTimes.some((timestamp) => Date.parse(timestamp) >= cutoffTime);
        if (hasEligibleEvent && hasRetainedEvent) {
            retained.push({ ...row, sourceKind, reason: 'mixed-age' });
        }
        else if (hasRetainedEvent) {
            retained.push({ ...row, sourceKind, reason: 'too-new' });
        }
        else {
            eligible.push({ ...row, sourceKind });
        }
    }
    const preview = {
        schemaVersion: 1,
        cutoff,
        eligiblePaths: eligible.map((file) => file.path),
        eligible,
        retained,
    };
    return {
        ...preview,
        bindingHash: (0, operation_journal_1.computePayloadHash)(preview),
    };
}
function validateAuditCleanupPreview(input) {
    const { bindingHash, ...previewPayload } = input.preview;
    if (!bindingHash
        || bindingHash !== (0, operation_journal_1.computePayloadHash)(previewPayload)) {
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
    if (input.preview.schemaVersion !== 1
        || selectedPaths.length !== previewPaths.length
        || selectedPaths.some((path, index) => path !== previewPaths[index])
        || new Set(allPreviewPaths).size !== allPreviewPaths.length) {
        return {
            status: 'rejected',
            reason: 'invalid-preview',
            paths: selectedPaths,
        };
    }
    const nonAuditPaths = input.preview.eligible
        .filter((file) => auditCleanupSourceKind(file.path) !== file.sourceKind)
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
    let cutoff;
    try {
        cutoff = normalizeAuditCleanupCutoff(input.cutoff);
    }
    catch {
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
    const currentByPath = new Map();
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
const normalizeAuditCleanupCutoff = (cutoff) => {
    if (cutoff === null) {
        return null;
    }
    const parsed = new Date(cutoff);
    if (!cutoff.trim() || Number.isNaN(parsed.getTime())) {
        throw new Error('Audit cleanup cutoff must be a valid date or null.');
    }
    return parsed.toISOString();
};
const normalizeAuditCleanupEventTimes = (eventTimes) => {
    if (eventTimes.length === 0) {
        return null;
    }
    const normalized = [];
    for (const timestamp of eventTimes) {
        const parsed = new Date(timestamp);
        if (!timestamp.trim() || Number.isNaN(parsed.getTime())) {
            return null;
        }
        normalized.push(parsed.toISOString());
    }
    return normalized.sort();
};
const auditCleanupSourceKind = (filePath) => {
    if (filePath === knowledge_architecture_1.LEGACY_TRACEKEEPER_AUDIT_LOG_PATH) {
        return 'legacy';
    }
    const escapedDirectory = knowledge_architecture_1.TRACEKEEPER_AGENT_ACTIVITY_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = filePath.match(new RegExp(`^${escapedDirectory}/(\\d{4})/(\\d{4}-\\d{2}-\\d{2})\\.md$`));
    if (!match || match[1] !== match[2]?.slice(0, 4)) {
        return null;
    }
    try {
        return auditShardPath(`${match[2]}T00:00:00.000Z`) === filePath
            ? 'shard'
            : null;
    }
    catch {
        return null;
    }
};
const auditMergeIdentity = (event) => {
    const { sourcePath: _sourcePath, sourceKind: _sourceKind, auditEventId: _auditEventId, ...identity } = event;
    return identity;
};
const compareAuditSourcePreference = (left, right) => {
    const leftRank = left.sourceKind === 'shard' ? 0 : 1;
    const rightRank = right.sourceKind === 'shard' ? 0 : 1;
    return leftRank - rightRank
        || left.sourcePath.localeCompare(right.sourcePath)
        || (0, operation_journal_1.computePayloadHash)(left).localeCompare((0, operation_journal_1.computePayloadHash)(right));
};
const compareMergedAuditEvents = (left, right) => {
    const timestampOrder = (Date.parse(right.timestamp) || 0)
        - (Date.parse(left.timestamp) || 0);
    if (timestampOrder !== 0) {
        return timestampOrder;
    }
    const leftIdentity = left.auditEventId?.trim()
        || (0, operation_journal_1.computePayloadHash)(auditMergeIdentity(left));
    const rightIdentity = right.auditEventId?.trim()
        || (0, operation_journal_1.computePayloadHash)(auditMergeIdentity(right));
    return leftIdentity.localeCompare(rightIdentity)
        || compareAuditSourcePreference(left, right);
};
function buildStableProposalId(identity) {
    const normalizedIdentity = identity.trim();
    if (!normalizedIdentity) {
        throw new Error('Proposal identity seed must not be empty.');
    }
    return `proposal-${(0, operation_journal_1.computePayloadHash)({
        schemaVersion: 1,
        identity: normalizedIdentity,
    }).slice(0, 24)}`;
}
const compareProposalHistoryRecords = (left, right) => left.path.localeCompare(right.path)
    || left.proposalId.localeCompare(right.proposalId)
    || left.contentHash.localeCompare(right.contentHash);
const normalizeProposalHistoryRecord = (record) => ({
    path: (0, knowledge_architecture_1.normalizeKnowledgePath)(record.path),
    proposalId: normalizeProposalId(record.proposalId),
    location: record.location,
    contentHash: record.contentHash.trim(),
});
function proposalHistoryLocation(path) {
    const normalized = (0, knowledge_architecture_1.normalizeKnowledgePath)(path);
    if ((0, knowledge_architecture_1.startsWithPathPrefix)(normalized, knowledge_architecture_1.TRACEKEEPER_REVIEW_QUEUE_DIR)) {
        return 'active';
    }
    if ((0, knowledge_architecture_1.startsWithPathPrefix)(normalized, knowledge_architecture_1.ARCHIVE_REVIEW_QUEUE_DIR)) {
        return 'archive';
    }
    return null;
}
function resolveProposalHistoryById(records, proposalId) {
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
function planProposalReferenceBackfill(input) {
    const referencePath = (0, knowledge_architecture_1.normalizeKnowledgePath)(input.referencePath);
    if (input.managedRecord === false) {
        return {
            status: 'unmanaged',
            referencePath,
            matches: [],
        };
    }
    if (input.expectedReferenceHash !== undefined
        && input.currentReferenceHash !== undefined
        && input.expectedReferenceHash !== input.currentReferenceHash) {
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
