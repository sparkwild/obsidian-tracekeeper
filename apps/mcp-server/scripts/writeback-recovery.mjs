#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { callTool, recoverPendingOperations } = require('@tracekeeper/mcp-runtime');

function writeNote(vaultRoot, relativePath, content) {
	const target = path.join(vaultRoot, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content, 'utf8');
	return target;
}

function countOccurrences(content, needle) {
	return content.split(needle).length - 1;
}

async function main() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-writeback-recovery-'));
	const vaultRoot = path.join(tempRoot, 'vault');
	fs.mkdirSync(vaultRoot, { recursive: true });

	try {
		writeNote(vaultRoot, '01_knowledge/memory/projects/demo/memory.md', '# Demo Memory\n');
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
		const proposalPath = '00_tracekeeper/inbox/review_queue/recovery-writeback.md';
		writeNote(vaultRoot, proposalPath, [
			'---',
			'type: memory-proposal',
			'proposal_id: recovery-proposal',
			'proposal_kind: project_update',
			'approval_status: approved',
			'status: approved',
			'target_note: 01_knowledge/memory/projects/demo/memory.md',
			'task_id: recovery-task',
			'risk_level: medium',
			'---',
			'',
			'# Recovery Proposal',
			'',
			'## Writeback',
			'',
			'- Recoverable memory update.',
			'',
		].join('\n'));

		let injected = false;
		const interrupted = await callTool(
			'tracekeeper.apply_approved_writeback',
			{ proposal_path: proposalPath, task_id: 'recovery-task' },
			{
				defaultVaultRoot: vaultRoot,
				principalId: 'writeback-recovery-test',
				credentialCapabilities: ['*'],
				agentId: 'recovery-test-agent',
				sessionId: 'recovery-test-session',
				operationFailureInjection(context) {
					if (!injected && context.phase === 'after_step' && context.stepName === 'mark_proposal_applied') {
						injected = true;
						throw new Error('simulated writeback interruption');
					}
				},
			}
		);
		assert.equal(interrupted.isError, true);
		assert.equal(interrupted.structuredContent?.error, 'simulated writeback interruption');

		const targetPath = path.join(vaultRoot, '01_knowledge/memory/projects/demo/memory.md');
		const proposalAbsolute = path.join(vaultRoot, proposalPath);
		assert.equal(countOccurrences(fs.readFileSync(targetPath, 'utf8'), '^writeback-recovery-proposal'), 1);
		assert.match(fs.readFileSync(proposalAbsolute, 'utf8'), /writeback_operation_id: writeback-[a-f0-9]{24}/);

		const recovery = await recoverPendingOperations(vaultRoot, {
			principalId: 'writeback-recovery-test',
			credentialCapabilities: ['*'],
			agentId: 'recovery-test-agent',
			sessionId: 'recovery-test-session',
		});
		assert.equal(recovery.failed.length, 0);
		assert.equal(recovery.skipped.length, 0);
		assert.equal(recovery.recovered.length, 1);

		const resumed = await callTool(
			'tracekeeper.apply_approved_writeback',
			{ proposal_path: proposalPath, task_id: 'recovery-task' },
			{ defaultVaultRoot: vaultRoot, principalId: 'writeback-recovery-test', credentialCapabilities: ['*'], agentId: 'recovery-test-agent', sessionId: 'recovery-test-session' }
		);
		assert.equal(resumed.isError, false);
		assert.equal(resumed.structuredContent?.status, 'applied');
		assert.match(resumed.structuredContent?.operation_id || '', /^writeback-[a-f0-9]{24}$/);

		const replayed = await callTool(
			'tracekeeper.apply_approved_writeback',
			{ proposal_path: proposalPath, task_id: 'recovery-task' },
			{ defaultVaultRoot: vaultRoot, principalId: 'writeback-recovery-test', credentialCapabilities: ['*'], agentId: 'recovery-test-agent', sessionId: 'recovery-test-session' }
		);
		assert.deepEqual(replayed.structuredContent, resumed.structuredContent);

		const targetText = fs.readFileSync(targetPath, 'utf8');
		assert.equal(countOccurrences(targetText, '^writeback-recovery-proposal'), 1);
		const taskText = fs.readFileSync(path.join(vaultRoot, '00_tracekeeper/work/tasks/recovery-task.md'), 'utf8');
		assert.equal(countOccurrences(taskText, '01_knowledge/memory/projects/demo/memory.md'), 1);
		assert.equal(countOccurrences(taskText, proposalPath), 1);

		const auditText = fs.readFileSync(path.join(vaultRoot, '00_tracekeeper/control/audit_log.md'), 'utf8');
		const operationId = resumed.structuredContent.operation_id;
		assert.equal(countOccurrences(auditText, `- operation_id: "${operationId}"`), 1);

		const operationPath = path.join(vaultRoot, '00_tracekeeper/control/operations', `${operationId}.json`);
		const operation = JSON.parse(fs.readFileSync(operationPath, 'utf8'));
		assert.equal(operation.status, 'completed');
		assert.deepEqual(operation.completed_steps.map((step) => step.name), [
			'apply_target',
			'mark_proposal_applied',
			'link_task',
			'append_audit',
		]);

		console.log(JSON.stringify({ result: 'pass', operationId }, null, 2));
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
