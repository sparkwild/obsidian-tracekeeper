import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	LOCAL_TRUST_CAPABILITIES,
	LOCAL_TRUST_PRINCIPAL_ID,
	callTool,
} from '../dist/index.js';

const RECALL_CALLS = [
	{
		name: 'tracekeeper.recall',
		query: 'private public recall query',
		arguments: {
			scope: 'global',
			max_items: 3,
			prompt: 'private alternate prompt field',
			project_id: {
				prompt: 'private nested identity field',
			},
		},
		expectedMetadata: {
			scope: 'global',
			project_id: '[invalid]',
			max_items: 3,
		},
	},
	{
		name: 'tracekeeper.project_context',
		query: 'private project context query',
		arguments: {
			project_hint: 'demo',
			max_items: 2,
		},
		expectedMetadata: {
			project_hint: 'demo',
			max_items: 2,
		},
	},
	{
		name: 'tracekeeper.project_history',
		query: 'private project history query',
		arguments: {
			project_hint: 'demo',
			max_items: 1,
		},
		expectedMetadata: {
			project_hint: 'demo',
			max_items: 1,
		},
	},
];

function auditSections(vaultRoot) {
	const auditRoot = path.join(vaultRoot, '00_tracekeeper', 'control', 'audit');
	const documents = [];
	if (fs.existsSync(auditRoot)) {
		for (const year of fs.readdirSync(auditRoot, { withFileTypes: true })) {
			if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) {
				continue;
			}
			const yearRoot = path.join(auditRoot, year.name);
			for (const file of fs.readdirSync(yearRoot, { withFileTypes: true })) {
				if (file.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) {
					documents.push(path.join(yearRoot, file.name));
				}
			}
		}
	}
	return documents
		.sort()
		.map((documentPath) => fs.readFileSync(documentPath, 'utf8'))
		.join('\n')
		.split('\n## ')
		.map((section) => section.trim())
		.filter(Boolean);
}

function parseArgsSummary(section) {
	const prefix = '- args_summary: ';
	const line = section.split('\n').find((entry) => entry.startsWith(prefix));
	assert.ok(line, 'tool-call audit must retain a bounded argument summary');
	return JSON.parse(JSON.parse(line.slice(prefix.length)));
}

test('Recall-family audit summaries redact query content and retain operational metadata', async () => {
	const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-recall-audit-'));
	const context = {
		defaultVaultRoot: vaultRoot,
		principalId: LOCAL_TRUST_PRINCIPAL_ID,
		credentialCapabilities: LOCAL_TRUST_CAPABILITIES,
		agentId: 'recall-audit-test-agent',
		sessionId: 'recall-audit-test-session',
		clientName: 'recall-audit-test-client',
	};

	try {
		for (const recallCall of RECALL_CALLS) {
			const result = await callTool(
				recallCall.name,
				{
					query: recallCall.query,
					...recallCall.arguments,
				},
				context
			);
			assert.equal(result.isError, false, `${recallCall.name} should retain its successful behavior`);
		}
		const lintResult = await callTool(
			'tracekeeper.lint',
			{
				max_items: 4,
				graph_profile: 'off',
			},
			context
		);
		assert.equal(lintResult.isError, false);

		const sections = auditSections(vaultRoot);
		assert.doesNotMatch(
			sections.join('\n'),
			/private public recall query|private project context query|private project history query|private alternate prompt field|private nested identity field/
		);
		for (const recallCall of RECALL_CALLS) {
			const section = sections.find((entry) => entry.includes(`- tool_name: "${recallCall.name}"`));
			assert.ok(section, `${recallCall.name} should retain a tool-call audit event`);
			assert.deepEqual(parseArgsSummary(section), {
				query: '[redacted]',
				...recallCall.expectedMetadata,
			});
			assert.match(section, /- result_status: "success"/);
			assert.match(section, /- result_summary: .*matched_count=/);
		}
		const lintSection = sections.find((entry) => entry.includes('- tool_name: "tracekeeper.lint"'));
		assert.ok(lintSection, 'non-Recall tools should retain their existing audit behavior');
		assert.deepEqual(parseArgsSummary(lintSection), {
			max_items: 4,
			graph_profile: 'off',
		});
	} finally {
		fs.rmSync(vaultRoot, { recursive: true, force: true });
	}
});
