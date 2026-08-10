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
						this.cls = options.cls || '';
						this.classes = new Set(String(this.cls).split(/\\s+/).filter(Boolean));
						this.attributes = { ...(options.attr || {}) };
						this.children = [];
						this.handlers = {};
						this.disabled = false;
						this.focused = false;
						this.open = false;
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
						this.attributes[name] = String(value);
						this[name] = String(value);
					}
					setAttribute(name, value) {
						this.attributes[name] = String(value);
						this[name] = String(value);
					}
					focus() {
						this.focused = true;
						globalThis.__tracekeeperFocusedElement = this;
					}
					addClass(value) {
						for (const className of String(value).split(/\\s+/).filter(Boolean)) {
							this.classes.add(className);
						}
					}
				}
					globalThis.__tracekeeperReviewFakeElement = FakeElement;
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
							this.contentEl = leaf?.contentEl || new FakeElement();
							this.containerEl = leaf?.containerEl || new FakeElement();
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
		projectId: overrides.projectId || '',
		claimKey: overrides.claimKey || '',
		proposedAuthority: overrides.proposedAuthority || 'agent',
		proposedConfidence: overrides.proposedConfidence || 'inferred',
		reviewReason: overrides.reviewReason || '',
		reviewWarnings: overrides.reviewWarnings || [],
		declaredState: overrides.declaredState || 'active',
		observedAt: overrides.observedAt || '',
		validFrom: overrides.validFrom || '',
		validTo: overrides.validTo || '',
		lastVerifiedAt: overrides.lastVerifiedAt || '',
		supersedes: overrides.supersedes || [],
		contradicts: overrides.contradicts || [],
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
		writebackEffect: overrides.writebackEffect,
		invalidWritebackEffect: overrides.invalidWritebackEffect || false,
		writebackOperationId: overrides.writebackOperationId || '',
		invalidWritebackOperationId: overrides.invalidWritebackOperationId || false,
		writebackAppliedAt: overrides.writebackAppliedAt || '',
		invalidWritebackAppliedAt: overrides.invalidWritebackAppliedAt || false,
		writebackTarget: overrides.writebackTarget || '',
		invalidWritebackTarget: overrides.invalidWritebackTarget || false,
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
		writebackEffect: overrides.writebackEffect,
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
		writebackEffect: file.frontmatter.writeback_effect || file.frontmatter.writebackEffect,
	lastTransition: proposalTransitionReceiptFromFrontmatterForTest?.(file.frontmatter),
	fileContentHash: hashContent(renderFileContent(file)),
	});
};

function makeInitialFile({ targetNotePath = targetPath, proposalFields = {} } = {}) {
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
			target_note: targetNotePath,
			writeback_content: '- original writeback line',
			task_id: 'task-1',
			...proposalFields,
		},
		body: '# Proposal\n\n## Writeback\n\n- original writeback line\n',
	};
	file.content = renderFileContent(file);
	return file;
}

function createHarness(options = {}) {
	const proposalTargetPath = options.targetPath || targetPath;
	const files = new Map();
	const auditLog = [];
	let committedWrites = 0;
	let refreshes = 0;
	let mutationCount = 0;
	const initialFile = makeInitialFile({
		targetNotePath: proposalTargetPath,
		proposalFields: options.proposalFields || {},
	});
	files.set(proposalPath, initialFile);
	files.set(proposalTargetPath, {
		__tracekeeper_kind: 'file',
		path: proposalTargetPath,
		extension: 'md',
		basename: proposalTargetPath.split('/').pop() || 'stale-target',
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
				writebackEffect: current.writebackEffect,
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
			writebackEffect: initialFile.frontmatter.writeback_effect || initialFile.frontmatter.writebackEffect,
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

function findElements(root, predicate, matches = []) {
	if (predicate(root)) {
		matches.push(root);
	}
	for (const child of root.children || []) {
		findElements(child, predicate, matches);
	}
	return matches;
}

function elementHasClass(element, className) {
	return Boolean(element?.classes?.has(className));
}

function collectElementText(root, { skipDetails = false } = {}) {
	if (skipDetails && root.tag === 'details') {
		return '';
	}
	return [root.text, ...(root.children || []).map((child) => collectElementText(child, { skipDetails }))]
		.filter(Boolean)
		.join('\n');
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
	const writebackEffect = overrides.writebackEffect || overrides.writeback_effect;
	return {
		path: proposalPath,
		classification: 'memory_proposal',
		proposalId: 'proposal-1',
		proposalKind: 'memory',
		taskId: 'task-1',
		status: 'pending',
		targetPath: targetPath,
		writebackContent: '- native writeback',
		writebackEffect: writebackEffect === '' ? undefined : writebackEffect,
		revisionComment: '',
		revisionRequestedAt: '',
		revisionRequestedBy: '',
		...overrides,
	};
}

function createNativeTransitionHarness(options = {}) {
	const harnessTargetPath = options.targetPath || targetPath;
	const proposalFields = {
		type: 'memory-proposal',
		proposal_id: 'proposal-1',
		proposal_kind: 'memory',
		approval_status: 'pending',
		status: 'pending',
		target_note: harnessTargetPath,
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
		path: harnessTargetPath,
		extension: 'md',
		basename: 'stale-target',
		stat: { mtime: Date.parse('2026-07-30T00:00:00.000Z') },
		content: '# Target\n',
	};
	const files = new Map([
		[proposalPath, proposalFile],
		[harnessTargetPath, targetFile],
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
			async read(file) {
				return file.content;
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
			'The target note does not exist; confirm whether this change can create a new target.'
		);
		assert.equal(
			reviewStatusFailureMessage(missingTarget),
			'Failed to update review status: The target note does not exist; confirm whether this change can create a new target.'
		);
		const invalidState = new Error('Proposal transition approved -> rejected is not allowed.');
		invalidState.name = 'ProposalTransitionStateError';
		assert.match(reviewStatusFailureMessage(invalidState), /current change state.*does not allow/i);
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
		const snapshot = nativeSnapshot({ writebackEffect: 'append' });
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
			proposalFields: {
				writeback_effect: 'append',
			},
			beforeTextMutation({ files }) {
				files.delete(targetPath);
			},
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const snapshot = nativeSnapshot({ writeback_effect: 'append' });
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

	test('native transition adapter applies a create-wiki proposal when target exists but apply-owned path is set', async () => {
		const harness = createNativeTransitionHarness({
			proposalFields: {
				approval_status: 'approved',
				status: 'approved',
				writeback_effect: 'create_wiki_note',
			},
		});
		const snapshot = nativeSnapshot({
			status: 'approved',
			writeback_effect: 'create_wiki_note',
		});
		await assert.rejects(
			() => new ObsidianProposalTransitionAdapter(harness.app).transition({
				proposalPath,
				expectedRevision: computeProposalRevision(snapshot),
				expectedContentHash: computeProposalContentHash(snapshot),
				operationId: 'review-apply-create-path-without-flag',
				action: { kind: 'apply' },
				now: '2026-07-30T00:01:00.000Z',
			}),
			/Proposal writeback target already exists/i
		);
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const decision = await adapter.transition({
			proposalPath,
			expectedRevision: computeProposalRevision(snapshot),
			expectedContentHash: computeProposalContentHash(snapshot),
			operationId: 'review-apply-own-target',
			action: { kind: 'apply' },
			ownedCreateTargetPath: targetPath,
			ownedCreateTargetContentHash: hashContent('# Target\n'),
			now: '2026-07-30T00:01:00.000Z',
		});
		assert.equal(decision.state.status, 'applied');
		assert.equal(harness.proposalFile.frontmatter.approval_status, 'applied');
		assert.equal(harness.proposalFile.frontmatter.status, 'applied');
		assert.equal(harness.textWrites, 1);
	});

	test('native transition adapter rejects owned create-memory apply without a claim key', async () => {
		const memoryTargetPath = '01_knowledge/memory/global/agents/test/memory-no-claim.md';
		const harness = createNativeTransitionHarness({
			targetPath: memoryTargetPath,
			proposalFields: {
				approval_status: 'approved',
				status: 'approved',
				writeback_effect: 'create_memory_record',
			},
		});
		const snapshot = nativeSnapshot({
			status: 'approved',
			targetPath: memoryTargetPath,
			writeback_effect: 'create_memory_record',
		});
		await assert.rejects(
			() => new ObsidianProposalTransitionAdapter(harness.app).transition({
				proposalPath,
				expectedRevision: computeProposalRevision(snapshot),
				expectedContentHash: computeProposalContentHash(snapshot),
				operationId: 'review-apply-create-memory-without-claim',
				action: { kind: 'apply' },
				ownedCreateTargetPath: memoryTargetPath,
				ownedCreateTargetContentHash: hashContent('# Target\n'),
				now: '2026-07-30T00:01:10.000Z',
			}),
			/target does not exist/i
		);
		assert.equal(harness.textWrites, 0);
		assert.equal(harness.proposalFile.frontmatter.approval_status, 'approved');
	});

	test('native transition adapter applies an owned create-memory target with a claim key', async () => {
		const memoryTargetPath = '01_knowledge/memory/global/agents/test/memory-with-claim.md';
		const harness = createNativeTransitionHarness({
			targetPath: memoryTargetPath,
			proposalFields: {
				approval_status: 'approved',
				status: 'approved',
				writeback_effect: 'create_memory_record',
				claim_key: 'review.create-memory-with-claim',
			},
		});
		const snapshot = nativeSnapshot({
			status: 'approved',
			targetPath: memoryTargetPath,
			writeback_effect: 'create_memory_record',
		});
		const decision = await new ObsidianProposalTransitionAdapter(harness.app).transition({
			proposalPath,
			expectedRevision: computeProposalRevision(snapshot),
			expectedContentHash: computeProposalContentHash(snapshot),
			operationId: 'review-apply-create-memory-with-claim',
			action: { kind: 'apply' },
			ownedCreateTargetPath: memoryTargetPath,
			ownedCreateTargetContentHash: hashContent('# Target\n'),
			now: '2026-07-30T00:01:20.000Z',
		});
		assert.equal(decision.state.status, 'applied');
		assert.equal(harness.proposalFile.frontmatter.approval_status, 'applied');
		assert.equal(harness.textWrites, 1);
	});

	test('native transition adapter rejects an owned create-wiki apply when the target disappears inside callback', async () => {
		const harness = createNativeTransitionHarness({
			proposalFields: {
				approval_status: 'approved',
				status: 'approved',
				writeback_effect: 'create_wiki_note',
			},
			beforeTextMutation({ files }) {
				files.delete(targetPath);
			},
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const snapshot = nativeSnapshot({
			status: 'approved',
			writeback_effect: 'create_wiki_note',
		});
		await assert.rejects(
			() => adapter.transition({
				proposalPath,
				expectedRevision: computeProposalRevision(snapshot),
				expectedContentHash: computeProposalContentHash(snapshot),
				operationId: 'review-apply-own-target-disappeared',
				action: { kind: 'apply' },
				ownedCreateTargetPath: targetPath,
				ownedCreateTargetContentHash: hashContent('# Target\n'),
				now: '2026-07-30T00:01:30.000Z',
			}),
			/disappeared before apply|target does not exist/i
		);
		assert.equal(harness.textWrites, 0);
		assert.equal(harness.proposalFile.frontmatter.approval_status, 'approved');
		assert.equal(harness.proposalFile.frontmatter.status, 'approved');
	});

	test('native transition adapter rejects a stale owned create-wiki target hash during apply', async () => {
		const harness = createNativeTransitionHarness({
			proposalFields: {
				approval_status: 'approved',
				status: 'approved',
				writeback_effect: 'create_wiki_note',
			},
		});
		const snapshot = nativeSnapshot({
			status: 'approved',
			writeback_effect: 'create_wiki_note',
		});
		const adapter = new ObsidianProposalTransitionAdapter(harness.app);
		const request = {
			proposalPath,
			expectedRevision: computeProposalRevision(snapshot),
			expectedContentHash: computeProposalContentHash(snapshot),
			operationId: 'review-apply-own-target-hash-mismatch',
			action: { kind: 'apply' },
			ownedCreateTargetPath: targetPath,
			ownedCreateTargetContentHash: '0'.repeat(64),
			now: '2026-07-30T00:01:45.000Z',
		};
		const transitionResult = await adapter.transition(request).then(
			() => ({ decision: true }),
			(error) => ({ error })
		);
		const error = transitionResult.error;
		assert.ok(
			error instanceof Error,
			'expected transition to reject with hash mismatch'
		);
		assert.match(String(error), /changed before apply/i);
		assert.equal(harness.textWrites, 0);
		assert.equal(harness.proposalFile.frontmatter.approval_status, 'approved');
		assert.equal(harness.proposalFile.frontmatter.status, 'approved');
	});

	for (const [label, proof] of [
		['path only', { ownedCreateTargetPath: targetPath }],
		['hash only', { ownedCreateTargetContentHash: hashContent('# Target\n') }],
	]) {
		test(`native transition adapter rejects incomplete owned create proof with ${label}`, async () => {
			const harness = createNativeTransitionHarness({
				proposalFields: {
					approval_status: 'approved',
					status: 'approved',
					writeback_effect: 'create_wiki_note',
				},
			});
			const snapshot = nativeSnapshot({
				status: 'approved',
				writeback_effect: 'create_wiki_note',
			});
			await assert.rejects(
				() => new ObsidianProposalTransitionAdapter(harness.app).transition({
					proposalPath,
					expectedRevision: computeProposalRevision(snapshot),
					expectedContentHash: computeProposalContentHash(snapshot),
					operationId: `review-apply-incomplete-owned-proof-${label.replace(/\s+/g, '-')}`,
					action: { kind: 'apply' },
					...proof,
					now: '2026-07-30T00:01:50.000Z',
				}),
				/requires both path and content hash/i
			);
			assert.equal(harness.textWrites, 0);
			assert.equal(harness.proposalFile.frontmatter.approval_status, 'approved');
		});
	}

	test('native transition adapter rejects owned create proof outside the knowledge boundary', async () => {
		const harness = createNativeTransitionHarness({
			proposalFields: {
				approval_status: 'approved',
				status: 'approved',
				writeback_effect: 'create_wiki_note',
			},
		});
		const snapshot = nativeSnapshot({
			status: 'approved',
			writeback_effect: 'create_wiki_note',
		});
		await assert.rejects(
			() => new ObsidianProposalTransitionAdapter(harness.app).transition({
				proposalPath,
				expectedRevision: computeProposalRevision(snapshot),
				expectedContentHash: computeProposalContentHash(snapshot),
				operationId: 'review-apply-owned-proof-outside-boundary',
				action: { kind: 'apply' },
				ownedCreateTargetPath: '00_tracekeeper/control/forbidden.md',
				ownedCreateTargetContentHash: hashContent('# Target\n'),
				now: '2026-07-30T00:01:55.000Z',
			}),
			/outside the allowed Memory or Wiki boundary/i
		);
		assert.equal(harness.textWrites, 0);
		assert.equal(harness.proposalFile.frontmatter.approval_status, 'approved');
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
					writeback_effect: 'append',
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

	test('preview rejects missing or unknown writebackEffect', async () => {
		const missingEffectHarness = createHarness({
			async executeLocalTool() {
				return {
					proposal_id: 'proposal-1',
					proposal_path: proposalPath,
					target_note: targetPath,
					touched_notes: [targetPath, proposalPath],
					writeback_preview: 'preview',
					confirmation_token: 'opaque-confirmation-token',
					confirmation_expires_at: '2026-07-30T00:01:00.000Z',
				};
			},
		});
		const missingEffectController = new ReviewQueueController(
			missingEffectHarness.app,
			missingEffectHarness.records,
			missingEffectHarness.host,
			missingEffectHarness.transitionOwner
		);
		await assert.rejects(
			() => missingEffectController.previewApprovedWriteback(missingEffectHarness.staleSnapshot),
			/confirmation|invalid preview|unsupported|writeback mode/i
		);
		const unknownEffectHarness = createHarness({
			async executeLocalTool() {
				return {
					proposal_id: 'proposal-1',
					proposal_path: proposalPath,
					target_note: targetPath,
					touched_notes: [targetPath, proposalPath],
					writeback_preview: 'preview',
					writeback_effect: 'create-wiki-note',
					confirmation_token: 'opaque-confirmation-token',
					confirmation_expires_at: '2026-07-30T00:01:00.000Z',
				};
			},
		});
		const unknownEffectController = new ReviewQueueController(
			unknownEffectHarness.app,
			unknownEffectHarness.records,
			unknownEffectHarness.host,
			unknownEffectHarness.transitionOwner
		);
		await assert.rejects(
			() => unknownEffectController.previewApprovedWriteback(unknownEffectHarness.staleSnapshot),
			/confirmation|invalid preview|unsupported|writeback mode/i
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
			writeback_effect: 'append',
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
			writeback_effect: 'append',
			confirmation_token: 'opaque-confirmation-token',
			confirmation_expires_at: '2026-07-30T00:01:00.000Z',
		};
		const modal = new ApprovedWritebackApplyModal({}, plugin, makeProposalRecord(), () => {});
		modal.renderReady(preview);
		const technicalDetails = findElement(modal.contentEl, (element) => element.tag === 'details');
		assert.ok(technicalDetails);
		assert.equal(technicalDetails.open, false);
		assert.match(collectElementText(technicalDetails), /Technical details/);
		assert.equal(collectElementText(modal.contentEl, { skipDetails: true }).includes(targetPath), false);
		assert.equal(collectElementText(modal.contentEl, { skipDetails: true }).includes('proposal-1'), false);
		assert.equal(collectElementText(technicalDetails).includes(targetPath), true);
		assert.equal(collectElementText(technicalDetails).includes('proposal-1'), true);
		const cancel = findElement(modal.contentEl, (element) => element.text === 'Cancel');
		const confirm = findElement(modal.contentEl, (element) => element.text === 'Confirm append');
		assert.ok(cancel);
		assert.ok(confirm);
		assert.equal(cancel.focused, true);
		confirm.handlers.click();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(receivedPreview, preview);
	});

	test('apply modal uses create-Wiki confirmation copy for create_wiki_note', async () => {
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
			writeback_effect: 'create_wiki_note',
			confirmation_token: 'opaque-confirmation-token',
			confirmation_expires_at: '2026-07-30T00:01:00.000Z',
		};
		const modal = new ApprovedWritebackApplyModal({}, plugin, makeProposalRecord(), () => {});
		modal.renderReady(preview);
		const confirm = findElement(modal.contentEl, (element) => element.text === 'Confirm knowledge note creation');
		assert.ok(confirm);
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
			writeback_effect: 'append',
			confirmation_token: 'opaque-confirmation-token',
			confirmation_expires_at: '2026-07-30T00:01:00.000Z',
		};
		const modal = new ApprovedWritebackApplyModal({}, plugin, makeProposalRecord(), () => {});
		modal.renderReady(preview);
		const confirm = findElement(modal.contentEl, (element) => element.text === 'Confirm append');
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

	test('apply modal preserves create-Wiki confirmation copy after a bounded retry', async () => {
		globalThis.__tracekeeperReviewNotices = [];
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
			writeback_effect: 'create_wiki_note',
			confirmation_token: 'opaque-confirmation-token',
			confirmation_expires_at: '2026-07-30T00:01:00.000Z',
		};
		const modal = new ApprovedWritebackApplyModal({}, plugin, makeProposalRecord(), () => {});
		modal.renderReady(preview);
		const confirm = findElement(modal.contentEl, (element) => element.text === 'Confirm knowledge note creation');
		assert.ok(confirm);
		confirm.handlers.click();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(confirm.text, 'Confirm knowledge note creation');
	});

	test('apply modal uses Wiki-specific intro, progress, and completion copy', async () => {
		globalThis.__tracekeeperReviewNotices = [];
		let onAppliedCalled = false;
		const plugin = {
			async applyApprovedWriteback() {},
		};
		const preview = {
			proposal_id: 'proposal-1',
			proposal_path: proposalPath,
			target_note: '01_knowledge/wiki/new-note.md',
			touched_notes: [proposalPath],
			writeback_preview: 'preview',
			writeback_effect: 'create_wiki_note',
			confirmation_token: 'opaque-confirmation-token',
			confirmation_expires_at: '2026-07-30T00:01:00.000Z',
		};
		const modal = new ApprovedWritebackApplyModal({}, plugin, makeProposalRecord(), () => {
			onAppliedCalled = true;
		});
		modal.renderReady(preview);
		const intro = findElement(
			modal.contentEl,
			(element) => typeof element.text === 'string' && (
				element.text.includes('新建为知识笔记')
					|| element.text.includes('knowledge note content')
			)
		);
		assert.ok(intro);
		const confirm = findElement(modal.contentEl, (element) => element.text === 'Confirm knowledge note creation');
		assert.ok(confirm);
		confirm.handlers.click();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(onAppliedCalled, true);
		assert.match(globalThis.__tracekeeperReviewNotices.join('|'), /Knowledge note created/);
	});

	test('edit modal shows friendly target labels without exposing target paths', () => {
		const candidatePath = '01_knowledge/wiki/technical-target-path.md';
		const context = {
			target: {
				path: candidatePath,
				title: 'Readable target title',
				exists: true,
				allowed: true,
				excerpt: 'Readable target context.',
			},
			targetCandidates: [{
				path: candidatePath,
				title: 'Readable target title',
				kind: 'wiki',
				reason: 'current',
				excerpt: 'Readable target context.',
			}],
		};
		const modal = new ReviewQueueEditProposalModal(
			{},
			{},
			makeProposalRecord({ targetNote: candidatePath }),
			context,
			() => {}
		);
		modal.onOpen();
		const visibleText = collectElementText(modal.contentEl);
		assert.match(visibleText, /Readable target title/);
		assert.match(visibleText, /Knowledge note · Current target/);
		assert.equal(visibleText.includes(candidatePath), false);

		const unavailableModal = new ReviewQueueEditProposalModal(
			{},
			{},
			makeProposalRecord({ targetNote: candidatePath }),
			{
				...context,
				target: { ...context.target, exists: false },
				targetCandidates: [],
			},
			() => {}
		);
		unavailableModal.onOpen();
		assert.equal(collectElementText(unavailableModal.contentEl).includes(candidatePath), false);
	});

	test('archive modal keeps exact paths in technical details and commits the displayed preview', async () => {
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
		const technicalDetails = findElement(modal.contentEl, (element) => element.tag === 'details');
		assert.ok(technicalDetails);
		assert.equal(technicalDetails.open, false);
		const ordinaryArchiveText = collectElementText(modal.contentEl, { skipDetails: true });
		assert.equal(ordinaryArchiveText.includes(proposalPath), false);
		assert.equal(ordinaryArchiveText.includes('proposal-1'), false);
		assert.equal(ordinaryArchiveText.includes('00_tracekeeper/work/tasks/task-1.md'), false);
		const exactPath = findElement(
			technicalDetails,
			(element) => element.text ===
				`${proposalPath} → 02_archive/review_queue/proposal.md`
		);
		const managedPath = findElement(
			technicalDetails,
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
			proposalFields: {
				writeback_effect: 'append',
			},
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
		const save = findElement(modal.contentEl, (element) => element.text === 'Save changes');
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

	test('review queue uses single-pane navigation, five-item pages, and collapsed technical details', async () => {
		const proposals = Array.from({ length: 7 }, (_, index) => {
			const ordinal = index + 1;
			return makeProposalRecord({
				path: `00_tracekeeper/inbox/review_queue/technical-record-${ordinal}.md`,
				proposalId: `technical-record-id-${ordinal}`,
				proposalKind: ordinal === 2 ? 'task_decision' : 'memory',
				relatedProject: `Project ${ordinal}`,
				taskId: `technical-task-id-${ordinal}`,
				targetNote: `01_knowledge/wiki/technical-target-${ordinal}.md`,
				claimKey: `technical-claim-${ordinal}`,
				evidence: [`00_tracekeeper/evidence/technical-evidence-${ordinal}.md`],
				relatedSources: [`01_knowledge/sources/technical-source-${ordinal}.md`],
				supersedes: [`technical-memory-id-${ordinal}`],
				approvalStatus: 'rejected',
				writebackContent: `# Hidden heading\n\nReadable summary ${ordinal}`,
				sortTimestamp: Date.parse(`2026-07-${String(30 - index).padStart(2, '0')}T00:00:00.000Z`),
			});
		});
		const contexts = Object.fromEntries(proposals.map((proposal, index) => [
			proposal.path,
			{
				proposalPath: proposal.path,
				indexState: 'ready',
				target: {
					path: proposal.targetNote,
					title: `Readable target ${index + 1}`,
					exists: true,
					allowed: true,
					excerpt: '',
				},
				targetCandidates: [],
				task: null,
				sources: [],
				priorMemory: index === 1
					? [{
						path: '01_knowledge/memory/technical-prior-path-2.md',
						memoryId: 'technical-prior-memory-id-2',
						authority: 'agent',
						confidence: 'supported',
						effectiveState: 'current',
						observedAt: '',
						excerpt: '',
					}]
					: [],
				diffPreview: '',
			},
		]));
		const snapshot = {
			proposals,
			totalProposalCount: proposals.length,
			windowOffset: 0,
			windowLimit: 250,
			isTruncated: false,
			contexts,
			indexState: 'ready',
			missingReviewQueueFolder: false,
			updatedAt: '2026-07-30T00:00:00.000Z',
		};
		const app = {
			vault: {
				getAbstractFileByPath() {
					return null;
				},
			},
			workspace: {
				getLeaf() {
					return { openFile: async () => {} };
				},
			},
		};
		const plugin = {
			formatDisplayTime(value) {
				return new Date(value).toISOString();
			},
			formatRiskLabel(value) {
				return value;
			},
		};
		const view = new TracekeeperReviewQueueView({ app }, plugin);
		view.activeFilter = 'all';

		await view.render(snapshot);
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'tracekeeper-review-inbox__row')).length, 5);
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'is-selected')).length, 0);
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'tracekeeper-review-inbox__list')).length, 1);
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'tracekeeper-review-inbox__detail')).length, 0);
		assert.match(collectElementText(view.contentEl), /Page 1 of 2 · 1–5 of 7/);

		const initialRows = findElements(view.contentEl, (element) => elementHasClass(element, 'tracekeeper-review-inbox__row'));
		initialRows[1].handlers.click();
		await Promise.resolve();
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'tracekeeper-review-inbox__list')).length, 0);
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'tracekeeper-review-inbox__detail')).length, 1);
		assert.match(collectElementText(view.contentEl), /Reviewing 2 of 7/);
		assert.match(collectElementText(view.contentEl), /Save task decision/);

		const technicalDetails = findElement(view.contentEl, (element) => element.tag === 'details');
		assert.ok(technicalDetails);
		assert.equal(technicalDetails.open, false);
		assert.match(collectElementText(technicalDetails), /Technical details/);
		const ordinaryDetailText = collectElementText(view.contentEl, { skipDetails: true });
		for (const hiddenValue of [
			'00_tracekeeper/inbox/review_queue/technical-record-2.md',
			'technical-record-id-2',
			'01_knowledge/wiki/technical-target-2.md',
			'technical-task-id-2',
			'technical-claim-2',
			'01_knowledge/sources/technical-source-2.md',
			'technical-prior-memory-id-2',
		]) {
			assert.equal(ordinaryDetailText.includes(hiddenValue), false, `${hiddenValue} must stay inside Technical details`);
			assert.equal(collectElementText(technicalDetails).includes(hiddenValue), true, `${hiddenValue} must remain available in Technical details`);
		}

		const back = findElement(view.contentEl, (element) => element.text === '← Back to review list');
		assert.ok(back);
		back.handlers.click();
		await Promise.resolve();
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'tracekeeper-review-inbox__list')).length, 1);
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'tracekeeper-review-inbox__detail')).length, 0);
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'is-selected')).length, 1);
		assert.match(collectElementText(view.contentEl), /Last viewed/);

		const next = findElement(view.contentEl, (element) => element.text === 'Next');
		assert.ok(next);
		next.handlers.click();
		await Promise.resolve();
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'tracekeeper-review-inbox__row')).length, 2);
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'is-selected')).length, 0);
		assert.match(collectElementText(view.contentEl), /Page 2 of 2 · 6–7 of 7/);

		const batchActions = findElement(view.contentEl, (element) => element.text === 'Batch actions');
		assert.ok(batchActions);
		batchActions.handlers.click();
		await Promise.resolve();
		const batchRows = findElements(view.contentEl, (element) => elementHasClass(element, 'tracekeeper-review-inbox__row'));
		assert.equal(batchRows.length, 2);
		assert.equal(batchRows.every((row) => row.tag === 'label'), true);
		assert.equal(batchRows.some((row) => findElement(row, (element) => element.tag === 'button')), false);
		const firstCheckbox = findElement(batchRows[0], (element) => element.tag === 'input');
		assert.ok(firstCheckbox);
		assert.match(firstCheckbox.attributes['aria-label'], /Select knowledge change:/);
		firstCheckbox.checked = true;
		firstCheckbox.handlers.change();
		await Promise.resolve();
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'is-checked')).length, 1);
		assert.match(collectElementText(view.contentEl), /Selected/);
	});

	test('rejecting a detail moves it into processed review without losing its position', async () => {
		const proposal = makeProposalRecord({
			approvalStatus: 'pending',
			writebackContent: 'Readable change',
			targetNote: '01_knowledge/wiki/review-target.md',
		});
		const snapshot = {
			proposals: [proposal],
			totalProposalCount: 1,
			windowOffset: 0,
			windowLimit: 250,
			isTruncated: false,
			contexts: {
				[proposal.path]: {
					proposalPath: proposal.path,
					indexState: 'ready',
					target: {
						path: proposal.targetNote,
						title: 'Review target',
						exists: true,
						allowed: true,
						excerpt: '',
					},
					targetCandidates: [],
					task: null,
					sources: [],
					priorMemory: [],
					diffPreview: 'Readable change',
				},
			},
			indexState: 'ready',
			missingReviewQueueFolder: false,
			updatedAt: '2026-07-30T00:00:00.000Z',
		};
		const plugin = {
			async loadMemoryReviewQueueSnapshot() {
				return snapshot;
			},
			async updateMemoryProposalStatus(_proposal, status) {
				proposal.approvalStatus = status;
			},
			formatDisplayTime(value) {
				return new Date(value).toISOString();
			},
			formatRiskLabel(value) {
				return value;
			},
		};
		const view = new TracekeeperReviewQueueView({ app: { vault: { getAbstractFileByPath: () => null } } }, plugin);
		view.activeFilter = 'needs_review';
		await view.render(snapshot);
		const row = findElement(view.contentEl, (element) => elementHasClass(element, 'tracekeeper-review-inbox__row'));
		assert.ok(row);
		row.handlers.click();
		await Promise.resolve();
		const reject = findElement(view.contentEl, (element) => element.text === 'Do not accept');
		assert.ok(reject);
		reject.handlers.click();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(view.activeFilter, 'history');
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'tracekeeper-review-inbox__detail')).length, 1);
		assert.match(collectElementText(view.contentEl), /Reviewing 1 of 1/);
		const back = findElement(view.contentEl, (element) => element.text === '← Back to review list');
		assert.ok(back);
		back.handlers.click();
		await Promise.resolve();
		assert.equal(findElements(view.contentEl, (element) => elementHasClass(element, 'is-selected')).length, 1);

		proposal.approvalStatus = 'revision_requested';
		await view.refreshSelectedProposal(proposal.path);
		assert.equal(view.activeFilter, 'awaiting_revision');
		assert.match(collectElementText(view.contentEl), /Reviewing 1 of 1/);

		proposal.approvalStatus = 'pending';
		proposal.writebackContent = '';
		await view.refreshSelectedProposal(proposal.path);
		assert.equal(view.activeFilter, 'needs_completion');
		assert.match(collectElementText(view.contentEl), /Reviewing 1 of 1/);
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
