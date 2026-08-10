#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import safety from '../dist/safety.js';
import sourceAnalysisModule from '../dist/source-analysis.js';
import scanModule from '../dist/scan.js';
import markdownModule from '../dist/markdown.js';
import graphHealthModule from '../dist/graph-health.js';
import lintModule from '../dist/lint.js';
import recallModule from '../dist/recall.js';
import legacyStructureModule from '../dist/legacy-structure.js';
import operationJournalModule from '../dist/operation-journal.js';
import knowledgeIndexModule from '../dist/knowledge-index.js';
import knowledgeNoteModule from '../dist/knowledge-note.js';
import vaultRepositoryModule from '../dist/vault-repository.js';
import proposalTransitionModule from '../dist/proposal-transition.js';
import projectMemoryModule from '../dist/project-memory.js';
import memoryRecordModule from '../dist/memory-record.js';
import memoryLifecycleModule from '../dist/memory-lifecycle.js';
import sourceRecordModule from '../dist/source-record.js';
import lifecycleDiagnosticsModule from '../dist/lifecycle-diagnostics.js';

const KNOWLEDGE_DIR = '01_knowledge';
const CONFIG_DIR = 'vault-config';

function writeFile(relativePath, content, basePath) {
	const target = path.join(basePath, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content, 'utf8');
	return target;
}

function createFixture(rootPath) {
	const vaultRoot = path.join(rootPath, 'vault');
	fs.mkdirSync(vaultRoot, { recursive: true });
	return vaultRoot;
}

function createSourceSeed(vaultRoot) {
	writeFile(
		`${CONFIG_DIR}/config.json`,
		'{}',
		vaultRoot
	);
	writeFile('00_tracekeeper/control/system.md', '# System\n', vaultRoot);
	writeFile('01_knowledge/sources/source_seed.md', '# Source Seed\n\nProof text used for scan tests.', vaultRoot);
	writeFile('03_sources/legacy_source.md', '# Legacy Source\n', vaultRoot);
}

function createGraphAndLintFixture(vaultRoot) {
	writeFile(
		`${KNOWLEDGE_DIR}/wiki/hubs/wiki-bridge.md`,
		'# Wiki Bridge\n',
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/wiki/hubs/wiki-only-link.md`,
		'# Wiki Link\n',
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/memory/memory-bridge.md`,
		['---', 'type: memory', 'related_wiki: [01_knowledge/wiki/hubs/wiki-bridge.md, 00_tracekeeper/work/sessions/session-invalid.md]', '---', '# Memory Bridge'].join('\n'),
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/memory/memory-yaml-only.md`,
		['---', 'type: memory', '---', '# Memory YAML Only', '[[01_knowledge/wiki/hubs/wiki-only-link]]'].join('\n'),
		vaultRoot
	);

	writeFile(
		`${KNOWLEDGE_DIR}/memory/projects/alpha/note.md`,
		'# Project Alpha\n',
		vaultRoot
	);

	writeFile(
		`${KNOWLEDGE_DIR}/wiki/concepts/recall-priority.md`,
		'# Recall Priority\nRecall priority token for recall ranking.\n',
		vaultRoot
	);
	writeFile(
		'04_memory/recall-priority.md',
		'# Recall Priority\nRecall priority token for recall ranking.\n',
		vaultRoot
	);
}

function createReciprocalCase(vaultRoot) {
	writeFile(
		`${KNOWLEDGE_DIR}/wiki/hubs/wiki-bad-bridge.md`,
		'# Wiki Bad Bridge\n',
		vaultRoot
	);
}

function createRecallHygieneFixture(vaultRoot) {
	writeFile(
		'00_tracekeeper/control/audit_log.md',
		'# Audit Log\n\nAtlasfixture control audit entries.\n',
		vaultRoot
	);
	writeFile(
		'00_tracekeeper/inbox/agent_requests/atlas-recall-hygiene.md',
		'# Atlas Recall Hygiene\n\nAtlasfixture inbox entry for candidate filtering test.\n',
		vaultRoot
	);
	writeFile(
		'00_tracekeeper/work/tasks/atlas-task.md',
		'# Atlas Task\n\nAtlasfixture task context entry for recall overlap.\n',
		vaultRoot
	);
	writeFile(
		'00_tracekeeper/work/sessions/atlas-session.md',
		'# Atlas Session\n\nAtlasfixture current session context entry.\n',
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/memory/projects/atlas/memory.md`,
		'---\nproject_hint: atlas\n---\n# Atlas Memory\n\nAtlasfixture project memory note.\n',
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/wiki/hubs/atlas-hub.md`,
		'# Atlas Hub\n\nAtlasfixture wiki note.\n',
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/sources/atlas-source.md`,
		'# Atlas Source\n\nAtlasfixture source note used for recall overlap tests.\n',
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/wiki/concepts/agent-memory-routing.md`,
		'# Agent 外置记忆路由\n\n主动召回本地知识库，并在任务结束时沉淀项目记忆。\n',
		vaultRoot
	);
	writeFile(
		`${KNOWLEDGE_DIR}/wiki/concepts/common-chinese-noise.md`,
		'# 常见中文噪声\n\n这是一个只有“知识”二字重叠的无关说明。\n',
		vaultRoot
	);
}

function assertLintKinds(issues, expectedKinds) {
	const actualKinds = new Set(issues.map((issue) => issue.kind));
	for (const kind of expectedKinds) {
		assert.equal(actualKinds.has(kind), true, `Expected lint kind "${kind}" to be present`);
	}
}

function fileVersionForPath(filePath) {
	const stats = fs.statSync(filePath);
	return knowledgeIndexModule.computeFileVersion(stats.size, stats.mtime.toISOString());
}

function normalizeSnapshotNotes(snapshot) {
	const normalized = [];
	for (const [notePath, note] of snapshot.notes.entries()) {
		normalized.push({
			path: notePath,
			title: note.title,
			aliases: [...note.aliases],
			type: note.type,
			tags: [...note.tags],
			fileVersion: note.fileVersion,
			backlinks: [...note.backlinks],
		});
	}

	return normalized.sort((left, right) => left.path.localeCompare(right.path));
}

function scannedCharacterizationNote(relativePath, content, modifiedAt = '2026-07-30T00:00:00.000Z') {
	return scanModule.scannedNoteFromContent({
		absolutePath: path.resolve('/characterization-vault', relativePath),
		relativePath,
		fallbackTitle: path.basename(relativePath, path.extname(relativePath)),
		size: Buffer.byteLength(content, 'utf8'),
		modifiedAt,
		content,
	});
}

function characterizationScan(vaultRoot, notes) {
	return {
		vaultRoot,
		scannedAt: '2026-07-30T00:00:00.000Z',
		notes,
		errors: [],
	};
}

function normalizeDeterministicSnapshot(snapshot) {
	return {
		notes: [...snapshot.notes.entries()].map(([notePath, note]) => ({
			notePath,
			title: note.title,
			aliases: [...note.aliases],
			contentHash: note.contentHash,
			edges: note.edges.map((edge) => ({
				raw: edge.raw,
				target: edge.target,
				source: edge.source,
				kind: edge.kind,
				resolution: edge.resolution,
			})),
			backlinks: [...note.backlinks],
		})),
		outgoing: [...snapshot.graph.outgoing.entries()],
		incoming: [...snapshot.graph.incoming.entries()],
		edges: snapshot.graph.edges.map((edge) => ({
			sourcePath: edge.sourcePath,
			raw: edge.raw,
			resolution: edge.resolution,
		})),
		unresolvedEdges: snapshot.graph.unresolvedEdges.map((edge) => ({
			sourcePath: edge.sourcePath,
			raw: edge.raw,
			resolution: edge.resolution,
		})),
		byType: [...snapshot.scopes.byType.entries()],
		byTag: [...snapshot.scopes.byTag.entries()],
	};
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

async function runCharacterizationRows(suite, rows) {
	const passed = [];
	const failures = [];

	for (const [name, execute] of rows) {
		try {
			await execute();
			passed.push(name);
			process.stdout.write(`${JSON.stringify({ suite, row: name, result: 'pass' })}\n`);
		} catch (error) {
			failures.push({ name, error });
			process.stdout.write(`${JSON.stringify({
				suite,
				row: name,
				result: 'fail',
				error: errorMessage(error),
			})}\n`);
		}
	}

	process.stdout.write(`${JSON.stringify({
		suite,
		result: failures.length === 0 ? 'pass' : 'expected-characterization-failures',
		passed,
		failed: failures.map(({ name }) => name),
	})}\n`);

	if (failures.length > 0) {
		throw new AggregateError(
			failures.map(({ name }) => name),
			`${suite} failed rows: ${failures.map(({ name }) => name).join(', ')}`
		);
	}
}

async function run() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-core-test-'));
	let symlinkSupported = false;
	let directorySymlinkSupported = false;

	try {
		const vaultRoot = createFixture(tempRoot);
		createSourceSeed(vaultRoot);
		createGraphAndLintFixture(vaultRoot);
		createReciprocalCase(vaultRoot);
		createRecallHygieneFixture(vaultRoot);

		const results = { skipped: [] };
		const rootConfigPath = path.join(vaultRoot, CONFIG_DIR, 'config.json');
		const outsideFile = path.join(tempRoot, 'outside.md');
		fs.writeFileSync(outsideFile, 'outside', 'utf8');
		const repo = new vaultRepositoryModule.NodeFsVaultRepository({
			vaultRoot,
			allowHidden: false,
			protectedDirectoryName: CONFIG_DIR,
		});

		const derivedAlpha = projectMemoryModule.deriveProjectIdentityFromRepoPath(
			'/Users/example/work/alpha/'
		);
		const derivedAlphaFromFileUrl = projectMemoryModule.deriveProjectIdentityFromRepoPath(
			'file:///Users/example/work/alpha'
		);
		const derivedOtherAlpha = projectMemoryModule.deriveProjectIdentityFromRepoPath(
			'/Users/example/other/alpha'
		);
		const derivedWindowsAlpha = projectMemoryModule.deriveProjectIdentityFromRepoPath(
			'C:\\work\\alpha'
		);
		const derivedWindowsAlphaFromFileUrl =
			projectMemoryModule.deriveProjectIdentityFromRepoPath('file:///C:/work/alpha');
		assert.deepEqual(derivedAlpha, derivedAlphaFromFileUrl);
		assert.deepEqual(derivedWindowsAlpha, derivedWindowsAlphaFromFileUrl);
		assert.equal(projectMemoryModule.normalizeProjectAgentType('Claude Code'), 'claude-code');
		assert.equal(projectMemoryModule.normalizeProjectAgentType('../codex'), 'custom');
		assert.notEqual(derivedAlpha.project_id, derivedOtherAlpha.project_id);
		assert.notEqual(derivedAlpha.project_key, derivedOtherAlpha.project_key);
		assert.equal(derivedAlpha.repo_path, '/Users/example/work/alpha');
		assert.throws(
			() => projectMemoryModule.deriveProjectIdentityFromRepoPath('../alpha'),
			/absolute/
		);
		assert.throws(
			() => projectMemoryModule.deriveProjectIdentityFromRepoPath('/Users/example/../alpha'),
			/traversal/
		);

		const projectHub = `${KNOWLEDGE_DIR}/memory/projects/${derivedAlpha.project_key}/index.md`;
		assert.deepEqual(
			projectMemoryModule.deriveProjectMemoryHubBindingFromRepoPath(
				derivedAlpha.repo_path
			),
			{
				project_id: derivedAlpha.project_id,
				project_key: derivedAlpha.project_key,
				project_hub: projectHub,
				repo_path: derivedAlpha.repo_path,
				project_hint: 'alpha',
			}
		);
		const operationBase = {
			project_id: derivedAlpha.project_id,
			agent_type: 'codex',
			task_id: 'task-123',
			operation_id: 'finish-task-456',
			operation_kind: 'finish_task',
			memory_kinds: ['task_decision', 'project_next_action'],
			status: 'active',
			project_hub: `[[${projectHub.replace(/\.md$/, '')}]]`,
			related_wiki: [
				'[[01_knowledge/wiki/example-b]]',
				'[[01_knowledge/wiki/example-a]]',
			],
			supersedes: [],
			body: 'Decision body.\r\n',
		};
		const operationHash = projectMemoryModule.computeProjectMemoryOperationHash(
			operationBase
		);
		const equivalentOperationHash = projectMemoryModule.computeProjectMemoryOperationHash({
			...operationBase,
			memory_kinds: [...operationBase.memory_kinds].reverse(),
			related_wiki: [...operationBase.related_wiki].reverse(),
			body: 'Decision body.\n',
		});
		const changedOperationHash = projectMemoryModule.computeProjectMemoryOperationHash({
			...operationBase,
			body: 'Changed decision body.\n',
		});
		assert.match(operationHash, /^sha256:[a-f0-9]{64}$/);
		assert.equal(operationHash, equivalentOperationHash);
		assert.notEqual(operationHash, changedOperationHash);
		assert.deepEqual(
			projectMemoryModule.compareProjectMemoryOperationHashes(operationHash, equivalentOperationHash),
			{ status: 'exact_retry', operation_hash: operationHash }
		);
		assert.deepEqual(
			projectMemoryModule.compareProjectMemoryOperationHashes(operationHash, changedOperationHash),
			{
				status: 'conflict',
				existing_operation_hash: operationHash,
				requested_operation_hash: changedOperationHash,
			}
		);

		const entryPath = projectMemoryModule.buildProjectMemoryEntryPath({
			projectKey: derivedAlpha.project_key,
			agentType: 'codex',
			operationKind: 'finish_task',
			operationId: 'finish-task-456',
		});
		assert.equal(
			entryPath,
			`${KNOWLEDGE_DIR}/memory/projects/${derivedAlpha.project_key}/agents/codex/finish_task-finish-task-456.md`
		);
		assert.notEqual(
			entryPath,
			projectMemoryModule.buildProjectMemoryEntryPath({
				projectKey: derivedAlpha.project_key,
				agentType: 'claude-code',
				operationKind: 'finish_task',
				operationId: 'finish-task-456',
			})
		);
		assert.notEqual(
			entryPath,
			projectMemoryModule.buildProjectMemoryEntryPath({
				projectKey: derivedAlpha.project_key,
				agentType: 'codex',
				operationKind: 'finish_task',
				operationId: 'finish-task-789',
			})
		);
		for (const unsafeInput of [
			{
				projectKey: '../alpha',
				agentType: 'codex',
				operationKind: 'finish_task',
				operationId: 'finish-task-456',
			},
			{
				projectKey: derivedAlpha.project_key,
				agentType: '../codex',
				operationKind: 'finish_task',
				operationId: 'finish-task-456',
			},
			{
				projectKey: derivedAlpha.project_key,
				agentType: 'codex',
				operationKind: '../finish_task',
				operationId: 'finish-task-456',
			},
			{
				projectKey: derivedAlpha.project_key,
				agentType: 'codex',
				operationKind: 'finish_task',
				operationId: '../finish-task-456',
			},
		]) {
			assert.throws(
				() => projectMemoryModule.buildProjectMemoryEntryPath(unsafeInput),
				/invalid|unsafe|traversal/i
			);
		}

		const entryFrontmatter = {
			schema_version: 1,
			type: 'project_memory_entry',
			project_id: derivedAlpha.project_id,
			agent_type: 'codex',
			task_id: 'task-123',
			operation_id: 'finish-task-456',
			operation_kind: 'finish_task',
			memory_kinds: ['task_decision', 'project_next_action'],
			status: 'active',
			created_at: '2026-07-30T12:00:00.000Z',
			operation_hash: operationHash,
			project_hub: `[[${projectHub.replace(/\.md$/, '')}]]`,
			related_wiki: ['[[01_knowledge/wiki/example]]'],
			supersedes: [],
		};
		const builtEntry = projectMemoryModule.buildProjectMemoryEntry({
			...operationBase,
			project_key: derivedAlpha.project_key,
			created_at: '2026-07-30T12:00:00.000Z',
		});
		assert.equal(builtEntry.entry.path, entryPath);
		assert.equal(builtEntry.entry.operation_hash, operationHash);
		assert.equal(builtEntry.body, 'Decision body.\n');
		const parsedEntry = projectMemoryModule.parseProjectMemoryEntry({
			path: entryPath,
			frontmatter: entryFrontmatter,
		});
		assert.equal(parsedEntry.schema_version, 1);
		assert.equal(parsedEntry.project_id, derivedAlpha.project_id);
		assert.equal(parsedEntry.path, entryPath);
		assert.throws(
			() =>
				projectMemoryModule.parseProjectMemoryEntry({
					path: entryPath,
					frontmatter: { ...entryFrontmatter, project_id: '' },
				}),
			/project_id/
		);
		assert.throws(
			() =>
				projectMemoryModule.parseProjectMemoryEntry({
					path: entryPath,
					frontmatter: { ...entryFrontmatter, schema_version: 2 },
				}),
			/schema_version/
		);

		const legacyPath = `${KNOWLEDGE_DIR}/memory/projects/${derivedAlpha.project_key}/memory.md`;
		assert.deepEqual(
			projectMemoryModule.classifyProjectMemoryNote({
				path: legacyPath,
				frontmatter: {},
			}),
			{
				kind: 'legacy',
				path: legacyPath,
				project_key: derivedAlpha.project_key,
				project_id: null,
			}
		);
		assert.equal(
			projectMemoryModule.classifyProjectMemoryNote({
				path: entryPath,
				frontmatter: entryFrontmatter,
			}).kind,
			'entry'
		);
		assert.deepEqual(
			projectMemoryModule.classifyProjectMemoryNote({
				path: `${KNOWLEDGE_DIR}/wiki/example.md`,
				frontmatter: {},
			}),
			{
				kind: 'unrelated',
				path: `${KNOWLEDGE_DIR}/wiki/example.md`,
			}
		);

		const projectBinding = {
			project_id: derivedAlpha.project_id,
			project_key: derivedAlpha.project_key,
			project_hub: projectHub,
			repo_path: derivedAlpha.repo_path,
		};
		assert.deepEqual(
			projectMemoryModule.parseProjectMemoryHub({
				path: projectHub,
				frontmatter: {
					schema_version: 1,
					type: 'project_memory_index',
					project_id: derivedAlpha.project_id,
					project_key: derivedAlpha.project_key,
					repo_path: derivedAlpha.repo_path,
				},
			}),
			projectBinding
		);
		const otherProjectBinding = {
			project_id: derivedOtherAlpha.project_id,
			project_key: derivedOtherAlpha.project_key,
			project_hub: `${KNOWLEDGE_DIR}/memory/projects/${derivedOtherAlpha.project_key}/index.md`,
			repo_path: derivedOtherAlpha.repo_path,
		};
		assert.deepEqual(
			projectMemoryModule.validateProjectMemoryOwnership([
				projectBinding,
				otherProjectBinding,
			]),
			[projectBinding, otherProjectBinding]
		);
		assert.throws(
			() =>
				projectMemoryModule.validateProjectMemoryOwnership([
					projectBinding,
					{ ...otherProjectBinding, project_id: projectBinding.project_id },
				]),
			/duplicate project_id/
		);
		assert.throws(
			() =>
				projectMemoryModule.resolveProjectMemoryNoteOwnership(
					projectMemoryModule.classifyProjectMemoryNote({
						path: legacyPath,
						frontmatter: { project_id: otherProjectBinding.project_id },
					}),
					[projectBinding, otherProjectBinding]
				),
			/ambiguous|conflict/
		);

		const catalogEntries = [
			{
				path: entryPath,
				legacy: false,
				project_id: derivedAlpha.project_id,
				agent_type: 'codex',
				operation_id: 'finish-task-456',
				operation_kind: 'finish_task',
				status: 'active',
				operation_hash: operationHash,
				created_at: '2026-07-30T12:00:00.000Z',
			},
			{
				path: projectMemoryModule.buildProjectMemoryEntryPath({
					projectKey: derivedAlpha.project_key,
					agentType: 'claude-code',
					operationKind: 'propose_memory',
					operationId: 'proposal-100',
				}),
				legacy: false,
				project_id: derivedAlpha.project_id,
				agent_type: 'claude-code',
				operation_id: 'proposal-100',
				operation_kind: 'propose_memory',
				status: 'active',
				operation_hash: changedOperationHash,
				created_at: '2026-07-31T12:00:00.000Z',
			},
			{
				path: projectMemoryModule.buildProjectMemoryEntryPath({
					projectKey: derivedAlpha.project_key,
					agentType: 'codex',
					operationKind: 'propose_memory',
					operationId: 'proposal-050',
				}),
				legacy: false,
				project_id: derivedAlpha.project_id,
				agent_type: 'codex',
				operation_id: 'proposal-050',
				operation_kind: 'propose_memory',
				status: 'disputed',
				operation_hash: changedOperationHash,
				created_at: '2026-07-31T12:00:00.000Z',
			},
			{
				path: legacyPath,
				legacy: true,
				project_id: derivedAlpha.project_id,
				agent_type: null,
				operation_id: null,
				operation_kind: null,
				status: null,
				operation_hash: null,
				created_at: null,
			},
		];
		const firstCatalogPage = projectMemoryModule.buildProjectMemoryCatalogPage({
			projectId: derivedAlpha.project_id,
			projectHub,
			generation: 7,
			entries: catalogEntries,
			pageSize: 2,
		});
		assert.equal(firstCatalogPage.sort, 'created_at_desc_operation_id_path_asc');
		assert.equal(firstCatalogPage.total, 4);
		assert.deepEqual(firstCatalogPage.counts_by_agent, {
			'claude-code': 1,
			codex: 2,
		});
		assert.equal(firstCatalogPage.complete, true);
		assert.deepEqual(
			firstCatalogPage.entries.map((entry) => entry.operation_id),
			['proposal-050', 'proposal-100']
		);
		assert.equal(typeof firstCatalogPage.page.next_cursor, 'string');
		const secondCatalogPage = projectMemoryModule.buildProjectMemoryCatalogPage({
			projectId: derivedAlpha.project_id,
			projectHub,
			generation: 7,
			entries: catalogEntries,
			pageSize: 2,
			cursor: firstCatalogPage.page.next_cursor,
		});
		assert.deepEqual(
			secondCatalogPage.entries.map((entry) => entry.operation_id),
			['finish-task-456', null]
		);
		assert.equal(secondCatalogPage.page.next_cursor, null);
		assert.deepEqual(
			projectMemoryModule.buildProjectMemoryCatalogPage({
				projectId: derivedAlpha.project_id,
				projectHub,
				generation: 7,
				entries: [...catalogEntries].reverse(),
				pageSize: 2,
			}).entries,
			firstCatalogPage.entries
		);
		assert.throws(
			() =>
				projectMemoryModule.buildProjectMemoryCatalogPage({
					projectId: derivedAlpha.project_id,
					projectHub,
					generation: 8,
					entries: catalogEntries,
					pageSize: 2,
					cursor: firstCatalogPage.page.next_cursor,
				}),
			(error) =>
				error instanceof projectMemoryModule.StaleProjectMemoryCursorError &&
				error.code === 'stale_project_memory_cursor'
		);
		assert.throws(
			() =>
				projectMemoryModule.buildProjectMemoryCatalogPage({
					projectId: otherProjectBinding.project_id,
					projectHub: otherProjectBinding.project_hub,
					generation: 7,
					entries: [],
					pageSize: 2,
					cursor: firstCatalogPage.page.next_cursor,
				}),
			(error) =>
				error instanceof projectMemoryModule.ProjectMemoryCursorError &&
				error.code === 'invalid_project_memory_cursor'
		);
		const tamperedCursor =
			`${firstCatalogPage.page.next_cursor.slice(0, -1)}${
				firstCatalogPage.page.next_cursor.endsWith('A') ? 'B' : 'A'
			}`;
		assert.throws(
			() =>
				projectMemoryModule.buildProjectMemoryCatalogPage({
					projectId: derivedAlpha.project_id,
					projectHub,
					generation: 7,
					entries: catalogEntries,
					pageSize: 2,
					cursor: tamperedCursor,
				}),
			(error) =>
				error instanceof projectMemoryModule.ProjectMemoryCursorError &&
				error.code === 'invalid_project_memory_cursor'
		);
		assert.throws(
			() =>
				projectMemoryModule.buildProjectMemoryCatalogPage({
					projectId: derivedAlpha.project_id,
					projectHub,
					generation: 7,
					entries: [catalogEntries[0], { ...catalogEntries[0] }],
					pageSize: 2,
				}),
			/duplicate operation identity|duplicate path/
		);
		assert.throws(
			() =>
				projectMemoryModule.buildProjectMemoryCatalogPage({
					projectId: derivedAlpha.project_id,
					projectHub,
					generation: 7,
					entries: [{
						...catalogEntries[1],
						project_id: derivedAlpha.project_id,
						path: projectMemoryModule.buildProjectMemoryEntryPath({
							projectKey: derivedOtherAlpha.project_key,
							agentType: 'claude-code',
							operationKind: 'propose_memory',
							operationId: 'proposal-100',
						}),
					}],
					pageSize: 2,
				}),
			/another project_key/
		);

		const completeCatalogEntries = Array.from({ length: 57 }, (_, index) => {
			const operationId = `bulk-${String(index).padStart(3, '0')}`;
			const agentType = index % 2 === 0 ? 'codex' : 'claude-code';
			return {
				path: projectMemoryModule.buildProjectMemoryEntryPath({
					projectKey: derivedAlpha.project_key,
					agentType,
					operationKind: 'finish_task',
					operationId,
				}),
				legacy: false,
				project_id: derivedAlpha.project_id,
				agent_type: agentType,
				operation_id: operationId,
				operation_kind: 'finish_task',
				status: 'active',
				operation_hash: operationHash,
				created_at: new Date(
					Date.UTC(2026, 6, 30, 0, 0, index)
				).toISOString(),
			};
		});
		let completeCatalogCursor = null;
		const enumeratedCatalogPaths = [];
		do {
			const page = projectMemoryModule.buildProjectMemoryCatalogPage({
				projectId: derivedAlpha.project_id,
				projectHub,
				generation: 11,
				entries: completeCatalogEntries,
				pageSize: 20,
				cursor: completeCatalogCursor,
			});
			enumeratedCatalogPaths.push(...page.entries.map((entry) => entry.path));
			completeCatalogCursor = page.page.next_cursor;
			assert.equal(page.total, 57);
			assert.deepEqual(page.counts_by_agent, {
				'claude-code': 28,
				codex: 29,
			});
		} while (completeCatalogCursor);
		assert.equal(enumeratedCatalogPaths.length, 57);
		assert.equal(new Set(enumeratedCatalogPaths).size, 57);
		process.stdout.write(`${JSON.stringify({
			suite: 'core-project-memory',
			result: 'pass',
			rows: [
				'repository-derived-identity',
				'collision-free-entry-paths',
				'canonical-operation-hash',
				'exact-retry-and-conflict',
				'entry-schema-and-legacy-classification',
				'ownership-rejection',
				'catalog-order-counts-and-pagination',
				'generation-bound-cursor-rejection',
			],
		})}\n`);

		assert.equal(safety.isSafeDirectoryName(CONFIG_DIR, { protectedDirectoryName: CONFIG_DIR }), false);
		assert.equal(safety.isSafeDirectoryName('.hidden', { allowHidden: false }), false);
		assert.equal(safety.isSafeDirectoryName('.hidden', { allowHidden: true }), true);

		assert.equal(safety.isSafeDirectoryName('notes'), true);
		assert.equal(safety.isSafeDirectoryName('..'), false);
		assert.equal(safety.ensureInsideVaultRoot(vaultRoot, path.join(vaultRoot, '00_tracekeeper/control/system.md')), path.join(vaultRoot, '00_tracekeeper/control/system.md'));
		assert.throws(() => safety.ensureInsideVaultRoot(vaultRoot, outsideFile), /outside vault root/);
		assert.throws(() => safety.ensureInsideVaultRoot(vaultRoot, path.join(vaultRoot, '../outside.md')), /outside vault root/);
		assert.equal(fs.existsSync(rootConfigPath), true);

		const scanBeforeSymlink = scanModule.scanVault(vaultRoot, { vaultConfigDir: CONFIG_DIR });
		assert.ok(scanBeforeSymlink.notes.some((note) => note.relativePath === '00_tracekeeper/control/system.md'));
		assert.ok(!scanBeforeSymlink.notes.some((note) => note.relativePath.startsWith(`${CONFIG_DIR}/`)), 'Expected vault config directory to be skipped');

		const recallScan = scanModule.scanVault(vaultRoot, { vaultConfigDir: CONFIG_DIR });
		const recallPriorityMatches = recallModule.recallNotes(recallScan.notes, 'atlasfixture', { limit: 8 });
		assert.ok(recallPriorityMatches.length > 0, 'recall should include atlasfixture fixtures');
		assert.equal(recallPriorityMatches[0].note.relativePath, `${KNOWLEDGE_DIR}/memory/projects/atlas/memory.md`);
		assert.ok(
			!recallPriorityMatches.some((match) =>
				match.note.relativePath.startsWith('00_tracekeeper/control/') || match.note.relativePath.startsWith('00_tracekeeper/inbox/')
			),
			'control and inbox paths should be excluded from recall candidates'
		);
		const recallMatches = recallModule.recallNotes(recallScan.notes, 'recall priority', { limit: 3 });
		assert.ok(recallMatches.length > 0, 'recall should return at least one result');
		assert.equal(recallMatches[0].note.relativePath, `${KNOWLEDGE_DIR}/wiki/concepts/recall-priority.md`);
		const chineseRecallMatches = recallModule.recallNotes(recallScan.notes, '如何让 Agent 主动使用外置知识库', { limit: 6 });
		assert.ok(
			chineseRecallMatches.some((match) => match.note.relativePath === `${KNOWLEDGE_DIR}/wiki/concepts/agent-memory-routing.md`),
			'Chinese recall should match overlapping bounded n-grams'
		);
		assert.ok(
			!chineseRecallMatches.some((match) => match.note.relativePath === `${KNOWLEDGE_DIR}/wiki/concepts/common-chinese-noise.md`),
			'a single incidental Chinese n-gram should not produce a recall match'
		);

		const graphHealth = graphHealthModule.analyzeGraphHealth(scanBeforeSymlink.notes, { maxItems: 10 });
		const advisoryGraphProfile = graphHealthModule.evaluateGraphProfile(graphHealth, 'advisory');
		assert.equal(advisoryGraphProfile.profile, 'advisory');
		assert.equal(advisoryGraphProfile.disabled, false);
		assert.ok(advisoryGraphProfile.profile_issues.every((issue) => issue.severity === 'warning'));
		const strictGraphProfile = graphHealthModule.evaluateGraphProfile(graphHealth, 'strict');
		assert.equal(strictGraphProfile.profile, 'strict');
		assert.ok(strictGraphProfile.profile_issues.some((issue) => issue.severity === 'error'));
		const offGraphProfile = graphHealthModule.evaluateGraphProfile(graphHealth, 'off');
		assert.equal(offGraphProfile.profile, 'off');
		assert.equal(offGraphProfile.disabled, true);
		assert.equal(offGraphProfile.profile_issues.length, 0);

		const advisoryLint = lintModule.lintNotes(vaultRoot, scanBeforeSymlink.notes, {
			graphHealth,
			graphProfile: 'advisory',
		});
		assert.ok(advisoryLint.issues.some((issue) => issue.kind.startsWith('graph_') && issue.severity === 'warning'));
		assertLintKinds(advisoryLint.issues, [
			'architecture_legacy_directory',
			'architecture_missing_required_path',
			'architecture_invalid_wiki_path',
			'graph_missing_memory_wiki_bridge',
			'graph_missing_wiki_memory_backlink',
			'graph_missing_project_index',
			'graph_yaml_only_relation',
		]);

		const strictLint = lintModule.lintNotes(vaultRoot, scanBeforeSymlink.notes, {
			graphHealth,
			graphProfile: 'strict',
		});
		assert.ok(strictLint.issues.some((issue) => issue.kind.startsWith('graph_') && issue.severity === 'error'));
		const offLint = lintModule.lintNotes(vaultRoot, scanBeforeSymlink.notes, {
			graphHealth,
			graphProfile: 'off',
		});
		assert.equal(offLint.issues.some((issue) => issue.kind.startsWith('graph_')), false);

		const linkedTarget = path.join(vaultRoot, '01_knowledge', 'sources', 'target.md');
		const linkedSource = path.join(vaultRoot, '01_knowledge', 'sources', 'symlink_source.md');
		fs.mkdirSync(path.dirname(linkedTarget), { recursive: true });
		fs.writeFileSync(linkedTarget, '# Target\n', 'utf8');

		try {
			fs.symlinkSync(linkedTarget, linkedSource, process.platform === 'win32' ? 'file' : undefined);
			symlinkSupported = true;
		} catch {
			symlinkSupported = false;
			results.skipped.push('symlink');
		}

		if (symlinkSupported) {
			const scanWithSymlink = scanModule.scanVault(vaultRoot, { vaultConfigDir: CONFIG_DIR });
			assert.equal(scanWithSymlink.notes.some((note) => note.relativePath === '01_knowledge/sources/symlink_source.md'), false);
		} else {
			console.log('SKIP: platform does not support creating symlinks in this environment');
		}

		const sourceAnalysis = sourceAnalysisModule.analyzeSourceText({
			source: '01_knowledge/sources/source_seed.md',
			sourceKind: 'local_file',
			analysisMode: 'default',
			purpose: 'smoke test for source analysis',
			content: '# Source\n\nThis is a claim that indicates a source-backed fact and provides evidence.',
			requestPath: '00_tracekeeper/inbox/agent_requests/request.md',
		});

		assert.ok(typeof sourceAnalysis.summary === 'string' && sourceAnalysis.summary.length > 0);
		assert.ok(typeof sourceAnalysis.excerpt === 'string');
		assert.equal(Array.isArray(sourceAnalysis.evidenceScaffolds), true);
		assert.equal(Array.isArray(sourceAnalysis.claimScaffolds), true);
		assert.equal(Array.isArray(sourceAnalysis.proposalDrafts), true);

		const zhSourceAnalysis = sourceAnalysisModule.analyzeSourceText({
			source: '01_knowledge/sources/中文来源.md',
			sourceKind: 'local_file',
			analysisMode: 'default',
			purpose: '验证中文来源分析',
			contentLanguage: 'zh-CN',
			content: '# 来源\n\n这项研究表明本地知识库需要保留来源证据。',
		});
		assert.match(zhSourceAnalysis.summary, /目的：验证中文来源分析/);
		assert.match(zhSourceAnalysis.claimScaffolds.join('\n'), /主张：/);
		assert.match(zhSourceAnalysis.proposalDrafts[0].title, /来源分析：/);
		assert.match(zhSourceAnalysis.proposalDrafts[0].content, /## 提案草稿/);

		const sourceTarget = legacyStructureModule.getLegacyStructureTarget('03_sources/web/example.md');
		assert.deepEqual(sourceTarget, {
			oldPath: '03_sources/web/example.md',
			newPath: '01_knowledge/sources/web/example.md',
			kind: 'source',
		});
		const wikiTarget = legacyStructureModule.getLegacyStructureTarget('04_memory/concepts/topic.md');
		assert.deepEqual(wikiTarget, {
			oldPath: '04_memory/concepts/topic.md',
			newPath: '01_knowledge/wiki/concepts/topic.md',
			kind: 'wiki_concept',
		});
		const dashboardTarget = legacyStructureModule.getLegacyStructureTarget('00_control/dashboards/knowledge.base');
		assert.deepEqual(dashboardTarget, {
			oldPath: '00_control/dashboards/knowledge.base',
			newPath: '00_tracekeeper/control/dashboards/knowledge.base',
			kind: 'dashboard',
		});
		const enrichedMemory = legacyStructureModule.enrichLegacyMarkdownContent('# Preference\n', {
			migrationId: 'legacy-test',
			oldPath: '04_memory/preferences/style.md',
			newPath: '01_knowledge/memory/global/preferences/style.md',
			kind: 'memory_global',
		});
		assert.match(enrichedMemory, /## Tracekeeper migration/);
		assert.match(enrichedMemory, /## Graph links/);
		const enrichedWiki = legacyStructureModule.enrichLegacyMarkdownContent('# Topic\n', {
			migrationId: 'legacy-test',
			oldPath: '04_memory/concepts/topic.md',
			newPath: '01_knowledge/wiki/concepts/topic.md',
			kind: 'wiki_concept',
		});
		assert.match(enrichedWiki, /## Related memory/);
		const review = legacyStructureModule.renderLegacyMigrationReview({
			migrationId: 'legacy-test',
			oldPath: '00_control/system.md',
			newPath: '00_tracekeeper/control/system.md',
			kind: 'control',
			reason: 'conflict',
			sourceContent: '# Old system',
		});
		assert.match(review, /type: legacy_migration_review/);
		assert.match(review, /source_path: "00_control\/system.md"/);

			const operationJournalDirectory = path.join(vaultRoot, 'operation-journal');
			let stepResult = [];
			const fixedOperationTime = '2026-07-22T00:00:00.000Z';
			const completedPayloadSecret = 'PRIVATE-COMPLETED-PAYLOAD';
			const completedResultSecret = 'PRIVATE-COMPLETED-RESULT';
		const normalRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-normal',
			idempotencyKey: 'idempotency-normal',
				payload: { value: completedPayloadSecret },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			clock: () => fixedOperationTime,
			steps: [
				{
					name: 'step-1',
					execute: async () => {
						stepResult.push('step-1');
					},
				},
				{
					name: 'step-2',
					execute: async () => {
						stepResult.push('step-2');
					},
				},
				],
				finalize: async () => {
					return { status: 'completed', steps: 2, summary: completedResultSecret };
				},
			});
			const normalOutcome = await normalRunner.run();
			assert.deepEqual(normalOutcome, {
				status: 'completed',
				steps: 2,
				summary: completedResultSecret,
			});
		assert.deepEqual(stepResult, ['step-1', 'step-2']);
		const normalRecord = await new operationJournalModule.NodeFileOperationJournal({
			directory: operationJournalDirectory,
		}).loadById('op-normal');
		assert.equal(normalRecord?.created_at, fixedOperationTime);
		assert.equal(normalRecord?.updated_at, fixedOperationTime);
			assert.deepEqual(normalRecord?.completed_steps.map((step) => step.completed_at), [
				fixedOperationTime,
				fixedOperationTime,
			]);
			assert.deepEqual(normalRecord?.result, normalOutcome);
			const normalPersistedRaw = fs.readFileSync(
				path.join(operationJournalDirectory, 'op-normal.json'),
				'utf8'
			);
			const normalPersisted = JSON.parse(normalPersistedRaw);
			assert.equal(Object.prototype.hasOwnProperty.call(normalPersisted, 'payload'), false);
			assert.equal(typeof normalPersisted.payload_encrypted?.ciphertext, 'string');
			assert.equal(Object.prototype.hasOwnProperty.call(normalPersisted, 'result'), false);
			assert.equal(typeof normalPersisted.result_encrypted?.ciphertext, 'string');
			assert.equal(normalPersistedRaw.includes(completedPayloadSecret), false);
			assert.equal(normalPersistedRaw.includes(completedResultSecret), false);

		const persistedStepJournal = new operationJournalModule.NodeFileOperationJournal({
			directory: operationJournalDirectory,
		});
		let persistedStepExecutions = 0;
		let observedCompletedStepRecords = [];
		const persistedStepConfig = {
			operationId: 'op-persisted-step-result',
			idempotencyKey: 'idempotency-persisted-step-result',
			payload: { value: 'persisted-step-result' },
			journal: persistedStepJournal,
			steps: [
				{
					name: 'capture_receipt',
					persistResult: true,
					execute: async () => {
						persistedStepExecutions += 1;
						return {
							receipt_id: 'receipt-1',
							target_path: '01_knowledge/wiki/topic.md',
						};
					},
				},
				{
					name: 'consume_receipt',
					execute: async (_payload, context) => {
						observedCompletedStepRecords = context.completedSteps;
						return { must_not_be_persisted: true };
					},
				},
			],
			finalize: async () => ({ status: 'persisted-step-result-complete' }),
		};
		let interruptPersistedStep = true;
		const interruptedPersistedStepRunner = new operationJournalModule.RecoverableOperationRunner({
			...persistedStepConfig,
			failureInjection: (context) => {
				if (
					interruptPersistedStep
					&& context.phase === 'before_step'
					&& context.stepName === 'consume_receipt'
				) {
					interruptPersistedStep = false;
					throw new Error('interrupt after persisted receipt');
				}
			},
		});
		await assert.rejects(
			() => interruptedPersistedStepRunner.run(),
			/interrupt after persisted receipt/
		);
		const interruptedPersistedStepRecord = await persistedStepJournal.loadById(
			'op-persisted-step-result'
		);
		assert.equal(interruptedPersistedStepRecord?.status, 'failed');
		assert.equal(
			Object.prototype.hasOwnProperty.call(interruptedPersistedStepRecord, 'result'),
			false
		);
		assert.deepEqual(interruptedPersistedStepRecord?.completed_steps[0]?.result, {
			receipt_id: 'receipt-1',
			target_path: '01_knowledge/wiki/topic.md',
		});
		const persistedStepOutcome = await new operationJournalModule.RecoverableOperationRunner(
			persistedStepConfig
		).run();
		assert.deepEqual(persistedStepOutcome, {
			status: 'persisted-step-result-complete',
		});
		assert.equal(persistedStepExecutions, 1);
		assert.deepEqual(observedCompletedStepRecords, [{
			name: 'capture_receipt',
			completed_at: interruptedPersistedStepRecord.completed_steps[0].completed_at,
			result: {
				receipt_id: 'receipt-1',
				target_path: '01_knowledge/wiki/topic.md',
			},
		}]);
		const completedPersistedStepRecord = await persistedStepJournal.loadById(
			'op-persisted-step-result'
		);
		assert.equal(
			Object.prototype.hasOwnProperty.call(
				completedPersistedStepRecord?.completed_steps[0] || {},
				'result'
			),
			true
		);
		assert.equal(
			Object.prototype.hasOwnProperty.call(
				completedPersistedStepRecord?.completed_steps[1] || {},
				'result'
			),
			false
		);

		const oversizedStepResult = 'PRIVATE-STEP-RESULT'.repeat(2_000);
		const oversizedStepRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-oversized-step-result',
			idempotencyKey: 'idempotency-oversized-step-result',
			payload: { value: 'oversized-step-result' },
			journal: persistedStepJournal,
			steps: [{
				name: 'oversized_receipt',
				persistResult: true,
				execute: async () => ({ body: oversizedStepResult }),
			}],
			finalize: async () => ({ status: 'must-not-complete' }),
		});
		await assert.rejects(
			() => oversizedStepRunner.run(),
			/persisted operation step result exceeds/i
		);
		const oversizedStepRecord = await persistedStepJournal.loadById(
			'op-oversized-step-result'
		);
		assert.equal(oversizedStepRecord?.status, 'failed');
		assert.deepEqual(oversizedStepRecord?.completed_steps, []);
		assert.equal(JSON.stringify(oversizedStepRecord).includes(oversizedStepResult), false);

		const concurrentSteps = [];
		const concurrentRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-concurrent',
			idempotencyKey: 'idempotency-concurrent',
			payload: { value: 'concurrent' },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			steps: [
				{
					name: 'slow-step',
					execute: async () => {
						await new Promise((resolve) => setTimeout(resolve, 30));
						concurrentSteps.push('slow-step');
					},
				},
			],
			finalize: async () => {
				concurrentSteps.push('finalize');
				return { status: 'ok' };
			},
		});
		const concurrentResults = await Promise.all([
			concurrentRunner.run(),
			concurrentRunner.run(),
		]);
		assert.deepEqual(concurrentResults, [{ status: 'ok' }, { status: 'ok' }]);
		assert.deepEqual(concurrentSteps, ['slow-step', 'finalize']);

		const processLockDirectory = path.join(vaultRoot, 'operation-journal-process-lock');
		const firstProcessJournal = new operationJournalModule.NodeFileOperationJournal({
			directory: processLockDirectory,
			lockWaitTimeoutMs: 1_000,
		});
		const secondProcessJournal = new operationJournalModule.NodeFileOperationJournal({
			directory: processLockDirectory,
			lockWaitTimeoutMs: 1_000,
		});
		const releaseFirstProcessLock = await firstProcessJournal.acquireLock('shared-process-key');
		let secondLockAcquired = false;
		const secondLockPromise = secondProcessJournal.acquireLock('shared-process-key').then((release) => {
			secondLockAcquired = true;
			return release;
		});
		await new Promise((resolve) => setTimeout(resolve, 40));
		assert.equal(secondLockAcquired, false);
		await releaseFirstProcessLock();
		const releaseSecondProcessLock = await secondLockPromise;
		assert.equal(secondLockAcquired, true);
		await releaseSecondProcessLock();

		const orphanLockKey = 'orphan-empty-lock';
		const orphanLockHash = createHash('sha256').update(orphanLockKey).digest('hex');
		const orphanLockPath = path.join(
			processLockDirectory,
			`.idempotency-${orphanLockHash}.lock`
		);
		fs.writeFileSync(orphanLockPath, '', 'utf8');
		const staleLockTime = new Date(Date.now() - 2_000);
		fs.utimesSync(orphanLockPath, staleLockTime, staleLockTime);
		const orphanLockJournal = new operationJournalModule.NodeFileOperationJournal({
			directory: processLockDirectory,
			lockWaitTimeoutMs: 1_000,
		});
		const releaseRecoveredOrphanLock = await orphanLockJournal.acquireLock(orphanLockKey);
		await releaseRecoveredOrphanLock();
		assert.equal(fs.existsSync(orphanLockPath), false);

		const claimJournal = new operationJournalModule.NodeFileOperationJournal({ directory: processLockDirectory });
		const claimBase = {
			idempotency_key: 'atomic-claim-key',
			payload_hash: operationJournalModule.computePayloadHash({ claim: true }),
			payload: { claim: true },
			status: 'in_progress',
			created_at: fixedOperationTime,
			updated_at: fixedOperationTime,
			completed_steps: [],
		};
		const claimResults = await Promise.all([
			claimJournal.claim({ ...claimBase, operation_id: 'atomic-claim-a' }),
			claimJournal.claim({ ...claimBase, operation_id: 'atomic-claim-b' }),
		]);
		assert.equal(claimResults.filter(Boolean).length, 1);
		const claimedRecord = await claimJournal.loadByIdempotencyKey('atomic-claim-key');
		assert.ok(claimedRecord);
		assert.equal(claimedRecord.operation_id, claimResults[0] ? 'atomic-claim-a' : 'atomic-claim-b');

		const replayRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-normal',
			idempotencyKey: 'idempotency-normal',
				payload: { value: completedPayloadSecret },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			steps: [
				{
					name: 'step-1',
					execute: async () => {
						stepResult.push('replayed-step-1');
					},
				},
				{
					name: 'step-2',
					execute: async () => {
						stepResult.push('replayed-step-2');
					},
				},
			],
			finalize: async () => ({ status: 'should-not-run' }),
		});
		const replayOutcome = await replayRunner.run();
		assert.deepEqual(replayOutcome, normalOutcome);
		assert.deepEqual(stepResult, ['step-1', 'step-2']);
		const normalRecordBaseline = await new operationJournalModule.NodeFileOperationJournal({
			directory: operationJournalDirectory,
		}).loadById('op-normal');
		assert.equal(normalRecordBaseline?.status, 'completed');
		assert.deepEqual(normalRecordBaseline?.result, normalOutcome);

		const operationIdConflictRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-normal-id-mismatch',
			idempotencyKey: 'idempotency-normal',
				payload: { value: completedPayloadSecret },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			steps: [],
			finalize: async () => ({ status: 'id-mismatch' }),
		});
		await assert.rejects(
			() => operationIdConflictRunner.run(),
			(error) => {
				return error instanceof operationJournalModule.OperationConflictError
					&& /idempotency key conflict/i.test(error.message);
			}
		);
		const normalRecordAfterOperationIdConflict = await new operationJournalModule.NodeFileOperationJournal({
			directory: operationJournalDirectory,
		}).loadById('op-normal');
		assert.deepEqual(normalRecordAfterOperationIdConflict, normalRecordBaseline);

		const crossToolConflictRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'start-task-smoke-cross',
			idempotencyKey: 'idempotency-normal',
			payload: { value: 'cross-tool-start' },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			steps: [],
			finalize: async () => ({ status: 'cross-tool-conflict' }),
		});
		await assert.rejects(
			() => crossToolConflictRunner.run(),
			(error) => {
				return error instanceof operationJournalModule.OperationConflictError
					&& /idempotency key conflict/i.test(error.message);
			}
		);
		const normalRecordAfterCrossToolConflict = await new operationJournalModule.NodeFileOperationJournal({
			directory: operationJournalDirectory,
		}).loadById('op-normal');
		assert.deepEqual(normalRecordAfterCrossToolConflict, normalRecordBaseline);

		const conflictRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-normal',
			idempotencyKey: 'idempotency-normal',
			payload: { value: 99 },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			steps: [],
			finalize: async () => ({ status: 'conflict' }),
		});
		await assert.rejects(
			() => conflictRunner.run(),
			(error) => {
				return error instanceof operationJournalModule.OperationConflictError && /idempotency key conflict/i.test(error.message);
			}
		);
		const recordAfterConflict = await new operationJournalModule.NodeFileOperationJournal({
			directory: operationJournalDirectory,
		}).loadById('op-normal');
		assert.equal(recordAfterConflict?.status, 'completed');
		assert.deepEqual(recordAfterConflict?.result, normalOutcome);

		const failureSteps = [];
		const failureRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-failure',
			idempotencyKey: 'idempotency-failure',
			payload: { value: 'retry' },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			steps: [
				{
					name: 'prepare',
					execute: async () => {
						failureSteps.push('prepare');
					},
				},
				{
					name: 'write',
					execute: async () => {
						failureSteps.push('write');
					},
				},
				{
					name: 'final',
					execute: async () => {
						failureSteps.push('final');
					},
				},
			],
			finalize: async () => {
				failureSteps.push('finalize');
				return { status: 'done' };
			},
			failureInjection: (context) => {
				if (context.phase === 'after_step' && context.stepName === 'prepare') {
					throw new Error('simulated failure');
				}
			},
		});
		await assert.rejects(
			() => failureRunner.run(),
			(error) => {
				return error instanceof Error && error.message === 'simulated failure';
			}
		);
		assert.deepEqual(failureSteps, ['prepare']);
		const recoverableAfterFailure = await new operationJournalModule.NodeFileOperationJournal({
			directory: operationJournalDirectory,
		}).listRecoverable();
			const recoverableFailure = recoverableAfterFailure.find((record) => record.operation_id === 'op-failure');
			assert.deepEqual(recoverableFailure?.payload, { value: 'retry' });
			assert.equal(recoverableFailure?.status, 'failed');
			const failedOperationPath = path.join(operationJournalDirectory, 'op-failure.json');
			const failedOperationRaw = fs.readFileSync(failedOperationPath, 'utf8');
			const failedOperationPersisted = JSON.parse(failedOperationRaw);
			assert.equal(Object.prototype.hasOwnProperty.call(failedOperationPersisted, 'payload'), false);
			assert.equal(typeof failedOperationPersisted.payload_encrypted?.ciphertext, 'string');
			assert.equal(failedOperationRaw.includes('retry'), false);

		const resumeRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-failure',
			idempotencyKey: 'idempotency-failure',
			payload: { value: 'retry' },
			journal: new operationJournalModule.NodeFileOperationJournal({ directory: operationJournalDirectory }),
			steps: [
				{
					name: 'prepare',
					execute: async () => {
						failureSteps.push('prepare');
					},
				},
				{
					name: 'write',
					execute: async () => {
						failureSteps.push('write');
					},
				},
				{
					name: 'final',
					execute: async () => {
						failureSteps.push('final');
					},
				},
			],
			finalize: async () => {
				failureSteps.push('finalize');
				return { status: 'done', steps: failureSteps.length };
			},
		});
		const resumedOutcome = await resumeRunner.run();
		assert.deepEqual(failureSteps, ['prepare', 'write', 'final', 'finalize']);
		assert.deepEqual(resumedOutcome, { status: 'done', steps: 4 });
			const recoverableAfterResume = await new operationJournalModule.NodeFileOperationJournal({
				directory: operationJournalDirectory,
			}).listRecoverable();
			assert.equal(recoverableAfterResume.some((record) => record.operation_id === 'op-failure'), false);
			const completedFailureRaw = fs.readFileSync(failedOperationPath, 'utf8');
			const regressedFailureRecord = JSON.parse(completedFailureRaw);
			regressedFailureRecord.completed_steps = regressedFailureRecord.completed_steps.slice(0, 1);
			fs.writeFileSync(
				failedOperationPath,
				`${JSON.stringify(regressedFailureRecord, null, 2)}\n`,
				'utf8'
			);
			const restoredFailureRecord = await new operationJournalModule.NodeFileOperationJournal({
				directory: operationJournalDirectory,
			}).loadById('op-failure');
			assert.deepEqual(
				restoredFailureRecord?.completed_steps.map((step) => step.name),
				['prepare', 'write', 'final']
			);
			fs.writeFileSync(failedOperationPath, completedFailureRaw, 'utf8');

		const auditCheckpointJournal = new operationJournalModule.NodeFileOperationJournal({
			directory: operationJournalDirectory,
		});
		let auditCheckpointAttempts = 0;
		const auditCheckpointConfig = {
			operationId: 'op-audit-checkpoint',
			idempotencyKey: 'idempotency-audit-checkpoint',
			payload: { value: 'audit-checkpoint' },
			journal: auditCheckpointJournal,
			steps: [{
				name: 'append_audit',
				failureStatus: 'activity_pending',
				execute: async () => {
					auditCheckpointAttempts += 1;
					const checkpoint = await auditCheckpointJournal.loadById('op-audit-checkpoint');
					assert.equal(checkpoint?.status, 'activity_pending');
					if (auditCheckpointAttempts === 1) {
						throw new Error('activity effect interrupted before step checkpoint');
					}
				},
			}],
			finalize: async () => ({ status: 'audit-checkpoint-complete' }),
		};
		await assert.rejects(
			() => new operationJournalModule.RecoverableOperationRunner(auditCheckpointConfig).run(),
			/activity effect interrupted/
		);
		const pendingAuditCheckpoint = await auditCheckpointJournal.loadById('op-audit-checkpoint');
		assert.equal(pendingAuditCheckpoint?.status, 'activity_pending');
		assert.deepEqual(pendingAuditCheckpoint?.completed_steps, []);
		const auditCheckpointOutcome = await new operationJournalModule.RecoverableOperationRunner({
			...auditCheckpointConfig,
			failureInjection: async (context) => {
				if (context.phase === 'after_step' && context.stepName === 'append_audit') {
					const checkpoint = await auditCheckpointJournal.loadById('op-audit-checkpoint');
					assert.equal(checkpoint?.status, 'in_progress');
				}
			},
		}).run();
		assert.deepEqual(auditCheckpointOutcome, {
			status: 'audit-checkpoint-complete',
		});
		assert.equal(auditCheckpointAttempts, 2);
		assert.equal(
			(await auditCheckpointJournal.loadById('op-audit-checkpoint'))?.status,
			'completed'
		);

		const absoluteSensitivePath = path.join(vaultRoot, 'private', 'proposal.md');
		const sanitizedErrorJournal = new operationJournalModule.NodeFileOperationJournal({
			directory: operationJournalDirectory,
		});
		await sanitizedErrorJournal.save({
			operation_id: 'op-sanitized-error',
			idempotency_key: 'idempotency-sanitized-error',
			payload_hash: operationJournalModule.computePayloadHash({ value: 'sanitized-error' }),
			payload: { value: 'sanitized-error' },
			status: 'failed',
			created_at: fixedOperationTime,
			updated_at: fixedOperationTime,
			completed_steps: [],
			error: `Cannot read ${absoluteSensitivePath}; token=super-secret-token`,
			failed_at: fixedOperationTime,
		});
		const sanitizedErrorRecord = await sanitizedErrorJournal.loadById('op-sanitized-error');
		assert.equal(sanitizedErrorRecord?.error.includes(absoluteSensitivePath), false);
		assert.equal(sanitizedErrorRecord?.error.includes('super-secret-token'), false);
		assert.match(sanitizedErrorRecord?.error || '', /\[redacted-path\]/);
		assert.match(sanitizedErrorRecord?.error || '', /token=\[redacted\]/);
		assert.equal(Buffer.byteLength(sanitizedErrorRecord?.error || '', 'utf8') <= 512, true);

		let dynamicFailureSelectorObservedError = false;
		let terminalConflictStepExecutions = 0;
		const sensitiveConflictText = 'PRIVATE-WRITEBACK-BODY '.repeat(80);
		const terminalConflictConfig = {
			operationId: 'op-terminal-conflict',
			idempotencyKey: 'idempotency-terminal-conflict',
			payload: { value: 'terminal-conflict' },
			journal: sanitizedErrorJournal,
			steps: [{
				name: 'detect_conflict',
				execute: async () => {
					terminalConflictStepExecutions += 1;
					throw new Error(
						`writeback conflict at ${absoluteSensitivePath}: ${sensitiveConflictText}`
					);
				},
				failureStatus: (error) => {
					dynamicFailureSelectorObservedError = error instanceof Error
						&& /writeback conflict/.test(error.message);
					return 'conflicted';
				},
			}],
			finalize: async () => ({ status: 'must-not-complete' }),
		};
		await assert.rejects(
			() => new operationJournalModule.RecoverableOperationRunner(terminalConflictConfig).run(),
			/writeback conflict/
		);
		assert.equal(dynamicFailureSelectorObservedError, true);
		const terminalConflictRecord = await sanitizedErrorJournal.loadById('op-terminal-conflict');
		assert.equal(terminalConflictRecord?.status, 'conflicted');
		assert.equal(terminalConflictRecord?.error.includes(absoluteSensitivePath), false);
		assert.equal(terminalConflictRecord?.error.includes('PRIVATE-WRITEBACK-BODY'), false);
		assert.equal(Buffer.byteLength(terminalConflictRecord?.error || '', 'utf8') <= 512, true);
		const recoverableWithoutConflict = await sanitizedErrorJournal.listRecoverable();
		assert.equal(
			recoverableWithoutConflict.some((record) => record.operation_id === 'op-terminal-conflict'),
			false
		);
		await assert.rejects(
			() => new operationJournalModule.RecoverableOperationRunner(terminalConflictConfig).run(),
			(error) => error instanceof operationJournalModule.OperationConflictError
		);
		assert.equal(terminalConflictStepExecutions, 1);

		const forgedPrefixDirectory = path.join(vaultRoot, 'operation-journal-forged-prefix');
		const forgedPrefixJournal = new operationJournalModule.NodeFileOperationJournal({
			directory: forgedPrefixDirectory,
		});
		fs.mkdirSync(forgedPrefixDirectory, { recursive: true });
		const forgedPrefixPayload = { value: 'forged-prefix' };
		fs.writeFileSync(
			path.join(forgedPrefixDirectory, 'op-forged-prefix.json'),
			`${JSON.stringify({
				operation_id: 'op-forged-prefix',
				idempotency_key: 'idempotency-forged-prefix',
				payload_hash: operationJournalModule.computePayloadHash(forgedPrefixPayload),
				payload: forgedPrefixPayload,
				status: 'failed',
				created_at: fixedOperationTime,
				updated_at: fixedOperationTime,
				completed_steps: [{
					name: 'append_audit',
					completed_at: fixedOperationTime,
				}],
				error: 'forged step prefix',
				failed_at: fixedOperationTime,
			}, null, 2)}\n`,
			'utf8'
		);
		let forgedPrefixExecutions = 0;
		const forgedPrefixRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-forged-prefix',
			idempotencyKey: 'idempotency-forged-prefix',
			payload: forgedPrefixPayload,
			journal: forgedPrefixJournal,
			steps: [
				{
					name: 'apply_target',
					execute: async () => {
						forgedPrefixExecutions += 1;
					},
				},
				{
					name: 'append_audit',
					execute: async () => {
						forgedPrefixExecutions += 1;
					},
				},
			],
			finalize: async () => ({ status: 'must-not-complete' }),
		});
		await assert.rejects(
			() => forgedPrefixRunner.run(),
			(error) => error instanceof operationJournalModule.CorruptedOperationJournalError
				&& /unique ordered prefix/.test(error.message)
		);
		assert.equal(forgedPrefixExecutions, 0);

		const incompleteCompletedPayload = { value: 'incomplete-completed' };
		fs.writeFileSync(
			path.join(forgedPrefixDirectory, 'op-incomplete-completed.json'),
			`${JSON.stringify({
				operation_id: 'op-incomplete-completed',
				idempotency_key: 'idempotency-incomplete-completed',
				payload_hash: operationJournalModule.computePayloadHash(incompleteCompletedPayload),
				payload: incompleteCompletedPayload,
				status: 'completed',
				created_at: fixedOperationTime,
				updated_at: fixedOperationTime,
				completed_steps: [{
					name: 'apply_target',
					completed_at: fixedOperationTime,
				}],
				result: { forged: true },
			}, null, 2)}\n`,
			'utf8'
		);
		const incompleteCompletedRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-incomplete-completed',
			idempotencyKey: 'idempotency-incomplete-completed',
			payload: incompleteCompletedPayload,
			journal: forgedPrefixJournal,
			steps: [
				{ name: 'apply_target', execute: async () => undefined },
				{ name: 'append_audit', execute: async () => undefined },
			],
			finalize: async () => ({ status: 'must-not-complete' }),
		});
		await assert.rejects(
			() => incompleteCompletedRunner.run(),
			(error) => error instanceof operationJournalModule.CorruptedOperationJournalError
				&& /does not contain every configured step/.test(error.message)
		);

		const invariantJournalDirectory = path.join(vaultRoot, 'operation-journal-invariants');
		const invariantJournal = new operationJournalModule.NodeFileOperationJournal({
			directory: invariantJournalDirectory,
		});
		fs.mkdirSync(invariantJournalDirectory, { recursive: true });
		const invariantBase = {
			idempotency_key: 'idempotency-invariant',
			payload_hash: operationJournalModule.computePayloadHash({ value: 'invariant' }),
			payload: { value: 'invariant' },
			created_at: fixedOperationTime,
			updated_at: fixedOperationTime,
			completed_steps: [],
		};
		fs.writeFileSync(
			path.join(invariantJournalDirectory, 'op-completed-missing-result.json'),
			`${JSON.stringify({
				...invariantBase,
				operation_id: 'op-completed-missing-result',
				status: 'completed',
			}, null, 2)}\n`,
			'utf8'
		);
		await assert.rejects(
			() => invariantJournal.loadById('op-completed-missing-result'),
			(error) => error instanceof operationJournalModule.CorruptedOperationJournalError
				&& /missing result/.test(error.message)
		);
		fs.writeFileSync(
			path.join(invariantJournalDirectory, 'op-failed-with-result.json'),
			`${JSON.stringify({
				...invariantBase,
				operation_id: 'op-failed-with-result',
				status: 'failed',
				result: { forged: true },
				error: 'failed invariant',
				failed_at: fixedOperationTime,
			}, null, 2)}\n`,
			'utf8'
		);
		await assert.rejects(
			() => invariantJournal.loadById('op-failed-with-result'),
			(error) => error instanceof operationJournalModule.CorruptedOperationJournalError
				&& /non-completed.*result/.test(error.message)
		);
		fs.writeFileSync(
			path.join(invariantJournalDirectory, 'op-duplicate-steps.json'),
			`${JSON.stringify({
				...invariantBase,
				operation_id: 'op-duplicate-steps',
				status: 'failed',
				completed_steps: [
					{ name: 'duplicate', completed_at: fixedOperationTime },
					{ name: 'duplicate', completed_at: fixedOperationTime },
				],
				error: 'duplicate steps',
				failed_at: fixedOperationTime,
			}, null, 2)}\n`,
			'utf8'
		);
		await assert.rejects(
			() => invariantJournal.loadById('op-duplicate-steps'),
			(error) => error instanceof operationJournalModule.CorruptedOperationJournalError
				&& /duplicate names/.test(error.message)
		);

		const corruptedJournalDir = path.join(vaultRoot, 'operation-journal-corrupt');
		const corruptedJournal = new operationJournalModule.NodeFileOperationJournal({ directory: corruptedJournalDir });
		const corruptedPath = path.join(corruptedJournalDir, 'op-corrupt.json');
		fs.mkdirSync(corruptedJournalDir, { recursive: true });
		fs.writeFileSync(corruptedPath, '{bad json', 'utf8');
		const corruptedRunner = new operationJournalModule.RecoverableOperationRunner({
			operationId: 'op-corrupt',
			idempotencyKey: 'idempotency-corrupt',
			payload: { value: 'corrupt' },
			journal: corruptedJournal,
			steps: [
				{
					name: 'never',
					execute: async () => {
						assert.fail('should not execute due corrupted journal');
					},
				},
			],
			finalize: async () => ({ status: 'corrupt' }),
		});
		await assert.rejects(() => corruptedRunner.run(), (error) => error instanceof operationJournalModule.CorruptedOperationJournalError);

		const transitionEnvironment = {
			now: '2026-07-30T03:00:00.000Z',
			actor: 'user',
			targetExists: (targetPath) =>
				targetPath === '01_knowledge/memory/projects/demo/memory.md'
				|| targetPath === '01_knowledge/wiki/topic.md',
		};
		const proposalSnapshot = {
			path: '00_tracekeeper/inbox/review_queue/proposal.md',
			classification: 'memory_proposal',
			proposalId: 'proposal-atomic',
			proposalKind: 'project_update',
			taskId: 'task-atomic',
			status: 'pending',
			targetPath: '01_knowledge/memory/projects/demo/memory.md',
			writebackContent: '- private proposal body',
			revisionComment: '',
			revisionRequestedAt: '',
			revisionRequestedBy: '',
		};
		const proposalRevision = proposalTransitionModule.computeProposalRevision(proposalSnapshot);
		assert.equal(
			proposalRevision,
			proposalTransitionModule.computeProposalRevision({ ...proposalSnapshot })
		);
		assert.equal(
			proposalRevision,
			proposalTransitionModule.computeProposalRevision({
				...proposalSnapshot,
				writebackContent: '- changed private proposal body',
			})
		);
		assert.notEqual(
			proposalTransitionModule.computeProposalContentHash(proposalSnapshot),
			proposalTransitionModule.computeProposalContentHash({
				...proposalSnapshot,
				writebackContent: '- changed private proposal body',
			})
		);
		assert.equal(
			proposalTransitionModule.isAllowedProposalTargetPath(
				'01_knowledge/memory/projects/demo/memory.md'
			),
			true
		);
		assert.equal(
			proposalTransitionModule.isAllowedProposalTargetPath('01_knowledge/wiki/topic.md'),
			true
		);
		assert.equal(
			proposalTransitionModule.isAllowedProposalTargetPath('05_misc/outside.md'),
			false
		);

		const approveCommand = {
			expectedRevision: proposalRevision,
			expectedContentHash:
				proposalTransitionModule.computeProposalContentHash(proposalSnapshot),
			operationId: 'review-approve-atomic',
			action: { kind: 'status', nextStatus: 'approved' },
		};
		const approvedDecision = proposalTransitionModule.transitionProposal(
			proposalSnapshot,
			approveCommand,
			transitionEnvironment
		);
		assert.equal(approvedDecision.state.status, 'approved');
		assert.equal(approvedDecision.frontmatter.approval_status, 'approved');
		assert.equal(approvedDecision.frontmatter.status, 'approved');
		assert.equal(approvedDecision.receipt.previousStatus, 'pending');
		assert.equal(approvedDecision.receipt.nextStatus, 'approved');
		assert.equal(approvedDecision.receipt.previousRevision, proposalRevision);
		assert.equal(
			approvedDecision.receipt.committedRevision,
			proposalTransitionModule.computeProposalRevision(approvedDecision.state)
		);
		assert.equal(
			JSON.stringify(approvedDecision.receipt).includes('private proposal body'),
			false
		);
		assert.deepEqual(
			proposalTransitionModule.proposalTransitionReceiptFromFrontmatter(
				approvedDecision.frontmatter
			),
			approvedDecision.receipt
		);
		const lifecycleTarget = '01_knowledge/memory/projects/demo/agents/codex/new-record.md';
		const lifecycleSnapshot = {
			...proposalSnapshot,
			proposalId: 'proposal-lifecycle-create',
			targetPath: lifecycleTarget,
		};
		const lifecycleApproval = proposalTransitionModule.transitionProposal(
			lifecycleSnapshot,
			{
				expectedRevision: proposalTransitionModule.computeProposalRevision(lifecycleSnapshot),
				expectedContentHash: proposalTransitionModule.computeProposalContentHash(lifecycleSnapshot),
				operationId: 'review-approve-lifecycle-create',
				action: { kind: 'status', nextStatus: 'approved' },
			},
			{
				...transitionEnvironment,
				targetCreationAllowed: (targetPath) => targetPath === lifecycleTarget,
			}
		);
		assert.equal(lifecycleApproval.state.status, 'approved');
		assert.equal(lifecycleApproval.state.targetPath, lifecycleTarget);
		assert.throws(
			() => proposalTransitionModule.transitionProposal(
				lifecycleSnapshot,
				{
					expectedRevision: proposalTransitionModule.computeProposalRevision(lifecycleSnapshot),
					expectedContentHash: proposalTransitionModule.computeProposalContentHash(lifecycleSnapshot),
					operationId: 'review-reject-missing-append-target',
					action: { kind: 'status', nextStatus: 'approved' },
				},
				transitionEnvironment
			),
			/target does not exist/i
		);
		const explicitCreateWikiMissing = {
			...proposalSnapshot,
			proposalId: 'proposal-explicit-create-wiki-missing',
			targetPath: '01_knowledge/wiki/new-create-wiki-note.md',
			writebackEffect: 'create_wiki_note',
		};
		const explicitCreateWikiMissingDecision =
			proposalTransitionModule.transitionProposal(
				explicitCreateWikiMissing,
				{
					expectedRevision:
						proposalTransitionModule.computeProposalRevision(explicitCreateWikiMissing),
					expectedContentHash:
						proposalTransitionModule.computeProposalContentHash(explicitCreateWikiMissing),
					operationId: 'review-create-wiki-note-missing',
					action: { kind: 'status', nextStatus: 'approved' },
				},
				transitionEnvironment
			);
		assert.equal(explicitCreateWikiMissingDecision.state.status, 'approved');
		assert.equal(
			explicitCreateWikiMissingDecision.state.targetPath,
			explicitCreateWikiMissing.targetPath
		);
		assert.throws(
			() => proposalTransitionModule.transitionProposal(
				{
					...proposalSnapshot,
					proposalId: 'proposal-create-wiki-occupied',
					targetPath: '01_knowledge/wiki/topic.md',
					writebackEffect: 'create_wiki_note',
				},
				{
					expectedRevision: proposalTransitionModule.computeProposalRevision({
						...proposalSnapshot,
						proposalId: 'proposal-create-wiki-occupied',
						targetPath: '01_knowledge/wiki/topic.md',
						writebackEffect: 'create_wiki_note',
					}),
					expectedContentHash: proposalTransitionModule.computeProposalContentHash({
						...proposalSnapshot,
						proposalId: 'proposal-create-wiki-occupied',
						targetPath: '01_knowledge/wiki/topic.md',
						writebackEffect: 'create_wiki_note',
					}),
					operationId: 'review-create-wiki-note-occupied',
					action: { kind: 'status', nextStatus: 'approved' },
				},
				transitionEnvironment
			),
			/target already exists/i
		);
		assert.throws(
			() => proposalTransitionModule.transitionProposal(
				{
					...proposalSnapshot,
					proposalId: 'proposal-append-missing',
					targetPath: '01_knowledge/wiki/missing-append.md',
					writebackEffect: 'append',
				},
				{
					expectedRevision: proposalTransitionModule.computeProposalRevision({
						...proposalSnapshot,
						proposalId: 'proposal-append-missing',
						targetPath: '01_knowledge/wiki/missing-append.md',
						writebackEffect: 'append',
					}),
					expectedContentHash: proposalTransitionModule.computeProposalContentHash({
						...proposalSnapshot,
						proposalId: 'proposal-append-missing',
						targetPath: '01_knowledge/wiki/missing-append.md',
						writebackEffect: 'append',
					}),
					operationId: 'review-append-missing',
					action: { kind: 'status', nextStatus: 'approved' },
				},
				transitionEnvironment
			),
			/target does not exist/i
		);
		const explicitCreateMemoryWithClaim = proposalTransitionModule.transitionProposal(
			{
				...proposalSnapshot,
				proposalId: 'proposal-create-memory-with-claim',
				targetPath: '01_knowledge/memory/new-memory-with-claim.md',
				writebackEffect: 'create_memory_record',
			},
			{
				expectedRevision: proposalTransitionModule.computeProposalRevision({
					...proposalSnapshot,
					proposalId: 'proposal-create-memory-with-claim',
					targetPath: '01_knowledge/memory/new-memory-with-claim.md',
					writebackEffect: 'create_memory_record',
				}),
				expectedContentHash: proposalTransitionModule.computeProposalContentHash({
					...proposalSnapshot,
					proposalId: 'proposal-create-memory-with-claim',
					targetPath: '01_knowledge/memory/new-memory-with-claim.md',
					writebackEffect: 'create_memory_record',
				}),
				operationId: 'review-create-memory-with-claim',
				action: { kind: 'status', nextStatus: 'approved' },
			},
			{
				...transitionEnvironment,
				targetCreationAllowed: () => true,
			}
		);
		assert.equal(explicitCreateMemoryWithClaim.state.status, 'approved');
		assert.throws(
			() => proposalTransitionModule.transitionProposal(
				{
					...proposalSnapshot,
					proposalId: 'proposal-create-memory-no-claim',
					targetPath: '01_knowledge/memory/new-memory-no-claim.md',
					writebackEffect: 'create_memory_record',
				},
				{
					expectedRevision: proposalTransitionModule.computeProposalRevision({
						...proposalSnapshot,
						proposalId: 'proposal-create-memory-no-claim',
						targetPath: '01_knowledge/memory/new-memory-no-claim.md',
						writebackEffect: 'create_memory_record',
					}),
					expectedContentHash: proposalTransitionModule.computeProposalContentHash({
						...proposalSnapshot,
						proposalId: 'proposal-create-memory-no-claim',
						targetPath: '01_knowledge/memory/new-memory-no-claim.md',
						writebackEffect: 'create_memory_record',
					}),
					operationId: 'review-create-memory-no-claim',
					action: { kind: 'status', nextStatus: 'approved' },
				},
				transitionEnvironment
			),
			/target does not exist/i
		);
		assert.throws(
			() => proposalTransitionModule.transitionProposal(
				{
					...proposalSnapshot,
					proposalId: 'proposal-create-memory-occupied',
					targetPath: '01_knowledge/memory/projects/demo/memory.md',
					writebackEffect: 'create_memory_record',
				},
				{
					expectedRevision: proposalTransitionModule.computeProposalRevision({
						...proposalSnapshot,
						proposalId: 'proposal-create-memory-occupied',
						targetPath: '01_knowledge/memory/projects/demo/memory.md',
						writebackEffect: 'create_memory_record',
					}),
					expectedContentHash: proposalTransitionModule.computeProposalContentHash({
						...proposalSnapshot,
						proposalId: 'proposal-create-memory-occupied',
						targetPath: '01_knowledge/memory/projects/demo/memory.md',
						writebackEffect: 'create_memory_record',
					}),
					operationId: 'review-create-memory-occupied',
					action: { kind: 'status', nextStatus: 'approved' },
				},
				{
					...transitionEnvironment,
					targetCreationAllowed: () => true,
				}
			),
			/target already exists/i
		);
		assert.throws(
			() => proposalTransitionModule.transitionProposal(
				{
					...proposalSnapshot,
					proposalId: 'proposal-legacy-missing-memory-no-claim',
					targetPath: '01_knowledge/memory/new-legacy-memory.md',
				},
				{
					expectedRevision: proposalTransitionModule.computeProposalRevision({
						...proposalSnapshot,
						proposalId: 'proposal-legacy-missing-memory-no-claim',
						targetPath: '01_knowledge/memory/new-legacy-memory.md',
					}),
					expectedContentHash: proposalTransitionModule.computeProposalContentHash({
						...proposalSnapshot,
						proposalId: 'proposal-legacy-missing-memory-no-claim',
						targetPath: '01_knowledge/memory/new-legacy-memory.md',
					}),
					operationId: 'review-legacy-missing-memory-no-claim',
					action: { kind: 'status', nextStatus: 'approved' },
				},
				{
					...transitionEnvironment,
					targetCreationAllowed: () => false,
				}
			),
			/target does not exist/i
		);
		const legacyMemoryWithClaim = proposalTransitionModule.transitionProposal(
			{
				...proposalSnapshot,
				proposalId: 'proposal-legacy-missing-memory-with-claim',
				targetPath: '01_knowledge/memory/new-legacy-memory-with-claim.md',
			},
			{
				expectedRevision: proposalTransitionModule.computeProposalRevision({
					...proposalSnapshot,
					proposalId: 'proposal-legacy-missing-memory-with-claim',
					targetPath: '01_knowledge/memory/new-legacy-memory-with-claim.md',
				}),
				expectedContentHash: proposalTransitionModule.computeProposalContentHash({
					...proposalSnapshot,
					proposalId: 'proposal-legacy-missing-memory-with-claim',
					targetPath: '01_knowledge/memory/new-legacy-memory-with-claim.md',
				}),
				operationId: 'review-legacy-missing-memory-with-claim',
				action: { kind: 'status', nextStatus: 'approved' },
			},
			{
				...transitionEnvironment,
				targetCreationAllowed: (targetPath) =>
					targetPath === '01_knowledge/memory/new-legacy-memory-with-claim.md',
			}
		);
		assert.equal(legacyMemoryWithClaim.state.status, 'approved');
		const legacyMissingWiki = proposalTransitionModule.transitionProposal(
			{
				...proposalSnapshot,
				proposalId: 'proposal-legacy-missing-wiki',
				targetPath: '01_knowledge/wiki/new-legacy-wiki.md',
			},
			{
				expectedRevision: proposalTransitionModule.computeProposalRevision({
					...proposalSnapshot,
					proposalId: 'proposal-legacy-missing-wiki',
					targetPath: '01_knowledge/wiki/new-legacy-wiki.md',
				}),
				expectedContentHash: proposalTransitionModule.computeProposalContentHash({
					...proposalSnapshot,
					proposalId: 'proposal-legacy-missing-wiki',
					targetPath: '01_knowledge/wiki/new-legacy-wiki.md',
				}),
				operationId: 'review-legacy-missing-wiki',
				action: { kind: 'status', nextStatus: 'approved' },
			},
			transitionEnvironment
		);
		assert.equal(legacyMissingWiki.state.status, 'approved');
		const legacyExistingWiki = proposalTransitionModule.transitionProposal(
			{
				...proposalSnapshot,
				proposalId: 'proposal-legacy-existing-wiki',
				targetPath: '01_knowledge/wiki/topic.md',
				writebackContent: '- updated from legacy existing wiki',
			},
			{
				expectedRevision: proposalTransitionModule.computeProposalRevision({
					...proposalSnapshot,
					proposalId: 'proposal-legacy-existing-wiki',
					targetPath: '01_knowledge/wiki/topic.md',
					writebackContent: '- updated from legacy existing wiki',
				}),
				expectedContentHash: proposalTransitionModule.computeProposalContentHash({
					...proposalSnapshot,
					proposalId: 'proposal-legacy-existing-wiki',
					targetPath: '01_knowledge/wiki/topic.md',
					writebackContent: '- updated from legacy existing wiki',
				}),
				operationId: 'review-legacy-existing-wiki',
				action: { kind: 'status', nextStatus: 'approved' },
			},
			{
				...transitionEnvironment,
				targetCreationAllowed: () => false,
			}
		);
		assert.equal(legacyExistingWiki.state.status, 'approved');
		assert.throws(
			() => proposalTransitionModule.transitionProposal(
				{
					...proposalSnapshot,
					proposalId: 'proposal-legacy-unsupported-effect',
					targetPath: '01_knowledge/wiki/topic.md',
					writebackEffect: 'create-wiki-note',
				},
				{
					expectedRevision: proposalTransitionModule.computeProposalRevision({
						...proposalSnapshot,
						proposalId: 'proposal-legacy-unsupported-effect',
						targetPath: '01_knowledge/wiki/topic.md',
						writebackEffect: 'create-wiki-note',
					}),
					expectedContentHash: proposalTransitionModule.computeProposalContentHash({
						...proposalSnapshot,
						proposalId: 'proposal-legacy-unsupported-effect',
						targetPath: '01_knowledge/wiki/topic.md',
						writebackEffect: 'create-wiki-note',
					}),
					operationId: 'review-legacy-unsupported-effect',
					action: { kind: 'status', nextStatus: 'approved' },
				},
				transitionEnvironment
			),
			(error) => error instanceof proposalTransitionModule.ProposalTransitionValidationError
		);
		assert.throws(
			() => proposalTransitionModule.transitionProposal(
				{
					...proposalSnapshot,
					proposalId: 'proposal-legacy-bad-effect-type',
					targetPath: '01_knowledge/wiki/topic.md',
					writebackEffect: false,
				},
				{
					expectedRevision: proposalTransitionModule.computeProposalRevision({
						...proposalSnapshot,
						proposalId: 'proposal-legacy-bad-effect-type',
						targetPath: '01_knowledge/wiki/topic.md',
						writebackEffect: false,
					}),
					expectedContentHash: proposalTransitionModule.computeProposalContentHash({
						...proposalSnapshot,
						proposalId: 'proposal-legacy-bad-effect-type',
						targetPath: '01_knowledge/wiki/topic.md',
						writebackEffect: false,
					}),
					operationId: 'review-legacy-bad-effect-type',
					action: { kind: 'status', nextStatus: 'approved' },
				},
				transitionEnvironment
			),
			(error) => error instanceof proposalTransitionModule.ProposalTransitionValidationError
		);
		const snapshotWithoutEffect = { ...proposalSnapshot };
		const snapshotWithEffect = { ...proposalSnapshot, writebackEffect: 'append' };
		const snapshotWithExplicitlyMissingEffect = { ...proposalSnapshot, writebackEffect: undefined };
		assert.equal(
			proposalTransitionModule.computeProposalRevision(snapshotWithoutEffect),
			proposalTransitionModule.computeProposalRevision(snapshotWithExplicitlyMissingEffect)
		);
		assert.equal(
			proposalTransitionModule.computeProposalRevision(snapshotWithoutEffect) !==
			proposalTransitionModule.computeProposalRevision(snapshotWithEffect),
			true
		);
		assert.equal(
			proposalTransitionModule.computeProposalContentHash(snapshotWithoutEffect),
			proposalTransitionModule.computeProposalContentHash(snapshotWithExplicitlyMissingEffect)
		);
		assert.equal(
			proposalTransitionModule.computeProposalContentHash(snapshotWithoutEffect) !==
			proposalTransitionModule.computeProposalContentHash(snapshotWithEffect),
			true
		);
		assert.throws(
			() => proposalTransitionModule.transitionProposal(
				{
					...proposalSnapshot,
					proposalId: 'proposal-explicit-create-missing-index',
					targetPath: '01_knowledge/index.md',
					writebackEffect: 'create_wiki_note',
				},
				{
					expectedRevision: proposalTransitionModule.computeProposalRevision({
						...proposalSnapshot,
						proposalId: 'proposal-explicit-create-missing-index',
						targetPath: '01_knowledge/index.md',
						writebackEffect: 'create_wiki_note',
					}),
					expectedContentHash: proposalTransitionModule.computeProposalContentHash({
						...proposalSnapshot,
						proposalId: 'proposal-explicit-create-missing-index',
						targetPath: '01_knowledge/index.md',
						writebackEffect: 'create_wiki_note',
					}),
					operationId: 'review-create-wiki-index',
					action: { kind: 'status', nextStatus: 'approved' },
				},
				{
					...transitionEnvironment,
					targetCreationAllowed: () => true,
				}
			),
			/target does not exist/i
		);
		assert.throws(
			() => proposalTransitionModule.transitionProposal(
				{
					...proposalSnapshot,
					proposalId: 'proposal-create-wiki-to-memory',
					targetPath: '01_knowledge/memory/topics/memory.md',
					writebackEffect: 'create_wiki_note',
				},
				{
					expectedRevision: proposalTransitionModule.computeProposalRevision({
						...proposalSnapshot,
						proposalId: 'proposal-create-wiki-to-memory',
						targetPath: '01_knowledge/memory/topics/memory.md',
						writebackEffect: 'create_wiki_note',
					}),
					expectedContentHash: proposalTransitionModule.computeProposalContentHash({
						...proposalSnapshot,
						proposalId: 'proposal-create-wiki-to-memory',
						targetPath: '01_knowledge/memory/topics/memory.md',
						writebackEffect: 'create_wiki_note',
					}),
					operationId: 'review-create-wiki-to-memory',
					action: { kind: 'status', nextStatus: 'approved' },
				},
				{
					...transitionEnvironment,
					targetCreationAllowed: () => true,
				}
			),
			/target does not exist/i
		);
		assert.throws(
			() => proposalTransitionModule.proposalTransitionReceiptFromFrontmatter({
				review_transition_id: 'incomplete',
			}),
			(error) => error instanceof proposalTransitionModule.ProposalTransitionValidationError
		);
		assert.throws(
			() => proposalTransitionModule.proposalTransitionReceiptFromFrontmatter({
				review_transition_payload_hash: 'orphaned-metadata',
			}),
			(error) => error instanceof proposalTransitionModule.ProposalTransitionValidationError
		);

		const replayedApproval = proposalTransitionModule.transitionProposal(
			approvedDecision.state,
			approveCommand,
			transitionEnvironment
		);
		assert.equal(replayedApproval.replayed, true);
		assert.deepEqual(replayedApproval.receipt, approvedDecision.receipt);
		assert.deepEqual(replayedApproval.frontmatter, {});
		await assert.rejects(
			async () => proposalTransitionModule.transitionProposal(
				approvedDecision.state,
				{
					...approveCommand,
					action: { kind: 'status', nextStatus: 'rejected' },
				},
				transitionEnvironment
			),
			(error) => error instanceof proposalTransitionModule.ProposalTransitionConflictError
		);
		await assert.rejects(
			async () => proposalTransitionModule.transitionProposal(
				approvedDecision.state,
				{
					expectedRevision: proposalRevision,
					operationId: 'review-second-action',
					action: { kind: 'status', nextStatus: 'pending' },
				},
				transitionEnvironment
			),
			(error) => error instanceof proposalTransitionModule.ProposalTransitionConflictError
		);

		for (const [status, allowed] of Object.entries({
			pending: ['approved', 'rejected', 'revision_requested'],
			revision_requested: ['pending'],
			approved: ['pending'],
			rejected: ['pending'],
			deferred: ['pending'],
			applied: [],
		})) {
			const current = {
				...proposalSnapshot,
				status,
			};
			const currentRevision = proposalTransitionModule.computeProposalRevision(current);
			for (const nextStatus of [
				'pending',
				'approved',
				'rejected',
				'deferred',
				'revision_requested',
				'applied',
			]) {
				if (allowed.includes(nextStatus)) {
					const decision = proposalTransitionModule.transitionProposal(
						current,
						{
							expectedRevision: currentRevision,
							...(nextStatus === 'approved'
								? {
									expectedContentHash:
										proposalTransitionModule.computeProposalContentHash(current),
								}
								: {}),
							operationId: `review-${status}-${nextStatus}`,
							action: { kind: 'status', nextStatus },
						},
						transitionEnvironment
					);
					assert.equal(decision.state.status, nextStatus);
					continue;
				}
				await assert.rejects(
					async () => proposalTransitionModule.transitionProposal(
						current,
						{
							expectedRevision: currentRevision,
							operationId: `review-invalid-${status}-${nextStatus}`,
							action: { kind: 'status', nextStatus },
						},
						transitionEnvironment
					),
					(error) => error instanceof proposalTransitionModule.ProposalTransitionStateError
				);
			}
		}

		const revisionRequestedSnapshot = {
			...proposalSnapshot,
			status: 'revision_requested',
			revisionComment: 'Original revision note',
			revisionRequestedAt: '2026-07-30T02:00:00.000Z',
			revisionRequestedBy: 'user',
		};
		const revisionNoteDecision = proposalTransitionModule.transitionProposal(
			revisionRequestedSnapshot,
			{
				expectedRevision:
					proposalTransitionModule.computeProposalRevision(revisionRequestedSnapshot),
				operationId: 'review-update-revision-note',
				action: {
					kind: 'status',
					nextStatus: 'revision_requested',
					revisionComment: 'Updated revision note',
				},
			},
			transitionEnvironment
		);
		assert.equal(revisionNoteDecision.state.status, 'revision_requested');
		assert.equal(revisionNoteDecision.state.revisionComment, 'Updated revision note');
		assert.equal(revisionNoteDecision.receipt.previousStatus, 'revision_requested');
		assert.equal(revisionNoteDecision.receipt.nextStatus, 'revision_requested');

		const legacyReviewSnapshot = {
			...proposalSnapshot,
			path: '00_tracekeeper/inbox/review_queue/legacy-review.md',
			classification: 'legacy_migration_review',
			proposalId: 'legacy-review',
			proposalKind: 'legacy_migration_review',
			taskId: '',
			targetPath: '',
			writebackContent: '',
		};
		const completedLegacyDecision = proposalTransitionModule.transitionProposal(
			legacyReviewSnapshot,
			{
				expectedRevision:
					proposalTransitionModule.computeProposalRevision(legacyReviewSnapshot),
				operationId: 'review-complete-legacy',
				action: { kind: 'status', nextStatus: 'applied' },
			},
			transitionEnvironment
		);
		assert.equal(completedLegacyDecision.state.status, 'applied');
		assert.equal(completedLegacyDecision.receipt.kind, 'status');

		const applyCommand = {
			expectedRevision: approvedDecision.receipt.committedRevision,
			expectedContentHash:
				proposalTransitionModule.computeProposalContentHash(approvedDecision.state),
			operationId: 'writeback-atomic',
			action: { kind: 'apply' },
		};
		const applyDecision = proposalTransitionModule.transitionProposal(
			approvedDecision.state,
			applyCommand,
			transitionEnvironment
		);
		assert.equal(applyDecision.state.status, 'applied');
		assert.equal(applyDecision.state.appliedOperationId, 'writeback-atomic');
		assert.equal(applyDecision.frontmatter.writeback_operation_id, 'writeback-atomic');
		assert.equal(
			proposalTransitionModule.transitionProposal(
				applyDecision.state,
				applyCommand,
				transitionEnvironment
			).replayed,
			true
		);
		await assert.rejects(
			async () => proposalTransitionModule.transitionProposal(
				{ ...applyDecision.state, archived: true },
				applyCommand,
				transitionEnvironment
			),
			(error) =>
				error instanceof proposalTransitionModule.ProposalTransitionStateError
				|| error instanceof proposalTransitionModule.ProposalTransitionConflictError
		);

		for (const incomplete of [
			{ targetPath: '' },
				{ writebackContent: '' },
				{ writebackContent: 'unknown' },
				{ targetPath: '05_misc/outside.md' },
				{ targetPath: '01_knowledge/memory/missing.md' },
			]) {
			const current = { ...proposalSnapshot, ...incomplete };
			await assert.rejects(
				async () => proposalTransitionModule.transitionProposal(
					current,
					{
						expectedRevision: proposalTransitionModule.computeProposalRevision(current),
						expectedContentHash:
							proposalTransitionModule.computeProposalContentHash(current),
						operationId: `review-incomplete-${Object.keys(incomplete)[0]}`,
						action: { kind: 'status', nextStatus: 'approved' },
					},
					transitionEnvironment
				),
				(error) => error instanceof proposalTransitionModule.ProposalTransitionValidationError
			);
		}
		for (const malformed of [
			{ path: '../outside.md' },
			{ path: 'review\\proposal.md' },
			{ proposalId: '' },
			{ proposalId: ' proposal-atomic ' },
			{ classification: 'unsupported' },
		]) {
			const current = { ...proposalSnapshot, ...malformed };
			await assert.rejects(
				async () => proposalTransitionModule.transitionProposal(
					current,
					{
						expectedRevision: proposalTransitionModule.computeProposalRevision(current),
						operationId: 'review-malformed',
						action: { kind: 'status', nextStatus: 'rejected' },
					},
					transitionEnvironment
				),
				(error) => error instanceof proposalTransitionModule.ProposalTransitionValidationError
			);
		}

		const draftDecision = proposalTransitionModule.transitionProposal(
			{ ...proposalSnapshot, status: 'revision_requested' },
			{
				expectedRevision: proposalTransitionModule.computeProposalRevision({
					...proposalSnapshot,
					status: 'revision_requested',
				}),
				expectedContentHash: proposalTransitionModule.computeProposalContentHash({
					...proposalSnapshot,
					status: 'revision_requested',
				}),
				operationId: 'review-edit-atomic',
				action: {
					kind: 'draft',
					targetPath: '01_knowledge/wiki/topic.md',
					writebackContent: '- revised content',
				},
			},
			transitionEnvironment
		);
		assert.equal(draftDecision.state.targetPath, '01_knowledge/wiki/topic.md');
		assert.equal(draftDecision.state.writebackContent, '- revised content');
		assert.equal(draftDecision.state.status, 'revision_requested');
		await assert.rejects(
			async () => proposalTransitionModule.transitionProposal(
				{
					...proposalSnapshot,
					writebackContent: '- changed after draft render',
				},
				{
					expectedRevision: proposalTransitionModule.computeProposalRevision(proposalSnapshot),
					expectedContentHash:
						proposalTransitionModule.computeProposalContentHash(proposalSnapshot),
					operationId: 'review-edit-stale-content',
					action: {
						kind: 'draft',
						targetPath: '01_knowledge/wiki/topic.md',
						writebackContent: '- user draft',
					},
				},
				transitionEnvironment
			),
			(error) => error instanceof proposalTransitionModule.ProposalTransitionConflictError
		);
		for (const terminal of [
			{ ...proposalSnapshot, status: 'applied' },
			{ ...proposalSnapshot, archived: true },
		]) {
			await assert.rejects(
				async () => proposalTransitionModule.transitionProposal(
					terminal,
					{
						expectedRevision: proposalTransitionModule.computeProposalRevision(terminal),
						expectedContentHash:
							proposalTransitionModule.computeProposalContentHash(terminal),
						operationId: 'review-terminal-edit',
						action: {
							kind: 'draft',
							targetPath: '01_knowledge/wiki/topic.md',
							writebackContent: '- blocked',
						},
					},
					transitionEnvironment
				),
				(error) =>
					error instanceof proposalTransitionModule.ProposalTransitionStateError
					|| error instanceof proposalTransitionModule.ProposalTransitionValidationError
			);
		}

		const repositoryProposalPath = '00_tracekeeper/inbox/review_queue/repository-proposal.md';
		const repositoryInitialState = {
			...proposalSnapshot,
			path: repositoryProposalPath,
		};
		writeFile(repositoryProposalPath, JSON.stringify(repositoryInitialState), vaultRoot);
		const proposalRepository = new vaultRepositoryModule.NodeFsVaultRepository({
			vaultRoot,
			protectedDirectoryName: CONFIG_DIR,
		});
		const repositoryFile = await proposalRepository.readText(repositoryProposalPath);
		const repositoryDecision =
			await proposalTransitionModule.commitProposalTransitionWithRepository(
				proposalRepository,
				{
					parse: (_relativePath, content) => JSON.parse(content),
					apply: (_content, decision) => JSON.stringify(decision.state),
				},
				{
					proposalPath: repositoryProposalPath,
					expectedVersion: repositoryFile.version,
					transition: {
						expectedRevision:
							proposalTransitionModule.computeProposalRevision(repositoryInitialState),
						expectedContentHash:
							proposalTransitionModule.computeProposalContentHash(repositoryInitialState),
						operationId: 'review-repository-approve',
						action: { kind: 'status', nextStatus: 'approved' },
					},
					environment: transitionEnvironment,
				}
			);
		assert.equal(repositoryDecision.state.status, 'approved');
		assert.ok(repositoryDecision.writeReceipt);
		const repositoryCommitted = JSON.parse(
			(await proposalRepository.readText(repositoryProposalPath)).content
		);
		assert.equal(repositoryCommitted.status, 'approved');
		const repositoryReplay =
			await proposalTransitionModule.commitProposalTransitionWithRepository(
				proposalRepository,
				{
					parse: (_relativePath, content) => JSON.parse(content),
					apply: (_content, decision) => JSON.stringify(decision.state),
				},
				{
					proposalPath: repositoryProposalPath,
					expectedVersion: repositoryFile.version,
					transition: {
						expectedRevision:
							proposalTransitionModule.computeProposalRevision(repositoryInitialState),
						expectedContentHash:
							proposalTransitionModule.computeProposalContentHash(repositoryInitialState),
						operationId: 'review-repository-approve',
						action: { kind: 'status', nextStatus: 'approved' },
					},
					environment: transitionEnvironment,
				}
			);
		assert.equal(repositoryReplay.writeReceipt, null);
		assert.deepEqual(repositoryReplay.receipt, repositoryDecision.receipt);

		const initialIndex = new knowledgeIndexModule.InMemoryKnowledgeIndex({
			vaultRoot,
			vaultConfigDir: CONFIG_DIR,
			initialScan: scanBeforeSymlink,
		});
		const uninitializedIndex = new knowledgeIndexModule.InMemoryKnowledgeIndex({
			vaultRoot,
			vaultConfigDir: CONFIG_DIR,
		});
		assert.equal((await uninitializedIndex.snapshot()).index_state, 'initializing');
		await uninitializedIndex.rebuild(scanBeforeSymlink);
		assert.equal((await uninitializedIndex.snapshot()).index_state, 'ready');
		await initialIndex.rebuild(scanBeforeSymlink);
		const baselineSnapshot = await initialIndex.snapshot();
		const scanSnapshot = knowledgeIndexModule.buildKnowledgeSnapshot(scanBeforeSymlink, {
			indexState: 'ready',
			generation: 1,
			lastEvent: null,
			lastRebuild: scanBeforeSymlink.scannedAt,
		});
		assert.deepEqual(normalizeSnapshotNotes(baselineSnapshot), normalizeSnapshotNotes(scanSnapshot));
		assert.equal(baselineSnapshot.index_state, 'ready');

		const incrementalPath = '01_knowledge/wiki/incremental_event.md';
		const incrementalAbsolute = path.join(vaultRoot, incrementalPath);
		writeFile(incrementalPath, '# Incremental Seed\nBody', vaultRoot);
		const createVersion = fileVersionForPath(incrementalAbsolute);

		await initialIndex.apply({
			kind: 'create',
			path: incrementalPath,
			fileVersion: createVersion,
		});
		const afterCreate = await initialIndex.snapshot();
		assert.equal(afterCreate.notes.has(incrementalPath), true);

		const firstCreateCount = afterCreate.notes.size;
		await initialIndex.apply({
			kind: 'create',
			path: incrementalPath,
			fileVersion: createVersion,
		});
		const afterDuplicateCreate = await initialIndex.snapshot();
		assert.equal(afterDuplicateCreate.notes.size, firstCreateCount);
		assert.equal(afterDuplicateCreate.generation, afterCreate.generation);

		const externalPath = '01_knowledge/wiki/obsidian_event.md';
		const externalContent = '# Obsidian Event\nOnly supplied through the adapter.';
		const externalModifiedAt = new Date().toISOString();
		const externalNote = scanModule.scannedNoteFromContent({
			absolutePath: path.join(vaultRoot, externalPath),
			relativePath: externalPath,
			fallbackTitle: 'obsidian_event',
			size: Buffer.byteLength(externalContent),
			modifiedAt: externalModifiedAt,
			content: externalContent,
		});
		const externalVersion = knowledgeIndexModule.computeFileVersion(externalNote.size, externalNote.modifiedAt);
		await initialIndex.applyScanned({
			kind: 'create',
			path: externalPath,
			fileVersion: externalVersion,
		}, externalNote);
		const afterExternalCreate = await initialIndex.snapshot();
		assert.equal(afterExternalCreate.notes.get(externalPath)?.title, 'obsidian_event');
		assert.equal(afterExternalCreate.notes.get(externalPath)?.excerptSource.includes('Obsidian Event'), true);
		assert.equal(initialIndex.scanSnapshot().notes.some((note) => note.relativePath === externalPath), true);
		await initialIndex.applyScanned({
			kind: 'delete',
			path: externalPath,
			fileVersion: externalVersion,
		});
		assert.equal(initialIndex.scanSnapshot().notes.some((note) => note.relativePath === externalPath), false);

		const orderedPath = '01_knowledge/wiki/ordered_event.md';
		const newerContent = '# Newer Event';
		const newerNote = scanModule.scannedNoteFromContent({
			absolutePath: path.join(vaultRoot, orderedPath),
			relativePath: orderedPath,
			fallbackTitle: 'ordered_event',
			size: Buffer.byteLength(newerContent),
			modifiedAt: '2026-07-22T02:00:00.000Z',
			content: newerContent,
		});
		const olderContent = '# Older Event';
		const olderNote = scanModule.scannedNoteFromContent({
			absolutePath: path.join(vaultRoot, orderedPath),
			relativePath: orderedPath,
			fallbackTitle: 'ordered_event',
			size: Buffer.byteLength(olderContent),
			modifiedAt: '2026-07-22T01:00:00.000Z',
			content: olderContent,
		});
		await initialIndex.applyScanned({
			kind: 'modify',
			path: orderedPath,
			fileVersion: knowledgeIndexModule.computeFileVersion(newerNote.size, newerNote.modifiedAt),
		}, newerNote);
		const generationAfterNewerEvent = (await initialIndex.snapshot()).generation;
		await initialIndex.applyScanned({
			kind: 'modify',
			path: orderedPath,
			fileVersion: knowledgeIndexModule.computeFileVersion(olderNote.size, olderNote.modifiedAt),
		}, olderNote);
		const afterOutOfOrderEvent = await initialIndex.snapshot();
		assert.equal(afterOutOfOrderEvent.notes.get(orderedPath)?.excerptSource.includes('Newer Event'), true);
		assert.equal(afterOutOfOrderEvent.generation, generationAfterNewerEvent);
		await initialIndex.applyScanned({
			kind: 'delete',
			path: orderedPath,
			fileVersion: knowledgeIndexModule.computeFileVersion(newerNote.size, newerNote.modifiedAt),
		});

		writeFile(incrementalPath, '# Incremental Updated\nBody v2', vaultRoot);
		const modifyVersion = fileVersionForPath(incrementalAbsolute);
		await initialIndex.apply({
			kind: 'modify',
			path: incrementalPath,
			fileVersion: modifyVersion,
		});
		const afterModify = await initialIndex.snapshot();
		assert.equal(afterModify.notes.get(incrementalPath)?.excerptSource.includes('Incremental Updated'), true);

		const renamedPath = '01_knowledge/wiki/incremental_event_renamed.md';
		const renamedAbsolute = path.join(vaultRoot, renamedPath);
		fs.renameSync(incrementalAbsolute, renamedAbsolute);
		const renameVersion = fileVersionForPath(renamedAbsolute);
		await initialIndex.apply({
			kind: 'rename',
			path: incrementalPath,
			newPath: renamedPath,
			fileVersion: renameVersion,
		});
		const afterRename = await initialIndex.snapshot();
		assert.equal(afterRename.notes.has(incrementalPath), false);
		assert.equal(afterRename.notes.has(renamedPath), true);

		const renamedDeleteVersion = fileVersionForPath(renamedAbsolute);
		await initialIndex.apply({
			kind: 'delete',
			path: renamedPath,
			fileVersion: renamedDeleteVersion,
		});
		const afterDelete = await initialIndex.snapshot();
		assert.equal(afterDelete.notes.has(renamedPath), false);
		assert.equal(afterDelete.notes.size, afterCreate.notes.size - 1);

		const rebuildPath = '01_knowledge/wiki/rebuild_event.md';
		writeFile(rebuildPath, '# Rebuild Note\n', vaultRoot);
		const rebuildSnapshot = await initialIndex.rebuild();
		const rebuiltSnapshot = await initialIndex.snapshot();
		assert.equal(rebuiltSnapshot.index_state, 'ready');
		assert.equal(rebuiltSnapshot.notes.has(rebuildPath), true);
		assert.equal(rebuildSnapshot.note_count, rebuiltSnapshot.notes.size);

		const repoScope = '03_sources';
		const repositoryRootNote = path.join(repoScope, 'repository-note.md');
		const repositoryCreated = await repo.createText(repositoryRootNote, '# Repository Note\n');
		assert.equal(repositoryCreated.path, repositoryRootNote);
		assert.equal(typeof repositoryCreated.version, 'string');
		const repositoryRead = await repo.readText(repositoryRootNote);
		assert.equal(repositoryRead?.path, repositoryRootNote);
		assert.equal(repositoryRead?.content, '# Repository Note\n');
		assert.equal(repositoryRead?.version, repositoryCreated.version);
		assert.equal(
			repositoryRead?.version,
			knowledgeIndexModule.computeFileVersion(
				repositoryRead?.size ?? 0,
				repositoryRead?.modifiedAt ?? ''
			)
		);
		const nestedRepositoryNote = path.join(
			repoScope,
			'missing-parent',
			'missing-child',
			'note.md'
		);
		assert.equal(
			fs.existsSync(path.join(vaultRoot, repoScope, 'missing-parent')),
			false
		);
		await repo.createText(nestedRepositoryNote, '# Nested Repository Note\n');
		assert.equal(
			(await repo.readText(nestedRepositoryNote))?.content,
			'# Nested Repository Note\n'
		);

		await assert.rejects(
			() => repo.createText(repositoryRootNote, '# Duplicate Repository Note\n'),
			(error) => {
				return error instanceof operationJournalModule.OperationConflictError;
			}
		);

		const repositoryReplaced = await repo.replaceText(
			repositoryRootNote,
			repositoryRead?.version ?? repositoryCreated.version,
			'# Repository Note\n\nUpdated by repository seam test.\n'
		);
		assert.equal(repositoryReplaced.path, repositoryRootNote);
		assert.equal(repositoryReplaced.version !== repositoryCreated.version, true);

		await assert.rejects(
			() => repo.replaceText(repositoryRootNote, 'not-a-version', '# Collision\n'),
			(error) => error instanceof operationJournalModule.OperationConflictError
		);

		const repositoryDeleteNote = path.join(repoScope, 'delete-note.md');
		const repositoryDeleteCreated = await repo.createText(
			repositoryDeleteNote,
			'# Delete Note\n'
		);
		await assert.rejects(
			() => repo.deleteText(repositoryDeleteNote, 'not-a-version'),
			(error) => error instanceof operationJournalModule.OperationConflictError
		);
		assert.equal((await repo.readText(repositoryDeleteNote))?.content, '# Delete Note\n');
		await repo.deleteText(repositoryDeleteNote, repositoryDeleteCreated.version);
		assert.equal(await repo.readText(repositoryDeleteNote), null);

		await assert.rejects(
			() => repo.readText('../outside-repo.md'),
			(error) => error instanceof safety.VaultPathError
		);
		if (symlinkSupported) {
			await assert.rejects(
				() => repo.readText('01_knowledge/sources/symlink_source.md'),
				(error) => error instanceof safety.VaultPathError
			);
		}

		const outsideDirectory = path.join(tempRoot, 'outside-directory');
		const linkedParent = path.join(vaultRoot, repoScope, 'linked-parent');
		fs.mkdirSync(outsideDirectory, { recursive: true });
		try {
			fs.symlinkSync(
				outsideDirectory,
				linkedParent,
				process.platform === 'win32' ? 'junction' : 'dir'
			);
			directorySymlinkSupported = true;
		} catch {
			results.skipped.push('directory-symlink');
		}

		if (directorySymlinkSupported) {
			await assert.rejects(
				() => repo.createText(
					`${repoScope}/linked-parent/created/note.md`,
					'# Must Stay Inside Vault\n'
				),
				(error) => error instanceof safety.VaultPathError
			);
			assert.equal(fs.existsSync(path.join(outsideDirectory, 'created')), false);
		}

		const scopedNotes = await repo.listMarkdown(repoScope);
		assert.ok(scopedNotes.some((note) => note.path === repositoryRootNote));

		process.stdout.write(`${JSON.stringify({
			suite: 'core-legacy-baseline',
			result: 'pass',
			vaultRoot,
			scannedNotes: scanBeforeSymlink.notes.length,
			symlinkSupported,
			directorySymlinkSupported,
			skipped: results.skipped,
		})}\n`);

		await runCharacterizationRows('core-native-markdown-and-index', [
			['yaml-block-and-nested-lists', () => {
				const note = scannedCharacterizationNote('notes/yaml-block.md', [
					'---',
					'aliases:',
					'  - Alpha',
					'  - "Beta: Alias"',
					'metadata:',
					'  owners:',
					'    - Ada',
					'    - Lin',
					'---',
					'# YAML block fixture',
				].join('\n'));
				assert.deepEqual(note.aliases, ['Alpha', 'Beta: Alias']);
				assert.deepEqual(note.frontmatter.metadata, { owners: ['Ada', 'Lin'] });
			}],
			['yaml-quoted-scalars', () => {
				const note = scannedCharacterizationNote('notes/yaml-quotes.md', [
					'---',
					'title: "Quoted: Title"',
					'summary: \'Agent: local-first\'',
					'aliases: ["One: Alias", "Two"]',
					'---',
					'# YAML quote fixture',
				].join('\n'));
				assert.equal(note.title, 'Quoted: Title');
				assert.equal(note.frontmatter.summary, 'Agent: local-first');
				assert.deepEqual(note.aliases, ['One: Alias', 'Two', 'Quoted: Title']);
			}],
			['yaml-multiline-scalars', () => {
				const note = scannedCharacterizationNote('notes/yaml-multiline.md', [
					'---',
					'literal: |',
					'  first line',
					'  second line',
					'folded: >',
					'  folded first',
					'  folded second',
					'---',
					'# YAML multiline fixture',
				].join('\n'));
				assert.equal(note.frontmatter.literal, 'first line\nsecond line\n');
				assert.equal(note.frontmatter.folded, 'folded first folded second\n');
			}],
			['yaml-frontmatter-links', () => {
				const note = scannedCharacterizationNote('notes/yaml-links.md', [
					'---',
					'related:',
					'  - "[[topics/Target|Target Alias]]"',
					'source: "[[sources/Source#Evidence]]"',
					'---',
					'# Frontmatter links',
				].join('\n'));
				assert.deepEqual(
					note.wikilinks.map(({ target }) => target).sort(),
					['sources/Source', 'topics/Target']
				);
			}],
			['callouts-standard-claim-and-evidence', () => {
				const parsed = markdownModule.parseMarkdown([
					'> [!claim] Standard claim',
					'> Claim body',
					'> source:: [[sources/claim]]',
					'',
					'> [!evidence] Standard evidence',
					'> Evidence body',
					'> source:: [[sources/evidence]]',
				].join('\n'));
				assert.equal(parsed.claimBlocks.length, 1);
				assert.deepEqual(parsed.claimBlocks[0].sourceRefs, ['sources/claim']);
				assert.equal(parsed.evidenceBlocks.length, 1);
				assert.deepEqual(parsed.evidenceBlocks[0].sourceRefs, ['sources/evidence']);
			}],
			['callouts-foldable-claim-and-evidence', () => {
				const parsed = markdownModule.parseMarkdown([
					'> [!claim]- Folded claim',
					'> Claim body',
					'',
					'> [!evidence]- Folded evidence',
					'> Evidence body',
				].join('\n'));
				assert.equal(parsed.claimBlocks.length, 1);
				assert.match(parsed.claimBlocks[0].rawHeader, /\[!claim\]-/i);
				assert.equal(parsed.evidenceBlocks.length, 1);
				assert.match(parsed.evidenceBlocks[0].rawHeader, /\[!evidence\]-/i);
			}],
			['callouts-unfoldable-claim-and-evidence', () => {
				const parsed = markdownModule.parseMarkdown([
					'> [!claim]+ Unfoldable claim',
					'> Claim body',
					'',
					'> [!evidence]+ Unfoldable evidence',
					'> Evidence body',
				].join('\n'));
				assert.equal(parsed.claimBlocks.length, 1);
				assert.match(parsed.claimBlocks[0].rawHeader, /\[!claim\]\+/i);
				assert.equal(parsed.evidenceBlocks.length, 1);
				assert.match(parsed.evidenceBlocks[0].rawHeader, /\[!evidence\]\+/i);
			}],
			['syntax-fenced-code-exclusion', () => {
				const parsed = markdownModule.parseMarkdown([
					'# Real Heading',
					'#real',
					'```md',
					'# Fake Heading',
					'#fake',
					'[[Fake/Fenced]]',
					'> [!claim] Fake claim',
					'^fake-fence',
					'```',
					'[[Real/Target]]',
				].join('\n'));
				assert.deepEqual(parsed.headings, ['Real Heading']);
				assert.deepEqual(parsed.tags, ['real']);
				assert.deepEqual(parsed.wikilinks.map(({ target }) => target), ['Real/Target']);
				assert.deepEqual(parsed.blockIds, []);
				assert.equal(parsed.claimBlocks.length, 0);
			}],
			['syntax-inline-code-exclusion', () => {
				const parsed = markdownModule.parseMarkdown('Keep #real and `#fake [[Fake/Inline]]` with [[Real/Target]].');
				assert.deepEqual(parsed.tags, ['real']);
				assert.deepEqual(parsed.wikilinks.map(({ target }) => target), ['Real/Target']);
			}],
			['syntax-html-comment-exclusion', () => {
				const parsed = markdownModule.parseMarkdown([
					'<!--',
					'#comment-only',
					'[[Fake/Comment]]',
					'^fake-comment',
					'> [!evidence] Fake evidence',
					'-->',
					'#real',
					'[[Real/Target]]',
				].join('\n'));
				assert.deepEqual(parsed.tags, ['real']);
				assert.deepEqual(parsed.wikilinks.map(({ target }) => target), ['Real/Target']);
				assert.deepEqual(parsed.blockIds, []);
				assert.equal(parsed.evidenceBlocks.length, 0);
			}],
			['syntax-url-fragment-exclusion', () => {
				const parsed = markdownModule.parseMarkdown(
					'Browse https://example.test/docs#fragment, https://example.test/[[Not/A/VaultLink]], and obsidian://open?file=[[Also/Not/A/Link]].'
				);
				assert.deepEqual(parsed.tags, []);
				assert.deepEqual(parsed.wikilinks, []);
			}],
			['tags-unicode-and-numeric-only', () => {
				const parsed = markdownModule.parseMarkdown('#知识/图谱 #12345 #project/alpha_1');
				assert.deepEqual(parsed.tags.sort(), ['project/alpha_1', '知识/图谱'].sort());
			}],
			['block-ids-standalone-and-paragraph-tail', () => {
				const parsed = markdownModule.parseMarkdown([
					'Paragraph with a tail block id. ^tail-id',
					'',
					'^standalone-id',
				].join('\n'));
				assert.deepEqual(parsed.blockIds.sort(), ['standalone-id', 'tail-id']);
			}],
			['links-wikilink-alias-heading-block-and-embed', () => {
				const parsed = markdownModule.parseMarkdown([
					'[[folder/Target Note#Heading|Alias]]',
					'[[folder/Target Note#^block-id|Block Alias]]',
					'![[assets/Diagram#^asset-block|Diagram Alias]]',
				].join('\n'));
				assert.deepEqual(
					parsed.wikilinks.map(({ target, alias, heading }) => ({ target, alias, heading })),
					[
						{ target: 'folder/Target Note', alias: 'Alias', heading: 'Heading' },
						{ target: 'folder/Target Note', alias: 'Block Alias', heading: '^block-id' },
						{ target: 'assets/Diagram', alias: 'Diagram Alias', heading: '^asset-block' },
					]
				);
				assert.equal(parsed.wikilinks[2].raw, '![[assets/Diagram#^asset-block|Diagram Alias]]');
			}],
			['links-markdown-and-reference-forms', () => {
				const parsed = markdownModule.parseMarkdown([
					'[Alias](../targets/note.md#Heading)',
					'[Reference][note-ref]',
					'',
					'[note-ref]: ../targets/reference.md#^block-id',
				].join('\n'));
				assert.deepEqual(
					parsed.wikilinks.map(({ target }) => target),
					['../targets/note.md', '../targets/reference.md']
				);
			}],
			['links-missing-reference-definition-remains-unresolved', () => {
				const source = scannedCharacterizationNote(
					'notes/missing-reference.md',
					'[Missing target][missing-ref]'
				);
				const snapshot = knowledgeIndexModule.buildKnowledgeSnapshot(
					characterizationScan('/characterization-vault', [source]),
					{ indexState: 'ready', generation: 1 }
				);
				const edge = snapshot.notes.get(source.relativePath)?.edges[0];
				assert.equal(edge?.kind, 'reference');
				assert.equal(edge?.referenceLabel, 'missing-ref');
				assert.deepEqual(edge?.resolution, {
					status: 'unresolved',
					reason: 'missing_reference_definition',
					authority: 'fallback',
				});
				assert.equal(snapshot.graph.unresolvedEdges.length, 1);
			}],
			['links-relative-shortest-and-alias-resolution', () => {
				const target = scannedCharacterizationNote('01_knowledge/wiki/topics/target.md', [
					'---',
					'aliases: [Topic Alias]',
					'---',
					'# Target',
				].join('\n'));
				const shortestSource = scannedCharacterizationNote(
					'01_knowledge/wiki/shortest-source.md',
					'[[target]]\n[[Topic Alias]]'
				);
				const relativeSource = scannedCharacterizationNote(
					'01_knowledge/wiki/sub/relative-source.md',
					'[[../topics/target.md]]'
				);
				const snapshot = knowledgeIndexModule.buildKnowledgeSnapshot(
					characterizationScan('/characterization-vault', [target, shortestSource, relativeSource]),
					{ indexState: 'ready', generation: 1 }
				);
				assert.deepEqual(
					snapshot.graph.outgoing.get(shortestSource.relativePath),
					[target.relativePath]
				);
				assert.deepEqual(
					snapshot.graph.outgoing.get(relativeSource.relativePath),
					[target.relativePath]
				);
				assert.deepEqual(
					snapshot.graph.incoming.get(target.relativePath)?.sort(),
					[relativeSource.relativePath, shortestSource.relativePath].sort()
				);
			}],
			['links-unresolved-explicit-without-phantom-node', () => {
				const source = scannedCharacterizationNote(
					'01_knowledge/wiki/unresolved-source.md',
					'[[Missing Note]]'
				);
				const snapshot = knowledgeIndexModule.buildKnowledgeSnapshot(
					characterizationScan('/characterization-vault', [source]),
					{ indexState: 'ready', generation: 1 }
				);
				assert.deepEqual(snapshot.graph.outgoing.get(source.relativePath), []);
				assert.equal(snapshot.graph.incoming.has('Missing Note'), false);
				assert.deepEqual(
					snapshot.notes.get(source.relativePath)?.wikilinks.map(({ target }) => target),
					['Missing Note']
				);
			}],
			['native-unresolved-edge-is-not-fallback-resolved', () => {
				const target = scannedCharacterizationNote(
					'01_knowledge/wiki/native-unresolved-target.md',
					'---\naliases: [Native Maybe]\n---\n# Target'
				);
				const parsedSource = scannedCharacterizationNote(
					'01_knowledge/wiki/native-unresolved-source.md',
					'[[Native Maybe]]'
				);
				const nativeEdges = parsedSource.edges.map((edge) => ({
					...edge,
					resolution: {
						status: 'unresolved',
						reason: 'not_found',
						authority: 'native',
					},
				}));
				const source = {
					...parsedSource,
					edges: nativeEdges,
					wikilinks: nativeEdges,
				};
				const snapshot = knowledgeIndexModule.buildKnowledgeSnapshot(
					characterizationScan('/characterization-vault', [source, target]),
					{ indexState: 'ready', generation: 1 }
				);
				assert.deepEqual(snapshot.graph.outgoing.get(source.relativePath), []);
				assert.deepEqual(snapshot.graph.incoming.get(target.relativePath), []);
				assert.deepEqual(snapshot.graph.unresolvedEdges[0]?.resolution, {
					status: 'unresolved',
					reason: 'not_found',
					authority: 'native',
				});
				const graph = graphHealthModule.analyzeGraphHealth([source, target]);
				const lint = lintModule.lintNotes(
					'/characterization-vault',
					[source, target],
					{ graphProfile: 'off' }
				);
				assert.equal(graph.resolved_edge_count, 0);
				assert.equal(graph.unresolved_edge_count, 1);
				assert.equal(
					lint.issues.some((issue) => issue.kind === 'broken_wikilink'),
					true
				);
			}],
			['native-resolved-edge-can-target-a-non-markdown-vault-file', () => {
				const binaryTargetPath = '01_knowledge/sources/attachments/diagram.png';
				const parsedSource = scannedCharacterizationNote(
					'01_knowledge/wiki/native-binary-source.md',
					'![[01_knowledge/sources/attachments/diagram.png]]'
				);
				const nativeEdges = parsedSource.edges.map((edge) => ({
					...edge,
					resolution: {
						status: 'resolved',
						path: binaryTargetPath,
						authority: 'native',
					},
				}));
				const source = {
					...parsedSource,
					edges: nativeEdges,
					wikilinks: nativeEdges,
				};
				const snapshot = knowledgeIndexModule.buildKnowledgeSnapshot(
					characterizationScan('/characterization-vault', [source]),
					{ indexState: 'ready', generation: 1 }
				);
				assert.deepEqual(
					snapshot.graph.outgoing.get(source.relativePath),
					[binaryTargetPath]
				);
				assert.deepEqual(
					snapshot.graph.incoming.get(binaryTargetPath),
					[source.relativePath]
				);
				assert.equal(snapshot.graph.edges.length, 1);
				assert.equal(snapshot.graph.unresolvedEdges.length, 0);
				const graph = graphHealthModule.analyzeGraphHealth([source]);
				const strict = graphHealthModule.evaluateGraphProfile(graph, 'strict');
				assert.equal(graph.resolved_edge_count, 1);
				assert.equal(graph.unresolved_edge_count, 0);
				assert.equal(
					strict.profile_issues.some((issue) => issue.kind === 'graph_unresolved_wikilink'),
					false
				);
			}],
			['fallback-link-extraction-keeps-mixed-link-positions-bounded-and-exact', () => {
				const lines = Array.from({ length: 20 }, (_, index) =>
					index % 2 === 0
						? `[[Topic ${index}|Wiki ${index}]]`
						: `[Markdown ${index}](Topic-${index}.md)`
				);
				const parsed = markdownModule.parseMarkdown(lines.join('\n'));
				assert.equal(parsed.edges.length, lines.length);
				assert.deepEqual(
					parsed.edges.map((edge) => edge.position.start.line),
					lines.map((_, index) => index + 1)
				);
				assert.deepEqual(
					parsed.edges.map((edge) => edge.position.start.column),
					lines.map(() => 1)
				);
			}],
			['normalized-dto-version-hash-and-explicit-edge-state', () => {
				const target = scannedCharacterizationNote('notes/target.md', '# Target');
				const source = scannedCharacterizationNote(
					'notes/source.md',
					'---\ntitle: Source\n---\n# Source\n\n[[target]]\n[[missing]]'
				);
				const snapshot = knowledgeIndexModule.buildKnowledgeSnapshot(
					characterizationScan('/characterization-vault', [source, target]),
					{ indexState: 'ready', generation: 1, eventSequence: 4 }
				);
				const indexed = snapshot.notes.get(source.relativePath);
				assert.equal(indexed?.schemaVersion, knowledgeNoteModule.NORMALIZED_VAULT_NOTE_VERSION);
				assert.equal(indexed?.exists, true);
				assert.match(indexed?.contentHash ?? '', /^[a-f0-9]{64}$/);
				assert.equal(snapshot.event_sequence, 4);
				assert.equal(indexed?.edges[0].resolution.status, 'resolved');
				assert.equal(indexed?.edges[1].resolution.status, 'unresolved');
				assert.equal(snapshot.graph.edges.length, 1);
				assert.equal(snapshot.graph.unresolvedEdges.length, 1);
			}],
			['content-hash-covers-frontmatter-and-current-text', () => {
				const first = scannedCharacterizationNote(
					'notes/hash.md',
					'---\ntitle: Alpha\n---\n# Same body'
				);
				const second = scannedCharacterizationNote(
					'notes/hash.md',
					'---\ntitle: Bravo\n---\n# Same body'
				);
				assert.notEqual(first.contentHash, second.contentHash);
				assert.equal(first.contentHash, knowledgeNoteModule.hashVaultContent(first.text));
				assert.equal(second.contentHash, knowledgeNoteModule.hashVaultContent(second.text));
			}],
			['yaml-malformed-input-is-bounded-and-visible', () => {
				const content = [
					'---',
					'aliases: [unterminated',
					'---',
					'# Body survives',
					'[[Target]]',
				].join('\n');
				const parsed = markdownModule.parseMarkdown(content);
				const note = scannedCharacterizationNote('notes/malformed.md', content);
				assert.deepEqual(parsed.frontmatter.fields, {});
				assert.equal(parsed.frontmatter.errors.length > 0, true);
				assert.deepEqual(parsed.headings, ['Body survives']);
				assert.deepEqual(parsed.wikilinks.map(({ target }) => target), ['Target']);
				assert.equal(note.semanticErrors.length > 0, true);
			}],
			['normalized-note-path-safety-is-fail-closed', () => {
				assert.throws(
					() => scannedCharacterizationNote('../outside.md', '# Outside'),
					(error) => error instanceof knowledgeNoteModule.VaultSemanticPathError
				);
				assert.throws(
					() => knowledgeNoteModule.normalizeVaultRelativePath('/absolute.md'),
					(error) => error instanceof knowledgeNoteModule.VaultSemanticPathError
				);
			}],
			['snapshot-is-deterministic-across-input-order', () => {
				const alpha = scannedCharacterizationNote(
					'notes/alpha.md',
					'---\ntags: [stable]\n---\n# Alpha\n\n[[beta]]'
				);
				const beta = scannedCharacterizationNote(
					'notes/beta.md',
					'---\naliases: [Beta Alias]\n---\n# Beta\n\n[[missing]]'
				);
				const forward = knowledgeIndexModule.buildKnowledgeSnapshot(
					characterizationScan('/characterization-vault', [alpha, beta]),
					{ indexState: 'ready', generation: 1 }
				);
				const reverse = knowledgeIndexModule.buildKnowledgeSnapshot(
					characterizationScan('/characterization-vault', [beta, alpha]),
					{ indexState: 'ready', generation: 1 }
				);
				assert.deepEqual(
					normalizeDeterministicSnapshot(forward),
					normalizeDeterministicSnapshot(reverse)
				);
			}],
			['ambiguous-short-link-remains-explicitly-unresolved', () => {
				const first = scannedCharacterizationNote('notes/a/target.md', '# First');
				const second = scannedCharacterizationNote('notes/b/target.md', '# Second');
				const source = scannedCharacterizationNote('notes/source.md', '[[target]]');
				const snapshot = knowledgeIndexModule.buildKnowledgeSnapshot(
					characterizationScan('/characterization-vault', [first, source, second]),
					{ indexState: 'ready', generation: 1 }
				);
				const edge = snapshot.notes.get(source.relativePath)?.edges[0];
				assert.deepEqual(edge?.resolution, {
					status: 'unresolved',
					reason: 'ambiguous',
					authority: 'fallback',
				});
				assert.deepEqual(snapshot.graph.outgoing.get(source.relativePath), []);
			}],
			['graph-health-and-lint-consume-shared-resolved-edges', () => {
				const target = scannedCharacterizationNote(
					'01_knowledge/wiki/topics/target.md',
					'---\naliases: [Topic Alias]\n---\n# Target'
				);
				const source = scannedCharacterizationNote(
					'01_knowledge/wiki/source.md',
					'[[Topic Alias]]'
				);
				const graph = graphHealthModule.analyzeGraphHealth([source, target]);
				const lint = lintModule.lintNotes(
					'/characterization-vault',
					[source, target],
					{ graphProfile: 'off' }
				);
				assert.equal(graph.resolved_edge_count, 1);
				assert.equal(graph.unresolved_edge_count, 0);
				assert.equal(
					lint.issues.some((issue) => issue.kind === 'broken_wikilink'),
					false
				);
			}],
			['event-same-size-same-mtime-replacement', async () => {
				const notePath = '01_knowledge/wiki/same-tuple.md';
				const modifiedAt = '2026-07-30T01:00:00.000Z';
				const initial = scannedCharacterizationNote(notePath, '# Same\n\nalpha', modifiedAt);
				const replacement = scannedCharacterizationNote(notePath, '# Same\n\nbravo', modifiedAt);
				assert.equal(replacement.size, initial.size);
				const index = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
				await index.rebuild(characterizationScan(vaultRoot, [initial]));
				const before = await index.snapshot();
				await index.applyScanned({
					kind: 'modify',
					path: notePath,
					fileVersion: knowledgeIndexModule.computeFileVersion(replacement.size, replacement.modifiedAt),
				}, replacement);
				const after = await index.snapshot();
				assert.notEqual(after.notes.get(notePath)?.contentHash, before.notes.get(notePath)?.contentHash);
				assert.match(after.notes.get(notePath)?.excerptSource ?? '', /bravo/);
				assert.equal(after.generation, before.generation + 1);
			}],
			['event-mismatched-delete-removes-ghost', async () => {
				const notePath = '01_knowledge/wiki/delete-ghost.md';
				const initial = scannedCharacterizationNote(notePath, '# Delete ghost');
				const index = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
				await index.rebuild(characterizationScan(vaultRoot, [initial]));
				const before = await index.snapshot();
				await index.applyScanned({
					kind: 'delete',
					path: notePath,
					fileVersion: knowledgeIndexModule.computeFileVersion(initial.size + 1, initial.modifiedAt),
				});
				const after = await index.snapshot();
				assert.equal(after.notes.has(notePath), false);
				assert.equal(after.generation, before.generation + 1);
			}],
			['event-rename-removes-old-identity', async () => {
				const oldPath = '01_knowledge/wiki/before-rename.md';
				const newPath = '01_knowledge/wiki/after-rename.md';
				const initial = scannedCharacterizationNote(oldPath, '# Rename identity');
				const renamed = scannedCharacterizationNote(newPath, '# Rename identity');
				const index = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
				await index.rebuild(characterizationScan(vaultRoot, [initial]));
				const before = await index.snapshot();
				const staleVersion = knowledgeIndexModule.computeFileVersion(renamed.size + 1, renamed.modifiedAt);
				await index.applyScanned({
					kind: 'rename',
					path: oldPath,
					newPath,
					fileVersion: staleVersion,
				}, renamed);
				const after = await index.snapshot();
				assert.equal(after.notes.has(oldPath), false);
				assert.equal(after.notes.has(newPath), true);
				assert.equal(after.generation, before.generation + 1);
			}],
			['event-sequence-rejects-stale-and-deduplicates-generation', async () => {
				const notePath = '01_knowledge/wiki/sequence.md';
				const modifiedAt = '2026-07-30T03:00:00.000Z';
				const initial = scannedCharacterizationNote(notePath, '# Sequence\n\nalpha', modifiedAt);
				const replacement = scannedCharacterizationNote(notePath, '# Sequence\n\nbravo', modifiedAt);
				const stale = scannedCharacterizationNote(notePath, '# Sequence\n\ncharlie', modifiedAt);
				const index = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
				await index.rebuild(characterizationScan(vaultRoot, [initial]));
				const before = await index.snapshot();
				await index.applyScanned({
					kind: 'modify',
					path: notePath,
					fileVersion: knowledgeIndexModule.computeFileVersion(replacement.size, replacement.modifiedAt),
					sequence: 2,
					contentHash: replacement.contentHash,
				}, replacement);
				await index.applyScanned({
					kind: 'modify',
					path: notePath,
					fileVersion: knowledgeIndexModule.computeFileVersion(stale.size, stale.modifiedAt),
					sequence: 1,
					contentHash: stale.contentHash,
				}, stale);
				const afterStale = await index.snapshot();
				assert.match(afterStale.notes.get(notePath)?.excerptSource ?? '', /bravo/);
				assert.equal(afterStale.generation, before.generation + 1);
				assert.equal(afterStale.event_sequence, 2);
				await index.applyScanned({
					kind: 'modify',
					path: notePath,
					fileVersion: knowledgeIndexModule.computeFileVersion(replacement.size, replacement.modifiedAt),
					sequence: 3,
					contentHash: replacement.contentHash,
				}, replacement);
				const afterDuplicate = await index.snapshot();
				assert.equal(afterDuplicate.generation, afterStale.generation);
				assert.equal(afterDuplicate.event_sequence, 3);
			}],
			['semantic-event-admits-versioned-normalized-note', async () => {
				const notePath = '01_knowledge/wiki/semantic-event.md';
				const initial = scannedCharacterizationNote(notePath, '# Semantic\n\nbefore');
				const replacement = scannedCharacterizationNote(notePath, '# Semantic\n\nafter');
				const index = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
				await index.rebuild(characterizationScan(vaultRoot, [initial]));
				await index.applySemantic({
					schemaVersion: knowledgeNoteModule.NORMALIZED_VAULT_NOTE_VERSION,
					sequence: 1,
					kind: 'modify',
					path: notePath,
					exists: true,
					contentHash: replacement.contentHash,
					note: replacement,
				});
				const snapshot = await index.snapshot();
				assert.match(snapshot.notes.get(notePath)?.excerptSource ?? '', /after/);
				assert.equal(snapshot.event_sequence, 1);
				await assert.rejects(
					() => index.applySemantic({
						schemaVersion: knowledgeNoteModule.NORMALIZED_VAULT_NOTE_VERSION,
						sequence: 2,
						kind: 'modify',
						path: notePath,
						exists: true,
						contentHash: 'wrong-hash',
						note: replacement,
					}),
					/Vault semantic event content hash/
				);
			}],
			['semantic-event-updates-native-metadata-with-stable-content-hash', async () => {
				const sourcePath = '01_knowledge/wiki/native-resolution-source.md';
				const firstTargetPath = '01_knowledge/wiki/topics/first-target.md';
				const secondTargetPath = '01_knowledge/wiki/topics/second-target.md';
				const source = scannedCharacterizationNote(sourcePath, '# Source\n\n[[Stable Alias]]');
				const firstTarget = scannedCharacterizationNote(firstTargetPath, '# First target');
				const secondTarget = scannedCharacterizationNote(secondTargetPath, '# Second target');
				const withNativeTarget = (targetPath) => {
					const edges = source.edges.map((edge) => ({
						...edge,
						resolution: {
							status: 'resolved',
							path: targetPath,
							authority: 'native',
						},
					}));
					return {
						...source,
						edges,
						wikilinks: edges,
					};
				};
				const initial = withNativeTarget(firstTargetPath);
				const replacement = withNativeTarget(secondTargetPath);
				const index = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
				await index.rebuild(characterizationScan(vaultRoot, [
					initial,
					firstTarget,
					secondTarget,
				]));
				const before = await index.snapshot();
				await index.applySemantic({
					schemaVersion: knowledgeNoteModule.NORMALIZED_VAULT_NOTE_VERSION,
					sequence: 1,
					kind: 'modify',
					path: sourcePath,
					exists: true,
					contentHash: replacement.contentHash,
					note: replacement,
				});
				const after = await index.snapshot();
				assert.equal(after.notes.get(sourcePath)?.contentHash, before.notes.get(sourcePath)?.contentHash);
				assert.deepEqual(after.graph.outgoing.get(sourcePath), [secondTargetPath]);
				assert.equal(after.notes.get(sourcePath)?.edges[0]?.resolution.authority, 'native');
				assert.equal(after.generation, before.generation + 1);
				assert.equal(after.event_sequence, 1);
				await index.applySemantic({
					schemaVersion: knowledgeNoteModule.NORMALIZED_VAULT_NOTE_VERSION,
					sequence: 2,
					kind: 'modify',
					path: sourcePath,
					exists: true,
					contentHash: replacement.contentHash,
					note: replacement,
				});
				const afterDuplicate = await index.snapshot();
				assert.equal(afterDuplicate.generation, after.generation);
				assert.equal(afterDuplicate.event_sequence, 2);
			}],
			['semantic-event-clears-recovered-scan-error', async () => {
				const notePath = '01_knowledge/wiki/recovered-metadata.md';
				const recovered = scannedCharacterizationNote(notePath, '# Recovered');
				const index = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
				await index.rebuild({
					...characterizationScan(vaultRoot, []),
					errors: [{
						path: path.join(vaultRoot, notePath),
						error: 'Metadata unavailable',
					}],
				});
				assert.equal(index.scanSnapshot().errors.length, 1);
				await index.applySemantic({
					schemaVersion: knowledgeNoteModule.NORMALIZED_VAULT_NOTE_VERSION,
					sequence: 1,
					kind: 'create',
					path: notePath,
					exists: true,
					contentHash: recovered.contentHash,
					note: recovered,
				});
				assert.equal(index.scanSnapshot().errors.length, 0);
				assert.equal((await index.snapshot()).notes.has(notePath), true);
			}],
			['snapshot-frontmatter-is-deeply-isolated', async () => {
				const notePath = '01_knowledge/wiki/deep-clone.md';
				const note = scannedCharacterizationNote(
					notePath,
					'---\nmetadata:\n  owners: [Ada]\n---\n# Clone'
				);
				const index = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
				await index.rebuild(characterizationScan(vaultRoot, [note]));
				const first = await index.snapshot();
				first.notes.get(notePath).frontmatter.metadata.owners.push('Mutated');
				const second = await index.snapshot();
				assert.deepEqual(second.notes.get(notePath)?.frontmatter.metadata, {
					owners: ['Ada'],
				});
			}],
			['incremental-rename-refreshes-shared-resolved-edges', async () => {
				const oldPath = '01_knowledge/wiki/topics/old-target.md';
				const newPath = '01_knowledge/wiki/topics/new-target.md';
				const target = scannedCharacterizationNote(
					oldPath,
					'---\naliases: [Stable Alias]\n---\n# Target'
				);
				const source = scannedCharacterizationNote(
					'01_knowledge/wiki/source.md',
					'[[Stable Alias]]'
				);
				const renamed = scannedCharacterizationNote(
					newPath,
					'---\naliases: [Stable Alias]\n---\n# Target'
				);
				const index = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
				await index.rebuild(characterizationScan(vaultRoot, [target, source]));
				await index.applyScanned({
					kind: 'rename',
					path: oldPath,
					newPath,
					fileVersion: 'stale-tuple',
					sequence: 1,
					contentHash: renamed.contentHash,
				}, renamed);
				const snapshot = await index.snapshot();
				assert.equal(snapshot.notes.has(oldPath), false);
				assert.equal(snapshot.notes.has(newPath), true);
				assert.deepEqual(snapshot.graph.outgoing.get(source.relativePath), [newPath]);
				assert.deepEqual(snapshot.graph.incoming.get(newPath), [source.relativePath]);
				assert.equal(snapshot.graph.unresolvedEdges.length, 0);
			}],
			['event-rebuild-converges-same-tuple-content', async () => {
				const notePath = '01_knowledge/wiki/rebuild-same-tuple.md';
				const modifiedAt = '2026-07-30T02:00:00.000Z';
				const initial = scannedCharacterizationNote(notePath, '# Rebuild\n\nold', modifiedAt);
				const replacement = scannedCharacterizationNote(notePath, '# Rebuild\n\nnew', modifiedAt);
				assert.equal(replacement.size, initial.size);
				const index = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
				await index.rebuild(characterizationScan(vaultRoot, [initial]));
				const before = await index.snapshot();
				await index.rebuild(characterizationScan(vaultRoot, [replacement]));
				const after = await index.snapshot();
				assert.notEqual(after.notes.get(notePath)?.contentHash, before.notes.get(notePath)?.contentHash);
				assert.match(after.notes.get(notePath)?.excerptSource ?? '', /new/);
				assert.equal(after.generation, before.generation + 1);
			}],
		]);

		const loadRecordLifecycle = async () => {
			const loaded = await import('../dist/record-lifecycle.js');
			return loaded.default ?? loaded;
		};

		await runCharacterizationRows('core-native-record-lifecycle-red', [
			['proposal-history-resolves-id-across-active-and-archive', async () => {
				const lifecycle = await loadRecordLifecycle();
				const stableId = lifecycle.buildStableProposalId('finish-task-identity');
				assert.match(stableId, /^proposal-[a-f0-9]{24}$/);
				assert.equal(
					lifecycle.buildStableProposalId('finish-task-identity'),
					stableId
				);
				assert.throws(
					() => lifecycle.buildStableProposalId('  '),
					/identity seed must not be empty/
				);
				const records = [
					{
						path: '00_tracekeeper/inbox/review_queue/proposal-active.md',
						proposalId: 'proposal-active',
						location: 'active',
						contentHash: 'active-hash',
					},
					{
						path: '02_archive/review_queue/proposal-one.md',
						proposalId: 'proposal-one',
						location: 'archive',
						contentHash: 'archive-hash',
					},
				];
				const active = lifecycle.resolveProposalHistoryById(records, 'proposal-active');
				assert.equal(active.status, 'resolved');
				assert.equal(active.record.path, '00_tracekeeper/inbox/review_queue/proposal-active.md');
				assert.equal(active.record.location, 'active');
				const archived = lifecycle.resolveProposalHistoryById(records, 'proposal-one');
				assert.equal(archived.status, 'resolved');
				assert.equal(archived.record.path, '02_archive/review_queue/proposal-one.md');
				assert.equal(archived.record.location, 'archive');
				assert.deepEqual(
					lifecycle.resolveProposalHistoryById(records, 'missing'),
					{ status: 'missing', proposalId: 'missing', matches: [] }
				);
			}],
			['proposal-history-rejects-duplicate-id', async () => {
				const lifecycle = await loadRecordLifecycle();
				const result = lifecycle.resolveProposalHistoryById([
					{
						path: '00_tracekeeper/inbox/review_queue/duplicate.md',
						proposalId: 'duplicate',
						location: 'active',
						contentHash: 'active-hash',
					},
					{
						path: '02_archive/review_queue/duplicate.md',
						proposalId: 'duplicate',
						location: 'archive',
						contentHash: 'archive-hash',
					},
				], 'duplicate');
				assert.equal(result.status, 'ambiguous');
				assert.deepEqual(
					result.matches.map((record) => record.path),
					[
						'00_tracekeeper/inbox/review_queue/duplicate.md',
						'02_archive/review_queue/duplicate.md',
					]
				);
			}],
			['path-only-backfill-requires-one-proven-id', async () => {
				const lifecycle = await loadRecordLifecycle();
				const unique = lifecycle.planProposalReferenceBackfill({
					referencePath: '00_tracekeeper/inbox/review_queue/legacy.md',
					proposals: [{
						path: '00_tracekeeper/inbox/review_queue/legacy.md',
						proposalId: 'legacy',
						location: 'active',
						contentHash: 'legacy-hash',
					}],
				});
				assert.equal(unique.status, 'ready');
				assert.equal(unique.proposalId, 'legacy');
				const ambiguous = lifecycle.planProposalReferenceBackfill({
					referencePath: '00_tracekeeper/inbox/review_queue/legacy.md',
					proposals: [
						{
							path: '00_tracekeeper/inbox/review_queue/legacy.md',
							proposalId: 'legacy',
							location: 'active',
							contentHash: 'first-hash',
						},
						{
							path: '00_tracekeeper/inbox/review_queue/legacy.md',
							proposalId: 'other',
							location: 'active',
							contentHash: 'second-hash',
						},
					],
				});
				assert.equal(ambiguous.status, 'ambiguous');
			}],
			['path-only-backfill-refuses-stale-and-unmanaged-records', async () => {
				const lifecycle = await loadRecordLifecycle();
				const proposal = {
					path: '02_archive/review_queue/legacy.md',
					proposalId: 'legacy',
					location: 'archive',
					contentHash: 'proposal-hash',
				};
				const stale = lifecycle.planProposalReferenceBackfill({
					referencePath: '00_tracekeeper/inbox/review_queue/legacy.md',
					expectedReferenceHash: 'reference-before',
					currentReferenceHash: 'reference-after',
					managedRecord: true,
					proposals: [proposal],
				});
				assert.equal(stale.status, 'stale');
				const unmanaged = lifecycle.planProposalReferenceBackfill({
					referencePath: '00_tracekeeper/inbox/review_queue/legacy.md',
					expectedReferenceHash: 'reference-current',
					currentReferenceHash: 'reference-current',
					managedRecord: false,
					proposals: [proposal],
				});
				assert.equal(unmanaged.status, 'unmanaged');
				const unresolved = lifecycle.planProposalReferenceBackfill({
					referencePath: '00_tracekeeper/inbox/review_queue/missing.md',
					managedRecord: true,
					proposals: [proposal],
				});
				assert.equal(unresolved.status, 'missing');
			}],
			['audit-shard-path-and-event-id-are-stable', async () => {
				const lifecycle = await loadRecordLifecycle();
				assert.equal(
					lifecycle.auditShardPath('2026-07-30T23:59:59.000Z'),
					'00_tracekeeper/control/agent_activity/2026/2026-07-30.md'
				);
				const event = {
					operationId: 'operation-one',
					type: 'tool-call',
					event: 'tool-call',
					tool: 'tracekeeper.status',
					status: 'success',
					targetPaths: [],
				};
				assert.equal(
					lifecycle.buildStableAuditEventId(event),
					lifecycle.buildStableAuditEventId({ ...event, timestamp: '2026-07-31T00:00:00.000Z' })
				);
				assert.equal(
					lifecycle.auditShardPath('2026-07-31T00:00:00.000Z'),
					'00_tracekeeper/control/agent_activity/2026/2026-07-31.md'
				);
				assert.notEqual(
					lifecycle.buildStableAuditEventId(event),
					lifecycle.buildStableAuditEventId({ ...event, operationId: 'operation-two' })
				);
				const requestEvent = {
					requestId: 'request-one',
					type: 'native-audit-event',
					event: 'native-audit-event',
					action: 'native-audit-event',
				};
				assert.equal(
					lifecycle.buildStableAuditEventId(requestEvent),
					lifecycle.buildStableAuditEventId({
						...requestEvent,
						timestamp: '2026-07-31T00:00:00.000Z',
					})
				);
				assert.notEqual(
					lifecycle.buildStableAuditEventId(requestEvent),
					lifecycle.buildStableAuditEventId({
						...requestEvent,
						requestId: 'request-two',
					})
				);
				const invocationEvent = {
					invocationId: 'invocation-one',
					type: 'tool-call',
					event: 'tool-call',
					tool: 'tracekeeper.status',
					status: 'success',
					targetPaths: [],
				};
				assert.equal(
					lifecycle.buildStableAuditEventId(invocationEvent),
					lifecycle.buildStableAuditEventId({
						...invocationEvent,
						timestamp: '2026-07-31T00:00:00.000Z',
					})
				);
				assert.notEqual(
					lifecycle.buildStableAuditEventId(invocationEvent),
					lifecycle.buildStableAuditEventId({
						...invocationEvent,
						invocationId: 'invocation-two',
					})
				);
			}],
			['audit-merge-deduplicates-legacy-and-shards', async () => {
				const lifecycle = await loadRecordLifecycle();
				const merged = lifecycle.mergeAuditEvents([
					{
						auditEventId: 'audit-one',
						timestamp: '2026-07-30T01:00:00.000Z',
						sourcePath: '00_tracekeeper/control/audit_log.md',
						sourceKind: 'legacy',
					},
					{
						auditEventId: 'audit-one',
						timestamp: '2026-07-30T01:00:00.000Z',
						sourcePath: '00_tracekeeper/control/audit/2026/2026-07-30.md',
						sourceKind: 'shard',
					},
					{
						auditEventId: 'audit-two',
						timestamp: '2026-07-30T02:00:00.000Z',
						sourcePath: '00_tracekeeper/control/audit/2026/2026-07-30.md',
						sourceKind: 'shard',
					},
				]);
				assert.deepEqual(merged.map((event) => event.auditEventId), ['audit-two', 'audit-one']);
				assert.equal(merged[1].sourceKind, 'shard');
			}],
			['audit-merge-orders-legacy-rows-without-ids-deterministically', async () => {
				const lifecycle = await loadRecordLifecycle();
				const events = [
					{
						timestamp: '2026-07-30T01:00:00.000Z',
						sourcePath: '00_tracekeeper/control/audit_log.md',
						sourceKind: 'legacy',
						action: 'legacy-one',
					},
					{
						timestamp: '2026-07-30T01:00:00.000Z',
						sourcePath: '00_tracekeeper/control/audit_log.md',
						sourceKind: 'legacy',
						action: 'legacy-one',
					},
					{
						timestamp: '2026-07-31T01:00:00.000Z',
						sourcePath: '00_tracekeeper/control/audit/2026/2026-07-31.md',
						sourceKind: 'shard',
						action: 'newer',
					},
				];
				const first = lifecycle.mergeAuditEvents(events);
				const second = lifecycle.mergeAuditEvents([...events].reverse());
				assert.deepEqual(first, second);
				assert.equal(first.length, 2);
				assert.equal(first[0].action, 'newer');
				assert.equal(first[1].action, 'legacy-one');
			}],
			['cleanup-preview-retains-mixed-age-files', async () => {
				const lifecycle = await loadRecordLifecycle();
				const preview = lifecycle.buildAuditCleanupPreview({
					cutoff: '2026-07-30T12:00:00.000Z',
					files: [
						{
							path: '00_tracekeeper/control/agent_activity/2026/2026-07-29.md',
							contentHash: 'old',
							version: 'old-version',
							eventTimes: ['2026-07-29T01:00:00.000Z'],
						},
						{
							path: '00_tracekeeper/control/audit_log.md',
							contentHash: 'mixed',
							version: 'mixed-version',
							eventTimes: [
								'2026-07-29T01:00:00.000Z',
								'2026-07-30T13:00:00.000Z',
							],
						},
						{
							path: '00_tracekeeper/control/agent_activity/2026/2026-07-30.md',
							contentHash: 'equal-cutoff',
							version: 'equal-cutoff-version',
							eventTimes: ['2026-07-30T12:00:00.000Z'],
						},
					],
				});
				assert.deepEqual(preview.eligiblePaths, [
					'00_tracekeeper/control/agent_activity/2026/2026-07-29.md',
				]);
				assert.deepEqual(preview.retained.map((row) => [row.path, row.reason]), [
					['00_tracekeeper/control/audit_log.md', 'mixed-age'],
					[
						'00_tracekeeper/control/agent_activity/2026/2026-07-30.md',
						'too-new',
					],
				]);
			}],
			['cleanup-preview-clear-all-selects-only-audit-files', async () => {
				const lifecycle = await loadRecordLifecycle();
				const preview = lifecycle.buildAuditCleanupPreview({
					cutoff: null,
					files: [
						{
							path: '00_tracekeeper/control/agent_activity/2026/2026-07-30.md',
							contentHash: 'shard',
							version: 'shard-version',
							eventTimes: ['2026-07-30T01:00:00.000Z'],
						},
						{
							path: '00_tracekeeper/control/audit_log.md',
							contentHash: 'legacy',
							version: 'legacy-version',
							eventTimes: [
								'2026-07-29T01:00:00.000Z',
								'2026-07-30T13:00:00.000Z',
							],
						},
						{
							path: '00_tracekeeper/work/tasks/task.md',
							contentHash: 'task',
							version: 'task-version',
							eventTimes: ['2026-07-29T01:00:00.000Z'],
						},
					],
				});
				assert.deepEqual(preview.eligiblePaths, [
					'00_tracekeeper/control/agent_activity/2026/2026-07-30.md',
					'00_tracekeeper/control/audit_log.md',
				]);
				assert.deepEqual(preview.retained.map((row) => [row.path, row.reason]), [
					['00_tracekeeper/work/tasks/task.md', 'non-audit'],
				]);
			}],
			['cleanup-validation-rejects-stale-hash-cutoff-and-non-audit-targets', async () => {
				const lifecycle = await loadRecordLifecycle();
				const preview = lifecycle.buildAuditCleanupPreview({
					cutoff: '2026-07-30T12:00:00.000Z',
					files: [
						{
							path: '00_tracekeeper/control/audit/2026/2026-07-29.md',
							contentHash: 'preview-hash',
							version: 'preview-version',
							eventTimes: ['2026-07-29T01:00:00.000Z'],
						},
						{
							path: '00_tracekeeper/control/audit_log.md',
							contentHash: 'retained-hash',
							version: 'retained-version',
							eventTimes: ['2026-07-30T13:00:00.000Z'],
						},
					],
				});
				const currentFiles = [
					{
						path: '00_tracekeeper/control/audit/2026/2026-07-29.md',
						contentHash: 'preview-hash',
						version: 'preview-version',
					},
					{
						path: '00_tracekeeper/control/audit_log.md',
						contentHash: 'retained-hash',
						version: 'retained-version',
					},
				];
				const staleHash = lifecycle.validateAuditCleanupPreview({
					preview,
					cutoff: '2026-07-30T12:00:00.000Z',
					currentFiles: currentFiles.map((file) =>
						file.path.endsWith('2026-07-29.md')
							? { ...file, contentHash: 'changed-hash' }
							: file
					),
				});
				assert.equal(staleHash.status, 'stale');
				const staleCutoff = lifecycle.validateAuditCleanupPreview({
					preview,
					cutoff: '2026-07-30T13:00:00.000Z',
					currentFiles,
				});
				assert.equal(staleCutoff.status, 'stale');
				const injected = lifecycle.validateAuditCleanupPreview({
					preview: {
						...preview,
						eligiblePaths: ['00_tracekeeper/work/tasks/task.md'],
					},
					cutoff: '2026-07-30T12:00:00.000Z',
					currentFiles: [{
						path: '00_tracekeeper/work/tasks/task.md',
						contentHash: 'task-hash',
						version: 'task-version',
					}],
				});
				assert.equal(injected.status, 'rejected');
				const retainedTamper = lifecycle.validateAuditCleanupPreview({
					preview: {
						...preview,
						retained: preview.retained.map((row) => ({
							...row,
							contentHash: 'tampered-retained-hash',
						})),
					},
					cutoff: '2026-07-30T12:00:00.000Z',
					currentFiles,
				});
				assert.equal(retainedTamper.status, 'rejected');
				const missingRetained = lifecycle.validateAuditCleanupPreview({
					preview,
					cutoff: '2026-07-30T12:00:00.000Z',
					currentFiles: [currentFiles[0]],
				});
				assert.equal(missingRetained.status, 'stale');
				const newFile = lifecycle.validateAuditCleanupPreview({
					preview,
					cutoff: '2026-07-30T12:00:00.000Z',
					currentFiles: [
						...currentFiles,
						{
							path: '00_tracekeeper/control/audit/2026/2026-07-30.md',
							contentHash: 'new-file-hash',
							version: 'new-file-version',
						},
					],
				});
				assert.equal(newFile.status, 'stale');
			}],
		]);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

async function runMemoryRecordV2Tests() {
	assert.equal(
		memoryRecordModule.buildGlobalMemoryEntryPath({
			agentType: 'codex',
			operationKind: 'propose_memory',
			operationId: 'propose-memory-123',
		}),
		'01_knowledge/memory/global/agents/codex/propose_memory-propose-memory-123.md'
	);
	for (const input of [
		{ agentType: '../codex', operationKind: 'propose_memory', operationId: 'op-1' },
		{ agentType: 'codex', operationKind: '../propose_memory', operationId: 'op-1' },
		{ agentType: 'codex', operationKind: 'propose_memory', operationId: '../op-1' },
	]) {
		assert.throws(
			() => memoryRecordModule.buildGlobalMemoryEntryPath(input),
			/invalid/i
		);
	}
	const evidence = ['01_knowledge/sources/web/example.md'];
	const built = memoryRecordModule.buildMemoryRecord({
		path: '01_knowledge/memory/global/global-1.md',
		memory_id: 'memory-global-1',
		scope: 'global',
		project_id: null,
		agent_type: 'codex',
		operation_id: 'operation-global-1',
		memory_kind: 'task_decision',
		claim_key: '  Preferred   Runtime  ',
		authority: 'source',
		confidence_level: 'verified',
		declared_state: 'active',
		observed_at: '2026-08-06T00:00:00Z',
		valid_from: '2026-08-01T00:00:00Z',
		valid_to: null,
		last_verified_at: '2026-08-06T00:00:00Z',
		evidence,
		supersedes: [],
		contradicts: [],
		project_hub: null,
		global_hub: '01_knowledge/memory/global/index.md',
		related_wiki: ['[[01_knowledge/wiki/concepts/runtime]]'],
		related_sources: ['01_knowledge/sources/web/example.md'],
		body: '# Preferred Runtime\n\nUse the supported runtime.',
	});
	evidence.push('01_knowledge/sources/web/mutated.md');
	assert.equal(built.record.claim_key, 'preferred runtime');
	assert.deepEqual(built.record.evidence, ['[[01_knowledge/sources/web/example]]']);
	assert.ok(built.markdown.includes('schema_version: 2'));
	const renderedFrontmatter = markdownModule.parseFrontmatter(built.markdown).fields;
	const reparsed = memoryRecordModule.parseMemoryRecord({
		path: built.record.path,
		frontmatter: renderedFrontmatter,
	});
	assert.deepEqual(reparsed, built.record);
	for (const codePoint of [...Array.from({ length: 0x20 }, (_, index) => index), 0x7f]) {
		assert.throws(
			() => memoryRecordModule.parseMemoryRecord({
				path: built.record.path,
				frontmatter: {
					...renderedFrontmatter,
					claim_key: `control${String.fromCharCode(codePoint)}character`,
				},
			}),
			/control characters/i
		);
	}
	const nonControlClaimKey = memoryRecordModule.parseMemoryRecord({
		path: built.record.path,
		frontmatter: {
			...renderedFrontmatter,
			claim_key: `extended${String.fromCharCode(0x80)}character`,
		},
	});
	assert.equal(nonControlClaimKey.claim_key, `extended${String.fromCharCode(0x80)}character`);

	const v1Projection = memoryRecordModule.projectMemoryEntryToReadProjection({
		schema_version: 1,
		type: 'project_memory_entry',
		path: '01_knowledge/memory/projects/alpha/agents/codex/task/op-1.md',
		project_key: 'alpha',
		project_id: 'project-alpha',
		agent_type: 'codex',
		task_id: 'task-1',
		operation_id: 'op-1',
		operation_kind: 'task',
		memory_kinds: ['decision'],
		status: 'superseded',
		created_at: '2026-08-01T00:00:00.000Z',
		operation_hash: `sha256:${'a'.repeat(64)}`,
		project_hub: '[[01_knowledge/memory/projects/alpha/index]]',
		related_wiki: [],
		supersedes: [],
	});
	assert.equal(v1Projection.kind, 'project_v1');
	assert.equal(v1Projection.claim_key, null);
	assert.equal(v1Projection.declared_state, 'active');
	const legacyProjection = memoryRecordModule.legacyMemoryToReadProjection({
		path: '01_knowledge/memory/projects/alpha/memory.md',
		scope: 'project',
		project_id: 'project-alpha',
	});
	assert.equal(legacyProjection.kind, 'legacy_unkeyed');

	assert.throws(
		() => memoryRecordModule.parseMemoryRecord({
			path: '../outside.md',
			frontmatter: renderedFrontmatter,
		}),
		/invalid/i
	);
	assert.throws(
		() => memoryRecordModule.parseMemoryRecord({
			path: built.record.path,
			frontmatter: { ...renderedFrontmatter, evidence: [], confidence_level: 'verified' },
		}),
		/requires at least one evidence/i
	);
	assert.throws(
		() => memoryRecordModule.parseMemoryRecord({
			path: built.record.path,
			frontmatter: {
				...renderedFrontmatter,
				valid_from: '2026-09-01T00:00:00Z',
				valid_to: '2026-08-01T00:00:00Z',
			},
		}),
		/valid_from/i
	);

	console.log(JSON.stringify({
		suite: 'core-memory-record-v2',
		result: 'pass',
		rows: [
			'canonical-global-entry-path',
			'normalized-round-trip',
			'claim-key-control-boundaries',
			'verified-evidence-bound',
			'temporal-range-validation',
			'vault-path-safety',
			'project-v1-compatibility-projection',
			'legacy-unkeyed-projection',
			'input-isolation',
		],
	}));
}

async function runMemoryLifecycleTests() {
	const makeRecord = (memoryId, overrides = {}) => memoryRecordModule.buildMemoryRecord({
		path: `01_knowledge/memory/global/${memoryId}.md`,
		memory_id: memoryId,
		scope: 'global',
		project_id: null,
		agent_type: 'codex',
		operation_id: `operation-${memoryId}`,
		memory_kind: 'task_decision',
		claim_key: 'runtime choice',
		authority: 'agent',
		confidence_level: 'supported',
		declared_state: 'active',
		observed_at: '2026-08-01T00:00:00Z',
		valid_from: null,
		valid_to: null,
		last_verified_at: '2026-08-01T00:00:00Z',
		evidence: ['01_knowledge/sources/web/runtime.md'],
		supersedes: [],
		contradicts: [],
		project_hub: null,
		global_hub: '01_knowledge/memory/global/index.md',
		related_wiki: [],
		related_sources: ['01_knowledge/sources/web/runtime.md'],
		body: `# ${memoryId}`,
		...overrides,
	}).record;

	const first = makeRecord('memory-a');
	const second = makeRecord('memory-b', {
		observed_at: '2026-08-02T00:00:00Z',
		supersedes: ['memory-a'],
	});
	const linear = memoryLifecycleModule.resolveMemoryLifecycle({
		generation: 4,
		now: '2026-08-06T00:00:00Z',
		records: [second, first],
	});
	assert.deepEqual(linear.current.map((row) => row.record.memory_id), ['memory-b']);
	assert.equal(linear.records.find((row) => row.record.memory_id === 'memory-a')?.effective_state, 'superseded');

	const branch = makeRecord('memory-c', {
		observed_at: '2026-08-03T00:00:00Z',
		supersedes: ['memory-a'],
	});
	const branched = memoryLifecycleModule.resolveMemoryLifecycle({
		generation: 5,
		now: '2026-08-06T00:00:00Z',
		records: [branch, first, second],
	});
	assert.deepEqual(branched.conflicts.map((row) => row.record.memory_id), ['memory-c', 'memory-b']);
	assert.ok(branched.issues.some((issue) => issue.code === 'duplicate_current'));

	const contradiction = makeRecord('memory-d', {
		observed_at: '2026-08-04T00:00:00Z',
		contradicts: ['memory-a'],
	});
	const disputed = memoryLifecycleModule.resolveMemoryLifecycle({
		generation: 6,
		now: '2026-08-06T00:00:00Z',
		records: [contradiction, first],
	});
	assert.equal(disputed.conflicts.length, 2);

	const cycleA = makeRecord('memory-cycle-a', { supersedes: ['memory-cycle-b'] });
	const cycleB = makeRecord('memory-cycle-b', { supersedes: ['memory-cycle-a'] });
	const cycle = memoryLifecycleModule.resolveMemoryLifecycle({
		generation: 7,
		now: '2026-08-06T00:00:00Z',
		records: [cycleB, cycleA],
	});
	assert.ok(cycle.issues.some((issue) => issue.code === 'supersession_cycle'));
	assert.ok(cycle.records.every((row) => row.effective_state === 'review'));

	const ended = makeRecord('memory-ended', { valid_to: '2026-08-02T00:00:00Z' });
	const future = makeRecord('memory-future', { valid_from: '2026-09-01T00:00:00Z' });
	const temporal = memoryLifecycleModule.resolveMemoryLifecycle({
		generation: 8,
		now: '2026-08-06T00:00:00Z',
		records: [future, ended],
	});
	assert.equal(temporal.records.find((row) => row.record.memory_id === 'memory-ended')?.effective_state, 'superseded');
	assert.equal(temporal.records.find((row) => row.record.memory_id === 'memory-future')?.effective_state, 'review');

	const dangling = makeRecord('memory-dangling', { supersedes: ['missing-memory'] });
	const danglingProjection = memoryLifecycleModule.resolveMemoryLifecycle({
		generation: 9,
		now: '2026-08-06T00:00:00Z',
		records: [dangling],
	});
	assert.equal(danglingProjection.records[0].effective_state, 'review');
	assert.ok(danglingProjection.issues.some((issue) => issue.code === 'dangling_supersedes'));

	const retractedRecord = makeRecord('memory-retracted', { declared_state: 'retracted' });
	const retracted = memoryLifecycleModule.resolveMemoryLifecycle({
		generation: 10,
		now: '2026-08-06T00:00:00Z',
		records: [retractedRecord],
	});
	assert.equal(retracted.history[0].effective_state, 'retracted');

	const projectRecord = makeRecord('memory-project', {
		path: '01_knowledge/memory/projects/alpha/agents/codex/task/memory-project.md',
		scope: 'project',
		project_id: 'project-alpha',
		project_hub: '01_knowledge/memory/projects/alpha/index.md',
		global_hub: null,
		supersedes: ['memory-a'],
	});
	const crossScope = memoryLifecycleModule.resolveMemoryLifecycle({
		generation: 11,
		now: '2026-08-06T00:00:00Z',
		records: [first, projectRecord],
	});
	assert.ok(crossScope.issues.some((issue) => issue.code === 'cross_claim_relation'));
	assert.equal(
		crossScope.records.find((row) => row.record.memory_id === 'memory-project')?.effective_state,
		'review'
	);

	const stale = memoryLifecycleModule.resolveMemoryLifecycle({
		generation: 12,
		now: '2026-08-06T00:00:00Z',
		staleAfterDays: 2,
		records: [first],
		legacy: [memoryRecordModule.legacyMemoryToReadProjection({
			path: '01_knowledge/memory/global/memory.md',
		})],
	});
	assert.ok(stale.issues.some((issue) => issue.code === 'stale_verification'));
	assert.equal(stale.legacy[0].effective_state, 'legacy_unkeyed');
	assert.deepEqual(memoryLifecycleModule.deriveMemoryGovernance({
		proposed_authority: 'user',
		proposed_confidence: 'verified',
		evidence_count: 1,
	}), {
		authority: 'agent',
		confidence_level: 'supported',
		downgraded: true,
	});
	assert.deepEqual(memoryLifecycleModule.deriveMemoryGovernance({
		proposed_authority: 'user',
		proposed_confidence: 'verified',
		evidence_count: 1,
		human_approved: true,
	}), {
		authority: 'user',
		confidence_level: 'verified',
		downgraded: false,
	});

	const reversed = memoryLifecycleModule.resolveMemoryLifecycle({
		generation: 4,
		now: '2026-08-06T00:00:00Z',
		records: [first, second],
	});
	assert.deepEqual(reversed, linear);

	console.log(JSON.stringify({
		suite: 'core-memory-lifecycle',
		result: 'pass',
		rows: [
			'linear-supersession',
			'branching-duplicate-current',
			'explicit-contradiction',
			'supersession-cycle',
			'validity-windows',
			'dangling-target',
			'retraction',
			'cross-scope-rejection',
			'stale-verification',
			'legacy-unkeyed',
			'policy-owned-authority',
			'deterministic-order',
		],
	}));
}

function normalizeReadView(view) {
	return {
		catalog: [...view.catalog],
		graph: {
			outgoing: [...view.graph.outgoing],
			incoming: [...view.graph.incoming],
			edges: view.graph.edges,
			unresolvedEdges: view.graph.unresolvedEdges,
		},
		scopes: { byType: [...view.scopes.byType], byTag: [...view.scopes.byTag] },
		lexical: [...view.lexical.postings],
		memory: {
			byId: [...view.memory.byId],
			byClaimKey: [...view.memory.byClaimKey],
			states: view.memory.lifecycle.records.map((row) => [row.record.memory_id, row.effective_state]),
			invalidPaths: view.memory.invalidPaths,
		},
	};
}

function runSourceRecordTests() {
	assert.equal(sourceRecordModule.normalizeSourceKind('article'), 'web');
	assert.equal(sourceRecordModule.normalizeSourceKind('document'), 'file');
	assert.equal(sourceRecordModule.normalizeSourceKind('meeting'), 'transcript');
	assert.throws(() => sourceRecordModule.normalizeSourceKind('database'), /source_kind/);

	const inline = sourceRecordModule.buildSourceCapturePlan({
		source: 'https://example.test/article', sourceKind: 'url', filename: 'example', content: '正文',
	});
	const repeated = sourceRecordModule.buildSourceCapturePlan({
		source: 'https://example.test/article', sourceKind: 'web', filename: 'renamed', content: '正文',
	});
	assert.equal(inline.route, '01_knowledge/sources/web');
	assert.equal(inline.index_path, '01_knowledge/sources/web/example.md');
	assert.equal(inline.source_id, repeated.source_id);
	assert.equal(inline.content_hash, repeated.content_hash);
	assert.deepEqual(inline.parts, []);

	const multibyte = '汉🙂'.repeat(32_000);
	const split = sourceRecordModule.buildSourceCapturePlan({
		source: 'meeting-2026-08-06', sourceKind: 'transcript', filename: 'meeting', content: multibyte,
	});
	assert.equal(split.route, '01_knowledge/sources/transcripts');
	assert.equal(split.inline_content, '');
	assert.equal(split.parts.length > 1, true);
	assert.equal(split.parts.every((part) => part.byte_length <= sourceRecordModule.SOURCE_PART_MAX_BYTES), true);
	assert.equal(split.parts.map((part) => part.content).join(''), multibyte);
	assert.deepEqual(split.parts.map((part) => part.part_number), split.parts.map((_, index) => index + 1));
	assert.equal(new Set(split.parts.map((part) => part.content_hash)).size > 1, true);

	assert.throws(() => sourceRecordModule.buildSourceCapturePlan({
		source: 'oversized', sourceKind: 'file', filename: 'oversized',
		content: 'x'.repeat(sourceRecordModule.SOURCE_PART_MAX_BYTES * (sourceRecordModule.SOURCE_PART_MAX_COUNT + 1)),
	}), /bounded 16-part limit/);

	console.log(JSON.stringify({
		suite: 'core-source-record', result: 'pass',
		rows: ['kind-alias-routing', 'stable-id-and-hash', 'utf8-bounded-parts', 'part-limit'],
	}));
}

async function runLifecycleGraphFixtureTests() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-lifecycle-graph-'));
	const vaultRoot = createFixture(root);
	const globalHubPath = '01_knowledge/memory/global/index.md';
	const recordPath = '01_knowledge/memory/global/agents/codex/record.md';
	const sourcePath = '01_knowledge/sources/web/source.md';
	const partPath = '01_knowledge/sources/web/source.parts/part-0001.md';
	const renamedPartPath = '01_knowledge/sources/web/source.parts/part-0001-renamed.md';
	const sourceId = 'source-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
	const globalHub = scannedCharacterizationNote(globalHubPath, '# Global memory\n');
	const sourceIndex = scannedCharacterizationNote(sourcePath, [
		'---', 'type: source_capture', `source_id: ${sourceId}`,
		`part_manifest: [${partPath}]`, '---', '# Source', '', `[[${partPath.replace(/\.md$/, '')}]]`,
	].join('\n'));
	const sourcePartMarkdown = [
		'---', 'type: source_part', `source_id: ${sourceId}`, `parent_source: ${sourcePath}`,
		'part_number: 1', 'part_count: 1', '---', '# Part', '', `[[${sourcePath.replace(/\.md$/, '')}]]`,
	].join('\n');
	const sourcePart = scannedCharacterizationNote(partPath, sourcePartMarkdown);
	const builtRecord = memoryRecordModule.buildMemoryRecord({
		path: recordPath, memory_id: 'memory-lifecycle-graph', scope: 'global', project_id: null,
		agent_type: 'codex', operation_id: 'operation-lifecycle-graph', memory_kind: 'fact',
		claim_key: 'lifecycle graph relation parity', authority: 'source', confidence_level: 'supported',
		declared_state: 'active', observed_at: '2026-08-06T00:00:00Z', valid_from: null,
		valid_to: null, last_verified_at: null, evidence: [sourcePath], supersedes: [], contradicts: [],
		project_hub: null, global_hub: globalHubPath, related_wiki: [], related_sources: [sourcePath],
		body: ['# Graph record', '', `[[${globalHubPath.replace(/\.md$/, '')}]]`,
			`[Source](../../../sources/web/source.md)`, '[[01_knowledge/wiki/missing-target]]'].join('\n'),
	});
	const record = scannedCharacterizationNote(recordPath, builtRecord.markdown);
	const index = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
	await index.rebuild(characterizationScan(vaultRoot, [globalHub, sourceIndex, sourcePart, record]));
	const initial = await index.readView();
	assert.equal(initial.graph.outgoing.get(recordPath)?.includes(globalHubPath), true);
	assert.equal(initial.graph.outgoing.get(recordPath)?.includes(sourcePath), true);
	assert.equal(initial.graph.incoming.get(globalHubPath)?.includes(recordPath), true);
	assert.equal(initial.graph.incoming.get(sourcePath)?.includes(recordPath), true);
	assert.equal(initial.graph.unresolvedEdges.some((edge) => edge.sourcePath === recordPath), true);
	assert.deepEqual(builtRecord.record.related_sources, [`[[${sourcePath.replace(/\.md$/, '')}]]`]);
	assert.match(sourcePartMarkdown, new RegExp(`source_id: ${sourceId}`));

	const renamedPart = scannedCharacterizationNote(renamedPartPath, sourcePart.content);
	await index.applyScanned({
		kind: 'rename', path: partPath, newPath: renamedPartPath, sequence: 1,
		fileVersion: knowledgeIndexModule.computeFileVersion(renamedPart.size, renamedPart.modifiedAt),
		contentHash: renamedPart.contentHash,
	}, renamedPart);
	const afterRename = await index.readView();
	const rebuilt = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
	await rebuilt.rebuild(characterizationScan(vaultRoot, [globalHub, sourceIndex, renamedPart, record]));
	assert.deepEqual(normalizeReadView(afterRename), normalizeReadView(await rebuilt.readView()));

	console.log(JSON.stringify({
		suite: 'core-lifecycle-graph-fixture', result: 'pass',
		rows: ['global-hub-backlink', 'wikilink-and-markdown-link', 'related-source-parity',
			'unresolved-relation', 'source-part-identity', 'rename-rebuild-convergence'],
	}));
}

async function runLifecycleDiagnosticTests() {
	const vaultRoot = '/tmp/tracekeeper-lifecycle-diagnostics';
	const globalHubPath = '01_knowledge/memory/global/index.md';
	const projectHubPath = '01_knowledge/memory/projects/alpha/index.md';
	const sourcePath = '01_knowledge/sources/web/source.md';
	const partOnePath = '01_knowledge/sources/web/source.parts/part-0001.md';
	const partTwoPath = '01_knowledge/sources/web/source.parts/part-0002.md';
	const notes = [
		scannedCharacterizationNote(globalHubPath, '# Global memory'),
		scannedCharacterizationNote(projectHubPath, '# Alpha'),
		scannedCharacterizationNote(sourcePath, [
			'---', 'type: source_capture', 'source_id: source-one',
			`part_manifest: [${partOnePath}]`, '---', '# Source', '', `[[${partOnePath.replace(/\.md$/, '')}]]`,
		].join('\n')),
		scannedCharacterizationNote(partOnePath, [
			'---', 'type: source_part', 'source_id: source-wrong', `parent_source: ${sourcePath}`,
			'part_number: 1', 'part_count: 3', '---', '# Part 1',
		].join('\n')),
		scannedCharacterizationNote(partTwoPath, [
			'---', 'type: source_part', 'source_id: source-one', `parent_source: ${sourcePath}`,
			'part_number: 3', 'part_count: 3', '---', '# Part 2',
		].join('\n')),
		scannedCharacterizationNote('01_knowledge/sources/web/source.parts/orphan.md', [
			'---', 'type: source_part', 'source_id: orphan', 'parent_source: missing-source.md',
			'part_number: 1', 'part_count: 1', '---', '# Orphan',
		].join('\n')),
		scannedCharacterizationNote('01_knowledge/memory/global/memory.md', '# Legacy memory'),
		scannedCharacterizationNote('01_knowledge/memory/global/proposal.md', [
			'---', 'type: memory_proposal', '---', '# Proposal',
		].join('\n')),
		scannedCharacterizationNote('01_knowledge/memory/global/invalid.md', [
			'---', 'schema_version: 2', 'type: memory_record', 'scope: global',
			'memory_id: invalid', 'agent_type: codex', 'operation_id: invalid-op', 'memory_kind: fact',
			'authority: source', 'confidence_level: verified', 'declared_state: active',
			'observed_at: 2026-08-06T00:00:00Z', 'valid_from: bad-time', 'valid_to: 2026-01-01T00:00:00Z',
			'evidence: []', 'supersedes: []', 'contradicts: []', `global_hub: ${globalHubPath}`,
			'related_wiki: []', 'related_sources: []', '---', '# Invalid',
		].join('\n')),
	];

	const makeRecordNote = (memoryId, overrides = {}) => {
		const recordPath = overrides.path || `01_knowledge/memory/global/agents/codex/facts/${memoryId}.md`;
		const built = memoryRecordModule.buildMemoryRecord({
			path: recordPath, memory_id: memoryId, scope: 'global', project_id: null,
			agent_type: 'codex', operation_id: `operation-${memoryId}`, memory_kind: 'fact',
			claim_key: 'diagnostic claim', authority: 'source', confidence_level: 'supported',
			declared_state: 'active', observed_at: '2026-08-01T00:00:00Z', valid_from: null,
			valid_to: null, last_verified_at: '2025-01-01T00:00:00Z', evidence: [sourcePath],
			supersedes: [], contradicts: [], project_hub: null, global_hub: globalHubPath,
			related_wiki: [], related_sources: [sourcePath],
			body: `# ${memoryId}\n\n[[${globalHubPath.replace(/\.md$/, '')}]]`,
			...overrides,
		});
		return scannedCharacterizationNote(recordPath, built.markdown);
	};
	notes.push(
		makeRecordNote('duplicate-a'),
		makeRecordNote('duplicate-b'),
		makeRecordNote('duplicate-id-a', { memory_id: 'duplicate-memory-id', claim_key: 'duplicate id a' }),
		makeRecordNote('duplicate-id-b', { memory_id: 'duplicate-memory-id', claim_key: 'duplicate id b' }),
		makeRecordNote('dangling', { claim_key: 'dangling claim', supersedes: ['missing-memory'] }),
		makeRecordNote('cycle-a', { claim_key: 'cycle claim', supersedes: ['cycle-b'] }),
		makeRecordNote('cycle-b', { claim_key: 'cycle claim', supersedes: ['cycle-a'] }),
		makeRecordNote('cross-target', { claim_key: 'cross target' }),
		makeRecordNote('cross-source', { claim_key: 'cross source', supersedes: ['cross-target'] }),
		makeRecordNote('unresolved-hub', {
			claim_key: 'unresolved hub', global_hub: '01_knowledge/memory/global/missing-index.md',
		}),
		makeRecordNote('mismatched-hub', { claim_key: 'mismatched hub', global_hub: sourcePath }),
		makeRecordNote('missing-source', {
			claim_key: 'missing source claim', evidence: ['01_knowledge/sources/web/missing.md'],
			related_sources: ['01_knowledge/sources/web/missing.md'],
		}),
		scannedCharacterizationNote('01_knowledge/memory/global/missing-hub.md', [
			'---', 'schema_version: 2', 'type: memory_record', 'memory_id: missing-hub',
			'scope: global', 'agent_type: codex', 'operation_id: operation-missing-hub',
			'memory_kind: fact', 'claim_key: missing hub', 'authority: agent',
			'confidence_level: inferred', 'declared_state: active', 'observed_at: 2026-08-06T00:00:00Z',
			'evidence: []', 'supersedes: []', 'contradicts: []', 'related_wiki: []',
			'related_sources: []', '---', '# Missing Hub',
		].join('\n')),
	);

	const report = lintModule.lintNotes(vaultRoot, notes, {
		graphProfile: 'advisory', now: '2026-08-06T00:00:00Z', staleAfterDays: 30,
		maxDirectoryRecords: 1, maxSourceParts: 1,
	});
	const kinds = new Set(report.issues.map((row) => row.kind));
	for (const expected of [
		'memory_schema_invalid', 'memory_claim_key_missing', 'memory_legacy_unkeyed',
		'memory_duplicate_id', 'memory_lifecycle_dangling_relation',
		'memory_lifecycle_cross_claim_relation', 'memory_lifecycle_cycle',
		'memory_lifecycle_duplicate_current', 'memory_temporal_invalid',
		'memory_verification_stale', 'memory_verified_without_evidence',
		'memory_authority_without_evidence', 'memory_evidence_unresolved',
		'memory_hub_missing', 'memory_hub_unresolved', 'memory_hub_scope_mismatch',
		'memory_project_hub_parent_missing',
		'memory_related_source_unresolved', 'memory_relation_body_parity',
		'source_part_parent_unresolved', 'source_part_identity_mismatch',
		'source_part_manifest_invalid', 'storage_directory_growth', 'graph_yaml_only_relation',
	]) assert.equal(kinds.has(expected), true, `missing lifecycle diagnostic: ${expected}`);
	assert.equal(notes.some((note) => note.frontmatter.claim_key === 'diagnostic claim'), true);
	const doctor = lifecycleDiagnosticsModule.buildLifecycleDoctorReport(notes, {
		now: '2026-08-06T00:00:00Z', maxDirectoryRecords: 1, maxSourceParts: 1,
	});
	assert.deepEqual(doctor.legacy_candidates.map((candidate) => candidate.path), [
		'01_knowledge/memory/global/memory.md',
	]);
	assert.equal(doctor.legacy_candidates[0].contentHash.length > 0, true);
	assert.deepEqual(doctor.legacy_candidates[0].suggestions, []);
	assert.equal(doctor.directory_counts.some((row) => row.directory === '01_knowledge/sources/web/source.parts' && row.record_count === 3), true);

	console.log(JSON.stringify({
		suite: 'core-lifecycle-diagnostics', result: 'pass',
		rows: [...kinds].filter((kind) => kind.startsWith('memory_') || kind.startsWith('source_') || kind === 'storage_directory_growth').sort(),
	}));
}

async function runKnowledgeReadIndexTests() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-read-index-'));
	const vaultRoot = createFixture(root);
	const targetPath = '01_knowledge/wiki/topics/target.md';
	const sourcePath = '01_knowledge/wiki/source.md';
	const unrelatedPath = '01_knowledge/wiki/unrelated.md';
	const target = scannedCharacterizationNote(targetPath, '---\naliases: [稳定主题]\ntags: [architecture]\n---\n# Target\n\nTarget body');
	const source = scannedCharacterizationNote(sourcePath, '# Source\n\n[[稳定主题]]');
	const unrelated = scannedCharacterizationNote(unrelatedPath, '# Unrelated\n\nNo links');
	const index = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
	await index.rebuild(characterizationScan(vaultRoot, [target, source, unrelated]));
	const initialView = await index.readView();
	assert.equal(initialView.catalog.size, 3);
	assert.equal('content' in initialView.catalog.get(targetPath), false);
	assert.equal('text' in initialView.catalog.get(targetPath), false);
	assert.deepEqual(initialView.graph.outgoing.get(sourcePath), [targetPath]);
	assert.equal(initialView.lexical.postings.get('稳定')?.includes(targetPath), true);

	const modifiedTarget = scannedCharacterizationNote(targetPath, '---\naliases: [稳定主题]\ntags: [systems]\n---\n# Target\n\nChanged body');
	await index.applyScanned({
		kind: 'modify', path: targetPath, sequence: 1,
		fileVersion: knowledgeIndexModule.computeFileVersion(modifiedTarget.size, modifiedTarget.modifiedAt),
		contentHash: modifiedTarget.contentHash,
	}, modifiedTarget);
	const modifiedView = await index.readView();
	assert.equal(modifiedView.generation, initialView.generation + 1);
	assert.equal(modifiedView.last_update.mode, 'incremental');
	assert.equal(modifiedView.last_update.affectedPaths.includes(unrelatedPath), false);
	assert.deepEqual(modifiedView.scopes.byTag.get('systems'), [targetPath]);
	assert.equal(modifiedView.scopes.byTag.has('architecture'), false);
	const modifiedRebuild = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
	await modifiedRebuild.rebuild(characterizationScan(vaultRoot, [modifiedTarget, source, unrelated]));
	assert.deepEqual(normalizeReadView(modifiedView), normalizeReadView(await modifiedRebuild.readView()));

	const dynamicSource = scannedCharacterizationNote('01_knowledge/wiki/dynamic-source.md', '[[Dynamic Alias]]');
	const dynamicTarget = scannedCharacterizationNote('01_knowledge/wiki/dynamic-target.md', '---\naliases: [Dynamic Alias]\n---\n# Dynamic');
	const dynamic = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
	await dynamic.rebuild(characterizationScan(vaultRoot, [dynamicSource, unrelated]));
	await dynamic.applyScanned({
		kind: 'create', path: dynamicTarget.relativePath, sequence: 1,
		fileVersion: knowledgeIndexModule.computeFileVersion(dynamicTarget.size, dynamicTarget.modifiedAt),
		contentHash: dynamicTarget.contentHash,
	}, dynamicTarget);
	assert.deepEqual((await dynamic.readView()).graph.outgoing.get(dynamicSource.relativePath), [dynamicTarget.relativePath]);
	await dynamic.applyScanned({
		kind: 'delete', path: dynamicTarget.relativePath, sequence: 2, fileVersion: '',
	});
	const afterDelete = await dynamic.readView();
	assert.deepEqual(afterDelete.graph.outgoing.get(dynamicSource.relativePath), []);
	const deleteRebuild = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
	await deleteRebuild.rebuild(characterizationScan(vaultRoot, [dynamicSource, unrelated]));
	assert.deepEqual(normalizeReadView(afterDelete), normalizeReadView(await deleteRebuild.readView()));

	const memoryPath = '01_knowledge/memory/global/memory-read-index.md';
	const memoryMarkdown = memoryRecordModule.buildMemoryRecord({
		path: memoryPath, memory_id: 'memory-read-index', scope: 'global', project_id: null,
		agent_type: 'codex', operation_id: 'operation-read-index', memory_kind: 'decision',
		claim_key: 'Read index ownership', authority: 'source', confidence_level: 'supported',
		declared_state: 'active', observed_at: '2026-08-06T00:00:00Z', valid_from: null,
		valid_to: null, last_verified_at: null, evidence: ['01_knowledge/sources/read-index.md'],
		supersedes: [], contradicts: [], project_hub: null,
		global_hub: '01_knowledge/memory/global/index.md', related_wiki: [],
		related_sources: ['01_knowledge/sources/read-index.md'], body: 'The read index is generation bound.',
	}).markdown;
	const memory = scannedCharacterizationNote(memoryPath, memoryMarkdown);
	await index.applyScanned({
		kind: 'create', path: memoryPath, sequence: 2,
		fileVersion: knowledgeIndexModule.computeFileVersion(memory.size, memory.modifiedAt),
		contentHash: memory.contentHash,
	}, memory);
	const memoryView = await index.readView();
	assert.equal(memoryView.memory.byId.get('memory-read-index')?.claim_key, 'read index ownership');
	assert.equal(memoryView.memory.lifecycle.current[0]?.record.memory_id, 'memory-read-index');
	const projectV1 = projectMemoryModule.buildProjectMemoryEntry({
		project_key: 'alpha', project_id: 'project-alpha', agent_type: 'codex', task_id: 'task-v1',
		operation_id: 'operation-v1', operation_kind: 'task', memory_kinds: ['decision'],
		status: 'active', created_at: '2026-08-05T00:00:00.000Z',
		project_hub: '[[01_knowledge/memory/projects/alpha/index.md]]', related_wiki: [], supersedes: [],
		body: 'Legacy project memory remains readable.',
	});
	const projectV1Markdown = [
		'---',
		...Object.entries(projectV1.entry)
			.filter(([key]) => key !== 'path')
			.map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
		'---', '', projectV1.body,
	].join('\n');
	const projectV1Note = scannedCharacterizationNote(projectV1.entry.path, projectV1Markdown);
	await index.applyScanned({
		kind: 'create', path: projectV1.entry.path, sequence: 3,
		fileVersion: knowledgeIndexModule.computeFileVersion(projectV1Note.size, projectV1Note.modifiedAt),
		contentHash: projectV1Note.contentHash,
	}, projectV1Note);
	const dualReadView = await index.readView();
	assert.equal(dualReadView.memory.lifecycle.legacy.some((row) =>
		row.projection.kind === 'project_v1' && row.projection.operation_id === 'operation-v1'
	), true);

	const filePath = '01_knowledge/wiki/fresh-content.md';
	writeFile(filePath, '# Fresh\n\nFirst body', vaultRoot);
	const diskNote = scannedCharacterizationNote(filePath, '# Fresh\n\nFirst body');
	await index.applyScanned({
		kind: 'create', path: filePath, sequence: 4,
		fileVersion: knowledgeIndexModule.computeFileVersion(diskNote.size, diskNote.modifiedAt),
		contentHash: diskNote.contentHash,
	}, diskNote);
	const boundView = await index.readView();
	writeFile(filePath, '# Fresh\n\nSecond body', vaultRoot);
	const selected = await boundView.contentReader.read(filePath);
	assert.match(selected.content, /Second body/);
	assert.equal(selected.generation, boundView.generation);
	assert.equal(selected.staleAgainstView, true);

	const fallbackSourceA = scannedCharacterizationNote('01_knowledge/wiki/fallback-a.md', '[[稳定主题]]');
	const fallbackSourceB = scannedCharacterizationNote('01_knowledge/wiki/fallback-b.md', '[[稳定主题]]');
	const bounded = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot, maxIncrementalRenameImpact: 1 });
	await bounded.rebuild(characterizationScan(vaultRoot, [modifiedTarget, fallbackSourceA, fallbackSourceB]));
	const renamed = scannedCharacterizationNote('01_knowledge/wiki/topics/renamed.md', '---\naliases: [稳定主题]\ntags: [systems]\n---\n# Target\n\nChanged body');
	await bounded.applyScanned({
		kind: 'rename', path: targetPath, newPath: renamed.relativePath, sequence: 1,
		fileVersion: knowledgeIndexModule.computeFileVersion(renamed.size, renamed.modifiedAt),
		contentHash: renamed.contentHash,
	}, renamed);
	const fallbackView = await bounded.readView();
	assert.equal(fallbackView.last_update.mode, 'rename_rebuild_fallback');
	assert.match(fallbackView.warnings[0], /rename_rebuild_fallback/);
	assert.deepEqual(fallbackView.graph.outgoing.get(fallbackSourceA.relativePath), [renamed.relativePath]);

	const rebuilt = new knowledgeIndexModule.InMemoryKnowledgeIndex({ vaultRoot });
	await rebuilt.rebuild(characterizationScan(vaultRoot, [renamed, fallbackSourceA, fallbackSourceB]));
	assert.deepEqual(normalizeReadView(fallbackView), normalizeReadView(await rebuilt.readView()));

	console.log(JSON.stringify({
		suite: 'core-knowledge-read-index', result: 'pass',
		rows: [
			'lightweight-generation-bound-view', 'bounded-chinese-grams',
			'incremental-create-modify-delete', 'incremental-scope-graph-postings',
			'memory-v2-lifecycle-index', 'memory-v1-dual-read-index',
			'targeted-fresh-content-reader', 'observable-rename-rebuild-fallback',
			'full-rebuild-equivalence',
		],
	}));
}

run().then(runMemoryRecordV2Tests).then(runMemoryLifecycleTests).then(runSourceRecordTests).then(runLifecycleGraphFixtureTests).then(runLifecycleDiagnosticTests).then(runKnowledgeReadIndexTests).catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
