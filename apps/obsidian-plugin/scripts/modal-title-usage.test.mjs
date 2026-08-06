#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function collectTypeScriptFiles(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const entryPath = path.join(directory, entry.name);
		return entry.isDirectory() ? collectTypeScriptFiles(entryPath) : entry.name.endsWith('.ts') ? [entryPath] : [];
	});
}

const modalFiles = collectTypeScriptFiles(path.resolve('src')).filter((file) => /extends\s+Modal\b/.test(fs.readFileSync(file, 'utf8')));
let modalCount = 0;

for (const file of modalFiles) {
	const source = fs.readFileSync(file, 'utf8');
	const classes = source.match(/export\s+class\s+\w+\s+extends\s+Modal\b/g) ?? [];
	const nativeTitles = source.match(/this\.(?:setTitle\(|titleEl\.setText\()/g) ?? [];
	modalCount += classes.length;
	assert.ok(nativeTitles.length >= classes.length, `${path.relative(process.cwd(), file)} must set a native title for every Modal class`);
	assert.doesNotMatch(source, /(?:this\.)?contentEl\.createEl\(\s*['"]h[12]['"]/, `${path.relative(process.cwd(), file)} must not render a modal title inside modal-content`);
}

assert.ok(modalFiles.length > 0);
process.stdout.write(`${JSON.stringify({ result: 'pass', modalFiles: modalFiles.length, modalCount })}\n`);
