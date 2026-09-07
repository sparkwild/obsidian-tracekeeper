import { NodeFileOperationJournal } from '@tracekeeper/core';
export type OperationJournalProvider = ((vaultRoot: string) => NodeFileOperationJournal) & {
    clear?: () => void;
};
export declare function createOperationJournalProvider(): OperationJournalProvider;
