#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-project-memory-test-'));
const bundlePath = path.join(tempRoot, 'project-memory.bundle.cjs');
const require = createRequire(import.meta.url);

const PROJECT_ROOT = '01_knowledge/memory/projects/project-alpha';
const HUB_PATH = `${PROJECT_ROOT}/index.md`;
const LEGACY_PATH = `${PROJECT_ROOT}/memory.md`;
const CODEX_PATH = `${PROJECT_ROOT}/agents/codex/finish_task-op-codex.md`;
const CLAUDE_PATH = `${PROJECT_ROOT}/agents/claude-code/finish_task-op-claude.md`;
const WIKI_PATH = '01_knowledge/wiki/shared.md';
const SOURCE_PATH = '01_knowledge/sources/local-source.md';

function position(line = 0, offset = 0) {
	return {
		start: { line, col: 0, offset },
		end: { line, col: 1, offset: offset + 1 },
	};
}

function emptyCache() {
	return {
		frontmatter: {},
		frontmatterLinks: [],
		tags: [],
		headings: [],
		blocks: {},
		links: [],
		embeds: [],
		sections: [],
	};
}

function nativeReference(link, original, displayText, line = 0) {
	return {
		link,
		original,
		displayText,
		position: position(line, line),
	};
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

async function runRows(suite, rows) {
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
			failures.map(({ error }) => error),
			`${suite} failed rows: ${failures.map(({ name }) => name).join(', ')}`
		);
	}
}

try {
	await build({
		stdin: {
			contents: [
				"export { ObsidianKnowledgeIndexAdapter } from './src/knowledge-index-adapter';",
				"export { ObsidianVaultRepository } from './src/adapters/obsidian-vault-repository';",
				"export { buildProjectMemoryCatalog, projectProjectMemorySnapshot } from '../../packages/mcp-runtime/src/application/project-memory';",
				"export { buildMemoryRecord } from '../../packages/core/src/memory-record';",
				"export { TFile, TFolder } from 'obsidian';",
			].join('\n'),
			resolveDir: pluginRoot,
			sourcefile: 'project-memory-test-entry.ts',
			loader: 'ts',
		},
		outfile: bundlePath,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
		plugins: [{
			name: 'fake-obsidian',
			setup(builder) {
				builder.onResolve({ filter: /^obsidian$/ }, () => ({
					path: 'obsidian',
					namespace: 'fake',
				}));
				builder.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
					contents: [
						'export class TFile {}',
						'export class TFolder {}',
						'export class Vault {}',
						'export const normalizePath = (value) => value.replace(/\\\\/g, "/").replace(/\\/{2,}/g, "/");',
					].join('\n'),
					loader: 'js',
				}));
			},
		}],
	});

	const {
		buildMemoryRecord,
		buildProjectMemoryCatalog,
		ObsidianKnowledgeIndexAdapter,
		ObsidianVaultRepository,
		projectProjectMemorySnapshot,
		TFile,
		TFolder,
	} = require(bundlePath);

	function createHarness(linkStyle = 'wikilink') {
		const records = new Map();
		const caches = new Map();
		const generatedLinks = [];
		const createCalls = [];
		let clock = 1_000;
		let blockedReadPath = '';
		let announceBlockedRead;
		let releaseBlockedRead;

		const blockedReadStarted = () => new Promise((resolve) => {
			announceBlockedRead = resolve;
		});

		const createFile = (filePath, content, cache = emptyCache()) => {
			const file = new TFile();
			Object.assign(file, {
				path: filePath,
				basename: path.posix.basename(filePath, path.posix.extname(filePath)),
				extension: path.posix.extname(filePath).slice(1).toLowerCase(),
				stat: {
					size: Buffer.byteLength(content, 'utf8'),
					mtime: clock++,
				},
			});
			records.set(filePath, { file, content });
			caches.set(filePath, cache);
			return file;
		};

		const createFolder = (folderPath) => {
			if (records.has(folderPath)) {
				throw new Error(`folder destination exists: ${folderPath}`);
			}
			const folder = new TFolder();
			Object.assign(folder, { path: folderPath, children: [] });
			records.set(folderPath, { file: folder, content: '' });
			return folder;
		};

		const resolveLink = (linkPath, sourcePath) => {
			const withoutExtension = linkPath.replace(/\.md$/i, '');
			const direct = `${withoutExtension}.md`;
			if (records.get(direct)?.file instanceof TFile) {
				return records.get(direct).file;
			}
			const relative = path.posix.normalize(path.posix.join(
				path.posix.dirname(sourcePath),
				direct
			));
			if (records.get(relative)?.file instanceof TFile) {
				return records.get(relative).file;
			}
			const requestedName = path.posix.basename(withoutExtension).toLowerCase();
			const matches = Array.from(records.values())
				.map(({ file }) => file)
				.filter((file) => {
					if (!(file instanceof TFile)) {
						return false;
					}
					const cache = caches.get(file.path);
					const aliases = Array.isArray(cache?.frontmatter?.aliases)
						? cache.frontmatter.aliases
						: [];
					const names = [
						file.basename,
						cache?.frontmatter?.title,
						...aliases,
					].filter((value) => typeof value === 'string');
					return names.some((value) => value.toLowerCase() === requestedName);
				});
			return matches.length === 1 ? matches[0] : null;
		};

		const read = async (file) => {
			if (file.path === blockedReadPath) {
				blockedReadPath = '';
				announceBlockedRead?.();
				await new Promise((resolve) => {
					releaseBlockedRead = resolve;
				});
			}
			const record = records.get(file.path);
			if (!record) {
				throw new Error(`missing fake Vault record: ${file.path}`);
			}
			return record.content;
		};

		const vault = {
			configDir: '.obsidian',
			getAbstractFileByPath: (filePath) => records.get(filePath)?.file ?? null,
			getMarkdownFiles: () => Array.from(records.values())
				.map(({ file }) => file)
				.filter((file) => file instanceof TFile && ['md', 'markdown'].includes(file.extension)),
			getFiles: () => Array.from(records.values())
				.map(({ file }) => file)
				.filter((file) => file instanceof TFile),
			read,
			cachedRead: read,
			createFolder: async (folderPath) => {
				createCalls.push({ kind: 'folder', path: folderPath });
				return createFolder(folderPath);
			},
			create: async (filePath, content) => {
				createCalls.push({ kind: 'file', path: filePath });
				if (records.has(filePath)) {
					throw new Error(`file destination exists: ${filePath}`);
				}
				return createFile(filePath, content);
			},
			process: async (file, update) => {
				const record = records.get(file.path);
				if (!record) {
					throw new Error(`missing fake Vault record: ${file.path}`);
				}
				const content = update(record.content);
				record.content = content;
				file.stat = {
					size: Buffer.byteLength(content, 'utf8'),
					mtime: clock++,
				};
				return content;
			},
		};

		const fileManager = {
			generateMarkdownLink: (target, sourcePath, subpath = '', alias = '') => {
				generatedLinks.push({
					targetPath: target.path,
					sourcePath,
					subpath,
					alias,
					linkStyle,
				});
				if (linkStyle === 'markdown') {
					const relative = path.posix.relative(
						path.posix.dirname(sourcePath),
						target.path
					);
					return `[${alias || target.basename}](${relative}${subpath})`;
				}
				return `[[${target.path.replace(/\.md$/i, '')}${subpath}${alias ? `|${alias}` : ''}]]`;
			},
		};

		const metadataCache = {
			getFileCache: (file) => caches.get(file.path) ?? null,
			getFirstLinkpathDest: resolveLink,
			resolvedLinks: {},
			unresolvedLinks: {},
			on: () => ({ id: 'metadata-listener' }),
			offref: () => {},
		};

		const rename = (oldPath, newPath) => {
			const record = records.get(oldPath);
			if (!record || !(record.file instanceof TFile)) {
				throw new Error(`cannot rename missing fake file: ${oldPath}`);
			}
			const cache = caches.get(oldPath);
			records.delete(oldPath);
			caches.delete(oldPath);
			record.file.path = newPath;
			record.file.basename = path.posix.basename(newPath, path.posix.extname(newPath));
			record.file.extension = path.posix.extname(newPath).slice(1).toLowerCase();
			record.file.stat = {
				size: Buffer.byteLength(record.content, 'utf8'),
				mtime: clock++,
			};
			records.set(newPath, record);
			if (cache) {
				caches.set(newPath, cache);
			}
			return record.file;
		};

		const remove = (filePath) => {
			const record = records.get(filePath);
			if (!record || !(record.file instanceof TFile)) {
				throw new Error(`cannot remove missing fake file: ${filePath}`);
			}
			records.delete(filePath);
			caches.delete(filePath);
			return record.file;
		};

		return {
			app: { vault, fileManager, metadataCache },
			vault,
			fileManager,
			metadataCache,
			records,
			caches,
			generatedLinks,
			createCalls,
			createFile,
			rename,
			remove,
			blockRead(filePath) {
				blockedReadPath = filePath;
				return blockedReadStarted();
			},
			releaseRead() {
				releaseBlockedRead?.();
			},
		};
	}

	function hubCache() {
		return {
			...emptyCache(),
			frontmatter: {
				title: 'Native Project Alpha',
				aliases: ['Project Alpha', 'Alpha Hub'],
				schema_version: 1,
				type: 'project_memory_index',
				project_id: 'project-alpha-id',
				project_key: 'project-alpha',
				repo_path: '/tmp/project-alpha',
			},
			headings: [{ heading: 'Overview', level: 2, position: position(1, 1) }],
			blocks: {
				'project-root': { id: 'project-root', position: position(2, 2) },
			},
		};
	}

	function wikiCache() {
		return {
			...emptyCache(),
			frontmatter: {
				title: 'Shared Knowledge',
				aliases: ['Shared', 'Common Ground'],
				type: 'wiki',
			},
			headings: [{ heading: 'Decision', level: 2, position: position(1, 1) }],
			blocks: {
				accepted: { id: 'accepted', position: position(2, 2) },
			},
		};
	}

	function sourceCache() {
		return {
			...emptyCache(),
			frontmatter: {
				title: 'Local Source',
				aliases: ['Source Evidence'],
				type: 'source',
			},
		};
	}

	function entryCache({
		agentType,
		operationId,
		title,
		aliases,
		links,
	}) {
		return {
			...emptyCache(),
			frontmatter: {
				title,
				aliases,
				schema_version: 1,
				type: 'project_memory_entry',
				project_id: 'project-alpha-id',
				agent_type: agentType,
				operation_id: operationId,
				operation_kind: 'finish_task',
				memory_kinds: ['task_decision'],
				status: 'active',
				created_at: '2026-07-30T12:00:00.000Z',
				operation_hash: `sha256:${crypto
					.createHash('sha256')
					.update(operationId)
					.digest('hex')}`,
				project_hub: `[[${HUB_PATH.replace(/\.md$/i, '')}]]`,
				related_wiki: [`[[${WIKI_PATH.replace(/\.md$/i, '')}]]`],
				related_sources: [`[[${SOURCE_PATH.replace(/\.md$/i, '')}]]`],
				supersedes: [],
			},
			frontmatterPosition: position(0, 0),
			frontmatterLinks: [{
				key: 'project_hub',
				link: HUB_PATH.replace(/\.md$/i, ''),
				original: `[[${HUB_PATH.replace(/\.md$/i, '')}]]`,
				displayText: 'Project hub',
			}],
			headings: [{ heading: 'Decision', level: 2, position: position(3, 3) }],
			blocks: {
				[`${agentType}-accepted`]: {
					id: `${agentType}-accepted`,
					position: position(4, 4),
				},
			},
			links,
		};
	}

	function seedProject(harness, options = {}) {
		const hub = harness.createFile(
			HUB_PATH,
			'---\ntitle: Raw project title\nproject_id: raw-wrong\n---\n# Raw project heading',
			hubCache()
		);
		harness.createFile(
			LEGACY_PATH,
			'# Legacy project memory\n\nThis note must remain unchanged.',
			{
				...emptyCache(),
				frontmatter: {
					title: 'Legacy project memory',
					type: 'memory',
					project_id: 'project-alpha-id',
				},
			}
		);
		harness.createFile(
			WIKI_PATH,
			'# Shared Knowledge\n\n## Decision\n\nAccepted. ^accepted',
			wikiCache()
		);
		harness.createFile(
			SOURCE_PATH,
			'# Local Source\n\nPrimary source evidence.',
			sourceCache()
		);
		const codex = harness.createFile(
			CODEX_PATH,
			'# Codex entry\n\n[[index#Overview|Project hub]]\n\n[Shared block](../../../../../wiki/shared.md#^accepted)\n\n[Local source](../../../../../sources/local-source.md)',
			entryCache({
				agentType: 'codex',
				operationId: 'op-codex',
				title: 'Codex native decision',
				aliases: ['Codex Choice'],
				links: [
					nativeReference('index#Overview', '[[index#Overview|Project hub]]', 'Project hub', 2),
					nativeReference(
						'../../../../../wiki/shared.md#^accepted',
						'[Shared block](../../../../../wiki/shared.md#^accepted)',
						'Shared block',
						4
					),
					nativeReference(
						'../../../../../sources/local-source.md',
						'[Local source](../../../../../sources/local-source.md)',
						'Local source',
						6
					),
				],
			})
		);
		let claude = null;
		if (options.includeClaude !== false) {
			claude = harness.createFile(
				CLAUDE_PATH,
				'# Claude entry\n\n[Project hub](../../index.md#Overview)\n\n[[Shared#Decision]]',
				entryCache({
					agentType: 'claude-code',
					operationId: 'op-claude',
					title: 'Claude native decision',
					aliases: ['Claude Choice'],
					links: [
						nativeReference(
							'../../index.md#Overview',
							'[Project hub](../../index.md#Overview)',
							'Project hub',
							2
						),
						nativeReference('Shared#Decision', '[[Shared#Decision]]', undefined, 4),
					],
				})
			);
		}
		return { hub, codex, claude };
	}

	await runRows('project-memory-obsidian-native-characterization', [
		['native-properties-links-aliases-headings-and-blocks', async () => {
			const harness = createHarness();
			seedProject(harness);
			const adapter = ObsidianKnowledgeIndexAdapter.create(harness.app, tempRoot);
			await adapter.rebuild();
			const snapshot = await adapter.knowledgeSnapshot();
			const hub = snapshot.notes.get(HUB_PATH);
			const codex = snapshot.notes.get(CODEX_PATH);
			const claude = snapshot.notes.get(CLAUDE_PATH);

			assert.equal(snapshot.index_state, 'ready');
			assert.equal(hub?.frontmatter.project_id, 'project-alpha-id');
			assert.equal(hub?.title, 'Native Project Alpha');
			assert.deepEqual(hub?.aliases, ['Project Alpha', 'Alpha Hub', 'Native Project Alpha']);
			assert.deepEqual(hub?.headings, ['Overview']);
			assert.deepEqual(hub?.blockIds, ['project-root']);
			assert.equal(codex?.frontmatter.agent_type, 'codex');
			assert.deepEqual(codex?.aliases, ['Codex Choice', 'Codex native decision']);
			assert.deepEqual(codex?.headings, ['Decision']);
			assert.deepEqual(codex?.blockIds, ['codex-accepted']);
			assert.equal(
				codex?.edges.some((edge) =>
					edge.raw.startsWith('[Shared block]') &&
					edge.resolution.status === 'resolved' &&
					edge.resolution.path === WIKI_PATH &&
					edge.subpath === '^accepted' &&
					edge.subpathKind === 'block'
				),
				true
			);
			assert.equal(
				codex?.edges.some((edge) =>
					edge.raw.startsWith('[Local source]') &&
					edge.resolution.status === 'resolved' &&
					edge.resolution.path === SOURCE_PATH
				),
				true
			);
			assert.equal(
				claude?.edges.some((edge) =>
					edge.raw === '[[Shared#Decision]]' &&
					edge.resolution.status === 'resolved' &&
					edge.resolution.path === WIKI_PATH &&
					edge.subpath === 'Decision' &&
					edge.subpathKind === 'heading'
				),
				true
			);
			assert.deepEqual(snapshot.graph.incoming.get(HUB_PATH), [CLAUDE_PATH, CODEX_PATH]);
		}],
		['file-manager-generated-wikilink-and-markdown-link-pass-through', async () => {
			const wikilinkHarness = createHarness('wikilink');
			const { hub: wikilinkHub } = seedProject(wikilinkHarness, { includeClaude: false });
			const wikilinkRepository = new ObsidianVaultRepository(
				wikilinkHarness.vault,
				wikilinkHarness.fileManager
			);
			assert.equal(
				wikilinkRepository.generateMarkdownLink(
					HUB_PATH,
					CODEX_PATH,
					'#Overview',
					'Project hub'
				),
				`[[${HUB_PATH.replace(/\.md$/i, '')}#Overview|Project hub]]`
			);
			const wikilinkAdapter = ObsidianKnowledgeIndexAdapter.create(
				wikilinkHarness.app,
				tempRoot
			);
			assert.equal(
				wikilinkAdapter.generateMarkdownLink(
					wikilinkHub,
					CODEX_PATH,
					'#^project-root',
					'Project root'
				),
				`[[${HUB_PATH.replace(/\.md$/i, '')}#^project-root|Project root]]`
			);

			const markdownHarness = createHarness('markdown');
			seedProject(markdownHarness, { includeClaude: false });
			const markdownRepository = new ObsidianVaultRepository(
				markdownHarness.vault,
				markdownHarness.fileManager
			);
			assert.equal(
				markdownRepository.generateMarkdownLink(
					HUB_PATH,
					CODEX_PATH,
					'#Overview',
					'Project hub'
				),
				'[Project hub](../../index.md#Overview)'
			);
			assert.equal(wikilinkHarness.generatedLinks.length, 2);
			assert.equal(markdownHarness.generatedLinks.length, 1);
		}],
		['hub-backlinks-converge-across-agent-rename-delete-and-restart', async () => {
			const harness = createHarness();
			seedProject(harness);
			const adapter = ObsidianKnowledgeIndexAdapter.create(harness.app, tempRoot);
			await adapter.rebuild();
			const renamedPath = `${PROJECT_ROOT}/agents/codex/finish-task-op-codex-renamed.md`;
			const renamed = harness.rename(CODEX_PATH, renamedPath);
			await adapter.applyRename(renamed, CODEX_PATH);
			let snapshot = await adapter.knowledgeSnapshot();
			assert.equal(snapshot.notes.has(CODEX_PATH), false);
			assert.deepEqual(snapshot.graph.incoming.get(HUB_PATH), [CLAUDE_PATH, renamedPath]);

			const deleted = harness.remove(CLAUDE_PATH);
			await adapter.applyDelete(deleted);
			snapshot = await adapter.knowledgeSnapshot();
			assert.equal(snapshot.notes.has(CLAUDE_PATH), false);
			assert.deepEqual(snapshot.graph.incoming.get(HUB_PATH), [renamedPath]);

			const restarted = ObsidianKnowledgeIndexAdapter.create(harness.app, tempRoot);
			await restarted.rebuild();
			const restartedSnapshot = await restarted.knowledgeSnapshot();
			assert.equal(restartedSnapshot.notes.has(CODEX_PATH), false);
			assert.equal(restartedSnapshot.notes.has(CLAUDE_PATH), false);
			assert.equal(restartedSnapshot.notes.has(renamedPath), true);
			assert.deepEqual(restartedSnapshot.graph.incoming.get(HUB_PATH), [renamedPath]);
		}],
		['queued-create-replay-converges-with-rebuild-generation', async () => {
			const harness = createHarness();
			seedProject(harness, { includeClaude: false });
			const adapter = ObsidianKnowledgeIndexAdapter.create(harness.app, tempRoot);
			await adapter.rebuild();
			const before = await adapter.knowledgeSnapshot();
			const readBlocked = harness.blockRead(HUB_PATH);
			const rebuild = adapter.rebuild();
			await readBlocked;
			const claude = harness.createFile(
				CLAUDE_PATH,
				'# Claude queued entry\n\n[Project hub](../../index.md#Overview)',
				entryCache({
					agentType: 'claude-code',
					operationId: 'op-claude',
					title: 'Claude queued decision',
					aliases: ['Claude Queued Choice'],
					links: [
						nativeReference(
							'../../index.md#Overview',
							'[Project hub](../../index.md#Overview)',
							'Project hub',
							2
						),
					],
				})
			);
			await adapter.applyCreate(claude);
			harness.releaseRead();
			const report = await rebuild;
			const after = await adapter.knowledgeSnapshot();
			assert.equal(after.index_state, 'ready');
			assert.equal(after.notes.has(CLAUDE_PATH), true);
			assert.deepEqual(after.graph.incoming.get(HUB_PATH), [CLAUDE_PATH, CODEX_PATH]);
			assert.equal(after.generation > before.generation, true);
			assert.equal(report.generation, after.generation);
			assert.equal(report.event_sequence, after.event_sequence);
		}],
		['repository-exclusive-create-keeps-one-operation-per-path', async () => {
			const harness = createHarness();
			const firstRepository = new ObsidianVaultRepository(harness.vault, harness.fileManager);
			const secondRepository = new ObsidianVaultRepository(harness.vault, harness.fileManager);
			const target = `${PROJECT_ROOT}/agents/codex/finish-task-exclusive.md`;
			const results = await Promise.allSettled([
				firstRepository.createText(target, '# First operation'),
				secondRepository.createText(target, '# Conflicting operation'),
			]);
			assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
			assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
			assert.match(
				errorMessage(results.find(({ status }) => status === 'rejected')?.reason),
				/Target already exists/
			);
			assert.equal(
				harness.createCalls.filter(({ kind, path: createdPath }) =>
					kind === 'file' && createdPath === target
				).length,
				1
			);
			assert.equal(harness.records.get(target)?.content, '# First operation');
		}],
		['v2-record-writes-file-manager-links-through-obsidian-repository', async () => {
			for (const linkStyle of ['wikilink', 'markdown']) {
				const harness = createHarness(linkStyle);
				seedProject(harness, { includeClaude: false });
				const adapter = ObsidianKnowledgeIndexAdapter.create(harness.app, tempRoot);
				await adapter.rebuild();
				const repository = new ObsidianVaultRepository(
					harness.vault,
					harness.fileManager
				);
				const targetPath = `${PROJECT_ROOT}/agents/codex/v2-native-${linkStyle}.md`;
				const relationTargets = [HUB_PATH, WIKI_PATH, SOURCE_PATH];
				const relationLinks = relationTargets.map((targetPath) =>
					repository.generateMarkdownLink(targetPath, `${PROJECT_ROOT}/agents/codex/v2-native-${linkStyle}.md`)
				);
				const built = buildMemoryRecord({
					path: targetPath,
					memory_id: `memory-native-${linkStyle}`,
					scope: 'project',
					project_id: 'project-alpha-id',
					agent_type: 'codex',
					operation_id: `native-${linkStyle}-operation`,
					memory_kind: 'task_decision',
					claim_key: `native ${linkStyle} links`,
					authority: 'source',
					confidence_level: 'supported',
					declared_state: 'active',
					observed_at: '2026-07-30T13:00:00.000Z',
					valid_from: null,
					valid_to: null,
					last_verified_at: null,
					evidence: [SOURCE_PATH],
					supersedes: [],
					contradicts: [],
					project_hub: HUB_PATH,
					global_hub: null,
					related_wiki: [WIKI_PATH],
					related_sources: [SOURCE_PATH],
					body: [`Native ${linkStyle} project-memory body.`, '', ...relationLinks].join('\n'),
				});
				const result = await repository.createText(targetPath, built.markdown);
				const created = harness.records.get(result.path)?.content;
				assert.equal(typeof created, 'string');
				assert.match(created, new RegExp(`Native ${linkStyle} project-memory body\\.`));
				if (linkStyle === 'wikilink') {
					assert.ok(created.includes(`[[${HUB_PATH.replace(/\.md$/i, '')}]]`));
					assert.ok(created.includes(`[[${WIKI_PATH.replace(/\.md$/i, '')}]]`));
					assert.ok(created.includes(`[[${SOURCE_PATH.replace(/\.md$/i, '')}]]`));
				} else {
					assert.ok(created.includes('[index](../../index.md)'));
					assert.ok(created.includes('[shared](../../../../../wiki/shared.md)'));
					assert.ok(created.includes('[local-source](../../../../../sources/local-source.md)'));
				}
				assert.deepEqual(
					harness.generatedLinks.map(({ targetPath, sourcePath }) => ({
						targetPath,
						sourcePath,
					})),
					[HUB_PATH, WIKI_PATH, SOURCE_PATH].map((relationTargetPath) => ({
						targetPath: relationTargetPath,
						sourcePath: targetPath,
					}))
				);
			}
		}],
		['project-memory-projector-and-catalog-consume-native-shared-snapshot', async () => {
			const harness = createHarness();
			seedProject(harness);
			const adapter = ObsidianKnowledgeIndexAdapter.create(harness.app, tempRoot);
			await adapter.rebuild();
			const nativeSnapshot = await adapter.knowledgeSnapshot();
			const scan = adapter.scanSnapshot(tempRoot);
			assert.ok(scan);

			const projection = projectProjectMemorySnapshot(scan);
			const catalog = buildProjectMemoryCatalog(projection, {
				projectId: 'project-alpha-id',
				pageSize: 10,
			});
			const hub = projection.hubs.find(({ project_id: projectId }) =>
				projectId === 'project-alpha-id'
			);
			const codex = projection.entries.find(({ entry }) => entry.path === CODEX_PATH);
			const claude = projection.entries.find(({ entry }) => entry.path === CLAUDE_PATH);

			assert.equal(nativeSnapshot.notes.get(CODEX_PATH)?.frontmatter.type, 'project_memory_entry');
			assert.equal(projection.generation, nativeSnapshot.generation);
			assert.equal(projection.index_state, 'ready');
			assert.equal(hub?.project_key, 'project-alpha');
			assert.equal(hub?.project_hub, HUB_PATH);
			assert.deepEqual(hub?.backlinks, [CLAUDE_PATH, CODEX_PATH]);
			assert.deepEqual(nativeSnapshot.graph.incoming.get(HUB_PATH), [CLAUDE_PATH, CODEX_PATH]);
			assert.equal(codex?.entry.agent_type, 'codex');
			assert.equal(codex?.relations.hub_linked, true);
			assert.deepEqual(codex?.relations.related_wiki, [WIKI_PATH]);
			assert.deepEqual(codex?.relations.related_sources, [SOURCE_PATH]);
			assert.equal(claude?.entry.agent_type, 'claude-code');
			assert.equal(claude?.relations.hub_linked, true);
			assert.deepEqual(claude?.relations.related_wiki, [WIKI_PATH]);
			assert.equal(catalog.project_id, 'project-alpha-id');
			assert.equal(catalog.project_hub, HUB_PATH);
			assert.equal(catalog.generation, nativeSnapshot.generation);
			assert.equal(catalog.total, 3);
			assert.deepEqual(catalog.counts_by_agent, {
				'claude-code': 1,
				codex: 1,
			});
			assert.equal(catalog.entries.some(({ path: entryPath }) => entryPath === LEGACY_PATH), true);
			assert.equal(catalog.entries.some(({ path: entryPath }) => entryPath === CODEX_PATH), true);
			assert.equal(catalog.entries.some(({ path: entryPath }) => entryPath === CLAUDE_PATH), true);
		}],
	]);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
