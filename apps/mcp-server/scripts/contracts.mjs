#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PUBLIC_TOOL_NAME_ORDER, getContractByName, toolContracts } = require('@tracekeeper/contracts');
const { callTool, toolDefinitions, validateStructuredContent } = require('@tracekeeper/mcp-runtime');

const definitions = toolDefinitions();
assert.deepEqual(definitions.map((definition) => definition.name), [...PUBLIC_TOOL_NAME_ORDER]);
assert.equal(definitions.length, PUBLIC_TOOL_NAME_ORDER.length);
assert.equal(new Set(toolContracts.map((contract) => contract.name)).size, toolContracts.length);

for (const definition of definitions) {
	const contract = getContractByName(definition.name);
	assert(contract, `missing contract for ${definition.name}`);
	assert.equal(contract.visibility, 'public');
	assert.deepEqual(definition.inputSchema, contract.inputSchema);
	assert.deepEqual(definition.outputSchema, contract.outputSchema);
	assert.equal(definition.title, definition.name);
	assert.equal(definition.description, contract.description);
	assert.equal(
		Boolean(definition.annotations?.readOnlyHint),
		contract.effect === 'read',
		`${definition.name} readOnlyHint must match its contract effect`
	);
	assert.equal(
		Boolean(definition.annotations?.destructiveHint),
		false,
		`${definition.name} destructiveHint must stay false for current additive and bounded tools`
	);
	assert.equal(
		Boolean(definition.annotations?.idempotentHint),
		contract.idempotency !== 'none',
		`${definition.name} idempotentHint must match its contract idempotency`
	);
	assert.equal(
		Boolean(definition.annotations?.openWorldHint),
		false,
		`${definition.name} openWorldHint must stay false for vault-local tools`
	);
}

const readOnlyDefinitions = toolDefinitions(['vault.read']);
assert.deepEqual(
	readOnlyDefinitions.map((definition) => definition.name),
	PUBLIC_TOOL_NAME_ORDER.filter((name) => getContractByName(name).capability === 'vault.read'),
	'principal-filtered tools/list must preserve public contract order'
);
for (const definition of readOnlyDefinitions) {
	assert.equal(getContractByName(definition.name).capability, 'vault.read');
}

for (const contract of toolContracts) {
	if (contract.visibility === 'compatibility') {
		assert(contract.deprecated?.replacement, `compatibility tool requires replacement: ${contract.name}`);
	}
}

const unauthenticatedDirectCall = await callTool('tracekeeper.status', {}, {});
assert.equal(unauthenticatedDirectCall.isError, true);
assert.equal(unauthenticatedDirectCall.structuredContent?.schema_version, 2);
assert.equal(unauthenticatedDirectCall.structuredContent?.tool, 'tracekeeper.status');
assert.match(
	unauthenticatedDirectCall.structuredContent?.error || '',
	/lacks capability vault\.read/,
	'direct tool calls without an explicit credential capability must be denied'
);
assert.equal(unauthenticatedDirectCall.structuredContent?.error_detail?.code, 'PERMISSION_DENIED');
assert.doesNotMatch(
	unauthenticatedDirectCall.structuredContent?.error_detail?.message || '',
	/unknown/i,
	'structured error detail must not duplicate principal identifiers'
);

const inheritedEnvelope = Object.create({
	schema_version: 2,
	ok: false,
	tool: 'tracekeeper.status',
	error: 'inherited',
	error_detail: {},
});
assert.equal(
	validateStructuredContent(inheritedEnvelope, getContractByName('tracekeeper.status').outputSchema).valid,
	false,
	'inherited properties must not satisfy required output fields'
);

console.log(`ok: ${definitions.length} public MCP definitions conform to ${toolContracts.length} tool contracts`);
