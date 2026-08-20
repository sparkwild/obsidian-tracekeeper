#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-activity-view-model-test-'));
const output = path.join(tempRoot, 'activity-view-model.mjs');

const coreStub = {
	name: 'tracekeeper-core-stub',
	setup(buildContext) {
		const proposalWritebackPath = path.resolve('../../packages/core/dist/proposal-writeback.js');
		buildContext.onResolve({ filter: /^@tracekeeper\/core$/ }, () => ({
			path: 'tracekeeper-core-stub',
			namespace: 'tracekeeper-core-stub',
		}));
		buildContext.onResolve({ filter: /proposal-writeback\.js$/ }, () => ({
			path: proposalWritebackPath,
		}));
		buildContext.onLoad(
			{ filter: /.*/, namespace: 'tracekeeper-core-stub' },
				() => ({
					loader: 'js',
					contents: `
						export { resolveProposalWriteback } from ${JSON.stringify(proposalWritebackPath)};
						export const TRACEKEEPER_REVIEW_QUEUE_DIR = '00_tracekeeper/inbox/review_queue';
						export const ARCHIVE_REVIEW_QUEUE_DIR = '02_archive/review_queue';
						export const isKnowledgeWikiPath = (path) => path.startsWith('01_knowledge/wiki/');
						export const isKnowledgeMemoryPath = (path) => path.startsWith('01_knowledge/memory/');
						export const normalizeVaultRelativePath = (value) => {
							const replaced = String(value).split(String.fromCharCode(92)).join('/').trim();
							if (
								!replaced ||
								replaced.includes('\\0') ||
								replaced.startsWith('/') ||
								/^[A-Za-z]:/.test(replaced)
							) {
								throw new Error('Unsafe Vault-relative path');
							}
							const normalized = replaced.split('/').filter(Boolean).join('/');
							if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
								throw new Error('Unsafe Vault-relative path');
							}
							return normalized;
						};
					`,
				})
			);
	},
};

const runtimeStatus = (overrides = {}) => ({
	enabled: true,
	state: 'running',
	port: 51601,
	lastError: '',
	...overrides,
});

const actionInput = (overrides = {}) => ({
	structureState: 'initialized',
	runtimeStatus: runtimeStatus(),
	actionableReviewQueueItemCount: 0,
	agedWorkflowCount: 0,
	permissionDeniedCount: 0,
	...overrides,
});

const agent = (overrides = {}) => ({
	principalId: 'principal-codex',
	integrationId: 'integration-codex',
	credentialId: 'credential-codex',
	authMode: 'oauth',
	agentId: 'codex',
	sessionId: 'session-codex',
	clientName: 'codex',
	observedClientNameRaw: 'Codex',
	observedClientType: 'codex',
	observedClientVersion: '1.2.3',
	displayName: 'Codex',
	transport: 'streamable-http',
	status: 'active',
	lastSeen: '2026-07-28T03:00:00.000Z',
	lastToolCall: 'recall',
	connectedAt: '2026-07-28T02:00:00.000Z',
	resultStatus: 'success',
	lastUsedAt: '2026-07-28T03:00:00.000Z',
	lastSuccessfulTool: 'tracekeeper.recall',
	runtimeVersion: '0.2.4',
	permissionProfile: 'knowledge-assistant',
	sortTimestamp: Date.parse('2026-07-28T03:00:00.000Z'),
	...overrides,
});

const auditEvent = (overrides = {}) => ({
	auditId: 'audit-event',
	sortTimestamp: Date.parse('2026-08-12T13:04:19.489Z'),
	eventType: 'mcp.authentication_rejected',
	authMode: '',
	diagnosticReason: 'auth_missing',
	resultStatus: 'failed',
	...overrides,
});

const task = (overrides = {}) => ({
	status: 'completed',
	sessionNote: '00_tracekeeper/work/sessions/task-one.md',
	memoryWrites: [],
	sourceCaptures: [],
	proposalIds: [],
	proposalPaths: [],
	proposals: [],
	durableOutputStatusAtFinish: '',
	durableOutputProposalCount: 0,
	durableOutputSourceCaptureCount: 0,
	durableOutputPendingReviewCount: 0,
	durableOutputReadyToApplyCount: 0,
	durableOutputRevisionRequestedCount: 0,
	durableOutputAppliedCount: 0,
	durableOutputRejectedCount: 0,
	durableOutputUnresolvedCount: 0,
	durableOutputProposalIdsAtFinish: [],
	durableOutputAppliedProposalIds: [],
	durableOutputProposalPaths: [],
	durableOutputTargetPaths: [],
	...overrides,
});

try {
	await build({
		entryPoints: [path.resolve('src/features/activity/activity-view-model.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
		plugins: [coreStub],
	});
	const {
		buildActivityAgentSummary,
		buildSuccessfullyUsedAgentSummary,
		countTaskDurableMemoryWrites,
		countTaskProposalReferences,
		countTaskSourceCaptureEvidence,
		selectLatestTaskPlacement,
		selectActivityPrimaryAction,
		selectTaskDurableOutputPresentationStatus,
		selectTaskExecutionPresentationStatus,
		projectDurableOutputTargetPaths,
		selectRecentTimelineAuditEvents,
		taskProposalNavigationPaths,
		taskSnapshotProposalIdsAreFullyApplied,
	} = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

	assert.equal(
		selectActivityPrimaryAction(actionInput({
			structureState: 'partial',
			runtimeStatus: runtimeStatus({ enabled: false, state: 'stopped' }),
			actionableReviewQueueItemCount: 3,
		})),
		'repair_structure'
	);
	assert.equal(
		selectActivityPrimaryAction(actionInput({
			runtimeStatus: runtimeStatus({ enabled: true, state: 'failed', lastError: 'boom' }),
			actionableReviewQueueItemCount: 3,
		})),
		'recover_runtime'
	);
	assert.equal(
		selectActivityPrimaryAction(actionInput({
			actionableReviewQueueItemCount: 3,
		})),
		'review_changes'
	);
	assert.equal(
		selectActivityPrimaryAction(actionInput({
			actionableReviewQueueItemCount: 3,
			agedWorkflowCount: 1,
		})),
		'review_changes'
	);
	assert.equal(
		selectActivityPrimaryAction(actionInput({ permissionDeniedCount: 1 })),
		'inspect_diagnostics'
	);
	assert.equal(
		selectActivityPrimaryAction(actionInput({
			runtimeStatus: runtimeStatus({ state: 'starting' }),
		})),
		'none'
	);
	assert.equal(selectActivityPrimaryAction(actionInput()), 'none');

	const recoveredChallenge = auditEvent();
	const recoveredConnection = auditEvent({
		auditId: 'audit-connection',
		sortTimestamp: Date.parse('2026-08-12T13:04:19.595Z'),
		eventType: 'mcp.connection',
		authMode: 'oauth',
		diagnosticReason: '',
		resultStatus: 'success',
	});
	const successfulToolCall = auditEvent({
		auditId: 'audit-tool-call',
		sortTimestamp: Date.parse('2026-08-12T13:03:50.000Z'),
		eventType: 'mcp.tool_call',
		diagnosticReason: '',
		resultStatus: 'success',
	});
	assert.deepEqual(
		selectRecentTimelineAuditEvents([
			recoveredChallenge,
			successfulToolCall,
			recoveredConnection,
		], 5).map((event) => event.auditId),
		['audit-tool-call']
	);

	const latestUnrecoveredMissing = auditEvent({
		auditId: 'audit-missing-latest',
		sortTimestamp: Date.parse('2026-08-12T13:05:00.000Z'),
	});
	const earlierUnrecoveredMissing = auditEvent({
		auditId: 'audit-missing-earlier',
		sortTimestamp: Date.parse('2026-08-12T13:04:00.000Z'),
	});
	const invalidCredential = auditEvent({
		auditId: 'audit-invalid',
		sortTimestamp: Date.parse('2026-08-12T13:04:30.000Z'),
		diagnosticReason: 'auth_invalid',
	});
	const queryTokenRejected = auditEvent({
		auditId: 'audit-query-token',
		sortTimestamp: Date.parse('2026-08-12T13:04:15.000Z'),
		diagnosticReason: 'query_token_rejected',
	});
	assert.deepEqual(
		selectRecentTimelineAuditEvents([
			earlierUnrecoveredMissing,
			queryTokenRejected,
			invalidCredential,
			latestUnrecoveredMissing,
		], 5).map((event) => event.auditId),
		['audit-missing-latest', 'audit-invalid', 'audit-query-token']
	);
	const delayedOAuthConnection = {
		...recoveredConnection,
		auditId: 'audit-delayed-oauth-connection',
		sortTimestamp: Date.parse('2026-08-12T13:04:22.000Z'),
	};
	assert.deepEqual(
		selectRecentTimelineAuditEvents([recoveredChallenge, delayedOAuthConnection], 5)
			.map((event) => event.auditId),
		['audit-event']
	);
	assert.deepEqual(
		selectRecentTimelineAuditEvents([
			recoveredChallenge,
			{ ...recoveredConnection, auditId: 'audit-bearer-connection', authMode: 'bearer' },
		], 5).map((event) => event.auditId),
		['audit-event']
	);
	assert.deepEqual(selectRecentTimelineAuditEvents([invalidCredential], 0), []);
	assert.equal(selectLatestTaskPlacement(null), 'hidden');
	for (const status of ['completed', 'done', 'success']) {
		assert.equal(selectLatestTaskPlacement({ status }), 'memory_loop');
	}
	for (const status of ['active', 'running', 'failed', 'error', 'interrupted', 'unknown']) {
		assert.equal(selectLatestTaskPlacement({ status }), 'standalone');
	}

	for (const status of ['completed', 'done', 'success']) {
		assert.equal(selectTaskExecutionPresentationStatus(task({ status })), 'completed');
	}
	for (const status of ['partial', 'partial_complete', 'partially_complete', 'partly_complete']) {
		assert.equal(selectTaskExecutionPresentationStatus(task({ status })), 'partially_complete');
	}
	for (const status of ['interrupted', 'blocked', 'failed', 'error', 'cancelled', 'canceled', 'timed_out']) {
		assert.equal(selectTaskExecutionPresentationStatus(task({ status })), 'blocked');
	}
	for (const status of ['active', 'running', 'in_progress']) {
		assert.equal(selectTaskExecutionPresentationStatus(task({ status })), 'running');
	}
	assert.equal(selectTaskExecutionPresentationStatus(task({ status: 'unknown' })), 'in_progress');

	for (const status of [
		'none',
		'pending_review',
		'ready_to_apply',
		'revision_requested',
		'applied',
		'rejected',
		'unresolved',
		'mixed',
	]) {
		assert.equal(
			selectTaskDurableOutputPresentationStatus(task({ durableOutputStatusAtFinish: status })),
			status
		);
	}
	assert.equal(
		selectTaskDurableOutputPresentationStatus(task({
			durableOutputStatusAtFinish: 'pending_review',
			durableOutputProposalIdsAtFinish: ['proposal-one'],
			durableOutputTargetPaths: ['01_knowledge/wiki/preexisting.md'],
			memoryWrites: ['01_knowledge/wiki/preexisting.md'],
		})),
		'pending_review',
		'a pre-existing write to the same target must not advance a pending proposal'
	);
	assert.equal(
		selectTaskDurableOutputPresentationStatus(task({
			durableOutputStatusAtFinish: 'pending_review',
			durableOutputProposalIdsAtFinish: ['proposal-one'],
			durableOutputAppliedProposalIds: ['proposal-one'],
			durableOutputTargetPaths: ['01_knowledge/wiki/applied-after-finish.md'],
		})),
		'applied',
		'all frozen snapshot proposal ids applied after finish must advance pending to applied'
	);
	assert.equal(
		selectTaskDurableOutputPresentationStatus(task({
			durableOutputStatusAtFinish: 'pending_review',
			durableOutputProposalIdsAtFinish: ['proposal-one', 'proposal-two'],
			durableOutputAppliedProposalIds: ['proposal-one'],
		})),
		'pending_review',
		'a partial applied-id set must preserve the original pending state'
	);
	assert.equal(
		selectTaskDurableOutputPresentationStatus(task({
			durableOutputStatusAtFinish: 'mixed',
			durableOutputProposalIdsAtFinish: ['proposal-one', 'proposal-two'],
			durableOutputAppliedProposalIds: ['proposal-one'],
		})),
		'mixed',
		'a partial applied-id set must not hide a mixed snapshot'
	);
	assert.equal(
		selectTaskDurableOutputPresentationStatus(task({
			durableOutputStatusAtFinish: 'mixed',
			durableOutputProposalIdsAtFinish: ['proposal-one', 'proposal-two'],
			durableOutputAppliedProposalIds: ['proposal-one', 'proposal-two'],
		})),
		'applied',
		'a fully applied mixed snapshot with no rejected or unresolved outcomes may advance to applied'
	);
	assert.equal(
		selectTaskDurableOutputPresentationStatus(task({
			durableOutputStatusAtFinish: 'mixed',
			durableOutputProposalIdsAtFinish: ['proposal-one', 'proposal-two'],
			durableOutputAppliedProposalIds: ['proposal-one', 'proposal-two'],
			durableOutputRejectedCount: 1,
		})),
		'mixed',
		'rejected evidence must preserve a mixed snapshot even when every frozen id has applied evidence'
	);
	assert.equal(
		selectTaskDurableOutputPresentationStatus(task({
			durableOutputStatusAtFinish: 'mixed',
			durableOutputProposalIdsAtFinish: ['proposal-one', 'proposal-two'],
			durableOutputAppliedProposalIds: ['proposal-one', 'proposal-two'],
			durableOutputUnresolvedCount: 1,
		})),
		'mixed',
		'unresolved evidence must preserve a mixed snapshot even when every frozen id has applied evidence'
	);
	assert.equal(
		selectTaskDurableOutputPresentationStatus(task({
			durableOutputStatusAtFinish: 'rejected',
			durableOutputProposalIdsAtFinish: ['proposal-rejected'],
			durableOutputAppliedProposalIds: ['proposal-rejected'],
		})),
		'rejected',
		'a rejected snapshot is not optimistically reclassified'
	);
	assert.equal(
		selectTaskDurableOutputPresentationStatus(task({
			durableOutputStatusAtFinish: 'unresolved',
			durableOutputProposalIdsAtFinish: ['proposal-unresolved'],
			durableOutputAppliedProposalIds: ['proposal-unresolved'],
		})),
		'unresolved',
		'an unresolved snapshot is not optimistically reclassified'
	);
	assert.equal(
		selectTaskDurableOutputPresentationStatus(task({ proposalIds: ['proposal-legacy'] })),
		'legacy_proposals'
	);
	assert.equal(
		selectTaskDurableOutputPresentationStatus(task({ proposalPaths: ['00_tracekeeper/inbox/review_queue/legacy.md'] })),
		'legacy_proposals'
	);
	assert.equal(
		selectTaskDurableOutputPresentationStatus(task({ memoryWrites: ['01_knowledge/wiki/legacy-write.md'] })),
		'applied',
		'legacy tasks retain their durable-write fallback'
	);
	assert.equal(selectTaskDurableOutputPresentationStatus(task()), 'none');
	assert.equal(
		taskSnapshotProposalIdsAreFullyApplied(task({
			durableOutputProposalIdsAtFinish: ['proposal-one', 'proposal-two'],
			durableOutputAppliedProposalIds: ['proposal-one', 'proposal-two'],
		})),
		true
	);
	assert.equal(
		taskSnapshotProposalIdsAreFullyApplied(task({
			durableOutputProposalIdsAtFinish: ['proposal-one', 'proposal-two'],
			durableOutputAppliedProposalIds: ['proposal-one'],
		})),
		false
	);
	assert.equal(taskSnapshotProposalIdsAreFullyApplied(task()), false);
	assert.deepEqual(
		taskProposalNavigationPaths(task({
			proposalPaths: ['00_tracekeeper/inbox/review_queue/current.md'],
			durableOutputProposalPaths: [
				'00_tracekeeper/inbox/review_queue/current.md',
				'02_archive/review_queue/processed.md',
				'01_knowledge/wiki/not-a-proposal.md',
				'00_tracekeeper/inbox/review_queue/../outside.md',
			],
		})),
		[
			'00_tracekeeper/inbox/review_queue/current.md',
			'02_archive/review_queue/processed.md',
		]
	);
	assert.deepEqual(
		projectDurableOutputTargetPaths(task({
			durableOutputTargetPaths: [
				'01_knowledge/wiki/alpha.md',
				'01_knowledge/wiki/../forbidden.md',
				'01_knowledge/memory/beta.md',
				'01_knowledge/wiki/./bad.md',
				'03_sources/file.md',
				'/01_knowledge/wiki/abs.md',
				'notes.txt',
				'01_knowledge/wiki/alpha.md',
			],
		})),
		[
			'01_knowledge/wiki/alpha.md',
			'01_knowledge/memory/beta.md',
		]
	);
	assert.equal(
		countTaskDurableMemoryWrites(task({
			memoryWrites: [
				'00_tracekeeper/work/sessions/task-one.md',
				'01_knowledge/wiki/durable.md',
			],
		})),
		1
	);
	assert.equal(
		countTaskProposalReferences(task({
			proposalIds: ['proposal-one'],
			proposalPaths: ['proposal-one.md', 'proposal-two.md'],
			durableOutputProposalCount: 3,
			durableOutputProposalIdsAtFinish: ['proposal-one', 'proposal-two', 'proposal-three'],
			durableOutputProposalPaths: ['proposal-one.md', 'proposal-two.md', 'proposal-three.md'],
		})),
		3
	);
	assert.equal(
		countTaskSourceCaptureEvidence(task({
			sourceCaptures: ['source-one.md'],
			durableOutputSourceCaptureCount: 2,
		})),
		2
	);
	assert.equal(
		countTaskSourceCaptureEvidence(task({
			sourceCaptures: ['source-one.md'],
			durableOutputSourceCaptureCount: 0,
		})),
		1,
		'legacy source references remain visible when no finish snapshot count exists'
	);

	assert.deepEqual(buildActivityAgentSummary([]), {
		state: 'not_observed',
		observedAgentCount: 0,
		agentGroups: [],
	});
	const latest = agent();
	const earlierCodexSession = agent({
		agentId: 'codex-session-two',
		sessionId: 'session-codex-two',
		lastToolCall: 'start_task',
		sortTimestamp: Date.parse('2026-07-27T12:00:00.000Z'),
	});
	const claude = agent({
		principalId: 'principal-codex',
		clientName: 'claude-code',
		observedClientNameRaw: 'Claude Code',
		observedClientType: 'claude-code',
		displayName: 'Claude Code',
		connectedAt: '2026-07-27T02:00:00.000Z',
		lastUsedAt: '',
		lastSuccessfulTool: '',
		sortTimestamp: Date.parse('2026-07-27T03:00:00.000Z'),
	});
	assert.deepEqual(buildActivityAgentSummary([latest, earlierCodexSession, claude]), {
		state: 'observed',
		observedAgentCount: 2,
		agentGroups: [
			{
				displayName: 'Codex',
				observedClientType: 'codex',
				sessionCount: 2,
				lastConnectedAt: Date.parse('2026-07-28T02:00:00.000Z'),
				lastUsedAt: Date.parse('2026-07-28T03:00:00.000Z'),
				sortTimestamp: Date.parse('2026-07-28T03:00:00.000Z'),
			},
			{
				displayName: 'Claude Code',
				observedClientType: 'claude-code',
				sessionCount: 1,
				lastConnectedAt: Date.parse('2026-07-27T02:00:00.000Z'),
				lastUsedAt: 0,
				sortTimestamp: Date.parse('2026-07-27T03:00:00.000Z'),
			},
		],
	});

	const toolCallOnly = agent({
		clientName: 'cursor',
		observedClientNameRaw: 'Cursor',
		observedClientType: 'cursor',
		displayName: 'Cursor',
		connectedAt: '',
	});
	const failedUse = agent({
		clientName: 'custom',
		observedClientNameRaw: 'Custom client',
		observedClientType: 'custom',
		displayName: 'Custom client',
		resultStatus: 'failed',
	});
	const pluginDirect = agent({
		agentId: 'tracekeeper-plugin-ui',
		sessionId: 'plugin-ui-session',
		clientName: 'tracekeeper-plugin-ui',
		observedClientNameRaw: 'tracekeeper-plugin-ui',
		observedClientType: 'custom',
		displayName: 'Custom client',
		transport: 'obsidian-direct',
	});
	const sessionless = agent({
		agentId: 'legacy-agent',
		sessionId: '',
	});
	assert.deepEqual(
		buildSuccessfullyUsedAgentSummary([
			latest,
			earlierCodexSession,
			claude,
			toolCallOnly,
			failedUse,
			pluginDirect,
			sessionless,
		]),
		{
			state: 'observed',
			observedAgentCount: 2,
			agentGroups: [
				{
					displayName: 'Codex',
					observedClientType: 'codex',
					sessionCount: 2,
					lastConnectedAt: Date.parse('2026-07-28T02:00:00.000Z'),
					lastUsedAt: Date.parse('2026-07-28T03:00:00.000Z'),
					sortTimestamp: Date.parse('2026-07-28T03:00:00.000Z'),
				},
				{
					displayName: 'Cursor',
					observedClientType: 'cursor',
					sessionCount: 1,
					lastConnectedAt: 0,
					lastUsedAt: Date.parse('2026-07-28T03:00:00.000Z'),
					sortTimestamp: Date.parse('2026-07-28T03:00:00.000Z'),
				},
			],
		}
	);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 72 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
