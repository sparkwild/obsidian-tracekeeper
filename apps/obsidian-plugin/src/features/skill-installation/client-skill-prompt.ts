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
	presentation?: 'compact' | 'optional' | 'modal-collapsible';
	expanded?: boolean;
	onExpandedChange?: (expanded: boolean) => void;
	onChanged?: () => void | Promise<void>;
}

export function renderClientSkillPrompt({
	app,
	plugin,
	container,
	config,
	presentation = 'compact',
	expanded = false,
	onExpandedChange,
	onChanged,
}: ClientSkillPromptOptions): void {
	const state = plugin.getSkillInstallState(config.clientId);
	const prompt = buildSkillInstallPrompt(state, ui);
	const collapsible = presentation === 'modal-collapsible';
	const skill = container.createEl(collapsible ? 'details' : 'div', {
		cls: `tracekeeper-settings-client-skill tracekeeper-settings-client-skill--${presentation}`,
	});
	if (collapsible) {
		(skill as HTMLDetailsElement).open = expanded;
		skill.addEventListener('toggle', () => onExpandedChange?.((skill as HTMLDetailsElement).open));
	}
	const title = skill.createEl(collapsible ? 'summary' : 'div', { cls: 'tracekeeper-settings-client-skill__title' });
	title.createEl('strong', { text: ui(`增强 ${config.displayName} 的记忆协作`, `Enhance ${config.displayName} with memory collaboration`) });
	if (presentation === 'optional') {
		title.createSpan({ text: ui('推荐，可稍后', 'Recommended, optional for now'), cls: 'tracekeeper-badge tracekeeper-badge--muted' });
	}
	if (collapsible) {
		title.createSpan({ text: prompt.label, cls: `tracekeeper-badge tracekeeper-badge--${prompt.tone}` });
	} else {
		skill.createSpan({ text: prompt.label, cls: `tracekeeper-badge tracekeeper-badge--${prompt.tone}` });
	}
	const body = skill.createDiv({ cls: 'tracekeeper-settings-client-skill__body' });
	if (presentation === 'optional') {
		body.createDiv({
			text: ui('强化技能帮助 Agent 在合适任务中查找相关记忆并正确收尾，不会增加访问权限。', 'The Skill helps the Agent find relevant memories and close tasks correctly without adding access permissions.'),
			cls: 'tracekeeper-settings-client-skill__benefit',
		});
	}
	body.createDiv({ text: prompt.detail, cls: 'tracekeeper-settings-client-skill__detail' });
	const actions = skill.createDiv({ cls: 'tracekeeper-settings-client-skill__actions' });
	if (prompt.action) {
		const operationStatus = prompt.action === 'update'
			? body.createDiv({
				cls: 'tracekeeper-settings-client-skill__operation-status',
				attr: {
					role: 'status',
					'aria-live': 'polite',
					'aria-atomic': 'true',
				},
			})
			: null;
		const actionButton = actions.createEl('button', { text: prompt.actionLabel, cls: 'mod-cta' });
		actionButton.addEventListener('click', () => {
			if (prompt.action === 'update' && operationStatus) {
				actionButton.disabled = true;
				actionButton.setAttribute('aria-busy', 'true');
				actionButton.setText(ui('更新中…', 'Updating…'));
				operationStatus.classList.remove('is-error', 'is-success');
				operationStatus.setText(ui(
					'正在重新校验并更新原安装目录…',
					'Revalidating and updating the existing installation directory…'
				));
				void (async () => {
					try {
						await plugin.setOnboardingClientId(config.clientId);
						await plugin.updateSkillAtInstalledDirectory(config.clientId);
					} catch (error) {
						console.error('tracekeeper failed to update Skill in its installed directory', error);
						actionButton.disabled = false;
						actionButton.removeAttribute('aria-busy');
						actionButton.setText(prompt.actionLabel);
						operationStatus.classList.add('is-error');
						operationStatus.setText(ui(
							'更新未完成。请根据提示处理后重试。',
							'The update did not complete. Follow the notice, then try again.'
						));
						new Notice(error instanceof Error ? error.message : ui('无法更新 Skill。', 'Unable to update the Skill.'));
						return;
					}

					actionButton.removeAttribute('aria-busy');
					actionButton.setText(ui('已更新', 'Updated'));
					operationStatus.classList.add('is-success');
					operationStatus.setText(ui('更新成功，正在刷新状态…', 'Update complete. Refreshing status…'));
					try {
						await onChanged?.();
					} catch (error) {
						console.error('tracekeeper updated Skill but failed to refresh its visible state', error);
						operationStatus.classList.remove('is-success');
						operationStatus.classList.add('is-error');
						operationStatus.setText(ui(
							'Skill 已更新，但页面状态刷新失败。请重新打开设置页。',
							'The Skill was updated, but the page did not refresh. Reopen Settings.'
						));
						new Notice(ui(
							'Skill 已更新，但设置页刷新失败。请重新打开设置页。',
							'The Skill was updated, but Settings did not refresh. Reopen Settings.'
						), 8000);
						return;
					}
					if (actionButton.isConnected) {
						operationStatus.setText(ui(
							'更新成功。请按提示重启客户端。',
							'Update complete. Restart the client when prompted.'
						));
					}
				})();
				return;
			}
			actionButton.disabled = true;
			void plugin.setOnboardingClientId(config.clientId)
				.then(() => new SkillInstallPreviewModal(app, plugin, config.clientId, onChanged).open())
				.catch((error) => {
					console.error('tracekeeper failed to open Skill directory selection', error);
					new Notice(error instanceof Error
						? error.message
						: ui('无法打开目录选择。', 'Unable to open directory selection.'));
				})
				.finally(() => { actionButton.disabled = false; });
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
