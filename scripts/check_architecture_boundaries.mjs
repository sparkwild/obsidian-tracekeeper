#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACES = [
	'apps/mcp-server',
	'apps/obsidian-plugin',
	'packages/contracts',
	'packages/core',
	'packages/mcp-runtime',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.mjs', '.js']);
const IGNORED_DIRECTORIES = new Set(['dist', 'node_modules', 'plugin']);
const IMPORT_PATTERN = /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

function collectSourceFiles(root, relativeDirectory, output) {
	const absoluteDirectory = path.resolve(root, relativeDirectory);
	if (!fs.existsSync(absoluteDirectory)) {
		return;
	}
	for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
		if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
			continue;
		}
		const relativePath = path.join(relativeDirectory, entry.name);
		if (entry.isDirectory()) {
			collectSourceFiles(root, relativePath, output);
		} else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
			output.push(relativePath);
		}
	}
}

function workspaceForPath(relativePath) {
	const normalized = relativePath.split(path.sep).join('/');
	return WORKSPACES.find((workspace) => normalized === workspace || normalized.startsWith(`${workspace}/`)) || null;
}

export function checkArchitectureBoundaries(root = process.cwd()) {
	const errors = [];
	const files = [];
	for (const workspace of WORKSPACES) {
		collectSourceFiles(root, workspace, files);
	}

	for (const relativeFile of files) {
		const sourceWorkspace = workspaceForPath(relativeFile);
		const absoluteFile = path.resolve(root, relativeFile);
		const content = fs.readFileSync(absoluteFile, 'utf8');
		for (const match of content.matchAll(IMPORT_PATTERN)) {
			const specifier = match[1];
			if (!specifier.startsWith('.')) {
				continue;
			}
			const resolvedRelative = path.relative(root, path.resolve(path.dirname(absoluteFile), specifier));
			const targetWorkspace = workspaceForPath(resolvedRelative);
			if (targetWorkspace && sourceWorkspace && targetWorkspace !== sourceWorkspace) {
				errors.push(`${relativeFile}: relative cross-workspace import ${specifier} targets ${targetWorkspace}`);
			}
		}
	}

	const pluginMainPath = path.resolve(root, 'apps/obsidian-plugin/src/main.ts');
	if (fs.existsSync(pluginMainPath)) {
		const pluginMain = fs.readFileSync(pluginMainPath, 'utf8');
		if (/\bcallLocalMcpTool\b|\buiMcpSession\b/.test(pluginMain)) {
			errors.push('apps/obsidian-plugin/src/main.ts: plugin UI must not call its own MCP transport');
		}
	}

	return {
		ok: errors.length === 0,
		checkedFiles: files.length,
		errors,
	};
}

function main() {
	const result = checkArchitectureBoundaries(process.cwd());
	if (!result.ok) {
		for (const error of result.errors) {
			console.error(error);
		}
		process.exitCode = 1;
		return;
	}
	console.log(JSON.stringify({ result: 'pass', checkedFiles: result.checkedFiles }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
