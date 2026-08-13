import type {
	SkillFileChange,
	SkillInstallAction,
	SkillInstallPlan,
	SkillInstallState,
} from '../../adapters/client-skill-adapter';

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

export function skillInstallActionLabel(action: SkillInstallAction, localize: Localize): string {
	switch (action) {
		case 'install': return localize('安装', 'Install');
		case 'update': return localize('更新', 'Update');
		case 'migrate': return localize('迁移', 'Migrate');
		case 'conflict': return localize('存在冲突', 'Conflict');
		case 'none': return localize('无需变更', 'No changes');
	}
}

export function skillFileChangeLabel(change: SkillFileChange, localize: Localize): string {
	switch (change) {
		case 'create': return localize('新建', 'Create');
		case 'replace': return localize('替换', 'Replace');
		case 'unchanged': return localize('未变化', 'Unchanged');
	}
}

export function skillInstallPlanDetail(plan: SkillInstallPlan, localize: Localize): string {
	if (plan.action === 'none') {
		return plan.files.every((file) => file.change === 'unchanged')
			? localize('已安装文件与插件内置版本一致，无需写入。', 'Installed files match the embedded bundle; no write is needed.')
			: localize('当前安装的 Skill 版本比插件内置版本更新，已阻止降级覆盖。', 'The installed Skill is newer than the embedded bundle, so downgrade overwrite is blocked.');
	}
	if (!plan.targetDirectory) {
		return localize('请先选择 Skills 根目录。', 'Choose a Skills root directory first.');
	}
	return localize(
		'检测到无法安全自动处理的现有 Skill 内容，请重新选择目录或手动处理冲突。',
		'Existing Skill content cannot be handled automatically and safely. Choose another directory or resolve the conflict manually.'
	);
}

export function skillVerificationFailureDetail(state: SkillInstallState, localize: Localize): string {
	switch (state.state) {
		case 'location_required':
			return localize('请先选择 Skill 目录。', 'Choose a Skill directory first.');
		case 'not_installed':
			return localize('所选目录中未找到 Tracekeeper Skill。', 'No Tracekeeper Skill was found in the selected directory.');
		case 'update_available':
			return state.installedVersion === state.expectedVersion
				? localize('所选 Skill 是已验证的先前官方包，但内容不是当前内置包；请先更新。', 'The selected Skill is a verified previous official bundle, but it does not match the current embedded bundle; update it first.')
				: localize('所选 Skill 版本低于插件内置版本，无法作为当前版本验证。', 'The selected Skill is older than the embedded version and cannot be verified as current.');
		case 'newer_than_bundled':
			return localize('所选 Skill 版本高于插件内置版本，无法作为当前版本验证。', 'The selected Skill is newer than the embedded version and cannot be verified as current.');
		case 'modified':
			return state.installedVersion === state.expectedVersion
				? localize('已安装 Skill 的版本与插件内置版本一致，但内容不一致。', 'The installed Skill version matches the embedded version, but its content does not.')
				: localize('所选 Skill 内容未通过完整性校验。', 'The selected Skill content failed integrity verification.');
		case 'legacy_install':
			return localize('检测到旧位置的 Skill，请选择当前安装目录。', 'A Skill was found in a legacy location. Choose the current installation directory.');
		case 'location_conflict':
			return localize('检测到多个 Skill 位置，无法确认要验证的目录。', 'Multiple Skill locations were detected, so the directory to verify is unclear.');
		case 'unavailable':
			return localize('当前无法读取 Skill 目录。', 'The Skill directory cannot be read right now.');
		case 'installed':
			return localize('Skill 已验证。', 'Skill verified.');
	}
}

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
				label: localize('强化技能未安装', 'Skill not installed'),
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
				label: localize('强化技能可更新', 'Skill update available'),
				detail: localize(
					`将按当前安装目录${state.targetDirectory ? ` ${state.targetDirectory}` : ''} 直接更新。写入前会重新校验并保留备份；检测到用户修改时不会覆盖。`,
					`Update directly in the current installation directory${state.targetDirectory ? ` ${state.targetDirectory}` : ''}. The target is rechecked and backed up before writing; local modifications are never overwritten.`
				),
				...versions,
				tone: 'warning',
				action: 'update',
				actionLabel: localize('更新', 'Update'),
				assistantLabel: localize('AI 辅助更新', 'AI-assisted update'),
			};
		case 'legacy_install':
			return {
				label: localize('强化技能位置待迁移', 'Skill location needs migration'),
				detail: localize('选择新 Skills 根目录可迁移并保留旧目录；也可以让 Agent 按提示词安装到确认的位置。', 'Choose a new Skills root to migrate while keeping the legacy directory, or let the Agent install from the supplied prompt.'),
				...versions,
				tone: 'warning',
				action: 'migrate',
				actionLabel: localize('选择目录迁移', 'Choose directory to migrate'),
				assistantLabel: assistant,
			};
		case 'installed':
			return {
				label: localize('强化技能已安装', 'Skill installed'),
				detail: localize(`文件已验证${state.targetDirectory ? `：${state.targetDirectory}` : ''}。如需更改位置，请重新选择目录；Agent 是否实际采用仍需后续使用观察。`, `Files are verified${state.targetDirectory ? ` at ${state.targetDirectory}` : ''}. Choose another directory to move the selected copy; actual Agent adoption still requires later use.`),
				...versions,
				tone: 'success',
				action: 'install',
				actionLabel: localize('更改目录', 'Change directory'),
				assistantLabel: assistant,
			};
		case 'modified':
			return {
				label: localize('强化技能已被修改', 'Skill has local changes'),
				detail: localize('保留用户修改，Tracekeeper 不会自动覆盖。可让 Agent 协助检查，或选择新的空目录。', 'Local changes are preserved. Tracekeeper will not overwrite them; use AI assistance to inspect or choose a new empty directory.'),
				...versions,
				tone: 'warning',
				action: null,
				actionLabel: '',
				assistantLabel: localize('AI 辅助检查', 'AI-assisted check'),
			};
		case 'newer_than_bundled':
			return {
				label: localize('强化技能版本较新', 'Skill is newer than bundled'),
				detail: localize('当前目录高于插件内置版本，Tracekeeper 不会降级；可让 Agent 协助检查。', 'The selected directory is newer than the bundled version and will not be downgraded; use AI assistance to inspect it.'),
				...versions,
				tone: 'muted',
				action: null,
				actionLabel: '',
				assistantLabel: localize('AI 辅助检查', 'AI-assisted check'),
			};
		case 'location_conflict':
			return {
				label: localize('强化技能目录冲突', 'Skill directory conflict'),
				detail: localize('检测到多个位置，Tracekeeper 不会自动覆盖；请选择新的空目录或让 Agent 协助检查。', 'Multiple locations were detected. Tracekeeper will not overwrite them; choose a new empty directory or use AI assistance to inspect.'),
				...versions,
				tone: 'warning',
				action: null,
				actionLabel: '',
				assistantLabel: localize('AI 辅助检查', 'AI-assisted check'),
			};
		case 'unavailable':
			return {
				label: localize('无法读取强化技能目录', 'Skill directory unavailable'),
				detail: localize('当前环境无法读取或选择 Skill 目录。', 'The current environment cannot read or select a Skill directory.'),
				...versions,
				tone: 'warning',
				action: null,
				actionLabel: '',
				assistantLabel: assistant,
			};
	}
}
