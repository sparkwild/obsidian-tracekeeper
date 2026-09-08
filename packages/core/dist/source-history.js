"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOURCE_HISTORY_RECEIPTS = void 0;
exports.verifiedSourceReplacements = verifiedSourceReplacements;
exports.readVerifiedSourceReplacements = readVerifiedSourceReplacements;
const node_crypto_1 = require("node:crypto");
const wiki_governance_1 = require("./wiki-governance");
const log_storage_1 = require("./log-storage");
const knowledge_architecture_1 = require("./knowledge-architecture");
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = (text) => (0, node_crypto_1.createHash)('sha256').update(text).digest('hex');
exports.SOURCE_HISTORY_RECEIPTS = `${knowledge_architecture_1.TRACEKEEPER_OPERATIONS_DIR}/source-consolidations`;
/** 所有界面与迁移复用同一证明：完整回执绑定、终态、分片及父索引当前哈希。 */
function verifiedSourceReplacements(receipts, contentHashes) {
    const replacements = new Map(), ambiguous = new Set();
    for (const receipt of receipts) {
        if (!receipt.path.startsWith(`${exports.SOURCE_HISTORY_RECEIPTS}/`) || !receipt.path.endsWith('.json') || receipt.path.endsWith('.archive.json') || Buffer.byteLength(receipt.content) > 2 * 1024 * 1024)
            continue;
        try {
            const journal = JSON.parse(receipt.content);
            const { bindingHash, ...unsigned } = journal;
            if (journal.version !== 1 || journal.status !== 'completed' || !Array.isArray(journal.outputs) || digest(canonical(unsigned)) !== bindingHash)
                continue;
            const valid = new Map();
            for (const item of journal.outputs) {
                if (item && item.state === 'verified' && typeof item.path === 'string' && typeof item.legacyPath === 'string' && contentHashes.get(item.path) === item.expectedHash)
                    valid.set(item.path, item);
            }
            for (const [partPath, item] of valid) {
                if (item.kind !== 'source_part' || !item.legacyPath.startsWith(`${knowledge_architecture_1.KNOWLEDGE_SOURCES_DIR}/`))
                    continue;
                const parent = (0, wiki_governance_1.sourceIndexPathForPart)(partPath);
                if (!parent || valid.get(parent)?.kind !== 'source_capture' || ambiguous.has(item.legacyPath))
                    continue;
                if (replacements.has(item.legacyPath) && replacements.get(item.legacyPath) !== parent) {
                    replacements.delete(item.legacyPath);
                    ambiguous.add(item.legacyPath);
                }
                else
                    replacements.set(item.legacyPath, parent);
            }
        }
        catch { /* 损坏回执不能产生替代关系；原引用仍显示为缺失或未验证。 */ }
    }
    return replacements;
}
async function readVerifiedSourceReplacements(vault, contentHashes) {
    const logs = new log_storage_1.OperationalLogRepository(vault);
    const receipts = [];
    for (const path of await logs.list(exports.SOURCE_HISTORY_RECEIPTS)) {
        if (!path.endsWith('.json') || path.endsWith('.archive.json'))
            continue;
        const content = await logs.readText(path);
        if (content !== null)
            receipts.push({ path, content });
    }
    return verifiedSourceReplacements(receipts, contentHashes);
}
