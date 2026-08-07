#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-recall-view-model-test-'));
const output = path.join(tempRoot, 'recall-view-model.test.mjs');

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
			matches: [
				{
					path: 'projects/tracekeeper/main.md',
					title: 'Tracekeeper',
					scope: 'project',
					type: 'note',
					score: 0.92,
					matched_tokens: ['token-a', 'token-b'],
					score_reason: '语义匹配;关键字',
				},
				{
					path: '',
					scope: 'unknown',
					scoreReason: 'legacy fallback',
					summary: 'manual',
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
	assert.equal(result.items.length, 2);
	assert.equal(result.items[0].path, 'projects/tracekeeper/main.md');
	assert.equal(result.items[0].scope, '项目');
	assert.equal(result.items[0].type, 'note');
	assert.equal(result.items[0].score, 0.92);
	assert.equal(result.items[0].reason, '语义匹配;关键字');
	assert.equal(result.items[0].matchedTokens.join(','), 'token-a,token-b');
	assert.equal(result.items[1].path, '未知路径');
	assert.equal(result.items[1].scope, '全局');
	assert.equal(result.items[1].reason, 'legacy fallback');

	assert.equal(recallModule.normalizeMemoryRecallScope('foo'), 'global');

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 13 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
