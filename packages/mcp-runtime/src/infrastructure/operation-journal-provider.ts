import path from 'node:path';
import { NodeFileOperationJournal, logDirectory, createVaultOperationJournal } from '@tracekeeper/core';
import { assertNoSymlinkSegments, relativeFromAbsolute } from '../safety';

export type OperationJournalProvider = ((vaultRoot: string) => NodeFileOperationJournal) & { clear?: () => void };

export function createOperationJournalProvider(): OperationJournalProvider {
	const journals = new Map<string, NodeFileOperationJournal>();
	const provider: OperationJournalProvider = (vaultRoot) => {
		const directory = logDirectory(vaultRoot);
		relativeFromAbsolute(vaultRoot, directory);
		assertNoSymlinkSegments(vaultRoot, directory);
		let journal = journals.get(directory);
		if (!journal) {
			journal = createVaultOperationJournal(vaultRoot);
			journals.set(directory, journal);
		}
		return journal;
	};
	provider.clear = () => {
		for (const journal of journals.values()) journal.clearCache();
		journals.clear();
	};
	return provider;
}
