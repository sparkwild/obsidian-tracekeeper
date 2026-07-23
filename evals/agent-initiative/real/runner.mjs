#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { evaluateTrace } from '../evaluator/trace-evaluator.mjs';
import { validateScenario } from '../evaluator/scenario-loader.mjs';
import { cleanupSyntheticVault, createSyntheticVault } from './synthetic-vault.mjs';
import { normalizeCodexTrace } from './trace-parser.mjs';

const runnerDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(runnerDirectory, '../../..');
const mcpRuntimePath = path.resolve(repositoryRoot, 'apps', 'mcp-server', 'dist', 'server.js');
const defaultScenariosPath = path.resolve(runnerDirectory, 'scenarios.json');
const reportsRoot = path.resolve(runnerDirectory, '..', 'reports');
const defaultReportRoot = path.join(reportsRoot, 'real');
const codexBackupBinary = '/Applications/ChatGPT.app/Contents/Resources/codex';
const tokenEnvName = 'TRACEKEEPER_REAL_EVAL_TOKEN';
const MCP_START_TIMEOUT_MS = 15000;
const MCP_SHUTDOWN_TIMEOUT_MS = 2000;
const MCP_PORT = '0';
const MCP_HOST = '127.0.0.1';
const DEFAULT_MCP_ONLY_SKILL_ROOTS = [
	path.join(os.homedir(), '.agents', 'skills'),
	path.join(os.homedir(), '.codex', 'skills'),
	path.join(os.homedir(), '.codex', 'plugins'),
	path.join(os.homedir(), 'Library', 'Application Support', 'Codex', 'skills'),
];
const TOKEN_REDACT = '[REDACTED_TOKEN]';
const TMP_ROOT_REDACT = '[REDACTED_TMP_ROOT]';
const HOME_REDACT = '[REDACTED_HOME]';

function normalizeText(value) {
	return typeof value === 'string' ? value.trim() : '';
}

function splitArgList(raw) {
	if (!raw) {
		return [];
	}
	return raw
		.split(',')
		.map((entry) => normalizeText(entry).toLowerCase())
		.filter(Boolean);
}

function parseArgs(argv) {
	const options = {
		scenarioIds: [],
		arm: ['both'],
		repetitions: 1,
		scenariosPath: defaultScenariosPath,
		strict: false,
		execute: false,
		maxScenarios: 0,
		keepVault: false,
		model: '',
		codexBinary: '',
		outputDirArg: '',
		reportArg: '',
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = argv[index + 1];
		if (arg === '--scenario' || arg === '--only-id' || arg === '--only-ids') {
			options.scenarioIds.push(...splitArgList(next));
			index += 1;
			continue;
		}
		if (arg === '--arm' && next) {
			options.arm = splitArgList(next);
			index += 1;
			continue;
		}
		if (arg === '--repetitions' && next) {
			options.repetitions = Number.parseInt(next, 10) || 1;
			index += 1;
			continue;
		}
		if (arg === '--scenarios' && next) {
			options.scenariosPath = next;
			index += 1;
			continue;
		}
		if (arg === '--max-scenarios' && next) {
			options.maxScenarios = Number.parseInt(next, 10) || 0;
			index += 1;
			continue;
		}
		if (arg === '--model' && next) {
			options.model = next;
			index += 1;
			continue;
		}
		if (arg === '--codex-bin' || arg === '--codex-binary') {
			if (next) {
				options.codexBinary = next;
				index += 1;
			}
			continue;
		}
		if (arg === '--output-dir' && next) {
			options.outputDirArg = next;
			index += 1;
			continue;
		}
		if (arg === '--report' && next) {
			options.reportArg = next;
			index += 1;
			continue;
		}
		if (arg === '--strict') {
			options.strict = true;
			continue;
		}
		if (arg === '--execute') {
			options.execute = true;
			continue;
		}
		if (arg === '--keep-vault') {
			options.keepVault = true;
			continue;
		}
	}

	options.arm = normalizeArms(options.arm);
	if (!Number.isInteger(options.repetitions) || options.repetitions < 1) {
		options.repetitions = 1;
	}
	if (!Number.isInteger(options.maxScenarios) || options.maxScenarios < 0) {
		options.maxScenarios = 0;
	}
	if (options.scenarioIds.length) {
		options.scenarioIds = [...new Set(options.scenarioIds)];
	}
	return options;
}

function normalizeArms(rawArms) {
	if (!Array.isArray(rawArms) || rawArms.length === 0) {
		return ['both'];
	}
	const valid = [];
	const seen = new Set();
	for (const raw of rawArms) {
		for (const value of splitArgList(raw)) {
			if (!['mcp-only', 'mcp-skill', 'both'].includes(value)) {
				continue;
			}
			if (seen.has(value)) {
				continue;
			}
			seen.add(value);
			valid.push(value);
		}
	}
	return valid.length ? valid : ['both'];
}

function expandArms(requestedArms) {
	const normalized = requestedArms.length ? requestedArms : ['both'];
	if (normalized.includes('both')) {
		return ['mcp-only', 'mcp-skill'];
	}
	return normalized;
}

function isInsideReportsDir(candidate) {
	const normalizedRoot = reportsRoot;
	const normalizedCandidate = path.resolve(candidate);
	if (normalizedCandidate === normalizedRoot) {
		return true;
	}
	const relative = path.relative(normalizedRoot, normalizedCandidate);
	return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveOutputPaths(options) {
	const runId = `${new Date().toISOString().replace(/[.:]/g, '-')}-${Math.floor(Math.random() * 1e6)}`;
	const defaultPath = path.resolve(defaultReportRoot, runId);
	if (!options.outputDirArg && !options.reportArg) {
		return { runId, outputDir: defaultPath, aggregatePath: path.join(defaultPath, 'aggregate.json') };
	}
	if (options.outputDirArg) {
		const directory = path.resolve(process.cwd(), options.outputDirArg);
		if (!isInsideReportsDir(directory)) {
			throw new Error('--output-dir must be inside evals/agent-initiative/reports');
		}
		return { runId, outputDir: directory, aggregatePath: path.join(directory, 'aggregate.json') };
	}
	const reportPath = path.resolve(process.cwd(), options.reportArg);
	if (!isInsideReportsDir(reportPath)) {
		throw new Error('--report must resolve inside evals/agent-initiative/reports');
	}
	const statExt = path.extname(reportPath).toLowerCase() === '.json';
	if (statExt) {
		return { runId, outputDir: path.dirname(reportPath), aggregatePath: reportPath };
	}
	return { runId, outputDir: reportPath, aggregatePath: path.join(reportPath, 'aggregate.json') };
}

function sanitizeForLog(value, replacements) {
	let current = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
	for (const [raw, replacement] of replacements) {
		current = current.split(raw).join(replacement);
	}
	return current;
}

async function loadScenarios(scenariosPath) {
	const content = await fs.readFile(path.resolve(scenariosPath), 'utf8');
	const parsed = JSON.parse(content);
	if (!Array.isArray(parsed)) {
		throw new Error(`Scenario manifest must be an array: ${scenariosPath}`);
	}
	return parsed.map((scenario, index) => validateScenario(scenario, `${scenariosPath}[${index}]`));
}

function selectScenarios(allScenarios, ids, maxScenarios) {
	let selected = allScenarios;
	if (Array.isArray(ids) && ids.length > 0) {
		const wanted = new Set(ids);
		selected = allScenarios.filter((scenario) => wanted.has(scenario.id));
	}
	if (selected.length === 0) {
		throw new Error(`No matching scenario ids: ${ids.join(', ')}`);
	}
	if (maxScenarios > 0) {
		selected = selected.slice(0, maxScenarios);
	}
	return selected;
}

function parseFrontmatterName(markdown) {
	if (!markdown || typeof markdown !== 'string') {
		return null;
	}
	const match = markdown.match(/^---\n([\s\S]*?)\n---/);
	if (!match) {
		return null;
	}
	const line = match[1].split('\n').find((entry) => entry.trim().startsWith('name:'));
	if (!line) {
		return null;
	}
	return line.replace('name:', '').trim().replace(/^['\"]|['\"]$/g, '');
}

async function getTracekeeperSkillsFromRoot(root) {
	const found = [];
	const queue = [{ directory: root, depth: 0 }];
	while (queue.length > 0) {
		const { directory, depth } = queue.shift();
		let entries = [];
		try {
			entries = await fs.readdir(directory, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			const child = path.join(directory, entry.name);
			try {
				const skillName = parseFrontmatterName(await fs.readFile(path.join(child, 'SKILL.md'), 'utf8'));
				if (skillName === 'tracekeeper') {
					found.push(child);
					continue;
				}
			} catch {
				// This directory is not a Skill root.
			}
			if (depth < 8) {
				queue.push({ directory: child, depth: depth + 1 });
			}
		}
	}
	return found;
}

async function hasExternalTracekeeperSkill() {
	const all = [];
	for (const root of DEFAULT_MCP_ONLY_SKILL_ROOTS) {
		const found = await getTracekeeperSkillsFromRoot(root);
		for (const item of found) {
			all.push(item);
		}
	}
	return [...new Set(all)];
}

function parseMcpEndpointLine(line) {
	const text = normalizeText(line);
	if (!text) {
		return null;
	}
	try {
		const payload = JSON.parse(text);
		if (payload && typeof payload.endpoint === 'string' && payload.endpoint.length > 0) {
			return payload.endpoint;
		}
	} catch {
		const match = text.match(/https?:\/\/\S+/);
		return match && match[0].startsWith('http') ? match[0].replace(/["',]$/, '') : null;
	}
	return null;
}

async function startMcpServer(vaultRoot, token, runRoot) {
	const args = ['--vault-root', vaultRoot, '--host', MCP_HOST, '--port', MCP_PORT, '--token', token];
	const server = spawn('node', [mcpRuntimePath, ...args], {
		cwd: runRoot,
		env: { ...process.env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	let output = '';
	let endpoint = null;
	let stderrText = '';

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			stopProcess(server);
			reject(new Error(`MCP server startup timeout (${MCP_START_TIMEOUT_MS}ms)`));
		}, MCP_START_TIMEOUT_MS);
		server.stdout.on('data', (chunk) => {
			if (endpoint) {
				return;
			}
			output += chunk.toString('utf8');
			for (const line of output.split(/\r?\n/)) {
				const current = parseMcpEndpointLine(line);
				if (current) {
					endpoint = current;
					clearTimeout(timeout);
					resolve({ server, endpoint, mcpStdout: output, mcpStderr: stderrText });
				}
			}
		});
		server.stderr.on('data', (chunk) => {
			stderrText += chunk.toString('utf8');
		});
		server.once('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		server.once('exit', (code) => {
			if (endpoint) {
				return;
			}
			clearTimeout(timeout);
			reject(new Error(`MCP server exited (${code || 1}) before endpoint available.`));
		});
	});
}

async function stopProcess(child) {
	if (!child || child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	await new Promise((resolve) => {
		let forceTimer;
		let fallbackTimer;
		const done = () => {
			clearTimeout(forceTimer);
			clearTimeout(fallbackTimer);
			resolve();
		};
		child.once('exit', done);
		if (!child.kill('SIGTERM')) {
			done();
			return;
		}
		forceTimer = setTimeout(() => {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill('SIGKILL');
			}
		}, MCP_SHUTDOWN_TIMEOUT_MS);
		fallbackTimer = setTimeout(() => {
			done();
		}, MCP_SHUTDOWN_TIMEOUT_MS * 2);
	});
}

function resolveCodexBinary(preferred) {
	const candidates = [preferred, 'codex', codexBackupBinary].filter(Boolean);
	for (const candidate of candidates) {
		try {
			const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'] });
			if (!result.error && result.status === 0) {
				return candidate;
			}
		} catch {
			// continue
		}
	}
	throw new Error('No usable codex binary found. Use --codex-bin to specify a command.');
}

function buildCodexPrompt(scenario) {
	return [
		'Work only with the synthetic project context available in this evaluation workspace.',
		'Do not modify repository files. Answer the user request below, using available tools only when appropriate.',
		'',
		scenario.prompt,
	].join('\n');
}

function isPathLikeProjectHint(value) {
	const normalized = normalizeText(value);
	return Boolean(
		normalized &&
		(
			/^[A-Za-z]:[\\/]/.test(normalized) ||
			normalized.startsWith('/') ||
			normalized.startsWith('./') ||
			normalized.startsWith('../') ||
			normalized.includes('\\') ||
			normalized.startsWith('file:')
		)
	);
}

function collectToolInteractions(events, toolName) {
	const pending = [];
	const interactions = [];
	let callOrder = 0;
	for (const [eventIndex, event] of (events || []).entries()) {
		if (event.type === 'tool_call') {
			callOrder += 1;
			if (event.tool === toolName) {
				const interaction = { call: event, result: null, eventIndex, callOrder };
				pending.push(interaction);
				interactions.push(interaction);
			}
			continue;
		}
		if (event.type !== 'tool_result' || event.tool !== toolName) {
			continue;
		}
		const interaction = pending.find((entry) => entry.result === null);
		if (interaction) {
			interaction.result = event.result;
		}
	}
	return interactions;
}

function projectIdentityFromResult(result) {
	const identity = result?.project_identity && typeof result.project_identity === 'object'
		? result.project_identity
		: {};
	const scope = result?.scope && typeof result.scope === 'object' ? result.scope : {};
	return {
		projectHint: normalizeText(identity.project_hint ?? identity.projectHint ?? scope.project_hint ?? result?.project_hint),
		projectId: normalizeText(identity.project_id ?? identity.projectId ?? scope.project_id ?? result?.project_id),
		repoPath: normalizeText(identity.repo_path ?? identity.repoPath ?? scope.repo_path ?? result?.repo_path),
	};
}

function projectIdentityMatchesScenario(result, scenario, requireRepoPath = false) {
	const identity = projectIdentityFromResult(result);
	const expectedHint = normalizeText(scenario.project_hint).toLowerCase();
	const expectedProjectId = normalizeText(scenario.project_id).toLowerCase();
	if (!identity.projectHint || isPathLikeProjectHint(identity.projectHint)) {
		return false;
	}
	if (expectedHint && identity.projectHint.toLowerCase() !== expectedHint) {
		return false;
	}
	if (expectedProjectId && identity.projectId.toLowerCase() !== expectedProjectId) {
		return false;
	}
	if (requireRepoPath && normalizeText(scenario.repo_path) && !identity.repoPath) {
		return false;
	}
	return true;
}

function recallEntries(result) {
	if (Array.isArray(result?.entries)) {
		return result.entries;
	}
	if (Array.isArray(result?.matches)) {
		return result.matches;
	}
	return [];
}

function firstRecallRanksDurableProjectMemory(result) {
	const firstPath = normalizeText(recallEntries(result)[0]?.path).replace(/\\/g, '/');
	return firstPath.startsWith('01_knowledge/memory/projects/');
}

function recallSignature(args) {
	const input = args && typeof args === 'object' ? args : {};
	return JSON.stringify([
		normalizeText(input.query).toLowerCase(),
		normalizeText(input.scope).toLowerCase(),
		normalizeText(input.project_hint).toLowerCase(),
		normalizeText(input.project_id).toLowerCase(),
		normalizeText(input.repo_path ?? input.repo ?? input.project_path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(),
	]);
}

function parseEvaluationAndSummary(scenario, trace, codexResult) {
	const evaluation = evaluateTrace(scenario, trace);
	const calls = trace.events?.filter((entry) => entry.type === 'tool_call') || [];
	const results = trace.events?.filter((entry) => entry.type === 'tool_result') || [];
	const finishCalls = calls.filter((call) => call.tool === 'tracekeeper.finish_task');
	const startResults = results.filter((result) => result.tool === 'tracekeeper.start_task');
	const recallInteractions = collectToolInteractions(trace.events, 'tracekeeper.recall');
	const noTrackTools = calls.filter((call) => /^tracekeeper\./.test(call.tool));
	const called = new Set(calls.map((call) => call.tool));
	const calledInOrder = calls.map((call) => call.tool);
	const toolErrorCount = results.filter((result) => result.result?.error).length;
	const expected = scenario.expected || {};
	const expectExactlyOnce = expected.finish_exactly_once !== false;
	const expectSameTaskId = expected.same_task_id !== false;
	const lastFinish = finishCalls.at(-1);
	const lastFinishArgs = lastFinish?.args && typeof lastFinish.args === 'object' ? lastFinish.args : null;
	const relatedWikiExpected = Array.isArray(scenario.related_wiki) && scenario.related_wiki.length > 0
		? scenario.related_wiki.every((entry) => Array.isArray(lastFinishArgs?.related_wiki) && lastFinishArgs.related_wiki.includes(entry))
		: null;
	const relatedSourcesExpected = Array.isArray(scenario.related_sources) && scenario.related_sources.length > 0
		? scenario.related_sources.every((entry) => Array.isArray(lastFinishArgs?.related_sources) && lastFinishArgs.related_sources.includes(entry))
		: null;
	const noTrackFalsePositive = scenario.class === 'no_track' && noTrackTools.length > 0;
	const startIndex = calledInOrder.indexOf('tracekeeper.start_task');
	const recallIndex = calledInOrder.findIndex((tool, index) =>
		index > startIndex && (tool === 'tracekeeper.recall' || tool === 'tracekeeper.review_queue')
	);
	const finishIndex = calledInOrder.indexOf('tracekeeper.finish_task');
	const trackedFlow = startIndex >= 0 && recallIndex > startIndex && finishIndex > recallIndex;
	const finishCount = finishCalls.length;
	const lastStartTaskId = startResults.at(-1)?.result?.task_id;
	const toolCallsWithTaskId = calls.filter((call) => call.args && Object.prototype.hasOwnProperty.call(call.args, 'task_id'));
	const trackedTaskContinuity = scenario.class === 'tracked_task' && expectSameTaskId && typeof lastStartTaskId === 'string'
		? toolCallsWithTaskId.length > 0 && toolCallsWithTaskId.every((call) => call.args.task_id === lastStartTaskId)
		: null;
	const identityProbe = Boolean(scenario.identity_probe);
	const firstRecall = recallInteractions[0] || null;
	const firstRecallIdentityCorrect = identityProbe && firstRecall
		? projectIdentityMatchesScenario(firstRecall.result, scenario, true)
		: null;
	const firstRecallDurableHit = identityProbe && firstRecall
		? firstRecallRanksDurableProjectMemory(firstRecall.result)
		: null;
	const laterEffectiveRecall = identityProbe && firstRecall
		? recallInteractions.slice(1).find((interaction) =>
			projectIdentityMatchesScenario(interaction.result, scenario, true) &&
			firstRecallRanksDurableProjectMemory(interaction.result)
		)
		: null;
	const effectiveRecall = identityProbe
		? recallInteractions.find((interaction) =>
			projectIdentityMatchesScenario(interaction.result, scenario, true) &&
			firstRecallRanksDurableProjectMemory(interaction.result)
		) || null
		: null;
	const recallSignatures = recallInteractions.map((interaction) => recallSignature(interaction.call.args));
	const duplicateRecallCount = recallSignatures.length - new Set(recallSignatures).size;
	return {
		scenario_id: scenario.id,
		arm: trace.arm,
		repetition: trace.repetition,
		expected: scenario.class,
		observed: trace.classification,
		passed: evaluation.passed,
		checks: evaluation.checks,
		tool_calls: calls.map((item) => ({ tool: item.tool, args: item.args })),
		no_track_false_positive: noTrackFalsePositive,
		track_task_flow_ok: scenario.class === 'tracked_task' ? trackedFlow : null,
		track_task_finish_once: scenario.class === 'tracked_task' ? (expectExactlyOnce ? finishCount === 1 : finishCount === 0) : null,
		review_queue_called: called.has('tracekeeper.review_queue'),
		start_called: called.has('tracekeeper.start_task'),
		recall_called: called.has('tracekeeper.recall'),
		finish_called: called.has('tracekeeper.finish_task'),
		recall_only_called: scenario.class === 'recall_only' ? (called.has('tracekeeper.recall') || called.has('tracekeeper.review_queue')) : null,
		related_wiki_propagation: relatedWikiExpected,
		related_sources_propagation: relatedSourcesExpected,
		no_track_true_negative: scenario.class === 'no_track' && !noTrackFalsePositive,
		finish_task_id_continuity: scenario.class === 'tracked_task' ? trackedTaskContinuity : null,
		tool_error: toolErrorCount > 0,
		tool_error_count: toolErrorCount,
		tool_call_count: calls.length,
		start_project_identity_correct: identityProbe && startResults.length > 0
			? projectIdentityMatchesScenario(startResults.at(-1).result, scenario, true)
			: null,
		first_project_recall_identity_correct: firstRecallIdentityCorrect,
		first_recall_durable_project_memory_hit: firstRecallDurableHit,
		project_identity_recovery_required: identityProbe && firstRecall
			? (!firstRecallIdentityCorrect || !firstRecallDurableHit) && Boolean(laterEffectiveRecall)
			: null,
		duplicate_recall_count: duplicateRecallCount,
		duplicate_recall: recallInteractions.length > 0 ? duplicateRecallCount > 0 : null,
		tool_calls_before_effective_recall: effectiveRecall?.callOrder ?? null,
		diagnostics_count: (trace.diagnostics || []).length,
		agent_message: trace.agent_message || '',
		run_exit_code: codexResult?.exitCode ?? 0,
		unknown_event_types: trace.unknown_event_types || [],
	};
}

function computeArmAggregate(scenarios, summaries, armName) {
	const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
	const relevant = summaries.filter((summary) => summary.arm === armName);
	const total = relevant.length;
	const byClass = {
		no_track: relevant.filter((entry) => byId.get(entry.scenario_id)?.class === 'no_track'),
		recall_only: relevant.filter((entry) => byId.get(entry.scenario_id)?.class === 'recall_only'),
		tracked_task: relevant.filter((entry) => byId.get(entry.scenario_id)?.class === 'tracked_task'),
	};
	const noTrackCount = byClass.no_track.length;
	const recallCount = byClass.recall_only.length;
	const trackedCount = byClass.tracked_task.length;
	const relatedWikiDenom = relevant.filter((entry) =>
		byId.get(entry.scenario_id)?.class === 'tracked_task' &&
		byId.get(entry.scenario_id)?.related_wiki?.length > 0
	).length;
	const relatedSourceDenom = relevant.filter((entry) =>
		byId.get(entry.scenario_id)?.class === 'tracked_task' &&
		byId.get(entry.scenario_id)?.related_sources?.length > 0
	).length;
	const correctlyClassified = relevant.filter((entry) => entry.execution_ok && entry.observed === entry.expected).length;
	const recallExpected = relevant.filter((entry) =>
		byId.get(entry.scenario_id)?.expected?.required_tools?.includes('tracekeeper.recall')
	);
	const recallInvoked = recallExpected.filter((entry) => entry.recall_called).length;
	const trackedFlow = byClass.tracked_task.filter((entry) => entry.track_task_flow_ok).length;
	const taskContinuity = byClass.tracked_task.filter((entry) => entry.finish_task_id_continuity).length;
	const noTrackFp = byClass.no_track.filter((entry) => entry.no_track_false_positive).length;
	const toolErrors = relevant.reduce((sum, entry) => sum + (entry.tool_error_count || 0), 0);
	const toolCalls = relevant.reduce((sum, entry) => sum + (entry.tool_call_count || 0), 0);
	const relatedWiki = relevant.filter((entry) => entry.related_wiki_propagation).length;
	const relatedSources = relevant.filter((entry) => entry.related_sources_propagation).length;
	const trackedFinishOnce = byClass.tracked_task.filter((entry) => entry.track_task_finish_once).length;
	const startIdentitySamples = relevant.filter((entry) => entry.start_project_identity_correct !== null);
	const projectRecallIdentitySamples = relevant.filter((entry) => entry.first_project_recall_identity_correct !== null);
	const durableRecallSamples = relevant.filter((entry) => entry.first_recall_durable_project_memory_hit !== null);
	const identityRecoverySamples = relevant.filter((entry) => entry.project_identity_recovery_required !== null);
	const duplicateRecallSamples = relevant.filter((entry) => entry.duplicate_recall !== null);
	const effectiveRecallSamples = relevant.filter((entry) => entry.tool_calls_before_effective_recall !== null);
	return {
		arm: armName,
		total_runs: total,
		executed_runs: relevant.filter((entry) => entry.execution_ok).length,
		mode_classification_rate: total ? Number((correctlyClassified / total).toFixed(4)) : 0,
		recall_invocation_rate: recallExpected.length ? Number((recallInvoked / recallExpected.length).toFixed(4)) : 0,
		tracked_start_recall_finish_rate: trackedCount ? Number((trackedFlow / trackedCount).toFixed(4)) : 0,
		task_id_continuity_rate: trackedCount ? Number((taskContinuity / trackedCount).toFixed(4)) : 0,
		tracked_finish_once_rate: trackedCount ? Number((trackedFinishOnce / trackedCount).toFixed(4)) : 0,
		no_track_false_positive_rate: noTrackCount ? Number((noTrackFp / noTrackCount).toFixed(4)) : 0,
		tool_error_rate: toolCalls ? Number((toolErrors / toolCalls).toFixed(4)) : 0,
		related_wiki_propagation: relatedWikiDenom ? Number((relatedWiki / relatedWikiDenom).toFixed(4)) : 0,
		related_sources_propagation: relatedSourceDenom ? Number((relatedSources / relatedSourceDenom).toFixed(4)) : 0,
		start_project_identity_resolution_rate: startIdentitySamples.length
			? Number((startIdentitySamples.filter((entry) => entry.start_project_identity_correct).length / startIdentitySamples.length).toFixed(4))
			: 0,
		first_project_recall_identity_rate: projectRecallIdentitySamples.length
			? Number((projectRecallIdentitySamples.filter((entry) => entry.first_project_recall_identity_correct).length / projectRecallIdentitySamples.length).toFixed(4))
			: 0,
		first_recall_durable_memory_hit_rate: durableRecallSamples.length
			? Number((durableRecallSamples.filter((entry) => entry.first_recall_durable_project_memory_hit).length / durableRecallSamples.length).toFixed(4))
			: 0,
		project_identity_recovery_rate: identityRecoverySamples.length
			? Number((identityRecoverySamples.filter((entry) => entry.project_identity_recovery_required).length / identityRecoverySamples.length).toFixed(4))
			: 0,
		duplicate_recall_rate: duplicateRecallSamples.length
			? Number((duplicateRecallSamples.filter((entry) => entry.duplicate_recall).length / duplicateRecallSamples.length).toFixed(4))
			: 0,
		average_tool_calls_per_run: total
			? Number((toolCalls / total).toFixed(4))
			: 0,
		average_tool_calls_before_effective_recall: effectiveRecallSamples.length
			? Number((
				effectiveRecallSamples.reduce((sum, entry) => sum + entry.tool_calls_before_effective_recall, 0) /
				effectiveRecallSamples.length
			).toFixed(4))
			: 0,
		executed_runs_by_class: {
			no_track: noTrackCount,
			recall_only: recallCount,
			tracked_task: trackedCount,
		},
	};
}

function buildDelta(armSummaries) {
	if (!armSummaries['mcp-skill'] || !armSummaries['mcp-only']) {
		return null;
	}
	const rateKeys = [
		'mode_classification_rate',
		'recall_invocation_rate',
		'tracked_start_recall_finish_rate',
		'task_id_continuity_rate',
		'tracked_finish_once_rate',
		'no_track_false_positive_rate',
		'tool_error_rate',
		'related_wiki_propagation',
		'related_sources_propagation',
		'start_project_identity_resolution_rate',
		'first_project_recall_identity_rate',
		'first_recall_durable_memory_hit_rate',
		'project_identity_recovery_rate',
		'duplicate_recall_rate',
		'average_tool_calls_per_run',
		'average_tool_calls_before_effective_recall',
	];
	return Object.fromEntries(rateKeys.map((key) => [
		key,
		Number((armSummaries['mcp-skill'][key] - armSummaries['mcp-only'][key]).toFixed(4)),
	]));
}

async function runCodexOnce(scenario, codexBinary, options) {
	const prompt = buildCodexPrompt(scenario);
	const args = [
		'exec',
		'--ephemeral',
		'--json',
		'--ignore-user-config',
		'--sandbox',
		'read-only',
		'--cd',
		options.workingRoot,
		'--skip-git-repo-check',
		'-c',
		`mcp_servers.tracekeeper.url=${JSON.stringify(options.endpoint)}`,
		'-c',
		`mcp_servers.tracekeeper.bearer_token_env_var=${JSON.stringify(tokenEnvName)}`,
		'-c',
		'mcp_servers.tracekeeper.required=true',
		...(options.model ? ['-m', options.model] : []),
		prompt,
	];
	const env = {
		...process.env,
		[tokenEnvName]: options.token,
	};
	let stdout = '';
	let stderr = '';
	let exitCode = 1;
	let timeout;
	const codex = spawn(codexBinary, args, {
		cwd: options.workingRoot,
		env,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const result = await new Promise((resolve, reject) => {
		timeout = setTimeout(() => {
			codex.kill('SIGKILL');
			reject(new Error(`codex execution timeout (${options.timeoutMs}ms)`));
		}, options.timeoutMs);
		codex.stdout.on('data', (chunk) => {
			stdout += chunk.toString('utf8');
		});
		codex.stderr.on('data', (chunk) => {
			stderr += chunk.toString('utf8');
		});
		codex.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		codex.on('close', (code) => {
			clearTimeout(timeout);
			exitCode = code === null ? 1 : code;
			resolve({ exitCode: exitCode, stdout, stderr });
		});
	});
	return result;
}

function runFailureTrace(scenario, reason) {
	return {
		scenario_id: scenario.id,
		classification: 'no_track',
		events: [{ type: 'assistant_report', closeout_status: 'requires_user_action', codes: ['mcp_unreachable'] }],
		diagnostics: [{ type: 'execution_failure', reason }],
		agent_message: '',
		unknown_event_types: [],
	};
}

async function runSingle(scenario, options, runOutputDir) {
	const runLabel = `${scenario.id}-${options.arm}-${options.repetition}-${options.runId}`;
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-real-'));
	const vaultRoot = path.join(tempRoot, 'vault');
	await fs.mkdir(path.join(tempRoot, '.git'), { recursive: true });
	await createSyntheticVault({
		vaultRoot,
		scenario,
		repoPath: tempRoot,
		label: 'run',
		runId: runLabel,
	});

	if (options.arm === 'mcp-skill') {
		const source = path.resolve(repositoryRoot, 'skills', 'tracekeeper');
		const destination = path.resolve(tempRoot, '.agents', 'skills', 'tracekeeper');
		await fs.rm(destination, { recursive: true, force: true });
		await fs.cp(source, destination, { recursive: true });
	}

	let server;
	let endpoint = null;
	let trace;
	let codexResult;
	let evaluation;
	let runError;
	let safeRaw = '';
	let token = '';
	let rawLogPath = path.join(runOutputDir, 'raw.jsonl');
	let tracePath = path.join(runOutputDir, 'trace.json');
	let messagePath = path.join(runOutputDir, 'agent-message.json');
	let diagPath = path.join(runOutputDir, 'diagnostics.json');
	await fs.mkdir(runOutputDir, { recursive: true });

	try {
		token = crypto.randomBytes(16).toString('hex');
		const started = await startMcpServer(vaultRoot, token, tempRoot);
		server = started.server;
		endpoint = started.endpoint;
		if (!endpoint) {
			throw new Error('MCP endpoint missing from server output.');
		}
		const tokenized = {
			arm: options.arm,
			repetition: options.repetition,
			runId: options.runId,
			workingRoot: tempRoot,
			endpoint,
			model: options.model,
			codexBinary: options.codexBinary,
			token,
			timeoutMs: options.timeoutMs,
		};
		codexResult = await runCodexOnce(scenario, options.codexBinary, tokenized);
		const replacements = [
			[token, TOKEN_REDACT],
			[`/private${tempRoot}`, TMP_ROOT_REDACT],
			[tempRoot, TMP_ROOT_REDACT],
			[os.homedir(), HOME_REDACT],
		];
		safeRaw = sanitizeForLog(codexResult.stdout, replacements);
		if (codexResult.exitCode !== 0) {
			const safeStderr = sanitizeForLog(codexResult.stderr, replacements);
			throw new Error(`codex exited with status ${codexResult.exitCode}: ${safeStderr}`);
		}
		trace = normalizeCodexTrace(scenario.id, codexResult.stdout, { fallbackClass: 'no_track' });
		trace.process_exit_code = codexResult.exitCode;
		trace.agent_message = sanitizeForLog(trace.agent_message, replacements);
		trace.diagnostics.push({ type: 'codex_stderr', stderr: sanitizeForLog(codexResult.stderr, replacements) });
		if (!trace.events || trace.events.length === 0) {
			trace.events = [{ type: 'assistant_report', closeout_status: 'requires_user_action', codes: ['mcp_unreachable'] }];
		}
		evaluation = evaluateTrace(scenario, trace);
	} catch (error) {
		runError = error instanceof Error ? error.message : String(error);
		trace = runFailureTrace(scenario, runError);
		evaluation = evaluateTrace(scenario, trace);
	} finally {
		await stopProcess(server);
		if (!options.keepVault) {
			await cleanupSyntheticVault(tempRoot);
		}
	}

	trace.arm = options.arm;
	trace.repetition = options.repetition;
	const safeExitCode = codexResult?.exitCode ?? (runError ? 1 : 0);
	const summary = parseEvaluationAndSummary(scenario, trace, { ...codexResult, exitCode: safeExitCode, runError });
	const executionOk = !runError && safeExitCode === 0;
	evaluation = {
		...evaluation,
		passed: evaluation.passed && executionOk,
		checks: { ...evaluation.checks, execution: executionOk },
	};
	summary.execution_ok = executionOk;
	summary.passed = evaluation.passed;

	const fileReplacements = [
		...(token ? [[token, TOKEN_REDACT]] : []),
		[`/private${tempRoot}`, TMP_ROOT_REDACT],
		[tempRoot, TMP_ROOT_REDACT],
		[os.homedir(), HOME_REDACT],
	];
	const safeTrace = sanitizeForLog(JSON.stringify(trace, null, 2), fileReplacements);
	const safeMessage = sanitizeForLog(trace.agent_message || '', fileReplacements);
	const safeDiagnostics = sanitizeForLog(JSON.stringify(trace.diagnostics || [], null, 2), fileReplacements);
	const safeSummary = JSON.parse(sanitizeForLog(JSON.stringify(summary), fileReplacements));
	await fs.writeFile(rawLogPath, typeof safeRaw === 'string' ? safeRaw : '', 'utf8');
	await fs.writeFile(tracePath, `${safeTrace}\n`, 'utf8');
	await fs.writeFile(messagePath, `${JSON.stringify({ agent_message: safeMessage }, null, 2)}\n`, 'utf8');
	await fs.writeFile(diagPath, `${safeDiagnostics}\n`, 'utf8');
	await fs.writeFile(path.join(runOutputDir, 'notes.txt'), 'raw output may contain synthetic content\n', 'utf8');

	return {
		scenario_id: scenario.id,
		arm: options.arm,
		repetition: options.repetition,
		executed: executionOk,
		trace,
		evaluation,
		codex: { ...codexResult, exitCode: safeExitCode },
		files: {
			raw: path.relative(repositoryRoot, rawLogPath),
			trace: path.relative(repositoryRoot, tracePath),
			message: path.relative(repositoryRoot, messagePath),
			diagnostics: path.relative(repositoryRoot, diagPath),
		},
		kept_vault: options.keepVault ? TMP_ROOT_REDACT : null,
		summary: safeSummary,
	};
}

async function runRealMatrix(scenarios, args, outputPaths) {
	const runMatrix = [];
	if (!args.execute) {
		return {
			dry_run: true,
			run_id: outputPaths.runId,
			scenario_count: scenarios.length,
			repetitions: args.repetitions,
			arms: expandArms(args.arm),
			scenario_ids: scenarios.map((scenario) => scenario.id),
			runs: [],
			aggregates: {},
			delta: null,
		};
	}

	args.codexBinary = resolveCodexBinary(args.codexBinary);
	await fs.access(mcpRuntimePath);
	if (expandArms(args.arm).includes('mcp-only')) {
		const external = await hasExternalTracekeeperSkill();
		if (external.length > 0) {
			const safeLocations = external.map((entry) =>
				sanitizeForLog(entry, [[os.homedir(), HOME_REDACT]])
			);
			throw new Error(`mcp-only arm blocked by existing external tracekeeper skill in: ${safeLocations.join(', ')}`);
		}
	}

	for (const scenario of scenarios) {
		for (let rep = 1; rep <= args.repetitions; rep += 1) {
			for (const arm of expandArms(args.arm)) {
				const runOutputDir = path.join(outputPaths.outputDir, scenario.id, arm, `rep-${rep}`);
				runMatrix.push(await runSingle(scenario, {
					arm,
					repetition: rep,
					runId: outputPaths.runId,
					model: args.model,
					codexBinary: args.codexBinary,
					timeoutMs: 120000,
					keepVault: args.keepVault,
				}, runOutputDir));
			}
		}
	}

	const summaries = runMatrix.map((run) => run.summary);
	const armNames = [...new Set(summaries.map((entry) => entry.arm))];
	const armSummaries = {};
	for (const arm of armNames) {
		armSummaries[arm] = computeArmAggregate(scenarios, summaries, arm);
	}
	const delta = buildDelta(armSummaries);

	await fs.mkdir(outputPaths.outputDir, { recursive: true });
	const aggregate = {
		dry_run: false,
		run_id: outputPaths.runId,
		scenario_count: scenarios.length,
		repetition_count: args.repetitions,
		scenario_ids: scenarios.map((scenario) => ({ id: scenario.id, class: scenario.class, kind: scenario.kind })),
		runs: runMatrix.map((run) => ({
			scenario_id: run.scenario_id,
			arm: run.arm,
			repetition: run.repetition,
			passed: run.evaluation.passed,
			observed_class: run.trace.classification,
			expected_class: run.summary.expected,
			checks: run.evaluation.checks,
			agent_message: run.summary.agent_message,
			unknown_event_types: run.trace.unknown_event_types,
			files: run.files,
			kept_vault: run.kept_vault,
		})),
		summaries,
		aggregates: armSummaries,
		delta,
	};
	await fs.writeFile(outputPaths.aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8');
	return aggregate;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const scenarios = await loadScenarios(args.scenariosPath);
	const selectedScenarios = selectScenarios(scenarios, args.scenarioIds, args.maxScenarios);
	const output = resolveOutputPaths(args);
	const report = await runRealMatrix(selectedScenarios, args, output);
	if (args.execute) {
		if (!report || report.runs.length === 0) {
			return;
		}
		if (args.strict && report.runs.some((run) => !run.passed)) {
			process.exitCode = 1;
		}
	}
	process.stdout.write(`${JSON.stringify(report || {}, null, 2)}\n`);
}

export {
	parseArgs,
	normalizeArms,
	expandArms,
	loadScenarios,
	selectScenarios,
	resolveOutputPaths,
	runRealMatrix,
	computeArmAggregate,
	buildDelta,
	buildCodexPrompt,
	parseEvaluationAndSummary,
	runFailureTrace,
	repositoryRoot,
	mcpRuntimePath,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
