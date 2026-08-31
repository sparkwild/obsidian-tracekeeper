import { App, Modal, Notice, setIcon } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { AiSkillAssistantContext } from './skill-assistant-prompt';
import type { SkillInstallPlan } from '../../adapters/client-skill-adapter';
import { ui } from '../../ui/localization';
import { reportUiFailure } from '../../ui/user-facing-error';
import { sameSkillTargetDirectory } from './skill-install-paths';
import {
	skillFileChangeLabel,
	skillInstallActionLabel,
	skillInstallPlanDetail,
} from './skill-install-view-model';

export class SkillInstallPreviewModal extends Modal {
	private plan: SkillInstallPlan | null = null;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private clientId: string,
		private onChanged?: () => void | Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		this.renderChooseDirectory();
	}

	private renderChooseDirectory(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(ui('选择 Skill 目录', 'Choose Skill directory'));
		contentEl.createEl('p', {
			text: ui('请选择 Skills 根目录或已有的 Tracekeeper 目录。确认预览后只会写入最终的 tracekeeper 目录。', 'Choose a Skills root directory or an existing Tracekeeper directory. The preview writes only to the final tracekeeper directory after confirmation.'),
			cls: 'tracekeeper-view__description',
		});
		const recommendation = this.plugin.getSkillDirectoryRecommendation(this.clientId);
		const currentTarget = this.plugin.getSkillInstallState(this.clientId).targetDirectory;
		const currentMatchesRecommendation = Boolean(
			recommendation
			&& currentTarget
			&& (
				sameSkillTargetDirectory(currentTarget, recommendation.skillDirectory)
				|| sameSkillTargetDirectory(currentTarget, recommendation.skillsRootDirectory)
			)
		);
		if (recommendation && currentMatchesRecommendation) {
			this.renderDirectoryCard({
				title: ui('当前使用的官方位置', 'Current official location'),
				targetDirectory: recommendation.skillDirectory,
				detail: ui(
					`Skills 根目录：${recommendation.skillsRootDirectory} · 来源：客户端官方文档`,
					`Skills root: ${recommendation.skillsRootDirectory} · Source: official client documentation`
				),
				selectedDirectory: recommendation.skillsRootDirectory,
				buttonLabel: ui('使用此位置', 'Use this location'),
				primary: true,
			});
		} else {
			if (recommendation) {
				this.renderDirectoryCard({
					title: ui('推荐安装位置', 'Suggested install location'),
					targetDirectory: recommendation.skillDirectory,
					detail: ui(
						`Skills 根目录：${recommendation.skillsRootDirectory} · 来源：客户端官方文档`,
						`Skills root: ${recommendation.skillsRootDirectory} · Source: official client documentation`
					),
					selectedDirectory: recommendation.skillsRootDirectory,
					buttonLabel: ui('使用推荐位置', 'Use suggested location'),
					primary: true,
				});
			}
			if (currentTarget) {
				this.renderDirectoryCard({
					title: ui('当前安装位置', 'Current install location'),
					targetDirectory: currentTarget,
					selectedDirectory: currentTarget,
					buttonLabel: ui('使用当前目录', 'Use current directory'),
				});
			}
		}
		const choose = contentEl.createEl('button', { text: ui('选择其他目录', 'Choose another directory') });
		choose.addEventListener('click', () => {
			choose.disabled = true;
			void this.plugin.pickSkillDirectory(this.clientId).then((selection) => {
				if (selection) void this.prepare(selection.selectedDirectory);
			}).catch((error) => {
				new Notice(reportUiFailure(error, {
					context: 'tracekeeper failed to choose Skill directory for installation preview',
					fallback: {
						zh: '无法选择 Skill 目录。请重试。',
						en: 'Unable to choose the Skill directory. Try again.',
					},
				}));
			}).finally(() => { choose.disabled = false; });
		});
	}

	private renderDirectoryCard(options: {
		title: string;
		targetDirectory: string;
		detail?: string;
		selectedDirectory: string;
		buttonLabel: string;
		primary?: boolean;
	}): void {
		const row = this.contentEl.createDiv({ cls: 'tracekeeper-skill-directory-recommendation' });
		row.createEl('strong', { text: options.title });
		row.createEl('code', { text: options.targetDirectory });
		if (options.detail) row.createEl('small', { text: options.detail });
		const use = row.createEl('button', { text: options.buttonLabel, cls: options.primary ? 'mod-cta' : undefined });
		use.addEventListener('click', () => void this.prepare(options.selectedDirectory));
	}

	private async prepare(selectedDirectory: string): Promise<void> {
		try {
			this.plan = this.plugin.prepareSkillWrite(this.clientId, selectedDirectory);
			this.renderPlan();
		} catch (error) {
			new Notice(reportUiFailure(error, {
				context: 'tracekeeper failed to preview Skill change',
				fallback: {
					zh: '无法预览 Skill 变更。请重新选择目录后重试。',
					en: 'Unable to preview the Skill change. Choose the directory again and retry.',
				},
			}));
		}
	}

	private renderPlan(): void {
		const { contentEl } = this;
		contentEl.empty();
		const plan = this.plan;
		if (!plan) return this.renderChooseDirectory();
		this.setTitle(ui('确认 Skill 变更', 'Confirm Skill change'));
		contentEl.createEl('p', {
			text: ui('只会写入下列 Tracekeeper Skill 文件；其他文件保持不变。确认时会重新检查目标内容，更新会保留备份。', 'Only the listed Tracekeeper Skill files will be written. Other files stay unchanged. The target is rechecked at confirmation and updates keep a backup.'),
			cls: 'tracekeeper-view__description',
		});
		const details = contentEl.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(details, ui('最终目录', 'Final directory'), plan.targetDirectory || ui('不可用', 'Unavailable'));
		this.renderDetail(details, ui('操作', 'Action'), skillInstallActionLabel(plan.action, ui));
		const list = contentEl.createEl('ul');
		for (const file of plan.files) list.createEl('li', { text: `${skillFileChangeLabel(file.change, ui)}: ${file.path}` });
		if (!plan.canConfirm) {
			contentEl.createEl('p', { text: skillInstallPlanDetail(plan, ui), cls: 'tracekeeper-badge tracekeeper-badge--warning' });
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
			void this.plugin.confirmSkillWrite(plan.planId, this.clientId).then(async () => {
				this.close();
				try {
					await this.onChanged?.();
				} catch (error) {
					console.error('tracekeeper failed to refresh Skill state after confirmed write', error);
				}
			}).catch(() => {
				confirm.disabled = false;
				back.disabled = false;
				new Notice(ui('Skill 未写入，请重新预览。', 'Skill was not written. Preview again.'));
			});
		});
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createSpan({ text: label });
		item.createEl('strong', { text: value });
	}
}

export class SkillAiAssistantModal extends Modal {
	private context: AiSkillAssistantContext | null = null;
	private selectedDirectory = '';

	constructor(
		app: App,
		private plugin: TracekeeperPlugin,
		private clientId: string,
		private onChanged?: () => void | Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		void this.load();
	}

	private async load(): Promise<void> {
		this.contentEl.empty();
		this.setTitle(ui('AI 辅助安装 Skill', 'AI-assisted Skill installation'));
		this.contentEl.createEl('p', { text: ui('复制提示词不会代表已安装。请将提示词交给对应 Agent，完成后再选择目录验证。', 'Copying the prompt does not mean the Skill is installed. Give it to the Agent, then verify the resulting directory.'), cls: 'tracekeeper-view__description' });
		try {
			this.context = await this.plugin.prepareAiSkillAssistant(this.clientId);
			this.renderContext();
		} catch (error) {
			this.contentEl.createEl('p', {
				text: reportUiFailure(error, {
					context: 'tracekeeper failed to export Skill source directory',
					fallback: {
						zh: '无法导出 Skill 源目录。请关闭后重试。',
						en: 'Unable to export the Skill source directory. Close this dialog and try again.',
					},
				}),
			});
		}
	}

	private renderContext(): void {
		const context = this.context;
		if (!context) return;
		this.contentEl.empty();
		this.selectedDirectory = context.recommendation?.skillDirectory
			|| context.recommendation?.skillsRootDirectory
			|| '';
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
				.then(() => this.onChanged?.())
				.catch(() => new Notice(ui('复制失败，请重试。', 'Copy failed. Try again.')))
				.finally(() => { copy.disabled = false; });
		});
		const directoryRow = this.contentEl.createDiv({ cls: 'tracekeeper-skill-directory-row' });
		const directoryInput = directoryRow.createEl('input', {
			type: 'text',
			value: this.selectedDirectory,
			placeholder: ui('输入或粘贴已安装目录', 'Enter or paste the installed directory'),
		});
		directoryInput.setAttribute('aria-label', ui('已安装 Skill 目录', 'Installed Skill directory'));
		directoryInput.title = this.selectedDirectory;
		directoryInput.addEventListener('input', () => {
			this.selectedDirectory = directoryInput.value;
			directoryInput.title = directoryInput.value;
		});
		const choose = directoryRow.createEl('button', { text: ui('选择目录', 'Choose directory') });
		choose.addEventListener('click', () => {
			choose.disabled = true;
			void this.plugin.pickSkillDirectory(this.clientId).then((selection) => {
				if (!selection) return;
				this.selectedDirectory = selection.selectedDirectory;
				directoryInput.value = this.selectedDirectory;
				directoryInput.title = this.selectedDirectory;
				directoryInput.focus();
			}).catch((error) => new Notice(reportUiFailure(error, {
				context: 'tracekeeper failed to choose installed Skill directory for verification',
				fallback: {
					zh: '无法选择已安装的 Skill 目录。请重试。',
					en: 'Unable to choose the installed Skill directory. Try again.',
				},
			})))
				.finally(() => { choose.disabled = false; });
		});
		const verify = directoryRow.createEl('button', { text: ui('验证', 'Verify'), cls: 'mod-cta' });
		verify.addEventListener('click', () => {
			const selectedDirectory = directoryInput.value.trim();
			if (!selectedDirectory) {
				new Notice(ui('请先输入或选择 Skill 目录。', 'Enter or choose a Skill directory first.'));
				directoryInput.focus();
				return;
			}
			this.selectedDirectory = selectedDirectory;
			directoryInput.title = selectedDirectory;
			verify.disabled = true;
			void this.plugin.verifyExternalSkill(this.clientId, selectedDirectory).then(async (result) => {
				if (!result) return;
				new Notice(ui('Skill 已验证。', 'Skill verified.'));
				try {
					await this.onChanged?.();
				} catch (error) {
					new Notice(reportUiFailure(error, {
						context: 'tracekeeper verified Skill but failed to refresh its visible state',
						fallback: {
							zh: 'Skill 已验证，但页面状态刷新失败。请重新打开设置页。',
							en: 'The Skill was verified, but the page did not refresh. Reopen Settings.',
						},
					}));
				}
				this.close();
			}).catch((error) => new Notice(reportUiFailure(error, {
				context: 'tracekeeper failed to verify externally installed Skill',
				fallback: {
					zh: 'Skill 验证失败。请检查所选目录后重试。',
					en: 'Skill verification failed. Check the selected directory and try again.',
				},
			})))
				.finally(() => { verify.disabled = false; });
		});
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createSpan({ text: label });
		item.createEl('strong', { text: value });
	}
}
