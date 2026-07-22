#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PUBLIC_TOOL_NAME_ORDER, getContractByName, toolContracts } = require('@tracekeeper/contracts');
const { callTool, toolDefinitions } = require('@tracekeeper/mcp-runtime');

const definitions = toolDefinitions();
assert.deepEqual(definitions.map((definition) => definition.name), [...PUBLIC_TOOL_NAME_ORDER]);
assert.equal(definitions.length, PUBLIC_TOOL_NAME_ORDER.length);
assert.equal(new Set(toolContracts.map((contract) => contract.name)).size, toolContracts.length);

for (const definition of definitions) {
	const contract = getContractByName(definition.name);
	assert(contract, `missing contract for ${definition.name}`);
	assert.equal(contract.visibility, 'public');
	assert.deepEqual(definition.inputSchema, contract.inputSchema);
	assert.equal(definition.title, definition.name);
	assert.equal(definition.description, contract.description);
	assert.equal(
		Boolean(definition.annotations?.readOnlyHint),
		contract.risk === 'read-only',
		`${definition.name} readOnlyHint must match its contract risk`
	);
	assert.equal(
		Boolean(definition.annotations?.destructiveHint),
		contract.risk !== 'read-only',
		`${definition.name} destructiveHint must match its contract risk`
	);
}

for (const contract of toolContracts) {
	if (contract.visibility === 'compatibility') {
		assert(contract.deprecated?.replacement, `compatibility tool requires replacement: ${contract.name}`);
	}
}

const unauthenticatedDirectCall = await callTool('tracekeeper.status', {}, {});
assert.equal(unauthenticatedDirectCall.isError, true);
assert.match(
	unauthenticatedDirectCall.structuredContent?.error || '',
	/lacks capability vault\.read/,
	'direct tool calls without an explicit credential capability must be denied'
);

console.log(`ok: ${definitions.length} public MCP definitions conform to ${toolContracts.length} tool contracts`);
