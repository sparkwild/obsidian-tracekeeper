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
const tracekeeperManifestPath = path.resolve(repositoryRoot, 'skills', 'tracekeeper', 'manifest.json');
const contractsRuntimePath = path.resolve(repositoryRoot, 'packages', 'contracts', 'dist', 'contracts.js');
const mcpRuntimeHandlerPath = path.resolve(repositoryRoot, 'packages', 'mcp-runtime', 'dist', 'handler.js');
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
const REPRODUCIBLE_START_EPOCH = '1970-01-01T00:00:00.000Z';

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
		seed: '0',
		repetitions: 1,
		maxInfraRetries: 2,
		scenariosPath: defaultScenariosPath,
		strict: false,
		execute: false,
		maxScenarios: 0,
		keepVault: false,
		model: '',
		codexBinary: '',
		outputDirArg: '',
		reportArg: '',
		replayReportArg: '',
		experimentId: '',
		resume: false,
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
		if (arg === '--seed' && next) {
			options.seed = next;
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
		if (arg === '--max-infra-retries' && next) {
			options.maxInfraRetries = Number.parseInt(next, 10);
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
		if ((arg === '--replay-report' || arg === '--replay') && next) {
			options.replayReportArg = next;
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
		if (arg === '--resume') {
			options.resume = true;
			continue;
		}
		if (arg === '--keep-vault') {
			options.keepVault = true;
			continue;
		}
		if (arg === '--experiment-id' && next) {
			options.experimentId = next;
			index += 1;
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
	options.maxInfraRetries = Number.isInteger(options.maxInfraRetries) ? options.maxInfraRetries : 2;
	options.maxInfraRetries = Math.max(0, Math.min(5, options.maxInfraRetries));
	if (options.scenarioIds.length) {
		options.scenarioIds = [...new Set(options.scenarioIds)];
	}
	options.seed = normalizeText(options.seed);
	if (!options.seed) {
		options.seed = '0';
	}
	return options;
}

function commandResult(command, args, options = {}) {
	const result = spawnSync(command, args, {
		encoding: 'utf8',
		timeout: 5000,
		stdio: ['ignore', 'pipe', 'pipe'],
		...options,
	});
	return {
		ok: result.status === 0,
		stdout: normalizeText(result.stdout),
		stderr: normalizeText(result.stderr),
	};
}

function hashStable(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function seededPairSeed(seed, scenarioId, repetition) {
	const digest = crypto.createHash('sha256')
		.update(String(seed))
		.update('\u0000')
		.update(String(scenarioId))
		.update('\u0000')
		.update(String(repetition))
		.digest();
	return digest.readUInt32BE(0) + digest.readUInt32BE(4) / 2 ** 32;
}

function buildCounterbalancedArmOrders(pairs, seed, armA, armB) {
	if (pairs.length <= 1) {
		return { firstFirstSet: new Set([0]), armA, armB };
	}
	const sorted = [];
	for (const pair of pairs) {
		const pairSeed = seededPairSeed(seed, pair.scenario_id, pair.repetition);
		sorted.push({ index: pair.pairIndex, pairSeed });
	}
	sorted.sort((a, b) => (a.pairSeed === b.pairSeed ? a.index - b.index : a.pairSeed - b.pairSeed));
	const firstFirstCount = Math.ceil(pairs.length / 2);
	const firstFirstSet = new Set(sorted.slice(0, firstFirstCount).map((entry) => entry.index));
	return {
		armA: armA,
		armB: armB,
		firstFirstSet,
	};
}

function buildRunPlan(scenarios, repetitions, arms, seed) {
	const armList = expandArms(arms);
	const pairs = [];
	for (const scenario of scenarios) {
		for (let rep = 1; rep <= repetitions; rep += 1) {
			pairs.push({
				scenario_id: scenario.id,
				repetition: rep,
				pairIndex: pairs.length,
			});
		}
	}
	if (armList.length !== 2) {
		return pairs.map((pair) => ({
			...pair,
			armOrder: [...armList],
		}));
	}
	const orderMap = buildCounterbalancedArmOrders(pairs, `${seed}`, armList[0], armList[1]);
	if (orderMap.firstFirstSet.size === 0) {
		for (const pair of pairs) {
			pair.armOrder = [armList[0], armList[1]];
		}
		return pairs;
	}
	for (const pair of pairs) {
		const useOrderAB = orderMap.firstFirstSet.has(pair.pairIndex);
		pair.armOrder = useOrderAB ? [orderMap.armA, orderMap.armB] : [orderMap.armB, orderMap.armA];
	}
	return pairs;
}

function makeCheckpointRunKey(scenarioId, arm, repetition) {
	return `${scenarioId}|${arm}|${repetition}`;
}

async function loadJsonIfPresent(filePath) {
	try {
		const payload = await fs.readFile(filePath, 'utf8');
		return JSON.parse(payload);
	} catch {
		return null;
	}
}

function buildRunConfigFingerprint(args, evaluatorFingerprint, skillIdentity, executionIdentity = {}) {
	return {
		seed: String(args.seed || '0'),
		scenario_set_sha256: evaluatorFingerprint.scenario_set_sha256,
		repetitions: args.repetitions,
		arms: expandArms(args.arm),
		max_infra_retries: args.maxInfraRetries,
		requested_model: normalizeText(args.model) || 'resolved_default_unknown',
		evaluation_code_sha256: evaluatorFingerprint.evaluation_code_sha256,
		skill_version: skillIdentity.skill_version,
		skill_bundle_hash: skillIdentity.bundle_hash,
		workflow_contract_version: skillIdentity.workflow_contract_version,
		skill_manifest_sha256: skillIdentity.manifest_sha256,
		codex_version: executionIdentity.codex_version || 'unknown',
		mcp_stack_sha256: executionIdentity.mcp_stack_sha256 || 'unknown',
		git_commit_sha: executionIdentity.git?.commit_sha || 'unknown',
		git_dirty: executionIdentity.git?.dirty !== false,
		working_tree_diff_sha256: executionIdentity.git?.working_tree_diff_sha256 || 'unknown',
	};
}

function compareExperimentConfig(expected, actual) {
	if (!expected || !actual) {
		return false;
	}
	const expectedArms = [...expected.arms].sort().join('|');
	const actualArms = [...(actual.arms || [])].sort().join('|');
	return (
		expected.seed === actual.seed &&
		expected.scenario_set_sha256 === actual.scenario_set_sha256 &&
		expected.repetitions === actual.repetitions &&
		expectedArms === actualArms &&
		expected.max_infra_retries === actual.max_infra_retries &&
		expected.requested_model === (normalizeText(actual.requested_model) || 'resolved_default_unknown') &&
		expected.evaluation_code_sha256 === actual.evaluation_code_sha256 &&
		expected.skill_version === actual.skill_version &&
		expected.skill_bundle_hash === actual.skill_bundle_hash &&
		expected.workflow_contract_version === actual.workflow_contract_version &&
		expected.skill_manifest_sha256 === actual.skill_manifest_sha256 &&
		expected.codex_version === actual.codex_version &&
		expected.mcp_stack_sha256 === actual.mcp_stack_sha256 &&
		expected.git_commit_sha === actual.git_commit_sha &&
		expected.git_dirty === actual.git_dirty &&
		expected.working_tree_diff_sha256 === actual.working_tree_diff_sha256
	);
}

async function readCheckpoint(pathToCheckpoint) {
	const checkpoint = await loadJsonIfPresent(pathToCheckpoint);
	if (!checkpoint || typeof checkpoint !== 'object') {
		return null;
	}
	const { integrity_sha256: integritySha256, ...integrityPayload } = checkpoint;
	if (!integritySha256 || integritySha256 !== hashStable(JSON.stringify(integrityPayload))) {
		throw new Error('Cannot resume: checkpoint integrity check failed.');
	}
	const completed = new Map();
	const completedEntries = Array.isArray(checkpoint.completed_runs) ? checkpoint.completed_runs : [];
	for (const entry of completedEntries) {
		if (!entry || !entry.scenario_id || !entry.arm || !entry.repetition) {
			continue;
		}
		completed.set(makeCheckpointRunKey(entry.scenario_id, entry.arm, entry.repetition), {
			...entry,
			attempts: Number.isInteger(entry.attempts) ? entry.attempts : 0,
		});
	}
	return {
		version: checkpoint.version || 1,
		experiment_id: checkpoint.experiment_id || null,
		created_at: checkpoint.created_at || REPRODUCIBLE_START_EPOCH,
		updated_at: checkpoint.updated_at || REPRODUCIBLE_START_EPOCH,
		run_config: checkpoint.run_config || {},
		completed_runs: completed,
	};
}

async function writeCheckpointAtomically(pathToCheckpoint, checkpoint) {
	const temporary = `${pathToCheckpoint}.${Date.now()}.tmp`;
	const { integrity_sha256: _ignoredIntegrity, ...integrityPayload } = checkpoint;
	const protectedCheckpoint = {
		...integrityPayload,
		integrity_sha256: hashStable(JSON.stringify(integrityPayload)),
	};
	await fs.mkdir(path.dirname(pathToCheckpoint), { recursive: true });
	await fs.writeFile(temporary, `${JSON.stringify(protectedCheckpoint, null, 2)}\n`, 'utf8');
	await fs.rename(temporary, pathToCheckpoint);
}

async function readSkillIdentity() {
	const manifestText = await fs.readFile(tracekeeperManifestPath, 'utf8');
	const manifest = JSON.parse(manifestText);
	if (!manifest || typeof manifest !== 'object') {
		throw new Error('Unable to parse Tracekeeper skill manifest.');
	}
	return {
		skill_version: normalizeText(manifest.skill_version),
		bundle_hash: normalizeText(manifest.bundle_hash),
		workflow_contract_version: manifest.workflow_contract_version ?? null,
		manifest_sha256: hashStable(manifestText),
	};
}

function getCodexBinaryVersion(binaryPath) {
	const result = commandResult(binaryPath, ['--version']);
	if (!result.ok) {
		return 'unknown';
	}
	const version = normalizeText(result.stdout || result.stderr);
	return version || 'unknown';
}

async function buildWorkingTreeMetadata() {
	const head = commandResult('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot });
	const status = commandResult('git', ['status', '--porcelain'], { cwd: repositoryRoot });
	const dirty = status.ok ? normalizeText(status.stdout).length > 0 : true;
	const diff = commandResult('git', ['diff', '--binary', 'HEAD', '--', '.'], { cwd: repositoryRoot });
	return {
		commit_sha: head.ok ? head.stdout.trim() : 'unknown',
		dirty,
		working_tree_diff_sha256: hashStable(diff.ok ? diff.stdout : ''),
	};
}

async function hashRuntimeStack() {
	const hash = crypto.createHash('sha256');
	for (const filePath of [mcpRuntimePath, mcpRuntimeHandlerPath, contractsRuntimePath]) {
		hash.update(path.relative(repositoryRoot, filePath));
		hash.update('\0');
		hash.update(await fs.readFile(filePath));
		hash.update('\0');
	}
	return hash.digest('hex');
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

function normalizeExperimentId(raw) {
	const value = normalizeText(raw);
	if (!value) {
		return '';
	}
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
		throw new Error('--experiment-id may contain only letters, numbers, dots, underscores, and hyphens.');
	}
	return value;
}

function resolveOutputPaths(options) {
	const runId = `${new Date().toISOString().replace(/[.:]/g, '-')}-${Math.floor(Math.random() * 1e6)}`;
	const defaultPath = path.resolve(defaultReportRoot, runId);
	if (options.resume && !options.experimentId && !options.outputDirArg && !options.reportArg) {
		throw new Error('--resume requires --experiment-id, --output-dir, or --report.');
	}
	if (options.experimentId && (options.outputDirArg || options.reportArg)) {
		throw new Error('--experiment-id cannot be used with --output-dir or --report');
	}
	if (options.experimentId && !options.outputDirArg && !options.reportArg) {
		const safeExperimentId = normalizeExperimentId(options.experimentId);
		if (!safeExperimentId) {
			throw new Error('--experiment-id must be non-empty.');
		}
		const outputDir = path.resolve(defaultReportRoot, safeExperimentId);
		if (!isInsideReportsDir(outputDir)) {
			throw new Error('--experiment-id must resolve inside evals/agent-initiative/reports');
		}
		return {
			runId: safeExperimentId,
			outputDir,
			aggregatePath: path.join(outputDir, 'aggregate.json'),
			checkpointPath: path.join(outputDir, 'checkpoint.json'),
		};
	}
	if (!options.outputDirArg && !options.reportArg) {
		return {
			runId,
			outputDir: defaultPath,
			aggregatePath: path.join(defaultPath, 'aggregate.json'),
			checkpointPath: path.join(defaultPath, 'checkpoint.json'),
		};
	}
	if (options.outputDirArg) {
		const directory = path.resolve(process.cwd(), options.outputDirArg);
		if (!isInsideReportsDir(directory)) {
			throw new Error('--output-dir must be inside evals/agent-initiative/reports');
		}
		return {
			runId: path.basename(directory),
			outputDir: directory,
			aggregatePath: path.join(directory, 'aggregate.json'),
			checkpointPath: path.join(directory, 'checkpoint.json'),
		};
	}
	const reportPath = path.resolve(process.cwd(), options.reportArg);
	if (!isInsideReportsDir(reportPath)) {
		throw new Error('--report must resolve inside evals/agent-initiative/reports');
	}
	const statExt = path.extname(reportPath).toLowerCase() === '.json';
	const outputDir = statExt ? path.dirname(reportPath) : reportPath;
	if (statExt) {
		return {
			runId: path.basename(reportPath, '.json') || path.basename(reportPath),
			outputDir,
			aggregatePath: reportPath,
			checkpointPath: path.join(outputDir, 'checkpoint.json'),
		};
	}
	return {
		runId,
		outputDir,
		aggregatePath: path.join(reportPath, 'aggregate.json'),
		checkpointPath: path.join(outputDir, 'checkpoint.json'),
	};
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
	const agentMaterials = Array.isArray(scenario.agent_materials) ? scenario.agent_materials : [];
	return [
		'Work only with the synthetic project context available in this evaluation workspace.',
		'Do not modify repository files. Answer the user request below, using available tools only when appropriate.',
		...(agentMaterials.length > 0 ? [
			'For this request only, user-authorized local source materials are available under .tracekeeper-eval-materials/. They are outside the Obsidian Vault; read them only when the user request calls for them, then capture any used text through Tracekeeper rather than treating their filesystem path as a Vault note.',
		] : []),
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

function normalizePathList(values) {
	return (Array.isArray(values) ? values : [])
		.map((value) => normalizeText(value).replace(/\\/g, '/'))
		.filter(Boolean);
}

function relationEvidencePaths(result, relationKey) {
	const paths = [];
	const sources = [result, ...recallEntries(result)];
	for (const source of sources) {
		const evidence = source?.relation_evidence;
		const relations = evidence && typeof evidence === 'object'
			? evidence[relationKey]
			: [];
		for (const relation of Array.isArray(relations) ? relations : []) {
			paths.push(...normalizePathList([relation?.path]));
		}
	}
	return [...new Set(paths)];
}

function buildSet(values) {
	return new Set(normalizePathList(values));
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
	const evidenceResults = results.filter((result) =>
		result.tool === 'tracekeeper.recall' || result.tool === 'tracekeeper.read_note'
	);
	const noTrackTools = calls.filter((call) => /^tracekeeper\./.test(call.tool));
	const called = new Set(calls.map((call) => call.tool));
	const calledInOrder = calls.map((call) => call.tool);
	const toolErrorCount = results.filter((result) => result.result?.error).length;
	const expected = scenario.expected || {};
	const expectExactlyOnce = expected.finish_exactly_once !== false;
	const expectSameTaskId = expected.same_task_id !== false;
	const lastFinish = finishCalls.at(-1);
	const lastFinishArgs = lastFinish?.args && typeof lastFinish.args === 'object' ? lastFinish.args : null;
	const relatedWikiArgs = Array.isArray(lastFinishArgs?.related_wiki)
		? lastFinishArgs.related_wiki
		: typeof lastFinishArgs?.related_wiki === 'string'
			? [lastFinishArgs.related_wiki]
			: [];
	const relatedSourceArgs = Array.isArray(lastFinishArgs?.related_sources)
		? lastFinishArgs.related_sources
		: typeof lastFinishArgs?.related_sources === 'string'
			? [lastFinishArgs.related_sources]
			: [];
	const relatedWikiExpected = Array.isArray(scenario.related_wiki) && scenario.related_wiki.length > 0
		? scenario.related_wiki.every((entry) => relatedWikiArgs.includes(entry))
		: null;
	const relatedSourcesExpected = Array.isArray(scenario.related_sources) && scenario.related_sources.length > 0
		? scenario.related_sources.every((entry) => relatedSourceArgs.includes(entry))
		: null;
	const relatedWikiPaths = buildSet(Array.isArray(scenario.related_wiki) ? scenario.related_wiki : []);
	const relatedSourcePaths = buildSet(Array.isArray(scenario.related_sources) ? scenario.related_sources : []);
	const relatedEvidenceWiki = evidenceResults.some((result) =>
		relationEvidencePaths(result.result || {}, 'related_wiki').some((entryPath) => relatedWikiPaths.has(entryPath)),
	);
	const relatedEvidenceSources = evidenceResults.some((result) =>
		relationEvidencePaths(result.result || {}, 'related_sources').some((entryPath) => relatedSourcePaths.has(entryPath)),
	);
	const relatedWikiEvidenceAvailable = relatedWikiExpected === null ? null : relatedEvidenceWiki;
	const relatedSourcesEvidenceAvailable = relatedSourcesExpected === null ? null : relatedEvidenceSources;
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
		related_wiki_evidence_available: relatedWikiEvidenceAvailable,
		related_sources_evidence_available: relatedSourcesEvidenceAvailable,
		related_wiki_propagated_when_available: relatedWikiEvidenceAvailable ? relatedWikiExpected : null,
		related_sources_propagated_when_available: relatedSourcesEvidenceAvailable ? relatedSourcesExpected : null,
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

function safeRate(numerator, denominator) {
	if (denominator <= 0) {
		return null;
	}
	return Number((numerator / denominator).toFixed(4));
}

function toScenarioClass(scenariosById, scenarioId) {
	return scenariosById.get(scenarioId)?.class ?? 'unknown';
}

function buildPairedOutcomes(summaries, scenarios) {
	const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
	const byPair = new Map();
	for (const summary of summaries) {
		const key = `${summary.scenario_id}|${summary.repetition}`;
		const bucket = byPair.get(key) || [];
		bucket.push(summary);
		byPair.set(key, bucket);
	}

	const counts = {
		total_pairs: 0,
		skill_win: 0,
		mcp_only_win: 0,
		tie_pass: 0,
		tie_fail: 0,
		discordant_pairs: 0,
	};
	const strictPassCounts = {
		overall: { total: 0, mcp_only_pass: 0, mcp_skill_pass: 0 },
		no_track: { total: 0, mcp_only_pass: 0, mcp_skill_pass: 0 },
		recall_only: { total: 0, mcp_only_pass: 0, mcp_skill_pass: 0 },
		tracked_task: { total: 0, mcp_only_pass: 0, mcp_skill_pass: 0 },
	};

	for (const pair of byPair.values()) {
		const runByArm = {};
		for (const run of pair) {
			runByArm[run.arm] = run;
		}
		const mcpOnly = runByArm['mcp-only'];
		const mcpSkill = runByArm['mcp-skill'];
		if (
			!mcpOnly ||
			!mcpSkill ||
			mcpOnly.execution_ok === false ||
			mcpSkill.execution_ok === false
		) {
			continue;
		}
		const expectedClass = toScenarioClass(byId, mcpOnly.scenario_id);
		const mcpOnlyPass = Boolean(mcpOnly.passed);
		const mcpSkillPass = Boolean(mcpSkill.passed);
		counts.total_pairs += 1;
		if (mcpOnlyPass && !mcpSkillPass) {
			counts.mcp_only_win += 1;
			counts.discordant_pairs += 1;
		}
		if (!mcpOnlyPass && mcpSkillPass) {
			counts.skill_win += 1;
			counts.discordant_pairs += 1;
		}
		if (mcpOnlyPass && mcpSkillPass) {
			counts.tie_pass += 1;
		}
		if (!mcpOnlyPass && !mcpSkillPass) {
			counts.tie_fail += 1;
		}
		if (strictPassCounts[expectedClass]) {
			strictPassCounts[expectedClass].total += 1;
			if (mcpOnlyPass) strictPassCounts[expectedClass].mcp_only_pass += 1;
			if (mcpSkillPass) strictPassCounts[expectedClass].mcp_skill_pass += 1;
		}
		strictPassCounts.overall.total += 1;
		if (mcpOnlyPass) strictPassCounts.overall.mcp_only_pass += 1;
		if (mcpSkillPass) strictPassCounts.overall.mcp_skill_pass += 1;
	}

	const strictPassDelta = {};
	for (const [scope, values] of Object.entries(strictPassCounts)) {
		const mcpOnlyRate = values.total ? values.mcp_only_pass / values.total : null;
		const mcpSkillRate = values.total ? values.mcp_skill_pass / values.total : null;
		strictPassDelta[scope] = {
			delta: mcpOnlyRate !== null && mcpSkillRate !== null
				? Number((mcpSkillRate - mcpOnlyRate).toFixed(4))
				: null,
			mcp_only_rate: mcpOnlyRate !== null ? Number(mcpOnlyRate.toFixed(4)) : null,
			mcp_skill_rate: mcpSkillRate !== null ? Number(mcpSkillRate.toFixed(4)) : null,
		};
	}

	return {
		total_pairs: counts.total_pairs,
		skill_win: counts.skill_win,
		mcp_only_win: counts.mcp_only_win,
		tie_pass: counts.tie_pass,
		tie_fail: counts.tie_fail,
		discordant_pairs: counts.discordant_pairs,
		strict_pass_delta: strictPassDelta,
		strict_pass_counts: strictPassCounts,
	};
}

function computeArmAggregate(scenarios, summaries, armName) {
	const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
	const relevant = summaries.filter((summary) => summary.arm === armName);
	const total = relevant.length;
	const executed = relevant.filter((entry) => entry.execution_ok);
	const executedTotal = executed.length;
	const byClass = {
		no_track: relevant.filter((entry) => byId.get(entry.scenario_id)?.class === 'no_track'),
		recall_only: relevant.filter((entry) => byId.get(entry.scenario_id)?.class === 'recall_only'),
		tracked_task: relevant.filter((entry) => byId.get(entry.scenario_id)?.class === 'tracked_task'),
	};
	const executedByClass = {
		no_track: executed.filter((entry) => byId.get(entry.scenario_id)?.class === 'no_track'),
		recall_only: executed.filter((entry) => byId.get(entry.scenario_id)?.class === 'recall_only'),
		tracked_task: executed.filter((entry) => byId.get(entry.scenario_id)?.class === 'tracked_task'),
	};
	const noTrackCount = byClass.no_track.length;
	const recallCount = byClass.recall_only.length;
	const trackedCount = byClass.tracked_task.length;
	const executedNoTrackCount = executedByClass.no_track.length;
	const executedRecallCount = executedByClass.recall_only.length;
	const executedTrackedCount = executedByClass.tracked_task.length;
	const relatedWikiDenom = executedByClass.tracked_task.filter((entry) =>
		byId.get(entry.scenario_id)?.class === 'tracked_task' &&
		byId.get(entry.scenario_id)?.related_wiki?.length > 0
	).length;
	const relatedSourceDenom = executedByClass.tracked_task.filter((entry) =>
		byId.get(entry.scenario_id)?.class === 'tracked_task' &&
		byId.get(entry.scenario_id)?.related_sources?.length > 0
	).length;
	const correctlyClassified = executed.filter((entry) => entry.observed === entry.expected).length;
	const recallExpected = executed.filter((entry) =>
		byId.get(entry.scenario_id)?.expected?.required_tools?.includes('tracekeeper.recall')
	);
	const recallInvoked = recallExpected.filter((entry) => entry.recall_called).length;
	const trackedFlow = executedByClass.tracked_task.filter((entry) => entry.track_task_flow_ok).length;
	const taskContinuity = executedByClass.tracked_task.filter((entry) => entry.finish_task_id_continuity).length;
	const noTrackFp = executedByClass.no_track.filter((entry) => entry.no_track_false_positive).length;
	const toolErrors = executed.reduce((sum, entry) => sum + (entry.tool_error_count || 0), 0);
	const toolCalls = executed.reduce((sum, entry) => sum + (entry.tool_call_count || 0), 0);
	const relatedWiki = executed.filter((entry) => entry.related_wiki_propagation).length;
	const relatedSources = executed.filter((entry) => entry.related_sources_propagation).length;
	const relatedWikiEvidenceAvailable = executedByClass.tracked_task.filter((entry) => byId.get(entry.scenario_id)?.related_wiki?.length > 0);
	const relatedSourcesEvidenceAvailable = executedByClass.tracked_task.filter((entry) => byId.get(entry.scenario_id)?.related_sources?.length > 0);
	const relatedWikiPropagatedWhenAvailable = relatedWikiEvidenceAvailable.filter((entry) => entry.related_wiki_propagated_when_available).length;
	const relatedSourcesPropagatedWhenAvailable = relatedSourcesEvidenceAvailable.filter((entry) => entry.related_sources_propagated_when_available).length;
	const trackedFinishOnce = executedByClass.tracked_task.filter((entry) => entry.track_task_finish_once).length;
	const startIdentitySamples = executed.filter((entry) => entry.start_project_identity_correct !== null);
	const projectRecallIdentitySamples = executed.filter((entry) => entry.first_project_recall_identity_correct !== null);
	const durableRecallSamples = executed.filter((entry) => entry.first_recall_durable_project_memory_hit !== null);
	const identityRecoverySamples = executed.filter((entry) => entry.project_identity_recovery_required !== null);
	const duplicateRecallSamples = executed.filter((entry) => entry.duplicate_recall !== null);
	const effectiveRecallSamples = executed.filter((entry) => entry.tool_calls_before_effective_recall !== null);
	const strictScenarioPasses = executed.filter((entry) => entry.passed).length;
	const strictNoTrackPasses = executedByClass.no_track.filter((entry) => entry.passed).length;
	const strictRecallOnlyPasses = executedByClass.recall_only.filter((entry) => entry.passed).length;
	const strictTrackedTaskPasses = executedByClass.tracked_task.filter((entry) => entry.passed).length;
	return {
		arm: armName,
		total_runs: total,
		executed_runs: executedTotal,
		mode_classification_rate: executedTotal ? Number((correctlyClassified / executedTotal).toFixed(4)) : 0,
		recall_invocation_rate: recallExpected.length ? Number((recallInvoked / recallExpected.length).toFixed(4)) : 0,
		tracked_start_recall_finish_rate: executedTrackedCount ? Number((trackedFlow / executedTrackedCount).toFixed(4)) : 0,
		task_id_continuity_rate: executedTrackedCount ? Number((taskContinuity / executedTrackedCount).toFixed(4)) : 0,
		tracked_finish_once_rate: executedTrackedCount ? Number((trackedFinishOnce / executedTrackedCount).toFixed(4)) : 0,
		no_track_false_positive_rate: executedNoTrackCount ? Number((noTrackFp / executedNoTrackCount).toFixed(4)) : 0,
		tool_error_rate: toolCalls ? Number((toolErrors / toolCalls).toFixed(4)) : 0,
		related_wiki_propagation: relatedWikiDenom ? Number((relatedWiki / relatedWikiDenom).toFixed(4)) : 0,
		related_sources_propagation: relatedSourceDenom ? Number((relatedSources / relatedSourceDenom).toFixed(4)) : 0,
		related_wiki_evidence_available: relatedWikiEvidenceAvailable.length
			? Number((relatedWikiEvidenceAvailable.filter((entry) => entry.related_wiki_evidence_available).length / relatedWikiEvidenceAvailable.length).toFixed(4))
			: null,
		related_wiki_propagated_when_available: relatedWikiEvidenceAvailable.filter((entry) => entry.related_wiki_evidence_available).length
			? Number((relatedWikiPropagatedWhenAvailable / relatedWikiEvidenceAvailable.filter((entry) => entry.related_wiki_evidence_available).length).toFixed(4))
			: null,
		related_sources_evidence_available: relatedSourcesEvidenceAvailable.length
			? Number((relatedSourcesEvidenceAvailable.filter((entry) => entry.related_sources_evidence_available).length / relatedSourcesEvidenceAvailable.length).toFixed(4))
			: null,
		related_sources_propagated_when_available: relatedSourcesEvidenceAvailable.filter((entry) => entry.related_sources_evidence_available).length
			? Number((relatedSourcesPropagatedWhenAvailable / relatedSourcesEvidenceAvailable.filter((entry) => entry.related_sources_evidence_available).length).toFixed(4))
			: null,
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
		average_tool_calls_per_run: executedTotal
			? Number((toolCalls / executedTotal).toFixed(4))
			: 0,
		average_tool_calls_before_effective_recall: effectiveRecallSamples.length
			? Number((
				effectiveRecallSamples.reduce((sum, entry) => sum + entry.tool_calls_before_effective_recall, 0) /
				effectiveRecallSamples.length
			).toFixed(4))
			: 0,
		executed_runs_by_class: {
			no_track: executedNoTrackCount,
			recall_only: executedRecallCount,
			tracked_task: executedTrackedCount,
		},
		strict_scenario_pass_rate: safeRate(strictScenarioPasses, executedTotal),
		strict_no_track_pass_rate: safeRate(strictNoTrackPasses, executedNoTrackCount),
		strict_recall_only_pass_rate: safeRate(strictRecallOnlyPasses, executedRecallCount),
		strict_tracked_task_pass_rate: safeRate(strictTrackedTaskPasses, executedTrackedCount),
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
		'related_wiki_evidence_available',
		'related_wiki_propagated_when_available',
		'related_sources_evidence_available',
		'related_sources_propagated_when_available',
		'start_project_identity_resolution_rate',
		'first_project_recall_identity_rate',
		'first_recall_durable_memory_hit_rate',
		'project_identity_recovery_rate',
		'duplicate_recall_rate',
		'average_tool_calls_per_run',
		'average_tool_calls_before_effective_recall',
	];
	const strictRateKeys = [
		'strict_scenario_pass_rate',
		'strict_no_track_pass_rate',
		'strict_recall_only_pass_rate',
		'strict_tracked_task_pass_rate',
	];
	const allKeys = [...rateKeys, ...strictRateKeys];
	return Object.fromEntries(allKeys.map((key) => {
		const mcpSkillValue = armSummaries['mcp-skill'][key];
		const mcpOnlyValue = armSummaries['mcp-only'][key];
		if (typeof mcpSkillValue !== 'number' || typeof mcpOnlyValue !== 'number') {
			return [key, null];
		}
		return [key, Number((mcpSkillValue - mcpOnlyValue).toFixed(4))];
	}));
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

async function runRealMatrix(scenarios, args, outputPaths, runSingleImpl = runSingle) {
	const dryRun = !args.execute;
	const runStarted = new Date().toISOString();
	if (dryRun) {
		return {
			dry_run: true,
			run_id: outputPaths.runId,
			scenario_count: scenarios.length,
			repetitions: args.repetitions,
			arms: expandArms(args.arm),
			scenario_ids: scenarios.map((scenario) => scenario.id),
			runs: [],
			aggregates: {},
			paired_outcomes: null,
			delta: null,
		};
	}

	args.codexBinary = resolveCodexBinary(args.codexBinary);
	await fs.access(mcpRuntimePath);
	const expandedArms = expandArms(args.arm);
	const externalTracekeeperSkillScan = expandedArms.includes('mcp-only')
		? await hasExternalTracekeeperSkill()
		: [];
	if (expandedArms.includes('mcp-only') && externalTracekeeperSkillScan.length > 0) {
		const safeLocations = externalTracekeeperSkillScan.map((entry) =>
			sanitizeForLog(entry, [[os.homedir(), HOME_REDACT]])
		);
		throw new Error(`mcp-only arm blocked by existing external tracekeeper skill in: ${safeLocations.join(', ')}`);
	}
	const evaluatorFingerprint = await buildReplayEvaluatorFingerprint(scenarios);
	const skillIdentity = await readSkillIdentity();
	const gitStateAtStart = await buildWorkingTreeMetadata();
	const codexVersion = getCodexBinaryVersion(args.codexBinary);
	const mcpStackSha256 = await hashRuntimeStack();
	const runConfig = buildRunConfigFingerprint(args, evaluatorFingerprint, skillIdentity, {
		git: gitStateAtStart,
		codex_version: codexVersion,
		mcp_stack_sha256: mcpStackSha256,
	});
	const expectedConfig = {
		...runConfig,
		repetitions: args.repetitions,
	};
	let checkpoint = args.resume ? await readCheckpoint(outputPaths.checkpointPath) : null;
	if (args.resume) {
		if (!checkpoint) {
			throw new Error('Cannot resume: checkpoint.json missing or unreadable.');
		}
		if (checkpoint.experiment_id && checkpoint.experiment_id !== outputPaths.runId) {
			throw new Error('Cannot resume: checkpoint experiment id mismatch.');
		}
		if (!compareExperimentConfig(expectedConfig, checkpoint.run_config)) {
			throw new Error('Cannot resume: checkpoint config differs from current run configuration.');
		}
	}
	if (!checkpoint) {
		checkpoint = {
			version: 1,
			experiment_id: outputPaths.runId,
			created_at: runStarted,
			updated_at: runStarted,
			run_config: expectedConfig,
			completed_runs: [],
		};
	}

	const runMatrix = [];
	const completedRuns = new Map();
	const checkpointEntries = checkpoint.completed_runs instanceof Map
		? Array.from(checkpoint.completed_runs.values())
		: Array.isArray(checkpoint.completed_runs)
			? checkpoint.completed_runs
			: [];
	for (const record of checkpointEntries) {
		if (!record || !record.scenario_id || !record.arm || !record.repetition) {
			continue;
		}
		const key = makeCheckpointRunKey(record.scenario_id, record.arm, record.repetition);
		completedRuns.set(key, record);
	}
	const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
	const planned = buildRunPlan(scenarios, args.repetitions, expandedArms, args.seed);
	for (const planEntry of planned) {
		const scenario = scenarioById.get(planEntry.scenario_id);
		if (!scenario) {
			continue;
		}
		for (const arm of planEntry.armOrder) {
			const runKey = makeCheckpointRunKey(planEntry.scenario_id, arm, planEntry.repetition);
			const existing = completedRuns.get(runKey);
			const attemptsSoFar = Number.isInteger(existing?.attempts) ? existing.attempts : 0;
			const shouldReuseExisting = existing && (existing.executed || attemptsSoFar > args.maxInfraRetries);
			if (shouldReuseExisting) {
				runMatrix.push({
					scenario_id: existing.scenario_id,
					arm: existing.arm,
					repetition: existing.repetition,
					executed: existing.executed,
					attempts: attemptsSoFar,
					summary: existing.summary,
					files: existing.files || {},
					trace: { classification: existing.observed_class, unknown_event_types: existing.unknown_event_types || [] },
					evaluation: { passed: existing.passed, checks: existing.checks || {} },
					kept_vault: existing.kept_vault || null,
				});
				continue;
			}
			const runOutputDir = path.join(outputPaths.outputDir, planEntry.scenario_id, arm, `rep-${planEntry.repetition}`);
			const run = await runSingleImpl(scenario, {
				arm,
				repetition: planEntry.repetition,
				runId: outputPaths.runId,
				model: args.model,
				codexBinary: args.codexBinary,
				timeoutMs: 120000,
				keepVault: args.keepVault,
			}, runOutputDir);
			run.attempts = attemptsSoFar + 1;

			runMatrix.push(run);
			const runRecord = {
				scenario_id: run.scenario_id,
				arm: run.arm,
				repetition: run.repetition,
				passed: run.evaluation.passed,
				observed_class: run.trace.classification,
				expected_class: run.summary.expected,
				checks: run.evaluation.checks,
				agent_message: run.summary.agent_message,
				unknown_event_types: run.trace.unknown_event_types,
				executed: run.executed,
				attempts: run.attempts || attemptsSoFar + 1,
				kept_vault: run.kept_vault,
				files: run.files,
				summary: run.summary,
				completed_at: new Date().toISOString(),
			};
			completedRuns.set(runKey, runRecord);
			checkpoint.completed_runs = Array.from(completedRuns.values());
			checkpoint.updated_at = new Date().toISOString();
			await writeCheckpointAtomically(outputPaths.checkpointPath, checkpoint);
		}
	}

	const summaries = runMatrix.map((run) => run.summary).filter(Boolean);
	const armNames = [...new Set(summaries.map((entry) => entry.arm))];
	const armSummaries = {};
	for (const arm of armNames) {
		armSummaries[arm] = computeArmAggregate(scenarios, summaries, arm);
	}
	const delta = buildDelta(armSummaries);
	const pairedOutcomes = buildPairedOutcomes(summaries, scenarios);
	const runCompleted = new Date().toISOString();
	const gitStateAtCompletion = await buildWorkingTreeMetadata();
	const workingTreeChangedDuringRun = (
		gitStateAtCompletion.commit_sha !== gitStateAtStart.commit_sha ||
		gitStateAtCompletion.dirty !== gitStateAtStart.dirty ||
		gitStateAtCompletion.working_tree_diff_sha256 !== gitStateAtStart.working_tree_diff_sha256
	);
	const provenance = {
		start_timestamp: checkpoint.created_at || runStarted,
		completion_timestamp: runCompleted,
		seed: args.seed || '0',
		model_status: args.model ? 'requested' : 'unknown',
		release_grade: Boolean(args.model),
		model: runConfig.requested_model || 'resolved_default_unknown',
		evaluator_code_sha256: evaluatorFingerprint.evaluation_code_sha256,
		scenario_set_sha256: evaluatorFingerprint.scenario_set_sha256,
		mcp_stack_sha256: mcpStackSha256,
		skill_manifest: {
			skill_version: skillIdentity.skill_version,
			skill_bundle_hash: skillIdentity.bundle_hash,
			workflow_contract_version: skillIdentity.workflow_contract_version,
			manifest_sha256: skillIdentity.manifest_sha256,
			contamination_scan: {
				external_tracekeeper_skills_detected: externalTracekeeperSkillScan.length > 0,
				external_tracekeeper_skill_count: externalTracekeeperSkillScan.length,
			},
		},
		codex: {
			binary_id: path.basename(args.codexBinary),
			version: codexVersion,
		},
		execution_env: {
			node_version: process.version,
			platform: os.platform(),
			arch: os.arch(),
		},
		git: {
			...gitStateAtStart,
			completion_commit_sha: gitStateAtCompletion.commit_sha,
			completion_dirty: gitStateAtCompletion.dirty,
			completion_working_tree_diff_sha256: gitStateAtCompletion.working_tree_diff_sha256,
			changed_during_run: workingTreeChangedDuringRun,
		},
	};
	const repositoryRuns = runMatrix.map((run) => ({
		scenario_id: run.scenario_id,
		arm: run.arm,
		repetition: run.repetition,
		executed: run.executed,
		attempts: run.attempts || 0,
		passed: run.evaluation?.passed,
		observed_class: run.trace?.classification || run.summary?.observed,
		expected_class: run.summary?.expected || run.summary?.expectedClass,
		checks: run.evaluation?.checks || {},
		agent_message: run.summary?.agent_message || '',
		unknown_event_types: run.trace?.unknown_event_types || [],
		files: run.files || {},
		kept_vault: run.kept_vault || null,
	}));
	await fs.mkdir(outputPaths.outputDir, { recursive: true });
	await writeCheckpointAtomically(outputPaths.checkpointPath, {
		...checkpoint,
		updated_at: runCompleted,
		experiment_id: outputPaths.runId,
		run_config: expectedConfig,
		completed_runs: repositoryRuns.map((run) => ({
			scenario_id: run.scenario_id,
			arm: run.arm,
			repetition: run.repetition,
			passed: run.passed,
			observed_class: run.observed_class,
			expected_class: run.expected_class,
			checks: run.checks,
			agent_message: run.agent_message,
			unknown_event_types: run.unknown_event_types,
			executed: run.executed,
			attempts: run.attempts || 0,
			kept_vault: run.kept_vault,
			files: run.files,
			summary: summaries.find((entry) =>
				entry.scenario_id === run.scenario_id &&
				entry.arm === run.arm &&
				entry.repetition === run.repetition
			) || null,
			completed_at: runCompleted,
		})),
	});
	const aggregate = {
		dry_run: false,
		incomplete: repositoryRuns.some((run) => run.executed === false),
		run_id: outputPaths.runId,
		scenario_count: scenarios.length,
		repetition_count: args.repetitions,
		scenario_ids: scenarios.map((scenario) => ({ id: scenario.id, class: scenario.class, kind: scenario.kind })),
		runs: repositoryRuns,
		summaries,
		aggregates: armSummaries,
		paired_outcomes: pairedOutcomes,
		delta,
		provenance,
	};
	await fs.writeFile(outputPaths.aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8');
	return aggregate;
}

async function resolveReplayArtifact(relativePath) {
	if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
		throw new Error('Replay raw artifact path must be repository-relative.');
	}
	const artifactPath = path.resolve(repositoryRoot, relativePath);
	if (!isInsideReportsDir(artifactPath)) {
		throw new Error('Replay raw artifacts must remain inside evals/agent-initiative/reports.');
	}
	const [canonicalReportsRoot, canonicalArtifactPath] = await Promise.all([
		fs.realpath(reportsRoot),
		fs.realpath(artifactPath),
	]);
	const relative = path.relative(canonicalReportsRoot, canonicalArtifactPath);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error('Replay raw artifacts must remain inside evals/agent-initiative/reports.');
	}
	return canonicalArtifactPath;
}

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

async function buildReplayEvaluatorFingerprint(scenarios) {
	const sourcePaths = [
		fileURLToPath(import.meta.url),
		path.join(runnerDirectory, 'trace-parser.mjs'),
		path.resolve(runnerDirectory, '..', 'evaluator', 'trace-evaluator.mjs'),
	];
	const hash = crypto.createHash('sha256');
	for (const sourcePath of sourcePaths) {
		hash.update(path.relative(repositoryRoot, sourcePath));
		hash.update('\0');
		hash.update(await fs.readFile(sourcePath));
		hash.update('\0');
	}
	return {
		evaluation_code_sha256: hash.digest('hex'),
		scenario_set_sha256: sha256(JSON.stringify(scenarios)),
	};
}

async function replayRealReport(reportPathArg, scenarios, requestedArms = ['both']) {
	const requestedReportPath = path.resolve(process.cwd(), reportPathArg);
	if (!isInsideReportsDir(requestedReportPath)) {
		throw new Error('--replay-report must resolve inside evals/agent-initiative/reports.');
	}
	const [canonicalReportsRoot, reportPath] = await Promise.all([
		fs.realpath(reportsRoot),
		fs.realpath(requestedReportPath),
	]);
	const reportRelativePath = path.relative(canonicalReportsRoot, reportPath);
	if (reportRelativePath.startsWith('..') || path.isAbsolute(reportRelativePath)) {
		throw new Error('--replay-report must resolve inside evals/agent-initiative/reports.');
	}
	const sourceText = await fs.readFile(reportPath, 'utf8');
	const source = JSON.parse(sourceText);
	if (!Array.isArray(source.runs)) {
		throw new Error('Replay source report must contain a runs array.');
	}

	const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
	const selectedArms = new Set(expandArms(normalizeArms(requestedArms)));
	const summaries = [];
	const runs = [];
	for (const sourceRun of source.runs) {
		const scenario = scenarioById.get(sourceRun.scenario_id);
		if (!scenario || !selectedArms.has(sourceRun.arm)) {
			continue;
		}
		const rawPath = await resolveReplayArtifact(sourceRun.files?.raw);
		const raw = await fs.readFile(rawPath, 'utf8');
		const trace = normalizeCodexTrace(sourceRun.scenario_id, raw, { fallbackClass: 'no_track' });
		trace.arm = sourceRun.arm;
		trace.repetition = sourceRun.repetition;
		const evaluation = evaluateTrace(scenario, trace);
		const executionOk = sourceRun.checks?.execution !== false && sourceRun.executed !== false;
		const summary = parseEvaluationAndSummary(scenario, trace, { exitCode: executionOk ? 0 : 1 });
		summary.execution_ok = executionOk;
		summary.passed = evaluation.passed && executionOk;
		summaries.push(summary);
		runs.push({
			scenario_id: sourceRun.scenario_id,
			arm: sourceRun.arm,
			repetition: sourceRun.repetition,
			passed: summary.passed,
			observed_class: trace.classification,
			expected_class: scenario.class,
			checks: { ...evaluation.checks, execution: executionOk },
			agent_message: summary.agent_message,
			unknown_event_types: trace.unknown_event_types,
			files: sourceRun.files,
			raw_sha256: sha256(raw),
		});
	}
	if (runs.length === 0) {
		throw new Error('Replay source report has no runs matching the selected scenarios and arms.');
	}

	const replayedScenarioIds = [...new Set(runs.map((run) => run.scenario_id))];
	const replayedScenarios = scenarios.filter((scenario) => replayedScenarioIds.includes(scenario.id));
	const armNames = [...new Set(summaries.map((entry) => entry.arm))];
	const aggregates = {};
	for (const arm of armNames) {
		aggregates[arm] = computeArmAggregate(replayedScenarios, summaries, arm);
	}
	const fingerprint = await buildReplayEvaluatorFingerprint(replayedScenarios);
	return {
		replay: true,
		replay_schema_version: 1,
		source_run_id: source.run_id || '',
		source_report: path.relative(repositoryRoot, reportPath),
		source_report_sha256: sha256(sourceText),
		...fingerprint,
		scenario_count: replayedScenarios.length,
		repetition_count: source.repetition_count ?? source.repetitions ?? null,
		arms: armNames,
		scenario_ids: replayedScenarios.map((scenario) => ({
			id: scenario.id,
			class: scenario.class,
			kind: scenario.kind,
		})),
		runs,
		summaries,
		aggregates,
		paired_outcomes: buildPairedOutcomes(summaries, replayedScenarios),
		delta: buildDelta(aggregates),
	};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const scenarios = await loadScenarios(args.scenariosPath);
	const selectedScenarios = selectScenarios(scenarios, args.scenarioIds, args.maxScenarios);
	if (args.replayReportArg) {
		const report = await replayRealReport(args.replayReportArg, selectedScenarios, args.arm);
		if (args.outputDirArg || args.reportArg) {
			const output = resolveOutputPaths(args);
			const sourcePath = path.resolve(repositoryRoot, report.source_report);
			if (path.resolve(output.aggregatePath) === sourcePath) {
				throw new Error('Replay output must not overwrite its source report.');
			}
			await fs.mkdir(output.outputDir, { recursive: true });
			await fs.writeFile(output.aggregatePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
		}
		if (args.strict && report.runs.some((run) => !run.passed)) {
			process.exitCode = 1;
		}
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}
	const output = resolveOutputPaths(args);
	const report = await runRealMatrix(selectedScenarios, args, output);
	if (args.execute) {
		if (!report || report.runs.length === 0) {
			return;
		}
		if (
			report.runs.some((run) => run.executed === false) ||
			(args.strict && report.runs.some((run) => !run.passed))
		) {
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
	buildPairedOutcomes,
	buildRunPlan,
	makeCheckpointRunKey,
	compareExperimentConfig,
	buildRunConfigFingerprint,
	parseEvaluationAndSummary,
	replayRealReport,
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
