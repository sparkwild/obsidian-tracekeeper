#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const activitySource = fs.readFileSync('src/features/activity/activity-view.ts', 'utf8');
const runtimeStatusSource = fs.readFileSync('src/features/runtime/runtime-status-view.ts', 'utf8');
const activityControllerSource = fs.readFileSync('src/features/activity/activity-data-controller.ts', 'utf8');

const orderedCalls = [
	'this.renderAgentActivitySection(contentEl, snapshot)',
	'this.renderPrimaryAction(contentEl, snapshot, primaryAction)',
	'this.renderLatestTaskSection(contentEl, snapshot)',
	'this.renderMemoryLoopSection(contentEl, snapshot)',
	'this.renderSourceActivitySection(contentEl, snapshot)',
	'this.renderRecentEventsSection(contentEl, snapshot)',
	'this.renderWorkflowDiagnosticsSection(contentEl, snapshot.workflowDiagnostics)',
];

let previousIndex = -1;
for (const call of orderedCalls) {
	const index = activitySource.indexOf(call);
	assert.ok(index > previousIndex, `${call} must appear in the task-oriented Activity order`);
	previousIndex = index;
}

assert.ok(activitySource.includes('selectActivityPrimaryAction'));
assert.ok(activitySource.includes('buildActivityAgentSummary'));
assert.ok(activitySource.includes("createEl('details'"));
assert.ok(activitySource.includes("ui('高级诊断', 'Advanced diagnostics')"));
assert.equal(activitySource.includes('tracekeeper-review-queue-button--action'), false);
assert.equal((activitySource.match(/cls: 'mod-cta'/g) || []).length, 1);
assert.ok(activitySource.includes("ui('Agent 活动', 'Agent activity')"));
assert.ok(activitySource.includes('agentGroups'));
assert.ok(activitySource.includes('sessionCount'));
assert.ok(activitySource.includes("ui('最近连接', 'Last connected')"));
assert.ok(activitySource.includes("ui('最近成功使用', 'Last successful use')"));
assert.ok(activitySource.includes('self-reported'));
assert.ok(activitySource.includes('Manage Agent setup'));
assert.ok(activitySource.includes('currently online'));
assert.equal(activitySource.includes('credential-authenticated activities'), false);
assert.equal(activitySource.includes('近期认证活动'), false);
assert.ok(activitySource.includes("ui('最近事件', 'Recent events')"));
assert.ok(activitySource.includes("ui('查看全部', 'View all')"));
assert.ok(activitySource.includes('TRACEKEEPER_RUNTIME_LOG_VIEW'));
assert.equal(activitySource.includes('continue_onboarding'), false);
assert.equal(activitySource.includes('onboardingComplete'), false);
assert.equal(activitySource.includes("ui('认证 Agent', 'Authenticated Agent')"), false);
assert.equal(activitySource.includes("ui('所选 Agent', 'Selected Agent')"), false);
assert.equal(activitySource.includes('tracekeeper-status-bar'), false);
assert.equal(activitySource.includes('renderStatusItem'), false);
assert.equal(activitySource.includes('runtimeStatusClass'), false);
assert.equal(activitySource.includes('agent.lastToolCall'), false);
assert.equal(activitySource.includes('observedClientNameRaw'), false);
assert.equal(activitySource.includes('observedClientVersion'), false);
assert.equal(activitySource.includes('sessionId'), false);
assert.equal(activitySource.includes('tracekeeper-agent-activity-row__action'), false);
assert.equal(activitySource.includes("ui('MCP 服务', 'MCP service')"), false);
assert.equal(activitySource.includes("ui('当前仓库', 'Current repository')"), false);
assert.equal(activitySource.includes("ui('刷新时间', 'Last refreshed')"), false);
assert.equal(activitySource.includes("ui('运行日志', 'Runtime log')"), false);

assert.ok(runtimeStatusSource.includes('loadAgentConnectionsSnapshot'));
assert.ok(runtimeStatusSource.includes('recentAgents'));
assert.ok(runtimeStatusSource.includes('未观察到认证活动'));
assert.ok(runtimeStatusSource.includes('does not label a selected or configured Agent as connected'));
assert.ok(runtimeStatusSource.includes('TRACEKEEPER_RUNTIME_LOG_VIEW'));
assert.ok(runtimeStatusSource.includes('ensureMcpRuntimeRunning'));
assert.ok(runtimeStatusSource.includes('openSettingsTab'));

assert.ok(activityControllerSource.includes('recentAgents,'));
assert.ok(activityControllerSource.includes('buildRecentObservedClientConnections'));

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 51 })}\n`);
