#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const activitySource = fs.readFileSync('src/features/activity/activity-view.ts', 'utf8');
const runtimeStatusSource = fs.readFileSync('src/features/runtime/runtime-status-view.ts', 'utf8');
const activityControllerSource = fs.readFileSync('src/features/activity/activity-data-controller.ts', 'utf8');
const stylesSource = fs.readFileSync('styles.css', 'utf8');

const orderedCalls = [
	'this.renderAgentActivitySection(contentEl, connections)',
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
assert.ok(activitySource.includes('buildSuccessfullyUsedAgentSummary'));
assert.ok(activitySource.includes('selectLatestTaskPlacement'));
assert.ok(activitySource.includes("createEl('details'"));
assert.ok(activitySource.includes("ui('高级诊断', 'Advanced diagnostics')"));
assert.equal(activitySource.includes('tracekeeper-review-queue-button--action'), false);
assert.equal((activitySource.match(/cls: 'mod-cta'/g) || []).length, 1);
assert.ok(activitySource.includes("ui('最近 Agent 使用', 'Recent Agent usage')"));
assert.ok(activitySource.includes("ui('最近一次跟踪任务', 'Latest tracked task')"));
assert.ok(activitySource.includes('this.renderTaskEntry(card, completedTask, false)'));
assert.ok(activitySource.includes('selectTaskExecutionPresentationStatus'));
assert.ok(activitySource.includes('selectTaskDurableOutputPresentationStatus'));
assert.ok(activitySource.includes('countTaskProposalReferences'));
assert.ok(activitySource.includes('countTaskSourceCaptureEvidence'));
assert.ok(activitySource.includes('taskProposalNavigationPaths'));
assert.ok(activitySource.includes("ui('任务执行', 'Task execution')"));
assert.ok(activitySource.includes("ui('知识持久化', 'Knowledge durable output')"));
assert.ok(activitySource.includes('`任务执行：${executionStatus}`'));
assert.ok(activitySource.includes('`知识持久化：${persistenceStatus}`'));
assert.ok(activitySource.includes("ui('已完成', 'Completed')"));
assert.ok(activitySource.includes("ui('部分完成', 'Partially complete')"));
assert.ok(activitySource.includes("ui('受阻', 'Blocked')"));
assert.ok(activitySource.includes("ui('无持久化输出', 'No durable output')"));
assert.ok(activitySource.includes("ui('收尾时无持久化输出', 'No durable output at finish')"));
assert.ok(activitySource.includes("ui('收尾时待审核', 'Pending review at finish')"));
assert.ok(activitySource.includes("ui('收尾时待写入', 'Ready to apply at finish')"));
assert.ok(activitySource.includes("ui('收尾时待修订', 'Revision requested at finish')"));
assert.ok(activitySource.includes("ui('已写入', 'Applied')"));
assert.ok(activitySource.includes("ui('收尾时已拒绝', 'Rejected at finish')"));
assert.ok(activitySource.includes("ui('收尾时状态异常', 'Status unresolved at finish')"));
assert.ok(activitySource.includes("ui('收尾时混合状态', 'Mixed state at finish')"));
assert.equal(activitySource.includes("ui('待审核', 'Pending review')"), false);
assert.ok(activitySource.includes("ui('有提案，查看当前状态', 'Proposals exist, check current state')"));
assert.ok(activitySource.includes("ui('查看提案状态', 'View proposal status')"));
assert.ok(activitySource.includes("ui('打开提案记录', 'Open proposal record')"));
assert.ok(activitySource.includes('paths.length !== 1'));
assert.ok(activitySource.includes('exactProposalFiles.length === 1'));
assert.ok(activitySource.includes('openFile(exactProposalFiles[0])'));
assert.ok(activitySource.includes('projectDurableOutputTargetPaths(task)'));
assert.ok(activitySource.includes('new DurableOutputTargetsModal('));
assert.ok(activitySource.includes('evidence only, not applied knowledge'));
assert.ok(activitySource.includes('target evidence, not proof of writeback'));
assert.ok(activitySource.includes("ui('查看持久化目标', 'View durable output targets')"));
assert.ok(activitySource.includes("this.openTaskChange(task, 'durable_targets')"));
assert.ok(activitySource.includes('durableOutputTargetPaths.length === 1'));
assert.equal(activitySource.includes('text: task.status ||'), false);
assert.equal(activitySource.includes('taskStatusClass'), false);
assert.equal(activitySource.includes("ui('最后一次执行的任务', 'Last task')"), false);
assert.equal(activitySource.includes("ui('还没有任务记录。', 'No task records yet.')"), false);
assert.ok(activitySource.includes('最近活动时间'));
assert.ok(activitySource.includes('Latest activity'));
assert.ok(activitySource.includes('sessionCount'));
assert.ok(activitySource.includes('Manage Agent configuration'));
assert.ok(activitySource.includes("openSettingsTab('agent-configuration')"));
assert.ok(activitySource.includes('successfully used a Tracekeeper tool'));
assert.ok(activitySource.includes('loadAgentConnectionsSnapshot'));
assert.ok(activitySource.includes("this.containerEl.addClass('tracekeeper-item-view')"));
assert.ok(activitySource.includes("this.containerEl.addClass('tracekeeper-activity-view')"));
assert.match(stylesSource, /\.tracekeeper-item-view\s+\.view-header-title[\s\S]*?display:\s*none;/);
assert.match(stylesSource, /\.tracekeeper-item-view\s+\.view-actions[\s\S]*?margin-left:\s*auto;/);
assert.equal(activitySource.includes("ui('当前 Agent 配置', 'Current Agent configuration')"), false);
assert.equal(activitySource.includes("ui('历史活动', 'Historical activity')"), false);
assert.equal(activitySource.includes("ui('配置已移除', 'Configuration removed')"), false);
assert.equal(activitySource.includes('configuredAgents'), false);
assert.equal(activitySource.includes('historicalAgentGroups'), false);
assert.equal(activitySource.includes('buildAgentConfigurationViewModel'), false);
assert.equal(activitySource.includes("ui('MCP', 'MCP')"), false);
assert.equal(activitySource.includes("ui('授权', 'Authorization')"), false);
assert.equal(activitySource.includes("ui('使用', 'Usage')"), false);
assert.equal(activitySource.includes('credential-authenticated activities'), false);
assert.equal(activitySource.includes('近期认证活动'), false);
assert.ok(activitySource.includes("ui('最近事件', 'Recent events')"));
assert.ok(activitySource.includes("ui('查看全部', 'View all')"));
assert.ok(activitySource.includes('AgentActivityDetailsModal'));
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
assert.ok(runtimeStatusSource.includes('TRACEKEEPER_ACTIVITY_VIEW'));
assert.ok(runtimeStatusSource.includes('ensureMcpRuntimeRunning'));
assert.ok(runtimeStatusSource.includes('openSettingsTab'));

assert.ok(activityControllerSource.includes('recentAgents,'));
assert.ok(activityControllerSource.includes('buildRecentObservedClientConnections'));
assert.ok(activityControllerSource.includes('integration_id'), 'activity audit parser must expose integration id');
assert.ok(activityControllerSource.includes('credential_id'), 'activity audit parser must expose credential id');
assert.ok(activityControllerSource.includes('readAgentAuthMode'));
assert.ok(activityControllerSource.includes('RUNTIME_LOG_MAX_EVENTS + 1'));
assert.equal(
	/loadRuntimeLogSnapshot[\s\S]*?readRecentAuditEvents\(Number\.MAX_SAFE_INTEGER\)/.test(activityControllerSource),
	false
);

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 97 })}\n`);
