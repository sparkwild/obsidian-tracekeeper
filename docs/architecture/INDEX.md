# Architecture

## System Shape

```text
AI Agent
   │  companion Skill: workflow habits
   │  MCP Streamable HTTP: bounded capabilities
   ▼
Obsidian-hosted local MCP runtime
   │
   ├─ MCP tool handlers and permission checks
   ├─ shared vault/knowledge primitives
   ▼
Active local Obsidian vault
   ▲
   │  native Obsidian APIs, views, settings, and review actions
   │
User
```

Desktop Obsidian owns the production runtime lifecycle. The standalone MCP process exists for local development and smoke tests, not as a second production architecture.

## Component Ownership

| Component | Owns | Depends on |
| --- | --- | --- |
| `apps/obsidian-plugin` | Plugin lifecycle, runtime host, settings, native views, review actions, client configuration | MCP runtime and core primitives |
| `apps/mcp-server` | MCP protocol, public tool surface, tool validation, permission classification, audit summaries | Core primitives and configured vault boundary |
| `packages/core` | Markdown parsing, vault scanning, recall, context packs, graph health, lint, knowledge paths, and safety helpers | Local filesystem inputs only |
| Vault | Control files, work traces, durable knowledge, sources, proposals, and archive | User's local filesystem and Obsidian |
| Companion Skill | Agent-side invocation policy and workflow adaptation | Public MCP contract; no direct vault authority |

Shared rules belong in the lowest reusable owner. UI code should not reimplement path safety or knowledge rules, and the core package should not know about Obsidian views or Agent client configuration.

## Vault Architecture

The current architecture version uses three top-level roots:

```text
00_tracekeeper/
├─ control/
│  ├─ system.md
│  ├─ memory_policy.md
│  ├─ permissions.md
│  ├─ audit_log.md
│  ├─ audit/
│  └─ dashboards/
├─ inbox/
│  ├─ agent_requests/
│  └─ review_queue/
└─ work/
   ├─ tasks/
   ├─ sessions/
   ├─ context_packs/
   └─ source_analysis/

01_knowledge/
├─ index.md
├─ memory/
│  ├─ index.md
│  ├─ global/
│  └─ projects/
│     └─ index.md
├─ wiki/
│  ├─ index.md
│  ├─ hubs/
│  │  └─ index.md
│  ├─ concepts/
│  ├─ claims/
│  ├─ guides/
│  └─ references/
└─ sources/
   ├─ index.md
   ├─ web/
   ├─ files/
   ├─ transcripts/
   └─ attachments/

02_archive/
└─ review_queue/
```

The roots have distinct meanings:

- `00_tracekeeper` is operational state owned by Tracekeeper.
- `01_knowledge` is durable, human-readable knowledge owned by the user.
- `02_archive` stores inactive or completed artifacts without making them active memory.

Memory captures continuity: tasks, decisions, preferences, lessons, and project history. Wiki captures reusable subjects: hubs, concepts, claims, guides, and references. Durable memory should link to relevant Wiki or source notes so recall and the Obsidian graph use the same relationships.

Body wikilinks are the graph contract. Relationship fields such as `related`, `sources`, `related_wiki`, and `related_memory` should be mirrored in note bodies instead of remaining YAML-only. A project memory note normally includes a `Graph links` section pointing to Wiki/source notes, while the Wiki topic includes a `Related memory` backlink.

## Read And Recall Flow

1. The MCP runtime resolves and validates the active vault root.
2. Core scans Markdown notes while excluding the active Obsidian configuration directory and unsafe paths.
3. `tracekeeper.recall` ranks matching memory, Wiki, source, task, and session context according to the requested scope.
4. The Agent consumes excerpts, match reasons, and graph links first.
5. `tracekeeper.read_note` is used only when the complete note is required.

Recall currently scans the vault on demand. A future incremental index may optimize this boundary, but it must be reconstructible from Markdown, react to Obsidian file events, and never become a second source of truth.

## Write Flows

### Bounded working records

Task, session, source-analysis, context-pack, request, and proposal records are written only to Tracekeeper-controlled directories. Generated records use Markdown, avoid overwriting existing files, and append a sanitized audit event.

### Durable memory

- Global memory is review-gated by default.
- Project auto-save is opt-in, append-only, and limited to `01_knowledge/memory/projects/<project>/memory.md`.
- Project auto-save requires a resolvable Wiki bridge; otherwise the candidate enters the Review Queue.
- Applying an approved proposal appends to the proposal's existing target and updates proposal state.

Idempotent signatures already protect project auto-save from repeated identical entries. As write orchestration grows, explicit operation identifiers, coordinated atomic writes, and a recoverable operation journal should extend this guarantee across multi-file workflows.

### Client configuration

Client configuration is the only expected write outside the active vault. It is owned by the Obsidian plugin, never by MCP tools. Supported automatic changes must:

1. show the target and intended Tracekeeper-only change;
2. require explicit user confirmation;
3. preserve unrelated MCP server entries;
4. write a timestamped backup and temporary file before replacement;
5. record a local audit event without persisting credentials.

Codex and Claude Desktop currently support automatic configuration when the desktop filesystem API is available. Claude Code, Cursor, and custom clients receive copyable configuration.

## Permissions And Review

The architecture distinguishes three effective capability classes:

- read-only operations inspect status, structure, graph, recall results, notes, or queues;
- low-risk writes create bounded working records or proposals in allowlisted paths;
- review-gated apply requires an already approved proposal before durable target writeback.

The detailed Agent behavior is in the [Agent Workflow Contract](AGENT_WORKFLOW_CONTRACT.md); enforcement invariants are in the [Security model](../security/INDEX.md).

## Obsidian UI Boundary

Plugin UI uses Obsidian's native plugin, view, modal, command, and setting APIs. This keeps the interface compatible with Obsidian themes and avoids creating a separate web application architecture.

An open-source UI library is not forbidden, but adoption requires a concrete need and a small real-plugin proof covering bundle size, CSS isolation, theme variables, keyboard behavior, accessibility, and lifecycle cleanup. Native Obsidian components remain the default.

## Operation Entry Boundary

Agent clients initiate task execution, source submission/analysis, context-pack construction, recall, lint, and memory proposals through MCP. The Obsidian plugin is the human governance surface for connection, status, policy, inspection, review, graph suggestions, and structure migration.

Do not duplicate the Agent's operational workflow as a second set of plugin commands. A plugin action is appropriate when it requires local human context or confirmation.

Streamable HTTP is the supported client transport. Tracekeeper does not publish SSE or stdio client profiles, and clients should connect to the Obsidian-hosted URL rather than a repository checkout.

## Lint And Graph Health

`tracekeeper.lint` is the single read-only structure check. It covers required architecture entries, legacy roots, invalid Memory/Wiki paths, broken wikilinks, claim/source relationships, missing project indexes, Memory/Wiki bridges, Wiki backlinks, YAML-only relations, and graph health.

The graph profile controls reporting, not mutation:

| Profile | Reporting behavior |
| --- | --- |
| `off` | Suppress graph-profile issues from lint while retaining manual Graph Health inspection |
| `advisory` | Report graph findings as warnings and recommendations; this is the default |
| `strict` | Promote missing graph entries/hubs, isolated notes, unresolved links, invalid architecture paths, and missing Memory/Wiki bridges to errors where defined |

Disconnected components and one-way leaf nodes remain diagnostic guidance. Graph checking never creates notes or rewrites links. The plugin may turn a selected graph suggestion into a Review Queue candidate, which still follows normal approval and application.

## Structure Migration

Legacy top-level layouts are recognized for inspection and migration. Migration is a human-governed plugin workflow: preview, rebuild missing structure, validate, produce a report, and only then offer cleanup of legacy folders with explicit confirmation.

Recognized roots include `00_control`, `01_inbox`, `02_timeline`, `03_sources`, `04_memory`, `04_projects`, `05_memory`, `05_projects`, `06_outputs`, and `07_archive`.

The structure organizer follows these rules:

- repair missing current entries before considering legacy content;
- preview source roots, file counts, copy targets, and conflicts;
- never overwrite an existing current-layout file during rebuild;
- turn conflicts into `legacy_migration_review` items in the Review Queue;
- write migration reports under `00_tracekeeper/control/migrations/` and a visible task record under `00_tracekeeper/work/tasks/`;
- make cleanup a second explicit confirmation and use the Obsidian system trash instead of permanent deletion.

MCP lint and recall may report legacy structure but must not move or delete it.

## Architecture Invariants

- Markdown in the vault remains the reconstructible source of truth.
- Production access is local, loopback-bound, and token-protected.
- MCP never reads outside the active vault or inside its Obsidian configuration directory.
- Agent guidance cannot expand runtime permissions.
- Durable global memory remains review-gated by default.
- Every automatic or approved write is attributable and recoverable in proportion to its risk.
- Compatibility code may read old layouts, but new content uses the current three-root architecture.
