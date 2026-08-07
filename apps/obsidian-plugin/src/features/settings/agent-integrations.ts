import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export type AgentAuthMode = 'oauth' | 'bearer';

export interface AgentCredentialRecord {
	credentialId: string;
	kind: 'oauth' | 'manual_bearer';
	tokenDigestSha256: string;
	issuedAt: string;
}

export interface BoundOAuthClientRecord {
	clientId: string;
	clientNameClaim: string;
	redirectUris: string[];
	registeredAt: string;
}

export interface AgentIntegrationRecord {
	schemaVersion: 1;
	integrationId: string;
	clientProfileId: string;
	authMode: AgentAuthMode;
	createdAt: string;
	updatedAt: string;
	setupCommandCopiedAt: string;
	lastPreparedEndpoint: string;
	lastAuthorizedAt: string;
	lastRevokedAt: string;
	credential: AgentCredentialRecord | null;
	oauthClient: BoundOAuthClientRecord | null;
}

export type AgentCredentialSnapshot = Omit<AgentCredentialRecord, 'tokenDigestSha256'>;

export type AgentIntegrationSnapshot = Omit<AgentIntegrationRecord, 'credential'> & {
	credential: AgentCredentialSnapshot | null;
};

export interface AuthenticatedCredentialContext {
	integrationId: string;
	credentialId: string;
	authMode: AgentAuthMode;
	principalId: 'local-user';
	capabilities: readonly string[];
}

export interface IssuedAgentCredential {
	record: AgentIntegrationRecord;
	plaintextToken: string;
}

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

export const generateAgentToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');

export const isAgentToken = (value: unknown): value is string => {
	if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
		return false;
	}
	return Buffer.from(value, 'base64url').byteLength === TOKEN_BYTES
		&& Buffer.from(value, 'base64url').toString('base64url') === value;
};

export const digestAgentToken = (token: string): string =>
	createHash('sha256').update(token, 'utf8').digest('hex');

export const isAgentTokenDigest = (value: unknown): value is string =>
	typeof value === 'string' && DIGEST_PATTERN.test(value);

export const normalizeAgentIntegrations = (value: unknown): AgentIntegrationRecord[] => {
	if (!Array.isArray(value)) {
		return [];
	}
	const byClientProfile = new Set<string>();
	const byIntegrationId = new Set<string>();
	const normalized: AgentIntegrationRecord[] = [];
	for (const candidate of value) {
		if (!isRecord(candidate)) {
			continue;
		}
		const clientProfileId = asNonEmptyString(candidate.clientProfileId);
		const integrationId = asNonEmptyString(candidate.integrationId);
		const authMode = candidate.authMode === 'bearer' ? 'bearer' : candidate.authMode === 'oauth' ? 'oauth' : null;
		if (!clientProfileId || !integrationId || !authMode || byClientProfile.has(clientProfileId) || byIntegrationId.has(integrationId)) {
			continue;
		}
		const now = new Date().toISOString();
		const credential = normalizeCredential(candidate.credential);
		const oauthClient = normalizeOAuthClient(candidate.oauthClient);
		const compatibleCredential = credential && ((authMode === 'oauth' && credential.kind === 'oauth') || (authMode === 'bearer' && credential.kind === 'manual_bearer'))
			? credential
			: null;
		normalized.push({
			schemaVersion: 1,
			integrationId,
			clientProfileId,
			authMode,
			createdAt: asTimestamp(candidate.createdAt) || now,
			updatedAt: asTimestamp(candidate.updatedAt) || now,
			setupCommandCopiedAt: asTimestamp(candidate.setupCommandCopiedAt),
			lastPreparedEndpoint: asNonEmptyString(candidate.lastPreparedEndpoint),
			lastAuthorizedAt: asTimestamp(candidate.lastAuthorizedAt),
			lastRevokedAt: asTimestamp(candidate.lastRevokedAt),
			credential: compatibleCredential,
			oauthClient: authMode === 'oauth' ? oauthClient : null,
		});
		byClientProfile.add(clientProfileId);
		byIntegrationId.add(integrationId);
	}
	return normalized;
};

export const createAgentIntegration = (
	clientProfileId: string,
	authMode: AgentAuthMode,
	endpoint: string,
	now = new Date().toISOString()
): AgentIntegrationRecord => ({
	schemaVersion: 1,
	integrationId: randomUUID(),
	clientProfileId,
	authMode,
	createdAt: now,
	updatedAt: now,
	setupCommandCopiedAt: '',
	lastPreparedEndpoint: endpoint,
	lastAuthorizedAt: '',
	lastRevokedAt: '',
	credential: null,
	oauthClient: null,
});

export const issueAgentCredential = (
	integration: AgentIntegrationRecord,
	kind: AgentCredentialRecord['kind'],
	token = generateAgentToken(),
	now = new Date().toISOString(),
	credentialId: string = randomUUID()
): IssuedAgentCredential => {
	if (!isAgentToken(token)) {
		throw new Error('Agent credential generation failed.');
	}
	if ((integration.authMode === 'oauth') !== (kind === 'oauth')) {
		throw new Error('Agent credential mode does not match the integration.');
	}
	const credential: AgentCredentialRecord = {
		credentialId,
		kind,
		tokenDigestSha256: digestAgentToken(token),
		issuedAt: now,
	};
	return {
		plaintextToken: token,
		record: {
			...integration,
			updatedAt: now,
			lastAuthorizedAt: now,
			lastRevokedAt: '',
			credential,
		},
	};
};

export const revokeAgentCredential = (
	integration: AgentIntegrationRecord,
	now = new Date().toISOString()
): AgentIntegrationRecord => ({
	...integration,
	updatedAt: now,
	lastRevokedAt: now,
	credential: null,
});

export const markSetupCommandCopied = (
	integration: AgentIntegrationRecord,
	endpoint: string,
	now = new Date().toISOString()
): AgentIntegrationRecord => ({
	...integration,
	updatedAt: now,
	setupCommandCopiedAt: now,
	lastPreparedEndpoint: endpoint,
});

export const verifyAgentCredential = (
	integrations: readonly AgentIntegrationRecord[],
	token: string
): AuthenticatedCredentialContext | null => {
	if (!isAgentToken(token)) {
		return null;
	}
	const presentedDigest = Buffer.from(digestAgentToken(token), 'hex');
	for (const integration of integrations) {
		const credential = integration.credential;
		if (!credential || !isAgentTokenDigest(credential.tokenDigestSha256)) {
			continue;
		}
		const expectedDigest = Buffer.from(credential.tokenDigestSha256, 'hex');
		if (presentedDigest.length === expectedDigest.length && timingSafeEqual(presentedDigest, expectedDigest)) {
			return {
				integrationId: integration.integrationId,
				credentialId: credential.credentialId,
				authMode: integration.authMode,
				principalId: 'local-user',
				capabilities: [],
			};
		}
	}
	return null;
};

const normalizeCredential = (value: unknown): AgentCredentialRecord | null => {
	if (!isRecord(value)) {
		return null;
	}
	const credentialId = asNonEmptyString(value.credentialId);
	const digest = asNonEmptyString(value.tokenDigestSha256);
	const kind = value.kind === 'oauth' || value.kind === 'manual_bearer' ? value.kind : null;
	if (!credentialId || !digest || !kind || !isAgentTokenDigest(digest)) {
		return null;
	}
	return {
		credentialId,
		kind,
		tokenDigestSha256: digest,
		issuedAt: asTimestamp(value.issuedAt),
	};
};

const normalizeOAuthClient = (value: unknown): BoundOAuthClientRecord | null => {
	if (!isRecord(value)) {
		return null;
	}
	const clientId = asNonEmptyString(value.clientId);
	const redirectUris = Array.isArray(value.redirectUris)
		? value.redirectUris.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
		: [];
	if (!clientId || redirectUris.length === 0) {
		return null;
	}
	return {
		clientId,
		clientNameClaim: asNonEmptyString(value.clientNameClaim),
		redirectUris,
		registeredAt: asTimestamp(value.registeredAt),
	};
};

const asNonEmptyString = (value: unknown): string =>
	typeof value === 'string' ? value.trim() : '';

const asTimestamp = (value: unknown): string => {
	const text = asNonEmptyString(value);
	return text && !Number.isNaN(Date.parse(text)) ? text : '';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
