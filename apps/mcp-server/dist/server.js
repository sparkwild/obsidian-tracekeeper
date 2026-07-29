"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_runtime_1 = require("@tracekeeper/mcp-runtime");
function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        const next = argv[index + 1];
        if ((value === '--vault-root' || value === '--vault') && next) {
            result.defaultVaultRoot = next;
            index += 1;
            continue;
        }
        if (value === '--vault-config-dir' && next) {
            result.vaultConfigDir = next;
            index += 1;
            continue;
        }
        if (value === '--host' && next) {
            result.host = next;
            index += 1;
            continue;
        }
        if (value === '--port' && next) {
            const parsed = Number.parseInt(next, 10);
            if (Number.isFinite(parsed)) {
                result.port = parsed;
            }
            index += 1;
            continue;
        }
        if (value === '--token' || value === '--allow-missing-token-for-dev') {
            throw new Error('Plaintext MCP token options are not supported. Set TRACEKEEPER_MCP_TOKEN in the process environment.');
        }
        if ((value === '--graph-profile' || value === '--graphProfile') && next) {
            result.graphProfile = next;
            index += 1;
            continue;
        }
        if ((value === '--content-language' || value === '--contentLanguage') && next) {
            result.contentLanguage = next;
            index += 1;
            continue;
        }
    }
    return result;
}
function toErrorMessage(error) {
    if (error instanceof Error) {
        return error.message || 'Unknown MCP Runtime error.';
    }
    if (typeof error === 'string') {
        return error;
    }
    return 'Unknown MCP Runtime error.';
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const serviceToken = process.env.TRACEKEEPER_MCP_TOKEN || '';
    const runtime = new mcp_runtime_1.StreamableHttpMcpRuntime({
        ...args,
        localTrust: true,
        serviceToken,
    });
    const status = await runtime.start();
    const stop = async () => {
        await runtime.stop();
        process.exit(0);
    };
    process.once('SIGINT', () => {
        void stop();
    });
    process.once('SIGTERM', () => {
        void stop();
    });
    process.stdout.write(`${JSON.stringify({ ok: true, endpoint: status.endpoint })}\n`);
}
void main().catch((error) => {
    const message = toErrorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
});
