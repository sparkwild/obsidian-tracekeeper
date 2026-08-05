import { Notice, setIcon, type App } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { GeneratedClientConfig } from '../client-config/client-config';
import { ui } from '../../ui/localization';
import { SkillAiAssistantModal, SkillInstallPreviewModal } from './skill-install-modals';
import { buildSkillInstallPrompt } from './skill-install-view-model';

export interface ClientSkillPromptOptions {
	app: App;
	plugin: TracekeeperPlugin;
	container: HTMLElement;
	config: GeneratedClientConfig;
	presentation?: 'compact' | 'optional';
	onChanged?: () => void;
}

export function renderClientSkillPrompt({
	app,
	plugin,
	container,
	config,
	presentation = 'compact',
	onChanged,
}: ClientSkillPromptOptions): void {
	const state = plugin.getSkillInstallState(config.clientId);
	const prompt = buildSkillInstallPrompt(state, ui);
	const skill = container.createDiv({
		cls: `tracekeeper-settings-client-skill tracekeeper-settings-client-skill--${presentation}`,
	});
	const title = skill.createDiv({ cls: 'tracekeeper-settings-client-skill__title' });
	title.createEl('strong', { text: ui(`增强 ${config.displayName} 的记忆协作`, `Enhance ${config.displayName} with memory collaboration`) });
	if (presentation === 'optional') {
		title.createEl('span', { text: ui('推荐，可稍后', 'Recommended, optional for now'), cls: 'tracekeeper-badge tracekeeper-badge--muted' });
	}
	skill.createEl('span', { text: prompt.label, cls: `tracekeeper-badge tracekeeper-badge--${prompt.tone}` });
	const body = skill.createDiv({ cls: 'tracekeeper-settings-client-skill__body' });
	if (presentation === 'optional') {
		body.createEl('div', {
			text: ui('强化技能帮助 Agent 在合适任务中查找相关记忆并正确收尾，不会增加访问权限。', 'The Skill helps the Agent find relevant memories and close tasks correctly without adding access permissions.'),
			cls: 'tracekeeper-settings-client-skill__benefit',
		});
	}
	body.createEl('div', { text: prompt.detail, cls: 'tracekeeper-settings-client-skill__detail' });
	const actions = skill.createDiv({ cls: 'tracekeeper-settings-client-skill__actions' });
	if (prompt.action) {
		const choose = actions.createEl('button', { text: prompt.actionLabel, cls: 'mod-cta' });
		choose.addEventListener('click', () => {
			choose.disabled = true;
			void plugin.setOnboardingClientId(config.clientId)
				.then(() => new SkillInstallPreviewModal(app, plugin, config.clientId, onChanged).open())
				.catch((error) => {
					console.error('tracekeeper failed to open Skill directory selection', error);
					new Notice(ui('无法打开目录选择。', 'Unable to open directory selection.'));
				})
				.finally(() => { choose.disabled = false; });
		});
	}
	if (prompt.assistantLabel) {
		const assistant = actions.createEl('button', { text: '' });
		assistant.classList.add('clickable-icon', 'tracekeeper-copy-button');
		assistant.setAttribute('aria-label', prompt.assistantLabel);
		assistant.setAttribute('title', prompt.assistantLabel);
		setIcon(assistant, 'bot');
		assistant.addEventListener('click', () => {
			void plugin.setOnboardingClientId(config.clientId)
				.then(() => new SkillAiAssistantModal(app, plugin, config.clientId, onChanged).open())
				.catch((error) => {
					console.error('tracekeeper failed to open AI Skill assistant', error);
					new Notice(ui('无法打开 AI 辅助安装。', 'Unable to open AI-assisted installation.'));
				});
		});
	}
}
