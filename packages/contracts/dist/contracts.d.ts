export type ToolVisibility = 'public' | 'compatibility' | 'internal';
export type ToolRisk = 'read-only' | 'low-risk-write' | 'review-gated-write';
export type ToolCapability = 'vault.read' | 'vault.write' | 'memory.propose' | 'memory.apply' | 'memory.review' | 'workflow.manage' | 'review-gated.apply';
export interface ToolDeprecation {
    readonly replacement: string;
    readonly removalAfter?: string;
}
export interface ToolResultSchema {
    readonly type: string;
    readonly [key: string]: unknown;
}
export type ToolInputSchema = Record<string, unknown> & {
    readonly type: 'object';
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
    readonly additionalProperties?: boolean;
};
export interface ToolContract<Name extends string = string> {
    readonly name: Name;
    readonly version: number;
    readonly visibility: ToolVisibility;
    readonly capability: ToolCapability;
    readonly risk: ToolRisk;
    readonly useCase: string;
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
    readonly deprecated?: ToolDeprecation;
    readonly description?: string;
}
export type TracekeeperToolName = 'tracekeeper.status' | 'tracekeeper.graph_health' | 'tracekeeper.start_task' | 'tracekeeper.recall' | 'tracekeeper.project_context' | 'tracekeeper.project_history' | 'tracekeeper.read_note' | 'tracekeeper.review_queue' | 'tracekeeper.list_review_queue' | 'tracekeeper.list_source_requests' | 'tracekeeper.list_approved_writebacks' | 'tracekeeper.audit_recent' | 'tracekeeper.source_request' | 'tracekeeper.analyze_source_request' | 'tracekeeper.apply_approved_writeback' | 'tracekeeper.build_context_pack' | 'tracekeeper.lint' | 'tracekeeper.finish_task' | 'tracekeeper.distill_session' | 'tracekeeper.write_context_pack' | 'tracekeeper.write_session_note' | 'tracekeeper.capture_source' | 'tracekeeper.propose_memory';
export declare const PUBLIC_TOOL_NAME_ORDER: readonly ["tracekeeper.status", "tracekeeper.lint", "tracekeeper.recall", "tracekeeper.read_note", "tracekeeper.start_task", "tracekeeper.finish_task", "tracekeeper.build_context_pack", "tracekeeper.review_queue", "tracekeeper.apply_approved_writeback", "tracekeeper.source_request", "tracekeeper.capture_source", "tracekeeper.propose_memory"];
type PublicToolName = (typeof PUBLIC_TOOL_NAME_ORDER)[number];
export declare const toolContracts: readonly [{
    readonly name: "tracekeeper.status";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly useCase: "status";
    readonly description: "[read-only] Quick vault and service summary. Does not read full note content or write files.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
}, {
    readonly name: "tracekeeper.graph_health";
    readonly version: 1;
    readonly visibility: "compatibility";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly useCase: "graph_health";
    readonly description: "[deprecated] Use tracekeeper.lint for graph checks. This compatibility tool is read-only.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
    readonly deprecated: {
        readonly replacement: "tracekeeper.lint";
    };
}, {
    readonly name: "tracekeeper.start_task";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "workflow.manage";
    readonly risk: "low-risk-write";
    readonly useCase: "start_task";
    readonly description: "[low-risk write] Call once when starting meaningful work. Records a bounded task and returns the recommended recall step.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
}, {
    readonly name: "tracekeeper.recall";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly useCase: "recall";
    readonly description: "[read-only] Use before read_note to find relevant memory, wiki, and source notes. Supports global, project, and project_history scopes.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
}, {
    readonly name: "tracekeeper.project_context";
    readonly version: 1;
    readonly visibility: "compatibility";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly useCase: "project_context";
    readonly description: "[deprecated] Use tracekeeper.recall with scope=\"project\". Compatibility tool, read-only.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
    readonly deprecated: {
        readonly replacement: "tracekeeper.recall with scope=\"project\"";
    };
}, {
    readonly name: "tracekeeper.project_history";
    readonly version: 1;
    readonly visibility: "compatibility";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly useCase: "project_history";
    readonly description: "[deprecated] Use tracekeeper.recall with scope=\"project_history\". Compatibility tool, read-only.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
    readonly deprecated: {
        readonly replacement: "tracekeeper.recall with scope=\"project_history\"";
    };
}, {
    readonly name: "tracekeeper.read_note";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly useCase: "read_note";
    readonly description: "[read-only] Read one vault note only after recall excerpts are not enough. Does not write files.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
}, {
    readonly name: "tracekeeper.review_queue";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "memory.review";
    readonly risk: "read-only";
    readonly useCase: "review_queue";
    readonly description: "[read-only] Inspect pending proposals or approved writeback candidates. Does not approve or apply changes.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
}, {
    readonly name: "tracekeeper.list_review_queue";
    readonly version: 1;
    readonly visibility: "compatibility";
    readonly capability: "memory.review";
    readonly risk: "read-only";
    readonly useCase: "review_queue";
    readonly description: "[deprecated] Use tracekeeper.review_queue with action=\"list_pending\". Compatibility tool, read-only.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
    readonly deprecated: {
        readonly replacement: "tracekeeper.review_queue with action=\"list_pending\"";
    };
}, {
    readonly name: "tracekeeper.list_source_requests";
    readonly version: 1;
    readonly visibility: "compatibility";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly useCase: "source_request";
    readonly description: "[deprecated] Use tracekeeper.source_request with action=\"list\". Compatibility tool, read-only.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
    readonly deprecated: {
        readonly replacement: "tracekeeper.source_request with action=\"list\"";
    };
}, {
    readonly name: "tracekeeper.list_approved_writebacks";
    readonly version: 1;
    readonly visibility: "compatibility";
    readonly capability: "memory.review";
    readonly risk: "read-only";
    readonly useCase: "review_queue";
    readonly description: "[deprecated] Use tracekeeper.review_queue with action=\"list_approved\". Compatibility tool, read-only.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
    readonly deprecated: {
        readonly replacement: "tracekeeper.review_queue with action=\"list_approved\"";
    };
}, {
    readonly name: "tracekeeper.audit_recent";
    readonly version: 1;
    readonly visibility: "compatibility";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly useCase: "audit_recent";
    readonly description: "[deprecated] Prefer the Obsidian runtime log view. Compatibility tool, read-only.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
    readonly deprecated: {
        readonly replacement: "Obsidian runtime log view";
    };
}, {
    readonly name: "tracekeeper.source_request";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "vault.write";
    readonly risk: "low-risk-write";
    readonly useCase: "source_request";
    readonly description: "[read-only | low-risk write] List source requests or analyze one existing request. Does not fetch network content.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
}, {
    readonly name: "tracekeeper.analyze_source_request";
    readonly version: 1;
    readonly visibility: "compatibility";
    readonly capability: "vault.write";
    readonly risk: "low-risk-write";
    readonly useCase: "source_request";
    readonly description: "[deprecated] Use tracekeeper.source_request with action=\"analyze\". Compatibility tool, low-risk write.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
    readonly deprecated: {
        readonly replacement: "tracekeeper.source_request with action=\"analyze\"";
    };
}, {
    readonly name: "tracekeeper.apply_approved_writeback";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "memory.apply";
    readonly risk: "review-gated-write";
    readonly useCase: "apply_approved_writeback";
    readonly description: "[review-gated apply] Use only after the user approves a Review Queue proposal. Appends approved content to the target note.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
}, {
    readonly name: "tracekeeper.build_context_pack";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "workflow.manage";
    readonly risk: "low-risk-write";
    readonly useCase: "build_context_pack";
    readonly description: "[read-only | optional write] Build a compact context pack from recall results. Writes an artifact only when write=true.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
}, {
    readonly name: "tracekeeper.lint";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly useCase: "lint";
    readonly description: "[read-only] Run the single vault check entry for structure, links, sources, claims, and graph health.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
}, {
    readonly name: "tracekeeper.finish_task";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "workflow.manage";
    readonly risk: "low-risk-write";
    readonly useCase: "finish_task";
    readonly description: "[low-risk write] Required once at task closeout. Record the session and submit durable decisions, solution changes, lessons, preferences, next actions, and memory candidates according to memory rules.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
}, {
    readonly name: "tracekeeper.distill_session";
    readonly version: 1;
    readonly visibility: "compatibility";
    readonly capability: "workflow.manage";
    readonly risk: "low-risk-write";
    readonly useCase: "finish_task";
    readonly description: "[deprecated] Use tracekeeper.finish_task. Compatibility tool for older session distillation flows.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
    readonly deprecated: {
        readonly replacement: "tracekeeper.finish_task";
    };
}, {
    readonly name: "tracekeeper.write_context_pack";
    readonly version: 1;
    readonly visibility: "compatibility";
    readonly capability: "workflow.manage";
    readonly risk: "low-risk-write";
    readonly useCase: "build_context_pack";
    readonly description: "[deprecated] Use tracekeeper.build_context_pack with write=true. Compatibility tool, low-risk write.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
    readonly deprecated: {
        readonly replacement: "tracekeeper.build_context_pack with write=true";
    };
}, {
    readonly name: "tracekeeper.write_session_note";
    readonly version: 1;
    readonly visibility: "compatibility";
    readonly capability: "workflow.manage";
    readonly risk: "low-risk-write";
    readonly useCase: "finish_task";
    readonly description: "[deprecated] Use tracekeeper.finish_task. Compatibility tool, low-risk write.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
    readonly deprecated: {
        readonly replacement: "tracekeeper.finish_task";
    };
}, {
    readonly name: "tracekeeper.capture_source";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "vault.write";
    readonly risk: "low-risk-write";
    readonly useCase: "capture_source";
    readonly description: "[low-risk write] Save user-provided source metadata or content under sources. Does not fetch external content.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
}, {
    readonly name: "tracekeeper.propose_memory";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "memory.propose";
    readonly risk: "low-risk-write";
    readonly useCase: "propose_memory";
    readonly description: "[low-risk write] Submit a memory update through Tracekeeper rules. Global memory stays review-gated by default.";
    readonly inputSchema: ToolInputSchema;
    readonly resultSchema: ToolResultSchema;
}];
type ContractByName = {
    readonly [K in TracekeeperToolName]: ToolContract<K>;
};
export declare const compatibilityToolNames: TracekeeperToolName[];
export declare function isPublicTool(name: string): name is PublicToolName;
export declare function isCompatibilityTool(name: string): name is Exclude<TracekeeperToolName, PublicToolName>;
export declare function getContractByName(name: string): ToolContract<TracekeeperToolName> | undefined;
export declare function getContractNamesByVisibility(visibility: ToolVisibility): TracekeeperToolName[];
export declare const publicContracts: readonly ToolContract<TracekeeperToolName>[];
export { type ContractByName };
