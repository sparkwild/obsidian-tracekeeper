#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildComparison } from './comparison.mjs';
import { buildCurrentSkillV1Traces } from './current-skill-v1.mjs';
import { buildCurrentSkillV2Traces } from './current-skill-v2.mjs';
import { loadScenarios } from './scenario-loader.mjs';
import { evaluateTraces } from './trace-evaluator.mjs';

const evaluatorDirectory = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(evaluatorDirectory, '..');
const repositoryRoot = path.resolve(evalRoot, '..', '..');
const BASELINE_FILES = {
	v1: 'current-skill-v1.json',
	v2: 'current-skill-v2.json',
};
const TRACE_BUILDERS = {
	v1: buildCurrentSkillV1Traces,
	v2: buildCurrentSkillV2Traces,
};

function argumentValue(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : '';
}

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

async function loadBaseline(version) {
	const filename = BASELINE_FILES[version];
	if (!filename) {
		throw new Error('--baseline must be v1 or v2.');
	}
	return JSON.parse(await fs.readFile(path.join(evalRoot, 'baselines', filename), 'utf8'));
}

async function loadSkillSources(baseline, checkBaseline) {
	const specifications = baseline.skill_sources || [{ path: baseline.skill_path, sha256: baseline.skill_sha256 }];
	const documents = [];
	for (const specification of specifications) {
		const filename = path.resolve(repositoryRoot, specification.path);
		const text = await fs.readFile(filename, 'utf8');
		const actualSha256 = sha256(text);
		if (checkBaseline && actualSha256 !== specification.sha256) {
			throw new Error(`Skill source hash changed for ${specification.path}. Expected ${specification.sha256}, received ${actualSha256}.`);
		}
		documents.push({ path: specification.path, text, sha256: actualSha256 });
	}
	const primary = documents.find((document) => document.path === baseline.skill_path);
	if (!primary) {
		throw new Error(`Baseline primary Skill source is missing: ${baseline.skill_path}`);
	}
	if (checkBaseline && primary.sha256 !== baseline.skill_sha256) {
		throw new Error(`Primary Skill hash changed. Expected ${baseline.skill_sha256}, received ${primary.sha256}.`);
	}
	return { documents, primary };
}

function verifyExpectedReport(baseline, report, reportSha256) {
	const expected = baseline.expected_report;
	if (
		!expected ||
		report.average_score !== expected.average_score ||
		report.passed_count !== expected.passed_count ||
		JSON.stringify(report.failed_scenario_ids) !== JSON.stringify(expected.failed_scenario_ids) ||
		reportSha256 !== expected.report_sha256
	) {
		throw new Error(`${baseline.baseline_id} characterization changed; refresh the baseline intentionally.`);
	}
}

async function runBaseline(version, scenarios, options = {}) {
	const baseline = await loadBaseline(version);
	const source = await loadSkillSources(baseline, options.checkBaseline);
	if (options.checkBaseline && scenarios.length !== baseline.scenario_count) {
		throw new Error(`Scenario count changed; ${version} expects ${baseline.scenario_count}, received ${scenarios.length}.`);
	}
	const traces = options.traces || TRACE_BUILDERS[version](scenarios, source.documents);
	if (!Array.isArray(traces)) {
		throw new Error('Trace input must be a JSON array.');
	}
	const report = evaluateTraces(scenarios, traces, {
		baseline_id: baseline.baseline_id,
		baseline_kind: baseline.kind,
		skill_path: baseline.skill_path,
		skill_sha256: source.primary.sha256,
	});
	const reportSha256 = sha256(JSON.stringify(report));
	if (options.checkBaseline) {
		verifyExpectedReport(baseline, report, reportSha256);
	}
	return { ...report, report_sha256: reportSha256 };
}

async function writeReport(reportName, rendered) {
	if (!reportName) {
		return;
	}
	const reportsDirectory = path.join(evalRoot, 'reports');
	const reportPath = path.resolve(reportsDirectory, reportName);
	if (reportPath !== reportsDirectory && !reportPath.startsWith(`${reportsDirectory}${path.sep}`)) {
		throw new Error('--report must resolve inside evals/agent-initiative/reports/.');
	}
	await fs.mkdir(path.dirname(reportPath), { recursive: true });
	await fs.writeFile(reportPath, rendered, 'utf8');
}

async function main() {
	const scenarios = await loadScenarios(path.join(evalRoot, 'scenarios'));
	const checkBaseline = process.argv.includes('--check-baseline');
	const traceInput = argumentValue('--traces');
	const externalTraces = traceInput
		? JSON.parse(await fs.readFile(path.resolve(process.cwd(), traceInput), 'utf8'))
		: null;
	let output;
	if (process.argv.includes('--compare')) {
		if (externalTraces) {
			throw new Error('--compare does not accept --traces.');
		}
		const [v1, v2] = await Promise.all([
			runBaseline('v1', scenarios, { checkBaseline }),
			runBaseline('v2', scenarios, { checkBaseline }),
		]);
		output = buildComparison(scenarios, v1, v2);
	} else {
		const version = argumentValue('--baseline') || 'v1';
		output = await runBaseline(version, scenarios, { checkBaseline, traces: externalTraces });
	}
	const rendered = `${JSON.stringify(output, null, 2)}\n`;
	await writeReport(argumentValue('--report'), rendered);
	process.stdout.write(rendered);
	if (process.argv.includes('--strict')) {
		const strictFailure = output.comparison_id
			? output.v2.failed_scenario_ids.length > 0 || Object.values(output.guardrails).some((value) => !value)
			: output.failed_scenario_ids.length > 0;
		if (strictFailure) {
			process.exitCode = 1;
		}
	}
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
