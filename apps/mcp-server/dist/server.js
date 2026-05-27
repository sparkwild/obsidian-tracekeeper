"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const http_runtime_1 = require("./http-runtime");
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
        if (value === '--token' && next) {
            result.token = next;
            index += 1;
            continue;
        }
        if ((value === '--graph-profile' || value === '--graphProfile') && next) {
            result.graphProfile = next;
            index += 1;
            continue;
        }
        if (value === '--allow-missing-token-for-dev') {
            result.allowMissingTokenForDev = true;
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
    const runtime = new http_runtime_1.StreamableHttpMcpRuntime(args);
    const status = await runtime.start();
    process.stdout.write(`${JSON.stringify({ ok: true, endpoint: status.endpoint })}\n`);
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
}
void main().catch((error) => {
    const message = toErrorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
});
