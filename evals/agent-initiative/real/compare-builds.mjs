import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { COMPARISON_SCENARIOS, createComparisonFixture, assessComparison } from './comparison-fixture.mjs';
import { buildMcpAuthToken, buildCodexLaunchConfig, buildRunLogRedactions, sanitizeForLog } from './runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../..');
const MAX_RUNS = 12;
const MODEL = 'gpt-6-astra';
const EFFORT = 'max';

export function parseComparisonArgs(argv) {
	const options = { execute: false, preflight: false, candidateRoot: repositoryRoot, baselineRoot: '', outputDir: '', codexBin: 'codex' };
	const names = { '--baseline-root': 'baselineRoot', '--candidate-root': 'candidateRoot', '--output-dir': 'outputDir', '--codex-bin': 'codexBin' };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--execute') options.execute = true;
		else if (argv[i] === '--preflight') options.preflight = true;
		else if (names[argv[i]]) {
			const value = argv[++i];
			if (!value || value.startsWith('--')) throw new Error('Comparison option requires a value.');
			options[names[argv[i - 1]]] = value;
		} else throw new Error(`Unknown comparison option: ${argv[i]}`);
	}
	if (!options.baselineRoot) throw new Error('--baseline-root is required.');
	if ((options.execute || options.preflight) && !options.outputDir) throw new Error('--output-dir is required for retained evidence.');
	return { ...options, baselineRoot: path.resolve(options.baselineRoot), candidateRoot: path.resolve(options.candidateRoot),
		outputDir: options.outputDir ? path.resolve(options.outputDir) : '' };
}

export function comparisonPlan() {
	return COMPARISON_SCENARIOS.flatMap((scenario, index) => (index % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'])
		.map((build) => ({ scenario: scenario.id, build })));
}

async function buildFingerprint(root) {
	const entries = [];
	for (const directory of ['packages/core/dist', 'packages/contracts/dist', 'packages/mcp-runtime/dist']) {
		for (const relative of (await fs.readdir(path.join(root, directory), { recursive: true })).sort()) {
			const target = path.join(root, directory, relative);
			if (!(await fs.stat(target)).isFile()) continue;
			entries.push([`${directory}/${relative}`, crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex')]);
		}
	}
	return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

async function stopChild(child) {
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	await new Promise((resolve) => {
		const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
		child.once('close', () => { clearTimeout(timeout); resolve(); });
		child.kill('SIGTERM');
	});
}

async function startHost(runtimeRoot, vaultRoot, scenario, token) {
	const child = spawn(process.execPath, [path.join(here, 'comparison-host.mjs'), runtimeRoot, vaultRoot, scenario], {
		env: { ...process.env, TRACEKEEPER_STANDALONE_BEARER: token }, stdio: ['ignore', 'pipe', 'pipe'],
	});
	const calls = [];
	let buffer = '', errors = '';
	child.stderr.on('data', (chunk) => { errors += chunk; });
	try {
		const endpoint = await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error(`Comparison host timeout: ${errors}`)), 15000);
			child.stdout.on('data', (chunk) => {
				buffer += chunk;
				for (;;) {
					const end = buffer.indexOf('\n');
					if (end < 0) break;
					const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
					let row;
					try { row = JSON.parse(line); } catch { continue; }
					if (row.type === 'ready') { clearTimeout(timeout); resolve(row.endpoint); }
					if (row.type === 'observation') calls.push(row);
				}
			});
			child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Comparison host exited ${code}: ${errors}`)); });
			child.once('error', (error) => { clearTimeout(timeout); reject(error); });
		});
		return { child, endpoint, calls };
	} catch (error) { await stopChild(child); throw error; }
}

async function preflight(runtimeRoot) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-build-preflight-'));
	const vault = path.join(root, 'vault');
	let host;
	try {
		await createComparisonFixture(vault, 'memory-pages');
		const token = buildMcpAuthToken();
		host = await startHost(runtimeRoot, vault, 'memory-pages', token);
		let session = '';
		const rpc = async (id, method, params) => {
			const response = await fetch(host.endpoint, { method: 'POST', signal: AbortSignal.timeout(15000), headers: {
				Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
				...(session ? { 'Mcp-Session-Id': session, 'MCP-Protocol-Version': '2025-11-25' } : {}),
			}, body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params }) });
			session = response.headers.get('mcp-session-id') || session;
			const text = await response.text();
			if (!response.ok) throw new Error(`Preflight HTTP ${response.status}`);
			if (!text) return null;
			const data = text.split('\n').find((line) => line.startsWith('data:'));
			return JSON.parse(data ? data.slice(5) : text);
		};
		await rpc(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'comparison-preflight', version: '1' } });
		await rpc(null, 'notifications/initialized', {});
		const tools = await rpc(2, 'tools/list', {});
		const memory = await rpc(3, 'tools/call', { name: 'tracekeeper.memory', arguments: { scope: 'global', view: 'all', page_size: 1 } });
		if (memory.result?.structuredContent?.ok !== true) throw new Error('Preflight Memory read failed.');
		return { passed: true, tool_count: tools.result.tools.length, memory_total: memory.result.structuredContent.total, model_runs: 0 };
	} finally { await stopChild(host?.child); await fs.rm(root, { recursive: true, force: true }); }
}

async function runModel(options, prompt) {
	const config = buildCodexLaunchConfig({ ...options, model: MODEL }, prompt);
	config.args.splice(config.args.length - 1, 0, '-c', `model_reasoning_effort="${EFFORT}"`);
	const child = spawn(options.codexBin, config.args, { cwd: options.workingRoot, env: config.env, stdio: ['ignore', 'pipe', 'pipe'] });
	let stdout = '', stderr = '', timedOut = false;
	const started = performance.now();
	const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 120000);
	child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 16 * 1024 * 1024) { timedOut = true; child.kill('SIGKILL'); } });
	child.stderr.on('data', (chunk) => { stderr += chunk; });
	try {
		const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
		return { stdout, stderr, exit_code: code, timed_out: timedOut, duration_ms: performance.now() - started };
	} finally { clearTimeout(timeout); }
}

export function comparisonExecutionOk(result, rows) {
	return result.exit_code === 0 && !result.timed_out && !rows.some((row) => row.type === 'turn.failed' || row.type === 'error');
}

export async function runComparison(options) {
	const plan = comparisonPlan();
	if (!options.execute && !options.preflight) return { dry_run: true, model: MODEL, reasoning_effort: EFFORT, max_runs: MAX_RUNS, plan };
	// 独占实验目录：重跑必须显式另行安排，不能覆盖证据或隐式重复消耗配额。
	await fs.mkdir(path.dirname(options.outputDir), { recursive: true });
	await fs.mkdir(options.outputDir);
	const manifest = { schema_version: 1, model: MODEL, reasoning_effort: EFFORT, max_runs: MAX_RUNS, attempts: 0, runs: [],
		fingerprints: { baseline: await buildFingerprint(options.baselineRoot), candidate: await buildFingerprint(options.candidateRoot) },
		skill: JSON.parse(await fs.readFile(path.join(options.candidateRoot, 'skills/tracekeeper/manifest.json'), 'utf8')).bundle_hash,
		preflight: {}, complete: false };
	const save = () => fs.writeFile(path.join(options.outputDir, 'aggregate.json'), `${JSON.stringify(manifest, null, 2)}\n`);
	await save();
	for (const build of ['baseline', 'candidate']) {
		manifest.preflight[build] = await preflight(options[`${build}Root`]);
		await save();
	}
	if (!options.execute) return manifest;
	for (const tuple of plan) {
		if (manifest.attempts >= MAX_RUNS) break;
		const scenario = COMPARISON_SCENARIOS.find((entry) => entry.id === tuple.scenario);
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracekeeper-build-comparison-'));
		const token = buildMcpAuthToken();
		const redactions = buildRunLogRedactions(token, root);
		let host;
		try {
			await createComparisonFixture(path.join(root, 'vault'), scenario.id);
			await fs.mkdir(path.join(root, '.agents/skills'), { recursive: true });
			await fs.cp(path.join(options.candidateRoot, 'skills/tracekeeper'), path.join(root, '.agents/skills/tracekeeper'), { recursive: true });
			host = await startHost(options[`${tuple.build}Root`], path.join(root, 'vault'), scenario.id, token);
			manifest.attempts++;
			await save();
			const prompt = 'Work only with the synthetic context in this evaluation workspace and the connected Tracekeeper Vault. Do not inspect or edit unrelated user files.\n\n' + scenario.prompt;
			const result = await runModel({ ...options, workingRoot: root, endpoint: host.endpoint, token }, prompt);
			await stopChild(host.child);
			const rows = result.stdout.split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
			const message = rows.filter((row) => row.type === 'item.completed' && row.item?.type === 'agent_message').at(-1)?.item?.text ?? '';
			const executionOk = comparisonExecutionOk(result, rows) && host.child.exitCode === 0;
			const assessment = assessComparison(scenario.id, host.calls, message);
			const usage = rows.findLast((row) => row.type === 'turn.completed')?.usage ?? null;
			const name = `${tuple.scenario}-${tuple.build}`;
			await fs.writeFile(path.join(options.outputDir, `${name}.jsonl`), sanitizeForLog(result.stdout, redactions));
			await fs.writeFile(path.join(options.outputDir, `${name}-calls.json`), sanitizeForLog(JSON.stringify(host.calls, null, 2), redactions));
			manifest.runs.push({ ...tuple, ...assessment, execution_ok: executionOk,
				passed: assessment.passed && executionOk,
				duration_ms: result.duration_ms, timed_out: result.timed_out, token_usage: usage,
				tool_calls: host.calls.length, tool_output_bytes: host.calls.reduce((sum, call) => sum + call.output_bytes, 0),
				message: sanitizeForLog(message, redactions), error: sanitizeForLog(result.stderr, redactions) });
		} catch (error) {
			manifest.runs.push({ ...tuple, execution_ok: false, passed: false, error: sanitizeForLog(String(error), redactions) });
			await save();
			break;
		} finally {
			await stopChild(host?.child);
			await fs.rm(root, { recursive: true, force: true });
		}
		await save();
		process.stdout.write(`${JSON.stringify({ completed: manifest.runs.length, attempts: manifest.attempts, ...tuple, passed: manifest.runs.at(-1).passed })}\n`);
		if (!manifest.runs.at(-1).execution_ok) break;
	}
	manifest.fingerprints_after = { baseline: await buildFingerprint(options.baselineRoot), candidate: await buildFingerprint(options.candidateRoot) };
	manifest.complete = manifest.runs.length === MAX_RUNS && JSON.stringify(manifest.fingerprints) === JSON.stringify(manifest.fingerprints_after);
	await save();
	return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const result = await runComparison(parseComparisonArgs(process.argv.slice(2)));
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
