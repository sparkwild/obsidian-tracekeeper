import type { ToolCapability } from '@tracekeeper/contracts';
import { getContractByName, PUBLIC_TOOL_NAME_ORDER } from '@tracekeeper/contracts';

export interface ClientRuntimeCredential {
	id: string;
	clientId: string;
	token: string;
	capabilities?: readonly string[];
	createdAt: string;
	capabilityProfile?: RuntimeCredentialCapabilityProfile;
}

export type RuntimeCredentialCapabilityProfile = 'knowledge_assistant' | 'research_agent' | 'review_agent' | 'maintenance_agent' | 'custom';

export interface RuntimeCredentialProfileDefinition {
	readonly id: Exclude<RuntimeCredentialCapabilityProfile, 'custom'>;
	readonly capabilities: readonly (ToolCapability | '*')[];
}

export const RUNTIME_CREDENTIAL_PRESET_DEFINITIONS: readonly RuntimeCredentialProfileDefinition[] = [
	{
		id: 'knowledge_assistant',
		capabilities: ['vault.read', 'workflow.manage', 'memory.propose'],
	},
	{
		id: 'research_agent',
		capabilities: ['vault.read', 'workflow.manage', 'memory.propose', 'vault.write'],
	},
	{
		id: 'review_agent',
		capabilities: ['vault.read', 'workflow.manage', 'memory.propose', 'memory.review', 'memory.apply'],
	},
	{
		id: 'maintenance_agent',
		capabilities: ['vault.read'],
	},
] as const;

const RUNTIME_CREDENTIAL_PRESET_BY_ID = new Map<string, readonly (ToolCapability | '*')[]>(
	RUNTIME_CREDENTIAL_PRESET_DEFINITIONS.map((entry) => [entry.id, entry.capabilities])
);

const ALLOWED_RUNTIME_CAPABILITIES = new Set<ToolCapability | '*'>([
	'*',
	'vault.read',
	'vault.write',
	'memory.propose',
	'memory.apply',
	'memory.review',
	'workflow.manage',
	'review-gated.apply',
]);

const normalizeRuntimeCredentialProfile = (value: unknown): RuntimeCredentialCapabilityProfile | undefined => {
	if (typeof value !== 'string') {
		return undefined;
	}
	const normalized = value.trim().toLowerCase().replace(/\\s+/g, '_') as RuntimeCredentialCapabilityProfile;
	switch (normalized) {
		case 'knowledge_assistant':
		case 'research_agent':
		case 'review_agent':
		case 'maintenance_agent':
		case 'custom':
			return normalized;
		default:
			return undefined;
	}
};

export const normalizeRuntimeCapabilities = (
	raw: unknown
): (ToolCapability | '*')[] => {
	const values = Array.isArray(raw) ? raw : [];
	const normalized = values
		.filter((value): value is ToolCapability | '*' =>
			typeof value === 'string' && ALLOWED_RUNTIME_CAPABILITIES.has(value.trim() as ToolCapability | '*'))
		.map((value) => value.trim() as ToolCapability | '*');
	if (normalized.includes('*')) {
		return ['*'];
	}
	const unique: Array<ToolCapability | '*'> = [];
	for (const capability of normalized) {
		if (!unique.includes(capability)) {
			unique.push(capability);
		}
	}
	return unique;
};

export const inferRuntimeCredentialProfile = (
	capabilities: readonly (ToolCapability | '*')[]
): RuntimeCredentialCapabilityProfile => {
	const normalized = normalizeRuntimeCapabilities(capabilities);
	if (normalized.includes('*')) {
		return 'custom';
	}
	for (const { id, capabilities: presetCapabilities } of RUNTIME_CREDENTIAL_PRESET_DEFINITIONS) {
		if (
			normalized.length === presetCapabilities.length
			&& normalized.every((capability) => presetCapabilities.includes(capability))
		) {
			return id;
		}
	}
	return 'custom';
};

export const capabilitiesForRuntimeProfile = (
	profile: RuntimeCredentialCapabilityProfile,
	fallback: readonly (ToolCapability | '*')[] = []
): (ToolCapability | '*')[] => {
	if (profile === 'custom') {
		return normalizeRuntimeCapabilities(fallback);
	}
	const capabilities = RUNTIME_CREDENTIAL_PRESET_BY_ID.get(profile);
	if (!capabilities) {
		throw new Error(`Unknown runtime credential capability profile: ${String(profile)}`);
	}
	return [...capabilities];
};

const allowedOrStar = (value: string): value is ToolCapability | '*' =>
	ALLOWED_RUNTIME_CAPABILITIES.has(value as ToolCapability | '*');

const resolveCapability = (toolName: string): ToolCapability | undefined => {
	const contract = getContractByName(toolName);
	return contract && allowedOrStar(contract.capability as string) ? contract.capability : undefined;
};

export const runtimeCapabilitiesToPublicTools = (
	capabilities: readonly (ToolCapability | '*')[]
): string[] => {
	const normalized = new Set(normalizeRuntimeCapabilities(capabilities));
	if (normalized.has('*')) {
		return [...PUBLIC_TOOL_NAME_ORDER];
	}
	return PUBLIC_TOOL_NAME_ORDER.filter((toolName) => {
		const required = resolveCapability(toolName);
		return required !== undefined && normalized.has(required);
	});
};

export const normalizeRuntimeCredentialProfileAndCapabilities = (
	raw: unknown
): { profile: RuntimeCredentialCapabilityProfile; capabilities: (ToolCapability | '*')[] } => {
	const rawRecord = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
	const capabilities = normalizeRuntimeCapabilities(rawRecord.capabilities);
	const explicitProfile = normalizeRuntimeProfileId(rawRecord.capabilityProfile);
	const fallbackProfile = explicitProfile || inferRuntimeCredentialProfile(capabilities);
	const resolved = capabilitiesForRuntimeProfile(fallbackProfile, capabilities);
	return {
		profile: fallbackProfile,
		capabilities: resolved,
	};
};

export function rotateClientRuntimeCredential<TCredential extends ClientRuntimeCredential>(
	credentials: readonly TCredential[],
	clientId: string,
	newToken: string,
	createdAt: string
): TCredential[] {
	if (!clientId.trim() || !newToken.trim()) {
		throw new Error('Client id and replacement token are required.');
	}
	let rotated = false;
	const next = credentials.map((credential) => {
		if (credential.clientId !== clientId) {
			return credential;
		}
		rotated = true;
		return {
			...credential,
			token: newToken,
			createdAt,
		};
	});
	if (!rotated) {
		throw new Error(`Missing runtime credential for Agent client: ${clientId}`);
	}
	return next;
}

const normalizeRuntimeProfileId = (value: unknown): RuntimeCredentialCapabilityProfile | undefined =>
	typeof value === 'string' ? normalizeRuntimeCredentialProfile(value) : undefined;
