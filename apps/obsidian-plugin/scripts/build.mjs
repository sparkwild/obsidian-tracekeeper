import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm('main.js.map', { force: true });

await build({
	entryPoints: ['src/main.ts'],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: ['es2018'],
	minify: true,
	sourcemap: false,
	loader: { '.md': 'text' },
	external: ['obsidian'],
	outfile: 'main.js',
});
