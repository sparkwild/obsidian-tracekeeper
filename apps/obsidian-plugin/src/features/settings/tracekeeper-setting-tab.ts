import { App, Menu, Notice, PluginSettingTab, Setting } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { AgentConnectionsSnapshot } from '../activity/activity-model';
import type { GeneratedClientConfig } from '../client-config/client-config';
import type { AgentIntegrationSnapshot } from './agent-integrations';
import { ConnectAiToolModal } from '../client-config/client-config-modals';
import { MemoryRecallPreviewModal } from '../recall/memory-recall-preview-modal';
import { McpCapabilitiesModal } from '../runtime/mcp-capabilities-modal';
import { RuntimeAccessResetModal } from '../runtime/runtime-access-reset-modal';
import { RuntimeLogCleanupModal } from '../runtime/runtime-log-view';
import { DEFAULT_MCP_HOST, DEFAULT_MCP_PORT } from '../runtime/runtime-defaults';
import { runtimeToneBadgeClass, runtimeViewModel } from '../runtime/runtime-view-model';
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
import { renderClientSkillPrompt } from '../skill-installation/client-skill-prompt';
import { buildAgentConfigurationViewModel } from './agent-configuration-view-model';

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
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('tracekeeper-settings-root');
		this.renderConnectionInfoSection(containerEl, snapshot);
		this.renderAgentClientConfigSection(containerEl, snapshot);
		this.renderViewRefreshSection(containerEl);
		this.renderNoteContentSection(containerEl);
		this.renderMemoryRulesSection(containerEl);
		this.renderAdvancedMaintenanceSection(containerEl, snapshot);
	}

	private renderAgentClientConfigSection(container: HTMLElement, snapshot: AgentConnectionsSnapshot): void {
		const { visibleAgents, candidateConfigs } = buildAgentConfigurationViewModel(
			snapshot.clientConfigs,
			snapshot.recentAgents,
			snapshot.integrations,
			snapshot.pendingOAuthRequests
		);
		const skillOnlyConfigs = candidateConfigs.filter((config) => {
			const state = this.plugin.getSkillInstallState(config.clientId).state;
			return state !== 'unavailable' && state !== 'not_installed';
		});
		const section = this.createSection(
			container,
			ui('Agent 配置', 'Agent configuration'),
			ui(
			'持久 Agent 卡片独立展示 MCP 配置、授权、连接、使用和 Skill 状态。',
			'Persistent Agent cards show MCP setup, authorization, connection, usage, and Skill state independently.'
			)
		);
		const sectionActions = section.createDiv({
			cls: 'tracekeeper-settings-agent-actions',
		});
		const addAgent = sectionActions.createEl('button', {
			text: ui('添加 Agent ▾', 'Add Agent ▾'),
			cls: 'mod-cta tracekeeper-settings-add-agent',
			attr: {
				'aria-label': ui('添加 Agent', 'Add Agent'),
				'aria-haspopup': 'menu',
				'aria-expanded': 'false',
			},
		});
		addAgent.disabled = candidateConfigs.length === 0;
		addAgent.addEventListener('click', () => {
			const menu = new Menu().setNoIcon();
			for (const config of candidateConfigs) {
				menu.addItem((item) => {
					item
						.setTitle(config.displayName)
						.onClick(() => {
							new ConnectAiToolModal(
								this.app,
								this.plugin,
								config,
								'add',
								() => this.display()
							).open();
						});
				});
			}
			const rect = addAgent.getBoundingClientRect();
			addAgent.setAttribute('aria-expanded', 'true');
			menu.onHide(() => addAgent.setAttribute('aria-expanded', 'false'));
			menu.showAtPosition({
				x: rect.left,
				y: rect.bottom,
				width: rect.width,
				overlap: false,
			}, addAgent.ownerDocument);
		});
		const grid = section.createDiv({ cls: 'tracekeeper-settings-grid' });
		if (visibleAgents.length === 0 && skillOnlyConfigs.length === 0) {
			const empty = grid.createDiv({ cls: 'tracekeeper-empty-state' });
			empty.createEl('strong', {
				text: ui('尚无 Agent 卡片', 'No Agent cards yet'),
			});
			empty.createEl('p', {
				text: ui(
					'点击“添加 Agent”即可立即创建卡片；复制、授权和使用状态随后分别更新。',
					'Click “Add Agent” to create a card immediately; setup, authorization, and usage update independently.'
				),
			});
			return;
		}
		for (const { agent, config, integration, presentation } of visibleAgents) {
			this.renderClientConfigRow(grid, config, agent, integration, presentation);
		}
		for (const config of skillOnlyConfigs) {
			this.renderSkillOnlyRow(grid, config);
		}
	}

	private renderConnectionInfoSection(container: HTMLElement, snapshot: AgentConnectionsSnapshot): void {
		const section = this.createSection(
			container,
			ui('MCP 服务', 'MCP service'),
			ui('查看 Obsidian 托管的本机服务状态，并在需要时恢复连接。', 'Review the local service hosted by Obsidian and recover it when needed.')
		);
		this.renderRuntimeEnabledSetting(section, snapshot);
		this.renderEndpointSetting(section, snapshot.runtimeStatus.endpoint);
		this.renderAccessProtectionSetting(section, snapshot);
		this.renderCapabilitiesSetting(section);
	}

	private renderRuntimeEnabledSetting(container: HTMLElement, snapshot: AgentConnectionsSnapshot): void {
		const enabled = this.plugin.settings.mcpRuntimeEnabled;
		const runtime = runtimeViewModel(snapshot.runtimeStatus, ui);
		const setting = new Setting(container)
			.setName(ui('服务状态', 'Service status'))
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
		setting.nameEl.addClass('tracekeeper-settings-runtime-name');
		setting.nameEl.createEl('span', {
			text: runtime.label,
			cls: `tracekeeper-badge ${runtimeToneBadgeClass(runtime.tone)}`,
		});
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

	private renderEndpointSetting(container: HTMLElement, endpoint: string): void {
		const setting = new Setting(container)
			.setName(ui('MCP 端点', 'MCP endpoint'));
		setting.descEl.createEl('code', {
			text: endpoint,
			attr: {
				'aria-label': ui('本机 MCP 端点', 'Local MCP endpoint'),
			},
		});
	}

	private renderAccessProtectionSetting(
		container: HTMLElement,
		snapshot: AgentConnectionsSnapshot
	): void {
		const protectedAccess = snapshot.runtimeStatus.accessProtected;
		const setting = new Setting(container)
			.setName(ui('全部 Agent 访问', 'All Agent access'))
			.setDesc(ui(
				'每个 Agent 使用独立 OAuth 或 Bearer 凭据；状态和撤销按卡片管理。',
				'Each Agent uses an independent OAuth or Bearer credential; status and revocation are managed per card.'
			));
		setting.nameEl.addClass('tracekeeper-settings-runtime-name');
		setting.nameEl.createEl('span', {
			text: protectedAccess
				? ui('本机访问已保护', 'Local access protected')
				: ui('保护不可用', 'Protection unavailable'),
			cls: `tracekeeper-badge ${
				protectedAccess
					? 'tracekeeper-badge--success'
					: 'tracekeeper-badge--error'
			}`,
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
				'项目、仓库或工作区相关记忆默认进入审核。仅当你明确选择自动时，才会在稳定项目 Hub 下为每次操作创建独立条目；旧版共享记忆笔记不会被改写。',
				'Project, repository, or workspace memory starts in review. Only after you explicitly choose Auto does each operation create its own entry under a stable project hub; legacy shared memory notes are not rewritten.'
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
				'自动会按规则创建一次不可变项目记忆条目，并让全局记忆进入知识变更审核；审核会统一进入知识变更审核；忽略不生成提案。',
				'Auto creates one immutable project-memory entry by rule and sends global memory to Knowledge Change Review; Review sends all updates there; Ignore creates no proposals.'
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

	private renderAdvancedMaintenanceSection(
		container: HTMLElement,
		snapshot: AgentConnectionsSnapshot
	): void {
		const details = container.createEl('details', {
			cls: 'tracekeeper-settings-section tracekeeper-settings-advanced',
		});
		details.createEl('summary', {
			text: ui('高级维护', 'Advanced maintenance'),
			cls: 'tracekeeper-settings-advanced__summary',
		});
		const section = details.createDiv({ cls: 'tracekeeper-settings-advanced__body' });
		section.createEl('p', {
			text: ui(
				'调整端口、重启诊断、运行记录和全局访问保护。',
				'Manage the port, restart diagnostics, runtime records, and global access protection.'
			),
			cls: 'tracekeeper-settings-section__description',
		});
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
		const runtime = runtimeViewModel(snapshot.runtimeStatus, ui);
		new Setting(section)
			.setName(ui('服务诊断', 'Service diagnostics'))
			.setDesc(ui(
				'重启会结束现有 MCP Session；AI 工具需要重新连接。',
				'Restarting ends existing MCP sessions. AI tools must reconnect.'
			))
			.addButton((button) =>
				button
					.setButtonText(ui('重启服务', 'Restart service'))
					.setDisabled(!snapshot.runtimeStatus.enabled || runtime.busy)
					.onClick(() => {
						button.setDisabled(true);
						void this.plugin.restartMcpRuntime()
							.then(() => this.renderSettings())
							.catch((error) => {
								console.error('tracekeeper failed to restart MCP service', error);
								button.setDisabled(false);
								new Notice(ui('MCP 服务重启失败。', 'Failed to restart MCP service.'));
							});
					})
			);
		this.renderPortSetting(section, snapshot.runtimeStatus.endpoint);
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
			.setName(ui('全部 Agent 访问', 'All Agent access'))
			.setDesc(ui(
				'撤销会清空全部活动凭据并终止 Session，但保留 Agent 卡片和 Skill。',
				'Revocation clears all active credentials and ends Sessions while retaining Agent cards and Skills.'
			))
			.addButton((button) => {
				button
					.setButtonText(ui('撤销全部 Agent 访问', 'Revoke all Agent access'))
					.onClick(() => {
						new RuntimeAccessResetModal(this.app, this.plugin, () => {
							void this.renderSettings();
						}).open();
					});
				button.buttonEl.addClass('mod-warning');
			});
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
			);
	}

	private renderClientConfigRow(
		container: HTMLElement,
		config: GeneratedClientConfig,
		agent: import('../activity/activity-model').AgentConnectionRecord | null,
		integration: AgentIntegrationSnapshot,
	presentation: import('../client-config/agent-connection-view-model').ConnectionPresentation
	): void {
		const row = container.createDiv({ cls: 'tracekeeper-settings-client-row' });
		const info = row.createDiv({ cls: 'tracekeeper-settings-client-row__info' });
		const title = info.createDiv({ cls: 'tracekeeper-config-row__title' });
		title.createEl('strong', { text: config.displayName });
		title.createEl('span', {
			text: this.connectionStateLabel(presentation.state),
			cls: `tracekeeper-badge ${presentation.state === 'connected' || presentation.state === 'used' || presentation.state === 'authorized' ? 'tracekeeper-badge--success' : presentation.state === 'revoked' || presentation.state === 'needs_update' ? 'tracekeeper-badge--warning' : 'tracekeeper-badge--muted'}`,
		});
		const meta = info.createDiv({ cls: 'tracekeeper-settings-client-row__meta' });
		meta.createEl('span', { text: `${ui('授权方式', 'Auth mode')}: ${integration.authMode === 'oauth' ? 'OAuth' : 'Bearer'}` });
		meta.createEl('span', { text: `${ui('MCP', 'MCP')}: ${this.mcpStateLabel(presentation.mcpState)}` });
		meta.createEl('span', { text: `${ui('授权', 'Authorization')}: ${this.authorizationStateLabel(presentation.authorizationState)}` });
		meta.createEl('span', { text: `${ui('使用', 'Usage')}: ${this.usageStateLabel(presentation.usageState)}` });
		meta.createEl('span', { text: agent ? `${ui('最近连接', 'Last connected')} ${agent.connectedAt}` : ui('尚未连接', 'Not connected') });
		meta.createEl('span', { text: agent?.lastUsedAt ? `${ui('最近使用', 'Last used')} ${agent.lastUsedAt}` : ui('尚未使用', 'Never used') });
		const actions = row.createDiv({ cls: 'tracekeeper-settings-client-row__actions' });
		const manage = actions.createEl('button', {
			text: ui('管理 Agent', 'Manage Agent'),
			attr: {
				'aria-label': ui(`管理 ${config.displayName}`, `Manage ${config.displayName}`),
			},
		});
		manage.addEventListener('click', () => {
			new ConnectAiToolModal(
				this.app,
				this.plugin,
				config,
				'manage',
				() => this.display()
			).open();
		});
		renderClientSkillPrompt({
			app: this.app,
			plugin: this.plugin,
			container: row,
			config,
			onChanged: () => {
				void this.renderSettings();
			},
		});
	}

	private renderSkillOnlyRow(container: HTMLElement, config: GeneratedClientConfig): void {
		const row = container.createDiv({ cls: 'tracekeeper-settings-client-row' });
		const info = row.createDiv({ cls: 'tracekeeper-settings-client-row__info' });
		const title = info.createDiv({ cls: 'tracekeeper-config-row__title' });
		title.createEl('strong', { text: config.displayName });
		title.createEl('span', { text: ui('仅 Skill', 'Skill only'), cls: 'tracekeeper-badge tracekeeper-badge--muted' });
		info.createEl('p', { text: ui('已检测到 Skill，但尚无 MCP 集成卡片。', 'A Skill was detected, but no MCP integration card exists yet.'), cls: 'tracekeeper-view__description' });
		const actions = row.createDiv({ cls: 'tracekeeper-settings-client-row__actions' });
		const configure = actions.createEl('button', { text: ui('配置 MCP', 'Configure MCP'), cls: 'mod-cta' });
		configure.addEventListener('click', () => new ConnectAiToolModal(this.app, this.plugin, config, 'add', () => this.display()).open());
		renderClientSkillPrompt({ app: this.app, plugin: this.plugin, container: row, config, onChanged: () => { void this.renderSettings(); } });
	}

	private connectionStateLabel(state: import('../client-config/agent-connection-view-model').ConnectionUiState): string {
		switch (state) {
			case 'copied_unverified': return ui('配置未验证', 'Setup unverified');
			case 'client_reached': return ui('客户端已触达', 'Client reached');
			case 'pending_approval': return ui('待审批', 'Approval pending');
			case 'authorized': return ui('已授权', 'Authorized');
			case 'connected': return ui('已连接', 'Connected');
			case 'used': return ui('已使用', 'Used');
			case 'revoked': return ui('已撤销', 'Revoked');
			case 'needs_update': return ui('需要更新配置', 'Setup update needed');
			case 'manual': return ui('手工授权', 'Manual authorization');
			default: return ui('未配置', 'Not configured');
		}
	}

	private mcpStateLabel(state: import('../client-config/agent-connection-view-model').McpConnectionState): string {
		switch (state) {
			case 'copied_unverified': return ui('配置未验证', 'Setup unverified');
			case 'client_reached': return ui('客户端已触达', 'Client reached');
			case 'connected': return ui('已连接', 'Connected');
			case 'needs_update': return ui('需要更新配置', 'Setup update needed');
			default: return ui('未开始', 'Not started');
		}
	}

	private authorizationStateLabel(state: import('../client-config/agent-connection-view-model').AuthorizationState): string {
		switch (state) {
			case 'pending_approval': return ui('待审批', 'Approval pending');
			case 'authorized': return ui('已授权', 'Authorized');
			case 'revoked': return ui('已撤销', 'Revoked');
			default: return ui('未授权', 'Not authorized');
		}
	}

	private usageStateLabel(state: import('../client-config/agent-connection-view-model').UsageState): string {
		return state === 'used' ? ui('已使用', 'Used') : ui('从未使用', 'Never used');
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
