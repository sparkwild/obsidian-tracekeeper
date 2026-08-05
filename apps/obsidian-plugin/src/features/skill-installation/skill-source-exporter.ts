import {
	hashSkillFileContent,
	type EmbeddedTracekeeperSkillBundle,
} from './skill-bundle';

export interface SkillSourceFileApi {
	existsSync(path: string): boolean;
	lstatSync(path: string): { isSymbolicLink(): boolean };
	readFileSync(path: string, encoding: 'utf8'): string;
	writeFileSync(path: string, content: string, encoding: 'utf8'): void;
	mkdirSync(path: string, options: { recursive: boolean }): void;
	renameSync(oldPath: string, newPath: string): void;
	rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
}

export interface SkillSourcePathApi {
	dirname(path: string): string;
	join(...parts: string[]): string;
}

export interface SkillSourceExportOptions {
	fs: SkillSourceFileApi;
	path: SkillSourcePathApi;
	vaultRoot: string;
	configDir: string;
	pluginId: string;
	bundle: EmbeddedTracekeeperSkillBundle;
	nonce?: string;
}

export interface SkillSourceExportResult {
	sourceDirectory: string;
	bundleHash: string;
	skillVersion: string;
}

export function exportEmbeddedTracekeeperSkillSource(options: SkillSourceExportOptions): SkillSourceExportResult {
	const { fs, path, bundle } = options;
	const hashPrefix = bundle.manifest.bundle_hash.replace(/^sha256:/, '').slice(0, 16);
	const versionDirectory = `${bundle.manifest.skill_version}-${hashPrefix}`;
	const sourceRoot = path.join(options.vaultRoot, options.configDir, 'plugins', options.pluginId, 'skill-source', versionDirectory);
	const sourceDirectory = path.join(sourceRoot, 'tracekeeper');
	assertNoSymbolicLinkSegments(fs, path, sourceDirectory);
	if (isCompleteExport(fs, path, sourceDirectory, bundle)) {
		return {
			sourceDirectory,
			bundleHash: bundle.manifest.bundle_hash,
			skillVersion: bundle.manifest.skill_version,
		};
	}
	const nonce = options.nonce || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const stageDirectory = path.join(sourceRoot, `tracekeeper-stage-${nonce}`);
	const previousDirectory = path.join(sourceRoot, `tracekeeper-previous-${nonce}`);
	assertNoSymbolicLinkSegments(fs, path, stageDirectory);
	assertNoSymbolicLinkSegments(fs, path, previousDirectory);
	fs.mkdirSync(stageDirectory, { recursive: true });
	try {
		for (const [filePath, content] of Object.entries(bundle.installFiles)) {
			const targetPath = resolve(path, stageDirectory, filePath);
			fs.mkdirSync(path.dirname(targetPath), { recursive: true });
			assertNoSymbolicLinkSegments(fs, path, path.dirname(targetPath));
			fs.writeFileSync(targetPath, content, 'utf8');
		}
		assertNoSymbolicLinkSegments(fs, path, stageDirectory);
		if (!isCompleteExport(fs, path, stageDirectory, bundle)) {
			throw new Error('Staged Tracekeeper Skill source failed verification.');
		}
		const hadPrevious = fs.existsSync(sourceDirectory);
		if (hadPrevious) fs.renameSync(sourceDirectory, previousDirectory);
		try {
			fs.renameSync(stageDirectory, sourceDirectory);
		} catch (error) {
			if (hadPrevious && !fs.existsSync(sourceDirectory) && fs.existsSync(previousDirectory)) {
				fs.renameSync(previousDirectory, sourceDirectory);
			}
			throw error;
		}
		if (hadPrevious) fs.rmSync(previousDirectory, { recursive: true, force: true });
	} catch (error) {
		fs.rmSync(stageDirectory, { recursive: true, force: true });
		if (!fs.existsSync(sourceDirectory) && fs.existsSync(previousDirectory)) {
			fs.renameSync(previousDirectory, sourceDirectory);
		}
		throw error;
	}
	if (!isCompleteExport(fs, path, sourceDirectory, bundle)) {
		throw new Error('Exported Tracekeeper Skill source failed verification.');
	}
	return {
		sourceDirectory,
		bundleHash: bundle.manifest.bundle_hash,
		skillVersion: bundle.manifest.skill_version,
	};
}

function isCompleteExport(
	fs: SkillSourceFileApi,
	path: SkillSourcePathApi,
	root: string,
	bundle: EmbeddedTracekeeperSkillBundle
): boolean {
	try {
		assertNoSymbolicLinkSegments(fs, path, root);
		return Object.entries(bundle.installFiles).every(([filePath, expected]) => {
			const targetPath = resolve(path, root, filePath);
			return fs.existsSync(targetPath)
				&& hashSkillFileContent(fs.readFileSync(targetPath, 'utf8')) === hashSkillFileContent(expected);
		});
	} catch {
		return false;
	}
}

function resolve(path: SkillSourcePathApi, root: string, filePath: string): string {
	if (!filePath || filePath.startsWith('/') || filePath.includes('\\') || filePath.split('/').includes('..')) {
		throw new Error(`Unsafe Skill source path: ${filePath}`);
	}
	return path.join(root, ...filePath.split('/'));
}

function assertNoSymbolicLinkSegments(fs: SkillSourceFileApi, path: SkillSourcePathApi, targetPath: string): void {
	let cursor = targetPath;
	while (cursor) {
		if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
			throw new Error(`Skill source path contains a symbolic link: ${cursor}`);
		}
		const parent = path.dirname(cursor);
		if (!parent || parent === cursor) break;
		cursor = parent;
	}
}
