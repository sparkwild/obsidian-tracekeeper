import type { StreamableHttpRuntimeStatus } from '@tracekeeper/mcp-runtime';

export interface ManagedMcpRuntime {
	start(): Promise<StreamableHttpRuntimeStatus>;
	stop(): Promise<void>;
	getStatus(): StreamableHttpRuntimeStatus;
	closeSessionsForIntegration?(integrationId: string): number;
	getSessionSnapshot?(): Array<{ sessionId: string; integrationId?: string; credentialId?: string; authMode?: 'oauth' | 'bearer'; createdAt: number; lastSeenAt: number }>;
}

export type ManagedMcpRuntimeFactory = () => ManagedMcpRuntime;

export class McpRuntimeLifecycleController {
	private runtime: ManagedMcpRuntime | null = null;
	private transitionTail: Promise<void> = Promise.resolve();
	private closed = false;

	getStatus(): StreamableHttpRuntimeStatus | null {
		return this.runtime?.getStatus() ?? null;
	}

	getRuntime(): ManagedMcpRuntime | null {
		return this.runtime;
	}

	start(factory: ManagedMcpRuntimeFactory): Promise<StreamableHttpRuntimeStatus | null> {
		return this.enqueue(async () => {
			if (this.closed) {
				return null;
			}
			const current = this.runtime?.getStatus();
			if (current?.state === 'running' || current?.state === 'starting') {
				return current;
			}
			await this.stopCurrent();
			return this.startCurrent(factory);
		});
	}

	restart(factory: ManagedMcpRuntimeFactory): Promise<StreamableHttpRuntimeStatus | null> {
		return this.enqueue(async () => {
			await this.stopCurrent();
			if (this.closed) {
				return null;
			}
			return this.startCurrent(factory);
		});
	}

	stop(): Promise<StreamableHttpRuntimeStatus | null> {
		return this.enqueue(() => this.stopCurrent());
	}

	close(): Promise<StreamableHttpRuntimeStatus | null> {
		this.closed = true;
		return this.stop();
	}

	private async startCurrent(
		factory: ManagedMcpRuntimeFactory
	): Promise<StreamableHttpRuntimeStatus | null> {
		const runtime = factory();
		this.runtime = runtime;
		const status = await runtime.start();
		if (!this.closed) {
			return status;
		}
		await this.stopCurrent();
		return null;
	}

	private async stopCurrent(): Promise<StreamableHttpRuntimeStatus | null> {
		const runtime = this.runtime;
		if (!runtime) {
			return null;
		}
		await runtime.stop();
		const status = runtime.getStatus();
		if (this.runtime === runtime) {
			this.runtime = null;
		}
		return status;
	}

	private enqueue<T>(transition: () => Promise<T>): Promise<T> {
		const result = this.transitionTail.then(transition, transition);
		this.transitionTail = result.then(
			() => undefined,
			() => undefined
		);
		return result;
	}
}
