#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-record-lifecycle-plugin-'));
const controllerOutput = path.join(tempRoot, 'review-queue-controller.cjs');
const activityOutput = path.join(tempRoot, 'activity-data-controller.cjs');
const repositoryOutput = path.join(tempRoot, 'activity-record-repository.cjs');
const auditRepositoryOutput = path.join(tempRoot, 'native-audit-repository.cjs');
const runtimeLogModelOutput = path.join(tempRoot, 'runtime-log-model.cjs');
const activityModelOutput = path.join(tempRoot, 'activity-model.cjs');
const require = createRequire(import.meta.url);

class StubTFile {
	constructor(path, content = '', mtime = Date.now()) {
		this.path = path;
		this.basename = path.split('/').pop().replace(/\.md$/i, '');
		this.extension = path.split('.').pop();
		this.content = content;
		this.stat = { mtime, size: content.length };
	}
}

class StubTFolder {
	constructor(path, children = []) {
		this.path = path;
		this.children = children;
	}
}

globalThis.__tracekeeperRecordLifecycleTFile = StubTFile;
globalThis.__tracekeeperRecordLifecycleTFolder = StubTFolder;
globalThis.window = globalThis;

const obsidianStub = {
	name: 'obsidian-stub',
	setup(buildContext) {
		buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
			path: 'obsidian-stub',
			namespace: 'obsidian-stub',
		}));
		buildContext.onLoad({ filter: /^obsidian-stub$/, namespace: 'obsidian-stub' }, () => ({
			loader: 'js',
			contents: `
				export function getLanguage() {
					return 'en';
				}
				export class App {}
				export const TFile = globalThis.__tracekeeperRecordLifecycleTFile;
				export const TFolder = globalThis.__tracekeeperRecordLifecycleTFolder;
			`,
		}));
	},
};

await Promise.all([
	build({
		entryPoints: ['src/features/review/review-queue-controller.ts'],
		outfile: controllerOutput,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
		plugins: [obsidianStub],
	}),
	build({
		entryPoints: ['src/features/activity/activity-data-controller.ts'],
		outfile: activityOutput,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
		plugins: [obsidianStub],
	}),
	build({
		entryPoints: ['src/features/activity/activity-record-repository.ts'],
		outfile: repositoryOutput,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
		plugins: [obsidianStub],
	}),
	build({
		entryPoints: ['src/features/activity/native-audit-repository.ts'],
		outfile: auditRepositoryOutput,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
		plugins: [obsidianStub],
	}),
	build({
		entryPoints: ['src/features/activity/activity-model.ts'],
		outfile: activityModelOutput,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
		plugins: [obsidianStub],
	}),
	build({
		entryPoints: ['src/features/runtime/runtime-log-model.ts'],
		outfile: runtimeLogModelOutput,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
		plugins: [obsidianStub],
	}),
]);

const { ReviewQueueController } = require(controllerOutput);
const { ActivityDataController } = require(activityOutput);
const { ActivityRecordRepository } = require(repositoryOutput);
const { ObsidianAuditShardRepository } = require(auditRepositoryOutput);
const { ACTIVITY_TIMELINE_MAX_ITEMS } = require(activityModelOutput);
const {
	RUNTIME_LOG_MAX_EVENTS,
	runtimeLogTrashBehaviorDescription,
} = require(runtimeLogModelOutput);
const {
	computePayloadHash,
	hashVaultContent,
	TRACEKEEPER_AGENT_REQUESTS_DIR,
	TRACEKEEPER_TASKS_DIR,
} = require('@tracekeeper/core');

const withBindingHash = (record) => {
	const rebound = structuredClone(record);
	const { bindingHash: _bindingHash, ...payload } = rebound;
	rebound.bindingHash = computePayloadHash(payload);
	return rebound;
};

const makeProposal = (overrides = {}) => ({
	path: '00_tracekeeper/inbox/review_queue/proposal.md',
	classification: 'memory_proposal',
	proposalId: 'proposal-one',
	proposalKind: 'decision',
	proposedBy: 'agent',
	relatedProject: 'record-lifecycle',
	memoryScope: 'project',
	taskId: 'task-one',
	sourceSessionNote: '00_tracekeeper/work/sessions/session-one.md',
	targetNote: '01_knowledge/wiki/target.md',
	evidence: [],
	relatedSources: [],
	rationale: '',
	riskLevel: 'medium',
	approvalStatus: 'applied',
	created: '2026-07-30T00:00:00.000Z',
	snippet: 'proposal',
	sortTimestamp: Date.parse('2026-07-30T00:00:00.000Z'),
	revisionComment: '',
	revisionRequestedAt: '',
	revisionRequestedBy: '',
	writebackContent: 'Writeback.',
	writebackSource: 'body',
	archived: false,
	contentHash: 'semantic-hash',
	fileContentHash: 'file-hash',
	revision: 'revision-one',
	...overrides,
});

const normalizePath = (value) => String(value).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

const renderFixtureLink = (targetPath, sourcePath, useMarkdownLinks) => {
	const normalizedTarget = normalizePath(targetPath);
	const basename = normalizedTarget.split('/').pop().replace(/\.md$/i, '');
	if (!useMarkdownLinks) {
		return `[[${normalizedTarget.replace(/\.md$/i, '')}|${basename}]]`;
	}
	const relative = path.posix.relative(
		path.posix.dirname(normalizePath(sourcePath)),
		normalizedTarget
	);
	return `[${basename}](${relative})`;
};

const createNativeVaultFixture = ({
	files = {},
	useMarkdownLinks = false,
	alwaysUpdateLinks = true,
	trashFailures = [],
	processFailure = null,
	afterProcess = null,
	beforeCreate = null,
	beforeTrashFile = null,
	afterTrashFile = null,
} = {}) => {
	const records = new Map();
	const processCallCounts = new Map();
	const calls = {
		directRename: [],
		nativeRename: [],
		generateLink: [],
		process: [],
		trash: [],
		delete: [],
		metadata: [],
		cachedRead: [],
		refresh: 0,
		order: [],
	};
	const failedTrashPaths = new Set(trashFailures.map(normalizePath));

	const put = (relativePath, content, mtime = Date.now()) => {
		const normalized = normalizePath(relativePath);
		const existing = records.get(normalized);
		const file = existing || new StubTFile(normalized, String(content), mtime);
		file.path = normalized;
		file.basename = normalized.split('/').pop().replace(/\.md$/i, '');
		file.extension = normalized.split('.').pop();
		file.content = String(content);
		file.stat = { mtime, size: file.content.length };
		records.set(normalized, file);
		return file;
	};
	for (const [relativePath, value] of Object.entries(files)) {
		if (typeof value === 'string') {
			put(relativePath, value);
		} else {
			put(relativePath, value.content, value.mtime);
		}
	}

	const folderAt = (relativePath) => {
		const normalized = normalizePath(relativePath);
		const prefix = normalized ? `${normalized}/` : '';
		const childNames = new Set();
		for (const filePath of records.keys()) {
			if (!filePath.startsWith(prefix)) {
				continue;
			}
			const remainder = filePath.slice(prefix.length);
			if (!remainder) {
				continue;
			}
			childNames.add(remainder.split('/')[0]);
		}
		if (childNames.size === 0) {
			return null;
		}
		const children = [...childNames]
			.sort()
			.map((name) => {
				const childPath = normalized ? `${normalized}/${name}` : name;
				return records.get(childPath) || folderAt(childPath);
			})
			.filter(Boolean);
		return new StubTFolder(normalized, children);
	};

	const move = (file, targetPath) => {
		const sourcePath = normalizePath(file.path);
		const normalizedTarget = normalizePath(targetPath);
		if (records.has(normalizedTarget)) {
			throw new Error(`destination exists: ${normalizedTarget}`);
		}
		if (!records.has(sourcePath)) {
			throw new Error(`source missing: ${sourcePath}`);
		}
		records.delete(sourcePath);
		file.path = normalizedTarget;
		file.basename = normalizedTarget.split('/').pop().replace(/\.md$/i, '');
		file.extension = normalizedTarget.split('.').pop();
		records.set(normalizedTarget, file);
	};

	const expectedGeneratedLink = (targetPath, sourcePath) => {
		return renderFixtureLink(targetPath, sourcePath, useMarkdownLinks);
	};

	const vault = {
		getAbstractFileByPath(relativePath) {
			const normalized = normalizePath(relativePath);
			return records.get(normalized) || folderAt(normalized);
		},
		async cachedRead(file) {
			calls.cachedRead.push(normalizePath(file.path));
			return records.get(normalizePath(file.path))?.content ?? '';
		},
		async read(file) {
			return records.get(normalizePath(file.path))?.content ?? '';
		},
		async process(file, updater) {
			const currentPath = normalizePath(file.path);
			const current = records.get(currentPath);
			if (!current) {
				throw new Error(`process source missing: ${currentPath}`);
			}
			calls.process.push(currentPath);
			calls.order.push(`process:${currentPath}`);
			const previousContent = current.content;
			const next = updater(previousContent);
			const pathCallIndex = (processCallCounts.get(currentPath) || 0) + 1;
			processCallCounts.set(currentPath, pathCallIndex);
			const injectedFailure = processFailure?.({
				path: currentPath,
				callIndex: calls.process.length,
				pathCallIndex,
				currentContent: previousContent,
				nextContent: next,
			});
			if (injectedFailure) {
				throw injectedFailure instanceof Error
					? injectedFailure
					: new Error(String(injectedFailure));
			}
			put(currentPath, next, current.stat.mtime + 1);
			await afterProcess?.({
				path: currentPath,
				callIndex: calls.process.length,
				pathCallIndex,
				currentContent: previousContent,
				nextContent: next,
				exists(relativePath) {
					return records.has(normalizePath(relativePath));
				},
				read(relativePath) {
					return records.get(normalizePath(relativePath))?.content ?? null;
				},
				write(relativePath, content) {
					return put(relativePath, content);
				},
			});
			return next;
		},
		async create(relativePath, content) {
			const normalized = normalizePath(relativePath);
			if (records.has(normalized)) {
				throw new Error(`create destination exists: ${normalized}`);
			}
			await beforeCreate?.({
				path: normalized,
				content: String(content),
			});
			if (records.has(normalized)) {
				throw new Error(`create destination exists: ${normalized}`);
			}
			return put(normalized, content);
		},
		async modify(file, content) {
			return put(file.path, content, file.stat.mtime + 1);
		},
		async rename(file, targetPath) {
			calls.directRename.push([normalizePath(file.path), normalizePath(targetPath)]);
			calls.order.push(`vault.rename:${normalizePath(file.path)}`);
			move(file, targetPath);
		},
		async delete(file) {
			const target = normalizePath(file.path);
			calls.delete.push(target);
			records.delete(target);
		},
		getConfig(key) {
			if (key === 'useMarkdownLinks') {
				return useMarkdownLinks;
			}
			if (key === 'alwaysUpdateLinks') {
				return alwaysUpdateLinks;
			}
			return undefined;
		},
	};

	const fileManager = {
		generateMarkdownLink(file, sourcePath) {
			calls.generateLink.push([normalizePath(file.path), normalizePath(sourcePath)]);
			calls.order.push(`generate-link:${normalizePath(sourcePath)}`);
			return expectedGeneratedLink(file.path, sourcePath);
		},
		async renameFile(file, targetPath) {
			const sourcePath = normalizePath(file.path);
			const normalizedTarget = normalizePath(targetPath);
			calls.nativeRename.push([sourcePath, normalizedTarget]);
			calls.order.push(`rename-file:${sourcePath}`);
			move(file, targetPath);
			if (alwaysUpdateLinks) {
				for (const [recordPath, record] of records) {
					if (recordPath === normalizedTarget) {
						continue;
					}
					let next = record.content;
					for (const markdownLinks of [false, true]) {
						next = next.replaceAll(
							renderFixtureLink(sourcePath, recordPath, markdownLinks),
							renderFixtureLink(normalizedTarget, recordPath, markdownLinks)
						);
					}
					if (next !== record.content) {
						put(recordPath, next, record.stat.mtime + 1);
					}
				}
			}
		},
		async trashFile(file) {
			const target = normalizePath(file.path);
			calls.trash.push(target);
			calls.order.push(`trash-file:${target}`);
			await beforeTrashFile?.({
				path: target,
				exists(relativePath) {
					return records.has(normalizePath(relativePath));
				},
				read(relativePath) {
					return records.get(normalizePath(relativePath))?.content ?? null;
				},
				write(relativePath, content) {
					return put(relativePath, content);
				},
			});
			if (failedTrashPaths.has(target)) {
				throw new Error(`configured trash failure: ${target}`);
			}
			records.delete(target);
			await afterTrashFile?.({
				path: target,
				exists(relativePath) {
					return records.has(normalizePath(relativePath));
				},
				read(relativePath) {
					return records.get(normalizePath(relativePath))?.content ?? null;
				},
				write(relativePath, content) {
					return put(relativePath, content);
				},
			});
		},
	};

	return {
		app: {
			vault,
			fileManager,
			metadataCache: {
				getFileCache(file) {
					const content = records.get(normalizePath(file.path))?.content ?? '';
					const normalized = content.replace(/\r\n/g, '\n');
					if (!normalized.startsWith('---\n')) {
						return {};
					}
					const end = normalized.indexOf('\n---\n', 4);
					return end < 0
						? {}
						: { frontmatter: parseKeyValueRows(normalized.slice(4, end).split('\n')) };
				},
			},
		},
		calls,
		records,
		expectedGeneratedLink,
		exists(relativePath) {
			return records.has(normalizePath(relativePath));
		},
		file(relativePath) {
			return records.get(normalizePath(relativePath)) || null;
		},
		read(relativePath) {
			return records.get(normalizePath(relativePath))?.content ?? null;
		},
		write(relativePath, content) {
			return put(relativePath, content);
		},
	};
};

const proposalMarkdown = ({
	proposalId = 'proposal-one',
	taskId = 'task-one',
	sessionPath = '00_tracekeeper/work/sessions/session-one.md',
	status = 'applied',
} = {}) => [
	'---',
	'type: memory_proposal',
	`proposal_id: ${proposalId}`,
	'proposal_kind: decision',
	`approval_status: ${status}`,
	`status: ${status}`,
	`task_id: ${taskId}`,
	`proposal_source_session_note: ${sessionPath}`,
	'target_note: 01_knowledge/wiki/target.md',
	'created: 2026-07-30T00:00:00.000Z',
	'---',
	'## Writeback',
	'',
	'Stable lifecycle writeback.',
	'',
].join('\n');

const managedReferenceMarkdown = ({
	type,
	proposalId = 'proposal-one',
	proposalPath = '00_tracekeeper/inbox/review_queue/proposal.md',
	link,
} = {}) => [
	'---',
	`type: ${type}`,
	`proposal_ids: [${proposalId}]`,
	`proposal_paths: [${proposalPath}]`,
	'---',
	'# Managed reference',
	'',
	`Proposal: ${link}`,
	'',
].join('\n');

const createArchiveHarness = ({
	useMarkdownLinks = false,
	storedUseMarkdownLinks = useMarkdownLinks,
	alwaysUpdateLinks = true,
	extraFiles = {},
	processFailure = null,
	afterProcess = null,
	beforeMetadataWait = null,
	afterArchiveReceiptWrite = null,
	afterArchiveTargetClaimWrite = null,
	beforeArchiveAuditAppend = null,
	afterArchiveAuditAppend = null,
	beforeRefreshGovernanceViews = null,
	afterRefreshGovernanceViews = null,
	nowFactory = () => new Date(),
} = {}) => {
	const proposalPath = '00_tracekeeper/inbox/review_queue/proposal.md';
	const destinationPath = '02_archive/review_queue/proposal.md';
	const taskPath = '00_tracekeeper/work/tasks/task-one.md';
	const sessionPath = '00_tracekeeper/work/sessions/session-one.md';
	const initialProposal = proposalMarkdown();
	const fixture = createNativeVaultFixture({
		useMarkdownLinks,
		alwaysUpdateLinks,
		processFailure,
		afterProcess,
		files: {
			[proposalPath]: initialProposal,
			'01_knowledge/wiki/target.md': '# Target\n',
			[taskPath]: managedReferenceMarkdown({
				type: 'agent-task',
				proposalPath,
				link: renderFixtureLink(
					proposalPath,
					taskPath,
					storedUseMarkdownLinks
				),
			}),
			[sessionPath]: managedReferenceMarkdown({
				type: 'session-note',
				proposalPath,
				link: renderFixtureLink(
					proposalPath,
					sessionPath,
					storedUseMarkdownLinks
				),
			}),
			'00_tracekeeper/control/audit_log.md': [
				'# Audit Log',
				'',
				'## 2026-07-30T00:00:00.000Z',
				'action: writeback.apply',
				'proposal_id: proposal-one',
				`proposal_path: ${proposalPath}`,
				'timestamp: 2026-07-30T00:00:00.000Z',
				'',
			].join('\n'),
			'00_tracekeeper/control/operations/writeback-operation.json': JSON.stringify({
				operationId: 'writeback-operation',
				proposalId: 'proposal-one',
				proposalPath,
				status: 'completed',
			}),
			...extraFiles,
		},
	});
	const records = new ActivityRecordRepository(fixture.app);
	const receipts = new Map();
	const targetClaims = new Map();
	const archiveAudits = new Map();
	const archiveAuditAttempts = [];
	let operationCounter = 0;
	const host = {
		async refreshGovernanceViews() {
			await beforeRefreshGovernanceViews?.();
			fixture.calls.refresh += 1;
			await afterRefreshGovernanceViews?.();
		},
		async appendToAuditLog(entry) {
			const current = fixture.read('00_tracekeeper/control/audit_log.md') || '# Audit Log\n\n';
			fixture.write('00_tracekeeper/control/audit_log.md', `${current.trimEnd()}\n\n${entry}`);
		},
		async ensureFolderExists() {},
		normalizeVaultPath(value) {
			return normalizePath(value);
		},
		async loadReviewKnowledgeSnapshot() {
			return { state: 'ready', notes: [] };
		},
		async waitForNativePath(sourcePath, targetPath) {
			fixture.calls.metadata.push([normalizePath(sourcePath), normalizePath(targetPath)]);
			fixture.calls.order.push(`metadata:${normalizePath(targetPath)}`);
			await beforeMetadataWait?.({
				sourcePath: normalizePath(sourcePath),
				targetPath: normalizePath(targetPath),
			});
			if (!fixture.exists(targetPath)) {
				throw new Error(`metadata path missing: ${targetPath}`);
			}
		},
		async readArchiveReceipt(operationId) {
			return receipts.get(operationId) || null;
		},
		async writeArchiveReceipt(receipt, expectedBindingHash) {
			const current = receipts.get(receipt.operationId);
			if (!current) {
				if (expectedBindingHash !== null) {
					throw new Error('archive receipt disappeared before update');
				}
				receipts.set(receipt.operationId, structuredClone(receipt));
				await afterArchiveReceiptWrite?.(structuredClone(receipt));
				return;
			}
			if (JSON.stringify(current) === JSON.stringify(receipt)) {
				return;
			}
			if (
				expectedBindingHash === null
				|| current.bindingHash !== expectedBindingHash
			) {
				throw new Error('archive receipt changed outside the operation');
			}
			receipts.set(receipt.operationId, structuredClone(receipt));
			await afterArchiveReceiptWrite?.(structuredClone(receipt));
		},
		async readArchiveTargetClaim(targetHash) {
			return targetClaims.get(targetHash) || null;
		},
		async writeArchiveTargetClaim(claim, expectedBindingHash) {
			const current = targetClaims.get(claim.targetHash);
			if (!current) {
				if (expectedBindingHash !== null) {
					throw new Error('archive target claim disappeared before update');
				}
				targetClaims.set(claim.targetHash, structuredClone(claim));
				await afterArchiveTargetClaimWrite?.(structuredClone(claim));
				return;
			}
			if (JSON.stringify(current) === JSON.stringify(claim)) {
				return;
			}
			if (
				expectedBindingHash === null
				|| current.bindingHash !== expectedBindingHash
			) {
				throw new Error('archive target claim changed outside the operation');
			}
			targetClaims.set(claim.targetHash, structuredClone(claim));
			await afterArchiveTargetClaimWrite?.(structuredClone(claim));
		},
		async appendArchiveAuditEvent(operationId, entry) {
			archiveAuditAttempts.push(entry);
			await beforeArchiveAuditAppend?.({ operationId, entry });
			if (!archiveAudits.has(operationId)) {
				archiveAudits.set(operationId, entry);
				const current =
					fixture.read('00_tracekeeper/control/audit_log.md')
					|| '# Audit Log\n\n';
				fixture.write(
					'00_tracekeeper/control/audit_log.md',
					`${current.trimEnd()}\n\n${entry}`
				);
			}
			await afterArchiveAuditAppend?.({ operationId, entry });
		},
	};
	const transitions = {
		async transition() {
			throw new Error('review transition is not used by the archive characterization');
		},
	};
	const createController = () => new ReviewQueueController(
		fixture.app,
		records,
		host,
		transitions,
		() => `archive-operation-${++operationCounter}`,
		nowFactory
	);
	return {
		...fixture,
		createController,
		records,
		receipts,
		targetClaims,
		archiveAudits,
		archiveAuditAttempts,
		proposalPath,
		destinationPath,
		taskPath,
		sessionPath,
		async currentProposal() {
			const active = await records.readRecentMemoryProposals(10);
			assert.equal(active.length, 1);
			return active[0];
		},
	};
};

const parseKeyValueRows = (lines) => {
	const fields = {};
	for (const line of lines) {
		const match = line.match(/^\s*-\s*([^:]+):\s*(.*)$/) || line.match(/^\s*([^:]+):\s*(.*)$/);
		if (match) {
			fields[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
		}
	}
	return fields;
};

const createActivityHost = (fixture) => ({
		async readRecentAgentTasks() {
			return [];
		},
		async readRecentContextPacks() {
			return [];
		},
		async readRecentSourceCaptures() {
			return [];
		},
		async readRecentSourceRequests() {
			return [];
		},
		async readMemoryProposalWindow() {
			return { records: [], totalItems: 0, isTruncated: false };
		},
		async readActivityTimelineRecords() {
			return {
				tasks: [],
				contextPacks: [],
				sourceCaptures: [],
				sourceRequests: [],
				proposals: [],
				isTruncated: false,
			};
		},
		getStructureStatus() {
			return {};
		},
		getRuntimeViewStatus() {
			return {};
		},
		getVaultRoot() {
			return '/temporary-vault';
		},
		async refreshGovernanceViews() {},
		readFrontmatter(content) {
			const normalized = String(content).replace(/\r\n/g, '\n');
			if (!normalized.startsWith('---\n')) {
				return { fields: {}, body: normalized };
			}
			const end = normalized.indexOf('\n---\n', 4);
			if (end < 0) {
				return { fields: {}, body: normalized };
			}
			return {
				fields: parseKeyValueRows(normalized.slice(4, end).split('\n')),
				body: normalized.slice(end + 5),
			};
		},
		firstString(values, keys) {
			for (const key of keys) {
				const value = values[key];
				if (Array.isArray(value)) {
					return String(value[0] || '');
				}
				if (value !== undefined) {
					return String(value);
				}
			}
			return '';
		},
		readStringList(values, keys) {
			return keys.flatMap((key) => {
				const value = values[key];
				return Array.isArray(value)
					? value.map(String)
					: typeof value === 'string' && value
						? value.split(',').map((item) => item.trim()).filter(Boolean)
						: [];
			});
		},
		readKeyValueRows(lines) {
			return parseKeyValueRows(lines);
		},
		parseTimestamp(value, fallback = 0) {
			return Date.parse(value || '') || fallback;
		},
		timestampFromFilename() {
			return '';
		},
		snippetFromText() {
			return '';
		},
		trimText(value) {
			return value;
		},
		buildAuditLogHeader() {
			return '# Audit Log\n\n';
		},
		async ensureFolderExists() {},
		formatAgentDisplayName(value) {
			return value;
		},
		formatToolDisplayName(value) {
			return value;
		},
		formatResultLabel(value) {
			return value;
		},
		formatRiskLabel(value) {
			return value;
		},
		async waitForNativePath() {},
		getConfiguredTrashDescription() {
			return 'Obsidian configured trash';
		},
	});

const createActivityHarness = ({
	files = {},
	trashFailures = [],
	processFailure = null,
	afterProcess = null,
	beforeTrashFile = null,
	afterTrashFile = null,
} = {}) => {
	const fixture = createNativeVaultFixture({
		files,
		trashFailures,
		processFailure,
		afterProcess,
		beforeTrashFile,
		afterTrashFile,
	});
	const host = createActivityHost(fixture);
	host.refreshGovernanceViews = async () => {
		fixture.calls.refresh += 1;
	};
	return {
		...fixture,
		host,
		createController() {
			return new ActivityDataController(fixture.app, host);
		},
	};
};

const auditMarkdown = (...timestamps) => {
	const day = timestamps[0]?.slice(0, 10) || '2000-01-01';
	return [
		'---',
		'type: tracekeeper_agent_activity_shard',
		'agent_activity_schema_version: 1',
		`activity_date_utc: ${day}`,
		`created_at: ${timestamps[0] || `${day}T00:00:00.000Z`}`,
		`updated_at: ${timestamps.at(-1) || `${day}T00:00:00.000Z`}`,
		'---',
		`# Agent activity ${day}`,
		'',
		...timestamps.flatMap((timestamp, index) => [
			`## ${timestamp}`,
			'type: mcp.tool_call',
			'event: mcp.tool_call',
			`activity_event_id: fixture-${timestamp}-${index + 1}`,
			`action: fixture.event.${index + 1}`,
			`timestamp: ${timestamp}`,
			'',
		]),
	].join('\n');
};

const auditEventSection = ({ id, timestamp, action }) => [
	`## ${timestamp}`,
	'type: mcp.tool_call',
	'event: mcp.tool_call',
	'agent_activity_schema_version: 1',
	`activity_event_id: ${id}`,
	`action: ${action}`,
	`timestamp: ${timestamp}`,
	'',
].join('\n');

const commitArchive = async (harness) => {
	const controller = harness.createController();
	assert.equal(typeof controller.previewArchiveMemoryProposals, 'function');
	assert.equal(typeof controller.commitArchiveMemoryProposals, 'function');
	const preview = await controller.previewArchiveMemoryProposals([
		await harness.currentProposal(),
	]);
	const receipt = await controller.commitArchiveMemoryProposals(
		preview,
		preview.confirmationToken
	);
	return { controller, preview, receipt };
};

test('archive entrypoint uses the native lifecycle and preserves managed history', async () => {
	const harness = createArchiveHarness();
	const controller = harness.createController();
	const moved = await controller.archiveMemoryProposals([
		await harness.currentProposal(),
	]);
	assert.equal(moved, 1);
	assert.deepEqual(harness.calls.directRename, []);
	assert.deepEqual(harness.calls.nativeRename, [[harness.proposalPath, harness.destinationPath]]);
	assert.deepEqual(harness.calls.metadata, [[harness.proposalPath, harness.destinationPath]]);
	assert.equal(harness.exists(harness.proposalPath), false);
	assert.equal(harness.exists(harness.destinationPath), true);
	for (const referencePath of [harness.taskPath, harness.sessionPath]) {
		const content = harness.read(referencePath);
		assert.equal(content.includes(harness.proposalPath), false);
		assert.match(content, new RegExp(harness.destinationPath));
	}
	assert.deepEqual(await harness.records.readRecentMemoryProposals(10), []);
	assert.equal(
		(await harness.records.readProposalHistoryById('proposal-one')).record.path,
		harness.destinationPath
	);
});

test('cleanup retains mixed legacy content and trashes only wholly eligible shards', async () => {
	const oldShard = '00_tracekeeper/control/agent_activity/2000/2000-01-01.md';
	const newShard = '00_tracekeeper/control/agent_activity/2999/2999-01-01.md';
	const legacy = '00_tracekeeper/control/audit_log.md';
	const task = '00_tracekeeper/work/tasks/not-audit.md';
	const harness = createActivityHarness({
		files: {
			[oldShard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
			[newShard]: auditMarkdown('2999-01-01T00:00:00.000Z'),
			[legacy]: auditMarkdown(
				'2000-01-01T00:00:00.000Z',
				'2999-01-01T00:00:00.000Z'
			),
			[task]: '# Task\n',
		},
	});
	const legacyBefore = harness.read(legacy);
	const controller = harness.createController();
	const preview = await controller.previewRuntimeLogCleanup('older-than-week');
	const result = await controller.commitRuntimeLogCleanup(
		preview,
		preview.confirmationToken
	);
	assert.equal(result.status, 'completed');
	assert.deepEqual(result.trashedPaths, [oldShard]);
	assert.deepEqual(harness.calls.delete, []);
	assert.deepEqual(harness.calls.trash, [oldShard]);
	assert.equal(harness.exists(oldShard), false);
	assert.equal(harness.exists(newShard), true);
	assert.equal(harness.exists(task), true);
	assert.equal(harness.read(legacy), legacyBefore);
});

test('active proposal enumeration stays active-only while history resolves archive ids', async () => {
	const activePath = '00_tracekeeper/inbox/review_queue/active.md';
	const archivedPath = '02_archive/review_queue/archived.md';
	const fixture = createNativeVaultFixture({
		files: {
			[activePath]: proposalMarkdown({ proposalId: 'active-proposal' }),
			[archivedPath]: proposalMarkdown({ proposalId: 'archived-proposal' }),
		},
	});
	const repository = new ActivityRecordRepository(fixture.app);
	const active = await repository.readRecentMemoryProposals(20);
	assert.deepEqual(active.map((record) => record.path), [activePath]);
	assert.equal(typeof ActivityRecordRepository.prototype.readProposalHistoryById, 'function');
	assert.equal(typeof ActivityRecordRepository.prototype.readRecentProposalHistory, 'function');
	const archived = await repository.readProposalHistoryById('archived-proposal');
	assert.equal(archived.status, 'resolved');
	assert.equal(archived.record.path, archivedPath);
	assert.equal(archived.record.archived, true);
	const history = await repository.readRecentProposalHistory(20);
	assert.deepEqual(
		new Set(history.map((record) => record.path)),
		new Set([activePath, archivedPath])
	);
	const missing = await repository.readProposalHistoryById('missing-proposal');
	assert.deepEqual(missing, {
		status: 'missing',
		proposalId: 'missing-proposal',
		matches: [],
	});
	fixture.write(
		'02_archive/review_queue/duplicate.md',
		proposalMarkdown({ proposalId: 'active-proposal' })
	);
	const ambiguous = await repository.readProposalHistoryById('active-proposal');
	assert.equal(ambiguous.status, 'ambiguous');
	assert.deepEqual(
		ambiguous.matches.map((record) => record.path),
		[
			activePath,
			'02_archive/review_queue/duplicate.md',
		].sort()
	);
	fixture.write(
		'02_archive/review_queue/legacy-fallback.md',
		proposalMarkdown({ proposalId: '' }).replace('proposal_id: ', '')
	);
	const fallback = await repository.readProposalHistoryById('legacy-fallback.md');
	assert.equal(fallback.status, 'missing');
});

test('review proposal window bounds body reads and prioritizes attention items', async () => {
	const processedPath = '00_tracekeeper/inbox/review_queue/recent-applied.md';
	const pendingPath = '00_tracekeeper/inbox/review_queue/older-pending.md';
	const fixture = createNativeVaultFixture({
		files: {
			[processedPath]: {
				content: proposalMarkdown({ proposalId: 'recent-applied', status: 'applied' }),
				mtime: Date.parse('2026-07-31T00:00:00.000Z'),
			},
			[pendingPath]: {
				content: proposalMarkdown({ proposalId: 'older-pending', status: 'pending' }),
				mtime: Date.parse('2026-07-29T00:00:00.000Z'),
			},
		},
	});
	const repository = new ActivityRecordRepository(fixture.app);
	const window = await repository.readMemoryProposalWindow(1);
	assert.equal(window.totalItems, 2);
	assert.equal(window.isTruncated, true);
	assert.deepEqual(window.records.map((record) => record.path), [pendingPath]);
	const nextWindow = await repository.readMemoryProposalWindow(1, 1);
	assert.equal(nextWindow.offset, 1);
	assert.deepEqual(nextWindow.records.map((record) => record.path), [processedPath]);
});

test('agent task projection reads additive durable-output finish snapshots', async () => {
	const taskPath = '00_tracekeeper/work/tasks/durable-output-snapshot.md';
	const malformedPath = '00_tracekeeper/work/tasks/durable-output-malformed.md';
	const fixture = createNativeVaultFixture({
		files: {
			[taskPath]: [
				'---',
				'type: agent-task',
				'task_id: durable-output-snapshot',
				'status: completed',
				'durable_output_status_at_finish: Pending_Review',
				'durable_output_proposal_count: 2',
				'durable_output_source_capture_count: 3',
				'durable_output_pending_review_count: 1',
				'durable_output_ready_to_apply_count: 0',
				'durable_output_revision_requested_count: 0',
				'durable_output_applied_count: 1',
				'durable_output_rejected_count: 0',
				'durable_output_unresolved_count: 1',
				'durable_output_proposal_ids_at_finish: proposal-one, proposal-two',
				'durable_output_applied_proposal_ids: proposal-one',
				'durable_output_proposal_paths: 00_tracekeeper/inbox/review_queue/proposal-one.md, 00_tracekeeper/inbox/review_queue/proposal-two.md',
				'durable_output_target_paths: 01_knowledge/wiki/one.md, 01_knowledge/wiki/two.md',
				'proposal_ids: [proposal-one, proposal-two]',
				'proposal_paths: [00_tracekeeper/inbox/review_queue/proposal-one.md, 00_tracekeeper/inbox/review_queue/proposal-two.md]',
				'source_captures: [00_tracekeeper/sources/source-one.md]',
				'---',
				'# Durable output snapshot',
				'',
			].join('\n'),
			[malformedPath]: [
				'---',
				'type: agent-task',
				'task_id: durable-output-malformed',
				'durable_output_status_at_finish: future_status',
				'durable_output_proposal_count: 1oops',
				'durable_output_source_capture_count: -1',
				'durable_output_applied_count: 2.5',
				'durable_output_unresolved_count: 9007199254740992',
				'---',
				'# Malformed durable output snapshot',
				'',
			].join('\n'),
		},
	});
	const repository = new ActivityRecordRepository(fixture.app);
	const projected = await repository.readAgentTaskFile(fixture.file(taskPath));
	assert.equal(projected.durableOutputStatusAtFinish, 'pending_review');
	assert.equal(projected.durableOutputProposalCount, 2);
	assert.equal(projected.durableOutputSourceCaptureCount, 3);
	assert.equal(projected.durableOutputPendingReviewCount, 1);
	assert.equal(projected.durableOutputReadyToApplyCount, 0);
	assert.equal(projected.durableOutputRevisionRequestedCount, 0);
	assert.equal(projected.durableOutputAppliedCount, 1);
	assert.equal(projected.durableOutputRejectedCount, 0);
	assert.equal(projected.durableOutputUnresolvedCount, 1);
	assert.deepEqual(projected.durableOutputProposalIdsAtFinish, [
		'proposal-one',
		'proposal-two',
	]);
	assert.deepEqual(projected.durableOutputAppliedProposalIds, ['proposal-one']);
	assert.deepEqual(projected.durableOutputProposalPaths, [
		'00_tracekeeper/inbox/review_queue/proposal-one.md',
		'00_tracekeeper/inbox/review_queue/proposal-two.md',
	]);
	assert.deepEqual(projected.durableOutputTargetPaths, [
		'01_knowledge/wiki/one.md',
		'01_knowledge/wiki/two.md',
	]);
	assert.deepEqual(projected.proposalIds, ['proposal-one', 'proposal-two']);
	assert.equal(projected.proposalPaths.length, 2);
	assert.deepEqual(projected.sourceCaptures, ['00_tracekeeper/sources/source-one.md']);

	const malformed = await repository.readAgentTaskFile(fixture.file(malformedPath));
	assert.equal(malformed.durableOutputStatusAtFinish, 'unresolved');
	assert.equal(malformed.durableOutputProposalCount, 0);
	assert.equal(malformed.durableOutputSourceCaptureCount, 0);
	assert.equal(malformed.durableOutputPendingReviewCount, 0);
	assert.equal(malformed.durableOutputReadyToApplyCount, 0);
	assert.equal(malformed.durableOutputRevisionRequestedCount, 0);
	assert.equal(malformed.durableOutputAppliedCount, 0);
	assert.equal(malformed.durableOutputRejectedCount, 0);
	assert.equal(malformed.durableOutputUnresolvedCount, 0);
	assert.deepEqual(malformed.durableOutputProposalIdsAtFinish, []);
	assert.deepEqual(malformed.durableOutputAppliedProposalIds, []);
	assert.deepEqual(malformed.durableOutputProposalPaths, []);
	assert.deepEqual(malformed.durableOutputTargetPaths, []);
});

test('managed path-only proposal references backfill once from one proven explicit id', async () => {
	const proposalPath = '00_tracekeeper/inbox/review_queue/backfill.md';
	const taskPath = '00_tracekeeper/work/tasks/backfill-task.md';
	const taskText = [
		'---',
		'type: agent-task',
		'task_id: backfill-task',
		`proposals: [${proposalPath}]`,
		'---',
		'# Backfill task',
		'',
	].join('\n');
	const fixture = createNativeVaultFixture({
		files: {
			[proposalPath]: proposalMarkdown({ proposalId: 'proposal-backfill' }),
			[taskPath]: taskText,
		},
	});
	const repository = new ActivityRecordRepository(fixture.app);
	const updated = await repository.backfillManagedProposalReferences(
		taskPath,
		hashVaultContent(taskText)
	);
	assert.deepEqual(updated, {
		status: 'updated',
		recordPath: taskPath,
		proposalIds: ['proposal-backfill'],
		proposalPaths: [proposalPath],
	});
	const updatedText = fixture.read(taskPath);
	assert.match(updatedText, /^proposal_ids:\s*\["proposal-backfill"\]$/m);
	assert.match(
		updatedText,
		new RegExp(`^proposal_paths:\\s*\\["${proposalPath}"\\]$`, 'm')
	);
	assert.doesNotMatch(updatedText, /^proposals:/m);
	const projectedTask = await repository.readAgentTaskFile(fixture.file(taskPath));
	assert.deepEqual(projectedTask.proposalIds, ['proposal-backfill']);
	assert.deepEqual(projectedTask.proposalPaths, [proposalPath]);
	assert.deepEqual(projectedTask.proposals, [proposalPath]);
	const unchanged = await repository.backfillManagedProposalReferences(
		taskPath,
		hashVaultContent(updatedText)
	);
	assert.deepEqual(unchanged, {
		status: 'unchanged',
		recordPath: taskPath,
		proposalIds: ['proposal-backfill'],
		proposalPaths: [proposalPath],
	});

	const stalePath = '00_tracekeeper/work/sessions/stale.md';
	const staleText = taskText
		.replace('type: agent-task', 'type: session_note')
		.replace('task_id: backfill-task', 'task_id: stale');
	fixture.write(stalePath, staleText);
	assert.equal(
		(await repository.backfillManagedProposalReferences(
			stalePath,
			'stale-content-hash'
		)).status,
		'stale'
	);
	assert.equal(fixture.read(stalePath), staleText);

	fixture.write(
		'02_archive/review_queue/backfill-duplicate.md',
		proposalMarkdown({ proposalId: 'proposal-backfill' })
	);
	const ambiguousPath = '00_tracekeeper/work/tasks/ambiguous.md';
	fixture.write(ambiguousPath, taskText.replace('backfill-task', 'ambiguous'));
	assert.equal(
		(await repository.backfillManagedProposalReferences(
			ambiguousPath,
			hashVaultContent(fixture.read(ambiguousPath))
		)).status,
		'ambiguous'
	);
	assert.match(fixture.read(ambiguousPath), /^proposals:/m);
	assert.equal(
		(await repository.backfillManagedProposalReferences(
			'01_knowledge/wiki/not-managed.md',
			'irrelevant'
		)).status,
		'unmanaged'
	);
});

test('archive preview binds id status hash destination and managed references', async () => {
	const harness = createArchiveHarness();
	const controller = harness.createController();
	assert.equal(typeof controller.previewArchiveMemoryProposals, 'function');
	const proposal = await harness.currentProposal();
	const preview = await controller.previewArchiveMemoryProposals([proposal]);
	assert.equal(preview.schemaVersion, 1);
	assert.equal(typeof preview.operationId, 'string');
	assert.equal(typeof preview.confirmationToken, 'string');
	assert.ok(preview.confirmationToken.length >= 32);
	assert.equal(preview.items[0].proposalId, 'proposal-one');
	assert.equal(preview.items[0].sourcePath, harness.proposalPath);
	assert.equal(
		preview.items[0].sourceHash,
		hashVaultContent(harness.read(harness.proposalPath))
	);
	assert.equal(preview.items[0].sourceStatus, 'applied');
	assert.equal(preview.items[0].destinationPath, harness.destinationPath);
	assert.deepEqual(preview.items[0].managedReferences.sort(), [
		harness.sessionPath,
		harness.taskPath,
	]);
	assert.deepEqual(preview.conflicts, []);
});

test('archive rejects unbounded records and references before native move', async () => {
	const recordLimitHarness = createArchiveHarness();
	const recordLimitController = recordLimitHarness.createController();
	const current = await recordLimitHarness.currentProposal();
	await assert.rejects(
		recordLimitController.previewArchiveMemoryProposals(
			Array.from({ length: 65 }, () => current)
		),
		/64-record limit|record count|bounded/i
	);
	assert.deepEqual(recordLimitHarness.calls.nativeRename, []);

	const extraFiles = Object.fromEntries(
		Array.from({ length: 257 }, (_, index) => {
			const referencePath =
				`00_tracekeeper/work/tasks/reference-${String(index).padStart(3, '0')}.md`;
			return [
				referencePath,
				managedReferenceMarkdown({
					type: 'agent-task',
					link: '[[00_tracekeeper/inbox/review_queue/proposal|proposal]]',
				}),
			];
		})
	);
	const referenceLimitHarness = createArchiveHarness({ extraFiles });
	await assert.rejects(
		referenceLimitHarness.createController().previewArchiveMemoryProposals([
			await referenceLimitHarness.currentProposal(),
		]),
		/256-reference limit|bounded record size/i
	);
	assert.deepEqual(referenceLimitHarness.calls.nativeRename, []);
});

test('archive uses renameFile waits for metadata and regenerates markdown links', async () => {
	const harness = createArchiveHarness();
	const { receipt } = await commitArchive(harness);
	assert.equal(receipt.status, 'completed');
	assert.deepEqual(receipt.moved, [{
		proposalId: 'proposal-one',
		oldPath: harness.proposalPath,
		newPath: harness.destinationPath,
	}]);
	assert.equal(harness.exists(harness.proposalPath), false);
	assert.equal(harness.exists(harness.destinationPath), true);
	assert.deepEqual(harness.calls.directRename, []);
	assert.deepEqual(harness.calls.nativeRename, [[harness.proposalPath, harness.destinationPath]]);
	assert.deepEqual(harness.calls.metadata, [[harness.proposalPath, harness.destinationPath]]);
	const renameIndex = harness.calls.order.indexOf(`rename-file:${harness.proposalPath}`);
	const metadataIndex = harness.calls.order.indexOf(`metadata:${harness.destinationPath}`);
	const referenceIndex = harness.calls.order.findIndex((entry) => entry === `process:${harness.taskPath}`);
	assert.ok(renameIndex >= 0 && metadataIndex > renameIndex && referenceIndex > metadataIndex);
	for (const referencePath of [harness.taskPath, harness.sessionPath]) {
		const content = harness.read(referencePath);
		assert.match(content, /proposal_ids:\s*\[proposal-one\]/);
		assert.match(content, new RegExp(harness.destinationPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		assert.match(
			content,
			new RegExp(
				harness.expectedGeneratedLink(harness.destinationPath, referencePath)
					.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
			)
		);
	}
	assert.match(harness.read('00_tracekeeper/control/audit_log.md'), /proposal_id: proposal-one/);
	assert.match(harness.read('00_tracekeeper/control/audit_log.md'), new RegExp(harness.proposalPath));
	assert.match(
		harness.read('00_tracekeeper/control/operations/writeback-operation.json'),
		/"proposalId":"proposal-one"/
	);
	const active = await harness.records.readRecentMemoryProposals(10);
	assert.deepEqual(active, []);
	const history = await harness.records.readProposalHistoryById('proposal-one');
	assert.equal(history.status, 'resolved');
	assert.equal(history.record.path, harness.destinationPath);
});

test('archive preserves wikilinks when automatic link updating is disabled', async () => {
	for (const alwaysUpdateLinks of [false, true]) {
		const harness = createArchiveHarness({
			useMarkdownLinks: false,
			alwaysUpdateLinks,
		});
		await commitArchive(harness);
		for (const referencePath of [harness.taskPath, harness.sessionPath]) {
			const expected = harness.expectedGeneratedLink(harness.destinationPath, referencePath);
			assert.match(expected, /^\[\[/);
			assert.ok(harness.read(referencePath).includes(expected));
		}
	}
});

test('archive preserves markdown links when automatic link updating is enabled', async () => {
	for (const alwaysUpdateLinks of [false, true]) {
		const harness = createArchiveHarness({
			useMarkdownLinks: true,
			alwaysUpdateLinks,
		});
		await commitArchive(harness);
		for (const referencePath of [harness.taskPath, harness.sessionPath]) {
			const expected = harness.expectedGeneratedLink(harness.destinationPath, referencePath);
			assert.match(expected, /^\[/);
			assert.ok(harness.read(referencePath).includes(expected));
		}
	}
});

test('archive replaces the stored managed link after the user changes link format', async () => {
	for (const useMarkdownLinks of [false, true]) {
		const harness = createArchiveHarness({
			useMarkdownLinks,
			storedUseMarkdownLinks: !useMarkdownLinks,
		});
		const oldLinks = [harness.taskPath, harness.sessionPath].map(
			(referencePath) => renderFixtureLink(
				harness.proposalPath,
				referencePath,
				!useMarkdownLinks
			)
		);
		await commitArchive(harness);
		for (const [index, referencePath] of [harness.taskPath, harness.sessionPath].entries()) {
			const content = harness.read(referencePath);
			assert.equal(content.includes(oldLinks[index]), false);
			assert.ok(
				content.includes(
					harness.expectedGeneratedLink(harness.destinationPath, referencePath)
				)
			);
		}
	}
});

test('archive rejects stale preview duplicate ids and destination conflicts before move', async () => {
	const stale = createArchiveHarness();
	const staleController = stale.createController();
	assert.equal(typeof staleController.previewArchiveMemoryProposals, 'function');
	assert.equal(typeof staleController.commitArchiveMemoryProposals, 'function');
	const stalePreview = await staleController.previewArchiveMemoryProposals([
		await stale.currentProposal(),
	]);
	stale.write(stale.proposalPath, `${stale.read(stale.proposalPath)}\nchanged after preview\n`);
	await assert.rejects(
		staleController.commitArchiveMemoryProposals(
			stalePreview,
			stalePreview.confirmationToken
		),
		/stale|changed|hash/i
	);
	assert.deepEqual(stale.calls.nativeRename, []);
	assert.equal(stale.targetClaims.size, 0);

	const staleReference = createArchiveHarness();
	const staleReferenceController = staleReference.createController();
	const staleReferencePreview =
		await staleReferenceController.previewArchiveMemoryProposals([
			await staleReference.currentProposal(),
		]);
	staleReference.write(
		staleReference.taskPath,
		`${staleReference.read(staleReference.taskPath)}\nchanged after preview\n`
	);
	await assert.rejects(
		staleReferenceController.commitArchiveMemoryProposals(
			staleReferencePreview,
			staleReferencePreview.confirmationToken
		),
		/reference.*(?:stale|changed)|(?:stale|changed).*reference/i
	);
	assert.deepEqual(staleReference.calls.nativeRename, []);
	assert.equal(staleReference.targetClaims.size, 0);

	const duplicate = createArchiveHarness({
		extraFiles: {
			'02_archive/review_queue/duplicate.md': proposalMarkdown({
				proposalId: 'proposal-one',
			}),
		},
	});
	const duplicateController = duplicate.createController();
	await assert.rejects(
		duplicateController.previewArchiveMemoryProposals([
			await duplicate.currentProposal(),
		]),
		/duplicate|ambiguous/i
	);
	assert.deepEqual(duplicate.calls.nativeRename, []);

	const occupied = createArchiveHarness({
		extraFiles: {
			'02_archive/review_queue/proposal.md': proposalMarkdown({
				proposalId: 'occupied-destination',
			}),
		},
	});
	const occupiedController = occupied.createController();
	const occupiedPreview = await occupiedController.previewArchiveMemoryProposals([
		await occupied.currentProposal(),
	]);
	assert.ok(occupiedPreview.conflicts.some((conflict) => conflict.kind === 'destination-exists'));
	await assert.rejects(
		occupiedController.commitArchiveMemoryProposals(
			occupiedPreview,
			occupiedPreview.confirmationToken
		),
		/destination|conflict|exists/i
	);
	assert.deepEqual(occupied.calls.nativeRename, []);
	assert.equal(occupied.targetClaims.size, 0);

	const legacyReference = createArchiveHarness();
	legacyReference.write(
		legacyReference.taskPath,
		legacyReference.read(legacyReference.taskPath)
			.replace('proposal_ids: [proposal-one]\n', '')
			.replace('proposal_paths:', 'proposals:')
	);
	const legacyPreview =
		await legacyReference.createController().previewArchiveMemoryProposals([
			await legacyReference.currentProposal(),
		]);
	assert.ok(
		legacyPreview.conflicts.some(
			(conflict) => conflict.kind === 'managed-reference-legacy-path'
		)
	);

	const bothPath = createArchiveHarness();
	const bothPathController = bothPath.createController();
	const bothPathPreview = await bothPathController.previewArchiveMemoryProposals([
		await bothPath.currentProposal(),
	]);
	await bothPath.app.fileManager.renameFile(
		bothPath.file(bothPath.proposalPath),
		bothPath.destinationPath
	);
	bothPath.write(`${bothPath.proposalPath}/child.md`, '# Conflicting old-path folder\n');
	await assert.rejects(
		bothPathController.commitArchiveMemoryProposals(
			bothPathPreview,
			bothPathPreview.confirmationToken
		),
		/source.*destination|both.*path|conflict/i
	);

	const neitherPath = createArchiveHarness();
	const neitherPathController = neitherPath.createController();
	const neitherPathPreview = await neitherPathController.previewArchiveMemoryProposals([
		await neitherPath.currentProposal(),
	]);
	await neitherPath.app.vault.delete(neitherPath.file(neitherPath.proposalPath));
	await assert.rejects(
		neitherPathController.commitArchiveMemoryProposals(
			neitherPathPreview,
			neitherPathPreview.confirmationToken
		),
		/source.*destination|neither.*path|conflict/i
	);
});

test('archive restart and exact retry return one bounded receipt', async () => {
	const harness = createArchiveHarness();
	const firstController = harness.createController();
	assert.equal(typeof firstController.previewArchiveMemoryProposals, 'function');
	assert.equal(typeof firstController.commitArchiveMemoryProposals, 'function');
	const preview = await firstController.previewArchiveMemoryProposals([
		await harness.currentProposal(),
	]);
	const first = await firstController.commitArchiveMemoryProposals(
		preview,
		preview.confirmationToken
	);
	const restartedController = harness.createController();
	const retried = await restartedController.commitArchiveMemoryProposals(
		preview,
		preview.confirmationToken
	);
	assert.deepEqual(retried, first);
	assert.equal(harness.calls.nativeRename.length, 1);
	assert.equal(harness.receipts.size, 1);
	assert.equal(first.revision, 2);
	assert.match(first.bindingHash, /^[a-f0-9]{64}$/);
	assert.equal(typeof first.startedAt, 'string');
	assert.notEqual(first.previewHash, preview.confirmationToken);
	const serialized = JSON.stringify(first);
	assert.equal(serialized.includes('Stable lifecycle writeback.'), false);
	assert.equal(serialized.includes(preview.confirmationToken), false);
	assert.equal(
		JSON.stringify([...harness.targetClaims.values()])
			.includes(preview.confirmationToken),
		false
	);
	assert.equal(serialized.length < 4096, true);
	harness.receipts.set(preview.operationId, withBindingHash({
		...structuredClone(first),
		moved: [{
			...first.moved[0],
			newPath: '02_archive/review_queue/tampered.md',
		}],
	}));
	await assert.rejects(
		restartedController.commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
		/receipt.*conflict|conflict.*receipt|invalid/i
	);
	harness.receipts.set(preview.operationId, withBindingHash({
		...structuredClone(first),
		revision: 3,
	}));
	await assert.rejects(
		restartedController.commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
		/receipt.*invalid|invalid.*receipt/i
	);
});

test('archive serializes the same operation across controller instances', async () => {
	const harness = createArchiveHarness();
	const firstController = harness.createController();
	const secondController = harness.createController();
	const preview = await firstController.previewArchiveMemoryProposals([
		await harness.currentProposal(),
	]);
	const [first, concurrentRetry] = await Promise.all([
		firstController.commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
		secondController.commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
	]);
	assert.deepEqual(concurrentRetry, first);
	assert.equal(harness.calls.nativeRename.length, 1);
	assert.equal(harness.receipts.size, 1);
});

test('archive does not adopt another operation move as its own restart', async () => {
	let signalFirstMetadataWait;
	let releaseFirstMetadataWait;
	let shouldBlockMetadata = true;
	const firstMetadataWait = new Promise((resolve) => {
		signalFirstMetadataWait = resolve;
	});
	const metadataGate = new Promise((resolve) => {
		releaseFirstMetadataWait = resolve;
	});
	const harness = createArchiveHarness({
		async beforeMetadataWait() {
			if (!shouldBlockMetadata) {
				return;
			}
			shouldBlockMetadata = false;
			signalFirstMetadataWait();
			await metadataGate;
		},
	});
	const firstController = harness.createController();
	const secondController = harness.createController();
	const proposal = await harness.currentProposal();
	const firstPreview = await firstController.previewArchiveMemoryProposals([
		proposal,
	]);
	const competingPreview = await secondController.previewArchiveMemoryProposals([
		proposal,
	]);
	assert.notEqual(firstPreview.operationId, competingPreview.operationId);
	const firstCommit = firstController.commitArchiveMemoryProposals(
		firstPreview,
		firstPreview.confirmationToken
	);
	await firstMetadataWait;
	const competingCommit = secondController.commitArchiveMemoryProposals(
		competingPreview,
		competingPreview.confirmationToken
	);
	await new Promise((resolve) => setImmediate(resolve));
	releaseFirstMetadataWait();
	const outcomes = await Promise.allSettled([firstCommit, competingCommit]);
	assert.equal(
		outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
		1
	);
	assert.equal(
		outcomes.filter((outcome) => outcome.status === 'rejected').length,
		1
	);
	assert.equal(harness.calls.nativeRename.length, 1);
	assert.equal(harness.receipts.size, 1);
});

test('archive keeps a persisted pre-move intent owned across operation ids', async () => {
	let interruptAfterIntent = true;
	const harness = createArchiveHarness({
		async afterArchiveReceiptWrite(receipt) {
			if (interruptAfterIntent && receipt.status === 'in-progress') {
				interruptAfterIntent = false;
				throw new Error('injected interruption after archive intent');
			}
		},
	});
	const firstController = harness.createController();
	const firstPreview = await firstController.previewArchiveMemoryProposals([
		await harness.currentProposal(),
	]);
	await assert.rejects(
		firstController.commitArchiveMemoryProposals(
			firstPreview,
			firstPreview.confirmationToken
		),
		/interruption/
	);
	assert.equal(harness.exists(harness.proposalPath), true);
	assert.equal(harness.exists(harness.destinationPath), false);
	assert.equal(harness.receipts.get(firstPreview.operationId)?.status, 'in-progress');

	const competingController = harness.createController();
	const competingPreview = await competingController.previewArchiveMemoryProposals([
		await harness.currentProposal(),
	]);
	await assert.rejects(
		competingController.commitArchiveMemoryProposals(
			competingPreview,
			competingPreview.confirmationToken
		),
		/owned|intent|operation|conflict/i
	);
	const recovered = await harness.createController().commitArchiveMemoryProposals(
		firstPreview,
		firstPreview.confirmationToken
	);
	assert.equal(recovered.status, 'completed');
	assert.equal(harness.calls.nativeRename.length, 1);
	assert.equal(harness.receipts.size, 1);
});

test('archive rejects a rebound target-claim mutation before recovery', async () => {
	let interruptAfterIntent = true;
	const harness = createArchiveHarness({
		async afterArchiveReceiptWrite(receipt) {
			if (interruptAfterIntent && receipt.status === 'in-progress') {
				interruptAfterIntent = false;
				throw new Error('injected interruption after archive intent');
			}
		},
	});
	const controller = harness.createController();
	const preview = await controller.previewArchiveMemoryProposals([
		await harness.currentProposal(),
	]);
	await assert.rejects(
		controller.commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
		/interruption/
	);
	const [targetHash, claim] = [...harness.targetClaims.entries()][0];
	harness.targetClaims.set(targetHash, withBindingHash({
		...structuredClone(claim),
		sourceHash: 'f'.repeat(64),
	}));
	await assert.rejects(
		harness.createController().commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
		/claim|owned|conflict|operation/i
	);
	assert.equal(harness.calls.nativeRename.length, 0);
	assert.equal(harness.exists(harness.proposalPath), true);
});

test('archive resumes an expired exact preview from a target claim persisted before the operation receipt', async () => {
	let interruptAfterClaim = true;
	let now = new Date('2026-07-30T00:00:00.000Z');
	const harness = createArchiveHarness({
		nowFactory: () => new Date(now),
		async afterArchiveTargetClaimWrite(claim) {
			if (interruptAfterClaim && claim.status === 'in-progress') {
				interruptAfterClaim = false;
				throw new Error('injected interruption after target claim');
			}
		},
	});
	const controller = harness.createController();
	const preview = await controller.previewArchiveMemoryProposals([
		await harness.currentProposal(),
	]);
	await assert.rejects(
		controller.commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
		/target claim/
	);
	assert.equal(harness.receipts.size, 0);
	assert.equal(harness.targetClaims.size, 1);
	assert.equal([...harness.targetClaims.values()][0].status, 'in-progress');
	assert.equal(harness.calls.nativeRename.length, 0);
	now = new Date(Date.parse(preview.expiresAt) + 1);
	assert.equal(now.getTime() > Date.parse(preview.expiresAt), true);

	const competingPreview =
		await harness.createController().previewArchiveMemoryProposals([
			await harness.currentProposal(),
		]);
	await assert.rejects(
		harness.createController().commitArchiveMemoryProposals(
			competingPreview,
			competingPreview.confirmationToken
		),
		/owned|claim|operation/i
	);
	const receipt = await harness.createController().commitArchiveMemoryProposals(
		preview,
		preview.confirmationToken
	);
	assert.equal(receipt.status, 'completed');
	assert.equal(harness.calls.nativeRename.length, 1);
	assert.equal(harness.receipts.size, 1);
	assert.equal([...harness.targetClaims.values()][0].status, 'completed');
});

test('archive resumes an expired multi-target preview after only the first claim persisted', async () => {
	let interruptAfterFirstClaim = true;
	let now = new Date('2026-07-30T00:00:00.000Z');
	const secondProposalPath = '00_tracekeeper/inbox/review_queue/second.md';
	const harness = createArchiveHarness({
		nowFactory: () => new Date(now),
		extraFiles: {
			[secondProposalPath]: proposalMarkdown({
				proposalId: 'proposal-two',
				taskId: 'task-two',
				sessionPath: '00_tracekeeper/work/sessions/session-two.md',
			}),
		},
		async afterArchiveTargetClaimWrite(claim) {
			if (interruptAfterFirstClaim && claim.status === 'in-progress') {
				interruptAfterFirstClaim = false;
				throw new Error('injected interruption after first target claim');
			}
		},
	});
	const proposals = await harness.records.readRecentMemoryProposals(10);
	assert.equal(proposals.length, 2);
	const controller = harness.createController();
	const preview = await controller.previewArchiveMemoryProposals(proposals);
	await assert.rejects(
		controller.commitArchiveMemoryProposals(preview, preview.confirmationToken),
		/first target claim/
	);
	assert.equal(harness.targetClaims.size, 1);
	assert.equal(harness.calls.nativeRename.length, 0);
	now = new Date(Date.parse(preview.expiresAt) + 1);

	const receipt = await harness.createController().commitArchiveMemoryProposals(
		preview,
		preview.confirmationToken
	);
	assert.equal(receipt.status, 'completed');
	assert.equal(receipt.targets.length, 2);
	assert.equal(harness.calls.nativeRename.length, 2);
	assert.equal(harness.targetClaims.size, 2);
	assert.equal(
		[...harness.targetClaims.values()].every((claim) => claim.status === 'completed'),
		true
	);
});

test('archive rejects expired multi-target recovery when a missing claim becomes competitively owned', async () => {
	let interruptAfterFirstClaim = true;
	let now = new Date('2026-07-30T00:00:00.000Z');
	const harness = createArchiveHarness({
		nowFactory: () => new Date(now),
		extraFiles: {
			'00_tracekeeper/inbox/review_queue/second.md': proposalMarkdown({
				proposalId: 'proposal-two',
				taskId: 'task-two',
				sessionPath: '00_tracekeeper/work/sessions/session-two.md',
			}),
		},
		async afterArchiveTargetClaimWrite(claim) {
			if (interruptAfterFirstClaim && claim.status === 'in-progress') {
				interruptAfterFirstClaim = false;
				throw new Error('injected interruption after first target claim');
			}
		},
	});
	const proposals = await harness.records.readRecentMemoryProposals(10);
	const controller = harness.createController();
	const preview = await controller.previewArchiveMemoryProposals(proposals);
	await assert.rejects(
		controller.commitArchiveMemoryProposals(preview, preview.confirmationToken),
		/first target claim/
	);
	const persistedClaim = [...harness.targetClaims.values()][0];
	const missingItem = preview.items.find((item) => {
		const targetHash = computePayloadHash({
			schemaVersion: 1,
			proposalId: item.proposalId,
			oldPath: item.sourcePath,
			newPath: item.destinationPath,
		});
		return targetHash !== persistedClaim.targetHash;
	});
	assert.ok(missingItem);
	const competingTargetHash = computePayloadHash({
		schemaVersion: 1,
		proposalId: missingItem.proposalId,
		oldPath: missingItem.sourcePath,
		newPath: missingItem.destinationPath,
	});
	const competingClaim = withBindingHash({
		schemaVersion: 1,
		revision: 1,
		bindingHash: '',
		targetHash: competingTargetHash,
		operationId: 'archive-competing-operation',
		previewHash: 'b'.repeat(64),
		status: 'in-progress',
		proposalId: missingItem.proposalId,
		oldPath: missingItem.sourcePath,
		newPath: missingItem.destinationPath,
		sourceHash: missingItem.sourceHash,
		startedAt: persistedClaim.startedAt,
		completedAt: null,
	});
	harness.targetClaims.set(competingTargetHash, competingClaim);
	now = new Date(Date.parse(preview.expiresAt) + 1);

	await assert.rejects(
		harness.createController().commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
		/owned|claim|operation/i
	);
	assert.equal(harness.calls.nativeRename.length, 0);
	assert.equal(harness.exists(harness.proposalPath), true);
});

test('archive restart rolls forward after a managed-reference relink failure', async () => {
	let failRelinkOnce = true;
	const harness = createArchiveHarness({
		alwaysUpdateLinks: false,
		processFailure({ path: currentPath }) {
			if (failRelinkOnce && currentPath === harness.taskPath) {
				failRelinkOnce = false;
				return new Error('injected managed-reference relink failure');
			}
			return null;
		},
	});
	const controller = harness.createController();
	const preview = await controller.previewArchiveMemoryProposals([
		await harness.currentProposal(),
	]);
	await assert.rejects(
		controller.commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
		/relink failure/
	);
	assert.equal(harness.calls.nativeRename.length, 1);
	assert.equal(harness.receipts.get(preview.operationId)?.status, 'in-progress');
	const receipt = await harness.createController().commitArchiveMemoryProposals(
		preview,
		preview.confirmationToken
	);
	assert.equal(receipt.status, 'completed');
	assert.equal(harness.calls.nativeRename.length, 1);
	assert.equal(harness.archiveAudits.size, 1);
	for (const referencePath of [harness.taskPath, harness.sessionPath]) {
		assert.ok(harness.read(referencePath).includes(harness.destinationPath));
	}
});

test('archive restart suppresses duplicate audit after post-append interruption', async () => {
	let interruptAfterAudit = true;
	let now = '2026-07-30T23:59:59.000Z';
	const harness = createArchiveHarness({
		nowFactory: () => new Date(now),
		async afterArchiveAuditAppend() {
			if (interruptAfterAudit) {
				interruptAfterAudit = false;
				now = '2026-07-31T00:10:00.000Z';
				throw new Error('injected interruption after archive audit');
			}
		},
	});
	const controller = harness.createController();
	const preview = await controller.previewArchiveMemoryProposals([
		await harness.currentProposal(),
	]);
	await assert.rejects(
		controller.commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
		/archive audit/
	);
	assert.equal(harness.archiveAudits.size, 1);
	assert.equal(harness.calls.refresh, 0);
	const receipt = await harness.createController().commitArchiveMemoryProposals(
		preview,
		preview.confirmationToken
	);
	assert.equal(receipt.status, 'completed');
	assert.equal(harness.archiveAudits.size, 1);
	assert.equal(harness.archiveAuditAttempts.length, 2);
	assert.equal(
		harness.archiveAuditAttempts[1],
		harness.archiveAuditAttempts[0]
	);
	assert.match(
		harness.archiveAuditAttempts[0],
		/^## 2026-07-30T23:59:59\.000Z$/m
	);
	assert.equal(receipt.completedAt, '2026-07-31T00:10:00.000Z');
	const auditHarness = createNativeVaultFixture();
	const auditRepository = new ObsidianAuditShardRepository(auditHarness.app, {
		async ensureFolderExists() {},
	});
	for (const entry of harness.archiveAuditAttempts) {
		await auditRepository.appendRawEvents(entry, {
			operationId: preview.operationId,
		});
	}
	const stableShard =
			auditHarness.read('00_tracekeeper/control/agent_activity/2026/2026-07-30.md');
	assert.equal((stableShard.match(/^action: memory\.proposal\.archive$/gm) || []).length, 1);
	assert.equal(
		auditHarness.exists('00_tracekeeper/control/agent_activity/2026/2026-07-31.md'),
		false
	);
	assert.equal(harness.calls.refresh, 1);
	assert.equal(harness.calls.nativeRename.length, 1);
});

test('archive restart completes after projection refresh interruption', async () => {
	let interruptAfterRefresh = true;
	const harness = createArchiveHarness({
		async afterRefreshGovernanceViews() {
			if (interruptAfterRefresh) {
				interruptAfterRefresh = false;
				throw new Error('injected interruption after projection refresh');
			}
		},
	});
	const controller = harness.createController();
	const preview = await controller.previewArchiveMemoryProposals([
		await harness.currentProposal(),
	]);
	await assert.rejects(
		controller.commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
		/projection refresh/
	);
	assert.equal(harness.archiveAudits.size, 1);
	assert.equal(harness.calls.refresh, 1);
	const receipt = await harness.createController().commitArchiveMemoryProposals(
		preview,
		preview.confirmationToken
	);
	assert.equal(receipt.status, 'completed');
	assert.equal(harness.archiveAudits.size, 1);
	assert.equal(harness.calls.refresh, 2);
	assert.equal(harness.calls.nativeRename.length, 1);
});

test('archive restart completes target ownership after receipt persistence', async () => {
	let interruptAfterCompletedReceipt = true;
	const harness = createArchiveHarness({
		async afterArchiveReceiptWrite(receipt) {
			if (interruptAfterCompletedReceipt && receipt.status === 'completed') {
				interruptAfterCompletedReceipt = false;
				throw new Error('injected interruption after completed receipt');
			}
		},
	});
	const controller = harness.createController();
	const preview = await controller.previewArchiveMemoryProposals([
		await harness.currentProposal(),
	]);
	await assert.rejects(
		controller.commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
		/completed receipt/
	);
	assert.equal(harness.receipts.get(preview.operationId)?.status, 'completed');
	assert.equal([...harness.targetClaims.values()][0].status, 'in-progress');
	const receipt = await harness.createController().commitArchiveMemoryProposals(
		preview,
		preview.confirmationToken
	);
	assert.equal(receipt.status, 'completed');
	assert.equal([...harness.targetClaims.values()][0].status, 'completed');
	assert.equal(harness.archiveAudits.size, 1);
	assert.equal(harness.calls.refresh, 1);
	assert.equal(harness.calls.nativeRename.length, 1);
});

test('archive exact retry accepts a completed target-claim update', async () => {
	let interruptAfterCompletedClaim = true;
	const harness = createArchiveHarness({
		async afterArchiveTargetClaimWrite(claim) {
			if (interruptAfterCompletedClaim && claim.status === 'completed') {
				interruptAfterCompletedClaim = false;
				throw new Error('injected interruption after completed target claim');
			}
		},
	});
	const controller = harness.createController();
	const preview = await controller.previewArchiveMemoryProposals([
		await harness.currentProposal(),
	]);
	await assert.rejects(
		controller.commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
		/completed target claim/
	);
	assert.equal(harness.receipts.get(preview.operationId)?.status, 'completed');
	assert.equal([...harness.targetClaims.values()][0].status, 'completed');
	const receipt = await harness.createController().commitArchiveMemoryProposals(
		preview,
		preview.confirmationToken
	);
	assert.equal(receipt.status, 'completed');
	assert.equal(harness.archiveAudits.size, 1);
	assert.equal(harness.calls.refresh, 1);
	assert.equal(harness.calls.nativeRename.length, 1);
});

test('archive restart resumes a native move completed before receipt persistence', async () => {
	let failMetadataOnce = true;
	const harness = createArchiveHarness({
		async beforeMetadataWait() {
			if (failMetadataOnce) {
				failMetadataOnce = false;
				throw new Error('injected interruption after native move');
			}
		},
	});
	const firstController = harness.createController();
	const preview = await firstController.previewArchiveMemoryProposals([
		await harness.currentProposal(),
	]);
	await assert.rejects(
		firstController.commitArchiveMemoryProposals(
			preview,
			preview.confirmationToken
		),
		/interruption/
	);
	assert.equal(harness.exists(harness.proposalPath), false);
	assert.equal(harness.exists(harness.destinationPath), true);
	assert.equal(harness.receipts.get(preview.operationId)?.status, 'in-progress');
	const restartedController = harness.createController();
	const receipt = await restartedController.commitArchiveMemoryProposals(
		preview,
		preview.confirmationToken
	);
	assert.equal(receipt.status, 'completed');
	assert.equal(receipt.revision, 2);
	assert.equal(harness.calls.nativeRename.length, 1);
	assert.deepEqual(harness.calls.metadata, [
		[harness.proposalPath, harness.destinationPath],
		[harness.proposalPath, harness.destinationPath],
	]);
	assert.equal(harness.receipts.size, 1);
	for (const referencePath of [harness.taskPath, harness.sessionPath]) {
		assert.ok(harness.read(referencePath).includes(harness.destinationPath));
	}
});

test('activity ignores legacy audit history and reads canonical Agent activity shards', async () => {
	const legacyPath = '00_tracekeeper/control/audit_log.md';
	const shardPath = '00_tracekeeper/control/agent_activity/2026/2026-07-30.md';
	const sharedId = 'audit-shared';
	const sharedTimestamp = '2026-07-30T10:00:00.000Z';
	const harness = createActivityHarness({
		files: {
			[legacyPath]: [
				'# Audit Log',
				'',
				auditEventSection({
					id: sharedId,
					timestamp: sharedTimestamp,
					action: 'legacy.shared',
				}),
				auditEventSection({
					id: 'audit-legacy-only',
					timestamp: '2026-07-30T09:00:00.000Z',
					action: 'legacy.only',
				}),
			].join('\n'),
			[shardPath]: [
				'---',
					'type: tracekeeper_agent_activity_shard',
					'agent_activity_schema_version: 1',
					'activity_date_utc: 2026-07-30',
				'---',
					'# Agent activity 2026-07-30',
				'',
				'[Audit hub](../index.md)',
				'',
				auditEventSection({
					id: sharedId,
					timestamp: sharedTimestamp,
					action: 'shard.shared',
				}),
				auditEventSection({
					id: 'audit-shard-only',
					timestamp: '2026-07-30T11:00:00.000Z',
					action: 'shard.only',
				}),
			].join('\n'),
		},
	});

		const events = await harness.createController().readRecentAuditEvents(20);
		assert.equal(events.length, 2);
		assert.ok(events.every((event) => event.path === shardPath));
		assert.equal(events[0].auditId, 'audit-shard-only');
		const shared = events.filter((event) => event.auditId === sharedId);
		assert.equal(shared.length, 1);
		assert.equal(shared[0].action, 'shard.shared');
		assert.equal(events.some((event) => event.auditId === 'audit-legacy-only'), false);
});

test('runtime log reads one bounded recent window before paging', async () => {
	const shardPath = '00_tracekeeper/control/agent_activity/2026/2026-07-30.md';
	const sections = Array.from({ length: RUNTIME_LOG_MAX_EVENTS + 2 }, (_, index) =>
		auditEventSection({
			id: `bounded-${index}`,
			timestamp: new Date(Date.UTC(2026, 6, 30, 0, 0, index)).toISOString(),
			action: `bounded.event.${index}`,
		})
	);
	const harness = createActivityHarness({
		files: {
			[shardPath]: [
				'---',
					'type: tracekeeper_agent_activity_shard',
					'agent_activity_schema_version: 1',
					'activity_date_utc: 2026-07-30',
				'---',
					'# Agent activity 2026-07-30',
				'',
				...sections,
			].join('\n'),
		},
	});

	const snapshot = await harness.createController().loadRuntimeLogSnapshot(1, 'all', 20);
	assert.equal(snapshot.isTruncated, true);
	assert.equal(snapshot.totalItems, RUNTIME_LOG_MAX_EVENTS);
	assert.equal(snapshot.items.length, 20);
	assert.equal(snapshot.items[0].title.includes(`bounded.event.${RUNTIME_LOG_MAX_EVENTS + 1}`), true);
});

test('activity repository selects bounded records by logical metadata time before reading bodies', async () => {
	const logicalOldPath = `${TRACEKEEPER_TASKS_DIR}/mtime-newest.md`;
	const logicalMiddlePath = `${TRACEKEEPER_TASKS_DIR}/logical-middle.md`;
	const logicalNewestPath = `${TRACEKEEPER_TASKS_DIR}/logical-newest.md`;
	const validRequestPath = `${TRACEKEEPER_AGENT_REQUESTS_DIR}/valid.md`;
	const fixture = createNativeVaultFixture({
		files: {
			[logicalOldPath]: {
				mtime: 300,
				content: '---\ntype: agent-task\ntask_id: old\nstarted_at: 2024-01-01T00:00:00.000Z\n---\nOld\n',
			},
			[logicalMiddlePath]: {
				mtime: 200,
				content: '---\ntype: agent-task\ntask_id: middle\nstarted_at: 2025-01-01T00:00:00.000Z\n---\nMiddle\n',
			},
			[logicalNewestPath]: {
				mtime: 100,
				content: '---\ntype: agent-task\ntask_id: newest\nstarted_at: 2999-01-01T00:00:00.000Z\n---\nNewest\n',
			},
			[`${TRACEKEEPER_AGENT_REQUESTS_DIR}/invalid.md`]: {
				mtime: 300,
				content: '---\ntype: unrelated\ncreated: 2999-01-02T00:00:00.000Z\n---\nInvalid\n',
			},
			[validRequestPath]: {
				mtime: 100,
				content: '---\ntype: agent-request\nsource: bounded-source\ncreated: 2999-01-01T00:00:00.000Z\n---\nValid\n',
			},
		},
	});
	const repository = new ActivityRecordRepository(fixture.app);
	const window = await repository.readActivityTimelineRecords(2);
	assert.deepEqual(
		window.tasks.map((task) => task.path),
		[logicalNewestPath, logicalMiddlePath]
	);
	assert.deepEqual(
		window.sourceRequests.map((request) => request.path),
		[validRequestPath]
	);
	assert.equal(window.isTruncated, true);
	assert.equal(fixture.calls.cachedRead.includes(logicalOldPath), false);
});

test('activity repository exposes an incomplete bounded window when metadata cache is unavailable or stale', async () => {
	const noCacheFixture = createNativeVaultFixture({
		files: Object.fromEntries(
			[1, 2, 3].map((index) => [
				`${TRACEKEEPER_TASKS_DIR}/task-${index}.md`,
				{
					mtime: index,
					content: `---\ntype: agent-task\ntask_id: task-${index}\nstarted_at: 2999-01-0${4 - index}T00:00:00.000Z\n---\nTask\n`,
				},
			])
		),
	});
	noCacheFixture.app.metadataCache.getFileCache = () => null;
	const noCacheWindow = await new ActivityRecordRepository(
		noCacheFixture.app
	).readActivityTimelineRecords(2);
	assert.equal(noCacheWindow.tasks.length, 2);
	assert.equal(noCacheWindow.isTruncated, true);
	assert.equal(noCacheFixture.calls.cachedRead.length, 2);

	const staleCacheFixture = createNativeVaultFixture({
		files: {
			[`${TRACEKEEPER_AGENT_REQUESTS_DIR}/actual-request.md`]:
				'---\ntype: agent-request\nsource: actual-source\ncreated: 2999-01-01T00:00:00.000Z\n---\nRequest\n',
		},
	});
	staleCacheFixture.app.metadataCache.getFileCache = () => ({
		frontmatter: { type: 'unrelated' },
	});
	const staleCacheRepository = new ActivityRecordRepository(staleCacheFixture.app);
	const sharedRequests = await staleCacheRepository.readRecentSourceRequests(2);
	assert.deepEqual(
		sharedRequests.map((request) => request.source),
		['actual-source']
	);
	const staleCacheWindow = await staleCacheRepository.readActivityTimelineRecords(2);
	assert.deepEqual(staleCacheWindow.sourceRequests, []);
	assert.equal(staleCacheWindow.isTruncated, true);
});

test('activity timeline reads and merges one bounded recent window before paging', async () => {
	const harness = createActivityHarness();
	const readLimits = {};
	const emptyReader = (name) => async (limit) => {
		readLimits[name] = limit;
		return [];
	};
	harness.host.readActivityTimelineRecords = async (limit) => {
		readLimits.records = limit;
		return {
			tasks: Array.from({ length: limit }, (_, index) => ({
				path: `00_tracekeeper/work/tasks/task-${index}.md`,
				taskId: `task-${index}`,
				agent: 'test-agent',
				status: 'completed',
				objective: `objective-${index}`,
				snippet: '',
				sortTimestamp: index,
			})),
			contextPacks: [],
			sourceCaptures: [],
			sourceRequests: [],
			proposals: [],
			isTruncated: true,
		};
	};
	const controller = harness.createController();
	controller.readRecentAuditEvents = emptyReader('auditEvents');

	const snapshot = await controller.loadActivityTimelineSnapshot(1, 20);
	assert.deepEqual(
		readLimits,
		{
			records: ACTIVITY_TIMELINE_MAX_ITEMS + 1,
			auditEvents: ACTIVITY_TIMELINE_MAX_ITEMS + 1,
		}
	);
	assert.equal(snapshot.isTruncated, true);
	assert.equal(snapshot.totalItems, ACTIVITY_TIMELINE_MAX_ITEMS);
	assert.equal(snapshot.items.length, 20);
	assert.equal(snapshot.items[0].title, `task-${ACTIVITY_TIMELINE_MAX_ITEMS}`);
});

test('native audit repository serializes bounded shards and suppresses exact retries', async () => {
	const legacyPath = '00_tracekeeper/control/audit_log.md';
	const legacyContent = auditMarkdown('2026-07-29T23:00:00.000Z');
	const harness = createNativeVaultFixture({
		files: {
			[legacyPath]: legacyContent,
		},
	});
	let generated = 0;
	const createRepository = () => new ObsidianAuditShardRepository(harness.app, {
		async ensureFolderExists() {},
		createOperationId() {
			generated += 1;
			return `generated-${generated}`;
		},
	});
	const repository = createRepository();
	const sameDayTimestamp = '2026-07-30T10:00:00.000Z';
	await Promise.all([
		...Array.from({ length: 6 }, (_, index) =>
			repository.appendRawEvents(
				auditEventSection({
					id: '',
					timestamp: sameDayTimestamp,
					action: `fixture.concurrent.${index}`,
				}),
				{ operationId: `concurrent-${index}` }
			)
		),
		repository.appendRawEvents(
			auditEventSection({
				id: '',
				timestamp: '2026-07-31T00:00:00.000Z',
				action: 'fixture.next-day',
			}),
			{ operationId: 'next-day' }
		),
	]);
	const retryEvent = [
		`## ${sameDayTimestamp}`,
		'type: mcp.tool_call',
		'event: mcp.tool_call',
		'action: fixture.retry',
		'target: /Users/example/private-config.json',
		'reason: credential=/Users/example/secret',
		'warning: api_key=never-store-api-key',
		'result_summary: authorization=Basic-never-store-authorization',
		'args_summary: refresh_token=never-store-refresh-token cookie=never-store-cookie',
		'access_token: never-store-this-token',
		`args: ${'unbounded-body-'.repeat(500)}`,
		'workflow_id: Bearer super-secret-token',
		'body: never-store-this-body',
		`timestamp: ${sameDayTimestamp}`,
		'',
	].join('\n');
	await Promise.all([
		repository.appendRawEvents(retryEvent, { operationId: 'exact-retry' }),
		repository.appendRawEvents(retryEvent, { operationId: 'exact-retry' }),
	]);
	await createRepository().appendRawEvents(
		retryEvent,
		{ operationId: 'exact-retry' }
	);
	const firstShardPath = '00_tracekeeper/control/agent_activity/2026/2026-07-30.md';
	const secondShardPath = '00_tracekeeper/control/agent_activity/2026/2026-07-31.md';
	const firstShard = harness.read(firstShardPath);
	const secondShard = harness.read(secondShardPath);
	assert.equal(harness.read(legacyPath), legacyContent);
	assert.equal((firstShard.match(/^## /gm) || []).length, 7);
	assert.equal((firstShard.match(/^action: fixture\.retry$/gm) || []).length, 1);
	assert.equal((secondShard.match(/^## /gm) || []).length, 1);
	assert.match(firstShard, /^type: tracekeeper_agent_activity_shard$/m);
	assert.match(firstShard, /^activity_date_utc: 2026-07-30$/m);
	assert.match(firstShard, /^activity_event_id: audit-[a-f0-9]{32}$/m);
	assert.match(firstShard, /^event: mcp\.tool_call$/m);
	assert.match(firstShard, /^timestamp: 2026-07-30T10:00:00\.000Z$/m);
	assert.equal(firstShard.includes('/Users/example'), false);
	assert.equal(firstShard.includes('never-store-this-token'), false);
	assert.equal(firstShard.includes('never-store-this-body'), false);
	assert.equal(firstShard.includes('unbounded-body-'), false);
	assert.equal(firstShard.includes('super-secret-token'), false);
	assert.equal(firstShard.includes('never-store-api-key'), false);
	assert.equal(firstShard.includes('never-store-authorization'), false);
	assert.equal(firstShard.includes('never-store-refresh-token'), false);
	assert.equal(firstShard.includes('never-store-cookie'), false);
	assert.ok(firstShard.length < 16_000);
	const hubPath = '00_tracekeeper/control/agent_activity/index.md';
	assert.equal(harness.exists(hubPath), true);
	assert.ok(firstShard.includes(harness.expectedGeneratedLink(hubPath, firstShardPath)));
	assert.ok(secondShard.includes(harness.expectedGeneratedLink(hubPath, secondShardPath)));
	assert.ok(harness.calls.process.includes(firstShardPath));
	assert.ok(harness.calls.process.includes(secondShardPath));
	const activityEvents = await new ActivityDataController(
		harness.app,
		createActivityHost(harness)
	).readRecentAuditEvents(20);
	assert.equal(activityEvents.length, 8);
	assert.equal(activityEvents.some((event) => event.path === hubPath), false);
});

test('native audit repository serializes hub creation across repository instances', async () => {
	const hubPath = '00_tracekeeper/control/agent_activity/index.md';
	let signalFirstHubCreate;
	let releaseFirstHubCreate;
	let hubCreateAttempts = 0;
	const firstHubCreateEntered = new Promise((resolve) => {
		signalFirstHubCreate = resolve;
	});
	const firstHubCreateGate = new Promise((resolve) => {
		releaseFirstHubCreate = resolve;
	});
	const harness = createNativeVaultFixture({
		async beforeCreate({ path: createdPath }) {
			if (createdPath !== hubPath) {
				return;
			}
			hubCreateAttempts += 1;
			if (hubCreateAttempts === 1) {
				signalFirstHubCreate();
				await firstHubCreateGate;
			}
		},
	});
	const createRepository = () => new ObsidianAuditShardRepository(harness.app, {
		async ensureFolderExists() {},
	});
	const firstAppend = createRepository().appendRawEvents(
		auditEventSection({
			id: '',
			timestamp: '2026-07-30T10:00:00.000Z',
			action: 'fixture.concurrent-hub.first',
		}),
		{ operationId: 'concurrent-hub-first' }
	);
	await firstHubCreateEntered;
	const secondAppend = createRepository().appendRawEvents(
		auditEventSection({
			id: '',
			timestamp: '2026-07-31T10:00:00.000Z',
			action: 'fixture.concurrent-hub.second',
		}),
		{ operationId: 'concurrent-hub-second' }
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(hubCreateAttempts, 1);
	releaseFirstHubCreate();
	const [firstResult, secondResult] = await Promise.all([
		firstAppend,
		secondAppend,
	]);
	assert.equal(hubCreateAttempts, 1);
	assert.deepEqual(firstResult.shardPaths, [
		'00_tracekeeper/control/agent_activity/2026/2026-07-30.md',
	]);
	assert.deepEqual(secondResult.shardPaths, [
		'00_tracekeeper/control/agent_activity/2026/2026-07-31.md',
	]);
	assert.match(
		harness.read(firstResult.shardPaths[0]),
		/^action: fixture\.concurrent-hub\.first$/m
	);
	assert.match(
		harness.read(secondResult.shardPaths[0]),
		/^action: fixture\.concurrent-hub\.second$/m
	);
});

test('cleanup preview binds cutoff hashes and retains mixed-age files', async () => {
	const oldShard = '00_tracekeeper/control/agent_activity/2000/2000-01-01.md';
	const newShard = '00_tracekeeper/control/agent_activity/2999/2999-01-01.md';
	const legacy = '00_tracekeeper/control/audit_log.md';
	const task = '00_tracekeeper/work/tasks/not-audit.md';
	const harness = createActivityHarness({
		files: {
			[oldShard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
			[newShard]: auditMarkdown('2999-01-01T00:00:00.000Z'),
			[legacy]: auditMarkdown(
				'2000-01-01T00:00:00.000Z',
				'2999-01-01T00:00:00.000Z'
			),
			[task]: '# Task\n',
		},
	});
	const controller = harness.createController();
	assert.equal(typeof controller.previewRuntimeLogCleanup, 'function');
	const preview = await controller.previewRuntimeLogCleanup('older-than-week');
	assert.equal(typeof preview.cutoff, 'string');
	assert.equal(typeof preview.confirmationToken, 'string');
	assert.deepEqual(preview.eligibleFiles.map((row) => row.path), [oldShard]);
	assert.deepEqual(
		new Set(preview.retainedFiles.map((row) => row.path)),
		new Set([newShard])
	);
	assert.equal(preview.eligibleFiles.some((row) => row.path === task), false);
	assert.match(preview.trashBehavior, /Obsidian|configured trash/i);
	for (const row of [...preview.eligibleFiles, ...preview.retainedFiles]) {
		assert.equal(typeof row.contentHash, 'string');
		assert.ok(row.contentHash.length > 0);
	}
});

test('cleanup rejects stale preview and trashes only wholly eligible audit files', async () => {
	const oldShard = '00_tracekeeper/control/agent_activity/2000/2000-01-01.md';
	const legacy = '00_tracekeeper/control/audit_log.md';
	const task = '00_tracekeeper/work/tasks/not-audit.md';
	const stale = createActivityHarness({
		files: {
			[oldShard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
			[legacy]: auditMarkdown(
				'2000-01-01T00:00:00.000Z',
				'2999-01-01T00:00:00.000Z'
			),
			[task]: '# Task\n',
		},
	});
	const staleController = stale.createController();
	assert.equal(typeof staleController.previewRuntimeLogCleanup, 'function');
	assert.equal(typeof staleController.commitRuntimeLogCleanup, 'function');
	const stalePreview = await staleController.previewRuntimeLogCleanup('older-than-week');
	const changedCutoff = structuredClone(stalePreview);
	changedCutoff.cutoff = '1999-01-01T00:00:00.000Z';
	await assert.rejects(
		staleController.commitRuntimeLogCleanup(
			changedCutoff,
			stalePreview.confirmationToken
		),
		/cutoff|confirmation|stale/i
	);
	assert.deepEqual(stale.calls.trash, []);
	stale.write(oldShard, `${stale.read(oldShard)}\nchanged after preview\n`);
	await assert.rejects(
		staleController.commitRuntimeLogCleanup(
			stalePreview,
			stalePreview.confirmationToken
		),
		/stale|changed|hash/i
	);
	assert.deepEqual(stale.calls.trash, []);
	assert.deepEqual(stale.calls.delete, []);

	const added = createActivityHarness({
		files: {
			[oldShard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
		},
	});
	const addedController = added.createController();
	const addedPreview = await addedController.previewRuntimeLogCleanup(
		'older-than-week'
	);
	added.write(
		'00_tracekeeper/control/agent_activity/2000/2000-01-02.md',
		auditMarkdown('2000-01-02T00:00:00.000Z')
	);
	await assert.rejects(
		addedController.commitRuntimeLogCleanup(
			addedPreview,
			addedPreview.confirmationToken
		),
		/stale|file set|changed/i
	);
	assert.deepEqual(added.calls.trash, []);

	const fresh = createActivityHarness({
		files: {
			[oldShard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
			[legacy]: auditMarkdown(
				'2000-01-01T00:00:00.000Z',
				'2999-01-01T00:00:00.000Z'
			),
			[task]: '# Task\n',
		},
	});
	const freshController = fresh.createController();
	const preview = await freshController.previewRuntimeLogCleanup('older-than-week');
	const result = await freshController.commitRuntimeLogCleanup(
		preview,
		preview.confirmationToken
	);
	assert.equal(result.status, 'completed');
	assert.deepEqual(result.trashedPaths, [oldShard]);
	assert.deepEqual(fresh.calls.trash, [oldShard]);
	assert.deepEqual(fresh.calls.delete, []);
	assert.equal(fresh.exists(oldShard), false);
	assert.equal(fresh.exists(legacy), true);
	assert.equal(fresh.exists(task), true);

	const clearAll = createActivityHarness({
		files: {
			[oldShard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
			[legacy]: auditMarkdown(
				'2000-01-01T00:00:00.000Z',
				'2999-01-01T00:00:00.000Z'
			),
			[task]: '# Task\n',
		},
	});
	const clearController = clearAll.createController();
	const clearPreview = await clearController.previewRuntimeLogCleanup('all');
	assert.deepEqual(
		new Set(clearPreview.eligibleFiles.map((row) => row.path)),
		new Set([oldShard])
	);
	await clearController.commitRuntimeLogCleanup(
		clearPreview,
		clearPreview.confirmationToken
	);
	assert.equal(clearAll.exists(oldShard), false);
	assert.equal(clearAll.exists(legacy), true);
	assert.equal(clearAll.exists(task), true);
	const auditRepository = new ObsidianAuditShardRepository(clearAll.app, {
		async ensureFolderExists() {},
		createOperationId() {
			return 'post-cleanup-event';
		},
	});
	await auditRepository.appendRawEvents(
		auditEventSection({
			id: '',
			timestamp: '2000-01-01T00:00:00.000Z',
			action: 'fixture.after-cleanup',
		}),
		{ operationId: 'post-cleanup-event' }
	);
	assert.equal(clearAll.exists(oldShard), true);
	assert.match(clearAll.read(oldShard), /^action: fixture\.after-cleanup$/m);
});

test('cleanup revalidates public deletion behavior immediately before mutation', async () => {
	const shard = '00_tracekeeper/control/agent_activity/2000/2000-01-01.md';
	const harness = createActivityHarness({
		files: {
			[shard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
		},
	});
	const controller = harness.createController();
	const preview = await controller.previewRuntimeLogCleanup('older-than-week');
	harness.host.getConfiguredTrashDescription = () =>
		'Changed Obsidian deletion behavior';
	await assert.rejects(
		controller.commitRuntimeLogCleanup(
			preview,
			preview.confirmationToken
		),
		/behavior changed/i
	);
	assert.deepEqual(harness.calls.trash, []);
	assert.equal(harness.exists(shard), true);
});

test('cleanup revalidates the target after durable intent persistence', async () => {
	const shard = '00_tracekeeper/control/agent_activity/2000/2000-01-01.md';
	const harness = createActivityHarness({
		files: {
			[shard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
		},
		afterProcess({
			path: processPath,
			pathCallIndex,
			read,
			write,
		}) {
			if (
				processPath.startsWith('00_tracekeeper/control/operations/')
				&& pathCallIndex === 1
			) {
				write(shard, `${read(shard)}\nchanged after durable intent\n`);
			}
		},
	});
	const controller = harness.createController();
	const preview = await controller.previewRuntimeLogCleanup('older-than-week');
	const result = await controller.commitRuntimeLogCleanup(
		preview,
		preview.confirmationToken
	);
	assert.equal(result.status, 'partial');
	assert.deepEqual(result.trashedPaths, []);
	assert.deepEqual(result.failed, []);
	assert.deepEqual(result.stale, [{
		path: shard,
		reason: 'changed-before-trash',
	}]);
	assert.deepEqual(harness.calls.trash, []);
	assert.equal(harness.exists(shard), true);
});

test('cleanup serializes trash with a same-shard native audit append', async () => {
	const shard = '00_tracekeeper/control/agent_activity/2000/2000-01-01.md';
	let signalTrashEntered;
	let releaseTrash;
	const trashEntered = new Promise((resolve) => {
		signalTrashEntered = resolve;
	});
	const trashGate = new Promise((resolve) => {
		releaseTrash = resolve;
	});
	const harness = createActivityHarness({
		files: {
			[shard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
		},
		beforeTrashFile() {
			signalTrashEntered();
			return trashGate;
		},
	});
	const controller = harness.createController();
	const preview = await controller.previewRuntimeLogCleanup('older-than-week');
	const cleanupPromise = controller.commitRuntimeLogCleanup(
		preview,
		preview.confirmationToken
	);
	await trashEntered;
	const auditRepository = new ObsidianAuditShardRepository(harness.app, {
		async ensureFolderExists() {},
		createOperationId() {
			return 'concurrent-append';
		},
	});
	const appendPromise = auditRepository.appendRawEvents(
		auditEventSection({
			id: '',
			timestamp: '2000-01-01T12:00:00.000Z',
			action: 'fixture.concurrent-append',
		}),
		{ operationId: 'concurrent-append' }
	);
	await Promise.resolve();
	assert.doesNotMatch(harness.read(shard), /fixture\.concurrent-append/);
	releaseTrash();
	const [cleanupResult, appendResult] = await Promise.all([
		cleanupPromise,
		appendPromise,
	]);
	assert.equal(cleanupResult.status, 'completed');
	assert.deepEqual(cleanupResult.trashedPaths, [shard]);
	assert.deepEqual(appendResult.shardPaths, [shard]);
	assert.deepEqual(harness.calls.trash, [shard]);
	assert.equal(harness.exists(shard), true);
	assert.match(harness.read(shard), /^action: fixture\.concurrent-append$/m);
	assert.doesNotMatch(harness.read(shard), /^action: fixture\.event\.1$/m);
});

test('cleanup reports per-file partial failure and never selects non-audit records', async () => {
	const firstShard = '00_tracekeeper/control/agent_activity/2000/2000-01-01.md';
	const secondShard = '00_tracekeeper/control/agent_activity/2000/2000-01-02.md';
	const task = '00_tracekeeper/work/tasks/not-audit.md';
	const harness = createActivityHarness({
		files: {
			[firstShard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
			[secondShard]: auditMarkdown('2000-01-02T00:00:00.000Z'),
			[task]: '# Task\n',
		},
		trashFailures: [secondShard],
	});
	const controller = harness.createController();
	assert.equal(typeof controller.previewRuntimeLogCleanup, 'function');
	assert.equal(typeof controller.commitRuntimeLogCleanup, 'function');
	const preview = await controller.previewRuntimeLogCleanup('older-than-week');
	assert.deepEqual(
		new Set(preview.eligibleFiles.map((row) => row.path)),
		new Set([firstShard, secondShard])
	);
	assert.equal(preview.eligibleFiles.some((row) => row.path === task), false);
	const result = await controller.commitRuntimeLogCleanup(
		preview,
		preview.confirmationToken
	);
	assert.equal(result.status, 'partial');
	assert.deepEqual(result.trashedPaths, [firstShard]);
	assert.deepEqual(result.failed.map((row) => row.path), [secondShard]);
	assert.equal(harness.exists(firstShard), false);
	assert.equal(harness.exists(secondShard), true);
	assert.equal(harness.exists(task), true);
	assert.deepEqual(harness.calls.delete, []);

	const injected = createActivityHarness({
		files: {
			[firstShard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
			[task]: '# Task\n',
		},
	});
	const injectedController = injected.createController();
	const safePreview = await injectedController.previewRuntimeLogCleanup('older-than-week');
	const tamperedPreview = structuredClone(safePreview);
	tamperedPreview.eligibleFiles.push({
		path: task,
		contentHash: hashVaultContent(injected.read(task)),
		eventCount: 0,
	});
	await assert.rejects(
		injectedController.commitRuntimeLogCleanup(
			tamperedPreview,
			safePreview.confirmationToken
		),
		/confirmation|non-audit|invalid|target/i
	);
	assert.deepEqual(injected.calls.trash, []);
	assert.equal(injected.exists(task), true);
});

test('cleanup resumes a persisted trash intent as outcome-unknown after receipt failure', async () => {
	const shard = '00_tracekeeper/control/agent_activity/2000/2000-01-01.md';
	const harness = createActivityHarness({
		files: {
			[shard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
		},
		processFailure({ path: processPath, pathCallIndex }) {
			if (
				processPath.startsWith('00_tracekeeper/control/operations/')
				&& pathCallIndex === 2
			) {
				return new Error('injected receipt persistence failure');
			}
			return null;
		},
	});
	const controller = harness.createController();
	const preview = await controller.previewRuntimeLogCleanup('older-than-week');
	const receiptPath =
		`00_tracekeeper/control/operations/agent-activity-cleanups/${preview.operationId}.json`;
	await assert.rejects(
		controller.commitRuntimeLogCleanup(
			preview,
			preview.confirmationToken
		),
		/injected receipt persistence failure/i
	);
	assert.equal(harness.exists(shard), false);
	assert.deepEqual(harness.calls.trash, [shard]);
	const interruptedReceipt = JSON.parse(harness.read(receiptPath));
	assert.equal(interruptedReceipt.status, 'in-progress');
	assert.equal(interruptedReceipt.attemptingPath, shard);
	assert.deepEqual(interruptedReceipt.trashedPaths, []);

	const restarted = harness.createController();
	const result = await restarted.commitRuntimeLogCleanup(
		preview,
		preview.confirmationToken
	);
	assert.equal(result.status, 'partial');
	assert.deepEqual(result.trashedPaths, []);
	assert.deepEqual(result.failed, []);
	assert.deepEqual(result.stale, [{
		path: shard,
		reason: 'outcome-unknown-after-trash-intent',
	}]);
	assert.deepEqual(harness.calls.trash, [shard]);
	const completedReceipt = JSON.parse(harness.read(receiptPath));
	assert.equal(completedReceipt.status, 'partial');
	assert.equal(completedReceipt.attemptingPath, '');
	assert.match(completedReceipt.bindingHash, /^[a-f0-9]{64}$/);
});

test('cleanup records later-target drift without losing earlier trash progress', async () => {
	const firstShard = '00_tracekeeper/control/agent_activity/2000/2000-01-01.md';
	const secondShard = '00_tracekeeper/control/agent_activity/2000/2000-01-02.md';
	const harness = createActivityHarness({
		files: {
			[firstShard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
			[secondShard]: auditMarkdown('2000-01-02T00:00:00.000Z'),
		},
		afterTrashFile({ path: trashedPath, read, write }) {
			if (trashedPath === firstShard) {
				write(secondShard, `${read(secondShard)}\nchanged during cleanup\n`);
			}
		},
	});
	const controller = harness.createController();
	const preview = await controller.previewRuntimeLogCleanup('older-than-week');
	const result = await controller.commitRuntimeLogCleanup(
		preview,
		preview.confirmationToken
	);
	assert.equal(result.status, 'partial');
	assert.deepEqual(result.trashedPaths, [firstShard]);
	assert.deepEqual(result.failed, []);
	assert.deepEqual(result.stale, [{
		path: secondShard,
		reason: 'changed-before-trash',
	}]);
	assert.deepEqual(harness.calls.trash, [firstShard]);
	assert.equal(harness.exists(firstShard), false);
	assert.equal(harness.exists(secondShard), true);
});

test('cleanup restart and exact retry return one bounded receipt', async () => {
	const shard = '00_tracekeeper/control/agent_activity/2000/2000-01-01.md';
	const harness = createActivityHarness({
		files: {
			[shard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
		},
	});
	const firstController = harness.createController();
	assert.equal(typeof firstController.previewRuntimeLogCleanup, 'function');
	assert.equal(typeof firstController.commitRuntimeLogCleanup, 'function');
	const preview = await firstController.previewRuntimeLogCleanup('older-than-week');
	const [first, concurrentRetry] = await Promise.all([
		firstController.commitRuntimeLogCleanup(
			preview,
			preview.confirmationToken
		),
		firstController.commitRuntimeLogCleanup(
			preview,
			preview.confirmationToken
		),
	]);
	assert.deepEqual(concurrentRetry, first);
	const restartedController = harness.createController();
	const retried = await restartedController.commitRuntimeLogCleanup(
		preview,
		preview.confirmationToken
	);
	assert.deepEqual(retried, first);
	assert.deepEqual(harness.calls.trash, [shard]);
	assert.equal(JSON.stringify(first).length < 4096, true);
});

test('cleanup keeps a live durable intent owned across controller instances', async () => {
	const shard = '00_tracekeeper/control/agent_activity/2000/2000-01-01.md';
	let signalTrashEntered;
	let releaseTrash;
	const trashEntered = new Promise((resolve) => {
		signalTrashEntered = resolve;
	});
	const trashGate = new Promise((resolve) => {
		releaseTrash = resolve;
	});
	const harness = createActivityHarness({
		files: {
			[shard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
		},
		beforeTrashFile() {
			signalTrashEntered();
			return trashGate;
		},
	});
	const firstController = harness.createController();
	const secondController = harness.createController();
	const preview = await firstController.previewRuntimeLogCleanup(
		'older-than-week'
	);
	const firstPromise = firstController.commitRuntimeLogCleanup(
		preview,
		preview.confirmationToken
	);
	await trashEntered;
	const receiptPath =
		`00_tracekeeper/control/operations/agent-activity-cleanups/${preview.operationId}.json`;
	const liveIntent = JSON.parse(harness.read(receiptPath));
	assert.equal(liveIntent.status, 'in-progress');
	assert.equal(liveIntent.attemptingPath, shard);
	const secondPromise = secondController.commitRuntimeLogCleanup(
		preview,
		preview.confirmationToken
	);
	await Promise.resolve();
	const stillOwnedIntent = JSON.parse(harness.read(receiptPath));
	assert.equal(stillOwnedIntent.revision, liveIntent.revision);
	assert.equal(stillOwnedIntent.attemptingPath, shard);
	assert.deepEqual(harness.calls.trash, [shard]);
	releaseTrash();
	const [first, second] = await Promise.all([firstPromise, secondPromise]);
	assert.deepEqual(second, first);
	assert.equal(first.status, 'completed');
	assert.deepEqual(first.trashedPaths, [shard]);
	assert.deepEqual(harness.calls.trash, [shard]);
});

test('cleanup receipt CAS rejects external tampering before any retry mutation', async () => {
	const shard = '00_tracekeeper/control/agent_activity/2000/2000-01-01.md';
	const harness = createActivityHarness({
		files: {
			[shard]: auditMarkdown('2000-01-01T00:00:00.000Z'),
		},
	});
	const controller = harness.createController();
	const preview = await controller.previewRuntimeLogCleanup('older-than-week');
	await controller.commitRuntimeLogCleanup(
		preview,
		preview.confirmationToken
	);
	const receiptPath =
		`00_tracekeeper/control/operations/agent-activity-cleanups/${preview.operationId}.json`;
	const tampered = JSON.parse(harness.read(receiptPath));
	tampered.completedAt = '2001-01-01T00:00:00.000Z';
	harness.write(receiptPath, `${JSON.stringify(tampered, null, 2)}\n`);
	await assert.rejects(
		harness.createController().commitRuntimeLogCleanup(
			preview,
			preview.confirmationToken
		),
		/receipt|conflicts|invalid/i
	);
	assert.deepEqual(harness.calls.trash, [shard]);
});

test('runtime-log cleanup has zero Vault.delete reachability and uses trashFile', () => {
	const source = fs.readFileSync('src/features/activity/activity-data-controller.ts', 'utf8');
	const controllerSource = fs.readFileSync(
		'src/features/review/review-queue-controller.ts',
		'utf8'
	);
	const transitionSource = fs.readFileSync(
		'src/features/review/proposal-transition-adapter.ts',
		'utf8'
	);
	const recordRepositorySource = fs.readFileSync(
		'src/features/activity/activity-record-repository.ts',
		'utf8'
	);
	const mainSource = fs.readFileSync('src/main.ts', 'utf8');
	assert.equal(/\.vault\.delete\s*\(/.test(source), false, 'cleanup must not call Vault.delete');
	assert.equal(/\.fileManager\.trashFile\s*\(/.test(source), true, 'cleanup must call FileManager.trashFile');
	assert.equal(/cleanAuditLogSections\s*\(/.test(source), false, 'cleanup must not rewrite legacy sections');
	assert.equal(/trashOption/.test(mainSource), false, 'cleanup must not read private trash configuration');
	assert.equal(
		/getConfig\s*(?:\?\.|\()/u.test(controllerSource),
		false,
		'archive must not read private Vault configuration'
	);
	assert.equal(
		/\.cachedRead\s*\(/.test(controllerSource),
		false,
		'archive preview and commit must use fresh Vault reads'
	);
	assert.equal(
		/\.cachedRead\s*\(/.test(transitionSource),
		false,
		'archive transition inspection must use a fresh Vault read'
	);
	assert.match(
		recordRepositorySource,
		/readMemoryProposalFileSnapshot[\s\S]*?vault\.read\s*\(file\)/
	);
});

test('cleanup UI previews exact files before confirmation and announces recovery state', () => {
	const source = fs.readFileSync('src/features/runtime/runtime-log-view.ts', 'utf8');
	assert.match(source, /previewRuntimeLogCleanup\s*\(/);
	assert.match(source, /commitRuntimeLogCleanup\s*\(/);
	assert.match(source, /preview\.trashBehavior/);
	assert.match(source, /'aria-live': 'polite'/);
	assert.match(source, /cancel\.focus\s*\(/);
	assert.match(source, /tracekeeper-runtime-log-cleanup-modal__file-list/);
	assert.match(source, /漂移或结果未知/);
	assert.match(source, /确认按 Obsidian 当前删除设置处理/);
	assert.doesNotMatch(source, /Confirm move to trash/);
	assert.equal(/cleanRuntimeLogs\s*\(/.test(source), false);
});

test('archive UI displays the bound preview and recovery guidance before native move', () => {
	const viewSource = fs.readFileSync('src/features/review/review-queue-view.ts', 'utf8');
	const modalSource = fs.readFileSync('src/features/review/review-modals.ts', 'utf8');
	const mainSource = fs.readFileSync('src/main.ts', 'utf8');
	assert.match(viewSource, /new ReviewQueueArchiveModal\s*\(/);
	assert.match(modalSource, /previewArchiveMemoryProposals\s*\(/);
	assert.match(modalSource, /commitArchiveMemoryProposals\s*\(preview\)/);
	assert.match(modalSource, /item\.sourcePath.*item\.destinationPath/s);
	assert.match(modalSource, /item\.managedReferences/);
	assert.match(modalSource, /'aria-live': 'polite'|configureLiveStatus\s*\(/);
	assert.match(modalSource, /cancel\.focus\s*\(/);
	assert.match(modalSource, /归档未完成.*安全续接/s);
	assert.match(mainSource, /previewArchiveMemoryProposals\s*\(/);
	assert.match(mainSource, /commitArchiveMemoryProposals\s*\(/);
});

test('cleanup truthfully explains the public Obsidian deletion contract', () => {
	const description = runtimeLogTrashBehaviorDescription();
	assert.match(description, /FileManager\.trashFile/);
	assert.match(description, /system trash/i);
	assert.match(description, /\.trash/);
	assert.match(description, /permanent deletion/i);
	assert.match(description, /not be recoverable/i);
	assert.match(description, /verify/i);
});

process.on('exit', () => {
	fs.rmSync(tempRoot, { recursive: true, force: true });
	delete globalThis.__tracekeeperRecordLifecycleTFile;
	delete globalThis.__tracekeeperRecordLifecycleTFolder;
});
