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
				label: localize('使用指南已安装', 'Guide installed'),
				detail: localize(
					'文件已验证。是否被 Agent 实际采用仍需后续使用观察；若客户端未加载，再重启客户端。',
					'Files are verified. Actual Agent adoption still requires later use observation; restart the client only if it did not load the guide.'
				),
				...versions,
				tone: 'success',
				action: null,
				actionLabel: '',
			};
		case 'not_installed':
			return {
				label: localize('使用指南未安装', 'Guide not installed'),
				detail: localize(
					'安装会把记忆协作使用指南放到客户端约定位置，但不会增加访问权限；安装后仍需通过实际使用观察效果。',
					'Installation places the memory collaboration guide in the client location, but does not add access permissions; observe the result during actual use.'
				),
				...versions,
				tone: 'warning',
				action: 'install',
				actionLabel: localize('安装使用指南', 'Install guide'),
			};
		case 'update_available':
			return {
				label: localize('使用指南可更新', 'Guide update available'),
				detail: localize(
					'更新会替换为最新的记忆协作使用指南；是否被 Agent 采用仍需通过实际使用观察。',
					'Updating installs the latest memory collaboration guide; observe actual use to determine whether the Agent adopts it.'
				),
				...versions,
				tone: 'warning',
				action: 'update',
				actionLabel: localize('更新使用指南', 'Update guide'),
			};
		case 'legacy_install':
			return {
				label: localize('使用指南位置待迁移', 'Guide location needs migration'),
				detail: localize(
					'迁移后可从官方位置继续接收 Skill 更新；不会删除旧目录。',
					'Migrating enables future Skill updates from the official location without deleting the legacy directory.'
				),
				...versions,
				tone: 'warning',
				action: 'migrate',
				actionLabel: localize('迁移使用指南', 'Migrate guide'),
			};
		case 'modified':
			return {
				label: localize('使用指南已被修改', 'Guide has local changes'),
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
				label: localize('使用指南版本较新', 'Guide is newer than bundled'),
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
				label: localize('使用指南目录冲突', 'Guide directory conflict'),
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
				label: localize('使用指南需手动设置', 'Guide requires manual setup'),
				detail: localize(
					'请按客户端方式手动保存使用指南；保存只提供工作流指导，不会增加访问权限，仍需通过实际使用观察效果。',
					'Save the guide using the client workflow. It provides workflow guidance without adding access permissions; observe actual use to confirm the result.'
				),
				...versions,
				tone: 'warning',
				action: 'copy',
				actionLabel: localize('复制使用指南', 'Copy guide'),
			};
	}
}
