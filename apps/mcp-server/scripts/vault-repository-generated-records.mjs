#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { callTool } = require('@tracekeeper/mcp-runtime');
const { NodeFsVaultRepository } = require('@tracekeeper/core');

function writeNote(vaultRoot, relativePath, content) {
	const target = path.join(vaultRoot, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content, 'utf8');
}

class RecordingVaultRepository {
	constructor(vaultRoot) {
		this.delegate = new NodeFsVaultRepository({ vaultRoot });
		this.calls = [];
		this.auditConflictPending = false;
	}

	injectAuditConflictOnce() {
		this.auditConflictPending = true;
	}

	takeCalls() {
		const calls = this.calls;
		this.calls = [];
		return calls;
	}

	async readText(relativePath) {
		this.calls.push({ method: 'readText', path: relativePath });
		return this.delegate.readText(relativePath);
	}

	async createText(relativePath, content) {
		this.calls.push({ method: 'createText', path: relativePath });
		return this.delegate.createText(relativePath, content);
	}

	async replaceText(relativePath, expectedVersion, content) {
		this.calls.push({ method: 'replaceText', path: relativePath });
		if (relativePath === '00_tracekeeper/control/audit_log.md' && this.auditConflictPending) {
			this.auditConflictPending = false;
			const current = await this.delegate.readText(relativePath);
			assert.ok(current, 'audit log should exist before conflict injection');
			await this.delegate.replaceText(
				relativePath,
				expectedVersion,
				`${current.content}<!-- simulated concurrent audit update -->\n`
			);
		}
		return this.delegate.replaceText(relativePath, expectedVersion, content);
	}

	async listMarkdown(scope) {
		this.calls.push({ method: 'listMarkdown', path: scope || '' });
		return this.delegate.listMarkdown(scope);
	}
}

function assertCall(calls, method, expectedPath) {
	assert.ok(
		calls.some((call) => call.method === method && call.path === expectedPath),
		`expected ${method} through VaultRepository for ${expectedPath}`
	);
}

function assertCallUnder(calls, method, expectedPrefix) {
	assert.ok(
		calls.some((call) => call.method === method && call.path.startsWith(expectedPrefix)),
		`expected ${method} through VaultRepository under ${expectedPrefix}`
	);
}

function countToolAuditSections(content, toolName) {
	return content
		.split('\n## ')
		.filter((section) => section.includes('- type: tool-call') && section.includes(toolName))
		.length;
}

function readFinishTaskJournal(vaultRoot) {
	const operationDirectory = path.join(vaultRoot, '00_tracekeeper/control/operations');
	const filename = fs.readdirSync(operationDirectory).find((entry) => entry.startsWith('finish-task-') && entry.endsWith('.json'));
	assert.ok(filename, 'finish_task operation journal should exist');
	return JSON.parse(fs.readFileSync(path.join(operationDirectory, filename), 'utf8'));
}

async function invoke(name, args, context) {
	const result = await callTool(name, args, context);
	assert.notEqual(result.isError, true, `${name} failed: ${JSON.stringify(result.structuredContent)}`);
	assert.equal(result.structuredContent?.ok, true, `${name} should return ok=true`);
	return result.structuredContent;
}

async function main() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-vault-repository-records-'));
	const vaultRoot = path.join(tempRoot, 'vault');
	fs.mkdirSync(vaultRoot, { recursive: true });

	writeNote(vaultRoot, '00_tracekeeper/control/system.md', '# Tracekeeper System\n');
	writeNote(vaultRoot, '00_tracekeeper/control/audit_log.md', '# Audit Log\n');
	writeNote(vaultRoot, '01_knowledge/index.md', '# Knowledge Index\n');
	writeNote(vaultRoot, '01_knowledge/sources/repository-source.md', '# Repository Source\n\nRepository-backed source text.\n');
	writeNote(vaultRoot, '01_knowledge/wiki/repository-hub.md', '# Repository Hub\n');
	writeNote(vaultRoot, '00_tracekeeper/inbox/agent_requests/repository-request.md', [
		'---',
		'type: agent-request',
		'source: 01_knowledge/sources/repository-source.md',
		'source_kind: local_file',
		'status: pending',
		'purpose: repository port coverage',
		'analysis_mode: default',
		'---',
		'',
		'## Selected Text',
		'Repository request fallback text.',
		'',
	].join('\n'));

	const vaultRepository = new RecordingVaultRepository(vaultRoot);
	const context = {
		defaultVaultRoot: vaultRoot,
		vaultRepository,
		principalId: 'vault-repository-records-test',
		credentialCapabilities: ['*'],
		agentId: 'vault-repository-records-agent',
		sessionId: 'vault-repository-records-session',
		contentLanguage: 'en',
		contentLanguageSource: 'setting',
	};

	try {
		const startTask = await invoke('tracekeeper.start_task', {
			goal: 'Exercise generated records through VaultRepository.',
			project_hint: 'repository-port',
			idempotency_key: 'vault-repository-generated-records',
		}, context);
		const taskId = startTask.task_id;
		let calls = vaultRepository.takeCalls();
		assertCall(calls, 'createText', startTask.path);
		assertCall(calls, 'replaceText', '00_tracekeeper/control/audit_log.md');

		const writtenContext = await invoke('tracekeeper.write_context_pack', {
			filename: 'repository-context-pack',
			content: '# Repository Context Pack\n\nManual context.',
			task_id: taskId,
		}, context);
		calls = vaultRepository.takeCalls();
		assertCall(calls, 'createText', writtenContext.path);
		assertCallUnder(calls, 'createText', '00_tracekeeper/work/context_packs/');
		assertCall(calls, 'replaceText', startTask.path);
		assertCall(calls, 'replaceText', '00_tracekeeper/control/audit_log.md');

		const builtContext = await invoke('tracekeeper.build_context_pack', {
			query: 'repository',
			write: true,
			filename: 'repository-built-context-pack',
			task_id: taskId,
		}, context);
		calls = vaultRepository.takeCalls();
		assertCall(calls, 'createText', builtContext.artifact.path);
		assertCallUnder(calls, 'createText', '00_tracekeeper/work/context_packs/');
		assertCall(calls, 'replaceText', startTask.path);

		const sessionNote = await invoke('tracekeeper.write_session_note', {
			filename: 'repository-session-note',
			content: '# Repository Session\n\nSession content.',
			task_id: taskId,
		}, context);
		calls = vaultRepository.takeCalls();
		assertCall(calls, 'createText', sessionNote.path);
		assertCall(calls, 'replaceText', startTask.path);

		const capturedSource = await invoke('tracekeeper.capture_source', {
			filename: 'repository-captured-source',
			source: 'local repository fixture',
			mode: 'local_copy',
			content: '# Captured Source\n\nCaptured through the repository.',
			task_id: taskId,
		}, context);
		calls = vaultRepository.takeCalls();
		assertCall(calls, 'createText', capturedSource.path);
		assertCall(calls, 'replaceText', startTask.path);

		const analyzed = await invoke('tracekeeper.source_request', {
			action: 'analyze',
			request_path: '00_tracekeeper/inbox/agent_requests/repository-request.md',
			task_id: taskId,
		}, context);
		calls = vaultRepository.takeCalls();
		assertCall(calls, 'readText', '00_tracekeeper/inbox/agent_requests/repository-request.md');
		assertCall(calls, 'readText', '01_knowledge/sources/repository-source.md');
		assertCall(calls, 'createText', analyzed.source_note.path);
		assertCall(calls, 'createText', analyzed.report.path);
		assertCall(calls, 'replaceText', '00_tracekeeper/inbox/agent_requests/repository-request.md');
		assertCall(calls, 'replaceText', startTask.path);
		assert.match(
			fs.readFileSync(path.join(vaultRoot, '00_tracekeeper/inbox/agent_requests/repository-request.md'), 'utf8'),
			/status: completed/
		);

		const distilled = await invoke('tracekeeper.distill_session', {
			task_id: taskId,
			filename: 'repository-distilled-session',
			summary: 'Repository-backed distillation.',
			decisions: ['Keep generated records behind VaultRepository.'],
		}, context);
		calls = vaultRepository.takeCalls();
		assertCall(calls, 'createText', distilled.path);
		assertCallUnder(calls, 'createText', '00_tracekeeper/inbox/review_queue/');
		assertCall(calls, 'replaceText', startTask.path);

		const proposal = await invoke('tracekeeper.propose_memory', {
			filename: 'repository-memory-proposal',
			proposal_kind: 'project_update',
			content: 'Repository-backed memory proposal.',
			task_id: taskId,
		}, context);
		calls = vaultRepository.takeCalls();
		assertCall(calls, 'createText', proposal.path);
		assertCall(calls, 'replaceText', startTask.path);

		const autoMemory = await invoke('tracekeeper.propose_memory', {
			proposal_kind: 'project_update',
			content: 'Repository-backed automatic project memory.',
			project_hint: 'repository-auto',
			memory_scope: 'project',
			related_wiki: ['01_knowledge/wiki/repository-hub.md'],
			task_id: taskId,
		}, {
			...context,
			memoryRules: {
				globalMemoryRule: 'review_queue',
				projectMemoryRule: 'auto_write',
				taskMemoryProposalMode: 'off',
			},
		});
		calls = vaultRepository.takeCalls();
		assert.equal(autoMemory.auto_applied, true);
		assertCall(calls, 'createText', '01_knowledge/memory/projects/repository-auto/index.md');
		assertCall(calls, 'createText', autoMemory.path);

		vaultRepository.injectAuditConflictOnce();
		await invoke('tracekeeper.status', {}, context);
		calls = vaultRepository.takeCalls();
		assert.ok(
			calls.filter((call) => call.method === 'replaceText' && call.path === '00_tracekeeper/control/audit_log.md').length >= 2,
			'audit append should retry after a CAS conflict'
		);

		const auditPath = path.join(vaultRoot, '00_tracekeeper/control/audit_log.md');
		const auditBefore = fs.readFileSync(auditPath, 'utf8');
		await Promise.all(Array.from({ length: 12 }, (_, index) => invoke('tracekeeper.status', {}, {
			...context,
			sessionId: `vault-repository-concurrent-audit-${index}`,
		})));
		const auditAfter = fs.readFileSync(auditPath, 'utf8');
		assert.equal(
			countToolAuditSections(auditAfter, 'tracekeeper.status') -
				countToolAuditSections(auditBefore, 'tracekeeper.status'),
			12,
			'concurrent repository audit appends should retain every event'
		);
		vaultRepository.takeCalls();

		await invoke('tracekeeper.audit_recent', { max_items: 5 }, context);
		calls = vaultRepository.takeCalls();
		assertCall(calls, 'readText', '00_tracekeeper/control/audit_log.md');
		assertCall(calls, 'replaceText', '00_tracekeeper/control/audit_log.md');

		const finishArgs = {
			task_id: taskId,
			summary: 'Finish repository port coverage.',
			outcomes: ['Generated records use VaultRepository.'],
			review_proposal_mode: 'off',
			idempotency_key: 'vault-repository-frozen-finish',
		};
		let interrupted = false;
		const failedFinish = await callTool('tracekeeper.finish_task', finishArgs, {
			...context,
			operationFailureInjection({ phase, stepName }) {
				if (!interrupted && phase === 'before_step' && stepName === 'finish-task:session-note') {
					interrupted = true;
					throw new Error('simulated finish snapshot interruption');
				}
			},
		});
		assert.equal(failedFinish.isError, true);
		const frozenJournal = readFinishTaskJournal(vaultRoot);
		assert.equal(typeof frozenJournal.payload.requestHash, 'string');
		assert.equal(frozenJournal.payload.contentLanguage, 'en');

		writeNote(vaultRoot, '01_knowledge/wiki/post-failure-architecture-change.md', '# Changed Architecture Snapshot\n');
		const finished = await invoke('tracekeeper.finish_task', finishArgs, {
			...context,
			contentLanguage: 'zh-CN',
		});
		assert.equal(finished.content_language, 'en');
		const completedJournal = readFinishTaskJournal(vaultRoot);
		assert.deepEqual(completedJournal.payload, frozenJournal.payload);

		const conflictingFinish = await callTool('tracekeeper.finish_task', {
			...finishArgs,
			summary: 'Different request using the same idempotency key.',
		}, context);
		assert.equal(conflictingFinish.isError, true);
		assert.match(conflictingFinish.structuredContent?.error || '', /different finish_task request hash/);

		console.log(JSON.stringify({ result: 'pass', vaultRoot }, null, 2));
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
