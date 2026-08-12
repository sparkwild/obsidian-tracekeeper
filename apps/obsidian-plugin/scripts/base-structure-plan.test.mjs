#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-base-structure-plan-'));
const output = path.join(tempRoot, 'base-structure-plan.cjs');
const require = createRequire(import.meta.url);

try {
	await build({
		entryPoints: [path.resolve('src/features/structure/base-structure-plan.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
	});

	const {
		BASE_STRUCTURE_FILE_PATHS,
		buildBaseStructurePlan,
		invalidBaseStructurePaths,
		isBaseStructurePlanReady,
	} = require(output);
	const {
		BASE_STRUCTURE_DIRECTORIES,
		ON_DEMAND_STRUCTURE_DIRECTORIES,
		TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH,
		TRACEKEEPER_SYSTEM_PATH,
	} = require('@tracekeeper/core');
	const legacyHub = [
		'---',
		'type: tracekeeper_agent_activity_hub',
		'agent_activity_schema_version: 1',
		'created_at: 2026-08-12T00:00:00.000Z',
		'---',
		'# User-owned Agent activity hub',
		'',
		'Custom body remains valid without updated_at.',
		'',
	].join('\n');
	const validEntries = new Map([
		...BASE_STRUCTURE_DIRECTORIES.map((entryPath) => [entryPath, { kind: 'folder' }]),
		...BASE_STRUCTURE_FILE_PATHS.map((entryPath) => [entryPath, {
			kind: 'file',
			content: entryPath === TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH
				? legacyHub
				: '# Existing user file\n',
		}]),
	]);
	const inspectedPaths = [];
	const inspectEntries = (entries) => async (entryPath, options) => {
		inspectedPaths.push({ path: entryPath, readContent: options.readContent });
		return entries.get(entryPath) ?? { kind: 'missing' };
	};

	const readyPlan = await buildBaseStructurePlan(inspectEntries(validEntries));
	assert.deepEqual(readyPlan.foldersToCreate, []);
	assert.deepEqual(readyPlan.filesToCreate, []);
	assert.deepEqual(readyPlan.invalidFolders, []);
	assert.deepEqual(readyPlan.invalidFiles, []);
	assert.deepEqual(readyPlan.invalidFileContents, []);
	assert.equal(readyPlan.missingAgentActivityHub, false);
	assert.equal(isBaseStructurePlanReady(readyPlan), true);
	assert.deepEqual(invalidBaseStructurePaths(readyPlan), []);
	assert.equal(
		inspectedPaths.some(({ path: inspectedPath }) =>
			ON_DEMAND_STRUCTURE_DIRECTORIES.includes(inspectedPath)
		),
		false
	);
	assert.deepEqual(
		inspectedPaths.filter(({ readContent }) => readContent).map(({ path: entryPath }) => entryPath),
		[TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH]
	);

	const folderConflictEntries = new Map(validEntries);
	folderConflictEntries.set(BASE_STRUCTURE_DIRECTORIES[0], { kind: 'file', content: 'occupied' });
	const folderConflict = await buildBaseStructurePlan(inspectEntries(folderConflictEntries));
	assert.deepEqual(folderConflict.invalidFolders, [BASE_STRUCTURE_DIRECTORIES[0]]);
	assert.equal(folderConflict.foldersToCreate.includes(BASE_STRUCTURE_DIRECTORIES[0]), false);
	assert.equal(isBaseStructurePlanReady(folderConflict), false);

	const fileConflictEntries = new Map(validEntries);
	fileConflictEntries.set(TRACEKEEPER_SYSTEM_PATH, { kind: 'folder' });
	const fileConflict = await buildBaseStructurePlan(inspectEntries(fileConflictEntries));
	assert.deepEqual(fileConflict.invalidFiles, [TRACEKEEPER_SYSTEM_PATH]);
	assert.equal(fileConflict.filesToCreate.includes(TRACEKEEPER_SYSTEM_PATH), false);
	assert.equal(isBaseStructurePlanReady(fileConflict), false);

	const invalidHubEntries = new Map(validEntries);
	invalidHubEntries.set(TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH, {
		kind: 'file',
		content: '---\ntype: tracekeeper_agent_activity_hub\nagent_activity_schema_version: 2\n---\n',
	});
	const invalidHub = await buildBaseStructurePlan(inspectEntries(invalidHubEntries));
	assert.deepEqual(invalidHub.invalidFileContents, [TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH]);
	assert.deepEqual(invalidBaseStructurePaths(invalidHub), [TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH]);
	assert.equal(isBaseStructurePlanReady(invalidHub), false);

	const missingEntries = new Map(validEntries);
	missingEntries.delete(BASE_STRUCTURE_DIRECTORIES[0]);
	missingEntries.delete(TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH);
	const missing = await buildBaseStructurePlan(inspectEntries(missingEntries));
	assert.equal(missing.foldersToCreate.includes(BASE_STRUCTURE_DIRECTORIES[0]), true);
	assert.equal(missing.filesToCreate.includes(TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH), true);
	assert.equal(missing.missingAgentActivityHub, true);
	assert.equal(isBaseStructurePlanReady(missing), false);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 27 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
