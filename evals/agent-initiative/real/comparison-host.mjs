import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { longNote } from './comparison-fixture.mjs';

const [runtimeRoot, vaultRoot, scenarioId] = process.argv.slice(2);
if (!runtimeRoot || !vaultRoot || !scenarioId) throw new Error('Comparison host requires runtime root, disposable Vault, and scenario.');
const require = createRequire(path.join(path.resolve(runtimeRoot), 'package.json'));
const core = require('@tracekeeper/core');
const { StreamableHttpMcpRuntime, LOCAL_TRUST_CAPABILITIES } = require('@tracekeeper/mcp-runtime');
const bearer = process.env.TRACEKEEPER_STANDALONE_BEARER ?? '';
if (!/^[A-Za-z0-9_-]{43}$/.test(bearer)) throw new Error('Comparison host requires an ephemeral bearer.');
const bearerDigest = crypto.createHash('sha256').update(bearer).digest();
const index = new core.InMemoryKnowledgeIndex({ vaultRoot, initialScan: core.scanVault(vaultRoot) });
let syncChain = Promise.resolve();
const synchronize = () => {
	syncChain = syncChain.then(async () => {
		const previous = await index.readView();
		const scan = core.scanVault(vaultRoot);
		const paths = new Set(scan.notes.map((note) => note.relativePath));
		for (const notePath of previous.catalog.keys()) {
			if (!paths.has(notePath)) await index.applyScanned({ kind: 'delete', path: notePath, exists: false }, null);
		}
		for (const note of scan.notes) {
			if (previous.catalog.get(note.relativePath)?.contentHash === note.contentHash) continue;
			await index.applyScanned({ kind: previous.catalog.has(note.relativePath) ? 'modify' : 'create', path: note.relativePath,
				fileVersion: core.computeFileVersion(note.size, note.modifiedAt), exists: true, contentHash: note.contentHash }, note);
		}
	});
	return syncChain;
};
const runtime = new StreamableHttpMcpRuntime({
	localTrust: true, host: '127.0.0.1', port: 0, defaultVaultRoot: vaultRoot,
	vaultRepository: new core.NodeFsVaultRepository({ vaultRoot }),
	knowledgeReadViewProvider: async (requestedRoot) => {
		if (path.resolve(requestedRoot) !== path.resolve(vaultRoot)) return null;
		await synchronize();
		return index.readView();
	},
	credentialVerifier: { verifyBearer: async (token) => crypto.timingSafeEqual(crypto.createHash('sha256').update(token).digest(), bearerDigest)
		? { integrationId: 'comparison', credentialId: 'comparison', authMode: 'bearer', principalId: 'local-user', capabilities: LOCAL_TRUST_CAPABILITIES }
		: null },
	writebackConfirmationSecret: crypto.randomBytes(32).toString('base64url'),
	memoryRules: { globalMemoryRule: 'auto_write', projectMemoryRule: 'auto_write', wikiChangeRule: 'review', taskTrackingEnabled: true },
});
let changed = false;
// 仅测试宿主观测真实处理器结果；正式 Runtime 不增加测试钩子。
const handle = runtime.handler.handleMessage.bind(runtime.handler);
runtime.handler.handleMessage = async (request, state) => {
	const started = performance.now();
	const response = await handle(request, state);
	if (request?.method === 'tools/call') {
		const result = response?.result?.structuredContent ?? null;
		process.stdout.write(`${JSON.stringify({ type: 'observation', tool: request.params?.name, arguments: request.params?.arguments ?? {},
			result, duration_ms: performance.now() - started, output_bytes: Buffer.byteLength(JSON.stringify(response ?? null)) })}\n`);
		if (!changed && scenarioId === 'changed-note' && request.params?.name === 'tracekeeper.read_note' && result?.ok === true) {
			changed = true;
			await fs.writeFile(path.join(vaultRoot, '01_knowledge/wiki/concepts/long.md'), longNote(2));
		}
		await synchronize();
	}
	return response;
};
const status = await runtime.start();
process.stdout.write(`${JSON.stringify({ type: 'ready', endpoint: status.endpoint })}\n`);
let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	await runtime.stop();
	process.exitCode = 0;
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
