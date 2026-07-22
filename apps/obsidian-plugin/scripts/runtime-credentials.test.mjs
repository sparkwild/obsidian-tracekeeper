#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-runtime-credentials-test-'));
const output = path.join(tempRoot, 'runtime-credentials.mjs');
const checks = [];

try {
	await build({
		entryPoints: [path.resolve('src/features/settings/runtime-credentials.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
	});
	const credentialModule = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

	const preseted = credentialModule.normalizeRuntimeCredentialProfileAndCapabilities({
		capabilities: ['vault.read', 'workflow.manage', 'memory.propose'],
		capabilityProfile: 'knowledge_assistant',
	});
	assert.deepEqual(preseted, {
		profile: 'knowledge_assistant',
		capabilities: ['vault.read', 'workflow.manage', 'memory.propose'],
	});
	checks.push('map-known-preset');
	const presets = Object.fromEntries(
		credentialModule.RUNTIME_CREDENTIAL_PRESET_DEFINITIONS.map((entry) => [entry.id, entry.capabilities])
	);
	assert.deepEqual(presets.maintenance_agent, ['vault.read']);
	assert.deepEqual(presets.research_agent, ['vault.read', 'workflow.manage', 'memory.propose', 'vault.write']);
	assert.deepEqual(presets.review_agent, ['vault.read', 'workflow.manage', 'memory.propose', 'memory.review', 'memory.apply']);
	checks.push('least-privilege-presets');

	const inferred = credentialModule.normalizeRuntimeCredentialProfileAndCapabilities({
		capabilities: ['memory.apply', 'memory.review', 'vault.read'],
	});
	assert.equal(inferred.profile, 'custom');
	assert.deepEqual(inferred.capabilities, ['memory.apply', 'memory.review', 'vault.read']);
	checks.push('infer-custom');

	const legacy = credentialModule.normalizeRuntimeCredentialProfileAndCapabilities({
		id: 'legacy',
		clientId: 'legacy',
		token: 'legacy-token',
	});
	assert.equal(legacy.profile, 'custom');
	assert.deepEqual(legacy.capabilities, []);
	const explicitLegacy = credentialModule.normalizeRuntimeCredentialProfileAndCapabilities({ capabilities: ['*'] });
	assert.deepEqual(explicitLegacy, { profile: 'custom', capabilities: ['*'] });
	assert.deepEqual(credentialModule.normalizeRuntimeCapabilities(['unknown-capability']), []);
	assert.throws(() => credentialModule.capabilitiesForRuntimeProfile('unknown-profile'), /Unknown runtime credential/);
	checks.push('fail-closed-and-explicit-legacy');

	const knowledgeTools = credentialModule.runtimeCapabilitiesToPublicTools(['vault.read', 'workflow.manage', 'memory.propose']);
	assert.deepEqual(knowledgeTools, [
		'tracekeeper.status',
		'tracekeeper.lint',
		'tracekeeper.recall',
		'tracekeeper.read_note',
		'tracekeeper.start_task',
		'tracekeeper.finish_task',
		'tracekeeper.build_context_pack',
		'tracekeeper.propose_memory',
	]);
	checks.push('capability-to-public-tools');

	const allTools = credentialModule.runtimeCapabilitiesToPublicTools(['*']);
	const expectedAllTools = [
		'tracekeeper.status',
		'tracekeeper.lint',
		'tracekeeper.recall',
		'tracekeeper.read_note',
		'tracekeeper.start_task',
		'tracekeeper.finish_task',
		'tracekeeper.build_context_pack',
		'tracekeeper.review_queue',
		'tracekeeper.apply_approved_writeback',
		'tracekeeper.source_request',
		'tracekeeper.capture_source',
		'tracekeeper.propose_memory',
	];
	assert.deepEqual(allTools, expectedAllTools);
	checks.push('capability-star-is-public');

	const credentials = [
		{
			id: 'client-codex',
			clientId: 'codex',
			token: 'codex-old',
			capabilities: ['vault.read', 'workflow.manage', 'memory.propose'],
			createdAt: '2026-01-01T00:00:00.000Z',
			capabilityProfile: 'knowledge_assistant',
		},
		{
			id: 'client-cursor',
			clientId: 'cursor',
			token: 'cursor-stable',
			capabilities: ['vault.write'],
			createdAt: '2026-01-01T00:00:00.000Z',
		},
	];
	const rotated = credentialModule.rotateClientRuntimeCredential(
		credentials,
		'codex',
		'codex-new',
		'2026-07-22T00:00:00.000Z'
	);
	assert.equal(rotated[0].token, 'codex-new');
	assert.equal(rotated[0].capabilityProfile, 'knowledge_assistant');
	assert.deepEqual(rotated[0].capabilities, ['vault.read', 'workflow.manage', 'memory.propose']);
	assert.equal(rotated[0].id, 'client-codex');
	assert.deepEqual(rotated[1], credentials[1]);
	assert.equal(credentials[0].token, 'codex-old');
	assert.throws(
		() => credentialModule.rotateClientRuntimeCredential(credentials, 'missing', 'new-token', '2026-07-22T00:00:00.000Z'),
		/Missing runtime credential/
	);
	checks.push('rotate-preserves-profile');
	console.log(`${JSON.stringify({ result: 'pass', checks })}`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
