import crypto from 'node:crypto';
import { parseMarkdown } from './markdown';
import type { ProposalFrontmatterMutationValue } from './proposal-transition';
import { parseTaskRecord, taskReferenceFields, makeTaskRelation, updateTaskRelations, patchTaskMetadata, legacyTaskReferenceList, type TaskTargetKind } from './task-record';
const hashText = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');
const readFrontmatterStringList = (fields: Record<string, unknown>, key: string): string[] => fields.task_record_version !== undefined && Array.isArray(fields[key]) ? (fields[key] as unknown[]).map(String) : legacyTaskReferenceList(fields[key]);
function mergeFrontmatterList(fields: Record<string, unknown>, key: string, values: string[]): string { return [...new Set([...readFrontmatterStringList(fields, key), ...values.map((value) => value.trim()).filter(Boolean)])].join(', '); }
export interface ApprovedWritebackTaskLinkPlanInput {
	taskContent: string;
	operationId?: string;
	targetIdentity?: { kind: TaskTargetKind; id: string | null };
	targetPath: string;
	proposalId: string;
	proposalPath: string;
	usesStableProposalReferences: boolean;
	usesAppliedProposalEvidence: boolean;
}

export interface ApprovedWritebackTaskLinkPlan {
	content: string;
	contentHashBefore: string;
	contentHashAfter: string;
	hadTargetReference: boolean;
	hadProposalReference: boolean;
	hadProposalIdReference: boolean;
	hadProposalPathEvidence: boolean;
	hadAppliedProposalReference: boolean;
}

/**
 * 规划一次 approved writeback 对任务引用的确定性更新。
 *
 * @description 批次预览和 Runtime 写回必须复用此函数，确保逐项任务哈希链与实际持久化内容完全一致。
 */
export function planApprovedWritebackTaskLink(
	input: ApprovedWritebackTaskLinkPlanInput
): ApprovedWritebackTaskLinkPlan {
	const original = parseMarkdown(input.taskContent).frontmatter.fields;
	const task = parseTaskRecord(original);
	const frontmatter = taskReferenceFields(original);
	const memoryWrites = new Set(readFrontmatterStringList(frontmatter, 'memory_writes'));
	const proposalIds = new Set(readFrontmatterStringList(frontmatter, 'proposal_ids'));
	const proposalPaths = new Set(readFrontmatterStringList(frontmatter, 'proposal_paths'));
	const appliedProposalIds = new Set(
		readFrontmatterStringList(frontmatter, 'durable_output_applied_proposal_ids')
	);
	const legacyProposals = new Set(readFrontmatterStringList(frontmatter, 'proposals'));
	const hadProposalReference = input.usesStableProposalReferences
		? proposalIds.has(input.proposalId)
		: legacyProposals.has(input.proposalPath);
	const hadProposalPathEvidence = input.usesStableProposalReferences
		? proposalPaths.has(input.proposalPath)
		: true;
	const hadAppliedProposalReference = input.usesAppliedProposalEvidence
		? appliedProposalIds.has(input.proposalId)
		: true;
	const needsUpdate = !memoryWrites.has(input.targetPath)
		|| !hadProposalReference
		|| !hadProposalPathEvidence
		|| !hadAppliedProposalReference;
	if (task) {
		const target = makeTaskRelation({ taskId: task.task_id, role: 'written_output', path: input.targetPath, operationId: input.operationId });
		target.target_kind = input.targetIdentity?.kind ?? 'unknown';
		target.target_id = input.targetIdentity?.id ?? null;
		target.relation_id = `relation-${hashText(JSON.stringify([task.task_id, 'written_output', input.operationId || null, input.proposalId])).slice(0, 32)}`;
		const proposal = makeTaskRelation({ taskId: task.task_id, role: 'review_proposal', path: input.proposalPath, proposalId: input.proposalId });
		let content = updateTaskRelations(input.taskContent, [target, ...(!task.relations.some((row) => row.role === 'review_proposal' && row.target_id === input.proposalId) ? [proposal] : [])]);
		if (input.usesAppliedProposalEvidence && !hadAppliedProposalReference) content = patchTaskMetadata(content, { durable_output_applied_proposal_ids: [...appliedProposalIds, input.proposalId] });
		return { content, contentHashBefore: hashText(input.taskContent), contentHashAfter: hashText(content), hadTargetReference: memoryWrites.has(input.targetPath), hadProposalReference, hadProposalIdReference: proposalIds.has(input.proposalId), hadProposalPathEvidence, hadAppliedProposalReference };
	}
	const content = needsUpdate
		? updateFrontmatterFields(
			input.taskContent,
			input.usesStableProposalReferences
				? {
					memory_writes: mergeFrontmatterList(frontmatter, 'memory_writes', [input.targetPath]),
					proposal_ids: mergeFrontmatterList(frontmatter, 'proposal_ids', [input.proposalId]),
					proposal_paths: mergeFrontmatterList(frontmatter, 'proposal_paths', [input.proposalPath]),
					...(input.usesAppliedProposalEvidence
						? {
							durable_output_applied_proposal_ids: mergeFrontmatterList(
								frontmatter,
								'durable_output_applied_proposal_ids',
								[input.proposalId]
							),
						}
						: {}),
				}
				: {
					memory_writes: mergeFrontmatterList(frontmatter, 'memory_writes', [input.targetPath]),
					proposals: mergeFrontmatterList(frontmatter, 'proposals', [input.proposalPath]),
				}
		)
		: input.taskContent;
	return {
		content,
		contentHashBefore: hashText(input.taskContent),
		contentHashAfter: hashText(content),
		hadTargetReference: memoryWrites.has(input.targetPath),
		hadProposalReference,
		hadProposalIdReference: proposalIds.has(input.proposalId),
		hadProposalPathEvidence,
		hadAppliedProposalReference,
	};
}

function formatFrontmatterUpdateValue(value: string | string[]): string {
	if (Array.isArray(value)) {
		return JSON.stringify(value);
	}
	if (/^[A-Za-z0-9._/-]+$/.test(value)) {
		return value;
	}
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function updateFrontmatterFields(
	content: string,
	fields: Readonly<Record<string, ProposalFrontmatterMutationValue>>
): string {
	const normalized = content.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const renderedFields = Object.entries(fields)
		.filter((entry): entry is [string, string | string[]] => entry[1] !== null)
		.map(([key, value]) => `${key}: ${formatFrontmatterUpdateValue(value)}`);

	if (lines.length === 0 || lines[0].trim() !== '---') {
		return ['---', ...renderedFields, '---', normalized].join('\n');
	}

	let end = -1;
	for (let index = 1; index < lines.length; index += 1) {
		if (lines[index].trim() === '---') {
			end = index;
			break;
		}
	}
	if (end < 0) {
		return ['---', ...renderedFields, '---', normalized].join('\n');
	}

	const pending = new Map(Object.entries(fields));
	const rootIndent = lines.slice(1, end).find((line) => /^\s*[^\s:#-][^:#]*:/.test(line))?.match(/^\s*/)?.[0] ?? '';
	let replacingValue = false;
	const frontmatterLines = lines.slice(1, end).flatMap((line) => {
		const indent = line.match(/^\s*/)?.[0].length ?? 0;
		if (replacingValue && (indent > rootIndent.length || /^\s*-\s/.test(line))) return [];
		const pair = line.match(/^(\s*)([^\s:#][^:#]*):\s*(.*)$/);
		if (!pair || pair[1] !== rootIndent) {
			return [line];
		}
		replacingValue = false;
		const key = pair[2]?.trim() || '';
		if (!pending.has(key)) {
			return [line];
		}
		const nextValue = pending.get(key);
		pending.delete(key);
		replacingValue = true;
		return nextValue === null || nextValue === undefined
			? []
			: [`${rootIndent}${key}: ${formatFrontmatterUpdateValue(nextValue)}`];
	});

	for (const [key, value] of pending) {
		if (value !== null) {
			frontmatterLines.push(`${rootIndent}${key}: ${formatFrontmatterUpdateValue(value)}`);
		}
	}

	return ['---', ...frontmatterLines, '---', ...lines.slice(end + 1)].join('\n');
}
