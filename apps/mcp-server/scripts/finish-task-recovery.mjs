#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { callTool, recoverPendingOperations } = require('@tracekeeper/mcp-runtime');
const { NodeFsVaultRepository } = require('@tracekeeper/core');

function writeNote(vaultRoot, relativePath, content) {
	const target = path.join(vaultRoot, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content, 'utf8');
	return target;
}

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function countOccurrences(content, needle) {
	return content.split(needle).length - 1;
}

function collectMatches(dir, matcher) {
	return fs.existsSync(dir)
		? fs.readdirSync(dir).filter((entry) => entry.endsWith('.md') && matcher(path.join(dir, entry)))
		: [];
}

function findFinishTaskOperation(vaultRoot) {
	const operationDir = path.join(vaultRoot, '00_tracekeeper/control/operations');
	if (!fs.existsSync(operationDir)) {
		throw new Error(`Missing operation directory: ${operationDir}`);
	}
	const operationFiles = fs.readdirSync(operationDir).filter((entry) => entry.endsWith('.json'));
	const finishTasks = operationFiles.filter((entry) => entry.startsWith('finish-task-'));
	assert.equal(finishTasks.length, 1, 'expected exactly one finish_task operation record');
	return path.join(operationDir, finishTasks[0]);
}

async function main() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-finish-task-recovery-'));
	const vaultRoot = path.join(tempRoot, 'vault');
	fs.mkdirSync(vaultRoot, { recursive: true });
	const relatedWikiPath = '01_knowledge/wiki/recovery-hub.md';
	const taskPath = path.join(vaultRoot, '00_tracekeeper/work/tasks/recovery-task.md');
	const sessionDir = path.join(vaultRoot, '00_tracekeeper/work/sessions');
	const reviewQueueDir = path.join(vaultRoot, '00_tracekeeper/inbox/review_queue');
	const operationDir = path.join(vaultRoot, '00_tracekeeper/control/operations');
	const vaultRepository = new NodeFsVaultRepository({ vaultRoot });

	try {
		writeNote(vaultRoot, '00_tracekeeper/work/tasks/recovery-task.md', [
			'---',
			'type: agent-task',
			'task_id: recovery-task',
			'status: active',
			'---',
			'',
			'# Recovery Task',
			'',
		].join('\n'));
		writeNote(vaultRoot, '01_knowledge/memory/projects/recovery/memory.md', '# Recovery Memory');
		writeNote(vaultRoot, relatedWikiPath, [
			'---',
			'type: wiki',
			'---',
			'',
			'# Recovery Hub',
		].join('\n'));

		let injected = false;
		const interrupted = await callTool(
			'tracekeeper.finish_task',
			{
				task_id: 'recovery-task',
				summary: 'Recovered finish session summary.',
				outcomes: ['Recovered finish task test'],
				decisions: ['Track recovery behavior for finish_task'],
				project_hint: 'recovery',
				memory_scope: 'project',
				related_wiki: ['01_knowledge/wiki/recovery-hub.md'],
				review_proposal_mode: 'review_queue',
				idempotency_key: 'finish-recovery-step',
			},
			{
				defaultVaultRoot: vaultRoot,
				vaultRepository,
				principalId: 'finish-task-recovery-test',
				credentialCapabilities: ['*'],
				agentId: 'finish-task-recovery-agent',
				sessionId: 'finish-task-recovery-session',
				operationFailureInjection(context) {
					if (!injected && context.phase === 'before_step' && context.stepName === 'finish-task:task_decision') {
						injected = true;
						throw new Error('simulated finish_task interruption');
					}
				},
			}
		);
		assert.equal(interrupted.isError, true);
		assert.equal(interrupted.structuredContent?.error, 'simulated finish_task interruption');

		const failedOperationPath = findFinishTaskOperation(vaultRoot);
		const failedOperation = readJson(failedOperationPath);
		assert.equal(failedOperation.status, 'failed');
		assert.equal(failedOperation.completed_steps.length, 1);
		assert.equal(failedOperation.completed_steps[0].name, 'finish-task:session-note');
		assert.match(failedOperation.error, /simulated finish_task interruption/);

		const sessionNotesForOperation = collectMatches(sessionDir, (entryPath) =>
			fs.readFileSync(entryPath, 'utf8').includes(`finish_operation_id: "${failedOperation.operation_id}"`)
		);
		assert.equal(sessionNotesForOperation.length, 1);
		const proposedForOperationOnFail = collectMatches(reviewQueueDir, (entryPath) =>
			fs.readFileSync(entryPath, 'utf8').includes(`finish_operation_id: "${failedOperation.operation_id}"`)
		);
		assert.equal(proposedForOperationOnFail.length, 0);

		const recovery = await recoverPendingOperations(vaultRoot, {
			vaultRepository,
			principalId: 'finish-task-recovery-test',
			credentialCapabilities: ['*'],
			agentId: 'finish-task-recovery-agent',
			sessionId: 'finish-task-recovery-session',
		});
		assert.equal(recovery.failed.length, 0, JSON.stringify(recovery.failed));
		assert.equal(recovery.skipped.length, 0);
		assert.equal(recovery.recovered.length, 1);
		assert.equal(recovery.recovered[0], failedOperation.operation_id);

		const resumed = await callTool(
			'tracekeeper.finish_task',
			{
				task_id: 'recovery-task',
				summary: 'Recovered finish session summary.',
				outcomes: ['Recovered finish task test'],
				decisions: ['Track recovery behavior for finish_task'],
				project_hint: 'recovery',
				memory_scope: 'project',
				related_wiki: ['01_knowledge/wiki/recovery-hub.md'],
				review_proposal_mode: 'review_queue',
				idempotency_key: 'finish-recovery-step',
			},
			{
				defaultVaultRoot: vaultRoot,
				vaultRepository,
				principalId: 'finish-task-recovery-test',
				credentialCapabilities: ['*'],
				agentId: 'finish-task-recovery-agent',
				sessionId: 'finish-task-recovery-session',
			}
		);
		assert.equal(resumed.isError, false);
		assert.equal(resumed.structuredContent?.operation_id, failedOperation.operation_id);

		const completedOperation = readJson(failedOperationPath);
		assert.equal(completedOperation.status, 'completed');
		assert.equal(completedOperation.completed_steps.length, 3);
		assert.deepEqual(
			completedOperation.completed_steps.map((step) => step.name),
			['finish-task:session-note', 'finish-task:task_decision', 'finish-task:update-task-record']
		);

		const proposalFilesForOperation = collectMatches(reviewQueueDir, (entryPath) =>
			fs.readFileSync(entryPath, 'utf8').includes(`finish_operation_id: "${completedOperation.operation_id}"`)
		);
		assert.equal(proposalFilesForOperation.length, 1);
		assert.equal(resumed.structuredContent?.proposal_count, 1);
		assert.equal(resumed.structuredContent?.proposals?.length, 1);

		const resume = await callTool(
			'tracekeeper.finish_task',
			{
				task_id: 'recovery-task',
				summary: 'Recovered finish session summary.',
				outcomes: ['Recovered finish task test'],
				decisions: ['Track recovery behavior for finish_task'],
				project_hint: 'recovery',
				memory_scope: 'project',
				related_wiki: ['01_knowledge/wiki/recovery-hub.md'],
				review_proposal_mode: 'review_queue',
				idempotency_key: 'finish-recovery-step',
			},
			{
				defaultVaultRoot: vaultRoot,
				vaultRepository,
				principalId: 'finish-task-recovery-test',
				credentialCapabilities: ['*'],
				agentId: 'finish-task-recovery-agent',
				sessionId: 'finish-task-recovery-session',
			}
		);
		assert.equal(resume.isError, false);
		assert.deepEqual(
			resume.structuredContent,
			resumed.structuredContent,
			'finish_task replay by the same idempotency key should be identical'
		);

		const sessionText = fs.readFileSync(path.join(vaultRoot, resumed.structuredContent.path), 'utf8');
		const finishMarker = `^finish-${resumed.structuredContent.operation_id}`;
		assert.equal(countOccurrences(sessionText, `finish_operation_id: "${resumed.structuredContent.operation_id}"`), 1);
		const completedSessionNotes = collectMatches(sessionDir, (entryPath) =>
			fs.readFileSync(entryPath, 'utf8').includes(`finish_operation_id: "${resumed.structuredContent.operation_id}"`)
		);
		assert.equal(completedSessionNotes.length, 1);
		const taskText = fs.readFileSync(taskPath, 'utf8');
		assert.equal(countOccurrences(taskText, resumed.structuredContent.path), 2);
		assert.equal(countOccurrences(taskText, 'sessions/'), 2);
		assert.equal(countOccurrences(taskText, finishMarker), 1);

		const conflictingReplay = await callTool(
			'tracekeeper.finish_task',
			{
				task_id: 'recovery-task',
				summary: 'A conflicting summary for the same key.',
				decisions: ['Track recovery behavior for finish_task'],
				project_hint: 'recovery',
				memory_scope: 'project',
				related_wiki: ['01_knowledge/wiki/recovery-hub.md'],
				review_proposal_mode: 'review_queue',
				idempotency_key: 'finish-recovery-step',
			},
			{
				defaultVaultRoot: vaultRoot,
				vaultRepository,
				principalId: 'finish-task-recovery-test',
				credentialCapabilities: ['*'],
				agentId: 'finish-task-recovery-agent',
				sessionId: 'finish-task-recovery-session',
			}
		);
		assert.equal(conflictingReplay.isError, true);
		assert.match(conflictingReplay.structuredContent?.error || '', /different (payload|finish_task request) hash/);

		writeNote(vaultRoot, '00_tracekeeper/work/tasks/auto-recovery-task.md', [
			'---',
			'type: agent-task',
			'task_id: auto-recovery-task',
			'status: active',
			'project_hint: recovery',
			'---',
			'',
			'# Auto Recovery Task',
			'',
		].join('\n'));
		const autoWriteArgs = {
			task_id: 'auto-recovery-task',
			summary: 'Repository-backed automatic memory closeout.',
			decisions: ['Auto-write through repository'],
			project_hint: 'recovery',
			memory_scope: 'project',
			related_wiki: [relatedWikiPath],
			review_proposal_mode: 'auto_propose',
			idempotency_key: 'finish-repository-auto-write',
		};
		const autoWriteContext = {
			defaultVaultRoot: vaultRoot,
			vaultRepository,
			principalId: 'finish-task-recovery-test',
			credentialCapabilities: ['*'],
			agentId: 'finish-task-recovery-agent',
			sessionId: 'finish-task-recovery-auto-session',
			memoryRules: {
				globalMemoryRule: 'review_queue',
				projectMemoryRule: 'auto_write',
				taskMemoryProposalMode: 'auto_propose',
			},
		};
		const autoWrite = await callTool('tracekeeper.finish_task', autoWriteArgs, autoWriteContext);
		assert.equal(autoWrite.isError, false);
		assert.equal(autoWrite.structuredContent?.auto_applied_count, 1);
		assert.equal(autoWrite.structuredContent?.proposal_count, 0);
		assert.equal(autoWrite.structuredContent?.auto_applied_memory_updates?.[0]?.status, 'written');
		const replayedAutoWrite = await callTool('tracekeeper.finish_task', autoWriteArgs, autoWriteContext);
		assert.deepEqual(replayedAutoWrite.structuredContent, autoWrite.structuredContent);
		const projectMemoryText = fs.readFileSync(
			path.join(vaultRoot, '01_knowledge/memory/projects/recovery/memory.md'),
			'utf8'
		);
		assert.equal(countOccurrences(projectMemoryText, 'Auto-write through repository'), 1);
		const auditText = fs.readFileSync(path.join(vaultRoot, '00_tracekeeper/control/audit_log.md'), 'utf8');
		assert.equal(countOccurrences(auditText, `operation_id: "${failedOperation.operation_id}"`), 2);
		assert.equal(countOccurrences(auditText, `operation_id: "${autoWrite.structuredContent.operation_id}"`), 2);
		assert.equal(countOccurrences(auditText, 'audit_event_id:'), 4);

		const operationFiles = fs.readdirSync(operationDir).filter((entry) => entry.startsWith('finish-task-') && entry.endsWith('.json'));
		assert.equal(operationFiles.length, 2);

		console.log(JSON.stringify({ result: 'pass', operationId: failedOperation.operation_id }, null, 2));
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
