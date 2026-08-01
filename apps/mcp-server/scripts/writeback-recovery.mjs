#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { callTool, recoverPendingOperations } = require('@tracekeeper/mcp-runtime');
const {
	computeProposalContentHash,
	computeProposalRevision,
	transitionProposal,
} = require('@tracekeeper/core');

const TARGET_PATH = '01_knowledge/memory/projects/demo/memory.md';
const TASK_PATH = '00_tracekeeper/work/tasks/recovery-task.md';
const PROPOSAL_PATH = '00_tracekeeper/inbox/review_queue/recovery-writeback.md';
const PROPOSAL_ID = 'recovery-proposal';
const TASK_ID = 'recovery-task';
const WRITEBACK_BODY = '- PRIVATE-RECOVERY-WRITEBACK-BODY';
const WRITEBACK_MARKER = `^writeback-${PROPOSAL_ID}`;
const APPROVAL_OPERATION_ID = 'review-approve-recovery-proposal';
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

function writeNote(vaultRoot, relativePath, content) {
	const target = path.join(vaultRoot, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content, 'utf8');
	return target;
}

function countOccurrences(content, needle) {
	return content.split(needle).length - 1;
}

function readAuditShards(vaultRoot) {
	const auditRoot = path.join(vaultRoot, '00_tracekeeper/control/audit');
	const documents = [];
	const visit = (directory) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const absolutePath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(absolutePath);
				continue;
			}
			const relativePath = path.relative(vaultRoot, absolutePath).replaceAll(path.sep, '/');
			if (
				entry.isFile()
				&& /^00_tracekeeper\/control\/audit\/\d{4}\/\d{4}-\d{2}-\d{2}\.md$/.test(relativePath)
			) {
				documents.push(fs.readFileSync(absolutePath, 'utf8'));
			}
		}
	};
	visit(auditRoot);
	return documents.join('\n');
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

function approvedProposalText() {
	const pending = {
		path: PROPOSAL_PATH,
		classification: 'memory_proposal',
		proposalId: PROPOSAL_ID,
		proposalKind: 'project_update',
		taskId: TASK_ID,
		status: 'pending',
		targetPath: TARGET_PATH,
		writebackContent: WRITEBACK_BODY,
		revisionComment: '',
		revisionRequestedAt: '',
		revisionRequestedBy: '',
		archived: false,
	};
	const approval = transitionProposal(
		pending,
		{
			expectedRevision: computeProposalRevision(pending),
			expectedContentHash: computeProposalContentHash(pending),
			operationId: APPROVAL_OPERATION_ID,
			action: { kind: 'status', nextStatus: 'approved' },
		},
		{
			now: '2026-07-31T00:00:00.000Z',
			actor: 'recovery-test-reviewer',
			targetAllowed: (relativePath) => relativePath === TARGET_PATH,
			targetExists: (relativePath) => relativePath === TARGET_PATH,
		}
	);
	const fields = {
		type: 'memory-proposal',
		proposal_id: PROPOSAL_ID,
		proposal_kind: 'project_update',
		approval_status: 'pending',
		status: 'pending',
		target_note: TARGET_PATH,
		task_id: TASK_ID,
		risk_level: 'medium',
		...approval.frontmatter,
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
		'# Recovery Proposal',
		'',
		'## Writeback',
		'',
		WRITEBACK_BODY,
		'',
	].join('\n');
}

function createFixture(tempRoot, name) {
	const vaultRoot = path.join(tempRoot, name);
	fs.mkdirSync(vaultRoot, { recursive: true });
	writeNote(vaultRoot, TARGET_PATH, '# Demo Memory\n');
	writeNote(vaultRoot, TASK_PATH, [
		'---',
		'type: agent-task',
		`task_id: ${TASK_ID}`,
		'status: active',
		'---',
		'',
		'# Recovery Task',
		'',
	].join('\n'));
	writeNote(vaultRoot, PROPOSAL_PATH, approvedProposalText());
	return {
		vaultRoot,
		context: {
			defaultVaultRoot: vaultRoot,
			principalId: 'writeback-recovery-test',
			credentialCapabilities: ['*'],
			agentId: 'recovery-test-agent',
			sessionId: 'recovery-test-session',
			writebackConfirmationClock: () => Date.parse('2026-07-31T00:00:00.000Z'),
			writebackConfirmationTtlMs: 60_000,
			writebackConfirmationSecret: 'writeback-recovery-test-secret-32-bytes',
		},
		absolute(relativePath) {
			return path.join(vaultRoot, relativePath);
		},
	};
}

async function preview(fixture) {
	const result = await callTool(
		'tracekeeper.apply_approved_writeback',
		{ proposal_path: PROPOSAL_PATH, task_id: TASK_ID, dry_run: true },
		fixture.context
	);
	assert.equal(result.isError, false);
	assert.equal(result.structuredContent?.dry_run, true);
	assert.equal(typeof result.structuredContent?.confirmation_token, 'string');
	assert.ok(result.structuredContent.confirmation_token.length >= 32);
	return result;
}

async function apply(fixture, confirmationToken, context = fixture.context) {
	return callTool(
		'tracekeeper.apply_approved_writeback',
		{
			proposal_path: PROPOSAL_PATH,
			task_id: TASK_ID,
			confirmation_token: confirmationToken,
		},
		context
	);
}

function operationRecord(fixture) {
	const operationDirectory = fixture.absolute('00_tracekeeper/control/operations');
	const operationFiles = fs.readdirSync(operationDirectory)
		.filter((entry) => entry.endsWith('.json'));
	assert.equal(operationFiles.length, 1);
	return JSON.parse(
		fs.readFileSync(path.join(operationDirectory, operationFiles[0]), 'utf8')
	);
}

function assertBoundedTransitionResult(operation, fixture, confirmationToken) {
	const transitionStep = operation.completed_steps.find(
		(step) => step.name === 'mark_proposal_applied'
	);
	assert.ok(transitionStep);
	assert.ok(transitionStep.result);
	assert.deepEqual(Object.keys(transitionStep.result).sort(), TRANSITION_RECEIPT_KEYS);
	assert.equal(transitionStep.result.schemaVersion, 1);
	assert.equal(transitionStep.result.operationId, operation.operation_id);
	assert.equal(transitionStep.result.kind, 'apply');
	assert.equal(transitionStep.result.proposalId, PROPOSAL_ID);
	assert.equal(transitionStep.result.proposalPath, PROPOSAL_PATH);
	assert.equal(transitionStep.result.taskId, TASK_ID);
	assert.equal(transitionStep.result.previousStatus, 'approved');
	assert.equal(transitionStep.result.nextStatus, 'applied');
	const persisted = JSON.stringify(transitionStep.result);
	assert.equal(persisted.includes(WRITEBACK_BODY), false);
	assert.equal(persisted.includes(fixture.vaultRoot), false);
	assert.equal(persisted.includes(confirmationToken), false);
}

function assertExactlyOnceEffects(fixture, operationId) {
	const targetText = fs.readFileSync(fixture.absolute(TARGET_PATH), 'utf8');
	assert.equal(countOccurrences(targetText, WRITEBACK_MARKER), 1);
	const taskText = fs.readFileSync(fixture.absolute(TASK_PATH), 'utf8');
	assert.equal(countOccurrences(taskText, TARGET_PATH), 1);
	assert.equal(countOccurrences(taskText, PROPOSAL_PATH), 1);
	const auditText = readAuditShards(fixture.vaultRoot);
	assert.equal(countOccurrences(auditText, `- operation_id: "${operationId}"`), 1);
}

async function verifyCompletedRetryWithoutProposal(tempRoot) {
	const fixture = createFixture(tempRoot, 'completed-vault');
	const previewResult = await preview(fixture);
	const confirmationToken = previewResult.structuredContent.confirmation_token;
	const completed = await apply(fixture, confirmationToken);
	assert.equal(completed.isError, false);
	assert.equal(completed.structuredContent?.status, 'applied');
	const operation = operationRecord(fixture);
	assert.equal(operation.status, 'completed');
	assertBoundedTransitionResult(operation, fixture, confirmationToken);

	fs.unlinkSync(fixture.absolute(PROPOSAL_PATH));
	const replayed = await apply(fixture, confirmationToken);
	assert.equal(replayed.isError, false);
	assert.deepEqual(replayed.structuredContent, completed.structuredContent);
	assert.deepEqual(operationRecord(fixture).result, operation.result);
	assertExactlyOnceEffects(fixture, operation.operation_id);
	return operation.operation_id;
}

async function verifyAuditPendingRecoveryWithoutProposal(tempRoot) {
	const fixture = createFixture(tempRoot, 'audit-pending-vault');
	const previewResult = await preview(fixture);
	const confirmationToken = previewResult.structuredContent.confirmation_token;
	let injected = false;
	const interrupted = await apply(
		fixture,
		confirmationToken,
		{
			...fixture.context,
			operationFailureInjection(context) {
				if (!injected && context.phase === 'before_step' && context.stepName === 'append_audit') {
					injected = true;
					throw new Error('simulated writeback audit interruption');
				}
			},
		}
	);
	assert.equal(interrupted.isError, true);
	assert.equal(
		interrupted.structuredContent?.error,
		'Approved writeback failed at a protected Vault boundary.'
	);
	assert.equal(injected, true);

	const pending = operationRecord(fixture);
	assert.equal(pending.status, 'audit_pending');
	assert.deepEqual(pending.completed_steps.map((step) => step.name), [
		'apply_target',
		'link_task',
		'mark_proposal_applied',
	]);
	assertBoundedTransitionResult(pending, fixture, confirmationToken);
	const pendingTransitionResult = pending.completed_steps.find(
		(step) => step.name === 'mark_proposal_applied'
	).result;
	fs.unlinkSync(fixture.absolute(PROPOSAL_PATH));

	const recovery = await recoverPendingOperations(fixture.vaultRoot, fixture.context);
	assert.equal(recovery.failed.length, 0);
	assert.equal(recovery.skipped.length, 0);
	assert.deepEqual(recovery.recovered, [pending.operation_id]);

	const completed = operationRecord(fixture);
	assert.equal(completed.status, 'completed');
	assert.deepEqual(completed.completed_steps.map((step) => step.name), [
		'apply_target',
		'link_task',
		'mark_proposal_applied',
		'append_audit',
	]);
	assert.deepEqual(
		completed.completed_steps.find((step) => step.name === 'mark_proposal_applied').result,
		pendingTransitionResult
	);
	assertBoundedTransitionResult(completed, fixture, confirmationToken);
	assertExactlyOnceEffects(fixture, pending.operation_id);

	const secondRecovery = await recoverPendingOperations(fixture.vaultRoot, fixture.context);
	assert.deepEqual(secondRecovery, { recovered: [], failed: [], skipped: [] });
	assertExactlyOnceEffects(fixture, pending.operation_id);
	return pending.operation_id;
}

async function main() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-writeback-recovery-'));

	try {
		const completedOperationId = await verifyCompletedRetryWithoutProposal(tempRoot);
		const recoveredOperationId = await verifyAuditPendingRecoveryWithoutProposal(tempRoot);
		console.log(JSON.stringify({
			result: 'pass',
			completedOperationId,
			recoveredOperationId,
		}, null, 2));
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
