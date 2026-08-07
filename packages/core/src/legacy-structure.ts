import {
	KNOWLEDGE_INDEX_PATH,
	KNOWLEDGE_MEMORY_INDEX_PATH,
	KNOWLEDGE_SOURCES_INDEX_PATH,
	KNOWLEDGE_WIKI_HUBS_INDEX_PATH,
	LEGACY_TOP_LEVEL_DIRS,
	TRACEKEEPER_REVIEW_QUEUE_DIR,
} from './knowledge-architecture';

export type LegacyStructureKind =
	| 'control'
	| 'dashboard'
	| 'review_queue'
	| 'agent_request'
	| 'task'
	| 'session'
	| 'source'
	| 'memory_global'
	| 'memory_project'
	| 'wiki_concept'
	| 'wiki_claim'
	| 'wiki_guide'
	| 'context_pack'
	| 'source_analysis'
	| 'archive'
	| 'archive_report'
	| 'archive_summary'
	| 'archive_output';

export interface LegacyStructureTarget {
	oldPath: string;
	newPath: string;
	kind: LegacyStructureKind;
}

export interface LegacyStructureReviewInput {
	migrationId: string;
	oldPath: string;
	newPath: string;
	kind: LegacyStructureKind;
	reason: string;
	sourceContent: string;
	sourceHash?: string;
	targetHash?: string | null;
}

export function isLegacyStructurePath(relativePath: string): boolean {
	const normalized = normalizeLegacyPath(relativePath);
	return LEGACY_TOP_LEVEL_DIRS.some(
		(root) => normalized === root || normalized.startsWith(`${root}/`)
	);
}

export function getLegacyStructureTarget(relativePath: string): LegacyStructureTarget | null {
	const oldPath = normalizeLegacyPath(relativePath);
	if (oldPath.startsWith('00_control/dashboards/')) {
		return target(oldPath, oldPath.replace(/^00_control\/dashboards\//, '00_tracekeeper/control/dashboards/'), 'dashboard');
	}
	if (oldPath.startsWith('00_control/')) {
		return target(oldPath, oldPath.replace(/^00_control\//, '00_tracekeeper/control/'), 'control');
	}
	if (oldPath.startsWith('01_inbox/review_queue/')) {
		return target(oldPath, oldPath.replace(/^01_inbox\/review_queue\//, `${TRACEKEEPER_REVIEW_QUEUE_DIR}/`), 'review_queue');
	}
	if (oldPath.startsWith('01_inbox/agent_requests/')) {
		return target(oldPath, oldPath.replace(/^01_inbox\/agent_requests\//, '00_tracekeeper/inbox/agent_requests/'), 'agent_request');
	}
	if (oldPath.startsWith('01_inbox/')) {
		return target(oldPath, oldPath.replace(/^01_inbox\//, '00_tracekeeper/inbox/'), 'agent_request');
	}
	if (oldPath.startsWith('02_timeline/agent_tasks/')) {
		return target(oldPath, oldPath.replace(/^02_timeline\/agent_tasks\//, '00_tracekeeper/work/tasks/'), 'task');
	}
	if (oldPath.startsWith('02_timeline/sessions/')) {
		return target(oldPath, oldPath.replace(/^02_timeline\/sessions\//, '00_tracekeeper/work/sessions/'), 'session');
	}
	if (oldPath.startsWith('02_timeline/daily_notes/')) {
		return target(oldPath, oldPath.replace(/^02_timeline\/daily_notes\//, '02_archive/daily_notes/'), 'archive');
	}
	if (oldPath.startsWith('02_timeline/weekly_reviews/')) {
		return target(oldPath, oldPath.replace(/^02_timeline\/weekly_reviews\//, '02_archive/weekly_reviews/'), 'archive');
	}
	if (oldPath.startsWith('02_timeline/')) {
		return target(oldPath, oldPath.replace(/^02_timeline\//, '00_tracekeeper/work/timeline/'), 'archive');
	}
	if (oldPath.startsWith('03_sources/')) {
		return target(oldPath, oldPath.replace(/^03_sources\//, '01_knowledge/sources/'), 'source');
	}
	if (oldPath.startsWith('04_memory/concepts/')) {
		return target(oldPath, oldPath.replace(/^04_memory\/concepts\//, '01_knowledge/wiki/concepts/'), 'wiki_concept');
	}
	if (oldPath.startsWith('04_memory/claims/')) {
		return target(oldPath, oldPath.replace(/^04_memory\/claims\//, '01_knowledge/wiki/claims/'), 'wiki_claim');
	}
	if (oldPath.startsWith('04_memory/procedures/')) {
		return target(oldPath, oldPath.replace(/^04_memory\/procedures\//, '01_knowledge/wiki/guides/'), 'wiki_guide');
	}
	if (oldPath.startsWith('04_memory/preferences/')) {
		return target(oldPath, oldPath.replace(/^04_memory\/preferences\//, '01_knowledge/memory/global/preferences/'), 'memory_global');
	}
	if (oldPath.startsWith('04_memory/reflections/')) {
		return target(oldPath, oldPath.replace(/^04_memory\/reflections\//, '01_knowledge/memory/global/reflections/'), 'memory_global');
	}
	if (oldPath.startsWith('04_memory/')) {
		return target(oldPath, oldPath.replace(/^04_memory\//, '01_knowledge/memory/global/'), 'memory_global');
	}
	if (oldPath.startsWith('04_projects/')) {
		return target(oldPath, oldPath.replace(/^04_projects\//, '01_knowledge/memory/projects/'), 'memory_project');
	}
	if (oldPath.startsWith('05_memory/')) {
		return target(oldPath, oldPath.replace(/^05_memory\//, '01_knowledge/memory/global/'), 'memory_global');
	}
	if (oldPath.startsWith('05_projects/')) {
		return target(oldPath, oldPath.replace(/^05_projects\//, '01_knowledge/memory/projects/'), 'memory_project');
	}
	if (oldPath.startsWith('06_outputs/context_packs/')) {
		return target(oldPath, oldPath.replace(/^06_outputs\/context_packs\//, '00_tracekeeper/work/context_packs/'), 'context_pack');
	}
	if (oldPath.startsWith('06_outputs/source_analysis/')) {
		return target(oldPath, oldPath.replace(/^06_outputs\/source_analysis\//, '00_tracekeeper/work/source_analysis/'), 'source_analysis');
	}
	if (oldPath.startsWith('06_outputs/reports/')) {
		return target(oldPath, oldPath.replace(/^06_outputs\/reports\//, '02_archive/reports/'), 'archive_report');
	}
	if (oldPath.startsWith('06_outputs/summaries/')) {
		return target(oldPath, oldPath.replace(/^06_outputs\/summaries\//, '02_archive/summaries/'), 'archive_summary');
	}
	if (oldPath.startsWith('06_outputs/')) {
		return target(oldPath, oldPath.replace(/^06_outputs\//, '02_archive/outputs/'), 'archive_output');
	}
	if (oldPath.startsWith('07_archive/')) {
		return target(oldPath, oldPath.replace(/^07_archive\//, '02_archive/'), 'archive');
	}
	return null;
}

export function enrichLegacyMarkdownContent(
	content: string,
	input: {
		migrationId: string;
		oldPath: string;
		newPath: string;
		kind: LegacyStructureKind;
	}
): string {
	let next = content.replace(/\s+$/u, '') + '\n';
	if (!next.includes('## Tracekeeper migration')) {
		next += `\n## Tracekeeper migration\n\n- Migrated from: \`${input.oldPath}\`\n- Migration id: \`${input.migrationId}\`\n`;
	}
	if (isMemoryKind(input.kind) && !next.includes('## Graph links')) {
		next += `\n## Graph links\n\n- ${noteLink(KNOWLEDGE_INDEX_PATH, 'Knowledge index')}\n- ${noteLink(KNOWLEDGE_WIKI_HUBS_INDEX_PATH, 'Wiki hubs')}\n`;
	}
	if (isWikiKind(input.kind) && !next.includes('## Related memory')) {
		next += `\n## Related memory\n\n- ${noteLink(KNOWLEDGE_MEMORY_INDEX_PATH, 'Memory index')}\n- ${noteLink(KNOWLEDGE_WIKI_HUBS_INDEX_PATH, 'Wiki hubs')}\n`;
	}
	if (input.kind === 'source' && !next.includes('## Related knowledge')) {
		next += `\n## Related knowledge\n\n- ${noteLink(KNOWLEDGE_INDEX_PATH, 'Knowledge index')}\n- ${noteLink(KNOWLEDGE_SOURCES_INDEX_PATH, 'Sources index')}\n`;
	}
	if (input.kind === 'memory_project') {
		const project = input.newPath.split('/')[3];
		if (project && !next.includes(`01_knowledge/memory/projects/${project}/index`)) {
			next += `\n## Project index\n\n- ${noteLink(`01_knowledge/memory/projects/${project}/index.md`, project)}\n`;
		}
	}
	return next;
}

export function buildLegacyMigrationReviewPath(migrationId: string, oldPath: string): string {
	return `${TRACEKEEPER_REVIEW_QUEUE_DIR}/${migrationId}_${safeReviewName(oldPath)}.md`;
}

export function renderLegacyMigrationReview(input: LegacyStructureReviewInput): string {
	const excerpt = input.sourceContent.slice(0, 2000).replace(/```/g, "'''");
	return [
		'---',
		'type: legacy_migration_review',
		'status: pending',
		'risk: medium',
		`source_path: ${JSON.stringify(input.oldPath)}`,
		`target_path: ${JSON.stringify(input.newPath)}`,
		`migration_id: ${JSON.stringify(input.migrationId)}`,
		`source_hash: ${JSON.stringify(input.sourceHash ?? 'unavailable')}`,
		`target_hash: ${JSON.stringify(input.targetHash ?? 'missing')}`,
		'---',
		'',
		'# Legacy migration review',
		'',
		`- Reason: ${input.reason}`,
		`- Suggested target: \`${input.newPath}\``,
		`- Source: \`${input.oldPath}\``,
		`- Kind: \`${input.kind}\``,
		'',
		'## Evidence excerpt',
		'',
		'```markdown',
		excerpt,
		'```',
		'',
	].join('\n');
}

export function safeReviewName(value: string): string {
	return normalizeLegacyPath(value)
		.replace(/\.md$/i, '')
		.replace(/[^a-zA-Z0-9_-]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 120) || 'legacy_item';
}

function target(oldPath: string, newPath: string, kind: LegacyStructureKind): LegacyStructureTarget {
	return {
		oldPath,
		newPath: normalizeLegacyPath(newPath),
		kind,
	};
}

function normalizeLegacyPath(value: string): string {
	return value.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function isMemoryKind(kind: LegacyStructureKind): boolean {
	return kind === 'memory_global' || kind === 'memory_project';
}

function isWikiKind(kind: LegacyStructureKind): boolean {
	return kind === 'wiki_concept' || kind === 'wiki_claim' || kind === 'wiki_guide';
}

function noteLink(relativePath: string, label: string): string {
	return `[[${relativePath.replace(/\.md$/i, '')}|${label}]]`;
}
