"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRepositoryPath = normalizeRepositoryPath;
exports.resolveProjectIdentity = resolveProjectIdentity;
exports.projectIdentityToResult = projectIdentityToResult;
const core_1 = require("@tracekeeper/core");
function coerceOptionalString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function frontmatterString(frontmatter, keys) {
    for (const key of keys) {
        const value = frontmatter[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim().replace(/^['"]|['"]$/g, '');
        }
    }
    return '';
}
function projectPathSegment(note) {
    const normalized = note.relativePath.replace(/\\/g, '/');
    const prefix = `${core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`;
    if (!normalized.startsWith(prefix)) {
        return '';
    }
    return normalized.slice(prefix.length).split('/').filter(Boolean)[0] || '';
}
function isLikelyRepoPath(value) {
    if (!value) {
        return false;
    }
    return (/^[A-Za-z]:[\\/]/.test(value) ||
        value.startsWith('/') ||
        value.startsWith('~/') ||
        value.startsWith('./') ||
        value.startsWith('../') ||
        value.startsWith('file:') ||
        value.includes('\\') ||
        value.includes('/'));
}
function normalizeRepositoryPath(value) {
    let normalized = value.trim().replace(/\\/g, '/');
    if (!normalized) {
        return '';
    }
    normalized = normalized.replace(/^file:(?:\/\/)?/i, '/');
    normalized = normalized.replace(/\/{2,}/g, '/');
    if (normalized.length > 1) {
        normalized = normalized.replace(/\/+$/, '');
    }
    return normalized;
}
function normalizedIdentityValue(value) {
    return value.trim().toLowerCase();
}
function repoPathMatches(left, right) {
    const normalizedLeft = normalizeRepositoryPath(left).toLowerCase();
    const normalizedRight = normalizeRepositoryPath(right).toLowerCase();
    if (!normalizedLeft || !normalizedRight) {
        return false;
    }
    if (normalizedLeft === normalizedRight) {
        return true;
    }
    const leftLeaf = normalizedLeft.split('/').filter(Boolean).pop() || normalizedLeft;
    const rightLeaf = normalizedRight.split('/').filter(Boolean).pop() || normalizedRight;
    return leftLeaf.length > 1 && leftLeaf === rightLeaf;
}
function candidateFromNote(note) {
    const projectHint = frontmatterString(note.frontmatter, ['project_hint', 'project', 'related_project', 'project_name']) ||
        projectPathSegment(note);
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
function collectCandidates(notes) {
    const candidates = [];
    for (const note of notes) {
        if (!note.relativePath.replace(/\\/g, '/').startsWith(`${core_1.KNOWLEDGE_PROJECTS_MEMORY_DIR}/`)) {
            continue;
        }
        const candidate = candidateFromNote(note);
        if (!candidate) {
            continue;
        }
        const existing = candidates.find((entry) => {
            const sameHint = candidate.projectHint &&
                entry.projectHint &&
                normalizedIdentityValue(candidate.projectHint) === normalizedIdentityValue(entry.projectHint);
            const compatibleId = !candidate.projectId ||
                !entry.projectId ||
                normalizedIdentityValue(candidate.projectId) === normalizedIdentityValue(entry.projectId);
            const sameId = candidate.projectId &&
                entry.projectId &&
                normalizedIdentityValue(candidate.projectId) === normalizedIdentityValue(entry.projectId);
            return (sameHint && compatibleId) || (!candidate.projectHint && !entry.projectHint && sameId);
        });
        if (existing) {
            existing.projectHint || (existing.projectHint = candidate.projectHint);
            existing.projectId || (existing.projectId = candidate.projectId);
            existing.repoPaths = [...new Set([...existing.repoPaths, ...candidate.repoPaths])];
        }
        else {
            candidates.push(candidate);
        }
    }
    return candidates;
}
function uniqueCandidate(candidates, matches, warnings) {
    const matching = candidates.filter(matches);
    if (matching.length === 1) {
        return matching[0];
    }
    if (matching.length > 1) {
        warnings.push('ambiguous_vault_project_identity');
    }
    return null;
}
function repoLeaf(repoPath) {
    const normalized = normalizeRepositoryPath(repoPath);
    return normalized.split('/').filter(Boolean).pop() || '';
}
function resolveProjectIdentity(raw, notes = []) {
    const warnings = [];
    const rawHint = coerceOptionalString(raw.project_hint);
    const projectId = coerceOptionalString(raw.project_id);
    const explicitRepoPath = coerceOptionalString(raw.repo_path) ||
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
        const candidate = uniqueCandidate(candidates, (entry) => normalizedIdentityValue(entry.projectId) === normalizedIdentityValue(projectId), warnings);
        const conflictingHint = Boolean(candidate?.projectHint &&
            explicitProjectHint &&
            normalizedIdentityValue(candidate.projectHint) !== normalizedIdentityValue(explicitProjectHint));
        if (conflictingHint) {
            warnings.push('project_hint_conflicts_with_project_id');
        }
        const uncertain = warnings.includes('ambiguous_vault_project_identity') || conflictingHint;
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
        const hintMatches = candidates.filter((entry) => normalizedIdentityValue(entry.projectHint) === normalizedIdentityValue(explicitProjectHint));
        const repoMatches = repoPath
            ? candidates.filter((entry) => entry.repoPaths.some((candidatePath) => repoPathMatches(candidatePath, repoPath)))
            : [];
        const sharedMatches = hintMatches.filter((entry) => repoMatches.includes(entry));
        let candidate = null;
        let source = 'explicit_project_hint';
        let uncertain = false;
        if (sharedMatches.length === 1) {
            candidate = sharedMatches[0];
        }
        else if (hintMatches.length === 1) {
            candidate = hintMatches[0];
            if (repoMatches.length > 0 && !repoMatches.includes(candidate)) {
                warnings.push('project_hint_conflicts_with_repo_path');
                uncertain = true;
            }
        }
        else if (hintMatches.length > 1) {
            warnings.push('ambiguous_vault_project_identity');
            uncertain = true;
        }
        else if (repoMatches.length === 1) {
            candidate = repoMatches[0];
            source = 'vault_match';
            warnings.push('project_hint_canonicalized_from_repo_match');
        }
        else if (repoMatches.length > 1) {
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
        const candidate = uniqueCandidate(candidates, (entry) => entry.repoPaths.some((candidatePath) => repoPathMatches(candidatePath, repoPath)), warnings);
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
function projectIdentityToResult(identity) {
    return {
        project_hint: identity.projectHint || null,
        project_id: identity.projectId || null,
        repo_path: identity.repoPath || null,
        source: identity.source,
        confidence: identity.confidence,
        warnings: identity.warnings,
    };
}
