export interface AgentActivityRecentApplicationDependencies<TSection> {
    agentActivityPath: string;
    readSections(): Promise<TSection[]>;
}
export declare class AgentActivityRecentApplicationService<TSection> {
    private readonly dependencies;
    constructor(dependencies: AgentActivityRecentApplicationDependencies<TSection>);
    execute(maxItems: number): Promise<{
        ok: boolean;
        read_only: boolean;
        activity_path: string;
        total_sections: number;
        sections: TSection[];
    }>;
}
