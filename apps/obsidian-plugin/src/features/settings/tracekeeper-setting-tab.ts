import { App, Menu, Notice, PluginSettingTab, Setting, SettingGroup } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import type { AgentConnectionsSnapshot } from '../activity/activity-model';
import type { GeneratedClientConfig } from '../client-config/client-config';
import { ConnectAiToolModal } from '../client-config/client-config-modals';
import {
	commitOAuthDecisionWithBestEffortRefresh,
} from '../client-config/oauth-pending';
import { McpCapabilitiesModal } from '../runtime/mcp-capabilities-modal';
import { RuntimeAccessResetModal } from '../runtime/runtime-access-reset-modal';
import { DEFAULT_MCP_PORT } from '../runtime/runtime-defaults';
import { runtimeToneBadgeClass, runtimeViewModel } from '../runtime/runtime-view-model';
import {
	AUTO_REFRESH_INTERVAL_OPTIONS,
	MEMORY_PROPOSAL_RULES,
	NOTE_CONTENT_LANGUAGES,
	memoryProposalRuleLabel,
	normalizeGraphProfileValue,
	noteContentLanguageLabel,
} from './settings-model';
import { ui } from '../../ui/localization';
import { renderClientSkillPrompt } from '../skill-installation/client-skill-prompt';
import { buildAgentConfigurationViewModel } from './agent-configuration-view-model';
import {
	isSettingGroupHTMLElement,
	shouldReplaceAgentConfiguration,
} from './agent-configuration-refresh';

const AGENT_CONFIGURATION_FOCUS_SETTLE_DELAY_MS = 200;

interface SettingRenderDefinitionCompat {
	name: string;
	aliases: string[];
	render: (setting: Setting, group: SettingGroup) => void | (() => void);
}

interface DeclarativeSettingTabCompat {
	update?: () => void;
}

const SETTING_SEARCH_ALIASES = [
	'Tracekeeper',
	'MCP 服务',
	'MCP service',
	'服务状态',
	'Service status',
	'恢复服务',
	'Recover service',
	'服务功能',
	'Capabilities',
	'MCP 端点',
	'MCP endpoint',
	'端口号',
	'Port',
	'Agent 配置',
	'Agent configuration',
	'OAuth',
	'OAuth 客户端归属冲突',
	'OAuth client ownership conflict',
	'已阻止的 OAuth 请求',
	'Blocked OAuth request',
	'未绑定的 OAuth 请求',
	'Unbound OAuth request',
	'尚无 Agent 卡片',
	'No Agent cards yet',
	'视图刷新',
	'View refresh',
	'自动刷新',
	'Auto refresh',
	'刷新间隔',
	'Refresh interval',
	'笔记内容',
	'Note content',
	'笔记内容语言',
	'Note content language',
	'记忆规则',
	'Memory rules',
	'Wiki 变更',
	'Wiki changes',
	'全局记忆',
	'Global memory',
	'全局记忆 Hub 已阻断',
	'Global Memory Hub blocked',
	'项目记忆',
	'Project memory',
	'任务追踪',
	'Task tracking',
	'启用任务追踪',
	'Enable task tracking',
	'高级维护',
	'Advanced maintenance',
	'服务诊断',
	'Service diagnostics',
	'全部 Agent 访问',
	'All Agent access',
	'知识图谱检查',
	'Graph health profile',
];

export class TracekeeperSettingTab extends PluginSettingTab {
	private visible = false;
	private renderVersion = 0;
	private agentListHostEl: HTMLElement | null = null;
	private agentListFingerprint = '';
	private agentListRefreshPending = false;
	private agentListForceRefreshPending = false;
	private agentListRefreshPromise: Promise<void> | null = null;
	private agentConfigurationFocusPending = false;
	private agentConfigurationFocusFrame: number | null = null;
	private agentConfigurationFocusTimer: number | null = null;
	private settingsHostEl: HTMLElement | null = null;

	constructor(
		app: App,
		private plugin: TracekeeperPlugin
	) {
		super(app, plugin);
	}

	display(): void {
		this.mountSettings(this.containerEl);
	}

	getSettingDefinitions(): SettingRenderDefinitionCompat[] {
		return [{
			name: ui('Tracekeeper 设置', 'Tracekeeper settings'),
			aliases: [...SETTING_SEARCH_ALIASES],
			render: (setting) => {
				setting.settingEl.removeClass('setting-item');
				this.mountSettings(setting.settingEl);
				return () => {
					this.unmountSettings(setting.settingEl);
				};
			},
		}];
	}

	private mountSettings(containerEl: HTMLElement): void {
		this.visible = true;
		this.settingsHostEl = containerEl;
		containerEl.empty();
		containerEl.addClass('tracekeeper-settings-root');
		const loading = containerEl.createDiv({ cls: 'tracekeeper-view__description' });
		loading.setText(ui('正在读取连接配置...', 'Reading connection settings...'));
		void this.renderSettings();
	}

	hide(): void {
		this.unmountSettings(this.settingsHostEl);
		super.hide();
	}

	private unmountSettings(containerEl: HTMLElement | null): void {
		if (containerEl !== this.settingsHostEl) return;
		this.visible = false;
		this.renderVersion += 1;
		if (this.agentConfigurationFocusFrame !== null) {
			window.cancelAnimationFrame(this.agentConfigurationFocusFrame);
			this.agentConfigurationFocusFrame = null;
		}
		if (this.agentConfigurationFocusTimer !== null) {
			window.clearTimeout(this.agentConfigurationFocusTimer);
			this.agentConfigurationFocusTimer = null;
		}
		this.agentListHostEl = null;
		this.agentListFingerprint = '';
		this.agentListRefreshPending = false;
		this.agentListForceRefreshPending = false;
		this.agentConfigurationFocusPending = false;
		this.settingsHostEl = null;
	}

	isAgentListVisible(): boolean {
		return this.visible && Boolean(this.agentListHostEl?.isConnected);
	}

	focusAgentConfiguration(): void {
		this.agentConfigurationFocusPending = true;
		this.applyAgentConfigurationFocus();
	}

	async refreshAgentList(force = false): Promise<void> {
		if (!this.visible || !this.agentListHostEl?.isConnected) return;
		this.agentListRefreshPending = true;
		this.agentListForceRefreshPending ||= force;
		if (this.agentListRefreshPromise) return this.agentListRefreshPromise;
		const refreshPromise = this.drainAgentListRefreshes();
		this.agentListRefreshPromise = refreshPromise;
		try {
			await refreshPromise;
		} catch (error) {
			console.error('tracekeeper failed to refresh Agent settings list', error);
			throw error;
		} finally {
			if (this.agentListRefreshPromise === refreshPromise) {
				this.agentListRefreshPromise = null;
			}
			if (this.agentListRefreshPending && this.visible) {
				await this.refreshAgentList();
			}
		}
	}

	private async drainAgentListRefreshes(): Promise<void> {
		while (this.agentListRefreshPending) {
			this.agentListRefreshPending = false;
			const force = this.agentListForceRefreshPending;
			this.agentListForceRefreshPending = false;
			const host = this.agentListHostEl;
			if (!this.visible || !host?.isConnected) return;
			const snapshot = await this.plugin.loadAgentConnectionsSnapshot();
			if (!this.visible || host !== this.agentListHostEl || !host.isConnected) continue;
			const fingerprint = this.buildAgentListFingerprint(snapshot);
			if (!shouldReplaceAgentConfiguration(this.agentListFingerprint, fingerprint, force)) continue;
			const stagingEl = host.createDiv();
			stagingEl.detach();
			const replacement = this.renderAgentClientConfigSection(stagingEl, snapshot);
			host.replaceWith(replacement);
			this.agentListHostEl = replacement;
			this.agentListFingerprint = fingerprint;
		}
	}

	private async renderSettings(): Promise<void> {
		const containerEl = this.settingsHostEl;
		if (!containerEl) return;
		const renderVersion = ++this.renderVersion;
		const snapshot = await this.plugin.loadAgentConnectionsSnapshot();
		if (
			!this.visible
			|| renderVersion !== this.renderVersion
			|| containerEl !== this.settingsHostEl
		) return;
		const previousScrollTop = containerEl.scrollTop;
		containerEl.empty();
		containerEl.addClass('tracekeeper-settings-root');
		this.renderConnectionInfoSection(containerEl, snapshot);
		this.agentListHostEl = this.renderAgentClientConfigSection(containerEl, snapshot);
		this.agentListFingerprint = this.buildAgentListFingerprint(snapshot);
		this.renderViewRefreshSection(containerEl);
		this.renderNoteContentSection(containerEl);
		this.renderMemoryRulesSection(containerEl);
		this.renderAdvancedMaintenanceSection(containerEl, snapshot);
		containerEl.scrollTop = previousScrollTop;
		this.applyAgentConfigurationFocus();
	}

	private refreshSettings(): void {
		const declarativeTab = this as DeclarativeSettingTabCompat;
		if (declarativeTab.update) {
			declarativeTab.update();
			return;
		}
		void this.renderSettings();
	}

	private buildAgentListFingerprint(snapshot: AgentConnectionsSnapshot): string {
		return JSON.stringify({
			clientConfigs: snapshot.clientConfigs,
			integrations: snapshot.integrations,
			pendingOAuthRequests: snapshot.pendingOAuthRequests,
			recentAgents: snapshot.recentAgents,
			skillStates: snapshot.clientConfigs.map((config) => this.plugin.getSkillInstallState(config.clientId)),
		});
	}

	private applyAgentConfigurationFocus(): void {
		const target = this.agentListHostEl;
		if (!this.agentConfigurationFocusPending || !this.visible || !target?.isConnected) return;
		if (this.agentConfigurationFocusFrame !== null) {
			window.cancelAnimationFrame(this.agentConfigurationFocusFrame);
		}
		if (this.agentConfigurationFocusTimer !== null) {
			window.clearTimeout(this.agentConfigurationFocusTimer);
		}
		this.agentConfigurationFocusFrame = window.requestAnimationFrame(() => {
			this.agentConfigurationFocusFrame = window.requestAnimationFrame(() => {
				this.agentConfigurationFocusFrame = null;
				this.agentConfigurationFocusTimer = window.setTimeout(() => {
					this.agentConfigurationFocusTimer = null;
					if (
						!this.agentConfigurationFocusPending
						|| !this.visible
						|| this.agentListHostEl !== target
						|| !target.isConnected
					) return;
					this.agentConfigurationFocusPending = false;
					target.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
					target.scrollIntoView({ block: 'start', behavior: 'auto' });
				}, AGENT_CONFIGURATION_FOCUS_SETTLE_DELAY_MS);
			});
		});
	}

	private renderAgentClientConfigSection(container: HTMLElement, snapshot: AgentConnectionsSnapshot): HTMLElement {
		const {
			visibleAgents,
			candidateConfigs,
			unboundOAuthRequests,
			conflictingOAuthRequests,
			oauthClientOwnershipConflicts,
		} = buildAgentConfigurationViewModel(
			snapshot.clientConfigs,
			snapshot.recentAgents,
			snapshot.integrations,
			snapshot.pendingOAuthRequests
		);
		const group = this.createGroup(container, ui('Agent 配置', 'Agent configuration'))
			.addClass('tracekeeper-settings-agent-list-host');
		const groupEl = container.lastElementChild;
		if (!isSettingGroupHTMLElement(groupEl)) {
			throw new Error('Tracekeeper failed to create the Agent settings group.');
		}
		groupEl.setAttribute('data-tracekeeper-section', 'agent-configuration');
		group.addExtraButton((button) => {
			const addAgent = button.extraSettingsEl;
			addAgent.setAttribute('aria-label', ui('添加 Agent', 'Add Agent'));
			addAgent.setAttribute('aria-haspopup', 'menu');
			addAgent.setAttribute('aria-expanded', 'false');
			button
				.setIcon('plus')
				.setTooltip(ui('添加 Agent', 'Add Agent'))
				.setDisabled(candidateConfigs.length === 0)
				.onClick(() => {
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
										() => this.refreshAgentList(true),
										() => this.refreshSettings()
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
		});
		for (const conflict of oauthClientOwnershipConflicts) {
			const ownerNames = conflict.integrationIds.map((integrationId) =>
				visibleAgents.find(({ integration }) => integration.integrationId === integrationId)?.config.displayName
					?? integrationId
			);
			group.addSetting((setting) => {
				setting
					.setName(ui('OAuth 客户端归属冲突', 'OAuth client ownership conflict'))
					.setDesc(ui(
						`客户端 ID “${conflict.clientId}” 同时保存在多个 OAuth Agent（${ownerNames.join('、')}）。Tracekeeper 未改写这些记录；在撤销重复归属、只保留一个 Agent 前，该客户端不会作为已绑定客户端导出，其请求也不能授权。`,
						`Client ID “${conflict.clientId}” is stored on multiple OAuth Agents (${ownerNames.join(', ')}). Tracekeeper has not rewritten these records. Until you revoke duplicate ownership and leave exactly one Agent, the client is not exported as bound and its requests cannot be allowed.`
					));
			});
		}
		for (const request of conflictingOAuthRequests) {
			group.addSetting((setting) => {
				setting
					.setName(ui('已阻止的 OAuth 请求', 'Blocked OAuth request'))
					.setDesc(ui(
						`客户端 ID “${request.clientId}” 存在重复 Agent 归属，因此此请求不会显示在任何 Agent 卡片上，也不能授权。请先撤销重复归属。请求有效至 ${new Date(request.expiresAt).toLocaleString()}。`,
						`Client ID “${request.clientId}” has duplicate Agent owners, so this request is not shown on any Agent card and cannot be allowed. Revoke the duplicate ownership first. Expires ${new Date(request.expiresAt).toLocaleString()}.`
					))
					.addButton((button) => button
						.setButtonText(ui('拒绝', 'Deny'))
						.onClick(() => {
							button.setDisabled(true);
							void this.denyPendingOAuthRequest(request.requestId, () => {
								button.setDisabled(false);
							});
						}));
			});
		}
		for (const request of unboundOAuthRequests) {
			group.addSetting((setting) => {
				setting
					.setName(ui('未匹配的 OAuth 请求', 'Unmatched OAuth request'))
					.setDesc(ui(
						`此请求没有对应的当前 Agent 配置，不会绑定到任何 Agent。请拒绝后，从目标 Agent 的配置页面重新发起。请求有效至 ${new Date(request.expiresAt).toLocaleString()}。`,
						`This request does not match the current Agent configuration and will not be bound to any Agent. Deny it, then start again from the target Agent configuration. Expires ${new Date(request.expiresAt).toLocaleString()}.`
					))
					.addButton((button) => button
						.setButtonText(ui('拒绝', 'Deny'))
						.setWarning()
						.onClick(() => {
							button.setDisabled(true);
							void this.denyPendingOAuthRequest(request.requestId, () => {
								button.setDisabled(false);
							});
						}));
			});
		}
		if (visibleAgents.length === 0) {
			group.addSetting((setting) => {
				setting
					.setName(ui('尚无 Agent 卡片', 'No Agent cards yet'))
					.setDesc(ui(
						'使用分组标题右侧的添加按钮创建 Agent。',
						'Use the add button beside the group heading to create an Agent.'
					));
			});
			return groupEl;
		}
		for (const { agent, config, presentation } of visibleAgents) {
			group.addSetting((setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass('tracekeeper-settings-client-item');
				this.renderClientConfigRow(setting.settingEl, config, agent, presentation);
			});
		}
		return groupEl;
	}

	private async denyPendingOAuthRequest(requestId: string, onCommitFailure: () => void): Promise<void> {
		let refreshError: unknown;
		try {
			({ refreshError } = await commitOAuthDecisionWithBestEffortRefresh(
				() => this.plugin.decideOAuthRequest(requestId, { decision: 'deny' }),
				() => this.refreshAgentList(true)
			));
		} catch (error) {
			onCommitFailure();
			new Notice(error instanceof Error ? error.message : ui('无法拒绝 OAuth 请求。', 'Unable to deny the OAuth request.'));
			return;
		}
		if (refreshError) {
			console.error('tracekeeper denied an OAuth request but failed to refresh the Agent list', refreshError);
			new Notice(ui(
				'请求已拒绝，但 Agent 列表暂未刷新；Tracekeeper 已安排常规状态刷新。',
				'The request was denied, but the Agent list is stale. Tracekeeper has scheduled its normal state refresh.'
			));
		}
	}

	private renderConnectionInfoSection(container: HTMLElement, snapshot: AgentConnectionsSnapshot): void {
		const group = this.createGroup(container, ui('MCP 服务', 'MCP service'));
		this.renderRuntimeEnabledSetting(group, snapshot);
		this.renderEndpointSetting(
			group,
			snapshot.runtimeStatus.endpoint,
			snapshot.runtimeStatus.accessProtected
		);
		this.renderCapabilitiesSetting(group);
	}

	private renderRuntimeEnabledSetting(group: SettingGroup, snapshot: AgentConnectionsSnapshot): void {
		const enabled = this.plugin.settings.mcpRuntimeEnabled;
		const runtime = runtimeViewModel(snapshot.runtimeStatus, ui);
		group.addSetting((setting) => {
			setting
				.setName(ui('服务状态', 'Service status'))
				.setDesc(runtime.detail)
				.addToggle((toggle) =>
					toggle
						.setValue(enabled)
						.setDisabled(runtime.busy)
						.onChange((value: boolean) => {
							void this.plugin.setMcpRuntimeEnabled(value)
								.then(() => {
									this.refreshSettings();
								})
								.catch((error) => {
									console.error('tracekeeper failed to toggle MCP service', error);
								});
						})
				);
			setting.nameEl.addClass('tracekeeper-settings-runtime-name');
			setting.nameEl.createSpan({
				text: runtime.label,
				cls: `tracekeeper-badge ${runtimeToneBadgeClass(runtime.tone)}`,
			});
		});
		if (runtime.primaryAction === 'retry') {
			group.addSetting((setting) => {
				setting
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
								.then(() => {
									this.refreshSettings();
								})
								.catch((error) => {
									console.error('tracekeeper failed to recover MCP service', error);
									button.setDisabled(false);
									new Notice(error instanceof Error ? error.message : ui('MCP 服务启动失败。', 'Failed to start MCP service.'));
								});
						}));
			});
		}
	}

	private renderCapabilitiesSetting(group: SettingGroup): void {
		group.addSetting((setting) => {
			setting
				.setName(ui('服务功能', 'Capabilities'))
				.setDesc(ui('查看 AI 工具可以调用的 MCP 服务功能。', 'View the MCP service capabilities available to agents.'))
				.addButton((button) =>
					button
						.setButtonText(ui('查看功能', 'View capabilities'))
						.onClick(() => {
							new McpCapabilitiesModal(this.app).open();
						})
				);
		});
	}

	private renderEndpointSetting(
		group: SettingGroup,
		endpoint: string,
		accessProtected: boolean
	): void {
		let advancedSetting: Setting | null = null;
		let advancedVisible = false;
		group.addSetting((setting) => {
			setting.setName(ui('MCP 端点', 'MCP endpoint'));
			setting.descEl.createEl('code', {
				text: endpoint,
				attr: {
					'aria-label': ui('本机 MCP 端点', 'Local MCP endpoint'),
				},
			});
			const accessSummary = setting.descEl.createDiv({
				cls: 'tracekeeper-settings-endpoint-access',
			});
			const accessHeading = accessSummary.createDiv({
				cls: 'tracekeeper-settings-runtime-name',
			});
			accessHeading.createSpan({
				text: ui('全部 Agent 访问', 'All Agent access'),
			});
			accessHeading.createSpan({
				text: accessProtected
					? ui('本机访问已保护', 'Local access protected')
					: ui('保护不可用', 'Protection unavailable'),
				cls: `tracekeeper-badge ${
					accessProtected
						? 'tracekeeper-badge--success'
						: 'tracekeeper-badge--error'
				}`,
			});
			accessSummary.createEl('small', {
				text: ui(
					'每个 Agent 使用独立的 OAuth 或手动访问令牌；状态和撤销按卡片管理。',
					'Each Agent uses an independent OAuth or manual access token; status and revocation are managed per card.'
				),
			});
			setting
				.addExtraButton((button) =>
					button
						.setIcon('copy')
						.setTooltip(ui('复制 MCP 端点', 'Copy MCP endpoint'))
						.onClick(() => {
							void this.plugin.copyToClipboard(
								endpoint,
								ui('MCP 端点已复制。', 'MCP endpoint copied.')
							).catch((error) => {
								console.error('tracekeeper failed to copy MCP endpoint', error);
								new Notice(ui('复制 MCP 端点失败。', 'Failed to copy MCP endpoint.'));
							});
						})
				)
				.addButton((button) => {
					button.buttonEl.setAttribute('aria-controls', 'tracekeeper-mcp-endpoint-advanced');
					button.buttonEl.setAttribute('aria-expanded', 'false');
					button
						.setButtonText(ui('高级选项', 'Advanced options'))
						.onClick(() => {
							if (!advancedSetting) return;
							advancedVisible = !advancedVisible;
							if (advancedVisible) {
								advancedSetting.settingEl.show();
								advancedSetting.controlEl.querySelector('input')?.focus({ preventScroll: true });
							} else {
								advancedSetting.settingEl.hide();
							}
							button.buttonEl.setAttribute('aria-expanded', String(advancedVisible));
							button.setButtonText(advancedVisible
								? ui('收起选项', 'Hide options')
								: ui('高级选项', 'Advanced options'));
						});
				});
		});
		group.addSetting((setting) => {
			advancedSetting = setting;
			setting.setClass('tracekeeper-settings-endpoint-advanced');
			setting.settingEl.id = 'tracekeeper-mcp-endpoint-advanced';
			setting.settingEl.setAttribute('aria-label', ui('MCP 端点高级选项', 'MCP endpoint advanced options'));
			setting.settingEl.hide();
			this.renderPortSetting(setting, endpoint);
		});
	}

	private renderViewRefreshSection(container: HTMLElement): void {
		const group = this.createGroup(container, ui('视图刷新', 'View refresh'));
		group.addSetting((setting) => {
			setting
				.setName(ui('自动刷新', 'Auto refresh'))
				.setDesc(ui(
					'自动同步 Agent 配置和已打开的 Tracekeeper 动态视图。',
					'Keep Agent configuration and open Tracekeeper views in sync.'
				))
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.autoRefreshEnabled)
						.onChange((value: boolean) => {
							void this.plugin.setAutoRefreshEnabled(value)
								.then(() => {
									this.refreshSettings();
								})
								.catch((error) => {
									console.error('tracekeeper failed to update auto refresh setting', error);
								});
						})
				);
		});
		group.addSetting((setting) => {
			setting
				.setName(ui('刷新间隔', 'Refresh interval'))
				.setDesc(ui(
					'文件变化时也会立即刷新。',
					'File changes also trigger an immediate refresh.'
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
								.then(() => {
									this.refreshSettings();
								})
								.catch((error) => {
									console.error('tracekeeper failed to update auto refresh interval', error);
								});
						});
				});
		});
	}

	private renderNoteContentSection(container: HTMLElement): void {
		const resolved = this.plugin.resolveNoteContentLanguage();
		const group = this.createGroup(container, ui('笔记内容', 'Note content'));
		group.addSetting((setting) => {
			setting
				.setName(ui('笔记内容语言', 'Note content language'))
				.setDesc(ui(
					`用于新生成笔记的标题和说明；当前生效：${resolved.language}。`,
					`Used for headings and helper text in new notes; active: ${resolved.language}.`
				))
				.addDropdown((dropdown) => {
					for (const language of NOTE_CONTENT_LANGUAGES) {
						dropdown.addOption(language, noteContentLanguageLabel(language));
					}
					dropdown
						.setValue(this.plugin.settings.noteContentLanguage)
						.onChange((value: string) => {
							void this.plugin.setNoteContentLanguage(value)
								.then(() => {
									this.refreshSettings();
								})
								.catch((error) => {
									console.error('tracekeeper failed to update note content language', error);
								});
						});
				});
		});
	}

	private renderMemoryRulesSection(container: HTMLElement): void {
		const group = this.createGroup(container, ui('记忆规则', 'Memory rules'));
		group.addSetting((setting) => {
			setting
				.setName(ui('Wiki 变更', 'Wiki changes'))
				.setDesc(ui(
					'Wiki 提案始终进入知识变更审核，不受全局或项目记忆规则影响。MemoryRecord 的 Wiki 与 Source 关系均为可选，不会因为缺少 Wiki 而阻止保存。',
					'Wiki proposals always enter Knowledge Change Review and are not governed by global or project memory rules. Wiki and Source relations on a MemoryRecord are optional; missing Wiki context does not block persistence.'
				));
		});
		group.addSetting((setting) => {
			setting
				.setName(ui('全局记忆', 'Global memory'))
				.setDesc(this.globalMemoryRuleDescription())
				.addDropdown((dropdown) => {
					for (const rule of MEMORY_PROPOSAL_RULES) {
						dropdown.addOption(rule, memoryProposalRuleLabel(rule));
					}
					dropdown
						.setValue(this.plugin.settings.globalMemoryRule)
						.onChange((value: string) => {
							void this.plugin.setGlobalMemoryRule(value)
								.then(() => {
									this.refreshSettings();
								})
								.catch((error) => {
									console.error('tracekeeper failed to update global memory rule', error);
								});
						});
				});
		});
		const globalHub = this.plugin.getGlobalMemoryHubStatus();
		if (globalHub.state !== 'ready') {
			group.addSetting((setting) => {
				setting
					.setName(ui('全局记忆 Hub 已阻断', 'Global Memory Hub blocked'))
					.setDesc(ui(
						globalHub.state === 'missing'
							? `缺少 ${globalHub.path}。全局记忆建议可以进入审核，但在修复前不会被描述为已持久化，Auto 写入也会被阻止。`
							: `${globalHub.path} 不是有效的 Markdown 文件。全局记忆持久化已阻止；Tracekeeper 不会覆盖该路径。`,
						globalHub.state === 'missing'
							? `${globalHub.path} is missing. Global memory suggestions may enter review, but are not persisted before repair, and Auto writes are blocked.`
							: `${globalHub.path} is not a valid Markdown file. Global memory persistence is blocked, and Tracekeeper will not overwrite that path.`
					))
					.addButton((button) => button
						.setButtonText(ui('检查并修复结构', 'Check and repair structure'))
						.setCta()
						.onClick(() => {
							void this.plugin.openInitializeMemoryStructureModal();
						}));
			});
		}
		group.addSetting((setting) => {
			setting
				.setName(ui('项目记忆', 'Project memory'))
				.setDesc(this.projectMemoryRuleDescription())
				.addDropdown((dropdown) => {
					for (const rule of MEMORY_PROPOSAL_RULES) {
						dropdown.addOption(rule, memoryProposalRuleLabel(rule));
					}
					dropdown
						.setValue(this.plugin.settings.projectMemoryRule)
						.onChange((value: string) => {
							void this.plugin.setProjectMemoryRule(value)
								.then(() => {
									this.refreshSettings();
								})
								.catch((error) => {
									console.error('tracekeeper failed to update project memory rule', error);
								});
						});
				});
		});
		const trackingGroup = this.createGroup(container, ui('任务追踪', 'Task tracking'));
		trackingGroup.addSetting((setting) => {
			setting
				.setName(ui('启用任务追踪', 'Enable task tracking'))
				.setDesc(ui(
					'记录任务的目标、执行过程和结果，供后续查看与继续。',
					'Record task goals, execution, and outcomes for later review and continuation.'
				))
				.addToggle((toggle) => {
					toggle
						.setValue(this.plugin.settings.taskTrackingEnabled)
						.onChange((value: boolean) => {
							void this.plugin.setTaskTrackingEnabled(value)
								.then(() => {
									this.refreshSettings();
								})
								.catch((error) => {
									console.error('tracekeeper failed to update task tracking', error);
								});
						});
				});
		});
	}

	private globalMemoryRuleDescription(): string {
		switch (this.plugin.settings.globalMemoryRule) {
			case 'auto_write':
				return ui(
					'自动创建符合条件的不可变 Global MemoryRecord v2；用户权威、冲突和生命周期变更仍需审核。',
					'Automatically create eligible immutable Global MemoryRecord v2 records; user authority, conflicts, and lifecycle changes still require review.'
				);
			case 'disabled':
				return ui('不接收新的全局 MemoryRecord。', 'Do not accept new global MemoryRecords.');
			case 'review_queue':
			default:
				return ui(
					'全局 MemoryRecord 保存前进入知识变更审核；这是新安装的默认设置。',
					'Review Global MemoryRecords before persistence. This is the default for new installations.'
				);
		}
	}

	private projectMemoryRuleDescription(): string {
		switch (this.plugin.settings.projectMemoryRule) {
			case 'review_queue':
				return ui('项目记忆保存前进入知识变更审核。', 'Review project memory before saving.');
			case 'disabled':
				return ui('不接收新的项目记忆。', 'Do not accept new project memory.');
			case 'auto_write':
			default:
				return ui(
					'对可精确识别的新项目，以仅创建方式安全初始化 canonical 项目 Hub，并自动写入不可变 Project MemoryRecord v2；身份不明确、路径占用或 Hub 无效，以及用户权威、冲突和生命周期变更仍需审核。',
					'For an exactly identified new project, safely initialize its canonical Hub with create-only semantics and automatically write an immutable Project MemoryRecord v2; uncertain identity, occupied paths or invalid Hubs, user authority, conflicts, and lifecycle changes still require review.'
				);
		}
	}

	private renderAdvancedMaintenanceSection(
		container: HTMLElement,
		snapshot: AgentConnectionsSnapshot
	): void {
		const group = this.createGroup(container, ui('高级维护', 'Advanced maintenance'));
		const runtime = runtimeViewModel(snapshot.runtimeStatus, ui);
		group.addSetting((setting) => {
			setting
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
								.then(() => {
									this.refreshSettings();
								})
								.catch((error) => {
									console.error('tracekeeper failed to restart MCP service', error);
									button.setDisabled(false);
									new Notice(ui('MCP 服务重启失败。', 'Failed to restart MCP service.'));
								});
						})
				);
		});
		group.addSetting((setting) => {
			setting
				.setName(ui('全部 Agent 访问', 'All Agent access'))
				.setDesc(ui(
					'撤销会删除全部 Agent 配置、凭据和 Skill 状态记录，并终止 Session。',
					'Revocation deletes all Agent configurations, credentials, and Skill state records, and ends Sessions.'
				))
				.addButton((button) => {
					button
						.setButtonText(ui('撤销全部 Agent 访问', 'Revoke all Agent access'))
						.onClick(() => {
							new RuntimeAccessResetModal(this.app, this.plugin, () => this.refreshSettings()).open();
						});
					button.buttonEl.addClass('mod-warning');
				});
		});
		group.addSetting((setting) => {
			setting
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
		});
	}

	private renderPortSetting(setting: Setting, connectionUrl: string): void {
		let draftPort = String(this.plugin.settings.mcpPort);
		let applyButton: HTMLButtonElement | null = null;
		setting
			.setName(ui('端口号', 'Port'))
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
							.then(() => {
								this.refreshSettings();
							})
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
		presentation: import('../client-config/agent-connection-view-model').ConnectionPresentation
	): void {
		const row = container.createDiv({ cls: 'tracekeeper-settings-client-row' });
		const info = row.createDiv({ cls: 'tracekeeper-settings-client-row__info' });
		const title = info.createDiv({ cls: 'tracekeeper-config-row__title' });
		title.createEl('strong', { text: config.displayName });
		title.createSpan({
			text: this.connectionStateLabel(presentation.state),
			cls: `tracekeeper-badge ${presentation.state === 'connected' || presentation.state === 'used' || presentation.state === 'authorized' ? 'tracekeeper-badge--success' : presentation.state === 'revoked' || presentation.state === 'needs_update' ? 'tracekeeper-badge--warning' : 'tracekeeper-badge--muted'}`,
		});
		const meta = info.createDiv({ cls: 'tracekeeper-settings-client-row__meta' });
		const latestActivityAt = agent?.sortTimestamp ?? 0;
		meta.createSpan({
			text: ui(
				`最近活动时间：${latestActivityAt > 0 ? this.plugin.formatDisplayTime(latestActivityAt) : '暂无活动'}`,
				`Latest activity: ${latestActivityAt > 0 ? this.plugin.formatDisplayTime(latestActivityAt) : 'No activity'}`
			),
		});
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
				() => this.refreshAgentList(true),
				() => this.refreshSettings()
			).open();
		});
		renderClientSkillPrompt({
			app: this.app,
			plugin: this.plugin,
			container: row,
			config,
			onChanged: () => this.refreshAgentList(true),
		});
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
			case 'manual': return ui('手动访问令牌', 'Manual access token');
			default: return ui('未配置', 'Not configured');
		}
	}

	private createGroup(container: HTMLElement, title: string): SettingGroup {
		return new SettingGroup(container).setHeading(title);
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createSpan({ text: label });
		item.createEl('strong', { text: value || ui('未知', 'Unknown') });
	}

}
