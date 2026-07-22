type ParsedRecordValue = string | string[];

type ParsedRecord = Record<string, ParsedRecordValue>;

export type MemoryProposalStatus =
	| 'pending'
	| 'approved'
	| 'rejected'
	| 'deferred'
	| 'revision_requested'
	| 'applied';

export type ReviewQueueItemType =
	| 'memory_proposal'
	| 'legacy_migration_review'
	| 'other_review_item';

export interface MemoryProposalRecord {
	path: string;
	classification: ReviewQueueItemType;
	proposalId: string;
	proposalKind: string;
	proposedBy: string;
	relatedProject: string;
	taskId: string;
	targetNote: string;
	evidence: string[];
	riskLevel: string;
	approvalStatus: MemoryProposalStatus;
	created: string;
	snippet: string;
	sortTimestamp: number;
	revisionComment: string;
	revisionRequestedAt: string;
	revisionRequestedBy: string;
	writebackContent: string;
}

interface MemoryProposalParseInput {
	filePath: string;
	fields: ParsedRecord;
	body: string;
	fileMtime?: number;
}

export const normalizeProposalStatus = (rawStatus?: string): MemoryProposalStatus => {
	const status = (rawStatus || 'pending').toLowerCase().trim();
	if (
		status === 'approved' ||
		status === 'rejected' ||
		status === 'deferred' ||
		status === 'revision_requested' ||
		status === 'applied'
	) {
		return status;
	}
	if (status === 'pending_review') {
		return 'pending';
	}
	return 'pending';
};

const firstString = (values: ParsedRecord, keys: string[]): string => {
	for (const key of keys) {
		const value = values[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
		if (Array.isArray(value)) {
			const first = value.find((entry) => Boolean(entry && entry.trim()));
			if (first) {
				return first;
			}
		}
	}
	return '';
};

const readStringList = (values: ParsedRecord, keys: string[]): string[] => {
	const items: string[] = [];
	for (const key of keys) {
		const value = values[key];
		if (!value) continue;
		if (Array.isArray(value)) {
			items.push(...value.filter(Boolean));
			continue;
		}
		items.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
	}
	return [...new Set(items)];
};

const readMultilineString = (values: ParsedRecord, keys: string[]): string => {
	for (const key of keys) {
		const value = values[key];
		if (Array.isArray(value)) {
			const joined = value.join('\n').trim();
			if (joined) {
				return joined;
			}
			continue;
		}
		if (typeof value === 'string' && value.trim()) {
			return value.replace(/\\n/g, '\n').trim();
		}
	}
	return '';
};

const trimText = (value: string, maxLength = 280): string => {
	const trimmed = value.trim();
	if (trimmed.length <= maxLength) {
		return trimmed;
	}
	return `${trimmed.slice(0, maxLength - 1)}…`;
};

const parseTimestamp = (timestamp: string | undefined, fallbackMs?: number): number => {
	if (timestamp) {
		const parsed = Date.parse(timestamp);
		if (!Number.isNaN(parsed)) {
			return parsed;
		}
	}
	if (fallbackMs) {
		return fallbackMs;
	}
	return 0;
};

const extractSectionText = (body: string, sectionNames: string[]): string => {
	const normalized = body.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const normalizedSectionNames = new Set(sectionNames.map((name) => name.trim().toLowerCase()));

	const isHeading = (line: string): string | null => {
		const match = line.match(/^\s*#{2,}\s*(.+?)\s*$/);
		return match ? match[1].trim().replace(/\s+/g, ' ').toLowerCase() : null;
	};

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const heading = isHeading(lines[lineIndex]);
		if (!heading || !normalizedSectionNames.has(heading)) {
			continue;
		}

		const contentLines: string[] = [];
		for (let nextIndex = lineIndex + 1; nextIndex < lines.length; nextIndex += 1) {
			if (isHeading(lines[nextIndex])) {
				break;
			}
			contentLines.push(lines[nextIndex]);
		}
		return contentLines.join('\n').trim();
	}
	return '';
};

const snippetFromText = (text: string, fallback: string = ''): string => {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.filter((line) => !line.startsWith('#'))
		.filter((line) => !line.startsWith('---'));

	const raw = lines.length > 0 ? lines[0] : trimText(fallback);
	return trimText(raw, 160);
};

export const compareProposalRecords = (a: MemoryProposalRecord, b: MemoryProposalRecord): number => {
	const statusRank: Record<MemoryProposalStatus, number> = {
		pending: 0,
		revision_requested: 1,
		approved: 2,
		applied: 3,
		deferred: 4,
		rejected: 5,
	};
	const rankA = statusRank[a.approvalStatus] ?? 1;
	const rankB = statusRank[b.approvalStatus] ?? 1;
	if (rankA !== rankB) {
		return rankA - rankB;
	}
	return b.sortTimestamp - a.sortTimestamp;
};

export const extractMemoryProposalWritebackContent = (data: ParsedRecord, body: string): string => {
	const frontmatterWriteback = readMultilineString(data, ['writeback_content', 'writebackContent']);
	if (frontmatterWriteback) {
		return frontmatterWriteback.replace(/\\n/g, '\n').trim();
	}
	return extractSectionText(body, ['Writeback', 'Approved writeback', 'Writeback content', '写回', '已批准写回', '写回内容']);
};

export const parseMemoryProposalRecord = ({
	filePath,
	fields,
	body,
	fileMtime,
}: MemoryProposalParseInput): MemoryProposalRecord | null => {
	const proposalType = firstString(fields, ['type']);
	const normalizedProposalType = proposalType.toLowerCase().replace(/_/g, '-');
	const proposalKind = firstString(fields, ['proposal_kind', 'proposalKind']);
	let classification: ReviewQueueItemType | null = null;
	if (normalizedProposalType.includes('memory-proposal')) {
		classification = 'memory_proposal';
	} else if (normalizedProposalType.includes('legacy-migration-review')) {
		classification = 'legacy_migration_review';
	} else if (proposalKind) {
		classification = proposalType ? 'other_review_item' : 'memory_proposal';
	}

	if (!classification) {
		return null;
	}

	const created = firstString(fields, ['created']);
	const proposalId = firstString(fields, ['proposal_id', 'proposalId'])
		|| filePath.split('/').pop() || '';
	const approvalStatus = normalizeProposalStatus(
		firstString(fields, ['approval_status', 'approvalStatus'])
	);
	const sortTimestamp = parseTimestamp(created, fileMtime);
	const revisionComment = readMultilineString(fields, ['revision_comment', 'revisionComment']);
	const revisionRequestedAt = firstString(fields, ['revision_requested_at', 'revisionRequestedAt']);
	const revisionRequestedBy = firstString(fields, ['revision_requested_by', 'revisionRequestedBy']);
	const writebackContent = extractMemoryProposalWritebackContent(fields, body);

	return {
		path: filePath,
		classification,
		proposalId,
		proposalKind: proposalKind || classification,
		proposedBy: firstString(fields, ['proposed_by', 'proposedBy']) || 'unknown',
		relatedProject: firstString(fields, ['related_project', 'relatedProject', 'project_hint', 'projectHint']) || '',
		taskId: firstString(fields, ['task_id', 'taskId']) || '',
		targetNote: firstString(fields, ['target_note', 'targetNote', 'target_path', 'targetPath']) || '',
		evidence: readStringList(fields, ['evidence']),
		riskLevel: firstString(fields, ['risk_level', 'riskLevel', 'risk']) || 'unknown',
		approvalStatus,
		created,
		snippet: snippetFromText(body, proposalId),
		revisionComment,
		revisionRequestedAt,
		revisionRequestedBy,
		writebackContent,
		sortTimestamp,
	};
};
