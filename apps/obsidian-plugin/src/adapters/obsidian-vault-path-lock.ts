import { TFolder, type Vault } from 'obsidian';

const vaultPathQueues = new WeakMap<object, Map<string, Promise<void>>>();

export async function withObsidianVaultPathLock<T>(
	vault: Vault,
	path: string,
	action: () => Promise<T>
): Promise<T> {
	const vaultKey = vault as object;
	let queues = vaultPathQueues.get(vaultKey);
	if (!queues) {
		queues = new Map<string, Promise<void>>();
		vaultPathQueues.set(vaultKey, queues);
	}
	const predecessor = queues.get(path) ?? Promise.resolve();
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = predecessor.catch(() => undefined).then(() => gate);
	queues.set(path, tail);
	await predecessor.catch(() => undefined);
	try {
		return await action();
	} finally {
		release();
		if (queues.get(path) === tail) {
			queues.delete(path);
			if (queues.size === 0) {
				vaultPathQueues.delete(vaultKey);
			}
		}
	}
}

export async function withObsidianVaultPathLocks<T>(
	vault: Vault,
	paths: readonly string[],
	action: () => Promise<T>
): Promise<T> {
	const ordered = [...new Set(paths.filter(Boolean))].sort();
	const acquire = async (index: number): Promise<T> => {
		if (index >= ordered.length) {
			return action();
		}
		return withObsidianVaultPathLock(
			vault,
			ordered[index],
			() => acquire(index + 1)
		);
	};
	return acquire(0);
}

export async function ensureObsidianVaultFolderPath(
	vault: Vault,
	folderPath: string,
	occupiedError: (path: string) => Error
): Promise<void> {
	if (!folderPath) {
		return;
	}
	let current = '';
	for (const segment of folderPath.split('/').filter(Boolean)) {
		current = current ? `${current}/${segment}` : segment;
		await withObsidianVaultPathLock(vault, current, async () => {
			const existing = vault.getAbstractFileByPath(current);
			if (!existing) {
				try {
					await vault.createFolder(current);
				} catch (error: unknown) {
					if (!(vault.getAbstractFileByPath(current) instanceof TFolder)) {
						throw error;
					}
				}
				return;
			}
			if (!(existing instanceof TFolder)) {
				throw occupiedError(current);
			}
		});
	}
}
