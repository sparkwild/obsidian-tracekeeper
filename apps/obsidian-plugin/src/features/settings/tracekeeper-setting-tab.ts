import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { AgentConnectionsSnapshot } from '../activity/activity-model';
import type { GeneratedClientConfig } from '../client-config/client-config';
import { clientConfigStatusClass } from '../client-config/client-config';
import {
	getOnboardingStepSequence,
	getNextOnboardingStep,
	isOnboardingStepCompleted,
	type OnboardingProgressContext,
	type OnboardingStep,
} from '../onboarding/onboarding-state';
import {
	buildOnboardingObservedEvidence,
	buildOnboardingRecallInstruction,
	findOnboardingRuntimePrincipal,
	onboardingContextDescription,
	onboardingStepLabel,
} from '../onboarding/onboarding-view-model';
import { MemoryRecallPreviewModal } from '../recall/memory-recall-preview-modal';
import { ClientConfigPreviewModal, ClientCredentialRotateConfirmModal } from '../client-config/client-config-modals';
import { McpCapabilitiesModal } from '../runtime/mcp-capabilities-modal';
import { RuntimeTokenRegenerateConfirmModal } from '../runtime/runtime-confirmation-modals';
import { RuntimeLogCleanupModal } from '../runtime/runtime-log-view';
import { DEFAULT_MCP_HOST, DEFAULT_MCP_PORT } from '../runtime/runtime-defaults';
import { runtimeViewModel } from '../runtime/runtime-view-model';
import {
	AUTO_REFRESH_INTERVAL_OPTIONS,
	MEMORY_PROPOSAL_RULES,
	NOTE_CONTENT_LANGUAGES,
	TASK_MEMORY_PROPOSAL_MODES,
	memoryProposalRuleLabel,
	normalizeGraphProfileValue,
	noteContentLanguageLabel,
	taskMemoryProposalModeLabel,
} from './settings-model';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_RUNTIME_LOG_VIEW } from '../../ui/view-types';
import type { SkillInstallAction, SkillInstallState } from '../../adapters/client-skill-adapter';
import { SkillInstallPreviewModal } from '../skill-installation/skill-install-modals';
import {
	type RuntimeCredentialCapabilityProfile,
	RUNTIME_CREDENTIAL_PRESET_DEFINITIONS,
} from '../settings/runtime-credentials';

const skillActionForState = (state: SkillInstallState): Extract<SkillInstallAction, 'install' | 'update' | 'migrate'> | null => {
	if (state.state === 'not_installed') return 'install';
	if (state.state === 'update_available') return 'update';
	if (state.state === 'legacy_install') return 'migrate';
	return null;
};

export class TracekeeperSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: TracekeeperPlugin
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('tracekeeper-settings-root');
		const loading = containerEl.createDiv({ cls: 'tracekeeper-view__description' });
		loading.setText(ui('正在读取连接配置...', 'Reading connection settings...'));
		void this.renderSettings();
	}

	private async renderSettings(): Promise<void> {
		const snapshot = await this.plugin.loadAgentConnectionsSnapshot();
		const vaultReady = this.plugin.isVaultStructureReady();
		const context = this.plugin.getOnboardingContext(snapshot, vaultReady);
		const skillInstallState = this.plugin.getSkillInstallState(this.plugin.settings.onboarding.selectedClientId);
		const nextStep = getNextOnboardingStep(this.plugin.settings.onboarding, context);
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('tracekeeper-settings-root');
		this.renderOnboardingSection(containerEl, snapshot, context, nextStep, skillInstallState);
		this.renderConnectionInfoSection(containerEl, snapshot);
		this.renderAgentClientConfigSection(containerEl, snapshot);
		this.renderViewRefreshSection(containerEl);
		this.renderNoteContentSection(containerEl);
		this.renderMemoryRulesSection(containerEl);
		this.renderAdvancedMaintenanceSection(containerEl);
		this.renderTokenSection(containerEl);
	}

	private renderAgentClientConfigSection(container: HTMLElement, snapshot: AgentConnectionsSnapshot): void {
		const section = this.createSection(
			container,
			ui('Agent 配置', 'Agent configuration'),
			ui('为常用 Agent 配置 Tracekeeper 连接，保持 Obsidian 开启后即可使用。', 'Configure Tracekeeper for your agents. Keep Obsidian open to use it.')
		);
		const grid = section.createDiv({ cls: 'tracekeeper-settings-grid' });
		for (const config of snapshot.clientConfigs) {
			this.renderClientConfigRow(grid, config);
		}
	}

	private renderOnboardingSection(
		container: HTMLElement,
		snapshot: AgentConnectionsSnapshot,
		context: OnboardingProgressContext,
		nextStep: OnboardingStep,
		skillInstallState: SkillInstallState
	): void {
		const section = this.createSection(
			container,
			ui('首次接入引导', 'Onboarding'),
			ui('按以下步骤完成首轮接入，后续可随时从已完成步骤继续。', 'Complete onboarding steps to enable first run and resume automatically.')
		);
		const steps = section.createDiv({ cls: 'tracekeeper-onboarding-steps' });
		for (const [index, stepId] of getOnboardingStepSequence(context).entries()) {
			const done = isOnboardingStepCompleted(stepId, this.plugin.settings.onboarding, context);
			const active = nextStep === stepId;
			const row = steps.createDiv({ cls: 'tracekeeper-onboarding-step' });
			row.createEl('span', { text: `${index + 1}. ${onboardingStepLabel(stepId, ui)}` });
			row.createEl('span', {
				text: done
					? ui('已完成', 'Done')
					: active
						? ui('进行中', 'In progress')
						: ui('待完成', 'Pending'),
				cls: `tracekeeper-badge ${done ? 'tracekeeper-badge--success' : active ? 'tracekeeper-badge--warning' : 'tracekeeper-badge--muted'}`,
			});
		}
		section.createEl('p', {
			text: onboardingContextDescription(context, ui),
			cls: 'tracekeeper-view__description',
		});
		const evidence = section.createDiv({ cls: 'tracekeeper-skill-evidence' });
		evidence.createEl('h4', { text: ui('Skill 接入状态', 'Skill setup status') });
		const profileLabel = skillInstallState.deliveryMode === 'managed'
			? ui('本地单用户受管 Profile（不是团队 RBAC）', 'Local single-user managed profile (not team RBAC)')
			: ui('本地单用户复制 Profile（不是团队 RBAC）', 'Local single-user copy-only profile (not team RBAC)');
		const activationDetail = skillInstallState.activationMode === 'automatic_with_restart_fallback'
			? ui('客户端通常会自动识别；若未出现再重启。', 'The client normally detects changes automatically; restart only if it does not appear.')
			: ui('完成设置后需要在客户端中重启或重新加载。', 'Restart or reload the client after setup.');
		this.renderSkillEvidence(evidence, ui('Profile', 'Profile'), profileLabel, true);
		this.renderSkillEvidence(evidence, ui('Bundle 可用', 'Bundle available'), `v${skillInstallState.expectedVersion}`, context.skillAvailable);
		this.renderSkillEvidence(evidence, ui('已复制', 'Copied'), ui('人工复制事件', 'Manual copy event'), context.skillCopied);
		this.renderSkillEvidence(evidence, ui('用户确认', 'User confirmed'), ui('人工自证，不等于文件验证', 'Self-attested, not file verification'), context.skillUserConfirmed);
		this.renderSkillEvidence(evidence, ui('文件验证', 'File verified'), skillInstallState.detail, context.skillFileVerified);
		this.renderSkillEvidence(
			evidence,
			ui('记忆策略已确认', 'Memory policy confirmed'),
			ui('确认当前持久化规则；自动项目记忆必须由用户显式选择。', 'Confirms the current persistence rules; automatic project memory requires an explicit user choice.'),
			context.memoryPolicyConfirmed
		);
		this.renderSkillEvidence(
			evidence,
			skillInstallState.restartRequired ? ui('客户端已重载', 'Client reloaded') : ui('客户端自动识别', 'Client auto-detection'),
			skillInstallState.restartRequired ? ui('人工确认或客户端证据', 'User confirmation or client evidence') : activationDetail,
			context.clientReloaded
		);
		this.renderSkillEvidence(evidence, ui('连接验证', 'Connection verified'), ui('Principal MCP 审计证据', 'Principal MCP audit evidence'), context.connectionVerified);
		this.renderSkillEvidence(evidence, ui('Recall 已观察', 'Recall observed'), ui('不证明 Skill 自动触发', 'Does not prove automatic Skill triggering'), context.recallObserved);
		if (context.workflowManageAvailable) {
			this.renderSkillEvidence(evidence, ui('完整工作流已观察', 'Tracked workflow observed'), ui('同 Principal 的 start → recall → finish', 'Same-principal start → recall → finish'), context.trackedWorkflowObserved);
		} else {
			this.renderSkillEvidence(evidence, ui('Recall-only 能力限制', 'Recall-only capability limit'), ui('所选 Principal 没有 workflow.manage；无需也不能验证 tracked closeout。', 'The selected principal does not have workflow.manage; tracked closeout is neither required nor available.'), true);
		}
		this.renderSkillEvidence(evidence, ui('存在更新', 'Update available'), skillInstallState.detail, context.skillUpdateAvailable, true);
		if (context.recallObserved) {
			this.renderObservedEvidence(section, snapshot, skillInstallState.expectedVersion);
		}

		const actionWrap = section.createDiv({ cls: 'tracekeeper-action-row' });
		if (nextStep === 'vault_check') {
			const repair = actionWrap.createEl('button', { text: ui('补齐结构', 'Repair structure') });
			repair.addEventListener('click', () => {
				void this.plugin.openInitializeMemoryStructureModal();
			});
		}
		if (nextStep === 'runtime') {
			const runtime = runtimeViewModel(snapshot.runtimeStatus, ui);
			section.createEl('p', {
				text: runtime.detail,
				cls: 'tracekeeper-view__description',
			});
			const openService = actionWrap.createEl('button', {
				text: runtime.primaryAction === 'enable'
					? ui('开启 MCP 服务', 'Enable MCP service')
					: ui('重新启动 MCP 服务', 'Retry MCP service'),
				cls: 'mod-cta',
			});
			openService.disabled = runtime.busy;
			openService.addEventListener('click', () => {
				openService.disabled = true;
				void this.plugin.ensureMcpRuntimeRunning()
					.then(() => this.renderSettings())
					.catch((error) => {
						console.error('tracekeeper failed to enable MCP service from onboarding', error);
						openService.disabled = false;
						new Notice(error instanceof Error ? error.message : ui('MCP 服务启动失败。', 'Failed to start MCP service.'));
					});
			});
		}
		if (nextStep === 'client_configuration') {
			const selectedClient = this.plugin.settings.onboarding.selectedClientId;
			const selectedConfig = this.plugin.getOnboardingSelectedClient(snapshot);
			new Setting(section)
				.setName(ui('选择客户端', 'Select client'))
				.setDesc(ui('选择要配置的客户端，并标记是否已写入配置。', 'Select a client and confirm configuration was applied.'))
				.addDropdown((dropdown) => {
					for (const client of snapshot.clientConfigs) {
						dropdown.addOption(client.clientId, client.displayName);
					}
					dropdown
						.setValue(selectedClient)
						.onChange((clientId) => {
							void this.plugin.setOnboardingClientId(clientId)
								.then(() => this.renderSettings())
								.catch((error) => {
									console.error('tracekeeper failed to select onboarding client', error);
								});
						});
				});
				if (selectedConfig && selectedConfig.configState === 'configured') {
					new Setting(section)
						.setName(ui('配置状态', 'Configuration status'))
						.setDesc(ui('当前客户端已检测到 Tracekeeper 配置。', 'The selected client already reports Tracekeeper configuration.'));
				} else {
					new Setting(section)
						.setName(ui('已完成手动配置', 'Manual config done'))
						.setDesc(ui('已在客户端完成配置复制/粘贴，并准备继续。', 'Copied/pasted the config in the client and are ready to continue.'))
						.addButton((button) => {
							button
								.setButtonText(ui('我已完成配置', 'Mark this client configured'))
								.onClick(() => {
									void this.plugin.markOnboardingClientConfigured()
										.then(() => this.renderSettings())
										.catch((error) => {
											console.error('tracekeeper failed to mark client configuration', error);
										});
								});
						});
					}
		}
			if (nextStep === 'skill_setup') {
				const clientId = this.plugin.settings.onboarding.selectedClientId;
				const action = skillActionForState(skillInstallState);
				if (action) {
					const actionText = action === 'install'
						? ui('安装', 'Install')
						: action === 'update'
							? ui('更新', 'Update')
							: ui('迁移', 'Migrate');
					const legacyDirectory = skillInstallState.legacyTargetDirectories[0];
					new Setting(section)
						.setName(ui(`${actionText}完整 Skill bundle`, `${actionText} complete Skill bundle`))
						.setDesc(ui(
							action === 'migrate'
								? `旧目录会保留不变；先预览后才将官方 bundle 复制到目标目录。旧目录：${legacyDirectory || ''}；目标：${skillInstallState.targetDirectory || ''}`
								: `先预览目标目录和文件清单；只有再次确认后才写入。目标：${skillInstallState.targetDirectory || ''}`,
							action === 'migrate'
								? `The legacy directory remains unchanged. Preview before copying the official bundle to the target. Legacy: ${legacyDirectory || ''}; target: ${skillInstallState.targetDirectory || ''}`
								: `Preview the target directory and files first. Nothing is written until confirmation. Target: ${skillInstallState.targetDirectory || ''}`
						))
						.addButton((button) => button
							.setButtonText(ui(`预览${actionText}`, `Preview ${actionText.toLowerCase()}`))
							.onClick(() => new SkillInstallPreviewModal(this.app, this.plugin, clientId, action, () => {
								void this.renderSettings();
							}).open()));
				}
				if (skillInstallState.state === 'modified') {
					new Setting(section)
						.setName(ui('检测到用户修改', 'User-modified Skill detected'))
						.setDesc(ui(
							'自动覆盖已禁止。请先保留修改、移走现有目录，或手动比较后再安装。',
							'Automatic overwrite is disabled. Preserve or move the existing directory, or compare it manually before installing.'
						));
				}
				if (skillInstallState.state === 'newer_than_bundled') {
					new Setting(section)
						.setName(ui('检测到更高版本', 'Newer Skill version detected'))
						.setDesc(ui(
							`当前安装版本 v${skillInstallState.installedVersion} 高于插件内置版本 v${skillInstallState.expectedVersion}，已保留且不会降级。`,
							`Installed v${skillInstallState.installedVersion} is newer than bundled v${skillInstallState.expectedVersion}; it is preserved and will not be downgraded.`
						));
				}
				if (skillInstallState.state === 'location_conflict') {
					new Setting(section)
						.setName(ui('检测到多个 Skill 目录', 'Multiple Skill locations detected'))
						.setDesc(ui(
							'官方目录和旧目录同时存在。为避免误删或覆盖，请先在文件系统中保留需要的版本并手动清理重复目录。',
							'Both official and legacy directories exist. To avoid deletion or overwrite, keep the desired version and manually resolve the duplicate directories first.'
						));
				}
				section.createEl('p', {
					text: activationDetail,
					cls: 'tracekeeper-view__description',
				});
				new Setting(section)
					.setName(ui('复制单文件兼容 Skill', 'Copy flattened compatibility Skill'))
					.setDesc(ui(
						'供不支持目录 Skill 或自动安装的客户端使用。复制事件不证明文件已安装。',
						'Use for clients without directory Skills or managed installation. Copying does not prove installation.'
					))
					.addButton((button) => {
						button
							.setButtonText(ui('复制兼容 Skill', 'Copy compatibility Skill'))
							.onClick(() => {
								void this.plugin.copyTracekeeperSkillFallback()
									.then(() => this.renderSettings())
									.catch((error) => {
									console.error('tracekeeper failed to copy Skill content', error);
									new Notice(ui('复制 Skill 失败。', 'Failed to copy Skill content.'));
								});
							});
					});
				new Setting(section)
					.setName(ui('人工确认 Skill', 'User-confirm Skill setup'))
					.setDesc(ui('仅记录人工确认，不会显示为 file_verified。', 'Records self-attestation only and is never shown as file_verified.'))
					.addButton((button) => {
						button
							.setButtonText(ui('我已完成 Skill 设置', 'Skill setup is done'))
							.onClick(() => {
								void this.plugin.markOnboardingSkillSetup()
									.then(() => this.renderSettings())
									.catch((error) => {
										console.error('tracekeeper failed to mark skill setup', error);
									});
							});
					});
			}
		if (nextStep === 'agent_restart') {
			new Setting(section)
				.setName(ui('确认重启客户端', 'Confirm client restart'))
				.setDesc(ui('按目标客户端提示重启后继续。', 'Restart the client as indicated and then continue.'))
				.addButton((button) => {
					button
						.setButtonText(ui('我已完成重启', 'Mark client restarted'))
						.onClick(() => {
							void this.plugin.markOnboardingAgentRestart()
								.then(() => this.renderSettings())
								.catch((error) => {
									console.error('tracekeeper failed to mark agent restart', error);
								});
						});
				});
		}
		if (nextStep === 'memory_policy') {
			new Setting(section)
				.setName(ui('项目记忆持久化', 'Project memory persistence'))
				.setDesc(ui(
					'新安装默认进入审核。只有你明确选择“自动”后，项目记忆才会在满足既有追加、去重和 Wiki 关联条件时自动保存。',
					'New installations start in review. Project memory auto-saves only after you explicitly choose Auto and the existing append-only, duplicate, and Wiki-link conditions are met.'
				))
				.addDropdown((dropdown) => {
					for (const rule of MEMORY_PROPOSAL_RULES) {
						dropdown.addOption(rule, memoryProposalRuleLabel(rule));
					}
					dropdown
						.setValue(this.plugin.settings.projectMemoryRule)
						.onChange((value: string) => {
							void this.plugin.setProjectMemoryRule(value)
								.then(() => this.renderSettings())
								.catch((error) => console.error('tracekeeper failed to update onboarding project memory rule', error));
						});
				});
			new Setting(section)
				.setName(ui('确认当前记忆策略', 'Confirm current memory policy'))
				.setDesc(ui(
					`全局记忆：${memoryProposalRuleLabel(this.plugin.settings.globalMemoryRule)}；项目记忆：${memoryProposalRuleLabel(this.plugin.settings.projectMemoryRule)}；任务结束提案：${taskMemoryProposalModeLabel(this.plugin.settings.taskMemoryProposalMode)}。你可以稍后在“记忆规则”中调整。`,
					`Global memory: ${memoryProposalRuleLabel(this.plugin.settings.globalMemoryRule)}; project memory: ${memoryProposalRuleLabel(this.plugin.settings.projectMemoryRule)}; task-closeout proposals: ${taskMemoryProposalModeLabel(this.plugin.settings.taskMemoryProposalMode)}. You can adjust these later in Memory rules.`
				))
				.addButton((button) => {
					button
						.setButtonText(ui('确认记忆策略', 'Confirm memory policy'))
						.setCta()
						.onClick(() => {
							void this.plugin.confirmOnboardingMemoryPolicy()
								.then(() => this.renderSettings())
								.catch((error) => console.error('tracekeeper failed to confirm onboarding memory policy', error));
						});
				});
		}
		if (nextStep === 'connection_verification') {
			new Setting(section)
				.setName(ui('验证连接', 'Verify connection'))
				.setDesc(ui('验证本地运行时可被客户端连接。', 'Verify local runtime can be reached by the client.'))
				.addButton((button) => {
					button
						.setButtonText(ui('验证 MCP 连接', 'Verify MCP connection'))
						.onClick(() => {
							void this.plugin.verifyOnboardingConnection()
								.then(() => this.renderSettings())
								.then(() => {
									new Notice(ui('连接验证成功。', 'Connection verified.'));
								})
								.catch((error) => {
									console.error('tracekeeper failed to verify onboarding connection', error);
									new Notice(error instanceof Error ? error.message : ui('连接验证失败。', 'Connection verification failed.'));
								});
						});
				});
		}
		if (nextStep === 'first_recall') {
			section.createEl('p', {
				text: ui(
					'请在所选 Agent 中调用 tracekeeper.recall，并使用窄查询获得至少一条命中；随后回到这里验证审计证据。',
					'Ask the selected agent to call tracekeeper.recall with a narrow query and obtain at least one match, then verify its audit evidence here.'
				),
				cls: 'tracekeeper-view__description',
			});
			let recallKeyword = this.plugin.settings.onboarding.firstRecallQuery;
			let copyInstructionButton: HTMLButtonElement | null = null;
			new Setting(section)
				.setName(ui('已知关键词', 'Known keyword'))
				.setDesc(ui(
					'输入当前知识库中确定存在的项目、功能、决策或问题关键词。',
					'Enter a project, feature, decision, or issue keyword known to exist in this vault.'
				))
				.addText((text) => {
					text
						.setPlaceholder(ui('例如：知识索引', 'For example: knowledge index'))
						.setValue(recallKeyword)
						.onChange((value) => {
							recallKeyword = value.trim();
							if (copyInstructionButton) {
								copyInstructionButton.disabled = recallKeyword.length === 0;
							}
						});
				})
				.addButton((button) => {
					copyInstructionButton = button.buttonEl;
					copyInstructionButton.disabled = recallKeyword.length === 0;
					button
						.setButtonText(ui('复制测试指令', 'Copy test instruction'))
						.onClick(() => {
							const instruction = buildOnboardingRecallInstruction({
								keyword: recallKeyword,
								workflowManageAvailable: context.workflowManageAvailable,
								localize: ui,
							}).instruction;
							void this.plugin.copyToClipboard(
								instruction,
								ui('已复制首次召回测试指令。', 'First-recall test instruction copied.')
							);
						});
				});
			const firstRecallAction = actionWrap.createEl('button', { text: ui('验证 Agent 首次召回', 'Verify agent recall') });
			firstRecallAction.addEventListener('click', () => {
				void this.plugin.verifyOnboardingFirstRecall()
					.then(() => this.renderSettings())
					.then(() => {
						new Notice(ui('首次召回证据已验证。', 'First recall evidence verified.'));
					})
					.catch((error) => {
						console.error('tracekeeper failed to verify onboarding recall', error);
						new Notice(error instanceof Error ? error.message : ui('首次召回验证失败。', 'First recall verification failed.'));
					});
			});
		}
		if (nextStep === 'tracked_workflow') {
			section.createEl('p', {
				text: ui(
					'请让所选 Principal 完成同一任务的 start → recall → finish；必须使用 Runtime 返回的 task_id 和 Recall 指令。',
					'Have the selected principal complete start → recall → finish for one task, using the Runtime-returned task_id and Recall instruction.'
				),
				cls: 'tracekeeper-view__description',
			});
			const workflowAction = actionWrap.createEl('button', { text: ui('验证完整 tracked workflow', 'Verify tracked workflow') });
			workflowAction.addEventListener('click', () => {
				void this.plugin.verifyOnboardingTrackedWorkflow()
					.then(() => this.renderSettings())
					.catch((error) => new Notice(error instanceof Error ? error.message : String(error)));
			});
		}

		if (nextStep !== 'complete') {
			const clear = actionWrap.createEl('button', {
				text: ui('重置引导', 'Reset onboarding'),
				cls: 'mod-warning',
			});
			clear.addEventListener('click', () => {
				void this.plugin.resetOnboardingProgress()
					.then(() => this.renderSettings())
					.catch((error) => {
						console.error('tracekeeper failed to reset onboarding state', error);
					});
			});
		}
	}

	private renderSkillEvidence(
		container: HTMLElement,
		label: string,
		detail: string,
		verified: boolean,
		warningWhenTrue = false
	): void {
		const row = container.createDiv({ cls: 'tracekeeper-skill-evidence__row' });
		const description = row.createDiv({ cls: 'tracekeeper-skill-evidence__description' });
		description.createEl('strong', { text: label });
		description.createEl('div', { text: detail, cls: 'tracekeeper-view__description' });
		row.createEl('span', {
			text: verified ? ui('是', 'Yes') : ui('否', 'No'),
			cls: `tracekeeper-badge ${verified
				? warningWhenTrue ? 'tracekeeper-badge--warning' : 'tracekeeper-badge--success'
				: 'tracekeeper-badge--muted'}`,
		});
	}

	private renderObservedEvidence(
		container: HTMLElement,
		snapshot: AgentConnectionsSnapshot,
		skillBundleVersion: string
	): void {
		const selectedClient = this.plugin.getOnboardingSelectedClient(snapshot);
		const principalId = findOnboardingRuntimePrincipal(
			this.plugin.settings.runtimeCredentials,
			this.plugin.settings.onboarding.selectedClientId
		);
		const evidence = buildOnboardingObservedEvidence({
			selectedClient,
			principalId,
			onboarding: this.plugin.settings.onboarding,
			skillBundleVersion,
		});
		const card = container.createDiv({ cls: 'tracekeeper-card tracekeeper-onboarding-evidence' });
		card.createEl('h4', { text: ui('已观察到的 Agent 证据', 'Observed agent evidence') });
		const details = card.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(details, ui('客户端', 'Client'), selectedClient?.displayName || evidence.selectedClientId);
		this.renderDetail(details, 'Principal', evidence.principalId);
		this.renderDetail(details, ui('Recall 查询', 'Recall query'), evidence.firstRecallQuery);
		this.renderDetail(details, ui('命中数量', 'Matched count'), String(evidence.firstRecallMatchedCount));
		this.renderDetail(
			details,
			ui('观察时间', 'Observed at'),
			evidence.firstRecallMatchedAt
				? this.plugin.formatDisplayTime(Date.parse(evidence.firstRecallMatchedAt))
				: ui('未知', 'Unknown')
		);
		this.renderDetail(details, ui('Skill bundle', 'Skill bundle'), `v${evidence.skillBundleVersion}`);
		this.renderDetail(
			details,
			ui('完整工作流', 'Tracked workflow'),
			evidence.trackedWorkflowStatus === 'observed'
				? ui('已观察', 'Observed')
				: ui('未观察', 'Not observed')
		);
		if (evidence.trackedWorkflowTaskId) {
			this.renderDetail(details, 'Task ID', evidence.trackedWorkflowTaskId);
		}
		const note = card.createEl('p', {
			text: ui(
				'这些状态来自所选 Principal 的本地审计记录。本地预览不会完成 Agent 连接或首次 Recall 验证。',
				'These states come from local audit records for the selected principal. Local preview does not complete agent connection or first-recall verification.'
			),
			cls: 'tracekeeper-view__description',
		});
		note.setAttr('role', 'note');
		const actions = card.createDiv({ cls: 'tracekeeper-action-row' });
		const preview = actions.createEl('button', { text: ui('本地预览同一查询', 'Preview the same query locally') });
		preview.addEventListener('click', () => {
			new MemoryRecallPreviewModal(this.app, this.plugin, {
				query: evidence.firstRecallQuery,
				scope: 'project',
			}).open();
		});
	}

	private renderConnectionInfoSection(container: HTMLElement, snapshot: AgentConnectionsSnapshot): void {
		const section = this.createSection(
			container,
			ui('MCP 服务', 'MCP service'),
			ui('查看 Obsidian 托管的本机服务状态，并在需要时恢复连接。', 'Review the local service hosted by Obsidian and recover it when needed.')
		);
		this.renderRuntimeEnabledSetting(section, snapshot);
		this.renderCapabilitiesSetting(section);
		this.renderPortSetting(section, snapshot.runtimeStatus.endpoint);
	}

	private renderRuntimeEnabledSetting(container: HTMLElement, snapshot: AgentConnectionsSnapshot): void {
		const enabled = this.plugin.settings.mcpRuntimeEnabled;
		const runtime = runtimeViewModel(snapshot.runtimeStatus, ui);
		new Setting(container)
			.setName(`${ui('服务状态', 'Service status')}: ${runtime.label}`)
			.setDesc(runtime.detail)
			.addToggle((toggle) =>
				toggle
					.setValue(enabled)
					.setDisabled(runtime.busy)
					.onChange((value: boolean) => {
						void this.plugin.setMcpRuntimeEnabled(value)
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to toggle MCP service', error);
							});
					})
			);
		if (runtime.primaryAction === 'retry') {
			new Setting(container)
				.setName(ui('恢复服务', 'Recover service'))
				.setDesc(ui(
					'重新创建由当前 Obsidian Vault 托管的 MCP Runtime。',
					'Recreate the MCP Runtime hosted by the current Obsidian vault.'
				))
				.addButton((button) => button
					.setButtonText(ui('重新启动', 'Retry start'))
					.setCta()
					.onClick(() => {
						button.setDisabled(true);
						void this.plugin.ensureMcpRuntimeRunning()
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to recover MCP service', error);
								button.setDisabled(false);
								new Notice(error instanceof Error ? error.message : ui('MCP 服务启动失败。', 'Failed to start MCP service.'));
							});
					}));
		}
	}

	private renderCapabilitiesSetting(container: HTMLElement): void {
		new Setting(container)
			.setName(ui('服务功能', 'Capabilities'))
			.setDesc(ui('查看 AI 工具可以调用的 MCP 服务功能。', 'View the MCP service capabilities available to agents.'))
			.addButton((button) =>
				button
					.setButtonText(ui('查看功能', 'View capabilities'))
					.onClick(() => {
						new McpCapabilitiesModal(this.app).open();
					})
			);
	}

	private renderTokenSection(container: HTMLElement): void {
		const section = container.createEl('details', { cls: 'tracekeeper-settings-section tracekeeper-legacy-credentials' });
		section.createEl('summary', { text: ui('高级兼容：旧版共享凭据', 'Advanced compatibility: legacy shared credential') });
		section.createEl('p', {
			text: ui(
				'仅用于旧配置迁移。新 Agent 应使用各自配置行中的独立凭据。',
				'For legacy configuration migration only. New agents should use the independent credential in their configuration row.'
			),
			cls: 'tracekeeper-settings-section__description',
		});
		const runtimeToken = this.plugin.settings.runtimeToken;
		const runtimeTokenCreatedAt = this.plugin.formatDisplayTime(Date.parse(this.plugin.settings.runtimeTokenCreatedAt));
		const row = section.createDiv({ cls: 'tracekeeper-settings-token-row' });
		const info = row.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(info, ui('令牌', 'Token'), this.plugin.formatRuntimeToken(runtimeToken));
		this.renderDetail(info, ui('创建时间', 'Created'), runtimeTokenCreatedAt);
		const actions = row.createDiv({ cls: 'tracekeeper-action-row' });
		const copy = actions.createEl('button', { text: ui('复制令牌', 'Copy token') });
		copy.disabled = !runtimeToken;
		copy.addEventListener('click', () => {
			void this.plugin.copyToClipboard(
				runtimeToken,
				ui('已复制本地连接令牌。', 'Local connection token copied.')
			);
		});
		const regenerate = actions.createEl('button', { text: ui('重置全部凭据', 'Reset all credentials') });
		regenerate.addEventListener('click', () => {
			new RuntimeTokenRegenerateConfirmModal(
				this.app,
				this.plugin,
				() => this.display()
			).open();
		});
	}

	private renderViewRefreshSection(container: HTMLElement): void {
		const section = this.createSection(
			container,
			ui('视图刷新', 'View refresh'),
			ui(
				'活动页和知识变更审核打开时会自动同步最新任务、记忆和审核状态。',
				'When Activity or Knowledge Change Review is open, Tracekeeper keeps task, memory, and review status in sync.'
			)
		);
		new Setting(section)
			.setName(ui('自动刷新', 'Auto refresh'))
			.setDesc(ui(
				'开启后定时刷新，并在 Tracekeeper 相关文件变化时自动刷新。',
				'Refreshes on a timer and after Tracekeeper-related file changes.'
			))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoRefreshEnabled)
					.onChange((value: boolean) => {
						void this.plugin.setAutoRefreshEnabled(value)
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to update auto refresh setting', error);
							});
					})
			);
		new Setting(section)
			.setName(ui('刷新间隔', 'Refresh interval'))
			.setDesc(ui(
				`当前为 ${this.plugin.settings.autoRefreshIntervalSeconds} 秒；文件变化会额外触发即时刷新。`,
				`Current interval is ${this.plugin.settings.autoRefreshIntervalSeconds} seconds; file changes also trigger a near-immediate refresh.`
			))
			.addDropdown((dropdown) => {
				const intervals = Array.from(new Set([
					...AUTO_REFRESH_INTERVAL_OPTIONS,
					this.plugin.settings.autoRefreshIntervalSeconds,
				])).sort((a, b) => a - b);
				for (const seconds of intervals) {
					dropdown.addOption(String(seconds), ui(`${seconds} 秒`, `${seconds}s`));
				}
				dropdown
					.setValue(String(this.plugin.settings.autoRefreshIntervalSeconds))
					.onChange((value: string) => {
						const parsed = Number.parseInt(value, 10);
						void this.plugin.setAutoRefreshIntervalSeconds(parsed)
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to update auto refresh interval', error);
							});
					});
			});
	}

	private renderNoteContentSection(container: HTMLElement): void {
		const resolved = this.plugin.resolveNoteContentLanguage();
		const section = this.createSection(
			container,
			ui('笔记内容', 'Note content'),
			ui(
				`控制 Tracekeeper 新生成笔记的标题和说明语言；当前生效：${resolved.language}。不会翻译用户或 Agent 提交的正文。`,
				`Controls headings and helper text in newly generated Tracekeeper notes; active: ${resolved.language}. User and agent-submitted content is not translated.`
			)
		);
		new Setting(section)
			.setName(ui('笔记内容语言', 'Note content language'))
			.setDesc(ui(
				'自动会优先跟随 Obsidian 语言，也可以固定为中文或英文。',
				'Auto follows Obsidian language first, or you can pin Chinese or English.'
			))
			.addDropdown((dropdown) => {
				for (const language of NOTE_CONTENT_LANGUAGES) {
					dropdown.addOption(language, noteContentLanguageLabel(language));
				}
				dropdown
					.setValue(this.plugin.settings.noteContentLanguage)
					.onChange((value: string) => {
						void this.plugin.setNoteContentLanguage(value)
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to update note content language', error);
							});
					});
			});
	}

	private renderMemoryRulesSection(container: HTMLElement): void {
		const section = this.createSection(
			container,
			ui('记忆规则', 'Memory rules'),
			ui('设置 Agent 提交记忆更新时的默认规则。', 'Set default rules for agent-submitted memory updates.')
		);
		new Setting(section)
			.setName(ui('全局记忆', 'Global memory'))
			.setDesc(ui(
				'通用偏好、长期决策等默认进入知识变更审核；也可以改为自动保存或不接收。',
				'General preferences and long-term decisions go to review by default; you can also auto-save or ignore them.'
			))
			.addDropdown((dropdown) => {
				for (const rule of MEMORY_PROPOSAL_RULES) {
					dropdown.addOption(rule, memoryProposalRuleLabel(rule));
				}
				dropdown
					.setValue(this.plugin.settings.globalMemoryRule)
					.onChange((value: string) => {
						void this.plugin.setGlobalMemoryRule(value)
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to update global memory rule', error);
							});
					});
			});
		new Setting(section)
			.setName(ui('项目记忆', 'Project memory'))
			.setDesc(ui(
				'项目、仓库或工作区相关记忆默认进入审核。仅当你明确选择自动时，才会在既有安全条件下追加保存。',
				'Project, repository, or workspace memory starts in review. It appends automatically under the existing safeguards only after you explicitly choose Auto.'
			))
			.addDropdown((dropdown) => {
				for (const rule of MEMORY_PROPOSAL_RULES) {
					dropdown.addOption(rule, memoryProposalRuleLabel(rule));
				}
				dropdown
					.setValue(this.plugin.settings.projectMemoryRule)
					.onChange((value: string) => {
						void this.plugin.setProjectMemoryRule(value)
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to update project memory rule', error);
							});
					});
			});
		new Setting(section)
			.setName(ui('任务结束记忆提案', 'Task closeout memory proposals'))
			.setDesc(ui(
				'自动会让项目记忆按规则保存、全局记忆进入知识变更审核；审核会统一进入知识变更审核；忽略不生成提案。',
				'Auto saves project memory by rule and sends global memory to Knowledge Change Review; Review sends all updates there; Ignore creates no proposals.'
			))
			.addDropdown((dropdown) => {
				for (const mode of TASK_MEMORY_PROPOSAL_MODES) {
					dropdown.addOption(mode, taskMemoryProposalModeLabel(mode));
				}
				dropdown
					.setValue(this.plugin.settings.taskMemoryProposalMode)
					.onChange((value: string) => {
						void this.plugin.setTaskMemoryProposalMode(value)
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to update task memory proposal mode', error);
							});
					});
			});
	}

	private renderAdvancedMaintenanceSection(container: HTMLElement): void {
		const section = this.createSection(
			container,
			ui('高级维护', 'Advanced maintenance'),
			ui('查看运行记录，清理日志，并调整图谱检查策略。', 'Review runtime records, clear logs, and adjust graph checks.')
		);
		new Setting(section)
			.setName(ui('运行日志', 'Runtime log'))
			.setDesc(ui('查看 Agent 连接、工具调用、配置写入和错误记录。', 'Review agent connections, tool calls, config writes, and errors.'))
			.addButton((button) =>
				button
					.setButtonText(ui('打开日志', 'Open log'))
					.onClick(() => {
						void this.plugin.openPluginView(TRACEKEEPER_RUNTIME_LOG_VIEW);
					})
			)
			.addButton((button) =>
				button
					.setButtonText(ui('清理日志', 'Clear logs'))
					.onClick(() => {
						new RuntimeLogCleanupModal(this.app, this.plugin, async () => undefined).open();
					})
			);
		new Setting(section)
			.setName(ui('召回预览', 'Recall preview'))
			.setDesc(ui('输入关键词，查看 Agent 可能读取到的记忆。', 'Enter keywords to see which memories an agent may read.'))
			.addButton((button) =>
				button
					.setButtonText(ui('测试召回', 'Test recall'))
					.onClick(() => {
						new MemoryRecallPreviewModal(this.app, this.plugin).open();
					})
			);
		new Setting(section)
			.setName(ui('知识图谱检查', 'Graph health profile'))
			.setDesc(ui(
				'关闭：仅保留手动查看；建议：只给出优化建议；严格：会把入口、中心节点、孤立节点和未解析链接标为阻塞问题。',
				'Off: manual inspection only; Advisory: reports suggestions; Strict: marks missing entries, hubs, isolated nodes, and unresolved links as blocking issues.'
			))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('off', ui('关闭', 'Off'))
					.addOption('advisory', ui('建议', 'Advisory'))
					.addOption('strict', ui('严格', 'Strict'))
					.setValue(this.plugin.settings.graphProfile)
					.onChange((value: string) => {
						this.plugin.settings.graphProfile = normalizeGraphProfileValue(value);
						void this.plugin.saveSettings()
							.then(() => this.plugin.restartMcpRuntime())
							.catch((error) => {
								console.error('tracekeeper failed to update graph profile', error);
							});
					})
			);
	}

	private renderPortSetting(container: HTMLElement, connectionUrl: string): void {
		let draftPort = String(this.plugin.settings.mcpPort);
		let applyButton: HTMLButtonElement | null = null;
		const setting = new Setting(container)
			.setName(ui('MCP 端点', 'MCP endpoint'))
			.setDesc(ui(
				`端点：${connectionUrl}。修改端口后需要点击“应用并重启”。`,
				`Endpoint: ${connectionUrl}. Select “Apply and restart” after changing the port.`
			))
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_MCP_PORT))
					.setValue(String(this.plugin.settings.mcpPort))
					.onChange((value: string) => {
						draftPort = value.trim();
						const parsed = /^\d+$/.test(draftPort) ? Number.parseInt(draftPort, 10) : Number.NaN;
						if (applyButton) {
							applyButton.disabled = !Number.isSafeInteger(parsed)
								|| parsed < 1
								|| parsed > 65535
								|| parsed === this.plugin.settings.mcpPort;
						}
					})
			)
			.addButton((button) => {
				applyButton = button.buttonEl;
				applyButton.disabled = true;
				button
					.setButtonText(ui('应用并重启', 'Apply and restart'))
					.onClick(() => {
						const parsed = /^\d+$/.test(draftPort) ? Number.parseInt(draftPort, 10) : Number.NaN;
						if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) {
							new Notice(ui('请输入 1 到 65535 之间的端口。', 'Enter a port between 1 and 65535.'));
							return;
						}
						applyButton!.disabled = true;
						this.plugin.settings.mcpPort = parsed;
						void this.plugin.saveSettings()
							.then(() => this.plugin.restartMcpRuntime())
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to update MCP port', error);
								applyButton!.disabled = false;
								new Notice(error instanceof Error ? error.message : ui('应用端口失败。', 'Failed to apply port.'));
							});
					});
			})
			.addExtraButton((button) =>
				button
					.setIcon('rotate-ccw')
					.setTooltip(ui('恢复默认', 'Restore default'))
					.onClick(() => {
						draftPort = String(DEFAULT_MCP_PORT);
						const input = setting.controlEl.querySelector('input');
						if (input) {
							input.value = draftPort;
						}
						if (applyButton) {
							applyButton.disabled = this.plugin.settings.mcpPort === DEFAULT_MCP_PORT;
						}
					})
			)
			.addExtraButton((button) =>
				button
					.setIcon('copy')
					.setTooltip(ui('复制连接地址', 'Copy connection URL'))
					.onClick(() => {
						void this.plugin.copyToClipboard(
							connectionUrl,
							ui('已复制连接地址。', 'Connection URL copied.')
						);
					})
			);
	}

	private renderClientConfigRow(container: HTMLElement, config: GeneratedClientConfig): void {
		const row = container.createDiv({ cls: 'tracekeeper-settings-client-row' });
		const runtimeProfile = config.runtimeCapabilityProfile ?? 'custom';
		const runtimeTools = config.runtimePublicTools ?? [];
		const info = row.createDiv({ cls: 'tracekeeper-settings-client-row__info' });
		const title = info.createDiv({ cls: 'tracekeeper-config-row__title' });
		title.createEl('strong', { text: config.displayName });
		title.createEl('span', {
			text: config.configStatusLabel,
			cls: `tracekeeper-badge ${clientConfigStatusClass(config.configState)}`,
		});
		info.createEl('small', { text: config.configStatusDetail || config.description });
		info.createEl('small', {
			text: `${ui('能力预设', 'Capability profile')}: ${this.runtimeProfileLabel(runtimeProfile)}`,
		});
		info.createEl('small', {
			text: `${ui('可调用公开工具', 'Public tools')}: ${runtimeTools.length > 0 ? runtimeTools.join(', ') : ui('未配置', 'Not configured')}`,
		});
		const actions = row.createDiv({ cls: 'tracekeeper-settings-client-row__actions tracekeeper-action-row' });

		if (config.configState !== 'configured') {
			const copy = actions.createEl('button', { text: ui('复制配置', 'Copy config') });
			copy.addEventListener('click', () => {
				void this.plugin.copyToClipboard(config.configText, ui('已复制连接配置。', 'Connection config copied.'));
			});
		}

		if (config.supportsAutoConfigure && config.targetPath && config.configState !== 'configured') {
			const autoConfigure = actions.createEl('button', {
				text: config.configState === 'needs_update' ? ui('更新配置', 'Update config') : ui('自动配置', 'Auto setup'),
				cls: 'mod-cta',
			});
			autoConfigure.addEventListener('click', () => {
				new ClientConfigPreviewModal(this.app, this.plugin, config, 'apply', () => this.display()).open();
			});
		}

		if (
			config.supportsAutoConfigure
			&& config.targetPath
			&& (config.configState === 'configured' || config.configState === 'needs_update')
		) {
			const openFile = actions.createEl('button', { text: ui('打开配置文件', 'Open config file') });
			openFile.addEventListener('click', () => {
				void this.plugin.openClientConfigFile(config);
			});
		}

		const rotate = actions.createEl('button', { text: ui('轮换凭据', 'Rotate credential') });
		rotate.addEventListener('click', () => {
			new ClientCredentialRotateConfirmModal(
				this.app,
				this.plugin,
				config,
				() => this.display()
			).open();
		});

		if (
			config.supportsAutoConfigure
			&& config.targetPath
			&& (config.configState === 'configured' || config.configState === 'needs_update')
		) {
			const remove = actions.createEl('button', { text: ui('移除配置', 'Remove config') });
			remove.addEventListener('click', () => {
				new ClientConfigPreviewModal(this.app, this.plugin, config, 'remove', () => this.display()).open();
			});
		}
		const profileControlWrap = row.createDiv({ cls: 'tracekeeper-action-row' });
		profileControlWrap.createEl('span', { text: ui('预设', 'Preset') });
		const profileSelect = profileControlWrap.createEl('select', { cls: 'tracekeeper-capability-preset' });
		for (const preset of RUNTIME_CREDENTIAL_PRESET_DEFINITIONS) {
			profileSelect.createEl('option', {
				value: preset.id,
				text: this.runtimeProfileLabel(preset.id),
			});
		}
		const customOption = profileSelect.createEl('option', {
			value: 'custom',
			text: ui('自定义（保留现有能力，仅展示）', 'Custom (preserved, display only)'),
		});
		customOption.disabled = true;
		profileSelect.value = runtimeProfile;
		profileSelect.addEventListener('change', () => {
			const nextProfile = profileSelect.value as RuntimeCredentialCapabilityProfile;
			if (nextProfile !== runtimeProfile) {
				void this.plugin.setRuntimeCredentialProfile(config.clientId, nextProfile)
					.then(() => this.renderSettings())
					.catch((error) => {
						console.error('tracekeeper failed to update runtime capability profile', error);
						new Notice(ui('更新能力预设失败。', 'Failed to update capability profile.'));
					});
			}
		});
	}

	private runtimeProfileLabel(profile: RuntimeCredentialCapabilityProfile): string {
		switch (profile) {
			case 'knowledge_assistant':
				return ui('知识助手', 'Knowledge assistant');
			case 'research_agent':
				return ui('研究代理', 'Research agent');
			case 'review_agent':
				return ui('审查代理', 'Review agent');
			case 'maintenance_agent':
				return ui('维护代理', 'Maintenance agent');
			case 'custom':
				return ui('自定义', 'Custom');
			default:
				return profile;
		}
	}

	private createSection(container: HTMLElement, title: string, description: string): HTMLElement {
		const section = container.createDiv({ cls: 'tracekeeper-settings-section' });
		const header = section.createDiv({ cls: 'tracekeeper-settings-section__header' });
		header.createEl('h3', { text: title, cls: 'tracekeeper-settings-section__title' });
		header.createEl('p', { text: description, cls: 'tracekeeper-settings-section__description' });
		return section;
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createEl('span', { text: label });
		item.createEl('strong', { text: value || ui('未知', 'Unknown') });
	}

}
