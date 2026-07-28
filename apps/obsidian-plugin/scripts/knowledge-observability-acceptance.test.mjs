#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mainSource = fs.readFileSync('src/main.ts', 'utf8');
const activitySource = fs.readFileSync('src/features/activity/activity-view.ts', 'utf8');
const memorySource = fs.readFileSync('src/features/memory/memory-inspector-view.ts', 'utf8');
const sourceSource = fs.readFileSync('src/features/sources/source-status-view.ts', 'utf8');
const repositorySource = fs.readFileSync('src/features/activity/activity-record-repository.ts', 'utf8');

assert.ok(mainSource.includes("id: 'open-memory-inspector'"));
assert.ok(mainSource.includes("id: 'open-source-status'"));
assert.ok(mainSource.includes('openMemoryInspector('));
assert.ok(mainSource.includes('openSourceStatus('));
assert.ok(mainSource.includes('loadKnowledgeIndexEvidence'));
assert.ok(mainSource.includes('knowledgeSnapshot()'));
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

assert.ok(sourceSource.includes("ui('已捕获资料', 'Captured sources')"));
assert.ok(sourceSource.includes("ui('任务', 'Task')"));
assert.ok(sourceSource.includes("ui('提案', 'Proposal')"));
assert.ok(sourceSource.includes("ui('收尾记录', 'Final note')"));
assert.ok(sourceSource.includes('missingSourceFolder'));
assert.ok(sourceSource.includes('staleRecordCount'));
assert.ok(sourceSource.includes('readFailures'));
assert.ok(sourceSource.includes('renderPagination'));

assert.ok(repositorySource.includes('collectRecentMarkdownFiles(folder, limit)'));

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 30 })}\n`);
