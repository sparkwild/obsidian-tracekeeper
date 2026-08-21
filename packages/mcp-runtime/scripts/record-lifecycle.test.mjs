#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { callTool } = require('../dist/tools.js');
const { McpJsonRpcHandler } = require('../dist/handler.js');
const {
	AGENT_ACTIVITY_HUB_TYPE,
	AGENT_ACTIVITY_SCHEMA_VERSION,
	computePayloadHash,
	computeProposalContentHash,
	computeProposalRevision,
	NodeFileOperationJournal,
	NodeFsVaultRepository,
	renderAgentActivityHub,
	transitionProposal,
} = require('@tracekeeper/core');

const renderFrontmatterValue = (value) => {
	if (Array.isArray(value)) {
		return JSON.stringify(value);
	}
	if (/^[A-Za-z0-9._/-]+$/.test(String(value))) {
		return String(value);
	}
	return JSON.stringify(value);
};

const approvedProposalFrontmatter = ({
	proposalId,
	proposalPath,
	taskId,
	targetPath,
	writebackContent,
}) => {
	const pending = {
		path: proposalPath,
		classification: 'memory_proposal',
		proposalId,
		proposalKind: 'decision',
		taskId,
		status: 'pending',
		targetPath,
		writebackContent,
		revisionComment: '',
		revisionRequestedAt: '',
		revisionRequestedBy: '',
		archived: false,
	};
	return transitionProposal(
		pending,
		{
			expectedRevision: computeProposalRevision(pending),
			expectedContentHash: computeProposalContentHash(pending),
			operationId: `review-approve-${proposalId}`,
			action: { kind: 'status', nextStatus: 'approved' },
		},
		{
			now: '2026-07-30T00:00:00.000Z',
			actor: 'record-lifecycle-reviewer',
			targetAllowed: () => true,
			targetExists: () => true,
		}
	).frontmatter;
};

const createFixture = () => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-record-lifecycle-runtime-'));
	const vaultRoot = path.join(tempRoot, 'vault');
	fs.mkdirSync(vaultRoot, { recursive: true });
	const repository = new NodeFsVaultRepository({ vaultRoot });
	const context = {
		defaultVaultRoot: vaultRoot,
		vaultRepository: repository,
		principalId: 'record-lifecycle-principal',
		credentialCapabilities: ['*'],
		agentId: 'record-lifecycle-agent',
		sessionId: 'record-lifecycle-session',
		clientName: 'record-lifecycle-test',
		transport: 'test',
		runtimeVersion: 'test',
		contentLanguage: 'en',
		writebackConfirmationSecret: 'record-lifecycle-confirmation-secret',
		memoryRules: {
			globalMemoryRule: 'review_queue',
			projectMemoryRule: 'review_queue',
			taskMemoryProposalMode: 'review_queue',
		},
	};
	return {
		tempRoot,
		vaultRoot,
		repository,
		context,
		write(relativePath, content) {
			const target = path.join(vaultRoot, relativePath);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, content, 'utf8');
		},
		read(relativePath) {
			return fs.readFileSync(path.join(vaultRoot, relativePath), 'utf8');
		},
		cleanup() {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		},
	};
};

const invoke = async (name, args, context) => {
	const result = await callTool(name, args, context);
	assert.notEqual(result.isError, true, `${name} failed: ${JSON.stringify(result.structuredContent)}`);
	assert.equal(result.structuredContent?.ok, true);
	return result.structuredContent;
};

const taskRepositoryWithPostWriteAction = (repository, action, mode) => {
	let triggered = false;
	return new Proxy(repository, {
		get(target, property) {
			if (property === mode) {
				return async (...args) => {
					const result = await target[property](...args);
					if (!triggered && String(args[0]).startsWith('00_tracekeeper/work/tasks/')) {
						triggered = true;
						await action();
					}
					return result;
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
};

const startTask = async (fixture, suffix) => invoke('tracekeeper.start_task', {
	goal: `Record lifecycle ${suffix}`,
	project_hint: 'record-lifecycle',
	idempotency_key: `record-lifecycle-start-${suffix}`,
}, fixture.context);

test('finish task completes the original task record without creating an implicit session note', async () => {
	const fixture = createFixture();
	try {
		const task = await startTask(fixture, 'single-record');
		const taskPath = `00_tracekeeper/work/tasks/${task.task_id}.md`;
		const finished = await invoke('tracekeeper.finish_task', {
			task_id: task.task_id,
			status: 'completed',
			summary: 'Complete the existing task record only.',
			outcomes: ['No implicit session note was created.'],
			filename: 'ignored-finish-session-name',
			idempotency_key: 'record-lifecycle-finish-single-record',
		}, fixture.context);

		assert.equal(finished.path, taskPath);
		assert.equal(finished.task_path, taskPath);
		assert.equal(finished.session_path, taskPath);
		assert.equal(
			fs.existsSync(path.join(fixture.vaultRoot, '00_tracekeeper/work/sessions')),
			false
		);
		const taskText = fixture.read(taskPath);
		assert.match(taskText, /^status: completed$/m);
		assert.match(taskText, /^summary: "?Complete the existing task record only\."?$/m);
		assert.match(taskText, /## Completion Summary\nComplete the existing task record only\./);
		assert.doesNotMatch(taskText, /^session_note:/m);
	} finally {
		fixture.cleanup();
	}
});

test('concurrent exact live finish calls share one operation timestamp and result', async () => {
	const fixture = createFixture();
	try {
		const task = await startTask(fixture, 'concurrent-live-finish');
		const args = {
			task_id: task.task_id,
			status: 'completed',
			summary: 'Complete the live task once under concurrent retry.',
			idempotency_key: 'record-lifecycle-concurrent-live-finish',
		};
		const [first, second] = await Promise.all([
			invoke('tracekeeper.finish_task', args, fixture.context),
			invoke('tracekeeper.finish_task', args, fixture.context),
		]);
		assert.deepEqual(second, first);
		const taskText = fixture.read(first.task_path);
		assert.equal((taskText.match(new RegExp(`\\^finish-${first.operation_id}`, 'g')) || []).length, 1);
	} finally {
		fixture.cleanup();
	}
});

test('concurrent changed live finish payload cannot reuse the winning request binding', async () => {
	const fixture = createFixture();
	try {
		const task = await startTask(fixture, 'concurrent-changed-live-finish');
		const delayedRepository = taskRepositoryWithPostWriteAction(
			fixture.repository,
			() => new Promise((resolve) => setTimeout(resolve, 120)),
			'replaceText'
		);
		const common = {
			task_id: task.task_id,
			status: 'completed',
			idempotency_key: 'record-lifecycle-concurrent-changed-live-finish',
		};
		const firstPromise = callTool('tracekeeper.finish_task', {
			...common,
			summary: 'LIVE-WINNER-SUMMARY',
			outcomes: ['LIVE-WINNER-OUTCOME'],
		}, {
			...fixture.context,
			vaultRepository: delayedRepository,
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		const secondPromise = callTool('tracekeeper.finish_task', {
			...common,
			summary: 'LIVE-LOSER-SUMMARY',
			outcomes: ['LIVE-LOSER-OUTCOME'],
		}, fixture.context);
		const [first, second] = await Promise.all([firstPromise, secondPromise]);
		assert.notEqual(first.isError, true);
		assert.equal(second.isError, true);
		assert.match(second.structuredContent?.error || '', /different finish_task request hash/);
		const taskText = fixture.read(first.structuredContent.task_path);
		assert.match(taskText, /^finish_request_hash: "?[a-f0-9]{64}"?$/m);
		assert.match(taskText, /LIVE-WINNER-SUMMARY/);
		assert.match(taskText, /LIVE-WINNER-OUTCOME/);
		assert.doesNotMatch(taskText, /LIVE-LOSER-SUMMARY|LIVE-LOSER-OUTCOME/);
	} finally {
		fixture.cleanup();
	}
});

test('finish task atomically creates and exactly replays a closeout-only canonical record', async () => {
	const fixture = createFixture();
	try {
		const args = {
			goal: 'Implement closeout-only task recording',
			started_at: '2026-08-21T01:00:00.000Z',
			status: 'completed',
			summary: 'Saved the ordinary task once at closeout.',
			outcomes: ['No live task was created.'],
			project_hint: 'record-lifecycle',
			idempotency_key: 'record-lifecycle-closeout-only',
		};
		const [first, concurrentReplay] = await Promise.all([
			invoke('tracekeeper.finish_task', args, fixture.context),
			invoke('tracekeeper.finish_task', args, fixture.context),
		]);
		assert.deepEqual(concurrentReplay, first);
		assert.equal(first.tracking_mode, 'closeout_only');
		assert.equal(first.task_record_origin, 'finish_task_closeout_only');
		assert.equal(first.started_at, '2026-08-21T01:00:00.000Z');
		assert.equal(first.started_at_source, 'client_claim');
		assert.equal(first.tracking_started_at, null);
		assert.equal(first.start_recovery, 'not_requested');
		assert.match(first.task_id, /^obs_task_[a-f0-9]{24}$/);
		assert.equal(first.task_path, `00_tracekeeper/work/tasks/${first.task_id}.md`);
		const taskFiles = fs.readdirSync(path.join(fixture.vaultRoot, '00_tracekeeper/work/tasks'));
		assert.deepEqual(taskFiles, [`${first.task_id}.md`]);
		const taskText = fixture.read(first.task_path);
		assert.match(taskText, /^tracking_mode: "closeout_only"$/m);
		assert.match(taskText, /^task_record_origin: "finish_task_closeout_only"$/m);
		assert.match(taskText, /^recording_reason: "ordinary_closeout"$/m);
		assert.match(taskText, /^started_at: "2026-08-21T01:00:00.000Z"$/m);
		assert.match(taskText, /^started_at_source: "client_claim"$/m);
		assert.match(taskText, /^tracking_started_at: null$/m);
		assert.match(taskText, /^finish_request_hash: "?[a-f0-9]{64}"?$/m);
		assert.doesNotMatch(taskText, /^start_operation_id:/m);
		assert.doesNotMatch(taskText, /^start_record_missing:/m);
		assert.match(taskText, /## Objective\nImplement closeout-only task recording/);

		const replay = await invoke('tracekeeper.finish_task', args, fixture.context);
		assert.deepEqual(replay, first);
		const changedPayload = await callTool('tracekeeper.finish_task', {
			...args,
			summary: 'Changed closeout payload.',
		}, fixture.context);
		assert.equal(changedPayload.isError, true);
		assert.match(changedPayload.structuredContent?.error || '', /different finish_task request hash/);
	} finally {
		fixture.cleanup();
	}
});

test('concurrent changed closeout-only payload leaves no losing task content', async () => {
	const fixture = createFixture();
	try {
		const delayedRepository = taskRepositoryWithPostWriteAction(
			fixture.repository,
			() => new Promise((resolve) => setTimeout(resolve, 120)),
			'createText'
		);
		const common = {
			goal: 'Bind closeout content to one request hash',
			started_at: '2026-08-21T01:10:00.000Z',
			status: 'completed',
			idempotency_key: 'record-lifecycle-concurrent-changed-closeout',
		};
		const firstPromise = callTool('tracekeeper.finish_task', {
			...common,
			summary: 'CLOSEOUT-WINNER-SUMMARY',
			outcomes: ['CLOSEOUT-WINNER-OUTCOME'],
		}, {
			...fixture.context,
			vaultRepository: delayedRepository,
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		const secondPromise = callTool('tracekeeper.finish_task', {
			...common,
			summary: 'CLOSEOUT-LOSER-SUMMARY',
			outcomes: ['CLOSEOUT-LOSER-OUTCOME'],
		}, fixture.context);
		const [first, second] = await Promise.all([firstPromise, secondPromise]);
		assert.notEqual(first.isError, true);
		assert.equal(second.isError, true);
		assert.match(second.structuredContent?.error || '', /different finish_task request hash/);
		const taskText = fixture.read(first.structuredContent.task_path);
		assert.match(taskText, /CLOSEOUT-WINNER-SUMMARY/);
		assert.match(taskText, /CLOSEOUT-WINNER-OUTCOME/);
		assert.doesNotMatch(taskText, /CLOSEOUT-LOSER-SUMMARY|CLOSEOUT-LOSER-OUTCOME/);
		assert.match(taskText, /^finish_request_hash: "?[a-f0-9]{64}"?$/m);
	} finally {
		fixture.cleanup();
	}
});

test('pre-journal closeout record accepts only the original request hash', async () => {
	const fixture = createFixture();
	try {
		let taskCreated = false;
		let interruptedRead = false;
		const interruptedRepository = new Proxy(fixture.repository, {
			get(target, property) {
				if (property === 'createText') {
					return async (...args) => {
						const result = await target.createText(...args);
						if (String(args[0]).startsWith('00_tracekeeper/work/tasks/')) {
							taskCreated = true;
						}
						return result;
					};
				}
				if (property === 'readText') {
					return async (...args) => {
						if (
							taskCreated
							&& !interruptedRead
							&& String(args[0]).startsWith('00_tracekeeper/work/tasks/')
						) {
							interruptedRead = true;
							throw new Error('interrupt after closeout task create');
						}
						return target.readText(...args);
					};
				}
				const value = Reflect.get(target, property, target);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		const args = {
			goal: 'Recover the exact pre-journal closeout request',
			started_at: '2026-08-21T01:20:00.000Z',
			status: 'partial',
			summary: 'PRE-JOURNAL-ORIGINAL-SUMMARY',
			outcomes: ['PRE-JOURNAL-ORIGINAL-OUTCOME'],
			idempotency_key: 'record-lifecycle-pre-journal-closeout',
		};
		const interrupted = await callTool('tracekeeper.finish_task', args, {
			...fixture.context,
			vaultRepository: interruptedRepository,
		});
		assert.equal(interrupted.isError, true);
		const taskDirectory = path.join(fixture.vaultRoot, '00_tracekeeper/work/tasks');
		const [taskFile] = fs.readdirSync(taskDirectory);
		const taskPath = `00_tracekeeper/work/tasks/${taskFile}`;
		assert.match(fixture.read(taskPath), /^finish_request_hash: "?[a-f0-9]{64}"?$/m);

		const changed = await callTool('tracekeeper.finish_task', {
			...args,
			summary: 'PRE-JOURNAL-CHANGED-SUMMARY',
			outcomes: ['PRE-JOURNAL-CHANGED-OUTCOME'],
		}, fixture.context);
		assert.equal(changed.isError, true);
		assert.match(changed.structuredContent?.error || '', /different finish_task request hash/);
		assert.doesNotMatch(
			fixture.read(taskPath),
			/PRE-JOURNAL-CHANGED-SUMMARY|PRE-JOURNAL-CHANGED-OUTCOME/
		);

		const recovered = await invoke('tracekeeper.finish_task', args, fixture.context);
		assert.equal(recovered.task_path, taskPath);
		assert.match(fixture.read(taskPath), /PRE-JOURNAL-ORIGINAL-SUMMARY/);
	} finally {
		fixture.cleanup();
	}
});

test('start_task preserves the original work time when an ordinary task promotes to live', async () => {
	const fixture = createFixture();
	try {
		const startedAt = '2026-08-20T23:00:00.000Z';
		const task = await invoke('tracekeeper.start_task', {
			goal: 'Promote before the first task-linked intermediate write',
			started_at: startedAt,
			project_hint: 'record-lifecycle',
			idempotency_key: 'record-lifecycle-promote-live',
		}, fixture.context);
		assert.equal(task.tracking_mode, 'live');
		assert.equal(task.started_at, startedAt);
		assert.equal(task.started_at_source, 'client_claim');
		assert.notEqual(task.tracking_started_at, startedAt);
		assert.equal(task.recorded_at, task.tracking_started_at);

		const finished = await invoke('tracekeeper.finish_task', {
			task_id: task.task_id,
			status: 'completed',
			summary: 'Promoted to live before the intermediate write.',
			idempotency_key: 'record-lifecycle-promote-live-finish',
		}, fixture.context);
		assert.equal(finished.tracking_mode, 'live');
		assert.equal(finished.task_record_origin, 'start_task');
		assert.equal(finished.started_at, startedAt);
		assert.equal(finished.started_at_source, 'client_claim');
		assert.equal(finished.tracking_started_at, task.tracking_started_at);
	} finally {
		fixture.cleanup();
	}
});

test('closeout-only finish recovers an interrupted journal without duplicating the task', async () => {
	const fixture = createFixture();
	try {
		const args = {
			goal: 'Recover an interrupted closeout-only finish',
			started_at: '2026-08-21T01:30:00.000Z',
			status: 'partial',
			summary: 'Resume the same finish operation after interruption.',
			project_hint: 'record-lifecycle',
			idempotency_key: 'record-lifecycle-closeout-interrupted',
		};
		let injected = false;
		const interrupted = await callTool('tracekeeper.finish_task', args, {
			...fixture.context,
			operationFailureInjection({ phase, stepName }) {
				if (!injected && phase === 'before_step' && stepName === 'finish-task:update-task-record') {
					injected = true;
					throw new Error('simulated closeout interruption');
				}
			},
		});
		assert.equal(interrupted.isError, true);
		assert.equal(injected, true);
		const taskDirectory = path.join(fixture.vaultRoot, '00_tracekeeper/work/tasks');
		const interruptedFiles = fs.readdirSync(taskDirectory);
		assert.equal(interruptedFiles.length, 1);
		assert.match(fixture.read(`00_tracekeeper/work/tasks/${interruptedFiles[0]}`), /^status: "?closing"?$/m);

		const recovered = await invoke('tracekeeper.finish_task', args, fixture.context);
		assert.equal(recovered.tracking_mode, 'closeout_only');
		assert.equal(recovered.start_recovery, 'not_requested');
		assert.deepEqual(fs.readdirSync(taskDirectory), [`${recovered.task_id}.md`]);
		assert.match(fixture.read(recovered.task_path), /^status: partial$/m);
	} finally {
		fixture.cleanup();
	}
});

test('finish_task rejects ambiguous live and closeout-only field combinations', async () => {
	const fixture = createFixture();
	try {
		for (const args of [
			{
				task_id: 'obs_task_known',
				goal: 'Conflicting goal',
				status: 'completed',
				summary: 'Invalid mixed mode.',
				idempotency_key: 'record-lifecycle-invalid-mixed-mode',
			},
			{
				goal: 'Missing finish key',
				started_at: '2026-08-21T01:00:00.000Z',
				status: 'completed',
				summary: 'Invalid closeout without a stable key.',
			},
			{
				goal: 'Missing original start key',
				started_at: '2026-08-21T01:00:00.000Z',
				recording_reason: 'start_unavailable',
				status: 'completed',
				summary: 'Invalid start recovery.',
				idempotency_key: 'record-lifecycle-invalid-start-recovery',
			},
		]) {
			const result = await callTool('tracekeeper.finish_task', args, fixture.context);
			assert.equal(result.isError, true);
		}
	} finally {
		fixture.cleanup();
	}
});

test('start-unavailable closeout falls back only when no start identity exists', async () => {
	const fixture = createFixture();
	try {
		const startKey = 'record-lifecycle-never-arrived-start';
		const finished = await invoke('tracekeeper.finish_task', {
			goal: 'Preserve work after start transport failure',
			started_at: '2026-08-21T02:00:00.000Z',
			recording_reason: 'start_unavailable',
			start_idempotency_key: startKey,
			status: 'partial',
			summary: 'The start request never reached Tracekeeper, so closeout recovered the task history.',
			project_hint: 'record-lifecycle',
			idempotency_key: 'record-lifecycle-start-unavailable-fallback',
		}, fixture.context);
		assert.equal(finished.tracking_mode, 'closeout_only');
		assert.equal(finished.task_record_origin, 'finish_task_closeout_only');
		assert.equal(finished.start_recovery, 'not_found');
		const taskText = fixture.read(finished.task_path);
		assert.match(taskText, /^recording_reason: "start_unavailable"$/m);
		assert.match(taskText, /^start_recovery: "not_found"$/m);
		assert.doesNotMatch(taskText, /^start_operation_id:/m);
		const storedBindingHash = taskText.match(/^finish_request_hash: "?([a-f0-9]{64})"?$/m)?.[1];
		assert.ok(storedBindingHash);
		const operationDirectory = path.join(
			fixture.vaultRoot,
			'00_tracekeeper/control/operations'
		);
		const operation = await new NodeFileOperationJournal({ directory: operationDirectory })
			.loadById(finished.operation_id);
		assert.ok(operation);
		assert.equal(operation.payload.requestSnapshot.start_idempotency_key, startKey);
		assert.equal(storedBindingHash, operation.payload.requestBindingHash);
		assert.notEqual(storedBindingHash, operation.payload.requestHash);
		assert.doesNotMatch(taskText, new RegExp(operation.payload.requestHash));
		for (const guessedStartKey of ['recovery-0', startKey, 'recovery-2']) {
			assert.notEqual(storedBindingHash, computePayloadHash({
				...operation.payload.requestSnapshot,
				start_idempotency_key: guessedStartKey,
			}));
		}
	} finally {
		fixture.cleanup();
	}
});

test('start recovery idempotency keys never enter Agent activity on success or failure', async () => {
	const fixture = createFixture();
	try {
		const startKey = 'record-lifecycle-origin-key-visible-only-to-runtime';
		const finishKey = 'record-lifecycle-finish-key-visible-only-to-runtime';
		await invoke('tracekeeper.finish_task', {
			goal: 'Redact the original start retry key from activity',
			started_at: '2026-08-21T02:10:00.000Z',
			recording_reason: 'start_unavailable',
			start_idempotency_key: startKey,
			status: 'completed',
			summary: 'Record a safe closeout without exposing either retry key.',
			idempotency_key: finishKey,
		}, fixture.context);
		const failed = await callTool('tracekeeper.finish_task', {
			goal: 'x',
			started_at: '2026-08-21T02:10:00.000Z',
			recording_reason: 'start_unavailable',
			start_idempotency_key: startKey,
			status: 'completed',
			summary: 'This invalid request must still redact keys.',
			idempotency_key: 'record-lifecycle-invalid-redaction-finish-key',
		}, fixture.context);
		assert.equal(failed.isError, true);

		const activityRoot = path.join(
			fixture.vaultRoot,
			'00_tracekeeper/control/agent_activity'
		);
		const activityText = fs.readdirSync(activityRoot, { recursive: true })
			.filter((entry) => String(entry).endsWith('.md'))
			.map((entry) => fs.readFileSync(path.join(activityRoot, String(entry)), 'utf8'))
			.join('\n');
		assert.doesNotMatch(activityText, new RegExp(`${startKey}|${finishKey}`));
		assert.match(activityText, /start_unavailable/);

		const recent = await invoke('tracekeeper.agent_activity_recent', {
			max_items: 100,
		}, {
			...fixture.context,
			principalId: 'record-lifecycle-read-only-principal',
			credentialCapabilities: ['vault.read'],
		});
		assert.doesNotMatch(JSON.stringify(recent), new RegExp(`${startKey}|${finishKey}`));
	} finally {
		fixture.cleanup();
	}
});

test('start-unavailable closeout resumes a journaled start and completes the same task identity', async () => {
	const fixture = createFixture();
	try {
		const goal = 'Recover an unknown start_task transport result';
		const startedAt = '2026-08-21T03:00:00.000Z';
		const startKey = 'record-lifecycle-unknown-start-result';
		let injected = false;
		const interruptedStart = await callTool('tracekeeper.start_task', {
			goal,
			started_at: startedAt,
			project_hint: 'record-lifecycle',
			idempotency_key: startKey,
		}, {
			...fixture.context,
			operationFailureInjection({ phase }) {
				if (!injected && phase === 'before_finalize') {
					injected = true;
					throw new Error('simulated lost start response');
				}
			},
		});
		assert.equal(interruptedStart.isError, true);
		assert.equal(injected, true);
		assert.equal(
			fs.existsSync(path.join(fixture.vaultRoot, '00_tracekeeper/work/tasks')),
			false
		);

		const finished = await invoke('tracekeeper.finish_task', {
			goal,
			started_at: startedAt,
			recording_reason: 'start_unavailable',
			start_idempotency_key: startKey,
			status: 'completed',
			summary: 'Recovered the original start identity before closeout.',
			project_hint: 'record-lifecycle',
			idempotency_key: 'record-lifecycle-unknown-start-finish',
		}, fixture.context);
		assert.equal(finished.tracking_mode, 'live');
		assert.equal(finished.task_record_origin, 'start_task');
		assert.equal(finished.start_recovery, 'matched');
		assert.equal(finished.started_at, startedAt);
		assert.equal(finished.started_at_source, 'client_claim');
		const taskFiles = fs.readdirSync(path.join(fixture.vaultRoot, '00_tracekeeper/work/tasks'));
		assert.deepEqual(taskFiles, [`${finished.task_id}.md`]);
		const taskText = fixture.read(finished.task_path);
		assert.match(taskText, /^tracking_mode: "live"$/m);
		assert.match(taskText, /^start_recovery: matched$/m);
		assert.match(taskText, /^recording_reason: start_unavailable$/m);
		assert.match(taskText, /^start_operation_id: "?start-task-[a-f0-9]{24}"?$/m);

		const conflictingRecovery = await callTool('tracekeeper.finish_task', {
			goal: 'A different goal must not claim the recovered start identity',
			started_at: startedAt,
			recording_reason: 'start_unavailable',
			start_idempotency_key: startKey,
			status: 'completed',
			summary: 'Conflicting recovery must fail closed.',
			project_hint: 'record-lifecycle',
			idempotency_key: 'record-lifecycle-conflicting-start-recovery',
		}, fixture.context);
		assert.equal(conflictingRecovery.isError, true);
		assert.match(conflictingRecovery.structuredContent?.error || '', /goal does not match/);
		assert.deepEqual(
			fs.readdirSync(path.join(fixture.vaultRoot, '00_tracekeeper/work/tasks')),
			[`${finished.task_id}.md`]
		);
	} finally {
		fixture.cleanup();
	}
});

test('finish task reconstructs a missing canonical task record without creating an orphan note', async () => {
	const fixture = createFixture();
	try {
		const args = {
			task_id: 'obs_task_missing',
			status: 'completed',
			summary: 'This closeout has no matching start record.',
			outcomes: ['The canonical task record was reconstructed and completed.'],
			next_actions: ['Continue from the reconstructed task history.'],
			decisions: ['Keep start and finish data in one canonical task record.'],
			solution_changes: ['Create the task record during finish when it is missing.'],
			lessons: ['A missing start record should not force an orphan finish note.'],
			preferences: ['Prefer a complete recoverable task record.'],
			project_hint: 'record-lifecycle',
			repo_path: '/workspace/record-lifecycle',
			filename: 'must-not-be-created',
			idempotency_key: 'record-lifecycle-finish-missing-task',
		};
		const taskPath = '00_tracekeeper/work/tasks/obs_task_missing.md';
		let injected = false;
		const interrupted = await callTool('tracekeeper.finish_task', args, {
			...fixture.context,
			operationFailureInjection({ phase, stepName }) {
				if (
					!injected
					&& phase === 'before_step'
					&& stepName === 'finish-task:update-task-record'
				) {
					injected = true;
					throw new Error('interrupt before reconstructed task finalization');
				}
			},
		});
		assert.equal(interrupted.isError, true);
		assert.equal(injected, true);
		const reconstructedText = fixture.read(taskPath);
		assert.match(reconstructedText, /^status: "?closing"?$/m);
		assert.match(reconstructedText, /## Completion Summary\nThis closeout has no matching start record\./);
		assert.match(reconstructedText, /## Outcomes\n- The canonical task record was reconstructed and completed\./);
		assert.match(reconstructedText, /\^finish-finish-task-/);

		const finished = await invoke('tracekeeper.finish_task', args, fixture.context);

		assert.equal(finished.path, taskPath);
		assert.equal(finished.task_path, taskPath);
		assert.equal(finished.session_path, taskPath);
		assert.equal(
			fs.existsSync(path.join(fixture.vaultRoot, '00_tracekeeper/work/sessions')),
			false
		);
		const taskText = fixture.read(taskPath);
		assert.match(taskText, /^tool: "tracekeeper\.finish_task"$/m);
		assert.match(taskText, /^type: "agent-task"$/m);
		assert.match(taskText, /^task_id: "obs_task_missing"$/m);
		assert.match(taskText, /^status: completed$/m);
		assert.match(taskText, /^task_record_origin: "finish_task_reconstruction"$/m);
		assert.match(taskText, /^start_record_missing: true$/m);
		assert.match(taskText, /^started_at: null$/m);
		assert.match(taskText, /^objective_source: "finish_summary"$/m);
		assert.match(taskText, /^objective: "This closeout has no matching start record\."$/m);
		assert.match(taskText, /^reconstructed_at: ".+"$/m);
		assert.match(taskText, /^finished_at: ".+"$/m);
		assert.match(taskText, /## Objective\nThis closeout has no matching start record\./);
		assert.match(taskText, /## Reconstruction\n- start_record: missing/);
		assert.match(taskText, /## Completion Summary\nThis closeout has no matching start record\./);
		assert.match(taskText, /## Outcomes\n- The canonical task record was reconstructed and completed\./);
		assert.match(taskText, /## Next Actions\n- Continue from the reconstructed task history\./);
		assert.match(taskText, /## Decisions\n- Keep start and finish data in one canonical task record\./);
		assert.match(taskText, /## Solution Changes\n- Create the task record during finish when it is missing\./);
		assert.match(taskText, /## Lessons\n- A missing start record should not force an orphan finish note\./);
		assert.match(taskText, /## Preferences\n- Prefer a complete recoverable task record\./);

		const retried = await invoke('tracekeeper.finish_task', args, fixture.context);
		assert.deepEqual(retried, finished);
		assert.equal(
			(fixture.read(taskPath).match(new RegExp(`\\^finish-${finished.operation_id}`, 'g')) || []).length,
			1
		);
	} finally {
		fixture.cleanup();
	}
});

test('unfinished legacy finish operation keeps its original session-note recovery topology', async () => {
	const fixture = createFixture();
	try {
		const task = await startTask(fixture, 'legacy-finish-recovery');
		const args = {
			task_id: task.task_id,
			status: 'completed',
			summary: 'Resume an operation created before single-record closeout.',
			idempotency_key: 'record-lifecycle-finish-legacy-recovery',
		};
		let injected = false;
		const interrupted = await callTool('tracekeeper.finish_task', args, {
			...fixture.context,
			operationFailureInjection({ phase, stepName }) {
				if (
					!injected
					&& phase === 'before_step'
					&& stepName === 'finish-task:update-task-record'
				) {
					injected = true;
					throw new Error('interrupt before single-record closeout');
				}
			},
		});
		assert.equal(interrupted.isError, true);
		assert.equal(injected, true);
		fixture.write(
			task.path,
			fixture.read(task.path).replace(/^finish_request_hash:.*\n/m, '')
		);
		assert.doesNotMatch(fixture.read(task.path), /^finish_request_hash:/m);

		const operationDirectory = path.join(
			fixture.vaultRoot,
			'00_tracekeeper/control/operations'
		);
		const operationFile = fs.readdirSync(operationDirectory)
			.find((entry) => entry.startsWith('finish-task-') && entry.endsWith('.json'));
		assert.ok(operationFile);
		const operationPath = path.join(operationDirectory, operationFile);
		const operationId = path.basename(operationFile, '.json');
		const operation = await new NodeFileOperationJournal({ directory: operationDirectory })
			.loadById(operationId);
		assert.ok(operation);
		delete operation.payload.taskRecordCloseoutVersion;
		delete operation.payload.taskFinishedAt;
		delete operation.payload.requestBindingHash;
		operation.payload_hash = computePayloadHash(operation.payload);
		fs.writeFileSync(operationPath, `${JSON.stringify(operation, null, 2)}\n`, 'utf8');
		fs.rmSync(
			path.join(operationDirectory, `.progress-${operation.operation_id}.anchor`),
			{ force: true }
		);

		const resumed = await invoke('tracekeeper.finish_task', args, fixture.context);
		assert.match(resumed.path, /^00_tracekeeper\/work\/sessions\//);
		assert.notEqual(resumed.path, resumed.task_path);
		const taskText = fixture.read(resumed.task_path);
		assert.match(taskText, new RegExp(`^session_note: "?${resumed.path}"?$`, 'm'));
		assert.match(taskText, /^finish_request_hash: "?[a-f0-9]{64}"?$/m);
		assert.equal(fs.existsSync(path.join(fixture.vaultRoot, resumed.path)), true);
	} finally {
		fixture.cleanup();
	}
});

const withMutableClock = async (initialIso, run) => {
	const NativeDate = globalThis.Date;
	let nowMs = NativeDate.parse(initialIso);
	class MutableDate extends NativeDate {
		constructor(...args) {
			super(...(args.length > 0 ? args : [nowMs]));
		}

		static now() {
			return nowMs;
		}
	}
	globalThis.Date = MutableDate;
	try {
		return await run((nextIso) => {
			nowMs = NativeDate.parse(nextIso);
		});
	} finally {
		globalThis.Date = NativeDate;
	}
};

const auditSection = ({
	id,
	timestamp,
	action,
	source = 'fixture',
}) => [
	`## ${timestamp} ${source}`,
	'- type: mcp.tool_call',
	'- event: mcp.tool_call',
	`- timestamp: ${timestamp}`,
	`- activity_event_id: ${id}`,
	`- action: ${action}`,
	'- tool_name: tracekeeper.status',
	'- result_status: success',
	'- target_paths: []',
	'',
].join('\n');

const auditShard = (day, sections) => [
	'---',
	'type: tracekeeper_agent_activity_shard',
	'agent_activity_schema_version: 1',
	`activity_date: ${day}`,
	`activity_date_utc: ${day}`,
	'agent_activity_hub: 00_tracekeeper/control/agent_activity/index.md',
	'---',
	`# Agent activity ${day}`,
	'',
	'[Audit hub](../index.md)',
	'',
	...sections,
].join('\n');

test('new proposals persist and return a path-independent proposal id', async () => {
	const fixture = createFixture();
	try {
		const task = await startTask(fixture, 'proposal-id');
		const args = {
			task_id: task.task_id,
			proposal_kind: 'decision',
			content: 'Persist stable proposal identity.',
			claim_key: 'global:stable-proposal-identity',
			memory_scope: 'global',
			proposed_authority: 'user',
			proposed_confidence: 'verified',
			declared_state: 'active',
			observed_at: '2026-08-06T00:00:00.000Z',
			evidence: ['01_knowledge/wiki/proposal-identity.md'],
			idempotency_key: 'record-lifecycle-proposal-id',
		};
		const proposal = await invoke('tracekeeper.propose_memory', args, fixture.context);
		assert.equal(typeof proposal.proposal_id, 'string');
		assert.match(proposal.proposal_id, /^proposal-/);
		assert.match(
			fixture.read(proposal.proposal_path),
			new RegExp(`proposal_id: "?${proposal.proposal_id}"?`)
		);
		const restarted = await invoke('tracekeeper.propose_memory', args, {
			...fixture.context,
			vaultRepository: new NodeFsVaultRepository({
				vaultRoot: fixture.vaultRoot,
			}),
		});
		assert.equal(restarted.proposal_id, proposal.proposal_id);
		assert.equal(restarted.proposal_path, proposal.proposal_path);
		const queue = await invoke('tracekeeper.review_queue', {
			action: 'list_pending',
		}, { ...fixture.context, knowledgeReadViewPromise: undefined });
		const entry = queue.entries.find((item) => item.path === proposal.proposal_path);
		assert.ok(entry, JSON.stringify(queue));
		assert.equal(entry.record_identity.claim_key, 'global:stable-proposal-identity');
		assert.equal(entry.proposed_record.authority, 'user');
		assert.equal(entry.proposed_record.confidence_level, 'verified');
		assert.equal(entry.predicted_state, 'review');
		assert.deepEqual(entry.prior_memory_ids, []);
	} finally {
		fixture.cleanup();
	}
});

test('finish task stores proposal ids and generated-link handoff in the task record', async () => {
	const fixture = createFixture();
	try {
		const task = await startTask(fixture, 'finish-links');
		const finished = await invoke('tracekeeper.finish_task', {
			task_id: task.task_id,
			status: 'completed',
			summary: 'Finish with one review proposal.',
			memory_candidate_records: [{
				proposal_kind: 'task_decision',
				content: 'Keep stable proposal joins.',
				scope: 'global',
			}],
			idempotency_key: 'record-lifecycle-finish-links',
		}, fixture.context);
		assert.equal(finished.proposals.length, 1);
		assert.equal(typeof finished.proposals[0].proposal_id, 'string');
		const taskText = fixture.read(`00_tracekeeper/work/tasks/${task.task_id}.md`);
		assert.match(taskText, /proposal_ids:/);
		assert.match(taskText, /proposal_paths:.*review_queue/);
		assert.match(taskText, /proposal_link_targets:.*review_queue/);
		assert.doesNotMatch(taskText, /^proposals: .*review_queue/m);
		assert.doesNotMatch(taskText, /^session_note:/m);
		assert.equal(
			fs.existsSync(path.join(fixture.vaultRoot, '00_tracekeeper/work/sessions')),
			false
		);
	} finally {
		fixture.cleanup();
	}
});

test('finish task persists human links returned by a Vault adapter', async () => {
	const fixture = createFixture();
	try {
		fixture.repository.generateMarkdownLink = (targetPath, sourcePath) =>
			`[[${targetPath}|generated-from-${path.basename(sourcePath, '.md')}]]`;
		const task = await startTask(fixture, 'finish-generated-links');
		const finished = await invoke('tracekeeper.finish_task', {
			task_id: task.task_id,
			status: 'completed',
			summary: 'Finish with an adapter-generated proposal link.',
			memory_candidate_records: [{
				proposal_kind: 'task_decision',
				content: 'Use the native link adapter.',
				scope: 'global',
			}],
			idempotency_key: 'record-lifecycle-finish-generated-links',
		}, fixture.context);
		const proposalPath = finished.proposals[0].path;
		const taskText = fixture.read(`00_tracekeeper/work/tasks/${task.task_id}.md`);
		assert.match(taskText, /proposal_links:/);
		assert.match(taskText, new RegExp(`\\[\\[${proposalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|generated-from-${task.task_id}`));
		assert.match(taskText, /\^tracekeeper-proposal-proposal-/);
		assert.doesNotMatch(taskText, /^session_note:/m);
	} finally {
		fixture.cleanup();
	}
});

test('distill proposals persist stable ids in proposal, task, and session records', async () => {
	const fixture = createFixture();
	try {
		const task = await startTask(fixture, 'distill-ids');
		const distilled = await invoke('tracekeeper.distill_session', {
			task_id: task.task_id,
			filename: 'record-lifecycle-distill',
			summary: 'Distill stable proposal identities.',
			decisions: ['Keep the proposal id path-independent.'],
			possible_preferences: ['Prefer native proposal links.'],
		}, fixture.context);
		assert.equal(distilled.proposal_count, 2);
		for (const proposal of distilled.proposals) {
			assert.match(proposal.proposal_id, /^proposal-/);
			assert.match(
				fixture.read(proposal.path),
				new RegExp(`proposal_id: "?${proposal.proposal_id}"?`)
			);
		}
		const taskText = fixture.read(`00_tracekeeper/work/tasks/${task.task_id}.md`);
		const sessionText = fixture.read(distilled.path);
		for (const proposal of distilled.proposals) {
			assert.match(taskText, new RegExp(proposal.proposal_id));
			assert.match(sessionText, new RegExp(proposal.proposal_id));
		}
		assert.doesNotMatch(taskText, /^proposals:/m);
		assert.doesNotMatch(sessionText, /^proposals:/m);
	} finally {
		fixture.cleanup();
	}
});

test('approved writeback joins and compensates task references by proposal id', async () => {
	const fixture = createFixture();
	try {
		const proposalPath = '00_tracekeeper/inbox/review_queue/writeback.md';
		const taskPath = '00_tracekeeper/work/tasks/writeback-task.md';
		const targetPath = '01_knowledge/wiki/writeback-target.md';
		const writebackContent = 'Stable id writeback.';
		const approvalFrontmatter = approvedProposalFrontmatter({
			proposalId: 'proposal-writeback',
			proposalPath,
			taskId: 'writeback-task',
			targetPath,
			writebackContent,
		});
		fixture.write(targetPath, '# Target\n');
		fixture.write(taskPath, [
			'---',
			'type: agent-task',
			'task_id: writeback-task',
			'status: active',
			'---',
			'# Task',
			'',
		].join('\n'));
		const proposalFields = {
			type: 'memory_proposal',
			proposal_id: 'proposal-writeback',
			proposal_kind: 'decision',
			approval_status: 'approved',
			status: 'approved',
			target_note: targetPath,
			task_id: 'writeback-task',
			...approvalFrontmatter,
		};
		fixture.write(proposalPath, [
			'---',
			...Object.entries(proposalFields).map(
				([key, value]) => `${key}: ${renderFrontmatterValue(value)}`
			),
			'---',
			'## Writeback',
			writebackContent,
			'',
		].join('\n'));
		const preview = await invoke('tracekeeper.apply_approved_writeback', {
			proposal_id: 'proposal-writeback',
			task_id: 'writeback-task',
			dry_run: true,
		}, fixture.context);
		await invoke('tracekeeper.apply_approved_writeback', {
			proposal_id: 'proposal-writeback',
			task_id: 'writeback-task',
			confirmation_token: preview.confirmation_token,
		}, fixture.context);
		const taskText = fixture.read(taskPath);
		assert.match(taskText, /proposal_ids:.*proposal-writeback/);
		assert.match(taskText, /proposal_paths:.*review_queue\/writeback\.md/);
		assert.doesNotMatch(taskText, /^proposals: .*review_queue/m);
	} finally {
		fixture.cleanup();
	}
});

test('approved writeback refuses an id duplicated across active and archive history', async () => {
	const fixture = createFixture();
	try {
		const duplicate = [
			'---',
			'type: memory_proposal',
			'proposal_id: proposal-duplicate',
			'proposal_kind: decision',
			'status: approved',
			'---',
			'## Writeback',
			'Duplicate identity must not be selected.',
			'',
		].join('\n');
		fixture.write(
			'00_tracekeeper/inbox/review_queue/duplicate-active.md',
			duplicate
		);
		fixture.write(
			'02_archive/review_queue/duplicate-archive.md',
			duplicate
		);
		const result = await callTool('tracekeeper.apply_approved_writeback', {
			proposal_id: 'proposal-duplicate',
			dry_run: true,
		}, fixture.context);
		assert.equal(result.isError, true);
		assert.match(
			String(result.structuredContent?.error || ''),
			/ambiguous/i
		);
	} finally {
		fixture.cleanup();
	}
});

test('concurrent MCP Agent activity uses one idempotent UTC shard', async () => {
	const fixture = createFixture();
	try {
		await withMutableClock('2026-07-30T23:59:59.000Z', async (setNow) => {
			await Promise.all(Array.from({ length: 8 }, (_, index) => invoke(
				'tracekeeper.status',
				{},
				{
					...fixture.context,
					sessionId: `record-lifecycle-audit-${index}`,
					requestId: `record-lifecycle-request-${index}`,
				}
			)));
			const dayOnePath = '00_tracekeeper/control/agent_activity/2026/2026-07-30.md';
			const dayOne = fixture.read(dayOnePath);
			const dayOneIds = [...dayOne.matchAll(/^- activity_event_id:\s*(.+)$/gm)]
				.map((match) => match[1]);
			assert.equal(new Set(dayOneIds).size, dayOneIds.length);
			assert.equal(dayOneIds.length, 8);
			assert.match(dayOne, /^---\n/);
			assert.match(dayOne, /type:\s*tracekeeper_agent_activity_shard/);
			assert.match(dayOne, /activity_date:\s*2026-07-30/);
			assert.match(dayOne, /activity_date_utc:\s*2026-07-30/);
			assert.match(dayOne, /Agent activity hub/);
			const auditHubPath = '00_tracekeeper/control/agent_activity/index.md';
			const auditHub = fixture.read(auditHubPath);
			assert.equal(
				auditHub,
				renderAgentActivityHub('2026-07-30T23:59:59.000Z')
			);

			setNow('2026-07-31T00:00:00.000Z');
			await invoke('tracekeeper.status', {}, {
				...fixture.context,
				sessionId: 'record-lifecycle-audit-next-day',
				requestId: 'record-lifecycle-request-next-day',
			});
			const dayTwoPath = '00_tracekeeper/control/agent_activity/2026/2026-07-31.md';
			const dayTwo = fixture.read(dayTwoPath);
			assert.match(dayTwo, /activity_date:\s*2026-07-31/);
			assert.equal(dayTwo.includes(dayOneIds[0]), false);

			const task = await startTask(fixture, 'audit-retry');
			const args = {
				task_id: task.task_id,
				proposal_kind: 'decision',
				content: 'Retry one proposal audit event.',
				memory_scope: 'global',
				idempotency_key: 'record-lifecycle-audit-retry',
			};
			await invoke('tracekeeper.propose_memory', args, fixture.context);
			const restartedRepository = new NodeFsVaultRepository({
				vaultRoot: fixture.vaultRoot,
			});
			await invoke('tracekeeper.propose_memory', args, {
				...fixture.context,
				vaultRepository: restartedRepository,
			});
			const afterRetry = fixture.read(dayTwoPath);
			assert.equal(
				[...afterRetry.matchAll(/action: tracekeeper\.propose_memory/g)].length,
				2
			);

			const secretMarker = 'record-lifecycle-secret-marker';
			await invoke('tracekeeper.status', {}, {
				...fixture.context,
				clientName: `bounded-client-${'x'.repeat(20_000)}-${secretMarker}`,
				writebackConfirmationSecret: secretMarker,
				sessionId: 'record-lifecycle-bounded-audit',
				requestId: 'record-lifecycle-bounded-request',
			});
			const bounded = fixture.read(dayTwoPath);
			assert.equal(bounded.includes(fixture.vaultRoot), false);
			assert.equal(bounded.includes(secretMarker), false);
			assert.ok(Buffer.byteLength(bounded, 'utf8') < 64 * 1024);
			assert.equal(fixture.read(auditHubPath), auditHub);
		});
	} finally {
		fixture.cleanup();
	}
});

test('MCP Agent activity append preserves an existing legacy Hub byte-for-byte', async () => {
	const fixture = createFixture();
	try {
		const auditHubPath = '00_tracekeeper/control/agent_activity/index.md';
		const legacyHub = [
			'---',
			`type: ${AGENT_ACTIVITY_HUB_TYPE}`,
			`agent_activity_schema_version: ${AGENT_ACTIVITY_SCHEMA_VERSION}`,
			'created_at: 2025-01-01T00:00:00.000Z',
			'---',
			'# Custom legacy Agent activity Hub',
			'',
			'This user-owned body must remain byte-identical.',
			'',
		].join('\n');
		fixture.write(auditHubPath, legacyHub);

		await invoke('tracekeeper.status', {}, {
			...fixture.context,
			requestId: 'record-lifecycle-legacy-hub',
		});

		assert.equal(fixture.read(auditHubPath), legacyHub);
	} finally {
		fixture.cleanup();
	}
});

test('reused JSON-RPC ids remain observations while every tools/call keeps a unique invocation audit', async () => {
	const fixture = createFixture();
	try {
		await withMutableClock('2026-07-30T12:00:00.000Z', async () => {
			const handler = new McpJsonRpcHandler({
				defaultVaultRoot: fixture.vaultRoot,
				vaultRepository: fixture.repository,
				runtimeVersion: 'test',
				transport: 'test',
			});
			const connectionState = (sessionId) => ({
				sessionId,
				principalId: 'record-lifecycle-principal',
				credentialCapabilities: ['*'],
				agentId: 'record-lifecycle-rpc-client',
				clientName: 'record-lifecycle-rpc-client',
				clientVersion: '1',
				observedClientType: 'custom',
				initialized: true,
				protocolVersion: '2025-06-18',
			});
			const firstSession = connectionState('record-lifecycle-rpc-session-one');
			const secondSession = connectionState('record-lifecycle-rpc-session-two');
			const calls = [
				[firstSession, 1],
				[firstSession, 1],
				[firstSession, '1'],
				[secondSession, 1],
				[secondSession, '1'],
			];

			for (const [state, id] of calls) {
				const response = await handler.handleMessage({
					jsonrpc: '2.0',
					id,
					method: 'tools/call',
					params: {
						name: 'tracekeeper.status',
						arguments: {},
					},
				}, state);
				assert.equal(response?.id, id);
				assert.equal(response?.error, undefined);
			}
			const rejectedCalls = [
				{
					state: firstSession,
					id: 1,
					params: { name: '', arguments: {} },
				},
				{
					state: secondSession,
					id: '1',
					params: { name: 'tracekeeper.status', arguments: [] },
				},
				{
					state: firstSession,
					id: 1,
					params: [],
				},
			];
			for (const { state, id, params } of rejectedCalls) {
				const response = await handler.handleMessage({
					jsonrpc: '2.0',
					id,
					method: 'tools/call',
					params,
				}, state);
				assert.equal(response?.id, id);
				assert.equal(response?.error?.code, -32602);
			}

			const audit = fixture.read(
				'00_tracekeeper/control/agent_activity/2026/2026-07-30.md'
			);
			const expectedCallCount = calls.length + rejectedCalls.length;
			const eventIds = [...audit.matchAll(/^- activity_event_id:\s*(.+)$/gm)]
				.map((match) => match[1]);
			const invocationIds = [...audit.matchAll(/^- invocation_id:\s*(.+)$/gm)]
				.map((match) => match[1]);
			assert.equal(eventIds.length, expectedCallCount);
			assert.equal(new Set(eventIds).size, expectedCallCount);
			assert.equal(invocationIds.length, expectedCallCount);
			assert.equal(new Set(invocationIds).size, expectedCallCount);
			assert.equal(
				[...audit.matchAll(/^- request_id: "1"$/gm)].length,
				expectedCallCount
			);
			assert.equal(
				[...audit.matchAll(/^- result_status: "failed"$/gm)].length,
				rejectedCalls.length
			);
			assert.match(audit, /- diagnostic_reason: "tool_call_invalid_params"/);
		});
	} finally {
		fixture.cleanup();
	}
});

test('Agent activity reader ignores legacy audit history and reads canonical shards', async () => {
	const fixture = createFixture();
	try {
		const legacyPath = '00_tracekeeper/control/audit_log.md';
		const shardPath = '00_tracekeeper/control/agent_activity/2026/2026-07-30.md';
		fixture.write(legacyPath, [
			'# Audit Log',
			'',
			auditSection({
				id: 'audit-shared',
				timestamp: '2026-07-30T01:00:00.000Z',
				action: 'legacy-shared',
				source: 'legacy-shared',
			}),
			auditSection({
				id: 'audit-legacy-only',
				timestamp: '2026-07-30T00:30:00.000Z',
				action: 'legacy-only',
				source: 'legacy-only',
			}),
		].join('\n'));
		fixture.write(shardPath, auditShard('2026-07-30', [
			auditSection({
				id: 'audit-shared',
				timestamp: '2026-07-30T01:00:00.000Z',
				action: 'shard-shared',
				source: 'shard-shared',
			}),
			auditSection({
				id: 'audit-shard-only',
				timestamp: '2026-07-30T02:00:00.000Z',
				action: 'shard-only',
				source: 'shard-only',
			}),
		]));

		const recent = await invoke('tracekeeper.agent_activity_recent', {
			max_items: 20,
		}, fixture.context);
		assert.equal(recent.total_sections, 2);
		const serialized = JSON.stringify(recent.sections);
		assert.equal((serialized.match(/audit-shared/g) || []).length, 1);
		assert.doesNotMatch(serialized, /audit-legacy-only/);
		assert.match(serialized, /audit-shard-only/);
		assert.match(serialized, new RegExp(shardPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		assert.equal(recent.sections[0].source_path, shardPath);

		const handler = new McpJsonRpcHandler({
			defaultVaultRoot: fixture.vaultRoot,
			vaultRepository: fixture.repository,
		});
		const state = {
			sessionId: 'record-lifecycle-resource-session',
			principalId: 'record-lifecycle-principal',
			credentialCapabilities: ['*'],
			agentId: 'record-lifecycle-agent',
			clientName: 'record-lifecycle-test',
			clientVersion: 'test',
			observedClientType: 'other',
			protocolVersion: '2025-06-18',
		};
		const resource = await handler.handleMessage({
			jsonrpc: '2.0',
			id: 1,
			method: 'resources/read',
			params: { uri: 'tracekeeper://agent-activity' },
		}, state);
		const resourceText = resource.result.contents[0].text;
		assert.equal((resourceText.match(/audit-shared/g) || []).length, 1);
		assert.doesNotMatch(resourceText, /audit-legacy-only/);
		assert.match(resourceText, /audit-shard-only/);
		assert.match(resourceText, /source_path:\s*00_tracekeeper\/control\/agent_activity\/2026\/2026-07-30\.md/);
	} finally {
		fixture.cleanup();
	}
});
