import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	OperationConflictError,
	parseMarkdown,
	type VaultRepository,
} from '@tracekeeper/core';

import {
	appendAuditEvent,
	appendAuditEventAsync,
	type AuditEventInput,
} from './audit-persistence';
import {
	assertNoSymlinkSegments,
	normalizeNotePath,
	relativeFromAbsolute,
	resolveSafeWritableNotePath,
	ToolInputError,
} from '../safety';

export interface VaultRecordAdapterContext {
	vaultConfigDir?: string;
	vaultRepository?: VaultRepository;
}

export interface VaultRecordWriteResult {
	path: string;
	activity_path: string;
	status: string;
	warnings: string[];
}

export interface VaultRecordAdapterDependencies {
	agentActivityPath: string;
	buildMarkdownNote(frontmatter: Record<string, unknown>, body: string): string;
}

function pathOptions(context: VaultRecordAdapterContext): { vaultConfigDir?: string } {
	return { vaultConfigDir: context.vaultConfigDir };
}

function stripYamlQuotes(value: string): string {
	if (value.length >= 2) {
		const first = value[0];
		const last = value[value.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return value.slice(1, -1);
		}
	}
	return value;
}

function frontmatterString(frontmatter: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const value = frontmatter[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
		if (typeof value === 'number' || typeof value === 'boolean') {
			return String(value);
		}
	}
	return '';
}

export class VaultRecordAdapter {
	private readonly dependencies: VaultRecordAdapterDependencies;

	constructor(dependencies: VaultRecordAdapterDependencies) {
		this.dependencies = dependencies;
	}

	buildAndWriteNote(
		vaultRoot: string,
		toolName: string,
		allowedDir: string,
		filename: string,
		frontmatter: Record<string, unknown>,
		body: string,
		taskId: string | null,
		context: VaultRecordAdapterContext,
		metadata: Record<string, unknown> = {},
		operationId = ''
	): VaultRecordWriteResult {
		const options = pathOptions(context);
		const safeLeaf = normalizeNotePath(filename, options);
		const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
		const targetPath = `${allowedDir}/${normalized}`;
		const resolved = resolveSafeWritableNotePath(vaultRoot, targetPath, allowedDir, options);
		fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });
		if (fs.existsSync(resolved.absolutePath)) {
			throw new ToolInputError(`Target already exists: ${resolved.relativePath}`);
		}

		const markdown = this.dependencies.buildMarkdownNote(frontmatter, body);
		fs.writeFileSync(resolved.absolutePath, markdown, 'utf8');

		const audit = appendAuditEvent(vaultRoot, {
			operationId,
			tool: toolName,
			targetPath: resolved.relativePath,
			status: 'written',
			taskId,
			metadata,
		});

		return {
			path: resolved.relativePath,
			activity_path: audit.path,
			status: 'written',
			warnings: [],
		};
	}

	async buildAndWriteNoteAsync(
		vaultRoot: string,
		toolName: string,
		allowedDir: string,
		filename: string,
		frontmatter: Record<string, unknown>,
		body: string,
		taskId: string | null,
		context: VaultRecordAdapterContext,
		metadata: Record<string, unknown> = {},
		operationId = ''
	): Promise<VaultRecordWriteResult> {
		const options = pathOptions(context);
		const safeLeaf = normalizeNotePath(filename, options);
		const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
		const targetPath = `${allowedDir}/${normalized}`;
		const markdown = this.dependencies.buildMarkdownNote(frontmatter, body);

		if (!context.vaultRepository) {
			return this.buildAndWriteNote(
				vaultRoot,
				toolName,
				allowedDir,
				filename,
				frontmatter,
				body,
				taskId,
				context,
				metadata,
				operationId
			);
		}

		try {
			await context.vaultRepository.createText(targetPath, markdown);
		} catch (error) {
			if (error instanceof Error && error.message.includes('Target already exists')) {
				throw new ToolInputError(`Target already exists: ${targetPath}`);
			}
			throw error;
		}

		const audit = await appendAuditEventAsync(vaultRoot, {
			operationId,
			tool: toolName,
			targetPath,
			status: 'written',
			taskId,
			metadata,
		}, context);

		return {
			path: targetPath,
			activity_path: audit.path,
			status: 'written',
			warnings: [],
		};
	}

	findOperationOwnedNote(
		vaultRoot: string,
		allowedDir: string,
		filename: string,
		operationField: string,
		operationId: string,
		context: VaultRecordAdapterContext
	): VaultRecordWriteResult | null {
		const safeLeaf = normalizeNotePath(filename, pathOptions(context));
		const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
		const relativePath = `${allowedDir}/${normalized}`;
		const absolutePath = path.resolve(vaultRoot, relativePath);
		relativeFromAbsolute(vaultRoot, absolutePath);
		assertNoSymlinkSegments(vaultRoot, absolutePath);
		if (!fs.existsSync(absolutePath)) {
			return null;
		}
		const parsed = parseMarkdown(fs.readFileSync(absolutePath, 'utf8'));
		const existingOperationId = stripYamlQuotes(
			frontmatterString(parsed.frontmatter.fields, [operationField])
		);
		if (existingOperationId !== operationId) {
			throw new OperationConflictError(`Note path is already owned by another operation: ${relativePath}`);
		}
		return {
			path: relativePath,
			activity_path: this.dependencies.agentActivityPath,
			status: 'skipped',
			warnings: [],
		};
	}

	async findOperationOwnedNoteAsync(
		vaultRoot: string,
		allowedDir: string,
		filename: string,
		operationField: string,
		operationId: string,
		context: VaultRecordAdapterContext
	): Promise<VaultRecordWriteResult | null> {
		const safeLeaf = normalizeNotePath(filename, pathOptions(context));
		const normalized = safeLeaf.endsWith('.md') ? safeLeaf : `${safeLeaf}.md`;
		const relativePath = `${allowedDir}/${normalized}`;

		if (context.vaultRepository) {
			const repositoryFile = await context.vaultRepository.readText(relativePath);
			if (!repositoryFile) {
				return null;
			}
			const parsed = parseMarkdown(repositoryFile.content);
			const existingOperationId = stripYamlQuotes(
				frontmatterString(parsed.frontmatter.fields, [operationField])
			);
			if (existingOperationId !== operationId) {
				throw new OperationConflictError(`Note path is already owned by another operation: ${relativePath}`);
			}
			return {
				path: relativePath,
				activity_path: this.dependencies.agentActivityPath,
				status: 'skipped',
				warnings: [],
			};
		}

		return this.findOperationOwnedNote(
			vaultRoot,
			allowedDir,
			filename,
			operationField,
			operationId,
			context
		);
	}
}

export type { AuditEventInput };
