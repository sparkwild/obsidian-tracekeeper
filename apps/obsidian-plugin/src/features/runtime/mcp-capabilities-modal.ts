import { Modal } from 'obsidian';
import { LOCAL_TRUST_CAPABILITIES, toolDefinitions } from '@tracekeeper/mcp-runtime';
import { getContractByName, type ToolRisk } from '@tracekeeper/contracts';
import { localizedText, ui, type LocalizedText } from '../../ui/localization';

export interface McpCapabilityLocalization {
	title: LocalizedText;
	description: LocalizedText;
	category: LocalizedText;
}

export const MCP_CAPABILITY_LOCALIZATIONS: Record<string, McpCapabilityLocalization> = {
	'tracekeeper.status': {
		title: { zh: '查看状态', en: 'Check status' },
		description: {
			zh: '扫描当前知识库，返回基础文件数量、待审核项目、任务和最近活动概览。',
			en: 'Scans the current vault and returns counts for notes, review items, tasks, and recent activity.',
		},
		category: { zh: '概览', en: 'Overview' },
	},
	'tracekeeper.graph_health': {
		title: { zh: '检查知识图谱', en: 'Check graph health' },
		description: {
			zh: '分析 wikilink、入口页、hub、孤立节点和未解析链接，帮助判断 Obsidian 图谱结构是否健康。',
			en: 'Analyzes wikilinks, entry notes, hubs, isolated notes, and unresolved links to assess graph health.',
		},
		category: { zh: '维护', en: 'Maintenance' },
	},
	'tracekeeper.start_task': {
		title: { zh: '开始任务', en: 'Start task' },
		description: {
			zh: '开始一次 Agent 工作，记录任务并返回下一步建议召回方式。',
			en: 'Starts an agent task, records it, and returns the recommended recall step.',
		},
		category: { zh: '任务', en: 'Task' },
	},
	'tracekeeper.recall': {
		title: { zh: '召回记忆', en: 'Recall memory' },
		description: {
			zh: '优先用它查找相关记忆、Wiki 和来源；结果包含摘要、命中原因和图谱链接。',
			en: 'Use first to find related memory, wiki, and sources; results include excerpts, match reasons, and graph links.',
		},
		category: { zh: '检索', en: 'Recall' },
	},
	'tracekeeper.memory': {
		title: { zh: '查看记忆生命周期', en: 'Inspect memory lifecycle' },
		description: {
			zh: '按全局或项目范围查看当前、历史、冲突及全部记忆元数据；结果绑定索引代次，正文需另行读取。',
			en: 'Lists current, history, conflict, or all memory metadata for global or project scope. Results are generation-bound; full bodies require a separate read.',
		},
		category: { zh: '检索', en: 'Recall' },
	},
	'tracekeeper.project_context': {
		title: { zh: '项目上下文', en: 'Project context' },
		description: {
			zh: '按项目、仓库路径或项目 ID 定向检索，避免无差别加载所有项目记忆。',
			en: 'Retrieves context scoped by project, repository path, or project id instead of loading every project memory.',
		},
		category: { zh: '检索', en: 'Recall' },
	},
	'tracekeeper.project_history': {
		title: { zh: '项目历史', en: 'Project history' },
		description: {
			zh: '读取指定项目的历史任务、会话和连续性记录，帮助 Agent 接上之前的工作。',
			en: 'Reads project-scoped task, session, and continuity records so agents can resume prior work.',
		},
		category: { zh: '检索', en: 'Recall' },
	},
	'tracekeeper.read_note': {
		title: { zh: '读取笔记', en: 'Read note' },
		description: {
			zh: '在召回摘要不够时，按知识库相对路径读取单篇完整笔记。',
			en: 'Reads one full note by vault-relative path when recall excerpts are not enough.',
		},
		category: { zh: '检索', en: 'Recall' },
	},
	'tracekeeper.review_queue': {
		title: { zh: '查看知识变更审核', en: 'Knowledge Change Review' },
		description: {
			zh: '查看待审核或已通过的变更提案；真正写入仍需要单独的审核后写入动作。',
			en: 'Lists pending or approved change proposals; durable writeback still requires the separate review-gated apply action.',
		},
		category: { zh: '审核', en: 'Review' },
	},
	'tracekeeper.list_review_queue': {
		title: { zh: '查看知识变更审核', en: 'List Knowledge Change Review' },
		description: {
			zh: '读取等待用户确认的变更提案；全局记忆默认需要审核，项目记忆可按规则自动保存。',
			en: 'Reads change proposals waiting for confirmation; global memory defaults to review, while project memory can auto-save by rule.',
		},
		category: { zh: '审核', en: 'Review' },
	},
	'tracekeeper.list_source_requests': {
		title: { zh: '查看资料请求', en: 'List source requests' },
		description: {
			zh: '读取等待 Agent 处理的资料分析请求，用于后续生成来源笔记、分析报告或记忆提案。',
			en: 'Reads pending source-analysis requests that can later produce source notes, reports, or memory proposals.',
		},
		category: { zh: '资料', en: 'Source' },
	},
	'tracekeeper.list_approved_writebacks': {
		title: { zh: '查看待写入内容', en: 'List ready-to-apply changes' },
		description: {
			zh: '读取已经通过审核、可以由运行时执行写回的候选提案。',
			en: 'Reads proposals that have already been approved and are candidates for runtime writeback.',
		},
		category: { zh: '审核', en: 'Review' },
	},
	'tracekeeper.agent_activity_recent': {
		title: { zh: '查看 Agent 活动', en: 'Read Agent activity' },
		description: {
			zh: '读取按 UTC 日期分片保存的 MCP 连接、认证拒绝和工具调用活动；不记录用户界面操作。',
			en: 'Reads daily UTC-sharded MCP connection, authentication-rejection, and tool-call activity; user interface operations are excluded.',
		},
		category: { zh: 'Agent 活动', en: 'Agent activity' },
	},
	'tracekeeper.analyze_source_request': {
		title: { zh: '分析资料请求', en: 'Analyze source request' },
		description: {
			zh: '处理一条资料请求，生成来源笔记、分析输出或审核提案；MCP 调用会形成 Agent 活动。',
			en: 'Processes one source request and writes source notes, analysis output, or review proposals; the MCP call is recorded as Agent activity.',
		},
		category: { zh: '资料', en: 'Source' },
	},
	'tracekeeper.source_request': {
		title: { zh: '处理资料请求', en: 'Source requests' },
		description: {
			zh: '查看资料请求，或处理一条已有请求；不会主动抓取外部网络内容。',
			en: 'Lists source requests or analyzes one existing request; it does not fetch external network content.',
		},
		category: { zh: '资料', en: 'Source' },
	},
	'tracekeeper.apply_approved_writeback': {
		title: { zh: '预览并写入', en: 'Preview and apply' },
		description: {
			zh: '只对已通过审核的变更提案执行写入，把明确确认的内容追加到目标笔记。',
			en: 'Applies only approved change proposals by appending explicitly confirmed content to the target note.',
		},
		category: { zh: '写回', en: 'Writeback' },
	},
	'tracekeeper.build_context_pack': {
		title: { zh: '生成上下文包', en: 'Build context pack' },
		description: {
			zh: '根据查询生成精简上下文；默认只返回结果，只有指定写入时才创建笔记。',
			en: 'Builds compact context from a query; returns results by default and writes only when requested.',
		},
		category: { zh: '上下文', en: 'Context' },
	},
	'tracekeeper.lint': {
		title: { zh: '检查知识库规范', en: 'Run vault checks' },
		description: {
			zh: '只读检查结构、生命周期、证据、Hub、关系一致性、来源分片和图谱问题，并返回 Doctor 预览数据。',
			en: 'Read-only checks cover structure, lifecycle, evidence, Hubs, relation parity, source parts, and graph health, with Doctor preview data.',
		},
		category: { zh: '维护', en: 'Maintenance' },
	},
	'tracekeeper.finish_task': {
		title: { zh: '结束任务', en: 'Finish task' },
		description: {
			zh: '在同一份 Markdown 任务记录中写入结束结果，不隐式创建会话文件；若开始记录缺失，则在规范任务路径重建完整记录并明确标注来源，同时单独报告关联 Wiki/Memory 的持久化状态。',
			en: 'Completes one canonical Markdown task record without an implicit session file; when the start record is missing, reconstructs the complete record at the canonical task path with explicit provenance, while separately reporting task-linked Wiki/Memory persistence.',
		},
		category: { zh: '任务', en: 'Task' },
	},
	'tracekeeper.distill_session': {
		title: { zh: '提炼会话', en: 'Distill session' },
		description: {
			zh: '把一次会话中的决策、偏好和后续动作整理成会话记录与待审核记忆提案。',
			en: 'Distills decisions, preferences, and next actions from a session into a session note and reviewable memory proposals.',
		},
		category: { zh: '记忆', en: 'Memory' },
	},
	'tracekeeper.write_context_pack': {
		title: { zh: '写入上下文包', en: 'Write context pack' },
		description: {
			zh: '把已生成的上下文内容写入 Tracekeeper 工作区，便于后续复用；MCP 调用会形成 Agent 活动。',
			en: 'Writes generated context content under the Tracekeeper workspace for reuse; the MCP call is recorded as Agent activity.',
		},
		category: { zh: '上下文', en: 'Context' },
	},
	'tracekeeper.write_session_note': {
		title: { zh: '写入会话记录', en: 'Write session note' },
		description: {
			zh: '把会话内容写入 Tracekeeper 工作区，作为任务过程的本地记录。',
			en: 'Writes session content under the Tracekeeper workspace as a local record of the work.',
		},
		category: { zh: '记录', en: 'Record' },
	},
	'tracekeeper.capture_source': {
		title: { zh: '捕获资料来源', en: 'Capture source' },
		description: {
			zh: '把网页、文件或转录保存为可读取的来源证据；它不代表关联的 Wiki/Memory 已经审核并写入。',
			en: 'Saves web, file, or transcript material as readable source evidence; this does not mean a related Wiki/Memory proposal was applied.',
		},
		category: { zh: '资料', en: 'Source' },
	},
	'tracekeeper.propose_memory': {
		title: { zh: '提交记忆提案', en: 'Propose memory' },
		description: {
			zh: '提交带证据和生命周期关系的 Wiki/Memory 候选；未自动写入的提案只有在审核并确认写入后才算已持久化。',
			en: 'Submits evidence-backed Wiki/Memory candidates; a non-auto-applied proposal is persisted only after governed review and confirmed apply.',
		},
		category: { zh: '记忆', en: 'Memory' },
	},
};

export const mcpCapabilityRiskLabel = (risk: ToolRisk): string => {
	switch (risk) {
		case 'low-risk-write':
			return ui('低风险写入', 'Low-risk write');
		case 'review-gated-write':
			return ui('审核后写入', 'Review-gated write');
		case 'read-only':
		default:
			return ui('只读', 'Read-only');
	}
};

export class McpCapabilitiesModal extends Modal {
	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-capabilities-modal');
		this.titleEl.setText(ui('MCP 服务功能', 'MCP service capabilities'));

		contentEl.createEl('p', {
			text: ui(
				'以下是当前默认权限允许 Agent 调用的功能。人工审核和确认写入仍在 Obsidian 中完成。移动到功能项上可查看说明。',
				'These capabilities are available to Agents under the current default permissions. Human review and confirmed writeback remain in Obsidian. Hover a capability to see its explanation.'
			),
			cls: 'tracekeeper-view__description',
		});

		const list = contentEl.createDiv({ cls: 'tracekeeper-capability-list' });
		for (const definition of toolDefinitions(LOCAL_TRUST_CAPABILITIES)) {
			const localization = MCP_CAPABILITY_LOCALIZATIONS[definition.name];
			const contract = getContractByName(definition.name);
			const title = localization ? localizedText(localization.title) : definition.title;
			const description = localization ? localizedText(localization.description) : definition.description;
			const category = localization ? localizedText(localization.category) : ui('功能', 'Capability');
			const riskLabel = contract ? mcpCapabilityRiskLabel(contract.risk) : ui('功能说明', 'Capability');
			const subtitle = `${title} · ${riskLabel}`;
			const tooltip = `${definition.name}\n${description}`;
			const accessibleLabel = `${definition.name}\n${subtitle}\n${description}`;
			const row = list.createDiv({ cls: 'tracekeeper-capability-row' });
			row.tabIndex = 0;
			row.setAttr('aria-label', accessibleLabel);
			row.setAttr('data-tooltip-position', 'top');
			row.setAttr('title', tooltip);
			row.createSpan({
				text: category,
				cls: 'tracekeeper-badge tracekeeper-capability-row__badge',
			});
			const body = row.createDiv({ cls: 'tracekeeper-capability-row__body' });
			body.createEl('code', {
				text: definition.name,
				cls: 'tracekeeper-capability-row__tool',
			});
			body.createEl('small', {
				text: subtitle,
				cls: 'tracekeeper-capability-row__subtitle',
			});
		}

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const close = actions.createEl('button', { text: ui('关闭', 'Close') });
		close.addEventListener('click', () => this.close());
	}
}
