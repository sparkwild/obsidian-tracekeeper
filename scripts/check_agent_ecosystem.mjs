#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CHECK_PATHS = {
	contract: 'docs/architecture/AGENT_WORKFLOW_CONTRACT.md',
	skill: 'skills/tracekeeper/SKILL.md',
	productIndex: 'docs/product/INDEX.md',
	architectureIndex: 'docs/architecture/INDEX.md',
	engineeringIndex: 'docs/engineering/INDEX.md',
	statusIndex: 'docs/status/INDEX.md',
	pluginOnboarding: 'apps/obsidian-plugin/src/features/settings/tracekeeper-setting-tab.ts',
	pluginBuild: 'apps/obsidian-plugin/scripts/build.mjs',
};

const CONTRACT_TOOL_PATTERNS = [
	{ name: 'golden workflow heading', pattern: /^## Golden Workflow$/im },
	{ name: 'closeout policy heading', pattern: /^## Closeout Policy$/im },
	{ name: 'review boundary heading', pattern: /^## Review Boundary$/im },
	{ name: 'skill packaging requirement heading', pattern: /^## Skill Packaging Requirements$/im },
];

const SKILL_REQUIREMENTS = [
	{ name: 'uses start_task', pattern: /tracekeeper\.start_task/i },
	{ name: 'uses recall', pattern: /tracekeeper\.recall/i },
	{ name: 'uses read_note as secondary', pattern: /tracekeeper\.read_note/i },
	{ name: 'uses finish_task', pattern: /tracekeeper\.finish_task/i },
	{ name: 'uses review queue', pattern: /tracekeeper\.review_queue/i },
	{ name: 'uses apply_approved_writeback', pattern: /tracekeeper\.apply_approved_writeback/i },
	{ name: 'states no permission grant', pattern: /(no|cannot|does not|never)\s+grant/i },
	{ name: 'states no token persistence', pattern: /(do not|never|avoid).*token/i },
	{ name: 'requires MCP availability check', pattern: /connection|mcp|unavailable|fails?/i },
];

const SKILL_FORBIDDEN_PATTERNS = [
	{ name: 'deprecated compatibility call project_context', pattern: /\bproject_context\b/i },
	{ name: 'deprecated compatibility call project_history', pattern: /\bproject_history\b/i },
	{ name: 'deprecated compatibility call list_review_queue', pattern: /\blist_review_queue\b/i },
	{ name: 'deprecated compatibility call write_session_note', pattern: /\bwrite_session_note\b/i },
	{ name: 'deprecated compatibility call distill_session', pattern: /\bdistill_session\b/i },
];

const DOC_REFERENCES = [
	{
		name: 'product index references skill path',
		file: 'productIndex',
		pattern: /skills\/tracekeeper\/SKILL\.md/i,
	},
	{
		name: 'architecture index references skill contract',
		file: 'architectureIndex',
		pattern: /skills\/tracekeeper\/SKILL\.md|Companion Skill/i,
	},
	{
		name: 'engineering index references ecosystem check',
		file: 'engineeringIndex',
		pattern: /agent:ecosystem|check_agent_ecosystem/i,
	},
	{
		name: 'status index has agent ecosystem section',
		file: 'statusIndex',
		pattern: /check_agent_ecosystem|agent.*ecosystem/i,
	},
];

function readFile(root, relPath) {
	const absolute = path.resolve(root, relPath);
	return fs.readFileSync(absolute, 'utf8');
}

function exists(root, relPath) {
	return fs.existsSync(path.resolve(root, relPath));
}

function collectChecks(items, text) {
	const failures = [];
	for (const item of items) {
		if (!item.pattern.test(text)) {
			failures.push(item.name);
		}
	}
	return failures;
}

export function runAgentEcosystemCheck(root = process.cwd()) {
	const result = {
		root,
		checks: [],
		errors: [],
		warnings: [],
	};

	for (const relPath of Object.values(CHECK_PATHS)) {
		if (!exists(root, relPath)) {
			result.errors.push(`Missing required file: ${relPath}`);
		} else {
			result.checks.push(`Found required file: ${relPath}`);
		}
	}

	if (result.errors.length > 0) {
		return result;
	}

	const contract = readFile(root, CHECK_PATHS.contract);
	const skill = readFile(root, CHECK_PATHS.skill);
	const productIndex = readFile(root, CHECK_PATHS.productIndex);
	const architectureIndex = readFile(root, CHECK_PATHS.architectureIndex);
	const engineeringIndex = readFile(root, CHECK_PATHS.engineeringIndex);
	const statusIndex = readFile(root, CHECK_PATHS.statusIndex);
	const pluginOnboarding = readFile(root, CHECK_PATHS.pluginOnboarding);
	const pluginBuild = readFile(root, CHECK_PATHS.pluginBuild);

	for (const entry of collectChecks(CONTRACT_TOOL_PATTERNS, contract)) {
		result.errors.push(`contract check failed: ${entry}`);
	}
	for (const entry of collectChecks(SKILL_REQUIREMENTS, skill)) {
		result.errors.push(`skill check failed: ${entry}`);
	}
	if (!/skills\/tracekeeper\/SKILL\.md/i.test(pluginOnboarding) || !/tracekeeperSkillContent/.test(pluginOnboarding)) {
		result.errors.push('plugin distribution check failed: companion Skill is not imported into onboarding');
	}
	if (!/['"]\.md['"]\s*:\s*['"]text['"]/.test(pluginBuild)) {
		result.errors.push('plugin distribution check failed: Markdown asset loader is not enabled');
	}

	const docMap = {
		productIndex,
		architectureIndex,
		engineeringIndex,
		statusIndex,
	};
	for (const entry of DOC_REFERENCES) {
		const txt = docMap[entry.file];
		if (!entry.pattern.test(txt)) {
			result.warnings.push(`${entry.name} check missing in ${entry.file}`);
		}
	}

	const badTokens = SKILL_FORBIDDEN_PATTERNS.filter((entry) => entry.pattern.test(skill));
	if (badTokens.length > 0) {
		for (const bad of badTokens) {
			result.errors.push(`skill policy check: deprecated compatibility symbol present: ${bad.name}`);
		}
	}

	if (result.errors.length === 0 && result.warnings.length === 0) {
		result.ok = true;
	} else {
		result.ok = false;
	}

	return result;
}

function main() {
	const args = process.argv.slice(2);
	const rootArgIndex = args.indexOf('--root');
	const root = rootArgIndex >= 0 && args[rootArgIndex + 1] ? args[rootArgIndex + 1] : process.cwd();
	const result = runAgentEcosystemCheck(root);

	if (!result.ok) {
		console.error('check_agent_ecosystem: failed');
		if (result.errors.length > 0) {
			for (const err of result.errors) {
				console.error(`- ${err}`);
			}
		}
		if (result.warnings.length > 0) {
			for (const warn of result.warnings) {
				console.error(`- warning: ${warn}`);
			}
		}
		process.exitCode = 1;
		return;
	}

	if (result.warnings.length > 0) {
		console.warn('check_agent_ecosystem: passed with warnings');
		for (const warn of result.warnings) {
			console.warn(`- warning: ${warn}`);
		}
		return;
	}

	console.log('check_agent_ecosystem: pass', JSON.stringify({
		targetFiles: Object.values(CHECK_PATHS),
		ok: true,
	}, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
