#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NodeFsVaultRepository } from '@tracekeeper/core';
import { callTool } from '../dist/index.js';

class FailTaskUpdateRepository {
	constructor(delegate, taskPath) {
		this.delegate = delegate;
		this.taskPath = taskPath;
		this.taskUpdateAttempts = 0;
	}

	readText(relativePath) {
		return this.delegate.readText(relativePath);
	}

	createText(relativePath, content) {
		return this.delegate.createText(relativePath, content);
	}

	replaceText(relativePath, expectedVersion, content) {
		if (relativePath === this.taskPath) {
			this.taskUpdateAttempts += 1;
			throw new Error('post-completion task reference update failed');
		}
		return this.delegate.replaceText(relativePath, expectedVersion, content);
	}

	listMarkdown(scope) {
		return this.delegate.listMarkdown(scope);
	}
}

function write(vaultRoot, relativePath, content) {
	const absolutePath = path.join(vaultRoot, relativePath);
	fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
	fs.writeFileSync(absolutePath, content, 'utf8');
}

test('a downstream failure cannot relabel a completed source request as failed', async (t) => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-source-request-runtime-'));
	const vaultRoot = path.join(tempRoot, 'vault');
	const requestPath = '00_tracekeeper/inbox/agent_requests/source-request.md';
	const sourcePath = '01_knowledge/sources/source-input.md';
	const taskId = 'source-terminal-task';
	const taskPath = `00_tracekeeper/work/tasks/${taskId}.md`;
	fs.mkdirSync(vaultRoot, { recursive: true });
	t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

	write(vaultRoot, sourcePath, '# Source\n\nA bounded source record for the post-fix regression.');
	write(vaultRoot, requestPath, [
		'---',
		'type: agent-request',
		`source: ${sourcePath}`,
		'source_kind: local_file',
		'status: pending',
		'purpose: verify terminal source-request state',
		'analysis_mode: default',
		'---',
		'',
		'# Source request',
		'',
	].join('\n'));
	write(vaultRoot, taskPath, [
		'---',
		'type: agent_task',
		`task_id: ${taskId}`,
		'status: active',
		'---',
		'',
		'# Task',
		'',
	].join('\n'));

	const baseRepository = new NodeFsVaultRepository({ vaultRoot });
	const repository = new FailTaskUpdateRepository(baseRepository, taskPath);
	const result = await callTool('tracekeeper.source_request', {
		action: 'analyze',
		request_path: requestPath,
		task_id: taskId,
	}, {
		defaultVaultRoot: vaultRoot,
		vaultRepository: repository,
		principalId: 'source-request-principal',
		credentialCapabilities: ['*'],
		agentId: 'source-request-agent',
		sessionId: 'source-request-session',
		clientName: 'source-request-test',
		transport: 'test',
		runtimeVersion: 'test',
		contentLanguage: 'en',
	});

	assert.equal(result.isError, true);
	assert.equal(repository.taskUpdateAttempts, 1);
	const request = fs.readFileSync(path.join(vaultRoot, requestPath), 'utf8');
	assert.match(request, /^status: completed$/m);
	assert.doesNotMatch(request, /^status: failed$/m);
});
