export type SkillDeliveryMode = 'managed' | 'copy-only';
export type SkillActivationMode = 'automatic_with_restart_fallback' | 'restart_required';

interface BaseClientSkillTargetDescriptor {
	clientId: string;
	targetId: string;
	displayName: string;
	deliveryMode: SkillDeliveryMode;
	restartRequired: boolean;
	activationMode: SkillActivationMode;
	profileLabel: string;
}

interface ManagedClientSkillTargetDescriptor extends BaseClientSkillTargetDescriptor {
	deliveryMode: 'managed';
	primaryDirectoryFactory: (homeDirectory: string, joinPath: (...parts: string[]) => string) => string;
	legacyDirectoryFactories?: Array<(homeDirectory: string, joinPath: (...parts: string[]) => string) => string>;
}

interface CopyOnlyClientSkillTargetDescriptor extends BaseClientSkillTargetDescriptor {
	deliveryMode: 'copy-only';
}

export type ClientSkillTargetDescriptor = ManagedClientSkillTargetDescriptor | CopyOnlyClientSkillTargetDescriptor;

interface ResolvedClientSkillTarget {
	targetId: string;
	deliveryMode: SkillDeliveryMode;
	targetDirectory?: string;
	legacyTargetDirectories: readonly string[];
	restartRequired: boolean;
	activationMode: SkillActivationMode;
	profileLabel: string;
}

export interface ClientSkillTargetProfile {
	targetId: string;
	displayName: string;
	deliveryMode: SkillDeliveryMode;
	targetDirectory?: string;
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
		deliveryMode: 'managed',
		restartRequired: false,
		activationMode: 'automatic_with_restart_fallback',
		profileLabel: 'Local managed profile',
		primaryDirectoryFactory: (homeDirectory, joinPath) => joinPath(homeDirectory, '.agents', 'skills', 'tracekeeper'),
		legacyDirectoryFactories: [
			(homeDirectory, joinPath) => joinPath(homeDirectory, '.codex', 'skills', 'tracekeeper'),
		],
	},
	{
		clientId: 'claude-code',
		targetId: 'claude-code-user',
		displayName: 'Claude Code',
		deliveryMode: 'managed',
		restartRequired: false,
		activationMode: 'automatic_with_restart_fallback',
		profileLabel: 'Local managed profile',
		primaryDirectoryFactory: (homeDirectory, joinPath) => joinPath(homeDirectory, '.claude', 'skills', 'tracekeeper'),
	},
	{
		clientId: 'claude-desktop',
		targetId: 'claude-desktop-copy-only',
		displayName: 'Claude Desktop',
		deliveryMode: 'copy-only',
		restartRequired: true,
		activationMode: 'restart_required',
		profileLabel: 'Local copy-only profile',
	},
	{
		clientId: 'cursor',
		targetId: 'cursor-copy-only',
		displayName: 'Cursor',
		deliveryMode: 'copy-only',
		restartRequired: true,
		activationMode: 'restart_required',
		profileLabel: 'Local copy-only profile',
	},
	{
		clientId: 'custom',
		targetId: 'custom-copy-only',
		displayName: 'Custom MCP tool',
		deliveryMode: 'copy-only',
		restartRequired: true,
		activationMode: 'restart_required',
		profileLabel: 'Local copy-only profile',
	},
];

const REGISTRY_BY_ID = new Map<string, ClientSkillTargetDescriptor>(
	CLIENT_SKILL_TARGETS.map((entry) => [entry.clientId, entry])
);

export function resolveClientSkillTargetProfile(
	clientId: string,
	homeDirectory: string | undefined,
	joinPath: (...parts: string[]) => string
): ResolvedClientSkillTarget {
	const trimmedId = clientId.trim();
	const entry = REGISTRY_BY_ID.get(trimmedId);
	if (!entry) {
		return {
			targetId: `${trimmedId || 'unknown'}-copy-only`,
			deliveryMode: 'copy-only',
			restartRequired: true,
			targetDirectory: undefined,
			legacyTargetDirectories: Object.freeze([]),
			activationMode: 'restart_required',
			profileLabel: 'Local copy-only profile',
		};
	}

	if (entry.deliveryMode === 'copy-only' || !homeDirectory) {
		return {
			targetId: entry.targetId,
			deliveryMode: 'copy-only',
			restartRequired: entry.restartRequired,
			targetDirectory: undefined,
			legacyTargetDirectories: Object.freeze([]),
			activationMode: entry.activationMode,
			profileLabel: entry.profileLabel,
		};
	}

	const legacyTargetDirectories = entry.legacyDirectoryFactories?.map((factory) => factory(homeDirectory, joinPath))
		|| [];
	return {
		targetId: entry.targetId,
		deliveryMode: 'managed',
		targetDirectory: entry.primaryDirectoryFactory(homeDirectory, joinPath),
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
	const trimmedId = clientId.trim();
	const resolved = resolveClientSkillTargetProfile(trimmedId, homeDirectory, joinPath);
	const registryDisplayName = REGISTRY_BY_ID.get(trimmedId)?.displayName;
	return {
		targetId: resolved.targetId,
		displayName: displayName || registryDisplayName || trimmedId,
		deliveryMode: resolved.deliveryMode,
		targetDirectory: resolved.targetDirectory,
		restartRequired: resolved.restartRequired,
		profileLabel: resolved.profileLabel,
		activationMode: resolved.activationMode,
		legacyTargetDirectories: resolved.legacyTargetDirectories,
	};
}
