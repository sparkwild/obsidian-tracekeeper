import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	PUBLIC_TOOL_NAME_ORDER,
	getContractByName,
} from '@tracekeeper/contracts';
import { resolveScannedNoteEdges, scannedNoteFromContent } from '@tracekeeper/core';
import {
	LOCAL_TRUST_CAPABILITIES,
	LOCAL_TRUST_PRINCIPAL_ID,
	callTool,
	toolDefinitions,
} from '../dist/index.js';
import { RecallApplicationService } from '../dist/application/recall.js';
import { resolveProjectIdentity } from '../dist/application/project-identity.js';

const OLD_TIME = '2020-01-01T00:00:00.000Z';
const RECENT_TIME = '2999-01-01T00:00:00.000Z';
const WIKI_PATHS = Array.from(
	{ length: 10 },
	(_, index) => `01_knowledge/wiki/concepts/atlas-${String(index + 1).padStart(2, '0')}.md`
);
const SOURCE_PATHS = Array.from(
	{ length: 10 },
	(_, index) => `01_knowledge/sources/web/atlas-${String(index + 1).padStart(2, '0')}.md`
);

function note(vaultRoot, relativePath, {
	content,
	frontmatter = {},
	modifiedAt = OLD_TIME,
	type,
} = {}) {
	const body = content ?? `# ${path.basename(relativePath, '.md')}\n`;
	const scanned = scannedNoteFromContent({
		absolutePath: path.join(vaultRoot, relativePath),
		relativePath,
		fallbackTitle: path.basename(relativePath, '.md'),
		size: Buffer.byteLength(body),
		modifiedAt,
		content: body,
	});
	const mergedFrontmatter = { ...scanned.frontmatter, ...frontmatter };
	return {
		...scanned,
		frontmatter: mergedFrontmatter,
		type: type ?? (
			typeof mergedFrontmatter.type === 'string'
				? mergedFrontmatter.type
				: scanned.type
		),
	};
}

function buildNotes(vaultRoot) {
	const atlasIdentity = {
		project_hint: 'atlas',
		project_id: 'atlas-id',
		repo_path: '/work/atlas',
	};
	const relationLinks = WIKI_PATHS
		.map((relativePath) => `[[${relativePath.replace(/\.md$/, '')}]]`)
		.join(' ');
	const atlasMemory = note(vaultRoot, '01_knowledge/memory/projects/atlas/memory.md', {
		frontmatter: {
			...atlasIdentity,
			type: 'project-memory',
			related_wiki: `${WIKI_PATHS.join(', ')}, missing/wiki-note.md`,
			related_sources: `${SOURCE_PATHS.join(', ')}, missing/source-note.md`,
		},
		content: [
			'# Atlas durable memory',
			'atlasfixture relationfixture rankfixture durable architecture decision.',
			`${relationLinks} [[${WIKI_PATHS[0].replace(/\.md$/, '')}]]`,
		].join('\n\n'),
	});
	const wikiNotes = WIKI_PATHS.map((relativePath, index) => note(vaultRoot, relativePath, {
		frontmatter: {
			...atlasIdentity,
			type: 'wiki-concept',
		},
		content: index === 0
			? '# Atlas Wiki\nrankfixture atlas wiki guidance.'
			: `# Atlas relation ${index + 1}\nrelation target ${index + 1}.`,
	}));
	const sourceNotes = SOURCE_PATHS.map((relativePath, index) => note(vaultRoot, relativePath, {
		frontmatter: {
			...atlasIdentity,
			type: 'captured-source',
		},
		content: index === 0
			? '# Atlas source\nsourceoriginfixture captured evidence.'
			: `# Atlas source ${index + 1}\nsource evidence ${index + 1}.`,
	}));

	const notes = [
		atlasMemory,
		...wikiNotes,
		...sourceNotes,
		note(vaultRoot, '00_tracekeeper/work/tasks/atlas-task.md', {
			frontmatter: {
				...atlasIdentity,
				type: 'agent-task',
				task_id: 'task-atlas',
			},
			modifiedAt: '2026-07-28T00:00:00.000Z',
			content: '# Atlas task\nrankfixture historyfixture task query echo.',
		}),
		note(vaultRoot, '00_tracekeeper/work/sessions/atlas-session.md', {
			frontmatter: {
				...atlasIdentity,
				type: 'session',
				task_id: 'task-atlas',
			},
			modifiedAt: '2026-07-29T00:00:00.000Z',
			content: '# Atlas session\nhistoryfixture completed session.',
		}),
		note(vaultRoot, '01_knowledge/memory/projects/beta/memory.md', {
			frontmatter: {
				project_hint: 'beta',
				project_id: 'beta-id',
				repo_path: '/work/beta',
				type: 'project-memory',
			},
			content: '# Beta memory\nbetafixture unrelated project memory.',
		}),
		note(vaultRoot, '01_knowledge/memory/projects/shared-alpha/memory.md', {
			frontmatter: {
				project_hint: 'shared-name',
				project_id: 'shared-alpha-id',
				repo_path: '/work/shared',
			},
			content: '# Shared alpha\nambiguityfixture alpha.',
		}),
		note(vaultRoot, '01_knowledge/memory/projects/shared-beta/memory.md', {
			frontmatter: {
				project_hint: 'shared-name',
				project_id: 'shared-beta-id',
				repo_path: '/work/shared',
			},
			content: '# Shared beta\nambiguityfixture beta.',
		}),
		note(vaultRoot, '01_knowledge/memory/global/global.md', {
			content: '# Global note\nglobalfixture durable global context.',
		}),
		note(vaultRoot, '01_knowledge/wiki/concepts/fresh-old.md', {
			modifiedAt: OLD_TIME,
			content: '# Fresh old\nfreshnessfixture equal lexical evidence.',
		}),
		note(vaultRoot, '01_knowledge/wiki/concepts/fresh-recent.md', {
			modifiedAt: RECENT_TIME,
			content: '# Fresh recent\nfreshnessfixture equal lexical evidence.',
		}),
		...Array.from({ length: 25 }, (_, index) => note(
			vaultRoot,
			`01_knowledge/wiki/references/bounded-${String(index + 1).padStart(2, '0')}.md`,
			{
				content: `# Bounded ${index + 1}\nboundfixture deterministic result ${index + 1}.`,
			}
		)),
	];
	const resolvedByPath = new Map(
		resolveScannedNoteEdges(notes).map((entry) => [entry.relativePath, entry])
	);
	return notes.map((entry) => resolvedByPath.get(entry.relativePath) ?? entry);
}

function createFixture(t, {
	indexState = 'ready',
	generation = 7,
	errors = [],
} = {}) {
	const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-recall-r1-'));
	t.after(() => fs.rmSync(vaultRoot, { recursive: true, force: true }));
	const scan = {
		vaultRoot,
		scannedAt: '2026-07-30T00:00:00.000Z',
		notes: buildNotes(vaultRoot),
		errors,
		index: {
			index_state: indexState,
			generation,
			last_rebuild: '2026-07-30T00:00:00.000Z',
		},
	};
	const providerCalls = [];
	const context = {
		defaultVaultRoot: vaultRoot,
		principalId: LOCAL_TRUST_PRINCIPAL_ID,
		credentialCapabilities: LOCAL_TRUST_CAPABILITIES,
		agentId: 'recall-r1-agent',
		sessionId: 'recall-r1-session',
		clientName: 'recall-r1-client',
		knowledgeSnapshotProvider(requestedVaultRoot) {
			providerCalls.push(requestedVaultRoot);
			return scan;
		},
	};
	return { context, providerCalls, scan, vaultRoot };
}

async function successfulCall(name, args, context) {
	const result = await callTool(name, args, context);
	assert.equal(result.isError, false, `${name} should succeed: ${JSON.stringify(result.structuredContent)}`);
	assert.equal(result.structuredContent.ok, true);
	return { payload: result.structuredContent, result };
}

function directApplicationDependencies(scan, {
	nowMs = Date.parse('2026-07-30T00:00:00.000Z'),
	onLoad = () => {},
	onResolve = () => {},
	onFilter = () => {},
} = {}) {
	return {
		loadScan() {
			onLoad();
			return scan;
		},
		nowMs() {
			return nowMs;
		},
		resolveProjectIdentity(input, notes) {
			onResolve();
			return resolveProjectIdentity(input, notes);
		},
		filterProjectNotes(notes, identity) {
			onFilter();
			return notes.filter((entry) =>
				entry.frontmatter.project_hint === identity.projectHint ||
				entry.frontmatter.project_id === identity.projectId ||
				entry.frontmatter.repo_path === identity.repoPath
			);
		},
		buildRelationEvidence() {
			return { related_wiki: [], related_sources: [] };
		},
		contentOrigin(relativePath) {
			if (relativePath.startsWith('01_knowledge/sources/')) {
				return 'captured_source';
			}
			if (relativePath.startsWith('00_tracekeeper/')) {
				return 'tracekeeper_generated';
			}
			return 'vault_note';
		},
	};
}

test('application owner: injected dependencies execute global, project, and history branches without MCP decoration', (t) => {
	const { scan, vaultRoot } = createFixture(t);
	let loadCalls = 0;
	let resolveCalls = 0;
	let filterCalls = 0;
	const service = new RecallApplicationService(directApplicationDependencies(scan, {
		onLoad: () => loadCalls += 1,
		onResolve: () => resolveCalls += 1,
		onFilter: () => filterCalls += 1,
	}));

	const global = service.execute({
		scope: 'global',
		query: 'globalfixture',
		maxItems: 2,
		vaultRoot,
		projectIdentityInput: {},
	});
	assert.equal(global.scope_mode, 'global');
	assert.equal(global.matches[0].path, '01_knowledge/memory/global/global.md');
	assert.equal(Object.hasOwn(global, 'schema_version'), false);
	assert.equal(Object.hasOwn(global, 'recall'), false);
	assert.equal(Object.hasOwn(global, 'next_actions'), false);

	const project = service.execute({
		scope: 'project',
		query: 'rankfixture',
		maxItems: 3,
		vaultRoot,
		projectIdentityInput: { project_hint: 'atlas' },
	});
	assert.equal(project.scope_mode, 'project');
	assert.equal(project.project_identity.project_hint, 'atlas');
	assert.equal(project.entries[0].path, '01_knowledge/memory/projects/atlas/memory.md');

	const history = service.execute({
		scope: 'project_history',
		query: 'historyfixture',
		maxItems: 3,
		vaultRoot,
		projectIdentityInput: { project_id: 'atlas-id' },
	});
	assert.equal(history.entries[0].path, '00_tracekeeper/work/sessions/atlas-session.md');
	assert.equal(history.entries[1].path, '00_tracekeeper/work/tasks/atlas-task.md');
	assert.equal(history.total_matches, 2);
	assert.equal(loadCalls, 3);
	assert.equal(resolveCalls, 2);
	assert.equal(filterCalls, 2);
});

test('application owner: injected clock exclusively controls the existing recency boost', (t) => {
	const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-recall-r2-clock-'));
	t.after(() => fs.rmSync(vaultRoot, { recursive: true, force: true }));
	const scan = {
		vaultRoot,
		scannedAt: '2026-01-05T12:00:00.000Z',
		errors: [],
		notes: [
			note(vaultRoot, '01_knowledge/wiki/concepts/a-old.md', {
				modifiedAt: '2026-01-01T00:00:00.000Z',
				content: '# Old\nclockfixture equal lexical evidence.',
			}),
			note(vaultRoot, '01_knowledge/wiki/concepts/z-recent.md', {
				modifiedAt: '2026-01-05T00:00:00.000Z',
				content: '# Recent\nclockfixture equal lexical evidence.',
			}),
		],
		index: {
			index_state: 'ready',
			generation: 3,
			last_rebuild: '2026-01-05T12:00:00.000Z',
		},
	};
	const request = {
		scope: 'global',
		query: 'clockfixture',
		maxItems: 2,
		vaultRoot,
		projectIdentityInput: {},
	};
	const recentService = new RecallApplicationService(directApplicationDependencies(scan, {
		nowMs: Date.parse('2026-01-05T12:00:00.000Z'),
	}));
	const staleService = new RecallApplicationService(directApplicationDependencies(scan, {
		nowMs: Date.parse('2026-02-05T12:00:00.000Z'),
	}));

	const recent = recentService.execute(request);
	assert.equal(recent.matches[0].path, '01_knowledge/wiki/concepts/z-recent.md');
	assert.ok(recent.matches[0].score_reason.includes('Recent edit (+1)'));
	const stale = staleService.execute(request);
	assert.equal(stale.matches[0].path, '01_knowledge/wiki/concepts/a-old.md');
	assert.equal(stale.matches.some((entry) =>
		entry.score_reason.some((reason) => reason.startsWith('Recent edit'))
	), false);
});

test('contract: Recall retains public order, schema, capability, risk, effect, idempotency, and compatibility replacements', async (t) => {
	const contract = getContractByName('tracekeeper.recall');
	assert.ok(contract);
	assert.equal(contract.version, 1);
	assert.equal(contract.visibility, 'public');
	assert.equal(contract.capability, 'vault.read');
	assert.equal(contract.risk, 'read-only');
	assert.equal(contract.effect, 'read');
	assert.equal(contract.idempotency, 'natural');
	assert.equal(contract.world, 'closed');
	assert.equal(contract.workflowRole, 'recall');
	assert.strictEqual(contract.outputSchema, contract.resultSchema);
	assert.deepEqual(toolDefinitions().map((definition) => definition.name), PUBLIC_TOOL_NAME_ORDER);
	const definition = toolDefinitions(['vault.read']).find((entry) => entry.name === 'tracekeeper.recall');
	assert.ok(definition);
	assert.strictEqual(definition.outputSchema, contract.outputSchema);
	assert.deepEqual(definition.annotations, {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	});
	assert.equal(toolDefinitions([]).some((entry) => entry.name === 'tracekeeper.recall'), false);
	assert.equal(
		getContractByName('tracekeeper.project_context').deprecated.replacement,
		'tracekeeper.recall with scope="project"'
	);
	assert.equal(
		getContractByName('tracekeeper.project_history').deprecated.replacement,
		'tracekeeper.recall with scope="project_history"'
	);

	const { context } = createFixture(t);
	const denied = await callTool('tracekeeper.recall', { query: 'globalfixture' }, {
		...context,
		credentialCapabilities: [],
	});
	assert.equal(denied.isError, true);
	assert.equal(denied.structuredContent.error_detail.code, 'PERMISSION_DENIED');
	assert.match(denied.structuredContent.error, /lacks capability vault\.read/);
});

test('scope and query: default/global/project/history routing, required queries, long queries, and numeric bounds remain explicit', async (t) => {
	const { context } = createFixture(t);
	const defaultResult = await successfulCall('tracekeeper.recall', {
		query: 'globalfixture',
		max_items: 4,
	}, context);
	assert.equal(defaultResult.payload.recall.scope, 'global');
	assert.equal(defaultResult.payload.scope_mode, 'global');
	assert.equal(defaultResult.payload.matches[0].path, '01_knowledge/memory/global/global.md');

	const globalResult = await successfulCall('tracekeeper.recall', {
		scope: 'global',
		query: 'globalfixture',
	}, context);
	assert.equal(globalResult.payload.recall.scope, 'global');

	const projectResult = await successfulCall('tracekeeper.recall', {
		scope: 'project',
		query: 'atlasfixture',
		project_hint: 'atlas',
	}, context);
	assert.equal(projectResult.payload.recall.scope, 'project');
	assert.ok(projectResult.payload.matches.every((entry) => entry.scope === 'project'));

	const historyResult = await successfulCall('tracekeeper.recall', {
		scope: 'project_history',
		project_id: 'atlas-id',
		max_items: 3,
	}, context);
	assert.equal(historyResult.payload.recall.scope, 'project_history');
	assert.equal(historyResult.payload.recall.query, '');
	assert.ok(historyResult.payload.matches.length > 0);

	for (const args of [
		{ scope: 'global', query: '' },
		{ scope: 'project', query: '', project_hint: 'atlas' },
	]) {
		const missing = await callTool('tracekeeper.recall', args, context);
		assert.equal(missing.isError, true);
		assert.match(missing.structuredContent.error, /required string argument: query/);
	}
	const invalidScope = await callTool('tracekeeper.recall', {
		scope: 'invalid',
		query: 'globalfixture',
	}, context);
	assert.equal(invalidScope.isError, true);
	assert.match(invalidScope.structuredContent.error, /scope must be one of/);

	const invalidBound = await callTool('tracekeeper.recall', {
		query: 'boundfixture',
		max_items: 21,
	}, context);
	assert.equal(invalidBound.isError, true);
	assert.match(invalidBound.structuredContent.error, /integer within allowed bounds/);

	const longQuery = `${'atlasfixture '.repeat(80)}durable`;
	const longResult = await successfulCall('tracekeeper.recall', {
		query: longQuery,
		max_items: 2,
	}, context);
	assert.equal(longResult.payload.recall.query, longQuery);
	assert.ok(longResult.payload.matches.length > 0);
});

test('identity: canonical hint, stable id, repository, path-valued hint, conflict, ambiguity, and unknown evidence stay observable', async (t) => {
	const { context } = createFixture(t);
	const cases = [
		{
			args: { project_hint: 'atlas' },
			expected: {
				project_hint: 'atlas',
				project_id: 'atlas-id',
				repo_path: null,
				source: 'explicit_project_hint',
				confidence: 'exact',
			},
		},
		{
			args: { project_id: 'atlas-id' },
			expected: {
				project_hint: 'atlas',
				project_id: 'atlas-id',
				repo_path: null,
				source: 'explicit_project_id',
				confidence: 'exact',
			},
		},
		{
			args: { repo_path: '/work/atlas/' },
			expected: {
				project_hint: 'atlas',
				project_id: 'atlas-id',
				repo_path: '/work/atlas',
				source: 'vault_match',
				confidence: 'exact',
			},
		},
	];
	for (const identityCase of cases) {
		const { payload } = await successfulCall('tracekeeper.recall', {
			scope: 'project',
			query: 'atlasfixture',
			...identityCase.args,
		}, context);
		assert.deepEqual(
			{
				project_hint: payload.project_identity.project_hint,
				project_id: payload.project_identity.project_id,
				repo_path: payload.project_identity.repo_path,
				source: payload.project_identity.source,
				confidence: payload.project_identity.confidence,
			},
			identityCase.expected
		);
		assert.equal(payload.uncertain, false);
	}

	const pathHint = await successfulCall('tracekeeper.recall', {
		scope: 'project',
		query: 'atlasfixture',
		project_hint: '/work/atlas/',
	}, context);
	assert.equal(pathHint.payload.project_identity.project_hint, 'atlas');
	assert.equal(pathHint.payload.project_identity.source, 'vault_match');
	assert.ok(pathHint.payload.project_identity.warnings.includes('path_project_hint_treated_as_repo_path'));

	const conflict = await successfulCall('tracekeeper.recall', {
		scope: 'project',
		query: 'atlasfixture',
		project_hint: 'atlas',
		repo_path: '/work/beta',
	}, context);
	assert.equal(conflict.payload.project_identity.confidence, 'uncertain');
	assert.equal(conflict.payload.uncertain, true);
	assert.equal(conflict.payload.scope_mode, 'project');
	assert.deepEqual(conflict.payload.entries, []);
	assert.ok(conflict.payload.project_identity.warnings.includes('project_hint_conflicts_with_repo_path'));
	assert.equal(conflict.payload.next_actions[0].reason_code, 'PROJECT_SCOPE_UNCERTAIN');
	assert.ok(conflict.payload.candidate_notes.length > 0);

	const conflictHistory = await successfulCall('tracekeeper.recall', {
		scope: 'project_history',
		query: 'betafixture',
		project_hint: 'atlas',
		repo_path: '/work/beta',
	}, context);
	assert.equal(conflictHistory.payload.uncertain, true);
	assert.equal(conflictHistory.payload.total_matches, 0);
	assert.deepEqual(conflictHistory.payload.entries, []);

	const ambiguous = await successfulCall('tracekeeper.recall', {
		scope: 'project',
		query: 'ambiguityfixture',
		project_hint: 'shared-name',
	}, context);
	assert.equal(ambiguous.payload.project_identity.confidence, 'uncertain');
	assert.ok(ambiguous.payload.project_identity.warnings.includes('ambiguous_vault_project_identity'));
	assert.deepEqual(ambiguous.payload.entries, []);

	const unknown = await successfulCall('tracekeeper.recall', {
		scope: 'project',
		query: 'atlasfixture',
	}, context);
	assert.equal(unknown.payload.project_identity.source, 'unknown');
	assert.equal(unknown.payload.project_identity.confidence, 'uncertain');
	assert.equal(unknown.payload.uncertain, true);
	assert.deepEqual(unknown.payload.entries, []);
});

test('snapshot: injected ready and rebuilding generations, scan errors, and provider invocation remain characterized', async (t) => {
	const ready = createFixture(t, {
		indexState: 'ready',
		generation: 11,
		errors: [{ path: '/redacted/unreadable.md', error: 'fixture scan error' }],
	});
	const readyResult = await successfulCall('tracekeeper.recall', {
		query: 'globalfixture',
	}, ready.context);
	assert.deepEqual(ready.providerCalls, [ready.vaultRoot]);
	assert.equal(readyResult.payload.recall.index_state, 'ready');
	assert.equal(readyResult.payload.recall.snapshot_generation, 11);
	assert.equal(readyResult.payload.recall.snapshot_warning, null);
	assert.equal(Object.hasOwn(readyResult.payload, 'errors'), false);
	assert.doesNotMatch(JSON.stringify(readyResult.payload.matches), /fixture scan error|unreadable\.md/);

	const rebuilding = createFixture(t, {
		indexState: 'rebuilding',
		generation: 12,
	});
	const rebuildingResult = await successfulCall('tracekeeper.recall', {
		query: 'globalfixture',
	}, rebuilding.context);
	assert.equal(rebuildingResult.payload.recall.index_state, 'rebuilding');
	assert.equal(rebuildingResult.payload.recall.snapshot_generation, 12);
	assert.match(rebuildingResult.payload.recall.snapshot_warning, /previous snapshot generation/);
	assert.equal(rebuildingResult.payload.next_actions[0].reason_code, 'INDEX_REBUILDING');

	const initializing = createFixture(t, {
		indexState: 'initializing',
		generation: 13,
	});
	const initializingResult = await successfulCall('tracekeeper.recall', {
		query: 'globalfixture',
	}, initializing.context);
	assert.equal(initializingResult.payload.recall.index_state, 'initializing');
	assert.equal(initializingResult.payload.recall.snapshot_generation, 13);
	assert.match(initializingResult.payload.recall.snapshot_warning, /metadata is still initializing/);
});

test('snapshot and security: filesystem fallback excludes config and symlink content while returning Vault-relative match evidence', async (t) => {
	const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-recall-r1-scan-'));
	const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-recall-r1-outside-'));
	t.after(() => fs.rmSync(vaultRoot, { recursive: true, force: true }));
	t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }));
	fs.mkdirSync(path.join(vaultRoot, '01_knowledge', 'wiki'), { recursive: true });
	fs.mkdirSync(path.join(vaultRoot, '.obsidian'), { recursive: true });
	fs.writeFileSync(
		path.join(vaultRoot, '01_knowledge', 'wiki', 'safe.md'),
		'# Safe\nfilesystemfixture safe local note.',
		'utf8'
	);
	fs.writeFileSync(
		path.join(vaultRoot, '.obsidian', 'secret.md'),
		'# Secret\nfilesystemfixture configsecretfixture.',
		'utf8'
	);
	const outsidePath = path.join(outsideRoot, 'outside.md');
	fs.writeFileSync(outsidePath, '# Outside\nfilesystemfixture symlinksecretfixture.', 'utf8');
	fs.symlinkSync(outsidePath, path.join(vaultRoot, 'linked-outside.md'));

	const context = {
		defaultVaultRoot: vaultRoot,
		vaultConfigDir: '.obsidian',
		principalId: LOCAL_TRUST_PRINCIPAL_ID,
		credentialCapabilities: LOCAL_TRUST_CAPABILITIES,
		agentId: 'recall-r1-filesystem-agent',
	};
	const { payload } = await successfulCall('tracekeeper.recall', {
		query: 'filesystemfixture',
		max_items: 10,
	}, context);
	assert.equal(payload.recall.index_state, 'filesystem_scan');
	assert.equal(payload.recall.snapshot_generation, null);
	assert.deepEqual(payload.matches.map((entry) => entry.path), ['01_knowledge/wiki/safe.md']);
	for (const match of payload.matches) {
		assert.equal(path.isAbsolute(match.path), false);
		assert.doesNotMatch(JSON.stringify(match), new RegExp(vaultRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		assert.doesNotMatch(JSON.stringify(match), /configsecretfixture|symlinksecretfixture/);
	}
});

test('ranking: project Memory and Wiki boosts, work-record penalty, recency, and result bounds remain deterministic', async (t) => {
	const { context } = createFixture(t);
	const project = await successfulCall('tracekeeper.recall', {
		scope: 'project',
		query: 'rankfixture',
		project_hint: 'atlas',
		max_items: 3,
	}, context);
	assert.deepEqual(project.payload.matches.map((entry) => entry.path), [
		'01_knowledge/memory/projects/atlas/memory.md',
		WIKI_PATHS[0],
		'00_tracekeeper/work/tasks/atlas-task.md',
	]);
	assert.ok(project.payload.matches[0].score_reason.includes('Project-memory location boost (+4)'));
	assert.ok(project.payload.matches[1].score_reason.includes('Wiki location boost (+0.75)'));
	assert.ok(project.payload.matches[2].score_reason.some((reason) => reason.startsWith('Work-record query-echo penalty')));
	assert.ok(project.payload.matches[0].score > project.payload.matches[1].score);
	assert.ok(project.payload.matches[1].score > project.payload.matches[2].score);

	const recency = await successfulCall('tracekeeper.recall', {
		query: 'freshnessfixture',
		max_items: 2,
	}, context);
	assert.equal(recency.payload.matches[0].path, '01_knowledge/wiki/concepts/fresh-recent.md');
	assert.ok(recency.payload.matches[0].score_reason.includes('Recent edit (+1)'));
	assert.ok(recency.payload.matches[0].score > recency.payload.matches[1].score);

	const bounded = await successfulCall('tracekeeper.recall', {
		query: 'boundfixture',
		max_items: 20,
	}, context);
	assert.equal(bounded.payload.matches.length, 20);
	assert.equal(bounded.payload.recall.matched_count, 20);
	assert.equal(bounded.payload.max_items, 20);
});

test('relations and output: verified Wiki/Source evidence is deduplicated and bounded with origin, path, excerpt, graph, and why metadata', async (t) => {
	const { context } = createFixture(t);
	const relationResult = await successfulCall('tracekeeper.recall', {
		scope: 'project',
		query: 'relationfixture',
		project_hint: 'atlas',
		max_items: 1,
	}, context);
	const match = relationResult.payload.matches[0];
	assert.equal(match.path, '01_knowledge/memory/projects/atlas/memory.md');
	assert.equal(match.content_origin, 'vault_note');
	assert.equal(match.instruction_trust, 'data_only');
	assert.match(match.why_matched, /^Project recall - matched tokens:/);
	assert.ok(match.excerpt.length <= 480);
	assert.equal(match.graph_links.length, 8);
	assert.equal(match.graph_links[0], WIKI_PATHS[0]);
	assert.equal(match.relation_evidence.related_wiki.length, 8);
	assert.equal(match.relation_evidence.related_sources.length, 8);
	assert.deepEqual(match.relation_evidence.related_wiki[0].declared_via, [
		'frontmatter',
		'body_wikilink',
	]);
	assert.ok(match.relation_evidence.related_wiki.every((entry) => entry.verified_by === 'active_vault_snapshot'));
	assert.ok(match.relation_evidence.related_sources.every((entry) => entry.verified_by === 'active_vault_snapshot'));
	assert.doesNotMatch(JSON.stringify(match.relation_evidence), /missing\/wiki-note|missing\/source-note/);

	const source = await successfulCall('tracekeeper.recall', {
		query: 'sourceoriginfixture',
		max_items: 1,
	}, context);
	assert.equal(source.payload.matches[0].content_origin, 'captured_source');
	const generated = await successfulCall('tracekeeper.recall', {
		query: 'historyfixture task',
		max_items: 1,
	}, context);
	assert.equal(generated.payload.matches[0].path, '00_tracekeeper/work/tasks/atlas-task.md');
	assert.equal(generated.payload.matches[0].content_origin, 'tracekeeper_generated');
});

test('shared edge authority: Recall graph links and relation evidence use the native resolved target and snapshot generation', async (t) => {
	const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-recall-native-edge-'));
	t.after(() => fs.rmSync(vaultRoot, { recursive: true, force: true }));
	const firstTargetPath = '01_knowledge/wiki/concepts/native-first.md';
	const secondTargetPath = '01_knowledge/wiki/concepts/native-second.md';
	const firstTarget = note(vaultRoot, firstTargetPath, {
		content: '---\naliases: [Native Alias]\n---\n# First',
	});
	const secondTarget = note(vaultRoot, secondTargetPath, {
		content: '---\naliases: [Native Alias]\n---\n# Second',
	});
	const parsedSource = note(vaultRoot, '01_knowledge/memory/projects/native/memory.md', {
		content: [
			'---',
			'type: project-memory',
			'related_wiki: "[[Native Alias#Native Heading]]"',
			'---',
			'# Native memory',
			'nativeedgefixture [[Native Alias#^native-block]]',
		].join('\n'),
	});
	const nativeEdges = parsedSource.edges.map((edge) => ({
		...edge,
		resolution: {
			status: 'resolved',
			path: firstTargetPath,
			authority: 'native',
		},
	}));
	const source = {
		...parsedSource,
		edges: nativeEdges,
		wikilinks: nativeEdges,
	};
	const scan = {
		vaultRoot,
		scannedAt: '2026-07-30T00:00:00.000Z',
		notes: [source, firstTarget, secondTarget],
		errors: [],
		index: {
			index_state: 'ready',
			generation: 17,
			last_rebuild: '2026-07-30T00:00:00.000Z',
		},
	};
	const context = {
		defaultVaultRoot: vaultRoot,
		principalId: LOCAL_TRUST_PRINCIPAL_ID,
		credentialCapabilities: LOCAL_TRUST_CAPABILITIES,
		agentId: 'recall-native-edge-agent',
		sessionId: 'recall-native-edge-session',
		clientName: 'recall-native-edge-client',
		knowledgeSnapshotProvider: () => scan,
	};
	const { payload } = await successfulCall('tracekeeper.recall', {
		query: 'nativeedgefixture',
		max_items: 1,
	}, context);
	const match = payload.matches[0];
	assert.equal(payload.recall.snapshot_generation, 17);
	assert.deepEqual(new Set(match.graph_links), new Set([
		`${firstTargetPath}#Native Heading`,
		`${firstTargetPath}#^native-block`,
	]));
	assert.deepEqual(match.relation_evidence.related_wiki, [{
		path: firstTargetPath,
		declared_by: source.relativePath,
		declared_via: ['frontmatter', 'body_wikilink'],
		verified_by: 'active_vault_snapshot',
	}]);
	const graphHealth = await successfulCall('tracekeeper.graph_health', {
		max_items: 20,
	}, context);
	assert.equal(graphHealth.payload.snapshot_generation, 17);
	assert.equal(graphHealth.payload.resolved_edge_count, 2);
	assert.equal(graphHealth.payload.unresolved_edge_count, 0);
});

test('shared edge authority: unresolved native edges are not reinterpreted by relation fallback', async (t) => {
	const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-recall-unresolved-edge-'));
	t.after(() => fs.rmSync(vaultRoot, { recursive: true, force: true }));
	const targetPath = '01_knowledge/wiki/concepts/native-present.md';
	const target = note(vaultRoot, targetPath, {
		content: '# Native present',
	});
	const parsedSource = note(vaultRoot, '01_knowledge/memory/projects/native/unresolved.md', {
		content: [
			'---',
			'type: project-memory',
			`related_wiki: "[[${targetPath}]]"`,
			'---',
			'# Native unresolved memory',
			`nativeunresolvedfixture [[${targetPath}]]`,
		].join('\n'),
	});
	const nativeEdges = parsedSource.edges.map((edge) => ({
		...edge,
		resolution: {
			status: 'unresolved',
			reason: 'native_unresolved',
			authority: 'native',
		},
	}));
	const source = {
		...parsedSource,
		edges: nativeEdges,
		wikilinks: nativeEdges,
	};
	const scan = {
		vaultRoot,
		scannedAt: '2026-07-30T00:00:00.000Z',
		notes: [source, target],
		errors: [],
		index: {
			index_state: 'ready',
			generation: 18,
			last_rebuild: '2026-07-30T00:00:00.000Z',
		},
	};
	const context = {
		defaultVaultRoot: vaultRoot,
		principalId: LOCAL_TRUST_PRINCIPAL_ID,
		credentialCapabilities: LOCAL_TRUST_CAPABILITIES,
		agentId: 'recall-unresolved-edge-agent',
		sessionId: 'recall-unresolved-edge-session',
		clientName: 'recall-unresolved-edge-client',
		knowledgeSnapshotProvider: () => scan,
	};
	const { payload } = await successfulCall('tracekeeper.recall', {
		query: 'nativeunresolvedfixture',
		max_items: 1,
	}, context);
	const match = payload.matches[0];
	assert.equal(payload.recall.snapshot_generation, 18);
	assert.deepEqual(match.graph_links, []);
	assert.deepEqual(match.relation_evidence, {
		related_wiki: [],
		related_sources: [],
	});
});

test('workflow and output: zero-result behavior, stable recall correlation, bounded read action, data-only trust, and text/structured parity remain exact', async (t) => {
	const { context } = createFixture(t);
	const zero = await successfulCall('tracekeeper.recall', {
		query: 'zzqnovaultmatch7b6065',
	}, context);
	assert.equal(zero.payload.recall.matched_count, 0);
	assert.deepEqual(zero.payload.matches, []);
	assert.equal(zero.payload.next_actions.length, 1);
	assert.equal(zero.payload.next_actions[0].reason_code, 'RECALL_ZERO_MATCH');

	const first = await successfulCall('tracekeeper.recall', {
		query: 'globalfixture',
		max_items: 1,
	}, context);
	const second = await successfulCall('tracekeeper.recall', {
		query: 'globalfixture',
		max_items: 1,
	}, context);
	assert.equal(first.payload.recall.recall_id, second.payload.recall.recall_id);
	assert.match(first.payload.recall.recall_id, /^recall_[a-f0-9]{16}$/);
	assert.equal(first.payload.next_actions.length, 1);
	assert.equal(first.payload.next_actions[0].tool, 'tracekeeper.read_note');
	assert.equal(
		first.payload.next_actions[0].arguments.recall_id,
		first.payload.recall.recall_id
	);
	assert.equal(
		first.payload.next_actions[0].arguments.path,
		first.payload.matches[0].path
	);
	assert.ok(first.payload.matches.every((entry) => entry.instruction_trust === 'data_only'));
	assert.equal(first.result.content[0].text, JSON.stringify(first.payload));
});

test('compatibility: project_context and project_history preserve public Recall parity and replacement metadata', async (t) => {
	const { context } = createFixture(t);
	const projectArgs = {
		query: 'atlasfixture',
		project_hint: 'atlas',
		max_items: 3,
	};
	const publicProject = await successfulCall('tracekeeper.recall', {
		scope: 'project',
		...projectArgs,
	}, context);
	const compatibilityProject = await successfulCall(
		'tracekeeper.project_context',
		projectArgs,
		context
	);
	assert.deepEqual(compatibilityProject.payload.entries, publicProject.payload.entries);
	assert.deepEqual(compatibilityProject.payload.project_identity, publicProject.payload.project_identity);
	assert.equal(compatibilityProject.payload.deprecated, true);
	assert.equal(
		compatibilityProject.payload.replacement_tool,
		'tracekeeper.recall with scope="project"'
	);

	const historyArgs = {
		query: 'historyfixture',
		project_id: 'atlas-id',
		max_items: 3,
	};
	const publicHistory = await successfulCall('tracekeeper.recall', {
		scope: 'project_history',
		...historyArgs,
	}, context);
	const compatibilityHistory = await successfulCall(
		'tracekeeper.project_history',
		historyArgs,
		context
	);
	assert.deepEqual(compatibilityHistory.payload.entries, publicHistory.payload.entries);
	assert.deepEqual(compatibilityHistory.payload.project_identity, publicHistory.payload.project_identity);
	assert.equal(compatibilityHistory.payload.deprecated, true);
	assert.equal(
		compatibilityHistory.payload.replacement_tool,
		'tracekeeper.recall with scope="project_history"'
	);
});
