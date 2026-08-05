#!/usr/bin/env node
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-skill-prompt-test-'));
const output = path.join(tempRoot, 'skill-assistant-prompt.mjs');
try {
	await build({ entryPoints: [path.resolve('src/features/skill-installation/skill-assistant-prompt.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
	const module = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const context = module.buildAiSkillAssistantPrompt({
		clientId: 'codex',
		displayName: 'Codex',
		sourceDirectory: '/vault/.obsidian/plugins/tracekeeper/skill-source/2.1.0-abcd/tracekeeper',
		skillVersion: '2.1.0',
		bundleHash: `sha256:${'a'.repeat(64)}`,
		recommendation: { skillsRootDirectory: '/home/user/.agents/skills', source: 'official_documentation', documentationUrl: 'https://developers.openai.com/codex/skills/' },
	});
	assert.match(context.prompt, /可信本地源目录/);
	assert.match(context.prompt, /\.agents\/skills/);
	assert.match(context.prompt, /不从网络下载/);
	assert.equal(context.prompt.includes('Bearer'), false);
	const unknown = module.buildAiSkillAssistantPrompt({ ...context, recommendation: null });
	assert.equal(unknown.prompt.includes('.agents/skills'), false);
	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 5 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
