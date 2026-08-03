export interface AuditRecentApplicationDependencies<TSection> {
	auditLogPath: string;
	readSections(): Promise<TSection[]>;
}

export class AuditRecentApplicationService<TSection> {
	private readonly dependencies: AuditRecentApplicationDependencies<TSection>;

	constructor(dependencies: AuditRecentApplicationDependencies<TSection>) {
		this.dependencies = dependencies;
	}

	async execute(maxItems: number) {
		const sections = await this.dependencies.readSections();
		return {
			ok: true,
			read_only: true,
			audit_log: sections[0] && typeof sections[0] === 'object' && sections[0] !== null && 'source_path' in sections[0]
				? String((sections[0] as { source_path?: unknown }).source_path || this.dependencies.auditLogPath)
				: this.dependencies.auditLogPath,
			total_sections: sections.length,
			sections: sections.slice(0, maxItems),
		};
	}
}
