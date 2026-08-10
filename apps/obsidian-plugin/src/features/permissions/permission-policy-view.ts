import { ItemView, WorkspaceLeaf } from 'obsidian';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_PERMISSION_POLICY_VIEW } from '../../ui/view-types';

export class TracekeeperPermissionPolicyView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_PERMISSION_POLICY_VIEW;
	}

	getDisplayText() {
		return ui('权限说明', 'Permission guide');
	}

	getViewData() {
		return '';
	}

	setViewData(_data: string, _clear: boolean): void {
		return;
	}

	clear(): void {
		this.contentEl.empty();
	}

	async onOpen() {
		await super.onOpen();
		this.containerEl.addClass('tracekeeper-item-view');
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		contentEl.createEl('p', {
			text: ui(
				'Agent 默认先读取和整理资料；全局记忆默认由你审核，项目记忆是否自动保存由记忆规则决定。',
				'Agents read and organize material by default. Global memory is reviewed by default, while project auto-save follows your memory rules.'
			),
			cls: 'tracekeeper-view__description',
		});

		const sections = [
			{
				title: ui('可直接读取', 'Read directly'),
				items: [
					ui('查看连接和资料状态', 'Check connection and knowledge base status'),
					ui('查找相关笔记', 'Find related notes'),
					ui('读取指定笔记', 'Read a selected note'),
					ui('查看知识变更审核和最近记录', 'Knowledge Change Review and recent activity'),
					ui('检查笔记结构', 'Check note structure'),
				],
			},
			{
				title: ui('可保存工作记录', 'Save work records'),
				items: [
					ui('保存来源资料和分析结果', 'Save source material and analysis results'),
					ui('整理上下文材料', 'Prepare context material'),
					ui('记录任务结果和会话摘要', 'Record task results and session summaries'),
					ui('按记忆规则提交长期记忆更新', 'Submit long-term memory updates by memory rules'),
				],
			},
			{
				title: ui('必须先审核', 'Needs review first'),
				items: [
					ui('全局记忆默认先进入知识变更审核', 'Global memory enters Knowledge Change Review by default'),
					ui('项目记忆可按规则自动保存', 'Project memory can auto-save by rule'),
					ui('审核通过后的写入会留下记录，方便追溯', 'Approved writes leave records for traceability'),
				],
			},
			{
				title: ui('Agent / MCP 不会执行', 'Agent / MCP boundaries'),
				items: [
					ui(
						'Agent 不会通过 Tracekeeper 运行系统命令或安装软件',
						'Agents cannot run system commands or install software through Tracekeeper'
					),
					ui(
						'MCP 不会访问当前知识库之外的文件',
						'MCP cannot access files outside the current knowledge base'
					),
					ui(
						'Agent 不会绕过 Obsidian 中的预览、审核或确认步骤',
						'Agents cannot bypass preview, review, or confirmation in Obsidian'
					),
					ui(
						'MCP 不会执行迁移、清理或批量重写；这些操作只能由你在 Obsidian 中明确发起',
						'MCP cannot migrate, clean up, or bulk rewrite notes; only you can explicitly start those actions in Obsidian'
					),
					ui(
						'未经审核不会直接写入受保护记忆',
						'Will not write protected memory without review'
					),
				],
			},
		];

		for (const policySection of sections) {
			const section = contentEl.createDiv({ cls: 'tracekeeper-view__section' });
			section.createEl('h3', { text: policySection.title });
			const list = section.createEl('ul', { cls: 'tracekeeper-view__list' });
			for (const item of policySection.items) {
				list.createEl('li', { text: item, cls: 'tracekeeper-view__item' });
			}
		}

		const source = contentEl.createDiv({ cls: 'tracekeeper-view__section' });
		source.createEl('h3', { text: ui('使用提示', 'Tip') });
		source.createEl('p', {
			text: ui(
				'如果不确定某条记忆是否应该保存，请选择“退回修改”，不要直接通过审核。',
				'If you are unsure whether a memory should be saved, return it for revision instead of approving it.'
			),
			cls: 'tracekeeper-view__description',
		});
	}
}
