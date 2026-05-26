# Architecture

Tracekeeper turns an Obsidian vault into a local memory and knowledge layer for AI assistants.

```text
AI assistant
  -> MCP client connection
  -> Obsidian-hosted Streamable HTTP MCP Runtime
  -> shared vault/runtime logic
  -> Obsidian vault files
  -> Obsidian plugin review surface
```

## Responsibilities

| Layer | Responsibility |
| --- | --- |
| AI assistant | Starts URL/file/source analysis, recall, context, lint, distill, and proposal work. |
| MCP Runtime | Exposes Streamable HTTP tools, manages local sessions, and records auditable activity. |
| Core package | Provides scanning, recall, source analysis, context pack, lint, and safety helpers. |
| Obsidian plugin | Shows activity, review queue, audit, permission policy, runtime status, and AI tool connection setup. |
| Obsidian vault | Stores durable notes, review queue items, source records, session notes, context packs, and audit logs. |

## Unified Knowledge Architecture

Tracekeeper treats memory and wiki as one Agent Knowledge System. Memory captures what happened and what should be remembered; wiki pages organize reusable topics. Durable memory must link into wiki topics with body wikilinks, and wiki hubs should link back to related memory so Obsidian graph and agent recall see the same knowledge shape.

New vault initialization creates only this top-level layout:

```text
00_tracekeeper/
  control/
  inbox/
    agent_requests/
    review_queue/
  work/
    tasks/
    sessions/
    context_packs/
    source_analysis/
01_knowledge/
  index.md
  memory/
    index.md
    global/
    projects/
      index.md
  wiki/
    index.md
    hubs/
      index.md
    concepts/
    claims/
    guides/
    references/
  sources/
    index.md
    web/
    files/
    transcripts/
    attachments/
02_archive/
  review_queue/
```

Legacy folders such as `00_control`, `01_inbox`, `02_timeline`, `03_sources`, `04_memory`, `05_projects`, `06_outputs`, and `07_archive` are read for compatibility and reported by lint. New writes should not target them.

Stable write rules:

- Project memory writes target `01_knowledge/memory/projects/<project>/memory.md`.
- Global memory remains review-gated by default.
- Project auto-save is append-only and requires at least one valid `01_knowledge/wiki/...` bridge.
- Durable memory sections include `Graph links` with explicit wikilinks.
- Wiki proposals should include `Related memory` so topic pages connect back to memory lines.
- YAML `related`, `sources`, `related_wiki`, and `related_memory` entries should be mirrored by body wikilinks instead of staying metadata-only.

## Obsidian Plugin Surface

The Obsidian plugin is the human review and governance surface. It provides these user-facing views:

- Agent Activity
- Review Queue
- Memory Inspector
- Audit Log
- Runtime Status
- Permission Policy
- Agent configuration in settings
- Graph Health

The plugin may provide review actions:

- Approve
- Reject
- Defer
- Request Revision
- Apply Approved Writeback

The plugin settings are intentionally user-controlled:

- welcome/status text
- MCP Runtime port
- local connection token rotation
- graph health profile (`off`, `advisory`, or `strict`)
- memory rules for global, project, and task-closeout updates

The plugin is desktop-only because it hosts a local Streamable HTTP Runtime on `127.0.0.1`. The default endpoint is `http://127.0.0.1:58437/mcp`, and generated client configuration includes a local token. The Runtime starts with Obsidian and stops when Obsidian or the plugin closes.

## Runtime And Permissions

Tracekeeper MCP is read-only by default and exposes controlled writes only for bounded working records. Global long-term memory writeback is review-gated by default; project memory may use the user-controlled append-only auto-save rule.

| Level | Meaning |
| --- | --- |
| `read-only` | Reads vault-scoped notes, queues, indexes, and summaries. |
| `low-risk write` | Writes bounded working records such as context packs, session notes, source records, and proposals. |
| `optional write` | Reads by default and writes only when the caller explicitly requests an artifact. |
| `review-gated apply` | Applies a proposal only after user approval in Review Queue. |
| `forbidden` | Actions outside the Tracekeeper boundary and not exposed as tools. |

Current MCP tools:

| Tool | Permission | Notes |
| --- | --- | --- |
| `tracekeeper.status` | `read-only` | Scans vault summary counts. |
| `tracekeeper.lint` | `read-only` | Runs vault checks, including note structure, links, source references, and graph health. |
| `tracekeeper.recall` | `read-only` | Returns global, project-scoped, or project-history recall results. |
| `tracekeeper.read_note` | `read-only` | Reads one vault-relative note. |
| `tracekeeper.start_task` | `low-risk write` | Creates an active task record and returns a deterministic context summary. |
| `tracekeeper.finish_task` | `low-risk write` | Writes a task session summary; `auto_propose` follows configured memory rules, while `review_queue` sends closeout memory candidates to Review Queue. |
| `tracekeeper.build_context_pack` | `read-only` / `optional write` | Builds context and optionally writes a context-pack artifact. |
| `tracekeeper.review_queue` | `read-only` | Lists pending proposals or approved writeback candidates. |
| `tracekeeper.apply_approved_writeback` | `review-gated apply` | Applies only approved proposals. |
| `tracekeeper.source_request` | `read-only` / `low-risk write` | Lists source-analysis requests or processes one existing request into records and proposals. |
| `tracekeeper.capture_source` | `low-risk write` | Writes source metadata/content under source records. |
| `tracekeeper.propose_memory` | `low-risk write` | Writes a memory update according to configured memory rules. |

## Cross-agent MCP Workflow (Practical)

Use this flow for multi-agent safety:

1. Start task context
   - Call `tracekeeper.start_task` with `goal` and optional `project_hint`.
   - Save the returned `task_id`.
   - Use the same `task_id` for later closeout and proposal calls.
2. Project-scoped recall
	- Start from `related_projects` returned by `start_task`.
	- Prefer `tracekeeper.recall` with `scope: "project"` for targeted recall and `scope: "project_history"` for recent project continuity.
	- Pass `project_hint`, `project_id`, `repo_path`, `repo`, or `project_path` when the agent knows the current project.
	- If the project scope is uncertain, inspect the returned candidates instead of loading unrelated project memory.
	- Use `project_hint` on closeout/proposal calls to keep generated notes and proposals linked to the project.
	- Project-history recall includes project notes, matching agent task records, and session notes linked through those task records, which supports multiple conversations under the same project.
3. Task closeout
   - Use `tracekeeper.finish_task` for closure summary.
   - Add `decisions`, `solution_changes`, `lessons`, `preferences`, `next_actions`, or `memory_candidates` when the task produced durable knowledge.
   - Set `review_proposal_mode` to `auto_propose`, `review_queue`, or `off` intentionally.
   - `auto_propose` follows the configured memory rules; `review_queue` sends closeout memory candidates to Review Queue; `off` ignores closeout memory candidates.
4. Review Queue proposals
	- Global memory enters Review Queue by default when an agent calls `tracekeeper.propose_memory` or `tracekeeper.finish_task` with `review_proposal_mode: "auto_propose"`.
	- Closeout memory enters Review Queue when an agent calls `tracekeeper.finish_task` with `review_proposal_mode: "review_queue"`.
	- Project memory can auto-save as append-only project memory when the user sets the project memory rule to automatic.
	- Use `tracekeeper.review_queue` to inspect pending or approved proposals.
	- In Obsidian, review proposals and approve, reject, defer, or request revisions.
5. Durability rule
   - Global durable writeback runs through `tracekeeper.apply_approved_writeback` after Review Queue approval by default.
   - Project memory auto-save is user-controlled, append-only, and limited to project memory targets.

The MCP server must not expose tools that:

- run arbitrary shell commands
- read or write files outside the configured vault
- modify Obsidian configuration folders
- delete notes
- bulk rewrite the vault
- silently write protected long-term memory outside the configured project auto-save rule
- bypass Review Queue approval for queued global memory

The Runtime refuses to start without a token by default. The only exception is the explicit development-only flag used by standalone local checks. Production Obsidian-hosted Runtime instances must use the generated local token.

Browser-style CORS requests are accepted only from Obsidian and loopback origins. The Runtime does not return `Access-Control-Allow-Origin: *`.

## Graph Health Profile

Graph health is a read-only structural check. It never creates notes, rewrites links, or applies long-term memory. The profile only controls how findings are reported:

| Profile | Behavior |
| --- | --- |
| `off` | Suppresses graph profile issues in lint while keeping manual inspection available in the plugin. |
| `advisory` | Adds graph findings as warnings and recommendations. This is the default. |
| `strict` | Treats missing graph entry notes, missing recommended hubs, isolated nodes, and unresolved graph links as lint errors. Disconnected components and one-way leaf nodes remain warnings. |

When users want Tracekeeper to help improve graph structure, the Obsidian Graph Health view can create a Review Queue proposal. That proposal is still only a candidate; any durable vault change must be reviewed and applied through the normal review-gated workflow.

## Agent Client Configuration

The Tracekeeper settings tab helps users connect AI tools to Tracekeeper without exposing repository checkout paths or developer machine details.

Principles:

- Do not point clients to the source tree.
- Do not hardcode a vault path.
- Use the Obsidian-hosted Streamable HTTP Runtime URL.
- Include the generated local token in client configuration.
- Do not offer SSE or stdio connection modes.
- Never auto-configure from an agent call; configuration writes are user-triggered in Obsidian only.

Supported client profiles:

| Client | Preferred connection | Auto-config status |
| --- | --- | --- |
| Codex | Streamable HTTP URL | User-confirmed config file merge when supported. |
| Claude Code | Streamable HTTP CLI command | Copy command for user execution. |
| Claude Desktop | Streamable HTTP URL | User-confirmed JSON merge when supported. |
| Cursor | Streamable HTTP URL | Copy config until a stable write target is available. |
| Custom | Streamable HTTP URL | Copy config only. |

Safe config writes follow this flow:

1. Detect whether a supported client config file exists.
2. Generate only the `tracekeeper` MCP server block.
3. Show target file and config preview.
4. Wait for user confirmation.
5. Create a backup.
6. Merge or replace only the `tracekeeper` block.
7. Leave all other MCP servers untouched.
8. Record an audit event.

Removal uses the same confirmation and backup flow. It deletes only the `tracekeeper` MCP server block and never deletes the whole client config file.

## Non-Goals

- The Obsidian plugin is not a source submission UI.
- The plugin does not run maintenance actions such as Analyze URL, Analyze File, Capture Source, Build Context Pack, Run Lint, or Run Distill.
- Tracekeeper does not require a hosted backend.
- Tracekeeper ships with a default loopback Runtime port, but does not assume a fixed repository checkout path.
- Tracekeeper does not expose SSE or stdio connection modes.

## Vault Scope

The plugin uses the currently open Obsidian vault. The MCP Runtime is started by the desktop plugin and supplies that vault root to all tool calls. All file operations must remain inside that vault unless the user explicitly confirms a client configuration file change.
