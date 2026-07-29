import { Notice, type App } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { GeneratedClientConfig } from '../client-config/client-config';
import { ui } from '../../ui/localization';
import { SkillInstallPreviewModal } from './skill-install-modals';
import { buildSkillInstallPrompt } from './skill-install-view-model';

export interface ClientSkillPromptOptions {
	app: App;
	plugin: TracekeeperPlugin;
	container: HTMLElement;
	config: GeneratedClientConfig;
	onChanged?: () => void;
}

export function renderClientSkillPrompt({
	app,
	plugin,
	container,
	config,
	onChanged,
}: ClientSkillPromptOptions): void {
	const state = plugin.getSkillInstallState(config.clientId);
	const prompt = buildSkillInstallPrompt(state, ui);
	const skill = container.createDiv({ cls: 'tracekeeper-settings-client-skill' });
	skill.createEl('span', {
		text: prompt.label,
		cls: `tracekeeper-badge tracekeeper-badge--${prompt.tone}`,
	});
	const body = skill.createDiv({ cls: 'tracekeeper-settings-client-skill__body' });
	const versions = body.createDiv({ cls: 'tracekeeper-settings-client-skill__versions' });
	const currentVersion = versions.createEl('span');
	currentVersion.createEl('span', {
		text: ui('当前版本', 'Current version'),
		cls: 'tracekeeper-settings-client-skill__version-label',
	});
	currentVersion.createEl('strong', { text: prompt.currentVersion });
	const bundledVersion = versions.createEl('span');
	bundledVersion.createEl('span', {
		text: ui('插件内置', 'Bundled'),
		cls: 'tracekeeper-settings-client-skill__version-label',
	});
	bundledVersion.createEl('strong', { text: prompt.bundledVersion });
	body.createEl('div', {
		text: prompt.detail,
		cls: 'tracekeeper-settings-client-skill__detail',
	});
	if (!prompt.action) {
		return;
	}

	const skillAction = prompt.action;
	const action = skill.createEl('button', { text: prompt.actionLabel });
	action.addEventListener('click', () => {
		if (skillAction === 'copy') {
			action.disabled = true;
			void plugin.setOnboardingClientId(config.clientId)
				.then(() => plugin.copyTracekeeperSkillFallback())
				.then(() => onChanged?.())
				.catch((error) => {
					console.error('tracekeeper failed to copy Skill content', error);
					action.disabled = false;
					new Notice(ui('复制 Skill 失败。', 'Failed to copy Skill.'));
				});
			return;
		}
		void plugin.setOnboardingClientId(config.clientId)
			.then(() => {
				new SkillInstallPreviewModal(
					app,
					plugin,
					config.clientId,
					skillAction,
					onChanged
				).open();
			})
			.catch((error) => {
				console.error('tracekeeper failed to prepare Skill change', error);
				new Notice(ui('无法准备 Skill 变更。', 'Failed to prepare Skill change.'));
			});
	});
}
