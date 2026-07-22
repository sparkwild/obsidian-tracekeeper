#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const contracts = require(dist);

const {
	toolContracts,
	PUBLIC_TOOL_NAME_ORDER,
	getContractByName,
	isPublicTool,
	isCompatibilityTool,
} = contracts;

assert(Array.isArray(toolContracts), 'toolContracts should be an array');
assert(toolContracts.length > 0, 'toolContracts should not be empty');

const publicNameSet = new Set(PUBLIC_TOOL_NAME_ORDER);
const byName = new Map();
let visibilityMissing = 0;

for (const contract of toolContracts) {
	assert(typeof contract.name === 'string' && contract.name.length > 0, 'tool contract missing name');
	assert(contract.version > 0, `tool contract ${contract.name} missing valid version`);
	assert(['public', 'compatibility', 'internal'].includes(contract.visibility), `tool contract ${contract.name} has invalid visibility`);
	assert(
		['vault.read', 'vault.write', 'memory.propose', 'memory.apply', 'memory.review', 'workflow.manage', 'review-gated.apply'].includes(
			contract.capability,
		),
		`tool contract ${contract.name} has invalid capability`,
	);
	assert(
		['read-only', 'low-risk-write', 'review-gated-write'].includes(contract.risk),
		`tool contract ${contract.name} has invalid risk`,
	);
	assert(typeof contract.useCase === 'string' && contract.useCase.length > 0, `tool contract ${contract.name} missing useCase`);
	assert(contract.inputSchema && contract.inputSchema.type === 'object', `tool contract ${contract.name} missing input schema`);
	assert(contract.resultSchema && contract.resultSchema.type, `tool contract ${contract.name} missing result schema`);
	if (contract.deprecated) {
		assert(
			typeof contract.deprecated.replacement === 'string' && contract.deprecated.replacement.length > 0,
			`tool contract ${contract.name} has invalid deprecation replacement`,
		);
	}
	byName.set(contract.name, contract);
}

assert.equal(byName.size, toolContracts.length, 'tool names must be unique');

assert.deepStrictEqual(
	PUBLIC_TOOL_NAME_ORDER.length,
	new Set(PUBLIC_TOOL_NAME_ORDER).size,
	'public tool order must not contain duplicates',
);
for (const publicName of PUBLIC_TOOL_NAME_ORDER) {
	const contract = getContractByName(publicName);
	assert(contract, `public tool must have a contract: ${publicName}`);
	assert.strictEqual(
		contract.visibility,
		'public',
		`public tool ${publicName} must be marked as visibility public`,
	);
	assert(isPublicTool(publicName), `public tool should be recognized by isPublicTool: ${publicName}`);
	assert(!isCompatibilityTool(publicName), `public tool should not be compatibility: ${publicName}`);
}

for (const contract of toolContracts) {
	const isPublic = isPublicTool(contract.name);
	if (contract.deprecated) {
		assert.strictEqual(
			contract.visibility,
			'compatibility',
			`deprecated tool should be compatibility: ${contract.name}`,
		);
		const replacement = contract.deprecated.replacement;
		if (replacement.startsWith('tracekeeper.')) {
			const match = replacement.match(/^(tracekeeper\.[a-z_]+)/);
			assert(match, `deprecated replacement missing valid public tool: ${replacement}`);
			const replacementName = match[1];
			const replacementContract = getContractByName(replacementName);
			assert(replacementContract, `deprecated tool ${contract.name} replacement must resolve to known contract: ${replacement}`);
			assert.strictEqual(replacementContract.visibility, 'public', `deprecated replacement must be public: ${replacement}`);
		}
	}
	if (publicNameSet.has(contract.name)) {
		assert.strictEqual(contract.visibility, 'public', `public tool list has non-public contract: ${contract.name}`);
	} else if (!contract.deprecated) {
		visibilityMissing += 1;
	}
}

assert.strictEqual(visibilityMissing, 0, 'non-public tools without deprecated contract should be explicit internal tools');

assert.strictEqual(isPublicTool('tracekeeper.recall'), true, 'tracekeeper.recall should be public');
assert.strictEqual(isCompatibilityTool('tracekeeper.graph_health'), true, 'legacy graph_health should be compatibility');

console.log(
	`ok: validated ${toolContracts.length} contracts, ${PUBLIC_TOOL_NAME_ORDER.length} public in ordered list and ${visibilityMissing} internal tools`,
);
