import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type TracekeeperPlugin from '../../main';
import {
	type MemoryInspectorQuery,
	type MemoryInspectorRecord,
	type MemoryInspectorSnapshot,
	type MemoryLifecycleFilter,
	type MemoryLifecycleDisplayState,
	type MemoryRecordScope,
	type MemoryScopeFilter,
	type MemoryStateFilter,
} from '../observability/knowledge-observability-model';
import type {
	LegacyMemoryMigrationPreview,
	LegacyMemoryMigrationResult,
} from '../structure/legacy-memory-migration-controller';
import { ui } from '../../ui/localization';
import { TRACEKEEPER_MEMORY_INSPECTOR_VIEW } from '../../ui/view-types';
import { trimText } from '../shared/markdown-record-parser';

const unknownMemoryValueLabel = (
	value: string,
	zhLabel: string,
	enLabel: string
): string => {
	const rawValue = value.trim();
	return rawValue
		? ui(zhLabel, enLabel)
		: ui('未记录', 'Not recorded');
};

export const memoryInspectorAuthorityLabel = (authority: string): string => {
	switch (authority.trim().toLowerCase()) {
		case 'agent': return ui('AI 助手', 'Agent');
		case 'source': return ui('资料来源', 'Source');
		case 'user': return ui('用户', 'User');
		default: return unknownMemoryValueLabel(authority, '未知权威来源', 'Unknown authority');
	}
};

export const memoryInspectorConfidenceLabel = (confidence: string): string => {
	switch (confidence.trim().toLowerCase()) {
		case 'uncertain': return ui('不确定', 'Uncertain');
		case 'inferred': return ui('推断', 'Inferred');
		case 'supported': return ui('有证据支持', 'Supported');
		case 'verified': return ui('已验证', 'Verified');
		default: return unknownMemoryValueLabel(confidence, '未知置信度', 'Unknown confidence');
	}
};

export const memoryInspectorEffectiveStateLabel = (state: string): string => {
	switch (state.trim().toLowerCase()) {
		case 'current': return ui('当前', 'Current');
		case 'superseded': return ui('已被替代', 'Superseded');
		case 'disputed': return ui('有争议', 'Disputed');
		case 'retracted': return ui('已撤回', 'Retracted');
		case 'review': return ui('待审核', 'Review');
		case 'legacy_unkeyed': return ui('旧版未标识', 'Legacy unkeyed');
		case 'queued': return ui('待确认', 'Queued');
		case 'missing': return ui('证据缺失', 'Missing evidence');
		default: return unknownMemoryValueLabel(state, '未知有效状态', 'Unknown effective state');
	}
};

export const memoryInspectorLifecycleReasonLabel = (reason: string): string => {
	const normalized = reason.trim().toLowerCase();
	if (normalized.startsWith('superseded_by:')) {
		const successorId = reason.trim().slice(reason.indexOf(':') + 1).trim();
		return successorId
			? ui(`被 ${successorId} 替代`, `Superseded by ${successorId}`)
			: unknownMemoryValueLabel(reason, '未知生命周期原因', 'Unknown lifecycle reason');
	}
	switch (normalized) {
		case 'declared_disputed': return ui('声明为有争议', 'Declared disputed');
		case 'declared_retracted': return ui('声明为已撤回', 'Declared retracted');
		case 'declared_review': return ui('声明为待审核', 'Declared for review');
		case 'not_yet_valid': return ui('尚未生效', 'Not yet valid');
		case 'validity_ended': return ui('有效期已结束', 'Validity ended');
		case 'duplicate_memory_id': return ui('记忆标识重复', 'Duplicate memory ID');
		case 'dangling_supersedes': return ui('替代关系目标缺失', 'Supersession target is missing');
		case 'cross_claim_supersedes': return ui('跨 Claim 替代关系', 'Cross-claim supersession');
		case 'dangling_contradicts': return ui('矛盾关系目标缺失', 'Contradiction target is missing');
		case 'cross_claim_contradicts': return ui('跨 Claim 矛盾关系', 'Cross-claim contradiction');
		case 'explicit_contradiction': return ui('显式矛盾', 'Explicit contradiction');
		case 'supersession_cycle': return ui('替代关系成环', 'Supersession cycle');
		case 'duplicate_current': return ui('存在多条当前记录', 'Multiple current records');
		case 'stale_verification': return ui('验证已过期', 'Stale verification');
		case 'missing_claim_key': return ui('缺少 Claim 标识', 'Missing Claim key');
		case 'pending_human_review': return ui('等待人工审核', 'Pending human review');
		case 'missing_persisted_evidence': return ui('缺少持久化证据', 'Missing persisted evidence');
		default: return unknownMemoryValueLabel(reason, '未知生命周期原因', 'Unknown lifecycle reason');
	}
};

export const memoryInspectorProposalStatusLabel = (status: string): string => {
	switch (status.trim().toLowerCase()) {
		case 'pending':
		case 'pending_review': return ui('待审核', 'Pending review');
		case 'approved': return ui('已批准', 'Approved');
		case 'rejected': return ui('已拒绝', 'Rejected');
		case 'deferred': return ui('已暂缓', 'Deferred');
		case 'revision_requested': return ui('已请求修改', 'Revision requested');
		case 'applied': return ui('已写入', 'Applied');
		default: return unknownMemoryValueLabel(status, '未知提案状态', 'Unknown proposal status');
	}
};

export const memoryInspectorIndexStateLabel = (state: string): string => {
	switch (state.trim().toLowerCase()) {
		case 'initializing': return ui('初始化中', 'Initializing');
		case 'building': return ui('构建中', 'Building');
		case 'rebuilding': return ui('重建中', 'Rebuilding');
		case 'ready': return ui('已就绪', 'Ready');
		case 'recovering': return ui('恢复中', 'Recovering');
		case 'error': return ui('错误', 'Error');
		default: return unknownMemoryValueLabel(state, '未知索引状态', 'Unknown index state');
	}
};

export class TracekeeperMemoryInspectorView extends ItemView {
	private migrationPreview: LegacyMemoryMigrationPreview | null = null;
	private migrationResult: LegacyMemoryMigrationResult | null = null;
	private migrationBusy = false;
	private query: MemoryInspectorQuery = {
		page: 1,
		scope: 'all',
		state: 'all',
		lifecycle: 'all',
	};

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TracekeeperPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return TRACEKEEPER_MEMORY_INSPECTOR_VIEW;
	}

	getDisplayText() {
		return ui('记忆查看', 'Memory view');
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
		await this.refresh();
	}

	async focus(query: Pick<MemoryInspectorQuery, 'focusPaths' | 'taskId'>): Promise<void> {
		this.query = {
			...this.query,
			page: 1,
			focusPaths: query.focusPaths,
			taskId: query.taskId,
		};
		await this.refresh();
	}

	private async render(snapshot: MemoryInspectorSnapshot): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tracekeeper-view-root');

		const header = contentEl.createDiv({ cls: 'tracekeeper-shell-header' });
		header.createEl('p', {
			text: ui(
				'查看全局与项目记忆的 Markdown 证据，以及仍在审核或已经失效的引用。',
				'Inspect Markdown evidence for global and project memory, including queued changes and stale references.'
			),
			cls: 'tracekeeper-view__description',
		});
		const refreshButton = header.createEl('button', { text: ui('刷新', 'Refresh') });
		refreshButton.setAttr('aria-label', ui('刷新记忆索引投影', 'Refresh memory index projection'));
		refreshButton.addEventListener('click', () => {
			void this.refreshWithNotice(refreshButton);
		});

		this.renderIndexStatus(contentEl, snapshot);
		this.renderMaintenanceCandidates(contentEl, snapshot);
		this.renderLegacyMigrationStatus(contentEl, snapshot.lifecycleCounts.legacy_unkeyed);
		this.renderFilters(contentEl, snapshot);

		if (snapshot.focused) {
			const focus = contentEl.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-focus' });
			const focusHeader = focus.createDiv({ cls: 'tracekeeper-card__header' });
			focusHeader.createEl('strong', {
				text: ui('仅显示所选任务关联的记忆', 'Showing memory related to the selected task'),
			});
			const clearButton = focusHeader.createEl('button', { text: ui('显示全部', 'Show all') });
			clearButton.addEventListener('click', () => {
				this.query = {
					...this.query,
					page: 1,
					focusPaths: [],
					taskId: '',
				};
				void this.refresh();
			});
		}

		if (snapshot.missingMemoryFolder) {
			this.renderEmptyState(
				contentEl,
				ui('记忆目录尚未初始化', 'Memory folder is not initialized'),
				ui(
					'请先在 Tracekeeper 中校验知识库结构；该操作只补齐受控目录和入口文件。',
					'Check the knowledge structure in Tracekeeper first. This only creates controlled folders and entry notes.'
				)
			);
			return;
		}

		if (snapshot.records.length === 0) {
			this.renderEmptyState(
				contentEl,
				snapshot.focused
					? ui('所选任务没有可显示的记忆证据', 'No memory evidence is available for the selected task')
					: ui('没有符合筛选条件的记忆记录', 'No memory records match these filters'),
				snapshot.focused
					? ui('可返回全部记录，或打开任务 Markdown 检查原始引用。', 'Show all records or open the task Markdown to inspect its original references.')
					: ui('调整范围或持久化状态筛选；待审核提案不会被描述为已保存记忆。', 'Change the scope or persistence filter. Pending proposals are not described as saved memory.')
			);
		} else {
			const list = contentEl.createDiv({ cls: 'tracekeeper-observability-list' });
			for (const record of snapshot.records) {
				this.renderMemoryRecord(list, record);
			}
		}

		this.renderPagination(contentEl, snapshot);
	}

	private renderMaintenanceCandidates(container: HTMLElement, snapshot: MemoryInspectorSnapshot): void {
		const candidates = snapshot.maintenanceCandidates ?? [];
		if (candidates.length === 0) return;
		const card = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-warning' });
		card.createEl('strong', {
			text: ui(`${candidates.length} 项记忆生命周期维护建议`, `${candidates.length} memory lifecycle maintenance suggestions`),
		});
		card.createEl('p', {
			text: ui(
				'MemoryRecord 历史不会被删除或改写；建议通过重新验证、后继记录以及 supersedes/contradicts 关系维护当前状态。',
				'MemoryRecord history is never deleted or rewritten. Maintain current state through re-verification, successor records, and supersedes/contradicts relations.'
			),
		});
		const list = card.createEl('ul');
		for (const candidate of candidates.slice(0, 20)) {
			list.createEl('li', { text: `${candidate.paths.join(', ')} · ${candidate.reasons.join(', ')}` });
		}
	}

	private renderIndexStatus(container: HTMLElement, snapshot: MemoryInspectorSnapshot): void {
		if (snapshot.indexState !== 'ready') {
			const warning = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-warning' });
			warning.createEl('strong', {
				text: snapshot.indexState === 'rebuilding'
					? ui('知识索引正在重建', 'Knowledge index is rebuilding')
					: ui('知识索引正在初始化', 'Knowledge index is initializing'),
			});
			warning.createEl('p', {
				text: ui(
					'当前列表可能暂时不完整。等待索引就绪后刷新，不需要重新扫描整个仓库。',
					'The list may be temporarily incomplete. Refresh after the index is ready; no full-Vault rescan is needed here.'
				),
			});
		}
		if (snapshot.readFailures.length > 0) {
			const warning = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-warning' });
			warning.createEl('strong', {
				text: ui(
					`${snapshot.readFailures.length} 个记忆文件读取失败`,
					`${snapshot.readFailures.length} memory files could not be read`
				),
			});
			warning.createEl('p', {
				text: ui(
					'请检查文件权限或 Markdown 是否仍可访问，然后使用“重建知识索引”命令重试。',
					'Check file access, then retry with the Rebuild knowledge index command.'
				),
			});
		}
		if (snapshot.staleRecordCount > 0) {
			const warning = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-warning' });
			warning.createEl('strong', {
				text: ui(
					`${snapshot.staleRecordCount} 条引用缺少持久化证据`,
					`${snapshot.staleRecordCount} references lack persisted evidence`
				),
			});
			warning.createEl('p', {
				text: ui(
					'这些记录来自任务或已写入提案，但目标 Markdown 不存在。打开证据记录核对，不会自动补写。',
					'These references come from tasks or applied proposals whose target Markdown is missing. Open the evidence record to inspect it; Tracekeeper will not recreate it automatically.'
				),
			});
		}
	}

	private renderFilters(container: HTMLElement, snapshot: MemoryInspectorSnapshot): void {
		const filters = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-filters' });
		const summary = filters.createDiv();
		summary.createEl('strong', {
			text: ui(
				`${snapshot.totalItems} 条记录`,
				`${snapshot.totalItems} records`
			),
		});
		summary.createDiv({
			text: `${ui('索引代次', 'Index generation')} ${snapshot.indexGeneration} · ${ui('最后刷新', 'Last refreshed')} ${this.plugin.formatDisplayTime(Date.parse(snapshot.updatedAt))}`,
			cls: 'tracekeeper-view__description',
		});
		summary.createDiv({
			text: ui(
				`生命周期：当前 ${snapshot.lifecycleCounts.current} · 历史 ${snapshot.lifecycleCounts.history} · 冲突 ${snapshot.lifecycleCounts.conflict} · 待审核 ${snapshot.lifecycleCounts.review} · 旧版未标识 ${snapshot.lifecycleCounts.legacy_unkeyed}`,
				`Lifecycle: current ${snapshot.lifecycleCounts.current} · history ${snapshot.lifecycleCounts.history} · conflict ${snapshot.lifecycleCounts.conflict} · review ${snapshot.lifecycleCounts.review} · legacy unkeyed ${snapshot.lifecycleCounts.legacy_unkeyed}`
			),
			cls: 'tracekeeper-view__description',
		});
		summary.createDiv({
			text: ui(
				`项目记忆：不可变条目 ${snapshot.projectMemoryCounts.immutableEntries} · 旧版笔记 ${snapshot.projectMemoryCounts.legacyNotes}。此计数来自当前索引；Recall 只按相关性选择，不能替代完整目录。`,
				`Project memory: ${snapshot.projectMemoryCounts.immutableEntries} immutable entries · ${snapshot.projectMemoryCounts.legacyNotes} legacy notes. These counts come from the current index; Recall selects by relevance and is not a complete catalog.`
			),
			cls: 'tracekeeper-view__description',
		});
		const controls = filters.createDiv({ cls: 'tracekeeper-action-row' });
		const scopeSelect = controls.createEl('select');
		this.addOption(scopeSelect, ui('全部范围', 'All scopes'), 'all', snapshot.scope);
		this.addOption(scopeSelect, ui('全局记忆', 'Global memory'), 'global', snapshot.scope);
		this.addOption(scopeSelect, ui('项目记忆', 'Project memory'), 'project', snapshot.scope);
		scopeSelect.setAttr('aria-label', ui('按记忆范围筛选', 'Filter by memory scope'));
		scopeSelect.addEventListener('change', () => {
			this.query = { ...this.query, page: 1, scope: scopeSelect.value as MemoryScopeFilter };
			void this.refresh();
		});

		const stateSelect = controls.createEl('select');
		this.addOption(stateSelect, ui('全部状态', 'All states'), 'all', snapshot.state);
		this.addOption(stateSelect, ui('已保存', 'Persisted'), 'persisted', snapshot.state);
		this.addOption(stateSelect, ui('待确认', 'Queued'), 'queued', snapshot.state);
		this.addOption(stateSelect, ui('证据缺失', 'Missing evidence'), 'missing', snapshot.state);
		stateSelect.setAttr('aria-label', ui('按持久化状态筛选', 'Filter by persistence state'));
		stateSelect.addEventListener('change', () => {
			this.query = { ...this.query, page: 1, state: stateSelect.value as MemoryStateFilter };
			void this.refresh();
		});

		const lifecycleSelect = controls.createEl('select');
		this.addOption(lifecycleSelect, ui('全部生命周期', 'All lifecycle states'), 'all', snapshot.lifecycle);
		this.addOption(lifecycleSelect, ui('当前', 'Current'), 'current', snapshot.lifecycle);
		this.addOption(lifecycleSelect, ui('历史', 'History'), 'history', snapshot.lifecycle);
		this.addOption(lifecycleSelect, ui('冲突', 'Conflict'), 'conflict', snapshot.lifecycle);
		this.addOption(lifecycleSelect, ui('待审核', 'Review'), 'review', snapshot.lifecycle);
		this.addOption(lifecycleSelect, ui('旧版未标识', 'Legacy unkeyed'), 'legacy_unkeyed', snapshot.lifecycle);
		lifecycleSelect.setAttr('aria-label', ui('按记忆生命周期筛选', 'Filter by memory lifecycle'));
		lifecycleSelect.addEventListener('change', () => {
			this.query = {
				...this.query,
				page: 1,
				lifecycle: lifecycleSelect.value as MemoryLifecycleFilter,
			};
			void this.refresh();
		});
	}

	private addOption(
		select: HTMLSelectElement,
		label: string,
		value: string,
		selected: string
	): void {
		const option = select.createEl('option', { text: label, value });
		option.selected = value === selected;
	}

	private renderMemoryRecord(container: HTMLElement, record: MemoryInspectorRecord): void {
		const item = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-record' });
		const header = item.createDiv({ cls: 'tracekeeper-card__header' });
		const title = header.createDiv();
		title.createEl('strong', { text: record.title || record.path || ui('未命名记忆', 'Untitled memory') });
		title.createDiv({
			text: record.path || ui('目标路径尚未确定', 'Target path is not resolved'),
			cls: 'tracekeeper-observability-record__path',
		});
		header.createSpan({
			text: this.lifecycleStateLabel(record.lifecycleState),
			cls: `tracekeeper-badge ${this.lifecycleStateClass(record.lifecycleState)}`,
		});

		const details = item.createDiv({ cls: 'tracekeeper-detail-grid' });
		this.renderDetail(details, ui('范围', 'Scope'), this.memoryScopeLabel(record.scope, record.project));
		this.renderDetail(details, ui('持久化', 'Persistence'), this.memoryStateDetail(record));
		this.renderDetail(details, ui('有效状态', 'Effective state'), this.lifecycleStateDetail(record));
		this.renderDetail(details, ui('Claim', 'Claim'), record.claimKey || ui('旧版未标识', 'Legacy unkeyed'));
		this.renderDetail(
			details,
			ui('权威来源', 'Authority'),
			record.authority ? memoryInspectorAuthorityLabel(record.authority) : ui('未声明', 'Not declared')
		);
		this.renderDetail(
			details,
			ui('置信度', 'Confidence'),
			record.confidenceLevel
				? memoryInspectorConfidenceLabel(record.confidenceLevel)
				: ui('未声明', 'Not declared')
		);
		this.renderDetail(details, ui('有效期', 'Validity'), this.memoryValidity(record));
		this.renderDetail(details, ui('证据', 'Evidence'), record.evidence.length
			? `${record.evidence.slice(0, 3).join(', ')}${record.evidence.length > 3 ? ` (+${record.evidence.length - 3})` : ''}`
			: ui('无引用', 'No references'));
		this.renderDetail(details, ui('来源', 'Provenance'), record.provenance || ui('未记录', 'Not recorded'));
		if (record.taskId) {
			this.renderDetail(details, ui('任务', 'Task'), record.taskId);
		}
		if (record.summary) {
			item.createEl('p', {
				text: trimText(record.summary, 180),
				cls: 'tracekeeper-view__description',
			});
		}
		const actions = item.createDiv({ cls: 'tracekeeper-action-row' });
		const openButton = actions.createEl('button', {
			text: record.state === 'missing'
				? ui('打开引用证据', 'Open reference evidence')
				: ui('打开 Markdown', 'Open Markdown'),
		});
		openButton.addEventListener('click', () => {
			void this.openMarkdown(record.evidencePath);
		});
	}

	private renderLegacyMigrationStatus(container: HTMLElement, legacyCount: number): void {
		if (legacyCount === 0 && !this.migrationPreview && !this.migrationResult) return;
		const card = container.createDiv({ cls: 'tracekeeper-card tracekeeper-observability-warning' });
		card.setAttr('role', 'region');
		card.setAttr('aria-label', ui('旧版记忆治理', 'Legacy memory governance'));
		card.createEl('strong', { text: ui('旧版记忆 Doctor', 'Legacy memory Doctor') });
		card.createEl('p', {
			text: ui(
				'Doctor 只预览缺少 claim_key 的旧记忆；只有唯一身份建议才可生成审核提案，源笔记不会被改写或删除。',
				'Doctor only previews legacy memory without a claim key. Only a unique identity suggestion can create a review proposal; source notes are never rewritten or deleted.'
			),
		});
		const status = card.createDiv({ cls: 'tracekeeper-view__description' });
		status.setAttr('aria-live', 'polite');
		if (this.migrationPreview) {
			status.setText(ui(
				`候选 ${this.migrationPreview.rows.length} · 可生成 ${this.migrationPreview.executableCount} · 阻塞 ${this.migrationPreview.blockedCount} · 索引 ${memoryInspectorIndexStateLabel(this.migrationPreview.indexState)}`,
				`Candidates ${this.migrationPreview.rows.length} · executable ${this.migrationPreview.executableCount} · blocked ${this.migrationPreview.blockedCount} · index ${memoryInspectorIndexStateLabel(this.migrationPreview.indexState)}`
			));
		} else {
			status.setText(ui('尚未生成预览；不会自动启动迁移。', 'No preview yet; migration never starts automatically.'));
		}
		if (this.migrationResult) {
			card.createEl('p', {
				text: ui(
					`已创建 ${this.migrationResult.createdCount} · 已存在 ${this.migrationResult.alreadyCreatedCount} · 阻塞 ${this.migrationResult.blockedCount} · 失败 ${this.migrationResult.failedCount}`,
					`Created ${this.migrationResult.createdCount} · existing ${this.migrationResult.alreadyCreatedCount} · blocked ${this.migrationResult.blockedCount} · failed ${this.migrationResult.failedCount}`
				),
			});
		}
		const actions = card.createDiv({ cls: 'tracekeeper-action-row' });
		const previewButton = actions.createEl('button', {
			text: ui('预览 Doctor 候选', 'Preview Doctor candidates'),
		});
		previewButton.disabled = this.migrationBusy;
		previewButton.setAttr('aria-label', ui('预览旧版记忆迁移候选', 'Preview legacy memory migration candidates'));
		previewButton.addEventListener('click', () => void this.previewLegacyMigration());
		if (this.migrationPreview?.canApply && this.migrationPreview.executableCount > 0) {
			const applyButton = actions.createEl('button', {
				text: ui('生成审核提案', 'Create review proposals'),
				cls: 'mod-cta',
			});
			applyButton.disabled = this.migrationBusy;
			applyButton.setAttr('aria-label', ui('为唯一建议生成审核提案', 'Create review proposals for unique suggestions'));
			applyButton.addEventListener('click', () => void this.applyLegacyMigration());
		}
	}

	private renderDetail(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: 'tracekeeper-detail' });
		item.createSpan({ text: label });
		item.createEl('strong', { text: value || ui('暂无', 'None') });
	}

	private memoryScopeLabel(scope: MemoryRecordScope, project: string): string {
		if (scope === 'project') {
			return project
				? ui(`项目 · ${project}`, `Project · ${project}`)
				: ui('项目记忆', 'Project memory');
		}
		return ui('全局记忆', 'Global memory');
	}

	private lifecycleStateLabel(state: MemoryLifecycleDisplayState): string {
		switch (state) {
			case 'current': return ui('当前', 'Current');
			case 'history': return ui('历史', 'History');
			case 'conflict': return ui('冲突', 'Conflict');
			case 'review': return ui('待审核', 'Review');
			case 'legacy_unkeyed': return ui('旧版未标识', 'Legacy unkeyed');
		}
	}

	private lifecycleStateDetail(record: MemoryInspectorRecord): string {
		const reasons = record.lifecycleReasons.length > 0
			? ` · ${record.lifecycleReasons.map(memoryInspectorLifecycleReasonLabel).join(ui('、', ', '))}`
			: '';
		return `${memoryInspectorEffectiveStateLabel(record.effectiveState)}${reasons}`;
	}

	private memoryValidity(record: MemoryInspectorRecord): string {
		const range = [record.validFrom, record.validTo].filter(Boolean).join(' → ');
		const verified = record.lastVerifiedAt
			? `${ui('复核', 'verified')} ${record.lastVerifiedAt}`
			: '';
		return [range || ui('未限定', 'Unbounded'), verified].filter(Boolean).join(' · ');
	}

	private memoryStateDetail(record: MemoryInspectorRecord): string {
		switch (record.state) {
			case 'persisted':
				return ui('Markdown 已存在', 'Markdown exists');
			case 'queued':
				return ui(
					`提案：${memoryInspectorProposalStatusLabel(record.status)}`,
					`Proposal: ${memoryInspectorProposalStatusLabel(record.status)}`
				);
			case 'missing':
				return ui('目标 Markdown 不存在', 'Target Markdown is missing');
		}
	}

	private lifecycleStateClass(state: MemoryLifecycleDisplayState): string {
		switch (state) {
			case 'current': return 'tracekeeper-badge--success';
			case 'history': return '';
			case 'conflict': return 'tracekeeper-badge--error';
			case 'review':
			case 'legacy_unkeyed': return 'tracekeeper-badge--warning';
		}
	}

	private async previewLegacyMigration(): Promise<void> {
		this.migrationBusy = true;
		try {
			this.migrationPreview = await this.plugin.previewLegacyMemoryMigration();
			this.migrationResult = null;
		} catch (error) {
			console.error('tracekeeper failed to preview legacy memory migration', error);
			new Notice(ui('旧版记忆预览失败。', 'Failed to preview legacy memory.'));
		} finally {
			this.migrationBusy = false;
			await this.refresh();
		}
	}

	private async applyLegacyMigration(): Promise<void> {
		if (!this.migrationPreview) return;
		this.migrationBusy = true;
		try {
			this.migrationResult = await this.plugin.applyLegacyMemoryMigration(this.migrationPreview);
			this.migrationPreview = await this.plugin.previewLegacyMemoryMigration(this.migrationPreview.migrationId);
			new Notice(ui('旧版记忆审核提案已处理。', 'Legacy memory review proposals processed.'));
		} catch (error) {
			console.error('tracekeeper failed to apply legacy memory migration', error);
			new Notice(ui('预览已过期或提案创建失败，请重新预览。', 'The preview is stale or proposal creation failed. Preview again.'));
		} finally {
			this.migrationBusy = false;
			await this.refresh();
		}
	}

	private renderPagination(container: HTMLElement, snapshot: MemoryInspectorSnapshot): void {
		if (snapshot.totalPages <= 1) {
			return;
		}
		const pagination = container.createDiv({ cls: 'tracekeeper-action-row tracekeeper-observability-pagination' });
		const previous = pagination.createEl('button', { text: ui('上一页', 'Previous') });
		previous.disabled = snapshot.page <= 1;
		previous.addEventListener('click', () => {
			this.query = { ...this.query, page: snapshot.page - 1 };
			void this.refresh();
		});
		pagination.createSpan({
			text: ui(
				`第 ${snapshot.page} / ${snapshot.totalPages} 页`,
				`Page ${snapshot.page} of ${snapshot.totalPages}`
			),
		});
		const next = pagination.createEl('button', { text: ui('下一页', 'Next') });
		next.disabled = snapshot.page >= snapshot.totalPages;
		next.addEventListener('click', () => {
			this.query = { ...this.query, page: snapshot.page + 1 };
			void this.refresh();
		});
	}

	private renderEmptyState(container: HTMLElement, title: string, detail: string): void {
		const empty = container.createDiv({ cls: 'tracekeeper-empty-state' });
		empty.createEl('strong', { text: title });
		empty.createEl('p', { text: detail });
	}

	private async openMarkdown(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(ui('没有找到对应的 Markdown 证据。', 'The related Markdown evidence was not found.'));
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	private async refreshWithNotice(button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		button.setText(ui('刷新中...', 'Refreshing...'));
		try {
			await this.refresh();
			new Notice(ui('记忆记录已刷新。', 'Memory records refreshed.'));
		} catch (error) {
			console.error('tracekeeper failed to refresh memory view', error);
			button.disabled = false;
			button.setText(ui('刷新', 'Refresh'));
			new Notice(ui('刷新记忆记录失败。', 'Failed to refresh memory records.'));
		}
	}

	async refresh(): Promise<void> {
		const snapshot = await this.plugin.loadMemoryInspectorSnapshot(this.query);
		await this.render(snapshot);
	}
}
