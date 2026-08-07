#!/usr/bin/env node
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-skill-paths-test-'));
const output = path.join(tempRoot, 'skill-install-paths.mjs');
try {
	await build({ entryPoints: [path.resolve('src/features/skill-installation/skill-install-paths.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
	const module = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	assert.deepEqual(module.normalizeSkillDirectorySelection('/tmp/skills', path.join), {
		selectedDirectory: '/tmp/skills',
		targetDirectory: '/tmp/skills/tracekeeper',
	});
	assert.deepEqual(module.normalizeSkillDirectorySelection('/tmp/skills/tracekeeper', path.join), {
		selectedDirectory: '/tmp/skills/tracekeeper',
		targetDirectory: '/tmp/skills/tracekeeper',
	});
	assert.deepEqual(module.normalizeSkillDirectorySelection('/', path.join), {
		selectedDirectory: '/',
		targetDirectory: '/tracekeeper',
	});
	assert.equal(module.sameSkillTargetDirectory('/tmp/skills/tracekeeper', '/tmp/skills/tracekeeper/'), true);
	assert.equal(module.sameSkillTargetDirectory('C:\\Users\\Agent\\skills\\tracekeeper', 'c:/Users/Agent/skills/tracekeeper'), true);
	assert.equal(module.sameSkillTargetDirectory('/tmp/skills/tracekeeper', '/tmp/other/tracekeeper'), false);
	assert.throws(() => module.normalizeSkillDirectorySelection('relative/skills', path.join));
	assert.throws(() => module.normalizeSkillDirectorySelection('/tmp/skills\0bad', path.join));
	assert.throws(() => module.normalizeSkillDirectorySelection('/tmp/skills/../other', path.join));
	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 9 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
