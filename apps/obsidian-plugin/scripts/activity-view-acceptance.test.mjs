#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const activitySource = fs.readFileSync('src/features/activity/activity-view.ts', 'utf8');
const runtimeStatusSource = fs.readFileSync('src/features/runtime/runtime-status-view.ts', 'utf8');
const activityControllerSource = fs.readFileSync('src/features/activity/activity-data-controller.ts', 'utf8');

const orderedCalls = [
	'this.renderAgentConnectionSection(contentEl, snapshot)',
	'this.renderPrimaryAction(contentEl, snapshot, primaryAction)',
	'this.renderLatestTaskSection(contentEl, snapshot)',
	'this.renderMemoryLoopSection(contentEl, snapshot)',
	'this.renderSourceActivitySection(contentEl, snapshot)',
	'this.renderRuntimeLogSection(contentEl, snapshot)',
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
assert.ok(activitySource.includes('服务运行不等于 Agent 已连接'));
assert.ok(activitySource.includes('不代表 Agent 此刻仍保持连接'));
assert.equal(activitySource.includes('其他近期认证记录'), false);

assert.ok(runtimeStatusSource.includes('loadAgentConnectionsSnapshot'));
assert.ok(runtimeStatusSource.includes('recentAgents'));
assert.ok(runtimeStatusSource.includes('未观察到认证活动'));
assert.ok(runtimeStatusSource.includes('does not label a selected or configured Agent as connected'));
assert.ok(runtimeStatusSource.includes('TRACEKEEPER_RUNTIME_LOG_VIEW'));
assert.ok(runtimeStatusSource.includes('ensureMcpRuntimeRunning'));
assert.ok(runtimeStatusSource.includes('openSettingsTab'));

assert.ok(activityControllerSource.includes('recentAgents,'));
assert.ok(activityControllerSource.includes('displayName: this.host.formatAgentDisplayName'));

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 21 })}\n`);
