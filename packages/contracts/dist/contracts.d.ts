export type ToolVisibility = 'public' | 'compatibility' | 'internal';
export type ToolRisk = 'read-only' | 'low-risk-write' | 'review-gated-write';
export type ToolEffect = 'read' | 'append' | 'bounded-update' | 'review-gated';
export type ToolIdempotency = 'natural' | 'keyed' | 'none';
export type ToolWorld = 'closed';
export type ToolWorkflowRole = 'observe' | 'recall' | 'task-start' | 'task-finish' | 'review' | 'source' | 'memory';
export type ToolCapability = 'vault.read' | 'vault.write' | 'memory.propose' | 'memory.apply' | 'memory.review' | 'workflow.manage' | 'review-gated.apply';
export interface ToolDeprecation {
    readonly replacement: string;
    readonly removalAfter?: string;
}
export interface ToolOutputSchema {
    readonly type: 'object';
    readonly [key: string]: unknown;
}
export type ToolResultSchema = ToolOutputSchema;
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
    readonly effect: ToolEffect;
    readonly idempotency: ToolIdempotency;
    readonly world: ToolWorld;
    readonly workflowRole: ToolWorkflowRole;
    readonly useCase: string;
    readonly inputSchema: ToolInputSchema;
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly deprecated?: ToolDeprecation;
    readonly description?: string;
}
export type TracekeeperToolName = 'tracekeeper.status' | 'tracekeeper.graph_health' | 'tracekeeper.start_task' | 'tracekeeper.recall' | 'tracekeeper.memory' | 'tracekeeper.project_context' | 'tracekeeper.project_history' | 'tracekeeper.read_note' | 'tracekeeper.review_queue' | 'tracekeeper.list_review_queue' | 'tracekeeper.list_source_requests' | 'tracekeeper.list_approved_writebacks' | 'tracekeeper.agent_activity_recent' | 'tracekeeper.source_request' | 'tracekeeper.analyze_source_request' | 'tracekeeper.apply_approved_writeback' | 'tracekeeper.build_context_pack' | 'tracekeeper.lint' | 'tracekeeper.finish_task' | 'tracekeeper.distill_session' | 'tracekeeper.write_context_pack' | 'tracekeeper.write_session_note' | 'tracekeeper.capture_source' | 'tracekeeper.propose_memory';
export declare const PUBLIC_TOOL_NAME_ORDER: readonly ["tracekeeper.status", "tracekeeper.agent_activity_recent", "tracekeeper.lint", "tracekeeper.recall", "tracekeeper.memory", "tracekeeper.read_note", "tracekeeper.start_task", "tracekeeper.finish_task", "tracekeeper.build_context_pack", "tracekeeper.review_queue", "tracekeeper.apply_approved_writeback", "tracekeeper.source_request", "tracekeeper.capture_source", "tracekeeper.propose_memory"];
type PublicToolName = (typeof PUBLIC_TOOL_NAME_ORDER)[number];
export declare const toolContracts: readonly [{
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.status";
    readonly version: 2;
    readonly visibility: "public";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly effect: "read";
    readonly idempotency: "natural";
    readonly world: "closed";
    readonly workflowRole: "observe";
    readonly useCase: "status";
    readonly description: "[read-only] Quick vault and service summary. Does not read full note content or write files.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly deprecated: {
        readonly replacement: "tracekeeper.lint";
    };
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.graph_health";
    readonly version: 2;
    readonly visibility: "compatibility";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly effect: "read";
    readonly idempotency: "natural";
    readonly world: "closed";
    readonly workflowRole: "observe";
    readonly useCase: "graph_health";
    readonly description: "[deprecated] Use tracekeeper.lint for graph checks. This compatibility tool is read-only.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.start_task";
    readonly version: 4;
    readonly visibility: "public";
    readonly capability: "workflow.manage";
    readonly risk: "low-risk-write";
    readonly effect: "append";
    readonly idempotency: "keyed";
    readonly world: "closed";
    readonly workflowRole: "task-start";
    readonly useCase: "start_task";
    readonly description: "[low-risk write] Begin live task tracking when cross-session continuity, interruption recovery, in-progress visibility, explicit live tracking, or task-linked intermediate writes require a real task identity. Ordinary tracked work can use closeout-only finish_task instead.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.recall";
    readonly version: 4;
    readonly visibility: "public";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly effect: "read";
    readonly idempotency: "natural";
    readonly world: "closed";
    readonly workflowRole: "recall";
    readonly useCase: "recall";
    readonly description: "[read-only] Find relevant memory, Wiki, source, or task-tracking notes in the active local Obsidian Vault before read_note. Supports global, project, project_history, and task_history scopes.";
    readonly inputSchema: {
        readonly allOf: readonly [{
            readonly if: {
                readonly required: readonly ["scope"];
                readonly properties: {
                    readonly scope: {
                        readonly enum: readonly ["project_history", "task_history"];
                    };
                };
            };
            readonly then: {};
            readonly else: {
                readonly required: readonly ["query"];
            };
        }];
        readonly type: "object";
        readonly properties: Record<string, unknown>;
        readonly required?: readonly string[];
        readonly additionalProperties?: boolean;
    };
}, {
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.memory";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly effect: "read";
    readonly idempotency: "natural";
    readonly world: "closed";
    readonly workflowRole: "memory";
    readonly useCase: "memory";
    readonly description: "[read-only] Enumerate the generation-bound global or project memory catalog by current, history, conflicts, or all view. Project scope requires one current Runtime-resolved project_id; unknown ids fail instead of returning an empty catalog. Returns metadata only; use tracekeeper.read_note for full note bodies.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly deprecated: {
        readonly replacement: "tracekeeper.recall with scope=\"project\"";
    };
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.project_context";
    readonly version: 2;
    readonly visibility: "compatibility";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly effect: "read";
    readonly idempotency: "natural";
    readonly world: "closed";
    readonly workflowRole: "recall";
    readonly useCase: "project_context";
    readonly description: "[deprecated] Use tracekeeper.recall with scope=\"project\". Compatibility tool, read-only.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly deprecated: {
        readonly replacement: "tracekeeper.recall with scope=\"project_history\"";
    };
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.project_history";
    readonly version: 2;
    readonly visibility: "compatibility";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly effect: "read";
    readonly idempotency: "natural";
    readonly world: "closed";
    readonly workflowRole: "recall";
    readonly useCase: "project_history";
    readonly description: "[deprecated] Use tracekeeper.recall with scope=\"project_history\". Compatibility tool, read-only.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.read_note";
    readonly version: 2;
    readonly visibility: "public";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly effect: "read";
    readonly idempotency: "natural";
    readonly world: "closed";
    readonly workflowRole: "observe";
    readonly useCase: "read_note";
    readonly description: "[read-only] Read one vault note only after recall excerpts are not enough. Does not write files.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.review_queue";
    readonly version: 2;
    readonly visibility: "public";
    readonly capability: "memory.review";
    readonly risk: "read-only";
    readonly effect: "read";
    readonly idempotency: "natural";
    readonly world: "closed";
    readonly workflowRole: "review";
    readonly useCase: "review_queue";
    readonly description: "[read-only] Inspect pending local Vault proposals or approved writeback candidates. Does not approve or apply changes.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly deprecated: {
        readonly replacement: "tracekeeper.review_queue with action=\"list_pending\"";
    };
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.list_review_queue";
    readonly version: 2;
    readonly visibility: "compatibility";
    readonly capability: "memory.review";
    readonly risk: "read-only";
    readonly effect: "read";
    readonly idempotency: "natural";
    readonly world: "closed";
    readonly workflowRole: "review";
    readonly useCase: "review_queue";
    readonly description: "[deprecated] Use tracekeeper.review_queue with action=\"list_pending\". Compatibility tool, read-only.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly deprecated: {
        readonly replacement: "tracekeeper.source_request with action=\"list\"";
    };
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.list_source_requests";
    readonly version: 2;
    readonly visibility: "compatibility";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly effect: "read";
    readonly idempotency: "natural";
    readonly world: "closed";
    readonly workflowRole: "source";
    readonly useCase: "source_request";
    readonly description: "[deprecated] Use tracekeeper.source_request with action=\"list\". Compatibility tool, read-only.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly deprecated: {
        readonly replacement: "tracekeeper.review_queue with action=\"list_approved\"";
    };
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.list_approved_writebacks";
    readonly version: 2;
    readonly visibility: "compatibility";
    readonly capability: "memory.review";
    readonly risk: "read-only";
    readonly effect: "read";
    readonly idempotency: "natural";
    readonly world: "closed";
    readonly workflowRole: "review";
    readonly useCase: "review_queue";
    readonly description: "[deprecated] Use tracekeeper.review_queue with action=\"list_approved\". Compatibility tool, read-only.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.agent_activity_recent";
    readonly version: 1;
    readonly visibility: "public";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly effect: "read";
    readonly idempotency: "natural";
    readonly world: "closed";
    readonly workflowRole: "observe";
    readonly useCase: "agent_activity_recent";
    readonly description: "[read-only] Read recent MCP Agent activity from daily UTC shards. User interface operations are excluded.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.source_request";
    readonly version: 3;
    readonly visibility: "public";
    readonly capability: "vault.write";
    readonly risk: "low-risk-write";
    readonly effect: "bounded-update";
    readonly idempotency: "none";
    readonly world: "closed";
    readonly workflowRole: "source";
    readonly useCase: "source_request";
    readonly description: "[read-only | low-risk write] List source requests or analyze one existing request. Does not fetch network content.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly deprecated: {
        readonly replacement: "tracekeeper.source_request with action=\"analyze\"";
    };
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.analyze_source_request";
    readonly version: 3;
    readonly visibility: "compatibility";
    readonly capability: "vault.write";
    readonly risk: "low-risk-write";
    readonly effect: "bounded-update";
    readonly idempotency: "none";
    readonly world: "closed";
    readonly workflowRole: "source";
    readonly useCase: "source_request";
    readonly description: "[deprecated] Use tracekeeper.source_request with action=\"analyze\". Compatibility tool, low-risk write.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.apply_approved_writeback";
    readonly version: 2;
    readonly visibility: "public";
    readonly capability: "memory.apply";
    readonly risk: "review-gated-write";
    readonly effect: "review-gated";
    readonly idempotency: "keyed";
    readonly world: "closed";
    readonly workflowRole: "review";
    readonly useCase: "apply_approved_writeback";
    readonly description: "[review-gated apply] Use only after the user approves a Knowledge Change Review proposal. Appends approved content to an existing local Vault target or creates the explicitly approved missing Wiki/MemoryRecord target after a fresh confirmation preview.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.build_context_pack";
    readonly version: 2;
    readonly visibility: "public";
    readonly capability: "workflow.manage";
    readonly risk: "low-risk-write";
    readonly effect: "bounded-update";
    readonly idempotency: "none";
    readonly world: "closed";
    readonly workflowRole: "memory";
    readonly useCase: "build_context_pack";
    readonly description: "[read-only | optional write] Build a compact context pack from recall results. Writes an artifact only when write=true.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.lint";
    readonly version: 3;
    readonly visibility: "public";
    readonly capability: "vault.read";
    readonly risk: "read-only";
    readonly effect: "read";
    readonly idempotency: "natural";
    readonly world: "closed";
    readonly workflowRole: "observe";
    readonly useCase: "lint";
    readonly description: "[read-only] Run the single vault check entry for structure, links, sources, claims, and graph health.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.finish_task";
    readonly version: 6;
    readonly visibility: "public";
    readonly capability: "workflow.manage";
    readonly risk: "low-risk-write";
    readonly effect: "append";
    readonly idempotency: "keyed";
    readonly world: "closed";
    readonly workflowRole: "task-finish";
    readonly useCase: "finish_task";
    readonly description: "[low-risk write] Complete an existing live task or atomically create one closeout-only canonical Markdown task record without creating an implicit session note. A closeout-only call omits task_id and supplies goal, started_at, summary, status, and an explicit idempotency key. If an explicit task_id is known but its start_task record is missing, reconstruct a complete task record under that same identity. Report durable Wiki/Memory output separately. The result includes direct proposals already linked to the task; a captured Source or Recall match does not prove that proposed knowledge was applied.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly task_id: {
                readonly type: "string";
                readonly minLength: 1;
                readonly description: "Task id.";
            };
            readonly goal: {
                readonly type: "string";
                readonly minLength: 1;
                readonly description: "Task goal. Required only when task_id is omitted.";
            };
            readonly started_at: {
                readonly type: "string";
                readonly minLength: 1;
                readonly description: "Client-claimed ISO task start time. Required only when task_id is omitted.";
            };
            readonly recording_reason: {
                readonly type: "string";
                readonly enum: readonly ["ordinary_closeout", "start_unavailable"];
                readonly description: "Closeout-only provenance. Defaults to ordinary_closeout.";
            };
            readonly start_idempotency_key: {
                readonly type: "string";
                readonly minLength: 1;
                readonly description: "Original start_task retry key, allowed only for start_unavailable closeout recovery.";
            };
            readonly summary: {
                readonly type: "string";
                readonly description: "Task summary.";
            };
            readonly status: {
                readonly type: "string";
                readonly enum: readonly ["completed", "partial", "blocked"];
                readonly description: "Final task execution status only; inspect durable_output in the result for Wiki/Memory persistence state.";
            };
            readonly outcomes: {
                readonly oneOf: readonly [{
                    readonly type: "string";
                }, {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                }];
                readonly description: "Optional outcomes.";
            };
            readonly decisions: {
                readonly oneOf: readonly [{
                    readonly type: "string";
                }, {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                }];
                readonly description: "Optional decisions.";
            };
            readonly solution_changes: {
                readonly oneOf: readonly [{
                    readonly type: "string";
                }, {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                }];
                readonly description: "Optional solution changes.";
            };
            readonly lessons: {
                readonly oneOf: readonly [{
                    readonly type: "string";
                }, {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                }];
                readonly description: "Optional lessons learned.";
            };
            readonly preferences: {
                readonly oneOf: readonly [{
                    readonly type: "string";
                }, {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                }];
                readonly description: "Optional user preferences.";
            };
            readonly memory_candidate_records: {
                readonly type: "array";
                readonly description: "Optional structured lifecycle-aware memory candidates.";
                readonly items: {
                    type: string;
                    required: string[];
                    properties: {
                        proposal_kind: {
                            type: string;
                            description: string;
                        };
                        content: {
                            type: string;
                            description: string;
                        };
                        scope: {
                            type: string;
                            enum: string[];
                            description: string;
                        };
                        project_hint: {
                            type: string;
                            description: string;
                        };
                        project_id: {
                            type: string;
                            description: string;
                        };
                        repo_path: {
                            type: string;
                            description: string;
                        };
                        related_wiki: {
                            oneOf: ({
                                type: string;
                                items?: undefined;
                            } | {
                                type: string;
                                items: {
                                    type: string;
                                };
                            })[];
                            description: string;
                        };
                        related_sources: {
                            oneOf: ({
                                type: string;
                                items?: undefined;
                            } | {
                                type: string;
                                items: {
                                    type: string;
                                };
                            })[];
                            description: string;
                        };
                        evidence: {
                            oneOf: ({
                                type: string;
                                items?: undefined;
                            } | {
                                type: string;
                                items: {
                                    type: string;
                                };
                            })[];
                            description: string;
                        };
                        target_note: {
                            type: string;
                            description: string;
                        };
                        claim_key: {
                            type: string;
                            minLength: number;
                            description: string;
                        };
                        proposed_authority: {
                            type: string;
                            enum: string[];
                            description: string;
                        };
                        proposed_confidence: {
                            type: string;
                            enum: string[];
                            description: string;
                        };
                        declared_state: {
                            type: string;
                            enum: string[];
                            description: string;
                        };
                        observed_at: {
                            type: string;
                            minLength: number;
                            description: string;
                        };
                        valid_from: {
                            type: string;
                            minLength: number;
                            description: string;
                        };
                        valid_to: {
                            type: string;
                            minLength: number;
                            description: string;
                        };
                        last_verified_at: {
                            type: string;
                            minLength: number;
                            description: string;
                        };
                        supersedes: {
                            type: string;
                            items: {
                                type: string;
                            };
                            description: string;
                        };
                        contradicts: {
                            type: string;
                            items: {
                                type: string;
                            };
                            description: string;
                        };
                    };
                    additionalProperties: boolean;
                };
            };
            readonly next_actions: {
                readonly oneOf: readonly [{
                    readonly type: "string";
                }, {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                }];
                readonly description: "Optional next actions.";
            };
            readonly client: {
                readonly type: "string";
                readonly description: "Optional client context.";
            };
            readonly project_hint: {
                readonly type: "string";
                readonly description: "Optional canonical project hint; inherited from the started task when omitted and rejected when conflicting.";
            };
            readonly related_wiki: {
                readonly oneOf: readonly [{
                    readonly type: "string";
                }, {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                }];
                readonly description: "Optional verified local Vault Wiki note paths, conventionally under 01_knowledge/wiki/**.";
            };
            readonly related_sources: {
                readonly oneOf: readonly [{
                    readonly type: "string";
                }, {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                }];
                readonly description: "Optional related sources.";
            };
            readonly filename: {
                readonly type: "string";
                readonly description: "Deprecated compatibility input. Accepted for exact retries but does not create or select a separate finish note.";
            };
            readonly project_id: {
                readonly type: "string";
                readonly description: "Optional project id; a value conflicting with the started task identity is rejected.";
            };
            readonly repo_path: {
                readonly type: "string";
                readonly description: "Optional repository path; a value conflicting with the started task identity is rejected.";
            };
            readonly idempotency_key: {
                readonly type: "string";
                readonly minLength: 1;
                readonly description: "Optional stable retry key. Reusing it with different closeout content is rejected.";
            };
        };
        readonly additionalProperties: false;
        readonly required: readonly ["summary", "status"];
        readonly oneOf: readonly [{
            readonly required: readonly ["task_id"];
            readonly not: {
                readonly anyOf: readonly [{
                    readonly required: readonly ["goal"];
                }, {
                    readonly required: readonly ["started_at"];
                }, {
                    readonly required: readonly ["recording_reason"];
                }, {
                    readonly required: readonly ["start_idempotency_key"];
                }];
            };
        }, {
            readonly required: readonly ["goal", "started_at", "idempotency_key"];
            readonly not: {
                readonly required: readonly ["task_id"];
            };
            readonly allOf: readonly [{
                readonly if: {
                    readonly required: readonly ["recording_reason"];
                    readonly properties: {
                        readonly recording_reason: {
                            readonly const: "start_unavailable";
                        };
                    };
                };
                readonly then: {
                    readonly required: readonly ["start_idempotency_key"];
                };
                readonly else: {
                    readonly not: {
                        readonly required: readonly ["start_idempotency_key"];
                    };
                };
            }];
        }];
    };
}, {
    readonly deprecated: {
        readonly replacement: "tracekeeper.finish_task";
    };
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.distill_session";
    readonly version: 2;
    readonly visibility: "compatibility";
    readonly capability: "workflow.manage";
    readonly risk: "low-risk-write";
    readonly effect: "append";
    readonly idempotency: "none";
    readonly world: "closed";
    readonly workflowRole: "task-finish";
    readonly useCase: "finish_task";
    readonly description: "[deprecated] Use tracekeeper.finish_task. Compatibility tool for older session distillation flows.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly deprecated: {
        readonly replacement: "tracekeeper.build_context_pack with write=true";
    };
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.write_context_pack";
    readonly version: 2;
    readonly visibility: "compatibility";
    readonly capability: "workflow.manage";
    readonly risk: "low-risk-write";
    readonly effect: "bounded-update";
    readonly idempotency: "none";
    readonly world: "closed";
    readonly workflowRole: "memory";
    readonly useCase: "build_context_pack";
    readonly description: "[deprecated] Use tracekeeper.build_context_pack with write=true. Compatibility tool, low-risk write.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly deprecated: {
        readonly replacement: "tracekeeper.finish_task";
    };
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.write_session_note";
    readonly version: 2;
    readonly visibility: "compatibility";
    readonly capability: "workflow.manage";
    readonly risk: "low-risk-write";
    readonly effect: "bounded-update";
    readonly idempotency: "none";
    readonly world: "closed";
    readonly workflowRole: "task-finish";
    readonly useCase: "finish_task";
    readonly description: "[deprecated] Use tracekeeper.finish_task. Compatibility tool, low-risk write.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.capture_source";
    readonly version: 4;
    readonly visibility: "public";
    readonly capability: "vault.write";
    readonly risk: "low-risk-write";
    readonly effect: "bounded-update";
    readonly idempotency: "keyed";
    readonly world: "closed";
    readonly workflowRole: "source";
    readonly useCase: "capture_source";
    readonly description: "[low-risk write] Save user-provided source evidence under Sources. Does not fetch external content and does not apply a Wiki or Memory proposal; a captured Source remains readable provenance, not proof that synthesized knowledge was persisted.";
    readonly inputSchema: ToolInputSchema;
}, {
    readonly outputSchema: ToolOutputSchema;
    readonly resultSchema: ToolOutputSchema;
    readonly name: "tracekeeper.propose_memory";
    readonly version: 4;
    readonly visibility: "public";
    readonly capability: "memory.propose";
    readonly risk: "low-risk-write";
    readonly effect: "bounded-update";
    readonly idempotency: "keyed";
    readonly world: "closed";
    readonly workflowRole: "memory";
    readonly useCase: "propose_memory";
    readonly description: "[low-risk write] Submit a reviewable Memory or Wiki update to the active local Obsidian Vault through Tracekeeper rules. This does not write to an external Wiki service. When auto_applied is false, the proposal is not persisted knowledge until governed apply completes.";
    readonly inputSchema: {
        readonly allOf: readonly [{
            readonly if: {
                readonly required: readonly ["target_note"];
                readonly properties: {
                    readonly target_note: {
                        readonly type: "string";
                        readonly pattern: "^01_knowledge/wiki(?:/|$)";
                    };
                };
            };
            readonly then: {};
            readonly else: {
                readonly required: readonly ["memory_scope"];
            };
        }];
        readonly type: "object";
        readonly properties: Record<string, unknown>;
        readonly required?: readonly string[];
        readonly additionalProperties?: boolean;
    };
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
