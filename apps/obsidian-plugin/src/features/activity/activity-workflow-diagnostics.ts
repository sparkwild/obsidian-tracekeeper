import type { AgentWorkflowDiagnostics, AuditEventRecord } from './activity-model';

const AGED_WORKFLOW_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_PRINCIPAL_LIMIT = 5;

const WORKFLOW_CHAIN_TOOLS = {
	start: 'tracekeeper.start_task',
	recall: 'tracekeeper.recall',
	finish: 'tracekeeper.finish_task',
	read: 'tracekeeper.read_note',
} as const;

export const workflowDiagnosticsAgeWindowMs = AGED_WORKFLOW_WINDOW_MS;

export const buildAgentWorkflowDiagnostics = (
	events: readonly AuditEventRecord[],
	now = Date.now()
): AgentWorkflowDiagnostics => {
	const safeEvents = events.filter((event) => Number.isFinite(event.sortTimestamp) && event.sortTimestamp > 0);
	const sortedEvents = [...safeEvents].sort((left, right) => left.sortTimestamp - right.sortTimestamp);
	const starts = sortedEvents.filter((event) => event.toolName === WORKFLOW_CHAIN_TOOLS.start);
	const recalls = sortedEvents.filter((event) => event.toolName === WORKFLOW_CHAIN_TOOLS.recall);
	const finishes = sortedEvents.filter((event) => event.toolName === WORKFLOW_CHAIN_TOOLS.finish);
	const reads = sortedEvents.filter((event) => event.toolName === WORKFLOW_CHAIN_TOOLS.read);
	const successfulStarts = uniqueWorkflowEvents(starts.filter(isToolSuccess));
	const successfulRecalls = uniqueRecallEvents(recalls.filter(isToolSuccess));

	const startToRecallCount = successfulStarts.filter((start) => {
		const key = workflowLookupId(start);
		if (!key) return false;
		return recalls.some((recall) =>
			isWorkflowMatch(start, recall, key)
			&& recall.sortTimestamp >= start.sortTimestamp
			&& isToolSuccess(recall)
		);
	}).length;

	const recallToReadCount = successfulRecalls.filter((recall) => {
		return reads.some((read) => {
			if (!isToolSuccess(read)) return false;
			if (read.sortTimestamp < recall.sortTimestamp) return false;
			if (!isWorkflowContextMatch(read, recall)) return false;
			if (recall.recallId && read.recallId) return recall.recallId === read.recallId;
			const recallWorkflow = recall.workflowId || recall.taskId;
			const readWorkflow = read.workflowId || read.taskId;
			return Boolean(recallWorkflow && readWorkflow && recallWorkflow === readWorkflow);
		});
	}).length;

	const startToFinishCount = successfulStarts.filter((start) => {
		const key = workflowLookupId(start);
		if (!key) return false;
		return finishes.some((finish) =>
			isWorkflowMatch(start, finish, key)
			&& finish.sortTimestamp >= start.sortTimestamp
			&& isToolSuccess(finish)
		);
	}).length;

	const startWorkflows = new Map<string, AuditEventRecord>();
	for (const start of successfulStarts) {
		const key = workflowContextKey(start);
		if (!key || startWorkflows.has(key)) continue;
		startWorkflows.set(key, start);
	}

	let activeWorkflowCount = 0;
	let agedWorkflowCount = 0;
	for (const start of startWorkflows.values()) {
		const key = workflowLookupId(start);
		if (!key) continue;
		const hasFinish = finishes.some((finish) =>
			isWorkflowMatch(start, finish, key) && isToolSuccess(finish) && finish.sortTimestamp >= start.sortTimestamp
		);
		if (hasFinish) continue;
		activeWorkflowCount += 1;
		if (now - start.sortTimestamp > AGED_WORKFLOW_WINDOW_MS) {
			agedWorkflowCount += 1;
		}
	}

	const permissionDeniedCount = safeEvents.filter((event) =>
		isToolFailure(event) && isPermissionDeniedEvent(event)
	).length;

	const zeroMatchRecallCount = recalls.filter((event) => (
		isToolSuccess(event)
		&& parseNumeric(event.matchedCount) === 0
	)).length;

	const closeoutStatusDistribution: Record<string, number> = {};
	for (const finish of finishes) {
		const status = finish.memoryCloseoutStatus || (isToolFailure(finish) ? 'failed' : 'missing');
		closeoutStatusDistribution[status] = (closeoutStatusDistribution[status] ?? 0) + 1;
	}

	const workflowDurations = safeEvents
		.filter((event) => event.toolName.startsWith('tracekeeper.') && isNumericField(event.durationMs))
		.map((event) => Number.parseFloat(event.durationMs))
		.filter((value) => Number.isFinite(value) && value >= 0);

	const durationP50Ms = workflowDurations.length > 0 ? percentile(workflowDurations, 0.5) : null;
	const durationP95Ms = workflowDurations.length > 0 ? percentile(workflowDurations, 0.95) : null;

	const recentPrincipals = extractRecentPrincipals(safeEvents);

	return {
		activeWorkflowCount,
		agedWorkflowCount,
		successfulStartCount: successfulStarts.length,
		successfulRecallCount: successfulRecalls.length,
		startToRecallCount,
		recallToReadCount,
		startToFinishCount,
		permissionDeniedCount,
		zeroMatchRecallCount,
		closeoutStatusDistribution,
		durationP50Ms,
		durationP95Ms,
		recentPrincipals,
	};
};

function workflowLookupId(event: AuditEventRecord): string {
	const candidate = event.workflowId || event.taskId || event.recallId;
	return candidate.trim();
}

function workflowContextKey(event: AuditEventRecord): string {
	const eventKey = workflowLookupId(event);
	const principal = event.principalId || event.clientName;
	if (!eventKey) {
		return '';
	}
	return principal ? `${principal}::${eventKey}` : eventKey;
}

function uniqueWorkflowEvents(events: readonly AuditEventRecord[]): AuditEventRecord[] {
	const unique = new Map<string, AuditEventRecord>();
	for (const event of events) {
		const key = workflowContextKey(event);
		if (key && !unique.has(key)) unique.set(key, event);
	}
	return [...unique.values()];
}

function uniqueRecallEvents(events: readonly AuditEventRecord[]): AuditEventRecord[] {
	const unique = new Map<string, AuditEventRecord>();
	for (const event of events) {
		const principal = event.principalId || event.clientName;
		const recallKey = event.recallId || workflowLookupId(event);
		if (!recallKey) continue;
		const key = principal ? `${principal}::${recallKey}` : recallKey;
		if (!unique.has(key)) unique.set(key, event);
	}
	return [...unique.values()];
}

function isToolSuccess(event: AuditEventRecord): boolean {
	const status = event.resultStatus.toLowerCase().trim();
	return status === 'success' || status === 'ok' || status === 'written';
}

function isToolFailure(event: AuditEventRecord): boolean {
	return !isToolSuccess(event);
}

function isPermissionDeniedEvent(event: AuditEventRecord): boolean {
	const reason = [event.reason, event.resultSummary, event.actionReasonCode, event.riskLevel, event.argsSummary]
		.join(' ')
		.toLowerCase();
	if (event.actionReasonCode === 'permission_denied' || event.actionReasonCode === 'permission:denied') {
		return true;
	}
	return reason.includes('permission denied') || reason.includes('permission denied:') || reason.includes('forbidden');
}

function isWorkflowMatch(left: AuditEventRecord, right: AuditEventRecord, expectedKey: string): boolean {
	if (!isWorkflowContextMatch(left, right)) {
		return false;
	}
	return workflowLookupId(left) === expectedKey && workflowLookupId(right) === expectedKey;
}

function isWorkflowContextMatch(left: AuditEventRecord, right: AuditEventRecord): boolean {
	if (!left.principalId || !right.principalId) return true;
	return left.principalId === right.principalId;
}

function isNumericField(value: string): boolean {
	return value !== '' && value !== 'NaN';
}

function parseNumeric(value: string): number | null {
	if (!isNumericField(value)) {
		return null;
	}
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values: number[], ratio: number): number {
	const sorted = [...values].sort((left, right) => left - right);
	const clampedRatio = Math.max(0, Math.min(1, ratio));
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * clampedRatio) - 1));
	return sorted[index];
}

function extractRecentPrincipals(events: readonly AuditEventRecord[]): string[] {
	const principals = new Map<string, number>();
	for (const event of [...events].sort((left, right) => right.sortTimestamp - left.sortTimestamp)) {
		const principal = event.principalId || '';
		if (!principal) {
			continue;
		}
		if (!principals.has(principal)) {
			principals.set(principal, event.sortTimestamp);
		}
		if (principals.size >= RECENT_PRINCIPAL_LIMIT) {
			break;
		}
	}
	return Array.from(principals.keys());
}

export const buildAgentWorkflowDiagnosticsTestHelpers = {
	workflowLookupId,
	parseNumeric,
	percentile,
};
