import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { NodeFileOperationJournal } from './operation-journal';
import { TRACEKEEPER_OPERATIONS_DIR } from './knowledge-architecture';
import { LogArchive } from './log-archive';
import { assertLogPath, isMissingLogFile, logHash, readLogFile, writeLogFile } from './log-files';
export const LOG_STORAGE_ROOT = '.tracekeeper/logs';
interface Activation {
	version: 1;
	state: 'active';
	backup: string | null;
	activatedAt: string;
	keyHash?: string;
}
const migrationStatePath = (vault: string) => path.join(vault, '.tracekeeper', '.log-migration-state');
const activatedPath = (vault: string) => path.join(vault, LOG_STORAGE_ROOT, 'ACTIVE');
export function logDirectory(vault: string): string {
	const modern = path.join(vault, LOG_STORAGE_ROOT, 'data');
	let component = vault;
	for (const part of ['', '.tracekeeper', 'logs']) {
		if (part)
			component = path.join(component, part);
		if (fs.existsSync(component) && fs.lstatSync(component).isSymbolicLink())
			throw new Error('Log storage root contains a symbolic link.');
	}
	if (fs.existsSync(activatedPath(vault))) {
		const stat = fs.lstatSync(activatedPath(vault));
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
			throw new Error('Invalid log activation file.');
		const activation = JSON.parse(fs.readFileSync(activatedPath(vault), 'utf8')) as Activation;
		if (activation.version !== 1 || activation.state !== 'active')
			throw new Error('Unsupported log storage version.');
		if (!fs.existsSync(modern) || !fs.lstatSync(modern).isDirectory() || fs.lstatSync(modern).isSymbolicLink())
			throw new Error('Activated log data is missing or invalid; restore backup.');
		if (activation.keyHash) {
			const keyPath = path.join(modern, '.payload-encryption-key');
			if (!fs.existsSync(keyPath) || fs.lstatSync(keyPath).isSymbolicLink() || logHash(Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64')) !== activation.keyHash)
				throw new Error('Log key does not match the activated store.');
		}
		return modern;
	}
	const legacy = path.join(vault, TRACEKEEPER_OPERATIONS_DIR);
	return fs.existsSync(legacy) ? legacy : modern;
}
export function isOperationalLogPath(relative: string): boolean { return !relative.startsWith(`${TRACEKEEPER_OPERATIONS_DIR}/legacy-link-probes`) && (relative === TRACEKEEPER_OPERATIONS_DIR || relative.startsWith(`${TRACEKEEPER_OPERATIONS_DIR}/`)); }
const initializations = new Map<string, Promise<void>>();
async function initialize(vault: string): Promise<void> {
 await assertLogPath(vault,path.join(vault,LOG_STORAGE_ROOT));
 if(logDirectory(vault)===path.join(vault,TRACEKEEPER_OPERATIONS_DIR)||fs.existsSync(activatedPath(vault)))return;
 const existing=initializations.get(vault);if(existing)return existing;
 const action=(async()=>{
  const coordinator=new NodeFileOperationJournal({directory:path.join(vault,'.tracekeeper','initialization-control')});
  const release=await coordinator.acquireLock('initialize-log-store');
  try {
   if(fs.existsSync(activatedPath(vault)))return;
   if(fs.existsSync(path.join(vault,LOG_STORAGE_ROOT)))throw new Error('Unrecognized log storage directory; inspect migration state first.');
   const activation:Activation={version:1,state:'active',backup:null,activatedAt:new Date().toISOString()};
   await fsp.mkdir(path.join(vault,LOG_STORAGE_ROOT,'data'),{recursive:true});
   await writeLogFile(vault,activatedPath(vault),JSON.stringify(activation));
  } finally {await release();}
 })();
 initializations.set(vault,action);
 try{await action;}finally{if(initializations.get(vault)===action)initializations.delete(vault);}
}

export function createVaultOperationJournal(vault: string): NodeFileOperationJournal {
	const directory = logDirectory(vault);
	return new NodeFileOperationJournal({ directory, beforeWrite: async () => {
			if (directory !== logDirectory(vault))
				throw new Error('Log storage changed; reacquire the provider.');
			await initialize(vault);
			if (directory !== logDirectory(vault)) throw new Error('Log storage changed during initialization.');
		}, onKeyCreated: async (key) => {
			if (fs.existsSync(activatedPath(vault))) {
				const raw = JSON.parse((await readLogFile(vault, activatedPath(vault), 4096))!) as Activation;
				await writeLogFile(vault, activatedPath(vault), JSON.stringify({ ...raw, keyHash: logHash(key) }));
			}
		} });
}
/** 历史逻辑引用保持稳定，只有该适配器负责解析物理存储位置。 */
export class OperationalLogRepository {
	constructor(readonly vault: string) { }
	private name(logical: string): string {
		if (!logical.startsWith(`${TRACEKEEPER_OPERATIONS_DIR}/`))
			throw new Error('Not an operational log reference.');
		const name = logical.slice(TRACEKEEPER_OPERATIONS_DIR.length + 1);
		if (name.split('/').some(part => !part || part === '.' || part === '..') || name.includes('\\'))
			throw new Error('Invalid operational log reference.');
		return name;
	}
	async readText(logical: string): Promise<string | null> {
		const root = logDirectory(this.vault), name = this.name(logical);
		await assertLogPath(this.vault, root);
		return await readLogFile(root, path.join(root, name)) ?? await new LogArchive(root).read(name);
	}
	async replaceText(logical: string, expectedHash: string | null, content: string): Promise<void> {
		const journal = createVaultOperationJournal(this.vault), release = await journal.acquireLock(`receipt:${logical}`);
		try {
			return await journal.coordinate(async () => {
				const current = await this.readText(logical);
				if (current === content)
					return;
				if ((current === null ? null : logHash(current)) !== expectedHash)
					throw new Error('Operational receipt changed concurrently.');
				const root = logDirectory(this.vault), name = this.name(logical);
				if (await new LogArchive(root).read(name) !== null)
					throw new Error('Archived receipts are immutable.');
				await journal.initializeStorage();
				await writeLogFile(root, path.join(root, name), content);
			});
		}
		finally {
			await release();
		}
	}
	async list(prefix = TRACEKEEPER_OPERATIONS_DIR): Promise<string[]> {
		if (!isOperationalLogPath(prefix))
			throw new Error('Invalid log prefix.');
		const root = logDirectory(this.vault), found = new Set<string>();
		await assertLogPath(this.vault, root);
		const walk = async (directory: string): Promise<void> => {
			for (const item of await fsp.readdir(directory, { withFileTypes: true }).catch(error => {
				if (isMissingLogFile(error))
					return [];
				throw error;
			})) {
				if (item.name.startsWith('.'))
					continue;
				if (item.isSymbolicLink())
					throw new Error('Log storage contains a symbolic link.');
				const file = path.join(directory, item.name);
				if (item.isDirectory())
					await walk(file);
				else if (item.isFile())
					found.add(`${TRACEKEEPER_OPERATIONS_DIR}/${path.relative(root, file).split(path.sep).join('/')}`);
			}
		};
		await walk(root);
		for (const name of (await new LogArchive(root).entries()).keys())
			if (!name.startsWith('.'))
				found.add(`${TRACEKEEPER_OPERATIONS_DIR}/${name}`);
		return [...found].filter(name => name.startsWith(`${prefix}/`)).sort();
	}
}
export interface VaultBackupManifest {
	version: 1;
	createdAt: string;
	files: Array<{
		name: string;
		bytes: number;
		hash: string;
	}>;
	directories?: string[];
}
const transient = (name: string): boolean => {
	if (name === '.tracekeeper/.log-migration-state' || name === '.migration-staging' || name.startsWith('.migration-staging/') || name === '.tracekeeper/migration-control' || name.startsWith('.tracekeeper/migration-control/') || name === '.tracekeeper/initialization-control' || name.startsWith('.tracekeeper/initialization-control/'))
		return true;
	const operational = name.startsWith(TRACEKEEPER_OPERATIONS_DIR + '/') || name.startsWith(LOG_STORAGE_ROOT + '/');
	return operational && (/(?:^|\/)\.coordination(?:\/|$)/.test(name) || /(?:\.lock|\.tmp-[a-f0-9-]+)$/.test(name));
};
async function fileDigest(root: string, file: string): Promise<{
	bytes: number;
	hash: string;
}> {
	await assertLogPath(root, file);
	const handle = await fsp.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
	try {
		if (!(await handle.stat()).isFile())
			throw new Error('Backup encountered a non-regular file.');
		const digest = createHash('sha256'), buffer = Buffer.alloc(128 * 1024);
		let bytes = 0;
		for (;;) {
			const read = await handle.read(buffer, 0, buffer.length, null);
			if (!read.bytesRead)
				break;
			digest.update(buffer.subarray(0, read.bytesRead));
			bytes += read.bytesRead;
		}
		return { bytes, hash: digest.digest('hex') };
	}
	finally {
		await handle.close();
	}
}
async function copyBackupFile(sourceRoot: string, source: string, targetRoot: string, target: string, expected: string): Promise<void> {
	await assertLogPath(sourceRoot, source);
	await assertLogPath(targetRoot, target);
	await fsp.mkdir(path.dirname(target), { recursive: true });
	await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
	const handle = await fsp.open(target, 'r+');
	try {
		await handle.sync();
	}
	finally {
		await handle.close();
	}
	if ((await fileDigest(targetRoot, target)).hash !== expected)
		throw new Error('Backup copy does not match its snapshot.');
}
async function inventory(root: string, directories?: Set<string>, operational = false): Promise<VaultBackupManifest['files']> {
	const files: VaultBackupManifest['files'] = [];
	const walk = async (directory: string): Promise<void> => {
		for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
			const target = path.join(directory, entry.name), name = path.relative(root, target).split(path.sep).join('/');
			if (transient(name) || (operational && transient(`${TRACEKEEPER_OPERATIONS_DIR}/${name}`)))
				continue;
			if (entry.isSymbolicLink())
				throw new Error('Backup cannot follow symbolic links.');
			if (entry.isDirectory()) {
				directories?.add(name);
				await walk(target);
			}
			else if (entry.isFile()) {
				files.push({ name, ...await fileDigest(root, target) });
			}
			else
				throw new Error('Backup encountered a non-regular file.');
		}
	};
	await assertLogPath(root);
	await walk(root);
	return files.sort((a, b) => a.name.localeCompare(b.name));
}
function requireSeparateDirectory(vault: string, destination: string): void {
	if (!path.isAbsolute(destination))
		throw new Error('Choose an absolute backup directory.');
	const source = fs.realpathSync(vault);
	const target = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
	const relative = path.relative(source, target), reverse = path.relative(target, source);
	if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative)) || (!reverse.startsWith('..') && !path.isAbsolute(reverse)))
		throw new Error('Backup and Vault directories must be separate.');
	if (fs.existsSync(destination))
		throw new Error('Backup destination must not already exist.');
}
export async function backupVault(vault: string, destination: string): Promise<VaultBackupManifest> {
	requireSeparateDirectory(vault, destination);
	await assertLogPath(path.dirname(destination), destination);
	const directories = new Set<string>();
	const files = await inventory(vault, directories), needed = files.reduce((sum, row) => sum + row.bytes, 0);
	const space = await fsp.statfs(path.dirname(destination));
	if (space.bavail * space.bsize < needed * 1.1)
		throw new Error('Insufficient space for a verified Vault backup.');
	await fsp.mkdir(destination, { mode: 0o700 });
	const data = path.join(destination, 'vault');
	await fsp.mkdir(data, { mode: 0o700 });
	for (const directory of [...directories].sort())
		await fsp.mkdir(path.join(data, directory), { recursive: true, mode: 0o700 });
	for (const row of files) {
		if ((await fileDigest(vault, path.join(vault, row.name))).hash !== row.hash)
			throw new Error('Vault changed during backup. No valid backup was committed.');
		await copyBackupFile(vault, path.join(vault, row.name), data, path.join(data, row.name), row.hash);
	}
	const currentDirectories = new Set<string>();
	if (JSON.stringify(await inventory(vault, currentDirectories)) !== JSON.stringify(files) || JSON.stringify([...currentDirectories].sort()) !== JSON.stringify([...directories].sort()) || JSON.stringify(await inventory(data)) !== JSON.stringify(files))
		throw new Error('Vault changed during backup verification.');
	const manifest: VaultBackupManifest = { version: 1, createdAt: new Date().toISOString(), files, directories: [...directories].sort() };
	await writeLogFile(destination, path.join(destination, 'backup.json'), JSON.stringify(manifest));
	return manifest;
}
export async function restoreVaultBackup(backup: string, destination: string): Promise<void> {
	requireSeparateDirectory(backup, destination);
	const raw = await readLogFile(backup, path.join(backup, 'backup.json'), 32 * 1024 * 1024);
	if (!raw)
		throw new Error('A verified backup manifest is required.');
	const manifest = JSON.parse(raw) as VaultBackupManifest;
	const directories = new Set<string>();
	const actual = await inventory(path.join(backup, 'vault'), directories);
	if (manifest.version !== 1 || !Array.isArray(manifest.files) || JSON.stringify(actual) !== JSON.stringify(manifest.files) || (manifest.directories && JSON.stringify([...directories].sort()) !== JSON.stringify(manifest.directories)))
		throw new Error('Backup verification failed.');
	await assertLogPath(path.dirname(destination), destination);
	await fsp.mkdir(destination, { mode: 0o700 });
	for (const directory of manifest.directories ?? []) {
		const target = path.join(destination, directory);
		await assertLogPath(destination, target);
		await fsp.mkdir(target, { recursive: true, mode: 0o700 });
	}
	for (const row of manifest.files)
		await copyBackupFile(path.join(backup, 'vault'), path.join(backup, 'vault', row.name), destination, path.join(destination, row.name), row.hash);
	if (JSON.stringify(await inventory(destination)) !== JSON.stringify(manifest.files))
		throw new Error('Restored Vault failed verification.');
}
export interface LogMigrationPreview {
	version: 1;
	inventoryHash: string;
	files: number;
	bytes: number;
	canMigrate: boolean;
	issues: string[];
	resumable?: boolean;
	backupFiles?: number;
	backupBytes?: number;
}
export async function previewLogMigration(vault: string): Promise<LogMigrationPreview> {
	const pending = await readLogFile(vault, migrationStatePath(vault), 4096);
	if (pending !== null) {
		const state = JSON.parse(pending) as MigrationState;
		if (state.version !== 1 || !/^[a-f0-9]{64}$/.test(state.inventoryHash))
			throw new Error('Invalid migration state.');
		return { version: 1, resumable: true, inventoryHash: state.inventoryHash, files: 0, bytes: 0, canMigrate: true, issues: ['Resume the owned migration with its original backup directory.'] };
	}
	const legacy = path.join(vault, TRACEKEEPER_OPERATIONS_DIR);
	if (fs.existsSync(activatedPath(vault)))
		return { version: 1, inventoryHash: '', files: 0, bytes: 0, canMigrate: false, issues: ['Log storage is already active.'] };
	const files = fs.existsSync(legacy) ? await inventory(legacy, undefined, true) : [];
	const issues: string[] = [];
	if (fs.existsSync(legacy)) {
		const entries = await fsp.readdir(legacy);
		if (entries.some(name => name.endsWith('.lock'))) issues.push('Wait for active log writers or recover their interrupted operations before migration.');
	}
	for (const row of files.filter(row => row.name.endsWith('.json'))) {
		try {
			const value = JSON.parse((await fsp.readFile(path.join(legacy, row.name))).toString('utf8'));
			if (['in_progress', 'running', 'activity_pending'].includes(value.status))
				issues.push(`Operation must reach a safe boundary: ${row.name}`);
		}
		catch {
			issues.push(`Invalid log: ${row.name}`);
		}
	}
	if (files.length)
		try {
			await new NodeFileOperationJournal({ directory: legacy }).verifyStorage();
		}
		catch {
			issues.push('Operation integrity verification failed. Restore or repair before migration.');
		}
	const vaultFiles = await inventory(vault);
	return { version: 1, backupFiles: vaultFiles.length, backupBytes: vaultFiles.reduce((sum, row) => sum + row.bytes, 0), inventoryHash: logHash(JSON.stringify(files)), files: files.length, bytes: files.reduce((sum, row) => sum + row.bytes, 0), canMigrate: issues.length === 0, issues };
}
interface MigrationState {
	version: 1;
	phase: 'backed_up' | 'verified' | 'active';
	backup: string;
	token: string;
	inventoryHash: string;
}
/** 切换前后分别续作，绝不把旧日志恢复到已有新写入的 Vault。 */
async function migrateLogStorageOwned(vault: string, destination: string, preview: LogMigrationPreview): Promise<void> {
	const stateRaw = await readLogFile(vault, migrationStatePath(vault), 4096);
	let state = stateRaw === null ? null : JSON.parse(stateRaw) as MigrationState;
	if (state && (state.version !== 1 || state.backup !== destination || state.inventoryHash !== preview.inventoryHash || !/^[a-f0-9]{24}$/.test(state.token)))
		throw new Error('Migration ownership does not match this request.');
	let backup: VaultBackupManifest;
	if (!state) {
		const current = await previewLogMigration(vault);
		if (!preview.canMigrate || !current.canMigrate || current.inventoryHash !== preview.inventoryHash)
			throw new Error('Migration preview is stale or blocked.');
		backup = await backupVault(vault, destination);
		state = { version: 1, phase: 'backed_up', backup: destination, token: randomBytes(12).toString('hex'), inventoryHash: preview.inventoryHash };
		await writeLogFile(vault, migrationStatePath(vault), JSON.stringify(state));
	}
	else {
		const raw = await readLogFile(destination, path.join(destination, 'backup.json'), 32 * 1024 * 1024);
		if (raw === null)
			throw new Error('The migration backup is missing.');
		backup = JSON.parse(raw) as VaultBackupManifest;
		if (backup.version !== 1 || JSON.stringify(await inventory(path.join(destination, 'vault'))) !== JSON.stringify(backup.files))
			throw new Error('Migration backup verification failed.');
	}
	const legacy = path.join(vault, TRACEKEEPER_OPERATIONS_DIR), modernRoot = path.join(vault, LOG_STORAGE_ROOT), stage = path.join(vault, '.migration-staging', state.token), data = path.join(modernRoot, 'data');
	const logFiles = backup.files.filter(row => row.name.startsWith(`${TRACEKEEPER_OPERATIONS_DIR}/`));
	const activation = await readLogFile(vault, activatedPath(vault), 4096);
	if (activation !== null) {
		const active = JSON.parse(activation) as Activation;
		if (active.version !== 1 || active.state !== 'active' || active.backup !== destination)
			throw new Error('Migration activation conflicts with another store.');
		state.phase = 'active';
	}
	if (state.phase !== 'active') {
		const before = await inventory(vault);
		// 已经完成数据目录 rename、尚未发布 ACTIVE 的中断也属于同一迁移。
		const relevant = before.filter(row => !row.name.startsWith(LOG_STORAGE_ROOT + '/'));
		if (JSON.stringify(relevant) !== JSON.stringify(backup.files))
			throw new Error('Vault changed since its backup. Migration remains inactive.');
		await assertLogPath(vault, modernRoot);
		if (fs.existsSync(modernRoot) && state.phase !== 'verified')
			throw new Error('New log storage path is occupied.');
		if (!fs.existsSync(data)) {
			await fsp.mkdir(stage, { recursive: true });
			for (const row of logFiles) {
				const target = path.join(stage, row.name.slice(TRACEKEEPER_OPERATIONS_DIR.length + 1));
				await writeLogFile(stage, target, await fsp.readFile(path.join(destination, 'vault', row.name)));
			}
			await new NodeFileOperationJournal({ directory: stage }).verifyStorage();
			state.phase = 'verified';
			await writeLogFile(vault, migrationStatePath(vault), JSON.stringify(state));
			await fsp.mkdir(modernRoot, { recursive: true });
			await fsp.rename(stage, data);
		}
		for (const row of logFiles)
			if (logHash(await fsp.readFile(path.join(data, row.name.slice(TRACEKEEPER_OPERATIONS_DIR.length + 1)))) !== row.hash)
				throw new Error('Staged log verification failed.');
		if (JSON.stringify((await inventory(vault)).filter(row => !row.name.startsWith(LOG_STORAGE_ROOT + '/'))) !== JSON.stringify(backup.files))
			throw new Error('Vault changed before migration activation.');
		const importedKey = await readLogFile(data, path.join(data, '.payload-encryption-key'), 128);
		await writeLogFile(vault, activatedPath(vault), JSON.stringify({ version: 1, state: 'active', backup: destination, activatedAt: new Date().toISOString(), ...(importedKey ? { keyHash: logHash(Buffer.from(importedKey.trim(), 'base64')) } : {}) } satisfies Activation));
		state.phase = 'active';
		await writeLogFile(vault, migrationStatePath(vault), JSON.stringify(state));
	}
	await createVaultOperationJournal(vault).verifyStorage();
	for (const row of logFiles) {
		const original = path.join(vault, row.name);
		const bytes = await fsp.readFile(original).catch(error => {
			if (isMissingLogFile(error))
				return null;
			throw error;
		});
		if (bytes === null)
			continue;
		if (logHash(bytes) !== row.hash)
			throw new Error('Old log changed after activation; old copy retained.');
		await fsp.unlink(original);
	}
	const empty = async (directory: string): Promise<void> => {
		for (const entry of await fsp.readdir(directory, { withFileTypes: true }))
			if (entry.isDirectory())
				await empty(path.join(directory, entry.name));
		await fsp.rmdir(directory).catch(error => {
			if (error.code !== 'ENOTEMPTY')
				throw error;
		});
	};
	if (fs.existsSync(legacy)) {
		await fsp.unlink(path.join(legacy, '.coordination', 'revision')).catch(error => {
			if (!isMissingLogFile(error))
				throw error;
		});
		await empty(legacy);
	}
	await fsp.unlink(migrationStatePath(vault));
}
export function logStorageIsActive(vault: string): boolean { return fs.existsSync(activatedPath(vault)); }
/** 同一 Vault 的迁移与取消共用租约，避免两个窗口争用同一暂存目录。 */
export async function migrateLogStorage(vault: string, destination: string, preview: LogMigrationPreview): Promise<void> {
	const coordinator = new NodeFileOperationJournal({ directory: path.join(vault, '.tracekeeper', 'migration-control') });
	const release = await coordinator.acquireLock('log-storage-migration');
	try {
		const lockDirectory = logStorageIsActive(vault) ? logDirectory(vault) : path.join(vault, TRACEKEEPER_OPERATIONS_DIR);
		const storage = new NodeFileOperationJournal({ directory: lockDirectory });
		await storage.coordinate(() => migrateLogStorageOwned(vault, destination, preview));
		if (logStorageIsActive(vault)) {
			const legacy = path.join(vault, TRACEKEEPER_OPERATIONS_DIR);
			await fsp.rmdir(path.join(legacy, '.coordination')).catch(error => { if (!['ENOENT','ENOTEMPTY'].includes(error.code)) throw error; });
			await fsp.rmdir(legacy).catch(error => { if (!['ENOENT','ENOTEMPTY'].includes(error.code)) throw error; });
		}
	}
	finally {
		await release();
	}
}
export async function cancelLogMigration(vault: string): Promise<void> {
	const coordinator = new NodeFileOperationJournal({ directory: path.join(vault, '.tracekeeper', 'migration-control') });
	const release = await coordinator.acquireLock('log-storage-migration');
	try {
		if (logStorageIsActive(vault))
			throw new Error('Activated storage cannot be cancelled; restore the whole Vault backup instead.');
		const raw = await readLogFile(vault, migrationStatePath(vault), 4096);
		if (raw === null)
			return;
		const state = JSON.parse(raw) as MigrationState;
		if (state.version !== 1 || !/^[a-f0-9]{24}$/.test(state.token))
			throw new Error('Invalid migration ownership.');
		const manifestRaw = await readLogFile(state.backup, path.join(state.backup, 'backup.json'), 32 * 1024 * 1024);
		if (!manifestRaw)
			throw new Error('Migration backup is missing.');
		const manifest = JSON.parse(manifestRaw) as VaultBackupManifest;
		const expected = new Map(manifest.files.filter(row => row.name.startsWith(TRACEKEEPER_OPERATIONS_DIR + '/')).map(row => [row.name.slice(TRACEKEEPER_OPERATIONS_DIR.length + 1), row.hash]));
		for (const directory of [path.join(vault, '.migration-staging', state.token), path.join(vault, LOG_STORAGE_ROOT, 'data')]) {
			if (!fs.existsSync(directory))
				continue;
			const files = await inventory(directory);
			if (files.some(row => expected.get(row.name) !== row.hash))
				throw new Error('Staged files changed; cancellation requires inspection.');
			for (const row of files)
				await fsp.unlink(path.join(directory, row.name));
			const removeEmpty = async (folder: string): Promise<void> => {
				for (const entry of await fsp.readdir(folder, { withFileTypes: true }))
					if (entry.isDirectory())
						await removeEmpty(path.join(folder, entry.name));
				await fsp.rmdir(folder);
			};
			await removeEmpty(directory);
		}
		await fsp.rmdir(path.join(vault, LOG_STORAGE_ROOT)).catch(error => {
			if (!isMissingLogFile(error))
				throw error;
		});
		await fsp.unlink(migrationStatePath(vault));
	}
	finally {
		await release();
	}
}
/** 诊断导出只包含计数、状态和脱敏问题，不携带日志正文、密钥或本机 Vault 路径。 */
export async function exportLogDiagnostics(vault: string, destination: string): Promise<void> {
	if (!path.isAbsolute(destination))
		throw new Error('Choose an absolute diagnostic file path.');
	await assertLogPath(path.dirname(destination), destination);
	const summary = await createVaultOperationJournal(vault).inspect();
	const handle = await fsp.open(destination, 'wx', 0o600);
	try {
		await handle.writeFile(JSON.stringify({ schema_version: 1, created_at: new Date().toISOString(), log_storage: summary }, null, 2));
		await handle.sync();
	}
	finally {
		await handle.close();
	}
}
export async function logBackupSummary(vault: string): Promise<{ count:number;bytes:number;available:boolean;directory?:string }> {
 const raw=await readLogFile(vault,activatedPath(vault),4096);
 let directory=raw?(JSON.parse(raw) as Activation).backup:null;
 if (!directory) { const pending=await readLogFile(vault,migrationStatePath(vault),4096); if(pending) {const state=JSON.parse(pending) as MigrationState;if(state.version!==1)throw new Error('Invalid migration metadata.');directory=state.backup;} }
 if (!directory) return {count:0,bytes:0,available:false};
 const backup=await readLogFile(directory,path.join(directory,'backup.json'),32*1024*1024);
 if(!backup)return {count:1,bytes:0,available:false,directory};
 const manifest=JSON.parse(backup) as VaultBackupManifest;
 if(manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.some(file=>!Number.isSafeInteger(file.bytes)||file.bytes<0))throw new Error('Invalid backup metadata.');
 return {count:1,bytes:manifest.files.reduce((sum,file)=>sum+file.bytes,0),available:true,directory};
}

export function logMigrationPending(vault: string): boolean { return fs.existsSync(migrationStatePath(vault)); }
