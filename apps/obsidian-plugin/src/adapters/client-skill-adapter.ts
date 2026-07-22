import { randomBytes } from 'node:crypto';
import {
	hashSkillFileContent,
	normalizeSkillFileContent,
	type EmbeddedTracekeeperSkillBundle,
	type TracekeeperSkillManifest,
} from '../features/skill-installation/skill-bundle';

export type SkillInstallDetectionState = 'not_installed' | 'installed' | 'update_available' | 'modified' | 'unavailable';
export type SkillInstallAction = 'install' | 'update' | 'conflict' | 'copy_only' | 'none';
export type SkillFileChange = 'create' | 'replace' | 'unchanged';

export interface ClientSkillProfile {
	id: string;
	displayName: string;
	supportsManagedInstall: boolean;
	targetDirectory?: string;
	restartRequired: boolean;
	profileLabel: string;
}

export interface SkillInstallState {
	clientId: string;
	targetDirectory?: string;
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
	action: 'install' | 'update';
	clientId: string;
	targetDirectory: string;
	backupDirectory: string;
	bundleHash: string;
}

export interface ClientSkillFileApi {
	existsSync(path: string): boolean;
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
		if (!profile.supportsManagedInstall || !profile.targetDirectory) {
			return this.state(profile, 'unavailable', false, false, '', 'This client uses copy-only Skill guidance.');
		}
		const targetDirectory = profile.targetDirectory;
		const expectedFiles = this.options.bundle.installFiles;
		const anyManagedFile = Object.keys(expectedFiles).some((filePath) =>
			this.options.fs.existsSync(this.resolve(targetDirectory, filePath))
		);
		if (!anyManagedFile) {
			return this.state(profile, 'not_installed', false, false, '', 'Tracekeeper Skill files were not found.');
		}

		const manifestPath = this.resolve(targetDirectory, 'manifest.json');
		if (!this.options.fs.existsSync(manifestPath)) {
			return this.state(profile, 'modified', false, false, '', 'Skill files exist without a verifiable manifest.');
		}
		let installedManifest: TracekeeperSkillManifest;
		try {
			installedManifest = JSON.parse(this.options.fs.readFileSync(manifestPath, 'utf8')) as TracekeeperSkillManifest;
			if (!this.verifyInstalledManifest(targetDirectory, installedManifest)) {
				return this.state(profile, 'modified', false, false, installedManifest.skill_version || '', 'Installed Skill content differs from its manifest.');
			}
		} catch {
			return this.state(profile, 'modified', false, false, '', 'Installed Skill manifest cannot be verified.');
		}

		const matchesEmbedded = Object.entries(expectedFiles).every(([filePath, content]) => {
			const targetPath = this.resolve(targetDirectory, filePath);
			return this.options.fs.existsSync(targetPath)
				&& normalizeSkillFileContent(this.options.fs.readFileSync(targetPath, 'utf8')) === content;
		});
		if (matchesEmbedded) {
			return this.state(profile, 'installed', true, false, installedManifest.skill_version, 'Installed files match the embedded bundle.');
		}
		return this.state(profile, 'update_available', false, true, installedManifest.skill_version, 'A verified older official bundle can be updated.');
	}

	previewInstall(profile: ClientSkillProfile): SkillInstallPlan {
		return this.preview(profile, 'install');
	}

	previewUpdate(profile: ClientSkillProfile): SkillInstallPlan {
		return this.preview(profile, 'update');
	}

	confirmInstall(planId: string): SkillInstallResult {
		return this.commit(planId, 'install');
	}

	confirmUpdate(planId: string): SkillInstallResult {
		return this.commit(planId, 'update');
	}

	private preview(profile: ClientSkillProfile, requestedAction: 'install' | 'update'): SkillInstallPlan {
		this.pruneExpiredPlans();
		const detected = this.detect(profile);
		if (!profile.supportsManagedInstall || !profile.targetDirectory) {
			return this.publicPlan(profile, 'copy_only', [], false, 'Use the flattened compatibility Skill or manual bundle instructions.');
		}
		if (detected.state === 'modified') {
			return this.publicPlan(profile, 'conflict', this.planFiles(profile.targetDirectory), false, 'Installed files were modified. Automatic overwrite is disabled.');
		}
		if (detected.state === 'installed') {
			return this.publicPlan(profile, 'none', this.planFiles(profile.targetDirectory), false, 'The embedded Skill bundle is already installed.');
		}
		const action = detected.state === 'update_available' ? 'update' : 'install';
		if (requestedAction !== action) {
			throw new ClientSkillPlanConflictError(`Expected a Skill ${action} preview.`);
		}
		const files = this.planFiles(profile.targetDirectory);
		const createdAt = this.now();
		const planId = `client-skill-${randomBytes(12).toString('hex')}`;
		const plan: StoredSkillInstallPlan = {
			planId,
			action,
			clientId: profile.id,
			targetDirectory: profile.targetDirectory,
			files,
			canConfirm: true,
			expiresAt: new Date(createdAt.getTime() + this.planTtlMs).toISOString(),
			detail: action === 'install' ? 'Install the embedded Skill bundle.' : 'Update the verified official Skill bundle.',
			originalHashes: new Map(files.map((file) => [file.path, file.originalHash])),
		};
		this.plans.set(planId, plan);
		return stripPrivatePlan(plan);
	}

	private commit(planId: string, expectedAction: 'install' | 'update'): SkillInstallResult {
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
		this.options.fs.mkdirSync(stageDirectory, { recursive: true });
		for (const file of changedFiles) {
			const stagePath = this.resolve(stageDirectory, file.path);
			this.options.fs.mkdirSync(this.options.path.dirname(stagePath), { recursive: true });
			this.options.fs.writeFileSync(stagePath, this.options.bundle.installFiles[file.path], 'utf8');
		}

		const originals = new Map<string, string>();
		for (const file of changedFiles) {
			const targetPath = this.resolve(plan.targetDirectory, file.path);
			if (!this.options.fs.existsSync(targetPath)) continue;
			const original = this.options.fs.readFileSync(targetPath, 'utf8');
			originals.set(file.path, original);
			const backupPath = this.resolve(backupDirectory, file.path);
			this.options.fs.mkdirSync(this.options.path.dirname(backupPath), { recursive: true });
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

	private verifyInstalledManifest(targetDirectory: string, manifest: TracekeeperSkillManifest): boolean {
		if (!manifest
			|| manifest.name !== 'tracekeeper'
			|| manifest.hash_algorithm !== 'sha256'
			|| !Number.isSafeInteger(manifest.format_version)
			|| !Array.isArray(manifest.files)
			|| !manifest.artifacts?.flattened) return false;
		const paths = [...manifest.files.map((file) => file.path), manifest.artifacts.flattened.path];
		if (new Set(paths).size !== paths.length || paths.some((filePath) => !isSafeRelativePath(filePath))) return false;
		for (const file of [...manifest.files, manifest.artifacts.flattened]) {
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

	private currentHash(targetDirectory: string, filePath: string): string | null {
		const targetPath = this.resolve(targetDirectory, filePath);
		return this.options.fs.existsSync(targetPath)
			? hashSkillFileContent(this.options.fs.readFileSync(targetPath, 'utf8'))
			: null;
	}

	private resolve(directory: string, filePath: string): string {
		if (!isSafeRelativePath(filePath)) throw new Error(`Unsafe Skill bundle path: ${filePath}`);
		return this.options.path.join(directory, ...filePath.split('/'));
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
			targetDirectory: profile.targetDirectory,
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
	joinPath: (...parts: string[]) => string
): ClientSkillProfile {
	const managed = clientId === 'codex' && Boolean(homeDirectory);
	return {
		id: clientId,
		displayName,
		supportsManagedInstall: managed,
		targetDirectory: managed && homeDirectory
			? joinPath(homeDirectory, '.codex', 'skills', 'tracekeeper')
			: undefined,
		restartRequired: clientId !== 'custom',
		profileLabel: clientId === 'codex' ? 'Local default profile' : 'Local copy-only profile',
	};
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
