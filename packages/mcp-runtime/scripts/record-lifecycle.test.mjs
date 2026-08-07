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
	computeProposalContentHash,
	computeProposalRevision,
	NodeFsVaultRepository,
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

const startTask = async (fixture, suffix) => invoke('tracekeeper.start_task', {
	goal: `Record lifecycle ${suffix}`,
	project_hint: 'record-lifecycle',
	idempotency_key: `record-lifecycle-start-${suffix}`,
}, fixture.context);

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

test('finish task stores proposal ids and generated-link handoff in task and session records', async () => {
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
		const sessionPath = taskText.match(/^session_note:\s*(.+)$/m)?.[1]?.trim();
		assert.ok(sessionPath);
		const sessionText = fixture.read(sessionPath);
		assert.match(sessionText, /proposal_ids:/);
		assert.match(sessionText, /proposal_paths:.*review_queue/);
		assert.match(sessionText, /proposal_link_targets:.*review_queue/);
		assert.doesNotMatch(
			sessionText,
			/\[\[.*review_queue.*\]\]|\[.*\]\(.*review_queue.*\)/
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
		const sessionPath = taskText.match(/^session_note:\s*(.+)$/m)?.[1]?.trim();
		assert.ok(sessionPath);
		for (const recordText of [taskText, fixture.read(sessionPath)]) {
			assert.match(recordText, /proposal_links:/);
			assert.match(recordText, new RegExp(`\\[\\[${proposalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|generated-from-`));
			assert.match(recordText, /\^tracekeeper-proposal-proposal-/);
		}
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
			assert.match(auditHub, /type:\s*tracekeeper_agent_activity_hub/);
			assert.match(auditHub, /^# Agent activity$/m);

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
