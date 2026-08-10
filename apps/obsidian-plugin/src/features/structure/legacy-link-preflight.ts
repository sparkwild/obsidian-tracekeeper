import { TFolder, type App, type TFile } from 'obsidian';
import { hashVaultContent, type KnowledgeSnapshot } from '@tracekeeper/core';

const LEGACY_LINK_PROBE_ROOT = '00_tracekeeper/control/operations/legacy-link-probes';
const DEFAULT_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 25;

export type LegacyLinkPreflightStatus = 'not_required' | 'passed' | 'blocked';

export type LegacyLinkPreflightReason =
	| 'no_inbound_links'
	| 'probe_path_exists'
	| 'probe_creation_failed'
	| 'original_edge_timeout'
	| 'rename_failed'
	| 'moved_edge_timeout'
	| 'cleanup_partial_failure';

export type LegacyLinkCleanupStatus = 'not_started' | 'complete' | 'partial';

export interface LegacyLinkPreflightEvidence {
	probeId: string | null;
	beforeGeneration: number | null;
	afterGeneration: number | null;
	cleanupStatus: LegacyLinkCleanupStatus;
}

export interface LegacyLinkPreflightInput {
	migrationId: string;
	inboundLinkCount: number;
	timeoutMs?: number;
}

export interface LegacyLinkPreflightHost {
	ensureFolderExists(path: string): Promise<void>;
	loadKnowledgeSnapshot(): Promise<KnowledgeSnapshot>;
}

export interface LegacyLinkPreflightNotRequiredResult {
	status: 'not_required';
	reason: 'no_inbound_links';
	inboundLinkCount: number;
	evidence: LegacyLinkPreflightEvidence;
}

export interface LegacyLinkPreflightPassedResult {
	status: 'passed';
	reason: 'resolved_after_rename';
	inboundLinkCount: number;
	evidence: LegacyLinkPreflightEvidence;
}

export interface LegacyLinkPreflightBlockedResult {
	status: 'blocked';
	reason: LegacyLinkPreflightReason;
	inboundLinkCount: number;
	evidence: LegacyLinkPreflightEvidence;
}

export type LegacyLinkPreflightResult =
	| LegacyLinkPreflightNotRequiredResult
	| LegacyLinkPreflightPassedResult
	| LegacyLinkPreflightBlockedResult;

interface LegacyLinkProbePaths {
	root: string;
	folder: string;
	sourcePath: string;
	targetPath: string;
	movedTargetPath: string;
	probeId: string;
}

class LegacyLinkProbePathConflictError extends Error {
	constructor() {
		super('Legacy link probe path already exists.');
		this.name = 'LegacyLinkProbePathConflictError';
	}
}

export async function runLegacyLinkPreflight(
	app: App,
	host: LegacyLinkPreflightHost,
	input: LegacyLinkPreflightInput
): Promise<LegacyLinkPreflightResult> {
	if (input.inboundLinkCount <= 0) {
		return {
			status: 'not_required',
			reason: 'no_inbound_links',
			inboundLinkCount: input.inboundLinkCount,
			evidence: {
				probeId: null,
				beforeGeneration: null,
				afterGeneration: null,
				cleanupStatus: 'not_started',
			},
		};
	}

	const probePaths = buildLegacyLinkProbePaths(input);

	let beforeGeneration: number | null = null;
	let afterGeneration: number | null = null;
	let cleanupStatus: LegacyLinkCleanupStatus = 'not_started';
	let result: LegacyLinkPreflightResult = {
		status: 'blocked',
		reason: 'probe_creation_failed',
		inboundLinkCount: input.inboundLinkCount,
		evidence: {
			probeId: probePaths.probeId,
			beforeGeneration,
			afterGeneration,
			cleanupStatus,
		},
	};
	const createdFiles: TFile[] = [];
	let ownsProbeFolder = false;

	try {
		await host.ensureFolderExists(probePaths.root);
		assertProbePathsAreClear(app, probePaths);
		try {
			await app.vault.createFolder(probePaths.folder);
			ownsProbeFolder = true;
		} catch (error) {
			if (app.vault.getAbstractFileByPath(probePaths.folder)) {
				throw new LegacyLinkProbePathConflictError();
			}
			throw error;
		}

		const latestSnapshot = await host.loadKnowledgeSnapshot();
		beforeGeneration = latestSnapshot.generation;

		const targetFile = await app.vault.create(
			probePaths.targetPath,
			buildProbeContent('target', input.migrationId)
		);
		createdFiles.push(targetFile);

		const sourceFile = await app.vault.create(
			probePaths.sourcePath,
			buildProbeContent(
				'source',
				input.migrationId,
				app.fileManager.generateMarkdownLink(targetFile, probePaths.sourcePath)
			)
		);
		createdFiles.push(sourceFile);

		const originalEdgeSnapshot = await waitForProbeEdge(
			host,
			probePaths.sourcePath,
			probePaths.targetPath,
			input.timeoutMs
		);
		if (!originalEdgeSnapshot) {
			result = {
				status: 'blocked',
				reason: 'original_edge_timeout',
				inboundLinkCount: input.inboundLinkCount,
				evidence: {
					probeId: probePaths.probeId,
					beforeGeneration,
					afterGeneration,
					cleanupStatus,
				},
			};
		} else {
			afterGeneration = originalEdgeSnapshot.generation;
			try {
				await app.fileManager.renameFile(targetFile, probePaths.movedTargetPath);
			} catch {
				result = {
					status: 'blocked',
					reason: 'rename_failed',
					inboundLinkCount: input.inboundLinkCount,
					evidence: {
						probeId: probePaths.probeId,
						beforeGeneration,
						afterGeneration,
						cleanupStatus,
					},
				};
			}
			if (result.reason !== 'rename_failed' && result.reason !== 'original_edge_timeout') {
				const movedEdgeSnapshot = await waitForProbeEdge(
					host,
					probePaths.sourcePath,
					probePaths.movedTargetPath,
					input.timeoutMs
				);
				if (!movedEdgeSnapshot) {
					result = {
						status: 'blocked',
						reason: 'moved_edge_timeout',
						inboundLinkCount: input.inboundLinkCount,
						evidence: {
							probeId: probePaths.probeId,
							beforeGeneration,
							afterGeneration,
							cleanupStatus,
						},
					};
				} else {
					afterGeneration = movedEdgeSnapshot.generation;
					result = {
						status: 'passed',
						reason: 'resolved_after_rename',
						inboundLinkCount: input.inboundLinkCount,
						evidence: {
							probeId: probePaths.probeId,
							beforeGeneration,
							afterGeneration,
							cleanupStatus,
						},
					};
				}
			}
		}
	} catch (error) {
		result = {
			status: 'blocked',
			reason: error instanceof LegacyLinkProbePathConflictError
				? 'probe_path_exists'
				: 'probe_creation_failed',
			inboundLinkCount: input.inboundLinkCount,
			evidence: {
				probeId: probePaths.probeId,
				beforeGeneration,
				afterGeneration,
				cleanupStatus,
			},
		};
	} finally {
		const cleanup = await cleanupLegacyLinkProbeArtifacts(
			app,
			ownsProbeFolder ? probePaths.folder : null,
			createdFiles
		);
		cleanupStatus = cleanup;
		if (cleanup === 'partial') {
			result = {
				status: 'blocked',
				reason: 'cleanup_partial_failure',
				inboundLinkCount: input.inboundLinkCount,
				evidence: {
					probeId: probePaths.probeId,
					beforeGeneration,
					afterGeneration,
					cleanupStatus,
				},
			};
		}
	}

	return {
		...result,
		evidence: {
			...result.evidence,
			cleanupStatus,
		},
	};
}

function buildLegacyLinkProbePaths(input: LegacyLinkPreflightInput): LegacyLinkProbePaths {
	const probeId = hashVaultContent(`${input.migrationId}|${input.inboundLinkCount}|legacy-link-preflight`).slice(0, 16);
	const folder = `${LEGACY_LINK_PROBE_ROOT}/${probeId}`;
	return {
		root: LEGACY_LINK_PROBE_ROOT,
		folder,
		sourcePath: `${folder}/source.md`,
		targetPath: `${folder}/target.md`,
		movedTargetPath: `${folder}/target-moved.md`,
		probeId,
	};
}

function assertProbePathsAreClear(app: App, paths: LegacyLinkProbePaths): void {
	for (const path of [paths.folder, paths.sourcePath, paths.targetPath, paths.movedTargetPath]) {
		if (app.vault.getAbstractFileByPath(path)) {
			throw new LegacyLinkProbePathConflictError();
		}
	}
}

async function waitForProbeEdge(
	host: LegacyLinkPreflightHost,
	sourcePath: string,
	targetPath: string,
	timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<KnowledgeSnapshot | null> {
	const deadline = Date.now() + timeoutMs;
	let latest: KnowledgeSnapshot | null = null;
	while (Date.now() <= deadline) {
		latest = await host.loadKnowledgeSnapshot();
		const outgoing = latest.graph.outgoing.get(sourcePath) ?? [];
		if (outgoing.length === 1 && outgoing[0] === targetPath) {
			return latest;
		}
		await sleep(POLL_INTERVAL_MS);
	}
	return null;
}

async function cleanupLegacyLinkProbeArtifacts(
	app: App,
	probeFolderPath: string | null,
	files: readonly TFile[]
): Promise<LegacyLinkCleanupStatus> {
	const uniqueFiles = [...new Set(files)].reverse();
	let failed = false;
	for (const file of uniqueFiles) {
		try {
			await app.fileManager.trashFile(file);
		} catch {
			failed = true;
		}
	}
	const probeFolder = probeFolderPath
		? app.vault.getAbstractFileByPath(probeFolderPath)
		: null;
	if (probeFolder instanceof TFolder) {
		if (probeFolder.children.length > 0) {
			failed = true;
		} else {
			try {
				await app.fileManager.trashFile(probeFolder);
			} catch {
				failed = true;
			}
		}
	} else if (probeFolder) {
		failed = true;
	}
	return failed ? 'partial' : 'complete';
}

function buildProbeContent(kind: 'source' | 'target', migrationId: string, linkText = ''): string {
	if (kind === 'target') {
		return [
			'# Legacy link probe target',
			'',
			`- probe: ${migrationId}`,
			'',
		].join('\n');
	}
	return [
		'# Legacy link probe source',
		'',
		`- probe: ${migrationId}`,
		'',
		linkText,
		'',
	].join('\n');
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});
}
