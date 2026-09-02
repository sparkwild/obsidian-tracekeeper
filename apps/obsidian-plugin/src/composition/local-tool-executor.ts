import {
	callTool,
	previewObsidianWikiBatchWriteback,
	type ObsidianWikiBatchWritebackPreview,
	type ProposalTransitionPort,
	type ToolInvocationContext,
} from '@tracekeeper/mcp-runtime';
import { randomUUID } from 'node:crypto';
import type { KnowledgeReadView, ScanResult, VaultRepository } from '@tracekeeper/core';

export type RuntimeContentLanguage = 'zh-CN' | 'en';
export type RuntimeContentLanguageSource = 'setting' | 'obsidian' | 'navigator' | 'fallback';

export interface LocalToolExecutorContext {
	defaultVaultRoot: string;
	vaultConfigDir: string;
	vaultRepository: VaultRepository;
	proposalTransitionPort: ProposalTransitionPort;
	knowledgeSnapshotProvider: (requestedVaultRoot: string) => ScanResult | null;
	knowledgeReadViewProvider: (requestedVaultRoot: string) => Promise<KnowledgeReadView | null>;
	graphProfile: string;
	memoryRules: {
		globalMemoryRule: string;
		projectMemoryRule: string;
		wikiChangeRule: string;
		taskTrackingEnabled: boolean;
	};
	contentLanguage: RuntimeContentLanguage;
	contentLanguageSource: RuntimeContentLanguageSource;
}

export interface LocalToolExecutorOptions {
	getContext: () => LocalToolExecutorContext;
	runtimeVersion?: string;
}

export type LocalToolExecutionOptions = Pick<
	ToolInvocationContext,
	'wikiBatchWritebackOverride' | 'writebackRecoveryOperationId'
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const errorToString = (value: unknown, fallback = 'Unknown error'): string => {
	if (typeof value === 'string') {
		return value.trim();
	}
	if (value instanceof Error) {
		return value.message.trim();
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (value === null || value === undefined) {
		return '';
	}
	if (isRecord(value)) {
		if (typeof value.message === 'string' && value.message.trim()) {
			return value.message.trim();
		}
		if (typeof value.error === 'string' && value.error.trim()) {
			return value.error.trim();
		}
	}
	try {
		return JSON.stringify(value) ?? fallback;
	} catch {
		return fallback;
	}
};

export class LocalToolExecutor {
	private readonly runtimeVersion: string;
	private readonly sessionId = randomUUID();

	constructor(private readonly options: LocalToolExecutorOptions) {
		this.runtimeVersion = options.runtimeVersion?.trim() || '0.4.5';
	}

	async executeLocalTool(
		name: string,
		args: Record<string, unknown>,
		options: LocalToolExecutionOptions = {}
	): Promise<Record<string, unknown>> {
		const context = this.options.getContext();
		const result = await callTool(name, args, {
			defaultVaultRoot: context.defaultVaultRoot,
			vaultConfigDir: context.vaultConfigDir,
			vaultRepository: context.vaultRepository,
			proposalTransitionPort: context.proposalTransitionPort,
			knowledgeSnapshotProvider: context.knowledgeSnapshotProvider,
			knowledgeReadViewProvider: context.knowledgeReadViewProvider,
			graphProfile: context.graphProfile,
			memoryRules: context.memoryRules,
			contentLanguage: context.contentLanguage,
			contentLanguageSource: context.contentLanguageSource,
			principalId: 'obsidian-plugin-ui',
			credentialCapabilities: ['*'],
			agentId: 'tracekeeper-plugin-ui',
			sessionId: this.sessionId,
			clientName: 'tracekeeper-plugin-ui',
			transport: 'obsidian-direct',
			runtimeVersion: this.runtimeVersion,
			...options,
		});

		const structured = result.structuredContent;
		if (!isRecord(structured)) {
			throw new Error(`${name} returned an invalid result.`);
		}
		if (result.isError || structured.ok === false) {
			throw new Error(errorToString(structured.error, `${name} failed.`));
		}
		return structured;
	}

	async previewWikiBatchApprovedWriteback(
		args: Record<string, unknown>,
		override: NonNullable<LocalToolExecutionOptions['wikiBatchWritebackOverride']>
	): Promise<ObsidianWikiBatchWritebackPreview> {
		const context = this.options.getContext();
		return previewObsidianWikiBatchWriteback(args, {
			defaultVaultRoot: context.defaultVaultRoot,
			vaultConfigDir: context.vaultConfigDir,
			vaultRepository: context.vaultRepository,
			proposalTransitionPort: context.proposalTransitionPort,
			knowledgeSnapshotProvider: context.knowledgeSnapshotProvider,
			knowledgeReadViewProvider: context.knowledgeReadViewProvider,
			graphProfile: context.graphProfile,
			memoryRules: context.memoryRules,
			contentLanguage: context.contentLanguage,
			contentLanguageSource: context.contentLanguageSource,
			principalId: 'obsidian-plugin-ui',
			credentialCapabilities: ['*'],
			agentId: 'tracekeeper-plugin-ui',
			sessionId: this.sessionId,
			clientName: 'tracekeeper-plugin-ui',
			transport: 'obsidian-direct',
			runtimeVersion: this.runtimeVersion,
			wikiBatchWritebackOverride: override,
		});
	}
}
