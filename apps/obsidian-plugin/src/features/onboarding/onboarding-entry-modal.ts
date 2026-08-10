import { App, Modal } from 'obsidian';

interface OnboardingEntryCallbacks {
	onOpen?: () => Promise<void> | void;
	onStartConnectingAgent: () => Promise<void> | void;
	onSetupLater: () => Promise<void> | void;
}

interface OnboardingEntryLocalization {
	localize: (zh: string, en: string) => string;
}

export class OnboardingEntryModal extends Modal {
	constructor(
		app: App,
		private readonly callbacks: OnboardingEntryCallbacks,
		private readonly options: OnboardingEntryLocalization
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		void this.invoke(this.callbacks.onOpen);
		this.titleEl.setText(this.options.localize('开始接入 Tracekeeper', 'Start Tracekeeper onboarding'));
		contentEl.createEl('p', {
			text: this.options.localize(
				'Tracekeeper 可将当前 Obsidian 仓库作为你的本地知识库。知识和 Agent 活动记录保留在仓库中；连接 Agent 后，它只能在 Obsidian 开启时通过受控的本机服务访问这些知识。你可以现在开始连接，也可以稍后设置。',
				'Tracekeeper can use the current Obsidian vault as your local knowledge base. Knowledge and Agent activity records stay in the vault; after connecting an agent, it can access them only through the controlled local service while Obsidian is open. Start connecting now or set it up later.',
			),
			cls: 'tracekeeper-view__description',
		});
		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const later = actions.createEl('button', { text: this.options.localize('稍后设置', 'Set up later') });
		later.addEventListener('click', () => {
			void (async () => {
				this.close();
				await this.invoke(this.callbacks.onSetupLater);
			})();
		});
		const start = actions.createEl('button', {
			text: this.options.localize('开始连接 Agent', 'Start connecting Agent'),
			cls: 'mod-cta',
		});
		start.addEventListener('click', () => {
			void (async () => {
				this.close();
				await this.invoke(this.callbacks.onStartConnectingAgent);
			})();
		});
	}

	private async invoke(handler?: () => Promise<void> | void): Promise<void> {
		if (!handler) {
			return;
		}
		try {
			await handler();
		} catch (error) {
			console.error('tracekeeper onboarding entry action failed', error);
		}
	}
}
