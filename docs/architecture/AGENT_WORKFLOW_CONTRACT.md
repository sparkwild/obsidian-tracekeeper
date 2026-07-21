# Agent Workflow Contract

This is the single normative behavior source for Agents that use Tracekeeper. Companion Skills, MCP prompts, tool descriptions, onboarding copy, and client-specific instructions should be concise adaptations of this contract rather than independent specifications.

## Responsibility Split

| Layer | Decides or enforces |
| --- | --- |
| Companion Skill | When the Agent should start a Tracekeeper task, recall context, read deeper, and submit a closeout |
| MCP runtime | Which capabilities exist, input validation, vault scope, write allowlists, review gates, and structured next actions |
| Obsidian plugin | Runtime lifecycle, connection setup, user policy, visible status, review, and confirmed configuration changes |
| User | Which Agents connect and which durable knowledge changes are accepted |

A Skill improves initiative because it runs as Agent-side operating guidance. It does not make the MCP server more permissive. MCP remains the capability and enforcement boundary.

## When To Invoke Tracekeeper

Use Tracekeeper proactively when a task is meaningful enough to benefit from continuity, including when it:

- concerns a known project, repository, client, or recurring topic;
- depends on earlier decisions, conventions, preferences, or lessons;
- has multiple steps or is likely to continue in another session;
- produces decisions, solution changes, reusable lessons, preferences, or next actions.

Do not create task noise for greetings, simple transformations, one-off factual questions, or work that has no useful relationship to the user's vault.

## Golden Workflow

1. Call `tracekeeper.start_task` once with a concise `goal` and the best available `project_hint`.
2. Preserve the returned `task_id` and follow `recommended_recall` or `next_actions_for_agent`.
3. Call `tracekeeper.recall` before reading individual notes.
4. Use the narrowest reliable scope and hints.
5. Read returned excerpts, match reasons, and graph links first; call `tracekeeper.read_note` only when those are insufficient.
6. Perform the user's work. Use other Tracekeeper tools only when the workflow requires them.
7. Call `tracekeeper.finish_task` once with the `task_id`, a useful summary, outcomes, next actions, and any durable closeout fields.
8. Report whether memory was recorded, auto-saved, queued for review, ignored, or requires user action.

If a call returns a structured recommended next action, prefer it over guessing another tool.

## Recall Policy

Choose recall scope intentionally:

- `project`: focused context for a known project and query;
- `project_history`: project notes plus linked prior tasks and sessions for cross-session continuity;
- `global`: intentionally cross-project knowledge, preferences, or topics.

Pass the same stable hints across start, recall, and finish whenever possible:

- `project_hint`
- `project_id`
- `repo_path`, `repo`, or `project_path`

If recall reports uncertainty, inspect candidates and narrow the next call. Do not load all project memory as a default fallback. Full-note reads are a second step, not the discovery mechanism.

## Closeout Policy

`tracekeeper.finish_task` always requires `task_id` and `summary`. Include `outcomes` and `next_actions` when present. Submit only durable, specific information in these fields:

- `decisions`
- `solution_changes`
- `lessons`
- `preferences`
- `memory_candidates`

Avoid generic statements, duplicated chat summaries, speculative conclusions, secrets, and transient debugging output.

For project memory, provide `project_hint` and `related_wiki` when the relevant topic page is known. The Wiki bridge prevents a separate, disconnected memory silo.

Choose `review_proposal_mode` deliberately:

- `auto_propose`: follow the user's configured memory rules; this is the default.
- `review_queue`: force closeout candidates into human review.
- `off`: keep the task/session trace but do not create memory candidates.
- `suggest`: compatibility mode that returns suggestions without creating review files.

An Agent must not describe a proposal as durable memory until the returned closeout status confirms auto-save or an approved proposal has actually been applied.

## Review Boundary

Review Queue entries are candidates. Approval and application are separate states.

- `tracekeeper.review_queue` inspects pending or approved proposals and is read-only.
- The user reviews or changes proposal state in Obsidian.
- `tracekeeper.apply_approved_writeback` can append content only after approval.

Agents must not bypass this boundary, invent approval, write arbitrary durable paths, or edit protected global memory through another tool. The only automatic durable path is the user-controlled append-only project memory rule.

## Public Tool Surface

| Tool | Intended use | Capability class |
| --- | --- | --- |
| `tracekeeper.status` | Check runtime and policy state | Read-only |
| `tracekeeper.lint` | Check structure, links, sources, bridges, and graph health | Read-only |
| `tracekeeper.recall` | Find scoped memory, Wiki, source, task, and session context | Read-only |
| `tracekeeper.read_note` | Read one full vault note after recall | Read-only |
| `tracekeeper.start_task` | Record a bounded meaningful task | Low-risk write |
| `tracekeeper.finish_task` | Record session closeout and route memory candidates | Low-risk write |
| `tracekeeper.build_context_pack` | Build compact context; optionally persist a bounded artifact | Read / optional bounded write |
| `tracekeeper.review_queue` | Inspect proposal state | Read-only |
| `tracekeeper.apply_approved_writeback` | Apply an already approved proposal | Review-gated write |
| `tracekeeper.source_request` | List or analyze a bounded source request | Bounded workflow |
| `tracekeeper.capture_source` | Store a source record in the knowledge source area | Low-risk write |
| `tracekeeper.propose_memory` | Create a memory candidate under configured rules | Low-risk write |

Compatibility tools such as `project_context`, `project_history`, `list_review_queue`, `write_session_note`, and `distill_session` are not public workflow choices. Use the public replacements above.

## Skill Packaging Requirements

A companion Tracekeeper Skill should:

- detect the meaningful-task triggers above;
- teach the golden workflow and narrow recall policy;
- reuse the server's returned `task_id`, closeout contract, statuses, and next actions;
- remain short enough to be active Agent guidance rather than a copy of every tool schema;
- include thin client adapters only where installation or invocation differs;
- declare the MCP connection as a dependency and fail clearly when it is unavailable;
- never store the local MCP token in examples, logs, or durable memory;
- never claim installation or connection success without verification.

The Skill should not duplicate permission logic, vault paths, or tool implementations. Those remain server and architecture responsibilities.

## Contract Synchronization

Changes to start/recall/finish behavior require reviewing all four projections:

1. this contract;
2. MCP tool descriptions and returned next actions;
3. companion Skill guidance;
4. plugin onboarding and capability copy.

The long-term implementation should generate or validate these projections from one structured contract so wording may adapt per client without semantic drift.
