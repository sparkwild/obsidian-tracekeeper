export interface SkillInstallReceipt {
	targetId: string;
	bundleHash: string;
	skillVersion: string;
	installedAt: string;
}

export type SkillInstallReceipts = Readonly<Record<string, SkillInstallReceipt>>;

export const normalizeSkillInstallReceipts = (raw: unknown): SkillInstallReceipts => {
	if (!isRecord(raw)) return {};
	const receipts: Record<string, SkillInstallReceipt> = {};
	for (const [targetId, value] of Object.entries(raw)) {
		if (!isSafeTargetId(targetId) || !isRecord(value)) continue;
		const receipt = normalizeReceipt(value);
		if (!receipt || receipt.targetId !== targetId) continue;
		receipts[targetId] = receipt;
	}
	return receipts;
};

export const recordSkillInstallReceipt = (
	receipts: SkillInstallReceipts,
	receipt: SkillInstallReceipt
): SkillInstallReceipts => {
	if (!isSafeTargetId(receipt.targetId)
		|| !isBundleHash(receipt.bundleHash)
		|| !isSemver(receipt.skillVersion)
		|| !isTimestamp(receipt.installedAt)) {
		throw new Error('Skill install receipt is invalid.');
	}
	return {
		...receipts,
		[receipt.targetId]: {
			targetId: receipt.targetId,
			bundleHash: receipt.bundleHash.toLowerCase(),
			skillVersion: receipt.skillVersion,
			installedAt: receipt.installedAt,
		},
	};
};

function normalizeReceipt(value: Record<string, unknown>): SkillInstallReceipt | null {
	const targetId = asText(value.targetId);
	const bundleHash = asText(value.bundleHash).toLowerCase();
	const skillVersion = asText(value.skillVersion);
	const installedAt = asText(value.installedAt);
	if (!isSafeTargetId(targetId)
		|| !isBundleHash(bundleHash)
		|| !isSemver(skillVersion)
		|| !isTimestamp(installedAt)) return null;
	return { targetId, bundleHash, skillVersion, installedAt };
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

function isBundleHash(value: string): boolean {
	return /^sha256:[a-f0-9]{64}$/.test(value);
}

function isSemver(value: string): boolean {
	return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function isTimestamp(value: string): boolean {
	return value !== '' && !Number.isNaN(Date.parse(value));
}
