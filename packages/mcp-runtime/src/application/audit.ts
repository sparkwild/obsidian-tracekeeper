export interface AgentActivityRecentApplicationDependencies<TSection> {
	agentActivityPath: string;
	readSections(): Promise<TSection[]>;
}

export class AgentActivityRecentApplicationService<TSection> {
	private readonly dependencies: AgentActivityRecentApplicationDependencies<TSection>;

	constructor(dependencies: AgentActivityRecentApplicationDependencies<TSection>) {
		this.dependencies = dependencies;
	}

	async execute(maxItems: number) {
		const sections = await this.dependencies.readSections();
		return {
			ok: true,
			read_only: true,
			activity_path: sections[0] && typeof sections[0] === 'object' && sections[0] !== null && 'source_path' in sections[0]
				? String((sections[0] as { source_path?: unknown }).source_path || this.dependencies.agentActivityPath)
				: this.dependencies.agentActivityPath,
			total_sections: sections.length,
			sections: sections.slice(0, maxItems),
		};
	}
}
