import path from 'node:path';
import { NodeFileOperationJournal, TRACEKEEPER_OPERATIONS_DIR } from '@tracekeeper/core';
import { assertNoSymlinkSegments, relativeFromAbsolute } from '../safety';

export type OperationJournalProvider = ((vaultRoot: string) => NodeFileOperationJournal) & { clear?: () => void };

export function createOperationJournalProvider(): OperationJournalProvider {
	const journals = new Map<string, NodeFileOperationJournal>();
	const provider: OperationJournalProvider = (vaultRoot) => {
		const directory = path.resolve(vaultRoot, TRACEKEEPER_OPERATIONS_DIR);
		relativeFromAbsolute(vaultRoot, directory);
		assertNoSymlinkSegments(vaultRoot, directory);
		let journal = journals.get(directory);
		if (!journal) {
			journal = new NodeFileOperationJournal({ directory });
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
