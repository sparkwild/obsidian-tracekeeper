#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-recall-view-model-test-'));
const output = path.join(tempRoot, 'recall-view-model.test.mjs');
const modalSource = fs.readFileSync('src/features/recall/memory-recall-preview-modal.ts', 'utf8');

try {
	await build({
		entryPoints: [path.resolve('src/features/recall/recall-view-model.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});

	const recallModule = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const scoreReasonCases = [
		['Project-memory location boost (+4)', '项目记忆位置加权（+4）', 'Project-memory location boost (+4)'],
		['Wiki location boost (+0.75)', 'Wiki 位置加权（+0.75）', 'Wiki location boost (+0.75)'],
		['Work-record query-echo penalty (-5.4)', '工作记录查询回显降权（-5.4）', 'Work-record query-echo penalty (-5.4)'],
		['Multiple query token matches (+0.4)', '多个查询词命中（+0.4）', 'Multiple query token matches (+0.4)'],
		['Recent edit (+1)', '近期编辑加权（+1）', 'Recent edit (+1)'],
		['Exact query phrase match in title/path (+1)', '标题或路径精确匹配查询短语（+1）', 'Exact query phrase match in title/path (+1)'],
		['Project scope match (+0.4)', '项目范围匹配（+0.4）', 'Project scope match (+0.4)'],
		['Core recall score', '核心召回分数', 'Core recall score'],
		['Catalog lexical match', '目录词法匹配', 'Catalog lexical match'],
		['Future fixed English diagnostic', '其他召回排序依据', 'Other recall ranking signal'],
	];
	for (const [reason, zh, en] of scoreReasonCases) {
		assert.equal(recallModule.localizeMemoryRecallScoreReason(reason, 'zh'), zh);
		assert.equal(recallModule.localizeMemoryRecallScoreReason(reason, 'en'), en);
	}
	assert.equal(
		recallModule.localizeMemoryRecallScoreReasons(
			['Recent edit (+1)', 'Future diagnostic one', 'Future diagnostic two'],
			'zh'
		),
		'近期编辑加权（+1）；其他召回排序依据'
	);
	assert.equal(
		recallModule.localizeMemoryRecallScoreReasons(
			['Recent edit (+1)', 'Future diagnostic one'],
			'en'
		),
		'Recent edit (+1); Other recall ranking signal'
	);
	const scopeLabel = (scope) => {
		switch (scope) {
			case 'global':
				return '全局';
			case 'project':
				return '项目';
			case 'project_history':
				return '项目历史';
			default:
				return '未知';
		}
	};

	const result = recallModule.parseMemoryRecallResult(
		{
			uncertain: false,
			project_identity: {
				project_hint: 'obsidian-tracekeeper',
				project_id: 'tracekeeper-project',
				repo_path: '/work/obsidian-tracekeeper',
				source: 'explicit_project_id',
				confidence: 'exact',
				warnings: [],
			},
			matches: [
				{
					path: 'projects/tracekeeper/main.md',
					title: 'Tracekeeper',
					scope: 'project',
					type: 'note',
					score: 0.92,
					matched_tokens: ['token-a', 'token-b'],
					score_reason: ['Recent edit (+1)', 'Project scope match (+0.4)'],
				},
				{
					path: '',
					scope: 'unknown',
					reason: 'user-authored recall evidence',
					summary: 'secondary summary',
				},
			],
		},
		{
			query: 'tracekeeper',
			scope: 'global',
			projectHint: 'obsidian-tracekeeper',
			sourceTool: 'tracekeeper.recall',
		},
		{
			unknownPathLabel: '未知路径',
			unknownTitleLabel: '未知标题',
			unknownTypeLabel: '笔记',
			noDisplayLabel: '缺少可展示字段',
			noReasonLabel: '暂无说明',
			scopeLabel,
		}
	);

	assert.equal(result.scope, '全局');
	assert.equal(result.query, 'tracekeeper');
	assert.equal(result.sourceTool, 'tracekeeper.recall');
	assert.equal(result.projectHint, 'obsidian-tracekeeper');
	assert.equal(result.uncertain, false);
	assert.deepEqual(result.projectIdentity, {
		projectHint: 'obsidian-tracekeeper',
		projectId: 'tracekeeper-project',
		repoPath: '/work/obsidian-tracekeeper',
		source: 'explicit_project_id',
		confidence: 'exact',
		warnings: [],
	});
	assert.equal(result.items.length, 2);
	assert.equal(result.items[0].path, 'projects/tracekeeper/main.md');
	assert.equal(result.items[0].scope, '项目');
	assert.equal(result.items[0].type, 'note');
	assert.equal(result.items[0].score, 0.92);
	assert.deepEqual(result.items[0].scoreReasons, [
		'Recent edit (+1)',
		'Project scope match (+0.4)',
	]);
	assert.equal(result.items[0].reason, 'Recent edit (+1)；Project scope match (+0.4)');
	assert.equal(result.items[0].matchedTokens.join(','), 'token-a,token-b');
	assert.equal(result.items[1].path, '未知路径');
	assert.equal(result.items[1].scope, '全局');
	assert.deepEqual(result.items[1].scoreReasons, []);
	assert.equal(result.items[1].reason, 'user-authored recall evidence');

	const conflict = recallModule.parseMemoryRecallResult(
		{
			uncertain: true,
			project_identity: {
				project_hint: 'tracekeeper',
				project_id: 'tracekeeper-project',
				repo_path: '/work/another-project',
				source: 'explicit_project_id',
				confidence: 'uncertain',
				warnings: [
					'project_hint_conflicts_with_project_id',
					'repo_path_conflicts_with_project_id',
				],
			},
			matches: [],
		},
		{ query: 'conflict', scope: 'project', sourceTool: 'tracekeeper.recall' },
		{
			unknownPathLabel: '未知路径',
			unknownTitleLabel: '未知标题',
			unknownTypeLabel: '笔记',
			noDisplayLabel: '缺少可展示字段',
			noReasonLabel: '暂无说明',
			scopeLabel,
		}
	);
	assert.equal(conflict.uncertain, true);
	assert.equal(conflict.items.length, 0);
	assert.deepEqual(conflict.projectIdentity.warnings, [
		'project_hint_conflicts_with_project_id',
		'repo_path_conflicts_with_project_id',
	]);

	const ambiguous = recallModule.parseMemoryRecallResult(
		{
			uncertain: true,
			project_identity: {
				project_hint: null,
				project_id: null,
				repo_path: '/work/shared',
				source: 'unknown',
				confidence: 'uncertain',
				warnings: ['ambiguous_vault_project_identity', 'future_warning_code'],
			},
			matches: [],
		},
		{ query: 'ambiguous', scope: 'project', sourceTool: 'tracekeeper.recall' },
		{
			unknownPathLabel: '未知路径',
			unknownTitleLabel: '未知标题',
			unknownTypeLabel: '笔记',
			noDisplayLabel: '缺少可展示字段',
			noReasonLabel: '暂无说明',
			scopeLabel,
		}
	);
	assert.equal(ambiguous.uncertain, true);
	assert.equal(ambiguous.projectIdentity.projectHint, '');
	assert.deepEqual(ambiguous.projectIdentity.warnings, [
		'ambiguous_vault_project_identity',
		'future_warning_code',
	]);
	assert.ok(modalSource.includes("ui('项目身份存在不确定性', 'Project identity is uncertain')"));
	assert.ok(modalSource.includes("case 'ambiguous_vault_project_identity'"));
	assert.ok(modalSource.includes("case 'project_hint_conflicts_with_project_id'"));
	assert.ok(modalSource.includes("ui('其他识别来源', 'Other identity source')"));
	assert.ok(modalSource.includes("ui('其他置信度', 'Other confidence level')"));
	assert.ok(modalSource.includes("ui('存在未识别的项目身份警告。', 'An unrecognized project identity warning was reported.')"));
	assert.ok(!modalSource.includes('default: return code;'));
	assert.ok(modalSource.includes('localizeMemoryRecallScoreReasons(item.scoreReasons, locale)'));
	assert.ok(modalSource.includes("'请输入检索文本。', 'Please enter a query.'"));
	assert.ok(modalSource.includes('召回失败。请确认 Tracekeeper Runtime 正常运行后重试。'));
	assert.ok(!modalSource.includes('error instanceof Error ? error.message : String(error)'));

	assert.equal(recallModule.normalizeMemoryRecallScope('foo'), 'global');

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 57 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
