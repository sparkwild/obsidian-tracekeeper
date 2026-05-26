import path from 'node:path';
import { scanVault, type ScannedNote } from './scan';
import { recallNotes, type RecallMatch } from './recall';
import {
	KNOWLEDGE_SOURCES_DIR,
	TRACEKEEPER_CONTEXT_PACKS_DIR,
	TRACEKEEPER_REVIEW_QUEUE_DIR,
	TRACEKEEPER_SESSIONS_DIR,
} from './knowledge-architecture';

export interface ContextPack {
	query: string;
	generatedAt: string;
	relevantNotes: Array<{
		relativePath: string;
		score: number;
		matchedTokens: string[];
		type?: string;
		title: string;
	}>;
	sourceCandidates: Array<{
		note: string;
		reason: string;
	}>;
	evidenceCandidates: Array<{
		note: string;
		blockId?: string;
		excerpt: string;
	}>;
	gaps: string[];
	staleWarnings: string[];
	suggestedWritebackTargets: string[];
	scanErrors: Array<{ path: string; error: string }>;
}

export interface ContextPackOptions {
	limit?: number;
	staleAfterDays?: number;
	vaultConfigDir?: string;
}

interface SourceCandidate {
	note: ScannedNote;
	reason: string;
}

function isStringArrayValue(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function normalizeStringList(value: unknown): string[] {
	if (!isStringArrayValue(value)) {
		return [];
	}

	const normalized: string[] = [];
	for (const item of value) {
		if (typeof item === 'string') {
			normalized.push(item);
		}
	}
	return normalized;
}

function gatherSourceCandidates(notes: ScannedNote[]): SourceCandidate[] {
	const candidates: SourceCandidate[] = [];
	for (const note of notes) {
		const type = note.type ?? '';
		const frontmatterSourceKind =
			typeof note.frontmatter.source_kind === 'string' ? note.frontmatter.source_kind : '';
		if (
			type === 'source' ||
			type === 'source-note' ||
			type === 'agent-request' ||
			frontmatterSourceKind
		) {
			candidates.push({
				note,
				reason: frontmatterSourceKind
					? `type=${type || 'source'} source_kind=${frontmatterSourceKind}`
					: `type=${type || 'source'}`,
			});
		}
	}

	return candidates;
}

function gatherEvidenceCandidates(
	notes: ScannedNote[]
): Array<{ note: ScannedNote; blockId?: string; excerpt: string }> {
	const candidates: Array<{ note: ScannedNote; blockId?: string; excerpt: string }> = [];

	for (const note of notes) {
		for (const block of note.evidenceBlocks) {
			candidates.push({
				note,
				blockId: block.blockId,
				excerpt: block.content.slice(0, 150),
			});
		}
	}

	return candidates;
}

function calculateGapHints(note: ScannedNote): string[] {
	const hints: string[] = [];
	if (note.claimBlocks.some((block) => block.sourceRefs.length === 0)) {
		hints.push(`Claim without source refs in ${note.relativePath}`);
	}
	return hints;
}

function isStaleNote(note: ScannedNote, staleAfterDays: number): boolean {
	const modified = Date.parse(note.modifiedAt);
	if (Number.isNaN(modified)) {
		return false;
	}
	const cutoff = Date.now() - staleAfterDays * 24 * 60 * 60 * 1000;
	return modified < cutoff;
}

export function buildContextPack(
	vaultRoot: string,
	query: string,
	options: ContextPackOptions = {}
): ContextPack {
	const scan = scanVault(vaultRoot, { vaultConfigDir: options.vaultConfigDir });
	const recall = recallNotes(scan.notes, query, { limit: options.limit });
	const topNotes = recall.map((item: RecallMatch) => item.note);
	const staleAfterDays = options.staleAfterDays ?? 180;

	const sourceCandidates = gatherSourceCandidates(topNotes)
		.filter(
			(candidate, index, list) => list.findIndex((item) => item.note.relativePath === candidate.note.relativePath) === index
		)
		.map((candidate) => ({
			note: candidate.note.relativePath,
			reason: candidate.reason,
		}));

	const evidenceCandidates = gatherEvidenceCandidates(topNotes).map((entry) => ({
		note: entry.note.relativePath,
		blockId: entry.blockId,
		excerpt: entry.excerpt,
	}));

	const gaps = topNotes.flatMap((note) => calculateGapHints(note));
	if (gaps.length === 0) {
		gaps.push('No explicit claim/evidence gaps detected in top matches.');
	}

	const staleWarnings = topNotes
		.filter((note) => isStaleNote(note, staleAfterDays))
		.map((note) => `${note.relativePath} has not changed in ${staleAfterDays}+ days.`);
	if (staleWarnings.length === 0) {
		staleWarnings.push('No stale notes found in top matches.');
	}

	const suggestedWritebackTargets = [
		TRACEKEEPER_CONTEXT_PACKS_DIR,
		TRACEKEEPER_REVIEW_QUEUE_DIR,
		KNOWLEDGE_SOURCES_DIR,
		TRACEKEEPER_SESSIONS_DIR,
	].map((entry) => path.join(scan.vaultRoot, entry));

	return {
		query,
		generatedAt: new Date().toISOString(),
		relevantNotes: recall.map((match) => ({
			relativePath: match.note.relativePath,
			score: match.score,
			matchedTokens: normalizeStringList(match.matchedTokens),
			type: match.note.type,
			title: match.note.title,
		})),
		sourceCandidates,
		evidenceCandidates,
		gaps,
		staleWarnings,
		suggestedWritebackTargets,
		scanErrors: scan.errors,
	};
}
