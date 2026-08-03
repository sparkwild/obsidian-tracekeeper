#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const WORKSPACES = [
	'apps/mcp-server',
	'apps/obsidian-plugin',
	'packages/contracts',
	'packages/core',
	'packages/mcp-runtime',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.mjs', '.js']);
const IGNORED_DIRECTORIES = new Set(['dist', 'node_modules', 'plugin']);
const FORBIDDEN_PLUGIN_TRANSPORT_IDENTIFIERS = new Set([
	'callLocalMcpTool',
	'uiMcpSession',
	'McpClient',
	'StreamableHTTPClientTransport',
	'fetch',
	'requestUrl',
	'XMLHttpRequest',
	'WebSocket',
	'EventSource',
]);
const FORBIDDEN_PLUGIN_TRANSPORT_MODULES = [
	/^@modelcontextprotocol\/sdk\/client(?:\/|$)/u,
	/^(?:node:)?http$/u,
	/^(?:node:)?https$/u,
	/^(?:node:)?net$/u,
	/^(?:node:)?tls$/u,
	/^undici(?:\/|$)/u,
	/^ws(?:\/|$)/u,
];

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

function moduleSpecifiers(sourceFile) {
	const specifiers = [];
	const visit = (node) => {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
			&& node.moduleSpecifier
			&& ts.isStringLiteralLike(node.moduleSpecifier)) {
			specifiers.push(node.moduleSpecifier.text);
		}
		if (ts.isImportEqualsDeclaration(node)
			&& ts.isExternalModuleReference(node.moduleReference)
			&& node.moduleReference.expression
			&& ts.isStringLiteralLike(node.moduleReference.expression)) {
			specifiers.push(node.moduleReference.expression.text);
		}
		if (ts.isCallExpression(node)
			&& node.arguments.length === 1
			&& ts.isStringLiteralLike(node.arguments[0])
			&& (node.expression.kind === ts.SyntaxKind.ImportKeyword
				|| (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
			specifiers.push(node.arguments[0].text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return specifiers;
}

function forbiddenPluginTransportReasons(sourceFile) {
	const reasons = new Set();
	for (const specifier of moduleSpecifiers(sourceFile)) {
		if (FORBIDDEN_PLUGIN_TRANSPORT_MODULES.some((pattern) => pattern.test(specifier))) {
			reasons.add(`transport module ${specifier}`);
		}
	}
	const visit = (node) => {
		if (ts.isIdentifier(node)
			&& FORBIDDEN_PLUGIN_TRANSPORT_IDENTIFIERS.has(node.text)) {
			reasons.add(`transport identifier ${node.text}`);
		}
		if (
			ts.isElementAccessExpression(node) &&
			ts.isStringLiteralLike(node.argumentExpression) &&
			FORBIDDEN_PLUGIN_TRANSPORT_IDENTIFIERS.has(node.argumentExpression.text)
		) {
			reasons.add(`transport property ${node.argumentExpression.text}`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return [...reasons].sort();
}

function forbiddenVaultRootOverrideReasons(relativeFile, sourceFile) {
	const normalizedRelativeFile = relativeFile.split(path.sep).join('/');
	const reasons = new Set();
	const visit = (node) => {
		if (
			normalizedRelativeFile === 'packages/contracts/src/contracts.ts'
			&& ts.isIdentifier(node)
			&& node.text === 'withVaultRoot'
		) {
			reasons.add('contract helper withVaultRoot');
		}
		if (
			normalizedRelativeFile === 'packages/contracts/src/contracts.ts'
			&& ts.isPropertyAssignment(node)
			&& ts.isIdentifier(node.name)
			&& node.name.text === 'vaultRoot'
		) {
			reasons.add('public contract property vaultRoot');
		}
		if (
			normalizedRelativeFile === 'packages/mcp-runtime/src/tools.ts'
			&& ts.isPropertyAccessExpression(node)
			&& ts.isIdentifier(node.name)
			&& node.name.text === 'vaultRoot'
			&& ts.isIdentifier(node.expression)
			&& (node.expression.text === 'args' || node.expression.text === 'rawArgs')
		) {
			reasons.add(`tool argument access ${node.expression.text}.vaultRoot`);
		}
		if (
			normalizedRelativeFile === 'packages/mcp-runtime/src/tools.ts'
			&& ts.isIdentifier(node)
			&& node.text === 'vaultRootFromArgs'
		) {
			reasons.add('runtime resolver vaultRootFromArgs');
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return [...reasons].sort();
}

function parseSource(relativeFile, content) {
	return ts.createSourceFile(
		relativeFile,
		content,
		ts.ScriptTarget.Latest,
		true,
		path.extname(relativeFile) === '.ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS
	);
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
		const sourceFile = parseSource(relativeFile, content);
		for (const specifier of moduleSpecifiers(sourceFile)) {
			if (!specifier.startsWith('.')) {
				continue;
			}
			const resolvedRelative = path.relative(root, path.resolve(path.dirname(absoluteFile), specifier));
			const targetWorkspace = workspaceForPath(resolvedRelative);
			if (targetWorkspace && sourceWorkspace && targetWorkspace !== sourceWorkspace) {
				errors.push(`${relativeFile}: relative cross-workspace import ${specifier} targets ${targetWorkspace}`);
			}
		}
		const normalizedRelativeFile = relativeFile.split(path.sep).join('/');
		if (normalizedRelativeFile.startsWith('apps/obsidian-plugin/src/')) {
			for (const reason of forbiddenPluginTransportReasons(sourceFile)) {
				errors.push(`${relativeFile}: plugin UI must not call its own MCP transport (${reason})`);
			}
		}
		for (const reason of forbiddenVaultRootOverrideReasons(relativeFile, sourceFile)) {
			errors.push(`${relativeFile}: MCP tools must not accept a caller-selected Vault root (${reason})`);
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
