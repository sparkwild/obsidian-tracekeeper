"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentActivityRecentApplicationService = void 0;
class AgentActivityRecentApplicationService {
    constructor(dependencies) {
        this.dependencies = dependencies;
    }
    async execute(maxItems) {
        const sections = await this.dependencies.readSections();
        return {
            ok: true,
            read_only: true,
            activity_path: sections[0] && typeof sections[0] === 'object' && sections[0] !== null && 'source_path' in sections[0]
                ? String(sections[0].source_path || this.dependencies.agentActivityPath)
                : this.dependencies.agentActivityPath,
            total_sections: sections.length,
            sections: sections.slice(0, maxItems),
        };
    }
}
exports.AgentActivityRecentApplicationService = AgentActivityRecentApplicationService;
