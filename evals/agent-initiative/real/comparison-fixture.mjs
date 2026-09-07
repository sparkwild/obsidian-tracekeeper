import fs from 'node:fs/promises';
import path from 'node:path';

export const COMPARISON_SCENARIOS = Object.freeze([
	{ id: 'no-track', prompt: '把“本地优先”翻译为英文，只返回译文。' },
	{ id: 'recall-tail', prompt: '使用 Tracekeeper 查找 Tailmarker 的保留期限，并给出依据路径。' },
	{ id: 'read-windows', prompt: '请通过 Tracekeeper read_note 阅读 01_knowledge/wiki/concepts/long.md 的完整内容，报告 Headmarker 与 Tailmarker 的值。需要确认首尾两处。' },
	{ id: 'changed-note', prompt: '通过 Tracekeeper read_note 阅读 01_knowledge/wiki/concepts/long.md 的完整当前版本，报告 Revision、Headmarker、Tailmarker 三个值；读取中如果版本变化，请重新读取，避免混用。' },
	{ id: 'memory-pages', prompt: '使用 Tracekeeper 枚举全局记忆，每页一条，读取所有页面后报告总数和路径。然后检查 lint；如果存在可请求的维护候选，为其中一个提交维护审核请求。' },
	{ id: 'auto-closeout', prompt: '使用 Tracekeeper 跟踪并完成这个任务：将“我偏好简体中文回复”记为一条全局 MemoryRecord，claim_key 使用 preference:response-language。按当前 Auto 策略直接提出一次记忆，再结束任务；报告任务状态和持久化结果。' },
]);

export function longNote(revision = 1) {
	return `---\ntype: wiki_concept\ntitle: Long policy\n---\n# Long policy\nRevision: ${revision}\nHeadmarker: ${revision === 1 ? 'amber' : 'blue'}\n`
		+ Array.from({ length: 2800 }, (_, index) => `word${index} `).join('')
		+ `\nTailmarker: ${revision === 1 ? '30' : '60'} days.\n`;
}

export async function createComparisonFixture(vaultRoot, scenarioId) {
	const notes = {
		'01_knowledge/memory/global/index.md': '# Global memory\n',
		'01_knowledge/memory/global/a.md': '# Memory A\nA durable fixture preference.\n',
		'01_knowledge/memory/global/b.md': '# Memory B\nAnother durable fixture preference.\n',
		'01_knowledge/sources/files/unassociated.md': '---\ntype: source_capture\n---\n# Unassociated Source\nSynthetic source evidence.\n',
		'01_knowledge/wiki/concepts/long.md': longNote(),
	};
	if (scenarioId === 'recall-tail') {
		for (let index = 0; index < 40; index++) notes[`01_knowledge/wiki/concepts/distractor-${index}.md`] = `# Unrelated ${index}\nTailmarker is mentioned without a retention decision.\n`;
	}
	for (const [relative, text] of Object.entries(notes)) {
		const target = path.join(vaultRoot, relative);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, text);
	}
}

export function assessComparison(scenarioId, calls, message) {
	const byTool = (name) => calls.filter((call) => call.tool === `tracekeeper.${name}`);
	const successful = (name) => byTool(name).filter((call) => call.result?.ok === true);
	const finish = successful('finish_task');
	const forbiddenWrites = calls.filter((call) => !['tracekeeper.recall', 'tracekeeper.memory', 'tracekeeper.read_note', 'tracekeeper.lint'].includes(call.tool));
	const checks = {};
	if (scenarioId === 'no-track') checks.no_tools = calls.length === 0;
	if (scenarioId === 'recall-tail') {
		checks.recall_used = successful('recall').length > 0;
		checks.correct_evidence = /30/.test(message) && /long\.md/.test(message);
		checks.read_only = forbiddenWrites.length === 0;
	}
	if (scenarioId === 'read-windows' || scenarioId === 'changed-note') {
		const reads = successful('read_note');
		checks.read_used = reads.length > 0;
		checks.correct_values = scenarioId === 'changed-note'
			? /blue/i.test(message) && /60/.test(message) && !/amber/.test(message)
			: /amber/i.test(message) && /30/.test(message);
		checks.read_only = forbiddenWrites.length === 0;
		checks.hash_bound_continuation = reads.filter((call) => Number(call.arguments?.offset) > 0).every((call) => Boolean(call.arguments.expected_hash));
		if (scenarioId === 'changed-note') checks.change_observed = byTool('read_note').some((call) => call.result?.error_detail?.code === 'NOTE_CHANGED');
	}
	if (scenarioId === 'memory-pages') {
		const pages = successful('memory');
		checks.all_memory_pages = new Set(pages.flatMap((call) => (call.result.entries ?? []).map((entry) => entry.path))).size === 2;
		checks.maintenance_requested = successful('request_maintenance').length === 1;
	}
	if (scenarioId === 'auto-closeout') {
		checks.one_proposal = byTool('propose_memory').length === 1;
		checks.one_finish = finish.length === 1;
		checks.durable_receipt = finish[0]?.result?.durable_output?.applied_count === 1;
	}
	return { passed: Object.values(checks).every(Boolean), checks };
}
