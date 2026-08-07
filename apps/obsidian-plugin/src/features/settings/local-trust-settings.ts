import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import {
	normalizeAgentIntegrations,
	type AgentIntegrationRecord,
} from './agent-integrations';

const LEGACY_CONNECTION_SETTING_KEYS = new Set([
	'runtimeAccessToken',
	'runtimeToken',
	'runtimeTokenCreatedAt',
	'runtimeCredentials',
	'pairingTickets',
	'pairingCodes',
]);

type RuntimeSecuritySecretFactory = () => string;

export const generateRuntimeSecuritySecret = (): string =>
	randomBytes(32).toString('base64url');

export const isRuntimeSecuritySecret = (value: unknown): value is string => {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
		return false;
	}
	const decoded = Buffer.from(value, 'base64url');
	return decoded.byteLength === 32 && decoded.toString('base64url') === value;
};

export const stripLegacyConnectionSettings = (value: unknown): Record<string, unknown> => {
	if (!isRecord(value)) {
		return {};
	}
	const sanitized = { ...value };
	for (const key of LEGACY_CONNECTION_SETTING_KEYS) {
		delete sanitized[key];
	}
	return sanitized;
};

export const normalizeLocalTrustSettings = (
	value: unknown,
	createSecret: RuntimeSecuritySecretFactory = generateRuntimeSecuritySecret
): Record<string, unknown> & {
	runtimeSecuritySecret: string;
	agentIntegrations: AgentIntegrationRecord[];
} => {
	const sanitized = stripLegacyConnectionSettings(value);
	const runtimeSecuritySecret = isRuntimeSecuritySecret(sanitized.runtimeSecuritySecret)
		? sanitized.runtimeSecuritySecret
		: createSecret();
	if (!isRuntimeSecuritySecret(runtimeSecuritySecret)) {
		throw new Error('Runtime security secret generation failed.');
	}
	return {
		...sanitized,
		runtimeSecuritySecret,
		agentIntegrations: normalizeAgentIntegrations(sanitized.agentIntegrations),
	};
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
