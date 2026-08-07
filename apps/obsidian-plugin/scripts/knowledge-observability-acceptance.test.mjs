#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mainSource = fs.readFileSync('src/main.ts', 'utf8');
const activitySource = fs.readFileSync('src/features/activity/activity-view.ts', 'utf8');
const memorySource = fs.readFileSync('src/features/memory/memory-inspector-view.ts', 'utf8');
const sourceSource = fs.readFileSync('src/features/sources/source-status-view.ts', 'utf8');
const repositorySource = fs.readFileSync('src/features/activity/activity-record-repository.ts', 'utf8');
const activityControllerSource = fs.readFileSync('src/features/activity/activity-data-controller.ts', 'utf8');
const graphSource = fs.readFileSync('src/features/graph/graph-health-controller.ts', 'utf8');
const permissionSource = fs.readFileSync('src/features/permissions/permission-policy-view.ts', 'utf8');
const reviewQueueSource = fs.readFileSync('src/features/review/review-queue-view.ts', 'utf8');

assert.ok(mainSource.includes("id: 'open-memory-inspector'"));
assert.ok(mainSource.includes("id: 'open-source-status'"));
assert.ok(mainSource.includes('openMemoryInspector('));
assert.ok(mainSource.includes('openSourceStatus('));
assert.ok(mainSource.includes('loadKnowledgeIndexEvidence'));
assert.ok(mainSource.includes('knowledgeSnapshot()'));
assert.ok(mainSource.includes('previewLegacyMemoryMigration('));
assert.ok(mainSource.includes('applyLegacyMemoryMigration('));
assert.ok(mainSource.includes('const KNOWLEDGE_ENTRY_FILE_PATHS = REQUIRED_KNOWLEDGE_FILES'));
assert.ok(mainSource.includes('[TRACEKEEPER_ROOT, KNOWLEDGE_ROOT]'));
assert.ok(mainSource.includes('TRACEKEEPER_MEMORY_INSPECTOR_VIEW'));
assert.ok(mainSource.includes('TRACEKEEPER_SOURCE_STATUS_VIEW'));
assert.ok(mainSource.includes('TRACEKEEPER_GRAPH_HEALTH_VIEW'));
assert.equal(memorySource.includes('getMarkdownFiles'), false);
assert.equal(sourceSource.includes('getMarkdownFiles'), false);

assert.ok(activitySource.includes("ui('记忆', 'Memory')"));
assert.ok(activitySource.includes("ui('资料', 'Sources')"));
assert.ok(activitySource.includes("createEl('button', { cls: 'tracekeeper-task-card__change-chip' })"));
assert.ok(activitySource.includes("case 'memory_reads'"));
assert.ok(activitySource.includes("case 'memory_writes'"));
assert.ok(activitySource.includes("case 'source_captures'"));

assert.ok(memorySource.includes("ui('已保存', 'Persisted')"));
assert.ok(memorySource.includes("ui('待确认', 'Queued')"));
assert.ok(memorySource.includes("ui('证据缺失', 'Missing evidence')"));
assert.ok(memorySource.includes('missingMemoryFolder'));
assert.ok(memorySource.includes('readFailures'));
assert.ok(memorySource.includes('indexState'));
assert.ok(memorySource.includes('renderPagination'));
assert.ok(memorySource.includes("ui('当前', 'Current')"));
assert.ok(memorySource.includes("ui('历史', 'History')"));
assert.ok(memorySource.includes("ui('冲突', 'Conflict')"));
assert.ok(memorySource.includes("ui('待审核', 'Review')"));
assert.ok(memorySource.includes("ui('旧版未标识', 'Legacy unkeyed')"));
assert.ok(memorySource.includes("ui('全部生命周期', 'All lifecycle states')"));
assert.ok(memorySource.includes("ui('按记忆生命周期筛选', 'Filter by memory lifecycle')"));
assert.ok(memorySource.includes("setAttr('aria-live', 'polite')"));
assert.ok(memorySource.includes("setAttr('aria-label'"));
assert.ok(memorySource.includes("ui('预览 Doctor 候选', 'Preview Doctor candidates')"));

assert.ok(sourceSource.includes("ui('已捕获资料', 'Captured sources')"));
assert.ok(sourceSource.includes("ui('任务', 'Task')"));
assert.ok(sourceSource.includes("ui('提案', 'Proposal')"));
assert.ok(sourceSource.includes("ui('收尾记录', 'Final note')"));
assert.ok(sourceSource.includes('missingSourceFolder'));
assert.ok(sourceSource.includes('staleRecordCount'));
assert.ok(sourceSource.includes('readFailures'));
assert.ok(sourceSource.includes('renderPagination'));
assert.ok(sourceSource.includes("ui('来源标识', 'Source ID')"));
assert.ok(sourceSource.includes("ui('内容哈希', 'Content hash')"));
assert.ok(sourceSource.includes("ui('存储路由', 'Storage route')"));
assert.ok(sourceSource.includes("ui('分片清单', 'Part manifest')"));

assert.ok(repositorySource.includes('collectRecentMarkdownFiles(folder, limit)'));
assert.ok(repositorySource.includes('MEMORY_PROPOSAL_BODY_READ_LIMIT = 250'));
assert.ok(repositorySource.includes('MEMORY_PROPOSAL_READ_CONCURRENCY = 8'));
assert.ok(repositorySource.includes('readMemoryProposalWindow('));
assert.equal(activityControllerSource.includes('readRecentMemoryProposals(Number.MAX_SAFE_INTEGER)'), false);
assert.ok(graphSource.includes("executeLocalTool('tracekeeper.lint'"));
assert.equal(graphSource.includes("executeLocalTool('tracekeeper.graph_health'"), false);
assert.ok(graphSource.includes('result.graph_health'));
assert.ok(permissionSource.includes("ui('Agent / MCP 不会执行', 'Agent / MCP boundaries')"));
assert.ok(reviewQueueSource.includes("ui('上一批', 'Previous batch')"));
assert.ok(reviewQueueSource.includes("ui('下一批', 'Next batch')"));
assert.ok(reviewQueueSource.includes('loadMemoryReviewQueueSnapshot(this.windowOffset)'));

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 60 })}\n`);
