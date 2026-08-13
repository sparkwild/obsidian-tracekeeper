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
	AGENT_ACTION_KINDS,
	AGENT_ACTION_TIMINGS,
	AGENT_ACTION_REASON_CODES,
	AGENT_ACTION_SCHEMA,
	GENERIC_TOOL_OUTPUT_SCHEMA,
	START_TASK_OUTPUT_SCHEMA,
	RECALL_OUTPUT_SCHEMA,
	MEMORY_OUTPUT_SCHEMA,
	FINISH_TASK_OUTPUT_SCHEMA,
} = contracts;

const VALID_EFFECTS = new Set(['read', 'append', 'bounded-update', 'review-gated']);
const VALID_IDEMPOTENCY = new Set(['natural', 'keyed', 'none']);
const VALID_WORLD = new Set(['closed']);
const VALID_WORKFLOW_ROLES = new Set(['observe', 'recall', 'task-start', 'task-finish', 'review', 'source', 'memory']);
const EXPECTED_NONE_IDEMPOTENCY_TOOLS = new Set([
	'tracekeeper.source_request',
	'tracekeeper.analyze_source_request',
	'tracekeeper.build_context_pack',
	'tracekeeper.distill_session',
	'tracekeeper.write_context_pack',
	'tracekeeper.write_session_note',
]);
const EXPECTED_KEYED_IDEMPOTENCY_TOOLS = new Set([
	'tracekeeper.start_task',
	'tracekeeper.finish_task',
	'tracekeeper.apply_approved_writeback',
	'tracekeeper.capture_source',
	'tracekeeper.propose_memory',
]);

const publicNameSet = new Set(PUBLIC_TOOL_NAME_ORDER);
let visibilityMissing = 0;
const toolNameSet = new Set();
const actualNoneIdempotencyTools = new Set();
const actualKeyedIdempotencyTools = new Set();

function hasSchemaProperty(schema, property) {
	if (!schema || typeof schema !== 'object') {
		return false;
	}
	if (Object.prototype.hasOwnProperty.call(schema.properties || {}, property)) {
		return true;
	}
	if (Array.isArray(schema.oneOf)) {
		return schema.oneOf.some((branch) => {
			return !!(
				branch && typeof branch === 'object' && Object.prototype.hasOwnProperty.call(branch.properties || {}, property)
			);
		});
	}
	return false;
}

assert(Array.isArray(toolContracts), 'toolContracts should be an array');
assert(toolContracts.length > 0, 'toolContracts should not be empty');

for (const contract of toolContracts) {
	assert(!toolNameSet.has(contract.name), `tool name should be unique: ${contract.name}`);
	toolNameSet.add(contract.name);
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
	assert(VALID_EFFECTS.has(contract.effect), `tool contract ${contract.name} has invalid effect`);
	assert(VALID_IDEMPOTENCY.has(contract.idempotency), `tool contract ${contract.name} has invalid idempotency`);
	assert(VALID_WORLD.has(contract.world), `tool contract ${contract.name} has invalid world`);
	assert(
		VALID_WORKFLOW_ROLES.has(contract.workflowRole),
		`tool contract ${contract.name} has invalid workflowRole`,
	);
	assert(typeof contract.useCase === 'string' && contract.useCase.length > 0, `tool contract ${contract.name} missing useCase`);
	assert(contract.inputSchema && contract.inputSchema.type === 'object', `tool contract ${contract.name} missing input schema`);
	assert.equal(
		Object.prototype.hasOwnProperty.call(contract.inputSchema.properties, 'vaultRoot'),
		false,
		`tool contract ${contract.name} must not expose a caller-selected Vault root`,
	);
	assert.equal(contract.inputSchema.additionalProperties, false, `tool contract ${contract.name} must remain closed-world`);
	assert(contract.outputSchema && contract.outputSchema.type === 'object', `tool contract ${contract.name} missing output schema`);
	assert.deepStrictEqual(contract.outputSchema, contract.resultSchema, `tool contract ${contract.name} resultSchema must alias outputSchema`);
	if (contract.idempotency === 'none') {
		actualNoneIdempotencyTools.add(contract.name);
	} else if (contract.idempotency === 'keyed') {
		actualKeyedIdempotencyTools.add(contract.name);
	}
}

assert.strictEqual(toolNameSet.size, toolContracts.length, 'all tool names should be unique');
assert.deepStrictEqual(
	Array.from(actualNoneIdempotencyTools).sort(),
	Array.from(EXPECTED_NONE_IDEMPOTENCY_TOOLS).sort(),
	'none idempotency tools should be exact',
);
assert.deepStrictEqual(
	Array.from(actualKeyedIdempotencyTools).sort(),
	Array.from(EXPECTED_KEYED_IDEMPOTENCY_TOOLS).sort(),
	'keyed idempotency tools should be exact',
);

assert.deepStrictEqual(
	PUBLIC_TOOL_NAME_ORDER.length,
	new Set(PUBLIC_TOOL_NAME_ORDER).size,
	'public tool order must not contain duplicates',
);
for (const publicName of PUBLIC_TOOL_NAME_ORDER) {
	const contract = getContractByName(publicName);
	assert(contract, `public tool must have a contract: ${publicName}`);
	assert.strictEqual(contract.visibility, 'public', `public tool ${publicName} must be marked as visibility public`);
	assert(isPublicTool(publicName), `public tool should be recognized by isPublicTool: ${publicName}`);
	assert(!isCompatibilityTool(publicName), `public tool should not be compatibility: ${publicName}`);
	assert.strictEqual(contract.world, 'closed', `public tool should be closed world: ${publicName}`);
	assert(contract.outputSchema && typeof contract.outputSchema === 'object', `public tool ${publicName} needs output schema`);
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
		assert(typeof replacement === 'string' && replacement.length > 0, `deprecated replacement must be a string: ${contract.name}`);
		if (replacement.startsWith('tracekeeper.')) {
			const match = replacement.match(/^(tracekeeper\.[a-z_]+)/);
			assert(match, `deprecated replacement missing valid public tool: ${replacement}`);
			const replacementName = match[1];
			const replacementContract = getContractByName(replacementName);
			assert(replacementContract, `deprecated tool ${contract.name} replacement must resolve to known contract: ${replacement}`);
			assert.strictEqual(replacementContract.visibility, 'public', `deprecated replacement must be public: ${replacement}`);
		}
	} else {
		assert(contract.visibility !== 'compatibility', `non-deprecated tool should not be compatibility: ${contract.name}`);
	}
	if (isPublic) {
		assert.strictEqual(contract.visibility, 'public', `public tool list has non-public contract: ${contract.name}`);
	} else if (!contract.deprecated) {
		visibilityMissing += 1;
	}
}

assert.strictEqual(visibilityMissing, 0, 'non-public tools without deprecated contract should be explicit internal tools');

assert.deepStrictEqual(START_TASK_OUTPUT_SCHEMA, getContractByName('tracekeeper.start_task').outputSchema, 'start_task output schema must use START_TASK_OUTPUT_SCHEMA');
assert.deepStrictEqual(RECALL_OUTPUT_SCHEMA, getContractByName('tracekeeper.recall').outputSchema, 'recall output schema must use RECALL_OUTPUT_SCHEMA');
assert.deepStrictEqual(
		MEMORY_OUTPUT_SCHEMA,
		getContractByName('tracekeeper.memory').outputSchema,
		'memory output schema must use MEMORY_OUTPUT_SCHEMA',
);
assert.deepStrictEqual(FINISH_TASK_OUTPUT_SCHEMA, getContractByName('tracekeeper.finish_task').outputSchema, 'finish_task output schema must use FINISH_TASK_OUTPUT_SCHEMA');

const recallContract = getContractByName('tracekeeper.recall');
assert.equal(recallContract.version, 4);
assert.match(recallContract.description, /active local Obsidian Vault/i, 'recall should identify the local Vault boundary');
assert.deepStrictEqual(
	recallContract.inputSchema.properties.scope.enum,
	['global', 'project', 'project_history', 'task_history'],
	'recall should expose task history scope',
);
assert(Object.prototype.hasOwnProperty.call(recallContract.inputSchema.properties, 'task_id'));
assert.equal(recallContract.inputSchema.properties.query.minLength, 1);
assert.equal(recallContract.inputSchema.properties.max_items.minimum, 1);
assert.equal(recallContract.inputSchema.properties.max_items.maximum, 20);
assert.deepStrictEqual(recallContract.inputSchema.allOf[0].else.required, ['query']);
assert.deepStrictEqual(
	recallContract.inputSchema.allOf[0].if.properties.scope.enum,
	['project_history', 'task_history'],
);

const memoryContract = getContractByName('tracekeeper.memory');
assert.equal(memoryContract.capability, 'vault.read');
assert.equal(memoryContract.risk, 'read-only');
assert.equal(memoryContract.effect, 'read');
assert.equal(memoryContract.idempotency, 'natural');
assert.ok(memoryContract.outputSchema.oneOf[0].required.includes('read_only'));
assert.equal(memoryContract.outputSchema.oneOf[0].properties.read_only.const, true);
assert.deepStrictEqual(memoryContract.inputSchema.required, undefined);
assert.deepStrictEqual(memoryContract.inputSchema.properties.scope.enum, ['global', 'project']);
assert.deepStrictEqual(memoryContract.inputSchema.properties.view.enum, ['current', 'history', 'conflicts', 'all']);
assert.equal(memoryContract.inputSchema.properties.page_size.minimum, 1);
assert.equal(memoryContract.inputSchema.properties.page_size.maximum, 200);
for (const property of ['scope', 'view', 'project_hint', 'project_id', 'repo_path', 'repo', 'project_path', 'cursor', 'page_size']) {
	assert(
		Object.prototype.hasOwnProperty.call(memoryContract.inputSchema.properties, property),
		`memory should expose ${property}`,
	);
}
assert.equal(
	PUBLIC_TOOL_NAME_ORDER.indexOf('tracekeeper.memory'),
	PUBLIC_TOOL_NAME_ORDER.indexOf('tracekeeper.recall') + 1,
	'memory must follow recall in the public order',
);
assert.equal(
	PUBLIC_TOOL_NAME_ORDER.indexOf('tracekeeper.read_note'),
	PUBLIC_TOOL_NAME_ORDER.indexOf('tracekeeper.memory') + 1,
	'read_note must follow memory in the public order',
);
assert.match(memoryContract.description, /metadata only/i);
assert.match(memoryContract.description, /read_note/i);

const finishContract = getContractByName('tracekeeper.finish_task');
assert.equal(finishContract.version, 5);
assert.equal(finishContract.inputSchema.properties.memory_candidates, undefined);
assert.equal(finishContract.inputSchema.properties.review_proposal_mode, undefined);
assert.equal(finishContract.inputSchema.properties.memory_scope, undefined);
assert.equal(finishContract.inputSchema.properties.memory_candidate_records.items.required.includes('scope'), true);
assert.match(
	finishContract.inputSchema.properties.related_wiki.description,
	/local Vault Wiki note paths/i,
	'finish_task related_wiki should identify local Vault paths',
);
assert.match(finishContract.description, /canonical Markdown task record/i);
assert.match(finishContract.description, /without creating an implicit session note/i);
assert.match(finishContract.description, /start_task record is missing/i);
assert.match(finishContract.description, /reconstruct a complete task record/i);
assert.match(finishContract.inputSchema.properties.filename.description, /does not create/i);
assert.match(
	FINISH_TASK_OUTPUT_SCHEMA.oneOf[0].properties.task_path.description,
	/reconstructed at this path/i,
);

const proposeMemoryContract = getContractByName('tracekeeper.propose_memory');
assert.equal(proposeMemoryContract.version, 4);
const captureSourceContract = getContractByName('tracekeeper.capture_source');
assert.match(proposeMemoryContract.description, /active local Obsidian Vault/i, 'propose_memory should identify its local destination');
assert.match(proposeMemoryContract.description, /does not write to an external Wiki service/i, 'propose_memory should reject external-Wiki ambiguity');
assert.match(
	proposeMemoryContract.inputSchema.properties.target_note.description,
	/01_knowledge\/wiki\/\*\*/i,
	'propose_memory target_note should describe the local Wiki convention',
);
assert.deepStrictEqual(proposeMemoryContract.inputSchema.allOf[0].else.required, ['memory_scope']);
assert.match(
	proposeMemoryContract.inputSchema.allOf[0].if.properties.target_note.pattern,
	/01_knowledge\/wiki/,
);
for (const property of [
	'claim_key',
	'proposed_authority',
	'proposed_confidence',
	'declared_state',
	'observed_at',
	'valid_from',
	'valid_to',
	'last_verified_at',
	'evidence',
	'supersedes',
	'contradicts',
]) {
	assert(
		Object.prototype.hasOwnProperty.call(proposeMemoryContract.inputSchema.properties, property),
		`proposeMemoryContract should expose ${property}`,
	);
}
const finishTaskContract = getContractByName('tracekeeper.finish_task');
for (const property of ['memory_candidate_records']) {
	assert(
		Object.prototype.hasOwnProperty.call(finishTaskContract.inputSchema.properties, property),
		`finish_task should expose ${property}`,
	);
}
for (const property of ['project_id', 'repo_path']) {
	assert(
		Object.prototype.hasOwnProperty.call(proposeMemoryContract.inputSchema.properties, property),
		`propose_memory should expose ${property}`,
	);
}
for (const property of [
	'record_identity',
	'predicted_record',
	'predicted_state',
	'proposal_transition_preview',
	'review_reason',
	'review_warnings',
]) {
	assert(
		hasSchemaProperty(proposeMemoryContract.outputSchema, property),
		`propose_memory output should expose ${property}`,
	);
}
for (const property of ['memory_candidate_records', 'memory_changes', 'proposal_transition_receipts']) {
	assert(
		hasSchemaProperty(finishTaskContract.outputSchema, property),
		`finish_task output should expose ${property}`,
	);
}
const applyApprovedWritebackContract = getContractByName('tracekeeper.apply_approved_writeback');
const confirmationTokenDescription =
	applyApprovedWritebackContract.inputSchema.properties.confirmation_token?.description;
assert.equal(
	typeof confirmationTokenDescription,
	'string',
	'apply_approved_writeback should expose an opaque confirmation token input'
);
assert.match(
	confirmationTokenDescription,
	/opaque/i,
	'apply_approved_writeback should describe the confirmation token as opaque'
);
assert.match(
	confirmationTokenDescription,
	/preview|dry-run/i,
	'apply_approved_writeback should bind the confirmation token to its preview'
);
assert.match(
	confirmationTokenDescription,
	/expir/i,
	'apply_approved_writeback should document confirmation-token expiry'
);
assert.equal(
	Array.isArray(applyApprovedWritebackContract.inputSchema.required)
		&& applyApprovedWritebackContract.inputSchema.required.includes('confirmation_token'),
	false,
	'dry-run preview must not require an input confirmation token'
);
for (const contract of [captureSourceContract, proposeMemoryContract]) {
	assert.equal(contract.idempotency, 'keyed', `${contract.name} should support keyed retries`);
	assert.equal(typeof contract.inputSchema.properties.idempotency_key?.description, 'string', `${contract.name} should describe idempotency_key`);
}

for (const publicName of PUBLIC_TOOL_NAME_ORDER) {
	const contract = getContractByName(publicName);
	assert(contract, `public contract should exist for ${publicName}`);
	assert.notDeepStrictEqual(
		contract.outputSchema,
		GENERIC_TOOL_OUTPUT_SCHEMA,
		`${publicName} must not use the compatibility generic output schema`,
	);
	const branches = Array.isArray(contract.outputSchema.oneOf)
		? contract.outputSchema.oneOf
		: [contract.outputSchema];
	for (const branch of branches) {
		if (branch && typeof branch === 'object' && branch.additionalProperties !== undefined) {
			assert.equal(
				branch.additionalProperties,
				false,
				`${publicName} output branches must close the top-level field set`,
			);
		}
	}
}

for (const contract of toolContracts) {
	if (!isPublicTool(contract.name)) {
		assert.deepStrictEqual(
			contract.outputSchema,
			GENERIC_TOOL_OUTPUT_SCHEMA,
			`${contract.name} compatibility/internal tool should retain the generic output schema`,
		);
	}
}

const memoryCatalogSchema = MEMORY_OUTPUT_SCHEMA.oneOf[0];
assert.deepStrictEqual(
	memoryCatalogSchema.required,
	[
		'schema_version',
		'ok',
		'tool',
		'read_only',
		'scope',
		'view',
		'project_id',
		'generation',
		'total',
		'complete',
		'sort',
		'page',
		'entries',
	],
);
assert.equal(memoryCatalogSchema.additionalProperties, false);
assert.equal(memoryCatalogSchema.properties.complete.const, true);
assert.equal(
	memoryCatalogSchema.properties.sort.const,
	'observed_at_desc_memory_id_path_asc',
);
assert.deepStrictEqual(
	memoryCatalogSchema.properties.page.required,
	['page_size', 'next_cursor'],
);
const memoryEntrySchema = memoryCatalogSchema.properties.entries.items;
assert.equal(memoryEntrySchema.additionalProperties, false);
for (const forbidden of ['body', 'content', 'text', 'excerpt', 'absolutePath', 'absolute_path']) {
	assert.equal(
		Object.prototype.hasOwnProperty.call(memoryEntrySchema.properties, forbidden),
		false,
		`memory catalog descriptors must not expose ${forbidden}`,
	);
}

assert(Array.isArray(AGENT_ACTION_KINDS), 'AGENT_ACTION_KINDS should be an array');
assert(AGENT_ACTION_KINDS.includes('tool_call'), 'agent action kind should include tool_call');
assert(AGENT_ACTION_KINDS.includes('user_review'), 'agent action kind should include user_review');
assert(AGENT_ACTION_KINDS.includes('report_status'), 'agent action kind should include report_status');
assert(AGENT_ACTION_KINDS.includes('stop'), 'agent action kind should include stop');

assert(Array.isArray(AGENT_ACTION_TIMINGS), 'AGENT_ACTION_TIMINGS should be an array');
assert(AGENT_ACTION_TIMINGS.includes('immediate'), 'action timing should include immediate');
assert(AGENT_ACTION_TIMINGS.includes('if_context_insufficient'), 'action timing should include if_context_insufficient');
assert(AGENT_ACTION_TIMINGS.includes('at_task_closeout'), 'action timing should include at_task_closeout');

assert(Array.isArray(AGENT_ACTION_REASON_CODES), 'AGENT_ACTION_REASON_CODES should be an array');
for (const reasonCode of ['TASK_CONTEXT_REQUIRED', 'TASK_CLOSEOUT_REQUIRED', 'RECALL_EXCERPT_MAY_BE_INSUFFICIENT']) {
	assert(AGENT_ACTION_REASON_CODES.includes(reasonCode), `agent action reason codes should include ${reasonCode}`);
}
assert(AGENT_ACTION_REASON_CODES.includes('MEMORY_REVIEW_REQUIRED'), 'agent action reason codes should include MEMORY_REVIEW_REQUIRED');
assert(AGENT_ACTION_REASON_CODES.includes('MEMORY_NOT_PERSISTED'), 'agent action reason codes should include MEMORY_NOT_PERSISTED');

assert(Array.isArray(AGENT_ACTION_SCHEMA.required), 'AGENT_ACTION_SCHEMA should have required list');
for (const requiredField of ['action_id', 'kind', 'priority', 'required', 'timing', 'reason_code', 'reason']) {
	assert(AGENT_ACTION_SCHEMA.required.includes(requiredField), `agent action schema should require ${requiredField}`);
}

assert.strictEqual(AGENT_ACTION_SCHEMA.type, 'object', 'AGENT_ACTION_SCHEMA should be object schema');
assert(AGENT_ACTION_SCHEMA.properties && typeof AGENT_ACTION_SCHEMA.properties === 'object', 'AGENT_ACTION_SCHEMA should define properties');

console.log(
	`ok: validated ${toolContracts.length} contracts, ${PUBLIC_TOOL_NAME_ORDER.length} public in ordered list and ${visibilityMissing} internal tools`,
);
