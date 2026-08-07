import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeRepositoryPath,
	resolveProjectIdentity,
} from '../dist/application/project-identity.js';

function note(relativePath, frontmatter) {
	return {
		absolutePath: `/vault/${relativePath}`,
		relativePath,
		title: relativePath.split('/').at(-1),
		size: 1,
		modifiedAt: '2026-07-23T00:00:00.000Z',
		tokens: '',
		frontmatter,
		type: typeof frontmatter.type === 'string' ? frontmatter.type : undefined,
		aliases: [],
		tags: [],
		headings: [],
		blockIds: [],
		wikilinks: [],
		claimBlocks: [],
		evidenceBlocks: [],
		content: '',
	};
}

test('resolves POSIX path-valued project_hint through durable Vault metadata', () => {
	const repoPath = '/private/tmp/tracekeeper-real-123';
	const result = resolveProjectIdentity(
		{ project_hint: `${repoPath}/` },
		[
			note('01_knowledge/memory/projects/obsidian-tracekeeper/memory.md', {
				project_hint: 'obsidian-tracekeeper',
				project_id: 'tracekeeper-project',
				repo_path: repoPath,
			}),
		]
	);
	assert.deepEqual(
		{
			projectHint: result.projectHint,
			projectId: result.projectId,
			repoPath: result.repoPath,
			source: result.source,
			confidence: result.confidence,
		},
		{
			projectHint: 'obsidian-tracekeeper',
			projectId: 'tracekeeper-project',
			repoPath,
			source: 'vault_match',
			confidence: 'exact',
		}
	);
	assert.ok(result.warnings.includes('path_project_hint_treated_as_repo_path'));
});

test('normalizes Windows paths before matching Vault project metadata', () => {
	const result = resolveProjectIdentity(
		{ project_hint: 'c:\\USERS\\ALICE\\work\\tracekeeper\\' },
		[
			note('01_knowledge/memory/projects/tracekeeper/memory.md', {
				project_hint: 'tracekeeper',
				repo_path: 'C:/Users/alice/work/tracekeeper',
			}),
		]
	);
	assert.equal(result.projectHint, 'tracekeeper');
	assert.equal(result.repoPath, 'c:/USERS/ALICE/work/tracekeeper');
	assert.equal(result.source, 'vault_match');
});

test('keeps POSIX repository path matching case-sensitive', () => {
	const result = resolveProjectIdentity(
		{ repo_path: '/Volumes/Case/Repo' },
		[
			note('01_knowledge/memory/projects/repo/index.md', {
				type: 'project_memory_index',
				project_hint: 'repo',
				project_id: 'repo-id',
				repo_path: '/Volumes/case/repo',
			}),
		]
	);
	assert.equal(result.projectHint, 'Repo');
	assert.equal(result.projectId, '');
	assert.equal(result.source, 'repo_leaf');
	assert.equal(result.confidence, 'derived');
});

test('keeps explicit project id and canonical hint as stronger evidence', () => {
	const notes = [
		note('01_knowledge/memory/projects/atlas/memory.md', {
			project_hint: 'atlas',
			project_id: 'atlas-id',
			repo_path: '/work/atlas',
		}),
	];
	const byId = resolveProjectIdentity({ project_id: 'atlas-id', repo_path: '/work/atlas' }, notes);
	assert.equal(byId.projectHint, 'atlas');
	assert.equal(byId.source, 'explicit_project_id');
	assert.equal(byId.confidence, 'exact');

	const byHint = resolveProjectIdentity({ project_hint: 'atlas', repo_path: '/work/atlas' }, notes);
	assert.equal(byHint.projectHint, 'atlas');
	assert.equal(byHint.projectId, 'atlas-id');
	assert.equal(byHint.source, 'explicit_project_hint');
});

test('collapses hub and project-memory entries with one stable project id', () => {
	const result = resolveProjectIdentity(
		{ project_id: 'atlas-id' },
		[
			note('01_knowledge/memory/projects/atlas-stable/index.md', {
				type: 'project_memory_index',
				project_hint: 'atlas',
				project_id: 'atlas-id',
				repo_path: '/work/atlas',
			}),
			note('01_knowledge/memory/projects/atlas-stable/agents/codex/finish_task-op-1.md', {
				type: 'project_memory_entry',
				project_id: 'atlas-id',
			}),
			note('01_knowledge/memory/projects/atlas-stable/agents/claude-code/finish_task-op-2.md', {
				type: 'project_memory_entry',
				project_id: 'atlas-id',
			}),
		]
	);

	assert.equal(result.projectHint, 'atlas');
	assert.equal(result.projectId, 'atlas-id');
	assert.equal(result.source, 'explicit_project_id');
	assert.equal(result.confidence, 'exact');
	assert.equal(result.warnings.includes('ambiguous_vault_project_identity'), false);
});

test('canonicalizes an unmatched Agent hint when the repository uniquely matches durable Vault identity', () => {
	const result = resolveProjectIdentity(
		{ project_hint: 'tracekeeper', repo_path: '/work/obsidian-tracekeeper' },
		[
			note('01_knowledge/memory/projects/obsidian-tracekeeper/memory.md', {
				project_hint: 'obsidian-tracekeeper',
				project_id: 'tracekeeper-project',
				repo_path: '/work/obsidian-tracekeeper',
			}),
		]
	);
	assert.equal(result.projectHint, 'obsidian-tracekeeper');
	assert.equal(result.projectId, 'tracekeeper-project');
	assert.equal(result.source, 'vault_match');
	assert.equal(result.confidence, 'exact');
	assert.ok(result.warnings.includes('project_hint_canonicalized_from_repo_match'));
});

test('marks a canonical hint and repository that resolve to different Vault projects uncertain', () => {
	const result = resolveProjectIdentity(
		{ project_hint: 'alpha', repo_path: '/work/beta' },
		[
			note('01_knowledge/memory/projects/alpha/memory.md', {
				project_hint: 'alpha',
				project_id: 'alpha-id',
				repo_path: '/work/alpha',
			}),
			note('01_knowledge/memory/projects/beta/memory.md', {
				project_hint: 'beta',
				project_id: 'beta-id',
				repo_path: '/work/beta',
			}),
		]
	);
	assert.equal(result.projectHint, 'alpha');
	assert.equal(result.projectId, 'alpha-id');
	assert.equal(result.confidence, 'uncertain');
	assert.ok(result.warnings.includes('project_hint_conflicts_with_repo_path'));
});

test('marks contradictory explicit identity evidence uncertain instead of silently mixing projects', () => {
	const result = resolveProjectIdentity(
		{ project_id: 'atlas-id', project_hint: 'beta', repo_path: '/work/atlas' },
		[
			note('01_knowledge/memory/projects/atlas/memory.md', {
				project_hint: 'atlas',
				project_id: 'atlas-id',
				repo_path: '/work/atlas',
			}),
		]
	);
	assert.equal(result.projectHint, 'atlas');
	assert.equal(result.projectId, 'atlas-id');
	assert.equal(result.source, 'explicit_project_id');
	assert.equal(result.confidence, 'uncertain');
	assert.ok(result.warnings.includes('project_hint_conflicts_with_project_id'));
});

test('marks an explicit project id and contradictory repository path uncertain', () => {
	const result = resolveProjectIdentity(
		{ project_id: 'atlas-id', repo_path: '/work/beta' },
		[
			note('01_knowledge/memory/projects/atlas/index.md', {
				type: 'project_memory_index',
				project_hint: 'atlas',
				project_id: 'atlas-id',
				repo_path: '/work/atlas',
			}),
		]
	);
	assert.equal(result.projectHint, 'atlas');
	assert.equal(result.projectId, 'atlas-id');
	assert.equal(result.source, 'explicit_project_id');
	assert.equal(result.confidence, 'uncertain');
	assert.ok(result.warnings.includes('repo_path_conflicts_with_project_id'));
});

test('does not match repositories merely because their leaf names are equal', () => {
	const result = resolveProjectIdentity(
		{ repo_path: '/other/root/atlas' },
		[
			note('01_knowledge/memory/projects/atlas/index.md', {
				type: 'project_memory_index',
				project_hint: 'atlas',
				project_id: 'atlas-id',
				repo_path: '/work/atlas',
			}),
		]
	);
	assert.equal(result.projectHint, 'atlas');
	assert.equal(result.projectId, '');
	assert.equal(result.source, 'repo_leaf');
	assert.equal(result.confidence, 'derived');
	assert.ok(result.warnings.includes('project_hint_derived_from_repo_leaf'));
});

test('marks a duplicate canonical project hint uncertain', () => {
	const result = resolveProjectIdentity(
		{ project_hint: 'shared-name' },
		[
			note('01_knowledge/memory/projects/alpha/memory.md', {
				project_hint: 'shared-name',
				project_id: 'alpha-id',
			}),
			note('01_knowledge/memory/projects/beta/memory.md', {
				project_hint: 'shared-name',
				project_id: 'beta-id',
			}),
		]
	);
	assert.equal(result.projectHint, 'shared-name');
	assert.equal(result.projectId, '');
	assert.equal(result.confidence, 'uncertain');
	assert.ok(result.warnings.includes('ambiguous_vault_project_identity'));
});

test('does not silently choose when one repository maps to multiple projects', () => {
	const repoPath = '/work/shared';
	const result = resolveProjectIdentity(
		{ repo_path: repoPath },
		[
			note('01_knowledge/memory/projects/alpha/memory.md', {
				project_hint: 'alpha',
				repo_path: repoPath,
			}),
			note('01_knowledge/memory/projects/beta/memory.md', {
				project_hint: 'beta',
				repo_path: repoPath,
			}),
		]
	);
	assert.equal(result.projectHint, '');
	assert.equal(result.source, 'unknown');
	assert.equal(result.confidence, 'uncertain');
	assert.ok(result.warnings.includes('ambiguous_vault_project_identity'));
});

test('uses repository leaf only as a visible low-confidence fallback', () => {
	const result = resolveProjectIdentity({ repo_path: '/work/unregistered-project/' }, []);
	assert.equal(result.projectHint, 'unregistered-project');
	assert.equal(result.source, 'repo_leaf');
	assert.equal(result.confidence, 'derived');
	assert.ok(result.warnings.includes('project_hint_derived_from_repo_leaf'));
	assert.equal(normalizeRepositoryPath('file:///work/unregistered-project/'), '/work/unregistered-project');
});
