import { build } from 'esbuild';
import { copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { checkTracekeeperSkillBundle } from '../../../scripts/build_tracekeeper_skill.mjs';

const repoRoot = path.resolve(process.cwd(), '../..');
const scannerBundlePath = path.join(repoRoot, 'main.js');

await rm(scannerBundlePath, { force: true });

const skillBundleErrors = await checkTracekeeperSkillBundle(repoRoot);
if (skillBundleErrors.length > 0) {
	throw new Error(`Tracekeeper Skill bundle validation failed:\n${skillBundleErrors.join('\n')}`);
}

await rm('main.js.map', { force: true });

await build({
	entryPoints: ['src/main.ts'],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: ['es2018'],
	minify: true,
	sourcemap: false,
	loader: { '.md': 'text', '.json': 'text' },
	external: ['obsidian'],
	outfile: 'main.js',
});

await copyFile(path.resolve(process.cwd(), 'main.js'), scannerBundlePath);
