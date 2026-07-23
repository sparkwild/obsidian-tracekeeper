import fs from 'node:fs/promises';
import path from 'node:path';

const SCENARIO_CLASSES = new Set(['no_track', 'recall_only', 'tracked_task']);
const SCENARIO_KINDS = new Set(['positive', 'negative', 'failure_recovery', 'forbidden']);

function assertStringArray(value, label) {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
		throw new Error(`${label} must be an array of non-empty strings.`);
	}
}

function assertAgentMaterials(value, label) {
	if (value === undefined) {
		return;
	}
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array when provided.`);
	}
	for (const [index, material] of value.entries()) {
		if (!material || typeof material !== 'object' || Array.isArray(material)
			|| typeof material.path !== 'string' || material.path.trim().length === 0
			|| typeof material.content !== 'string') {
			throw new Error(`${label}[${index}] must provide non-empty path and string content.`);
		}
		const normalizedPath = path.posix.normalize(material.path.trim());
		if (path.posix.isAbsolute(normalizedPath) || normalizedPath === '..' || normalizedPath.startsWith('../') || normalizedPath.includes('\\')) {
			throw new Error(`${label}[${index}].path must remain workspace-relative.`);
		}
	}
}

export function validateScenario(scenario, source = 'scenario') {
	if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
		throw new Error(`${source} must be an object.`);
	}
	if (typeof scenario.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(scenario.id)) {
		throw new Error(`${source}.id must use lowercase kebab-case.`);
	}
	if (!SCENARIO_CLASSES.has(scenario.class)) {
		throw new Error(`${source}.class must be no_track, recall_only, or tracked_task.`);
	}
	if (!SCENARIO_KINDS.has(scenario.kind)) {
		throw new Error(`${source}.kind is invalid.`);
	}
	if (typeof scenario.prompt !== 'string' || scenario.prompt.trim().length === 0) {
		throw new Error(`${source}.prompt must be non-empty.`);
	}
	assertAgentMaterials(scenario.agent_materials, `${source}.agent_materials`);
	const expected = scenario.expected;
	if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
		throw new Error(`${source}.expected must be an object.`);
	}
	for (const key of [
		'required_tools',
		'forbidden_tools',
		'ordered_subsequence',
		'forbidden_behaviors',
		'required_reports',
	]) {
		assertStringArray(expected[key], `${source}.expected.${key}`);
	}
	if (expected.required_tools.some((tool) => expected.forbidden_tools.includes(tool))) {
		throw new Error(`${source} requires and forbids the same tool.`);
	}
	if (typeof expected.same_task_id !== 'boolean' || typeof expected.finish_exactly_once !== 'boolean') {
		throw new Error(`${source} must define task_id and finish cardinality expectations.`);
	}
	if (!Array.isArray(expected.argument_rules)) {
		throw new Error(`${source}.expected.argument_rules must be an array.`);
	}
	for (const [index, rule] of expected.argument_rules.entries()) {
		if (!rule || typeof rule.tool !== 'string') {
			throw new Error(`${source}.expected.argument_rules[${index}] must identify a tool.`);
		}
		assertStringArray(rule.required || [], `${source}.expected.argument_rules[${index}].required`);
		if (rule.equals !== undefined && (!rule.equals || typeof rule.equals !== 'object' || Array.isArray(rule.equals))) {
			throw new Error(`${source}.expected.argument_rules[${index}].equals must be an object.`);
		}
	}
	const closeout = expected.closeout_report;
	if (!closeout || typeof closeout.required !== 'boolean') {
		throw new Error(`${source}.expected.closeout_report.required must be boolean.`);
	}
	assertStringArray(closeout.allowed_statuses, `${source}.expected.closeout_report.allowed_statuses`);
	if (typeof closeout.match_finish_result !== 'boolean') {
		throw new Error(`${source}.expected.closeout_report.match_finish_result must be boolean.`);
	}
	return scenario;
}

export async function loadScenarios(scenarioDirectory) {
	const filenames = (await fs.readdir(scenarioDirectory))
		.filter((filename) => filename.endsWith('.json') && filename !== 'scenario.schema.json')
		.sort();
	const scenarios = [];
	for (const filename of filenames) {
		const absolutePath = path.join(scenarioDirectory, filename);
		const document = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
		if (!Array.isArray(document)) {
			throw new Error(`${filename} must contain a JSON array.`);
		}
		for (const [index, scenario] of document.entries()) {
			scenarios.push(validateScenario(scenario, `${filename}[${index}]`));
		}
	}
	const ids = new Set();
	for (const scenario of scenarios) {
		if (ids.has(scenario.id)) {
			throw new Error(`Duplicate scenario id: ${scenario.id}`);
		}
		ids.add(scenario.id);
	}
	return scenarios;
}
