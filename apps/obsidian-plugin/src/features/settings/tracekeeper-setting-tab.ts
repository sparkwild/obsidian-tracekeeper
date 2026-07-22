import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { AgentConnectionsSnapshot } from '../activity/activity-model';
import type { GeneratedClientConfig } from '../client-config/client-config';
import { clientConfigStatusClass } from '../client-config/client-config';
import {
	ONBOARDING_STEP_SEQUENCE,
	getNextOnboardingStep,
	isOnboardingStepCompleted,
	type OnboardingProgressContext,
	type OnboardingStep,
} from '../onboarding/onboarding-state';
import { onboardingContextDescription, onboardingStepLabel } from '../onboarding/onboarding-view-model';
import { MemoryRecallPreviewModal } from '../recall/memory-recall-preview-modal';
import { ClientConfigPreviewModal, ClientCredentialRotateConfirmModal } from '../client-config/client-config-modals';
import { McpCapabilitiesModal } from '../runtime/mcp-capabilities-modal';
import { RuntimeTokenRegenerateConfirmModal } from '../runtime/runtime-confirmation-modals';
import { RuntimeLogCleanupModal } from '../runtime/runtime-log-view';
import { DEFAULT_MCP_HOST, DEFAULT_MCP_PORT } from '../runtime/runtime-defaults';
import {
	AUTO_REFRESH_INTERVAL_OPTIONS,
	MEMORY_PROPOSAL_RULES,
	NOTE_CONTENT_LANGUAGES,
	TASK_MEMORY_PROPOSAL_MODES,
	memoryProposalRuleLabel,
	normalizeGraphProfileValue,
	normalizeMemoryProposalRule,
	normalizeTaskMemoryProposalMode,
	noteContentLanguageLabel,
	taskMemoryProposalModeLabel,
} from './settings-model';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_RUNTIME_LOG_VIEW } from '../../ui/view-types';
import type { SkillInstallState } from '../../adapters/client-skill-adapter';
import { SkillInstallPreviewModal } from '../skill-installation/skill-install-modals';
import {
	type RuntimeCredentialCapabilityProfile,
	RUNTIME_CREDENTIAL_PRESET_DEFINITIONS,
} from '../settings/runtime-credentials';

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
		this.renderTokenSection(containerEl);
		this.renderAgentClientConfigSection(containerEl, snapshot);
		this.renderViewRefreshSection(containerEl);
		this.renderNoteContentSection(containerEl);
		this.renderMemoryRulesSection(containerEl);
		this.renderAdvancedMaintenanceSection(containerEl);
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
		const actions = section.createDiv({ cls: 'tracekeeper-settings-grid' });
		for (const [index, stepId] of ONBOARDING_STEP_SEQUENCE.entries()) {
			const done = isOnboardingStepCompleted(stepId, this.plugin.settings.onboarding, context);
			const active = nextStep === stepId;
			const row = actions.createDiv({ cls: 'tracekeeper-action-row' });
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
		const evidence = section.createDiv({ cls: 'tracekeeper-settings-grid' });
		const profileLabel = this.plugin.settings.onboarding.selectedClientId === 'codex'
			? ui('本地单用户默认 Profile（不是团队 RBAC）', 'Local single-user default profile (not team RBAC)')
			: ui('本地单用户复制 Profile（不是团队 RBAC）', 'Local single-user copy-only profile (not team RBAC)');
		this.renderSkillEvidence(evidence, ui('Profile', 'Profile'), profileLabel, true);
		this.renderSkillEvidence(evidence, ui('Bundle 可用', 'Bundle available'), `v${skillInstallState.expectedVersion}`, context.skillAvailable);
		this.renderSkillEvidence(evidence, ui('已复制', 'Copied'), ui('人工复制事件', 'Manual copy event'), context.skillCopied);
		this.renderSkillEvidence(evidence, ui('用户确认', 'User confirmed'), ui('人工自证，不等于文件验证', 'Self-attested, not file verification'), context.skillUserConfirmed);
		this.renderSkillEvidence(evidence, ui('文件验证', 'File verified'), skillInstallState.detail, context.skillFileVerified);
		this.renderSkillEvidence(evidence, ui('客户端已重载', 'Client reloaded'), ui('人工确认或客户端证据', 'User confirmation or client evidence'), context.clientReloaded);
		this.renderSkillEvidence(evidence, ui('连接验证', 'Connection verified'), ui('Principal MCP 审计证据', 'Principal MCP audit evidence'), context.connectionVerified);
		this.renderSkillEvidence(evidence, ui('Recall 已观察', 'Recall observed'), ui('不证明 Skill 自动触发', 'Does not prove automatic Skill triggering'), context.recallObserved);
		this.renderSkillEvidence(evidence, ui('完整工作流已观察', 'Tracked workflow observed'), ui('同 Principal 的 start → recall → finish', 'Same-principal start → recall → finish'), context.trackedWorkflowObserved);
		this.renderSkillEvidence(evidence, ui('存在更新', 'Update available'), skillInstallState.detail, context.skillUpdateAvailable, true);

		const actionWrap = section.createDiv({ cls: 'tracekeeper-action-row' });
		if (nextStep === 'vault_check') {
			const repair = actionWrap.createEl('button', { text: ui('补齐结构', 'Repair structure') });
			repair.addEventListener('click', () => {
				void this.plugin.openInitializeMemoryStructureModal();
			});
		}
		if (nextStep === 'runtime') {
			const openService = actionWrap.createEl('button', { text: ui('开启 MCP 服务', 'Enable MCP service') });
			openService.addEventListener('click', () => {
				void this.plugin.setMcpRuntimeEnabled(true)
					.then(() => this.renderSettings())
					.catch((error) => {
						console.error('tracekeeper failed to enable MCP service from onboarding', error);
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
				if (clientId === 'codex' && (skillInstallState.state === 'not_installed' || skillInstallState.state === 'update_available')) {
					const mode = skillInstallState.state === 'update_available' ? 'update' : 'install';
					new Setting(section)
						.setName(mode === 'install' ? ui('安装完整 Skill bundle', 'Install complete Skill bundle') : ui('更新完整 Skill bundle', 'Update complete Skill bundle'))
						.setDesc(ui(
							`先预览目标目录和文件清单；只有再次确认后才写入。目标：${skillInstallState.targetDirectory || ''}`,
							`Preview the target directory and files first. Nothing is written until confirmation. Target: ${skillInstallState.targetDirectory || ''}`
						))
						.addButton((button) => button
							.setButtonText(mode === 'install' ? ui('预览安装', 'Preview install') : ui('预览更新', 'Preview update'))
							.onClick(() => new SkillInstallPreviewModal(this.app, this.plugin, clientId, mode, () => {
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
		if (context.recallObserved && !context.trackedWorkflowObserved) {
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
		const row = container.createDiv({ cls: 'tracekeeper-action-row' });
		const description = row.createDiv();
		description.createEl('strong', { text: label });
		description.createEl('div', { text: detail, cls: 'tracekeeper-view__description' });
		row.createEl('span', {
			text: verified ? ui('是', 'Yes') : ui('否', 'No'),
			cls: `tracekeeper-badge ${verified
				? warningWhenTrue ? 'tracekeeper-badge--warning' : 'tracekeeper-badge--success'
				: 'tracekeeper-badge--muted'}`,
		});
	}

	private renderConnectionInfoSection(container: HTMLElement, snapshot: AgentConnectionsSnapshot): void {
		const section = this.createSection(
			container,
			ui('MCP 服务', 'MCP service'),
			ui('控制本机服务开关、设置端口，并复制 Agent 连接地址。', 'Control the local service, set the port, and copy the agent connection URL.')
		);
		this.renderRuntimeEnabledSetting(section);
		this.renderCapabilitiesSetting(section);
		this.renderPortSetting(section, snapshot.connectionUrl);
	}

	private renderRuntimeEnabledSetting(container: HTMLElement): void {
		const enabled = this.plugin.settings.mcpRuntimeEnabled;
		new Setting(container)
			.setName(ui('服务开关', 'Service'))
			.setDesc(enabled
				? ui('已开启，AI 工具可以通过本机地址连接。', 'On. AI tools can connect through the local address.')
				: ui('已关闭，AI 工具暂时无法连接。', 'Off. AI tools cannot connect right now.'))
			.addToggle((toggle) =>
				toggle
					.setValue(enabled)
					.onChange((value: boolean) => {
						void this.plugin.setMcpRuntimeEnabled(value)
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to toggle MCP service', error);
							});
					})
			);
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
		const section = this.createSection(
			container,
			ui('令牌管理', 'Token management'),
			ui('此处显示旧版共享令牌；每个 Agent 的独立凭据在对应配置行中轮换。', 'This is the legacy shared token. Rotate an independent Agent credential from its configuration row.')
		);
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
				'活动页和审核队列打开时会自动同步最新任务、记忆和审核状态。',
				'When activity or review queue views are open, Tracekeeper keeps task, memory, and review status in sync.'
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
				'通用偏好、长期决策等默认进入审核队列；也可以改为自动保存或不接收。',
				'General preferences and long-term decisions go to review by default; you can also auto-save or ignore them.'
			))
			.addDropdown((dropdown) => {
				for (const rule of MEMORY_PROPOSAL_RULES) {
					dropdown.addOption(rule, memoryProposalRuleLabel(rule));
				}
				dropdown
					.setValue(this.plugin.settings.globalMemoryRule)
					.onChange((value: string) => {
						this.plugin.settings.globalMemoryRule = normalizeMemoryProposalRule(value);
						void this.plugin.saveSettings()
							.then(() => this.plugin.restartMcpRuntime())
							.catch((error) => {
								console.error('tracekeeper failed to update global memory rule', error);
							});
					});
			});
		new Setting(section)
			.setName(ui('项目记忆', 'Project memory'))
			.setDesc(ui(
				'项目、仓库或工作区相关记忆默认自动保存，减少重复审核。',
				'Project, repository, or workspace memory auto-saves by default to reduce repeated review.'
			))
			.addDropdown((dropdown) => {
				for (const rule of MEMORY_PROPOSAL_RULES) {
					dropdown.addOption(rule, memoryProposalRuleLabel(rule));
				}
				dropdown
					.setValue(this.plugin.settings.projectMemoryRule)
					.onChange((value: string) => {
						this.plugin.settings.projectMemoryRule = normalizeMemoryProposalRule(value);
						void this.plugin.saveSettings()
							.then(() => this.plugin.restartMcpRuntime())
							.catch((error) => {
								console.error('tracekeeper failed to update project memory rule', error);
							});
					});
			});
		new Setting(section)
			.setName(ui('任务结束记忆提案', 'Task closeout memory proposals'))
			.setDesc(ui(
				'自动会让项目记忆按规则保存、全局记忆进入审核队列；审核会统一进入审核队列；忽略不生成提案。',
				'Auto saves project memory by rule and sends global memory to the review queue; Review sends all updates to the review queue; Ignore creates no proposals.'
			))
			.addDropdown((dropdown) => {
				for (const mode of TASK_MEMORY_PROPOSAL_MODES) {
					dropdown.addOption(mode, taskMemoryProposalModeLabel(mode));
				}
				dropdown
					.setValue(this.plugin.settings.taskMemoryProposalMode)
					.onChange((value: string) => {
						this.plugin.settings.taskMemoryProposalMode = normalizeTaskMemoryProposalMode(value);
						void this.plugin.saveSettings()
							.then(() => this.plugin.restartMcpRuntime())
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
		new Setting(container)
			.setName(ui('连接地址', 'Connection URL'))
			.setDesc(ui(
				`http://${DEFAULT_MCP_HOST}:${this.plugin.settings.mcpPort || DEFAULT_MCP_PORT}`,
				`http://${DEFAULT_MCP_HOST}:${this.plugin.settings.mcpPort || DEFAULT_MCP_PORT}`
			))
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_MCP_PORT))
					.setValue(String(this.plugin.settings.mcpPort))
					.onChange((value: string) => {
						const parsed = Number.parseInt(value.trim(), 10);
						if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
							return;
						}
						this.plugin.settings.mcpPort = parsed;
						void this.plugin.saveSettings()
							.then(() => this.plugin.restartMcpRuntime())
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to update MCP port', error);
							});
					})
			)
			.addExtraButton((button) =>
				button
					.setIcon('rotate-ccw')
					.setTooltip(ui('恢复默认', 'Restore default'))
					.onClick(() => {
						this.plugin.settings.mcpPort = DEFAULT_MCP_PORT;
						void this.plugin.saveSettings()
							.then(() => this.plugin.restartMcpRuntime())
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to restore default MCP port', error);
							});
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
