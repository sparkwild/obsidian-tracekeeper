import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

const LEGACY_CONNECTION_SETTING_KEYS = new Set([
	'runtimeToken',
	'runtimeTokenCreatedAt',
	'runtimeCredentials',
]);

type RuntimeAccessTokenFactory = () => string;

export const generateRuntimeAccessToken = (): string =>
	randomBytes(32).toString('base64url');

export const isRuntimeAccessToken = (value: unknown): value is string => {
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
	createToken: RuntimeAccessTokenFactory = generateRuntimeAccessToken
): Record<string, unknown> => {
	const sanitized = stripLegacyConnectionSettings(value);
	if (isRuntimeAccessToken(sanitized.runtimeAccessToken)) {
		return sanitized;
	}
	const runtimeAccessToken = createToken();
	if (!isRuntimeAccessToken(runtimeAccessToken)) {
		throw new Error('Runtime access token generation failed.');
	}
	return {
		...sanitized,
		runtimeAccessToken,
	};
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
