import { App, Modal, Notice, setIcon } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { AiSkillAssistantContext } from './skill-assistant-prompt';
import type { SkillInstallPlan } from '../../adapters/client-skill-adapter';
import { ui } from '../../ui/localization';

export class SkillInstallPreviewModal extends Modal {
	private plan: SkillInstallPlan | null = null;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private clientId: string,
		private onChanged?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.renderChooseDirectory();
	}

	private renderChooseDirectory(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: ui('选择 Skill 目录', 'Choose Skill directory') });
		contentEl.createEl('p', {
			text: ui('请选择 Skills 根目录。Tracekeeper 只会在确认预览后写入其中的 tracekeeper 子目录。', 'Choose a Skills root directory. Tracekeeper writes only to its tracekeeper child after you confirm the preview.'),
			cls: 'tracekeeper-view__description',
		});
		const recommendation = this.plugin.getSkillDirectoryRecommendation(this.clientId);
		if (recommendation) {
			const row = contentEl.createDiv({ cls: 'tracekeeper-skill-directory-recommendation' });
			row.createEl('strong', { text: ui('建议位置', 'Suggested location') });
			row.createEl('code', { text: recommendation.skillsRootDirectory });
			row.createEl('small', { text: ui('来源：客户端官方文档', 'Source: official client documentation') });
			const use = row.createEl('button', { text: ui('使用建议位置', 'Use suggested location'), cls: 'mod-cta' });
			use.addEventListener('click', () => void this.prepare(recommendation.skillsRootDirectory));
		}
		const currentTarget = this.plugin.getSkillInstallState(this.clientId).targetDirectory;
		if (currentTarget) {
			const current = contentEl.createDiv({ cls: 'tracekeeper-skill-directory-recommendation' });
			current.createEl('strong', { text: ui('当前目录', 'Current directory') });
			current.createEl('code', { text: currentTarget });
			const useCurrent = current.createEl('button', { text: ui('使用当前目录', 'Use current directory') });
			useCurrent.addEventListener('click', () => void this.prepare(currentTarget));
		}
		const choose = contentEl.createEl('button', { text: ui('选择其他目录', 'Choose another directory') });
		choose.addEventListener('click', () => {
			choose.disabled = true;
			void this.plugin.pickSkillDirectory(this.clientId).then((selection) => {
				if (selection) void this.prepare(selection.selectedDirectory);
			}).catch((error) => {
				new Notice(error instanceof Error ? error.message : ui('无法选择目录。', 'Unable to choose a directory.'));
			}).finally(() => { choose.disabled = false; });
		});
	}

	private async prepare(selectedDirectory: string): Promise<void> {
		try {
			this.plan = this.plugin.prepareSkillWrite(this.clientId, selectedDirectory);
			this.renderPlan();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : ui('无法预览 Skill 变更。', 'Unable to preview the Skill change.'));
		}
	}

	private renderPlan(): void {
		const { contentEl } = this;
		contentEl.empty();
		const plan = this.plan;
		if (!plan) return this.renderChooseDirectory();
		contentEl.createEl('h2', { text: ui('确认 Skill 变更', 'Confirm Skill change') });
		contentEl.createEl('p', {
			text: ui('只会写入下列 Tracekeeper Skill 文件；其他文件保持不变。确认时会重新检查目标内容，更新会保留备份。', 'Only the listed Tracekeeper Skill files will be written. Other files stay unchanged. The target is rechecked at confirmation and updates keep a backup.'),
			cls: 'tracekeeper-view__description',
		});
		const details = contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(details, ui('最终目录', 'Final directory'), plan.targetDirectory || ui('不可用', 'Unavailable'));
		this.renderDetail(details, ui('操作', 'Action'), plan.action);
		const list = contentEl.createEl('ul');
		for (const file of plan.files) list.createEl('li', { text: `${file.change}: ${file.path}` });
		if (!plan.canConfirm) {
			contentEl.createEl('p', { text: plan.detail, cls: 'tracekeeper-badge tracekeeper-badge--warning' });
			const choose = contentEl.createEl('button', { text: ui('重新选择目录', 'Choose another directory') });
			choose.addEventListener('click', () => this.renderChooseDirectory());
			return;
		}
		const actions = contentEl.createDiv({ cls: 'tracekeeper-action-row' });
		const back = actions.createEl('button', { text: ui('返回', 'Back') });
		back.addEventListener('click', () => this.renderChooseDirectory());
		const confirm = actions.createEl('button', { text: ui('确认写入', 'Confirm write'), cls: 'mod-cta' });
		confirm.addEventListener('click', () => {
			confirm.disabled = true;
			back.disabled = true;
			void this.plugin.confirmSkillWrite(plan.planId, this.clientId).then(() => {
				this.onChanged?.();
				this.close();
			}).catch(() => {
				confirm.disabled = false;
				back.disabled = false;
				new Notice(ui('Skill 未写入，请重新预览。', 'Skill was not written. Preview again.'));
			});
		});
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}
}

export class SkillAiAssistantModal extends Modal {
	private context: AiSkillAssistantContext | null = null;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private clientId: string,
		private onChanged?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		void this.load();
	}

	private async load(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.createEl('h2', { text: ui('AI 辅助安装 Skill', 'AI-assisted Skill installation') });
		this.contentEl.createEl('p', { text: ui('复制提示词不会代表已安装。请将提示词交给对应 Agent，完成后再选择目录验证。', 'Copying the prompt does not mean the Skill is installed. Give it to the Agent, then verify the resulting directory.'), cls: 'tracekeeper-view__description' });
		try {
			this.context = await this.plugin.prepareAiSkillAssistant(this.clientId);
			this.renderContext();
		} catch (error) {
			this.contentEl.createEl('p', { text: error instanceof Error ? error.message : ui('无法导出 Skill 源目录。', 'Cannot export the Skill source directory.') });
		}
	}

	private renderContext(): void {
		const context = this.context;
		if (!context) return;
		this.contentEl.empty();
		this.contentEl.createEl('h2', { text: ui('AI 辅助安装 Skill', 'AI-assisted Skill installation') });
		const meta = this.contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(meta, ui('源目录', 'Source directory'), context.sourceDirectory);
		this.renderDetail(meta, ui('版本', 'Version'), context.skillVersion);
		this.renderDetail(meta, ui('bundle 哈希', 'Bundle hash'), context.bundleHash);
		const promptRow = this.contentEl.createDiv({ cls: 'tracekeeper-ai-skill-prompt' });
		promptRow.createEl('pre', { text: context.prompt, cls: 'tracekeeper-code-block', attr: { tabindex: '0' } });
		const copyLabel = ui('复制提示词', 'Copy prompt');
		const copy = promptRow.createEl('button', { cls: 'clickable-icon tracekeeper-copy-button', attr: { 'aria-label': copyLabel, title: copyLabel } });
		setIcon(copy, 'copy');
		copy.addEventListener('click', () => {
			copy.disabled = true;
			void this.plugin.copyToClipboard(context.prompt, ui('AI 安装提示词已复制。', 'AI installation prompt copied.'))
				.then(() => this.plugin.markOnboardingSkillAssistantPromptCopied())
				.then(() => { this.onChanged?.(); })
				.catch(() => new Notice(ui('复制失败，请重试。', 'Copy failed. Try again.')))
				.finally(() => { copy.disabled = false; });
		});
		const verify = this.contentEl.createEl('button', { text: ui('选择已安装目录并验证', 'Choose installed directory and verify'), cls: 'mod-cta' });
		verify.addEventListener('click', () => {
			verify.disabled = true;
			void this.plugin.pickSkillDirectory(this.clientId).then((selection) => {
				if (!selection) return;
				return this.plugin.verifyExternalSkill(this.clientId, selection.selectedDirectory);
			}).then((result) => {
				if (!result) return;
				new Notice(ui('Skill 已验证。', 'Skill verified.'));
				this.onChanged?.();
				this.close();
			}).catch((error) => new Notice(error instanceof Error ? error.message : ui('Skill 验证失败。', 'Skill verification failed.')))
				.finally(() => { verify.disabled = false; });
		});
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value });
	}
}
