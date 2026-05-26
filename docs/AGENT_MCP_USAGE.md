# Agent MCP Usage

This guide is for AI agents that connect to Tracekeeper through MCP.

Tracekeeper is local-vault first. Agents may read scoped context, record bounded working notes, and submit memory updates according to user settings. Agents must not treat MCP access as permission to rewrite durable long-term memory directly.

## Task Start

1. Call `tracekeeper.start_task` with the current goal.
2. Include `project_hint` when the project is known.
3. Keep the returned `task_id` and reuse it for later context, closeout, and proposal calls.

## Project-Scoped Recall

Use scoped recall before falling back to broad recall:

- `tracekeeper.recall` with `scope: "project"` for query-focused project context.
- `tracekeeper.recall` with `scope: "project_history"` for recent project notes, sessions, and task records.
- `tracekeeper.recall` with `scope: "global"` only when the query is intentionally cross-project.

Pass one or more scope hints when available:

- `project_hint`
- `project_id`
- `repo_path`
- `repo`
- `project_path`

If the tool returns `uncertain: true`, inspect the returned candidates and narrow the next call. Do not load every project memory into a new task by default.

For cross-session continuity, pass the same project hint or repository path when starting and finishing related tasks. Project-history recall includes matching project notes, agent task records, and session notes linked to those tasks, so a new conversation can recover what happened in earlier sessions for the same project.

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

For project memory, also pass `project_hint` and `related_wiki` when you know the topic page. Valid project auto-save requires a Wiki bridge under `01_knowledge/wiki/...`; otherwise Tracekeeper falls back to Review Queue.

Set `review_proposal_mode` intentionally:

- `auto_propose`: follow the user's memory rules. Global memory is queued for review by default; project memory may auto-save as append-only project memory when the project rule is set to auto.
- `review_queue`: send closeout memory candidates to the Review Queue.
- `off`: write the task/session record only and ignore closeout memory candidates.

`suggest` remains accepted for compatibility and returns `suggested_memory_updates` without creating Review Queue files.

## Review Boundary

Review Queue proposals are candidates only. Approved proposal writeback still requires user review in Obsidian and then `tracekeeper.apply_approved_writeback`.

Agents should not bypass this flow, edit protected long-term memory directly, or assume that a generated proposal has already become durable memory. The only automatic durable write path is the user-controlled project memory rule, and it is append-only.

Project auto-save targets `01_knowledge/memory/projects/<project>/memory.md` and adds graph links to related Wiki and source notes. Agents should not supply arbitrary durable memory paths.

Use `tracekeeper.review_queue` to inspect pending or approved proposals. It is read-only. Only `tracekeeper.apply_approved_writeback` can apply approved content to target notes.

## Vault Checks

Use `tracekeeper.lint` as the single check entry. It covers note structure, broken wikilinks, source references, claim/source checks, and graph health according to the configured graph profile.

Lint also checks the unified knowledge architecture: required `01_knowledge` index files, legacy folders, invalid memory/wiki paths, missing memory-to-wiki bridges, missing Wiki backlinks, missing project indexes, and YAML-only relations that should be mirrored as body wikilinks.
