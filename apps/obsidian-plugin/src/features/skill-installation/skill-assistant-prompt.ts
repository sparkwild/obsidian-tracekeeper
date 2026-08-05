import type { ClientSkillDirectoryRecommendation } from '../../adapters/client-skill-target-registry';

export interface AiSkillAssistantContext {
	clientId: string;
	displayName: string;
	sourceDirectory: string;
	skillVersion: string;
	bundleHash: string;
	recommendation: ClientSkillDirectoryRecommendation | null;
	prompt: string;
}

export function buildAiSkillAssistantPrompt(input: Omit<AiSkillAssistantContext, 'prompt'>): AiSkillAssistantContext {
	const recommendation = input.recommendation
		? `\nTracekeeper 建议位置（仅供确认，不会自动写入）：${input.recommendation.skillsRootDirectory}\n官方依据：${input.recommendation.documentationUrl}`
		: '';
	const prompt = [
		`请帮我把 Tracekeeper Skill 安装到 ${input.displayName}。`,
		'',
		`可信本地源目录：${input.sourceDirectory}`,
		`Skill 版本：${input.skillVersion}`,
		`bundle 哈希：${input.bundleHash}`,
		recommendation,
		'',
		'请严格遵循以下要求：',
		'1. 只使用上面给出的本地源目录，不从网络下载或替换其他版本。',
		'2. 优先遵循当前客户端官方 Skill 安装方式；如果无法确认官方目录，先询问我，不要猜测路径。',
		'3. 默认使用用户级作用域；如果客户端只支持项目级作用域，先说明差异并等待确认。',
		'4. 操作前展示最终目标绝对路径，并取得我的确认。',
		'5. 不修改源目录。目标已存在时先比较内容并等待确认，不要直接覆盖。',
		'6. 安装后核对 SKILL.md、manifest.json、版本和 bundle 哈希。',
		'7. 返回最终安装目录；如果无法访问文件或完成验证，不要宣称安装成功。',
	].filter((line) => line !== '').join('\n');
	return { ...input, prompt };
}
