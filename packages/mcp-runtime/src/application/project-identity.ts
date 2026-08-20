import {
	KNOWLEDGE_PROJECTS_MEMORY_DIR,
	type ScannedNote,
} from '@tracekeeper/core';

export interface RawProjectIdentityInput {
	project_hint?: unknown;
	project_id?: unknown;
	repo_path?: unknown;
	repo?: unknown;
	project_path?: unknown;
}

export type ProjectIdentitySource =
	| 'explicit_project_id'
	| 'explicit_project_hint'
	| 'vault_match'
	| 'repo_leaf'
	| 'task_metadata'
	| 'unknown';

export type ProjectIdentityConfidence = 'exact' | 'derived' | 'uncertain';

export interface ResolvedProjectIdentity {
	projectHint: string;
	projectId: string;
	repoPath: string;
	source: ProjectIdentitySource;
	confidence: ProjectIdentityConfidence;
	warnings: string[];
}

interface ProjectIdentityCandidate {
	projectHint: string;
	projectId: string;
	repoPaths: string[];
}

function coerceOptionalString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function frontmatterString(frontmatter: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const value = frontmatter[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim().replace(/^['"]|['"]$/g, '');
		}
	}
	return '';
}

function projectPathSegment(note: ScannedNote): string {
	const normalized = note.relativePath.replace(/\\/g, '/');
	const prefix = `${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`;
	if (!normalized.startsWith(prefix)) {
		return '';
	}
	return normalized.slice(prefix.length).split('/').filter(Boolean)[0] || '';
}

function isLikelyRepoPath(value: string): boolean {
	if (!value) {
		return false;
	}
	return (
		/^[A-Za-z]:[\\/]/.test(value) ||
		value.startsWith('/') ||
		value.startsWith('~/') ||
		value.startsWith('./') ||
		value.startsWith('../') ||
		value.startsWith('file:') ||
		value.includes('\\') ||
		value.includes('/')
	);
}

export function normalizeRepositoryPath(value: string): string {
	let normalized = value.trim().normalize('NFC').replace(/\\/g, '/');
	if (!normalized) {
		return '';
	}
	const fileUri = /^file:/i.test(normalized);
	normalized = normalized.replace(/^file:(?:\/\/)?/i, '/');
	const uncPath = !fileUri && normalized.startsWith('//');
	normalized = normalized.replace(/\/{2,}/g, '/');
	if (uncPath) {
		normalized = `/${normalized}`;
	}
	if (normalized.length > 1) {
		normalized = normalized.replace(/\/+$/, '');
	}
	return normalized;
}

function normalizedIdentityValue(value: string): string {
	return value.trim().toLowerCase();
}

function repoPathMatches(left: string, right: string): boolean {
	const normalizedLeft = normalizeRepositoryPath(left);
	const normalizedRight = normalizeRepositoryPath(right);
	const windowsStyle = (value: string): boolean => /^[A-Za-z]:\//.test(value) || value.startsWith('//');
	const comparableLeft = windowsStyle(normalizedLeft) ? normalizedLeft.toLowerCase() : normalizedLeft;
	const comparableRight = windowsStyle(normalizedRight) ? normalizedRight.toLowerCase() : normalizedRight;
	return Boolean(
		comparableLeft
		&& comparableRight
		&& comparableLeft === comparableRight
	);
}

function candidateFromNote(note: ScannedNote): ProjectIdentityCandidate | null {
	const pathHint = note.type === 'project_memory_entry' || note.type === 'memory_record'
		? ''
		: projectPathSegment(note);
	const projectHint =
		frontmatterString(note.frontmatter, ['project_hint', 'project', 'related_project', 'project_name']) ||
		pathHint;
	const projectId = frontmatterString(note.frontmatter, ['project_id', 'projectId', 'project-id', 'pid']);
	const repoPaths = [
		frontmatterString(note.frontmatter, ['repo_path', 'repoPath', 'repository_path', 'repositoryPath']),
		frontmatterString(note.frontmatter, ['repo', 'repository']),
		frontmatterString(note.frontmatter, ['project_path', 'projectPath', 'workspace', 'cwd']),
	]
		.map(normalizeRepositoryPath)
		.filter(Boolean);
	if (!projectHint && !projectId && repoPaths.length === 0) {
		return null;
	}
	return {
		projectHint,
		projectId,
		repoPaths: [...new Set(repoPaths)],
	};
}

function collectCandidates(notes: ScannedNote[]): ProjectIdentityCandidate[] {
	const candidates: ProjectIdentityCandidate[] = [];
	for (const note of notes) {
		if (!note.relativePath.replace(/\\/g, '/').startsWith(`${KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
			continue;
		}
		const candidate = candidateFromNote(note);
		if (!candidate) {
			continue;
		}
		const existing = candidates.find((entry) => {
			const sameHint =
				candidate.projectHint &&
				entry.projectHint &&
				normalizedIdentityValue(candidate.projectHint) === normalizedIdentityValue(entry.projectHint);
			const compatibleId =
				!candidate.projectId ||
				!entry.projectId ||
				normalizedIdentityValue(candidate.projectId) === normalizedIdentityValue(entry.projectId);
			const sameId =
				candidate.projectId &&
				entry.projectId &&
				normalizedIdentityValue(candidate.projectId) === normalizedIdentityValue(entry.projectId);
			return (
				(sameHint && compatibleId)
				|| (sameId && (!candidate.projectHint || !entry.projectHint))
			);
		});
		if (existing) {
			existing.projectHint ||= candidate.projectHint;
			existing.projectId ||= candidate.projectId;
			existing.repoPaths = [...new Set([...existing.repoPaths, ...candidate.repoPaths])];
		} else {
			candidates.push(candidate);
		}
	}
	return candidates;
}

function uniqueCandidate(
	candidates: ProjectIdentityCandidate[],
	matches: (candidate: ProjectIdentityCandidate) => boolean,
	warnings: string[]
): ProjectIdentityCandidate | null {
	const matching = candidates.filter(matches);
	if (matching.length === 1) {
		return matching[0];
	}
	if (matching.length > 1) {
		warnings.push('ambiguous_vault_project_identity');
	}
	return null;
}

function repoLeaf(repoPath: string): string {
	const normalized = normalizeRepositoryPath(repoPath);
	return normalized.split('/').filter(Boolean).pop() || '';
}

export function resolveProjectIdentity(
	raw: RawProjectIdentityInput,
	notes: ScannedNote[] = []
): ResolvedProjectIdentity {
	const warnings: string[] = [];
	const rawHint = coerceOptionalString(raw.project_hint);
	const projectId = coerceOptionalString(raw.project_id);
	const explicitRepoPath =
		coerceOptionalString(raw.repo_path) ||
		coerceOptionalString(raw.repo) ||
		coerceOptionalString(raw.project_path);
	const pathHint = isLikelyRepoPath(rawHint) ? normalizeRepositoryPath(rawHint) : '';
	const repoPath = normalizeRepositoryPath(explicitRepoPath || pathHint);
	const explicitProjectHint = pathHint ? '' : rawHint;
	if (pathHint) {
		warnings.push('path_project_hint_treated_as_repo_path');
	}

	const candidates = collectCandidates(notes);
	if (projectId) {
		const candidate = uniqueCandidate(
			candidates,
			(entry) => normalizedIdentityValue(entry.projectId) === normalizedIdentityValue(projectId),
			warnings
		);
		if (!candidate && !warnings.includes('ambiguous_vault_project_identity')) {
			warnings.push('explicit_project_id_not_found');
		}
		const conflictingHint = Boolean(
			candidate?.projectHint &&
			explicitProjectHint &&
			normalizedIdentityValue(candidate.projectHint) !== normalizedIdentityValue(explicitProjectHint)
		);
		if (conflictingHint) {
			warnings.push('project_hint_conflicts_with_project_id');
		}
		const conflictingRepoPath = Boolean(
			candidate
			&& repoPath
			&& candidate.repoPaths.length > 0
			&& !candidate.repoPaths.some((candidatePath) => repoPathMatches(candidatePath, repoPath))
		);
		if (conflictingRepoPath) {
			warnings.push('repo_path_conflicts_with_project_id');
		}
		const uncertain = !candidate
			|| warnings.includes('ambiguous_vault_project_identity')
			|| conflictingHint
			|| conflictingRepoPath;
		return {
			projectHint: candidate?.projectHint || explicitProjectHint,
			projectId,
			repoPath,
			source: 'explicit_project_id',
			confidence: uncertain ? 'uncertain' : 'exact',
			warnings,
		};
	}

	if (explicitProjectHint) {
		const hintMatches = candidates.filter(
			(entry) => normalizedIdentityValue(entry.projectHint) === normalizedIdentityValue(explicitProjectHint)
		);
		const repoMatches = repoPath
			? candidates.filter(
				(entry) => entry.repoPaths.some((candidatePath) => repoPathMatches(candidatePath, repoPath))
			)
			: [];
		const sharedMatches = hintMatches.filter((entry) => repoMatches.includes(entry));
		let candidate: ProjectIdentityCandidate | null = null;
		let source: ProjectIdentitySource = 'explicit_project_hint';
		let uncertain = false;

		if (sharedMatches.length === 1) {
			candidate = sharedMatches[0];
		} else if (hintMatches.length === 1) {
			candidate = hintMatches[0];
			if (repoMatches.length > 0 && !repoMatches.includes(candidate)) {
				warnings.push('project_hint_conflicts_with_repo_path');
				uncertain = true;
			}
		} else if (hintMatches.length > 1) {
			warnings.push('ambiguous_vault_project_identity');
			uncertain = true;
		} else if (repoMatches.length === 1) {
			candidate = repoMatches[0];
			source = 'vault_match';
			warnings.push('project_hint_canonicalized_from_repo_match');
		} else if (repoMatches.length > 1) {
			warnings.push('ambiguous_vault_project_identity');
			uncertain = true;
		}

		return {
			projectHint: candidate?.projectHint || explicitProjectHint,
			projectId: candidate?.projectId || '',
			repoPath,
			source,
			confidence: uncertain ? 'uncertain' : 'exact',
			warnings,
		};
	}

	if (repoPath) {
		const candidate = uniqueCandidate(
			candidates,
			(entry) => entry.repoPaths.some((candidatePath) => repoPathMatches(candidatePath, repoPath)),
			warnings
		);
		if (candidate) {
			return {
				projectHint: candidate.projectHint,
				projectId: candidate.projectId,
				repoPath,
				source: 'vault_match',
				confidence: 'exact',
				warnings,
			};
		}
		if (warnings.includes('ambiguous_vault_project_identity')) {
			return {
				projectHint: '',
				projectId: '',
				repoPath,
				source: 'unknown',
				confidence: 'uncertain',
				warnings,
			};
		}
		const derivedHint = repoLeaf(repoPath);
		if (derivedHint) {
			warnings.push('project_hint_derived_from_repo_leaf');
			return {
				projectHint: derivedHint,
				projectId: '',
				repoPath,
				source: 'repo_leaf',
				confidence: 'derived',
				warnings,
			};
		}
	}

	return {
		projectHint: '',
		projectId: '',
		repoPath: '',
		source: 'unknown',
		confidence: 'uncertain',
		warnings,
	};
}

export function projectIdentityToResult(identity: ResolvedProjectIdentity) {
	return {
		project_hint: identity.projectHint || null,
		project_id: identity.projectId || null,
		repo_path: identity.repoPath || null,
		source: identity.source,
		confidence: identity.confidence,
		warnings: identity.warnings,
	};
}
