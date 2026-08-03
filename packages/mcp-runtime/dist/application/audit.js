"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditRecentApplicationService = void 0;
class AuditRecentApplicationService {
    constructor(dependencies) {
        this.dependencies = dependencies;
    }
    async execute(maxItems) {
        const sections = await this.dependencies.readSections();
        return {
            ok: true,
            read_only: true,
            audit_log: sections[0] && typeof sections[0] === 'object' && sections[0] !== null && 'source_path' in sections[0]
                ? String(sections[0].source_path || this.dependencies.auditLogPath)
                : this.dependencies.auditLogPath,
            total_sections: sections.length,
            sections: sections.slice(0, maxItems),
        };
    }
}
exports.AuditRecentApplicationService = AuditRecentApplicationService;
