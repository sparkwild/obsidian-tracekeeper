import type { SkillInstallState } from '../../adapters/client-skill-adapter';

export type SkillPromptAction = 'install' | 'update' | 'migrate' | null;
export type SkillPromptTone = 'success' | 'warning' | 'muted';

export interface SkillInstallPrompt {
	label: string;
	detail: string;
	currentVersion: string;
	bundledVersion: string;
	tone: SkillPromptTone;
	action: SkillPromptAction;
	actionLabel: string;
	assistantLabel: string;
}

type Localize = (zh: string, en: string) => string;

const currentVersionLabel = (state: SkillInstallState, localize: Localize): string => {
	switch (state.state) {
		case 'location_required':
			return localize('尚未选择目录', 'Directory not selected');
		case 'not_installed':
			return localize('未安装', 'Not installed');
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
			return state.installedVersion ? `v${state.installedVersion}` : localize('无法验证', 'Unverified');
		case 'unavailable':
			return localize('暂不可用', 'Unavailable');
	}
};

export function buildSkillInstallPrompt(state: SkillInstallState, localize: Localize): SkillInstallPrompt {
	const versions = {
		currentVersion: currentVersionLabel(state, localize),
		bundledVersion: `v${state.expectedVersion}`,
	};
	const assistant = localize('AI 辅助安装', 'AI-assisted install');
	switch (state.state) {
		case 'location_required':
		case 'not_installed':
			return {
				label: localize('使用指南未安装', 'Guide not installed'),
				detail: localize(
					'请选择 Skills 根目录，Tracekeeper 会预览并在确认后写入 tracekeeper 子目录；也可以让 Agent 按提示词协助安装。',
					'Select a Skills root directory. Tracekeeper previews the tracekeeper subdirectory before writing, or let the Agent assist from the supplied prompt.'
				),
				...versions,
				tone: 'warning',
				action: 'install',
				actionLabel: localize('选择目录安装', 'Choose directory'),
				assistantLabel: assistant,
			};
		case 'update_available':
			return {
				label: localize('使用指南可更新', 'Guide update available'),
				detail: localize('请选择目录确认更新；已有目录会先预览并备份，不会覆盖用户修改。', 'Choose a directory to preview an update. Existing files are backed up and local changes are never overwritten.'),
				...versions,
				tone: 'warning',
				action: 'update',
				actionLabel: localize('选择目录更新', 'Choose directory to update'),
				assistantLabel: localize('AI 辅助更新', 'AI-assisted update'),
			};
		case 'legacy_install':
			return {
				label: localize('使用指南位置待迁移', 'Guide location needs migration'),
				detail: localize('选择新 Skills 根目录可迁移并保留旧目录；也可以让 Agent 按提示词安装到确认的位置。', 'Choose a new Skills root to migrate while keeping the legacy directory, or let the Agent install from the supplied prompt.'),
				...versions,
				tone: 'warning',
				action: 'migrate',
				actionLabel: localize('选择目录迁移', 'Choose directory to migrate'),
				assistantLabel: assistant,
			};
		case 'installed':
			return {
				label: localize('使用指南已安装', 'Guide installed'),
				detail: localize(`文件已验证${state.targetDirectory ? `：${state.targetDirectory}` : ''}。如需更改位置，请重新选择目录；Agent 是否实际采用仍需后续使用观察。`, `Files are verified${state.targetDirectory ? ` at ${state.targetDirectory}` : ''}. Choose another directory to move the selected copy; actual Agent adoption still requires later use.`),
				...versions,
				tone: 'success',
				action: 'install',
				actionLabel: localize('更改目录', 'Change directory'),
				assistantLabel: assistant,
			};
		case 'modified':
			return {
				label: localize('使用指南已被修改', 'Guide has local changes'),
				detail: localize('保留用户修改，Tracekeeper 不会自动覆盖。可让 Agent 协助检查，或选择新的空目录。', 'Local changes are preserved. Tracekeeper will not overwrite them; use AI assistance to inspect or choose a new empty directory.'),
				...versions,
				tone: 'warning',
				action: null,
				actionLabel: '',
				assistantLabel: localize('AI 辅助检查', 'AI-assisted check'),
			};
		case 'newer_than_bundled':
			return {
				label: localize('使用指南版本较新', 'Guide is newer than bundled'),
				detail: localize('当前目录高于插件内置版本，Tracekeeper 不会降级；可让 Agent 协助检查。', 'The selected directory is newer than the bundled version and will not be downgraded; use AI assistance to inspect it.'),
				...versions,
				tone: 'muted',
				action: null,
				actionLabel: '',
				assistantLabel: localize('AI 辅助检查', 'AI-assisted check'),
			};
		case 'location_conflict':
			return {
				label: localize('使用指南目录冲突', 'Guide directory conflict'),
				detail: localize('检测到多个位置，Tracekeeper 不会自动覆盖；请选择新的空目录或让 Agent 协助检查。', 'Multiple locations were detected. Tracekeeper will not overwrite them; choose a new empty directory or use AI assistance to inspect.'),
				...versions,
				tone: 'warning',
				action: null,
				actionLabel: '',
				assistantLabel: localize('AI 辅助检查', 'AI-assisted check'),
			};
		case 'unavailable':
			return {
				label: localize('无法读取使用指南目录', 'Skill directory unavailable'),
				detail: state.detail,
				...versions,
				tone: 'warning',
				action: null,
				actionLabel: '',
				assistantLabel: assistant,
			};
	}
}
