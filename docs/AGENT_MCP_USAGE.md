# Agent MCP Usage

This guide is for AI agents that connect to Tracekeeper through MCP.

Tracekeeper is local-vault first. Agents may read scoped context, record bounded working notes, and create Review Queue proposals. Agents must not treat MCP access as permission to write durable long-term memory directly.

## Task Start

1. Call `tracekeeper.start_task` with the current goal.
2. Include `project_hint` when the project is known.
3. Keep the returned `task_id` and reuse it for later context, closeout, and proposal calls.

## Project-Scoped Recall

Use project-scoped tools before falling back to broad recall:

- `tracekeeper.project_context` for query-focused project context.
- `tracekeeper.project_history` for recent project notes, sessions, and task records.
- `tracekeeper.recall` only when the query is intentionally cross-project.

Pass one or more scope hints when available:

- `project_hint`
- `project_id`
- `repo_path`
- `repo`
- `project_path`

If the tool returns `uncertain: true`, inspect the returned candidates and narrow the next call. Do not load every project memory into a new task by default.

## Task Closeout

At the end of a task, call `tracekeeper.finish_task` with:

- `task_id`
- `summary`
- `outcomes`
- `next_actions`

When the task produced durable knowledge, include focused closeout fields:

- `decisions`
- `solution_changes`
- `lessons`
- `preferences`
- `memory_candidates`

Set `review_proposal_mode` to `suggest` or `auto_propose` when those fields should create Review Queue proposals.

## Review Boundary

Review Queue proposals are candidates only. Durable writeback still requires user review in Obsidian and then `tracekeeper.apply_approved_writeback`.

Agents should not bypass this flow, edit protected long-term memory directly, or assume that a generated proposal has already become durable memory.
