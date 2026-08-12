import {
	BASE_STRUCTURE_DIRECTORIES,
	REQUIRED_CONTROL_FILES,
	REQUIRED_KNOWLEDGE_FILES,
	TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH,
	validateAgentActivityHubMarkdown,
} from '@tracekeeper/core';

export const BASE_STRUCTURE_FILE_PATHS = [
	...REQUIRED_CONTROL_FILES,
	...REQUIRED_KNOWLEDGE_FILES,
] as const;

export type BaseStructureEntryKind = 'missing' | 'file' | 'folder' | 'other';

export interface BaseStructurePathInspection {
	kind: BaseStructureEntryKind;
	content?: string;
}

export interface MemoryInitializationPlan {
	foldersToCreate: string[];
	filesToCreate: string[];
	invalidFolders: string[];
	invalidFiles: string[];
	invalidFileContents: string[];
	missingAgentActivityHub: boolean;
}

interface BaseStructurePlanSummary {
	foldersToCreate: readonly string[];
	filesToCreate: readonly string[];
	invalidFolders?: readonly string[];
	invalidFiles?: readonly string[];
	invalidFileContents?: readonly string[];
}

export async function buildBaseStructurePlan(
	inspect: (
		path: string,
		options: { readContent: boolean }
	) => Promise<BaseStructurePathInspection>
): Promise<MemoryInitializationPlan> {
	const foldersToCreate: string[] = [];
	const filesToCreate: string[] = [];
	const invalidFolders: string[] = [];
	const invalidFiles: string[] = [];
	const invalidFileContents: string[] = [];

	for (const folderPath of BASE_STRUCTURE_DIRECTORIES) {
		const entry = await inspect(folderPath, { readContent: false });
		if (entry.kind === 'missing') {
			foldersToCreate.push(folderPath);
		} else if (entry.kind !== 'folder') {
			invalidFolders.push(folderPath);
		}
	}

	for (const filePath of BASE_STRUCTURE_FILE_PATHS) {
		const isAgentActivityHub = filePath === TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH;
		const entry = await inspect(filePath, { readContent: isAgentActivityHub });
		if (entry.kind === 'missing') {
			filesToCreate.push(filePath);
		} else if (entry.kind !== 'file') {
			invalidFiles.push(filePath);
		} else if (
			isAgentActivityHub
			&& !validateAgentActivityHubMarkdown(entry.content ?? '')
		) {
			invalidFileContents.push(filePath);
		}
	}

	return {
		foldersToCreate,
		filesToCreate,
		invalidFolders,
		invalidFiles,
		invalidFileContents,
		missingAgentActivityHub: filesToCreate.includes(
			TRACEKEEPER_AGENT_ACTIVITY_INDEX_PATH
		),
	};
}

export function invalidBaseStructurePaths(
	plan: BaseStructurePlanSummary
): string[] {
	return [...new Set([
		...(plan.invalidFolders ?? []),
		...(plan.invalidFiles ?? []),
		...(plan.invalidFileContents ?? []),
	])];
}

export function isBaseStructurePlanReady(
	plan: BaseStructurePlanSummary
): boolean {
	return plan.foldersToCreate.length === 0
		&& plan.filesToCreate.length === 0
		&& invalidBaseStructurePaths(plan).length === 0;
}
