#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

const loadLocalizedLabels = async (language) => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `tracekeeper-observability-i18n-${language}-`));
	const output = path.join(tempRoot, 'labels.cjs');
	try {
		await build({
			stdin: {
				contents: `
					export {
						memoryInspectorAuthorityLabel,
						memoryInspectorConfidenceLabel,
						memoryInspectorEffectiveStateLabel,
						memoryInspectorLifecycleReasonLabel,
						memoryInspectorProposalStatusLabel,
						memoryInspectorIndexStateLabel,
					} from './src/features/memory/memory-inspector-view.ts';
					export {
						sourceStatusKindLabel,
						sourceStatusCaptureModeLabel,
						sourceStatusRequestStatusLabel,
					} from './src/features/sources/source-status-view.ts';
				`,
				resolveDir: process.cwd(),
				sourcefile: 'knowledge-observability-i18n-test.ts',
				loader: 'ts',
			},
			outfile: output,
			bundle: true,
			platform: 'node',
			format: 'cjs',
			logLevel: 'silent',
			plugins: [{
				name: 'obsidian-stub',
				setup(buildContext) {
					buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
						path: 'obsidian-stub',
						namespace: 'obsidian-stub',
					}));
					buildContext.onLoad({ filter: /.*/, namespace: 'obsidian-stub' }, () => ({
						contents: `
							export class ItemView {}
							export class Notice {}
							export class TFile {}
							export class WorkspaceLeaf {}
							export function getLanguage() { return ${JSON.stringify(language)}; }
						`,
						loader: 'js',
					}));
				},
			}],
		});
		return { labels: require(output), tempRoot };
	} catch (error) {
		fs.rmSync(tempRoot, { recursive: true, force: true });
		throw error;
	}
};

const mainSource = fs.readFileSync('src/main.ts', 'utf8');
const activitySource = fs.readFileSync('src/features/activity/activity-view.ts', 'utf8');
const memorySource = fs.readFileSync('src/features/memory/memory-inspector-view.ts', 'utf8');
const sourceSource = fs.readFileSync('src/features/sources/source-status-view.ts', 'utf8');
const observabilityModelSource = fs.readFileSync('src/features/observability/knowledge-observability-model.ts', 'utf8');
const repositorySource = fs.readFileSync('src/features/activity/activity-record-repository.ts', 'utf8');
const activityControllerSource = fs.readFileSync('src/features/activity/activity-data-controller.ts', 'utf8');
const graphSource = fs.readFileSync('src/features/graph/graph-health-controller.ts', 'utf8');
const graphViewSource = fs.readFileSync('src/features/graph/graph-health-view.ts', 'utf8');
const permissionSource = fs.readFileSync('src/features/permissions/permission-policy-view.ts', 'utf8');
const reviewQueueSource = fs.readFileSync('src/features/review/review-queue-view.ts', 'utf8');
const baseStructureSource = fs.readFileSync('src/features/structure/base-structure-plan.ts', 'utf8');

assert.ok(mainSource.includes("id: 'open-memory-inspector'"));
assert.ok(mainSource.includes("id: 'open-source-status'"));
assert.ok(mainSource.includes('openMemoryInspector('));
assert.ok(mainSource.includes('openSourceStatus('));
assert.ok(mainSource.includes('loadKnowledgeIndexEvidence'));
assert.ok(mainSource.includes('knowledgeSnapshot()'));
assert.ok(mainSource.includes('previewLegacyMemoryMigration('));
assert.ok(mainSource.includes('applyLegacyMemoryMigration('));
assert.ok(baseStructureSource.includes('BASE_STRUCTURE_DIRECTORIES'));
assert.ok(baseStructureSource.includes('REQUIRED_KNOWLEDGE_FILES'));
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

assert.ok(sourceSource.includes("ui('资料记录', 'Source records')"));
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
assert.ok(sourceSource.includes("ui('捕获证据不完整', 'Incomplete capture evidence')"));
assert.ok(sourceSource.includes("ui('仅外部引用', 'External reference only')"));
assert.ok(sourceSource.includes('No body text is available offline'));
assert.ok(sourceSource.includes("ui('缺失或无效字段', 'Missing or invalid fields')"));
assert.ok(sourceSource.includes("'tracekeeper-badge--warning'"));
assert.ok(sourceSource.includes("ui('分片内容哈希（source_part.content_hash）', 'Part content hash (source_part.content_hash)')"));
assert.ok(observabilityModelSource.includes('const strictStringField ='));
assert.ok(observabilityModelSource.includes('const isSourcePartRecord ='));
assert.ok(observabilityModelSource.includes('const strictIntegerField ='));
assert.ok(observabilityModelSource.includes('const strictPathListField ='));
assert.ok(observabilityModelSource.includes("rawValues.some((value) => typeof value !== 'string')"));
assert.ok(observabilityModelSource.includes('value.some((entry, index) => entry !== canonical[index])'));
assert.ok(observabilityModelSource.includes("mode.trim().toLowerCase() === 'external_reference'"));

assert.ok(repositorySource.includes('collectRecentMarkdownFiles(folder, limit)'));
assert.ok(repositorySource.includes('MEMORY_PROPOSAL_BODY_READ_LIMIT = 250'));
assert.ok(repositorySource.includes('MEMORY_PROPOSAL_READ_CONCURRENCY = 8'));
assert.ok(repositorySource.includes('readMemoryProposalWindow('));
assert.equal(activityControllerSource.includes('readRecentMemoryProposals(Number.MAX_SAFE_INTEGER)'), false);
assert.ok(graphSource.includes("executeLocalTool('tracekeeper.lint'"));
assert.equal(graphSource.includes("executeLocalTool('tracekeeper.graph_health'"), false);
assert.ok(graphSource.includes('result.graph_health'));
assert.ok(graphViewSource.includes('Rebuild knowledge index'));
assert.ok(graphViewSource.includes('Obsidian developer console'));
assert.equal(graphViewSource.includes('Check whether the MCP service is running.'), false);
assert.ok(permissionSource.includes("ui('Agent / MCP 不会执行', 'Agent / MCP boundaries')"));
assert.ok(reviewQueueSource.includes("ui('上一批', 'Previous batch')"));
assert.ok(reviewQueueSource.includes("ui('下一批', 'Next batch')"));
assert.ok(reviewQueueSource.includes('loadMemoryReviewQueueSnapshot(this.windowOffset)'));

const zhBundle = await loadLocalizedLabels('zh-CN');
const enBundle = await loadLocalizedLabels('en');
try {
	const zh = zhBundle.labels;
	assert.equal(zh.memoryInspectorAuthorityLabel('source'), '资料来源');
	assert.equal(zh.memoryInspectorConfidenceLabel('supported'), '有证据支持');
	assert.equal(zh.memoryInspectorEffectiveStateLabel('superseded'), '已被替代');
	assert.equal(zh.memoryInspectorLifecycleReasonLabel('pending_human_review'), '等待人工审核');
	assert.equal(zh.memoryInspectorLifecycleReasonLabel('superseded_by:memory-2'), '被 memory-2 替代');
	assert.equal(zh.memoryInspectorProposalStatusLabel('revision_requested'), '已请求修改');
	assert.equal(zh.memoryInspectorIndexStateLabel('recovering'), '恢复中');
	assert.equal(zh.memoryInspectorAuthorityLabel('future_authority'), '未知权威来源');
	assert.equal(zh.memoryInspectorLifecycleReasonLabel('future_reason'), '未知生命周期原因');
	assert.equal(zh.memoryInspectorProposalStatusLabel('future_status'), '未知提案状态');
	assert.equal(zh.sourceStatusKindLabel('local_file'), '文件');
	assert.equal(zh.sourceStatusCaptureModeLabel('extracted_snapshot'), '提取快照');
	assert.equal(zh.sourceStatusRequestStatusLabel('completed'), '已完成');
	assert.equal(zh.sourceStatusKindLabel('future_kind'), '未知资料类型');
	assert.equal(zh.sourceStatusCaptureModeLabel('future_mode'), '未知捕获模式');
	assert.equal(zh.sourceStatusRequestStatusLabel('future_status'), '未知请求状态');

	const en = enBundle.labels;
	assert.equal(en.memoryInspectorAuthorityLabel('source'), 'Source');
	assert.equal(en.memoryInspectorConfidenceLabel('supported'), 'Supported');
	assert.equal(en.memoryInspectorEffectiveStateLabel('superseded'), 'Superseded');
	assert.equal(en.memoryInspectorLifecycleReasonLabel('pending_human_review'), 'Pending human review');
	assert.equal(en.memoryInspectorProposalStatusLabel('revision_requested'), 'Revision requested');
	assert.equal(en.memoryInspectorIndexStateLabel('recovering'), 'Recovering');
	assert.equal(en.memoryInspectorConfidenceLabel('future_confidence'), 'Unknown confidence');
	assert.equal(en.memoryInspectorIndexStateLabel('future_index'), 'Unknown index state');
	assert.equal(en.sourceStatusKindLabel('local_file'), 'File');
	assert.equal(en.sourceStatusCaptureModeLabel('extracted_snapshot'), 'Extracted snapshot');
	assert.equal(en.sourceStatusRequestStatusLabel('completed'), 'Completed');
	assert.equal(en.sourceStatusKindLabel('future_kind'), 'Unknown source type');
	assert.equal(en.sourceStatusCaptureModeLabel('future_mode'), 'Unknown capture mode');
	assert.equal(en.sourceStatusRequestStatusLabel('future_status'), 'Unknown request status');
} finally {
	fs.rmSync(zhBundle.tempRoot, { recursive: true, force: true });
	fs.rmSync(enBundle.tempRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 100 })}\n`);
