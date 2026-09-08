"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOperationJournalProvider = createOperationJournalProvider;
const core_1 = require("@tracekeeper/core");
const safety_1 = require("../safety");
function createOperationJournalProvider() {
    const journals = new Map();
    const provider = (vaultRoot) => {
        const directory = (0, core_1.logDirectory)(vaultRoot);
        (0, safety_1.relativeFromAbsolute)(vaultRoot, directory);
        (0, safety_1.assertNoSymlinkSegments)(vaultRoot, directory);
        let journal = journals.get(directory);
        if (!journal) {
            journal = (0, core_1.createVaultOperationJournal)(vaultRoot);
            journals.set(directory, journal);
        }
        return journal;
    };
    provider.clear = () => {
        for (const journal of journals.values())
            journal.clearCache();
        journals.clear();
    };
    return provider;
}
