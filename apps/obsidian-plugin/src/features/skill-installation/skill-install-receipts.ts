export interface SkillInstallReceipt {
	schemaVersion: 2;
	targetId: string;
	targetDirectory: string;
	bundleHash: string;
	skillVersion: string;
	installedAt: string;
	provenance: 'tracekeeper_install' | 'external_verified';
}

export type SkillInstallReceipts = Readonly<Record<string, SkillInstallReceipt>>;

export interface SkillInstallReceiptMigrationOptions {
	legacyTargetDirectory?: (targetId: string) => string | null;
}

export const normalizeSkillInstallReceipts = (
	raw: unknown,
	options: SkillInstallReceiptMigrationOptions = {}
): SkillInstallReceipts => {
	if (!isRecord(raw)) return {};
	const receipts: Record<string, SkillInstallReceipt> = {};
	for (const [targetId, value] of Object.entries(raw)) {
		if (!isSafeTargetId(targetId) || !isRecord(value)) continue;
		const receipt = normalizeReceipt(value, targetId, options);
		if (!receipt) continue;
		receipts[targetId] = receipt;
	}
	return receipts;
};

export const recordSkillInstallReceipt = (
	receipts: SkillInstallReceipts,
	receipt: SkillInstallReceipt
): SkillInstallReceipts => {
	if (!isValidReceipt(receipt)) throw new Error('Skill install receipt is invalid.');
	return {
		...receipts,
		[receipt.targetId]: {
			...receipt,
			schemaVersion: 2,
			targetDirectory: receipt.targetDirectory.trim(),
			bundleHash: receipt.bundleHash.toLowerCase(),
		},
	};
};

export const removeSkillInstallReceipt = (
	receipts: SkillInstallReceipts,
	targetId: string
): SkillInstallReceipts => {
	if (!Object.prototype.hasOwnProperty.call(receipts, targetId)) return receipts;
	const next = { ...receipts };
	delete next[targetId];
	return next;
};

function normalizeReceipt(
	value: Record<string, unknown>,
	targetId: string,
	options: SkillInstallReceiptMigrationOptions
): SkillInstallReceipt | null {
	const schemaVersion = value.schemaVersion;
	const isLegacyReceipt = schemaVersion === undefined || schemaVersion === 1;
	const storedTargetId = asText(value.targetId) || targetId;
	const targetDirectory = asText(value.targetDirectory)
		|| (isLegacyReceipt && options.legacyTargetDirectory ? asText(options.legacyTargetDirectory(targetId) || '') : '');
	const bundleHash = asText(value.bundleHash).toLowerCase();
	const skillVersion = asText(value.skillVersion);
	const installedAt = asText(value.installedAt);
	const provenance = value.provenance === 'external_verified'
		? 'external_verified'
		: value.provenance === 'tracekeeper_install' || (isLegacyReceipt && value.provenance === undefined)
			? 'tracekeeper_install'
			: null;
	if (!isSafeTargetId(targetId)
		|| storedTargetId !== targetId
		|| !isAbsoluteDirectory(targetDirectory)
		|| provenance === null
		|| !isBundleHash(bundleHash)
		|| !isSemver(skillVersion)
		|| !isTimestamp(installedAt)) return null;
	return {
		schemaVersion: 2,
		targetId,
		targetDirectory,
		bundleHash,
		skillVersion,
		installedAt,
		provenance,
	};
}

function isValidReceipt(receipt: SkillInstallReceipt): boolean {
	return receipt.schemaVersion === 2
		&& isSafeTargetId(receipt.targetId)
		&& isAbsoluteDirectory(receipt.targetDirectory)
		&& isBundleHash(receipt.bundleHash)
		&& isSemver(receipt.skillVersion)
		&& isTimestamp(receipt.installedAt)
		&& (receipt.provenance === 'tracekeeper_install' || receipt.provenance === 'external_verified');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function isSafeTargetId(value: string): boolean {
	return /^[a-z][a-z0-9._-]{0,79}$/.test(value);
}

function isAbsoluteDirectory(value: string): boolean {
	return value !== ''
		&& !value.includes('\0')
		&& (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value));
}

function isBundleHash(value: string): boolean {
	return /^sha256:[a-f0-9]{64}$/.test(value);
}

function isSemver(value: string): boolean {
	return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function isTimestamp(value: string): boolean {
	return value !== '' && !Number.isNaN(Date.parse(value));
}
