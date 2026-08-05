export type SkillInstallAuditResult = 'success' | 'partial' | 'failed';
export type SkillInstallAuditAction = 'install' | 'update' | 'migrate' | 'verify_external';
export type SkillInstallMethod = 'tracekeeper_install' | 'external_verified';

export interface SkillInstallAuditInput {
	action: SkillInstallAuditAction;
	clientId: string;
	bundleHash: string;
	backupCreated: boolean;
	result: SkillInstallAuditResult;
	installMethod?: SkillInstallMethod;
	timestamp?: string;
}

export function buildSkillInstallAuditEntry(input: SkillInstallAuditInput): string {
	const timestamp = normalizeTimestamp(input.timestamp);
	return (
		`## ${timestamp}\n` +
		`action: skill_${input.action}\n` +
		'actor: user\n' +
		`client_id: ${safeValue(input.clientId, 'unknown')}\n` +
		`bundle_hash: ${safeBundleHash(input.bundleHash)}\n` +
		`install_method: ${input.installMethod ?? (input.action === 'verify_external' ? 'external_verified' : 'tracekeeper_install')}\n` +
		`backup_created: ${input.backupCreated ? 'true' : 'false'}\n` +
		`result: ${input.result}\n\n`
	);
}

function safeValue(value: string, fallback: string): string {
	const normalized = value.trim().replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
	return normalized || fallback;
}

function safeBundleHash(value: string): string {
	const normalized = value.trim().toLowerCase();
	return /^sha256:[a-f0-9]{64}$/.test(normalized) ? normalized : 'unavailable';
}

function normalizeTimestamp(value: string | undefined): string {
	if (value && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
	return new Date().toISOString();
}
