import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { VaultRecordAdapter } from '../dist/infrastructure/vault-record-adapter.js';

test('VaultRecordAdapter owns safe generated-note writes and operation ownership checks', () => {
	const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-record-adapter-'));
	const adapter = new VaultRecordAdapter({
		agentActivityPath: '00_tracekeeper/control/agent_activity/index.md',
		buildMarkdownNote: (frontmatter, body) => [
			'---',
			...Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
			'---',
			'',
			body,
			'',
		].join('\n'),
	});

	try {
		const written = adapter.buildAndWriteNote(
			vaultRoot,
			'tracekeeper.capture_source',
			'01_knowledge/sources',
			'source.md',
			{ source_operation_id: 'operation-1', type: 'source' },
			'Body',
			null,
			{}
		);
		assert.equal(written.path, '01_knowledge/sources/source.md');
		assert.equal(written.status, 'written');

		const existing = adapter.findOperationOwnedNote(
			vaultRoot,
			'01_knowledge/sources',
			'source.md',
			'source_operation_id',
			'operation-1',
			{}
		);
		assert.equal(existing?.status, 'skipped');
		assert.throws(
			() => adapter.findOperationOwnedNote(
				vaultRoot,
				'01_knowledge/sources',
				'source.md',
				'source_operation_id',
				'operation-2',
				{}
			),
			/owned by another operation/
		);
	} finally {
		fs.rmSync(vaultRoot, { recursive: true, force: true });
	}
});
