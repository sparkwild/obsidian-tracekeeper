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

## Obsidian Plugin Surface

The Obsidian plugin is the human review and governance surface. It provides these user-facing views:

- Agent Activity
- Review Queue
- Memory Inspector
- Audit Log
- Runtime Status
- Permission Policy
- Agent Connections
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
- agent scope label

The plugin is desktop-only because it hosts a local Streamable HTTP Runtime on `127.0.0.1`. The default endpoint is `http://127.0.0.1:58437/mcp`, and generated client configuration includes a local token. The Runtime starts with Obsidian and stops when Obsidian or the plugin closes.

## Runtime And Permissions

Tracekeeper MCP is read-only by default and exposes controlled writes only for bounded working records. Long-term memory writeback is review-gated.

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
| `tracekeeper.graph_health` | `read-only` | Reports wikilink graph metrics, graph profile issues, and hub recommendations. |
| `tracekeeper.start_task` | `read-only` | Creates a deterministic task context summary without writing. |
| `tracekeeper.recall` | `read-only` | Returns matching vault notes for a query. |
| `tracekeeper.read_note` | `read-only` | Reads one vault-relative note. |
| `tracekeeper.list_review_queue` | `read-only` | Reads pending proposals. |
| `tracekeeper.list_source_requests` | `read-only` | Reads pending source-analysis requests. |
| `tracekeeper.list_approved_writebacks` | `read-only` | Lists approved proposals eligible for writeback. |
| `tracekeeper.audit_recent` | `read-only` | Reads recent audit entries. |
| `tracekeeper.lint` | `read-only` | Runs vault checks and returns issues. |
| `tracekeeper.build_context_pack` | `read-only` / `optional write` | Builds context and optionally writes a context-pack artifact. |
| `tracekeeper.finish_task` | `low-risk write` | Writes a task session summary. |
| `tracekeeper.distill_session` | `low-risk write` | Writes a session note and review proposals. |
| `tracekeeper.write_context_pack` | `low-risk write` | Writes under context pack outputs only. |
| `tracekeeper.write_session_note` | `low-risk write` | Writes under session notes only. |
| `tracekeeper.capture_source` | `low-risk write` | Writes source metadata/content under source records. |
| `tracekeeper.propose_memory` | `low-risk write` | Writes a Review Queue proposal, not durable memory directly. |
| `tracekeeper.analyze_source_request` | `low-risk write` | Processes an existing source request into records and proposals. |
| `tracekeeper.apply_approved_writeback` | `review-gated apply` | Applies only approved proposals. |

The MCP server must not expose tools that:

- run arbitrary shell commands
- read or write files outside the configured vault
- modify Obsidian configuration folders
- delete notes
- bulk rewrite the vault
- silently write protected long-term memory
- bypass Review Queue approval

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

The Agent Connections view helps users connect AI tools to Tracekeeper without exposing repository checkout paths or developer machine details.

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
