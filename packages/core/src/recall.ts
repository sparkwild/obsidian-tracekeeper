import type { ScannedNote } from './scan';
import {
	ARCHIVE_ARCHITECTURE_DIR,
	KNOWLEDGE_ARCHITECTURE_DIR,
	KNOWLEDGE_PROJECTS_MEMORY_DIR,
	TRACEKEEPER_CONTROL_DIR,
	TRACEKEEPER_INBOX_DIR,
	TRACEKEEPER_ARCHITECTURE_DIR,
	TRACEKEEPER_SESSIONS_DIR,
	TRACEKEEPER_TASKS_DIR,
} from './knowledge-architecture';

export interface RecallOptions {
	limit?: number;
}

export interface RecallMatch {
	note: ScannedNote;
	score: number;
	matchedTokens: string[];
}

const MIN_TOKEN_LENGTH = 2;
const DEFAULT_LIMIT = 6;
const RECENT_NOTE_WINDOW_DAYS = 14;
const EXCLUDED_RECALL_PREFIXES = [TRACEKEEPER_CONTROL_DIR, TRACEKEEPER_INBOX_DIR];

function isExcludedFromRecall(note: ScannedNote): boolean {
	const normalizedPath = note.relativePath.replace(/\\/g, '/').toLowerCase();
	return EXCLUDED_RECALL_PREFIXES.some((prefix) => {
		const normalizedPrefix = prefix.toLowerCase();
		return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
	});
}

function tokenize(input: string): string[] {
	const text = input.toLowerCase().normalize('NFKC');
	return [...new Set((text.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? []))]
		.filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

function frontmatterString(note: ScannedNote, key: string): string {
	const value = note.frontmatter[key];
	return typeof value === 'string' ? value : '';
}

function frontmatterTokens(note: ScannedNote): string[] {
	const values: string[] = [];
	for (const key of ['project_hint', 'related_project', 'project_id', 'repo', 'repo_path', 'source', 'target_note']) {
		const value = note.frontmatter[key];
		if (typeof value === 'string') {
			values.push(value);
		}
	}
	return values.flatMap((value) => tokenize(value));
}

function weightedTokensFromNote(note: ScannedNote): Record<string, number> {
	const tokens = new Set<string>([
		...tokenize(note.title),
		...tokenize(frontmatterString(note, 'title')),
		...tokenize(note.relativePath),
		...tokenize(frontmatterString(note, 'type')),
		...frontmatterTokens(note),
		...note.tags.flatMap((tag) => tokenize(tag)),
		...note.aliases.flatMap((alias) => tokenize(alias)),
		...note.headings.flatMap((heading) => tokenize(heading)),
		...tokenize(note.tokens),
	]);
	const weighted: Record<string, number> = {};

	for (const token of tokens) {
		let weight = 1;
		if (tokenize(note.title).includes(token)) {
			weight += 3;
		}
		if (tokenize(note.relativePath).includes(token) && note.relativePath.startsWith(`${KNOWLEDGE_ARCHITECTURE_DIR}/`)) {
			weight += 4;
		}
		if (note.relativePath.startsWith(`${TRACEKEEPER_ARCHITECTURE_DIR}/`) && !note.relativePath.startsWith(`${KNOWLEDGE_ARCHITECTURE_DIR}/`)) {
			weight += 1;
		}
		if (note.relativePath.startsWith(`${ARCHIVE_ARCHITECTURE_DIR}/`)) {
			weight += 1;
		}
		if (note.tags.some((tag) => tokenize(tag).includes(token))) {
			weight += 2;
		}
		if (note.aliases.some((alias) => tokenize(alias).includes(token))) {
			weight += 2;
		}
		if (frontmatterTokens(note).includes(token)) {
			weight += 3;
		}
		if (tokenize(note.relativePath).includes(token)) {
			weight += 2;
		}
		if (tokenize(frontmatterString(note, 'type')).includes(token)) {
			weight += 1;
		}
		weighted[token] = weight;
	}

	return weighted;
}

function noteTypeBonus(note: ScannedNote): number {
	if (note.relativePath.startsWith(`${TRACEKEEPER_TASKS_DIR}/`) || note.relativePath.startsWith('02_timeline/agent_tasks/')) {
		return 2;
	}
	if (note.relativePath.startsWith(`${TRACEKEEPER_SESSIONS_DIR}/`) || note.relativePath.startsWith('02_timeline/sessions/')) {
		return 2;
	}
	if (note.relativePath.startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
		return 4;
	}
	if (note.relativePath.startsWith('05_projects/') || note.relativePath.startsWith('04_projects/')) {
		return 2;
	}
	if (note.relativePath.startsWith(`${KNOWLEDGE_ARCHITECTURE_DIR}/`)) {
		return 3;
	}
	if (note.relativePath.startsWith('04_memory/') || note.relativePath.startsWith('03_sources/')) {
		return 1;
	}
	return 0;
}

function recencyBonus(note: ScannedNote): number {
	const modified = Date.parse(note.modifiedAt);
	if (!Number.isFinite(modified)) {
		return 0;
	}
	const ageDays = (Date.now() - modified) / (24 * 60 * 60 * 1000);
	if (ageDays < 0 || ageDays > RECENT_NOTE_WINDOW_DAYS) {
		return 0;
	}
	return 1;
}

export function scoreNote(note: ScannedNote, queryTokens: string[]): number {
	if (queryTokens.length === 0) {
		return 0;
	}

	const weights = weightedTokensFromNote(note);
	let score = 0;
	for (const token of queryTokens) {
		if (weights[token]) {
			score += weights[token];
		}
	}
	if (score <= 0) {
		return 0;
	}
	return score + noteTypeBonus(note) + recencyBonus(note);
}

export function recallNotes(notes: ScannedNote[], query: string, options: RecallOptions = {}): RecallMatch[] {
	const tokens = tokenize(query);
	const limit = options.limit ?? DEFAULT_LIMIT;
	const matches: RecallMatch[] = [];

	for (const note of notes) {
		if (isExcludedFromRecall(note)) {
			continue;
		}
		const score = scoreNote(note, tokens);
		if (score <= 0) {
			continue;
		}

		const matchedTokens = tokens.filter((token) => weightForNoteToken(note, token) > 0);
		matches.push({
			note,
			score,
			matchedTokens,
		});
	}

	return matches.sort((a, b) => b.score - a.score || a.note.relativePath.localeCompare(b.note.relativePath)).slice(0, limit);
}

function weightForNoteToken(note: ScannedNote, token: string): number {
	if (tokenize(note.title).includes(token)) {
		return 4;
	}
	if (tokenize(frontmatterString(note, 'type')).includes(token)) {
		return 3;
	}
	if (note.tags.some((tag) => tokenize(tag).includes(token))) {
		return 2;
	}
	if (note.aliases.some((alias) => tokenize(alias).includes(token))) {
		return 2;
	}
	if (frontmatterTokens(note).includes(token)) {
		return 3;
	}
	if (tokenize(note.relativePath).includes(token)) {
		return 2;
	}
	if (note.headings.some((heading) => tokenize(heading).includes(token))) {
		return 1;
	}
	if (tokenize(note.tokens).includes(token)) {
		return 1;
	}
	return 0;
}
