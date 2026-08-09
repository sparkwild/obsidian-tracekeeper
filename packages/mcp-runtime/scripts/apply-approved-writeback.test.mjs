import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { callTool, recoverPendingOperations } = require('../dist/index.js');
const { ApplyApprovedWritebackService } = require('../dist/application/apply-approved-writeback.js');
const {
	computePayloadHash,
	computeProposalContentHash,
	computeProposalRevision,
	NodeFileOperationJournal,
	OperationConflictError,
	transitionProposal,
} = require('@tracekeeper/core');

const TARGET_PATH = '01_knowledge/memory/projects/demo/memory.md';
const PROPOSAL_PATH = '00_tracekeeper/inbox/review_queue/atomic-writeback.md';
const TASK_PATH = '00_tracekeeper/work/tasks/atomic-task.md';
const MARKER = '^writeback-atomic-proposal';
const DEFAULT_WRITEBACK = '- Atomic writeback content.';
const APPROVAL_TIME = '2026-07-30T00:00:00.000Z';
const TRANSITION_RECEIPT_KEYS = [
	'committedAt',
	'committedContentHash',
	'committedRevision',
	'expectedContentHash',
	'expectedRevision',
	'kind',
	'nextStatus',
	'operationId',
	'payloadHash',
	'previousContentHash',
	'previousRevision',
	'previousStatus',
	'proposalId',
	'proposalPath',
	'schemaVersion',
	'taskId',
].sort();
const TASK_LINK_RECEIPT_KEYS = [
	'proposalReferenceAdded',
	'targetReferenceAdded',
	'taskPath',
].sort();

function writeNote(vaultRoot, relativePath, content) {
	const absolutePath = path.join(vaultRoot, relativePath);
	fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
	fs.writeFileSync(absolutePath, content, 'utf8');
	return absolutePath;
}

function readAuditText(vaultRoot) {
	const documents = [];
	const shardRoot = path.join(vaultRoot, '00_tracekeeper', 'control', 'agent_activity');
	if (fs.existsSync(shardRoot)) {
		for (const year of fs.readdirSync(shardRoot, { withFileTypes: true })) {
			if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) {
				continue;
			}
			const yearRoot = path.join(shardRoot, year.name);
			for (const file of fs.readdirSync(yearRoot, { withFileTypes: true })) {
				if (file.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) {
					documents.push(path.join(yearRoot, file.name));
				}
			}
		}
	}
	return documents
		.sort()
		.map((documentPath) => fs.readFileSync(documentPath, 'utf8'))
		.join('\n');
}

function assertWikiCreatePreview(value) {
	assert.ok(value.includes('<!-- writeback operation: writeback-'), 'create_wiki_note preview should include owned marker');
	assert.ok(value.includes(MARKER), 'create_wiki_note preview should include the proposal marker');
}

function renderFrontmatterValue(value) {
	if (Array.isArray(value)) {
		return JSON.stringify(value);
	}
	if (/^[A-Za-z0-9._/-]+$/.test(value)) {
		return value;
	}
	return JSON.stringify(value);
}

function approvedProposalTransition({
	proposalPath = PROPOSAL_PATH,
	proposalId = 'atomic-proposal',
	proposalKind = 'project_update',
	taskId = 'atomic-task',
	targetPath = TARGET_PATH,
	writeback = DEFAULT_WRITEBACK,
	writeback_effect = undefined,
	operationId = `review-approve-${proposalId}`,
} = {}) {
	const isCreateEffect = writeback_effect === 'create_wiki_note'
		|| writeback_effect === 'create_memory_record';
	const pendingWritebackEffect = writeback_effect === undefined ? undefined : { writebackEffect: writeback_effect };
	const pending = {
		path: proposalPath,
		classification: 'memory_proposal',
		proposalId,
		proposalKind,
		taskId,
		status: 'pending',
		targetPath,
		writebackContent: writeback,
		revisionComment: '',
		revisionRequestedAt: '',
		revisionRequestedBy: '',
		archived: false,
		...pendingWritebackEffect,
	};
	return transitionProposal(
		pending,
		{
			expectedRevision: computeProposalRevision(pending),
			expectedContentHash: computeProposalContentHash(pending),
			operationId,
			action: { kind: 'status', nextStatus: 'approved' },
		},
		{
			now: APPROVAL_TIME,
			actor: 'atomic-test-reviewer',
			targetAllowed: () => true,
			targetExists: () => !isCreateEffect,
			targetCreationAllowed: () => true,
		}
	);
}

function proposalText(overrides = {}) {
	const includeApprovalReceipt = overrides.includeApprovalReceipt !== false;
	const baseFields = {
		type: 'memory-proposal',
		proposal_id: 'atomic-proposal',
		proposal_kind: 'project_update',
		approval_status: 'approved',
		status: 'approved',
		target_note: TARGET_PATH,
		task_id: 'atomic-task',
		risk_level: 'medium',
		...overrides.fields,
	};
	const fields = includeApprovalReceipt
		? {
			...baseFields,
			...approvedProposalTransition({
				proposalPath: overrides.path || PROPOSAL_PATH,
				proposalId: String(baseFields.proposal_id),
				proposalKind: String(baseFields.proposal_kind),
				taskId: String(baseFields.task_id),
				targetPath: String(baseFields.target_note),
				writeback: overrides.writeback ?? DEFAULT_WRITEBACK,
				writeback_effect: overrides.fields?.writeback_effect || overrides.fields?.writebackEffect,
			}).frontmatter,
			...overrides.fields,
		}
		: {
			...baseFields,
			...overrides.fields,
		};
	const frontmatter = Object.entries(fields)
		.filter(([, value]) => value !== null)
		.map(([key, value]) => `${key}: ${renderFrontmatterValue(value)}`)
		.join('\n');
	return [
		'---',
		frontmatter,
		'---',
		'',
		'# Atomic Proposal',
		'',
		'## Writeback',
		'',
		overrides.writeback ?? DEFAULT_WRITEBACK,
		'',
	].join('\n');
}

function createFixture(t, options = {}) {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-atomic-writeback-'));
	const vaultRoot = path.join(tempRoot, 'vault');
	fs.mkdirSync(vaultRoot, { recursive: true });
	t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

	const targetPath = options.targetPath || TARGET_PATH;
	if (!options.skipTarget) {
		writeNote(vaultRoot, targetPath, options.targetText || '# Demo Memory\n');
	}
	writeNote(vaultRoot, TASK_PATH, options.taskText || [
		'---',
		'type: agent-task',
		'task_id: atomic-task',
		'status: active',
		'---',
		'',
		'# Atomic Task',
		'',
	].join('\n'));
	writeNote(vaultRoot, PROPOSAL_PATH, proposalText({
		includeApprovalReceipt: options.includeApprovalReceipt,
		fields: {
			target_note: targetPath,
			...options.proposalFields,
		},
		writeback: options.writeback,
	}));

	let nowMs = Date.parse('2026-07-30T00:00:00.000Z');
	const context = {
		defaultVaultRoot: vaultRoot,
		principalId: 'atomic-writeback-test',
		credentialCapabilities: ['*'],
		agentId: 'atomic-test-agent',
		sessionId: 'atomic-test-session',
		writebackConfirmationClock: () => nowMs,
		writebackConfirmationTtlMs: 60_000,
		writebackConfirmationSecret: 'atomic-writeback-test-secret-32-bytes',
	};

	return {
		vaultRoot,
		context,
		targetPath,
		absolute(relativePath) {
			return path.join(vaultRoot, relativePath);
		},
		read(relativePath) {
			return fs.readFileSync(path.join(vaultRoot, relativePath), 'utf8');
		},
		readAudit() {
			return readAuditText(vaultRoot);
		},
		write(relativePath, content) {
			writeNote(vaultRoot, relativePath, content);
		},
		setNow(value) {
			nowMs = value;
		},
	};
}

const LIFECYCLE_PROPOSAL_FIELDS = {
	target_note: '01_knowledge/memory/global/agents/custom/approved-atomic-proposal.md',
	memory_scope: 'global',
	claim_key: 'governance:approved-memory',
	proposed_authority: 'user',
	proposed_confidence: 'verified',
	declared_state: 'active',
	observed_at: APPROVAL_TIME,
	related_wiki: ['01_knowledge/wiki/approved-memory.md'],
};

function lifecycleProposalText(writeback = 'Approved governed memory content.') {
	return proposalText({
		fields: LIFECYCLE_PROPOSAL_FIELDS,
		writeback,
	});
}

function createLifecycleFixture(t, options = {}) {
	return createFixture(t, {
		...options,
		skipTarget: true,
		proposalFields: {
			...LIFECYCLE_PROPOSAL_FIELDS,
			...options.proposalFields,
		},
		writeback: options.writeback ?? 'Approved governed memory content.',
	});
}

test('approved lifecycle proposal creates one immutable v2 memory record after preview', async (t) => {
	const fixture = createLifecycleFixture(t);
	const dryRun = await preview(fixture);
	assert.equal(dryRun.isError, false, JSON.stringify(dryRun.structuredContent));
	const targetPath = dryRun.structuredContent.target_note;
	assert.match(targetPath, /^01_knowledge\/memory\/global\/agents\//);
	assert.equal(fs.existsSync(fixture.absolute(targetPath)), false);
	const applied = await apply(fixture, tokenFrom(dryRun));
	assert.equal(applied.isError, false, JSON.stringify(applied.structuredContent));
	const parsed = require('@tracekeeper/core').parseMarkdown(fixture.read(targetPath));
	assert.equal(parsed.frontmatter.fields.schema_version, 2);
	assert.equal(parsed.frontmatter.fields.type, 'memory_record');
	assert.equal(parsed.frontmatter.fields.claim_key, 'governance:approved-memory');
	assert.equal(parsed.frontmatter.fields.authority, 'user');
	assert.equal(parsed.frontmatter.fields.confidence_level, 'verified');
	const contentBeforeReplay = fixture.read(targetPath);
	const replayed = await apply(fixture, tokenFrom(dryRun));
	assert.equal(replayed.isError, false, JSON.stringify(replayed.structuredContent));
	assert.equal(fixture.read(targetPath), contentBeforeReplay);
});

test('lifecycle proposal conflict compensates the exact created MemoryRecord before applied state', async (t) => {
	const fixture = createLifecycleFixture(t);
	const originalTask = fixture.read(TASK_PATH);
	const dryRun = await preview(fixture);
	const targetPath = dryRun.structuredContent.target_note;
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'mark_proposal_applied') {
			fixture.write(
				PROPOSAL_PATH,
				lifecycleProposalText('Changed after the MemoryRecord target effect.')
			);
		}
	};

	const result = await apply(fixture, tokenFrom(dryRun));
	assert.equal(result.isError, true);
	assert.match(String(result.structuredContent?.error || ''), /conflict|changed/i);
	assert.equal(fs.existsSync(fixture.absolute(targetPath)), false);
	assert.equal(fixture.read(TASK_PATH), originalTask);
	assert.match(fixture.read(PROPOSAL_PATH), /approval_status: approved/);
	const operation = await operationRecord(fixture);
	assert.equal(operation.status, 'conflicted');
	assert.deepEqual(operation.completed_steps.map((step) => step.name), [
		'apply_target',
		'link_task',
	]);
});

test('lifecycle compensation preserves a MemoryRecord changed after its owned creation', async (t) => {
	const fixture = createLifecycleFixture(t);
	const originalTask = fixture.read(TASK_PATH);
	const dryRun = await preview(fixture);
	const targetPath = dryRun.structuredContent.target_note;
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'mark_proposal_applied') {
			fixture.write(targetPath, `${fixture.read(targetPath)}\nUser change after creation.\n`);
			fixture.write(
				PROPOSAL_PATH,
				lifecycleProposalText('Changed after the owned target was edited.')
			);
		}
	};

	const result = await apply(fixture, tokenFrom(dryRun));
	assert.equal(result.isError, true);
	assert.match(String(result.structuredContent?.error || ''), /conflict|compensat|changed/i);
	assert.match(fixture.read(targetPath), /User change after creation/);
	assert.equal(fixture.read(TASK_PATH), originalTask);
	assert.match(fixture.read(PROPOSAL_PATH), /approval_status: approved/);
	assert.equal((await operationRecord(fixture)).status, 'conflicted');
});

test('lifecycle recovery resumes after the MemoryRecord target checkpoint without duplication', async (t) => {
	const fixture = createLifecycleFixture(t);
	const dryRun = await preview(fixture);
	const targetPath = dryRun.structuredContent.target_note;
	let interrupted = false;
	fixture.context.operationFailureInjection = (context) => {
		if (!interrupted && context.phase === 'after_step' && context.stepName === 'apply_target') {
			interrupted = true;
			throw new Error('interrupt after lifecycle target checkpoint');
		}
	};

	const first = await apply(fixture, tokenFrom(dryRun));
	assert.equal(first.isError, true);
	assert.equal(interrupted, true);
	assert.equal(fs.existsSync(fixture.absolute(targetPath)), true);
	const contentBeforeRecovery = fixture.read(targetPath);
	delete fixture.context.operationFailureInjection;
	const recovery = await recoverPendingOperations(fixture.vaultRoot, fixture.context);
	assert.equal(recovery.failed.length, 0);
	assert.equal(recovery.skipped.length, 0);
	assert.equal(recovery.recovered.length, 1);
	assert.equal(fixture.read(targetPath), contentBeforeRecovery);
	assert.match(fixture.read(PROPOSAL_PATH), /approval_status: applied/);
	assert.equal((await operationRecord(fixture)).status, 'completed');
});

async function preview(fixture, args = {}) {
	return callTool(
		'tracekeeper.apply_approved_writeback',
		{ proposal_path: PROPOSAL_PATH, task_id: 'atomic-task', dry_run: true, ...args },
		fixture.context
	);
}

function tokenFrom(result) {
	return result.structuredContent?.confirmation_token || 'x'.repeat(64);
}

async function apply(fixture, confirmationToken, args = {}) {
	return callTool(
		'tracekeeper.apply_approved_writeback',
		{
			proposal_path: PROPOSAL_PATH,
			task_id: 'atomic-task',
			confirmation_token: confirmationToken,
			...args,
		},
		fixture.context
	);
}

function assertRejectedWithoutWrite(fixture, result, targetPaths = [fixture.targetPath]) {
	assert.equal(result.isError, true, 'stale or invalid confirmation must be rejected');
	assert.match(
		String(result.structuredContent?.error || ''),
		/stale|expired|confirmation|conflict|changed|allowed target|approval|receipt|corrupt|authentication|protected Vault boundary|Writeback target does not exist|does not exist|unavailable/i
	);
	for (const targetPath of targetPaths) {
		if (fs.existsSync(fixture.absolute(targetPath))) {
			assert.equal(
				fixture.read(targetPath).includes('^writeback-'),
				false,
				`rejected apply must not mutate ${targetPath}`
			);
		}
	}
}

function countOccurrences(content, needle) {
	return content.split(needle).length - 1;
}

async function operationRecords(fixture) {
	const directory = fixture.absolute('00_tracekeeper/control/operations');
	if (!fs.existsSync(directory)) {
		return [];
	}
	const journal = new NodeFileOperationJournal({ directory });
	const records = await Promise.all(fs.readdirSync(directory)
		.filter((entry) => entry.endsWith('.json'))
		.map((entry) => journal.loadById(entry.slice(0, -'.json'.length))));
	return records.filter(Boolean);
}

async function operationRecord(fixture) {
	const records = await operationRecords(fixture);
	assert.equal(records.length, 1);
	return records[0];
}

function rawOperationRecord(fixture) {
	const directory = fixture.absolute('00_tracekeeper/control/operations');
	const entries = fs.readdirSync(directory).filter((entry) => entry.endsWith('.json'));
	assert.equal(entries.length, 1);
	return JSON.parse(fs.readFileSync(path.join(directory, entries[0]), 'utf8'));
}

function writeRawOperationRecord(fixture, operation) {
	fs.writeFileSync(
		fixture.absolute(`00_tracekeeper/control/operations/${operation.operation_id}.json`),
		`${JSON.stringify(operation, null, 2)}\n`,
		'utf8'
	);
}

function assertBoundedTransitionStep(operation, fixture, confirmationToken, writebackBody) {
	const transitionStep = operation.completed_steps.find(
		(step) => step.name === 'mark_proposal_applied'
	);
	assert.ok(transitionStep);
	assert.ok(transitionStep.result);
	assert.deepEqual(Object.keys(transitionStep.result).sort(), TRANSITION_RECEIPT_KEYS);
	assert.equal(transitionStep.result.schemaVersion, 1);
	assert.equal(transitionStep.result.operationId, operation.operation_id);
	assert.equal(transitionStep.result.kind, 'apply');
	assert.equal(transitionStep.result.proposalId, operation.payload.proposalId);
	assert.equal(transitionStep.result.proposalPath, operation.payload.proposalPath);
	assert.equal(transitionStep.result.taskId, operation.payload.proposalTaskId);
	assert.equal(transitionStep.result.previousStatus, 'approved');
	assert.equal(transitionStep.result.nextStatus, 'applied');
	const serialized = JSON.stringify(transitionStep.result);
	assert.equal(serialized.includes(writebackBody), false);
	assert.equal(serialized.includes(fixture.vaultRoot), false);
	assert.equal(serialized.includes(confirmationToken), false);
	return transitionStep.result;
}

function assertBoundedTaskLinkStep(operation, fixture, confirmationToken, writebackBody) {
	const taskStep = operation.completed_steps.find((step) => step.name === 'link_task');
	assert.ok(taskStep);
	assert.ok(taskStep.result);
	assert.deepEqual(Object.keys(taskStep.result).sort(), TASK_LINK_RECEIPT_KEYS);
	assert.equal(taskStep.result.taskPath, operation.payload.taskPath);
	assert.equal(typeof taskStep.result.targetReferenceAdded, 'boolean');
	assert.equal(typeof taskStep.result.proposalReferenceAdded, 'boolean');
	const serialized = JSON.stringify(taskStep.result);
	assert.equal(serialized.includes(writebackBody), false);
	assert.equal(serialized.includes(fixture.vaultRoot), false);
	assert.equal(serialized.includes(confirmationToken), false);
	return taskStep.result;
}

function undecoratedResult(result) {
	const {
		schema_version: _schemaVersion,
		tool: _tool,
		...value
	} = result.structuredContent || {};
	return value;
}

function createDirectServiceFixture(t, overrides = {}) {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-writeback-service-'));
	t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
	const journal = new NodeFileOperationJournal({ directory: path.join(tempRoot, 'operations') });
	const effects = {
		target: 0,
		proposal: 0,
		task: 0,
		audit: 0,
	};
	const auditReceipts = [];
	const committed = new Set();
	const approved = approvedProposalTransition({
		proposalPath: '00_tracekeeper/inbox/review_queue/service.md',
		proposalId: 'service-proposal',
		taskId: 'service-task',
		targetPath: '01_knowledge/memory/projects/demo/memory.md',
		writeback: '- Service writeback content.',
		operationId: 'service-approval-operation',
	});
	const payload = {
		schemaVersion: 1,
		proposalId: 'service-proposal',
		proposalPath: '00_tracekeeper/inbox/review_queue/service.md',
		proposalRevision: computeProposalRevision(approved.state),
		proposalContentHash: computeProposalContentHash(approved.state),
		proposalFileHash: 'service-proposal-file-hash',
		approvalOperationId: approved.receipt.operationId,
		targetPath: '01_knowledge/memory/projects/demo/memory.md',
		targetContentHash: 'service-target-content-hash',
		proposalTaskId: 'service-task',
		taskId: 'service-task',
		taskPath: '00_tracekeeper/work/tasks/service-task.md',
		taskContentHash: 'service-task-content-hash',
		taskLinkedContentHash: 'service-task-linked-content-hash',
		taskHadTargetReference: false,
		taskHadProposalReference: false,
		writebackContentHash: 'service-writeback-content-hash',
		writebackBlockHash: 'service-writeback-block-hash',
		writebackMarker: '^writeback-service-proposal',
		touchedNotes: [
			'01_knowledge/memory/projects/demo/memory.md',
			'00_tracekeeper/inbox/review_queue/service.md',
			'00_tracekeeper/work/tasks/service-task.md',
			'00_tracekeeper/control/agent_activity/index.md',
		],
		confirmationTokenHash: 'service-confirmation-token-hash',
		confirmationExpiresAt: '2026-07-30T00:01:00.000Z',
		activityPath: '00_tracekeeper/control/agent_activity/index.md',
		activityAgentId: 'service-test-agent',
		activitySessionId: 'service-test-session',
		activityClientName: 'service-test-client',
	};
	const transitionReceipt = transitionProposal(
		approved.state,
		{
			expectedRevision: payload.proposalRevision,
			expectedContentHash: payload.proposalContentHash,
			operationId: 'writeback-service-proposal',
			action: { kind: 'apply' },
		},
		{
			now: '2026-07-30T00:00:01.000Z',
			actor: 'service-test-agent',
			targetAllowed: () => true,
			targetExists: () => true,
		}
	).receipt;
	const taskLinkReceipt = {
		taskPath: payload.taskPath,
		targetReferenceAdded: true,
		proposalReferenceAdded: true,
	};
	const port = {
		async applyTarget(currentPayload, operationId) {
			if (!committed.has('target')) {
				committed.add('target');
				effects.target += 1;
			}
			await overrides.afterTargetEffect?.({ currentPayload, operationId });
		},
		async rollbackTarget(currentPayload, operationId) {
			if (committed.delete('target')) {
				effects.target -= 1;
			}
			await overrides.afterTargetRollbackEffect?.({ currentPayload, operationId });
		},
		async markProposalApplied(currentPayload, operationId) {
			await overrides.beforeProposalEffect?.({ currentPayload, operationId });
			if (!committed.has('proposal')) {
				committed.add('proposal');
				effects.proposal += 1;
			}
			await overrides.afterProposalEffect?.({ currentPayload, operationId });
			return transitionReceipt;
		},
		async linkTask(currentPayload, operationId) {
			if (!committed.has('task')) {
				committed.add('task');
				effects.task += 1;
			}
			await overrides.afterTaskEffect?.({ currentPayload, operationId });
			return taskLinkReceipt;
		},
		async rollbackTask(currentPayload, operationId, receipt) {
			assert.deepEqual(receipt, taskLinkReceipt);
			await overrides.beforeTaskRollbackEffect?.({ currentPayload, operationId, receipt });
			if (committed.delete('task')) {
				effects.task -= 1;
			}
			await overrides.afterTaskRollbackEffect?.({ currentPayload, operationId, receipt });
		},
		async appendAgentActivity(currentPayload, operationId, receipt) {
			auditReceipts.push(receipt);
			if (!committed.has('audit')) {
				committed.add('audit');
				effects.audit += 1;
			}
			await overrides.afterAuditEffect?.({ currentPayload, operationId, receipt });
		},
	};
	const command = {
		operationId: 'writeback-service-proposal',
		idempotencyKey: 'apply-approved-writeback:service-proposal',
		approvalStatus: 'approved',
		payload,
	};
	return {
		journal,
		effects,
		auditReceipts,
		command,
		taskLinkReceipt,
		transitionReceipt,
		service() {
			return new ApplyApprovedWritebackService({ journal, port });
		},
	};
}

test('dry-run returns a bounded opaque confirmation token', async (t) => {
	const fixture = createFixture(t);
	const result = await preview(fixture);
	assert.equal(result.isError, false);
	assert.equal(typeof result.structuredContent?.confirmation_token, 'string');
	assert.ok(result.structuredContent.confirmation_token.length >= 32);
	assert.equal(typeof result.structuredContent?.confirmation_expires_at, 'string');
	assert.equal(result.structuredContent.confirmation_token.includes('Atomic writeback content'), false);
});

test('dry-run rejects an approved proposal without a committed approval receipt', async (t) => {
	const fixture = createFixture(t, { includeApprovalReceipt: false });
	const result = await preview(fixture);
	assertRejectedWithoutWrite(fixture, result);
	assert.match(
		String(result.structuredContent?.error || ''),
		/approval operation|approval transition|receipt/i
	);
});

test('non-dry-run apply requires a confirmation token before every write', async (t) => {
	const fixture = createFixture(t);
	const result = await callTool(
		'tracekeeper.apply_approved_writeback',
		{ proposal_path: PROPOSAL_PATH, task_id: 'atomic-task' },
		fixture.context
	);
	assertRejectedWithoutWrite(fixture, result);
});

test('apply rejects a tampered confirmation token before every write', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
	const result = await apply(fixture, tampered);
	assertRejectedWithoutWrite(fixture, result);
});

test('apply rejects a confirmation token with non-canonical trailing input', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	const result = await apply(fixture, `${tokenFrom(previewResult)}!`);
	assertRejectedWithoutWrite(fixture, result);
});

test('apply rejects an expired confirmation token before every write', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	fixture.setNow(Date.parse('2026-07-30T00:02:00.000Z'));
	const result = await apply(fixture, tokenFrom(previewResult));
	assertRejectedWithoutWrite(fixture, result);
});

test('authenticated journal payload tampering is rejected before every write', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'apply_target') {
			throw new Error('create a recoverable journal before the target effect');
		}
	};
	const interrupted = await apply(fixture, token);
	assert.equal(interrupted.isError, true);
	const tampered = rawOperationRecord(fixture);
	const ciphertext = tampered.payload_encrypted.ciphertext;
	tampered.payload_encrypted.ciphertext = `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`;
	writeRawOperationRecord(fixture, tampered);

	delete fixture.context.operationFailureInjection;
	const replay = await apply(fixture, token);
	assertRejectedWithoutWrite(fixture, replay);
	assert.equal(rawOperationRecord(fixture).payload_encrypted.ciphertext, tampered.payload_encrypted.ciphertext);
});

for (const row of [
	{
		name: 'approval status',
		mutate(fixture) {
			fixture.write(PROPOSAL_PATH, proposalText({
				fields: { approval_status: 'revision_requested', status: 'revision_requested' },
			}));
		},
	},
	{
		name: 'target path',
		targetPaths: [TARGET_PATH, '01_knowledge/wiki/other.md'],
		mutate(fixture) {
			fixture.write('01_knowledge/wiki/other.md', '# Other\n');
			fixture.write(PROPOSAL_PATH, proposalText({
				fields: { target_note: '01_knowledge/wiki/other.md' },
			}));
		},
	},
	{
		name: 'writeback body',
		mutate(fixture) {
			fixture.write(PROPOSAL_PATH, proposalText({ writeback: '- Replaced after preview.' }));
		},
	},
	{
		name: 'proposal id',
		mutate(fixture) {
			fixture.write(PROPOSAL_PATH, proposalText({
				fields: { proposal_id: 'different-proposal' },
			}));
		},
	},
	{
		name: 'task identity and touched-note set',
		mutate(fixture) {
			fixture.write('00_tracekeeper/work/tasks/other-task.md', '# Other Task\n');
			fixture.write(PROPOSAL_PATH, proposalText({
				fields: { task_id: 'other-task' },
			}));
		},
	},
]) {
	test(`apply rejects ${row.name} drift after preview before every write`, async (t) => {
		const fixture = createFixture(t);
		const previewResult = await preview(fixture);
		row.mutate(fixture);
		const result = await apply(fixture, tokenFrom(previewResult));
		assertRejectedWithoutWrite(fixture, result, row.targetPaths || [fixture.targetPath]);
	});
}

test('apply rejects target version drift after preview before every write', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	fixture.write(TARGET_PATH, '# Demo Memory\n\nChanged after preview.\n');
	const result = await apply(fixture, tokenFrom(previewResult));
	assertRejectedWithoutWrite(fixture, result);
	assert.match(fixture.read(TARGET_PATH), /Changed after preview/);
});

test('apply rejects task participation drift after preview before every write', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	fs.unlinkSync(fixture.absolute(TASK_PATH));
	const result = await apply(fixture, tokenFrom(previewResult));
	assertRejectedWithoutWrite(fixture, result);
});

test('apply revalidates proposal immediately before the target write', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'apply_target') {
			fixture.write(PROPOSAL_PATH, proposalText({ writeback: '- Changed at the durable boundary.' }));
		}
	};
	const result = await apply(fixture, tokenFrom(previewResult));
	assertRejectedWithoutWrite(fixture, result);
});

test('apply revalidates target immediately before the target write', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'apply_target') {
			fixture.write(TARGET_PATH, '# Demo Memory\n\nChanged at the durable boundary.\n');
		}
	};
	const result = await apply(fixture, tokenFrom(previewResult));
	assertRejectedWithoutWrite(fixture, result);
	assert.match(fixture.read(TARGET_PATH), /Changed at the durable boundary/);
});

test('proposal drift after the target effect is compensated and becomes a terminal conflict', async (t) => {
	const fixture = createFixture(t);
	const originalTarget = fixture.read(TARGET_PATH);
	const originalTask = fixture.read(TASK_PATH);
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'mark_proposal_applied') {
			fixture.write(
				PROPOSAL_PATH,
				proposalText({ writeback: '- Proposal drift after the target effect.' })
			);
		}
	};
	const result = await apply(fixture, token);
	assert.equal(result.isError, true);
	assert.match(String(result.structuredContent?.error || ''), /conflict|changed/i);
	assert.equal(fixture.read(TARGET_PATH), originalTarget);
	assert.equal(fixture.read(TASK_PATH), originalTask);
	assert.match(fixture.read(PROPOSAL_PATH), /Proposal drift after the target effect/);
	assert.match(fixture.read(PROPOSAL_PATH), /approval_status: approved/);
	const conflicted = await operationRecord(fixture);
	assert.equal(conflicted.status, 'conflicted');
	assert.deepEqual(conflicted.completed_steps.map((step) => step.name), [
		'apply_target',
		'link_task',
	]);
	const taskReceipt = assertBoundedTaskLinkStep(
		conflicted,
		fixture,
		token,
		DEFAULT_WRITEBACK
	);
	assert.equal(taskReceipt.targetReferenceAdded, true);
	assert.equal(taskReceipt.proposalReferenceAdded, true);
	delete fixture.context.operationFailureInjection;
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, fixture.context),
		{ recovered: [], failed: [], skipped: [] }
	);
	assert.equal(fixture.read(TARGET_PATH), originalTarget);
	assert.equal(fixture.read(TASK_PATH), originalTask);
});

test('proposal drift preserves preexisting stable task references while compensating the added link', async (t) => {
	const originalTask = [
		'---',
		'type: agent-task',
		'task_id: atomic-task',
		'status: active',
		`memory_writes: 00_tracekeeper/work/sessions/atomic-task.md`,
		'proposal_ids: atomic-proposal',
		`proposal_paths: ${PROPOSAL_PATH}`,
		'---',
		'',
		'# Atomic Task',
		'',
	].join('\n');
	const fixture = createFixture(t, { taskText: originalTask });
	const originalTarget = fixture.read(TARGET_PATH);
	const previewResult = await preview(fixture);
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'mark_proposal_applied') {
			fixture.write(
				PROPOSAL_PATH,
				proposalText({ writeback: '- Proposal drift with existing task references.' })
			);
		}
	};
	const result = await apply(fixture, tokenFrom(previewResult));
	assert.equal(result.isError, true);
	assert.equal(fixture.read(TARGET_PATH), originalTarget);
	assert.equal(fixture.read(TASK_PATH), originalTask);
	assert.match(fixture.read(PROPOSAL_PATH), /approval_status: approved/);
	const conflicted = await operationRecord(fixture);
	assert.equal(conflicted.status, 'conflicted');
	const receipt = assertBoundedTaskLinkStep(
		conflicted,
		fixture,
		tokenFrom(previewResult),
		DEFAULT_WRITEBACK
	);
	assert.equal(receipt.targetReferenceAdded, true);
	assert.equal(receipt.proposalReferenceAdded, false);
});

test('proposal drift compensates noncanonical task-list formatting without dropping prior references', async (t) => {
	const sessionPath = '00_tracekeeper/work/sessions/atomic-task.md';
	const originalTask = [
		'---',
		'type: agent-task',
		'task_id: atomic-task',
		'status: active',
		`memory_writes: [${JSON.stringify(sessionPath)}]`,
		`proposals: [${JSON.stringify(PROPOSAL_PATH)}]`,
		'---',
		'',
		'# Atomic Task with list formatting',
		'',
	].join('\n');
	const fixture = createFixture(t, { taskText: originalTask });
	const originalTarget = fixture.read(TARGET_PATH);
	const previewResult = await preview(fixture);
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'mark_proposal_applied') {
			fixture.write(
				PROPOSAL_PATH,
				proposalText({ writeback: '- Proposal drift with list-formatted task references.' })
			);
		}
	};
	const result = await apply(fixture, tokenFrom(previewResult));
	assert.equal(result.isError, true);
	assert.equal(fixture.read(TARGET_PATH), originalTarget);
	const compensatedTask = fixture.read(TASK_PATH);
	assert.equal(compensatedTask.includes(TARGET_PATH), false);
	assert.equal(countOccurrences(compensatedTask, sessionPath), 1);
	assert.equal(countOccurrences(compensatedTask, PROPOSAL_PATH), 1);
	assert.match(compensatedTask, /# Atomic Task with list formatting/);
	assert.match(fixture.read(PROPOSAL_PATH), /approval_status: approved/);
	assert.equal((await operationRecord(fixture)).status, 'conflicted');
});

test('task drift at the link boundary is not merged into the changed task', async (t) => {
	const fixture = createFixture(t);
	const originalTarget = fixture.read(TARGET_PATH);
	const originalProposal = fixture.read(PROPOSAL_PATH);
	const previewResult = await preview(fixture);
	const changedTask = [
		'---',
		'type: agent-task',
		'task_id: atomic-task',
		'status: active',
		'owner_edit: preserved',
		'---',
		'',
		'# Atomic Task changed before link',
		'',
	].join('\n');
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'link_task') {
			fixture.write(TASK_PATH, changedTask);
		}
	};
	const result = await apply(fixture, tokenFrom(previewResult));
	assert.equal(result.isError, true);
	assert.match(String(result.structuredContent?.error || ''), /task|conflict|changed/i);
	assert.equal(fixture.read(TASK_PATH), changedTask);
	assert.equal(fixture.read(TARGET_PATH), originalTarget);
	assert.equal(fixture.read(PROPOSAL_PATH), originalProposal);
	assert.match(fixture.read(PROPOSAL_PATH), /approval_status: approved/);
	assert.equal(fixture.read(TASK_PATH).includes(TARGET_PATH), false);
	assert.equal(fixture.read(TASK_PATH).includes(PROPOSAL_PATH), false);
	const conflicted = await operationRecord(fixture);
	assert.equal(conflicted.status, 'conflicted');
	assert.deepEqual(conflicted.completed_steps.map((step) => step.name), ['apply_target']);
	delete fixture.context.operationFailureInjection;
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, fixture.context),
		{ recovered: [], failed: [], skipped: [] }
	);
	assert.equal(fixture.read(TARGET_PATH), originalTarget);
	assert.equal(fixture.read(PROPOSAL_PATH), originalProposal);
	assert.equal(fixture.read(TASK_PATH), changedTask);
});

test('a tampered journal task-link receipt is replaced by the authenticated progress anchor', async (t) => {
	const fixture = createFixture(t);
	const originalTarget = fixture.read(TARGET_PATH);
	const originalProposal = fixture.read(PROPOSAL_PATH);
	const originalTask = fixture.read(TASK_PATH);
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	let injected = false;
	fixture.context.operationFailureInjection = (context) => {
		if (!injected && context.phase === 'before_step' && context.stepName === 'mark_proposal_applied') {
			injected = true;
			throw new Error('interrupt before proposal apply');
		}
	};

	const interrupted = await apply(fixture, token);
	assert.equal(interrupted.isError, true);
	const failed = await operationRecord(fixture);
	assert.equal(failed.status, 'failed');
	assert.deepEqual(failed.completed_steps.map((step) => step.name), [
		'apply_target',
		'link_task',
	]);
	assertBoundedTaskLinkStep(failed, fixture, token, DEFAULT_WRITEBACK);
	const rawFailed = rawOperationRecord(fixture);
	const taskStep = rawFailed.completed_steps.find((step) => step.name === 'link_task');
	taskStep.result.proposalReferenceAdded = 'tampered';
	writeRawOperationRecord(fixture, rawFailed);

	delete fixture.context.operationFailureInjection;
	const recovery = await recoverPendingOperations(fixture.vaultRoot, fixture.context);
	assert.equal(recovery.recovered.length, 1);
	assert.equal(recovery.skipped.length, 0);
	assert.equal(recovery.failed.length, 0);
	assert.equal(recovery.recovered[0], failed.operation_id);
	const completed = await operationRecord(fixture);
	assert.equal(completed.status, 'completed');
	assert.equal(countOccurrences(fixture.read(TARGET_PATH), MARKER), 1);
	assert.match(fixture.read(PROPOSAL_PATH), /approval_status: applied/);
	assert.match(fixture.read(TASK_PATH), /atomic-proposal/);
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, fixture.context),
		{ recovered: [], failed: [], skipped: [] }
	);
});

test('a fresh preview supersedes a conflicted stale operation without retrying it during recovery', async (t) => {
	const fixture = createFixture(t);
	const firstPreview = await preview(fixture);
	let injected = false;
	fixture.context.operationFailureInjection = (context) => {
		if (!injected && context.phase === 'before_step' && context.stepName === 'apply_target') {
			injected = true;
			fixture.write(
				PROPOSAL_PATH,
				proposalText({ writeback: '- Re-approved content after the stale preview.' })
			);
		}
	};
	const stale = await apply(fixture, tokenFrom(firstPreview));
	assertRejectedWithoutWrite(fixture, stale);
	const staleOperation = await operationRecord(fixture);
	assert.equal(staleOperation.status, 'conflicted');

	delete fixture.context.operationFailureInjection;
	const secondPreview = await preview(fixture);
	assert.notEqual(tokenFrom(secondPreview), tokenFrom(firstPreview));
	const applied = await apply(fixture, tokenFrom(secondPreview));
	assert.equal(applied.isError, false);
	assert.match(fixture.read(TARGET_PATH), /Re-approved content after the stale preview/);
	assert.equal(countOccurrences(fixture.read(TARGET_PATH), MARKER), 1);
	const records = await operationRecords(fixture);
	assert.equal(records.length, 2);
	assert.deepEqual(
		records.map((record) => record.status).sort(),
		['completed', 'conflicted']
	);
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, fixture.context),
		{ recovered: [], failed: [], skipped: [] }
	);
	assert.equal(
		(await operationRecords(fixture)).find(
			(record) => record.operation_id === staleOperation.operation_id
		).status,
		'conflicted'
	);
	assert.equal(countOccurrences(fixture.read(TARGET_PATH), MARKER), 1);
});

test('apply rejects a changed task argument bound to the preview operation', async (t) => {
	const fixture = createFixture(t);
	fixture.write('00_tracekeeper/work/tasks/other-task.md', '# Other Task\n');
	const previewResult = await preview(fixture);
	const result = await apply(fixture, tokenFrom(previewResult), { task_id: 'other-task' });
	assertRejectedWithoutWrite(fixture, result);
});

test('confirmation token cannot be replayed for another proposal', async (t) => {
	const fixture = createFixture(t);
	const secondPath = '00_tracekeeper/inbox/review_queue/second-writeback.md';
	fixture.write(secondPath, proposalText({
		path: secondPath,
		fields: { proposal_id: 'second-proposal' },
		writeback: '- Second writeback content.',
	}));
	const previewResult = await preview(fixture);
	const result = await callTool(
		'tracekeeper.apply_approved_writeback',
		{
			proposal_path: secondPath,
			task_id: 'atomic-task',
			confirmation_token: tokenFrom(previewResult),
		},
		fixture.context
	);
	assertRejectedWithoutWrite(fixture, result);
});

test('writeback target policy is a positive Memory or Wiki allowlist', async (t) => {
	const outsideTarget = '05_misc/ordinary-note.md';
	const fixture = createFixture(t, { targetPath: outsideTarget });
	const previewResult = await preview(fixture);
	assert.equal(previewResult.isError, true);
	assert.match(String(previewResult.structuredContent?.error || ''), /allowed target|memory|wiki|protected/i);
	assert.equal(fixture.read(outsideTarget).includes('^writeback-'), false);
});

test('legacy missing wiki proposal defaults to create_wiki_note', async (t) => {
	const wikiPath = '01_knowledge/wiki/legacy-missing-wiki-note.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			fields: {
				target_note: wikiPath,
			},
		})
	);
	const dryRun = await preview(fixture);
	assert.equal(dryRun.isError, false, JSON.stringify(dryRun.structuredContent));
	assertWikiCreatePreview(dryRun.structuredContent.writeback_preview);
	const applied = await apply(fixture, tokenFrom(dryRun));
	assert.equal(applied.isError, false, JSON.stringify(applied.structuredContent));
	assert.equal(countOccurrences(fixture.read(wikiPath), `<!-- writeback operation: writeback-`), 1);
	assert.ok(fixture.read(wikiPath).includes(MARKER));
});

test('legacy existing wiki proposal still appends', async (t) => {
	const wikiPath = '01_knowledge/wiki/legacy-existing-wiki.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			fields: {
				target_note: wikiPath,
			},
		})
	);
	const dryRun = await preview(fixture);
	assert.equal(dryRun.isError, false, JSON.stringify(dryRun.structuredContent));
	assert.ok(dryRun.structuredContent.writeback_preview.includes(`## Approved Writeback: atomic-proposal`));
	const applied = await apply(fixture, tokenFrom(dryRun));
	assert.equal(applied.isError, false, JSON.stringify(applied.structuredContent));
	assert.equal(countOccurrences(fixture.read(wikiPath), `## Approved Writeback: atomic-proposal`), 1);
});

test('legacy existing wiki proposal with claim_key still appends', async (t) => {
	const wikiPath = '01_knowledge/wiki/legacy-claim-key-existing.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			fields: {
				target_note: wikiPath,
				claim_key: 'legacy-wiki-claim',
			},
		})
	);
	const dryRun = await preview(fixture);
	assert.equal(dryRun.isError, false, JSON.stringify(dryRun.structuredContent));
	assert.ok(dryRun.structuredContent.writeback_preview.includes(`## Approved Writeback: atomic-proposal`));
	const applied = await apply(fixture, tokenFrom(dryRun));
	assert.equal(applied.isError, false, JSON.stringify(applied.structuredContent));
	assert.equal(countOccurrences(fixture.read(wikiPath), `## Approved Writeback: atomic-proposal`), 1);
});

test('legacy missing wiki proposal with claim_key creates missing wiki file', async (t) => {
	const wikiPath = '01_knowledge/wiki/legacy-claim-key-missing.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			fields: {
				target_note: wikiPath,
				claim_key: 'legacy-wiki-claim-missing',
			},
		})
	);
	const dryRun = await preview(fixture);
	assert.equal(dryRun.isError, false, JSON.stringify(dryRun.structuredContent));
	assertWikiCreatePreview(dryRun.structuredContent.writeback_preview);
	const applied = await apply(fixture, tokenFrom(dryRun));
	assert.equal(applied.isError, false, JSON.stringify(applied.structuredContent));
	assert.equal(countOccurrences(fixture.read(wikiPath), `<!-- writeback operation: writeback-`), 1);
	assert.ok(fixture.read(wikiPath).includes(MARKER));
});

test('explicit create_wiki_note rejects when target exists', async (t) => {
	const wikiPath = '01_knowledge/wiki/existing-wiki-fence.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			fields: {
				target_note: wikiPath,
				writeback_effect: 'create_wiki_note',
			},
		})
	);
	fixture.write(wikiPath, '# Existing wiki note\n');
	const dryRun = await preview(fixture);
	assert.equal(dryRun.isError, true);
	assert.match(
		String(dryRun.structuredContent?.error || ''),
		/create_wiki_note target already exists|create wiki note writeback requires a missing target/i
	);
});

test('review queue does not advertise an occupied create_wiki_note target as ready', async (t) => {
	const wikiPath = '01_knowledge/wiki/occupied-wiki-listing.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		proposalFields: {
			writeback_effect: 'create_wiki_note',
		},
	});
	const result = await callTool(
		'tracekeeper.review_queue',
		{ action: 'list_approved' },
		fixture.context
	);
	assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
	const entry = result.structuredContent.entries.find(
		(candidate) => candidate.proposal_id === 'atomic-proposal'
	);
	assert.ok(entry, 'approved proposal should be present in the review queue');
	assert.equal(entry.ready_to_apply, false);
	assert.match(String(entry.blocker || ''), /create_wiki_note.*already exists/i);
});

test('review queue advertises a missing create_wiki_note target as ready', async (t) => {
	const wikiPath = '01_knowledge/wiki/missing-wiki-listing.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
		proposalFields: {
			writeback_effect: 'create_wiki_note',
		},
	});
	const result = await callTool(
		'tracekeeper.review_queue',
		{ action: 'list_approved' },
		fixture.context
	);
	assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
	const entry = result.structuredContent.entries.find(
		(candidate) => candidate.proposal_id === 'atomic-proposal'
	);
	assert.ok(entry, 'approved proposal should be present in the review queue');
	assert.equal(entry.ready_to_apply, true);
	assert.equal(entry.blocker, null);
});

test('explicit append rejects when wiki target is missing', async (t) => {
	const wikiPath = '01_knowledge/wiki/missing-wiki-append.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			fields: {
				target_note: wikiPath,
				writeback_effect: 'append',
			},
		})
	);
	const dryRun = await preview(fixture);
	assertRejectedWithoutWrite(fixture, dryRun, [wikiPath]);
	assert.match(
		String(dryRun.structuredContent?.error || ''),
		/does not exist|does not.*exist/i
	);
});

test('explicit create_wiki_note succeeds when wiki target is missing', async (t) => {
	const wikiPath = '01_knowledge/wiki/missing-wiki-create.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			fields: {
				target_note: wikiPath,
				writeback_effect: 'create_wiki_note',
			},
		})
	);
	const dryRun = await preview(fixture);
	assert.equal(dryRun.isError, false, JSON.stringify(dryRun.structuredContent));
	const applied = await apply(fixture, tokenFrom(dryRun));
	assert.equal(applied.isError, false, JSON.stringify(applied.structuredContent));
	assert.equal(countOccurrences(fixture.read(wikiPath), `<!-- writeback operation: writeback-`), 1);
	assert.ok(fixture.read(wikiPath).includes(MARKER));
	assert.equal(countOccurrences(fixture.readAudit(), 'action: wiki_note.create'), 1);
});

test('competing create_wiki_note previews cannot share or compensate target ownership', async (t) => {
	const wikiPath = '01_knowledge/wiki/competing-create-wiki.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			fields: {
				target_note: wikiPath,
				writeback_effect: 'create_wiki_note',
			},
		})
	);
	const firstPreview = await preview(fixture);
	const competingPreview = await preview(fixture);
	assert.equal(firstPreview.isError, false, JSON.stringify(firstPreview.structuredContent));
	assert.equal(competingPreview.isError, false, JSON.stringify(competingPreview.structuredContent));
	assert.notEqual(tokenFrom(firstPreview), tokenFrom(competingPreview));
	assert.notEqual(
		firstPreview.structuredContent.writeback_preview,
		competingPreview.structuredContent.writeback_preview
	);

	const firstApplied = await apply(fixture, tokenFrom(firstPreview));
	assert.equal(firstApplied.isError, false, JSON.stringify(firstApplied.structuredContent));
	const ownedTarget = fixture.read(wikiPath);
	assert.equal(ownedTarget, firstPreview.structuredContent.writeback_preview);

	const competingApply = await apply(fixture, tokenFrom(competingPreview));
	assert.equal(competingApply.isError, true);
	assert.match(
		String(competingApply.structuredContent?.error || ''),
		/already exists|stale|conflict|changed|is applied/i
	);
	assert.equal(fixture.read(wikiPath), ownedTarget);
	assert.equal(countOccurrences(ownedTarget, '<!-- writeback operation: writeback-'), 1);
	assert.equal(countOccurrences(ownedTarget, MARKER), 1);
});

test('unknown writeback_effect is fail-closed', async (t) => {
	const wikiPath = '01_knowledge/wiki/unknown-effect-wiki.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			includeApprovalReceipt: false,
			fields: {
				target_note: wikiPath,
				writeback_effect: 'create-unknown',
			},
		})
	);
	const dryRun = await preview(fixture);
	assert.equal(dryRun.isError, true);
	assert.match(String(dryRun.structuredContent?.error || ''), /unknown writeback_effect value/i);
});

test('non-string writeback_effect is fail-closed', async (t) => {
	const wikiPath = '01_knowledge/wiki/non-string-effect-wiki.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			includeApprovalReceipt: false,
			fields: {
				target_note: wikiPath,
				writeback_effect: ['append'],
			},
		})
	);
	const dryRun = await preview(fixture);
	assert.equal(dryRun.isError, true);
	assert.match(String(dryRun.structuredContent?.error || ''), /writeback_effect must be a string/i);
});

test('object writeback_effect is fail-closed', async (t) => {
	const wikiPath = '01_knowledge/wiki/object-effect-wiki.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			includeApprovalReceipt: false,
			fields: {
				target_note: wikiPath,
				writebackEffect: { mode: 'create_wiki_note' },
			},
		})
	);
	const dryRun = await preview(fixture);
	assert.equal(dryRun.isError, true);
	assert.match(String(dryRun.structuredContent?.error || ''), /writeback_effect must be a string/i);
});

test('conflicting writeback effect aliases are fail-closed', async (t) => {
	const wikiPath = '01_knowledge/wiki/alias-conflict-wiki.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			includeApprovalReceipt: false,
			fields: {
				target_note: wikiPath,
				writeback_effect: 'append',
				writebackEffect: 'create_wiki_note',
			},
		})
	);
	const dryRun = await preview(fixture);
	assert.equal(dryRun.isError, true);
	assert.match(String(dryRun.structuredContent?.error || ''), /Proposal writeback effect fields conflict/i);
});

test('create_wiki_note exact retry is deduplicated', async (t) => {
	const wikiPath = '01_knowledge/wiki/retry-wiki.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			fields: {
				target_note: wikiPath,
			},
			writeback: DEFAULT_WRITEBACK,
		})
	);
	const dryRun = await preview(fixture);
	const token = tokenFrom(dryRun);
	const first = await apply(fixture, token);
	const second = await apply(fixture, token);
	assert.equal(first.isError, false);
	assert.deepEqual(second.structuredContent, first.structuredContent);
	assert.equal(countOccurrences(fixture.readAudit(), 'action: wiki_note.create'), 1);
	assert.equal(countOccurrences(fixture.read(wikiPath), MARKER), 1);
});

test('create_wiki_note proposal conflict triggers exact-hash rollback', async (t) => {
	const wikiPath = '01_knowledge/wiki/rollback-wiki.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			fields: {
				target_note: wikiPath,
			},
		})
	);
	const dryRun = await preview(fixture);
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'mark_proposal_applied') {
			fixture.write(
				PROPOSAL_PATH,
				proposalText({
					writeback: 'Mutated proposal to force transition conflict.',
					fields: {
						target_note: wikiPath,
						writeback_effect: 'create_wiki_note',
					},
				})
			);
		}
	};
	const result = await apply(fixture, tokenFrom(dryRun));
	assert.equal(result.isError, true);
	assert.equal(fs.existsSync(fixture.absolute(wikiPath)), false);
	assert.equal((await operationRecord(fixture)).status, 'conflicted');
});

test('create_wiki_note compensation preserves a target changed after owned creation', async (t) => {
	const wikiPath = '01_knowledge/wiki/changed-owned-wiki.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			fields: {
				target_note: wikiPath,
				writeback_effect: 'create_wiki_note',
			},
		})
	);
	const originalTask = fixture.read(TASK_PATH);
	const dryRun = await preview(fixture);
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'mark_proposal_applied') {
			fixture.write(wikiPath, `${fixture.read(wikiPath)}\nUser change after creation.\n`);
			fixture.write(
				PROPOSAL_PATH,
				proposalText({
					writeback: 'Mutated proposal after the owned Wiki target changed.',
					fields: {
						target_note: wikiPath,
						writeback_effect: 'create_wiki_note',
					},
				})
			);
		}
	};
	const result = await apply(fixture, tokenFrom(dryRun));
	assert.equal(result.isError, true);
	assert.match(String(result.structuredContent?.error || ''), /conflict|compensat|changed/i);
	assert.match(fixture.read(wikiPath), /User change after creation/);
	assert.equal(fixture.read(TASK_PATH), originalTask);
	assert.match(fixture.read(PROPOSAL_PATH), /approval_status: approved/);
	assert.equal((await operationRecord(fixture)).status, 'conflicted');
});

test('create_wiki_note refuses to mark the proposal applied when its owned target disappears', async (t) => {
	const wikiPath = '01_knowledge/wiki/disappearing-created-wiki.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			fields: {
				target_note: wikiPath,
				writeback_effect: 'create_wiki_note',
			},
		})
	);
	const originalTask = fixture.read(TASK_PATH);
	const dryRun = await preview(fixture);
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'mark_proposal_applied') {
			fs.unlinkSync(fixture.absolute(wikiPath));
		}
	};
	const result = await apply(fixture, tokenFrom(dryRun));
	assert.equal(result.isError, true);
	assert.match(
		String(result.structuredContent?.error || ''),
		/not created|does not exist|unavailable|conflict|disappeared/i
	);
	assert.equal(fs.existsSync(fixture.absolute(wikiPath)), false);
	assert.equal(fixture.read(TASK_PATH), originalTask);
	assert.match(fixture.read(PROPOSAL_PATH), /approval_status: approved/);
	assert.equal((await operationRecord(fixture)).status, 'conflicted');
});

test('create_wiki_note recovery resumes without duplicating the target', async (t) => {
	const wikiPath = '01_knowledge/wiki/recovery-wiki.md';
	const fixture = createFixture(t, {
		targetPath: wikiPath,
		skipTarget: true,
	});
	fixture.write(
		PROPOSAL_PATH,
		proposalText({
			fields: {
				target_note: wikiPath,
			},
		})
	);
	const dryRun = await preview(fixture);
	const token = tokenFrom(dryRun);
	let interrupted = false;
	fixture.context.operationFailureInjection = (context) => {
		if (!interrupted && context.phase === 'after_step' && context.stepName === 'apply_target') {
			interrupted = true;
			throw new Error('interrupt after wiki create');
		}
	};
	const interruptedResult = await apply(fixture, token);
	assert.equal(interruptedResult.isError, true);
	const beforeRecovery = fixture.read(wikiPath);
	delete fixture.context.operationFailureInjection;
	const recovery = await recoverPendingOperations(fixture.vaultRoot, fixture.context);
	assert.equal(recovery.recovered.length, 1);
	assert.equal(recovery.failed.length, 0);
	assert.equal(recovery.skipped.length, 0);
	assert.equal(fixture.read(wikiPath), beforeRecovery);
	const completed = await operationRecord(fixture);
	assert.equal(completed.status, 'completed');
});

test('exact apply retry returns one receipt and one durable effect', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	const first = await apply(fixture, token);
	const second = await apply(fixture, token);
	assert.equal(first.isError, false);
	assert.deepEqual(second.structuredContent, first.structuredContent);
	assert.equal(fixture.read(TARGET_PATH).split(MARKER).length - 1, 1);
	const operation = await operationRecord(fixture);
	const taskReceipt = assertBoundedTaskLinkStep(
		operation,
		fixture,
		token,
		DEFAULT_WRITEBACK
	);
	assert.equal(taskReceipt.targetReferenceAdded, true);
	assert.equal(taskReceipt.proposalReferenceAdded, true);
	assertBoundedTransitionStep(
		operation,
		fixture,
		token,
		DEFAULT_WRITEBACK
	);
});

test('a completed exact retry uses the journaled token digest across confirmation-secret rotation', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	const first = await apply(fixture, token);
	assert.equal(first.isError, false);
	fixture.context.writebackConfirmationSecret = 'rotated-writeback-confirmation-secret-32-bytes';
	const replay = await apply(fixture, token);
	assert.equal(replay.isError, false);
	assert.deepEqual(replay.structuredContent, first.structuredContent);
	assert.equal(countOccurrences(fixture.read(TARGET_PATH), MARKER), 1);
});

test('completed operation rejects a changed confirmation token', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	const first = await apply(fixture, token);
	assert.equal(first.isError, false);
	const changedToken = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
	const changed = await apply(fixture, changedToken);
	assert.equal(changed.isError, true);
	assert.match(String(changed.structuredContent?.error || ''), /confirmation|conflict|changed/i);
	assert.equal(fixture.read(TARGET_PATH).split(MARKER).length - 1, 1);
});

test('concurrent exact apply calls share one receipt and one durable effect', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	const [left, right] = await Promise.all([
		apply(fixture, token),
		apply(fixture, token),
	]);
	assert.equal(left.isError, false);
	assert.equal(right.isError, false);
	assert.deepEqual(left.structuredContent, right.structuredContent);
	assert.equal(countOccurrences(fixture.read(TARGET_PATH), MARKER), 1);
});

test('concurrent changed binding permits only the preview-bound operation', async (t) => {
	const fixture = createFixture(t);
	fixture.write('00_tracekeeper/work/tasks/other-task.md', '# Other Task\n');
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	const results = await Promise.all([
		apply(fixture, token),
		apply(fixture, token, { task_id: 'other-task' }),
	]);
	assert.equal(results[0].isError, false);
	assert.equal(results[1].isError, true);
	assert.match(
		String(results[1].structuredContent?.error || ''),
		/confirmation|conflict|changed/i
	);
	assert.equal(countOccurrences(fixture.read(TARGET_PATH), MARKER), 1);
});

for (const injection of [
	{ phase: 'before_step', stepName: 'apply_target' },
	{ phase: 'after_step', stepName: 'apply_target' },
	{ phase: 'before_step', stepName: 'link_task' },
	{ phase: 'after_step', stepName: 'link_task' },
	{ phase: 'before_step', stepName: 'mark_proposal_applied' },
	{ phase: 'after_step', stepName: 'mark_proposal_applied' },
	{ phase: 'before_step', stepName: 'append_agent_activity', activityPending: true },
	{ phase: 'after_step', stepName: 'append_agent_activity' },
	{ phase: 'before_finalize' },
]) {
	const label = injection.stepName
		? `${injection.phase} ${injection.stepName}`
		: injection.phase;
	test(`restart safely resumes an interruption ${label}`, async (t) => {
		const fixture = createFixture(t);
		const previewResult = await preview(fixture);
		const token = tokenFrom(previewResult);
		let injected = false;
		fixture.context.operationFailureInjection = (context) => {
			if (
				!injected
				&& context.phase === injection.phase
				&& context.stepName === injection.stepName
			) {
				injected = true;
				throw new Error(`simulated ${label}`);
			}
		};

		const interrupted = await apply(fixture, token);
		assert.equal(interrupted.isError, true);
		assert.equal(injected, true);
		const beforeRecovery = await operationRecord(fixture);
		if (injection.activityPending) {
			assert.equal(
				beforeRecovery.status,
				'activity_pending',
				'proposal-committed operation awaiting audit must have an explicit recovery state'
			);
		}

		delete fixture.context.operationFailureInjection;
		const recovery = await recoverPendingOperations(fixture.vaultRoot, fixture.context);
		assert.equal(recovery.failed.length, 0);
		assert.equal(recovery.skipped.length, 0);
		assert.equal(recovery.recovered.length, 1);

		const completed = await operationRecord(fixture);
		assert.equal(completed.status, 'completed');
		assert.deepEqual(completed.completed_steps.map((step) => step.name), [
			'apply_target',
			'link_task',
			'mark_proposal_applied',
			'append_agent_activity',
		]);
		assertBoundedTaskLinkStep(completed, fixture, token, DEFAULT_WRITEBACK);
		assertBoundedTransitionStep(completed, fixture, token, DEFAULT_WRITEBACK);
		assert.equal(countOccurrences(fixture.read(TARGET_PATH), MARKER), 1);
		assert.equal(countOccurrences(fixture.read(TASK_PATH), TARGET_PATH), 1);
		assert.equal(countOccurrences(fixture.read(TASK_PATH), PROPOSAL_PATH), 1);
		const auditText = fixture.readAudit();
		assert.equal(countOccurrences(auditText, `- operation_id: "${completed.operation_id}"`), 1);

		const replay = await apply(fixture, token);
		assert.equal(replay.isError, false);
		assert.deepEqual(undecoratedResult(replay), completed.result);
		assert.equal(countOccurrences(fixture.read(TARGET_PATH), MARKER), 1);
		assert.equal(countOccurrences(fixture.readAudit(), `- operation_id: "${completed.operation_id}"`), 1);
	});
}

test('a tampered journal proposal receipt is replaced by the authenticated progress anchor', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	let injected = false;
	fixture.context.operationFailureInjection = (context) => {
		if (!injected && context.phase === 'before_step' && context.stepName === 'append_agent_activity') {
			injected = true;
			throw new Error('interrupt before audit receipt validation');
		}
	};

	const interrupted = await apply(fixture, token);
	assert.equal(interrupted.isError, true);
	const pending = await operationRecord(fixture);
	assert.equal(pending.status, 'activity_pending');
	assertBoundedTaskLinkStep(pending, fixture, token, DEFAULT_WRITEBACK);
	assertBoundedTransitionStep(pending, fixture, token, DEFAULT_WRITEBACK);
	const rawPending = rawOperationRecord(fixture);
	const transitionStep = rawPending.completed_steps.find(
		(step) => step.name === 'mark_proposal_applied'
	);
	transitionStep.result.proposalId = 'tampered-proposal';
	writeRawOperationRecord(fixture, rawPending);

	delete fixture.context.operationFailureInjection;
	const recovery = await recoverPendingOperations(fixture.vaultRoot, fixture.context);
	assert.equal(recovery.recovered.length, 1);
	assert.equal(recovery.skipped.length, 0);
	assert.equal(recovery.failed.length, 0);
	assert.equal(recovery.recovered[0], pending.operation_id);
	const completed = await operationRecord(fixture);
	assert.equal(completed.status, 'completed');
	assert.equal(
		countOccurrences(
			fixture.readAudit(),
			`- operation_id: "${pending.operation_id}"`
		),
			1
	);
	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, fixture.context),
		{ recovered: [], failed: [], skipped: [] }
	);
});

test('activity_pending recovery uses the journaled transition receipt after proposal deletion', async (t) => {
	const secretBody = '- JOURNALED-AUDIT-RECEIPT-BODY';
	const fixture = createFixture(t, { writeback: secretBody });
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	let injected = false;
	fixture.context.operationFailureInjection = (context) => {
		if (!injected && context.phase === 'before_step' && context.stepName === 'append_agent_activity') {
			injected = true;
			throw new Error('interrupt before the dedicated audit append');
		}
	};
	const interrupted = await apply(fixture, token);
	assert.equal(interrupted.isError, true);
	assert.equal(injected, true);
	const pending = await operationRecord(fixture);
	assert.equal(pending.status, 'activity_pending');
	const pendingReceipt = assertBoundedTransitionStep(
		pending,
		fixture,
		token,
		secretBody
	);
	const pendingTaskReceipt = assertBoundedTaskLinkStep(
		pending,
		fixture,
		token,
		secretBody
	);

	fs.unlinkSync(fixture.absolute(PROPOSAL_PATH));
	delete fixture.context.operationFailureInjection;
	const recovery = await recoverPendingOperations(fixture.vaultRoot, fixture.context);
	assert.deepEqual(recovery, {
		recovered: [pending.operation_id],
		failed: [],
		skipped: [],
	});
	const completed = await operationRecord(fixture);
	assert.equal(completed.status, 'completed');
	assert.deepEqual(
		assertBoundedTransitionStep(completed, fixture, token, secretBody),
		pendingReceipt
	);
	assert.deepEqual(
		assertBoundedTaskLinkStep(completed, fixture, token, secretBody),
		pendingTaskReceipt
	);
	const auditText = fixture.readAudit();
	assert.equal(
		countOccurrences(auditText, `- operation_id: "${pending.operation_id}"`),
		1
	);
	assert.ok(auditText.includes(pendingReceipt.committedAt));
	assert.ok(auditText.includes(pendingReceipt.previousRevision));
	assert.ok(auditText.includes(pendingReceipt.committedRevision));
	assert.ok(auditText.includes(pendingReceipt.previousContentHash));
	assert.ok(auditText.includes(pendingReceipt.committedContentHash));
	assert.ok(auditText.includes(pending.payload.activityAgentId));

	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, fixture.context),
		{ recovered: [], failed: [], skipped: [] }
	);
	assert.equal(
		countOccurrences(
			fixture.readAudit(),
			`- operation_id: "${pending.operation_id}"`
		),
		1
	);
});

test('legacy body-bearing writeback recovery is quarantined once and removed from future recovery', async (t) => {
	const fixture = createFixture(t);
	const operationId = 'writeback-legacy-body-record';
	const idempotencyKey = 'apply-approved-writeback:legacy-body-record';
	const legacyBody = '- LEGACY-PRIVATE-WRITEBACK-BODY';
	const legacyPayload = {
		proposalId: 'legacy-proposal',
		proposalPath: PROPOSAL_PATH,
		targetPath: TARGET_PATH,
		writebackBlock: legacyBody,
	};
	fs.mkdirSync(fixture.absolute('00_tracekeeper/control/operations'), { recursive: true });
	writeRawOperationRecord(fixture, {
		operation_id: operationId,
		idempotency_key: idempotencyKey,
		payload_hash: computePayloadHash(legacyPayload),
		payload: legacyPayload,
		status: 'failed',
		created_at: APPROVAL_TIME,
		updated_at: APPROVAL_TIME,
		completed_steps: [],
		error: 'legacy interrupted writeback',
		failed_at: APPROVAL_TIME,
	});
	const operationPath = fixture.absolute(
		`00_tracekeeper/control/operations/${operationId}.json`
	);
	assert.ok(fs.readFileSync(operationPath, 'utf8').includes(legacyBody));

	const firstRecovery = await recoverPendingOperations(fixture.vaultRoot, fixture.context);
	assert.deepEqual(firstRecovery, {
		recovered: [],
		failed: [{
			operation_id: operationId,
			error: 'Incompatible writeback recovery record requires a fresh preview.',
		}],
		skipped: [],
	});
	const quarantined = JSON.parse(fs.readFileSync(operationPath, 'utf8'));
	assert.equal(quarantined.status, 'conflicted');
	assert.equal(Object.hasOwn(quarantined, 'payload'), false);
	assert.equal(JSON.stringify(quarantined).includes(legacyBody), false);
	assert.match(quarantined.error, /incompatible|fresh preview/i);

	assert.deepEqual(
		await recoverPendingOperations(fixture.vaultRoot, fixture.context),
		{ recovered: [], failed: [], skipped: [] }
	);
	assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(operationPath, 'utf8'))).includes(legacyBody), false);
});

test('target effect survives a crash before its journal checkpoint without duplication', async (t) => {
	let failAfterEffect = true;
	const fixture = createDirectServiceFixture(t, {
		afterTargetEffect() {
			if (failAfterEffect) {
				failAfterEffect = false;
				throw new Error('crash after target effect');
			}
		},
	});
	await assert.rejects(
		() => fixture.service().execute(fixture.command),
		/crash after target effect/
	);
	const failed = await fixture.journal.loadById(fixture.command.operationId);
	assert.equal(failed.status, 'failed');
	assert.deepEqual(failed.completed_steps, []);
	const result = await fixture.service().execute(fixture.command);
	assert.equal(result.status, 'applied');
	assert.deepEqual(fixture.effects, {
		target: 1,
		proposal: 1,
		task: 1,
		audit: 1,
	});
});

test('task effect ownership survives a pre-checkpoint crash and compensates a later proposal conflict', async (t) => {
	let failAfterTaskEffect = true;
	const fixture = createDirectServiceFixture(t, {
		afterTaskEffect() {
			if (failAfterTaskEffect) {
				failAfterTaskEffect = false;
				throw new Error('crash after task effect');
			}
		},
		beforeProposalEffect() {
			throw new OperationConflictError('proposal changed before apply');
		},
	});

	await assert.rejects(
		() => fixture.service().execute(fixture.command),
		/crash after task effect/
	);
	const failed = await fixture.journal.loadById(fixture.command.operationId);
	assert.equal(failed.status, 'failed');
	assert.deepEqual(failed.completed_steps.map((step) => step.name), ['apply_target']);
	assert.deepEqual(fixture.effects, {
		target: 1,
		proposal: 0,
		task: 1,
		audit: 0,
	});

	await assert.rejects(
		() => fixture.service().execute(fixture.command),
		/proposal changed before apply/
	);
	const conflicted = await fixture.journal.loadById(fixture.command.operationId);
	assert.equal(conflicted.status, 'conflicted');
	assert.deepEqual(conflicted.completed_steps.map((step) => step.name), [
		'apply_target',
		'link_task',
	]);
	const taskStep = conflicted.completed_steps.find((step) => step.name === 'link_task');
	assert.deepEqual(taskStep.result, fixture.taskLinkReceipt);
	assert.deepEqual(fixture.effects, {
		target: 0,
		proposal: 0,
		task: 0,
		audit: 0,
	});
});

test('proposal conflict still compensates the target when task compensation cannot be proven safe', async (t) => {
	const fixture = createDirectServiceFixture(t, {
		beforeProposalEffect() {
			throw new OperationConflictError('proposal changed before apply');
		},
		beforeTaskRollbackEffect() {
			throw new OperationConflictError('task changed before compensation');
		},
	});

	await assert.rejects(
		() => fixture.service().execute(fixture.command),
		/prior effects could not be safely compensated/
	);
	const conflicted = await fixture.journal.loadById(fixture.command.operationId);
	assert.equal(conflicted.status, 'conflicted');
	assert.deepEqual(conflicted.completed_steps.map((step) => step.name), [
		'apply_target',
		'link_task',
	]);
	assert.deepEqual(fixture.effects, {
		target: 0,
		proposal: 0,
		task: 1,
		audit: 0,
	});
});

test('Agent activity effect survives a crash before its checkpoint as activity_pending and appends once', async (t) => {
	let failAfterEffect = true;
	const fixture = createDirectServiceFixture(t, {
		afterAuditEffect() {
			if (failAfterEffect) {
				failAfterEffect = false;
				throw new Error('crash after audit effect');
			}
		},
	});
	await assert.rejects(
		() => fixture.service().execute(fixture.command),
		/crash after audit effect/
	);
	const pending = await fixture.journal.loadById(fixture.command.operationId);
	assert.equal(pending.status, 'activity_pending');
	assert.deepEqual(pending.completed_steps.map((step) => step.name), [
		'apply_target',
		'link_task',
		'mark_proposal_applied',
	]);
	const result = await fixture.service().execute(fixture.command);
	assert.equal(result.status, 'applied');
	assert.deepEqual(fixture.effects, {
		target: 1,
		proposal: 1,
		task: 1,
		audit: 1,
	});
	assert.equal(fixture.auditReceipts.length, 2);
	assert.deepEqual(fixture.auditReceipts[0], fixture.transitionReceipt);
	assert.deepEqual(fixture.auditReceipts[1], fixture.transitionReceipt);
});

test('failure after final persistence returns the exact completed receipt on retry', async (t) => {
	const fixture = createFixture(t);
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	let injected = false;
	fixture.context.operationFailureInjection = (context) => {
		if (!injected && context.phase === 'after_finalize') {
			injected = true;
			throw new Error('simulated after finalize');
		}
	};
	const interrupted = await apply(fixture, token);
	assert.equal(interrupted.isError, true);
	const completed = await operationRecord(fixture);
	assert.equal(completed.status, 'completed');
	delete fixture.context.operationFailureInjection;
	const replay = await apply(fixture, token);
	assert.equal(replay.isError, false);
	assert.deepEqual(undecoratedResult(replay), completed.result);
	assert.equal(countOccurrences(fixture.read(TARGET_PATH), MARKER), 1);
	assert.equal(countOccurrences(fixture.readAudit(), `- operation_id: "${completed.operation_id}"`), 1);
});

test('real absolute-path errors are bounded in the public result and operation journal', async (t) => {
	const secretBody = '- ABSOLUTE-PATH-ERROR-WRITEBACK-BODY';
	const fixture = createFixture(t, { writeback: secretBody });
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	const missingAbsolutePath = fixture.absolute('private/missing-writeback-input.md');
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'apply_target') {
			fs.readFileSync(missingAbsolutePath, 'utf8');
		}
	};
	const interrupted = await apply(fixture, token);
	assert.equal(interrupted.isError, true);
	assert.equal(
		interrupted.structuredContent?.error,
		'Approved writeback failed at a protected Vault boundary.'
	);
	const record = await operationRecord(fixture);
	assert.equal(record.status, 'failed');
	assert.equal(record.error.includes(fixture.vaultRoot), false);
	assert.equal(record.error.includes(missingAbsolutePath), false);
	const persisted = JSON.stringify(record);
	assert.equal(persisted.includes(fixture.vaultRoot), false);
	assert.equal(persisted.includes(missingAbsolutePath), false);
	assert.equal(persisted.includes(secretBody), false);
	assert.equal(persisted.includes(token), false);
	const publicAndAudit = JSON.stringify({
		result: interrupted.structuredContent,
		audit: fixture.readAudit(),
	});
	assert.equal(publicAndAudit.includes(fixture.vaultRoot), false);
	assert.equal(publicAndAudit.includes(missingAbsolutePath), false);
	assert.equal(publicAndAudit.includes(secretBody), false);
	assert.equal(publicAndAudit.includes(token), false);
});

test('journal, errors, and receipts do not expose writeback bodies or absolute paths', async (t) => {
	const secretBody = '- TOP-SECRET-WRITEBACK-BODY';
	const fixture = createFixture(t, { writeback: secretBody });
	const previewResult = await preview(fixture);
	const token = tokenFrom(previewResult);
	fixture.context.operationFailureInjection = (context) => {
		if (context.phase === 'before_step' && context.stepName === 'append_agent_activity') {
			throw new Error('bounded audit interruption');
		}
	};
	const interrupted = await apply(fixture, token);
	const record = await operationRecord(fixture);
	assertBoundedTaskLinkStep(record, fixture, token, secretBody);
	assertBoundedTransitionStep(record, fixture, token, secretBody);
	const exposed = JSON.stringify({
		error: interrupted.structuredContent?.error,
		result: interrupted.structuredContent,
		audit: fixture.readAudit(),
	});
	assert.equal(exposed.includes('TOP-SECRET-WRITEBACK-BODY'), false);
	assert.equal(exposed.includes(fixture.vaultRoot), false);
	assert.equal(exposed.includes(token), false);
	assert.equal(JSON.stringify(record).includes('TOP-SECRET-WRITEBACK-BODY'), false);
	assert.equal(JSON.stringify(record).includes(fixture.vaultRoot), false);
	assert.equal(JSON.stringify(record).includes(token), false);
});
