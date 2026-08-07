import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { callTool } from '../dist/index.js';

function writeNote(vaultRoot, relativePath, content) {
	const absolutePath = path.join(vaultRoot, relativePath);
	fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
	fs.writeFileSync(absolutePath, content, 'utf8');
}

function managedWorkflowArtifacts(vaultRoot) {
	const roots = [
		'00_tracekeeper/control/operations',
		'00_tracekeeper/inbox/review_queue',
		'00_tracekeeper/work/tasks',
		'00_tracekeeper/work/sessions',
	];
	const files = [];
	const visit = (absoluteDirectory, relativeDirectory) => {
		if (!fs.existsSync(absoluteDirectory)) {
			return;
		}
		for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
			const absolutePath = path.join(absoluteDirectory, entry.name);
			const relativePath = path.posix.join(relativeDirectory, entry.name);
			if (entry.isDirectory()) {
				visit(absolutePath, relativePath);
			} else if (entry.isFile()) {
				files.push(relativePath);
			}
		}
	};
	for (const root of roots) {
		visit(path.join(vaultRoot, ...root.split('/')), root);
	}
	return files.sort();
}

function auditText(vaultRoot) {
	const auditRoot = path.join(vaultRoot, '00_tracekeeper', 'control', 'agent_activity');
	if (!fs.existsSync(auditRoot)) {
		return '';
	}
	const documents = [];
	const visit = (directory) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const absolutePath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(absolutePath);
			} else if (entry.isFile()) {
				documents.push(fs.readFileSync(absolutePath, 'utf8'));
			}
		}
	};
	visit(auditRoot);
	return documents.join('\n');
}

function testContext(vaultRoot) {
	return {
		defaultVaultRoot: vaultRoot,
		principalId: 'vault-root-boundary-test',
		credentialCapabilities: ['*'],
		agentId: 'vault-root-boundary-agent',
		sessionId: 'vault-root-boundary-session',
		clientName: 'vault-root-boundary-test',
		transport: 'test',
		runtimeVersion: 'test',
	};
}

function assertRejected(result) {
	assert.equal(result.isError, true);
	assert.equal(result.structuredContent?.error_detail?.code, 'INVALID_REQUEST');
	assert.match(result.structuredContent?.error || '', /server.*managed|must not be supplied/i);
}

test('MCP callers cannot override the configured Vault root for reads or writes', async (t) => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-vault-root-boundary-'));
	const activeVault = path.join(tempRoot, 'active-vault');
	const externalVault = path.join(tempRoot, 'external-vault');
	fs.mkdirSync(activeVault, { recursive: true });
	fs.mkdirSync(externalVault, { recursive: true });
	t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

	writeNote(activeVault, 'safe.md', '# Active Vault\n\nThis note is inside the configured Vault.');
	writeNote(externalVault, 'outside-secret.md', '# Outside secret\n\nThis note must never be returned.');
	const context = testContext(activeVault);

	for (const value of [activeVault, externalVault, '../external-vault', '', null]) {
		const result = await callTool('tracekeeper.status', { vaultRoot: value }, context);
		assertRejected(result);
	}

	const readOutside = await callTool('tracekeeper.read_note', {
		path: 'outside-secret.md',
		vaultRoot: externalVault,
	}, context);
	assertRejected(readOutside);
	assert.doesNotMatch(JSON.stringify(readOutside), /Outside secret/);

	const activeArtifactsBeforeWriteAttempt = managedWorkflowArtifacts(activeVault);
	const externalArtifactsBeforeWriteAttempt = managedWorkflowArtifacts(externalVault);
	const startOutside = await callTool('tracekeeper.start_task', {
		goal: 'This task must not be created outside the active Vault.',
		idempotency_key: 'vault-root-boundary-start',
		vaultRoot: externalVault,
	}, context);
	assertRejected(startOutside);
	assert.deepEqual(managedWorkflowArtifacts(activeVault), activeArtifactsBeforeWriteAttempt);
	assert.deepEqual(managedWorkflowArtifacts(externalVault), externalArtifactsBeforeWriteAttempt);

	const audit = auditText(activeVault);
	assert.match(audit, /vaultRoot/);
	assert.doesNotMatch(audit, new RegExp(externalVault.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	assert.equal(auditText(externalVault), '');

	const normalStatus = await callTool('tracekeeper.status', {}, context);
	assert.equal(normalStatus.isError, false);
	const normalRead = await callTool('tracekeeper.read_note', { path: 'safe.md' }, context);
	assert.equal(normalRead.isError, false);
	assert.equal(normalRead.structuredContent?.content, '# Active Vault\n\nThis note is inside the configured Vault.');
});
