import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
export const logHash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const isMissingLogFile = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
/** 操作 I/O 前检查受管根路径及其下的现存节点，拒绝符号链接。 */
export async function assertLogPath(root: string, target = root): Promise<void> {
	const relative = path.relative(root, target);
	if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
		throw new Error('Log path escapes its owner.');
	let current = path.resolve(root);
	const components = ['', ...relative.split(path.sep).filter(Boolean)];
	for (const component of components) {
		if (component)
			current = path.join(current, component);
		try {
			if ((await fs.lstat(current)).isSymbolicLink())
				throw new Error('Symbolic links are not allowed in log storage.');
		}
		catch (error) {
			if (isMissingLogFile(error))
				break;
			throw error;
		}
	}
}
export async function readLogFile(root: string, file: string, limit = 192 * 1024 * 1024): Promise<string | null> {
	await assertLogPath(root, file);
	let handle: Awaited<ReturnType<typeof fs.open>>;
	try {
		handle = await fs.open(file, 'r');
	}
	catch (error) {
		if (isMissingLogFile(error))
			return null;
		throw error;
	}
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > limit)
			throw new Error('Invalid or oversized log file.');
		return await handle.readFile('utf8');
	}
	finally {
		await handle.close();
	}
}
/** 原子替换在文件及目录元数据同步后才确认完成。 */
export async function writeLogFile(root: string, file: string, bytes: string | Buffer): Promise<void> {
	await assertLogPath(root, file);
	await fs.mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp-${randomBytes(12).toString('hex')}`;
	const handle = await fs.open(temporary, 'wx', 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	}
	catch (error) {
		await fs.unlink(temporary).catch(() => undefined);
		throw error;
	}
	finally {
		await handle.close();
	}
	try {
		await assertLogPath(root, file);
		await fs.rename(temporary, file);
		await syncLogDirectory(path.dirname(file));
	}
	finally {
		await fs.unlink(temporary).catch(() => undefined);
	}
}
export async function syncLogDirectory(directory: string): Promise<void> {
	const handle = await fs.open(directory, 'r').catch((error) => {
		if (process.platform === 'win32' && ['EISDIR', 'EPERM', 'EACCES'].includes(error.code))
			return null;
		throw error;
	});
	if (handle)
		try {
			await handle.sync();
		}
		finally {
			await handle.close();
		}
}
