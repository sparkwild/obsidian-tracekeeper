import { randomBytes } from 'node:crypto';
import {
	hashSkillFileContent,
	type EmbeddedTracekeeperSkillBundle,
	type TracekeeperSkillManifest,
} from '../features/skill-installation/skill-bundle';
import {
	buildClientSkillProfileFromRegistry,
	type SkillActivationMode,
	type ClientSkillDirectoryRecommendation,
} from './client-skill-target-registry';

export type SkillInstallDetectionState = 'location_required' | 'not_installed' | 'installed' | 'update_available' | 'newer_than_bundled' | 'modified' | 'legacy_install' | 'location_conflict' | 'unavailable';
export type SkillInstallAction = 'install' | 'update' | 'migrate' | 'conflict' | 'none';
export type SkillFileChange = 'create' | 'replace' | 'unchanged';

export const hasDetectedSkillEvidence = (state: SkillInstallDetectionState): boolean =>
	state !== 'location_required' && state !== 'not_installed' && state !== 'unavailable';

export interface ClientSkillProfile {
	id: string;
	targetId: string;
	displayName: string;
	recommendation: ClientSkillDirectoryRecommendation | null;
	targetDirectory?: string;
	restartRequired: boolean;
	profileLabel: string;
	activationMode: SkillActivationMode;
	legacyTargetDirectories?: readonly string[];
	ownedBundleHash?: string;
	ownedSkillVersion?: string;
}

export interface SkillInstallState {
	clientId: string;
	targetId: string;
	targetDirectory?: string;
	legacyTargetDirectories: readonly string[];
	activationMode: SkillActivationMode;
	restartRequired: boolean;
	state: SkillInstallDetectionState;
	fileVerified: boolean;
	updateAvailable: boolean;
	installedVersion: string;
	expectedVersion: string;
	detail: string;
}

export interface SkillInstallPlanFile {
	path: string;
	change: SkillFileChange;
	originalHash: string | null;
}

export interface SkillInstallPlan {
	planId: string;
	action: SkillInstallAction;
	clientId: string;
	targetDirectory?: string;
	files: SkillInstallPlanFile[];
	canConfirm: boolean;
	expiresAt: string;
	detail: string;
}

export interface SkillInstallResult {
	action: 'install' | 'update' | 'migrate';
	clientId: string;
	targetDirectory: string;
	backupDirectory: string;
	bundleHash: string;
}

export interface ClientSkillFileApi {
	existsSync(path: string): boolean;
	lstatSync(path: string): { isSymbolicLink(): boolean };
	readFileSync(path: string, encoding: 'utf8'): string;
	writeFileSync(path: string, content: string, encoding: 'utf8'): void;
	mkdirSync(path: string, options: { recursive: boolean }): void;
	renameSync(oldPath: string, newPath: string): void;
	rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
}

export interface ClientSkillPathApi {
	dirname(path: string): string;
	join(...parts: string[]): string;
}

export interface ClientSkillAdapterOptions {
	fs: ClientSkillFileApi;
	path: ClientSkillPathApi;
	bundle: EmbeddedTracekeeperSkillBundle;
	now?: () => Date;
	planTtlMs?: number;
}

interface StoredSkillInstallPlan extends SkillInstallPlan {
	originalHashes: Map<string, string | null>;
}

export class ClientSkillPlanConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ClientSkillPlanConflictError';
	}
}

interface ManagedDirectoryAnalysis {
	state: 'installed' | 'update_available' | 'newer_than_bundled' | 'modified';
	installedVersion: string;
	fileVerified: boolean;
	updateAvailable: boolean;
	detail: string;
}

export class ClientSkillAdapter {
	private readonly plans = new Map<string, StoredSkillInstallPlan>();
	private readonly now: () => Date;
	private readonly planTtlMs: number;

	constructor(private readonly options: ClientSkillAdapterOptions) {
		this.now = options.now ?? (() => new Date());
		this.planTtlMs = options.planTtlMs ?? 5 * 60 * 1000;
		if (!Number.isSafeInteger(this.planTtlMs) || this.planTtlMs <= 0) {
			throw new Error('Client Skill planTtlMs must be a positive safe integer.');
		}
	}

	detect(profile: ClientSkillProfile): SkillInstallState {
		const legacyTargetDirectories = profile.legacyTargetDirectories ?? [];
		for (const legacyDirectory of legacyTargetDirectories) {
			this.assertNoSymbolicLinkSegments(legacyDirectory);
		}
		const legacyWithManagedFiles = legacyTargetDirectories.filter((legacyDirectory) =>
			legacyDirectory !== profile.targetDirectory && this.hasManagedFiles(legacyDirectory)
		);
		if (!profile.targetDirectory) {
			if (legacyWithManagedFiles.length > 0) {
				return this.state(
					profile,
					'legacy_install',
					false,
					false,
					'',
					`Found a legacy Tracekeeper Skill path at ${legacyWithManagedFiles[0]}. Select a destination to migrate it without deleting the legacy directory.`
				);
			}
			return this.state(profile, 'location_required', false, false, '', 'Select a Skills directory before installing the Tracekeeper Skill.');
		}
		this.assertNoSymbolicLinkSegments(profile.targetDirectory);

		const primaryHasManagedFiles = this.hasManagedFiles(profile.targetDirectory);

		if (primaryHasManagedFiles && legacyWithManagedFiles.length > 0) {
			return this.state(
				profile,
				'location_conflict',
				false,
				false,
				'',
				`Both managed target and legacy locations exist: ${profile.targetDirectory}, ${legacyWithManagedFiles.join(', ')}`
			);
		}

		if (!primaryHasManagedFiles) {
			if (legacyWithManagedFiles.length === 0) {
				return this.state(profile, 'not_installed', false, false, '', 'Tracekeeper Skill files were not found.');
			}
			return this.detectLegacyInstall(profile, legacyWithManagedFiles[0]);
		}

		const primaryAnalysis = this.analyzeManagedDirectory(profile.targetDirectory, profile);
		return this.state(
			profile,
			primaryAnalysis.state,
			primaryAnalysis.fileVerified,
			primaryAnalysis.updateAvailable,
			primaryAnalysis.installedVersion,
			primaryAnalysis.detail
		);
	}

	previewInstall(profile: ClientSkillProfile): SkillInstallPlan {
		return this.preview(profile, 'install');
	}

	previewUpdate(profile: ClientSkillProfile): SkillInstallPlan {
		return this.preview(profile, 'update');
	}

	previewMigrate(profile: ClientSkillProfile): SkillInstallPlan {
		return this.preview(profile, 'migrate');
	}

	confirmInstall(planId: string): SkillInstallResult {
		return this.commit(planId, 'install');
	}

	confirmUpdate(planId: string): SkillInstallResult {
		return this.commit(planId, 'update');
	}

	confirmMigrate(planId: string): SkillInstallResult {
		return this.commit(planId, 'migrate');
	}

	private preview(profile: ClientSkillProfile, requestedAction: 'install' | 'update' | 'migrate'): SkillInstallPlan {
		this.pruneExpiredPlans();
		const detected = this.detect(profile);
		if (!profile.targetDirectory) {
			return this.publicPlan(profile, 'conflict', [], false, detected.detail);
		}
		if (detected.state === 'location_conflict') {
			return this.publicPlan(profile, 'conflict', this.planFiles(profile.targetDirectory), false, 'Primary and legacy Skill paths both exist; resolve manually.');
		}
		if (detected.state === 'legacy_install') {
			if (requestedAction !== 'migrate') {
				throw new ClientSkillPlanConflictError(`Expected a Skill migrate preview.`);
			}
			const files = this.planFiles(profile.targetDirectory);
			const createdAt = this.now();
			const planId = `client-skill-${randomBytes(12).toString('hex')}`;
			const plan: StoredSkillInstallPlan = {
				planId,
				action: 'migrate',
				clientId: profile.id,
				targetDirectory: profile.targetDirectory,
				files,
				canConfirm: true,
				expiresAt: new Date(createdAt.getTime() + this.planTtlMs).toISOString(),
				detail: 'Copy the embedded Skill bundle from the legacy location into the selected destination.',
				originalHashes: new Map(files.map((file) => [file.path, file.originalHash])),
			};
			this.plans.set(planId, plan);
			return stripPrivatePlan(plan);
		}
		if (detected.state === 'modified' || detected.state === 'unavailable') {
			return this.publicPlan(profile, 'conflict', this.planFiles(profile.targetDirectory), false, detected.detail);
		}
		if (detected.state === 'not_installed') {
			if (requestedAction !== 'install') {
				throw new ClientSkillPlanConflictError('Expected a Skill install preview.');
			}
			const files = this.planFiles(profile.targetDirectory);
			const createdAt = this.now();
			const planId = `client-skill-${randomBytes(12).toString('hex')}`;
			const plan: StoredSkillInstallPlan = {
				planId,
				action: requestedAction,
				clientId: profile.id,
				targetDirectory: profile.targetDirectory,
				files,
				canConfirm: true,
				expiresAt: new Date(createdAt.getTime() + this.planTtlMs).toISOString(),
				detail: 'Install the embedded Skill bundle.',
				originalHashes: new Map(files.map((file) => [file.path, file.originalHash])),
			};
			this.plans.set(planId, plan);
			return stripPrivatePlan(plan);
		}
		if (detected.state === 'update_available') {
			if (requestedAction !== 'update') {
				throw new ClientSkillPlanConflictError('Expected a Skill update preview.');
			}
			const files = this.planFiles(profile.targetDirectory);
			const createdAt = this.now();
			const planId = `client-skill-${randomBytes(12).toString('hex')}`;
			const plan: StoredSkillInstallPlan = {
				planId,
				action: 'update',
				clientId: profile.id,
				targetDirectory: profile.targetDirectory,
				files,
				canConfirm: true,
				expiresAt: new Date(createdAt.getTime() + this.planTtlMs).toISOString(),
				detail: 'Update the verified embedded Skill bundle.',
				originalHashes: new Map(files.map((file) => [file.path, file.originalHash])),
			};
			this.plans.set(planId, plan);
			return stripPrivatePlan(plan);
		}
		if (detected.state === 'installed') {
			if (requestedAction === 'migrate') {
				throw new ClientSkillPlanConflictError('Expected a Skill install or update preview.');
			}
			return this.publicPlan(profile, 'none', this.planFiles(profile.targetDirectory), false, detected.detail);
		}
		if (detected.state === 'newer_than_bundled') {
			if (requestedAction === 'migrate') {
				throw new ClientSkillPlanConflictError('Expected a Skill install preview.');
			}
			return this.publicPlan(profile, 'none', this.planFiles(profile.targetDirectory), false, detected.detail);
		}
		throw new ClientSkillPlanConflictError('This Skill state is not actionable.');
	}

	private commit(planId: string, expectedAction: 'install' | 'update' | 'migrate'): SkillInstallResult {
		const plan = this.plans.get(planId);
		if (!plan || plan.action !== expectedAction || !plan.targetDirectory || !plan.canConfirm) {
			throw new ClientSkillPlanConflictError('Skill install plan is missing or does not match the confirmed action.');
		}
		this.plans.delete(planId);
		if (this.now().getTime() > Date.parse(plan.expiresAt)) {
			throw new ClientSkillPlanConflictError('Skill install plan expired. Preview the change again.');
		}
		for (const [filePath, originalHash] of plan.originalHashes) {
			if (this.currentHash(plan.targetDirectory, filePath) !== originalHash) {
				throw new ClientSkillPlanConflictError('Skill content changed after preview. Preview the change again.');
			}
		}

		const stamp = this.now().toISOString().replace(/[:.]/g, '-');
		const nonce = randomBytes(4).toString('hex');
		const stageDirectory = `${plan.targetDirectory}.tracekeeper-stage-${stamp}-${nonce}`;
		const backupDirectory = `${plan.targetDirectory}.tracekeeper-backup-${stamp}-${nonce}`;
		const changedFiles = plan.files.filter((file) => file.change !== 'unchanged');
		this.assertNoSymbolicLinkSegments(stageDirectory);
		this.assertNoSymbolicLinkSegments(backupDirectory);
		this.options.fs.mkdirSync(stageDirectory, { recursive: true });
		this.assertNoSymbolicLinkSegments(stageDirectory);
		for (const file of changedFiles) {
			const stagePath = this.resolve(stageDirectory, file.path);
			this.options.fs.mkdirSync(this.options.path.dirname(stagePath), { recursive: true });
			this.assertNoSymbolicLinkSegments(this.options.path.dirname(stagePath));
			this.options.fs.writeFileSync(stagePath, this.options.bundle.installFiles[file.path], 'utf8');
		}

		const originals = new Map<string, string>();
		for (const file of changedFiles) {
			const targetPath = this.resolve(plan.targetDirectory, file.path);
			this.assertNoSymbolicLinkSegments(targetPath);
			if (!this.options.fs.existsSync(targetPath)) continue;
			const original = this.options.fs.readFileSync(targetPath, 'utf8');
			originals.set(file.path, original);
			const backupPath = this.resolve(backupDirectory, file.path);
			this.options.fs.mkdirSync(this.options.path.dirname(backupPath), { recursive: true });
			this.assertNoSymbolicLinkSegments(this.options.path.dirname(backupPath));
			this.options.fs.writeFileSync(backupPath, original, 'utf8');
		}

		const touched = new Set<string>();
		try {
			for (const file of changedFiles) {
				const targetPath = this.resolve(plan.targetDirectory, file.path);
				if (this.currentHash(plan.targetDirectory, file.path) !== plan.originalHashes.get(file.path)) {
					throw new ClientSkillPlanConflictError('Skill content changed during installation. Preview the change again.');
				}
				this.options.fs.mkdirSync(this.options.path.dirname(targetPath), { recursive: true });
				this.assertNoSymbolicLinkSegments(this.options.path.dirname(targetPath));
				this.assertNoSymbolicLinkSegments(targetPath);
				touched.add(file.path);
				this.options.fs.rmSync(targetPath, { force: true });
				this.options.fs.renameSync(this.resolve(stageDirectory, file.path), targetPath);
			}
		} catch (error) {
			for (const filePath of touched) {
				const targetPath = this.resolve(plan.targetDirectory, filePath);
				const original = originals.get(filePath);
				if (original === undefined) {
					this.options.fs.rmSync(targetPath, { force: true });
				} else {
					const restorePath = `${targetPath}.tracekeeper-restore-${nonce}`;
					this.options.fs.writeFileSync(restorePath, original, 'utf8');
					this.options.fs.rmSync(targetPath, { force: true });
					this.options.fs.renameSync(restorePath, targetPath);
				}
			}
			throw error;
		} finally {
			this.options.fs.rmSync(stageDirectory, { recursive: true, force: true });
		}

		return {
			action: expectedAction,
			clientId: plan.clientId,
			targetDirectory: plan.targetDirectory,
			backupDirectory: originals.size > 0 ? backupDirectory : '',
			bundleHash: this.options.bundle.manifest.bundle_hash,
		};
	}

	private hasManagedFiles(targetDirectory: string): boolean {
		this.assertNoSymbolicLinkSegments(targetDirectory);
		return Object.keys(this.options.bundle.installFiles).some((filePath) =>
			this.options.fs.existsSync(this.resolve(targetDirectory, filePath))
		);
	}

	private planFiles(targetDirectory: string): SkillInstallPlanFile[] {
		return Object.entries(this.options.bundle.installFiles).map(([filePath, expected]) => {
			const originalHash = this.currentHash(targetDirectory, filePath);
			return {
				path: filePath,
				change: originalHash === null ? 'create' : originalHash === hashSkillFileContent(expected) ? 'unchanged' : 'replace',
				originalHash,
			};
		});
	}

	private analyzeManagedDirectory(targetDirectory: string, profile?: ClientSkillProfile): ManagedDirectoryAnalysis {
		const manifestPath = this.resolve(targetDirectory, 'manifest.json');
		if (!this.options.fs.existsSync(manifestPath)) {
			return {
				state: 'modified',
				installedVersion: '',
				fileVerified: false,
				updateAvailable: false,
				detail: 'Skill files exist without a verifiable manifest.',
			};
		}
		let installedManifest: TracekeeperSkillManifest;
		try {
			const parsedManifest: unknown = JSON.parse(this.options.fs.readFileSync(manifestPath, 'utf8'));
			if (!isTracekeeperManifest(parsedManifest)) {
				return {
					state: 'modified',
					installedVersion: safeString((parsedManifest as { skill_version?: unknown } | null)?.skill_version),
					fileVerified: false,
					updateAvailable: false,
					detail: 'Skill manifest shape is not supported.',
				};
			}
			installedManifest = parsedManifest;
		} catch {
			return {
				state: 'modified',
				installedVersion: '',
				fileVerified: false,
				updateAvailable: false,
				detail: 'Installed Skill manifest cannot be parsed.',
			};
		}
		if (!this.verifyInstalledManifest(targetDirectory, installedManifest)) {
			return {
				state: 'modified',
				installedVersion: installedManifest.skill_version || '',
				fileVerified: false,
				updateAvailable: false,
				detail: 'Installed Skill content differs from its manifest.',
			};
		}
		const versionComparison = compareVersions(installedManifest.skill_version, this.options.bundle.manifest.skill_version);
		if (versionComparison === null) {
			return {
				state: 'modified',
				installedVersion: installedManifest.skill_version,
				fileVerified: false,
				updateAvailable: false,
				detail: 'Installed Skill version is not a comparable SemVer.',
			};
		}
		if (versionComparison > 0) {
			return {
				state: 'newer_than_bundled',
				installedVersion: installedManifest.skill_version,
				fileVerified: true,
				updateAvailable: false,
				detail: 'A verified newer Skill version is installed.',
			};
		}
		if (versionComparison === 0) {
			if (!this.matchesEmbeddedBundle(targetDirectory, installedManifest)) {
				return {
					state: 'modified',
					installedVersion: installedManifest.skill_version,
					fileVerified: false,
					updateAvailable: false,
					detail: 'Installed Skill version matches the embedded version but its content does not.',
				};
			}
			return {
				state: 'installed',
				installedVersion: installedManifest.skill_version,
				fileVerified: true,
				updateAvailable: false,
				detail: 'Installed files match the embedded bundle.',
			};
		}
		if (profile && !this.isOwnedBundle(profile, installedManifest)) {
			return {
				state: 'modified',
				installedVersion: installedManifest.skill_version,
				fileVerified: false,
				updateAvailable: false,
				detail: 'A verified older Skill is not owned by this local plugin installation, so automatic overwrite is disabled.',
			};
		}
		return {
			state: 'update_available',
			installedVersion: installedManifest.skill_version,
			fileVerified: true,
			updateAvailable: true,
			detail: 'A verified older official bundle can be updated.',
		};
	}

	private detectLegacyInstall(profile: ClientSkillProfile, legacyDirectory: string): SkillInstallState {
		const legacyAnalysis = this.analyzeManagedDirectory(legacyDirectory);
		if (legacyAnalysis.state === 'newer_than_bundled') {
			return this.state(
				profile,
				'newer_than_bundled',
				legacyAnalysis.fileVerified,
				false,
				legacyAnalysis.installedVersion,
				`Found newer legacy Skill at ${legacyDirectory}. Migrate is disabled to avoid downgrades.`
			);
		}
		if (legacyAnalysis.state === 'modified') {
			return this.state(
				profile,
				'modified',
				legacyAnalysis.fileVerified,
				false,
				legacyAnalysis.installedVersion,
				`Found a legacy Tracekeeper Skill path at ${legacyDirectory}, but it is not verifiable against a known manifest. Automatic overwrite is disabled.`
			);
		}
		return this.state(
			profile,
			'legacy_install',
			legacyAnalysis.fileVerified,
			false,
			legacyAnalysis.installedVersion,
			`Found a legacy Tracekeeper Skill path at ${legacyDirectory}. A non-destructive migrate can copy the embedded bundle to ${profile.targetDirectory}.`
		);
	}

	private verifyInstalledManifest(targetDirectory: string, manifest: TracekeeperSkillManifest): boolean {
		if (!manifest
			|| manifest.name !== 'tracekeeper'
			|| manifest.hash_algorithm !== 'sha256'
			|| !Number.isSafeInteger(manifest.format_version)
			|| !Array.isArray(manifest.files)
			|| !manifest.artifacts?.flattened) return false;
		const paths = manifest.files.map((file) => file.path);
		if (new Set(paths).size !== paths.length || paths.some((filePath) => !isSafeRelativePath(filePath))) return false;
		if (!isSafeRelativePath(manifest.artifacts.flattened.path)
			|| !/^sha256:[a-f0-9]{64}$/.test(manifest.artifacts.flattened.sha256)) return false;
		for (const file of manifest.files) {
			const targetPath = this.resolve(targetDirectory, file.path);
			if (!this.options.fs.existsSync(targetPath)
				|| hashSkillFileContent(this.options.fs.readFileSync(targetPath, 'utf8')) !== file.sha256) return false;
		}
		const canonicalBundle = [
			`tracekeeper-skill-bundle-v${manifest.format_version}`,
			...manifest.files.map((file) => `${file.path}\0${file.sha256}`),
			'',
		].join('\n');
		return hashRaw(canonicalBundle) === manifest.bundle_hash;
	}

	private matchesEmbeddedBundle(targetDirectory: string, manifest: TracekeeperSkillManifest): boolean {
		if (manifest.bundle_hash !== this.options.bundle.manifest.bundle_hash
			|| manifest.skill_version !== this.options.bundle.manifest.skill_version) return false;
		return Object.entries(this.options.bundle.installFiles).every(([filePath, expected]) => (
			this.currentHash(targetDirectory, filePath) === hashSkillFileContent(expected)
		));
	}

	private isOwnedBundle(profile: ClientSkillProfile | undefined, manifest: TracekeeperSkillManifest): boolean {
		return Boolean(profile
			&& profile.ownedBundleHash === manifest.bundle_hash
			&& profile.ownedSkillVersion === manifest.skill_version);
	}

	private currentHash(targetDirectory: string, filePath: string): string | null {
		const targetPath = this.resolve(targetDirectory, filePath);
		this.assertNoSymbolicLinkSegments(targetPath);
		return this.options.fs.existsSync(targetPath)
			? hashSkillFileContent(this.options.fs.readFileSync(targetPath, 'utf8'))
			: null;
	}

	private resolve(directory: string, filePath: string): string {
		if (!isSafeRelativePath(filePath)) throw new Error(`Unsafe Skill bundle path: ${filePath}`);
		return this.options.path.join(directory, ...filePath.split('/'));
	}

	private assertNoSymbolicLinkSegments(targetPath: string): void {
		let cursor = targetPath;
		while (cursor) {
			if (this.options.fs.existsSync(cursor)) {
				let state: { isSymbolicLink(): boolean };
				try {
					state = this.options.fs.lstatSync(cursor);
				} catch {
					throw new ClientSkillPlanConflictError(
						`Skill path changed while it was being inspected: ${cursor}`
					);
				}
				if (state.isSymbolicLink()) {
					throw new ClientSkillPlanConflictError(
						`Skill path contains a symbolic link: ${cursor}`
					);
				}
			}
			const parent = this.options.path.dirname(cursor);
			if (!parent || parent === cursor) {
				break;
			}
			cursor = parent;
		}
	}

	private state(
		profile: ClientSkillProfile,
		state: SkillInstallDetectionState,
		fileVerified: boolean,
		updateAvailable: boolean,
		installedVersion: string,
		detail: string
	): SkillInstallState {
		return {
			clientId: profile.id,
			targetId: profile.targetId,
			targetDirectory: profile.targetDirectory,
			legacyTargetDirectories: profile.legacyTargetDirectories ?? [],
			activationMode: profile.activationMode,
			restartRequired: profile.restartRequired,
			state,
			fileVerified,
			updateAvailable,
			installedVersion,
			expectedVersion: this.options.bundle.manifest.skill_version,
			detail,
		};
	}

	private publicPlan(
		profile: ClientSkillProfile,
		action: SkillInstallAction,
		files: SkillInstallPlanFile[],
		canConfirm: boolean,
		detail: string
	): SkillInstallPlan {
		return {
			planId: '',
			action,
			clientId: profile.id,
			targetDirectory: profile.targetDirectory,
			files,
			canConfirm,
			expiresAt: '',
			detail,
		};
	}

	private pruneExpiredPlans(): void {
		const now = this.now().getTime();
		for (const [planId, plan] of this.plans) {
			if (now > Date.parse(plan.expiresAt)) this.plans.delete(planId);
		}
	}
}

export function buildClientSkillProfile(
	clientId: string,
	displayName: string,
	homeDirectory: string | undefined,
	joinPath: (...parts: string[]) => string,
	targetDirectory?: string
): ClientSkillProfile {
	const trimmedId = clientId.trim();
	const resolved = buildClientSkillProfileFromRegistry(trimmedId, displayName || trimmedId, homeDirectory, joinPath);
	return {
		id: trimmedId,
		targetId: resolved.targetId,
		displayName: resolved.displayName,
		recommendation: resolved.recommendation,
		targetDirectory,
		restartRequired: resolved.restartRequired,
		profileLabel: resolved.profileLabel,
		activationMode: resolved.activationMode,
		legacyTargetDirectories: resolved.legacyTargetDirectories,
	};
}

function isTracekeeperManifest(value: unknown): value is TracekeeperSkillManifest {
	return typeof value === 'object'
		&& value !== null
		&& !Array.isArray(value)
		&& (value as TracekeeperSkillManifest).name === 'tracekeeper'
		&& typeof (value as TracekeeperSkillManifest).hash_algorithm === 'string'
		&& (value as TracekeeperSkillManifest).hash_algorithm !== ''
		&& Number.isSafeInteger((value as TracekeeperSkillManifest).format_version)
		&& Array.isArray((value as TracekeeperSkillManifest).files)
		&& typeof (value as TracekeeperSkillManifest).artifacts === 'object'
		&& (value as TracekeeperSkillManifest).artifacts !== null
		&& typeof (value as TracekeeperSkillManifest).artifacts.flattened === 'object'
		&& (value as TracekeeperSkillManifest).artifacts.flattened !== null;
}

interface ParsedSemver {
	major: number;
	minor: number;
	patch: number;
	preRelease: readonly string[];
}

function compareVersions(left: string, right: string): number | null {
	const leftVersion = parseVersion(left);
	const rightVersion = parseVersion(right);
	if (!leftVersion || !rightVersion) return null;
	for (const field of ['major', 'minor', 'patch'] as const) {
		if (leftVersion[field] === rightVersion[field]) continue;
		return leftVersion[field] < rightVersion[field] ? -1 : 1;
	}
	if (leftVersion.preRelease.length === 0 || rightVersion.preRelease.length === 0) {
		if (leftVersion.preRelease.length === rightVersion.preRelease.length) return 0;
		return leftVersion.preRelease.length === 0 ? 1 : -1;
	}
	const length = Math.max(leftVersion.preRelease.length, rightVersion.preRelease.length);
	for (let index = 0; index < length; index += 1) {
		const leftIdentifier = leftVersion.preRelease[index];
		const rightIdentifier = rightVersion.preRelease[index];
		if (leftIdentifier === undefined) return -1;
		if (rightIdentifier === undefined) return 1;
		if (leftIdentifier === rightIdentifier) continue;
		const leftNumeric = /^(0|[1-9][0-9]*)$/.test(leftIdentifier);
		const rightNumeric = /^(0|[1-9][0-9]*)$/.test(rightIdentifier);
		if (leftNumeric && rightNumeric) {
			return Number.parseInt(leftIdentifier, 10) < Number.parseInt(rightIdentifier, 10) ? -1 : 1;
		}
		if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
		return leftIdentifier < rightIdentifier ? -1 : 1;
	}
	return 0;
}

function parseVersion(value: string): ParsedSemver | null {
	const matched = value.trim().match(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
	if (!matched) return null;
	return {
		major: Number.parseInt(matched[1], 10),
		minor: Number.parseInt(matched[2], 10),
		patch: Number.parseInt(matched[3], 10),
		preRelease: matched[4] ? matched[4].split('.') : [],
	};
}

function safeString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function isSafeRelativePath(filePath: string): boolean {
	return Boolean(filePath)
		&& !filePath.startsWith('/')
		&& !filePath.includes('\\')
		&& !filePath.split('/').includes('..');
}

function hashRaw(value: string): string {
	return hashSkillFileContent(value.endsWith('\n') ? value : `${value}\n`);
}

function stripPrivatePlan(plan: StoredSkillInstallPlan): SkillInstallPlan {
	const { originalHashes: _originalHashes, ...publicPlan } = plan;
	return publicPlan;
}
