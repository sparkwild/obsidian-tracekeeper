import { createHash, randomBytes } from 'node:crypto';
import {
	buildClientConfigTexts,
	detectClientConfigStatus,
	mergeClientConfigContent,
	removeClientConfigContent,
	type ClientConfigStatus,
	type ClientProfile,
	type GeneratedClientConfig,
} from '../features/client-config/client-config';

export type ClientConfigChangeAction = 'apply' | 'remove';

export interface ClientConfigChangePlan {
	planId: string;
	action: ClientConfigChangeAction;
	clientId: string;
	targetPath: string;
	originalHash: string;
	previewText: string;
	expiresAt: string;
}

export interface ClientConfigWriteResult {
	backupPath: string;
}

export interface ClientConfigFileApi {
	existsSync(path: string): boolean;
	readFileSync(path: string, encoding: 'utf8'): string;
	writeFileSync(path: string, content: string, encoding: 'utf8'): void;
	mkdirSync(path: string, options: { recursive: boolean }): void;
	renameSync(oldPath: string, newPath: string): void;
}

export interface ClientConfigPathApi {
	dirname(path: string): string;
}

export interface ClientConfigAdapterOptions {
	fs: ClientConfigFileApi;
	path: ClientConfigPathApi;
	getConnectionUrl(): string;
	getAccessToken(): string;
	now?: () => Date;
	planTtlMs?: number;
}

interface StoredClientConfigChangePlan extends ClientConfigChangePlan {
	nextContent: string;
	connectionConfigHash: string;
}

export class ClientConfigPlanConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ClientConfigPlanConflictError';
	}
}

export class ClientConfigAdapter {
	private readonly plans = new Map<string, StoredClientConfigChangePlan>();
	private readonly now: () => Date;
	private readonly planTtlMs: number;

	constructor(private readonly options: ClientConfigAdapterOptions) {
		this.now = options.now ?? (() => new Date());
		this.planTtlMs = options.planTtlMs ?? 5 * 60 * 1000;
		if (!Number.isSafeInteger(this.planTtlMs) || this.planTtlMs <= 0) {
			throw new Error('Client config planTtlMs must be a positive safe integer.');
		}
	}

	previewChange(config: GeneratedClientConfig, action: ClientConfigChangeAction): ClientConfigChangePlan {
		this.pruneExpiredPlans();
		const targetPath = this.requireTarget(config);
		const original = this.readCurrent(targetPath);
		let nextContent: string;
		let previewText: string;
		let connectionConfigHashValue = '';
		if (action === 'apply') {
			const connectionUrl = this.options.getConnectionUrl();
			const accessToken = this.options.getAccessToken();
			const configTexts = buildClientConfigTexts(config, connectionUrl, accessToken);
			nextContent = mergeClientConfigContent(config, original, connectionUrl, accessToken);
			previewText = configTexts.redactedConfigText;
			connectionConfigHashValue = connectionConfigHash(connectionUrl, accessToken);
		} else {
			nextContent = removeClientConfigContent(config, original);
			previewText = `Remove Tracekeeper from ${targetPath}`;
		}
		const createdAt = this.now();
		const plan: StoredClientConfigChangePlan = {
			planId: `client-config-${randomBytes(12).toString('hex')}`,
			action,
			clientId: config.clientId,
			targetPath,
			originalHash: contentHash(original),
			previewText,
			expiresAt: new Date(createdAt.getTime() + this.planTtlMs).toISOString(),
			nextContent,
			connectionConfigHash: connectionConfigHashValue,
		};
		this.plans.set(plan.planId, plan);
		return publicPlan(plan);
	}

	applyConfirmedChange(planId: string): ClientConfigWriteResult {
		return this.commitPlan(planId, 'apply');
	}

	removeConfirmedChange(planId: string): ClientConfigWriteResult {
		return this.commitPlan(planId, 'remove');
	}

	verifyInstalledConfig(
		profile: ClientProfile,
		localize: (zh: string, en: string) => string
	): ClientConfigStatus {
		if (!profile.supportsAutoConfigure || !profile.targetPath) {
			return {
				state: 'not_configured',
				label: localize('未配置', 'Not configured'),
				detail: localize('需要复制配置到对应 AI 工具。', 'Copy this config into the AI tool.'),
			};
		}
		if (!this.options.fs.existsSync(profile.targetPath)) {
			return {
				state: 'not_configured',
				label: localize('未配置', 'Not configured'),
				detail: localize('尚未写入 Tracekeeper 连接。', 'The Tracekeeper connection has not been written yet.'),
			};
		}
		return detectClientConfigStatus(
			profile,
			this.options.fs.readFileSync(profile.targetPath, 'utf8'),
			this.options.getConnectionUrl(),
			this.options.getAccessToken(),
			localize
		);
	}

	private commitPlan(planId: string, expectedAction: ClientConfigChangeAction): ClientConfigWriteResult {
		const plan = this.plans.get(planId);
		if (!plan || plan.action !== expectedAction) {
			throw new ClientConfigPlanConflictError('Client config change plan is missing or does not match the confirmed action.');
		}
		this.plans.delete(planId);
		if (this.now().getTime() > Date.parse(plan.expiresAt)) {
			throw new ClientConfigPlanConflictError('Client config change plan expired. Preview the change again.');
		}
		const current = this.readCurrent(plan.targetPath);
		if (contentHash(current) !== plan.originalHash) {
			throw new ClientConfigPlanConflictError('Client config changed after preview. Preview the change again.');
		}
		if (
			plan.action === 'apply'
			&& connectionConfigHash(
				this.options.getConnectionUrl(),
				this.options.getAccessToken()
			) !== plan.connectionConfigHash
		) {
			throw new ClientConfigPlanConflictError('Client connection settings changed after preview. Preview the change again.');
		}
		return this.writeConfigFile(plan.targetPath, current, plan.nextContent);
	}

	private pruneExpiredPlans(): void {
		const currentTime = this.now().getTime();
		for (const [planId, plan] of this.plans.entries()) {
			if (currentTime > Date.parse(plan.expiresAt)) {
				this.plans.delete(planId);
			}
		}
	}

	private requireTarget(config: GeneratedClientConfig): string {
		if (!config.targetPath || !config.supportsAutoConfigure) {
			throw new Error(`Client auto-configuration is not supported for ${config.clientId}.`);
		}
		return config.targetPath;
	}

	private readCurrent(targetPath: string): string {
		return this.options.fs.existsSync(targetPath)
			? this.options.fs.readFileSync(targetPath, 'utf8')
			: '';
	}

	private writeConfigFile(targetPath: string, original: string, nextContent: string): ClientConfigWriteResult {
		const directory = this.options.path.dirname(targetPath);
		this.options.fs.mkdirSync(directory, { recursive: true });
		const stamp = this.now().toISOString().replace(/[:.]/g, '-');
		const nonce = randomBytes(4).toString('hex');
		const backupPath = `${targetPath}.tracekeeper-backup-${stamp}-${nonce}`;
		const tmpPath = `${targetPath}.tracekeeper-tmp-${stamp}-${nonce}`;
		this.options.fs.writeFileSync(backupPath, original, 'utf8');
		this.options.fs.writeFileSync(tmpPath, nextContent, 'utf8');
		this.options.fs.renameSync(tmpPath, targetPath);
		return { backupPath };
	}
}

function contentHash(content: string): string {
	return createHash('sha256').update(content, 'utf8').digest('hex');
}

function connectionConfigHash(connectionUrl: string, accessToken: string): string {
	return contentHash(JSON.stringify([connectionUrl, accessToken]));
}

function publicPlan(plan: StoredClientConfigChangePlan): ClientConfigChangePlan {
	const { nextContent: _nextContent, connectionConfigHash: _connectionConfigHash, ...result } = plan;
	return result;
}
