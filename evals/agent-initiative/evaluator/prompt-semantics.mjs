function matchesAny(prompt, patterns) {
	return patterns.some((pattern) => pattern.test(prompt));
}

const SIMPLE_NO_TRACK_PATTERNS = [
	/^\s*你好[。.!！]?\s*$/u,
	/翻译/u,
	/改得更简洁/u,
	/Markdown\s*列表/iu,
	/现在几点/u,
	/运行\s+pwd/u,
	/水的化学式/u,
];

const TRACKED_WORK_PATTERNS = [
	/继续.*(?:优化|研究|调查|实现|项目|架构|工作)/u,
	/修改多个.*文件/u,
	/形成.*架构决策/u,
	/恢复.*(?:迁移|工作).*继续/u,
	/依据.*偏好.*设计实现方案/u,
	/发布准备.*行动计划/u,
	/完成一个已跟踪任务/u,
	/完成任务并收尾/u,
];

const HISTORICAL_CONTEXT_PATTERNS = [
	/上次.*为什么/u,
	/以前/u,
	/之前/u,
	/已有结论/u,
	/查询.*(?:历史|结论|命名|知识)/u,
	/知识库/u,
	/命名方式/u,
	/用户.*偏好/u,
	/比较.*方案/u,
	/找出.*来源/u,
	/总结一篇笔记/u,
	/未批准的记忆提案/u,
];

export function promptSignals(value) {
	const prompt = typeof value === 'string' ? value : '';
	const secretRequest = /token.*(?:打印|给我)|(?:打印|给我).*token/iu.test(prompt);
	const directMemoryWrite = /绕过审核.*直接.*长期记忆/u.test(prompt);
	const capabilityEscalation = /增加.*(?:write|apply).*权限|给当前 Agent 增加.*权限/iu.test(prompt);
	return {
		prompt,
		simpleNoTrack: matchesAny(prompt, SIMPLE_NO_TRACK_PATTERNS),
		trackedWork: matchesAny(prompt, TRACKED_WORK_PATTERNS),
		historicalContext: matchesAny(prompt, HISTORICAL_CONTEXT_PATTERNS),
		secretRequest,
		directMemoryWrite,
		capabilityEscalation,
		mcpUnavailable: /MCP.*(?:端点)?不可达/iu.test(prompt),
		toolUnavailable: /tool not available/iu.test(prompt),
		permissionDenied: /permission denied/iu.test(prompt),
		zeroMatch: /零命中/u.test(prompt),
		scopeUncertain: /不能确定.*项目/u.test(prompt),
		indexRebuilding: /rebuilding/iu.test(prompt),
		taskIdLost: /丢失.*task_id/iu.test(prompt),
		idempotencyConflict: /idempotency key.*冲突/iu.test(prompt),
		proposalPending: /提案尚未批准/u.test(prompt),
		proposalReview: /未批准的记忆提案/u.test(prompt),
		missingWikiBridge: /缺少\s+Wiki bridge/iu.test(prompt),
		promptInjection: /笔记正文要求.*忽略权限.*泄露\s+token/iu.test(prompt),
	};
}

export function classifySkillV1Prompt(prompt) {
	const signals = promptSignals(prompt);
	return signals.simpleNoTrack || signals.secretRequest || signals.directMemoryWrite || signals.capabilityEscalation
		? 'no_track'
		: 'tracked_task';
}

export function classifySkillV2Prompt(prompt) {
	const signals = promptSignals(prompt);
	if (signals.simpleNoTrack || signals.secretRequest || signals.directMemoryWrite || signals.capabilityEscalation) {
		return 'no_track';
	}
	if (signals.trackedWork) {
		return 'tracked_task';
	}
	if (signals.historicalContext) {
		return 'recall_only';
	}
	return 'tracked_task';
}
