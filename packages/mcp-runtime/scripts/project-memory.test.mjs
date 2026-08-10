import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	NodeFsVaultRepository,
	NodeFileOperationJournal,
	buildMemoryRecord,
	computePayloadHash,
	computeProposalContentHash,
	computeProposalRevision,
	parseMarkdown,
	scanVault,
	transitionProposal,
} from '@tracekeeper/core';
import {
	LOCAL_TRUST_CAPABILITIES,
	LOCAL_TRUST_PRINCIPAL_ID,
	callTool,
	recoverPendingOperations,
} from '../dist/index.js';
import { ProjectMemoryApplicationService } from '../dist/application/project-memory.js';

const MEMORY_TOOL = 'tracekeeper.memory';
const PROJECT_ROOT = '01_knowledge/memory/projects';
const GLOBAL_ROOT = '01_knowledge/memory/global';
const GLOBAL_HUB = `${GLOBAL_ROOT}/index.md`;
const WIKI_PATH = '01_knowledge/wiki/project-memory-fixture.md';
const SOURCE_PATH = '01_knowledge/sources/web/project-memory-fixture.md';
const SORT_ORDER = 'observed_at_desc_memory_id_path_asc';
const FIXED_TIME = '2026-07-30T12:00:00.000Z';

function markdown(frontmatter, body) {
	return [
		'---',
		...frontmatter,
		'---',
		'',
		body,
		'',
	].join('\n');
}

function renderFrontmatterMutationValue(value) {
	if (Array.isArray(value)) return JSON.stringify(value);
	if (/^[A-Za-z0-9._/-]+$/.test(String(value))) return String(value);
	return JSON.stringify(value);
}

function applyFrontmatterMutation(text, mutation) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	assert.equal(lines[0], '---');
	const end = lines.indexOf('---', 1);
	assert.ok(end > 0);
	const pending = new Map(Object.entries(mutation));
	const frontmatter = lines.slice(1, end).flatMap((line) => {
		const match = line.match(/^(\s*)([^:#]+):\s*(.*)$/);
		if (!match) return [line];
		const key = match[2].trim();
		if (!pending.has(key)) return [line];
		const value = pending.get(key);
		pending.delete(key);
		return value === null || value === undefined
			? []
			: [`${match[1]}${key}: ${renderFrontmatterMutationValue(value)}`];
	});
	for (const [key, value] of pending) {
		if (value !== null && value !== undefined) {
			frontmatter.push(`${key}: ${renderFrontmatterMutationValue(value)}`);
		}
	}
	return ['---', ...frontmatter, '---', ...lines.slice(end + 1)].join('\n');
}

function approveGeneratedMemoryProposal(fixture, proposal, writebackContent) {
	const text = fixture.read(proposal.proposal_path);
	const parsed = parseMarkdown(text);
	const fields = parsed.frontmatter.fields;
	const scalar = (key) => typeof fields[key] === 'string' ? fields[key] : '';
	const pending = {
		path: proposal.proposal_path,
		classification: 'memory_proposal',
		proposalId: scalar('proposal_id'),
		proposalKind: scalar('proposal_kind'),
		taskId: scalar('task_id'),
		status: 'pending',
		targetPath: scalar('target_note'),
		writebackContent,
		writebackEffect: scalar('writeback_effect') || undefined,
		revisionComment: '',
		revisionRequestedAt: '',
		revisionRequestedBy: '',
		archived: false,
	};
	const decision = transitionProposal(
		pending,
		{
			expectedRevision: computeProposalRevision(pending),
			expectedContentHash: computeProposalContentHash(pending),
			operationId: `human-approve-${pending.proposalId}`,
			action: { kind: 'status', nextStatus: 'approved' },
		},
		{
			now: '2026-08-10T00:00:00.000Z',
			actor: 'human-reviewer',
			targetAllowed: () => true,
			targetExists: () => false,
			targetCreationAllowed: () => true,
		}
	);
	fixture.write(proposal.proposal_path, applyFrontmatterMutation(text, decision.frontmatter));
	return decision;
}

function createRendezvous(expected, name) {
	let arrivals = 0;
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	return async () => {
		arrivals += 1;
		if (arrivals === expected) {
			release();
		}
		let timeout;
		const timedOut = new Promise((_, reject) => {
			timeout = setTimeout(
				() => reject(new Error(`${name} observed ${arrivals}/${expected} required arrivals`)),
				2_000
			);
			timeout.unref();
		});
		try {
			await Promise.race([gate, timedOut]);
		} finally {
			clearTimeout(timeout);
		}
	};
}

class ForcedTwoWriterRepository {
	constructor(delegate) {
		this.delegate = delegate;
		this.waitForSharedRead = createRendezvous(2, 'shared legacy read rendezvous');
		this.waitForEntryCreate = createRendezvous(2, 'immutable entry create rendezvous');
	}

	async readText(relativePath) {
		const result = await this.delegate.readText(relativePath);
		if (relativePath.endsWith('/memory.md')) {
			await this.waitForSharedRead();
		}
		return result;
	}

	async createText(relativePath, content) {
		if (relativePath.includes('/agents/')) {
			await this.waitForEntryCreate();
		}
		return this.delegate.createText(relativePath, content);
	}

	replaceText(relativePath, expectedVersion, content) {
		return this.delegate.replaceText(relativePath, expectedVersion, content);
	}

	listMarkdown(scope) {
		return this.delegate.listMarkdown(scope);
	}
}

class ThrowOnceAfterAgentEntryCreateRepository {
	constructor(delegate) {
		this.delegate = delegate;
		this.createdPath = null;
		this.injected = false;
	}

	readText(relativePath) {
		return this.delegate.readText(relativePath);
	}

	async createText(relativePath, content) {
		const receipt = await this.delegate.createText(relativePath, content);
		if (!this.injected && relativePath.includes('/agents/')) {
			this.injected = true;
			this.createdPath = relativePath;
			throw new Error('simulated interruption after immutable entry create');
		}
		return receipt;
	}

	replaceText(relativePath, expectedVersion, content) {
		return this.delegate.replaceText(relativePath, expectedVersion, content);
	}

	listMarkdown(scope) {
		return this.delegate.listMarkdown(scope);
	}
}

class WriteAuditRepository {
	constructor(delegate) {
		this.delegate = delegate;
		this.createdPaths = [];
		this.replacedPaths = [];
	}

	readText(relativePath) {
		return this.delegate.readText(relativePath);
	}

	async createText(relativePath, content) {
		this.createdPaths.push(relativePath);
		return this.delegate.createText(relativePath, content);
	}

	async replaceText(relativePath, expectedVersion, content) {
		this.replacedPaths.push(relativePath);
		return this.delegate.replaceText(relativePath, expectedVersion, content);
	}

	listMarkdown(scope) {
		return this.delegate.listMarkdown(scope);
	}
}

function createFixture(t, { generation = 41 } = {}) {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-project-memory-runtime-'));
	const vaultRoot = path.join(tempRoot, 'vault');
	fs.mkdirSync(vaultRoot, { recursive: true });
	const baseRepository = new NodeFsVaultRepository({ vaultRoot });
	let snapshotGeneration = generation;

	function write(relativePath, content) {
		const absolutePath = path.join(vaultRoot, relativePath);
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
		fs.writeFileSync(absolutePath, content, 'utf8');
	}

	function read(relativePath) {
		return fs.readFileSync(path.join(vaultRoot, relativePath), 'utf8');
	}

	function exists(relativePath) {
		return fs.existsSync(path.join(vaultRoot, relativePath));
	}

	write(
		WIKI_PATH,
		markdown(
			[
				'type: wiki_concept',
				'title: Project memory fixture',
			],
			'# Project memory fixture\n\nStable Wiki bridge for project-memory tests.'
		)
	);
	write(
		SOURCE_PATH,
		markdown(
			[
				'type: source',
				'title: Project memory source fixture',
			],
			'# Project memory source fixture\n\nVerified source relation for authority tests.'
		)
	);

	function context({
		repository = baseRepository,
		agentId = 'project-memory-agent',
		sessionId = 'project-memory-session',
		clientName = 'Codex',
		observedClientType = 'codex',
	} = {}) {
		return {
			defaultVaultRoot: vaultRoot,
			vaultRepository: repository,
			knowledgeSnapshotProvider(requestedVaultRoot) {
				assert.equal(requestedVaultRoot, vaultRoot);
				const scanned = scanVault(vaultRoot);
				return {
					...scanned,
					index: {
						index_state: 'ready',
						generation: snapshotGeneration,
						event_sequence: snapshotGeneration,
						last_rebuild: FIXED_TIME,
					},
				};
			},
			principalId: LOCAL_TRUST_PRINCIPAL_ID,
			credentialCapabilities: LOCAL_TRUST_CAPABILITIES,
			agentId,
			sessionId,
			clientName,
			observedClientType,
			transport: 'test',
			runtimeVersion: 'test',
			contentLanguage: 'en',
			memoryRules: {
				globalMemoryRule: 'review_queue',
				projectMemoryRule: 'auto_write',
				taskTrackingEnabled: true,
			},
		};
	}

	t.after(() => {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	return {
		tempRoot,
		vaultRoot,
		baseRepository,
		context,
		exists,
		read,
		write,
		generation() {
			return snapshotGeneration;
		},
		setGeneration(nextGeneration) {
			snapshotGeneration = nextGeneration;
		},
	};
}

function addProject(fixture, {
	projectId = 'atlas-id',
	projectKey = 'atlas-5f8d4a7c',
	projectHint = 'atlas',
	repoPath = '/work/atlas',
	legacy = false,
	legacyBody = 'legacy-memory-body-token',
} = {}) {
	const hubPath = `${PROJECT_ROOT}/${projectKey}/index.md`;
	fixture.write(
		hubPath,
		markdown(
			[
				'schema_version: 1',
				'type: project_memory_index',
				`project_id: ${projectId}`,
				`project_key: ${projectKey}`,
				`project_hint: ${projectHint}`,
				`repo_path: ${repoPath}`,
			],
			`# Project memory: ${projectHint}\n\nStable project hub.`
		)
	);
	const legacyPath = `${PROJECT_ROOT}/${projectKey}/memory.md`;
	if (legacy) {
		fixture.write(
			legacyPath,
			markdown(
				[
					'type: project-memory',
					`project_id: ${projectId}`,
					`project_hint: ${projectHint}`,
					`repo_path: ${repoPath}`,
				],
				`# Legacy project memory\n\n${legacyBody}`
			)
		);
	}
	return {
		hubPath,
		legacyPath,
		projectId,
		projectKey,
		projectHint,
		repoPath,
	};
}

function addGlobalHub(fixture, content = '# Global memory\n') {
	fixture.write(GLOBAL_HUB, content);
	return GLOBAL_HUB;
}

function findGlobalAgentEntries(fixture) {
	const root = path.join(fixture.vaultRoot, GLOBAL_ROOT, 'agents');
	if (!fs.existsSync(root)) return [];
	const entries = [];
	const visit = (directory) => {
		for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
			const absolutePath = path.join(directory, item.name);
			if (item.isDirectory()) visit(absolutePath);
			else if (item.isFile() && item.name.endsWith('.md')) {
				entries.push(path.relative(fixture.vaultRoot, absolutePath).replace(/\\/g, '/'));
			}
		}
	};
	visit(root);
	return entries.sort();
}

test('project-memory snapshot preserves the loadScan dependency receiver', async (t) => {
	const fixture = createFixture(t);
	const dependencies = {
		repository: fixture.baseRepository,
		scan: scanVault(fixture.vaultRoot),
		loadScan() {
			return this.scan;
		},
	};
	const service = new ProjectMemoryApplicationService(dependencies);
	const snapshot = await service.snapshot();
	assert.equal(snapshot.index_state, 'filesystem_scan');
});

function addEntry(fixture, project, {
	agentType = 'codex',
	operationId = 'propose-memory-operation-001',
	operationKind = 'propose_memory',
	memoryKinds = ['task_decision'],
	status = 'active',
	createdAt = FIXED_TIME,
	operationHash = `sha256:${crypto.createHash('sha256').update(operationId).digest('hex')}`,
	body = `entry-body-${operationId}`,
} = {}) {
	const pathStem = `${operationKind}-${operationId}`.replace(/[^A-Za-z0-9._-]+/g, '-');
	const entryPath = `${PROJECT_ROOT}/${project.projectKey}/agents/${agentType}/${pathStem}.md`;
	fixture.write(
		entryPath,
		markdown(
			[
				'schema_version: 1',
				'type: project_memory_entry',
				`project_id: ${project.projectId}`,
				`agent_type: ${agentType}`,
				`operation_id: ${operationId}`,
				`operation_kind: ${operationKind}`,
				`memory_kinds: ${JSON.stringify(memoryKinds)}`,
				`status: ${status}`,
				`created_at: ${createdAt}`,
				`operation_hash: ${operationHash}`,
				`project_hub: "[[${project.hubPath.replace(/\.md$/, '')}]]"`,
				`related_wiki: ["[[${WIKI_PATH.replace(/\.md$/, '')}]]"]`,
				'supersedes: []',
			],
			[
				`# ${operationId}`,
				'',
				`[[${project.hubPath.replace(/\.md$/, '')}]]`,
				`[[${WIKI_PATH.replace(/\.md$/, '')}]]`,
				'',
				body,
			].join('\n')
		)
	);
	return {
		path: entryPath,
		agentType,
		operationId,
		operationKind,
		createdAt,
		operationHash,
		body,
	};
}

function projectArgs(project) {
	return {
		project_id: project.projectId,
		project_hint: project.projectHint,
		repo_path: project.repoPath,
	};
}

function autoWriteArgs(project, {
	content,
	idempotencyKey,
	proposalKind = 'task_decision',
} = {}) {
	return {
		proposal_kind: proposalKind,
		content,
		memory_scope: 'project',
		...projectArgs(project),
		related_wiki: [WIKI_PATH],
		idempotency_key: idempotencyKey,
	};
}

function finishTaskArgs(project, taskId, idempotencyKey) {
	return {
		task_id: taskId,
		status: 'completed',
		summary: 'Completed recoverable immutable project-memory closeout.',
		decisions: ['Retain one recoverable decision.'],
		solution_changes: ['Retain one recoverable solution change.'],
		lessons: ['Retain one recoverable lesson.'],
		next_actions: ['Retain one recoverable next action.'],
		memory_candidate_records: [{
			proposal_kind: 'task_decision',
			content: 'Retain one recoverable durable project decision.',
			scope: 'project',
			claim_key: `project:recoverable-${taskId}`,
			evidence: [WIKI_PATH],
		}],
		...projectArgs(project),
		related_wiki: [WIKI_PATH],
		idempotency_key: idempotencyKey,
	};
}

async function startProjectMemoryTask(fixture, project, context, idempotencyKey) {
	return expectSuccess(
		await callTool(
			'tracekeeper.start_task',
			{
				goal: 'Exercise recoverable immutable project-memory closeout.',
				...projectArgs(project),
				idempotency_key: idempotencyKey,
			},
			context
		),
		'start task for recoverable immutable closeout'
	);
}

function serializedPayload(result) {
	try {
		return JSON.stringify(result.structuredContent);
	} catch {
		return String(result.structuredContent);
	}
}

function expectSuccess(result, label) {
	assert.equal(result.isError, false, `${label} failed: ${serializedPayload(result)}`);
	assert.equal(result.structuredContent?.ok, true, `${label} did not return ok=true`);
	return result.structuredContent;
}

function errorCode(result) {
	const value = result.structuredContent?.error_detail?.code;
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

async function listProjectMemory(fixture, project, {
	cursor,
	pageSize,
	context,
} = {}) {
	const args = {
		scope: 'project',
		view: 'all',
		project_id: project.projectId,
		...(cursor ? { cursor } : {}),
		...(pageSize ? { page_size: pageSize } : {}),
	};
	const result = await callTool(MEMORY_TOOL, args, context ?? fixture.context());
	return expectSuccess(result, `${MEMORY_TOOL} project all`);
}

function assertDescriptorOnly(entry) {
	assert.equal(typeof entry.path, 'string');
	assert.equal(path.isAbsolute(entry.path), false, `catalog path must be Vault-relative: ${entry.path}`);
	for (const forbidden of ['absolutePath', 'absolute_path', 'body', 'content', 'text', 'excerpt']) {
		assert.equal(
			Object.prototype.hasOwnProperty.call(entry, forbidden),
			false,
			`catalog entry must not expose ${forbidden}`
		);
	}
}

function assertCatalogEnvelope(payload, project, generation) {
	assert.equal(payload.tool, MEMORY_TOOL);
	assert.equal(payload.read_only, true);
	assert.equal(payload.scope, 'project');
	assert.equal(payload.view, 'all');
	assert.equal(payload.project_id, project.projectId);
	assert.equal(payload.generation, generation);
	assert.equal(payload.complete, true);
	assert.equal(payload.sort, SORT_ORDER);
	assert.equal(typeof payload.total, 'number');
	assert.ok(payload.page && typeof payload.page === 'object');
	assert.equal(typeof payload.page.page_size, 'number');
	assert.ok(payload.page.next_cursor === null || typeof payload.page.next_cursor === 'string');
	assert.ok(Array.isArray(payload.entries));
	for (const entry of payload.entries) {
		assertDescriptorOnly(entry);
	}
}

function assertAutoWriteReceipt(payload) {
	assert.equal(payload.auto_applied, true);
	assert.equal(typeof payload.operation_id, 'string');
	assert.ok(payload.operation_id.length > 0);
	assert.equal(typeof payload.path, 'string');
	assert.equal(path.isAbsolute(payload.path), false);
	assert.ok(payload.status === 'written' || payload.status === 'skipped');
	assert.equal(typeof payload.duplicate, 'boolean');
}

function findAgentEntries(fixture) {
	const root = path.join(fixture.vaultRoot, PROJECT_ROOT);
	if (!fs.existsSync(root)) {
		return [];
	}
	const entries = [];
	const visit = (directory) => {
		for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
			const absolutePath = path.join(directory, item.name);
			if (item.isDirectory()) {
				visit(absolutePath);
			} else if (item.isFile() && item.name.endsWith('.md')) {
				const relativePath = path.relative(fixture.vaultRoot, absolutePath).replace(/\\/g, '/');
				if (relativePath.includes('/agents/')) {
					entries.push(relativePath);
				}
			}
		}
	};
	visit(root);
	return entries.sort();
}

async function finishTaskOperationRecords(fixture) {
	const operationRoot = path.join(
		fixture.vaultRoot,
		'00_tracekeeper',
		'control',
		'operations'
	);
	if (!fs.existsSync(operationRoot)) {
		return [];
	}
	const journal = new NodeFileOperationJournal({ directory: operationRoot });
	const records = await Promise.all(fs.readdirSync(operationRoot)
		.filter((entry) => entry.startsWith('finish-task-') && entry.endsWith('.json'))
		.map((entry) => journal.loadById(entry.slice(0, -'.json'.length))));
	return records.filter(Boolean);
}

async function finishTaskOperationRecord(fixture) {
	const records = await finishTaskOperationRecords(fixture);
	assert.equal(records.length, 1);
	return records[0];
}

function finishTaskOperationPath(fixture) {
	const operationRoot = path.join(
		fixture.vaultRoot,
		'00_tracekeeper',
		'control',
		'operations'
	);
	const entries = fs.readdirSync(operationRoot)
		.filter((entry) => entry.startsWith('finish-task-') && entry.endsWith('.json'));
	assert.equal(entries.length, 1);
	return path.join(operationRoot, entries[0]);
}

async function proposeMemoryOperationRecord(fixture) {
	const operationRoot = path.join(
		fixture.vaultRoot,
		'00_tracekeeper',
		'control',
		'operations'
	);
	const journal = new NodeFileOperationJournal({ directory: operationRoot });
	const records = (await Promise.all(fs.readdirSync(operationRoot)
		.filter((entry) => entry.startsWith('propose-memory-') && entry.endsWith('.json'))
		.map((entry) => journal.loadById(entry.slice(0, -'.json'.length))))).filter(Boolean);
	assert.equal(records.length, 1);
	return records[0];
}

function projectMemoryStepReceipt(operation) {
	const step = operation.completed_steps.find(
		(candidate) => candidate.name === 'finish-task:project-memory'
	);
	assert.ok(step, 'finish-task operation must journal its project-memory step');
	assert.deepEqual(
		Object.keys(step.result).sort(),
		[
			'agent_type',
			'claim_key',
			'memory_id',
			'memory_kinds',
			'operation_hash',
			'operation_id',
			'outcome',
			'path',
			'project_id',
			'write_status',
		]
	);
	return step.result;
}

function assertSingleCodexFinishEntry(fixture, project, operation) {
	const entries = findAgentEntries(fixture);
	assert.equal(entries.length, 1);
	assert.ok(
		entries[0].startsWith(
			`${PROJECT_ROOT}/${project.projectKey}/agents/codex/`
		),
		`finish-task recovery must retain the original Codex namespace: ${entries[0]}`
	);
	const parsed = parseMarkdown(fixture.read(entries[0]));
	assert.equal(parsed.frontmatter.fields.schema_version, 2);
	assert.equal(parsed.frontmatter.fields.type, 'memory_record');
	assert.equal(parsed.frontmatter.fields.project_id, project.projectId);
	assert.equal(parsed.frontmatter.fields.agent_type, 'codex');
	assert.equal(parsed.frontmatter.fields.operation_id, operation.operation_id);
	assert.equal(parsed.frontmatter.fields.memory_kind, 'task_closeout');
	assert.equal(typeof parsed.frontmatter.fields.memory_id, 'string');
	assert.equal(typeof parsed.frontmatter.fields.claim_key, 'string');
	assert.equal(parsed.frontmatter.fields.authority, 'agent');
	assert.equal(parsed.frontmatter.fields.declared_state, 'active');
	return {
		path: entries[0],
		content: fixture.read(entries[0]),
		parsed,
	};
}

function readAuditText(fixture) {
	const auditRoot = path.join(fixture.vaultRoot, '00_tracekeeper', 'control', 'agent_activity');
	if (!fs.existsSync(auditRoot)) {
		return '';
	}
	const parts = [];
	const visit = (directory) => {
		for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
			const absolutePath = path.join(directory, item.name);
			if (item.isDirectory()) {
				visit(absolutePath);
			} else if (item.isFile() && item.name.endsWith('.md')) {
				parts.push(fs.readFileSync(absolutePath, 'utf8'));
			}
		}
	};
	visit(auditRoot);
	return parts.join('\n');
}

test('different-Agent forced concurrency retains every distinct immutable operation', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { projectKey: 'atlas', legacy: true });
	const legacyBefore = fixture.read(project.legacyPath);
	const repository = new ForcedTwoWriterRepository(fixture.baseRepository);
	const calls = [
		callTool(
			'tracekeeper.propose_memory',
			autoWriteArgs(project, {
				content: 'Codex distinct concurrent memory.',
				idempotencyKey: 'project-memory-concurrent-codex',
			}),
			fixture.context({
				repository,
				agentId: 'codex-agent',
				sessionId: 'codex-session',
				clientName: 'Codex',
				observedClientType: 'codex',
			})
		),
		callTool(
			'tracekeeper.propose_memory',
			autoWriteArgs(project, {
				content: 'Claude Code distinct concurrent memory.',
				idempotencyKey: 'project-memory-concurrent-claude',
			}),
			fixture.context({
				repository,
				agentId: 'claude-agent',
				sessionId: 'claude-session',
				clientName: 'Claude Code',
				observedClientType: 'claude-code',
			})
		),
	];
	const results = await Promise.all(calls);
	const payloads = results.map((result, index) =>
		expectSuccess(result, `different-Agent concurrent write ${index + 1}`)
	);
	payloads.forEach(assertAutoWriteReceipt);
	const entryPaths = findAgentEntries(fixture);
	assert.equal(entryPaths.length, 2);
	assert.equal(new Set(entryPaths).size, 2);
	assert.equal(new Set(payloads.map((payload) => payload.path)).size, 2);
	assert.ok(entryPaths.some((entryPath) => entryPath.includes('/agents/codex/')));
	assert.ok(entryPaths.some((entryPath) => entryPath.includes('/agents/claude-code/')));
	assert.equal(fixture.read(project.legacyPath), legacyBefore);
});

test('ordinary v2 writes keep the aggregate project Hub create-only and unchanged', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture);
	const hubBefore = fixture.read(project.hubPath);
	const repository = new WriteAuditRepository(fixture.baseRepository);
	for (const [index, claimKey] of ['architecture:hub-hotspot-one', 'architecture:hub-hotspot-two'].entries()) {
		const result = expectSuccess(await callTool(
			'tracekeeper.propose_memory',
			{
				...autoWriteArgs(project, {
					content: `Independent immutable record ${index + 1}.`,
					idempotencyKey: `project-memory-no-hub-hotspot-${index + 1}`,
				}),
				claim_key: claimKey,
			},
			fixture.context({ repository })
		), `ordinary immutable write ${index + 1}`);
		assert.equal(result.auto_applied, true);
	}
	assert.equal(repository.createdPaths.filter((entryPath) => entryPath.includes('/agents/')).length, 2);
	assert.equal(repository.replacedPaths.includes(project.hubPath), false);
	assert.equal(fixture.read(project.hubPath), hubBefore);
});

test('same-Agent forced concurrency retains every distinct immutable operation', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { projectKey: 'atlas', legacy: true });
	const legacyBefore = fixture.read(project.legacyPath);
	const repository = new ForcedTwoWriterRepository(fixture.baseRepository);
	const results = await Promise.all([
		callTool(
			'tracekeeper.propose_memory',
			autoWriteArgs(project, {
				content: 'First same-Agent concurrent operation.',
				idempotencyKey: 'project-memory-same-agent-first',
			}),
			fixture.context({
				repository,
				agentId: 'codex-agent-one',
				sessionId: 'codex-session-one',
				clientName: 'Codex',
				observedClientType: 'codex',
			})
		),
		callTool(
			'tracekeeper.propose_memory',
			autoWriteArgs(project, {
				content: 'Second same-Agent concurrent operation.',
				idempotencyKey: 'project-memory-same-agent-second',
			}),
			fixture.context({
				repository,
				agentId: 'codex-agent-two',
				sessionId: 'codex-session-two',
				clientName: 'Codex',
				observedClientType: 'codex',
			})
		),
	]);
	const payloads = results.map((result, index) =>
		expectSuccess(result, `same-Agent concurrent write ${index + 1}`)
	);
	payloads.forEach(assertAutoWriteReceipt);
	const entryPaths = findAgentEntries(fixture);
	assert.equal(entryPaths.length, 2);
	assert.equal(new Set(entryPaths).size, 2);
	assert.ok(entryPaths.every((entryPath) => entryPath.includes('/agents/codex/')));
	assert.equal(new Set(payloads.map((payload) => payload.path)).size, 2);
	assert.equal(fixture.read(project.legacyPath), legacyBefore);
});

test('propose_memory recovery before finalize retains the original Agent namespace and one immutable entry', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { legacy: true });
	const legacyBefore = fixture.read(project.legacyPath);
	const args = autoWriteArgs(project, {
		content: 'Recover this proposal before its immutable finalizer.',
		idempotencyKey: 'project-memory-propose-recovery-before-finalize',
	});
	let injected = false;
	const interrupted = await callTool(
		'tracekeeper.propose_memory',
		args,
		{
			...fixture.context(),
			operationFailureInjection(injection) {
				if (!injected && injection.phase === 'before_finalize') {
					injected = true;
					throw new Error('simulated interruption before propose_memory finalize');
				}
			},
		}
	);
	assert.equal(interrupted.isError, true);
	assert.equal(injected, true);
	const failed = await proposeMemoryOperationRecord(fixture);
	assert.equal(failed.status, 'failed');
	assert.equal(findAgentEntries(fixture).length, 0);

	const recoveryContext = fixture.context({
		agentId: 'claude-propose-recovery-agent',
		sessionId: 'claude-propose-recovery-session',
		clientName: 'Claude Code',
		observedClientType: 'claude-code',
	});
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, recoveryContext),
		{ recovered: [failed.operation_id], failed: [], skipped: [] }
	);
	const completed = await proposeMemoryOperationRecord(fixture);
	assert.equal(completed.status, 'completed');
	const entries = findAgentEntries(fixture);
	assert.equal(entries.length, 1);
	assert.ok(entries[0].includes('/agents/codex/'));
	const parsed = parseMarkdown(fixture.read(entries[0]));
	assert.equal(parsed.frontmatter.fields.operation_id, completed.operation_id);
	assert.equal(parsed.frontmatter.fields.agent_type, 'codex');
	assert.match(parsed.body, /Recover this proposal before its immutable finalizer\./);

	const replay = expectSuccess(
		await callTool('tracekeeper.propose_memory', args, fixture.context()),
		'replay recovered propose_memory operation'
	);
	assert.equal(replay.operation_id, completed.operation_id);
	assert.equal(replay.path, entries[0]);
	assert.equal(findAgentEntries(fixture).length, 1);
	assert.equal(fixture.read(project.legacyPath), legacyBefore);
});

test('propose_memory recovery reuses an entry created before a repository interruption', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { legacy: true });
	const legacyBefore = fixture.read(project.legacyPath);
	const repository = new ThrowOnceAfterAgentEntryCreateRepository(
		fixture.baseRepository
	);
	const args = autoWriteArgs(project, {
		content: 'Recover the exact proposal entry created before repository interruption.',
		idempotencyKey: 'project-memory-propose-repository-recovery',
	});
	const interrupted = await callTool(
		'tracekeeper.propose_memory',
		args,
		fixture.context({ repository })
	);
	assert.equal(interrupted.isError, true);
	assert.equal(repository.injected, true);
	const failed = await proposeMemoryOperationRecord(fixture);
	assert.equal(failed.status, 'failed');
	const entriesBefore = findAgentEntries(fixture);
	assert.deepEqual(entriesBefore, [repository.createdPath]);
	const contentBefore = fixture.read(entriesBefore[0]);

	const recoveryContext = fixture.context({
		repository: fixture.baseRepository,
		agentId: 'claude-propose-repository-recovery-agent',
		sessionId: 'claude-propose-repository-recovery-session',
		clientName: 'Claude Code',
		observedClientType: 'claude-code',
	});
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, recoveryContext),
		{ recovered: [failed.operation_id], failed: [], skipped: [] }
	);
	const completed = await proposeMemoryOperationRecord(fixture);
	assert.equal(completed.status, 'completed');
	assert.deepEqual(findAgentEntries(fixture), entriesBefore);
	assert.equal(fixture.read(entriesBefore[0]), contentBefore);
	const parsed = parseMarkdown(contentBefore);
	assert.equal(parsed.frontmatter.fields.operation_id, completed.operation_id);
	assert.equal(parsed.frontmatter.fields.agent_type, 'codex');
	assert.equal(fixture.read(project.legacyPath), legacyBefore);
});

test('start_task respects the task tracking setting', async (t) => {
	const fixture = createFixture(t);
	const result = await callTool('tracekeeper.start_task', {
		goal: 'This task must not be tracked when disabled.',
		idempotency_key: 'task-tracking-disabled',
	}, fixture.context());
	assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
	// The setting is supplied through the runtime context, not the tool payload.
	const disabled = await callTool('tracekeeper.start_task', {
		goal: 'This task must not be tracked when disabled.',
		idempotency_key: 'task-tracking-disabled-2',
	}, {
		...fixture.context(),
		memoryRules: { ...fixture.context().memoryRules, taskTrackingEnabled: false },
	});
	assert.equal(disabled.isError, true);
	assert.match(String(disabled.structuredContent?.error), /task_tracking_disabled/);
});

test('start_task context_pack_summary excludes control/inbox paths but keeps wiki/source/current memory discoverability', async (t) => {
	const fixture = createFixture(t);
	const context = fixture.context();
	const token = 'start-context-filter-regression-token';

	const sourcePath = '01_knowledge/sources/web/start-context-filter-source.md';
	const wikiPath = '01_knowledge/wiki/concepts/start-context-filter-wiki.md';
	const taskHint = {
		project_hint: 'atlas',
		project_id: 'atlas-id',
		repo_path: '/work/atlas',
	};
	const memoryRecord = buildMemoryRecord({
		path: '01_knowledge/memory/projects/atlas/start-context-filter-memory.md',
		memory_id: 'start-context-filter-memory-id',
		scope: 'project',
		project_id: taskHint.project_id,
		agent_type: 'codex',
		operation_id: 'start-context-filter-memory-operation',
		memory_kind: 'task_decision',
		claim_key: 'start context filter current memory',
		authority: 'agent',
		confidence_level: 'supported',
		declared_state: 'active',
		observed_at: '2026-08-10T00:00:00Z',
		valid_from: null,
		valid_to: null,
		last_verified_at: null,
		evidence: [sourcePath],
		supersedes: [],
		contradicts: [],
		project_hub: '01_knowledge/memory/projects/atlas/index.md',
		global_hub: null,
		related_wiki: [wikiPath],
		related_sources: [sourcePath],
		body: '# Start context filter memory\nstart-context-filter-regression-token\n',
	});
	const memoryPath = memoryRecord.record.path;

	fixture.write(sourcePath, [
		'---',
		`project_hint: ${taskHint.project_hint}`,
		`project_id: ${taskHint.project_id}`,
		'type: captured_source',
		'---',
		'',
		`# Start context filter source`,
		`start-context-filter-regression-token`,
		'',
		'shared evidence for context retrieval.',
		'',
	].join('\n'));
	fixture.write(wikiPath, [
		'---',
		`project_hint: ${taskHint.project_hint}`,
		`project_id: ${taskHint.project_id}`,
		'type: wiki_concept',
		'---',
		'',
		'# Start context filter wiki',
		'start-context-filter-regression-token',
		'',
	].join('\n'));
	fixture.write(memoryPath, memoryRecord.markdown);

	const proposal = expectSuccess(
		await callTool(
			'tracekeeper.propose_memory',
			{
				proposal_kind: 'task_decision',
				content: `proposal containing ${token}`,
				memory_scope: 'global',
				...taskHint,
				related_wiki: [wikiPath.replace(/\.md$/, '')],
				idempotency_key: 'start-context-filter-proposal',
			},
			context
		),
		'create proposal candidate for context filter regression'
	);

	const started = expectSuccess(
		await callTool(
			'tracekeeper.start_task',
			{
				goal: `${token} review context with mixed candidates`,
				idempotency_key: 'start-context-filter-start',
				...taskHint,
			},
			context
		),
		'start_task for context filter regression'
	);

	const relevantNotes = started.context_pack_summary?.relevant_notes ?? [];
	assert.ok(relevantNotes.length > 0);
	const queue = expectSuccess(
		await callTool(
			'tracekeeper.review_queue',
			{ action: 'list_pending' },
			{
				...context,
				credentialCapabilities: [...LOCAL_TRUST_CAPABILITIES, 'memory.review'],
			}
		),
		'list pending review queue'
	);
	assert.ok(queue.entries.some((entry) => entry.path === proposal.proposal_path));
	assertNoTracekeeperPaths(relevantNotes.map((note) => note.relativePath || note.path || ''));
	assert.ok(relevantNotes.some((note) => note.relativePath === sourcePath));
	assert.ok(relevantNotes.some((note) => note.relativePath === wikiPath));
	assert.ok(relevantNotes.some((note) => note.relativePath === memoryPath));
});

function assertNoTracekeeperPaths(paths) {
	for (const notePath of paths) {
		assert.equal(String(notePath).startsWith('00_tracekeeper/control/'), false);
		assert.equal(String(notePath).startsWith('00_tracekeeper/inbox/'), false);
	}
}

test('finish_task keeps ordinary task fields out of durable Memory', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { legacy: true });
	const legacyBefore = fixture.read(project.legacyPath);
	const context = fixture.context();
	const started = expectSuccess(
		await callTool(
			'tracekeeper.start_task',
			{
				goal: 'Characterize aggregated immutable closeout.',
				...projectArgs(project),
				idempotency_key: 'project-memory-finish-start',
			},
			context
		),
		'start task for aggregated closeout'
	);
	const finished = expectSuccess(
		await callTool(
			'tracekeeper.finish_task',
			{
				task_id: started.task_id,
				summary: 'Completed aggregated immutable closeout.',
				decisions: ['Retain one decision.'],
				solution_changes: ['Retain one solution change.'],
				lessons: ['Retain one lesson.'],
				next_actions: ['Retain one next action.'],
				review_proposal_mode: 'auto_propose',
				memory_scope: 'project',
				...projectArgs(project),
				related_wiki: [WIKI_PATH],
				idempotency_key: 'project-memory-finish-complete',
			},
			context
		),
		'finish task with multiple closeout kinds'
	);
	const entryPaths = findAgentEntries(fixture);
	assert.equal(entryPaths.length, 0);
	assert.equal(finished.memory_candidate_records.length, 0);
	assert.equal(finished.memory_changes.length, 0);
	const task = parseMarkdown(fixture.read(finished.task_path));
	assert.equal(task.frontmatter.fields.status, 'completed');
	assert.match(task.body, /Retain one decision\./);
	assert.match(task.body, /Retain one solution change\./);
	assert.match(task.body, /Retain one lesson\./);
	assert.match(task.body, /Retain one next action\./);
	assert.equal(fixture.read(project.legacyPath), legacyBefore);
});

test('finish_task caps Wiki-backed Agent verified confidence at supported, writes one governed v2 record, and reuses it', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { legacy: true });
	const context = fixture.context();
	const started = expectSuccess(
		await callTool('tracekeeper.start_task', {
			goal: 'Write one structured lifecycle candidate.',
			...projectArgs(project),
			idempotency_key: 'finish-structured-start',
		}, context),
		'start structured finish task'
	);
	const args = {
		task_id: started.task_id,
		summary: 'Completed structured lifecycle closeout.',
		memory_candidate_records: [{
			proposal_kind: 'task_decision',
			content: 'Structured closeout claims use the v2 lifecycle writer.',
			scope: 'project',
			claim_key: 'project:structured-closeout-writer',
			evidence: [WIKI_PATH],
			proposed_authority: 'agent',
			proposed_confidence: 'verified',
			declared_state: 'active',
			observed_at: FIXED_TIME,
		}],
		review_proposal_mode: 'auto_propose',
		memory_scope: 'project',
		...projectArgs(project),
		related_wiki: [WIKI_PATH],
		idempotency_key: 'finish-structured-complete',
	};
	const finished = expectSuccess(
		await callTool('tracekeeper.finish_task', args, context),
		'finish task with structured candidate'
	);
	assert.equal(finished.memory_candidate_records.length, 1);
	assert.equal(finished.memory_candidate_records[0].claim_key, 'project:structured-closeout-writer');
	assert.equal(finished.memory_candidate_records[0].authority, 'agent');
	assert.equal(finished.memory_candidate_records[0].confidence_level, 'supported');
	assert.equal(finished.memory_candidate_records[0].effective_state, 'current');
	assert.equal(finished.memory_changes[0].change_kind, 'record_written');
	const entries = findAgentEntries(fixture);
	assert.equal(entries.length, 1);
	const parsed = parseMarkdown(fixture.read(entries[0]));
	assert.equal(parsed.frontmatter.fields.schema_version, 2);
	assert.equal(parsed.frontmatter.fields.type, 'memory_record');
	assert.equal(parsed.frontmatter.fields.claim_key, 'project:structured-closeout-writer');
	assert.deepEqual(parsed.frontmatter.fields.evidence, ['[[01_knowledge/wiki/project-memory-fixture]]']);

	const replayed = expectSuccess(
		await callTool('tracekeeper.finish_task', args, context),
		'replay structured finish task'
	);
	assert.equal(replayed.operation_id, finished.operation_id);
	assert.deepEqual(findAgentEntries(fixture), entries);
	const changed = await callTool('tracekeeper.finish_task', {
		...args,
		memory_candidate_records: [{
			...args.memory_candidate_records[0],
			content: 'Changed structured content must conflict at the same finish identity.',
		}],
	}, context);
	assert.equal(changed.isError, true);
	assert.deepEqual(findAgentEntries(fixture), entries);
});

test('finish_task Global Auto writes one canonical MemoryRecord v2 with exact replay', async (t) => {
	const fixture = createFixture(t);
	addGlobalHub(fixture, '');
	const context = fixture.context();
	context.memoryRules.globalMemoryRule = 'auto_write';
	const started = expectSuccess(
		await callTool('tracekeeper.start_task', {
			goal: 'Write one explicit Global MemoryRecord candidate.',
			idempotency_key: 'finish-global-v2-start',
		}, context),
		'start Global v2 finish task'
	);
	const args = {
		task_id: started.task_id,
		status: 'completed',
		summary: 'Global closeout uses the shared v2 writer.',
		decisions: ['This task fact remains in task history only.'],
		memory_candidate_records: [{
			proposal_kind: 'agent_preference',
			content: 'Use an explicit Global v2 record for durable preferences.',
			scope: 'global',
			claim_key: 'preference:finish-global-v2',
		}],
		idempotency_key: 'finish-global-v2-complete',
	};
	const finished = expectSuccess(
		await callTool('tracekeeper.finish_task', args, context),
		'finish Global v2 task'
	);
	assert.equal(finished.memory_status, 'auto_saved');
	assert.equal(finished.memory_changes.length, 1);
	assert.equal(finished.memory_changes[0].change_kind, 'record_written');
	assert.equal(finished.auto_applied_memory_updates.length, 1);
	const update = finished.auto_applied_memory_updates[0];
	assert.equal(
		update.path,
		`${GLOBAL_ROOT}/agents/codex/propose_memory-${update.operation_id}.md`
	);
	assert.deepEqual(findGlobalAgentEntries(fixture), [update.path]);
	const parsed = parseMarkdown(fixture.read(update.path));
	assert.equal(parsed.frontmatter.fields.schema_version, 2);
	assert.equal(parsed.frontmatter.fields.type, 'memory_record');
	assert.equal(parsed.frontmatter.fields.scope, 'global');
	assert.equal(parsed.frontmatter.fields.project_id, undefined);
	assert.equal(parsed.frontmatter.fields.global_hub, `[[${GLOBAL_HUB.replace(/\.md$/, '')}]]`);
	assert.equal(parsed.frontmatter.fields.claim_key, 'preference:finish-global-v2');
	assert.doesNotMatch(parsed.body, /This task fact remains in task history only\./);
	const operation = await finishTaskOperationRecord(fixture);
	assert.equal(operation.payload.memoryRecordWriteVersion, 2);
	assert.deepEqual(operation.payload.closeoutGroups, []);
	assert.equal(operation.payload.projectMemoryEntryVersion, undefined);

	const replay = expectSuccess(
		await callTool('tracekeeper.finish_task', args, context),
		'replay Global v2 finish task'
	);
	assert.equal(replay.operation_id, finished.operation_id);
	assert.deepEqual(findGlobalAgentEntries(fixture), [update.path]);
	const changed = await callTool('tracekeeper.finish_task', {
		...args,
		memory_candidate_records: [{
			...args.memory_candidate_records[0],
			content: 'Changed Global closeout content must conflict.',
		}],
	}, context);
	assert.equal(changed.isError, true);
	assert.deepEqual(findGlobalAgentEntries(fixture), [update.path]);
});

test('unfinished legacy finish_task recovery fails closed before any Memory append', async (t) => {
	const fixture = createFixture(t);
	addGlobalHub(fixture);
	const context = fixture.context();
	context.memoryRules.globalMemoryRule = 'auto_write';
	const started = expectSuccess(
		await callTool('tracekeeper.start_task', {
			goal: 'Exercise unfinished legacy finish recovery.',
			idempotency_key: 'finish-legacy-recovery-start',
		}, context),
		'start unfinished legacy recovery task'
	);
	let interrupted = false;
	const finishArgs = {
		task_id: started.task_id,
		status: 'completed',
		summary: 'This interrupted closeout must not recover through legacy append semantics.',
		memory_candidate_records: [{
			proposal_kind: 'agent_preference',
			content: 'Never recover this candidate through an unkeyed append.',
			scope: 'global',
			claim_key: 'preference:unfinished-legacy-finish',
		}],
		idempotency_key: 'finish-legacy-recovery-complete',
	};
	const result = await callTool('tracekeeper.finish_task', finishArgs, {
		...context,
		operationFailureInjection(injection) {
			if (
				!interrupted
				&& injection.phase === 'before_step'
				&& injection.stepName === 'finish-task:session-note'
			) {
				interrupted = true;
				throw new Error('interrupt before v2 finish execution');
			}
		},
	});
	assert.equal(result.isError, true);
	assert.equal(interrupted, true);
	const operationPath = finishTaskOperationPath(fixture);
	const operationId = path.basename(operationPath, '.json');
	const operationRoot = path.dirname(operationPath);
	const journal = new NodeFileOperationJournal({ directory: operationRoot });
	const legacyRecord = await journal.loadById(operationId);
	assert.ok(legacyRecord);
	assert.equal(legacyRecord.status, 'failed');
	delete legacyRecord.payload.memoryRecordWriteVersion;
	legacyRecord.payload_hash = computePayloadHash(legacyRecord.payload);
	fs.writeFileSync(operationPath, `${JSON.stringify(legacyRecord, null, 2)}\n`, 'utf8');
	fs.rmSync(path.join(operationRoot, `.progress-${operationId}.anchor`), { force: true });

	const recovery = await recoverPendingOperations(fixture.vaultRoot, context);
	assert.deepEqual(recovery.recovered, []);
	assert.equal(recovery.failed.length, 1);
	assert.equal(recovery.failed[0].operation_id, operationId);
	assert.match(recovery.failed[0].error, /fresh MemoryRecord v2 closeout/i);
	const conflicted = await journal.loadById(operationId);
	assert.equal(conflicted.status, 'conflicted');
	assert.match(conflicted.error, /fresh MemoryRecord v2 closeout/i);
	assert.deepEqual(findGlobalAgentEntries(fixture), []);
	assert.equal(fixture.exists(`${GLOBAL_ROOT}/memory.md`), false);
	const taskAfterRecovery = parseMarkdown(fixture.read(started.path));
	assert.equal(taskAfterRecovery.frontmatter.fields.status, 'active');
	assert.equal(taskAfterRecovery.frontmatter.fields.finish_operation_id, undefined);
	const fresh = expectSuccess(
		await callTool('tracekeeper.finish_task', {
			...finishArgs,
			idempotency_key: 'finish-legacy-recovery-fresh-v2',
		}, context),
		'fresh v2 closeout after legacy quarantine'
	);
	assert.equal(fresh.memory_changes[0].change_kind, 'record_written');
	assert.equal(findGlobalAgentEntries(fixture).length, 1);
});

test('finish_task Project Auto accepts a candidate without Wiki or Source relations', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture);
	const context = fixture.context();
	const started = expectSuccess(
		await callTool('tracekeeper.start_task', {
			goal: 'Finish without a forced Wiki relation.',
			...projectArgs(project),
			idempotency_key: 'finish-no-wiki-start',
		}, context),
		'start no-Wiki finish task'
	);
	const finished = expectSuccess(
		await callTool('tracekeeper.finish_task', {
			task_id: started.task_id,
			summary: 'A relation-free project candidate is valid.',
			memory_candidate_records: [{
				proposal_kind: 'task_decision',
				content: 'Do not require a Wiki bridge for project MemoryRecord v2.',
				scope: 'project',
				claim_key: 'project:no-wiki-finish',
			}],
			review_proposal_mode: 'auto_propose',
			...projectArgs(project),
			idempotency_key: 'finish-no-wiki-complete',
		}, context),
		'finish no-Wiki project candidate'
	);
	assert.equal(finished.memory_changes.length, 1);
	assert.equal(finished.memory_changes[0].change_kind, 'record_written');
	assert.equal(finished.memory_changes[0].reason, undefined);
	assert.equal(finished.memory_status, 'auto_saved');
	assert.equal(finished.missing_wiki_bridge, false);
	assert.deepEqual(finished.related_wiki, []);
	assert.equal(findAgentEntries(fixture).length, 1);
});

test('finish_task routes mixed explicit candidates independently of task project context', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { legacy: true });
	const context = fixture.context();
	const started = expectSuccess(
		await callTool('tracekeeper.start_task', {
			goal: 'Record a task without a project and submit mixed candidates.',
			idempotency_key: 'finish-mixed-start',
		}, context),
		'start mixed candidate task'
	);
	const finished = expectSuccess(
		await callTool('tracekeeper.finish_task', {
			task_id: started.task_id,
			status: 'partial',
			summary: 'Mixed candidate routing.',
			memory_candidate_records: [
				{
					proposal_kind: 'global_preference',
					content: 'Prefer explicit task and memory separation.',
					scope: 'global',
				},
				{
					proposal_kind: 'project_decision',
					content: 'Project candidate carries its own project identity.',
					scope: 'project',
					...projectArgs(project),
					related_wiki: [WIKI_PATH],
				},
			],
			idempotency_key: 'finish-mixed-complete',
		}, context),
		'finish mixed candidate task'
	);
	assert.equal(finished.status, 'partial');
	assert.deepEqual(finished.memory_changes.map((change) => change.scope), ['global', 'project']);
	assert.equal(finished.memory_changes[0].change_kind, 'proposal_queued');
	assert.equal(finished.memory_changes[1].change_kind, 'record_written');
	assert.equal(findAgentEntries(fixture).length, 1);
});

test('finish_task structured candidate review-gates caller authority promotion', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { legacy: true });
	const context = fixture.context();
	const started = expectSuccess(
		await callTool('tracekeeper.start_task', {
			goal: 'Review a structured authority request.',
			...projectArgs(project),
			idempotency_key: 'finish-structured-review-start',
		}, context),
		'start structured review task'
	);
	const finished = expectSuccess(
		await callTool('tracekeeper.finish_task', {
			task_id: started.task_id,
			summary: 'Submitted a structured candidate for review.',
			memory_candidate_records: [{
				proposal_kind: 'task_decision',
				content: 'An Agent cannot promote its own claim to user authority.',
				scope: 'project',
				claim_key: 'project:authority-promotion-review',
				evidence: [WIKI_PATH],
				proposed_authority: 'user',
				proposed_confidence: 'verified',
				observed_at: FIXED_TIME,
			}],
			review_proposal_mode: 'auto_propose',
			memory_scope: 'project',
			...projectArgs(project),
			related_wiki: [WIKI_PATH],
			idempotency_key: 'finish-structured-review-complete',
		}, context),
		'finish task with review-gated candidate'
	);
	assert.equal(findAgentEntries(fixture).length, 0);
	assert.equal(finished.proposal_count, 1);
	assert.equal(finished.memory_changes[0].change_kind, 'proposal_queued');
	assert.equal(finished.memory_changes[0].reason, 'user_authority_requires_human_review');
	assert.equal(finished.memory_candidate_records[0].effective_state, 'review');
	const proposal = parseMarkdown(fixture.read(finished.proposals[0].path));
	assert.equal(proposal.frontmatter.fields.claim_key, 'project:authority-promotion-review');
	assert.equal(proposal.frontmatter.fields.proposed_authority, 'user');
	assert.equal(proposal.frontmatter.fields.proposed_confidence, 'verified');
	assert.equal(proposal.frontmatter.fields.review_reason, 'user_authority_requires_human_review');
});

test.skip('legacy finish_task recovery before the aggregate step is retired with implicit promotion', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { legacy: true });
	const legacyBefore = fixture.read(project.legacyPath);
	const originalContext = fixture.context();
	const started = await startProjectMemoryTask(
		fixture,
		project,
		originalContext,
		'project-memory-recovery-before-start'
	);
	const args = finishTaskArgs(
		project,
		started.task_id,
		'project-memory-recovery-before-finish'
	);
	let injected = false;
	const interrupted = await callTool(
		'tracekeeper.finish_task',
		args,
		{
			...originalContext,
			operationFailureInjection(injection) {
				if (
					!injected
					&& injection.phase === 'before_step'
					&& injection.stepName === 'finish-task:project-memory'
				) {
					injected = true;
					throw new Error('simulated interruption before project-memory aggregation');
				}
			},
		}
	);
	assert.equal(interrupted.isError, true);
	assert.equal(injected, true);
	const failed = await finishTaskOperationRecord(fixture);
	assert.equal(failed.status, 'failed');
	assert.deepEqual(
		failed.completed_steps.map((step) => step.name),
		['finish-task:session-note']
	);
	assert.equal(findAgentEntries(fixture).length, 0);
	assert.equal(fixture.read(project.legacyPath), legacyBefore);

	const recoveryContext = fixture.context({
		agentId: 'claude-recovery-agent',
		sessionId: 'claude-recovery-session',
		clientName: 'Claude Code',
		observedClientType: 'claude-code',
	});
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, recoveryContext),
		{ recovered: [failed.operation_id], failed: [], skipped: [] }
	);
	const completed = await finishTaskOperationRecord(fixture);
	assert.equal(completed.status, 'completed');
	assert.deepEqual(
		completed.completed_steps.map((step) => step.name),
		[
			'finish-task:session-note',
			'finish-task:project-memory',
			'finish-task:update-task-record',
		]
	);
	const receipt = projectMemoryStepReceipt(completed);
	assert.equal(receipt.outcome, 'immutable');
	assert.equal(receipt.agent_type, 'codex');
	assert.equal(receipt.operation_id, completed.operation_id);
	assert.equal(receipt.project_id, project.projectId);
	assert.equal(receipt.write_status, 'written');
	const entry = assertSingleCodexFinishEntry(fixture, project, completed);
	assert.equal(receipt.path, entry.path);

	const replayed = expectSuccess(
		await callTool('tracekeeper.finish_task', args, originalContext),
		'replay recovered finish task'
	);
	assert.equal(replayed.operation_id, completed.operation_id);
	assert.equal(findAgentEntries(fixture).length, 1);
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, recoveryContext),
		{ recovered: [], failed: [], skipped: [] }
	);
	assert.equal(fixture.read(project.legacyPath), legacyBefore);
});

test.skip('legacy finish_task aggregate receipt recovery is retired with implicit promotion', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { legacy: true });
	const legacyBefore = fixture.read(project.legacyPath);
	const originalContext = fixture.context();
	const started = await startProjectMemoryTask(
		fixture,
		project,
		originalContext,
		'project-memory-recovery-after-start'
	);
	const args = finishTaskArgs(
		project,
		started.task_id,
		'project-memory-recovery-after-finish'
	);
	let injected = false;
	const interrupted = await callTool(
		'tracekeeper.finish_task',
		args,
		{
			...originalContext,
			operationFailureInjection(injection) {
				if (
					!injected
					&& injection.phase === 'after_step'
					&& injection.stepName === 'finish-task:project-memory'
				) {
					injected = true;
					throw new Error('simulated interruption after project-memory receipt');
				}
			},
		}
	);
	assert.equal(interrupted.isError, true);
	assert.equal(injected, true);
	const failed = await finishTaskOperationRecord(fixture);
	assert.equal(failed.status, 'failed');
	assert.deepEqual(
		failed.completed_steps.map((step) => step.name),
		['finish-task:session-note', 'finish-task:project-memory']
	);
	const journaledReceipt = projectMemoryStepReceipt(failed);
	assert.equal(journaledReceipt.write_status, 'written');
	const entryBeforeRecovery = assertSingleCodexFinishEntry(fixture, project, failed);
	assert.equal(journaledReceipt.path, entryBeforeRecovery.path);
	assert.equal(fixture.read(project.legacyPath), legacyBefore);

	const recoveryContext = fixture.context({
		agentId: 'custom-recovery-agent',
		sessionId: 'custom-recovery-session',
		clientName: 'Custom Recovery Client',
		observedClientType: 'unknown',
	});
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, recoveryContext),
		{ recovered: [failed.operation_id], failed: [], skipped: [] }
	);
	const completed = await finishTaskOperationRecord(fixture);
	assert.equal(completed.status, 'completed');
	assert.deepEqual(
		completed.completed_steps.map((step) => step.name),
		[
			'finish-task:session-note',
			'finish-task:project-memory',
			'finish-task:update-task-record',
		]
	);
	assert.deepEqual(projectMemoryStepReceipt(completed), journaledReceipt);
	const entryAfterRecovery = assertSingleCodexFinishEntry(fixture, project, completed);
	assert.equal(entryAfterRecovery.path, entryBeforeRecovery.path);
	assert.equal(entryAfterRecovery.content, entryBeforeRecovery.content);

	const replayed = expectSuccess(
		await callTool('tracekeeper.finish_task', args, originalContext),
		'replay finish task recovered after journaled aggregate step'
	);
	assert.equal(replayed.operation_id, completed.operation_id);
	assert.equal(findAgentEntries(fixture).length, 1);
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, recoveryContext),
		{ recovered: [], failed: [], skipped: [] }
	);
	assert.equal(fixture.read(project.legacyPath), legacyBefore);
});

test.skip('legacy finish_task aggregate repository recovery is retired with implicit promotion', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { legacy: true });
	const legacyBefore = fixture.read(project.legacyPath);
	const originalContext = fixture.context();
	const started = await startProjectMemoryTask(
		fixture,
		project,
		originalContext,
		'project-memory-repository-recovery-start'
	);
	const args = finishTaskArgs(
		project,
		started.task_id,
		'project-memory-repository-recovery-finish'
	);
	const repository = new ThrowOnceAfterAgentEntryCreateRepository(
		fixture.baseRepository
	);
	const interrupted = await callTool(
		'tracekeeper.finish_task',
		args,
		fixture.context({ repository })
	);
	assert.equal(interrupted.isError, true);
	assert.equal(repository.injected, true);
	const failed = await finishTaskOperationRecord(fixture);
	assert.equal(failed.status, 'failed');
	assert.deepEqual(
		failed.completed_steps.map((step) => step.name),
		['finish-task:session-note']
	);
	const entryBeforeRecovery = assertSingleCodexFinishEntry(fixture, project, failed);
	assert.equal(repository.createdPath, entryBeforeRecovery.path);
	assert.equal(fixture.read(project.legacyPath), legacyBefore);

	const recoveryContext = fixture.context({
		repository: fixture.baseRepository,
		agentId: 'claude-repository-recovery-agent',
		sessionId: 'claude-repository-recovery-session',
		clientName: 'Claude Code',
		observedClientType: 'claude-code',
	});
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, recoveryContext),
		{ recovered: [failed.operation_id], failed: [], skipped: [] }
	);
	const completed = await finishTaskOperationRecord(fixture);
	assert.equal(completed.status, 'completed');
	assert.deepEqual(
		completed.completed_steps.map((step) => step.name),
		[
			'finish-task:session-note',
			'finish-task:project-memory',
			'finish-task:update-task-record',
		]
	);
	const receipt = projectMemoryStepReceipt(completed);
	assert.equal(receipt.write_status, 'skipped');
	assert.equal(receipt.agent_type, 'codex');
	assert.equal(receipt.path, entryBeforeRecovery.path);
	const entryAfterRecovery = assertSingleCodexFinishEntry(fixture, project, completed);
	assert.equal(entryAfterRecovery.path, entryBeforeRecovery.path);
	assert.equal(entryAfterRecovery.content, entryBeforeRecovery.content);

	const replayed = expectSuccess(
		await callTool('tracekeeper.finish_task', args, originalContext),
		'replay finish task recovered from repository interruption'
	);
	assert.equal(replayed.operation_id, completed.operation_id);
	assert.equal(findAgentEntries(fixture).length, 1);
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, recoveryContext),
		{ recovered: [], failed: [], skipped: [] }
	);
	assert.equal(fixture.read(project.legacyPath), legacyBefore);
});

test.skip('legacy finish_task aggregate journal upgrade is retired with implicit promotion', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { legacy: true });
	const legacyBefore = fixture.read(project.legacyPath);
	const originalContext = fixture.context();
	const started = await startProjectMemoryTask(
		fixture,
		project,
		originalContext,
		'project-memory-pre-upgrade-recovery-start'
	);
	const args = finishTaskArgs(
		project,
		started.task_id,
		'project-memory-pre-upgrade-recovery-finish'
	);
	let injected = false;
	const interrupted = await callTool(
		'tracekeeper.finish_task',
		args,
		{
			...originalContext,
			operationFailureInjection(injection) {
				if (
					!injected
					&& injection.phase === 'before_step'
					&& injection.stepName === 'finish-task:project-memory'
				) {
					injected = true;
					throw new Error('simulated interruption before upgrading finish-task steps');
				}
			},
		}
	);
	assert.equal(interrupted.isError, true);
	assert.equal(injected, true);
	const operationPath = finishTaskOperationPath(fixture);
	const operationId = path.basename(operationPath, '.json');
	const operationRoot = path.dirname(operationPath);
	const preUpgradeRecord = await new NodeFileOperationJournal({
		directory: operationRoot,
	}).loadById(operationId);
	assert.ok(preUpgradeRecord);
	delete preUpgradeRecord.payload.projectMemoryEntryVersion;
	delete preUpgradeRecord.payload.projectMemoryCreatedAt;
	delete preUpgradeRecord.payload.projectMemoryAgentType;
	preUpgradeRecord.payload_hash = computePayloadHash(preUpgradeRecord.payload);
	fs.writeFileSync(operationPath, `${JSON.stringify(preUpgradeRecord, null, 2)}\n`, 'utf8');
	fs.rmSync(path.join(operationRoot, `.progress-${operationId}.anchor`), { force: true });

	const recoveryContext = fixture.context({
		agentId: 'claude-pre-upgrade-recovery-agent',
		sessionId: 'claude-pre-upgrade-recovery-session',
		clientName: 'Claude Code',
		observedClientType: 'claude-code',
	});
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, recoveryContext),
		{ recovered: [preUpgradeRecord.operation_id], failed: [], skipped: [] }
	);
	const completed = await finishTaskOperationRecord(fixture);
	assert.equal(completed.status, 'completed');
	assert.deepEqual(
		completed.completed_steps.map((step) => step.name),
		[
			'finish-task:session-note',
			'finish-task:task_decision',
			'finish-task:solution_change',
			'finish-task:lesson_learned',
			'finish-task:project_next_action',
			'finish-task:update-task-record',
		]
	);
	const entry = assertSingleCodexFinishEntry(fixture, project, completed);
	assert.equal(findAgentEntries(fixture).length, 1);
	for (const step of completed.completed_steps.slice(1, 5)) {
		assert.equal(step.result.outcome, 'immutable');
		assert.equal(step.result.path, entry.path);
	}
	assert.equal(fixture.read(project.legacyPath), legacyBefore);
});

test('exact retry reuses one receipt while changed payload at the same identity conflicts', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { legacy: true });
	const legacyBefore = fixture.read(project.legacyPath);
	const context = fixture.context();
	const args = autoWriteArgs(project, {
		content: 'One idempotent project-memory operation.',
		idempotencyKey: 'project-memory-exact-retry',
	});
	const first = expectSuccess(
		await callTool('tracekeeper.propose_memory', args, context),
		'first immutable project-memory write'
	);
	const retried = expectSuccess(
		await callTool('tracekeeper.propose_memory', args, context),
		'exact immutable project-memory retry'
	);
	assertAutoWriteReceipt(first);
	assertAutoWriteReceipt(retried);
	assert.equal(retried.operation_id, first.operation_id);
	assert.equal(retried.path, first.path);

	const changed = await callTool(
		'tracekeeper.propose_memory',
		{
			...args,
			content: 'Changed payload under the same operation identity.',
		},
		context
	);
	assert.equal(changed.isError, true);
	assert.equal(errorCode(changed), 'idempotency_conflict');
	assert.equal(findAgentEntries(fixture).length, 1);
	assert.equal(fixture.read(project.legacyPath), legacyBefore);
});

test('propose_memory writes a governed v2 record and derives effective authority', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture);
	const result = expectSuccess(
		await callTool(
			'tracekeeper.propose_memory',
			{
				...autoWriteArgs(project, {
					content: 'The project uses the canonical v2 memory writer.',
					idempotencyKey: 'project-memory-v2-governed-write',
				}),
				claim_key: 'architecture:memory-writer',
				proposed_authority: 'source',
				proposed_confidence: 'supported',
				related_sources: [SOURCE_PATH],
				observed_at: FIXED_TIME,
			},
			fixture.context()
		),
		'governed v2 project-memory write'
	);
	assert.equal(result.auto_applied, true);
	assert.equal(result.record_identity.claim_key, 'architecture:memory-writer');
	assert.equal(result.predicted_record.authority, 'source');
	assert.equal(result.predicted_record.confidence_level, 'supported');
	assert.equal(result.predicted_state, 'current');
	assert.equal(typeof result.record_identity.memory_id, 'string');
	const parsed = parseMarkdown(fixture.read(result.path));
	assert.equal(parsed.frontmatter.fields.schema_version, 2);
	assert.equal(parsed.frontmatter.fields.type, 'memory_record');
	assert.equal(parsed.frontmatter.fields.memory_id, result.record_identity.memory_id);
	assert.equal(parsed.frontmatter.fields.claim_key, result.record_identity.claim_key);
	assert.equal(parsed.frontmatter.fields.authority, 'source');
	assert.equal(parsed.frontmatter.fields.confidence_level, 'supported');
});

test('propose_memory accepts verified Wiki evidence for Agent confidence without source authority', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture);
	const result = expectSuccess(
		await callTool(
			'tracekeeper.propose_memory',
			{
				...autoWriteArgs(project, {
					content: 'Agent evidence supports this project claim.',
					idempotencyKey: 'project-memory-v2-cap-agent-verified',
				}),
				claim_key: 'architecture:agent-confidence-cap',
				proposed_authority: 'agent',
				proposed_confidence: 'verified',
				evidence: ['unverified-summary-only'],
				related_wiki: [WIKI_PATH],
			},
			fixture.context()
		),
		'Agent verified confidence cap'
	);
	assert.equal(result.auto_applied, true);
	assert.equal(result.predicted_record.authority, 'agent');
	assert.equal(result.predicted_record.confidence_level, 'supported');
	assert.equal(result.predicted_state, 'current');
	assert.equal(findAgentEntries(fixture).length, 1);
	const parsed = parseMarkdown(fixture.read(result.path));
	assert.equal(parsed.frontmatter.fields.authority, 'agent');
	assert.equal(parsed.frontmatter.fields.confidence_level, 'supported');
	assert.deepEqual(parsed.frontmatter.fields.evidence, [`[[${WIKI_PATH.replace(/\.md$/, '')}]]`]);
	assert.deepEqual(result.predicted_record.evidence, [WIKI_PATH]);
});

test('Global and Project Auto separate fabricated, Wiki, and Source authority evidence', async (t) => {
	const fixture = createFixture(t);
	addGlobalHub(fixture);
	const project = addProject(fixture);
	const cases = [
		{
			label: 'global',
			args: {
				memory_scope: 'global',
			},
			context: fixture.context({
				agentId: 'global-source-downgrade-agent',
				sessionId: 'global-source-downgrade-session',
			}),
		},
		{
			label: 'project',
			args: {
				memory_scope: 'project',
				...projectArgs(project),
			},
			context: fixture.context({
				agentId: 'project-source-downgrade-agent',
				sessionId: 'project-source-downgrade-session',
			}),
		},
	];
	for (const item of cases) {
		item.context.memoryRules.globalMemoryRule = 'auto_write';
		const fabricated = expectSuccess(
			await callTool('tracekeeper.propose_memory', {
				proposal_kind: 'task_decision',
				content: `${item.label} fabricated evidence must not elevate authority.`,
				...item.args,
				claim_key: `authority:${item.label}-fabricated-source`,
				proposed_authority: 'source',
				proposed_confidence: 'supported',
				evidence: ['invented-source-assertion'],
				idempotency_key: `${item.label}-fabricated-source-authority`,
			}, item.context),
			`${item.label} fabricated source authority downgrade`
		);
		assert.equal(fabricated.auto_applied, true);
		assert.equal(fabricated.predicted_record.authority, 'agent');
		assert.equal(fabricated.predicted_record.confidence_level, 'inferred');
		assert.deepEqual(fabricated.predicted_record.evidence, []);
		const fabricatedRecord = parseMarkdown(fixture.read(fabricated.path));
		assert.equal(fabricatedRecord.frontmatter.fields.authority, 'agent');
		assert.equal(fabricatedRecord.frontmatter.fields.confidence_level, 'inferred');
		assert.deepEqual(fabricatedRecord.frontmatter.fields.evidence, []);

		const wikiBacked = expectSuccess(
			await callTool('tracekeeper.propose_memory', {
				proposal_kind: 'task_decision',
				content: `${item.label} Wiki evidence supports confidence but not source authority.`,
				...item.args,
				claim_key: `authority:${item.label}-wiki-source`,
				proposed_authority: 'source',
				proposed_confidence: 'supported',
				related_wiki: [WIKI_PATH],
				idempotency_key: `${item.label}-wiki-source-authority`,
			}, item.context),
			`${item.label} Wiki-backed source authority downgrade`
		);
		assert.equal(wikiBacked.auto_applied, true);
		assert.equal(wikiBacked.predicted_record.authority, 'agent');
		assert.equal(wikiBacked.predicted_record.confidence_level, 'supported');
		assert.deepEqual(wikiBacked.predicted_record.evidence, [WIKI_PATH]);
		const wikiRecord = parseMarkdown(fixture.read(wikiBacked.path));
		assert.equal(wikiRecord.frontmatter.fields.authority, 'agent');
		assert.equal(wikiRecord.frontmatter.fields.confidence_level, 'supported');
		assert.deepEqual(
			wikiRecord.frontmatter.fields.evidence,
			[`[[${WIKI_PATH.replace(/\.md$/, '')}]]`]
		);
	}
});

test('Global and Project Auto do not verify directory collisions as Source relations', async (t) => {
	const fixture = createFixture(t);
	addGlobalHub(fixture);
	const project = addProject(fixture);
	for (const item of [
		{ label: 'global', args: { memory_scope: 'global' } },
		{ label: 'project', args: { memory_scope: 'project', ...projectArgs(project) } },
	]) {
		const invalidSource = `01_knowledge/sources/web/${item.label}-directory.md`;
		fs.mkdirSync(path.join(fixture.vaultRoot, invalidSource), { recursive: true });
		const context = fixture.context({
			agentId: `${item.label}-invalid-source-agent`,
			sessionId: `${item.label}-invalid-source-session`,
		});
		context.memoryRules.globalMemoryRule = 'auto_write';
		const result = expectSuccess(
			await callTool('tracekeeper.propose_memory', {
				proposal_kind: 'task_decision',
				content: `${item.label} directory collision is not verified Source evidence.`,
				...item.args,
				claim_key: `authority:${item.label}-directory-source`,
				proposed_authority: 'source',
				proposed_confidence: 'supported',
				related_sources: [invalidSource],
				idempotency_key: `${item.label}-directory-source-authority`,
			}, context),
			`${item.label} invalid Source relation review`
		);
		assert.equal(result.auto_applied, false);
		assert.equal(result.review_reason, 'unresolved_relation_evidence');
		assert.deepEqual(result.missing_related_sources, [invalidSource]);
	}
	assert.equal(findGlobalAgentEntries(fixture).length, 0);
	assert.equal(findAgentEntries(fixture).length, 0);
});

test('global Auto writes canonical MemoryRecord v2 and accepts an empty existing Hub', async (t) => {
	const fixture = createFixture(t);
	addGlobalHub(fixture, '');
	const context = fixture.context();
	context.memoryRules.globalMemoryRule = 'auto_write';
	const result = expectSuccess(
		await callTool('tracekeeper.propose_memory', {
			proposal_kind: 'agent_preference',
			content: 'Keep the global v2 writer canonical.',
			memory_scope: 'global',
			claim_key: 'preference:global-v2',
			idempotency_key: 'global-memory-v2-empty-hub',
		}, context),
		'global v2 auto write with empty Hub'
	);
	assert.equal(result.auto_applied, true);
	assert.equal(result.memory_scope, 'global');
	assert.equal(result.project_id, null);
	assert.equal(result.project_hub, null);
	assert.equal(result.global_hub, GLOBAL_HUB);
	assert.equal(result.record_identity.claim_key, 'preference:global-v2');
	assert.equal(result.predicted_state, 'current');
	assert.match(result.path, /^01_knowledge\/memory\/global\/agents\/codex\/propose_memory-/);
	assert.equal(result.path, `${GLOBAL_ROOT}/agents/codex/propose_memory-${result.operation_id}.md`);
	const parsed = parseMarkdown(fixture.read(result.path));
	assert.equal(parsed.frontmatter.fields.schema_version, 2);
	assert.equal(parsed.frontmatter.fields.type, 'memory_record');
	assert.equal(parsed.frontmatter.fields.scope, 'global');
	assert.equal(parsed.frontmatter.fields.project_id, undefined);
	assert.equal(parsed.frontmatter.fields.global_hub, `[[${GLOBAL_HUB.replace(/\.md$/, '')}]]`);
});

test('missing Global Hub routes Auto to review with structure repair action and no MemoryRecord', async (t) => {
	const fixture = createFixture(t);
	const context = fixture.context();
	context.memoryRules.globalMemoryRule = 'auto_write';
	const result = expectSuccess(
		await callTool('tracekeeper.propose_memory', {
			proposal_kind: 'agent_preference',
			content: 'Do not create a missing global Hub silently.',
			memory_scope: 'global',
			claim_key: 'preference:missing-global-hub',
			idempotency_key: 'global-memory-v2-missing-hub',
		}, context),
		'missing global Hub review fallback'
	);
	assert.equal(result.auto_applied, false);
	assert.equal(result.review_reason, 'missing_memory_hub');
	assert.equal(result.proposal_destination, 'memory');
	assert.equal(findGlobalAgentEntries(fixture).length, 0);
	assert.equal(fixture.exists(GLOBAL_HUB), false);
	assert.equal(result.next_actions.length, 1);
	assert.match(result.next_actions[0].action_id, /structure_repair_required/);
	assert.equal(result.next_actions[0].reason_code, 'MEMORY_NOT_PERSISTED');
	assert.equal(result.next_actions[0].kind, 'user_review');
	assert.match(result.next_actions[0].reason, /returned queued proposal/i);
	assert.match(result.next_actions[0].reason, /only if the result has no proposal_id or proposal_path/i);
});

test('a directory occupying the Global Hub path routes Auto to structure repair', async (t) => {
	const fixture = createFixture(t);
	fs.mkdirSync(path.join(fixture.vaultRoot, GLOBAL_HUB), { recursive: true });
	const context = fixture.context();
	context.memoryRules.globalMemoryRule = 'auto_write';
	const result = expectSuccess(
		await callTool('tracekeeper.propose_memory', {
			proposal_kind: 'agent_preference',
			content: 'A non-file Hub collision must not become a generic tool failure.',
			memory_scope: 'global',
			claim_key: 'preference:invalid-global-hub',
			idempotency_key: 'global-memory-v2-invalid-hub',
		}, context),
		'invalid global Hub review fallback'
	);
	assert.equal(result.auto_applied, false);
	assert.equal(result.review_reason, 'missing_memory_hub');
	assert.equal(findGlobalAgentEntries(fixture).length, 0);
	assert.match(result.next_actions[0].action_id, /structure_repair_required/);
});

test('project Auto does not require a Wiki relation and preserves explicit unresolved relations for review', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture);
	const withoutWiki = expectSuccess(
		await callTool('tracekeeper.propose_memory', {
			proposal_kind: 'task_decision',
			content: 'Project memory is valid without a Wiki relation.',
			memory_scope: 'project',
			...projectArgs(project),
			claim_key: 'architecture:no-wiki-required',
			idempotency_key: 'project-memory-no-wiki-required',
		}, fixture.context()),
		'project Auto without Wiki'
	);
	assert.equal(withoutWiki.auto_applied, true);
	assert.deepEqual(withoutWiki.related_wiki, []);
	assert.equal(withoutWiki.missing_wiki_bridge, false);

	const unresolved = expectSuccess(
		await callTool('tracekeeper.propose_memory', {
			proposal_kind: 'task_decision',
			content: 'An explicit unresolved relation must be reviewed.',
			memory_scope: 'project',
			...projectArgs(project),
			claim_key: 'architecture:unresolved-relation',
			related_wiki: ['01_knowledge/wiki/does-not-exist.md'],
			idempotency_key: 'project-memory-unresolved-relation',
		}, fixture.context()),
		'explicit unresolved relation review'
	);
	assert.equal(unresolved.auto_applied, false);
	assert.equal(unresolved.review_reason, 'unresolved_relation_evidence');
	assert.equal(findAgentEntries(fixture).length, 1);
});

test('non-Wiki propose_memory without memory_scope fails closed before persistence', async (t) => {
	const fixture = createFixture(t);
	const result = await callTool('tracekeeper.propose_memory', {
		proposal_kind: 'task_decision',
		content: 'A MemoryRecord candidate must declare its scope.',
		claim_key: 'architecture:missing-explicit-scope',
		idempotency_key: 'project-memory-missing-explicit-scope',
	}, fixture.context());
	assert.equal(result.isError, true);
	assert.match(String(result.structuredContent?.error || ''), /memory_scope/i);
	assert.equal(findGlobalAgentEntries(fixture).length, 0);
	assert.equal(findAgentEntries(fixture).length, 0);
	assert.equal(fixture.exists('00_tracekeeper/inbox/review_queue'), false);
});

test('explicit Wiki target is review-gated without memory_scope even when Memory is disabled', async (t) => {
	const fixture = createFixture(t);
	const before = fixture.read(WIKI_PATH);
	const context = fixture.context();
	context.memoryRules.globalMemoryRule = 'disabled';
	context.memoryRules.projectMemoryRule = 'disabled';
	const result = expectSuccess(
		await callTool('tracekeeper.propose_memory', {
			proposal_kind: 'wiki_update',
			content: 'A reviewed Wiki update.',
			target_note: WIKI_PATH,
			idempotency_key: 'wiki-review-independent-memory-policy',
		}, context),
		'Wiki review independent from Memory policy'
	);
	assert.equal(result.auto_applied, false);
	assert.equal(result.proposal_destination, 'wiki');
	assert.equal(result.memory_scope, null);
	assert.equal(result.memory_rule, null);
	assert.equal(result.review_reason, 'wiki_change_requires_human_review');
	assert.equal(result.target_note, undefined);
	assert.equal(fixture.read(WIKI_PATH), before);
});

test('disabled Memory scope ignores a candidate without proposal or durable record', async (t) => {
	const fixture = createFixture(t);
	addGlobalHub(fixture);
	const context = fixture.context();
	context.memoryRules.globalMemoryRule = 'disabled';
	const result = expectSuccess(
		await callTool('tracekeeper.propose_memory', {
			proposal_kind: 'agent_preference',
			content: 'This disabled candidate must not persist.',
			memory_scope: 'global',
			claim_key: 'preference:disabled',
			idempotency_key: 'global-memory-disabled-ignore',
		}, context),
		'disabled Memory candidate'
	);
	assert.equal(result.status, 'ignored');
	assert.equal(result.persisted, false);
	assert.equal(result.memory_rule, 'disabled');
	assert.equal(result.proposal_id, null);
	assert.equal(result.proposal_path, null);
	assert.equal(findGlobalAgentEntries(fixture).length, 0);
	assert.equal(result.next_actions[0].reason_code, 'MEMORY_NOT_PERSISTED');
});

test('finish_task aggregates disabled Memory candidates as no-op instead of queued proposals', async (t) => {
	const fixture = createFixture(t);
	addGlobalHub(fixture);
	const context = fixture.context();
	context.memoryRules.globalMemoryRule = 'disabled';
	const started = expectSuccess(
		await callTool('tracekeeper.start_task', {
			goal: 'Verify disabled closeout Memory semantics.',
			idempotency_key: 'finish-disabled-start',
		}, context),
		'start disabled closeout task'
	);
	const finished = expectSuccess(
		await callTool('tracekeeper.finish_task', {
			task_id: started.task_id,
			status: 'completed',
			summary: 'Disabled Memory candidate remains unpersisted.',
			memory_candidate_records: [{
				proposal_kind: 'agent_preference',
				content: 'Do not persist this disabled closeout candidate.',
				scope: 'global',
				claim_key: 'preference:finish-disabled',
			}],
			idempotency_key: 'finish-disabled-complete',
		}, context),
		'finish disabled closeout task'
	);
	assert.equal(finished.memory_status, 'disabled');
	assert.equal(finished.auto_applied_count, 0);
	assert.equal(finished.proposal_count, 0);
	assert.equal(finished.memory_changes.length, 1);
	assert.equal(finished.memory_changes[0].change_kind, 'disabled');
	assert.equal(finished.memory_changes[0].reason, 'memory_rule_disabled');
	assert.equal(findGlobalAgentEntries(fixture).length, 0);
});

test('finish_task reports explicit structure repair for Global and Project candidates with missing Hubs', async (t) => {
	const fixture = createFixture(t);
	const context = fixture.context();
	context.memoryRules.globalMemoryRule = 'auto_write';
	const started = expectSuccess(
		await callTool('tracekeeper.start_task', {
			goal: 'Verify missing-Hub closeout guidance.',
			idempotency_key: 'finish-missing-hubs-start',
		}, context),
		'start missing-Hub closeout task'
	);
	const finished = expectSuccess(
		await callTool('tracekeeper.finish_task', {
			task_id: started.task_id,
			status: 'completed',
			summary: 'Both candidate scopes need structure repair.',
			memory_candidate_records: [
				{
					proposal_kind: 'agent_preference',
					content: 'Global candidate with missing Hub.',
					scope: 'global',
					claim_key: 'preference:finish-missing-global-hub',
				},
				{
					proposal_kind: 'task_decision',
					content: 'Project candidate with missing Hub.',
					scope: 'project',
					project_hint: 'missing',
					repo_path: '/work/missing',
					claim_key: 'architecture:finish-missing-project-hub',
				},
			],
			idempotency_key: 'finish-missing-hubs-complete',
		}, context),
		'finish missing-Hub closeout task'
	);
	assert.equal(finished.memory_changes.length, 2);
	assert.ok(finished.memory_changes.every((change) => change.reason === 'missing_memory_hub'));
	assert.equal(finished.next_actions.length, 1);
	assert.match(finished.next_actions[0].action_id, /structure_repair_required/);
	assert.equal(finished.next_actions[0].reason_code, 'MEMORY_NOT_PERSISTED');
	assert.equal(finished.next_actions[0].kind, 'user_review');
	assert.match(finished.next_actions[0].reason, /do not call finish_task again/i);
	assert.equal(findGlobalAgentEntries(fixture).length, 0);
	assert.equal(findAgentEntries(fixture).length, 0);
});

test('project Auto does not create a missing Hub and keeps an explicit existing Memory target', async (t) => {
	const fixture = createFixture(t);
	const missing = {
		projectId: 'missing-id',
		projectKey: 'missing-unused',
		projectHint: 'missing',
		repoPath: '/work/missing',
	};
	const missingResult = expectSuccess(
		await callTool('tracekeeper.propose_memory', {
			proposal_kind: 'task_decision',
			content: 'Do not materialize a missing project Hub.',
			memory_scope: 'project',
			project_hint: missing.projectHint,
			repo_path: missing.repoPath,
			claim_key: 'architecture:missing-project-hub',
			idempotency_key: 'project-memory-missing-hub',
		}, fixture.context()),
		'missing project Hub review fallback'
	);
	assert.equal(missingResult.review_reason, 'missing_memory_hub');
	assert.equal(findAgentEntries(fixture).length, 0);

	const project = addProject(fixture);
	const first = expectSuccess(
		await callTool('tracekeeper.propose_memory', {
			...autoWriteArgs(project, {
				content: 'Existing governed record.',
				idempotencyKey: 'project-memory-explicit-target-first',
			}),
			claim_key: 'architecture:explicit-target',
		}, fixture.context()),
		'create existing project record'
	);
	const reviewed = expectSuccess(
		await callTool('tracekeeper.propose_memory', {
			...autoWriteArgs(project, {
				content: 'Reviewed update for exact existing target.',
				idempotencyKey: 'project-memory-explicit-target-review',
			}),
			target_note: first.path,
			claim_key: 'architecture:explicit-target',
		}, fixture.context()),
		'explicit project Memory target review'
	);
	assert.equal(reviewed.auto_applied, false);
	assert.equal(reviewed.review_reason, 'explicit_memory_target_requires_human_review');
	const proposal = parseMarkdown(fixture.read(reviewed.proposal_path));
	assert.equal(proposal.frontmatter.fields.target_note, first.path);
	assert.equal(proposal.frontmatter.fields.writeback_effect, 'append');
});

test('generated Global and Project review proposals complete the Human approval and v2 apply chain', async (t) => {
	for (const scope of ['global', 'project']) {
		await t.test(scope, async (t) => {
			const fixture = createFixture(t);
			const project = scope === 'project' ? addProject(fixture) : null;
			if (scope === 'global') addGlobalHub(fixture, '');
			const context = fixture.context({
				agentId: `${scope}-review-apply-agent`,
				sessionId: `${scope}-review-apply-session`,
			});
			context.credentialCapabilities = ['*'];
			context.writebackConfirmationSecret = `${scope}-review-apply-confirmation-secret`;
			context.memoryRules.globalMemoryRule = 'review_queue';
			context.memoryRules.projectMemoryRule = 'review_queue';
			const content = `${scope} generated proposal becomes one approved v2 MemoryRecord.`;
			const proposed = expectSuccess(
				await callTool('tracekeeper.propose_memory', {
					proposal_kind: 'task_decision',
					content,
					memory_scope: scope,
					...(project ? projectArgs(project) : {}),
					claim_key: `review-apply:${scope}`,
					idempotency_key: `${scope}-generated-review-proposal`,
				}, context),
				`${scope} generated review proposal`
			);
			assert.equal(proposed.auto_applied, false);
			assert.equal(proposed.proposal_destination, 'memory');
			assert.equal(proposed.memory_scope, scope);
			approveGeneratedMemoryProposal(fixture, proposed, content);
			const approvedQueue = expectSuccess(
				await callTool('tracekeeper.review_queue', {
					action: 'list_approved',
				}, context),
				`${scope} approved review queue`
			);
			assert.ok(approvedQueue.entries.some((entry) => entry.proposal_id === proposed.proposal_id));
			const preview = expectSuccess(
				await callTool('tracekeeper.apply_approved_writeback', {
					proposal_id: proposed.proposal_id,
					dry_run: true,
				}, context),
				`${scope} approved MemoryRecord preview`
			);
			assert.equal(preview.writeback_effect, 'create_memory_record');
			const applied = expectSuccess(
				await callTool('tracekeeper.apply_approved_writeback', {
					proposal_id: proposed.proposal_id,
					confirmation_token: preview.confirmation_token,
				}, context),
				`${scope} approved MemoryRecord apply`
			);
			assert.equal(applied.target_note, preview.target_note);
			const record = parseMarkdown(fixture.read(preview.target_note)).frontmatter.fields;
			assert.equal(record.schema_version, 2);
			assert.equal(record.type, 'memory_record');
			assert.equal(record.scope, scope);
			assert.equal(record.claim_key, `review-apply:${scope}`);
			assert.equal(record.agent_type, 'codex');
			if (scope === 'project') {
				assert.equal(record.project_id, project.projectId);
				assert.equal(record.project_hub, `[[${project.hubPath.replace(/\.md$/, '')}]]`);
			} else {
				assert.equal(record.project_id, undefined);
				assert.equal(record.global_hub, `[[${GLOBAL_HUB.replace(/\.md$/, '')}]]`);
			}
		});
	}
});

test('canonical project claim lock serializes different raw identities and unrelated invalid records do not block Auto', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture);
	fixture.write(
		`${PROJECT_ROOT}/${project.projectKey}/agents/codex/invalid-unrelated.md`,
		markdown([
			'schema_version: 2',
			'type: memory_record',
			'scope: project',
			`project_id: ${project.projectId}`,
			'claim_key: unrelated:invalid',
		], '# Invalid unrelated record')
	);
	const eligible = expectSuccess(
		await callTool('tracekeeper.propose_memory', {
			...autoWriteArgs(project, {
				content: 'Unrelated malformed claims must not block this claim.',
				idempotencyKey: 'project-memory-unrelated-invalid',
			}),
			claim_key: 'architecture:eligible-with-unrelated-invalid',
		}, fixture.context()),
		'eligible claim beside unrelated invalid record'
	);
	assert.equal(eligible.auto_applied, true);

	const claimKey = 'architecture:canonical-lock-race';
	const [left, right] = await Promise.all([
		callTool('tracekeeper.propose_memory', {
			proposal_kind: 'task_decision',
			content: 'First concurrent claim value.',
			memory_scope: 'project',
			project_id: project.projectId,
			claim_key: claimKey,
			idempotency_key: 'project-memory-canonical-lock-left',
		}, fixture.context()),
		callTool('tracekeeper.propose_memory', {
			proposal_kind: 'task_decision',
			content: 'Second concurrent claim value.',
			memory_scope: 'project',
			repo_path: project.repoPath,
			claim_key: claimKey,
			idempotency_key: 'project-memory-canonical-lock-right',
		}, fixture.context()),
	]);
	const results = [expectSuccess(left, 'canonical lock left'), expectSuccess(right, 'canonical lock right')];
	assert.equal(results.filter((result) => result.auto_applied).length, 1);
	assert.equal(results.filter((result) => result.review_reason === 'unresolved_claim_conflict').length, 1);
});

test('propose_memory review-gates self-promotion and unresolved claim conflicts', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture);
	const promoted = expectSuccess(
		await callTool(
			'tracekeeper.propose_memory',
			{
				...autoWriteArgs(project, {
					content: 'An Agent must not establish user authority.',
					idempotencyKey: 'project-memory-v2-self-promotion',
				}),
				claim_key: 'governance:authority',
				proposed_authority: 'user',
				proposed_confidence: 'verified',
			},
			fixture.context()
		),
		'self-promotion review fallback'
	);
	assert.equal(promoted.auto_applied, false);
	assert.equal(typeof promoted.proposal_id, 'string');
	assert.equal(promoted.review_reason, 'user_authority_requires_human_review');
	assert.deepEqual(promoted.review_warnings, [
		'Agent-originated memory cannot self-assign user authority.',
	]);
	assert.equal(findAgentEntries(fixture).length, 0);
	const promotedProposal = parseMarkdown(fixture.read(promoted.proposal_path));
	assert.equal(promotedProposal.frontmatter.fields.review_reason, 'user_authority_requires_human_review');
	assert.deepEqual(promotedProposal.frontmatter.fields.review_warnings, [
		'Agent-originated memory cannot self-assign user authority.',
	]);

	const first = expectSuccess(
		await callTool(
			'tracekeeper.propose_memory',
			{
				...autoWriteArgs(project, {
					content: 'First accepted claim value.',
					idempotencyKey: 'project-memory-v2-claim-first',
				}),
				claim_key: 'architecture:claim-conflict',
			},
			fixture.context()
		),
		'first governed claim'
	);
	assert.equal(first.auto_applied, true);
	const conflicting = expectSuccess(
		await callTool(
			'tracekeeper.propose_memory',
			{
				...autoWriteArgs(project, {
					content: 'Conflicting value without an explicit lifecycle relation.',
					idempotencyKey: 'project-memory-v2-claim-conflict',
				}),
				claim_key: 'architecture:claim-conflict',
			},
			fixture.context()
		),
		'conflicting governed claim'
	);
	assert.equal(conflicting.auto_applied, false);
	assert.equal(typeof conflicting.proposal_id, 'string');
	assert.equal(findAgentEntries(fixture).length, 1);
});

test('canonical memory all view includes a legacy-only project note without mutation', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { legacy: true });
	const legacyBefore = fixture.read(project.legacyPath);
	const payload = await listProjectMemory(fixture, project);
	assertCatalogEnvelope(payload, project, fixture.generation());
	assert.equal(payload.total, 1);
	assert.equal(payload.entries.length, 1);
	assert.equal(payload.entries[0].path, project.legacyPath);
	assert.equal(payload.entries[0].legacy, true);
	assert.equal(payload.entries[0].memory_id, null);
	assert.equal(payload.entries[0].claim_key, null);
	assert.equal(payload.entries[0].effective_state, 'legacy_unkeyed');
	assert.equal(fixture.read(project.legacyPath), legacyBefore);
});

test('canonical memory all view dual-reads v1 immutable Agent entries as legacy metadata', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture);
	const codex = addEntry(fixture, project, {
		agentType: 'codex',
		operationId: 'operation-codex',
		createdAt: '2026-07-30T12:00:02.000Z',
	});
	const claude = addEntry(fixture, project, {
		agentType: 'claude-code',
		operationId: 'operation-claude',
		createdAt: '2026-07-30T12:00:01.000Z',
	});
	const payload = await listProjectMemory(fixture, project);
	assertCatalogEnvelope(payload, project, fixture.generation());
	assert.equal(payload.total, 2);
	assert.deepEqual(payload.entries.map((entry) => entry.path), [codex.path, claude.path]);
	assert.ok(payload.entries.every((entry) => entry.legacy === true));
	assert.ok(payload.entries.every((entry) => entry.memory_id === null));
	assert.ok(payload.entries.every((entry) => entry.effective_state === 'legacy_unkeyed'));
	assert.equal(fixture.exists(project.legacyPath), false);
});

test('canonical memory all view includes mixed legacy and v1 immutable entries without migration', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, { legacy: true });
	const legacyBefore = fixture.read(project.legacyPath);
	const created = addEntry(fixture, project, {
		operationId: 'operation-new',
		createdAt: '2026-07-30T12:00:02.000Z',
	});
	const payload = await listProjectMemory(fixture, project);
	assertCatalogEnvelope(payload, project, fixture.generation());
	assert.equal(payload.total, 2);
	assert.deepEqual(
		new Set(payload.entries.map((entry) => entry.path)),
		new Set([project.legacyPath, created.path])
	);
	assert.ok(payload.entries.every((entry) => entry.legacy));
	assert.ok(payload.entries.every((entry) => entry.effective_state === 'legacy_unkeyed'));
	assert.equal(fixture.read(project.legacyPath), legacyBefore);
});

test('same display slug with different stable ids resolves two independent catalogs', async (t) => {
	const fixture = createFixture(t);
	const alpha = addProject(fixture, {
		projectId: 'shared-alpha-id',
		projectKey: 'shared-a1b2c3d4',
		projectHint: 'shared',
		repoPath: '/work/shared-alpha',
	});
	const beta = addProject(fixture, {
		projectId: 'shared-beta-id',
		projectKey: 'shared-e5f6a7b8',
		projectHint: 'shared',
		repoPath: '/work/shared-beta',
	});
	const alphaEntry = addEntry(fixture, alpha, {
		operationId: 'alpha-operation',
	});
	const betaEntry = addEntry(fixture, beta, {
		operationId: 'beta-operation',
	});
	const alphaPayload = await listProjectMemory(fixture, alpha);
	const betaPayload = await listProjectMemory(fixture, beta);
	assertCatalogEnvelope(alphaPayload, alpha, fixture.generation());
	assertCatalogEnvelope(betaPayload, beta, fixture.generation());
	assert.deepEqual(alphaPayload.entries.map((entry) => entry.path), [alphaEntry.path]);
	assert.deepEqual(betaPayload.entries.map((entry) => entry.path), [betaEntry.path]);
});

test('canonical project memory catalog requires an exact project id', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture);
	const result = await callTool(
		MEMORY_TOOL,
		{
			scope: 'project',
			view: 'all',
			project_hint: project.projectHint,
			repo_path: project.repoPath,
		},
		fixture.context()
	);
	assert.equal(result.isError, true);
	assert.equal(errorCode(result), 'invalid_request');
	assert.equal(findAgentEntries(fixture).length, 0);
});

test('hint-only uncertain identity is review-bound and does not auto-write a namespace', async (t) => {
	const fixture = createFixture(t);
	const result = expectSuccess(
		await callTool(
			'tracekeeper.propose_memory',
			{
				proposal_kind: 'task_decision',
				content: 'Hint-only identity must not materialize automatic storage.',
				memory_scope: 'project',
				project_hint: 'unbound-project',
				related_wiki: [WIKI_PATH],
				idempotency_key: 'project-memory-hint-only',
			},
			fixture.context()
		),
		'hint-only project-memory proposal'
	);
	assert.equal(result.auto_applied, false);
	assert.equal(typeof result.proposal_path, 'string');
	const proposal = parseMarkdown(fixture.read(result.proposal_path));
	assert.equal(proposal.frontmatter.fields.target_note ?? null, null);
	assert.doesNotMatch(proposal.body, /\/memory\.md\b/);
	assert.equal(findAgentEntries(fixture).length, 0);
});

test('conflicting explicit identity is review-bound, preserves its explicit target, and does not auto-write', async (t) => {
	const fixture = createFixture(t);
	const alpha = addProject(fixture, {
		projectId: 'alpha-id',
		projectKey: 'alpha-a1b2c3d4',
		projectHint: 'alpha',
		repoPath: '/work/alpha',
	});
	addProject(fixture, {
		projectId: 'beta-id',
		projectKey: 'beta-e5f6a7b8',
		projectHint: 'beta',
		repoPath: '/work/beta',
	});
	const result = expectSuccess(
		await callTool(
			'tracekeeper.propose_memory',
			{
				proposal_kind: 'task_decision',
				content: 'Conflicting identity must remain review-bound.',
				memory_scope: 'project',
				project_id: alpha.projectId,
				project_hint: 'beta',
				repo_path: alpha.repoPath,
				target_note: alpha.legacyPath,
				related_wiki: [WIKI_PATH],
				idempotency_key: 'project-memory-conflicting-identity',
			},
			fixture.context()
		),
		'conflicting project-memory proposal'
	);
	assert.equal(result.auto_applied, false);
	assert.equal(typeof result.proposal_path, 'string');
	const proposal = parseMarkdown(fixture.read(result.proposal_path));
	assert.equal(proposal.frontmatter.fields.target_note, alpha.legacyPath);
	assert.match(proposal.body, /\/memory\.md\b/);
	assert.equal(findAgentEntries(fixture).length, 0);
});

test('finish_task immutable review fallback never proposes a legacy shared-memory target', async (t) => {
	const fixture = createFixture(t);
	const context = fixture.context();
	const started = expectSuccess(
		await callTool(
			'tracekeeper.start_task',
			{
				goal: 'Exercise project-memory identity review fallback.',
				project_hint: 'unbound-review-project',
				idempotency_key: 'project-memory-review-fallback-start',
			},
			context
		),
		'start task for project-memory review fallback'
	);
	const finished = expectSuccess(
		await callTool(
			'tracekeeper.finish_task',
			{
				task_id: started.task_id,
				summary: 'Completed review fallback characterization.',
				decisions: ['Review this decision before assigning a project identity.'],
				memory_candidate_records: [{
					proposal_kind: 'project_decision',
					content: 'Review this decision before assigning a project identity.',
					scope: 'project',
				}],
				project_hint: 'unbound-review-project',
				related_wiki: [WIKI_PATH],
				idempotency_key: 'project-memory-review-fallback-finish',
			},
			context
		),
		'finish task through project-memory review fallback'
	);
	assert.equal(findAgentEntries(fixture).length, 0);
	assert.ok(Array.isArray(finished.proposals));
	assert.equal(finished.proposals.length, 1);
	for (const proposalReference of finished.proposals) {
		const proposal = parseMarkdown(fixture.read(proposalReference.path));
		assert.equal(proposal.frontmatter.fields.target_note ?? null, null);
		assert.doesNotMatch(proposal.body, /\/memory\.md\b/);
	}
});

test('complete catalog enumerates more than the Recall cap over multiple pages', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture);
	const expected = [];
	for (let index = 0; index < 57; index += 1) {
		expected.push(addEntry(fixture, project, {
			agentType: index % 2 === 0 ? 'codex' : 'claude-code',
			operationId: `operation-${String(index + 1).padStart(3, '0')}`,
			createdAt: new Date(Date.parse(FIXED_TIME) - index * 1_000).toISOString(),
			body: `catalog-scale-body-${index + 1}`,
		}));
	}
	const enumerated = [];
	const cursors = new Set();
	let cursor;
	let pageCount = 0;
	do {
		const payload = await listProjectMemory(fixture, project, {
			cursor,
			pageSize: 17,
		});
		assertCatalogEnvelope(payload, project, fixture.generation());
		assert.equal(payload.total, 57);
		assert.equal(payload.page.page_size, 17);
		enumerated.push(...payload.entries.map((entry) => entry.path));
		cursor = payload.page.next_cursor ?? undefined;
		if (cursor) {
			assert.equal(cursors.has(cursor), false, 'catalog cursor must advance');
			cursors.add(cursor);
		}
		pageCount += 1;
		assert.ok(pageCount <= 10, 'catalog pagination must terminate');
	} while (cursor);
	assert.ok(pageCount > 1);
	assert.equal(enumerated.length, 57);
	assert.equal(new Set(enumerated).size, 57);
	assert.deepEqual(enumerated, expected.map((entry) => entry.path));
});

test('catalog rejects a cursor after the bound snapshot generation changes', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture);
	addEntry(fixture, project, { operationId: 'generation-one' });
	addEntry(fixture, project, { operationId: 'generation-two' });
	const first = await listProjectMemory(fixture, project, { pageSize: 1 });
	assertCatalogEnvelope(first, project, fixture.generation());
	assert.equal(typeof first.page.next_cursor, 'string');
	fixture.setGeneration(fixture.generation() + 1);
	const stale = await callTool(
		MEMORY_TOOL,
		{
			scope: 'project',
			view: 'all',
			project_id: project.projectId,
			page_size: 1,
			cursor: first.page.next_cursor,
		},
		fixture.context()
	);
	assert.equal(stale.isError, true);
	assert.equal(errorCode(stale), 'stale_cursor');
});

test('catalog rejects a tampered cursor without falling back to the first page', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture);
	addEntry(fixture, project, { operationId: 'cursor-one' });
	addEntry(fixture, project, { operationId: 'cursor-two' });
	const first = await listProjectMemory(fixture, project, { pageSize: 1 });
	assert.equal(typeof first.page.next_cursor, 'string');
	const cursor = first.page.next_cursor;
	const replacement = cursor.endsWith('a') ? 'b' : 'a';
	const tampered = `${cursor.slice(0, -1)}${replacement}`;
	const invalid = await callTool(
		MEMORY_TOOL,
		{
			scope: 'project',
			view: 'all',
			project_id: project.projectId,
			page_size: 1,
			cursor: tampered,
		},
		fixture.context()
	);
	assert.equal(invalid.isError, true);
	assert.equal(errorCode(invalid), 'invalid_cursor');
});

test('project Recall includes legacy and immutable entries without claiming completeness', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture, {
		legacy: true,
		legacyBody: 'recall-project-memory-token legacy',
	});
	const created = addEntry(fixture, project, {
		operationId: 'recall-new-entry',
		body: 'recall-project-memory-token immutable',
	});
	const payload = expectSuccess(
		await callTool(
			'tracekeeper.recall',
			{
				scope: 'project',
				query: 'recall-project-memory-token',
				max_items: 20,
				...projectArgs(project),
			},
			fixture.context()
		),
		'project Recall over legacy and immutable memory'
	);
	const paths = new Set(payload.matches.map((entry) => entry.path));
	assert.ok(paths.has(project.legacyPath));
	assert.ok(paths.has(created.path));
	assert.notEqual(payload.complete, true);
	assert.notEqual(payload.recall?.complete, true);
});

test('canonical memory public results and audits expose no note body or absolute Vault path', async (t) => {
	const fixture = createFixture(t);
	const project = addProject(fixture);
	const secretBody = 'PROJECT_MEMORY_BODY_MUST_NOT_APPEAR_IN_AUDIT_7e6bf6';
	const written = expectSuccess(
		await callTool(
			'tracekeeper.propose_memory',
			autoWriteArgs(project, {
				content: secretBody,
				idempotencyKey: 'project-memory-audit-redaction',
			}),
			fixture.context()
		),
		'project-memory audit-redaction write'
	);
	assertAutoWriteReceipt(written);
	assert.equal(path.isAbsolute(written.path), false);
	const writeAudit = readAuditText(fixture);
	assert.ok(writeAudit.length > 0);
	assert.doesNotMatch(writeAudit, new RegExp(secretBody));
	assert.doesNotMatch(
		writeAudit,
		new RegExp(fixture.vaultRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
	);
	assert.doesNotMatch(writeAudit, new RegExp(project.repoPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	const catalogResult = await callTool(
		MEMORY_TOOL,
		{
			scope: 'project',
			view: 'all',
			project_id: project.projectId,
		},
		fixture.context()
	);
	const catalog = expectSuccess(
		catalogResult,
		'project-memory bounded public result'
	);
	assertCatalogEnvelope(catalog, project, fixture.generation());
	assert.deepEqual(
		JSON.parse(catalogResult.content[0]?.text),
		catalogResult.structuredContent
	);
	for (const entry of catalog.entries) {
		assertDescriptorOnly(entry);
	}
	const audit = readAuditText(fixture);
	assert.match(
		audit,
		new RegExp(
			`result_summary:.*project_id=${project.projectId}.*total=1.*complete=true.*generation=${fixture.generation()}.*page_size=50.*has_next_page=false`
		)
	);
	assert.doesNotMatch(audit, /next_cursor=/);
	assert.doesNotMatch(
		audit,
		new RegExp(fixture.vaultRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
	);
	assert.doesNotMatch(audit, new RegExp(project.repoPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
