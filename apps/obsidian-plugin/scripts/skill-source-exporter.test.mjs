#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-skill-source-test-'));
const output = path.join(tempRoot, 'skill-source-exporter.mjs');
try {
	await build({ entryPoints: [path.resolve('src/features/skill-installation/skill-source-exporter.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', loader: { '.md': 'text', '.json': 'text' } });
	const module = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
	const bundle = {
		manifest: { skill_version: '2.1.0', bundle_hash: `sha256:${'b'.repeat(64)}` },
		installFiles: { 'SKILL.md': '# Tracekeeper\n', 'manifest.json': '{"name":"tracekeeper"}\n' },
	};
const vaultRoot = path.join(fs.realpathSync(tempRoot), 'vault');
	const result = module.exportEmbeddedTracekeeperSkillSource({ fs, path, vaultRoot, configDir: '.obsidian', pluginId: 'tracekeeper', bundle, nonce: 'test' });
	assert.ok(result.sourceDirectory.endsWith('/skill-source/2.1.0-bbbbbbbbbbbbbbbb/tracekeeper'));
	assert.equal(fs.readFileSync(path.join(result.sourceDirectory, 'SKILL.md'), 'utf8'), '# Tracekeeper\n');
	const reused = module.exportEmbeddedTracekeeperSkillSource({ fs, path, vaultRoot, configDir: '.obsidian', pluginId: 'tracekeeper', bundle, nonce: 'other' });
	assert.equal(reused.sourceDirectory, result.sourceDirectory);
	fs.writeFileSync(path.join(result.sourceDirectory, 'SKILL.md'), 'tampered\n');
	const rebuilt = module.exportEmbeddedTracekeeperSkillSource({ fs, path, vaultRoot, configDir: '.obsidian', pluginId: 'tracekeeper', bundle, nonce: 'repair' });
	assert.equal(fs.readFileSync(path.join(rebuilt.sourceDirectory, 'SKILL.md'), 'utf8'), '# Tracekeeper\n');
	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 4 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
