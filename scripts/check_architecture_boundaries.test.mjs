import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkArchitectureBoundaries } from './check_architecture_boundaries.mjs';

function write(root, relativePath, content) {
	const absolutePath = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
	fs.writeFileSync(absolutePath, content, 'utf8');
}

test('accepts package imports across workspaces', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'apps/obsidian-plugin/src/main.ts', "import { callTool } from '@tracekeeper/mcp-runtime';\n");
		write(root, 'packages/mcp-runtime/src/index.ts', 'export const callTool = () => undefined;\n');
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, true);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('rejects relative imports into another workspace', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'apps/obsidian-plugin/src/main.ts', "import '../../../packages/mcp-runtime/src/index';\n");
		write(root, 'packages/mcp-runtime/src/index.ts', 'export {};\n');
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, false);
		assert.match(result.errors[0], /relative cross-workspace import/);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('rejects plugin self-MCP client symbols', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'apps/obsidian-plugin/src/main.ts', 'const callLocalMcpTool = () => undefined;\n');
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, false);
		assert.match(result.errors[0], /must not call its own MCP transport/);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('rejects self-MCP transport moved outside plugin main', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'apps/obsidian-plugin/src/main.ts', 'export {}\n');
		write(root, 'apps/obsidian-plugin/src/features/internal-client.ts', [
			"import { Client as RenamedClient } from '@modelcontextprotocol/sdk/client/index.js';",
			'const send = globalThis.fetch;',
			'void RenamedClient;',
			'void send;',
			'',
		].join('\n'));
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((error) => /transport module/.test(error)));
		assert.ok(result.errors.some((error) => /transport identifier fetch/.test(error)));
		assert.ok(result.errors.every((error) => /features\/internal-client\.ts/.test(error)));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('ignores import-like text and forbidden symbols inside comments and strings', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'apps/obsidian-plugin/src/main.ts', [
			"// import '../../../packages/mcp-runtime/src/index';",
			"const note = 'callLocalMcpTool uiMcpSession fetch requestUrl';",
			'',
		].join('\n'));
		write(root, 'packages/mcp-runtime/src/index.ts', 'export {};\n');
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, true);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('rejects multiline dynamic imports and re-exports across workspaces', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'apps/obsidian-plugin/src/main.ts', [
			"export { runtime } from '../../../packages/mcp-runtime/src/index';",
			"void import(",
			"  '../../../packages/core/src/index'",
			');',
			'',
		].join('\n'));
		write(root, 'packages/mcp-runtime/src/index.ts', 'export const runtime = true;\n');
		write(root, 'packages/core/src/index.ts', 'export {};\n');
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, false);
		assert.equal(result.errors.filter((error) => /relative cross-workspace import/.test(error)).length, 2);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('rejects public tool contracts that expose a caller-selected Vault root', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'packages/contracts/src/contracts.ts', [
			'function withVaultRoot(properties) { return properties; }',
			'const inputSchema = { properties: { vaultRoot: { type: \'string\' } } };',
			'void withVaultRoot(inputSchema);',
			'',
		].join('\n'));
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((error) => /contract helper withVaultRoot/.test(error)));
		assert.ok(result.errors.some((error) => /public contract property vaultRoot/.test(error)));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('rejects runtime tool argument access to Vault root', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'packages/mcp-runtime/src/tools.ts', [
			'function read(args) { return args.vaultRoot; }',
			'',
		].join('\n'));
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((error) => /tool argument access args\.vaultRoot/.test(error)));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('accepts Runtime application imports from Core', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'packages/mcp-runtime/src/application/owner.ts', "import { parseMarkdown } from '@tracekeeper/core';\nvoid parseMarkdown;\n");
		write(root, 'packages/core/src/index.ts', 'export const parseMarkdown = () => undefined;\n');
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, true);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('rejects Runtime application imports from the Runtime edge', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'packages/mcp-runtime/src/application/owner.ts', "import { callTool } from '../tools';\nvoid callTool;\n");
		write(root, 'packages/mcp-runtime/src/tools.ts', 'export const callTool = () => undefined;\n');
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((error) => /application-to-runtime-edge import/.test(error)));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('rejects Runtime application imports from infrastructure adapters', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'packages/mcp-runtime/src/application/owner.ts', "import { adapter } from '../infrastructure/vault-record-adapter';\nvoid adapter;\n");
		write(root, 'packages/mcp-runtime/src/infrastructure/vault-record-adapter.ts', 'export const adapter = true;\n');
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((error) => /application-to-runtime-infrastructure import/.test(error)));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('rejects Runtime application filesystem and transport imports', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'packages/mcp-runtime/src/application/owner.ts', [
			"import fs from 'node:fs';",
			"import path from 'node:path';",
			'void fs; void path;',
			'',
		].join('\n'));
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((error) => /forbidden module node:fs/.test(error)));
		assert.ok(result.errors.some((error) => /forbidden module node:path/.test(error)));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('rejects Runtime application imports from another application owner', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'packages/mcp-runtime/src/application/owner.ts', "import { other } from './other-owner';\nvoid other;\n");
		write(root, 'packages/mcp-runtime/src/application/other-owner.ts', 'export const other = true;\n');
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((error) => /application-to-application import/.test(error)));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('accepts the Runtime edge owner composition after stateful extraction', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'packages/mcp-runtime/src/application/owner.ts', 'export {};\n');
		write(root, 'packages/mcp-runtime/src/tools.ts', [
			'new CaptureSourceApplicationService();',
			'new SourceRequestApplicationService();',
			'new ProposeMemoryApplicationService();',
			'new FinishTaskApplicationService();',
			'new DistillSessionApplicationService();',
			'new RuntimeRecoveryController();',
			'new AgentActivityRecentApplicationService();',
			'new VaultRecordAdapter();',
			'',
		].join('\n'));
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, true);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('rejects migrated audit declarations from the Runtime edge', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-architecture-'));
	try {
		write(root, 'packages/mcp-runtime/src/application/owner.ts', 'export {};\n');
		write(root, 'packages/mcp-runtime/src/tools.ts', [
			'new CaptureSourceApplicationService();',
			'new SourceRequestApplicationService();',
			'new ProposeMemoryApplicationService();',
			'new FinishTaskApplicationService();',
			'new DistillSessionApplicationService();',
			'new RuntimeRecoveryController();',
			'new AgentActivityRecentApplicationService();',
			'new VaultRecordAdapter();',
			'function parseAuditSections() {}',
			'',
		].join('\n'));
		const result = checkArchitectureBoundaries(root);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((error) => /migrated declaration remains.*parseAuditSections/.test(error)));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
