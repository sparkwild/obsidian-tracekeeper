import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runAgentEcosystemCheck } from './check_agent_ecosystem.mjs';

function writeFixture(root, relPath, content) {
	const abs = path.join(root, relPath);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, `${content}\n`);
}

test('passes when skill and docs are aligned with contract', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-agent-ecosystem-'));
	try {
		writeFixture(root, 'docs/architecture/AGENT_WORKFLOW_CONTRACT.md', [
			'# Contract',
			'## Golden Workflow',
			'## Closeout Policy',
			'## Review Boundary',
			'## Skill Packaging Requirements',
		].join('\n'));

		writeFixture(root, 'skills/tracekeeper/SKILL.md', [
			'# Tracekeeper Skill',
			'- Use tracekeeper.start_task first',
			'- Then call tracekeeper.recall',
			'- Read tracekeeper.read_note if needed',
			'- Finish with tracekeeper.finish_task',
			'- Then open tracekeeper.review_queue',
			'- Apply via tracekeeper.apply_approved_writeback only when approved',
			'- It does not grant permissions',
			'- It does not use tokens',
			'- do not grant permissions',
			'- do not include any token',
			'- require MCP connection and fail clearly when unavailable',
		].join('\n'));

		writeFixture(root, 'docs/product/INDEX.md', '[skill](skills/tracekeeper/SKILL.md)');
		writeFixture(root, 'docs/architecture/INDEX.md', 'Companion Skill is in AGENT_WORKFLOW_CONTRACT.md and skills/tracekeeper/SKILL.md');
		writeFixture(root, 'docs/engineering/INDEX.md', 'Run npm run agent:ecosystem and keep sync.');
		writeFixture(root, 'docs/status/INDEX.md', 'Agent ecosystem check and skill coverage documented.');
		writeFixture(root, 'apps/obsidian-plugin/src/features/settings/tracekeeper-setting-tab.ts', "import tracekeeperSkillContent from '../../../../../skills/tracekeeper/SKILL.md';");
		writeFixture(root, 'apps/obsidian-plugin/scripts/build.mjs', "const options = { loader: { '.md': 'text' } };");

		const result = runAgentEcosystemCheck(root);
		assert.equal(result.ok, true);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('fails when deprecated tool names appear in skill', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-agent-ecosystem-'));
	try {
		writeFixture(root, 'docs/architecture/AGENT_WORKFLOW_CONTRACT.md', '# Contract\n## Golden Workflow\n## Closeout Policy\n## Review Boundary\n## Skill Packaging Requirements');
		writeFixture(root, 'skills/tracekeeper/SKILL.md', 'use project_context\nand tracekeeper.start_task');
		writeFixture(root, 'docs/product/INDEX.md', 'skills/tracekeeper/SKILL.md');
		writeFixture(root, 'docs/architecture/INDEX.md', 'skills/tracekeeper/SKILL.md');
		writeFixture(root, 'docs/engineering/INDEX.md', 'agent:ecosystem');
		writeFixture(root, 'docs/status/INDEX.md', 'Agent ecosystem check');
		writeFixture(root, 'apps/obsidian-plugin/src/features/settings/tracekeeper-setting-tab.ts', "import tracekeeperSkillContent from '../../../../../skills/tracekeeper/SKILL.md';");
		writeFixture(root, 'apps/obsidian-plugin/scripts/build.mjs', "const options = { loader: { '.md': 'text' } };");

		const result = runAgentEcosystemCheck(root);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((err) => err.includes('deprecated')));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
