# Architecture

## System Shape

```text
AI Agent
   │  companion Skill: workflow habits
   │  MCP Streamable HTTP: bounded capabilities
   ▼
Obsidian-hosted local MCP runtime
   │
   ├─ contract-driven MCP tools, credentials, and capability checks
   ├─ application use cases and recoverable write coordination
   ├─ event-driven KnowledgeIndex snapshot
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
| `apps/obsidian-plugin` | Composition root, Obsidian Vault/event adapters, runtime lifecycle, native views, onboarding, review actions, client configuration | Contracts, MCP runtime, core primitives, Obsidian API |
| `apps/mcp-server` | Standalone Node composition and cross-layer smoke tests | MCP runtime and core primitives |
| `packages/contracts` | Public/compatibility tool names, visibility, capability, effect, idempotency, workflow role, input/output schema, and deprecation metadata | No workspace package |
| `packages/mcp-runtime` | Streamable HTTP transport, protocol surfaces, authenticated sessions, structured actions/results, application tool adapter, operation recovery, and capability enforcement | Contracts and core |
| `packages/core` | Markdown parsing, rebuildable knowledge index, scanning, recall, context packs, graph health, lint, paths, safety, and operation journal | Node filesystem only in its Node adapters |
| `skills/tracekeeper` | Companion Skill guidance for Agent invocation and closeout habits | MCP runtime enforcement, path safety, write approvals |
| Vault | Control files, work traces, durable knowledge, sources, proposals, and archive | User's local filesystem and Obsidian |

Shared rules belong in the lowest reusable owner. UI code should not reimplement path safety or knowledge rules, and the core package should not know about Obsidian views or Agent client configuration.

### Agent interaction contract

The [Agent Workflow Contract](AGENT_WORKFLOW_CONTRACT.md) defines three modes: `no_track`, `recall_only`, and `tracked_task`. The companion Skill owns mode selection and Agent habits; the Runtime never trusts the Skill for authorization.

Public tool definitions are derived from one contract registry. `tools/list` preserves deterministic order, filters definitions by the authenticated principal's capabilities, and exposes accurate annotations plus `outputSchema`. Tool calls use the same capability evaluator. Every result provides validated `structuredContent` and an equivalent compact JSON text representation for clients with incomplete structured-result support.

Core workflow results return structured Agent actions with stable action ids, timing, reason codes, required capabilities, and executable arguments. Compatibility prose remains derived from the structured result. `start_task` returns a real task handle and scoped recall action; `recall` returns bounded follow-up actions; `finish_task` returns a canonical memory closeout state and never asks an already completed task to finish again.

Recall matches and correlated note reads carry a `recall_id`, a content-origin classification, and `instruction_trust: data_only`. These fields make the instruction boundary explicit: recalled Vault content may inform the task but cannot redefine system instructions, permissions, review gates, or the active task identity.

Project-aware workflows use one Runtime-owned identity resolver. An explicit `project_id` is the strongest evidence. A `project_hint` is canonical only when it agrees with durable Vault identity; when an unmatched Agent hint accompanies a `repo_path` that uniquely matches one durable project, the Vault's canonical hint and id replace the guessed short name with a visible warning. A path-valued `project_hint` is compatibility input and is treated as repository evidence rather than as the canonical project name. If no durable identity matches, a plain explicit hint remains usable and a repository leaf is only a visible fallback. The result exposes the canonical hint, stable id, repository path, source, confidence, and warnings. Ambiguous or contradictory evidence is marked `uncertain`; the Runtime does not silently select a project or apply project filtering.

`start_task` stores the resolved identity in the task record and returns it with the exact recommended Recall arguments. Context-pack and closeout calls may omit identity when they provide the real `task_id`; the Runtime then inherits task metadata. If a caller supplies identity that conflicts with the started task, the call is rejected rather than creating cross-project records.

### Vault repository boundary

Core defines an asynchronous `VaultRepository` port for safe text reads, create-if-absent, optimistic replacement, and Markdown listing. Two adapters implement that contract:

- `NodeFsVaultRepository` is the standalone/test adapter and performs vault-relative validation, symbolic-link rejection, temporary-file replacement, and file-version checks.
- `ObsidianVaultRepository` is the production adapter for operations that must remain coordinated with Obsidian's Vault API and file events.

The port does not expose absolute paths. Versions are optimistic concurrency tokens, not a second source of truth. An adapter must reject stale replacement rather than silently overwrite content changed since it was read.

Public note reads, approved writeback, task closeout, and generated task/source/context/session/proposal/audit/memory records use this port in the Obsidian composition. The standalone composition keeps Node adapters and guarded filesystem fallbacks for deterministic temporary-vault tests and compatibility.

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
│  ├─ operations/
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

1. The plugin creates an empty `KnowledgeIndex`, subscribes to Vault events, and rebuilds the first versioned snapshot in the background instead of blocking plugin startup.
2. Obsidian create, modify, delete, and rename events update only the affected indexed record; events received during rebuild are queued and replayed before the rebuilt generation is considered current.
3. A tool invocation receives one stable scan snapshot. Ready-state status, recall, start, lint, graph, and context-pack queries do not synchronously rescan the full vault.
4. `tracekeeper.recall` ranks matching memory, Wiki, source, task, and session context according to the requested scope. Control and inbox records are not recall candidates. Global and project recall prioritize durable project memory and down-rank work records in proportion to how completely they echo the current query; `project_history` retains task and session continuity without applying that ordinary-Recall preference.
5. Project scope consumes the shared resolved identity. A uniquely matched repository path resolves to the durable Vault project's canonical hint and id; the path then corroborates that identity but does not exclude a matching project-memory note merely because the note has no repository metadata. Explicit conflicting repository metadata remains excluded.
6. The Agent consumes excerpts, match reasons, and graph links first, then uses `tracekeeper.read_note` only when complete content is required.

The standalone MCP composition retains safe filesystem scanning as a development and recovery fallback. Index results expose `index_state` and snapshot generation. A plugin command can rebuild the index, and Connection Status shows its state, generation, note count, and last rebuild. The index is disposable and rebuildable; Markdown remains the only knowledge authority.

## Write Flows

### Bounded working records

Task, session, source-analysis, context-pack, request, and proposal records are written only to Tracekeeper-controlled directories. Generated records use Markdown, avoid overwriting existing files, and append a sanitized audit event.

### Durable memory

- Global memory is review-gated by default.
- Project auto-save is opt-in, append-only, and limited to `01_knowledge/memory/projects/<project>/memory.md`.
- Project auto-save requires a resolvable Wiki bridge; otherwise the candidate enters the Review Queue.
- A tracked Agent preserves relevant existing `related_wiki` and `related_sources` paths from Recall or correlated note reads in its finish payload. The Runtime validates those paths and never asks the Skill to infer or authorize a bridge.
- Applying an approved proposal appends to the proposal's existing target and updates proposal state.

Project auto-save retains content signatures. `start_task`, `finish_task`, and approved writeback additionally use stable operation identities, payload-hash idempotency checks, atomic replacement, and per-operation journals under `00_tracekeeper/control/operations/`. Journal execution uses an in-process queue plus a vault-local process lock and atomic initial claim, preventing the plugin runtime and standalone development runtime from executing the same idempotency key concurrently. Runtime startup resumes known unfinished operations by rolling them forward, exposes recovered/failed/skipped counts to Connection Status, and never rolls user-visible Markdown back over a later edit.

### Vault-outside client integration

Client configuration and explicitly confirmed Skill installation are the only expected writes outside the active vault. They are owned by the Obsidian plugin, never by MCP tools.

Supported automatic client-configuration changes must:

1. show the target and intended Tracekeeper-only change;
2. create a short-lived preview plan containing the target, original-content hash, intended change, and expiry;
3. require explicit user confirmation of that plan;
4. recheck both the file hash and current client credential before commit, requiring a new preview after either changes;
5. preserve unrelated MCP server entries;
6. write a timestamped backup and temporary file before replacement;
7. record a local audit event without persisting credentials.

Codex and Claude Desktop currently support automatic configuration when the desktop filesystem API is available. Claude Code, Cursor, and custom clients receive copyable configuration. Each profile receives an independent credential principal so authorization and audit do not trust the client-reported name. The settings UI can rotate one client credential without invalidating the others. The legacy shared token remains a compatibility credential during migration.

The complete companion Skill bundle is embedded from canonical repository sources. A managed Skill installation must show a short-lived file plan, require user confirmation, recheck original hashes, stage replacement files, back up changed originals, roll back partial failure, and refuse automatic overwrite when the installed bundle has user modifications. Install audit records contain only the action, client id, bundle hash, backup-created flag, result, and timestamp. Unsupported clients receive the flattened compatibility artifact for manual installation.

Managed credentials may use local capability profiles such as knowledge assistance, research, review, or maintenance. A profile is only a preset over Runtime capabilities and visible public tools. It does not create users, teams, remote policy, or a second authorization model; the credential capability list remains the enforceable fact.

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

The Runtime negotiates the supported MCP protocol versions `2025-06-18` and `2025-11-25`. After initialization, each HTTP request must carry the negotiated `Mcp-Protocol-Version` and the current session id. Declared server capabilities are complete: tools support list/call, five fixed `tracekeeper://` resources support list/read, and four capability-filtered workflow prompts support list/get. Resources resolve only fixed Vault-relative targets; prompts are user-invoked templates and never grant permission or force automatic tool selection. Tracekeeper's knowledge-work task remains distinct from the MCP asynchronous Tasks utility.

## Local Workflow Diagnostics

Tool-call audit records may include bounded workflow metadata such as contract/result versions, mode, task/recall/action ids, snapshot generation, scope confidence, matched count, and canonical closeout state. They do not contain complete prompts, note bodies, credentials, or full tool results.

The Activity view aggregates recent local audit events into start-to-recall, recall-to-read, and start-to-finish ratios, active or aged workflows, zero-match recalls, permission denials, closeout distribution, duration percentiles, and recently active principals. It also exposes the bundled Skill version and a copyable command for the repository-local deterministic initiative Eval. These metrics cover only calls that reached Tracekeeper, shrink when audit history is cleaned, remain on the user's machine, and are diagnostics rather than a missed-call denominator or performance score.

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
