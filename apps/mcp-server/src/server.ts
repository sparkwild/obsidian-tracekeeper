import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { StreamableHttpMcpRuntime, LOCAL_TRUST_CAPABILITIES } from '@tracekeeper/mcp-runtime';

interface ServerArgs {
	defaultVaultRoot?: string;
	vaultConfigDir?: string;
	host?: string;
	port?: number;
	graphProfile?: string;
	contentLanguage?: string;
}

function parseArgs(argv: string[]): ServerArgs {
	const result: ServerArgs = {};
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
		throw new Error('Plaintext MCP token options are not supported. Set TRACEKEEPER_STANDALONE_BEARER in the process environment.');
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

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message || 'Unknown MCP Runtime error.';
	}
	if (typeof error === 'string') {
		return error;
	}
	return 'Unknown MCP Runtime error.';
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const standaloneBearer = process.env.TRACEKEEPER_STANDALONE_BEARER || '';
	if (!isStandaloneBearer(standaloneBearer)) {
		throw new Error('TRACEKEEPER_STANDALONE_BEARER must be a 256-bit base64url bearer.');
	}
	const bearerDigest = createHash('sha256').update(standaloneBearer, 'utf8').digest();
	const runtime = new StreamableHttpMcpRuntime({
		...args,
		localTrust: true,
		credentialVerifier: {
			verifyBearer: async (token) => {
				const presented = createHash('sha256').update(token, 'utf8').digest();
				if (!timingSafeEqual(presented, bearerDigest)) return null;
				return {
					integrationId: 'standalone-process',
					credentialId: 'standalone-process',
					authMode: 'bearer',
					principalId: 'local-user',
					capabilities: LOCAL_TRUST_CAPABILITIES,
				};
			},
		},
		writebackConfirmationSecret: randomBytes(32).toString('base64url'),
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

const isStandaloneBearer = (value: string): boolean => {
	if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return false;
	const bytes = Buffer.from(value, 'base64url');
	return bytes.byteLength === 32 && bytes.toString('base64url') === value;
};

void main().catch((error) => {
	const message = toErrorMessage(error);
	process.stderr.write(`${message}\n`);
	process.exit(1);
});
