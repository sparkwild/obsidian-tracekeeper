export interface AuditRecentApplicationDependencies<TSection> {
    auditLogPath: string;
    readSections(): Promise<TSection[]>;
}
export declare class AuditRecentApplicationService<TSection> {
    private readonly dependencies;
    constructor(dependencies: AuditRecentApplicationDependencies<TSection>);
    execute(maxItems: number): Promise<{
        ok: boolean;
        read_only: boolean;
        audit_log: string;
        total_sections: number;
        sections: TSection[];
    }>;
}
