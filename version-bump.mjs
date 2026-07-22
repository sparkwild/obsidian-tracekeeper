#!/usr/bin/env node
import fs from 'node:fs';

const targetVersion = process.env.npm_package_version;

if (!targetVersion) {
	throw new Error('Missing npm_package_version.');
}

function readJson(path) {
	return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function writeJson(path, value, indent = '\t') {
	fs.writeFileSync(path, `${JSON.stringify(value, null, indent)}\n`);
}

function replaceInFile(path, pattern, replacement) {
	const content = fs.readFileSync(path, 'utf8');
	if (!pattern.test(content)) {
		throw new Error(`Version replacement did not match ${path}.`);
	}
	const updated = content.replace(pattern, replacement);
	if (updated !== content) {
		fs.writeFileSync(path, updated);
	}
}

function syncLockfileVersions(lock, version) {
	lock.version = version;
	const packageVersions = {
		'': version,
		'apps/mcp-server': version,
		'apps/obsidian-plugin': version,
		'packages/core': version,
		'packages/contracts': version,
		'packages/mcp-runtime': version,
		'../../packages/core': version,
		'../../packages/contracts': version,
		'../../packages/mcp-runtime': version,
	};
	for (const [packagePath, packageVersion] of Object.entries(packageVersions)) {
		if (lock.packages?.[packagePath]) {
			lock.packages[packagePath].version = packageVersion;
		}
	}
}

const rootPackage = readJson('package.json');
rootPackage.version = targetVersion;
writeJson('package.json', rootPackage);

const manifest = readJson('manifest.json');
manifest.version = targetVersion;
writeJson('manifest.json', manifest);

const pluginManifest = readJson('apps/obsidian-plugin/manifest.json');
pluginManifest.version = targetVersion;
writeJson('apps/obsidian-plugin/manifest.json', pluginManifest, '  ');

const pluginPackage = readJson('apps/obsidian-plugin/package.json');
pluginPackage.version = targetVersion;
writeJson('apps/obsidian-plugin/package.json', pluginPackage, '  ');

for (const packagePath of [
	'apps/mcp-server/package.json',
	'packages/core/package.json',
	'packages/contracts/package.json',
	'packages/mcp-runtime/package.json',
]) {
	const packageJson = readJson(packagePath);
	packageJson.version = targetVersion;
	writeJson(packagePath, packageJson);
}

for (const lockPath of [
	'package-lock.json',
	'apps/obsidian-plugin/package-lock.json',
	'apps/mcp-server/package-lock.json',
	'packages/core/package-lock.json',
]) {
	if (!fs.existsSync(lockPath)) {
		continue;
	}
	const lock = readJson(lockPath);
	syncLockfileVersions(lock, targetVersion);
	writeJson(lockPath, lock, lockPath === 'package-lock.json' ? '\t' : '  ');
}

replaceInFile(
	'packages/mcp-runtime/src/handler.ts',
	/export const MCP_SERVER_VERSION = '[^']+';/,
	`export const MCP_SERVER_VERSION = '${targetVersion}';`
);
replaceInFile(
	'apps/mcp-server/scripts/smoke.mjs',
	/version: '[^']+',/,
	`version: '${targetVersion}',`
);

const versions = readJson('versions.json');
versions[targetVersion] = manifest.minAppVersion;
writeJson('versions.json', versions);
