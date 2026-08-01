import type { SkillInstallState } from '../../adapters/client-skill-adapter';

export type SkillPromptAction = 'install' | 'update' | 'migrate' | 'copy' | null;
export type SkillPromptTone = 'success' | 'warning' | 'muted';

export interface SkillInstallPrompt {
	label: string;
	detail: string;
	currentVersion: string;
	bundledVersion: string;
	tone: SkillPromptTone;
	action: SkillPromptAction;
	actionLabel: string;
}

type Localize = (zh: string, en: string) => string;

const currentVersionLabel = (state: SkillInstallState, localize: Localize): string => {
	switch (state.state) {
		case 'not_installed':
			return localize('未安装', 'Not installed');
		case 'copy_only':
		case 'unavailable':
			return localize('需在客户端确认', 'Confirm in client');
		case 'location_conflict':
			return localize('多个位置，无法确认', 'Multiple locations; unknown');
		case 'modified':
			return state.installedVersion
				? localize(`v${state.installedVersion}（未验证）`, `v${state.installedVersion} (unverified)`)
				: localize('无法验证', 'Unverified');
		case 'legacy_install':
			return state.installedVersion
				? localize(`v${state.installedVersion}（旧位置）`, `v${state.installedVersion} (legacy location)`)
				: localize('旧位置，版本未知', 'Legacy location; unknown');
		case 'installed':
		case 'update_available':
		case 'newer_than_bundled':
			return state.installedVersion
				? `v${state.installedVersion}`
				: localize('无法验证', 'Unverified');
	}
};

export function buildSkillInstallPrompt(state: SkillInstallState, localize: Localize): SkillInstallPrompt {
	const versions = {
		currentVersion: currentVersionLabel(state, localize),
		bundledVersion: `v${state.expectedVersion}`,
	};
	switch (state.state) {
		case 'installed':
			return {
				label: localize('Skill 已安装', 'Skill installed'),
				detail: localize(
					'Skill 文件已验证。是否被 Agent 实际采用，仍需观察同一会话中的 start → recall → finish；若客户端未加载再重启。',
					'Skill files are verified. Actual Agent adoption still requires an observed start → recall → finish sequence in one session; restart only if the client did not load it.'
				),
				...versions,
				tone: 'success',
				action: null,
				actionLabel: '',
			};
		case 'not_installed':
			return {
				label: localize('Skill 未安装', 'Skill not installed'),
				detail: localize(
					'安装会把记忆召回和任务收尾指导放到客户端约定位置，但不证明 Agent 已加载或采用；安装后仍需真实使用验证。',
					'Installation places memory-recall and task-closeout guidance in the client location, but does not prove that the Agent loaded or adopted it; real-use verification is still required.'
				),
				...versions,
				tone: 'warning',
				action: 'install',
				actionLabel: localize('安装 Skill', 'Install Skill'),
			};
		case 'update_available':
			return {
				label: localize('Skill 可更新', 'Skill update available'),
				detail: localize(
					'更新会替换为最新的记忆召回和任务收尾指导；是否被 Agent 采用仍需真实使用验证。',
					'Updating installs the latest memory-recall and task-closeout guidance; actual Agent adoption still requires real-use verification.'
				),
				...versions,
				tone: 'warning',
				action: 'update',
				actionLabel: localize('更新 Skill', 'Update Skill'),
			};
		case 'legacy_install':
			return {
				label: localize('Skill 位置待迁移', 'Skill location needs migration'),
				detail: localize(
					'迁移后可从官方位置继续接收 Skill 更新；不会删除旧目录。',
					'Migrating enables future Skill updates from the official location without deleting the legacy directory.'
				),
				...versions,
				tone: 'warning',
				action: 'migrate',
				actionLabel: localize('迁移 Skill', 'Migrate Skill'),
			};
		case 'modified':
			return {
				label: localize('Skill 已被修改', 'Skill has local changes'),
				detail: localize(
					'保留用户修改，Tracekeeper 不会自动覆盖。',
					'Local changes are preserved and Tracekeeper will not overwrite them.'
				),
				...versions,
				tone: 'warning',
				action: null,
				actionLabel: '',
			};
		case 'newer_than_bundled':
			return {
				label: localize('Skill 版本较新', 'Skill is newer than bundled'),
				detail: localize(
					'当前版本高于插件内置版本，Tracekeeper 不会降级。',
					'The current version is newer than the bundled version and will not be downgraded.'
				),
				...versions,
				tone: 'muted',
				action: null,
				actionLabel: '',
			};
		case 'location_conflict':
			return {
				label: localize('Skill 目录冲突', 'Skill directory conflict'),
				detail: localize(
					'官方目录和旧目录同时存在，请先手动保留需要的版本并清理重复目录。',
					'Official and legacy directories both exist. Keep the desired version and resolve the duplicate locations manually.'
				),
				...versions,
				tone: 'warning',
				action: null,
				actionLabel: '',
			};
		case 'copy_only':
		case 'unavailable':
			return {
				label: localize('Skill 需手动设置', 'Skill requires manual setup'),
				detail: localize(
					'请按客户端方式手动保存 Skill；保存只提供工作流指导，不证明 Agent 已加载或采用，仍需真实使用验证。',
					'Save the Skill manually using the client workflow. Saving only provides workflow guidance and does not prove Agent loading or adoption; real-use verification is still required.'
				),
				...versions,
				tone: 'warning',
				action: 'copy',
				actionLabel: localize('复制 Skill', 'Copy Skill'),
			};
	}
}
