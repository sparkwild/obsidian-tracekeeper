export type SkillActivationMode = 'automatic_with_restart_fallback' | 'restart_required';

export interface ClientSkillDirectoryRecommendation {
	skillsRootDirectory: string;
	source: 'official_documentation';
	documentationUrl: string;
}

interface ClientSkillTargetDescriptor {
	clientId: string;
	targetId: string;
	displayName: string;
	recommendationPath?: readonly string[];
	documentationUrl?: string;
	legacyDirectoryPaths?: readonly (readonly string[])[];
	restartRequired: boolean;
	activationMode: SkillActivationMode;
	profileLabel: string;
}

export interface ClientSkillTargetProfile {
	targetId: string;
	displayName: string;
	recommendation: ClientSkillDirectoryRecommendation | null;
	legacyTargetDirectories: readonly string[];
	restartRequired: boolean;
	activationMode: SkillActivationMode;
	profileLabel: string;
}

const CLIENT_SKILL_TARGETS: readonly ClientSkillTargetDescriptor[] = [
	{
		clientId: 'codex',
		targetId: 'codex-user',
		displayName: 'Codex',
		recommendationPath: ['.agents', 'skills'],
		documentationUrl: 'https://developers.openai.com/codex/skills/',
		legacyDirectoryPaths: [['.codex', 'skills']],
		restartRequired: false,
		activationMode: 'automatic_with_restart_fallback',
		profileLabel: '官方目录建议',
	},
	{
		clientId: 'claude-code',
		targetId: 'claude-code-user',
		displayName: 'Claude Code',
		recommendationPath: ['.claude', 'skills'],
		documentationUrl: 'https://code.claude.com/docs/en/skills',
		restartRequired: false,
		activationMode: 'automatic_with_restart_fallback',
		profileLabel: '官方目录建议',
	},
	{
		clientId: 'claude-desktop',
		targetId: 'claude-desktop-user',
		displayName: 'Claude Desktop',
		restartRequired: true,
		activationMode: 'restart_required',
		profileLabel: '用户选择目录',
	},
	{
		clientId: 'cursor',
		targetId: 'cursor-user',
		displayName: 'Cursor',
		restartRequired: true,
		activationMode: 'restart_required',
		profileLabel: '用户选择目录',
	},
	{
		clientId: 'gemini',
		targetId: 'gemini-user',
		displayName: 'Gemini CLI',
		recommendationPath: ['.gemini', 'skills'],
		documentationUrl: 'https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/tools.md',
		restartRequired: true,
		activationMode: 'restart_required',
		profileLabel: '官方目录建议',
	},
	{
		clientId: 'grok',
		targetId: 'grok-user',
		legacyDirectoryPaths: [['.grok', 'skills']],
		displayName: 'Grok Build',
		restartRequired: true,
		activationMode: 'restart_required',
		profileLabel: '用户选择目录',
	},
	{
		clientId: 'zcode',
		targetId: 'zcode-user',
		legacyDirectoryPaths: [['.zcode', 'skills']],
		displayName: 'ZCode',
		restartRequired: true,
		activationMode: 'restart_required',
		profileLabel: '用户选择目录',
	},
	{
		clientId: 'custom',
		targetId: 'custom-user',
		displayName: 'Custom MCP tool',
		restartRequired: true,
		activationMode: 'restart_required',
		profileLabel: '用户选择目录',
	},
];

const REGISTRY_BY_ID = new Map<string, ClientSkillTargetDescriptor>(
	CLIENT_SKILL_TARGETS.map((entry) => [entry.clientId, entry])
);

export function resolveClientSkillTargetProfile(
	clientId: string,
	homeDirectory: string | undefined,
	joinPath: (...parts: string[]) => string
): ClientSkillTargetProfile {
	const trimmedId = clientId.trim();
	const entry = REGISTRY_BY_ID.get(trimmedId);
	if (!entry) {
		return {
			targetId: `${trimmedId || 'unknown'}-user`,
			displayName: trimmedId || 'Unknown client',
			recommendation: null,
			legacyTargetDirectories: Object.freeze([]),
			restartRequired: true,
			activationMode: 'restart_required',
			profileLabel: '用户选择目录',
		};
	}

	const recommendation = homeDirectory && entry.recommendationPath && entry.documentationUrl
		? {
			skillsRootDirectory: joinPath(homeDirectory, ...entry.recommendationPath),
			source: 'official_documentation' as const,
			documentationUrl: entry.documentationUrl,
		}
		: null;
	const legacyTargetDirectories = homeDirectory
		? entry.legacyDirectoryPaths?.map((parts) => joinPath(homeDirectory, ...parts, 'tracekeeper')) ?? []
		: [];
	return {
		targetId: entry.targetId,
		displayName: entry.displayName,
		recommendation,
		legacyTargetDirectories: Object.freeze(legacyTargetDirectories),
		restartRequired: entry.restartRequired,
		activationMode: entry.activationMode,
		profileLabel: entry.profileLabel,
	};
}

export function buildClientSkillProfileFromRegistry(
	clientId: string,
	displayName: string,
	homeDirectory: string | undefined,
	joinPath: (...parts: string[]) => string
): ClientSkillTargetProfile {
	const resolved = resolveClientSkillTargetProfile(clientId, homeDirectory, joinPath);
	return {
		...resolved,
		displayName: displayName || resolved.displayName,
	};
}

export function legacySkillTargetDirectoryForId(
	targetId: string,
	homeDirectory: string | undefined,
	joinPath: (...parts: string[]) => string
): string | null {
	if (!homeDirectory) return null;
	const descriptor = CLIENT_SKILL_TARGETS.find((entry) => entry.targetId === targetId);
	const first = descriptor?.legacyDirectoryPaths?.[0];
	return first ? joinPath(homeDirectory, ...first, 'tracekeeper') : null;
}
