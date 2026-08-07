#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-review-queue-controller-test-'));
const controllerOutput = path.join(tempRoot, 'review-queue-controller.cjs');
const viewOutput = path.join(tempRoot, 'review-queue-view.cjs');
const modalsOutput = path.join(tempRoot, 'review-modals.cjs');
const transitionAdapterOutput = path.join(tempRoot, 'proposal-transition-adapter.cjs');
const require = createRequire(import.meta.url);

const hashContent = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const proposalPath = '00_tracekeeper/inbox/review_queue/proposal.md';
const targetPath = '01_knowledge/wiki/stale-target.md';
let computeProposalContentHashForTest;
let computeProposalRevisionForTest;
let proposalTransitionReceiptFromFrontmatterForTest;
let transitionProposalForTest;

const obsidianStub = {
	name: 'obsidian-stub',
	setup(buildContext) {
		buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
			path: 'obsidian-stub',
			namespace: 'obsidian-stub',
		}));
		buildContext.onLoad({ filter: /^obsidian-stub$/, namespace: 'obsidian-stub' }, () => ({
			loader: 'js',
			contents: `
				class FakeElement {
					constructor(options = {}) {
						this.text = options.text || '';
						this.value = options.value || '';
						this.children = [];
						this.handlers = {};
						this.disabled = false;
						this.focused = false;
					}
					empty() {
						this.children = [];
						this.text = '';
					}
					createEl(_tag, options = {}) {
						const child = new FakeElement(options);
						child.tag = _tag;
						this.children.push(child);
						return child;
					}
					createDiv(options = {}) {
						return this.createEl('div', options);
					}
					addEventListener(name, handler) {
						this.handlers[name] = handler;
					}
					setText(value) {
						this.text = String(value);
					}
					setAttr(name, value) {
						this[name] = value;
					}
					focus() {
						this.focused = true;
						globalThis.__tracekeeperFocusedElement = this;
					}
					addClass() {}
				}
				export function getLanguage() {
					return 'en';
				}
				export function getFrontMatterInfo(content) {
					if (!content.startsWith('---\\n')) {
						return {
							exists: false,
							frontmatter: '',
							from: 0,
							to: 0,
							contentStart: 0,
						};
					}
					const closing = content.indexOf('\\n---', 4);
					if (closing < 0) {
						return {
							exists: false,
							frontmatter: '',
							from: 0,
							to: 0,
							contentStart: 0,
						};
					}
					const closingStart = closing + 1;
					const after = content[closingStart + 3] === '\\n'
						? closingStart + 4
						: closingStart + 3;
					return {
						exists: true,
						frontmatter: content.slice(4, closingStart),
						from: 4,
						to: closingStart,
						contentStart: after,
					};
				}
				export function parseYaml(source) {
					const result = {};
					for (const line of source.split('\\n')) {
						const match = line.match(/^([^:]+):\\s*(.*)$/);
						if (!match) continue;
						const key = match[1].trim();
						const raw = match[2].trim();
						if (raw.startsWith('[') && raw.endsWith(']')) {
							result[key] = raw.slice(1, -1)
								.split(',')
								.map((item) => item.trim())
								.filter(Boolean);
						} else {
							result[key] = raw.replace(/^["']|["']$/g, '');
						}
					}
					return result;
				}
				export function stringifyYaml(value) {
					return Object.entries(value)
						.map(([key, item]) => Array.isArray(item)
							? key + ': [' + item.join(', ') + ']'
							: key + ': ' + String(item))
						.join('\\n') + '\\n';
				}
				export class TFile {
					static [Symbol.hasInstance](value) {
						return Boolean(value && value.__tracekeeper_kind === 'file');
					}
				}
				export class TFolder {
					static [Symbol.hasInstance](value) {
						return Boolean(value && value.__tracekeeper_kind === 'folder');
					}
				}
				export class App {}
				export class Modal {
					constructor(app) {
						this.app = app;
						this.contentEl = new FakeElement();
						this.titleEl = new FakeElement();
						this.closed = false;
					}
					open() {}
					close() {
						this.closed = true;
					}
					onOpen() {}
				}
				export class WorkspaceLeaf {}
				export class ItemView {
					constructor(leaf) {
						this.app = leaf?.app || {};
						this.contentEl = leaf?.contentEl || {};
					}
					async onOpen() {}
				}
				export class Notice {
					constructor(message) {
						globalThis.__tracekeeperReviewNotices ||= [];
						globalThis.__tracekeeperReviewNotices.push(String(message));
					}
				}
				export class Setting {}
			`,
		}));
	},
};

const makeProposalRecord = (overrides = {}) => {
	const record = {
		path: overrides.path || proposalPath,
		classification: overrides.classification || 'memory_proposal',
		proposalId: overrides.proposalId || 'proposal-1',
		proposalKind: overrides.proposalKind || 'memory',
		proposedBy: overrides.proposedBy || 'agent',
		relatedProject: overrides.relatedProject || '',
		memoryScope: overrides.memoryScope || '',
		taskId: overrides.taskId || 'task-1',
		sourceSessionNote: overrides.sourceSessionNote || '',
		targetNote: overrides.targetNote === undefined ? targetPath : overrides.targetNote,
		evidence: overrides.evidence || [],
		relatedSources: overrides.relatedSources || [],
		rationale: overrides.rationale || 'keep the target note updated',
		riskLevel: overrides.riskLevel || 'unknown',
		approvalStatus: overrides.approvalStatus || 'pending',
		created: overrides.created || '2026-07-30T00:00:00.000Z',
		snippet: overrides.snippet || '',
		sortTimestamp: overrides.sortTimestamp || Date.parse('2026-07-30T00:00:00.000Z'),
		revisionComment: overrides.revisionComment || '',
		revisionRequestedAt: overrides.revisionRequestedAt || '',
		revisionRequestedBy: overrides.revisionRequestedBy || '',
		writebackContent: overrides.writebackContent === undefined
			? '- original writeback line'
			: overrides.writebackContent,
		writebackSource: overrides.writebackSource || 'frontmatter',
		archived: overrides.archived || false,
		fileContentHash: overrides.fileContentHash || '',
		lastTransition: overrides.lastTransition,
	};
	const transitionSnapshot = {
		path: record.path,
		classification: record.classification,
		proposalId: record.proposalId,
		proposalKind: record.proposalKind,
		taskId: record.taskId,
		status: record.approvalStatus,
		targetPath: record.targetNote,
		writebackContent: record.writebackContent,
		revisionComment: record.revisionComment,
		revisionRequestedAt: record.revisionRequestedAt,
		revisionRequestedBy: record.revisionRequestedBy,
		archived: record.archived,
		appliedOperationId: record.lastTransition?.kind === 'apply'
			? record.lastTransition.operationId
			: undefined,
		lastTransition: record.lastTransition,
	};
	return {
		...record,
		contentHash: overrides.contentHash
			|| computeProposalContentHashForTest?.(transitionSnapshot)
			|| hashContent(JSON.stringify(transitionSnapshot)),
		revision: overrides.revision
			|| computeProposalRevisionForTest?.(transitionSnapshot)
			|| hashContent(JSON.stringify({ ...transitionSnapshot, writebackContent: '' })),
	};
};

const renderFileContent = (file) => JSON.stringify({
	frontmatter: file.frontmatter,
	body: file.body,
});

const currentProposalFromFile = (file) => {
	const classification = file.frontmatter.type === 'memory-proposal'
		? 'memory_proposal'
		: file.frontmatter.type === 'legacy_migration_review'
			? 'legacy_migration_review'
			: 'other_review_item';
	return makeProposalRecord({
	path: file.path,
	classification,
	proposalId: file.frontmatter.proposal_id,
	proposalKind: file.frontmatter.proposal_kind || classification,
	proposedBy: file.frontmatter.proposed_by,
	relatedProject: file.frontmatter.related_project,
	memoryScope: file.frontmatter.memory_scope,
	taskId: file.frontmatter.task_id,
	sourceSessionNote: file.frontmatter.proposal_source_session_note,
	targetNote: file.frontmatter.target_note,
	evidence: Array.isArray(file.frontmatter.evidence) ? file.frontmatter.evidence.slice() : [],
	relatedSources: Array.isArray(file.frontmatter.related_sources) ? file.frontmatter.related_sources.slice() : [],
	rationale: file.frontmatter.rationale || '',
	riskLevel: file.frontmatter.risk_level || 'unknown',
	approvalStatus: file.frontmatter.approval_status || 'pending',
	created: file.frontmatter.created || '',
	revisionComment: file.frontmatter.revision_comment || '',
	revisionRequestedAt: file.frontmatter.revision_requested_at || '',
	revisionRequestedBy: file.frontmatter.revision_requested_by || '',
	writebackContent: file.frontmatter.writeback_content
		|| file.body.match(/## Writeback\s*\n\n([\s\S]*)/i)?.[1]?.trim()
		|| '',
	lastTransition: proposalTransitionReceiptFromFrontmatterForTest?.(file.frontmatter),
	fileContentHash: hashContent(renderFileContent(file)),
	});
};

function makeInitialFile() {
	const file = {
		__tracekeeper_kind: 'file',
		path: proposalPath,
		extension: 'md',
		basename: 'proposal',
		stat: { mtime: Date.parse('2026-07-30T00:00:00.000Z') },
		frontmatter: {
			type: 'memory-proposal',
			proposal_id: 'proposal-1',
			proposal_kind: 'memory',
			approval_status: 'pending',
			target_note: targetPath,
			writeback_content: '- original writeback line',
			task_id: 'task-1',
		},
		body: '# Proposal\n\n## Writeback\n\n- original writeback line\n',
	};
	file.content = renderFileContent(file);
	return file;
}

function createHarness(options = {}) {
	const files = new Map();
	const auditLog = [];
	let committedWrites = 0;
	let refreshes = 0;
	let mutationCount = 0;
	const initialFile = makeInitialFile();
	files.set(proposalPath, initialFile);
	files.set(targetPath, {
		__tracekeeper_kind: 'file',
		path: targetPath,
		extension: 'md',
		basename: 'stale-target',
		stat: { mtime: Date.parse('2026-07-30T00:00:00.000Z') },
		frontmatter: { title: 'Stale target' },
		body: '# Stale target\n',
		content: '# Stale target\n',
	});

	const beforeMutation = async (kind, file) => {
		mutationCount += 1;
		await options.beforeMutation?.({ kind, file, files, mutationCount });
	};

	const commitFrontmatter = async (file, updater) => {
		await beforeMutation('frontmatter', file);
		const nextFrontmatter = { ...file.frontmatter };
		updater(nextFrontmatter);
		file.frontmatter = nextFrontmatter;
		file.content = renderFileContent(file);
		committedWrites += 1;
	};

	const commitText = async (file, updater) => {
		await beforeMutation('text', file);
		const nextText = updater(file.content);
		file.content = nextText;
		committedWrites += 1;
	};

	const app = {
		vault: {
			getAbstractFileByPath(filePath) {
				return files.get(filePath) || null;
			},
			read: async (file) => file.content,
			cachedRead: async (file) => file.content,
			process: commitText,
			rename: async (file, nextPath) => {
				files.delete(file.path);
				file.path = nextPath;
				files.set(nextPath, file);
			},
		},
		fileManager: {
			processFrontMatter: commitFrontmatter,
		},
	};

	const records = {
		async readMemoryProposalFile(file) {
			return currentProposalFromFile(file);
		},
		collectMarkdownFiles() {
			return [];
		},
		readRecentAgentTasks: async () => [],
	};
	const transitionOwner = {
		async transition(request) {
			const file = files.get(request.proposalPath);
			if (!file) {
				throw new Error('Proposal is not available.');
			}
			const mutationKind = request.action.kind === 'status'
				&& request.action.nextStatus === 'approved'
				? 'text'
				: request.action.kind === 'apply'
					? 'text'
					: 'frontmatter';
			await beforeMutation(mutationKind, file);
			const current = currentProposalFromFile(file);
			const decision = transitionProposalForTest({
				path: current.path,
				classification: current.classification,
				proposalId: current.proposalId,
				proposalKind: current.proposalKind,
				taskId: current.taskId,
				status: current.approvalStatus,
				targetPath: current.targetNote,
				writebackContent: current.writebackContent,
				revisionComment: current.revisionComment,
				revisionRequestedAt: current.revisionRequestedAt,
				revisionRequestedBy: current.revisionRequestedBy,
				archived: current.archived,
				appliedOperationId: current.lastTransition?.kind === 'apply'
					? current.lastTransition.operationId
					: undefined,
				lastTransition: current.lastTransition,
			}, request, {
				now: request.now || '2026-07-30T00:00:01.000Z',
				actor: request.actor || 'user',
				targetExists: (pathValue) => files.has(pathValue),
			});
			if (decision.replayed) {
				return decision;
			}
			for (const [key, value] of Object.entries(decision.frontmatter)) {
				if (value === null) {
					delete file.frontmatter[key];
				} else {
					file.frontmatter[key] = Array.isArray(value) ? value.slice() : value;
				}
			}
			file.content = renderFileContent(file);
			committedWrites += 1;
			return decision;
		},
	};

	const host = {
		async executeLocalTool(name, args) {
			if (options.executeLocalTool) {
				return options.executeLocalTool(name, args);
			}
			throw new Error('executeLocalTool should not be called in this test.');
		},
		async refreshGovernanceViews() {
			refreshes += 1;
		},
		async appendToAuditLog(entry) {
			auditLog.push(entry);
		},
		async ensureFolderExists() {},
		normalizeVaultPath(value) {
			return value;
		},
		async loadReviewKnowledgeSnapshot() {
			return {
				state: 'ready',
				indexState: 'ready',
				notes: [],
			};
		},
	};

	return {
		app,
		records,
		host,
		transitionOwner,
		files,
		auditLog,
		initialFile,
		staleSnapshot: makeProposalRecord({
			fileContentHash: hashContent(renderFileContent(initialFile)),
		}),
		get committedWrites() {
			return committedWrites;
		},
		get refreshes() {
			return refreshes;
		},
	};
}

function findElement(root, predicate) {
	if (predicate(root)) {
		return root;
	}
	for (const child of root.children || []) {
		const match = findElement(child, predicate);
		if (match) {
			return match;
		}
	}
	return null;
}

function renderNativeProposal(fields, body = '# Proposal\n\n## Writeback\n\n- native writeback\n') {
	const yaml = Object.entries(fields)
		.map(([key, value]) => Array.isArray(value)
			? `${key}: [${value.join(', ')}]`
			: `${key}: ${value}`)
		.join('\n');
	return `---\n${yaml}\n---\n${body}`;
}

function parseNativeProposal(content) {
	const closing = content.indexOf('\n---', 4);
	const fields = {};
	for (const line of content.slice(4, closing + 1).split('\n')) {
		const match = line.match(/^([^:]+):\s*(.*)$/);
		if (!match) continue;
		const raw = match[2].trim();
		fields[match[1].trim()] = raw.startsWith('[') && raw.endsWith(']')
			? raw.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean)
			: raw;
	}
	const bodyStart = closing + 5;
	return {
		fields,
		body: content.slice(bodyStart),
	};
}

function nativeSnapshot(overrides = {}) {
	return {
		path: proposalPath,
		classification: 'memory_proposal',
		proposalId: 'proposal-1',
		proposalKind: 'memory',
		taskId: 'task-1',
		status: 'pending',
		targetPath: targetPath,
		writebackContent: '- native writeback',
		revisionComment: '',
		revisionRequestedAt: '',
		revisionRequestedBy: '',
		...overrides,
	};
}

function createNativeTransitionHarness(options = {}) {
	const proposalFields = {
		type: 'memory-proposal',
		proposal_id: 'proposal-1',
		proposal_kind: 'memory',
		approval_status: 'pending',
		status: 'pending',
		target_note: targetPath,
		task_id: 'task-1',
		...options.proposalFields,
	};
	const proposalFile = {
		__tracekeeper_kind: 'file',
		path: proposalPath,
		extension: 'md',
		basename: 'proposal',
		stat: { mtime: Date.parse('2026-07-30T00:00:00.000Z') },
		content: renderNativeProposal(proposalFields),
		frontmatter: { ...proposalFields },
	};
	const targetFile = {
		__tracekeeper_kind: 'file',
		path: targetPath,
		extension: 'md',
		basename: 'stale-target',
		stat: { mtime: Date.parse('2026-07-30T00:00:00.000Z') },
		content: '# Target\n',
	};
	const files = new Map([
		[proposalPath, proposalFile],
		[targetPath, targetFile],
	]);
	let frontmatterWrites = 0;
	let textWrites = 0;
	let frontmatterCalls = 0;
	let textCalls = 0;
	const app = {
		vault: {
			getAbstractFileByPath(filePath) {
				return files.get(filePath) || null;
			},
			async process(file, updater) {
				textCalls += 1;
				await options.beforeTextMutation?.({ file, files });
				const next = updater(file.content);
				file.content = next;
				const parsed = parseNativeProposal(next);
				file.frontmatter = parsed.fields;
				textWrites += 1;
				return next;
			},
		},
		fileManager: {
			async processFrontMatter(file, updater) {
				frontmatterCalls += 1;
				await options.beforeFrontmatterMutation?.({ file, files });
				const next = { ...file.frontmatter };
				updater(next);
				const parsed = parseNativeProposal(file.content);
				file.frontmatter = next;
				file.content = renderNativeProposal(next, parsed.body);
				frontmatterWrites += 1;
			},
		},
	};
	return {
		app,
		files,
		proposalFile,
		get frontmatterCalls() {
			return frontmatterCalls;
		},
		get frontmatterWrites() {
			return frontmatterWrites;
		},
		get textCalls() {
			return textCalls;
		},
		get textWrites() {
			return textWrites;
		},
	};
}

try {
	await Promise.all([
		build({
			entryPoints: [path.resolve('src/features/review/review-queue-controller.ts')],
			outfile: controllerOutput,
			bundle: true,
			platform: 'node',
			format: 'cjs',
			logLevel: 'silent',
			plugins: [obsidianStub],
		}),
		build({
			entryPoints: [path.resolve('src/features/review/review-queue-view.ts')],
			outfile: viewOutput,
			bundle: true,
			platform: 'node',
			format: 'cjs',
			logLevel: 'silent',
			plugins: [obsidianStub],
		}),
		build({
			entryPoints: [path.resolve('src/features/review/review-modals.ts')],
			outfile: modalsOutput,
			bundle: true,
			platform: 'node',
			format: 'cjs',
			logLevel: 'silent',
			plugins: [obsidianStub],
		}),
		build({
			entryPoints: [path.resolve('src/features/review/proposal-transition-adapter.ts')],
			outfile: transitionAdapterOutput,
			bundle: true,
			platform: 'node',
			format: 'cjs',
			logLevel: 'silent',
			plugins: [obsidianStub],
		}),
	]);

	const { ReviewQueueController } = require(controllerOutput);
	const {
		TracekeeperReviewQueueView,
		reviewStatusFailureMessage,
		reviewStatusFailureReason,
	} = require(viewOutput);
	const {
		ApprovedWritebackApplyModal,
		ReviewQueueArchiveModal,
		ReviewQueueEditProposalModal,
		ReviewQueueRequestRevisionModal,
	} = require(modalsOutput);
	const { ObsidianProposalTransitionAdapter } = require(transitionAdapterOutput);
	const {
		computeProposalContentHash,
		computeProposalRevision,
		proposalTransitionReceiptFromFrontmatter,
		transitionProposal,
	} = require('@tracekeeper/core');
	computeProposalContentHashForTest = computeProposalContentHash;
	computeProposalRevisionForTest = computeProposalRevision;
	proposalTransitionReceiptFromFrontmatterForTest =
		proposalTransitionReceiptFromFrontmatter;
	transitionProposalForTest = transitionProposal;

	test('review status errors expose localized, actionable failure reasons', () => {
		const missingTarget = new Error('Proposal target does not exist.');
		missingTarget.name = 'ProposalTransitionValidationError';
		assert.equal(
			reviewStatusFailureReason(missingTarget),
			'The target note does not exist, and this proposal does not create a new memory record.'
		);
		assert.equal(
			reviewStatusFailureMessage(missingTarget),
			'Failed to update review status: The target note does not exist, and this proposal does not create a new memory record.'
		);
		const invalidState = new Error('Proposal transition approved -> rejected is not allowed.');
		invalidState.name = 'ProposalTransitionStateError';
		assert.match(reviewStatusFailureMessage(invalidState), /current proposal state.*does not allow/i);
	});

	test('native transition adapter commits frontmatter-only status through processFrontMatter', async () => {
		const harness = createNativeTransitionHarness();
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const snapshot = nativeSnapshot();
		const result = await adapter.transition({
			proposalPath,
			expectedRevision: computeProposalRevision(snapshot),
			operationId: 'review-reject-native',
			action: { kind: 'status', nextStatus: 'rejected' },
			now: '2026-07-30T00:00:01.000Z',
		});
		assert.equal(result.state.status, 'rejected');
		assert.equal(result.receipt.previousStatus, 'pending');
		assert.equal(result.receipt.nextStatus, 'rejected');
		assert.equal(harness.frontmatterCalls, 1);
		assert.equal(harness.frontmatterWrites, 1);
		assert.equal(harness.textCalls, 0);
		assert.equal(harness.proposalFile.frontmatter.approval_status, 'rejected');
		assert.equal(harness.proposalFile.frontmatter.status, 'rejected');
		assert.equal(
			JSON.stringify(result.receipt).includes('native writeback'),
			false
		);
	});

	test('native transition adapter commits a body-backed draft through Vault.process and synchronizes sources', async () => {
		const harness = createNativeTransitionHarness();
		harness.proposalFile.frontmatter.targetNote = targetPath;
		harness.proposalFile.frontmatter.writebackContent = '- native writeback';
		const initial = parseNativeProposal(harness.proposalFile.content);
		harness.proposalFile.content = renderNativeProposal(
			harness.proposalFile.frontmatter,
			initial.body
		);
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const result = await adapter.transition({
			proposalPath,
			expectedRevision: computeProposalRevision(nativeSnapshot()),
			expectedContentHash: computeProposalContentHash(nativeSnapshot()),
			operationId: 'review-draft-native',
			action: {
				kind: 'draft',
				targetPath,
				writebackContent: '- revised native draft',
			},
			now: '2026-07-30T00:00:01.500Z',
		});
		assert.equal(result.state.writebackContent, '- revised native draft');
		assert.equal(harness.textCalls, 1);
		assert.equal(harness.textWrites, 1);
		assert.equal(harness.frontmatterCalls, 0);
		assert.equal(
			harness.proposalFile.frontmatter.writeback_content,
			'- revised native draft'
		);
		assert.equal('targetNote' in harness.proposalFile.frontmatter, false);
		assert.equal('writebackContent' in harness.proposalFile.frontmatter, false);
		assert.match(
			harness.proposalFile.content,
			/## Writeback\s*\n\s*\n- revised native draft/
		);
		assert.doesNotMatch(harness.proposalFile.content, /- native writeback/);
	});

	test('native transition adapter validates body-dependent approval inside Vault.process', async () => {
		const harness = createNativeTransitionHarness();
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const snapshot = nativeSnapshot();
		const request = {
			proposalPath,
			expectedRevision: computeProposalRevision(snapshot),
			expectedContentHash: computeProposalContentHash(snapshot),
			operationId: 'review-approve-native',
			action: { kind: 'status', nextStatus: 'approved' },
			now: '2026-07-30T00:00:02.000Z',
		};
		const first = await adapter.transition(request);
		assert.equal(first.state.status, 'approved');
		assert.equal(harness.textCalls, 1);
		assert.equal(harness.textWrites, 1);
		assert.equal(harness.frontmatterCalls, 0);
		const committedContent = harness.proposalFile.content;
		const replay = await adapter.transition(request);
		assert.equal(replay.replayed, true);
		assert.deepEqual(replay.receipt, first.receipt);
		assert.equal(harness.proposalFile.content, committedContent);
	});

	test('native transition adapter binds the complete proposal file inside Vault.process', async () => {
		const harness = createNativeTransitionHarness({
			beforeTextMutation({ file }) {
				file.content = file.content.replace('---\n', '---\n# Unrelated sync edit\n');
			},
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const snapshot = nativeSnapshot();
		const { computePayloadHash } = require('@tracekeeper/core');
		await assert.rejects(
			() => adapter.transition({
				proposalPath,
				expectedRevision: computeProposalRevision(snapshot),
				expectedContentHash: computeProposalContentHash(snapshot),
				expectedFileHash: computePayloadHash(harness.proposalFile.content),
				operationId: 'review-approve-raw-file-race',
				action: { kind: 'status', nextStatus: 'approved' },
				now: '2026-07-30T00:00:02.500Z',
			}),
			/file changed before the transition/i
		);
		assert.equal(harness.proposalFile.frontmatter.approval_status, 'pending');
		assert.equal(harness.textWrites, 0);
		assert.match(harness.proposalFile.content, /Unrelated sync edit/);
	});

	test('native transition adapter rejects body removal inside the atomic callback', async () => {
		const harness = createNativeTransitionHarness({
			beforeTextMutation({ file }) {
				file.content = renderNativeProposal(file.frontmatter, '# Proposal\n\n## Writeback\n\n');
			},
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const snapshot = nativeSnapshot();
		await assert.rejects(
			() => adapter.transition({
				proposalPath,
				expectedRevision: computeProposalRevision(snapshot),
				expectedContentHash: computeProposalContentHash(snapshot),
				operationId: 'review-approve-missing-body',
				action: { kind: 'status', nextStatus: 'approved' },
				now: '2026-07-30T00:00:03.000Z',
			}),
			/content changed|writeback content/i
		);
		assert.equal(harness.textWrites, 0);
		assert.equal(harness.proposalFile.frontmatter.approval_status, 'pending');
	});

	test('native transition adapter rejects conflicting frontmatter and body writeback sources', async () => {
		const harness = createNativeTransitionHarness({
			beforeTextMutation({ file }) {
				file.frontmatter.writeback_content = '- conflicting frontmatter writeback';
				const parsed = parseNativeProposal(file.content);
				file.content = renderNativeProposal(file.frontmatter, parsed.body);
			},
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const snapshot = nativeSnapshot();
		await assert.rejects(
			() => adapter.transition({
				proposalPath,
				expectedRevision: computeProposalRevision(snapshot),
				expectedContentHash: computeProposalContentHash(snapshot),
				operationId: 'review-approve-conflicting-writeback',
				action: { kind: 'status', nextStatus: 'approved' },
				now: '2026-07-30T00:00:03.500Z',
			}),
			/writeback sources conflict/i
		);
		assert.equal(harness.textWrites, 0);
		assert.equal(harness.proposalFile.frontmatter.approval_status, 'pending');
	});

	test('native transition adapter rejects target disappearance inside the atomic callback', async () => {
		const harness = createNativeTransitionHarness({
			beforeTextMutation({ files }) {
				files.delete(targetPath);
			},
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const snapshot = nativeSnapshot();
		await assert.rejects(
			() => adapter.transition({
				proposalPath,
				expectedRevision: computeProposalRevision(snapshot),
				expectedContentHash: computeProposalContentHash(snapshot),
				operationId: 'review-approve-missing-target',
				action: { kind: 'status', nextStatus: 'approved' },
				now: '2026-07-30T00:00:04.000Z',
			}),
			/target does not exist/i
		);
		assert.equal(harness.textWrites, 0);
		assert.equal(harness.proposalFile.frontmatter.approval_status, 'pending');
	});

	test('native transition adapter approves a lifecycle proposal before its MemoryRecord target exists', async () => {
		const harness = createNativeTransitionHarness({
			proposalFields: {
				claim_key: 'review.lifecycle-create',
			},
			beforeTextMutation({ files }) {
				files.delete(targetPath);
			},
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const snapshot = nativeSnapshot();
		const decision = await adapter.transition({
			proposalPath,
			expectedRevision: computeProposalRevision(snapshot),
			expectedContentHash: computeProposalContentHash(snapshot),
			operationId: 'review-approve-lifecycle-create',
			action: { kind: 'status', nextStatus: 'approved' },
			now: '2026-07-30T00:00:04.500Z',
		});
		assert.equal(decision.state.status, 'approved');
		assert.equal(harness.proposalFile.frontmatter.approval_status, 'approved');
		assert.equal(harness.files.has(targetPath), false);
	});

	test('native transition adapter rejects an intervening status before draft mutation', async () => {
		const harness = createNativeTransitionHarness({
			beforeTextMutation({ file }) {
				file.frontmatter.approval_status = 'approved';
				file.frontmatter.status = 'approved';
				const parsed = parseNativeProposal(file.content);
				file.content = renderNativeProposal(file.frontmatter, parsed.body);
			},
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const snapshot = nativeSnapshot();
		await assert.rejects(
			() => adapter.transition({
				proposalPath,
				expectedRevision: computeProposalRevision(snapshot),
				expectedContentHash: computeProposalContentHash(snapshot),
				operationId: 'review-edit-stale-native',
				action: {
					kind: 'draft',
					targetPath,
					writebackContent: '- edited content',
				},
				now: '2026-07-30T00:00:05.000Z',
			}),
			/revision changed|approved|only pending/i
		);
		assert.equal(harness.textWrites, 0);
	});

	test('native transition adapter preserves a current body change instead of overwriting it with a stale draft', async () => {
		const harness = createNativeTransitionHarness({
			beforeTextMutation({ file }) {
				file.content = renderNativeProposal(
					file.frontmatter,
					'# Proposal\n\n## Writeback\n\n- current external revision\n'
				);
			},
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const snapshot = nativeSnapshot();
		await assert.rejects(
			() => adapter.transition({
				proposalPath,
				expectedRevision: computeProposalRevision(snapshot),
				expectedContentHash: computeProposalContentHash(snapshot),
				operationId: 'review-edit-stale-body-native',
				action: {
					kind: 'draft',
					targetPath,
					writebackContent: '- stale user draft',
				},
				now: '2026-07-30T00:00:05.500Z',
			}),
			/content changed|conflict/i
		);
		assert.equal(harness.textWrites, 0);
		assert.match(harness.proposalFile.content, /current external revision/);
		assert.doesNotMatch(harness.proposalFile.content, /stale user draft/);
	});

	test('native transition adapter rejects an unknown current status without normalizing it to pending', async () => {
		const harness = createNativeTransitionHarness({
			beforeFrontmatterMutation({ file }) {
				file.frontmatter.approval_status = 'unrecognized';
				file.frontmatter.status = 'unrecognized';
				const parsed = parseNativeProposal(file.content);
				file.content = renderNativeProposal(file.frontmatter, parsed.body);
			},
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		await assert.rejects(
			() => adapter.transition({
				proposalPath,
				expectedRevision: computeProposalRevision(nativeSnapshot()),
				operationId: 'review-invalid-status-native',
				action: { kind: 'status', nextStatus: 'rejected' },
				now: '2026-07-30T00:00:06.000Z',
			}),
			/status is invalid/i
		);
		assert.equal(harness.frontmatterWrites, 0);
	});

	test('native transition adapter rejects conflicting current status fields', async () => {
		const harness = createNativeTransitionHarness({
			beforeFrontmatterMutation({ file }) {
				file.frontmatter.status = 'approved';
				const parsed = parseNativeProposal(file.content);
				file.content = renderNativeProposal(file.frontmatter, parsed.body);
			},
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		await assert.rejects(
			() => adapter.transition({
				proposalPath,
				expectedRevision: computeProposalRevision(nativeSnapshot()),
				operationId: 'review-conflicting-status-native',
				action: { kind: 'status', nextStatus: 'rejected' },
				now: '2026-07-30T00:00:07.000Z',
			}),
			/status fields conflict/i
		);
		assert.equal(harness.frontmatterWrites, 0);
	});

	test('native transition adapter rejects classification drift inside the atomic callback', async () => {
		const harness = createNativeTransitionHarness({
			beforeTextMutation({ file }) {
				file.frontmatter.type = 'memory-proposal-corrupt';
				const parsed = parseNativeProposal(file.content);
				file.content = renderNativeProposal(file.frontmatter, parsed.body);
			},
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const snapshot = nativeSnapshot();
		await assert.rejects(
			() => adapter.transition({
				proposalPath,
				expectedRevision: computeProposalRevision(snapshot),
				expectedContentHash: computeProposalContentHash(snapshot),
				operationId: 'review-classification-drift-native',
				action: { kind: 'status', nextStatus: 'approved' },
				now: '2026-07-30T00:00:08.000Z',
			}),
			/revision changed/i
		);
		assert.equal(harness.textWrites, 0);
	});

	test('native transition adapter rejects orphaned transition receipt metadata', async () => {
		const harness = createNativeTransitionHarness({
			beforeFrontmatterMutation({ file }) {
				file.frontmatter.review_transition_payload_hash = 'orphaned';
				const parsed = parseNativeProposal(file.content);
				file.content = renderNativeProposal(file.frontmatter, parsed.body);
			},
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		await assert.rejects(
			() => adapter.transition({
				proposalPath,
				expectedRevision: computeProposalRevision(nativeSnapshot()),
				operationId: 'review-orphaned-receipt-native',
				action: { kind: 'status', nextStatus: 'rejected' },
				now: '2026-07-30T00:00:09.000Z',
			}),
			/receipt metadata is incomplete/i
		);
		assert.equal(harness.frontmatterWrites, 0);
	});

	test('preview requires an opaque confirmation token and expiry', async () => {
		const harness = createHarness({
			async executeLocalTool() {
				return {
					proposal_id: 'proposal-1',
					proposal_path: proposalPath,
					target_note: targetPath,
					touched_notes: [targetPath, proposalPath],
					writeback_preview: 'preview',
				};
			},
		});
		const controller = new ReviewQueueController(
			harness.app,
			harness.records,
			harness.host,
			harness.transitionOwner
		);
		await assert.rejects(
			() => controller.previewApprovedWriteback(harness.staleSnapshot),
			/confirmation|invalid preview/i
		);
	});

	test('apply forwards the exact preview confirmation token', async () => {
		const calls = [];
		const harness = createHarness({
			async executeLocalTool(name, args) {
				calls.push({ name, args });
				return { ok: true };
			},
		});
		const controller = new ReviewQueueController(
			harness.app,
			harness.records,
			harness.host,
			harness.transitionOwner
		);
		const preview = {
			proposal_id: 'proposal-1',
			proposal_path: proposalPath,
			target_note: targetPath,
			touched_notes: [targetPath, proposalPath],
			writeback_preview: 'preview',
			confirmation_token: 'opaque-confirmation-token',
			confirmation_expires_at: '2026-07-30T00:01:00.000Z',
		};
		await controller.applyApprovedWriteback(harness.staleSnapshot, preview);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].args.confirmation_token, preview.confirmation_token);
	});

	test('apply modal passes its displayed preview to the apply action', async () => {
		let receivedPreview;
		const plugin = {
			async applyApprovedWriteback(_proposal, preview) {
				receivedPreview = preview;
			},
		};
		const preview = {
			proposal_id: 'proposal-1',
			proposal_path: proposalPath,
			target_note: targetPath,
			touched_notes: [targetPath, proposalPath],
			writeback_preview: 'preview',
			confirmation_token: 'opaque-confirmation-token',
			confirmation_expires_at: '2026-07-30T00:01:00.000Z',
		};
		const modal = new ApprovedWritebackApplyModal({}, plugin, makeProposalRecord(), () => {});
		modal.renderReady(preview);
		const cancel = findElement(modal.contentEl, (element) => element.text === 'Cancel');
		const confirm = findElement(modal.contentEl, (element) => element.text === 'Confirm apply');
		assert.ok(cancel);
		assert.ok(confirm);
		assert.equal(cancel.focused, true);
		confirm.handlers.click();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(receivedPreview, preview);
	});

	test('apply modal announces failure and restores focus for a bounded retry', async () => {
		globalThis.__tracekeeperReviewNotices = [];
		globalThis.__tracekeeperFocusedElement = null;
		const plugin = {
			async applyApprovedWriteback() {
				throw new Error('stale preview');
			},
		};
		const preview = {
			proposal_id: 'proposal-1',
			proposal_path: proposalPath,
			target_note: targetPath,
			touched_notes: [targetPath, proposalPath],
			writeback_preview: 'preview',
			confirmation_token: 'opaque-confirmation-token',
			confirmation_expires_at: '2026-07-30T00:01:00.000Z',
		};
		const modal = new ApprovedWritebackApplyModal({}, plugin, makeProposalRecord(), () => {});
		modal.renderReady(preview);
		const confirm = findElement(modal.contentEl, (element) => element.text === 'Confirm apply');
		assert.ok(confirm);
		confirm.handlers.click();
		await new Promise((resolve) => setImmediate(resolve));
		const status = findElement(
			modal.contentEl,
			(element) => element['aria-live'] === 'polite'
				&& /fresh preview|interruption/i.test(element.text)
		);
		assert.ok(status);
		assert.equal(status.role, 'status');
		assert.equal(status['aria-atomic'], 'true');
		assert.equal(confirm.disabled, false);
		assert.equal(confirm.focused, true);
		assert.equal(globalThis.__tracekeeperFocusedElement, confirm);
	});

	test('archive modal shows exact paths and commits the displayed preview', async () => {
		let committedPreview;
		let archivedReceipt;
		const receipt = {
			schemaVersion: 1,
			operationId: 'archive-operation-one',
			previewHash: 'preview-token',
			status: 'completed',
			moved: [{
				proposalId: 'proposal-1',
				oldPath: proposalPath,
				newPath: '02_archive/review_queue/proposal.md',
			}],
			movedHashes: { 'proposal-1': 'proposal-hash' },
			managedReferences: [{
				path: '00_tracekeeper/work/tasks/task-1.md',
				contentHash: 'task-hash',
			}],
			completedAt: '2026-07-30T00:02:00.000Z',
		};
		const plugin = {
			async commitArchiveMemoryProposals(preview) {
				committedPreview = preview;
				return receipt;
			},
		};
		const preview = {
			schemaVersion: 1,
			operationId: 'archive-operation-one',
			issuedAt: '2026-07-30T00:00:00.000Z',
			expiresAt: '2026-07-30T00:05:00.000Z',
			items: [{
				proposalId: 'proposal-1',
				sourcePath: proposalPath,
				sourceHash: 'proposal-hash',
				sourceRevision: 'proposal-revision',
				sourceStatus: 'applied',
				destinationPath: '02_archive/review_queue/proposal.md',
				destinationExists: false,
				managedReferences: ['00_tracekeeper/work/tasks/task-1.md'],
				referenceSnapshots: [],
			}],
			conflicts: [],
			confirmationToken: 'preview-token',
		};
		const modal = new ReviewQueueArchiveModal(
			{},
			plugin,
			[makeProposalRecord({ approvalStatus: 'applied' })],
			(value) => {
				archivedReceipt = value;
			}
		);
		modal.renderReady(preview);
		const exactPath = findElement(
			modal.contentEl,
			(element) => element.text ===
				`${proposalPath} → 02_archive/review_queue/proposal.md`
		);
		const managedPath = findElement(
			modal.contentEl,
			(element) => element.text === '00_tracekeeper/work/tasks/task-1.md'
		);
		const cancel = findElement(modal.contentEl, (element) => element.text === 'Cancel');
		const confirm = findElement(modal.contentEl, (element) => element.text === 'Archive items');
		assert.ok(exactPath);
		assert.ok(managedPath);
		assert.ok(cancel);
		assert.ok(confirm);
		assert.equal(cancel.focused, true);
		confirm.handlers.click();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(committedPreview, preview);
		assert.equal(archivedReceipt, receipt);
		assert.equal(modal.closed, true);
	});

	test('archive modal blocks conflicts and announces bounded recovery after failure', async () => {
		globalThis.__tracekeeperReviewNotices = [];
		globalThis.__tracekeeperFocusedElement = null;
		const plugin = {
			async commitArchiveMemoryProposals() {
				throw new Error('stale archive preview');
			},
		};
		const basePreview = {
			schemaVersion: 1,
			operationId: 'archive-operation-two',
			issuedAt: '2026-07-30T00:00:00.000Z',
			expiresAt: '2026-07-30T00:05:00.000Z',
			items: [{
				proposalId: 'proposal-1',
				sourcePath: proposalPath,
				sourceHash: 'proposal-hash',
				sourceRevision: 'proposal-revision',
				sourceStatus: 'applied',
				destinationPath: '02_archive/review_queue/proposal.md',
				destinationExists: false,
				managedReferences: [],
				referenceSnapshots: [],
			}],
			conflicts: [],
			confirmationToken: 'preview-token',
		};
		const modal = new ReviewQueueArchiveModal(
			{},
			plugin,
			[makeProposalRecord({ approvalStatus: 'applied' })],
			() => {}
		);
		modal.renderReady(basePreview);
		const confirm = findElement(modal.contentEl, (element) => element.text === 'Archive items');
		assert.ok(confirm);
		confirm.handlers.click();
		await new Promise((resolve) => setImmediate(resolve));
		const status = findElement(
			modal.contentEl,
			(element) => element['aria-live'] === 'polite'
				&& /new preview|resume safely/i.test(element.text)
		);
		assert.ok(status);
		assert.equal(status.role, 'status');
		assert.equal(status['aria-atomic'], 'true');
		assert.equal(confirm.disabled, false);
		assert.equal(confirm.focused, true);
		assert.equal(globalThis.__tracekeeperFocusedElement, confirm);

		modal.renderReady({
			...basePreview,
			conflicts: [{
				kind: 'destination-exists',
				path: '02_archive/review_queue/proposal.md',
				proposalId: 'proposal-1',
			}],
		});
		const blocked = findElement(modal.contentEl, (element) => element.text === 'Archive items');
		assert.ok(blocked);
		assert.equal(blocked.disabled, true);
	});

	test('approval rejects a proposal changed after the rendered snapshot', async () => {
		const harness = createHarness();
		const controller = new ReviewQueueController(
			harness.app,
			harness.records,
			harness.host,
			harness.transitionOwner
		);
		harness.initialFile.frontmatter.revision_comment = 'changed after load';
		harness.initialFile.body += '\nextra line after load\n';
		harness.initialFile.content = renderFileContent(harness.initialFile);

		await assert.rejects(
			() => controller.updateMemoryProposalStatus(harness.staleSnapshot, 'approved'),
			/changed after load|stale|conflict/i
		);
		assert.equal(harness.committedWrites, 0);
		assert.equal(harness.auditLog.length, 0);
	});

	test('approval rechecks target existence inside the native mutation callback', async () => {
		const harness = createHarness({
			beforeMutation({ files }) {
				files.delete(targetPath);
			},
		});
		const controller = new ReviewQueueController(
			harness.app,
			harness.records,
			harness.host,
			harness.transitionOwner
		);

		await assert.rejects(
			() => controller.updateMemoryProposalStatus(harness.staleSnapshot, 'approved'),
			/target|incomplete|stale|conflict/i
		);
		assert.equal(harness.committedWrites, 0);
		assert.equal(harness.auditLog.length, 0);
	});

	test('body-dependent approval rechecks current writeback inside Vault.process', async () => {
		const harness = createHarness({
			beforeMutation({ file }) {
				delete file.frontmatter.writeback_content;
				file.body = '# Proposal\n\n## Writeback\n\n';
				file.content = renderFileContent(file);
			},
		});
		const controller = new ReviewQueueController(
			harness.app,
			harness.records,
			harness.host,
			harness.transitionOwner
		);

		await assert.rejects(
			() => controller.updateMemoryProposalStatus(harness.staleSnapshot, 'approved'),
			/writeback|incomplete|stale|conflict/i
		);
		assert.equal(harness.committedWrites, 0);
		assert.equal(harness.auditLog.length, 0);
	});

	test('approval rejects proposal identity drift inside the native callback', async () => {
		const harness = createHarness({
			beforeMutation({ file }) {
				file.frontmatter.task_id = 'task-after-read';
				file.content = renderFileContent(file);
			},
		});
		const controller = new ReviewQueueController(
			harness.app,
			harness.records,
			harness.host,
			harness.transitionOwner
		);
		await assert.rejects(
			() => controller.updateMemoryProposalStatus(harness.staleSnapshot, 'approved'),
			/identity|task|stale|conflict/i
		);
		assert.equal(harness.committedWrites, 0);
		assert.equal(harness.auditLog.length, 0);
	});

	for (const interveningStatus of ['approved', 'applied']) {
		test(`draft edit rejects an intervening ${interveningStatus} transition`, async () => {
			const harness = createHarness({
				beforeMutation({ file }) {
					file.frontmatter.approval_status = interveningStatus;
					file.content = renderFileContent(file);
				},
			});
			const controller = new ReviewQueueController(
				harness.app,
				harness.records,
				harness.host,
				harness.transitionOwner
			);
			const userDraft = {
				targetNote: targetPath,
				writebackContent: '- updated writeback line',
			};

			await assert.rejects(
				() => controller.updateMemoryProposalDraft(harness.staleSnapshot, userDraft),
				/approved|applied|stale|conflict/i
			);
			assert.equal(harness.committedWrites, 0);
			assert.equal(harness.auditLog.length, 0);
			assert.equal(harness.refreshes, 0);
			assert.deepEqual(userDraft, {
				targetNote: targetPath,
				writebackContent: '- updated writeback line',
			});
		});
	}

	test('draft edit preserves a current writeback change and the stale user draft', async () => {
		const harness = createHarness({
			beforeMutation({ file }) {
				file.frontmatter.writeback_content = '- current external writeback';
				file.content = renderFileContent(file);
			},
		});
		const controller = new ReviewQueueController(
			harness.app,
			harness.records,
			harness.host,
			harness.transitionOwner
		);
		const userDraft = {
			targetNote: targetPath,
			writebackContent: '- stale local draft',
		};
		await assert.rejects(
			() => controller.updateMemoryProposalDraft(harness.staleSnapshot, userDraft),
			/content changed|stale|conflict/i
		);
		assert.equal(harness.committedWrites, 0);
		assert.equal(harness.initialFile.frontmatter.writeback_content, '- current external writeback');
		assert.equal(harness.auditLog.length, 0);
		assert.equal(harness.refreshes, 0);
		assert.deepEqual(userDraft, {
			targetNote: targetPath,
			writebackContent: '- stale local draft',
		});
	});

	test('draft modal preserves the user text and remains open after a transition conflict', async () => {
		globalThis.__tracekeeperReviewNotices = [];
		globalThis.__tracekeeperFocusedElement = null;
		let receivedDraft;
		let refreshed = false;
		const proposal = makeProposalRecord();
		const plugin = {
			async updateMemoryProposalDraft(_proposal, draft) {
				receivedDraft = { ...draft };
				const error = new Error('proposal transition conflict');
				error.name = 'ProposalTransitionConflictError';
				throw error;
			},
		};
		const context = {
			target: {
				path: targetPath,
				title: 'Stale target',
				exists: true,
				excerpt: '# Stale target',
			},
			targetCandidates: [{
				path: targetPath,
				title: 'Stale target',
				kind: 'wiki',
				reason: 'current',
				excerpt: '# Stale target',
			}],
		};
		const modal = new ReviewQueueEditProposalModal(
			{},
			plugin,
			proposal,
			context,
			() => {
				refreshed = true;
			}
		);
		modal.onOpen();
		const textarea = findElement(modal.contentEl, (element) => element.tag === 'textarea');
		assert.ok(textarea);
		textarea.value = '- unsaved user revision';
		textarea.handlers.input();
		const save = findElement(modal.contentEl, (element) => element.text === 'Save proposal draft');
		assert.ok(save);
		save.handlers.click();
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(receivedDraft, {
			targetNote: targetPath,
			writebackContent: '- unsaved user revision',
		});
		assert.equal(modal.closed, false);
		assert.equal(refreshed, true);
		assert.equal(modal.writebackContent, '- unsaved user revision');
		assert.equal(save.disabled, false);
		const status = findElement(
			modal.contentEl,
			(element) => element['aria-live'] === 'polite'
				&& /preserved|reload|changed/i.test(element.text)
		);
		assert.ok(status);
		assert.equal(status.role, 'status');
		assert.equal(status['aria-atomic'], 'true');
		assert.equal(textarea.focused, true);
		assert.equal(globalThis.__tracekeeperFocusedElement, textarea);
		assert.match(
			globalThis.__tracekeeperReviewNotices.join('\n'),
			/preserved|reload|changed/i
		);
	});

	test('revision modal announces a conflict and returns focus to the preserved note', async () => {
		globalThis.__tracekeeperReviewNotices = [];
		globalThis.__tracekeeperFocusedElement = null;
		const proposal = makeProposalRecord({ revisionComment: 'keep this note' });
		const plugin = {
			async updateMemoryProposalStatus() {
				const error = new Error('proposal transition conflict');
				error.name = 'ProposalTransitionConflictError';
				throw error;
			},
		};
		const modal = new ReviewQueueRequestRevisionModal(
			{},
			plugin,
			proposal,
			() => {}
		);
		modal.onOpen();
		const textarea = findElement(modal.contentEl, (element) => element.tag === 'textarea');
		const submit = findElement(modal.contentEl, (element) => element.text === 'Return for revision');
		assert.ok(textarea);
		assert.ok(submit);
		submit.handlers.click();
		await new Promise((resolve) => setImmediate(resolve));
		const status = findElement(
			modal.contentEl,
			(element) => element['aria-live'] === 'polite'
				&& /preserved|reload|changed/i.test(element.text)
		);
		assert.ok(status);
		assert.equal(status.role, 'status');
		assert.equal(textarea.focused, true);
		assert.equal(globalThis.__tracekeeperFocusedElement, textarea);
		assert.equal(modal.closed, false);
	});

	test('draft commit refreshes from the committed receipt and keeps content out of audit', async () => {
		const harness = createHarness();
		const controller = new ReviewQueueController(
			harness.app,
			harness.records,
			harness.host,
			harness.transitionOwner,
			() => 'review-controller-draft'
		);
		await controller.updateMemoryProposalDraft(harness.staleSnapshot, {
			targetNote: targetPath,
			writebackContent: '- controller draft content must stay out of audit',
		});
		assert.equal(harness.committedWrites, 1);
		assert.equal(harness.refreshes, 1);
		assert.equal(
			harness.initialFile.frontmatter.writeback_content,
			'- controller draft content must stay out of audit'
		);
		assert.equal(harness.auditLog.length, 1);
		assert.match(harness.auditLog[0], /action: memory\.proposal\.edited/);
		assert.match(harness.auditLog[0], /operation_id: review-controller-draft/);
		assert.match(harness.auditLog[0], /transition_kind: draft/);
		assert.match(harness.auditLog[0], /previous_revision: [a-f0-9]{64}/);
		assert.match(harness.auditLog[0], /committed_revision: [a-f0-9]{64}/);
		assert.doesNotMatch(harness.auditLog[0], /controller draft content/);
	});

	test('an existing revision request can update its preserved revision note atomically', async () => {
		const harness = createHarness();
		harness.initialFile.frontmatter.approval_status = 'revision_requested';
		harness.initialFile.frontmatter.status = 'revision_requested';
		harness.initialFile.frontmatter.revision_comment = 'Original revision note';
		harness.initialFile.frontmatter.revision_requested_at = '2026-07-30T00:00:00.000Z';
		harness.initialFile.frontmatter.revision_requested_by = 'user';
		harness.initialFile.content = renderFileContent(harness.initialFile);
		const rendered = currentProposalFromFile(harness.initialFile);
		const controller = new ReviewQueueController(
			harness.app,
			harness.records,
			harness.host,
			harness.transitionOwner,
			() => 'review-update-existing-revision'
		);
		await controller.updateMemoryProposalStatus(rendered, 'revision_requested', {
			revisionComment: 'Updated revision note',
		});
		assert.equal(harness.committedWrites, 1);
		assert.deepEqual(harness.initialFile.frontmatter.revision_comment, [
			'Updated revision note',
		]);
		assert.equal(harness.auditLog.length, 1);
		assert.match(harness.auditLog[0], /previous_status: revision_requested/);
		assert.match(harness.auditLog[0], /next_status: revision_requested/);
		assert.equal(harness.refreshes, 1);
	});

	test('a legacy review item can use its explicit confirm-complete status action', async () => {
		const harness = createHarness();
		harness.initialFile.frontmatter.type = 'legacy_migration_review';
		harness.initialFile.frontmatter.proposal_id = 'legacy-review-1';
		harness.initialFile.frontmatter.proposal_kind = 'legacy_migration_review';
		harness.initialFile.frontmatter.target_note = '';
		delete harness.initialFile.frontmatter.writeback_content;
		harness.initialFile.body = '# Legacy migration review\n';
		harness.initialFile.content = renderFileContent(harness.initialFile);
		const rendered = currentProposalFromFile(harness.initialFile);
		const controller = new ReviewQueueController(
			harness.app,
			harness.records,
			harness.host,
			harness.transitionOwner,
			() => 'review-complete-legacy'
		);
		await controller.updateMemoryProposalStatus(rendered, 'applied');
		assert.equal(harness.initialFile.frontmatter.approval_status, 'applied');
		assert.equal(harness.initialFile.frontmatter.status, 'applied');
		assert.equal(harness.committedWrites, 1);
		assert.equal(harness.auditLog.length, 1);
		assert.match(harness.auditLog[0], /transition_kind: status/);
		assert.match(harness.auditLog[0], /next_status: applied/);
		assert.equal(harness.refreshes, 1);
	});

	test('two status actions from one revision permit only one legal commit', async () => {
		const harness = createHarness();
		const controller = new ReviewQueueController(
			harness.app,
			harness.records,
			harness.host,
			harness.transitionOwner
		);

		await controller.updateMemoryProposalStatus(harness.staleSnapshot, 'approved');
		await assert.rejects(
			() => controller.updateMemoryProposalStatus(harness.staleSnapshot, 'rejected'),
			/stale|conflict|illegal|approved/i
		);
		assert.equal(harness.committedWrites, 1);
		assert.equal(harness.auditLog.length, 1);
		assert.equal(harness.refreshes, 1);
		assert.match(harness.auditLog[0], /transition_kind: status/);
		assert.match(harness.auditLog[0], /previous_status: pending/);
		assert.match(harness.auditLog[0], /next_status: approved/);
		assert.match(harness.auditLog[0], /operation_id: review-/);
		assert.doesNotMatch(harness.auditLog[0], /original writeback line/);
	});

	test('mixed batch status transitions continue and report partial results', async () => {
		globalThis.__tracekeeperReviewNotices = [];
		const calls = [];
		const proposals = [
			makeProposalRecord({ path: 'one.md', proposalId: 'one' }),
			makeProposalRecord({ path: 'stale.md', proposalId: 'stale' }),
			makeProposalRecord({ path: 'three.md', proposalId: 'three' }),
		];
		const plugin = {
			async updateMemoryProposalStatus(proposal) {
				calls.push(proposal.proposalId);
				if (proposal.proposalId === 'stale') {
					throw new Error('stale proposal');
				}
			},
		};
		const view = new TracekeeperReviewQueueView({ app: {}, contentEl: {} }, plugin);
		let refreshes = 0;
		view.refresh = async () => {
			refreshes += 1;
		};

		await view.batchUpdate(proposals, 'rejected');
		assert.deepEqual(calls, ['one', 'stale', 'three']);
		assert.equal(refreshes, 1);
		assert.deepEqual([...view.selectedProposalPaths], ['stale.md']);
		assert.match(globalThis.__tracekeeperReviewNotices.join('\n'), /2.*1|partial|failed/i);
	});
} finally {
	process.on('exit', () => {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});
}
