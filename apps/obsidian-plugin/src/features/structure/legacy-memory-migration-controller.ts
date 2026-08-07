import { createHash } from 'node:crypto';
import { TRACEKEEPER_REVIEW_QUEUE_DIR } from '@tracekeeper/core';

const PREVIEW_VERSION = 1;
const MAX_CANDIDATES = 4_096;
const MAX_SUGGESTIONS = 32;
const MIGRATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export interface LegacyMemoryIdentitySuggestion {
	claimKey: string;
	authority: string;
	confidence: string;
	relatedSources: string[];
}

export interface LegacyMemoryDoctorCandidate {
	path: string;
	contentHash: string;
	scope: 'global' | 'project';
	projectId: string | null;
	suggestions: LegacyMemoryIdentitySuggestion[];
}

export interface LegacyMemoryDoctorSnapshot {
	generation: number;
	indexState: 'building' | 'ready' | 'recovering' | 'error';
	candidates: LegacyMemoryDoctorCandidate[];
}

export interface LegacyMemoryMigrationPreviewRow {
	path: string;
	contentHash: string;
	scope: 'global' | 'project';
	projectId: string | null;
	status: 'no_suggestion' | 'unique_suggestion' | 'ambiguous';
	suggestions: LegacyMemoryIdentitySuggestion[];
	proposalPath: string | null;
	proposalHash: string | null;
}

export interface LegacyMemoryMigrationPreview {
	version: typeof PREVIEW_VERSION;
	migrationId: string;
	generation: number;
	indexState: LegacyMemoryDoctorSnapshot['indexState'];
	evidenceHash: string;
	confirmationHash: string;
	rows: LegacyMemoryMigrationPreviewRow[];
	canApply: boolean;
	executableCount: number;
	blockedCount: number;
	rollbackBehavior: string;
}

export interface LegacyMemoryMigrationApplyRow {
	path: string;
	proposalPath: string | null;
	status: 'created' | 'already_created' | 'blocked' | 'conflict' | 'failed';
	reason: string;
}

export interface LegacyMemoryMigrationResult {
	migrationId: string;
	rows: LegacyMemoryMigrationApplyRow[];
	createdCount: number;
	alreadyCreatedCount: number;
	blockedCount: number;
	failedCount: number;
	recoveryBehavior: string;
	rollbackBehavior: string;
}

export interface LegacyMemoryMigrationHost {
	loadDoctorSnapshot(): Promise<LegacyMemoryDoctorSnapshot>;
	readText(path: string): Promise<string | null>;
	createText(path: string, content: string): Promise<void>;
}

export class LegacyMemoryMigrationController {
	constructor(private readonly host: LegacyMemoryMigrationHost) {}

	async preview(migrationId: string): Promise<LegacyMemoryMigrationPreview> {
		assertMigrationId(migrationId);
		return this.buildPreview(migrationId, await this.host.loadDoctorSnapshot());
	}

	async apply(
		preview: LegacyMemoryMigrationPreview
	): Promise<LegacyMemoryMigrationResult> {
		this.assertPreviewIntegrity(preview);
		const fresh = this.buildPreview(
			preview.migrationId,
			await this.host.loadDoctorSnapshot()
		);
		if (fresh.confirmationHash !== preview.confirmationHash) {
			throw new Error(
				'Legacy memory migration preview is stale. No proposal was created.'
			);
		}
		if (!fresh.canApply) {
			throw new Error(
				'Legacy memory migration requires a ready fresh Doctor snapshot. No proposal was created.'
			);
		}

		const rows: LegacyMemoryMigrationApplyRow[] = [];
		for (const row of fresh.rows) {
			if (row.status !== 'unique_suggestion' || !row.proposalPath) {
				rows.push({
					path: row.path,
					proposalPath: null,
					status: 'blocked',
					reason: row.status === 'ambiguous'
						? 'Multiple identity suggestions require an explicit human choice.'
						: 'No identity suggestion is available; no claim key was inferred.',
				});
				continue;
			}
			const content = renderProposal(preview.migrationId, row);
			try {
				const existing = await this.host.readText(row.proposalPath);
				if (existing !== null) {
					rows.push({
						path: row.path,
						proposalPath: row.proposalPath,
						status: hash(existing) === row.proposalHash
							? 'already_created'
							: 'conflict',
						reason: hash(existing) === row.proposalHash
							? 'The exact review proposal already exists.'
							: 'The deterministic proposal path contains different content.',
					});
					continue;
				}
				await this.host.createText(row.proposalPath, content);
				rows.push({
					path: row.path,
					proposalPath: row.proposalPath,
					status: 'created',
					reason: 'A review proposal was created; the legacy source was not changed.',
				});
			} catch (error) {
				rows.push({
					path: row.path,
					proposalPath: row.proposalPath,
					status: 'failed',
					reason: boundedError(error),
				});
			}
		}

		return {
			migrationId: preview.migrationId,
			rows,
			createdCount: rows.filter((row) => row.status === 'created').length,
			alreadyCreatedCount: rows.filter((row) => row.status === 'already_created').length,
			blockedCount: rows.filter((row) => row.status === 'blocked').length,
			failedCount: rows.filter((row) => row.status === 'failed' || row.status === 'conflict').length,
			recoveryBehavior: 'Build a fresh preview and retry. Exact proposals are reused; failed rows remain independently retryable.',
			rollbackBehavior: fresh.rollbackBehavior,
		};
	}

	private buildPreview(
		migrationId: string,
		snapshot: LegacyMemoryDoctorSnapshot
	): LegacyMemoryMigrationPreview {
		if (!Number.isSafeInteger(snapshot.generation) || snapshot.generation < 0) {
			throw new Error('Doctor snapshot generation is invalid.');
		}
		if (
			snapshot.indexState !== 'building'
			&& snapshot.indexState !== 'ready'
			&& snapshot.indexState !== 'recovering'
			&& snapshot.indexState !== 'error'
		) {
			throw new Error('Doctor snapshot state is invalid.');
		}
		if (!Array.isArray(snapshot.candidates) || snapshot.candidates.length > MAX_CANDIDATES) {
			throw new Error('Doctor snapshot candidate count is invalid.');
		}
		const rows = snapshot.candidates.map((candidate) =>
			normalizeCandidate(migrationId, candidate)
		).sort((left, right) => left.path.localeCompare(right.path));
		if (new Set(rows.map((row) => row.path)).size !== rows.length) {
			throw new Error('Doctor snapshot contains duplicate legacy candidate paths.');
		}
		const evidence: Pick<
			LegacyMemoryMigrationPreview,
			'version' | 'migrationId' | 'generation' | 'indexState' | 'rows'
		> = {
			version: PREVIEW_VERSION,
			migrationId,
			generation: snapshot.generation,
			indexState: snapshot.indexState,
			rows,
		};
		const evidenceHash = hash(canonicalJson(evidence));
		const confirmationHash = hash(canonicalJson({ evidenceHash, rows }));
		return {
			...evidence,
			evidenceHash,
			confirmationHash,
			canApply: snapshot.indexState === 'ready',
			executableCount: snapshot.indexState === 'ready'
				? rows.filter((row) => row.status === 'unique_suggestion').length
				: 0,
			blockedCount: snapshot.indexState === 'ready'
				? rows.filter((row) => row.status !== 'unique_suggestion').length
				: rows.length,
			rollbackBehavior: 'Legacy notes are never rewritten, moved, or deleted. Rejecting or removing a generated review proposal leaves every source note unchanged.',
		};
	}

	private assertPreviewIntegrity(preview: LegacyMemoryMigrationPreview): void {
		assertMigrationId(preview.migrationId);
		if (preview.version !== PREVIEW_VERSION) {
			throw new Error('Legacy memory migration preview version is unsupported.');
		}
		const rebuilt = this.buildPreview(preview.migrationId, {
			generation: preview.generation,
			indexState: preview.indexState,
			candidates: preview.rows.map((row) => ({
				path: row.path,
				contentHash: row.contentHash,
				scope: row.scope,
				projectId: row.projectId,
				suggestions: row.suggestions,
			})),
		});
		if (
			rebuilt.evidenceHash !== preview.evidenceHash
			|| rebuilt.confirmationHash !== preview.confirmationHash
		) {
			throw new Error('Legacy memory migration preview integrity is invalid.');
		}
	}
}

function normalizeCandidate(
	migrationId: string,
	candidate: LegacyMemoryDoctorCandidate
): LegacyMemoryMigrationPreviewRow {
	const path = normalizePath(candidate.path);
	if (!HASH_PATTERN.test(candidate.contentHash)) {
		throw new Error(`Legacy candidate content hash is invalid: ${path}.`);
	}
	if (candidate.scope === 'project' && !candidate.projectId?.trim()) {
		throw new Error(`Legacy project candidate is missing project identity: ${path}.`);
	}
	if (candidate.scope === 'global' && candidate.projectId) {
		throw new Error(`Legacy global candidate cannot carry project identity: ${path}.`);
	}
	if (!Array.isArray(candidate.suggestions) || candidate.suggestions.length > MAX_SUGGESTIONS) {
		throw new Error(`Legacy candidate suggestion count is invalid: ${path}.`);
	}
	const suggestions = candidate.suggestions.map(normalizeSuggestion);
	const status = suggestions.length === 0
		? 'no_suggestion'
		: suggestions.length === 1
			? 'unique_suggestion'
			: 'ambiguous';
	const proposalPath = status === 'unique_suggestion'
		? buildProposalPath(migrationId, path)
		: null;
	const row: LegacyMemoryMigrationPreviewRow = {
		path,
		contentHash: candidate.contentHash,
		scope: candidate.scope,
		projectId: candidate.projectId?.trim() || null,
		status,
		suggestions,
		proposalPath,
		proposalHash: null,
	};
	return {
		...row,
		proposalHash: proposalPath ? hash(renderProposal(migrationId, row)) : null,
	};
}

function normalizeSuggestion(
	suggestion: LegacyMemoryIdentitySuggestion
): LegacyMemoryIdentitySuggestion {
	const claimKey = suggestion.claimKey.trim();
	const authority = suggestion.authority.trim();
	const confidence = suggestion.confidence.trim();
	if (!claimKey || !authority || !confidence) {
		throw new Error('Legacy identity suggestion is incomplete.');
	}
	return {
		claimKey,
		authority,
		confidence,
		relatedSources: [...new Set(
			suggestion.relatedSources.map(normalizePath)
		)].sort(),
	};
}

function renderProposal(
	migrationId: string,
	row: LegacyMemoryMigrationPreviewRow
): string {
	const suggestion = row.suggestions[0];
	if (!suggestion || row.status !== 'unique_suggestion') {
		throw new Error('Only a unique legacy identity suggestion can render a proposal.');
	}
	const sources = [...new Set([row.path, ...suggestion.relatedSources])];
	return [
		'---',
		'type: legacy-migration-review',
		'proposal_type: legacy-migration-review',
		'migration_kind: legacy-memory-identity',
		'approval_status: pending',
		`migration_id: ${yaml(migrationId)}`,
		`legacy_path: ${yaml(row.path)}`,
		`legacy_content_hash: ${yaml(row.contentHash)}`,
		`memory_scope: ${yaml(row.scope)}`,
		...(row.projectId ? [`project_id: ${yaml(row.projectId)}`] : []),
		`claim_key: ${yaml(suggestion.claimKey)}`,
		`proposed_authority: ${yaml(suggestion.authority)}`,
		`proposed_confidence: ${yaml(suggestion.confidence)}`,
		`evidence: ${JSON.stringify(sources)}`,
		`related_sources: ${JSON.stringify(sources)}`,
		'---',
		'',
		'# Legacy memory identity proposal',
		'',
		`Legacy source: [[${row.path.replace(/\.md$/iu, '')}]]`,
		'',
		`Proposed claim key: \`${suggestion.claimKey}\``,
		'',
		'This review proposal creates no authority by itself. The original legacy note remains unchanged and readable.',
		'',
	].join('\n');
}

function buildProposalPath(migrationId: string, sourcePath: string): string {
	const suffix = hash(sourcePath).slice(0, 16);
	return `${TRACEKEEPER_REVIEW_QUEUE_DIR}/${migrationId}_legacy-memory-${suffix}.md`;
}

function normalizePath(value: string): string {
	const path = value.trim().replace(/\\+/g, '/').replace(/^\/+|\/+$/g, '');
	if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) {
		throw new Error('Legacy migration path is invalid.');
	}
	return path;
}

function assertMigrationId(value: string): void {
	if (!MIGRATION_ID_PATTERN.test(value)) {
		throw new Error('Legacy memory migration id is invalid.');
	}
}

function yaml(value: string): string {
	return JSON.stringify(value);
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function hash(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function boundedError(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
